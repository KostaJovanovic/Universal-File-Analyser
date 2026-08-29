/* Analyser - IFC / BIM models (.ifc, .ifczip)

   An IFC file is a building described as a graph of objects. It is written in
   STEP syntax (ISO 10303-21): one numbered instance per line, each naming its
   type and listing arguments that are literals or references to other lines.

     #42= IFCWALLSTANDARDCASE('3nW$k…',#5,'Basic Wall:Interior',$,$,#900,#1200,$);

   Nothing about that is hierarchical. The building's structure lives in
   RELATIONSHIP objects that point at both ends - IfcRelAggregates says a site
   contains a building, IfcRelContainedInSpatialStructure says a storey contains
   these walls - so the tree has to be assembled by following them. That is the
   first half of this module.

   The second half is geometry, and it is where an IFC viewer normally becomes a
   large project. Every product carries a shape representation, and the shapes
   range from "a rectangle pushed up by 3 metres" to CSG trees of half-space
   intersections. Three kinds are drawn here, which between them cover most of a
   real model:

     - extruded area solids: a 2D profile swept along a direction, which is what
       a wall, a column and a slab almost always are;
     - explicit meshes (faceted B-reps and the newer tessellated face sets),
       which is what an imported or exported-for-viewing model is made of;
     - mapped items, the mechanism a type definition uses to place one shared
       shape at many locations - without which every window and door vanishes.

   Boolean results (a wall with an opening cut through it) are counted and named
   rather than evaluated: doing that properly means a CSG kernel, and drawing the
   first operand unclipped would quietly show a wall with no window in it. */

import { el, row, rowHelp, h3help, errorCard, fmtBytes } from '../core/util.js';
import { buildGeoFromIndexed, buildViewerCard, startViewer } from './stl.js';
import { IFC_MAX, IFC_ENTITY_MAX, IFC_TRI_MAX } from '../core/limits.js';

type Val = any;
interface Entity { type: string; args: Val[]; }

const isRef = (v: Val): v is { r: number } => !!v && typeof v === 'object' && typeof v.r === 'number';
const num = (v: Val, dflt = 0) => (typeof v === 'number' ? v : (v && typeof v.v === 'number' ? v.v : dflt));
const str = (v: Val) => (typeof v === 'string' ? v : '');

/* ---- the STEP parser ----

   Hand-written because the grammar is small and the file is large: a tokeniser
   that allocates an object per token would spend most of its time in the garbage
   collector on a 200 MB model. This walks the string with an index and builds
   only the values it keeps. */
