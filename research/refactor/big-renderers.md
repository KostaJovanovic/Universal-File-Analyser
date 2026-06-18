# Refactoring plan — the four big renderer modules

Scope: `video.js` (3587), `proprietary.js` (4098), `photo.js` (2870),
`audio.js` (1960). No tests exist, so every proposal here is **behaviour-preserving
file-splitting / dedup only** — pure code moves with re-exports, no logic rewrites.

Method: each module is one ES module with a fat exported entry point
(`renderVideo` / `renderProprietary` / `renderPhoto` / `renderAudio`) plus a long
tail of private helpers grouped by concern. The natural seams are already visible
as contiguous helper clusters; splitting is mostly "lift a cluster into a sibling
file and import it back". The entry functions themselves stay put (they are the
orchestrators and the riskiest to touch).

Conventions assumed from CLAUDE.md: vanilla ES modules, no build step, lazy WASM,
offline `SHELL` precache in `sw.js`. **Any new module that is statically imported
by a `SHELL`-listed renderer must itself be added to `SHELL`** (else offline
breaks) — flagged per item below.

---

## 0. Cross-cutting duplication (do these first — highest value, lowest risk)

These are confirmed copy/near-copies and several already have a canonical home in
`core/util.js` that the renderers shadow with local redefinitions.

| Helper | Canonical / proposed home | Duplicated in | Notes |
|---|---|---|---|
| `fmtDate(d)` | **already exported** `util.js:343` | `video.js:1117`, `photo.js:335` | Local copies are near-identical reimplementations of the exported one. Drop locals, import. |
| `gcd(a,b)` / `aspectRatio(w,h)` | `util.js` (new) or shared `core/geom.js` | `video.js:1099/1101`, `photo.js:272/274` (+ `approxAspect` 288) | Byte-identical `gcd`; `aspectRatio` differs only trivially. |
| `getMono(audioBuffer)` | `audio-analysis.js` (new export) | `video.js:2179`, `audio.js:37` | Same downmix. video.js already imports from audio.js — re-export there. |
| `computeStats(samples)` | `audio-analysis.js` (already exports `computeStats`) | `video.js:2191` | video.js has its **own** local `computeStats` (2191) duplicating the audio-analysis one it could import. |
| `formatDuration`/`fmtClock`/`formatTime` | one `fmtClock` in `util.js` | `video.js:1107 formatDuration`, `audio.js:312 fmtClock`, spectrogram `formatTime` | Three near-identical mm:ss formatters. |
| MP4 / ISOBMFF box walking (`parseBoxes`, `findAllBoxes`, `fcc`) | **new `core/isobmff.js`** | `video.js:1131/1149/1632` | The single highest-value structural extraction — see §1.A and proprietary §4. |
| Download-a-Blob wiring (`URL.createObjectURL` + `<a download>` + click + revoke) | **new `util.js` `downloadBlob(blob, name)`** | ~45 occurrences in video.js, 49 in photo.js, 15 in audio.js | Counted via grep; most are the same 4-line idiom. Extract one helper, migrate opportunistically. |
| Off-screen `canvas`+`getContext('2d')` scratch | small `util.js` `scratchCanvas(w,h)` | photo/video/audio histogram & frame code | Lower value; many are bespoke. Extract only the trivial identical ones. |

`fmtDate`, `gcd`/`aspectRatio`, `getMono`, `computeStats`, the duration formatters
and `downloadBlob` are **mechanical, self-contained, and verifiable by eye** — do
them before any file split. They also shrink the four files by a meaningful amount
with near-zero risk.

---

## 1. video.js (3587 lines)

### Sub-responsibilities (line ranges approximate)
1. **Small shared UI/DOM helpers** — `isIOS` 17, `applyVideoControls` 25,
   `sheetImg` 38, `scrollToPhoto` 49, `buildFrameControls` 61, `audioDownloadRow`
   172, `mountAudioAnalyseButton` 185, `mountPhotoAnalyseButton` 211. Plain DOM
   glue, little video-specific state.
2. **FFmpeg lifecycle + jobs** — `fetchWithProgress` 228, `makeBlobURL` 248,
   `showFfmpegLoader`/`setFfmpegLoaderProgress`/`hideFfmpegLoader` 269–286,
   `killFFmpeg` 299, `loadFFmpeg` 303, `ffmpegExtractAudio` 322,
   `ffmpegReverseVideo` 367, `ffmpegTranscodeToH264` 515, `ffmpegRemuxToMp4` 627,
   `ffmpegFirstFrame` 1048, `detectFpsWithFfmpeg` 2074. **Holds module-level
   FFmpeg singleton + loader-overlay state** (the main shared-state knot).
