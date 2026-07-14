# Drop-to-render pipeline

How a dropped file becomes an on-screen analysis: the exact resolution order
from `handleFile` through classification, content sniffing, and format
catalog lookups, down to the `unknown.js` fallback. For engineers adding a
new format or debugging misrouted files.

## Overview flow

```
File dropped/selected
  -> app.js: handleFile(file)
       -> resolveKind(file)              (app.js:120)
            -> classifyFile(file)         (classify.js)  name/MIME only
            -> SPICE .raw disambiguation  (sniffSpiceRaw, for ext === 'raw')
            -> VARIANT_REROUTE check      (ambiguous extensions, e.g. .ts)
            -> resolveByContent(file)     (file-sniff.js) only if kind is
                                           'unknown'/'extensionless'
       -> ROUTES[kind]                   (app.js) -> lazy-loaded renderer
       -> renderer(file, container)      draws the result cards
```

Every stage after `classifyFile()` exists to correct or fill in a kind that
extension/MIME alone got wrong or couldn't determine - a lying extension, an
ambiguous one, or none at all.

## `classifyFile()` (name/MIME only, no byte reads)

`web/assets/js/core/classify.js` exports `classifyFile(file)`, which maps a
file to a `ROUTES` key purely from its `file.name` extension and `file.type`
MIME string - it never reads bytes (byte sniffing is layered on top by the
caller). It is a long if-chain, roughly in this precedence order:

1. SVG (MIME or `SVG_EXTS`) - checked first so it doesn't fall through to a
   generic image MIME.
2. Dozens of specific extensions mapped to dedicated renderer kinds (`docx`,
   `xlsx`, `epub`, `dwg`, `kicad_*`, `aep`, `stl`, `gcode`, `psd`, `mobi`, ...) -
   ordered deliberately so a format with a misleading vendor MIME (`.dwg` is
   often served as `image/vnd.dwg`, `.mid` as `audio/midi`) is caught by its
   extension before the generic `image/`/`audio/`/`video/` MIME fallback below
   would misroute it.
3. Generic MIME fallback: `image/*` -> `photo`, `audio/*` -> `audio`,
   `video/*` -> `video`.
4. `PHOTO_EXTS`/`AUDIO_EXTS`/`VIDEO_EXTS` (from `formats.js`) as an
   extension-only fallback for files with no informative MIME.
