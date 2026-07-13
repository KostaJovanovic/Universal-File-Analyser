# Design, CAD, 3D and manufacturing

Vector/raster design files, colour LUTs, fonts, 3D models, G-code toolpaths, Unity
assets, and CAD. Renderers: `svg.js`, `illustrator.js`, `psd.js`, `paint.js`,
`diagram.js`, `lut.js`, `font.js`, `stl.js`, `model3d.js`, `gcode.js`, `unity.js`,
`dwg.js`, `solidworks.js`, `f3d.js`. Routing is by extension (see
`docs2/pipeline.md`).

## Vector, raster and design files

### SVG

**What it does.** Renders the SVG at actual size and reports stats, element counts
and a colour palette.

**How to reach it.** Drop a `.svg` (`svg.js`, `kind: 'svg'`).

### Illustrator (.ai)

**What it does.** Renders modern (v9+) PDF-compatible Illustrator artwork page by
page and reads metadata; older EPS-based `.ai` is identified from its header.

**How to reach it.** Drop a `.ai` (`illustrator.js`, which reuses `pdf.js`).

### Photoshop (PSD/PSB)

**What it does.** Shows the flattened composite plus the full layer tree - per-layer
name, blend mode, opacity, visibility and thumbnail - and reads canvas size, colour
mode and bit depth.

**How to reach it.** Drop a `.psd`/`.psb` (`psd.js`, ag-psd). **Download this layer
as a PNG** exports a layer. Files saved without a composite show their layers instead.

### Raster painting (Krita / Procreate / Paint.NET)

**What it does.** Shows the flattened preview baked into the file, with canvas size,
layer count and app version.

**How to reach it.** Drop a `.kra`/`.procreate`/`.pdn` (`paint.js`, `kind: 'paint'`).

**Notes / limits.** Per-layer artwork is in a private format, so the embedded preview
is the faithful render.

### Diagrams (draw.io / DXF)

**What it does.** Renders 2D vector diagrams.

**How to reach it.** Drop a `.drawio` or `.dxf` (`diagram.js`).

### Colour LUTs (.cube / .look)

**What it does.** Visualises exactly what a LUT does: the neutral tone-response
curve, a before/after of a hue x brightness chart and memory colours, and an
interactive 3D scatter of the colour cube. Reads title, grid size and domain.

**How to reach it.** Drop a `.cube` or `.look` (`lut.js`, `kind: 'lut'`). **Choose
photo or video** applies the LUT to your own media. A `.look` is read as the
SpeedGrade grade stack with its baked LUT visualised the same way.

**Notes / limits.** A Gaussian volumetric `.cube` is detected and identified
separately (see `EXT_VARIANTS`).

### Fonts

**What it does.** A live FontFace specimen plus an opentype.js glyph grid.

**How to reach it.** Drop a `.ttf`/`.otf`/`.woff`/`.woff2`/`.ttc`/`.otc`
(`font.js`); the **Glyphs** grid draws every glyph outline.

## 3D models and manufacturing

### STL viewer

**What it does.** An interactive WebGL viewer for binary/ASCII STL.

**How to reach it.** Drop a `.stl` (`stl.js`).

**How to use it.** Orbit/zoom; toggles for **Wireframe**, **Orthographic** vs
perspective, **Realistic view**, **Model colour**, **Flip which axis points up**,
scroll-zoom on/off, an orientation **cube**, **Reset view** and **Fullscreen**.
Reads triangle count, bounding box, surface area and volume.

### Model viewer (OBJ / PLY / OFF / glTF / GLB / 3MF / AMF / STEP / IGES / BREP / FBX)

**What it does.** A WebGL viewer for native meshes and B-rep CAD. glTF/GLB scenes
are parsed natively (node graph, meshes, materials, animations); STEP/IGES/BREP are
tessellated with OpenCASCADE (STEP reports the CAD system, version and AP protocol);
3MF/AMF let you inspect each model/assembly on the build plate.

**How to reach it.** Drop any of those extensions (`model3d.js`, `kind: 'model3d'`).
Controls mirror the STL viewer (orbit, wireframe, orthographic, view cube, reset).
Material cards show colours/textures; MTL libraries break out each material.

**Notes / limits.** STEP/IGES/BREP need the OpenCASCADE WASM (Everything tier).

### G-code toolpath viewer

**What it does.** Reconstructs the printed object from the extruded toolpath (3D-print
slicers) - or the cutting path for CNC/laser - as solid deposited filament, animates
the build layer by layer, and can export a shareable video clip.

**How to reach it.** Drop a `.gcode`/`.gco`/`.g`/`.ngc`/`.nc`/`.tap`/`.cnc`
(`gcode.js`, `kind: 'gcode'`).

**How to use it.** Controls include **Play** the build (start to finish, or circle
the model slowly while it builds), **Playback speed** (incl. custom rate), **Colour
by** (feature type / speed / filament), a per-**Layer** scrubber, **Realistic view**,
**Orbit camera**, **Orthographic**, **Reset view**, **Fullscreen**, and **Export
clip** (a short MP4 of the whole build). Reads estimated print time, filament used,
build height, extrusion segments, filament changes and (for CNC) max spindle speed.

**Notes / limits.** Clip export uses the mp4/webm muxers (in the offline tiers).

### Unity assets

**What it does.** Reads Unity's YAML object stream (scenes, prefabs, animator
controllers, animations, materials, `.meta` importer records).

**How to reach it.** Drop any `UNITY_EXTS` file (`unity.js`, `kind: 'unity'`). Falls
back to identification if the bytes aren't Unity YAML (protects collisions like
MATLAB `.mat`).

## CAD

### AutoCAD DWG

**What it does.** Parses and renders a DWG/DWT as a 2D drawing.

**How to reach it.** Drop a `.dwg`/`.dwt` (`dwg.js`, libredwg-web; Everything tier).

### SolidWorks

**What it does.** For older (pre-2015) OLE2 files, reads the saved preview thumbnail
and document metadata; modern encrypted files are identified with an honest note.

**How to reach it.** Drop a `.sldprt`/`.sldasm`/`.slddrw` (`solidworks.js`).

**Notes / limits.** Identify-only for encrypted modern files; the editable Parasolid
geometry stays proprietary either way - export to STEP/STL/3MF for the 3D viewer.

### Fusion 360

**What it does.** Reads what an `.f3d`/`.f3z` package holds - document type, Fusion
version, solid-body and appearance-asset counts - and shows the render preview.

**How to reach it.** Drop a `.f3d`/`.f3z` (`f3d.js`, a Zstd ZIP read with fzstd).

**Notes / limits.** The editable geometry is Autodesk ShapeManager BREP, which cannot
be rebuilt in-browser; export to STL/OBJ/STEP/3MF for the full 3D viewer.
