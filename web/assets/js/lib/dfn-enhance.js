/* Analyser - DeepFilterNet3 enhancement pipeline (pure DSP, model call injected).

   Mirrors libDF's runtime demix, offline and segmented:
     - work at 48 kHz; each channel is denoised independently (stereo preserved);
     - STFT the channel (Vorbis window, 960/480), producing one-sided frames;
     - per frame, build feat_erb (32) and feat_spec (2x96, first 96 bins) with the
       sequential normalisation state;
     - run the graph over a block of frames -> erb_mask [order over T] and df_coefs;
     - ERB-mask the full spectrum into a SEPARATE buffer (used for the high bins),
       and deep-filter the first 96 bins from the ORIGINAL (unmasked) spectrum -
       matching libDF's two-buffer split (rolling_spec_buf_x is the noisy input):
         Y[t,k<96]  = sum_{o=0..4} coef[o,t,k] * Xorig[t + o - lookahead, k]
         Y[t,k>=96] = erbGain[k] * Xorig[t,k]
     - ISTFT (windowed overlap-add) back to time -> the clean channel;
     - the noise stem is simply original - clean.

   The graph is not streaming (GRU state is internal and zero-initialised each
   call), so long audio is processed in overlapping SEGMENTS with a warm-up prefix
   that is recomputed but discarded - this bounds memory and lets the GRU +
   normalisation state converge before each segment's kept output.

   runModel(featErb, featSpec, nFrames) => { erbMask, dfCoefs } is injected, so this
   module has no ORT/browser dependency and can be unit-tested in Node with a
   stub model (e.g. an all-pass mask + identity centre tap). */
