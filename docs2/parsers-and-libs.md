# Parsers and libraries

The long tail of format support: the lazy per-domain metadata parser chunks in
`web/assets/js/parsers/`, the shared binary/WASM loader helpers in
`web/assets/js/lib/`, and the third-party libraries vendored under
`web/assets/vendor/`. This doc explains how a proprietary file's header gets
decoded without bloating the initial page, and which features pull in which
engine.

## The lazy parser chunks (`web/assets/js/parsers/`)

When `renderProprietary()` (`web/assets/js/renderers/proprietary.js`) can't parse a
format with one of its built-in `PARSERS[ext]` functions, it looks at
`FORMATS[ext].chunk` and dynamically imports `parsers-<chunk>.js`, then calls that
chunk's `PARSERS[ext]`. So the ~200+ header parsers are split into 15 domain chunks
that load only when a matching file is opened - the boot bundle stays flat as the
format count grows.

### The parser contract (`parser-util.js`)

Every parser - built-in or chunked - has the same signature:

```
ParseFn = (ctx: { head: Uint8Array, file: File, ext: string })
            => Rows | null | Promise<Rows | null>
```

`Rows` is a plain `{ label: value }` object, optionally carrying `_`-prefixed
payloads (`_app`, `_help`, `_fileList`, `_readableText`, `_previewNode`,
`_sections`, `_font`) that the renderer renders specially. Returning a falsy value
declines and falls through to generic handling. `safe(fn)` (the only export of
`parser-util.js`) wraps every parser so a throw becomes `null` - one bad parser can
never reject the whole render.

### The 16 chunk files

| Chunk file | Domain |
|---|---|
| `parser-util.js` | Shared `safe()` wrapper + the parser contract (not a chunk). |
| `parsers-archive.js` | Archives, compression, packages, installers. |
| `parsers-audio.js` | Lossless/hi-res audio, containers, speech, tracker/module. |
| `parsers-dev.js` | Developer / data / serialization formats. |
| `parsers-disk.js` | Disk images, filesystems, firmware, virtualization. |
| `parsers-docs.js` | Documents, e-books, publishing (the long tail). |
| `parsers-email.js` | Email / calendar / contacts / PIM. |
| `parsers-gaming.js` | Gaming / emulation / console / game assets (the largest chunk). |
| `parsers-geodata.js` | Geospatial / GIS / remote-sensing. |
| `parsers-image.js` | Additional still-image formats. |
| `parsers-osmisc.js` | OS-specific / system / miscellaneous / obscure. |
| `parsers-raw.js` | Camera RAW edit sidecars (`chunk: 'raw'`). |
| `parsers-sci.js` | Science / medical / engineering / simulation. |
| `parsers-security.js` | Security / crypto / keys / certs / auth / forensics. |
| `parsers-threed.js` | 3D / CAD / mesh / scene / point-cloud. |
| `parsers-video.js` | Video / streaming containers & manifests. |

All chunk parsers import shared DOM/format helpers (`el`, `row`, `fmtBytes`,
`preBlock`, `readSlice`, `fmtDate`, `loadScript`) from `core/util.js`. Every chunk
is listed in `sw.js` `SHELL`, so once the app shell is cached the chunk import is
instant and offline-safe.

## Shared binary + WASM loader helpers (`web/assets/js/lib/`)

These are the reusable decoders and lazy WASM-engine loaders that multiple
renderers share. A "loader" fetches and initialises a vendored WASM engine on first
use and caches it; the pure-JS ones decode inline.

