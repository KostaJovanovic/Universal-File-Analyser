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

   ag-psd does not support CMYK / Lab / 16-bit / PSB and re-composites nothing, so
   for those we rely on path 1's embedded thumbnail rather than failing. */

import { el, row, rowHelp, h3help, fmtBytes, sha256Row, integrityCard, errorCard } from '../core/util.js';
import { loadScript } from '../core/util.js';

const AGPSD_URL = 'assets/vendor/ag-psd/bundle.js';
// Above this size, or for colour modes ag-psd can't handle, we skip the heavy
// full-decode and show the embedded thumbnail instead (decoding every layer of a
// huge PSD would exhaust the tab's memory).
const AGPSD_SIZE_LIMIT = 120 * 1024 * 1024;
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
function parsePsdHeader(bytes) {
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
    thumb: null,
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

function opacityPct(layer) {
  let o = layer.opacity;
  if (o == null) return 100;
  if (o > 1) o = o / 255;
  return Math.round(o * 100);
}

// Append an HTMLCanvasElement (composite or layer) as a responsive preview, with
// an "analyse this image" hop that rasterises it to a PNG for the photo pipeline.
function canvasPreviewCard(canvas, heading, fileBase) {
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, heading));
  canvas.classList.add('anr-iwork-preview');
  card.appendChild(canvas);
  const analyse = el('button', { type: 'button', class: 'anr-btn' }, 'Analyse this image');
  analyse.addEventListener('click', () => {
    canvas.toBlob((blob) => {
      if (blob && window._anrHandleFile) window._anrHandleFile(new File([blob], (fileBase || 'composite') + '.png', { type: 'image/png' }), { nested: true });
    }, 'image/png');
  });
  card.appendChild(analyse);
  return card;
}

// Append an embedded JPEG thumbnail (Uint8Array) as a preview image.
function thumbPreviewCard(jpegBytes, heading, fileBase) {
  const blob = new Blob([jpegBytes], { type: 'image/jpeg' });
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, heading));
  card.appendChild(el('img', { src: URL.createObjectURL(blob), alt: 'Embedded preview', class: 'anr-iwork-preview' }));
  const analyse = el('button', { type: 'button', class: 'anr-btn' }, 'Analyse this image');
  analyse.addEventListener('click', () => {
    if (window._anrHandleFile) window._anrHandleFile(new File([jpegBytes], (fileBase || 'preview') + '.jpg', { type: 'image/jpeg' }), { nested: true });
  });
  card.appendChild(analyse);
  return card;
}

// Flatten the layer tree into rows (depth for indentation), groups included.
function flattenLayers(children, depth, out) {
  for (const layer of children || []) {
    const isGroup = Array.isArray(layer.children);
    out.push({ layer, depth, isGroup });
    if (isGroup) flattenLayers(layer.children, depth + 1, out);
  }
  return out;
}

function layerTreeCard(psd) {
  const rows = flattenLayers(psd.children, 0, []);
  if (!rows.length) return null;
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, `Layers (${rows.length})`));
  const list = el('div', { class: 'anr-psd-layers' });
  for (const { layer, depth, isGroup } of rows) {
    const r = el('div', { class: 'anr-psd-layer' + (layer.hidden ? ' is-hidden' : '') });
    r.style.paddingLeft = (depth * 16) + 'px';
    const thumb = el('span', { class: 'anr-psd-thumb' });
    if (!isGroup && layer.canvas && layer.canvas.width) {
      const c = layer.canvas;
      const scale = 28 / Math.max(c.width, c.height);
      const tc = el('canvas', { width: Math.max(1, Math.round(c.width * scale)), height: Math.max(1, Math.round(c.height * scale)) });
      tc.getContext('2d').drawImage(c, 0, 0, tc.width, tc.height);
      thumb.appendChild(tc);
    } else {
      thumb.textContent = isGroup ? '▸' : '·';
    }
    r.appendChild(thumb);
    const meta = el('span', { class: 'anr-psd-meta' });
    meta.appendChild(el('span', { class: 'anr-psd-name' }, layer.name || (isGroup ? 'Group' : 'Layer')));
    const bits = [];
    if (layer.blendMode && layer.blendMode !== 'normal') bits.push(layer.blendMode.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
    const op = opacityPct(layer);
    if (op !== 100) bits.push(op + '%');
    if (layer.hidden) bits.push('hidden');
    if (bits.length) meta.appendChild(el('span', { class: 'anr-psd-sub' }, bits.join(' · ')));
    r.appendChild(meta);
    list.appendChild(r);
  }
  card.appendChild(list);
  return card;
}

function metaCard(file, header, layerCount) {
  const card = el('div', { class: 'anr-card' });
  const [h, help] = h3help('Photoshop document', 'Adobe Photoshop document. Analyser shows the embedded preview and, where possible, the layer tree.');
  card.appendChild(h); card.appendChild(help);
  const tbl = el('table', { class: 'anr-readout' });
  const isPsb = header && header.version === 2;
  tbl.appendChild(row('Format', isPsb ? 'Photoshop Large Document (PSB)' : 'Photoshop document (PSD)'));
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  if (header) {
    if (header.width && header.height) tbl.appendChild(row('Dimensions', header.width + ' × ' + header.height + ' px'));
    const mode = COLOR_MODES[header.mode];
    if (mode) tbl.appendChild(row('Colour mode', mode));
    if (header.depth) tbl.appendChild(row('Bit depth', header.depth + '-bit'));
    if (header.channels) tbl.appendChild(row('Channels', String(header.channels)));
  }
  if (layerCount != null) tbl.appendChild(row('Layers', String(layerCount)));
  tbl.appendChild(sha256Row(file));
  card.appendChild(tbl);
  return card;
}

export async function renderPsd(file, resultsEl) {
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
    (header.mode === 3 || header.mode === 1) && file.size <= AGPSD_SIZE_LIMIT;

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
            resultsEl.appendChild(canvasPreviewCard(psd.canvas, 'Composite image', base));
          } else if (header && header.thumb) {
            resultsEl.appendChild(thumbPreviewCard(header.thumb, 'Embedded preview', base));
          } else {
            resultsEl.appendChild(el('div', { class: 'anr-info' },
              'This file has no embedded composite (it was saved without "Maximize Compatibility"), so the layers below are shown instead.'));
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
  resultsEl.appendChild(metaCard(file, header, null));
  if (header.thumb) {
    resultsEl.appendChild(thumbPreviewCard(header.thumb, 'Embedded preview', base));
    const why = [];
    if (header.mode !== 3 && header.mode !== 1) why.push((COLOR_MODES[header.mode] || 'this colour mode'));
    if (header.depth !== 8) why.push(header.depth + '-bit');
    if (header.version === 2) why.push('PSB');
    if (file.size > AGPSD_SIZE_LIMIT) why.push('very large file');
    resultsEl.appendChild(el('div', { class: 'anr-info' },
      'Showing the preview Photoshop embedded in the file. Full layer decoding is skipped here' +
      (why.length ? ' (' + why.join(', ') + ')' : '') + ' - the in-browser PSD decoder handles RGB / Grayscale 8-bit documents.'));
  } else {
    resultsEl.appendChild(el('div', { class: 'anr-info' },
      'This file has no embedded preview (it was saved without "Maximize Compatibility")' +
      ((header.mode !== 3 && header.mode !== 1) || header.depth !== 8 || header.version === 2
        ? ', and its colour mode / depth is not supported by the in-browser layer decoder' : '') +
      ', so only its metadata can be shown.'));
  }
}
