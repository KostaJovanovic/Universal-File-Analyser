/* Analyser - STL 3D viewer
   Parses binary and ASCII STL, renders an interactive WebGL model (orbit / zoom /
   spin), and reports geometry statistics (triangles, bounding box, surface area,
   volume). Self-contained - no external 3D library. */

import { el, row, rowHelp, fmtBytes, sha256Row, errorCard } from '../core/util.js';

// ---------- STL parsing ----------
// Returns { format, positions:Float32Array, normals:Float32Array, count,
//           bbox:{min,max}, area, volume } or null.
function parseStlGeometry(buf) {
  const bytes = new Uint8Array(buf);
  const headStr = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(512, bytes.length)));
  // Binary STL is 84 + 50*n bytes. ASCII starts with "solid" but so can binary,
  // so disambiguate by the exact expected byte length.
  let isAscii = false;
  if (headStr.trimStart().startsWith('solid')) {
    if (bytes.length >= 84) {
      const view0 = new DataView(buf);
      const n = view0.getUint32(80, true);
      if (84 + n * 50 !== bytes.length) isAscii = true;
    } else isAscii = true;
  }
  return isAscii ? parseAsciiStl(headStr.length < bytes.length
    ? new TextDecoder('latin1').decode(bytes) : headStr)
    : parseBinaryStl(buf);
}

export function makeResult(format, posArr, normArr) {
  const count = posArr.length / 9;
  const positions = new Float32Array(posArr);
  const normals = new Float32Array(normArr);
  // Bounding box, surface area, signed volume.
  let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  let area = 0, vol = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i], ay = positions[i + 1], az = positions[i + 2];
    const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
    const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];
    for (const [x, y, z] of [[ax, ay, az], [bx, by, bz], [cx, cy, cz]]) {
      if (x < minx) minx = x; if (y < miny) miny = y; if (z < minz) minz = z;
      if (x > maxx) maxx = x; if (y > maxy) maxy = y; if (z > maxz) maxz = z;
    }
    // area = 0.5 |(b-a) x (c-a)|
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const crx = e1y * e2z - e1z * e2y, cry = e1z * e2x - e1x * e2z, crz = e1x * e2y - e1y * e2x;
    area += 0.5 * Math.sqrt(crx * crx + cry * cry + crz * crz);
    // signed volume of tetra (origin, a, b, c) = a . (b x c) / 6
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return {
    format, positions, normals, count,
    bbox: { min: [minx, miny, minz], max: [maxx, maxy, maxz] },
    area, volume: Math.abs(vol)
  };
}

function parseBinaryStl(buf) {
  if (buf.byteLength < 84) return null;
  const view = new DataView(buf);
  const count = view.getUint32(80, true);
  if (84 + count * 50 > buf.byteLength) return null;
  const pos = new Float32Array(count * 9);
  const nrm = new Float32Array(count * 9);
  let o = 84, pi = 0;
  for (let t = 0; t < count; t++) {
    const nx = view.getFloat32(o, true), ny = view.getFloat32(o + 4, true), nz = view.getFloat32(o + 8, true);
    o += 12;
    for (let v = 0; v < 3; v++) {
      pos[pi] = view.getFloat32(o, true);
      pos[pi + 1] = view.getFloat32(o + 4, true);
      pos[pi + 2] = view.getFloat32(o + 8, true);
      nrm[pi] = nx; nrm[pi + 1] = ny; nrm[pi + 2] = nz;
      o += 12; pi += 3;
    }
    o += 2; // attribute byte count
  }
  fixNormals(pos, nrm);
  return makeResult('STL (binary)', pos, nrm);
}

function parseAsciiStl(text) {
  const pos = [], nrm = [];
  const re = /facet\s+normal\s+([^\n]+)[\s\S]*?outer\s+loop([\s\S]*?)endloop/gi;
  const numRe = /(-?\d+\.?\d*(?:[eE][-+]?\d+)?)/g;
  let m;
  while ((m = re.exec(text))) {
    const nParts = (m[1].match(numRe) || []).map(Number);
    const nx = nParts[0] || 0, ny = nParts[1] || 0, nz = nParts[2] || 0;
    const verts = (m[2].match(/vertex\s+[^\n]+/gi) || []).slice(0, 3);
    if (verts.length < 3) continue;
    for (const v of verts) {
      const p = (v.match(numRe) || []).map(Number);
      pos.push(p[0] || 0, p[1] || 0, p[2] || 0);
      nrm.push(nx, ny, nz);
    }
  }
  if (!pos.length) return null;
  fixNormals(pos, nrm);
  return makeResult('STL (ASCII)', pos, nrm);
}

