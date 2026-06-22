/* Analyser - Altium Designer viewer (schematic + PCB + libraries)
   ============================================================================
   Altium's native documents - .SchDoc / .SchLib (schematics) and
   .PcbDoc / .PcbLib (boards + footprints) - are OLE2 Compound Files (the same
   container as legacy Office), so we open them with the shared cfbf.js reader
   and parse the streams entirely in the browser. Nothing is uploaded.

   Two payload shapes live inside:
     - Schematics store primitives as ASCII length-prefixed records in the
       `FileHeader` stream: `|RECORD=2|Location.X=360|...` (pin, wire, rect,
       label, ...). Coordinates are integers in the sheet's own grid units.
     - Boards/footprints store primitives as BINARY length-prefixed records in
       per-type streams (`Tracks6`, `Pads6`, ...) or, for a footprint, one
       `<name>/Data` stream that prefixes each record with a 1-byte object type.
       Coordinates are int32 in 1/10000 mil; the object Y axis points up.

   The geometry is rebuilt into an interactive SVG with pan / zoom / fit and,
   for boards, per-layer visibility toggles. The binary field offsets were
   reverse-engineered and validated against a real SamacSys footprint:
     Track (4): layer@0  x1@13 y1@17 x2@21 y2@25  width@29
     Arc   (1): layer@0  cx@13 cy@17 radius@21  startAngle@25(f64) endAngle@33(f64) width@41
     Pad   (2): pascal-name block + main block (layer@0 x@13 y@17 sizeX@21 sizeY@25 hole@45 shape@49 rot@52(f64))
*/

import { el, row, rowHelp, h3help, fmtBytes, sha256Row, errorCard } from '../core/util.js';
import { openCfbf } from '../lib/cfbf.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs) => {
  const n = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};

// Altium colours are packed BGR integers (R = low byte). Returns a CSS string.
function bgr(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return null;
  const r = n & 0xFF, g = (n >> 8) & 0xFF, b = (n >> 16) & 0xFF;
  return `rgb(${r},${g},${b})`;
}

// Standard Altium layer identities for the layer ids we render. Anything not
// listed degrades to a neutral teal "Layer N" so unusual stacks still draw.
const LAYER_INFO = {
  1:  { name: 'Top Layer',       color: '#c81410' },
  32: { name: 'Bottom Layer',    color: '#1538c8' },
  33: { name: 'Top Overlay',     color: '#7a6a00' },
  34: { name: 'Bottom Overlay',  color: '#9a5000' },
  35: { name: 'Top Paste',       color: '#56565c' },
  36: { name: 'Bottom Paste',    color: '#37373c' },
  37: { name: 'Top Solder',      color: '#8a1ab0' },
  38: { name: 'Bottom Solder',   color: '#5a1a80' },
  74: { name: 'Multi-Layer',     color: '#1f6a1f' },
};
// Mechanical layers (assembly / courtyard / dimension) cluster in the 57-88
// range depending on Altium version; give them distinct hues by id.
const MECH_COLORS = ['#0a8a8a', '#9a0a9a', '#3a8a0a', '#955f10', '#0a6498', '#9a0a4a'];
function layerInfo(n) {
  if (LAYER_INFO[n]) return LAYER_INFO[n];
  if (n >= 56 && n <= 88) return { name: 'Mechanical ' + (n - 56), color: MECH_COLORS[(n - 56) % MECH_COLORS.length] };
  return { name: 'Layer ' + n, color: '#2a5a44' };
}

// ---- record parsing -------------------------------------------------------

// Walk a stream of [u32 length][payload] records. Returns the raw payload
// Uint8Arrays (used for both ASCII schematic records and binary PCB streams).
function walkRecords(bytes) {
  const out = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 0;
  let guard = 0;
  while (off + 4 <= bytes.length && guard++ < 200000) {
    const ln = dv.getUint32(off, true) >>> 0;
    if (ln === 0) { off += 4; continue; }
    if (off + 4 + ln > bytes.length) break;
    out.push(bytes.subarray(off + 4, off + 4 + ln));
    off += 4 + ln;
  }
  return out;
}

