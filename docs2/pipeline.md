# The drop-to-render pipeline

How a dropped file becomes an analysis: the journey from `handleFile()` through
extension/MIME classification, byte-level sniffing and reroutes, the `ROUTES`
dispatch table, and finally a renderer module. This is the doc to read to
understand routing decisions; the renderer catalog is in `docs2/renderers.md`.

## Entry point: `handleFile(file, opts)`

Everything starts at `handleFile` in `web/assets/js/core/app.js`. It is called by
the page-wide drop handler, paste, the photo/audio/video dropzones, the samples
gallery (with `{ sample: true }`), nested opens from folder/archive/document views
(`{ nested: true }`), the type-suggestion popup (`{ kind, ext }` forced), a
RAW+XMP sidecar drop (`{ sidecarXmp }`), and the SPA "restore last analysis" replay
(`{ restore: true }`).

Before routing, `handleFile`:

1. Dismisses transient chrome (type-suggestion, suggest popup, share nudge, the
   formats overlay), shows the drop loader, and clears the previous results UI
   (stopping any still-playing media - including raw Web Audio players registered
   in `window._anrMediaStoppers`).
2. Runs `probeReadable(file)` - a cloud-only file (OneDrive/iCloud) with a valid
   name and size but unreadable bytes shows a clear "File unavailable" card instead
   of a confusing failure deep in a renderer, and is never counted.
3. Resolves the final `kind` (below), then dispatches through `ROUTES`.

A per-load `token` guards against races: if a newer file is dropped or the load is
cancelled, the in-flight renderer's output is suppressed.

## Step 1: `classifyFile(file)` - name and MIME only

`classifyFile()` in `web/assets/js/core/classify.js` maps a file to a `ROUTES`
`kind` purely from its extension (via `fileExt`) and MIME type - it never reads
bytes. Key ordering rules baked into it:

- **SVG** is checked before the generic `image/` MIME so it gets its own handler.
- **A recognised structured extension wins over a misleading MIME.** Many formats
  carry a vendor image/audio MIME (`.tap` as `image/vnd.tencent.tap`, `.dwg` as
  `image/vnd.dwg`, `.mid` as `audio/midi`), so the generic `image/`·`audio/`·
  `video/` MIME fallbacks sit near the *bottom*, after every dedicated-extension
  route.
- **Extension families share renderers**: the Office OOXML template/macro/show
  siblings, the OpenDocument zipped/flat/StarOffice variants, the Unity YAML asset
  extensions (`UNITY_EXTS`), the G-code extensions (`GCODE_EXTS`), and so on.
- **Basename special-cases**: `go.mod` routes to the text viewer (not the tracker
  audio for `.mod`); KiCad library tables and `-bak` backups; `LICENSE`/`COPYING`
  marker files route to `plaintext`.
- **Fallbacks**: extension sets from `formats.js` (`PHOTO_EXTS`, `AUDIO_EXTS`,
  `VIDEO_EXTS`, `CSV_EXTS`, `SVG_EXTS`), then `isProprietaryExt(ext)` (200+ formats
  in `proprietary-formats.js`), then `extensionless` (no extension) or `unknown`.

`classifyFile` is exposed as `window._anrClassify` so the folder "can it open?"
scan uses the same verdict as the real drop path.

## Step 2: byte-sniff reroutes (`resolveKind` / `handleFile`)

`classifyFile` alone would misroute files whose bytes disagree with their name, so
`handleFile` layers three content checks on top (also collected in `resolveKind()`
for callers like `/compare` that need routing without the DOM work):

1. **SPICE `.raw` disambiguation.** A `.raw` classifies as a camera RAW photo, but
   ngspice/LTspice dumps share the extension. `sniffSpiceRaw(file)` reroutes a
   simulation waveform to the `spice` viewer.
2. **Ambiguous-extension reroute (`VARIANT_REROUTE`).** For extensions that name
   two unrelated formats and whose default route is tuned for the *common* variant
   (`.ts` TypeScript vs transport stream, `.nc` NetCDF vs G-code, `.key`, `.obj`,
   `.md`, `.mat`, `.mod`, `.dts`), `detectVariant()` (the single source of truth,
   driven by `EXT_VARIANTS` in `formats.js`) checks the head bytes; if they prove
   the *other* variant, the file is diverted to a safe fallback kind (`plaintext`
   for a text variant, `unknown` for a binary one) rather than the wrong heavy
   renderer.
