/* Analyser - AutoCAD DWG viewer
   ============================================================================
   DWG is AutoCAD's native binary drawing format. Uses the vendored libredwg-web
   (LibreDWG compiled to WebAssembly, ~6 MB, lazy-loaded) to parse the drawing
   into an entity database and render it to an SVG, shown as a 2D preview - the
   same idea as the DXF viewer, but for the binary format. Nothing is uploaded. */

import { el, row, rowHelp, h3help, fmtBytes, errorCard } from '../core/util.js';
import { sanitizeSvgMarkup } from './svg.js';

const DIST_URL = new URL('../../vendor/libredwg/dist/libredwg-web.js', import.meta.url).href;
const WASM_DIR = new URL('../../vendor/libredwg/wasm', import.meta.url).href;

let _lib = null;
async function getLib() {
  if (!_lib) _lib = (async () => {
    const mod = await import(DIST_URL);
    const inst = await mod.LibreDwg.create(WASM_DIR);
    return { inst, FT: mod.Dwg_File_Type };
  })();
  return _lib;
}

export async function renderDwg(file, resultsEl) {
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

  let db = null, svg = '', ptr = null;
  try {
    const buf = await file.arrayBuffer();
    ptr = inst.dwg_read_data(buf, FT.DWG);
    if (ptr == null) throw new Error('not a readable DWG file');
    db = inst.convert(ptr);
    try { svg = inst.dwg_to_svg(db); } catch (_) { svg = ''; }
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read this DWG: ' + (e && e.message)));
    if (ptr != null) { try { inst.dwg_free(ptr); } catch (_) {} }
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
}
