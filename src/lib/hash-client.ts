/* Analyser - main-thread client for streaming file hashes.

   hashFileStreamed() runs lib/hash-stream.ts over a File in HASH_STREAM_CHUNK
   slices inside lib/hash-worker.ts, reporting 0..1 progress, and resolves
   { algo: hex }. Memory stays at one slice whatever the file's size. If module
   workers are unavailable or the worker fails to start, the same code runs on
   the main thread instead, yielding between slices - slower to the eye, same
   answer. core/util.ts loads this lazily, only for files too large to hand to
   crypto.subtle whole. In the desktop app the main process hashes the file
   from disk instead, when it can (anrDesktop.hash). */

import { hashBlob, type HashAlgo } from './hash-stream.js';
import { HASH_STREAM_CHUNK } from '../core/limits.js';
import { desktopFileToken } from '../core/util.js';

let worker: Worker | null = null;
let _jobSeq = 0;
// Every job waiting on the shared worker, so a dead worker settles all of them.
const _jobs = new Map<number, (err: Error) => void>();

function getWorker() {
  if (!worker) worker = new Worker(new URL('./hash-worker.js', import.meta.url), { type: 'module' });
  return worker;
}
function killWorker(err: Error) {
  try { if (worker) { worker.terminate(); worker = null; } } catch (_) {}
  for (const [, fail] of [..._jobs]) fail(err);
}

function inWorker(file: Blob, algos: HashAlgo[], onProgress?: ((frac: number) => void) | null) {
  return new Promise<Partial<Record<HashAlgo, string>>>((resolve, reject) => {
    let w: Worker;
    try { w = getWorker(); } catch (e) { reject(e); return; }
    const jobId = ++_jobSeq;
    const onMsg = (e: MessageEvent) => {
      const m = e.data;
      if (!m || m.jobId !== jobId) return;
      if (m.type === 'progress') { if (onProgress) { try { onProgress(m.frac); } catch (_) {} } }
      else if (m.type === 'done') { cleanup(); resolve(m.out); }
      else if (m.type === 'error') { cleanup(); reject(new Error(m.message || 'hashing failed')); }
    };
    const onErr = () => { cleanup(); if (worker === w) killWorker(new Error('hash worker failed to start')); reject(new Error('hash worker failed to start')); };
    function cleanup() {
      _jobs.delete(jobId);
      w.removeEventListener('message', onMsg);
      w.removeEventListener('error', onErr);
    }
    _jobs.set(jobId, (err: Error) => { cleanup(); reject(err); });
    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr);
    w.postMessage({ jobId, file, algos, chunk: HASH_STREAM_CHUNK });
  });
}

/** Hash `file` with every algorithm in `algos` in one streamed pass. In the
 *  desktop app a file the user opened is hashed from disk by the main process
 *  first (Node's native hashes, at disk speed); anything it cannot do comes
 *  back null and runs here as on the website. */
export async function hashFileStreamed(file: Blob, algos: HashAlgo[], onProgress?: ((frac: number) => void) | null) {
  const d = window.anrDesktop;
  if (d && d.hash) {
    const token = await desktopFileToken(file);
    if (token) {
      let out: Record<string, string> | null = null;
      try { out = await d.hash(token, algos, onProgress); } catch (_) { out = null; }
      if (out && algos.every((a) => typeof out![a] === 'string')) return out as Partial<Record<HashAlgo, string>>;
    }
  }
  try {
    return await inWorker(file, algos, onProgress);
  } catch (_) {
    return await hashBlob(file, algos, HASH_STREAM_CHUNK, onProgress, true);
  }
}
