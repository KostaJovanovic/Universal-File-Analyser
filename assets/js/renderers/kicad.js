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
// A field's (effects) hide flag: KiCad 7+ writes (hide yes); older writes a bare
// `hide` token in the effects list.
function isHidden(eff) {
  if (!eff) return false;
  for (const c of eff) {
    if (c === 'hide') return true;
    if (isNode(c) && c[0] === 'hide') return args(c)[0] !== 'no';
  }
  return false;
}
// Visible symbol property fields (Reference, Value, ...) with their own placed
// position, so they render where KiCad puts them rather than a guessed offset.
function symFields(node) {
  const out = [];
  for (const x of node || []) {
    if (!isNode(x) || x[0] !== 'property') continue;
    const p = atOf(x), eff = kid(x, 'effects');
    out.push({ key: x[1], value: x[2], x: p ? p.x : 0, y: p ? p.y : 0, rot: p ? p.rot : 0,
      hide: isHidden(eff), size: numAt(kid(kid(eff || [], 'font') || [], 'size'), 0, 1.27),
      justify: args(kid(eff || [], 'justify')) });
  }
  return out;
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
  ref: '#7a3600', val: '#125a4a', noconn: '#b01020', frame: '#2a3340', gfx: '#2c4a86',
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
  // SVG sweep flag. Coords are board-space (Y-down, no flip), so a positive
  // start->mid->end turn is clockwise on screen = SVG's positive (sweep=1)
  // direction. The old `cross < 0 ? 1 : 0` was inverted, so every arc (rounded
  // board corners, the perimeter copper/mask frame, arc tracks) bulged the wrong
  // way - verified against the true mid point of each corner arc.
  const sweep = cross < 0 ? 0 : 1;
  const large = isLargeArc(ax, ay, bx, by, ux, uy) ? 1 : 0;
  return { r, sweep, large };
}
// KiCad's mid point bisects the arc, so the total sweep is twice the centre angle
// between start and mid. acos depends only on lengths/dot product, so it is
// mirror-invariant - the Bottom view negates X, and the old fixed-direction span
// calculation then misread every mirrored minor corner arc as the 270 major arc
// (corners ballooned into full loops). This stays correct in both orientations.
function isLargeArc(ax, ay, bx, by, ux, uy) {
  const r2 = (ax - ux) ** 2 + (ay - uy) ** 2;
  if (r2 < 1e-12) return false;
  const dot = (ax - ux) * (bx - ux) + (ay - uy) * (by - uy);
  const half = Math.acos(Math.max(-1, Math.min(1, dot / r2)));
  return 2 * half > Math.PI;
}

// ===========================================================================
//  SCHEMATIC
// ===========================================================================
// Collect the drawable graphics of a library symbol (recursively, across its
// unit sub-symbols). Returns primitives in symbol-local (Y-up) coordinates.
function symbolGraphics(symNode) {
  const prims = [];
  // Pin number/name visibility is a symbol-level setting; the offset positions
  // the name relative to the pin's body end. (Sub-units inherit these.)
  const pnNode = kid(symNode, 'pin_numbers'), nmNode = kid(symNode, 'pin_names');
  const numbersHidden = isHidden(pnNode), namesHidden = isHidden(nmNode);
  const nameOffset = nmNode ? numAt(kid(nmNode, 'offset'), 0, 0.508) : 0.508;
  const fontOf = (node, dflt) => numAt(kid(kid(node || [], 'font') || [], 'size'), 0, dflt);
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
        const nameN = kid(x, 'name'), numN = kid(x, 'number');
        const name = nameN ? nameN[1] : '', number = numN ? numN[1] : '';
        const pinHidden = isHidden(x);           // (pin ... (hide yes)) - power pins; KiCad draws nothing
        prims.push({ kind: 'pin', x: p ? p.x : 0, y: p ? p.y : 0, rot: p ? p.rot : 0, len: numAt(kid(x, 'length'), 0, 2.54),
          name, number, nameOffset, hidden: pinHidden,
          showNum: !!number && !pinHidden && !numbersHidden && !isHidden(kid(numN || [], 'effects')),
          showName: !!name && name !== '~' && !pinHidden && !namesHidden && !isHidden(kid(nameN || [], 'effects')),
          numSize: fontOf(kid(numN || [], 'effects'), 1.27), nameSize: fontOf(kid(nameN || [], 'effects'), 1.27) });
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
  const wires = [], buses = [], junctions = [], labels = [], noconns = [], texts = [], graphics = [];
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
        dnp: (args(kid(x, 'dnp'))[0] === 'yes'),
        unit: numAt(kid(x, 'unit'), 0, 1), fields: symFields(x),
      });
    } else if (t === 'wire') { wires.push(ptsOf(x)); }
    else if (t === 'bus') { buses.push(ptsOf(x)); }
    else if (t === 'junction') { const p = atOf(x); if (p) junctions.push(p); }
    else if (t === 'label' || t === 'global_label' || t === 'hierarchical_label') {
      const p = atOf(x); if (p) labels.push({ x: p.x, y: p.y, rot: p.rot, text: x[1], kind: t });
    } else if (t === 'no_connect') { const p = atOf(x); if (p) noconns.push(p); }
    else if (t === 'text') { const p = atOf(x); if (p) texts.push({ x: p.x, y: p.y, rot: p.rot, text: x[1] }); }
    // Root-level graphic items (the grouping boxes drawn on the sheet) - sheet
    // space (Y-down), so no symbol placement transform needed.
    else if (t === 'rectangle' || t === 'polyline' || t === 'bezier' || t === 'circle' || t === 'arc') {
      const s = schShape(x, t); if (s) graphics.push(s);
    }
  }

  const tb = titleBlock(rootNode);
  const paperRaw = args(kid(rootNode, 'paper'));
  return { libs, instances, wires, buses, junctions, labels, noconns, texts, graphics,
    title: tb.title, rev: tb.rev, date: tb.date, company: tb.company,
    version: args(kid(rootNode, 'version'))[0], paper: paperRaw[0], paperRaw };
}
// Read a schematic graphic shape (shared by symbol bodies and root-level sheet
// graphics). Coordinates are returned as-is; the caller decides the space.
function schShape(x, t) {
  if (t === 'rectangle') { const a = kid(x, 'start'), b = kid(x, 'end'); return (a && b) ? { kind: 'rect', x1: numAt(a, 0), y1: numAt(a, 1), x2: numAt(b, 0), y2: numAt(b, 1), fill: fillType(x) } : null; }
  if (t === 'polyline' || t === 'bezier') return { kind: 'poly', pts: ptsOf(x), fill: fillType(x) };
  if (t === 'circle') { const c = kid(x, 'center'); return { kind: 'circle', cx: numAt(c, 0), cy: numAt(c, 1), r: numAt(kid(x, 'radius'), 0), fill: fillType(x) }; }
  if (t === 'arc') { const a = kid(x, 'start'), m = kid(x, 'mid'), e = kid(x, 'end'); return (a && m && e) ? { kind: 'arc', x1: numAt(a, 0), y1: numAt(a, 1), xm: numAt(m, 0), ym: numAt(m, 1), x2: numAt(e, 0), y2: numAt(e, 1) } : null; }
  return null;
}
function titleBlock(rootNode) {
  const tb = kid(rootNode, 'title_block');
  if (!tb) return {};
  return { title: args(kid(tb, 'title'))[0] || '', rev: args(kid(tb, 'rev'))[0] || '',
    date: args(kid(tb, 'date'))[0] || '', company: args(kid(tb, 'company'))[0] || '' };
}

