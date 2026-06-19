# Analyser - refactoring plan (master)

Consolidates the eight dimension analyses in this folder into one ranked, phased
plan. Each was produced by a separate agent reading the relevant code in depth.

- `app-entry.md` - app.js entry point + routing
- `big-renderers.md` - video/photo/audio/proprietary internal splits
- `duplication.md` - cross-module copy-paste -> shared helpers
- `core-lib.md` - core/ + lib/ utility layer
- `parsers.md` - parsers-*.js dispatch + boilerplate
- `css.md` - analyser.css architecture
- `deadcode.md` - unused exports / module-list drift
- `html-tooling.md` - page <head> boilerplate + generator pipeline

## Hard constraints (every proposal honours these)
- **No build step.** Vanilla ES modules, no bundler/Sass/PostCSS - keep it that way.
  Splits mean more files + more `import`s + `sw.js` SHELL entries, not a toolchain.
- **No tests.** Every change must be behaviour-preserving and reviewable by reading.
  Prefer mechanical "move + re-export from old path" so existing imports keep working.
- **SHELL discipline.** Any new *statically-imported* module must be added to the
  `SHELL` array in `sw.js` (offline cache) the same commit. Lazy `import()` chunks
  (parser chunks, `prop-*`) must stay OUT of SHELL.
- Site-content house style still applies to any user-facing text touched.

## The one theme that recurred everywhere: kill the duplicated module/registry lists
Three independent agents hit the same root issue - **the same information is
hand-maintained in multiple places and has already drifted**:
- `classifyFile()` kind strings + `ROUTES` + imports in app.js (app-entry).
- `app.js` `TIERS.essentials` preload list vs `sw.js` `SHELL` - 8 imported renderers
  missing from TIERS (deadcode + app-entry).
- The inline theme `<script>` + head meta copied across 7 pages + baked into a
  generator (html-tooling).
Single-sourcing these is the highest value/lowest risk work in the whole plan.

---

## Phase 1 - High value, low risk (do first)

