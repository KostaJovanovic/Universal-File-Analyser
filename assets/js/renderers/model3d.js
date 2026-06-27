/* Analyser - 3D model viewer for 3MF / STEP / IGES
   - 3MF: a ZIP of 3D-manufacturing XML. Parsed natively (fflate + regex/DOM) so
     every object/assembly on the build can be viewed individually. Handles the
     production extension (one .model file per part, referenced by the root model).
   - STEP / IGES: B-rep CAD. Tessellated to a mesh by the OpenCASCADE WASM kernel
     (lazy-loaded), with the ISO-10303 header metadata shown alongside.
   All three feed the shared WebGL viewer from stl.js. */

import { el, row, rowHelp, h3help, fmtBytes, sha256Row, errorCard } from '../core/util.js';
import { inflate, ascii, latin1 } from '../core/binutil.js';
import {
  buildViewerCard, startViewer, makeResult,
  buildGeoFromIndexed, geoStatsCard, renderPartsViewer,
  splitBodiesIndexed, subTris, geoSpan, bodyParts, BODY_SPLIT_CAP,
} from './stl.js';
import { parseStepHeader } from './proprietary.js';
import { loadOcct } from '../lib/occt-loader.js';

const FFLATE_URL = new URL('../../vendor/fflate.js', import.meta.url).href;
let fflateLib = null;
async function fflate() { if (!fflateLib) fflateLib = await import(FFLATE_URL); return fflateLib; }

export async function renderModel3d(file, resultsEl) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === '3mf') return render3mf(file, resultsEl);
  if (ext === 'amf') return renderAmf(file, resultsEl);
  if (ext === 'mtl') return renderMtl(file, resultsEl);
  if (ext === 'obj' || ext === 'ply' || ext === 'off') return renderMeshFile(file, resultsEl, ext);
  if (ext === 'gltf' || ext === 'glb') return renderGltf(file, resultsEl, ext);
  if (ext === 'fbx') return renderFbx(file, resultsEl);
  return renderStepIges(file, resultsEl, ext);   // step / stp / iges / igs / brep
}

/* ===================== OBJ material library (.mtl) ========================== */

// Wavefront .mtl - the plain-text material library an .obj references. Parsed into
// per-material colour/shininess/opacity and the texture maps it points at. No
// geometry, so there's nothing to view in 3D - we list the materials (with colour
// swatches) and the textures the model expects beside it.
export async function renderMtl(file, resultsEl) {
  resultsEl.hidden = false; resultsEl.innerHTML = '';
  let text;
  try { text = await file.text(); }
  catch (e) { resultsEl.appendChild(errorCard('Could not read file: ' + (e && e.message))); return; }

  const MAP_KEYS = ['map_kd', 'map_ka', 'map_ks', 'map_ke', 'map_ns', 'map_d', 'map_bump', 'bump', 'disp', 'decal', 'norm', 'refl'];
  const MAP_LABEL = { map_kd: 'Diffuse', map_ka: 'Ambient', map_ks: 'Specular', map_ke: 'Emissive', map_ns: 'Shininess', map_d: 'Opacity', map_bump: 'Bump', bump: 'Bump', disp: 'Displacement', decal: 'Decal', norm: 'Normal', refl: 'Reflection' };
  const mats = [];
  let cur = null;
  const textures = new Set();
  for (const raw of text.split(/\r\n?|\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const sp = line.search(/\s/);
    const key = (sp < 0 ? line : line.slice(0, sp)).toLowerCase();
    const val = sp < 0 ? '' : line.slice(sp + 1).trim();
    if (key === 'newmtl') { cur = { name: val || ('material ' + (mats.length + 1)), props: {}, maps: {} }; mats.push(cur); continue; }
    if (!cur) continue;
    if (MAP_KEYS.includes(key)) { const fn = val.split(/\s+/).pop(); if (fn) { cur.maps[key] = fn; textures.add(fn); } }
    else cur.props[key] = val;
  }

  const rgb = (v) => { const n = (v || '').split(/\s+/).map(Number); if (n.length < 3 || n.some((x) => !isFinite(x))) return null; return n.slice(0, 3).map((x) => Math.max(0, Math.min(255, Math.round(x * 255)))); };
  const swatch = (c) => el('span', { style: `display:inline-block;width:13px;height:13px;border:1px solid var(--hairline);background:rgb(${c[0]},${c[1]},${c[2]});vertical-align:-2px;margin-right:6px;` });
  const colourCell = (v) => { const c = rgb(v); const span = el('span'); if (c) span.appendChild(swatch(c)); span.appendChild(document.createTextNode(c ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : v)); return span; };
  const rowNode = (label, node) => el('tr', {}, [el('th', {}, label), el('td', {}, node)]);

  // Summary card.
  const sum = el('div', { class: 'anr-card' });
  sum.appendChild(el('h3', {}, 'Material library'));
  const stbl = el('table', { class: 'anr-readout' });
  stbl.appendChild(row('Format', 'Wavefront material library (.mtl)'));
  stbl.appendChild(row('File', file.name));
  stbl.appendChild(row('Size', `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`));
  stbl.appendChild(rowHelp('Materials', mats.length.toLocaleString(), 'The number of named materials (newmtl blocks) defined in this library.'));
  if (textures.size) stbl.appendChild(rowHelp('Textures referenced', textures.size.toLocaleString(), 'Distinct image files this library points at (map_Kd, bump, normal and so on). They are expected to sit beside the .mtl and .obj.'));
  stbl.appendChild(sha256Row(file));
  sum.appendChild(stbl);
  if (textures.size) {
    const det = el('details', { style: 'margin-top:12px;' });
    det.appendChild(el('summary', {}, `Referenced texture files (${textures.size})`));
    const ul = el('ul', { class: 'anr-hint', style: 'margin:8px 0 0;padding-left:18px;font-size:12px;word-break:break-all;' });
    for (const t of textures) ul.appendChild(el('li', {}, t));
    det.appendChild(ul);
    sum.appendChild(det);
  }
  resultsEl.appendChild(sum);

  if (!mats.length) { resultsEl.appendChild(el('div', { class: 'anr-card' }, [el('p', { class: 'anr-hint' }, 'No materials (newmtl blocks) were found in this file.')])); }

  // One card per material (capped so a giant library can't flood the page).
  const CAP = 80;
  const FIELDS = [
    ['Kd', 'Diffuse colour', 'colour'], ['Ka', 'Ambient colour', 'colour'], ['Ks', 'Specular colour', 'colour'], ['Ke', 'Emissive colour', 'colour'],
    ['Ns', 'Specular exponent', 'num'], ['Ni', 'Optical density (IOR)', 'num'], ['d', 'Opacity', 'num'], ['Tr', 'Transparency', 'num'], ['illum', 'Illumination model', 'num'],
  ];
  mats.slice(0, CAP).forEach((m) => {
    const card = el('div', { class: 'anr-card' });
    const kd = rgb(m.props.kd);
    const h = el('h3', {});
    if (kd) h.appendChild(swatch(kd));
    h.appendChild(document.createTextNode(m.name));
    card.appendChild(h);
    const tbl = el('table', { class: 'anr-readout' });
    for (const [k, label, type] of FIELDS) {
      const v = m.props[k.toLowerCase()];
      if (v == null) continue;
      tbl.appendChild(type === 'colour' ? rowNode(label, colourCell(v)) : row(label, v));
    }
    const mapEntries = Object.entries(m.maps);
    for (const [k, fn] of mapEntries) tbl.appendChild(row((MAP_LABEL[k] || k) + ' map', fn));
    if (!tbl.children.length) tbl.appendChild(row('Definition', '(no properties)'));
    card.appendChild(tbl);
    resultsEl.appendChild(card);
  });
  if (mats.length > CAP) resultsEl.appendChild(el('div', { class: 'anr-card' }, [el('p', { class: 'anr-hint' }, `Showing the first ${CAP} of ${mats.length.toLocaleString()} materials.`)]));

  // Raw source with a 200-line preview that opens fully, like the other text views.
  const lines = text.split(/\r\n?|\n/), PRE = 200;
  const det = el('details', { style: 'margin-top:4px;' });
  det.appendChild(el('summary', {}, `Source (${lines.length.toLocaleString()} lines)`));
  const pre = el('pre', { class: 'anr-code', style: 'max-height:360px;overflow:auto;font-size:12px;' });
  pre.textContent = lines.slice(0, PRE).join('\n');
  det.appendChild(pre);
  if (lines.length > PRE) {
    const btnRow = el('div', { class: 'anr-btn-row', style: 'margin-top:8px;align-items:center;' });
    const moreBtn = el('button', { type: 'button', class: 'anr-btn' }, `Show all ${lines.length.toLocaleString()} lines`);
    const hint = el('span', { class: 'anr-hint', style: 'font-size:12px;' }, `Showing the first ${PRE} lines`);
    moreBtn.addEventListener('click', () => { pre.textContent = lines.join('\n'); moreBtn.remove(); hint.remove(); });
    btnRow.appendChild(moreBtn); btnRow.appendChild(hint);
    det.appendChild(btnRow);
  }
  resultsEl.appendChild(el('div', { class: 'anr-card' }, [det]));
}

/* ================================== 3MF ===================================== */

const IDENTITY12 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

function parseTransform(s) {
  if (!s) return IDENTITY12;
  const n = s.trim().split(/\s+/).map(Number);
  return (n.length === 12 && n.every((x) => isFinite(x))) ? n : IDENTITY12;
}

// 12-number 3MF affine -> 4x4 row-major (point is a row vector: P' = P·M).
function to44(t) { return [t[0], t[1], t[2], 0, t[3], t[4], t[5], 0, t[6], t[7], t[8], 0, t[9], t[10], t[11], 1]; }

// Compose A then B for a row vector: P·A·B  ->  returns the 12-number form of A·B.
function compose(A, B) {
  if (A === IDENTITY12) return B;
  if (B === IDENTITY12) return A;
  const a = to44(A), b = to44(B), c = new Array(16);
  for (let r = 0; r < 4; r++) for (let col = 0; col < 4; col++) {
    let s = 0; for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + col];
    c[r * 4 + col] = s;
  }
  return [c[0], c[1], c[2], c[4], c[5], c[6], c[8], c[9], c[10], c[12], c[13], c[14]];
}

