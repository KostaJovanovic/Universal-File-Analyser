/* Analyser - image sonifier (spectrogram inversion)
 * ==================================================
 *
 * The inverse of spectrogram.js: instead of turning sound into a picture, this
 * turns a picture back into sound. A spectrogram is just a 2D magnitude map -
 * x = time, y = frequency, brightness = how much energy sits at that
 * time/frequency. So any image *is* a recipe for sound: read each column as one
 * instant's frequency content and resynthesise audio from it.
 *
 * The catch is phase. A real short-time Fourier transform stores a complex
 * number per cell (magnitude AND phase); an image only carries the magnitude.
 * To get a waveform back we have to invent plausible phase. Two engines do that
 * here, and the user picks:
 *
 *   - Oscillator bank  - one sine oscillator per frequency row, its amplitude
 *     driven by the pixel brightness over time, summed with a running phasor.
 *     Phase is continuous by construction, so there is no phase problem at all.
 *     Robust for arbitrary images; this is the MetaSynth/ARSS-style approach.
 *
 *   - Griffin-Lim      - start from the target magnitudes with random phase, run
 *     an inverse STFT, re-analyse the result, keep the freshly-estimated phase
 *     but force the magnitudes back to the target, and iterate. Converges to a
 *     waveform whose spectrogram matches the image. More faithful for genuine
 *     spectrograms, heavier, a touch watery on arbitrary art.
 *
 * Both reuse the radix-2 fft() exported by spectrogram.js (we add an ifft() on
 * top of it via the conjugate trick), and the rendered audio is fed straight into
 * the site's full Sound analysis (renderAudio) so you can see, scrub and analyse
 * what your image actually became.
 *
 * Everything stays on-device: File API in, Web Audio out, nothing uploaded.
 */

import { el, downloadBlob, asciiBar } from '../core/util.js';
import { fft, colormaps } from './spectrogram.js';
import { renderAudio } from './audio.js';

// Working-resolution caps. These do NOT drive synthesis speed - Griffin-Lim is
// O(iterations x frames x N log N) and the oscillator bank is O(activeBins x
// samples), both functions of duration / FFT size / iterations, not image size.
// The only thing source resolution costs is the one-time getImageData buffer, so
// the caps just stop a pathological 8000px input from allocating ~190 MB. They
// are deliberately set above what the STFT can represent so the downscale is
// lossless for synthesis:
//   - rows  -> the largest bin count we offer (fftSize 4096 -> 2048 bins), so
//     vertical/frequency detail is never the bottleneck whatever FFT is chosen.
//   - cols  -> ~47 s of time frames at the default hop, well past any clip you'd
//     resynthesise; columns are resampled to `frames` internally anyway.
const MAX_COLS = 4096;
const MAX_ROWS = 2048;

const DEFAULTS = {
  mode: 'image',        // 'image' (arbitrary) | 'spectro' (real magnitude plot)
  method: 'oscillator', // 'oscillator' | 'griffin'
  duration: 5,          // seconds
  minHz: 20,
  maxHz: 20000,
  scale: 'log',         // 'log' | 'linear'  (vertical = frequency)
  sampleRate: 44100,
  fftSize: 2048,
  window: 'hann',
  glIters: 32,
  gamma: 1.0,           // brightness -> amplitude shaping (arbitrary mode)
  invert: false,        // flip brightness: dark = loud, light = quiet (negative)
  leftSrc: 'luma',      // luma | r | g | b   (advanced channel mapping)
  rightSrc: 'none',     // none | luma | r | g | b   (none => mono)
  colormap: 'grayscale',// spectrogram-mode brightness decode
  dbInvert: true,       // spectrogram mode: treat brightness as dB, not linear
  dbFloor: -90,
  dbCeil: -10
};

// ---------- inverse FFT (built on spectrogram.js fft) ----------
// Inverse DFT via the conjugate trick: conj -> forward FFT -> conj -> /N. Lets
// us reuse the one audited radix-2 implementation instead of shipping a second.
function ifft(re, im) {
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fft(re, im);
  const inv = 1 / n;
  for (let i = 0; i < n; i++) { re[i] = re[i] * inv; im[i] = -im[i] * inv; }
}

