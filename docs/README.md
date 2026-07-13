# Analyser documentation

Analyser is a zero-backend, browser-only forensic file workbench: drop a
file and it's classified, parsed and visualised entirely on-device (File
API + lazy-loaded WebAssembly), with nothing ever uploaded. This directory
documents the site from two angles - a usage-oriented feature reference
(what every control does and how to reach it) and an architecture reference
(how the codebase is put together) - built by reading the source in
`web/`, `tools/`, and `worker/`, and verified against it rather than
written from assumption.

## Start here

- **New to the codebase?** Read `architecture.md`, then `pipeline.md`,
  then `renderers.md` in that order - each builds on the last.
- **Using the site, or writing user-facing help content?** Start at
  `user-guide.md`, then the `features/` doc for whatever you're covering.
  `faq.md` has quick answers to the questions people ask most.
- **Adding a feature to a specific renderer?** Find its domain in
  `features/` first to see the existing usage pattern, then its module in
  `renderers.md`. `FEATURE-INVENTORY.md` is the working checklist the
  `features/` docs were built against, useful if a control seems
  undocumented.

## Doc map

| Doc | Audience | Covers |
|---|---|---|
| `architecture.md` | Engineers | Zero-backend model, page shell, classification pipeline overview, lazy-loading, PWA/service worker, SPA navigation, Cloudflare deploy |
| `pipeline.md` | Engineers | The exact drop-to-render resolution order: `classifyFile()`, content sniffing, `EXT_VARIANTS`, proprietary-format dispatch, the `unknown.js` fallback |
| `renderers.md` | Engineers | Catalog of all 79 renderer modules grouped by domain - what each handles and its key dependencies |
| `parsers-and-libs.md` | Engineers | The 16 lazy `parsers-<domain>.js` chunks behind `proprietary.js`, and the 17 shared binary/WASM loader helpers in `lib/` |
| `pages.md` | Engineers | Every top-level page (`/`, `/about`, `/compare`, `/stats`, `/patch`, `/privacy`, `/atari`, `/test`) and its special wiring |
| `pwa-offline.md` | Engineers | Service-worker precache, the `VERSION` cache epoch, the three offline download tiers, the PWA manifest/install flow |
| `tooling.md` | Engineers | The dev loop (`server.bat`/`serve.py`), the `save.bat` commit/version-bump/deploy flow, the `tools/*.mjs` generator scripts, version numbering |
| `worker.md` | Engineers | The Cloudflare Worker stats API - the only server-side code - and how privacy is preserved in it |
| `design-system.md` | Engineers, designers | Theme tokens, the sharp-corners rule, shared component idioms, the `/test` style-guide page |
| `FEATURE-INVENTORY.md` | Engineers | Working checklist of every user-triggerable control on the site, grouped by which `features/*.md` doc owns it |
| `features/images.md` | Everyone | Photo metadata, histogram, GPS, OCR, HEIC/RAW conversion, broken-image recovery, ICO/MPO/TIFF extraction, sonify |
| `features/audio.md` | Everyone | Playback, spectrogram, codec/loudness/pitch analysis, frequency isolation, AI vocal separation, reverse, recording |
| `features/video.md` | Everyone | Playback, frame tools, scene detection, reverse, truncated-recording salvage, AVI, multi-player sync |
| `features/animation-frames.md` | Everyone | GIF/WebP frame stepping, Lottie/dotLottie/Telegram sticker playback |
| `features/documents.md` | Everyone | PDF, Office (modern + legacy), OpenDocument, iWork, e-books, notebooks, Markdown |
| `features/design-cad-3d.md` | Everyone | SVG, Illustrator, Photoshop, paint apps, diagrams, LUTs, fonts, STL/3MF/STEP viewers, G-code, Unity, DWG, SolidWorks, Fusion 360 |
| `features/eda-nle.md` | Everyone | Altium/KiCad PCB design, SPICE waveforms, IPC netlists, After Effects/Premiere/Resolve/VEGAS, editing timelines, Sony gyro/IMU |
| `features/data-archive.md` | Everyone | CSV table workbench, IMU logs, structured-data viewers, git objects, email, archives, folders, treemap, comics, MIDI, subtitles, lyrics |
| `features/cross-cutting.md` | Everyone | Hashing, OSINT extraction, exporting the analysis, in-page search, forensic integrity checks, `/compare` |
| `user-guide.md` | End users | Dropping files, reading the readout, the privacy promise, offline install, a map into `features/` |
| `faq.md` | End users | Quick answers: uploads, formats, offline, WASM downloads, recovery, safety, browser support |

## Ground rules this doc set follows

Carried over from `research/DOCS_PLAN.md`, the work order this set was
built from:

- Every capability claim is verified against source actually read, not
  assumed; unconfirmable claims are marked as such rather than invented.
- Internal `.md` docs are exempt from the site's em-dash-free/British-
  spelling content convention, but this set follows it anyway for
  consistency and in case any content is later reused on a page.
- Nothing here documents the generated directories (`web/formats/`,
  `web/samples.html`, `web/formats.html`, `web/sitemap*.xml`) - those are
  rebuilt by `tools/*.mjs` on every commit; see `tooling.md` instead.
