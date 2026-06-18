# Refactoring assessment - entry point & routing layer (`app.js`)

Scope: `assets/js/core/app.js` (2837 lines, read in full), `assets/js/core/navigate.js`
(102 lines, read in full), and how `assets/js/core/formats.js` drives classification.

**Constraint reminder:** there are no tests and no build step. Every proposal below is
behaviour-preserving (pure code-motion / extraction, no logic change) and reviewable as a
diff. Nothing here should be committed without the user's explicit instruction (per
CLAUDE.md). This is a plan only - no code was changed.

---

## 1. Distinct responsibilities tangled in `app.js`

`app.js` is the page entry point, but it currently owns at least **eleven** unrelated
concerns. Line ranges are approximate but anchored to named functions / constants.

| # | Responsibility | Where (lines / symbols) | Coupling to the rest of app.js |
|---|---|---|---|
| A | **Version computation** | `COMMIT_COUNT` (7), `RELEASE_COMMITS` (15), `analyserVersion()` (17-25). Consumed at 1619 (header), 2177 (`markCached`), 2219/2313 (`downloadTier`). | None. Pure function + two constants. `COMMIT_COUNT` is rewritten by `save.bat`. |
| B | **Byte-magic sniffing** | `sniffFileType()` (221-278); the inline re-sniff inside `handleFile` (1163-1203); `sniffGitObject` import (73). | Reads nothing from `boot()` scope; returns plain `{kind,ext,label}`. |
| C | **File classification** | `MARKUP_EXTS` (348), `UNITY_EXTS` (356), `classifyFile()` (363-471). | Pure: `(file) -> kind` string. Depends only on `formats.js` ext sets + `fileExt`. |
| D | **Render routing table** | `ROUTES` (477-539) + ~45 renderer imports (27-73). | `ROUTES` values are renderer fns; consumed only in `handleFile`. |
| E | **The drop pipeline** | `handleFile()` (1105-1437) - the orchestrator. | Heavily closure-bound to `boot()` (results els, token, nav stack, loaders). |
| F | **Drop-loader / suggestion / link-confirm UI** | `showDropLoader`/`hideDropLoader` (126-214), `window._anrLoader` (211), `showTypeSuggestion`/`hideTypeSuggestion` (282-300), `showLinkConfirm` (304-341), `anrConfirm` (92-118). | Self-contained DOM widgets; module-level state. |
| G | **Anonymous telemetry** | `recordAnalysed` (558), `recordVisit` (574), `setupStatsPage` (595-760). | `setupStatsPage` is a big standalone page renderer; only touches `#statsRoot`. |
| H | **Changelog tl;dr** | `PATCH_DIGEST` (769-894, ~125 lines of data), `setupPatchTldr` (900-928). | Data + one wiring fn. Only touches `#when`. |
| I | **Offline / PWA download manager** | `TIERS`/`TIER_MB` (1981-2114), `downloadTier`/`refreshTierButtons`/`markCached`/`detectCachedTier`/`tierUrls`/offline-state IO/Clear buttons/install prompt (2116-2492). ~375 lines. | Large self-contained subsystem inside `boot()`. |
| J | **Format overlay + /formats search** | overlay wiring (2494-2745), random-format (2754-2780), hub search (2786-2824). ~330 lines. | DOM-bound, but logically a `formats.js` consumer. |
| K | **boot() lifecycle glue** | `boot()` (955-2828): result-container wiring, drag/drop, paste, dark mode, scroll-spy, konami, storage TTL sweep, etc. | The legitimate core of the entry point. |

### Proposed module splits

Ordered low-risk first. Each is **move-only** (cut a block, `export` it, `import` it back).

