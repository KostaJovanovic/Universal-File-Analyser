/* Analyser - audio analysis
   Pure-computation routines over decoded sample buffers: level stats,
   spectral centroid, LUFS loudness, pitch (YIN), tempo, and stereo metrics.
   No DOM, no Web Audio - just arrays in, numbers out. */

export function computeStats(samples) {
  let peak = 0, sumSq = 0, clipped = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
    sumSq += samples[i] * samples[i];
    if (a >= 0.999) clipped++;
  }
  const rms = Math.sqrt(sumSq / samples.length);
  const peakDb = 20 * Math.log10(peak + 1e-12);
  const rmsDb  = 20 * Math.log10(rms  + 1e-12);
  return { peak, rms, peakDb, rmsDb, clipped };
}

// Precomputed twiddle factors and Hann window, cached per FFT size.
//
// The butterfly loops below used to compute `Math.cos(-PI*j/s)` and the matching
// sin on every single butterfly, and rebuild the Hann window on every frame -
// two transcendental calls per butterfly, which dominated the cost of both
// whole-file passes in this file (and they run over every sample of the track).
// The values only depend on the FFT size, so they are built once and reused.
// Results are bit-identical: same angles, same order, just looked up.
const _fftCache = new Map();
function fftTables(N) {
  let t = _fftCache.get(N);
  if (t) return t;
  const half = N >> 1;
  const cosT = new Float64Array(half), sinT = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    const a = -Math.PI * k / half;
    cosT[k] = Math.cos(a);
    sinT[k] = Math.sin(a);
  }
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  t = { cosT, sinT, win, half };
  _fftCache.set(N, t);
  return t;
}

export async function computeCentroid(samples, sampleRate, tick) {
  const N = 4096;
  const frames = Math.floor(samples.length / N);
  if (frames === 0) return null;
  const { cosT, sinT, win, half } = fftTables(N);
  // Reused across frames - this allocated two Float32Arrays per frame before,
  // which on a long track meant thousands of throwaway buffers.
  const re = new Float32Array(N), im = new Float32Array(N);
  let totalCentroid = 0;
  for (let f = 0; f < frames; f++) {
    if (tick && (f & 0x1F) === 0) await tick();
    const off = f * N;
    for (let i = 0; i < N; i++) { re[i] = samples[off + i] * win[i]; im[i] = 0; }
    for (let s = 1; s < N; s <<= 1) {
      const step = half / s;
      for (let k = 0; k < N; k += s << 1) {
        for (let j = 0; j < s; j++) {
          const idx = j * step;
          const wr = cosT[idx], wi = sinT[idx];
          const tr = re[k + j + s] * wr - im[k + j + s] * wi;
          const ti = re[k + j + s] * wi + im[k + j + s] * wr;
          re[k + j + s] = re[k + j] - tr; im[k + j + s] = im[k + j] - ti;
          re[k + j] += tr; im[k + j] += ti;
        }
      }
    }
    let num = 0, den = 0;
    for (let i = 0; i < half; i++) {
      const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
      const freq = (i * sampleRate) / N;
      num += freq * mag;
      den += mag;
    }
    if (den > 0) totalCentroid += num / den;
  }
  return totalCentroid / frames;
}

