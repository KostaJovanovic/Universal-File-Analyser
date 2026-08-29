/* Analyser - GIMP XCF viewer (.xcf)

   XCF has no baked composite. Unlike a PSD - which stores a flattened image
   alongside its layers - a GIMP file is ONLY the layer stack, so showing the
   picture means compositing it here: walk the layer list, decode each layer's
   tile pyramid, apply its mask, opacity and blend mode, and paint bottom-up.

   Structure, briefly. A 14-byte magic carrying the version, then image width /
   height / base type, then a property list (compression, palette, ...). After
   that a list of pointers to layers, each of which has its own property list and
   a pointer to a "hierarchy" - a mip pyramid whose level 0 is the full-size
   image, itself divided into 64x64 tiles. Tiles are stored either raw, RLE'd per
   channel, or zlib'd; all three are handled below.

   Deliberate limits, each reported on screen rather than guessed at:
     - Only 8-bit precision is decoded. GIMP 2.10 can store 16/32-bit integer and
       float channels; those need a different tile reader and are rare in the
       wild, so the file is described instead of drawn.
     - Indexed and grayscale images are converted through the palette / channel
       replication; CMYK is not an XCF base type so does not arise.
     - The four non-separable blend modes (hue, saturation, colour, value) are
       named on the layer row and composited as Normal, the same honest fallback
       aseprite.js makes.

   Pointers are 32-bit up to version 10 and 64-bit from version 11, which is the
   single easiest thing to get wrong when reading one of these. */

import { el, row, fmtBytes, h3help, downloadBlob, inlineLoader } from '../core/util.js';
import { Reader, inflate } from '../core/binutil.js';
import { PREVIEW_EDGE } from '../core/limits.js';

const TILE = 64;

// PROP ids used here (the full list is much longer; the rest are skipped).
const PROP_END = 0, PROP_COLORMAP = 1, PROP_OPACITY = 6, PROP_MODE = 7,
  PROP_VISIBLE = 8, PROP_OFFSETS = 15, PROP_COMPRESSION = 17,
  PROP_APPLY_MASK = 11, PROP_FLOAT_OPACITY = 33;

const BASE_TYPE = ['RGB', 'Grayscale', 'Indexed'];

// GIMP's blend modes. Numbering runs in two eras: 0-25 are the legacy modes, and
// 28+ are the "modern" set GIMP 2.10 writes. Both are mapped onto one internal
// id so the compositor only has one switch to satisfy.
const MODE_NAME: Record<number, string> = {
  0: 'Normal', 1: 'Dissolve', 2: 'Behind', 3: 'Multiply', 4: 'Screen',
  5: 'Overlay', 6: 'Difference', 7: 'Addition', 8: 'Subtract', 9: 'Darken only',
  10: 'Lighten only', 11: 'Hue', 12: 'Saturation', 13: 'Colour', 14: 'Value',
  15: 'Divide', 16: 'Dodge', 17: 'Burn', 18: 'Hard light', 19: 'Soft light',
  20: 'Grain extract', 21: 'Grain merge', 22: 'Colour erase', 23: 'Erase',
  24: 'Merge', 25: 'Split',
  28: 'Normal', 29: 'Dissolve', 30: 'Behind', 31: 'Multiply', 32: 'Screen',
  33: 'Overlay', 34: 'Difference', 35: 'Addition', 36: 'Subtract',
  37: 'Darken only', 38: 'Lighten only', 39: 'Hue', 40: 'Saturation',
  41: 'Colour', 42: 'Value', 43: 'Divide', 44: 'Dodge', 45: 'Burn',
  46: 'Hard light', 47: 'Soft light', 48: 'Grain extract', 49: 'Grain merge',
  50: 'Vivid light', 51: 'Pin light', 52: 'Linear light', 53: 'Hard mix',
  54: 'Exclusion', 55: 'Linear burn', 56: 'Luma darken', 57: 'Luma lighten',
};

// Internal blend ids the compositor implements.
const enum B {
  Normal, Multiply, Screen, Overlay, Difference, Addition, Subtract,
  Darken, Lighten, Divide, Dodge, Burn, HardLight, SoftLight,
  GrainExtract, GrainMerge, Exclusion, LinearBurn, NonSeparable,
}

