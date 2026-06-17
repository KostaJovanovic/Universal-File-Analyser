/* Analyser - AutoCAD DWG viewer
   ============================================================================
   DWG is AutoCAD's native binary drawing format. Uses the vendored libredwg-web
   (LibreDWG compiled to WebAssembly, ~6 MB, lazy-loaded) to parse the drawing
   into an entity database and render it to an SVG, shown as a 2D preview - the
   same idea as the DXF viewer, but for the binary format. Nothing is uploaded. */

import { el, row, rowHelp, h3help, fmtBytes, sha256Row, errorCard } from '../core/util.js';

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
  const [h, help] = h3help('AutoCAD drawing', 'AutoCAD DWG. The drawing entities are parsed and rendered to a 2D preview in the browser.');
  card.appendChild(h); card.appendChild(help);
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Format', 'AutoCAD DWG'));
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  const ents = (db && db.entities) || [];
  tbl.appendChild(row('Entities', ents.length.toLocaleString()));
  const layerTable = db && db.tables && db.tables.LAYER;
  const layers = layerTable && (layerTable.entries || layerTable.records || layerTable.items);
  if (layers && layers.length != null) tbl.appendChild(row('Layers', String(layers.length)));
  // Top entity types (LINE, CIRCLE, LWPOLYLINE, TEXT, ...).
  const types = {};
  for (const e of ents) { const t = (e && e.type) || '?'; types[t] = (types[t] || 0) + 1; }
  const topTypes = Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t, n]) => t + ' ×' + n).join(', ');
  if (topTypes) tbl.appendChild(rowHelp('Entity types', topTypes, 'The most common drawing primitives found in the model space.'));
  tbl.appendChild(sha256Row(file));
  card.appendChild(tbl);
  resultsEl.appendChild(card);

  // ---- Drawing ----
  if (svg && /<svg[\s>]/i.test(svg)) {
    const dcard = el('div', { class: 'anr-card' });
    dcard.appendChild(el('h3', {}, 'Drawing'));
    const wrap = el('div', { class: 'anr-dwg-wrap' });
    wrap.innerHTML = svg.replace(/<script[\s\S]*?<\/script>/gi, '');
    dcard.appendChild(wrap);
    resultsEl.appendChild(dcard);
  } else {
    resultsEl.appendChild(el('div', { class: 'anr-info' }, 'This DWG was parsed, but no drawable geometry could be rendered.'));
  }
}
