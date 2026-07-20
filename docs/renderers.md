# Renderer catalog

A short reference to every module in `web/assets/js/renderers/` - what file
kind it owns, what it does, and any notable vendored/WASM dependency. Renderer
kinds are wired into the `ROUTES` table in `web/assets/js/core/app.js` and
lazy-loaded on first use (see [`architecture.md`](architecture.md) and [`pipeline.md`](pipeline.md)).
There are **~86** modules in `renderers/` (a handful - `compare.js`,
`folder-archive-shared.js`, `sonify.js`, `media-reverse.js`, `proprietary-formats.js`
and similar - are shared helpers or data tables rather than top-level routed
kinds). For full usage detail (buttons, controls, options), see the
`features/*.md` docs; this is the module-level map.

## Images

| Module | Handles | Notes |
|---|---|---|
| `photo.js` | Photo analysis entry point | File preview, size/MIME/dimensions/aspect ratio, full EXIF/IPTC/XMP/ICC/GPS via **exifr**, RGB histogram, dominant colours, GPS map (lazy **Leaflet**+OSM), OCR (lazy **Tesseract.js**), SHA-256 |
| `photo-convert.js` | HEIC/HEIF and camera-RAW conversion to JPEG before analysis | **heic2any** for HEIC, embedded-JPEG scan for RAW, **ImageMagick-WASM** heavyweight fallback |
| `photo-recover.js` | Broken/truncated/corrupt still-image salvage | Strip junk before JPEG SOI, append missing EOI, rebuild damaged headers from a reference photo, carve embedded images out of a blob. `ensureJpegHuffman()` grafts the standard JPEG Huffman tables (ITU-T T.81 Annex K) onto a JPEG that has a scan but no DHT - the Motion-JPEG frame case, where the tables live once in the video header and every browser renders the tableless frame blank; deterministic, baseline-only, a no-op for a JPEG that has its own tables |
| `jpeg-salvage.js` | Fault-tolerant baseline JPEG decoder | `decodeJpegPartial(bytes)` decodes a JPEG MCU by MCU and, the moment the entropy stream is truncated or a Huffman code goes invalid, stops and returns the rows it got (real top + mid-grey fill) instead of failing. This recovers the picture where the browser's own decoder renders a fragmented/corrupt JPEG as nothing. Pure/DOM-free (returns RGBA + `rows` + `thumb`), baseline sequential only, with a standard-Huffman fallback for tableless MJPEG frames. When the main image decodes to nothing (its body overwritten) it falls back to the file's **embedded EXIF thumbnail** in the surviving header (`findEmbeddedThumb`, returned with `thumb: true`), so a lost photo still shows a real preview. Used as the fallback across every carve gallery (`diskimage.js`, `carve-gallery.js`) and by the photo salvage view (`photo.js`) after the browser draws nothing |
| `sonify.js` | Image -> sound ("sonify") | Inverse of `spectrogram.js`: each image column becomes one instant of frequency content, resynthesised as audio |
| `tiff.js` | Multi-page TIFF page extraction | Walks IFD chain in pure JS; spins up **ImageMagick** to render pages to PNG only when there are 2+ pages, then feeds `embedded-images.js` |
| `mpo.js` | MPO / Multi-Picture Format image extraction | Parses the MPF index in the JPEG APP2 segment; pure parsing, no decode |
| `ico.js` | ICO/CUR icon directory extraction | Rebuilds a minimal single-image blob per directory entry (PNG and classic BMP/DIB); no WASM |
| `embedded-images.js` | Shared "Embedded images" card | Pure-DOM layout used by `ico.js`, `mpo.js`, `tiff.js` to show every packed image on a checkerboard with size/format/download |
| `carve-gallery.js` | Shared carved-image gallery | Bare thumbnails (no card) with Analyse/Download overlaid on hover, matching the PDF page previews. Each thumbnail decodes lazily on scroll into an `IntersectionObserver`-driven downscaled canvas and releases its blob URL, so nothing blocks the analysis behind it. Decodes run through a one-at-a-time queue so a scroll that reveals many large carves can't exhaust the browser's image decoder into false blanks. Browser-first with a salvage fallback: when the browser renders nothing from a fragmented/corrupt JPEG, `jpeg-salvage.js` recovers whatever top strip survives and that raster is shown (and used in the lightbox). Whatever decodes is shown - partial strips, grey fill and all - and only a carve with no decodable raster at all keeps its text placeholder. Used by `photo.js` (salvage view) and `unknown.js`; `diskimage.js` keeps its own copy for the frame toggle and lightbox paging |

