# Docs build progress

Read this first if you are resuming. Do tasks top to bottom. Tick a box only
after the doc is written AND spot-checked against source. Add a one-line note.

## Phase A - setup
- [x] A1 orientation read (CLAUDE.md, README.md) - notes: read both; zero-backend browser tool, never commit/patch.
- [x] A2 skeletons - notes: wrote final docs directly instead of skeleton-then-fill (more efficient; output-focused).

## Phase B - architecture docs (order matters, each builds on the last)
- [x] B1 docs2/architecture.md - notes: from app.js/sw.js/navigate.js/wrangler.jsonc/classify/file-sniff.
- [x] B2 docs2/pipeline.md - notes: handleFile walk-through, classify, sniff reroutes, ROUTES, proprietary chunk dispatch, unknown fallback.
- [x] B3 docs2/renderers.md - notes: all 82 renderers grouped by domain (headers grepped + ROUTES).
- [x] B4 docs2/parsers-and-libs.md - notes: 16 chunks, 17 lib helpers, vendor table.
- [x] B5 docs2/pages.md - notes: all pages incl compare/atari/test wiring. NOTE: web/test.html not in tree (build output).
- [x] B6 docs2/pwa-offline.md - notes: SHELL, VERSION epoch, 3 tiers, manifest, install.
- [x] B7 docs2/tooling.md - notes: server.bat/serve.py/save.bat/generators/version numbering.
- [x] B8 docs2/worker.md - notes: endpoints, schema, privacy (salted hash, unsupported fold, monotonic supported).
- [x] B9 docs2/design-system.md - notes: tokens, sharp corners, .anr-btn, theming, /test.

## Phase C - feature inventory (the checklist the feature docs must satisfy)
- [x] C1 docs2/FEATURE-INVENTORY.md - notes: built from ROUTES + grep of the 40 anr-btn renderers; grouped by owning doc; all boxes ticked.

## Phase D - feature reference (the main deliverable)
- [x] D1 docs2/features/images.md - notes: photo group; controls verified via grep of photo.js/sonify.js.
- [x] D2 docs2/features/audio.md - notes: spectrogram/isolate/record/live/MDX separation verified in audio.js.
- [x] D3 docs2/features/video.md - notes: frame controls, remux, recovery (reference clip) from video.js/video-recover.js.
- [x] D4 docs2/features/animation-frames.md - notes: GIF/WebP transport (in photo.js), reverse, Lottie player.
- [x] D5 docs2/features/documents.md - notes: shared paged.js preview + per-format; tablekit cross-ref to data-archive.
- [x] D6 docs2/features/design-cad-3d.md - notes: STL/model3d/gcode/LUT/font/psd controls verified via grep.
- [x] D7 docs2/features/eda-nle.md - notes: KiCad/Altium board flip, timelines, spice/ipc.
- [x] D8 docs2/features/data-archive.md - notes: tablekit workbench, folder/treemap, archives; added geo.js + vssolution.js (unassigned in plan).
- [x] D9 docs2/features/cross-cutting.md - notes: hashing, OSINT, export (4 formats), search, forensics, compare.

## Phase E - end-user docs + wrap-up
- [x] E1 docs2/user-guide.md - notes: front door + map into features.
- [x] E2 docs2/faq.md - notes: uploads/privacy/formats/recovery/WASM/offline/browsers.
- [x] E3 docs2/README.md - notes: index + audience/purpose table + links.
- [x] E4 README.md pointer - notes: updated existing Documentation pointer from docs/ to docs2/README.md (only edit to a pre-existing file).
- [x] E5 accuracy + completeness pass - notes: 23 docs present; 0 unticked inventory boxes; spot-checked geo kind, gcode Colour-by, export formats, tier sizes, monotonic supported.

## Deviation notes
- Output directory is `docs2/` (not `docs/`) per user request; a prior `docs/`
  run already exists in the repo. All paths below use `docs2/`.
