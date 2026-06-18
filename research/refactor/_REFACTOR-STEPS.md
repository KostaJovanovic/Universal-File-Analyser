# Analyser - refactor, planned step by step

Execution plan derived from `_REFACTOR-PLAN.md` and the 8 dimension files
(`app-entry`, `big-renderers`, `core-lib`, `css`, `deadcode`, `duplication`,
`html-tooling`, `parsers`). Every step is **behaviour-preserving** (move / extract /
dedup, no logic change), independently shippable, and verifiable only by eye +
`server.bat` (no tests). Ordered easiest/safest first so the file shrinks and the
drift bugs close before any risky split.

## Global guardrails (apply to every step)
- **Re-export every symbol from its original module path.** Cross-module importers
  (`renderPhoto`, `openLightbox`, `makeSpectrogramPanel`, `makePlayer`,
  `extractPeIcon`, `parseStepHeader`, `revealPhotoSection`, OCR fns,
  `CATEGORIES`, the generator-consumed `catalogGrouped`/`formatCount`/
  `renderAboutFormats`/`renderFmtOverlay`) must keep working - verify importers
  before moving, keep a re-export in the old file.
- **SHELL discipline.** Any new *statically*-imported module under a SHELL renderer
  must be added to `sw.js` SHELL the same commit. Lazy `import()` chunks
  (`parsers/*`, future `prop-*`) stay OUT of SHELL.
- **Do not relocate** `COMMIT_COUNT` (app.js:7), `RELEASE_COMMITS` (15), or
  `sw.js` `VERSION` - `save.bat` rewrites them by name+file. Move `analyserVersion()`
  only, if at all.
- **Do not touch** (or only with extreme care): the drop-loader race machinery +
  `_currentToken` cancellation protocol in `handleFile`; `classifyFile` ordering
  (svg/midi/markdown/go.mod/exe-dll); `boot._*` SPA guards; `navigate.js`;
  video probe-element lifecycle + RAW/maker-note fallback ladders; X509/PE/AXML
  binary offset math; the proprietary dispatch order + `_`-payload field order +
  the `'../parsers/parsers-'+chunk+'.js'` dynamic-import string.
- **One logical change per commit.** Run `node --check` on touched JS, then
  `server.bat`, then drop a representative file for each affected type.
- Commits are the user's job (`save.bat`) - never commit unprompted.

## Note vs the original plan
- `deadcode.md` re-confirmed there are **no orphan modules** and **no SHELL drift on
  disk**; the only list drift is `TIERS.essentials` (Wave 1). The genuinely-dead
  items are 4 small symbols (Wave 0).
- New NLE renderers added since the plan (davinci/premiere/vegas/sony-rtmd/gcsv/
  unity/vssolution/video-sync) are already folded into the counts below.

---

## At-a-glance order

| Wave | Steps | Theme | Risk |
|------|-------|-------|------|
| 0 | S1-S4 | Dead-code & trivial dedup | ~0 |
| 1 | S5 | Single-source the TIERS/SHELL drift | low |
| 2 | S6-S9 | Shared leaf helpers (download/copy/hex/shadowed-fns) | very low |
| 3 | S10-S13 | Shared modules: parser-util, xml, timeline-shared | low-med |
| 4 | S14-S17 | CSS hygiene (tokens, dead selectors, sectioning) | low |
| 5 | S18-S21 | Generator pipeline + head single-sourcing | low-med |
| 6 | S22-S30 | app.js: EXT_KIND + module extractions | low-med (S30 med) |
| 7 | S31-S35 | Split the four giant renderers | med |
| 8 | S36+ | Optional polish | varies |

---

## Wave 0 - dead code & trivial dedup (4 tiny commits)

**S1. Delete 3 dead JS exports.** `PAGE_PAD` (`renderers/paged.js:28`);
`sessionOcrLang()` getter (`renderers/photo.js:183`, keep the backing
`_sessionOcrLang`); `_internals` (`renderers/timeline.js:266`, test-only, no tests
exist). Source: deadcode.md §2.

