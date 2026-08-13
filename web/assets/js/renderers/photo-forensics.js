/* Analyser - photo pixel/JPEG forensics.
   Self-contained detectors that work on the decoded pixels or the raw JPEG bytes,
   with no network and no WASM:
     - computeElaCanvas: Error-Level Analysis. Re-encodes the image as JPEG at a
       known quality, then amplifies the per-pixel difference from the original.
       A single JPEG save leaves a fairly uniform error field; a region pasted in
       from a differently-compressed source (or freshly painted) sits at a
       different error level and stands out.
   The heavy lifting is plain canvas + typed-array maths; callers build the card
   chrome (headings, sliders, lightbox) so this module stays UI-free and reusable. */
import { md5Hex } from '../core/util.js';
// Draw an image (or canvas) onto a fresh 2D context at a bounded size. Returns
// { canvas, ctx, w, h } or null when the source has no dimensions.
function drawBounded(src, maxDim) {
    const nw = src.naturalWidth || src.width, nh = src.naturalHeight || src.height;
    if (!nw || !nh)
        return null;
    let w = nw, h = nh;
    if (maxDim && Math.max(w, h) > maxDim) {
        const s = maxDim / Math.max(w, h);
        w = Math.max(1, Math.round(w * s));
        h = Math.max(1, Math.round(h * s));
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, w, h);
    return { canvas, ctx, w, h };
}
// ---------- LSB chi-square steganalysis ----------
// Westfeld-Pfitzmann chi-square attack on LSB replacement. Sequential LSB
// embedding equalises each "pair of values" (2k, 2k+1) in the histogram; the test
// measures how close each channel's histogram is to that fully-embedded
// expectation. Returns per-channel embedding probability (0..1) and the max, or
// null when the image is too small/flat to judge. Detects LSB *replacement*
// (the classic case); it does not flag LSB matching or transform-domain hiding.
function gammln(xx) {
    const cof = [76.18009172947146, -86.50532032941677, 24.01409824083091,
        -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let x = xx, y = xx, tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (let j = 0; j < 6; j++) {
        y++;
        ser += cof[j] / y;
    }
    return -tmp + Math.log(2.5066282746310005 * ser / x);
}
function gser(a, x) {
    if (x <= 0)
        return 0;
    const gln = gammln(a);
    let ap = a, sum = 1 / a, del = sum;
    for (let n = 0; n < 300; n++) {
        ap++;
        del *= x / ap;
        sum += del;
        if (Math.abs(del) < Math.abs(sum) * 1e-12)
            break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - gln);
}
function gcf(a, x) {
    const FPMIN = 1e-300, gln = gammln(a);
    let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
    for (let i = 1; i <= 300; i++) {
        const an = -i * (i - a);
        b += 2;
        d = an * d + b;
        if (Math.abs(d) < FPMIN)
            d = FPMIN;
        c = b + an / c;
        if (Math.abs(c) < FPMIN)
            c = FPMIN;
        d = 1 / d;
        const del = d * c;
        h *= del;
        if (Math.abs(del - 1) < 1e-12)
            break;
    }
    return Math.exp(-x + a * Math.log(x) - gln) * h;
}
// Regularised lower incomplete gamma P(a,x) = chi-square CDF at 2x with 2a d.o.f.
function gammp(a, x) { if (x < 0 || a <= 0)
    return 0; return x < a + 1 ? gser(a, x) : 1 - gcf(a, x); }
function channelEmbedProb(hist) {
    let chi = 0, df = 0;
    for (let k = 0; k < 128; k++) {
        const a = hist[2 * k], b = hist[2 * k + 1];
        const exp = (a + b) / 2;
        if (exp < 5)
            continue; // chi-square validity: skip sparse pairs
        chi += ((a - exp) * (a - exp)) / exp;
        df++;
    }
    if (df < 8)
        return null; // too few populated pairs to trust
    return 1 - gammp((df - 1) / 2, chi / 2); // p(embedding): small chi -> near 1
}
export function lsbChiSquare(src, { maxDim = 1024 } = {}) {
    const base = drawBounded(src, maxDim);
    if (!base)
        return null;
    const { ctx, w, h } = base;
    const d = ctx.getImageData(0, 0, w, h).data;
    const hr = new Float64Array(256), hg = new Float64Array(256), hb = new Float64Array(256);
    for (let i = 0; i < d.length; i += 4) {
        hr[d[i]]++;
        hg[d[i + 1]]++;
        hb[d[i + 2]]++;
    }
    const R = channelEmbedProb(hr), G = channelEmbedProb(hg), B = channelEmbedProb(hb);
    const vals = [R, G, B].filter((v) => v != null);
    if (!vals.length)
        return null;
    return { R, G, B, max: Math.max(...vals) };
}
function loadImage(url) {
    return new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = url;
    });
}
// Error-Level Analysis. `src` is a decoded HTMLImageElement/canvas/ImageBitmap.
// - quality: the JPEG quality to recompress at (0..1). ~0.90 is the usual choice.
// - amplify: gain applied to the absolute difference so faint errors are visible.
// - maxDim: cap the working resolution so very large images stay responsive.
// Returns an HTMLCanvasElement holding the amplified error map, or null on failure.
export async function computeElaCanvas(src, { quality = 0.9, amplify = 18, maxDim = 1600 } = {}) {
    const base = drawBounded(src, maxDim);
    if (!base)
        return null;
    const { canvas, ctx, w, h } = base;
    const orig = ctx.getImageData(0, 0, w, h);
    // Recompress this exact raster as JPEG and read it back.
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob)
        return null;
    const url = URL.createObjectURL(blob);
    let recImg;
    try {
        recImg = await new Promise((res, rej) => {
            const im = new Image();
            im.onload = () => res(im);
            im.onerror = rej;
            im.src = url;
        });
    }
    catch (_) {
        URL.revokeObjectURL(url);
        return null;
    }
    const rc = document.createElement('canvas');
    rc.width = w;
    rc.height = h;
    const rctx = rc.getContext('2d', { willReadFrequently: true });
    rctx.drawImage(recImg, 0, 0, w, h);
    URL.revokeObjectURL(url);
    const rec = rctx.getImageData(0, 0, w, h);
    const o = orig.data, r = rec.data;
    const out = rctx.createImageData(w, h);
    const d = out.data;
    let maxErr = 0, sumErr = 0, n = 0;
    for (let i = 0; i < o.length; i += 4) {
        const dr = Math.abs(o[i] - r[i]);
        const dg = Math.abs(o[i + 1] - r[i + 1]);
        const db = Math.abs(o[i + 2] - r[i + 2]);
        const er = Math.min(255, dr * amplify);
        const eg = Math.min(255, dg * amplify);
        const eb = Math.min(255, db * amplify);
        d[i] = er;
        d[i + 1] = eg;
        d[i + 2] = eb;
        d[i + 3] = 255;
        const m = (dr + dg + db) / 3;
        if (m > maxErr)
            maxErr = m;
        sumErr += m;
        n++;
    }
    const outCanvas = document.createElement('canvas');
    outCanvas.width = w;
    outCanvas.height = h;
    outCanvas.getContext('2d').putImageData(out, 0, 0);
    outCanvas._elaStats = { maxErr, meanErr: n ? sumErr / n : 0, w, h };
    return outCanvas;
}
// ---------- JPEG quantization-table fingerprint ----------
// The DQT segments carry the 8x8 quantization tables the encoder used. Their
// values fingerprint the encoder and let us recover the effective quality: camera
// firmware ships its own bespoke tables, whereas most software (libjpeg/IJG-based
// editors, "Save for Web", browsers) uses the standard Annex-K tables scaled by a
// quality slider. So a photo that claims a camera in EXIF but carries exact
// standard tables has almost certainly been re-saved by software.
// Zig-zag scan order: natural8x8[ZIGZAG[k]] = stored[k].
const ZIGZAG = [
    0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
    12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];
