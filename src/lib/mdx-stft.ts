/* Analyser - parameterized STFT/ISTFT core for MDX-Net vocal separation.

   Pure math, NO DOM/browser APIs, so it can be unit-tested under Node.

   MDX-Net models use an FFT size that is NOT a power of two: the older/smaller
   models use 6144 (= 3 x 2048), the Kim / Voc-FT generation uses 7680
   (= 15 x 512). A plain radix-2 FFT can't do either size, so makeFft() splits any
   N Cooley-Tukey style into a small direct DFT stage (size N1 = the odd factor
   left after pulling out every power of two) and a fast radix-2 stage
   (size N2 = the largest power of two dividing N). N1 is tiny (3 or 15) so its
   O(N1^2) direct DFT is cheap; N2 carries the weight via the radix-2 kernel.

   makeStftEngine() wraps that into an STFT/ISTFT pair matching torch.stft /
   torch.istft with center=True and a periodic Hann window - so ISTFT is the
   exact weighted-overlap-add inverse of STFT, normalised by the summed window
   squared. Transform and frame buffers are deliberately reused: allocating
   them for every FFT made Mobile Safari accumulate tens of megabytes of garbage
   per model window before its collector caught up. */

// Periodic Hann window (matches torch.hann_window default): w[n]=0.5-0.5cos(2pi n/N).
export function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
  return w;
}

