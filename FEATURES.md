# Analyser - Feature overview

A bullet-point inventory of everything Analyser does, written to be technically
accurate but understandable by a non-technical reader. Each bullet is a fact you
can expand into prose. British spelling, no em-dashes (site house style).

---

## The big idea

- Analyser is a **forensic workbench for files that runs entirely in your web
  browser**. You drop a file in and it tells you everything about it.
- **Nothing is ever uploaded.** Your files never leave your device - there is no
  server doing the analysis, no cloud, no account. All the work happens locally
  using the browser's built-in File API and on-demand WebAssembly code.
- **Zero backend, zero build step.** It is plain HTML, CSS and JavaScript - no
  framework, no install required to use it, works as a normal website.
- **Installable and works offline.** It is a PWA (Progressive Web App): you can
  install it like a real app and use it with no internet connection at all.
- **Supports 1,269 file formats** across **12 categories** - from everyday photos
  and videos to obscure CAD, scientific and game-engine files.
- The only thing ever sent off-device is two anonymous numbers: a visitor count
  and a tally of which file extensions people analyse (just the extension text
  like "jpg", never the file).

## How you give it a file

- **Drag and drop anywhere** on the page - a "drop anywhere" overlay appears when
  you drag a file over the window.
- **Three labelled dropzones** for the common cases: Photo/Video, Sound, and Any
  File - each with its own native file-picker button.
- **Paste from clipboard** (Ctrl/Cmd+V) - paste an image, audio or video straight
  in.
- **Drop a whole folder** - it walks the folder recursively and shows an
  interactive map of what is inside (see Folders & archives).
- **Drop multiple files at once** - including a RAW photo together with its `.xmp`
  edit-settings sidecar, which it pairs up automatically.
- **Works on mobile and by keyboard** - pickers are touch-friendly and labelled
  for accessibility.

## The format catalog (the brain behind it)

- A single catalog drives the whole site: what it can analyse, the searchable
  format list, the help pages and the routing of each dropped file.
- Two depths of support:
  - **Full analysis** - a real viewer / deep inspection (photos, audio, video,
    PDFs, Office docs, 3D models, archives, and more).
  - **Identification** - for proprietary formats it can't fully open, it still
    recognises the file and extracts header metadata (what app made it, version,
    dimensions, etc.).
- Every format has a plain-language description, the software/brands associated
  with it, and search keywords (so typing "solidworks" finds `.sldprt`).

---

## Photos and images

- **Preview and lightbox** - inline preview plus a full-screen zoom/pan viewer.
- **Full camera metadata (EXIF/IPTC/XMP/ICC)** in plain language:
  - Camera make/model, lens make/model, body and lens serial numbers, software.
  - Exposure settings: ISO, aperture (f-stop), shutter speed, focal length and
    35mm-equivalent, exposure compensation, metering mode, white balance, flash.
  - Dates taken/created/modified with time-zone offset.
  - Orientation, colour space, resolution (DPI), title/description/creator/
    copyright/keywords, star rating and colour label.
  - ICC colour-profile details (profile name, device, colour space).
  - Shutter actuation (shot) count where the camera stores it (Sony/Nikon).
- **GPS location** - extracts coordinates and shows them on an interactive
  OpenStreetMap map.
- **Text recognition (OCR)** - reads text out of the image on-device using
  Tesseract, with a 33-language picker (English bundled for full offline use).
- **QR code reading** - detects and decodes QR codes in the picture.
- **Colour analysis** - RGB histogram, dominant-colour palette (with hex/HSL),
  average colour, shadow/midtone/highlight balance.
- **Quality metrics** - sharpness/blur estimate and a focus-region map showing
  where the photo is sharpest.
- **Similarity fingerprints** - perceptual hash (pHash) so near-duplicate images
  can be compared.
- **Modern-camera features detection** - Apple ProRAW, Live Photos, Motion
  Photos, Ultra HDR gain maps, depth maps.
- **AI-image detection** - scans metadata for AI-generator signatures (Stable
  Diffusion, DALL-E, Midjourney, Firefly, etc.) and C2PA "Content Credentials".
- **RAW develop settings** - reads the Adobe Camera Raw edit recipe from an `.xmp`
  sidecar (exposure, contrast, white balance, crop, lens corrections, total
  number of adjustments, process version).
