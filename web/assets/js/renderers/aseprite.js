/* Analyser - Aseprite / LibreSprite sprite viewer (.aseprite, .ase)

   Aseprite files are layered, animated pixel art: a header, then one chunked
   frame per animation frame. Every frame carries only the cels (per-layer image
   rectangles) that CHANGED, so a frame is not a picture - it has to be
   composited from the layer stack, and a cel may be "linked", meaning "reuse the
   one from frame N". That is why a file with 40 frames can be a few KB.

   What this draws: the composited frame on a canvas, a transport that plays at
   each frame's own duration (they are per-frame, not a global fps), the layer
   tree with blend mode and opacity, and the animation tags with their loop
   direction. Pixels are decoded here in pure JS - the cel image data is plain
   zlib, which DecompressionStream handles natively.

   Note the extension collision: `.ase` is ALSO Adobe Swatch Exchange, which is
   an unrelated palette format. detectVariant() in core/formats.ts tells them
   apart by magic before routing here, so this module can assume Aseprite. */
import { el, row, fmtBytes, h3help, downloadBlob, inlineLoader } from '../core/util.js';
import { Reader, inflate } from '../core/binutil.js';
import { PREVIEW_EDGE } from '../core/limits.js';
const MAGIC = 0xA5E0;
const FRAME_MAGIC = 0xF1FA;
const DEPTH_NAME = {
    32: 'RGBA (32 bits per pixel)',
    16: 'Grayscale (16 bits per pixel)',
    8: 'Indexed (8 bits per pixel)',
};
// Aseprite's blend modes, in file order. The four non-separable ones (hue,
// saturation, colour, luminosity) operate on whole-pixel HSL rather than per
// channel; they are named here but composited as Normal, and the layer row says
// so rather than drawing something subtly wrong.
const BLEND_NAME = [
    'Normal', 'Multiply', 'Screen', 'Overlay', 'Darken', 'Lighten', 'Colour dodge',
    'Colour burn', 'Hard light', 'Soft light', 'Difference', 'Exclusion',
    'Hue', 'Saturation', 'Colour', 'Luminosity', 'Addition', 'Subtract', 'Divide',
];
const NON_SEPARABLE = new Set([12, 13, 14, 15]);
const LOOP_NAME = ['Forward', 'Reverse', 'Ping-pong', 'Ping-pong reverse'];
// A length-prefixed UTF-8 string: WORD length, then the bytes.
function aseString(r) {
    const n = r.u16();
    const bytes = r.bytes_(n);
    try {
        return new TextDecoder().decode(bytes);
    }
    catch (_) {
        return '';
    }
}
// One cel's pixels -> RGBA, using the document's colour depth and palette.
function celToRgba(px, w, h, doc) {
    const n = w * h;
    const out = new Uint8ClampedArray(n * 4);
    if (doc.depth === 32) {
        if (px.length < n * 4)
            return null;
        out.set(px.subarray(0, n * 4));
    }
    else if (doc.depth === 16) {
        // Grayscale: value + alpha per pixel.
        if (px.length < n * 2)
            return null;
        for (let i = 0; i < n; i++) {
            const v = px[i * 2], a = px[i * 2 + 1], d = i * 4;
            out[d] = out[d + 1] = out[d + 2] = v;
            out[d + 3] = a;
        }
    }
    else {
        // Indexed: look the entry up, and treat the transparent index as clear.
        if (px.length < n)
            return null;
        for (let i = 0; i < n; i++) {
            const idx = px[i], d = i * 4;
            if (idx === doc.transparentIndex) {
                out[d + 3] = 0;
                continue;
            }
            const p = idx * 4;
            out[d] = doc.palette[p];
            out[d + 1] = doc.palette[p + 1];
            out[d + 2] = doc.palette[p + 2];
            out[d + 3] = doc.palette[p + 3];
        }
    }
    return out;
}
/** Parse a whole .aseprite file into layers, frames (with decoded cels) and
    tags. Returns null if the bytes aren't an Aseprite sprite. */