1. **`core/version.js`** - move A. Export `COMMIT_COUNT`, `RELEASE_COMMITS`,
   `analyserVersion()`. `app.js` re-imports. **Caveat:** `save.bat` rewrites `COMMIT_COUNT`
   *in `app.js`* (CLAUDE.md "Version numbering"); moving the constant breaks that script
   silently. So either (a) keep `COMMIT_COUNT` in `app.js` and move only `analyserVersion`,
   or (b) move it and update `save.bat`'s rewrite target in the same change. **(a) is the
   safe default** - the function is the reusable part; the constant is a build artefact.

2. **`core/sniff.js`** - move B. Export `sniffFileType()`. The inline re-sniff in
   `handleFile` (1163-1203) is *different* logic (it mutates `kind`/`sniffedExt` and runs
   the CSV/git/html heuristics) - extract it too as `sniffUnknownKind(file, kind)` returning
   `{kind, sniffedExt}`, so `handleFile` shrinks and both sniff paths live together.

3. **`core/classify.js`** - move C. Export `classifyFile()`, `MARKUP_EXTS`, `UNITY_EXTS`.
   Pure, no DOM, no `boot` scope - the cleanest extraction in the file. (See section 2 for
   the deeper rework that should ride along.)

4. **`core/drop-ui.js`** (or fold into existing `core/popups.js`) - move F. The drop loader,
   type-suggestion popup, link-confirm, and `anrConfirm` modal are all standalone widgets
   with their own module state and zero `boot()` dependency. `popups.js` already holds
   `showSuggestPopup`/`scheduleShareNudge`/etc., so these belong there or in a sibling.
   `window._anrLoader` export stays as-is.

5. **`core/stats-page.js`** - move G. Export `recordAnalysed`, `recordVisit`,
   `setupStatsPage`. ~200 lines that only run on `/stats` and `/atari`. `handleFile` calls
   `recordAnalysed`; the header badge calls `recordVisit`; both import cleanly.

6. **`core/patch-digest.js`** - move H. The 125-line `PATCH_DIGEST` data array dwarfs its
   one consumer and has nothing to do with file analysis. Export the data + `setupPatchTldr`.

7. **`core/offline.js`** - move I. The single biggest self-contained block (~375 lines).
   It is wholly inside `boot()` today but references almost nothing from boot scope except
   `COMMIT_COUNT`/`analyserVersion` (which would come from `version.js`) and the `el`
   helper. Export one `setupOffline()` that `boot()` calls. **Highest value-per-line.**

8. **`core/fmt-overlay.js`** - move J. The format overlay search, chips, highlight,
   random-format and `/formats` hub search are a `formats.js` *consumer*, not entry-point
   glue. Export `setupFmtOverlay()`. ~330 lines.

9. **`core/router.js`** - move D + the dispatch core of E. House `ROUTES`, the renderer
   imports, and a `dispatchRender(kind, file, els, opts)` that encapsulates the
   `proprietary/comic` ext-override and `photo+sidecarXmp` special-cases (1316-1322). The
   PE-icon side-effect (1362-1372) and exe/dll photo-section logic stay caller-side or move
   behind a route flag (see below). `handleFile` stays in `app.js`/`boot` because it is
   genuinely closure-bound to the live result containers and nav stack.

After 1-9, `app.js` is left with `boot()` lifecycle glue (K) + `handleFile` orchestration (E),
roughly **900-1000 lines** instead of 2837 - a readable entry point.

---

## 2. Is adding a format a one-place or many-place edit?

**Today it is a many-place edit, and the two places can silently drift.** To add one new
routed type you must touch:

1. `formats.js` - the ext set (`PHOTO_EXTS` etc.) **or** a `classifyFile` ext branch, plus
   a catalog row (per CLAUDE.md).
2. `app.js` `classifyFile()` - a new `if (ext === ...) return 'kind'` line (363-471).
3. `app.js` `ROUTES` - a new `kind: { render, results, scroll }` row (477-539).
4. `app.js` import block - `import { renderXxx } from ...` (27-73).
5. `sw.js` SHELL and the `TIERS.essentials` list in `app.js` (1986+) for offline caching.

