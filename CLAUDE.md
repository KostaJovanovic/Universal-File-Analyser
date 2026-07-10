# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Analyser — project guide

Analyser is a **zero-backend, browser-only forensic workbench**: drop a file and
it classifies and analyses it entirely on-device (File API + lazy-loaded WASM),
uploading nothing. It's vanilla HTML/CSS/ES-module JS — **no framework, no build
step, no `node_modules`, no tests**. Deployed as static assets to Cloudflare
(`lab.valjdakosta.com`) and installable as an offline PWA.

## Hard rule: never write patch notes, commit, or push unprompted

**Never, ever** write or edit patch notes (`patch.html` entries, `PATCH_DIGEST`),
commit, run `save.bat`, or `git push` unless the user has **explicitly asked you
to in that message**. Do not even *propose* or *offer* to do any of these - no
"want me to commit this?", no "should I add a patch note?", no staging it up "so
it's ready". Make the code change the user asked for and stop. The user runs
`save.bat` themselves; patch notes are written only on direct request. This
overrides any default tendency to wrap up a task by committing or changelogging.

## Commands

There is no build, lint, or test pipeline — editing a file *is* the dev loop.

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
- **Deploy**: pushing to `main` ships via Cloudflare (config in
  `wrangler.jsonc`). No manual deploy step.

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

`compare.html` (served at `/compare`) analyses two files side by side. Its two
dropzones (A/B) are wired in `boot()` in app.js — the wiring guards on
`#cmpDropA`, so it stays inert on every other page, and the *global* page-wide
drop handler skips the compare page so only the A/B zones accept files there.
`renderers/compare.js` runs each file through the real `classifyFile()`/`ROUTES`
renderer into an off-screen staging container, then **moves** (not clones) the
readout cells into merged `Field | A | B` tables — so tooltips and deferred
async fills (e.g. the SHA-256 cell) keep working. Rows whose values differ are
tagged `.is-diff`, which powers the "Show differences" toggle; non-readout card
content (previews, players, hex dumps) falls back to a side-by-side A | B split.
Media renderers are invoked with `{ inline: true }` so they don't target the
main page's fixed sections (`#photoPreview`, `#videoPreview`, ...). It is a full
main page: listed in `sw.js` `SHELL`, `sitemap.xml`, and both stamp-head and
stamp-footer `PAGES`.

## File structure