// ---------- pixels ----------
// Draw the (already-decoded) source image into a working canvas, downscaling to
// the synthesis caps. `src` is an HTMLImageElement/canvas/ImageBitmap.
function sourceToImageData(src, maxW, maxH) {
  const sw = src.naturalWidth || src.width;
  const sh = src.naturalHeight || src.height;
  const scale = Math.min(1, maxW / sw, maxH / sh);
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, w, h);
  return { imageData: ctx.getImageData(0, 0, w, h), resized: scale < 1, srcW: sw, srcH: sh, w, h };
}

// Build a 256-step lookup that inverts a named colormap: given a pixel colour it
// finds the ramp position t in [0,1] whose colour is nearest. Used in
// spectrogram mode to undo viridis/magma back into a magnitude. Grayscale short-
// circuits to plain luminance.
function makeColormapInverter(name) {
  if (name === 'grayscale' || !colormaps[name]) {
    return (r, g, b) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  const cmap = colormaps[name];
  const steps = 256;
  const lut = new Float32Array(steps * 3);
  for (let i = 0; i < steps; i++) {
    const [cr, cg, cb] = cmap(i / (steps - 1));
    lut[i * 3] = cr; lut[i * 3 + 1] = cg; lut[i * 3 + 2] = cb;
  }
  return (r, g, b) => {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < steps; i++) {
      const dr = r - lut[i * 3], dg = g - lut[i * 3 + 1], db = b - lut[i * 3 + 2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best / (steps - 1);
  };
}

// Pull a single 0..1 intensity for one channel source at integer (x, y).
function channelValue(px, idx, src) {
  const r = px[idx], g = px[idx + 1], b = px[idx + 2];
  switch (src) {
    case 'r': return r / 255;
    case 'g': return g / 255;
    case 'b': return b / 255;
    default:  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
}

/**
 * Turn an image into a magnitude spectrogram grid for one ear.
 *
 *   returns Float32Array of length frames*bins, where row f bin b lives at
 *   [f*bins + b] and bin b corresponds to frequency b*sampleRate/N.
 *
 * Columns of the image map to time (left = start). Rows map to frequency with
 * the top row as the highest frequency, on a log or linear axis between
 * minHz/maxHz - the exact mirror of renderSpectrogram's y-mapping, so a
 * spectrogram Analyser produced round-trips cleanly. Bins outside the band are
 * silent.
 */
function imageToMagnitude(imageData, o, ear) {
  const { width: W, height: H, data: px } = imageData;
  const N = o.fftSize;
  const bins = N >> 1;
  const nyq = o.sampleRate / 2;
  const frames = o.frames;
  const mag = new Float32Array(frames * bins);

  const src = ear === 'right' ? o.rightSrc : o.leftSrc;
  const invertCmap = o.mode === 'spectro' ? makeColormapInverter(o.colormap) : null;

  // Precompute, for each bin, the source pixel row (fractional) it samples.
  const rowForBin = new Float32Array(bins);
  const active = new Uint8Array(bins);
  const logMin = Math.log10(Math.max(1, o.minHz));
  const logMax = Math.log10(Math.max(o.minHz + 0.001, o.maxHz));
  for (let b = 0; b < bins; b++) {
    const hz = b * o.sampleRate / N;
    if (hz < o.minHz || hz > o.maxHz) { active[b] = 0; continue; }
    let frac; // 0 at minHz (bottom), 1 at maxHz (top)
    if (o.scale === 'log') frac = (Math.log10(Math.max(1, hz)) - logMin) / (logMax - logMin);
    else frac = (hz - o.minHz) / (o.maxHz - o.minHz);
    rowForBin[b] = (1 - frac) * (H - 1); // top row = high freq
    active[b] = 1;
  }

  const toMag = (t) => {
    let v = t < 0 ? 0 : t > 1 ? 1 : t;
    if (o.invert) v = 1 - v;   // negative: dark becomes loud, light becomes quiet
    if (o.mode === 'spectro' && o.dbInvert) {
      const db = o.dbFloor + v * (o.dbCeil - o.dbFloor);
      return Math.pow(10, db / 20);
    }
    if (o.gamma !== 1) v = Math.pow(v, o.gamma);
    return v;
  };

  for (let f = 0; f < frames; f++) {
    const fx = frames > 1 ? (f / (frames - 1)) * (W - 1) : 0;
    const x0 = Math.floor(fx), x1 = Math.min(W - 1, x0 + 1), kx = fx - x0;
    for (let b = 0; b < bins; b++) {
      if (!active[b]) continue;
      const fy = rowForBin[b];
      const y0 = Math.floor(fy), y1 = Math.min(H - 1, y0 + 1), ky = fy - y0;
      // bilinear sample of the chosen intensity
      let t;
      if (invertCmap) {
        const i00 = (y0 * W + x0) * 4;
        t = invertCmap(px[i00], px[i00 + 1], px[i00 + 2]); // nearest pixel (colour match is non-linear)
      } else {
        const i00 = (y0 * W + x0) * 4, i10 = (y0 * W + x1) * 4;
        const i01 = (y1 * W + x0) * 4, i11 = (y1 * W + x1) * 4;
        const top = channelValue(px, i00, src) * (1 - kx) + channelValue(px, i10, src) * kx;
        const bot = channelValue(px, i01, src) * (1 - kx) + channelValue(px, i11, src) * kx;
        t = top * (1 - ky) + bot * ky;
      }
      mag[f * bins + b] = toMag(t);
    }
  }
  return mag;
}

// ---------- synthesis: oscillator bank ----------
// One sinusoid per active frequency bin, amplitude linearly interpolated across
// frames, advanced by an incremental complex phasor so there is no Math.sin in
// the inner loop. The phasor is renormalised periodically to fight rounding
// drift over hundreds of thousands of samples.
async function synthOscillator(mag, o, onProgress) {
  const N = o.fftSize, bins = N >> 1;
  const frames = o.frames;
  const total = Math.round(o.duration * o.sampleRate);
  const out = new Float32Array(total);

  // The bin loop blocks the main thread, so we surrender it to the event loop
  // (a macrotask, which lets the browser actually repaint) whenever ~60ms has
  // elapsed. Yielding by wall-clock rather than by bin count keeps the overhead
  // negligible on short clips while still animating the bar on long ones.
  let lastYield = performance.now();
  for (let b = 0; b < bins; b++) {
    const fr = b * o.sampleRate / N;
    if (fr <= 0 || fr >= o.sampleRate / 2) continue;
    let any = false;
    for (let f = 0; f < frames; f++) { if (mag[f * bins + b] > 1e-4) { any = true; break; } }
    if (!any) continue;

    const w = 2 * Math.PI * fr / o.sampleRate;
    const cosD = Math.cos(w), sinD = Math.sin(w);
    const ph0 = Math.random() * 2 * Math.PI;
    let cr = Math.cos(ph0), ci = Math.sin(ph0);

    for (let n = 0; n < total; n++) {
      const ff = total > 1 ? (n / (total - 1)) * (frames - 1) : 0;
      let f0 = Math.floor(ff); const k = ff - f0;
      if (f0 >= frames - 1) f0 = frames - 1;
      const a0 = mag[f0 * bins + b];
      const a1 = mag[Math.min(frames - 1, f0 + 1) * bins + b];
      out[n] += (a0 + (a1 - a0) * k) * cr;
      const nr = cr * cosD - ci * sinD;
      ci = cr * sinD + ci * cosD; cr = nr;
      if ((n & 4095) === 0) { const inv = 1 / Math.hypot(cr, ci); cr *= inv; ci *= inv; }
    }
    if (performance.now() - lastYield > 60) {
      if (onProgress) onProgress((b + 1) / bins);
      await new Promise(r => setTimeout(r));
      lastYield = performance.now();
    }
  }
  if (onProgress) onProgress(1);
  return out;
}

// ---------- synthesis: Griffin-Lim ----------
function hannWindow(N) {
  const w = new Float32Array(N);
  for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  return w;
}

// Inverse STFT: rebuild each frame's complex spectrum from target magnitude +
// the current phase estimate, ifft, window, and overlap-add with window-power
// normalisation. Hermitian symmetry is enforced so the output is real.
function istft(mag, phase, o, win) {
  const N = o.fftSize, bins = N >> 1, half = N >> 1, hop = o.hop, frames = o.frames;
  const total = (frames - 1) * hop + N;
  const out = new Float32Array(total);
  const wsum = new Float32Array(total);
  const re = new Float32Array(N), im = new Float32Array(N);
  const pStride = half + 1;
  for (let f = 0; f < frames; f++) {
    re.fill(0); im.fill(0);
    for (let b = 0; b <= half; b++) {
      const m = b < bins ? mag[f * bins + b] : 0;
      const ph = phase[f * pStride + b];
      const r = m * Math.cos(ph), i = m * Math.sin(ph);
      re[b] = r; im[b] = i;
      if (b > 0 && b < half) { re[N - b] = r; im[N - b] = -i; }
    }
    ifft(re, im);
    const start = f * hop;
    for (let n = 0; n < N; n++) {
      out[start + n] += re[n] * win[n];
      wsum[start + n] += win[n] * win[n];
    }
  }
  for (let n = 0; n < total; n++) if (wsum[n] > 1e-8) out[n] /= wsum[n];
  return out;
}

// Forward STFT keeping only the phase of each bin (magnitude is forced back to
// the target between iterations, so we never need to store it).
function stftPhase(samples, o, win) {
  const N = o.fftSize, half = N >> 1, hop = o.hop, frames = o.frames;
  const pStride = half + 1;
  const phase = new Float32Array(frames * pStride);
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    for (let n = 0; n < N; n++) { const s = start + n < samples.length ? samples[start + n] : 0; re[n] = s * win[n]; im[n] = 0; }
    fft(re, im);
    for (let b = 0; b <= half; b++) phase[f * pStride + b] = Math.atan2(im[b], re[b]);
  }
  return phase;
}

async function synthGriffin(mag, o, onProgress) {
  const N = o.fftSize, half = N >> 1, frames = o.frames;
  const win = hannWindow(N);
  const pStride = half + 1;
  const phase = new Float32Array(frames * pStride);
  for (let i = 0; i < phase.length; i++) phase[i] = Math.random() * 2 * Math.PI; // seed
  let samples = istft(mag, phase, o, win);
  for (let it = 0; it < o.glIters; it++) {
    const ph = stftPhase(samples, o, win);
    samples = istft(mag, ph, o, win);
    if (onProgress) onProgress((it + 1) / o.glIters);
    // One STFT+ISTFT per iteration blocks the thread; yield between iterations
    // (a macrotask) so the progress bar repaints instead of jumping at the end.
    await new Promise(r => setTimeout(r));
  }
  return samples;
}

// ---------- normalisation + WAV ----------
function peakNormalise(channels, target = 0.9) {
  let peak = 1e-9;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > peak) peak = a; }
  const g = target / peak;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] *= g;
}

