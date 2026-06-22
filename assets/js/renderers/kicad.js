/* Analyser - KiCad viewer (schematic + PCB + libraries + project)
   ============================================================================
   KiCad's modern documents are all S-expression TEXT (versions 6-9):
     - .kicad_sch  schematic  - lib_symbols (symbol graphics) + placed symbols,
                                wires, junctions, labels.
     - .kicad_pcb  board      - layers, footprints (pads + silk/courtyard/fab),
                                tracks (segment/arc), vias, zones, Edge.Cuts.
     - .kicad_sym  symbol library, .kicad_mod  single footprint.
     - fp-lib-table / sym-lib-table  library tables (also S-expr).
   And a few JSON / text sidecars:
     - .kicad_pro / .kicad_prl  project + local settings (JSON).
     - fp-info-cache            footprint metadata cache (JSON).
     - .wbk                     ngspice simulation workbook (text).

   Everything is parsed and drawn in the browser; nothing is uploaded. Geometry
   is rebuilt into an interactive SVG with pan / zoom / fit and, for boards,
   per-layer visibility toggles. Coordinates are millimetres. KiCad sheet/board
   space has Y pointing DOWN (screen-like), so the SVG draws board geometry
   directly; symbol-library graphics use a Y-UP convention and are flipped when
   placed. The reference designator ties a schematic symbol to its board
   footprint, which the project view uses for two-way cross-probing.
*/

import { el, row, h3help, fmtBytes, sha256Row, errorCard, inlineLoader } from '../core/util.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs) => {
  const n = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};

// ---- S-expression parser --------------------------------------------------
// Parses KiCad's `(tag value (child ...) ...)` text into nested arrays where
// node[0] is the tag string and the rest are atoms (strings) or child arrays.
// Quoted and bare tokens both become plain strings - we never need to tell them
// apart for our purposes.
function parseSexpr(text) {
  let i = 0;
  const n = text.length;
  // Skip a UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xFEFF) i = 1;
  function node() {
    i++; // consume '('
    const out = [];
    while (i < n) {
      const c = text[i];
      if (c === '(') out.push(node());
      else if (c === ')') { i++; break; }
      else if (c === '"') out.push(str());
      else if (c === ' ' || c === '\t' || c === '\n' || c === '\r') i++;
      else out.push(atom());
    }
    return out;
  }
  function str() {
    i++; // consume opening quote
    let s = '';
    while (i < n) {
      const c = text[i++];
      if (c === '\\') { const d = text[i++]; s += d === 'n' ? '\n' : d === 't' ? '\t' : d; }
      else if (c === '"') break;
      else s += c;
    }
    return s;
  }
  function atom() {
    let s = '';
    while (i < n) {
      const c = text[i];
      if (c === '(' || c === ')' || c === '"' || c === ' ' || c === '\t' || c === '\n' || c === '\r') break;
      s += c; i++;
    }
    return s;
  }
  while (i < n && text[i] !== '(') i++;
  if (i >= n) return null;
  return node();
}

// node helpers ---------------------------------------------------------------
const isNode = (x) => Array.isArray(x);
const tagOf = (x) => (isNode(x) ? x[0] : null);
const kids = (node, tag) => (isNode(node) ? node.filter((x) => isNode(x) && x[0] === tag) : []);
const kid = (node, tag) => { if (isNode(node)) for (const x of node) if (isNode(x) && x[0] === tag) return x; return null; };
// Positional scalar arguments (the non-array tokens after the tag).
const args = (node) => (isNode(node) ? node.slice(1).filter((x) => !isNode(x)) : []);
const numAt = (node, idx, d = 0) => { const a = args(node); const v = parseFloat(a[idx]); return Number.isFinite(v) ? v : d; };
// (at x y [rot])
function atOf(node) { const a = kid(node, 'at'); return a ? { x: numAt(a, 0), y: numAt(a, 1), rot: numAt(a, 2, 0) } : null; }
// (property "Name" "Value" ...)
function propVal(node, name) {
  for (const x of node || []) if (isNode(x) && x[0] === 'property' && x[1] === name) return x[2];
  return null;
}
// list of (xy x y) points inside a (pts ...) child
function ptsOf(node) {
  const p = kid(node, 'pts');
  if (!p) return [];
  return kids(p, 'xy').map((xy) => [numAt(xy, 0), numAt(xy, 1)]);
}

// ---- layer palette (tuned for the dark canvas) ----------------------------
const LAYER_COLORS = {
  'F.Cu': '#c01414', 'B.Cu': '#1540c0', 'In1.Cu': '#9a7400', 'In2.Cu': '#0a8a52',
  'F.SilkS': '#54542f', 'B.SilkS': '#6a4480',
  'F.Mask': 'rgba(120,30,150,0.55)', 'B.Mask': 'rgba(80,30,140,0.55)',
  'F.Paste': '#555555', 'B.Paste': '#363636',
  'F.CrtYd': '#a82a82', 'B.CrtYd': '#577510',
  'F.Fab': '#75600e', 'B.Fab': '#0e6868',
  'F.Adhes': '#6a30c0', 'B.Adhes': '#3060c0',
  'Edge.Cuts': '#8a7000',
  'Dwgs.User': '#363c6e', 'Cmts.User': '#0a6498',
  'Eco1.User': '#0a8a5a', 'Eco2.User': '#955610', 'Margin': '#b0367a',
  'User.Drawings': '#363c6e', 'User.Comments': '#0a6498',
};
function layerColor(name) {
  if (LAYER_COLORS[name]) return LAYER_COLORS[name];
  if (/\.Cu$/.test(name)) return '#8a5e10';
  if (/User/.test(name)) return '#363c6e';
  return '#2a5a44';
}
// Pad fill: copper layer it sits on; through-hole (multiple Cu) reads gold.
function padColor(layers) {
  const hasF = layers.includes('F.Cu') || layers.includes('*.Cu');
  const hasB = layers.includes('B.Cu') || layers.includes('*.Cu');
  if (hasF && hasB) return '#a87800';
  if (hasB) return '#1540c0';
  return '#c01414';
}

// schematic colours (tuned for the paper background - dark + saturated)
const SCH = {
  body: '#9a2417', fill: 'rgba(154,36,23,0.12)', bgFill: 'rgba(150,118,10,0.16)',
  pin: '#8a4a00', wire: '#0a6a5a', bus: '#0a4a78', junction: '#0a6a5a',
  label: '#163a78', glabel: '#9a4810', hlabel: '#0a5878', text: '#20283a',
  ref: '#7a3600', val: '#125a4a', noconn: '#b01020',
};

// Round to a "nice" 1/2/5 x 10^n step so the grid reads like graph paper at any
// document scale (mm board, tiny footprint, or schematic units).
function niceStep(x) {
  if (!(x > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x))), f = x / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}
// Graph-paper grid (minor + every-5th major) behind the geometry, emulating the
// KiCad / Altium sheet. Drawn in document space (pans/zooms with the board) with
// non-scaling strokes so the lines stay 1px crisp at any zoom.
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

