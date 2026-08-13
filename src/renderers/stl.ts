/* Analyser - STL 3D viewer
   Parses binary and ASCII STL, renders an interactive WebGL model (orbit / zoom /
   spin), and reports geometry statistics (triangles, bounding box, surface area,
   volume). Self-contained - no external 3D library. */

import { el, row, rowHelp, fmtBytes, errorCard, attachViewCube } from '../core/util.js';

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

/** A parsed mesh. makeResult() fills the geometry; the per-format parsers add
 *  whatever else their file carried - vertex colours, UVs, a texture - so those
 *  ride as optional members rather than a separate object the viewer would have
 *  to thread through alongside the mesh. */
export interface MeshGeometry {
  format: any;
  positions: Float32Array;
  normals: Float32Array;
  count: number;
  bbox: { min: number[]; max: number[] };
  area: number;
  volume: number;
  /** Per-vertex RGB, when the format carries it (3MF, AMF, PLY, OBJ+MTL). */
  colors?: Float32Array;
  /** Per-vertex texture coordinates, with textureImage below. */
  uvs?: Float32Array;
  textureImage?: any;
}

export function makeResult(format, posArr, normArr): MeshGeometry {
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
function mat4Ortho(l, r, b, t, n, f) {
  return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]);
}

// The object buildViewer hands back. Two shapes: on WebGL failure only
// { wrap, ok:false } exists, and every caller checks `.ok` before touching the
// rest - so the failure path is asserted into this type rather than modelled as
// a discriminated union (which would not narrow anyway: `viewer` is a reassigned
// `let` captured by the toolbar handlers, and TypeScript drops narrowing of a
// mutable binding inside a closure). `state` is deliberately `any` - a bag of
// live render flags the toolbar pokes at by name, fully checked inside
// buildViewer where it is a plain inferred literal.
export interface StlViewer {
  wrap: HTMLDivElement;
  ok: boolean;
  state: any;
  resize: () => void;
  setSpin: (v: boolean) => void;
  snapshot: () => string | null;
  dispose: () => void;
  onSpinChange: (cb: (spin: boolean) => void) => void;
  start: () => void;
  markDirty: () => void;
}