// --- radix-2 FFT for a power-of-two length, in place. inv=true flips the twiddle
// sign only; scaling by 1/N is the caller's job. ---
function fftRadix2(re, im, inv) {
  const n = re.length;
  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  const sign = inv ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const ang = sign * 2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr;        im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/* Build a mixed-radix FFT of arbitrary length N = N1 * N2, where N2 is the
   largest power of two dividing N and N1 is the small odd remainder. Returns a
   reusable transform(inRe, inIm, inv) => { re, im }.

   Decomposition (input index n = N2*n1 + n2, output index k = N1*k2 + k1):
     stage 1: for each n2, a direct size-N1 DFT over n1 of x[N2*n1 + n2] -> A[k1]
     stage 2: multiply A[k1] by the outer twiddle W_N^(n2*k1)
     stage 3: radix-2 FFT (length N2) of each k1 buffer -> Y_k1[k2]
     recombine: X[N1*k2 + k1] = Y_k1[k2]
   The inverse conjugates both twiddle stages (the radix-2 kernel handles its own
   sign via inv); the caller scales the inverse by 1/N. */
export function makeFft(N) {
  let N2 = 1, m = N;
  while (m % 2 === 0) { N2 *= 2; m /= 2; }
  const N1 = m;   // odd factor: 3 for 6144, 15 for 7680, 1 if N is a pure power of two

  // Direct size-N1 DFT twiddles D[k1][n1] = exp(-2pi i n1 k1 / N1) (forward sign).
  const DR = [], DI = [];
  for (let k1 = 0; k1 < N1; k1++) {
    DR.push(new Float64Array(N1)); DI.push(new Float64Array(N1));
    for (let n1 = 0; n1 < N1; n1++) {
      const ang = -2 * Math.PI * (n1 * k1) / N1;
      DR[k1][n1] = Math.cos(ang); DI[k1][n1] = Math.sin(ang);
    }
  }
  // Outer twiddles TW[k1][n2] = exp(-2pi i n2 k1 / N) (forward sign).
  const TWR = [], TWI = [];
  for (let k1 = 0; k1 < N1; k1++) {
    TWR.push(new Float64Array(N2)); TWI.push(new Float64Array(N2));
    for (let n2 = 0; n2 < N2; n2++) {
      const ang = -2 * Math.PI * (n2 * k1) / N;
      TWR[k1][n2] = Math.cos(ang); TWI[k1][n2] = Math.sin(ang);
    }
  }
  // Reusable per-k1 radix-2 buffers (transform is not re-entrant, which is fine:
  // each engine/worker uses it serially).
  const br = [], bi = [];
  for (let k1 = 0; k1 < N1; k1++) { br.push(new Float64Array(N2)); bi.push(new Float64Array(N2)); }
  // Callers consume the result before the next transform, so keep one output
  // pair as well. For Lite this avoids about 96 MiB of short-lived allocations
  // per model window across the forward and inverse frame loops.
  const outRe = new Float64Array(N), outIm = new Float64Array(N);

  return function transform(inRe, inIm, inv) {
    // Stage 1 + 2: size-N1 DFT over the N1 strided sub-sequences, then twiddle.
    for (let n2 = 0; n2 < N2; n2++) {
      for (let k1 = 0; k1 < N1; k1++) {
        let ar = 0, ai = 0;
        const dr = DR[k1], di = DI[k1];
        for (let n1 = 0; n1 < N1; n1++) {
          const idx = N2 * n1 + n2;
          const xr = inRe[idx], xi = inIm[idx];
          const wr = dr[n1], wi = inv ? -di[n1] : di[n1];
          ar += xr * wr - xi * wi;
          ai += xr * wi + xi * wr;
        }
        const twr = TWR[k1][n2], twi = inv ? -TWI[k1][n2] : TWI[k1][n2];
        br[k1][n2] = ar * twr - ai * twi;
        bi[k1][n2] = ar * twi + ai * twr;
      }
    }
    // Stage 3: radix-2 FFT of each k1 buffer.
    for (let k1 = 0; k1 < N1; k1++) fftRadix2(br[k1], bi[k1], inv);
    // Recombine: X[N1*k2 + k1] = Y_k1[k2].
    for (let k2 = 0; k2 < N2; k2++) {
      const base = N1 * k2;
      for (let k1 = 0; k1 < N1; k1++) { outRe[base + k1] = br[k1][k2]; outIm[base + k1] = bi[k1][k2]; }
    }
    return { re: outRe, im: outIm };
  };
}

/* Build an STFT/ISTFT engine for a given FFT size and hop. center=True padding
   (nFft/2 each side). stft() returns one-sided spectra as flat Float32Arrays
   [frame*nBins + bin] plus the frame count; istft() is the exact inverse. */
export function makeStftEngine(nFft, hop) {
  const nBins = (nFft >> 1) + 1;
  const fft = makeFft(nFft);
  const window = hann(nFft);
  const pad = nFft >> 1;
  let padded = new Float64Array(0);
  let stftRe = new Float32Array(0), stftIm = new Float32Array(0);
  const stftFr = new Float64Array(nFft), stftFi = new Float64Array(nFft);
  let istftOut = new Float64Array(0), istftWsum = new Float64Array(0);
  let istftSignal = new Float64Array(0);
  const istftFr = new Float64Array(nFft), istftFi = new Float64Array(nFft);

  function stft(signal) {
    const paddedLen = signal.length + 2 * pad;
    if (padded.length !== paddedLen) padded = new Float64Array(paddedLen);
    else padded.fill(0);
    padded.set(signal, pad);
    const frames = 1 + Math.floor((padded.length - nFft) / hop);
    const spectrumLen = frames * nBins;
    if (stftRe.length !== spectrumLen) {
      stftRe = new Float32Array(spectrumLen);
      stftIm = new Float32Array(spectrumLen);
    }
    for (let mIdx = 0; mIdx < frames; mIdx++) {
      const off = mIdx * hop;
      for (let i = 0; i < nFft; i++) { stftFr[i] = padded[off + i] * window[i]; stftFi[i] = 0; }
      const spec = fft(stftFr, stftFi, false);
      const base = mIdx * nBins;
      for (let b = 0; b < nBins; b++) { stftRe[base + b] = spec.re[b]; stftIm[base + b] = spec.im[b]; }
    }
    // These arrays belong to the engine and are valid until its next stft call.
    return { re: stftRe, im: stftIm, frames, bins: nBins };
  }

  function istft(re, im, frames, length) {
    const outLen = length + 2 * pad;
    if (istftOut.length !== outLen) {
      istftOut = new Float64Array(outLen);
      istftWsum = new Float64Array(outLen);
      istftSignal = new Float64Array(length);
    } else {
      istftOut.fill(0);
      istftWsum.fill(0);
    }
    for (let mIdx = 0; mIdx < frames; mIdx++) {
      const base = mIdx * nBins;
      // rebuild hermitian-symmetric full spectrum from the one-sided bins
      for (let b = 0; b < nBins; b++) { istftFr[b] = re[base + b]; istftFi[b] = im[base + b]; }
      for (let b = 1; b < nFft - nBins + 1; b++) {
        istftFr[nFft - b] = re[base + b];
        istftFi[nFft - b] = -im[base + b];
      }
      const rec = fft(istftFr, istftFi, true);   // inverse, unscaled
      const off = mIdx * hop;
      for (let i = 0; i < nFft; i++) {
        const val = (rec.re[i] / nFft) * window[i];   // scale inverse + synthesis window
        istftOut[off + i] += val;
        istftWsum[off + i] += window[i] * window[i];
      }
    }
    for (let i = 0; i < length; i++) {
      const ws = istftWsum[pad + i];
      istftSignal[i] = ws > 1e-8 ? istftOut[pad + i] / ws : 0;
    }
    // This array belongs to the engine and is valid until its next istft call.
    return istftSignal;
  }

  return { stft, istft, nBins, nFft, hop, window };
}
