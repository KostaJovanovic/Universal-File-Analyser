/* Analyser - 3D PDF models (PRC / U3D)

   A "3D PDF" carries a model as a stream object (/Type /3D, /Subtype /PRC or
   /U3D) that a 3D annotation on a page points at through its /3DD entry. pdf.js
   draws only the page, which for these files is a flat poster image, so this
   module finds the streams itself and hands PRC to nanoPRC (lib/nanoprc-loader)
   for triangles, then to stl.ts's parts viewer.

   Which stream is current is decided by the annotations, not by the streams: an
   incremental save (Acrobat adding a cross-section, say) appends a NEW model
   object and repoints /3DD at it, leaving the old one in the file. The
   annotation usually sits in a compressed object stream, so those are inflated
   and searched too. The last definition of each object in file order wins, the
   way a reader applies incremental updates. Replaced and orphaned models stay
   listed, and can be viewed - they are what the file looked like before.

   Lazy-imported by pdf.ts into a slot under the page previews. Draws nothing
   when the PDF holds no 3D stream. */

import { el, row, rowHelp, fmtBytes, errorCard, downloadBlob } from '../core/util.js';
import { inflate } from '../core/binutil.js';
import { SCAN_SMALL, PDF_3D_SCAN_MAX, PRC_STREAM_MAX, PDF_3D_OBJ_INDEX_MAX, PDF_3D_VIEWS_MAX } from '../core/limits.js';
import { makeResult, renderPartsViewer } from './stl.js';
import { decodePrc } from '../lib/nanoprc-loader.js';
import type { MeshGeometry, MeshPart, SavedView } from './stl.js';
import type { PrcMesh, PrcPart } from '../lib/nanoprc-loader.js';

/** One definition of a 3D (or object) stream, located in the file. */
interface StreamDef {
  obj: number;
  /** Byte offset of the object's dictionary hit; orders definitions. */
  pos: number;
  dict: string;
  dataStart: number;
  length: number;
  filters: string[];
}

interface Model3d extends StreamDef {
  format: 'PRC' | 'U3D';
  status: 'current' | 'replaced' | 'orphaned';
}

/** An annotation's /3DD reference, with where that annotation was defined. */
interface DddRef { annot: string; target: number; order: number }

const latin1 = new TextDecoder('latin1');
const tick = () => new Promise((r) => setTimeout(r, 0));

// The last "N G obj" header in `text` before `idx`, or -1.
function objBefore(text: string, idx: number): { obj: number; at: number } {
  const re = /(\d+)\s+\d+\s+obj\b/g;
  const part = text.slice(Math.max(0, idx - 8192), idx);
  let m, obj = -1, at = -1;
  while ((m = re.exec(part))) { obj = +m[1]; at = m.index + Math.max(0, idx - 8192); }
  return { obj, at };
}

// Where the stream's data really ends: "endstream", searched for from `start`.
// Used when /Length is an indirect reference or does not land on the keyword.
async function findEndstream(file: File, start: number, max: number): Promise<number> {
  const STEP = 1024 * 1024;
  for (let off = start; off < file.size && off - start <= max; off += STEP - 16) {
    const t = latin1.decode(new Uint8Array(await file.slice(off, off + STEP).arrayBuffer()));
    const i = t.indexOf('endstream');
    if (i !== -1) {
      let end = off + i;
      // The EOL before the keyword belongs to the syntax, not the data.
      const tail = t.slice(Math.max(0, i - 2), i);
      end -= tail.endsWith('\r\n') ? 2 : (tail.endsWith('\n') || tail.endsWith('\r')) ? 1 : 0;
      return end - start;
    }
  }
  return -1;
}

// Read the stream object whose dictionary contains the hit at `hit`.
async function streamAt(file: File, hit: number): Promise<StreamDef | null> {
  const from = Math.max(0, hit - 8192);
  const t = latin1.decode(new Uint8Array(await file.slice(from, hit + 16384).arrayBuffer()));
  const rel = hit - from;
  const head = objBefore(t, rel);
  if (head.obj < 0) return null;
  const sre = /stream(\r\n|\n)/g;
  sre.lastIndex = rel;
  const s = sre.exec(t);
  if (!s || t.slice(rel, s.index).includes('endobj')) return null;
  const dict = t.slice(head.at, s.index);
  const dataStart = from + s.index + s[0].length;
  const fm = /\/Filter\s*(?:\[([^\]]*)\]|\/(\w+))/.exec(dict);
  const filters = fm ? (fm[2] ? [fm[2]] : [...fm[1].matchAll(/\/(\w+)/g)].map((x) => x[1])) : [];
  let length = -1;
  const lm = /\/Length\s+(\d+)(\s+\d+\s+R)?/.exec(dict);
  if (lm && !lm[2]) {
    // Trust a direct /Length only if "endstream" follows it.
    const after = latin1.decode(new Uint8Array(await file.slice(dataStart + +lm[1], dataStart + +lm[1] + 64).arrayBuffer()));
    if (/^\s*endstream/.test(after)) length = +lm[1];
  }
  if (length < 0) length = await findEndstream(file, dataStart, PRC_STREAM_MAX);
  if (length < 0) return null;
  return { obj: head.obj, pos: hit, dict, dataStart, length, filters };
}

