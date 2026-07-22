# Video

Playback, container/codec analysis, frame-level tools, scene detection,
truncated/unfinalised recording recovery, AVI handling, and reversed
playback. Source: `video.js`, `video-avi.js`, `video-recover.js`,
`video-forensics.js`, `video-telemetry.js`, `sony-rtmd.js`,
`web/assets/js/core/video-sync.js`.

### Playback and container/codec info

**What it does.** Plays the video with a synced transport and reports
container/codec, resolution, frame rate, and bitrate.

**How to reach it.** Drop any recognised video file. Built in
`web/assets/js/renderers/video.js`.

**Notes / limits.** Frame rate is parsed from MP4 container metadata with
an FFmpeg fallback for containers the browser can't introspect natively
(per the repo root `README.md`).

### Advanced: container structure and stream forensics

**What it does.** For MP4/MOV/M4V/3GP files, reads the ISOBMFF box layout
directly - no decoding - and surfaces four collapsible panels in an
**Advanced** card:

- **Box tree** - the recursive atom tree (4CC, size, byte offset, one-line
  gloss); container boxes expand.
- **Tracks** - every track, not just the first video and audio: handler,
  codec, language, duration, sample count, multi-segment edit lists, `tmcd`
  start-timecode (with drop-frame flag), and timed-metadata streams (GoPro
  `gpmd`, CAMM, Sony `rtmd`, Apple `mebx`).
- **Provenance tells** - structural signs of how the file was made:
  faststart (moov vs mdat order), ftyp major + compatible brands,
  multi-segment edit lists, free/skip padding, multiple `mdat` boxes,
  fragmentation (`moof`), and trailing data.
- **Frames & bitrate** - GOP/keyframe interval, VFR-vs-CFR verdict and true
  average frame rate, keyframe-vs-inter frame sizes, and a per-second video
  bitrate graph - all from the sample tables (`stsz`/`stss`/`stts`/`stco`),
  with no frames decoded.
- **Bitstream & authenticity** - a deep parse of the actual H.264/H.265
  stream, not just the container: the codec's own **SPS** (profile/level,
  coded size, chroma, bit depth, progressive/interlaced, VUI colour + frame
  rate); a **stream-vs-container consistency verdict** that flags a re-encode
  or colour re-tag when the two disagree; the **x264/x265 encoder
  fingerprint** carved from the first frame's unregistered SEI (exact build +
  encode settings); **HDR** mastering-display (`mdcv`) and content-light
  (`clli`) values plus Dolby Vision config; and detection of a **C2PA /
  Content Credentials** manifest. Built on `analyzeBitstream()`.

**How to reach it.** Automatic for any MP4/MOV-family file. The parser is
`analyzeMp4Structure()` in `video-forensics.js` (UI-free, best-effort,
returns nothing for non-ISOBMFF input); `video.js` builds the card. Each
panel is collapsed by default.

**Notes / limits.** The `moov` is read whole (capped) so a huge file never
loads into memory; `mdat` is never read for structure (only a 4-byte
timecode sample). Single identity edit lists - standard in most MP4s - are
deliberately not flagged as edits.

### Telemetry (GoPro / CAMM / container GPS)

**What it does.** Reads the timed-metadata track that action cameras and
phones record alongside the picture, and shows GPS position/speed plus
inertial (gyroscope + accelerometer) motion:

- **GoPro GPMF** (`gpmd` track) - KLV-walks the payloads for GPS5/GPS9
  (lat/lon/altitude/speed), ACCL/GYRO (with SCAL divisors applied),
  per-frame exposure (ISO / shutter / white balance), and TMPC temperature
  / GPSF fix. It also lists every stream the camera logged by its own
  `STNM` name (camera orientation, gravity, scene classification, face
  detection, luminance, ...), so a clip with **no GPS lock** still shows its
  full telemetry inventory rather than looking empty.
- **CAMM** (`camm` track) - the little-endian packet format written by
  Android phones, Insta360 and some drones (gyro, accelerometer, GPS).
- **Container GPS** - a single ISO-6709 point from QuickTime `©xyz` or the
  Apple `com.apple.quicktime.location.ISO6709` key, shown only when the
  other sources and the EXIF GPS card are absent.

The GPS track is drawn on a **local canvas** (start green, end red) - no map
tiles are fetched, so the coordinates never leave the device - with an
opt-in "open in OpenStreetMap" link. The gyro/accelerometer traces reuse
the Sony gyro timeline (zoomable, synced to the player). This sits beside
the Sony `rtmd` gyro card as a peer telemetry feature.

**How to reach it.** Automatic for any MP4/MOV carrying a GoPro/CAMM/©xyz
track. Built in `video-telemetry.js` (`appendTelemetryCards()`), reusing
`sony-rtmd.js`'s `buildImuTimeline`.

**Notes / limits.** Best-effort and browser-only; reads via byte-range
slices (chunk-grouped, capped) so a long clip never buffers whole. Distance
is the great-circle sum along the fixes; speed is the GPS velocity field.

### Frame capture and analysis

**What it does.** Steps through video frames and analyses any single frame
as a full photo (EXIF-less, since it's a grabbed frame, but the same
histogram/OCR/etc. pipeline).

