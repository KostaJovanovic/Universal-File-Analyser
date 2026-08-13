/* Analyser - reverse audio
   Turns a decoded AudioBuffer back to front. The file is already decoded by the
   audio module, so reversing is just flipping each channel's samples; the result
   is re-encoded as a WAV (reusing the AVI module's PCM-WAV encoder) so it can be
   handed straight back to the analyser as a normal file, played in an <audio>
   element, or downloaded. Video reverse is handled separately in video.js (it
   needs FFmpeg to re-encode the picture).

   The caller is the spectrogram panel's Reverse button (audio.js), which feeds
   the reversed WAV to window._anrHandleFile for a full fresh analysis. */

import { encodeWav } from './video-avi.js';

let _ac: AudioContext | null = null;
function ac() { return _ac || (_ac = new (window.AudioContext || window.webkitAudioContext!)()); }

// Reverse every channel of an AudioBuffer and return the result as a WAV Blob.
export function reverseAudioBufferToWav(audioBuffer: AudioBuffer) {
  const ch = audioBuffer.numberOfChannels, len = audioBuffer.length, sr = audioBuffer.sampleRate;
  const out = ac().createBuffer(ch, len, sr);
  for (let c = 0; c < ch; c++) {
    const src = audioBuffer.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < len; i++) dst[i] = src[len - 1 - i];
  }
  return encodeWav(out);
}