const dec = new TextDecoder('latin1');
// Parse an ASCII `|KEY=VALUE|KEY=VALUE` record into a case-insensitive map.
function parseFields(bytes) {
  const txt = dec.decode(bytes).replace(/\0+$/, '');
  const f = {};
  for (const kv of txt.split('|')) {
    const i = kv.indexOf('=');
    if (i > 0) f[kv.slice(0, i).toUpperCase()] = kv.slice(i + 1);
  }
  return f;
}
const num = (f, k, d = 0) => { const v = parseFloat(f[k]); return Number.isFinite(v) ? v : d; };
// Altium escapes a few XML entities in description text.
const unesc = (s) => (s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// ---- schematic ------------------------------------------------------------

// Walk the schematic FileHeader stream yielding { fields, ord } for every framed
// record, counting from 0 at the header. Altium's OwnerIndex (on designators and
// parameters) is this ordinal minus one - the header is excluded from that index
// space - so a record owns the component at ord === OwnerIndex + 1. We must NOT
// skip zero-length records here, or the ordinals would drift out of step.
function schRecords(head) {
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const out = [];
  let off = 0, ord = 0, guard = 0;
  while (off + 4 <= head.length && guard++ < 200000) {
    const ln = dv.getUint32(off, true) >>> 0;
    if (off + 4 + ln > head.length) break;
    out.push({ f: parseFields(head.subarray(off + 4, off + 4 + ln)), ord });
    off += 4 + ln; ord++;
  }
  return out;
}

function parseSchematic(reader) {
  const head = reader.readStream('FileHeader');
  if (!head) return null;
  const records = schRecords(head);
  const objs = [];            // drawable {kind,...}
  const parts = [];           // component summary rows
  let header = null;
  const params = [];          // sheet-level (document) parameters
  const compByOwner = new Map();   // OwnerIndex value -> component

  for (const { f, ord } of records) {
    const r = f.RECORD;
    if (!r && f.HEADER) { header = f; continue; }
    const x = num(f, 'LOCATION.X'), y = num(f, 'LOCATION.Y');
    switch (r) {
      case '1': { // component
        const c = {
          designator: null,
          libref: f.LIBREFERENCE || f.DESIGNITEMID || '',
          desc: unesc(f.COMPONENTDESCRIPTION || ''),
          x, y, params: [],
        };
        parts.push(c);
        compByOwner.set(ord - 1, c);   // designators/params reference ord-1
        break;
      }
      case '2': { // pin
        const len = num(f, 'PINLENGTH');
        const cong = num(f, 'PINCONGLOMERATE');
        const rot = cong & 3;                              // 0 R, 1 U, 2 L, 3 D
        const dx = [1, 0, -1, 0][rot], dy = [0, 1, 0, -1][rot];
        objs.push({ kind: 'pin', x, y, x2: x + dx * len, y2: y + dy * len,
          name: f.NAME || '', desig: f.DESIGNATOR || '' });
        break;
      }
      case '14': // rectangle
        objs.push({ kind: 'rect', x1: x, y1: y, x2: num(f, 'CORNER.X'), y2: num(f, 'CORNER.Y'),
          stroke: bgr(f.COLOR), fill: f.ISSOLID === 'T' ? bgr(f.AREACOLOR) : null });
        break;
      case '13': case '6': { // line / polyline
        const pts = [];
        const n = num(f, 'LOCATIONCOUNT', 0) || 2;
        for (let i = 1; i <= n; i++) {
          const px = f['LOCATION.X' + i], py = f['LOCATION.Y' + i];
          if (px != null) pts.push([parseFloat(px), parseFloat(py)]);
        }
        if (!pts.length) pts.push([x, y], [num(f, 'CORNER.X'), num(f, 'CORNER.Y')]);
        objs.push({ kind: 'poly', pts, stroke: bgr(f.COLOR) || '#1a6a5a' });
        break;
      }
      case '27': { // wire
        const pts = [];
        const n = num(f, 'LOCATIONCOUNT', 0);
        for (let i = 1; i <= n; i++) {
          const px = f['LOCATION.X' + i], py = f['LOCATION.Y' + i];
          if (px != null) pts.push([parseFloat(px), parseFloat(py)]);
        }
        if (pts.length >= 2) objs.push({ kind: 'wire', pts, stroke: bgr(f.COLOR) || '#10559a' });
        break;
      }
      case '4': case '25': case '34': case '17': { // label / net label / designator / power port
        if (f.TEXT) objs.push({ kind: 'text', x, y, text: f.TEXT, fill: bgr(f.COLOR) || '#20283a', power: r === '17' });
        if (r === '34') {
          // Attach the designator to its owning component (by OwnerIndex), falling
          // back to the most recent component for unusual ordering.
          const owner = compByOwner.get(num(f, 'OWNERINDEX', NaN)) || (parts.length ? parts[parts.length - 1] : null);
          if (owner && f.TEXT) { owner.designator = f.TEXT; owner.dx = x; owner.dy = y; }
        }
        break;
      }
      case '41': { // parameter (mfr / mpn / datasheet / mouser / sheet field)
        if (!f.NAME || !f.TEXT || f.TEXT === '*') break;
        const owner = f.OWNERINDEX != null ? compByOwner.get(num(f, 'OWNERINDEX', NaN)) : null;
        if (owner) owner.params.push({ name: f.NAME, value: unesc(f.TEXT) });
        else if (f.ISHIDDEN !== 'T') params.push({ name: f.NAME, value: unesc(f.TEXT) });   // document-level field
        break;
      }
      case '209': // text frame (notes)
        objs.push({ kind: 'rect', x1: x, y1: y, x2: num(f, 'CORNER.X'), y2: num(f, 'CORNER.Y'),
          stroke: f.SHOWBORDER === 'T' ? bgr(f.AREACOLOR) : null, fill: f.ISSOLID === 'T' ? bgr(f.AREACOLOR) : null });
        if (f.TEXT) objs.push({ kind: 'text', x: x + 5, y: num(f, 'CORNER.Y') - 8, text: f.TEXT, fill: bgr(f.TEXTCOLOR) || '#20283a' });
        break;
    }
  }
  return { header, objs, parts, params };
}

// ---- PCB / footprint binary primitives ------------------------------------

function readPrimitive(view, bytes, payOff, payLen, layerOverride) {
  // payOff/payLen describe the record's payload (after type+len framing).
  const i32 = (o) => view.getInt32(payOff + o, true);
  const f64 = (o) => view.getFloat64(payOff + o, true);
  const layer = layerOverride != null ? layerOverride : bytes[payOff];
  return { layer, i32, f64, payLen };
}

// Parse a footprint `<name>/Data` stream: each record is [u8 type][u32 len][payload].
// Pads (type 2) are several consecutive [u32 len][block]s; the largest block holds
// the geometry. Returns { prims, layers }.
function parseFootprintData(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const prims = [];
  const layers = new Set();
  // skip the leading [u32 len][pascal name] header
  let off = 0;
  if (bytes.length >= 4) off = 4 + (dv.getUint32(0, true) >>> 0);
  let guard = 0;
  while (off < bytes.length && guard++ < 100000) {
    const type = bytes[off];
    if (off + 5 > bytes.length) break;
    if (type === 2) {                       // pad - multi-block
      let o = off + 1;
      const blocks = [];
      for (let b = 0; b < 6 && o + 4 <= bytes.length; b++) {
        const ln = dv.getUint32(o, true) >>> 0;
        if (ln > 4000) break;
        blocks.push([o + 4, ln]);
        o += 4 + ln;
      }
      if (!blocks.length) { off++; continue; }
      const nameBlk = blocks[0];
      let name = '';
      if (nameBlk[1] >= 1) {
        const sl = bytes[nameBlk[0]];
        name = dec.decode(bytes.subarray(nameBlk[0] + 1, nameBlk[0] + 1 + sl));
      }
      let main = blocks[0];
      for (const bk of blocks) if (bk[1] > main[1]) main = bk;
      const mo = main[0];
      const i32 = (k) => dv.getInt32(mo + k, true);
      const layer = bytes[mo];
      layers.add(layer);
      prims.push({ kind: 'pad', layer, name,
        x: i32(13) / 1e4, y: i32(17) / 1e4, sx: i32(21) / 1e4, sy: i32(25) / 1e4,
        hole: i32(45) / 1e4, shape: bytes[mo + 49], rot: dv.getFloat64(mo + 52, true) });
      off = o;
      continue;
    }
    const ln = dv.getUint32(off + 1, true) >>> 0;
    if (ln === 0 || off + 5 + ln > bytes.length) { off += 5; if (ln > bytes.length) break; continue; }
    const p = off + 5;
    const i32 = (k) => dv.getInt32(p + k, true);
    const layer = bytes[p];
    if (type === 4) {                       // track
      layers.add(layer);
      prims.push({ kind: 'line', layer, x1: i32(13) / 1e4, y1: i32(17) / 1e4,
        x2: i32(21) / 1e4, y2: i32(25) / 1e4, w: i32(29) / 1e4 });
    } else if (type === 1) {                // arc
      layers.add(layer);
      prims.push({ kind: 'arc', layer, cx: i32(13) / 1e4, cy: i32(17) / 1e4,
        r: i32(21) / 1e4, a1: dv.getFloat64(p + 25, true), a2: dv.getFloat64(p + 33, true), w: i32(41) / 1e4 });
    } else if (type === 6) {                // fill (rectangle)
      layers.add(layer);
      prims.push({ kind: 'frect', layer, x1: i32(13) / 1e4, y1: i32(17) / 1e4, x2: i32(21) / 1e4, y2: i32(25) / 1e4 });
    }
    off += 5 + ln;
  }
  return { prims, layers };
}

// Parse a PcbDoc per-type binary stream (Tracks6/Arcs6/Pads6/Fills6 Data).
// These records are [u32 len][payload] with NO leading type byte; `kind` says
// how to read the payload. Empty in unrouted boards.
function parsePcbStream(bytes, kind) {
  if (!bytes || !bytes.length) return [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const prims = [];
  let off = 0, guard = 0;
  while (off + 4 <= bytes.length && guard++ < 200000) {
    const ln = dv.getUint32(off, true) >>> 0;
    if (ln === 0 || off + 4 + ln > bytes.length) break;
    const p = off + 4;
    const i32 = (k) => dv.getInt32(p + k, true);
    const layer = bytes[p];
    if (kind === 'line') prims.push({ kind: 'line', layer, x1: i32(13) / 1e4, y1: i32(17) / 1e4, x2: i32(21) / 1e4, y2: i32(25) / 1e4, w: i32(29) / 1e4 });
    else if (kind === 'arc') prims.push({ kind: 'arc', layer, cx: i32(13) / 1e4, cy: i32(17) / 1e4, r: i32(21) / 1e4, a1: dv.getFloat64(p + 25, true), a2: dv.getFloat64(p + 33, true), w: i32(41) / 1e4 });
    off += 4 + ln;
  }
  return prims;
}

// Board outline + key board fields from Board6/Data (one big ASCII record).
function parseBoard(bytes) {
  if (!bytes) return null;
  const f = parseFields(bytes);
  const outline = [];
  for (let i = 0; i < 200; i++) {
    const vx = f['VX' + i], vy = f['VY' + i];
    if (vx == null || vy == null) break;
    outline.push([parseFloat(vx) / 1e4, parseFloat(vy) / 1e4]);
  }
  const mil = (k) => { const v = parseFloat(f[k]); return Number.isFinite(v) ? v / 1e4 : null; };
  return { outline, originX: mil('ORIGINX'), originY: mil('ORIGINY'), fields: f };
}

// ---- SVG viewer (pan / zoom / fit / layer toggles) ------------------------

// Round to a "nice" 1/2/5 x 10^n step so the grid reads like graph paper
// whatever the document's unit scale (sheet units, mm, or a tiny footprint).
function niceStep(x) {
  if (!(x > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x))), f = x / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}
// Draw a graph-paper grid (minor lines + a heavier line every 5th) behind the
// geometry, emulating the Altium / KiCad sheet. Lines are in document space so
// they pan/zoom with the board, but use non-scaling strokes so they stay 1px.
function addPaperGrid(parent, bbox) {
  const w = bbox.maxx - bbox.minx, h = bbox.maxy - bbox.miny;
  const span = Math.max(w, h);
  if (!(span > 0) || !Number.isFinite(span)) return;
  const step = niceStep(span / 28), pad = step * 2;
  const x0 = Math.floor((bbox.minx - pad) / step) * step, x1 = Math.ceil((bbox.maxx + pad) / step) * step;
  const y0 = Math.floor((bbox.miny - pad) / step) * step, y1 = Math.ceil((bbox.maxy + pad) / step) * step;
  if ((x1 - x0) / step > 2000 || (y1 - y0) / step > 2000) return;   // safety cap
  const g = svg('g', { class: 'anr-eda-grid' });
  const line = (x1_, y1_, x2_, y2_, major) => svg('line', { x1: x1_, y1: y1_, x2: x2_, y2: y2_,
    stroke: major ? 'rgba(36,50,80,0.26)' : 'rgba(36,50,80,0.12)', 'stroke-width': major ? 0.9 : 0.5, 'vector-effect': 'non-scaling-stroke' });
  for (let x = x0, i = Math.round(x0 / step); x <= x1 + 1e-6; x += step, i++) g.appendChild(line(x, y0, x, y1, i % 5 === 0));
  for (let y = y0, i = Math.round(y0 / step); y <= y1 + 1e-6; y += step, i++) g.appendChild(line(x0, y, x1, y, i % 5 === 0));
  parent.insertBefore(g, parent.firstChild);
}

function buildViewer(build, opts = {}) {
  // build(group) populates an SVG <g> and returns the data bbox {minx,miny,maxx,maxy}.
  const wrap = el('div', { class: 'anr-altium-wrap' });
  const s = svg('svg', { class: 'anr-altium-svg' });
  const root = svg('g', {});
  s.appendChild(root);
  wrap.appendChild(s);

  const bbox = build(root);
  addPaperGrid(root, bbox);
  const pad = Math.max((bbox.maxx - bbox.minx), (bbox.maxy - bbox.miny)) * 0.06 + 1;
  const vb = { x: bbox.minx - pad, y: bbox.miny - pad, w: (bbox.maxx - bbox.minx) + pad * 2, h: (bbox.maxy - bbox.miny) + pad * 2 };
  const home = { ...vb };
  const apply = () => s.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  apply();

  // The viewBox preserves aspect ratio (xMidYMid meet), so it is letterboxed
  // inside the element and the screen->document scale is UNIFORM on both axes.
  // Using vb.w/width for x and vb.h/height for y separately (as before) makes the
  // axis with the spare letterbox margin move at the wrong rate - hence panning
  // felt slower on one axis. Map through the single uniform scale + its centring
  // offset instead.
  const screenToUser = (r) => {
    const scale = Math.min(r.width / vb.w, r.height / vb.h);
    return { scale, offX: (r.width - vb.w * scale) / 2, offY: (r.height - vb.h * scale) / 2 };
  };
  // wheel zoom toward the cursor
  s.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = s.getBoundingClientRect();
    const { scale, offX, offY } = screenToUser(r);
    const mx = vb.x + (e.clientX - r.left - offX) / scale;
    const my = vb.y + (e.clientY - r.top - offY) / scale;
    const k = e.deltaY < 0 ? 0.85 : 1 / 0.85;
    vb.x = mx - (mx - vb.x) * k; vb.y = my - (my - vb.y) * k;
    vb.w *= k; vb.h *= k; apply();
  }, { passive: false });
  // drag pan
  let drag = null;
  s.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; s.setPointerCapture(e.pointerId); s.classList.add('is-grabbing'); });
  s.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { scale } = screenToUser(s.getBoundingClientRect());
    vb.x -= (e.clientX - drag.x) / scale;
    vb.y -= (e.clientY - drag.y) / scale;
    drag = { x: e.clientX, y: e.clientY }; apply();
  });
  const end = () => { drag = null; s.classList.remove('is-grabbing'); };
  s.addEventListener('pointerup', end);
  s.addEventListener('pointerleave', end);

  // toolbar
  const bar = el('div', { class: 'anr-altium-bar' });
  const fit = el('button', { class: 'anr-btn', type: 'button' }, 'Fit');
  fit.addEventListener('click', () => { Object.assign(vb, home); apply(); });
  bar.appendChild(fit);

  if (opts.layers && opts.layers.size) {
    const ids = [...opts.layers].sort((a, b) => a - b);
    for (const id of ids) {
      const inf = layerInfo(id);
      const chip = el('button', { class: 'anr-btn anr-altium-layer is-on', type: 'button', title: inf.name });
      chip.appendChild(el('span', { class: 'anr-altium-swatch', style: `background:${inf.color}` }));
      chip.appendChild(document.createTextNode(inf.name));
      chip.addEventListener('click', () => {
        const on = chip.classList.toggle('is-on');
        root.querySelectorAll(`[data-layer="${id}"]`).forEach((n) => { n.style.display = on ? '' : 'none'; });
      });
      bar.appendChild(chip);
    }
  }
  // Programmatic pan/zoom (used by the project view's cross-probe): centre the
  // viewBox on a data-space point, optionally tightening to a target width.
  function centerOn(cx, cy, w) {
    if (w && w > 0) { const aspect = vb.h / vb.w; vb.w = w; vb.h = w * aspect; }
    vb.x = cx - vb.w / 2; vb.y = cy - vb.h / 2; apply();
  }
  // Drop a short-lived "ping" ring at a data-space point to draw the eye there.
  let flashNode = null, flashTimer = null;
  function flash(cx, cy) {
    if (flashNode) flashNode.remove();
    const span = Math.max(vb.w, vb.h);
    flashNode = svg('circle', { class: 'anr-altium-ping', cx, cy, r: span * 0.05,
      fill: 'none', stroke: '#e8480a', 'stroke-width': span * 0.014 });
    root.appendChild(flashNode);
    if (flashTimer) clearTimeout(flashTimer);
    const node = flashNode;
    flashTimer = setTimeout(() => { if (node) node.remove(); if (flashNode === node) flashNode = null; }, 1500);
  }

  wrap.appendChild(bar);
  return { wrap, centerOn, flash, home: { ...home } };
}

