/* Analyser - reverse audio playback
   Plays (and downloads) a decoded audio signal backwards. The file is already
   decoded to an AudioBuffer by the audio module, so reversing is just flipping
   each channel's samples; we then re-encode the result as a WAV (reusing the AVI
   module's PCM-WAV encoder) so it plays in a normal <audio> element and downloads
   cleanly. Video reverse is handled separately in video.js (it needs FFmpeg to
   re-encode the picture). UI helpers here import el / makePlayer. */

import { el } from '../core/util.js';
import { makePlayer } from './audio-player.js';
import { encodeWav } from './video-avi.js';

let _ac = null;
function ac() { return _ac || (_ac = new (window.AudioContext || window.webkitAudioContext)()); }

// Reverse every channel of an AudioBuffer and return the result as a WAV Blob.
export function reverseAudioBufferToWav(audioBuffer) {
  const ch = audioBuffer.numberOfChannels, len = audioBuffer.length, sr = audioBuffer.sampleRate;
  const out = ac().createBuffer(ch, len, sr);
  for (let c = 0; c < ch; c++) {
    const src = audioBuffer.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < len; i++) dst[i] = src[len - 1 - i];
  }
  return encodeWav(out);
}

// Card with a button that builds a reversed-audio player + WAV download on demand
// (the reverse itself is instant, but it's gated behind a click so it isn't done
// for every file). `signal` revokes the blob URL when the render is torn down.
export function buildReverseAudioCard(audioBuffer, baseName, signal) {
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Reverse'));
  card.appendChild(el('p', { class: 'anr-hint' }, 'Play and download this audio reversed (played backwards).'));
  const out = el('div');
  const btn = el('button', { type: 'button', class: 'anr-btn' }, '↺ Reverse audio');
  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.textContent = 'Reversing…';
    // Defer one frame so the button repaints before the (synchronous) reverse.
    setTimeout(() => {
      let blob;
      try { blob = reverseAudioBufferToWav(audioBuffer); }
      catch (_) { btn.disabled = false; btn.textContent = 'Reverse failed - try again'; return; }
      const url = URL.createObjectURL(blob);
      if (signal) signal.addEventListener('abort', () => { try { URL.revokeObjectURL(url); } catch (_) {} });
      const audioEl = el('audio', { src: url, class: 'is-hidden' });
      out.appendChild(audioEl);
      out.appendChild(makePlayer(audioEl, audioBuffer.duration));
      const revName = (baseName || 'audio') + '_reversed.wav';
      const dl = el('a', {
        href: url, download: revName, class: 'anr-btn',
        style: 'display:inline-block;text-decoration:none;'
      }, 'Download reversed (WAV)');
      const analyse = el('button', { type: 'button', class: 'anr-btn' }, 'Analyse reversed');
      analyse.addEventListener('click', () => {
        const file = new File([blob], revName, { type: 'audio/wav' });
        if (window._anrHandleFile) window._anrHandleFile(file);
      });
      out.appendChild(el('div', {
        style: 'margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;'
      }, [dl, analyse]));
      btn.remove();
    }, 0);
  });
  card.appendChild(btn);
  card.appendChild(out);
  return card;
}
