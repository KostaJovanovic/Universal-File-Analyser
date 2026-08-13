/* Analyser - MDX-Net separation pipeline (pure DSP, model call injected).

   Mirrors the reference UVR / python-audio-separator MDX "demix" exactly:
     - work at 44.1 kHz, stereo (mono is duplicated to two channels);
     - pad `trim` (= n_fft/2) of silence each side and to a whole number of
       gen_size steps;
     - slide a chunk_size = hop*(dim_t-1) window every gen_size samples;
     - STFT each chunk per channel, crop to the lowest dim_f bins, pack into the
       model's [1, 4, dim_f, dim_t] tensor (4 = 2 channels x real/imag, laid out
       as [ch0re, ch0im, ch1re, ch1im]);
     - run the model -> predicted vocal spectrogram (same shape);
     - zero-pad the cropped bins back to n_bins, ISTFT, keep the middle gen_size
       (overlap-discard), concatenate;
     - multiply by the model's magnitude compensation; the instrumental is just
       original - vocal.

   The ONNX inference is passed in as runModel(inputF32, [1,4,dim_f,dim_t]) =>
   Float32Array, so this module has no browser/ORT dependency and can be exercised
   directly in Node with an injected identity model. */

import { makeStftEngine } from './mdx-stft.js';

export const MDX_SR = 44100;   // MDX-Net models are trained at 44.1 kHz

// Normalise to exactly two channels the way MDX expects: duplicate mono and
// drop extras.
export function normStereo(channels) {
  let ch = channels;
  if (ch.length === 1) ch = [ch[0], ch[0]];
  else if (ch.length > 2) ch = [ch[0], ch[1]];
  return ch;
}

// Run one MDX model over pre-normalised stereo `ch` and return its primary stem
// as [L, R] at the original sample length, with magnitude compensation applied.
// The caller derives the residual stem from the original signal.
export async function runStemModel({ ch, model, runModel, onProgress }) {
  const { nFft, hop, dimF, dimT, compensate } = model;
  const eng = makeStftEngine(nFft, hop);
  const nBins = eng.nBins;
  const trim = nFft >> 1;                 // n_fft/2
  const chunkSize = hop * (dimT - 1);     // samples per model window
  const genSize = chunkSize - 2 * trim;   // usable (kept) samples per window
  const nSample = ch[0].length;

  const numChunks = Math.max(1, Math.ceil(nSample / genSize));
  // Write straight into the final-length stem. Reading source samples by index
  // gives the same trim padding as a full padded copy, without retaining another
  // whole-song stereo allocation on memory-constrained phones.
  // Do not reserve both full-song output channels before the first model call.
  // That call is ORT's peak start-up allocation and was where 4 GB iPhones lost
  // the Safari process. Allocate the persistent result only after it succeeds.
  let stem = null;
  const dims = [1, 4, dimF, dimT];
  const input = new Float32Array(4 * dimF * dimT);
  const chunk = new Float64Array(chunkSize);
  // The model always returns the same frame geometry. Reuse one expanded
  // spectrum pair for both channels and every window; Mobile Safari otherwise
  // accumulates another ~13 MB of short-lived arrays per Lite window.
  const preRe = new Float32Array(dimT * nBins);
  const preIm = new Float32Array(dimT * nBins);

  for (let i = 0; i < numChunks; i++) {
    input.fill(0);
    // Per channel: STFT the chunk, crop to dim_f, pack real/imag planes.
    const frameCounts = [0, 0];
    for (let cc = 0; cc < 2; cc++) {
      const start = i * genSize;
      const source = ch[cc];
      for (let s = 0; s < chunkSize; s++) {
        const sourceIndex = start + s - trim;
        chunk[s] = sourceIndex >= 0 && sourceIndex < nSample ? source[sourceIndex] : 0;
      }
      const S = eng.stft(chunk);                // { re, im, frames } , frames === dimT
      const frames = Math.min(S.frames, dimT);
      frameCounts[cc] = frames;
      const reBase = (cc * 2) * dimF * dimT;     // real plane for this channel
      const imBase = (cc * 2 + 1) * dimF * dimT; // imag plane
      for (let t = 0; t < frames; t++) {
        const sb = t * nBins;
        // UVR deliberately removes the first three frequency bins before MDX
        // inference. Matching that preprocessing avoids low-frequency leakage.
        for (let f = 3; f < dimF; f++) {
          input[reBase + f * dimT + t] = S.re[sb + f];
          input[imBase + f * dimT + t] = S.im[sb + f];
        }
      }
    }

    // Run the model -> predicted primary-stem spectrogram (same [1,4,dimF,dimT]).
    const out = await runModel(input, dims);
    if (!stem) stem = [new Float32Array(nSample), new Float32Array(nSample)];

    // ISTFT each channel back to the time domain, keep the middle gen_size.
    for (let cc = 0; cc < 2; cc++) {
      const frames = frameCounts[cc];
      const reBase = (cc * 2) * dimF * dimT;
      const imBase = (cc * 2 + 1) * dimF * dimT;
      for (let t = 0; t < frames; t++) {
        const sb = t * nBins;
        for (let f = 0; f < dimF; f++) {   // bins dimF..nBins stay zero (model drops them)
          preRe[sb + f] = out[reBase + f * dimT + t];
          preIm[sb + f] = out[imBase + f * dimT + t];
        }
      }
      const rec = eng.istft(preRe, preIm, frames, chunkSize);
      const dst = stem[cc];
      const outStart = i * genSize;
      const keep = Math.min(genSize, nSample - outStart);
      for (let s = 0; s < keep; s++) dst[outStart + s] = rec[trim + s];
    }

    if (onProgress) onProgress((i + 1) / numChunks);
  }

  // Preserve the reference pipeline's Float32 rounding order: reconstructed
  // samples land in the stem first, then compensation is applied in place.
  const comp = compensate || 1;
  for (let cc = 0; cc < 2; cc++) {
    for (let s = 0; s < nSample; s++) stem[cc][s] *= comp;
  }
  return stem;
}

// 2-stem split (the existing Standard / Lite path): the model's primary stem plus
// the instrumental (= original - primary). The worker owns the transferred input
// arrays, so turn those into the residual in place instead of allocating another
// full-song stereo pair. Mono input needs one extra right channel because normStereo
// deliberately aliases its single source channel into both model inputs.
export async function separateVocals({ channels, model, runModel, onProgress }) {
  const ch = normStereo(channels);
  const nSample = ch[0].length;
  const [vL, vR] = await runStemModel({ ch, model, runModel, onProgress });
  const monoInput = ch[0] === ch[1];
  const iL = ch[0], iR = monoInput ? new Float32Array(nSample) : ch[1];
  for (let s = 0; s < nSample; s++) {
    const left = ch[0][s], right = ch[1][s];
    iL[s] = left - vL[s];
    iR[s] = right - vR[s];
  }
  return { vocals: [vL, vR], instrumental: [iL, iR], sampleRate: MDX_SR };
}