3. **Raw H.264/H.265 elementary-stream handling** — NAL helpers `nalTypeOf` 692,
   `isIdrNal` 696, `isParamNal` 698, `extractRawParamSets` 703, `describeRawCodec`
   738, `findNextIdrOffset` 760, `planRawSegments` 782, `remuxRawSegment` 804,
   `buildRawSceneCard` 833, `renderSegmentedRawVideo` 883. Self-contained codec
   bitstream logic.
4. **Reverse-video card** — `buildReverseVideoCard` 544 (UI around #2's
   `ffmpegReverseVideo`).
5. **ISOBMFF / container probing** — `parseBoxes` 1131, `findAllBoxes` 1149,
   `fcc` 1632, `peekVideoContainer` 1373, `readMatroskaApps` 1430,
   `readAviSoftware` 1462, `readMp4Encoder` 1487, `readContainerSoftware` 1507,
   `detectFpsFromContainer` 1528, `rotationFromMatrix` 1639,
   `detectIsobmffTracks` 1651, `appendTrackRows` 1867, `appendCreatorRows` 1517.
   The big container/track-metadata block.
6. **PCM / audio companion** — `getAudioCtx` 1124, `extractPcmFromMp4` 1163,
   `audioBufferToWavUrl` 1264, `sniffMp4AudioCodec` 1303,
   `attachPcmAudioCompanion` 1350.
7. **Scene detection + frame sampling** — `detectSceneChanges` 2112,
   `meanLuma` 1022, `whenFramePainted` 2211, `seekAndPaint` 2221.
8. **Unplayable / fallback render paths** — `renderUnplayableVideoInfo` 1915,
   `renderVisibleVideoFallback` 2242.
9. **Orchestrator** — `renderVideo` 2507–3573, `initVideo` 3574. Leave in place.

### Proposed sub-modules
- **`video-ffmpeg.js`** ← cluster #2 (FFmpeg singleton, loader overlay, all
  `ffmpeg*` jobs). The reverse-video FFmpeg call and FPS-via-ffmpeg go here; the
  *card* UI (`buildReverseVideoCard`) can stay or move to a thin `video-cards.js`.
- **`video-raw-h26x.js`** ← cluster #3 (NAL + segmented-raw remux). Cleanest cut;
  it only needs `video-ffmpeg.js` (`ffmpegRemuxToMp4`) and binutil.
- **`video-container.js`** ← cluster #5 (box walking + container/track readout).
  The box-walkers (`parseBoxes`/`findAllBoxes`/`fcc`) should themselves go to the
  shared **`core/isobmff.js`** (§0) and be imported here.
- **`video-pcm.js`** ← cluster #6 (PCM extraction + WAV + companion). Depends on
  `core/isobmff.js`.
