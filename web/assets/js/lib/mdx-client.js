/* Analyser - main-thread client for the MDX-Net vocal separation worker.

   Resamples the decoded audio to 44.1 kHz (what the model expects), hands the
   channel data to the worker, and relays progress. Returns the vocal and
   instrumental stems as channel Float32Arrays plus the sample rate, ready to be
   wrapped in an AudioBuffer for playback / WAV export.

   The worker is created lazily and kept alive between runs so the model stays
   resident (a second separation skips the download + init). */

import { MDX_SR } from './mdx-separate.js';

let worker = null;
function getWorker() {
  if (!worker) worker = new Worker(new URL('./mdx-worker.js', import.meta.url), { type: 'module' });
  return worker;
}
// Monotonic id so replies from the shared worker can be matched to their request.
// Two overlapping separations would otherwise each consume the other's progress/
// done/error messages and both resolve with the first job's result.
let _jobSeq = 0;

// Resample to 44.1 kHz (stereo, or mono if that's all there is) via an
// OfflineAudioContext, returning detachable Float32Array channels.
async function toModelChannels(audioBuffer) {
  const nCh = Math.min(2, audioBuffer.numberOfChannels);
  if (audioBuffer.sampleRate === MDX_SR) {
    const chs = [];
    for (let c = 0; c < nCh; c++) chs.push(audioBuffer.getChannelData(c).slice());
    return { channels: chs, sampleRate: MDX_SR };
  }
  const OAC = self.OfflineAudioContext || self.webkitOfflineAudioContext;
  const len = Math.max(1, Math.ceil(audioBuffer.duration * MDX_SR));
  const off = new OAC(nCh, len, MDX_SR);
  const src = off.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  const chs = [];
  for (let c = 0; c < rendered.numberOfChannels; c++) chs.push(rendered.getChannelData(c).slice());
  return { channels: chs, sampleRate: MDX_SR };
}

/**
 * Separate an AudioBuffer into vocal + instrumental stems using the MDX-Net model.
 * @param {AudioBuffer} audioBuffer
 * @param {{ onProgress?: (phase:'model'|'infer', frac:number)=>void, signal?: AbortSignal, modelId?: string }} [opts]
 * @returns {Promise<{ vocals: Float32Array[], instrumental: Float32Array[], sampleRate: number, stem: string }>}
 */
export async function separateStems(audioBuffer, { onProgress, signal, modelId } = {}) {
  const { channels, sampleRate } = await toModelChannels(audioBuffer);
  const w = getWorker();
  const jobId = ++_jobSeq;
  return new Promise((resolve, reject) => {
    const onMsg = (e) => {
      const m = e.data;
      if (!m || m.jobId !== jobId) return;   // ignore replies belonging to another job
      if (m.type === 'progress') { if (onProgress) onProgress(m.phase, m.frac); }
      else if (m.type === 'done') { cleanup(); resolve(m); }
      else if (m.type === 'error') { cleanup(); reject(new Error(m.message || 'separation failed')); }
    };
    const onAbort = () => {
      cleanup();
      // Kill the worker so an in-flight inference actually stops; next run re-inits.
      try { if (worker) { worker.terminate(); worker = null; } } catch (_) {}
      reject(new DOMException('separation aborted', 'AbortError'));
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
    w.postMessage({ type: 'separate', channels, sampleRate, modelId, jobId }, channels.map((c) => c.buffer));
  });
}
