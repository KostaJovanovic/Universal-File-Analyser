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

import { el, row, rowHelp, fmtBytes, sha256Row, errorCard, attachViewCube, downloadBlob } from '../core/util.js';

// Rendered-segment caps, scaled to the device's RAM so arc-heavy / multi-day prints
// (millions of tessellated segments) fill in on a capable desktop without OOM-crashing
// low-memory or mobile devices. navigator.deviceMemory is GB, browser-clamped to 8 at the
// top and 0.25 at the bottom; absent (Safari/Firefox don't expose it) -> assume mid-range.
// Each extrusion segment costs ~40B (CPU) + ~44B (instance) + ~44B (GPU), so 6M ~= 0.8GB.
const DEVICE_GB = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 4;
const SEG_CAP = DEVICE_GB >= 8 ? 6000000 : DEVICE_GB >= 4 ? 3000000 : 1300000;
const TRAVEL_CAP = DEVICE_GB >= 8 ? 2000000 : DEVICE_GB >= 4 ? 1000000 : 400000;
const ARC_TOL = 0.02;             // arc chord tolerance (mm)
const ARC_MIN_STEPS = 2, ARC_MAX_STEPS = 256;
const DEF_DIA = 1.75;             // default filament diameter (mm)
// Per-feature-type depth nudge. Overlapping beads of different feature types
// (outer wall / inner wall / infill / solid) sit at nearly the same depth where the
// boxes interpenetrate, so the depth buffer flickers between them per pixel (z-fighting).
// Offsetting each type by a tiny amount keeps lower types (outer wall first) consistently
// in front, killing the rainbow shimmer. The nudge is a constant WORLD-space depth offset
// (computed per frame from the projection, not a constant NDC offset - which would balloon
// with camera distance and shove a lower layer through the one above it), and the per-type
// step is a small fraction of a layer height so the total across all types stays well under
// one layer - it can never reorder real stacked layers, only break coplanar same-layer ties.
const TYPE_BIAS_LAYER_FRAC = 0.06;   // per feature-type, as a fraction of one layer height

// Pause / dwell playback timing. A real heat-up or program stop can take minutes,
// which would freeze playback, so every hold is capped to a few seconds of replay.
const PAUSE_CAP_S = 3;            // max hold for any single pause (playback seconds)
const MANUAL_PAUSE_S = 3;         // M0/M1 are indefinite real-world stops - a fixed, capped beat
const TOOLCHANGE_PAUSE_S = 4;     // M600 filament change / tool-change Tn - park-and-swap beat
const HEAT_AMBIENT_C = 25;        // assumed cold/ambient start for heat-up estimates
const HEAT_RATE_C_PER_S = 8;      // rough nozzle/bed heating rate (deg C per second)
// Heat-up estimate from ambient to a target temperature (seconds): realHeat is the
// full estimate shown on the wait label; heatSecs is that capped to the playback hold.
const realHeat = (target) => Math.max(0, target - HEAT_AMBIENT_C) / HEAT_RATE_C_PER_S;
const heatSecs = (target) => Math.min(realHeat(target), PAUSE_CAP_S);

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
function parseGcode(text, opts) {
  const len = text.length;
  if (!len) return null;
  // Normally the rendered geometry is capped (see SEG_CAP); the "Show full anyway"
  // button re-parses with the cap lifted so even a multi-million-segment print draws whole.
  const segCap = opts && opts.uncapped ? Infinity : SEG_CAP;
  const travCap = opts && opts.uncapped ? Infinity : TRAVEL_CAP;
  // FDM prints emit travels as G1-without-E (not only G0) and do a lot of priming /
  // positioning travel *before* the first extrusion. Those leading moves are real
  // travels, but `sawExtrude` is still false then, so without an up-front print signal
  // they misroute to emitFeed and get drawn as zero-width (invisible) segments. A
  // set-hotend-temp (M104/M109) sits in every print's header and never in a CNC / laser
  // job, so it tells us early that non-extruding moves are travels. .test() short-circuits
  // on the first match (in the header), so this stays cheap even on huge files.
  const looksLikePrint = /\bM10[49]\b/.test(text);

  // ext record (10 floats): ax,ay,az, bx,by,bz, width, height, feed, type.
  // trav record (7 floats): ax,ay,az, bx,by,bz, feed (feed lets playback time travels).
  // order record (1 float): 0 = the next ext segment, 1 = the next travel, 2 = a pause
  // (a timeline-only hold - see `pause`) - the true print order of every *buffered*
  // move, so playback can replay extrusions and travels interleaved exactly as the
  // machine runs them, holding at dwells / waits.
  // pause record (1 float): hold duration in seconds, one per order==2 entry, in order.
  const ext = GrowBuf(10), trav = GrowBuf(7), order = GrowBuf(1), segFil = GrowBuf(1), pause = GrowBuf(1);
  // Per-pause human info for the wait label (one entry per order==2 move, in order):
  // { label: 'what it is waiting for', realSec: the G-code's intended duration (uncapped) }.
  const pauseInfo = [];

  // Multicolour / multi-material: the active filament index (set by T<n> tool selects
  // and bumped by M600 colour changes), recorded per extrusion segment so "colour by
  // filament" can paint each move in its filament's colour. filamentColors comes from
  // the slicer config block (; filament_colour = #RRGGBB;#RRGGBB;...).
  let curFil = 0, maxFil = 0, sawTool = false;
  // Tool-change marks for the progress slider: { at: move index, label } per change.
  const toolMarks = [];
  const filUsed = new Set();
  let filColRaw = '', extColRaw = '';
  // Machine / bed metadata, read from the slicer config block (Prusa/Orca/Bambu dump it
  // as `;` header/footer comments). printable_area / bed_shape is a polygon of "XxY"
  // points; curr_bed_type names the build plate; printable_height is the Z clearance.
  let bedShapeRaw = '', bedType = '', bedHeight = 0, printerModel = '';

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
  let skipActive = false;   // inside a Bambu "; SKIPPABLE_START ... timelapse ..." block
  const temps = {};
  let filDia = 0, sawG = false, sawExtrude = false;

  // CNC / milling specifics (Fanuc / Fusion / HSM style, written in () comments).
  // Tool table from "(T2 D=6. CR=0. - ZMIN=-29.5 - FLAT END MILL)" lines, tool
  // changes (T<n> M6), spindle speed/direction (S.. M3/M4), coolant (M7/M8/M9),
  // work-coordinate systems (G54-G59) and per-operation names (the () comment that
  // immediately precedes a tool change). Only scanned while no extrusion has been
  // seen, so 3D-print parsing stays fast.
  const toolDefs = new Map();        // tool# -> { n, dia, cr, taper, zmin, desc, rpm, h }
  const toolChanges = [];            // ordered [{ n, op }]
  const toolSlot = new Map();        // tool# -> colour slot (0-based, encounter order, cap 7)
  const coolant = new Set(), workOffsets = new Set();
  let curTool = null, pendingTool = null, lastParen = '', spindleMax = 0, spindleDir = '';
  let cncType = 7;                   // colour-channel slot of the active tool (CNC)
  const ensureTool = (n) => { let d = toolDefs.get(n); if (!d) { d = { n }; toolDefs.set(n, d); } return d; };
  // CAM operations (Fusion/HSM name each one in a () comment, e.g. "(2D ADAPTIVE1)").
  // Tools are reused across operations, so the op list is richer than the tool-change
  // list; track each op with the tool active during it and per-op move/length/depth.
  const operations = [];             // [{ name, tool, moves, cutLen, zmin }]
  let curOp = null;
  let progNum = '', progEnd = '', optStops = 0;   // O-number, M2/M30 end, M1 optional stops

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
    if (ext.count < segCap) { ext.push([x0, y0, z0, x1, y1, z1, w, h, feed, curType]); order.push([0]); segFil.push([curFil]); }
    nExtrude++; sawExtrude = true; featureSet.add(curType); filUsed.add(curFil);
    layerZ.add(Math.round(z1 * 1000));
    bump(x0, y0, z0); bump(x1, y1, z1);
    if (feed > 0) { if (feed < fmin) fmin = feed; if (feed > fmax) fmax = feed; }
  };
  const emitFeed = (x0, y0, z0, x1, y1, z1) => {
    const L = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    cutMM += L; nFeed++;
    if (ext.count < segCap) { ext.push([x0, y0, z0, x1, y1, z1, 0, 0, feed, cncType]); order.push([0]); segFil.push([curFil]); }  // width filled later for CNC; type = tool slot
    bump(x0, y0, z0); bump(x1, y1, z1);
    if (feed > 0) { if (feed < fmin) fmin = feed; if (feed > fmax) fmax = feed; }
  };
  const emitTravel = (x0, y0, z0, x1, y1, z1) => {
    if (trav.count < travCap) { trav.push([x0, y0, z0, x1, y1, z1, feed]); order.push([1]); }
    nRapid++;
  };
  // A pause is a timeline event, not geometry: it advances move order (so playback
  // can hold) but adds no ext/travel segment and leaves x/y/z and the bbox untouched.
  const emitPause = (holdSec, label, realSec) => {
    if (holdSec > 0) { order.push([2]); pause.push([holdSec]); pauseInfo.push({ label, realSec: realSec != null ? realSec : holdSec }); }
  };

  let i = 0;
  while (i < len) {
    let j = text.indexOf('\n', i); if (j < 0) j = len;
    let line = text.slice(i, j); i = j + 1;

    // Bambu timelapse: a per-layer "; SKIPPABLE_START / ; SKIPTYPE: timelapse /
    // ; SKIPPABLE_END" block parks the head to take a photo. The printer can skip the
    // block; skip it here too so the photo excursion isn't drawn as part of the print.
    // Markers are matched anchored (^...$) so the one-line "; time_lapse_gcode = ..."
    // header config (which mentions the marker words) can't trip it. Only timelapse
    // blocks are skipped - other SKIPPABLE types fall through and render normally.
    if (skipActive) {
      if (/^;\s*SKIPPABLE_END\s*$/i.test(line)) skipActive = false;
      else if (/^;\s*SKIPTYPE:/i.test(line) && !/timelapse/i.test(line)) skipActive = false;
      continue;
    }
    if (/^;\s*SKIPPABLE_START\s*$/i.test(line)) { skipActive = true; continue; }

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
      // Filament colours (multicolour). PrusaSlicer/Orca/Bambu dump a ;-separated
      // hex list "; filament_colour = #RRGGBB;#RRGGBB". Prefer filament_colour; fall
      // back to extruder_colour. The "_type"/"default_" variants carry no #, so the
      // hex-only value class makes them miss.
      if (!filColRaw) { mm = /filament[_ ]colou?r\s*[:=]\s*("?)(#[0-9A-Fa-f;,# ]+)/i.exec(cm); if (mm) filColRaw = mm[2].trim(); }
      if (!extColRaw) { mm = /extruder[_ ]colou?r\s*[:=]\s*("?)(#[0-9A-Fa-f;,# ]+)/i.exec(cm); if (mm) extColRaw = mm[2].trim(); }
      if (!printTime) { mm = /(?:print(?:ing)?\s*time|Print Time)[^:=]*[:=]?\s*([\dhms :]+\d[hms])/i.exec(cm); if (mm) printTime = mm[1].trim(); }
      // Machine / bed. printable_area (Bambu/Orca) and bed_shape (PrusaSlicer) are the
      // same "0x0,256x0,256x256,0x256" polygon; printer_model / curr_bed_type name the
      // hardware and plate. Anchored value classes so empty (`= `) fields don't match.
      if (!printerModel) { mm = /\bprinter_model\s*[:=]\s*("?)([^";\r\n]+)/i.exec(cm); if (mm) printerModel = mm[2].trim(); }
      if (!bedShapeRaw) { mm = /\b(?:printable_area|bed_shape|machine_bed_shape)\s*[:=]\s*([\d][\dxX.,\- ]+)/i.exec(cm); if (mm) bedShapeRaw = mm[1].trim(); }
      if (!bedType) { mm = /\b(?:curr_bed_type|default_bed_type|bed_type)\s*[:=]\s*([A-Za-z][\w .\-/+]*)/i.exec(cm); if (mm) bedType = mm[1].trim(); }
      if (!bedHeight) { mm = /\b(?:printable_height|max_print_height|machine_max_height)\s*[:=]\s*([\d.]+)/i.exec(cm); if (mm) bedHeight = parseFloat(mm[1]) || 0; }
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
        } else if (/^O?\d{1,6}$/.test(c)) {
          if (!progNum) progNum = c.replace(/^O/i, '');   // Fusion writes the program number as "(1001)"
        } else if (c.length <= 40 && !/^[-*=]/.test(c) && !/ATTENTION|ENSURE|RAISE|CLEARANCE|WARNING|^USING|^STOCK|^PART/i.test(c)) {
          lastParen = c;   // a plausible operation / section label
          // A new named operation. Tool may not be selected yet (the op comment precedes
          // its "T<n> M6"), so leave tool null - it is filled in at the tool change.
          curOp = { name: c, tool: curTool, moves: 0, cutLen: 0, zmin: Infinity };
          operations.push(curOp);
        }
      }
    }
    line = line.replace(/\([^)]*\)/g, '').trim();
    if (!line) continue;
    // A real command ends the header and resets the trailing-comment run.
    inHeader = false; if (footRun.length) footRun = [];

    const sp = line.indexOf(' ');
    const cmd = (sp < 0 ? line : line.slice(0, sp)).toUpperCase();

    // Active filament for multicolour prints: a tool select (T0/T1/...) switches it;
    // M600 (manual colour change) advances to the next colour. Cheap first-char gate so
    // ordinary coordinate lines don't pay for it. (CNC also uses T<n> M6 - harmless here,
    // its own tool-change handling runs below and filament colouring is FDM-only.)
    // Only small tool indices are real filament slots. Bambu/Prusa fire sentinel tool
    // codes (T255, T1000, ...) for unload / no-tool that aren't colour changes, so cap at
    // a sane multi-material range or a single-filament print reads as multicolour.
    // Tool select (T0/T1/...): switches the active filament/colour. Bambu and others
    // append params - e.g. "T2 H-1" - so match the first token, not only a bare-token line
    // (without this, multicolour prints look single-colour). Leave "Tn M6" to the CNC
    // tool-change handler below. AMS/toolchanger swaps purge into a wipe tower (geometry),
    // so they switch colour but don't pause; an explicit manual change (M600) does pause.
    if (cmd.charCodeAt(0) === 84 && !/\bM0?6\b/.test(line)) {
      const tn = /^T(\d+)$/.exec(cmd);
      if (tn) { const ti = +tn[1]; if (ti <= 32) {
        if (sawTool && ti !== curFil) toolMarks.push({ at: order.count, kind: 'tool', from: curFil, to: ti, z });
        sawTool = true; curFil = ti; if (curFil > maxFil) maxFil = curFil; } continue; } }
    if (cmd === 'M600') { toolMarks.push({ at: order.count, kind: 'filament', from: curFil, to: curFil + 1, z }); emitPause(TOOLCHANGE_PAUSE_S, 'Filament change', TOOLCHANGE_PAUSE_S); curFil++; if (curFil > maxFil) maxFil = curFil; continue; }

    // Plane select can share a line with an arc - "G17 G2 X.." - so set the plane but
    // fall through to motion handling rather than swallowing the move (Fusion/Mastercam
    // posts combine them). Only consume the line when it carries no motion.
    if (cmd === 'G17' || cmd === 'G18' || cmd === 'G19') {
      plane = cmd === 'G17' ? 17 : cmd === 'G18' ? 18 : 19;
      if (!/\bG0?[0-3]\b/i.test(line) && !(motionMode && /(^|\s)[XYZABCUVWIJKR]-?[\d.]/i.test(line))) continue;
    }
    switch (cmd) {
      case 'G90': absXYZ = true; continue;
      case 'G91': absXYZ = false; continue;
      case 'M82': absE = true; continue;
      case 'M83': absE = false; continue;
      case 'G20': unit = 25.4; continue;
      case 'G21': unit = 1; continue;
      default: break;
    }
    // M104/M140 set a temperature and move on; M109/M190 *wait* for it to be reached,
    // which is a real hold - estimate (and cap) the heat-up so playback pauses for it.
    if (cmd === 'M104' || cmd === 'M109') { const s = numAfter(line, 'S'); if (s > 0 && !temps.nozzle) temps.nozzle = s; if (cmd === 'M109' && s > 0) emitPause(heatSecs(s), 'Heat nozzle ' + Math.round(s) + '°C', realHeat(s)); continue; }
    if (cmd === 'M140' || cmd === 'M190') { const s = numAfter(line, 'S'); if (s > 0 && !temps.bed) temps.bed = s; if (cmd === 'M190' && s > 0) emitPause(heatSecs(s), 'Heat bed ' + Math.round(s) + '°C', realHeat(s)); continue; }
    // G4 dwell (P = milliseconds, S = seconds) and M0/M1 program stops are deliberate
    // pauses - hold for them so playback matches how the machine actually runs.
    if (cmd === 'G4' || cmd === 'G04') { const p = numAfter(line, 'P'), s = numAfter(line, 'S'); const sec = p > 0 ? p / 1000 : (s > 0 ? s : 0); emitPause(Math.min(sec, PAUSE_CAP_S), 'Dwell', sec); continue; }
    if (cmd === 'M0' || cmd === 'M00') { emitPause(MANUAL_PAUSE_S, 'Pause', MANUAL_PAUSE_S); continue; }
    if (cmd === 'M1' || cmd === 'M01') { optStops++; emitPause(MANUAL_PAUSE_S, 'Optional stop', MANUAL_PAUSE_S); continue; }
    if (cmd === 'M2' || cmd === 'M02') { if (!progEnd) progEnd = 'M2 (end)'; continue; }
    if (cmd === 'M30') { progEnd = 'M30 (end + rewind)'; continue; }
    if (!progNum && /^O\d{1,6}$/.test(cmd)) { progNum = cmd.slice(1); continue; }

    // CNC modal words (can share a line with motion). Cheap char-gate first so plain
    // coordinate lines on big files don't pay for the regex scans.
    if (!sawExtrude && (line.indexOf('T') >= 0 || line.indexOf('M') >= 0 || line.indexOf('S') >= 0 || line.indexOf('G5') >= 0 || line.indexOf('H') >= 0)) {
      let g;
      if ((g = /\bT(\d+)\b/.exec(line))) pendingTool = +g[1];
      if (/\bM0?6\b/.test(line) && pendingTool != null) {
        ensureTool(pendingTool);
        toolChanges.push({ n: pendingTool, op: lastParen || '' });
        // A tool change at the very start of an operation (before it has cut anything)
        // belongs to that operation - the op-name comment is written just before it, so
        // curOp.tool still holds the previous tool and must be corrected to this one.
        if (curOp && curOp.moves === 0) curOp.tool = pendingTool;
        // A change to a different tool mid-program is a real pause - the spindle stops
        // and the tool is swapped (ATC or by hand). Skip the initial load (curTool null).
        if (curTool != null && pendingTool !== curTool) { toolMarks.push({ at: order.count, kind: 'tool', from: curTool, to: pendingTool, z, desc: (toolDefs.get(pendingTool) || {}).desc }); emitPause(TOOLCHANGE_PAUSE_S, 'Tool change', TOOLCHANGE_PAUSE_S); }
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
      // G43 tool-length compensation: remember the H offset register per tool.
      if (/\bG43\b/.test(line) && (g = /\bH(\d+)\b/.exec(line)) && curTool != null) { const d = toolDefs.get(curTool); if (d && d.h == null) d.h = +g[1]; }
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
    // Motion word anywhere on the line (a CNC post can prefix it with a tool-length
    // offset / plane-select, e.g. "G43 Z.." or "G17 G2 X.."); otherwise a bare-coordinate
    // line continues the previous G0-G3 mode modally.
    let mo = null;
    const gMove = /\bG0?([0-3])\b/i.exec(line);
    if (gMove) mo = 'G' + gMove[1];
    else if (motionMode && /(^|\s)[XYZABCUVWIJKR]-?[\d.]/i.test(line)) mo = motionMode;
    if (!mo) continue;
    motionMode = mo;
    const isLine = mo === 'G0' || mo === 'G1';   // else it's an arc (G2/G3)
    sawG = true;

    const t = parseAxes(line);
    if (t.f !== null) feed = t.f * unit;
    const nx = t.x === null ? x : (absXYZ ? t.x * unit : x + t.x * unit);
    const ny = t.y === null ? y : (absXYZ ? t.y * unit : y + t.y * unit);
    const nz = t.z === null ? z : (absXYZ ? t.z * unit : z + t.z * unit);
    let de = 0;
    if (t.e !== null) de = (absE ? (t.e * unit - e) : t.e * unit);
    const extruding = de > 1e-6;

    // A non-extruding linear/arc move is a travel on a 3D print but a cutting feed
    // move on a CNC job. Many slicers (PrusaSlicer/SuperSlicer/Orca) emit travels as
    // G1-without-E, not G0, so keying purely on G0 loses almost every travel; instead,
    // once any extrusion has been seen (sawExtrude), treat every non-extruding move as
    // travel. CNC files never extrude, so their feed moves still route to emitFeed.
    const nonExtrudeTravel = mo === 'G0' || sawExtrude || looksLikePrint;
    if (isLine) {
      const moved = nx !== x || ny !== y || nz !== z;
      if (moved) {
        if (extruding) { emitExtrude(x, y, z, nx, ny, nz, de); extrudeMM += de; }
        else if (nonExtrudeTravel) emitTravel(x, y, z, nx, ny, nz);
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
          else if (nonExtrudeTravel) emitTravel(a[0], a[1], a[2], b[0], b[1], b[2]);
          else emitFeed(a[0], a[1], a[2], b[0], b[1], b[2]);
        }
        if (extruding) extrudeMM += de;
      } else {
        if (extruding) { emitExtrude(x, y, z, nx, ny, nz, de); extrudeMM += de; }
        else if (nonExtrudeTravel) emitTravel(x, y, z, nx, ny, nz);
        else emitFeed(x, y, z, nx, ny, nz);
      }
    }
    // Per-operation tally (CNC): count source moves, deepest Z and cutting length so the
    // operations table can show the size of each one.
    if (curOp) {
      curOp.moves++;
      if (nz < curOp.zmin) curOp.zmin = nz;
      if (!extruding && mo !== 'G0') curOp.cutLen += Math.hypot(nx - x, ny - y, nz - z);
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

  // Resolve the filament colour palette. Use the slicer's own hex list where present;
  // otherwise (e.g. M600 colour changes with no list) fall back to a distinct palette so
  // each filament is still told apart. The number of slots covers every filament used.
  const FIL_FALLBACK = ['#FF8000', '#1F77FF', '#2CA02C', '#D62798', '#FFD000', '#17BECF', '#E6194B', '#8C56FF'];
  const hexList = (filColRaw || extColRaw).split(/[;,]/).map((s) => s.trim()).filter((s) => /^#?[0-9A-Fa-f]{6}$/.test(s)).map((s) => s[0] === '#' ? s : '#' + s);
  const filSlots = Math.max(1, maxFil + 1, hexList.length, filUsed.size);
  const filamentColors = [];
  for (let k = 0; k < filSlots; k++) filamentColors.push(hexList[k] || FIL_FALLBACK[k % FIL_FALLBACK.length]);
  // Only a genuine multi-filament print, not a single-material one whose slicer config
  // merely lists every configured filament colour in the `; filament_colour =` header.
  const multicolour = sawExtrude && (filUsed.size > 1 || maxFil > 0);

  // Parse the printable-area polygon ("x0 x y0, x1 x y0, ...") into a bounding rectangle
  // (+ the raw polygon for non-rectangular plates) so the viewer can draw the plate.
  let bed = null;
  if (bedShapeRaw) {
    const poly = [];
    for (const tok of bedShapeRaw.split(',')) {
      const m = /(-?[\d.]+)\s*[xX]\s*(-?[\d.]+)/.exec(tok.trim());
      if (m) poly.push([parseFloat(m[1]), parseFloat(m[2])]);
    }
    if (poly.length >= 2) {
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (const [px, py] of poly) { if (px < bx0) bx0 = px; if (py < by0) by0 = py; if (px > bx1) bx1 = px; if (py > by1) by1 = py; }
      const w = bx1 - bx0, d = by1 - by0;
      if (w > 1 && d > 1) bed = { x0: bx0, y0: by0, x1: bx1, y1: by1, w, d, h: bedHeight, type: bedType, poly };
    }
  }

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
    travel: trav.view(),       // 7 floats / segment
    travelCount: trav.count,
    order: order.view(),       // 1 float / move: 0 = ext, 1 = travel, 2 = pause, in true print order
    orderCount: order.count,
    pauses: pause.view(),      // 1 float / pause move (order==2): hold duration in seconds
    pauseCount: pause.count,
    pauseInfo,                 // [{ label, realSec }] per pause move, in order - for the wait label
    toolMarks,                 // [{ at: move index, label }] per tool change - for the slider markers
    segFil: segFil.view(),     // 1 float / ext segment: active filament index
    filamentColors,            // ['#RRGGBB', ...] one per filament slot
    multicolour,               // true when the print uses more than one filament / colour
    filsUsed: [...filUsed].sort((a, b) => a - b),
    capped: ext.count >= segCap || trav.count >= travCap,
    bbox: { min: [minx, miny, minz], max: [maxx, maxy, maxz] },
    bed,                       // { x0,y0,x1,y1,w,d,h,type,poly } printable area, or null
    printerModel,              // e.g. "Bambu Lab A1" (from the slicer config), or ''
    units: unit === 1 ? 'mm' : 'in',
    layerCount: zs.length,
    layerZs: zs,                // sorted unique layer heights - drives the live "Layer x / y" readout
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
      // CAM operations in program order, with per-op move/length/depth (zmin -> null when
      // the op drew nothing, e.g. a pure setup block).
      operations: operations.map((o) => ({ name: o.name, tool: o.tool, moves: o.moves, cutLen: o.cutLen, zmin: isFinite(o.zmin) ? o.zmin : null })),
      // Tools that actually cut, in encounter order, each mapped to a colour slot -
      // drives the colour-by-tool mode and the per-tool show/hide legend.
      toolColors: [...toolSlot.entries()].map(([n, slot]) => ({ n, slot })).sort((a, b) => a.slot - b.slot),
      spindleMax, spindleDir,
      coolant: [...coolant],
      workOffsets: [...workOffsets],
      progNum, progEnd, optStops,
      maxDepth: isFinite(minz) ? minz : null,   // deepest Z reached (most negative)
    },
    headerComments: allComments,
  };
}

