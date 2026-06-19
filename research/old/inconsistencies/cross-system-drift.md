# Cross-system drift audit — Analyser

Base dir: `C:/Users/Kosta/Projekti/file analyser`
Date: 2026-06-18. No source files were modified.

Method: every claimed pair was diffed mechanically (basename sets, full-path sets,
md5, char-for-char after normalising CRLF). Findings below are ranked by breakage
risk. Most "parallel lists" are actually in sync; the one real drift is the
app.js offline **essentials** tier vs the service-worker SHELL.

---

## SUMMARY

| # | Pair | Verdict | Risk | Confidence |
|---|------|---------|------|------------|
| 1 | app.js `TIERS.essentials` vs `sw.js` SHELL | **DRIFTED** — 22 statically-imported modules missing from essentials | Medium (offline "Essentials" download is incomplete) | High |
| 2 | manifest.json `theme_color` vs page `theme-color` metas | Minor drift — manifest light-only `#ffffff`, pages also declare dark `#0a0a0a` | Low (cosmetic) | High |
| 3 | sw.js SHELL paths exist on disk | OK — all 134 entries resolve | — | High |
| 4 | sw.js SHELL vs all JS module files / static imports | OK — every module file and every `import` target is in SHELL | — | High |
| 5 | occt-import-js version (app.js vs occt-loader.js) | OK — both `0.0.23` | — | High |
| 6 | ffmpeg-core / tesseract / OCR-CDN URLs | OK — single occurrence each, no conflicting pins | — | High |
| 7 | format count (manifest / index / patch / formats / about) | OK — `1061` everywhere | — | High |
| 8 | footer partial vs stamped footers (6 pages) | OK — identical (CRLF-only diff), all 6 share one md5 | — | High |
| 9 | inline theme `<script>` (6 pages) vs generator-baked copy | OK — identical md5 across pages and generator | — | High |
| 10 | sitemap.xml routes vs real pages + llms.txt | OK — all 6 pages + llms.txt present and listed | — | High |
| 11 | sitemap-formats.xml vs generated `formats/` pages | OK — 1062 locs = 1 hub + 1061 pages = 1061 files | — | High |
| 12 | `RELEASE_COMMITS` (app.js) vs `RELEASES` (save.bat) | OK — both `29,60,100` | — | High |
| 13 | `COMMIT_COUNT` (app.js) vs `VERSION` epoch (sw.js) | OK — `135` / `analyser-v135` | — | High |

---

## FINDING 1 — app.js `TIERS.essentials` is missing 22 modules that SHELL caches (DRIFTED)

`assets/js/core/app.js:1986-2049` defines `TIERS.essentials`, the list the
"Essentials" offline download pre-caches. The in-file comment at
`app.js:2009-2011` explicitly states it is *"kept in step with the service-worker
SHELL so the 'Essentials' download really is the whole app."* It is **not** in
step: 22 JS modules that `sw.js` SHELL caches are absent from `essentials`. All
22 are **statically imported** by modules that *are* in essentials, so an
Essentials-only offline user will hit network/cache-miss failures for the
Asteroids game, video sidecar parsing, and several NLE-project viewers.

### list A vs list B — modules in `sw.js` SHELL but NOT in `app.js` TIERS.essentials

```
./assets/js/core/video-sync.js          <- imported by video.js, audio-player.js, sony-rtmd.js
./assets/js/renderers/sony-rtmd.js      <- imported by video.js
./assets/js/renderers/gcsv.js           <- imported by csv.js / video.js
./assets/js/renderers/davinci.js
./assets/js/renderers/premiere.js
./assets/js/renderers/vegas.js
./assets/js/renderers/unity.js
./assets/js/renderers/vssolution.js
./assets/js/games/config.js             <- the 14 below are all imported (directly or
./assets/js/games/style.js                 transitively) by games/asteroids.js, which
./assets/js/games/state.js                 IS in essentials (app.js:1997)
./assets/js/games/geometry.js
./assets/js/games/world.js
./assets/js/games/ufos.js
./assets/js/games/drones.js
./assets/js/games/weapons.js
./assets/js/games/boss.js
./assets/js/games/leaderboard.js
./assets/js/games/menus.js
./assets/js/games/render.js
./assets/js/games/update.js
./assets/js/games/input.js
./assets/js/games/world.js
```

Reverse direction (essentials entries missing from SHELL): **none** — SHELL is a
strict superset.

