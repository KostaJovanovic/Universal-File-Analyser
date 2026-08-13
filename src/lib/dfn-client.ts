/* Analyser - main-thread client for the DeepFilterNet3 denoise worker.

   The denoise twin of mdx-client.js. Resamples the decoded audio to 48 kHz (what
   the model expects), hands the channel data to the worker, and relays progress.
   Returns the clean and noise stems as channel Float32Arrays plus the sample rate,
   ready to be wrapped in AudioBuffers for playback / WAV export.

   The worker is created lazily and kept alive between runs so the model stays
   resident (a second denoise skips the download + init). */

import { DFN_SR } from './dfn-enhance.js';

const STALL_MS = 5 * 60 * 1000;
const RUNTIME_STALL_MS = 2 * 60 * 1000;
let worker: Worker|null = null;
let jobSeq = 0;
let jobQueue: Promise<unknown> = Promise.resolve();

function getWorker() {
  if (!worker) worker = new Worker(new URL('./dfn-worker.js', import.meta.url), { type: 'module' });
  return worker;
}

function abortError() {
  return new DOMException('denoise aborted', 'AbortError');
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) throw abortError();
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const queued = jobQueue.then(task, task);
  jobQueue = queued.catch(() => {});
  return queued;
}

// Resample to 48 kHz (stereo, or mono if that's all there is) via an
// OfflineAudioContext, returning detachable Float32Array channels.
async function toModelChannels(audioBuffer: AudioBuffer|null, signal) {
  throwIfAborted(signal);
  const nCh = Math.min(2, audioBuffer.numberOfChannels);
  if (audioBuffer.sampleRate === DFN_SR) {
    const chs = [];
    for (let c = 0; c < nCh; c++) {
      throwIfAborted(signal);
      chs.push(audioBuffer.getChannelData(c).slice());
    }
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
  throwIfAborted(signal);
  const chs = [];
  for (let c = 0; c < rendered.numberOfChannels; c++) {
    throwIfAborted(signal);
    chs.push(rendered.getChannelData(c).slice());
  }
  return { channels: chs, sampleRate: DFN_SR };
}

/** What the worker's `done` message carries back: the two separated stems as
 *  per-channel Float32Arrays, at the model's own sample rate. */
export interface DenoiseResult {
  clean: Float32Array[];
  noise: Float32Array[];
  sampleRate: number;
}

function runWorker(channels: any[], sampleRate: number, { onProgress, signal }): Promise<DenoiseResult> {
  const w = getWorker();
  const jobId = ++jobSeq;
  return new Promise<DenoiseResult>((resolve, reject) => {
    let settled = false;
    let stallTimer = 0;

    const detachWorker = () => {
      try { w.terminate(); } catch (_) {}
      if (worker === w) worker = null;
    };
    const cleanup = () => {
      clearTimeout(stallTimer);
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      w.removeEventListener('messageerror', onMessageError);
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    const finish = (fn, value: DOMException) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const failWorker = (err: Error) => {
      detachWorker();
      finish(reject, err);
    };
    const armStallTimer = (phase: string) => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => failWorker(
        new Error('Denoise worker stopped responding during model initialisation or processing')
      ), phase === 'runtime' ? RUNTIME_STALL_MS : STALL_MS);
    };
    const onMessage = (e) => {
      const msg = e.data;
      if (!msg || msg.jobId !== jobId) return;
      armStallTimer(msg.type === 'progress' ? msg.phase : '');
      if (msg.type === 'progress') {
        if (onProgress) onProgress(msg.phase, msg.frac);
      } else if (msg.type === 'done') {
        finish(resolve, msg);
      } else if (msg.type === 'error') {
        failWorker(new Error(msg.message || 'denoise failed'));
      }
    };
    const onError = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      failWorker(new Error((e && e.message) || 'Denoise worker crashed'));
    };
    const onMessageError = () => failWorker(new Error('Denoise worker returned an unreadable result'));
    const onAbort = () => {
      detachWorker();
      finish(reject, abortError());
    };

    if (signal && signal.aborted) { onAbort(); return; }
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.addEventListener('messageerror', onMessageError);
    if (signal) signal.addEventListener('abort', onAbort);
    armStallTimer('');
    try {
      w.postMessage({ type: 'denoise', channels, sampleRate, jobId },
        channels.map((channel) => channel.buffer));
    } catch (err) {
      failWorker(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * Denoise an AudioBuffer into clean + noise stems using DeepFilterNet3.
 * @param {AudioBuffer} audioBuffer
 * @param {{ onProgress?: (phase:'model'|'model-cache'|'cache'|'cache-warning'|'runtime'|'infer', frac:number)=>void, signal?: AbortSignal }} [opts]
 * @returns {Promise<{ clean: Float32Array[], noise: Float32Array[], sampleRate: number }>}
 */
export function enhanceAudio(audioBuffer: AudioBuffer|null, { onProgress, signal } : any = {}) {
  return enqueue(async () => {
    throwIfAborted(signal);
    const { channels, sampleRate } = await toModelChannels(audioBuffer, signal);
    throwIfAborted(signal);
    return runWorker(channels, sampleRate, { onProgress, signal });
  });
}
