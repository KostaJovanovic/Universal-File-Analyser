/* Analyser - colour LUT (.cube) viewer + visualiser
   ============================================================================
   An Adobe/Iridas/Resolve .cube is a plain-text colour look-up table: an
   optional TITLE and comments, a LUT_3D_SIZE n (or LUT_1D_SIZE n), optional
   DOMAIN_MIN/DOMAIN_MAX, then the table - n*n*n (3D) or n (1D) "R G B" rows of
   floats, RED varying fastest. It maps every input colour to an output colour,
   which is how a grade's "look" (film emulation, log->Rec709, a stylised look)
   is baked into a single file.

   The same .cube extension is also used by Gaussian for volumetric DFT data, so
   we sniff for LUT_*_SIZE and hand anything else back to the generic identifier.

   We parse the table, then VISUALISE it: the neutral tone-response curve, a
   before/after of memory colours and a hue/luma test chart pushed through the
   LUT, and an interactive 3D scatter of the colour cube it defines. */

import { el, row, rowHelp, fmtBytes, integrityCard, errorCard, attachZoomPan, openOverlayBack } from '../core/util.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const to255 = (v) => Math.round(clamp01(v) * 255);
const hex2 = (n) => n.toString(16).padStart(2, '0');
const rgbHex = (r, g, b) => '#' + hex2(to255(r)) + hex2(to255(g)) + hex2(to255(b));
const rgbCss = (r, g, b) => `rgb(${to255(r)},${to255(g)},${to255(b)})`;

// ---- parse a .cube file ------------------------------------------------------
function parseCubeLut(text) {
  const lut = { title: '', type: null, size: 0, domainMin: [0, 0, 0], domainMax: [1, 1, 1], comments: [], data: null };
  const rows = [];
  let expected = 0;
  const lines = text.split(/\r?\n/);
  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line[0] === '#') { const c = line.slice(1).trim(); if (c) lut.comments.push(c); continue; }
    const up = line.toUpperCase();
    if (up.startsWith('TITLE')) { const m = line.match(/"([^"]*)"/); lut.title = m ? m[1] : line.slice(5).trim(); continue; }
    if (up.startsWith('LUT_3D_SIZE')) { lut.type = '3D'; lut.size = parseInt(line.split(/\s+/)[1], 10); expected = lut.size ** 3; continue; }
    if (up.startsWith('LUT_1D_SIZE')) { lut.type = '1D'; lut.size = parseInt(line.split(/\s+/)[1], 10); expected = lut.size; continue; }
    if (up.startsWith('DOMAIN_MIN')) { lut.domainMin = line.split(/\s+/).slice(1, 4).map(Number); continue; }
    if (up.startsWith('DOMAIN_MAX')) { lut.domainMax = line.split(/\s+/).slice(1, 4).map(Number); continue; }
    if (up.startsWith('LUT_3D_INPUT_RANGE') || up.startsWith('LUT_1D_INPUT_RANGE')) {
      const p = line.split(/\s+/).map(Number); lut.domainMin = [p[1], p[1], p[1]]; lut.domainMax = [p[2], p[2], p[2]]; continue;
    }
    // A data row: three numbers (allow negatives / scientific / values >1).
    const p = line.split(/\s+/);
    if (p.length >= 3) {
      const r = parseFloat(p[0]), g = parseFloat(p[1]), b = parseFloat(p[2]);
      if (isFinite(r) && isFinite(g) && isFinite(b)) rows.push(r, g, b);
    }
  }
  if (!lut.type || !(lut.size > 1)) return null;          // not a LUT (Gaussian cube, etc.)
  lut.expected = expected;
  lut.count = rows.length / 3;
  lut.data = new Float32Array(rows);
  lut.complete = lut.count === expected;
  // Detect values outside the unit cube (extended-range LUT).
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < rows.length; i++) { if (rows[i] < mn) mn = rows[i]; if (rows[i] > mx) mx = rows[i]; }
  lut.range = [mn, mx];
  return lut;
}

// ---- Adobe SpeedGrade / Iridas .look ----------------------------------------
// A .look is XML: a <shaders> stack of grading stages (basic correction, tints,
// wheels, curves, secondaries, vignette, ...), then a baked <LUT> with a <size>
// and a <data> blob of little-endian float32 R,G,B triplets, red varying fastest
// - the same lattice order as a .cube. That baked LUT is the whole grade stack
// flattened, so we visualise it exactly like a .cube and also list the stages.
const looksLikeLook = (text) => /<look[\s>]/i.test(text.slice(0, 4096));

function hexLEToFloats(hex) {
  const n = hex.length >> 3;                              // 8 hex chars per float32
  const out = new Float32Array(n);
  const dv = new DataView(new ArrayBuffer(4));
  for (let i = 0; i < n; i++) {
    const o = i * 8;
    dv.setUint8(0, parseInt(hex.substr(o, 2), 16));
    dv.setUint8(1, parseInt(hex.substr(o + 2, 2), 16));
    dv.setUint8(2, parseInt(hex.substr(o + 4, 2), 16));
    dv.setUint8(3, parseInt(hex.substr(o + 6, 2), 16));
    out[i] = dv.getFloat32(0, true);
  }
  return out;
}