const attr = (s, name) => (s.match(new RegExp('\\b(?:[\\w]+:)?' + name + '="([^"]*)"')) || [])[1];

// Parse the root 3dmodel.model: metadata, the object table, and the build items.
// Done with regex rather than DOMParser - the 3MF default XML namespace makes CSS
// selector / tag matching unreliable across browsers, and this is testable.
function parseMainModel(text) {
  const meta = {};
  let mm; const metaRe = /<metadata\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/metadata>/gi;
  while ((mm = metaRe.exec(text))) {
    const name = mm[1].replace(/^.*:/, ''); const val = mm[2].trim();
    if (val && !meta[name]) meta[name] = val;
  }
  const unit = attr((text.match(/<model\b[^>]*>/i) || [''])[0], 'unit') || '';
  const objects = new Map();
  let om; const objRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/gi;
  while ((om = objRe.exec(text))) {
    const attrs = om[1], body = om[2];
    const id = attr(attrs, 'id');
    if (id == null) continue;
    const comps = [];
    let cm; const compRe = /<component\b([^>]*?)\/?>/gi;
    while ((cm = compRe.exec(body))) comps.push({ path: attr(cm[1], 'path') || '', objectid: attr(cm[1], 'objectid'), transform: attr(cm[1], 'transform') || '' });
    objects.set(id, { id, comps, hasMesh: /<mesh\b/.test(body), name: attr(attrs, 'name') || '' });
  }
  const buildBlock = (text.match(/<build\b[^>]*>([\s\S]*?)<\/build>/i) || ['', ''])[1];
  const build = [];
  let im; const itemRe = /<item\b([^>]*?)\/?>/gi;
  while ((im = itemRe.exec(buildBlock))) build.push({ objectid: attr(im[1], 'objectid'), transform: attr(im[1], 'transform') || '' });
  return { meta, unit, objects, build };
}

