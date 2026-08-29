# Images

Everything the site does with still images: EXIF/metadata readout,
histogram and colour analysis, OCR, GPS mapping, HEIC/RAW conversion,
broken-image recovery, multi-image container extraction (ICO/MPO/TIFF), and
the image-to-sound "sonify" tool. Written for anyone using the photo
analysis features, and for engineers extending them. Source: `photo.js`,
`photo-convert.js`, `photo-recover.js`, `sonify.js`, `tiff.js`, `mpo.js`,
`ico.js`, `embedded-images.js`.

### Photo metadata readout

**What it does.** Drop a photo and Analyser shows file info (size, MIME,
dimensions, exact aspect ratio, megapixels, an "≈3:2"-style common-ratio
label), then every EXIF/IPTC/XMP/ICC field the file carries, grouped into
Camera & lens, Exposure, Date/time, Image, Privacy and ICC profile
sections. **Privacy** reports the identifying metadata the file carries
(GPS, camera/lens serials, owner, unique IDs); it replaced the old
Description (IPTC/XMP) block and used to live in the Advanced card.
Stripping it is the **Remove metadata** control on the same card
(`scrub.js`), which losslessly rebuilds the file with its metadata segments
removed - pixels and colour profile untouched.

**How to reach it.** Drop any recognised photo extension (JPEG, PNG, HEIC,
RAW, etc.) - the metadata table appears automatically in the Photo section.
Built in `web/assets/js/renderers/photo.js` via `buildExifSections()`, using
the vendored **exifr** library.

**How to use it.** No interaction needed - it's a straight readout. Where a
camera records the lifetime shutter-actuation count (Sony's encrypted
maker-note tag, decrypted with Sony's own substitution cipher; Nikon's
plaintext tag 0x00A7), it's surfaced under "Shutter count". Computational-
photography wrappers are separately detected and called out: Apple ProRAW,
Live Photo, Google/Samsung Motion Photo, Ultra HDR gain maps, and depth
maps.

**Notes / limits.** exifr metadata parsing runs locally; nothing is
uploaded. Sony shutter-count decryption is verified against an ILCE-6400A
and a NEX-6; other modern Alpha bodies should resolve the same way but
aren't individually tested. Nikon shutter-count reading is structurally
validated but not yet confirmed against a real Nikon sample.

### RGB histogram and dominant colours

**What it does.** A per-channel (R/G/B) tonal-distribution histogram
(0 = black, 255 = white) and an 8-swatch dominant-colour palette via colour
quantisation, both computed from a canvas read of the decoded image.

**How to reach it.** Automatic for any decodable photo - appears as the
"RGB histogram" card and a colour swatch row. Built in `photo.js`
(`getPixelData`, `dominantColors`).

**How to use it.** Click the histogram to enlarge it. The dominant-colour
palette renders as a row of click-to-copy swatches:

```demo
swatch: #2b2b2b
swatch: #c8b0a0
swatch: #7a5c3e
swatch: #d8d2c4
swatch: #4d6b7a
swatch: #a83e2c
swatch: #e6c95a
swatch: #6f7f5c
```

### GPS map

**What it does.** If the photo's EXIF carries GPS coordinates, plots the
location on an interactive OpenStreetMap tile map with a marker.

**How to reach it.** Automatic when GPS EXIF is present - a map appears in
the photo section's meta sidebar. Built in `photo.js`'s `makeMap()`.

**Notes / limits.** Lazy-loads **Leaflet** (JS + CSS) only when GPS data
exists, so a GPS-less photo never pays for the map library.

### OCR (text extraction)

**What it does.** Scans the image for text using an on-device OCR engine
and lists the recognised words/lines with confidence filtering.

**How to reach it.** Click **Extract text** in the photo section. Built in
`photo.js` around the vendored **Tesseract.js**.

**How to use it.** Clicking Extract text opens a language-picker dialog
(`pickOcrLanguage()`): pick from 32 languages (English is bundled and works
offline; every other language streams from a CDN on first use, then is
cached by the service worker - each entry shows its download size until
cached). Tick "Remember for this session" to skip the picker on subsequent
OCR runs in the same page load. The "?" button swaps in an explanation of
how Tesseract works and its limitations. Confirm with **Run OCR**, or
**Cancel**/Escape/backdrop-click to abort.