function parseLookShaders(text) {
  const stages = [];
  const re = /<shader>([\s\S]*?)<\/shader>/g;
  let m;
  while ((m = re.exec(text))) {
    const body = m[1];
    const get = (tag) => { const r = body.match(new RegExp('<' + tag + '>\\s*"?([^"<]*)"?\\s*</' + tag + '>', 'i')); return r ? r[1] : ''; };
    const pblk = (body.match(/<parameters>([\s\S]*?)<\/parameters>/i) || [])[1] || '';
    const params = [];
    const pre = /<([A-Za-z_][\w.]*)>\s*"?([^"<]*)"?\s*<\/\1>/g;
    let pm;
    while ((pm = pre.exec(pblk))) params.push([pm[1], pm[2]]);
    stages.push({ name: get('name'), custom: get('customname'), visible: get('visible'), opacity: get('opacity'), params });
  }
  return stages;
}

function parseLook(text) {
  if (!looksLikeLook(text)) return null;
  const look = { lut: null, stages: parseLookShaders(text) };
  const m = text.match(/<LUT>\s*<size>\s*"?(\d+)"?\s*<\/size>\s*<data>([\s\S]*?)<\/data>\s*<\/LUT>/i);
  if (m) {
    const size = parseInt(m[1], 10);
    const hex = m[2].replace(/[^0-9A-Fa-f]/g, '');
    const expected = size * size * size;
    if (size > 1 && hex.length >= expected * 3 * 8) {
      const data = hexLEToFloats(hex.slice(0, expected * 3 * 8));
      let mn = Infinity, mx = -Infinity;
      for (let i = 0; i < data.length; i++) { if (data[i] < mn) mn = data[i]; if (data[i] > mx) mx = data[i]; }
      look.lut = { title: '', type: '3D', size, domainMin: [0, 0, 0], domainMax: [1, 1, 1], comments: [], data, expected, count: data.length / 3, complete: true, range: [mn, mx] };
    }
  }
  return (look.lut || look.stages.length) ? look : null;
}

// A SpeedGrade parameter value is prefixed with a letter ("D0", "N100", "N0.5")
// when it sits at its default; a user-changed value is a bare signed decimal. We
// surface only the changed numeric ones (skipping pure 0/1 enable toggles, the
// "__"-prefixed internal fields that carry their own non-zero defaults, and the
// structural working-space fields that aren't creative adjustments) so the
// readout shows what each stage actually does.
const LOOK_SKIP_PARAMS = new Set(['Range', 'Gamma']);
function lookActiveParams(params) {
  return params.filter(([k, v]) => !k.startsWith('__') && !LOOK_SKIP_PARAMS.has(k) &&
    /^-?\d+(\.\d+)?$/.test(v) && v !== '0' && v !== '1' && Math.abs(parseFloat(v)) > 1e-4);
}
const prettyLookParam = (k) => k.replace(/\./g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
const fmtLookNum = (v) => { const n = parseFloat(v); return Number.isInteger(n) ? String(n) : n.toFixed(2); };

function lookNamedStages(stages) { return stages.filter((s) => s.name && !s.name.startsWith('__')); }

function buildLookStack(stages) {
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Grade stack'));
  card.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 10px' },
    'The grading stages this look applies, in order, as built in Adobe SpeedGrade / Premiere Lumetri. Stages left at their defaults are marked so; the baked 3D LUT is the whole stack flattened into one table.'));
  const tbl = el('table', { class: 'anr-readout' });
  for (const op of lookNamedStages(stages)) {
    const label = (op.custom && !op.custom.startsWith('__')) ? op.custom : op.name;
    const active = lookActiveParams(op.params);
    let val;
    if (op.name === 'LUT') val = 'embedded 3D LUT (shown below)';
    else if (op.visible === '0') val = 'hidden';
    else if (active.length) val = active.map(([k, v]) => prettyLookParam(k) + ' ' + fmtLookNum(v)).join(', ');
    else val = 'default';
    tbl.appendChild(row(label, val));
  }
  card.appendChild(tbl);
  return card;
}

