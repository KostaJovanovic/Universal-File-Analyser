# Dead-code / unused-export / cache-drift audit — Analyser

Scope: `assets/js/**` (115 modules), `sw.js` SHELL, `tools/*.mjs`, main `*.html`.
Method: ripgrep over import statements (static + `import('...')` dynamic + string
paths), per-symbol export usage scan, SHELL ↔ disk ↔ app.js preload cross-check.
No source files were modified.

## Headline

- **No orphaned JS modules.** Every file in `assets/js/**` is imported somewhere
  (statically or via dynamic `import()`/string path) **and** listed in `sw.js`
  SHELL. The 115-module set is fully reachable.
- **No SHELL drift in either direction:** every SHELL JS entry exists on disk,
  and every on-disk module is in SHELL.
- Only genuinely-dead items are **3 unused exports**; the rest of the "unused
  export" hits are exports that are live but only consumed *inside their own file*
  (the `export` keyword is redundant, not the code).

## 1. Unreferenced JS modules

| Item | Evidence | Confidence | Action |
|---|---|---|---|
| (none) | All 115 modules under `assets/js/**` have ≥1 importer and appear in `sw.js` SHELL. Heavy-lib loaders are reached via dynamic `import()` (e.g. `archive.js`, `pdf.js`, `photo-convert.js`, `video.js`, `ghostscript-loader.js`, `occt-loader.js`); games/* submodules are reached transitively from `games/asteroids.js` (dynamically imported in `app.js:647,1837`). | high | No action |

## 2. Truly-dead exports (defined, never read anywhere)

| Symbol | File:line | Evidence | Confidence | Action |
|---|---|---|---|---|
| `PAGE_PAD` | `assets/js/renderers/paged.js:28` | `export const PAGE_PAD = 56;` — only occurrence in the entire tree (siblings `PAGE_W`/`PAGE_H` are used; this one is not). | high | Delete the constant |
| `sessionOcrLang()` | `assets/js/renderers/photo.js:183` | Exported getter `export function sessionOcrLang(){...}` is never called outside its own file. The backing var `_sessionOcrLang` *is* used internally (lines 191, 257), so only the public wrapper is dead. | high | Delete the exported getter (keep `_sessionOcrLang`) |
| `_internals` | `assets/js/renderers/timeline.js:266` | `export const _internals = {...}` with comment "Exposed for unit testing in Node." Project has **no tests** (CLAUDE.md: "no tests"). Never imported. | high | Delete (re-add if/when tests exist) |

## 3. Redundant `export` keyword (code is live, used only within its own module)

These are NOT dead code — each symbol is referenced inside its defining file —
but nothing else imports them, so the `export` is unnecessary surface area. Low
priority; drop the `export` only if tightening the public API is a refactor goal.

| Symbol | File | Note |
|---|---|---|
| `LABEL_HELP` | `core/util.js:26` | Used internally by `row()`/`helpTh()` (util.js:168). |
| `FULL_ANALYSIS` | `core/formats.js:113` | Used only inside formats.js (catalogGrouped etc.). |
| `IDENTIFICATION` | `core/formats.js` | Used only inside formats.js. |
| `IDENTIFICATION_CORE` / `IDENTIFICATION_EXTENDED` | `core/formats.js` | Imported by `tools/format-page-content.mjs` — keep export (consumed by generators, not JS modules). |
| `CATEGORIES` | `core/formats.js` | Imported by `app.js` + `folder-archive-shared.js` — keep. |
| `CATEGORY_COLORS`, `CATEGORY_LABELS`, `buildCategoryBreakdown` | `renderers/folder-archive-shared.js` | All used internally only. |
| `inflateToBytes`, `readZipEntries` | `renderers/zip.js` | Used internally only (the widely-imported export is `openZip` / `inflateToText`). |
| `buildGyroCard`, `collectSonyImu`, `extractSonyGyro` | `renderers/sony-rtmd.js` | Used internally only (external callers use `appendSonyGyroCard` / `buildImuTimeline`). |

> Caveat: items consumed by `tools/*.mjs` generators or by inline `<script>` in
> `about.html`/`formats.html` (e.g. `renderFmtOverlay`, `renderAboutFormats`,
> `catalogGrouped`, `formatCount`, `categoryCounts`, `formatPageHref`,
> `hasFormatPage`) look "unimported" to a JS-only scan but are **live** — do not
> remove. Verified present in `tools/prerender-formats.mjs`,
> `tools/prerender-format-pages.mjs`, `tools/stamp-counts.mjs`, and the HTML.

## 4. SHELL / offline-cache drift

| Item | Evidence | Confidence | Action |
|---|---|---|---|
| SHELL entries missing on disk | None — all `./assets/js/*.js` in `sw.js` exist. | high | No action |
| On-disk modules missing from SHELL | None. | high | No action |

## 5. Secondary preload list drift (maintenance hazard, not dead code)

`app.js` carries a **second** hand-maintained module list (the `TIERS.essentials`
download list, ~line 1995). It is *not* dead, but it has drifted from `sw.js`
SHELL: 8 statically-imported renderers are in SHELL/imports but **absent** from
the essentials preload list:

`core/video-sync.js`, `renderers/davinci.js`, `renderers/gcsv.js`,
`renderers/premiere.js`, `renderers/sony-rtmd.js`, `renderers/unity.js`,
`renderers/vegas.js`, `renderers/vssolution.js`.

(The `games/*` submodules also absent there are fine — pulled in transitively via
`asteroids.js`.) Confidence: high that these 8 are imported by `app.js` yet not
listed. Action: either add them to the essentials tier, or — better refactor —
derive both the SHELL and the TIERS list from a single shared array to stop the
two manual lists drifting. This is the highest-value structural cleanup found.

## 6. Dead branches / commented-out / unreachable code

No large commented-out code blocks or obviously unreachable branches surfaced in
the sampled modules. The only "dead" markers found are the explicit
test-only/unused exports in section 2. (A deeper line-level reachability pass
across all 115 modules was out of scope for this export/module-level audit.)