// --- Pitch detection (YIN autocorrelation) ---
export function detectPitch(samples, sampleRate) {
  const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const W = 4096;
  const threshold = 0.15;

  // Take a window from the middle of the audio
  const mid = Math.floor(samples.length / 2);
  const start = Math.max(0, mid - Math.floor(W / 2));
  const end = Math.min(samples.length, start + W);
  const len = end - start;
  if (len < W / 2) return null;

  const buf = samples.subarray(start, end);
  const halfLen = Math.floor(len / 2);

  // Step 1: Difference function
  const d = new Float32Array(halfLen);
  for (let tau = 0; tau < halfLen; tau++) {
    let sum = 0;
    for (let j = 0; j < halfLen; j++) {
      const diff = buf[j] - buf[j + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }

  // Step 2: Cumulative mean normalized difference function
  const dPrime = new Float32Array(halfLen);
  dPrime[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < halfLen; tau++) {
    runningSum += d[tau];
    dPrime[tau] = d[tau] * tau / runningSum;
  }

  // Step 3: Find the first minimum below threshold
  // Start from tau corresponding to ~20 Hz max period down to high freq
  const minTau = Math.max(2, Math.floor(sampleRate / 2000)); // up to 2000 Hz
  const maxTau = Math.min(halfLen - 1, Math.floor(sampleRate / 20)); // down to 20 Hz
  let bestTau = -1;

  for (let tau = minTau; tau < maxTau; tau++) {
    if (dPrime[tau] < threshold) {
      // Find the local minimum in this dip
      while (tau + 1 < maxTau && dPrime[tau + 1] < dPrime[tau]) {
        tau++;
      }
      bestTau = tau;
      break;
    }
  }

  if (bestTau < 0) return null;

  // Step 4: Parabolic interpolation for sub-sample accuracy
  let betterTau = bestTau;
  if (bestTau > 0 && bestTau < halfLen - 1) {
    const s0 = dPrime[bestTau - 1];
    const s1 = dPrime[bestTau];
    const s2 = dPrime[bestTau + 1];
    const shift = (s0 - s2) / (2 * (s0 - 2 * s1 + s2));
    if (Math.abs(shift) < 1) {
      betterTau = bestTau + shift;
    }
  }

  const frequency = sampleRate / betterTau;

  // Sanity check
  if (frequency < 20 || frequency > 5000 || !isFinite(frequency)) return null;

  // Convert to note name and cents
  const semitone = 12 * Math.log2(frequency / 440) + 69;
  const roundedSemitone = Math.round(semitone);
  const cents = Math.round((semitone - roundedSemitone) * 100);
  const noteIndex = ((roundedSemitone % 12) + 12) % 12;
  const octave = Math.floor(roundedSemitone / 12) - 1;
  const note = NOTE_NAMES[noteIndex] + octave;

  return { frequency, note, cents };
}

// --- BPM / Tempo detection (onset detection + autocorrelation) ---
export async function detectBPM(samples, sampleRate, tick) {
  const N = 1024;                    // FFT window size
  const hop = N / 2;                 // 50 % overlap
  const halfN = N / 2;
  const numFrames = Math.floor((samples.length - N) / hop);
  if (numFrames < 4) return null;

  // Per-frame magnitude spectrum, folded straight into the spectral flux (the
  // sum of positive magnitude differences between consecutive frames).
  //
  // This used to keep every frame's spectrum in a `mags` array so a second pass
  // could diff them - on a 5-minute track that is ~28k Float32Arrays and ~57 MB
  // held live, for a calculation that only ever looks at the previous frame. Two
  // rolling buffers do the same job, and the FFT scratch buffers are reused
  // instead of reallocated per frame.
  const { cosT, sinT, win } = fftTables(N);
  const re = new Float32Array(N), im = new Float32Array(N);
  let prevMag = new Float32Array(halfN), curMag = new Float32Array(halfN);
  const flux = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    if (tick && (f & 0x3F) === 0) await tick();
    const off = f * hop;
    // Hann window + copy
    for (let i = 0; i < N; i++) { re[i] = samples[off + i] * win[i]; im[i] = 0; }
    // In-place radix-2 FFT (same pattern as computeCentroid)
    for (let s = 1; s < N; s <<= 1) {
      const step = halfN / s;
      for (let k = 0; k < N; k += s << 1) {
        for (let j = 0; j < s; j++) {
          const idx = j * step;
          const wr = cosT[idx], wi = sinT[idx];
          const tr = re[k + j + s] * wr - im[k + j + s] * wi;
          const ti = re[k + j + s] * wi + im[k + j + s] * wr;
          re[k + j + s] = re[k + j] - tr;
          im[k + j + s] = im[k + j] - ti;
          re[k + j] += tr;
          im[k + j] += ti;
        }
      }
    }
    for (let i = 0; i < halfN; i++) curMag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    if (f > 0) {
      let sum = 0;
      for (let i = 0; i < halfN; i++) {
        const diff = curMag[i] - prevMag[i];
        if (diff > 0) sum += diff;
      }
      flux[f] = sum;
    }
    const swap = prevMag; prevMag = curMag; curMag = swap;
  }

  // Adaptive peak picking: onset if flux > local mean * 1.5
  const medianW = 8;
  const onsets = new Float32Array(numFrames);
  for (let f = medianW; f < numFrames - medianW; f++) {
    let localMean = 0;
    for (let j = f - medianW; j <= f + medianW; j++) localMean += flux[j];
    localMean /= (2 * medianW + 1);
    onsets[f] = (flux[f] > localMean * 1.5 && flux[f] > 0) ? flux[f] : 0;
  }

  // Autocorrelation of the onset signal to find dominant period
  // Search between 60 and 200 BPM
  const framesPerSec = sampleRate / hop;
  const minLag = Math.floor(framesPerSec * 60 / 200); // 200 BPM
  const maxLag = Math.ceil(framesPerSec * 60 / 60);   // 60 BPM
  if (maxLag >= numFrames) return null;

  let bestLag = minLag;
  let bestCorr = -Infinity;
  for (let lag = minLag; lag <= maxLag && lag < numFrames; lag++) {
    if (tick) await tick();
    let corr = 0;
    const len = numFrames - lag;
    for (let i = 0; i < len; i++) {
      corr += onsets[i] * onsets[i + lag];
    }
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  // Parabolic interpolation around the peak for sub-frame accuracy
  let refinedLag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    let corrPrev = 0, corrNext = 0;
    const len = numFrames - bestLag;
    for (let i = 0; i < len; i++) {
      if (i + bestLag - 1 >= 0 && i + bestLag - 1 < numFrames)
        corrPrev += onsets[i] * onsets[i + bestLag - 1];
      if (i + bestLag + 1 < numFrames)
        corrNext += onsets[i] * onsets[i + bestLag + 1];
    }
    const denom = corrPrev - 2 * bestCorr + corrNext;
    if (Math.abs(denom) > 1e-12) {
      const shift = 0.5 * (corrPrev - corrNext) / denom;
      if (Math.abs(shift) < 1) refinedLag = bestLag + shift;
    }
  }

  const periodSec = refinedLag / framesPerSec;
  const bpm = 60 / periodSec;

  // Clamp to reasonable range
  if (bpm < 60 || bpm > 200 || !isFinite(bpm)) return null;
  return Math.round(bpm);
}

// --- Stereo analysis: phase correlation, width, vectorscope ---
export function computeStereoStats(left, right) {
  let sumLR = 0, sumLL = 0, sumRR = 0;
  let sumMid = 0, sumSide = 0;
  const n = Math.min(left.length, right.length);
  for (let i = 0; i < n; i++) {
    sumLR += left[i] * right[i];
    sumLL += left[i] * left[i];
    sumRR += right[i] * right[i];
    const mid  = (left[i] + right[i]) * 0.5;
    const side = (left[i] - right[i]) * 0.5;
    sumMid  += mid * mid;
    sumSide += side * side;
  }
  const denom = Math.sqrt(sumLL * sumRR);
  const correlation = denom > 1e-12 ? sumLR / denom : 0;
  const width = 1 - Math.abs(correlation);
  const midLevel  = Math.sqrt(sumMid / n);
  const sideLevel = Math.sqrt(sumSide / n);
  return { correlation, width, midLevel, sideLevel };
}
