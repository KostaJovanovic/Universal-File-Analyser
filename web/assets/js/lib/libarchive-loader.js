/* Analyser - lazy loader for the vendored libarchive.js WASM extractor.

   Exposes `extractArchive(file)` which lazily imports the ESM wrapper
   (assets/vendor/libarchive/la-archive.js), boots the WASM worker on first
   use (Archive.init with the vendored worker-bundle.js URL), opens the given
   File/Blob and returns a lightweight handle:

     {
       names: string[],                 // flat list of full entry paths
       entries: [{ name, size, getBytes:()=>Promise<Uint8Array> }],
       close(): void                    // terminate the worker
     }

   Entry extraction is lazy: getBytes() round-trips to the worker only when
   called. Everything is wrapped so any load/parse failure throws cleanly and
   callers can fall back to header-only identification.

   libarchive handles rar, 7z, zip, tar, cab, iso, ... so this drives the
   cbr/cb7/ace upgrades. No top-level side effects beyond a cached init. */
// Resolved against the document base URL (the app is served from the repo
// root), matching how the other vendored assets are referenced.
const WORKER_URL = 'assets/vendor/libarchive/worker-bundle.js';
const WRAPPER_URL = 'assets/vendor/libarchive/la-archive.js';
let _archiveModPromise = null;
// Lazily import the ESM wrapper and run Archive.init exactly once. Cached so
// repeated extractArchive() calls share the same module + worker config.
async function loadArchiveModule() {
    if (!_archiveModPromise) {
        _archiveModPromise = (async () => {
            // Resolve the wrapper URL against the document base so the dynamic
            // import works regardless of where this module lives.
            const url = new URL(WRAPPER_URL, document.baseURI).href;
            const mod = await import(url);
            if (!mod || !mod.Archive)
                throw new Error('libarchive wrapper did not export Archive');
            mod.Archive.init({ workerUrl: new URL(WORKER_URL, document.baseURI).href });
            return mod;
        })().catch((e) => {
            // Reset so a later attempt can retry rather than caching the failure.
            _archiveModPromise = null;
            throw e;
        });
    }
    return _archiveModPromise;
}
// Each open archive is a Web Worker holding a full copy of the file in its WASM
// heap, and a renderer has no teardown hook to close it when the view goes
// away. So the loader bounds them itself: at most LIVE_MAX stay open, and
// opening another retires the oldest. A retired handle is not dead - its
// getBytes() re-opens the archive on demand (the Back button returning to an
// older archive still works), it just stops holding memory while unused.
const LIVE_MAX = 2;
const _live = [];
function trackLive(h) {
    const i = _live.indexOf(h);
    if (i >= 0)
        _live.splice(i, 1);
    _live.push(h);
    while (_live.length > LIVE_MAX)
        _live.shift().close();
}
// Open `file` (File/Blob) and return a handle with a flat entry list and lazy
// per-entry byte extraction. Throws on any failure (caller catches); the worker
// is closed on every failure path (la-archive.js also terminates it when the
// open itself fails).
export async function extractArchive(file) {
    const { Archive } = await loadArchiveModule();
    let archive = await Archive.open(file);
    let arr;
    try {
        arr = await archive.getFilesArray();
    }
    catch (e) {
        try {
            archive.close();
        }
        catch (_) { }
        throw e;
    }
    // Re-open a retired handle's archive for one more extraction.
    let reopening = null;
    const ensureOpen = async () => {
        if (archive)
            return archive;
        if (!reopening) {
            reopening = Archive.open(file).then((a) => { archive = a; trackLive(handle); return a; })
                .finally(() => { reopening = null; });
        }
        return reopening;
    };
    const entries = arr
        // Only real compressed files (skip null directory placeholders).
        .filter((it) => it && it.file && typeof it.file.extract === 'function')
        .map((it) => {
        const fullName = (it.path || '') + (it.file.name || '');
        // The entry's archive path as the worker knows it (CompressedFile._path).
        const target = it.file._path != null ? it.file._path : fullName;
        return {
            name: fullName,
            size: it.file.size || 0,
            getBytes: async () => {
                const a = await ensureOpen();
                const extracted = await a.extractSingleFile(target);
                const buf = await extracted.arrayBuffer();
                return new Uint8Array(buf);
            },
        };
    });
    const handle = {
        names: entries.map((e) => e.name),
        entries,
        close() {
            const i = _live.indexOf(handle);
            if (i >= 0)
                _live.splice(i, 1);
            if (archive) {
                try {
                    archive.close();
                }
                catch (_) { }
            }
            archive = null;
        },
    };
    // Nothing to extract: no reason to keep the worker (and its copy) alive.
    if (!entries.length)
        handle.close();
    else
        trackLive(handle);
    return handle;
}
//# sourceMappingURL=libarchive-loader.js.map