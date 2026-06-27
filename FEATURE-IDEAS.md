# Feature ideas - backlog checklist

Generated from a four-domain codebase scan (format coverage, analysis depth,
app shell/UX, forensic/security). Effort: **S** = 1-2 days, **M** = 2-5 days,
**L** = 1-2 weeks. Items are grouped by effort, with the renderer/module they
touch in parentheses.

Status key: `[x]` done · `[/]` partial - groundwork already in the code, only
the remaining piece is listed · `[~]` deliberately skipped · `[ ]` not started.
(Statuses re-verified against the code on 2026-06-27; several items the old list
had as `[ ]` were already done or part-built - corrected below with file:line.)

Tip: the cheapest wins now are the `[/]` partials, where most of the work is
already shipped and only one sub-feature is missing - e.g. add musical-key to the
existing BPM (audio-analysis.js), extend macro/external-link detection to pptx +
legacy-office, or add the ghost-authorship flag to DOCX revision forensics.

## Quick wins (S)

- [x] **GPS map plotting** (photo.js) - DONE (pre-existing): Leaflet + OSM map with marker, altitude/direction/speed, and OSM/Google deep-links at photo.js:2684. Multi-photo heatmap deferred until batch drop exists.
- [~] **Metadata stripping export** (photo.js) - SKIPPED by user.
- [~] **Perceptual-hash similarity** (photo.js) - SKIPPED by user. (pHash already computed at photo.js:832; would need a registry to compare against.)
- [x] **File-signature mismatch warning** (app.js) - DONE: `SIG_EXPECT` + `signatureCheck()`/`signatureCard()`, prepended in handleFile's post-render block. Flags wrong-signature and missing-signature; `.anr-sig-flag` CSS. Reuses `sniffFileType()`.
- [x] **Trailing-data / EOF detection (generalise)** (app.js) - DONE: `trailingDataCheck()` + `trailingCard()` cover JPEG/PNG/GIF/BMP/RIFF(WAV/AVI/WebP)/ZIP; ignores zero-padding, sniffs the appended blob. Prepended in handleFile. (PDF keeps its own %%EOF check.)
- [x] **Multi-hash on demand** (util.js) - DONE: `md5Hex()` (pure-JS, RFC-1321 verified) + `extraHashRows()` (MD5/SHA-1/SHA-512, single read). "Show more hashes" button in `sha256Row()`, so it appears everywhere `integrityCard`/`sha256Row` is used.
- [x] **Analysis history** (app.js) - DONE: "Recently analysed" panel on the main page. `recordHistory`/`renderHistoryPanel`, localStorage `anr-history`, metadata-only, max 10, 7-day TTL, deduped. Clear button + tied into global Clear-storage. `.recent-history` CSS.
- [~] **Command palette / keyboard shortcuts** (search.js, app.js) - SKIPPED by user.
- [x] **Archive timing + CRC forensics** (archive.js) - DONE: "Timing & integrity" card - earliest/latest/span, 24-bucket timestamp histogram, bulk-add/identical/placeholder/future flags, and on-demand CRC-32 verify (`verifyArchiveCrcs`). `.anr-ziphist` CSS.
- [x] **CSV anomaly detection** (csv.js) - DONE: additive "Anomalies" section in `buildProfile` - >3σ numeric outliers + constant columns, identical/regular-cadence dates, all-unique (high-entropy) and single-value (low-entropy) text columns.

## Medium (M)

