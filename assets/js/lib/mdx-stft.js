/* Analyser - STFT/ISTFT core for MDX-Net vocal separation.

   Pure math, NO DOM/browser APIs, so it can be unit-tested under Node. The MDX-Net
   models expect a short-time Fourier transform with an FFT size of 6144 - which is
   NOT a power of two (6144 = 3 x 2048) - so a plain radix-2 FFT can't do it. We
   split it Cooley-Tukey style: 6144 = 3 x 2048, doing three fast radix-2 2048-point
   FFTs and combining them with size-3 butterflies. The STFT/ISTFT match torch.stft/
   torch.istft with center=True and a periodic Hann window, so ISTFT is the exact
   inverse of STFT (weighted overlap-add, normalised by the summed window squared). */

export const N_FFT = 6144;
export const HOP = 1024;
export const N_BINS = N_FFT / 2 + 1;   // 3073 one-sided bins

// --- radix-2 FFT for a power-of-two length, in place. inv=true does the inverse
// (conjugate-and-scale is applied by the caller; here inv only flips the twiddle
// sign and does NOT scale). ---
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

// Precomputed pieces for the 6144 = 3 x 2048 split.
const N1 = 3, N2 = N_FFT / 3;   // 3, 2048
// Outer twiddles W_N^(n2*k1) for k1 in {0,1,2}, n2 in [0,N2). k1=0 is all 1s.
const TW_R = [new Float64Array(N2), new Float64Array(N2), new Float64Array(N2)];
const TW_I = [new Float64Array(N2), new Float64Array(N2), new Float64Array(N2)];
for (let k1 = 0; k1 < N1; k1++) {
  for (let n2 = 0; n2 < N2; n2++) {
    const ang = -2 * Math.PI * (n2 * k1) / N_FFT;
    TW_R[k1][n2] = Math.cos(ang);
    TW_I[k1][n2] = Math.sin(ang);
  }
}
// Size-3 DFT twiddles (constant).
const C3 = -0.5, S3 = Math.sqrt(3) / 2;   // cos(2pi/3)=-1/2, sin(2pi/3)=sqrt3/2

// Forward FFT of length 6144. Input arrays length 6144; returns { re, im }.
// (inv=true computes the inverse transform, unscaled; the caller scales by 1/N.)
export function fft6144(inRe, inIm, inv) {
  const s = inv ? 1 : -1;   // sign of the imaginary rotations
  // Stage 1: for each n2, a size-3 DFT over n1 of x[N2*n1 + n2].
  // Stage 2: multiply by the outer twiddle W_N^(n2*k1) (inverse => conjugate).
  // We lay the twiddled results into three length-2048 buffers, one per k1.
  const b0r = new Float64Array(N2), b0i = new Float64Array(N2);
  const b1r = new Float64Array(N2), b1i = new Float64Array(N2);
  const b2r = new Float64Array(N2), b2i = new Float64Array(N2);
  for (let n2 = 0; n2 < N2; n2++) {
    const i0 = n2, i1 = N2 + n2, i2 = 2 * N2 + n2;
    const x0r = inRe[i0], x0i = inIm[i0];
    const x1r = inRe[i1], x1i = inIm[i1];
    const x2r = inRe[i2], x2i = inIm[i2];
    // size-3 DFT (sign s on the imaginary part):
    // A0 = x0 + x1 + x2
    const a0r = x0r + x1r + x2r,           a0i = x0i + x1i + x2i;
    // t = C3*(x1+x2), u = S3*(x1-x2) rotated by s
    const sumr = x1r + x2r,  sumi = x1i + x2i;
    const difr = x1r - x2r,  difi = x1i - x2i;
    const tr = x0r + C3 * sumr, ti = x0i + C3 * sumi;
    // +/- i*S3*(x1-x2): multiply (difr,difi) by (0, s*S3) => (-s*S3*difi, s*S3*difr)
    const ur = -s * S3 * difi, ui = s * S3 * difr;
    const a1r = tr + ur, a1i = ti + ui;   // k1=1
    const a2r = tr - ur, a2i = ti - ui;   // k1=2
    // Stage 2 twiddle. For the inverse we conjugate the outer twiddle (sign of I flips).
    b0r[n2] = a0r; b0i[n2] = a0i;   // k1=0 twiddle is 1
    const w1r = TW_R[1][n2], w1i = inv ? -TW_I[1][n2] : TW_I[1][n2];
    const w2r = TW_R[2][n2], w2i = inv ? -TW_I[2][n2] : TW_I[2][n2];
    b1r[n2] = a1r * w1r - a1i * w1i; b1i[n2] = a1r * w1i + a1i * w1r;
    b2r[n2] = a2r * w2r - a2i * w2i; b2i[n2] = a2r * w2i + a2i * w2r;
  }
  // Stage 3: length-2048 FFTs of each k1 buffer.
  fftRadix2(b0r, b0i, inv);
  fftRadix2(b1r, b1i, inv);
  fftRadix2(b2r, b2i, inv);
  // Recombine: X[k1 + 3*k2] = Y_k1[k2].
  const outRe = new Float64Array(N_FFT), outIm = new Float64Array(N_FFT);
  for (let k2 = 0; k2 < N2; k2++) {
    outRe[3 * k2] = b0r[k2];         outIm[3 * k2] = b0i[k2];
    outRe[3 * k2 + 1] = b1r[k2];     outIm[3 * k2 + 1] = b1i[k2];
    outRe[3 * k2 + 2] = b2r[k2];     outIm[3 * k2 + 2] = b2i[k2];
  }
  return { re: outRe, im: outIm };
}