// "#RRGGBB" / "#RRGGBBAA" / "#RGB" -> [r,g,b] in 0..1, or null.
function hexRgb3mf(h) {
  if (!h) return null;
  let s = String(h).trim().replace(/^#/, '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  if (s.length !== 6 && s.length !== 8) return null;
  const r = parseInt(s.slice(0, 2), 16), g = parseInt(s.slice(2, 4), 16), b = parseInt(s.slice(4, 6), 16);
  return (isFinite(r) && isFinite(g) && isFinite(b)) ? [r / 255, g / 255, b / 255] : null;
}
// Unmapped-but-coloured fallback (a neutral grey), so a part with no colour of its own
// in an otherwise coloured model doesn't render pure white.
const NEUTRAL_3MF = [0.82, 0.82, 0.86];

// Resolve per-object / per-part colours from a 3MF, covering the two schemes in the wild:
//   - Bambu Studio / OrcaSlicer: a filament palette in Metadata/project_settings.config
//     ("filament_colour": ["#RRGGBB", ...]) plus a per-object/part extruder index in
//     Metadata/model_settings.config (an object's extruder is the default for its parts;
//     extruder 0/absent inherits it). The slicer side-cars, not the core-spec materials.
//   - Core 3MF materials: <basematerials>/<colorgroup> resource groups in the .model
//     files, selected by an object's pid/pindex.
// Returns { comp, obj }: component-objectid -> rgb, and object-id -> rgb (ids kept as
// the raw strings used elsewhere in this module). Empty maps mean "no colour info".
function build3mfColors(files, modelSettings, projectSettings) {
  const comp = new Map(), obj = new Map();

  // --- Bambu/Orca: filament palette + extruder index ---
  let palette = [];
  if (projectSettings) {
    const m = /"filament_colou?r"\s*:\s*\[([\s\S]*?)\]/i.exec(projectSettings);
    if (m) palette = [...m[1].matchAll(/"([^"]*)"/g)].map((x) => hexRgb3mf(x[1]));   // index N-1 == extruder N
  }
  if (modelSettings && palette.length) {
    const metaVal = (block, key) => { const r = new RegExp('key="' + key + '"\\s+value="([^"]*)"').exec(block); return r ? r[1] : null; };
    let om; const oRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/gi;
    while ((om = oRe.exec(modelSettings))) {
      const oid = attr(om[1], 'id'); if (oid == null) continue;
      const oext = parseInt(metaVal(om[2].split('<part')[0], 'extruder') || '0', 10);
      const oRgb = oext > 0 ? palette[oext - 1] : null;
      if (oRgb) obj.set(oid, oRgb);
      let pm; const pRe = /<part\b([^>]*)>([\s\S]*?)<\/part>/gi;
      while ((pm = pRe.exec(om[2]))) {
        const pid = attr(pm[1], 'id'); if (pid == null) continue;        // part id == component objectid
        const pext = parseInt(metaVal(pm[2], 'extruder') || '0', 10);
        const ext = pext > 0 ? pext : oext;                              // 0/absent inherits the object's
        const rgb = ext > 0 ? palette[ext - 1] : null;
        if (rgb) comp.set(pid, rgb);
      }
    }
  }

  // --- Core 3MF materials: <basematerials>/<colorgroup> picked by object pid/pindex ---
  const groups = new Map();   // resource-group id -> [rgb, ...]
  for (const text of files.values()) {
    let gm;
    const bmRe = /<basematerials\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/basematerials>/gi;
    while ((gm = bmRe.exec(text))) groups.set(gm[1], [...gm[2].matchAll(/<base\b[^>]*\bdisplaycolor="([^"]+)"/gi)].map((x) => hexRgb3mf(x[1])));
    const cgRe = /<(?:\w+:)?colorgroup\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?colorgroup>/gi;
    while ((gm = cgRe.exec(text))) groups.set(gm[1], [...gm[2].matchAll(/<(?:\w+:)?color\b[^>]*\bcolor="([^"]+)"/gi)].map((x) => hexRgb3mf(x[1])));
  }
  if (groups.size) {
    for (const text of files.values()) {
      let om; const oRe = /<object\b([^>]*)>/gi;
      while ((om = oRe.exec(text))) {
        const oid = attr(om[1], 'id'), pid = attr(om[1], 'pid');
        if (oid == null || pid == null || comp.has(oid)) continue;       // slicer extruder colour wins
        const arr = groups.get(pid), rgb = arr && arr[parseInt(attr(om[1], 'pindex') || '0', 10)];
        if (rgb) comp.set(oid, rgb);
      }
    }
  }

  return { comp, obj };
}

// Expand one rgb-per-triangle list into the non-indexed (3 verts/triangle) colour
// buffer buildGeoFromIndexed's positions use, so geo.colors lines up 1:1.
function expandTriColors3mf(cols) {
  const out = new Float32Array(cols.length * 9);
  for (let t = 0; t < cols.length; t++) { const c = cols[t]; for (let j = 0; j < 3; j++) { const o = t * 9 + j * 3; out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; } }
  return out;
}

// Slice out a single <object id="ID">…</object> block from a .model file's text.
function extractObjectText(text, id) {
  const re = new RegExp('<object\\b[^>]*\\bid="' + id + '"[\\s\\S]*?</object>', 'i');
  const m = re.exec(text);
  return m ? m[0] : null;
}

// Pull flat vertex coords + triangle indices out of an <object> block. Attribute
// order isn't assumed - each value is matched by name within its own tag.
function parseMeshText(objText) {
  const verts = [];
  const vRe = /<vertex\b([^>]*?)\/?>/g; let vm;
  while ((vm = vRe.exec(objText))) {
    const a = vm[1];
    const x = /\bx="([^"]+)"/.exec(a), y = /\by="([^"]+)"/.exec(a), z = /\bz="([^"]+)"/.exec(a);
    if (x && y && z) verts.push(+x[1], +y[1], +z[1]);
  }
  const tris = [];
  const tRe = /<triangle\b([^>]*?)\/?>/g; let tm;
  while ((tm = tRe.exec(objText))) {
    const a = tm[1];
    const v1 = /\bv1="(\d+)"/.exec(a), v2 = /\bv2="(\d+)"/.exec(a), v3 = /\bv3="(\d+)"/.exec(a);
    if (v1 && v2 && v3) tris.push(+v1[1], +v2[1], +v3[1]);
  }
  return { verts, tris };
}

// Find a referenced part file, tolerating zip-name vs XML-path encoding drift by
// falling back to a basename match.
function findFile(files, path) {
  const p = (path || '').replace(/^\//, '');
  if (files.has(p)) return files.get(p);
  const base = p.split('/').pop();
  for (const [k, v] of files) if (k.split('/').pop() === base) return v;
  const norm = (s) => s.replace(/[^\x20-\x7E]/g, '?');
  for (const [k, v] of files) if (norm(k.split('/').pop()) === norm(base)) return v;
  return null;
}

function addMesh(acc, mesh, M, rgb) {
  const base = acc.verts.length / 3;
  const v = mesh.verts;
  for (let i = 0; i < v.length; i += 3) {
    const x = v[i], y = v[i + 1], z = v[i + 2];
    acc.verts.push(
      x * M[0] + y * M[3] + z * M[6] + M[9],
      x * M[1] + y * M[4] + z * M[7] + M[10],
      x * M[2] + y * M[5] + z * M[8] + M[11]
    );
  }
  for (const t of mesh.tris) acc.tris.push(t + base);
  // Per-triangle colour (only when the model carries colour info; acc.cols stays null
  // otherwise, leaving the mesh its solid default + colour picker).
  if (acc.cols) { const c = rgb || NEUTRAL_3MF; for (let k = mesh.tris.length / 3; k > 0; k--) acc.cols.push(c); }
}

// Accumulate the meshes of a main-file object: its own mesh (rare) plus each
// component's referenced part, with transforms composed onto the base matrix.
function gatherObject(model, files, mainText, objectid, baseM, acc, colors) {
  const obj = model.objects.get(objectid);
  if (!obj) return;
  const objRgb = colors ? (colors.obj.get(objectid) || null) : null;   // the object's default colour
  if (obj.hasMesh) {
    const t = extractObjectText(mainText, objectid);
    if (t) addMesh(acc, parseMeshText(t), baseM, colors ? (colors.comp.get(objectid) || objRgb) : undefined);
  }
  for (const c of obj.comps) {
    const m = compose(parseTransform(c.transform), baseM);
    const text = findFile(files, c.path);
    if (!text) continue;
    const t = extractObjectText(text, c.objectid);
    if (t) addMesh(acc, parseMeshText(t), m, colors ? (colors.comp.get(c.objectid) || objRgb) : undefined);
  }
}

// Resolve one part's mesh. The build <item>'s transform is the authored "how this
// object sits on the plate" orientation (often rotating an object authored in some
// other axis onto the printer's Z-up bed), so apply it - otherwise the per-part view
// shows the raw object space and the model is mis-oriented (e.g. stood on its tail).
function resolvePart(model, files, mainText, objectid, transform, colors) {
  const acc = { verts: [], tris: [], cols: colors ? [] : null };
  gatherObject(model, files, mainText, objectid, parseTransform(transform), acc, colors);
  if (!acc.tris.length) return null;
  const geo = buildGeoFromIndexed(acc.verts, acc.tris, '3MF');
  if (acc.cols && acc.cols.length) geo.colors = expandTriColors3mf(acc.cols);
  return geo;
}

function resolveWholeBuild(model, files, mainText, colors) {
  const acc = { verts: [], tris: [], cols: colors ? [] : null };
  for (const it of model.build) gatherObject(model, files, mainText, it.objectid, parseTransform(it.transform), acc, colors);
  if (!acc.tris.length) return null;
  const geo = buildGeoFromIndexed(acc.verts, acc.tris, '3MF');
  if (acc.cols && acc.cols.length) geo.colors = expandTriColors3mf(acc.cols);
  return geo;
}

function partName(obj, idx) {
  if (obj.name) return obj.name;
  const comp = obj.comps[0];
  if (comp && comp.path) {
    let base = comp.path.split('/').pop().replace(/\.model$/i, '');
    try { base = decodeURIComponent(base); } catch (_) { /* leave as-is on bad %-escape */ }
    base = base.replace(/_\d+$/, '');      // strip the slicer's trailing _<id>
    if (base) return base;
  }
  return 'Part ' + idx;
}

async function render3mf(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading 3MF "${file.name}"…`));

  let files, mainText, model, ffl, data;
  try {
    ffl = await fflate();
    data = new Uint8Array(await file.arrayBuffer());
    // Pull the geometry (.model) plus the slicer side-cars that carry colour: Bambu/Orca
    // keep the filament palette in project_settings.config and the per-object/part extruder
    // index in model_settings.config.
    const unzipped = ffl.unzipSync(data, { filter: (f) => /\.model$/i.test(f.name) || /(?:model_settings|project_settings)\.config$/i.test(f.name) });
    files = new Map();
    const dec = new TextDecoder('utf-8');
    for (const [name, bytes] of Object.entries(unzipped)) files.set(name, dec.decode(bytes));
    const mainKey = [...files.keys()].find((k) => /(^|\/)3dmodel\.model$/i.test(k)) || [...files.keys()].find((k) => /\.model$/i.test(k));
    mainText = files.get(mainKey);
    model = parseMainModel(mainText);
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read 3MF: ' + (e && e.message ? e.message : e)));
    return;
  }

  // The viewable parts: one per build item (falling back to mesh/assembly objects).
  const items = model.build.length
    ? model.build
    : [...model.objects.values()].filter((o) => o.comps.length || o.hasMesh).map((o) => ({ objectid: o.id }));

  // Per-object / per-part colours (Bambu/Orca filament palette + extruder, or core-spec
  // materials). Best-effort - never let colour extraction break the mesh view.
  let colors = null;
  try {
    const find = (re) => { for (const k of files.keys()) if (re.test(k)) return files.get(k); return ''; };
    const c = build3mfColors(files, find(/model_settings\.config$/i), find(/project_settings\.config$/i));
    if (c.comp.size || c.obj.size) colors = c;
  } catch (_) { colors = null; }

  const parts = items.map((it, i) => {
    const obj = model.objects.get(it.objectid) || { comps: [], name: '' };
    return { key: 'p' + i, name: partName(obj, i + 1), build: () => resolvePart(model, files, mainText, it.objectid, it.transform, colors) };
  });
  if (parts.length > 1) {
    parts.unshift({ key: 'all', name: `Whole build (${items.length} parts)`, build: () => resolveWholeBuild(model, files, mainText, colors) });
  }

  // ---- 3MF document metadata ----
  const metaCard = el('div', { class: 'anr-card' });
  metaCard.appendChild(el('h3', {}, '3MF document'));
  const mt = el('table', { class: 'anr-readout' });
  if (model.meta.Application) mt.appendChild(row('Created with', model.meta.Application));
  if (model.unit) mt.appendChild(row('Unit', model.unit));
  if (model.meta.Title) mt.appendChild(row('Title', model.meta.Title));
  if (model.meta.Designer) mt.appendChild(row('Designer', model.meta.Designer));
  if (model.meta.License) mt.appendChild(row('License', model.meta.License));
  if (model.meta.CreationDate) mt.appendChild(row('Created', model.meta.CreationDate));
  mt.appendChild(row('Objects', String(items.length)));
  if (colors) { const set = new Set([...colors.comp.values(), ...colors.obj.values()].map((c) => c.join(','))); mt.appendChild(row('Colours', `${set.size} applied from the file`)); }
  mt.appendChild(row('File', file.name));
  mt.appendChild(row('Size', fmtBytes(file.size)));
  mt.appendChild(sha256Row(file));
  metaCard.appendChild(mt);

  // A 3MF with no build items / mesh objects (e.g. a slicer project that only carries
  // sliced G-code and settings) has nothing to show in the mesh viewer. Rather than a
  // bare "no models" error, offer to open any embedded G-code and still let the user
  // browse the archive.
  if (!parts.length) { await render3mfNoModel(file, resultsEl, ffl, data, metaCard); return; }

  renderPartsViewer(file, resultsEl, {
    metaCard, parts, format: '3MF mesh', zUp: true,
    unitLabel: model.unit === 'millimeter' ? 'mm' : (model.unit || 'units')
  });
}

// No-mesh 3MF: red warning, then (if the archive carries a sliced G-code file, as
// Bambu/Prusa project 3MFs do) a button to reconstruct it in the G-code viewer, then
// the document metadata and a full archive browser below.
async function render3mfNoModel(file, resultsEl, ffl, data, metaCard) {
  resultsEl.innerHTML = '';
  resultsEl.appendChild(errorCard('No 3D models found in this 3MF file.'));

  // Scan the archive for embedded G-code and offer to open each one. A multi-plate
  // 3MF (e.g. Bambu Studio projects) carries one sliced toolpath per plate
  // (Metadata/plate_1.gcode, plate_2.gcode, ...), so list them all - sorted in
  // natural plate order - not just the largest.
  let gcodes = [];
  try {
    const gz = ffl.unzipSync(data, { filter: (f) => /\.gco(de)?$/i.test(f.name) });
    gcodes = Object.keys(gz).filter((k) => gz[k] && gz[k].length)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
      .map((k) => ({ name: k, short: k.split('/').pop(), bytes: gz[k] }));
  } catch (_) { /* no readable g-code inside */ }

  if (gcodes.length) {
    const multi = gcodes.length > 1;
    const card = el('div', { class: 'anr-card' });
    card.appendChild(el('h3', {}, multi ? `Embedded G-code found (${gcodes.length} plates)` : 'Embedded G-code found'));
    card.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 10px;' }, multi
      ? `This 3MF carries ${gcodes.length} sliced G-code plates. Open one to reconstruct and analyse that plate's print.`
      : `This 3MF carries a sliced G-code file (${gcodes[0].short}). Open it to reconstruct and analyse the print.`));
    const host = el('div', {});
    const btnRow = el('div', { class: 'anr-btn-row', style: 'margin:0 0 10px;flex-wrap:wrap;gap:8px;' });
    for (const g of gcodes) {
      const btn = el('button', { type: 'button', class: 'anr-btn' }, 'Open ' + g.short);
      btn.addEventListener('click', async () => {
        for (const b of btnRow.children) b.disabled = false;   // let the user switch plates
        btn.disabled = true;
        host.innerHTML = '';
        const gfile = new File([g.bytes], g.short, { type: 'text/plain' });
        const { renderGcode } = await import('./gcode.js');
        await renderGcode(gfile, host);
      });
      btnRow.appendChild(btn);
    }
    card.appendChild(btnRow);
    card.appendChild(host);
    resultsEl.appendChild(card);
  }

  // Keep the document metadata and the archive browser visible under all of the above.
  if (metaCard) resultsEl.appendChild(metaCard);
  const { renderArchiveEmbedded } = await import('./archive.js');
  await renderArchiveEmbedded(file, resultsEl, { mode: 'zip', label: '3MF' });
}

