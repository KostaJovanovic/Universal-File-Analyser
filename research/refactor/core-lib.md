# Refactor assessment - shared `core/` and `lib/` utility layer

Scope: `assets/js/core/{util,binutil,effects,popups,export-data,search}.js` and
`assets/js/lib/*.js`. Behaviour-preserving proposals only (no tests exist).
Symbol-usage counts below come from grep sweeps across `assets/js/**`.

## Executive summary

The shared layer is in **good shape**. The two workhorse helpers are used almost
universally - `fmtBytes` (62 files), `row`/`rowHelp` (75/43), `errorCard` (42),
`integrityCard` (30), `el` (~69 files import it), `Reader`/`latin1`/`ascii`/
`matchMagic`/`findBytes` from `binutil.js` (8-24 files each). There is **no
shadow `formatBytes`**, no rival cursor-reader class in the renderers, and no
duplicated DOM-builder. The main findings are smaller: one genuinely dead method,
a handful of inline byte-to-hex re-implementations of a helper that doesn't exist
yet, a near-identical lazy-WASM-loader shape repeated across `lib/*-loader.js`,
and `util.js` having grown into a grab-bag worth splitting along seams that are
already visually present.

Nothing here is urgent; ranked by value-vs-risk below.

---

## 1. Are the shared helpers used everywhere they should be?

**Mostly yes.** Spot findings:

### 1a. `fmtBytes` - one true implementation, a few raw-arithmetic escapes
- No competing `formatBytes`/`humanBytes`/`prettyBytes` exists - `fmtBytes`
  (`util.js:325`) is the sole byte formatter and is imported by 62 files.
- Two renderers bypass it with raw `MB` arithmetic where the *intent* is a coarse
  "NN MB" label, not `fmtBytes`'s adaptive B/KB/MB/GB:
  - `renderers/video.js:2429` and `:3423` -
    `(file.size / 1048576).toFixed(0) + ' MB'`.
  These are deliberate (always-MB phrasing in a "skipped for large videos"
  notice), so they are **not** bugs and arguably shouldn't call `fmtBytes`
  (which would print "1.4 GB"). Leave as-is, or extract a tiny `fmtMB(n)` only if
  a third site appears. **Low value.**

### 1b. Byte-array -> hex string is re-implemented inline (no shared helper)
The one-liner `Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join(...)`
appears verbatim in at least:
- `core/util.js:394` (inside `sha256Hex`, join `''`)
- `renderers/unknown.js:218` (the canonical 128-byte hex dump, join `' '`)
- `parsers/parsers-archive.js:244` and `:280` (join `' '`)
- `renderers/photo.js:2534` (3-byte `#rrggbb`, join `''`)

plus per-file `toHex()` definitions in `renderers/gitobject.js:15`,
`renderers/photo.js:979`, `renderers/davinci.js:57` (`hexDouble`),
`parsers/parsers-email.js:763` (`hexOf`). `binutil.js` has **no** byte->hex
helper despite being the binary toolkit. Proposing a single
`hexBytes(bytes, sep=' ')` (and maybe `hexByte(b)`) in `binutil.js` would absorb
all of these. **Medium value, low risk** - pure function, mechanical call-site
swap, easy to eyeball. (The full ASCII+HEX dump block in `unknown.js:218-219` and
`parsers-archive.js` is also a candidate for a shared `hexDump(bytes)` returning
the two aligned strings, but that is more opinionated; do the hex-encode helper
first.)

### 1c. Cursor reader - no shadow class, one justified exception
- `binutil.js` `class Reader` is the only general cursor reader and is imported
  broadly. Grep for rival classes found only **one** other `class Reader`, in
  `lib/nrbf.js:27` - and that one is *intentionally* bespoke (LE-only, `need()`
  bounds-checks on every read, `len()` for .NET 7-bit-encoded prefixes,
  `bigToNum` coercion). Folding NRBF onto `binutil.Reader` would mean adding
  per-read bounds checks to the hot shared reader, which would regress every
  other caller. **Keep nrbf's Reader local** - this is correct separation, not
  duplication.