| Lib file | What it provides | Used by |
|---|---|---|
| `cfbf.js` | OLE2 / Compound File Binary Format reader. | legacy Office, SolidWorks, Altium, many proprietary parsers. |
| `plist.js` | Apple Property List (binary + XML) parser. | iWork, Apple/macOS formats. |
| `nrbf.js` | .NET Binary Formatter (NRBF) decoder. | proprietary.js and .NET-serialised formats. |
| `sqlite.js` | Lazy sql.js loader (SQLite query/analysis). | `proprietary.js` SQLite view. |
| `libarchive-loader.js` | Lazy libarchive.js WASM (RAR/7z/tar extraction). | archive browse-as-archive, folder scan. |
| `xz-loader.js` | Lazy xz (LZMA2) decompressor. | single-stream `.xz` open. |
| `lzma-loader.js` | Lazy LZMA-alone (`.lzma`) decompressor. | single-stream `.lzma` open. |
| `legacy-decompress.js` | Pure-JS decompressors for legacy single-stream codecs. | `.gz`/`.z`/etc. open. |
| `openjpeg-loader.js` | Lazy OpenJPEG (JPEG 2000) decoder glue. | JPEG 2000 images. |
| `ghostscript-loader.js` | Lazy Ghostscript WASM. | PostScript / EPS. |
| `occt-loader.js` | Lazy OpenCASCADE (occt-import-js). | STEP/IGES/BREP tessellation in `model3d.js`. |
| `table-stats.js` | Pure table-statistics helpers. | the `tablekit.js` workbench. |
| `mdx-model.js` · `mdx-stft.js` · `mdx-separate.js` · `mdx-client.js` · `mdx-worker.js` | The MDX-Net on-device vocal-separation subsystem (ONNX Runtime config, STFT/ISTFT core, DSP pipeline, main-thread client, module worker). | `audio.js` isolate panel + the spectrogram vocal/instrumental blend. |

The MDX model itself is cached in the `analyser-mdx` cache, which survives service-
worker version bumps (see `docs2/pwa-offline.md`) so an update doesn't force a
multi-megabyte model re-download.

## Vendored libraries (`web/assets/vendor/`)

Third-party engines are served locally (never from a CDN in production) so the app
stays offline-capable. They load lazily - only when a file needs them.

| Vendor dir / file | Library | Feature it powers |
|---|---|---|
| `ffmpeg/` | FFmpeg (WASM) | Video remux, frame extraction, audio decode. |
| `imagemagick/`, `libraw/` | ImageMagick / LibRaw (WASM) | Camera-RAW photo conversion. |
| `pdfjs/` | pdf.js | PDF and modern `.ai` rendering. |
| `ghostscript/` | Ghostscript (WASM) | PostScript / EPS. |
| `tesseract/` | Tesseract | OCR (photos, PDF). |
| `opentype/` | opentype.js | Font glyph grids. |
| `ag-psd/` | ag-psd | Photoshop PSD/PSB. |
| `sheetjs/` | SheetJS | XLSB and spreadsheet parsing. |
| `sqljs/` | sql.js | SQLite databases. |
| `libarchive/` | libarchive.js | RAR / 7z / tar. |
| `xzwasm/`, `lzma/` | xz / LZMA | Single-stream compressors. |
| `openjpeg/` | OpenJPEG | JPEG 2000. |
| `occt` (loaded via `occt-loader`) | OpenCASCADE | STEP/IGES/BREP tessellation. |
| `djvu/` | DjVu.js | DjVu scans. |
| `foliate/` | foliate-js | Kindle/MOBI e-books. |
| `mdb/` | mdb-reader | Microsoft Access. |
| `libredwg/` | libredwg-web | AutoCAD DWG. |
| `leaflet/` | Leaflet | GPX/KML/GeoJSON maps. |
| `lottie/` | lottie-web | Lottie/dotLottie/TGS animation. |
| `exifr.umd.js` | exifr | Photo/video EXIF/GPS metadata (injected via `ensureExifr()`). |
| `fflate.js` | fflate | In-browser ZIP inflate (archives, OOXML, ODF, EPUB, 3MF). |
| `fzstd.js` | fzstd | Zstandard (Fusion 360 `.f3d`). |
| `heic2any.min.js` | heic2any | HEIC/HEIF decode. |
| `jsQR.js` | jsQR | QR-code detection in photos. |
| `mp4-muxer.min.mjs`, `webm-muxer.min.mjs` | mp4/webm muxers | Remux raw H.264/H.265 streams, export clips. |

For which user-facing feature each of these sits behind, see the corresponding
`docs2/features/*.md`.