```
index.html          — main page (the drop/analyse app)
about.html          — about/info page (format tables, #ext-/#fmt- anchors)
patch.html          — public changelog (one .patch-entry per commit)
privacy.html        — privacy page (single-sourced footer)
stats.html          — public analytics page (reads the Worker's stats API)
samples.html        — generated /samples gallery (driven by samples/ dir)
compare.html        — /compare page: two dropzones, side-by-side analysis of two
                      files (see "The /compare page")
atari.html          — Asteroids easter-egg game page (loads assets/js/games/)
formats.html        — generated /formats hub (see Generated SEO pages)
formats/            — generated /formats/<ext> pages (wiped + rebuilt per commit)
samples/            — example files that drive the /samples gallery
tools/              — Node generator scripts (dev-only, in .assetsignore)
worker/             — Cloudflare Worker: anonymous analysed-count stats API
                      (index.js + schema.sql + disperse-unsupported.sql). The only
                      server-side code; the analyser itself stays browser-only.
README.md           — public GitHub readme (visitor-facing overview; this
                      file is the real working guidance)
sw.js               — service worker (precache SHELL + cache epoch VERSION)
manifest.json       — PWA manifest (format count stamped by stamp-counts.mjs)
robots.txt          — points crawlers at sitemap.xml + sitemap-formats.xml
sitemap.xml         — main sitemap (lastmod refreshed by stamp-counts.mjs)
sitemap-formats.xml — per-format-page sitemap (written by prerender-format-pages.mjs)
llms.txt            — machine-readable site summary for LLM crawlers
serve.py            — local dev server mirroring Cloudflare clean-URL routing
server.bat          — launch serve.py on :3000 (opens browser)
save.bat            — commit + version bump + push (the only way to commit)
wrangler.jsonc      — Cloudflare static-asset deploy config
assets/
  css/
    analyser.css    — all styles
    fonts.css       — @font-face declarations (url(../fonts/...))
  fonts/            — Geist woff2 files
  img/              — banner, favicons, app icons
  vendor/           — third-party libraries (exifr, ffmpeg, imagemagick, ...)
  js/
    core/
      app.js        — entry point: ROUTES table, resolveKind()/handleFile
                      analysis pipeline, boot(). COMMIT_COUNT lives here.
      classify.js   — classifyFile(file): name/extension/MIME → a ROUTES kind
                      (no byte sniffing). Exposed as window._anrClassify.
      file-sniff.js — content-based sniffing: what a file ACTUALLY is from its
                      leading bytes; drives handleFile reroutes and the folder scan
      forensics.js  — forensic integrity cards (signature mismatch, trailing data)
                      built on the file-sniff.js result
      formats.js    — central format catalog (sets + display tables + catalogGrouped())
      format-overlay.js — renders the catalog into the help overlay / about / hub,
                      stamps [data-fmt-count], wires the format search + deep-links
      search.js     — metadata search
      navigate.js   — SPA router (View Transitions API)
      effects.js    — page atmosphere/glow/transition effects
      overlays.js   — transient chrome shared by the drop pipeline (confirm modal,
                      drop loader bar, type-suggestion nudge, link-leave confirm)
      popups.js     — modal, suggestion + share-nudge popups
      osint.js      — network-indicator (OSINT) extraction: pulls URLs/IPs/domains/
                      emails from a file's text into a card of click-to-open lookup
                      links (nothing sent automatically — the no-upload promise holds)
      history.js    — anonymous analysed-count stats ping (the only network call)
                      + on-device "Recently analysed" localStorage history (metadata only)
      offline-tiers.js — "Download for offline use" footer: cumulative cache tiers,
                      PWA install prompt, clear-storage button
      stats-page.js — the /stats page (totals, per-ext table, leaderboard, trend chart)
      patch-tldr.js — the /patch "tl;dr" release-group digest toggle
      export-data.js — "export analysis data" (JSON/hash) builder
      video-sync.js — shared video↔analysis scrubbing/sync helpers
      util.js       — shared DOM helpers (el, fileExt, …) and formatters
      binutil.js    — shared binary toolkit (cursor reader, decoders, magic)
    renderers/      — one module per top-level type (classifyFile() routes to these
                      via ROUTES in app.js). Inventory by domain:
      photo.js · photo-convert.js · photo-recover.js · sonify.js · tiff.js · mpo.js · ico · embedded-images.js
        — photo analysis (EXIF, histogram, OCR), HEIC/RAW conversion, multi-image;
        photo-recover.js salvages broken/truncated/corrupt stills (repair a cut-off
        JPEG/PNG, rebuild a damaged JPEG header from a reference photo, carve
        embedded images out of a blob) - the stills twin of video-recover.js.
        sonify.js is the inverse of spectrogram.js (image → sound, oscillator-bank
        or Griffin-Lim) - not a top-level type but lazy-imported by photo.js's
        "Sonify" button, so it lives in renderers/ and ships in sw.js SHELL
      audio.js · audio-analysis.js · audio-codec.js · audio-player.js · spectrogram.js
        · media-reverse.js — audio playback, codec/loudness analysis, spectrogram
      video.js · video-avi.js · video-recover.js — video player + per-frame/stream
        analysis; video-recover.js salvages truncated/unfinalised MP4-MOV with no
        moov index (carves H.264/H.265 NALs from the mdat, borrows SPS/PPS in-band
        or from a reference clip, plays via the raw-stream segmented player)
      pdf.js · paged.js · djvu.js — PDF (pdf.js), paginated docs, DjVu scans
      docx.js · xlsx.js · xlsb.js · pptx.js · odf.js · legacy-office.js · textdoc.js
        · iwork.js · epub.js · mobi.js · mdb.js · notebook.js · markdown.js
        — office/document/e-book/notebook viewers
      svg.js · illustrator.js · psd.js · paint.js · diagram.js · lut.js · font.js
        — vector/raster design files, colour LUTs, font specimens
      stl.js · model3d.js · gcode.js · unity.js — 3D viewers + G-code toolpath + Unity assets
      dwg.js · model3d.js · solidworks.js · f3d.js — CAD (DWG 2D drawing; STEP/IGES/BREP
        via OpenCASCADE; SolidWorks .sldprt/.sldasm/.slddrw - OLE2 preview+metadata
        for older files, identify-only for modern encrypted ones; f3d.js reads
        Autodesk Fusion 360 .f3d/.f3z packages - a Zstd ZIP whose BREP geometry is
        proprietary, so it reports the manifest/contents rather than rendering)
      altium.js · kicad.js · spice.js · ipcnet.js — EDA/electronics (PCB projects, SPICE netlists, IPC netlists)
      aftereffects.js · premiere.js · davinci.js · vegas.js · sony-rtmd.js · timeline.js
        — NLE/VFX project files (AE/Premiere/Resolve/VEGAS) + EDL/FCPXML/OTIO timelines
      midi.js · subtitles.js · lrc.js — MIDI score, SRT/VTT/ASS subs, LRC lyrics
      csv.js · gcsv.js · dataview.js · gitobject.js · email.js — tabular/IMU/data/git/email
      gif-encode.js · gif-frames.js · webp-frames.js — animated-image frame tooling
      lottie.js — Lottie/Bodymovin JSON vector animation player (also dotLottie
        .lottie ZIPs and Telegram .tgs gzip stickers), via the vendored lottie-web
      archive.js · zip.js · folder.js · treemap.js · folder-archive-shared.js · comic.js
        — archive/folder browsing + treemap breakdown + comic (CBZ/CBR) reader
      vssolution.js · geo.js — VS solution manifests, GPX/KML/GeoJSON maps
      compare.js    — the /compare side-by-side view (see "The /compare page")
      unknown.js    — hex dump and basic identification (the 'unknown' fallback)
      proprietary.js — 200+ format identification by magic bytes (lazy chunk dispatch);
                      proprietary-formats.js holds the large FORMATS reference table
    parsers/        — parsers-<domain>.js, lazy metadata parser chunks dispatched
                      by proprietary.js (audio, video, image, raw, docs, dev,
                      archive, gaming, threed, geodata, sci, security, email,
                      disk, osmisc) + parser-util.js shared helpers
    lib/            — shared binary + WASM loader helpers: plist · cfbf · nrbf ·
                      sqlite · sevenzip · legacy-decompress · *-loader (libarchive,
                      xz, lzma, occt, ghostscript, openjpeg). Also the MDX-Net
                      on-device vocal-separation subsystem (mdx-client/-model/
                      -separate/-stft/-worker.js) that powers audio.js's isolate
                      panel and the spectrogram vocal/instrumental blend slider.
    games/          — Asteroids easter-egg game (loaded by atari.html only)
```
