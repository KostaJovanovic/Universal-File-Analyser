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
  1:  { name: 'Top Layer',       color: '#e6342f' },
  32: { name: 'Bottom Layer',    color: '#3656e6' },
  33: { name: 'Top Overlay',     color: '#e3e34a' },
  34: { name: 'Bottom Overlay',  color: '#c77000' },
  35: { name: 'Top Paste',       color: '#9aa0a6' },
  36: { name: 'Bottom Paste',    color: '#6b7075' },
  37: { name: 'Top Solder',      color: '#a64ad6' },
  38: { name: 'Bottom Solder',   color: '#7a3aa0' },
  74: { name: 'Multi-Layer',     color: '#9fb39f' },
};
// Mechanical layers (assembly / courtyard / dimension) cluster in the 57-88
// range depending on Altium version; give them distinct hues by id.
const MECH_COLORS = ['#23c6c6', '#c623c6', '#62c623', '#c68a23', '#2398c6', '#c6236b'];
function layerInfo(n) {
  if (LAYER_INFO[n]) return LAYER_INFO[n];
  if (n >= 56 && n <= 88) return { name: 'Mechanical ' + (n - 56), color: MECH_COLORS[(n - 56) % MECH_COLORS.length] };
  return { name: 'Layer ' + n, color: '#7a9a8a' };
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

function parseSchematic(reader) {
  const head = reader.readStream('FileHeader');
  if (!head) return null;
  const recs = walkRecords(head).map(parseFields);
  const objs = [];            // drawable {kind,...}
  const parts = [];           // component summary rows
  let header = null;
  const params = [];          // component parameters (mfr / mpn / links)

  for (const f of recs) {
    const r = f.RECORD;
    if (!r && f.HEADER) { header = f; continue; }
    const x = num(f, 'LOCATION.X'), y = num(f, 'LOCATION.Y');
    switch (r) {
      case '1': // component
        parts.push({
          designator: null,
          libref: f.LIBREFERENCE || f.DESIGNITEMID || '',
          desc: unesc(f.COMPONENTDESCRIPTION || ''),
          x, y,
        });
        break;
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
        objs.push({ kind: 'poly', pts, stroke: bgr(f.COLOR) || '#9fe' });
        break;
      }
      case '27': { // wire
        const pts = [];
        const n = num(f, 'LOCATIONCOUNT', 0);
        for (let i = 1; i <= n; i++) {
          const px = f['LOCATION.X' + i], py = f['LOCATION.Y' + i];
          if (px != null) pts.push([parseFloat(px), parseFloat(py)]);
        }
        if (pts.length >= 2) objs.push({ kind: 'wire', pts, stroke: bgr(f.COLOR) || '#3b8eea' });
        break;
      }
      case '4': case '25': case '34': case '17': // label / net label / designator / power port
        if (f.TEXT) objs.push({ kind: 'text', x, y, text: f.TEXT, fill: bgr(f.COLOR) || '#eaeaea', power: r === '17' });
        if (r === '34' && parts.length) parts[parts.length - 1].designator = f.TEXT;
        break;
      case '41': // component parameter (mfr / mpn / datasheet / mouser)
        if (f.NAME && f.TEXT && f.TEXT !== '*' && f.ISHIDDEN !== 'T' || (f.NAME && f.TEXT && f.TEXT !== '*' && /datasheet|mouser|manufacturer|supplier|geometry|part/i.test(f.NAME)))
          params.push({ name: f.NAME, value: unesc(f.TEXT) });
        break;
      case '209': // text frame (notes)
        objs.push({ kind: 'rect', x1: x, y1: y, x2: num(f, 'CORNER.X'), y2: num(f, 'CORNER.Y'),
          stroke: f.SHOWBORDER === 'T' ? bgr(f.AREACOLOR) : null, fill: f.ISSOLID === 'T' ? bgr(f.AREACOLOR) : null });
        if (f.TEXT) objs.push({ kind: 'text', x: x + 5, y: num(f, 'CORNER.Y') - 8, text: f.TEXT, fill: bgr(f.TEXTCOLOR) || '#fff' });
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

function buildViewer(build, opts = {}) {
  // build(group) populates an SVG <g> and returns the data bbox {minx,miny,maxx,maxy}.
  const wrap = el('div', { class: 'anr-altium-wrap' });
  const s = svg('svg', { class: 'anr-altium-svg' });
  const root = svg('g', {});
  s.appendChild(root);
  wrap.appendChild(s);

  const bbox = build(root);
  const pad = Math.max((bbox.maxx - bbox.minx), (bbox.maxy - bbox.miny)) * 0.06 + 1;
  const vb = { x: bbox.minx - pad, y: bbox.miny - pad, w: (bbox.maxx - bbox.minx) + pad * 2, h: (bbox.maxy - bbox.miny) + pad * 2 };
  const home = { ...vb };
  const apply = () => s.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  apply();

  // wheel zoom toward the cursor
  s.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = s.getBoundingClientRect();
    const mx = vb.x + (e.clientX - r.left) / r.width * vb.w;
    const my = vb.y + (e.clientY - r.top) / r.height * vb.h;
    const k = e.deltaY < 0 ? 0.85 : 1 / 0.85;
    vb.x = mx - (mx - vb.x) * k; vb.y = my - (my - vb.y) * k;
    vb.w *= k; vb.h *= k; apply();
  }, { passive: false });
  // drag pan
  let drag = null;
  s.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; s.setPointerCapture(e.pointerId); s.classList.add('is-grabbing'); });
  s.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = s.getBoundingClientRect();
    vb.x -= (e.clientX - drag.x) / r.width * vb.w;
    vb.y -= (e.clientY - drag.y) / r.height * vb.h;
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
  wrap.appendChild(bar);
  return wrap;
}

