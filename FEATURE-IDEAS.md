# Feature ideas - backlog checklist

Generated from a four-domain codebase scan (format coverage, analysis depth,
app shell/UX, forensic/security). Effort: **S** = 1-2 days, **M** = 2-5 days,
**L** = 1-2 weeks. Items are grouped by effort, with the renderer/module they
touch in parentheses.

Status key: `[x]` done · `[/]` partial - groundwork already in the code, only
the remaining piece is listed · `[~]` deliberately skipped · `[ ]` not started.
(Statuses re-verified against the code on **2026-07-24**. The 7.0 "X-Ray"
forensic release and the work around it cleared most of the Medium tier -
seventeen items moved to `[x]` in this pass - so the list below is now mostly
the genuinely unbuilt work.)

Tip: what is actually left splits into three piles. **Unbuilt viewers for
formats we only identify** (DAW projects, Figma/Sketch, IFC, ML graphs,
molecules) - each self-contained, no shared plumbing needed. **One-off forensic
gaps** (fuzzy hashing, PE packer heuristics, the GPX heatmap, a SQL box for
SQLite). And **one shell-level feature** that touches the whole app: keeping
more than one file's analysis on screen (batch drop). The cheapest remaining
wins are the two `[/]` partials, where the hard part already ships.

## Quick wins (S)

