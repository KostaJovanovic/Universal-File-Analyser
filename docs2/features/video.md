# Video (playback, frames, streams, recovery)

Everything you can do with a dropped video: playback, container/codec/frame-rate
analysis, frame-accurate stepping and export, audio-track extraction, scene-change
detection, gyro/IMU metadata, AVI handling, raw elementary-stream playback, and
recovery of truncated recordings. Renderers: `video.js`, `video-avi.js`,
`video-recover.js`, and the shared `core/video-sync.js`. Reached by dropping any
`VIDEO_EXTS` file; routed via `kind: 'video'`. Audio panels are shared with
`audio.js` (waveform/spectrogram over the extracted track).

### Player and container/codec readout

**What it does.** Plays the clip through the site's custom transport and reports the
container, codec, resolution and frame rate.

**How to reach it.** Automatic on a video drop (into the Video section); `video.js`
using `makePlayer`. A small synced mini-player is also placed in the section meta;
all players of the same clip stay locked together (`registerSyncedVideo`,
`core/video-sync.js`).

### Frame controls (step, analyse, grab, sonify)

**What it does.** Frame-accurate navigation and per-frame tools.

**How to reach it.** The frame controls under the player (`buildFrameControls` in
`video.js`): an editable timecode plus a grid of **Prev frame** / **Next frame** /
**Analyse frame** / **Frame grab** / **Sonify frame**.

**How to use it.** Click the timecode to set hours/minutes/seconds/frame and seek
there. **Prev/Next frame** step exactly one frame. **Analyse frame** sends the
current frame to the Photo section for full still analysis. **Frame grab** downloads
it as a PNG. **Sonify frame** reads the frame as a spectrogram and resynthesises it
as sound (via `sonify.js`).

### Audio-track extraction

**What it does.** Decodes the embedded sound track for a player, waveform,
spectrogram and level stats.

**How to reach it.** The **Analyse audio** button on the "this video carries a sound
track" card (`video.js`), with a **Download audio (WAV)** link. Reuses the audio
renderer's waveform/spectrogram panels.

### Scene-change detection

**What it does.** Detects shot/scene changes in the portion currently loaded in the
player.

**How to reach it.** An opt-in control in `video.js` (scoped to the loaded part, so
it doesn't force a full decode of a long clip).

### Reversed playback

**What it does.** Plays the video backwards. Because reversing a whole 4K clip at
once fails, it normalises to H.264 with forced keyframes, splits losslessly into
segments, and reverses segment by segment.

**How to reach it.** The reverse control in `video.js` (segmented reverse via
FFmpeg). See also the animated-image reverse in `docs2/features/animation-frames.md`.

### Sony gyro / IMU metadata

**What it does.** Decodes and plots the inertial (gyroscope/accelerometer) "rtmd"
timed-metadata track that Sony cameras (Alpha, FX, RX) embed - the same data Gyroflow
and Catalyst Browse use - alongside ISO, white balance and capture time.

**How to reach it.** Automatic when present; `appendSonyGyroCard` in `sony-rtmd.js`,
with a mini-player synced to the main player. (Gyroflow `.gcsv` IMU logs open on their
own via `gcsv.js`.)

### AVI handling

**What it does.** Parses AVI (RIFF) containers the browser can't play (typically
Motion-JPEG + PCM), decoding frames and playing the PCM audio in sync.

**How to reach it.** Automatic for `.avi` that won't play natively; `video-avi.js`
drives a frame transport (play / scrub / time) with the AVI's own PCM audio synced,
a contact-sheet option, and per-frame analysis.

### Raw elementary streams and AVCHD

**What it does.** Plays raw H.264/H.265 elementary streams (`.h264`/`.265`) and AVCHD
camcorder files (`.mts`/`.m2ts`) by remuxing them to MP4 in-browser.

**How to reach it.** Automatic on drop; `video.js` remuxes via FFmpeg (video copied,
audio transcoded to AAC), then plays the result.

**Notes / limits.** Needs the FFmpeg WASM (Essentials offline tier). If the remux
produces nothing, an "unplayable" card surfaces the FFmpeg log tail.

### Recovery of truncated / unfinalised MP4/MOV

**What it does.** Recovers playable video from a truncated or unfinalised ISOBMFF
(MP4/MOV) that has no moov index, by carving H.264/H.265 NALs from the mdat.

**How to reach it.** Automatic when a video has no playable index; `video-recover.js`,
which plays the result through the raw-stream segmented player.

**How to use it.** The recovery carves valid video NALs from the orphaned mdat and
builds an Annex B stream. Cameras that embed SPS/PPS per-IDR (GoPro, DJI, many phones)
need nothing extra; Sony XAVC stores the parameter sets only in the missing avcC, so
those are either found in-band or **lifted from a healthy reference clip** shot on the
same camera (which you supply as a donor).

**Notes / limits.** Best-effort; depends on FFmpeg/muxers and on the parameter sets
being recoverable (in-band or from a reference clip).