// The stream's bytes with its filter undone, or a reason it can't be.
async function streamBytes(file: File, s: StreamDef, maxOut: number): Promise<Uint8Array | string> {
  if (s.length > maxOut) return 'it is ' + fmtBytes(s.length) + ', past this device\'s ' + fmtBytes(maxOut) + ' limit';
  const raw = file.slice(s.dataStart, s.dataStart + s.length);
  if (!s.filters.length) return new Uint8Array(await raw.arrayBuffer());
  if (s.filters.length !== 1 || s.filters[0] !== 'FlateDecode') return 'it uses the ' + s.filters.join(' + ') + ' filter, which is not supported here';
  // partial: a /Length one byte long leaves junk after the zlib trailer, which
  // DecompressionStream rejects even though everything before it decoded.
  const out = await inflate(raw, 'deflate', maxOut, { partial: true });
  if (out && out.length >= maxOut) return 'it inflates past this device\'s ' + fmtBytes(maxOut) + ' limit';
  return out && out.length ? out : 'its compressed data could not be inflated';
}

interface Scan {
  models: Model3d[];
  encrypted: boolean;
  /** The text of object `n` (its latest definition), or null. */
  obj: (n: number) => Promise<string | null>;
}

async function scanPdf(file: File): Promise<Scan> {
  const OVERLAP = 4096;
  const seen = new Set<number>();
  const hits3d: { pos: number; format: 'PRC' | 'U3D' }[] = [];
  const objStms: number[] = [];
  const refs: DddRef[] = [];
  // Where each object is defined, for obj(): a plain "N G obj" header, or the
  // object stream that holds it. Later wins, as a reader applies updates.
  const plainAt = new Map<number, number>();
  const inStm = new Map<number, number>();
  let encrypted = false;
  const re = /\/Subtype\s*\/(PRC|U3D)\b|\/Type\s*\/ObjStm\b|\/3DD\s*(\d+)\s+\d+\s+R|\/Encrypt\b|(\d+)\s+\d+\s+obj\b/g;
  for (let off = 0; off < file.size; off += SCAN_SMALL) {
    const t = latin1.decode(new Uint8Array(await file.slice(off, off + SCAN_SMALL + OVERLAP).arrayBuffer()));
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(t))) {
      const abs = off + m.index;
      // Headers skip `seen`: setting the same position twice is harmless, and a
      // PDF has far more objects than 3D hits.
      if (m[3]) { if (plainAt.size < PDF_3D_OBJ_INDEX_MAX || plainAt.has(+m[3])) plainAt.set(+m[3], abs); continue; }
      if (seen.has(abs)) continue;   // found again in the overlap
      seen.add(abs);
      if (m[1]) hits3d.push({ pos: abs, format: m[1] as 'PRC' | 'U3D' });
      else if (m[2]) {
        const o = objBefore(t, m.index).obj;
        refs.push({ annot: o >= 0 ? 'o' + o : 'p' + abs, target: +m[2], order: abs });
      } else if (m[0].startsWith('/Encrypt')) encrypted = true;
      else objStms.push(abs);
    }
    await tick();
  }
  if (!hits3d.length) return { models: [], encrypted, obj: async () => null };

  // Annotations held in compressed object streams. The header is "objnum
  // offset" pairs, offsets counted from /First, so a hit maps to the object
  // whose offset is the largest one not past it.
  if (!encrypted) {
    for (const pos of objStms) {
      const s = await streamAt(file, pos).catch(() => null);
      if (!s) continue;
      const first = +((/\/First\s+(\d+)/.exec(s.dict) || [])[1] || 0);
      const bytes = await streamBytes(file, s, SCAN_SMALL);
      if (typeof bytes === 'string' || !first) continue;
      const text = latin1.decode(bytes);
      const index = stmIndex(text, first);
      for (const [n] of index) if (inStm.size < PDF_3D_OBJ_INDEX_MAX || inStm.has(n)) inStm.set(n, pos);
      if (!text.includes('/3DD')) continue;
      for (const d of text.matchAll(/\/3DD\s*(\d+)\s+\d+\s+R/g)) {
        const at = d.index! - first;
        let owner = -1;
        for (const [n, o] of index) if (o <= at) owner = n;
        refs.push({ annot: owner >= 0 ? 'o' + owner : 'p' + pos, target: +d[1], order: pos });
      }
    }
  }

  const defs: Model3d[] = [];
  for (const h of hits3d) {
    const s = await streamAt(file, h.pos).catch(() => null);
    if (s) defs.push({ ...s, format: h.format, status: 'current' });
  }
  // Latest definition of each object, then of each annotation's /3DD.
  defs.sort((a, b) => a.pos - b.pos);
  const latest = new Map<number, Model3d>();
  for (const d of defs) latest.set(d.obj, d);
  const annots = new Map<string, DddRef>();
  for (const r of refs.sort((a, b) => a.order - b.order)) annots.set(r.annot, r);
  const used = new Set([...annots.values()].map((r) => r.target));
  const anyUsed = [...latest.keys()].some((o) => used.has(o));
  for (const d of defs) {
    if (latest.get(d.obj) !== d) d.status = 'replaced';
    // No annotation found pointing at any of them (an unusual writer, or the
    // annotation is somewhere this scan cannot read): show them all.
    else if (anyUsed && !used.has(d.obj)) d.status = 'orphaned';
  }

  const stmCache = new Map<number, Promise<{ text: string; first: number; index: [number, number][] } | null>>();
  const openStm = (pos: number) => {
    let p = stmCache.get(pos);
    if (!p) {
      p = (async () => {
        const s = await streamAt(file, pos).catch(() => null);
        const first = s ? +((/\/First\s+(\d+)/.exec(s.dict) || [])[1] || 0) : 0;
        const bytes = s && first ? await streamBytes(file, s, SCAN_SMALL) : '';
        if (typeof bytes === 'string') return null;
        const text = latin1.decode(bytes);
        return { text, first, index: stmIndex(text, first) };
      })();
      stmCache.set(pos, p);
    }
    return p;
  };
  async function obj(n: number): Promise<string | null> {
    if (encrypted) return null;
    const plain = plainAt.get(n), stm = inStm.get(n);
    if (stm != null && (plain == null || stm > plain)) {
      const s = await openStm(stm);
      const i = s ? s.index.findIndex(([k]) => k === n) : -1;
      if (!s || i < 0) return null;
      const end = i + 1 < s.index.length ? s.first + s.index[i + 1][1] : s.text.length;
      return s.text.slice(s.first + s.index[i][1], end);
    }
    if (plain == null) return null;
    const t = latin1.decode(new Uint8Array(await file.slice(plain, plain + 65536).arrayBuffer()));
    const body = t.replace(/^\d+\s+\d+\s+obj\b/, '');
    const end = body.search(/\bendobj\b|\bstream\r?\n/);
    return end < 0 ? null : body.slice(0, end);
  }
  return { models: defs, encrypted, obj };
}

