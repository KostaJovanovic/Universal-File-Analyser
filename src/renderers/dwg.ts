/* Analyser - AutoCAD DWG viewer
   ============================================================================
   DWG is AutoCAD's native binary drawing format. Uses the vendored libredwg-web
   (LibreDWG compiled to WebAssembly, ~6 MB, lazy-loaded) to parse the drawing
   into an entity database and render it to an SVG, shown as a 2D preview - the
   same idea as the DXF viewer, but for the binary format. Nothing is uploaded. */

import { el, row, rowHelp, h3help, fmtBytes, errorCard } from '../core/util.js';
import { findBytes, dibToBmp } from '../core/binutil.js';
import { PREVIEW_CARVE_MAX } from '../core/limits.js';
import { buildEmbeddedImagesCard, type EmbeddedImageItem } from './embedded-images.js';
import { sanitizeSvgMarkup } from './svg.js';

const DIST_URL = new URL('../../vendor/libredwg/dist/libredwg-web.js', import.meta.url).href;
const WASM_DIR = new URL('../../vendor/libredwg/wasm', import.meta.url).href;

/* The lazily-loaded libredwg-web instance. It is a WASM module handle with no
   type information of its own, so `any` here is the honest description. */
let _lib: Promise<{ inst: any; FT: any }> | null = null;
async function getLib() {
  if (!_lib) _lib = (async () => {
    const mod = await import(DIST_URL);
    const inst = await mod.LibreDwg.create(WASM_DIR);
    return { inst, FT: mod.Dwg_File_Type };
  })();
  return _lib;
}

/* --------------------------------------------------------- stored preview -- */

/* AutoCAD saves a raster of the drawing inside the file so Explorer, drawing
   managers and title-block tools can show a thumbnail without running a CAD
   engine. It lives in its own section wrapped in a fixed 16-byte sentinel, and
   that sentinel has not changed since R13.

   R13-R2000 keeps a plain "image seeker" pointer to it at offset 0x0D, so that is
   tried first and costs nothing. R2004+ replaced the seeker with an obfuscated
   section map that would have to be decoded to follow, so those files fall back
   to scanning for the sentinel - a linear pass over bytes that are already in
   memory for the parser, and only reached when the cheap route is unavailable.

   The preview is worth having in its own right: it is what the drawing looked
   like when AutoCAD last saved it, which is not necessarily what the geometry
   below renders as - and it survives files LibreDWG cannot parse at all. */
const IMAGE_SENTINEL = [0x1F, 0x25, 0x6D, 0x07, 0xD4, 0x36, 0x28, 0x28,
                        0x9D, 0x57, 0xCA, 0x3F, 0x9D, 0x44, 0x10, 0x5C];

/** What one carved preview entry turned out to be. `null` means "found, but
    nothing a browser can paint" - a WMF vector preview - which the card still
    wants to know about so it can say so rather than silently dropping it. */
type DwgPreview = { blob: Blob; label: string; bytes: number } | null;

// Identify one preview entry. The type code in the directory is a hint only: the
// bytes are sniffed, because a BMP entry is stored headerless (a bare DIB) in
// every version but occasionally arrives with its file header already attached,
// and R2013+ added PNG under a code older readers ignore.
function sniffPreview(data: Uint8Array): DwgPreview {
  if (data.length < 16) return null;
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) {
    return { blob: new Blob([data as BlobPart], { type: 'image/png' }), label: 'PNG', bytes: data.length };
  }
  if (data[0] === 0x42 && data[1] === 0x4D) {            // already a complete .bmp
    return { blob: new Blob([data as BlobPart], { type: 'image/bmp' }), label: 'BMP', bytes: data.length };
  }
  const bmp = dibToBmp(data);
  if (bmp) return { blob: new Blob([bmp as BlobPart], { type: 'image/bmp' }), label: 'BMP', bytes: data.length };
  return null;                                            // WMF, or unreadable
}

/** Carve every browser-paintable image out of the DWG image-data section, plus a
    count of the entries found but not showable, so the caller can mention them. */
function dwgPreviews(bytes: Uint8Array, baseName: string) {
  const items: EmbeddedImageItem[] = [];
  let skipped = 0;

  // R13-R2000: the seeker at 0x0D points straight at the sentinel. Trust it only
  // when the sentinel is actually there, then fall back to the scan.
  let at = -1;
  if (bytes.length > 0x11) {
    const seek = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0x0D, true);
    if (seek > 0 && seek + IMAGE_SENTINEL.length <= bytes.length &&
        IMAGE_SENTINEL.every((b, i) => bytes[seek + i] === b)) at = seek;
  }
  if (at < 0) at = findBytes(bytes, IMAGE_SENTINEL);
  if (at < 0) return { items, skipped };

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = at + 16 + 4;                                    // sentinel + overall size
  if (p + 1 > bytes.length) return { items, skipped };
  const count = bytes[p]; p += 1;
  if (!count || count > 16) return { items, skipped };     // a real directory is 1-3 entries

  for (let i = 0; i < count; i++) {
    if (p + 9 > bytes.length) break;
    const code = bytes[p];
    const addr = dv.getUint32(p + 1, true);
    const size = dv.getUint32(p + 5, true);
    p += 9;
    if (code === 1) continue;                              // header data, not an image
    if (!size || size > PREVIEW_CARVE_MAX) continue;
    // Addresses are file-absolute; fall back to sentinel-relative rather than
    // showing nothing for the rare writer that stores them that way.
    let start = addr;
    if (start + size > bytes.length) start = at + addr;
    if (start + size > bytes.length) continue;
    const found = sniffPreview(bytes.subarray(start, start + size));
    if (!found) { skipped++; continue; }
    items.push({
      label: found.label, bytes: found.bytes,
      viewBlob: found.blob, downloadBlob: found.blob,
      downloadName: baseName + '_preview' + (items.length ? '_' + (items.length + 1) : '') +
        (found.label === 'PNG' ? '.png' : '.bmp'),
    });
  }
  return { items, skipped };
}

