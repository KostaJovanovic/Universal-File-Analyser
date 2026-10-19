/* Analyser - module worker for streaming file hashes (lib/hash-stream.ts).

   Gets the File itself (a File posts by reference - nothing is copied), reads it
   one slice at a time and posts progress, so hashing a multi-GB file neither
   holds it in memory nor stalls the page. Stateless: lib/hash-client.ts keeps
   one alive and terminates it to abort a job. */

import { hashBlob } from './hash-stream.js';

self.addEventListener('message', async (e: MessageEvent) => {
  const { jobId, file, algos, chunk } = e.data || {};
  try {
    const out = await hashBlob(file, algos, chunk, (frac) => self.postMessage({ type: 'progress', jobId, frac }));
    self.postMessage({ type: 'done', jobId, out });
  } catch (err) {
    self.postMessage({ type: 'error', jobId, message: (err && err.message) || String(err) });
  }
});
