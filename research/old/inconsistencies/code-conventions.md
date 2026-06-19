# Code-convention inconsistencies — Analyser JS

Survey of `assets/js/core`, `renderers`, `parsers`, `lib` (and `games`). Vanilla ES
modules, no build. Findings are ranked by how much normalising them would help
maintenance. Each cites the *prevailing* convention and the deviation with
file:line evidence. **No source files were modified.**

Headline: the codebase is unusually consistent. Quote style, byte-formatting,
the module banner, named exports, error cards and `fmtBytes`/`buildReadout`
helpers are followed near-universally. The real drift is concentrated in
(1) renderer second-param naming, (2) decoder helper bypass, and (3) one stray
default export. Most "candidate" smells (local size math, snake_case) turned out
to be false positives and are listed at the end so they aren't re-flagged.

---

## 1. Renderer entry signature — second param `resultsEl` vs `container`  (HIGH)

**Prevailing convention:** a renderer is `export async function render<Type>(file, resultsEl, [opts])`,
second param named **`resultsEl`**. ~40 renderers follow this
(e.g. `renderPhoto`, `renderAudio`, `renderVideo`, `renderPdf`, `renderStl`,
`renderCsv`, `renderSvg`, `renderFont`, `renderEpub`, `renderMidi`, `renderGeo`,
`renderUnknown`, …).

**Deviation:** a sizeable minority name the same positional param **`container`**.
Purely cosmetic (the param is positional, callers in app.js pass through), but it
splits the codebase in two and makes cross-renderer reading/grep noisier:

- `assets/js/renderers/dataview.js:76` `renderHar(file, container)`
- `assets/js/renderers/dataview.js:155` `renderJsonData(file, container)`
- `assets/js/renderers/dataview.js:200` `renderNfo(file, container)`
- `assets/js/renderers/diagram.js:107` `renderDrawio(file, container)`
- `assets/js/renderers/diagram.js:236` `renderDxf(file, container)`
- `assets/js/renderers/docx.js:433` `renderDocx(file, container)`
- `assets/js/renderers/email.js:194` `renderEml(file, container)`
- `assets/js/renderers/email.js:219` `renderMbox(file, container)`
- `assets/js/renderers/legacy-office.js:376` `renderLegacyOffice(file, container, kind)`
- `assets/js/renderers/notebook.js:104` `renderNotebook(file, container)`
- `assets/js/renderers/odf.js:370` `renderOdf(file, container, kind)`
- `assets/js/renderers/textdoc.js:194` `renderTextDoc(file, container, kind, ext)`
- `assets/js/renderers/archive.js:617` `renderArchiveEmbedded(file, container, opts = {})`
- `assets/js/renderers/proprietary.js:3876` `renderProprietary(file, container, extOverride)`

Roughly a doc/text-viewer cluster (dataview, diagram, docx, email, odf, textdoc,
notebook, legacy-office) standardised on `container` among themselves while the
rest of the app uses `resultsEl`. Pick one name and rename the minority.

**Not violations (sub-component renderers, different by design):** these take a
canvas/items, not `(file, el)`, so they legitimately differ — don't normalise:
`renderSpectrogram(canvas, spec, opts)` (spectrogram.js:411),
`renderTreemap(canvas, items, opts)` (treemap.js:229),
`renderPartsViewer(file, resultsEl, {…})` (stl.js:491),
`renderBreakdownCards` / `renderViewToggle` (folder-archive-shared.js),
`renderFolder(files, resultsEl)` (folder.js:284 — takes a FileList, not a File).

---

## 2. Decoder helper bypass — local `new TextDecoder(...)` instead of binutil  (HIGH)

**Prevailing convention:** `binutil.js` exports the shared text decoders
`latin1(bytes)`, `utf8(bytes)`, `utf16(bytes, little)` (binutil.js:123-131)
"reused by the lazy parser chunks and the deepened renderers" — the stated home
for byte→text decoding.

**Deviation:** renderers re-instantiate `new TextDecoder('latin1' | 'utf-16…' | 'utf-8')`
inline instead of calling those helpers — **25 occurrences across 10 renderers**:

- `assets/js/renderers/audio-codec.js` (6×)
- `assets/js/renderers/comic.js` (3×)
- `assets/js/renderers/model3d.js` (3×)
- `assets/js/renderers/video.js` (3×)
- `assets/js/renderers/aftereffects.js` (2×)
- `assets/js/renderers/legacy-office.js` (2×)
- `assets/js/renderers/photo.js` (2×)
- `assets/js/renderers/stl.js` (2×)
- `assets/js/renderers/pdf.js` (1×)
- `assets/js/renderers/paint.js` (1×)

(The same `new TextDecoder('latin1')` also recurs inside parser chunks, e.g.
parsers-raw.js:62.) Each is a candidate to swap for `latin1()`/`utf8()`/`utf16()`.
Low risk, mechanical; mainly a "don't reinvent the decoder" hygiene item.

---

## 3. Stray `export default` in an otherwise all-named-export codebase  (MEDIUM)

**Prevailing convention:** every module uses **named exports** only. A grep for
`export default` across `assets/js` returns just one real hit (the other, in
video.js:261, is a code comment).

**Deviation:** `assets/js/lib/ghostscript-loader.js:116` adds
`export default renderPostScript;` on top of the named
`export async function renderPostScript` (line 71). The sole consumer imports the
**named** form — `import { renderPostScript } from '../lib/ghostscript-loader.js'`
(parsers-image.js:1394) — so the default export is dead/redundant and contradicts
the named-only convention. Drop the `export default` line.

