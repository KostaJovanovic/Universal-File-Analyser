/* Analyser - GIF frame decoder (lazy)
   A browser plays an animated GIF in an <img>, but won't let you step through it
   frame by frame. So - exactly like the AVI viewer does for MJPEG - we decode the
   GIF ourselves: parse the blocks, LZW-decompress each image, and composite it
   onto a persistent canvas honouring the per-frame disposal method, transparency
   and interlacing.

   Rather than materialise every composited RGBA frame up front (an 800x800 x 375
   GIF would hold ~960 MB of pixels alive at once), we parse only the frame TABLE
   eagerly (per-frame headers + the still-compressed LZW bytes - cheap) and composite
   each frame ON DEMAND. get(idx) replays forward from the nearest cached keyframe
   snapshot into a bounded LRU, so backward-scrub stays cheap and only a budget's
   worth of decoded pixels is ever retained. This is what lets a large GIF play in
   full instead of being truncated. Pure logic - no DOM, no cross-module deps. */
// GIF LZW decompressor (the standard prefix/suffix/stack variant). Decodes the
// concatenated image sub-blocks `data` into `output` (palette indices), filling
// exactly `npix` pixels. Adapted from the well-known omggif algorithm.
function lzwDecode(minCodeSize, data, output, npix) {
    const MAX = 4096;
    const nullCode = -1;
    const prefix = new Int16Array(MAX);
    const suffix = new Int16Array(MAX);
    const pixelStack = new Uint8Array(MAX + 1);
    const dataSize = minCodeSize;
    const clear = 1 << dataSize;
    const eoi = clear + 1;
    let available = clear + 2;
    let oldCode = nullCode;
    let codeSize = dataSize + 1;
    let codeMask = (1 << codeSize) - 1;
    for (let code = 0; code < clear; code++) {
        prefix[code] = 0;
        suffix[code] = code;
    }
    let datum = 0, bits = 0, first = 0, top = 0, bi = 0, pi = 0, i = 0;
    for (i = 0; i < npix;) {
        if (top === 0) {
            if (bits < codeSize) {
                if (bi >= data.length)
                    break;
                datum += data[bi] << bits;
                bits += 8;
                bi++;
                continue;
            }
            let code = datum & codeMask;
            datum >>= codeSize;
            bits -= codeSize;
            if (code > available || code === eoi)
                break;
            if (code === clear) {
                codeSize = dataSize + 1;
                codeMask = (1 << codeSize) - 1;
                available = clear + 2;
                oldCode = nullCode;
                continue;
            }
            if (oldCode === nullCode) {
                pixelStack[top++] = suffix[code];
                oldCode = code;
                first = code;
                continue;
            }
            const inCode = code;
            if (code === available) {
                pixelStack[top++] = first;
                code = oldCode;
            }
            while (code > clear) {
                pixelStack[top++] = suffix[code];
                code = prefix[code];
            }
            first = suffix[code] & 0xff;
            pixelStack[top++] = first;
            if (available < MAX) {
                prefix[available] = oldCode;
                suffix[available] = first;
                available++;
                if ((available & codeMask) === 0 && available < MAX) {
                    codeSize++;
                    codeMask += available;
                }
            }
            oldCode = inCode;
        }
        top--;
        output[pi++] = pixelStack[top];
        i++;
    }
    for (; pi < npix; pi++)
        output[pi] = 0;
}
function readPalette(bytes, off, count) {
    const pal = new Array(count);
    for (let i = 0; i < count; i++) {
        const o = off + i * 3;
        pal[i] = [bytes[o], bytes[o + 1], bytes[o + 2]];
    }
    return pal;
}
// Storage-order -> actual-row map for the four GIF interlace passes.
function interlaceRows(ih) {
    const rows = new Int32Array(ih);
    let n = 0;
    for (let y = 0; y < ih; y += 8)
        rows[n++] = y;
    for (let y = 4; y < ih; y += 8)
        rows[n++] = y;
    for (let y = 2; y < ih; y += 4)
        rows[n++] = y;
    for (let y = 1; y < ih; y += 2)
        rows[n++] = y;
    return rows;
}
// Composite one decoded sub-image (palette indices) onto the persistent RGBA
// canvas at (ix,iy), skipping the transparent index and clipping to bounds.
function drawFrame(canvas, W, H, indices, palette, ix, iy, iw, ih, interlace, transIdx) {
    const rows = interlace ? interlaceRows(ih) : null;
    for (let r = 0; r < ih; r++) {
        const y = iy + (rows ? rows[r] : r);
        if (y < 0 || y >= H)
            continue;
        const rowBase = r * iw;
        for (let c = 0; c < iw; c++) {
            const x = ix + c;
            if (x < 0 || x >= W)
                continue;
            const idx = indices[rowBase + c];
            if (idx === transIdx)
                continue;
            const p = palette[idx];
            if (!p)
                continue;
            const o = (y * W + x) * 4;
            canvas[o] = p[0];
            canvas[o + 1] = p[1];
            canvas[o + 2] = p[2];
            canvas[o + 3] = 255;
        }
    }
}
// Clear a rectangle back to fully-transparent (disposal method 2).
function clearRect(canvas, W, H, ix, iy, iw, ih) {
    for (let y = iy; y < iy + ih; y++) {
        if (y < 0 || y >= H)
            continue;
        for (let x = ix; x < ix + iw; x++) {
            if (x < 0 || x >= W)
                continue;
            const o = (y * W + x) * 4;
            canvas[o] = canvas[o + 1] = canvas[o + 2] = canvas[o + 3] = 0;
        }
    }
}
// Parse an animated GIF into a lazy frame SOURCE. Eagerly reads only the frame
// table (headers + still-compressed LZW bytes per frame); frames are composited
// on demand by get(idx). Returns
//   { width, height, count, loop, anyTransparency, delaysMs:number[]/*ms*/,
//     get(idx) -> Promise<Uint8ClampedArray /*RGBA*/>, close() }
// or null if the bytes aren't a GIF. `budget` is the retained decoded-pixel cache
// window (width*height*frames): the LRU keeps at most floor(budget/(w*h)) frames.
export function decodeGifFrames(buffer, budget = 120e6) {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 13 || bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46)
        return null;
    const dv = new DataView(buffer);
    const width = dv.getUint16(6, true);
    const height = dv.getUint16(8, true);
    if (!width || !height)
        return null;
    const packed = bytes[10];
    const gctSize = (packed & 0x80) ? (2 << (packed & 0x07)) : 0;
    let pos = 13;
    let gct = null;
    if (gctSize) {
        gct = readPalette(bytes, pos, gctSize);
        pos += gctSize * 3;
    }
    // Frame table: one lightweight record per frame (no pixels decoded yet).
    const table = [];
    let gce = { delay: 0, transparentIndex: -1, disposal: 0 };
    let loop = null;
    let anyTransparency = false;
    while (pos < bytes.length) {
        const b = bytes[pos];
        if (b === 0x3B)
            break; // trailer
        if (b === 0x21) { // extension
            const label = bytes[pos + 1];
            if (label === 0xF9) { // graphic control
                const p = bytes[pos + 3];
                gce.disposal = (p >> 2) & 0x07;
                gce.delay = dv.getUint16(pos + 4, true); // centiseconds
                gce.transparentIndex = (p & 0x01) ? bytes[pos + 6] : -1;
                pos += 8;
            }
            else {
                if (label === 0xFF && pos + 16 <= bytes.length
                    && String.fromCharCode(bytes[pos + 3], bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7], bytes[pos + 8], bytes[pos + 9], bytes[pos + 10]) === 'NETSCAPE') {
                    loop = dv.getUint16(pos + 16, true);
                }
                pos += 2;
                while (pos < bytes.length && bytes[pos] !== 0)
                    pos += bytes[pos] + 1;
                pos++;
            }
            continue;
        }
        if (b === 0x2C) { // image descriptor
            const ix = dv.getUint16(pos + 1, true);
            const iy = dv.getUint16(pos + 3, true);
            const iw = dv.getUint16(pos + 5, true);
            const ih = dv.getUint16(pos + 7, true);
            const ip = bytes[pos + 9];
            const interlace = (ip & 0x40) !== 0;
            const lctSize = (ip & 0x80) ? (2 << (ip & 0x07)) : 0;
            pos += 10;
            let palette = gct;
            if (lctSize) {
                palette = readPalette(bytes, pos, lctSize);
                pos += lctSize * 3;
            }
            if (!palette)
                palette = [];
            const minCodeSize = bytes[pos];
            pos++;
            // Concatenate the LZW data sub-blocks (still compressed - decoded lazily).
            let dataLen = 0, scan = pos;
            while (scan < bytes.length && bytes[scan] !== 0) {
                dataLen += bytes[scan];
                scan += bytes[scan] + 1;
            }
            const lzwData = new Uint8Array(dataLen);
            let dpos = 0;
            scan = pos;
            while (scan < bytes.length && bytes[scan] !== 0) {
                const n = bytes[scan];
                scan++;
                lzwData.set(bytes.subarray(scan, scan + n), dpos);
                dpos += n;
                scan += n;
            }
            pos = scan + 1; // skip block terminator
            table.push({ ix, iy, iw, ih, interlace, disposal: gce.disposal, delay: gce.delay,
                transIdx: gce.transparentIndex, minCodeSize, lzwData, palette });
            if (gce.transparentIndex >= 0)
                anyTransparency = true;
            gce = { delay: 0, transparentIndex: -1, disposal: 0 };
            continue;
        }
        pos++; // unknown byte - skip
    }
    const count = table.length;
    if (!count)
        return null;
    // ---- lazy compositing engine ----
    const px = width * height;
    const stride = px * 4;
    const L = Math.max(8, Math.floor(budget / px)); // max frames retained in the LRU
    const K = Math.max(8, Math.ceil(count / 32)); // keyframe interval (<= ~32 snapshots)
    const lru = new Map(); // idx -> RGBA (insertion order = LRU)
    const entry = new Map(); // keyframe idx -> canvas ENTERING that frame
    entry.set(0, new Uint8ClampedArray(stride)); // frame 0 starts fully transparent
    const lruPut = (idx, data) => {
        if (lru.has(idx))
            lru.delete(idx);
        lru.set(idx, data);
        if (lru.size > L)
            lru.delete(lru.keys().next().value); // evict oldest
    };
    // Composite frame `idx`, replaying forward from the nearest keyframe. Caches every
    // frame produced along the way plus keyframe snapshots at each K boundary.
    const compose = (idx) => {
        if (lru.has(idx)) {
            const d = lru.get(idx);
            lru.delete(idx);
            lru.set(idx, d);
            return d;
        }
        let s = Math.floor(idx / K) * K;
        while (!entry.has(s))
            s -= K; // 0 is always present
        let canvas = new Uint8ClampedArray(entry.get(s)); // canvas entering frame s
        let result = null;
        for (let k = s; k <= idx; k++) {
            if (k % K === 0 && !entry.has(k))
                entry.set(k, new Uint8ClampedArray(canvas));
            const fr = table[k];
            // disposal 3 ("restore to previous") needs the canvas as it was before drawing.
            const before = fr.disposal === 3 ? new Uint8ClampedArray(canvas) : null;
            const indices = new Uint8Array(fr.iw * fr.ih);
            lzwDecode(fr.minCodeSize, fr.lzwData, indices, fr.iw * fr.ih);
            drawFrame(canvas, width, height, indices, fr.palette, fr.ix, fr.iy, fr.iw, fr.ih, fr.interlace, fr.transIdx);
            const out = new Uint8ClampedArray(canvas); // output = canvas AFTER drawing k
            lruPut(k, out);
            if (k === idx)
                result = out;
            // Apply disposal so the NEXT frame starts from the right canvas.
            if (fr.disposal === 2)
                clearRect(canvas, width, height, fr.ix, fr.iy, fr.iw, fr.ih);
            else if (fr.disposal === 3 && before)
                canvas = before;
        }
        return result;
    };
    const clamp = (i) => Math.max(0, Math.min(count - 1, i | 0));
    const delaysMs = table.map((f) => { const ms = f.delay * 10; return ms < 20 ? 100 : ms; });
    return {
        width, height, count, loop, anyTransparency, delaysMs,
        get: (idx) => Promise.resolve(compose(clamp(idx))),
        close() { lru.clear(); entry.clear(); },
    };
}
//# sourceMappingURL=gif-frames.js.map