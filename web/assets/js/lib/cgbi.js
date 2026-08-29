/* Analyser - CgBI ("iOS-optimised") PNG repair.

   Xcode rewrites every PNG it ships inside an .ipa into Apple's private CgBI
   variant, and no browser will decode one: it is a PNG only in outline. Three
   things differ, and all three have to be undone:

     1. A private `CgBI` chunk sits before IHDR.
     2. The IDAT stream is RAW deflate - the two-byte zlib header and the Adler
        checksum are stripped - so a standard inflate rejects it outright.
     3. The pixels are BGRA with PREMULTIPLIED alpha, not straight RGBA.

   Apple also leaves the IDAT CRCs wrong, which is why a "repair the CRC" fix
   never works: the bytes underneath are a different image encoding, not a
   corrupted PNG.

   This matters here because Analyser browses .ipa archives, so every icon and
   asset inside one currently fails to display. Converting to real RGBA means
   the normal photo path, the embedded-images grid and /compare all just work.

   Interlaced (Adam7) CgBI files are declined rather than guessed at - Xcode
   does not produce them, so the branch would be untested code on a path where
   being wrong looks like a decoded image. */
import { inflate } from '../core/binutil.js';
const PNG_SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
/** Walk the PNG chunk list once, returning each chunk's type and byte range.
    Stops at IEND or the first malformed length. */
function* chunks(b) {
    let p = 8;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    while (p + 8 <= b.length) {
        const length = dv.getUint32(p, false);
        const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
        if (length > b.length || p + 12 + length > b.length)
            return;
        yield { type, start: p + 8, length };
        if (type === 'IEND')
            return;
        p += 12 + length; // len + type + data + crc
    }
}
/** True if these bytes are a PNG carrying Apple's private CgBI chunk. Cheap
    enough to call on any PNG before handing it to the browser. */
export function isCgbiPng(b) {
    if (b.length < 16)
        return false;
    for (let i = 0; i < 8; i++)
        if (b[i] !== PNG_SIG[i])
            return false;
    for (const c of chunks(b)) {
        if (c.type === 'CgBI')
            return true;
        if (c.type === 'IDAT' || c.type === 'IEND')
            return false; // CgBI precedes IHDR
    }
    return false;
}
// Undo the per-scanline PNG filters in place over the raw inflated bytes.
// `bpp` is the byte stride of one pixel; each scanline is prefixed by its
// filter type. Returns the unfiltered pixel bytes with the prefixes removed.
function unfilter(raw, width, height, bpp) {
    const stride = width * bpp;
    if (raw.length < height * (stride + 1))
        return null;
    const out = new Uint8Array(height * stride);
    let src = 0;
    for (let y = 0; y < height; y++) {
        const ft = raw[src++];
        const row = y * stride, prev = row - stride;
        for (let x = 0; x < stride; x++) {
            const v = raw[src + x];
            const a = x >= bpp ? out[row + x - bpp] : 0; // left
            const b = y > 0 ? out[prev + x] : 0; // above
            const c = (x >= bpp && y > 0) ? out[prev + x - bpp] : 0; // upper-left
            let r;
            switch (ft) {
                case 0:
                    r = v;
                    break;
                case 1:
                    r = v + a;
                    break;
                case 2:
                    r = v + b;
                    break;
                case 3:
                    r = v + ((a + b) >> 1);
                    break;
                case 4: {
                    // Paeth: pick whichever neighbour the gradient predictor is nearest.
                    const p = a + b - c;
                    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                    r = v + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c));
                    break;
                }
                default: return null; // unknown filter: give up
            }
            out[row + x] = r & 0xff;
        }
        src += stride;
    }
    return out;
}
/** Decode a CgBI PNG to straight RGBA, or null if it isn't one / can't be read.
    Async because the inflate goes through DecompressionStream. */
export async function decodeCgbiPng(b) {
    if (!isCgbiPng(b))
        return null;
    let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
    const idat = [];
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    for (const c of chunks(b)) {
        if (c.type === 'IHDR' && c.length >= 13) {
            width = dv.getUint32(c.start, false);
            height = dv.getUint32(c.start + 4, false);
            bitDepth = b[c.start + 8];
            colorType = b[c.start + 9];
            interlace = b[c.start + 12];
        }
        else if (c.type === 'IDAT') {
            idat.push(b.subarray(c.start, c.start + c.length));
        }
    }
    if (!width || !height || !idat.length)
        return null;
    if (bitDepth !== 8 || interlace !== 0)
        return null;
    // Xcode emits colour type 6 (RGBA); 2 (RGB) appears for fully opaque assets.
    const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
    if (!bpp)
        return null;
    if (width * height > 64_000_000)
        return null;
    // Concatenate the IDATs and inflate as RAW deflate - the zlib wrapper Apple
    // stripped is exactly why a normal PNG decoder refuses these.
    let total = 0;
    for (const d of idat)
        total += d.length;
    const stream = new Uint8Array(total);
    let off = 0;
    for (const d of idat) {
        stream.set(d, off);
        off += d.length;
    }
    let raw;
    try {
        raw = await inflate(stream, 'deflate-raw');
    }
    catch (_) {
        return null;
    }
    if (!raw)
        return null;
    const px = unfilter(raw, width, height, bpp);
    if (!px)
        return null;
    // BGRA premultiplied -> straight RGBA.
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0, n = width * height; i < n; i++) {
        const s = i * bpp, d = i * 4;
        if (bpp === 4) {
            const a = px[s + 3];
            if (a === 0) {
                rgba[d] = rgba[d + 1] = rgba[d + 2] = rgba[d + 3] = 0;
                continue;
            }
            // Channels are stored B,G,R,A and scaled by alpha; divide it back out.
            rgba[d] = Math.min(255, Math.round(px[s + 2] * 255 / a));
            rgba[d + 1] = Math.min(255, Math.round(px[s + 1] * 255 / a));
            rgba[d + 2] = Math.min(255, Math.round(px[s] * 255 / a));
            rgba[d + 3] = a;
        }
        else {
            rgba[d] = px[s + 2];
            rgba[d + 1] = px[s + 1];
            rgba[d + 2] = px[s];
            rgba[d + 3] = 255;
        }
    }
    return { width, height, rgba };
}
/** Repair a CgBI PNG into a standard PNG Blob the browser will display, or null
    if the bytes aren't a CgBI PNG. Re-encoded through a canvas, so the result is
    a genuine PNG rather than a patched one. */
export async function cgbiToPngBlob(b) {
    const img = await decodeCgbiPng(b);
    if (!img)
        return null;
    try {
        const cv = document.createElement('canvas');
        cv.width = img.width;
        cv.height = img.height;
        const data = new Uint8ClampedArray(img.rgba.buffer, img.rgba.byteOffset, img.rgba.length);
        cv.getContext('2d').putImageData(new ImageData(data, img.width, img.height), 0, 0);
        return await new Promise((res) => cv.toBlob((blob) => res(blob), 'image/png'));
    }
    catch (_) {
        return null;
    }
}
//# sourceMappingURL=cgbi.js.map