**How to reach it.** **Prev frame**/**Next frame** step through frames;
**Analyse frame** (also **Analyse in Photo section** in alternate flows)
sends the current frame to the full photo analyser (`renderPhoto` via
`photo.js`). Built in `video.js`.

```demo
btn: Prev frame
btn: Next frame
btn: Analyse frame
```

### Sonify a frame

**What it does.** Turns the current video frame into sound, same as the
photo sonify feature.

**How to reach it.** Click **Sonify** on the current frame. Lazy-imports
`sonify.js` - see [`images.md`](images.md) for full control detail.

```demo
btn: Sonify
```

### Contact sheet

**What it does.** Builds a thumbnail grid of frames sampled across the
video.

**How to reach it.** Click **Generate contact sheet** (shown once there are
enough frames, 8+). Built in `video.js`.

```demo
btn: Generate contact sheet
```

### Audio track extraction

**What it does.** Extracts and decodes the video's audio track, then renders
the **identical** Sound section a directly-dropped audio file gets - same
cards in the same order, with the full forensic set (File info, the EBU R128
/ spectral **Advanced** card, channel picker, waveform, spectrogram, ...).

**How to reach it.** **Analyse audio** decodes the track (Web Audio →
in-container PCM → ffmpeg.wasm fallback; the AVI path already holds decoded
PCM) and hands the resulting `AudioBuffer` straight to `audio.js`'s
`renderAudio(file, el, { inline: true, audioBuffer, playbackFile, download: true })`
- the pre-decoded entry point, so nothing is decoded twice. A **Download
audio (WAV)** button (from `renderAudio`'s `opts.download`) saves the
extracted track. **Analyse photo** (on the paired still) runs the current
frame through `photo.js`'s `renderPhoto` the same way. `declaredLossless` is
passed `false` so the WAV wrapper is not mistaken for a fake-lossless file.

```demo
btn: Download audio (WAV)
btn: Analyse audio
btn: Analyse photo
```

**Notes / limits.** For codecs the browser can decode video but not audio
for (or vice versa), `video-sync.js`'s "audio companion" mechanism plays a
separately-extracted `<audio>` element in lockstep with the muted
`<video>`, so playback stays in sync with no echo - see "Multi-player sync"
below.

### Reversed video

**What it does.** Re-encodes the video playing backwards - picture and
sound - via FFmpeg, unlike audio reverse (which is instant sample-flipping,
since video needs the picture itself re-encoded).

**How to reach it.** Click **↺ Reverse video**. Built in `video.js`.

**How to use it.** Once rendered: **Analyse reversed** re-runs the full
pipeline on the reversed clip; **Download reversed (MP4)** saves it.

```demo
btn: ↺ Reverse video
btn: Analyse reversed
btn: Download reversed (MP4)
```

**Notes / limits.** Explicitly warned as slow in the UI copy ("this isn't
as straightforward as it seems... going to take a while") - a full FFmpeg
re-encode, not a cheap operation.

### Scene change detection

**What it does.** Samples the video at a fixed interval and compares
consecutive frames by mean per-channel pixel difference; a jump past a
threshold is marked as a scene change with a thumbnail and confidence
score.

**How to reach it.** Runs automatically for smaller videos; click **Detect
scene changes** to run it manually (always required for large videos, which
skip the automatic run - shown as "Skipped automatically for large videos
(N MB)"). **Run again (current part)** re-scans just the currently loaded
segment on segmented/salvaged playback. Built in `video.js`.

```demo
btn: Detect scene changes
btn: Run again (current part)
```

**How to use it.** Click any result thumbnail or timeline marker to jump
the player there.

### Content timeline (movie barcode + brightness)

**What it does.** Reuses the same frame sampling as scene detection (no
extra scrubbing) to build three reads of the video's visual content: a
**movie barcode** that compresses each sampled frame to a single
average-colour column for a colour-over-time fingerprint of the whole clip;
a **brightness curve** plotting mean luma (Rec. 709) over time; and flags
for **near-black frames** (fades, cuts, leader/trailer black) and
**freeze/still segments** (frozen frames, held title cards, static shots).
The readout summarises mean/range brightness, the darkest sample, and the
black and freeze stretches.

**How to reach it.** Appears just under **Scene changes** whenever scene
detection runs (automatically for smaller videos, or after you trigger it
manually for large ones). Click anywhere on the barcode to jump the player
to that point. Built in `video.js` (`buildContentTimelineCard`).

**Note.** Freeze detection is only as fine as the sampling interval, so it
catches stretches longer than that, not single dropped frames. On an
unsupported codec that was converted to an H.264 proxy for playback, the
barcode and brightness read the decoded proxy frames (the only ones that
can be decoded), while all container/metadata analysis stays on the
original file.

### Segmented playback

**What it does.** For very large or specially-loaded videos, plays through
the content in segments rather than loading it all at once.

**How to reach it.** **Prev**/**Next** step between segments. Built in
`video.js`.

```demo
btn: Prev
btn: Next
```

### Integrity: SHA-256

**What it does.** Computes the file's full SHA-256 hash.

