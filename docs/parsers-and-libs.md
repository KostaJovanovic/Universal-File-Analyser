# Parsers and shared libs

How the ~200-format proprietary-file identification is split into lazy
per-domain parser chunks, and the shared binary/WASM loader helpers those
chunks (and renderers generally) build on. For engineers adding a new
identification-only format or tracing a WASM dependency.

## Lazy parser chunk dispatch

Every proprietary-format entry in `web/assets/js/renderers/proprietary-formats.js`
(the `FORMATS` table) may declare a `chunk` name. When `renderProprietary()`
(`web/assets/js/renderers/proprietary.js:3944`) opens a file whose format has
one, it dynamically imports `../parsers/parsers-<chunk>.js` and calls that
module's `PARSERS[ext]` function (`proprietary.js:3981`) - so only the
metadata-parsing code for the domain actually being opened is fetched, not
all ~200 formats' worth of parsers up front.

Every chunk follows the same contract, documented in
`web/assets/js/parsers/parser-util.js`:

```js
ParseFn = (ctx: { head: Uint8Array, file: File, ext: string })
            => Rows | null | Promise<Rows | null>
```

`Rows` is a plain `{ label: value }` object rendered as a readout, optionally
carrying `_`-prefixed extras: `_sections: [{ title, node, open? }]` for
collapsible blocks, `_previewNode` for an inline preview (a decoded
`<canvas>`, a vCard photo, ...), `_app`, `_help`, `_fileList`,
`_readableText`, `_font`. Returning `null`/falsy declines and falls through
to the generic identification card. `parser-util.js`'s `safe()` wraps a
parser so it can never throw into the caller.

## Parser chunks (`web/assets/js/parsers/`)

16 files, one per domain, each dependency-free unless noted:

| Chunk | Domain |
|---|---|
| `parsers-archive.js` | Archives, compression, packages, installers (TAR/GZIP/cpio/ar/deb/cab/rpm, raw compressors) |
| `parsers-audio.js` | Lossless/hi-res audio, containers, speech, instruments, trackers, chiptunes, Audacity projects |
| `parsers-dev.js` | Developer / data / serialization formats |
| `parsers-disk.js` | Disk images, filesystems, firmware, virtualisation (VM descriptors, cue sheets, MCU images) |
| `parsers-docs.js` | Documents, e-books, publishing (comic-book/OPC/ODF-flat/web-archive containers) |
| `parsers-email.js` | Email/calendar/contacts/PIM (MIME/eml, mbox, iCalendar, vCard) |
| `parsers-gaming.js` | Gaming / emulation / console / game assets |
| `parsers-geodata.js` | Geospatial/GIS/remote-sensing headers and metadata only (the interactive map lives in `geo.js`, not here) |
| `parsers-image.js` | Additional still-image formats not covered by `photo.js` |
| `parsers-osmisc.js` | OS-specific / system / misc / obscure formats |
| `parsers-raw.js` | Camera-RAW edit sidecars (Apple `.aae`, etc.) - the RAW images themselves go through `photo.js` |
| `parsers-sci.js` | Science / medical / engineering / simulation formats |
| `parsers-security.js` | Security / crypto / keys / certs / auth / forensics (PEM/CMS by hand, SHA-256 via `crypto.subtle`, p12/kdbx/evtx/hive/dmp/e01/etl) |
| `parsers-threed.js` | 3D/CAD/mesh/scene/point-cloud **header/metadata only** - no WebGL viewer (that's `model3d.js`/`stl.js`) |
| `parsers-video.js` | Video/streaming containers and manifests (HLS m3u8/m3u, DASH mpd, Smooth Streaming ism/ismc) |
| `parser-util.js` | Shared parser contract + `safe()` wrapper (not itself a domain chunk) |

## `parser-util.js`

Defines the `ParseFn` contract above and `safe(fn)`, which every chunk uses
to guarantee a parser failure degrades to `null` (falls back to the generic
identification card) instead of throwing into `renderProprietary()`.

## Shared lib/loader helpers (`web/assets/js/lib/`)

17 files. Split between pure-JS format decoders and lazy WASM/CDN loaders -
loaders have no top-level side effects, so the heavy dependency is only
fetched the first time a matching file is actually opened, then cached
(including by the service worker for offline use):

| File | Role |
|---|---|
| `cfbf.js` | Shared OLE2/Compound File Binary Format reader - the container behind Outlook `.msg`, pre-2007 Office, `.msi`, `Thumbs.db`, and other OLE structured-storage files; used by `altium.js`, `legacy-office.js`, `solidworks.js` |
| `plist.js` | Apple Property List parser (XML via `DOMParser`, binary `bplist00` via a compact object-table walker) - used across webloc, mobileconfig, provisioning profiles, sprite atlases, game saves |
| `sqlite.js` | Lazy loader for vendored **sql.js** (SQLite compiled to WASM) - used for GeoPackage, MBTiles, Audacity `.aup3`, and other SQLite-backed formats |
| `nrbf.js` | Decodes the [MS-NRBF] .NET Binary Formatter record stream (reconstructs the .NET object graph) |
| `legacy-decompress.js` | Small pure-JS decoders for bare (non-tar) legacy streams libarchive can't open alone: `unlz4()` (LZ4 frame format) and `unlzw()` (Unix `compress`/.Z) |
| `libarchive-loader.js` | Lazy loader for vendored **libarchive.js** (WASM extractor, worker-based) - powers ZIP/RAR/7z/etc. extraction in `archive.js`, `comic.js`, and others |
| `xz-loader.js` | Lazy loader for vendored **xzwasm** (LZMA2 `.xz` decompression via a `ReadableStream` transform) |
| `lzma-loader.js` | Lazy loader for vendored **js-lzma** decode-only core - the legacy single-stream "LZMA alone" `.lzma` container (distinct from `.xz`) |
| `openjpeg-loader.js` | Lazy loader for vendored **@cornerstonejs/codec-openjpeg** (JPEG 2000 decode, ~360KB WASM) |
| `ghostscript-loader.js` | Lazy loader for vendored **Ghostscript WASM** (~15MB) - rasterises EPS/PostScript to a PNG preview; part of the offline "Complete" tier only |
| `occt-loader.js` | Lazy loader for **OpenCASCADE** (`occt-import-js`) fetched from a CDN - tessellates STEP/IGES B-rep CAD geometry into triangle meshes for the WebGL viewer |
| `mdx-model.js` | MDX-Net vocal-separation model + ONNX Runtime configuration (Kim Vocal 2 / UVR MDX-Net); single source of truth for network files the offline "Complete" tier must cache |
| `mdx-stft.js` | Parameterised STFT/ISTFT core for MDX-Net - pure math, no DOM, Node-testable; handles non-power-of-two FFT sizes (6144/7680) via a mixed-radix split |
| `mdx-separate.js` | MDX-Net separation pipeline (pure DSP, model call injected) - mirrors the reference UVR/python-audio-separator "demix" algorithm |
| `mdx-client.js` | Main-thread client for the MDX-Net worker - resamples audio to 44.1kHz, relays progress, returns vocal/instrumental stems |
| `mdx-worker.js` | The MDX-Net separation Web Worker - loads onnxruntime-web (WASM, single-threaded, no cross-origin isolation), downloads the pinned model, runs the pipeline off the main thread |
| `table-stats.js` | Pure, DOM-free table-statistics helpers (column typing, numeric description, grouping) shared by `csv.js` and `tablekit.js`; parses ambiguous D/M dates day-first per the site's European/British convention |

The MDX-Net vocal-separation subsystem (`mdx-*.js`) is what powers
`audio.js`'s isolate panel and `spectrogram.js`'s vocal/instrumental blend
slider - see `docs/features/audio.md`.

## Vendored WASM/third-party libs (`web/assets/vendor/`)

Referenced by name throughout the loaders above and the renderer catalog
(`docs/renderers.md`): **FFmpeg** (video remux/frame extraction/audio
decode), **ImageMagick** (RAW conversion), **pdf.js** and **Ghostscript**
(PDF/PostScript), **Tesseract** (OCR), **OpenCASCADE** (STEP/IGES
tessellation), **sql.js** (SQLite), **libarchive** and **xz/lzma** (archives),
**OpenJPEG** (JPEG 2000), **exifr**, **heic2any**, **jsQR**, **Leaflet**,
**fflate**, **lottie-web**, **opentype.js**, **libredwg-web**, **DjVu.js**,
**mdb-reader**, **foliate-js**, **SheetJS**. Served locally (not from a CDN,
with a couple of documented CDN-fetched exceptions like `occt-loader.js`) so
the app stays offline-capable once cached. See the repo root `README.md`'s
"Under the hood" section for the full list.