/* ================================== AMF ===================================== */

const AMF_UNIT = { millimeter: 'mm', meter: 'm', inch: 'in', feet: 'ft', micron: 'µm' };

// AMF is XML with one or more <object>s, each a <mesh> of <vertices> (nested
// <coordinates><x/><y/><z/>) and one or more <volume>s of <triangle><v1/v2/v3>.
async function renderAmf(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading AMF "${file.name}"…`));

  let text;
  try { text = await file.text(); }
  catch (e) { resultsEl.innerHTML = ''; resultsEl.appendChild(errorCard('Could not read AMF: ' + (e && e.message))); return; }

  const unitMatch = text.match(/<amf\b[^>]*\bunit="([^"]+)"/i);
  const unit = unitMatch ? unitMatch[1].toLowerCase() : 'millimeter';
  const meta = { Application: (text.match(/<metadata\b[^>]*\btype="cad"[^>]*>([^<]+)/i) || [])[1] };

  // Split into <object>…</object> blocks; each becomes a part.
  const objBlocks = text.match(/<object\b[\s\S]*?<\/object>/gi) || [];
  const partDefs = objBlocks.map((block, i) => {
    const idM = block.match(/<object\b[^>]*\bid="([^"]+)"/i);
    return { name: 'Object ' + (idM ? idM[1] : i + 1), block };
  });

  function meshFromAmfBlock(block) {
    const verts = [];
    const vRe = /<vertex\b[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/gi; let vm;
    while ((vm = vRe.exec(block))) {
      const c = vm[1];
      const x = /<x>([^<]+)<\/x>/i.exec(c), y = /<y>([^<]+)<\/y>/i.exec(c), z = /<z>([^<]+)<\/z>/i.exec(c);
      if (x && y && z) verts.push(+x[1], +y[1], +z[1]);
    }
    const tris = [];
    const tRe = /<triangle\b[\s\S]*?<\/triangle>/gi; let tm;
    while ((tm = tRe.exec(block))) {
      const t = tm[0];
      const v1 = /<v1>(\d+)<\/v1>/i.exec(t), v2 = /<v2>(\d+)<\/v2>/i.exec(t), v3 = /<v3>(\d+)<\/v3>/i.exec(t);
      if (v1 && v2 && v3) tris.push(+v1[1], +v2[1], +v3[1]);
    }
    return tris.length ? buildGeoFromIndexed(verts, tris, 'AMF') : null;
  }

  const parts = partDefs.map((p, i) => ({ key: 'p' + i, name: p.name, build: () => meshFromAmfBlock(p.block) }));
  if (parts.length > 1) {
    parts.unshift({ key: 'all', name: `All objects (${partDefs.length})`, build: () => {
      const acc = { verts: [], tris: [] };
      for (const p of partDefs) { const g = meshFromAmfBlock(p.block); if (g) addMesh(acc, { verts: Array.from(g.positions), tris: [...Array(g.positions.length / 3).keys()] }, IDENTITY12); }
      return acc.tris.length ? buildGeoFromIndexed(acc.verts, acc.tris, 'AMF') : null;
    } });
  }

  const metaCard = el('div', { class: 'anr-card' });
  metaCard.appendChild(el('h3', {}, 'AMF document'));
  const mt = el('table', { class: 'anr-readout' });
  if (meta.Application) mt.appendChild(row('Created with', meta.Application));
  mt.appendChild(row('Unit', unit));
  mt.appendChild(row('Objects', String(partDefs.length)));
  mt.appendChild(row('File', file.name));
  mt.appendChild(row('Size', fmtBytes(file.size)));
  mt.appendChild(sha256Row(file));
  metaCard.appendChild(mt);

  renderPartsViewer(file, resultsEl, { metaCard, parts, format: 'AMF mesh', unitLabel: AMF_UNIT[unit] || unit, zUp: true });
}

/* =========================== OBJ / PLY / OFF ================================ */

// Full Wavefront OBJ parse: geometry plus the bits needed to colour it - the
// usemtl material per triangle, texture coords (vt) per face-vertex, the
// referenced mtllib, and any embedded per-vertex colours (v x y z r g b). Faces
// are fan-triangulated; vt indices and the active material are tracked in step
// with the emitted triangles so colours and UVs can be expanded later.
function parseObjFull(text) {
  const verts = [], vts = [], vertColors = [];
  const tris = [], triVT = [], triMat = [];
  let hasVC = false, curMat = null, mtllib = null;
  const lines = text.split('\n');
  for (const line of lines) {
    const c0 = line.charCodeAt(0);
    if (c0 === 118 /* v */) {
      const c1 = line[1];
      if (c1 === ' ' || c1 === '\t') {
        const p = line.trim().split(/\s+/);
        verts.push(+p[1], +p[2], +p[3]);
        if (p.length >= 7) { hasVC = true; vertColors.push(+p[4], +p[5], +p[6]); }
        else vertColors.push(1, 1, 1);
      } else if (c1 === 't') {
        const p = line.trim().split(/\s+/);
        vts.push(+p[1], +(p[2] || 0));
      }
      continue;   // 'vn' lines ignored - the viewer uses flat face normals
    }
    if (c0 === 102 /* f */ && (line[1] === ' ' || line[1] === '\t')) {
      const p = line.trim().split(/\s+/);
      const vi = [], ti = [];
      for (let i = 1; i < p.length; i++) {
        const seg = p[i].split('/');
        let v = parseInt(seg[0], 10);
        if (!isFinite(v)) continue;
        if (v < 0) v = verts.length / 3 + v + 1;   // relative index
        vi.push(v - 1);
        let t = (seg.length > 1 && seg[1]) ? parseInt(seg[1], 10) : NaN;
        if (isFinite(t)) { if (t < 0) t = vts.length / 2 + t + 1; ti.push(t - 1); } else ti.push(-1);
      }
      for (let i = 1; i + 1 < vi.length; i++) {
        tris.push(vi[0], vi[i], vi[i + 1]);
        triVT.push(ti[0], ti[i], ti[i + 1]);
        triMat.push(curMat);
      }
      continue;
    }
    if (line.startsWith('usemtl')) { curMat = line.slice(6).trim(); }
    else if (line.startsWith('mtllib')) { mtllib = line.slice(6).trim(); }
  }
  return { verts, vts, tris, triVT, triMat, vertColors: hasVC ? vertColors : null, mtllib, hasVT: vts.length > 0 };
}

// Parse a .mtl into name -> { kd:[r,g,b]|null, mapKd:filename|null }.
function parseMtlMaterials(text) {
  const mats = new Map(); let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^newmtl\b/.test(line)) { cur = line.slice(6).trim(); mats.set(cur, { kd: null, mapKd: null }); }
    else if (cur && /^Kd\b/.test(line)) { const p = line.split(/\s+/); mats.get(cur).kd = [+p[1], +p[2], +p[3]]; }
    else if (cur && /^map_Kd\b/i.test(line)) {
      // The filename is the last whitespace-separated token (skip -options).
      mats.get(cur).mapKd = line.replace(/^map_Kd\b/i, '').trim().split(/\s+/).pop().replace(/\\/g, '/').split('/').pop();
    }
  }
  return mats;
}

// Expand embedded per-vertex colours into the non-indexed triangle vertex order
// buildGeoFromIndexed produces (triangle t -> verts a,b,c), so the colour buffer
// lines up 1:1 with the position buffer.
function objVertexColors(parsed) {
  const triCount = parsed.tris.length / 3;
  const colors = new Float32Array(triCount * 9);
  for (let t = 0; t < triCount; t++) {
    for (let j = 0; j < 3; j++) {
      const vi = parsed.tris[t * 3 + j], o = t * 9 + j * 3;
      colors[o] = parsed.vertColors[vi * 3]; colors[o + 1] = parsed.vertColors[vi * 3 + 1]; colors[o + 2] = parsed.vertColors[vi * 3 + 2];
    }
  }
  return colors;
}

// Bake each triangle's material diffuse colour (Kd) into a per-vertex colour
// buffer. Returns null if no triangle resolved to a material with a Kd.
function objMaterialColors(parsed, materials) {
  const triCount = parsed.tris.length / 3;
  const colors = new Float32Array(triCount * 9);
  let any = false;
  for (let t = 0; t < triCount; t++) {
    const m = materials.get(parsed.triMat[t]);
    const kd = (m && m.kd) ? m.kd : [0.8, 0.8, 0.83];
    if (m && m.kd) any = true;
    const o = t * 9;
    for (let k = 0; k < 9; k += 3) { colors[o + k] = kd[0]; colors[o + k + 1] = kd[1]; colors[o + k + 2] = kd[2]; }
  }
  return any ? colors : null;
}

// Expand vt texture coords into the same non-indexed vertex order.
function objUVs(parsed) {
  const triCount = parsed.tris.length / 3;
  const uvs = new Float32Array(triCount * 6);
  for (let t = 0; t < triCount; t++) {
    for (let j = 0; j < 3; j++) {
      const ti = parsed.triVT[t * 3 + j], o = t * 6 + j * 2;
      if (ti >= 0) { uvs[o] = parsed.vts[ti * 2]; uvs[o + 1] = parsed.vts[ti * 2 + 1]; }
    }
  }
  return uvs;
}

// Before the .mtl is supplied, an OBJ with several materials would otherwise look
// like one solid blob. Give each distinct material a different grey brightness so
// the material breakdown is visible immediately; real colours replace these once
// the .mtl is added. Returns null when there's nothing to distinguish (<2 mats).
function objMaterialPreviewColors(parsed) {
  const order = [], idx = new Map();
  for (const m of parsed.triMat) {
    const key = (m == null) ? ' none' : m;
    if (!idx.has(key)) { idx.set(key, order.length); order.push(key); }
  }
  if (order.length < 2) return null;
  const N = order.length, lo = 0.42, hi = 0.95;
  const bright = order.map((_, i) => hi - (hi - lo) * (i / (N - 1)));   // brightest -> darkest
  const triCount = parsed.tris.length / 3;
  const colors = new Float32Array(triCount * 9);
  for (let t = 0; t < triCount; t++) {
    const g = bright[idx.get(parsed.triMat[t] == null ? ' none' : parsed.triMat[t])];
    const o = t * 9;
    for (let k = 0; k < 9; k++) colors[o + k] = g;   // greyscale: r = g = b
  }
  return colors;
}

function parseOffMesh(text) {
  const toks = text.replace(/#[^\n]*/g, ' ').split(/\s+/).filter(Boolean);
  let i = 0;
  if (toks[0] && /OFF$/i.test(toks[0]) && !/^[-\d.]/.test(toks[0])) i++;   // 'OFF', 'COFF', 'NOFF'…
  const nv = +toks[i++], nf = +toks[i++]; i++; /* ne */
  const verts = [], tris = [];
  for (let v = 0; v < nv; v++) verts.push(+toks[i++], +toks[i++], +toks[i++]);
  for (let f = 0; f < nf; f++) {
    const n = +toks[i++]; const idx = [];
    for (let k = 0; k < n; k++) idx.push(+toks[i++]);
    for (let k = 1; k + 1 < idx.length; k++) tris.push(idx[0], idx[k], idx[k + 1]);
  }
  return { verts, tris };
}

const PLY_SIZE = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
function plyRead(dv, off, t, le) {
  switch (t) {
    case 'char': case 'int8': return dv.getInt8(off);
    case 'uchar': case 'uint8': return dv.getUint8(off);
    case 'short': case 'int16': return dv.getInt16(off, le);
    case 'ushort': case 'uint16': return dv.getUint16(off, le);
    case 'int': case 'int32': return dv.getInt32(off, le);
    case 'uint': case 'uint32': return dv.getUint32(off, le);
    case 'double': case 'float64': return dv.getFloat64(off, le);
    default: return dv.getFloat32(off, le);
  }
}

function parsePlyMesh(buf) {
  const bytes = new Uint8Array(buf);
  const headStr = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 1 << 16)));
  const eh = headStr.indexOf('end_header');
  if (eh < 0) return null;
  let dataStart = eh + 'end_header'.length;
  while (dataStart < bytes.length && bytes[dataStart] !== 0x0a) dataStart++;
  dataStart++;
  let format = 'ascii';
  const elements = []; let cur = null;
  for (const ln of headStr.slice(0, eh).split(/\r?\n/)) {
    const t = ln.trim().split(/\s+/);
    if (t[0] === 'format') format = t[1];
    else if (t[0] === 'element') { cur = { name: t[1], count: +t[2], props: [] }; elements.push(cur); }
    else if (t[0] === 'property' && cur) {
      if (t[1] === 'list') cur.props.push({ name: t[4], isList: true, countType: t[2], valType: t[3] });
      else cur.props.push({ name: t[2], isList: false, type: t[1] });
    }
  }
  const vEl = elements.find((e) => e.name === 'vertex');
  const fEl = elements.find((e) => e.name === 'face');
  if (!vEl) return null;
  const xi = vEl.props.findIndex((p) => p.name === 'x');
  const yi = vEl.props.findIndex((p) => p.name === 'y');
  const zi = vEl.props.findIndex((p) => p.name === 'z');
  const verts = [], tris = [];

  if (format === 'ascii') {
    const full = new TextDecoder('latin1').decode(bytes);
    const toks = full.slice(full.indexOf('\n', full.indexOf('end_header')) + 1).split(/\s+/).filter(Boolean);
    let ti = 0;
    for (let v = 0; v < vEl.count; v++) {
      let x = 0, y = 0, z = 0;
      for (let pi = 0; pi < vEl.props.length; pi++) { const val = +toks[ti++]; if (pi === xi) x = val; else if (pi === yi) y = val; else if (pi === zi) z = val; }
      verts.push(x, y, z);
    }
    if (fEl) for (let f = 0; f < fEl.count; f++) {
      const n = +toks[ti++]; const idx = [];
      for (let k = 0; k < n; k++) idx.push(+toks[ti++]);
      for (let k = 1; k + 1 < idx.length; k++) tris.push(idx[0], idx[k], idx[k + 1]);
    }
  } else {
    const le = format !== 'binary_big_endian';
    const dv = new DataView(buf);
    let off = dataStart;
    for (let v = 0; v < vEl.count; v++) {
      let x = 0, y = 0, z = 0;
      for (let pi = 0; pi < vEl.props.length; pi++) {
        const p = vEl.props[pi];
        const val = plyRead(dv, off, p.type, le); off += PLY_SIZE[p.type] || 4;
        if (pi === xi) x = val; else if (pi === yi) y = val; else if (pi === zi) z = val;
      }
      verts.push(x, y, z);
    }
    if (fEl) for (let f = 0; f < fEl.count; f++) {
      for (const p of fEl.props) {
        if (p.isList) {
          const n = plyRead(dv, off, p.countType, le); off += PLY_SIZE[p.countType] || 1;
          const idx = [];
          for (let k = 0; k < n; k++) { idx.push(plyRead(dv, off, p.valType, le)); off += PLY_SIZE[p.valType] || 4; }
          for (let k = 1; k + 1 < idx.length; k++) tris.push(idx[0], idx[k], idx[k + 1]);
        } else { off += PLY_SIZE[p.type] || 4; }
      }
    }
  }
  return { verts, tris };
}

// Single-mesh formats: parse to a geometry and show the viewer + stats (like STL).
async function renderMeshFile(file, resultsEl, ext) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading 3D model "${file.name}"…`));

  let mesh, parsed = null;
  try {
    if (ext === 'ply') mesh = parsePlyMesh(await file.arrayBuffer());
    else if (ext === 'off') mesh = parseOffMesh(await file.text());
    else { parsed = parseObjFull(await file.text()); mesh = { verts: parsed.verts, tris: parsed.tris }; }   // obj
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read ' + ext.toUpperCase() + ': ' + (e && e.message)));
    return;
  }
  resultsEl.innerHTML = '';
  if (!mesh || !mesh.tris || !mesh.tris.length) { resultsEl.appendChild(errorCard('No triangles found in this ' + ext.toUpperCase() + '.')); return; }

  // OBJ that carries colour - embedded vertex colours or a referenced .mtl - goes
  // to the coloured single-mesh path (with a picker to supply the sibling .mtl +
  // textures a lone drop can't read). Plain OBJ/PLY/OFF keep the body-split path.
  if (ext === 'obj' && (parsed.mtllib || parsed.vertColors)) return renderObjColoured(file, resultsEl, parsed);

  const geo = buildGeoFromIndexed(mesh.verts, mesh.tris, ext.toUpperCase());
  if (!geo || !geo.count) { resultsEl.appendChild(errorCard('No triangles found in this ' + ext.toUpperCase() + '.')); return; }

  // Multi-body: split into connected components and, when there's more than one,
  // offer a per-body viewer (like 3MF parts) instead of one merged mesh.
  const bodies = geo.count <= BODY_SPLIT_CAP ? splitBodiesIndexed(mesh.verts, mesh.tris, geoSpan(geo) * 1e-6) : [];
  if (bodies.length > 1) {
    const parts = bodyParts(geo, bodies, (g) => buildGeoFromIndexed(mesh.verts, subTris(mesh.tris, g), ext.toUpperCase()));
    renderPartsViewer(file, resultsEl, {
      parts, format: ext.toUpperCase(), unitLabel: 'units', partsTitle: 'Bodies',
      partsHint: `This model contains ${bodies.length} separate bodies. Pick one to view on its own, or see them all together.`,
    });
    return;
  }

  const { viewCard, viewer } = buildViewerCard(geo, '3D model');
  resultsEl.appendChild(viewCard);
  startViewer(viewer);
  resultsEl.appendChild(geoStatsCard(geo, file, ext.toUpperCase(), 'units'));
}

