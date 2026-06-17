/* Analyser - raster painting apps (Krita .kra / Procreate)
   ============================================================================
   Both are ZIP packages that bake in a flattened raster preview of the artwork:
   - Krita .kra      -> mergedimage.png (full-resolution merged image), plus
     maindoc.xml describing the canvas (dimensions, colour space, layers) and the
     Krita version that wrote it. preview.png is a smaller thumbnail fallback.
   - Procreate       -> QuickLook/Thumbnail.png (a capped preview), with the
     real per-layer artwork stored as private chunked data we can't recompose.
   So we show the embedded preview - a faithful look at the image - alongside
   whatever canvas metadata the package carries. GIMP .xcf is NOT a ZIP and has
   no embedded preview, so it stays identification-only. */

import { el, row, rowHelp, fmtBytes, integrityCard, errorCard } from '../core/util.js';
import { openZip } from './zip.js';
import { parsePlist } from '../lib/plist.js';

// Largest entry whose name matches the predicate (by uncompressed size), or null.
function largestMatch(zip, re) {
  let best = null;
  for (const e of zip.entries) {
    if (re.test(e.name) && (!best || e.uncompSize > best.uncompSize)) best = e;
  }
  return best;
}

const xmlAttr = (s, name) => (s.match(new RegExp('\\b' + name + '="([^"]*)"', 'i')) || [])[1] || '';

function parseKraMain(text) {
  const img = (text.match(/<IMAGE\b[^>]*>/i) || [''])[0];
  const layers = (text.match(/<layer\b/gi) || []).length;
  return {
    width: xmlAttr(img, 'width'),
    height: xmlAttr(img, 'height'),
    colorspace: xmlAttr(img, 'colorspacename'),
    xres: xmlAttr(img, 'x-res'),
    name: xmlAttr(img, 'name'),
    kritaVersion: xmlAttr(text.match(/<DOC\b[^>]*>/i) ? text.match(/<DOC\b[^>]*>/i)[0] : '', 'kritaVersion'),
    layers,
  };
}

// Append the embedded preview image as a card with an "analyse this image" hop.
function appendPreview(resultsEl, bytes, ext, heading) {
  const mime = 'image/' + (ext === 'jpg' ? 'jpeg' : ext);
  const blob = new Blob([bytes], { type: mime });
  const pcard = el('div', { class: 'anr-card' });
  pcard.appendChild(el('h3', {}, heading || 'Preview'));
  pcard.appendChild(el('img', { src: URL.createObjectURL(blob), alt: 'Artwork preview', class: 'anr-iwork-preview' }));
  const analyse = el('button', { type: 'button', class: 'anr-btn' }, 'Analyse this image');
  analyse.addEventListener('click', () => {
    if (window._anrHandleFile) window._anrHandleFile(new File([bytes], 'preview.' + ext, { type: mime }), { nested: true });
  });
  pcard.appendChild(analyse);
  resultsEl.appendChild(pcard);
}

async function renderKra(file, zip, resultsEl) {
  let main = null;
  const mainEntry = zip.entries.find((e) => /(^|\/)maindoc\.xml$/i.test(e.name));
  if (mainEntry) {
    try { const b = await zip.bytes(mainEntry.name); if (b) main = parseKraMain(new TextDecoder().decode(b)); } catch (_) {}
  }

  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Krita document'));
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Application', 'Krita'));
  tbl.appendChild(rowHelp('Format', 'Krita archive (.kra)', 'A .kra is a ZIP package; Analyser shows the merged-image preview Krita stores inside, plus the canvas metadata from maindoc.xml.'));
  if (main) {
    if (main.width && main.height) tbl.appendChild(row('Canvas', main.width + ' × ' + main.height + ' px'));
    if (main.colorspace) tbl.appendChild(row('Colour space', main.colorspace));
    if (main.xres) tbl.appendChild(row('Resolution', Math.round(parseFloat(main.xres)) + ' dpi'));
    if (main.layers) tbl.appendChild(row('Layers', String(main.layers)));
    if (main.kritaVersion) tbl.appendChild(row('Krita version', main.kritaVersion));
  }
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  card.appendChild(tbl);
  resultsEl.appendChild(card);

  const png = zip.entries.find((e) => /(^|\/)mergedimage\.png$/i.test(e.name)) || zip.entries.find((e) => /(^|\/)preview\.png$/i.test(e.name));
  if (png) {
    const bytes = await zip.bytes(png.name).catch(() => null);
    if (bytes) { appendPreview(resultsEl, bytes, 'png', /merged/i.test(png.name) ? 'Merged image' : 'Preview'); return; }
  }
  resultsEl.appendChild(el('div', { class: 'anr-info' }, 'This .kra has no embedded merged-image preview, so only its metadata is shown.'));
  resultsEl.appendChild(integrityCard(file));
}

