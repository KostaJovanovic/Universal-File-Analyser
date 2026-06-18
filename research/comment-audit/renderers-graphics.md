# renderers (graphics group) comment audit

Scope: code comments only (`//`, `/* */`, JSDoc) and section-header comments that
make verifiable claims. Data strings inside the `FORMATS` table (the `app` labels)
are display data, not comments, so they are out of scope unless a `//` section
header asserts something the entry contradicts.

## assets/js/renderers/proprietary-formats.js

- **Line 374 / 389** — `// Email / calendar / contacts / PIM (lazy parser chunk: parsers-email.js)` (section header) vs the `nsf` entry it encloses → The section header asserts every entry in the block routes to `parsers-email.js`, but `nsf: { app: 'NES Sound Format', icon: 'NSF', chunk: 'audio' }` (line 389) is a chiptune format dispatched to `parsers-audio.js`, not email. The entry is misfiled under the wrong chunk-section comment. **Fix:** Move the `nsf` entry up into the `// Audio - extra codecs / trackers / chiptune (lazy chunk: parsers-audio.js)` block (near `nsfe` at line 767), so the `parsers-email.js` header no longer (incorrectly) claims it.

No other comment in this file was found to contradict the code. Spot-checked magic-byte
comments / values that carry implicit facts (psd `8BPS`, swf `FWS`, fbx `Kayd`, glb
`glTF`, blend `BLENDER`, flp `FLhd`, dwg `AC`, w3x/w3m `HM3W`, parquet `PAR1`, arrow
`ARROW1`, rdb `REDIS`, etc.) all match the documented signatures.

## assets/js/renderers/paint.js — no issues

Verified: the file-header block (Krita `mergedimage.png` + `maindoc.xml`, Procreate
`QuickLook/Thumbnail.png`, GIMP `.xcf` not a ZIP) matches the code paths. Line 89-91
NSKeyedArchiver/`"{width, height}"` description matches `findSizeToken`'s regex
`^\{\s*\d+...\}$`. Line 140 `'PDN3' (4) + uint24 LE XML length (3) + UTF-8 XML` matches
the 7-byte slice and `head[4] | (head[5]<<8) | (head[6]<<16)` little-endian decode at
line 147, and the `file.slice(7, 7 + xmlLen)` read.

## assets/js/renderers/psd.js — no issues

Verified: header is read as 26 bytes (line 39 / `bytes.length < 26`), field offsets in
the comment-annotated `parsePsdHeader` (`version`@4, `channels`@12, `height`@14,
`width`@18, `depth`@22, `mode`@24) are consistent. Line 47 `1 = PSD, 2 = PSB` matches
`isPsb = header.version === 2`. Line 39-41 / line 70 thumbnail resource IDs `1036 / 1033`
and line 71 `format 1 = kJpegRGB` match the `id === 1036 || id === 1033` and
`dv.getUint32(dataStart) === 1` checks. Line 199 `ag-psd only handles RGB(3)/Grayscale(1),
8-bit, PSD (not PSB)` matches `mode === 3 || mode === 1`, `depth === 8`, `version === 1`.
`COLOR_MODES` index 1 = Grayscale, 3 = RGB confirm the (3)/(1) annotations.

## assets/js/renderers/font.js — no issues

Verified: FontFace vs opentype.js split, `SPECIMEN_SIZES`, glyph `CAP = 500` matching the
"first 500" hint (line 79), variable-axis handling from the `fvar` table, and the WOFF2/TTC
fallback messaging all match the code.

## assets/js/renderers/djvu.js — no issues

Verified: vendored DjVu.js, `getPagesQuantity` / `getPagesSizes` / `getPage` /
`getImageData` usage and the "pager disabled while a page renders" claim (the `busy`
guard) all match.

## assets/js/renderers/dwg.js — no issues

Verified: libredwg-web (LibreDWG → WebAssembly) lazy load, `dwg_read_data` → `convert`
→ `dwg_to_svg` pipeline, and the "~6 MB" engine size note (also echoed in the user
string at line 26) are consistent. Comment "Top entity types (LINE, CIRCLE, LWPOLYLINE,
TEXT, ...)" matches the type-tally code.

## assets/js/renderers/diagram.js — no issues

Verified: draw.io `<diagram>` → `<mxGraphModel>` inline-or-deflate+base64 path matches
`decodeDiagram` (`atob` → `inflate(..., 'deflate-raw')` → `decodeURIComponent`). DXF
ENTITIES-section parsing, the group codes used (10/20/11/21 coords, 40 radius, 50/51
arc angles, 70 flags, 1 text), and the "flip Y so the drawing is upright" comment
(`Y = (y) => -y`) all match. Binary-DXF sentinel check reads 22 bytes and compares
`AutoCAD Binary DXF` consistently.

## assets/js/renderers/dataview.js — no issues

Verified: HAR request-table columns (Method, Status, Type, Size, Time, URL) match the
`thead`; JSON5/JSONC/Hjson "strip // and /* */ comments and trailing commas then
JSON.parse" matches `looseParse`; NFO "decoded from CP437" matches `cp437(bytes)`.
The `BATCH = 100` and 500 KB source-truncation behaviour match their comments.