export function parseStep(text: string) {
  const entities = new Map<number, Entity>();
  const header: Entity[] = [];
  let i = 0;
  const n = text.length;
  let truncated = false;

  // A quoted string ends at a lone apostrophe; a doubled '' is an escaped one.
  // IFC also encodes non-ASCII as \X2\XXXX\X0\, decoded here because names and
  // descriptions in a European model are full of it.
  const readString = () => {
    let out = '';
    i++;                                        // opening quote
    while (i < n) {
      const c = text[i];
      if (c === "'") {
        if (text[i + 1] === "'") { out += "'"; i += 2; continue; }
        i++; break;
      }
      out += c; i++;
    }
    return out.replace(/\\X2\\([0-9A-Fa-f]+)\\X0\\/g, (_m, hex: string) =>
      (hex.match(/.{4}/g) || []).map((h: string) => String.fromCharCode(parseInt(h, 16))).join(''))
      .replace(/\\X\\([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\S\\(.)/g, (_m, c: string) => String.fromCharCode(c.charCodeAt(0) + 128));
  };

  const skipWs = () => { while (i < n && text.charCodeAt(i) <= 32) i++; };

  // One argument list, from the '(' to its matching ')'.
  const readList = (): Val[] => {
    const out: Val[] = [];
    i++;                                        // '('
    for (;;) {
      skipWs();
      if (i >= n) break;
      const c = text[i];
      if (c === ')') { i++; break; }
      if (c === ',') { i++; continue; }
      out.push(readValue());
    }
    return out;
  };

  const readValue = (): Val => {
    skipWs();
    const c = text[i];
    if (c === "'") return readString();
    if (c === '(') return readList();
    if (c === '#') {
      i++;
      const start = i;
      while (i < n && text.charCodeAt(i) >= 48 && text.charCodeAt(i) <= 57) i++;
      return { r: parseInt(text.slice(start, i), 10) };
    }
    if (c === '$') { i++; return null; }
    if (c === '*') { i++; return { derived: true }; }
    if (c === '.') {
      const end = text.indexOf('.', i + 1);
      if (end < 0) { i = n; return null; }
      const e = text.slice(i + 1, end);
      i = end + 1;
      return { e };
    }
    // A number, or a typed value like IFCLENGTHMEASURE(3.5) / IFCBOOLEAN(.T.).
    const start = i;
    while (i < n && !',)'.includes(text[i])) {
      if (text[i] === '(') {                    // typed value - keep the payload
        const t = text.slice(start, i).trim();
        const a = readList();
        return { t, v: typeof a[0] === 'number' ? a[0] : a[0], a };
      }
      i++;
    }
    const raw = text.slice(start, i).trim();
    const f = parseFloat(raw);
    return isFinite(f) && /^[-+.\d]/.test(raw) ? f : raw;
  };

  // Sections. HEADER entries have no id; DATA entries are "#n= TYPE(args);".
  let inData = false;
  while (i < n) {
    skipWs();
    if (i >= n) break;
    if (text.startsWith('DATA;', i)) { inData = true; i += 5; continue; }
    if (text.startsWith('ENDSEC;', i)) { i += 7; continue; }
    if (text.startsWith('HEADER;', i)) { i += 7; continue; }
    if (text.startsWith('ISO-10303-21;', i)) { i += 13; continue; }
    if (text.startsWith('END-ISO-10303-21;', i)) break;

    let id = -1;
    if (text[i] === '#') {
      i++;
      const start = i;
      while (i < n && text.charCodeAt(i) >= 48 && text.charCodeAt(i) <= 57) i++;
      id = parseInt(text.slice(start, i), 10);
      skipWs();
      if (text[i] === '=') i++;
      skipWs();
    }
    const tStart = i;
    while (i < n && text[i] !== '(' && text[i] !== ';') i++;
    if (i >= n) break;
    const type = text.slice(tStart, i).trim().toUpperCase();
    if (text[i] !== '(') { i++; continue; }
    const args = readList();
    skipWs();
    if (text[i] === ';') i++;
    if (!type) continue;
    if (id >= 0) {
      if (entities.size >= IFC_ENTITY_MAX) { truncated = true; break; }
      entities.set(id, { type, args });
    } else if (!inData) {
      header.push({ type, args });
    }
  }
  return { entities, header, truncated };
}

/* ---- transforms ----

   IfcLocalPlacement is a chain: an object is placed relative to its storey,
   which is placed relative to the building, and so on up to the site. Each link
   is an IfcAxis2Placement3D - an origin, a Z axis and a reference direction -
   which is a rotation and a translation, so composing the chain is a product of
   4x4 matrices. Row-major, stored flat. */
type Mat = Float64Array;
const identity = (): Mat => new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function matMul(a: Mat, b: Mat): Mat {
  const o = new Float64Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c];
    }
  }
  return o;
}
function apply(m: Mat, x: number, y: number, z: number) {
  return [
    m[0] * x + m[1] * y + m[2] * z + m[3],
    m[4] * x + m[5] * y + m[6] * z + m[7],
    m[8] * x + m[9] * y + m[10] * z + m[11],
  ];
}

class Model {
  ents: Map<number, Entity>;
  placementCache = new Map<number, Mat>();
  constructor(ents: Map<number, Entity>) { this.ents = ents; }

  get(v: Val): Entity|null {
    if (!isRef(v)) return null;
    return this.ents.get(v.r) || null;
  }
  point(v: Val): number[] {
    const e = this.get(v);
    if (!e || !Array.isArray(e.args[0])) return [0, 0, 0];
    const c = e.args[0] as number[];
    return [num(c[0]), num(c[1]), num(c[2])];
  }
  dir(v: Val, dflt: number[]): number[] {
    const e = this.get(v);
    if (!e || !Array.isArray(e.args[0])) return dflt.slice();
    const c = e.args[0] as number[];
    return [num(c[0]), num(c[1]), num(c[2])];
  }

  // IfcAxis2Placement2D/3D -> a matrix. The reference direction is made
  // perpendicular to the axis rather than trusted, because a file is allowed to
  // give any direction in the plane and many do.
  axisMatrix(v: Val): Mat {
    const e = this.get(v);
    if (!e) return identity();
    const o = this.point(e.args[0]);
    const is2d = e.type === 'IFCAXIS2PLACEMENT2D';
    const z = is2d ? [0, 0, 1] : this.dir(e.args[1], [0, 0, 1]);
    let x = is2d ? this.dir(e.args[1], [1, 0, 0]) : this.dir(e.args[2], [1, 0, 0]);
    const dot = x[0] * z[0] + x[1] * z[1] + x[2] * z[2];
    x = [x[0] - dot * z[0], x[1] - dot * z[1], x[2] - dot * z[2]];
    let len = Math.hypot(x[0], x[1], x[2]);
    if (len < 1e-9) { x = Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; len = 1; }
    x = [x[0] / len, x[1] / len, x[2] / len];
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    return new Float64Array([
      x[0], y[0], z[0], o[0],
      x[1], y[1], z[1], o[1],
      x[2], y[2], z[2], o[2],
      0, 0, 0, 1,
    ]);
  }