// OBJ viewer that honours colour. `materials` (parsed .mtl) and `texImage` (a
// decoded map_Kd image) are supplied on the second pass, once the user picks the
// sibling files; the first pass shows the model and a picker to add them.
async function renderObjColoured(file, resultsEl, parsed, materials = null, texImage = null) {
  const geo = buildGeoFromIndexed(parsed.verts, parsed.tris, 'OBJ');
  if (!geo || !geo.count) { resultsEl.innerHTML = ''; resultsEl.appendChild(errorCard('No triangles found in this OBJ.')); return; }

  if (parsed.vertColors) {
    geo.colors = objVertexColors(parsed);                  // embedded vertex colours win
  } else if (materials) {
    const cols = objMaterialColors(parsed, materials);
    if (cols) geo.colors = cols;
    if (texImage && parsed.hasVT) { geo.uvs = objUVs(parsed); geo.textureImage = texImage; }
  } else {
    // No .mtl yet: shade each material a distinct brightness so the groups read.
    const preview = objMaterialPreviewColors(parsed);
    if (preview) geo.colors = preview;
  }

  resultsEl.innerHTML = '';
  const { viewCard, viewer } = buildViewerCard(geo, '3D model');
  resultsEl.appendChild(viewCard);
  startViewer(viewer);

  if (parsed.mtllib && !parsed.vertColors && !materials) {
    resultsEl.appendChild(objMaterialsPrompt(file, resultsEl, parsed));
  } else if (materials) {
    resultsEl.appendChild(materialsSummaryCard(materials, !!texImage));
  }
  resultsEl.appendChild(geoStatsCard(geo, file, 'OBJ', 'units'));
}