// Periodic Hann window (matches torch.hann_window default): w[n]=0.5-0.5cos(2pi n/N).
export function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
  return w;
}

// STFT with center=True: the signal is zero-padded by N_FFT/2 on each side, then
// framed every HOP. Returns one-sided spectra (N_BINS bins) as flat Float32Arrays
// [frame*N_BINS + bin], plus the frame count. Matches torch.stft's frame layout.
export function stft(signal, win) {
  const w = win || hann(N_FFT);
  const pad = N_FFT / 2;
  const padded = new Float64Array(signal.length + 2 * pad);
  padded.set(signal, pad);
  const frames = 1 + Math.floor((padded.length - N_FFT) / HOP);
  const re = new Float32Array(frames * N_BINS);
  const im = new Float32Array(frames * N_BINS);
  const fr = new Float64Array(N_FFT), fi = new Float64Array(N_FFT);
  for (let m = 0; m < frames; m++) {
    const off = m * HOP;
    for (let i = 0; i < N_FFT; i++) { fr[i] = padded[off + i] * w[i]; fi[i] = 0; }
    const spec = fft6144(fr, fi, false);
    const base = m * N_BINS;
    for (let b = 0; b < N_BINS; b++) { re[base + b] = spec.re[b]; im[base + b] = spec.im[b]; }
  }
  return { re, im, frames, bins: N_BINS };
}

// ISTFT inverse of stft(): rebuild the full 6144 hermitian spectrum from the
// one-sided bins, inverse-FFT, window, overlap-add, and normalise by the summed
// window squared - the exact weighted-overlap-add inverse (torch.istft, center).
export function istft(re, im, frames, length, win) {
  const w = win || hann(N_FFT);
  const pad = N_FFT / 2;
  const outLen = length + 2 * pad;
  const out = new Float64Array(outLen);
  const wsum = new Float64Array(outLen);
  const fr = new Float64Array(N_FFT), fi = new Float64Array(N_FFT);
  for (let m = 0; m < frames; m++) {
    const base = m * N_BINS;
    // rebuild hermitian-symmetric full spectrum
    for (let b = 0; b < N_BINS; b++) { fr[b] = re[base + b]; fi[b] = im[base + b]; }
    for (let b = 1; b < N_FFT - N_BINS + 1; b++) {
      fr[N_FFT - b] = re[base + b];
      fi[N_FFT - b] = -im[base + b];
    }
    const rec = fft6144(fr, fi, true);   // inverse, unscaled
    const off = m * HOP;
    for (let i = 0; i < N_FFT; i++) {
      const val = (rec.re[i] / N_FFT) * w[i];   // scale inverse + synthesis window
      out[off + i] += val;
      wsum[off + i] += w[i] * w[i];
    }
  }
  const sig = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    const ws = wsum[pad + i];
    sig[i] = ws > 1e-8 ? out[pad + i] / ws : 0;
  }
  return sig;
}
