/* Analyser - universal G-code analyser & 3D reconstructor

   Parses G-code from any source - 3D-printer slicers (PrusaSlicer, SuperSlicer,
   OrcaSlicer, Cura, ideaMaker, Bambu Studio, Simplify3D, Slic3r) and CNC / laser
   CAM (GRBL, Fanuc, Haas, Mastercam, Fusion 360, LightBurn) - and rebuilds the
   printed object in an interactive WebGL viewer.

   Crucially it renders the deposited FILAMENT, not the bare centreline toolpath:
   each extrusion move is drawn as a box prism with its real width and height, the
   width recovered volumetrically from the E delta exactly as slicers do
   (width = dE·pi·r^2 / (length·height) + (1-pi/4)·height, clamped), so the result
   looks like the solid print. Geometry is drawn with hardware instancing (a shared
   24-vertex box template + per-segment A/B/width/height), falling back to plain
   lines where instancing is unavailable.

   - 3D prints: extruded moves build the object; travel moves are a faint overlay.
   - CNC / laser: with no extrusion, the cutting (feed) moves are the toolpath.

   Handles absolute/relative positioning (G90/G91), absolute/relative extrusion
   (M82/M83), inch/millimetre units (G20/G21), G92 origin resets, G2/G3 arcs
   (tessellated), and ;WIDTH:/;HEIGHT: hints. Orbit / pan / zoom / spin, colour by
   height or feedrate, and a build-height scrubber. No external 3D library. */

import { el, row, rowHelp, fmtBytes, sha256Row, errorCard, attachViewCube } from '../core/util.js';

const SEG_CAP = 1300000;          // cap on rendered extrusion/feed segments
const TRAVEL_CAP = 400000;
const ARC_TOL = 0.02;             // arc chord tolerance (mm)
const ARC_MIN_STEPS = 2, ARC_MAX_STEPS = 256;
const DEF_DIA = 1.75;             // default filament diameter (mm)

// Normalised feature types (the "line types" OrcaSlicer colours by). Each slicer
// names them differently in its per-move comments - PrusaSlicer/Orca use
// "; FEATURE: Outer wall" / ";TYPE:External perimeter", Cura and ideaMaker use
// ";TYPE:WALL-OUTER" etc. - so featureId() maps any of them onto this set. The
// colours here MUST match typeColor() in the shader.
const FEATURES = [
  { id: 0, label: 'Outer wall', rgb: [0.95, 0.35, 0.25] },
  { id: 1, label: 'Inner wall', rgb: [0.95, 0.62, 0.25] },
  { id: 2, label: 'Sparse infill', rgb: [0.80, 0.55, 0.32] },
  { id: 3, label: 'Solid / top / bottom', rgb: [0.30, 0.62, 0.92] },
  { id: 4, label: 'Support', rgb: [0.35, 0.72, 0.45] },
  { id: 5, label: 'Skirt / brim', rgb: [0.62, 0.45, 0.85] },
  { id: 6, label: 'Bridge', rgb: [0.20, 0.78, 0.85] },
  { id: 7, label: 'Other', rgb: [0.70, 0.72, 0.78] },
];
function featureId(raw) {
  const s = (raw || '').toUpperCase().replace(/[\s_]+/g, '');
  if (s.includes('OUTER') || s.includes('EXTERNALPERIM')) return 0;
  if (s.includes('OVERHANG')) return 1;
  if (s.includes('INNER') || (s.includes('PERIMETER') && !s.includes('EXTERNAL'))) return 1;
  if (s.includes('BRIDGE')) return 6;
  if (s.includes('SUPPORT')) return 4;
  if (s.includes('SKIRT') || s.includes('BRIM')) return 5;
  if (s.includes('SOLID') || s.includes('SKIN') || s.includes('TOPSURFACE') || s.includes('BOTTOMSURFACE')) return 3;
  if (s.includes('GAP')) return 7;
  if (s.includes('FILL')) return 2;
  if (s.includes('WALL')) return 1;
  return 7;
}

// Growable Float32 buffer in fixed-size records.
function GrowBuf(stride) {
  let cap = 1 << 16, a = new Float32Array(cap), n = 0;
  return {
    push(vals) {
      if (n + vals.length > cap) { while (n + vals.length > cap) cap *= 2; const b = new Float32Array(cap); b.set(a); a = b; }
      for (let k = 0; k < vals.length; k++) a[n++] = vals[k];
    },
    get count() { return n / stride; },
    view() { return a.subarray(0, n); },
  };
}