function arcPoints(x0, y0, z0, x1, y1, z1, t, unit, cw, plane) {
  // Work in the active plane's two in-plane axes (f, s) plus the out-of-plane axis (w,
  // linearly interpolated for a helix). The RS274 canonical axis ordering per plane -
  // G17 (X,Y), G18 (Z,X), G19 (Y,Z) - is chosen so the same maths and CW/CCW sense work
  // for all three (each pair is right-handed about its perpendicular axis).
  const I = t.i !== null ? t.i * unit : null, J = t.j !== null ? t.j * unit : null, K = t.k !== null ? t.k * unit : null;
  let f0, s0, f1, s1, w0, w1, cf, cs;
  if (plane === 18) { f0 = z0; s0 = x0; f1 = z1; s1 = x1; w0 = y0; w1 = y1; if (I !== null || K !== null) { cf = z0 + (K || 0); cs = x0 + (I || 0); } }
  else if (plane === 19) { f0 = y0; s0 = z0; f1 = y1; s1 = z1; w0 = x0; w1 = x1; if (J !== null || K !== null) { cf = y0 + (J || 0); cs = z0 + (K || 0); } }
  else { f0 = x0; s0 = y0; f1 = x1; s1 = y1; w0 = z0; w1 = z1; if (I !== null || J !== null) { cf = x0 + (I || 0); cs = y0 + (J || 0); } }
  if (cf === undefined) {
    // R (radius) form: centre is offset from the chord midpoint, perpendicular to it.
    if (t.r === null) return null;
    const r = t.r * unit, mf = (f0 + f1) / 2, ms = (s0 + s1) / 2;
    const df = f1 - f0, ds = s1 - s0, d = Math.hypot(df, ds);
    if (d < 1e-9 || Math.abs(r) < d / 2 - 1e-6) return null;
    const h = Math.sqrt(Math.max(0, r * r - (d * d) / 4));
    const of = -ds / d * h, os = df / d * h;
    const sign = (cw ? 1 : -1) * (r < 0 ? -1 : 1);
    cf = mf + sign * of; cs = ms + sign * os;
  }
  const r0 = Math.hypot(f0 - cf, s0 - cs);
  if (r0 < 1e-6) return null;
  let a0 = Math.atan2(s0 - cs, f0 - cf);
  let a1 = Math.atan2(s1 - cs, f1 - cf);
  if (cw) { while (a1 >= a0) a1 -= 2 * Math.PI; } else { while (a1 <= a0) a1 += 2 * Math.PI; }
  const sweep = Math.abs(a1 - a0);
  const maxAng = 2 * Math.acos(Math.max(0, 1 - ARC_TOL / Math.max(r0, ARC_TOL)));
  let steps = Math.ceil(sweep / Math.max(maxAng, 1e-3));
  steps = Math.max(ARC_MIN_STEPS, Math.min(ARC_MAX_STEPS, steps));
  const pts = [];
  for (let k = 0; k <= steps; k++) {
    const fr = k / steps, a = a0 + (a1 - a0) * fr;
    const ff = cf + r0 * Math.cos(a), ss = cs + r0 * Math.sin(a), ww = w0 + (w1 - w0) * fr;
    if (plane === 18) pts.push([ss, ww, ff]);        // s->X, w->Y, f->Z
    else if (plane === 19) pts.push([ww, ff, ss]);   // w->X, f->Y, s->Z
    else pts.push([ff, ss, ww]);                     // f->X, s->Y, w->Z
  }
  return pts;
}