// ---- LUT sampling (trilinear for 3D, linear for 1D) --------------------------
function makeSampler(lut) {
  const { data, size: n } = lut;
  const dmn = lut.domainMin, dmx = lut.domainMax;
  const norm = (v, c) => {
    const lo = dmn[c], hi = dmx[c];
    return hi > lo ? (v - lo) / (hi - lo) : v;
  };
  if (lut.type === '1D') {
    return (r, g, b) => {
      const out = [r, g, b];
      const inp = [r, g, b];
      for (let c = 0; c < 3; c++) {
        const f = clamp01(norm(inp[c], c)) * (n - 1);
        const i0 = Math.floor(f), i1 = Math.min(i0 + 1, n - 1), t = f - i0;
        out[c] = data[i0 * 3 + c] * (1 - t) + data[i1 * 3 + c] * t;
      }
      return out;
    };
  }
  // 3D trilinear. Index = r + g*n + b*n*n (red fastest).
  const at = (x, y, z, c) => data[3 * (x + y * n + z * n * n) + c];
  return (r, g, b) => {
    const fx = clamp01(norm(r, 0)) * (n - 1), fy = clamp01(norm(g, 1)) * (n - 1), fz = clamp01(norm(b, 2)) * (n - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
    const x1 = Math.min(x0 + 1, n - 1), y1 = Math.min(y0 + 1, n - 1), z1 = Math.min(z0 + 1, n - 1);
    const dx = fx - x0, dy = fy - y0, dz = fz - z0;
    const out = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const c00 = at(x0, y0, z0, c) * (1 - dx) + at(x1, y0, z0, c) * dx;
      const c10 = at(x0, y1, z0, c) * (1 - dx) + at(x1, y1, z0, c) * dx;
      const c01 = at(x0, y0, z1, c) * (1 - dx) + at(x1, y0, z1, c) * dx;
      const c11 = at(x0, y1, z1, c) * (1 - dx) + at(x1, y1, z1, c) * dx;
      const c0 = c00 * (1 - dy) + c10 * dy, c1 = c01 * (1 - dy) + c11 * dy;
      out[c] = c0 * (1 - dz) + c1 * dz;
    }
    return out;
  };
}

// HSL -> RGB (h,s,l in 0..1) for the test chart.
function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => { t = (t % 1 + 1) % 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)];
}

// ---- neutral tone-response curve (the LUT's contrast + colour cast) ----------
function toneCurveSvg(sample, W, H) {
  const pad = 26, w = W - pad - 8, h = H - pad - 8, x0 = pad, y0 = 6;
  const X = (t) => x0 + t * w, Y = (v) => y0 + (1 - v) * h;
  const N = 64;
  const ch = [[], [], []];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const o = sample(t, t, t);
    for (let c = 0; c < 3; c++) ch[c].push([t, o[c]]);
  }
  const path = (pts) => pts.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join(' ');
  let g = '';
  // frame + identity diagonal + mid gridlines
  g += `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="rgba(128,128,128,.05)" stroke="currentColor" stroke-opacity=".15"/>`;
  for (let q = 1; q < 4; q++) { const gx = X(q / 4), gy = Y(q / 4); g += `<line x1="${gx}" y1="${y0}" x2="${gx}" y2="${y0 + h}" stroke="currentColor" stroke-opacity=".07"/><line x1="${x0}" y1="${gy}" x2="${x0 + w}" y2="${gy}" stroke="currentColor" stroke-opacity=".07"/>`; }
  g += `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(1)}" y2="${Y(1)}" stroke="currentColor" stroke-opacity=".25" stroke-dasharray="3 3"/>`;
  const cols = ['#e0524d', '#3ba776', '#3b82c4'];
  for (let c = 0; c < 3; c++) g += `<path d="${path(ch[c])}" fill="none" stroke="${cols[c]}" stroke-width="1.8" stroke-linejoin="round"/>`;
  g += `<text x="${x0}" y="${H - 6}" font-size="9.5" fill="currentColor" opacity=".5">input 0</text>`;
  g += `<text x="${x0 + w}" y="${H - 6}" font-size="9.5" text-anchor="end" fill="currentColor" opacity=".5">1 (white)</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" style="display:block">${g}</svg>`;
}

// ---- a hue/luma + grey-ramp test chart, pushed through the LUT ----------------
function paintChart(canvas, sample, apply) {
  const w = canvas.width, h = canvas.height, split = Math.round(h * 0.66);
  const img = canvas.getContext('2d').createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r, g, b;
      if (y < split) {                                   // hue (x) x lightness (y), full sat
        const hue = x / (w - 1);
        const light = 0.92 - (y / (split - 1)) * 0.82;
        [r, g, b] = hslToRgb(hue, 1, light);
      } else {                                            // neutral grey ramp
        const v = x / (w - 1); r = g = b = v;
      }
      if (apply) [r, g, b] = sample(r, g, b);
      const o = (y * w + x) * 4;
      d[o] = to255(r); d[o + 1] = to255(g); d[o + 2] = to255(b); d[o + 3] = 255;
    }
  }
  canvas.getContext('2d').putImageData(img, 0, 0);
}

// ---- memory-colour swatches, before vs after ---------------------------------
const SWATCHES = [
  ['White', 0.90, 0.90, 0.90], ['Mid grey', 0.50, 0.50, 0.50], ['Shadow', 0.18, 0.18, 0.18],
  ['Skin (light)', 0.86, 0.66, 0.55], ['Skin (deep)', 0.52, 0.34, 0.26], ['Sky blue', 0.33, 0.52, 0.73],
  ['Foliage', 0.30, 0.44, 0.22], ['Pure red', 0.85, 0.10, 0.10], ['Pure blue', 0.12, 0.20, 0.78],
];