export async function parseAseprite(bytes) {
    const r = new Reader(bytes, true);
    r.u32(); // declared file size
    if (r.u16() !== MAGIC)
        return null;
    const frameCount = r.u16();
    const width = r.u16();
    const height = r.u16();
    const depth = r.u16();
    r.u32(); // flags
    r.u16(); // deprecated speed
    r.u32();
    r.u32();
    const transparentIndex = r.u8();
    r.skip(3);
    const colorCount = r.u16();
    if (!width || !height || !frameCount)
        return null;
    const doc = {
        width, height, depth, transparentIndex,
        layers: [], frames: [], tags: [],
        palette: new Uint8ClampedArray(256 * 4), colorCount,
    };
    // A file with no palette chunk (RGBA sprites usually have none) still needs a
    // sane default, so opaque black rather than transparent nothing.
    for (let i = 0; i < 256; i++)
        doc.palette[i * 4 + 3] = 255;
    r.seek(128);
    for (let f = 0; f < frameCount; f++) {
        if (r.pos + 16 > bytes.length)
            break;
        const frameStart = r.pos;
        const frameBytes = r.u32();
        if (r.u16() !== FRAME_MAGIC)
            break;
        const oldChunks = r.u16();
        const duration = r.u16();
        r.skip(2);
        const newChunks = r.u32();
        const chunkCount = newChunks || oldChunks;
        const frame = { duration: duration || 100, cels: [] };
        for (let c = 0; c < chunkCount; c++) {
            if (r.pos + 6 > bytes.length)
                break;
            const chunkStart = r.pos;
            const chunkSize = r.u32();
            const chunkType = r.u16();
            if (chunkSize < 6)
                break;
            const dataEnd = Math.min(chunkStart + chunkSize, bytes.length);
            if (chunkType === 0x2004) { // Layer
                const flags = r.u16();
                const type = r.u16();
                const childLevel = r.u16();
                r.u16();
                r.u16(); // default w/h, ignored
                const blendMode = r.u16();
                const opacity = r.u8();
                r.skip(3);
                doc.layers.push({
                    name: aseString(r) || ('Layer ' + doc.layers.length),
                    visible: !!(flags & 1), group: type === 1, childLevel, blendMode, opacity,
                });
            }
            else if (chunkType === 0x2005) { // Cel
                const layer = r.u16();
                const x = r.i16();
                const y = r.i16();
                const opacity = r.u8();
                const celType = r.u16();
                r.i16(); // z-index (1.3+)
                r.skip(5);
                if (celType === 1) {
                    frame.cels.push({ layer, x, y, opacity, w: 0, h: 0, rgba: null, linkFrame: r.u16() });
                }
                else if (celType === 0 || celType === 2) {
                    const w = r.u16(), h = r.u16();
                    if (w > 0 && h > 0 && w <= 65535 && h <= 65535) {
                        let px = r.bytes_(Math.max(0, dataEnd - r.pos));
                        if (celType === 2) {
                            try {
                                px = await inflate(px, 'deflate');
                            }
                            catch (_) {
                                px = null;
                            }
                        }
                        const rgba = px ? celToRgba(px, w, h, doc) : null;
                        frame.cels.push({ layer, x, y, opacity, w, h, rgba, linkFrame: -1 });
                    }
                }
                // celType 3 is a compressed tilemap - tileset rendering is not supported,
                // so the cel is skipped rather than drawn wrong.
            }
            else if (chunkType === 0x2019) { // Palette
                const size = r.u32();
                const first = r.u32();
                const last = r.u32();
                r.skip(8);
                for (let i = first; i <= last && i < 256 && r.pos + 6 <= dataEnd; i++) {
                    const flags = r.u16();
                    const p = i * 4;
                    doc.palette[p] = r.u8();
                    doc.palette[p + 1] = r.u8();
                    doc.palette[p + 2] = r.u8();
                    doc.palette[p + 3] = r.u8();
                    if (flags & 1)
                        aseString(r); // entry name
                }
                if (size > doc.colorCount)
                    doc.colorCount = size;
            }
            else if (chunkType === 0x0004 || chunkType === 0x0011) {
                // Old palette chunk - only read when no new-style one has been seen.
                const packets = r.u16();
                let idx = 0;
                for (let p = 0; p < packets && r.pos + 2 <= dataEnd; p++) {
                    idx += r.u8();
                    let n = r.u8();
                    if (n === 0)
                        n = 256;
                    for (let i = 0; i < n && idx < 256 && r.pos + 3 <= dataEnd; i++, idx++) {
                        const q = idx * 4;
                        // The 0x0004 variant stores 0-255; 0x0011 stores 0-63, so scale it.
                        const sc = chunkType === 0x0011 ? 255 / 63 : 1;
                        doc.palette[q] = r.u8() * sc;
                        doc.palette[q + 1] = r.u8() * sc;
                        doc.palette[q + 2] = r.u8() * sc;
                        doc.palette[q + 3] = 255;
                    }
                }
            }
            else if (chunkType === 0x2018) { // Tags
                const n = r.u16();
                r.skip(8);
                for (let t = 0; t < n && r.pos + 17 <= dataEnd; t++) {
                    const from = r.u16(), to = r.u16();
                    const direction = r.u8();
                    const repeat = r.u16();
                    r.skip(6);
                    r.u8();
                    r.u8();
                    r.u8(); // deprecated tag colour
                    r.u8();
                    doc.tags.push({ from, to, direction, repeat, name: aseString(r) || ('Tag ' + t) });
                }
            }
            r.seek(chunkStart + chunkSize);
        }
        doc.frames.push(frame);
        if (frameBytes > 0)
            r.seek(frameStart + frameBytes);
    }
    return doc.frames.length ? doc : null;
}
// Separable blend of one channel, both operands 0-255. Non-separable modes are
// handled by the caller (they fall back to Normal).
function blendChannel(mode, b, s) {
    switch (mode) {
        case 1: return b * s / 255; // multiply
        case 2: return 255 - (255 - b) * (255 - s) / 255; // screen
        case 3: return b < 128 ? 2 * b * s / 255 // overlay
            : 255 - 2 * (255 - b) * (255 - s) / 255;
        case 4: return Math.min(b, s); // darken
        case 5: return Math.max(b, s); // lighten
        case 6: return s >= 255 ? 255 : Math.min(255, b * 255 / (255 - s)); // dodge
        case 7: return s <= 0 ? 0 : 255 - Math.min(255, (255 - b) * 255 / s); // burn
        case 8: return s < 128 ? 2 * s * b / 255 // hard light
            : 255 - 2 * (255 - s) * (255 - b) / 255;
        case 9: { // soft light
            const bn = b / 255, sn = s / 255;
            const d = bn <= 0.25 ? ((16 * bn - 12) * bn + 4) * bn : Math.sqrt(bn);
            return 255 * (sn <= 0.5 ? bn - (1 - 2 * sn) * bn * (1 - bn)
                : bn + (2 * sn - 1) * (d - bn));
        }
        case 10: return Math.abs(b - s); // difference
        case 11: return b + s - 2 * b * s / 255; // exclusion
        case 16: return Math.min(255, b + s); // addition
        case 17: return Math.max(0, b - s); // subtract
        case 18: return s === 0 ? 255 : Math.min(255, b * 255 / s); // divide
        default: return s; // normal
    }
}
/** Composite one frame of the sprite into an RGBA buffer, bottom layer first.
    Group layers hold no pixels; a hidden layer contributes nothing. */