- [x] **GPS map plotting** (photo.js) - DONE (pre-existing): Leaflet + OSM map with marker, altitude/direction/speed, and OSM/Google deep-links. Multi-photo heatmap deferred until batch drop exists.
- [x] **Metadata stripping export** (photo.js) - DONE (was skipped, since built): `scrub.js` - a **Remove metadata** control on the Metadata card that losslessly rebuilds the file with its metadata segments removed, pixels and colour profile untouched.
- [~] **Perceptual-hash similarity** (photo.js) - SKIPPED by user. (pHash already computed at photo.js:832; would need a registry to compare against.)
- [x] **File-signature mismatch warning** (app.js) - DONE: `SIG_EXPECT` + `signatureCheck()`/`signatureCard()` (now in `core/forensics.js`), prepended in handleFile's post-render block. Flags wrong-signature and missing-signature; `.anr-sig-flag` CSS. Reuses `sniffFileType()`.
- [x] **Trailing-data / EOF detection (generalise)** (app.js) - DONE: `trailingDataCheck()` + `trailingCard()` cover JPEG/PNG/GIF/BMP/RIFF(WAV/AVI/WebP)/ZIP; ignores zero-padding, sniffs the appended blob. (PDF keeps its own %%EOF check.)
- [x] **Multi-hash on demand** (util.js) - DONE: `md5Hex()` (pure-JS, RFC-1321 verified) + `extraHashRows()` (MD5/SHA-1/SHA-512, single read). "Show more hashes" button in `sha256Row()`, so it appears everywhere `integrityCard`/`sha256Row` is used.
- [x] **Analysis history** (app.js) - DONE: "Recently analysed" panel on the main page. `recordHistory`/`renderHistoryPanel`, localStorage `anr-history`, metadata-only, max 10, 7-day TTL, deduped. Clear button + tied into global Clear-storage.
- [~] **Command palette / keyboard shortcuts** (search.js, app.js) - SKIPPED by user. (A single global shortcut exists - space plays/pauses whatever the page is playing, app.js boot's one-time guard - but there is no palette and none is planned.)
- [x] **Archive timing + CRC forensics** (archive.js) - DONE: "Timing & integrity" card - earliest/latest/span, 24-bucket timestamp histogram, bulk-add/identical/placeholder/future flags, and on-demand CRC-32 verify (`verifyArchiveCrcs`).
- [x] **CSV anomaly detection** (csv.js) - DONE: additive "Anomalies" section in `buildProfile` - >3σ numeric outliers + constant columns, identical/regular-cadence dates, all-unique (high-entropy) and single-value (low-entropy) text columns.

## Medium (M)

- [x] **File comparison / diff tool** (new core module) - DONE: the `/compare` page (`compare.html` + `renderers/compare.js`). Runs each file through the real `classifyFile()`/`ROUTES` renderer, then **moves** the readout cells into merged `Field | A | B` tables (so tooltips and async fills keep working); differing rows are tagged `.is-diff`, powering a **Show differences** toggle that also fades matching side-by-side panels.
- [~] **Multi-file / batch drop** (app.js) - SKIPPED by user. Dropping several files analyses the **first** one cleanly and ignores the rest (app.js:1041, a deliberate fix for the old render-on-top-of-each-other behaviour); `/compare` handles exactly two, and RAW+XMP pairing covers the one real multi-file case. Keeping several analyses on screen at once (tabs/stack + batch report) was considered and declined - it is the one feature here that would touch the whole app shell.
- [x] **Byte-entropy histogram/heatmap** (binutil.js, unknown.js) - DONE: `shannonEntropy()` + `entropyProfile()` (binutil.js:189-210) bucket a file into per-chunk bits/byte, consumed by unknown.js to spot packed/encrypted/stego regions in any binary.
- [x] **Embedded-file / polyglot extraction** (binutil.js) - DONE: the trailing-data card (forensics.js:284) now **carves** the appended region out as a blob with **Download** and **Analyse** actions, not just a warning.
- [x] **Office macro/VBA + external-link detection** (docx.js, xlsx.js, pptx.js, legacy-office.js) - DONE across all four: pptx.js:152 flags `ppt/vbaProject.bin` and :246 collects external hyperlink targets; legacy-office.js:365 `hasVbaMacros()` detects the `Macros`/`_VBA_PROJECT_CUR` compound-file storages plus external URLs. VBA is flagged-present, never decompiled - deliberate.
- [x] **PDF embedded-JS / action tracing** (pdf.js) - DONE: per-event action->script mapping via `AUTO_TRIGGERS` (pdf.js:301 - open/print/save/close) on top of `getOpenAction()`, plus pattern flagging of the scripts for network / file / launch-exec / obfuscation calls (pdf.js:294) with a plain-English summary.
- [x] **Spreadsheet formula inspector** (xlsx.js) - DONE: cell formulae and named ranges were already read; `collectPivots()` (xlsx.js:39) now adds pivot-table definitions - name, target location, field counts and the source range followed through to the pivot-cache definition.
- [x] **DOCX revision forensics** (docx.js) - DONE: tracked changes with author names, plus the **ghost-authorship** flag (creator != last editor, docx.js:304) and the per-author **edit-density** breakdown ranking authors by how much of the revision they own (docx.js:382).
- [x] **3D mesh integrity** (stl.js, model3d.js) - DONE: `analyzeMeshIntegrity()` (stl.js:715) checks 2-manifold edges, open boundaries/holes, flipped normals and duplicate triangles, surfaced as a plain **Watertight** / **Faults found** badge.
- [x] **Audio BPM + key detection** (audio.js, audio-analysis.js) - DONE: BPM was already there; `detectKey()` (audio-forensics.js:216) adds the musical-key estimate with a confidence and an alternate reading, from the long-average spectrum.
- [x] **PSD layer forensics** (psd.js) - DONE: per-layer PNG export (`layerPngButton`, psd.js:136) and the hidden-content scan including the opacity-0 case (psd.js:162).
- [x] **Video scene-change contact sheet** (video.js) - DONE: thumbnail grid at detected cuts with clickable markers that jump to the cut. Detects frame splicing.
- [x] **Timestamp anomaly detection** (cross-cutting) - DONE: `timeAnomalies()` + `timeAnomalyCard()` (util.js:404) cross-compare filesystem dates against embedded metadata (EXIF, PDF, PE compile time) and flag impossible or implausible gaps.
- [x] **GPX heatmap overlay** (geo.js) - DONE: a Track / Pace / Density picker above the map. **Pace** colours the line by speed, with the five bands set from the quantiles of the track's own speeds (so a walk and a flight both read correctly) and short-window smoothing so GPS jitter doesn't shatter the line, plus pins for every stop. **Density** bins points into screen-space cells on a canvas in Leaflet's overlay pane, square-root scaled so one long rest stop doesn't flatten the ramp. Caps in `limits.js` (`GEO_HEAT_POINTS`, `GEO_PACE_RUNS`).
- [~] **Shareable report links** (export-data.js) - SKIPPED by user. A zero-backend version is possible (reduced report deflated into the URL fragment, which never reaches the server), but it caps out around 6 KB of JSON once a link has to stay under ~2000 characters to survive chat clients - so it could carry the headline findings and nothing with an image, a hex dump or extracted text in it. QR is tighter still and needs an encoder we don't vendor. The server version lifts every limit but would mean analysis data leaving the device, against the privacy promise. The self-contained HTML export already does this job with no size ceiling.
- [x] **JPEG EXIF thumbnail misalignment** (photo.js) - DONE: main-image dimensions are compared to the embedded EXIF thumbnail and a mismatch is flagged as a post-EXIF edit tell (photo.js:3587).

## Upgrade ID-only formats to full viewers (M-L)

- [x] **FBX model viewer** (model3d.js) - DONE: `renderFbx` (model3d.js:30, parser at :1306) reads both the binary ("Kaydara FBX Binary" node-record tree, inflating zlib-encoded array properties) and ASCII forms, and feeds the geometry into the same WebGL viewer as STL/glTF.
- [x] **glTF / Lottie playback** - DONE: glTF/GLB render in the 3D viewer, and `renderers/lottie.js` now plays Lottie/Bodymovin JSON through the vendored lottie-web, including dotLottie `.lottie` ZIPs and Telegram `.tgs` gzip stickers.
- [x] **SQLite query UI** (existing SQLite lib) - DONE: the **SQL console** section on any SQLite-backed file (proprietary.js:1198). A read-only single-statement box already shipped; it is now unrestricted - multi-statement scripts, writes and DDL all run, because sql.js holds the database in the WASM heap and what you are querying is a scratch copy that is never written back. Non-SELECT statements report rows changed, a **Reset to file** button drops the copy and re-reads the original bytes, and a note says plainly that the file on disk is untouched.
- [x] **ASS/SSA styled subtitle rendering** (subtitles.js) - DONE: a playable **Preview** stage. The frame is built in the script's own PlayResX/PlayResY coordinate system and scaled to the card by a single CSS transform, so positions are exact at any width. Handles `\pos`, `\move` (interpolated over its own time range), `\an` and legacy `\a` alignment, per-line and per-style margins, and stacks simultaneous lines away from their anchored edge instead of overprinting. **Karaoke** (`\k`, `\kf`, `\K`, `\ko`, `\kt`) fills syllable by syllable against a transport, with `\kf` sweeping via a gradient - which is why the outline is drawn with `text-stroke` and `paint-order` rather than a shadow stack, since a shadow does not survive the transparent fill a gradient fill needs. Also fixed two parsing bugs found on the way: the old tag regex read `\k50` as a tag named "k50" (losing every karaoke timing) and lower-cased `\K` into `\k` (a switch instead of a sweep). Still not drawn: `\p` vector drawings, rotation and blur.
- [ ] **DAW project timelines** - Ableton (ALS), FL Studio (FLP), Reaper (RPP) are still ID-only (proprietary-formats.js:178-181, RPP with a text parse); visual timeline like the NLE renderers.
- [ ] **Figma/Sketch component tree viewer** - Decode frames, components, text layers for design review. (Both still identified by magic bytes only; no component decoder, no `classify.js` route.)
- [ ] **IFC / BIM object browser** (L) - Building element tree + property extraction for AEC workflows. (parsers-threed.js:714 `parseIfcText` reads the schema/author header and counts entity types from the first 2 MB; no tree, no viewer.)

## Larger (L)

- [x] **Tamper-evident report export** (export-data.js) - DONE: the report bundles the file's SHA-256, a UTC export timestamp and the Analyser version (export-data.js:228), with `VERIFY_INSTRUCTIONS` (:239) giving the exact `shasum` / `certutil` command to recompute and compare - chain-of-custody framing, not just a metadata dump.
- [x] **PDF report export** (new) - DONE, via the browser rather than a library: the **PDF (print)** action opens the complete self-contained report in a new tab and launches the print dialog ("Save as PDF"), so the styled tables/histograms/spectrograms paginate without shipping a PDF writer.
- [x] **Fuzzy hashing (ssdeep / CTPH)** - DONE: `lib/ssdeep.js`, a from-scratch implementation of the published spamsum algorithm (same rolling hash, FNV block hash, trigger rule and scoring), so its strings interoperate with real ssdeep. Wired into **/compare** as a **Fuzzy hash** row plus a **Similarity** verdict, which is where the question "how alike are these two files" actually gets asked - matching against an external corpus was not built, since there is no corpus on-device and fetching one would break the no-upload promise. Verified against constructed cases: identical 100, 500 bytes inserted into 40 KB 97, unrelated same-size 0, and a file against a double-length superset 60 across the block-size doubling.
- [x] **PE packer identification** (parsers-security / dev) - DONE: `lib/pe-packer.js`, surfaced as the **Packing and toolchain** section on any `.exe`/`.dll`. Two halves. A **signature table** names things from section names and internal markers - UPX, ASPack, PECompact, MPRESS, Petite, NsPack, FSG, kkrunchy; Themida/WinLicense, VMProtect, Enigma, Obsidium, Armadillo, ConfuserEx, .NET Reactor, Denuvo; PyInstaller, py2exe, Nuitka, AutoIt, Electron, Launch4j; Go, Rust, Delphi, MinGW, VB6. **Heuristics** measure: per-section Shannon entropy (sampled, `PE_SECTION_SAMPLE`), sections with no raw data but a large virtual size, 4x+ memory-to-disk bloat, a tiny import table beside high entropy, writable+executable sections, an entry point in the last section, and a large overlay. Packing is normal software behaviour as often as it is malware, so the card presents evidence and draws no conclusion.
- [ ] **ML model graph viewer (ONNX/TF)** - Render the computation graph; ID-only today (parsers-dev.js:1210 `parseOnnx` reads header/IR-version metadata only).
- [ ] **Chemistry molecule 3D viewer (MOL/SDF/CIF)** - WebGL structure + bond highlighting; ID-only today (parsers-sci.js:622 `parseMol`/`parseMol2`/`parseCif` extract atom/bond counts only).
- [x] **URL/IP/domain extraction + OSINT links** (cross-cutting) - DONE: `core/osint.js` `extractIndicators()` (:26) pulls URLs, IPs, domains and e-mail addresses out of any file's text into a card of click-to-open lookup links. Nothing is sent automatically - the no-upload promise holds.