// ---------- G-code parsing ----------
function parseGcode(text) {
  const len = text.length;
  if (!len) return null;

  // ext record (10 floats): ax,ay,az, bx,by,bz, width, height, feed, type.
  // trav record (6 floats): ax,ay,az, bx,by,bz.
  const ext = GrowBuf(10), trav = GrowBuf(6);

  let absXYZ = true, absE = true, unit = 1, plane = 17;
  let motionMode = null;            // last G0-G3 motion, for modal (G-word-less) lines
  let x = 0, y = 0, z = 0, e = 0, feed = 0;
  let curH = 0.2, lastExtrudeZ = 0;
  let curType = 7, sawTypes = false, printTime = '';
  const featureSet = new Set();
  let forcedW = 0, forcedH = 0;          // ;WIDTH: / ;HEIGHT: hints
  let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  let extrudeMM = 0, cutMM = 0, fmin = Infinity, fmax = 0;
  let nRapid = 0, nFeed = 0, nExtrude = 0, nArc = 0;
  const layerZ = new Set();
  // Full-line comments: the leading header block (until the first real command) and
  // the trailing config block (the contiguous run of comments at end of file, where
  // PrusaSlicer/Orca dump the slice settings). Captured separately so per-move
  // ";TYPE:"/";LAYER:" markers in the body don't flood the listing.
  const headerComments = [];
  const HDR_CAP = 4000;
  let inHeader = true, footRun = [];
  const temps = {};
  let filDia = 0, sawG = false, sawExtrude = false;

  // CNC / milling specifics (Fanuc / Fusion / HSM style, written in () comments).
  // Tool table from "(T2 D=6. CR=0. - ZMIN=-29.5 - FLAT END MILL)" lines, tool
  // changes (T<n> M6), spindle speed/direction (S.. M3/M4), coolant (M7/M8/M9),
  // work-coordinate systems (G54-G59) and per-operation names (the () comment that
  // immediately precedes a tool change). Only scanned while no extrusion has been
  // seen, so 3D-print parsing stays fast.
  const toolDefs = new Map();        // tool# -> { n, dia, cr, taper, zmin, desc, rpm }
  const toolChanges = [];            // ordered [{ n, op }]
  const toolSlot = new Map();        // tool# -> colour slot (0-based, encounter order, cap 7)
  const coolant = new Set(), workOffsets = new Set();
  let curTool = null, pendingTool = null, lastParen = '', spindleMax = 0, spindleDir = '';
  let cncType = 7;                   // colour-channel slot of the active tool (CNC)
  const ensureTool = (n) => { let d = toolDefs.get(n); if (!d) { d = { n }; toolDefs.set(n, d); } return d; };

  const bump = (px, py, pz) => {
    if (px < minx) minx = px; if (py < miny) miny = py; if (pz < minz) minz = pz;
    if (px > maxx) maxx = px; if (py > maxy) maxy = py; if (pz > maxz) maxz = pz;
  };
  const filArea = () => { const r = (filDia || DEF_DIA) / 2; return Math.PI * r * r; };

  // Width from the deposited volume, the way slicers reconstruct it.
  const widthOf = (de, L, h) => {
    if (forcedW > 0) return forcedW;
    if (!(L > 1e-6) || !(h > 1e-6)) return 0.4;
    let w = de * filArea() / (L * h) + (1 - Math.PI / 4) * h;
    w = Math.min(w, Math.max(2.0, 4 * h));
    return w > 0.01 ? w : 0.4;
  };

  const emitExtrude = (x0, y0, z0, x1, y1, z1, de) => {
    const L = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    // Layer height: rise since the last extruding Z (fallback to last good value).
    if (z1 > lastExtrudeZ + 1e-4) {
      const dz = z1 - lastExtrudeZ;
      if (dz > 0.02 && dz < 2.0) curH = dz;
      lastExtrudeZ = z1;
    }
    const h = forcedH > 0 ? forcedH : curH;
    const w = widthOf(de, L, h);
    if (ext.count < SEG_CAP) ext.push([x0, y0, z0, x1, y1, z1, w, h, feed, curType]);
    nExtrude++; sawExtrude = true; featureSet.add(curType);
    layerZ.add(Math.round(z1 * 1000));
    bump(x0, y0, z0); bump(x1, y1, z1);
    if (feed > 0) { if (feed < fmin) fmin = feed; if (feed > fmax) fmax = feed; }
  };
  const emitFeed = (x0, y0, z0, x1, y1, z1) => {
    const L = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    cutMM += L; nFeed++;
    if (ext.count < SEG_CAP) ext.push([x0, y0, z0, x1, y1, z1, 0, 0, feed, cncType]);  // width filled later for CNC; type = tool slot
    bump(x0, y0, z0); bump(x1, y1, z1);
    if (feed > 0) { if (feed < fmin) fmin = feed; if (feed > fmax) fmax = feed; }
  };
  const emitTravel = (x0, y0, z0, x1, y1, z1) => {
    if (trav.count < TRAVEL_CAP) trav.push([x0, y0, z0, x1, y1, z1]);
    nRapid++;
  };

  let i = 0;
  while (i < len) {
    let j = text.indexOf('\n', i); if (j < 0) j = len;
    let line = text.slice(i, j); i = j + 1;

    const semi = line.indexOf(';');
    if (semi >= 0) {
      const cm = line.slice(semi + 1);
      if (semi === 0) {
        const t = cm.trim();
        if (inHeader && headerComments.length < HDR_CAP) headerComments.push(t);
        footRun.push(t);
      }
      // Per-move feature/line type: ";TYPE:WALL-OUTER" (Cura/ideaMaker/Prusa) or
      // "; FEATURE: Outer wall" (OrcaSlicer/Bambu).
      let mm = /(?:^|\b)(?:TYPE|FEATURE)\s*:\s*(.+)/i.exec(cm);
      if (mm) { curType = featureId(mm[1]); sawTypes = true; }
      // Width/height hints (Cura/PrusaSlicer/ideaMaker emit these).
      mm = /WIDTH:\s*([\d.]+)/i.exec(cm); if (mm) forcedW = parseFloat(mm[1]) || 0;
      mm = /HEIGHT:\s*([\d.]+)/i.exec(cm); if (mm) forcedH = parseFloat(mm[1]) || 0;
      mm = /Filament\s*Diameter[^:]*:\s*([\d.]+)/i.exec(cm); if (mm && !filDia) filDia = parseFloat(mm[1]) || 0;
      if (!printTime) { mm = /(?:print(?:ing)?\s*time|Print Time)[^:=]*[:=]?\s*([\dhms :]+\d[hms])/i.exec(cm); if (mm) printTime = mm[1].trim(); }
      line = line.slice(0, semi);
    }
    // Paren comments: capture into the header/footer blocks (so the CNC program
    // header shows), pull out tool definitions, and remember the latest non-tool
    // comment as a candidate operation name for the next tool change.
    if (!sawExtrude && line.indexOf('(') >= 0) {
      let pm; const parenRe = /\(([^)]*)\)/g;
      while ((pm = parenRe.exec(line))) {
        const c = pm[1].trim();
        if (!c) continue;
        if (inHeader && headerComments.length < HDR_CAP) headerComments.push(c);
        footRun.push(c);
        const td = /^T(\d+)\b(.*)$/i.exec(c);
        if (td) {
          const def = ensureTool(+td[1]), rest = td[2]; let g;
          if (def.dia == null && (g = /\bD\s*=?\s*([\d.]+)/i.exec(rest))) def.dia = parseFloat(g[1]);
          if (def.cr == null && (g = /\bCR\s*=?\s*([\d.]+)/i.exec(rest))) def.cr = parseFloat(g[1]);
          if (def.taper == null && (g = /\bTAPER\s*=?\s*([\d.]+)\s*DEG/i.exec(rest))) def.taper = parseFloat(g[1]);
          if (def.zmin == null && (g = /\bZMIN\s*=?\s*(-?[\d.]+)/i.exec(rest))) def.zmin = parseFloat(g[1]);
          if (!def.desc) {
            const segs = rest.split(/\s*-\s*/).map((s) => s.trim())
              .filter((s) => s && /MILL|DRILL|FACE|BULL|CHAMFER|ENGRAV|REAM|\bTAP\b|BORE|SLOT|PROBE|\bEND\b|FLAT|BALL|SPOT|THREAD|DOVETAIL|LOLLIPOP/i.test(s) && !/^Z?MIN|^TAPER|^CR\b|^D=?/i.test(s));
            if (segs.length) def.desc = segs[segs.length - 1];
          }
        } else if (c.length <= 40 && !/^[-*=]/.test(c)) {
          lastParen = c;   // a plausible operation / section label
        }
      }
    }
    line = line.replace(/\([^)]*\)/g, '').trim();
    if (!line) continue;
    // A real command ends the header and resets the trailing-comment run.
    inHeader = false; if (footRun.length) footRun = [];

    const sp = line.indexOf(' ');
    const cmd = (sp < 0 ? line : line.slice(0, sp)).toUpperCase();

    switch (cmd) {
      case 'G90': absXYZ = true; continue;
      case 'G91': absXYZ = false; continue;
      case 'M82': absE = true; continue;
      case 'M83': absE = false; continue;
      case 'G20': unit = 25.4; continue;
      case 'G21': unit = 1; continue;
      case 'G17': plane = 17; continue;
      case 'G18': plane = 18; continue;
      case 'G19': plane = 19; continue;
      default: break;
    }
    if (cmd === 'M104' || cmd === 'M109') { const s = numAfter(line, 'S'); if (s > 0 && !temps.nozzle) temps.nozzle = s; continue; }
    if (cmd === 'M140' || cmd === 'M190') { const s = numAfter(line, 'S'); if (s > 0 && !temps.bed) temps.bed = s; continue; }

    // CNC modal words (can share a line with motion). Cheap char-gate first so plain
    // coordinate lines on big files don't pay for the regex scans.
    if (!sawExtrude && (line.indexOf('T') >= 0 || line.indexOf('M') >= 0 || line.indexOf('S') >= 0 || line.indexOf('G5') >= 0)) {
      let g;
      if ((g = /\bT(\d+)\b/.exec(line))) pendingTool = +g[1];
      if (/\bM0?6\b/.test(line) && pendingTool != null) {
        ensureTool(pendingTool);
        toolChanges.push({ n: pendingTool, op: lastParen || '' });
        curTool = pendingTool; lastParen = '';
        let slot = toolSlot.get(pendingTool);
        if (slot == null) { slot = Math.min(7, toolSlot.size); toolSlot.set(pendingTool, slot); }
        cncType = slot;   // colour subsequent cutting moves by this tool
      }
      if (/\bM0?3\b/.test(line)) spindleDir = 'Clockwise (M3)';
      else if (/\bM0?4\b/.test(line)) spindleDir = 'Counter-clockwise (M4)';
      if ((g = /\bS(\d+(?:\.\d+)?)\b/.exec(line))) {
        const rpm = parseFloat(g[1]);
        if (rpm > spindleMax) spindleMax = rpm;
        if (curTool != null) { const d = toolDefs.get(curTool); if (d && d.rpm == null && rpm > 0) d.rpm = rpm; }
      }
      if (/\bM0?8\b/.test(line)) coolant.add('Flood (M8)');
      if (/\bM0?7\b/.test(line)) coolant.add('Mist (M7)');
      if ((g = /\bG5([4-9])(?:\.(\d+))?\b/.exec(line))) workOffsets.add('G5' + g[1] + (g[2] ? '.' + g[2] : ''));
    }

    if (cmd === 'G92') {
      const t = parseAxes(line);
      if (t.x !== null) x = t.x * unit;
      if (t.y !== null) y = t.y * unit;
      if (t.z !== null) z = t.z * unit;
      if (t.e !== null) e = t.e * unit;
      continue;
    }

    // Normalised motion mode. A bare-coordinate line (no G-word, e.g. "X42 Y3 Z-1")
    // continues the previous G0-G3 mode - CNC posts (Fanuc/Fusion) rely on this
    // modal behaviour heavily, so without it most cutting moves are lost.
    let mo = null;
    if (cmd === 'G0' || cmd === 'G00') mo = 'G0';
    else if (cmd === 'G1' || cmd === 'G01') mo = 'G1';
    else if (cmd === 'G2' || cmd === 'G02') mo = 'G2';
    else if (cmd === 'G3' || cmd === 'G03') mo = 'G3';
    else if (motionMode && /^[XYZABCUVWIJKRF][-+.\d]/i.test(line)) mo = motionMode;
    if (!mo) continue;
    motionMode = mo;
    const isLine = mo === 'G0' || mo === 'G1';
    const isArc = mo === 'G2' || mo === 'G3';
    sawG = true;

    const t = parseAxes(line);
    if (t.f !== null) feed = t.f * unit;
    const nx = t.x === null ? x : (absXYZ ? t.x * unit : x + t.x * unit);
    const ny = t.y === null ? y : (absXYZ ? t.y * unit : y + t.y * unit);
    const nz = t.z === null ? z : (absXYZ ? t.z * unit : z + t.z * unit);
    let de = 0;
    if (t.e !== null) de = (absE ? (t.e * unit - e) : t.e * unit);
    const extruding = de > 1e-6;

    if (isLine) {
      const moved = nx !== x || ny !== y || nz !== z;
      if (moved) {
        if (extruding) { emitExtrude(x, y, z, nx, ny, nz, de); extrudeMM += de; }
        else if (mo === 'G0') emitTravel(x, y, z, nx, ny, nz);
        else emitFeed(x, y, z, nx, ny, nz);
      }
    } else {
      nArc++;
      const cw = (mo === 'G2');
      const pts = arcPoints(x, y, z, nx, ny, nz, t, unit, cw, plane);
      if (pts) {
        const perDe = extruding ? de / (pts.length - 1) : 0;
        for (let k = 1; k < pts.length; k++) {
          const a = pts[k - 1], b = pts[k];
          if (extruding) { emitExtrude(a[0], a[1], a[2], b[0], b[1], b[2], perDe); }
          else emitFeed(a[0], a[1], a[2], b[0], b[1], b[2]);
        }
        if (extruding) extrudeMM += de;
      } else {
        if (extruding) { emitExtrude(x, y, z, nx, ny, nz, de); extrudeMM += de; }
        else emitFeed(x, y, z, nx, ny, nz);
      }
    }
    x = nx; y = ny; z = nz;
    if (t.e !== null) e = absE ? t.e * unit : e + t.e * unit;
    forcedW = 0; forcedH = 0;          // hints apply to the next move only
  }

  if (!sawG) return { sawG: false };

  // For a CNC program (no extrusion) give the feed segments a nominal width/height
  // so they render as a thin solid path rather than zero-size boxes.
  const view = ext.view();
  if (!sawExtrude) {
    const span0 = Math.max(maxx - minx, maxy - miny, maxz - minz) || 1;
    const wcnc = Math.max(0.2, span0 * 0.0015);
    for (let p = 0; p < view.length; p += 10) { view[p + 6] = wcnc; view[p + 7] = wcnc; }
  }

  // Append the trailing config block (if it isn't already part of the captured
  // header), capped so a pathological all-comment tail can't blow up the listing.
  let allComments = headerComments;
  if (footRun.length && !headerComments.join('\n').includes(footRun.join('\n'))) {
    allComments = headerComments.concat([''], footRun);
  }
  if (allComments.length > 8000) allComments = allComments.slice(0, 8000);

  const zs = [...layerZ].map((v) => v / 1000).sort((a, b) => a - b);
  let layerHeight = 0;
  if (zs.length > 1) {
    const gaps = [];
    for (let k = 1; k < zs.length; k++) { const g = zs[k] - zs[k - 1]; if (g > 1e-4) gaps.push(g); }
    gaps.sort((a, b) => a - b);
    if (gaps.length) layerHeight = gaps[Math.floor(gaps.length / 2)];
  }

  return {
    sawG: true,
    mode: sawExtrude ? 'print' : 'cnc',
    seg: view,                 // 10 floats / segment
    segCount: ext.count,
    hasTypes: sawTypes && featureSet.size > 1,
    features: [...featureSet].sort((a, b) => a - b),
    printTime,
    travel: trav.view(),       // 6 floats / segment
    travelCount: trav.count,
    capped: ext.count >= SEG_CAP || trav.count >= TRAVEL_CAP,
    bbox: { min: [minx, miny, minz], max: [maxx, maxy, maxz] },
    units: unit === 1 ? 'mm' : 'in',
    layerCount: zs.length,
    layerHeight,
    extrudeMM,
    cutMM,
    feedRange: { min: isFinite(fmin) ? fmin : 0, max: fmax },
    counts: { rapid: nRapid, feed: nFeed, extrude: nExtrude, arc: nArc },
    filDia: filDia || DEF_DIA,
    temps,
    cnc: sawExtrude ? null : {
      tools: [...toolDefs.values()].sort((a, b) => a.n - b.n),
      changes: toolChanges,
      // Tools that actually cut, in encounter order, each mapped to a colour slot -
      // drives the colour-by-tool mode and the per-tool show/hide legend.
      toolColors: [...toolSlot.entries()].map(([n, slot]) => ({ n, slot })).sort((a, b) => a.slot - b.slot),
      spindleMax, spindleDir,
      coolant: [...coolant],
      workOffsets: [...workOffsets],
    },
    headerComments: allComments,
  };
}