// Recompute any zero/degenerate facet normals from the triangle winding.
function fixNormals(pos, nrm) {
  for (let i = 0; i < pos.length; i += 9) {
    if (nrm[i] || nrm[i + 1] || nrm[i + 2]) continue;
    const ax = pos[i], ay = pos[i + 1], az = pos[i + 2];
    const bx = pos[i + 3], by = pos[i + 4], bz = pos[i + 5];
    const cx = pos[i + 6], cy = pos[i + 7], cz = pos[i + 8];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (let k = 0; k < 9; k += 3) { nrm[i + k] = nx; nrm[i + k + 1] = ny; nrm[i + k + 2] = nz; }
  }
}

// ---------- tiny mat4 helpers (column-major) ----------
function mat4Multiply(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
function mat4Perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
function mat4RotX(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); }
function mat4RotY(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); }

// ---------- WebGL viewer ----------
function buildViewer(geo) {
  const wrap = el('div', { class: 'anr-stl-viewport' });
  const canvas = el('canvas', { class: 'anr-stl-canvas' });
  wrap.appendChild(canvas);
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  if (!gl) {
    wrap.appendChild(el('p', { class: 'anr-error' }, 'WebGL is not available in this browser.'));
    return { wrap, ok: false };
  }

  // Normalise geometry: centre on origin and scale longest edge to 1.
  const { min, max } = geo.bbox;
  const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, cz = (min[2] + max[2]) / 2;
  const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const np = new Float32Array(geo.positions.length);
  for (let i = 0; i < geo.positions.length; i += 3) {
    np[i] = (geo.positions[i] - cx) / span;
    np[i + 1] = (geo.positions[i + 1] - cy) / span;
    np[i + 2] = (geo.positions[i + 2] - cz) / span;
  }

  const vsrc = `attribute vec3 aPos; attribute vec3 aNormal;
    uniform mat4 uProj, uView, uModel;
    varying vec3 vN; varying vec3 vP;
    void main(){ vec4 w = uModel*vec4(aPos,1.0); vec4 vp = uView*w;
      gl_Position = uProj*vp; vN = mat3(uModel)*aNormal; vP = vp.xyz; }`;
  const fsrc = `precision mediump float; varying vec3 vN; varying vec3 vP; uniform vec3 uColor;
    void main(){ vec3 N = normalize(vN); vec3 L = normalize(vec3(0.35,0.6,0.8));
      float d = max(dot(N,L),0.0); float b = max(dot(-N,L),0.0);
      float lit = max(d, b*0.55); vec3 c = uColor*(0.28+0.72*lit);
      gl_FragColor = vec4(c,1.0); }`;
  function shader(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, vsrc));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, fsrc));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, np, gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

  const nBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, nBuf);
  gl.bufferData(gl.ARRAY_BUFFER, geo.normals, gl.STATIC_DRAW);
  const aNorm = gl.getAttribLocation(prog, 'aNormal');
  gl.enableVertexAttribArray(aNorm);
  gl.vertexAttribPointer(aNorm, 3, gl.FLOAT, false, 0, 0);

  const uProj = gl.getUniformLocation(prog, 'uProj');
  const uView = gl.getUniformLocation(prog, 'uView');
  const uModel = gl.getUniformLocation(prog, 'uModel');
  const uColor = gl.getUniformLocation(prog, 'uColor');
  gl.enable(gl.DEPTH_TEST);

  const state = { yaw: 0.6, pitch: -0.5, dist: 2.6, color: [0.55, 0.62, 0.95], spin: true, bg: [0.06, 0.06, 0.06] };
  let dirty = true;
  // Spin can be turned off two ways - the button, or simply interacting with the
  // canvas (clicking/dragging stops it). Route every change through setSpin so any
  // listener (e.g. the button label) stays in sync no matter what triggered it.
  const spinListeners = [];
  function setSpin(v) {
    if (state.spin === v) return;
    state.spin = v;
    dirty = true;
    for (const cb of spinListeners) cb(v);
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = wrap.clientWidth || 600, h = wrap.clientHeight || 420;
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    dirty = true;
  }

  function draw() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(state.bg[0], state.bg[1], state.bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const proj = mat4Perspective(45 * Math.PI / 180, canvas.width / canvas.height || 1, 0.01, 100);
    const view = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -state.dist, 1]);
    const model = mat4Multiply(mat4RotX(state.pitch), mat4RotY(state.yaw));
    gl.uniformMatrix4fv(uProj, false, proj);
    gl.uniformMatrix4fv(uView, false, view);
    gl.uniformMatrix4fv(uModel, false, model);
    gl.uniform3fv(uColor, state.color);
    gl.drawArrays(gl.TRIANGLES, 0, np.length / 3);
  }

  function loop() {
    if (state.spin) { state.yaw += 0.006; dirty = true; }
    if (dirty) { draw(); dirty = false; }
    if (wrap.isConnected) requestAnimationFrame(loop);
  }

  // Orbit + zoom controls.
  let dragging = false, lx = 0, ly = 0;
  const down = (x, y) => { dragging = true; lx = x; ly = y; setSpin(false); };
  const move = (x, y) => {
    if (!dragging) return;
    state.yaw += (x - lx) * 0.01; state.pitch += (y - ly) * 0.01;
    state.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, state.pitch));
    lx = x; ly = y; dirty = true;
  };
  const up = () => { dragging = false; };
  canvas.addEventListener('mousedown', (e) => down(e.clientX, e.clientY));
  window.addEventListener('mousemove', (e) => move(e.clientX, e.clientY));
  window.addEventListener('mouseup', up);
  canvas.addEventListener('touchstart', (e) => { if (e.touches[0]) down(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
  canvas.addEventListener('touchmove', (e) => { if (e.touches[0]) { move(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); } }, { passive: false });
  canvas.addEventListener('touchend', up);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.dist = Math.max(0.5, Math.min(20, state.dist * (1 + Math.sign(e.deltaY) * 0.1)));
    dirty = true;
  }, { passive: false });

  return {
    wrap, ok: true, state, resize, setSpin,
    onSpinChange: (cb) => spinListeners.push(cb),
    start: () => { resize(); requestAnimationFrame(loop); },
    markDirty: () => { dirty = true; },
  };
}

