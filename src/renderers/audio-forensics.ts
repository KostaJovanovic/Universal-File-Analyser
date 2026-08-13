/* Analyser - audio forensics
   Pure-computation DSP over decoded sample buffers, no DOM and no Web Audio.
   Powers the audio spectral/loudness/signal forensics cards:
     - longAverageSpectrum : one Welch-averaged power spectrum, reused below
     - analyzeTranscode    : lossy-transcode / "fake lossless" verdict
     - analyzeUltrasonic   : energy + tones above ~18 kHz
     - analyzeMainsHum     : 50/60 Hz mains hum + harmonics (ENF gateway)
     - detectKey           : musical key (chroma + Krumhansl-Schmuckler)
     - loudnessR128        : EBU R128 momentary/short-term/integrated + LRA
     - truePeakDb          : 4x-oversampled inter-sample true peak (dBTP)
     - signalHealth        : crest factor, DC offset, effective bit depth
     - detectDtmf          : DTMF touch-tone decoder (Goertzel)
   Arrays in, plain objects out. */

import { fft } from './spectrogram.js';

// ---------- shared long-average (Welch) power spectrum ----------
// One high-resolution averaged power spectrum spread across the whole file. A
// large window keeps low-frequency resolution fine enough for mains hum while
// still reaching the Nyquist ceiling for the transcode/ultrasonic reads.
export async function longAverageSpectrum(mono, sampleRate, opts: any = {}) {
  const N = opts.fftSize || 32768;
  const maxWindows = opts.maxWindows || 160;
  const tick = opts.tick;
  const half = N >> 1;
  const power = new Float64Array(half);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)); // Hann

  const total = mono.length;
  let windows = 0;
  if (total < N) {
    // Short file: one zero-padded window.
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < total; i++) re[i] = mono[i] * win[i];
    fft(re, im);
    for (let b = 0; b < half; b++) power[b] += re[b] * re[b] + im[b] * im[b];
    windows = 1;
  } else {
    const span = total - N;
    const count = Math.min(maxWindows, Math.max(1, Math.floor(total / N)));
    const step = count > 1 ? span / (count - 1) : 0;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let w = 0; w < count; w++) {
      if (tick) await tick();
      const off = Math.floor(w * step);
      for (let i = 0; i < N; i++) { re[i] = mono[off + i] * win[i]; im[i] = 0; }
      fft(re, im);
      for (let b = 0; b < half; b++) power[b] += re[b] * re[b] + im[b] * im[b];
      windows++;
    }
  }
  for (let b = 0; b < half; b++) power[b] /= windows;

  // dB relative to the strongest bin - the shape is what matters, not absolute level.
  const db = new Float64Array(half);
  let peak = 1e-30;
  for (let b = 0; b < half; b++) if (power[b] > peak) peak = power[b];
  for (let b = 0; b < half; b++) db[b] = 10 * Math.log10(power[b] / peak + 1e-30);

  return { power, db, fftSize: N, bins: half, sampleRate, binHz: sampleRate / N, windows };
}

const binOfHz = (spec, hz) => Math.round(hz / spec.binHz);
const hzOfBin = (spec, bin) => bin * spec.binHz;

