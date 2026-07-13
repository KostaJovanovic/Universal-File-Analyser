# EDA and NLE/VFX

Electronics design (Altium, KiCad, SPICE simulation waveforms, IPC
fabrication netlists) and non-linear-editing/VFX project files (After
Effects, Premiere, DaVinci Resolve, VEGAS, editing-interchange timelines,
Sony camera gyro/IMU metadata). Source: `altium.js`, `kicad.js`, `spice.js`,
`ipcnet.js`, `aftereffects.js`, `premiere.js`, `davinci.js`, `vegas.js`,
`sony-rtmd.js`, `timeline.js`.

### Altium Designer viewer (schematic + PCB + libraries)

**What it does.** Altium's native documents (`.SchDoc`/`.SchLib`
schematics, `.PcbDoc`/`.PcbLib` boards+footprints) are OLE2 Compound Files
(the same container as legacy Office) - opened with the shared `cfbf.js`
reader and parsed entirely in the browser. Schematics store primitives as
ASCII length-prefixed records; boards/footprints store them as binary
length-prefixed records (reverse-engineered field offsets, validated
against a real SamacSys footprint). The geometry is rebuilt into an
interactive SVG.

**How to reach it.** Drop a `.SchDoc`/`.SchLib`/`.PcbDoc`/`.PcbLib`/`.epw`
(model wrapper)/`.PrjPcb`/`.PrjPcbStructure`/`.SchDocPreview`/
`.PcbDocPreview`. Built in `altium.js`.

**How to use it.** **Fit** resets the view to fit the viewport; **layer
chips** (per PCB layer) toggle visibility; for multi-sheet schematics,
**tab buttons** switch between sheets; in the BOM, **designator buttons**
(per component) jump to and highlight that part on its schematic sheet.

### KiCad viewer (schematic + PCB + libraries + project)

**What it does.** KiCad's modern documents (versions 6-9) are all
S-expression text: `.kicad_sch` (schematic), `.kicad_pcb` (board),
`.kicad_sym`/`.kicad_mod` (symbol/footprint libraries), plus JSON/text
sidecars (`.kicad_pro`/`.kicad_prl` project settings, `fp-info-cache`,
`.wbk` ngspice workbook). Everything is parsed and drawn as an interactive
SVG; KiCad board space is Y-down (drawn directly), while symbol-library
graphics use Y-up and are flipped when placed. The reference designator
ties a schematic symbol to its board footprint, powering two-way
cross-probing in the project view.

**How to reach it.** Drop a `.kicad_pcb`/`.kicad_sch`/`.kicad_sym`/
`.kicad_mod`/`.kicad_pro`/`.kicad_prl`/`.wbk`, a `-bak` backup of any of
those, or the extensionless `fp-lib-table`/`sym-lib-table`/`fp-info-cache`.
Built in `kicad.js`.

**How to use it.** **Fit**/**Reset view** reset the schematic or 3D view;
**layer chips** toggle PCB layer visibility; **Flip over** flips the 3D
board to the other side; **Quality**/**Supersampling** are render-quality
toggles; **3D board**/**Top**/**Bottom** switch board view mode; the
**symbol select** dropdown previews a specific library symbol/footprint;
**designator buttons** (per BOM row) and **PCB** cross-probe between the
schematic and board views; **tab buttons** switch multi-sheet schematics.

### SPICE/LTspice raw waveform viewer