// Standard JPEG (Annex K) luminance and chrominance tables, natural (row-major).
const STD_LUMA = [
    16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55,
    14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
    49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const STD_CHROMA = [
    17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99,
    24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
];
function ijgScale(q) { q = Math.max(1, Math.min(100, Math.round(q))); return q < 50 ? Math.floor(5000 / q) : 200 - q * 2; }
function ijgTable(std, q) {
    const s = ijgScale(q);
    return std.map((v) => Math.max(1, Math.min(255, Math.floor((v * s + 50) / 100))));
}
function tableDiff(a, b) { let d = 0; for (let i = 0; i < 64; i++)
    d += Math.abs(a[i] - b[i]); return d; }
// Best-fit IJG quality for an observed table against a given standard table.
// Returns { quality, diff } where diff 0 means an exact standard-table match.
function bestQuality(observed, std) {
    let best = 1, bestD = Infinity;
    for (let q = 1; q <= 100; q++) {
        const d = tableDiff(observed, ijgTable(std, q));
        if (d < bestD) {
            bestD = d;
            best = q;
        }
    }
    return { quality: best, diff: bestD };
}
// Parse every DQT table in a JPEG. Returns [{ id, precision, table (64 natural) }]
// or [] when the bytes are not a JPEG / carry no tables.
export function parseJpegQuantTables(bytes) {
    if (!bytes || bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8)
        return [];
    const n = bytes.length;
    const out = [];
    let p = 2;
    while (p + 4 <= n) {
        if (bytes[p] !== 0xFF) {
            p++;
            continue;
        }
        let marker = bytes[p + 1];
        while (marker === 0xFF && p + 1 < n) {
            p++;
            marker = bytes[p + 1];
        }
        if (marker === 0xD9 || marker === 0xDA)
            break; // EOI / start of scan
        if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
            p += 2;
            continue;
        }
        if (p + 4 > n)
            break;
        const len = (bytes[p + 2] << 8) | bytes[p + 3];
        if (len < 2)
            break;
        const segEnd = Math.min(n, p + 2 + len);
        if (marker === 0xDB) { // DQT
            let c = p + 4;
            while (c < segEnd) {
                const pqTq = bytes[c++];
                const pq = pqTq >> 4, tq = pqTq & 0x0F; // precision, table id
                const bytesPer = pq ? 2 : 1;
                if (c + 64 * bytesPer > segEnd)
                    break;
                const natural = new Array(64);
                for (let k = 0; k < 64; k++) {
                    const v = pq ? ((bytes[c] << 8) | bytes[c + 1]) : bytes[c];
                    c += bytesPer;
                    natural[ZIGZAG[k]] = v;
                }
                out.push({ id: tq, precision: pq ? 16 : 8, table: natural });
            }
        }
        p += 2 + len;
    }
    return out;
}
// Full analysis for the card. Returns null when there are no tables to fingerprint.
export function analyzeJpegQuantization(bytes) {
    const tables = parseJpegQuantTables(bytes);
    if (!tables.length)
        return null;
    const luma = tables.find((t) => t.id === 0) || tables[0];
    const chroma = tables.find((t) => t.id === 1);
    const lq = bestQuality(luma.table, STD_LUMA);
    const cq = chroma ? bestQuality(chroma.table, STD_CHROMA) : null;
    // "Standard" when the observed tables sit within rounding noise of the scaled
    // Annex-K tables. Cameras almost always deviate; software almost never does.
    const lumaStd = lq.diff <= 2;
    const chromaStd = cq ? cq.diff <= 2 : true;
    const isStandard = lumaStd && chromaStd;
    return {
        tables, luma, chroma,
        lumaQuality: lq.quality, lumaDiff: lq.diff,
        chromaQuality: cq ? cq.quality : null, chromaDiff: cq ? cq.diff : null,
        isStandard,
    };
}
// ---------- JPEG ghosts ----------
// Recompress the image across a sweep of qualities; at each, average the squared
// per-pixel difference into blocks. A region that was previously compressed at
// quality q settles to a local minimum (a dark "ghost") in the map recompressed
// near q, while its surroundings do not - revealing content spliced in from a
// differently-compressed source. Returns [{ quality, canvas (block-res grayscale) }]
// normalised across the whole set so the maps are directly comparable, or null.
export async function computeJpegGhosts(src, { qualities, maxDim = 1024, block = 4 } = {}) {
    qualities = qualities || [40, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95];
    const base = drawBounded(src, maxDim);
    if (!base)
        return null;
    const { canvas, w, h } = base;
    const orig = base.ctx.getImageData(0, 0, w, h).data;
    const bw = Math.ceil(w / block), bh = Math.ceil(h / block);
    const maps = [];
    for (const q of qualities) {
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q / 100));
        if (!blob)
            continue;
        const url = URL.createObjectURL(blob);
        let im;
        try {
            im = await loadImage(url);
        }
        catch (_) {
            URL.revokeObjectURL(url);
            continue;
        }
        const rc = document.createElement('canvas');
        rc.width = w;
        rc.height = h;
        const rctx = rc.getContext('2d', { willReadFrequently: true });
        rctx.drawImage(im, 0, 0, w, h);
        URL.revokeObjectURL(url);
        const rec = rctx.getImageData(0, 0, w, h).data;
        const acc = new Float32Array(bw * bh), cnt = new Float32Array(bw * bh);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                const dr = orig[i] - rec[i], dg = orig[i + 1] - rec[i + 1], db = orig[i + 2] - rec[i + 2];
                const bi = Math.floor(y / block) * bw + Math.floor(x / block);
                acc[bi] += (dr * dr + dg * dg + db * db) / 3;
                cnt[bi]++;
            }
        }
        for (let k = 0; k < acc.length; k++)
            acc[k] = cnt[k] ? acc[k] / cnt[k] : 0;
        maps.push({ q, data: acc });
    }
    if (!maps.length)
        return null;
    let mn = Infinity, mx = -Infinity;
    for (const m of maps)
        for (const v of m.data) {
            if (v < mn)
                mn = v;
            if (v > mx)
                mx = v;
        }
    const rng = (mx - mn) || 1;
    // Render each map at the FULL base resolution (w x h), not the block-reduced
    // bw x bh grid, so the ghost maps are crisp and comparable in size to ELA.
    // Block-averaging (above) still smooths the per-pixel noise; here we just
    // expand each block value back across its pixels.
    return maps.map((m) => {
        const cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
        const ctx = cv.getContext('2d');
        const id = ctx.createImageData(w, h);
        for (let y = 0; y < h; y++) {
            const brow = Math.floor(y / block) * bw;
            for (let x = 0; x < w; x++) {
                const g = Math.round(((m.data[brow + Math.floor(x / block)] - mn) / rng) * 255);
                const i = (y * w + x) * 4;
                id.data[i] = g;
                id.data[i + 1] = g;
                id.data[i + 2] = g;
                id.data[i + 3] = 255;
            }
        }
        ctx.putImageData(id, 0, 0);
        return { quality: m.q, canvas: cv };
    });
}
// ---------- XMP edit history + Photoshop IPTC-digest check ----------
function extractXmpText(bytes) {
    const open = '<x:xmpmeta';
    // Byte scan for the packet start/end (the XMP may sit in any APPn / iTXt).
    const find = (needle, from) => {
        outer: for (let i = from; i <= bytes.length - needle.length; i++) {
            for (let j = 0; j < needle.length; j++)
                if (bytes[i + j] !== needle.charCodeAt(j))
                    continue outer;
            return i;
        }
        return -1;
    };
    const s = find(open, 0);
    if (s < 0)
        return null;
    const e = find('</x:xmpmeta>', s);
    const end = e < 0 ? Math.min(bytes.length, s + 200000) : e + 12;
    let out = '';
    for (let i = s; i < end; i++)
        out += String.fromCharCode(bytes[i]);
    return out;
}
function xmlDecode(str) {
    return str.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&');
}
// Parse xmpMM:History (Lightroom/Photoshop edit log) plus a few provenance ids.
export function parseXmpHistory(bytes) {
    const xmp = extractXmpText(bytes);
    if (!xmp)
        return null;
    const history = [];
    const hm = xmp.match(/History>([\s\S]*?)<\/[^>]*History>/);
    if (hm) {
        const items = hm[1].split(/<rdf:li/).slice(1);
        for (const it of items) {
            const g = (name) => {
                let m = it.match(new RegExp('stEvt:' + name + '="([^"]*)"'));
                if (m)
                    return xmlDecode(m[1]);
                m = it.match(new RegExp('<stEvt:' + name + '>([\\s\\S]*?)</stEvt:' + name + '>'));
                return m ? xmlDecode(m[1].trim()) : '';
            };
            const action = g('action');
            const soft = g('softwareAgent'), when = g('when');
            if (!action && !soft && !when)
                continue;
            history.push({ action, when, softwareAgent: soft, changed: g('changed'), params: g('parameters') });
        }
    }
    const one = (re) => { const m = xmp.match(re); return m ? xmlDecode(m[1].trim()) : ''; };
    return {
        history,
        creatorTool: one(/xmp:CreatorTool>([\s\S]*?)</) || one(/xmp:CreatorTool="([^"]*)"/),
        documentId: one(/xmpMM:DocumentID>([\s\S]*?)</) || one(/xmpMM:DocumentID="([^"]*)"/),
        instanceId: one(/xmpMM:InstanceID>([\s\S]*?)</) || one(/xmpMM:InstanceID="([^"]*)"/),
    };
}
function startsWithAscii(bytes, off, s) {
    for (let i = 0; i < s.length; i++)
        if (bytes[off + i] !== s.charCodeAt(i))
            return false;
    return true;
}
// Photoshop stores an MD5 of the IPTC (8BIM resource 0x0404) in resource 0x0425.
// If the two disagree, the IPTC metadata was changed after Photoshop last wrote it.
// Returns { hasDigest, match, stored, computed } or null when there's nothing to check.
export function checkIptcDigest(bytes) {
    if (!(bytes[0] === 0xFF && bytes[1] === 0xD8))
        return null;
    const n = bytes.length;
    let irb = null, p = 2;
    while (p + 4 <= n) {
        if (bytes[p] !== 0xFF)
            break;
        let marker = bytes[p + 1];
        if (marker === 0xDA || marker === 0xD9)
            break;
        if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
            p += 2;
            continue;
        }
        const len = (bytes[p + 2] << 8) | bytes[p + 3];
        if (marker === 0xED && startsWithAscii(bytes, p + 4, 'Photoshop 3.0\0')) {
            irb = { start: p + 4 + 14, end: p + 2 + len }; // past the "Photoshop 3.0\0" id
            break;
        }
        p += 2 + len;
    }
    if (!irb)
        return null;
    let iptcData = null, storedDigest = null, c = irb.start;
    while (c + 12 <= irb.end) {
        if (!startsWithAscii(bytes, c, '8BIM'))
            break;
        const id = (bytes[c + 4] << 8) | bytes[c + 5];
        let q = c + 6;
        const nameLen = bytes[q]; // Pascal name, padded to even (incl. length byte)
        q += 1 + nameLen;
        if ((1 + nameLen) % 2)
            q += 1;
        const dataLen = (bytes[q] << 24 | bytes[q + 1] << 16 | bytes[q + 2] << 8 | bytes[q + 3]) >>> 0;
        q += 4;
        const dataStart = q, dataEnd = q + dataLen;
        if (id === 0x0404)
            iptcData = bytes.subarray(dataStart, dataEnd);
        else if (id === 0x0425)
            storedDigest = bytes.subarray(dataStart, dataStart + 16);
        c = dataEnd + (dataLen % 2); // data padded to even
    }
    if (!storedDigest || storedDigest.length < 16)
        return null;
    const storedHex = [...storedDigest].map((x) => x.toString(16).padStart(2, '0')).join('');
    const computed = iptcData ? md5Hex(iptcData) : null;
    return { hasDigest: true, stored: storedHex, computed, match: computed != null && computed === storedHex };
}
//# sourceMappingURL=photo-forensics.js.map