// ---------- lossy-transcode / "fake lossless" detector ----------
// Find the frequency where broadband energy collapses (the codec low-pass edge),
// and - for a file that claims to be lossless - decide whether that edge betrays
// a lossy source. Maps the cutoff to a probable source bitrate.
export function analyzeTranscode(spec, opts: any = {}) {
  const nyquist = spec.sampleRate / 2;
  const { db, binHz } = spec;

  // Smooth the dB curve a little so a single noisy bin doesn't set the edge.
  const smoothN = Math.max(1, Math.round(200 / binHz)); // ~200 Hz box
  const sm = new Float64Array(db.length);
  let acc = 0;
  for (let b = 0; b < db.length; b++) {
    acc += db[b];
    if (b >= smoothN) acc -= db[b - smoothN];
    sm[b] = acc / Math.min(b + 1, smoothN);
  }

  // Reference passband level: strongest smoothed bin below 4 kHz.
  const refTop = Math.min(db.length - 1, binOfHz(spec, 4000));
  let ref = -Infinity;
  for (let b = 1; b <= refTop; b++) if (sm[b] > ref) ref = sm[b];

  // Highest frequency whose energy is still within 40 dB of the passband.
  const FLOOR = -40;
  let cutoffBin = db.length - 1;
  for (let b = db.length - 1; b > refTop; b--) {
    if (sm[b] - ref > FLOOR) { cutoffBin = b; break; }
  }
  const cutoffHz = hzOfBin(spec, cutoffBin);

  // Rolloff steepness across the ~1 kHz above the edge: a brick wall (codec) vs a
  // gentle natural slope.
  const above = Math.min(db.length - 1, cutoffBin + Math.round(1000 / binHz));
  const dropDb = sm[cutoffBin] - sm[above];
  const steepDbPerKHz = dropDb / Math.max(0.1, (hzOfBin(spec, above) - cutoffHz) / 1000);

  // How close the edge sits to the theoretical ceiling. Full-band lossless reaches
  // ~95%+ of Nyquist; a lossy low-pass sits well below.
  const fillFrac = cutoffHz / nyquist;
  const brickwall = steepDbPerKHz > 30 && fillFrac < 0.96 && cutoffHz < 20800;

  // Map the cutoff to a probable MP3/AAC source rate.
  let sourceGuess = null;
  if (brickwall) {
    if (cutoffHz < 11500) sourceGuess = 'MP3 96 kbps or lower';
    else if (cutoffHz < 16500) sourceGuess = 'MP3 128 kbps / AAC ~96 kbps';
    else if (cutoffHz < 18500) sourceGuess = 'MP3 160-192 kbps / AAC 128 kbps';
    else if (cutoffHz < 19700) sourceGuess = 'MP3 256 kbps / AAC ~192 kbps';
    else sourceGuess = 'MP3 320 kbps / AAC ~256 kbps';
  }

  const declaredLossless = !!opts.declaredLossless;
  let verdict, level;
  if (declaredLossless && brickwall) {
    verdict = 'Likely lossy source - declared lossless but hard low-pass at ' + Math.round(cutoffHz).toLocaleString() + ' Hz';
    level = 'bad';
  } else if (brickwall) {
    verdict = 'Lossy low-pass at ' + Math.round(cutoffHz).toLocaleString() + ' Hz (expected for a lossy format)';
    level = 'info';
  } else if (declaredLossless) {
    verdict = 'Full-band - consistent with genuine lossless';
    level = 'good';
  } else {
    verdict = 'Full-band up to ' + Math.round(cutoffHz).toLocaleString() + ' Hz';
    level = 'info';
  }

  return { cutoffHz, nyquist, fillFrac, steepDbPerKHz, brickwall, sourceGuess, verdict, level, declaredLossless };
}

// ---------- ultrasonic / near-ultrasonic content ----------
// Energy above ~18 kHz relative to the whole band, plus any narrowband tones up
// there (tracking beacons, pairing tones, watermarks).
export function analyzeUltrasonic(spec, opts: any = {}) {
  const startHz = opts.startHz || 18000;
  const nyquist = spec.sampleRate / 2;
  if (nyquist <= startHz + 500) return { supported: false, nyquist };

  const { power } = spec;
  const startBin = binOfHz(spec, startHz);
  let hi = 0, tot = 0;
  for (let b = 1; b < power.length; b++) { tot += power[b]; if (b >= startBin) hi += power[b]; }
  const ratioDb = 10 * Math.log10((hi + 1e-30) / (tot + 1e-30));

  // Narrowband tones: bins that stand well above their local neighbourhood.
  const peaks = [];
  const nb = Math.max(2, binOfHz(spec, 200));
  for (let b = startBin; b < power.length - nb; b++) {
    let localMax = true;
    for (let k = -nb; k <= nb; k++) { if (k && power[b + k] > power[b]) { localMax = false; break; } }
    if (!localMax) continue;
    let med = 0; for (let k = -nb; k <= nb; k++) med += power[b + k];
    med /= (2 * nb + 1);
    const prom = 10 * Math.log10((power[b] + 1e-30) / (med + 1e-30));
    if (prom > 12) peaks.push({ hz: hzOfBin(spec, b), promDb: prom });
  }
  peaks.sort((a, b) => b.promDb - a.promDb);

  // Meaningful ultrasonic content: appreciable band energy or a clear tone.
  const present = ratioDb > -55 || peaks.length > 0;
  return { supported: true, nyquist, startHz, ratioDb, peaks: peaks.slice(0, 6), present };
}