### 1d. DOM building - `el()` is the norm; raw `createElement` survives where it should
- `el()` (`util.js:4`) is imported by ~69 modules and is the standard builder.
- Raw `document.createElement` still appears 92x across 17 renderers, but
  concentrated in `photo.js` (27), `odf.js` (15), `video.js` (12), `docx.js` (9) -
  i.e. **canvas/SVG/namespaced-element and tight-loop** code where `el()` (which
  always does `createElement` + attribute loop) is the wrong tool or measurably
  heavier. `search.js` and `popups.js` also use raw `createElement` for a few
  one-off nodes. This is acceptable; a blanket migration would be churn with no
  behavioural win. **Low value - do not pursue broadly.** (If anything, only the
  handful of trivial `createElement('button'/'div')` spots in `search.js` are
  worth tidying, and even those are marginal.)

### 1e. Clipboard-copy with execCommand fallback is duplicated
- The "navigator.clipboard, else throwaway `<textarea>` + `execCommand('copy')`"
  pattern exists independently in `popups.js` (`copyText`, lines 381-397) and in
  `util.js` `buildFileTree`'s per-file copy button (lines 505-515). A shared
  `copyToClipboard(text): Promise<boolean>` in `util.js` would unify them.
  **Medium-low value, low risk.**

### 1f. Modal scaffolding is copy-pasted three times in two files
- `popups.js` builds the `.anr-modal` overlay + `close()`/Esc/backdrop-click
  lifecycle three times (`openContactModal`, `showShareModal`) and
  `export-data.js` builds it a fourth time (`showChooser`). All four share the
  identical `let settled; const close = () => {...overlay.remove()...};
  onKey/Escape; overlay click === overlay` shape. A shared
  `openModal({ card }): { overlay, close }` helper (in `popups.js` or `util.js`)
  would remove ~25 duplicated lines x4. **Medium value, medium risk** - these are
  UI flows with no tests, so verify each modal manually after; the payoff is real
  but the risk is higher than the pure-function consolidations.

---

## 2. Is `util.js` a coherent toolkit or a grab-bag?

**It is a grab-bag** (~790 lines) and has clearly outgrown its "DOM helpers and
small formatters" header comment. It now spans at least five unrelated concerns,
and the seams are already visible as comment-banner sections:

1. **Formatters / tiny pure fns**: `fmtBytes`, `fmtDate`, `fileExt`, `roundFps`.
2. **Readout/DOM builders**: `el`, `row`, `rowHelp`, `helpTh`, `LABEL_HELP`
   (a ~110-line data table!), `buildReadout`, `preBlock`, `h3help`,
   `wireInfoToggle`, `errorCard`, `buildFileTree`.
3. **Async / lazy-load + hashing**: `loadCss`, `loadScript`, `readSlice`,
   `sha256Hex`, `sha256Row`, `integrityCard`, `probeReadable`,
   `isUnreadableError`, `cloudFileWarning`.
4. **Progress UI**: `asciiBar`, `inlineLoader`.
5. **Lightbox / history**: `attachZoomPan` (~100 lines) and the entire
   back-button / PWA-exit-guard subsystem (`openOverlayBack`, `_initBackButton`,
   `_confirmExit` - ~110 lines, **the only side-effectful code in the file**, it
   runs `_initBackButton()` at import time).

### Proposed split (value-ranked)
- **Highest value, lowest risk**: lift `LABEL_HELP` (the 110-line label->tooltip
  data map, `util.js:26-137`) into its own `core/label-help.js` and re-export, or
  just move it. It is pure data with a single consumer (`helpTh`), and it visually
  dominates the file. Pure move, zero call-site changes if `util.js` re-exports.
- **High value**: extract the **back-button / exit-guard / overlay-stack** block
  (lines ~683-789) into `core/overlay-nav.js`. It is self-contained, is the only
  import-time side effect in `util.js`, and conceptually belongs next to
  `navigate.js`, not among formatters. Only `openOverlayBack` is exported/used
  externally, so the move is a one-symbol re-export.
