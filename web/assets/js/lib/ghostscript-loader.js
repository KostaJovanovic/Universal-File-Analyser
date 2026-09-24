/* Analyser - lazy Ghostscript (WASM) loader.

   Rasterizes EPS / PostScript to a PNG preview using a vendored build of
   @jspawn/ghostscript-wasm (the `gs` interpreter compiled to WASM via
   Emscripten, ~15 MB). This module has NO top-level side effects: the heavy
   wasm is fetched and instantiated only the first time renderPostScript() is
   called (i.e. only when an EPS/PS file is actually opened), then cached for
   subsequent calls.

   Vendored files (offline tier - COMPLETE only):
     assets/vendor/ghostscript/gs.mjs     (ESM factory; pulls browser.js + gs.js)
     assets/vendor/ghostscript/browser.js
     assets/vendor/ghostscript/gs.js
     assets/vendor/ghostscript/gs.wasm    (~15 MB)

   The build is a standard Emscripten MODULARIZE module:
     - default export is `async (config) => Module`
     - `Module.callMain(argv)` runs the gs CLI (noInitialRun is set)
     - `Module.FS` is the in-memory Emscripten filesystem
     - `Module.instantiateWasm` is the env-agnostic hook we use to feed the
       vendored gs.wasm bytes (this build does NOT honour Module.wasmBinary). */
import { GS_INPUT_MAX, GS_TIMEOUT_MS } from '../core/limits.js';
const GS_BASE = new URL('../../vendor/ghostscript/', import.meta.url);
let _gsFactoryPromise = null; // Promise<defaultExport> for gs.mjs
let _wasmBytesPromise = null; // Promise<ArrayBuffer> for gs.wasm
function loadFactory() {
    if (!_gsFactoryPromise) {
        _gsFactoryPromise = import(new URL('gs.mjs', GS_BASE).href).then((m) => m.default || m);
    }
    return _gsFactoryPromise;
}
function loadWasmBytes() {
    if (!_wasmBytesPromise) {
        _wasmBytesPromise = fetch(new URL('gs.wasm', GS_BASE).href).then((r) => {
            if (!r.ok)
                throw new Error('gs.wasm fetch failed: ' + r.status);
            return r.arrayBuffer();
        });
    }
    return _wasmBytesPromise;
}
// Build a fresh Emscripten Module instance. Each gs run uses a fresh module so
// the in-memory FS and exit state never leak between conversions; the wasm
// bytes and the JS factory are cached, so only compilation is repeated (cheap
// relative to the multi-MB download/instantiate that happens once).
async function createGs() {
    const [factory, wasmBytes] = await Promise.all([loadFactory(), loadWasmBytes()]);
    // Emscripten's own promise never settles when the async instantiateWasm path
    // fails, so a bad wasm would leave the caller waiting forever. Race it against
    // the instantiate failure instead.
    return new Promise((resolve, reject) => {
        factory({
            noInitialRun: true,
            print() { },
            printErr() { },
            instantiateWasm(imports, success) {
                WebAssembly.instantiate(wasmBytes, imports)
                    .then((res) => success(res.instance, res.module))
                    .catch((err) => { try {
                    console.warn('gs wasm instantiate failed', err);
                }
                catch (_) { } reject(err); });
                return {}; // async path; success() is called above
            },
        }).then(resolve, reject);
    });
}
// The gs run itself is one synchronous callMain(), and PostScript is a full
// programming language: `{} loop` never returns, and on the main thread that
// froze the tab for good. The job therefore runs in a throwaway module worker
// (built from the source below, so there is no extra file to precache) that is
// terminated after GS_TIMEOUT_MS. The worker imports the same vendored gs.mjs
// and is handed the wasm bytes, so it downloads nothing of its own. If the
// worker cannot even start here (an old engine, a scheme that will not load a
// module into a blob worker) the old main-thread path runs instead.
const GS_WORKER_SRC = `
self.onmessage = async (e) => {
  const d = e.data;
  let mod;
  try {
    const m = await import(d.gsUrl);
    const factory = m.default || m;
    mod = await new Promise((resolve, reject) => {
      factory({
        noInitialRun: true, print() {}, printErr() {},
        instantiateWasm(imports, success) {
          WebAssembly.instantiate(d.wasm, imports).then((r) => success(r.instance, r.module)).catch(reject);
          return {};
        },
      }).then(resolve, reject);
    });
  } catch (err) { self.postMessage({ stage: 'init-failed' }); return; }
  self.postMessage({ stage: 'ready' });
  let out = null;
  try {
    mod.FS.writeFile(d.inName, d.input);
    mod.callMain(d.args);
    try { out = mod.FS.readFile(d.outName).slice(); } catch (_) { out = null; }
  } catch (_) { out = null; }
  if (out) self.postMessage({ stage: 'done', out }, [out.buffer]);
  else self.postMessage({ stage: 'done', out: null });
};`;
let _gsWorkerUrl = null;
// Resolves with the PNG bytes (or null for a gs failure or a timeout), or with
// the string 'unavailable' when the worker could not start at all.
async function runGsInWorker(input, inName, outName, args) {
    let wasmBytes;
    try {
        wasmBytes = await loadWasmBytes();
    }
    catch (_) {
        return 'unavailable';
    }
    let worker;
    try {
        if (!_gsWorkerUrl)
            _gsWorkerUrl = URL.createObjectURL(new Blob([GS_WORKER_SRC], { type: 'text/javascript' }));
        worker = new Worker(_gsWorkerUrl, { type: 'module' });
    }
    catch (_) {
        return 'unavailable';
    }
    return new Promise((resolve) => {
        let ready = false, settled = false;
        let timer = null;
        const finish = (v) => {
            if (settled)
                return;
            settled = true;
            if (timer)
                clearTimeout(timer);
            try {
                worker.terminate();
            }
            catch (_) { /* ignore */ }
            resolve(v);
        };
        // Loading the interpreter gets a generous allowance of its own, so a stalled
        // download cannot leave the caller waiting forever either.
        timer = setTimeout(() => finish(null), GS_TIMEOUT_MS * 4);
        worker.onmessage = (e) => {
            const d = e.data || {};
            if (d.stage === 'init-failed')
                finish('unavailable');
            else if (d.stage === 'ready') {
                ready = true;
                if (timer)
                    clearTimeout(timer);
                // The clock starts once the interpreter is up, so a slow first download
                // or compile is never mistaken for a runaway document.
                timer = setTimeout(() => finish(null), GS_TIMEOUT_MS);
            }
            else if (d.stage === 'done')
                finish(d.out instanceof Uint8Array ? d.out : null);
        };
        worker.onerror = (ev) => { try {
            ev.preventDefault();
        }
        catch (_) { /* ignore */ } finish(ready ? null : 'unavailable'); };
        try {
            const copy = wasmBytes.slice(0);
            const inCopy = input.slice();
            worker.postMessage({
                gsUrl: new URL('gs.mjs', GS_BASE).href, wasm: copy, input: inCopy, inName, outName, args,
            }, [copy, inCopy.buffer]);
        }
        catch (_) {
            finish('unavailable');
        }
    });
}
/**
 * Rasterize the first page of an EPS / PostScript document to a PNG Blob.
 *
 * @param {Uint8Array|ArrayBuffer} bytes  the raw EPS/PS file contents
 * @param {string} ext                    lowercase extension (eps/epsf/epsi/ps)
 * @returns {Promise<Blob|null>}          a PNG Blob (first page) or null on any failure
 */