// An object stream's header: "objnum offset" pairs, offsets counted from /First.
function stmIndex(text: string, first: number): [number, number][] {
  const nums = text.slice(0, first).trim().split(/\s+/).map(Number);
  const index: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) index.push([nums[i], nums[i + 1]]);
  return index;
}

// ---------- named views (/VA) ----------

// A PDF string's bytes as text: escapes undone, and UTF-16 when it carries the BOM.
function pdfString(raw: string): string {
  const b = raw.replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (_, e: string) =>
    /^[0-7]/.test(e) ? String.fromCharCode(parseInt(e, 8) & 255)
      : e[0] === '\n' || e[0] === '\r' ? ''
      : ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' } as Record<string, string>)[e] || e);
  if (b.charCodeAt(0) === 0xFE && b.charCodeAt(1) === 0xFF) {
    let s = '';
    for (let i = 2; i + 1 < b.length; i += 2) s += String.fromCharCode(b.charCodeAt(i) << 8 | b.charCodeAt(i + 1));
    return s;
  }
  return b;
}

const nums = (s: string) => s.trim().split(/\s+/).map((x) => x === 'null' ? null : Number(x));
const refsIn = (s: string) => [...s.matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => +m[1]);

// An entry that is either written in place or an indirect reference, as text.
async function entry(dict: string, key: string, obj: Scan['obj']): Promise<string | null> {
  const m = new RegExp('/' + key + '\\s*(?:(\\d+)\\s+\\d+\\s+R|(\\[[^\\]]*\\]|<<[\\s\\S]*?>>))').exec(dict);
  if (!m) return null;
  return m[2] != null ? m[2] : obj(+m[1]);
}

