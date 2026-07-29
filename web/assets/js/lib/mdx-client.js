/* Analyser - main-thread client for the MDX-Net vocal-separation worker.

   Resamples decoded audio to 44.1 kHz, transfers detachable channel arrays to one
   serial worker, and converts worker/runtime failures into visible rejections. */

import { MDX_SR } from './mdx-separate.js';

const STALL_MS = 5 * 60 * 1000;
let worker = null;
let jobSeq = 0;
let jobQueue = Promise.resolve();

function abortError() {
  return new DOMException('separation aborted', 'AbortError');
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) throw abortError();
}

function getWorker() {
  if (!worker) worker = new Worker(new URL('./mdx-worker.js', import.meta.url), { type: 'module' });
  return worker;
}

// Serialise callers before they resample: compare/inline panels share one worker
// and its single mutable ONNX session.
function enqueue(task) {
  const queued = jobQueue.then(task, task);
  jobQueue = queued.catch(() => {});
  return queued;
}

async function toModelChannels(audioBuffer, signal) {
  throwIfAborted(signal);
  const nCh = Math.min(2, audioBuffer.numberOfChannels);
  if (audioBuffer.sampleRate === MDX_SR) {
    const channels = [];
    for (let c = 0; c < nCh; c++) {
      throwIfAborted(signal);
      channels.push(audioBuffer.getChannelData(c).slice());
    }
    return { channels, sampleRate: MDX_SR };
  }

  const OAC = self.OfflineAudioContext || self.webkitOfflineAudioContext;
  const len = Math.max(1, Math.ceil(audioBuffer.duration * MDX_SR));
  const offline = new OAC(nCh, len, MDX_SR);
  const source = offline.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  throwIfAborted(signal);
  const channels = [];
  for (let c = 0; c < rendered.numberOfChannels; c++) {
    throwIfAborted(signal);
    channels.push(rendered.getChannelData(c).slice());
  }
  return { channels, sampleRate: MDX_SR };
}

function runWorker(channels, sampleRate, { onProgress, signal, modelId }) {
  const w = getWorker();
  const jobId = ++jobSeq;
  return new Promise((resolve, reject) => {
    let settled = false;
    let stallTimer = 0;

    const armStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => failWorker(
        new Error('AI worker stopped responding during model initialisation or separation')
      ), STALL_MS);
    };
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
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const failWorker = (err) => {
      detachWorker();
      finish(reject, err);
    };
    const onMessage = (e) => {
      const msg = e.data;
      if (!msg || msg.jobId !== jobId) return;
      armStallTimer();
      if (msg.type === 'progress') {
        if (onProgress) onProgress(msg.phase, msg.frac);
      } else if (msg.type === 'done') {
        finish(resolve, msg);
      } else if (msg.type === 'error') {
        finish(reject, new Error(msg.message || 'separation failed'));
      }
    };
    const onError = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      failWorker(new Error((e && e.message) || 'AI worker crashed'));
    };
    const onMessageError = () => {
      failWorker(new Error('AI worker returned an unreadable result'));
    };
    const onAbort = () => {
      detachWorker();
      finish(reject, abortError());
    };

    if (signal && signal.aborted) { onAbort(); return; }
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.addEventListener('messageerror', onMessageError);
    if (signal) signal.addEventListener('abort', onAbort);
    armStallTimer();
    try {
      w.postMessage({ type: 'separate', channels, sampleRate, modelId, jobId },
        channels.map((channel) => channel.buffer));
    } catch (err) {
      failWorker(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * Separate an AudioBuffer into vocal and instrumental stems.
 * @param {AudioBuffer} audioBuffer
 * @param {{ onProgress?: (phase:'model'|'cache'|'runtime'|'infer', frac:number)=>void, signal?: AbortSignal, modelId?: string }} [opts]
 */
export function separateStems(audioBuffer, { onProgress, signal, modelId } = {}) {
  return enqueue(async () => {
    throwIfAborted(signal);
    const { channels, sampleRate } = await toModelChannels(audioBuffer, signal);
    throwIfAborted(signal);
    return runWorker(channels, sampleRate, { onProgress, signal, modelId });
  });
}
