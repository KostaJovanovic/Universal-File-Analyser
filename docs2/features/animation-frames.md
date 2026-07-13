# Animated images and frame tooling

Frame-by-frame tools for animated GIF and WebP, animated-GIF encoding (reverse
playback + export), and the Lottie/dotLottie/TGS vector-animation player. Renderers:
`gif-frames.js`, `webp-frames.js`, `gif-encode.js` (all reached through a dropped
animated GIF/WebP, which routes as `kind: 'photo'` and builds its transport in
`photo.js`) and `lottie.js` (`kind: 'lottie'`).

### Animated GIF / WebP frame transport

**What it does.** A browser plays an animated GIF/WebP in an `<img>` but won't let
you step through it. Analyser decodes every frame itself (honouring per-frame
disposal, transparency and interlacing) and builds a real transport.

**How to reach it.** Automatic when an animated GIF/WebP is dropped; the frames are
decoded by `gif-frames.js` / `webp-frames.js` and the transport is built in
`photo.js`.

**How to use it.** The controls under the animation:

- **Play / scrub** - a proper transport over the decoded frames.
- **← Prev** / **Next →** - step one frame at a time.
- **Analyse** - send the current frame to the photo pipeline for full still analysis.
- **Frame grab** - download the current frame as a PNG.
- **Generate contact sheet** - a grid of all frames.

**Notes / limits.** A pixel cap (`width x height x frames`) drops frames past the cap
on pathological files (flagged as truncated).

### Reverse an animated GIF / WebP

**What it does.** Plays the animation backwards and lets you download a reversed
animated GIF, re-encoded from the decoded frames.

**How to reach it.** The reverse control on an animated GIF/WebP (`photo.js`), which
uses the minimal encoder in `gif-encode.js`; **Download reversed (GIF)** saves it.

### Lottie / dotLottie / Telegram sticker player

**What it does.** Plays Lottie/Bodymovin vector animations, including dotLottie
`.lottie` ZIP bundles and Telegram `.tgs` gzip stickers, and reads their metadata
(frame rate, frame count, duration).

**How to reach it.** Drop a `.lottie` or `.tgs` (routed to `kind: 'lottie'`), or a
plain `.json` that the JSON inspector detects as Lottie and offers to play.
`lottie.js` uses the vendored lottie-web.

**How to use it.** The Playback card offers **Play/Pause**, a frame scrubber, a
**playback-speed** selector, and a **Loop** toggle.

**Notes / limits.** `.tgs` is gunzipped and `.lottie` is unzipped in-browser
(fflate/fzstd); needs the lottie-web vendor (Everything offline tier).