// The cutting plane's normal from a 3DCrossSection's /O: three angles in degrees,
// one of them null. The null one names the axis the plane is first perpendicular
// to; the others then turn it about X, then Y, then Z.
function sectionNormal(o: (number | null)[]): number[] {
  let n = [0, 0, 0];
  const nul = o.indexOf(null);
  n[nul < 0 ? 0 : nul] = 1;
  const rad = (d: number | null) => (d || 0) * Math.PI / 180;
  const [ax, ay, az] = [rad(o[0]), rad(o[1]), rad(o[2])];
  n = [n[0], n[1] * Math.cos(ax) - n[2] * Math.sin(ax), n[1] * Math.sin(ax) + n[2] * Math.cos(ax)];
  n = [n[0] * Math.cos(ay) + n[2] * Math.sin(ay), n[1], -n[0] * Math.sin(ay) + n[2] * Math.cos(ay)];
  n = [n[0] * Math.cos(az) - n[1] * Math.sin(az), n[0] * Math.sin(az) + n[1] * Math.cos(az), n[2]];
  return n;
}

// The model's named views, in the order the file lists them. Only views that
// place the camera with a matrix (/MS /M) are read; the U3D-path kind and any
// view without one are skipped.
async function readViews(m: Model3d, obj: Scan['obj']): Promise<SavedView[]> {
  const va = await entry(m.dict, 'VA', obj);
  if (!va) return [];
  const out: SavedView[] = [];
  for (const n of refsIn(va).slice(0, PDF_3D_VIEWS_MAX)) {
    const d = await obj(n);
    if (!d || /\/MS\s*\/U3D/.test(d)) continue;
    const c = /\/C2W\s*\[([^\]]*)\]/.exec(d);
    const c2w = c ? nums(c[1]) as number[] : [];
    if (c2w.length !== 12 || c2w.some((x) => !isFinite(x))) continue;
    const name = /\/XN\s*\(((?:\\[\s\S]|[^\\)])*)\)/.exec(d);
    const proj = await entry(d, 'P', obj);
    let clip: SavedView['clip'] = null;
    const sa = await entry(d, 'SA', obj);
    // Only the first cross-section is drawn; a view with several is rare.
    const cs = sa ? (/<<[\s\S]*?>>/.exec(sa) || [null])[0] || (refsIn(sa)[0] != null ? await obj(refsIn(sa)[0]) : null) : null;
    if (cs) {
      const pt = /\/C\s*\[([^\]]*)\]/.exec(cs), or = /\/O\s*\[([^\]]*)\]/.exec(cs);
      const point = pt ? nums(pt[1]) as number[] : [0, 0, 0];
      const o = or ? nums(or[1]) : [null, 0, 0];
      if (point.length === 3 && point.every(isFinite) && o.length === 3) clip = { point, normal: sectionNormal(o) };
    }
    // C2W's columns are the camera's axes in the model: it looks along the third, up is the second.
    out.push({
      name: name ? pdfString(name[1]).trim() || 'View ' + (out.length + 1) : 'View ' + (out.length + 1),
      dir: c2w.slice(6, 9), up: c2w.slice(3, 6), eye: c2w.slice(9, 12),
      ortho: !!proj && /\/Subtype\s*\/O\b/.test(proj),
      clip,
    });
  }
  return out;
}

// ---------- geometry ----------

function geoFrom(parts: PrcPart[], hasColour: boolean): MeshGeometry {
  let n = 0;
  for (const p of parts) n += p.positions.length;
  const pos = new Float32Array(n), nrm = new Float32Array(n);
  const col = hasColour ? new Float32Array(n) : null;
  let o = 0;
  for (const p of parts) {
    pos.set(p.positions, o);
    nrm.set(p.normals, o);
    if (col) for (let i = 0; i < p.colors.length; i++) col[o + i] = p.colors[i] / 255;
    o += p.positions.length;
  }
  const geo = makeResult('PRC (3D PDF)', pos, nrm);
  if (col) geo.colors = col;
  return geo;
}