// Build a "3D model" card around a geometry: the WebGL viewer plus the spin /
// reset / colour / fullscreen controls. Returns { viewCard, viewer }. The caller
// appends viewCard to the DOM, then calls startViewer(viewer) once it's attached
// (the viewer measures its container, so it must be in the document first).
// Reused by the STL, STEP/IGES and 3MF renderers.
export function buildViewerCard(geo, title = '3D model') {
  const viewCard = el('div', { class: 'anr-card' });
  viewCard.appendChild(el('h3', {}, title));
  const viewer = buildViewer(geo);
  viewCard.appendChild(viewer.wrap);

  if (viewer.ok) {
    const controls = el('div', { class: 'anr-btn-row', style: 'margin-top:10px;align-items:center;flex-wrap:wrap;' });
    const spinBtn = el('button', { type: 'button', class: 'anr-btn' }, viewer.state.spin ? 'Pause spin' : 'Resume spin');
    // Toggle via the button, but also reflect spin stopping when the user clicks
    // into the canvas - onSpinChange fires for either trigger.
    spinBtn.addEventListener('click', () => viewer.setSpin(!viewer.state.spin));
    viewer.onSpinChange((spinning) => { spinBtn.textContent = spinning ? 'Pause spin' : 'Resume spin'; });
    const resetBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Reset view');
    resetBtn.addEventListener('click', () => {
      Object.assign(viewer.state, { yaw: 0.6, pitch: -0.5, dist: 2.6 });
      viewer.markDirty();
    });
    const colorInput = el('input', { type: 'color', value: '#8c9eef', title: 'Model colour', style: 'width:36px;height:28px;border:1px solid var(--hairline);background:none;cursor:pointer;' });
    colorInput.addEventListener('input', () => {
      const h = colorInput.value;
      viewer.state.color = [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
      viewer.markDirty();
    });
    const fsBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Fullscreen');
    fsBtn.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (viewer.wrap.requestFullscreen) viewer.wrap.requestFullscreen();
    });
    viewer.wrap.addEventListener('fullscreenchange', () => setTimeout(viewer.resize, 50));
    controls.appendChild(spinBtn);
    controls.appendChild(resetBtn);
    controls.appendChild(el('span', { class: 'anr-hint', style: 'font-size:12px;' }, 'drag to orbit · scroll to zoom'));
    controls.appendChild(colorInput);
    controls.appendChild(fsBtn);
    viewCard.appendChild(controls);
  }
  return { viewCard, viewer };
}

