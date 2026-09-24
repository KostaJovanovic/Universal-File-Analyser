/* Analyser - lazy xz (LZMA2) decompressor.

   Wraps the vendored xzwasm UMD bundle (assets/vendor/xzwasm/xzwasm.min.js),
   loaded on demand the first time an .xz / .tar.xz / xz-compressed package member
   is opened. xzwasm exposes `XzReadableStream` (a ReadableStream subclass that
   wraps a compressed ReadableStream and yields decompressed bytes via the WASM
   build of xz-embedded). The .wasm is embedded in the JS as a base64 data URI,
   so there is no separate file to host.

   No top-level side effects: the script is only injected when xzDecompress runs. */
import { loadScript } from '../core/util.js';
import { DECOMP_OUTPUT_MAX } from '../core/limits.js';
// The uncompressed size an xz file declares in its index (the block records just
// before the 12-byte stream footer), or -1 when it can't be read - stream
// padding, a damaged tail, or anything unexpected. Only a hint: the output is
// still checked against it as it arrives.
function xzDeclaredSize(b) {
    const n = b.length;
    if (n < 32 || b[n - 2] !== 0x59 || b[n - 1] !== 0x5A)
        return -1; // footer magic "YZ"
    const backward = (b[n - 8] | (b[n - 7] << 8) | (b[n - 6] << 16) | (b[n - 5] << 24)) >>> 0;
    const indexSize = (backward + 1) * 4;
    const idx = n - 12 - indexSize;
    if (idx < 12 || b[idx] !== 0x00)
        return -1; // index indicator
    const end = idx + indexSize;
    let p = idx + 1;
    const varint = () => {
        let v = 0, mul = 1;
        for (let i = 0; i < 9 && p < end; i++) {
            const x = b[p++];
            v += (x & 0x7F) * mul;
            if (!(x & 0x80))
                return v;
            mul *= 128;
        }
        return -1;
    };
    const count = varint();
    if (count < 0)
        return -1;
    let total = 0;
    for (let i = 0; i < count; i++) {
        if (varint() < 0)
            return -1; // unpadded size
        const u = varint();
        if (u < 0)
            return -1;
        total += u;
    }
    return total;
}
// Decompress an xz byte buffer. Returns the decompressed Uint8Array, or null on
// any failure (unsupported, corrupt, over the cap, or wasm load error) so callers
// can fall back to header-only parsing. `maxOut` (default DECOMP_OUTPUT_MAX)
// is the hard cap on decompressed output, so a tiny "xz bomb" can't exhaust
// memory - every caller, including a .deb's control.tar.xz, gets it.
//
// Memory: when the index declares the size, the output is written straight into
// one buffer of that size, so the bytes are held once. Otherwise (or if the
// declaration turns out short) the chunks are kept and joined at the end, and
// each is dropped as soon as it has been copied.
export async function xzDecompress(bytes, maxOut = DECOMP_OUTPUT_MAX) {
    try {
        if (!(window.xzwasm && window.xzwasm.XzReadableStream)) {
            await loadScript('assets/vendor/xzwasm/xzwasm.min.js');
        }
        const XzReadableStream = window.xzwasm && window.xzwasm.XzReadableStream;
        if (typeof XzReadableStream !== 'function')
            return null;
        const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        // Feed the compressed bytes in as a one-shot ReadableStream; xzwasm pulls
        // from it and emits decompressed chunks through the Streams API.
        const compressedStream = new Response(input).body;
        if (!compressedStream)
            return null;
        const declared = xzDeclaredSize(input);
        if (declared > maxOut)
            return null;
        let pre = declared > 0 ? new Uint8Array(declared) : null;
        let preLen = 0;
        const reader = new XzReadableStream(compressedStream).getReader();
        const chunks = [];
        let total = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            if (value && value.byteLength) {
                total += value.byteLength;
                if (total > maxOut) {
                    try {
                        await reader.cancel();
                    }
                    catch (_) { }
                    return null;
                }
                if (pre && preLen + value.byteLength <= pre.length) {
                    pre.set(value, preLen); // set() copies, so the reused WASM buffer is safe
                    preLen += value.byteLength;
                }
                else {
                    // Declared size was wrong (or absent): fall back to collecting chunks.
                    if (pre) {
                        chunks.push(pre.subarray(0, preLen));
                        pre = null;
                    }
                    // The WASM reuses one output buffer across pulls, so copy each chunk.
                    chunks.push(value.slice());
                }
            }
        }
        if (!total)
            return new Uint8Array(0);
        if (pre)
            return preLen === pre.length ? pre : pre.subarray(0, preLen);
        const out = new Uint8Array(total);
        let off = 0;
        for (let i = 0; i < chunks.length; i++) {
            const c = chunks[i];
            out.set(c, off);
            off += c.byteLength;
            chunks[i] = null;
        }
        return out;
    }
    catch (_) {
        return null;
    }
}
//# sourceMappingURL=xz-loader.js.map