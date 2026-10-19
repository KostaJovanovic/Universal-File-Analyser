/* Analyser - Adobe Photoshop PSD / PSB viewer
   ============================================================================
   Two paths, chosen by what the file actually is:

   1. A small, lightweight header read (from just the first few MB of the file)
      always runs first. It parses the PSD/PSB header for the dimensions, colour
      mode, bit depth and channel count, and pulls out the embedded RGB thumbnail
      that Photoshop bakes into the image-resources block (when "Maximize
      Compatibility" was on). This is memory-safe even for multi-hundred-MB files
      and works for every colour mode, so CMYK, 16/32-bit, PSB and huge files all
      get a real preview.

   2. For RGB / Grayscale 8-bit PSDs under a size limit, the vendored ag-psd
      library additionally decodes the full composite image and the layer tree
      (names, blend modes, opacity, visibility and per-layer thumbnails).

   3. Everything else (CMYK / Lab / 16- and 32-bit / PSB / past the size or canvas
      limits, which ag-psd can't take) is read structurally from slices of the
      file: the layer list from the layer records, and the flattened image
      decoded row by row, sampled down to PSD_STREAM_PREVIEW_SIDE. Layer pixels
      are not unpacked there. When the flattened image can't be read, path 1's
      embedded thumbnail stands in. */

import { el, row, rowHelp, h3help, fmtBytes, integrityCard, errorCard, blobImg, downloadBlob, type ElChild } from '../core/util.js';
import { loadScript } from '../core/util.js';
import { DECODE_FULL_MAX, PSD_DECODE_MAX_PX, PSD_STREAM_PREVIEW_SIDE } from '../core/limits.js';

const AGPSD_URL = 'assets/vendor/ag-psd/bundle.js';
// Above this size (or PSD_DECODE_MAX_PX canvas pixels - the declared canvas, not
// the byte count, is what ag-psd allocates), or for colour modes ag-psd can't
// handle, we skip the heavy full-decode and show the embedded thumbnail instead
// (decoding every layer of a huge PSD would exhaust the tab's memory).
const AGPSD_SIZE_LIMIT = DECODE_FULL_MAX;
// Read enough of the start to cover the header + image-resources (the thumbnail
// lives there, well before the giant layer/image-data sections).
const HEADER_SLICE = 12 * 1024 * 1024;

const COLOR_MODES = ['Bitmap', 'Grayscale', 'Indexed', 'RGB', 'CMYK', '', '', 'Multichannel', 'Duotone', 'Lab'];

async function loadAgPsd() {
  if (!window.agPsd) await loadScript(AGPSD_URL);
  return window.agPsd || null;
}

// Parse the PSD/PSB header (26 bytes) and scan the image-resources block for the
// embedded thumbnail (resource 1036 / 1033, stored as a JPEG). Returns the header
// fields plus the thumbnail JPEG bytes (or null). Operates on a leading slice.
function parsePsdHeader(bytes: Uint8Array) {
  if (bytes.length < 26) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== '8BPS') return null;
  const out = {
    version: dv.getUint16(4),            // 1 = PSD, 2 = PSB
    channels: dv.getUint16(12),
    height: dv.getUint32(14),
    width: dv.getUint32(18),
    depth: dv.getUint16(22),
    mode: dv.getUint16(24),
    thumb: null as Uint8Array|null,
  };
  let o = 26;
  if (o + 4 > bytes.length) return out;
  const cmLen = dv.getUint32(o); o += 4 + cmLen;          // colour-mode data
  if (o + 4 > bytes.length) return out;
  const irLen = dv.getUint32(o); o += 4;                  // image resources
  const irEnd = Math.min(o + irLen, bytes.length);
  while (o + 12 <= irEnd) {
    if (String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]) !== '8BIM') break;
    o += 4;
    const id = dv.getUint16(o); o += 2;
    let nameTotal = bytes[o] + 1; if (nameTotal % 2) nameTotal++;   // Pascal name, padded to even
    o += nameTotal;
    if (o + 4 > bytes.length) break;
    const size = dv.getUint32(o); o += 4;
    const dataStart = o;
    if ((id === 1036 || id === 1033) && size > 28 && dataStart + 28 <= bytes.length) {
      if (dv.getUint32(dataStart) === 1) {               // format 1 = kJpegRGB
        const jpegEnd = Math.min(dataStart + size, bytes.length);
        if (jpegEnd > dataStart + 28) out.thumb = bytes.slice(dataStart + 28, jpegEnd);
      }
    }
    o = dataStart + size + (size % 2);                   // resource data padded to even
  }
  return out;
}