// Start a viewer once its card is attached to the document.
export function startViewer(viewer) {
  if (!viewer || !viewer.ok) return;
  viewer.start();
  window.addEventListener('resize', viewer.resize);
}

// ---------- shared mesh helpers (used here and by model3d.js) ----------

// Expand an indexed mesh (flat vertex xyz + triangle index triples) into the
// non-indexed positions + per-triangle face normals the WebGL viewer wants.
export function buildGeoFromIndexed(verts, tris, format) {
  const triCount = tris.length / 3;
  const positions = new Float32Array(triCount * 9);
  const normals = new Float32Array(triCount * 9);
  let o = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const i0 = tris[i] * 3, i1 = tris[i + 1] * 3, i2 = tris[i + 2] * 3;
    const ax = verts[i0], ay = verts[i0 + 1], az = verts[i0 + 2];
    const bx = verts[i1], by = verts[i1 + 1], bz = verts[i1 + 2];
    const cx = verts[i2], cy = verts[i2 + 1], cz = verts[i2 + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz) || 1; nx /= len; ny /= len; nz /= len;
    positions[o] = ax; positions[o + 1] = ay; positions[o + 2] = az;
    positions[o + 3] = bx; positions[o + 4] = by; positions[o + 5] = bz;
    positions[o + 6] = cx; positions[o + 7] = cy; positions[o + 8] = cz;
    for (let k = 0; k < 9; k += 3) { normals[o + k] = nx; normals[o + k + 1] = ny; normals[o + k + 2] = nz; }
    o += 9;
  }
  return makeResult(format || '3D', positions, normals);
}

// A geometry-stats card (triangles, bounding box, area, volume, hash).
export function geoStatsCard(geo, file, format, unit) {
  const u = unit || 'units';
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Geometry'));
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Format', format));
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  tbl.appendChild(rowHelp('Triangles', geo.count.toLocaleString(), 'The number of triangular facets in the tessellated mesh.'));
  const dx = geo.bbox.max[0] - geo.bbox.min[0];
  const dy = geo.bbox.max[1] - geo.bbox.min[1];
  const dz = geo.bbox.max[2] - geo.bbox.min[2];
  tbl.appendChild(rowHelp('Bounding box', `${dx.toFixed(2)} × ${dy.toFixed(2)} × ${dz.toFixed(2)} ${u}`, 'The smallest axis-aligned box that encloses the model, as width × depth × height.'));
  tbl.appendChild(rowHelp('Surface area', geo.area.toFixed(2) + ' ' + u + '²', 'Combined area of every triangle in the mesh.'));
  tbl.appendChild(rowHelp('Volume', geo.volume.toFixed(2) + ' ' + u + '³ (if watertight)', 'Enclosed volume - only meaningful for a watertight (fully closed) mesh.'));
  tbl.appendChild(sha256Row(file));
  card.appendChild(tbl);
  return card;
}

// ---------- multi-body detection (connected components) ----------

// Above this triangle count we skip body-splitting - the union-find weld pass is
// O(n) but the per-vertex hashing gets heavy, and merged display is fine for very
// large meshes. (Single combined viewer is still shown.)
export const BODY_SPLIT_CAP = 800000;

// Split an indexed mesh into connected components ("bodies"). Vertices are welded
// by quantized position (so meshes that duplicate coincident corners still join),
// then triangles sharing a welded vertex are union-found together. Returns an
// array of triangle-index arrays, largest body first. `step` is the weld
// tolerance (typically bbox span * 1e-6).
export function splitBodiesIndexed(verts, tris, step) {
  const nV = verts.length / 3;
  const triN = tris.length / 3;
  if (!triN) return [];
  const s = step || 1;
  const map = new Map();
  const wid = new Int32Array(nV);
  for (let v = 0; v < nV; v++) {
    const k = Math.round(verts[v * 3] / s) + '|' + Math.round(verts[v * 3 + 1] / s) + '|' + Math.round(verts[v * 3 + 2] / s);
    let id = map.get(k);
    if (id === undefined) { id = map.size; map.set(k, id); }
    wid[v] = id;
  }
  const parent = new Int32Array(map.size);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  for (let t = 0; t < triN; t++) {
    const a = wid[tris[t * 3]], b = wid[tris[t * 3 + 1]], c = wid[tris[t * 3 + 2]];
    union(a, b); union(b, c);
  }
  const groups = new Map();
  for (let t = 0; t < triN; t++) {
    const r = find(wid[tris[t * 3]]);
    let g = groups.get(r);
    if (!g) { g = []; groups.set(r, g); }
    g.push(t);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length);
}