function modeToBlend(m: number): B {
  switch (m) {
    case 3: case 31: return B.Multiply;
    case 4: case 32: return B.Screen;
    case 5: case 33: return B.Overlay;
    case 6: case 34: return B.Difference;
    case 7: case 35: return B.Addition;
    case 8: case 36: return B.Subtract;
    case 9: case 37: return B.Darken;
    case 10: case 38: return B.Lighten;
    case 15: case 43: return B.Divide;
    case 16: case 44: return B.Dodge;
    case 17: case 45: return B.Burn;
    case 18: case 46: return B.HardLight;
    case 19: case 47: return B.SoftLight;
    case 20: case 48: return B.GrainExtract;
    case 21: case 49: return B.GrainMerge;
    case 54: return B.Exclusion;
    case 55: return B.LinearBurn;
    case 11: case 12: case 13: case 14:
    case 39: case 40: case 41: case 42: return B.NonSeparable;
    default: return B.Normal;
  }
}

interface XcfLayer {
  name: string;
  width: number;
  height: number;
  type: number;          // 0 RGB, 1 RGBA, 2 GRAY, 3 GRAYA, 4 INDEXED, 5 INDEXEDA
  offsetX: number;
  offsetY: number;
  opacity: number;       // 0-1
  visible: boolean;
  mode: number;
  applyMask: boolean;
  rgba: Uint8ClampedArray | null;
  mask: Uint8Array | null;
}

interface XcfDoc {
  version: number;
  width: number;
  height: number;
  baseType: number;
  precision: number;
  compression: number;
  layers: XcfLayer[];
  colormap: Uint8Array | null;
  /** Set when the pixels could not be decoded, explaining why. */
  undecodable: string | null;
}

// GIMP RLE, per channel: an opcode byte, then either a repeated byte or a
// literal run. 127 and 128 escape to a 16-bit length.
function rleDecode(src: Uint8Array, p: number, out: Uint8Array, stride: number, count: number) {
  let written = 0;
  while (written < count && p < src.length) {
    const op = src[p++];
    if (op < 128) {
      let n = op + 1;
      if (op === 127) { n = (src[p] << 8) | src[p + 1]; p += 2; }
      const v = src[p++];
      for (let i = 0; i < n && written < count; i++, written++) out[written * stride] = v;
    } else {
      let n = 256 - op;
      if (op === 128) { n = (src[p] << 8) | src[p + 1]; p += 2; }
      for (let i = 0; i < n && written < count; i++, written++) out[written * stride] = src[p++];
    }
  }
  return p;
}

class XcfReader {
  r: Reader;
  wide: boolean;              // 64-bit pointers (version >= 11)
  constructor(bytes: Uint8Array, wide: boolean) {
    this.r = new Reader(bytes, false);   // XCF is big-endian throughout
    this.wide = wide;
  }
  ptr() { return this.wide ? this.r.u64num() : this.r.u32(); }
  // A GIMP string: length INCLUDING the terminating NUL, then the bytes.
  str() {
    const n = this.r.u32();
    if (!n) return '';
    const b = this.r.bytes_(n);
    try { return new TextDecoder().decode(b.subarray(0, Math.max(0, n - 1))); } catch (_) { return ''; }
  }
}

