# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Analyser — project guide

Analyser is a **zero-backend, browser-only forensic workbench**: drop a file and
it classifies and analyses it entirely on-device (File API + lazy-loaded WASM),
uploading nothing. It's vanilla HTML/CSS/ES-module JS — **no framework, no build
step, no `node_modules`, no tests**. Deployed as static assets to Cloudflare
(`analyser.valjdakosta.com`) and installable as an offline PWA. The older
`lab.valjdakosta.com` is attached to the same Worker but 307-redirects every
non-`/api/*` request to the canonical host (see `worker/index.js`);
**`analyser.valjdakosta.com` is the canonical host** - every absolute URL in the
repo (canonical tags, og/twitter images, JSON-LD, sitemaps, `robots.txt`,
`llms.txt`, share/export links, the generators' `SITE` constants) must use it.

## Hard rule: never write patch notes, commit, or push unprompted

**Never, ever** write or edit patch notes (`patch.html` entries, `PATCH_DIGEST`),
commit, run `save.bat`, or `git push` unless the user has **explicitly asked you
to in that message**. Do not even *propose* or *offer* to do any of these - no
"want me to commit this?", no "should I add a patch note?", no staging it up "so
it's ready". Make the code change the user asked for and stop. The user runs
`save.bat` themselves; patch notes are written only on direct request. This
overrides any default tendency to wrap up a task by committing or changelogging.

## Commands

> **The app JS is TypeScript now. Edit `src/`, never `web/assets/js/`.**
> `web/assets/js/**/*.js` is **generated build output** - `tsc` overwrites it on
> every build, so an edit there is silently lost on the next compile. The 176
> sources live in `src/` (same tree shape: `core/`, `renderers/`, `parsers/`,
> `lib/`, `games/`), and the module inventory moved to `src/CLAUDE.md`.

There is still no lint or test pipeline, and there is nothing to run to verify a
change except loading it in the browser - and **the user does that themselves**.
Don't spin up dev servers, headless browsers, or automated checks to "confirm it
works". Make the change and hand it back.

The one thing that *is* required now: **`src/` edits do nothing until `tsc`
recompiles.** `server.bat` starts two watcher windows for this. To build once by
hand: `npx tsc -p tsconfig.json && npx tsc -p tsconfig.worker.json`.
(Two configs because `lib.dom` and `lib.webworker` can't share one program - the
three module workers compile under `tsconfig.worker.json`.)

The migration is mid-flight: `strict` is off and there are outstanding type
errors by design. They do **not** block the build - `tsc` still emits correct JS
- so don't treat a red `tsc` as a broken build, and `save.bat` prints only a
count rather than the whole dump (full log path is printed with the count).

Two things *are* fatal at commit time. **Syntax errors (TS1xxx)** mean the parse
failed, so the emitted JS may be wrong or truncated - `save.bat` prints those
lines and aborts. And `tools/check-build.mjs` fails when output is missing or
stale relative to `src/`. Everything else is advisory.

- **Run locally**: `server.bat` launches
  `serve.py` on port **3000** and opens a browser. Use this, not
  `python -m http.server`: `serve.py` mirrors production Cloudflare routing
  (clean URLs — `/about` serves `about.html`, `/about.html` 308-redirects to
  `/about` — plus the SPA fallback). A plain static server 404s `/about` and
  `/patch`, which is the usual "the about page is broken locally" cause.
  Binds `0.0.0.0`, so the printed Network URL works for phone testing on the
  same Wi-Fi.
- **Commit + version bump + push**: `save.bat` (menu) or `save.bat save`. This
  is the **only** correct way to commit — it bumps `COMMIT_COUNT` in `app.js`
  and the `VERSION` cache epoch in `sw.js`, computes the version label, then
  `git add . && git commit && git push origin main`. `save.bat commit` commits
  without pushing; `save.bat --force` force-pushes. Don't hand-edit
  `COMMIT_COUNT` or commit around this script.
  It also runs every generator first, in this order: `prerender-samples`,
  `prerender-formats`, `prerender-format-pages`, `stamp-counts`, `stamp-footer`,
  `stamp-head`, `prerender-testpage`, `build-docs-html`. Anything those scripts
  emit is **regenerated on every commit** — edit their inputs, never their
  output. You can run any of them standalone (`node tools/<name>.mjs`) to
  preview locally. `check-shell` runs last and is the odd one out: a check, not
  a generator — it writes nothing and just reports offline-manifest gaps
  (a module missing from `sw.js` `SHELL`, or a precached module importing one
  that isn't). Non-fatal, but a report there means something is broken offline.
- **Deploy**: pushing to `main` ships via Cloudflare (config in
  `wrangler.jsonc`). No manual deploy step.

## The analysis pipeline

`handleFile()` in `assets/js/core/app.js` is the spine, and nearly every task
touches some part of this path:

1. **`classifyFile()`** (`core/classify.js`) maps name / extension / MIME to a
   *kind*. It does **no byte sniffing** — a `.pdf` with no extension is
   `unknown` here.
2. **`resolveKind()`** (app.js) then applies the byte-level reroutes: the SPICE
   `.raw` disambiguation, `VARIANT_REROUTE` for extensions that name two
   unrelated formats (`.ts`, `.nc`, `.md`, `.obj`, … — resolved by
   `detectVariant()` in `formats.js`), and `resolveByContent()`
   (`core/file-sniff.js`) for `unknown`/`extensionless`, which is what turns an
   extension-less PDF/ZIP/image into its real kind. **Anything that routes
   without `resolveKind()` falls to the hex-dump renderer** — that's the bug to
   look for when a file analyses as "unknown" somewhere but not on the main page.
3. The kind indexes **`ROUTES`** in app.js. Every entry is
   `lazy('../renderers/x.js', 'renderX')`, so renderers are dynamic imports and
   stay out of the initial module graph; photo/audio/video are lazy in `boot()`
   too, since they pull the heaviest dependency chains. The row shape and the
   renderer contract are defined at the `ROUTES` table itself (`core/app.js`,
   ~line 218): a row is `{ render }`, and only photo/audio/video need the full
   `{ render, results, nav, analysed }` (they target their own page sections and
   light their own nav links) — everything else defaults into `#unknownResults`.
   The renderer's own export is `renderX(file, resultsEl)`, async, drawing into
   the element it is handed.
4. **`renderFileExtras()`** wraps the shared cards *around* whatever the renderer
   builds: the dotenv secrets warning, the signature-vs-extension and
   trailing-data forensic cards (`core/forensics.js`), and the browse-as-archive
   tree for files that are physically a zip/rar/7z (APK, JAR, DOCX, …). `/compare`
   calls the same function so it renders to the same depth as a single-file
   analysis.

Module-by-module detail lives in `web/assets/js/CLAUDE.md`, which loads
automatically when you work in that tree.

## Invariants

- **`core/sanitize.js` is the only XSS defence.** The site ships no CSP, so any
  renderer that inlines markup from an untrusted file (`email.js`, `textdoc.js`'s
  MHTML, `epub.js` chapters, `svg.js`) **must** go through it. Never hand-roll a
  second copy: there used to be four, they drifted, and three carried a
  `javascript:`-scheme bypass.
- **`core/limits.js` is the single source of truth for every size/memory cap** —
  device tiering, "too large" walls, mobile OOM guards, decompression-bomb
  ceilings, first-N-byte read budgets. Don't hardcode a new threshold in a
  renderer; add it there.
- **Every new module under `src/` must be added to `SHELL` in `web/sw.js`.**
  That list enumerates the precached shell by path — a module missing from it
  silently breaks offline use, and `check-shell` only reports the gap at commit
  time (non-fatally). List it by its **emitted** path (`assets/js/<...>.js`), not
  its `.ts` source path: `sw.js`, `offline-tiers.js` and `check-shell.mjs` all
  operate on the compiled output. Add it to the inventory in `src/CLAUDE.md` in
  the same pass — that file is the map the next session reads first, and it
  drifts silently otherwise.
- **The missing CSP in `web/_headers` is a decision, not an oversight.** The app
  lazy-loads WASM, spawns blob/module workers and uses `data:` URIs, so a
  wrong policy silently breaks individual viewers with no build-time signal.
  Don't add one as a drive-by hardening fix; it needs per-renderer testing first.
  (`sanitize.js` is what stands in for it — see above.)
- **`app.js` and `analyser.css` must never get immutable HTTP caching.** Their
  filenames are unversioned and busting relies entirely on the service-worker
  cache epoch (`VERSION` in `sw.js`). Only `/assets/fonts/*` — content-stable —
  carries `max-age=31536000, immutable` in `_headers`. Widening that glob makes
  deploys serve stale code with no local symptom.

## Site-content writing convention

All **user-facing text** (HTML pages, patch notes, format `desc` strings) is
intentionally **em-dash-free** and uses British spelling (colour, analyse,
visualise). Use a spaced hyphen " - " as the separator, never `—`. (This doc and
other internal `.md`/code comments aren't bound by it.)

## Site aesthetics - high priority

Visual polish is a **high priority**: treat every new UI element as a design
task, not an afterthought. Before styling anything new, find the closest
existing component in `analyser.css` and match its visual language. Concretely:

- **No rounded corners, ever.** The site is deliberately sharp-cornered
  (`.anr-btn` sets `border-radius: 0`). No pills, no rounded chips, no
  `border-radius` on new elements.
- Reuse existing idioms instead of inventing: `.anr-btn` for buttons,
  `var(--bd-hairline)` for borders, theme variables (`var(--bg)`, `var(--fg)`,
  `var(--muted)`, `var(--font-mono)`, `var(--t-small)`) over hardcoded values
  wherever the element sits on a themed surface. (Overlays on media canvases
  are the exception: they use the fixed dark-translucent treatment - see the
  G-code pause tag - so they stay legible on any canvas in either theme.)
- Check the element in **both light and dark themes** and at narrow widths
  before calling it done.
- **The reference sheet is `/test`** (test.html): a deployed-but-unlisted
  (noindex, unlinked) style-guide page showing every token, font, animation,
  button, control, chip, card, message, popup, loader and viewer overlay the
  site uses, with an in-page theme toggle. Its token/animation sections are
  generated from analyser.css by `tools/prerender-testpage.mjs` (run by
  save.bat, markers `TOKENS:START/END` - never hand-edit between them); the
  component demos are hand-authored static markup using the real classes.
  **When you add or change a shared UI element, add/update its demo there.**
  test.html is also in stamp-head's PAGES (theme bootstrap) but deliberately
  NOT in stamp-footer's (it keeps a demo footer of its own).

## Adding a new file type

See the `add-file-format` skill for the full workflow (formats.js catalog,
proprietary.js parsers, EXT_VARIANTS, new renderer categories, optional polish).

## Generated SEO pages (`/formats`, `/formats/<ext>`, `/samples`)

See the `format-seo-pages` skill for how the generated `/formats` hub,
per-extension `/formats/<ext>` pages, and `/samples` gallery work, plus the
upkeep checklist for when you add/change a format.

## The docs site (`/docs`) - source is `docs/*.md`, never the HTML

`web/docs.html` and the whole `web/docs/` directory are **wiped and rebuilt on
every commit** - never hand-edit them; edit the Markdown in `docs/` instead, and
update the relevant `docs/` page in the same pass as any behaviour change.

See the `docs-site` skill for the generator (`tools/build-docs-html.mjs`), the
`NAV` array, output paths and `sitemap-docs.xml`.

## Single-sourced footer and head

See the `shared-partials` skill for how the footer's offline-use block and the
`<head>` stylesheet/theme-bootstrap tail are single-sourced across every main page.

## Version numbering

See the `version-numbering` skill for how `COMMIT_COUNT` / `RELEASE_COMMITS` /
`analyserVersion()` compute the version shown in the UI.

## SPA navigation

Pages use `assets/js/core/navigate.js` for View Transitions API-based SPA navigation. When the page swaps:
- `boot()` in `app.js` re-runs (triggered by `anr:navigate` event).
- One-time setup (window listeners, letter hover effect) is guarded by `boot._once`.
- Per-navigation setup (scroll-spy, anchors, dark mode, search) runs every time.

If you add new window-level event listeners, put them inside the `if (!boot._once)` guard to prevent duplicates.

## The /compare page

See the `compare-page` skill for how `compare.html` and `renderers/compare.js`
stage two files through the real renderers and merge them into `Field | A | B`
tables. It is a full main page: `sw.js` `SHELL`, `sitemap.xml`, and both
stamp-head and stamp-footer `PAGES`.

## File structure

```
REPO ROOT           — deploy config, dev/app scripts, and the folders below.
                      The website itself lives entirely in web/.
save.bat            — commit + version bump + push (the only way to commit; bumps
                      COMMIT_COUNT in src/core/app.ts and the cache epoch in
                      web/sw.js, then runs the tsc build before every generator)
server.bat          — launch serve.py on :3000 + two tsc --watch windows
serve.py            — local dev server mirroring Cloudflare clean-URL routing
                      (its document root is web/)
src/                — THE APP SOURCE (TypeScript). Mirrors the old
                      web/assets/js/ tree exactly: core/ renderers/ parsers/
                      lib/ games/. tsc compiles it 1:1 into web/assets/js/.
                      Module inventory: src/CLAUDE.md (loads automatically).
types/              — ambient .d.ts (window._anr* channel + UMD vendor globals)
tsconfig.json       — main compile (DOM lib) -> web/assets/js/
tsconfig.worker.json— the 3 module workers (WebWorker lib; can't share a program
                      with DOM). Both must run to produce a complete build.
package.json        — dev-only; ONE devDependency (typescript). MUST keep
                      "type": "module" - without it Node treats the emitted
                      browser ESM as CommonJS and every generator that imports
                      core/formats.js dies with a syntax error.
node_modules/       — gitignored; exists only so tsc can run
wrangler.jsonc      — Cloudflare static-asset deploy config (assets.directory = "web")
README.md           — public GitHub readme (visitor-facing overview; this
                      file is the real working guidance)
AGENTS.md           — condensed agent guidance for other tools. Overlaps this
                      file; keep the two consistent when changing conventions.
FEATURES.md         — plain-language inventory of everything the app does
                      (visitor-readable; not generated, not served)
FEATURE-IDEAS.md    — backlog checklist of unbuilt ideas with effort estimates
docs/               — project reference docs (Markdown). SOURCE for the public
                      /docs site - see "The docs site" above. Never edit the
                      generated web/docs*.html; edit these.
research/           — gitignored. Working notes, plans and reverse-engineering
                      scratch go HERE, not in a temp dir - they're worth keeping
                      across sessions but are not part of the shipped site.
.claude/            — Claude Code skills (add-file-format, format-seo-pages,
                      shared-partials, version-numbering, docs-site,
                      compare-page) - these ARE checked in, deliberately.
                      .gitignore lists `.claude/` but that line is inert here:
                      the files were tracked before it was added, so git keeps
                      tracking them. settings.local.json is machine-specific and
                      is now untracked; don't re-add it.
.github/            — issue/PR templates, CONTRIBUTING, SECURITY, code of conduct
tools/              — Node generator scripts (dev-only, never served). They read
                      website files via a WEB = join(ROOT, 'web') constant, while
                      tools/ + worker/ + stats-backup/ paths stay under the root.
                      Eight are the save.bat chain (see Commands); the rest are
                      inputs or standalone: prerender-common.mjs (shared esc/
                      THEME_SCRIPT/badge helpers), format-page-content.mjs +
                      dyk-extra.json + sample-content.mjs (hand-curated per-
                      extension copy the prerenderers pull in - a full-analysis
                      ext missing from format-page-content.mjs gets a thin generic
                      page and is warned about at generation time),
                      backup-stats.mjs (read-only D1 stats snapshot to
                      stats-backup/*.csv - gitignored and absent until you run it,
                      so a missing stats-backup/ is normal; run from the save.bat
                      menu, not the commit path) and disperse-unsupported.mjs
                      (re-checks the stats "unsupported" dogpile against the live
                      catalog). Two subfolders: partials/ (footer-shared.html, the
                      single-sourced footer block - see the shared-partials skill)
                      and readme-assets/ (screenshots/GIFs for README.md only,
                      never served).
worker/             — Cloudflare Worker: anonymous analysed-count stats API
                      (index.js + schema.sql + disperse-unsupported.sql). The only
                      server-side code; the analyser itself stays browser-only.

web/                — THE WEBSITE, served at "/" by Cloudflare (assets.directory).
                      Everything from here down lives inside web/:
  index.html          — main page (the drop/analyse app)
  about.html          — about/info page (format tables, #ext-/#fmt- anchors)
  patch.html          — public changelog (one .patch-entry per commit)
  patch_old.html      — archived older patch entries, served at /patch_old
                        (patch-tldr.js special-cases it: no #when marker, keeps
                        its own PATCH_DIGEST)
  privacy.html        — privacy page (single-sourced footer)
  stats.html          — public analytics page (reads the Worker's stats API)
  samples.html        — generated /samples gallery (driven by samples/ dir)
  compare.html        — /compare page: two dropzones, side-by-side analysis of two
                        files (see "The /compare page")
  atari.html          — Asteroids easter-egg game page (loads assets/js/games/)
  404.html            — not-found page (in stamp-head's PAGES, not stamp-footer's)
  test.html           — /test style-guide reference sheet (see Site aesthetics)
  formats.html        — generated /formats hub (see Generated SEO pages)
  formats/            — generated /formats/<ext> pages (wiped + rebuilt per commit)
  docs.html           — generated /docs hub, from docs/README.md (wiped + rebuilt)
  docs/               — generated /docs/<slug> pages, from docs/*.md (wiped + rebuilt)
  samples/            — example files that drive the /samples gallery
  sw.js               — service worker (precache SHELL + cache epoch VERSION)
  manifest.json       — PWA manifest (format count stamped by stamp-counts.mjs)
  robots.txt          — points crawlers at sitemap.xml + sitemap-formats.xml + sitemap-docs.xml
  sitemap.xml         — main sitemap (lastmod refreshed by stamp-counts.mjs)
  sitemap-formats.xml — per-format-page sitemap (written by prerender-format-pages.mjs)
  sitemap-docs.xml    — docs sub-page sitemap (written by build-docs-html.mjs)
  llms.txt            — machine-readable site summary for LLM crawlers
  _headers            — Cloudflare Workers static-asset response headers (security
                        headers site-wide + immutable caching for /assets/fonts;
                        consumed by the deploy, never served, not applied by serve.py)
  assets/             — css / fonts / img / vendor + all the app JS.
                        NB: assets/js/ is GENERATED from src/ by tsc - never
                        edit or add a module there; edit src/ instead.
                        analyser.css is the central stylesheet (docs.css layers
                        on it for /docs only); vendor/ is third-party code
                        (exifr, ffmpeg, imagemagick, ...). Module-by-module JS
                        inventory: web/assets/js/CLAUDE.md, which loads
                        automatically when you work in that tree.
```