// Binary STL of every part: 80-byte header, count, then 50 bytes a triangle.
function stlBlob(mesh: PrcMesh): Blob {
  const buf = new ArrayBuffer(84 + 50 * mesh.triangles);
  const dv = new DataView(buf);
  const head = 'Analyser - exported from a 3D PDF (PRC)';
  for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
  dv.setUint32(80, mesh.triangles, true);
  let o = 84;
  for (const p of mesh.parts) {
    const v = p.positions;
    for (let t = 0; t < p.triangles; t++) {
      const i = t * 9;
      const ux = v[i + 3] - v[i], uy = v[i + 4] - v[i + 1], uz = v[i + 5] - v[i + 2];
      const wx = v[i + 6] - v[i], wy = v[i + 7] - v[i + 1], wz = v[i + 8] - v[i + 2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
      for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, v[i + k], true);
      o += 50;   // the attribute word stays 0
    }
  }
  return new Blob([buf], { type: 'model/stl' });
}

// Parts with the same name (bolts, blades) become one chip, "name ×N".
function meshParts(mesh: PrcMesh): MeshPart[] {
  const groups = new Map<string, PrcPart[]>();
  for (const p of mesh.parts) {
    if (!p.triangles) continue;
    const k = p.name.trim() || 'Unnamed part';
    const g = groups.get(k);
    if (g) g.push(p); else groups.set(k, [p]);
  }
  const out: MeshPart[] = [{
    key: 'all',
    name: groups.size > 1 ? `Whole model (${mesh.parts.length} parts)` : 'Whole model',
    build: () => geoFrom(mesh.parts, mesh.hasColour),
  }];
  if (groups.size > 1) {
    let i = 0;
    for (const [name, list] of groups) {
      out.push({ key: 'g' + i++, name: list.length > 1 ? `${name} ×${list.length}` : name, build: () => geoFrom(list, mesh.hasColour) });
    }
  }
  return out;
}

// ---------- card ----------

const STATUS_LABEL = {
  current: 'shown by the PDF',
  replaced: 'replaced by a later save',
  orphaned: 'no longer shown (no 3D view points at it)',
};