  // The full chain from an IfcLocalPlacement up to the world. Cached: a storey
  // with 5,000 elements would otherwise walk the same three links 5,000 times.
  placement(v: Val): Mat {
    if (!isRef(v)) return identity();
    const hit = this.placementCache.get(v.r);
    if (hit) return hit;
    const e = this.ents.get(v.r);
    if (!e || e.type !== 'IFCLOCALPLACEMENT') return identity();
    const local = this.axisMatrix(e.args[1]);
    const parent = e.args[0] ? this.placement(e.args[0]) : identity();
    const m = matMul(parent, local);
    this.placementCache.set(v.r, m);
    return m;
  }
}

/* ---- profiles and triangulation ---- */

// Ear clipping. A slab or a wall with a recess is a concave polygon, and a
// triangle fan across one of those puts geometry outside the outline.
function triangulate(poly: number[][]): number[][] {
  const n = poly.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];
  const idx = poly.map((_, k) => k);
  // Work in the winding direction that makes "convex" mean what it says.
  let area = 0;
  for (let k = 0; k < n; k++) {
    const a = poly[k], b = poly[(k + 1) % n];
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (area < 0) idx.reverse();

  const tris: number[][] = [];
  let guard = n * n;
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      const a = poly[i0], b = poly[i1], c = poly[i2];
      if (cross(a, b, c) <= 0) continue;                 // reflex, not an ear
      let contains = false;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        const p = poly[j];
        if (cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0) { contains = true; break; }
      }
      if (contains) continue;
      tris.push([i0, i1, i2]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;                                  // degenerate - stop cleanly
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

// A profile as a closed 2D outline. Curves are sampled; a circle at 24 segments
// is smooth enough at building scale and cheap enough for a model with hundreds
// of columns in it.
function profileOutline(m: Model, v: Val): number[][]|null {
  const e = m.get(v);
  if (!e) return null;
  const place = e.args[2] ? m.axisMatrix(e.args[2]) : identity();
  const xf = (x: number, y: number) => { const p = apply(place, x, y, 0); return [p[0], p[1]]; };
  switch (e.type) {
    case 'IFCRECTANGLEPROFILEDEF':
    case 'IFCROUNDEDRECTANGLEPROFILEDEF':
    case 'IFCRECTANGLEHOLLOWPROFILEDEF': {
      const w = num(e.args[3]) / 2, h = num(e.args[4]) / 2;
      return [xf(-w, -h), xf(w, -h), xf(w, h), xf(-w, h)];
    }
    case 'IFCCIRCLEPROFILEDEF':
    case 'IFCCIRCLEHOLLOWPROFILEDEF': {
      const r = num(e.args[3]);
      const out: number[][] = [];
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        out.push(xf(Math.cos(a) * r, Math.sin(a) * r));
      }
      return out;
    }
    case 'IFCARBITRARYCLOSEDPROFILEDEF':
    case 'IFCARBITRARYPROFILEDEFWITHVOIDS': {
      const curve = m.get(e.args[2]);
      if (!curve || curve.type !== 'IFCPOLYLINE' || !Array.isArray(curve.args[0])) return null;
      const pts = (curve.args[0] as Val[]).map((p) => { const c = m.point(p); return [c[0], c[1]]; });
      // A polyline that closes by repeating its first point would give a
      // zero-length edge, which ear clipping treats as degenerate.
      if (pts.length > 2) {
        const a = pts[0], b = pts[pts.length - 1];
        if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) pts.pop();
      }
      return pts.length >= 3 ? pts : null;
    }
    default:
      return null;
  }
}

/* ---- geometry ---- */

interface Mesh { verts: number[]; tris: number[]; }

function pushTri(mesh: Mesh, a: number[], b: number[], c: number[]) {
  const base = mesh.verts.length / 3;
  mesh.verts.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  mesh.tris.push(base, base + 1, base + 2);
}

