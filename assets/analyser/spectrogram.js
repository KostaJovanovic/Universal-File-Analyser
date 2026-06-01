/* Analyser - spectrogram engine
   - Radix-2 Cooley-Tukey FFT (in-place, complex)
   - STFT with selectable window + FFT size + hop
   - Linear/log frequency rendering
   - Colormaps: viridis, magma, inferno, grayscale, phosphor */

// ---------- WINDOWS ----------
export const windows = {
  hann: (N) => {
    const w = new Float32Array(N);
    for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
    return w;
  },
  hamming: (N) => {
    const w = new Float32Array(N);
    for (let i = 0; i < N; i++) w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (N - 1));
    return w;
  },
  blackman: (N) => {
    const w = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = (2 * Math.PI * i) / (N - 1);
      w[i] = 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
    }
    return w;
  },
  rect: (N) => {
    const w = new Float32Array(N);
    w.fill(1);
    return w;
  }
};

// ---------- FFT (radix-2 in-place, complex) ----------
// real[], imag[] of length N (power of 2). Result in-place.
export function fft(real, imag) {
  const n = real.length;
  if ((n & (n - 1)) !== 0) throw new Error('FFT size must be a power of 2');

  // bit reversal
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  // butterflies
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const tableStep = -2 * Math.PI / size;
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < half; k++) {
        const angle = tableStep * k;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const tre = real[i + k + half] * cos - imag[i + k + half] * sin;
        const tim = real[i + k + half] * sin + imag[i + k + half] * cos;
        real[i + k + half] = real[i + k] - tre;
        imag[i + k + half] = imag[i + k] - tim;
        real[i + k] += tre;
        imag[i + k] += tim;
      }
    }
  }
}

// ---------- STFT / spectrogram computation ----------
/**
 * Compute spectrogram magnitudes in dB.
 * Returns { frames, bins, sampleRate, fftSize, hopSize, data, dbMin, dbMax }
 * data is a Float32Array of length frames*bins (row-major: row = time frame).
 */
export function computeSpectrogram(samples, sampleRate, options = {}) {
  const fftSize  = options.fftSize  || 2048;
  const hopSize  = options.hopSize  || Math.floor(fftSize / 4);
  const winName  = options.window   || 'hann';
  const win      = (windows[winName] || windows.hann)(fftSize);

  if (samples.length < fftSize) {
    return { frames: 0, bins: 0, sampleRate, fftSize, hopSize, data: new Float32Array(0), dbMin: -100, dbMax: 0 };
  }

  const bins   = fftSize / 2;
  const frames = 1 + Math.floor((samples.length - fftSize) / hopSize);
  const data   = new Float32Array(frames * bins);

  // Window normalization (so absolute dB values are comparable across windows)
  let winSum = 0;
  for (let i = 0; i < fftSize; i++) winSum += win[i];
  const norm = 1 / Math.max(winSum, 1e-9);

  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);

  let dbMin = Infinity, dbMax = -Infinity;

  for (let f = 0; f < frames; f++) {
    const start = f * hopSize;
    for (let i = 0; i < fftSize; i++) {
      re[i] = samples[start + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);

    const row = f * bins;
    for (let b = 0; b < bins; b++) {
      const mag = Math.hypot(re[b], im[b]) * norm * 2; // *2 for one-sided
      const db  = 20 * Math.log10(mag + 1e-12);
      data[row + b] = db;
      if (db < dbMin) dbMin = db;
      if (db > dbMax) dbMax = db;
    }
  }

  return { frames, bins, sampleRate, fftSize, hopSize, data, dbMin, dbMax };
}

// ---------- COLORMAPS ----------
// Each returns [r,g,b] for t in [0,1]
function lerp(a, b, t) { return a + (b - a) * t; }

function makeRampMap(stops) {
  // stops: [[t, r, g, b], ...] sorted by t
  return (t) => {
    if (t <= stops[0][0]) return [stops[0][1], stops[0][2], stops[0][3]];
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const lo = stops[i - 1], hi = stops[i];
        const k = (t - lo[0]) / (hi[0] - lo[0]);
        return [lerp(lo[1], hi[1], k), lerp(lo[2], hi[2], k), lerp(lo[3], hi[3], k)];
      }
    }
    const last = stops[stops.length - 1];
    return [last[1], last[2], last[3]];
  };
}

export const colormaps = {
  // matplotlib-inspired, ~7 stops each (close enough for a spectrogram)
  viridis: makeRampMap([
    [0.00,  68,   1,  84],
    [0.20,  72,  35, 116],
    [0.40,  64,  67, 135],
    [0.60,  37, 131, 142],
    [0.75,  53, 183, 121],
    [0.90, 180, 222,  44],
    [1.00, 253, 231,  37]
  ]),
  magma: makeRampMap([
    [0.00,   0,   0,   4],
    [0.20,  40,  11,  84],
    [0.40, 101,  21, 110],
    [0.60, 158,  47, 127],
    [0.75, 212,  72, 109],
    [0.90, 247, 130,  80],
    [1.00, 252, 253, 191]
  ]),
  inferno: makeRampMap([
    [0.00,   0,   0,   4],
    [0.20,  40,   9,  88],
    [0.40, 102,  16, 108],
    [0.60, 174,  43, 105],
    [0.75, 229,  80,  72],
    [0.90, 252, 165,  29],
    [1.00, 252, 255, 164]
  ]),
  grayscale: makeRampMap([
    [0.00,   0,   0,   0],
    [1.00, 255, 255, 255]
  ]),
  // phosphor: sajt90's powder blue glow on black
  phosphor: makeRampMap([
    [0.00,   0,   0,   0],
    [0.30,  20,  40,  60],
    [0.55, 128, 164, 186], // --color-mid
    [0.80, 200, 220, 232], // --color-light-mid
    [1.00, 247, 250, 252]  // --color-light
  ])
};

