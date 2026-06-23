# Feature ideas - backlog checklist

Generated from a four-domain codebase scan (format coverage, analysis depth,
app shell/UX, forensic/security). Effort: **S** = 1-2 days, **M** = 2-5 days,
**L** = 1-2 weeks. Items are grouped by effort, with the renderer/module they
touch in parentheses.

Tip: the strongest starting cluster is the photo.js group (GPS map, metadata
stripping, perceptual-hash similarity) and the magic/binutil group
(signature-mismatch, entropy, trailing-data) - in both cases the plumbing
already exists.

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

- [ ] **File comparison / diff tool** (new core module) - Side-by-side metadata + binary + checksum compare for two files. Reveals tampering/versioning.
- [ ] **Multi-file / batch drop** (app.js) - Current flow is single-file; multi-select unlocks batch reports and the comparison workflow above.
- [ ] **Byte-entropy histogram/heatmap** (binutil.js, unknown.js) - Per-chunk entropy to spot packed/encrypted/stego regions in any binary.
- [ ] **Embedded-file / polyglot extraction** (binutil.js) - Scan for secondary magic bytes at non-zero offsets; list and extract nested ZIP/OLE/JPEG-in-PDF as downloadable blobs.
- [ ] **Office macro/VBA + external-link detection** (docx.js, xlsx.js, pptx.js, legacy-office.js) - Flag active content and rels pointing to external URLs in OOXML/OLE.
- [ ] **PDF embedded-JS / action tracing** (pdf.js) - Already surfaces JS; add which events (OnOpen, doc actions) trigger which scripts and flag network/file/crypto patterns.
- [ ] **Spreadsheet formula inspector** (xlsx.js) - Opens data but not formulae, named ranges, or pivot definitions.
- [ ] **DOCX revision forensics** (docx.js) - Tracked changes exist; add edit-density-per-author timeline + "ghost authorship" (editor not equal to creator).
- [ ] **3D mesh integrity** (stl.js, model3d.js) - Non-manifold edges, self-intersection, flipped normals, duplicate triangles.
- [ ] **Audio BPM + key detection** (audio.js, audio-analysis.js) - Spectrogram exists; add tempo/key estimation (e.g. Essentia.js).
- [ ] **PSD layer forensics** (psd.js) - Per-layer PNG export + hidden-content scanner (hidden layers, opacity 0, size 0).
- [ ] **Video scene-change contact sheet** (video.js) - Pre-compute a thumbnail grid at detected cuts; click to jump. Detects frame splicing.
- [ ] **Timestamp anomaly detection** (cross-cutting) - Compare filesystem dates vs embedded metadata (EXIF, PDF, PE compile time); warn on large/impossible mismatches.
- [ ] **GPX heatmap overlay** (geo.js) - Map data renders but does not show activity hotspots/track density.
- [ ] **Shareable report links** (export-data.js) - QR code + shortened URL for an analysis snapshot.
- [ ] **JPEG EXIF thumbnail misalignment** (photo.js) - Compare main-image dimensions to embedded EXIF thumbnail; flag mismatch as a post-EXIF edit tell.

## Upgrade ID-only formats to full viewers (M-L)

- [ ] **FBX model viewer** (new / model3d.js) - WebGL viewer like STL/glTF for Blender/Unreal/Maya assets.
- [ ] **glTF / Lottie playback** - Lottie identified but not rendered; add real-time playback with timeline scrubbing.
- [ ] **SQLite query UI** (existing SQLite lib) - Schema is shown today; add sample SQL execution.
- [ ] **ASS/SSA styled subtitle rendering** (subtitles.js) - Full styling, positioning, karaoke timing instead of ID-only.
- [ ] **DAW project timelines** - Ableton (ALS), FL Studio (FLP), Reaper (RPP) are ID-only; visual timeline like the NLE renderers.
- [ ] **Figma/Sketch component tree viewer** - Decode frames, components, text layers for design review.
- [ ] **IFC / BIM object browser** (L) - Building element tree + property extraction for AEC workflows.

## Larger (L)

- [ ] **Tamper-evident report export** (export-data.js) - Bundle file SHA-256 + UTC timestamp + Analyser version + verify instructions. Chain-of-custody credibility.
- [ ] **PDF report export** (new) - Styled, paginated PDF embedding tables/histograms/spectrograms (HTML export exists today).
- [ ] **Fuzzy hashing (ssdeep / CTPH)** - Similarity matching against known corpora.
- [ ] **PE packer identification** (parsers-security / dev) - Heuristic UPX/Themida detection via section names + entropy spikes.
- [ ] **ML model graph viewer (ONNX/TF)** - Render the computation graph; ID-only today.
- [ ] **Chemistry molecule 3D viewer (MOL/SDF/CIF)** - WebGL structure + bond highlighting; ID-only today.
- [ ] **URL/IP/domain extraction + OSINT links** (cross-cutting) - Grep extracted text from Office/PDF/scripts for network indicators; one-click lookup deep-links.