- **Medium value**: split the rest into `core/format.js` (group 1),
  `core/readout.js` (group 2 + `asciiBar`/`inlineLoader`), and `core/file-io.js`
  (group 3, the File/hash/cloud helpers). Keep `util.js` as a thin barrel that
  re-exports everything so **no importing file has to change** - this makes the
  split behaviour-preserving and reversible.

**Risk note**: because ~69 files import from `util.js`, the *only* safe way to do
this is the barrel/re-export approach - never rename or drop an export. Done that
way it's mechanical. **Medium value overall, low risk if barrelled.**

---

## 3. Do the `lib/*-loader` modules share a unifiable lazy-WASM pattern?

**Yes - there is a clear common shape, partially unifiable.** The "memoised
promise, null-on-failure-so-it-can-retry" idiom recurs:

| module | caches | resets on failure | injects via |
|---|---|---|---|
| `sqlite.js` `getSQL` | `_sqlPromise` | no (returns null inside) | `loadScript` |
| `occt-loader.js` `loadOcct` | `_occtPromise` | **yes** (`.catch(()=>_occtPromise=null)`) | `loadScript` |
| `openjpeg-loader.js` `getModule` | `_modulePromise` | **yes** | `loadScript` |
| `libarchive-loader.js` `loadArchiveModule` | `_archiveModPromise` | **yes** | dynamic `import()` |
| `ghostscript-loader.js` `loadFactory`/`loadWasmBytes` | two promises | no | dynamic `import()` + `fetch` |
| `xz-loader.js` / `lzma-loader.js` | none (re-checks `window.X`) | n/a | `loadScript` |

Three of them (`occt`, `openjpeg`, `libarchive`) are **almost identical**:
`if (p) return p; p = (async()=>{...})(); p.catch(()=>p=null); return p;`. A
single helper would capture them:

```
// proposed in a new lib/wasm-loader.js (sketch, not to be written now)
export function memoizeAsync(factory) {
  let p = null;
  return () => (p ||= Promise.resolve().then(factory).catch(e => { p = null; throw e; }));
}
```

- **Value**: removes the hand-rolled memoise-and-reset boilerplate from 3-4
  loaders and makes the "retry after failure" semantics uniform (right now
  `sqlite.js` *doesn't* reset, so a transient first-load failure is sticky there -
  unifying would quietly fix that inconsistency).
- **Risk**: **medium**. Each loader's *inner* factory differs (UMD global vs ESM
  default export vs Emscripten `instantiateWasm` vs `locateFile`), and these are
  the exact lines that are fiddly to get right per-vendor. The boilerplate worth
  extracting is only the ~5-line promise-memoise wrapper, **not** the vendor glue.
  `ghostscript-loader.js` (two separate caches, fresh Module per call) and the
  two stream decompressors (`xz`/`lzma`, no caching, `window.X` re-check) should
  be **left alone** - forcing them into the helper would be net-negative.
- **Recommendation**: introduce `memoizeAsync` (or `lazySingleton`) and migrate
  only `occt`, `openjpeg`, `libarchive`, and optionally `sqlite`. **Medium
  value, medium risk** - verify each affected format opens after the change.

Separately, the **decompressor caps** (`MAX_OUTPUT = 256*1024*1024`) are
copy-defined in `xz-loader.js:15`, `lzma-loader.js:18`, and
`legacy-decompress.js:17`. Trivial to share a `const MAX_DECOMPRESS_OUTPUT`, but
**very low value** (three constants).

---

## 4. Dead or near-dead exports

