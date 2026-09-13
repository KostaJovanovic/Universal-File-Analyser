# Analyser documentation

Analyser is a zero-backend, browser-only forensic file workbench: drop a
file and it classifies, parses and visualises it entirely on-device (File
API + lazy-loaded WebAssembly), and uploads nothing. It is vanilla
HTML/CSS/ES-module JavaScript - no framework, no build step, no tests -
deployed as static assets to Cloudflare and installable as an offline PWA.

This directory documents the site from two angles - a usage-oriented
feature reference (what every control does and how to reach it) and an
architecture reference (how the codebase fits together). Every page comes
from reading the source in `web/`, `tools/` and `worker/`, not from
assumption.

## Start here

- **New to the codebase?** Read [`architecture.md`](architecture.md), then
  [`pipeline.md`](pipeline.md), then [`renderers.md`](renderers.md) in that
  order - each builds on the last.
- **Using the site, or writing user-facing help content?** Start at
  [`user-guide.md`](user-guide.md), then the [`features/`](features/) doc
  for whatever you cover. [`faq.md`](faq.md) has quick answers to the
  questions people ask most.
- **Adding a feature to a specific renderer?** Find its domain in
  [`features/`](features/) first to see the existing usage pattern, then its
  module in [`renderers.md`](renderers.md) and the chunk/loader map in
  [`parsers-and-libs.md`](parsers-and-libs.md) (and the repo's
  `add-file-format` skill). [`FEATURE-INVENTORY.md`](FEATURE-INVENTORY.md)
  is the working checklist behind the `features/` docs, useful if a control
  seems undocumented.
- **Want the app on your computer or phone?** See
  [`download.md`](download.md).

## Doc map

| Doc | Audience | Covers |
|---|---|---|
| [`architecture.md`](architecture.md) | Engineers | Zero-backend model, page shell, classification pipeline overview, lazy-loading, PWA/service worker, SPA navigation, Cloudflare deploy |
| [`pipeline.md`](pipeline.md) | Engineers | The exact drop-to-render resolution order: `handleFile`, `classifyFile()`, content sniffing, `EXT_VARIANTS`, proprietary-format dispatch, the `unknown.js` fallback |
| [`renderers.md`](renderers.md) | Engineers | Catalog of the ~86 modules in `renderers/` grouped by domain - what each handles and its key dependencies |
| [`parsers-and-libs.md`](parsers-and-libs.md) | Engineers | The 15 lazy `parsers-<domain>.js` chunks (plus `parser-util.js`) behind `proprietary.js`, and the 17 shared binary/WASM loader helpers in `lib/` |
| [`pages.md`](pages.md) | Engineers | Every top-level page (`/`, `/about`, `/compare`, `/stats`, `/patch`, `/privacy`, `/atari`, `/test`) and its special wiring |
| [`pwa-offline.md`](pwa-offline.md) | Engineers | Service-worker precache, the `VERSION` cache epoch, the three offline download tiers, the PWA manifest/install flow |
| [`tooling.md`](tooling.md) | Engineers | The dev loop (`server.bat`/`serve.py`), the `save.bat` commit/version-bump/deploy flow, the `tools/*.mjs` generator scripts, version numbering |
| [`worker.md`](worker.md) | Engineers | The Cloudflare Worker stats API - the only server-side code - and how it keeps the counts private |
| [`desktop.md`](desktop.md) | Engineers, end users | The Electron desktop build for Windows, macOS and Linux: the `analyser://` scheme, routing, the `/api/*` proxy, security, opening files by path, updates |
| [`mobile.md`](mobile.md) | Engineers, end users | The Android build (Capacitor): routing, the byte channel, native FFmpeg, security, updates |
| [`download.md`](download.md) | End users | Where to get every app, which file to pick, and how each one updates |
| [`design-system.md`](design-system.md) | Engineers, designers | Theme tokens, the sharp-corners rule, shared component idioms, the `/test` style-guide page |
| [`FEATURE-INVENTORY.md`](FEATURE-INVENTORY.md) | Maintainers | Working checklist of every user-triggerable control on the site, grouped by which `features/*.md` doc owns it |
| [`features/images.md`](features/images.md) | Everyone | Photo metadata, histogram, GPS, OCR, QR, HEIC/RAW conversion, broken-image recovery, ICO/MPO/TIFF extraction, sonify |
| [`features/audio.md`](features/audio.md) | Everyone | Playback, spectrogram, codec/loudness/pitch analysis, frequency isolation, AI vocal separation, reverse, recording |
| [`features/video.md`](features/video.md) | Everyone | Playback, frame tools, scene detection, reverse, truncated-recording salvage, AVI, multi-player sync |
| [`features/animation-frames.md`](features/animation-frames.md) | Everyone | GIF/WebP frame stepping, Lottie/dotLottie/Telegram sticker playback |
| [`features/documents.md`](features/documents.md) | Everyone | PDF, Office (modern + legacy), OpenDocument, iWork, e-books, DjVu, notebooks, Access, Markdown |
| [`features/design-cad-3d.md`](features/design-cad-3d.md) | Everyone | SVG, Illustrator, Photoshop, paint apps, diagrams, LUTs, fonts, STL/3MF/STEP viewers, G-code, Unity, DWG, SolidWorks, Fusion 360 |
| [`features/eda-nle.md`](features/eda-nle.md) | Everyone | Altium/KiCad PCB design, SPICE waveforms, IPC netlists, After Effects/Premiere/Resolve/VEGAS, editing timelines, Sony gyro/IMU |
| [`features/data-archive.md`](features/data-archive.md) | Everyone | CSV table workbench, IMU logs, structured-data viewers, git objects, email, archives, folders, treemap, comics, MIDI, subtitles, lyrics, geodata |
| [`features/cross-cutting.md`](features/cross-cutting.md) | Everyone | Hashing, OSINT extraction, exporting the analysis, in-page search, forensic integrity checks, `/compare` |
| [`user-guide.md`](user-guide.md) | End users | Dropping files, reading the readout, the privacy promise, offline install, a map into `features/` |
| [`faq.md`](faq.md) | End users | Quick answers: uploads, formats, offline, WASM downloads, recovery, safety, browser support |
| [`PROGRESS.md`](PROGRESS.md) | Maintainers | The build ledger behind this doc set |

## Ground rules this doc set follows

- Every capability claim comes from source actually read, not from
  assumption. Where no source confirms a claim, the doc says so rather than
  invent one.
- Paths are relative to the repo root, so source lives at
  `web/assets/js/...`. Code identifiers are in backticks.
- Internal `.md` docs are exempt from the em-dash-free, British-spelling
  convention of the site, but this set follows it anyway for consistency, and
  in case a page reuses any of it later. The authoritative project guide is
  the repo-root `CLAUDE.md`.
- Nothing here documents the generated directories (`web/formats/`,
  `web/samples.html`, `web/formats.html`, `web/sitemap*.xml`).
  `tools/*.mjs` rebuilds those on every commit - see
  [`tooling.md`](tooling.md) instead.
