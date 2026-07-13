# Docs build progress

Read this first if you are resuming. Do tasks top to bottom. Tick a box only
after the doc is written AND spot-checked against source. Add a one-line note.

## Phase A - setup
- [x] A1 orientation read (CLAUDE.md, README.md) - notes: read both; zero-backend browser-only forensic workbench, never commit/patch without explicit ask.
- [x] A2 skeletons for every docs/ file created with headings + TODO markers - notes: all docs/*.md and docs/features/*.md skeletons created.

## Phase B - architecture docs (order matters, each builds on the last)
- [x] B1 docs/architecture.md - notes: covers zero-backend model, boot()/page shell, lazy() loading, sw.js precache, navigate.js SPA swap, wrangler.jsonc deploy.
- [x] B2 docs/pipeline.md - notes: classify.js precedence, file-sniff.js sniffFileType/resolveByContent/isReadableText, VARIANT_REROUTE, formats.js EXT_VARIANTS/detectVariant, proprietary.js chunk dispatch, unknown.js fallback.
- [x] B3 docs/renderers.md - notes: catalog of all 79 renderer modules (plan said 82, actual count re-verified via glob) grouped by domain, from top-comments + imports.
- [x] B4 docs/parsers-and-libs.md - notes: chunk dispatch contract, all 16 parser chunks, 17 lib/loader files including MDX-Net subsystem.
- [x] B5 docs/pages.md - notes: all 8 pages covered; test.html confirmed NOT present in working tree (noted explicitly per skip-test-page memory).
- [x] B6 docs/pwa-offline.md - notes: SHELL precache, VERSION epoch/KEEP_CACHES, 3 offline tiers with real sizes from offline-tiers.js, manifest.json + install flow/installHint.
- [x] B7 docs/tooling.md - notes: server.bat/serve.py routing+mock stats, save.bat full flow, all 7 tools/*.mjs generators, version numbering pointer.
- [x] B8 docs/worker.md - notes: all 4 D1 tables + 5 endpoints, privacy mechanisms (hashIp, unsupported-bucket collapsing, rate limits), history.js/stats-page.js client wiring, serve.py mock.
- [x] B9 docs/design-system.md - notes: token system, sharp-corners rule verified against actual CSS (found narrow exceptions: viewcube, LUT swatches, DaVinci node pill), test.html confirmed absent from working tree.

Phase B complete.

## Phase C - feature inventory (the checklist the feature docs must satisfy)
- [x] C1 docs/FEATURE-INVENTORY.md built from ROUTES + grep of renderers - notes: ~150 control rows across all 40 anr-btn renderers + secondary renderers checked for other control types; found vssolution.js unassigned in DOCS_PLAN's table (placed under data-archive.md, noted as deviation).

## Phase D - feature reference (the main deliverable)
- [x] D1 docs/features/images.md - notes: 13 feature entries covering photo.js (EXIF/histogram/GPS/OCR/live-photo/XMP-import/frame-stepping), photo-convert/photo-recover, sonify.js, tiff/mpo/ico/embedded-images.js.
- [x] D2 docs/features/audio.md - notes: 12 entries; audio.js read in sections (3526 lines, grepped key control blocks) plus audio-analysis/audio-codec/audio-player/spectrogram/media-reverse read in full.
- [x] D3 docs/features/video.md - notes: 12 entries; video.js grepped in sections (4004 lines), video-avi/video-recover/video-sync read in full. sony-rtmd.js correctly left to eda-nle.md per DOCS_PLAN assignment.
- [x] D4 docs/features/animation-frames.md - notes: 4 entries, lottie.js read in full, gif-frames/gif-encode/webp-frames confirmed single-export shape.
- [x] D5 docs/features/documents.md - notes: 16 entries; pdf.js read in full (1192 lines, richest doc feature - forensics, OCR, image extraction), djvu/xlsb/iwork/mobi/mdb read fully, paged.js + others from top comments/inventory.
- [x] D6 docs/features/design-cad-3d.md - notes: 14 entries; illustrator/svg/unity/dwg/solidworks/f3d read fully, psd/paint/diagram/lut/font read in sections, stl/model3d/gcode (8699 total lines, 3 largest files) grepped for control context + inventory data.
- [x] D7 docs/features/eda-nle.md - notes: 10 entries; ipcnet/vegas/timeline/spice read fully, altium/kicad/sony-rtmd read in sections (largest at 1152/1733/630 lines), aftereffects/premiere/davinci from top comments + inventory.
- [x] D8 docs/features/data-archive.md - notes: 16 entries covering all 17 assigned files (incl. vssolution.js, the plan-unassigned renderer); tablekit.js's rich in-app help text used as primary source for workbench control descriptions.
- [x] D9 docs/features/cross-cutting.md - notes: 8 entries; osint.js read fully, forensics.js/export-data.js/search.js/compare.js read in sections, hash-cell wiring found in util.js (sha256Row/integrityCard).

Phase D complete - all 9 feature docs written.

## Phase E - end-user docs + wrap-up
- [x] E1 docs/user-guide.md - notes: dropzones, readout anatomy, privacy promise, offline tiers, doc map table linking every features/*.md.
- [x] E2 docs/faq.md - notes: based on about.html's real #faq section (7 Q&As) plus 4 added Qs (WASM downloads, recovery, browser support, bug reports) cross-linked to feature docs.
- [x] E3 docs/README.md (doc index + map) - notes: pitch + full doc map table linking all 22 docs with audience column.
- [x] E4 README.md footer pointer paragraph (only edit to an existing file) - notes: added one-paragraph "Documentation" section at the end of repo root README.md, linking docs/README.md. Only pre-existing file touched in the whole job.
- [x] E5 accuracy + completeness pass; every FEATURE-INVENTORY item covered - notes: all rows ticked in FEATURE-INVENTORY.md; fixed 2 verified inaccuracies in images.md (QR detection is automatic not a button; OCR language count corrected 31->32); checked format-count phrasing consistency; confirmed no stray TODO markers remain; all 22 planned doc files + PROGRESS.md exist.

ALL PHASES COMPLETE. Docs plan from research/DOCS_PLAN.md fully executed.
