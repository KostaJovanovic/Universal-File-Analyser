# EDA/electronics and NLE/VFX projects

Two families: electronics design (PCB projects, SPICE, netlists) and editing/VFX
project files (After Effects, Premiere, Resolve, VEGAS, and interchange timelines).
Renderers: `altium.js`, `kicad.js`, `spice.js`, `ipcnet.js`, `aftereffects.js`,
`premiere.js`, `davinci.js`, `vegas.js`, `sony-rtmd.js`, `timeline.js`. Routing is
by extension (see `docs2/pipeline.md`).

## EDA / electronics

### KiCad projects

**What it does.** Rebuilds a KiCad schematic, board, footprint or symbol as an
interactive vector view - the board renders as a flippable PCB you can inspect.

**How to reach it.** Drop a `.kicad_pcb`/`.kicad_sch`/`.kicad_sym`/`.kicad_mod`/
`.kicad_pro` (and the library tables / footprint cache) - `kicad.js`, `kind:
'kicad'`.

**How to use it.** View the **Board** (with **Top**/**Bottom** and **Flip over**),
its layers, component list, board size/thickness, and the footprint cache; schematics
and symbols render as vector views with wheel-zoom.

### Altium projects

**What it does.** Rebuilds Altium schematic / PCB / footprint geometry from the OLE
compound files as an interactive vector view.

**How to reach it.** Drop a `.schdoc`/`.schlib`/`.pcbdoc`/`.pcblib` (and the `.epw`/
`.prjpcb` sidecars and `*preview` caches) - `altium.js`, `kind: 'altium'`. Boards
show their layers (Top/Bottom overlay etc.) and size; schematics and libraries render
their symbols, with the preview thumbnail when present.

### SPICE waveforms

**What it does.** Plots the waveforms from an ngspice/LTspice `.raw` simulation dump.

**How to reach it.** A `.raw` that sniffs as SPICE (not camera RAW) routes to
`spice.js` (`kind: 'spice'`; the `sniffSpiceRaw` reroute in `app.js`). Reads the
plot name and traces and draws each waveform track.

### IPC netlists

**What it does.** Reads an IPC-D-356(A) bare-board fabrication test netlist.

**How to reach it.** Drop a `.ipc` (`ipcnet.js`, `kind: 'ipcnet'`); lists nets,
components and the board extent.

## NLE / VFX project files

### After Effects

**What it does.** Walks the `.aep` RIFX tree to rebuild each composition's layer
timeline.

**How to reach it.** Drop a `.aep`/`.aet` (`aftereffects.js`, `kind: 'aep'`). Browse
the **Compositions**; each shows its layers on a timeline with **Zoom in/out** /
**Reset zoom**.

### Premiere Pro

**What it does.** Inflates the PremiereData XML and rebuilds each sequence's
track/clip timeline.

**How to reach it.** Drop a `.prproj`/`.prel` (`premiere.js`, `kind: 'premiere'`);
shows sequences, clips & sources with a zoomable timeline.

### DaVinci Resolve

**What it does.** Unzips the SeqContainer XML and rebuilds each timeline's track/clip
layout.

**How to reach it.** Drop a `.drp`/`.drt` (`davinci.js`, `kind: 'davinci'`); shows the
timeline with a zoomable track/clip view.

### VEGAS Pro

**What it does.** Reads the RIFF-GUID container's embedded metadata, plugin ids and
title text.

**How to reach it.** Drop a `.veg`/`.vf` (`vegas.js`, `kind: 'vegas'`).

### Interchange timelines (EDL / FCPXML / OTIO)

**What it does.** Renders a visual track x time timeline with clip blocks from the
standard interchange formats.

**How to reach it.** Drop an `.edl`/`.fcpxml`/`.otio` (`timeline.js`, `kind:
'timeline'`); shows tracks, clips and the sequence.

### Sony rtmd gyro / IMU (cross-reference)

`sony-rtmd.js` decodes the inertial metadata track Sony cameras embed in video and
plots the gyroscope/accelerometer traces, with **Export CSV** and **Export Gyroflow
(.gcsv)**. It is invoked from the video renderer - see `docs2/features/video.md`.
Standalone Gyroflow `.gcsv` logs open via `gcsv.js`.