// A profile swept along a direction: two caps and a quad per outline edge.
function extrude(mesh: Mesh, outline: number[][], depth: number, dirv: number[], m: Mat) {
  const dz = [dirv[0] * depth, dirv[1] * depth, dirv[2] * depth];
  const bottom = outline.map((p) => apply(m, p[0], p[1], 0));
  const top = outline.map((p) => apply(m, p[0] + dz[0], p[1] + dz[1], dz[2]));
  for (const t of triangulate(outline)) {
    pushTri(mesh, bottom[t[0]], bottom[t[2]], bottom[t[1]]);
    pushTri(mesh, top[t[0]], top[t[1]], top[t[2]]);
  }
  for (let k = 0; k < outline.length; k++) {
    const j = (k + 1) % outline.length;
    pushTri(mesh, bottom[k], bottom[j], top[j]);
    pushTri(mesh, bottom[k], top[j], top[k]);
  }
}

interface GeomStats { drawn: number; skipped: Record<string, number>; }

function shapeItem(m: Model, item: Val, world: Mat, mesh: Mesh, stats: GeomStats) {
  if (mesh.tris.length / 3 >= IFC_TRI_MAX) return;
  const e = m.get(item);
  if (!e) return;
  switch (e.type) {
    case 'IFCEXTRUDEDAREASOLID': {
      const outline = profileOutline(m, e.args[0]);
      if (!outline) { stats.skipped['profile'] = (stats.skipped['profile'] || 0) + 1; return; }
      const local = e.args[1] ? m.axisMatrix(e.args[1]) : identity();
      const dir = m.dir(e.args[2], [0, 0, 1]);
      extrude(mesh, outline, num(e.args[3]), dir, matMul(world, local));
      stats.drawn++;
      return;
    }
    case 'IFCFACETEDBREP':
    case 'IFCADVANCEDBREP':
    case 'IFCFACETEDBREPWITHVOIDS': {
      const shell = m.get(e.args[0]);
      if (!shell || !Array.isArray(shell.args[0])) return;
      let any = false;
      for (const faceRef of shell.args[0] as Val[]) {
        const face = m.get(faceRef);
        if (!face || !Array.isArray(face.args[0])) continue;
        const bounds = face.args[0] as Val[];
        for (const boundRef of bounds) {
          const bound = m.get(boundRef);
          if (!bound) continue;
          // IfcFaceBound is the generic bound and IfcFaceOuterBound the outer
          // one, so with several bounds the plain ones are holes and are
          // skipped. With only one it IS the outline, whichever class it uses -
          // and exporters differ on that.
          if (bounds.length > 1 && bound.type === 'IFCFACEBOUND') continue;
          const loop = m.get(bound.args[0]);
          if (!loop || !Array.isArray(loop.args[0])) continue;
          const pts = (loop.args[0] as Val[]).map((p) => { const c = m.point(p); return apply(world, c[0], c[1], c[2]); });
          if (pts.length < 3) continue;
          for (let k = 1; k + 1 < pts.length; k++) pushTri(mesh, pts[0], pts[k], pts[k + 1]);
          any = true;
        }
      }
      if (any) stats.drawn++;
      return;
    }
    case 'IFCPOLYGONALFACESET':
    case 'IFCTRIANGULATEDFACESET': {
      const coordEnt = m.get(e.args[0]);
      if (!coordEnt || !Array.isArray(coordEnt.args[0])) return;
      const coords = (coordEnt.args[0] as Val[]).map((c: Val) => {
        const a = c as number[];
        return apply(world, num(a[0]), num(a[1]), num(a[2]));
      });
      if (e.type === 'IFCTRIANGULATEDFACESET') {
        const ci = e.args[3];
        if (!Array.isArray(ci)) return;
        for (const t of ci as Val[]) {
          const a = t as number[];
          const p0 = coords[num(a[0]) - 1], p1 = coords[num(a[1]) - 1], p2 = coords[num(a[2]) - 1];
          if (p0 && p1 && p2) pushTri(mesh, p0, p1, p2);
        }
      } else {
        const faces = e.args[2];
        if (!Array.isArray(faces)) return;
        for (const fRef of faces as Val[]) {
          const face = m.get(fRef);
          if (!face || !Array.isArray(face.args[0])) continue;
          const pts = (face.args[0] as number[]).map((k) => coords[num(k) - 1]).filter(Boolean);
          for (let k = 1; k + 1 < pts.length; k++) pushTri(mesh, pts[0], pts[k], pts[k + 1]);
        }
      }
      stats.drawn++;
      return;
    }
    case 'IFCMAPPEDITEM': {
      // A type's shape placed at one of its instances. Without this, every
      // window and door in a model drawn from a family library disappears.
      const source = m.get(e.args[0]);
      if (!source) return;
      const origin = source.args[0] ? m.axisMatrix(source.args[0]) : identity();
      const target = m.get(e.args[1]);
      let op = identity();
      if (target && target.args[2]) {
        const loc = m.point(target.args[2]);
        const scale = target.args[3] != null ? num(target.args[3], 1) : 1;
        op = new Float64Array([scale, 0, 0, loc[0], 0, scale, 0, loc[1], 0, 0, scale, loc[2], 0, 0, 0, 1]);
      }
      const rep = m.get(source.args[1]);
      if (!rep || !Array.isArray(rep.args[3])) return;
      const inner = matMul(matMul(world, op), origin);
      for (const it of rep.args[3] as Val[]) shapeItem(m, it, inner, mesh, stats);
      return;
    }
    case 'IFCBOOLEANCLIPPINGRESULT':
    case 'IFCBOOLEANRESULT':
    case 'IFCCSGSOLID':
    case 'IFCHALFSPACESOLID':
      stats.skipped['boolean'] = (stats.skipped['boolean'] || 0) + 1;
      return;
    case 'IFCSWEPTDISKSOLID':
    case 'IFCSURFACECURVESWEPTAREASOLID':
    case 'IFCREVOLVEDAREASOLID':
      stats.skipped['swept'] = (stats.skipped['swept'] || 0) + 1;
      return;
    default:
      stats.skipped[e.type.replace(/^IFC/, '').toLowerCase()] = (stats.skipped[e.type.replace(/^IFC/, '').toLowerCase()] || 0) + 1;
  }
}