- **Format conversion built in:**
  - **HEIC/HEIF** converted to a viewable JPEG.
  - **Camera RAW** (DNG, CR3, NEF, ARW, RAF, X3F and many more) - fast embedded
    preview, or a full decode/demosaic via ImageMagick/LibRaw with a progress bar.
- **Multi-image containers** - extracts every icon size from `.ico`/`.cur`, every
  frame of an MPO stereo pair, every page of a multi-page TIFF.
- **Integrity** - SHA-256 hash of the file.

## Audio

- **Built-in player** - custom transport (play/pause, draggable seek, time
  display), shared volume that persists, mute, frame-accurate scrubbing.
- **Waveform** - amplitude waveform with clipping highlighted.
- **Spectrogram** (a picture of the sound's frequencies over time):
  - Adjustable FFT size, window type, linear/log frequency axis, multiple colour
    schemes, sensitivity, zoom up to 48x, fullscreen, and save-as-PNG.
  - Optional "reassigned" mode for a sharper, higher-resolution picture.
  - Playhead syncs with playback; you can pan around when zoomed.
  - **Live microphone mode** - record from the mic and watch the spectrogram in
    real time.
- **Technical readout** - codec and version, sample rate, bit depth, channels,
  bitrate (CBR/VBR, with LAME preset names), channel layout (mono to Atmos).
- **Loudness and levels** - peak, RMS, broadcast-standard LUFS, clipping detection.
- **Musical analysis** - pitch/note detection (with cents offset), tempo (BPM),
  spectral centroid (brightness), highest frequency present (hints at lossy
  encoding cutoff), dynamic range.
- **Stereo analysis** - phase correlation, stereo width, mid/side levels, and a
  vectorscope.
- **Tags** - ID3, Vorbis comments and MP4 atoms: title, artist, album, year,
  genre, track, composer, publisher, comment, BPM, ISRC, copyright, lyrics, etc.
- **Embedded cover art** - extracted and sent to the full photo analyser.
- **Reverse audio** - plays it backwards and lets you download the reversed WAV.
- **Codec-specific deep dives** - MP3 (Xing/VBRI/LAME frame info, encoder), FLAC
  (raw-audio MD5, compression ratio), WAV (PCM details), AAC (ADTS handling).

## Video

- **Player** - custom scrubber, frame-by-frame stepping, editable timecode for
  exact seeking, shared volume.
- **Technical readout** - container (MP4, MOV, MKV/WebM, AVI, FLV, MPEG-TS, etc.),
  resolution, aspect ratio, frame rate (snapped to standard PAL/NTSC/cinema
  rates), duration, bitrate, codec with its profile/tier/level, bit depth and
  chroma subsampling, colour primaries/gamma/range, HDR type with MaxCLL and
  MaxFALL, Dolby Vision profile, and what app/muxer created it. Read from the
  codec settings and from the video stream's own header, so it works even for
  files the browser cannot play.
- **Every track listed** - Matroska files usually carry several soundtracks and
  subtitle tracks; each is shown with its codec, language, name and default or
  forced flag.
- **Frame capture** - grab the current frame as a PNG, or send it to the full
  photo analyser (histogram, colours, OCR and so on).
- **Audio track tools** - waveform, spectrogram and loudness for the video's
  sound; extract the audio as a WAV.
- **Plays formats browsers normally can't** - HEVC, ProRes, DNxHD, AV1, VC-1 and
  others are transcoded on-device with FFmpeg (WebAssembly), with a progress bar
  and offline caching.
- **Raw H.264/H.265 streams** - reads the stream's own sequence parameter set for
  the codec profile, size, bit depth, colour and frame rate, then re-wraps it into
  a playable MP4, handling huge files in memory-bounded chunks. Because the frame
  rate comes from the stream rather than being assumed, the length and bitrate are
  real figures.
- **Scene-change detection** - finds cuts and shows a clickable thumbnail grid.
- **Reverse video** - re-encodes the clip backwards (chunked so it doesn't run out
  of memory) and lets you download it.
- **AVI / MPEG-TS specifics** - Motion-JPEG and PCM extraction, timestamp repair
  for AVCHD `.mts`/`.m2ts`. A very large AVI (over 500 MB) is indexed rather than
  loaded: its frames are read one at a time as you step or scrub, so it opens on
  an ordinary machine instead of being turned away.
- **Camera gyro data** - reads Sony's per-frame gyroscope/accelerometer track when
  present (see Camera motion data).

---

## Documents and e-books

- **PDF** - full page rendering with navigation, zoom and selectable text;
  metadata (title/author/producer/version); encryption and permission flags;
  PDF/A detection; outline/bookmarks; embedded attachments; embedded JavaScript
  detection (security flag); font embedding analysis; form fields; per-page text
  extraction; image extraction; OCR on scanned pages; page thumbnails.
- **Microsoft Word** (`.docx`/`.docm`) - renders text, headings, lists, tables and
  images with formatting; word/character/page counts; comments and tracked
  changes; hyperlinks; company/manager and editing-time metadata.
- **Legacy Office** (`.doc`/`.xls`/`.ppt`, the old 97-2003 binary formats) - text
  and data recovered straight from the compound-file container.
- **OpenDocument** (`.odt`/`.ods`/`.odp`/`.odg` and flat/legacy variants) - same
  rich rendering for the LibreOffice/OpenOffice family.
- **Rich text and markup** - RTF, FictionBook, AbiWord, Hangul HWPX, MHTML web
  archives, plus source view for DITA, TEI, JATS, reStructuredText, AsciiDoc,
  Org-mode, Textile, TeX/LaTeX, BibTeX (HTML always sanitised first).
- **Apple iWork** (Pages/Numbers/Keynote) - shows the embedded preview and the app
  version that made it.
- **EPUB** - chapter-by-chapter reader with table of contents; metadata
  (title/author/publisher/version, DRM detection, series); cover; word count and
  estimated reading time.
- **Kindle/Mobipocket** (`.mobi`/`.azw`/`.azw3`) - decoded and read section by
  section with cover and metadata.
- **DjVu** - scanned-document pages decoded and rendered.
- **Markdown** - rendered view (GitHub-flavoured: tables, task lists, code blocks,
  etc.) plus raw source and document stats.
- **Jupyter notebooks** (`.ipynb`) - renders code cells, outputs (including image
  outputs), and markdown, with kernel/language info.

## Spreadsheets and structured data

- **Excel** (`.xlsx`/`.xlsm`, and binary `.xlsb`) - tabbed sheet view, cell
  values/formulas/dates/currency, named ranges, hidden ("very hidden") sheets,
  external links, and macro (VBA) detection.
- **CSV / TSV** - auto-detects the delimiter; infers each column's type; per-column
  statistics (fill rate, min/median/quartiles, top values, date ranges); data-
  quality checks (ragged rows, duplicates, BOM, mixed line endings); interactive
  table that loads more rows on demand; handles huge files by sampling.
- **JSON / JSON5 / JSONC / Hjson** - source view plus an expandable value tree;
  tolerant parsing of comments and trailing commas.
- **HTTP archives** (`.har`) - table of every network request (method, status,
  type, size, timing, URL) with a summary.
- **NFO** - decodes the old DOS code page and renders the ASCII art correctly.
- **Microsoft Access** (`.mdb`/`.accdb`) - lists tables, columns and row counts and
  shows sample rows.
- **Access-/SQLite-backed apps** - reads SQLite databases directly (tables, row
  counts, schema, sample data) - this also covers GeoPackage, MBTiles, Audacity
  projects and anything else built on SQLite. There is a full **SQL console**
  too: any statement you like, including writes, run against a copy of the
  database held in memory. The copy is discarded when you leave and the file on
  your device is never written to.

## Presentations

- **PowerPoint** (`.pptx`/`.pptm`) - renders each slide, detects hidden slides,
  shows speaker notes, on-slide tables, hyperlinks and embedded images, with a
  full-size slide lightbox.
- **OpenDocument Presentations** (`.odp`) - the same slide rendering for the
  LibreOffice family.

## 3D and CAD

- **STL** - a built-in WebGL 3D viewer (orbit/pan/zoom, spin, wireframe, colour,
  perspective/orthographic, fullscreen) with geometry stats (triangle count,
  bounding box, surface area, watertight volume) and multi-body splitting.
- **Other meshes** (OBJ, PLY, OFF, 3MF, AMF, glTF/GLB) - same interactive viewer,
  multi-part assemblies, materials and model metadata.
- **CAD B-rep** (STEP, IGES, BREP) - tessellated and shown in the 3D viewer using
  the OpenCASCADE engine (WebAssembly), with header info (author, software, etc.).
- **AutoCAD DWG** - decoded with LibreDWG and drawn as a 2D preview, with entity
  and layer counts; **DXF** drawings rendered to SVG.
- **G-code** (3D-printer and CNC) - reconstructs the printed object or cutting path
  in 3D from the toolpath; detects the slicer; colours by feature type, height or
  speed; build-height scrubber; movement counts; CNC tool table; print stats.
- **Unity assets** - reads the YAML object stream of scenes/prefabs/animator
  controllers/materials/`.meta` files and shows a component breakdown and
  per-type fields.

## Buildings (IFC / BIM)

- **An IFC model opens as the building it describes.** IFC records a building as
  objects with properties - this is a wall, it is external, it sits on that
  storey - and stores no hierarchy at all: what contains what is kept in separate
  relationship objects. Analyser follows those and rebuilds the tree, from
  project down through site, building and storey to the elements on each floor,
  grouped by type with their property sets.
- **The building is drawn too.** Walls, slabs and columns are usually a flat
  outline pushed along a direction, and those are built and shown in the same 3D
  viewer as any other model, along with explicit meshes and the shared shapes
  that place every window and door.
- Shapes that need a solid-modelling engine to work out - a wall with an opening
  cut through it - are **counted and named rather than drawn wrong**, because
  drawing the uncut shape would show you a wall with no window in it.
- The header names the tool and exporter that wrote the file, which matters: how
  much a model really contains depends heavily on which program produced it.

## Chemical structures

- **Molecules are drawn, not listed.** Drop a `.mol`, `.sdf`, `.mol2`, `.xyz`,
  `.pdb`, `.cif` or `.mmcif` and the structure comes up in a 3D viewer you can
  rotate, zoom and restyle - ball-and-stick, sticks, spheres or wireframe.
- **Proteins get a ribbon.** A structure with tens of thousands of atoms is
  unreadable as balls and sticks, so anything made of amino acids or nucleotides
  is drawn as a cartoon instead: each chain a ribbon following its backbone, with
  helices and sheets picked out and any bound drug still shown as sticks.
- **The composition is worked out from the atoms themselves** rather than read
  off a label in the file: molecular formula, molecular weight, net charge and
  element counts, plus - for a protein - its chains, residues, helix/sheet split
  and everything that is not part of a chain (ligands, metal ions, water).
- PDB files also give up their entry ID, title, experimental method and
  resolution, and an SDF holding many molecules is stepped through one at a time
  with each one's data fields read out.

## Design and graphics

- **SVG** - safe preview (scripts and remote references stripped first); element
  breakdown; colour palette with click-to-copy; text extraction; rasterise to PNG
  and send to the photo analyser; detects the design tool that made it.
- **Photoshop** (`.psd`/`.psb`) - composite image plus a layer tree (names, blend
  modes, opacity, visibility, per-layer thumbnails); falls back to the embedded
  preview for CMYK/16-bit/huge files; always memory-safe.
- **Illustrator** (`.ai`) - modern PDF-based files open in the PDF viewer.
- **Sketch** (`.sketch`) - the whole design opens: a browsable tree of every page,
  artboard, group and layer; a components list showing how many instances each
  one has, so you can see which parts of a design system carry the work and which
  nothing uses; all the copy in the document in one readable list; the images
  placed into the design; and the preview Sketch saves in the file. (Figma's
  `.fig` gets its container read out but not its contents - Figma encodes a
  design against a schema that ships inside each file and changes with the app
  version, so there is nothing stable to read.)
- **Painting apps** - Krita (`.kra`), Procreate, Paint.NET (`.pdn`) - shows the
  merged preview and canvas info.
- **GIMP** (`.xcf`) - a GIMP file stores no flattened image at all, only its
  layers, so Analyser composites the picture itself: it decodes each layer's
  tiles, applies that layer's mask, opacity and blend mode, and paints the stack
  from the bottom up. Full layer list alongside it, and the result saves as a PNG.
- **Pixel art** (`.aseprite`/`.ase`) - Aseprite and LibreSprite sprites, with
  every frame composited from the layer stack and played back at the file's own
  per-frame timings. Layer tree with blend modes, the named animation tags, and
  any frame saveable as a PNG.
- **Tracker music** - MOD, XM, IT, S3M and around sixty relatives from the
  demoscene and the Amiga and DOS eras. These are scores rather than recordings,
  so the song is rendered to audio on your device and then gets the whole Sound
  section - waveform, spectrogram, player, loudness, key and BPM - plus the
  tracker that wrote it, its channel and pattern counts, the song message, and
  the sample and instrument names authors left their greetings in.
- **Terraria worlds** (`.wld`) - the world map drawn one pixel per tile from the
  save's own tile data, with terrain, ores, walls and liquids, plus the world
  name, seed, size and difficulty. (The same extension is also the Esri world
  file; the two are told apart by their bytes.)
- **GPU textures** - Valve VTF and Khronos KTX/KTX2 textures now show a real
  decoded preview rather than just a header readout.
- **iPhone app icons** - the CgBI "optimised" PNGs inside an `.ipa`, which no
  browser can display, are repaired and shown like any other image.
- **Diagrams** - draw.io / diagrams.net rendered as SVG (handles compressed
  diagrams), with per-page shapes and edges.
- **Colour LUTs** (`.cube`) - parses 1D/3D look-up tables and visualises them:
  tone-response curve, before/after test charts, memory-colour swatches, an
  interactive 3D colour-cube scatter, and applying the LUT to your own photo or
  video frames side by side.
- **Fonts** (TTF/OTF/WOFF/WOFF2/TTC/OTC) - live specimen at several sizes,
  variable-font axis sliders, multi-script pangrams, a glyph grid, and metadata
  (family, designer, foundry, licence, glyph count); unpacks font collections.

## Video-editor and VFX project files

- **Reconstructs the editing timeline** from the project file - tracks, clips,
  in/out points - with a zoomable, scrollable, colour-coded timeline view, for:
  - **Adobe After Effects** (compositions, layers, 3D/audio layers, sources).
  - **Adobe Premiere Pro** (sequences, video/audio/caption tracks, clip sources).
  - **DaVinci Resolve** (timelines plus colour-grade node chains, LUT and
    ResolveFX/OFX detection, media pool, project version/age).
  - **VEGAS Pro / Movie Studio** (effects and generators, title text, project
    summary, referenced media).
- **Interchange timelines** - EDL (CMX3600), Final Cut Pro X FCPXML, and
  OpenTimelineIO (OTIO) all rendered to the same visual timeline.

## AI models

- **ONNX models and frozen TensorFlow graphs are drawn as a graph** - every
  operation a box, every tensor flowing between them a line, laid out left to
  right so parallel branches sit side by side and merge where they rejoin.
  Neither format actually stores the connections: one operation follows another
  because they name the same tensor, so the wiring is reassembled from those
  names. Alongside it: the mix of operations, which fingerprints the
  architecture; the input and output shapes, including the ones a model leaves
  open; every weight tensor; and the total parameter count.
- **Safetensors and GGUF** weight files list every tensor with its shape and
  precision, the parameter count, and how many bits per parameter the file
  actually spends - the honest measure of how hard a model has been quantised. A
  GGUF also declares its architecture, context length, layer count and tokenizer.
- **PyTorch checkpoints** (`.pt`/`.pth`/`.ckpt`) are Python pickles, which are
  programs rather than documents - loading one runs whatever it says to. Nothing
  here is run. The file is read as bytes, every module it would import is
  listed, and anything a file of numbers has no reason to touch is flagged.
- **Keras models** have their layer list read out of the architecture JSON.

## Music-production sessions

- **Ableton Live** (`.als`/`.alp`) and **Reaper** (`.rpp`) sessions **draw their
  arrangement**: one row per track, every clip where the project puts it, on a
  real clock with a zoom for busy sections. A project file holds no audio at all
  - it is an edit list - so this is read from the same numbers the DAW lays the
  session out with.
- Alongside it: tempo and time signature, each track's type, clip count and
  plugins, and the **media files the project points at but does not contain** -
  which is how you check whether a session that has been moved or handed over
  will still open complete.

## Camera motion data

- **Sony gyro/accelerometer track** - extracts the per-frame IMU data embedded in
  Sony clips, plots gyro and accel traces on a timeline synced to the video, and
  exports it as CSV or Gyroflow `.gcsv` for stabilisation.
- **Gyroflow / IMU CSV** (`.gcsv`) - plots gyroscope and accelerometer traces on a
  zoomable timeline.

---

## Folders and archives

- **Treemap visualisation** - drop a folder or archive and see a nested, colour-
  coded map sized by file size, grouped by category, that you can zoom into; tiny
  files are pooled into a searchable "N files" tile.
- **Browse inside archives** - ZIP, RAR, 7-Zip, TAR (and `.tar.gz`/`.xz`/`.zst`/
  `.bz2`), Unix `ar`/`.a`/`.lib`, and single-stream gzip/xz/zstd/lz4/lzma - listed
  as a tree, with individual files extracted on click and previewed.
- **ZIP internals** - compression method and ratio, encrypted-entry detection,
  unsafe-path (directory-traversal) detection, ZIP64, timestamps, host OS.
- **"Can it open this?" scan** - flags every file in a folder the app can't handle
  and gives you a copyable list of the unsupported ones.
- **Browse-as-archive** - any file that is secretly a ZIP/RAR/7z (an APK, a JAR, a
  DOCX) gets an archive browser added under its normal analysis.
- **Comic books** (`.cbz`/`.cbr`/`.cbt`/`.cb7`) - page reader.

## Code, developer and data files

- **Git objects** - decodes loose objects, packfiles and pack indexes; shows
  commit/tag/tree contents and can hand a blob back to the analyser.
- **Email** (`.eml`/`.emlx`/`.mbox`) - parses headers (From/To/Subject/Date,
  Received hops), decodes encoded subjects, shows a sanitised HTML body, lists
  attachments, and reports SPF/DKIM/DMARC authentication results.
- **Subtitles** (SRT, WebVTT, ASS/SSA, MicroDVD, SubViewer) - cue list with timing,
  stats and frame-rate handling; flags image-based VobSub. ASS and SSA files also
  **play**: the subtitles are drawn on a stage where the file actually places
  them, so a sign translated in the corner appears in the corner, lines slide
  along their movement paths, and karaoke lyrics fill in syllable by syllable in
  time with the singing.
- **Lyrics** (`.lrc`) - timed lyric lines and ID tags, including word-level timing.
- **MIDI** - reads the score: tempo map, time/key signature, track and instrument
  names, General MIDI instruments, note count, drum detection (it's a score, so
  there's no audio playback - browsers can't synthesise it).
- **Maps/geodata** (GPX, KML, GeoJSON) - tracks/routes/waypoints on an
  OpenStreetMap map, with distance, elevation profile, ascent/descent, moving
  time, and heart-rate/cadence averages. The map has three views: the plain
  track, a **pace** view that colours the line by how fast you were moving and
  pins every stop, and a **density** view showing how often the track comes back
  to the same place.
- **Visual Studio solutions** (`.sln`/`.slnx`) - projects and build configurations.

## Recognising the long tail (identification)

- For roughly 200+ proprietary formats it can't fully open, Analyser still
  **identifies the file by its magic bytes and extension** and pulls out header
  metadata. Domains covered include:
  - **Adobe** (PSD, InDesign, XD, Audition, Animate, plus Lightroom/swatch/brush
    sidecars).
  - **CAD/engineering** (SolidWorks, Fusion 360, Inventor, CATIA, Creo/Pro-E,
    Rhino, SketchUp, 3ds Max, Maya, Cinema 4D, Houdini, ZBrush, Parasolid, SAT).
  - **Audio production** (Logic, Pro Tools, Cubase, GarageBand). FL Studio
    projects also give up their tempo, patterns, channels, plugins and samples.
    Ableton Live and Reaper sessions go further and **draw the arrangement** -
    see below.
  - **Game engines** (Godot, Unreal, Unity, Bink video).
  - **Disk images** (ISO, VHD/VHDX, VMDK, qcow2, VDI).
  - **Executables/packages** (Windows EXE/DLL/MSI, Android APK, iOS IPA, macOS DMG,
    Linux AppImage), plus deep PE analysis (architecture, compile date, sections,
    security mitigations like ASLR/DEP/CFG, imported DLLs, version info). It also
    works out **what built the file and whether it is packed** - naming UPX,
    VMProtect, Themida, PyInstaller, Go, Rust and around thirty others from their
    fingerprints, and measuring each section's randomness to spot compressed or
    encrypted code even when the packer is one it doesn't know. Packing is what
    installers and commercial software do as often as malware, so the card shows
    the evidence and leaves the conclusion to you.
  - **Data-science** (NumPy arrays, WebAssembly, Java bytecode, Protocol
    Buffers, SQL dumps, source maps). AI models get a full viewer - see below.
  - **Configs and scripts** across dozens of languages and build tools.
- **Header decoders** for many of these read out real detail - e.g. Blender
  version and bitness, FBX/glTF version, SWF compression, DWG release year.

## Binary containers it can crack open

- **SQLite** databases (via WebAssembly) - tables, schema, sample rows and a SQL
  console for querying them yourself.
- **7-Zip** archives - lists and extracts even large solid archives.
- **OLE2 / Compound File** (the container behind old Office, Outlook `.msg`, MSI,
  `Thumbs.db`).
- **.NET BinaryFormatter (NRBF)** data - reconstructs the serialised object graph
  (e.g. some game saves).
- **Apple property lists** (`.plist`, XML and binary) - used by `.webloc`,
  configuration profiles, provisioning profiles, sprite atlases, game saves.

## Unknown files

- **Hex dump** with an ASCII column, SHA-256 hash, size and path.
- Smart text previews for anything that turns out to be plain text, JSON or XML
  (including UTF-16 detection), so an unknown file isn't just a wall of hex.
- Files with **no extension** are treated as text (with a hex fallback) rather than
  flagged as "unknown".

---

## Search

- **Metadata search** - a search box that highlights matching values across every
  result panel on the page, with next/previous navigation, and synonym expansion
  (search "fps" and it also matches "frame rate").
- **Format-catalog search** - an overlay to search all 1,269 formats by name,
  brand or extension, with category filters and expand/collapse all.

## Exporting your analysis

- **Export button** turns the on-screen analysis into a downloadable file:
  - **Self-contained HTML report** - every table and visual (spectrogram,
    histogram, palette, previews, maps) embedded as images, opens offline.
  - **CSV** - a flat Section/Group/Field/Value spreadsheet of all the text data.
  - **JSON** - machine-readable analysis data.
- SHA-256 hashes are computed and included; collapsed sections are expanded first
  so the export is complete.

## Comparing two files

- The **/compare** page takes two files and analyses both to the same depth as
  the main page, then merges the results into one table with a column each. Rows
  that differ are highlighted, and **Show differences** hides everything the two
  files agree on.
- Alongside the usual hashes it computes a **fuzzy hash** of each file and scores
  how alike they are out of 100. An ordinary hash only tells you whether two
  files are identical - change one byte and it changes completely. A fuzzy hash
  is built from chunk boundaries chosen by the content itself, so two builds of
  the same program, or a document before and after an edit, still produce two
  similar fingerprints, and the score tells you how much they have in common.

## Smart detection

- **Magic-byte sniffing** - it reads the file's actual leading bytes, so it can
  tell what something really is even if the extension is wrong or missing.
- **"Analyse as the real type" prompt** - if the extension lies, a popup offers to
  re-open it as the detected type.
- **Extensionless and git-internal files** are handled gracefully (text view, or
  git-object decoding).
- **RAW + XMP pairing** - drop a RAW photo and its `.xmp` together and the develop
  settings show up alongside the image.

## Offline and install (PWA)

- **Install to your home screen / desktop** like a native app.
- **Works fully offline** - the app shell is precached; pages load instantly and
  update quietly in the background when you're online (stale-while-revalidate).
- **Tiered offline downloads** in the footer, so you choose how much to store:
  - Essentials (~50 MB) - the whole app; open and inspect any file offline.
  - Everything (~78 MB, recommended) - adds OCR, HEIC, archives, QR, maps, DWG.
  - Complete (~325 MB) - adds OCR in 30+ languages and EPS/PostScript.
- **Heavy tools load only when needed** - FFmpeg (video), Tesseract (OCR),
  OpenCASCADE (CAD) and others download on first use, then are cached for offline.
- **Clear-storage / clear-scripts buttons** to wipe the cache and re-fetch fresh.

## Appearance and navigation

- **Dark mode** toggle, remembered between visits and respecting your system
  preference.
- **Subtle "glow" typography** - letters near the cursor brighten, with an intro
  sweep on the title.
- **Smooth SPA navigation** - pages (about, patch notes, formats, stats, privacy)
  swap using the View Transitions API instead of a hard reload.
- **Fully responsive** - dropzones, search and overlays adapt to phones and touch.
- **Navigation helpers** - sticky back bar, "scroll to data" button, and in-page
  section tabs (Photo/Sound/Video) that grey out when not relevant.

## Public stats page

- **Anonymous, privacy-preserving counters** - a visitor count and a tally of
  which file extensions get analysed (only the extension text, never the file).
- **Most-analysed formats** list with per-extension share, and a daily-trend graph
  (per-day or cumulative).
- Unrecognised types are counted too, as an honest wish-list of what to add next.
- Also hosts the **Asteroids high-score leaderboard** (see Extras).

## Format guide pages (for search engines and humans)

- **A guide page for every format** at `/formats/<ext>` ("what is a .X file / how to
  open it"), plus a searchable **`/formats` hub** listing them all by category.
- These are **generated from the same catalog**, so they can never drift from what
  the app actually supports.
- After you analyse a file, an **"About .EXT files"** link points to that format's
  guide.

## Helpful nudges, sharing and help

- **Suggest-a-format** prompt for files it only partly recognises (spam-protected
  with a human-check).
- **Share** button and a post-analysis nudge with context (e.g. "this revealed the
  EXIF from my JPG").
- **Inline help** - little [?] buttons next to technical readouts explain what each
  field means.
- **External-link confirmation** before leaving the site.

## Security warnings

- **`.env` secrets warning** - if you drop a `.env` file (or `.env.local`,
  `.env.production`, etc.), a loud **red banner** appears above the analysis:
  **"Never share this file with anyone, ever."** It explains that these files hold
  API keys, database passwords and tokens in plaintext, warns against posting them
  in chat/email/screenshots/issues/public repos, and tells you to rotate every
  secret if it has already been shared. The harmless template siblings
  (`.env.example`, `.env.sample`, `.env.template`, `.env.dist`, `.env.defaults`)
  are deliberately not flagged.

## Extras and details

- **Hidden Asteroids game** - reachable by the Konami code (or five taps on the
  subtitle on mobile); high scores (with the file extension that landed your final
  blow) appear on the public leaderboard.
- **Live version number** in the header that maps commit count to milestone
  releases.
- **Changelog** (`/patch`) with a condensed "tl;dr" view grouped by release era.
- **Accessibility throughout** - ARIA roles on dialogs, toggles and alerts,
  keyboard support (Escape to close, focusable controls), and graceful degradation
  when a browser API isn't available.

---

## Under the hood (for the technically curious)

- **Vanilla web stack** - HTML, CSS and ES-module JavaScript; no framework, no
  build step, no `node_modules`.
- **Heavy lifting via WebAssembly**, loaded on demand: FFmpeg (video transcode),
  Tesseract (OCR), ImageMagick/LibRaw (RAW), OpenCASCADE (CAD), LibreDWG (DWG),
  Ghostscript (PostScript/EPS), OpenJPEG (JPEG 2000), libarchive (RAR/7z/tar).
- **Notable JS libraries** - pdf.js, ag-psd, opentype.js, SheetJS, foliate-js,
  mdb-reader, DjVu.js, sql.js, Leaflet, exifr.
- **One tiny server-side piece** - a Cloudflare Worker that only stores the two
  anonymous counters; the analysis itself is 100% in your browser.
- **Deployed as static files to Cloudflare**, with clean URLs and an offline
  service worker.
</content>