## Audio

| Module | Handles | Notes |
|---|---|---|
| `audio.js` | Audio module entry point | Uploaded files, mic recording, live spectrogram; waveform + file info |
| `audio-analysis.js` | Pure-computation audio metrics | Level stats, spectral centroid, LUFS loudness, pitch (YIN), tempo, stereo metrics - no DOM, no Web Audio |
| `audio-codec.js` | Container/codec sniffing | Peeks file header for sample rate/bit depth/codec hints; wraps raw AAC (ADTS) in a minimal M4A container |
| `audio-player.js` | Custom `<audio>` transport | Play/pause, draggable seek track, time readout; shared by `audio.js` and (via re-export) `video.js` |
| `spectrogram.js` | Spectrogram engine | Pure-JS FFT/STFT pipeline, no audio-library dependency; also the image-tie-in used by `sonify.js`'s inverse |
| `media-reverse.js` | Reversed audio playback + download | Flips channel samples of an already-decoded `AudioBuffer`, re-encodes as WAV via the AVI module's PCM-WAV encoder |

## Video

| Module | Handles | Notes |
|---|---|---|
| `video.js` | Video module entry point | Playback, container/codec detection, frame rate, frame capture (routed to `photo.js`), audio track extraction (waveform+spectrogram via `audio.js`) |
| `video-avi.js` | AVI (RIFF) container parsing | Reads header for dimensions/codec/audio format, pulls raw MJPEG frames + PCM audio from `movi`, re-wraps PCM as playable WAV; used when the native `<video>` path fails |
| `video-recover.js` | Truncated/unfinalised MP4-MOV recovery | Recovers playable video with no `moov` index by carving H.264/H.265 from `mdat`, borrowing SPS/PPS in-band or from a reference clip |
| `video-sync.js` (`core/`) | Shared player↔analysis scrubbing sync | Not a renderer module itself but the shared helper video/audio renderers use to sync playback position with readouts |
| `sony-rtmd.js` | Sony rtmd (Real-Time MetaData) gyro/IMU extraction | Reads Sony Alpha/FX/RX cameras' timed-metadata track (exposure/lens/GPS + gyro/accelerometer samples) |

## Animation / frames

| Module | Handles | Notes |
|---|---|---|
| `gif-frames.js` | GIF frame-by-frame decode | Hand-written LZW decoder + disposal/transparency/interlace compositing; pure logic, no DOM |
| `gif-encode.js` | Animated-GIF re-encoding | Median-cut quantisation + custom GIF-variant LZW writer; used by the reverse-playback download feature |
| `webp-frames.js` | Animated WebP frame decode | Uses the browser's `ImageDecoder` (WebCodecs) rather than hand-rolled VP8/VP8L decoding |
| `lottie.js` | Lottie/Bodymovin JSON vector animation player | Plays via vendored **lottie-web**; handles plain `.json`, dotLottie `.lottie` ZIPs, and Telegram `.tgs` gzip stickers |

## Documents