// Prompt + picker to supply the .mtl (and any texture images) that a lone OBJ
// drop has no access to. Mirrors the RAW+XMP sidecar / video reference-clip flow.
function objMaterialsPrompt(file, resultsEl, parsed) {
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Colours and textures'));
  card.appendChild(el('p', { class: 'anr-hint' },
    `This model references materials in "${parsed.mtllib}". A dropped .obj can't read its sibling files, so its materials show above as plain grey shades. Add the .mtl (and any texture images it uses) to see its real colours and textures - everything stays on your device.`));

  const input = el('input', { type: 'file', accept: '.mtl,image/*', multiple: true, style: 'display:none' });
  const status = el('span', { class: 'anr-hint', style: 'display:block;margin-top:8px;' }, '');

  // Shared by the dropzone and the click-to-pick fallback: find the .mtl, parse
  // its materials, optionally decode the first matching map_Kd texture image, then
  // re-render the model in colour.
  async function applyFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const mtlFile = files.find((f) => /\.mtl$/i.test(f.name));
    if (!mtlFile) { status.textContent = 'No .mtl among the chosen files.'; return; }
    status.textContent = 'Applying materials…';
    try {
      const materials = parseMtlMaterials(await mtlFile.text());
      // Single-texture support: the first material with a map_Kd whose image was
      // also supplied, matched by filename.
      let texImage = null;
      for (const m of materials.values()) {
        if (!m.mapKd) continue;
        const want = m.mapKd.toLowerCase();
        const img = files.find((f) => f.name.toLowerCase() === want || f.name.toLowerCase().endsWith('/' + want));
        if (img) { try { texImage = await createImageBitmap(img); } catch (_) { texImage = null; } break; }
      }
      renderObjColoured(file, resultsEl, parsed, materials, texImage);
    } catch (e) {
      status.textContent = 'Could not read the .mtl: ' + (e && e.message);
    }
  }

  // The card body is a dropzone: drag the .mtl (+ any textures) onto it, or click
  // to pick. The drop is handled here and stopped from bubbling so the page-wide
  // drop handler in app.js doesn't grab the .mtl and open it on its own.
  const zone = el('div', { class: 'anr-mtl-drop', tabindex: '0', role: 'button' }, [
    el('span', { class: 'anr-mtl-drop-ico', 'aria-hidden': 'true' }, '+'),
    el('span', {}, ['Drop ', el('strong', {}, parsed.mtllib || '.mtl'), ' here, or click to choose']),
  ]);
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  zone.addEventListener('dragenter', (e) => { stop(e); zone.classList.add('is-dragover'); });
  zone.addEventListener('dragover', (e) => { stop(e); zone.classList.add('is-dragover'); });
  zone.addEventListener('dragleave', (e) => { stop(e); zone.classList.remove('is-dragover'); });
  zone.addEventListener('drop', (e) => {
    stop(e);
    zone.classList.remove('is-dragover');
    const pd = document.getElementById('pageDrop'); if (pd) pd.hidden = true;   // dismiss the page-wide overlay
    applyFiles(e.dataTransfer && e.dataTransfer.files);
  });
  input.addEventListener('change', () => applyFiles(input.files));

  card.appendChild(zone);
  card.appendChild(status);
  card.appendChild(input);
  return card;
}

// Small readout of the applied materials: a colour swatch + name, and the
// texture filename when one was mapped.
function materialsSummaryCard(materials, textured) {
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Materials'));
  const list = el('div', { style: 'display:flex;flex-direction:column;gap:6px;margin-top:6px;' });
  for (const [name, m] of materials) {
    const swatch = el('span', {
      style: `display:inline-block;width:14px;height:14px;border:1px solid var(--hairline);flex:none;background:${m.kd ? `rgb(${Math.round(m.kd[0] * 255)},${Math.round(m.kd[1] * 255)},${Math.round(m.kd[2] * 255)})` : 'transparent'};`,
    });
    const label = el('span', { style: 'font-size:13px;' }, name + (m.mapKd ? `  ·  texture: ${m.mapKd}` : ''));
    list.appendChild(el('div', { style: 'display:flex;align-items:center;gap:8px;' }, [swatch, label]));
  }
  card.appendChild(list);
  if (!textured && [...materials.values()].some((m) => m.mapKd)) {
    card.appendChild(el('p', { class: 'anr-hint', style: 'margin-top:8px;' },
      'Add the texture image alongside the .mtl to see the mapped texture, not just the base colour.'));
  }
  return card;
}

/* ============================== glTF / GLB ================================= */
// Parse glTF 2.0 (.gltf JSON, possibly with embedded data: buffers) and GLB
// (binary container) into one indexed triangle mesh for the shared WebGL viewer,
// applying the node-graph transforms. External .bin / image references can't be
// resolved (a lone drop has no sibling files), so only embedded or GLB buffer
// data is read; a .gltf that points at an external .bin shows metadata only.

const GLTF_COMP = { 5120: 'Int8', 5121: 'Uint8', 5122: 'Int16', 5123: 'Uint16', 5125: 'Uint32', 5126: 'Float32' };
const GLTF_COMP_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const GLTF_NUMC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

function parseGlb(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB (bad magic)');   // 'glTF'
  const total = dv.getUint32(8, true);
  let off = 12, json = null, bin = null;
  while (off + 8 <= total) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true); off += 8;
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off, len)));   // 'JSON'
    else if (type === 0x004e4942) bin = new Uint8Array(buf, off, len);                                     // 'BIN\0'
    off += len + ((4 - (len % 4)) % 4);   // chunks are 4-byte aligned
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  return { json, bin };
}