function encodeWav(channels, sampleRate) {
  const numCh = channels.length;
  const len = channels[0].length;
  const buffer = new ArrayBuffer(44 + len * numCh * 2);
  const view = new DataView(buffer);
  const wr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); view.setUint32(4, 36 + len * numCh * 2, true); wr(8, 'WAVE');
  wr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numCh * 2, true); view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true); wr(36, 'data'); view.setUint32(40, len * numCh * 2, true);
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      let s = channels[c][i]; s = s < -1 ? -1 : s > 1 ? 1 : s;
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true); off += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

// ---------- UI helpers (mirroring the spectrogram control markup) ----------
// A single labelled control: mono-uppercase <label> + the control, styled by the
// site's .anr-control rules. Pass an empty label for a bare control (e.g. a button).
const ctl = (label, control) => el('div', { class: 'anr-control' }, label ? [el('label', {}, label), control] : [control]);
// A captioned, hairline-divided cluster of controls (View / Resolution-style).
const group = (title, items) => el('div', { class: 'anr-control-group' }, [
  el('div', { class: 'anr-control-group-label' }, title),
  el('div', { class: 'anr-control-group-items' }, items)
]);
function mkSelect(options, value) {
  const s = el('select');
  for (const [v, t] of options) { const o = el('option', { value: v }, t); if (v === value) o.selected = true; s.appendChild(o); }
  return s;
}
// Labelled range with the site's live readout span. The wrapper carries `_input`
// (the slider) and `_value` (the authoritative number). When `editable` is set,
// clicking the readout swaps it for a number box so an exact value can be typed -
// and that value may exceed the slider's max (the slider just pins at its end),
// which is how the duration field accepts durations past the 180s track.
function rangeCtl(label, min, max, step, value, fmt, editable) {
  const input = el('input', { type: 'range', min, max, step, value });
  const out = el('span', { class: 'anr-range-readout' + (editable ? ' is-editable' : ''), title: editable ? 'Click to type an exact value' : '' }, fmt(value));
  if (editable) out.style.cssText = 'cursor:text;text-decoration:underline dotted;text-underline-offset:2px;';
  const c = el('div', { class: 'anr-control' }, [el('label', {}, label), input, out]);
  c._input = input;
  c._value = +value;
  input.addEventListener('input', () => { c._value = +input.value; out.textContent = fmt(c._value); });
  if (editable) {
    out.addEventListener('click', () => {
      const box = el('input', { type: 'number', min: 0, step, value: String(c._value), style: 'width:5.5em;' });
      out.replaceWith(box);
      box.focus(); box.select();
      let done = false;
      const commit = () => {
        if (done) return; done = true;
        const v = parseFloat(box.value);
        if (isFinite(v) && v > 0) {
          c._value = v;
          input.value = String(Math.min(max, Math.max(min, v))); // slider pins; _value can exceed max
          out.textContent = fmt(c._value);
        }
        box.replaceWith(out);
      };
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { done = true; box.replaceWith(out); }
      });
      box.addEventListener('blur', commit);
    });
  }
  return c;
}
// Two-button segmented toggle (.anr-toggle, as the spectrogram LOG/LINEAR axis).
// Selected value lives on `_value`.
function makeToggle(options, value) {
  const wrap = el('div', { class: 'anr-toggle' });
  wrap._value = value;
  for (const [v, t] of options) {
    const b = el('button', { type: 'button', class: v === value ? 'is-active' : '' }, t);
    b.addEventListener('click', () => { wrap._value = v; for (const x of wrap.children) x.classList.toggle('is-active', x === b); });
    wrap.appendChild(b);
  }
  return wrap;
}