// Read one hierarchy (level 0 only - the full-resolution image) into `bpp`
// interleaved bytes per pixel.
async function readHierarchy(xr: XcfReader, bytes: Uint8Array, at: number,
                             compression: number): Promise<{ w: number; h: number; bpp: number; px: Uint8Array } | null> {
  xr.r.seek(at);
  const w = xr.r.u32(), h = xr.r.u32(), bpp = xr.r.u32();
  if (!w || !h || !bpp || bpp > 4 || w > 30000 || h > 30000) return null;
  const levelPtr = xr.ptr();               // level 0 = full size
  if (!levelPtr || levelPtr >= bytes.length) return null;

  xr.r.seek(levelPtr);
  const lw = xr.r.u32(), lh = xr.r.u32();
  if (lw !== w || lh !== h) return null;
  const tilesX = Math.ceil(w / TILE), tilesY = Math.ceil(h / TILE);
  const tilePtrs: number[] = [];
  for (let i = 0; i < tilesX * tilesY; i++) {
    const p = xr.ptr();
    if (!p) break;
    tilePtrs.push(p);
  }
  if (tilePtrs.length < tilesX * tilesY) return null;

  const px = new Uint8Array(w * h * bpp);
  for (let t = 0; t < tilePtrs.length; t++) {
    const tx = (t % tilesX) * TILE, ty = Math.floor(t / tilesX) * TILE;
    const tw = Math.min(TILE, w - tx), th = Math.min(TILE, h - ty);
    const n = tw * th;
    const tile = new Uint8Array(n * bpp);
    const start = tilePtrs[t];
    // Tiles are contiguous, so the next pointer bounds this one; the last runs
    // to the end of the file.
    const end = t + 1 < tilePtrs.length ? tilePtrs[t + 1] : bytes.length;
    if (start >= bytes.length) continue;
    const raw = bytes.subarray(start, Math.min(end, bytes.length));

    if (compression === 0) {                       // uncompressed, interleaved
      tile.set(raw.subarray(0, Math.min(tile.length, raw.length)));
    } else if (compression === 1) {                // RLE, one plane per channel
      let p = 0;
      for (let c = 0; c < bpp; c++) p = rleDecode(raw, p, tile.subarray(c), bpp, n);
    } else if (compression === 2) {                // zlib, interleaved
      try {
        const inf = await inflate(raw, 'deflate');
        if (inf) tile.set(inf.subarray(0, Math.min(tile.length, inf.length)));
      } catch (_) { /* leave the tile blank */ }
    } else {
      return null;                                 // fractal: not produced by GIMP
    }

    for (let y = 0; y < th; y++) {
      const dst = ((ty + y) * w + tx) * bpp;
      px.set(tile.subarray(y * tw * bpp, (y + 1) * tw * bpp), dst);
    }
  }
  return { w, h, bpp, px };
}

/** Parse an XCF file: image properties, then every layer with its pixels and
    mask decoded. Returns null if the bytes aren't XCF. */