// KiCad paper sizes in mm (landscape width x height); portrait swaps them, and
// "User w h" carries explicit dimensions. KiCad draws the sheet frame + title
// block from this (the .kicad_sch stores no frame geometry), so we synthesise it.
const PAPER_MM = {
  A0: [1189, 841], A1: [841, 594], A2: [594, 420], A3: [420, 297], A4: [297, 210], A5: [210, 148],
  A: [279.4, 215.9], B: [431.8, 279.4], C: [558.8, 431.8], D: [863.6, 558.8], E: [1117.6, 863.6],
  USLetter: [279.4, 215.9], USLegal: [355.6, 215.9], USLedger: [431.8, 279.4],
};
function paperSize(raw) {
  if (!raw || !raw.length) return null;
  const name = raw[0];
  if (name === 'User') { const w = parseFloat(raw[1]), h = parseFloat(raw[2]); return (w > 0 && h > 0) ? [w, h] : null; }
  const base = PAPER_MM[name];
  if (!base) return null;
  return raw.includes('portrait') ? [base[1], base[0]] : [base[0], base[1]];
}
// The drawing frame (page edge + inset border) and title block, in sheet space
// (origin top-left, Y-down) - matching how KiCad renders the worksheet.
function drawSheetFrame(g, W, H, parsed, b) {
  const M = 10, ink = SCH.frame;                                   // KiCad default 10mm margin
  g.appendChild(svg('rect', { x: 0, y: 0, width: W, height: H, fill: 'none', stroke: ink, 'stroke-width': 0.15, opacity: 0.45 }));
  g.appendChild(svg('rect', { x: M, y: M, width: W - 2 * M, height: H - 2 * M, fill: 'none', stroke: ink, 'stroke-width': 0.3 }));
  // Title block: bottom-right, inside the frame, rows stacked upward.
  const rows = [];
  if (parsed.title) rows.push(['Title', parsed.title]);
  if (parsed.company) rows.push(['', parsed.company]);
  if (parsed.date) rows.push(['Date', parsed.date]);
  rows.push(['Rev', parsed.rev || '-'], ['Size', parsed.paper || '']);
  const tbw = Math.min(110, (W - 2 * M) * 0.62), rowH = 5, nh = rows.length * rowH;
  const x0 = W - M - tbw, y0 = H - M - nh;
  g.appendChild(svg('rect', { x: x0, y: y0, width: tbw, height: nh, fill: SCH.bgFill, stroke: ink, 'stroke-width': 0.3 }));
  rows.forEach((r, i) => {
    const ry = y0 + i * rowH;
    if (i > 0) g.appendChild(svg('line', { x1: x0, y1: ry, x2: x0 + tbw, y2: ry, stroke: ink, 'stroke-width': 0.12 }));
    const t = svg('text', { x: x0 + 1.6, y: ry + rowH * 0.68, 'font-size': 2.3, fill: ink });
    t.textContent = r[0] ? `${r[0]}: ${r[1]}` : r[1];
    g.appendChild(t);
  });
  grow(b, 0, 0); grow(b, W, H);
}
// A root-level sheet graphic (grouping box / outline) in sheet space.
function drawSchGraphic(g, gr, b) {
  const col = SCH.gfx, W = 0.15;
  if (gr.kind === 'rect') {
    const x = Math.min(gr.x1, gr.x2), y = Math.min(gr.y1, gr.y2), w = Math.abs(gr.x2 - gr.x1), h = Math.abs(gr.y2 - gr.y1);
    g.appendChild(svg('rect', { x, y, width: w, height: h, fill: gr.fill === 'background' ? SCH.bgFill : 'none', stroke: col, 'stroke-width': W }));
    grow(b, x, y); grow(b, x + w, y + h);
  } else if (gr.kind === 'poly') {
    if (gr.pts.length < 2) return;
    g.appendChild(svg('polyline', { points: gr.pts.map((p) => p.join(',')).join(' '), fill: gr.fill === 'background' ? SCH.bgFill : 'none', stroke: col, 'stroke-width': W }));
    for (const p of gr.pts) grow(b, p[0], p[1]);
  } else if (gr.kind === 'circle') {
    g.appendChild(svg('circle', { cx: gr.cx, cy: gr.cy, r: gr.r, fill: 'none', stroke: col, 'stroke-width': W }));
    grow(b, gr.cx - gr.r, gr.cy - gr.r); grow(b, gr.cx + gr.r, gr.cy + gr.r);
  } else if (gr.kind === 'arc') {
    const arc = arc3(gr.x1, gr.y1, gr.xm, gr.ym, gr.x2, gr.y2);
    if (arc) { g.appendChild(svg('path', { d: `M ${gr.x1} ${gr.y1} A ${arc.r} ${arc.r} 0 ${arc.large} ${arc.sweep} ${gr.x2} ${gr.y2}`, fill: 'none', stroke: col, 'stroke-width': W })); grow(b, gr.x1, gr.y1); grow(b, gr.x2, gr.y2); }
  }
}