// ---- interactive 3D scatter: original RGB cube vs the LUT cube, synced --------
// Rendered straight into a uint32 ImageData buffer (packed colours, square point
// splats, one shared projection + depth sort feeding both cubes) instead of the
// canvas arc()/fillStyle path API, which was the source of the lag.
function buildCubePair(lut, sample) {
  const S = 460;     // backing-store pixels (CSS-scaled down)
  const n = lut.size, step = Math.max(1, Math.ceil(n / 20));
  const packed = (r, g, b) => (255 << 24) | (to255(b) << 16) | (to255(g) << 8) | to255(r);   // little-endian ABGR
  const positions = [];
  let M = 0;
  for (let z = 0; z < n; z += step) for (let y = 0; y < n; y += step) for (let x = 0; x < n; x += step) M++;
  const px = new Float32Array(M), py = new Float32Array(M), pz = new Float32Array(M);
  const colN = new Uint32Array(M), colL = new Uint32Array(M);
  let i = 0;
  for (let z = 0; z < n; z += step) for (let y = 0; y < n; y += step) for (let x = 0; x < n; x += step) {
    const inR = x / (n - 1), inG = y / (n - 1), inB = z / (n - 1);
    px[i] = inR - 0.5; py[i] = 0.5 - inG; pz[i] = inB - 0.5;   // y flipped (screen y grows down)
    colN[i] = packed(inR, inG, inB);
    const o = sample(inR, inG, inB);
    colL[i] = packed(o[0], o[1], o[2]);
    i++;
  }
  // Scratch projection buffers + a reusable depth-sorted index list.
  const sx = new Float32Array(M), sy = new Float32Array(M), dep = new Float32Array(M);
  const idx = new Int32Array(M); for (let k = 0; k < M; k++) idx[k] = k;
  const corners = [];
  for (let c = 0; c < 8; c++) corners.push([(c & 1 ? 0.5 : -0.5), (c & 2 ? -0.5 : 0.5), (c & 4 ? 0.5 : -0.5)]);
  const edges = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]];
  const WIRE = (0x55 << 24) | (128 << 16) | (128 << 8) | 128;   // faint translucent grey

  const state = { yaw: -0.7, pitch: -0.5, zoom: 1 };
  const mk = () => el('canvas', { width: String(S), height: String(S), style: 'width:100%;max-width:280px;aspect-ratio:1;touch-action:none;cursor:grab;display:block;border-radius:8px;background:radial-gradient(circle at 50% 45%, rgba(128,128,128,.06), transparent 72%)' });
  const cN = mk(), cL = mk();
  const ctxN = cN.getContext('2d'), ctxL = cL.getContext('2d');
  const imgN = ctxN.createImageData(S, S), imgL = ctxL.createImageData(S, S);
  const bufN = new Uint32Array(imgN.data.buffer), bufL = new Uint32Array(imgL.data.buffer);

  function project() {
    const cy = Math.cos(state.yaw), sw = Math.sin(state.yaw), cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
    const sc = S * 0.6 * state.zoom, off = S / 2;
    for (let k = 0; k < M; k++) {
      const X = px[k], Y = py[k], Z = pz[k];
      const x1 = X * cy + Z * sw, z1 = -X * sw + Z * cy;
      const y1 = Y * cp - z1 * sp;
      sx[k] = off + x1 * sc; sy[k] = off + y1 * sc; dep[k] = Y * sp + z1 * cp;
    }
    idx.sort((a, b) => dep[a] - dep[b]);
  }
  function projC(c) {
    const cy = Math.cos(state.yaw), sw = Math.sin(state.yaw), cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
    const sc = S * 0.6 * state.zoom, off = S / 2;
    const x1 = c[0] * cy + c[2] * sw, z1 = -c[0] * sw + c[2] * cy, y1 = c[1] * cp - z1 * sp;
    return [off + x1 * sc, off + y1 * sc];
  }
  function line(buf, x0, y0, x1, y1) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), stepx = x0 < x1 ? 1 : -1, stepy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) { if (x0 >= 0 && x0 < S && y0 >= 0 && y0 < S) buf[y0 * S + x0] = WIRE; if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 > -dy) { err -= dy; x0 += stepx; } if (e2 < dx) { err += dx; y0 += stepy; } }
  }
  function paint(buf, cols, half) {
    buf.fill(0);
    const cp = corners.map(projC);
    for (const [a, b] of edges) line(buf, cp[a][0], cp[a][1], cp[b][0], cp[b][1]);
    for (let k = 0; k < M; k++) {
      const j = idx[k], col = cols[j];
      let x0 = (sx[j] - half) | 0, x1 = (sx[j] + half) | 0, y0 = (sy[j] - half) | 0, y1 = (sy[j] + half) | 0;
      if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 >= S) x1 = S - 1; if (y1 >= S) y1 = S - 1;
      for (let yy = y0; yy <= y1; yy++) { const row = yy * S; for (let xx = x0; xx <= x1; xx++) buf[row + xx] = col; }
    }
  }
  function drawAll() {
    project();
    const half = Math.max(1, Math.round(S / Math.cbrt(M) / 2.6 * Math.min(2.2, state.zoom)));
    paint(bufN, colN, half); ctxN.putImageData(imgN, 0, 0);
    paint(bufL, colL, half); ctxL.putImageData(imgL, 0, 0);
  }
  let raf = 0; const queue = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawAll(); }); };

  // Pointer + wheel + pinch on EITHER canvas drive the shared state, so the two
  // cubes always rotate and zoom together.
  let drag = false, lx = 0, ly = 0, pinch = 0;
  const attach = (cv) => {
    cv.addEventListener('pointerdown', (e) => { drag = true; lx = e.clientX; ly = e.clientY; cv.style.cursor = 'grabbing'; try { cv.setPointerCapture(e.pointerId); } catch (_) {} });
    cv.addEventListener('pointermove', (e) => {
      if (!drag) return;
      state.yaw += (e.clientX - lx) * 0.01;
      state.pitch -= (e.clientY - ly) * 0.01;   // inverted vertical
      state.pitch = Math.max(-1.55, Math.min(1.55, state.pitch));
      lx = e.clientX; ly = e.clientY; queue();
    });
    const end = (e) => { drag = false; cv.style.cursor = 'grab'; try { cv.releasePointerCapture(e.pointerId); } catch (_) {} };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', (e) => { e.preventDefault(); state.zoom = Math.max(0.5, Math.min(6, state.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12))); queue(); }, { passive: false });
    cv.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        if (pinch) { state.zoom = Math.max(0.5, Math.min(6, state.zoom * d / pinch)); queue(); }
        pinch = d;
      }
    }, { passive: false });
    cv.addEventListener('touchend', () => { pinch = 0; });
  };
  attach(cN); attach(cL);
  drawAll();

  const wrap = (cv, label) => el('div', { style: 'flex:1 1 220px;min-width:180px;max-width:300px' }, [cv, el('div', { class: 'anr-hint', style: 'text-align:center;margin-top:4px' }, label)]);
  return el('div', { style: 'display:flex;gap:14px;flex-wrap:wrap;justify-content:center' }, [wrap(cN, 'Original (RGB cube)'), wrap(cL, 'Through LUT')]);
}