// ---------- mains hum / ENF (50 / 60 Hz) ----------
export function analyzeMainsHum(spec) {
  // Prominence of a candidate frequency = its peak bin above the local median.
  const prominence = (hz) => {
    const b = binOfHz(spec, hz);
    if (b < 3 || b >= spec.power.length - 3) return { hz, db: -Infinity, exactHz: hz };
    // Take the strongest of the 3 bins around the target (leakage tolerance).
    let pk = b, pv = spec.power[b];
    for (let k = -2; k <= 2; k++) if (spec.power[b + k] > pv) { pv = spec.power[b + k]; pk = b + k; }
    const win = Math.max(4, binOfHz(spec, 6));
    let med = 0, n = 0;
    for (let k = -win; k <= win; k++) {
      const bb = pk + k;
      if (bb < 1 || bb >= spec.power.length || Math.abs(k) <= 2) continue;
      med += spec.power[bb]; n++;
    }
    med = n ? med / n : 1e-30;
    return { hz, exactHz: hzOfBin(spec, pk), db: 10 * Math.log10((pv + 1e-30) / (med + 1e-30)) };
  };

  const fam = (base) => {
    const parts = [prominence(base), prominence(base * 2), prominence(base * 3)];
    // Strength = fundamental prominence plus a bonus for present harmonics.
    let score = parts[0].db;
    for (let i = 1; i < parts.length; i++) if (parts[i].db > 8) score += parts[i].db * 0.3;
    return { base, parts, score };
  };

  const f50 = fam(50), f60 = fam(60);
  const best = f50.score >= f60.score ? f50 : f60;
  const present = best.parts[0].db > 10; // fundamental clearly above the floor
  const harmonics = best.parts.filter((p) => p.db > 8).map((p) => ({ hz: p.hz, exactHz: p.exactHz, db: p.db }));
  return {
    present,
    baseHz: best.base,
    region: best.base === 50 ? '50 Hz (Europe / Asia / Africa / most of the world)' : '60 Hz (North America / parts of South America / Japan)',
    fundamentalDb: best.parts[0].db,
    exactHz: best.parts[0].exactHz,
    harmonics,
  };
}

// ---------- musical key (chroma + Krumhansl-Schmuckler) ----------
const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function detectKey(spec) {
  // Fold spectral power into a 12-bin chroma over the musical range (~C2-C7).
  const chroma = new Float64Array(12);
  const loBin = Math.max(1, binOfHz(spec, 65));
  const hiBin = Math.min(spec.power.length - 1, binOfHz(spec, 2100));
  let any = 0;
  for (let b = loBin; b <= hiBin; b++) {
    const hz = hzOfBin(spec, b);
    const midi = 69 + 12 * Math.log2(hz / 440);
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    chroma[pc] += spec.power[b];
    any += spec.power[b];
  }
  if (any <= 0) return null;

  // Normalise (zero-mean) for correlation.
  let mean = 0; for (let i = 0; i < 12; i++) mean += chroma[i]; mean /= 12;
  const cv = new Float64Array(12); for (let i = 0; i < 12; i++) cv[i] = chroma[i] - mean;

  const corr = (profile, rot) => {
    let pm = 0; for (let i = 0; i < 12; i++) pm += profile[i]; pm /= 12;
    let num = 0, dp = 0, dc = 0;
    for (let i = 0; i < 12; i++) {
      const p = profile[(i - rot + 12) % 12] - pm;
      num += p * cv[i]; dp += p * p; dc += cv[i] * cv[i];
    }
    const den = Math.sqrt(dp * dc);
    return den > 1e-12 ? num / den : 0;
  };

  const cands = [];
  for (let r = 0; r < 12; r++) {
    cands.push({ name: PITCH_NAMES[r] + ' major', tonic: r, mode: 'major', score: corr(KS_MAJOR, r) });
    cands.push({ name: PITCH_NAMES[r] + ' minor', tonic: r, mode: 'minor', score: corr(KS_MINOR, r) });
  }
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0], alt = cands[1];
  // Confidence: gap between the top two, scaled - a clear winner separates well.
  const confidence = Math.max(0, Math.min(1, (best.score - alt.score) * 3 + best.score * 0.3));
  const normChroma = Array.from(chroma, (v) => v / any);
  return { key: best.name, score: best.score, alt: alt.name, altScore: alt.score, confidence, chroma: normChroma };
}

