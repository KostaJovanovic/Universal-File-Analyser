/* Analyser - MDX-Net vocal separation Web Worker (module worker).

   Runs entirely off the main thread: loads onnxruntime-web (WASM, single-thread -
   the site is not cross-origin isolated so SharedArrayBuffer threading is out),
   downloads the pinned model with byte progress, then drives the pure framing
   pipeline in mdx-separate.js, feeding each [1,4,dim_f,dim_t] tensor through the
   ONNX session. Posts { progress | done | error } back to mdx-client.js.

   Everything heavy (ORT runtime + model) is fetched from the URLs the Complete
   offline tier caches, so once downloaded the whole thing works offline. */

import { ORT_BASE, ORT_ENTRY, MDX_MODEL } from './mdx-model.js';
import { separateVocals } from './mdx-separate.js';

let ortMod = null;    // the onnxruntime-web module namespace
let session = null;   // the InferenceSession (kept warm across runs)

// Stream the model into memory with progress, so the 60 MB+ download drives a
// real bar instead of a dead spinner. Falls back to a plain arrayBuffer() if the
// body isn't streamable or the length is unknown.
async function fetchWithProgress(url, approxTotal, onProg) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('model download failed (' + resp.status + ')');
  const total = Number(resp.headers.get('content-length')) || approxTotal || 0;
  if (!resp.body || !total) {
    const buf = await resp.arrayBuffer();
    return new Uint8Array(buf);
  }
  const reader = resp.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (onProg) onProg(Math.min(1, received / total));
  }
  const out = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

async function ensureModel(onDownload) {
  if (session) return;
  if (!ortMod) {
    ortMod = await import(/* @vite-ignore */ ORT_ENTRY);
    ortMod.env.wasm.wasmPaths = ORT_BASE;
    ortMod.env.wasm.numThreads = 1;   // no COOP/COEP -> no SharedArrayBuffer threads
    ortMod.env.wasm.simd = true;
    ortMod.env.wasm.proxy = false;
    try { ortMod.env.logLevel = 'error'; } catch (_) {}
  }
  const bytes = await fetchWithProgress(MDX_MODEL.url, MDX_MODEL.bytes, onDownload);
  // Prefer the GPU (WebGPU) where available - typically many times faster - and
  // fall back to single-threaded WASM automatically on browsers without it.
  session = await ortMod.InferenceSession.create(bytes, { executionProviders: ['webgpu', 'wasm'] });
}

// One model pass over a packed [1,4,dim_f,dim_t] tensor -> predicted vocal
// spectrogram (same shape, as a Float32Array). Input/output tensor names are
// read from the session so we don't hard-code the model's export names.
async function runModel(input, dims) {
  const t = new ortMod.Tensor('float32', input, dims);
  const feeds = {};
  feeds[session.inputNames[0]] = t;
  const res = await session.run(feeds);
  const out = res[session.outputNames[0]];
  // On the WASM path .data is already the CPU Float32Array; on WebGPU the output
  // defaults to a CPU tensor too, but guard with getData() in case a build returns
  // a GPU-resident tensor that needs an explicit download.
  if (out.data && out.data.length) return out.data;
  if (typeof out.getData === 'function') return await out.getData();
  return out.data;
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (!msg || msg.type !== 'separate') return;
  try {
    await ensureModel((frac) => self.postMessage({ type: 'progress', phase: 'model', frac }));
    self.postMessage({ type: 'progress', phase: 'infer', frac: 0 });
    const result = await separateVocals({
      channels: msg.channels,
      model: MDX_MODEL,
      runModel,
      onProgress: (frac) => self.postMessage({ type: 'progress', phase: 'infer', frac }),
    });
    const transfer = [];
    for (const a of result.vocals) transfer.push(a.buffer);
    for (const a of result.instrumental) transfer.push(a.buffer);
    self.postMessage({
      type: 'done',
      vocals: result.vocals,
      instrumental: result.instrumental,
      sampleRate: result.sampleRate,
      stem: MDX_MODEL.stem,
    }, transfer);
  } catch (err) {
    self.postMessage({ type: 'error', message: (err && err.message) || String(err) });
  }
};
