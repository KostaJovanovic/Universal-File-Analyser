# Audio (playback, spectrogram, isolation, AI separation)

Everything you can do with a dropped sound file, a microphone recording, or a live
capture: playback, waveform and spectrogram, codec/loudness analysis, frequency
isolation, reversed playback, and on-device AI vocal separation. Renderers:
`audio.js` (the module) with `audio-analysis.js`, `audio-codec.js`,
`audio-player.js`, `spectrogram.js`, `media-reverse.js`, and the MDX-Net subsystem
in `web/assets/js/lib/mdx-*`. Reached by dropping any `AUDIO_EXTS` file, or via the
hero **Record** / **Live** buttons; routed via `kind: 'audio'`. The same panels are
reused by `video.js` for a video's audio track.

### Playback transport

**What it does.** A custom `<audio>` transport with play/pause and a draggable seek
track, synced to the waveform and spectrogram playheads.

**How to reach it.** Automatic on any audio drop; `makePlayer` in `audio-player.js`.
Volume is shared across players (`sharedVolume`).

### Waveform

**What it does.** A downsampled min/max-per-pixel waveform, per channel (mono /
stereo / multichannel layouts are labelled).

**How to reach it.** Automatic; `renderWaveform` / `buildWaveformCard` in `audio.js`.
Includes **Zoom** / **Reset zoom** and **Export WAV** actions.

### Spectrogram

**What it does.** An interactive spectrogram down into the sub-20 Hz range, with
at-a-glance stats (peak loudness, high-frequency cutoff that reveals lossy encoding,
current resolution).

**How to reach it.** Automatic (into the Sound section); `makeSpectrogramPanel` +
`spectrogram.js`. Also available for live/mic capture.

**How to use it.** Controls (an "Advanced" disclosure):

- **Mode** - STFT (standard windowed FFT) or **Reassigned** (sharpens both axes by
  moving each cell's energy to its true centre; 3x the compute).
- **FFT** - window size: larger = better frequency resolution, lower time resolution.
- **Window** - Hann (default), Blackman (less leakage), or Rect (no smoothing).
- **Colour map** - selectable palette.
- **Height** - canvas height in pixels; in fullscreen "Fill" stretches to the screen.

Save the current view as a PNG (**Download**, with an export-size prompt) and toggle
fullscreen (on non-touch pointers). A horizontal scrollbar appears under it when
zoomed.

### Isolate frequencies

**What it does.** Carve out or cancel frequency bands in real time during playback -
a band-stop tool plus a **karaoke** centre-cancel mode (stereo L-R) for vocal
removal.

**How to reach it.** The **Isolate** button in the spectrogram Actions row (only when
driving file playback); `audio.js`. Drag bands directly on the spectrogram.

**How to use it.** Drag to select bands to cut; toggle karaoke for centre-channel
cancellation. Export the result with **Export WAV** (saved as `<name>_isolated.wav`).

### Codec and loudness analysis

**What it does.** Reports the container/codec, bitrate, sample rate, channels and
tags, plus computed level stats.

**How to reach it.** Automatic; `audio-codec.js` (`peekContainer`, ADTS-AAC wrapping)
and `audio-analysis.js` (`computeStats`). The high-frequency cutoff stat doubles as a
lossy-encoding tell.

### Reversed playback

**What it does.** Plays (and downloads) the decoded audio backwards.

**How to reach it.** The reverse-audio card; `buildReverseAudioCard` in
`media-reverse.js`. Play the reversed signal and download it.

### Microphone recording and live spectrogram

**What it does.** Records from the microphone or shows a live real-time spectrogram
from the mic.

**How to reach it.** The hero **Record** / **Live** buttons on the home page, or the
**Record** / **Live spectrogram** buttons in the audio panel (`audio.js`). The Live
button is a true on/off toggle.

**Notes / limits.** Needs microphone permission.

### AI vocal separation (MDX-Net)

**What it does.** Separates a track into **Vocals** and **Instrumental** stems with an
on-device ONNX model - nothing uploaded - and offers a live vocal/instrumental
**blend** slider over the spectrogram.

**How to reach it.** The **Separate** button (a toggle that reveals a model picker);
`audio.js` driving the `mdx-*` subsystem. The blend slider (`renderBlend`) plays the
recombined stems through raw Web Audio.

**How to use it.** Click **Separate**, pick a model. If the model isn't cached yet
you get a **Download AI model** prompt (size shown, "Download and continue");
otherwise **Start separation**. Progress shows model-download then separation
percentages. Each resulting stem (Vocals, Instrumental) has **Analyse** and
**Download WAV**; the blend slider crossfades between them live and can route through
the isolate band-stop.

**Notes / limits.** Requires the MDX model, part of the Complete offline tier; it is
cached in the persistent `analyser-mdx` cache so a service-worker update doesn't
force a re-download (see `docs2/pwa-offline.md`). Separation is compute-heavy and
runs in a Web Worker (`mdx-worker.js`).