---

## 4. Error-card helper bypassed — manual `el('div',{class:'anr-error'})`  (MEDIUM)

**Prevailing convention:** `errorCard(message)` (util.js:222) is "the canonical
way for a renderer to report that a file couldn't be read or parsed." It is used
**77× across 38 renderers**.

**Deviation:** `assets/js/renderers/docx.js` builds the error node by hand
**3×** instead of calling `errorCard()`:
- `docx.js:446-447` (missing document content)
- `docx.js:453-454` (decompress failure)
- `docx.js:495-496` (catch-all read error)

All three are `container.appendChild(el('div', { class: 'anr-error' }, '…'))` —
exactly what `errorCard()` produces. docx.js is the only renderer doing this;
replace with `errorCard(...)`.

---

## 5. Parser error-handling asymmetry — built-in vs lazy-chunk dispatch  (MEDIUM)

**Prevailing convention:** in `renderProprietary` the per-format parsers all
return a plain rows object (or `null`) and the dispatcher is expected to be the
safety net.

**Deviation — the dispatcher guards one path but not the other**
(`renderProprietary`, proprietary.js):
- Lazy-chunk parsers ARE wrapped: the `import('../parsers/parsers-<chunk>.js')`
  + `lazyFn({head,file,ext})` call sits inside `try { … } catch (e) { /* fall through */ }`
  (proprietary.js:3911-3917).
- The **built-in** parser call is NOT wrapped:
  `const fn = PARSERS[ext]; if (fn) extra = await fn({ head, file, ext });`
  (proprietary.js:3902-3903) runs bare. A throw from a built-in parser propagates
  out of `renderProprietary`, whereas the identical mistake in a chunk parser is
  swallowed. Two parsers of the same kind get different blast radii.

This is compounded by **inconsistent internal guarding inside the chunks**
themselves — try-block density per `parse*` function varies widely:
`parsers-raw.js` 5 parse fns / 0 try-blocks, `parsers-sci.js` 38/6,
`parsers-audio.js` 48/14, `parsers-disk.js` 34/10 at the low end, vs
`parsers-docs.js` 36/27, `parsers-image.js` 23/29, `parsers-threed.js` 40/25 at
the high end. There's no single rule for "parser guards itself vs relies on the
dispatcher." Cheapest fix: wrap the built-in `fn(...)` call in the same
try/catch as the chunk call, then parsers can uniformly assume the dispatcher
catches and stop hand-rolling guards.

---

## 6. Module banner — one module missing it  (LOW)

**Prevailing convention:** every module starts with a one-line
`/* Analyser - <description>` banner. This holds for **112 of 113** JS modules,
and the wording/format ("`/* Analyser - …`", spaced-hyphen, no em-dash) is
strikingly uniform.

**Deviation:**
- `assets/js/core/navigate.js:1` has **no banner** — it opens straight into
  `(function () {`. (Every sibling in core/ — app.js, util.js, binutil.js,
  search.js, popups.js, effects.js, formats.js, export-data.js, video-sync.js —
  has one.)
- Minor: `assets/js/core/app.js:1` carries a UTF-8 **BOM** before its banner
  (`﻿/* Analyser - entry point`); no other module does. Harmless but odd, and it
  defeats a naive `head -1 | grep '^/\* Analyser'` banner check.

---

## False positives checked and cleared (do NOT re-flag)

These looked like drift but the convention is actually being followed; recorded
so they aren't repeatedly re-investigated:

- **Byte formatting is consistent.** `fmtBytes` (util.js:325) is used **142× across
  45 renderers**; a search found **zero** local `humanSize`/`formatBytes`/etc.
  reimplementations. The `/1024` / `1048576` hits are inline "(N MB)" size
  *thresholds* (e.g. video.js:2429, video.js:3423), not byte formatters.
- **Quote style is uniformly single-quote.** Imports are all `'…'` (no
  double-quote import found); double-quoted string literals are effectively
  absent (e.g. geo.js has exactly 1, an apostrophe case).
- **No snake_case drift in app code.** The only `a_b` identifiers are external
  JSON field names that must match the spec — `cell_type` / `execution_count`
  (notebook.js:160-163), `class_type` (photo.js:1872). Constants are uniformly
  `UPPER_SNAKE` (e.g. `CP437_HIGH`, `LABEL_HELP`, `PARSERS`, `FORMATS`); file
  names are uniformly kebab-case.
- **No shared hex-dump helper exists**, so the per-renderer hex formatting
  (`unknown.js:218`, `gitobject.js:15` `toHex`, `photo.js:979` `toHex`) is not
  *disagreeing* with a canonical one — it's an absence, not a violation. Could be
  consolidated into a `binutil.hexDump()` if desired, but that's an enhancement,
  not a normalisation, so it's out of scope here.
- **`row`/`buildReadout`/`rowHelp`** readout helpers (util.js) are used pervasively;
  no competing local table-builders were found in renderers.

---

## Suggested order of work

1. **#1 + #4 + #3** — pure mechanical renames/swaps, zero behaviour change, highest
   readability payoff (one param name, one helper call site cluster, one dead export).
2. **#2** — swap inline `new TextDecoder(...)` for binutil decoders (10 files).
3. **#5** — wrap the built-in parser dispatch in try/catch to match the chunk path,
   then optionally thin redundant per-parser guards.
4. **#6** — add the banner to navigate.js; strip the BOM from app.js.