The CLAUDE.md comment at `ROUTES` (476) and `classifyFile` already admits this: *"Adding a
file type means adding one row here plus a classifyFile() case."* That is **two parallel
tables keyed on the same `kind` string** with no enforcement that they agree. A `kind`
present in `classifyFile` but missing from `ROUTES` silently falls back to
`ROUTES.unknown` (1305) - a real bug class with no test to catch it.

The deeper smell: `classifyFile` is **~90 lines of hand-ordered `if`s over single
extensions** (374-465), and the ordering is load-bearing (comments at 367, 443, 448, 450
explain why `svg`/`midi`/`markdown`/`go.mod` must precede later checks). That ordering is
the *only* fragile part - most branches are flat `ext === 'x'` or `SET.has(ext)` lookups
that don't care about order.

### Proposed cleaner single dispatch

A **two-tier** model that keeps the load-bearing ordering but collapses the flat majority
into one data table:

- **`EXT_KIND`** - a single `Map<ext, kind>` (or `{ext: kind}`) built once, covering every
  flat `ext === 'x' -> 'kind'` and every `SET.has(ext) -> 'kind'` case. ~50 entries become
  data instead of code. Co-locate it with `ROUTES` so the same edit adds both the route and
  the ext mapping - **one place**.
- **`classifyFile()`** keeps only the genuinely *ordered / conditional* logic that can't be
  a flat lookup: MIME-type prefix checks (367-371), the `go.mod` name guard (399), the
  `exe/dll` photo-section special-case, and the final `PHOTO_EXTS/AUDIO_EXTS/VIDEO_EXTS/
  isProprietaryExt` fallback chain (466-470). Everything else becomes
  `EXT_KIND.get(ext) ?? <fallback>`.
- **Validate at module load (dev aid):** a tiny `console.assert` that every `kind` value in
  `EXT_KIND` exists as a `ROUTES` key. Free drift-detection with no test harness - fires in
  the dev console the moment the two tables disagree.

This makes adding a flat new format a **one-line edit in one file** (`EXT_KIND['foo'] =
'bar'` next to `bar: {render, results, scroll}`) while preserving the exact current
ordering for the handful of cases that need it. Pure refactor: same inputs -> same `kind`.

**Optional richer variant (higher risk, only if desired):** push `render`/`results`/`scroll`
into the `formats.js` catalog rows themselves so `formats.js` becomes the *single* source
for display **and** routing. Rejected for now - it would couple the catalog (imported by
the dev-only Node generators in `tools/`) to the renderer modules, dragging ~45 renderer
imports into a file the build scripts load. Keep routing in `router.js`.

---

## 3. Long functions / repeated patterns worth extracting

### Long functions
- **`handleFile()` (1105-1437, ~330 lines)** - the worst offender. It interleaves: reset/UI
  teardown, read-probe, classify, re-sniff, archive-embed decision, telemetry, nav flashing,
  media-section show/hide, route dispatch, autoscroll watcher, PE-icon extraction, and the
  settle/finally block. Extract, top-down:
  - `prepareMediaSections(kind, file)` - 1272-1303 (show/hide sections, disable nav links,
    `anr-nav-live` toggle). Pure DOM, ~30 lines.
  - `decideArchiveEmbed(sniff, kind)` - 1212-1242 (the zip/rar/7z/tar embed + suggestion
    suppression). Pure, returns `{archiveEmbed, suggestion}`.
  - `dispatchRender(...)` - 1305-1322 (route lookup + the three render-call shapes) -> goes
    to `router.js` (section 1.9).
  - `setupAutoScroll(kind, sec, nested)` - 1324-1357 + the re-assert in `finally`
    (1393-1400). The user-takeover watcher is fiddly and self-contained.
  - The `.finally()` settle block (1378-1436) - the suggestion popup, archive-embed render,
    guide-CTA, share-nudge - could be `onRenderSettled(...)`.
- **`setupStatsPage()` (595-760, ~165 lines)** - moving to `stats-page.js` (1.5) is enough;
  internally the scores-card (632-691) and the ext-table (693-759) are two independent
  renderers that could each be a local helper.