// The "Saved preview" card, or null when the drawing carries no readable one.
function previewCard(file: File, found: { items: EmbeddedImageItem[]; skipped: number }, resultsEl: HTMLElement) {
  if (!found.items.length) return null;
  return buildEmbeddedImagesCard({
    title: 'Saved preview',
    hint: 'The thumbnail AutoCAD wrote into the file the last time it was saved' +
      (found.skipped
        ? ', alongside ' + found.skipped + ' vector (WMF) preview' + (found.skipped > 1 ? 's' : '') + ' a browser cannot show.'
        : '.'),
    help: 'Every DWG can carry a small picture of itself, written by AutoCAD at save time so Windows Explorer and drawing managers can show a thumbnail without a CAD engine. Because it is stored rather than drawn, it shows the drawing as it stood when AutoCAD last wrote the file - which can differ from the geometry rendered above, and can be read even from a file no CAD engine will open.',
    items: found.items, resultsEl, sourceFile: file,
  });
}

export async function renderDwg(file: File, resultsEl: HTMLElement) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading AutoCAD drawing "${file.name}"… the CAD engine is about 6 MB on first use.`));

  let inst, FT;
  try { ({ inst, FT } = await getLib()); }
  catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not load the DWG engine: ' + (e && e.message)));
    return;
  }

  // Read the file once. The saved preview is carved out of these same bytes and
  // is pulled out before the parse, because a DWG LibreDWG cannot open is exactly
  // the case where the stored thumbnail is the only thing left to show.
  let buf;
  try { buf = await file.arrayBuffer(); }
  catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read this DWG: ' + (e && e.message)));
    return;
  }
  const baseName = (file.name || 'drawing').replace(/\.[^/.]+$/, '');
  let found: { items: EmbeddedImageItem[]; skipped: number } = { items: [], skipped: 0 };
  try { found = dwgPreviews(new Uint8Array(buf), baseName); } catch (_) { /* no preview section */ }

  let db = null, svg = '', ptr = null;
  try {
    ptr = inst.dwg_read_data(buf, FT.DWG);
    if (ptr == null) throw new Error('not a readable DWG file');
    db = inst.convert(ptr);
    try { svg = inst.dwg_to_svg(db); } catch (_) { svg = ''; }
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read this DWG: ' + (e && e.message)));
    if (ptr != null) { try { inst.dwg_free(ptr); } catch (_) {} }
    const pv = previewCard(file, found, resultsEl);
    if (pv) resultsEl.appendChild(pv);
    return;
  }
  if (ptr != null) { try { inst.dwg_free(ptr); } catch (_) {} }

  resultsEl.innerHTML = '';

  // ---- Metadata ----
  const card = el('div', { class: 'anr-card' });
  const [h, help] = h3help('AutoCAD drawing', 'DWG is the native drawing format of AutoCAD, used for 2D technical and architectural drawings. Analyser reads the shapes in the file and renders a flat 2D preview here in the browser.');
  card.appendChild(h); card.appendChild(help);
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Format', 'AutoCAD DWG'));
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  const ents = (db && db.entities) || [];
  tbl.appendChild(rowHelp('Entities', ents.length.toLocaleString(), 'The individual drawing elements in the file - each line, arc, circle, piece of text or dimension counts as one entity. This is the total across the drawing.'));
  const layerTable = db && db.tables && db.tables.LAYER;
  const layers = layerTable && (layerTable.entries || layerTable.records || layerTable.items);
  if (layers && layers.length != null) tbl.appendChild(rowHelp('Layers', String(layers.length), 'Named layers the drawing is organised into. Like transparent overlays, each groups related elements (walls, dimensions, text and so on) so they can be shown, hidden or styled together.'));
  // Top entity types (LINE, CIRCLE, LWPOLYLINE, TEXT, ...).
  const types: Record<string, number> = {};
  for (const e of ents) { const t = (e && e.type) || '?'; types[t] = (types[t] || 0) + 1; }
  const topTypes = Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t, n]) => t + ' ×' + n).join(', ');
  if (topTypes) tbl.appendChild(rowHelp('Entity types', topTypes, 'The most common kinds of drawing element (lines, arcs, circles and so on) found in the main drawing area (model space).'));
  card.appendChild(tbl);
  resultsEl.appendChild(card);

  // ---- Drawing ----
  // The SVG is emitted by LibreDWG from an untrusted DWG. Run it through the
  // same strict allow-list sanitiser as the SVG viewer (strips <script>, on*,
  // <foreignObject>, <style>, SMIL, external/remote refs) rather than a
  // <script>-only regex that leaves event handlers and remote refs intact.
  const safeSvg = svg && /<svg[\s>]/i.test(svg) ? sanitizeSvgMarkup(svg) : null;
  if (safeSvg) {
    const dcard = el('div', { class: 'anr-card' });
    dcard.appendChild(el('h3', {}, 'Drawing'));
    const wrap = el('div', { class: 'anr-dwg-wrap' });
    wrap.innerHTML = safeSvg;
    dcard.appendChild(wrap);
    resultsEl.insertBefore(dcard, resultsEl.firstChild);
  } else {
    resultsEl.appendChild(el('div', { class: 'anr-info' }, 'This DWG was parsed, but no drawable geometry could be rendered.'));
  }

  // ---- Saved preview ----
  const pv = previewCard(file, found, resultsEl);
  if (pv) resultsEl.appendChild(pv);
}
