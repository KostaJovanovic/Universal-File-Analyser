/* Analyser - DeepFilterNet3 DSP core (pure math, NO DOM / ORT / browser APIs).

   A faithful port of libDF's feature extraction and synthesis, so the ONNX graph
   sees exactly what it was trained on. Verifiable under Node (scratchpad) the same
   way mdx-stft.js is. Everything here is deterministic; the neural graph is the
   only learned part and is injected by dfn-enhance.js.

   Geometry (DeepFilterNet3, from its config): sr 48000, fft_size 960, hop 480,
   481 one-sided bins, 32 ERB bands (>=2 bins each), 96 DF bins, DF order 5,
   lookahead 2, normalisation alpha 0.99.

   The FFT is size 960 = 2^6 * 15, not a power of two, so we reuse mdx-stft.js's
   mixed-radix makeFft. DeepFilterNet uses a Vorbis window with the analysis FFT
   pre-scaled by wnorm = 1/(N^2/(2*hop)) = 1/N and RAW (unnormalised) forward AND
   inverse transforms, giving perfect reconstruction because the Vorbis window
   satisfies the Princen-Bradley identity w^2[n] + w^2[n+N/2] = 1 at 50% overlap. */
import { makeFft } from './mdx-stft.js';
export const DFN = {
    sr: 48000,
    fftSize: 960,
    hop: 480,
    nBins: 481, // fftSize/2 + 1
    nbErb: 32,
    minNbErbFreqs: 2,
    nbDf: 96,
    dfOrder: 5,
    dfLookahead: 2,
    alpha: 0.99, // config normalization_alpha (= exp(-hop/(sr*tau)), tau=1, rounded)
};
// ERB scale (libDF): freq2erb / erb2freq with the 9.265 constant.
const ERB_A = 9.265;
export function freq2erb(f) { return ERB_A * Math.log(1 + f / (24.7 * ERB_A)); }
export function erb2freq(e) { return 24.7 * ERB_A * (Math.exp(e / ERB_A) - 1); }
/* ERB band widths: how many contiguous FFT bins each of the 32 bands spans. Exact
   port of libDF erb_fb(): step the ERB axis in nb_bands equal steps, round each
   band edge to a bin, enforce a minimum bins-per-band (carrying the shortfall
   forward via freq_over), give the last band the Nyquist bin, then trim any
   overshoot off the last band. The result sums to fftSize/2 + 1 (= 481). */
export function erbWidths(sr = DFN.sr, fftSize = DFN.fftSize, nbBands = DFN.nbErb, minNbFreqs = DFN.minNbErbFreqs) {
    const nyq = (sr / 2) | 0;
    const freqWidth = sr / fftSize;
    const erbLow = freq2erb(0);
    const erbHigh = freq2erb(nyq);
    const step = (erbHigh - erbLow) / nbBands;
    const erb = new Array(nbBands).fill(0);
    let prevFreq = 0, freqOver = 0;
    for (let i = 1; i <= nbBands; i++) {
        const f = erb2freq(erbLow + i * step);
        const fb = Math.round(f / freqWidth);
        let nb = fb - prevFreq - freqOver;
        if (nb < minNbFreqs) {
            freqOver = minNbFreqs - nb;
            nb = minNbFreqs;
        }
        else
            freqOver = 0;
        erb[i - 1] = nb;
        prevFreq = fb;
    }
    erb[nbBands - 1] += 1; // include the Nyquist bin
    const tooLarge = erb.reduce((a, b) => a + b, 0) - (fftSize / 2 + 1);
    if (tooLarge > 0)
        erb[nbBands - 1] -= tooLarge;
    return erb;
}
// libDF normalisation state seeds, linearly interpolated across bands/bins.
export const MEAN_NORM_INIT = [-60, -90]; // ERB feature (dB) running-mean seed
export const UNIT_NORM_INIT = [0.001, 0.0001]; // complex-feature magnitude seed
function linspace(a, b, n) {
    const o = new Float32Array(n);
    for (let i = 0; i < n; i++)
        o[i] = a + (b - a) * (n === 1 ? 0 : i / (n - 1));
    return o;
}
// Vorbis window: w[i] = sin(pi/2 * sin^2(pi*(i+0.5)/N)). Symmetric, peaks at 1,
// and (with 50% overlap) sum-of-squares over the two overlapping frames == 1.
export function vorbisWindow(n) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const s = Math.sin(Math.PI / n * (i + 0.5));
        w[i] = Math.sin(Math.PI / 2 * s * s);
    }
    return w;
}
/* STFT engine matching libDF's analysis/synthesis exactly:
     analysis:  X = wnorm * RFFT_raw(window .* frame)         (one-sided, wnorm=1/N)
     synthesis: y_frame = window .* IRFFT_raw(X)              (raw inverse, no 1/N)
   Because makeFft's forward and inverse are both unscaled, IRFFT_raw(RFFT_raw(z))
   = N*z, so a round trip through analysis+synthesis gives wnorm*N * w^2 * frame =
   w^2 * frame, and the overlap-add of w^2 over 50%-overlap frames reconstructs the
   signal (see vorbisWindow). frameFwd/frameInv operate on a single frame; the
   overlap-add itself is done by the caller (dfn-enhance.js) so it can OLA across
   segment boundaries. */
