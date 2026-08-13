/* Analyser - DeepFilterNet3 denoise model + ONNX Runtime configuration.

   The denoise twin of mdx-model.js. Single source of truth for the denoise
   model URL, its DSP geometry, and the network files the offline tier must cache.
   Imported by the inference worker (dfn-worker.js) and offline-tiers.js.

   Model: DeepFilterNet3, a full-band (48 kHz) real-time speech/audio denoiser -
   the noise-suppression counterpart to the MDX vocal separator. We use the single
   combined export `deepfilter.onnx` (the neural graph only: encoder + ERB decoder
   + DF decoder in one graph). STFT, ERB feature extraction, the ERB gain mask and
   the deep filter are all done on our side, in dfn-dsp.js / dfn-enhance.js, exactly
   mirroring libDF. The graph is NOT streaming - it runs over the whole T (frame)
   axis with its GRU state initialised internally each call, so long audio is
   processed in overlapping segments (dfn-enhance.js) to bound memory.

   Hosting: pulled from a HuggingFace mirror (resolve URLs send
   `access-control-allow-origin: *`, so the worker can read the bytes back - the
   same requirement as the MDX models). The ONNX runtime is shared with MDX
   (same ORT_* constants), so once either feature has fetched the runtime the
   other reuses it. */
// Reuse the exact ONNX Runtime the MDX separator uses (same pinned version, same
// WebGPU/WASM entry + wasm files). Sharing means the ~21 MB runtime is downloaded
// and cached once for both AI audio features.
import { ORT_BASE, ORT_ENTRY } from './mdx-model.js';
export { ORT_BASE, ORT_ENTRY };
// The single combined DeepFilterNet3 graph. Inputs feat_erb [1,1,T,32] and
// feat_spec [1,2,T,96] (real then imag); outputs erb_mask [1,1,T,32] and
// df_coefs [1,5,T,96,2] (order, frame, freq, re/im). Everything else is our DSP.
export const DFN_MODEL = {
    id: 'dfn3',
    name: 'DeepFilterNet3',
    label: 'Denoise',
    // Shown in the download prompt so the tier explains itself.
    blurb: 'removes background noise and hiss while keeping the full sound, all on your device',
    url: 'https://huggingface.co/aufklarer/DeepFilterNet3-ONNX/resolve/63d8ba442ba900143c468b798e94a04009b2f0c9/deepfilter.onnx',
    bytes: 8608859, // verified DeepFilterNet3 v0.5.6 export
    tierMb: 30, // model ~9 + shared ORT runtime ~21, shown in the prompt
};
export const DFN_RETIRED_URLS = [
    'https://huggingface.co/aufklarer/DeepFilterNet3-ONNX/resolve/main/deepfilter.onnx',
];
//# sourceMappingURL=dfn-model.js.map