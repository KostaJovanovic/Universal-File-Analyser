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

// The runtime + model stream from the CDN on demand - on the web and in the native
// shell alike (the native app loads the heavy WASM/models on demand just like the
// website, rather than bundling them; see build-dist.mjs). Keep ORT_VERSION + the
// model URLs below in step with build-dist.mjs's ORT constant.
export const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@' + ORT_VERSION + '/dist/';

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
export const MDX_MODELS = {
  standard: {
    id: 'standard',
    name: 'Kim Vocal 2',
    label: 'Standard',       // shown in the picker + model prompt
    // Per-model blurb shown in the Separate prompt so each tier explains itself.
    blurb: 'the cleanest separation, a little heavier to download and run',
    url: 'https://huggingface.co/seanghay/uvr_models/resolve/main/Kim_Vocal_2.onnx',
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
    url: 'https://huggingface.co/seanghay/uvr_models/resolve/main/UVR_MDXNET_1_9703.onnx',
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

// ---------------------------------------------------------------------------
// "Pro" 4-stem separation (desktop-only). Rather than one 2-output split, run
// three per-stem KUIELab MDX-Net models (vocals, drums, bass) through the SAME
// mdx-separate.js pipeline, then derive "other" as the residual
// (other = original - (vocals + drums + bass)). Because the four stems sum to
// the original by construction, the 4-fader spectrogram morph (combineStftToDbN)
// stays mathematically exact - all faders at 100% reproduces |original|, just
// like the 2-stem blend at centre.
//
// Geometry follows the KUIELab submission (models.py): every model keeps the
// lowest dim_f = 2048 bins at hop 1024, and n_fft scales per source to fit that
// (vocals x3 -> 6144, drums x2 -> 4096, bass x8 -> 16384). The time axis varies by
// file: the vocals and bass ONNX were re-exported with dim_t = 512, while the 'B'
// drums model keeps the config's dim_t = 128. Each model's dim_t is taken straight
// from its own [1,4,dim_f,dim_t] input shape (read from the ONNX graph), and
// mdx-stft.js frames each accordingly. No magnitude compensation (comp 1.0), so the
// residual is exact.
//
// The models are per-stem MDX-Net ONNX, identical in shape/packing to MDX_MODELS
// (the [1,4,dim_f,dim_t] real/imag tensor), so mdx-separate.js drives them
// unchanged. Hosted on a HuggingFace MODEL repo, whose resolve URLs send
// access-control-allow-origin:* (readable bytes), same requirement as the mirror
// above. MDX_PRO_STEMS is the single source of truth: worker loop, client,
// combine, faders, export and colours all read this one ordered array, so adding
// a guitar/piano stem later is an append here (given a good model), not a rewrite.
export const MDX_PRO_MIRROR = 'https://huggingface.co/Politrees/UVR_resources/resolve/main/models/MDXNet/';
export const MDX_PRO_STEMS = [
  { key: 'vocals', label: 'Vocals', colour: '#e0533a',
    model: { id: 'kuielab_a_vocals', name: 'KUIELab-MDX-Net Vocals', url: MDX_PRO_MIRROR + 'kuielab_a_vocals.onnx',
      bytes: 29703204, nFft: 6144,  dimF: 2048, dimT: 512, hop: 1024, compensate: 1.0, stem: 'Vocals' } },
  // The 'B' drums model, not 'A': a separately-trained variant, swapped in to
  // capture more of the kit so less drum energy is left behind to bleed into the
  // residual "other". It carries a DIFFERENT time axis from the vocals/bass files -
  // dim_t 128, not 512 (read from its [1,4,2048,128] ONNX input shape) - so
  // mdx-stft.js frames it in smaller chunks. n_fft/dim_f/hop are unchanged.
  { key: 'drums', label: 'Drums', colour: '#d1a63a',
    model: { id: 'kuielab_b_drums', name: 'KUIELab-MDX-Net Drums (B)', url: MDX_PRO_MIRROR + 'kuielab_b_drums.onnx',
      bytes: 21930313, nFft: 4096,  dimF: 2048, dimT: 128, hop: 1024, compensate: 1.0, stem: 'Drums' } },
  { key: 'bass', label: 'Bass', colour: '#3b82c4',
    model: { id: 'kuielab_a_bass', name: 'KUIELab-MDX-Net Bass', url: MDX_PRO_MIRROR + 'kuielab_a_bass.onnx',
      bytes: 29703204, nFft: 16384, dimF: 2048, dimT: 512, hop: 1024, compensate: 1.0, stem: 'Bass' } },
  // Derived, no model of its own.
  { key: 'other', label: 'Other', colour: '#3ba776', residual: true },
];
// The three real models (skip the residual), by run order - the worker iterates this.
export const MDX_PRO_MODELS = MDX_PRO_STEMS.filter((s) => s.model).map((s) => s.model);
// Feature flag for the "Heavy" 4-stem tier. When false the button is never built,
// so the tier is unreachable from the UI - but every model entry, the worker's
// separateMulti path, the client, the 4-fader mixer and the combine maths below
// stay exactly as they are. Flipping this back to true is the ONLY edit needed to
// restore it.
//
// Parked because the tier could not justify its ~82 MB: KUIELab's drums fall short
// of the quality bar, and its vocals are a step DOWN from Standard's Kim Vocal 2
// (a later, better-trained model), so Heavy was worse than Standard at the one
// thing most people separate for. The KUIELab per-stem ONNX set is the entire
// drop-in option space for this pipeline - a/b variants of the same 2021 models -
// so there is nothing better to swap in without a new architecture. HT-Demucs was
// evaluated as a replacement and rejected: its ONNX exports abort at load in
// onnxruntime-web, and even working it would need WebGPU (Chrome/Edge only) to run
// at a tolerable speed, so the tier would silently not work for Firefox/Safari.
export const MDX_PRO_ENABLED = false;

// Picker / download-prompt descriptor for the Pro job (parallels an MDX_MODELS entry).
export const MDX_PRO = {
  id: 'pro',
  label: 'Pro (4 stems)',
  blurb: 'a full four-stem split - vocals, drums, bass and the leftover "other" - by running three models in turn, so it is heavier and desktop-only',
  // Three stem models (~30 + ~22 + ~30 MB); the ORT runtime (~21 MB) is shared with
  // Standard/Lite and usually already cached, so only the models are new on top of it.
  tierMb: 82,
  stems: MDX_PRO_STEMS,
};
// On-demand only: the ~90 MB of Pro models are NOT added to the Complete offline
// tier (MDX_OFFLINE_URLS) - they download on first Pro run and live in the worker's
// own MDX_CACHE bucket, like the lite model does on the web.
// Unreferenced while MDX_PRO_ENABLED is false: kept deliberately, with the rest of
// the parked Heavy tier, so flipping that flag is still the only edit needed.
export const MDX_PRO_URLS = MDX_PRO_MODELS.map((m) => m.url);