| Module | Handles | Notes |
|---|---|---|
| `pdf.js` | PDF viewer | Lazy-loads **pdf.js**; metadata, text, page thumbnails |
| `paged.js` | Shared "page preview" presentation | Mirrors the PDF page experience for formats with no native page geometry (Word/ODF text, spreadsheets, presentations) |
| `djvu.js` | DjVu scanned-document viewer | Vendored pure-JS **DjVu.js**; decodes pages to `ImageData`, paints to canvas with prev/next paging |
| `docx.js` | DOCX (OOXML) viewer | Metadata, formatted text, tables, text extraction |
| `xlsx.js` | XLSX (OOXML) viewer | Each worksheet as a table with sheet tabs and metadata |
| `xlsb.js` | Excel Binary Workbook viewer | Vendored **SheetJS** community build decodes BIFF12, rendered with the same table UI as `xlsx.js` |
| `pptx.js` | PPTX slide viewer | Each slide as a card: title + body text and embedded images, in order |
| `odf.js` | OpenDocument viewer (ODT/ODS/ODP) | Converts `content.xml` into the shared `paged.js` presentation, reusing the DOCX/XLSX/PPTX-style views |
| `legacy-office.js` | Legacy binary Office (DOC/XLS/PPT 97-2003) | OLE2/CFBF containers; best-effort text extraction (Word FIB piece table) shown via the page-sheet preview |
| `textdoc.js` | Text and lightweight-markup family | RTF (control words stripped), AbiWord, FictionBook, HWPX, MHTML, plus DITA/TEI/JATS/reStructuredText/AsciiDoc/Org/Textile/TeX/BibTeX as selectable source |
| `iwork.js` | Apple iWork viewer (Pages/Numbers/Keynote) | Shows the baked-in QuickLook preview (`Preview.pdf` via `pdf.js`, or the largest thumbnail) - iWork's real content (Snappy-compressed protobuf) isn't reconstructable |
| `epub.js` | EPUB reader | Metadata, cover, chapter-by-chapter reading with navigation |
| `mobi.js` | Kindle/Mobipocket e-book reader | Vendored **foliate-js** `mobi.js` decodes MOBI6/KF8; section-by-section sandboxed-iframe reader |
| `mdb.js` | Microsoft Access database viewer | Vendored **mdb-reader**; lists tables with columns/row counts + sample rows |
| `notebook.js` | Jupyter notebook (.ipynb) viewer | Renders markdown/code/raw cells with captured outputs (text, images, errors) |
| `markdown.js` | Markdown renderer | Self-contained CommonMark-ish + GFM parser (headings, tables, task lists, fenced code); all text HTML-escaped |

## Design / CAD / 3D

| Module | Handles | Notes |
|---|---|---|
| `svg.js` | SVG inspector | Renders at actual size; stats, element counts, colour palette, text content; strips active/unsafe content |
| `illustrator.js` | Adobe Illustrator (.ai) viewer | Modern `.ai` is PDF-compatible, opens via `pdf.js`; older EPS-based `.ai` falls back to identification |
| `psd.js` | Photoshop PSD/PSB viewer | Lightweight header read (dimensions, colour mode, embedded thumbnail) plus a full composite render + layer tree |
| `paint.js` | Krita/Procreate raster apps | Reads the baked-in flattened preview (`mergedimage.png` / `Thumbnail.png`); per-layer data isn't reconstructable |
| `diagram.js` | draw.io/diagrams.net and DXF vector diagrams | Decodes mxGraph XML (incl. deflate+base64) or DXF entities to an SVG preview |
| `lut.js` | Colour LUT (.cube) viewer + visualiser | Parses Adobe/Iridas/Resolve LUT text format; also handles `.look` Adobe SpeedGrade grade stacks |
| `font.js` | Font specimen viewer (TTF/OTF/WOFF/WOFF2/TTC) | Live FontFace API specimen (true rendering, variable-font axis sliders) plus vendored **opentype.js** for glyph grid/metadata |
| `stl.js` | STL 3D viewer | Parses binary+ASCII STL; self-contained WebGL viewer (orbit/zoom/spin) with geometry stats |
| `model3d.js` | 3MF / STEP / IGES / OBJ / PLY / glTF / FBX viewer | 3MF parsed natively (fflate+regex); STEP/IGES tessellated via lazy **OpenCASCADE WASM**; shares `stl.js`'s WebGL viewer |
| `gcode.js` | Universal G-code analyser & 3D reconstructor | Parses slicer and CNC/CAM G-code dialects; reconstructs deposited filament (not just centreline) in an interactive WebGL viewer |
| `unity.js` | Unity asset viewer | Parses Unity's YAML object-stream dialect (scenes, prefabs, materials, animators, `.meta`) |
| `dwg.js` | AutoCAD DWG viewer | Vendored **libredwg-web** (WASM, lazy) parses the drawing to an entity database, rendered as an SVG 2D preview |
| `solidworks.js` | SolidWorks part/assembly/drawing reader | Older files (OLE2) expose a render preview + metadata; modern encrypted files are identify-only |
| `f3d.js` | Autodesk Fusion 360 (.f3d/.f3z) reader | Zstd-compressed ZIP; shows the baked thumbnail + manifest/contents - the proprietary BREP geometry isn't reconstructable |

## EDA / NLE