Evidence of the broken import chains (so these are load-bearing, not dead):
- `assets/js/games/asteroids.js:17-28` imports `style state geometry world drones
  ufos boss menus leaderboard input update render` (config is pulled in
  transitively). asteroids.js is in essentials at `app.js:1997` but none of these
  are.
- `grep "video-sync"` → imported by `renderers/video.js`, `renderers/audio-player.js`,
  `renderers/sony-rtmd.js` (all/most in essentials).
- `grep "sony-rtmd|gcsv"` → imported by `renderers/video.js`, `renderers/csv.js`.

**Impact:** With Essentials cached and the network offline, opening a video with a
Sony RTMD/GoPro sidecar, a DaVinci/Premiere/Vegas/Unity/VS-Solution project, or
launching the Asteroids easter-egg, fails to load its module. The SW
stale-while-revalidate would normally paper over this online, so it only bites
true offline Essentials users — hence Medium, not High.

**Fix (not applied):** add the 22 paths above to `TIERS.essentials` in
`app.js`, mirroring SHELL. (The two lists are hand-maintained in parallel with no
generator, which is exactly how they drifted.)

---

## FINDING 2 — manifest.json theme_color vs page theme-color metas (minor)

- `manifest.json:7-8`: `"background_color": "#ffffff"`, `"theme_color": "#ffffff"`
  (single, light value only).
- Every page (`index/about/patch/stats/privacy/formats .html:9-10`) declares a
  media-aware pair:
  `theme-color #ffffff (light)` / `theme-color #0a0a0a (dark)`.

The manifest cannot express a dark variant, so PWA chrome (task switcher / splash)
stays white even in dark mode while the in-page address bar follows the system.
Cosmetic; common PWA limitation. Confidence High, Risk Low.

---

## Items verified IN SYNC (evidence)

- **SHELL paths exist (3):** scripted existence check over all `'./...'` SHELL
  entries → zero missing (`sw.js:13-147`).
- **SHELL vs files/imports (4):** `comm` of SHELL basenames vs `ls assets/js/{core,
  renderers,lib,parsers,games}` and vs all `from '...'` import targets → both
  diffs empty. Every shipped module is cached; every cached module exists.
- **occt version (5):** `occt-loader.js:9` `OCCT_VERSION='0.0.23'`;
  `app.js:2091-2092` `occt-import-js@0.0.23`. Match. (Doc note at `app.js:2090`
  says "keep in sync" — it is.)
- **ffmpeg/tesseract (6):** ffmpeg-core pinned once at `app.js:2046-2047`
  (`@0.12.6`); tesseract URLs all derive from `TESS_DATA`/`TESS_WORKER`
  (`app.js:1973-1974`) and CDN langpath `4.0.0` matches `photo.js:96`. No
  conflicting pins.
- **format count (7):** `1061` in `manifest.json:4`, `index.html` meta+JSON-LD+
  overlay, `patch.html:1366`, `formats.html` `<!--FMTCOUNT-->1061`, ItemList
  numberOfItems sums. All equal. (`stamp-counts.mjs` bakes this on commit.)
- **footers (8):** `tools/partials/footer-shared.html` == stamped block in
  `index.html` between `FOOTER:START/END` char-for-char after CRLF normalise;
  all 6 stamped footers share md5 `57650656e0c6a5614054e9fd8991db05`.
- **theme script (9):** all 6 pages' inline `<script>` share md5
  `09fd97...`, and it is byte-identical to the copy baked at
  `tools/prerender-format-pages.mjs:373`.
- **sitemap routes (10):** `sitemap.xml` lists `/ about formats patch stats
  privacy llms.txt`; all six `.html` + `llms.txt` exist on disk; `robots.txt:8-9`
  references both sitemaps which both exist.
- **sitemap-formats (11):** 1062 `<loc>` = `/formats` hub + 1061 per-ext pages,
  and `ls formats/*.html formats/id/*.html` = 1061. No stale/orphan URLs.
- **release lists (12):** `app.js:15` `RELEASE_COMMITS=[29,60,100]` ==
  `save.bat:53` `RELEASES=29,60,100`.
- **version epoch (13):** `app.js:7` `COMMIT_COUNT=135` and `sw.js:4`
  `analyser-v135` agree (both stamped by `save.bat`).

---

## Note on a session race

When first read, `sw.js:4` was `analyser-v134` and `sitemap.xml` lastmods were
`2026-06-17`; a `save.bat` ran mid-audit, bumping them to `v135` / `2026-06-18`.
This did not change the SHELL array, so Finding 1 stands. No drift implied — just
flagging that the snapshot moved.
