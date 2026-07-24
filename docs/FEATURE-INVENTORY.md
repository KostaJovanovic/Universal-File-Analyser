# Feature inventory

Working checklist (not shipped polish) of every user-triggerable control on
the site, built mechanically from the `ROUTES` table in
`web/assets/js/core/app.js` and a grep of `anr-btn`/`addEventListener`/
`<button`/`<select`/quoted label strings across every renderer. This is the
contract Phase D (`docs/features/*.md`) must satisfy - tick a row once its
feature doc covers it. Grouped by the feature doc that owns it.

**Note on `vssolution.js`**: this renderer is not assigned to any
`docs/features/*.md` file in `research/DOCS_PLAN.md`'s deliverables table
(a gap in the plan). It has no interactive controls (pure VS-solution
metadata display), so it is listed under `data-archive.md` here for
consistency with its domain grouping in [`renderers.md`](renderers.md), and covered
there in Phase D.

---

## docs/features/images.md

- [x] photo.js - Run full analysis - re-analyses a recovered/repaired image - images.md
- [x] photo.js - Download recovered image - downloads a salvaged image - images.md
- [x] photo.js - Choose reference photo... - picks a healthy reference photo to repair a damaged JPEG header - images.md
- [x] photo.js - Analyse (carved/partial image) - analyses a carved image fragment - images.md
- [x] photo.js - Download (carved/partial image) - downloads that fragment - images.md
- [x] photo.js - Cancel / Run OCR - OCR language-picker dialog actions - images.md
- [x] photo.js - Analyse live photo - analyses the video/audio half of an iPhone Live Photo - images.md
- [x] photo.js - Extract text - runs OCR on the image - images.md
- [x] photo.js - Prev / Next (frame stepper) - step through animation frames - images.md
- [x] photo.js - Analyse frame - analyses the current animation frame as a photo - images.md
- [x] photo.js - Generate contact sheet - builds a thumbnail grid of animation frames - images.md
- [x] photo.js - Reverse (animated GIF/WebP) - reverses the animation - images.md
- [x] photo.js - Download reversed (GIF) - downloads the reversed animation - images.md
- [x] photo.js - Demosaic RAW (full decode) - loads the heavyweight RAW decoder for full-quality demosaicing - images.md
- [x] photo.js - Download photo / Download photo (JPEG) - downloads the (possibly converted) photo - images.md
- [x] photo.js - Import XMP settings - applies an external .xmp sidecar's edit settings - images.md
- [x] photo.js - Sonify (play as spectrogram) - opens the image-as-audio sonifier - images.md
- [x] photo.js - Download as JPEG - downloads a format-converted copy - images.md
- [x] sonify.js - Render - renders the image/data as audio and runs it through the full audio analyser (never auto-plays) - images.md
- [x] sonify.js - Download WAV - downloads the rendered audio - images.md
- [x] tiff.js - (uses embedded-images.js's Download/Analyse per page; multi-page decode via photo-convert.js) - images.md
- [x] mpo.js - (uses embedded-images.js's Download/Analyse per stereo-pair image) - images.md
- [x] ico.js - (uses embedded-images.js's Download/Analyse per icon image) - images.md
- [x] embedded-images.js - Download (per embedded image) - downloads that extracted image - images.md
- [x] embedded-images.js - Analyse (per embedded image) - runs the extracted image through the full photo analyser - images.md
- [x] photo-convert.js - no controls of its own (HEIC/RAW/X3F conversion helper, consumed by photo.js/tiff.js) - images.md
- [x] photo-recover.js - no controls of its own (JPEG/PNG/HEIF repair helper, consumed by photo.js) - images.md
- [x] spectrogram.js (image tie-in via sonify.js) - see sonify.js rows above - images.md

## docs/features/audio.md

- [x] audio.js - Save PNG - exports the spectrogram canvas as an image - audio.md
- [x] audio.js - Fullscreen - expands the spectrogram view fullscreen - audio.md
- [x] audio.js - Isolate - opens the frequency-isolation (band-stop EQ) tool panel - audio.md
- [x] audio.js - Record - starts microphone recording - audio.md
- [x] audio.js - Live spectrogram - switches to a live/real-time spectrogram of the mic - audio.md
- [x] audio.js - + Custom band - adds a new isolate frequency band - audio.md
- [x] audio.js - Download WAV (isolate panel) - exports the isolated-band audio as WAV - audio.md
- [x] audio.js - AI separation - runs an in-browser AI stem-separation model - audio.md
- [x] audio.js - AI denoise (DeepFilterNet3) - removes background noise on-device (Clean/Noise blend) - audio.md
- [x] audio.js - Standard / Lite (mobile) - choose which AI separation model tier to use - audio.md
- [x] audio.js - Remove band (x, per band row) - deletes a custom isolate band - audio.md
- [x] audio.js - Clear (presets) - clears the active EQ preset - audio.md
- [x] audio.js - Preset buttons (per EQ preset) - apply a named frequency preset - audio.md
- [x] audio.js - Play (stem blend row) - plays a separated stem - audio.md
- [x] audio.js - Analyse / Download WAV (per separated stem) - analyse or download a generated stem - audio.md
- [x] audio.js - Download and continue / Start separation (Yes) / Cancel - AI model download/run confirm dialog - audio.md
- [x] audio.js - Zoom / Export WAV (waveform selection) - zoom into or export the selected time range - audio.md
- [x] audio.js - Reset zoom - returns the zoomed waveform to full view - audio.md
- [x] audio.js - Download recording - downloads a mic recording as an audio file - audio.md
- [x] audio.js - Channel picker (Mix/L/R/etc.) - choose which channel feeds the spectrogram/waveform - audio.md
- [x] audio.js - Stop / Pause (live capture) - stops or pauses a live recording/spectrogram session - audio.md
- [x] audio.js - Analyse last Ns (live view) - analyses the last N seconds of a live capture - audio.md
- [x] audio-player.js - play-pause-replay transport button - shared transport, used inside audio.js and video.js players - audio.md
- [x] audio-player.js - Mute button + volume popup slider (0-225%) - mute/unmute and set volume - audio.md
- [x] audio-player.js - Seek track (draggable) - scrub playback position - audio.md
- [x] media-reverse.js - Reverse audio - renders and plays the audio reversed - audio.md
- [x] media-reverse.js - Download reversed (WAV) - downloads the reversed clip - audio.md
- [x] media-reverse.js - Analyse reversed - runs the reversed clip through the full analyser - audio.md
- [x] audio-analysis.js - no controls (pure DSP computation, consumed by audio.js) - audio.md
- [x] audio-codec.js - no controls (container/codec sniffing helper) - audio.md
- [x] spectrogram.js - no controls (pure FFT/spectrogram computation, consumed by audio.js) - audio.md

## docs/features/video.md

- [x] video.js - Prev frame / Next frame - step through video frames - video.md
- [x] video.js - Analyse frame / Analyse in Photo section - analyses the current frame as a photo - video.md
- [x] video.js - Sonify - opens the image-as-audio sonifier on the current frame - video.md
- [x] video.js - Download audio (WAV) - downloads extracted audio track - video.md
- [x] video.js - Analyse audio - runs extracted audio through the audio analyser - video.md
- [x] video.js - Analyse photo - runs current frame through the photo analyser - video.md
- [x] video.js - Reverse video - re-encodes the video reversed via FFmpeg - video.md
- [x] video.js - Analyse reversed / Download reversed (MP4) - analyse or download the reversed clip - video.md
- [x] video.js - Detect scene changes - scans for scene cuts - video.md
- [x] video.js - Run again (current part) - reruns scene detection on the currently loaded segment - video.md
- [x] video.js - Prev / Next (segmented playback) - step through video segments - video.md
- [x] video.js - Compute SHA-256 - computes and shows the file's full hash - video.md
- [x] video.js - Salvage video - reconstructs playback for a video missing its codec index - video.md
- [x] video.js - Choose reference clip... - picks a healthy clip to borrow codec setup from for salvage - video.md
- [x] video.js - Convert to H.264 and play - re-encodes an undecodable codec to H.264 via FFmpeg - video.md
- [x] video.js - Extract first frame - grabs a single frame via FFmpeg when no native preview exists - video.md
- [x] video.js - Generate contact sheet - builds a thumbnail grid of frames - video.md
- [x] video-avi.js - no controls (AVI container parsing helper) - video.md
- [x] video-recover.js - no controls (moov-less MP4/MOV recovery helper) - video.md
- [x] video-sync.js (core/) - no controls (shared player<->analysis scrub-sync helper) - video.md
- [x] sony-rtmd.js - Export CSV - exports gyro/accelerometer metadata as CSV - video.md
- [x] sony-rtmd.js - Export Gyroflow (.gcsv) - exports in Gyroflow's stabiliser format - video.md

## docs/features/animation-frames.md

- [x] gif-frames.js - no controls (frame decoder, consumed by photo.js/unknown.js) - animation-frames.md
- [x] gif-encode.js - no controls (encoder helper, consumed by photo.js's reverse-GIF feature) - animation-frames.md
- [x] webp-frames.js - no controls (frame decoder helper via WebCodecs ImageDecoder) - animation-frames.md
- [x] lottie.js - Pause / Play - toggles animation playback - animation-frames.md
- [x] lottie.js - Playback speed (select, 0.25x-2x) - animation-frames.md
- [x] lottie.js - Loop - toggles looping - animation-frames.md
- [x] lottie.js - Scrub range slider - seek to a frame - animation-frames.md

## docs/features/documents.md

- [x] pdf.js - Show next N pages / Show all - reveal more page thumbnails - documents.md
- [x] pdf.js - Copy (per page) - copies that page's text - documents.md
- [x] pdf.js - Extract embedded images - pulls embedded images out of the PDF - documents.md
- [x] pdf.js - Analyse (per extracted image) - runs an extracted image through the photo analyser - documents.md
- [x] pdf.js - Scan all pages (OCR) / Show more / Show all - runs OCR across image-only pages - documents.md
- [x] paged.js - Show next N pages / Show all - reveal more pages of a paginated preview - documents.md
- [x] paged.js - Copy all text / Copy (per page) - copies extracted text - documents.md
- [x] djvu.js - Prev / Next - pages through the DjVu reader - documents.md
- [x] docx.js - Embedded image click - analyses an inline image as a photo - documents.md
- [x] xlsx.js - Sheet tab buttons - switch between spreadsheet sheets - documents.md
- [x] xlsx.js - (lazily mounts tablekit.js's table/chart toolkit on the active sheet) - documents.md
- [x] xlsb.js - Sheet tab buttons - switch between spreadsheet sheets - documents.md
- [x] xlsb.js - (lazily mounts tablekit.js's table/chart toolkit on the active sheet) - documents.md
- [x] pptx.js - Slide thumbnail click - opens that slide full-size in a lightbox - documents.md
- [x] pptx.js - close (x) button - closes the slide lightbox - documents.md
- [x] pptx.js - Embedded image click (inside a slide) - analyses that image as a photo - documents.md
- [x] odf.js - (reuses paged.js pagination for text; mounts tablekit.js for ODS spreadsheets) - documents.md
- [x] legacy-office.js - (reuses paged.js pagination for legacy .doc/.ppt text; plain link list) - documents.md
- [x] textdoc.js - (reuses paged.js's pagination controls: Show next N pages/Show all, Copy) - documents.md
- [x] iwork.js - Analyse this image - runs the document's preview image through the photo analyser - documents.md
- [x] epub.js - Prev / Next - pages through the EPUB reader - documents.md
- [x] epub.js - Chapter select (dropdown) - jump to a specific chapter - documents.md
- [x] mobi.js - Prev / Next - pages through the MOBI reader - documents.md
- [x] mdb.js - Table tab buttons - switch between database tables - documents.md
- [x] notebook.js - Show more cells / Show all - reveal more Jupyter notebook cells - documents.md
- [x] markdown.js - no controls found beyond static rendered output (verify further in Phase D) - documents.md

## docs/features/design-cad-3d.md

- [x] svg.js - Analyse as image - rasterises the SVG to PNG and runs the full photo analysis pipeline - design-cad-3d.md
- [x] illustrator.js - (delegates to pdf.js's renderPdf; inherits all pdf.js controls) - design-cad-3d.md
- [x] psd.js - Analyse this image (composite + embedded-preview variants) - design-cad-3d.md
- [x] psd.js - PNG (per layer) - downloads that PSD layer as a PNG - design-cad-3d.md
- [x] paint.js - Analyse this image - runs the artwork preview through the photo analyser - design-cad-3d.md
- [x] diagram.js - no controls found (pure diagram/flowchart metadata display) - design-cad-3d.md
- [x] lut.js - Choose photo or video - opens a picker to preview the LUT on a custom image/video - design-cad-3d.md
- [x] font.js - Play-all (glyph animation) - plays/stops cycling through all glyphs - design-cad-3d.md
- [x] font.js - Font-in-collection select - switch which font in a multi-font collection is shown - design-cad-3d.md
- [x] stl.js - Scroll zoom on/off - toggles wheel-zoom on the 3D viewer - design-cad-3d.md
- [x] stl.js - Fullscreen - toggles fullscreen viewer - design-cad-3d.md
- [x] stl.js - Zoom in / Zoom out (hold) - camera zoom - design-cad-3d.md
- [x] stl.js - Pause spin / Resume spin - toggles auto-rotate - design-cad-3d.md
- [x] stl.js - Quality (popup) - anti-aliasing/quality settings - design-cad-3d.md
- [x] stl.js - Reset view - resets camera - design-cad-3d.md
- [x] stl.js - Orthographic / Perspective - toggles projection - design-cad-3d.md
- [x] stl.js - Wireframe - toggles wireframe render mode - design-cad-3d.md
- [x] stl.js - Y-up / Z-up - flips which axis is "up" - design-cad-3d.md
- [x] stl.js - Part chips (per part/assembly) - view a single part or the whole assembly - design-cad-3d.md
- [x] model3d.js - (reuses stl.js's entire viewer control set) - design-cad-3d.md
- [x] model3d.js - Open <plate> (per embedded sliced plate) - loads embedded G-code into the full G-code viewer - design-cad-3d.md
- [x] model3d.js - (renders 3MF ZIP contents via archive.js's renderArchiveEmbedded) - design-cad-3d.md
- [x] gcode.js - Scroll zoom on/off / Fullscreen / Zoom in / Zoom out - viewer camera controls - design-cad-3d.md
- [x] gcode.js - Colour by (select) - choose what colours the toolpath - design-cad-3d.md
- [x] gcode.js - Show/Hide legend - toggles the colour legend overlay - design-cad-3d.md
- [x] gcode.js - Pause spin / Resume spin / Reset view / Orthographic / Perspective - camera controls - design-cad-3d.md
- [x] gcode.js - Quality (popup: Hardware MSAA / Supersampling / min line width) - render-quality toggles - design-cad-3d.md
- [x] gcode.js - Travel / Rapids / Bed / feature-tool colour chips - visibility toggles - design-cad-3d.md
- [x] gcode.js - Play - plays the toolpath build animation - design-cad-3d.md
- [x] gcode.js - Follow toolhead (cycling) - camera-follow modes for the print head - design-cad-3d.md
- [x] gcode.js - Speed (popup: presets, custom rate, unit toggle) - playback-speed controls - design-cad-3d.md
- [x] gcode.js - Tool changes / Dim other tools - toggles for tool-change markers and dimming - design-cad-3d.md
- [x] gcode.js - Export clip / Cancel (clip export) / Clip option chips - renders and downloads an MP4 clip of the build - design-cad-3d.md
- [x] gcode.js - More controls - expands/collapses the fullscreen toolbar - design-cad-3d.md
- [x] gcode.js - Show full anyway / Show all N lines - bypasses the line cap on very large files - design-cad-3d.md
- [x] unity.js - no controls found (pure asset-bundle display) - design-cad-3d.md
- [x] dwg.js - no controls of its own (renders a sanitised SVG preview via svg.js's sanitiser) - design-cad-3d.md
- [x] solidworks.js - no controls found (pure CFBF/metadata display) - design-cad-3d.md
- [x] f3d.js - no controls found (pure Fusion 360 archive metadata display; uses zip.js internally) - design-cad-3d.md

## docs/features/eda-nle.md

- [x] altium.js - Fit - reset schematic/PCB view to fit the viewport - eda-nle.md
- [x] altium.js - Layer chips (per layer) - toggle layer visibility on the board view - eda-nle.md
- [x] altium.js - Tab buttons (per sheet) - switch between multi-sheet schematic tabs - eda-nle.md
- [x] altium.js - Designator buttons (per BOM row) - jump to and highlight that part on its schematic sheet - eda-nle.md
- [x] kicad.js - Fit / Reset view - reset schematic/3D view - eda-nle.md
- [x] kicad.js - Layer chips - toggle PCB layer visibility - eda-nle.md
- [x] kicad.js - Flip over - flips the 3D board view to the other side - eda-nle.md
- [x] kicad.js - Quality (popup) / Supersampling - render-quality toggles - eda-nle.md
- [x] kicad.js - 3D board / Top / Bottom - switch board view mode - eda-nle.md
- [x] kicad.js - Symbol select (dropdown) - pick a schematic symbol/footprint to preview - eda-nle.md
- [x] kicad.js - Designator buttons (per BOM row) / PCB - jump to that part on schematic or board view - eda-nle.md
- [x] kicad.js - Tab buttons - switch between multi-sheet schematic tabs - eda-nle.md
- [x] spice.js - Legend chips (per trace) - toggle a simulation trace's visibility on the waveform chart - eda-nle.md
- [x] ipcnet.js - no controls found (pure IPC-D-356 netlist metadata display) - eda-nle.md
- [x] aftereffects.js - Zoom out / Zoom in / Reset - zoom the composition preview canvas - eda-nle.md
- [x] premiere.js - Zoom out / Zoom in / Reset - zoom the Premiere project preview canvas - eda-nle.md
- [x] davinci.js - Zoom out / Zoom in / Reset - zoom the DaVinci resource/timeline preview canvas - eda-nle.md
- [x] vegas.js - no controls found (pure Sony VEGAS project metadata display) - eda-nle.md
- [x] sony-rtmd.js - (also listed under video.md - Export CSV / Export Gyroflow) - eda-nle.md
- [x] timeline.js - no controls found (pure EDL/FCPXML/OTIO timeline display) - eda-nle.md

## docs/features/data-archive.md

- [x] csv.js - (lazily mounts tablekit.js's full interactive table/chart toolkit) - data-archive.md
- [x] gcsv.js - no controls of its own (builds IMU data/timeline consumed by csv.js's tablekit view) - data-archive.md
- [x] dataview.js - Show more / Show all - reveal more rows of a data preview table - data-archive.md
- [x] dataview.js - Show full source - reveals full source text instead of a truncated preview - data-archive.md
- [x] gitobject.js - Analyse blob content - re-runs the git blob's sniffed content through the full analyser - data-archive.md
- [x] email.js - Show more messages - reveals additional messages in a multi-message file - data-archive.md
- [x] archive.js - Verify entry CRCs (N files) - recomputes each entry's CRC-32 against the stored value - data-archive.md
- [x] archive.js - Analyse <inner file> - opens a single-file-compressed archive's inner file in the full analyser - data-archive.md
- [x] zip.js - no controls found (pure ZIP entry-listing/extraction helper, consumed by many renderers) - data-archive.md
- [x] folder.js - Copy paths (N formats) - copies one sample file path per unrecognised format - data-archive.md
- [x] folder.js - Show folder analysis - reveals the full folder analysis panel - data-archive.md
- [x] folder.js - Check which files open (N) - scans every file in the folder for unopenable/unrecognised ones - data-archive.md
- [x] treemap.js - Canvas click - zoom into a folder tile, or open a file's action menu - data-archive.md
- [x] treemap.js - Cancel / Copy / Analyse (per-file popup menu) - copy path or run full analysis - data-archive.md
- [x] treemap.js - Breadcrumb ("All files" / folder buttons) - navigate back up the zoom stack - data-archive.md
- [x] treemap.js - close (x) button - closes the aggregated "N files" popup list - data-archive.md
- [x] treemap.js - Filter-by-name search box - narrows a long tiny-file list in the popup - data-archive.md
- [x] treemap.js - Row click (aggregated list) - analyses that file - data-archive.md
- [x] folder-archive-shared.js - Filter by type - popup of per-extension chips to filter the treemap - data-archive.md
- [x] comic.js - Read (N pages) - opens the comic page reader/lightbox from page 1 - data-archive.md
- [x] midi.js - no controls found (pure MIDI event/track display, no playback) - data-archive.md
- [x] subtitles.js - no controls found (pure subtitle-cue display) - data-archive.md
- [x] lrc.js - no controls found (pure lyrics display) - data-archive.md
- [x] table-stats.js (lib/) - no controls (pure DOM-free table-statistics helpers shared by csv.js/tablekit.js) - data-archive.md
- [x] tablekit.js - Columns (menu) - show/hide table columns - data-archive.md
- [x] tablekit.js - Column/Delimiter selects + Split / Undo split - splits a column on a delimiter - data-archive.md
- [x] tablekit.js - Dates: M/D/Y (US) / D/M/Y - toggles ambiguous-date parsing convention - data-archive.md
- [x] tablekit.js - Up/Down (per column) - reorder columns - data-archive.md
- [x] tablekit.js - Apply / Clear (filter popup) - apply or clear a per-column filter - data-archive.md
- [x] tablekit.js - Group-by key/aggregate/value selects + Plot as bar - configure and chart a group-by summary - data-archive.md
- [x] tablekit.js - Chart-type buttons (Bar/Line/Pie/etc.) - pick chart type in the chart builder - data-archive.md
- [x] tablekit.js - Plot selected range - charts the currently selected table cells - data-archive.md
- [x] tablekit.js - Stacked: on/off - toggles stacked chart mode - data-archive.md
- [x] tablekit.js - Suggested chart buttons - one-click suggested chart specs - data-archive.md
- [x] tablekit.js - Export chart PNG / Export stats JSON / Export rows CSV - export the current chart/table - data-archive.md
- [x] vssolution.js - no controls found (pure VS-solution metadata display; **not assigned in DOCS_PLAN, placed here per domain grouping**) - data-archive.md

## docs/features/cross-cutting.md

- [x] unknown.js - Show full text - reveals the full text of an unrecognised file - cross-cutting.md
- [x] unknown.js - Play as Lottie animation - detects JSON that looks like Lottie and plays it - cross-cutting.md
- [x] unknown.js - Analyse / Download (carved image fragment) - analyse or download a carved/recovered image fragment - cross-cutting.md
- [x] compare.js - <Analyse label> (both files) - central CTA firing both files' embedded analyse actions at once - cross-cutting.md
- [x] compare.js - Show differences / Show everything - toggles fading rows where compared files match - cross-cutting.md
- [x] proprietary.js - Run query - executes a read-only SQL query against an embedded SQLite database - cross-cutting.md
- [x] proprietary.js - Per-axis variable-font sliders + play (per axis) - live-adjust/animate each font variation axis - cross-cutting.md
- [x] proprietary.js - Desktop / Mobile - toggles viewport width for an embedded HTML document preview - cross-cutting.md
- [x] proprietary.js - Open full - opens the full raw source text in a full-screen overlay - cross-cutting.md
- [x] osint.js (core/) - to verify in Phase D: click-to-open lookup links for extracted URLs/IPs/domains/emails - cross-cutting.md
- [x] export-data.js (core/) - Export data - builds and downloads a JSON/hash export of the analysis - cross-cutting.md
- [x] search.js (core/) - metadata search box - to verify in Phase D - cross-cutting.md
- [x] forensics.js (core/) - signature/trailing-data integrity cards - to verify interactivity in Phase D - cross-cutting.md
- [x] app.js - SHA-256/hash cell wiring - to verify in Phase D (async hash fill-in behaviour) - cross-cutting.md

---

## Coverage notes

- Every `ROUTES` renderer in `app.js` is represented above via its owning
  module (photo/audio/video/docx/xlsx/... map 1:1 to the renderer files
  listed).
- Every `anr-btn`-creating renderer found by `Grep pattern="anr-btn"
  path="web/assets/js/renderers"` (40 files, matching the plan's stated
  count) is represented with its button labels.
- Renderers with no `anr-btn` hits were additionally checked for
  `addEventListener`/`<select`/`<input type=range>` controls; most are pure
  metadata-display modules with no interactivity, noted as such above.
- Lazy sub-feature relationships (e.g. `photo.js` -> `sonify.js`,
  `model3d.js` -> `stl.js`/`gcode.js`/`archive.js`, `illustrator.js` ->
  `pdf.js`, `csv.js`/`xlsx.js`/`xlsb.js`/`odf.js` -> `tablekit.js`,
  `odf.js`/`legacy-office.js`/`textdoc.js` -> `paged.js`,
  `tiff.js`/`ico.js`/`mpo.js` -> `embedded-images.js`) are noted inline so
  the owning feature doc credits the sub-feature to its parent's workflow.