| Module | Handles | Notes |
|---|---|---|
| `altium.js` | Altium Designer schematic/PCB/library viewer | OLE2 Compound Files (shared `cfbf.js` reader), rebuilt as an interactive vector view |
| `kicad.js` | KiCad schematic/PCB/library/project viewer | S-expression text format (KiCad 6-9), rebuilt as an interactive vector view |
| `spice.js` | SPICE/LTspice raw waveform viewer | Binary or ASCII `.raw` dumps from ngspice/LTspice; parses header key/value block + sample data |
| `ipcnet.js` | IPC-D-356(A) fabrication/test netlist viewer | Fixed-column text format: parameter lines + one feature record per test point |
| `aftereffects.js` | Adobe After Effects project (.aep) viewer | Reverse-engineered RIFX (big-endian RIFF) chunk-list parser rebuilding comp timelines |
| `premiere.js` | Adobe Premiere Pro project (.prproj/.prel) viewer | Gzip-compressed XML object graph (ObjectID/ObjectUID references) rebuilt into sequences |
| `davinci.js` | DaVinci Resolve project (.drp/.drt) viewer | ZIP of exported XML documents; rebuilds each timeline's track/clip layout |
| `vegas.js` | Sony/MAGIX VEGAS Pro project (.veg/.vf) viewer | RIFF-GUID container; per-event/track layout keyed by undocumented GUIDs, so recoverable metadata is surfaced rather than a full timeline |
| `timeline.js` | Editing-timeline viewer (EDL/FCPXML/OTIO) | Normalises the standard NLE interchange formats into one visual tracks×time clip view |

## Data / archive

