/* Analyser - lazy nanoPRC (WASM) loader.

   Decodes a PRC stream - the 3D model format Adobe Acrobat embeds in "3D PDFs"
   - into triangles, using nanoPRC (AGPL-3.0, CascadiaVoxel LLC) compiled to
   WebAssembly with a small glue layer. PRC normally stores its triangles as
   "highly compressed tessellation", a progressive mesh encoding the published
   spec gets wrong in places; nanoPRC is the open decoder that reads it.

   Vendored files (offline tier - EVERYTHING), built by tools/nanoprc/build.mjs
   from nanoPRC + tools/nanoprc/anr_prc.c + tools/nanoprc/patches.mjs:
     assets/vendor/nanoprc/nanoprc.mjs   (Emscripten ES-module factory)
     assets/vendor/nanoprc/nanoprc.wasm  (~550 KB)
   plus LICENSE / SOURCE.txt naming the exact upstream commit.

   The glue (anr_prc_mesh) walks the model tree the way nanoPRC's own exporters
   do, composes each part's placement, and writes every drawn triangle in world
   space to a flat file in the module's in-memory FS; the layout is described
   at the top of anr_prc.c and read back by parseMesh() below.

   No top-level side effects: every decodePrc() instantiates the module afresh
   (the script and wasm come from the cache after the first), because WASM
   memory never shrinks - a reused instance would hold its largest heap, up to
   2 GB, for the rest of the visit. The instance is garbage once the call
   returns or throws. */
import { PRC_TRI_MAX } from '../core/limits.js';
const NANOPRC_URL = new URL('../../vendor/nanoprc/nanoprc.mjs', import.meta.url).href;
// The glue's failure codes (anr_prc_mesh's negative returns).
const STEP_ERRORS = {
    [-1]: 'the decoder could not start',
    [-2]: 'the PRC stream could not be parsed',
    [-3]: 'its model tree could not be read',
    [-4]: 'its tessellations could not be counted',
    [-5]: 'its tessellation data could not be decoded',
    [-6]: 'the decoded mesh could not be written out',
};
function parseMesh(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (buf.length < 16 || String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== 'ANRM')
        throw new Error('unexpected decoder output');
    let o = 8;
    const flags = dv.getUint32(o, true);
    o += 4;
    const n = dv.getUint32(o, true);
    o += 4;
    const dec = new TextDecoder();
    const parts = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
        const nl = dv.getUint32(o, true);
        o += 4;
        const name = dec.decode(buf.subarray(o, o + nl));
        o += nl;
        const t = dv.getUint32(o, true);
        o += 4;
        const fl = t * 9;
        // slice(): the floats sit at arbitrary byte offsets (after a name), and a
        // Float32Array view needs 4-byte alignment.
        const positions = new Float32Array(buf.slice(o, o + fl * 4).buffer);
        o += fl * 4;
        const normals = new Float32Array(buf.slice(o, o + fl * 4).buffer);
        o += fl * 4;
        const colors = buf.slice(o, o + fl);
        o += fl;
        if (o > buf.length)
            throw new Error('truncated decoder output');
        parts.push({ name, triangles: t, positions, normals, colors });
        total += t;
    }
    return { parts, triangles: total, hasColour: !!(flags & 1), truncated: !!(flags & 2) };
}
/** Decode one PRC stream (the bytes after any PDF filter, starting "PRC"). */
export async function decodePrc(bytes) {
    // shortcut: runs on the main thread and cannot be cancelled; move to a worker if big models freeze the page.
    const m = await import(NANOPRC_URL);
    // nanoPRC prints progress and diagnostics with printf; none of it is for the page's console.
    const mod = await (m.default || m)({ print() { }, printErr() { } });
    mod.FS.writeFile('/anr-in.prc', bytes);
    const rc = mod.ccall('anr_prc_mesh', 'number', ['string', 'string', 'number'], ['/anr-in.prc', '/anr-out.bin', PRC_TRI_MAX]);
    if (rc < 0)
        throw new Error(STEP_ERRORS[rc] || 'the decoder failed (' + rc + ')');
    return parseMesh(mod.FS.readFile('/anr-out.bin'));
}
//# sourceMappingURL=nanoprc-loader.js.map