function arcPoints(x0, y0, z0, x1, y1, z1, t, unit, cw, plane) {
  if (plane !== 17) return null;
  let cxv, cyv;
  if (t.i !== null || t.j !== null) {
    cxv = x0 + (t.i || 0) * unit; cyv = y0 + (t.j || 0) * unit;
  } else if (t.r !== null) {
    const r = t.r * unit, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy);
    if (d < 1e-9 || Math.abs(r) < d / 2 - 1e-6) return null;
    const h = Math.sqrt(Math.max(0, r * r - (d * d) / 4));
    const ox = -dy / d * h, oy = dx / d * h;
    const sign = (cw ? 1 : -1) * (r < 0 ? -1 : 1);
    cxv = mx + sign * ox; cyv = my + sign * oy;
  } else return null;
  const r0 = Math.hypot(x0 - cxv, y0 - cyv);
  if (r0 < 1e-6) return null;
  let a0 = Math.atan2(y0 - cyv, x0 - cxv);
  let a1 = Math.atan2(y1 - cyv, x1 - cxv);
  if (cw) { while (a1 >= a0) a1 -= 2 * Math.PI; } else { while (a1 <= a0) a1 += 2 * Math.PI; }
  const sweep = Math.abs(a1 - a0);
  const maxAng = 2 * Math.acos(Math.max(0, 1 - ARC_TOL / Math.max(r0, ARC_TOL)));
  let steps = Math.ceil(sweep / Math.max(maxAng, 1e-3));
  steps = Math.max(ARC_MIN_STEPS, Math.min(ARC_MAX_STEPS, steps));
  const pts = [];
  for (let k = 0; k <= steps; k++) {
    const f = k / steps, a = a0 + (a1 - a0) * f;
    pts.push([cxv + r0 * Math.cos(a), cyv + r0 * Math.sin(a), z0 + (z1 - z0) * f]);
  }
  return pts;
}

function parseAxes(line) {
  const o = { x: null, y: null, z: null, e: null, f: null, i: null, j: null, r: null };
  const re = /([XYZEFIJR])(-?\d*\.?\d+)/gi;
  let m;
  while ((m = re.exec(line))) { const v = parseFloat(m[2]); if (!isNaN(v)) o[m[1].toLowerCase()] = v; }
  return o;
}
function numAfter(line, letter) { const m = new RegExp(letter + '(-?\\d*\\.?\\d+)', 'i').exec(line); return m ? parseFloat(m[1]) : 0; }

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

// Upside-down 3-sided pyramid (a stylised nozzle/toolhead): apex at the origin -
// the deposition point - with the triangular base lifted above it. Interleaved
// position(3) + flat normal(3), 12 vertices (3 sides + base cap).
function pyramidGeo() {
  const apex = [0, 0, 0], yb = 1.45, rb = 0.62, base = [];
  for (let k = 0; k < 3; k++) { const a = Math.PI / 2 + k * 2 * Math.PI / 3; base.push([Math.cos(a) * rb, yb, Math.sin(a) * rb]); }
  const tris = [[apex, base[0], base[1]], [apex, base[1], base[2]], [apex, base[2], base[0]], [base[0], base[2], base[1]]];
  const out = [];
  for (const [A, B, C] of tris) {
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const L = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0] / L, n[1] / L, n[2] / L];
    for (const P of [A, B, C]) out.push(P[0], P[1], P[2], n[0], n[1], n[2]);
  }
  return new Float32Array(out);
}

// 24-vertex box-prism template: 4 side faces between the A-cap and B-cap. Each
// row is [whichEnd(0=A,1=B), signRight, signUp]; the shader sweeps it into a solid
// bead using the per-segment direction, width and height.
function boxTemplate() {
  const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]];   // cross-section corners
  const v = [];
  for (let k = 0; k < 4; k++) {
    const s = c[k], t = c[(k + 1) % 4];
    // quad (A.s, A.t, B.t) + (A.s, B.t, B.s)
    v.push(0, s[0], s[1], 0, t[0], t[1], 1, t[0], t[1]);
    v.push(0, s[0], s[1], 1, t[0], t[1], 1, s[0], s[1]);
  }
  return new Float32Array(v);
}