export function compositeFrame(doc, frameIndex) {
    const { width: W, height: H } = doc;
    const dst = new Uint8ClampedArray(W * H * 4);
    const frame = doc.frames[frameIndex];
    if (!frame)
        return dst;
    for (let li = 0; li < doc.layers.length; li++) {
        const layer = doc.layers[li];
        if (!layer.visible || layer.group)
            continue;
        // A linked cel means "the image from frame N" - follow it once.
        let cel = frame.cels.find((c) => c.layer === li);
        if (cel && cel.linkFrame >= 0) {
            const src = doc.frames[cel.linkFrame];
            const linked = src && src.cels.find((c) => c.layer === li);
            cel = linked && linked.rgba ? { ...linked, opacity: cel.opacity } : undefined;
        }
        if (!cel || !cel.rgba)
            continue;
        const alpha = (layer.opacity / 255) * (cel.opacity / 255);
        if (alpha <= 0)
            continue;
        const mode = NON_SEPARABLE.has(layer.blendMode) ? 0 : layer.blendMode;
        for (let y = 0; y < cel.h; y++) {
            const dy = cel.y + y;
            if (dy < 0 || dy >= H)
                continue;
            for (let x = 0; x < cel.w; x++) {
                const dx = cel.x + x;
                if (dx < 0 || dx >= W)
                    continue;
                const s = (y * cel.w + x) * 4, d = (dy * W + dx) * 4;
                const sa = (cel.rgba[s + 3] / 255) * alpha;
                if (sa <= 0)
                    continue;
                const da = dst[d + 3] / 255;
                const outA = sa + da * (1 - sa);
                if (outA <= 0) {
                    dst[d + 3] = 0;
                    continue;
                }
                for (let ch = 0; ch < 3; ch++) {
                    const bc = dst[d + ch], sc = cel.rgba[s + ch];
                    // Blend against the backdrop only where it is opaque, per the standard
                    // compositing formula; over empty pixels the source colour stands.
                    const blended = da > 0 ? blendChannel(mode, bc, sc) : sc;
                    const mixed = sc + (blended - sc) * da;
                    dst[d + ch] = (mixed * sa + bc * da * (1 - sa)) / outA;
                }
                dst[d + 3] = outA * 255;
            }
        }
    }
    return dst;
}
// Scale a sprite up to a comfortable size on screen without blurring it. Pixel
// art must be magnified by a whole number or the pixel grid goes uneven, so this
// picks the largest integer factor that still fits PREVIEW_EDGE.
function pixelScale(w, h) {
    const longest = Math.max(w, h);
    if (!longest)
        return 1;
    return Math.max(1, Math.floor(PREVIEW_EDGE / longest));
}
function rgbaToCanvas(rgba, w, h) {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const data = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length);
    cv.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);
    return cv;
}
/** Render an Aseprite sprite: composited frame view with a transport that
    honours each frame's own duration, the layer tree, and the animation tags. */