// ---------- structural read: layer records + the flattened image, by slices ----------
// For every file ag-psd can't take. Neither half allocates the canvas: the layer
// records are a small run near the start of the layer section (their pixel data
// that follows is skipped by length), and the merged image at the end of the file
// is read one sampled row at a time, PackBits rows located through the per-row
// byte-count table.

// ag-psd's names for the blend-mode keys, so layerTreeCard reads both alike.
const BLEND_KEYS: Record<string, string> = {
  'pass': 'pass through', 'norm': 'normal', 'diss': 'dissolve', 'dark': 'darken', 'mul ': 'multiply',
  'idiv': 'color burn', 'lbrn': 'linear burn', 'dkCl': 'darker color', 'lite': 'lighten', 'scrn': 'screen',
  'div ': 'color dodge', 'lddg': 'linear dodge', 'lgCl': 'lighter color', 'over': 'overlay',
  'sLit': 'soft light', 'hLit': 'hard light', 'vLit': 'vivid light', 'lLit': 'linear light',
  'pLit': 'pin light', 'hMix': 'hard mix', 'diff': 'difference', 'smud': 'exclusion', 'fsub': 'subtract',
  'fdiv': 'divide', 'hue ': 'hue', 'sat ': 'saturation', 'colr': 'color', 'lum ': 'luminosity',
};
// Additional-info keys whose length is 8 bytes in a PSB.
const PSB_LONG_KEYS = new Set(['LMsk', 'Lr16', 'Lr32', 'Layr', 'Mt16', 'Mt32', 'Mtrn', 'Alph', 'FMsk', 'lnk2', 'FEid', 'FXid', 'PxSD']);

// Big-endian cursor over a File, refilled in 4 MB windows. `need(n)` before a
// run of reads guarantees n bytes from `pos` are in the window.
class PsdCursor {
  pos = 0;
  private buf = new Uint8Array(0);
  private dv = new DataView(this.buf.buffer);
  private start = 0;
  constructor(private file: File) {}
  async need(n: number) {
    if (this.pos >= this.start && this.pos + n <= this.start + this.buf.length) return;
    this.buf = new Uint8Array(await this.file.slice(this.pos, this.pos + Math.max(n, 4 * 1024 * 1024)).arrayBuffer());
    this.dv = new DataView(this.buf.buffer);
    this.start = this.pos;
    if (this.buf.length < n) throw new Error('truncated');
  }
  u8() { return this.buf[this.pos++ - this.start]; }
  u16() { const v = this.dv.getUint16(this.pos - this.start); this.pos += 2; return v; }
  i16() { const v = this.dv.getInt16(this.pos - this.start); this.pos += 2; return v; }
  u32() { const v = this.dv.getUint32(this.pos - this.start); this.pos += 4; return v; }
  i32() { const v = this.dv.getInt32(this.pos - this.start); this.pos += 4; return v; }
  u64() { const o = this.pos - this.start; this.pos += 8; return this.dv.getUint32(o) * 4294967296 + this.dv.getUint32(o + 4); }
  // Skip a block led by its 4-byte length. (Not `pos += u32()`: that adds to
  // the position from BEFORE the length was read.)
  skip32() { const n = this.u32(); this.pos += n; }
  str(n: number) { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(this.buf[this.pos - this.start + i]); this.pos += n; return s; }
  sub(n: number) { const o = this.pos - this.start; this.pos += n; return this.buf.subarray(o, o + n); }
}

interface PsdRecord { name: string; top: number; left: number; bottom: number; right: number; blendMode: string; opacity: number; hidden: boolean; section: number }