- **The window-`drop` handler (1534-1614, ~80 lines)** - mixes folder-peek, folder walk,
  the "navigate home and stash" pattern (twice, 1556-1568 and 1579-1593), and XMP-sidecar
  pairing (1601-1612). Extract `pairXmpSidecars(files)` and `stashAndGoHome(payloadKey,
  value)` (see repeated patterns).

### Repeated patterns (each appears 3+ times)
- **"throwaway `<a>` click to let navigate.js do an SPA hop"** - appears at least **5
  times**: konami (1755), tap-egg (1804), random-format (2774), and the two home-redirects
  in the drop handler (1561, 1587). Extract `spaGo(href)` once. The two home-redirects also
  share the "stash on window then go home" shape -> `stashAndGoHome(key, value)`.
- **`document.querySelector('.site-nav a[href="' + sel + '"]')`** - repeated ~7 times
  (1255, 1264, 1291, 1300, and inside `enterLoadedUI`/scroll-spy). A `navLink(sel)` helper.
- **"wire once, guard on `el._wired`"** - the `if (!el._wired) { el._wired = true; ... }`
  idiom appears **20+ times** across boot. A `wireOnce(el, fn)` / `bindOnce(el, evt, fn)`
  helper would remove a lot of visual noise and the occasional inconsistency (some guard on
  `_wired`, some on a custom flag like `_tldrBound`, `_confirmBound`, `_fmtWired`).
- **`['photo','audio','video'].forEach(id => { const sec = $(id); ... })`** - the
  media-section show/hide triple appears in `clearResultsUI`, `enterLoadedUI`, `cancelLoad`,
  and `handleFile`. One `eachMediaSection(fn)` helper.
- **The overlay search filter** - `applyFilter` (2616-2661, overlay) and `applyPageFilter`
  (2792-2822, /formats hub) are near-duplicate catalog-search implementations. Both moving
  into `fmt-overlay.js` (1.8) lets them share a `filterFmtItems(items, labels, query)` core.

---

## 4. Ranked recommendations (value vs risk)

Risk is low across the board because all of these are **move/extract refactors with no logic
change** - but "value" weights how much clarity each buys, and a few carry script-coupling
gotchas.

