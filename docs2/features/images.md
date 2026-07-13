# Images (photos, RAW, multi-image, recovery)

Everything you can do after dropping a still image: the metadata readout, histogram
and dominant colours, OCR, QR detection, computational-photo detection, image ->
sound (sonify), multi-image extraction (ICO/MPO/TIFF), HEIC/RAW conversion, and
broken-still recovery. Renderers: `photo.js` (+ `photo-convert.js`,
`photo-recover.js`), `sonify.js`, `tiff.js`, `mpo.js`, `ico.js`,
`embedded-images.js`. Reached by dropping any `PHOTO_EXTS` / `RAW_EXTS` file (see
`web/assets/js/core/formats.js`); routed via `kind: 'photo'`.

### Metadata and camera readout

**What it does.** Shows file info (size, MIME, dimensions, aspect ratio,
megapixels) plus full EXIF/GPS/camera settings, lens data, capture time and any
copyright.

**How to reach it.** Automatic on any photo drop; built in `photo.js`. Metadata for
photos comes from `exifr` (loaded on demand via `ensureExifr()` in `app.js`).

**How to use it.** Read the readout table; a GPS location links out to a map lookup.
Camera-RAW files additionally recover the Sony/Nikon shutter actuation count and the
true sensor resolution. Time anomalies (inconsistent timestamps) are flagged.

### Histogram and dominant colours

**What it does.** Draws an RGB/luminance histogram and a quantised dominant-colour
palette from the decoded pixels.

**How to reach it.** Automatic on a photo drop (into the Photo section);
`computeHistogram`/`renderHistogram` and the colour-quantisation code in `photo.js`.
For HEIC/RAW the analysis runs on the converted preview pixels.

### Zoom / lightbox

**What it does.** Click the preview to open a full-screen lightbox with zoom and pan.

**How to reach it.** Click the image; `openLightbox` + `attachZoomPan` in `photo.js`.

### OCR - extract text

**What it does.** Recognises text in the image on-device with Tesseract, with a
language picker.

**How to reach it.** The "OCR - Extract text" disclosure -> the **Extract text**
button (`photo.js`). PDF page-OCR shares the same picker.

**How to use it.** Click **Extract text**, choose a language in the modal picker
(the **?** button explains OCR and its caveats), then **Run OCR**. Recognised text
appears in a copyable block.

**Notes / limits.** Only English (`eng`) is bundled and works fully offline; other
languages download their trained data on first use (cached by the service worker
after that). Requires the Tesseract WASM (in the Everything offline tier).

### QR-code detection

**What it does.** Detects and decodes a QR code in the image.

**How to reach it.** Automatic when a photo is analysed; `jsQR` (vendored) in
`photo.js`. The decoded payload is surfaced (and, being a URL/text, feeds the OSINT
card where relevant - see `docs2/features/cross-cutting.md`).

### Computational-photo detection

**What it does.** Flags wrappers that pack motion or HDR alongside the still: Apple
Live Photo, Google/Samsung Motion Photo, Ultra HDR gain maps, ProRAW and depth maps.

**How to reach it.** Automatic; detected from EXIF and the file structure in
`photo.js`. When a still carries an appended motion clip (Motion Photo / exported
Live Photo), the embedded MP4/MOV is located and offered for playback.

### Sonify (image -> sound)

**What it does.** Reads the picture as a spectrogram and resynthesises audio from it
- the inverse of the spectrogram view.

**How to reach it.** The "Sonify image" card -> **Sonify (play as spectrogram)**
button on a photo (`photo.js`), which lazy-imports `sonify.js`.

**How to use it.** Two display modes: **Arbitrary image** (any picture) or **Real
spectrogram** (decode a spectrogram plot back to magnitudes). Two synthesis methods:
**Oscillator bank** (one sine per pitch row - robust on any picture) or
**Griffin-Lim** (reconstruct a waveform whose spectrogram matches the image - more
faithful for real spectrograms, heavier). Controls include channel, invert, gamma
(brightness->amplitude), analysis window (Hann/Rect), GL iterations, and - in real-
spectrogram mode - the source colour map and a dB-scale toggle. Preview updates
live; play the result and download it.

### Multi-image extraction (ICO / MPO / multi-page TIFF)

**What it does.** Pulls every embedded picture out of a single file: all sizes in an
ICO/CUR, both halves of an MPO stereo pair, every page of a multi-page TIFF.

**How to reach it.** Automatic for `.ico`/`.cur` (`ico.js`), `.mpo` (`mpo.js`) and
multi-page `.tiff` (`tiff.js`) - all render a shared "Embedded images" card
(`embedded-images.js`) with per-image **Analyse** / **Download** actions.

### HEIC / RAW conversion

**What it does.** Decodes formats the browser can't (HEIC/HEIF, camera RAW) so the
pixels can be shown and analysed, and offers a JPEG/PNG download.

**How to reach it.** Automatic when a HEIC/HEIF (`HEIC_EXTS`) or RAW (`RAW_EXTS`)
file is dropped; `photo-convert.js` (heic2any for HEIC, ImageMagick/LibRaw WASM for
RAW). The **Download photo (JPEG)** button downloads the converted image.

**How to use it.** The developed image appears in the Photo section; RAW develops
the sensor to a full-resolution image, or extracts the embedded preview when a true
demosaic is not available. A RAW dropped alongside its `.xmp` sidecar applies the
develop settings.

**Notes / limits.** HEIC needs `heic2any`; RAW needs ImageMagick + LibRaw (in the
Essentials offline tier). Some long-tail RAW shows the embedded preview rather than a
full demosaic.

### Broken-still recovery

**What it does.** Salvages truncated/corrupt stills. The stills twin of
`video-recover.js`.

**How to reach it.** Runs from `photo-recover.js` (invoked by `photo.js` and by the
`unknown.js` hex view via `carveImages`/`repairJpeg`) when a still fails to decode.

**How to use it.** Options, depending on the damage:

- **Repair a truncated/damaged JPEG or PNG** - the decodable part is shown, cut-off
  regions blank; **Download recovered image** / **Run full analysis** on the result.
- **Rebuild a damaged JPEG header from a reference** - **Choose reference photo…**
  from the same camera to borrow a valid header.
- **Carve embedded images out of a blob** - each carved image gets **Analyse** /
  **Download**.

**Notes / limits.** Recovery is best-effort; unrecoverable regions render blank.