5. `isProprietaryExt(ext)` (from `proprietary.js`'s `FORMATS` table) -> `proprietary`.
6. Licence/marker files with no real extension (`LICENSE`, `COPYING`,
   `py.typed`, `CACHEDIR.TAG`) -> `plaintext`.
7. No extension and nothing else matched -> `extensionless` (treated as text
   with a hex fallback, not flagged "unknown").
8. Otherwise -> `unknown`.

`classifyFile` is also exposed as `window._anrClassify` for the folder scan
and the `/compare` page.

## Content-based sniffing (`file-sniff.js`)

`web/assets/js/core/file-sniff.js` determines what a file *actually* is from
its leading bytes, independent of its name, so a lying or missing extension
doesn't produce a wrong or "unknown" result. Three exports:

- **`sniffFileType(file)`** - reads the first 264 bytes and checks magic
  numbers for ~25 common containers (PNG, JPEG, GIF, BMP, TIFF, PSD,
  RIFF-based WEBP/WAVE/AVI, ISO-BMFF `ftyp` brands -> HEIC/AVIF/M4A/3GP/MP4,
  Matroska, Ogg, ID3/MPEG audio, FLAC, ZIP, RAR, 7z, ar, SQLite, gzip, XZ,
  Zstandard, bzip2, LZ4, `.Z` compress, ELF, Windows EXE, PostScript/EPS,
  DICOM, TAR, legacy LZMA, and a trailing SVG-tag heuristic). Returns
  `{ kind, ext, label }` or `null`.
- **`resolveByContent(file)`** - the single source of truth used by both the
  drop path and the folder-analysability scan. It layers, in order: a handful
  of niche proprietary/game-format magic checks (Raise3D ideaMaker, DJI
  firmware, Unity manifests, Valve `.res`, Android backups, ...), an
  HTML/SVG text heuristic, then falls through to `sniffFileType()`'s broad
  magic table, then `sniffGitObject()` (loose objects/packfiles), then a
  CSV/TSV heuristic (consistent comma/tab counts across the first lines).
  Returns `{ kind, sniffedExt }`, where `kind` stays `'unknown'` if nothing
  matched.
- **`isReadableText(file)`** - true if the first 4KB has a UTF-16 BOM or is
  >85% printable ASCII; decides whether `extensionless`/`unknown` files show
  as text or a hex dump. Shared with the folder scan via
  `window._anrReadableText`.

`resolveKind()` in `app.js` (`web/assets/js/core/app.js:120`) only calls
`resolveByContent` when `classifyFile` returned `'unknown'` or
`'extensionless'` - a recognised extension is trusted and never re-sniffed.

## Ambiguous-extension reroutes

Two mechanisms in `app.js` correct a `classifyFile` result using bytes for
extensions that legitimately name more than one format:

- **`VARIANT_REROUTE`** (`app.js:75`) - for extensions whose `classifyFile`
  route is tuned for the common variant (`.ts` -> MPEG transport stream vs.
  TypeScript source; `.dts` -> DTS audio vs. Device Tree Source; `.key` ->
  Keynote vs. PEM key; `.obj`/`.nc`/`.md`/`.mat`/`.mod` similarly ambiguous).
  Each entry names the `primary` variant and a safe fallback `kind`
  (`'plaintext'` for a text/source variant, `'unknown'` for a binary one).
  `resolveKind()` reads the file's first 1024 bytes and calls
  `detectVariant()` (see below); if the detected variant differs from
  `primary`, the file is rerouted to the fallback kind.
- **SPICE `.raw`** - `classifyFile` routes `.raw` to `photo` (camera RAW);
  `resolveKind()` separately calls `sniffSpiceRaw()` to catch SPICE simulation
  output sharing the same extension and reroutes to `'spice'`.

## `formats.js`: the central catalog

`web/assets/js/core/formats.js` is the single source of truth for supported
file types. It exports the lowercase classification sets (`PHOTO_EXTS`,
`AUDIO_EXTS`, `VIDEO_EXTS`, `CSV_EXTS`, `SVG_EXTS`, ...) that `classify.js`
and other modules read to route files, plus a curated display catalog
(`FULL_ANALYSIS` / `IDENTIFICATION`, consumed by `catalogGrouped()`) that
drives the format overlay, the about page's format tables, and the overlay
search box. Adding an extension to an existing category is usually a
one-line change here; see the file's own header comment and the
`add-file-format` skill for the full workflow.

`EXT_VARIANTS` (`formats.js:255`) is a table of ambiguous extensions with a
human-readable `summary` and an optional machine `detect` rule (a magic
string/hex at a byte offset, or `{ default: true }` as the fallback).
`detectVariant(ext, bytes, text, opts)` (`formats.js:428`) looks up the
extension, evaluates each variant's rule in order, and returns the first
matching variant's name (or the default) - this is what backs both the
in-app "this looks like X, not Y" readout and the `VARIANT_REROUTE`
correction in `app.js` described above.

## Proprietary-format dispatch (`proprietary.js`)

For files classified as `'proprietary'`, `renderProprietary(file, container,
extOverride)` (`web/assets/js/renderers/proprietary.js:3944`) looks the
extension up in the `FORMATS` table (imported from
`proprietary-formats.js`, the large reference table of 200+ formats: app
name, icon, optional magic check, optional `chunk` name). If the format entry
names a `chunk`, the renderer lazily imports
`../parsers/parsers-<chunk>.js` (`proprietary.js:3981`) and calls that
chunk's `PARSERS[ext]` function with the file's header bytes - so the ~200
format-specific binary parsers are split into per-domain lazy chunks
(`parsers-audio.js`, `parsers-video.js`, `parsers-image.js`, `parsers-docs.js`,
`parsers-dev.js`, `parsers-archive.js`, `parsers-gaming.js`, `parsers-threed.js`,
`parsers-geodata.js`, `parsers-sci.js`, `parsers-security.js`,
`parsers-email.js`, `parsers-disk.js`, `parsers-osmisc.js`, `parsers-raw.js`)
rather than one huge always-loaded module. `isProprietaryExt(ext)`
(`proprietary.js:4224`) is simply `ext in FORMATS`, used by `classifyFile()`'s
fallback. See [`parsers-and-libs.md`](parsers-and-libs.md) for the chunk/lib inventory.

## The `unknown.js` fallback

`web/assets/js/renderers/unknown.js` is the last resort for a `'unknown'` or
`'extensionless'` kind (and is also reused as the generic "identify this
blob" helper elsewhere, e.g. carved/recovered files). `guessFormat(bytes)`
independently re-checks a similar magic-number table (PDF, PNG, JPEG, GIF,
WAV/WebP/AVI via RIFF, Ogg, FLAC, ID3/MPEG audio, `ftyp`-brand MP4/MOV/M4A,
ZIP, 7z, gzip, RAR, ELF, `MZ` EXE/DLL, XML, SQLite, BMP, ICO, TIFF, Matroska,
Java class/Mach-O fat binary, plus a couple of 3D-printer-specific text
signatures) purely to produce a human-readable label for display, then falls
back to a UTF-16/printable-ASCII heuristic to decide between a text preview
and a raw hex/ASCII dump. It also computes SHA-256 and offers enhanced
previews for plain text, JSON and XML, and can hand off to
`photo-recover.js`'s `carveImages`/`repairJpeg` when an embedded or truncated
image is detected inside an otherwise-unknown blob.
