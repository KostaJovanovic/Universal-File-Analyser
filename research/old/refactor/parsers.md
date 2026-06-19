# Refactoring plan - parsers/ layer + proprietary.js dispatch

Scope: `assets/js/renderers/proprietary.js` (~4100 lines), `assets/js/renderers/proprietary-formats.js` (the `FORMATS` catalog, 1205 lines, pure data), and the 15 lazy chunks `assets/js/parsers/parsers-*.js` (audio, video, image, raw, archive, threed, docs, email, geodata, sci, security, dev, disk, gaming, osmisc).

**Behaviour-preserving constraint:** no tests exist, so every item below is framed as a no-output-change move. The bias is heavily toward "leave it alone" on the hot path and "consolidate duplicated helpers" on the leaf code.

---

## How dispatch actually works today (ground truth)

`renderProprietary(file, container, extOverride)` in proprietary.js (lines 3876-4093) is the single entry. Routing order for an extension `ext` with `fmt = FORMATS[ext]`:

1. **Built-in `PARSERS` map** (proprietary.js line 3793-3873): `ext -> (c) => parseXxx(...)` where `c = { head, file, ext }`. Sync or async, awaited. ~70 entries. These are *not* wrapped in try/catch at the table - each `parseXxx` does its own guarding (or doesn't).
2. **Lazy chunk** (line 3911-3917): only if `!extra && !fn && fmt.chunk`. Dynamic `import('../parsers/parsers-' + fmt.chunk + '.js')`, then `mod.PARSERS[ext]({head,file,ext})`. The whole block is wrapped in one `try/catch` that silently swallows a failed import or throw.
3. **Hardcoded tail fallbacks** (lines 3919-3938): ISO PVD, OLE compound-doc sniff, text CAD (STEP/IGES), `fmt.zip` -> `parseZipMeta`, generic `parse:'text'|'xml'` -> `parseTextVersion`.

The chunk contract is documented identically in every chunk header comment: *"Each entry in PARSERS is `({head, file, ext}) => rows` where rows is a plain object of label->value pairs, optionally carrying `_sections`, `_previewNode`. Return null to fall back."* Plus the `_`-prefixed payload protocol consumed by the renderer: `_app`, `_help`, `_fileList`, `_readableText`, `_previewNode`, `_sections`, `_font`, `_readableText`, `_rsrc` (internal).

So the contract is *real and consistent in intent*, but enforced only by convention.

---

## 1. Is the dispatch consistent? Mostly yes; a few ad-hoc variations

The `ext -> chunk -> fn` shape is uniform. The variations are all in **error-wrapping and pre-reading**, not in the call signature:

- **Inconsistent try/catch wrapping.** `parsers-audio.js` (line 1381), `parsers-video.js` (1311), `parsers-gaming.js` (938) each define a private `wrap(fn)` = `async c => { try { return await fn(c); } catch { return null; } }` and apply it per-entry. The other ~12 chunks (image, dev, archive, email, sci, security, geodata, disk, docs, osmisc, raw, threed) do **not** wrap - they rely on each `parseXxx` catching internally, or on the renderer's outer chunk-level try/catch. `parsers-audio.js`'s `wrap` additionally coerces falsy to `null` (`return r || null`) where video/gaming's does not - a subtle behavioural divergence. The built-in `PARSERS` in proprietary.js are also unwrapped (a throw there is **not** caught - step 1 has no try/catch, unlike step 2). This is the single most material inconsistency: a built-in parser that throws will reject `renderProprietary` entirely, whereas a chunk parser that throws is swallowed.
- **`textParser` helper (video only).** `parsers-video.js` 1316 wraps "read file as text once, route by ext". Same pattern is open-coded in geodata/security/osmisc/email via their own `readText`.
- **Per-chunk file-read helpers, all near-identical.** `readText(file, cap)` is redefined in email (line 30), video (55), geodata (20), security (43) with slightly different default caps and number formatting (`4*1024*1024` vs `1_000_000`). `readAll(file, cap)` is redefined in image (25). All are thin wrappers over the shared `readSlice` (util.js 347) + `.text()`/`.arrayBuffer()`.
- **`idOnly`/id-card shorthand** is reinvented: `parsers-raw.js` `idOnly` (73), and ad-hoc `{ Format, Note }` literals scattered through gaming/disk/sci.

**Proposed uniform contract** (documentation + one shared helper, no signature change):

```
// A parser module exports:  export const PARSERS: Record<ext, ParseFn>
// ParseFn = (ctx: { head: Uint8Array, file: File, ext: string })
//             => Rows | null | Promise<Rows | null>
// Rows = { [label: string]: string|number } & {
//   _app?, _help?, _fileList?, _readableText?, _previewNode?, _sections?, _font?
// }
// Contract: never throw (return null to decline); falsy => generic id card.
```

Back it with **one shared `defineParser`/`safe` wrapper in a new `parsers/parser-util.js`** that does the try/catch + falsy-to-null coercion once, and have the renderer apply it *uniformly to both the built-in map and the chunk map* (so step 1 gets the same safety net step 2 has). That removes the three private `wrap` copies and closes the "built-in throw escapes" gap - and is behaviour-preserving as long as the wrapper matches today's most lenient semantics (catch -> null, falsy -> null).

---

## 2. Repeated boilerplate -> a shared `parsers/parser-util.js`

Strong candidates to consolidate (all currently duplicated across chunks):

- **`readText(file, cap)`** - 4+ copies (email, video, geodata, security). Unify on one signature with an explicit default cap. **Caveat:** the per-call caps (`1_000_000`, `4*1024*1024`, `8_000_000`, `16_000_000`) are load-bearing per format and must be preserved as explicit args - only the function body is shared.
- **`readAll(file, cap)`** - image's bytes-reader; same shape as `readSlice` but returns the whole capped buffer.
- **`wrap` / `safe` / `textParser`** - the dispatch wrappers from item 1.
- **`idOnly(ext, name, note?)`** - the identification-only row shorthand.
- **`fmtDuration(sec)`** - independently implemented in `parsers-audio.js` (18) and `parsers-video.js` (23) with slightly different formatting (audio: M:SS/H:MM:SS; video: adds `.mmm`). These are intentionally different outputs, so **do not** merge blindly - either keep both or parameterise (`{millis:true}`). Low value, flag-only.
- **`parseXml(text)` / DOMParser+parsererror guard** - video (46) and several others repeat it.

Already shared correctly (do **not** re-duplicate): `readSlice`, `el`, `row`, `rowHelp`, `fmtBytes`, `preBlock`, `fmtDate` (util.js); `Reader`, `ascii`, `cleanAscii`, `findBytes`, `matchMagic`, `startsWithAscii`, `latin1`, `utf8`, `utf16`, `cp437`, `filetimeToDate`, `fmtGuid` (binutil.js). The chunks already import these consistently - the binary toolkit layer is in good shape and should be the template the new `parser-util.js` follows.

**One concrete dead-duplication in proprietary.js itself:** the local `ascii(buf, start, len)` (lines 18-25) is byte-for-byte the exported `ascii()` in binutil.js (105-113), which proprietary.js *already imports* (`utf16, utf8` from binutil on line 7). Switching the local uses to the imported `ascii` (or just importing it too) deletes ~8 lines and removes a maintenance fork. Lowest-risk single edit in this whole plan.

---

## 3. proprietary.js (~4100 lines) - what to extract

The `FORMATS` catalog was already split out into `proprietary-formats.js` (good). What remains in proprietary.js is three distinct concerns tangled in one file:

- **(a) ~70 built-in `parseXxx` functions** (lines ~28-3788): PSD, DWG, Blender, FBX, GLB, STL, SWF, XMP, PE/EXE (+ `extractPeIcon`, ~120 lines), GLIF (+ outline renderer, ~150 lines), OLE, fonts (TTF/OTF/WOFF, ~140 lines), FLP, RAR, 7z, SQLite, and the large block 1000-3788 (VDF, torrent, Premiere/Ableton gzip-XML, AEP, Veg, Resolve, Filmora, CapCut, gcode, MSI, APK, certs, RTF, LNK, etc.). This is the bulk.
- **(b) the `PARSERS` dispatch map** (3793-3873).
- **(c) `renderProprietary` orchestration + DOM rendering** (3876-4093): table building, `_`-payload handling, font preview, text/HTML source preview overlay, XMP raw block.

**Recommendation, ranked within this item:**

1. **Extract the rendering orchestration (c) is NOT worth it** - it is the hot path and tightly coupled to the payload protocol; leave it. (See risk section.)
2. **The built-in parsers (a) are really just "the chunk that never got lazy-loaded."** The cleanest structural move - and the one most aligned with the existing architecture - is to migrate cohesive groups of the built-in parsers into **new or existing lazy chunks** and give those extensions a `chunk:` in `FORMATS`, deleting them from the in-file `PARSERS` map. Candidates that already have a natural home: fonts -> a `parsers-font.js` (or fold into an existing chunk); the video-project parsers (Premiere/Resolve/Filmora/Veg/CapCut/AEP) -> could join `parsers-video` or a new `parsers-vproj`; certs already overlap `parsers-security`. **This shrinks the boot bundle** (these parsers currently ship eagerly in the always-loaded proprietary.js) **and** shrinks the file. **Behavioural caveat:** moving a parser from built-in (step 1, unwrapped, runs before the chunk step) to a chunk (step 2, wrapped, runs only when `!fn`) changes error semantics and ordering slightly - so this must be paired with item-1's "wrap both maps uniformly" change to stay behaviour-preserving. Medium effort, real payoff, but **not zero-risk** - do it group-by-group, not in one sweep.
3. **Cheaper, safer alternative if bundle size isn't the goal:** purely mechanical file split - move the built-in `parseXxx` bodies (a) into a sibling `proprietary-parsers.js` that proprietary.js imports, keeping the `PARSERS` map and `renderProprietary` in place. No routing/ordering/error-semantics change at all, just ~3000 lines relocated. This is the **behaviour-preserving** way to "make proprietary.js not 4100 lines" and should be preferred first. `extractPeIcon` is already `export`ed and consumed elsewhere - it can move with the PE code.

PE/EXE (parsePe, parseExe, readUtf16Value, extractPeIcon, PE_HELP) and the font block (AXIS_NAMES, readNameTable, readFvarTable, sfntTableOffsets, woffTables, parseFont) are the two largest self-contained clusters and the obvious first extraction units for option 3.

---

## 4. Risk of touching this lazy-loaded hot path; what to leave alone

`renderProprietary` runs on essentially every "unknown/proprietary" drop, and the lazy `import()` path is performance-sensitive (chunks are fetched on first use, cached by the service worker `SHELL`). With **no tests**, the blast radius of a routing regression is the entire proprietary surface (200+ extensions).

**Leave alone (high risk, low reward):**

- The routing order in `renderProprietary` (built-in -> chunk -> ISO/OLE/CAD/zip/text tail). The `!extra && !fn` guards encode real precedence (e.g. JSON is a built-in `parseCapcut` but also has generic handling; OLE sniff must run after dedicated parsers). Reordering risks silent output changes.
- The `_`-payload protocol and the order in which `extra` keys are emitted into the table (lines 3941-3951) - field order is user-visible.
- The dynamic-import path string `'../parsers/parsers-' + fmt.chunk + '.js'` - it must stay statically analysable enough for the bundler/SW. Do **not** template it further or move it behind a map without verifying SW precaching still resolves the chunk URLs.
- `extractPeIcon` and the PE resource-walking offsets - dense, correct, and exercised by the photo pipeline. Move as a whole unit if at all; never refactor the offset arithmetic.
- `headSize` special-casing for exe/dll/msi (line 3896) - the import-table walk needs the larger 64 KB head.

**Safe to touch (low risk):**

- Deleting the duplicate local `ascii()` in proprietary.js (item 2) - pure dedup.
- Adding `parsers/parser-util.js` and migrating the three `wrap` copies + the `readText`/`readAll` copies to it - leaf-level, one chunk at a time, each verifiable by opening one file of that type via `server.bat`.
- The mechanical file split (item 3, option 3) - no logic change.

---

## Ranked recommendations (value vs risk)

| # | Action | Value | Risk | Notes |
|---|--------|-------|------|-------|
| 1 | Delete duplicate local `ascii()` in proprietary.js; use binutil's | low | **very low** | 8-line dedup, single edit |
| 2 | New `parsers/parser-util.js`: shared `readText`/`readAll`/`safe(wrap)`/`textParser`/`idOnly`; migrate chunks one at a time | **high** (kills 4x `readText`, 3x `wrap`, etc.) | low | per-chunk, preserve explicit caps; match lenient catch->null/falsy->null semantics |
| 3 | Apply the shared `safe` wrapper uniformly to **both** the built-in and chunk PARSERS maps in `renderProprietary` | medium | low-med | closes the "built-in throw escapes the swallow" gap; verify no parser relied on throwing |
| 4 | Document the parser-module contract once (header of `parser-util.js`) and point chunk headers at it | medium | none | the comment is already copy-pasted verbatim in every chunk |
| 5 | Mechanical split: move the ~70 built-in `parseXxx` bodies into `proprietary-parsers.js` (PE cluster + font cluster first) | medium | low | no routing/order/error change; pure relocation |
| 6 | Convert eager built-in parsers to lazy chunks (`chunk:` in FORMATS) for bundle-size win | medium-high | **medium** | only after #3; changes load order + error semantics; do group-by-group, verify each |
| 7 | Parameterise the two `fmtDuration` variants | very low | low | outputs intentionally differ; flag only |

Sequencing: do 1 -> 4 -> 2 -> 3 first (all low-risk, compounding cleanup), then 5 (pure relocation). Treat 6 as a separate, later, carefully-staged effort and 7 as optional. Each step is independently verifiable only by manual drop-testing one file per affected format via `server.bat` (no automated coverage), so keep changes small and reversible.