**What it does.** Decodes the binary or ASCII `.raw` waveform dump written
by ngspice (KiCad's built-in simulator) or LTspice: a header of "Key:
value" lines (ASCII for ngspice, UTF-16LE for LTspice) naming the analysis
type, variables, and point count, followed by the raw sample matrix
(handling LTspice's mixed double+float packing, ngspice's all-double
layout, and complex AC data). A single-point result is tabulated as an
operating point; multi-point data is plotted on an interactive, hoverable
canvas.

**How to reach it.** Drop a `.raw` that content-sniffs as a SPICE dump -
`.raw` collides with camera RAW photos, so `app.js`'s `resolveKind()` calls
`sniffSpiceRaw()` (checking for a `Title:` header, ASCII or UTF-16LE) to
disambiguate before routing here. Built in `spice.js`.

**How to use it.** **Legend chips** (one per simulation trace) toggle that
trace's visibility on the waveform chart.

### IPC-D-356(A) fabrication netlist viewer

**What it does.** A `.ipc` file is the bare-board fabrication/electrical-
test netlist a PCB tool (KiCad, Altium) exports for the fab house - a
fixed-column text format of "P" parameter lines plus one feature record per
test point. Analyser parses the records, summarises the board (nets,
parts, pad/via mix), rebuilds net-to-pin connectivity, and draws a
fabrication map of every test point coloured by net.

**How to reach it.** Drop a `.ipc`. Built in `ipcnet.js`.

**Notes / limits.** No interactive controls beyond the rendered map/readout
- values are converted between IPC's customary units (0.0001 inch) and
mm/inches for display.

### Adobe After Effects project viewer (.aep/.aet)

**What it does.** An `.aep` is a RIFX file (big-endian RIFF, form type
"Egg!") storing the project as nested chunk lists - reverse-engineered
(there's no public spec) to rebuild each composition's timeline: layers,
per-comp time scale, and other project structure.

**How to reach it.** Drop a `.aep`/`.aet`. Built in `aftereffects.js`.

**How to use it.** **Zoom out**/**Zoom in**/**Reset** control the
composition preview canvas (also ctrl+scroll to zoom).

### Adobe Premiere Pro project viewer (.prproj/.prel)

**What it does.** A `.prproj` is a gzip-compressed XML document (the
"PremiereData" model) - once inflated, a graph of cross-referenced objects
(ObjectID local to its class, and/or a globally unique ObjectUID) chained
via ObjectRef/ObjectURef references, walked to rebuild each sequence's
track/clip timeline.

**How to reach it.** Drop a `.prproj`/`.prel`. Built in `premiere.js`.

**How to use it.** **Zoom out**/**Zoom in**/**Reset** control the project
preview canvas.

### DaVinci Resolve project/timeline viewer (.drp/.drt)

**What it does.** A `.drp` is a ZIP archive of XML documents exported from
the Resolve project database. Key entries: `project.xml` (name, versions,
dates), `SeqContainer/<uuid>.xml` per timeline (VideoTrackVec/AudioTrackVec
- the actual track/clip layout), plus colour-grade node-chip data for each
clip's node graph.

**How to reach it.** Drop a `.drp`/`.drt`. Built in `davinci.js`.

**How to use it.** **Zoom out**/**Zoom in**/**Reset** control the
resource/timeline preview canvas; colour-grade node chips (styled pill
tags) show each clip's node graph inline.

### Sony/MAGIX VEGAS Pro project viewer (.veg/.vf)

**What it does.** A `.veg` is a Sonic Foundry "RIFF GUID" container (magic
lowercase `riff` + a 16-byte form GUID with classic Sonic Foundry COM class
IDs), with nested chunks keyed by undocumented GUIDs - so a faithful
timeline rebuild isn't reliable, but a great deal is plainly recoverable
and extracted instead: the authoring app+version (an embedded AppData
path), the project summary block (author/title/company/copyright/contact,
stored as UTF-16LE string runs), every media generator and video FX used
(by plugin id and friendly name, e.g. `{Svfx:...:titlesandtext}` ->
"Titles & Text"), the actual title/text content (stored as RTF, decoded to
plain text), and source media/template file paths.

**How to reach it.** Drop a `.veg`/`.vf`. Built in `vegas.js`.

**Notes / limits.** Capped at 64MB defensively (`.veg` projects are
normally small). No interactive controls - a structured readout.

### Editing-timeline viewer (EDL/FCPXML/OTIO)

**What it does.** Renders a visual timeline (tracks × time, with clip
blocks) from the standard NLE interchange formats every editor (Premiere,
Final Cut, DaVinci Resolve, Avid) can export: EDL (`.edl`, CMX3600 plain
text), FCPXML (`.fcpxml`, Final Cut Pro X XML), and OTIO (`.otio`,
OpenTimelineIO JSON). All three are normalised into one model - `{ name,
fps, duration, tracks: [{ kind, name, clips: [{name, start, duration,
srcIn}] }] }`, every time value in seconds - so the same viewer draws any
of them.

**How to reach it.** Drop a `.edl`/`.fcpxml`/`.otio`. Built in
`timeline.js`.

**Notes / limits.** EDL timecodes support both drop-frame (`;`) and
non-drop-frame (`:`) notation; FPS is inferred from the timecode format
when not stated explicitly.

### Sony rtmd gyro/IMU extraction

**What it does.** Sony Alpha/FX/RX cameras (A7, A6700, FX3, etc.) write a
timed-metadata track (sample format `rtmd`) to their MP4/MOV files: each
sample (one per video frame) carries that frame's exposure/lens/GPS data
plus a burst of inertial-measurement samples - the gyroscope (angular
rate) and accelerometer used by Catalyst Browse and Gyroflow to stabilise
footage. Analyser parses the TLV-encoded rtmd structure (reverse-engineered,
cross-checked against ExifTool's `Sony.pm Process_rtmd`) to extract and
plot these traces.

**How to reach it.** Automatic for a Sony video with an `rtmd` track (see
also `docs/features/video.md`, which the gyro card is embedded within).
Built in `sony-rtmd.js`.

**How to use it.** **Export CSV** exports the gyro/accelerometer metadata;
**Export Gyroflow (.gcsv)** exports in Gyroflow's stabiliser-ready
interchange format (see `gcsv.js` / `docs/features/data-archive.md`, which
reads that same format back).

**Notes / limits.** Reads via byte-range slices only - never buffers the
whole video. Best-effort throughout: any parse failure returns `null` so
the normal video analysis is unaffected. Accelerometer scale is ~8192
counts per g (Sony's LSB/g); the gyro stays in raw sensor counts (Gyroflow
applies the camera-specific calibration to convert to deg/s). Sample
reading is capped and decimated for very long recordings (`MAX_FRAMES`).