// ---------- RENDERING ----------
/**
 * Render a precomputed spectrogram (from computeSpectrogram) to a canvas.
 * opts: { scale: 'log'|'linear', colormap: name, dbFloor, dbCeil, minHz, maxHz }
 */
export function renderSpectrogram(canvas, spec, opts = {}) {
  const { frames, bins, sampleRate, data } = spec;
  if (!frames || !bins) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const scale     = opts.scale     || 'log';
  const cmapName  = opts.colormap  || 'viridis';
  const dbFloor   = opts.dbFloor   != null ? opts.dbFloor : -90;
  const dbCeil    = opts.dbCeil    != null ? opts.dbCeil  : -10;
  const minHz     = opts.minHz     != null ? opts.minHz   : 20;
  const maxHz     = opts.maxHz     != null ? opts.maxHz   : sampleRate / 2;
  const cmap      = colormaps[cmapName] || colormaps.viridis;

  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const pixels = img.data;

  const nyq = sampleRate / 2;
  const dbRange = Math.max(1e-6, dbCeil - dbFloor);

  // Precompute per-x time frame
  const frameForX = new Int32Array(w);
  for (let x = 0; x < w; x++) {
    frameForX[x] = Math.min(frames - 1, Math.floor((x / w) * frames));
  }

  // Precompute per-y bin index (one per pixel row, top = high freq)
  const binForY = new Float32Array(h);
  if (scale === 'log') {
    const logMin = Math.log10(Math.max(20, minHz));
    const logMax = Math.log10(Math.max(logMin + 0.001, maxHz));
    for (let y = 0; y < h; y++) {
      const frac = 1 - y / (h - 1); // 0 at bottom, 1 at top
      const hz = Math.pow(10, logMin + frac * (logMax - logMin));
      binForY[y] = (hz / nyq) * bins;
    }
  } else {
    for (let y = 0; y < h; y++) {
      const frac = 1 - y / (h - 1);
      const hz = minHz + frac * (maxHz - minHz);
      binForY[y] = (hz / nyq) * bins;
    }
  }

  for (let y = 0; y < h; y++) {
    const binF = binForY[y];
    const b0 = Math.max(0, Math.min(bins - 1, Math.floor(binF)));
    const b1 = Math.max(0, Math.min(bins - 1, b0 + 1));
    const kBin = binF - b0;

    for (let x = 0; x < w; x++) {
      const f = frameForX[x];
      const row = f * bins;
      const v0 = data[row + b0];
      const v1 = data[row + b1];
      const db = v0 + (v1 - v0) * kBin;
      let t = (db - dbFloor) / dbRange;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const [r, g, bl] = cmap(t);
      const o = (y * w + x) * 4;
      pixels[o]     = r;
      pixels[o + 1] = g;
      pixels[o + 2] = bl;
      pixels[o + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
}

// ---------- AXIS LABELS (for HTML overlays) ----------
export function frequencyTicks(minHz, maxHz, scale) {
  if (scale === 'log') {
    const ticks = [];
    const decades = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    for (const t of decades) {
      if (t >= minHz && t <= maxHz) ticks.push(t);
    }
    return ticks;
  }
  // linear: pick ~6 round numbers
  const ticks = [];
  const step = niceStep((maxHz - minHz) / 6);
  let v = Math.ceil(minHz / step) * step;
  while (v <= maxHz) { ticks.push(v); v += step; }
  return ticks;
}

function niceStep(rough) {
  const exp = Math.floor(Math.log10(rough));
  const base = Math.pow(10, exp);
  const m = rough / base;
  let nice;
  if (m < 1.5) nice = 1;
  else if (m < 3) nice = 2;
  else if (m < 7) nice = 5;
  else nice = 10;
  return nice * base;
}

export function timeTicks(durationSec) {
  const step = niceStep(durationSec / 6);
  const ticks = [];
  for (let t = 0; t <= durationSec + 1e-6; t += step) ticks.push(t);
  return ticks;
}

export function formatHz(hz) {
  if (hz >= 1000) return (hz / 1000).toFixed(hz >= 10000 ? 0 : 1) + 'k';
  return Math.round(hz) + '';
}

export function formatTime(sec) {
  if (sec < 60) return sec.toFixed(sec < 10 ? 2 : 1) + 's';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m + ':' + s.toFixed(1).padStart(4, '0');
}