```demo
btn: Extract text
```

The language-picker dialog confirms with its own pair of buttons:

```demo
btn cta: Run OCR
btn: Cancel
```

**Notes / limits.** Tesseract is designed for scanned documents - clean text
on plain backgrounds. On ordinary photos it can hallucinate text from
textures, foliage or noise; handwriting, stylised fonts, low contrast, and
rotated/curved text all reduce accuracy. Best results: screenshots, signs,
printed labels, document photos. Words under 60% confidence are filtered
out.

### Barcode / QR detection

**What it does.** Automatically scans every decoded photo for 1D and 2D
codes - QR, Data Matrix, Aztec, PDF417, EAN/UPC, Code 128/39/93, ITF and
more - and shows a card listing each decoded value (with a clickable link
when it's a URL).

**How to reach it.** Automatic - no button, runs on every photo. Built in
`photo.js`'s `detectCodes()`: the browser's native **BarcodeDetector**
(Chromium/Android, many formats) with the lazy-loaded vendored **jsQR** as a
QR fallback for browsers without it.

**Notes / limits.** Silent when no code is found (the card is simply never
shown). Firefox/Safari desktop lack BarcodeDetector, so there only QR codes
are read (via jsQR).

### Advanced forensics (integrity, ELA, quantization fingerprint, JPEG ghosts, steganalysis, edit history)

**What it does.** A collapsible **Advanced** card (where LSB analysis used
to sit) groups the deeper forensic and technical views, each as a flat part:

- **Integrity**: the **pHash** (perceptual fingerprint - alike pictures get
  alike fingerprints, so it spots duplicates across a resize or re-save) and
  the **SHA-256** of the exact file bytes. This used to be a card of its own
  above Advanced; it still is on [`/compare`](../pages.md), where the merge
  hoists "Integrity" to the top of the side-by-side view by its heading. The
  part carries `[data-integrity]` so `forensics.js`'s `findIntegrityCard()`
  still finds it and `app.js` does not append a second, generic one.
- **Forensics** (JPEG only): **Error-level analysis** (re-save + amplified
  difference, with quality/amplify sliders and a lightbox), the
  **quantization-table fingerprint** (effective quality recovered from the
  DQT tables, a standard-vs-custom-tables verdict cross-referenced against
  the claimed software, and the luminance table drawn as a grid), and
  **JPEG ghosts** (an on-demand recompression sweep whose maps expose a
  region spliced in from a differently-compressed source).
- **Edit history**: the XMP `xmpMM:History` timeline (Lightroom/Photoshop
  action log) plus the Photoshop **IPTC-digest** check that flags when the
  caption/keyword block was changed after Photoshop last saved the file.
- **LSB analysis**: a chi-square (Westfeld-Pfitzmann) estimate of the
  likelihood that least-significant-bit data has been embedded, plus a
  browser for all eight bit planes (0 = LSB to 7 = MSB) per channel.

**How to reach it.** Automatic - expand the Advanced card, which shows every
forensic read as a flat part (the card is the only dropdown). The forensic
maths lives in `photo-forensics.js`; ELA and the LSB bit planes compute lazily
the first time the card is expanded, not on load. Also derived-and-shown in the **Metadata**
card: an **Optics** section (field of view, hyperfocal, depth of field, and
exposure value at ISO 100 with a lighting label + a brightness-sanity note).

**Notes / limits.** None of these is proof on its own - they are read
together and alongside the metadata/thumbnail/timestamp checks. ELA, ghosts
and the quantization fingerprint are JPEG-only.

### HEIC/HEIF and camera-RAW conversion

**What it does.** Browsers can't decode HEIC/HEIF or most camera RAW
formats directly, so Analyser converts them to a displayable form before
running the normal photo analysis.

**How to reach it.** Automatic - drop a `.heic`/`.heif` or a RAW extension
(`.arw`, `.cr2`, `.cr3`, `.nef`, `.dng`, `.raf`, `.rw2`, `.orf`, `.pef`,
`.sr2`, `.srw`, `.x3f`, and other long-tail RAW formats). Implemented in
`photo-convert.js`, called from `photo.js`.

**How to use it.** For HEIC, `convertHeic()` uses the vendored **heic2any**.
For RAW, the fast path (`extractRawPreview`/`extractRawJpegs`) pulls the
embedded JPEG preview most RAW files carry (no real decode needed); when
that's unavailable or a full-quality render is wanted, click **Demosaic RAW
(full decode)** to load the heavyweight **ImageMagick-WASM**
(`convertWithImageMagick`/`demosaicRaw`) fallback for genuine sensor
demosaicing. `.x3f` (Sigma Foveon) has its own dedicated preview extractor
(`extractX3fPreview`).

```demo
btn: Demosaic RAW (full decode)
```

**Notes / limits.** The embedded-preview fast path is what's shown by
default for RAW files - it's the camera's own JPEG preview, not a full
sensor reconstruction, so it may not exactly match what a dedicated RAW
developer produces. Demosaic RAW downloads ImageMagick's WASM build
(~15 MB) only on click.

### Broken/truncated/corrupt image recovery

**What it does.** When a recognised image fails to decode, Analyser
diagnoses the damage and offers to salvage the maximum recoverable picture
plus a downloadable repaired file, rather than a dead-end error.

**How to reach it.** Automatic - triggers when a JPEG/PNG/HEIF/AVIF (or an
unrecognised blob) won't decode. Built in `photo-recover.js`
(`diagnoseImage`, `repairJpeg`, `repairPng`, `decodePngPartial`,
`repairHeifContainer`, `carveImages`), orchestrated by `photo.js`'s
`renderPhotoRecovery()`.

**How to use it.** The "Broken image - salvage" card shows the detected
real format (from signature bytes, regardless of extension) and what's
wrong. Strategy by format:

- **JPEG** - strips junk before the SOI marker and appends a missing EOI if
  the file is simply truncated; if the *header* itself (quantisation/Huffman
  tables) is damaged, prompts to **Choose reference photo...** - a healthy
  JPEG shot on the same camera/mode - and rebuilds the damaged header by
  borrowing its tables (`extractJpegTables`/`spliceJpegHeader`), so the scan
  data can then decode.
- **PNG** - recovers as many image rows as possible
  (`decodePngPartial`/`repairPng`) and re-encodes them as a clean PNG; any
  unrecovered rows are blank.
- **HEIF/HEIC/AVIF** - these formats store metadata at the front, so a
  tail-truncated file often keeps a decodable image once the oversized
  `mdat` box is clamped to the real file length (`repairHeifContainer`);
  HEIC output is then converted to JPEG via `convertHeic`.
- **Unrecognised blob / wrong extension / disk fragment** - carves every
  embedded image signature out of the data (`carveImages`) and shows each as
  a thumbnail grid.

Every recovered/carved result gets **Run full analysis** (re-runs the full
photo pipeline on the salvaged picture) and **Download recovered image** (or
per-item **Analyse**/**Download** for carved fragments).

```demo
card: Broken image - salvage
  text: Detected **JPEG** (from signature bytes) - truncated, missing EOI marker. Salvaged the recoverable region.
  btn cta: Run full analysis
  btn: Download recovered image
```

**Notes / limits.** Recovery is best-effort: a cut-off region shows as
blank rather than being invented. If nothing can be salvaged, the card
explains why rather than showing nothing.

### Live Photo / Motion Photo playback

**What it does.** Apple Live Photos, Google Motion Photo, and Samsung
Motion Photo append a whole MP4/QuickTime clip after the still picture. The
browser only paints the still - this locates the appended clip and plays it
through the real video + audio renderers on demand.

**How to reach it.** A hidden **Analyse live photo** button appears beside
the photo preview only if a trailing clip is detected (`detectLiveVideo()`
in `photo.js`, checking XMP `MicroVideoOffset`/`Container:Directory` tags
first, then a full ISO-BMFF box scan gated on marker text).

**How to use it.** Click **Analyse live photo**; it carves the trailer
(via `file.slice`, no full in-memory copy) and renders it through the real
video player plus, if the clip has a decodable audio track, the full audio
analyser underneath.

```demo
btn: Analyse live photo
```

**Notes / limits.** Detection distinguishes Google Motion Photo, Samsung
Motion Photo, and Apple Live Photo by their respective markers/MIME hints.

### RAW develop-settings sidecar (.xmp) import

**What it does.** Reads a `.xmp` sidecar's non-destructive edit recipe
(exposure, contrast, highlights, white balance, camera profile, and more -
Adobe's Camera Raw Settings namespace) and shows it alongside the RAW photo.

**How to reach it.** Click **Import XMP settings** next to a RAW photo's
analysis, then pick the `.xmp` file. Built in `photo.js`'s
`parseDevelopSettings()`.

```demo
btn: Import XMP settings
```

### Animated image frame stepping (GIF/WebP)

**What it does.** For animated GIF/WebP dropped as a photo, steps through
frame-by-frame, analyses any single frame as a standalone photo, builds a
thumbnail contact sheet of every frame, and can reverse the whole animation.

**How to reach it.** Drop an animated GIF or WebP. Frame decoding is
`gif-frames.js` (hand-rolled LZW decoder)/`webp-frames.js` (browser
`ImageDecoder`/WebCodecs); re-encoding for the reverse feature is
`gif-encode.js`.

**How to use it.** **Prev/Next** step through frames; **Analyse frame** runs
the current frame through the full photo pipeline; **Generate contact
sheet** (shown once there are 8+ frames) builds a thumbnail grid; **Reverse**
plays/downloads the animation backwards (**Download reversed** for GIF).

```demo
btn: Prev
btn: Next
btn: Analyse frame
btn: Generate contact sheet
btn: Reverse
btn: Download reversed
```

### Sonify (image to sound)

**What it does.** Turns any picture into audio by reading it as a
spectrogram: x = time, y = frequency, brightness = loudness. The inverse of
the audio module's spectrogram view.

**How to reach it.** Click **Sonify (play as spectrogram)** on a photo (also
reachable from a video frame - see [`video.md`](video.md)). Implemented in
`sonify.js`, lazy-imported by `photo.js`.

**How to use it.** Two synthesis engines: **Oscillator bank** (one sine
tone per frequency row, robust on any picture, the default) or **Griffin-Lim**
(iteratively refines phase to better match a genuine spectrogram image, more
faithful but heavier). Controls: Mode (arbitrary image vs. a real
spectrogram plot), Invert (bright=loud vs. dark=loud), Axis (log/linear
frequency spacing), Min/Max frequency, Length (click the readout to type an
exact value past the slider's range), and an Advanced panel (sample rate,
FFT size, window function, Griffin-Lim iteration count, gamma brightness
curve, left/right channel source for stereo, colourmap decoding and dB
scale for real-spectrogram mode). The source image preview updates live as
controls change. Click **Render** to synthesise the result and run it through
the site's full Sound analysis (waveform, spectrogram, LUFS, etc. - see
[`audio.md`](audio.md)). It never starts playing on its own - press play on
the player it builds; **Download WAV** saves the rendered audio. Clicking
the source-image preview seeks the audio to that point (and the reverse:
playback drives an accent-coloured playhead over the image).

The tool is reached from a button beside the photo, and its Axis control is a
segmented toggle (the selected option carries the accent fill):

```demo
btn: Sonify (play as spectrogram)
```

```demo
btn active: Log
btn: Linear
```

```demo
btn cta: Render
btn: Download WAV
```

**Notes / limits.** Purely on-device Web Audio synthesis; no libraries
beyond the site's own hand-written FFT (shared with `spectrogram.js`).

### Multi-image container extraction (ICO, MPO, multi-page TIFF) and embedded thumbnails

**What it does.** Several still-image formats pack more than one picture
into a single file - an ICO's size ladder, an MPO stereo/multi-angle pair,
a scanned multi-page TIFF - but a browser `<img>` only ever paints one. Each
format gets its own pure-parsing extractor that hands its images to a
shared "Embedded images" display card. Separately, nearly every ordinary
camera still also caches a smaller JPEG copy of itself in its metadata (an
EXIF/IFD1 thumbnail; a RAW packs a full preview plus a screen thumbnail);
these are pulled out too and shown in an "Embedded thumbnails" card.

**How to reach it.** Automatic - drop a `.ico`/`.cur` (`ico.js`), a `.mpo`
stereo/multi-picture JPEG (`mpo.js`), or a multi-page `.tif`/`.tiff`
(`tiff.js`, which only spins up ImageMagick to render pages when there
genuinely are 2+ pages - a single-page TIFF shows nothing extra). The
embedded-thumbnail extraction runs on every photo (`photo.js` calls
`extractRawJpegs`, which walks the TIFF/EXIF IFDs of a RAW or an ordinary
JPEG and returns just the thumbnails/previews those IFDs reference, never
the main image); the card appears only when there's at least one.

**How to use it.** Every extracted image, on a transparency checkerboard,
gets its size/format/byte-count caption, a **Download** button, and (when
wired into the main results container) an **Analyse** button that re-runs
the full photo pipeline on that one extracted image.

```demo
btn: Analyse
btn: Download
```

**Orientation.** An extracted thumbnail or preview is a *bare* JPEG - the
carved bytes carry no metadata of their own, so a browser paints them in
stored order, which is sideways for anything shot in portrait even while
the main photo above sits upright (the browser rotates that one from its
own EXIF). `extractRawJpegs` therefore also reads the Orientation tag
(0x0112) of the IFD that pointed at each JPEG, falling back to IFD0's -
most cameras record the rotation once, against the main image, and store
the thumbnail in that same physical orientation. `embedded-images.js`
repaints the picture through a canvas so it shows the right way up, and
captions it "stored rotated 90 degrees, shown upright". The **stated
dimensions stay as stored** (that pairing is the finding), and the
**Download stays byte-identical** to what was carved out - the correction
is display-only.

**Notes / limits.** ICO extraction rebuilds a minimal single-image icon
blob per directory entry so the browser's native decoder paints exactly
that entry (PNG-compressed and classic BMP/DIB alike, with transparency);
pure parsing, no WASM, instant and offline. MPO reads the CIPA
Multi-Picture Format (MPF) index in the JPEG's APP2 segment. Multi-page
TIFF first walks the IFD chain in pure JS just to learn the page count and
size (cheap, no decode) before deciding whether ImageMagick rendering is
worth it.

### Sketch component tree (.sketch)

**What it does.** Opens a Sketch document and reads the design out of it. A
`.sketch` is a ZIP of JSON - `meta.json`, `document.json` and one
`pages/<uuid>.json` per page - so nothing has to be inferred. You get a
browsable component tree of every page, artboard, group and layer with its
type, child count and size in points; a **Components** table pairing each
symbol master with the number of instances referencing it; every string in
the document in one list with the page it sits on; the bitmaps placed into
the design; and the preview Sketch saves inside the package.

**How to reach it.** Drop a `.sketch`. Built in `sketch.js`.

**Notes / limits.** The tree is stored back to front - a group's first child
sits behind the ones after it - and it is shown in that order rather than
reversed, because that is the document's own order. Nothing is rendered from
the vector data; the picture shown is the one Sketch itself saved. The walk
stops at `SKETCH_LAYER_MAX` (50,000 objects) and says so, since a design
system file can hold far more than a browser will lay out. Instance counts
are why the components table is worth having: a master with none is one
nothing uses.

**Figma is not the same story.** A `.fig` is a Kiwi message, and Kiwi keeps
no field names in the data - they live in a schema that Figma ships as the
first chunk of the file and changes with the app version. There is therefore
no stable node tree to walk, so `parsers-image.js` reads out what the
container declares (format, Kiwi version, chunk count and sizes, or the ZIP
variant that "Save local copy" produces) and stops there rather than
guessing.

### GIMP layer compositing (.xcf)

**What it does.** A GIMP file stores no flattened image at all - unlike a
PSD, an XCF is only its layer stack - so showing the picture means building
it. Analyser decodes each layer's 64x64 tiles (uncompressed, RLE or zlib),
applies that layer's mask, opacity and blend mode, and paints the stack from
the bottom up. The composite can be saved as a PNG, and the full layer list
is shown with each layer's mode, opacity, size, offset and mask.

**How to reach it.** Drop a `.xcf`. Built in `xcf.js`.

**Notes / limits.** 8-bit precision only; GIMP 2.10 can also store 16- and
32-bit integer and float channels, and those files are described rather than
drawn. The four non-separable blend modes (hue, saturation, colour, value)
are named on the layer row but composited as Normal. Pointers are 32-bit
below XCF v11 and 64-bit from v11 - the single easiest thing to get wrong
when reading one of these.

### Aseprite pixel-art sprites (.aseprite / .ase)

**What it does.** Opens Aseprite and LibreSprite sprites: every frame is
composited from the layer stack and the animation plays at the file's own
per-frame durations rather than one frame rate. Shows the layer tree with
blend mode, opacity and visibility, and the named animation tags with their
loop direction; any frame saves as a PNG.

**How to reach it.** Drop a `.aseprite` or `.ase`. Built in `aseprite.js`.

**Notes / limits.** Frames store only the cels that changed, plus links back
to earlier frames, so a frame is assembled rather than read. RGBA, grayscale
and indexed sprites are all decoded; tilemap cels are skipped rather than
drawn wrong. `.ase` is shared with Adobe Swatch Exchange, an unrelated
palette format, so the two are told apart by magic number before routing.

### iOS CgBI PNG repair

**What it does.** Xcode rewrites every PNG shipped inside an `.ipa` into
Apple's private CgBI variant, which **no browser can decode**: the IDAT
stream is raw deflate with the zlib wrapper stripped, the pixels are BGRA
with premultiplied alpha, and the CRCs are left wrong. Analyser detects one
and rebuilds it into a real PNG, so it displays like any other image.

**How to reach it.** Automatic, wherever an image is analysed - dropped
directly, clicked inside a browsed `.ipa` or ZIP, or on `/compare`. Built in
`lib/cgbi.js`, applied at the top of `renderPhoto()`.

**Notes / limits.** Interlaced (Adam7) CgBI files are declined rather than
guessed at, since Xcode does not produce them. This is why "repair the CRC"
advice never works on these: the bytes underneath are a different encoding,
not a corrupted PNG.

### GPU texture previews (VTF, KTX, KTX2, DDS)

**What it does.** Block-compressed GPU textures are decoded to a real
picture rather than a header readout: Valve's VTF (Source engine), the
Khronos KTX and KTX2 containers, and DDS all share one BC1-BC5 / DXT decoder.

**How to reach it.** Drop a `.vtf`, `.ktx`, `.ktx2` or `.dds`, or click one
inside a browsed game archive. Built in `lib/bcn.js` with the container
parsers in `parsers-gaming.js` and `parsers-image.js`.

**Notes / limits.** BC6H and BC7 need a much larger mode table and are named
rather than drawn, as is KTX2's BasisLZ supercompression (a transcode, not a
decompression). KTX2 with no supercompression, or with ZLIB or Zstandard, is
decoded. A VTF stores its mipmaps smallest-first, so the full-size image is
at the end of the file - after the low-res thumbnail and every smaller level.

### Browser-undecodable image formats

**What it does.** For image formats no browser can decode (JPEG XL, TIFF,
JPEG 2000, TGA, OpenEXR, Radiance HDR, PCX, SGI, Sun Raster, CorelDRAW, WMF/EMF, farbfeld, and PSD/PSB when not otherwise handled),
Analyser shows a clear "browser limitation" banner plus whatever
EXIF/IPTC/XMP/ICC metadata exifr can still read from the raw bytes, rather
than a bare decode error.

**How to reach it.** Automatic - triggers when the browser's `<img>` fails
to decode a recognised-but-undisplayable extension. Built in `photo.js`'s
`renderUndisplayableImage()`/`undecodableImageBanner()`.

**Notes / limits.** The file itself is not necessarily broken - converting
it to PNG/JPEG with an external tool usually makes it viewable.