// ---------- EBU R128 loudness (momentary / short-term / integrated + LRA) ----------
async function kWeight(samples, sampleRate, tick) {
  const applyBiquad = async (x, b0, b1, b2, a1, a2) => {
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      if (tick && (i & 0x3FFF) === 0) await tick();
      const xi = x[i];
      const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      y[i] = yi; x2 = x1; x1 = xi; y2 = y1; y1 = yi;
    }
    return y;
  };
  const shelfF0 = 1681.974450955533, shelfG = 3.999843853973347, shelfQ = 0.7071752369554196;
  const A1 = Math.pow(10, shelfG / 40), w1 = 2 * Math.PI * shelfF0 / sampleRate;
  const c1 = Math.cos(w1), s1 = Math.sin(w1), al1 = s1 / (2 * shelfQ), sq = Math.sqrt(A1);
  const a0s = (A1 + 1) - (A1 - 1) * c1 + 2 * sq * al1;
  const st1 = await applyBiquad(samples,
    (A1 * ((A1 + 1) + (A1 - 1) * c1 + 2 * sq * al1)) / a0s,
    (-2 * A1 * ((A1 - 1) + (A1 + 1) * c1)) / a0s,
    (A1 * ((A1 + 1) + (A1 - 1) * c1 - 2 * sq * al1)) / a0s,
    (2 * ((A1 - 1) - (A1 + 1) * c1)) / a0s,
    ((A1 + 1) - (A1 - 1) * c1 - 2 * sq * al1) / a0s);
  const hpF0 = 38.13547087602444, hpQ = 0.5003270373238773;
  const w2 = 2 * Math.PI * hpF0 / sampleRate, c2 = Math.cos(w2), s2 = Math.sin(w2), al2 = s2 / (2 * hpQ);
  const a0h = 1 + al2;
  return applyBiquad(st1, ((1 + c2) / 2) / a0h, (-(1 + c2)) / a0h, ((1 + c2) / 2) / a0h, (-2 * c2) / a0h, (1 - al2) / a0h);
}
// (kWeight returns the promise from its final applyBiquad; loudnessR128 awaits it.)

const msToLufs = (ms) => -0.691 + 10 * Math.log10(ms + 1e-30);

export async function loudnessR128(mono, sampleRate, tick) {
  const f = await kWeight(mono, sampleRate, tick);

  // Blocks of a given length with a hop; return per-block mean square.
  const blockMs = async (blockSec, hopSec) => {
    const bl = Math.round(blockSec * sampleRate), hop = Math.round(hopSec * sampleRate);
    const out = [];
    if (f.length < bl) return out;
    let bc = 0;
    for (let start = 0; start + bl <= f.length; start += hop) {
      if (tick && (bc++ & 0x3F) === 0) await tick();
      let s = 0; for (let i = start; i < start + bl; i++) s += f[i] * f[i];
      out.push({ t: start / sampleRate, ms: s / bl });
    }
    return out;
  };

  const mom = await blockMs(0.4, 0.1);   // momentary: 400 ms / 100 ms hop
  const shrt = await blockMs(3.0, 1.0);  // short-term: 3 s / 1 s hop

  let momentaryMax = -Infinity, shortTermMax = -Infinity;
  const series = [];
  for (const b of mom) { const l = msToLufs(b.ms); if (l > momentaryMax) momentaryMax = l; series.push({ t: b.t, lufs: l }); }
  for (const b of shrt) { const l = msToLufs(b.ms); if (l > shortTermMax) shortTermMax = l; }

  // Gated integrated loudness (BS.1770 two-stage gate) over 400 ms / 75% overlap
  // blocks - which is exactly the momentary block set already computed above, so
  // reuse it rather than running the same full-length pass a second time.
  const gate = mom;
  const ABS = -70;
  let sum = 0, n = 0;
  for (const b of gate) { if (msToLufs(b.ms) > ABS) { sum += b.ms; n++; } }
  let integrated = -Infinity;
  if (n) {
    const relGate = msToLufs(sum / n) - 10;
    let s2 = 0, n2 = 0;
    for (const b of gate) { if (msToLufs(b.ms) > relGate && msToLufs(b.ms) > ABS) { s2 += b.ms; n2++; } }
    integrated = n2 ? msToLufs(s2 / n2) : -Infinity;
  }

  // Loudness range: 10th-95th percentile spread of short-term blocks, gated -20 LU
  // below their own mean.
  let lra = null;
  const stl = shrt.map((b) => msToLufs(b.ms)).filter((l) => l > ABS);
  if (stl.length > 4) {
    const meanSt = msToLufs(shrt.reduce((a, b) => a + b.ms, 0) / shrt.length);
    const gated = stl.filter((l) => l > meanSt - 20).sort((a, b) => a - b);
    if (gated.length > 1) {
      const pct = (p) => gated[Math.min(gated.length - 1, Math.max(0, Math.round(p * (gated.length - 1))))];
      lra = pct(0.95) - pct(0.10);
    }
  }

  return { integrated, momentaryMax, shortTermMax, lra, series, duration: mono.length / sampleRate };
}