- **`video-frames.js`** ← cluster #7 (scene detect, luma, paint helpers).
- Keep `renderVideo`, `initVideo`, the early-gate logic, and the small UI glue
  (#1) in `video.js` as the orchestrator.

### State/coupling that makes splitting hard
- **`videoRenderAbort` (module-level AbortController)** threaded as `signal` into
  almost every helper. Already passed as a parameter in most signatures, so it
  travels fine across files — but `renderVideo` reads/writes the module var
  directly (2508). Keep the var in `video.js`; helpers keep taking `signal`.
- **FFmpeg singleton + loader-overlay DOM state** (cluster #2). `killFFmpeg`,
  `showFfmpegLoader` and the singleton must live together in `video-ffmpeg.js`;
  callers import them. This is the one place where moving half the cluster would
  break things.
- `renderVideo` **recursively re-enters itself** after remux (2568) with
  `{remuxed:true}` — keep the recursion inside `video.js`.
- **SHELL note:** `video.js` is in `sw.js` SHELL; new statically-imported
  children (`video-ffmpeg.js`, `video-container.js`, `core/isobmff.js`, …) **must
  be added to SHELL** or offline analysis of video breaks.

### Fragile — leave alone
- The probe-element lifecycle in `renderVideo` (2606–2622: hidden `<video>` kept
  in DOM for off-screen decode, iOS quirks). Heavily comment-documented browser
  workarounds; do not relocate or "tidy".
- `detectIsobmffTracks` (1651–1866) chroma/bit-depth gating — the early-exit at
  2594 depends on its exact return shape. Move the file, not the logic.

---

## 2. proprietary.js (4098 lines)

Structure: ~60 `parseXxx` functions, each handling one format family, dispatched
by the `PARSERS` map (3793) and `renderProprietary` (3876). Format *catalog* is
already external (`proprietary-formats.js`); this file is pure parsing logic.
**This is the easiest of the four to split** because the parsers are independent
and the `PARSERS` table is already an explicit registry.

### Natural domain groupings (mirror the existing `parsers/parsers-<domain>.js`)
- **`prop-exe.js`** — PE/EXE/DLL/MSI: `PE_HELP` 189, `parsePe` 215,
  `readUtf16Value` 386, `parseExe` 415, `extractPeIcon` 458 (exported),
  `parseMsi` 2192. (Largest single cluster.)
- **`prop-fonts.js`** — `AXIS_NAMES` 755, `readNameTable` 764, `readFvarTable`
  796, `sfntTableOffsets` 817, `inflateZlib` 829, `woffTables` 839, `parseFont`
  859, `parseGlif`/`glifContourSegments`/`renderGlifOutline` 582–742,
  `renderFontPreview` 3580.
- **`prop-creative-projects.js`** — DAW/NLE project files: `parseFlp` 914,
  `parseAep`/`parseAepx` 2436/2355, `parseVeg` 2581, `parseDrp` 2624,
  `parseFilmora` 2673, `parseCapcut` 2848 (+ `extractJsonObject` 2748,
  `isCapcutModel` 2770, `buildCapcutFields` 2781), `parseGzipXmlProject` 1594,
  the `harvestPaths`/`asciiRun`/`utf16Safe` helpers 2543–2581.
- **`prop-3d-cad.js`** — `parseStl` 107, `parseGlb` 92, `parseFbx` 79,
  `parseBlender` 63, `parseDwg` 50, STEP family `splitStepArgs`…`parseStepHeader`
  1999–2168 (exported), `parseTextCad` 2168.
- **`prop-archive-db.js`** — `parseRar` 979, `parse7z` 989, `parseZipMeta` 1225,
  `parseSqlite`/`parseSqliteWal`/`parseSqliteShm` 996–1194, `parseVdf` 3715,
  `prettyKV` 3700.
- **`prop-android.js`** — `AXML_KNOWN_ATTRS` 1307, `ANDROID_API` 1319,
  `androidApiLabel` 1326, `parseAxml` 1334, `apkArchiveInfo` 1418,
  `apkDetailsBlock` 1447, `parseApk` 1456.
- **`prop-security.js`** — `parseCert` 2213, `parseX509` 2245, `parseMsi` (or with
  exe).
- **`prop-disk.js`** — `MBR_PART_TYPES` 3355, `fmtGuid` 3362, `parseFatVbr` 3368,
  `parseDiskImage` 3393, `parseIso` 1210.
- **`prop-shell-misc.js`** — `parseLnk` 3255 (+ `LNK_CLSID`/`lnkFiletime`/
  `lnkCStr`/`lnkHotkey` 3229–3255), `parseUrlShortcut` 3325, `parseWebloc` 3339,
  `parseRtf`/`stripRtf` 3512/3536, `parseTorrent` 1674, `parseRec` 3473,
  `parseLogOrigin` 1935, `parseTextVersion` 1576.
- **`prop-gaming.js`** — ULTRAKILL/etc: `UK_*` consts 3043, `summariseBepis`/
  `parseBepis` 3058/3113, `parseCtg` 3172.
- **`prop-media-misc.js`** — `parseEac3` 2903, `parseTrueHd` 2940, `parseCdp` 2958,
  `parseCriterium` 2986, `parseGcode`/`parseGcodePrinting`/`parseGcodeCnc`
  1756–1831, `parsePart`/`guessFromMagic` 2870/2881, `parsePsd` 28, `parseSwf` 123,
  `parseXcf` 1194, `parseOle` 743, `parseXmp` 139.

### How to split safely (the key insight)
Keep **`renderProprietary`, `renderProprietary`'s head-reading logic, and the
`PARSERS` map** in `proprietary.js`; move only the `parseXxx` *bodies* out and
import them back. The `PARSERS` entries (`psd: c => parsePsd(c.head)`) become
`import { parsePsd } from './prop-media-misc.js'`. Because every parser already
has a uniform `(head|file|ext)`-ish call contract via the `c` context object, the
boundary is clean and the dispatch table doubles as the dependency manifest.

Do this **incrementally, one domain file at a time**, re-running `server.bat` and
dropping a sample of each moved format. Start with `prop-exe.js` and
`prop-fonts.js` (largest, most self-contained, already partially exported).

### State/coupling
- Very low. Parsers are stateless pure functions of `(head, file, ext)`. The only
  shared imports are `core/binutil.js`, `core/util.js`, lazy `lib/*` loaders, and
  `proprietary-formats.js` — all already external. `extractPeIcon` and
  `parseStepHeader` are **already exported and imported elsewhere** (check
  importers before moving — they must keep their public path or re-export).
- `proprietary.js` lazy-dispatches `parsers-<domain>.js` chunks (per CLAUDE.md).
  The new `prop-*.js` files should follow the **same lazy `import()` pattern** so
  the giant exe/font/x509 code isn't pulled into the initial chunk for someone
  dropping a `.lnk`. This is the one design decision to get right; it also means
  most `prop-*.js` files do **not** go in SHELL (they cache on first use, like the
  existing `parsers/` chunks).

### Fragile — leave alone
- `parseX509`/`parseCert` (2213–2355) DER walking and `parsePe` import-table walk
  (215–386): dense binary offset math, easy to break, hard to verify without
  samples. Move verbatim, do not refactor internals.
- `parseAxml` (1334) — Android binary-XML decoder; same caution.

---

## 3. photo.js (2870 lines)

### Sub-responsibilities
1. **Undisplayable/RAW banners + fallback** — `undecodableImageBanner` 38,
   `rawUndecodableBanner` 50, `renderUndisplayableImage` 58.
2. **OCR / Tesseract** — `ocrLangPath` 137, `ocrLangDataUrl` 143, `ocrLangCached`
   149, `ocrLangSizeSpan` 163, `sessionOcrLang` 183, `pickOcrLanguage` 188,
   `prepareOcrCanvas` 1006, `ensureTesseract` 1021, `makeOcrCard` 1027. **Holds
   `_sessionOcrLang` module state.**
3. **EXIF / maker-note decode** — `tiffBaseOf` 346, `sonyShutterCount` 381,
   `nikonShutterCount` 444, `readShutterCount` 498, `buildExifSections` 504,
   `detectComputational` 576, `parseDevelopSettings` 615, `buildDevelopCard` 653,
   `detectAI` 691, `buildRawDump` 735, formatters `fmtShutter`/`fmtFNumber`/
   `fmtFocal`/`fmtExpComp` 327–334.
4. **Pixel analysis** — `rgbToHsl` 749, `computeSharpness` 764, `sharpnessLabel`
   781, `detectFocusRegion` 789, `computeColorStats` 818, `computePHash` 837,
   `detectQrCode` 870, `getPixelData` 883, `computeHistogram` 895,
   `renderHistogram` 906, `dominantColors` 954, `toHex` 979.
5. **LSB / steganography planes** — `makeLsbPlane` 1146, `renderLsbPlanes` 1160.
6. **Lightbox + photo-tool overlays** — `ensureLightbox` 1270, `sizeWrap` 1338,
   `computePeaking` 1348, `computeExposureOverlay` 1401, `openLightbox` 1430
   (exported), `hideLightbox` 1528, `closeLightbox` 1535. **Holds lightbox
   module-singleton DOM state.**
7. **Image container peeking** — `pngColourType` 1557, `parsePngContainer` 1561,
   `parseJpegContainer` 1647, `parseGifContainer` 1708, `parseWebpContainer` 1750,
   `parseBmpContainer` 1791, `peekImageContainer` 1810, `formatAiPrompt` 1862,
   `buildContainerCard` 1884.
8. **Frame/animation viewers** — `buildFrameViewerCard` 1935,
   `buildReverseAnimationCard` 2133, `revealPhotoSection` 1918 (exported).
9. **Geo** — `makeMap` 985.
10. **Orchestrator** — `renderPhoto` 2181–2854, `initPhoto` 2855.

### Proposed sub-modules
- **`photo-exif.js`** ← cluster #3 (TIFF base + maker-note shutter counts +
  EXIF section builders + AI/computational detection + develop-settings). Largest
  and most self-contained; `tiffBaseOf` is also reusable.
- **`photo-pixels.js`** ← cluster #4 (sharpness, focus map, colour stats, pHash,
  QR, histogram, dominant colours) + #5 LSB planes. Pure `ImageData` math.
