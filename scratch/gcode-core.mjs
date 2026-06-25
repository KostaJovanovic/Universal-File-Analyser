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
const PAUSE_CAP_S = 5;            // max hold for any single pause (playback seconds)
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

export { parseGcode };
