# Video

Playback, container/codec analysis, frame-level tools, scene detection,
truncated/unfinalised recording recovery, AVI handling, and reversed
playback. Source: `video.js`, `video-avi.js`, `video-recover.js`,
`web/assets/js/core/video-sync.js`.

### Playback and container/codec info

**What it does.** Plays the video with a synced transport and reports
container/codec, resolution, frame rate, and bitrate.

**How to reach it.** Drop any recognised video file. Built in
`web/assets/js/renderers/video.js`.

**Notes / limits.** Frame rate is parsed from MP4 container metadata with
an FFmpeg fallback for containers the browser can't introspect natively
(per the repo root `README.md`).

### Frame capture and analysis

**What it does.** Steps through video frames and analyses any single frame
as a full photo (EXIF-less, since it's a grabbed frame, but the same
histogram/OCR/etc. pipeline).

**How to reach it.** **Prev frame**/**Next frame** step through frames;
**Analyse frame** (also **Analyse in Photo section** in alternate flows)
sends the current frame to the full photo analyser (`renderPhoto` via
`photo.js`). Built in `video.js`.

### Sonify a frame

**What it does.** Turns the current video frame into sound, same as the
photo sonify feature.

**How to reach it.** Click **Sonify** on the current frame. Lazy-imports
`sonify.js` - see [`images.md`](images.md) for full control detail.

### Contact sheet

**What it does.** Builds a thumbnail grid of frames sampled across the
video.

**How to reach it.** Click **Generate contact sheet** (shown once there are
enough frames, 8+). Built in `video.js`.

### Audio track extraction

**What it does.** Extracts the video's audio track and runs it through the
full audio analyser (waveform, spectrogram, LUFS, etc.).

**How to reach it.** **Download audio (WAV)** downloads the extracted
track; **Analyse audio** runs it through `audio.js`'s full pipeline;
**Analyse photo** (on the paired still) runs the current frame through
`photo.js`. Built in `video.js`, reusing `audio.js`'s
`makeSpectrogramPanel`/`buildHistogramCard`/`buildWaveformCard`.

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

**How to use it.** Click any result thumbnail or timeline marker to jump
the player there.

### Segmented playback

**What it does.** For very large or specially-loaded videos, plays through
the content in segments rather than loading it all at once.

**How to reach it.** **Prev**/**Next** step between segments. Built in
`video.js`.

### Integrity: SHA-256

**What it does.** Computes the file's full SHA-256 hash.

**How to reach it.** Click **Compute SHA-256** (the hash isn't computed
automatically for video since it reads the whole file). Built in `video.js`.

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

**Notes / limits.** Verified against real Sony FX30 XAVC footage. The
recovery module is pure logic (no DOM) with an abstracted byte-source
reader, so it runs identically under the browser File API and a Node test
harness.

### Undecodable codec conversion

**What it does.** Re-encodes a video whose codec the browser can't decode
into H.264/MP4 via FFmpeg so it can be played and analysed in full.

**How to reach it.** Click **Convert to H.264 and play**, shown when
playback fails on an unsupported codec. Built in `video.js`.

**Notes / limits.** Lossy re-encode; can take a while for long or
high-resolution clips.

### First-frame extraction (no native preview)

**What it does.** Grabs a single frame via FFmpeg for a format with no
native browser preview.

**How to reach it.** Click **Extract first frame**, shown when there's no
default preview available. Built in `video.js`.

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