**S2. Delete dead `Reader.u24()`** (`core/binutil.js:38-41`) - zero callers. Source:
core-lib.md §4.

**S3. Delete duplicate local `ascii()` in proprietary.js** (lines 18-25), use the
`ascii` already importable from binutil.js (it already imports `utf16,utf8` from
there). Source: parsers.md #1, duplication.md #6a. *(S1-S3 can be one "dead code"
commit.)*

**S4. Delete 19 confirmed-dead CSS selectors** (css.md 1.3): `about-ext about-exts
about-fmt-desc about-readout anr-card-empty anr-coverart anr-defs
anr-dropdown-list anr-dropdown-trigger anr-fs-btn anr-hash-out anr-spec-play
anr-status-name anr-timecode-input anr-transport is-downloaded site-about-link
stats-ext-tag anr-preview-meta anr-pick-link anr-extfilter-label`. **Verify each
individually** against JS string-concat classes (do NOT delete the dynamically-built
`anr-json-*`, `anr-md-h*`, `anr-page--*`, `didyouknow`/`dyk-*`/`format-cta*`, or the
PDF.js `endOfContent`/`markedContent`). Own commit.

## Wave 1 - kill the TIERS/SHELL drift (highest value/lowest risk structural)

**S5.** `app.js` `TIERS.essentials` (~line 1992) is missing 8 statically-imported
modules that `sw.js` SHELL caches: `core/video-sync.js`, `renderers/davinci.js`,
`renderers/gcsv.js`, `renderers/premiere.js`, `renderers/sony-rtmd.js`,
`renderers/unity.js`, `renderers/vegas.js`, `renderers/vssolution.js`.
- *Minimum:* add the 8 to the essentials list.
- *Better (preferred):* derive `sw.js` SHELL and `TIERS.essentials` from one shared
  exported array (or have `save.bat` stamp both) so the two hand-lists can never
  drift again. Keep the games/* submodules out of essentials (pulled in transitively
  via `asteroids.js`).
Source: deadcode.md §5, app-entry "load-bearing", master #1.

## Wave 2 - shared leaf helpers (pure, touch many files, verifiable by eye)

**S6. `downloadBlob(filename, blob)` + `downloadButton(label,{blob|href,filename,signal?})`
in `core/util.js`.** Replace the ~10 programmatic `createObjectURL->a[download]->
click->revoke` sites (audio.js:454/1223, sony-rtmd.js:312, video.js:155/2069/2776/
3317, photo.js:2069/2158/2554, pdf.js:777/927, comic.js:108) and the styled-`<a>`
variant (embedded-images.js:52, media-reverse.js:45, video.js:172, photo.js:2455).
Use one revoke policy. **Keep divergent:** embedded-images.js's AbortSignal-tied
revoke + tainted-canvas fallback; video's WAV row reusing the player URL. Migrate
opportunistically. Source: duplication.md #3, big-renderers §0.

**S7. `copyText(text):Promise<boolean>` in `core/util.js`** - lift the robust
version from `popups.js:381-397` (clipboard + `execCommand` fallback); unify the
clones in `util.js:505` (`buildFileTree`) and `treemap.js:478`. Optional
`wireCopyButton(btn,text,{idle,done})` for the "Copied!->reset" flash. Source:
duplication.md #3, core-lib.md 1e.

**S8. `hexBytes(bytes,sep=' ')` / `hexByte(b)` in `core/binutil.js`.** Replace the
inline `Array.from(b).map(x=>x.toString(16).padStart(2,'0')).join(...)` in
util.js:394, unknown.js:218, parsers-archive.js:244/280, photo.js:2534, and the
per-file `toHex` in gitobject.js:15, photo.js:979, davinci.js:57, parsers-email.js:763.
Source: core-lib.md #2.

**S9. Drop shadowed util copies** (import the canonical instead): `fmtDate`
(video.js:1117, photo.js:335 -> util.js:343); `gcd`/`aspectRatio` (video.js:1099/1101,
photo.js:272/274); `getMono` (video.js:2179 -> export from audio-analysis.js, audio.js:37);
`computeStats` (video.js:2191 -> audio-analysis.js already exports it); the three
mm:ss formatters (video.js:1107 `formatDuration`, audio.js:312 `fmtClock`,
spectrogram `formatTime`) -> one `fmtClock`. Source: big-renderers §0.

## Wave 3 - shared modules (parser-util, xml, timeline)

**S10. `parsers/parser-util.js`.** Shared `safe(fn)` (try/catch -> null, falsy ->
null - match today's most lenient semantics), `readText(file,cap)`,
`readAll(file,cap)`, `idOnly(ext,name,note?)`, with the parser-module contract
documented once in its header. Migrate the 3 private `wrap` copies (parsers-audio:1381,
parsers-video:1311, parsers-gaming:938) and the 4 `readText` copies (email:30,
video:55, geodata:20, security:43) **one chunk at a time**, preserving each call's
explicit cap. Leave the two intentionally-different `fmtDuration` variants. Source:
parsers.md #2/#4.

**S11. Apply `safe()` uniformly to BOTH PARSERS maps** in `renderProprietary`
(built-in map proprietary.js:3793 + lazy-chunk call 3911) - closes the gap where a
built-in parser throw rejects the whole render while a chunk throw is swallowed.
Verify no parser relied on throwing. Source: parsers.md #3.

**S12. `lib/xml.js` (new, add to SHELL).** Consolidate `parseXml(text,{strict})`,
`parseXhtml` (epub fallback), `escapeXml` (verbatim 4x: davinci:35/premiere:33/
aftereffects:30/diagram:21), `childEls`/`firstChildEl`/`childText`, `elemText`,
NS-aware `attrNS`/`isEl`/`childElsNS`/`elsNS`/`firstNS`, `relId` (verbatim in
xlsx:99/pptx:93/docx:36), `regexGrab` (docx's `grab` x4 + aep XMP), and opt-in
`sanitizeTagSeparators` (davinci's `::`->`__` fix). Support both error contracts
(null vs throw via `{strict}`/`onError`). **Leave out:** svg.js security sanitiser,
vegas UTF-16 scrape, model3d 3MF namespace avoidance (intentional). Migrate
diagram/odf/textdoc/epub/plist first (canonical near-identical helper). Source:
duplication.md #2.

**S13. `renderers/timeline-shared.js` (new, add to SHELL).** Biggest single line win
(~300-400). Extract the ~210-line zoom/pan card shell (`buildSequenceTimeline`
premiere:230 / `buildTimelineCard` davinci:261 / `buildCompTimeline` aftereffects:177
are ~90% identical; wheel/drag/ResizeObserver blocks byte-identical) into
`buildTimelineCard({rows,dur,labelW,maxZoom,metaLine,labelsSvg,lanesSvg,fitUnit})`,
plus `trackLabelsSvg`/`trackLanesSvg` (via `project(v)->x`, `colorOf`, `tooltipOf`
callbacks), formatters `secToTc`/`framesToTc`/`fmtTime`/`fmtTick`/`fmtFps`, and
`TL_COLORS`. premiere/davinci/aftereffects consume the shell; `timeline.js` consumes
only the formatters + `TL_COLORS` (keeps its own CSS/`<div>` renderer); `vegas.js`
stays out (no timeline). **Verify against real `.prproj`/`.drp`/`.aep` samples** -
preserve byte-exact zoom/pan. Source: duplication.md #1.

## Wave 4 - CSS hygiene (one stylesheet, pixel-preserving)

**S14.** Swap hardcoded dark literals to existing tokens: `#333`->`var(--hairline)`
(11x), `#555`->`var(--hairline-strong)` (4x), `#e8e8e8`->`var(--fg)` (5x), all inside
`:root[data-theme="dark"]` scope (~2824-2880, 1167, 1082); and the already-tokened
`rgba(255,255,255,0.5/0.15/0.4/0.8)` -> `--border-on-dark-strong`/`--border-on-dark`/
`--white-a40`/`--white-a80`. Pixel-identical. Source: css.md 1.2 step1 + 2.1.

**S15.** Add `--bd-hairline: 1px solid var(--hairline);` (and `--bd-rule`) to `:root`,
collapse the **full-shorthand** `1px solid var(--hairline)` cases (111x) to
`border: var(--bd-hairline)`. Review, not blind replace - leave `border-color`/
`-bottom`-only and non-hairline cases. Source: css.md 1.1.

**S16.** Delete now-redundant dark overrides whose only job was swapping a light
hairline for `#333` - once the base rule uses `var(--hairline)` (which flips in the
dark `:root`), the override is dead. Spot-check each: keep overrides that also change
`background`. Source: css.md 1.2 step2.

**S17.** Rename the mislabelled `UTILITY / REFACTOR CLASSES` section (4664-5217) to
`FILE TREE / TREEMAP`; lift the 3 real utilities (`.is-hidden`,
`.anr-pre-scroll*`) to a small UTILITIES block after `:root`; add a top-of-file ToC
comment mapping section->line. Keep the `:has(+ ...)` pair at 4926 adjacent. Source:
css.md 2.2 + 3.1. *(Defer 2.3 breakpoints and 3.2 `:has()`->body-class - behaviour-
touching, low payoff.)*

## Wave 5 - generator pipeline + head single-sourcing (independent of JS splits)

**S18. Fill out `tools/prerender-common.mjs`** (the enabler, do first): add
`today()` (dedupe prerender-format-pages:48 + stamp-counts:33), `loadCatalog()`
(dedupe the `pathToFileURL(formats.js)` import in all 3 catalog readers),
`THEME_SCRIPT` and `SHARE_SVG` consts (promote from prerender-format-pages:129/373),
and a `stampFile(path,passes)` / `stampRegion(html,start,end,block)` idempotent
change-tracking writer (the shape stamp-counts:64 and stamp-footer:43 both reimplement).
Source: html-tooling.md #4.

**S19. `tools/build.mjs` orchestrator.** Replace the 4 ordered `node tools/*.mjs`
calls + 4 `if errorlevel 1` blocks in `save.bat` with one orchestrator that *imports
and runs* the passes in the encoded order (prerender-formats -> prerender-format-pages
-> stamp-counts -> stamp-footer -> future stamp-head), so the
**stamp-counts-before-stamp-footer** dependency (stamp-counts edits the footer
partial) lives in code, not `.bat` line order. Keep each pass independently runnable
via an `if (isMain) run()` guard (CLAUDE.md + docstrings reference them as standalone
commands). Source: html-tooling.md #4.

**S20. Single-source the `<head>` boilerplate** (highest html payoff). Add
`tools/partials/head-shared.html` (theme-color pair, favicon/apple-touch/manifest
links, the 2 stylesheet links, the inline theme `<script>`) and `tools/stamp-head.mjs`
stamping a `<!-- HEAD:START -->...<!-- HEAD:END -->` region on the 7 pages - exactly
the stamp-footer mechanism. Import `THEME_SCRIPT` from prerender-common into BOTH
stamp-head and prerender-format-pages (kills the hand-pasted twin at
prerender-format-pages:373). Leave title/description/canonical/OG-text/JSON-LD
hand-authored outside the markers. Keep the theme script last in `<head>` (before-
first-paint, no flash). Add to the build.mjs order. Source: html-tooling.md #1/#3.

**S21. (optional) Stamp the invariant header slice** - only the `.site-meta <dl>`
(identical on 6 pages) + the `page-drop` overlay block + the share SVG, via
`tools/partials/header-shared.*` markers. **Leave the nav row hand-authored** (it's
legitimately per-page: kicker/title/active-link). Source: html-tooling.md #2.

## Wave 6 - app.js: data-driven classification + module extractions

Each extraction is move-only (cut block, `export`, `import` back); add each new
static `core/*` child to SHELL. Land the big isolated ones first.

**S22. `EXT_KIND` table + slim `classifyFile` + drift assert.** Collapse the ~50 flat
`ext==='x'->kind` / `SET.has(ext)->kind` branches (app.js classifyFile 363-471) into a
single `EXT_KIND` map co-located with `ROUTES` (477), so adding a flat format is a
one-line edit in one place. Keep only the genuinely ordered/conditional logic in
`classifyFile` (MIME prefix checks 367-371, `go.mod` guard 399, exe/dll photo case,
the PHOTO/AUDIO/VIDEO/proprietary fallback chain 466-470). Add a load-time
`console.assert` that every `EXT_KIND` value is a `ROUTES` key (free drift detection).
**Preserve the load-bearing ordering.** Source: app-entry.md §2.

**S23. `core/offline.js`** <- the offline/PWA download manager (TIERS/TIER_MB +
downloadTier/refreshTierButtons/markCached/detectCachedTier/tierUrls/offline-state IO/
Clear/install-prompt, ~2116-2492, ~375 lines) -> `setupOffline()`. Biggest single
readability win; references only `analyserVersion`/`COMMIT_COUNT` + `el`. Source:
app-entry.md #1.

**S24. `core/fmt-overlay.js`** <- format overlay + `/formats` hub search
(2494-2824, ~330 lines) -> `setupFmtOverlay()`; share `applyFilter`/`applyPageFilter`
into one `filterFmtItems`. Carry the `boot._fmtKeyWired`/`_hashWired` guards. Source:
app-entry.md #3.

**S25. `core/stats-page.js`** <- `recordAnalysed`/`recordVisit`/`setupStatsPage`
(558-760). Import back into handleFile/header. Source: app-entry.md #4.

**S26. `core/classify.js` + `core/sniff.js`** <- `classifyFile`/`MARKUP_EXTS`/
`UNITY_EXTS` (do alongside S22) and `sniffFileType` (221-278) + the inline re-sniff
extracted as `sniffUnknownKind(file,kind)`. Source: app-entry.md #5.

**S27. `core/router.js`** <- `ROUTES` (477-539) + the ~45 renderer imports (27-73) +
`dispatchRender(kind,file,els,opts)` encapsulating the proprietary/comic ext-override
and photo+sidecarXmp cases (1305-1322). `handleFile` stays in app.js (closure-bound).
Source: app-entry.md #6.

**S28. `core/patch-digest.js`** <- the ~130-line `PATCH_DIGEST` data array (769-897)
+ `setupPatchTldr`. Trivial. Source: app-entry.md #7.

**S29. Small helpers** (each replaces 3-7 sites): `spaGo(href)` (the throwaway-`<a>`
SPA hop x5: konami 1755, tap-egg 1804, random-format 2774, drop-handler 1561/1587) +
`stashAndGoHome(key,value)`; `navLink(sel)` (~7x); `eachMediaSection(fn)` (the
photo/audio/video triple x4); `bindOnce(el,evt,fn)` (the `if(!el._wired)` idiom 20+x -
its own diff). Source: app-entry.md §3/#8.

**S30. Decompose `handleFile()`** (1105-1437) into `prepareMediaSections` (1272-1303),
`decideArchiveEmbed` (1212-1242), `setupAutoScroll` (1324-1357 + finally re-assert),
`onRenderSettled` (1378-1436). **LAST and highest-risk** - eyes-open on the
`_currentToken`/`token.cancelled` checks and loader-flash machinery; one helper per
commit. Source: app-entry.md #9.

*(Optional: `core/version.js` for `analyserVersion()` only - leave COMMIT_COUNT in
app.js. Low priority, save.bat coupling.)*

## Wave 7 - split the four giant renderers

Pre-req `core/isobmff.js` first; then easiest/least-coupled (proprietary, audio)
before the stateful ones (video, photo). Add every new static child to SHELL; keep
lazy `prop-*` chunks out of SHELL. Re-export all currently-exported symbols.

**S31. `core/isobmff.js`** <- the MP4/box walker (`parseBoxes` video.js:1131,
`findAllBoxes` 1149, `fcc` 1632), imported by video.js and proprietary.js. Add SHELL.
Unblocks S34. Source: big-renderers §0/§1.

**S32. proprietary.js -> `prop-*.js` (or `proprietary-parsers.js`).** Easiest of the
four (stateless parsers, `PARSERS` table is the dependency manifest). Two routes:
(a) *safe mechanical* - move the ~70 `parseXxx` bodies into a sibling
`proprietary-parsers.js`, keep PARSERS + renderProprietary in place (no routing/error
change); or (b) *bundle-size* - migrate cohesive groups to lazy `chunk:` entries
(only AFTER S11's uniform wrapping, group-by-group). Start with the PE cluster
(parsePe/parseExe/readUtf16Value/extractPeIcon/PE_HELP) and font cluster
(AXIS_NAMES/readNameTable/readFvarTable/sfntTableOffsets/woffTables/parseFont) - both
self-contained, already partly exported. `extractPeIcon`/`parseStepHeader` keep their
public path. Source: big-renderers §2, parsers.md #5/#6.

**S33. audio.js -> `audio-spectrogram-panel.js` + `audio-live.js`.** Move the whole
`spec*` cluster + `makeSpectrogramPanel` (535-983) as one unit (re-export it - video.js
imports it); move `startRecording`/`startLive` to audio-live.js (import `ctx()`, don't
duplicate the AudioContext). Add both to SHELL. Source: big-renderers §4.

**S34. video.js -> `video-ffmpeg.js` / `video-raw-h26x.js` / `video-container.js` /
`video-pcm.js` / `video-frames.js`.** FFmpeg singleton + loader-overlay state move as
ONE unit (video-ffmpeg.js); raw-h26x depends on it; container/pcm sit on
`core/isobmff.js`. Keep `renderVideo`/`initVideo`/probe-element lifecycle/abort var in
video.js. Add each child to SHELL. Source: big-renderers §1.

**S35. photo.js -> `photo-exif.js` / `photo-pixels.js` / `photo-containers.js` /
`photo-lightbox.js` / `photo-ocr.js`.** Re-export `openLightbox` (video.js imports it),
OCR fns, `revealPhotoSection`. Keep `_sessionOcrLang` inside photo-ocr; keep
`renderPhoto`/RAW fallback ladder/maker-note decode in photo.js. Add children to SHELL.
Source: big-renderers §3.

## Wave 8 - optional polish (only if still worthwhile after 0-7)
- `lib/wasm-loader.js` `memoizeAsync`/`lazySingleton`; migrate occt/openjpeg/
  libarchive(/sqlite) - extract only the ~5-line promise-memoise wrapper, NOT vendor
  glue; leave ghostscript/xz/lzma. (core-lib.md #6)
- `util.js` barrel-split into `format.js`/`readout.js`/`file-io.js` + move `LABEL_HELP`
  -> `core/label-help.js` + back-button/overlay-stack -> `core/overlay-nav.js`; keep
  `util.js` re-exporting everything (~69 importers - never rename/drop). (core-lib.md #3/#4/#7)
- `openModal()` scaffolding (popups x3 + export-data). (core-lib.md #8)
- `canvasFromImage({maxDim,smoothing})` + `buildContactSheet(...)` (duplication.md #4);
  ZIP central-dir reader in zip.js (duplication.md #5); `analyseHopButton`/
  `embeddedPreviewCard` (duplication.md #7); `toggleFullscreen` (duplication.md #8).

---

## Suggested commit cadence
Waves 0-2 are a single focused session (all near-zero risk, immediate shrink + the
drift fix). Wave 3 one module per sitting (verify each against real samples). Waves
4-5 are independent of the JS splits - slot them whenever. Wave 6 lands the big
isolated app.js extractions first (S23/S24/S25), then S22+S26 together, then S27/S28,
helpers opportunistically, S30 last. Wave 7 one renderer (indeed one child) at a time,
SHELL updated and a sample dropped before the next. After every change: `node --check`
-> `server.bat` -> drop a representative file.
