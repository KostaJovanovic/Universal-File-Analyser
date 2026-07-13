# Renderer catalog

Every renderer module in `web/assets/js/renderers/` (~82 files), grouped by
domain. Each renderer owns one top-level `kind` from the `ROUTES` table in
`web/assets/js/core/app.js` (or is a shared helper imported by one). This is a map,
not a usage guide - the deep feature reference lives in `docs2/features/`.

Most renderers are lazily imported by `ROUTES` (`lazy(path, name)`); a handful on
the hot path (`archive`, `proprietary`, `unknown`, `folder`, `compare`, `spice`)
are statically imported by `app.js`. Every renderer imports shared DOM/format
helpers from `core/util.js`.

## Photo / still images

| Module | kind | What it handles |
|---|---|---|
| `photo.js` | `photo` | The photo module: preview, EXIF/GPS/camera readout, dimensions, histogram, dominant colours, OCR, QR, AI-generation markers, sonify hook. The largest renderer. |
| `photo-convert.js` | (helper) | HEIC/HEIF (heic2any) and camera-RAW (ImageMagick WASM) decode before the photo pipeline can show pixels. |
| `photo-recover.js` | (helper) | Salvage broken/truncated/corrupt stills: repair a cut-off JPEG/PNG, rebuild a damaged JPEG header from a reference, carve embedded images from a blob. Stills twin of `video-recover.js`. |
| `sonify.js` | (helper) | Image -> sound (spectrogram inversion): oscillator-bank or Griffin-Lim. Lazy-imported by `photo.js`'s Sonify button; shipped in `sw.js` SHELL. |
| `tiff.js` | (helper) | Multi-page TIFF: extract every IFD image. |
| `mpo.js` | (helper) | MPO / Multi-Picture Format: extract each full-size image (stereo pairs). |
| `ico.js` | (helper) | ICO/CUR container: extract every embedded size/depth. |
| `embedded-images.js` | (helper) | Shared "Embedded images" card used by ICO/MPO/TIFF and others. |

## Audio

| Module | kind | What it handles |
|---|---|---|
| `audio.js` | `audio` | The audio module: uploaded files, mic recording, live spectrogram, players. Exports shared panel builders reused by `video.js`. |
| `audio-analysis.js` | (helper) | Pure-computation level stats over decoded sample buffers. |
| `audio-codec.js` | (helper) | Container/codec sniff from header; wraps raw AAC (ADTS). |
| `audio-player.js` | (helper) | Custom `<audio>` transport (play/pause, draggable seek). |
| `spectrogram.js` | (helper) | The spectrogram engine (window functions, FFT). |
| `media-reverse.js` | (helper) | Reversed audio playback + download. |

## Video

