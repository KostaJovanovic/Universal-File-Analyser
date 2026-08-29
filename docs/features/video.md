# Video

Playback, container/codec analysis, frame-level tools, scene detection,
truncated/unfinalised recording recovery, AVI handling, and reversed
playback. Source: `video.js`, `video-avi.js`, `video-bitstream.js`,
`video-recover.js`, `video-forensics.js`, `video-telemetry.js`,
`sony-rtmd.js`, `web/assets/js/core/video-sync.js`.

### Playback and container/codec info

**What it does.** Plays the video with a synced transport and reports
container, codec (with profile, tier and level), resolution, pixel aspect,
frame rate, duration, whole-file bitrate, bit depth and chroma
subsampling, colour primaries / transfer / matrix / range, HDR type with
MaxCLL and MaxFALL, Dolby Vision profile and level, rotation, and the
audio codec with its channel count, sample rate and bit depth. Where the
muxer recorded the encoder's own average and peak video bitrate (a `btrt`
box), that is shown too, separately from the file-size-over-duration
figure.

**How to reach it.** Drop any recognised video file. Built in
`web/assets/js/renderers/video.js`, on the parsers in
`video-bitstream.js`.

**Notes / limits.** The codec detail comes from the `avcC` / `hvcC`
codec-configuration record, and from the H.264 / H.265 **SPS** embedded
inside it - so colour and frame rate are read even when the container
writes no `colr` box. Frame rate is taken from the container (MP4 sample
tables, Matroska `DefaultDuration`, or the `hvcC` average frame rate) and
falls back to an FFmpeg probe only for containers none of those cover.

### Matroska / WebM (.mkv, .webm)

**What it does.** Walks the EBML structure - seeking past the clusters
rather than reading them - for the Segment Info (duration, timecode
scale, title, muxing and writing app, creation date) and the full Tracks
list. Every track is listed with its type, codec, resolution or channel
count, language, name and default / forced flags, which matters because a
Matroska file routinely carries several soundtracks and subtitle tracks.
The video track's `CodecPrivate` is a verbatim `hvcC` or `avcC` record for
HEVC and H.264, so it yields the same profile / level / bit depth / chroma
/ colour readout an MP4 gets.

**How to reach it.** Drop any `.mkv` or `.webm`. Built on
`parseMatroskaTracks()` in `video-bitstream.js`.

**Notes / limits.** HEVC inside Matroska plays in no browser - the ones
that can decode HEVC will not demux MKV, and the ones that demux MKV only
handle WebM codecs - so those files skip the playback attempt entirely and
go straight to the metadata readout and the convert-to-H.264 offer.

### Advanced: container structure and stream forensics

**What it does.** For MP4/MOV/M4V/3GP files, reads the ISOBMFF box layout
directly - no decoding - and surfaces five flat parts in an **Advanced**
card, in this order:

- **Provenance tells** - structural signs of how the file was made:
  faststart (moov vs mdat order), ftyp major + compatible brands,
  multi-segment edit lists, free/skip padding, multiple `mdat` boxes,
  fragmentation (`moof`), and trailing data.
- **Tracks** - every track, not just the first video and audio: handler,
  codec, language, duration, sample count, multi-segment edit lists, `tmcd`
  start-timecode (with drop-frame flag), and timed-metadata streams (GoPro
  `gpmd`, CAMM, Sony `rtmd`, Apple `mebx`).
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
  Content Credentials** manifest. Built on `analyzeBitstream()`, over the
  shared SPS parsers in `video-bitstream.js` - which is what lets the
  consistency verdict work for HEVC as well as H.264, since an H.265 SPS
  only reaches its VUI past the short-term reference picture sets.
- **Box tree** - the recursive atom tree (4CC, size, byte offset, one-line
  gloss); container boxes expand. Deliberately last: it is the longest part
  by far and the least often read, so above the findings it buried them.

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

**What it does.** Turns a video frame into sound, same as the photo sonify
feature.

**How to reach it.** There is no longer a **Sonify frame** button under the
player. Send the frame to the photo section with **Analyse frame** first,
then use **Sonify (play as spectrogram)** there - see
[`images.md`](images.md) for full control detail.

### Contact sheet

**What it does.** Builds a thumbnail grid of frames sampled across the
video.

**How to reach it.** Click **Generate contact sheet** (shown once there are
enough frames, 8+). Built in `video.js`.