- [ ] **File comparison / diff tool** (new core module) - Side-by-side metadata + binary + checksum compare for two files. Reveals tampering/versioning. (No diff/compare logic exists anywhere yet.)
- [/] **Multi-file / batch drop** (app.js) - PARTIAL: `handleFile` loops over dropped files (app.js:2710) but each call clears the prior render, so only the **last** file's analysis survives; RAW+XMP pairing is the only real multi-file case. Still needed: keep each file's analysis (tabs/stack) + a batch report.
- [ ] **Byte-entropy histogram/heatmap** (binutil.js, unknown.js) - Per-chunk entropy to spot packed/encrypted/stego regions in any binary. (Entropy is only computed today inside csv.js anomaly detection and photo-recover's JPEG scan - no general per-chunk visual.)
- [/] **Embedded-file / polyglot extraction** (binutil.js) - PARTIAL: `trailingCard()` (app.js:595) **detects** appended/polyglot data after the logical EOF and warns, but there's no scan for secondary magic at arbitrary offsets and **no extraction** to a downloadable blob.
- [/] **Office macro/VBA + external-link detection** (docx.js, xlsx.js, pptx.js, legacy-office.js) - PARTIAL: docx.js:348 flags external hyperlink rels and xlsx.js flags VBA presence (`:112`) + external links (`:110`); **pptx.js and legacy-office.js have neither**, and VBA is only flagged-present, never parsed.
- [/] **PDF embedded-JS / action tracing** (pdf.js) - PARTIAL: pdf.js:269 detects embedded JS, shows the source, and checks `getOpenAction()` for OnOpen; still missing the per-event action->script mapping (page/form/doc-level) and network/file/crypto pattern flagging.
- [/] **Spreadsheet formula inspector** (xlsx.js) - PARTIAL: cell **formulae** (xlsx.js:250) and **named ranges** (xlsx.js:103) are extracted and shown; **pivot-table definitions** are not.
- [/] **DOCX revision forensics** (docx.js) - PARTIAL: tracked changes with author names (docx.js:329) and creator/lastModifiedBy metadata are read; still missing the edit-density-per-author timeline and the "ghost authorship" flag (lastModifiedBy != creator).
- [ ] **3D mesh integrity** (stl.js, model3d.js) - Non-manifold edges, self-intersection, flipped normals, duplicate triangles. (stl.js:105 only has `fixNormals()` for zero-length normals; no integrity checks.)
- [/] **Audio BPM + key detection** (audio.js, audio-analysis.js) - PARTIAL: **BPM** is done (`detectBPM`, onset + autocorrelation, audio-analysis.js:200); **musical key** detection is still missing.
- [/] **PSD layer forensics** (psd.js) - PARTIAL: hidden-layer detection exists (psd.js:155); still missing per-layer PNG export and the opacity-0 / size-0 hidden-content scan.
- [x] **Video scene-change contact sheet** (video.js) - DONE: thumbnail grid at detected cuts with clickable markers that jump to the cut (video.js:2624). Detects frame splicing.
- [ ] **Timestamp anomaly detection** (cross-cutting) - Compare filesystem dates vs embedded metadata (EXIF, PDF, PE compile time); warn on large/impossible mismatches. (The individual timestamps are parsed; no cross-source comparison exists.)
- [ ] **GPX heatmap overlay** (geo.js) - Map data renders (track line + elevation profile, geo.js:67) but does not show activity hotspots / track density.
- [ ] **Shareable report links** (export-data.js) - QR code + shortened URL for an analysis snapshot. (No QR library or shortener anywhere.)
- [ ] **JPEG EXIF thumbnail misalignment** (photo.js) - Compare main-image dimensions to embedded EXIF thumbnail; flag mismatch as a post-EXIF edit tell. (Not implemented.)

## Upgrade ID-only formats to full viewers (M-L)

- [ ] **FBX model viewer** (new / model3d.js) - WebGL viewer like STL/glTF for Blender/Unreal/Maya assets. (FBX is identified only; model3d.js routes obj/ply/off/3mf/amf/gltf/glb/step/iges but not fbx.)
- [/] **glTF / Lottie playback** - PARTIAL: **glTF/GLB are rendered** in the 3D viewer (`renderGltf`, model3d.js:1122). **Lottie is identification-only** (vendor `lottie.min.js` is bundled but never imported) - add real-time playback with timeline scrubbing.
- [ ] **SQLite query UI** (existing SQLite lib) - sqlite.js exposes only fixed read-only queries (schema + sample rows); add a user-editable SQL box that runs arbitrary `SELECT`s.
- [/] **ASS/SSA styled subtitle rendering** (subtitles.js) - PARTIAL: ASS/SSA are parsed into a cue list (subtitles.js:51) but every `{...}` style tag is stripped (subtitles.js:71); still need full styling, positioning and karaoke rendering.
- [ ] **DAW project timelines** - Ableton (ALS), FL Studio (FLP), Reaper (RPP) are ID-only (proprietary-formats.js:178); visual timeline like the NLE renderers.
- [ ] **Figma/Sketch component tree viewer** - Decode frames, components, text layers for design review. (Sketch is identified by magic bytes only; no component decoder.)
- [ ] **IFC / BIM object browser** (L) - Building element tree + property extraction for AEC workflows. (parsers-threed.js:714 `parseIfc` only counts entity types; no tree/viewer.)

## Larger (L)

- [ ] **Tamper-evident report export** (export-data.js) - Bundle file SHA-256 + UTC timestamp + Analyser version + verify instructions. Chain-of-custody credibility. (Export includes a timestamp + file metadata today, but no version, verify instructions or chain-of-custody framing.)
- [ ] **PDF report export** (new) - Styled, paginated PDF embedding tables/histograms/spectrograms (self-contained HTML + CSV export exist today; PDF does not).
- [ ] **Fuzzy hashing (ssdeep / CTPH)** - Similarity matching against known corpora. (Only exact hashes - MD5/SHA-1/SHA-256/SHA-512 - exist.)
- [ ] **PE packer identification** (parsers-security / dev) - Heuristic UPX/Themida detection via section names + entropy spikes. (parsers-dev.js:1265 does PE container ID + section/import analysis but no packer heuristics.)
- [ ] **ML model graph viewer (ONNX/TF)** - Render the computation graph; ID-only today (parsers-dev.js:1215 `parseOnnx` reads header metadata only).
- [ ] **Chemistry molecule 3D viewer (MOL/SDF/CIF)** - WebGL structure + bond highlighting; ID-only today (parsers-sci.js:622 `parseMol`/`parseCif` extract atom/bond counts only).
- [/] **URL/IP/domain extraction + OSINT links** (cross-cutting) - PARTIAL: parsers-security.js:888 extracts hosts from captured **PCAP traffic only**; still need a general regex scan of extracted text from Office/PDF/scripts plus one-click OSINT deep-links.
