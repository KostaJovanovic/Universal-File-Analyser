# Audio

Playback, waveform/spectrogram analysis, codec and loudness metrics,
frequency isolation, AI vocal separation, reversed playback, microphone
recording, and live spectrogram - everything the site does with sound.
Source: `audio.js`, `audio-analysis.js`, `audio-forensics.js`,
`audio-codec.js`, `audio-player.js`, `spectrogram.js`, `media-reverse.js`.

### File info, waveform and channel readout

**What it does.** Decodes the audio (Web Audio `decodeAudioData`) and shows
file info, container/codec details, per-channel peak/RMS, and a waveform.

**How to reach it.** Drop any recognised audio file. Built in
`web/assets/js/renderers/audio.js`.

**How to use it.** For multi-channel audio (`audio.js`'s channel selector),
choose **Mix** (every channel averaged) or an individual channel (Left,
Right, Centre, LFE, surrounds - named per the file's declared speaker
layout, best-effort) to drive the spectrogram and waveform; per-channel peak
and RMS update with the choice. `describeChannels()`/`channelLabels()`
recognise mono through 9.1.6 Atmos layouts.

```demo
btn active: Mix
btn: Left
btn: Right
```

### Spectrogram

**What it does.** An interactive time/frequency/loudness plot of the audio,
computed with a hand-written FFT (`spectrogram.js`'s `fft()`, no audio
library dependency).

**How to reach it.** Automatic below the waveform for any decoded audio.

**How to use it.** Linear or logarithmic frequency axis, adjustable FFT size
and window function, choice of colourmap, **Save PNG** to export the canvas,
**Fullscreen** to expand it. `computeReassignedSpectrogram()` offers a
sharper reassigned-spectrogram mode; `computeStftComplex()`/
`combineStftToDb()` support blending two signals' spectra (used by the AI
separation blend slider below).

```demo
btn: Save PNG
btn: Fullscreen
```

The frequency axis is a segmented toggle (the selected option carries the
accent fill):

```demo
btn active: Log
btn: Linear
```

**Notes / limits.** Reaches down into the sub-20Hz range per the repo root
`README.md`.

### Codec / loudness / pitch / tempo analysis

**What it does.** Peak/RMS level stats, spectral centroid, LUFS integrated
loudness, pitch detection (YIN algorithm), BPM/tempo detection, and stereo
correlation metrics - all pure computation in `audio-analysis.js` over the
decoded sample buffer.

**How to reach it.** Automatic - shown in the audio info readout.

