/* Analyser - DeepFilterNet3 denoise Web Worker (module worker).

   The denoise twin of mdx-worker.js. Runs off the main thread: loads
   onnxruntime-web (single-thread WASM, WebGPU where safe), downloads the pinned
   deepfilter.onnx with byte progress, then drives the pure pipeline in
   dfn-enhance.js, feeding each block of frames through the ONNX session. Posts
   { progress | done | error } back to dfn-client.js.

   The runtime + model come from the URLs the offline tier caches, so once
   downloaded the whole thing works offline. The runtime is shared with the MDX
   worker's download (same ORT files / CDN). */

import { ORT_BASE, ORT_ENTRY, DFN_MODEL } from './dfn-model.js';
import { DFN } from './dfn-dsp.js';
import { enhanceAudio } from './dfn-enhance.js';

let ortMod = null;        // onnxruntime-web module namespace
let session = null;       // InferenceSession (kept warm across runs)
let ioMap = null;         // resolved { erbIn, specIn, maskOut, coefOut } tensor names

// True on any WebKit engine. ORT's WebGPU (jsep) backend is unstable there and can
// hard-crash the GPU/tab process, so we force the single-threaded WASM path on
// WebKit (mirrors mdx-worker.js).
function isWebKit() {
  try {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    const iOS = /iP(hone|ad|od)/.test(ua)
      || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
    const appleWebKit = /AppleWebKit/.test(ua) && !/Chrom(e|ium)|Android/.test(ua);
    return iOS || appleWebKit;
  } catch (_) { return false; }
}

// The URL is immutable, so this cache can safely survive reloads and releases.
const DFN_CACHE = 'analyser-dfn-v2';

async function deleteCachedUrl(url) {
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map(async (key) => {
      try { await (await caches.open(key)).delete(url); } catch (_) {}
    }));
  } catch (_) {}
}

async function cachedModel(model) {
  try {
    const cache = await caches.open(DFN_CACHE);
    const owned = await cache.match(model.url);
    const resp = owned || await caches.match(model.url);
    if (!resp) return null;
    const bytes = new Uint8Array(await resp.arrayBuffer());
    if (model.bytes && bytes.length !== model.bytes) {
      await deleteCachedUrl(model.url);
      return null;
    }
    return bytes;
  } catch (_) { return null; }
}

async function storeModel(url, bytes) {
  try {
    const cache = await caches.open(DFN_CACHE);
    await cache.put(url, new Response(bytes));
    return true;
  } catch (_) { return false; }
}

// Stream directly into one exact-sized allocation so a corrupt or replaced
// remote object fails before it can double memory use at 100%.
async function fetchWithProgress(url, expectedBytes, onProg) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('model download failed (' + resp.status + ')');
  const reportedBytes = Number(resp.headers.get('content-length')) || 0;
  if (expectedBytes && reportedBytes && reportedBytes !== expectedBytes) {
    throw new Error('model download size did not match the pinned revision');
  }
  if (!resp.body || !expectedBytes) {
    const out = new Uint8Array(await resp.arrayBuffer());
    if (expectedBytes && out.length !== expectedBytes) throw new Error('model download was incomplete');
    if (onProg) onProg(1);
    return out;
  }
  const reader = resp.body.getReader();
  const out = new Uint8Array(expectedBytes);
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || !value.length) continue;
    if (received + value.length > out.length) {
      try { await reader.cancel(); } catch (_) {}
      throw new Error('model download exceeded the pinned size');
    }
    out.set(value, received);
    received += value.length;
    if (onProg) onProg(Math.min(1, received / expectedBytes));
  }
  if (received !== expectedBytes) throw new Error('model download was incomplete');
  if (onProg) onProg(1);
  return out;
}

// Resolve the model's two input and two output tensor names by their documented
// names, falling back to shape: feat_erb ends in nbErb, feat_spec in nbDf; the
// rank-5 output is df_coefs, the other is erb_mask.
function resolveIo(sess) {
  const ins = sess.inputNames, outs = sess.outputNames;
  let erbIn = ins.find((n) => /erb/i.test(n));
  let specIn = ins.find((n) => /spec|cplx|df/i.test(n));
  if (!erbIn || !specIn || erbIn === specIn) { erbIn = ins[0]; specIn = ins[1]; }
  let maskOut = outs.find((n) => /mask|erb|gain/i.test(n));
  let coefOut = outs.find((n) => /coef|df|filter/i.test(n));
  if (!maskOut || !coefOut || maskOut === coefOut) { maskOut = outs[0]; coefOut = outs[1]; }
  return { erbIn, specIn, maskOut, coefOut };
}