**How to reach it.** Click **Compute SHA-256** (the hash isn't computed
automatically for video since it reads the whole file). Built in `video.js`.

```demo
btn: Compute SHA-256
```

### Truncated/unfinalised recording salvage

**What it does.** Recovers playable video from a truncated/unfinalised
ISOBMFF (MP4/MOV) recording whose `moov` index is missing - the classic
"camera/card was interrupted before finalising" or "file copy stopped
early" corruption, seen on Sony XAVC, GoPro, DJI, and phone recordings.
With no `moov` there are no sample tables to index frames, but the raw
encoded video is still present in the `mdat` box.

**How to reach it.** Automatic detection when a dropped MP4/MOV has no
`moov` (`video-recover.js`'s `detectMoovlessMp4()`); the video section
shows a **Salvage video** call-to-action. Built in `video-recover.js`,
orchestrated by `video.js`.

**How to use it.** The video's H.264/H.265 stream is carved out of `mdat`
(MP4 stores NAL units length-prefixed, interleaved with audio/metadata the
recovery can't index; it walks the chain validating each NAL against the
next and resyncing byte-by-byte across gaps, re-emitting each as Annex B).
If the file's SPS/PPS codec setup was stored only in the (missing) `moov`'s
`avcC` box rather than in-band, the "Reference clip needed" panel appears:
click **Choose reference clip...**, pick a healthy clip shot on the same
camera in the same mode (same resolution and codec), and Analyser borrows
its parameter sets to make the carved stream decodable. Click **Salvage
video** to run the recovery; the result plays through the site's raw-stream
segmented player.

```demo
card: Reference clip needed
  text: The SPS/PPS codec setup was stored only in the missing moov. Pick a healthy clip shot on the same camera in the same mode.
  btn: Choose reference clip...
  btn cta: Salvage video
```

**Notes / limits.** Verified against real Sony FX30 XAVC footage. The
recovery module is pure logic (no DOM) with an abstracted byte-source
reader, so it runs identically under the browser File API and a Node test
harness.

### Undecodable codec conversion

**What it does.** Re-encodes a video whose codec the browser can't decode
into H.264/MP4 via FFmpeg so it can be played and analysed in full. By
default it makes a **fast proxy** - downscaled to a 720p box, **Fastest**
(`ultrafast`) speed, capped at 30 fps - because encode time scales with pixels x frames,
so this is several times faster than a full-resolution re-encode (a big win
for 4K/2.7K GoPro-style HEVC). **Turbo** is faster than libx264's own
fastest preset: `ultrafast` is already the encoder floor, so the extra speed
comes from the decode side - `-skip_loop_filter all` drops the in-loop
deblocking filter while decoding the (expensive) HEVC source, plus
`-tune zerolatency` on the encoder. Slightly blockier, no frames dropped.

**How to reach it.** Click **Convert to H.264 and play**, shown when
playback fails on an unsupported codec. The **Advanced** button reveals
resolution / frame-rate / speed controls to override the proxy defaults
(e.g. Full resolution, Original frame rate, or a slower/cleaner preset).
Built in `video.js` (`ffmpegTranscodeToH264`, `opts = {maxHeight, maxFps,
preset}`).

```demo
btn: Convert to H.264 and play
btn: Advanced
```

**Notes / limits.** Lossy re-encode, single-threaded in-browser FFmpeg. The
scale filter caps height without ever upscaling and forces even dimensions
for yuv420p. Long clips or Full-resolution / slower-preset settings still
take a while.

### First-frame extraction (no native preview)

**What it does.** Grabs a single frame via FFmpeg for a format with no
native browser preview.

**How to reach it.** Click **Extract first frame**, shown when there's no
default preview available. Built in `video.js`.

```demo
btn: Extract first frame
```

### AVI container parsing

**What it does.** Browsers can't play most AVI files (typically
Motion-JPEG video + PCM audio), so Analyser parses the RIFF container
itself: reads the header for dimensions/codec/audio format, pulls the raw
MJPEG frames and PCM audio out of the `movi` list, and re-wraps the PCM as
a WAV the browser can play.

**How to reach it.** Automatic fallback when the native `<video>` path
fails on an `.avi`. Built in `video-avi.js`, used by `video.js`.

**Notes / limits.** Pure parsing, no DOM or cross-module dependencies.

### Multi-player sync

**What it does.** When an analysis shows more than one `<video>` of the
same clip at once (the main player, a section-03 mini player, a gyro mini
player), all registered players stay on the same transport: play/pause/seek
one and the others follow.

**How to reach it.** Automatic wherever multiple synced players exist for
one clip. Built in `web/assets/js/core/video-sync.js`.

**Notes / limits.** Exclusive audio: since every synced player decodes the
clip independently, only one may be audible at a time (echo otherwise) -
whichever player the user presses becomes the "audio owner" and is
unmuted, muting every other synced player. Programmatic play/pause/seek
propagated to followers is tagged so it doesn't echo back and cause a
feedback loop. An "audio companion" `<audio>` element (used when the video
codec is playable but its audio isn't, or vice versa) shadows the audio
owner's transport rather than joining the synced-video set directly.