**How to use it.** A progress bar counts the captures ("Capturing frame 3 of
8..."), since each tile costs a seek and a large file can take a while.

**Notes / limits.** Every tile is captured by `seekAndPaint()`, which waits
for `seeked` and *then* for a painted frame (via `requestVideoFrameCallback`
where available) before drawing - registering that callback before the seek
would capture the frame being seeked away from. A seek that does not land
within 12s is retried once a hair further in; if it still fails the tile is
left as bare background and a line under the sheet says how many positions
could not be reached, rather than silently repeating the previous frame.

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

**How to reach it.** Runs automatically for light videos; click **Detect
scene changes** to run it manually otherwise. Three things suppress the
automatic run: over 150 MB, longer than 10 minutes, or a **bitrate above
10 Mbps**. Bitrate matters because bitrate is what the scan costs - every
sample is a seek, and a seek makes the decoder rebuild a whole GOP, on a
second decoder, while the viewer is trying to watch that same file. Total
size misses this entirely: camera-original footage (a Sony XAVC-S clip runs
50+ Mbps with a ~60-frame GOP) is often only tens of MB because it is short,
yet it is by far the most expensive thing to scan. Note this leaves most
phone and camera footage on the manual trigger and keeps the automatic run
for compressed/streaming material. The notice names whichever limit actually
fired - "Skipped automatically for high-bitrate videos (55 Mbps)" or "for
large videos (N MB)" - rather than calling a short 56 MB clip large.
**Run again (current part)** re-scans just the currently loaded
segment on segmented/salvaged playback. Built in `video.js`.

```demo
btn: Detect scene changes
btn: Run again (current part)
```

**How to use it.** A progress bar tracks the scan while it runs ("Scanning
for scene changes... 40%"): it walks up to ~600 sampled positions, one seek
each, so on a long clip it is not quick. Click any result thumbnail or
timeline marker to jump the player there.

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

**How to reach it.** Appears just under **Scene changes**. It has no scan of
its own - the per-sample colour and luma series it draws is collected by the
scene-detection seek loop as it passes - so the two always arrive together.
On light videos that is automatic. Where detection is skipped by default
(large, long, or high-bitrate - see **Scene changes** above), the card still
appears in its reserved slot as a
stand-in explaining where it comes from, with a **Scan the video** button;
that and **Detect scene changes** are the same one-shot scan, so whichever
you click fills both cards. The segmented raw-stream player collects the
series too, scoped to the part currently loaded. Click anywhere on the
barcode to jump the player to that point. Built in `video.js`
(`buildContentTimelineCard`).

**Note.** Freeze detection is only as fine as the sampling interval, so it
catches stretches longer than that, not single dropped frames. On an
unsupported codec that was converted to an H.264 proxy for playback, the
barcode and brightness read the decoded proxy frames (the only ones that
can be decoded), while all container/metadata analysis stays on the
original file.

### Raw elementary streams (.h264, .h265, .hevc, .avc, .264, .265)

**What it does.** A raw Annex B stream has no container at all, so there
is nothing to read a codec, size or length out of. Analyser parses the
stream's own **sequence parameter set** instead, which gives the profile,
tier and level, the coded size and conformance window, bit depth, chroma
subsampling, colour primaries / transfer / matrix / range, and the frame
rate from the VUI timing information. The stream is then wrapped in an MP4
with FFmpeg (a copy, not a re-encode) so it plays.

**How to reach it.** Drop the file. Built on `parseAnnexBStreamInfo()` in
`video-bitstream.js`.

**Notes / limits.** The frame rate matters more than it looks: FFmpeg's
raw demuxer assumes 25 fps when nothing tells it otherwise, and the
duration and whole-file bitrate are both derived from that. Reading the
rate out of the SPS first and passing it to the demuxer is what makes
those two figures real rather than assumed. A stream whose SPS states no
timing still falls back to 25 fps, and the readout says so.

### Segmented playback

**What it does.** For very large or specially-loaded videos, plays through
the content in segments rather than loading it all at once. Raw streams
over 1.4 GB use this: they are split at keyframes, each part remuxed on
demand. Because a raw stream carries no length, the duration and bitrate
are measured from the first part that plays - its byte range over its
running time - and scaled across the file.

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

**Large AVIs stream instead of loading.** Reading the whole file to carve
its frames only works while the whole file fits in memory, so past
`AVI_EXTRACT_MAX` (500 MB, in `core/limits.js`) the file is opened a second
way rather than declined: `openAviData()` indexes the `movi` chunk table -
offsets and sizes only, taken from the `idx1` index when the muxer wrote
one, otherwise from a windowed walk of the chunk headers - and hands the
viewer a frame source whose `get(idx)` reads that one JPEG off disk. It is
the same trade the animated-GIF viewer makes: index eagerly, decode lazily,
keep a bounded cache (`AVI_FRAME_CACHE`) so scrubbing backwards is cheap.
Files over 4 GB (OpenDML, several `RIFF`/`AVIX` segments) are indexed across
every segment. A streamed file says so on screen, since it behaves slightly
differently: each step is a read, so scrubbing is a little slower.

**Notes / limits.** Pure parsing, no DOM or cross-module dependencies.
Sound is the one part that cannot be paged off disk - an `AudioBuffer` is
resident by definition - so on the streamed path the PCM is only decoded
when it is under `AVI_AUDIO_PCM_MAX` (150 MB); past that the frames play
silently and the viewer says so. Reversed video is also hidden for a
streamed file: re-encoding runs the whole file through FFmpeg in memory,
which is exactly what streaming avoids.

### Multi-player sync

**What it does.** When an analysis shows more than one `<video>` of the
same clip at once (the main player, a section-03 mini player, a gyro mini
player), all registered players stay on the same transport: play/pause/seek
one and the others follow.

**How to reach it.** Automatic wherever multiple synced players exist for
one clip. Built in `web/assets/js/core/video-sync.js`.

**Only on-screen players decode.** Every synced player is an independent
decoder of the same clip, so propagating a play to all of them costs a full
decode each - and the followers are usually far outside the viewport (the
Sony gyro mini player sits thousands of pixels below the main player). On a
heavy clip that second decoder is enough to stutter the picture actually
being watched, for a picture nobody can see. A follower that is off-screen
therefore stays paused and banks the position it should be at; an
`IntersectionObserver` (200px margin) starts it, at the current time, when
it scrolls into view. The same applies to seeks, which a scrub fires
continuously and which force a decode even on a paused element. Visible
followers behave exactly as before. Without `IntersectionObserver` every
player counts as visible, i.e. the old all-play behaviour.

**Notes / limits.** Exclusive audio: since every synced player decodes the
clip independently, only one may be audible at a time (echo otherwise) -
whichever player the user presses becomes the "audio owner" and is
unmuted, muting every other synced player. Programmatic play/pause/seek
propagated to followers is tagged so it doesn't echo back and cause a
feedback loop. An "audio companion" `<audio>` element (used when the video
codec is playable but its audio isn't, or vice versa) shadows the audio
owner's transport rather than joining the synced-video set directly.