// A symbol property field (Reference/Value/...) drawn at its placed sheet
// position, anchored per KiCad's justify, skipping hidden + power-symbol refs.
function drawSchField(g, f, b) {
  if (f.hide || f.value == null || f.value === '' || f.value === '~') return;
  if (f.key === 'Reference' && /^#/.test(f.value)) return;       // power/hidden pseudo-refs
  if (f.key !== 'Reference' && f.key !== 'Value') return;        // KiCad hides the rest by default
  const col = f.key === 'Reference' ? SCH.ref : SCH.val;
  const a = { x: f.x, y: f.y, 'font-size': f.size || 1.27, fill: col, 'dominant-baseline': 'central' };
  a['text-anchor'] = f.justify.includes('right') ? 'end' : f.justify.includes('left') ? 'start' : 'middle';
  if (f.rot === 90 || f.rot === 270) a.transform = `rotate(${-f.rot} ${f.x} ${f.y})`;
  const t = svg('text', a); t.textContent = f.value; g.appendChild(t);
  grow(b, f.x, f.y);
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
    // sheet frame + title block (behind everything), synthesised from the paper size
    const page = paperSize(parsed.paperRaw);
    if (page) drawSheetFrame(g, page[0], page[1], parsed, b);
    // root-level sheet graphics (grouping boxes) - behind the circuit
    for (const gr of parsed.graphics) drawSchGraphic(g, gr, b);
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
      // visible property fields (Reference, Value, ...) at their placed positions
      for (const f of (inst.fields || [])) drawSchField(g, f, b);
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
    if (pr.hidden) return;                   // hidden pins (e.g. power) draw nothing in KiCad
    // pin extends from its origin (connection tip) along its rotation, into the
    // body (symbol Y-up space).
    const [ex, ey] = rot(pr.len, 0, pr.rot);
    const o = placeSym(inst, pr.x, pr.y), t = placeSym(inst, pr.x + ex, pr.y + ey);
    g.appendChild(svg('line', { x1: o[0], y1: o[1], x2: t[0], y2: t[1], stroke: SCH.pin, 'stroke-width': 0.15 }));
    grow(b, o[0], o[1]); grow(b, t[0], t[1]);
    // pin number: near the middle of the pin, nudged to the screen-up side.
    if (pr.showNum) {
      const mx = pr.x + ex * 0.5, my = pr.y + ey * 0.5, [px, py] = rot(0, 0.8, pr.rot);
      const c1 = placeSym(inst, mx + px, my + py), c2 = placeSym(inst, mx - px, my - py);
      pinText(g, c1[1] < c2[1] ? c1 : c2, pr.number, Math.min(pr.numSize, 1.2), SCH.pin, b);
    }
    // pin name: offset from the body end further into the body, along the pin.
    if (pr.showName) {
      const [ux, uy] = rot(1, 0, pr.rot), off = pr.nameOffset > 0 ? pr.nameOffset + 0.3 : 0.6;
      pinText(g, placeSym(inst, pr.x + ex + ux * off, pr.y + ey + uy * off), pr.name, Math.min(pr.nameSize, 1.2), SCH.body, b);
    }
  }
}
// A small centred pin label (number/name) at a placed sheet position.
function pinText(g, pos, str, size, col, b) {
  const t = svg('text', { x: pos[0], y: pos[1], 'font-size': size, fill: col, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
  t.textContent = str; g.appendChild(t); grow(b, pos[0], pos[1]);
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
  // Rotation: KiCad's RotatePoint(+a) maps (x,y)->(x*cos+y*sin, -x*sin+y*cos),
  // which is our rot() called with -a (rot() is the opposite-handed matrix).
  // Using +orot here rotated the wrong way for any non-symmetric part at a
  // non-0/180 angle, so we pass -orot to match KiCad exactly.
  // A footprint placed on the back of the board (its own (layer ...) is a B.*
  // layer) is drawn mirrored when viewed from the top. KiCad stores the child
  // geometry un-mirrored (side comes only from the layer), so we mirror about the
  // vertical axis through the footprint origin - negate the rotated X offset -
  // which is KiCad's "mirror local X + negate orientation" flip. Without this,
  // bottom-side components render flipped (pin 1 on the wrong side, asymmetric
  // outlines back-to-front).
  const flip = /^B\./.test(args(kid(fpNode, 'layer'))[0] || '');
  const place = (lx, ly) => { const [rx, ry] = rot(lx, ly, -orot); return [ox + (flip ? -rx : rx), oy + ry]; };
  const ref = propVal(fpNode, 'Reference'), value = propVal(fpNode, 'Value');
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
      const drillNode = kid(x, 'drill');
      let drillX = 0, drillY = 0;
      if (drillNode) {                                  // round: (drill D)  slot: (drill oval X Y)
        const da = args(drillNode);
        if (da[0] === 'oval') { drillX = parseFloat(da[1]) || 0; drillY = parseFloat(da[2]) || 0; }
        else drillX = parseFloat(da[0]) || 0;
      }
      const c = place(p ? p.x : 0, p ? p.y : 0);
      // SVG rotate() is clockwise-positive; KiCad orients the pad CCW by
      // (footprint + pad) angle, so we negate it - and flip the sign again on the
      // back, where the board mirror reverses the handedness.
      pads.push({
        num: x[1], cx: c[0], cy: c[1], sx: numAt(size, 0), sy: numAt(size, 1),
        rot: (flip ? 1 : -1) * (orot + padrot), shape: shapeWord || 'rect', type: shape,
        drill: drillX, drillY, layers: layerList,
        rratio: numAt(kid(x, 'roundrect_rratio'), 0, 0.25),   // per-pad corner ratio (default 0.25, 0..0.5)
        color: padColor(layerList),
      });
    } else if (t === 'fp_line' || t === 'fp_rect' || t === 'fp_circle' || t === 'fp_arc' || t === 'fp_poly') {
      addGraphic(prims, x, t.slice(3), place);
    }
  }
  return { prims, pads, ref, value,
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

// Sample a circular arc (through a -> mid -> b) into a polyline (excludes a,
// includes b). Falls back to a straight step if the points are collinear.
function arcPoints(a, m, b, n) {
  const [ax, ay] = a, [mx, my] = m, [bx, by] = b;
  const d = 2 * (ax * (my - by) + mx * (by - ay) + bx * (ay - my));
  if (Math.abs(d) < 1e-9) return [b];
  const ux = ((ax * ax + ay * ay) * (my - by) + (mx * mx + my * my) * (by - ay) + (bx * bx + by * by) * (ay - my)) / d;
  const uy = ((ax * ax + ay * ay) * (bx - mx) + (mx * mx + my * my) * (ax - bx) + (bx * bx + by * by) * (mx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy), TWO = 2 * Math.PI, norm = (t) => ((t % TWO) + TWO) % TWO;
  const a0 = Math.atan2(ay - uy, ax - ux), a1 = Math.atan2(by - uy, bx - ux), am = Math.atan2(my - uy, mx - ux);
  const ccw = norm(am - a0) < norm(a1 - a0), span = ccw ? norm(a1 - a0) : -norm(a0 - a1);
  const out = [];
  for (let i = 1; i <= n; i++) { const t = a0 + span * (i / n); out.push([ux + r * Math.cos(t), uy + r * Math.sin(t)]); }
  return out;
}
// Stitch the Edge.Cuts primitives into one closed outline polyline (board coords).
// Returns { pts, bbox } or null. The polyline drives the face clip, the board
// substrate and the extruded edge wall, so they all share the exact silhouette -
// including rounded corners and round/arbitrary boards.
let _pcbClipSeq = 0;
function boardOutline(prims) {
  const edges = prims.filter((p) => p.layer === 'Edge.Cuts');
  if (!edges.length) return null;
  const circ = edges.length === 1 && edges[0].kind === 'circle' ? edges[0] : null;
  if (circ) {
    const pts = [];
    for (let i = 0; i < 72; i++) { const t = i / 72 * 2 * Math.PI; pts.push([circ.cx + circ.r * Math.cos(t), circ.cy + circ.r * Math.sin(t)]); }
    return { pts, bbox: { minx: circ.cx - circ.r, miny: circ.cy - circ.r, maxx: circ.cx + circ.r, maxy: circ.cy + circ.r } };
  }
  const segs = [];
  for (const p of edges) {
    if (p.kind === 'line') segs.push({ a: [p.x1, p.y1], b: [p.x2, p.y2], arc: false });
    else if (p.kind === 'arc') segs.push({ a: [p.x1, p.y1], b: [p.x2, p.y2], mid: [p.xm, p.ym], arc: true });
    else if (p.kind === 'rect') {
      const x0 = Math.min(p.x1, p.x2), x1 = Math.max(p.x1, p.x2), y0 = Math.min(p.y1, p.y2), y1 = Math.max(p.y1, p.y2);
      segs.push({ a: [x0, y0], b: [x1, y0], arc: false }, { a: [x1, y0], b: [x1, y1], arc: false }, { a: [x1, y1], b: [x0, y1], arc: false }, { a: [x0, y1], b: [x0, y0], arc: false });
    }
  }
  if (!segs.length) return null;
  const used = new Array(segs.length).fill(false), eq = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.05;
  const stepPts = (s, rev) => {
    const from = rev ? s.b : s.a, to = rev ? s.a : s.b;
    return s.arc ? arcPoints(from, s.mid, to, 6) : [to];
  };
  used[0] = true; const start = segs[0].a; let pt = segs[0].b;
  const pts = [segs[0].a, ...stepPts(segs[0], false)];
  const bb = fitBox();
  for (const s of segs) { grow(bb, s.a[0], s.a[1]); grow(bb, s.b[0], s.b[1]); if (s.mid) grow(bb, s.mid[0], s.mid[1]); }
  for (let guard = 0; guard < segs.length + 2 && !eq(pt, start); guard++) {
    let found = -1, rev = false;
    for (let i = 0; i < segs.length; i++) { if (used[i]) continue; if (eq(segs[i].a, pt)) { found = i; rev = false; break; } if (eq(segs[i].b, pt)) { found = i; rev = true; break; } }
    if (found < 0) break;                       // open outline - bail (caller falls back)
    used[found] = true; const s = segs[found];
    pts.push(...stepPts(s, rev)); pt = rev ? s.a : s.b;
  }
  if (!eq(pt, start)) return null;              // didn't close - not a usable silhouette
  return { pts, bbox: safeBox(bb) };
}

// Paint a parsed board into an SVG <g> (shared by the flat viewer and the 3D
// faces). Returns the geometry bbox. Order matters: copper pours first, then
// board/footprint graphics, tracks, pads, vias on top. With opts.substrate the
// board is drawn as its real Edge.Cuts silhouette (filled + soft shadow) and all
// content is clipped to it, so nothing spills past the board edge (the 3D faces).
function paintBoard(g, pcb, opts = {}) {
  const b = fitBox();
  const holes = [], labels = [];   // drilled last so a hole cuts through every overlapping pad
  let host = g;
  if (opts.substrate && opts.outline) {
    const ptsStr = opts.outline.pts.map((p) => `${p[0]},${p[1]}`).join(' ');
    // Substrate + clip, no SVG filter: feDropShadow on a supersampled face is
    // expensive to rasterise (and can force per-frame re-raster), so the board edge
    // is defined by a plain stroke + the FR4 walls instead - much cheaper.
    const n = ++_pcbClipSeq, clip = 'anr-pcb-clip-' + n;
    const defs = svg('defs', {});
    const cp = svg('clipPath', { id: clip }); cp.appendChild(svg('polygon', { points: ptsStr })); defs.appendChild(cp);
    g.appendChild(defs);
    g.appendChild(svg('polygon', { points: ptsStr, fill: '#f4f0e6', stroke: 'rgba(40,60,40,0.55)', 'stroke-width': 0.25 }));
    host = svg('g', { 'clip-path': `url(#${clip})` }); g.appendChild(host);
  }
  for (const p of pcb.prims) if (p.kind === 'poly' && p.zone) drawPrim(host, p, b);
  for (const p of pcb.prims) if (!(p.kind === 'poly' && p.zone)) drawPrim(host, p, b);
  for (const tk of pcb.tracks) drawTrack(host, tk, b);
  for (const pd of pcb.pads) drawPad(host, pd, b, holes, labels);
  for (const vi of pcb.vias) {
    host.appendChild(svg('circle', { cx: vi.cx, cy: vi.cy, r: vi.r, fill: '#a87800', 'data-layer': 'F.Cu' }));
    holes.push({ cx: vi.cx, cy: vi.cy, rx: vi.drill / 2, ry: vi.drill / 2, rot: 0 });
    grow(b, vi.cx - vi.r, vi.cy - vi.r); grow(b, vi.cx + vi.r, vi.cy + vi.r);
  }
  for (const h of holes) drawHole(host, h);      // punch holes through all copper
  for (const t of labels) host.appendChild(t);   // pad numbers sit on top of the holes
  const box = safeBox(b);
  if (opts.substrate && !opts.outline) {         // no Edge.Cuts: fall back to a rectangular board
    const r = svg('rect', { x: box.minx, y: box.miny, width: box.maxx - box.minx, height: box.maxy - box.miny, fill: '#f4f0e6', stroke: 'rgba(40,60,40,0.4)', 'stroke-width': 0.18 });
    g.insertBefore(r, g.firstChild);
  }
  return box;
}
// A plated/unplated hole, drawn after all copper so it reads as a real drill.
function drawHole(g, h) {
  if (h.ry > 0 && Math.abs(h.ry - h.rx) > 1e-6) {     // slot (oval drill)
    const n = svg('rect', { x: h.cx - h.rx, y: h.cy - h.ry, width: h.rx * 2, height: h.ry * 2, rx: Math.min(h.rx, h.ry), fill: '#0b0b0f' });
    if (h.rot) n.setAttribute('transform', `rotate(${h.rot} ${h.cx} ${h.cy})`);
    g.appendChild(n);
  } else if (h.rx > 0) {
    g.appendChild(svg('circle', { cx: h.cx, cy: h.cy, r: h.rx, fill: '#0b0b0f' }));
  }
}

function pcbView(pcb, opts = {}) {
  // Build a layer->colour map for the toggle chips (only layers that drew).
  const layerMap = new Map();
  for (const ly of [...pcb.layersUsed].sort()) layerMap.set(ly, layerColor(ly));

  const v = buildViewer((g) => paintBoard(g, pcb), { layers: opts.noChips ? null : layerMap });

  const at = new Map();
  for (const fp of pcb.footprints) at.set(fp.ref.toUpperCase(), { x: fp.cx, y: fp.cy });
  v.focus = (ref) => { const c = at.get(String(ref).toUpperCase()); if (!c) return false; v.centerOn(c.x, c.y, Math.max(v.home.w * 0.18, 12)); v.flash(c.x, c.y); return true; };
  return v;
}

// ---- board sides (for the 3D flip + the Top/Bottom flat views) -------------
// Which side of the board a layer lives on. Through features (Edge.Cuts, vias,
// plated holes) belong to both; inner copper and documentation default to top.
function sideOfLayer(layer) {
  if (!layer) return 'top';
  if (/^B\./.test(layer)) return 'bottom';
  if (layer === 'Edge.Cuts') return 'both';
  return 'top';
}
function padSide(pd) {
  if (pd.drill > 0) return 'both';                      // plated through-hole
  const L = pd.layers || [];
  if (L.includes('*.Cu')) return 'both';
  if (L.some((l) => /^B\./.test(l)) && !L.some((l) => /^F\./.test(l))) return 'bottom';
  return 'top';
}
// A copy of the board holding only the geometry on one side (keeping the
// through/outline features so the silhouette and holes show on both faces).
function sidePcb(pcb, side) {
  const keep = (layer) => { const s = sideOfLayer(layer); return s === 'both' || s === side; };
  const prims = pcb.prims.filter((p) => keep(p.layer));
  const tracks = pcb.tracks.filter((t) => keep(t.layer));
  const pads = pcb.pads.filter((p) => { const s = padSide(p); return s === 'both' || s === side; });
  const layersUsed = new Set();
  for (const p of prims) layersUsed.add(p.layer);
  for (const t of tracks) layersUsed.add(t.layer);
  for (const pd of pads) for (const ly of pd.layers || []) if (ly !== '*.Mask' && ly !== '*.Paste') layersUsed.add(ly === '*.Cu' ? (side === 'bottom' ? 'B.Cu' : 'F.Cu') : ly);
  return { prims, pads, tracks, vias: pcb.vias, footprints: pcb.footprints, zones: pcb.zones, layersUsed, thickness: pcb.thickness, version: pcb.version };
}
// Mirror a board left-right (reflect every X about cx, negate pad rotation) so a
// bottom side reads correctly (silk forward, left/right as physically flipped).
// cx defaults to 0 for the standalone flat view; the 3D back face passes the
// board centre so the mirrored bottom still lines up with the front face.
function mirrorXPcb(pcb, cx = 0) {
  const mx = (v) => 2 * cx - v;
  const mp = (p) => {
    const q = { ...p };
    if (q.x1 != null) q.x1 = mx(q.x1);
    if (q.x2 != null) q.x2 = mx(q.x2);
    if (q.xm != null) q.xm = mx(q.xm);
    if (q.cx != null) q.cx = mx(q.cx);
    if (q.pts) q.pts = q.pts.map(([x, y]) => [mx(x), y]);
    return q;
  };
  return {
    prims: pcb.prims.map(mp), tracks: pcb.tracks.map(mp),
    pads: pcb.pads.map((pd) => ({ ...pd, cx: mx(pd.cx), rot: -pd.rot })),
    vias: pcb.vias.map((vi) => ({ ...vi, cx: mx(vi.cx) })),
    footprints: pcb.footprints.map((f) => ({ ...f, cx: mx(f.cx) })),
    zones: pcb.zones, layersUsed: pcb.layersUsed, thickness: pcb.thickness, version: pcb.version,
  };
}

// A flat, non-interactive SVG of one side, used as a face of the 3D board. The
// content is clipped to the board's Edge.Cuts silhouette so the face shows the
// real board shape, not a cream rectangle.
function staticFace(pcb) {
  const s = svg('svg', { class: 'anr-pcb3d-svg' });
  const g = svg('g', {});
  s.appendChild(g);
  const outline = boardOutline(pcb.prims);
  const bb = paintBoard(g, pcb, { substrate: true, outline });
  return { s, bb, outline };
}

// Build a 3D, drag-to-rotate board: a thin slab with the top side on the front
// face and the bottom side on the back (a real rotateY(180) flip, so it mirrors
// physically and you can read the other side). Pure CSS 3D - no WebGL, vector
// crisp at any angle. Reuses the same painter as the flat view.
function buildBoard3D(pcb, opts = {}) {
  const ss = opts.ss !== false;                  // supersampling toggle (Quality popup)
  const view = opts.view || { rx: -22, ry: 0, zoom: 1, panX: 0, panY: 0 };   // preserved across rebuilds
  const front = staticFace(sidePcb(pcb, 'top'));
  // The back face is mirrored about the board centre so the physical flip reads
  // correctly (forward silk, sides as KiCad's 3D viewer) while staying aligned
  // with the front under the shared viewBox. Without this it shows the bottom in
  // top-view coordinates - mirrored text, swapped sides.
  const cx = (front.bb.minx + front.bb.maxx) / 2;
  const back = staticFace(mirrorXPcb(sidePcb(pcb, 'bottom'), cx));

  // Shared viewBox (union of both faces' real board outlines) so the faces line up
  // and the slab is sized to the board edge, not stray geometry beyond it.
  const b = fitBox();
  for (const f of [front, back]) {
    const ob = (f.outline && f.outline.bbox) || f.bb;
    grow(b, ob.minx, ob.miny); grow(b, ob.maxx, ob.maxy);
  }
  safeBox(b);
  const w = b.maxx - b.minx, h = b.maxy - b.miny, pad = Math.max(w, h) * 0.03 + 1;
  const V = { x: b.minx - pad, y: b.miny - pad, w: w + pad * 2, h: h + pad * 2 };
  const vbStr = `${V.x} ${V.y} ${V.w} ${V.h}`;

  // Pixel size: fit the board aspect into a viewport box, then supersample - the
  // faces are laid out RES x larger and the board is scaled back down by RES in
  // its transform, so the SVG rasterises into the 3D texture at high density and
  // stays crisp when zoomed/rotated (a plain scale() just magnifies a blurry
  // bitmap). Perspective is untouched: scale(1/RES) exactly cancels the RES, so
  // the projection is identical - only the backing resolution changes.
  // RES = supersample factor (the CSS/SVG board has no MSAA, so oversampling is
  // the antialiasing). The browser already multiplies the 3D layer by the device
  // pixel ratio, so use a higher factor on 1x displays and ease off on HiDPI to
  // keep the backing texture within size limits while staying ~4x oversampled.
  const aspect = V.w / V.h, MAXW = 470, MAXH = 340;
  // RES_ON is the supersampled factor; RES drops to 1 when supersampling is off.
  // The board is scaled by 1/RES *inside* the perspective, and CSS perspective
  // interacts non-linearly with that scale - so the perspective distance must
  // scale with RES too (below), or changing RES warps the projection (turning the
  // board orthographic when supersampling is off). PERSP keeps the on-state look
  // identical on every display and only compensates the off-state.
  const RES_ON = (typeof window !== 'undefined' && (window.devicePixelRatio || 1) >= 2) ? 2 : 3;
  const RES = ss ? RES_ON : 1;
  const PERSP = 2200 * RES / RES_ON;
  let W = MAXW, H = MAXW / aspect;
  if (H > MAXH) { H = MAXH; W = MAXH * aspect; }
  W *= RES; H *= RES;
  const T = Math.max(6, Math.min(18, (pcb.thickness || 1.6) * 6)) * RES;   // board thickness in px
  const k = W / V.w;                       // px per board-mm (uniform - aspect matched)
  const Vcx = V.x + V.w / 2, Vcy = V.y + V.h / 2;   // board centre in board coords

  for (const f of [front, back]) {
    f.s.setAttribute('viewBox', vbStr);
    f.s.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    f.s.setAttribute('width', W); f.s.setAttribute('height', H);
  }

  // stage = viewport; cam = 2D zoom/pan (outside the perspective, so zooming is a
  // plain camera move and never warps the perspective); scene = the perspective;
  // board = the rotating 3D slab.
  const stage = el('div', { class: 'anr-pcb3d' });
  const cam = el('div', { class: 'anr-pcb3d-cam' });
  const scene = el('div', { class: 'anr-pcb3d-scene' });
  scene.style.perspective = PERSP + 'px';        // scaled with RES so supersampling never warps the projection
  const board = el('div', { class: 'anr-pcb3d-board' });
  for (const d of [cam, scene, board]) { d.style.width = W + 'px'; d.style.height = H + 'px'; }
  scene.appendChild(board); cam.appendChild(scene); stage.appendChild(cam);

  const mkFace = (cls, sNode, tf) => {
    const d = el('div', { class: 'anr-pcb3d-face ' + cls });
    d.style.width = W + 'px'; d.style.height = H + 'px'; d.style.transform = tf;
    d.appendChild(sNode);
    return d;
  };
  board.appendChild(mkFace('anr-pcb3d-front', front.s, `translate(-50%,-50%) translateZ(${T / 2}px)`));
  board.appendChild(mkFace('anr-pcb3d-back', back.s, `translate(-50%,-50%) rotateY(180deg) translateZ(${T / 2}px)`));

  // FR4 edge: an extruded wall following the whole outline (board px, relative to
  // centre), so rounded corners and round/arbitrary boards get a continuous edge
  // instead of four straight strips with corner gaps. Each polyline segment is a
  // thin quad stood up perpendicular to the board (rotateX 90) and aimed along the
  // segment (rotateZ). Falls back to the bbox rectangle when there's no outline.
  const wallSeg = (A, B) => {
    const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy);
    if (L < 0.5) return;
    const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2, ang = Math.atan2(dy, dx) * 180 / Math.PI;
    const d = el('div', { class: 'anr-pcb3d-wall' });
    d.style.width = L + 'px'; d.style.height = T + 'px';
    d.style.transform = `translate(-50%,-50%) translate(${mx}px, ${my}px) rotateZ(${ang}deg) rotateX(90deg)`;
    board.appendChild(d);
  };
  const rel = (front.outline ? front.outline.pts : [[b.minx, b.miny], [b.maxx, b.miny], [b.maxx, b.maxy], [b.minx, b.maxy]])
    .map((p) => [(p[0] - Vcx) * k, (p[1] - Vcy) * k]);
  for (let i = 0; i < rel.length; i++) wallSeg(rel[i], rel[(i + 1) % rel.length]);

  // View state lives in the shared `view` object so the Quality popup can rebuild
  // the slab at a new supersample factor without losing the camera. Left-drag
  // rotates (board, inside the perspective); right/middle-drag pans and the wheel
  // zooms (cam, a plain 2D transform outside the perspective). 1/RES undoes the
  // supersample. Double-click/Reset returns home.
  const HOME = { rx: -22, ry: 0, zoom: 1 };
  const applyCam = () => { cam.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`; };
  const applyBoard = () => { board.style.transform = `scale(${1 / RES}) rotateX(${view.rx}deg) rotateY(${view.ry}deg)`; };
  applyCam(); applyBoard();

  let drag = null;
  stage.addEventListener('contextmenu', (e) => e.preventDefault());   // right-drag pans - suppress the menu
  stage.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.button === 1 };
    board.classList.add('is-dragging'); stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (drag.pan) { view.panX += dx; view.panY += dy; applyCam(); }
    else { view.ry += dx * 0.5; view.rx = Math.max(-90, Math.min(90, view.rx - dy * 0.5)); applyBoard(); }
    drag.x = e.clientX; drag.y = e.clientY;
  });
  const endDrag = () => { drag = null; board.classList.remove('is-dragging'); };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('wheel', (e) => { e.preventDefault(); view.zoom = Math.max(0.3, Math.min(4, view.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))); applyCam(); }, { passive: false });
  stage.addEventListener('dblclick', () => { Object.assign(view, { rx: HOME.rx, ry: HOME.ry, zoom: HOME.zoom, panX: 0, panY: 0 }); applyCam(); applyBoard(); });

  const bar = el('div', { class: 'anr-altium-bar' });
  const flip = el('button', { class: 'anr-btn', type: 'button' }, 'Flip over');
  flip.addEventListener('click', () => { view.ry = Math.abs(((view.ry % 360) + 360) % 360 - 180) < 90 ? 0 : 180; applyBoard(); });
  const reset = el('button', { class: 'anr-btn', type: 'button' }, 'Reset view');
  reset.addEventListener('click', () => { Object.assign(view, { rx: HOME.rx, ry: HOME.ry, zoom: HOME.zoom, panX: 0, panY: 0 }); applyCam(); applyBoard(); });
  // Quality popup: supersampling toggle (rebuilds the slab via onToggleSS). MSAA
  // is shown disabled - it is a WebGL feature, not available to this CSS/SVG board.
  const qWrap = el('span', { class: 'anr-aa-wrap' });
  const qBtn = el('button', { class: 'anr-btn', type: 'button' }, 'Quality');
  const qPanel = el('div', { class: 'anr-aa-panel is-hidden' });
  qPanel.appendChild(el('div', { class: 'anr-aa-title' }, 'Quality'));
  const ssBtn = el('button', { class: 'anr-btn anr-aa-btn', type: 'button' }, 'Supersampling');
  ssBtn.classList.toggle('is-on', ss);
  ssBtn.addEventListener('click', () => { if (opts.onToggleSS) opts.onToggleSS(); });
  qPanel.appendChild(ssBtn);
  const msaaBtn = el('button', { class: 'anr-btn anr-aa-btn', type: 'button', title: 'Hardware MSAA needs WebGL - available on the 3D model viewer, not this vector board' }, 'Hardware MSAA - n/a');
  msaaBtn.disabled = true;
  qPanel.appendChild(msaaBtn);
  qBtn.addEventListener('click', (e) => { e.stopPropagation(); qPanel.classList.toggle('is-hidden'); });
  document.addEventListener('click', (e) => { if (!qWrap.contains(e.target)) qPanel.classList.add('is-hidden'); });
  qWrap.appendChild(qBtn); qWrap.appendChild(qPanel);
  bar.appendChild(flip); bar.appendChild(reset); bar.appendChild(qWrap);
  bar.appendChild(el('span', { class: 'anr-hint anr-pcb3d-hint' }, 'Drag to rotate - right-drag to pan - wheel to zoom - double-click to reset.'));

  const wrap = el('div', { class: 'anr-altium-wrap anr-pcb3d-wrap' });
  wrap.appendChild(stage); wrap.appendChild(bar);
  return wrap;
}

// Board view with mode buttons: a 3D flip board, plus flat Top and Bottom
// (interactive, with the usual pan/zoom + per-layer toggles). Returns the same
// { wrap, focus } shape as pcbView so the project cross-probe still works.
function boardView(pcb) {
  const wrap = el('div', { class: 'anr-board-modes' });
  const bar = el('div', { class: 'anr-altium-bar anr-board-modebar' });
  const host = el('div', { class: 'anr-board-host' });
  const cache = {};
  let topV = null;
  // 3D supersampling state + a camera shared across rebuilds, so toggling
  // supersampling keeps the view. onToggleSS flips it and rebuilds the 3D node.
  let ss3d = true;
  const view3d = { rx: -22, ry: 0, zoom: 1, panX: 0, panY: 0 };
  const build = (mode) => {
    if (cache[mode]) return cache[mode];
    let node;
    if (mode === 'top') { topV = pcbView(sidePcb(pcb, 'top')); node = topV.wrap; }
    else if (mode === 'bottom') node = pcbView(mirrorXPcb(sidePcb(pcb, 'bottom'))).wrap;
    else node = buildBoard3D(pcb, { ss: ss3d, view: view3d, onToggleSS: () => { ss3d = !ss3d; cache['3d'] = null; show('3d'); } });
    return (cache[mode] = node);
  };
  const show = (mode) => {
    host.innerHTML = '';
    host.appendChild(build(mode));
    for (const btn of bar.querySelectorAll('button[data-mode]')) btn.classList.toggle('is-on', btn.dataset.mode === mode);
  };
  for (const [mode, label] of [['3d', '3D board'], ['top', 'Top'], ['bottom', 'Bottom']]) {
    const btn = el('button', { class: 'anr-btn anr-board-mode', type: 'button', 'data-mode': mode }, label);
    btn.addEventListener('click', () => show(mode));
    bar.appendChild(btn);
  }
  wrap.appendChild(bar); wrap.appendChild(host);
  show('3d');
  // Cross-probe always lands on the flat Top view (it has pan/zoom + ping).
  return { wrap, focus: (ref) => { show('top'); return topV ? topV.focus(ref) : false; } };
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
// Draws a pad's copper and records its hole + number for the final passes. The
// hole must be punched after ALL copper (some footprints stack a hole-less
// "connect" pad over a drilled one - e.g. plated mounting holes - and drawing
// the hole per-pad would let the larger pad paint over it).
function drawPad(g, pd, b, holes, labels) {
  const layerKey = pd.layers.includes('*.Cu') ? 'F.Cu' : (pd.layers.find((l) => /\.Cu$/.test(l)) || pd.layers[0] || 'F.Cu');
  // Copper only when the pad is on a copper layer AND is larger than its drill
  // (an annular ring). A pure hole - np_thru_hole, or a pad sized to its drill -
  // carries no copper and renders as a bare hole in the final pass.
  const hasCu = pd.layers.some((l) => l === '*.Cu' || /\.Cu$/.test(l));
  const copper = hasCu && (!(pd.drill > 0) || Math.max(pd.sx, pd.sy) > pd.drill + 1e-6);
  if (copper) {
    let n;
    if (/circle/.test(pd.shape)) {
      n = svg('ellipse', { cx: pd.cx, cy: pd.cy, rx: pd.sx / 2, ry: pd.sy / 2, fill: pd.color });
    } else {
      const rr = /oval/.test(pd.shape) ? Math.min(pd.sx, pd.sy) * 0.5 : /round/.test(pd.shape) ? Math.min(pd.sx, pd.sy) * (pd.rratio != null ? pd.rratio : 0.25) : 0;
      n = svg('rect', { x: pd.cx - pd.sx / 2, y: pd.cy - pd.sy / 2, width: pd.sx, height: pd.sy, rx: rr, fill: pd.color });
      if (pd.rot) n.setAttribute('transform', `rotate(${pd.rot} ${pd.cx} ${pd.cy})`);
    }
    n.setAttribute('data-layer', layerKey);
    g.appendChild(n);
  }
  grow(b, pd.cx - pd.sx / 2, pd.cy - pd.sy / 2); grow(b, pd.cx + pd.sx / 2, pd.cy + pd.sy / 2);
  if (pd.drill > 0) holes.push({ cx: pd.cx, cy: pd.cy, rx: pd.drill / 2, ry: (pd.drillY || pd.drill) / 2, rot: pd.rot });
  if (pd.num && copper) {
    const t = svg('text', { x: pd.cx, y: pd.cy + Math.min(pd.sx, pd.sy) * 0.18, 'font-size': Math.min(pd.sx, pd.sy) * 0.45, fill: '#fff', 'text-anchor': 'middle', 'font-weight': 700, 'data-layer': layerKey });
    t.textContent = pd.num; labels.push(t);
  }
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
  dcard.appendChild(boardView(pcb).wrap);
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
    const v = boardView(pcb); panel.appendChild(v.wrap); return v;
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

  // Open on the board by default (then schematic, then the overview).
  setActive(pcbTab >= 0 ? pcbTab : schTab >= 0 ? schTab : overviewIdx);
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