async function ensureModel(report) {
  if (session) return;
  let bytes = await cachedModel(DFN_MODEL);
  if (bytes) {
    if (report) report('model-cache', 1);
  }
  else {
    bytes = await fetchWithProgress(
      DFN_MODEL.url,
      DFN_MODEL.bytes,
      (frac) => { if (report) report('model', frac); }
    );
    if (report) report('cache', 0);
    const stored = await storeModel(DFN_MODEL.url, bytes);
    if (report) report(stored ? 'cache' : 'cache-warning', stored ? 1 : 0);
  }

  if (!ortMod) {
    if (report) report('runtime', 0);
    ortMod = await import(/* @vite-ignore */ ORT_ENTRY);
    ortMod.env.wasm.wasmPaths = ORT_BASE;
    ortMod.env.wasm.numThreads = 1;
    ortMod.env.wasm.simd = true;
    ortMod.env.wasm.proxy = false;
    try { ortMod.env.logLevel = 'error'; } catch (_) {}
    if (report) report('runtime', 0.1);
  }
  // Force the WASM backend for DeepFilterNet3 on every engine, not just WebKit.
  // DFN3 is a GRU-based recurrent graph, and ORT-web's WebGPU (jsep) backend
  // miscomputes it: verified against onnxruntime-node (CPU) on the same input, the
  // WASM/CPU path denoises correctly (clean keeps the voice) while WebGPU produced a
  // near-silent, phase-scrambled clean stem with the whole voice pushed into the
  // noise track. WebGPU-vs-WASM output divergence is a known ORT-web class of bug
  // (microsoft/onnxruntime #24070, #15796). WASM single-thread is plenty fast for a
  // speech-sized model, so correctness wins here. isWebKit() is kept only for the
  // (now redundant) documentation of why WebKit also avoids WebGPU.
  void isWebKit;
  const executionProviders = ['wasm'];
  if (report) report('runtime', 0.25);
  session = await ortMod.InferenceSession.create(bytes, { executionProviders });
  ioMap = resolveIo(session);
  if (report) report('runtime', 1);
}

// One graph pass over P frames: feat_erb [1,1,P,32], feat_spec [1,2,P,96] ->
// erb_mask [1,1,P,32], df_coefs [1,5,P,96,2]. Returns the two output Float32Arrays.
async function runModel(featErb, featSpec, P) {
  const { nbErb, nbDf, dfOrder } = DFN;
  const T = ortMod.Tensor;
  const feeds: any = {};
  feeds[ioMap.erbIn] = new T('float32', featErb, [1, 1, P, nbErb]);
  feeds[ioMap.specIn] = new T('float32', featSpec, [1, 2, P, nbDf]);
  const res = await session.run(feeds);
  const mask = res[ioMap.maskOut];
  const coef = res[ioMap.coefOut];
  const erbMask = (mask.data && mask.data.length) ? mask.data : (mask.getData ? await mask.getData() : mask.data);
  const dfCoefs = (coef.data && coef.data.length) ? coef.data : (coef.getData ? await coef.getData() : coef.data);
  return { erbMask, dfCoefs };
}

async function handleDenoise(msg) {
  const jobId = msg.jobId;
  try {
    await ensureModel((phase, frac) => {
      self.postMessage({ type: 'progress', phase, frac, jobId });
    });
    self.postMessage({ type: 'progress', phase: 'infer', frac: 0, jobId });
    const result = await enhanceAudio({
      channels: msg.channels,
      runModel,
      onProgress: (frac) => self.postMessage({ type: 'progress', phase: 'infer', frac, jobId }),
    });
    const transfer = [];
    for (const a of result.clean) transfer.push(a.buffer);
    for (const a of result.noise) transfer.push(a.buffer);
    self.postMessage({
      type: 'done',
      clean: result.clean,
      noise: result.noise,
      sampleRate: result.sampleRate,
      jobId,
    }, transfer);
  } catch (err) {
    self.postMessage({ type: 'error', message: (err && err.message) || String(err), jobId });
  }
}

let jobQueue = Promise.resolve();
self.onmessage = (e) => {
  const msg = e.data;
  if (!msg || msg.type !== 'denoise') return;
  jobQueue = jobQueue.then(() => handleDenoise(msg), () => handleDenoise(msg));
};