// Same, for a non-indexed position buffer (count*9 floats, as STL produces):
// treat each triangle's three corners as consecutive vertices.
export function splitBodiesFromPositions(positions, step) {
  const nV = positions.length / 3;
  const tris = new Int32Array(nV);
  for (let i = 0; i < nV; i++) tris[i] = i;
  return splitBodiesIndexed(positions, tris, step);
}

// Pull a subset of triangle index-triples out of a flat index array.
export function subTris(tris, triIndices) {
  const out = new Array(triIndices.length * 3);
  let o = 0;
  for (const t of triIndices) { out[o++] = tris[t * 3]; out[o++] = tris[t * 3 + 1]; out[o++] = tris[t * 3 + 2]; }
  return out;
}

// Build a geometry from a subset of triangles of a non-indexed positions/normals
// pair (keeps the original facet normals).
export function geoFromTriSubset(positions, normals, triIndices, format) {
  const pos = new Float32Array(triIndices.length * 9);
  const nrm = new Float32Array(triIndices.length * 9);
  let o = 0;
  for (const t of triIndices) {
    const s = t * 9;
    for (let k = 0; k < 9; k++) { pos[o + k] = positions[s + k]; nrm[o + k] = normals[s + k]; }
    o += 9;
  }
  return makeResult(format, pos, nrm);
}

// The bbox span of a geometry, used to scale the weld tolerance to the model.
export function geoSpan(geo) {
  return Math.max(
    geo.bbox.max[0] - geo.bbox.min[0],
    geo.bbox.max[1] - geo.bbox.min[1],
    geo.bbox.max[2] - geo.bbox.min[2]
  ) || 1;
}

// ---------- multi-part viewer (3MF/AMF parts, or detected bodies) ----------

// Shared UI for models that hold several pieces: a parts picker, then the viewer,
// then the stats, then (optionally) a document-metadata card below. Each part is
// { key, name, build() -> geo } and is built lazily + cached. The viewer sits
// above the textual readouts. Reused by STL/OBJ/PLY/OFF/STEP body-splitting and
// by the 3MF/AMF container renderers.
export function renderPartsViewer(file, resultsEl, { metaCard, parts, format, unitLabel, partsTitle, partsHint }) {
  resultsEl.innerHTML = '';
  if (!parts.length) { resultsEl.appendChild(errorCard('No models found in this file.')); return; }

  const partsCard = el('div', { class: 'anr-card' });
  partsCard.appendChild(el('h3', {}, partsTitle || 'Models & assemblies'));
  partsCard.appendChild(el('p', { class: 'anr-hint', style: 'margin-bottom:10px;' }, partsHint || 'Pick a part to view it on its own, or see everything together.'));
  const chipRow = el('div', { class: 'anr-btn-row', style: 'flex-wrap:wrap;gap:6px;' });
  partsCard.appendChild(chipRow);
  resultsEl.appendChild(partsCard);

  // Viewer + stats are rebuilt in place each time a part is chosen; the document
  // metadata card (if any) sits below them so the viewer leads.
  let viewCardEl = el('div');
  let statsCardEl = el('div');
  resultsEl.appendChild(viewCardEl);
  resultsEl.appendChild(statsCardEl);
  if (metaCard) resultsEl.appendChild(metaCard);
  const geoCache = new Map();

  async function showPart(part, chip) {
    chipRow.querySelectorAll('.anr-part-chip').forEach((b) => b.classList.remove('is-active'));
    if (chip) chip.classList.add('is-active');
    const loading = el('div', { class: 'anr-card' }, [el('div', { class: 'anr-info' }, 'Building mesh…')]);
    const blankStats = el('div');
    viewCardEl.replaceWith(loading); viewCardEl = loading;
    statsCardEl.replaceWith(blankStats); statsCardEl = blankStats;
    // Yield so the "Building…" text paints before a heavy parse blocks the thread.
    await new Promise((r) => setTimeout(r, 0));
    let geo = geoCache.get(part.key);
    if (!geo) { try { geo = part.build(); } catch (_) { geo = null; } geoCache.set(part.key, geo); }

    if (!geo || !geo.count) {
      const errCard = el('div', { class: 'anr-card' }, [el('p', { class: 'anr-error' }, 'No mesh found for this part.')]);
      viewCardEl.replaceWith(errCard); viewCardEl = errCard;
      return;
    }
    const { viewCard, viewer } = buildViewerCard(geo, part.name);
    viewCardEl.replaceWith(viewCard); viewCardEl = viewCard;
    startViewer(viewer);
    const stats = geoStatsCard(geo, file, format, unitLabel);
    statsCardEl.replaceWith(stats); statsCardEl = stats;
  }

  parts.forEach((part) => {
    const chip = el('button', { type: 'button', class: 'anr-btn anr-part-chip' }, part.name);
    chip.addEventListener('click', () => showPart(part, chip));
    chipRow.appendChild(chip);
  });

  // Default view: the combined/whole model when several parts, else the only one.
  const first = chipRow.querySelector('.anr-part-chip');
  if (first) showPart(parts[0], first);
}