| Module | kind | What it handles |
|---|---|---|
| `video.js` | `video` | The video module: playback, container/codec/fps, per-frame/stream analysis. Imports panels from `audio.js`. |
| `video-avi.js` | (helper) | AVI (RIFF) container parsing (MJPEG + PCM etc. the browser can't play). |
| `video-recover.js` | (helper) | Recover playable video from a truncated/unfinalised MP4/MOV with no moov index (carve H.264/H.265 NALs from the mdat). |
| `sony-rtmd.js` | (helper) | Sony rtmd gyro/IMU timed-metadata extractor. |
| `gcsv.js` | `gcsv` | Gyroflow `.gcsv` IMU log viewer (plots gyro/accel traces). |
| `core/video-sync.js` | (helper) | Shared video<->analysis scrubbing/sync helpers (in `core/`). |

## Animation frames

| Module | kind | What it handles |
|---|---|---|
| `gif-frames.js` | (helper) | GIF frame decoder (LZW) to step through frames. |
| `webp-frames.js` | (helper) | Animated WebP frame decoder. |
| `gif-encode.js` | (helper) | Minimal animated-GIF encoder (powers reverse playback + export). |
| `lottie.js` | `lottie` | Lottie/Bodymovin JSON player, dotLottie `.lottie` ZIPs and Telegram `.tgs` gzip stickers (vendored lottie-web). |

## Documents, office, e-books

| Module | kind(s) | What it handles |
|---|---|---|
| `pdf.js` | `pdf` | PDF via pdf.js: pages, text, embedded images, OCR, metadata. Reused by `illustrator.js`. |
| `paged.js` | (helper) | Shared "page preview" presentation for documents. |
| `djvu.js` | `djvu` | DjVu scanned documents (DjVu.js). |
| `docx.js` | `docx` | Word OOXML simplified document view. |
| `xlsx.js` | `xlsx` | Excel OOXML worksheets. |
| `xlsb.js` | `xlsb` | Excel binary workbook (BIFF12, SheetJS path). |
| `pptx.js` | `pptx` | PowerPoint OOXML slides as cards. |
| `odf.js` | `odt`/`ods`/`odp`/`odg` | OpenDocument text/spreadsheet/presentation/graphics. |
| `legacy-office.js` | `doc`/`xls`/`ppt` | Legacy 97-2003 binary OLE2 Office. |
| `textdoc.js` | `rtf`/`abw`/`fb2`/`hwpx`/`mhtml`/`markup` | Text & lightweight-markup documents (RTF, AbiWord, FB2, HWPX, MHTML, DITA/TEI/LaTeX/…). |
| `iwork.js` | `iwork` | Apple Pages/Numbers/Keynote (QuickLook preview). |
| `epub.js` | `epub` | EPUB reader (metadata, cover, chapters). |
| `mobi.js` | `mobi` | Kindle/Mobipocket MOBI/AZW/AZW3 (foliate-js). |
| `mdb.js` | `mdb` | Microsoft Access `.mdb`/`.accdb` (mdb-reader). |
| `notebook.js` | `notebook` | Jupyter `.ipynb` viewer. |
| `markdown.js` | `markdown` | Markdown rendered view + stats. |
| `tablekit.js` | (helper) | Table-analysis workbench mounted below CSV/XLSX/XLSB/ODS (virtualised grid, sort/filter/search, group-by, chart builder). |

## Design, raster, vector, fonts

| Module | kind(s) | What it handles |
|---|---|---|
| `svg.js` | `svg` | SVG render + stats/element counts. |
| `illustrator.js` | `ai` | Modern `.ai` (PDF-based) via `pdf.js`. |
| `psd.js` | `psd` | Photoshop PSD/PSB composite + layer tree (ag-psd). |
| `paint.js` | `paint` | Krita/Procreate/Paint.NET embedded preview. |
| `diagram.js` | `drawio`/`dxf` | 2D vector diagrams (draw.io, DXF). |
| `lut.js` | `lut` | Colour LUT `.cube`/`.look` visualiser (curve, before/after, 3D scatter). |
| `font.js` | `font` | Font specimen + glyph grid (opentype.js, FontFace). |

## 3D, CAD, manufacturing

| Module | kind(s) | What it handles |
|---|---|---|
| `stl.js` | `stl` | STL binary/ASCII WebGL viewer. |
| `model3d.js` | `model3d` | OBJ/PLY/OFF/3MF/AMF/glTF/GLB native meshes + STEP/IGES/BREP via OpenCASCADE. |
| `gcode.js` | `gcode` | G-code toolpath reconstructor (printed shape or CNC cut path), build animation, video export. |
| `unity.js` | `unity` | Unity YAML asset stream (scenes, prefabs, materials, `.meta`). |
| `dwg.js` | `dwg` | AutoCAD DWG 2D drawing (libredwg-web). |
| `solidworks.js` | `solidworks` | SolidWorks OLE2 preview+metadata (old) / identify-only (modern encrypted). |
| `f3d.js` | `f3d` | Autodesk Fusion 360 `.f3d`/`.f3z` (Zstd ZIP): manifest/contents + render preview (BREP proprietary). |

## EDA / electronics

| Module | kind | What it handles |
|---|---|---|
| `altium.js` | `altium` | Altium Designer schematic/PCB/library (OLE compound files) as interactive vector view. |
| `kicad.js` | `kicad` | KiCad schematic/board/footprint/symbol/project (S-expression + JSON). |
| `spice.js` | `spice` | SPICE/LTspice `.raw` waveform viewer (also `sniffSpiceRaw`). |
| `ipcnet.js` | `ipcnet` | IPC-D-356(A) bare-board fabrication test netlist. |

## NLE / VFX projects, timelines

| Module | kind | What it handles |
|---|---|---|
| `aftereffects.js` | `aep` | After Effects `.aep`/`.aet` (RIFX tree) comp timelines. |
| `premiere.js` | `premiere` | Premiere Pro `.prproj`/`.prel` sequence timelines. |
| `davinci.js` | `davinci` | DaVinci Resolve `.drp`/`.drt` timelines. |
| `vegas.js` | `vegas` | Sony/MAGIX VEGAS `.veg`/`.vf` metadata/plugins. |
| `timeline.js` | `timeline` | EDL/FCPXML/OTIO interchange timeline view. |

## Media metadata / lyrics / subtitles

| Module | kind | What it handles |
|---|---|---|
| `midi.js` | `midi` | Standard MIDI File parser (tempo/key/tracks). |
| `subtitles.js` | `subtitles` | SRT/WebVTT/ASS/SSA/MicroDVD/SubViewer cues. |
| `lrc.js` | `lrc` | Timed-lyric `.lrc` files. |

## Data, tabular, dev, email

| Module | kind(s) | What it handles |
|---|---|---|
| `csv.js` | `csv` | CSV/TSV delimiter detect, typed columns, preview. |
| `dataview.js` | `har`/`jsondata`/`nfo` | HAR captures, JSON5/JSONC/HJSON, NFO text art. |
| `gitobject.js` | `git-object` | Git loose objects/packfiles (no git binary). Exports `sniffGitObject`. |
| `email.js` | `eml`/`mbox` | `.eml`/`.emlx`/`.mbox` message viewer. |
| `geo.js` | `geo` | GPX/KML/GeoJSON on a Leaflet map. |
| `vssolution.js` | `vssolution` | Visual Studio `.sln`/`.slnx` solution manifest. |

## Archives, folders, comics

| Module | kind(s) | What it handles |
|---|---|---|
| `archive.js` | `zip` (+ embedded) | ZIP inspection (fflate); `renderArchiveEmbedded` for APK/DOCX/RAR/7z/tar browse-as-archive. |
| `zip.js` | (helper) | Shared ZIP reader for ZIP-based formats. |
| `folder.js` | (folder drop) | Recursive dropped-folder walk (`webkitGetAsEntry`), analysability scan, nested opens. |
| `folder-archive-shared.js` | (helper) | Shared category classification, breakdown cards, treemap/tree toggle. |
| `treemap.js` | (helper) | Nested squarified treemap (WizTree-style size breakdown). |
| `comic.js` | `comic` | CBZ/CBR/CBT/CB7 comic reader. |

## Identification, fallback, cross-cutting

| Module | kind(s) | What it handles |
|---|---|---|
| `proprietary.js` | `proprietary`/`plaintext` | 200+ format identifier by magic bytes; lazy parser-chunk dispatch; `extractPeIcon`; the Plain Text view. |
| `proprietary-formats.js` | (data) | The `FORMATS` reference table driving `proprietary.js`. |
| `unknown.js` | `unknown`/`extensionless` | Hex dump, magic guess, entropy, SHA-256, OSINT card, still recovery. |
| `compare.js` | `compare` | The `/compare` side-by-side two-file view. |

Cross-cutting helpers that are not renderers but are invoked from many:
`core/forensics.js` (signature/trailing-data/integrity cards), `core/osint.js`
(network-indicator card), `core/export-data.js` (JSON/hash export),
`core/search.js` (metadata search). These are covered in
`docs2/features/cross-cutting.md`.
