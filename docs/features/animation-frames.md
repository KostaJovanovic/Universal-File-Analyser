# Animation and frames

GIF/WebP frame-by-frame tooling and Lottie/dotLottie/Telegram-sticker vector
animation playback. Source: `gif-frames.js`, `gif-encode.js`,
`webp-frames.js`, `lottie.js`.

### GIF frame decoding

**What it does.** A browser plays an animated GIF in an `<img>` but won't
let you step through it frame by frame, so Analyser decodes the GIF itself:
parses the blocks, LZW-decompresses each image, and composites it onto a
persistent canvas honouring the per-frame disposal method, transparency, and
interlacing. Returns one fully-composited RGBA snapshot per frame plus its
own delay.

**How to reach it.** Automatic - drop an animated `.gif`, or it's used
internally by `photo.js` to power the frame stepper/reverse features
documented in [`images.md`](images.md) (Prev/Next frame, Analyse frame,
Generate contact sheet, Reverse, Download reversed).

**Notes / limits.** Pure logic (`decodeGifFrames()`), no DOM, no
cross-module dependencies - the UI controls that consume it live in
`photo.js`.

### GIF re-encoding

**What it does.** A compact, dependency-free GIF writer: per-frame
median-cut colour quantisation to a 256-colour local palette (with 1-bit
transparency where a frame has alpha) and a standard GIF-variant LZW
encoder, whose output the decoder above can read back.

**How to reach it.** Used internally by the reverse-animated-GIF feature in
`photo.js` (see "Animated image frame stepping" in
[`images.md`](images.md)) - there is no direct UI entry point in this
module itself.

**Notes / limits.** `encodeAnimatedGif()` is pure logic, no DOM.

### WebP frame decoding

**What it does.** Same problem as GIF (no native step-through), different
solution: WebP frames are VP8/VP8L bitstreams too heavy to decode by hand in
JS, so this leans on the browser's own `ImageDecoder` (WebCodecs API),
returning one fully-composited `VideoFrame` per animation frame (honouring
disposal, blending, and frame offsets), drawn to a canvas and read back as
RGBA - the same per-frame snapshot shape the GIF decoder produces, so
`photo.js` can build an identical transport for either format.

**How to reach it.** Automatic - drop an animated `.webp`; powers the same
frame-stepper/reverse controls in `photo.js` as GIF.

**Notes / limits.** Depends on the browser supporting WebCodecs'
`ImageDecoder`; where unsupported, animated WebP falls back to whatever the
browser's native `<img>` shows (first frame only).

### Lottie / Bodymovin / dotLottie / Telegram sticker playback

**What it does.** Plays JSON vector animations (Lottie/Bodymovin exports)
live, with a timeline scrubber, play/pause, speed and loop controls, plus
the animation's metadata (name, Bodymovin version, dimensions, frame rate,
frame count, duration, layer count, asset count).

**How to reach it.** Drop a `.json` Lottie file, a `.lottie` (dotLottie -
a ZIP containing `animations/<id>.json` plus a manifest), or a `.tgs`
(Telegram sticker - gzip-compressed Lottie JSON). Built in `lottie.js`
around the vendored **lottie-web** engine, lazy-loaded on first use and
cached for offline. A plain `.json` file that looks like Lottie (detected by
`isLottie()` - has `v`, numeric `fr`, numeric `op`, and a `layers` array) is
also offered a "▶ Play as Lottie animation" option from the generic JSON
inspector (`unknown.js`/`dataview.js`) without needing the `.lottie`/`.tgs`
extension.

**How to use it.** **Pause/Play** toggles playback; the range slider scrubs
to any frame; the **speed** dropdown picks 0.25x-2x; **Loop** toggles
looping (on by default).

**Notes / limits.** Renders via SVG (`renderer: 'svg'` in `lottie.loadAnimation`).
A malformed or non-Lottie file degrades to an error card rather than
failing silently.
