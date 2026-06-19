/* Analyser - 3D model viewer for 3MF / STEP / IGES
   - 3MF: a ZIP of 3D-manufacturing XML. Parsed natively (fflate + regex/DOM) so
     every object/assembly on the build can be viewed individually. Handles the
     production extension (one .model file per part, referenced by the root model).
   - STEP / IGES: B-rep CAD. Tessellated to a mesh by the OpenCASCADE WASM kernel
     (lazy-loaded), with the ISO-10303 header metadata shown alongside.
   All three feed the shared WebGL viewer from stl.js. */

import { el, row, rowHelp, h3help, fmtBytes, sha256Row, errorCard } from '../core/util.js';
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

function addMesh(acc, mesh, M) {
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
}

// Accumulate the meshes of a main-file object: its own mesh (rare) plus each
// component's referenced part, with transforms composed onto the base matrix.
function gatherObject(model, files, mainText, objectid, baseM, acc) {
  const obj = model.objects.get(objectid);
  if (!obj) return;
  if (obj.hasMesh) {
    const t = extractObjectText(mainText, objectid);
    if (t) addMesh(acc, parseMeshText(t), baseM);
  }
  for (const c of obj.comps) {
    const m = compose(parseTransform(c.transform), baseM);
    const text = findFile(files, c.path);
    if (!text) continue;
    const t = extractObjectText(text, c.objectid);
    if (t) addMesh(acc, parseMeshText(t), m);
  }
}

function resolvePart(model, files, mainText, objectid) {
  const acc = { verts: [], tris: [] };
  gatherObject(model, files, mainText, objectid, IDENTITY12, acc);
  return acc.tris.length ? buildGeoFromIndexed(acc.verts, acc.tris, '3MF') : null;
}

function resolveWholeBuild(model, files, mainText) {
  const acc = { verts: [], tris: [] };
  for (const it of model.build) gatherObject(model, files, mainText, it.objectid, parseTransform(it.transform), acc);
  return acc.tris.length ? buildGeoFromIndexed(acc.verts, acc.tris, '3MF') : null;
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

  let files, mainText, model;
  try {
    const ffl = await fflate();
    const data = new Uint8Array(await file.arrayBuffer());
    const unzipped = ffl.unzipSync(data, { filter: (f) => /\.model$/i.test(f.name) });
    files = new Map();
    const dec = new TextDecoder('utf-8');
    for (const [name, bytes] of Object.entries(unzipped)) files.set(name, dec.decode(bytes));
    const mainKey = [...files.keys()].find((k) => /(^|\/)3dmodel\.model$/i.test(k)) || [...files.keys()][0];
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

  const parts = items.map((it, i) => {
    const obj = model.objects.get(it.objectid) || { comps: [], name: '' };
    return { key: 'p' + i, name: partName(obj, i + 1), build: () => resolvePart(model, files, mainText, it.objectid) };
  });
  if (parts.length > 1) {
    parts.unshift({ key: 'all', name: `Whole build (${items.length} parts)`, build: () => resolveWholeBuild(model, files, mainText) });
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
  mt.appendChild(row('File', file.name));
  mt.appendChild(row('Size', fmtBytes(file.size)));
  mt.appendChild(sha256Row(file));
  metaCard.appendChild(mt);

  renderPartsViewer(file, resultsEl, {
    metaCard, parts, format: '3MF mesh',
    unitLabel: model.unit === 'millimeter' ? 'mm' : (model.unit || 'units')
  });
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

  renderPartsViewer(file, resultsEl, { metaCard, parts, format: 'AMF mesh', unitLabel: AMF_UNIT[unit] || unit });
}

/* =========================== OBJ / PLY / OFF ================================ */

function parseObjMesh(text) {
  const verts = [], tris = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const c0 = line.charCodeAt(0);
    if (c0 === 118 /* v */ && (line[1] === ' ' || line[1] === '\t')) {
      const p = line.trim().split(/\s+/);
      verts.push(+p[1], +p[2], +p[3]);
    } else if (c0 === 102 /* f */ && (line[1] === ' ' || line[1] === '\t')) {
      const p = line.trim().split(/\s+/);
      const idx = [];
      for (let i = 1; i < p.length; i++) {
        let vi = parseInt(p[i].split('/')[0], 10);
        if (!isFinite(vi)) continue;
        if (vi < 0) vi = verts.length / 3 + vi + 1;   // relative index
        idx.push(vi - 1);
      }
      for (let i = 1; i + 1 < idx.length; i++) tris.push(idx[0], idx[i], idx[i + 1]);  // fan triangulate
    }
  }
  return { verts, tris };
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

  let geo, mesh;
  try {
    if (ext === 'ply') mesh = parsePlyMesh(await file.arrayBuffer());
    else if (ext === 'off') mesh = parseOffMesh(await file.text());
    else mesh = parseObjMesh(await file.text());   // obj
    geo = mesh ? buildGeoFromIndexed(mesh.verts, mesh.tris, ext.toUpperCase()) : null;
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read ' + ext.toUpperCase() + ': ' + (e && e.message)));
    return;
  }
  resultsEl.innerHTML = '';
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
      metaCard, parts, format: fmtLabel + ' (tessellated)', unitLabel: 'mm', partsTitle: 'Bodies',
      partsHint: `This model contains ${meshes.length} separate bodies. Pick one to view on its own, or see them all together.`,
    });
    return;
  }

  resultsEl.innerHTML = '';
  const { viewCard, viewer } = buildViewerCard(geo, '3D model');
  resultsEl.appendChild(viewCard);
  startViewer(viewer);
  resultsEl.appendChild(geoStatsCard(geo, file, fmtLabel + ' (tessellated)', 'mm'));
  resultsEl.appendChild(metaCard);
}