- **`photo-lightbox.js`** ← cluster #6 (lightbox + peaking/zebra overlays).
  Re-export `openLightbox` from here; `video.js` imports `openLightbox` from
  `photo.js` (line 7) so **keep a re-export in photo.js** to preserve that path.
- **`photo-containers.js`** ← cluster #7 (PNG/JPEG/GIF/WEBP/BMP chunk parsers +
  `buildContainerCard`).
- **`photo-ocr.js`** ← cluster #2 (Tesseract lang picking + card). Keep
  `_sessionOcrLang` state inside this module; `pickOcrLanguage`/`sessionOcrLang`
  are exported, so re-export.
- Keep `renderPhoto`, `initPhoto`, banners (#1), frame viewers (#8), `makeMap` in
  `photo.js`.

### State/coupling
- **`photoRenderAbort`** (module AbortController) — same pattern as video; keep in
  `photo.js`, pass `signal` to moved helpers (most already take it).
- **`_sessionOcrLang`** — stays inside `photo-ocr.js`. The exported
  `sessionOcrLang()`/`pickOcrLanguage()` must be re-exported from `photo.js` if
  any other module imports them by that path (verify importers first).
- **Lightbox singleton DOM** (`ensureLightbox` builds a one-time overlay): keep
  all open/hide/close together in `photo-lightbox.js`.
- `renderPhoto` re-enters itself for RAW demosaic mode (`opts.rawMode`) — keep the
  recursion in `photo.js`.
- **Public exports used elsewhere:** `openLightbox`, `revealPhotoSection`,
  `ocrLangPath`, `sessionOcrLang`, `pickOcrLanguage`, plus `renderPhoto` imported
  by `video.js`. All must remain importable from `photo.js` (re-export).
- **SHELL note:** `photo.js` is in SHELL; new statically-imported children must be
  added to SHELL.

### Fragile — leave alone
- `sonyShutterCount`/`nikonShutterCount` (381–498) — encrypted/obfuscated
  maker-note decode with model-specific offsets, documented as verified against
  specific bodies. Move verbatim; never "simplify".
- `renderPhoto`'s RAW fallback ladder (2203–2270): HEIC → X3F → ImageMagick →
  embedded preview → libraw demosaic chain. Intricate ordered fallbacks; relocate
  nothing inside it.

---

## 4. audio.js (1960 lines)

Note: audio is **already the most decomposed** of the four — `audio-analysis.js`,
`audio-codec.js`, `audio-player.js`, `spectrogram.js`, `media-reverse.js` already
exist. The remaining bulk is the spectrogram-panel UI and the orchestrator.

### Sub-responsibilities
1. **Local DSP/util duplicates** — `ctx` 24, `decodeFile` 30, `getMono` 37
   (dup of video/audio-analysis), `describeChannels` 50, `fmtClock` 312 (dup
   formatter), `computeStats` is imported (good) — see §0.
2. **Spectrogram panel (the big one)** — `attachScrub` 63, `renderVectorscope` 93,
   `renderWaveform` 153, `buildFreqAxis` 209, `buildTimeAxis` 236, `loudestMoment`
   252, `specStats` 280, `specStatsHelp` 329, `buildSpecStats` 340, the
   `specIco`/`specCtl`/`specGroup`/`specAdvanced` builders 367–386,
   `makeSpecScrollbar` 386, `specSavePng` 454, `openSpecSaveModal` 467,
   `attachFullscreen` 507, **`makeSpectrogramPanel` 535–983** (exported, ~450
   lines — the single largest function in the file).
3. **Cards** — `tagRow` 984, `buildCoverArtCard` 988, `buildWaveformCard` 1012
   (exported), `buildHistogramCard` 1234 (exported).
4. **Undecodable fallback** — `renderUndecodableAudio` 1291.
5. **Live/record** — `startRecording` 1543, `startLive` 1598.
6. **Orchestrator** — `renderAudio` 1336, `initAudio` 1934.

### Proposed sub-modules
- **`audio-spectrogram-panel.js`** ← cluster #2 (everything `spec*` +
  `makeSpectrogramPanel` + its scrub/scrollbar/fullscreen/save helpers). This is
  the biggest, most cohesive extraction (~900 lines) and it is **almost entirely
  self-contained UI** — it takes `(samples, sampleRate, opts)` and returns a DOM
  node. `makeSpectrogramPanel` is exported and imported by `video.js` (line 6) so
  **re-export it from audio.js** to keep that path. Confusingly distinct from the
  existing `spectrogram.js` (which is the FFT compute layer this panel consumes).
