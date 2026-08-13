/* Analyser - main-thread client for the MDX-Net vocal-separation worker.

   Resamples decoded audio to 44.1 kHz, transfers detachable channel arrays to one
   serial worker, and converts worker/runtime failures into visible rejections. */
import { MDX_SR } from './mdx-separate.js';
const STALL_MS = 5 * 60 * 1000;
const RUNTIME_STALL_MS = 2 * 60 * 1000;
const FIRST_INFER_STALL_MS = 2 * 60 * 1000;
let worker = null;
let jobSeq = 0;
let jobQueue = Promise.resolve();
function abortError() {
    return new DOMException('separation aborted', 'AbortError');
}
function workerError(message, code) {
    // The renderer switches on err.code to tell 'model download failed' from a
    // genuine processing failure, so the tag rides along on the Error.
    const err = new Error(message);
    err.code = code;
    return err;
}
function throwIfAborted(signal) {
    if (signal && signal.aborted)
        throw abortError();
}
function getWorker() {
    if (!worker)
        worker = new Worker(new URL('./mdx-worker.js', import.meta.url), { type: 'module' });
    return worker;
}
function isAppleWebKit() {
    try {
        const ua = (self.navigator && self.navigator.userAgent) || '';
        return /iP(hone|ad|od)/.test(ua)
            || (/Macintosh/.test(ua) && self.navigator.maxTouchPoints > 1);
    }
    catch (_) {
        return false;
    }
}
// Serialise callers before they resample: compare/inline panels share one worker
// and its single mutable ONNX session.
function enqueue(task) {
    const queued = jobQueue.then(task, task);
    jobQueue = queued.catch(() => { });
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
function workerRequest(payload, transfer, { onProgress, signal, doneType }) {
    const w = getWorker();
    const jobId = ++jobSeq;
    return new Promise((resolve, reject) => {
        let settled = false;
        let stallTimer = 0;
        const armStallTimer = (phase) => {
            clearTimeout(stallTimer);
            const timeout = phase === 'runtime' ? RUNTIME_STALL_MS
                : phase === 'infer-start' && isAppleWebKit() ? FIRST_INFER_STALL_MS
                    : STALL_MS;
            stallTimer = setTimeout(() => failWorker(workerError('AI worker stopped responding during model initialisation or separation', 'AI_STALL')), timeout);
        };
        const detachWorker = () => {
            try {
                w.terminate();
            }
            catch (_) { }
            if (worker === w)
                worker = null;
        };
        const cleanup = () => {
            clearTimeout(stallTimer);
            w.removeEventListener('message', onMessage);
            w.removeEventListener('error', onError);
            w.removeEventListener('messageerror', onMessageError);
            if (signal)
                signal.removeEventListener('abort', onAbort);
        };
        const finish = (fn, value) => {
            if (settled)
                return;
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
            if (!msg || msg.jobId !== jobId)
                return;
            armStallTimer(msg.type === 'progress' ? msg.phase : '');
            if (msg.type === 'progress') {
                if (onProgress)
                    onProgress(msg.phase, msg.frac);
            }
            else if (msg.type === doneType) {
                if (msg.retireWorker)
                    detachWorker();
                finish(resolve, msg);
            }
            else if (msg.type === 'error') {
                failWorker(new Error(msg.message || 'separation failed'));
            }
        };
        const onError = (e) => {
            if (e && e.preventDefault)
                e.preventDefault();
            failWorker(workerError((e && e.message) || 'AI worker crashed', 'AI_WORKER_CRASH'));
        };
        const onMessageError = () => {
            failWorker(workerError('AI worker returned an unreadable result', 'AI_WORKER_CRASH'));
        };
        const onAbort = () => {
            detachWorker();
            finish(reject, abortError());
        };
        if (signal && signal.aborted) {
            onAbort();
            return;
        }
        w.addEventListener('message', onMessage);
        w.addEventListener('error', onError);
        w.addEventListener('messageerror', onMessageError);
        if (signal)
            signal.addEventListener('abort', onAbort);
        armStallTimer('');
        try {
            w.postMessage({ ...payload, jobId }, transfer || []);
        }
        catch (err) {
            failWorker(err instanceof Error ? err : new Error(String(err)));
        }
    });
}
function prepareWorker({ onProgress, signal, modelId, forceWasm = false }) {
    return workerRequest({ type: 'prepare', modelId, forceWasm }, [], { onProgress, signal, doneType: 'ready' });
}
function runWorker(channels, sampleRate, { onProgress, signal, modelId, forceWasm = false }) {
    return workerRequest({ type: 'separate', channels, sampleRate, modelId, forceWasm }, channels.map((channel) => channel.buffer), { onProgress, signal, doneType: 'done' });
}
/**
 * Separate an AudioBuffer into vocal and instrumental stems.
 * @param {AudioBuffer} audioBuffer
 * @param {{ onProgress?: (phase:'model'|'model-cache'|'cache'|'cache-warning'|'runtime'|'audio'|'fallback'|'infer-start'|'infer', frac:number)=>void, signal?: AbortSignal, modelId?: string }} [opts]
 */
export function separateStems(audioBuffer, { onProgress, signal, modelId } = {}) {
    return enqueue(async () => {
        throwIfAborted(signal);
        // A worker crash on iOS is usually memory pressure. Rebuilding the same ORT
        // heap and full-song channel copies immediately makes a second tab kill more
        // likely, while Apple devices already use WASM and gain nothing from the
        // WebGPU-to-WASM retry used elsewhere.
        const attempts = isAppleWebKit() ? 1 : 2;
        for (let attempt = 0; attempt < attempts; attempt++) {
            try {
                // Finish downloading/caching/compiling the model before making full-song
                // channel copies. On first use this keeps the model byte buffer and the
                // resampled PCM from occupying Mobile Safari's heap at the same time.
                await prepareWorker({
                    onProgress, signal, modelId, forceWasm: attempt > 0,
                });
                if (onProgress)
                    onProgress('audio', 0);
                const { channels, sampleRate } = await toModelChannels(audioBuffer, signal);
                throwIfAborted(signal);
                if (onProgress)
                    onProgress('audio', 1);
                // OfflineAudioContext and its rendered AudioBuffer are now out of scope.
                // Yield before transferring the owned copies so WebKit can reclaim them.
                await new Promise((resolve) => setTimeout(resolve, 0));
                return await runWorker(channels, sampleRate, {
                    onProgress, signal, modelId, forceWasm: attempt > 0,
                });
            }
            catch (err) {
                const recoverable = err && (err.code === 'AI_STALL' || err.code === 'AI_WORKER_CRASH');
                if (!recoverable || attempt + 1 >= attempts)
                    throw err;
                if (onProgress)
                    onProgress('fallback', 0);
                throwIfAborted(signal);
            }
        }
        throw new Error('separation failed');
    });
}
//# sourceMappingURL=mdx-client.js.map