function fitBox() { return { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity }; }
function grow(b, x, y) { if (x < b.minx) b.minx = x; if (y < b.miny) b.miny = y; if (x > b.maxx) b.maxx = x; if (y > b.maxy) b.maxy = y; }
function safeBox(b) { if (!Number.isFinite(b.minx)) return { minx: -100, miny: -100, maxx: 100, maxy: 100 }; if (b.minx === b.maxx) { b.minx -= 50; b.maxx += 50; } if (b.miny === b.maxy) { b.miny -= 50; b.maxy += 50; } return b; }

// Render a schematic (Y flipped so the sheet reads the right way up).
function schView(parsed) {
  return buildViewer((g) => {
    const b = fitBox();
    const Y = (v) => -v;
    for (const o of parsed.objs) {
      if (o.kind === 'rect') {
        const x = Math.min(o.x1, o.x2), y = Math.min(o.y1, o.y2), w = Math.abs(o.x2 - o.x1), h = Math.abs(o.y2 - o.y1);
        const r = svg('rect', { x, y: Y(y + h), width: w, height: h, fill: o.fill || 'none', stroke: o.stroke || 'none', 'stroke-width': 1 });
        g.appendChild(r); grow(b, x, Y(y)); grow(b, x + w, Y(y + h));
      } else if (o.kind === 'pin') {
        g.appendChild(svg('line', { x1: o.x, y1: Y(o.y), x2: o.x2, y2: Y(o.y2), stroke: '#7fd4ff', 'stroke-width': 1.4 }));
        g.appendChild(svg('circle', { cx: o.x, cy: Y(o.y), r: 1.6, fill: '#7fd4ff' }));
        if (o.desig) { const t = svg('text', { x: o.x2, y: Y(o.y2) - 1, 'font-size': 6, fill: '#cfe' }); t.textContent = o.desig; g.appendChild(t); }
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
}

// Render PCB / footprint primitives with per-layer colouring + toggles.
function pcbView(prims, layers, outline) {
  return buildViewer((g) => {
    const b = fitBox();
    const Y = (v) => -v;
    if (outline && outline.length >= 2) {
      const pts = outline.map(([x, y]) => `${x},${Y(y)}`).join(' ');
      g.appendChild(svg('polygon', { points: pts, fill: 'rgba(120,160,140,0.06)', stroke: '#9fb39f', 'stroke-width': 2, 'data-layer': 'outline' }));
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
  const t = svg('text', { x: p.x, y: Y(p.y) + Math.min(p.sx, p.sy) * 0.18, 'font-size': Math.min(p.sx, p.sy) * 0.5, fill: '#0b0b0f', 'text-anchor': 'middle', 'data-layer': p.layer, 'font-weight': 700 });
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

// Altium project file (.PrjPcb) - an INI listing the member documents, the
// configuration and the output-job template. Plain text, not an OLE file.
async function renderPrjPcb(file, resultsEl) {
  resultsEl.innerHTML = '';
  let text = '';
  try { text = await file.text(); } catch (_) {}
  // Collect [DocumentN] DocumentPath entries and a few [Design] fields.
  const docs = [];
  let projName = '', version = '', cfg = '';
  const reDoc = /\[Document\d+\][^[]*?DocumentPath=([^\r\n]+)/gi;
  let m;
  while ((m = reDoc.exec(text))) docs.push(m[1].trim());
  const grab = (k) => { const r = new RegExp('^' + k + '=([^\\r\\n]+)', 'im').exec(text); return r ? r[1].trim() : ''; };
  version = grab('Version');
  cfg = grab('DefaultConfiguration');
  const outCount = (text.match(/OutputName=/gi) || []).length;
  projName = (file.name || '').replace(/\.[^.]+$/, '');

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
    for (const p of (parsed.params || [])) {
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
    dcard.appendChild(schView(parsed));
    resultsEl.appendChild(dcard);
  }
}

function renderPcbLib(file, reader, resultsEl) {
  // find the footprint geometry stream: a `<name>/Data` that is not "Library/Data".
  let dataBytes = null, fpName = '';
  // The footprint geometry lives in a top-level `<name>/Data` stream (exactly
  // one path segment before Data) - not Library/Data (the library TOC) nor the
  // deeper `<name>/UniqueIDPrimitiveInformation/Data` sidecar. Pick the largest.
  let best = -1;
  for (const e of reader.entries) {
    if (e.type !== 2) continue;
    const m = /^([^/]+)\/Data$/.exec(e.path);
    if (!m || /^(Library|FileVersionInfo)$/i.test(m[1])) continue;
    if (e.size > best) { best = e.size; fpName = m[1]; }
  }
  if (fpName) dataBytes = reader.readStream(fpName + '/Data');
  let prims = [], layers = new Set();
  if (dataBytes) ({ prims, layers } = parseFootprintData(dataBytes));
  const pads = prims.filter((p) => p.kind === 'pad');

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
    card.appendChild(tbl);
    resultsEl.appendChild(card);
  }

  if (prims.length) {
    const dcard = el('div', { class: 'anr-card' });
    dcard.appendChild(el('h3', {}, 'Footprint'));
    dcard.appendChild(pcbView(prims, layers, null));
    resultsEl.appendChild(dcard);
  } else {
    resultsEl.appendChild(el('div', { class: 'anr-info' }, 'No footprint geometry could be decoded from this library.'));
  }
}

function renderPcbDoc(file, reader, resultsEl) {
  const board = parseBoard(reader.readStream((e) => /Board6\/Data$/i.test(e.path)));
  const layers = new Set();
  let prims = [];
  const streams = [
    ['Tracks6', 'line'], ['Arcs6', 'arc'], ['Fills6', 'line'],
  ];
  for (const [nm, kind] of streams) {
    const bytes = reader.readStream((e) => new RegExp(nm + '/Data$', 'i').test(e.path));
    const got = parsePcbStream(bytes, kind);
    for (const p of got) layers.add(p.layer);
    prims = prims.concat(got);
  }
  const f = board && board.fields || {};
  const outline = board && board.outline;
  let boardW = null, boardH = null;
  if (outline && outline.length) {
    const xs = outline.map((p) => p[0]), ys = outline.map((p) => p[1]);
    boardW = (Math.max(...xs) - Math.min(...xs)) * 0.0254;
    boardH = (Math.max(...ys) - Math.min(...ys)) * 0.0254;
  }

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
    dcard.appendChild(pcbView(prims, layers, outline));
    if (!prims.length) dcard.appendChild(el('div', { class: 'anr-info' }, 'This board has no routed copper, components or polygons - only the board outline is defined.'));
  } else {
    dcard.appendChild(el('div', { class: 'anr-info' }, 'No board outline or geometry could be decoded from this document.'));
  }
  resultsEl.appendChild(dcard);
}