export async function renderAseprite(file, resultsEl) {
    const loader = inlineLoader('Decoding sprite…');
    resultsEl.appendChild(loader);
    let doc = null;
    try {
        doc = await parseAseprite(new Uint8Array(await file.arrayBuffer()));
    }
    catch (_) {
        doc = null;
    }
    loader.remove();
    if (!doc) {
        resultsEl.appendChild(el('div', { class: 'anr-info' }, 'This file has an Aseprite extension but its header does not parse as one.'));
        return;
    }
    const sprite = doc;
    // Composite every frame once up front, so the transport is instant afterwards.
    const frames = sprite.frames.map((_, i) => compositeFrame(sprite, i));
    const scale = pixelScale(sprite.width, sprite.height);
    const card = el('div', { class: 'anr-card' });
    const [spriteH, spriteHelp] = h3help('Sprite', 'Every frame is composited from the layer stack: Aseprite stores only the cels that changed, plus links back to earlier frames, so a frame is assembled rather than stored whole.');
    card.appendChild(spriteH);
    card.appendChild(spriteHelp);
    const canvas = rgbaToCanvas(frames[0], sprite.width, sprite.height);
    canvas.style.width = (sprite.width * scale) + 'px';
    canvas.style.maxWidth = '100%';
    canvas.style.height = 'auto';
    canvas.style.imageRendering = 'pixelated';
    const stage = el('div', {
        style: 'display:inline-block; border:1px solid var(--hairline); ' +
            'background:repeating-conic-gradient(#7a7a7a 0% 25%, #9a9a9a 0% 50%) 50% / 16px 16px;',
    }, [canvas]);
    card.appendChild(stage);
    const ctx = canvas.getContext('2d');
    let current = 0;
    const label = el('span', { class: 'anr-hint' }, '');
    function show(i) {
        current = ((i % frames.length) + frames.length) % frames.length;
        const rgba = frames[current];
        const data = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length);
        ctx.putImageData(new ImageData(data, sprite.width, sprite.height), 0, 0);
        label.textContent = 'Frame ' + (current + 1) + ' / ' + frames.length +
            ' · ' + sprite.frames[current].duration + ' ms';
    }
    show(0);
    // Playback runs on a per-frame timeout rather than one interval, because each
    // frame carries its own duration - a fixed frame rate would play it wrong.
    let timer = null;
    const playBtn = el('button', { type: 'button', class: 'anr-btn' }, '▶ Play');
    const stop = () => { if (timer !== null) {
        clearTimeout(timer);
        timer = null;
    } playBtn.textContent = '▶ Play'; };
    const tick = () => {
        show(current + 1);
        timer = window.setTimeout(tick, Math.max(10, sprite.frames[current].duration));
    };
    playBtn.addEventListener('click', () => {
        if (timer !== null) {
            stop();
            return;
        }
        playBtn.textContent = '❚❚ Pause';
        timer = window.setTimeout(tick, Math.max(10, sprite.frames[current].duration));
    });
    const controls = el('div', { style: 'display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:10px;' }, [
        el('button', { type: 'button', class: 'anr-btn', onclick: () => { stop(); show(current - 1); } }, '← Prev'),
        frames.length > 1 ? playBtn : el('span'),
        el('button', { type: 'button', class: 'anr-btn', onclick: () => { stop(); show(current + 1); } }, 'Next →'),
        el('button', { type: 'button', class: 'anr-btn', onclick: () => {
                canvas.toBlob((b) => {
                    if (b)
                        downloadBlob((file.name || 'sprite').replace(/\.[^.]+$/, '') + '_frame_' + (current + 1) + '.png', b);
                }, 'image/png');
            } }, 'Save frame (PNG)'),
        label,
    ]);
    card.appendChild(controls);
    resultsEl.appendChild(card);
    // ---- details ----
    const info = el('div', { class: 'anr-card' });
    info.appendChild(el('h3', {}, 'Details'));
    const tbl = el('table', { class: 'anr-table' });
    tbl.appendChild(row('Canvas', sprite.width + ' × ' + sprite.height + ' px'));
    tbl.appendChild(row('Colour depth', DEPTH_NAME[sprite.depth] || (sprite.depth + ' bpp')));
    tbl.appendChild(row('Frames', frames.length));
    const totalMs = sprite.frames.reduce((s, f) => s + f.duration, 0);
    if (frames.length > 1)
        tbl.appendChild(row('Total duration', (totalMs / 1000).toFixed(2) + ' s'));
    const groups = sprite.layers.filter((l) => l.group).length;
    tbl.appendChild(row('Layers', (sprite.layers.length - groups) + (groups ? ' (+' + groups + ' groups)' : '')));
    if (sprite.depth === 8)
        tbl.appendChild(row('Palette colours', sprite.colorCount || 256));
    tbl.appendChild(row('File size', fmtBytes(file.size)));
    info.appendChild(tbl);
    resultsEl.appendChild(info);
    // ---- layers ----
    if (sprite.layers.length) {
        const lc = el('div', { class: 'anr-card' });
        const [layerH, layerHelp] = h3help('Layers', 'Listed bottom to top, the order they composite in. Indentation shows group nesting. A hidden layer is read from the file but contributes nothing to the image.');
        lc.appendChild(layerH);
        lc.appendChild(layerHelp);
        const lt = el('table', { class: 'anr-table' });
        sprite.layers.forEach((l) => {
            const indent = '  '.repeat(Math.min(6, l.childLevel));
            const bits = [];
            bits.push(l.group ? 'group' : (BLEND_NAME[l.blendMode] || ('mode ' + l.blendMode)));
            if (!l.group)
                bits.push(Math.round(l.opacity / 255 * 100) + '% opacity');
            if (!l.visible)
                bits.push('hidden');
            if (NON_SEPARABLE.has(l.blendMode))
                bits.push('composited as Normal here');
            lt.appendChild(row(indent + (l.name || '(unnamed)'), bits.join(' · ')));
        });
        lc.appendChild(lt);
        resultsEl.appendChild(lc);
    }
    // ---- tags ----
    if (sprite.tags.length) {
        const tc = el('div', { class: 'anr-card' });
        const [tagH, tagHelp] = h3help('Animation tags', 'Named frame ranges - the way several animations (walk, idle, attack) are packed into one file.');
        tc.appendChild(tagH);
        tc.appendChild(tagHelp);
        const tt = el('table', { class: 'anr-table' });
        sprite.tags.forEach((t) => {
            const span = (t.from + 1) + '–' + (t.to + 1);
            const dir = LOOP_NAME[t.direction] || ('direction ' + t.direction);
            tt.appendChild(row(t.name, 'frames ' + span + ' · ' + dir + (t.repeat ? ' · ' + t.repeat + '×' : '')));
        });
        tc.appendChild(tt);
        // With more than one tag, offer a jump button per tag.
        if (sprite.tags.length > 1) {
            const jump = el('div', { style: 'display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;' });
            sprite.tags.forEach((t) => {
                jump.appendChild(el('button', { type: 'button', class: 'anr-btn',
                    onclick: () => { stop(); show(t.from); } }, t.name));
            });
            tc.appendChild(jump);
        }
        resultsEl.appendChild(tc);
    }
}
//# sourceMappingURL=aseprite.js.map