// ---------- WebGL viewer ----------
function buildViewer(geo, opts: any = {}): StlViewer {
  const wrap = el('div', { class: 'anr-stl-viewport' });
  const canvas = el('canvas', { class: 'anr-stl-canvas' });
  wrap.appendChild(canvas);
  // preserveDrawingBuffer keeps the last rendered frame readable after compositing,
  // so the export (toDataURL) can snapshot the live preview - without it a WebGL
  // canvas reads back blank once the frame has been presented.
  // antialias asks the driver for hardware MSAA on the default framebuffer; it can
  // only be set here (at context creation), so the Quality toggle rebuilds the
  // viewer to change it. Defaults on.
  const msaa = opts.antialias !== false;
  // zUp: the model was authored Z-up (STL/3MF/AMF/STEP/IGES/BREP). The viewer is
  // Y-up, so a view-only -90 deg rotation about X stands these models upright.
  const zUp = opts.zUp === true;
  const glOpts = { preserveDrawingBuffer: true, antialias: msaa };
  // The 'experimental-webgl' fallback (old Safari/IE) is not in TypeScript's
  // getContext overloads, so the expression degrades to the generic
  // RenderingContext union. Both branches really are a WebGL context.
  const gl = (canvas.getContext('webgl', glOpts)
    || canvas.getContext('experimental-webgl', glOpts)) as WebGLRenderingContext;
  if (!gl) {
    wrap.appendChild(el('p', { class: 'anr-error' }, 'WebGL is not available in this browser.'));
    return { wrap, ok: false } as StlViewer;
  }

  // Normalise geometry: centre on origin and scale longest edge to 1.
  const { min, max } = geo.bbox;
  const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, cz = (min[2] + max[2]) / 2;
  const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const np = new Float32Array(geo.positions.length);
  let boundR2 = 0;
  for (let i = 0; i < geo.positions.length; i += 3) {
    np[i] = (geo.positions[i] - cx) / span;
    np[i + 1] = (geo.positions[i + 1] - cy) / span;
    np[i + 2] = (geo.positions[i + 2] - cz) / span;
    const r2 = np[i] * np[i] + np[i + 1] * np[i + 1] + np[i + 2] * np[i + 2];
    if (r2 > boundR2) boundR2 = r2;
  }
  // Radius of the bounding sphere (centred on the origin) - used to frame the
  // isometric export snapshot so the model fills the preview with even margins.
  const boundR = Math.sqrt(boundR2) || 0.5;

  // Wireframe overlay (mesh topology) is drawn from a per-vertex barycentric coord:
  // each triangle's three corners carry (1,0,0)/(0,1,0)/(0,0,1), and the fragment
  // shader lights up where any coord nears 0 (a triangle edge). Crisp edges need
  // derivatives (OES_standard_derivatives); without it we fall back to a fixed
  // width that still reads fine.
  const deriv = gl.getExtension('OES_standard_derivatives');
  const vsrc = `attribute vec3 aPos; attribute vec3 aNormal; attribute vec3 aBary;
    attribute vec3 aColor; attribute vec2 aUV;
    uniform mat4 uProj, uView, uModel;
    varying vec3 vN; varying vec3 vNe; varying vec3 vP; varying vec3 vBary; varying vec3 vCol; varying vec2 vUV;
    void main(){ vec4 w = uModel*vec4(aPos,1.0); vec4 vp = uView*w;
      gl_Position = uProj*vp; vN = mat3(uModel)*aNormal; vNe = mat3(uView*uModel)*aNormal; vP = vp.xyz; vBary = aBary; vCol = aColor; vUV = aUV; }`;
  const fsrc = `${deriv ? '#extension GL_OES_standard_derivatives : enable\n' : ''}precision mediump float;
    varying vec3 vN; varying vec3 vNe; varying vec3 vP; varying vec3 vBary; varying vec3 vCol; varying vec2 vUV;
    uniform vec3 uColor; uniform float uWire; uniform float uHasVCol; uniform float uHasTex; uniform sampler2D uTex; uniform float uReal;
    void main(){
      // Base albedo: a texture sample (OBJ map_Kd) wins, then per-vertex colour
      // (OBJ material Kd baked per-vertex, or embedded vertex colours), else the
      // single uniform colour used by STL/STEP and the colour picker.
      vec3 base = uColor;
      if(uHasVCol > 0.5) base = vCol;
      if(uHasTex > 0.5) base = texture2D(uTex, vUV).rgb;
      vec3 c;
      if(uReal > 0.5){
        // Realistic view: OrcaSlicer-style two fixed (eye-space) lights, Blinn-Phong
        // with a soft specular for a moulded, lit-from-above look.
        vec3 N = normalize(vNe); vec3 V = normalize(-vP);
        vec3 LT = vec3(-0.4574957,0.4574957,0.7624929), LF = vec3(0.6985074,0.1397015,0.6985074);
        float diff = 0.25 + max(dot(N,LT),0.0)*0.55 + max(dot(N,LF),0.0)*0.22;
        float spec = 0.22*pow(max(dot(N,normalize(LT+V)),0.0),32.0) + 0.07*pow(max(dot(N,normalize(LF+V)),0.0),16.0);
        c = clamp(base*diff + vec3(spec), 0.0, 1.0);
      } else {
        vec3 N = normalize(vN); vec3 L = normalize(vec3(0.35,0.6,0.8));
        float d = max(dot(N,L),0.0); float b = max(dot(-N,L),0.0);
        float lit = max(d, b*0.55);
        c = base*(0.28+0.72*lit);
      }
      if(uWire > 0.5){
        ${deriv
          ? 'vec3 w = fwidth(vBary); vec3 a = smoothstep(vec3(0.0), w*1.3, vBary); float e = min(min(a.x,a.y),a.z);'
          : 'vec3 a = step(vec3(0.018), vBary); float e = min(min(a.x,a.y),a.z);'}
        // Bright edges over a dimmed shaded surface, so form and topology both read.
        vec3 line = vec3(0.86,0.91,1.0);
        c = mix(line, c*0.45, e);
      }
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

  // Per-vertex barycentric coords (one triangle = three corners, cycling the basis).
  const bary = new Float32Array(np.length);
  for (let i = 0; i < bary.length; i += 9) { bary[i] = 1; bary[i + 4] = 1; bary[i + 8] = 1; }
  const baryBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, baryBuf);
  gl.bufferData(gl.ARRAY_BUFFER, bary, gl.STATIC_DRAW);
  const aBary = gl.getAttribLocation(prog, 'aBary');
  gl.enableVertexAttribArray(aBary);
  gl.vertexAttribPointer(aBary, 3, gl.FLOAT, false, 0, 0);

  // Optional per-vertex colour (OBJ material Kd baked per-vertex, or embedded
  // vertex colours). Defaults to white so the uniform colour drives the look when
  // a geometry carries none - keeping STL/STEP/3MF rendering identical.
  const hasVCol = !!(geo.colors && geo.colors.length === np.length);
  const colArr = hasVCol ? geo.colors : (() => { const a = new Float32Array(np.length); a.fill(1); return a; })();
  const colBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
  gl.bufferData(gl.ARRAY_BUFFER, colArr, gl.STATIC_DRAW);
  const aColor = gl.getAttribLocation(prog, 'aColor');
  if (aColor >= 0) { gl.enableVertexAttribArray(aColor); gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, 0, 0); }

  // Optional texture coords (OBJ vt) + a single texture image (OBJ map_Kd).
  const uvCount = np.length / 3 * 2;
  const uvArr = (geo.uvs && geo.uvs.length === uvCount) ? geo.uvs : new Float32Array(uvCount);
  const uvBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
  gl.bufferData(gl.ARRAY_BUFFER, uvArr, gl.STATIC_DRAW);
  const aUV = gl.getAttribLocation(prog, 'aUV');
  if (aUV >= 0) { gl.enableVertexAttribArray(aUV); gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 0, 0); }

  let tex = null;
  if (geo.uvs && geo.textureImage) {
    try {
      const img = geo.textureImage;
      const isPow2 = (n) => (n & (n - 1)) === 0;
      const wrap = (isPow2(img.width) && isPow2(img.height)) ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);   // OBJ uv origin is bottom-left
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    } catch (_) { tex = null; }
  }

  const uProj = gl.getUniformLocation(prog, 'uProj');
  const uView = gl.getUniformLocation(prog, 'uView');
  const uModel = gl.getUniformLocation(prog, 'uModel');
  const uColor = gl.getUniformLocation(prog, 'uColor');
  const uWire = gl.getUniformLocation(prog, 'uWire');
  const uHasVCol = gl.getUniformLocation(prog, 'uHasVCol');
  const uHasTex = gl.getUniformLocation(prog, 'uHasTex');
  const uTex = gl.getUniformLocation(prog, 'uTex');
  const uReal = gl.getUniformLocation(prog, 'uReal');
  gl.enable(gl.DEPTH_TEST);

  const state = { yaw: 0.6, pitch: 0.5, dist: 2.6, panX: 0, panY: 0, color: [0.55, 0.62, 0.95], spin: true, ortho: false, wire: false, real: false, bg: [0, 0, 0], msaa, ssaa: true, upZ: zUp };
  let dirty = true;
  let disposed = false;
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
    // Supersampling: render the canvas above its CSS size and let the browser
    // downsample (SSAA). Off = native device pixels only.
    const ss = state.ssaa ? 1.5 : 1;
    const dpr = Math.min((window.devicePixelRatio || 1) * ss, 3);
    const w = wrap.clientWidth || 600, h = wrap.clientHeight || 420;
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    dirty = true;
  }

  function draw() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(state.bg[0], state.bg[1], state.bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const aspect = canvas.width / canvas.height || 1;
    let proj;
    if (state.ortho) { const hh = state.dist * 0.4142; proj = mat4Ortho(-hh * aspect, hh * aspect, -hh, hh, 0.005, 1000); }
    else proj = mat4Perspective(45 * Math.PI / 180, aspect, 0.005, 1000);
    const view = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, state.panX, state.panY, -state.dist, 1]);
    let model = mat4Multiply(mat4RotX(state.pitch), mat4RotY(state.yaw));
    // Up-axis fix as the innermost transform: rotate the model itself before the
    // orbit, so Z-up geometry reads upright and the view-cube/orbit stay correct.
    if (state.upZ) model = mat4Multiply(model, mat4RotX(-Math.PI / 2));
    gl.uniformMatrix4fv(uProj, false, proj);
    gl.uniformMatrix4fv(uView, false, view);
    gl.uniformMatrix4fv(uModel, false, model);
    gl.uniform3fv(uColor, state.color);
    gl.uniform1f(uWire, state.wire ? 1 : 0);
    gl.uniform1f(uReal, state.real ? 1 : 0);
    gl.uniform1f(uHasVCol, hasVCol ? 1 : 0);
    if (tex) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(uTex, 0);
      gl.uniform1f(uHasTex, 1);
    } else gl.uniform1f(uHasTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, np.length / 3);
  }

  function loop() {
    if (disposed) return;
    // Once the viewer's card leaves the DOM (new file opened, SPA nav away),
    // free its WebGL context instead of just stopping the loop - browsers cap
    // the number of live contexts (~16 on Chromium) and orphaned ones make
    // later viewers render blank until GC eventually reclaims them.
    if (!wrap.isConnected) { dispose(); return; }
    if (state.spin) { state.yaw += 0.003; dirty = true; }
    if (dirty) { draw(); dirty = false; }
    requestAnimationFrame(loop);
  }

  // Orbit (left-drag), pan (right-drag or Shift+drag), zoom (wheel). Touch: one
  // finger orbits, two fingers pan + pinch-zoom.
  let dragging = false, panning = false, lx = 0, ly = 0;
  const panK = () => state.dist * 0.0018;
  const down = (x, y, pan) => { dragging = true; panning = pan; lx = x; ly = y; setSpin(false); };
  const move = (x, y) => {
    if (!dragging) return;
    if (panning) {
      state.panX += (x - lx) * panK();
      state.panY -= (y - ly) * panK();
    } else {
      state.yaw += (x - lx) * 0.01; state.pitch += (y - ly) * 0.01;
      state.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, state.pitch));
    }
    lx = x; ly = y; dirty = true;
  };
  const up = () => { dragging = false; panning = false; };
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => down(e.clientX, e.clientY, e.button === 2 || e.shiftKey));
  // Named so dispose() can detach them - these live on window, so they outlive
  // the canvas unless explicitly removed.
  const onWinMove = (e) => move(e.clientX, e.clientY);
  window.addEventListener('mousemove', onWinMove);
  window.addEventListener('mouseup', up);
  // Touch: one finger orbits; two fingers pan + pinch-zoom.
  let twoFinger = false, pinchDist = 0, pcx = 0, pcy = 0;
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      twoFinger = true; dragging = false; setSpin(false);
      const a = e.touches[0], b = e.touches[1];
      pinchDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pcx = (a.clientX + b.clientX) / 2; pcy = (a.clientY + b.clientY) / 2;
    } else if (e.touches[0]) { twoFinger = false; down(e.touches[0].clientX, e.touches[0].clientY, false); }
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    if (twoFinger && e.touches.length === 2) {
      const a = e.touches[0], b = e.touches[1];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const mx = (a.clientX + b.clientX) / 2, my = (a.clientY + b.clientY) / 2;
      if (pinchDist > 0) state.dist = Math.max(0.04, Math.min(150,state.dist * (pinchDist / (d || 1))));
      state.panX += (mx - pcx) * panK(); state.panY -= (my - pcy) * panK();
      pinchDist = d; pcx = mx; pcy = my; dirty = true; e.preventDefault();
    } else if (!twoFinger && e.touches[0]) { move(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }
  }, { passive: false });
  canvas.addEventListener('touchend', (e) => { if (!e.touches.length) { up(); twoFinger = false; } });
  // Shared zoom step for the wheel and the manual +/- pad (identical to the G-code
  // viewer): factor < 1 moves the camera in, > 1 out, clamped to the orbit range.
  function zoomBy(factor) { state.dist = Math.max(0.04, Math.min(150, state.dist * factor)); dirty = true; }

  // Canvas-anchored camera stack, laid out exactly like the G-code viewer: the
  // manual zoom pad on top, the scroll-zoom toggle, then the fullscreen button at
  // the bottom-right corner (the view cube owns bottom-left). Built into the viewer
  // so it survives the MSAA rebuild (which swaps the canvas) and shows in fullscreen.

  // Scroll-zoom toggle - OFF by default so the wheel scrolls the page until the
  // user opts in. Gate the wheel handler on wheelOn BEFORE preventDefault, so a
  // disabled viewer lets the wheel scroll the page through it.
  let wheelOn = false;
  const wheelZoomBtn = el('button', { type: 'button', class: 'anr-btn anr-cam-zoombtn', 'aria-pressed': 'false' });
  const paintWheel = () => {
    wheelZoomBtn.textContent = wheelOn ? 'Scroll zoom on' : 'Scroll zoom off';
    wheelZoomBtn.title = wheelOn ? 'Scrolling over the viewer zooms it. Click to let the wheel scroll the page instead.'
                                 : 'Scrolling over the viewer moves the page. Click to zoom with the scroll wheel again.';
    wheelZoomBtn.setAttribute('aria-pressed', wheelOn ? 'true' : 'false');
    wheelZoomBtn.classList.toggle('is-active', wheelOn);   // red while on, like every toggle
  };
  wheelZoomBtn.addEventListener('click', (e) => { e.stopPropagation(); wheelOn = !wheelOn; paintWheel(); });
  wheelZoomBtn.addEventListener('pointerdown', (e) => e.stopPropagation());   // a press must not also start an orbit
  paintWheel();
  canvas.addEventListener('wheel', (e) => { if (!wheelOn) return; e.preventDefault(); zoomBy(1 + Math.sign(e.deltaY) * 0.1); }, { passive: false });

  // Manual zoom pad (+ over -): a press-and-hold repeats the zoom step on a timer,
  // so you can ride the camera in or out without spamming clicks. Pointer capture
  // keeps it zooming even if the finger/cursor drifts off the button mid-hold.
  function holdZoom(btn, factor) {
    let timer = null;
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      try { btn.setPointerCapture(e.pointerId); } catch (_) {}
      zoomBy(factor);                                   // one step immediately on press
      stop(); timer = setInterval(() => zoomBy(factor), 60);
    });
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointercancel', stop);
    btn.addEventListener('lostpointercapture', stop);
  }
  const zoomInBtn = el('button', { type: 'button', class: 'anr-btn anr-cam-zbtn', title: 'Zoom in (hold)', 'aria-label': 'Zoom in' }, '+');
  const zoomOutBtn = el('button', { type: 'button', class: 'anr-btn anr-cam-zbtn', title: 'Zoom out (hold)', 'aria-label': 'Zoom out' }, '−');
  holdZoom(zoomInBtn, 0.94);
  holdZoom(zoomOutBtn, 1.06);
  const zoomPad = el('div', { class: 'anr-cam-pad' }, [zoomInBtn, zoomOutBtn]);

  // Fullscreen toggle anchored at the corner - the shared camera-stack twin of the
  // one in the G-code viewer (the card's toolbar no longer carries a separate one).
  const camFsBtn = el('button', { type: 'button', class: 'anr-btn anr-cam-fsbtn', title: 'Toggle fullscreen', 'aria-label': 'Toggle fullscreen' }, 'Fullscreen');
  camFsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (document.fullscreenElement) document.exitFullscreen();
    else if (wrap.requestFullscreen) wrap.requestFullscreen();
  });
  wrap.addEventListener('fullscreenchange', () => { camFsBtn.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen'; setTimeout(resize, 50); });

  // Bottom-right camera stack: zoom pad on top, scroll-zoom toggle, fullscreen.
  wrap.appendChild(el('div', { class: 'anr-cam' }, [zoomPad, wheelZoomBtn, camFsBtn]));

  // Render one off-axis isometric frame, framed so the model's bounding sphere
  // fills ~96% of the narrower field of view (2% margins), and read it back as a PNG
  // data URL. Used by the data export (the canvas exposes it as _anrSnapshot).
  // Saves and restores the live view state, so the interactive preview is
  // unaffected beyond a single redraw.
  function snapshot() {
    const saved = { yaw: state.yaw, pitch: state.pitch, dist: state.dist, spin: state.spin, ortho: state.ortho, panX: state.panX, panY: state.panY };
    state.spin = false; state.ortho = false;
    state.panX = 0; state.panY = 0;             // centre the framing
    state.yaw = Math.PI / 4;                    // 45° azimuth
    state.pitch = Math.atan(1 / Math.SQRT2);    // ~35.26° - the classic isometric tilt, from above
    // Fit the bounding sphere to 96% of the narrower field of view (so both the
    // width and height keep a 2% margin), then back the camera off to suit.
    const aspect = (canvas.width / canvas.height) || 1;
    const halfFovV = (45 * Math.PI / 180) / 2;
    const halfFov = Math.min(halfFovV, Math.atan(Math.tan(halfFovV) * aspect));
    const theta = Math.atan(0.96 * Math.tan(halfFov));
    state.dist = boundR / Math.sin(theta);
    draw();
    let url = null;
    try { url = canvas.toDataURL('image/png'); } catch (_) { url = null; }
    Object.assign(state, saved);
    dirty = true;
    return url;
  }
  canvas._anrSnapshot = snapshot;

  // Tear the viewer down: stop the loop, detach the window-level listeners, and
  // explicitly drop the WebGL context so it doesn't count against the browser's
  // live-context cap. Called on MSAA rebuild and automatically when the card
  // leaves the DOM (see loop()). Idempotent.
  function dispose() {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('mousemove', onWinMove);
    window.removeEventListener('mouseup', up);
    window.removeEventListener('resize', resize);
    try { const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); } catch (_) { /* ignore */ }
  }

  const api = {
    wrap, ok: true, state, resize, setSpin, snapshot, dispose,
    onSpinChange: (cb) => spinListeners.push(cb),
    start: () => { resize(); requestAnimationFrame(loop); },
    markDirty: () => { dirty = true; },
  };
  attachViewCube(api);
  return api;
}

// Build a "3D model" card around a geometry: the WebGL viewer plus the spin /
// reset / colour / fullscreen controls. Returns { viewCard, viewer }. The caller
// appends viewCard to the DOM, then calls startViewer(viewer) once it's attached
// (the viewer measures its container, so it must be in the document first).
// Reused by the STL, STEP/IGES and 3MF renderers.
export function buildViewerCard(geo, title = '3D model', opts: any = {}) {
  const viewCard = el('div', { class: 'anr-card' });
  viewCard.appendChild(el('h3', {}, title));
  let viewer = buildViewer(geo, opts);
  viewCard.appendChild(viewer.wrap);

  if (viewer.ok) {
    const controls = el('div', { class: 'anr-btn-row', style: 'margin-top:10px;align-items:center;flex-wrap:wrap;' });
    const spinBtn = el('button', { type: 'button', class: 'anr-btn' }, viewer.state.spin ? 'Pause spin' : 'Resume spin');
    const updateSpin = (spinning) => { spinBtn.textContent = spinning ? 'Pause spin' : 'Resume spin'; };
    // Toggle via the button, but also reflect spin stopping when the user clicks
    // into the canvas - onSpinChange fires for either trigger.
    spinBtn.addEventListener('click', () => viewer.setSpin(!viewer.state.spin));
    viewer.onSpinChange(updateSpin);

    // Quality popup (hardware MSAA + supersampling), exactly like the G-code viewer.
    // Toggling MSAA needs a fresh WebGL context, so rebuild the viewer on a new
    // canvas and carry the camera/display state across; every control reads
    // `viewer` by binding, so they keep working after the swap.
    function applyMSAA(on) {
      const s = viewer.state;
      const keep = { yaw: s.yaw, pitch: s.pitch, dist: s.dist, panX: s.panX, panY: s.panY, color: s.color, spin: s.spin, ortho: s.ortho, wire: s.wire, real: s.real, bg: s.bg, ssaa: s.ssaa, upZ: s.upZ };
      const next = buildViewer(geo, { antialias: on, zUp: opts.zUp });
      if (!next.ok) return;                        // keep the working viewer if rebuild fails
      const old = viewer; viewer = next;
      Object.assign(viewer.state, keep, { msaa: on });
      old.wrap.replaceWith(viewer.wrap);
      old.dispose();                               // free the old GL context + its listeners
      viewer.onSpinChange(updateSpin);
      viewer.start();
      window.addEventListener('resize', viewer.resize);
      viewer.markDirty();
    }
    const qWrap = el('span', { class: 'anr-aa-wrap' });
    const qBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Quality');
    const qPanel = el('div', { class: 'anr-aa-panel is-hidden' });
    qPanel.appendChild(el('div', { class: 'anr-aa-title' }, 'Quality'));
    const aaBtn = (label, get, set) => {
      const btn = el('button', { type: 'button', class: 'anr-btn anr-aa-btn' }, label);
      const sync = () => btn.classList.toggle('is-on', !!get());
      sync();
      btn.addEventListener('click', () => { set(!get()); sync(); });
      qPanel.appendChild(btn);
    };
    // aaBtn('Realistic view', () => viewer.state.real, (v) => { viewer.state.real = v; viewer.markDirty(); });
    aaBtn('Hardware MSAA', () => viewer.state.msaa, (v) => applyMSAA(v));
    aaBtn('Supersampling', () => viewer.state.ssaa, (v) => { viewer.state.ssaa = v; viewer.resize(); viewer.markDirty(); });
    qBtn.addEventListener('click', (e) => { e.stopPropagation(); qPanel.classList.toggle('is-hidden'); });
    document.addEventListener('click', (e) => { if (!qWrap.contains(e.target as Node)) qPanel.classList.add('is-hidden'); });
    qWrap.appendChild(qBtn); qWrap.appendChild(qPanel);
    const resetBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Reset view');
    resetBtn.addEventListener('click', () => {
      const s = viewer.state;
      // Pause spin so the auto-rotation in loop() doesn't fight the tween's yaw.
      if (s.spin && viewer.setSpin) viewer.setSpin(false);
      const from = { yaw: s.yaw, pitch: s.pitch, dist: s.dist, panX: s.panX, panY: s.panY };
      const to = { yaw: 0.6, pitch: 0.5, dist: 2.6, panX: 0, panY: 0 };
      // Take the shortest way round on yaw (it accumulates freely while spinning).
      let dyaw = to.yaw - from.yaw;
      while (dyaw > Math.PI) dyaw -= 2 * Math.PI;
      while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
      const dur = 320; let t0 = 0;
      if (resetBtn._anim) cancelAnimationFrame(resetBtn._anim);
      const tick = (ts) => {
        if (!t0) t0 = ts;
        const k = Math.min(1, (ts - t0) / dur);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;   // ease-in-out, matching the view-cube
        s.yaw = from.yaw + dyaw * e;
        s.pitch = from.pitch + (to.pitch - from.pitch) * e;
        s.dist = from.dist + (to.dist - from.dist) * e;
        s.panX = from.panX + (to.panX - from.panX) * e;
        s.panY = from.panY + (to.panY - from.panY) * e;
        viewer.markDirty();
        resetBtn._anim = k < 1 ? requestAnimationFrame(tick) : 0;
      };
      resetBtn._anim = requestAnimationFrame(tick);
    });
    const projBtn = el('button', { type: 'button', class: 'anr-btn' }, viewer.state.ortho ? 'Orthographic' : 'Perspective');
    projBtn.addEventListener('click', () => {
      viewer.state.ortho = !viewer.state.ortho;
      projBtn.textContent = viewer.state.ortho ? 'Orthographic' : 'Perspective';
      viewer.markDirty();
    });
    const wireBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Wireframe');
    wireBtn.addEventListener('click', () => {
      viewer.state.wire = !viewer.state.wire;
      wireBtn.classList.toggle('is-active', viewer.state.wire);
      viewer.markDirty();
    });
    // Up-axis toggle: most CAD/printing formats are Z-up, design/glTF are Y-up.
    // Defaults to the format's convention; this lets the user flip any model.
    const upBtn = el('button', { type: 'button', class: 'anr-btn' }, viewer.state.upZ ? 'Z-up' : 'Y-up');
    upBtn.title = 'Flip which axis points up';
    upBtn.addEventListener('click', () => {
      viewer.state.upZ = !viewer.state.upZ;
      upBtn.textContent = viewer.state.upZ ? 'Z-up' : 'Y-up';
      viewer.markDirty();
    });
    const colorInput = el('input', { type: 'color', value: '#8c9eef', title: 'Model colour', style: 'width:40px;height:36px;box-sizing:border-box;padding:0;border:1px solid var(--hairline);background:none;cursor:pointer;' });
    colorInput.addEventListener('input', () => {
      const h = colorInput.value;
      viewer.state.color = [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
      viewer.markDirty();
    });
    // Fullscreen now lives in the canvas-anchored camera stack (built in
    // buildViewer, matching the G-code viewer), so the toolbar no longer carries
    // its own fullscreen button.
    controls.appendChild(spinBtn);
    controls.appendChild(resetBtn);
    controls.appendChild(projBtn);
    controls.appendChild(wireBtn);
    controls.appendChild(upBtn);
    controls.appendChild(qWrap);
    // The colour picker sets the single uniform colour; hide it when the model
    // carries its own per-vertex colours or a texture (they override it anyway).
    if (!(geo.colors || geo.textureImage)) controls.appendChild(colorInput);
    controls.appendChild(el('span', { class: 'anr-hint', style: 'font-size:12px;margin-left:auto;' }, 'drag to orbit · scroll to zoom'));
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
  tbl.appendChild(rowHelp('Triangles', geo.count.toLocaleString(), 'How many tiny triangles the model is built from. STL shapes are made up entirely of flat triangular patches.'));
  const dx = geo.bbox.max[0] - geo.bbox.min[0];
  const dy = geo.bbox.max[1] - geo.bbox.min[1];
  const dz = geo.bbox.max[2] - geo.bbox.min[2];
  tbl.appendChild(rowHelp('Bounding box', `${dx.toFixed(2)} × ${dy.toFixed(2)} × ${dz.toFixed(2)} ${u}`, 'The size of the smallest upright box the whole model would fit inside, given as width × depth × height.'));
  tbl.appendChild(rowHelp('Surface area', geo.area.toFixed(2) + ' ' + u + '²', 'The total area of the model’s outer surface, added up from all its triangles.'));
  tbl.appendChild(rowHelp('Volume', geo.volume.toFixed(2) + ' ' + u + '³ (if watertight)', 'How much space the model encloses inside. This only makes sense if the model is fully sealed with no gaps (watertight).'));
  card.appendChild(tbl);
  return card;
}

// ---------- mesh integrity (topological irregularities) ----------

// Examine an expanded (non-indexed) triangle soup for the topological faults that
// matter for 3D printing / CAD - non-manifold edges, open boundaries (holes),
// degenerate and duplicate faces, and inconsistent facet winding. Corners are
// welded by quantized position first (`step` = bbox span * ~1e-6), so meshes that
// duplicate coincident corners (STL always does) are treated as one surface.
// Returns a metrics object, or { tooLarge:true } for meshes above BODY_SPLIT_CAP,
// or null for an empty mesh. Universal: every renderer's geometry carries the same
// non-indexed `positions` buffer, so this one function covers all 3D file types.
export function analyzeMeshIntegrity(positions, step) {
  const nCorners = positions.length / 3;
  const triN = nCorners / 3;
  if (!triN) return null;
  if (triN > BODY_SPLIT_CAP) return { tooLarge: true, triN };
  const s = step || 1;

  // Weld corners -> a compact welded-vertex id per corner.
  const map = new Map();
  const wid = new Int32Array(nCorners);
  for (let i = 0; i < nCorners; i++) {
    const k = Math.round(positions[i * 3] / s) + '|' + Math.round(positions[i * 3 + 1] / s) + '|' + Math.round(positions[i * 3 + 2] / s);
    let id = map.get(k);
    if (id === undefined) { id = map.size; map.set(k, id); }
    wid[i] = id;
  }
  const V = map.size;

  // Edge pass. Each undirected edge (lo,hi) keys a [useCount, dirSum] pair, where
  // dirSum sums +1 for a face traversing lo->hi and -1 for hi->lo. A well-formed
  // 2-manifold edge is used by exactly two faces in opposite directions (dirSum 0);
  // dirSum != 0 on a 2-use edge means the two faces disagree on winding (one flipped).
  const edges = new Map();
  const addEdge = (a, b) => {
    const lo = a < b ? a : b, hi = a < b ? b : a;
    const key = lo * V + hi;
    let e = edges.get(key);
    if (!e) { e = [0, 0]; edges.set(key, e); }
    e[0]++; e[1] += (a < b) ? 1 : -1;
  };
  // Duplicate-face detection is a string-keyed Set, so gate it to a smaller mesh to
  // keep memory bounded; the edge/manifold checks always run up to BODY_SPLIT_CAP.
  const dupCheck = triN <= 300000;
  const seenTri = dupCheck ? new Set() : null;
  let degenerate = 0, duplicate = 0;
  for (let t = 0; t < triN; t++) {
    const a = wid[t * 3], b = wid[t * 3 + 1], c = wid[t * 3 + 2];
    if (a === b || b === c || a === c) { degenerate++; continue; }   // collapsed corners -> zero area
    if (seenTri) {
      let x = a, y = b, z = c, tmp;
      if (x > y) { tmp = x; x = y; y = tmp; }
      if (y > z) { tmp = y; y = z; z = tmp; }
      if (x > y) { tmp = x; x = y; y = tmp; }
      const tk = x + '_' + y + '_' + z;
      if (seenTri.has(tk)) duplicate++; else seenTri.add(tk);
    }
    addEdge(a, b); addEdge(b, c); addEdge(c, a);
  }

  // Tally edge classes and collect boundary edges for hole-loop counting.
  let boundaryEdges = 0, nonManifoldEdges = 0, flipped = 0;
  const edgeCount = edges.size;
  const boundaryKeys = [];
  for (const [key, e] of edges) {
    if (e[0] === 1) { boundaryEdges++; boundaryKeys.push(key); }
    else if (e[0] === 2) { if (e[1] !== 0) flipped++; }
    else if (e[0] > 2) nonManifoldEdges++;
  }

  // Holes = connected components of the boundary-edge graph (each open loop is one
  // hole). Union-find over just the welded vertices that touch a boundary edge.
  let holes = 0;
  if (boundaryEdges && boundaryEdges <= 500000) {
    const comp = new Map();
    const find = (x) => { let r = x; while (comp.get(r) !== r) r = comp.get(r); while (comp.get(x) !== r) { const n = comp.get(x); comp.set(x, r); x = n; } return r; };
    const ensure = (x) => { if (!comp.has(x)) comp.set(x, x); };
    for (const key of boundaryKeys) {
      const hi = key % V, lo = (key - hi) / V;
      ensure(lo); ensure(hi);
      const ra = find(lo), rb = find(hi);
      if (ra !== rb) comp.set(ra, rb);
    }
    const roots = new Set();
    for (const x of comp.keys()) roots.add(find(x));
    holes = roots.size;
  }

  const faces = triN - degenerate;
  const isClosed = faces > 0 && boundaryEdges === 0;
  const isManifold = nonManifoldEdges === 0;
  const isWatertight = isClosed && isManifold;
  const consistent = flipped === 0;
  const euler = V - edgeCount + faces;   // V - E + F

  return {
    tooLarge: false, triN, weldedVerts: V, edgeCount, faces,
    boundaryEdges, nonManifoldEdges, degenerate, duplicate, dupCheck, flipped, holes,
    isClosed, isManifold, isWatertight, consistent, euler,
  };
}

// A "Mesh integrity" card: the topological verdict (watertight / manifold) plus a
// row per detected fault and a plain-language note. A compact verdict badge in the
// heading (.anr-mesh-verdict) reads "Watertight" in neutral ink for a clean solid,
// or "Faults found" in accent when any irregularity is present - a native readout
// card, not the forensic .anr-sig-flag alert. `opts.span` overrides the weld
// tolerance basis (defaults to the geometry's bbox span). Shown by every 3D
// renderer beneath the geometry stats.
export function meshIntegrityCard(geo, opts: any = {}) {
  const span = (opts.span || geoSpan(geo));
  const a = analyzeMeshIntegrity(geo.positions, span * 1e-6);
  const card = el('div', { class: 'anr-card anr-mesh-card' });
  const heading = el('h3', {}, 'Mesh integrity');
  card.appendChild(heading);
  if (!a) { card.appendChild(el('p', { class: 'anr-hint' }, 'No mesh geometry to check.')); return card; }
  if (a.tooLarge) {
    card.appendChild(el('p', { class: 'anr-hint' },
      `This mesh has ${a.triN.toLocaleString()} triangles - too many to scan for topological errors quickly, so the integrity check was skipped.`));
    return card;
  }

  const problems = a.boundaryEdges || a.nonManifoldEdges || a.degenerate || a.duplicate || a.flipped;
  heading.appendChild(el('span', { class: 'anr-mesh-verdict ' + (problems ? 'is-flag' : 'is-ok') },
    problems ? 'Faults found' : 'Watertight'));

  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(rowHelp('Watertight', a.isWatertight ? 'Yes' : 'No',
    'The surface is fully sealed with no holes or gaps, so it forms a solid object - every edge joins exactly two triangles. Only a sealed model has a real inside volume and prints reliably.'));
  tbl.appendChild(rowHelp('Manifold', a.isManifold ? 'Yes' : 'No',
    'The surface is joined cleanly, with no edge where more than two triangles meet. Edges that break this rule confuse slicers and CAD tools, and can make cut-and-combine (boolean) operations fail.'));
  if (a.boundaryEdges) tbl.appendChild(rowHelp('Open edges', a.boundaryEdges.toLocaleString() + (a.holes ? ` (${a.holes.toLocaleString()} ${a.holes === 1 ? 'hole' : 'holes'})` : ''),
    'Edges that belong to only one triangle instead of two. Each one is the border of a hole or gap, so the surface is not fully sealed.'));
  if (a.nonManifoldEdges) tbl.appendChild(rowHelp('Non-manifold edges', a.nonManifoldEdges.toLocaleString(),
    'A place where too many surfaces meet along the same line. On a normal solid object, exactly two surfaces meet at each edge - like two walls meeting in the corner of a room. Here a third surface joins in, which cannot happen on a real object, so the shape has no clear inside and outside. 3D printers and modelling tools get confused by this and often fail.'));
  if (a.flipped) tbl.appendChild(rowHelp('Inconsistent winding', a.flipped.toLocaleString() + (a.flipped === 1 ? ' edge' : ' edges'),
    'Neighbouring triangles disagree about which side faces outward, so some are effectively inside-out. This causes odd shading and throws off the inside/outside and volume calculations.'));
  if (a.degenerate) tbl.appendChild(rowHelp('Degenerate faces', a.degenerate.toLocaleString(),
    'Collapsed triangles with no area, where two or more corners sit on the same spot. They cover no surface and are best removed.'));
  if (a.duplicate) tbl.appendChild(rowHelp('Duplicate faces', a.duplicate.toLocaleString(),
    'Triangles that sit exactly on top of another triangle with the same three corners - redundant duplicate copies.'));
  tbl.appendChild(rowHelp('Euler characteristic', String(a.euler),
    'A single number that captures the model’s overall shape, worked out from its corners, edges and faces (V - E + F), and staying the same however the shape is bent or stretched. A single sealed solid gives 2 (genus 0); each hole passing right through the body - like the hole in a doughnut - lowers it by 2.'));
  card.appendChild(tbl);

  if (!problems) {
    card.appendChild(el('p', { class: 'anr-sig-flag-note' },
      'No topological errors were detected, so the reported volume is reliable.'));
  } else {
    const pl = (n, one, many?) => `${n.toLocaleString()} ${n === 1 ? one : (many || one + 's')}`;
    const issues = [];
    if (a.boundaryEdges) issues.push(pl(a.boundaryEdges, 'open edge') + (a.holes ? ` across ${pl(a.holes, 'hole')}` : ''));
    if (a.nonManifoldEdges) issues.push(pl(a.nonManifoldEdges, 'non-manifold edge'));
    if (a.flipped) issues.push(pl(a.flipped, 'inconsistently wound edge'));
    if (a.degenerate) issues.push(pl(a.degenerate, 'degenerate face'));
    if (a.duplicate) issues.push(pl(a.duplicate, 'duplicate face'));
    const list = issues.length > 1 ? issues.slice(0, -1).join(', ') + ' and ' + issues[issues.length - 1] : issues[0];
    card.appendChild(el('p', { class: 'anr-sig-flag-note' },
      `This mesh has ${list}, which can cause slicing failures and an unreliable volume or inside-outside test. `
      + 'Run a mesh-repair pass (in your slicer, or a tool such as Blender or Meshmixer) before printing or machining.'));
  }
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
// Only `parts` is required; each caller (3MF, AMF, STEP, ...) supplies whatever
// labelling its format has and leaves the rest to the defaults below.
export function renderPartsViewer(file, resultsEl, { metaCard, parts, format, unitLabel, partsTitle, partsHint, zUp }: {
  parts: any[];
  metaCard?: any; format?: any; unitLabel?: any;
  partsTitle?: any; partsHint?: any; zUp?: any;
}) {
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
  let integCardEl = el('div');
  resultsEl.appendChild(viewCardEl);
  resultsEl.appendChild(statsCardEl);
  resultsEl.appendChild(integCardEl);
  if (metaCard) resultsEl.appendChild(metaCard);
  const geoCache = new Map();

  async function showPart(part, chip) {
    chipRow.querySelectorAll('.anr-part-chip').forEach((b) => b.classList.remove('is-active'));
    if (chip) chip.classList.add('is-active');
    const loading = el('div', { class: 'anr-card' }, [el('div', { class: 'anr-info' }, 'Building mesh…')]);
    const blankStats = el('div');
    const blankInteg = el('div');
    viewCardEl.replaceWith(loading); viewCardEl = loading;
    statsCardEl.replaceWith(blankStats); statsCardEl = blankStats;
    integCardEl.replaceWith(blankInteg); integCardEl = blankInteg;
    // Yield so the "Building…" text paints before a heavy parse blocks the thread.
    await new Promise((r) => setTimeout(r, 0));
    let geo = geoCache.get(part.key);
    if (!geo) { try { geo = part.build(); } catch (_) { geo = null; } geoCache.set(part.key, geo); }

    if (!geo || !geo.count) {
      const errCard = el('div', { class: 'anr-card' }, [el('p', { class: 'anr-error' }, 'No mesh found for this part.')]);
      viewCardEl.replaceWith(errCard); viewCardEl = errCard;
      return;
    }
    const { viewCard, viewer } = buildViewerCard(geo, part.name, { zUp });
    viewCardEl.replaceWith(viewCard); viewCardEl = viewCard;
    startViewer(viewer);
    const stats = geoStatsCard(geo, file, format, unitLabel);
    statsCardEl.replaceWith(stats); statsCardEl = stats;
    const integ = meshIntegrityCard(geo);
    integCardEl.replaceWith(integ); integCardEl = integ;
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
      parts, format: geo.format, unitLabel: 'units', partsTitle: 'Bodies', zUp: true,
      partsHint: `This STL contains ${bodies.length} separate bodies. Pick one to view on its own, or see them all together.`,
    });
    return;
  }

  // ---- 3D viewer card ----
  const { viewCard, viewer } = buildViewerCard(geo, '3D model', { zUp: true });
  resultsEl.appendChild(viewCard);
  startViewer(viewer);

  // ---- Geometry stats ----
  const statsCard = el('div', { class: 'anr-card' });
  statsCard.appendChild(el('h3', {}, 'Geometry'));
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Format', geo.format));
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  tbl.appendChild(rowHelp('Triangles', geo.count.toLocaleString(), 'How many triangles make up the model. STL files describe every surface entirely as triangles.'));
  tbl.appendChild(rowHelp('Vertices', (geo.count * 3).toLocaleString() + ' (non-indexed)', 'The total corner points, counted as three per triangle. STL lists each triangle’s corners separately, so a corner shared by several triangles is stored again each time rather than just once.'));
  const dx = geo.bbox.max[0] - geo.bbox.min[0];
  const dy = geo.bbox.max[1] - geo.bbox.min[1];
  const dz = geo.bbox.max[2] - geo.bbox.min[2];
  tbl.appendChild(rowHelp('Bounding box', `${dx.toFixed(2)} × ${dy.toFixed(2)} × ${dz.toFixed(2)} (units)`, 'The size of the smallest upright box the whole model fits inside, as width × depth × height. STL files carry no units, so these numbers are in whatever unit the file assumes (often millimetres).'));
  tbl.appendChild(rowHelp('Surface area', geo.area.toFixed(2) + ' units²', 'The total area of the model’s outer surface, added up from all its triangles, in the model’s own units squared.'));
  tbl.appendChild(rowHelp('Volume', geo.volume.toFixed(2) + ' units³ (if watertight)', 'How much space the model encloses inside, in the model’s units cubed. This only makes sense if the model is fully sealed with no holes or gaps (watertight).'));
  statsCard.appendChild(tbl);
  resultsEl.appendChild(statsCard);

  // ---- Mesh integrity (non-manifold / open / degenerate faults) ----
  resultsEl.appendChild(meshIntegrityCard(geo));
}