// ---------- true peak (4x oversampled inter-sample peak, dBTP) ----------
export async function truePeakDb(channels, sampleRate, tick) {
  const OS = 4, half = 8, L = OS * half * 2; // 64-tap windowed-sinc interpolator
  // Build the interpolation kernel (cutoff at the original Nyquist, i.e. 1/OS).
  const kernel = new Float64Array(L);
  const fc = 1 / OS;
  for (let i = 0; i < L; i++) {
    const x = i - (L - 1) / 2;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * fc * x) / (Math.PI * fc * x);
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (L - 1)); // Hann
    kernel[i] = fc * sinc * w;
  }
  // Split into OS polyphase sub-filters.
  const taps = half * 2;
  const phase = [];
  for (let p = 0; p < OS; p++) {
    const sub = new Float64Array(taps);
    for (let k = 0; k < taps; k++) sub[k] = kernel[p + OS * k] * OS;
    phase.push(sub);
  }

  let peak = 0;
  for (const ch of channels) {
    // Raw sample peak (phase 0 passes samples through unchanged in effect).
    for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > peak) peak = a; }
    // Interpolated inter-sample values.
    for (let n = half; n < ch.length - half; n++) {
      if (tick && (n & 0x3FFF) === 0) await tick();
      for (let p = 1; p < OS; p++) {
        const sub = phase[p];
        let acc = 0;
        for (let k = 0; k < taps; k++) acc += sub[k] * ch[n - half + 1 + k];
        const a = Math.abs(acc);
        if (a > peak) peak = a;
      }
    }
  }
  return 20 * Math.log10(peak + 1e-12);
}

// ---------- signal health: crest factor, DC offset, effective bit depth ----------
export async function signalHealth(channels, tick) {
  let peak = 0, sumSq = 0, count = 0;
  let orAccum = 0; // OR of all sample magnitudes quantised to 24-bit ints
  const dcPerCh = [];
  for (const ch of channels) {
    let sum = 0;
    for (let i = 0; i < ch.length; i++) {
      if (tick && (i & 0x3FFF) === 0) await tick();
      const v = ch[i];
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sumSq += v * v; sum += v; count++;
      // Quantise to a signed 24-bit integer and accumulate set bits to recover the
      // real quantisation step (padded/upscaled depth reveals itself as trailing zeros).
      const q = Math.round(v * 8388608) & 0xffffff;
      orAccum |= q;
    }
    dcPerCh.push(sum / ch.length);
  }
  const rms = Math.sqrt(sumSq / count);
  const peakDb = 20 * Math.log10(peak + 1e-12);
  const rmsDb = 20 * Math.log10(rms + 1e-12);
  const crestDb = peakDb - rmsDb;

  let maxDc = 0; for (const d of dcPerCh) if (Math.abs(d) > Math.abs(maxDc)) maxDc = d;
  const dcDb = 20 * Math.log10(Math.abs(maxDc) + 1e-12);

  // Effective bit depth: 24 minus the number of trailing zero bits common to every
  // sample. All-zero signal is treated as 0.
  let effectiveBits = 24;
  if (orAccum === 0) effectiveBits = 0;
  else { let tz = 0; while (tz < 24 && !((orAccum >> tz) & 1)) tz++; effectiveBits = 24 - tz; }

  return { crestDb, peakDb, rmsDb, dcOffset: maxDc, dcDb, effectiveBits, dcPerCh };
}

