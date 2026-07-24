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
   Float32Array, so this module has no browser/ORT dependency and is unit-tested
   in Node (scratchpad/test-separate.mjs) with an identity model. */

import { makeStftEngine } from './mdx-stft.js';

export const MDX_SR = 44100;   // MDX-Net models are trained at 44.1 kHz

// Normalise to exactly two channels the way MDX expects: duplicate mono, drop
// extras. Shared so a single-model split and a multi-model (Pro) run frame the
// SAME stereo source - which is what makes the residual "other" stem exact.
export function normStereo(channels) {
  let ch = channels;
  if (ch.length === 1) ch = [ch[0], ch[0]];
  else if (ch.length > 2) ch = [ch[0], ch[1]];
  return ch;
}

// Run ONE per-stem MDX model over pre-normalised stereo `ch` and return that
// model's PRIMARY stem as [L, R] at the original sample length, magnitude
// compensation applied. No residual is derived here - the caller does that
// (2-stem: original - primary; Pro: original - sum of the three primaries). This
// is the exact framing/demix the file used to inline; splitting it out lets the
// Pro path call it once per model with no change to the DSP.
export async function runStemModel({ ch, model, runModel, onProgress }) {
  const { nFft, hop, dimF, dimT, compensate } = model;
  const eng = makeStftEngine(nFft, hop);
  const nBins = eng.nBins;
  const trim = nFft >> 1;                 // n_fft/2
  const chunkSize = hop * (dimT - 1);     // samples per model window
  const genSize = chunkSize - 2 * trim;   // usable (kept) samples per window
  const nSample = ch[0].length;

  const numChunks = Math.max(1, Math.ceil(nSample / genSize));
  const paddedLen = trim + numChunks * genSize + trim;   // covers every chunk window
  // Build the padded stereo signal once per channel.
  const padded = ch.map((data) => {
    const p = new Float32Array(paddedLen);
    p.set(data.subarray(0, nSample), trim);
    return p;
  });

  const stem = [new Float32Array(numChunks * genSize), new Float32Array(numChunks * genSize)];
  const dims = [1, 4, dimF, dimT];
  const input = new Float32Array(4 * dimF * dimT);
  const chunk = new Float64Array(chunkSize);

  for (let i = 0; i < numChunks; i++) {
    input.fill(0);
    // Per channel: STFT the chunk, crop to dim_f, pack real/imag planes.
    const specs = [];
    for (let cc = 0; cc < 2; cc++) {
      const start = i * genSize;
      for (let s = 0; s < chunkSize; s++) chunk[s] = padded[cc][start + s];
      const S = eng.stft(chunk);                // { re, im, frames } , frames === dimT
      specs.push(S);
      const frames = Math.min(S.frames, dimT);
      const reBase = (cc * 2) * dimF * dimT;     // real plane for this channel
      const imBase = (cc * 2 + 1) * dimF * dimT; // imag plane
      for (let t = 0; t < frames; t++) {
        const sb = t * nBins;
        for (let f = 0; f < dimF; f++) {
          input[reBase + f * dimT + t] = S.re[sb + f];
          input[imBase + f * dimT + t] = S.im[sb + f];
        }
      }
    }

    // Run the model -> predicted primary-stem spectrogram (same [1,4,dimF,dimT]).
    const out = await runModel(input, dims);

    // ISTFT each channel back to the time domain, keep the middle gen_size.
    for (let cc = 0; cc < 2; cc++) {
      const frames = Math.min(specs[cc].frames, dimT);
      const preRe = new Float32Array(frames * nBins);
      const preIm = new Float32Array(frames * nBins);
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
      for (let s = 0; s < genSize; s++) dst[outStart + s] = rec[trim + s];
    }

    if (onProgress) onProgress((i + 1) / numChunks);
  }

  // Trim to the original length, apply magnitude compensation.
  const comp = compensate || 1;
  const outL = new Float32Array(nSample), outR = new Float32Array(nSample);
  for (let s = 0; s < nSample; s++) { outL[s] = stem[0][s] * comp; outR[s] = stem[1][s] * comp; }
  return [outL, outR];
}

// 2-stem split (the existing Standard / Lite path): the model's primary stem plus
// the instrumental (= original - primary). Behaviour is unchanged - the framing/
// demix now lives in runStemModel and this just derives the complement.
export async function separateVocals({ channels, model, runModel, onProgress }) {
  const ch = normStereo(channels);
  const nSample = ch[0].length;
  const [vL, vR] = await runStemModel({ ch, model, runModel, onProgress });
  const iL = new Float32Array(nSample), iR = new Float32Array(nSample);
  for (let s = 0; s < nSample; s++) { iL[s] = ch[0][s] - vL[s]; iR[s] = ch[1][s] - vR[s]; }
  return { vocals: [vL, vR], instrumental: [iL, iR], sampleRate: MDX_SR };
}
