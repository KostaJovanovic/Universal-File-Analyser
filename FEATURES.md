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
  rates), duration, codec/profile, and what app/muxer created it.
- **Frame capture** - grab the current frame as a PNG, or send it to the full
  photo analyser (histogram, colours, OCR and so on).
- **Audio track tools** - waveform, spectrogram and loudness for the video's
  sound; extract the audio as a WAV.
- **Plays formats browsers normally can't** - HEVC, ProRes, DNxHD, AV1, VC-1 and
  others are transcoded on-device with FFmpeg (WebAssembly), with a progress bar
  and offline caching.
- **Raw H.264/H.265 streams** - parses the parameter sets and re-wraps them into a
  playable MP4, handling huge files in memory-bounded chunks.
- **Scene-change detection** - finds cuts and shows a clickable thumbnail grid.
- **Reverse video** - re-encodes the clip backwards (chunked so it doesn't run out
  of memory) and lets you download it.
- **AVI / MPEG-TS specifics** - Motion-JPEG and PCM extraction, timestamp repair
  for AVCHD `.mts`/`.m2ts`.
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
  projects and anything else built on SQLite.

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

## Design and graphics

- **SVG** - safe preview (scripts and remote references stripped first); element
  breakdown; colour palette with click-to-copy; text extraction; rasterise to PNG
  and send to the photo analyser; detects the design tool that made it.
- **Photoshop** (`.psd`/`.psb`) - composite image plus a layer tree (names, blend
  modes, opacity, visibility, per-layer thumbnails); falls back to the embedded
  preview for CMYK/16-bit/huge files; always memory-safe.
- **Illustrator** (`.ai`) - modern PDF-based files open in the PDF viewer.
- **Painting apps** - Krita (`.kra`), Procreate, Paint.NET (`.pdn`) - shows the
  merged preview and canvas info.
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
  stats and frame-rate handling; flags image-based VobSub.
- **Lyrics** (`.lrc`) - timed lyric lines and ID tags, including word-level timing.
- **MIDI** - reads the score: tempo map, time/key signature, track and instrument
  names, General MIDI instruments, note count, drum detection (it's a score, so
  there's no audio playback - browsers can't synthesise it).
- **Maps/geodata** (GPX, KML, GeoJSON) - tracks/routes/waypoints on an
  OpenStreetMap map, with distance, elevation profile, ascent/descent, moving
  time, and heart-rate/cadence averages.
- **Visual Studio solutions** (`.sln`/`.slnx`) - projects and build configurations.

## Recognising the long tail (identification)

- For roughly 200+ proprietary formats it can't fully open, Analyser still
  **identifies the file by its magic bytes and extension** and pulls out header
  metadata. Domains covered include:
  - **Adobe** (PSD, InDesign, XD, Audition, Animate, plus Lightroom/swatch/brush
    sidecars).
  - **CAD/engineering** (SolidWorks, Fusion 360, Inventor, CATIA, Creo/Pro-E,
    Rhino, SketchUp, 3ds Max, Maya, Cinema 4D, Houdini, ZBrush, Parasolid, SAT).
  - **Audio production** (Ableton, FL Studio, Reaper, Logic, Pro Tools, Cubase,
    GarageBand).
  - **Game engines** (Godot, Unreal, Unity, Bink video).
  - **Disk images** (ISO, VHD/VHDX, VMDK, qcow2, VDI).
  - **Executables/packages** (Windows EXE/DLL/MSI, Android APK, iOS IPA, macOS DMG,
    Linux AppImage), plus deep PE analysis (architecture, compile date, sections,
    security mitigations like ASLR/DEP/CFG, imported DLLs, version info).
  - **ML/data-science** (Safetensors, GGUF models, NumPy arrays, WebAssembly, Java
    bytecode, Protocol Buffers, SQL dumps, source maps).
  - **Configs and scripts** across dozens of languages and build tools.
- **Header decoders** for many of these read out real detail - e.g. Blender
  version and bitness, FBX/glTF version, SWF compression, DWG release year.

## Binary containers it can crack open

- **SQLite** databases (via WebAssembly) - tables, schema, sample rows.
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