- **`audio-live.js`** ← cluster #5 (`startRecording`, `startLive`). Mic capture +
  live spectrogram loop; cleanly separable.
- **`audio-cards.js`** ← cluster #3 if desired (cover art / waveform / histogram
  cards). Lower priority — they're already export-shaped.
- Keep `renderAudio`, `initAudio`, `decodeFile`/`ctx`/`describeChannels`,
  `renderUndecodableAudio` in `audio.js`.

### State/coupling
- **`audioCtx` module singleton** (23) shared by `ctx()`, `decodeFile`,
  `startLive`. Keep `ctx()` in `audio.js` and have `audio-live.js` import it (or
  pass it in). Don't duplicate the AudioContext.
- `audioRenderAbort` — same abort pattern; keep in `audio.js`.
- **Public exports:** `makeSpectrogramPanel`, `buildWaveformCard`,
  `buildHistogramCard`, `makePlayer` (re-export of audio-player), and `renderAudio`
  are imported by `video.js`. All must remain importable from `audio.js`.
- **SHELL note:** add any new statically-imported child to SHELL.

### Fragile — leave alone
- `makeSpectrogramPanel`'s internal canvas-tiling / scroll-virtualisation and the
  fullscreen/scrollbar wiring — lots of pixel-math and event listeners with
  implicit ordering. Move the **whole function and its private helpers as one
  unit**; do not split the panel internally.

