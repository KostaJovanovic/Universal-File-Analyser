# renderers (audio group) comment audit

Verified every `//`, `/* */`, and JSDoc comment in the eight target files against
the code it describes (codec/container facts, byte offsets, magic bytes, FFT and
numeric constants, control flow). Constants, offsets, and spec facts that I could
positively confirm correct are not listed.

## assets/js/renderers/audio.js

- **Line 264** — `time: (bestStart + block / 2) / sampleRate` with the doc above saying the Peak figure is "block RMS (not a single sample peak)" and the centre time of the loudest block → The reported `time` is the centre of the *fixed* `block` window (`block/2`), but the final block can be shorter than `block` (it ends at `samples.length`). For the very last block the comment's "loudest block's centre" is slightly off because `block/2` overshoots the truncated block's real centre. Minor, edge-case only — **Fix:** note that the centre uses the nominal block size, so the last (possibly short) block's reported centre can fall past its true midpoint. *(Low-severity; flag for accuracy only.)*

- **Line 270** — `// Scan a computed spectrogram for at-a-glance stats. \`dbFloor\` (the sensitivity` → The sentence references a ``dbFloor`` parameter ("the sensitivity …") that does not exist: `specStats(spec)` takes only `spec`, and the doc trails off mid-sentence (next line starts "All levels are signal-relative"). The stats are explicitly signal-relative and independent of `dbFloor`, so mentioning `dbFloor` as an input here contradicts the code. **Fix:** drop the dangling ``dbFloor`` clause — e.g. "Scan a computed spectrogram for at-a-glance stats. All levels are signal-relative …".

## assets/js/renderers/audio-analysis.js — no issues

(Spot-checked: K-weighting stages — high-shelf +4 dB at ~1681 Hz then HPF at ~38 Hz; LUFS `-0.691 + 10·log10`; YIN steps; detectBPM N=1024, hop=N/2, 60–200 BPM autocorrelation; mid/side formulas — all match the code.)

## assets/js/renderers/audio-codec.js — no issues

(Verified: WAV `fmt ` field offsets and `audioFormat` map; FLAC STREAMINFO sample-rate 20-bit pack `(b[18]<<12)|(b[19]<<4)|(b[20]>>4)`, channels/bit-depth bit fields, 36-bit total-samples layout, MD5 at b[26..41]; ADTS sync `0xFFF`/layer=0 magic; MP3 bitrate/sample-rate tables, version/layer bit decode, Xing/Info side-info offsets (MPEG1 mono 21 / else 36, MPEG2 mono 13 / else 21), VBRI 32-byte offset; ID3v2 synchsafe sizes and frame walking; MP4 `covr`→`data` typeFlag 13/14/27 → jpeg/png/bmp; Vorbis/Opus comment signatures. The `dv.getUint16(8 - 4, false)` tmpo read resolves to absolute offset i+8, consistent with the `data` atom value field; no misleading comment.)

## assets/js/renderers/audio-player.js — no issues

## assets/js/renderers/spectrogram.js — no issues

(Verified: radix-2 Cooley-Tukey FFT bit-reversal + butterflies; `bins = fftSize/2`, `frames = 1 + floor((len-fftSize)/hop)`; `*2 for one-sided`; window normalisation by `1/sum(win)`; reassignment math — `t̂`, `f̂`, gate `fmax*1e-5` ≈ "~50 dB below the frame peak"; renderSpectrogram default `dbFloor -90` / `dbCeil -10`; colormap stop tables; tick generators.)

## assets/js/renderers/midi.js — no issues

(Verified: `MThd` magic and header field offsets (format@8, ntrks@10, division@12); SMPTE `256 - (division>>8)` fps; running status; meta-event types 0x51 tempo / 0x58 time-sig / 0x59 key-sig / 0x03 / 0x04; channel 9 = drums = "channel 10" in 1-based display; default tempo 500000 µs = 120 BPM; GM instrument list.)

## assets/js/renderers/lrc.js — no issues

## assets/js/renderers/subtitles.js — no issues

(Verified: MicroDVD default 23.976 fps and `{n}{n}` fps-declaration sniff; SubViewer/ASS/SSA/VTT/SRT routing; VobSub binary fallback; ASS Dialogue field splitting with text-is-last-field handling.)