import { DFN, makeDfnStft, makeFeatureState, erbWidths, applyErbGain } from './dfn-dsp.js';
export const DFN_SR = DFN.sr;
// Segment sizing. CORE frames are kept; WARMUP frames before each core are
// recomputed and discarded so the GRU / norm state has converged. ~2000 frames is
// ~20 s of audio at hop 480; ~100 frames is ~1 s of warm-up.
const SEG_CORE = 2000;
const WARMUP = 100;
export async function enhanceAudio({ channels, runModel, onProgress }) {
    const { fftSize, hop, nBins, nbErb, nbDf, dfOrder, dfLookahead } = DFN;
    const erb = erbWidths();
    const stft = makeDfnStft(fftSize, hop);
    const nCh = Math.max(1, channels.length);
    // Total frames spanning each channel, computed off the first channel's length.
    const nSample = channels[0].length;
    const padFront = fftSize - hop; // 480: front pad for full OLA coverage
    const minLen = padFront + nSample + padFront; // symmetric tail pad
    const k = Math.max(1, Math.ceil((minLen - fftSize) / hop));
    const paddedLen = fftSize + k * hop;
    const totalFrames = k + 1;
    // How many model passes total, for progress (segments per channel).
    const segsPerCh = Math.max(1, Math.ceil(totalFrames / SEG_CORE));
    const totalSegs = segsPerCh * nCh;
    let doneSegs = 0;
    const cleanChannels = [];
    const noiseChannels = [];
    for (let cc = 0; cc < nCh; cc++) {
        const src = channels[cc];
        // Padded copy of this channel so frame windows tile it cleanly.
        const padded = new Float64Array(paddedLen);
        for (let i = 0; i < nSample; i++)
            padded[padFront + i] = src[i];
        // Windowed overlap-add accumulators for the reconstructed clean signal.
        const outAcc = new Float64Array(paddedLen);
        const wsum = new Float64Array(paddedLen);
        const win = stft.win;
        // Reusable per-frame scratch.
        const frame = new Float64Array(fftSize);
        const synth = new Float64Array(fftSize);
        for (let segStart = 0; segStart < totalFrames; segStart += SEG_CORE) {
            const coreStart = segStart;
            const coreEnd = Math.min(totalFrames, coreStart + SEG_CORE);
            const ctxStart = Math.max(0, coreStart - WARMUP);
            // Need dfLookahead extra frames past the last core frame for its DF taps.
            const procEnd = Math.min(totalFrames, coreEnd + dfLookahead);
            const P = procEnd - ctxStart;
            // --- STFT the processed frames + build features with fresh norm state ---
            const specRe = new Float32Array(P * nBins);
            const specIm = new Float32Array(P * nBins);
            const featErb = new Float32Array(P * nbErb);
            const featSpec = new Float32Array(2 * P * nbDf); // [2, P, nbDf] real then imag
            const feat = makeFeatureState(erb);
            const fre = new Float64Array(nBins), fim = new Float64Array(nBins);
            const cRe = new Float32Array(nbDf), cIm = new Float32Array(nbDf);
            const eBuf = new Float32Array(nbErb);
            for (let t = 0; t < P; t++) {
                const off = (ctxStart + t) * hop;
                for (let i = 0; i < fftSize; i++)
                    frame[i] = padded[off + i];
                stft.frameFwd(frame, fre, fim);
                const sb = t * nBins;
                for (let b = 0; b < nBins; b++) {
                    specRe[sb + b] = fre[b];
                    specIm[sb + b] = fim[b];
                }
                feat.featErb(fre, fim, eBuf);
                const eb = t * nbErb;
                for (let b = 0; b < nbErb; b++)
                    featErb[eb + b] = eBuf[b];
                feat.featCplx(fre, fim, cRe, cIm);
                const reBase = 0 * P * nbDf + t * nbDf; // real plane
                const imBase = 1 * P * nbDf + t * nbDf; // imag plane
                for (let kk = 0; kk < nbDf; kk++) {
                    featSpec[reBase + kk] = cRe[kk];
                    featSpec[imBase + kk] = cIm[kk];
                }
            }
            // --- run the graph over these P frames ---
            const { erbMask, dfCoefs } = await runModel(featErb, featSpec, P);
            // --- ERB-gained spectrum: a SEPARATE copy, not in place. libDF keeps two
            // buffers - the deep filter reads the ORIGINAL noisy spectrum (specRe/specIm)
            // for the low bins, while the bins ABOVE the DF range take their values from
            // this ERB-masked copy. Running the deep filter on the already-attenuated
            // spectrum (the previous bug) collapses and phase-scrambles the low band -
            // exactly where the speech is - so the clean stem came out near-silent and
            // decorrelated from the input. ---
            const gainRe = Float32Array.from(specRe);
            const gainIm = Float32Array.from(specIm);
            for (let t = 0; t < P; t++) {
                const sb = t * nBins;
                applyErbGain(gainRe.subarray(sb, sb + nBins), gainIm.subarray(sb, sb + nBins), erbMask.subarray(t * nbErb, t * nbErb + nbErb), erb);
            }
            // --- deep-filter the core frames, synthesise, overlap-add ---
            const enhRe = new Float32Array(nBins), enhIm = new Float32Array(nBins);
            for (let t = coreStart; t < coreEnd; t++) {
                const lt = t - ctxStart; // local index into the processed block
                // bins 0..nbDf-1: complex FIR over df_order taps of the ORIGINAL spectrum
                // (NOT the ERB-gained one - see above). The DF output fully replaces these bins.
                for (let kk = 0; kk < nbDf; kk++) {
                    let yr = 0, yi = 0;
                    for (let o = 0; o < dfOrder; o++) {
                        const tt = lt + o - dfLookahead;
                        if (tt < 0 || tt >= P)
                            continue;
                        const idx = tt * nBins + kk;
                        const gr = specRe[idx], gi = specIm[idx];
                        const cbase = ((o * P + lt) * nbDf + kk) * 2;
                        const cr = dfCoefs[cbase], ci = dfCoefs[cbase + 1];
                        yr += cr * gr - ci * gi;
                        yi += cr * gi + ci * gr;
                    }
                    enhRe[kk] = yr;
                    enhIm[kk] = yi;
                }
                // bins nbDf..nBins-1: ERB-masked spectrum (the gained copy)
                const sb = lt * nBins;
                for (let kk = nbDf; kk < nBins; kk++) {
                    enhRe[kk] = gainRe[sb + kk];
                    enhIm[kk] = gainIm[sb + kk];
                }
                // ISTFT this frame and overlap-add at its absolute position. frameInv
                // already applies the synthesis window, so add it as-is; wsum tracks the
                // window energy for the overlap-add normalisation below.
                stft.frameInv(enhRe, enhIm, synth);
                const off = t * hop;
                for (let i = 0; i < fftSize; i++) {
                    outAcc[off + i] += synth[i];
                    wsum[off + i] += win[i] * win[i];
                }
            }
            doneSegs++;
            if (onProgress)
                onProgress(doneSegs / totalSegs);
        }
        // Normalise the overlap-add and trim back to the original length.
        const clean = new Float32Array(nSample);
        const noise = new Float32Array(nSample);
        for (let i = 0; i < nSample; i++) {
            const ws = wsum[padFront + i];
            const c = ws > 1e-8 ? outAcc[padFront + i] / ws : 0;
            clean[i] = c;
            noise[i] = src[i] - c;
        }
        cleanChannels.push(clean);
        noiseChannels.push(noise);
    }
    return { clean: cleanChannels, noise: noiseChannels, sampleRate: DFN_SR };
}
//# sourceMappingURL=dfn-enhance.js.map