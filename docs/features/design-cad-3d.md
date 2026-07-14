# Design, CAD and 3D

Vector/raster design formats, colour LUTs, fonts, 3D model viewers,
G-code/CNC toolpath reconstruction, Unity assets, and CAD formats (DWG,
STEP/IGES, SolidWorks, Fusion 360). Source: `svg.js`, `illustrator.js`,
`psd.js`, `paint.js`, `diagram.js`, `lut.js`, `font.js`, `stl.js`,
`model3d.js`, `gcode.js`, `unity.js`, `dwg.js`, `solidworks.js`, `f3d.js`.

### SVG inspector

**What it does.** Renders an SVG at actual size and reports stats, element
counts, colour palette, and text content.

**How to reach it.** Drop a `.svg`. Built in `svg.js`.

**How to use it.** Click **Analyse as image** to rasterise the SVG to PNG
and run it through the full photo analysis pipeline.

**Notes / limits.** Before rendering, `sanitizeSvg()` strips active/unsafe
content: `<script>`, `<foreignObject>` (embedded HTML), `<style>` (inline
CSS is unscoped when injected and can pull remote resources/inject
document-wide styling), SMIL animation elements (can rewrite an `href` to
`javascript:` at runtime), every `on*` event-handler attribute,
`javascript:` links, and external/remote references (`http(s)://`,
`data:text/html`, remote CSS `url()`/`@import`). Findings are reported.
`sanitizeSvgMarkup()` is exported and reused by `dwg.js` so any
parser-produced SVG (e.g. LibreDWG's output) gets the identical allow-list
rather than a weaker ad hoc filter.

### Illustrator (.ai)

**What it does.** Since Illustrator 9 (2000), `.ai` files are
PDF-compatible - the artwork is a PDF stream with Illustrator's private
data alongside it - so a modern `.ai` opens directly in the full PDF viewer
(pages, text, embedded images, metadata, OCR, and every other PDF control -
see [`documents.md`](documents.md)).

**How to reach it.** Drop a `.ai`. Built in `illustrator.js`.

**Notes / limits.** Older EPS/PostScript-based `.ai` files aren't PDF, so
they fall back to `proprietary.js`'s identifier (reads the PostScript
header: creator, bounding box, etc.).

### Photoshop (PSD/PSB)

**What it does.** Two paths depending on what the file actually is: (1) a
lightweight header read (first few MB only, memory-safe even for
huge/CMYK/16-bit/PSB files) parses dimensions, colour mode, bit depth,
channel count, and pulls the embedded RGB thumbnail Photoshop bakes into
the image-resources block; (2) for RGB/Grayscale 8-bit PSDs under a size
cap (120MB), the vendored **ag-psd** additionally decodes the full
composite image and the complete layer tree (names, blend modes, opacity,
visibility, per-layer thumbnails).

**How to reach it.** Drop a `.psd`/`.psb`. Built in `psd.js`.

**How to use it.** Click **Analyse this image** on the composite (or an
embedded-preview variant) to send it through the photo pipeline. Each
listed **layer** has a **PNG** button to download that layer alone.

**Notes / limits.** ag-psd doesn't support CMYK/Lab/16-bit/PSB and
recomposites nothing for those - Analyser falls back to the embedded
thumbnail from path 1 rather than failing.

### Raster painting apps (Krita/Procreate)

**What it does.** Both `.kra` (Krita) and Procreate files are ZIP packages
that bake in a flattened raster preview: Krita's `mergedimage.png` (full
resolution) plus `maindoc.xml` (canvas dimensions, colour space, layer
count, Krita version); Procreate's `QuickLook/Thumbnail.png` (capped size) -
the real per-layer artwork is private chunked data that can't be recomposed
in either case.

**How to reach it.** Drop a `.kra`/`.procreate`. Built in `paint.js`.

**How to use it.** Click **Analyse this image** on the shown preview to run
it through the photo pipeline.

**Notes / limits.** GIMP `.xcf` is not a ZIP and has no embedded preview,
so it stays identification-only (via `proprietary.js`), not handled here.