// ---------- WebGL viewer (instanced filament beads) ----------
// opts.antialias toggles hardware MSAA (set at context creation, so changing it
// rebuilds the viewer). The other anti-aliasing controls (supersampling, minimum
// line width, distant-bead flattening) are live state flags read each frame.
function buildViewer(data, opts = {}) {
  const wrap = el('div', { class: 'anr-stl-viewport' });
  const canvas = el('canvas', { class: 'anr-stl-canvas' });
  wrap.appendChild(canvas);
  const msaa = opts.antialias !== false;
  const glOpts = { preserveDrawingBuffer: true, antialias: msaa };
  const gl = canvas.getContext('webgl', glOpts) || canvas.getContext('experimental-webgl', glOpts);
  if (!gl) { wrap.appendChild(el('p', { class: 'anr-error' }, 'WebGL is not available in this browser.')); return { wrap, ok: false }; }
  const inst = gl.getExtension('ANGLE_instanced_arrays');

  // Normalise to a unit cube, remapping printer Z to viewer up (Y).
  const { min, max } = data.bbox;
  const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, cz = (min[2] + max[2]) / 2;
  const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const nrm = (px, py, pz) => [(px - cx) / span, (pz - cz) / span, (py - cy) / span];   // -> [x, up, depth]
  const boundR = (() => {
    let m2 = 0;
    for (let p = 0; p < data.seg.length; p += 10) {
      for (const v of [nrm(data.seg[p], data.seg[p + 1], data.seg[p + 2]), nrm(data.seg[p + 3], data.seg[p + 4], data.seg[p + 5])]) {
        const r2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2]; if (r2 > m2) m2 = r2;
      }
    }
    return Math.sqrt(m2) || 0.5;
  })();
  const yMin = (min[2] - cz) / span, ySpan = ((max[2] - min[2]) / span) || 1e-3;
  const fMin = data.feedRange.min, fSpan = Math.max(1e-6, data.feedRange.max - data.feedRange.min);

  // Per-instance buffer: A(3) B(3) halfW halfH feed type (10 floats / segment).
  const STR = 10;
  const segN = data.segCount;
  const instData = new Float32Array(segN * STR);
  for (let s = 0; s < segN; s++) {
    const p = s * 10, q = s * STR;
    const a = nrm(data.seg[p], data.seg[p + 1], data.seg[p + 2]);
    const b = nrm(data.seg[p + 3], data.seg[p + 4], data.seg[p + 5]);
    instData[q] = a[0]; instData[q + 1] = a[1]; instData[q + 2] = a[2];
    instData[q + 3] = b[0]; instData[q + 4] = b[1]; instData[q + 5] = b[2];
    instData[q + 6] = (data.seg[p + 6] * 0.5) / span;   // half width (normalised)
    instData[q + 7] = (data.seg[p + 7] * 0.5) / span;   // half height
    instData[q + 8] = data.seg[p + 8];                  // feed
    instData[q + 9] = data.seg[p + 9];                  // feature type
  }
  // Travel instances (thin), reusing the same layout.
  const travN = inst ? data.travelCount : 0;
  let travData = null;
  if (travN) {
    travData = new Float32Array(travN * STR);
    const thin = Math.max(0.04 / span, boundR * 0.0008);
    for (let s = 0; s < travN; s++) {
      const p = s * 6, q = s * STR;
      const a = nrm(data.travel[p], data.travel[p + 1], data.travel[p + 2]);
      const b = nrm(data.travel[p + 3], data.travel[p + 4], data.travel[p + 5]);
      travData[q] = a[0]; travData[q + 1] = a[1]; travData[q + 2] = a[2];
      travData[q + 3] = b[0]; travData[q + 4] = b[1]; travData[q + 5] = b[2];
      travData[q + 6] = thin; travData[q + 7] = thin; travData[q + 8] = fMin; travData[q + 9] = 7;
    }
  }

  const vsInst = `attribute float aEnd, aSr, aSu; attribute vec3 aA, aB; attribute float aHW, aHH, aFeed, aType;
    uniform mat4 uMVP, uModel; uniform vec2 uViewport;
    uniform float uYmin, uYspan, uFmin, uFspan, uMode, uTravel, uMinW, uMinPx, uFlat, uVis[8];
    varying float vT, vVis; varying vec3 vN, vColor;
    vec3 ramp(float t){ vec3 c1=vec3(0.18,0.32,0.92),c2=vec3(0.10,0.80,0.86),c3=vec3(0.22,0.82,0.30),c4=vec3(0.97,0.80,0.20),c5=vec3(0.96,0.26,0.20);
      if(t<0.25)return mix(c1,c2,t/0.25); if(t<0.50)return mix(c2,c3,(t-0.25)/0.25); if(t<0.75)return mix(c3,c4,(t-0.50)/0.25); return mix(c4,c5,(t-0.75)/0.25); }
    vec3 typeColor(float ft){ int t=int(ft+0.5);
      if(t==0)return vec3(0.95,0.35,0.25); if(t==1)return vec3(0.95,0.62,0.25); if(t==2)return vec3(0.80,0.55,0.32);
      if(t==3)return vec3(0.30,0.62,0.92); if(t==4)return vec3(0.35,0.72,0.45); if(t==5)return vec3(0.62,0.45,0.85);
      if(t==6)return vec3(0.20,0.78,0.85); return vec3(0.70,0.72,0.78); }
    // Screen-space size (px) of a world-space offset from the centreline point P.
    float screenPx(vec4 cClip, vec3 P, vec3 v){
      vec4 oClip = uMVP*vec4(P+v, 1.0);
      return length((oClip.xy/oClip.w - cClip.xy/cClip.w) * 0.5 * uViewport);
    }
    void main(){
      vec3 P = mix(aA, aB, aEnd);
      vec3 d = aB - aA; float dl = length(d); d = dl > 1e-8 ? d/dl : vec3(1.0,0.0,0.0);
      vec3 up = vec3(0.0,1.0,0.0);
      vec3 rt = cross(d, up); float rl = length(rt); rt = rl > 1e-6 ? rt/rl : vec3(1.0,0.0,0.0);
      vec3 uv = normalize(cross(rt, d));
      vec3 off = rt*(aSr*aHW) + uv*(aSu*aHH);
      vec4 cClip = uMVP*vec4(P, 1.0);
      // Minimum on-screen size: fatten beads that would project to fewer than uMinPx
      // pixels so thin parallel lines don't shimmer or drop out when zoomed out.
      // Only when the point is in front of the camera (cClip.w > 0) - near/behind the
      // near plane the perspective divide explodes px and the bead would balloon
      // across the screen - and the scale is clamped so a sliver can't blow up.
      if(uMinW > 0.5 && cClip.w > 0.001){
        float px = screenPx(cClip, P, off);
        if(px > 1e-3 && px < uMinPx) off *= min(uMinPx/px, 6.0);
      }
      // Distance-based normal flattening: as a bead shrinks below a few px wide,
      // blend its rounded radial normal toward the flat up-normal, dropping the
      // cross-bead luminance grating that drives moiré on infill / top layers.
      vec3 nrm = normalize(rt*aSr + uv*aSu);
      if(uFlat > 0.5 && cClip.w > 0.001){
        float wpx = screenPx(cClip, P, rt*aHW);
        nrm = normalize(mix(nrm, uv, clamp(1.0 - wpx/3.0, 0.0, 1.0)));
      }
      vN = mat3(uModel) * nrm;
      gl_Position = uMVP*vec4(P + off, 1.0);
      // Height fraction from the segment CENTRELINE (not the offset bead vertex), so
      // the build-height clip reveals whole layers cleanly and 100% is the true top.
      vT = clamp((P.y - uYmin)/uYspan, 0.0, 1.0);
      float sfrac = clamp((aFeed - uFmin)/uFspan, 0.0, 1.0);
      if(uTravel > 0.5){ vColor = vec3(0.42,0.44,0.50); vVis = 1.0; }
      else {
        vColor = (uMode < 0.5) ? typeColor(aType) : (uMode < 1.5) ? ramp(vT) : ramp(sfrac);
        vVis = uVis[int(aType + 0.5)];
      } }`;
  const fsInst = `precision mediump float; varying float vT, vVis; varying vec3 vN, vColor;
    uniform float uClip;
    void main(){ if(vT > uClip) discard; if(vVis < 0.5) discard;
      vec3 N = normalize(vN); vec3 L = normalize(vec3(0.4,0.78,0.5));
      float lit = max(max(dot(N,L),0.0), max(dot(-N,L),0.0)*0.4);
      gl_FragColor = vec4(vColor*(0.34+0.66*lit), 1.0); }`;
  // Plain-line fallback (no instancing): centreline reconstruction.
  const vsLine = `attribute vec3 aPos; uniform mat4 uProj,uView,uModel; uniform float uYmin,uYspan; varying float vT;
    void main(){ gl_Position=uProj*uView*uModel*vec4(aPos,1.0); vT=clamp((aPos.y-uYmin)/uYspan,0.0,1.0); }`;
  const fsLine = `precision mediump float; varying float vT; uniform float uClip;
    vec3 ramp(float t){ vec3 c1=vec3(0.18,0.32,0.92),c2=vec3(0.10,0.80,0.86),c3=vec3(0.22,0.82,0.30),c4=vec3(0.97,0.80,0.20),c5=vec3(0.96,0.26,0.20);
      if(t<0.25)return mix(c1,c2,t/0.25); if(t<0.50)return mix(c2,c3,(t-0.25)/0.25); if(t<0.75)return mix(c3,c4,(t-0.50)/0.25); return mix(c4,c5,(t-0.75)/0.25); }
    void main(){ if(vT>uClip) discard; gl_FragColor=vec4(ramp(vT),1.0); }`;

  function makeProg(vs, fs) {
    const sh = (type, s) => { const o = gl.createShader(type); gl.shaderSource(o, s); gl.compileShader(o); return o; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p); return p;
  }

  gl.enable(gl.DEPTH_TEST);
  // mode: 0 = feature type, 1 = height, 2 = speed. vis: per-feature-type 1/0.
  // shown: how many extrusion segments to draw (in print order) - the progress slider.
  const state = { yaw: 0.6, pitch: 0.5, dist: 2.6, panX: 0, panY: 0, spin: true, ortho: false, head: false, msaa, ssaa: true, minWidth: false, flatten: true, bg: [0.06, 0.06, 0.06], clip: 1, mode: (data.hasTypes || (data.cnc && data.cnc.toolColors.length > 1)) ? 0 : 1, showTravel: false, vis: new Float32Array([1, 1, 1, 1, 1, 1, 1, 1]), shown: segN };
  let viewW = 600, viewH = 420;   // CSS px, for screen-space size in the shader
  let dirty = true;
  const spinListeners = [];
  function setSpin(v) { if (state.spin === v) return; state.spin = v; dirty = true; for (const cb of spinListeners) cb(v); }

  // ----- instanced path -----
  let drawImpl;
  if (inst && segN > 0) {
    const prog = makeProg(vsInst, fsInst); gl.useProgram(prog);
    const tpl = boxTemplate();
    const tplBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, tplBuf); gl.bufferData(gl.ARRAY_BUFFER, tpl, gl.STATIC_DRAW);
    const segBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, segBuf); gl.bufferData(gl.ARRAY_BUFFER, instData, gl.STATIC_DRAW);
    let travBuf = null;
    if (travData) { travBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, travBuf); gl.bufferData(gl.ARRAY_BUFFER, travData, gl.STATIC_DRAW); }

    const L = (n) => gl.getAttribLocation(prog, n);
    const aEnd = L('aEnd'), aSr = L('aSr'), aSu = L('aSu'), aA = L('aA'), aB = L('aB'), aHW = L('aHW'), aHH = L('aHH'), aFeed = L('aFeed'), aType = L('aType');
    const U = (n) => gl.getUniformLocation(prog, n);
    const uMVP = U('uMVP'), uModel = U('uModel'), uViewport = U('uViewport'), uYmin = U('uYmin'), uYspan = U('uYspan'), uFmin = U('uFmin'), uFspan = U('uFspan'), uClip = U('uClip'), uMode = U('uMode'), uTravel = U('uTravel'), uVis = U('uVis'), uMinW = U('uMinW'), uMinPx = U('uMinPx'), uFlat = U('uFlat');

    const bindTemplate = () => {
      gl.bindBuffer(gl.ARRAY_BUFFER, tplBuf);
      gl.enableVertexAttribArray(aEnd); gl.vertexAttribPointer(aEnd, 1, gl.FLOAT, false, 12, 0); inst.vertexAttribDivisorANGLE(aEnd, 0);
      gl.enableVertexAttribArray(aSr); gl.vertexAttribPointer(aSr, 1, gl.FLOAT, false, 12, 4); inst.vertexAttribDivisorANGLE(aSr, 0);
      gl.enableVertexAttribArray(aSu); gl.vertexAttribPointer(aSu, 1, gl.FLOAT, false, 12, 8); inst.vertexAttribDivisorANGLE(aSu, 0);
    };
    const bindInstances = (buf) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const S = 40;
      gl.enableVertexAttribArray(aA); gl.vertexAttribPointer(aA, 3, gl.FLOAT, false, S, 0); inst.vertexAttribDivisorANGLE(aA, 1);
      gl.enableVertexAttribArray(aB); gl.vertexAttribPointer(aB, 3, gl.FLOAT, false, S, 12); inst.vertexAttribDivisorANGLE(aB, 1);
      gl.enableVertexAttribArray(aHW); gl.vertexAttribPointer(aHW, 1, gl.FLOAT, false, S, 24); inst.vertexAttribDivisorANGLE(aHW, 1);
      gl.enableVertexAttribArray(aHH); gl.vertexAttribPointer(aHH, 1, gl.FLOAT, false, S, 28); inst.vertexAttribDivisorANGLE(aHH, 1);
      gl.enableVertexAttribArray(aFeed); gl.vertexAttribPointer(aFeed, 1, gl.FLOAT, false, S, 32); inst.vertexAttribDivisorANGLE(aFeed, 1);
      if (aType >= 0) { gl.enableVertexAttribArray(aType); gl.vertexAttribPointer(aType, 1, gl.FLOAT, false, S, 36); inst.vertexAttribDivisorANGLE(aType, 1); }
    };
    // Toolhead marker: a small inverted pyramid sitting at the live print point,
    // shown while the print-progress animation plays.
    const headProg = makeProg(
      `attribute vec3 aPos, aNrm; uniform mat4 uProj, uView, uModel; uniform vec3 uHead; uniform float uScale; varying vec3 vN;
       void main(){ vN = mat3(uModel)*aNrm; gl_Position = uProj*uView*uModel*vec4(uHead + aPos*uScale, 1.0); }`,
      `precision mediump float; varying vec3 vN;
       void main(){ vec3 N=normalize(vN); vec3 L=normalize(vec3(0.4,0.78,0.5));
         float lit=max(max(dot(N,L),0.0), max(dot(-N,L),0.0)*0.4);
         gl_FragColor = vec4(vec3(1.0,0.92,0.30)*(0.45+0.55*lit), 1.0); }`);
    const headGeo = pyramidGeo();
    const headBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, headBuf); gl.bufferData(gl.ARRAY_BUFFER, headGeo, gl.STATIC_DRAW);
    const hPos = gl.getAttribLocation(headProg, 'aPos'), hNrm = gl.getAttribLocation(headProg, 'aNrm');
    const hU = (n) => gl.getUniformLocation(headProg, n);
    const uHProj = hU('uProj'), uHView = hU('uView'), uHModel = hU('uModel'), uHead = hU('uHead'), uHScale = hU('uScale');
    const headScale = Math.max(0.02, boundR * 0.06);
    const drawHead = (proj, view, model, shown) => {
      const idx = Math.max(0, Math.min(segN - 1, shown - 1)), q = idx * STR;
      gl.useProgram(headProg);
      gl.uniformMatrix4fv(uHProj, false, proj); gl.uniformMatrix4fv(uHView, false, view); gl.uniformMatrix4fv(uHModel, false, model);
      gl.uniform3f(uHead, instData[q + 3], instData[q + 4], instData[q + 5]); gl.uniform1f(uHScale, headScale);
      gl.bindBuffer(gl.ARRAY_BUFFER, headBuf);
      gl.enableVertexAttribArray(hPos); gl.vertexAttribPointer(hPos, 3, gl.FLOAT, false, 24, 0); inst.vertexAttribDivisorANGLE(hPos, 0);
      gl.enableVertexAttribArray(hNrm); gl.vertexAttribPointer(hNrm, 3, gl.FLOAT, false, 24, 12); inst.vertexAttribDivisorANGLE(hNrm, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 12);
    };
    drawImpl = (proj, view, model) => {
      gl.useProgram(prog);
      const mvp = mat4Multiply(proj, mat4Multiply(view, model));
      gl.uniformMatrix4fv(uMVP, false, mvp); gl.uniformMatrix4fv(uModel, false, model);
      gl.uniform2f(uViewport, viewW, viewH);
      gl.uniform1f(uYmin, yMin); gl.uniform1f(uYspan, ySpan); gl.uniform1f(uFmin, fMin); gl.uniform1f(uFspan, fSpan); gl.uniform1f(uClip, state.clip);
      gl.uniform1f(uMinW, state.minWidth ? 1 : 0); gl.uniform1f(uMinPx, 1.3); gl.uniform1f(uFlat, state.flatten ? 1 : 0);
      if (uVis) gl.uniform1fv(uVis, state.vis);
      bindTemplate();
      const shown = Math.max(0, Math.min(segN, state.shown | 0));
      if (state.showTravel && travBuf) {
        // Reveal travels proportionally to print progress.
        const tShown = segN > 0 ? Math.round(travN * shown / segN) : travN;
        gl.uniform1f(uTravel, 1); gl.uniform1f(uMode, 0);
        bindInstances(travBuf); inst.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 24, tShown);
      }
      gl.uniform1f(uTravel, 0); gl.uniform1f(uMode, state.mode);
      bindInstances(segBuf); inst.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 24, shown);
      if (state.head && shown > 0) drawHead(proj, view, model, shown);
    };
    drawImpl.hasTravel = !!travBuf;
  } else {
    // Fallback: centreline lines.
    const prog = makeProg(vsLine, fsLine); gl.useProgram(prog);
    const linePos = new Float32Array(segN * 6);
    for (let s = 0; s < segN; s++) {
      const p = s * 10, q = s * 6;
      const a = nrm(data.seg[p], data.seg[p + 1], data.seg[p + 2]);
      const b = nrm(data.seg[p + 3], data.seg[p + 4], data.seg[p + 5]);
      linePos[q] = a[0]; linePos[q + 1] = a[1]; linePos[q + 2] = a[2];
      linePos[q + 3] = b[0]; linePos[q + 4] = b[1]; linePos[q + 5] = b[2];
    }
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, linePos, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    const U = (n) => gl.getUniformLocation(prog, n);
    const uProj = U('uProj'), uView = U('uView'), uModel = U('uModel'), uYmin = U('uYmin'), uYspan = U('uYspan'), uClip = U('uClip');
    drawImpl = (proj, view, model) => {
      gl.useProgram(prog);
      gl.uniformMatrix4fv(uProj, false, proj); gl.uniformMatrix4fv(uView, false, view); gl.uniformMatrix4fv(uModel, false, model);
      gl.uniform1f(uYmin, yMin); gl.uniform1f(uYspan, ySpan); gl.uniform1f(uClip, state.clip);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.LINES, 0, Math.max(0, Math.min(segN, state.shown | 0)) * 2);
    };
    drawImpl.hasTravel = false;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = wrap.clientWidth || 600, h = wrap.clientHeight || 420;
    viewW = w; viewH = h;
    // Supersample to fight the moiré shimmer that many near-parallel thin beads
    // produce against the pixel grid. Scale back the factor for huge prints and
    // cap the total pixel budget so big files stay responsive.
    const ss = state.ssaa ? (segN > 600000 ? 1.3 : segN > 200000 ? 1.6 : 2.0) : 1;
    let scale = dpr * ss;
    const want = w * h * scale * scale, MAXPIX = 5.5e6;
    if (want > MAXPIX) scale *= Math.sqrt(MAXPIX / want);
    canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px'; dirty = true;
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
    const model = mat4Multiply(mat4RotX(state.pitch), mat4RotY(state.yaw));
    drawImpl(proj, view, model);
  }
  function loop() {
    if (state.spin) { state.yaw += 0.003; dirty = true; }
    if (dirty) { draw(); dirty = false; }
    if (wrap.isConnected) requestAnimationFrame(loop);
  }

  // Orbit / pan / zoom.
  let dragging = false, panning = false, lx = 0, ly = 0;
  const panK = () => state.dist * 0.0018;
  const down = (x, y, pan) => { dragging = true; panning = pan; lx = x; ly = y; setSpin(false); };
  const move = (x, y) => {
    if (!dragging) return;
    if (panning) { state.panX += (x - lx) * panK(); state.panY -= (y - ly) * panK(); }
    else { state.yaw += (x - lx) * 0.01; state.pitch += (y - ly) * 0.01; state.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, state.pitch)); }
    lx = x; ly = y; dirty = true;
  };
  const up = () => { dragging = false; panning = false; };
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => down(e.clientX, e.clientY, e.button === 2 || e.shiftKey));
  window.addEventListener('mousemove', (e) => move(e.clientX, e.clientY));
  window.addEventListener('mouseup', up);
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
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); state.dist = Math.max(0.04, Math.min(150,state.dist * (1 + Math.sign(e.deltaY) * 0.1))); dirty = true; }, { passive: false });

  function snapshot() {
    const saved = { yaw: state.yaw, pitch: state.pitch, dist: state.dist, spin: state.spin, ortho: state.ortho, clip: state.clip, panX: state.panX, panY: state.panY };
    state.spin = false; state.ortho = false; state.clip = 1; state.panX = 0; state.panY = 0;
    state.yaw = Math.PI / 4; state.pitch = Math.atan(1 / Math.SQRT2);
    const aspect = (canvas.width / canvas.height) || 1;
    const halfFovV = (45 * Math.PI / 180) / 2;
    const halfFov = Math.min(halfFovV, Math.atan(Math.tan(halfFovV) * aspect));
    const theta = Math.atan(0.96 * Math.tan(halfFov));
    state.dist = boundR / Math.sin(theta);
    draw();
    let url = null; try { url = canvas.toDataURL('image/png'); } catch (_) { url = null; }
    Object.assign(state, saved); dirty = true; return url;
  }
  canvas._anrSnapshot = snapshot;

  wrap.addEventListener('fullscreenchange', () => setTimeout(resize, 50));

  const api = {
    wrap, ok: true, state, hasTravel: !!drawImpl.hasTravel, instanced: !!(inst && segN > 0), snapshot,
    resize, setSpin, onSpinChange: (cb) => spinListeners.push(cb),
    start: () => { resize(); requestAnimationFrame(loop); }, markDirty: () => { dirty = true; },
  };
  attachViewCube(api);
  return api;
}

