# renderers (archive / misc group) comment audit

Audited 13 files for factual correctness of code comments (`//`, `/* */`, JSDoc),
focusing on claimed magic bytes, ZIP/archive structure, offsets, and numeric
constants. Magic bytes, ZIP central-directory and local-file-header offsets, the
compression-method table, host-OS table, DOS date/time bit layout, the git
loose/pack/idx structure, the TAR walker, and email/MIME parsing were all checked
against the code and the relevant specs. Only one stale reference was found.

## assets/js/renderers/archive.js — no issues

(EOCD scan window `bytes.length - 65557`, central-directory signature `0x02014b50`,
EOCD signature `0x06054b50`, field offsets `+10/+12/+16`, Zip64 extra-field id
`0x0001`, the `METHODS` table on line 211, the `HOST_OS` table, the DOS date/time
decode on lines 111-126, encryption flag bit 0, and the gzip/xz/zstd/lz4/lzw/lzma
magic bytes in `decompressStream` all verified correct.)

## assets/js/renderers/zip.js — no issues

(Local-file-header offsets in `readZipEntries` - flags `+6`, method `+8`,
compSize `+18`, uncompSize `+22`, nameLen `+26`, extraLen `+28` - and the
`deflate-raw` choice for method 8, plus the bit-3 data-descriptor note, verified
correct.)

## assets/js/renderers/folder.js

- **Line 8** — `import { FORMATS } from './proprietary-formats.js';` is correct,
  but the surrounding doc/comments are fine; **the real stale reference is in the
  project doc, not here.** No comment problem in this file itself. (Listed for
  completeness: the `KNOWN_FIXED_EXTS` set, the HEIF brand set, and the ISOBMFF
  box-walking comments on lines 51-94 - `ftyp`/`meta`/`hvcC`/`pict`, the 64-bit
  size==1 / size==0 handling, the `minor_version` skip at offset 12 - all verified
  correct.)

## assets/js/renderers/folder-archive-shared.js — no issues

## assets/js/renderers/treemap.js — no issues

(The squarified-layout math, `MIN_AREA_PER_FILE`/`MIN_FILE_AREA`/`AGG_MIN_FILES`
thresholds, header depth limits, and the breadcrumb ancestor-chain rebuild comment
all match the code.)

## assets/js/renderers/csv.js — no issues

(Quote-aware parser comments, CRLF-swallow logic, percentile interpolation, and
the data-quality checks verified against the code.)

## assets/js/renderers/svg.js — no issues

(The sanitiser comment - removing `<script>`/`<foreignObject>`, `on*` handlers,
`javascript:` links, and external/remote refs - matches `sanitizeSvg`. The
generator-detection comment matches `detectSvgCreator`.)

## assets/js/renderers/geo.js — no issues

(`ELE_THRESHOLD = 2` m and `PAUSE_GAP = 60` s match the prose in the summary rows;
haversine radius 6371000 m, the KML `lon,lat,alt` ordering note, and the GeoJSON
`[lon, lat]` swap comment on line 217 all verified correct.)

## assets/js/renderers/markdown.js — no issues

(Safety header comment, `safeUrl` allow-list comment, inline-processing order
comment, and the GFM table delimiter-row description all match the code.)

## assets/js/renderers/comic.js — no issues

(Header comment - CBZ=ZIP, CBT=TAR, CBR/CB7 via libarchive - matches
`extractPages`. TAR walker: 512-byte blocks, name at `+0..100`, octal size at
`+124..136`, type byte at `+156`, type `48`(`'0'`)/`0` for regular files - all
verified correct against the TAR (ustar) header layout.)

## assets/js/renderers/email.js — no issues

(RFC 2047 encoded-word comment, MIME-tree walk, the base64 size estimate
`length * 0.75`, and the mbox `From ` separator split all match the code.)

## assets/js/renderers/gitobject.js — no issues

(Loose-object format `"<type> <size>\0<payload>"`, PACK magic `0x50 0x41 0x43 0x4B`,
idx magic `\377tOc` = `0xFF 0x74 0x4F 0x63`, zlib-header check
`(head[0] & 0x0f) === 8` and `% 31 === 0`, the tree-entry format
`"<mode> <name>\0<20-byte SHA1>"`, mode→type mapping (`40000`=tree,
`160000`=submodule, `120000`=symlink), and the idx v2 256-entry fanout with the
last entry as the object count at offset `8 + 255*4` - all verified correct.
The 38-hex-char filename match - 40-char SHA-1 minus the 2-char directory prefix -
is also correct.)

## assets/js/renderers/unknown.js — no issues

(`guessFormat` magic bytes all verified: `%PDF`, PNG `0x89 PNG`, JPEG `FF D8`,
`GIF8`, RIFF/`WAVE`/`WEBP`/`AVI `, `OggS`, `fLaC`, `ID3`, MPEG `FF E0`-masked,
`ftyp` at offset 4, ZIP `PK`, 7z `37 7A BC AF 27 1C` (the literal `7z\xBC\xAF\x27\x1C`),
gzip `1F 8B`, `Rar!`, ELF `7F ELF`, `MZ`, `<?xml`, `SQLite`, `BM`, ICO
`00 00 01 00`, TIFF `II`+`2A` / `MM`+`2A`, Matroska/WebM `1A 45 DF A3`, Java/Mach-O
`CA FE BA BE`, and the UTF-16 BOM/heuristic detection - all correct.)

---

## Note on the cross-file CLAUDE.md reference

`folder.js` line 8 imports `FORMATS` from `./proprietary-formats.js`, and that file
exists and exports `FORMATS`. This is **correct** and not a comment issue. (The
project `CLAUDE.md` file-structure section only lists `proprietary.js`, but that is
documentation outside the audited source files and outside this task's scope.)