// ---- generic SVG viewer (pan / zoom / fit / layer toggles) -----------------
function buildViewer(build, opts = {}) {
  const wrap = el('div', { class: 'anr-altium-wrap' });
  const s = svg('svg', { class: 'anr-altium-svg' });
  const root = svg('g', {});
  s.appendChild(root);
  wrap.appendChild(s);

  const bbox = build(root);
  addPaperGrid(root, bbox);
  const w = Math.max(bbox.maxx - bbox.minx, 0.001), h = Math.max(bbox.maxy - bbox.miny, 0.001);
  const pad = Math.max(w, h) * 0.06 + 0.5;
  const vb = { x: bbox.minx - pad, y: bbox.miny - pad, w: w + pad * 2, h: h + pad * 2 };
  const home = { ...vb };
  const apply = () => s.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  apply();

  // The viewBox is letterboxed (xMidYMid meet) to keep aspect, so the screen->
  // document scale is UNIFORM on both axes. Map the cursor / drag through that
  // single scale (and its centring offset) rather than vb.w/width and vb.h/height
  // separately, which made one axis pan at the wrong rate.
  const screenToUser = (r) => {
    const scale = Math.min(r.width / vb.w, r.height / vb.h);
    return { scale, offX: (r.width - vb.w * scale) / 2, offY: (r.height - vb.h * scale) / 2 };
  };
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

  let drag = null;
  s.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; s.setPointerCapture(e.pointerId); s.classList.add('is-grabbing'); });
  s.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { scale } = screenToUser(s.getBoundingClientRect());
    vb.x -= (e.clientX - drag.x) / scale;
    vb.y -= (e.clientY - drag.y) / scale;
    drag = { x: e.clientX, y: e.clientY }; apply();
  });
  const endDrag = () => { drag = null; s.classList.remove('is-grabbing'); };
  s.addEventListener('pointerup', endDrag);
  s.addEventListener('pointerleave', endDrag);

  const bar = el('div', { class: 'anr-altium-bar' });
  const fit = el('button', { class: 'anr-btn', type: 'button' }, 'Fit');
  fit.addEventListener('click', () => { Object.assign(vb, home); apply(); });
  bar.appendChild(fit);

  if (opts.layers && opts.layers.size) {
    const ids = [...opts.layers.keys()].sort();
    for (const id of ids) {
      const color = opts.layers.get(id);
      const chip = el('button', { class: 'anr-btn anr-altium-layer is-on', type: 'button', title: id });
      chip.appendChild(el('span', { class: 'anr-altium-swatch', style: `background:${color};color:${color}` }));
      chip.appendChild(document.createTextNode(id));
      chip.addEventListener('click', () => {
        const on = chip.classList.toggle('is-on');
        root.querySelectorAll(`[data-layer="${cssEsc(id)}"]`).forEach((nn) => { nn.style.display = on ? '' : 'none'; });
      });
      bar.appendChild(chip);
    }
  }
  wrap.appendChild(bar);

  function centerOn(cx, cy, tw) {
    if (tw && tw > 0) { const aspect = vb.h / vb.w; vb.w = tw; vb.h = tw * aspect; }
    vb.x = cx - vb.w / 2; vb.y = cy - vb.h / 2; apply();
  }
  let flashNode = null, flashTimer = null;
  function flash(cx, cy) {
    if (flashNode) flashNode.remove();
    const span = Math.max(vb.w, vb.h);
    flashNode = svg('circle', { class: 'anr-altium-ping', cx, cy, r: span * 0.05, fill: 'none', stroke: '#e8480a', 'stroke-width': span * 0.014 });
    root.appendChild(flashNode);
    if (flashTimer) clearTimeout(flashTimer);
    const node = flashNode;
    flashTimer = setTimeout(() => { if (node) node.remove(); if (flashNode === node) flashNode = null; }, 1500);
  }
  return { wrap, centerOn, flash, home: { ...home } };
}
const cssEsc = (s) => String(s).replace(/["\\]/g, '\\$&');

function fitBox() { return { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity }; }
function grow(b, x, y) { if (x < b.minx) b.minx = x; if (y < b.miny) b.miny = y; if (x > b.maxx) b.maxx = x; if (y > b.maxy) b.maxy = y; }
function safeBox(b) { if (!Number.isFinite(b.minx)) return { minx: -50, miny: -50, maxx: 50, maxy: 50 }; if (b.minx === b.maxx) { b.minx -= 5; b.maxx += 5; } if (b.miny === b.maxy) { b.miny -= 5; b.maxy += 5; } return b; }

// Rotate (dx,dy) by deg degrees clockwise in screen space (Y down).
function rot(dx, dy, deg) {
  if (!deg) return [dx, dy];
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [dx * c - dy * s, dx * s + dy * c];
}

// ---- arc geometry ----------------------------------------------------------
// Three-point arc (KiCad gr_arc / fp_arc / sym arc: start, mid, end).
function arc3(x1, y1, xm, ym, x2, y2) {
  const ax = x1, ay = y1, bx = xm, by = ym, cx = x2, cy = y2;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null;   // collinear
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const sweep = cross < 0 ? 1 : 0;               // SVG sweep flag
  const large = isLargeArc(ax, ay, bx, by, cx, cy, ux, uy) ? 1 : 0;
  return { r, sweep, large };
}
function isLargeArc(ax, ay, bx, by, cx, cy, ux, uy) {
  const a1 = Math.atan2(ay - uy, ax - ux);
  const a2 = Math.atan2(cy - uy, cx - ux);
  const am = Math.atan2(by - uy, bx - ux);
  const norm = (t) => { while (t < 0) t += 2 * Math.PI; while (t >= 2 * Math.PI) t -= 2 * Math.PI; return t; };
  const span = norm(a2 - a1);
  const midRel = norm(am - a1);
  // If the mid point isn't on the minor sweep, it's the major arc.
  return midRel > span ? true : span > Math.PI;
}

// ===========================================================================
//  SCHEMATIC
// ===========================================================================
// Collect the drawable graphics of a library symbol (recursively, across its
// unit sub-symbols). Returns primitives in symbol-local (Y-up) coordinates.
function symbolGraphics(symNode) {
  const prims = [];
  (function walk(node) {
    for (const x of node) {
      if (!isNode(x)) continue;
      const t = x[0];
      if (t === 'rectangle') {
        const a = kid(x, 'start'), b = kid(x, 'end');
        if (a && b) prims.push({ kind: 'rect', x1: numAt(a, 0), y1: numAt(a, 1), x2: numAt(b, 0), y2: numAt(b, 1), fill: fillType(x) });
      } else if (t === 'polyline' || t === 'bezier') {
        prims.push({ kind: 'poly', pts: ptsOf(x), fill: fillType(x) });
      } else if (t === 'circle') {
        const c = kid(x, 'center');
        prims.push({ kind: 'circle', cx: numAt(c, 0), cy: numAt(c, 1), r: numAt(kid(x, 'radius'), 0), fill: fillType(x) });
      } else if (t === 'arc') {
        const a = kid(x, 'start'), m = kid(x, 'mid'), e = kid(x, 'end');
        if (a && m && e) prims.push({ kind: 'arc', x1: numAt(a, 0), y1: numAt(a, 1), xm: numAt(m, 0), ym: numAt(m, 1), x2: numAt(e, 0), y2: numAt(e, 1) });
      } else if (t === 'pin') {
        const p = atOf(x);
        prims.push({ kind: 'pin', x: p ? p.x : 0, y: p ? p.y : 0, rot: p ? p.rot : 0, len: numAt(kid(x, 'length'), 0, 2.54) });
      } else if (t === 'symbol') {
        walk(x);   // descend into unit sub-symbol
      }
    }
  })(symNode);
  return prims;
}
function fillType(node) { const f = kid(node, 'fill'); const t = f ? (args(kid(f, 'type'))[0] || 'none') : 'none'; return t; }

function parseSchematic(rootNode) {
  const libs = {};   // "Lib:Name" -> graphics[]
  const lib = kid(rootNode, 'lib_symbols');
  if (lib) for (const sym of kids(lib, 'symbol')) libs[sym[1]] = symbolGraphics(sym);

  const instances = [];   // placed components
  const wires = [], buses = [], junctions = [], labels = [], noconns = [], texts = [];
  for (const x of rootNode) {
    if (!isNode(x)) continue;
    const t = x[0];
    if (t === 'symbol') {
      const libId = args(kid(x, 'lib_id'))[0] || (kid(x, 'lib_id') ? kid(x, 'lib_id')[1] : '');
      const p = atOf(x);
      const ref = propVal(x, 'Reference');
      // KiCad power symbols and graphical items aren't real BOM parts.
      instances.push({
        libId, x: p ? p.x : 0, y: p ? p.y : 0, rot: p ? p.rot : 0,
        mirror: (kid(x, 'mirror') ? (kid(x, 'mirror')[1] || '') : ''),
        ref, value: propVal(x, 'Value'), footprint: propVal(x, 'Footprint'),
        datasheet: propVal(x, 'Datasheet'), desc: propVal(x, 'Description'),
        inBom: (args(kid(x, 'in_bom'))[0] !== 'no'),
        unit: numAt(kid(x, 'unit'), 0, 1),
      });
    } else if (t === 'wire') { wires.push(ptsOf(x)); }
    else if (t === 'bus') { buses.push(ptsOf(x)); }
    else if (t === 'junction') { const p = atOf(x); if (p) junctions.push(p); }
    else if (t === 'label' || t === 'global_label' || t === 'hierarchical_label') {
      const p = atOf(x); if (p) labels.push({ x: p.x, y: p.y, rot: p.rot, text: x[1], kind: t });
    } else if (t === 'no_connect') { const p = atOf(x); if (p) noconns.push(p); }
    else if (t === 'text') { const p = atOf(x); if (p) texts.push({ x: p.x, y: p.y, rot: p.rot, text: x[1] }); }
  }

  const title = propValTitle(rootNode);
  return { libs, instances, wires, buses, junctions, labels, noconns, texts, title,
    version: args(kid(rootNode, 'version'))[0], paper: args(kid(rootNode, 'paper'))[0] };
}
function propValTitle(rootNode) {
  const tb = kid(rootNode, 'title_block');
  return tb ? (args(kid(tb, 'title'))[0] || '') : '';
}

// Map a symbol-local (Y-up) point through a placed instance to sheet space.
function placeSym(inst, lx, ly) {
  let x = lx, y = -ly;                 // library Y-up -> sheet Y-down
  if (inst.mirror === 'x') y = -y;     // mirror across X axis
  if (inst.mirror === 'y') x = -x;
  const [rx, ry] = rot(x, y, -inst.rot);   // KiCad symbol rotation is CCW
  return [inst.x + rx, inst.y + ry];
}

function schView(parsed) {
  const v = buildViewer((g) => {
    const b = fitBox();
    // wires + buses
    for (const w of parsed.wires) {
      if (w.length < 2) continue;
      g.appendChild(svg('polyline', { points: w.map((p) => p.join(',')).join(' '), fill: 'none', stroke: SCH.wire, 'stroke-width': 0.25 }));
      for (const p of w) grow(b, p[0], p[1]);
    }
    for (const w of parsed.buses) {
      if (w.length < 2) continue;
      g.appendChild(svg('polyline', { points: w.map((p) => p.join(',')).join(' '), fill: 'none', stroke: SCH.bus, 'stroke-width': 0.4 }));
      for (const p of w) grow(b, p[0], p[1]);
    }
    // placed symbols
    for (const inst of parsed.instances) {
      const prims = parsed.libs[inst.libId] || [];
      for (const pr of prims) drawSchPrim(g, inst, pr, b);
      // reference text near the symbol origin
      if (inst.ref && !/^#/.test(inst.ref)) {
        const t = svg('text', { x: inst.x + 1, y: inst.y - 1, 'font-size': 1.6, fill: SCH.ref, 'font-weight': 700 });
        t.textContent = inst.ref; g.appendChild(t);
      }
      grow(b, inst.x, inst.y);
    }
    // junctions
    for (const j of parsed.junctions) { g.appendChild(svg('circle', { cx: j.x, cy: j.y, r: 0.5, fill: SCH.junction })); grow(b, j.x, j.y); }
    // labels
    for (const l of parsed.labels) {
      const col = l.kind === 'global_label' ? SCH.glabel : l.kind === 'hierarchical_label' ? SCH.hlabel : SCH.label;
      const t = svg('text', { x: l.x, y: l.y - 0.4, 'font-size': 1.6, fill: col }); t.textContent = l.text; g.appendChild(t);
      grow(b, l.x, l.y);
    }
    // no-connect crosses
    for (const nc of parsed.noconns) {
      g.appendChild(svg('line', { x1: nc.x - 0.6, y1: nc.y - 0.6, x2: nc.x + 0.6, y2: nc.y + 0.6, stroke: SCH.noconn, 'stroke-width': 0.2 }));
      g.appendChild(svg('line', { x1: nc.x - 0.6, y1: nc.y + 0.6, x2: nc.x + 0.6, y2: nc.y - 0.6, stroke: SCH.noconn, 'stroke-width': 0.2 }));
    }
    // free text
    for (const tx of parsed.texts) { const t = svg('text', { x: tx.x, y: tx.y, 'font-size': 1.6, fill: SCH.text }); t.textContent = (tx.text || '').split('\n')[0]; g.appendChild(t); grow(b, tx.x, tx.y); }
    return safeBox(b);
  });

  // designator -> sheet position, for project cross-probe.
  const at = new Map();
  for (const inst of parsed.instances) if (inst.ref && !/^#/.test(inst.ref)) at.set(inst.ref.toUpperCase(), { x: inst.x, y: inst.y });
  v.focus = (ref) => { const c = at.get(String(ref).toUpperCase()); if (!c) return false; v.centerOn(c.x, c.y, Math.max(v.home.w * 0.22, 30)); v.flash(c.x, c.y); return true; };
  return v;
}

function drawSchPrim(g, inst, pr, b) {
  if (pr.kind === 'rect') {
    const p1 = placeSym(inst, pr.x1, pr.y1), p2 = placeSym(inst, pr.x2, pr.y2);
    const x = Math.min(p1[0], p2[0]), y = Math.min(p1[1], p2[1]), w = Math.abs(p2[0] - p1[0]), h = Math.abs(p2[1] - p1[1]);
    g.appendChild(svg('rect', { x, y, width: w, height: h, fill: pr.fill === 'background' ? SCH.bgFill : pr.fill === 'outline' ? SCH.fill : 'none', stroke: SCH.body, 'stroke-width': 0.15 }));
    grow(b, x, y); grow(b, x + w, y + h);
  } else if (pr.kind === 'poly') {
    const pts = pr.pts.map((p) => placeSym(inst, p[0], p[1]));
    if (pts.length < 2) return;
    g.appendChild(svg('polyline', { points: pts.map((p) => p.join(',')).join(' '), fill: pr.fill === 'background' ? SCH.bgFill : pr.fill === 'outline' ? SCH.fill : 'none', stroke: SCH.body, 'stroke-width': 0.15 }));
    for (const p of pts) grow(b, p[0], p[1]);
  } else if (pr.kind === 'circle') {
    const c = placeSym(inst, pr.cx, pr.cy);
    g.appendChild(svg('circle', { cx: c[0], cy: c[1], r: pr.r, fill: pr.fill === 'background' ? SCH.bgFill : 'none', stroke: SCH.body, 'stroke-width': 0.15 }));
    grow(b, c[0] - pr.r, c[1] - pr.r); grow(b, c[0] + pr.r, c[1] + pr.r);
  } else if (pr.kind === 'arc') {
    const a = placeSym(inst, pr.x1, pr.y1), m = placeSym(inst, pr.xm, pr.ym), e = placeSym(inst, pr.x2, pr.y2);
    const arc = arc3(a[0], a[1], m[0], m[1], e[0], e[1]);
    if (arc) { g.appendChild(svg('path', { d: `M ${a[0]} ${a[1]} A ${arc.r} ${arc.r} 0 ${arc.large} ${arc.sweep} ${e[0]} ${e[1]}`, fill: 'none', stroke: SCH.body, 'stroke-width': 0.15 })); grow(b, a[0], a[1]); grow(b, e[0], e[1]); grow(b, m[0], m[1]); }
  } else if (pr.kind === 'pin') {
    // pin extends from its origin along its own rotation (symbol Y-up space).
    const [ex, ey] = rot(pr.len, 0, pr.rot);
    const o = placeSym(inst, pr.x, pr.y), t = placeSym(inst, pr.x + ex, pr.y + ey);
    g.appendChild(svg('line', { x1: o[0], y1: o[1], x2: t[0], y2: t[1], stroke: SCH.pin, 'stroke-width': 0.15 }));
    grow(b, o[0], o[1]); grow(b, t[0], t[1]);
  }
}

// ===========================================================================
//  PCB / FOOTPRINT
// ===========================================================================
// Parse a footprint node (used both inside a board and for a standalone
// .kicad_mod). originX/originY/originRot place it on the board; for a lone
// footprint they are 0.
function parseFootprint(fpNode, ox = 0, oy = 0, orot = 0) {
  const prims = [];
  const pads = [];
  const place = (lx, ly) => { const [rx, ry] = rot(lx, ly, orot); return [ox + rx, oy + ry]; };
  for (const x of fpNode) {
    if (!isNode(x)) continue;
    const t = x[0];
    if (t === 'pad') {
      const p = atOf(x);
      const padrot = (p ? p.rot : 0);
      const size = kid(x, 'size');
      const shape = x[2];                       // smd/thru_hole/np_thru_hole + shape word
      const shapeWord = x[3];
      const layerList = (kid(x, 'layers') ? args(kid(x, 'layers')) : []);
      const drill = kid(x, 'drill');
      const c = place(p ? p.x : 0, p ? p.y : 0);
      pads.push({
        num: x[1], cx: c[0], cy: c[1], sx: numAt(size, 0), sy: numAt(size, 1),
        rot: orot + padrot, shape: shapeWord || 'rect', type: shape,
        drill: drill ? numAt(drill, 0) : 0, layers: layerList,
        color: padColor(layerList),
      });
    } else if (t === 'fp_line' || t === 'fp_rect' || t === 'fp_circle' || t === 'fp_arc' || t === 'fp_poly') {
      addGraphic(prims, x, t.slice(3), place);
    }
  }
  return { prims, pads, ref: propVal(fpNode, 'Reference'), value: propVal(fpNode, 'Value'),
    name: fpNode[1], descr: args(kid(fpNode, 'descr'))[0] || '', tags: args(kid(fpNode, 'tags'))[0] || '' };
}

// Shared graphic decoder for gr_* (board) and fp_* (footprint) shapes.
function addGraphic(prims, node, kind, place) {
  const layer = args(kid(node, 'layer'))[0] || 'Dwgs.User';
  const width = numAt(kid(node, 'width'), 0, 0) || numAt(kid(kid(node, 'stroke') || [], 'width'), 0, 0.12);
  if (kind === 'line') {
    const a = kid(node, 'start'), e = kid(node, 'end');
    const p1 = place(numAt(a, 0), numAt(a, 1)), p2 = place(numAt(e, 0), numAt(e, 1));
    prims.push({ kind: 'line', layer, x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], w: width });
  } else if (kind === 'rect') {
    const a = kid(node, 'start'), e = kid(node, 'end');
    const p1 = place(numAt(a, 0), numAt(a, 1)), p2 = place(numAt(e, 0), numAt(e, 1));
    prims.push({ kind: 'rect', layer, x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], w: width });
  } else if (kind === 'circle') {
    const c = kid(node, 'center'), e = kid(node, 'end');
    const pc = place(numAt(c, 0), numAt(c, 1)), pe = place(numAt(e, 0), numAt(e, 1));
    prims.push({ kind: 'circle', layer, cx: pc[0], cy: pc[1], r: Math.hypot(pe[0] - pc[0], pe[1] - pc[1]), w: width });
  } else if (kind === 'arc') {
    const a = kid(node, 'start'), m = kid(node, 'mid'), e = kid(node, 'end');
    const p1 = place(numAt(a, 0), numAt(a, 1)), pm = place(numAt(m, 0), numAt(m, 1)), p2 = place(numAt(e, 0), numAt(e, 1));
    prims.push({ kind: 'arc', layer, x1: p1[0], y1: p1[1], xm: pm[0], ym: pm[1], x2: p2[0], y2: p2[1], w: width });
  } else if (kind === 'poly') {
    const pts = ptsOf(node).map((p) => place(p[0], p[1]));
    prims.push({ kind: 'poly', layer, pts, w: width, filled: (args(kid(node, 'fill'))[0] === 'yes' || fillType(node) === 'solid') });
  }
}

function parsePcb(rootNode) {
  const layersUsed = new Set();
  const prims = [];        // board graphics (gr_*) + footprint graphics
  const pads = [];
  const tracks = [];       // segment/arc copper
  const vias = [];
  const footprints = [];   // {ref,value,cx,cy} for cross-probe
  let zones = 0;

  for (const x of rootNode) {
    if (!isNode(x)) continue;
    const t = x[0];
    if (t === 'footprint') {
      const p = atOf(x);
      const fp = parseFootprint(x, p ? p.x : 0, p ? p.y : 0, p ? p.rot : 0);
      for (const pr of fp.prims) { prims.push(pr); layersUsed.add(pr.layer); }
      for (const pd of fp.pads) { pads.push(pd); for (const ly of pd.layers) if (ly !== '*.Mask' && ly !== '*.Paste') layersUsed.add(ly === '*.Cu' ? 'F.Cu' : ly); }
      if (fp.ref) footprints.push({ ref: fp.ref, value: fp.value, cx: p ? p.x : 0, cy: p ? p.y : 0 });
    } else if (t === 'gr_line' || t === 'gr_rect' || t === 'gr_circle' || t === 'gr_arc' || t === 'gr_poly') {
      const before = prims.length;
      addGraphic(prims, x, t.slice(3), (lx, ly) => [lx, ly]);
      if (prims.length > before) layersUsed.add(prims[prims.length - 1].layer);
    } else if (t === 'segment') {
      const a = kid(x, 'start'), e = kid(x, 'end'), layer = args(kid(x, 'layer'))[0];
      tracks.push({ kind: 'line', layer, x1: numAt(a, 0), y1: numAt(a, 1), x2: numAt(e, 0), y2: numAt(e, 1), w: numAt(kid(x, 'width'), 0, 0.2) });
      layersUsed.add(layer);
    } else if (t === 'arc') {
      const a = kid(x, 'start'), m = kid(x, 'mid'), e = kid(x, 'end'), layer = args(kid(x, 'layer'))[0];
      tracks.push({ kind: 'arc', layer, x1: numAt(a, 0), y1: numAt(a, 1), xm: numAt(m, 0), ym: numAt(m, 1), x2: numAt(e, 0), y2: numAt(e, 1), w: numAt(kid(x, 'width'), 0, 0.2) });
      layersUsed.add(layer);
    } else if (t === 'via') {
      const p = atOf(x); vias.push({ cx: p ? p.x : 0, cy: p ? p.y : 0, r: numAt(kid(x, 'size'), 0, 0.8) / 2, drill: numAt(kid(x, 'drill'), 0, 0.4) });
    } else if (t === 'zone') {
      zones++;
      for (const fp of kids(x, 'filled_polygon')) { const pts = ptsOf(fp); if (pts.length) { prims.push({ kind: 'poly', layer: args(kid(fp, 'layer'))[0] || args(kid(x, 'layer'))[0] || 'F.Cu', pts, w: 0, filled: true, zone: true }); layersUsed.add(args(kid(fp, 'layer'))[0] || 'F.Cu'); } }
    }
  }
  const thickness = numAt(kid(kid(rootNode, 'general') || [], 'thickness'), 0, 0);
  return { prims, pads, tracks, vias, footprints, zones, layersUsed, thickness,
    version: args(kid(rootNode, 'version'))[0] };
}

function pcbView(pcb, opts = {}) {
  // Build a layer->colour map for the toggle chips (only layers that drew).
  const layerMap = new Map();
  for (const ly of [...pcb.layersUsed].sort()) layerMap.set(ly, layerColor(ly));

  const v = buildViewer((g) => {
    const b = fitBox();
    // copper pours / filled polys first (so traces and pads sit on top)
    for (const p of pcb.prims) if (p.kind === 'poly' && p.zone) drawPrim(g, p, b);
    // board graphics + footprint silk/courtyard
    for (const p of pcb.prims) if (!(p.kind === 'poly' && p.zone)) drawPrim(g, p, b);
    // tracks
    for (const tk of pcb.tracks) drawTrack(g, tk, b);
    // pads
    for (const pd of pcb.pads) drawPad(g, pd, b);
    // vias
    for (const vi of pcb.vias) {
      g.appendChild(svg('circle', { cx: vi.cx, cy: vi.cy, r: vi.r, fill: '#a87800', 'data-layer': 'F.Cu' }));
      g.appendChild(svg('circle', { cx: vi.cx, cy: vi.cy, r: vi.drill / 2, fill: '#0b0b0f' }));
      grow(b, vi.cx - vi.r, vi.cy - vi.r); grow(b, vi.cx + vi.r, vi.cy + vi.r);
    }
    return safeBox(b);
  }, { layers: opts.noChips ? null : layerMap });

  const at = new Map();
  for (const fp of pcb.footprints) at.set(fp.ref.toUpperCase(), { x: fp.cx, y: fp.cy });
  v.focus = (ref) => { const c = at.get(String(ref).toUpperCase()); if (!c) return false; v.centerOn(c.x, c.y, Math.max(v.home.w * 0.18, 12)); v.flash(c.x, c.y); return true; };
  return v;
}

function drawPrim(g, p, b) {
  const col = layerColor(p.layer);
  const W = Math.max(p.w || 0, 0.05);
  if (p.kind === 'line') {
    g.appendChild(svg('line', { x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, stroke: col, 'stroke-width': W, 'stroke-linecap': 'round', 'data-layer': p.layer }));
    grow(b, p.x1, p.y1); grow(b, p.x2, p.y2);
  } else if (p.kind === 'rect') {
    const x = Math.min(p.x1, p.x2), y = Math.min(p.y1, p.y2), w = Math.abs(p.x2 - p.x1), h = Math.abs(p.y2 - p.y1);
    g.appendChild(svg('rect', { x, y, width: w, height: h, fill: 'none', stroke: col, 'stroke-width': W, 'data-layer': p.layer }));
    grow(b, x, y); grow(b, x + w, y + h);
  } else if (p.kind === 'circle') {
    g.appendChild(svg('circle', { cx: p.cx, cy: p.cy, r: p.r, fill: 'none', stroke: col, 'stroke-width': W, 'data-layer': p.layer }));
    grow(b, p.cx - p.r, p.cy - p.r); grow(b, p.cx + p.r, p.cy + p.r);
  } else if (p.kind === 'arc') {
    const arc = arc3(p.x1, p.y1, p.xm, p.ym, p.x2, p.y2);
    if (arc) { g.appendChild(svg('path', { d: `M ${p.x1} ${p.y1} A ${arc.r} ${arc.r} 0 ${arc.large} ${arc.sweep} ${p.x2} ${p.y2}`, fill: 'none', stroke: col, 'stroke-width': W, 'stroke-linecap': 'round', 'data-layer': p.layer })); grow(b, p.x1, p.y1); grow(b, p.x2, p.y2); grow(b, p.xm, p.ym); }
  } else if (p.kind === 'poly') {
    const pts = p.pts.map((q) => q.join(',')).join(' ');
    g.appendChild(svg('polygon', { points: pts, fill: p.filled ? hexA(col, p.zone ? 0.18 : 0.5) : 'none', stroke: col, 'stroke-width': W, 'data-layer': p.layer }));
    for (const q of p.pts) grow(b, q[0], q[1]);
  }
}
function drawTrack(g, tk, b) {
  const col = layerColor(tk.layer), W = Math.max(tk.w, 0.05);
  if (tk.kind === 'line') {
    g.appendChild(svg('line', { x1: tk.x1, y1: tk.y1, x2: tk.x2, y2: tk.y2, stroke: col, 'stroke-width': W, 'stroke-linecap': 'round', 'data-layer': tk.layer }));
    grow(b, tk.x1, tk.y1); grow(b, tk.x2, tk.y2);
  } else {
    const arc = arc3(tk.x1, tk.y1, tk.xm, tk.ym, tk.x2, tk.y2);
    if (arc) { g.appendChild(svg('path', { d: `M ${tk.x1} ${tk.y1} A ${arc.r} ${arc.r} 0 ${arc.large} ${arc.sweep} ${tk.x2} ${tk.y2}`, fill: 'none', stroke: col, 'stroke-width': W, 'stroke-linecap': 'round', 'data-layer': tk.layer })); grow(b, tk.x1, tk.y1); grow(b, tk.x2, tk.y2); }
  }
}
function drawPad(g, pd, b) {
  const layerKey = pd.layers.includes('*.Cu') ? 'F.Cu' : (pd.layers.find((l) => /\.Cu$/.test(l)) || pd.layers[0] || 'F.Cu');
  let n;
  if (/circle/.test(pd.shape) || (pd.sx === pd.sy && /circle/.test(pd.shape))) {
    n = svg('ellipse', { cx: pd.cx, cy: pd.cy, rx: pd.sx / 2, ry: pd.sy / 2, fill: pd.color });
  } else {
    // rect / roundrect / oval - draw as a rotated rounded rect
    const rr = /round|oval/.test(pd.shape) ? Math.min(pd.sx, pd.sy) * (/oval/.test(pd.shape) ? 0.5 : 0.25) : 0;
    n = svg('rect', { x: pd.cx - pd.sx / 2, y: pd.cy - pd.sy / 2, width: pd.sx, height: pd.sy, rx: rr, fill: pd.color });
    if (pd.rot) n.setAttribute('transform', `rotate(${pd.rot} ${pd.cx} ${pd.cy})`);
  }
  n.setAttribute('data-layer', layerKey);
  g.appendChild(n);
  grow(b, pd.cx - pd.sx / 2, pd.cy - pd.sy / 2); grow(b, pd.cx + pd.sx / 2, pd.cy + pd.sy / 2);
  if (pd.drill > 0) g.appendChild(svg('circle', { cx: pd.cx, cy: pd.cy, r: pd.drill / 2, fill: '#0b0b0f' }));
  if (pd.num) { const t = svg('text', { x: pd.cx, y: pd.cy + Math.min(pd.sx, pd.sy) * 0.18, 'font-size': Math.min(pd.sx, pd.sy) * 0.45, fill: '#fff', 'text-anchor': 'middle', 'font-weight': 700, 'data-layer': layerKey }); t.textContent = pd.num; g.appendChild(t); }
}
function hexA(hex, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ===========================================================================
//  metadata helpers + single-file entry
// ===========================================================================
function metaCard(title, help, rows, file, extra) {
  const card = el('div', { class: 'anr-card' });
  const [h, hp] = h3help(title, help);
  card.appendChild(h); card.appendChild(hp);
  const tbl = el('table', { class: 'anr-readout' });
  for (const [k, val] of rows) if (val != null && val !== '') tbl.appendChild(row(k, String(val)));
  if (file) tbl.appendChild(sha256Row(file));
  card.appendChild(tbl);
  if (extra) card.appendChild(extra);
  return card;
}
function miniMeta(rows) {
  const tbl = el('table', { class: 'anr-readout' });
  for (const [k, val] of rows) if (val != null && val !== '') tbl.appendChild(row(k, String(val)));
  return tbl;
}
function padsTable(pads) {
  const tbl = el('table', { class: 'anr-readout anr-altium-pads' });
  tbl.appendChild(el('tr', {}, ['Pad', 'X (mm)', 'Y (mm)', 'Size (mm)', 'Drill', 'Type'].map((h) => el('th', {}, h))));
  for (const p of pads) {
    tbl.appendChild(el('tr', {}, [
      el('td', {}, String(p.num || '?')),
      el('td', {}, p.cx.toFixed(3)), el('td', {}, p.cy.toFixed(3)),
      el('td', {}, `${p.sx} × ${p.sy}`),
      el('td', {}, p.drill > 0 ? p.drill + ' mm' : '–'),
      el('td', {}, (p.shape || '?') + (p.drill > 0 ? ' THT' : ' SMD')),
    ]));
  }
  return tbl;
}

export async function renderKicad(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading KiCad file "${file.name}"…`));

  const name = file.name;
  // KiCad backups are "foo.kicad_sch-bak" etc. - treat them as the base type.
  const ext = (name.split('.').pop() || '').toLowerCase().replace(/-bak$/, '');
  const lower = name.toLowerCase();
  let text = '';
  try { text = await file.text(); } catch (_) {}
  resultsEl.innerHTML = '';

  try {
    if (ext === 'kicad_pro' || ext === 'kicad_prl') return renderProjectJson(file, text, resultsEl);
    if (lower === 'fp-info-cache') return renderFpCache(file, text, resultsEl);
    if (lower === 'fp-lib-table' || lower === 'sym-lib-table') return renderLibTable(file, text, resultsEl);
    if (ext === 'wbk') return renderWbk(file, text, resultsEl);

    const node = parseSexpr(text);
    const rootTag = tagOf(node);
    if (ext === 'kicad_sch' || rootTag === 'kicad_sch') return renderSchDoc(file, node, resultsEl);
    if (ext === 'kicad_pcb' || rootTag === 'kicad_pcb') return renderPcbDoc(file, node, resultsEl);
    if (ext === 'kicad_mod' || rootTag === 'footprint') return renderMod(file, node, resultsEl);
    if (ext === 'kicad_sym' || rootTag === 'kicad_symbol_lib' || ext === 'bak') return renderSymLib(file, node, resultsEl);
    resultsEl.appendChild(errorCard('This does not look like a recognised KiCad document.'));
  } catch (e) {
    resultsEl.appendChild(errorCard('Could not fully parse this KiCad file: ' + (e && e.message)));
  }
}

function renderSchDoc(file, node, resultsEl) {
  const parsed = parseSchematic(node);
  resultsEl.appendChild(metaCard('KiCad schematic', 'KiCad Eeschema schematic (.kicad_sch) - an S-expression document. The symbol graphics, wires and labels are parsed and rebuilt as a vector view in the browser.', [
    ['Format', 'KiCad schematic'],
    ['File', file.name],
    ['Size', fmtBytes(file.size)],
    ['Title', parsed.title],
    ['Sheet size', parsed.paper],
    ['File version', parsed.version],
    ['Components', parsed.instances.filter((i) => i.ref && !/^#/.test(i.ref)).length],
    ['Wires', parsed.wires.length],
    ['Labels', parsed.labels.length],
  ], file));

  const dcard = el('div', { class: 'anr-card' });
  dcard.appendChild(el('h3', {}, 'Schematic'));
  dcard.appendChild(schView(parsed).wrap);
  resultsEl.appendChild(dcard);

  const bom = bomFromInstances(parsed.instances);
  if (bom.length) resultsEl.appendChild(bomCard(bom, null, null));
}

function renderPcbDoc(file, node, resultsEl) {
  const pcb = parsePcb(node);
  const edge = pcb.prims.filter((p) => p.layer === 'Edge.Cuts');
  let bw = null, bh = null;
  if (edge.length) {
    const b = fitBox();
    for (const p of edge) { if (p.x1 != null) { grow(b, p.x1, p.y1); grow(b, p.x2, p.y2); } if (p.cx != null) { grow(b, p.cx - p.r, p.cy - p.r); grow(b, p.cx + p.r, p.cy + p.r); } if (p.pts) for (const q of p.pts) grow(b, q[0], q[1]); }
    if (Number.isFinite(b.minx)) { bw = b.maxx - b.minx; bh = b.maxy - b.miny; }
  }
  resultsEl.appendChild(metaCard('KiCad PCB', 'KiCad Pcbnew board (.kicad_pcb) - an S-expression document. Footprints, copper, vias, zones and the board outline are decoded from it and drawn to scale.', [
    ['Format', 'KiCad PCB'],
    ['File', file.name],
    ['Size', fmtBytes(file.size)],
    ['File version', pcb.version],
    ['Board thickness', pcb.thickness ? pcb.thickness + ' mm' : null],
    ['Board size', bw ? `${bw.toFixed(1)} × ${bh.toFixed(1)} mm` : null],
    ['Footprints', pcb.footprints.length],
    ['Pads', pcb.pads.length],
    ['Tracks', pcb.tracks.length],
    ['Vias', pcb.vias.length],
    ['Copper zones', pcb.zones || null],
  ], file));

  const dcard = el('div', { class: 'anr-card' });
  dcard.appendChild(el('h3', {}, 'Board'));
  dcard.appendChild(pcbView(pcb).wrap);
  resultsEl.appendChild(dcard);
}

function renderMod(file, node, resultsEl) {
  const fp = parseFootprint(node);
  const layers = new Set(fp.prims.map((p) => p.layer));
  resultsEl.appendChild(metaCard('KiCad footprint', 'A KiCad footprint module (.kicad_mod) - one footprint in S-expression form. Its pads and silkscreen/courtyard graphics are decoded and drawn to scale.', [
    ['Format', 'KiCad footprint'],
    ['File', file.name],
    ['Size', fmtBytes(file.size)],
    ['Footprint', fp.name],
    ['Description', fp.descr],
    ['Tags', fp.tags],
    ['Pads', fp.pads.length],
  ], file));
  if (fp.pads.length) { const c = el('div', { class: 'anr-card' }); c.appendChild(el('h3', {}, 'Pads')); c.appendChild(padsTable(fp.pads)); resultsEl.appendChild(c); }
  const dcard = el('div', { class: 'anr-card' });
  dcard.appendChild(el('h3', {}, 'Footprint'));
  dcard.appendChild(pcbView({ prims: fp.prims, pads: fp.pads, tracks: [], vias: [], footprints: [], zones: 0, layersUsed: layers }).wrap);
  resultsEl.appendChild(dcard);
}

function renderSymLib(file, node, resultsEl) {
  const syms = kids(node, 'symbol');
  resultsEl.appendChild(metaCard('KiCad symbol library', 'A KiCad symbol library (.kicad_sym) - a collection of schematic symbols in S-expression form. Each symbol is drawn from its graphic primitives.', [
    ['Format', 'KiCad symbol library'],
    ['File', file.name],
    ['Size', fmtBytes(file.size)],
    ['Symbols', syms.length],
  ], file));
  if (!syms.length) { resultsEl.appendChild(el('div', { class: 'anr-info' }, 'No symbols found.')); return; }

  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Symbol'));
  const sel = el('select', { class: 'anr-btn anr-kicad-select' });
  for (const sym of syms) sel.appendChild(el('option', { value: sym[1] }, sym[1]));
  card.appendChild(sel);
  const host = el('div', { class: 'anr-kicad-symhost' });
  card.appendChild(host);
  const drawSym = (symName) => {
    const sym = syms.find((s) => s[1] === symName);
    host.innerHTML = '';
    if (!sym) return;
    const prims = symbolGraphics(sym);
    const inst = { libId: symName, x: 0, y: 0, rot: 0, mirror: '', ref: '' };
    const parsed = { libs: { [symName]: prims }, instances: [inst], wires: [], buses: [], junctions: [], labels: [], noconns: [], texts: [] };
    host.appendChild(schView(parsed).wrap);
  };
  sel.addEventListener('change', () => drawSym(sel.value));
  drawSym(syms[0][1]);
  resultsEl.appendChild(card);
}

function renderProjectJson(file, text, resultsEl) {
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const isPrl = ext === 'kicad_prl';
  const meta = data && data.meta;
  const nets = data && data.net_settings && data.net_settings.classes;
  resultsEl.appendChild(metaCard(isPrl ? 'KiCad local settings' : 'KiCad project', 'KiCad ' + (isPrl ? 'per-user local settings (.kicad_prl)' : 'project file (.kicad_pro)') + ' - JSON holding the design rules, net classes, layer presets and tool state for the project.', [
    ['Format', isPrl ? 'KiCad local settings (.kicad_prl)' : 'KiCad project (.kicad_pro)'],
    ['File', file.name],
    ['Size', fmtBytes(file.size)],
    ['Schema version', meta && meta.version],
    ['Net classes', nets ? nets.length : null],
  ], file));

  if (nets && nets.length) {
    const card = el('div', { class: 'anr-card' });
    card.appendChild(el('h3', {}, 'Net classes'));
    const tbl = el('table', { class: 'anr-readout' });
    tbl.appendChild(el('tr', {}, ['Name', 'Track (mm)', 'Clearance (mm)', 'Via (mm)'].map((h) => el('th', {}, h))));
    for (const nc of nets) tbl.appendChild(el('tr', {}, [el('td', {}, nc.name || '—'), el('td', {}, fmtNum(nc.track_width)), el('td', {}, fmtNum(nc.clearance)), el('td', {}, fmtNum(nc.via_diameter))]));
    card.appendChild(tbl);
    resultsEl.appendChild(card);
  }
  resultsEl.appendChild(jsonCard(text));
}
const fmtNum = (v) => (v == null ? '—' : String(v));

// fp-info-cache is a line-based cache, NOT JSON: a leading hash line, then 7
// lines per footprint - nickname, name, description, keywords, then three
// numbers (the middle one is the pad count).
function parseFpCache(text) {
  const lines = text.split(/\r?\n/);
  const items = [];
  let i = 1;   // skip the leading hash/timestamp line
  while (i + 6 < lines.length) {
    const nick = lines[i];
    if (nick === '' && i + 7 >= lines.length) break;
    items.push({ nick, name: lines[i + 1], descr: lines[i + 2], keywords: lines[i + 3], pads: lines[i + 5] });
    i += 7;
  }
  return items;
}
function renderFpCache(file, text, resultsEl) {
  const items = parseFpCache(text);
  resultsEl.appendChild(metaCard('KiCad footprint cache', "KiCad's fp-info-cache - an index of every footprint in the project's libraries (nickname, name, description and pad count), so Pcbnew can list them without reparsing each .kicad_mod.", [
    ['Format', 'KiCad footprint info cache'],
    ['File', file.name],
    ['Size', fmtBytes(file.size)],
    ['Cached footprints', items.length || null],
  ], file));
  if (items.length) {
    const card = el('div', { class: 'anr-card' });
    card.appendChild(el('h3', {}, 'Cached footprints (first 200)'));
    const tbl = el('table', { class: 'anr-readout' });
    tbl.appendChild(el('tr', {}, ['Library', 'Name', 'Pads'].map((h) => el('th', {}, h))));
    for (const it of items.slice(0, 200)) tbl.appendChild(el('tr', {}, [el('td', {}, it.nick || '—'), el('td', {}, it.name || '—'), el('td', {}, /^\d+$/.test(it.pads || '') ? it.pads : '—')]));
    card.appendChild(tbl);
    if (items.length > 200) card.appendChild(el('p', { class: 'anr-hint' }, `… and ${items.length - 200} more.`));
    resultsEl.appendChild(card);
  }
}

function renderLibTable(file, text, resultsEl) {
  const node = parseSexpr(text);
  const libs = node ? kids(node, 'lib') : [];
  const isFp = /^fp/i.test(file.name);
  resultsEl.appendChild(metaCard('KiCad library table', 'A KiCad library table (' + (isFp ? 'fp-lib-table - footprints' : 'sym-lib-table - symbols') + ') - an S-expression list mapping library nicknames to their on-disk paths.', [
    ['Format', isFp ? 'KiCad footprint library table' : 'KiCad symbol library table'],
    ['File', file.name],
    ['Size', fmtBytes(file.size)],
    ['Libraries', libs.length],
  ], file));
  if (libs.length) {
    const card = el('div', { class: 'anr-card' });
    card.appendChild(el('h3', {}, 'Libraries'));
    const tbl = el('table', { class: 'anr-readout' });
    tbl.appendChild(el('tr', {}, ['Nickname', 'Type', 'URI'].map((h) => el('th', {}, h))));
    for (const lib of libs) tbl.appendChild(el('tr', {}, [el('td', {}, args(kid(lib, 'name'))[0] || '—'), el('td', {}, args(kid(lib, 'type'))[0] || '—'), el('td', {}, args(kid(lib, 'uri'))[0] || '—')]));
    card.appendChild(tbl);
    resultsEl.appendChild(card);
  }
}

function renderWbk(file, text, resultsEl) {
  // ngspice simulation workbook: directives + probe list, minimally interpreted.
  const lines = text.split(/\r?\n/);
  const directive = lines.find((l) => /^\.(tran|ac|dc|op|noise)/i.test(l.trim())) || '';
  const probes = lines.filter((l) => /^[VIvi]\(/.test(l.trim()));
  resultsEl.appendChild(metaCard('KiCad simulation workbook', 'A KiCad / ngspice simulation workbook (.wbk) - the saved SPICE analysis setup (the run directive and the probed signals) for the schematic simulator.', [
    ['Format', 'KiCad simulation workbook (.wbk)'],
    ['File', file.name],
    ['Size', fmtBytes(file.size)],
    ['Analysis', directive ? directive.trim().replace(/\{return\}.*/, '') : null],
    ['Probed signals', probes.length ? probes.map((p) => p.trim()).join(', ') : null],
  ], file));
  resultsEl.appendChild(sourceCard(text));
}

function sourceCard(text) {
  const c = el('div', { class: 'anr-card' });
  c.appendChild(el('h3', {}, 'Source'));
  const pre = el('pre', { class: 'anr-pagetext anr-code-src' });
  pre.textContent = text.slice(0, 8000);
  c.appendChild(pre);
  return c;
}
function jsonCard(text) {
  const c = el('div', { class: 'anr-card' });
  c.appendChild(el('h3', {}, 'Raw settings (JSON)'));
  const pre = el('pre', { class: 'anr-pagetext anr-code-src' });
  let pretty = text;
  try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch (_) {}
  pre.textContent = pretty.slice(0, 12000);
  c.appendChild(pre);
  return c;
}

// ---- BOM -------------------------------------------------------------------
function bomFromInstances(instances) {
  const out = [];
  for (const inst of instances) {
    if (!inst.ref || /^#/.test(inst.ref)) continue;       // skip power/hidden
    if (inst.inBom === false) continue;
    out.push(inst);
  }
  out.sort((a, b) => (a.ref || '~').localeCompare(b.ref || '~', undefined, { numeric: true }));
  return out;
}
// bomCard with optional cross-probe callbacks.
function bomCard(bom, onSch, onPcb) {
  const card = el('div', { class: 'anr-altium-bomwrap' });
  card.appendChild(el('h3', {}, 'Bill of materials'));
  const tbl = el('table', { class: 'anr-readout anr-altium-bom' });
  const head = ['Designator', 'Value', 'Footprint', 'Datasheet'];
  if (onPcb) head.push('On board');
  tbl.appendChild(el('tr', {}, head.map((h) => el('th', {}, h))));
  for (const inst of bom) {
    const ds = inst.datasheet && inst.datasheet !== '~' ? inst.datasheet : '';
    const desigBtn = el('button', { type: 'button', class: 'anr-btn anr-altium-desig' }, inst.ref);
    if (onSch) { desigBtn.title = 'Show ' + inst.ref + ' on the schematic'; desigBtn.addEventListener('click', () => onSch(inst.ref)); }
    else desigBtn.disabled = true;
    const cells = [
      el('td', {}, desigBtn),
      el('td', {}, inst.value || '—'),
      el('td', { class: 'anr-altium-bom-desc' }, inst.footprint || '—'),
      el('td', {}, /^https?:/i.test(ds) ? el('a', { href: ds, target: '_blank', rel: 'noopener' }, 'Open') : '—'),
    ];
    if (onPcb) {
      const pcbBtn = el('button', { type: 'button', class: 'anr-btn anr-altium-desig' }, 'PCB');
      pcbBtn.title = 'Show ' + inst.ref + ' on the board';
      pcbBtn.addEventListener('click', () => onPcb(inst.ref));
      cells.push(el('td', {}, pcbBtn));
    }
    tbl.appendChild(el('tr', {}, cells));
  }
  card.appendChild(tbl);
  return card;
}

// ===========================================================================
//  combined project view (folder drop)
// ===========================================================================
const base = (p) => p.split(/[\\/]/).pop();
const extOfName = (n) => (n.split('.').pop() || '').toLowerCase();

export function isKicadProjectFile(name) {
  const lower = base(name).toLowerCase();
  const ext = extOfName(lower);
  return /^kicad_(pcb|sch|sym|mod|pro|prl)$/.test(ext) || ext === 'wbk'
    || lower === 'fp-lib-table' || lower === 'sym-lib-table' || lower === 'fp-info-cache'
    || (ext === 'bak' && /kicad|sym/.test(lower));
}

export async function buildKicadProjectCard(kiFiles, folderName) {
  // Categorise.
  let proFile = null, schFile = null, pcbFile = null, symFile = null;
  const modFiles = [], tableFiles = [], otherFiles = [];
  for (const f of kiFiles) {
    const n = base(f.path), ext = extOfName(n), lower = n.toLowerCase();
    if (ext === 'kicad_pro') proFile = proFile || f;
    else if (ext === 'kicad_sch') { if (!schFile || f.path.length < schFile.path.length) schFile = f; }
    else if (ext === 'kicad_pcb') pcbFile = pcbFile || f;
    else if (ext === 'kicad_sym') symFile = symFile || f;
    else if (ext === 'kicad_mod') modFiles.push(f);
    else if (lower === 'fp-lib-table' || lower === 'sym-lib-table') tableFiles.push(f);
    else otherFiles.push(f);
  }

  // Parse the principal documents.
  let sch = null, pcb = null, pro = null;
  if (schFile) { try { sch = parseSchematic(parseSexpr(await schFile.file.text())); } catch (_) {} }
  if (pcbFile) { try { pcb = parsePcb(parseSexpr(await pcbFile.file.text())); } catch (_) {} }
  if (proFile) { try { pro = JSON.parse(await proFile.file.text()); } catch (_) {} }

  const bom = sch ? bomFromInstances(sch.instances) : [];

  // ---- card + tabs ----
  const card = el('div', { class: 'anr-card anr-altium-project' });
  card.appendChild(el('h3', {}, 'KiCad project'));
  card.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 12px;' },
    'Every document in this project, opened together. Click a designator in the bill of materials to jump to that part on the schematic - or its footprint on the board.'));
  const tabsBar = el('div', { class: 'anr-altium-tabs' });
  const panels = el('div', { class: 'anr-altium-tabwrap' });
  card.appendChild(tabsBar); card.appendChild(panels);

  const tabs = [];
  function addTab(label, buildFn) {
    const idx = tabs.length;
    const btn = el('button', { type: 'button', class: 'anr-btn anr-altium-tab' }, label);
    const panel = el('div', { class: 'anr-altium-tabpanel', hidden: '' });
    btn.addEventListener('click', () => setActive(idx));
    tabsBar.appendChild(btn); panels.appendChild(panel);
    tabs.push({ btn, panel, build: buildFn, built: false, view: null });
    return idx;
  }
  function setActive(i) {
    tabs.forEach((t, j) => { t.btn.classList.toggle('is-on', j === i); t.panel.hidden = j !== i; });
    const t = tabs[i];
    if (t && !t.built) { t.built = true; t.view = t.build(t.panel) || null; }
  }

  const overviewIdx = addTab('Overview', (panel) => buildOverview(panel));
  let schTab = -1, pcbTab = -1;
  if (sch) schTab = addTab(schFile ? base(schFile.path) : 'Schematic', (panel) => {
    panel.appendChild(miniMeta([['Title', sch.title], ['Components', bom.length], ['Wires', sch.wires.length]]));
    const v = schView(sch); panel.appendChild(v.wrap); return v;
  });
  if (pcb) pcbTab = addTab(pcbFile ? base(pcbFile.path) : 'PCB', (panel) => {
    panel.appendChild(miniMeta([['Footprints', pcb.footprints.length], ['Tracks', pcb.tracks.length], ['Vias', pcb.vias.length], ['Zones', pcb.zones || null]]));
    const v = pcbView(pcb); panel.appendChild(v.wrap); return v;
  });
  if (symFile) addTab(base(symFile.path), (panel) => { buildSymPanel(panel, symFile); });
  if (modFiles.length) addTab('Footprints (' + modFiles.length + ')', (panel) => buildModPanel(panel, modFiles));

  function crossSch(ref) { if (schTab < 0) return; setActive(schTab); const v = tabs[schTab].view; if (v && v.focus) v.focus(ref); tabsBar.scrollIntoView({ block: 'nearest' }); }
  function crossPcb(ref) { if (pcbTab < 0) return; setActive(pcbTab); const v = tabs[pcbTab].view; if (v && v.focus) v.focus(ref); tabsBar.scrollIntoView({ block: 'nearest' }); }

  function buildOverview(panel) {
    panel.appendChild(miniMeta([
      ['Project', (pro && pro.meta && pro.meta.filename) ? pro.meta.filename : folderName],
      ['Schematic', schFile ? base(schFile.path) : null],
      ['Board', pcbFile ? base(pcbFile.path) : null],
      ['Components', bom.length || null],
      ['Footprints on board', pcb ? pcb.footprints.length : null],
      ['Footprint modules', modFiles.length || null],
    ]));
    if (bom.length) panel.appendChild(bomCard(bom, schTab >= 0 ? crossSch : null, pcbTab >= 0 ? crossPcb : null));
    else panel.appendChild(el('div', { class: 'anr-info' }, 'No BOM components were found in the schematic.'));

    // library tables
    for (const tf of tableFiles) {
      let libs = [];
      // tables are tiny; read synchronously-ish via a promise into the table
      const tbl = el('table', { class: 'anr-readout' });
      tbl.appendChild(el('tr', {}, ['Nickname', 'Type', 'URI'].map((h) => el('th', {}, h))));
      panel.appendChild(el('h3', {}, base(tf.path)));
      panel.appendChild(tbl);
      tf.file.text().then((t) => {
        const nd = parseSexpr(t); libs = nd ? kids(nd, 'lib') : [];
        for (const lib of libs) tbl.appendChild(el('tr', {}, [el('td', {}, args(kid(lib, 'name'))[0] || '—'), el('td', {}, args(kid(lib, 'type'))[0] || '—'), el('td', {}, args(kid(lib, 'uri'))[0] || '—')]));
      }).catch(() => {});
    }

    // every file with its role
    panel.appendChild(el('h3', {}, 'Project files'));
    const filesT = el('table', { class: 'anr-readout' });
    panel.appendChild(filesT);
    for (const f of kiFiles) filesT.appendChild(row(roleOf(base(f.path)), base(f.path)));
  }

  function buildSymPanel(panel, sf) {
    panel.appendChild(inlineLoader('Reading symbol library…'));
    sf.file.text().then((t) => {
      panel.innerHTML = '';
      const syms = kids(parseSexpr(t), 'symbol');
      panel.appendChild(miniMeta([['Symbols', syms.length]]));
      if (!syms.length) return;
      const sel = el('select', { class: 'anr-btn anr-kicad-select' });
      for (const sym of syms) sel.appendChild(el('option', { value: sym[1] }, sym[1]));
      panel.appendChild(sel);
      const host = el('div', { class: 'anr-kicad-symhost' });
      panel.appendChild(host);
      const draw = (nm) => { const sym = syms.find((s) => s[1] === nm); host.innerHTML = ''; if (!sym) return; const parsed = { libs: { [nm]: symbolGraphics(sym) }, instances: [{ libId: nm, x: 0, y: 0, rot: 0, mirror: '', ref: '' }], wires: [], buses: [], junctions: [], labels: [], noconns: [], texts: [] }; host.appendChild(schView(parsed).wrap); };
      sel.addEventListener('change', () => draw(sel.value));
      draw(syms[0][1]);
    }).catch(() => { panel.innerHTML = ''; panel.appendChild(el('div', { class: 'anr-info' }, 'Could not read the symbol library.')); });
  }

  function buildModPanel(panel, mods) {
    const sel = el('select', { class: 'anr-btn anr-kicad-select' });
    for (const m of mods) sel.appendChild(el('option', { value: m.path }, base(m.path).replace(/\.kicad_mod$/i, '')));
    panel.appendChild(sel);
    const host = el('div', { class: 'anr-kicad-symhost' });
    panel.appendChild(host);
    const draw = (p) => {
      const mf = mods.find((m) => m.path === p);
      host.innerHTML = '';
      host.appendChild(inlineLoader('Reading footprint…'));
      mf.file.text().then((t) => {
        host.innerHTML = '';
        const fp = parseFootprint(parseSexpr(t));
        host.appendChild(miniMeta([['Footprint', fp.name], ['Description', fp.descr], ['Pads', fp.pads.length]]));
        if (fp.pads.length) host.appendChild(padsTable(fp.pads));
        host.appendChild(pcbView({ prims: fp.prims, pads: fp.pads, tracks: [], vias: [], footprints: [], zones: 0, layersUsed: new Set(fp.prims.map((q) => q.layer)) }).wrap);
      }).catch(() => { host.innerHTML = ''; host.appendChild(el('div', { class: 'anr-info' }, 'Could not read this footprint.')); });
    };
    sel.addEventListener('change', () => draw(sel.value));
    draw(mods[0].path);
  }

  setActive(overviewIdx);
  return card;
}

function roleOf(n) {
  const ext = extOfName(n), lower = n.toLowerCase();
  if (ext === 'kicad_pro') return 'Project';
  if (ext === 'kicad_prl') return 'Local settings';
  if (ext === 'kicad_sch') return 'Schematic';
  if (ext === 'kicad_pcb') return 'PCB';
  if (ext === 'kicad_sym') return 'Symbol library';
  if (ext === 'kicad_mod') return 'Footprint';
  if (ext === 'wbk') return 'Simulation workbook';
  if (ext === 'bak') return 'Backup';
  if (ext === 'stp' || ext === 'step') return '3D model';
  if (lower === 'fp-lib-table') return 'Footprint lib table';
  if (lower === 'sym-lib-table') return 'Symbol lib table';
  if (lower === 'fp-info-cache') return 'Footprint cache';
  if (ext === 'md') return 'Readme';
  return 'File';
}