/**
 * Mount the sonifier UI into `mountEl` for an already-decoded image.
 *
 *   opts.source - HTMLImageElement / canvas / ImageBitmap to read pixels from.
 *                 When omitted, the File is decoded with createImageBitmap.
 */
export async function renderSonify(file, mountEl, opts = {}) {
  mountEl.innerHTML = '';
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Image to sound'));
  card.appendChild(el('p', { class: 'anr-hint' },
    'Reads this picture as a spectrogram and resynthesises sound from it - x is time, y is frequency, brightness is loudness. Runs entirely on your device.'));
  mountEl.appendChild(card);

  // Resolve a pixel source (reuse the photo's already-decoded image when given).
  let source = opts.source;
  if (!source) {
    try { source = await createImageBitmap(file); }
    catch (e) { card.appendChild(el('p', { class: 'anr-hint' }, 'Could not decode this image for sonification.')); return; }
  }
  const { imageData, resized, srcW, srcH, w: workW, h: workH } = sourceToImageData(source, MAX_COLS, MAX_ROWS);
  if (resized) card.appendChild(el('p', { class: 'anr-hint' }, `Resized for synthesis: ${srcW} x ${srcH} to ${workW} x ${workH}.`));

  // ---- working-image canvas with scrub playhead ----
  const viewCv = el('canvas', { width: workW, height: workH, style: 'display:block;width:100%;image-rendering:pixelated;cursor:pointer;' });
  viewCv.getContext('2d').putImageData(imageData, 0, 0);
  const cursor = el('div', { style: 'position:absolute;top:0;bottom:0;width:2px;background:var(--accent);pointer-events:none;left:0;display:none;' });
  const viewWrap = el('div', { style: 'position:relative;max-width:640px;margin:0 0 16px;background:var(--media-bg);border:var(--bd-hairline);' }, [viewCv, cursor]);
  card.appendChild(viewWrap);

  // ---- controls ----
  const modeSel   = mkSelect([['image', 'Arbitrary image'], ['spectro', 'Real spectrogram']], DEFAULTS.mode);
  const methodSel = mkSelect([['oscillator', 'Oscillator bank'], ['griffin', 'Griffin-Lim']], DEFAULTS.method);
  const scaleTog  = makeToggle([['log', 'LOG'], ['linear', 'LINEAR']], DEFAULTS.scale);
  const minSld = rangeCtl('Min', 0, 2000, 10, DEFAULTS.minHz, v => v + ' Hz');
  const maxSld = rangeCtl('Max', 2000, 22050, 50, DEFAULTS.maxHz, v => (v / 1000).toFixed(1) + ' kHz');
  const durSld = rangeCtl('Length', 1, 180, 0.5, DEFAULTS.duration, v => v + ' s', true);

  const srSel    = mkSelect([['44100', '44100 Hz'], ['22050', '22050 Hz'], ['48000', '48000 Hz']], String(DEFAULTS.sampleRate));
  const fftSel   = mkSelect([['1024', '1024'], ['2048', '2048'], ['4096', '4096']], String(DEFAULTS.fftSize));
  const winSel   = mkSelect([['hann', 'Hann'], ['hamming', 'Hamming'], ['blackman', 'Blackman'], ['rect', 'Rect']], DEFAULTS.window);
  const glSld    = rangeCtl('GL iters', 4, 100, 1, DEFAULTS.glIters, v => String(v));
  const gammaSld = rangeCtl('Gamma', 0.3, 3, 0.1, DEFAULTS.gamma, v => v.toFixed(1));
  const leftSel  = mkSelect([['luma', 'Luminance'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']], DEFAULTS.leftSrc);
  const rightSel = mkSelect([['none', 'None (mono)'], ['luma', 'Luminance'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']], DEFAULTS.rightSrc);
  const cmapSel  = mkSelect([['grayscale', 'Grey'], ['viridis', 'Viridis'], ['magma', 'Magma'], ['inferno', 'Inferno']], DEFAULTS.colormap);
  const dbChk    = el('input', { type: 'checkbox' }); dbChk.checked = DEFAULTS.dbInvert;
  const invChk   = el('input', { type: 'checkbox' }); invChk.checked = DEFAULTS.invert;

  const advanced = el('details', { class: 'anr-spec-advanced' }, [
    el('summary', {}, 'Advanced'),
    el('div', { class: 'anr-control-group-items' }, [
      ctl('Rate', srSel), ctl('FFT', fftSel), ctl('Window', winSel),
      glSld, gammaSld, ctl('Left', leftSel), ctl('Right', rightSel),
      ctl('Colours', cmapSel), ctl('dB scale', dbChk)
    ])
  ]);

  // The stock .anr-controls drops its bottom border to butt against a canvas;
  // here it stands alone above the action row, so close the box.
  const controls = el('div', { class: 'anr-controls', style: 'border-bottom:var(--bd-hairline);' }, [
    group('Synthesis', [ctl('Mode', modeSel), ctl('Method', methodSel), ctl('Invert', invChk)]),
    group('Frequency', [ctl('Axis', scaleTog), minSld, maxSld]),
    group('Time', [durSld]),
    advanced
  ]);
  card.appendChild(controls);

  // ---- actions ----
  const renderBtn = el('button', { type: 'button', class: 'anr-btn anr-btn--cta' }, 'Render & play');
  const wavBtn    = el('button', { type: 'button', class: 'anr-btn' }, 'Download WAV');
  const status    = el('span', { class: 'anr-spec-hint', style: 'align-self:center;' }, '');
  card.appendChild(el('div', { class: 'anr-btn-row' }, [renderBtn, wavBtn, status]));

  // ---- render progress (the site's standard ASCII bar) ----
  const progBar   = asciiBar({ fit: true });
  const progLabel = el('div', { class: 'anr-progress-label' }, '');
  const progWrap  = el('div', { class: 'anr-progress', style: 'display:none;' }, [progBar, progLabel]);
  card.appendChild(progWrap);

  // ---- output: the site's full Sound analysis of the rendered audio ----
  // (Filled after a render via renderAudio - player, info/LUFS/pitch/BPM, reverse,
  // interactive spectrogram, histogram, waveform, stereo scope, download.)
  const specSlot = el('div', { style: 'display:none;margin-top:16px;' });
  card.appendChild(specSlot);

  // ---- state ----
  let lastChannels = null;   // rendered Float32 channels
  let lastRate = DEFAULTS.sampleRate;
  let audioEl = null;        // the <audio> renderAudio built (drives the image playhead)
  let cursorRaf = 0;         // RAF driving the image playhead while playing

  function readOpts() {
    const sampleRate = +srSel.value;
    const fftSize = +fftSel.value;
    const duration = durSld._value;
    const hop = fftSize >> 2;
    const total = Math.round(duration * sampleRate);
    const frames = Math.max(2, 1 + Math.floor((total - fftSize) / hop));
    return {
      mode: modeSel.value, method: methodSel.value, duration, sampleRate, fftSize, hop, frames,
      minHz: +minSld._input.value, maxHz: +maxSld._input.value, scale: scaleTog._value,
      window: winSel.value, glIters: +glSld._input.value, gamma: +gammaSld._input.value,
      invert: invChk.checked,
      leftSrc: leftSel.value, rightSrc: rightSel.value, colormap: cmapSel.value,
      dbInvert: dbChk.checked, dbFloor: DEFAULTS.dbFloor, dbCeil: DEFAULTS.dbCeil
    };
  }

  // Position the accent playhead over the image from the audio's clock.
  function drawCursor() {
    const d = audioEl && isFinite(audioEl.duration) ? audioEl.duration : 0;
    if (!audioEl || d <= 0) { cursor.style.display = 'none'; return; }
    cursor.style.display = 'block';
    cursor.style.left = (audioEl.currentTime / d) * viewWrap.clientWidth + 'px';
  }
  function stopCursor() { if (cursorRaf) { cancelAnimationFrame(cursorRaf); cursorRaf = 0; } }
  function cursorLoop() {
    drawCursor();
    // 'timeupdate' only fires ~4 Hz (choppy for a playhead), so drive it with RAF
    // while playing and fall back to the audio events for paused seeks.
    cursorRaf = (audioEl && !audioEl.paused) ? requestAnimationFrame(cursorLoop) : 0;
  }

  // Tear down any existing analysis before building a new one or on abort.
  function teardownAudio() {
    stopCursor();
    if (audioEl) { try { audioEl.pause(); } catch (_) {} audioEl = null; }
    specSlot.innerHTML = '';
    specSlot.style.display = 'none';
    cursor.style.display = 'none';
  }

  // Encode the rendered channels to a WAV File and hand it to renderAudio - the
  // site's full Sound analysis (player + info/LUFS/pitch/BPM, reverse, interactive
  // spectrogram, histogram, waveform, stereo scope, download). We then hook the
  // source-image playhead to the <audio> renderAudio built, so scrubbing the sound
  // moves the playhead over the picture too.
  async function buildOutput() {
    teardownAudio();
    const blob = encodeWav(lastChannels, lastRate);
    const base = (file.name.replace(/\.[^.]+$/, '') || 'sonified') + '-sonified';
    const wavFile = new File([blob], base + '.wav', { type: 'audio/wav' });
    specSlot.style.display = 'block';
    specSlot.appendChild(el('p', { class: 'anr-spec-hint', style: 'margin:0 0 10px;' },
      'Full sound analysis of the rendered audio - play it to scrub the picture in step.'));
    const analysisSlot = el('div');
    specSlot.appendChild(analysisSlot);
    await renderAudio(wavFile, analysisSlot, { spectrogramFirst: true });
    // renderAudio builds its own hidden <audio>; borrow it to drive the image playhead.
    audioEl = analysisSlot.querySelector('audio');
    if (audioEl) {
      audioEl.addEventListener('play', () => { stopCursor(); cursorLoop(); });
      audioEl.addEventListener('pause', () => { stopCursor(); drawCursor(); });
      audioEl.addEventListener('seeked', drawCursor);
      audioEl.addEventListener('ended', () => { stopCursor(); drawCursor(); });
    }
  }

  // Click the image to seek there (and start playing if paused).
  viewCv.addEventListener('click', (e) => {
    if (!audioEl || !isFinite(audioEl.duration) || audioEl.duration <= 0) return;
    const rect = viewCv.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioEl.currentTime = frac * audioEl.duration;
    drawCursor();
    if (audioEl.paused) audioEl.play();
  });

  async function doRender(play) {
    const o = readOpts();
    renderBtn.disabled = true; wavBtn.disabled = true;
    status.textContent = 'Rendering...';
    progBar.set(0);
    progWrap.style.display = 'block';
    await new Promise(r => setTimeout(r, 16)); // let the status + bar paint

    const stereo = o.rightSrc !== 'none' && o.mode === 'image';
    const ears = stereo ? ['left', 'right'] : ['left'];
    const methodName = o.method === 'griffin' ? 'Griffin-Lim' : 'Oscillator bank';
    const channels = [];
    try {
      for (let e = 0; e < ears.length; e++) {
        const earTag = ears.length > 1 ? ` (${ears[e]})` : '';
        // Each ear is one slice of the overall bar; map its 0..1 onto its slot.
        const report = (p) => {
          progBar.set((e + p) / ears.length);
          progLabel.textContent = `${methodName} ${Math.round(p * 100)}%${earTag}`;
        };
        const mag = imageToMagnitude(imageData, o, ears[e]);
        let samples;
        if (o.method === 'griffin') {
          samples = await synthGriffin(mag, o, report);
        } else {
          samples = await synthOscillator(mag, o, report);
        }
        channels.push(samples);
      }
      // Pad both ears to equal length for stereo.
      if (channels.length === 2) {
        const len = Math.max(channels[0].length, channels[1].length);
        for (let c = 0; c < 2; c++) if (channels[c].length < len) { const padded = new Float32Array(len); padded.set(channels[c]); channels[c] = padded; }
      }
      peakNormalise(channels);
      lastChannels = channels;
      lastRate = o.sampleRate;

      progBar.set(1);
      progLabel.textContent = 'Analysing sound...';
      // Run the site's full Sound analysis on the rendered audio.
      await buildOutput();
      status.textContent = `Done - ${o.duration}s, ${o.sampleRate} Hz, ${stereo ? 'stereo' : 'mono'}`;
      if (play && audioEl) audioEl.play().catch(() => {});
    } catch (err) {
      status.textContent = 'Render failed: ' + (err && err.message ? err.message : err);
    } finally {
      renderBtn.disabled = false; wavBtn.disabled = false;
      progBar.stop();
      progWrap.style.display = 'none';
    }
  }

  renderBtn.addEventListener('click', () => doRender(true));
  wavBtn.addEventListener('click', async () => {
    if (!lastChannels) await doRender(false);
    if (!lastChannels) return;
    const base = file.name.replace(/\.[^.]+$/, '') || 'sonified';
    downloadBlob(base + '-sonified.wav', encodeWav(lastChannels, lastRate));
  });

  // Tidy up audio when the host view is replaced.
  if (opts.signal) opts.signal.addEventListener('abort', teardownAudio, { once: true });
}