export async function renderPdf3d(file: File, slot: HTMLElement, opts: { viewer?: boolean } = {}) {
  if (file.size > PDF_3D_SCAN_MAX) return;
  let scan: Scan;
  try { scan = await scanPdf(file); } catch (_) { return; }
  const { models } = scan;
  if (!models.length || !slot.isConnected) return;

  const stem = (file.name || 'model').replace(/\.[^.]+$/, '');
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, '3D model'));
  card.appendChild(el('p', { class: 'anr-hint', style: 'margin-bottom:10px;' },
    'This is a 3D PDF: besides its pages it carries a 3D model that Adobe Acrobat shows as an interactive view. Analyser reads the model on this device and draws it below.'));
  const tbl = el('table', { class: 'anr-readout' });
  card.appendChild(tbl);
  const btnRow = el('div', { class: 'anr-btn-row', style: 'flex-wrap:wrap;gap:6px;margin-top:10px;' });
  card.appendChild(btnRow);
  const viewSlot = el('div');
  slot.innerHTML = '';
  slot.appendChild(card);
  slot.appendChild(viewSlot);

  if (scan.encrypted) {
    tbl.appendChild(row('Models', String(models.length)));
    card.appendChild(errorCard('This PDF is encrypted, so its 3D model cannot be read here.'));
    return;
  }

  const current = models.filter((m) => m.status === 'current');
  const multi = models.length > 1;
  const objName = (m: Model3d) => multi ? `${stem}_obj${m.obj}` : stem;
  const decoded = new Map<Model3d, Promise<{ bytes: Uint8Array; mesh: PrcMesh | null; error?: string }>>();

  function decode(m: Model3d) {
    let p = decoded.get(m);
    if (!p) {
      p = (async () => {
        const bytes = await streamBytes(file, m, PRC_STREAM_MAX);
        if (typeof bytes === 'string') return { bytes: new Uint8Array(0), mesh: null, error: 'The model could not be read: ' + bytes + '.' };
        if (m.format !== 'PRC') return { bytes, mesh: null };
        try { return { bytes, mesh: await decodePrc(bytes) }; } catch (e) {
          return { bytes, mesh: null, error: 'The PRC model could not be decoded: ' + (e && e.message) + '.' };
        }
      })();
      decoded.set(m, p);
    }
    return p;
  }

  let showing = 0;
  async function show(m: Model3d) {
    const turn = ++showing;
    tbl.innerHTML = '';
    btnRow.innerHTML = '';
    viewSlot.innerHTML = '';
    tbl.appendChild(rowHelp('Format', m.format === 'PRC' ? 'PRC (Product Representation Compact)' : 'U3D (Universal 3D)',
      'The 3D format inside the PDF. PRC is Adobe\'s CAD-oriented format and keeps a model\'s parts and their placement; U3D is an older, mesh-only format.'));
    if (multi) tbl.appendChild(row('Model', `object ${m.obj} - ${STATUS_LABEL[m.status]}`));
    tbl.appendChild(row(m.filters.length ? 'Stored size' : 'Size', fmtBytes(m.length) + (m.filters.length ? ' (' + m.filters.join(', ') + ')' : '')));
    viewSlot.appendChild(el('div', { class: 'anr-info' }, 'Decoding the 3D model…'));
    const r = await decode(m);
    if (!viewSlot.isConnected || turn !== showing) return;   // another file, or another model picked
    viewSlot.innerHTML = '';
    if (r.bytes.length) {
      // PRC compresses itself, so most writers store it unfiltered and the two match.
      if (r.bytes.length !== m.length) tbl.appendChild(row('Model size', fmtBytes(r.bytes.length)));
      const ext = m.format === 'PRC' ? '.prc' : '.u3d';
      btnRow.appendChild(el('button', { type: 'button', class: 'anr-btn', onclick: () => downloadBlob(objName(m) + ext, new Blob([r.bytes as BlobPart])) },
        'Download model (' + ext + ')'));
    }
    if (r.error) { viewSlot.appendChild(errorCard(r.error)); return; }
    if (!r.mesh) {
      viewSlot.appendChild(el('div', { class: 'anr-info' }, 'U3D models are not drawn here yet. Download the model to open it in a U3D viewer.'));
      return;
    }
    const mesh = r.mesh;
    tbl.appendChild(rowHelp('Parts', mesh.parts.length.toLocaleString(), 'The pieces of the assembly that carry geometry, each placed where the model puts it.'));
    tbl.appendChild(rowHelp('Triangles', mesh.triangles.toLocaleString() + (mesh.truncated ? ' (stopped at this device\'s limit - the model is larger)' : ''),
      'PRC usually stores its surfaces already split into triangles, in a compressed form. This is how many were decoded.'));
    tbl.appendChild(row('Colours', mesh.hasColour ? 'from the file' : 'none stored'));
    if (!mesh.triangles) { viewSlot.appendChild(errorCard('The model holds no drawable triangles (it may store only exact surfaces or curves).')); return; }
    btnRow.appendChild(el('button', { type: 'button', class: 'anr-btn', onclick: () => downloadBlob(objName(m) + '.stl', stlBlob(mesh)) }, 'Save as STL'));
    if (opts.viewer === false) return;
    const views = await readViews(m, scan.obj).catch(() => [] as SavedView[]);
    if (!viewSlot.isConnected || turn !== showing) return;
    if (views.length) tbl.appendChild(rowHelp('Views', views.map((v) => v.name).join(', '),
      'Camera positions the PDF stores by name, as Acrobat lists them under Views. Pick one under the 3D view to see the model from there; a view marked "section" also cuts the model open along a plane.'));
    renderPartsViewer(file, viewSlot, {
      parts: meshParts(mesh), format: 'PRC (3D PDF)', zUp: true, views,
      partsTitle: '3D model parts',
      partsHint: 'Pick a part to view it on its own, or see the whole model together. Parts that share a name are grouped.',
    });
  }

  // Every model in the file, when there is more than one: the earlier versions
  // a later save left behind are evidence of how the model changed.
  if (multi) {
    const list = el('table', { class: 'anr-readout', style: 'margin-top:10px;' });
    for (const m of models) {
      list.appendChild(el('tr', {}, [
        el('th', {}, `Object ${m.obj}`),
        el('td', {}, `${m.format}, ${fmtBytes(m.length)}, ${STATUS_LABEL[m.status]}`),
        el('td', {}, el('button', { type: 'button', class: 'anr-btn', onclick: () => { show(m); } }, 'View')),
      ]));
    }
    const det = el('details', { style: 'margin-top:10px;' });
    det.appendChild(el('summary', {}, `All 3D models in this file (${models.length})`));
    det.appendChild(list);
    card.appendChild(det);
  }

  await show(current.length ? current[current.length - 1] : models[models.length - 1]);
}