| # | Change | Source | Why it's safe |
|---|--------|--------|---------------|
| 1 | **Single-source the offline/SHELL module list.** Derive `sw.js` SHELL and app.js `TIERS.essentials` from one exported array (or have save.bat stamp both). Fixes the 8-module drift. | deadcode, app-entry | Data-only; lists already supposed to match. |
| 2 | **Data-driven classification.** Replace the `classifyFile()` if/else + separate `ROUTES` with one `EXT_KIND` table co-located with `ROUTES`, plus a load-time `console.assert` that every kind has a route. Adding a format becomes a one-line edit. | app-entry | Same routing output; preserve the existing match ORDER (it's load-bearing). |
| 3 | **Delete confirmed dead code:** `Reader.u24()` (binutil, 0 callers), `PAGE_PAD` (paged.js:28), `sessionOcrLang()` (photo.js:183), test-only `_internals`/`_internals` exports (timeline.js). | deadcode, core-lib | Zero references (verified). |
| 4 | **Shared `downloadBlob()` / `copyText()` in core/util.js**, replace the ~10 blob-download + ~8 copy idioms across renderers. | duplication, big-renderers | Pure helper extraction; identical behaviour. |
| 5 | **Shared byte->hex helper in binutil.js**, replace ~6-8 inline re-implementations. | core-lib | Pure helper. |
| 6 | **Remove shadowed util copies:** local `fmtDate`/`gcd`/`aspectRatio`/`getMono`/`computeStats` in renderers that already have canonical homes - import the canonical one. | big-renderers | Same function, de-duplicated. |
| 7 | **CSS consolidation (no restructure):** tokenise `1px solid var(--hairline)` (111x), fix ~22 dark-mode overrides hardcoding `#333/#555/#e8e8e8` instead of existing tokens (several overrides become deletable), remove the 19 confirmed-dead selectors (respect the do-not-delete JS-built list). | css | Visual-equivalent; keep one file. |

## Phase 2 - Shared modules (medium effort, contained risk)

| # | Change | Source | Notes |
|---|--------|--------|-------|
| 8 | **`renderers/timeline-shared.js`** - absorb the ~210-line byte-identical zoom/pan card shell + SVG lane/label builders + timecode formatters + colour palette duplicated across premiere/davinci/aftereffects (and align vegas/timeline where they match). | duplication | Biggest single de-dup. Move verbatim, re-export. Add to SHELL. |
| 9 | **`lib/xml.js`** - consolidate the 8 hand-rolled `parseXml`, 4 verbatim `esc`, and the copied DOM-helper families; carry davinci's `::` namespace fix as an opt-in flag. Leave svg.js's security sanitiser and model3d's namespace-avoidance separate (intentional). | duplication | Keep divergences that exist for a reason. |
| 10 | **`parsers/parser-util.js`** - one shared safe-wrap + `readText`/`readAll`/`idOnly`, replacing 3x private `wrap` and ~4x `readText`. **Also wrap the built-in `PARSERS` map in proprietary.js in the same try/catch** - today a built-in parser throw escapes the swallow that chunk parsers get (a real latent bug). | parsers | Unifies error handling; fixes an inconsistency. |
| 11 | **Unify the `lib/*-loader` memoise-promise pattern** for the 3-4 loaders that share it (libarchive/openjpeg/occt-style). Leave ghostscript/xz/lzma alone (genuinely different). | core-lib | Small shared `once(loaderFn)` helper. |
| 12 | **`core/isobmff.js`** - the MP4/box-walker reused in video.js and proprietary.js. | big-renderers, duplication | Move verbatim; both import it. |

## Phase 3 - Split the giant files (mechanical, higher review surface)

Each split is "cut a cohesive cluster into a new module, re-export every symbol from
the old path so callers don't change." Add each new *static* child to `sw.js` SHELL;
keep lazy `prop-*` chunks out.

| # | File (lines) | Proposed children | Source |
|---|--------------|-------------------|--------|
| 13 | **app.js** (~2840) | `core/offline.js` (~375), `core/fmt-overlay.js` (~330), `core/stats-page.js` | app-entry |
| 14 | **proprietary.js** (~4100, ranked EASIEST - stateless registry) | `prop-*.js` domain files (PE + font clusters first) driven by the existing `PARSERS`/`FORMATS` table | big-renderers, parsers |
| 15 | **video.js** (~3585) | `core/isobmff.js`, `video-ffmpeg.js` (FFmpeg singleton + overlay as ONE unit), scene-detect, players | big-renderers |
| 16 | **photo.js** (~2870) | `photo-exif.js`, `photo-lightbox.js` (OCR/lightbox/audioCtx singletons each move as a unit) | big-renderers |
| 17 | **audio.js** (~1959) | `audio-spectrogram-panel.js`, analysis vs player split | big-renderers |
| 18 | **util.js** (~790 grab-bag) | barrel-split: DOM helpers vs formatters vs async; lift the 110-line `LABEL_HELP` and the import-time PWA back-button subsystem out | core-lib |

**Do-not-touch (fragile / load-bearing), called out by the agents:**
`COMMIT_COUNT`/`RELEASE_COMMITS` (rewritten by save.bat); the drop-loader
`_currentToken` race machinery and `classifyFile` ordering; `boot._*` SPA guards;
navigate.js; the render* orchestrators' module-level AbortControllers + self-recursion
(keep each with its file); video.js probe lifecycle, maker-note/RAW fallback ladders,
X509/PE walkers (move verbatim only); the parser routing order, `_`-payload protocol,
and the dynamic-import string in proprietary.js.

## Phase 4 - Pages & tooling

| # | Change | Source |
|---|--------|--------|
| 19 | **`tools/stamp-head.mjs`** mirroring stamp-footer's marker pattern, to single-source the ~25-30 identical `<head>` lines (OG/Twitter, theme `<script>`, favicon/manifest) across the 7 pages + the twin baked into prerender-format-pages.mjs. Stamp at save.bat time (not a runtime include - build-free). | html-tooling |
| 20 | **Fill out `prerender-common.mjs`**: shared `today()`, `loadCatalog()`, `THEME_SCRIPT`, `SHARE_SVG`, a reusable `stampFile()` pass-runner used by both stamp-counts and stamp-footer. | html-tooling |
| 21 | **One save.bat orchestrator** replacing the 4 ordered `node` calls, encoding the real dependency (stamp-counts edits the footer partial, so it must precede stamp-footer). | html-tooling |
| 22 | Dedup the header `.site-meta dl` / `page-drop` blocks (safe); leave the per-page nav row alone (genuinely per-page, higher risk). | html-tooling |

---

## Suggested order
Phase 1 (a single focused session - all low risk, immediate cleanup + the drift fixes)
-> Phase 2 (shared modules, one per sitting, verify in `server.bat` after each)
-> Phase 4 (tooling/head single-sourcing - independent of the JS splits)
-> Phase 3 (the big-file splits, one file at a time, each its own reviewable commit).

After each change: `node --check` the touched JS, run `server.bat`, and exercise the
affected file type in the browser (the only "test" available). For splits, confirm
`sw.js` SHELL lists every new static module before considering it done.

Everything here is dev-only planning under `research/` - no source changed.