// ---- apply the LUT to your own photo / video ---------------------------------
// Apply the LUT to an ImageData, in place-free fashion, at full resolution.
function applyLut(src, sample) {
  const out = new ImageData(src.width, src.height);
  const s = src.data, d = out.data;
  for (let i = 0; i < s.length; i += 4) {
    const o = sample(s[i] / 255, s[i + 1] / 255, s[i + 2] / 255);
    d[i] = to255(o[0]); d[i + 1] = to255(o[1]); d[i + 2] = to255(o[2]); d[i + 3] = s[i + 3];
  }
  return out;
}
const tcLabel = (t) => { const m = Math.floor(t / 60), s = Math.floor(t % 60), c = Math.round((t % 1) * 100); return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`; };

function seekVideo(v, t) {
  return new Promise((res) => { const on = () => { v.removeEventListener('seeked', on); res(); }; v.addEventListener('seeked', on); try { v.currentTime = t; } catch (_) { res(); } });
}
async function extractVideoFrames(file, count, maxW) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
  try {
    await new Promise((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error('the browser could not decode this video codec')); });
    const dur = v.duration || 0, vw = v.videoWidth || 1280, vh = v.videoHeight || 720;
    const scale = Math.min(1, maxW / vw), W = Math.max(1, Math.round(vw * scale)), H = Math.max(1, Math.round(vh * scale));
    const cap = document.createElement('canvas'); cap.width = W; cap.height = H;
    const cx = cap.getContext('2d', { willReadFrequently: true });
    const frames = [];
    for (let i = 0; i < count; i++) {
      const t = dur > 0 ? dur * (i + 0.5) / count : 0;
      await seekVideo(v, t);
      cx.drawImage(v, 0, 0, W, H);
      frames.push({ t, img: cx.getImageData(0, 0, W, H) });
    }
    return { frames, W, H };
  } finally { URL.revokeObjectURL(url); }
}
async function loadImageFrame(file, maxW) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxW / bmp.width), W = Math.max(1, Math.round(bmp.width * scale)), H = Math.max(1, Math.round(bmp.height * scale));
  const cap = document.createElement('canvas'); cap.width = W; cap.height = H;
  const cx = cap.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0, W, H);
  if (bmp.close) bmp.close();
  return { frames: [{ t: null, img: cx.getImageData(0, 0, W, H) }], W, H };
}

// The built-in sample shown automatically for every LUT, before the user drops
// their own footage. Fetched as a blob so loadImageFrame's createImageBitmap path
// (and the maxW downscale) can be reused unchanged.
const SAMPLE_IMG_URL = '/assets/img/LUT_TEST.jpg';
async function loadSampleFrame(maxW) {
  const resp = await fetch(SAMPLE_IMG_URL);
  if (!resp.ok) throw new Error('sample image unavailable (' + resp.status + ')');
  return loadImageFrame(await resp.blob(), maxW);
}

// Draw an ImageData into a fixed-aspect thumbnail canvas (CSS object-fit handles
// the uniform display size, so every thumbnail looks the same regardless of the
// source resolution or aspect).
function thumb(img) {
  const cv = el('canvas', { width: String(img.width), height: String(img.height), class: 'anr-lut-thumb', title: 'Click to open' });
  cv.getContext('2d').putImageData(img, 0, 0);
  return cv;
}
// Lazily turn an item's ImageData into a data URL the lightbox <img> can show.
function itemUrl(it) {
  if (!it.url) {
    const c = document.createElement('canvas'); c.width = it.img.width; c.height = it.img.height;
    c.getContext('2d').putImageData(it.img, 0, 0);
    it.url = c.toDataURL('image/png');
  }
  return it.url;
}

function buildTryout(sample) {
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'See the look'));
  card.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 10px' },
    'This LUT applied to a sample photo, shown original next to graded. Drop in your own photo or video to replace it - on your device, nothing uploaded. A video is sampled at 8 equally spaced frames at full resolution. Click any frame to open it full-size, then step through with the arrows (or ← / → keys).'));
  const input = el('input', { type: 'file', accept: 'image/*,video/*', style: 'display:none' });
  const btn = el('button', { type: 'button', class: 'anr-btn' }, 'Choose photo or video');
  btn.addEventListener('click', () => input.click());
  const status = el('div', { class: 'anr-hint', style: 'margin:8px 0' });
  const grid = el('div', { class: 'anr-lut-frames' });
  card.appendChild(el('div', { class: 'anr-btn-row' }, [btn, input]));
  card.appendChild(status);
  card.appendChild(grid);

  // Flat, ordered list of every preview image (each frame's original then its
  // graded version), shared by the thumbnails and the lightbox.
  let items = [];

  // --- Lightbox (built lazily, reused) - mirrors the comic/photo reader ---
  let overlay;
  function openLightbox(start) {
    if (!overlay) {
      overlay = el('div', { id: 'anr-lut-lightbox', class: 'lightbox' });
      const closeBtn = el('button', { type: 'button', class: 'lightbox-close' }, 'Close');
      const center = el('div', { class: 'lightbox-center' });
      const imgWrap = el('div', { class: 'lightbox-img-wrap' });
      const img = el('img', { alt: '', style: 'max-width:92vw;max-height:82vh;display:block;' });
      imgWrap.appendChild(img);
      const toolbar = el('div', { class: 'lightbox-toolbar' });
      const prevBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, '← Prev');
      const nextBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, 'Next →');
      const meta = el('p', { class: 'lightbox-meta' });
      toolbar.appendChild(prevBtn); toolbar.appendChild(nextBtn);
      center.appendChild(imgWrap); center.appendChild(toolbar); center.appendChild(meta);
      overlay.appendChild(closeBtn); overlay.appendChild(center);
      overlay._zoom = attachZoomPan(imgWrap);
      overlay._hide = () => { overlay.hidden = true; document.body.style.overflow = ''; overlay._backClose = null; };
      const close = () => { if (overlay._backClose) overlay._backClose(); else overlay._hide(); };
      function show(i) {
        overlay._i = i;
        if (overlay._zoom) overlay._zoom.reset();
        img.src = itemUrl(items[i]);
        meta.textContent = items[i].caption + '  (' + (i + 1) + ' / ' + items.length + ')';
        prevBtn.style.visibility = i > 0 ? 'visible' : 'hidden';
        nextBtn.style.visibility = i < items.length - 1 ? 'visible' : 'hidden';
      }
      overlay._show = show;
      overlay._prev = () => { if (overlay._i > 0) show(overlay._i - 1); };
      overlay._next = () => { if (overlay._i < items.length - 1) show(overlay._i + 1); };
      prevBtn.addEventListener('click', (e) => { e.stopPropagation(); overlay._prev(); });
      nextBtn.addEventListener('click', (e) => { e.stopPropagation(); overlay._next(); });
      closeBtn.addEventListener('click', close);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      document.addEventListener('keydown', (e) => {
        if (overlay.hidden) return;
        if (e.key === 'Escape') close();
        else if (e.key === 'ArrowLeft') overlay._prev();
        else if (e.key === 'ArrowRight') overlay._next();
      });
      document.body.appendChild(overlay);
    }
    const wasHidden = overlay.hidden;
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    if (wasHidden) overlay._backClose = openOverlayBack(overlay._hide);
    overlay._show(start);
  }

  function renderGrid(frames) {
    grid.innerHTML = ''; items = [];
    grid.classList.toggle('anr-lut-frames--single', frames.length === 1);
    const multi = frames.length > 1;
    frames.forEach((f, fi) => {
      const graded = applyLut(f.img, sample);
      const base = (multi ? 'Frame ' + (fi + 1) + '/' + frames.length + (f.t != null ? ' · ' + tcLabel(f.t) : '') + ' · ' : '');
      const oIdx = items.length;
      items.push({ img: f.img, caption: base + 'Original' });
      items.push({ img: graded, caption: base + 'Through LUT' });
      const oThumb = thumb(f.img), gThumb = thumb(graded);
      oThumb.addEventListener('click', () => openLightbox(oIdx));
      gThumb.addEventListener('click', () => openLightbox(oIdx + 1));
      const pair = el('div', { class: 'anr-lut-pair' }, [
        el('div', { class: 'anr-lut-half' }, [oThumb, el('div', { class: 'anr-lut-cap' }, 'Original')]),
        el('div', { class: 'anr-lut-half' }, [gThumb, el('div', { class: 'anr-lut-cap' }, 'Through LUT')]),
      ]);
      const cell = [pair];
      if (f.t != null) cell.unshift(el('div', { class: 'anr-lut-cap', style: 'margin:0 0 3px' }, tcLabel(f.t)));
      grid.appendChild(el('div', { class: 'anr-lut-frame' }, cell));
    });
  }
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0]; if (!file) return;
    status.textContent = 'Processing ' + file.name + '…'; grid.innerHTML = '';
    try {
      const isVideo = /^video\//.test(file.type) || /\.(mp4|mov|webm|mkv|m4v|avi|ogv)$/i.test(file.name);
      const res = isVideo ? await extractVideoFrames(file, 8, 1280) : await loadImageFrame(file, 1800);
      status.textContent = (isVideo ? '8 frames from ' : '') + file.name + '  ·  ' + res.W + ' x ' + res.H;
      renderGrid(res.frames);
    } catch (e) { status.textContent = 'Could not process this file: ' + ((e && e.message) || e); }
    input.value = '';
  });

  // Auto-load the built-in sample so every analysed LUT shows a real before/after
  // straight away, without waiting for the user to drop their own footage.
  status.textContent = 'Loading sample photo…';
  loadSampleFrame(1800).then((res) => {
    status.textContent = 'Sample photo  ·  ' + res.W + ' x ' + res.H + '  ·  choose your own above to replace it';
    renderGrid(res.frames);
  }).catch((e) => { status.textContent = 'Could not load the sample photo: ' + ((e && e.message) || e); });

  return card;
}

// ------------------------------------------------------------------------------
export async function renderLut(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading "${file.name}"…`));

  let text;
  try { text = await file.slice(0, 64 * 1024 * 1024).text(); } catch (e) {
    resultsEl.innerHTML = ''; resultsEl.appendChild(errorCard('Could not read this file: ' + (e && e.message))); return;
  }
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  // A .look (Adobe SpeedGrade / Iridas) is an XML grade stack carrying a baked
  // 3D LUT; otherwise treat the text as a .cube LUT.
  const look = (ext === 'look' || looksLikeLook(text)) ? parseLook(text) : null;
  const lut = look ? look.lut : parseCubeLut(text);

  // Neither a colour LUT nor a readable look (e.g. a Gaussian volumetric .cube) -
  // hand back to the generic identifier so it still gets its proper analysis.
  if (!lut && !look) {
    resultsEl.innerHTML = '';
    const { renderProprietary } = await import('./proprietary.js');
    return renderProprietary(file, resultsEl, ext === 'look' ? 'look' : 'cube');
  }

  // A .look without an embedded baked LUT - show its identity + grade stack only
  // (there is no flattened table to push imagery through).
  if (look && !lut) {
    resultsEl.innerHTML = '';
    const idCard = el('div', { class: 'anr-card' });
    idCard.appendChild(el('h3', {}, 'Colour LUT'));
    const idTbl = el('table', { class: 'anr-readout' });
    idTbl.appendChild(row('Format', 'SpeedGrade look (.look)'));
    idTbl.appendChild(row('Grade stages', lookNamedStages(look.stages).length + ' stages'));
    idTbl.appendChild(row('Baked LUT', 'none embedded'));
    idTbl.appendChild(row('Size', fmtBytes(file.size)));
    idCard.appendChild(idTbl);
    resultsEl.appendChild(idCard);
    resultsEl.appendChild(buildLookStack(look.stages));
    resultsEl.appendChild(integrityCard(file));
    return;
  }

  const sample = makeSampler(lut);
  resultsEl.innerHTML = '';

  // ---- Identity / metadata ----
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Colour LUT'));
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Format', look ? `SpeedGrade look (.look) - baked ${lut.size}x${lut.size}x${lut.size} 3D LUT` : 'Cube LUT (.cube)'));
  if (look) tbl.appendChild(row('Grade stages', lookNamedStages(look.stages).length + ' stages'));
  if (lut.title) tbl.appendChild(row('Title', lut.title));
  tbl.appendChild(rowHelp('Type', lut.type === '3D' ? '3D LUT (full colour cube)' : '1D LUT (per-channel curve)',
    'A 3D LUT remaps every R/G/B combination, so it can change hue and saturation; a 1D LUT only reshapes each channel independently (a tone curve).'));
  tbl.appendChild(rowHelp('Grid size', lut.type === '3D' ? `${lut.size} x ${lut.size} x ${lut.size}  (${lut.count.toLocaleString()} entries)` : `${lut.size} points`,
    'The lattice resolution. Output colours between lattice points are trilinearly interpolated.'));
  if (!lut.complete) tbl.appendChild(rowHelp('Entries', lut.count.toLocaleString() + ' of ' + lut.expected.toLocaleString() + ' (truncated)', 'The table has fewer rows than the declared size, so the file is incomplete.'));
  if (lut.domainMin.some((v, i) => v !== 0 || lut.domainMax[i] !== 1)) tbl.appendChild(row('Input domain', `[${lut.domainMin.join(', ')}] - [${lut.domainMax.join(', ')}]`));
  if (lut.range[0] < -0.001 || lut.range[1] > 1.001) tbl.appendChild(rowHelp('Output range', lut.range[0].toFixed(3) + ' - ' + lut.range[1].toFixed(3), 'Values outside 0-1 mean an extended-range (HDR / scene-linear) LUT.'));
  if (lut.comments.length) tbl.appendChild(row('Source', lut.comments.slice(0, 3).join(' · ')));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  card.appendChild(tbl);
  resultsEl.appendChild(card);

  // ---- Grade stack (.look only) ----
  if (look) resultsEl.appendChild(buildLookStack(look.stages));

  // ---- Tone-response curve ----
  const curveCard = el('div', { class: 'anr-card' });
  curveCard.appendChild(el('h3', {}, 'Tone response (neutral axis)'));
  curveCard.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 8px' },
    'How the LUT maps a neutral grey ramp from black to white. The dashed line is no change; curves bowing above it lift, below it crush. Separation between the red, green and blue curves is the colour cast the LUT introduces.'));
  curveCard.appendChild(el('div', { html: toneCurveSvg(sample, 520, 200), style: 'border:1px solid var(--hairline);border-radius:8px;overflow:hidden' }));
  resultsEl.appendChild(curveCard);

  // ---- Before / after test chart ----
  const chartCard = el('div', { class: 'anr-card' });
  chartCard.appendChild(el('h3', {}, 'Before / after'));
  chartCard.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 10px' },
    'A hue x brightness field and a neutral grey ramp, shown straight (left) and pushed through this LUT (right).'));
  const cW = 300, cH = 200;
  const mk = (label, apply) => {
    const cv = el('canvas', { width: String(cW), height: String(cH), style: 'width:100%;border-radius:6px;display:block;image-rendering:auto' });
    paintChart(cv, sample, apply);
    return el('div', { style: 'flex:1 1 220px;min-width:200px' }, [cv, el('div', { class: 'anr-hint', style: 'text-align:center;margin-top:4px' }, label)]);
  };
  chartCard.appendChild(el('div', { style: 'display:flex;gap:12px;flex-wrap:wrap' }, [mk('Original', false), mk('Through LUT', true)]));
  resultsEl.appendChild(chartCard);

  // ---- Apply to your own photo / video ----
  resultsEl.appendChild(buildTryout(sample));

  // ---- Memory-colour swatches ----
  const swCard = el('div', { class: 'anr-card' });
  swCard.appendChild(el('h3', {}, 'Memory colours'));
  const grid = el('div', { class: 'anr-lut-swatches' });
  for (const [name, r, g, b] of SWATCHES) {
    const o = sample(r, g, b);
    grid.appendChild(el('div', { class: 'anr-lut-sw' }, [
      el('div', { class: 'anr-lut-sw-pair' }, [
        el('span', { class: 'anr-lut-chip', style: 'background:' + rgbCss(r, g, b), title: 'in ' + rgbHex(r, g, b) }),
        el('span', { class: 'anr-lut-arrow' }, '→'),
        el('span', { class: 'anr-lut-chip', style: 'background:' + rgbCss(o[0], o[1], o[2]), title: 'out ' + rgbHex(o[0], o[1], o[2]) }),
      ]),
      el('div', { class: 'anr-lut-sw-name' }, name),
      el('div', { class: 'anr-lut-sw-hex' }, rgbHex(r, g, b) + ' → ' + rgbHex(o[0], o[1], o[2])),
    ]));
  }
  swCard.appendChild(grid);
  resultsEl.appendChild(swCard);

  // ---- 3D colour-cube scatter (original vs LUT, synced) ----
  if (lut.type === '3D') {
    const cubeCard = el('div', { class: 'anr-card' });
    cubeCard.appendChild(el('h3', {}, 'Colour cube'));
    cubeCard.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 10px' },
      'The left cube is the untouched RGB space; the right is the same lattice recoloured by this LUT, so the difference is exactly what the LUT does. Each point sits at its input R/G/B position. Drag either cube to rotate both, scroll (or pinch) to zoom in and look inside.'));
    cubeCard.appendChild(buildCubePair(lut, sample));
    resultsEl.appendChild(cubeCard);
  }

  // ---- Integrity (includes the SHA-256) ----
  resultsEl.appendChild(integrityCard(file));
}