function fitBox() { return { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity }; }
function grow(b, x, y) { if (x < b.minx) b.minx = x; if (y < b.miny) b.miny = y; if (x > b.maxx) b.maxx = x; if (y > b.maxy) b.maxy = y; }
function safeBox(b) { if (!Number.isFinite(b.minx)) return { minx: -100, miny: -100, maxx: 100, maxy: 100 }; if (b.minx === b.maxx) { b.minx -= 50; b.maxx += 50; } if (b.miny === b.maxy) { b.miny -= 50; b.maxy += 50; } return b; }

// Render a schematic (Y flipped so the sheet reads the right way up).
function schView(parsed) {
  const v = buildViewer((g) => {
    const b = fitBox();
    const Y = (v) => -v;
    for (const o of parsed.objs) {
      if (o.kind === 'rect') {
        const x = Math.min(o.x1, o.x2), y = Math.min(o.y1, o.y2), w = Math.abs(o.x2 - o.x1), h = Math.abs(o.y2 - o.y1);
        const r = svg('rect', { x, y: Y(y + h), width: w, height: h, fill: o.fill || 'none', stroke: o.stroke || 'none', 'stroke-width': 1 });
        g.appendChild(r); grow(b, x, Y(y)); grow(b, x + w, Y(y + h));
      } else if (o.kind === 'pin') {
        g.appendChild(svg('line', { x1: o.x, y1: Y(o.y), x2: o.x2, y2: Y(o.y2), stroke: '#0a5a8a', 'stroke-width': 1.4 }));
        g.appendChild(svg('circle', { cx: o.x, cy: Y(o.y), r: 1.6, fill: '#0a5a8a' }));
        if (o.desig) { const t = svg('text', { x: o.x2, y: Y(o.y2) - 1, 'font-size': 6, fill: '#0a5a8a' }); t.textContent = o.desig; g.appendChild(t); }
        grow(b, o.x, Y(o.y)); grow(b, o.x2, Y(o.y2));
      } else if (o.kind === 'wire' || o.kind === 'poly') {
        const pts = o.pts.map(([x, y]) => `${x},${Y(y)}`).join(' ');
        g.appendChild(svg('polyline', { points: pts, fill: 'none', stroke: o.stroke, 'stroke-width': o.kind === 'wire' ? 1.6 : 1 }));
        for (const [x, y] of o.pts) grow(b, x, Y(y));
      } else if (o.kind === 'text') {
        const t = svg('text', { x: o.x, y: Y(o.y), 'font-size': o.power ? 7 : 8, fill: o.fill, 'font-weight': o.power ? 700 : 400 });
        t.textContent = o.text; g.appendChild(t); grow(b, o.x, Y(o.y)); grow(b, o.x + o.text.length * 4, Y(o.y) - 8);
      }
    }
    return safeBox(b);
  });

  // Map each designator to its component location (SVG space) so the project
  // view can pan/flash straight to a part when its BOM row is clicked.
  const at = new Map();
  for (const p of parsed.parts || []) {
    if (!p.designator) continue;
    const x = p.x || p.dx || 0, y = p.y || p.dy || 0;
    at.set(String(p.designator).toUpperCase(), { x, y: -y });
  }
  v.focus = (desig) => {
    const c = at.get(String(desig).toUpperCase());
    if (!c) return false;
    v.centerOn(c.x, c.y, Math.max(v.home.w * 0.3, 160));
    v.flash(c.x, c.y);
    return true;
  };
  return v;
}