---

## Ranked recommendation (value vs risk)

**Tier 1 — do first (high value, near-zero risk, no behaviour change):**
1. §0 dedup of `fmtDate`, `gcd`/`aspectRatio`, `getMono`, `computeStats`,
   duration formatters → import the canonical ones. Pure deletion of shadows.
2. §0 `downloadBlob(blob, name)` helper in `util.js`; migrate the ~100 identical
   blob-download idioms opportunistically.
3. **`core/isobmff.js`** (box walkers) — unblocks clean cuts in both `video.js`
   and `video-pcm`, and is reusable by any future MP4-adjacent renderer.

**Tier 2 — high value, low risk (independent, registry/contract-driven):**
4. **proprietary.js → `prop-*.js` domain files**, one at a time, driven by the
   `PARSERS` table. Start `prop-exe.js`, `prop-fonts.js`. Lowest coupling of all
   four; biggest line reduction. Keep lazy `import()` semantics.
5. **audio.js → `audio-spectrogram-panel.js`** and **`audio-live.js`**. Cohesive,
   mostly self-contained UI; re-export `makeSpectrogramPanel`.

**Tier 3 — good value, moderate care (shared module state to relocate):**
6. **video.js → `video-ffmpeg.js`** (must move FFmpeg singleton + loader overlay
   as one unit) and **`video-raw-h26x.js`** (depends on it).
7. **video.js → `video-container.js`** + **`video-pcm.js`** (on top of
   `core/isobmff.js`).
8. **photo.js → `photo-exif.js`, `photo-pixels.js`, `photo-containers.js`,
   `photo-lightbox.js`, `photo-ocr.js`** — straightforward but several public
   re-exports (`openLightbox`, OCR fns) must be preserved.

**Tier 4 — optional polish:**
9. `audio-cards.js`, `video-cards.js`, shared `scratchCanvas` helper. Only if the
   parent file is still uncomfortably large after Tiers 1–3.

### Global guardrails (apply to every extraction)
- **Re-export every currently-exported symbol from its original module path.**
  Cross-renderer imports (`renderPhoto`, `openLightbox`, `makeSpectrogramPanel`,
  `makePlayer`, `extractPeIcon`, `parseStepHeader`, `revealPhotoSection`, OCR
  fns) must not break — verify each importer before moving.
- **Update `sw.js` `SHELL`** for any *statically*-imported new module under a
  SHELL renderer; leave lazily `import()`-ed `prop-*.js` chunks out of SHELL (they
  cache on first use, matching the existing `parsers/` pattern).
- Keep all four `render*`/`init*` orchestrators **in their original files** — they
  are the abort-state owners and the riskiest code; the wins come from lifting the
  helper clusters out from under them.
- No tests exist: validate each move by `server.bat` + dropping a representative
  file per moved domain before the next move.