### 2D vector diagrams (draw.io/DXF)

**What it does.** Two vector formats rendered as real SVG previews rather
than just identified: draw.io/diagrams.net `.drawio` (decodes the
`<mxGraphModel>`, inline or deflate+base64-compressed, and draws its boxes/
ellipses/diamonds/edges); AutoCAD DXF `.dxf` (ASCII group-code entity list -
parses the `ENTITIES` section: LINE, CIRCLE, ARC, LWPOLYLINE, POLYLINE,
TEXT - drawn to SVG with Y flipped so the drawing reads right-way-up).

**How to reach it.** Drop a `.drawio` or a (text/ASCII) `.dxf`. Built in
`diagram.js`.

**Notes / limits.** Both degrade to a clear message (rather than an error)
if the file can't be drawn - e.g. a binary DXF or an empty model - and
always show raw entity/cell counts regardless.

### Colour LUT (.cube) viewer and visualiser

**What it does.** Parses an Adobe/Iridas/Resolve `.cube` plain-text colour
look-up table (a 3D or 1D LUT mapping every input colour to an output
colour - how a grade's "look" is baked into one file) and visualises it:
the neutral tone-response curve, a before/after of memory colours and a
hue/luma test chart pushed through the LUT, and an interactive 3D scatter
of the colour cube it defines.

**How to reach it.** Drop a `.cube` (or `.look`, an Adobe SpeedGrade/Iridas
grade stack carrying a baked 3D LUT). Built in `lut.js`.

**How to use it.** Click **Choose photo or video** to preview the LUT
applied to your own image/video instead of the built-in test chart.

**Notes / limits.** `.cube` is also used by Gaussian for volumetric DFT
data - `lut.js` sniffs for `LUT_*_SIZE` and hands anything else back to the
generic identifier rather than misreading it as a LUT.

### Font specimen viewer

**What it does.** Two complementary engines: the native `FontFace` API
loads the real font bytes for a live specimen (sample text at several
sizes) - the true rendering, including WOFF2 and variable fonts, with axis
sliders driving `font-variation-settings` live; the vendored **opentype.js**
parses the tables for naming/metadata, glyph count, and draws a grid of
individual glyph outlines (TTF/OTF/WOFF 1.0 - WOFF2 falls back to the live
specimen alone since opentype.js can't parse it).

**How to reach it.** Drop a `.ttf`/`.otf`/`.woff`/`.woff2`/`.ttc`/`.otc`.
Built in `font.js`.

**How to use it.** The specimen auto-detects which scripts the font covers
(by probing its cmap for representative characters across Latin, Japanese,
Korean, Chinese, Cyrillic, Greek, Thai, Devanagari, Arabic, Hebrew) and
shows a native-language pangram-style sample for each one the font
actually supports, rather than boxes of `.notdef` glyphs. Click **Play-all**
to cycle through every glyph. For a font **collection** (`.ttc`/`.otc`),
each member font is unpacked into its own standalone buffer and a
**font-in-collection select** switches which one the specimen and glyph
grid show.

### STL 3D viewer

**What it does.** Parses binary and ASCII STL and renders an interactive,
self-contained WebGL model (no external 3D library) with orbit/zoom/spin,
reporting geometry statistics (triangles, bounding box, surface area,
volume).

**How to reach it.** Drop a `.stl`. Built in `stl.js`. This viewer is also
the shared engine reused by `model3d.js` for every other supported 3D mesh
format.

**How to use it.** **Scroll zoom on/off** toggles whether the mouse wheel
zooms; **Fullscreen** expands the viewer; **Zoom in**/**Zoom out** (hold) for
camera zoom; **Pause spin**/**Resume spin** toggles auto-rotate; **Quality**
opens an anti-aliasing/render-quality popup; **Reset view** returns to the
default camera; **Orthographic**/**Perspective** toggles projection;
**Wireframe** overlays mesh topology (drawn from a per-vertex barycentric
coordinate); **Y-up**/**Z-up** flips which axis is "up" (most CAD/printing
formats author Z-up; design/glTF formats are typically Y-up - the viewer
itself is Y-up, so Z-up geometry gets a view-only -90° rotation about X to
stand it upright); **Part chips** (for a multi-part assembly) switch
between viewing a single part or the whole assembly.

### 3MF / STEP / IGES / OBJ / PLY / glTF / FBX viewer

**What it does.** A 3D model viewer covering multiple mesh and B-rep CAD
formats, all rendered through the shared STL WebGL viewer above. 3MF (a ZIP
of 3D-manufacturing XML) is parsed natively - fflate + regex/DOM - so every
object/assembly on the build plate can be viewed individually, including
the "production extension" (one `.model` file per part referenced by the
root model). STEP/IGES/BREP (B-rep CAD) are tessellated to a mesh by the
lazy-loaded **OpenCASCADE WASM kernel**, with the ISO-10303 header metadata
shown alongside.

**How to reach it.** Drop a `.3mf`/`.amf`/`.obj`/`.ply`/`.off`/`.mtl`/
`.gltf`/`.glb`/`.fbx`/`.step`/`.stp`/`.iges`/`.igs`/`.brep`. Built in
`model3d.js`.

**How to use it.** Inherits the full STL viewer control set (Fit/Reset/
Wireframe/Quality/Zoom/Fullscreen/Y-up-Z-up/spin/part chips - see above).
For a 3MF containing embedded sliced plates, an **Open `<plate>`** button
per plate loads that embedded G-code into the full G-code viewer (see
below); the 3MF's raw ZIP contents are also browsable via the shared
archive view (`renderArchiveEmbedded`).

**Notes / limits.** STEP/IGES tessellation requires downloading the
OpenCASCADE WASM kernel (~9MB) on first use, cached afterward (part of the
"Everything" offline tier, or loaded on demand).

### G-code toolpath viewer and 3D reconstructor

**What it does.** Parses G-code from any source - 3D-printer slicers
(PrusaSlicer, SuperSlicer, OrcaSlicer, Cura, ideaMaker, Bambu Studio,
Simplify3D, Slic3r) and CNC/laser CAM (GRBL, Fanuc, Haas, Mastercam, Fusion
360, LightBurn) - and rebuilds the printed object in an interactive WebGL
viewer. Crucially it renders the **deposited filament** (volumetric
extrusion-width recovery and bead geometry), not just the bare centreline
toolpath.

**How to reach it.** Drop a `.gcode`/`.gco`/`.g`/`.ngc`/`.nc`/`.tap`/`.cnc`.
Built in `gcode.js`. Also reachable via `model3d.js`'s **Open `<plate>`**
button for G-code embedded in a sliced 3MF.

**How to use it.** Viewer camera controls mirror the STL viewer (scroll
zoom toggle, fullscreen, zoom in/out, pause/resume spin, reset view,
orthographic/perspective, Quality popup with Hardware MSAA/Supersampling/
minimum-line-width toggles). G-code-specific controls: **Colour by**
(select what colours the toolpath - line type or tool), **Show/Hide
legend** (the colour-key overlay), **Travel**/**Rapids**/**Bed** and
per-feature/per-tool **colour chips** (visibility toggles), **Play** (plays
the build animation), **Follow toolhead** (cycling camera-follow modes),
**Speed** (a popup of playback-speed presets, a custom rate with a
lines/s-vs-duration unit toggle, and a "Real time" option), **Tool
changes** (toggles tool-change tick marks) and **Dim other tools** (fades
every tool but the currently-printing one). **Export clip** (with **Cancel**
and per-export option chips) renders the build animation to a downloadable
MP4 clip using the browser's WebCodecs API, muxed via **mp4-muxer** (or, on
browsers without MP4-ready H.264 output like Firefox, rendered to WebM via
**webm-muxer** and converted to MP4 by ffmpeg.wasm). **More controls**
expands/collapses the fullscreen toolbar. For very large files, **Show
full anyway**/**Show all N lines** bypasses a line cap on the raw G-code
listing.

**Notes / limits.** The volumetric extrusion-width recovery and bead
geometry approach was informed by studying OrcaSlicer's open-source
GCodeProcessor (not bundled or used as a dependency), per the repo root
`README.md`.

### Unity asset viewer

**What it does.** Unity serialises almost everything as a small YAML
dialect (a `%YAML 1.1` / `%TAG !u!...` preamble, then one document per
object headed by `--- !u!<classID> &<fileID>`). Rather than a full YAML
parser, this splits on document headers, reads each object's class name,
and pulls the handful of fields that matter per type (names, friction,
sample rate, importer + GUID, etc.) - for a scene or prefab that gives a
component histogram and the list of named GameObjects, effectively a
lightweight scene inspector. A `.meta` file is handled separately as a
single plain-YAML importer record.

**How to reach it.** Drop a `.unity`/`.prefab`/`.asset`/`.controller`/
`.overridecontroller`/`.anim`/`.mat`/`.physicsmaterial2d`/
`.physicmaterial`/`.spriteatlas`/`.cubemap`/`.rendertexture`/`.mixer`/
`.guiskin`/`.fontsettings`/`.flare`/`.brush`/`.terrainlayer`/`.signal`/
`.preset`/`.mask`/`.playable`/`.lighting`/`.giparams`/`.meta`. Built in
`unity.js`.

**Notes / limits.** Files over 48MB are not processed (identification
only, per the module's `MAX_BYTES` cap).

### AutoCAD DWG viewer

**What it does.** DWG is AutoCAD's native binary drawing format. Uses the
vendored **libredwg-web** (LibreDWG compiled to WebAssembly, ~6MB,
lazy-loaded) to parse the drawing into an entity database and render it to
an SVG 2D preview - the binary-format counterpart to the DXF viewer above.

**How to reach it.** Drop a `.dwg`/`.dwt`. Built in `dwg.js`.

**Notes / limits.** Metadata reports entity count, layer count, and the top
6 entity types by frequency (LINE, CIRCLE, LWPOLYLINE, TEXT, etc.). The
emitted SVG is run through `svg.js`'s strict sanitiser
(`sanitizeSvgMarkup()`) before being shown, since it originates from an
untrusted file. If no drawable geometry results, a plain message is shown
rather than an empty canvas.

### SolidWorks reader (.sldprt/.sldasm/.slddrw)

**What it does.** Two eras, two outcomes. **Older files** (pre-~2015) are
OLE2/Compound File documents (like legacy Office) - Analyser reads their
embedded render preview (a "PreviewPNG" stream, or a CF_DIB thumbnail in
the SummaryInformation property set) and standard document metadata
(title, author, save dates). **Modern files** (~2015 onward) are encrypted
end-to-end - no OLE2 header, no plaintext streams, ~8.0 bits/byte entropy
throughout - so nothing can be extracted; Analyser identifies the file and
says so plainly, pointing at STEP/STL export for use with the site's 3D
viewer.

**How to reach it.** Drop a `.sldprt`/`.sldasm`/`.slddrw`. Built in
`solidworks.js`, using the shared `cfbf.js` OLE2 reader.

**Notes / limits.** The actual geometry is proprietary ShapeManager either
way and is never reconstructed here in any era - not `.sldreg` (a registry-
export text file, handled elsewhere by `proprietary.js`/parsers).

### Autodesk Fusion 360 reader (.f3d/.f3z)

**What it does.** A Fusion 360 design is a ZIP whose members are
Zstandard-compressed (ZIP method 93). It carries no open geometry - the
solid model lives in Autodesk's proprietary ShapeManager BREP blobs and an
undocumented OGS display mesh, neither reconstructable in the browser. What
IS readable and surfaced: Fusion's own rendered thumbnail
(`.../Previews/*.png`), the document descriptor (`Properties.dat` - clean
JSON: type/subtype), the design manifest (`Manifest.dat`, for the Fusion
document version string), and a count of solid bodies and embedded
appearance assets.

**How to reach it.** Drop a `.f3d`/`.f3z`. Built in `f3d.js`.

**Notes / limits.** Identify-only for the actual geometry - shows the model
thumbnail and what the file *is*, not a re-renderable 3D model.