// Render PCB / footprint primitives with per-layer colouring + toggles.
function pcbView(prims, layers, outline) {
  return buildViewer((g) => {
    const b = fitBox();
    const Y = (v) => -v;
    if (outline && outline.length >= 2) {
      const pts = outline.map(([x, y]) => `${x},${Y(y)}`).join(' ');
      g.appendChild(svg('polygon', { points: pts, fill: 'rgba(40,120,80,0.05)', stroke: '#1f6a3a', 'stroke-width': 2, 'data-layer': 'outline' }));
      for (const [x, y] of outline) grow(b, x, Y(y));
    }
    for (const p of prims) {
      const inf = layerInfo(p.layer);
      const col = inf.color;
      let n = null;
      if (p.kind === 'line') {
        n = svg('line', { x1: p.x1, y1: Y(p.y1), x2: p.x2, y2: Y(p.y2), stroke: col, 'stroke-width': Math.max(p.w, 0.5), 'stroke-linecap': 'round' });
        grow(b, p.x1, Y(p.y1)); grow(b, p.x2, Y(p.y2));
      } else if (p.kind === 'arc') {
        n = arcPath(p, Y, col); grow(b, p.cx - p.r, Y(p.cy) - p.r); grow(b, p.cx + p.r, Y(p.cy) + p.r);
      } else if (p.kind === 'pad') {
        const x = p.x - p.sx / 2, y = p.y - p.sy / 2;
        if (p.shape === 1) n = svg('ellipse', { cx: p.x, cy: Y(p.y), rx: p.sx / 2, ry: p.sy / 2, fill: col });
        else n = svg('rect', { x, y: Y(y + p.sy), width: p.sx, height: p.sy, rx: p.shape === 3 ? Math.min(p.sx, p.sy) * 0.25 : 0, fill: col });
        if (n && p.hole > 0) { n.setAttribute('fill-opacity', '0.85'); }
        grow(b, x, Y(y)); grow(b, x + p.sx, Y(y + p.sy));
        if (p.hole > 0) {
          const hole = svg('circle', { cx: p.x, cy: Y(p.y), r: p.hole / 2, fill: '#0b0b0f', 'data-layer': p.layer });
          g.appendChild(group1(n, p.layer)); g.appendChild(hole);
          if (p.name) g.appendChild(padLabel(p, Y));
          continue;
        }
      } else if (p.kind === 'frect') {
        const x = Math.min(p.x1, p.x2), y = Math.min(p.y1, p.y2), w = Math.abs(p.x2 - p.x1), h = Math.abs(p.y2 - p.y1);
        n = svg('rect', { x, y: Y(y + h), width: w, height: h, fill: col }); grow(b, x, Y(y)); grow(b, x + w, Y(y + h));
      }
      if (n) { n.setAttribute('data-layer', p.layer); g.appendChild(n); if (p.kind === 'pad' && p.name) g.appendChild(padLabel(p, Y)); }
    }
    return safeBox(b);
  }, { layers });
}
function group1(n, layer) { n.setAttribute('data-layer', layer); return n; }
function padLabel(p, Y) {
  const t = svg('text', { x: p.x, y: Y(p.y) + Math.min(p.sx, p.sy) * 0.18, 'font-size': Math.min(p.sx, p.sy) * 0.5, fill: '#fff', 'text-anchor': 'middle', 'data-layer': p.layer, 'font-weight': 700 });
  t.textContent = p.name; return t;
}
function arcPath(p, Y, col) {
  const a1 = p.a1 * Math.PI / 180, a2 = p.a2 * Math.PI / 180;
  const x1 = p.cx + p.r * Math.cos(a1), y1 = p.cy + p.r * Math.sin(a1);
  const x2 = p.cx + p.r * Math.cos(a2), y2 = p.cy + p.r * Math.sin(a2);
  let sweep = (p.a2 - p.a1); while (sweep < 0) sweep += 360; const large = sweep > 180 ? 1 : 0;
  // Y is flipped, so the sweep flag flips too (1 -> 0).
  const d = `M ${x1} ${Y(y1)} A ${p.r} ${p.r} 0 ${large} 0 ${x2} ${Y(y2)}`;
  return svg('path', { d, fill: 'none', stroke: col, 'stroke-width': Math.max(p.w, 0.5) });
}

// ---- metadata cards -------------------------------------------------------

