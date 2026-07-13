# Analyser documentation

Analyser is a zero-backend, browser-only forensic file workbench: drop a file and it
is classified and analysed entirely on your device (File API + lazy-loaded WASM),
uploading nothing. It is vanilla HTML/CSS/ES-module JavaScript - no framework, no
build step, no tests - deployed as static assets to Cloudflare and installable as an
offline PWA. This is the index to its documentation set.

The main deliverable is the **feature reference** (`features/`): a complete,
usage-oriented catalogue of every user-facing capability and how to trigger it. The
architecture docs support it.

## Where to start

- **Just using the site?** Start with [`user-guide.md`](user-guide.md), then dip into
  the relevant [`features/`](features/) doc. Quick questions: [`faq.md`](faq.md).
- **Understanding the code?** Read [`architecture.md`](architecture.md), then
  [`pipeline.md`](pipeline.md).
- **Adding a format or renderer?** [`pipeline.md`](pipeline.md) +
  [`renderers.md`](renderers.md) + [`parsers-and-libs.md`](parsers-and-libs.md) (and
  the repo's `add-file-format` skill).

## Doc map

| Doc | Audience | Purpose |
|---|---|---|
| [`user-guide.md`](user-guide.md) | Users | Front door: opening files, reading the readout, privacy, offline install, a map into the feature docs. |
| [`faq.md`](faq.md) | Users | Short answers: uploads (none), supported formats, recovery, WASM downloads, offline, browsers. |
| [`architecture.md`](architecture.md) | Developers | Big picture: zero-backend model, page shell, pipeline overview, lazy loading, PWA, SPA nav, Cloudflare deploy. |
| [`pipeline.md`](pipeline.md) | Developers | Drop -> `handleFile` -> classify -> byte-sniff reroutes -> `ROUTES` -> renderer; proprietary chunk dispatch; the unknown fallback. |
| [`renderers.md`](renderers.md) | Developers | Catalogue of all ~82 renderer modules grouped by domain. |
| [`parsers-and-libs.md`](parsers-and-libs.md) | Developers | The 16 lazy parser chunks, 17 lib/loader helpers, and vendored libraries. |
| [`pages.md`](pages.md) | Developers | Every top-level page and its wiring (compare, samples, atari, test, SPA restore). |
| [`pwa-offline.md`](pwa-offline.md) | Developers | Service-worker SHELL, version epoch, the three offline tiers, manifest, install flow. |
| [`tooling.md`](tooling.md) | Developers | Dev loop, clean-URL routing, `save.bat` commit/version bump, the generator scripts, version numbering. |
| [`worker.md`](worker.md) | Developers | The Cloudflare Worker stats API: endpoints, schema, and how privacy is preserved. |
| [`design-system.md`](design-system.md) | Developers/designers | Visual language: sharp corners, tokens, `.anr-btn`, theming, the `/test` sheet. |
| [`FEATURE-INVENTORY.md`](FEATURE-INVENTORY.md) | Maintainers | The coverage checklist every feature doc satisfies (every control accounted for). |
| [`features/images.md`](features/images.md) | All | Photos, RAW, multi-image, OCR, QR, sonify, HEIC/RAW conversion, still recovery. |
| [`features/audio.md`](features/audio.md) | All | Playback, spectrogram, isolation, codec/loudness, reverse, AI vocal separation. |
| [`features/video.md`](features/video.md) | All | Player, frames, audio extract, scene detection, gyro, AVI, raw streams, recovery. |
| [`features/animation-frames.md`](features/animation-frames.md) | All | Animated GIF/WebP frame tooling, reverse, Lottie/dotLottie/TGS. |
| [`features/documents.md`](features/documents.md) | All | PDF, Office/OpenDocument, iWork, e-books, DjVu, notebooks, markdown, Access. |
| [`features/design-cad-3d.md`](features/design-cad-3d.md) | All | Vector/raster design, LUTs, fonts, STL/model3d/G-code/Unity, DWG/SolidWorks/Fusion. |
| [`features/eda-nle.md`](features/eda-nle.md) | All | EDA (Altium/KiCad/SPICE/IPC) and NLE/VFX projects + timelines. |
| [`features/data-archive.md`](features/data-archive.md) | All | CSV/table workbench, IMU, git/email, archives/folders/treemap, comics, MIDI, subtitles, geodata. |
| [`features/cross-cutting.md`](features/cross-cutting.md) | All | Hashing, OSINT card, export, search, hex fallback, forensic cards, `/compare`. |
| [`PROGRESS.md`](PROGRESS.md) | Maintainers | The build ledger for this doc set. |

## Conventions

Paths are relative to the repo root, so source lives at `web/assets/js/...`. Code
identifiers are in backticks. These docs are written em-dash-free with British
spelling to match the site's copy convention (see `CLAUDE.md`). The authoritative
project guide is the repo-root `CLAUDE.md`.
