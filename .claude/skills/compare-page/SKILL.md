---
name: compare-page
description: How Analyser's /compare page works - the A/B dropzones wired in boot(), and how renderers/compare.js moves real renderer output into merged Field|A|B tables. Use when editing compare.html, renderers/compare.js, or the compare wiring in app.js.
---

`compare.html` (served at `/compare`) analyses two files side by side.

Its two dropzones (A/B) are wired in `boot()` in `app.js` - the wiring guards on
`#cmpDropA`, so it stays inert on every other page, and the *global* page-wide
drop handler skips the compare page so only the A/B zones accept files there.

`renderers/compare.js` runs each file through the real
`classifyFile()`/`resolveKind()`/`ROUTES` renderer into an off-screen staging
container, then **moves** (not clones) the readout cells into merged
`Field | A | B` tables - so tooltips and deferred async fills (e.g. the SHA-256
cell) keep working. Rows whose values differ are tagged `.is-diff`, which powers
the "Show differences" toggle; non-readout card content (previews, players, hex
dumps) falls back to a side-by-side A | B split.

Media renderers are invoked with `{ inline: true }` so they don't target the
main page's fixed sections (`#photoPreview`, `#videoPreview`, ...).

It calls `renderFileExtras()` like the main pipeline does, so a compared file
gets the same forensic cards (signature check, trailing data, integrity) as a
single-file analysis - see the analysis-pipeline section in the root `CLAUDE.md`.

It is a full main page: listed in `sw.js` `SHELL`, `sitemap.xml`, and both
stamp-head and stamp-footer `PAGES`.