**How to use it.** BPM is read from ID3/MP4 tags when available
(`audio-codec.js`'s `readTagBPM()`), otherwise estimated via onset
detection (`detectBPM()` in `audio-analysis.js`).

**Notes / limits.** No interactive controls - a readout only.

### Signal health and musical key (folded into File info)

**What it does.** Adds four pure-computation reads to the File info card:
**crest factor** (peak-to-RMS, a dynamics/loudness-war gauge), **DC offset**
(non-zero mean = capture/hardware fault), **effective bit depth** (the
deepest bit actually carrying signal, recovered from LSB activity - exposes
padded/upscaled "hi-res" files), and **musical key** (chroma matched against
the Krumhansl-Schmuckler key profiles, with confidence and a runner-up).

**How to reach it.** Automatic, in the File info readout. Built in
`audio-forensics.js` (`signalHealth`, `detectKey`).

**Notes / limits.** Key detection is most reliable on tonal music; the
runner-up is often the relative major/minor. Effective bit depth compares
against the declared depth and flags a likely padded/upscaled file.

### Advanced (forensic panels)

**What it does.** A single collapsed **Advanced** card - mirroring the photo
and video Advanced cards - that gathers the deep forensic reads into
collapsible `<details>` panels, keeping them out of the everyday File info
readout above. Each panel below is closed until opened:

- **Loudness meter (EBU R128)** - the full broadcast/streaming loudness set
  beyond the single integrated-LUFS row: **gated integrated** loudness (ITU-R
  BS.1770), **momentary** (400 ms) and **short-term** (3 s) maxima, **Loudness
  Range (LRA)**, and **true peak** (4x-oversampled dBTP, catching inter-sample
  overs that sample-peak metering misses), plus a **loudness-over-time** plot
  with a -14 LUFS streaming-target reference line. The plot is playable like
  the waveform - click or drag to seek, own transport below - and its
  playhead is measured against the decoded buffer's duration, the same time
  base the curve is plotted in and the one every other playhead on the page
  uses, so all of them stay in step. Measured on the channel-merged signal;
  a true peak above 0 dBTP is flagged in the accent colour (delivery specs
  cap it at -1 dBTP).
- **Lossy-source check** - decides whether a file that claims to be lossless
  (FLAC/WAV/ALAC...) was really made from an MP3/AAC, by finding the hard
  spectral low-pass a lossy codec leaves and mapping its cutoff to a probable
  source bitrate. A genuine lossless file reaches ~95%+ of the Nyquist limit.
- **Mains hum / ENF** - narrowband 50 or 60 Hz energy (plus harmonics) from
  power-line interference; reports the exact frequency and implied region -
  the gateway to ENF forensic timestamping.
- **Ultrasonic content** - energy and any narrowband tones above ~18 kHz
  (tracking beacons, device-pairing tones, watermarks), when the sample rate
  is high enough to carry them.
- **Touch-tones (DTMF)** - phone digits decoded via Goertzel filters at the 8
  standard row/column frequencies, with per-digit timing (shown only when
  tones are found).

**How to reach it.** Automatic collapsed card below File info for any decoded
audio (the card is omitted only if no panel has anything to show). The
lossless spectral panels derive from one long-average (Welch) spectrum of the
whole file. Built in `audio-forensics.js` (`loudnessR128`, `truePeakDb`,
`analyzeTranscode`, `analyzeMainsHum`, `analyzeUltrasonic`, `detectDtmf`);
rendered by `audio.js` (the `aAdvPanel` helper mirrors video's `vAdvPanel`).

**Notes / limits.** The lossy-source cutoff and its bitrate mapping are
approximate (encoders and settings vary); a "likely lossy source" verdict on
a declared-lossless file is a strong tell, not proof. Nothing is uploaded -
all analysis is on-device.

### Playback transport

**What it does.** A custom `<audio>` transport shared across the audio,
video, and sonify players: play/pause/replay button, a draggable seek
track, and a current/total time readout.

**How to reach it.** Automatic wherever audio plays. Built in
`audio-player.js`'s `makePlayer()`, re-exported by `audio.js` and reused by
`video.js`.

**How to use it.** Click the transport button to play/pause, or (once
ended) replay from the start; drag the seek track to scrub. The volume
button opens a popup with a vertical slider (0-225%, so audio can be
boosted past its native level) and mute toggle - volume is shared across
every player on the page via a small registry (`registerVolPlayer`), so
setting it once applies everywhere.

### Frequency isolation (band-stop EQ)

**What it does.** An interactive parametric EQ that solos or cuts specific
frequency bands, with one-tap presets and free-form custom bands.

**How to reach it.** Click **Isolate** in the audio actions row (only
offered when driving file playback, not live capture). Built in `audio.js`.

**How to use it.** Click **+ Custom band** to add a band, drag/edit its
range; each band gets its own **remove (x)** button. **Preset buttons**
apply a named frequency preset as a one-tap solo (cutting everything outside
the preset's range); **Clear** removes the active preset. Once at least one
band exists, **Download WAV** renders and downloads the isolated result.

```demo
btn: Isolate
```

```demo
btn: + Custom band
btn: Clear
btn: Download WAV
```

### AI vocal separation

**What it does.** Splits a track into separate vocal and instrumental stems
using an on-device neural network (MDX-Net "Kim Vocal 2" from Ultimate
Vocal Remover), entirely in-browser via ONNX Runtime Web.

**How to reach it.** Click **AI separation** in the audio actions row under
the spectrogram (next to **Isolate**) to open the AI options row (Standard /
Lite / denoise), then click a model tier to run. Built in `audio.js`, backed by the MDX-Net subsystem in
`web/assets/js/lib/mdx-*.js` (see [`parsers-and-libs.md`](../parsers-and-libs.md)).

**How to use it.** Click **Standard** or **Lite** (mobile-friendlier) to
separate with that model. First use prompts to confirm the model download
(**Download and continue**/**Start separation** to proceed, **Cancel** to
back out) unless already cached. Once separated, each stem gets **Play**
(in a blend row that can mix vocal/instrumental live), **Analyse** (runs
the stem through the full audio analyser), and **Download WAV**. A `[?]`
info button next to "Separate" explains the approach.

```demo
btn: AI separation
```

Pick a model tier, then confirm the one-time model download:

```demo
btn active: Standard
btn: Lite
```

```demo
btn cta: Download and continue
btn: Cancel
```

Each separated stem gets its own controls:

```demo
btn: Play
btn: Analyse
btn: Download WAV
```

**Notes / limits.** Runs on GPU via WebGPU where available, WASM otherwise;
the model (~85MB) is part of the "Complete" offline tier (see
[`pwa-offline.md`](../pwa-offline.md)). The isolate band-stop cuts are re-applied to
separated stems in parallel (nodes can't be shared across the file
player's audio context and the stem-blend context), so Isolate edits and AI
separation compose rather than one bypassing the other.

### AI denoise

**What it does.** Removes background noise and hiss from a track while
keeping the full sound, using an on-device neural network (DeepFilterNet3,
a 48 kHz full-band speech/audio denoiser), entirely in-browser via ONNX
Runtime Web. It produces two stems - **Clean** (the enhanced audio) and
**Noise** (what was removed, = original - clean) - shown in the same blend
view as vocal separation, relabelled Clean to Noise.

**How to reach it.** Open the AI options row by clicking **AI separation**
in the audio actions row under the spectrogram (the row is closed by
default), then click **denoise** to the right of the Standard/Lite tiers. Built in `audio.js`, backed by the
DeepFilterNet subsystem in `web/assets/js/lib/dfn-*.js` (see
[`parsers-and-libs.md`](../parsers-and-libs.md)).

**How to use it.** First use prompts to confirm the one-time model download
(**Download and continue**/**Start denoise** to proceed, **Cancel** to back
out) unless already cached. Once done, the blend slider fades Clean to Noise,
and each stem gets **Play**, **Analyse** and **Download WAV**, exactly like
the separation stems. Denoise and vocal separation are mutually exclusive -
starting one clears the other, since only one blend owns the spectrogram at a
time.

```demo
btn: denoise
```

**Notes / limits.** Unlike separation, this is noise suppression, not source
separation - it is aimed at cleaning up recordings (voice, ambience, hiss),
not splitting a musical mix. Runs on GPU via WebGPU where available, WASM
otherwise; the model (~9MB on top of the shared ONNX runtime) is part of the
"Complete" offline tier (see [`pwa-offline.md`](../pwa-offline.md)). All the
DSP around the model (STFT, ERB features, the gain mask and the deep filter)
is reimplemented on-device in `dfn-dsp.js`/`dfn-enhance.js`, mirroring libDF;
long audio is processed in overlapping segments to bound memory.

### Waveform selection: zoom and export

**What it does.** Select a time range on the waveform to zoom into it or
export just that range.

**How to reach it.** Drag a selection on the waveform, then click **Zoom**
or **Export WAV**. Built in `audio.js`. **Reset zoom** returns to the full
view.

```demo
btn: Zoom
btn: Export WAV
btn: Reset zoom
```

### Reversed playback

**What it does.** Plays and downloads the decoded audio backwards - each
channel's samples flipped, re-encoded as WAV.

**How to reach it.** Click **Reverse audio** ("Reverse" card, ↺ icon) below
the audio analysis. Built in `media-reverse.js`'s `buildReverseAudioCard()`.

**How to use it.** Click **↺ Reverse audio**; once rendered, a player
appears with **Download reversed (WAV)** and **Analyse reversed** (feeds the
reversed clip back through the full analysis pipeline via
`window._anrHandleFile`).

```demo
card: Reverse
  btn: ↺ Reverse audio
  btn: Download reversed (WAV)
  btn: Analyse reversed
```

**Notes / limits.** The reverse itself is synchronous and near-instant but
gated behind a click so it isn't computed for every file automatically.
Reuses the AVI module's PCM-WAV encoder (`encodeWav`, from `video-avi.js`).
Video reverse is a separate feature (FFmpeg re-encode) - see
[`video.md`](video.md).

### Microphone recording

**What it does.** Records live audio from the microphone and runs it
through the same analysis as a dropped file.

**How to reach it.** Click **Record** on the dropzone. Built in `audio.js`.

**How to use it.** Shows a compact live streaming spectrogram while
recording (a lighter-weight visual than the full interactive one). Click
**Stop** to end the take; **Download recording** saves the captured audio.

```demo
btn: Record
btn: Stop
btn: Download recording
```

### Live spectrogram (no recording)

**What it does.** Visualises the microphone input live, without recording
- a real-time spectrogram of whatever the mic hears.

**How to reach it.** Click **Live spectrogram**. Built in `audio.js`.

**How to use it.** Much the same toolbar as the file spectrogram (**Save
PNG**, **Fullscreen**), plus its own **Record** and **Live spectrogram**
toggle - which the file spectrogram does not carry - and **Pause** and
**Analyse last Ns**, which freezes and analyses the trailing N seconds of
the live stream. A channel picker (**Mix/L/R/etc.**) chooses which input
channel feeds the view.

```demo
btn: Live spectrogram
btn: Pause
btn: Analyse last Ns
```

### Cover art / tag extraction

**What it does.** Reads ID3/MP4 tags, including embedded cover art, from
the audio file.

**How to reach it.** Automatic - built in `audio-codec.js`'s
`extractCoverArt()`/`readAudioTags()`.

**Notes / limits.** No controls - a readout/preview only.

### ADTS-to-M4A wrapping

**What it does.** Wraps raw AAC (ADTS) streams in a minimal M4A container
so browsers that won't decode bare ADTS can still play the file.

**How to reach it.** Automatic when the file's container/codec is sniffed
as raw ADTS (`audio-codec.js`'s `peekContainer()`/`adtsToM4a()`).

**Notes / limits.** Internal compatibility shim; no user-facing control.