export async function parseXcf(bytes: Uint8Array): Promise<XcfDoc | null> {
  let magic = '';
  for (let i = 0; i < 14 && i < bytes.length; i++) magic += String.fromCharCode(bytes[i]);
  if (!magic.startsWith('gimp xcf ')) return null;
  const vtxt = magic.slice(9, 13);
  const version = vtxt === 'file' ? 0 : parseInt(vtxt.replace(/^v/, ''), 10) || 0;

  const xr = new XcfReader(bytes, version >= 11);
  xr.r.seek(14);
  const width = xr.r.u32(), height = xr.r.u32(), baseType = xr.r.u32();
  const precision = version >= 4 ? xr.r.u32() : 0;
  if (!width || !height || width > 30000 || height > 30000) return null;

  const doc: XcfDoc = {
    version, width, height, baseType, precision,
    compression: 0, layers: [], colormap: null, undecodable: null,
  };

  // 8-bit only. v4-v6 wrote 0 for 8-bit; v7+ writes 100 (linear) or 150 (gamma).
  const eightBit = precision === 0 || precision === 100 || precision === 150;
  if (!eightBit) {
    doc.undecodable = 'this file stores ' +
      (precision >= 600 ? '32-bit floating point' : precision >= 500 ? '16-bit floating point'
        : precision >= 300 ? '32-bit integer' : '16-bit integer') +
      ' channels, and only 8-bit precision is decoded here';
  }

  // ---- image property list ----
  for (;;) {
    const type = xr.r.u32();
    const len = xr.r.u32();
    if (type === PROP_END) break;
    const next = xr.r.pos + len;
    if (type === PROP_COMPRESSION) doc.compression = xr.r.u8();
    else if (type === PROP_COLORMAP) {
      const n = xr.r.u32();
      if (n > 0 && n <= 256) doc.colormap = xr.r.bytes_(n * 3).slice();
    }
    if (next <= xr.r.pos || next > bytes.length) break;
    xr.r.seek(next);
  }

  // ---- layer pointer list ----
  const layerPtrs: number[] = [];
  for (;;) {
    const p = xr.ptr();
    if (!p) break;
    if (p >= bytes.length || layerPtrs.length > 2000) break;
    layerPtrs.push(p);
  }

  // XCF stores layers TOP first; compositing runs bottom-up, so reverse.
  for (const ptr of layerPtrs.slice().reverse()) {
    xr.r.seek(ptr);
    const lw = xr.r.u32(), lh = xr.r.u32(), ltype = xr.r.u32();
    const name = xr.str();
    const layer: XcfLayer = {
      name: name || '(unnamed)', width: lw, height: lh, type: ltype,
      offsetX: 0, offsetY: 0, opacity: 1, visible: true, mode: 0,
      applyMask: true, rgba: null, mask: null,
    };
    for (;;) {
      const type = xr.r.u32();
      const len = xr.r.u32();
      if (type === PROP_END) break;
      const next = xr.r.pos + len;
      if (type === PROP_OPACITY) layer.opacity = xr.r.u32() / 255;
      else if (type === PROP_FLOAT_OPACITY) layer.opacity = xr.r.f32();
      else if (type === PROP_VISIBLE) layer.visible = xr.r.u32() !== 0;
      else if (type === PROP_MODE) layer.mode = xr.r.u32();
      else if (type === PROP_APPLY_MASK) layer.applyMask = xr.r.u32() !== 0;
      else if (type === PROP_OFFSETS) { layer.offsetX = xr.r.i32(); layer.offsetY = xr.r.i32(); }
      if (next <= xr.r.pos || next > bytes.length) break;
      xr.r.seek(next);
    }
    const hierarchyPtr = xr.ptr();
    const maskPtr = xr.ptr();

    if (!doc.undecodable && hierarchyPtr && hierarchyPtr < bytes.length && lw && lh) {
      const hier = await readHierarchy(xr, bytes, hierarchyPtr, doc.compression);
      if (hier) layer.rgba = hierarchyToRgba(hier, ltype, doc);
      // A layer mask is its own single-channel hierarchy, stored after the
      // layer's own; it multiplies the layer's alpha where applied.
      if (maskPtr && maskPtr < bytes.length && layer.applyMask) {
        xr.r.seek(maskPtr);
        xr.r.u32(); xr.r.u32();                   // mask width/height
        xr.str();                                  // mask name
        for (;;) {                                 // mask property list
          const type = xr.r.u32();
          const len = xr.r.u32();
          if (type === PROP_END) break;
          const next = xr.r.pos + len;
          if (next <= xr.r.pos || next > bytes.length) break;
          xr.r.seek(next);
        }
        const mh = xr.ptr();
        if (mh && mh < bytes.length) {
          const mask = await readHierarchy(xr, bytes, mh, doc.compression);
          if (mask && mask.bpp >= 1 && mask.w === lw && mask.h === lh) {
            const m = new Uint8Array(lw * lh);
            for (let i = 0; i < m.length; i++) m[i] = mask.px[i * mask.bpp];
            layer.mask = m;
          }
        }
      }
    }
    doc.layers.push(layer);
  }
  return doc;
}

// A decoded hierarchy -> RGBA, using the layer type and (for indexed) the
// image's colormap.
function hierarchyToRgba(hier: { w: number; h: number; bpp: number; px: Uint8Array },
                         ltype: number, doc: XcfDoc) {
  const { w, h, bpp, px } = hier;
  const out = new Uint8ClampedArray(w * h * 4);
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const s = i * bpp, d = i * 4;
    if (ltype === 0 || ltype === 1) {                       // RGB / RGBA
      out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2];
      out[d + 3] = ltype === 1 ? px[s + 3] : 255;
    } else if (ltype === 2 || ltype === 3) {                // GRAY / GRAYA
      const v = px[s];
      out[d] = out[d + 1] = out[d + 2] = v;
      out[d + 3] = ltype === 3 ? px[s + 1] : 255;
    } else {                                                // INDEXED / INDEXEDA
      const idx = px[s];
      const cm = doc.colormap;
      if (cm && idx * 3 + 2 < cm.length) {
        out[d] = cm[idx * 3]; out[d + 1] = cm[idx * 3 + 1]; out[d + 2] = cm[idx * 3 + 2];
      }
      out[d + 3] = ltype === 5 ? px[s + 1] : 255;
    }
  }
  return out;
}