function parseAxes(line) {
  const o = { x: null, y: null, z: null, e: null, f: null, i: null, j: null, k: null, r: null };
  const re = /([XYZEFIJKR])(-?\d*\.?\d+)/gi;
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

// Upside-down N-sided pyramid (a stylised nozzle/toolhead): apex at the origin -
// the deposition point - with the N-gon base lifted above it. Interleaved
// position(3) + flat normal(3); (2*sides - 2) triangles -> sides=3 gives the
// classic 12-vertex 3-sided marker, byte-for-byte as before. The base ring sits at
// y = PYR_YB so the digit quad (multi-tool marker) can be placed coplanar with it.
const PYR_YB = 1.45, PYR_RB = 0.62;
function pyramidGeo(sides) {
  const n = Math.max(3, sides | 0), apex = [0, 0, 0], yb = PYR_YB, rb = PYR_RB, base = [];
  for (let k = 0; k < n; k++) { const a = Math.PI / 2 + k * 2 * Math.PI / n; base.push([Math.cos(a) * rb, yb, Math.sin(a) * rb]); }
  const tris = [];
  for (let k = 0; k < n; k++) tris.push([apex, base[k], base[(k + 1) % n]]);   // side faces
  // Base cap as a reversed triangle fan so its flat normal points up (+y), matching
  // the original 3-gon winding ([base0, base2, base1]).
  for (let k = 1; k < n - 1; k++) tris.push([base[0], base[k + 1], base[k]]);
  const out = [];
  for (const [A, B, C] of tris) {
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    let n2 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const L = Math.hypot(n2[0], n2[1], n2[2]) || 1; n2 = [n2[0] / L, n2[1] / L, n2[2] / L];
    for (const P of [A, B, C]) out.push(P[0], P[1], P[2], n2[0], n2[1], n2[2]);
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

// Default "home" camera orientation - the framing the "Reset view" button eases
// back to, and the angle every clip export starts from (see resetView / arm()).
// One source of truth so the interactive reset and the recorded clip can't drift.
const HOME_YAW = -0.78, HOME_PITCH = 0.6;

// ---------- WebGL viewer (instanced filament beads) ----------
// opts.antialias toggles hardware MSAA (set at context creation, so changing it
// rebuilds the viewer). The other anti-aliasing controls (supersampling, minimum
// line width, distant-bead flattening) are live state flags read each frame.
function buildViewer(data, opts = {}) {
  const wrap = el('div', { class: 'anr-stl-viewport' });
  const canvas = el('canvas', { class: 'anr-stl-canvas' });
  wrap.appendChild(canvas);
  // Wait label: a small monospace box that billboards over the toolhead while it dwells /
  // heats / pauses, saying what it is waiting for and the time remaining. A DOM overlay
  // (always faces the camera); positioned each frame in draw() and hidden otherwise.
  const pauseTag = el('div', { class: 'anr-gcode-wait' });
  pauseTag.style.cssText = 'position:absolute;display:none;left:0;top:0;pointer-events:none;transform:translate(-50%,-100%);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:1.35;white-space:nowrap;padding:2px 7px;border-radius:5px;background:rgba(10,12,16,0.82);color:#eef2ff;border:1px solid rgba(255,255,255,0.22);box-shadow:0 1px 6px rgba(0,0,0,0.4);z-index:6;';
  wrap.appendChild(pauseTag);
  const msaa = opts.antialias !== false;
  const glOpts = { preserveDrawingBuffer: true, antialias: msaa };
  const gl = canvas.getContext('webgl', glOpts) || canvas.getContext('experimental-webgl', glOpts);
  if (!gl) { wrap.appendChild(el('p', { class: 'anr-error' }, 'WebGL is not available in this browser.')); return { wrap, ok: false }; }
  const inst = gl.getExtension('ANGLE_instanced_arrays');

  // Normalise to a unit cube, remapping printer Z to viewer up (Y).
  const { min, max } = data.bbox;
  const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, cz = (min[2] + max[2]) / 2;
  const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const nrm = (px, py, pz) => [(px - cx) / span, (pz - cz) / span, -(py - cy) / span];   // -> [x, up, depth]; negate Y so the Z<->Y swap stays right-handed (a bare swap mirrors the model)
  // Robust framing. The raw bbox is fragile: a slicer's purge/intro line (or one stray
  // move to the origin) is a legitimate extrusion far from the part, so the bbox midpoint
  // drifts off the model and the bounding sphere balloons - leaving the actual part a dot
  // pushed to one side. So pivot on the median point (outlier-proof) and frame to a high
  // percentile of the distance from it (ignores the ~1% of outlier moves). The true max
  // is kept for the depth planes, so nothing the camera can see ever gets clipped.
  const { boundR, boundRMax, ctr } = (() => {
    const total = data.seg.length, segs = total / 10;
    if (!segs) return { boundR: 0.5, boundRMax: 0.5, ctr: [0, 0, 0] };
    const stride = Math.max(1, Math.floor(segs / 20000));   // cap the sample on huge files
    const xs = [], ys = [], zs = [];
    for (let p = 0, si = 0; p < total; p += 10, si++) {
      if (si % stride) continue;
      xs.push(data.seg[p], data.seg[p + 3]);
      ys.push(data.seg[p + 1], data.seg[p + 4]);
      zs.push(data.seg[p + 2], data.seg[p + 5]);
    }
    const med = (arr) => { arr.sort((a, b) => a - b); return arr[arr.length >> 1]; };
    const ctr = nrm(med(xs), med(ys), med(zs));             // normalised orbit centre
    let m2 = 0; const ds = [];
    for (let p = 0, si = 0; p < total; p += 10, si++) {
      const a = nrm(data.seg[p], data.seg[p + 1], data.seg[p + 2]);
      const b = nrm(data.seg[p + 3], data.seg[p + 4], data.seg[p + 5]);
      const dax = a[0] - ctr[0], day = a[1] - ctr[1], daz = a[2] - ctr[2];
      const dbx = b[0] - ctr[0], dby = b[1] - ctr[1], dbz = b[2] - ctr[2];
      const ra = dax * dax + day * day + daz * daz;
      const rb = dbx * dbx + dby * dby + dbz * dbz;
      if (ra > m2) m2 = ra; if (rb > m2) m2 = rb;
      if (si % stride === 0) ds.push(ra, rb);
    }
    ds.sort((x, y) => x - y);
    const p99 = ds.length ? ds[Math.floor((ds.length - 1) * 0.99)] : m2;
    return { boundR: Math.sqrt(p99) || 0.5, boundRMax: Math.sqrt(m2) || 0.5, ctr };
  })();
  const yMin = (min[2] - cz) / span, ySpan = ((max[2] - min[2]) / span) || 1e-3;
  const fMin = data.feedRange.min, fSpan = Math.max(1e-6, data.feedRange.max - data.feedRange.min);

  // Print-bed floor: a grid + printable-area outline at machine Z=0, built once in the
  // viewer's normalised space (machine Z=0 -> the viewer's horizontal plane) so the part
  // is seen sitting on its plate, in its real position. bedBoundR widens the depth frustum
  // in draw() so the plate (which can extend well past the part) doesn't clip.
  // Render the bed-info lines (printer / size / plate) to a 2D canvas, to be pasted onto
  // the plate as a texture so the box is genuinely part of the bed (lies flat, follows
  // the plate's perspective) rather than a screen overlay. Returns the canvas + its size.
  const makeBedLabelCanvas = (lines) => {
    const sc = 2, fs = 22 * sc, lh = 30 * sc, pad = 14 * sc;
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    const fontFor = (b) => `${b ? '600 ' : ''}${fs}px ui-monospace, Menlo, Consolas, monospace`;
    let wmax = 0;
    for (const ln of lines) { ctx.font = fontFor(ln.bold); wmax = Math.max(wmax, ctx.measureText(ln.text).width); }
    cv.width = Math.ceil(wmax + pad * 2); cv.height = Math.ceil(lines.length * lh + pad * 2);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = 'rgba(10,12,16,0.82)'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1 * sc; ctx.strokeRect(0.5 * sc, 0.5 * sc, cv.width - sc, cv.height - sc);
    ctx.textBaseline = 'top';
    let y = pad;
    for (const ln of lines) { ctx.font = fontFor(ln.bold); ctx.fillStyle = ln.dim ? 'rgba(238,242,255,0.8)' : '#eef2ff'; ctx.fillText(ln.text, pad, y); y += lh; }
    return cv;
  };

  let bedGrid = null, bedOutline = null, bedBoundR = 0, bedLabelCanvas = null, bedLabelQuad = null;
  if (data.bed) {
    const b = data.bed, grid = [], outline = [];
    const pushSeg = (arr, ax, ay, bx, by) => {
      const A = nrm(ax, ay, 0), B = nrm(bx, by, 0);
      arr.push(A[0], A[1], A[2], B[0], B[1], B[2]);
      for (const P of [A, B]) { const dd = Math.hypot(P[0] - ctr[0], P[1] - ctr[1], P[2] - ctr[2]); if (dd > bedBoundR) bedBoundR = dd; }
    };
    // "Nice" grid step (1/2/5 x 10^n) giving ~14 divisions across the larger bed axis.
    const niceStep = (t) => { const pw = Math.pow(10, Math.floor(Math.log10(t || 1))); const f = (t || 1) / pw; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pw; };
    const step = Math.max(1, niceStep(Math.max(b.w, b.d) / 14));
    for (let gx = Math.ceil(b.x0 / step) * step; gx <= b.x1 + 1e-6; gx += step) pushSeg(grid, gx, b.y0, gx, b.y1);
    for (let gy = Math.ceil(b.y0 / step) * step; gy <= b.y1 + 1e-6; gy += step) pushSeg(grid, b.x0, gy, b.x1, gy);
    const poly = (b.poly && b.poly.length >= 3) ? b.poly : [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
    for (let k = 0; k < poly.length; k++) { const p = poly[k], q = poly[(k + 1) % poly.length]; pushSeg(outline, p[0], p[1], q[0], q[1]); }
    bedGrid = new Float32Array(grid); bedOutline = new Float32Array(outline);

    // Info label as a textured quad lying flat in the front-right corner of the plate
    // (machine +X = reads right, +Y = reads up), lifted a hair above Z=0 so it sits over
    // the grid lines but under the first print layer.
    const bu = data.units || 'mm';
    const lines = [];
    if (data.printerModel) lines.push({ text: data.printerModel, bold: true });
    lines.push({ text: `${b.w.toFixed(0)} × ${b.d.toFixed(0)}${b.h ? ` × ${b.h.toFixed(0)}` : ''} ${bu}`, bold: false });
    if (b.type) lines.push({ text: b.type, dim: true });
    bedLabelCanvas = makeBedLabelCanvas(lines);
    const inset = Math.min(b.w, b.d) * 0.03;
    const tw = b.w * 0.34, th = tw * (bedLabelCanvas.height / bedLabelCanvas.width);
    const rx1 = b.x1 - inset, ry0 = b.y0 + inset, rx0 = rx1 - tw, ry1 = ry0 + th;
    const zl = bu === 'in' ? 0.004 : 0.1;   // tiny lift above the plate
    const v = (mx, my, uu, vv) => { const P = nrm(mx, my, zl); return [P[0], P[1], P[2], uu, vv]; };
    const A = v(rx0, ry1, 0, 0), B = v(rx1, ry1, 1, 0), C = v(rx1, ry0, 1, 1), D = v(rx0, ry0, 0, 1);
    bedLabelQuad = new Float32Array([...A, ...B, ...C, ...A, ...C, ...D]);
  }

  // Filament colour palette (flat vec3 array, max 8) for "colour by filament".
  const FIL_MAX = 8;
  const filCols = new Float32Array(FIL_MAX * 3);
  const hex2rgb = (h) => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || ''); return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [0.7, 0.72, 0.78]; };
  const palette = data.filamentColors || [];
  for (let k = 0; k < FIL_MAX; k++) { const c = hex2rgb(palette[k % Math.max(1, palette.length)]); filCols[k * 3] = c[0]; filCols[k * 3 + 1] = c[1]; filCols[k * 3 + 2] = c[2]; }

  // Per-instance buffer: A(3) B(3) halfW halfH feed type tool (11 floats / segment).
  const STR = 11;
  const segN = data.segCount;
  const instData = new Float32Array(segN * STR);
  let wHalfMin = Infinity, wHalfMax = 0;   // normalised half-width range, for "colour by width"
  let minHalfH = Infinity;                 // smallest positive bead half-height (normalised) -> layer height
  for (let s = 0; s < segN; s++) {
    const p = s * 10, q = s * STR;
    const a = nrm(data.seg[p], data.seg[p + 1], data.seg[p + 2]);
    const b = nrm(data.seg[p + 3], data.seg[p + 4], data.seg[p + 5]);
    instData[q] = a[0]; instData[q + 1] = a[1]; instData[q + 2] = a[2];
    instData[q + 3] = b[0]; instData[q + 4] = b[1]; instData[q + 5] = b[2];
    const hw = (data.seg[p + 6] * 0.5) / span;
    instData[q + 6] = hw;                               // half width (normalised)
    instData[q + 7] = (data.seg[p + 7] * 0.5) / span;   // half height
    instData[q + 8] = data.seg[p + 8];                  // feed
    instData[q + 9] = data.seg[p + 9];                  // feature type
    instData[q + 10] = data.segFil ? Math.min(FIL_MAX - 1, data.segFil[s] | 0) : 0;   // filament slot
    if (data.seg[p + 6] > 0) { if (hw < wHalfMin) wHalfMin = hw; if (hw > wHalfMax) wHalfMax = hw; }
    if (data.seg[p + 7] > 0) { const hh = instData[q + 7]; if (hh < minHalfH) minHalfH = hh; }
  }
  if (!(wHalfMin < wHalfMax)) { wHalfMin = 0; wHalfMax = 1e-3; }
  const wSpan = Math.max(1e-9, wHalfMax - wHalfMin);
  // One layer height in normalised world units (full bead height ~= layer spacing). Caps
  // the per-type depth nudge below so it can never push a bead a whole layer deep.
  const layerH = (minHalfH < Infinity ? minHalfH * 2 : 0.002) || 0.002;
  // Travel instances (thin), reusing the same layout.
  const travN = inst ? data.travelCount : 0;
  let travData = null;
  if (travN) {
    travData = new Float32Array(travN * STR);
    const thin = Math.max(0.04 / span, boundR * 0.0008);
    for (let s = 0; s < travN; s++) {
      const p = s * 7, q = s * STR;
      const a = nrm(data.travel[p], data.travel[p + 1], data.travel[p + 2]);
      const b = nrm(data.travel[p + 3], data.travel[p + 4], data.travel[p + 5]);
      travData[q] = a[0]; travData[q + 1] = a[1]; travData[q + 2] = a[2];
      travData[q + 3] = b[0]; travData[q + 4] = b[1]; travData[q + 5] = b[2];
      travData[q + 6] = thin; travData[q + 7] = thin; travData[q + 8] = data.travel[p + 6]; travData[q + 9] = 7; travData[q + 10] = 0;
    }
  }

  const vsInst = `attribute float aEnd, aSr, aSu; attribute vec3 aA, aB; attribute float aHW, aHH, aFeed, aType, aTool;
    uniform mat4 uMVP, uModel, uMV; uniform vec2 uViewport;
    uniform float uYmin, uYspan, uFmin, uFspan, uMode, uTravel, uMinW, uMinPx, uFlat, uVis[8], uFilVis[8], uWmin, uWspan, uTypeBias, uIsoUseType;
    uniform vec3 uFilCols[8];
    varying float vT, vVis, vTool; varying vec3 vN, vColor, vEyeN, vEyeP;
    vec3 filColor(float ft){ int t=int(ft+0.5);
      for(int k=0;k<8;k++){ if(k==t) return uFilCols[k]; } return uFilCols[0]; }
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
      // Eye-space normal + position for the "Realistic view" Phong path (fixed
      // camera-relative lights need lighting evaluated in eye space).
      vEyeN = mat3(uMV) * nrm;
      vEyeP = (uMV * vec4(P + off, 1.0)).xyz;
      gl_Position = uMVP*vec4(P + off, 1.0);
      // Anti z-fighting: push higher feature types fractionally back so overlapping
      // beads of different types stop flickering (outer wall stays in front). uTypeBias
      // is a constant clip-space z step (-proj[10] * worldStep), so after the perspective
      // divide it is a roughly constant WORLD-depth offset regardless of camera distance -
      // bounded well under a layer height, so it never reorders stacked layers. (Note: no
      // * gl_Position.w here - that older form gave a constant NDC offset that grew with
      // distance and let lower layers punch through upper ones when zoomed out.)
      gl_Position.z += aType * uTypeBias;
      // Height fraction from the segment CENTRELINE (not the offset bead vertex), so
      // the build-height clip reveals whole layers cleanly and 100% is the true top.
      vT = clamp((P.y - uYmin)/uYspan, 0.0, 1.0);
      // Tool identity for the "Dim other tools" isolate pass: CNC keeps it in aType,
      // FDM in aTool (the filament index). The fragment shader compares it to uIsoTool.
      vTool = uIsoUseType > 0.5 ? aType : aTool;
      float sfrac = clamp((aFeed - uFmin)/uFspan, 0.0, 1.0);
      float wfrac = clamp((aHW - uWmin)/uWspan, 0.0, 1.0);
      if(uTravel > 0.5){ vColor = vec3(0.22,0.28,0.61); vVis = 1.0; }   // OrcaSlicer travel blue (RGB 56,72,155)
      else {
        // 0 line type, 1 height, 2 speed, 3 filament, 4 width.
        if(uMode < 0.5) vColor = typeColor(aType);
        else if(uMode < 1.5) vColor = ramp(vT);
        else if(uMode < 2.5) vColor = ramp(sfrac);
        else if(uMode < 3.5) vColor = filColor(aTool);
        else vColor = ramp(wfrac);
        vVis = uVis[int(aType + 0.5)] * uFilVis[int(aTool + 0.5)];
      } }`;
  const fsInst = `precision mediump float; varying float vT, vVis, vTool; varying vec3 vN, vColor, vEyeN, vEyeP;
    uniform float uClip, uAlpha, uIsoMode, uIsoTool, uIsoTool2, uReal, uDim;
    void main(){ if(vT > uClip) discard; if(vVis < 0.5) discard;
      // Isolate pass: 1 = draw only uIsoTool, 2 = draw everything EXCEPT uIsoTool and
      // uIsoTool2 (the second exclusion lets a tool-change crossfade draw the outgoing
      // and incoming tools in their own ramped passes without them showing here too).
      if(uIsoMode > 0.5){ bool cur = abs(vTool - uIsoTool) < 0.5;
        if(uIsoMode < 1.5){ if(!cur) discard; }
        else { if(cur || abs(vTool - uIsoTool2) < 0.5) discard; } }
      if(uReal > 0.5){
        // Realistic view: OrcaSlicer-style two fixed (eye-space) lights, Blinn-Phong
        // with a glossy filament sheen so beads read as deposited plastic.
        vec3 N = normalize(vEyeN); vec3 V = normalize(-vEyeP);
        vec3 LT = vec3(-0.4574957,0.4574957,0.7624929), LF = vec3(0.6985074,0.1397015,0.6985074);
        float diff = 0.28 + max(dot(N,LT),0.0)*0.5 + max(dot(N,LF),0.0)*0.22;
        float spec = 0.30*pow(max(dot(N,normalize(LT+V)),0.0),28.0) + 0.10*pow(max(dot(N,normalize(LF+V)),0.0),16.0);
        gl_FragColor = vec4(clamp(vColor*diff + vec3(spec), 0.0, 1.0) * uDim, uAlpha);
      } else {
        vec3 N = normalize(vN); vec3 L = normalize(vec3(0.4,0.78,0.5));
        float lit = max(max(dot(N,L),0.0), max(dot(-N,L),0.0)*0.4);
        gl_FragColor = vec4(vColor*(0.34+0.66*lit) * uDim, uAlpha);
      } }`;
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

  // Print-bed renderer (a thin line program, shared by both draw paths). Draws the grid
  // dim and the printable-area outline brighter, alpha-blended, at machine Z=0.
  let drawBed = () => {};
  if (bedGrid) {
    const bedProg = makeProg(
      'attribute vec3 aPos; uniform mat4 uMVP; void main(){ gl_Position = uMVP*vec4(aPos,1.0); }',
      'precision mediump float; uniform vec4 uCol; void main(){ gl_FragColor = uCol; }');
    const aBedPos = gl.getAttribLocation(bedProg, 'aPos');
    const uBedMVP = gl.getUniformLocation(bedProg, 'uMVP'), uBedCol = gl.getUniformLocation(bedProg, 'uCol');
    const gBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, gBuf); gl.bufferData(gl.ARRAY_BUFFER, bedGrid, gl.STATIC_DRAW);
    const oBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, oBuf); gl.bufferData(gl.ARRAY_BUFFER, bedOutline, gl.STATIC_DRAW);

    // Info-label quad pasted flat onto the plate: a textured (printer/size/plate) panel.
    let drawBedLabel = () => {};
    if (bedLabelQuad && bedLabelCanvas) {
      const texProg = makeProg(
        'attribute vec3 aPos; attribute vec2 aUV; uniform mat4 uMVP; varying vec2 vUV; void main(){ vUV = aUV; gl_Position = uMVP*vec4(aPos,1.0); }',
        'precision mediump float; varying vec2 vUV; uniform sampler2D uTex; void main(){ vec4 c = texture2D(uTex, vUV); if(c.a < 0.01) discard; gl_FragColor = c; }');
      const aTPos = gl.getAttribLocation(texProg, 'aPos'), aTUV = gl.getAttribLocation(texProg, 'aUV');
      const uTMVP = gl.getUniformLocation(texProg, 'uMVP'), uTSamp = gl.getUniformLocation(texProg, 'uTex');
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bedLabelCanvas);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const qBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, qBuf); gl.bufferData(gl.ARRAY_BUFFER, bedLabelQuad, gl.STATIC_DRAW);
      drawBedLabel = (mvp) => {
        gl.useProgram(texProg);
        gl.uniformMatrix4fv(uTMVP, false, mvp);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(uTSamp, 0);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   // premultiplied
        gl.bindBuffer(gl.ARRAY_BUFFER, qBuf);
        gl.enableVertexAttribArray(aTPos); gl.vertexAttribPointer(aTPos, 3, gl.FLOAT, false, 20, 0); if (inst) inst.vertexAttribDivisorANGLE(aTPos, 0);
        gl.enableVertexAttribArray(aTUV); gl.vertexAttribPointer(aTUV, 2, gl.FLOAT, false, 20, 12); if (inst) inst.vertexAttribDivisorANGLE(aTUV, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.disable(gl.BLEND);
      };
    }

    drawBed = (mvp) => {
      if (!state.showBed) return;
      gl.useProgram(bedProg);
      gl.uniformMatrix4fv(uBedMVP, false, mvp);
      gl.enableVertexAttribArray(aBedPos);
      if (inst) inst.vertexAttribDivisorANGLE(aBedPos, 0);   // never inherit an instanced divisor
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindBuffer(gl.ARRAY_BUFFER, gBuf); gl.vertexAttribPointer(aBedPos, 3, gl.FLOAT, false, 0, 0);
      gl.uniform4f(uBedCol, 0.46, 0.52, 0.64, 0.5);
      gl.drawArrays(gl.LINES, 0, bedGrid.length / 3);
      gl.bindBuffer(gl.ARRAY_BUFFER, oBuf); gl.vertexAttribPointer(aBedPos, 3, gl.FLOAT, false, 0, 0);
      gl.uniform4f(uBedCol, 0.64, 0.72, 0.88, 0.92);
      gl.drawArrays(gl.LINES, 0, bedOutline.length / 3);
      gl.disable(gl.BLEND);
      drawBedLabel(mvp);   // the info panel rides on the plate
    };
  }

  // mode: 0 = feature type, 1 = height, 2 = speed. vis: per-feature-type 1/0.
  // shown: how many extrusion segments to draw (in print order) - the progress slider.
  const state = { yaw: -0.78, pitch: 0.6, dist: 2.6, panX: 0, panY: 0, spin: true, ortho: false, head: false, msaa, ssaa: true, minWidth: 'none', flatten: false, bg: [0, 0, 0], clip: 1, mode: (data.mode === 'print' && data.multicolour) ? 3 : (data.hasTypes || (data.cnc && data.cnc.toolColors.length > 1)) ? 0 : 1, showTravel: false, showBed: !!bedGrid, showLegend: false, vis: new Float32Array([1, 1, 1, 1, 1, 1, 1, 1]), filVis: new Float32Array([1, 1, 1, 1, 1, 1, 1, 1]), shown: segN, partial: 0, fitted: false,
    // Travel-aware playback: travShown = full travel segments to draw; playKind marks
    // whether the in-progress (partially drawn) move is an extrusion (1) or a travel (2),
    // so the head can glide along travels too; playFrac is the fraction into it.
    travShown: travN, playKind: 0, playFrac: 0, paused: false, translucentTravel: true,
    // Follow camera: 0 = off (free), 1 = height (vertical pivot tracks the toolhead's
    // build height, the rest free), 2 = toolhead (pivot locked to the toolhead, only
    // rotation/zoom free). headX/Y/Z carry the live tool point (in geometry space) that
    // draw() pivots on; updated each frame by the draw impl.
    // restX/Y/Z carry the head's resting tool point (RAW mm; drawImpl normalises) for when
    // it sits at a move boundary and isn't mid-glide - travel-aware, so it doesn't snap back
    // to the last *extrusion* endpoint when the tool actually rests at a travel endpoint.
    follow: 0, headX: 0, headY: 0, headZ: 0, headValid: false, headLive: false, headToolRank: 1, headToolNum: 0, headToolRaw: 0, toolMarkers: true, isoTool: false, isoAlpha: 0.22, real: false, restX: 0, restY: 0, restZ: 0, restValid: false, pauseText: '',
    // "Dim other tools" crossfade: when the head switches tools, the outgoing tool eases
    // from solid to translucent and the incoming one the other way, over ISO_FADE_S rather
    // than snapping. isoCurTool = tool now solid, isoFadeTool = the one fading out,
    // isoFadeT = 0..1 progress (1 = settled, no fade in flight).
    // isoNoFade suppresses the crossfade for the deterministic clip export (which drives
    // draw() directly, so isoFadeT would never advance and a fade would freeze mid-blend).
    // isoEndRelease: set when playback runs to completion - eases every dimmed tool back to
    // full (isoEndT 0->1) so the finished build shows normally; cleared on play/scrub.
    isoCurTool: null, isoFadeTool: null, isoFadeT: 1, isoNoFade: false, isoEndT: 0, isoEndRelease: false };
  let viewW = 600, viewH = 420;   // CSS px, for screen-space size in the shader
  let dirty = true;
  let disposed = false;
  const spinListeners = [];
  function setSpin(v) { if (state.spin === v) return; state.spin = v; dirty = true; for (const cb of spinListeners) cb(v); }

  // ----- instanced path -----
  let drawImpl, computeHead;
  if (inst && segN > 0) {
    const prog = makeProg(vsInst, fsInst); gl.useProgram(prog);
    const tpl = boxTemplate();
    const tplBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, tplBuf); gl.bufferData(gl.ARRAY_BUFFER, tpl, gl.STATIC_DRAW);
    const segBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, segBuf); gl.bufferData(gl.ARRAY_BUFFER, instData, gl.STATIC_DRAW);
    let travBuf = null;
    if (travData) { travBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, travBuf); gl.bufferData(gl.ARRAY_BUFFER, travData, gl.STATIC_DRAW); }
    // One-instance scratch buffers for the in-progress (partially drawn) move: while
    // playback animates a single move, its bead grows from the start point to the live
    // tool position instead of popping in whole when the move finishes. Updated per frame.
    const partBuf = gl.createBuffer();
    const partArr = new Float32Array(STR);
    let partTravBuf = null, partTravArr = null;
    if (travData) { partTravBuf = gl.createBuffer(); partTravArr = new Float32Array(STR); }

    // Last live tool point, kept across frames so the toolhead stays put (and visible)
    // while the machine is paused/dwelling/heating instead of vanishing. Seeded with the
    // first real move's start so the head is already parked there during a leading
    // heat-up wait (M109/M190), before any geometry has been drawn.
    let lastHX = 0, lastHY = 0, lastHZ = 0, haveLastHead = false;
    { const ord = data.order, G0 = data.orderCount;
      for (let g = 0; g < G0; g++) { const o = ord[g]; if (o > 1.5) continue;
        const src = o > 0.5 ? travData : instData;
        if (src) { lastHX = src[0]; lastHY = src[1]; lastHZ = src[2]; haveLastHead = true; } break; } }

    const L = (n) => gl.getAttribLocation(prog, n);
    const aEnd = L('aEnd'), aSr = L('aSr'), aSu = L('aSu'), aA = L('aA'), aB = L('aB'), aHW = L('aHW'), aHH = L('aHH'), aFeed = L('aFeed'), aType = L('aType'), aTool = L('aTool');
    const U = (n) => gl.getUniformLocation(prog, n);
    const uMVP = U('uMVP'), uModel = U('uModel'), uMV = U('uMV'), uReal = U('uReal'), uViewport = U('uViewport'), uYmin = U('uYmin'), uYspan = U('uYspan'), uFmin = U('uFmin'), uFspan = U('uFspan'), uClip = U('uClip'), uMode = U('uMode'), uTravel = U('uTravel'), uVis = U('uVis'), uFilVis = U('uFilVis'), uMinW = U('uMinW'), uMinPx = U('uMinPx'), uFlat = U('uFlat'), uAlpha = U('uAlpha'), uFilCols = U('uFilCols'), uWmin = U('uWmin'), uWspan = U('uWspan'), uTypeBias = U('uTypeBias'), uIsoMode = U('uIsoMode'), uIsoTool = U('uIsoTool'), uIsoTool2 = U('uIsoTool2'), uIsoUseType = U('uIsoUseType'), uDim = U('uDim');

    const bindTemplate = () => {
      gl.bindBuffer(gl.ARRAY_BUFFER, tplBuf);
      gl.enableVertexAttribArray(aEnd); gl.vertexAttribPointer(aEnd, 1, gl.FLOAT, false, 12, 0); inst.vertexAttribDivisorANGLE(aEnd, 0);
      gl.enableVertexAttribArray(aSr); gl.vertexAttribPointer(aSr, 1, gl.FLOAT, false, 12, 4); inst.vertexAttribDivisorANGLE(aSr, 0);
      gl.enableVertexAttribArray(aSu); gl.vertexAttribPointer(aSu, 1, gl.FLOAT, false, 12, 8); inst.vertexAttribDivisorANGLE(aSu, 0);
    };
    const bindInstances = (buf) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const S = 44;
      gl.enableVertexAttribArray(aA); gl.vertexAttribPointer(aA, 3, gl.FLOAT, false, S, 0); inst.vertexAttribDivisorANGLE(aA, 1);
      gl.enableVertexAttribArray(aB); gl.vertexAttribPointer(aB, 3, gl.FLOAT, false, S, 12); inst.vertexAttribDivisorANGLE(aB, 1);
      gl.enableVertexAttribArray(aHW); gl.vertexAttribPointer(aHW, 1, gl.FLOAT, false, S, 24); inst.vertexAttribDivisorANGLE(aHW, 1);
      gl.enableVertexAttribArray(aHH); gl.vertexAttribPointer(aHH, 1, gl.FLOAT, false, S, 28); inst.vertexAttribDivisorANGLE(aHH, 1);
      gl.enableVertexAttribArray(aFeed); gl.vertexAttribPointer(aFeed, 1, gl.FLOAT, false, S, 32); inst.vertexAttribDivisorANGLE(aFeed, 1);
      if (aType >= 0) { gl.enableVertexAttribArray(aType); gl.vertexAttribPointer(aType, 1, gl.FLOAT, false, S, 36); inst.vertexAttribDivisorANGLE(aType, 1); }
      if (aTool >= 0) { gl.enableVertexAttribArray(aTool); gl.vertexAttribPointer(aTool, 1, gl.FLOAT, false, S, 40); inst.vertexAttribDivisorANGLE(aTool, 1); }
    };
    // Toolhead marker: a small inverted pyramid sitting at the live print point,
    // shown while the print-progress animation plays. Single-tool prints get the
    // classic 3-sided yellow marker; multi-tool prints give each tool a distinct
    // marker - sides grow linearly with the tool's first-use order (1st -> 3 sides,
    // 2nd -> 4, ... capped at 9), the colour cycles through HEAD_PAL, and the raw
    // gcode tool number is textured onto the upward base face.
    const headProg = makeProg(
      `attribute vec3 aPos, aNrm; uniform mat4 uProj, uView, uModel; uniform vec3 uHead; uniform float uScale; varying vec3 vN;
       void main(){ vN = mat3(uModel)*aNrm; gl_Position = uProj*uView*uModel*vec4(uHead + aPos*uScale, 1.0); }`,
      `precision mediump float; varying vec3 vN; uniform vec3 uHeadColor;
       void main(){ vec3 N=normalize(vN); vec3 L=normalize(vec3(0.4,0.78,0.5));
         float lit=max(max(dot(N,L),0.0), max(dot(-N,L),0.0)*0.4);
         gl_FragColor = vec4(uHeadColor*(0.45+0.55*lit), 1.0); }`);
    // Tool colour cycle. [0] is the exact original yellow, so a single-tool print (and
    // every print's first tool) is pixel-identical to before.
    const HEAD_PAL = [[1.0, 0.92, 0.30], [0.20, 0.90, 0.95], [0.95, 0.32, 0.85], [0.95, 0.33, 0.33], [0.38, 0.85, 0.45], [0.42, 0.55, 0.97]];
    // One geometry per side-count 3..9 (index = sides-3); rank N (1-based first-use
    // order) uses min(N+2, 9) sides, so the 7th tool onward stops gaining sides.
    const headVariants = [];
    for (let s = 3; s <= 9; s++) { const geo = pyramidGeo(s); const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, geo, gl.STATIC_DRAW); headVariants.push({ buf: b, count: geo.length / 6 }); }
    const hPos = gl.getAttribLocation(headProg, 'aPos'), hNrm = gl.getAttribLocation(headProg, 'aNrm');
    const hU = (n) => gl.getUniformLocation(headProg, n);
    const uHProj = hU('uProj'), uHView = hU('uView'), uHModel = hU('uModel'), uHead = hU('uHead'), uHScale = hU('uScale'), uHColor = hU('uHeadColor');
    const headScale = Math.max(0.02, boundR * 0.06);

    // ---- Tool identity (multi-tool prints) -------------------------------------
    // CNC stores the tool's colour slot in aType (offset 9); FDM stores the filament
    // index in aTool (offset 10). Scan the (chronological) instance data once to rank
    // each distinct tool by first use, and map a raw value to the number to display.
    const isCNC = !!data.cnc;
    const toolOff = isCNC ? 9 : 10;
    const slotToNum = new Map();
    if (isCNC && data.cnc.toolColors) for (const tc of data.cnc.toolColors) slotToNum.set(tc.slot, tc.n);
    const rawToNum = (raw) => isCNC ? (slotToNum.has(raw) ? slotToNum.get(raw) : raw) : raw;
    const rankMap = new Map();
    for (let s = 0; s < segN; s++) { const raw = instData[s * STR + toolOff] | 0; if (!rankMap.has(raw)) rankMap.set(raw, rankMap.size + 1); }
    const multiTool = rankMap.size > 1;

    // ---- Digit textured onto the marker's top (base) face ----------------------
    // A small quad coplanar with the base, in the marker's local space (so it rides
    // uHead+aPos*uScale and rotates/tilts with the model - edge-on from the side,
    // legible from above). One cached texture per displayed number.
    const digitProg = makeProg(
      `attribute vec3 aPos; attribute vec2 aUV; uniform mat4 uProj, uView, uModel; uniform vec3 uHead; uniform float uScale; varying vec2 vUV;
       void main(){ vUV = aUV; gl_Position = uProj*uView*uModel*vec4(uHead + aPos*uScale, 1.0); }`,
      `precision mediump float; varying vec2 vUV; uniform sampler2D uTex;
       void main(){ vec4 c = texture2D(uTex, vUV); if (c.a < 0.02) discard; gl_FragColor = c; }`);
    const aDPos = gl.getAttribLocation(digitProg, 'aPos'), aDUV = gl.getAttribLocation(digitProg, 'aUV');
    const dU = (n) => gl.getUniformLocation(digitProg, n);
    const uDProj = dU('uProj'), uDView = dU('uView'), uDModel = dU('uModel'), uDHead = dU('uHead'), uDScale = dU('uScale'), uDSamp = dU('uTex');
    const dHe = PYR_RB * 0.82, dY = PYR_YB + 0.02;   // quad half-extent + tiny lift above the base cap
    const digitQuad = new Float32Array([
      -dHe, dY, -dHe, 1, 1,  dHe, dY, -dHe, 0, 1,  dHe, dY, dHe, 0, 0,
      -dHe, dY, -dHe, 1, 1,  dHe, dY, dHe, 0, 0,  -dHe, dY, dHe, 1, 0,
    ]);
    const digitBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, digitBuf); gl.bufferData(gl.ARRAY_BUFFER, digitQuad, gl.STATIC_DRAW);
    const digitCache = new Map();
    const digitTex = (num) => {
      let t = digitCache.get(num); if (t) return t;
      const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
      const c = cv.getContext('2d'); const str = String(num);
      c.clearRect(0, 0, 64, 64);
      c.font = 'bold ' + (str.length > 1 ? 34 : 46) + 'px ui-monospace, Menlo, Consolas, monospace';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineJoin = 'round'; c.lineWidth = 8; c.strokeStyle = 'rgba(18,20,26,0.95)'; c.strokeText(str, 32, 34);
      c.fillStyle = '#ffffff'; c.fillText(str, 32, 34);
      t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      digitCache.set(num, t); return t;
    };
    const drawDigit = (proj, view, model, hx, hy, hz, num) => {
      gl.useProgram(digitProg);
      gl.uniformMatrix4fv(uDProj, false, proj); gl.uniformMatrix4fv(uDView, false, view); gl.uniformMatrix4fv(uDModel, false, model);
      gl.uniform3f(uDHead, hx, hy, hz); gl.uniform1f(uDScale, headScale);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, digitTex(num)); gl.uniform1i(uDSamp, 0);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);   // premultiplied
      gl.bindBuffer(gl.ARRAY_BUFFER, digitBuf);
      gl.enableVertexAttribArray(aDPos); gl.vertexAttribPointer(aDPos, 3, gl.FLOAT, false, 20, 0); inst.vertexAttribDivisorANGLE(aDPos, 0);
      gl.enableVertexAttribArray(aDUV); gl.vertexAttribPointer(aDUV, 2, gl.FLOAT, false, 20, 12); inst.vertexAttribDivisorANGLE(aDUV, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.depthMask(true); gl.disable(gl.BLEND);
    };
    const drawHead = (proj, view, model, hx, hy, hz) => {
      const rank = Math.max(1, state.headToolRank | 0);
      const variant = headVariants[Math.min(rank - 1, headVariants.length - 1)];
      const col = HEAD_PAL[(rank - 1) % HEAD_PAL.length];
      gl.useProgram(headProg);
      gl.uniformMatrix4fv(uHProj, false, proj); gl.uniformMatrix4fv(uHView, false, view); gl.uniformMatrix4fv(uHModel, false, model);
      gl.uniform3f(uHead, hx, hy, hz); gl.uniform1f(uHScale, headScale);
      gl.uniform3f(uHColor, col[0], col[1], col[2]);
      gl.bindBuffer(gl.ARRAY_BUFFER, variant.buf);
      gl.enableVertexAttribArray(hPos); gl.vertexAttribPointer(hPos, 3, gl.FLOAT, false, 24, 0); inst.vertexAttribDivisorANGLE(hPos, 0);
      gl.enableVertexAttribArray(hNrm); gl.vertexAttribPointer(hNrm, 3, gl.FLOAT, false, 24, 12); inst.vertexAttribDivisorANGLE(hNrm, 0);
      gl.drawArrays(gl.TRIANGLES, 0, variant.count);
      if (multiTool && state.toolMarkers) drawDigit(proj, view, model, hx, hy, hz, state.headToolNum | 0);
    };
    // Resolve the live tool point and remember it across frames. Split out from
    // drawImpl so draw() can run it BEFORE building the orbit pivot: when the follow
    // camera centres on the toolhead it then uses *this* frame's point, pinning the
    // head to screen centre instead of trailing it by one frame. Publishes the point
    // (and a `headLive` flag) into state for both the pivot and drawImpl to read.
    computeHead = () => {
      const shown = Math.max(0, Math.min(segN, state.shown | 0));
      const frac = (state.partial > 0 && shown < segN) ? state.partial : 0;
      const travShown = Math.max(0, Math.min(travN, state.travShown | 0));
      let hx = 0, hy = 0, hz = 0, haveHead = false;
      if (state.paused && (state.restValid || haveLastHead)) {
        // Dwelling / waiting / heating: hold at the resting tool point. Prefer the travel-aware
        // rest point (applyGlobal) over the cached last-live point - the latter can be a stale
        // last-extrusion endpoint left by pre-play full-model frames, which would park the head
        // on the model during a leading dwell and then teleport it to the corner.
        if (state.restValid) { const r = nrm(state.restX, state.restY, state.restZ); hx = r[0]; hy = r[1]; hz = r[2]; }
        else { hx = lastHX; hy = lastHY; hz = lastHZ; }
        haveHead = true;
      } else if (state.playKind === 2 && travData && travShown < travN) {
        const q = travShown * STR, tf = state.playFrac;
        hx = travData[q] + tf * (travData[q + 3] - travData[q]);
        hy = travData[q + 1] + tf * (travData[q + 4] - travData[q + 1]);
        hz = travData[q + 2] + tf * (travData[q + 5] - travData[q + 2]);
        haveHead = true;
      } else if (frac > 0) {
        const q = shown * STR;
        hx = instData[q] + frac * (instData[q + 3] - instData[q]);
        hy = instData[q + 1] + frac * (instData[q + 4] - instData[q + 1]);
        hz = instData[q + 2] + frac * (instData[q + 5] - instData[q + 2]);
        haveHead = true;
      } else if (state.restValid) {
        // At rest between moves (frac 0): sit at the current move's start point - the true
        // tool position, whichever move type led here. (The old fallback below used the last
        // *extrusion* endpoint, which teleports the head back to the prime/last-bead corner
        // whenever the tool actually arrived via travels, e.g. the first move of every print.)
        const r = nrm(state.restX, state.restY, state.restZ);
        hx = r[0]; hy = r[1]; hz = r[2]; haveHead = true;
      } else if (shown > 0) {
        const q = (shown - 1) * STR;
        hx = instData[q + 3]; hy = instData[q + 4]; hz = instData[q + 5]; haveHead = true;
      }
      // Remember the live point (but not while paused - keep the pre-pause position).
      if (haveHead && !state.paused) { lastHX = hx; lastHY = hy; lastHZ = hz; haveLastHead = true; }
      if (haveHead) { state.headX = hx; state.headY = hy; state.headZ = hz; }
      else if (haveLastHead) { state.headX = lastHX; state.headY = lastHY; state.headZ = lastHZ; }
      state.headValid = haveHead || haveLastHead;
      state.headLive = haveHead;
      // Which tool is at the head. Read the tool of the move being drawn (mid-extrusion,
      // segIdx = shown) or, between moves, the one coming up next (shown points at the
      // not-yet-drawn segment). A tool change stamps the new tool onto that upcoming
      // segment, so the marker switches the instant the tool changes - through the
      // post-change travel and dwell - instead of waiting for the new tool to extrude.
      // Returning to an already-used tool shows its marker again. Single-tool prints stay
      // rank 1 (the classic yellow marker).
      // Gated on state.toolMarkers (the "Tool changes" toggle): when off, the head stays
      // the default rank-1 marker (classic 3-sided yellow, no number) for the whole job.
      if (multiTool) {
        const segIdx = Math.max(0, Math.min(shown, segN - 1));
        const raw = instData[segIdx * STR + toolOff] | 0;
        state.headToolRaw = raw;   // for the "Dim other tools" isolate pass (toggle-independent)
        // Arm a crossfade whenever the isolated tool changes: remember the tool we were
        // solid on as the one to fade out, and reset progress. Only while iso is on and
        // after the first tool is established (isoCurTool != null), so turning iso on or
        // the initial frame doesn't fade in from nothing.
        if (state.isoTool) {
          if (state.isoNoFade || state.isoCurTool == null) { state.isoCurTool = raw; state.isoFadeTool = null; state.isoFadeT = 1; }
          else if (raw !== state.isoCurTool) { state.isoFadeTool = state.isoCurTool; state.isoCurTool = raw; state.isoFadeT = 0; }
        }
        if (state.toolMarkers) { state.headToolRank = rankMap.get(raw) || 1; state.headToolNum = rawToNum(raw); }
        else { state.headToolRank = 1; state.headToolNum = 0; }
      } else { state.headToolRank = 1; state.headToolNum = 0; state.headToolRaw = 0; }
    };
    drawImpl = (proj, view, model) => {
      const mv = mat4Multiply(view, model);
      const mvp = mat4Multiply(proj, mv);
      drawBed(mvp);   // floor first, so the solid print draws crisply over it
      gl.useProgram(prog);
      gl.uniformMatrix4fv(uMVP, false, mvp); gl.uniformMatrix4fv(uModel, false, model);
      gl.uniformMatrix4fv(uMV, false, mv); gl.uniform1f(uReal, state.real ? 1 : 0);
      gl.uniform2f(uViewport, viewW, viewH);
      gl.uniform1f(uYmin, yMin); gl.uniform1f(uYspan, ySpan); gl.uniform1f(uFmin, fMin); gl.uniform1f(uFspan, fSpan); gl.uniform1f(uClip, state.clip);
      gl.uniform1f(uMinW, state.minWidth === 'all' ? 1 : 0); gl.uniform1f(uMinPx, 1.3); gl.uniform1f(uFlat, state.flatten ? 1 : 0);
      gl.uniform1f(uAlpha, 1); gl.uniform1f(uDim, 1);
      gl.uniform1f(uIsoUseType, isCNC ? 1 : 0); gl.uniform1f(uIsoMode, 0);
      gl.uniform1f(uIsoTool2, -1);   // no second exclusion unless a crossfade sets one
      gl.uniform1f(uWmin, wHalfMin); gl.uniform1f(uWspan, wSpan);
      if (uFilCols) gl.uniform3fv(uFilCols, filCols);
      if (uVis) gl.uniform1fv(uVis, state.vis);
      if (uFilVis) gl.uniform1fv(uFilVis, state.filVis);
      bindTemplate();
      const shown = Math.max(0, Math.min(segN, state.shown | 0));
      // Fraction into the move currently being drawn (only while playback animates).
      // Lets one long move grow smoothly toward the live tool point instead of
      // teleporting to the end when its full duration elapses. Manual scrubbing keeps
      // partial at 0, so the sliders only ever land on whole moves.
      const frac = (state.partial > 0 && shown < segN) ? state.partial : 0;

      const travShown = Math.max(0, Math.min(travN, state.travShown | 0));
      // Live tool point: resolved in computeHead(), which draw() always runs before
      // building the orbit pivot (so a followed head pins to screen centre this frame
      // instead of lagging it). Just read the point it published.
      const hx = state.headX, hy = state.headY, hz = state.headZ, haveHead = state.headLive;

      // Travel pass. Travels are revealed by explicit count from the unified playback
      // timeline (travShown). Opaque travels draw BEFORE the print so the solid print sits
      // crisply over them; translucent travels must draw AFTER the print (see below).
      const drawTravelPass = () => {
        gl.uniform1f(uTravel, 1); gl.uniform1f(uMode, 0); gl.uniform1f(uTypeBias, 0);   // travels are one type, no bias
        // Travels are hairline-thin, so the "Minimum line width" setting fattens them at
        // its 'travel' and 'all' stages (only 'none' leaves them sub-pixel) - otherwise long
        // rapids vanish into slivers when zoomed out.
        gl.uniform1f(uMinW, state.minWidth === 'none' ? 0 : 1);
        if (state.translucentTravel) {
          // Alpha-blend at 30%, depth-write off (don't carve into the depth buffer), but
          // leave the depth TEST on so travels behind the solid print are occluded by it.
          gl.uniform1f(uAlpha, 0.3);
          gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
        }
        bindInstances(travBuf); inst.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 24, travShown);
        // The in-progress travel (head currently gliding along it) grows toward the head.
        if (state.playKind === 2 && travShown < travN) {
          const q = travShown * STR, tf = state.playFrac;
          for (let i = 0; i < STR; i++) partTravArr[i] = travData[q + i];
          partTravArr[3] = travData[q] + tf * (travData[q + 3] - travData[q]);
          partTravArr[4] = travData[q + 1] + tf * (travData[q + 4] - travData[q + 1]);
          partTravArr[5] = travData[q + 2] + tf * (travData[q + 5] - travData[q + 2]);
          gl.bindBuffer(gl.ARRAY_BUFFER, partTravBuf); gl.bufferData(gl.ARRAY_BUFFER, partTravArr, gl.DYNAMIC_DRAW);
          bindInstances(partTravBuf); inst.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 24, 1);
        }
        if (state.translucentTravel) { gl.depthMask(true); gl.disable(gl.BLEND); gl.uniform1f(uAlpha, 1); }
      };
      const wantTravel = state.showTravel && travBuf;
      if (wantTravel && !state.translucentTravel) drawTravelPass();

      // Extrusion (solid print) pass. Per-type depth nudge as a constant world-space offset:
      // a clip-space z step of (-proj[10]) * worldStep divides through to a ~constant world
      // depth offset (see the shader note). worldStep is a small fraction of a layer height,
      // so the largest type's total nudge stays well under one layer and can never reorder
      // stacked layers - only break coplanar same-layer z-fighting.
      const worldStep = TYPE_BIAS_LAYER_FRAC * layerH;
      gl.uniform1f(uTravel, 0); gl.uniform1f(uMode, state.mode); gl.uniform1f(uTypeBias, -proj[10] * worldStep);
      gl.uniform1f(uMinW, state.minWidth === 'all' ? 1 : 0);   // extrusions only get min width at the 'all' stage
      // The in-progress (partially drawn) bead grows toward the live tool point; it always
      // belongs to the current tool, so it rides the opaque pass.
      const drawPartial = () => {
        if (frac <= 0) return;
        const q = shown * STR;
        for (let i = 0; i < STR; i++) partArr[i] = instData[q + i];
        partArr[3] = hx; partArr[4] = hy; partArr[5] = hz;   // bead ends at the live tool point
        gl.bindBuffer(gl.ARRAY_BUFFER, partBuf); gl.bufferData(gl.ARRAY_BUFFER, partArr, gl.DYNAMIC_DRAW);
        bindInstances(partBuf); inst.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 24, 1);
      };
      // "Dim other tools": draw the current tool's beads solid (pass 1), then every other
      // tool's beads TRANSLUCENT (pass 2) so you can see through them to the active tool.
      // Depth writes stay ON during the translucent pass, so per pixel only the nearest
      // faded layer shows instead of many stacking their alpha along the view ray - that
      // stacking is what made dense regions and the silhouette bloom into a glow. Result:
      // see-through, but without the bloom.
      if (state.isoTool && multiTool && state.isoEndT < 1) {
        // As the build completes, the dimmed tools ease back to full (isoEndT 0->1) so the
        // finished model reads normally; othersA is their live translucency. At isoEndT>=1
        // this branch is skipped entirely and everything draws solid (the else path).
        const endS = state.isoEndT > 0 ? state.isoEndT * state.isoEndT * (3 - 2 * state.isoEndT) : 0;
        const othersA = state.isoAlpha + (1 - state.isoAlpha) * endS;
        const fading = state.isoFadeT < 1 && state.isoFadeTool != null && state.isoFadeTool !== state.headToolRaw;
        if (fading) {
          // Tool-change crossfade. The tool just switched to snaps straight to solid (100%
          // opacity); only the OUTGOING tool eases down, smoothstepping from solid to
          // othersA over the fade. Every other tool holds at othersA throughout.
          const t = state.isoFadeT, s = t * t * (3 - 2 * t);
          const aOut = 1 - (1 - othersA) * s;       // outgoing: 1 -> othersA
          // Incoming (now-current) tool: opaque, drawn in the normal solid pass first.
          gl.uniform1f(uIsoTool, state.headToolRaw | 0);
          gl.uniform1f(uIsoMode, 1);
          bindInstances(segBuf); inst.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 24, shown);
          drawPartial();
          gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          // Everything except the two crossfading tools, held translucent.
          gl.uniform1f(uIsoMode, 2); gl.uniform1f(uIsoTool2, state.isoFadeTool | 0); gl.uniform1f(uAlpha, othersA);
          bindInstances(segBuf); inst.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 24, shown);
          // Outgoing tool easing from solid down to translucent.
          gl.uniform1f(uIsoMode, 1); gl.uniform1f(uIsoTool, state.isoFadeTool | 0); gl.uniform1f(uAlpha, aOut);
          bindInstances(segBuf); inst.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 24, shown);
          gl.disable(gl.BLEND); gl.uniform1f(uAlpha, 1); gl.uniform1f(uIsoTool2, -1);
        } else {
          gl.uniform1f(uIsoTool, state.headToolRaw | 0);
          gl.uniform1f(uIsoMode, 1);                                  // pass 1: current tool, full brightness, opaque
          bindInstances(segBuf); inst.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 24, shown);
          drawPartial();
          gl.uniform1f(uIsoMode, 2); gl.uniform1f(uAlpha, othersA);   // pass 2: other tools, translucent (depth writes stay on; othersA ramps to 1 for the end fade-back)
          gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          bindInstances(segBuf); inst.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 24, shown);
          gl.disable(gl.BLEND); gl.uniform1f(uAlpha, 1);
        }
        gl.uniform1f(uIsoMode, 0);
      } else {
        bindInstances(segBuf); inst.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 24, shown);
        drawPartial();
      }
      // Translucent travels draw AFTER the opaque print, depth-test on: the print no longer
      // overwrites them, travels behind it are correctly hidden, those in front blend over it.
      if (wantTravel && state.translucentTravel) drawTravelPass();
      if (state.head && haveHead) drawHead(proj, view, model, hx, hy, hz);
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
    const partLineBuf = gl.createBuffer();
    const partLine = new Float32Array(6);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    const U = (n) => gl.getUniformLocation(prog, n);
    const uProj = U('uProj'), uView = U('uView'), uModel = U('uModel'), uYmin = U('uYmin'), uYspan = U('uYspan'), uClip = U('uClip');
    drawImpl = (proj, view, model) => {
      drawBed(mat4Multiply(proj, mat4Multiply(view, model)));
      gl.useProgram(prog);
      gl.uniformMatrix4fv(uProj, false, proj); gl.uniformMatrix4fv(uView, false, view); gl.uniformMatrix4fv(uModel, false, model);
      gl.uniform1f(uYmin, yMin); gl.uniform1f(uYspan, ySpan); gl.uniform1f(uClip, state.clip);
      const shown = Math.max(0, Math.min(segN, state.shown | 0));
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.LINES, 0, shown * 2);
      // Grow the in-progress move's line toward the live tool point during playback.
      const frac = (state.partial > 0 && shown < segN) ? state.partial : 0;
      if (frac > 0) {
        const q = shown * 6;
        partLine[0] = linePos[q]; partLine[1] = linePos[q + 1]; partLine[2] = linePos[q + 2];
        partLine[3] = linePos[q] + frac * (linePos[q + 3] - linePos[q]);
        partLine[4] = linePos[q + 1] + frac * (linePos[q + 4] - linePos[q + 1]);
        partLine[5] = linePos[q + 2] + frac * (linePos[q + 5] - linePos[q + 2]);
        gl.bindBuffer(gl.ARRAY_BUFFER, partLineBuf); gl.bufferData(gl.ARRAY_BUFFER, partLine, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.LINES, 0, 2);
      }
    };
    drawImpl.hasTravel = false;
  }

  function resize() {
    if (exportW) { applyExportSize(); return; }   // clip export owns the canvas size
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
  // Clip export: lock the backing store to the clip resolution (draw() reads
  // canvas.width/height, so frames come out at the exact target aspect - and the
  // shader's screen-space effects read viewW/viewH, so they scale as if the video
  // were the screen) while the CSS size letterboxes the canvas inside the wrap,
  // keeping the render watchable as it happens. The GL render is oversampled up to
  // a 1440p ceiling and the exporter's compositing canvas downscales it, which
  // doubles as the clip's antialiasing. While an export size
  // is set, resize() (window resizes, fullscreen changes) re-applies it instead of
  // reverting to responsive sizing. Call with (0, 0) to restore normal sizing.
  let exportW = 0, exportH = 0;
  function applyExportSize() {
    // Oversample the GL render up to a 1440p ceiling (2560x1440 = 3.69 MP), then
    // let the exporter's compositing canvas downscale it - that downscale doubles
    // as the clip's antialiasing. So 720p renders at the full 2x (landing on
    // 1440p) and 1080p at ~1.33x (also landing on 1440p); the cap stays at 2
    // because the single drawImage downscale only samples a 2x2 neighbourhood in
    // some browsers - beyond 2x it would skip pixels, not average them.
    const ss = Math.max(1, Math.min(2, Math.sqrt(3.69e6 / (exportW * exportH))));
    viewW = exportW; viewH = exportH;
    canvas.width = Math.round(exportW * ss); canvas.height = Math.round(exportH * ss);
    const cw = wrap.clientWidth || 600, ch = wrap.clientHeight || 420;
    const k = Math.min(cw / exportW, ch / exportH);
    const dw = Math.max(1, Math.round(exportW * k)), dh = Math.max(1, Math.round(exportH * k));
    canvas.style.width = dw + 'px'; canvas.style.height = dh + 'px';
    canvas.style.margin = Math.max(0, Math.round((ch - dh) / 2)) + 'px auto 0';
    dirty = true;
  }
  function setExportSize(w, h) {
    exportW = w || 0; exportH = h || 0;
    if (exportW) applyExportSize();
    else { canvas.style.margin = ''; resize(); }
  }
  function draw() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(state.bg[0], state.bg[1], state.bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const aspect = canvas.width / canvas.height || 1;
    // Fit the depth range tightly around the model each frame. The geometry is a
    // bounding sphere of radius `boundR` centred at the origin, viewed from `dist`
    // away, so it spans depths [dist - r, dist + r]. The old fixed 0.005..1000 range
    // (a 200000:1 near/far ratio) starved the depth buffer of precision over the part
    // and caused heavy z-fighting between stacked/adjacent beads; bracketing it makes
    // far/near small, so the precision lands where the geometry actually is.
    // Resolve this frame's live tool point up front, so the pivot below locks onto
    // exactly where the head marker will be drawn (no one-frame lag = the followed
    // head sits pinned to screen centre).
    if (computeHead) computeHead();
    // Orbit pivot. Normally the robust median centre (ctr); with the follow camera on
    // (toolhead), the tool point drives it and is centred (pan disabled).
    let pvx = ctr[0], pvy = ctr[1], pvz = ctr[2];
    if (state.follow && state.headValid) { pvx = state.headX; pvy = state.headY; pvz = state.headZ; }
    const lockPan = !!state.follow;
    const panX = lockPan ? 0 : state.panX, panY = lockPan ? 0 : state.panY;
    // Depth range: bracket the bounding sphere, widened by how far the pivot sits from
    // ctr so an off-centre (followed) pivot doesn't clip the far side of the model.
    const pvDisp = Math.hypot(pvx - ctr[0], pvy - ctr[1], pvz - ctr[2]);
    let r = boundRMax * 1.08 + 0.02 + pvDisp;   // true extent (+ head marker / fattened beads) so nothing clips
    // The plate can extend well past the part; widen the frustum to keep it from clipping
    // when shown (capped at 4x the part extent so a huge bed under a tiny part doesn't wreck
    // depth precision - beyond that the plate's far corners simply clip).
    if (state.showBed && bedGrid) r = Math.max(r, Math.min(bedBoundR + 0.05 + pvDisp, (boundRMax * 1.08 + 0.02) * 4));
    const near = Math.max(0.01, state.dist - r);
    const far = state.dist + r + 0.02;
    let proj;
    if (state.ortho) { const hh = state.dist * 0.4142; proj = mat4Ortho(-hh * aspect, hh * aspect, -hh, hh, near, far); }
    else proj = mat4Perspective(45 * Math.PI / 180, aspect, near, far);
    const view = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, panX, panY, -state.dist, 1]);
    // Recentre the part under the orbit pivot, then rotate - so spin/orbit turn about
    // the pivot, not the outlier-skewed bbox midpoint.
    const rot = mat4Multiply(mat4RotX(state.pitch), mat4RotY(state.yaw));
    const model = mat4Multiply(rot, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -pvx, -pvy, -pvz, 1]));
    drawImpl(proj, view, model);
    positionWaitTag(proj, view, model);
  }
  // Billboard the wait label over the toolhead tip while it dwells / heats / pauses.
  // Projects the live tool point to screen space (so a DOM box always faces the camera)
  // and parks it just above the tip; hidden whenever the head isn't holding.
  function positionWaitTag(proj, view, model) {
    if (!(state.head && state.paused && state.pauseText && state.headValid)) { pauseTag.style.display = 'none'; return; }
    const m = mat4Multiply(proj, mat4Multiply(view, model));
    const x = state.headX, y = state.headY, z = state.headZ;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 1e-4) { pauseTag.style.display = 'none'; return; }   // behind the camera
    const sx = (cx / cw * 0.5 + 0.5) * viewW;
    const sy = (1 - (cy / cw * 0.5 + 0.5)) * viewH;
    if (pauseTag.textContent !== state.pauseText) pauseTag.textContent = state.pauseText;
    pauseTag.style.left = sx + 'px';
    pauseTag.style.top = (sy - 14) + 'px';   // a touch above the tip, clear of the marker
    pauseTag.style.display = '';
  }
  let isoFadeLast = 0;   // wall-clock stamp for advancing the tool-change crossfade
  const ISO_FADE_S = 0.5;  // "Dim other tools" tool-change crossfade duration
  function loop(now) {
    if (disposed) return;
    // Free the WebGL context once the card leaves the DOM (new file / SPA nav)
    // rather than leaving it live against the browser's ~16-context cap, which
    // would blank later viewers.
    if (!wrap.isConnected) { dispose(); return; }
    if (state.spin) { state.yaw += 0.003; dirty = true; }
    // Advance the "Dim other tools" fades by real elapsed time so their speed is
    // frame-rate independent and continues even when playback itself is paused.
    const dt = isoFadeLast ? (now - isoFadeLast) / 1000 : 0;
    if (state.isoFadeT < 1) { state.isoFadeT = Math.min(1, state.isoFadeT + dt / ISO_FADE_S); dirty = true; }
    // End-of-build fade-back: ease dimmed tools to full when playback completes, snap
    // back to 0 the moment a scrub / replay re-arms the isolate.
    if (state.isoEndRelease) { if (state.isoEndT < 1) { state.isoEndT = Math.min(1, state.isoEndT + dt / ISO_FADE_S); dirty = true; } }
    else if (state.isoEndT !== 0) { state.isoEndT = 0; dirty = true; }
    isoFadeLast = now || 0;
    if (dirty) { draw(); dirty = false; }
    requestAnimationFrame(loop);
  }

  // Tear down the viewer: stop the loop, detach window listeners, drop the GL
  // context. Idempotent; called on MSAA rebuild and on DOM removal (loop()).
  function dispose() {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('mousemove', onWinMove);
    window.removeEventListener('mouseup', up);
    try { const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); } catch (_) { /* ignore */ }
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
  // Named so dispose() can detach them (they live on window, past the canvas).
  const onWinMove = (e) => move(e.clientX, e.clientY);
  window.addEventListener('mousemove', onWinMove);
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
  // Shared zoom step for the wheel and the manual +/- pad. Zooming = changing the
  // camera distance; factor < 1 moves in, > 1 moves out (clamped to the orbit range).
  function zoomBy(factor) { state.dist = Math.max(0.04, Math.min(150, state.dist * factor)); dirty = true; }

  // Scroll-zoom toggle: styled and placed like the fullscreen button (they share the
  // bottom-right stack below), OFF by default so the wheel scrolls the page until the
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
  paintWheel();
  canvas.addEventListener('wheel', (e) => { if (!wheelOn) return; e.preventDefault(); zoomBy(1 + Math.sign(e.deltaY) * 0.1); }, { passive: false });

  // Camera distance that frames the model's bounding sphere. `fill` < 1 leaves
  // padding (e.g. 0.9 -> the sphere spans ~90% of the frame); accounts for the
  // narrower of the horizontal/vertical FOV so it fits in portrait or landscape.
  function fitDist(fill) {
    const aspect = (canvas.width / canvas.height) || 1;
    const halfFovV = (45 * Math.PI / 180) / 2;
    const halfFov = Math.min(halfFovV, Math.atan(Math.tan(halfFovV) * aspect));
    const theta = Math.atan(fill * Math.tan(halfFov));
    return boundR / Math.sin(theta);
  }

  function snapshot() {
    const saved = { yaw: state.yaw, pitch: state.pitch, dist: state.dist, spin: state.spin, ortho: state.ortho, clip: state.clip, panX: state.panX, panY: state.panY, follow: state.follow };
    state.spin = false; state.ortho = false; state.clip = 1; state.panX = 0; state.panY = 0; state.follow = 0;
    state.yaw = Math.PI / 4; state.pitch = Math.atan(1 / Math.SQRT2);
    state.dist = fitDist(0.96);
    draw();
    let url = null; try { url = canvas.toDataURL('image/png'); } catch (_) { url = null; }
    Object.assign(state, saved); dirty = true; return url;
  }
  canvas._anrSnapshot = snapshot;

  wrap.addEventListener('fullscreenchange', () => setTimeout(resize, 50));

  // Fullscreen toggle anchored in the viewport's bottom-right corner (the view cube
  // lives bottom-left). Built into the viewer itself so it persists across the MSAA
  // rebuild and always sits over the canvas.
  const fsBtn = el('button', { type: 'button', class: 'anr-btn anr-cam-fsbtn', title: 'Toggle fullscreen', 'aria-label': 'Toggle fullscreen' }, 'Fullscreen');
  fsBtn.addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else if (wrap.requestFullscreen) wrap.requestFullscreen(); });
  wrap.addEventListener('fullscreenchange', () => { fsBtn.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen'; });

  // Manual zoom pad (+ over -): a press-and-hold repeats the zoom step on a timer, so
  // you can ride the camera in or out without spamming clicks. Pointer capture keeps
  // it zooming even if the finger/cursor drifts off the button mid-hold.
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

  // Bottom-right camera stack (the view cube sits bottom-left): zoom pad on top,
  // then the scroll-zoom toggle, then fullscreen anchored at the corner.
  wrap.appendChild(el('div', { class: 'anr-cam' }, [zoomPad, wheelZoomBtn, fsBtn]));

  // Colour panel, top-right: a colour-mode selector with the legend / key for the
  // active mode directly beneath it. Built into the viewer so it survives the MSAA
  // rebuild and shows in fullscreen. Modes: 0 line type / tool, 1 height, 2 speed,
  // 3 filament (multicolour), 4 width.
  const lu = data.units;
  const cncToolCols = (data.cnc && data.cnc.toolColors) ? data.cnc.toolColors : [];
  const isPrintV = data.mode === 'print';
  const colourSel = el('select', { class: 'anr-btn anr-select anr-gcode-colsel', 'aria-label': 'Colour by', title: 'Colour by' });
  if (data.hasTypes) colourSel.appendChild(el('option', { value: '0' }, 'Colour: line type'));
  else if (cncToolCols.length > 1) colourSel.appendChild(el('option', { value: '0' }, 'Colour: tool'));
  colourSel.appendChild(el('option', { value: '1' }, 'Colour: height'));
  colourSel.appendChild(el('option', { value: '2' }, 'Colour: speed'));
  if (isPrintV) colourSel.appendChild(el('option', { value: '4' }, 'Colour: width'));
  if (isPrintV && data.multicolour) colourSel.appendChild(el('option', { value: '3' }, 'Colour: filament'));
  colourSel.value = String(state.mode);
  colourSel.addEventListener('change', () => { state.mode = +colourSel.value; refreshLegend(); dirty = true; });
  const legendBody = el('div', { class: 'anr-gcode-legendbody' });
  // Small show/hide toggle for the legend, sitting under the colour select. Off by
  // default so the canvas starts clean; state.showLegend persists across MSAA rebuilds.
  const legendToggle = el('button', { type: 'button', class: 'anr-btn anr-gcode-legendtoggle', 'aria-pressed': 'false' }, 'Show legend');
  const syncLegendVis = () => {
    const on = !!state.showLegend;
    legendBody.classList.toggle('is-hidden', !on);
    legendToggle.textContent = on ? 'Hide legend' : 'Show legend';
    legendToggle.classList.toggle('is-on', on);
    legendToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  legendToggle.addEventListener('click', () => { state.showLegend = !state.showLegend; syncLegendVis(); });
  const colourPanel = el('div', { class: 'anr-gcode-colpanel' }, [colourSel, legendToggle, legendBody]);
  wrap.appendChild(colourPanel);
  // Top-left overlay slot (renderGcode parks the Quality popup here).
  const topLeftSlot = el('div', { class: 'anr-gcode-topleft' });
  wrap.appendChild(topLeftSlot);

  // Build the legend body for the current colour mode: a blue->red ramp (height /
  // speed / width) labelled with its min and max, or a swatch key (line type / tool /
  // filament). Speed is shown in mm/s (feedrate is mm/min, so /60).
  const swatchRgb = (rgb) => `rgb(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)})`;
  const rampEl = (title, maxTxt, minTxt) => el('div', { class: 'anr-gcode-ramp' }, [
    el('div', { class: 'anr-gcode-ramp-title' }, title),
    el('div', { class: 'anr-gcode-ramp-body' }, [
      el('div', { class: 'anr-gcode-ramp-bar' }),
      el('div', { class: 'anr-gcode-ramp-scale' }, [el('span', {}, maxTxt), el('span', {}, minTxt)]),
    ]),
  ]);
  const keyRow = (bg, label) => el('div', { class: 'anr-gcode-key-row' }, [
    el('span', { class: 'anr-gcode-swatch' }, []), el('span', { class: 'anr-gcode-key-label' }, label),
  ]);
  const setSwatch = (rowEl, bg) => { rowEl.firstChild.style.background = bg; return rowEl; };
  const refreshLegend = () => {
    colourSel.value = String(state.mode);
    legendBody.innerHTML = '';
    const m = state.mode;
    if (m === 1) {
      legendBody.appendChild(rampEl('Height', data.bbox.max[2].toFixed(1) + ' ' + lu, data.bbox.min[2].toFixed(1) + ' ' + lu));
    } else if (m === 2) {
      const us = lu === 'mm' ? 'mm/s' : lu + '/s';
      legendBody.appendChild(rampEl('Speed', Math.round(data.feedRange.max / 60).toLocaleString() + ' ' + us, Math.round(data.feedRange.min / 60).toLocaleString() + ' ' + us));
    } else if (m === 4) {
      const wMax = wHalfMax * 2 * span, wMin = wHalfMin * 2 * span;
      legendBody.appendChild(rampEl('Width', wMax.toFixed(2) + ' ' + lu, wMin.toFixed(2) + ' ' + lu));
    } else if (m === 3) {
      const fils = (data.filsUsed && data.filsUsed.length) ? data.filsUsed : [0];
      for (const fi of fils) {
        const hex = (data.filamentColors && data.filamentColors[fi]) || '#cccccc';
        const row = keyRow(); setSwatch(row, hex); row.lastChild.textContent = 'Filament ' + (fi + 1); legendBody.appendChild(row);
      }
    } else if (data.hasTypes && data.features.length) {
      for (const id of data.features) { const f = FEATURES[id]; const row = keyRow(); setSwatch(row, swatchRgb(f.rgb)); row.lastChild.textContent = f.label; legendBody.appendChild(row); }
    } else if (cncToolCols.length > 1) {
      for (const t of cncToolCols) { const f = FEATURES[t.slot]; const row = keyRow(); setSwatch(row, swatchRgb(f.rgb)); row.lastChild.textContent = 'T' + t.n; legendBody.appendChild(row); }
    }
    syncLegendVis();   // keep the show/hide state + button label in sync (incl. after MSAA rebuilds)
  };
  refreshLegend();

  // Animate the camera back to the default framing (mirrors the 3D model viewer's Reset
  // view): yaw, pitch, zoom distance and pan eased together over 320ms, shortest way
  // round on yaw, with spin paused so it doesn't fight the tween.
  let resetAnim = 0;
  function resetView() {
    setSpin(false);
    const from = { yaw: state.yaw, pitch: state.pitch, dist: state.dist, panX: state.panX, panY: state.panY };
    const to = { yaw: HOME_YAW, pitch: HOME_PITCH, dist: fitDist(0.9), panX: 0, panY: 0 };
    state.fitted = true;
    let dyaw = to.yaw - from.yaw;
    while (dyaw > Math.PI) dyaw -= 2 * Math.PI;
    while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
    const dur = 320; let t0 = 0;
    if (resetAnim) cancelAnimationFrame(resetAnim);
    const tick = (ts) => {
      if (!t0) t0 = ts;
      const k = Math.min(1, (ts - t0) / dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;   // ease-in-out, matching the view-cube
      state.yaw = from.yaw + dyaw * e;
      state.pitch = from.pitch + (to.pitch - from.pitch) * e;
      state.dist = from.dist + (to.dist - from.dist) * e;
      state.panX = from.panX + (to.panX - from.panX) * e;
      state.panY = from.panY + (to.panY - from.panY) * e;
      dirty = true;
      resetAnim = k < 1 ? requestAnimationFrame(tick) : 0;
    };
    resetAnim = requestAnimationFrame(tick);
  }

  const api = {
    wrap, ok: true, state, hasTravel: !!drawImpl.hasTravel, instanced: !!(inst && segN > 0), snapshot, refreshLegend, colourPanel, topLeft: topLeftSlot,
    // Clip-export hooks: a synchronous draw, the live canvas (rebuilt on the MSAA
    // swap, so exporters must re-read it) and the export-resolution lock. Framing
    // at the export aspect goes through fit(), which reads the locked canvas size.
    draw, canvas, setExportSize, dispose,
    resize, setSpin, onSpinChange: (cb) => spinListeners.push(cb), resetView,
    start: () => { resize(); if (!state.fitted) { state.dist = fitDist(0.9); state.fitted = true; } requestAnimationFrame(loop); }, markDirty: () => { dirty = true; },
    fit: (fill) => { state.dist = fitDist(fill === undefined ? 0.9 : fill); state.fitted = true; dirty = true; },
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

export async function renderGcode(file, resultsEl, opts) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reconstructing the print from "${file.name}"…`));

  // The whole file is read into a JS string and parsed synchronously on the main
  // thread; an adversarial multi-GB text would exhaust memory / freeze the tab
  // before the segment cap ever applies. Decline above a generous ceiling.
  const MAX_GCODE_BYTES = 600_000_000;
  if (file.size > MAX_GCODE_BYTES) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('This G-code file is ' + fmtBytes(file.size) + ' - too large to reconstruct in the browser. The file was not opened.'));
    return;
  }

  let text;
  try { text = await file.text(); }
  catch (e) { resultsEl.innerHTML = ''; resultsEl.appendChild(errorCard('Could not read file: ' + (e && e.message))); return; }

  await new Promise((r) => setTimeout(r, 0));
  let data;
  try { data = parseGcode(text, opts); } catch (e) { data = null; }

  resultsEl.innerHTML = '';
  if (!data || !data.sawG) { resultsEl.appendChild(errorCard('This file does not look like G-code (no G0/G1/G2/G3 moves found).')); return; }

  const isPrint = data.mode === 'print';
  const u = data.units;
  const titleCase = (s) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
  const cncTools = (data.cnc && data.cnc.toolColors) ? data.cnc.toolColors : [];
  const toolLabel = (n) => { const d = data.cnc && data.cnc.tools.find((t) => t.n === n); return 'T' + n + (d && d.desc ? ' - ' + titleCase(d.desc) : ''); };

  if (data.segCount > 0) {
    // "Show full anyway" lifts the segment cap, so the geometry can be many millions of
    // beads. Start with the heavy quality settings (MSAA, supersampling, min line width,
    // translucent travel) turned OFF so the uncapped render stays viewable instead of
    // choking on antialiasing passes - but leave the buttons enabled so they can be
    // switched back on deliberately.
    const uncapped = !!(opts && opts.uncapped);
    const viewCard = el('div', { class: 'anr-card' });
    viewCard.appendChild(el('h3', {}, isPrint ? 'Reconstructed print' : 'Toolpath'));
    let viewer = buildViewer(data, { antialias: !uncapped });
    if (uncapped) { viewer.state.ssaa = false; viewer.state.minWidth = 'none'; viewer.state.translucentTravel = false; }
    if (isPrint) viewCard.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 10px;' }, viewer.instanced
      ? 'Rebuilt from the G-code as solid deposited filament - each extrusion drawn at its real width and height, coloured by layer. Travel moves are hidden.'
      : 'Rebuilt from the G-code toolpath, coloured by layer height (your browser lacks instanced rendering, so beads are shown as centrelines).'));
    viewCard.appendChild(viewer.wrap);

    if (viewer.ok) {
      // A caption under the canvas explains how to drive the view; every button and
      // slider then lives in one toolbar below it, grouped by job (display controls,
      // what is shown, then the two sliders) so the section reads as a single panel.
      viewCard.appendChild(el('p', { class: 'anr-gcode-orbithint' }, 'Drag to orbit · right-drag to pan · scroll to zoom'));
      const toolbar = el('div', { class: 'anr-gcode-toolbar' });
      const viewRow = el('div', { class: 'anr-btn-row anr-gcode-toolrow anr-gcode-viewrow' });
      const spinBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Pause spin');
      spinBtn.addEventListener('click', () => viewer.setSpin(!viewer.state.spin));
      const updateSpinLabel = (s) => { spinBtn.textContent = s ? 'Pause spin' : 'Resume spin'; };
      viewer.onSpinChange(updateSpinLabel);

      // Toggling hardware MSAA needs a fresh WebGL context, so rebuild the viewer on
      // a new canvas, carrying the camera and display state across. Every control
      // references `viewer` by binding, so they keep working after the swap.
      function applyMSAA(on) {
        const s = viewer.state;
        const keep = { yaw: s.yaw, pitch: s.pitch, dist: s.dist, panX: s.panX, panY: s.panY, spin: s.spin, ortho: s.ortho, head: s.head, clip: s.clip, mode: s.mode, showTravel: s.showTravel, showBed: s.showBed, showLegend: s.showLegend, vis: s.vis, filVis: s.filVis, shown: s.shown, partial: s.partial, ssaa: s.ssaa, minWidth: s.minWidth, flatten: s.flatten, fitted: s.fitted, travShown: s.travShown, playKind: s.playKind, playFrac: s.playFrac, paused: s.paused, translucentTravel: s.translucentTravel, follow: s.follow, toolMarkers: s.toolMarkers, isoTool: s.isoTool, real: s.real };
        const old = viewer;
        const next = buildViewer(data, { antialias: on });
        if (!next.ok) return;                         // keep the working viewer if rebuild fails
        viewer = next;
        Object.assign(viewer.state, keep, { msaa: on });
        old.wrap.replaceWith(viewer.wrap);
        old.dispose();                                // free the old GL context + its listeners
        viewer.onSpinChange(updateSpinLabel);
        if (viewer.topLeft) viewer.topLeft.appendChild(qWrap);   // re-park Quality in the rebuilt overlay
        viewer.start();
        viewer.refreshLegend();   // legend reflects the carried-over colour mode, not the build default
        viewer.markDirty();
      }

      const resetBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Reset view');
      resetBtn.addEventListener('click', () => viewer.resetView());
      const projBtn = el('button', { type: 'button', class: 'anr-btn' }, viewer.state.ortho ? 'Orthographic' : 'Perspective');
      projBtn.addEventListener('click', () => { viewer.state.ortho = !viewer.state.ortho; projBtn.textContent = viewer.state.ortho ? 'Orthographic' : 'Perspective'; viewer.markDirty(); });
      // Anti-aliasing / quality popup: hardware MSAA, supersampling, minimum line
      // width and distant-bead flattening, each toggled independently.
      const qWrap = el('span', { class: 'anr-aa-wrap' });
      const qBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Quality');
      const qPanel = el('div', { class: 'anr-aa-panel is-hidden' });
      qPanel.appendChild(el('div', { class: 'anr-aa-title' }, 'Quality'));
      // Each setting is a site-style button whose border lights red (.is-on) when active,
      // grey when off - no descriptions, just the toggle. The label carries the state.
      const aaBtn = (label, get, set) => {
        const btn = el('button', { type: 'button', class: 'anr-btn anr-aa-btn' }, label);
        const sync = () => btn.classList.toggle('is-on', !!get());
        sync();
        btn.addEventListener('click', () => { set(!get()); sync(); });
        qPanel.appendChild(btn);
        return btn;
      };
      // Multi-stage button: cycles through its choices on each click (off = the first
      // choice). Label shows the current stage; border lights red whenever it is not off.
      const aaCycleBtn = (label, choices, get, set) => {
        const btn = el('button', { type: 'button', class: 'anr-btn anr-aa-btn' });
        const sync = () => { const c = choices.find((o) => o.v === get()) || choices[0]; btn.textContent = label + ': ' + c.label; btn.classList.toggle('is-on', get() !== choices[0].v); };
        sync();
        btn.addEventListener('click', () => { const i = choices.findIndex((o) => o.v === get()); set(choices[(i + 1) % choices.length].v); sync(); });
        qPanel.appendChild(btn);
        return btn;
      };
      // aaBtn('Realistic view', () => viewer.state.real, (v) => { viewer.state.real = v; viewer.markDirty(); });
      aaBtn('Hardware MSAA', () => viewer.state.msaa, (v) => applyMSAA(v));
      aaBtn('Supersampling', () => viewer.state.ssaa, (v) => { viewer.state.ssaa = v; viewer.resize(); viewer.markDirty(); });
      aaCycleBtn('Minimum line width',
        [{ v: 'none', label: 'None' }, { v: 'travel', label: 'Travel lines' }, { v: 'all', label: 'All' }],
        () => viewer.state.minWidth, (v) => { viewer.state.minWidth = v; viewer.markDirty(); });
      aaBtn('Flatten distant beads', () => viewer.state.flatten, (v) => { viewer.state.flatten = v; viewer.markDirty(); });
      aaBtn('Translucent travel lines', () => viewer.state.translucentTravel, (v) => { viewer.state.translucentTravel = v; viewer.markDirty(); });
      qBtn.addEventListener('click', (e) => { e.stopPropagation(); qPanel.classList.toggle('is-hidden'); });
      document.addEventListener('click', (e) => { if (!qWrap.contains(e.target)) qPanel.classList.add('is-hidden'); });
      qWrap.appendChild(qBtn); qWrap.appendChild(qPanel);
      // Colour mode + its legend live in a top-right overlay built inside the viewer.
      const travelBtn = el('button', { type: 'button', class: 'anr-btn' }, isPrint ? 'Travel' : 'Rapids');
      const setTravel = (on) => {
        viewer.state.showTravel = on;
        travelBtn.classList.toggle('is-active', on);   // red while travel is shown
        viewer.markDirty();
      };
      if (viewer.hasTravel) {
        travelBtn.addEventListener('click', () => setTravel(!viewer.state.showTravel));
      } else travelBtn.disabled = true;

      // Bed toggle (only when the file declared a printable area). On by default, red while shown.
      let bedBtn = null;
      if (data.bed) {
        bedBtn = el('button', { type: 'button', class: 'anr-btn is-active', title: 'Show the print bed / build plate' }, 'Bed');
        bedBtn.addEventListener('click', () => {
          viewer.state.showBed = !viewer.state.showBed;
          bedBtn.classList.toggle('is-active', viewer.state.showBed);
          viewer.markDirty();
        });
      }

      // Toolbar display row: travel show-hide sits between perspective and the rest.
      // Quality moves up into the viewer's top-right colour panel; fullscreen is the
      // viewer's bottom-right overlay.
      const hasLegend = data.hasTypes && data.features.length;
      viewRow.appendChild(spinBtn); viewRow.appendChild(resetBtn); viewRow.appendChild(projBtn); viewRow.appendChild(travelBtn);
      if (bedBtn) viewRow.appendChild(bedBtn);
      // The view-control buttons (spin / reset / perspective / rapids / tool changes) sit
      // ABOVE the viewer; the playback + sliders toolbar stays below it. (markBtn / Tool
      // changes is appended to viewRow further down.)
      viewCard.insertBefore(viewRow, viewer.wrap);
      // Park the Quality popup in the viewer's top-left overlay.
      if (viewer.topLeft) viewer.topLeft.appendChild(qWrap);

      // Show/hide controls - the line-type legend (3D prints) and the CNC tool picker -
      // are built here and placed in the toolbar BELOW the Build height slider (see below).

      // OrcaSlicer-style show/hide by line type - one toggle chip per feature, built
      // exactly like the CNC tool chips below (swatch + label, dims when toggled off).
      let legend = null;
      if (hasLegend) {
        legend = el('div', { class: 'anr-gcode-legend' });
        legend.appendChild(el('span', { class: 'anr-gcode-rowlabel' }, 'Show'));
        for (const id of data.features) {
          const f = FEATURES[id];
          const swatch = el('span', { class: 'anr-gcode-swatch', style: `background:rgb(${Math.round(f.rgb[0] * 255)},${Math.round(f.rgb[1] * 255)},${Math.round(f.rgb[2] * 255)})` });
          const chip = el('button', { type: 'button', class: 'anr-btn anr-gcode-toolchip', 'aria-pressed': 'true' }, [swatch, document.createTextNode(f.label)]);
          chip.addEventListener('click', () => {
            const off = chip.classList.toggle('is-off');
            chip.setAttribute('aria-pressed', off ? 'false' : 'true');
            viewer.state.vis[id] = off ? 0 : 1; viewer.markDirty();
          });
          legend.appendChild(chip);
        }
      }

      // Multicolour FDM: a chip per filament (its real colour swatch + tool label) to
      // show/hide that filament's extrusions. Keyed on the filament index (aTool) via the
      // separate filVis array, so it stacks with the line-type Show toggles above. Placed
      // in the toolbar directly under the line-type legend.
      let filRow = null;
      if (data.multicolour && (data.filsUsed || []).length > 1) {
        filRow = el('div', { class: 'anr-gcode-legend' });
        filRow.appendChild(el('span', { class: 'anr-gcode-rowlabel' }, 'Filaments'));
        for (const idx of data.filsUsed) {
          const slot = Math.min(7, idx);
          const col = (data.filamentColors && data.filamentColors[idx]) || '#888888';
          const swatch = el('span', { class: 'anr-gcode-swatch', style: `background:${col}` });
          const chip = el('button', { type: 'button', class: 'anr-btn anr-gcode-toolchip', 'aria-pressed': 'true' }, [swatch, document.createTextNode('T' + idx)]);
          chip.addEventListener('click', () => {
            const off = chip.classList.toggle('is-off');
            chip.setAttribute('aria-pressed', off ? 'false' : 'true');
            viewer.state.filVis[slot] = off ? 0 : 1; viewer.markDirty();
          });
          filRow.appendChild(chip);
        }
      }

      // CNC: a button per tool (styled like the 3MF parts picker) to show/hide that
      // tool's cutting moves. All visible by default; click one to toggle it off and
      // isolate the rest. Built here but placed in the toolbar under the Build height
      // slider (see below).
      let toolRow = null;
      if (cncTools.length > 1) {
        toolRow = el('div', { class: 'anr-btn-row anr-gcode-toolrow' });
        toolRow.appendChild(el('span', { class: 'anr-gcode-rowlabel' }, 'Tools'));
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
      }

      const zLo = data.bbox.min[2], zHi = data.bbox.max[2];
      const slider = el('input', { type: 'range', class: 'anr-range', min: '1', max: '1000', value: '1000', title: 'Build height', 'aria-label': 'Show build up to height' });
      const sliderVal = el('span', { class: 'anr-gcode-slider-val' }, zHi.toFixed(1) + ' ' + u);
      slider.addEventListener('input', () => { const t = (+slider.value) / 1000; viewer.state.clip = t; viewer.markDirty(); sliderVal.textContent = (zLo + t * (zHi - zLo)).toFixed(1) + ' ' + u; });
      // Built here, but placed lower down (last row of the toolbar).
      const heightRow = el('div', { class: 'anr-gcode-slider' }, [
        el('span', { class: 'anr-gcode-rowlabel' }, 'Build height'), slider, sliderVal,
      ]);

      // G-code progress: scrub through the moves in print order to watch the part
      // build up, with a Play button + speed picker that animate it start to finish.
      const progSlider = el('input', { type: 'range', class: 'anr-range', min: '0', max: '1000', value: '1000', title: 'G-code progress', 'aria-label': 'Reveal moves up to' });
      const progVal = el('span', { class: 'anr-gcode-slider-val anr-gcode-slider-val--wide' }, data.segCount.toLocaleString() + ' moves');

      // Unified playback timeline: every buffered move - extrusions AND travels - in true
      // print order (data.order), so playback replays them interleaved exactly as the
      // machine runs them and the head glides along travels instead of teleporting.
      // order[g] 0=ext / 1=travel / 2=pause; gExt/gTrav are running counts of each up to
      // move g; gTime is the cumulative real duration (move length / feedrate, plus any
      // dwell / wait holds) for real-time play.
      const order = data.order, G = data.orderCount;
      const gExt = new Int32Array(G + 1), gTrav = new Int32Array(G + 1), gTime = new Float64Array(G + 1), gPause = new Int32Array(G + 1);
      for (let g = 0; g < G; g++) {
        gPause[g + 1] = gPause[g];
        if (order[g] > 1.5) {                 // pause: holds the timeline, reveals no geometry
          const pi = gPause[g]; gPause[g + 1] = pi + 1;
          gExt[g + 1] = gExt[g]; gTrav[g + 1] = gTrav[g];
          gTime[g + 1] = gTime[g] + (data.pauses ? data.pauses[pi] : 0);
          continue;
        }
        let len, feed;
        if (order[g] > 0.5) {                 // travel
          const p = gTrav[g] * 7;
          len = Math.hypot(data.travel[p + 3] - data.travel[p], data.travel[p + 4] - data.travel[p + 1], data.travel[p + 5] - data.travel[p + 2]);
          feed = data.travel[p + 6];
          gExt[g + 1] = gExt[g]; gTrav[g + 1] = gTrav[g] + 1;
        } else {                              // extrusion / cutting
          const p = gExt[g] * 10;
          len = Math.hypot(data.seg[p + 3] - data.seg[p], data.seg[p + 4] - data.seg[p + 1], data.seg[p + 5] - data.seg[p + 2]);
          feed = data.seg[p + 8];
          gExt[g + 1] = gExt[g] + 1; gTrav[g + 1] = gTrav[g];
        }
        gTime[g + 1] = gTime[g] + (feed > 1e-6 ? len / (feed / 60) : 0);
      }
      const realTotal = gTime[G];
      const fmtDur = (sec) => { sec = Math.round(sec); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), ss = sec % 60; return h ? `${h}h ${m}m` : m ? `${m}m ${ss}s` : `${ss}s`; };
      // Compact remaining-time for the wait label: one decimal under 10s, else whole.
      const fmtWait = (sec) => sec >= 60 ? `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s` : `${sec.toFixed(sec < 10 ? 1 : 0)}s`;

      // Live playback HUD, refreshed by applyGlobal as you scrub / play: elapsed / total
      // time, the current layer, and - on multi-material prints or multi-tool CNC jobs -
      // the active tool with its colour swatch. Each item only exists when its data
      // applies (no feedrates -> no time; single-material -> no tool line), and the whole
      // strip is omitted if none apply.
      const hudShowTime = realTotal > 0;
      const hudShowLayer = isPrint && data.layerZs && data.layerZs.length > 1;
      const hudShowTool = (isPrint && data.multicolour) || (!isPrint && cncTools.length > 1);
      const hudTime = el('span', { class: 'anr-gcode-hud-item', title: 'Elapsed / total print time (from feedrates and holds)' });
      const hudLayer = el('span', { class: 'anr-gcode-hud-item', title: 'Current layer at the print head / total layers' });
      const hudSwatch = el('span', { class: 'anr-gcode-hud-swatch' });
      const hudToolText = el('span');
      const hudTool = el('span', { class: 'anr-gcode-hud-item', title: isPrint ? 'Active filament at the print head' : 'Active cutting tool' }, [hudSwatch, hudToolText]);
      const hudItems = [];
      if (hudShowTime) hudItems.push(hudTime);
      if (hudShowLayer) hudItems.push(hudLayer);
      if (hudShowTool) hudItems.push(hudTool);
      const hud = hudItems.length ? el('div', { class: 'anr-gcode-hud' }, hudItems) : null;
      // Rewrite the HUD for a global position `gi` (moves). Cheap: a binary search for the
      // layer and a small linear tool lookup, so it's fine to run every playback frame.
      const updateHud = (gi) => {
        const g = Math.max(0, Math.min(G, Math.floor(gi))), frac = Math.max(0, Math.min(G, gi)) - g, s = viewer.state;
        if (hudShowTime) {
          const elapsed = g >= G ? realTotal : gTime[g] + frac * (gTime[g + 1] - gTime[g]);
          hudTime.textContent = fmtDur(elapsed) + ' / ' + fmtDur(realTotal);
        }
        if (hudShowLayer) {
          const zs = data.layerZs;
          const curZ = g >= G ? zs[zs.length - 1] : (s.restValid ? s.restZ : zs[0]);
          let lo = 0, hi = zs.length;   // count of layer heights at or below the head's Z
          while (lo < hi) { const mid = (lo + hi) >> 1; if (zs[mid] <= curZ + 1e-4) lo = mid + 1; else hi = mid; }
          hudLayer.textContent = 'Layer ' + Math.max(1, Math.min(zs.length, lo)) + ' / ' + zs.length;
        }
        if (hudShowTool) {
          const idx = g >= G ? data.segCount - 1 : Math.max(0, Math.min(data.segCount - 1, gExt[g]));
          if (isPrint) {
            const fi = (data.segFil && data.segFil[idx]) | 0;
            hudToolText.textContent = 'Filament ' + (fi + 1);
            hudSwatch.style.background = (data.filamentColors && data.filamentColors[fi]) || '#cccccc';
          } else {
            const slot = data.seg[idx * 10 + 9] | 0, t = cncTools.find((c) => c.slot === slot), f = FEATURES[slot] || FEATURES[7];
            hudToolText.textContent = t ? toolLabel(t.n) : 'Tool';
            hudSwatch.style.background = `rgb(${Math.round(f.rgb[0] * 255)},${Math.round(f.rgb[1] * 255)},${Math.round(f.rgb[2] * 255)})`;
          }
        }
      };
      if (hud) updateHud(G);   // seed the readout to the finished state (the default full view)

      // Playback rate in moves/s. A "length" preset scales to the file (G / seconds) so any
      // job finishes in that many seconds; a "lines/s" preset is a fixed rate.
      const lpsForLen = (sec) => Math.max(1, G / sec);
      // Default playback is a fixed 30s run of the whole job (set via choose() below);
      // real time (honouring feedrates + dwell holds) stays available as a preset.
      let playLps = lpsForLen(30), realtime = false;

      // Apply a fractional global position `gi` (in moves): reveal the ext + travel
      // segments done so far and set the in-progress (partial) move - ext or travel - so
      // its bead/line grows toward the live head. Syncs the slider + readout.
      const applyGlobal = (gi) => {
        gi = Math.max(0, Math.min(G, gi));
        const g = Math.floor(gi), frac = gi - g, s = viewer.state;
        if (g >= G) {
          s.shown = data.segCount; s.travShown = data.travelCount; s.partial = 0; s.playKind = 0; s.playFrac = 0; s.paused = false; s.pauseText = '';
        } else {
          s.shown = gExt[g]; s.travShown = gTrav[g];
          // Resting tool point = the start of the next non-pause move. During a dwell the
          // machine holds this spot, and (the path being continuous) it equals the end of the
          // previous move, so it's the true tool position at a boundary. Travel- or extrusion-
          // aware - without this the head falls back to a stale last-extrusion endpoint and
          // teleports (e.g. a leading dwell freezing on the model, then snapping to the corner
          // when the first travel begins). gExt/gTrav don't advance across pauses, so gExt[g]/
          // gTrav[g] already index that next move.
          { let k = g; while (k < G && order[k] > 1.5) k++;
            if (k < G) {
              if (order[k] < 0.5) { const q = gExt[g] * 10; s.restX = data.seg[q]; s.restY = data.seg[q + 1]; s.restZ = data.seg[q + 2]; }
              else { const q = gTrav[g] * 7; s.restX = data.travel[q]; s.restY = data.travel[q + 1]; s.restZ = data.travel[q + 2]; }
              s.restValid = true;
            } }
          if (order[g] > 1.5) {   // pause: head holds where it was, nothing new
            s.playKind = 0; s.partial = 0; s.playFrac = 0; s.paused = true;
            // Wait label: what it is waiting for + how long the VIEWER still waits (the
            // capped playback hold counted down, frac is 0..1 over it), so it reaches 0
            // exactly when playback resumes. In real-time mode this ticks at 1 s/second.
            const pi = gPause[g];
            const info = data.pauseInfo && data.pauseInfo[pi];
            const hold = data.pauses ? data.pauses[pi] : 0;
            s.pauseText = info ? (hold > 0 ? info.label + '  ' + fmtWait(Math.max(0, hold * (1 - frac))) : info.label) : '';
          } else if (order[g] > 0.5) { s.playKind = frac > 0 ? 2 : 0; s.playFrac = frac; s.partial = 0; s.paused = false; s.pauseText = ''; }
          else { s.playKind = frac > 0 ? 1 : 0; s.partial = frac; s.playFrac = frac; s.paused = false; s.pauseText = ''; }
        }
        viewer.markDirty();
        progSlider.value = String(G ? Math.round(gi / G * 1000) : 1000);
        progVal.textContent = s.shown.toLocaleString() + ' / ' + data.segCount.toLocaleString();
        if (hud) updateHud(gi);
      };
      let playPos = G, playElapsed = realTotal;
      // Scrub: snap to a whole move (no partial), so dragging only ever shows complete moves.
      const scrubTo = (gi) => { playPos = Math.max(0, Math.min(G, Math.round(gi))); playElapsed = gTime[Math.min(G, playPos)]; viewer.state.isoEndRelease = false; applyGlobal(playPos); };

      let playing = false, playRAF = 0, lastTs = 0, firstPlay = true;
      function stopPlay() { if (!playing) return; playing = false; playBtn.textContent = 'Play'; viewer.state.head = false; viewer.markDirty(); if (playRAF) cancelAnimationFrame(playRAF); playRAF = 0; }
      function stepPlay(ts) {
        if (!playing) return;
        if (!viewer.wrap.isConnected) { stopPlay(); return; }
        if (!lastTs) lastTs = ts;
        const dt = Math.min(0.25, (ts - lastTs) / 1000); lastTs = ts;
        if (realtime) {
          // Advance by wall-clock against the real per-move timeline (extrusions AND
          // travels), interpolating within whichever move the clock currently sits in.
          playElapsed += dt;
          if (playElapsed >= realTotal) { playPos = G; applyGlobal(G); viewer.state.isoEndRelease = true; stopPlay(); return; }
          let g = Math.max(0, Math.min(G - 1, Math.floor(playPos)));
          while (g < G && gTime[g + 1] <= playElapsed) g++;
          while (g > 0 && gTime[g] > playElapsed) g--;
          const dur = gTime[g + 1] - gTime[g];
          playPos = g + (dur > 1e-9 ? (playElapsed - gTime[g]) / dur : 0);
          applyGlobal(playPos);
        } else {
          playPos += playLps * dt;
          if (playPos >= G) { playPos = G; applyGlobal(G); viewer.state.isoEndRelease = true; stopPlay(); return; }
          applyGlobal(playPos);
        }
        playRAF = requestAnimationFrame(stepPlay);
      }
      // Fixed min-width so the button doesn't jump in width between 'Play' and the
      // wider 'Pause' (sized to comfortably hold 'Pause'), with the label centred.
      const playBtn = el('button', { type: 'button', class: 'anr-btn', title: 'Play the print start to finish', style: 'min-width:74px;text-align:center;' }, 'Play');
      playBtn.addEventListener('click', () => {
        if (playing) { stopPlay(); return; }
        // First play of this print: pause spin, ease the camera back to the default
        // framing, and reveal travel moves so the head's hops read. Later plays just
        // continue from where it is.
        if (firstPlay) { firstPlay = false; viewer.resetView(); if (viewer.hasTravel) setTravel(true); }
        if (playPos >= G) scrubTo(0);   // replay from the start
        viewer.state.isoEndRelease = false;   // a fresh play run re-dims to the isolate
        playing = true; lastTs = 0; playBtn.textContent = 'Pause'; viewer.state.head = true; viewer.markDirty();
        const g = Math.min(G, Math.floor(playPos)), dur = g < G ? gTime[g + 1] - gTime[g] : 0;
        playElapsed = gTime[g] + (playPos - g) * dur;   // sync the real-time clock to the resume point
        playRAF = requestAnimationFrame(stepPlay);
      });

      // Follow camera: toggle off <-> toolhead. 'Toolhead' keeps the tool point centred
      // (only rotation/zoom free). draw() reads viewer.state.follow.
      const FOLLOW_LABELS = ['Follow: off', 'Follow: toolhead'];
      const FOLLOW_TITLES = [
        'Camera follows nothing - free orbit, pan and zoom',
        'Camera locks onto the toolhead and keeps it centred; only rotation and zoom stay free',
      ];
      const followBtn = el('button', { type: 'button', class: 'anr-btn', title: FOLLOW_TITLES[0] }, FOLLOW_LABELS[0]);
      followBtn.addEventListener('click', () => {
        const s = viewer.state;
        s.follow = (s.follow + 1) % 2;
        followBtn.textContent = FOLLOW_LABELS[s.follow];
        followBtn.title = FOLLOW_TITLES[s.follow];
        followBtn.classList.toggle('is-active', s.follow !== 0);
        viewer.markDirty();
      });

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
      const lpsCol = mkCol('Lines/s'), lenCol = mkCol('Duration');
      for (const [v, l] of LINE_PRESETS) {
        const b = el('button', { type: 'button', class: 'anr-btn anr-spd-opt' }, l);
        b.addEventListener('click', () => { choose(v, l, b); closeSpd(); });
        allPresetBtns.push(b); lpsCol.appendChild(b);
      }
      let defBtn = null;
      for (const s of LEN_PRESETS) {
        const b = el('button', { type: 'button', class: 'anr-btn anr-spd-opt' }, s + 's');
        b.addEventListener('click', () => { choose(lpsForLen(s), 'whole job in ' + s + 's', b); closeSpd(); });
        allPresetBtns.push(b); lenCol.appendChild(b);
        if (s === 30) defBtn = b;
      }
      // Real time: play each move at its true duration. Show the total so it's clear
      // how long that is before committing to it.
      let rtBtn = null;
      if (realTotal > 0) {
        const rb = el('button', { type: 'button', class: 'anr-btn anr-spd-opt', title: 'Real time - play at the toolpath\'s real execution time' }, fmtDur(realTotal));
        rb.addEventListener('click', () => { chooseReal(rb); closeSpd(); });
        allPresetBtns.push(rb); lenCol.appendChild(rb); rtBtn = rb;
      }
      cols.appendChild(lpsCol); cols.appendChild(lenCol);
      spdPanel.appendChild(cols);

      // Custom rate: a number + a unit toggle (lines/s <-> length in seconds).
      let customMode = 'len';   // 'lps' = lines/s, 'len' = seconds
      const customRow = el('div', { class: 'anr-spd-custom' });
      const customIn = el('input', { type: 'number', min: '1', step: '1', class: 'anr-spd-input', placeholder: 'Custom', 'aria-label': 'Custom playback rate' });
      const unitBtn = el('button', { type: 'button', class: 'anr-btn anr-spd-unit', title: 'Switch the custom value between lines per second and total length' }, 'duration (s)');
      const applyCustom = () => {
        const v = parseFloat(customIn.value);
        if (!(v > 0)) return;
        if (customMode === 'lps') choose(v, Math.round(v).toLocaleString() + ' lines/s', null);
        else choose(lpsForLen(v), 'whole job in ' + v + 's', null);
      };
      customIn.addEventListener('input', applyCustom);
      unitBtn.addEventListener('click', () => { customMode = customMode === 'lps' ? 'len' : 'lps'; unitBtn.textContent = customMode === 'lps' ? 'lines/s' : 'duration (s)'; applyCustom(); });
      customRow.appendChild(customIn); customRow.appendChild(unitBtn);
      spdPanel.appendChild(customRow);

      // In fullscreen the popup lives inside the scrollable bottom toolbar overlay, which
      // would clip it. Park it directly on the fullscreen wrap (a positioned, unclipped
      // overlay) while open so it floats centred over the whole view; dock it back to the
      // button on close. `viewer` is reassigned on the MSAA rebuild, so read it live.
      const dockSpd = () => { if (spdPanel.parentNode !== spdWrap) { spdPanel.classList.remove('anr-spd-panel--fs'); spdWrap.appendChild(spdPanel); } };
      const openSpd = () => {
        const fs = document.fullscreenElement;
        if (fs && viewer && fs === viewer.wrap) { spdPanel.classList.add('anr-spd-panel--fs'); viewer.wrap.appendChild(spdPanel); }
        spdPanel.classList.remove('is-hidden');
      };
      const closeSpd = () => { spdPanel.classList.add('is-hidden'); dockSpd(); };
      spdBtn.addEventListener('click', (e) => { e.stopPropagation(); if (spdPanel.classList.contains('is-hidden')) openSpd(); else closeSpd(); });
      document.addEventListener('click', (e) => { if (!spdWrap.contains(e.target) && !spdPanel.contains(e.target)) closeSpd(); });
      document.addEventListener('fullscreenchange', () => closeSpd());   // dock back when entering/leaving fullscreen
      spdWrap.appendChild(spdBtn); spdWrap.appendChild(spdPanel);
      // Default the whole job to a fixed 30s playback (real time stays available as a
      // preset, and the real-time button is still selectable when the file carries
      // feedrate data). defBtn is the 30s length preset.
      choose(lpsForLen(30), 'whole job in 30s', defBtn);

      progSlider.addEventListener('input', () => { stopPlay(); scrubTo(G * (+progSlider.value) / 1000); });

      // Tool-change markers: a thin white tick on the progress slider at every tool /
      // filament change, with a mono hover popup naming it. Near-coincident changes are
      // bucketed so a many-swap print doesn't spawn thousands of ticks. The slider stays
      // fully draggable (the tick layer is pointer-events:none); hover is read from a
      // mousemove on the wrapper and snapped to the nearest tick.
      const Gm = data.orderCount || 1;
      const markBuckets = new Map();
      for (const m of (data.toolMarks || [])) {
        const pct = Math.max(0, Math.min(1, m.at / Gm));
        const key = Math.round(pct * 300);
        let e = markBuckets.get(key);
        if (!e) { e = { pct, count: 0, items: [] }; markBuckets.set(key, e); }
        e.count++; if (e.items.length < 6) e.items.push(m);
      }
      const marks = [...markBuckets.values()].sort((a, b) => a.pct - b.pct);
      // Build the (multi-line, mono) hover popup for a bucket: title, each change's
      // from -> to tool with its filament colour swatch (or CNC tool description), and a
      // footer with the build height, move number and progress.
      const buildMarkPop = (e) => {
        markPop.textContent = '';
        const single = e.count === 1;
        markPop.appendChild(el('div', { style: 'font-weight:600;' }, single ? (e.items[0].kind === 'filament' ? 'Filament change' : 'Tool change') : (e.count + ' tool changes')));
        for (const m of (single ? e.items : e.items)) {
          const line = el('div', {});
          line.appendChild(document.createTextNode((m.from != null && m.from !== m.to) ? ('T' + m.from + ' → T' + m.to) : ('T' + m.to)));
          const col = data.filamentColors && data.filamentColors[m.to];
          if (data.multicolour && col) {
            line.appendChild(el('span', { style: `display:inline-block;width:9px;height:9px;margin:0 4px -1px;border:1px solid rgba(255,255,255,0.45);background:${col};` }));
            line.appendChild(document.createTextNode(col));
          } else if (m.desc) { line.appendChild(document.createTextNode(' - ' + titleCase(m.desc))); }
          markPop.appendChild(line);
        }
        const m0 = e.items[0];
        const foot = single
          ? `Z ${(+m0.z || 0).toFixed(1)} ${u} · move ${m0.at.toLocaleString()} · ${Math.round(e.pct * 100)}%`
          : `~${Math.round(e.pct * 100)}%`;
        markPop.appendChild(el('div', { style: 'opacity:0.7;margin-top:1px;' }, foot));
      };

      progSlider.style.width = '100%'; progSlider.style.display = 'block';
      const sliderWrap = el('div', { class: 'anr-gcode-slidwrap', style: 'position:relative;flex:1;min-width:0;display:flex;align-items:center;' });
      const markLayer = el('div', { style: 'position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none;' });
      const markPop = el('div', { class: 'anr-gcode-markpop', style: 'position:absolute;top:-4px;display:none;transform:translate(-50%,-100%);pointer-events:none;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;white-space:nowrap;padding:2px 6px;border-radius:4px;background:rgba(10,12,16,0.85);color:#eef2ff;border:1px solid rgba(255,255,255,0.22);z-index:7;' });
      for (const m of marks) {
        markLayer.appendChild(el('div', { class: 'anr-gcode-mark', style: `position:absolute;top:1px;bottom:1px;left:${(m.pct * 100).toFixed(3)}%;width:1px;background:rgba(255,255,255,0.9);box-shadow:0 0 2px rgba(0,0,0,0.7);` }));
      }
      let toolMarksOn = marks.length > 0;   // off when the file has no tool / filament changes
      markLayer.style.display = toolMarksOn ? '' : 'none';
      sliderWrap.appendChild(progSlider); sliderWrap.appendChild(markLayer); sliderWrap.appendChild(markPop);
      sliderWrap.addEventListener('mousemove', (e) => {
        if (!toolMarksOn || !marks.length) { markPop.style.display = 'none'; return; }
        const rect = sliderWrap.getBoundingClientRect();
        const frac = (e.clientX - rect.left) / (rect.width || 1);
        let best = null, bestd = 1e9;
        for (const m of marks) { const d = Math.abs(m.pct - frac); if (d < bestd) { bestd = d; best = m; } }
        if (best && bestd * rect.width <= 6) { buildMarkPop(best); markPop.style.left = (best.pct * 100).toFixed(3) + '%'; markPop.style.display = ''; }
        else markPop.style.display = 'none';
      });
      sliderWrap.addEventListener('mouseleave', () => { markPop.style.display = 'none'; });

      // Toggle (in the view-controls row, on by default): show/hide the tool-change ticks
      // AND the per-tool toolhead markers. When off, the toolhead stays the default marker.
      const markBtn = el('button', { type: 'button', class: 'anr-btn', title: 'Show a tick on the progress slider at every tool / filament change, and give each tool its own toolhead marker' }, 'Tool changes');
      markBtn.classList.toggle('is-active', toolMarksOn);
      if (!marks.length) { markBtn.disabled = true; markBtn.title = 'No tool or filament changes in this file'; }
      viewer.state.toolMarkers = toolMarksOn;   // keep the head markers in step with the toggle
      markBtn.addEventListener('click', () => {
        toolMarksOn = !toolMarksOn;
        markBtn.classList.toggle('is-active', toolMarksOn);
        markLayer.style.display = toolMarksOn ? '' : 'none';
        if (!toolMarksOn) markPop.style.display = 'none';
        viewer.state.toolMarkers = toolMarksOn; viewer.markDirty();
      });
      // "Tool changes" now lives next to Follow (below the viewer); its old slot in the
      // view-controls row is taken by "Dim other tools" (the isolate toggle below).

      // Dim other tools: fade every tool except the one currently at the head to a
      // travel-like translucency, leaving just the active tool's beads solid. Only
      // meaningful when the file actually uses more than one tool / filament.
      const hasMultiTool = (data.multicolour && (data.filsUsed || []).length > 1) || cncTools.length > 1;
      const isoBtn = el('button', { type: 'button', class: 'anr-btn', title: 'Fade every tool except the one currently printing - its lines stay solid, the rest go translucent like travel moves' }, 'Dim other tools');
      if (!hasMultiTool) { isoBtn.disabled = true; isoBtn.title = 'This file only uses one tool'; }
      isoBtn.addEventListener('click', () => {
        const on = !viewer.state.isoTool;
        viewer.state.isoTool = on;
        // Snap (no crossfade) when the toggle itself flips - re-baseline the tracked tool
        // to whatever is at the head so it settles instantly; the crossfade only smooths
        // tool changes that happen while iso is already on.
        viewer.state.isoCurTool = on ? (viewer.state.headToolRaw | 0) : null;
        viewer.state.isoFadeTool = null; viewer.state.isoFadeT = 1;
        isoBtn.classList.toggle('is-active', on);
        viewer.markDirty();
      });
      viewRow.appendChild(isoBtn);
      // Equal-width view buttons clip with an ellipsis when narrow; rather than show
      // "Dim other to..." swap to the shorter "Dim tools" once the full label can't fit.
      // Measure from the long label each time so it restores when there's room again.
      const fitIsoLabel = () => {
        isoBtn.textContent = 'Dim other tools';
        if (isoBtn.scrollWidth > isoBtn.clientWidth) isoBtn.textContent = 'Dim tools';
      };
      if (window.ResizeObserver) { const ro = new ResizeObserver(fitIsoLabel); ro.observe(isoBtn); }

      // ---- Export clip: deterministic offline render to an MP4 download ----
      // Steps the same applyGlobal() timeline the scrubber uses through N frames,
      // draws each one synchronously at the exact clip resolution, and encodes via
      // WebCodecs into an H.264 MP4 (muxed by the vendored mp4-muxer). Deterministic:
      // every frame is perfect regardless of machine load, and it renders faster
      // than real time. Only offered where WebCodecs can encode (Chrome, Edge,
      // Safari 16.4+, recent Firefox) - the button simply doesn't exist elsewhere.
      let clipBtn = null;
      if (window.VideoEncoder && window.VideoFrame) {
        // orbit/follow/overlay are clip-only motion/stamp options. persp/bed/travel/dim
        // mirror live viewer-state flags (ortho / showBed / showTravel / isoTool) and are
        // re-seeded from the viewer each time the popup opens, so the export defaults to
        // whatever the user set in the normal viewer but can be overridden here.
        const clipCfg = { dur: 10, aspect: '16:9', size: 1080, fps: 60, quality: 0.18, reset: true, orbit: true, follow: false, overlay: true, persp: true, bed: true, travel: false, dim: false };
        // Single definition of the four toggles that mirror viewer state. `cfg` is the
        // clipCfg key, `st` the viewer.state flag; `get` reads state -> clip value (to
        // seed the popup), `put` writes clip value -> state (on export). Some invert
        // (persp is !ortho) and dim only bites with multiple tools. Drives all three
        // sites - seed, apply, snapshot - so they can never drift.
        const SCENE_MIRROR = [
          { cfg: 'persp', st: 'ortho', get: (s) => !s.ortho, put: (c) => !c },
          { cfg: 'bed', st: 'showBed', get: (s) => !!s.showBed, put: (c) => !!c },
          { cfg: 'travel', st: 'showTravel', get: (s) => !!s.showTravel, put: (c) => !!c },
          { cfg: 'dim', st: 'isoTool', get: (s) => !!s.isoTool, put: (c) => !!c && hasMultiTool },
        ];
        const CLIP_TAIL_S = 3;   // hold on the finished build this long after the print completes
        // Fixed lead-in: rush the first CLIP_INTRO_MOVES moves through in CLIP_INTRO_S so the
        // setup boilerplate (home, heat, prime, skirt) doesn't eat the clip's time budget - the
        // real build then plays over clipCfg.dur. Only applied when there's more than the lead-in
        // worth of moves; a short file just plays normally. So a "10s" clip is 1s + 10s + 3s.
        const CLIP_INTRO_S = 1, CLIP_INTRO_MOVES = 5;
        const clipHasIntro = () => G > CLIP_INTRO_MOVES;
        const clipDims = () => {
          const s = clipCfg.size;
          return clipCfg.aspect === '16:9' ? [Math.round(s * 16 / 9), s]
            : clipCfg.aspect === '9:16' ? [s, Math.round(s * 16 / 9)]
              : [s, s];
        };
        // Bitrate scales with the pixel rate (~0.1 bit per pixel), and the H.264
        // level (the last two hex digits of the codec string) steps up with the same
        // rate so 1080p60 doesn't exceed what a Level 4.0 decoder accepts.
        // Bits per pixel-second, chosen by the Quality row. The render is thin lines
        // edge-to-edge (high-frequency detail everywhere), so it needs a healthier
        // bitrate than typical footage to stay crisp - hence the default sits at
        // 'High' (0.18), not the old flat 0.1.
        const clipRate = (W, H) => Math.round(W * H * clipCfg.fps * clipCfg.quality);
        const clipLevel = (W, H) => {
          const r = W * H * clipCfg.fps;
          return r > 1920 * 1080 * 30 ? '2a' : r > 1280 * 720 * 60 ? '28' : r > 1280 * 720 * 30 ? '20' : '1f';
        };

        // H.264 Annex B plumbing for encoders (Firefox) that produce a fine bitstream
        // but no decoderConfig metadata: MP4 needs the SPS/PPS parameter sets in a
        // header box (avcC) and length-prefixed NALs in the samples, while Annex B
        // carries the parameter sets in-band between start codes. These three turn
        // one into the other; pure bitstream structure, identical in every browser.
        // (Emulation-prevention bytes guarantee no start code can occur inside a NAL,
        // so the naive scan is safe.)
        const splitAnnexB = (buf) => {
          const nals = [];
          let i = 0, start = -1;
          const n = buf.length;
          while (i + 3 <= n) {
            if (buf[i] === 0 && buf[i + 1] === 0 && (buf[i + 2] === 1 || (buf[i + 2] === 0 && buf[i + 3] === 1))) {
              const sc = buf[i + 2] === 1 ? 3 : 4;
              if (start >= 0) nals.push(buf.subarray(start, i));
              i += sc; start = i;
            } else i++;
          }
          if (start >= 0 && start < n) nals.push(buf.subarray(start, n));
          return nals;
        };
        // Some encoders (Firefox / Windows Media Foundation) emit parameter-set NALs
        // with their one-byte NAL header DUPLICATED - an SPS comes through as
        // "67 67 64 00 ..." instead of "67 64 00 ...", a PPS as "68 68 ..." instead of
        // "68 ...". That shifts profile_idc to a bogus value; Firefox's own decoder
        // shrugs it off, but strict parsers (WhatsApp / Android MediaCodec) reject the
        // whole file ("can't be opened"). Drop the duplicate when the first two bytes
        // are an identical, valid SPS(7)/PPS(8) header; leave clean NALs untouched.
        const dedupeNalHeader = (nal) => {
          const t = nal[0] & 31;
          return (nal.length >= 2 && nal[0] === nal[1] && (t === 7 || t === 8)) ? nal.subarray(1) : nal;
        };
        // AVCDecoderConfigurationRecord from one SPS + one PPS (all this encoder emits).
        const buildAvcC = (spsRaw, ppsRaw) => {
          const sps = dedupeNalHeader(spsRaw), pps = dedupeNalHeader(ppsRaw);
          return new Uint8Array([
            1, sps[1], sps[2], sps[3], 0xff, 0xe1,
            sps.length >> 8, sps.length & 0xff, ...sps,
            1, pps.length >> 8, pps.length & 0xff, ...pps,
          ]);
        };
        // Re-pack an encoder-supplied avcC into a conformant one: de-duplicate each
        // parameter set's NAL header (above) and restore the reserved bits (Media
        // Foundation also writes 0x03/0x01 where the spec wants 0xff/0xe1). Returns the
        // original bytes if it can't be parsed, so a good avcC is never made worse.
        const sanitizeAvcC = (desc) => {
          try {
            const b = desc instanceof Uint8Array ? desc : new Uint8Array(desc);
            if (b.length < 7 || b[0] !== 1) return desc;
            let o = 6;
            const read = (n) => { const list = []; for (let i = 0; i < n; i++) { const len = (b[o] << 8) | b[o + 1]; o += 2; list.push(dedupeNalHeader(b.subarray(o, o + len))); o += len; } return list; };
            const spsList = read(b[5] & 0x1f);
            const ppsList = read(b[o++]);
            if (!spsList.length || !ppsList.length) return desc;
            const s0 = spsList[0];
            const out = [1, s0[1], s0[2], s0[3], 0xff, 0xe0 | (spsList.length & 0x1f)];
            for (const s of spsList) out.push(s.length >> 8, s.length & 0xff, ...s);
            out.push(ppsList.length & 0xff);
            for (const p of ppsList) out.push(p.length >> 8, p.length & 0xff, ...p);
            return new Uint8Array(out);
          } catch (_) { return desc; }
        };
        // Direct-path (already length-prefixed / AVCC) sample cleanup: drop in-band
        // parameter sets (7/8 - they belong in the avcC) and access-unit delimiters (9).
        // Media Foundation (Firefox on Windows) inlines all three into every sample,
        // producing a non-conformant avc1 track that strict players (WhatsApp) refuse to
        // load even once the avcC is fixed. Keeps SEI (6) and the VCL slices; returns the
        // buffer untouched if nothing needs dropping (Chrome) or it can't be parsed.
        const stripInbandNals = (buf) => {
          const keep = [];
          let i = 0, total = 0, dropped = false;
          while (i + 4 <= buf.length) {
            const len = ((buf[i] << 24) | (buf[i + 1] << 16) | (buf[i + 2] << 8) | buf[i + 3]) >>> 0;
            i += 4;
            if (len === 0 || i + len > buf.length) return buf;   // malformed - leave as-is
            const t = buf[i] & 31;
            if (t === 7 || t === 8 || t === 9) dropped = true;
            else { keep.push(buf.subarray(i, i + len)); total += 4 + len; }
            i += len;
          }
          if (!dropped || !keep.length) return buf;
          const out = new Uint8Array(total);
          let o = 0;
          for (const nal of keep) {
            out[o++] = (nal.length >>> 24) & 255; out[o++] = (nal.length >>> 16) & 255; out[o++] = (nal.length >>> 8) & 255; out[o++] = nal.length & 255;
            out.set(nal, o); o += nal.length;
          }
          return out;
        };
        // Annex B frame -> MP4 sample: drop the in-band parameter sets (7/8, they live
        // in the avcC) and access-unit delimiters (9), length-prefix what remains.
        const annexbToAvcc = (buf) => {
          const nals = splitAnnexB(buf).filter((nal) => { const t = nal[0] & 31; return t !== 7 && t !== 8 && t !== 9; });
          let len = 0;
          for (const nal of nals) len += 4 + nal.length;
          const out = new Uint8Array(len);
          let o = 0;
          for (const nal of nals) {
            out[o++] = nal.length >>> 24; out[o++] = (nal.length >>> 16) & 255; out[o++] = (nal.length >>> 8) & 255; out[o++] = nal.length & 255;
            out.set(nal, o); o += nal.length;
          }
          return out;
        };

        // The clip is deliberately VIDEO-ONLY. An earlier attempt added a silent AAC
        // track to satisfy players thought to require audio, but the true cause of
        // WhatsApp's rejection was the malformed High-profile header (fixed by
        // sanitizeAvcC + the Baseline preference above); a hand-built silent AAC track
        // is in fact what WhatsApp Web then refused to send. A clean video-only MP4
        // uploads fine, so no audio track is muxed.

        // Stamp overlay chips onto a composited frame. The site tag (bottom-right) is
        // always drawn - it is the clip's watermark and stays on every export. The
        // file name + progress (+ build height) chip (bottom-left) is the toggleable
        // "Info overlay" and is drawn only when `withInfo`. Fixed dark-translucent
        // treatment (like the pause tag) so it reads on any canvas.
        const drawClipOverlay = (ctx, W, H, t, withInfo) => {
          const s = viewer.state;
          const fpx = Math.max(15, Math.round(Math.min(W, H) * 0.028));
          const pad = Math.round(fpx * 0.6), m = Math.round(fpx * 0.9), chipH = fpx + pad * 2;
          ctx.font = '500 ' + fpx + 'px "Geist Mono", ui-monospace, Consolas, monospace';
          ctx.textBaseline = 'middle';
          const chip = (txt, right) => {
            const w = Math.ceil(ctx.measureText(txt).width) + pad * 2;
            const x = right ? W - m - w : m, y = H - m - chipH;
            ctx.fillStyle = 'rgba(10, 12, 16, 0.78)'; ctx.fillRect(x, y, w, chipH);
            ctx.fillStyle = '#eef2ff'; ctx.fillText(txt, x + pad, y + chipH / 2 + 1);
          };
          if (withInfo) {
            const tail = ' · ' + Math.round(t * 100) + '%' + (s.restValid ? ' · Z ' + s.restZ.toFixed(u === 'mm' ? 1 : 2) + ' ' + u : '');
            // Ellipsize a long file name so the left chip never collides with the tag.
            let name = file.name;
            while (name.length > 6 && ctx.measureText(name + tail).width + pad * 2 > W * 0.6) name = name.slice(0, -2);
            if (name !== file.name) name += '…';
            chip(name + tail, false);
          }
          chip('lab.valjdakosta.com', true);   // always: the site watermark on every clip
        };

        let clipBusy = false;
        async function renderClip() {
          if (clipBusy || !viewer.ok) return;
          clipBusy = true; clipBtn.disabled = true;
          viewer.state.isoNoFade = true;   // deterministic frames: no per-frame tool-change crossfade
          stopPlay();
          playBtn.disabled = true; progSlider.disabled = true;   // they'd fight the frame loop
          const [W, H] = clipDims();
          const fps = clipCfg.fps, N = Math.max(1, Math.round(clipCfg.dur * fps));
          // Lead-in: rush the first CLIP_INTRO_MOVES moves through in CLIP_INTRO_S (see above).
          // introF frames cover moves 0..g0; the main N frames cover g0..G; then the tail holds.
          const introF = clipHasIntro() ? Math.round(CLIP_INTRO_S * fps) : 0;
          const g0 = clipHasIntro() ? CLIP_INTRO_MOVES : 0;
          // Hold on the finished build for 3s after the print completes (the orbit
          // keeps turning), so the clip doesn't cut on the final layer.
          const NF = introF + N + CLIP_TAIL_S * fps;
          const s0 = viewer.state;
          // spin is restored through setSpin (not the state assign) so its listeners
          // repaint the Pause/Resume spin button.
          const savedSpin = s0.spin;
          const saved = { yaw: s0.yaw, pitch: s0.pitch, dist: s0.dist, panX: s0.panX, panY: s0.panY, follow: s0.follow, head: s0.head, fitted: s0.fitted, isoAlpha: s0.isoAlpha };
          for (const m of SCENE_MIRROR) saved[m.st] = s0[m.st];   // snapshot the mirrored flags so export reverts them
          const savedPos = playPos;
          // Progress chip over the canvas; Cancel aborts cleanly and restores the view.
          let cancelled = false, failed = false;
          const statTxt = el('span', {}, 'Rendering clip…');
          const statCancel = el('button', { type: 'button', class: 'anr-btn' }, 'Cancel');
          statCancel.addEventListener('click', () => { cancelled = true; });
          const statBox = el('div', { class: 'anr-gcode-clipstat' }, [statTxt, statCancel]);
          // Arm (or re-arm, after an MSAA rebuild swaps the canvas mid-render) the
          // export camera: exact clip resolution, no pan, auto-fit framing at that
          // aspect - the user's angle is kept, the composition is guaranteed.
          let curCanvas = null;
          const arm = () => {
            const v = viewer;
            curCanvas = v.canvas;
            if (statBox.parentNode !== v.wrap) v.wrap.appendChild(statBox);
            v.canvas.style.pointerEvents = 'none';   // a mid-render drag would wreck the framing
            v.setExportSize(W, H);
            const s = v.state;
            s.panX = 0; s.panY = 0; s.head = true; s.follow = clipCfg.follow ? 1 : 0;
            // "Reset view" (on by default): start the clip from the default home
            // orientation (the "Reset view" angle) instead of wherever the user last
            // orbited to, so the composition is reproducible regardless of the live
            // camera. Off keeps the current angle. The orbit (if on) advances from this
            // base; yaw0 is snapshotted right after arm().
            if (clipCfg.reset) { s.yaw = HOME_YAW; s.pitch = HOME_PITCH; }
            // Scene/projection toggles from the popup (set before fit() so the bed is
            // framed when shown). Restored from `saved` after the render.
            for (const m of SCENE_MIRROR) s[m.st] = m.put(clipCfg[m.cfg]);
            // Portrait frames tighter than it looks (the fit is against the narrow
            // horizontal FOV, and the overlay chips eat into it) - give 9:16 the most
            // air, and pull 1:1 back a touch too (a square crop hugs the model on the
            // orbit); 16:9 stays at the standard fill.
            v.fit(clipCfg.aspect === '9:16' ? 0.72 : clipCfg.aspect === '1:1' ? 0.8 : 0.92);
          };
          let encoder = null, encErr = null;
          try {
            const comp = el('canvas'); comp.width = W; comp.height = H;
            const ctx = comp.getContext('2d');
            ctx.imageSmoothingQuality = 'high';   // the GL canvas is supersampled; this is the downscale
            // Pick the H.264 config: the MOST COMPATIBLE profile the encoder supports at
            // the level this pixel rate needs (Constrained Baseline -> Main -> High). We
            // deliberately avoid High even when it is available: WhatsApp Web/Desktop
            // re-encodes every upload through a cut-down bundled transcoder that can't
            // decode High profile, so a High-profile clip "can't be sent" there even
            // though it plays fine everywhere else. Baseline/Main cost negligible quality
            // on a thin-line render and are universally decodable.
            // contentHint 'detail' asks the encoder to preserve spatial detail - the
            // render is all thin lines - and is ignored where unsupported.
            const base = { width: W, height: H, bitrate: clipRate(W, H), framerate: fps, contentHint: 'detail' };
            let cfgEnc = null;
            for (const prof of ['avc1.42e0', 'avc1.4d40', 'avc1.6400']) {
              const cand = { ...base, codec: prof + clipLevel(W, H), avc: { format: 'avc' } };
              const sup = await VideoEncoder.isConfigSupported(cand).catch(() => null);
              if (sup && sup.supported) { cfgEnc = cand; break; }
            }
            // Three-tier strategy, decided by probing one real-size frame up front
            // (a failure would otherwise only surface at finalize, after the render):
            //  1. The encoder attaches decoderConfig metadata (Chrome/Edge/Safari):
            //     H.264 straight into mp4-muxer.
            //  2. It doesn't (Firefox), but can emit H.264 as Annex B: encode that and
            //     build the MP4 header ourselves from the in-band SPS/PPS - still one
            //     native-speed encode straight to MP4.
            //  3. No usable H.264 at all: render VP9/VP8 into a WebM and let the
            //     finish step convert it to MP4 with ffmpeg.wasm.
            let mp4 = false, annexb = false, probeDesc = null, sps = null, pps = null;
            if (cfgEnc) {
              let gotCfg = false;
              const probe = new VideoEncoder({ output: (pc, pm) => { if (pm && pm.decoderConfig && pm.decoderConfig.description) { gotCfg = true; probeDesc = pm.decoderConfig; } }, error: () => {} });
              try {
                probe.configure(cfgEnc);
                const pf = new VideoFrame(comp, { timestamp: 0, duration: Math.round(1e6 / fps) });
                probe.encode(pf, { keyFrame: true }); pf.close();
                await probe.flush();
              } catch (_) { gotCfg = false; }
              try { if (probe.state !== 'closed') probe.close(); } catch (_) {}
              mp4 = gotCfg;
            }
            if (!mp4 && cfgEnc) {
              // OpenH264 (Firefox) is a notch below the other native encoders at equal
              // bitrate, and this is the final output - pay it back with bitrate.
              const cfgAB = { ...cfgEnc, bitrate: Math.round(clipRate(W, H) * 1.5), avc: { format: 'annexb' } };
              const sup = await VideoEncoder.isConfigSupported(cfgAB).catch(() => null);
              if (sup && sup.supported) {
                const probe = new VideoEncoder({
                  output: (pc) => {
                    const d = new Uint8Array(pc.byteLength); pc.copyTo(d);
                    for (const nal of splitAnnexB(d)) { const t = nal[0] & 31; if (t === 7 && !sps) sps = nal.slice(); else if (t === 8 && !pps) pps = nal.slice(); }
                  },
                  error: () => {},
                });
                try {
                  probe.configure(cfgAB);
                  const pf = new VideoFrame(comp, { timestamp: 0, duration: Math.round(1e6 / fps) });
                  probe.encode(pf, { keyFrame: true }); pf.close();
                  await probe.flush();
                } catch (_) { sps = pps = null; }
                try { if (probe.state !== 'closed') probe.close(); } catch (_) {}
                if (sps && pps) { annexb = true; cfgEnc = cfgAB; }
              }
            }
            if (!mp4 && !annexb) {
              // latencyMode 'realtime' disables the VPx encoder's frame lookahead
              // (altref) - the source of Firefox's dropped first frame and out-of-order
              // chunks, which either break the muxer or, reordered, decode as shaky
              // geometry. Realtime rate control is less efficient, so pay it back with
              // a higher bitrate; ffmpeg re-encodes to H.264 afterwards anyway.
              cfgEnc = null;
              for (const vc of ['vp09.00.10.08', 'vp8']) {
                const cand = { ...base, codec: vc, latencyMode: 'realtime', bitrate: Math.round(clipRate(W, H) * 1.5) };
                const sup = await VideoEncoder.isConfigSupported(cand).catch(() => null);
                if (sup && sup.supported) { cfgEnc = cand; break; }
              }
              if (!cfgEnc) throw new Error('this browser cannot encode video');
            }
            const isMp4 = mp4 || annexb;   // H.264 into the MP4 container, direct or rebuilt
            const { Muxer, ArrayBufferTarget } = await import(isMp4 ? '../../vendor/mp4-muxer.min.mjs' : '../../vendor/webm-muxer.min.mjs');
            const target = new ArrayBufferTarget();
            // firstTimestampBehavior 'offset': Firefox's encoder can drop or time-shift
            // the first frame, so the first chunk arrives stamped one frame in and a
            // strict muxer rejects the whole clip; offsetting re-bases every timestamp
            // so the first is 0. A no-op where the encoder behaves (first chunk at 0).
            const muxer = isMp4
              ? new Muxer({ target, video: { codec: 'avc', width: W, height: H, frameRate: fps }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' })
              : new Muxer({ target, video: { codec: cfgEnc.codec === 'vp8' ? 'V_VP8' : 'V_VP9', width: W, height: H, frameRate: fps }, firstTimestampBehavior: 'offset' });
            // Buffer every encoded chunk and mux only after the encode completes:
            // Firefox's encoder can drop the first frame AND deliver chunks with
            // shifted or pairwise-swapped timestamps, which the strictly-ordered
            // muxers reject mid-stream. The mux loop below re-stamps chunks from
            // their arrival index, which needs the full set first.
            const chunks = [];
            encoder = new VideoEncoder({ output: (c, m) => { chunks.push([c, m]); }, error: (e) => { encErr = e; } });
            encoder.configure(cfgEnc);
            viewer.setSpin(false);
            arm();
            const yaw0 = viewer.state.yaw;
            let lastYield = performance.now();
            for (let i = 0; i <= NF; i++) {
              if (cancelled || encErr) break;
              if (!viewer.wrap.isConnected) { cancelled = true; break; }
              if (viewer.canvas !== curCanvas) arm();
              // Piecewise timeline: rush moves 0..g0 through the introF lead-in frames, then
              // play g0..G over the main N frames, then hold at G through the tail. `t` (the
              // overlay's build-progress fraction) tracks the true move position, not the frame.
              let gi;
              if (i < introF) gi = introF ? (i / introF) * g0 : 0;
              else gi = g0 + Math.min(1, (i - introF) / N) * (G - g0);
              const t = G ? gi / G : 1;
              const mainEnd = introF + N;   // first tail frame index
              applyGlobal(gi);
              // Once the build is finished and the clip is just holding + spinning on the
              // completed part (the CLIP_TAIL_S tail, i >= mainEnd), bring "Dim other tools"
              // back to full brightness so the whole model shows fully lit for the beauty
              // spin - but ease it in, ramping the dimmed tools' alpha from 0.22 up to 1
              // over the first tail second (smooth fade-back) instead of a hard snap. Once
              // the fade completes, drop isoTool entirely so the remaining tail draws in the
              // single fully-lit pass; checked every tail frame so a mid-render arm() (MSAA
              // swap) re-enabling dim can't stick. Reverted via `saved` after the render.
              if (i >= mainEnd && viewer.state.isoTool) {
                const fadeP = Math.min(1, (i - mainEnd) / Math.max(1, fps));   // 0..1 over the first tail second
                if (fadeP >= 1) { viewer.state.isoTool = false; viewer.state.isoAlpha = 0.22; }
                else viewer.state.isoAlpha = 0.22 + (1 - 0.22) * (fadeP * fadeP * (3 - 2 * fadeP));   // smoothstep
              }
              // Deterministic orbit at the live spin's feel (0.18 rad/s of clip time),
              // running on the frame clock so it carries on through the tail.
              if (clipCfg.orbit) { viewer.state.yaw = yaw0 + (i / fps) * 0.18; viewer.markDirty(); }
              viewer.draw();
              ctx.drawImage(viewer.canvas, 0, 0, W, H);
              drawClipOverlay(ctx, W, H, t, clipCfg.overlay);   // tag always; info chip if toggled
              const vf = new VideoFrame(comp, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
              encoder.encode(vf, { keyFrame: i % (fps * 2) === 0 });
              vf.close();
              // Backpressure (don't let raw frames pile up in the encoder), then yield
              // to the page only every ~14ms of render work - not per frame - so the
              // export runs as fast as the encoder allows instead of one frame per
              // screen refresh (a 60fps clip would otherwise render in real time; the
              // letterboxed preview simply skips frames). rAF stalls in a background
              // tab, so fall back to a timeout there and keep rendering.
              while (encoder.encodeQueueSize > 8 && !encErr) await new Promise((r) => setTimeout(r, 4));
              if (performance.now() - lastYield > 14) {
                statTxt.textContent = 'Rendering clip… ' + Math.round(i / NF * 100) + '%';
                await new Promise((r) => (document.hidden ? setTimeout(r, 0) : requestAnimationFrame(r)));
                lastYield = performance.now();
              }
            }
            if (encErr) throw encErr;
            if (!cancelled) {
              statTxt.textContent = 'Encoding…';
              await encoder.flush();
              // Mux in ARRIVAL order - that is decode order, and reordering it (e.g.
              // sorting by timestamp) breaks the frames' prediction chain and decodes
              // as shaking geometry. None of our encoder configs reorder frames, so
              // arrival order IS display order too - and Firefox stamps chunks
              // unreliably on EVERY path (shifted or pairwise-swapped; trusted, that
              // either halved the frame rate or bounced the muxer). We generated the
              // frames at exact intervals, so ignore the encoder's timestamps
              // entirely and re-stamp each chunk from its arrival index. A no-op for
              // encoders that behave (their stamps already equal the re-stamp).
              // What actually happened, for diagnosing per-browser encoder quirks: the
              // path taken and whether the encoder returned one chunk per frame.
              console.info('[analyser] clip export: path=' + (mp4 ? 'h264-direct' : annexb ? 'h264-annexb' : cfgEnc.codec + '-webm')
                + ', frames=' + (NF + 1) + ', chunks=' + chunks.length
                + (chunks.length < NF + 1 ? ' (encoder skipped ' + (NF + 1 - chunks.length) + ')' : ''));
              let haveCfg = false, nOut = 0;
              for (const [c, m] of chunks) {
                const d = new Uint8Array(c.byteLength); c.copyTo(d);
                const ts = Math.round(nOut * 1e6 / fps), du = Math.round(1e6 / fps);
                nOut++;
                if (isMp4) {
                  // MP4 needs the avcC header with the first sample: Annex B builds
                  // it from the probe's SPS/PPS (and converts each chunk to
                  // length-prefixed samples); the direct path takes the streaming
                  // chunk's own decoderConfig, falling back to the probe's copy
                  // (some encoders only attach it once, at flush).
                  let meta;
                  if (!haveCfg) {
                    if (annexb) {
                      meta = { decoderConfig: { codec: cfgEnc.codec, description: buildAvcC(sps, pps) } };
                    } else {
                      // The streaming chunk's own decoderConfig, else the probe's copy
                      // (some encoders only attach it once, at flush). Sanitised, because
                      // Media Foundation hands back a malformed avcC (duplicated NAL
                      // headers) that strict players like WhatsApp reject.
                      const raw = (m && m.decoderConfig && m.decoderConfig.description) ? m.decoderConfig : probeDesc;
                      meta = { decoderConfig: { ...raw, description: sanitizeAvcC(raw.description) } };
                    }
                    haveCfg = true;
                  }
                  muxer.addVideoChunkRaw(annexb ? annexbToAvcc(d) : stripInbandNals(d), c.type, ts, du, meta);
                } else {
                  muxer.addVideoChunkRaw(d, c.type, ts, du, m);
                }
              }
              muxer.finalize();
              let bytes = target.buffer, ext = 'mp4', mime = 'video/mp4';
              if (!isMp4) {
                // The fallback render produced VP9/VP8 in a WebM (the browser couldn't
                // hand the muxer MP4-ready H.264 - Firefox). Convert it to a real
                // H.264 MP4 with the shared ffmpeg.wasm so every browser ends up with
                // the same file type. Slow (software x264), but it's one bounded pass
                // with live progress; if ffmpeg can't load or is cancelled/crashes,
                // fall back to downloading the WebM itself.
                let ffMod = null, ff = null, onProg = null;
                try {
                  statTxt.textContent = 'Converting to MP4…';
                  ffMod = await import('./video.js');
                  ff = await ffMod.loadFFmpeg();
                  const killOnCancel = () => { try { ffMod.killFFmpeg(); } catch (_) {} };
                  statCancel.addEventListener('click', killOnCancel);
                  onProg = (ev) => { const p = ev && ev.progress; if (p > 0 && p <= 1) statTxt.textContent = 'Converting to MP4… ' + Math.round(p * 100) + '%'; };
                  if (ff.on) ff.on('progress', onProg);
                  await ff.writeFile('clip.webm', new Uint8Array(target.buffer));
                  await ff.exec(['-i', 'clip.webm', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'clip.mp4']);
                  const out = await ff.readFile('clip.mp4');
                  await ff.deleteFile('clip.webm').catch(() => {});
                  await ff.deleteFile('clip.mp4').catch(() => {});
                  statCancel.removeEventListener('click', killOnCancel);
                  bytes = out.buffer || out;
                } catch (_) {
                  ext = 'webm'; mime = 'video/webm';   // the WebM is still a good clip
                } finally {
                  if (ff && ff.off && onProg) { try { ff.off('progress', onProg); } catch (_) {} }
                }
              }
              if (!cancelled) {
                // Name: "<source>-clip-HH-MM-SS.<ext>" with a local time-of-day stamp
                // so repeat exports don't collide, and every space collapsed to an
                // underscore for a clean, shell-friendly file name.
                const now = new Date(), p2 = (n) => String(n).padStart(2, '0');
                const stamp = p2(now.getHours()) + '-' + p2(now.getMinutes()) + '-' + p2(now.getSeconds());
                const clipName = (file.name.replace(/\.[^.]+$/, '') + '-clip-' + stamp + '.' + ext).replace(/\s+/g, '_');
                downloadBlob(clipName, new Blob([bytes], { type: mime }));
              }
            }
          } catch (e) {
            failed = true;
            statCancel.remove();
            statTxt.textContent = 'Clip export failed - ' + ((e && e.message) || e);
            setTimeout(() => statBox.remove(), 4000);
          } finally {
            try { if (encoder && encoder.state !== 'closed') encoder.close(); } catch (_) {}
            if (!failed) statBox.remove();
            const v = viewer;
            v.canvas.style.pointerEvents = '';
            v.setExportSize(0, 0);
            Object.assign(v.state, saved);
            v.setSpin(savedSpin);
            v.state.isoNoFade = false;   // re-enable live tool-change crossfades
            v.state.isoFadeT = 1; v.state.isoFadeTool = null; v.state.isoCurTool = v.state.isoTool ? (v.state.headToolRaw | 0) : null;
            scrubTo(savedPos);
            playBtn.disabled = false; progSlider.disabled = false;
            clipBusy = false; clipBtn.disabled = false;
          }
        }

        // The pre-render settings popup (the .anr-modal idiom, like the spectrogram
        // PNG save): segmented preset rows + option toggles reading/writing clipCfg,
        // with a live size estimate. Parked on the fullscreen element when one is
        // active - document.body is hidden behind it.
        const openClipPopup = () => {
          // Re-seed the scene/projection toggles from the live viewer each open, so the
          // panel reflects whatever the user last set in the normal viewer.
          for (const m of SCENE_MIRROR) clipCfg[m.cfg] = m.get(viewer.state);
          const paints = [];
          const repaint = () => paints.forEach((p) => p());
          const segRow = (label, pairs, get, set) => {
            const box = el('div', { class: 'anr-clip-opts' });
            for (const [val, lab] of pairs) {
              const b = el('button', { type: 'button', class: 'anr-btn anr-clip-opt' }, lab);
              b.addEventListener('click', () => { set(val); repaint(); });
              paints.push(() => b.classList.toggle('is-active', get() === val));
              box.appendChild(b);
            }
            return el('div', { class: 'anr-clip-row' }, [el('span', { class: 'anr-clip-lab' }, label), box]);
          };
          // defs: [key, label, title, off?]. A truthy `off` string disables the toggle
          // and shows that reason as its tooltip (e.g. a file with no travel moves).
          const togRow = (defs) => {
            const box = el('div', { class: 'anr-clip-opts' });
            for (const [key, lab, title, off] of defs) {
              const b = el('button', { type: 'button', class: 'anr-btn anr-clip-opt', title: off || title }, lab);
              if (off) b.disabled = true;
              else b.addEventListener('click', () => { clipCfg[key] = !clipCfg[key]; repaint(); });
              paints.push(() => b.classList.toggle('is-active', !!clipCfg[key]));
              box.appendChild(b);
            }
            // No label column: the section header above stands in for it, so the
            // toggles sit flush under it.
            return el('div', { class: 'anr-clip-row' }, [box]);
          };
          // Clip length can be set three ways, all feeding clipCfg.dur: time presets
          // (Length), lines-per-second presets (Speed), or the custom time / lines-per-
          // second fields. "Lines" = the G-code move count the build steps through (G),
          // so lines/s is just G / duration and the animation reveals them uniformly.
          const DUR_MIN = 0.5, DUR_MAX = 600;
          const setDur = (d) => { if (isFinite(d) && d > 0) clipCfg.dur = Math.min(DUR_MAX, Math.max(DUR_MIN, d)); };
          // A labelled number field. get() supplies the shown value; editing commits via
          // set() then repaints (so the paired field updates). The value is left alone
          // while the field has focus, so mid-typing isn't overwritten.
          const numField = (unit, get, set, step) => {
            const inp = el('input', { type: 'number', class: 'anr-clip-num', min: '1', step: step || '1' });
            inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (isFinite(v) && v > 0) set(v); repaint(); });
            paints.push(() => { if (document.activeElement !== inp) inp.value = String(get()); });
            return el('label', { class: 'anr-clip-field' }, [inp, el('span', {}, unit)]);
          };
          const secHead = (t) => el('div', { class: 'anr-clip-sec' }, t);
          const est = el('p', { class: 'anr-clip-est' });
          paints.push(() => {
            const [W, H] = clipDims();
            const mb = clipRate(W, H) * (clipCfg.dur + CLIP_TAIL_S + (clipHasIntro() ? CLIP_INTRO_S : 0)) / 8 / 1e6;
            est.textContent = W + '×' + H + ' · ' + clipCfg.fps + ' fps · ~' + (mb < 9.5 ? mb.toFixed(1) : Math.round(mb)) + ' MB';
          });
          const cancelBtn = el('button', { type: 'button', class: 'anr-modal-btn anr-modal-cancel' }, 'Cancel');
          const okBtn = el('button', { type: 'button', class: 'anr-modal-btn anr-modal-ok' }, 'Render');
          // Corner close button - shown only on mobile, where the panel goes fullscreen
          // (see CSS). Wired to close() below, once it exists.
          const closeX = el('button', { type: 'button', class: 'anr-clip-x', 'aria-label': 'Close' }, '×');
          const card = el('div', { class: 'anr-modal-card anr-clip-card' }, [
            closeX,
            el('p', { class: 'anr-modal-kicker' }, 'Export clip'),
            el('p', { class: 'anr-modal-title' }, 'A short MP4 of the whole build.'),
            secHead('Frame'),
            el('div', { class: 'anr-clip-rows' }, [
              segRow('Duration', [[5, '5s'], [10, '10s'], [20, '20s'], [30, '30s']], () => clipCfg.dur, (v) => { clipCfg.dur = v; }),
              segRow('Speed', [[1000, '1k/s'], [5000, '5k/s'], [10000, '10k/s']], () => Math.round(G / clipCfg.dur), (v) => setDur(G / v)),
              el('div', { class: 'anr-clip-row' }, [
                el('span', { class: 'anr-clip-lab' }, 'Custom'),
                el('div', { class: 'anr-clip-opts anr-clip-opts--fields' }, [
                  numField('s', () => Math.round(clipCfg.dur * 10) / 10, (v) => setDur(v), '0.1'),
                  numField('lines/s', () => Math.round(G / clipCfg.dur), (v) => setDur(G / v), '1'),
                ]),
              ]),
              segRow('Aspect', [['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1']], () => clipCfg.aspect, (v) => { clipCfg.aspect = v; }),
            ]),
            secHead('Output'),
            el('div', { class: 'anr-clip-rows' }, [
              segRow('Resolution', [[720, '720p'], [1080, '1080p']], () => clipCfg.size, (v) => { clipCfg.size = v; }),
              segRow('Rate', [[30, '30 fps'], [60, '60 fps']], () => clipCfg.fps, (v) => { clipCfg.fps = v; }),
              // Bitrate, as bits per pixel-second. Thin-line renders want more than
              // ordinary footage; High is the sensible default, Max for archival crispness.
              segRow('Quality', [[0.12, 'Standard'], [0.18, 'High'], [0.28, 'Max']], () => clipCfg.quality, (v) => { clipCfg.quality = v; }),
            ]),
            secHead('Camera'),
            togRow([
              ['reset', 'Reset view', 'Start the recording from the default home angle instead of the current view'],
              ['persp', 'Perspective', 'Perspective projection - off is orthographic, flat like a technical drawing'],
              ['orbit', 'Orbit camera', 'Circle the model slowly while it builds'],
              ['follow', 'Follow toolhead', 'Keep the camera locked on the toolhead'],
            ]),
            secHead('Scene'),
            togRow([
              ['bed', 'Show bed', 'Draw the printer bed / build plate under the model', data.bed ? '' : 'This file declares no build plate'],
              ['travel', 'Travel moves', 'Show the non-printing travel / rapid moves as faint lines', viewer.hasTravel ? '' : 'This file has no travel moves'],
              ['dim', 'Dim other tools', 'Fade every tool except the one currently printing - the rest go translucent', hasMultiTool ? '' : 'This file only uses one tool'],
              ['overlay', 'Info overlay', 'Stamp the file name, progress and build height on the frames'],
            ]),
            el('div', { class: 'anr-clip-foot' }, [est, el('div', { class: 'anr-modal-actions' }, [cancelBtn, okBtn])]),
          ]);
          const overlay = el('div', { class: 'anr-modal anr-modal--clip', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Export clip' }, card);
          (document.fullscreenElement || document.body).appendChild(overlay);
          repaint();
          let settled = false;
          const close = () => {
            if (settled) return;
            settled = true;
            overlay.classList.remove('is-open');
            setTimeout(() => overlay.remove(), 200);
            document.removeEventListener('keydown', onKey);
          };
          const onKey = (e) => { if (e.key === 'Escape') close(); };
          cancelBtn.addEventListener('click', close);
          closeX.addEventListener('click', close);
          overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
          document.addEventListener('keydown', onKey);
          okBtn.addEventListener('click', () => { close(); renderClip(); });
          requestAnimationFrame(() => overlay.classList.add('is-open'));
        };

        clipBtn = el('button', { type: 'button', class: 'anr-btn', title: 'Render the build as a short MP4 video and download it' }, 'Export clip');
        clipBtn.addEventListener('click', openClipPopup);
      }

      // Toolbar (below the viewer): Play + progress bar on one row (bar stays at Play's
      // height); Speed + Follow + Tool changes on a second row beneath Play; then the Build
      // height slider; then the CNC Tools picker last.
      const playTopRow = el('div', { class: 'anr-gcode-playrow' });
      playTopRow.appendChild(playBtn);
      playTopRow.appendChild(sliderWrap);
      playTopRow.appendChild(progVal);
      // Fullscreen-only (hidden otherwise via CSS): the pinned bottom toolbar starts
      // collapsed to just this play row so the canvas keeps the screen; this button
      // expands / re-collapses the full control set.
      const fsMoreBtn = el('button', { type: 'button', class: 'anr-btn anr-gcode-fsmore', 'aria-expanded': 'false' }, 'More controls');
      const paintFsMore = () => {
        const collapsed = toolbar.classList.contains('is-collapsed');
        fsMoreBtn.textContent = collapsed ? 'More controls' : 'Fewer controls';
        fsMoreBtn.title = collapsed ? 'Show all viewer controls' : 'Collapse the controls back to the play bar';
        fsMoreBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      };
      fsMoreBtn.addEventListener('click', () => { toolbar.classList.toggle('is-collapsed'); paintFsMore(); });
      playTopRow.appendChild(fsMoreBtn);
      const playCtrlRow = el('div', { class: 'anr-gcode-playctrl' });
      playCtrlRow.appendChild(spdWrap);
      playCtrlRow.appendChild(followBtn);
      playCtrlRow.appendChild(markBtn);
      if (clipBtn) playCtrlRow.appendChild(clipBtn);
      const progRow = el('div', { class: 'anr-gcode-slider anr-gcode-player', style: 'flex-direction:column;align-items:stretch;' });
      progRow.appendChild(playTopRow);
      if (hud) progRow.appendChild(hud);                    // live time / layer / tool readout
      progRow.appendChild(playCtrlRow);
      progRow.appendChild(rtWarn);                          // real-time caveat under Speed/Follow
      toolbar.appendChild(progRow);                         // player block (top of the toolbar)
      toolbar.appendChild(heightRow);                       // Build height slider
      if (legend) toolbar.appendChild(legend);              // line-type show/hide under Build height
      if (filRow) toolbar.appendChild(filRow);              // filament show/hide under the line types
      if (toolRow) toolbar.appendChild(toolRow);            // CNC Tools picker under Build height

      // Over-cap escape hatch: when the print was truncated to fit memory, offer to
      // re-parse and redraw the whole thing with the cap lifted (a re-render of this
      // section, with `uncapped`). Hidden once shown in full (capped becomes false).
      if (data.capped && !(opts && opts.uncapped)) {
        const fullBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Show full anyway');
        const capRow = el('div', { class: 'anr-gcode-slider anr-gcode-player' }, [
          el('span', { class: 'anr-gcode-rowlabel' }, 'Capped'),
          fullBtn,
        ]);
        const fullWarn = el('p', { class: 'anr-spd-warn' },
          `Only the first ${data.segCount.toLocaleString()} segments are drawn - this print exceeds the ${SEG_CAP.toLocaleString()}-segment limit tuned to your device's memory. Drawing it in full can use a lot of RAM and may run slowly or, on a constrained device, crash the tab.`);
        fullBtn.addEventListener('click', () => {
          fullBtn.disabled = true; fullBtn.textContent = 'Rebuilding…';
          setTimeout(() => renderGcode(file, resultsEl, { uncapped: true }), 30);
        });
        toolbar.appendChild(capRow);
        toolbar.appendChild(fullWarn);
      }
      viewCard.appendChild(toolbar);

      // Fullscreen targets the viewer's wrap, so the controls that live OUTSIDE it (the
      // view-button row above the viewer and the camera/playback toolbar below it) would be
      // hidden. While fullscreen, reparent both into the wrap as a bottom overlay - view
      // buttons first, then the toolbar - so every control is reachable; move them back on
      // exit. `viewer` is reassigned on the MSAA rebuild, so always read the current wrap.
      // In fullscreen the bottom-right camera stack (+/- pad, scroll zoom, Exit) must
      // ride ON TOP of the pinned toolbar, not be overlapped by it - keep its bottom
      // offset tracking the toolbar's live height (the bar grows and shrinks with
      // More/Fewer controls, legend rows, window size).
      const liftCamBtns = () => {
        const cam = viewer && viewer.wrap.querySelector('.anr-cam');
        if (!cam) return;
        const fs = document.fullscreenElement === viewer.wrap && toolbar.parentNode === viewer.wrap;
        cam.style.bottom = fs ? (toolbar.offsetHeight + 12) + 'px' : '';
      };
      const camRO = window.ResizeObserver ? new ResizeObserver(liftCamBtns) : null;
      document.addEventListener('fullscreenchange', () => {
        const fs = document.fullscreenElement;
        if (fs && viewer && fs === viewer.wrap) {
          toolbar.classList.add('anr-gcode-toolbar--fs');
          toolbar.classList.add('is-collapsed');                               // start slim - the canvas keeps the screen
          paintFsMore();
          toolbar.insertBefore(viewRow, toolbar.firstChild);                   // view buttons read first
          viewer.wrap.appendChild(toolbar);
          if (camRO) camRO.observe(toolbar);
        } else if (toolbar.classList.contains('anr-gcode-toolbar--fs')) {
          toolbar.classList.remove('anr-gcode-toolbar--fs');
          toolbar.classList.remove('is-collapsed');
          if (camRO) camRO.unobserve(toolbar);
          viewCard.insertBefore(viewRow, viewer.wrap);                         // restore view buttons above the viewer
          viewCard.appendChild(toolbar);
        }
        liftCamBtns();
      });

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
  const slicer = detectSlicer(data.headerComments);
  // Ordered by what an end user most wants to know: WHAT it is, then the headline
  // outcome (time / size / material), then the print/job specs, then the machine,
  // then provenance, then toolpath technicals, and finally the raw file metadata.

  // What it is, and the machine it is for.
  tbl.appendChild(rowHelp('Type', isPrint ? '3D print (extrusion)' : 'CNC / laser (no extrusion)', 'Whether the program extrudes material (a 3D print) or only moves a tool/laser (CNC machining or laser cutting).'));
  if (data.printerModel) tbl.appendChild(rowHelp('Printer', data.printerModel, 'The printer/machine profile the file was sliced for, read from the slicer config in the header.'));

  // Headline outcome - the first things you reach for.
  if (data.printTime) tbl.appendChild(rowHelp('Est. print time', data.printTime, 'The print-time estimate the slicer wrote into the file header.'));
  if (data.bbox && isFinite(data.bbox.min[0])) {
    const dx = data.bbox.max[0] - data.bbox.min[0], dy = data.bbox.max[1] - data.bbox.min[1], dz = data.bbox.max[2] - data.bbox.min[2];
    tbl.appendChild(rowHelp(isPrint ? 'Object size' : 'Work size', `${dx.toFixed(1)} × ${dy.toFixed(1)} × ${dz.toFixed(1)} ${u}`, 'The bounding box of all drawn moves - width × depth × height.'));
  }

  if (isPrint) {
    // Material + print specs.
    if (data.extrudeMM) tbl.appendChild(rowHelp('Filament used', `${(data.extrudeMM / 1000).toFixed(2)} m  (${Math.round(data.extrudeMM).toLocaleString()} ${u})`, 'Total length of filament extruded, summed from the E axis.'));
    if (data.layerCount) tbl.appendChild(rowHelp('Layers', data.layerCount.toLocaleString(), 'The number of distinct Z heights at which material was extruded.'));
    if (data.layerHeight) tbl.appendChild(rowHelp('Layer height', data.layerHeight.toFixed(3) + ' ' + u, 'The typical vertical step between layers (median Z gap).'));
    if (data.temps.nozzle) tbl.appendChild(rowHelp('Nozzle temp', data.temps.nozzle + ' °C', 'The hot-end target temperature set in the program (M104/M109).'));
    if (data.temps.bed) tbl.appendChild(rowHelp('Bed temp', data.temps.bed + ' °C', 'The heated-bed target temperature set in the program (M140/M190).'));
    // The build plate it is for.
    if (data.bed) {
      const b = data.bed, bu = data.units;
      tbl.appendChild(rowHelp('Bed size', `${b.w.toFixed(0)} × ${b.d.toFixed(0)}${b.h ? ` × ${b.h.toFixed(0)}` : ''} ${bu}`, 'The printable area (X × Y' + (b.h ? ' × Z height' : '') + ') declared by the slicer profile - drawn as the plate in the viewer.'));
      if (b.type) tbl.appendChild(rowHelp('Build plate', b.type, 'The build-plate / bed surface selected in the slicer (e.g. textured PEI, smooth, glass).'));
    }
    tbl.appendChild(rowHelp('Filament Ø', data.filDia.toFixed(2) + ' mm', 'The filament diameter used to recover extrusion widths (from the file, else 1.75 mm).'));
  } else {
    // CNC / laser job specs.
    const c = data.cnc;
    if (c && c.progNum) tbl.appendChild(rowHelp('Program number', 'O' + c.progNum, 'The program (O) number the CAM post wrote - the job identifier the controller lists.'));
    if (c && c.operations && c.operations.length) tbl.appendChild(rowHelp('Operations', c.operations.length.toLocaleString(), 'The number of named CAM operations (toolpaths) in the program. See the operations table below.'));
    if (data.cutMM) tbl.appendChild(rowHelp('Cut path length', `${(data.cutMM / 1000).toFixed(2)} m  (${Math.round(data.cutMM).toLocaleString()} ${u})`, 'Total length of the cutting (feed) moves.'));
    if (c && c.maxDepth != null && c.maxDepth < 0) tbl.appendChild(rowHelp('Max cut depth', `${c.maxDepth.toFixed(2)} ${u}  (${Math.abs(c.maxDepth).toFixed(2)} ${u} below Z0)`, 'The deepest Z the tool reaches - the lowest point of any move.'));
    if (c) {
      if (c.changes.length) tbl.appendChild(rowHelp('Tool changes', `${c.changes.length.toLocaleString()}  (${c.tools.length} tool${c.tools.length === 1 ? '' : 's'})`, 'Number of M6 tool changes in the program, and how many distinct tools it uses. See the tooling table below.'));
      if (c.spindleMax) tbl.appendChild(rowHelp('Max spindle speed', `${Math.round(c.spindleMax).toLocaleString()} rpm${c.spindleDir ? ' · ' + c.spindleDir : ''}`, 'The highest commanded spindle speed (S), and its direction (M3/M4).'));
      if (c.coolant.length) tbl.appendChild(rowHelp('Coolant', c.coolant.join(', '), 'Coolant modes switched on in the program (M7 mist / M8 flood).'));
      if (c.workOffsets.length) tbl.appendChild(rowHelp('Work offsets', c.workOffsets.join(', '), 'The work-coordinate systems (G54-G59) the program sets - one per fixture/setup.'));
      if (c.optStops) tbl.appendChild(rowHelp('Optional stops', c.optStops.toLocaleString(), 'M1 optional stops - the controller pauses here only if the "optional stop" switch is on.'));
      if (c.progEnd) tbl.appendChild(rowHelp('Program end', c.progEnd, 'How the program signals completion - M2 (end) or M30 (end and rewind).'));
    }
  }

  // Provenance.
  if (slicer) tbl.appendChild(rowHelp(isPrint ? 'Slicer' : 'CAM / sender', slicer, 'The program that generated this G-code, read from the file header.'));
  tbl.appendChild(rowHelp('Units', u === 'mm' ? 'Millimetres (G21)' : 'Inches (G20)', 'The measurement units the coordinates are expressed in.'));

  // Toolpath technicals - for the curious / the viewer's geometry counts.
  tbl.appendChild(rowHelp(isPrint ? 'Extrusion segments' : 'Cutting moves', data.segCount.toLocaleString(), 'The number of drawn segments - the geometry shown in the viewer (arcs are tessellated into segments).'));
  if (data.counts.arc) tbl.appendChild(rowHelp('Arc moves', data.counts.arc.toLocaleString(), 'G2/G3 circular moves, drawn as smooth tessellated arcs.'));
  tbl.appendChild(rowHelp('Travel / rapid moves', data.counts.rapid.toLocaleString(), 'Non-cutting repositioning moves, hidden by default in the viewer.'));
  if (data.feedRange.max) tbl.appendChild(rowHelp('Feedrate range', `${Math.round(data.feedRange.min).toLocaleString()} - ${Math.round(data.feedRange.max).toLocaleString()} ${u}/min`, 'The slowest to fastest commanded feedrate (F) across drawn moves.'));

  // Raw file metadata - least important, kept last.
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`));
  tbl.appendChild(row('Application', 'G-code (3D printing / CNC)'));
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
        el('th', {}, 'Corner / taper'), el('th', {}, 'Z min'), el('th', {}, 'Offset'), el('th', {}, 'Spindle'),
      ]);
      tt.appendChild(head);
      for (const t of cnc.tools) {
        let geom = '';
        if (t.cr != null && t.cr > 0) geom = `R${t.cr} ${u}`;
        else if (t.taper != null) geom = `${t.taper}° taper`;
        else if (t.cr === 0) geom = 'flat';
        // data-label drives the stacked card layout on mobile (CSS ::before),
        // where the table collapses to one labelled block per tool.
        const cells = [
          ['Tool', 'T' + t.n],
          ['Type', t.desc ? titleCase(t.desc) : '-'],
          ['Ø', t.dia != null ? t.dia + ' ' + u : '-'],
          ['Corner / taper', geom || '-'],
          ['Z min', t.zmin != null ? t.zmin + ' ' + u : '-'],
          ['Offset', t.h != null ? 'H' + t.h : '-'],
          ['Spindle', t.rpm != null ? Math.round(t.rpm).toLocaleString() + ' rpm' : '-'],
        ];
        tt.appendChild(el('tr', {}, cells.map(([label, val]) => el('td', { 'data-label': label }, val))));
      }
      tc.appendChild(tt);
    }

    // Operations table: each named CAM toolpath, the tool it runs, and its size. Tools
    // are reused across operations, so this is the real "what the job does" breakdown.
    if (cnc.operations && cnc.operations.length) {
      const ot = el('table', { class: 'anr-readout anr-gcode-tooltable' });
      ot.appendChild(el('tr', {}, [
        el('th', {}, '#'), el('th', {}, 'Operation'), el('th', {}, 'Tool'),
        el('th', {}, 'Moves'), el('th', {}, 'Cut length'), el('th', {}, 'Depth'),
      ]));
      cnc.operations.forEach((o, i) => {
        const cells = [
          ['#', String(i + 1)],
          ['Operation', titleCase(o.name)],
          ['Tool', o.tool != null ? 'T' + o.tool : '-'],
          ['Moves', o.moves ? o.moves.toLocaleString() : '-'],
          ['Cut length', o.cutLen ? (o.cutLen >= 1000 ? (o.cutLen / 1000).toFixed(2) + ' m' : Math.round(o.cutLen).toLocaleString() + ' ' + u) : '-'],
          ['Depth', o.zmin != null && o.zmin < 0 ? o.zmin.toFixed(2) + ' ' + u : '-'],
        ];
        ot.appendChild(el('tr', {}, cells.map(([label, val]) => el('td', { 'data-label': label }, val))));
      });
      const det = el('details', { style: 'margin-top:14px;' });
      if (cnc.operations.length <= 12) det.open = true;   // short list: open by default
      det.appendChild(el('summary', {}, `Operations (${cnc.operations.length.toLocaleString()})`));
      det.appendChild(ot);
      tc.appendChild(det);
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