// ---------- DTMF touch-tone decoder (Goertzel) ----------
const DTMF_LOW = [697, 770, 852, 941];
const DTMF_HIGH = [1209, 1336, 1477, 1633];
const DTMF_GRID = [
  ['1', '2', '3', 'A'],
  ['4', '5', '6', 'B'],
  ['7', '8', '9', 'C'],
  ['*', '0', '#', 'D'],
];

export async function detectDtmf(mono, sampleRate, tick) {
  const winSec = 0.035, hopSec = 0.015;
  const W = Math.round(winSec * sampleRate), hop = Math.round(hopSec * sampleRate);
  if (mono.length < W) return { digits: [], sequence: '' };

  const freqs = DTMF_LOW.concat(DTMF_HIGH);
  const coeff = freqs.map((f) => 2 * Math.cos((2 * Math.PI * Math.round((f / sampleRate) * W)) / W));

  const frameDigit = (start) => {
    let total = 0;
    for (let i = 0; i < W; i++) { const v = mono[start + i]; total += v * v; }
    if (total < 1e-4) return null; // silence
    const mag = new Float64Array(freqs.length);
    for (let k = 0; k < freqs.length; k++) {
      let s0 = 0, s1 = 0, s2 = 0;
      const c = coeff[k];
      for (let i = 0; i < W; i++) { s0 = mono[start + i] + c * s1 - s2; s2 = s1; s1 = s0; }
      mag[k] = s1 * s1 + s2 * s2 - c * s1 * s2;
    }
    // Strongest in each group; require dominance over the rest of its group.
    let li = 0, hi = 4;
    for (let i = 1; i < 4; i++) if (mag[i] > mag[li]) li = i;
    for (let i = 5; i < 8; i++) if (mag[i] > mag[hi]) hi = i;
    const low = mag[li], high = mag[hi];
    let secLow = 0, secHigh = 0;
    for (let i = 0; i < 4; i++) { if (i !== li && mag[i] > secLow) secLow = mag[i]; if (4 + i !== hi && mag[4 + i] > secHigh) secHigh = mag[4 + i]; }
    // Twist + presence + purity checks.
    const rowColSum = low + high;
    if (rowColSum < total * 0.30) return null;              // tones must dominate the frame
    if (low < secLow * 4 || high < secHigh * 4) return null; // one clear tone per group
    const twist = 10 * Math.log10((low + 1e-30) / (high + 1e-30));
    if (Math.abs(twist) > 8) return null;   // ITU-T Q.24 receivers accept ~8 dB twist; looser than that admits music transients
    return DTMF_GRID[li][hi - 4];
  };

  // Slide, then debounce into stable digit events (min ~60 ms).
  const raw = [];
  let dc = 0;
  for (let start = 0; start + W <= mono.length; start += hop) {
    if (tick && (dc++ & 0x1F) === 0) await tick();
    raw.push({ t: start / sampleRate, d: frameDigit(start) });
  }

  const digits = [];
  let cur = null, runStart = 0, runEnd = 0, gap = 0;
  // A dialled digit is held ~70-100 ms; a music transient rarely locks a tone pair
  // that long, so requiring ~60 ms of steady tone drops single-frame false hits.
  const MIN_FRAMES = Math.max(2, Math.round(0.06 / hopSec));
  let runLen = 0;
  const flush = () => { if (cur && runLen >= MIN_FRAMES) digits.push({ digit: cur, tStart: runStart, tEnd: runEnd }); };
  for (const f of raw) {
    if (f.d && f.d === cur) { runEnd = f.t; runLen++; gap = 0; }
    else if (f.d && f.d !== cur) { flush(); cur = f.d; runStart = f.t; runEnd = f.t; runLen = 1; gap = 0; }
    else { // silence/none - tolerate a tiny gap before ending the run
      if (cur && ++gap > 2) { flush(); cur = null; runLen = 0; }
    }
  }
  flush();

  return { digits, sequence: digits.map((d) => d.digit).join('') };
}