export async function renderPostScript(bytes, ext) {
    try {
        const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        if (!u8 || !u8.length)
            return null;
        // Size wall: the whole document is copied into the wasm heap and interpreted.
        if (u8.length > GS_INPUT_MAX)
            return null;
        const isEps = ext === 'eps' || ext === 'epsf' || ext === 'epsi';
        const inName = isEps ? 'input.eps' : 'input.ps';
        const outName = 'output.png';
        // First page only (-dLastPage=1), ~150 dpi, white background, EPS cropped to
        // its bounding box. -dSAFER sandboxes the interpreter.
        const args = [
            '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET',
            '-dFirstPage=1', '-dLastPage=1',
            '-sDEVICE=png16m', '-r150',
            '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4',
            '-dBackgroundColor=16#ffffff',
        ];
        if (isEps)
            args.push('-dEPSCrop');
        args.push('-o', outName, inName);
        let out;
        const viaWorker = await runGsInWorker(u8, inName, outName, args);
        if (viaWorker !== 'unavailable') {
            out = viaWorker;
        }
        else {
            // Main-thread fallback, used only where the worker cannot start.
            const mod = await createGs();
            if (!mod || typeof mod.callMain !== 'function' || !mod.FS)
                return null;
            mod.FS.writeFile(inName, u8);
            const rc = mod.callMain(args);
            if (rc !== 0 && rc !== undefined && rc !== null) {
                // Non-zero exit: gs failed. Still try to read output in case a partial
                // page was written, but if there's nothing, bail.
            }
            try {
                out = mod.FS.readFile(outName);
            }
            catch (_) {
                return null;
            }
        }
        if (!out || !out.length)
            return null;
        // Sanity check PNG signature.
        if (out[0] !== 0x89 || out[1] !== 0x50 || out[2] !== 0x4e || out[3] !== 0x47)
            return null;
        // Copy into a fresh buffer so the Blob doesn't reference the wasm heap.
        return new Blob([out.slice()], { type: 'image/png' });
    }
    catch (_) {
        return null;
    }
}
//# sourceMappingURL=ghostscript-loader.js.map