export function makeDfnStft(fftSize = DFN.fftSize, hop = DFN.hop) {
    const nBins = (fftSize >> 1) + 1;
    const fft = makeFft(fftSize);
    const win = vorbisWindow(fftSize);
    const wnorm = 1 / (fftSize * fftSize / (2 * hop)); // = 1/fftSize when hop = fftSize/2
    const fr = new Float64Array(fftSize), fi = new Float64Array(fftSize);
    // Forward: windowed frame -> one-sided re/im (length nBins), wnorm-scaled.
    function frameFwd(frame, re, im) {
        for (let i = 0; i < fftSize; i++) {
            fr[i] = frame[i] * win[i];
            fi[i] = 0;
        }
        const spec = fft(fr, fi, false);
        for (let b = 0; b < nBins; b++) {
            re[b] = spec.re[b] * wnorm;
            im[b] = spec.im[b] * wnorm;
        }
    }
    // Inverse: one-sided re/im -> windowed time frame (length fftSize) into `out`.
    function frameInv(re, im, out) {
        for (let b = 0; b < nBins; b++) {
            fr[b] = re[b];
            fi[b] = im[b];
        }
        // Hermitian-mirror the negative frequencies.
        for (let b = 1; b < fftSize - nBins + 1; b++) {
            fr[fftSize - b] = re[b];
            fi[fftSize - b] = -im[b];
        }
        const rec = fft(fr, fi, true); // raw inverse (no 1/N)
        for (let i = 0; i < fftSize; i++)
            out[i] = rec.re[i] * win[i];
    }
    return { nBins, fftSize, hop, win, wnorm, frameFwd, frameInv };
}
/* Per-frame feature extractor carrying the sequential normalisation state. One
   instance per channel per processing pass; the state is seeded from *_NORM_INIT
   and updated every frame (an exponential moving average), so a segment restart
   needs a short warm-up of frames before its kept output (dfn-enhance.js). */
export function makeFeatureState(erb) {
    const nbErb = erb.length;
    const nbDf = DFN.nbDf;
    const alpha = DFN.alpha;
    const meanState = linspace(MEAN_NORM_INIT[0], MEAN_NORM_INIT[1], nbErb);
    const unitState = linspace(UNIT_NORM_INIT[0], UNIT_NORM_INIT[1], nbDf);
    // feat_erb: mean power per ERB band -> dB -> subtract running mean, scale by 40.
    // (libDF compute_band_corr divides each band by its width, then feat_erb does
    //  10*log10(x+1e-10) and band_mean_norm_erb: s=x*(1-a)+s*a; x=(x-s)/40.)
    function featErb(re, im, out) {
        let bc = 0;
        for (let b = 0; b < nbErb; b++) {
            const bs = erb[b], k = 1 / bs;
            let s = 0;
            for (let j = 0; j < bs; j++) {
                const idx = bc + j;
                s += (re[idx] * re[idx] + im[idx] * im[idx]) * k;
            }
            const v = Math.log10(s + 1e-10) * 10;
            meanState[b] = v * (1 - alpha) + meanState[b] * alpha;
            out[b] = (v - meanState[b]) / 40;
            bc += bs;
        }
    }
    // feat_cplx: first nbDf complex bins, each divided by sqrt of the running mean
    // of its magnitude (libDF band_unit_norm: s=|x|*(1-a)+s*a; x/=sqrt(s)).
    function featCplx(re, im, outRe, outIm) {
        for (let k = 0; k < nbDf; k++) {
            const mag = Math.hypot(re[k], im[k]);
            unitState[k] = mag * (1 - alpha) + unitState[k] * alpha;
            const d = Math.sqrt(unitState[k]) || 1e-12;
            outRe[k] = re[k] / d;
            outIm[k] = im[k] / d;
        }
    }
    return { featErb, featCplx };
}
// Apply a 32-band ERB gain to a full one-sided spectrum in place: each band's gain
// multiplies every bin it spans (libDF apply_interp_band_gain - replication, no
// interpolation). re/im are one frame (length nBins).
export function applyErbGain(re, im, gains, erb) {
    let bc = 0;
    for (let b = 0; b < erb.length; b++) {
        const g = gains[b], bs = erb[b];
        for (let j = 0; j < bs; j++) {
            re[bc + j] *= g;
            im[bc + j] *= g;
        }
        bc += bs;
    }
}
//# sourceMappingURL=dfn-dsp.js.map