| Rank | Change | Value | Risk | Notes / gotchas |
|---|---|---|---|---|
| 1 | Extract **`core/offline.js`** (resp. I, ~375 lines) | High | Low | Biggest single readability win; self-contained. Only external refs are `analyserVersion`/`COMMIT_COUNT` + `el`. Verify nothing else in boot reads `TIERS`/`refreshTierButtons` (it doesn't). |
| 2 | Introduce **`EXT_KIND` data table** + slim `classifyFile` + load-time `console.assert` drift check (section 2) | High | Low-Med | Makes "add a format" a one-line edit. Med because you must preserve the load-bearing ordering (svg/midi/markdown/go.mod/exe-dll). Diff each `kind` against the current `if` chain carefully. |
| 3 | Extract **`core/fmt-overlay.js`** (resp. J, ~330 lines) + share the two search filters | High | Low | Pure DOM consumer of `formats.js`. Watch the `boot._fmtKeyWired` / `boot._hashWired` flags - they live on `boot`; pass them or keep a module-local guard. |
| 4 | Extract **`core/stats-page.js`** (resp. G) | Med-High | Low | `recordAnalysed`/`recordVisit` are imported back into `handleFile`/header. No DOM coupling beyond `#statsRoot`. |
| 5 | Extract **`core/classify.js`** + **`core/sniff.js`** (resp. C, B) | Med-High | Low | Pure functions, the textbook extraction. Do alongside #2 (they touch the same code). |
| 6 | Extract **`core/router.js`** (resp. D) + `dispatchRender` | Med | Low-Med | Pulls ~45 renderer imports out of the entry file. Med: the proprietary/comic/sidecar render-call shapes (1316-1322) and the exe/dll + PE-icon side-effects must move cleanly or stay caller-side. |
| 7 | Extract **`core/patch-digest.js`** (resp. H, the 125-line data array) | Med | Low | Data + one fn; trivial. |
| 8 | Add helpers: `spaGo()`, `navLink()`, `bindOnce()`, `eachMediaSection()` (section 3 repeats) | Med | Low | Each replaces 3-7 call sites. Do incrementally; `bindOnce` touches 20+ sites so land it in its own reviewable diff. |
| 9 | Decompose **`handleFile()`** into `prepareMediaSections` / `decideArchiveEmbed` / `setupAutoScroll` / `onRenderSettled` | Med | **Med** | Highest-risk item: `handleFile` is the load-bearing core, full of token/cancellation/race subtleties (the loader-flash and stuck-loader bugs are documented in comments at 131-204, 1378-1436). Extract only after 1-8, one helper per commit, eyes-open on the `_currentToken`/`token.cancelled` checks. |
| 10 | Move **`core/version.js`** (resp. A) - **function only**, leave `COMMIT_COUNT` in app.js | Low-Med | Low-Med | Risk is entirely the `save.bat` coupling: it rewrites `COMMIT_COUNT` in `app.js` (and `sw.js`'s `VERSION`). Move `analyserVersion()` freely; **do not** relocate `COMMIT_COUNT`/`RELEASE_COMMITS` unless you also update `save.bat` in the same change. |

### Load-bearing - do NOT touch (or touch only with extreme care)

- **`COMMIT_COUNT` (line 7) and `RELEASE_COMMITS` (15) in `app.js`.** `save.bat` greps/rewrites
  these by file+name on every commit (CLAUDE.md "Version numbering"). Relocating or renaming
  them breaks versioning silently. Leave the constants where `save.bat` expects them.
- **The drop-loader race machinery** (`_dropLoaderOpen` intent flag, the rAF guards, the
  `DROP_LOADER_MIN_MS` min-on-screen timer; 126-205) and the **`_currentToken` /
  `token.cancelled` cancellation protocol** in `handleFile` (1095-1103, 1124-1126,
  1143, 1215, 1364, 1378-1387). The long comments document two previously-fixed bugs
  (stuck loader, flash-and-vanish). Preserve the exact ordering of flag sets vs. rAF.
- **`classifyFile` ordering** (367, 399, 443, 448, 450) - SVG-before-image-MIME,
  go.mod-before-audio-`.mod`, MIDI-before-`AUDIO_EXTS`, markdown-before-proprietary-`md`.
  The `EXT_KIND` rework must keep these ahead of the flat lookup.
- **The `TIERS.essentials` list (1986-2049)** must stay in step with `sw.js` SHELL
  (comment at 2009). It's verbose but the duplication is intentional; don't "dedupe" it
  against `sw.js` without understanding the offline-cache contract.
- **`boot._once` / `boot._stuckResizeWired` / `boot._cardToggleWired` / `boot._hashWired`
  / `boot._fmtKeyWired` guards.** These gate *window-level* listeners against the
  SPA-renavigation `boot()` re-run (CLAUDE.md "SPA navigation"). Any extraction that moves
  a window listener must carry its guard or it will double-bind on every navigation.
- **`navigate.js`** - small, stable, and correct as-is (View Transitions SPA swap +
  hash-vs-path popstate discrimination). The comments at 93-100 explain why hash-only
  popstates must *not* re-fetch (it would tear down live analysis/blob URLs). No refactor
  warranted; leave it.

### Sequencing advice

Land #1, #3, #4, #7 first (big, isolated, near-zero risk) to shrink the file fast. Then
#2+#5 together (the classification rework). #6 (router) next. Helpers (#8) opportunistically.
Save #9 (handleFile decomposition) and #10 (version move) for last - they carry the script
and race-condition coupling. Each step is independently shippable and diff-reviewable, which
matters with no test net.