// The layer records of a layer-info block, `c` at its layer count.
async function readLayerRecords(c: PsdCursor, psb: boolean) {
  await c.need(2);
  const count = Math.abs(c.i16());
  const recs: PsdRecord[] = [];
  for (let i = 0; i < count && i < 50000; i++) {
    await c.need(18);
    const top = c.i32(), left = c.i32(), bottom = c.i32(), right = c.i32();
    const nch = c.u16();
    c.pos += nch * (psb ? 10 : 6);
    await c.need(16);
    if (c.str(4) !== '8BIM') throw new Error('bad layer record');
    const blend = c.str(4);
    const opacity = c.u8(); c.u8();
    const flags = c.u8(); c.u8();
    const extraLen = c.u32();
    const extraEnd = c.pos + extraLen;
    await c.need(4); c.skip32();                     // layer mask data
    await c.need(4); c.skip32();                     // blending ranges
    await c.need(1);
    const nameAt = c.pos, nl = c.u8();
    await c.need(nl);
    let name = c.str(nl);
    c.pos = nameAt + Math.ceil((1 + nl) / 4) * 4;  // Pascal string padded to 4
    let section = 0, groupBlend = '';
    while (c.pos + 12 <= extraEnd) {
      await c.need(16);
      const sig = c.str(4);
      if (sig !== '8BIM' && sig !== '8B64') break;
      const key = c.str(4);
      const len = psb && PSB_LONG_KEYS.has(key) ? c.u64() : c.u32();
      const data = c.pos;
      if (key === 'luni' && len >= 4) {
        await c.need(4);
        const n = c.u32();
        if (n * 2 + 4 <= len) {
          await c.need(n * 2);
          let s = '';
          for (let k = 0; k < n; k++) s += String.fromCharCode(c.u16());
          name = s.replace(/\0+$/, '');
        }
      } else if (key === 'lsct' && len >= 4) {
        await c.need(12);
        section = c.u32();
        // A group's own blend mode lives here (the record's says 'norm').
        if (len >= 12 && c.str(4) === '8BIM') groupBlend = c.str(4);
      }
      c.pos = data + len;
    }
    c.pos = extraEnd;
    const key = groupBlend || blend;
    recs.push({ name, top, left, bottom, right, blendMode: BLEND_KEYS[key] || key.trim(), opacity: opacity / 255, hidden: !!(flags & 2), section });
  }
  return recs;
}