3. **Content resolution for unknown/extensionless (`resolveByContent`).** For a
   `kind` of `unknown` or `extensionless`, `resolveByContent(file)` in
   `web/assets/js/core/file-sniff.js` resolves the true type from the bytes -
   niche text/game magics first, then the broad `sniffFileType()` magic table
   (PDF/PNG/JPEG/ZIP/audio/video/PSD/ELF/EXE/DICOM/TAR/…), then git loose objects
   and packfiles, then a CSV/TSV consistency heuristic. A recognised type
   auto-routes even with no (or a wrong) extension.

## Step 3: forensics, suggestion and browse-as-archive

With `kind` final, `handleFile` (for a non-forced load) also computes, via
`web/assets/js/core/forensics.js` and `file-sniff.js`:

- **`signatureCheck`** - a signature-vs-extension mismatch card (a renamed or
  disguised file), prepended above the analysis.
- **`trailingDataCheck`** - data appended past the file's logical end
  (polyglot/smuggled content), slotted just above the Integrity card.
- **A type-suggestion popup** when the sniffed kind differs from the routed kind
  (offer to re-analyse as the real type).
- **`archiveEmbed`** - when the file is physically a zip/rar/7z (APK, DOCX, JAR,
  RAR, tarball, single-stream compressor), the archive browser is appended below
  the primary analysis (`pickArchiveEmbed` maps the container to a browse mode).
  Skipped for media, the dedicated ZIP view, and Fusion 360 `.f3d`.

## Step 4: `ROUTES` dispatch

`ROUTES` in `app.js` maps each `kind` to `{ render, results?, nav?, analysed? }`.
Only `photo`/`audio`/`video` name their own on-page section and light up their nav
links; every other kind renders into the generic `#unknownResults` block. Most
renderers are wrapped in `lazy(path, name)` = `(...args) => import(path).then(m =>
m[name](...args))`, so only the dropped type's module is fetched. The hot-path
renderers (`archive`, `proprietary`, `unknown`, `folder`, `compare`, `spice`) are
statically imported. Special dispatch cases:

- `plaintext` -> `renderProprietary(file, r, 'txt')` (the Plain Text view).
- `extensionless` -> `renderUnknown(file, r, { extensionless: true })`.
- `proprietary`/`comic` with an `extOverride` (a sniffed extension) pass it through.
- `photo` with a `sidecarXmp` passes the RAW develop settings.
- `exe`/`dll`/`scr` (proprietary) additionally extract the PE resource icon
  (`extractPeIcon`) and render it as a photo in the Photo section.

`photo` and `video` pull in `exifr` (via `ensureExifr()`) before the renderer runs.

## Step 5: post-render extras

When the render promise settles, `handleFile`:

- Hides the loader; if the renderer threw, leads with an error card.
- Prepends a dotenv "never share this" warning for `.env` secrets files
  (`isEnvFile`) and the signature-mismatch card.
- Guarantees an **Integrity card** (SHA-256 + on-demand hash extras) - most
  renderers build their own; those that don't get a standard one appended
  (`integrityCard`), so every file always has a fingerprint. `findIntegrityCard`
  prevents duplicates.
- Records the anonymous analysed ping (`recordAnalysed`, extension only) and the
  on-device history snapshot (`recordHistory`, metadata only) - both skipped for
  samples and SPA restores.
- Reveals the "About .EXT files" footer link if the extension has a `/formats`
  guide page, stashes `window._anrRestore` for SPA replay, and schedules the
  "share this" nudge.

## The proprietary catalog and lazy parser chunks

`renderProprietary(file, container, extOverride)` (`web/assets/js/renderers/
proprietary.js`) is the 200+ format identifier. It looks up `FORMATS[ext]` (from
`proprietary-formats.js`), shows the app name/file/size, then runs a parser:

1. A built-in `PARSERS[ext]` function (PSD, DWG, Blender, FBX, GLB, STL, OLE, ISO,
   text CAD, ZIP-meta, …), if present.
2. Otherwise, if `FORMATS[ext]` names a `chunk`, it lazily imports
   `../parsers/parsers-<chunk>.js` and calls that chunk's `PARSERS[ext]` - so the
   long tail of header parsers stays out of the boot bundle and loads only when
   such a file is opened (see `docs2/parsers-and-libs.md`).

The result is a rows object (key/value pairs, plus optional `_`-prefixed payloads)
rendered into the readout table.

## The `unknown` fallback

`renderUnknown` (`web/assets/js/renderers/unknown.js`) is the last resort: a
best-effort magic-byte label (`guessFormat`, ~40 signatures), a hex/ASCII dump, an
entropy profile, SHA-256, an OSINT network-indicator card, and enhanced previews
for plain text/JSON/XML. In `extensionless` mode it is framed as an expected
category shown as text (with a hex fallback for binary) rather than "unrecognised".
It also offers still-image recovery (`carveImages`, `repairJpeg`) for blobs.
