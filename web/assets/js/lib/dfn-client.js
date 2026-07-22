/* Analyser - main-thread client for the DeepFilterNet3 denoise worker.

   The denoise twin of mdx-client.js. Resamples the decoded audio to 48 kHz (what
   the model expects), hands the channel data to the worker, and relays progress.
   Returns the clean and noise stems as channel Float32Arrays plus the sample rate,
   ready to be wrapped in AudioBuffers for playback / WAV export.

   The worker is created lazily and kept alive between runs so the model stays
   resident (a second denoise skips the download + init). */

import { DFN_SR } from './dfn-enhance.js';

let worker = null;
function getWorker() {
  if (!worker) worker = new Worker(new URL('./dfn-worker.js', import.meta.url), { type: 'module' });
  return worker;
}
let _jobSeq = 0;

// Resample to 48 kHz (stereo, or mono if that's all there is) via an
// OfflineAudioContext, returning detachable Float32Array channels.
async function toModelChannels(audioBuffer) {
  const nCh = Math.min(2, audioBuffer.numberOfChannels);
  if (audioBuffer.sampleRate === DFN_SR) {
    const chs = [];
    for (let c = 0; c < nCh; c++) chs.push(audioBuffer.getChannelData(c).slice());
    return { channels: chs, sampleRate: DFN_SR };
  }
  const OAC = self.OfflineAudioContext || self.webkitOfflineAudioContext;
  const len = Math.max(1, Math.ceil(audioBuffer.duration * DFN_SR));
  const off = new OAC(nCh, len, DFN_SR);
  const src = off.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  const chs = [];
  for (let c = 0; c < rendered.numberOfChannels; c++) chs.push(rendered.getChannelData(c).slice());
  return { channels: chs, sampleRate: DFN_SR };
}

/**
 * Denoise an AudioBuffer into clean + noise stems using DeepFilterNet3.
 * @param {AudioBuffer} audioBuffer
 * @param {{ onProgress?: (phase:'model'|'infer', frac:number)=>void, signal?: AbortSignal }} [opts]
 * @returns {Promise<{ clean: Float32Array[], noise: Float32Array[], sampleRate: number }>}
 */
export async function enhanceAudio(audioBuffer, { onProgress, signal } = {}) {
  const { channels, sampleRate } = await toModelChannels(audioBuffer);
  const w = getWorker();
  const jobId = ++_jobSeq;
  return new Promise((resolve, reject) => {
    const onMsg = (e) => {
      const m = e.data;
      if (!m || m.jobId !== jobId) return;
      if (m.type === 'progress') { if (onProgress) onProgress(m.phase, m.frac); }
      else if (m.type === 'done') { cleanup(); resolve(m); }
      else if (m.type === 'error') { cleanup(); reject(new Error(m.message || 'denoise failed')); }
    };
    const onAbort = () => {
      cleanup();
      try { if (worker) { worker.terminate(); worker = null; } } catch (_) {}
      reject(new DOMException('denoise aborted', 'AbortError'));
    };
    function cleanup() {
      w.removeEventListener('message', onMsg);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort);
    }
    w.addEventListener('message', onMsg);
    w.postMessage({ type: 'denoise', channels, sampleRate, jobId }, channels.map((c) => c.buffer));
  });
}