// Records are stored bottom layer first; a group is its closing divider
// (section 3), then its children, then the group's own record (section 1 or 2)
// carrying its name. Kept in that bottom-first order, which is ag-psd's.
function recordTree(recs: PsdRecord[]) {
  const root: { children: any[] } = { children: [] };
  const stack: any[] = [root];
  const props = (r: PsdRecord) => ({ name: r.name, hidden: r.hidden, opacity: r.opacity, blendMode: r.blendMode, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  for (const r of recs) {
    const parent = stack[stack.length - 1];
    if (r.section === 3) {
      const g = { children: [] };
      parent.children.push(g);
      stack.push(g);
    } else if (r.section === 1 || r.section === 2) {
      if (stack.length > 1) Object.assign(stack.pop(), props(r));
      else parent.children.push(Object.assign(props(r), { children: [] }));
    } else parent.children.push(props(r));
  }
  return root;
}

async function readPsdStructure(file: File, header: NonNullable<ReturnType<typeof parsePsdHeader>>) {
  const psb = header.version === 2;
  const c = new PsdCursor(file);
  c.pos = 26;
  await c.need(4);
  const cmLen = c.u32(), cmStart = c.pos;
  c.pos += cmLen;
  await c.need(4);
  c.skip32();                                        // image resources
  await c.need(8);
  const lmLen = psb ? c.u64() : c.u32();
  const imageData = c.pos + lmLen;
  let recs: PsdRecord[] = [];
  if (lmLen > 0) {
    try {
      await c.need(8);
      const liLen = psb ? c.u64() : c.u32();
      const liEnd = c.pos + liLen;
      if (liLen > 0) recs = await readLayerRecords(c, psb);
      // 16- and 32-bit documents keep their layers in a global Lr16 / Lr32 block
      // after the global mask info instead, leaving this one empty.
      if (!recs.length) {
        c.pos = liEnd;
        await c.need(4);
        c.skip32();
        while (c.pos + 12 <= imageData) {
          await c.need(24);
          // Global blocks are padded to 4 bytes by some writers and not by
          // others: realign on the signature.
          let skip = 0;
          while (skip < 4 && !/^8B(IM|64)$/.test(c.str(4))) { c.pos -= 3; skip++; }
          if (skip === 4) break;
          const key = c.str(4);
          const len = psb && PSB_LONG_KEYS.has(key) ? c.u64() : c.u32();
          const data = c.pos;
          if (key === 'Lr16' || key === 'Lr32' || key === 'Layr') { recs = await readLayerRecords(c, psb); break; }
          c.pos = data + len;
        }
      }
    } catch (_) { recs = []; }
  }
  let palette: Uint8Array | null = null;
  if (header.mode === 2 && cmLen >= 768) {
    c.pos = cmStart;
    await c.need(768);
    palette = c.sub(768).slice();
  }
  return { tree: recordTree(recs), layerCount: recs.length, imageData, palette };
}

function unpackBits(src: Uint8Array, out: Uint8Array) {
  let i = 0, o = 0;
  while (i < src.length && o < out.length) {
    const n = src[i++];
    if (n < 128) {
      const e = Math.min(o + n + 1, out.length);
      out.set(src.subarray(i, i + (e - o)), o);
      i += n + 1; o = e;
    } else if (n > 128) {
      const cnt = 257 - n;
      out.fill(src[i++], o, Math.min(o + cnt, out.length));
      o += cnt;
    }
  }
  if (o < out.length) out.fill(0, o);
  return out;
}

function labToRgb(l8: number, a8: number, b8: number) {
  const L = l8 * 100 / 255, A = a8 - 128, B = b8 - 128;
  const fy = (L + 16) / 116, fx = A / 500 + fy, fz = fy - B / 200;
  const f = (t: number) => t * t * t > 0.008856 ? t * t * t : (t - 16 / 116) / 7.787;
  const x = 0.95047 * f(fx), y = f(fy), z = 1.08883 * f(fz);
  const g = (v: number) => {
    v = v > 0.0031308 ? 1.055 * Math.pow(v, 1 / 2.4) - 0.055 : 12.92 * v;
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  };
  return [g(x * 3.2406 - y * 1.5372 - z * 0.4986), g(-x * 0.9689 + y * 1.8758 + z * 0.0415), g(x * 0.0557 - y * 0.2040 + z * 1.0570)];
}

// The merged image, sampled every k-th row and column into a canvas at most
// PSD_STREAM_PREVIEW_SIDE on its long side. Raw and PackBits only (ZIP is rare
// here); null when it can't be read or holds a blank placeholder, which is what
// a file saved without "Maximize Compatibility" carries.
async function decodePsdComposite(file: File, header: NonNullable<ReturnType<typeof parsePsdHeader>>, imageData: number, palette: Uint8Array | null, onProgress: (f: number) => void) {
  const { width: W, height: H, depth, mode, channels } = header;
  if (!W || !H || ![1, 8, 16, 32].includes(depth)) return null;
  const head = new Uint8Array(await file.slice(imageData, imageData + 2).arrayBuffer());
  if (head.length < 2) return null;
  const comp = (head[0] << 8) | head[1];
  if (comp !== 0 && comp !== 1) return null;
  const want = mode === 3 || mode === 9 ? 3 : mode === 4 ? 4 : 1;
  if (channels < want || (mode === 2 && (!palette || depth !== 8))) return null;
  const k = Math.max(1, Math.ceil(Math.max(W, H) / PSD_STREAM_PREVIEW_SIDE));
  const ow = Math.ceil(W / k), oh = Math.ceil(H / k);
  const rowBytes = Math.ceil(W * depth / 8);

  const pieces: { off: number; len: number; ch: number; oy: number }[] = [];
  if (comp === 0) {
    const plane = rowBytes * H;
    for (let ch = 0; ch < want; ch++) {
      for (let oy = 0; oy < oh; oy++) pieces.push({ off: imageData + 2 + ch * plane + oy * k * rowBytes, len: rowBytes, ch, oy });
    }
  } else {
    const cw = header.version === 2 ? 4 : 2;
    const n = channels * H;
    const tbl = new Uint8Array(await file.slice(imageData + 2, imageData + 2 + n * cw).arrayBuffer());
    if (tbl.length < n * cw) return null;
    const tv = new DataView(tbl.buffer);
    let off = imageData + 2 + n * cw;
    for (let ch = 0; ch < want; ch++) {
      for (let y = 0; y < H; y++) {
        const i = (ch * H + y) * cw;
        const len = cw === 2 ? tv.getUint16(i) : tv.getUint32(i);
        if (y % k === 0) pieces.push({ off, len, ch, oy: y / k });
        off += len;
      }
    }
  }

  const planes = Array.from({ length: want }, () => new Uint8Array(ow * oh));
  const rowBuf = new Uint8Array(rowBytes);
  const GAP = 1024 * 1024, BATCH = 16 * 1024 * 1024;
  for (let i = 0; i < pieces.length;) {
    let j = i;
    const s = pieces[i].off;
    while (j + 1 < pieces.length && pieces[j + 1].off - (pieces[j].off + pieces[j].len) <= GAP && pieces[j + 1].off + pieces[j + 1].len - s <= BATCH) j++;
    const buf = new Uint8Array(await file.slice(s, pieces[j].off + pieces[j].len).arrayBuffer());
    for (let p = i; p <= j; p++) {
      const pc = pieces[p];
      const src = buf.subarray(pc.off - s, pc.off - s + pc.len);
      const r = comp ? unpackBits(src, rowBuf) : src;
      const plane = planes[pc.ch], base = pc.oy * ow;
      const dv = depth === 32 ? new DataView(r.buffer, r.byteOffset, r.byteLength) : null;
      for (let ox = 0; ox < ow; ox++) {
        const x = ox * k;
        let v;
        if (depth === 8) v = r[x];
        else if (depth === 16) v = r[2 * x];
        else if (dv) {
          // 32-bit documents are linear light.
          const f = 4 * x + 4 <= r.length ? dv.getFloat32(4 * x) : 0;
          v = f <= 0 ? 0 : f >= 1 ? 255 : Math.round(Math.pow(f, 1 / 2.2) * 255);
        } else v = (r[x >> 3] >> (7 - (x & 7))) & 1 ? 0 : 255;
        plane[base + ox] = v || 0;
      }
    }
    onProgress((j + 1) / pieces.length);
    i = j + 1;
  }

  const canvas = el('canvas', { width: ow, height: oh }) as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(ow, oh);
  const d = img.data;
  let uniform = true;
  for (let i = 0; i < ow * oh; i++) {
    let r, g, b;
    if (mode === 3) { r = planes[0][i]; g = planes[1][i]; b = planes[2][i]; }
    else if (mode === 4) {
      // CMYK is stored inverted (255 = no ink).
      const kk = planes[3][i];
      r = planes[0][i] * kk / 255; g = planes[1][i] * kk / 255; b = planes[2][i] * kk / 255;
    } else if (mode === 9) [r, g, b] = labToRgb(planes[0][i], planes[1][i], planes[2][i]);
    else if (mode === 2) { const v = planes[0][i]; r = palette![v]; g = palette![256 + v]; b = palette![512 + v]; }
    else r = g = b = planes[0][i];
    d[4 * i] = r; d[4 * i + 1] = g; d[4 * i + 2] = b; d[4 * i + 3] = 255;
    if (uniform && i && (d[4 * i] !== d[0] || d[4 * i + 1] !== d[1] || d[4 * i + 2] !== d[2])) uniform = false;
  }
  if (uniform) return null;
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function opacityPct(layer: any) {
  let o = layer.opacity;
  if (o == null) return 100;
  if (o > 1) o = o / 255;
  return Math.round(o * 100);
}

// Append an HTMLCanvasElement (composite or layer) as a responsive preview, with
// an "analyse this image" hop that rasterises it to a PNG for the photo pipeline.
function canvasPreviewCard(canvas: HTMLCanvasElement, heading: ElChild | ElChild[], fileBase: string) {
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, heading));
  canvas.classList.add('anr-iwork-preview');
  card.appendChild(canvas);
  const analyse = el('button', { type: 'button', class: 'anr-btn' }, 'Analyse this image');
  analyse.addEventListener('click', () => {
    canvas.toBlob((blob: Blob|null) => {
      if (blob && window._anrHandleFile) window._anrHandleFile(new File([blob], (fileBase || 'composite') + '.png', { type: 'image/png' }), { nested: true });
    }, 'image/png');
  });
  card.appendChild(analyse);
  return card;
}

// Append an embedded JPEG thumbnail (Uint8Array) as a preview image.
function thumbPreviewCard(jpegBytes: BlobPart, heading: ElChild | ElChild[], fileBase: string) {
  const blob = new Blob([jpegBytes], { type: 'image/jpeg' });
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, heading));
  card.appendChild(blobImg(blob, { alt: 'Embedded preview', class: 'anr-iwork-preview' }));
  const analyse = el('button', { type: 'button', class: 'anr-btn' }, 'Analyse this image');
  analyse.addEventListener('click', () => {
    if (window._anrHandleFile) window._anrHandleFile(new File([jpegBytes], (fileBase || 'preview') + '.jpg', { type: 'image/jpeg' }), { nested: true });
  });
  card.appendChild(analyse);
  return card;
}