// One channel of a separable blend, both operands 0-255.
function blendChannel(mode: B, b: number, s: number) {
  switch (mode) {
    case B.Multiply: return b * s / 255;
    case B.Screen: return 255 - (255 - b) * (255 - s) / 255;
    case B.Overlay: return b < 128 ? 2 * b * s / 255 : 255 - 2 * (255 - b) * (255 - s) / 255;
    case B.Difference: return Math.abs(b - s);
    case B.Addition: return Math.min(255, b + s);
    case B.Subtract: return Math.max(0, b - s);
    case B.Darken: return Math.min(b, s);
    case B.Lighten: return Math.max(b, s);
    case B.Divide: return s === 0 ? 255 : Math.min(255, b * 255 / s);
    case B.Dodge: return s >= 255 ? 255 : Math.min(255, b * 255 / (255 - s));
    case B.Burn: return s <= 0 ? 0 : 255 - Math.min(255, (255 - b) * 255 / s);
    case B.HardLight: return s < 128 ? 2 * s * b / 255 : 255 - 2 * (255 - s) * (255 - b) / 255;
    case B.SoftLight: {
      const bn = b / 255, sn = s / 255;
      const d = bn <= 0.25 ? ((16 * bn - 12) * bn + 4) * bn : Math.sqrt(bn);
      return 255 * (sn <= 0.5 ? bn - (1 - 2 * sn) * bn * (1 - bn) : bn + (2 * sn - 1) * (d - bn));
    }
    // GIMP's own pair: the difference from mid-grey, subtracted or added.
    case B.GrainExtract: return Math.max(0, Math.min(255, b - s + 128));
    case B.GrainMerge: return Math.max(0, Math.min(255, b + s - 128));
    case B.Exclusion: return b + s - 2 * b * s / 255;
    case B.LinearBurn: return Math.max(0, b + s - 255);
    default: return s;
  }
}

/** Composite the whole layer stack into one RGBA buffer, bottom layer first. */
export function compositeXcf(doc: XcfDoc) {
  const { width: W, height: H } = doc;
  const dst = new Uint8ClampedArray(W * H * 4);
  for (const layer of doc.layers) {
    if (!layer.visible || !layer.rgba) continue;
    const mode = modeToBlend(layer.mode);
    const sep = mode === B.NonSeparable ? B.Normal : mode;
    for (let y = 0; y < layer.height; y++) {
      const dy = layer.offsetY + y;
      if (dy < 0 || dy >= H) continue;
      for (let x = 0; x < layer.width; x++) {
        const dx = layer.offsetX + x;
        if (dx < 0 || dx >= W) continue;
        const si = y * layer.width + x, s = si * 4, d = (dy * W + dx) * 4;
        let sa = (layer.rgba[s + 3] / 255) * layer.opacity;
        if (layer.mask) sa *= layer.mask[si] / 255;
        if (sa <= 0) continue;
        const da = dst[d + 3] / 255;
        const outA = sa + da * (1 - sa);
        if (outA <= 0) { dst[d + 3] = 0; continue; }
        for (let c = 0; c < 3; c++) {
          const bc = dst[d + c], sc = layer.rgba[s + c];
          const blended = da > 0 ? blendChannel(sep, bc, sc) : sc;
          const mixed = sc + (blended - sc) * da;
          dst[d + c] = (mixed * sa + bc * da * (1 - sa)) / outA;
        }
        dst[d + 3] = outA * 255;
      }
    }
  }
  return dst;
}

