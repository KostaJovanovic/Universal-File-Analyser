/* Analyser - MDX-Net vocal separation Web Worker (module worker).

   Runs entirely off the main thread: loads onnxruntime-web, downloads or reads
   the revision-pinned model, initialises one warm inference session, then drives
   the framing pipeline in mdx-separate.js. Every long phase is reported so the
   UI never leaves a completed download masquerading as a frozen job. */

import { ORT_BASE, ORT_ENTRY, MDX_MODELS, MDX_MODEL } from './mdx-model.js';
import { separateVocals, MDX_SR } from './mdx-separate.js';

let ortMod = null;
let session = null;
let loadedModelId = null;

// All iOS browsers use WebKit. ORT's WebGPU/JSEP path can crash the GPU or tab
// there, so Apple engines stay on the stable single-threaded WASM backend.
function isWebKit() {
  try {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    const iOS = /iP(hone|ad|od)/.test(ua)
      || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const appleWebKit = /AppleWebKit/.test(ua) && !/Chrom(e|ium)|Android/.test(ua);
    return iOS || appleWebKit;
  } catch (_) { return false; }
}

// The old analyser-mdx bucket could contain the removed Heavy models. sw.js drops
// it during activation; this new bucket contains only immutable Standard/Lite URLs.
const MDX_CACHE = 'analyser-mdx-v2';

async function cachedModel(model) {
  try {
    const cache = await caches.open(MDX_CACHE);
    // Complete may already hold Standard in analyser-offline. Search our own
    // bucket first, then all caches, so first use does not duplicate another
    // full model merely to initialise the worker.
    const owned = await cache.match(model.url);
    const resp = owned || await caches.match(model.url);
    if (!resp) return null;
    const bytes = new Uint8Array(await resp.arrayBuffer());
    if (model.bytes && bytes.length !== model.bytes) {
      if (owned) await cache.delete(model.url);
      return null;
    }
    return bytes;
  } catch (_) { return null; }
}

async function storeModel(url, bytes) {
  try {
    const cache = await caches.open(MDX_CACHE);
    await cache.put(url, new Response(bytes));
  } catch (_) {}
}

// Fill one pre-sized buffer directly. The former chunks[] + concat path held two
// full model copies at 100%, exactly when mobile memory pressure is highest.
async function fetchWithProgress(url, expectedBytes, onProgress) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('model download failed (' + resp.status + ')');
  const reportedBytes = Number(resp.headers.get('content-length')) || 0;
  const expected = expectedBytes || reportedBytes;
  const progressTotal = reportedBytes || expected;

  if (!resp.body || !expected) {
    const out = new Uint8Array(await resp.arrayBuffer());
    if (expectedBytes && out.length !== expectedBytes) throw new Error('model download was incomplete');
    if (onProgress) onProgress(1);
    return out;
  }

  const reader = resp.body.getReader();
  let out = new Uint8Array(expected);
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || !value.length) continue;
    if (received + value.length > out.length) {
      const grown = new Uint8Array(Math.max(received + value.length, out.length * 2));
      grown.set(out);
      out = grown;
    }
    out.set(value, received);
    received += value.length;
    if (onProgress && progressTotal) onProgress(Math.min(1, received / progressTotal));
  }
  if (expectedBytes && received !== expectedBytes) throw new Error('model download was incomplete');
  if (onProgress) onProgress(1);
  return received === out.length ? out : out.slice(0, received);
}

async function ensureModel(model, report) {
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

  if (session && loadedModelId === model.id) return;
  if (session) {
    try { if (session.release) session.release(); } catch (_) {}
    session = null;
    loadedModelId = null;
  }

  let bytes = await cachedModel(model);
  if (bytes) {
    if (report) report('model', 1);
  } else {
    bytes = await fetchWithProgress(model.url, model.bytes,
      (frac) => { if (report) report('model', frac); });
    if (report) report('cache', 0);
    await storeModel(model.url, bytes);
    if (report) report('cache', 1);
  }

  if (report) report('runtime', 0.25);
  const canUseWebGpu = !isWebKit() && !!(self.navigator && self.navigator.gpu);
  try {
    session = await ortMod.InferenceSession.create(bytes, {
      executionProviders: canUseWebGpu ? ['webgpu', 'wasm'] : ['wasm'],
    });
  } catch (err) {
    // Some Android devices advertise WebGPU but cannot initialise this graph.
    // Retry on WASM rather than leaving the final model-download state visible.
    if (!canUseWebGpu) throw err;
    session = await ortMod.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  }
  loadedModelId = model.id;
  if (report) report('runtime', 1);
}

async function runModel(input, dims) {
  const tensor = new ortMod.Tensor('float32', input, dims);
  const feeds = {};
  feeds[session.inputNames[0]] = tensor;
  const results = await session.run(feeds);
  const out = results[session.outputNames[0]];
  if (out.data && out.data.length) return out.data;
  if (typeof out.getData === 'function') return await out.getData();
  return out.data;
}

async function handleSeparate(msg) {
  const jobId = msg.jobId;
  try {
    const model = MDX_MODELS[msg.modelId] || MDX_MODEL;
    await ensureModel(model, (phase, frac) => {
      self.postMessage({ type: 'progress', phase, frac, jobId });
    });
    self.postMessage({ type: 'progress', phase: 'infer', frac: 0, jobId });
    const result = await separateVocals({
      channels: msg.channels,
      model,
      runModel,
      onProgress: (frac) => self.postMessage({ type: 'progress', phase: 'infer', frac, jobId }),
    });
    self.postMessage({
      type: 'done',
      vocals: result.vocals,
      instrumental: result.instrumental,
      sampleRate: MDX_SR,
      stem: result.stem,
      jobId,
    }, [
      result.vocals[0].buffer, result.vocals[1].buffer,
      result.instrumental[0].buffer, result.instrumental[1].buffer,
    ]);
  } catch (err) {
    self.postMessage({ type: 'error', message: (err && err.message) || String(err), jobId });
  }
}

// One mutable ONNX session serves the worker. Serialisation protects compare and
// inline panels that can otherwise post two jobs before either one finishes.
let jobQueue = Promise.resolve();
self.onmessage = (e) => {
  const msg = e.data;
  if (!msg || msg.type !== 'separate') return;
  jobQueue = jobQueue.then(() => handleSeparate(msg), () => handleSeparate(msg));
};