// Flatten the layer tree into rows (depth for indentation), groups included.
function flattenLayers(children: any[], depth: number, out: any[]) {
  for (const layer of children || []) {
    const isGroup = Array.isArray(layer.children);
    out.push({ layer, depth, isGroup });
    if (isGroup) flattenLayers(layer.children, depth + 1, out);
  }
  return out;
}

// A pixel layer's dimensions from its bounds (ag-psd: left/top/right/bottom).
function layerSize(layer: any) {
  return { w: (layer.right || 0) - (layer.left || 0), h: (layer.bottom || 0) - (layer.top || 0) };
}

// Download a layer's pixels as a PNG. Returns a button, or null for a layer with
// no raster (groups, adjustment layers).
function layerPngButton(layer: any) {
  if (!layer.canvas || !layer.canvas.width) return null;
  const btn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm anr-psd-export', title: 'Download this layer as a PNG' }, 'PNG');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    layer.canvas.toBlob((blob: Blob) => {
      if (!blob) return;
      downloadBlob((layer.name || 'layer').replace(/[^\w.-]+/g, '_').slice(0, 80) + '.png', blob);
    }, 'image/png');
  });
  return btn;
}

function layerTreeCard(psd: any) {
  const rows = flattenLayers(psd.children, 0, []);
  if (!rows.length) return null;
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, `Layers (${rows.length})`));

  // Hidden-content scan: layers carrying pixels you can't see in the composite -
  // toggled off, fully transparent, or collapsed to zero size. A classic place to
  // stash content (watermarks, earlier drafts, notes) that a flattened export drops.
  const flagged = [];
  for (const r of rows) {
    const reasons = [];
    if (r.layer.hidden) reasons.push('hidden');
    if (opacityPct(r.layer) === 0) reasons.push('opacity 0');
    if (!r.isGroup) { const s = layerSize(r.layer); if (s.w === 0 || s.h === 0) reasons.push('zero size'); }
    r.reasons = reasons;
    if (reasons.length) flagged.push(r);
  }
  if (flagged.length) {
    card.appendChild(el('p', { class: 'anr-hint', style: 'color:var(--accent);font-weight:600;margin:0 0 8px;' },
      '⚠ ' + flagged.length + ' of ' + rows.length + ' layers hold content you cannot see (switched off, fully see-through, or zero-size) - not part of the flattened image shown here.'));
  }

  const list = el('div', { class: 'anr-psd-layers' });
  for (const r of rows) {
    const { layer, depth, isGroup } = r;
    const flaggedCls = r.reasons.length ? ' anr-psd-flagged' : '';
    // NB: use a dedicated greyed class, not the global `is-hidden` utility (which is
    // display:none !important and would drop the row - exactly the content we want to surface).
    const row = el('div', { class: 'anr-psd-layer' + (layer.hidden ? ' anr-psd-off' : '') + flaggedCls });
    row.style.paddingLeft = (depth * 16) + 'px';
    const thumb = el('span', { class: 'anr-psd-thumb' });
    if (!isGroup && layer.canvas && layer.canvas.width) {
      const c = layer.canvas;
      const scale = 28 / Math.max(c.width, c.height);
      const tc = el('canvas', { width: Math.max(1, Math.round(c.width * scale)), height: Math.max(1, Math.round(c.height * scale)) });
      tc.getContext('2d')!.drawImage(c, 0, 0, tc.width, tc.height);
      thumb.appendChild(tc);
    } else {
      thumb.textContent = isGroup ? '▸' : '·';
    }
    row.appendChild(thumb);
    const meta = el('span', { class: 'anr-psd-meta' });
    meta.appendChild(el('span', { class: 'anr-psd-name' }, layer.name || (isGroup ? 'Group' : 'Layer')));
    const bits = [];
    if (layer.blendMode && layer.blendMode !== 'normal') bits.push(layer.blendMode.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
    const op = opacityPct(layer);
    if (op !== 100) bits.push(op + '%');
    for (const reason of r.reasons) if (reason !== 'opacity 0' || op !== 100) bits.push(reason);
    if (bits.length) meta.appendChild(el('span', { class: 'anr-psd-sub' }, [...new Set(bits)].join(' · ')));
    row.appendChild(meta);
    const png = layerPngButton(layer);
    if (png) row.appendChild(png);
    list.appendChild(row);
  }
  card.appendChild(list);
  return card;
}