/** Render a GIMP XCF document: the composited image plus the layer stack. */
export async function renderXcf(file: File, resultsEl: HTMLElement) {
  const loader = inlineLoader('Compositing layers…');
  resultsEl.appendChild(loader);
  let doc: XcfDoc | null = null;
  try {
    doc = await parseXcf(new Uint8Array(await file.arrayBuffer()));
  } catch (_) {
    doc = null;
  }
  loader.remove();
  if (!doc) {
    resultsEl.appendChild(el('div', { class: 'anr-info' },
      'This file has a GIMP extension but its header does not parse as XCF.'));
    return;
  }
  const xcf = doc;

  if (!xcf.undecodable && xcf.layers.some((l) => l.rgba)) {
    const rgba = compositeXcf(xcf);
    const cv = document.createElement('canvas');
    cv.width = xcf.width; cv.height = xcf.height;
    const data = new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.length);
    cv.getContext('2d')!.putImageData(new ImageData(data, xcf.width, xcf.height), 0, 0);
    cv.style.maxWidth = '100%';
    cv.style.width = Math.min(xcf.width, PREVIEW_EDGE) + 'px';
    cv.style.height = 'auto';

    const card = el('div', { class: 'anr-card' });
    const [h, help] = h3help('Composite', 'GIMP files store no flattened image - unlike a PSD, an XCF is only its layer stack. This picture is composited here from those layers, applying each one’s mask, opacity and blend mode.');
    card.appendChild(h); card.appendChild(help);
    card.appendChild(el('div', {
      style: 'display:inline-block; border:1px solid var(--hairline); ' +
        'background:repeating-conic-gradient(#7a7a7a 0% 25%, #9a9a9a 0% 50%) 50% / 16px 16px;',
    }, [cv]));
    card.appendChild(el('div', { style: 'margin-top:10px;' }, [
      el('button', { type: 'button', class: 'anr-btn', onclick: () => {
        cv.toBlob((b) => { if (b) downloadBlob((file.name || 'image').replace(/\.[^.]+$/, '') + '.png', b); }, 'image/png');
      } }, 'Save composite (PNG)'),
    ]));
    resultsEl.appendChild(card);
  } else {
    resultsEl.appendChild(el('div', { class: 'anr-info' },
      xcf.undecodable
        ? 'The layer stack is described below, but not drawn: ' + xcf.undecodable + '.'
        : 'No layer pixels could be decoded from this file, so only its structure is shown.'));
  }

  const info = el('div', { class: 'anr-card' });
  info.appendChild(el('h3', {}, 'Details'));
  const tbl = el('table', { class: 'anr-table' });
  tbl.appendChild(row('Canvas', xcf.width + ' × ' + xcf.height + ' px'));
  tbl.appendChild(row('Colour mode', BASE_TYPE[xcf.baseType] || ('type ' + xcf.baseType)));
  tbl.appendChild(row('XCF version', xcf.version === 0 ? 'v0 (original)' : 'v' + xcf.version));
  tbl.appendChild(row('Tile compression', ['None', 'RLE', 'zlib', 'Fractal'][xcf.compression] || String(xcf.compression)));
  tbl.appendChild(row('Layers', xcf.layers.length));
  if (xcf.colormap) tbl.appendChild(row('Palette colours', xcf.colormap.length / 3));
  tbl.appendChild(row('File size', fmtBytes(file.size)));
  info.appendChild(tbl);
  resultsEl.appendChild(info);

  if (xcf.layers.length) {
    const lc = el('div', { class: 'anr-card' });
    const [lh, lhelp] = h3help('Layers', 'Listed bottom to top - the order they composite in. Hue, saturation, colour and value are non-separable modes: they are read and named, but drawn as Normal here.');
    lc.appendChild(lh); lc.appendChild(lhelp);
    const lt = el('table', { class: 'anr-table' });
    for (const l of xcf.layers) {
      const bits: string[] = [MODE_NAME[l.mode] || ('mode ' + l.mode)];
      bits.push(Math.round(l.opacity * 100) + '% opacity');
      if (l.width !== xcf.width || l.height !== xcf.height) bits.push(l.width + '×' + l.height);
      if (l.offsetX || l.offsetY) bits.push('at ' + l.offsetX + ',' + l.offsetY);
      if (l.mask) bits.push('masked');
      if (!l.visible) bits.push('hidden');
      if (modeToBlend(l.mode) === B.NonSeparable) bits.push('drawn as Normal');
      lt.appendChild(row(l.name, bits.join(' · ')));
    }
    lc.appendChild(lt);
    resultsEl.appendChild(lc);
  }
}
