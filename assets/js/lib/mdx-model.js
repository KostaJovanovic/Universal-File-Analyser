/* Analyser - MDX-Net vocal-separation model + ONNX Runtime configuration.

   Single source of truth for: which vocal model we run, its STFT geometry, and
   the exact set of network files the "Complete" offline tier must cache so the
   whole feature works offline. Imported by both the inference worker (to load
   the runtime + model) and offline-tiers.js (to list the URLs for download).

   Model: Kim Vocal 2 (UVR MDX-Net). One of the best-quality vocal separators.
   Geometry (from UVR's model_data.json): n_fft 7680, dim_f 3072, dim_t 2^8=256,
   hop 1024, compensate 1.009, primary stem Vocals. Our mixed-radix FFT in
   mdx-stft.js handles the non-power-of-two 7680 (= 15 x 512), verified in Node.

   Hosting: the model is pulled from a HuggingFace mirror (resolve URLs send
   `access-control-allow-origin: *`, so the worker can actually READ the bytes -
   a GitHub release download only caches opaquely and can't be read back). The
   ONNX runtime is jsDelivr-hosted, pinned to ORT_VERSION. */

export const ORT_VERSION = '1.20.1';

// In a *production* native build (Tauri asset protocol) the runtime + model are
// vendored into the bundle by tools/build-dist.mjs and loaded locally, so the app
// works offline with no CDN round-trip and stays strict-CSP-clean. On the web -
// and in `tauri dev` (served from localhost) - they load from the CDN, because the
// 30 MB-class files exceed Cloudflare's 25 MiB per-asset cap. `location` is the
// worker's own location here (this module is imported by mdx-worker.js), which
// carries the same origin. See research/SPIKE-WEBKIT-RESULTS.md.
const NATIVE_SHELL = typeof location !== 'undefined' && (location.protocol === 'tauri:' || location.hostname === 'tauri.localhost');

export const ORT_BASE = NATIVE_SHELL
  ? '/assets/vendor/onnxruntime/'
  : 'https://cdn.jsdelivr.net/npm/onnxruntime-web@' + ORT_VERSION + '/dist/';

// The WebGPU-capable ESM entry (the "jsep" build). The worker requests
// ['webgpu', 'wasm'], so inference runs on the GPU where it's available
// (Chrome / Edge - typically many times faster) and transparently falls back to
// single-threaded WASM elsewhere (Firefox / Safari). We stay single-threaded on
// the WASM path because the site is not cross-origin isolated (no COOP/COEP), so
// SharedArrayBuffer threads are unavailable. The .jsep.wasm carries both paths.
export const ORT_ENTRY = ORT_BASE + 'ort.webgpu.min.mjs';
export const ORT_FILES = [
  ORT_ENTRY,
  ORT_BASE + 'ort-wasm-simd-threaded.jsep.mjs',
  ORT_BASE + 'ort-wasm-simd-threaded.jsep.wasm',
];

// Two selectable models, a quality/size trade-off. Both are Vocals-primary
// MDX-Net separators from the same CORS-enabled HuggingFace mirror, so the
// pipeline (mdx-separate.js) drives either straight from these geometry fields -
// and the STFT core (mdx-stft.js) already handles both n_fft 7680 and 6144.
//   - standard (Kim Vocal 2): the cleaner, heavier default.
//   - lite (UVR-MDX-NET 1): ~half the download and the smaller 6144/2048
//     geometry, so it needs less memory + compute per chunk - meant for phones
//     and slower machines, at a small cost in separation quality.
// The native build vendors each locally (see NATIVE_SHELL) for offline use; keep
// build-dist.mjs's VENDOR list in step with these filenames.
export const MDX_MODELS = {
  standard: {
    id: 'standard',
    name: 'Kim Vocal 2',
    label: 'Standard',       // shown in the picker + model prompt
    // Per-model blurb shown in the Separate prompt so each tier explains itself.
    blurb: 'the cleanest separation, a little heavier to download and run',
    url: NATIVE_SHELL
      ? '/assets/vendor/models/Kim_Vocal_2.onnx'
      : 'https://huggingface.co/seanghay/uvr_models/resolve/main/Kim_Vocal_2.onnx',
    bytes: 66759214,          // ~63.7 MB, for the size-warning popup
    tierMb: 85,               // model + ORT runtime, shown in the download prompt
    nFft: 7680,
    dimF: 3072,               // model input keeps the lowest 3072 freq bins
    dimT: 256,                // 2^8 frames per segment
    hop: 1024,
    compensate: 1.009,        // UVR magnitude compensation for this model
    stem: 'Vocals',
  },
  lite: {
    id: 'lite',
    name: 'UVR-MDX-NET 1',
    label: 'Lite',
    blurb: 'smaller and quicker and easier on memory - a good fit for phones and slower machines, at a small cost in separation quality',
    url: NATIVE_SHELL
      ? '/assets/vendor/models/UVR_MDXNET_1_9703.onnx'
      : 'https://huggingface.co/seanghay/uvr_models/resolve/main/UVR_MDXNET_1_9703.onnx',
    bytes: 29704436,          // ~28.3 MB
    tierMb: 50,               // model ~28 + ORT runtime ~21
    nFft: 6144,
    dimF: 2048,
    dimT: 256,
    hop: 1024,
    compensate: 1.035,        // UVR magnitude compensation for the classic MDX-NET
    stem: 'Vocals',
  },
};

// Default model. The offline tier and any caller that doesn't pick explicitly
// use this; the worker resolves the chosen id against MDX_MODELS.
export const MDX_MODEL = MDX_MODELS.standard;

// Everything the Complete offline tier must cache for offline AI separation. Only
// the default (standard) model is pre-cached; the lite model downloads on demand
// on the web and is vendored into the native bundle.
export const MDX_OFFLINE_URLS = [...ORT_FILES, MDX_MODEL.url];

// Approx download footprint of the AI feature, in MB (WebGPU/jsep runtime wasm
// ~20.7 + model ~63.7 + small glue). Used to bump the Complete tier's advertised
// size and shown in the one-off size warning before the first run.
export const MDX_TIER_MB = 85;