function metaCard(file: File, header: any, layerCount: number|null) {
  const card = el('div', { class: 'anr-card' });
  const [h, help] = h3help('Photoshop document', 'An Adobe Photoshop file. Analyser shows the preview image saved inside it and, where it can, the list of layers it is built from.');
  card.appendChild(h); card.appendChild(help);
  const tbl = el('table', { class: 'anr-readout' });
  const isPsb = header && header.version === 2;
  tbl.appendChild(row('Format', isPsb ? 'Photoshop Large Document (PSB)' : 'Photoshop document (PSD)'));
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  if (header) {
    if (header.width && header.height) tbl.appendChild(row('Dimensions', header.width + ' × ' + header.height + ' px'));
    const mode = COLOR_MODES[header.mode];
    if (mode) tbl.appendChild(rowHelp('Colour mode', mode, 'How the file stores colour. RGB is normal screen colour and CMYK is for print; Indexed, Lab, Duotone and Multichannel are specialist modes for particular workflows.'));
    if (header.depth) tbl.appendChild(row('Bit depth', header.depth + '-bit'));
    if (header.channels) tbl.appendChild(row('Channels', String(header.channels)));
  }
  if (layerCount != null) tbl.appendChild(rowHelp('Layers', String(layerCount), 'A Photoshop image is built from stacked layers, like sheets of transparent film. Layers that are hidden or switched off can still hold content you will not see in the flattened picture.'));
  card.appendChild(tbl);
  return card;
}