function detectSlicer(comments) {
  for (const c of comments) {
    let m = c.match(/sliced by\s+(.+)/i); if (m) return m[1].trim();
    m = c.match(/generated (?:with|by)\s+(.+)/i); if (m) return m[1].trim();
    m = c.match(/\b(PrusaSlicer|SuperSlicer|OrcaSlicer|Cura|ideaMaker|Simplify3D|Slic3r|Bambu\s*Studio|Kiri:?Moto|Fusion\s*360|Mastercam|LightBurn|GRBL)\b[^\n]*/i);
    if (m) return m[0].trim();
  }
  return null;
}

export async function renderGcode(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reconstructing the print from "${file.name}"…`));

  let text;
  try { text = await file.text(); }
  catch (e) { resultsEl.innerHTML = ''; resultsEl.appendChild(errorCard('Could not read file: ' + (e && e.message))); return; }

  await new Promise((r) => setTimeout(r, 0));
  let data;
  try { data = parseGcode(text); } catch (e) { data = null; }

  resultsEl.innerHTML = '';
  if (!data || !data.sawG) { resultsEl.appendChild(errorCard('This file does not look like G-code (no G0/G1/G2/G3 moves found).')); return; }

  const isPrint = data.mode === 'print';
  const u = data.units;
  const titleCase = (s) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
  const cncTools = (data.cnc && data.cnc.toolColors) ? data.cnc.toolColors : [];
  const toolLabel = (n) => { const d = data.cnc && data.cnc.tools.find((t) => t.n === n); return 'T' + n + (d && d.desc ? ' - ' + titleCase(d.desc) : ''); };

  if (data.segCount > 0) {
    const viewCard = el('div', { class: 'anr-card' });
    viewCard.appendChild(el('h3', {}, isPrint ? 'Reconstructed print' : 'Toolpath'));
    let viewer = buildViewer(data, { antialias: true });
    viewCard.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 10px;' }, isPrint
      ? (viewer.instanced
        ? 'Rebuilt from the G-code as solid deposited filament - each extrusion drawn at its real width and height, coloured by layer. Travel moves are hidden.'
        : 'Rebuilt from the G-code toolpath, coloured by layer height (your browser lacks instanced rendering, so beads are shown as centrelines).')
      : 'The machining / laser toolpath - every cutting move drawn at the tool width, coloured by height. Rapids are hidden.'));
    viewCard.appendChild(viewer.wrap);

    if (viewer.ok) {
      const controls = el('div', { class: 'anr-btn-row', style: 'margin-top:10px;align-items:center;flex-wrap:wrap;' });
      const spinBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Pause spin');
      spinBtn.addEventListener('click', () => viewer.setSpin(!viewer.state.spin));
      const updateSpinLabel = (s) => { spinBtn.textContent = s ? 'Pause spin' : 'Resume spin'; };
      viewer.onSpinChange(updateSpinLabel);

      // Toggling hardware MSAA needs a fresh WebGL context, so rebuild the viewer on
      // a new canvas, carrying the camera and display state across. Every control
      // references `viewer` by binding, so they keep working after the swap.
      function applyMSAA(on) {
        const s = viewer.state;
        const keep = { yaw: s.yaw, pitch: s.pitch, dist: s.dist, panX: s.panX, panY: s.panY, spin: s.spin, ortho: s.ortho, head: s.head, clip: s.clip, mode: s.mode, showTravel: s.showTravel, vis: s.vis, shown: s.shown, ssaa: s.ssaa, minWidth: s.minWidth, flatten: s.flatten };
        const old = viewer;
        const next = buildViewer(data, { antialias: on });
        if (!next.ok) return;                         // keep the working viewer if rebuild fails
        viewer = next;
        Object.assign(viewer.state, keep, { msaa: on });
        old.wrap.replaceWith(viewer.wrap);
        viewer.onSpinChange(updateSpinLabel);
        viewer.start();
        viewer.markDirty();
      }

      const resetBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Reset view');
      resetBtn.addEventListener('click', () => { Object.assign(viewer.state, { yaw: 0.6, pitch: 0.5, dist: 2.6, panX: 0, panY: 0 }); viewer.markDirty(); });
      const projBtn = el('button', { type: 'button', class: 'anr-btn' }, viewer.state.ortho ? 'Orthographic' : 'Perspective');
      projBtn.addEventListener('click', () => { viewer.state.ortho = !viewer.state.ortho; projBtn.textContent = viewer.state.ortho ? 'Orthographic' : 'Perspective'; viewer.markDirty(); });
      // Anti-aliasing / quality popup: hardware MSAA, supersampling, minimum line
      // width and distant-bead flattening, each toggled independently.
      const qWrap = el('span', { class: 'anr-aa-wrap' });
      const qBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Quality');
      const qPanel = el('div', { class: 'anr-aa-panel is-hidden' });
      qPanel.appendChild(el('div', { class: 'anr-aa-title' }, 'Anti-aliasing'));
      const aaRow = (label, desc, get, set) => {
        const cb = el('input', { type: 'checkbox' }); cb.checked = !!get();
        cb.addEventListener('change', () => set(cb.checked));
        const lab = el('label', { class: 'anr-aa-row' }, [cb, el('span', { class: 'anr-aa-label' }, label)]);
        lab.appendChild(el('span', { class: 'anr-aa-desc' }, desc));
        qPanel.appendChild(lab);
        return cb;
      };
      aaRow('Hardware MSAA', 'Smooths polygon edges. Toggling rebuilds the view.', () => viewer.state.msaa, (v) => applyMSAA(v));
      aaRow('Supersampling', 'Renders at higher resolution - best quality, heaviest.', () => viewer.state.ssaa, (v) => { viewer.state.ssaa = v; viewer.resize(); viewer.markDirty(); });
      aaRow('Minimum line width', 'Stops thin beads shimmering when zoomed out.', () => viewer.state.minWidth, (v) => { viewer.state.minWidth = v; viewer.markDirty(); });
      aaRow('Flatten distant beads', 'Cuts moiré on flat infill and top surfaces.', () => viewer.state.flatten, (v) => { viewer.state.flatten = v; viewer.markDirty(); });
      qBtn.addEventListener('click', (e) => { e.stopPropagation(); qPanel.classList.toggle('is-hidden'); });
      document.addEventListener('click', (e) => { if (!qWrap.contains(e.target)) qPanel.classList.add('is-hidden'); });
      qWrap.appendChild(qBtn); qWrap.appendChild(qPanel);
      // Colour by: feature/line type (when the slicer tagged moves), height, or speed.
      const colorSel = el('select', { class: 'anr-btn anr-select', 'aria-label': 'Colour by', title: 'Colour by' });
      if (data.hasTypes) colorSel.appendChild(el('option', { value: '0' }, 'Colour: line type'));
      else if (cncTools.length > 1) colorSel.appendChild(el('option', { value: '0' }, 'Colour: tool'));
      colorSel.appendChild(el('option', { value: '1' }, 'Colour: height'));
      colorSel.appendChild(el('option', { value: '2' }, 'Colour: speed'));
      colorSel.value = String(viewer.state.mode);
      colorSel.addEventListener('change', () => { viewer.state.mode = +colorSel.value; viewer.markDirty(); });
      const travelBtn = el('button', { type: 'button', class: 'anr-btn' }, isPrint ? 'Show travel' : 'Show rapids');
      if (viewer.hasTravel) {
        travelBtn.addEventListener('click', () => {
          viewer.state.showTravel = !viewer.state.showTravel;
          travelBtn.textContent = viewer.state.showTravel ? (isPrint ? 'Hide travel' : 'Hide rapids') : (isPrint ? 'Show travel' : 'Show rapids');
          viewer.markDirty();
        });
      } else travelBtn.disabled = true;
      const fsBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Fullscreen');
      fsBtn.addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else if (viewer.wrap.requestFullscreen) viewer.wrap.requestFullscreen(); });

      controls.appendChild(spinBtn); controls.appendChild(resetBtn); controls.appendChild(projBtn); controls.appendChild(colorSel); controls.appendChild(travelBtn); controls.appendChild(fsBtn); controls.appendChild(qWrap);
      controls.appendChild(el('span', { class: 'anr-hint', style: 'font-size:12px;margin-left:auto;' }, 'drag to orbit · right-drag to pan · scroll to zoom'));
      viewCard.appendChild(controls);

      // OrcaSlicer-style show/hide by line type, with a colour swatch per feature.
      if (data.hasTypes && data.features.length) {
        const legend = el('div', { class: 'anr-gcode-legend' });
        legend.appendChild(el('span', { class: 'anr-hint', style: 'font-size:12px;margin-right:2px;' }, 'Show:'));
        for (const id of data.features) {
          const f = FEATURES[id];
          const swatch = el('span', { class: 'anr-gcode-swatch', style: `background:rgb(${Math.round(f.rgb[0] * 255)},${Math.round(f.rgb[1] * 255)},${Math.round(f.rgb[2] * 255)})` });
          const cb = el('input', { type: 'checkbox', checked: '' });
          cb.addEventListener('change', () => { viewer.state.vis[id] = cb.checked ? 1 : 0; viewer.markDirty(); });
          legend.appendChild(el('label', { class: 'anr-gcode-legitem' }, [cb, swatch, document.createTextNode(f.label)]));
        }
        viewCard.appendChild(legend);
      }

      // CNC: a button per tool (styled like the 3MF parts picker) to show/hide that
      // tool's cutting moves. Shown above the viewer, all visible by default; click
      // to toggle one off and isolate the rest.
      if (cncTools.length > 1) {
        const toolRow = el('div', { class: 'anr-btn-row', style: 'margin:0 0 10px;align-items:center;gap:6px;' });
        toolRow.appendChild(el('span', { class: 'anr-hint', style: 'font-size:12px;margin-right:2px;' }, 'Tools:'));
        for (const t of cncTools) {
          const f = FEATURES[t.slot];
          const swatch = el('span', { class: 'anr-gcode-swatch', style: `background:rgb(${Math.round(f.rgb[0] * 255)},${Math.round(f.rgb[1] * 255)},${Math.round(f.rgb[2] * 255)})` });
          const chip = el('button', { type: 'button', class: 'anr-btn anr-gcode-toolchip' }, [swatch, document.createTextNode(toolLabel(t.n))]);
          chip.addEventListener('click', () => {
            const off = chip.classList.toggle('is-off');   // toggle this tool's visibility
            viewer.state.vis[t.slot] = off ? 0 : 1; viewer.markDirty();
          });
          toolRow.appendChild(chip);
        }
        viewCard.insertBefore(toolRow, viewer.wrap);   // above the 3D viewport
      }

      const zLo = data.bbox.min[2], zHi = data.bbox.max[2];
      const slider = el('input', { type: 'range', class: 'anr-range', min: '1', max: '1000', value: '1000', title: 'Build height', style: 'flex:1;min-width:110px;', 'aria-label': 'Show build up to height' });
      const sliderVal = el('span', { class: 'anr-hint', style: 'font-size:12px;min-width:64px;text-align:right;' }, zHi.toFixed(1) + ' mm');
      slider.addEventListener('input', () => { const t = (+slider.value) / 1000; viewer.state.clip = t; viewer.markDirty(); sliderVal.textContent = (zLo + t * (zHi - zLo)).toFixed(1) + ' mm'; });
      const heightRow = el('div', { class: 'anr-btn-row', style: 'margin-top:8px;align-items:center;flex-wrap:nowrap;' });
      heightRow.appendChild(el('span', { class: 'anr-hint', style: 'font-size:12px;white-space:nowrap;' }, 'Build height'));
      heightRow.appendChild(slider); heightRow.appendChild(sliderVal);
      viewCard.appendChild(heightRow);

      // G-code progress: scrub through the moves in print order to watch the part
      // build up, with a Play button + speed picker that animate it start to finish.
      const progSlider = el('input', { type: 'range', class: 'anr-range', min: '0', max: '1000', value: '1000', title: 'G-code progress', style: 'flex:1;min-width:110px;', 'aria-label': 'Reveal moves up to' });
      const progVal = el('span', { class: 'anr-hint', style: 'font-size:12px;min-width:104px;text-align:right;' }, data.segCount.toLocaleString() + ' moves');
      const setProgress = (n, fromSlider) => {
        n = Math.max(0, Math.min(data.segCount, n));
        viewer.state.shown = n; viewer.markDirty();
        if (!fromSlider) progSlider.value = String(data.segCount ? Math.round(n / data.segCount * 1000) : 1000);
        progVal.textContent = Math.round(n).toLocaleString() + ' / ' + data.segCount.toLocaleString();
      };
      let playing = false, playRAF = 0, lastTs = 0;
      function stopPlay() { if (!playing) return; playing = false; playBtn.textContent = 'Play'; viewer.state.head = false; viewer.markDirty(); if (playRAF) cancelAnimationFrame(playRAF); playRAF = 0; }
      function stepPlay(ts) {
        if (!playing) return;
        if (!viewer.wrap.isConnected) { stopPlay(); return; }
        if (!lastTs) lastTs = ts;
        const dt = Math.min(0.25, (ts - lastTs) / 1000); lastTs = ts;
        if (realtime) {
          // Advance by wall-clock against the real per-move timeline.
          playElapsed += dt;
          let n = viewer.state.shown | 0;
          while (n < data.segCount && cumTime[n + 1] <= playElapsed) n++;
          if (n >= data.segCount) { setProgress(data.segCount); stopPlay(); return; }
          setProgress(n);
        } else {
          const n = viewer.state.shown + playLps * dt;
          if (n >= data.segCount) { setProgress(data.segCount); stopPlay(); return; }
          setProgress(n);
        }
        playRAF = requestAnimationFrame(stepPlay);
      }
      const playBtn = el('button', { type: 'button', class: 'anr-btn', title: 'Play the print start to finish' }, 'Play');
      playBtn.addEventListener('click', () => {
        if (playing) { stopPlay(); return; }
        if (viewer.state.shown >= data.segCount) setProgress(0);   // replay from the start
        playing = true; lastTs = 0; playBtn.textContent = 'Pause'; viewer.state.head = true; viewer.markDirty();
        playElapsed = cumTime[Math.max(0, Math.min(data.segCount, viewer.state.shown | 0))];
        playRAF = requestAnimationFrame(stepPlay);
      });
      // Playback rate in lines/s. A "length" preset scales to the file
      // (lines/s = total moves / seconds), so any program finishes in that many
      // seconds; a "lines/s" preset is a fixed rate. Default: whole job in 20s.
      const lpsForLen = (sec) => Math.max(1, data.segCount / sec);
      let playLps = lpsForLen(20);
      let realtime = false, playElapsed = 0;

      // Per-segment real durations (move length / feedrate) and their running total,
      // for true real-time playback - each move takes as long as it would on the
      // machine. Feed is units/min, coords are in file units, so both agree.
      const cumTime = new Float64Array(data.segCount + 1);
      for (let s = 0; s < data.segCount; s++) {
        const p = s * 10;
        const len = Math.hypot(data.seg[p + 3] - data.seg[p], data.seg[p + 4] - data.seg[p + 1], data.seg[p + 5] - data.seg[p + 2]);
        const f = data.seg[p + 8];
        cumTime[s + 1] = cumTime[s] + (f > 1e-6 ? len / (f / 60) : 0);
      }
      const realTotal = cumTime[data.segCount];
      const fmtDur = (sec) => { sec = Math.round(sec); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), ss = sec % 60; return h ? `${h}h ${m}m` : m ? `${m}m ${ss}s` : `${ss}s`; };

      const LINE_PRESETS = [[100, '100 lines/s'], [500, '500 lines/s'], [1000, '1k lines/s'], [5000, '5k lines/s'], [10000, '10k lines/s'], [20000, '20k lines/s']];
      const LEN_PRESETS = [10, 20, 30, 60, 120];

      const spdWrap = el('span', { class: 'anr-aa-wrap' });
      const spdBtn = el('button', { type: 'button', class: 'anr-btn', title: 'Playback speed' }, 'Speed');
      const spdPanel = el('div', { class: 'anr-aa-panel anr-spd-panel is-hidden' });
      const setLabel = (txt) => { spdBtn.textContent = 'Speed: ' + txt; };
      const allPresetBtns = [];
      const clearActive = () => allPresetBtns.forEach((b) => b.classList.remove('is-active'));
      const rtWarn = el('p', { class: 'anr-spd-warn', hidden: '' }, 'Real time is only an estimate - the file has no data on acceleration, rapid speeds or tool-change times, so don\'t take it literally.');
      const choose = (lps, label, btn) => { realtime = false; playLps = lps; setLabel(label); clearActive(); if (btn) btn.classList.add('is-active'); rtWarn.hidden = true; };
      const chooseReal = (btn) => { realtime = true; setLabel('real time (' + fmtDur(realTotal) + ')'); clearActive(); if (btn) btn.classList.add('is-active'); rtWarn.hidden = false; };

      const cols = el('div', { class: 'anr-spd-cols' });
      const mkCol = (title) => { const c = el('div', { class: 'anr-spd-col' }); c.appendChild(el('div', { class: 'anr-spd-title' }, title)); return c; };
      const lpsCol = mkCol('Lines/s'), lenCol = mkCol('Length');
      for (const [v, l] of LINE_PRESETS) {
        const b = el('button', { type: 'button', class: 'anr-btn anr-spd-opt' }, l);
        b.addEventListener('click', () => choose(v, l, b));
        allPresetBtns.push(b); lpsCol.appendChild(b);
      }
      let defBtn = null;
      for (const s of LEN_PRESETS) {
        const b = el('button', { type: 'button', class: 'anr-btn anr-spd-opt' }, s + 's');
        b.addEventListener('click', () => choose(lpsForLen(s), 'whole job in ' + s + 's', b));
        allPresetBtns.push(b); lenCol.appendChild(b);
        if (s === 20) defBtn = b;
      }
      // Real time: play each move at its true duration. Show the total so it's clear
      // how long that is before committing to it.
      if (realTotal > 0) {
        const rb = el('button', { type: 'button', class: 'anr-btn anr-spd-opt', title: 'Real time - play at the toolpath\'s real execution time' }, fmtDur(realTotal));
        rb.addEventListener('click', () => chooseReal(rb));
        allPresetBtns.push(rb); lenCol.appendChild(rb);
      }
      cols.appendChild(lpsCol); cols.appendChild(lenCol);
      spdPanel.appendChild(cols);

      // Custom rate: a number + a unit toggle (lines/s <-> length in seconds).
      let customMode = 'len';   // 'lps' = lines/s, 'len' = seconds
      const customRow = el('div', { class: 'anr-spd-custom' });
      const customIn = el('input', { type: 'number', min: '1', step: '1', class: 'anr-spd-input', placeholder: 'Custom', 'aria-label': 'Custom playback rate' });
      const unitBtn = el('button', { type: 'button', class: 'anr-btn anr-spd-unit', title: 'Switch the custom value between lines per second and total length' }, 'length (s)');
      const applyCustom = () => {
        const v = parseFloat(customIn.value);
        if (!(v > 0)) return;
        if (customMode === 'lps') choose(v, Math.round(v).toLocaleString() + ' lines/s', null);
        else choose(lpsForLen(v), 'whole job in ' + v + 's', null);
      };
      customIn.addEventListener('input', applyCustom);
      unitBtn.addEventListener('click', () => { customMode = customMode === 'lps' ? 'len' : 'lps'; unitBtn.textContent = customMode === 'lps' ? 'lines/s' : 'length (s)'; applyCustom(); });
      customRow.appendChild(customIn); customRow.appendChild(unitBtn);
      spdPanel.appendChild(customRow);

      spdBtn.addEventListener('click', (e) => { e.stopPropagation(); spdPanel.classList.toggle('is-hidden'); });
      document.addEventListener('click', (e) => { if (!spdWrap.contains(e.target)) spdPanel.classList.add('is-hidden'); });
      spdWrap.appendChild(spdBtn); spdWrap.appendChild(spdPanel);
      choose(playLps, 'whole job in 20s', defBtn);   // default selection

      progSlider.addEventListener('input', () => { stopPlay(); setProgress(Math.round(data.segCount * (+progSlider.value) / 1000), true); });

      const progRow = el('div', { class: 'anr-btn-row', style: 'margin-top:8px;align-items:center;' });
      progRow.appendChild(el('span', { class: 'anr-hint', style: 'font-size:12px;white-space:nowrap;' }, isPrint ? 'Print progress' : 'Toolpath'));
      progRow.appendChild(playBtn);
      progRow.appendChild(spdWrap);
      progRow.appendChild(progSlider);
      progRow.appendChild(progVal);
      viewCard.appendChild(progRow);
      viewCard.appendChild(rtWarn);   // approximate-real-time caveat (shown in real-time mode)

      resultsEl.appendChild(viewCard);
      viewer.start();
      window.addEventListener('resize', () => viewer.resize());
    } else resultsEl.appendChild(viewCard);
  } else {
    resultsEl.appendChild(el('div', { class: 'anr-card' }, [el('h3', {}, 'Toolpath'), el('p', { class: 'anr-hint' }, 'No drawable moves were found in this G-code.')]));
  }

  // --- Analyser readout ---
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'G-code analysis'));
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Application', 'G-code (3D printing / CNC)'));
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`));
  tbl.appendChild(rowHelp('Type', isPrint ? '3D print (extrusion)' : 'CNC / laser (no extrusion)', 'Whether the program extrudes material (a 3D print) or only moves a tool/laser (CNC machining or laser cutting).'));
  tbl.appendChild(rowHelp('Units', u === 'mm' ? 'Millimetres (G21)' : 'Inches (G20)', 'The measurement units the coordinates are expressed in.'));
  const slicer = detectSlicer(data.headerComments);
  if (slicer) tbl.appendChild(rowHelp(isPrint ? 'Slicer' : 'CAM / sender', slicer, 'The program that generated this G-code, read from the file header.'));
  if (data.printTime) tbl.appendChild(rowHelp('Est. print time', data.printTime, 'The print-time estimate the slicer wrote into the file header.'));
  if (data.bbox && isFinite(data.bbox.min[0])) {
    const dx = data.bbox.max[0] - data.bbox.min[0], dy = data.bbox.max[1] - data.bbox.min[1], dz = data.bbox.max[2] - data.bbox.min[2];
    tbl.appendChild(rowHelp(isPrint ? 'Object size' : 'Work size', `${dx.toFixed(1)} × ${dy.toFixed(1)} × ${dz.toFixed(1)} ${u}`, 'The bounding box of all drawn moves - width × depth × height.'));
  }
  if (isPrint) {
    if (data.layerCount) tbl.appendChild(rowHelp('Layers', data.layerCount.toLocaleString(), 'The number of distinct Z heights at which material was extruded.'));
    if (data.layerHeight) tbl.appendChild(rowHelp('Layer height', data.layerHeight.toFixed(3) + ' ' + u, 'The typical vertical step between layers (median Z gap).'));
    tbl.appendChild(rowHelp('Filament Ø', data.filDia.toFixed(2) + ' mm', 'The filament diameter used to recover extrusion widths (from the file, else 1.75 mm).'));
    if (data.extrudeMM) tbl.appendChild(rowHelp('Filament used', `${(data.extrudeMM / 1000).toFixed(2)} m  (${Math.round(data.extrudeMM).toLocaleString()} ${u})`, 'Total length of filament extruded, summed from the E axis.'));
    if (data.temps.nozzle) tbl.appendChild(rowHelp('Nozzle temp', data.temps.nozzle + ' °C', 'The hot-end target temperature set in the program (M104/M109).'));
    if (data.temps.bed) tbl.appendChild(rowHelp('Bed temp', data.temps.bed + ' °C', 'The heated-bed target temperature set in the program (M140/M190).'));
  } else {
    if (data.cutMM) tbl.appendChild(rowHelp('Cut path length', `${(data.cutMM / 1000).toFixed(2)} m  (${Math.round(data.cutMM).toLocaleString()} ${u})`, 'Total length of the cutting (feed) moves.'));
    const c = data.cnc;
    if (c) {
      if (c.changes.length) tbl.appendChild(rowHelp('Tool changes', `${c.changes.length.toLocaleString()}  (${c.tools.length} tool${c.tools.length === 1 ? '' : 's'})`, 'Number of M6 tool changes in the program, and how many distinct tools it uses. See the tooling table below.'));
      if (c.spindleMax) tbl.appendChild(rowHelp('Max spindle speed', `${Math.round(c.spindleMax).toLocaleString()} rpm${c.spindleDir ? ' · ' + c.spindleDir : ''}`, 'The highest commanded spindle speed (S), and its direction (M3/M4).'));
      if (c.coolant.length) tbl.appendChild(rowHelp('Coolant', c.coolant.join(', '), 'Coolant modes switched on in the program (M7 mist / M8 flood).'));
      if (c.workOffsets.length) tbl.appendChild(rowHelp('Work offsets', c.workOffsets.join(', '), 'The work-coordinate systems (G54-G59) the program sets - one per fixture/setup.'));
    }
  }
  tbl.appendChild(rowHelp(isPrint ? 'Extrusion segments' : 'Cutting moves', data.segCount.toLocaleString(), 'The number of drawn segments - the geometry shown in the viewer (arcs are tessellated into segments).'));
  if (data.counts.arc) tbl.appendChild(rowHelp('Arc moves', data.counts.arc.toLocaleString(), 'G2/G3 circular moves, drawn as smooth tessellated arcs.'));
  tbl.appendChild(rowHelp('Travel / rapid moves', data.counts.rapid.toLocaleString(), 'Non-cutting repositioning moves, hidden by default in the viewer.'));
  if (data.feedRange.max) tbl.appendChild(rowHelp('Feedrate range', `${Math.round(data.feedRange.min).toLocaleString()} - ${Math.round(data.feedRange.max).toLocaleString()} ${u}/min`, 'The slowest to fastest commanded feedrate (F) across drawn moves.'));
  if (data.capped) tbl.appendChild(row('Note', `Capped at ${SEG_CAP.toLocaleString()} segments for performance; the viewer shows the first ones.`));
  tbl.appendChild(sha256Row(file));
  card.appendChild(tbl);

  if (data.headerComments.length) {
    const lines = data.headerComments, PRE = 200;
    const det = el('details', { style: 'margin-top:14px;' });
    det.appendChild(el('summary', {}, `Header comments (${lines.length.toLocaleString()} lines)`));
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
    card.appendChild(det);
  }
  resultsEl.appendChild(card);

  // --- Tooling (CNC) ---
  const cnc = data.cnc;
  if (cnc && (cnc.tools.length || cnc.changes.length)) {
    const tc = el('div', { class: 'anr-card' });
    tc.appendChild(el('h3', {}, 'Tooling'));

    if (cnc.tools.length) {
      const tt = el('table', { class: 'anr-readout anr-gcode-tooltable' });
      const head = el('tr', {}, [
        el('th', {}, 'Tool'), el('th', {}, 'Type'), el('th', {}, 'Ø'),
        el('th', {}, 'Corner / taper'), el('th', {}, 'Z min'), el('th', {}, 'Spindle'),
      ]);
      tt.appendChild(head);
      for (const t of cnc.tools) {
        let geom = '';
        if (t.cr != null && t.cr > 0) geom = `R${t.cr} ${u}`;
        else if (t.taper != null) geom = `${t.taper}° taper`;
        else if (t.cr === 0) geom = 'flat';
        tt.appendChild(el('tr', {}, [
          el('td', {}, 'T' + t.n),
          el('td', {}, t.desc ? titleCase(t.desc) : '-'),
          el('td', {}, t.dia != null ? t.dia + ' ' + u : '-'),
          el('td', {}, geom || '-'),
          el('td', {}, t.zmin != null ? t.zmin + ' ' + u : '-'),
          el('td', {}, t.rpm != null ? Math.round(t.rpm).toLocaleString() + ' rpm' : '-'),
        ]));
      }
      tc.appendChild(tt);
    }

    // Tool-change sequence, with the operation name each change kicks off (when the
    // CAM post wrote one). Long programs revisit tools, so this shows the order.
    if (cnc.changes.length) {
      const seq = cnc.changes.map((c, i) => {
        const op = c.op ? ` ${titleCase(c.op)}` : '';
        return `${i + 1}. T${c.n}${op}`;
      });
      const det = el('details', { style: 'margin-top:14px;' });
      det.appendChild(el('summary', {}, `Tool-change sequence (${cnc.changes.length.toLocaleString()})`));
      const pre = el('pre', { class: 'anr-code', style: 'max-height:280px;overflow:auto;font-size:12px;' });
      pre.textContent = seq.join('\n');
      det.appendChild(pre);
      tc.appendChild(det);
    }
    resultsEl.appendChild(tc);
  }
}