| Module | Handles | Notes |
|---|---|---|
| `csv.js` | CSV/TSV preview | Delimiter detection, quoted-field parsing, per-column type inference, numeric stats, first-100-row preview |
| `gcsv.js` | Gyroflow .gcsv IMU log viewer | Parses the generic IMU-log interchange text format (gyro/accelerometer traces) |
| `dataview.js` | HAR / JSON5-JSONC-Hjson / .nfo text-art viewers | Three lightweight viewers sharing a "show what people care about" goal |
| `gitobject.js` | Git object viewer | Loose objects inflated with the browser's `DecompressionStream` (no library); pack files/indexes read for header info |
| `email.js` | Email message viewer (.eml/.emlx/.mbox) | Parses RFC 822/MIME headers (RFC 2047 decoding) and walks the MIME tree for a displayable body |
| `archive.js` | ZIP archive inspection | Lazy-loads **fflate**; shares `folder-archive-shared.js` for treemap/breakdown/tree views |
| `zip.js` | Shared ZIP reader | Central-directory-first reads with ranged fetches per entry (order-independent, no full-file load); sequential fallback for truncated archives |
| `folder.js` | Dropped-folder overview | Recursive `webkitGetAsEntry` walk; treemap + summary via the shared folder/archive modules |
| `treemap.js` | Nested squarified treemap (WizTree-style) | Canvas-based, files sized by bytes and coloured by category, with hover tooltips and click-to-analyse |
| `folder-archive-shared.js` | Shared folder/archive helpers | Category classification, breakdown cards, view toggle (treemap/tree), used by `folder.js` and `archive.js` |
| `diskimage.js` | Raw disk-image browser (.img/.ima/.dsk) | Mounts a FAT12/16/32 volume - bare "superfloppy" or first FAT partition of an MBR disk - and reuses `renderHandleTree` for the tree/treemap. **Reads a prefix, not the whole image**: the layout is settled from the first sector, then the tree is parsed from `candidate + 16 MB`, quadrupling only while `vol.shortRead` says the walk ran off the end (a 488 MB card settles on one 16 MB read). The full image is read lazily - on first click of a file whose bytes sit beyond the prefix, and by the sector-carve scan. The **"Images in this disk"** section sits directly under the file tree and is **opt-in**: it shows a "Scan for images" button rather than running automatically (the scan reads the whole image and carves every signature). The carve scan is **chain-aware** (`recoverViaChain`): a carve starting on a cluster with a surviving, fragmented FAT chain is read along that chain so a scattered file reassembles correctly, instead of the straight contiguous carve splicing in another file's body. Carved JPEGs pass through `ensureJpegHuffman` (photo-recover.js), so a tableless Motion-JPEG frame - the bulk of what a scan turns up on a card that held video - gets the standard Huffman tables grafted on and previews instead of rendering blank. Thumbnails decode through a one-at-a-time queue (a scroll can bring dozens of full-size photos into view at once, and decoding them concurrently exhausts the image decoder into false blanks). **Nothing is hidden by content**: every carve that produces any raster is shown - a partial top strip, flat grey, noise and all - so the gallery reflects everything the scan found, not just the intact photos. Decoding is browser-first with a salvage fallback: a fragmented/corrupt JPEG the browser refuses is handed to `jpeg-salvage.js`, which recovers the surviving top rows (shown, and used full-res in the lightbox); only a carve nothing can decode keeps a text placeholder. The transparent/mid-grey fill fraction (`emptyFraction` / `classifyFill`) is kept purely as a forensic label - ok / partial / empty - surfaced in the hover tooltip and the **Copy photo list** report (offset, size, content = ok/partial/empty/none), which decodes every full-size photo the same serialised way. When a photo's full-size image was overwritten but its header cluster (with its EXIF thumbnail) survived, the salvage decoder falls back to that **embedded thumbnail**, so even a lost photo shows a real preview of its scene (labelled "embedded thumbnail") rather than nothing. Each carved photo's **EXIF capture date** is read from its header (`carveExifDate`, a bounded byte-scan for the `Exif` block - survives carving even for deleted files), shown on the cell and offered as a **Sort** control (largest / newest / oldest); the sort re-orders the existing cells in place, and photos with no date sink to the bottom |
| `diskimage-fat.js` | FAT + MBR parser (pure, no DOM) | Byte half of the above, dependency-free so it runs under Node against a real image. Cluster-chain loop guards, entry/depth caps, bounds-checked reads. Reports `shortRead` when any read fell outside the buffer (the prefix-growth signal) and exposes `geom` + `readFileBytes()` so contents can be read from a *different*, fuller buffer without re-parsing |
| `comic.js` | Comic book archive viewer (CBZ/CBR/CBT/CB7) | Metadata card + page-thumbnail grid + lightbox reader; CBZ is ZIP, CBT is TAR, CBR/CB7 via lazy **libarchive** WASM |
| `midi.js` | Standard MIDI File (.mid/.midi) reader | Hand-written SMF parser: tempo map, time/key signature, track names, GM instruments, note counts - no playback |
| `subtitles.js` | Subtitle files (SRT/WebVTT/ASS/SSA/MicroDVD/SubViewer) | Parses cues into a timed list with counts/timing/styling; sniffs which format an overloaded `.sub` actually is |
| `lrc.js` | LRC timed-lyric files | Parses ID tags and timestamped lines, including word-level enhanced tags |
| `geo.js` | Geospatial files (GPX/KML/GeoJSON) | Tracks/placemarks/features with distance/bounds/time span; plotted on lazy-loaded Leaflet/OSM |
| `tablekit.js` | Table-analysis workbench | Mounted below CSV/XLSX/XLSB/ODS analyses: virtualised grid, stats bar, hand-drawn chart builder, PNG/JSON/CSV export |
| `vssolution.js` | Visual Studio solution (.sln/.slnx) manifest viewer | Line-based text parser for projects + build configurations |

## Cross-cutting / fallback / infrastructure

| Module | Handles | Notes |
|---|---|---|
| `unknown.js` | Unknown-file inspector (fallback renderer) | Magic-byte format guess, hex/ASCII dump, SHA-256, enhanced previews for text/JSON/XML; can hand off to `photo-recover.js` |
| `proprietary.js` | Proprietary-format identification | Identifies 200+ formats by extension/magic bytes; dispatches to lazy `parsers/parsers-<chunk>.js` modules for deeper metadata |
| `proprietary-formats.js` | Proprietary format catalog (data only) | The `FORMATS` table `proprietary.js` drives; pure data, no logic |
| `compare.js` | `/compare` two-file side-by-side view | Runs each file through its normal renderer off-screen, merges readout cells into `Field \| A \| B` tables |

See `docs/features/*.md` for the user-facing usage detail behind each of
these modules, and [`parsers-and-libs.md`](parsers-and-libs.md) for the lazy parser chunks and
shared binary/WASM helpers they depend on.