export async function renderPsd(file: File, resultsEl: HTMLElement) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading Photoshop file "${file.name}"…`));

  // ---- Path 1: light header + embedded-thumbnail read (always, memory-safe). ----
  let header = null;
  try {
    const slice = new Uint8Array(await file.slice(0, HEADER_SLICE).arrayBuffer());
    header = parsePsdHeader(slice);
  } catch (_) { header = null; }

  const base = file.name.replace(/\.[^.]+$/, '');
  // ag-psd only handles RGB(3)/Grayscale(1), 8-bit, PSD (not PSB), under the size limit.
  const agPsdViable = !!header && header.version === 1 && header.depth === 8 &&
    (header.mode === 3 || header.mode === 1) && file.size <= AGPSD_SIZE_LIMIT &&
    header.width * header.height <= PSD_DECODE_MAX_PX;

  // ---- Path 2: full composite + layer tree via ag-psd (only when viable). ----
  if (agPsdViable) {
    try {
      const agPsd = await loadAgPsd();
      if (agPsd) {
        const buf = await file.arrayBuffer();
        const psd = agPsd.readPsd(buf, { skipThumbnail: true });
        if (psd) {
          resultsEl.innerHTML = '';
          const layerCount = flattenLayers(psd.children, 0, []).length;
          resultsEl.appendChild(metaCard(file, header, layerCount));
          if (psd.canvas && psd.canvas.width) {
            resultsEl.insertBefore(canvasPreviewCard(psd.canvas, 'Composite image', base), resultsEl.firstChild);
          } else if (header && header.thumb) {
            resultsEl.insertBefore(thumbPreviewCard(header.thumb as BlobPart, 'Embedded preview', base), resultsEl.firstChild);
          } else {
            resultsEl.appendChild(el('div', { class: 'anr-info' },
              'This file does not include a ready-made flattened preview (it was saved with Photoshop’s "Maximize Compatibility" option turned off), so the individual layers are shown below instead.'));
          }
          const lt = layerTreeCard(psd);
          if (lt) resultsEl.appendChild(lt);
          return;
        }
      }
    } catch (_) { /* fall through to the thumbnail path below */ }
  }

  // ---- Fallback: metadata + embedded thumbnail (CMYK / 16-bit / PSB / huge / ag-psd failure). ----
  resultsEl.innerHTML = '';
  if (!header) {
    resultsEl.appendChild(errorCard('This does not look like a valid Photoshop file, or it could not be read.'));
    resultsEl.appendChild(integrityCard(file));
    return;
  }
  // Structural read: the layer list from the records and the flattened image
  // decoded row by row at reduced size, straight from the file.
  const status = el('div', { class: 'anr-info' }, 'Reading the layer list and the flattened image…');
  resultsEl.appendChild(status);
  let struct: Awaited<ReturnType<typeof readPsdStructure>> | null = null;
  let composite: HTMLCanvasElement | null = null;
  try { struct = await readPsdStructure(file, header); } catch (_) { struct = null; }
  if (struct) {
    try {
      composite = await decodePsdComposite(file, header, struct.imageData, struct.palette,
        (f) => { status.textContent = 'Decoding the flattened image… ' + Math.round(f * 100) + '%'; });
    } catch (_) { composite = null; }
  }
  if (!status.isConnected) return;   // another file was dropped meanwhile
  resultsEl.innerHTML = '';
  resultsEl.appendChild(metaCard(file, header, struct && struct.layerCount ? struct.layerCount : null));
  const why = [];
  if (header.mode !== 3 && header.mode !== 1) why.push((COLOR_MODES[header.mode] || 'this colour mode'));
  if (header.depth !== 8) why.push(header.depth + '-bit');
  if (header.version === 2) why.push('PSB');
  if (file.size > AGPSD_SIZE_LIMIT) why.push('very large file');
  else if (header.width * header.height > PSD_DECODE_MAX_PX) why.push('very large canvas');
  const layerTree = struct && struct.layerCount ? layerTreeCard(struct.tree) : null;
  if (composite) {
    const reduced = composite.width < header.width;
    resultsEl.insertBefore(canvasPreviewCard(composite, reduced ? 'Composite image (shown at ' + composite.width + ' × ' + composite.height + ')' : 'Composite image', base), resultsEl.firstChild);
    resultsEl.appendChild(el('div', { class: 'anr-info' },
      'The flattened image was decoded straight from the file' + (reduced ? ', reduced for display' : '') +
      '. Layer pixels are not unpacked' + (why.length ? ' (' + why.join(', ') + ')' : '') +
      (layerTree ? ', but every layer is listed below.' : '.')));
    if (layerTree) resultsEl.appendChild(layerTree);
  } else if (header.thumb) {
    resultsEl.insertBefore(thumbPreviewCard(header.thumb as BlobPart, 'Embedded preview', base), resultsEl.firstChild);
    resultsEl.appendChild(el('div', { class: 'anr-info' },
      'Showing the preview image Photoshop saved inside the file. Its layers are not being unpacked here' +
      (why.length ? ' (' + why.join(', ') + ')' : '') + ' - the built-in PSD reader can only unpack standard RGB or Grayscale 8-bit documents' +
      (layerTree ? ', but every layer is listed below.' : '.')));
    if (layerTree) resultsEl.appendChild(layerTree);
  } else {
    resultsEl.appendChild(el('div', { class: 'anr-info' },
      'This file has no built-in preview image (it was saved with Photoshop’s "Maximize Compatibility" option turned off)' +
      ((header.mode !== 3 && header.mode !== 1) || header.depth !== 8 || header.version === 2
        ? ', and its colour mode or bit depth is not one the built-in layer reader supports'
        : header.width * header.height > PSD_DECODE_MAX_PX ? ', and its canvas is too large to unpack safely in the browser' : '') +
      (layerTree ? ', so only its metadata and layer list can be shown.' : ', so only its metadata can be shown.')));
    if (layerTree) resultsEl.appendChild(layerTree);
  }
}