// Helper: from a whole-model geometry plus a list of detected body triangle-groups
// (largest first), build the parts array a renderPartsViewer expects.
export function bodyParts(whole, bodies, makeBodyGeo) {
  const parts = [{ key: 'all', name: `Whole model (${bodies.length} bodies)`, build: () => whole }];
  bodies.forEach((g, i) => parts.push({ key: 'b' + i, name: 'Body ' + (i + 1), build: () => makeBodyGeo(g, i) }));
  return parts;
}

// ---------- entry point ----------
export async function renderStl(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading 3D model "${file.name}"…`));

  let geo;
  try {
    const buf = await file.arrayBuffer();
    geo = parseStlGeometry(buf);
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read STL: ' + (e && e.message)));
    return;
  }
  resultsEl.innerHTML = '';
  if (!geo || !geo.count) {
    resultsEl.appendChild(errorCard('No triangles found in this STL.'));
    return;
  }

  // ---- Multi-body: a single STL often holds several disconnected solids. Split
  // into connected components and, when there's more than one, offer a per-body
  // viewer (like 3MF parts) instead of only the merged mesh.
  const bodies = geo.count <= BODY_SPLIT_CAP ? splitBodiesFromPositions(geo.positions, geoSpan(geo) * 1e-6) : [];
  if (bodies.length > 1) {
    const parts = bodyParts(geo, bodies, (g) => geoFromTriSubset(geo.positions, geo.normals, g, geo.format));
    renderPartsViewer(file, resultsEl, {
      parts, format: geo.format, unitLabel: 'units', partsTitle: 'Bodies',
      partsHint: `This STL contains ${bodies.length} separate bodies. Pick one to view on its own, or see them all together.`,
    });
    return;
  }

  // ---- 3D viewer card ----
  const { viewCard, viewer } = buildViewerCard(geo, '3D model');
  resultsEl.appendChild(viewCard);
  startViewer(viewer);

  // ---- Geometry stats ----
  const statsCard = el('div', { class: 'anr-card' });
  statsCard.appendChild(el('h3', {}, 'Geometry'));
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Format', geo.format));
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  tbl.appendChild(rowHelp('Triangles', geo.count.toLocaleString(), 'The number of triangular facets that make up the mesh. STL models describe surfaces entirely as triangles.'));
  tbl.appendChild(rowHelp('Vertices', (geo.count * 3).toLocaleString() + ' (non-indexed)', 'Total corner points, counted as 3 per triangle. STL stores them non-indexed, so shared corners are duplicated rather than referenced once.'));
  const dx = geo.bbox.max[0] - geo.bbox.min[0];
  const dy = geo.bbox.max[1] - geo.bbox.min[1];
  const dz = geo.bbox.max[2] - geo.bbox.min[2];
  tbl.appendChild(rowHelp('Bounding box', `${dx.toFixed(2)} × ${dy.toFixed(2)} × ${dz.toFixed(2)} (units)`, 'The smallest axis-aligned box that encloses the model, as width × depth × height. STL files are unitless, so these are in whatever units the file assumes (often mm).'));
  tbl.appendChild(rowHelp('Surface area', geo.area.toFixed(2) + ' units²', 'The combined area of all triangles in the mesh, expressed in the model’s own units squared.'));
  tbl.appendChild(rowHelp('Volume', geo.volume.toFixed(2) + ' units³ (if watertight)', 'The enclosed volume in the model’s units cubed. Only meaningful if the mesh is watertight - a fully closed solid with no holes or gaps.'));
  tbl.appendChild(sha256Row(file));
  statsCard.appendChild(tbl);
  statsCard.appendChild(el('p', { class: 'anr-hint', style: 'font-size:12px;margin-top:8px;' },
    'STL files carry no unit - dimensions are in the file’s own units (usually mm for 3D printing).'));
  resultsEl.appendChild(statsCard);
}