// Procreate document.archive is an NSKeyedArchiver binary plist; the canvas size
// is stored as a "{width, height}" string somewhere in the object graph. Pull it
// out best-effort without modelling the whole archive.
function findSizeToken(node, seen) {
  if (node == null) return '';
  if (typeof node === 'string') return /^\{\s*\d+(\.\d+)?\s*,\s*\d+(\.\d+)?\s*\}$/.test(node) ? node : '';
  if (typeof node !== 'object') return '';
  if (seen.has(node)) return ''; seen.add(node);
  const vals = Array.isArray(node) ? node : Object.values(node);
  for (const v of vals) { const r = findSizeToken(v, seen); if (r) return r; }
  return '';
}

async function renderProcreate(file, zip, resultsEl) {
  let size = '';
  const archive = zip.entries.find((e) => /(^|\/)document\.archive$/i.test(e.name));
  if (archive) {
    try {
      const b = await zip.bytes(archive.name);
      const parsed = b && await parsePlist(b);
      if (parsed) size = findSizeToken(parsed.value, new WeakSet());
    } catch (_) {}
  }

  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Procreate document'));
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Application', 'Procreate'));
  tbl.appendChild(rowHelp('Format', 'Procreate document', 'A Procreate file is a ZIP package; the per-layer artwork is stored in a private chunked format, so Analyser shows the QuickLook preview Procreate embeds.'));
  if (size) tbl.appendChild(row('Canvas', size.replace(/[{}]/g, '').replace(/\s+/g, '').replace(',', ' × ') + ' px'));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  card.appendChild(tbl);
  resultsEl.appendChild(card);

  const thumb = largestMatch(zip, /thumbnail[^/]*\.png$/i) || largestMatch(zip, /\.png$/i);
  if (thumb) {
    const bytes = await zip.bytes(thumb.name).catch(() => null);
    if (bytes) { appendPreview(resultsEl, bytes, 'png', 'Preview'); return; }
  }
  resultsEl.appendChild(el('div', { class: 'anr-info' }, 'This Procreate file has no embedded thumbnail, so only its metadata is shown.'));
  resultsEl.appendChild(integrityCard(file));
}

function b64ToBytes(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function renderPdn(file, resultsEl) {
  // Header: 'PDN3' (4) + uint24 LE XML length (3) + that many bytes of UTF-8 XML.
  let head;
  try { head = new Uint8Array(await file.slice(0, 7).arrayBuffer()); } catch (_) { head = null; }
  if (!head || head.length < 7 || String.fromCharCode(head[0], head[1], head[2], head[3]) !== 'PDN3') {
    const { renderProprietary } = await import('./proprietary.js');
    return renderProprietary(file, resultsEl);
  }
  const xmlLen = head[4] | (head[5] << 8) | (head[6] << 16);
  let xml = '';
  try { xml = new TextDecoder('utf-8').decode(new Uint8Array(await file.slice(7, 7 + xmlLen).arrayBuffer())); } catch (_) {}
  const attr = (n) => (xml.match(new RegExp(n + '="([^"]*)"')) || [])[1] || '';
  const width = attr('width'), height = attr('height'), layers = attr('layers'), ver = attr('savedWithVersion');

  resultsEl.innerHTML = '';
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Paint.NET image'));
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Application', 'Paint.NET'));
  tbl.appendChild(rowHelp('Format', 'Paint.NET image (.pdn)', 'A .pdn stores the layered Paint.NET document; Analyser shows the flattened preview Paint.NET embeds in the header, plus the canvas metadata.'));
  if (width && height) tbl.appendChild(row('Canvas', width + ' × ' + height + ' px'));
  if (layers) tbl.appendChild(row('Layers', layers));
  if (ver) tbl.appendChild(row('Saved with version', ver));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  card.appendChild(tbl);
  resultsEl.appendChild(card);

  const m = xml.match(/<thumb\s+png="([^"]*)"/i);
  if (m) {
    try { appendPreview(resultsEl, b64ToBytes(m[1]), 'png', 'Preview'); return; } catch (_) {}
  }
  resultsEl.appendChild(el('div', { class: 'anr-info' }, 'This .pdn has no embedded preview, so only its metadata is shown.'));
  resultsEl.appendChild(integrityCard(file));
}

export async function renderPaint(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading "${file.name}"…`));

  const ext = (file.name.split('.').pop() || '').toLowerCase();

  // Paint.NET .pdn isn't a ZIP - it's a "PDN3" header + a UTF-8 XML block (with an
  // embedded PNG preview) + .NET-serialised layer data. Handle it before openZip.
  if (ext === 'pdn') return renderPdn(file, resultsEl);

  let zip;
  try { zip = await openZip(file); }
  catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read this file: ' + (e && e.message)));
    return;
  }
  if (!zip.entries.length) {
    // Not a ZIP after all - hand off to the identifier so it is still read.
    const { renderProprietary } = await import('./proprietary.js');
    return renderProprietary(file, resultsEl);
  }
  resultsEl.innerHTML = '';

  if (ext === 'kra') return renderKra(file, zip, resultsEl);
  return renderProcreate(file, zip, resultsEl);
}