/* ---- the spatial tree ---- */

interface Node {
  id: number; type: string; name: string;
  children: Node[];
  elements: { id: number; type: string; name: string }[];
}

const label = (e: Entity) => str(e.args[2]) || '';
const pretty = (t: string) => t.replace(/^IFC/, '').replace(/STANDARDCASE$/, '')
  .replace(/([a-z])([A-Z])/g, '$1 $2');

export async function renderIfc(file: File, resultsEl: HTMLElement) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';

  if (file.size > IFC_MAX) {
    resultsEl.appendChild(errorCard('This IFC is larger than ' + fmtBytes(IFC_MAX) + '. Not opened - the whole model has to be held in memory to follow its references.'));
    return;
  }

  let text = '';
  try { text = await file.text(); }
  catch (e) { resultsEl.appendChild(errorCard('Could not read this file.')); return; }
  if (!/ISO-10303-21/.test(text.slice(0, 4096))) {
    resultsEl.appendChild(errorCard('This does not look like an IFC file - it should begin with ISO-10303-21.'));
    return;
  }

  const { entities, header, truncated } = parseStep(text);
  if (!entities.size) { resultsEl.appendChild(errorCard('No entities found in this IFC file.')); return; }
  const m = new Model(entities);

  // ---- header ----
  const hdr: Record<string, string> = {};
  for (const h of header) {
    if (h.type === 'FILE_SCHEMA' && Array.isArray(h.args[0])) hdr.schema = (h.args[0] as Val[]).map(str).join(', ');
    if (h.type === 'FILE_NAME') {
      hdr.name = str(h.args[0]);
      hdr.timestamp = str(h.args[1]);
      hdr.author = Array.isArray(h.args[2]) ? (h.args[2] as Val[]).map(str).filter(Boolean).join(', ') : '';
      hdr.org = Array.isArray(h.args[3]) ? (h.args[3] as Val[]).map(str).filter(Boolean).join(', ') : '';
      hdr.tool = [str(h.args[4]), str(h.args[5])].filter(Boolean).join(' / ');
    }
    if (h.type === 'FILE_DESCRIPTION' && Array.isArray(h.args[0])) hdr.description = (h.args[0] as Val[]).map(str).filter(Boolean).join('; ');
  }

  // ---- counts, relationships, properties ----
  const counts: Record<string, number> = {};
  const aggregates: Record<number, number[]> = {};      // parent -> children
  const contained: Record<number, number[]> = {};       // storey -> elements
  const propsFor: Record<number, number[]> = {};        // object -> property-set ids
  const materialFor: Record<number, number> = {};
  const typeFor: Record<number, number> = {};
  let project = -1;
  for (const [id, e] of entities) {
    counts[e.type] = (counts[e.type] || 0) + 1;
    if (e.type === 'IFCPROJECT' && project < 0) project = id;
    else if (e.type === 'IFCRELAGGREGATES' || e.type === 'IFCRELNESTS') {
      const parent = isRef(e.args[4]) ? e.args[4].r : -1;
      if (parent >= 0 && Array.isArray(e.args[5])) {
        const list = aggregates[parent] || (aggregates[parent] = []);
        for (const c of e.args[5] as Val[]) if (isRef(c)) list.push(c.r);
      }
    } else if (e.type === 'IFCRELCONTAINEDINSPATIALSTRUCTURE') {
      const structure = isRef(e.args[5]) ? e.args[5].r : -1;
      if (structure >= 0 && Array.isArray(e.args[4])) {
        const list = contained[structure] || (contained[structure] = []);
        for (const c of e.args[4] as Val[]) if (isRef(c)) list.push(c.r);
      }
    } else if (e.type === 'IFCRELDEFINESBYPROPERTIES') {
      const pset = isRef(e.args[5]) ? e.args[5].r : -1;
      if (pset >= 0 && Array.isArray(e.args[4])) {
        for (const o of e.args[4] as Val[]) if (isRef(o)) (propsFor[o.r] || (propsFor[o.r] = [])).push(pset);
      }
    } else if (e.type === 'IFCRELASSOCIATESMATERIAL') {
      const mat = isRef(e.args[5]) ? e.args[5].r : -1;
      if (mat >= 0 && Array.isArray(e.args[4])) for (const o of e.args[4] as Val[]) if (isRef(o)) materialFor[o.r] = mat;
    } else if (e.type === 'IFCRELDEFINESBYTYPE') {
      const t = isRef(e.args[5]) ? e.args[5].r : -1;
      if (t >= 0 && Array.isArray(e.args[4])) for (const o of e.args[4] as Val[]) if (isRef(o)) typeFor[o.r] = t;
    }
  }

  // The length unit, so the dimensions below can be stated in metres rather than
  // in whatever the authoring tool happened to use.
  let unit = '';
  for (const e of entities.values()) {
    if (e.type !== 'IFCSIUNIT') continue;
    if (!e.args[1] || (e.args[1] as any).e !== 'LENGTHUNIT') continue;
    const prefix = e.args[2] && (e.args[2] as any).e;
    const name = e.args[3] && (e.args[3] as any).e;
    unit = (prefix ? String(prefix).toLowerCase() : '') + String(name || 'metre').toLowerCase();
    break;
  }

  // ---- info card ----
  const card = el('div', { class: 'anr-card' });
  const [h, help] = h3help('IFC building model',
    'IFC describes a building as a graph of objects rather than as a drawing: walls, doors and spaces as things with properties, plus separate relationship objects saying what contains what. The tree below is assembled by following those relationships - nothing in the file is stored hierarchically.');
  card.appendChild(h); card.appendChild(help);
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  if (hdr.schema) tbl.appendChild(rowHelp('Schema', hdr.schema,
    'The IFC version the file is written against. IFC2X3 and IFC4 are both common and are not interchangeable - a tool that reads one may refuse the other.'));
  if (hdr.name) tbl.appendChild(row('Model name', hdr.name));
  if (hdr.description) tbl.appendChild(row('View definition', hdr.description));
  if (hdr.tool) tbl.appendChild(rowHelp('Exported by', hdr.tool,
    'The authoring tool and its exporter. It matters: how completely an IFC describes a building depends heavily on which program wrote it.'));
  if (hdr.author) tbl.appendChild(row('Author', hdr.author));
  if (hdr.org) tbl.appendChild(row('Organisation', hdr.org));
  if (hdr.timestamp) tbl.appendChild(row('Saved', hdr.timestamp.replace('T', ' ')));
  if (unit) tbl.appendChild(row('Length unit', unit));
  tbl.appendChild(row('Entities', entities.size.toLocaleString() + (truncated ? ' (stopped here)' : '')));
  tbl.appendChild(row('Distinct types', String(Object.keys(counts).length)));
  card.appendChild(tbl);
  resultsEl.appendChild(card);

  // ---- spatial tree ----
  const SPATIAL = new Set(['IFCPROJECT', 'IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY', 'IFCSPACE', 'IFCSPATIALZONE']);
  const buildNode = (id: number, depth: number): Node|null => {
    const e = entities.get(id);
    if (!e || depth > 12) return null;
    const node: Node = { id, type: e.type, name: label(e), children: [], elements: [] };
    for (const cid of aggregates[id] || []) {
      const ce = entities.get(cid);
      if (!ce) continue;
      if (SPATIAL.has(ce.type)) { const c = buildNode(cid, depth + 1); if (c) node.children.push(c); }
      else node.elements.push({ id: cid, type: ce.type, name: label(ce) });
    }
    for (const cid of contained[id] || []) {
      const ce = entities.get(cid);
      if (ce) node.elements.push({ id: cid, type: ce.type, name: label(ce) });
    }
    return node;
  };
  const rootNode = project >= 0 ? buildNode(project, 0) : null;

  const psetSummary = (objId: number) => {
    const out: string[] = [];
    for (const pid of (propsFor[objId] || []).slice(0, 12)) {
      const p = entities.get(pid);
      if (p) out.push(str(p.args[2]) || pretty(p.type));
    }
    return out;
  };

  const renderTreeNode = (node: Node, depth: number): HTMLElement => {
    const kids = node.children.length + node.elements.length;
    const det = el('details', { class: 'anr-tree-dir' }) as HTMLDetailsElement;
    if (depth <= 2) det.open = true;
    det.appendChild(el('summary', {}, [
      el('span', { class: 'anr-tree-icon' }, '>'),
      el('span', { class: 'anr-tree-name' }, node.name || pretty(node.type)),
      el('span', { class: 'anr-tree-meta' }, pretty(node.type) + '  ' + kids),
    ]));
    const box = el('div', { class: 'anr-tree-children' });
    for (const c of node.children) box.appendChild(renderTreeNode(c, depth + 1));
    // Elements grouped by type: a storey with 900 walls is unreadable as 900
    // rows and perfectly readable as one row saying "Wall - 900".
    const byType: Record<string, { id: number; name: string }[]> = {};
    for (const x of node.elements) (byType[x.type] || (byType[x.type] = [])).push({ id: x.id, name: x.name });
    for (const [type, list] of Object.entries(byType).sort((a, b) => b[1].length - a[1].length)) {
      const group = el('details', { class: 'anr-tree-dir' }) as HTMLDetailsElement;
      group.appendChild(el('summary', {}, [
        el('span', { class: 'anr-tree-icon' }, '>'),
        el('span', { class: 'anr-tree-name' }, pretty(type)),
        el('span', { class: 'anr-tree-meta' }, String(list.length)),
      ]));
      const inner = el('div', { class: 'anr-tree-children' });
      for (const x of list.slice(0, 400)) {
        const psets = psetSummary(x.id);
        inner.appendChild(el('div', { class: 'anr-tree-file', title: psets.length ? 'Property sets: ' + psets.join(', ') : '' }, [
          el('span', { class: 'anr-tree-lead' }, '-'),
          el('span', { class: 'anr-tree-name' }, x.name || '#' + x.id),
          el('span', { class: 'anr-tree-meta' }, psets.length ? psets.length + ' property sets' : ''),
        ]));
      }
      if (list.length > 400) inner.appendChild(el('p', { class: 'anr-hint' }, 'and ' + (list.length - 400).toLocaleString() + ' more'));
      group.appendChild(inner);
      box.appendChild(group);
    }
    det.appendChild(box);
    return det;
  };

  if (rootNode) {
    const c = el('div', { class: 'anr-card' });
    const [th, thelp] = h3help('Spatial structure',
      'Project, site, building, storey, then the elements each storey contains - the containment hierarchy every IFC is organised around. Elements are grouped by type, since a storey holds hundreds of walls and one row per wall would tell you nothing. Hover an element to see which property sets are attached to it.');
    c.appendChild(th); c.appendChild(thelp);
    const tree = el('div', { class: 'anr-tree' });
    tree.appendChild(renderTreeNode(rootNode, 0));
    c.appendChild(tree);
    resultsEl.appendChild(c);
  }

  // ---- geometry ----
  const mesh: Mesh = { verts: [], tris: [] };
  const stats: GeomStats = { drawn: 0, skipped: {} };
  let products = 0;
  try {
    for (const e of entities.values()) {
      if (mesh.tris.length / 3 >= IFC_TRI_MAX) break;
      // Products carry placement at 5 and representation at 6. Openings and
      // spaces are skipped: an opening is a hole rather than a thing, and a
      // space is an invisible volume that would enclose everything else.
      if (!/^IFC(WALL|SLAB|BEAM|COLUMN|DOOR|WINDOW|ROOF|STAIR|RAILING|COVERING|FURNITURE|PLATE|MEMBER|PILE|FOOTING|CURTAINWALL|FLOWTERMINAL|FLOWSEGMENT|FLOWFITTING|BUILDINGELEMENTPROXY|DISCRETEACCESSORY|MECHANICALFASTENER|CHIMNEY|SHADINGDEVICE|RAMP)/.test(e.type)) continue;
      const rep = m.get(e.args[6]);
      if (!rep || !Array.isArray(rep.args[2])) continue;
      products++;
      const world = m.placement(e.args[5]);
      for (const rRef of rep.args[2] as Val[]) {
        const r = m.get(rRef);
        if (!r || !Array.isArray(r.args[3])) continue;
        // 'Body' is the solid geometry; 'Axis', 'Box' and 'FootPrint' are
        // simplified stand-ins that would draw a wall as a single line.
        const kind = str(r.args[1]);
        if (kind && kind !== 'Body') continue;
        for (const item of r.args[3] as Val[]) shapeItem(m, item, world, mesh, stats);
      }
    }
  } catch (_) { /* draw whatever was built */ }

  if (mesh.tris.length >= 3) {
    const geo = buildGeoFromIndexed(mesh.verts, mesh.tris, 'IFC');
    const { viewCard, viewer } = buildViewerCard(geo, 'Model', { upZ: true });
    const note = el('p', { class: 'anr-hint' },
      stats.drawn.toLocaleString() + ' shapes drawn from ' + products.toLocaleString() + ' elements.' +
      (Object.keys(stats.skipped).length
        ? ' Not drawn: ' + Object.entries(stats.skipped).sort((a, b) => b[1] - a[1]).slice(0, 5)
            .map(([k, v]) => v.toLocaleString() + ' ' + k).join(', ') +
          '. Boolean results - a wall with a window cut out of it - need a solid-modelling kernel to evaluate, and drawing the uncut shape instead would show you a wall with no window in it.'
        : ''));
    viewCard.appendChild(note);
    resultsEl.appendChild(viewCard);
    startViewer(viewer);
  } else {
    const c = el('div', { class: 'anr-card' });
    const [gh, ghelp] = h3help('Geometry',
      'Three kinds of shape are drawn: profiles extruded along a direction (which is what most walls, columns and slabs are), explicit meshes, and the mapped items that place a type\'s shape at each of its instances.');
    c.appendChild(gh); c.appendChild(ghelp);
    c.appendChild(el('p', { class: 'anr-hint' }, products
      ? 'This model\'s ' + products.toLocaleString() + ' elements are built from shapes that need a solid-modelling kernel to evaluate - boolean cuts and swept surfaces - so there is nothing here that can be drawn honestly. The structure and properties above are complete.'
      : 'No product geometry found. This may be a model carrying only spatial structure and properties, which is a normal way to exchange a schedule or a quantity take-off.'));
    resultsEl.appendChild(c);
  }

  // ---- entity breakdown ----
  {
    const c = el('div', { class: 'anr-card' });
    const [eh, ehelp] = h3help('Entity types (' + Object.keys(counts).length + ')',
      'Every kind of object in the file and how many of each. Most of the count is infrastructure - points, directions and placements outnumber walls by a wide margin in any IFC.');
    c.appendChild(eh); c.appendChild(ehelp);
    const t = el('table', { class: 'anr-readout' });
    t.appendChild(el('tr', {}, [el('th', {}, 'Type'), el('th', {}, 'Count')]));
    for (const [type, n] of Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 120)) {
      t.appendChild(el('tr', {}, [el('td', {}, pretty(type)), el('td', {}, n.toLocaleString())]));
    }
    c.appendChild(el('div', { class: 'anr-table-wrap' }, [t]));
    resultsEl.appendChild(c);
  }

  // ---- property sets ----
  const psetNames: Record<string, number> = {};
  for (const [, e] of entities) {
    if (e.type === 'IFCPROPERTYSET' || e.type === 'IFCELEMENTQUANTITY') {
      const nm = str(e.args[2]) || '(unnamed)';
      psetNames[nm] = (psetNames[nm] || 0) + 1;
    }
  }
  if (Object.keys(psetNames).length) {
    const c = el('div', { class: 'anr-card' });
    const [ph, phelp] = h3help('Property sets (' + Object.keys(psetNames).length + ')',
      'Properties are attached to objects in named groups rather than stored on the object itself. The Pset_ prefixed ones are defined by the IFC standard; anything else is the authoring tool\'s or the project\'s own, and is where a model\'s real information usually lives.');
    c.appendChild(ph); c.appendChild(phelp);
    const t = el('table', { class: 'anr-readout' });
    t.appendChild(el('tr', {}, [el('th', {}, 'Property set'), el('th', {}, 'Attached to')]));
    for (const [nm, n] of Object.entries(psetNames).sort((a, b) => b[1] - a[1]).slice(0, 120)) {
      t.appendChild(el('tr', {}, [el('td', {}, nm), el('td', {}, n.toLocaleString() + ' objects')]));
    }
    c.appendChild(el('div', { class: 'anr-table-wrap' }, [t]));
    resultsEl.appendChild(c);
  }
}