function dataUriToBytes(uri) {
  const comma = uri.indexOf(',');
  const meta = uri.slice(5, comma), data = uri.slice(comma + 1);
  if (/;base64/i.test(meta)) {
    const bin = atob(data), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(decodeURIComponent(data));
}

function gltfBuffers(json, glbBin) {
  return (json.buffers || []).map((b) => {
    if (!b.uri) return glbBin || null;                 // GLB binary chunk
    if (b.uri.startsWith('data:')) return dataUriToBytes(b.uri);
    return null;                                        // external file - unresolved
  });
}

// Read an accessor into a flat Float32Array (numeric component values). Handles
// interleaved bufferViews via byteStride and the standard component types.
function readAccessor(json, buffers, idx) {
  const acc = json.accessors && json.accessors[idx];
  if (!acc || acc.bufferView == null) return null;
  const numC = GLTF_NUMC[acc.type] || 1;
  const compSize = GLTF_COMP_SIZE[acc.componentType];
  const getName = GLTF_COMP[acc.componentType];
  if (!compSize || !getName) return null;
  const bv = json.bufferViews[acc.bufferView];
  const u8 = buffers[bv.buffer];
  if (!u8) return null;
  const start = u8.byteOffset + (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = bv.byteStride || numC * compSize;
  const dv = new DataView(u8.buffer);
  const get = (o) => dv['get' + getName](o, true);
  const out = new Float32Array(acc.count * numC);
  for (let i = 0; i < acc.count; i++) {
    const eo = start + i * stride;
    for (let c = 0; c < numC; c++) out[i * numC + c] = get(eo + c * compSize);
  }
  return out;
}

// Node local transform -> column-major 4x4 (matrix wins, else TRS).
function gltfNodeMatrix(node) {
  if (node.matrix) return node.matrix.slice();
  const t = node.translation || [0, 0, 0], q = node.rotation || [0, 0, 0, 1], s = node.scale || [1, 1, 1];
  const [x, y, z, w] = q, x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
function gltfMul(a, b) {   // column-major a*b
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

function gltfToMesh(json, glbBin) {
  const buffers = gltfBuffers(json, glbBin);
  const meshes = json.meshes || [], nodes = json.nodes || [];
  const verts = [], tris = [];
  let unresolved = false, nonTri = false;
  const addPrim = (prim, m) => {
    if (!prim.attributes || prim.attributes.POSITION == null) return;
    if (prim.mode != null && prim.mode !== 4) { nonTri = true; return; }   // triangles only
    const pos = readAccessor(json, buffers, prim.attributes.POSITION);
    if (!pos) { unresolved = true; return; }
    const base = verts.length / 3;
    if (m) {
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i], y = pos[i + 1], z = pos[i + 2];
        verts.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
      }
    } else for (let i = 0; i < pos.length; i++) verts.push(pos[i]);
    if (prim.indices != null) {
      const ix = readAccessor(json, buffers, prim.indices);
      if (ix) for (let i = 0; i < ix.length; i++) tris.push(base + ix[i]);
    } else {
      const n = pos.length / 3;
      for (let i = 0; i < n; i++) tris.push(base + i);
    }
  };
  const visit = (ni, parent) => {
    const node = nodes[ni]; if (!node) return;
    const m = gltfMul(parent, gltfNodeMatrix(node));
    if (node.mesh != null && meshes[node.mesh]) for (const p of meshes[node.mesh].primitives || []) addPrim(p, m);
    for (const ch of node.children || []) visit(ch, m);
  };
  const scene = json.scenes && json.scenes[json.scene || 0];
  const roots = scene ? scene.nodes : nodes.map((_, i) => i);
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const r of roots || []) visit(r, I);
  // Some exporters define meshes but never instance them via a scene node - fall
  // back to drawing every mesh untransformed so geometry still appears.
  if (!tris.length) for (const mesh of meshes) for (const p of mesh.primitives || []) addPrim(p, null);
  return { verts: new Float32Array(verts), tris: new Uint32Array(tris), unresolved, nonTri };
}

function gltfInfoCard(json, file, ext, mesh) {
  const a = json.asset || {};
  const [h, help] = h3help(ext === 'glb' ? 'glTF (binary)' : 'glTF', 'glTF ("GL Transmission Format") is the runtime 3D scene format used by the web, AR and game engines. Analyser reads the embedded geometry and scene metadata.');
  const card = el('div', { class: 'anr-card' });
  card.appendChild(h); card.appendChild(help);
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Format', ext === 'glb' ? 'GLB (binary glTF)' : 'glTF (JSON)'));
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  if (a.version) tbl.appendChild(row('glTF version', String(a.version)));
  if (a.generator) tbl.appendChild(rowHelp('Authoring tool', String(a.generator), 'The exporter or program that wrote this file (the asset.generator string).'));
  if (a.copyright) tbl.appendChild(row('Copyright', String(a.copyright)));
  const cnt = (k) => Array.isArray(json[k]) ? json[k].length : 0;
  tbl.appendChild(row('Meshes', String(cnt('meshes'))));
  tbl.appendChild(row('Nodes', String(cnt('nodes'))));
  if (cnt('materials')) tbl.appendChild(row('Materials', String(cnt('materials'))));
  if (cnt('textures')) tbl.appendChild(row('Textures', String(cnt('textures'))));
  if (cnt('animations')) tbl.appendChild(rowHelp('Animations', String(cnt('animations')), 'Keyframe animation clips. Analyser shows the static mesh, not the animation.'));
  if (cnt('skins')) tbl.appendChild(row('Skins (rigged)', String(cnt('skins'))));
  if (cnt('cameras')) tbl.appendChild(row('Cameras', String(cnt('cameras'))));
  card.appendChild(tbl);
  return card;
}

async function renderGltf(file, resultsEl, ext) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading 3D model "${file.name}"…`));

  let json, glbBin, mesh, geo;
  try {
    const buf = await file.arrayBuffer();
    if (ext === 'glb') ({ json, bin: glbBin } = parseGlb(buf));
    else json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf)));
    mesh = gltfToMesh(json, glbBin);
    geo = mesh.verts.length ? buildGeoFromIndexed(mesh.verts, mesh.tris, ext.toUpperCase()) : null;
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read ' + ext.toUpperCase() + ': ' + (e && e.message)));
    return;
  }

  resultsEl.innerHTML = '';
  resultsEl.appendChild(gltfInfoCard(json, file, ext, mesh));

  if (geo && geo.count) {
    const bodies = geo.count <= BODY_SPLIT_CAP ? splitBodiesIndexed(mesh.verts, mesh.tris, geoSpan(geo) * 1e-6) : [];
    if (bodies.length > 1) {
      const parts = bodyParts(geo, bodies, (g) => buildGeoFromIndexed(mesh.verts, subTris(mesh.tris, g), ext.toUpperCase()));
      renderPartsViewer(file, resultsEl, {
        parts, format: ext.toUpperCase(), unitLabel: 'units', partsTitle: 'Objects',
        partsHint: `This model contains ${bodies.length} separate objects. Pick one to view on its own, or see them all together.`,
      });
    } else {
      const { viewCard, viewer } = buildViewerCard(geo, '3D model');
      resultsEl.appendChild(viewCard);
      startViewer(viewer);
      resultsEl.appendChild(geoStatsCard(geo, file, ext.toUpperCase(), 'units'));
    }
  } else {
    resultsEl.appendChild(el('div', { class: 'anr-info' }, mesh && mesh.unresolved
      ? 'This glTF references external geometry (.bin) files that are not part of the drop, so the mesh itself cannot be shown. A self-contained .glb previews fully.'
      : 'No triangle geometry was found to display in this file.'));
  }
}

/* =============================== STEP / IGES ================================ */

// Merge OpenCASCADE's tessellated meshes (indexed, with normals) into one
// non-indexed geometry for the viewer.
function occtMeshesToGeo(meshes) {
  let triTotal = 0;
  for (const m of meshes) {
    const idx = m.index && m.index.array;
    triTotal += (idx ? idx.length : m.attributes.position.array.length / 3) / 3;
  }
  const positions = new Float32Array(triTotal * 9);
  const normals = new Float32Array(triTotal * 9);
  let hasNormals = false, o = 0;
  for (const m of meshes) {
    const pos = m.attributes.position.array;
    const nor = m.attributes.normal && m.attributes.normal.array;
    if (nor) hasNormals = true;
    const idx = m.index && m.index.array;
    const count = idx ? idx.length : pos.length / 3;
    for (let i = 0; i < count; i++) {
      const vi = idx ? idx[i] : i;
      positions[o] = pos[vi * 3]; positions[o + 1] = pos[vi * 3 + 1]; positions[o + 2] = pos[vi * 3 + 2];
      if (nor) { normals[o] = nor[vi * 3]; normals[o + 1] = nor[vi * 3 + 1]; normals[o + 2] = nor[vi * 3 + 2]; }
      o += 3;   // advance one vertex (3 floats)
    }
  }
  // OpenCASCADE supplies smooth normals; if a mesh somehow lacked them, fall back
  // to flat per-triangle normals so the model is still shaded.
  if (!hasNormals) {
    for (let i = 0; i < positions.length; i += 9) {
      const e1x = positions[i + 3] - positions[i], e1y = positions[i + 4] - positions[i + 1], e1z = positions[i + 5] - positions[i + 2];
      const e2x = positions[i + 6] - positions[i], e2y = positions[i + 7] - positions[i + 1], e2z = positions[i + 8] - positions[i + 2];
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const len = Math.hypot(nx, ny, nz) || 1; nx /= len; ny /= len; nz /= len;
      for (let k = 0; k < 9; k += 3) { normals[i + k] = nx; normals[i + k + 1] = ny; normals[i + k + 2] = nz; }
    }
  }
  return makeResult('STEP', positions, normals);
}

async function renderStepIges(file, resultsEl, ext) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';

  const isIges = ext === 'iges' || ext === 'igs';
  const isBrep = ext === 'brep';
  const fmtLabel = isIges ? 'IGES' : isBrep ? 'BREP' : 'STEP';

  // Header metadata first - it works offline, with no WASM. (STEP only - IGES and
  // OCCT's native BREP have no comparable text header to mine here.)
  let headerFields = null;
  if (!isIges && !isBrep) { try { headerFields = parseStepHeader(await file.slice(0, 32768).text()); } catch (_) {} }
  const metaCard = el('div', { class: 'anr-card' });
  metaCard.appendChild(el('h3', {}, fmtLabel + ' file'));
  const mt = el('table', { class: 'anr-readout' });
  mt.appendChild(row('File', file.name));
  mt.appendChild(row('Size', fmtBytes(file.size)));
  if (headerFields) for (const [k, v] of Object.entries(headerFields)) if (v != null && v !== '') mt.appendChild(row(k, String(v)));
  mt.appendChild(sha256Row(file));
  metaCard.appendChild(mt);

  // The viewer leads; the header metadata card is held back and placed below it
  // (or shown on its own if tessellation fails).
  const status = el('div', { class: 'anr-info' }, 'Loading 3D engine (OpenCASCADE)…');
  resultsEl.appendChild(status);

  let occt;
  try {
    occt = await loadOcct();
  } catch (e) {
    status.remove();
    resultsEl.appendChild(metaCard);
    resultsEl.appendChild(el('p', { class: 'anr-hint' }, 'Could not load the 3D engine (it’s fetched from the network the first time). Showing header metadata only.'));
    return;
  }

  let result = null;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    result = isIges ? occt.ReadIgesFile(buf, null)
      : isBrep ? occt.ReadBrepFile(buf, null)
      : occt.ReadStepFile(buf, null);
  } catch (e) { result = null; }

  status.remove();
  if (!result || !result.success || !result.meshes || !result.meshes.length) {
    resultsEl.appendChild(metaCard);
    resultsEl.appendChild(el('p', { class: 'anr-hint' }, 'The geometry could not be tessellated for display, but the header metadata was read from the file.'));
    return;
  }

  const geo = occtMeshesToGeo(result.meshes);
  if (!geo || !geo.count) {
    resultsEl.appendChild(metaCard);
    resultsEl.appendChild(el('p', { class: 'anr-hint' }, 'No displayable geometry was produced.'));
    return;
  }

  // OpenCASCADE already returns one mesh per solid/shape, so when there's more
  // than one, offer a per-body viewer (using the shape name where the kernel
  // provides it). occtMeshesToGeo([m]) rebuilds a single body on demand.
  const meshes = result.meshes;
  if (meshes.length > 1) {
    const parts = [{ key: 'all', name: `Whole model (${meshes.length} bodies)`, build: () => geo }];
    meshes.forEach((m, i) => parts.push({
      key: 'b' + i,
      name: (m && m.name) ? String(m.name) : ('Body ' + (i + 1)),
      build: () => occtMeshesToGeo([m]),
    }));
    renderPartsViewer(file, resultsEl, {
      metaCard, parts, format: fmtLabel + ' (tessellated)', unitLabel: 'mm', partsTitle: 'Bodies', zUp: true,
      partsHint: `This model contains ${meshes.length} separate bodies. Pick one to view on its own, or see them all together.`,
    });
    return;
  }

  resultsEl.innerHTML = '';
  const { viewCard, viewer } = buildViewerCard(geo, '3D model', { zUp: true });
  resultsEl.appendChild(viewCard);
  startViewer(viewer);
  resultsEl.appendChild(geoStatsCard(geo, file, fmtLabel + ' (tessellated)', 'mm'));
  resultsEl.appendChild(metaCard);
}

/* ============================ FBX (Autodesk) ================================
   FBX stores mesh geometry in Geometry nodes as a flat Vertices double array and
   a PolygonVertexIndex int array (the last index of each polygon is bitwise-NOT,
   i.e. negative, to mark the polygon end). Two on-disk forms:
     - Binary  : "Kaydara FBX Binary" magic, a node-record tree; array properties
                 may be zlib-deflated (Encoding == 1).
     - ASCII   : Vertices: *N { a: ... } / PolygonVertexIndex: *M { a: ... }.
   We pull every geometry's vertices + polygon indices, fan-triangulate, and feed
   the shared mesh viewer. Materials, skinning and animation are not interpreted -
   this is a geometry viewer, like the OBJ/PLY path. ========================== */

const FBX_BIN_MAGIC = 'Kaydara FBX Binary';

// Decode one FBX binary array property descriptor (inflating if zlib-encoded).
async function decodeFbxArray(d) {
  if (!d || !d.__fbxArray) return null;
  let bytes = d.data;
  if (d.encoding === 1) { bytes = await inflate(d.data, 'deflate'); if (!bytes) return null; }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Array(d.arrayLength);
  let o = 0;
  for (let i = 0; i < d.arrayLength; i++) {
    if (d.type === 'd') { out[i] = dv.getFloat64(o, true); o += 8; }
    else if (d.type === 'f') { out[i] = dv.getFloat32(o, true); o += 4; }
    else if (d.type === 'i') { out[i] = dv.getInt32(o, true); o += 4; }
    else if (d.type === 'l') { out[i] = Number(dv.getBigInt64(o, true)); o += 8; }
    else { out[i] = bytes[o]; o += 1; }   // 'b'
  }
  return out;
}

// Walk the binary node tree and collect each Geometry node's Vertices +
// PolygonVertexIndex array descriptors (decoded lazily by the caller).
function fbxBinaryGeoms(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const version = dv.getUint32(23, true);
  const big = version >= 7500;
  const word = (pos) => big ? Number(dv.getBigUint64(pos, true)) : dv.getUint32(pos, true);
  const wsz = big ? 8 : 4;
  const nullRec = big ? 25 : 13;

  const readProp = (pos) => {
    const type = String.fromCharCode(u8[pos]); pos += 1;
    switch (type) {
      case 'Y': return { value: dv.getInt16(pos, true), next: pos + 2 };
      case 'C': return { value: u8[pos], next: pos + 1 };
      case 'I': return { value: dv.getInt32(pos, true), next: pos + 4 };
      case 'F': return { value: dv.getFloat32(pos, true), next: pos + 4 };
      case 'D': return { value: dv.getFloat64(pos, true), next: pos + 8 };
      case 'L': return { value: Number(dv.getBigInt64(pos, true)), next: pos + 8 };
      case 'S': case 'R': { const len = dv.getUint32(pos, true); pos += 4; const v = type === 'S' ? ascii(u8, pos, len) : null; return { value: v, next: pos + len }; }
      case 'f': case 'd': case 'l': case 'i': case 'b': {
        const arrayLength = dv.getUint32(pos, true); const encoding = dv.getUint32(pos + 4, true); const compLen = dv.getUint32(pos + 8, true);
        pos += 12;
        return { value: { __fbxArray: true, type, arrayLength, encoding, data: u8.slice(pos, pos + compLen) }, next: pos + compLen };
      }
      default: return { value: null, next: pos, bail: true };
    }
  };

  const readNode = (pos) => {
    const endOffset = word(pos);
    if (endOffset === 0) return null;   // null record terminates a sibling list
    let p = pos + wsz;
    const numProps = word(p); p += wsz;
    p += wsz;                            // propertyListLen (unused)
    const nameLen = u8[p]; p += 1;
    const name = ascii(u8, p, nameLen); p += nameLen;
    const props = [];
    for (let i = 0; i < numProps; i++) { const r = readProp(p); props.push(r.value); p = r.next; if (r.bail) break; }
    const children = [];
    while (p < endOffset && p + nullRec <= u8.length) {
      if (word(p) === 0) { p += nullRec; break; }
      const child = readNode(p);
      if (!child) break;
      children.push(child.node); p = child.next;
    }
    return { node: { name, props, children }, next: endOffset };
  };

  const geoms = [];
  const collect = (node) => {
    if (node.name === 'Geometry') {
      let v = null, idx = null;
      for (const c of node.children) {
        if (c.name === 'Vertices' && c.props[0] && c.props[0].__fbxArray) v = c.props[0];
        else if (c.name === 'PolygonVertexIndex' && c.props[0] && c.props[0].__fbxArray) idx = c.props[0];
      }
      if (v && idx) geoms.push({ v, idx });
    }
    for (const c of node.children) collect(c);
  };

  let pos = 27;   // 23-byte magic block + 4-byte version
  while (pos < u8.length - nullRec) {
    if (word(pos) === 0) break;
    const r = readNode(pos);
    if (!r) break;
    collect(r.node);
    pos = r.next;
  }
  return { geoms, version };
}

// ASCII FBX: pull the numeric arrays straight out of the text blocks.
function fbxAsciiGeoms(text) {
  const grab = (re) => { const out = []; let m; while ((m = re.exec(text))) out.push(m[1]); return out; };
  const vs = grab(/Vertices:\s*\*\d+\s*\{\s*a:\s*([\s\S]*?)\}/g);
  const is = grab(/PolygonVertexIndex:\s*\*\d+\s*\{\s*a:\s*([\s\S]*?)\}/g);
  const geoms = [];
  for (let i = 0; i < Math.min(vs.length, is.length); i++) {
    geoms.push({
      vertices: vs[i].split(',').map(parseFloat).filter((x) => !isNaN(x)),
      indices: is[i].split(',').map((s) => parseInt(s, 10)).filter((x) => !isNaN(x)),
    });
  }
  return geoms;
}

// Parse an FBX buffer into merged { verts, tris } plus a little metadata.
async function parseFbx(buf) {
  const u8 = new Uint8Array(buf);
  let isBinary = u8.length > FBX_BIN_MAGIC.length;
  for (let i = 0; i < FBX_BIN_MAGIC.length && isBinary; i++) if (u8[i] !== FBX_BIN_MAGIC.charCodeAt(i)) isBinary = false;

  let rawGeoms = [], version = null;
  if (isBinary) {
    const r = fbxBinaryGeoms(u8); version = r.version;
    for (const g of r.geoms) {
      const vertices = await decodeFbxArray(g.v);
      const indices = await decodeFbxArray(g.idx);
      if (vertices && indices) rawGeoms.push({ vertices, indices });
    }
  } else {
    const text = latin1(u8);
    rawGeoms = fbxAsciiGeoms(text);
    const vm = text.match(/FBXVersion:\s*(\d+)/); if (vm) version = +vm[1];
  }

  const verts = [], tris = [];
  for (const g of rawGeoms) {
    const base = verts.length / 3;
    for (const x of g.vertices) verts.push(x);
    let poly = [];
    for (let k = 0; k < g.indices.length; k++) {
      let idx = g.indices[k]; let end = false;
      if (idx < 0) { idx = ~idx; end = true; }
      poly.push(base + idx);
      if (end) { for (let f = 1; f + 1 < poly.length; f++) tris.push(poly[0], poly[f], poly[f + 1]); poly = []; }
    }
  }
  return { verts, tris, version, geomCount: rawGeoms.length };
}

async function renderFbx(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading 3D model "${file.name}"…`));

  let mesh;
  try { mesh = await parseFbx(await file.arrayBuffer()); }
  catch (e) { resultsEl.innerHTML = ''; resultsEl.appendChild(errorCard('Could not read FBX: ' + (e && e.message))); return; }
  resultsEl.innerHTML = '';

  if (!mesh.tris.length) {
    const c = el('div', { class: 'anr-card' });
    c.appendChild(el('h3', {}, 'FBX model'));
    const t = el('table', { class: 'anr-readout' });
    t.appendChild(row('File', file.name));
    t.appendChild(row('Size', fmtBytes(file.size)));
    if (mesh.version) t.appendChild(row('FBX version', String(mesh.version)));
    t.appendChild(sha256Row(file));
    c.appendChild(t);
    c.appendChild(el('p', { class: 'anr-hint', style: 'margin-top:8px;' },
      'No displayable mesh geometry was found - this FBX may contain only cameras, lights, skeletons or animation, or use an array encoding this viewer does not support.'));
    resultsEl.appendChild(c);
    return;
  }

  const geo = buildGeoFromIndexed(mesh.verts, mesh.tris, 'FBX');
  if (!geo || !geo.count) { resultsEl.appendChild(errorCard('No triangles found in this FBX.')); return; }

  const bodies = geo.count <= BODY_SPLIT_CAP ? splitBodiesIndexed(mesh.verts, mesh.tris, geoSpan(geo) * 1e-6) : [];
  if (bodies.length > 1) {
    const parts = bodyParts(geo, bodies, (g) => buildGeoFromIndexed(mesh.verts, subTris(mesh.tris, g), 'FBX'));
    renderPartsViewer(file, resultsEl, {
      parts, format: 'FBX', unitLabel: 'units', partsTitle: 'Bodies',
      partsHint: `This model contains ${bodies.length} separate bodies. Pick one to view on its own, or see them all together.`,
    });
    return;
  }

  const { viewCard, viewer } = buildViewerCard(geo, '3D model');
  resultsEl.appendChild(viewCard);
  startViewer(viewer);
  resultsEl.appendChild(geoStatsCard(geo, file, 'FBX', 'units'));
}