- **`Reader.u24()` (`binutil.js:38-41`) - DEAD.** Grep for `.u24(`/`\bu24\b`
  across `assets/js/**` returns only its own definition. Safe to delete (or keep
  as a documented part of the reader API - it's only 4 lines). **Confirmed dead;
  removal is low-value but zero-risk.**
- **Near-dead (single external caller) - keep, but noted:**
  - `Reader.u64num()` - 1 caller. (`u64` raw has more.)
  - `inlineLoader` (`util.js:295`) - 1 caller.
  - `isUnreadableError` (`util.js:176`) - 1 external caller (though
    `probeReadable`, its sibling, has 2). These form a coherent cloud-file trio
    with `cloudFileWarning`; keep together.
  - `sha256Hex` - only 1 *direct* external caller (`export-data.js`); most code
    goes through `sha256Row`/`integrityCard`. Correct - it's the low-level
    primitive. Keep.
- Everything else checked (`cleanAscii` 2, `startsWithAscii` 7, `gunzip` 6,
  `filetimeToDate` 3, `fmtGuid` 4, `roundFps` 2, `attachZoomPan` 2,
  `buildFileTree` 3, `wireInfoToggle` 2, `utf16` 5, `cp437` 3, `loadCss` 2,
  `asciiBar` 2) has real users. No other dead exports found.

---

## Ranked proposal list (value vs risk)

| # | Proposal | Value | Risk | Notes |
|---|---|---|---|---|
| 1 | Delete dead `Reader.u24()` (`binutil.js:38`) | Low | ~0 | Confirmed zero callers. Trivial. |
| 2 | Add `hexBytes()`/`hexByte()` to `binutil.js`; replace inline byte->hex one-liners (1b above) | **Medium** | Low | Pure fn; ~6-8 mechanical call-site swaps. |
| 3 | Move `LABEL_HELP` data map out of `util.js` into `core/label-help.js` (re-export) | Medium | Low | Pure-data move, shrinks `util.js` by ~110 lines. |
| 4 | Extract back-button/exit-guard/overlay-stack (`util.js:683-789`) to `core/overlay-nav.js` | Medium | Low-Med | Removes the only import-time side effect from `util.js`; 1 exported symbol. Verify overlay Back + PWA exit manually. |
| 5 | Shared `copyToClipboard()` (unify `popups.js` + `buildFileTree` copy logic) | Med-Low | Low | Pure-ish; two call sites. |
| 6 | `memoizeAsync`/`lazySingleton` helper in `lib/`; migrate `occt`/`openjpeg`/`libarchive`(/`sqlite`) | Medium | Medium | Extract only the promise-memoise wrapper, NOT vendor glue. Fixes `sqlite` sticky-failure inconsistency. Verify each format opens. |
| 7 | Barrel-split `util.js` into `format.js`/`readout.js`/`file-io.js`, keep `util.js` re-exporting | Medium | Low (if barrelled) | ~69 importers - never rename/drop an export; re-export everything. |
| 8 | Shared `openModal()` scaffolding (popups.js x3 + export-data.js) | Medium | Medium | Real dedupe (~75 lines) but untested UI flows; verify each modal. |
| 9 | Shared `hexDump(bytes)` (HEX+ASCII block) for `unknown.js`/`parsers-archive.js` | Low | Low | Do after #2. More opinionated formatting. |
| 10 | Share `MAX_DECOMPRESS_OUTPUT` const across xz/lzma/legacy-decompress | Very low | ~0 | Three constants; barely worth it. |

### What NOT to do
- Do **not** fold `lib/nrbf.js`'s `Reader` onto `binutil.Reader` (1c) - its
  per-read bounds-checking would regress the hot shared reader.
- Do **not** mass-migrate raw `createElement` to `el()` in canvas/SVG-heavy
  renderers (1d) - churn with no behavioural gain, and `el()` is wrong for
  namespaced/loop-hot nodes.
- Do **not** force `ghostscript-loader`, `xz-loader`, `lzma-loader` into the
  unified loader helper (3) - their shapes genuinely differ.
- Do **not** "consolidate" the always-MB video labels onto `fmtBytes` (1a) - the
  fixed-MB phrasing is intentional.

All proposals are behaviour-preserving when done as described (pure-fn extraction,
data moves, or barrel re-exports). Items 4, 6, and 8 touch untested UI/loader
flows and should each be manually exercised (`server.bat`) after the change.