function metaCard(title, helpText, rows, file, extra) {
  const card = el('div', { class: 'anr-card' });
  const [h, help] = h3help(title, helpText);
  card.appendChild(h); card.appendChild(help);
  const tbl = el('table', { class: 'anr-readout' });
  for (const [k, v] of rows) if (v != null && v !== '') tbl.appendChild(row(k, String(v)));
  tbl.appendChild(sha256Row(file));
  card.appendChild(tbl);
  if (extra) card.appendChild(extra);
  return card;
}

// ---- entry point ----------------------------------------------------------

export async function renderAltium(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading Altium document "${file.name}"…`));

  const ext = (file.name.split('.').pop() || '').toLowerCase();

  // A few Altium sidecars are plain text / cache, not OLE compound files.
  // Handle them before the cfbf open (which would reject them).
  if (ext === 'epw') { await renderEpw(file, resultsEl); return; }
  if (ext === 'prjpcb' || ext === 'prjpcbstructure') { await renderPrjPcb(file, resultsEl); return; }
  if (/preview$/.test(ext)) { await renderPreview(file, resultsEl); return; }

  const reader = await openCfbf(file);
  if (!reader) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('This does not look like a readable Altium (OLE compound) document.'));
    return;
  }
  resultsEl.innerHTML = '';

  try {
    if (ext === 'schdoc' || ext === 'schlib') {
      renderSch(file, reader, resultsEl, ext);
    } else if (ext === 'pcbdoc') {
      renderPcbDoc(file, reader, resultsEl);
    } else if (ext === 'pcblib') {
      renderPcbLib(file, reader, resultsEl);
    } else {
      // sniff by streams present
      if (reader.readStream('FileHeader') && reader.readStream((e) => /Board6\/Data$/i.test(e.path))) renderPcbDoc(file, reader, resultsEl);
      else if (reader.readStream((e) => /Board6\/Data$/i.test(e.path)) || reader.readStream((e) => /\/Data$/.test(e.path))) renderPcbLib(file, reader, resultsEl);
      else renderSch(file, reader, resultsEl, ext);
    }
  } catch (e) {
    resultsEl.appendChild(errorCard('Could not fully parse this Altium document: ' + (e && e.message)));
  }
}

// SamacSys ECAD Model wrapper (.epw) - a small text stub the SamacSys / Mouser
// "ECAD Part Wizard" expands into a real symbol + footprint. The last line is a
// descriptor: <componentId>/<partId>/<version>/<pinCount>/<parts>/<category>.
async function renderEpw(file, resultsEl) {
  resultsEl.innerHTML = '';
  let text = '';
  try { text = await file.text(); } catch (_) {}
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const srcLine = lines.find((l) => /^Source=/i.test(l));
  const source = srcLine ? srcLine.split('=')[1] : '';
  const SRC = { ms: 'Mouser', fa: 'Farnell / element14', di: 'Digi-Key', rs: 'RS Components', ar: 'Arrow' };
  const desc = lines.find((l) => /^\d+\/\d+\//.test(l));
  const parts = desc ? desc.split('/') : [];
  const [compId, partId, ver, pinCount, units, category] = parts;

  resultsEl.appendChild(metaCard('SamacSys ECAD model', 'A SamacSys ECAD Model wrapper (.epw) - the small text stub the SamacSys / Mouser "ECAD Part Wizard" turns into a schematic symbol and PCB footprint. Analyser reads the descriptor it carries.', [
    ['Format', 'SamacSys ECAD model (.epw)'],
    ['File', file.name],
    ['Size', fmtBytes(file.size)],
    ['Component ID', compId || lines[0] || null],
    ['Part ID', partId || null],
    ['Model version', ver || null],
    ['Pins', pinCount || null],
    ['Symbol parts', units || null],
    ['Category', category || null],
    ['Source', source ? (SRC[source.toLowerCase()] || source) : null],
  ], file));

  const note = el('div', { class: 'anr-card' });
  note.appendChild(el('h3', {}, 'About this file'));
  note.appendChild(el('p', {}, 'This .epw holds no geometry itself - it is a reference the ECAD Part Wizard (or Altium Library Loader) downloads the full model from. The matching symbol/footprint, once imported, open here as .SchLib / .PcbLib files.'));
  resultsEl.appendChild(note);

  resultsEl.appendChild(sourceCard(text));
}

// Shared "Source" card showing the raw text of a small text-based Altium file.
function sourceCard(text) {
  const src = el('div', { class: 'anr-card' });
  src.appendChild(el('h3', {}, 'Source'));
  const pre = el('pre', { class: 'anr-pagetext anr-code-src' });
  pre.textContent = text.slice(0, 8000);
  src.appendChild(pre);
  return src;
}

// Parse a .PrjPcb INI into { projName, docs[], version, cfg, outCount }. The
// member documents are [DocumentN] DocumentPath= entries, in project order.
function parsePrj(text, fileName) {
  const docs = [];
  const reDoc = /\[Document\d+\][^[]*?DocumentPath=([^\r\n]+)/gi;
  let m;
  while ((m = reDoc.exec(text))) docs.push(m[1].trim());
  const grab = (k) => { const r = new RegExp('^' + k + '=([^\\r\\n]+)', 'im').exec(text); return r ? r[1].trim() : ''; };
  return {
    projName: (fileName || '').replace(/\.[^.]+$/, ''),
    docs, version: grab('Version'), cfg: grab('DefaultConfiguration'),
    outCount: (text.match(/OutputName=/gi) || []).length,
  };
}

// Altium project file (.PrjPcb) - an INI listing the member documents, the
// configuration and the output-job template. Plain text, not an OLE file.
async function renderPrjPcb(file, resultsEl) {
  resultsEl.innerHTML = '';
  let text = '';
  try { text = await file.text(); } catch (_) {}
  const { projName, docs, version, cfg, outCount } = parsePrj(text, file.name);

  resultsEl.appendChild(metaCard('Altium project', 'An Altium Designer PCB project file (.PrjPcb) - the INI manifest that ties a schematic and board together. Analyser reads its member documents and configuration.', [
    ['Format', 'Altium PcbProject (.PrjPcb)'],
    ['File', file.name],
    ['Size', fmtBytes(file.size)],
    ['Project', projName],
    ['Project format', version ? 'v' + version : null],
    ['Documents', docs.length || null],
    ['Default configuration', cfg || null],
    ['Output jobs', outCount || null],
  ], file));

  // When the project is opened on its own (not from a folder drop), point the
  // user at the combined view that a folder drop unlocks.
  resultsEl.appendChild(el('div', { class: 'anr-info' }, 'Tip: drop the whole project folder (not just this file) to open every schematic, board and library together in one cross-probing project view.'));

  if (docs.length) {
    const card = el('div', { class: 'anr-card' });
    card.appendChild(el('h3', {}, 'Member documents'));
    const tbl = el('table', { class: 'anr-readout' });
    for (const d of docs) {
      const kind = /\.sch/i.test(d) ? 'Schematic' : /\.pcb/i.test(d) ? 'PCB' : 'Document';
      tbl.appendChild(row(kind, d));
    }
    card.appendChild(tbl);
    resultsEl.appendChild(card);
  }
  resultsEl.appendChild(sourceCard(text));
}

// Altium preview cache (.SchDocPreview / .PcbDocPreview) - an INI header naming
// the cached thumbnail sizes, followed by the binary image data. We surface the
// dimensions; the bitmap itself is an internal cache and is not decoded.
async function renderPreview(file, resultsEl) {
  resultsEl.innerHTML = '';
  let head = '';
  try { head = (await file.slice(0, 512).text()); } catch (_) {}
  // The header is `Key=Value` INI lines before the binary image blob. Parse it
  // into a map with one literal regex (no dynamic-escaping pitfalls).
  const ini = {};
  for (const m of head.matchAll(/^([A-Za-z]+)=([^\r\n]+)/gm)) ini[m[1].toLowerCase()] = m[2];
  const g = (k) => (/^\d+$/.test(ini[k.toLowerCase()] || '') ? ini[k.toLowerCase()] : null);
  const lw = g('LargeImageWidth'), lh = g('LargeImageHeight');
  resultsEl.appendChild(metaCard('Altium preview thumbnail', 'An Altium Designer preview-cache file (.SchDocPreview / .PcbDocPreview) - the rendered thumbnail Altium stores beside a document so a browser can show it without opening the source.', [
    ['Format', 'Altium document preview'],
    ['File', file.name],
    ['Size', fmtBytes(file.size)],
    ['Large image', lw && lh ? `${lw} × ${lh}` : null],
    ['Medium image', g('MediumImageWidth') && g('MediumImageHeight') ? `${g('MediumImageWidth')} × ${g('MediumImageHeight')}` : null],
    ['Small image', g('SmallImageWidth') && g('SmallImageHeight') ? `${g('SmallImageWidth')} × ${g('SmallImageHeight')}` : null],
  ], file));
  resultsEl.appendChild(el('div', { class: 'anr-info' }, 'This is an internal thumbnail cache, not a source document - the matching .SchDoc / .PcbDoc opens as a full interactive view.'));
}

function renderSch(file, reader, resultsEl, ext) {
  const lib = ext === 'schlib';
  const parsed = parseSchematic(reader);
  const isLib = lib || !parsed || !parsed.objs.length;
  const ver = (parsed && parsed.header && (parsed.header.HEADER || '')) || '';
  const part = parsed && parsed.parts[0];
  resultsEl.appendChild(metaCard(
    isLib ? 'Altium schematic library' : 'Altium schematic',
    'Altium Designer schematic, stored as an OLE compound document. The drawing primitives are parsed from the FileHeader stream and rebuilt as a vector view in the browser.',
    [
      ['Format', isLib ? 'Altium SchLib (' + (file.name.split('.').pop()) + ')' : 'Altium SchDoc'],
      ['File', file.name],
      ['Size', fmtBytes(file.size)],
      ['Document version', ver.replace(/^.*Version /, 'v') || null],
      ['Components', parsed ? parsed.parts.length : 0],
      ['Primitives', parsed ? parsed.objs.length : 0],
    ], file));

  // part / BOM card
  if (part) {
    const card = el('div', { class: 'anr-card' });
    card.appendChild(el('h3', {}, 'Component'));
    const tbl = el('table', { class: 'anr-readout' });
    tbl.appendChild(row('Designator', part.designator || '(unannotated)'));
    tbl.appendChild(row('Library reference', part.libref));
    if (part.desc) tbl.appendChild(row('Description', part.desc));
    for (const p of (part.params || [])) {
      if (/^https?:/i.test(p.value)) {
        const a = el('a', { href: p.value, target: '_blank', rel: 'noopener' }, p.value.length > 60 ? p.value.slice(0, 57) + '…' : p.value);
        const tr = el('tr', {}, [el('th', {}, p.name), el('td', {}, a)]);
        tbl.appendChild(tr);
      } else tbl.appendChild(row(p.name, p.value));
    }
    card.appendChild(tbl);
    resultsEl.appendChild(card);
  }

  // drawing
  if (parsed && parsed.objs.length) {
    const dcard = el('div', { class: 'anr-card' });
    dcard.appendChild(el('h3', {}, 'Schematic'));
    dcard.appendChild(schView(parsed).wrap);
    resultsEl.appendChild(dcard);
  }
}

// Decode a .PcbLib reader into { prims, layers, pads, fpName }. The footprint
// geometry lives in a top-level `<name>/Data` stream (exactly one path segment
// before Data) - not Library/Data (the library TOC) nor the deeper
// `<name>/UniqueIDPrimitiveInformation/Data` sidecar. Pick the largest.
function parsePcbLibData(reader) {
  let fpName = '', best = -1;
  for (const e of reader.entries) {
    if (e.type !== 2) continue;
    const m = /^([^/]+)\/Data$/.exec(e.path);
    if (!m || /^(Library|FileVersionInfo)$/i.test(m[1])) continue;
    if (e.size > best) { best = e.size; fpName = m[1]; }
  }
  let prims = [], layers = new Set();
  if (fpName) { const db = reader.readStream(fpName + '/Data'); if (db) ({ prims, layers } = parseFootprintData(db)); }
  return { prims, layers, pads: prims.filter((p) => p.kind === 'pad'), fpName };
}

function renderPcbLib(file, reader, resultsEl) {
  const { prims, layers, pads, fpName } = parsePcbLibData(reader);

  resultsEl.appendChild(metaCard('Altium footprint library', 'Altium PCB footprint library (.PcbLib). Pads, tracks and arcs are decoded from the footprint geometry stream and rebuilt to scale.', [
    ['Format', 'Altium PcbLib'],
    ['File', file.name],
    ['Size', fmtBytes(file.size)],
    ['Footprint', fpName],
    ['Pads', pads.length],
    ['Primitives', prims.length],
    ['Layers used', [...layers].map((l) => layerInfo(l).name).join(', ')],
  ], file));

  if (pads.length) {
    const card = el('div', { class: 'anr-card' });
    card.appendChild(el('h3', {}, 'Pads'));
    card.appendChild(padsTable(pads));
    resultsEl.appendChild(card);
  }

  if (prims.length) {
    const dcard = el('div', { class: 'anr-card' });
    dcard.appendChild(el('h3', {}, 'Footprint'));
    dcard.appendChild(pcbView(prims, layers, null).wrap);
    resultsEl.appendChild(dcard);
  } else {
    resultsEl.appendChild(el('div', { class: 'anr-info' }, 'No footprint geometry could be decoded from this library.'));
  }
}

// Shared pad-table builder (used by the library view and the project view).
function padsTable(pads) {
  const tbl = el('table', { class: 'anr-readout anr-altium-pads' });
  tbl.appendChild(el('tr', {}, [el('th', {}, 'Pad'), el('th', {}, 'X (mm)'), el('th', {}, 'Y (mm)'), el('th', {}, 'Size (mm)'), el('th', {}, 'Hole'), el('th', {}, 'Type')]));
  const mm = (mil) => (mil * 0.0254).toFixed(3);
  const shapeName = { 1: 'Round', 2: 'Rect', 3: 'Rounded' };
  for (const p of pads) {
    tbl.appendChild(el('tr', {}, [
      el('td', {}, p.name || '?'),
      el('td', {}, mm(p.x)), el('td', {}, mm(p.y)),
      el('td', {}, `${mm(p.sx)} × ${mm(p.sy)}`),
      el('td', {}, p.hole > 0 ? mm(p.hole) + ' mm' : '–'),
      el('td', {}, (shapeName[p.shape] || '?') + (p.hole > 0 ? ' THT' : ' SMD')),
    ]));
  }
  return tbl;
}

// Decode a .PcbDoc reader into { prims, layers, outline, fields, boardW, boardH }.
function parsePcbDocData(reader) {
  const board = parseBoard(reader.readStream((e) => /Board6\/Data$/i.test(e.path)));
  const layers = new Set();
  let prims = [];
  for (const [nm, kind] of [['Tracks6', 'line'], ['Arcs6', 'arc'], ['Fills6', 'line']]) {
    const bytes = reader.readStream((e) => new RegExp(nm + '/Data$', 'i').test(e.path));
    const got = parsePcbStream(bytes, kind);
    for (const p of got) layers.add(p.layer);
    prims = prims.concat(got);
  }
  const fields = (board && board.fields) || {};
  const outline = board && board.outline;
  let boardW = null, boardH = null;
  if (outline && outline.length) {
    const xs = outline.map((p) => p[0]), ys = outline.map((p) => p[1]);
    boardW = (Math.max(...xs) - Math.min(...xs)) * 0.0254;
    boardH = (Math.max(...ys) - Math.min(...ys)) * 0.0254;
  }
  return { prims, layers, outline, fields, boardW, boardH };
}

function renderPcbDoc(file, reader, resultsEl) {
  const { prims, layers, outline, fields: f, boardW, boardH } = parsePcbDocData(reader);

  resultsEl.appendChild(metaCard('Altium PCB', 'Altium Designer PCB document (.PcbDoc). The board outline and any routed copper are decoded from the binary primitive streams and drawn to scale.', [
    ['Format', 'Altium PcbDoc'],
    ['File', file.name],
    ['Size', fmtBytes(file.size)],
    ['Saved', f.DATE ? `${f.DATE} ${f.TIME || ''}`.trim() : null],
    ['Units', f.DISPLAYUNIT === '1' ? 'Imperial (mil)' : f.DISPLAYUNIT ? 'Metric (mm)' : null],
    ['Board size', boardW ? `${boardW.toFixed(1)} × ${boardH.toFixed(1)} mm` : null],
    ['Routed primitives', prims.length],
  ], file));

  const dcard = el('div', { class: 'anr-card' });
  dcard.appendChild(el('h3', {}, 'Board'));
  if (outline && outline.length >= 2) {
    dcard.appendChild(pcbView(prims, layers, outline).wrap);
    if (!prims.length) dcard.appendChild(el('div', { class: 'anr-info' }, 'This board has no routed copper, components or polygons - only the board outline is defined.'));
  } else {
    dcard.appendChild(el('div', { class: 'anr-info' }, 'No board outline or geometry could be decoded from this document.'));
  }
  resultsEl.appendChild(dcard);
}

// ---- combined project view (folder drop) ----------------------------------
// When a whole Altium project FOLDER is dropped, the individual documents stop
// being isolated files and become one design: schematic(s) + board + footprint
// library, tied together by a shared bill of materials. This view stitches them
// into a single tabbed workbench and lets a BOM row cross-probe straight to the
// part on its schematic sheet.

const base = (p) => p.split(/[\\/]/).pop();
const extOfName = (n) => (n.split('.').pop() || '').toLowerCase();

// True for any file that belongs to an Altium project (used by folder.js to
// decide whether to offer the combined view).
export function isAltiumProjectFile(name) {
  const ext = extOfName(name);
  return ext === 'prjpcb' || ext === 'prjpcbstructure'
    || ext === 'schdoc' || ext === 'schlib' || ext === 'pcbdoc' || ext === 'pcblib'
    || ext === 'epw' || /preview$/.test(ext);
}

// Pull a parameter value by trying each name pattern in priority order.
function paramVal(params, patterns) {
  for (const re of patterns) {
    const m = (params || []).find((p) => re.test(p.name));
    if (m && m.value) return m.value;
  }
  return '';
}
function bomFields(comp) {
  const p = comp.params || [];
  return {
    mfr: paramVal(p, [/^manufacturer.?name$/i, /^manufacturer$/i, /manufacturer(?!.*part)/i]),
    mpn: paramVal(p, [/manufacturer.?part.?number/i, /^mpn$/i, /^part.?number$/i]),
    datasheet: paramVal(p, [/datasheet/i, /product.?detail/i]),
  };
}

// Small key/value table for a doc panel header (lighter than the full metaCard).
function miniMeta(rows) {
  const tbl = el('table', { class: 'anr-readout' });
  for (const [k, v] of rows) if (v != null && v !== '') tbl.appendChild(row(k, String(v)));
  return tbl;
}

// Build a project card from the Altium files found in a dropped folder.
// `altFiles` are folder entries: { path, file }. Returns a card element.
export async function buildAltiumProjectCard(altFiles, folderName) {
  // Categorise the files by role.
  let prjFile = null;
  const schF = [], pcbF = [], libF = [], epwF = [], prevF = [];
  for (const af of altFiles) {
    const ext = extOfName(base(af.path));
    if (ext === 'prjpcb' || ext === 'prjpcbstructure') { if (!prjFile) prjFile = af; }
    else if (ext === 'schdoc' || ext === 'schlib') schF.push(af);
    else if (ext === 'pcbdoc') pcbF.push(af);
    else if (ext === 'pcblib') libF.push(af);
    else if (ext === 'epw') epwF.push(af);
    else if (/preview$/.test(ext)) prevF.push(af);
  }

  let prj = null;
  if (prjFile) { try { prj = parsePrj(await prjFile.file.text(), base(prjFile.path)); } catch (_) {} }

  // Parse each OLE document. Failures are skipped so one bad file can't sink the
  // whole project view.
  const docs = [];
  async function addDoc(af, kind) {
    try {
      const reader = await openCfbf(af.file);
      if (!reader) return;
      if (kind === 'sch') docs.push({ kind: 'sch', name: base(af.path), file: af.file, parsed: parseSchematic(reader) });
      else if (kind === 'pcbdoc') docs.push({ kind: 'pcbdoc', name: base(af.path), file: af.file, data: parsePcbDocData(reader) });
      else if (kind === 'pcblib') docs.push({ kind: 'pcblib', name: base(af.path), file: af.file, data: parsePcbLibData(reader) });
    } catch (_) {}
  }
  for (const af of schF) await addDoc(af, 'sch');
  for (const af of pcbF) await addDoc(af, 'pcbdoc');
  for (const af of libF) await addDoc(af, 'pcblib');

  // Order documents the way the .PrjPcb lists them, then anything left over.
  if (prj && prj.docs.length) {
    const ordOf = (name) => {
      const i = prj.docs.findIndex((d) => base(d).toLowerCase() === name.toLowerCase());
      return i < 0 ? 999 : i;
    };
    docs.sort((a, b) => ordOf(a.name) - ordOf(b.name));
  }

  // Combined BOM across every schematic.
  const schDocs = docs.filter((d) => d.kind === 'sch');
  const bom = [];
  for (const d of schDocs) {
    for (const c of (d.parsed ? d.parsed.parts : []) || []) {
      if (c.libref || c.designator) bom.push({ comp: c, doc: d });
    }
  }
  bom.sort((a, b) => (a.comp.designator || '~').localeCompare(b.comp.designator || '~', undefined, { numeric: true }));

  // ---- card + tab scaffolding ----
  const card = el('div', { class: 'anr-card anr-altium-project' });
  card.appendChild(el('h3', {}, 'Altium project'));
  card.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 12px;' },
    'Every document in this folder, opened together as one design. Click a designator in the bill of materials to jump to that part on its schematic.'));

  const tabsBar = el('div', { class: 'anr-altium-tabs' });
  const panels = el('div', { class: 'anr-altium-tabwrap' });
  card.appendChild(tabsBar);
  card.appendChild(panels);

  const tabs = [];
  function addTab(label, buildPanel) {
    const idx = tabs.length;
    const btn = el('button', { type: 'button', class: 'anr-btn anr-altium-tab' }, label);
    const panel = el('div', { class: 'anr-altium-tabpanel', hidden: '' });
    btn.addEventListener('click', () => setActive(idx));
    tabsBar.appendChild(btn);
    panels.appendChild(panel);
    tabs.push({ btn, panel, build: buildPanel, built: false, view: null });
    return idx;
  }
  function setActive(i) {
    tabs.forEach((t, j) => { t.btn.classList.toggle('is-on', j === i); t.panel.hidden = j !== i; });
    const t = tabs[i];
    if (t && !t.built) { t.built = true; t.view = t.build(t.panel) || null; }
  }

  // Overview tab (built last so it can reference every doc's tab index).
  const overviewIdx = addTab('Overview', (panel) => buildOverview(panel));

  // One tab per document.
  for (const d of docs) {
    d.tabIndex = addTab(d.name, (panel) => buildDocPanel(panel, d));
  }

  function buildDocPanel(panel, d) {
    if (d.kind === 'sch') {
      const p = d.parsed;
      const isLib = /schlib$/i.test(d.name) || !p || !p.objs.length;
      panel.appendChild(miniMeta([
        ['Type', isLib ? 'Schematic library' : 'Schematic sheet'],
        ['Components', p ? p.parts.length : 0],
        ['Primitives', p ? p.objs.length : 0],
      ]));
      if (p && p.objs.length) {
        const v = schView(p);
        panel.appendChild(v.wrap);
        return v;   // exposes focus() for cross-probe
      }
      panel.appendChild(el('div', { class: 'anr-info' }, 'No drawable primitives could be decoded from this sheet.'));
      return null;
    }
    if (d.kind === 'pcbdoc') {
      const { prims, layers, outline, boardW } = d.data;
      panel.appendChild(miniMeta([
        ['Type', 'PCB document'],
        ['Board size', boardW ? `${boardW.toFixed(1)} × ${d.data.boardH.toFixed(1)} mm` : null],
        ['Routed primitives', prims.length],
      ]));
      if (outline && outline.length >= 2) {
        panel.appendChild(pcbView(prims, layers, outline).wrap);
        if (!prims.length) panel.appendChild(el('div', { class: 'anr-info' }, 'Only the board outline is defined - no routed copper or placed components.'));
      } else panel.appendChild(el('div', { class: 'anr-info' }, 'No board outline or geometry could be decoded.'));
      return null;
    }
    // pcblib
    const { prims, layers, pads, fpName } = d.data;
    panel.appendChild(miniMeta([
      ['Type', 'Footprint library'],
      ['Footprint', fpName],
      ['Pads', pads.length],
      ['Layers used', [...layers].map((l) => layerInfo(l).name).join(', ')],
    ]));
    if (pads.length) panel.appendChild(padsTable(pads));
    if (prims.length) panel.appendChild(pcbView(prims, layers, null).wrap);
    else panel.appendChild(el('div', { class: 'anr-info' }, 'No footprint geometry could be decoded.'));
    return null;
  }

  function buildOverview(panel) {
    // Project summary.
    panel.appendChild(miniMeta([
      ['Project', (prj && prj.projName) || folderName],
      ['Schematics', schDocs.length || null],
      ['Boards', docs.filter((d) => d.kind === 'pcbdoc').length || null],
      ['Footprint libraries', docs.filter((d) => d.kind === 'pcblib').length || null],
      ['Components', bom.length || null],
      ['Default configuration', (prj && prj.cfg) || null],
    ]));

    // Combined bill of materials with cross-probe.
    if (bom.length) {
      const bomCard = el('div', { class: 'anr-altium-bomwrap' });
      bomCard.appendChild(el('h3', {}, 'Bill of materials'));
      const multiSheet = schDocs.length > 1;
      const tbl = el('table', { class: 'anr-readout anr-altium-bom' });
      const head = ['Designator', 'Part', 'Description', 'Manufacturer', 'Mfr part №', 'Datasheet'];
      if (multiSheet) head.push('Sheet');
      tbl.appendChild(el('tr', {}, head.map((h) => el('th', {}, h))));
      for (const { comp, doc } of bom) {
        const { mfr, mpn, datasheet } = bomFields(comp);
        const desigBtn = el('button', { type: 'button', class: 'anr-btn anr-altium-desig' }, comp.designator || '—');
        desigBtn.title = 'Show ' + (comp.designator || 'this part') + ' on ' + doc.name;
        desigBtn.addEventListener('click', () => {
          setActive(doc.tabIndex);
          const v = tabs[doc.tabIndex] && tabs[doc.tabIndex].view;
          if (v && v.focus && comp.designator) v.focus(comp.designator);
          tabsBar.scrollIntoView({ block: 'nearest' });
        });
        const cells = [
          el('td', {}, desigBtn),
          el('td', {}, comp.libref || '—'),
          el('td', { class: 'anr-altium-bom-desc' }, comp.desc || '—'),
          el('td', {}, mfr || '—'),
          el('td', {}, mpn || '—'),
          el('td', {}, /^https?:/i.test(datasheet) ? el('a', { href: datasheet, target: '_blank', rel: 'noopener' }, 'Open') : '—'),
        ];
        if (multiSheet) {
          const sheetBtn = el('button', { type: 'button', class: 'anr-btn anr-altium-desig' }, doc.name);
          sheetBtn.addEventListener('click', () => { setActive(doc.tabIndex); tabsBar.scrollIntoView({ block: 'nearest' }); });
          cells.push(el('td', {}, sheetBtn));
        }
        tbl.appendChild(el('tr', {}, cells));
      }
      bomCard.appendChild(tbl);
      panel.appendChild(bomCard);
    } else {
      panel.appendChild(el('div', { class: 'anr-info' }, 'No components with a designator were found in the schematics.'));
    }

    // Library parts / sourcing from any .epw wrappers.
    if (epwF.length) {
      const list = el('table', { class: 'anr-readout' });
      list.appendChild(el('tr', {}, [el('th', {}, 'SamacSys model'), el('th', {}, 'Component ID'), el('th', {}, 'Source')]));
      panel.appendChild(el('h3', {}, 'Sourced library parts'));
      panel.appendChild(list);
      const SRC = { ms: 'Mouser', fa: 'Farnell / element14', di: 'Digi-Key', rs: 'RS Components', ar: 'Arrow' };
      epwF.forEach(async (af) => {
        let text = '';
        try { text = await af.file.text(); } catch (_) {}
        const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const srcLine = lines.find((l) => /^Source=/i.test(l));
        const src = srcLine ? (srcLine.split('=')[1] || '') : '';
        const descLine = lines.find((l) => /^\d+\/\d+\//.test(l));
        const compId = descLine ? descLine.split('/')[0] : (lines[0] || '');
        list.appendChild(el('tr', {}, [
          el('td', {}, base(af.path)),
          el('td', {}, compId || '—'),
          el('td', {}, src ? (SRC[src.toLowerCase()] || src) : '—'),
        ]));
      });
    }

    // Every file in the project, with its role.
    const filesCard = el('table', { class: 'anr-readout' });
    panel.appendChild(el('h3', {}, 'Project files'));
    panel.appendChild(filesCard);
    const roleOf = (n) => {
      const e = extOfName(n);
      if (e === 'prjpcb' || e === 'prjpcbstructure') return 'Project manifest';
      if (e === 'schdoc') return 'Schematic';
      if (e === 'schlib') return 'Schematic library';
      if (e === 'pcbdoc') return 'PCB';
      if (e === 'pcblib') return 'Footprint library';
      if (e === 'epw') return 'SamacSys model';
      if (/preview$/.test(e)) return 'Preview cache';
      return 'Document';
    };
    for (const af of altFiles) filesCard.appendChild(row(roleOf(base(af.path)), base(af.path)));
  }

  setActive(overviewIdx);
  return card;
}
