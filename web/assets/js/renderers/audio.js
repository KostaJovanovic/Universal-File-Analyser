/* Analyser - audio module
   Handles uploaded files, mic recording, and live spectrogram.
   Renders waveform, file info, and an interactive spectrogram. */

import {
  computeSpectrogram, computeReassignedSpectrogram, renderSpectrogram, colormaps,
  computeStftComplex, combineStftToDb,
  frequencyTicks, timeTicks, formatHz, formatTime
} from './spectrogram.js';
import { el, row, rowHelp, fmtBytes, h3help, wireInfoToggle, errorCard, integrityCard, downloadBlob, inlineLoader, asciiBar } from '../core/util.js';
import {
  computeStats, computeCentroid, computeLufs,
  detectPitch, detectBPM, computeStereoStats
} from './audio-analysis.js';
import { peekContainer, adtsToM4a, readTagBPM, extractCoverArt, readAudioTags } from './audio-codec.js';
import {
  longAverageSpectrum, analyzeTranscode, analyzeUltrasonic, analyzeMainsHum,
  detectKey, loudnessR128, truePeakDb, signalHealth, detectDtmf
} from './audio-forensics.js';
import { makePlayer, playerAudioNode, onSharedVolume, sharedVolume } from './audio-player.js';
import { encodeWav } from './video-avi.js';
import { buildReverseAudioCard } from './media-reverse.js';
// Constants only (no WASM/worker) - safe to load eagerly; the picker and the
// download prompt read tier sizes from here. The heavy client is still lazy.
import { MDX_MODELS } from '../lib/mdx-model.js';
import { DFN_MODEL } from '../lib/dfn-model.js';

// Re-exported so existing importers (e.g. video.js) can keep importing the
// transport from this module.
export { makePlayer };

let audioCtx = null;
function ctx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

// --- Decode helpers ---
async function decodeFile(file) {
  const buf = await file.arrayBuffer();
  // decodeAudioData mutates buffer in some browsers, so pass a copy
  const copy = buf.slice(0);
  return await ctx().decodeAudioData(copy);
}

function getMono(audioBuffer) {
  const n = audioBuffer.length;
  const out = new Float32Array(n);
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += data[i];
  }
  const k = 1 / audioBuffer.numberOfChannels;
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}

// Human-readable speaker layout for a given channel count.
function describeChannels(n) {
  const map = {
    1: '  (Mono)', 2: '  (Stereo)', 3: '  (2.1)', 4: '  (Quad / 4.0)',
    6: '  (5.1 surround)', 7: '  (6.1 surround)', 8: '  (7.1 surround)',
    10: '  (7.1.2 Atmos)', 12: '  (7.1.4 Atmos)', 16: '  (9.1.6 Atmos)'
  };
  return map[n] || (n > 2 ? '  (' + n + '-channel surround)' : '');
}

// Per-channel speaker names for the standard layouts, matching the channel order
// the Web Audio decoder exposes for that count. Returns { short, full } per index;
// unknown layouts fall back to plain "Ch N". Order follows the file's declared
// layout, so it's a best-effort label rather than a guarantee.
function channelLabels(n) {
  const layouts = {
    1: [['M', 'Mono']],
    2: [['L', 'Left'], ['R', 'Right']],
    3: [['L', 'Left'], ['R', 'Right'], ['LFE', 'LFE (sub-bass)']],
    4: [['L', 'Left'], ['R', 'Right'], ['SL', 'Surround left'], ['SR', 'Surround right']],
    6: [['L', 'Left'], ['R', 'Right'], ['C', 'Centre'], ['LFE', 'LFE (sub-bass)'], ['SL', 'Surround left'], ['SR', 'Surround right']],
    8: [['L', 'Left'], ['R', 'Right'], ['C', 'Centre'], ['LFE', 'LFE (sub-bass)'], ['SL', 'Surround left'], ['SR', 'Surround right'], ['RL', 'Rear left'], ['RR', 'Rear right']]
  };
  const known = layouts[n];
  if (known) return known.map(([short, full]) => ({ short, full }));
  const out = [];
  for (let i = 0; i < n; i++) out.push({ short: 'Ch ' + (i + 1), full: 'Channel ' + (i + 1) });
  return out;
}

// Build the switchable-signal list for a decoded buffer: a "Mix" downmix first (the
// default), then one entry per discrete channel. Each is { short, full, data }.
function channelOptions(audioBuffer, mono) {
  const n = audioBuffer.numberOfChannels;
  if (n < 2) return [{ short: 'Mix', full: 'Mono', data: mono }];
  const labels = channelLabels(n);
  const opts = [{ short: 'Mix', full: 'Mix (all channels averaged)', data: mono }];
  for (let c = 0; c < n; c++) {
    opts.push({ short: labels[c].short, full: labels[c].full, data: audioBuffer.getChannelData(c) });
  }
  return opts;
}

// Make a playhead line grabbable, so you can drag it to scrub. `seekFromClientX`
// maps a pointer x to a seek (and repositions the line). Works for mouse + touch.
// Window listeners are attached only for the duration of a drag and removed on
// release, so they don't accumulate as new files are analysed.
function attachScrub(lineEl, seekFromClientX) {
  lineEl.classList.add('is-grabbable');

  function onMouseMove(e) { seekFromClientX(e.clientX); }
  function onMouseUp() {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }
  lineEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    seekFromClientX(e.clientX);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });

  function onTouchMove(e) {
    if (e.touches[0]) { e.preventDefault(); seekFromClientX(e.touches[0].clientX); }
  }
  function onTouchEnd() {
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('touchend', onTouchEnd);
  }
  lineEl.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (e.touches[0]) seekFromClientX(e.touches[0].clientX);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
  }, { passive: false });
}

function renderVectorscope(canvas, left, right) {
  const size = canvas.width;
  const ctxC = canvas.getContext('2d');
  ctxC.fillStyle = '#1a1a1a';
  ctxC.fillRect(0, 0, size, size);

  // Draw guides: centre cross + diagonal axes
  const cx = size / 2, cy = size / 2;
  ctxC.strokeStyle = '#333';
  ctxC.lineWidth = 1;
  // Horizontal and vertical (mono = vertical, hard-pan = horizontal after rotation)
  ctxC.beginPath();
  ctxC.moveTo(cx, 0); ctxC.lineTo(cx, size);
  ctxC.moveTo(0, cy); ctxC.lineTo(size, cy);
  ctxC.stroke();

  // Labels
  ctxC.fillStyle = '#666';
  ctxC.font = '10px monospace';
  ctxC.textAlign = 'center';
  ctxC.fillText('M', cx, 10);
  ctxC.fillText('S', size - 8, cy + 4);
  ctxC.fillText('L', cx - 6, 10);
  ctxC.textAlign = 'left';
  ctxC.fillText('R', cx + 3, 10);

  const n = Math.min(left.length, right.length);
  if (n === 0) return;

  // Downsample to max ~40k dots for performance
  const maxDots = 40000;
  const step = Math.max(1, Math.floor(n / maxDots));
  const scale = size * 0.42; // leave a small margin

  // Use ImageData for efficient semi-transparent dot rendering
  const imgData = ctxC.getImageData(0, 0, size, size);
  const data = imgData.data;

  for (let i = 0; i < n; i += step) {
    const l = left[i], r = right[i];
    // 45-degree rotation: mid on Y (vertical), side on X (horizontal)
    const mid  = (l + r) * 0.5;
    const side = (l - r) * 0.5;
    const px = Math.round(cx + side * scale);
    const py = Math.round(cy - mid * scale);
    if (px < 0 || px >= size || py < 0 || py >= size) continue;
    const idx = (py * size + px) * 4;
    // Additive blending for density visualisation
    data[idx]     = Math.min(255, data[idx]     + 12);  // R
    data[idx + 1] = Math.min(255, data[idx + 1] + 28);  // G
    data[idx + 2] = Math.min(255, data[idx + 2] + 18);  // B
    data[idx + 3] = 255;
  }

  ctxC.putImageData(imgData, 0, 0);
  ctxC.strokeStyle = '#C8DCE8';
  ctxC.strokeRect(0, 0, size, size);
}

// --- Waveform render (downsampled min/max per pixel) ---
function renderWaveform(canvas, samples) {
  const ctxC = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctxC.fillStyle = '#1a1a1a';
  ctxC.fillRect(0, 0, w, h);
  ctxC.strokeStyle = '#445f74';
  ctxC.lineWidth = 1;
  ctxC.beginPath();
  ctxC.moveTo(0, h / 2);
  ctxC.lineTo(w, h / 2);
  ctxC.stroke();

  if (!samples.length) return;
  const samplesPerPx = samples.length / w;
  const clipRegions = [];
  for (let x = 0; x < w; x++) {
    const start = Math.floor(x * samplesPerPx);
    const end   = Math.floor((x + 1) * samplesPerPx);
    let mn = 1, mx = -1, clip = false;
    for (let i = start; i < end && i < samples.length; i++) {
      const v = samples[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      if (Math.abs(v) >= 0.999) clip = true;
    }
    const y1 = ((1 - mx) / 2) * h;
    const y2 = ((1 - mn) / 2) * h;
    const bh = Math.max(1, y2 - y1);
    if (clip) {
      clipRegions.push({ x, y: y1, h: bh });
      ctxC.fillStyle = '#444';
      ctxC.fillRect(x, y1, 1, bh);
    } else {
      ctxC.fillStyle = '#80a4ba';
      ctxC.fillRect(x, y1, 1, bh);
    }
  }
  if (clipRegions.length) {
    ctxC.save();
    ctxC.beginPath();
    for (const r of clipRegions) ctxC.rect(r.x, r.y, 1, r.h);
    ctxC.clip();
    const stripe = 6;
    ctxC.lineWidth = 2;
    for (let d = -h; d < w + h; d += stripe * 2) {
      ctxC.strokeStyle = '#fff';
      ctxC.beginPath(); ctxC.moveTo(d, 0); ctxC.lineTo(d + h, h); ctxC.stroke();
      ctxC.strokeStyle = '#222';
      ctxC.beginPath(); ctxC.moveTo(d + stripe, 0); ctxC.lineTo(d + stripe + h, h); ctxC.stroke();
    }
    ctxC.restore();
  }
  ctxC.strokeStyle = '#C8DCE8';
  ctxC.strokeRect(0, 0, w, h);
}

function buildFreqAxis(axisEl, sampleRate, scale) {
  axisEl.innerHTML = '';
  const minHz = scale === 'log' ? 10 : 0;
  const maxHz = sampleRate / 2;
  const ticks = frequencyTicks(minHz, maxHz, scale);

  for (const hz of ticks) {
    let frac;
    if (scale === 'log') {
      const lo = Math.log10(minHz);
      const hi = Math.log10(maxHz);
      frac = (Math.log10(hz) - lo) / (hi - lo);
    } else {
      frac = (hz - minHz) / (maxHz - minHz);
    }
    const span = el('span', {}, formatHz(hz));
    const topPct = (1 - frac) * 100;
    span.style.top = topPct + '%';
    // The axis clips overflow, so the edge labels (0 Hz at the bottom, the Nyquist
    // at the top) would be half cut by the default translateY(-50%) centering.
    // Pin them just inside instead.
    if (topPct > 98) span.style.transform = 'translateY(-100%)';
    else if (topPct < 2) span.style.transform = 'translateY(0)';
    axisEl.appendChild(span);
  }
}

function buildTimeAxis(axisEl, durationSec) {
  axisEl.innerHTML = '';
  const ticks = timeTicks(durationSec);
  for (const t of ticks) {
    const span = el('span', {}, formatTime(t));
    span.style.left = ((t / durationSec) * 100) + '%';
    axisEl.appendChild(span);
  }
}

// Find the loudest moment in the waveform: scan ~50 ms blocks, return the
// loudest block's centre time (s, using the nominal block length, so the final
// short block's reported centre is approximate) and its RMS level (dBFS). This is
// the "when is it loudest, and how loud" figure shown as the Peak stat - independent of FFT
// settings, so it's computed once per clip. Block RMS (not a single sample peak)
// so a lone click doesn't outrank a sustained loud passage.
function loudestMoment(samples, sampleRate) {
  if (!samples || !samples.length || !sampleRate) return null;
  const block = Math.max(1, Math.round(sampleRate * 0.05));
  let bestMeanSq = -1, bestStart = 0;
  for (let s = 0; s < samples.length; s += block) {
    const end = Math.min(samples.length, s + block);
    let sum = 0;
    for (let i = s; i < end; i++) sum += samples[i] * samples[i];
    const meanSq = sum / (end - s);
    if (meanSq > bestMeanSq) { bestMeanSq = meanSq; bestStart = s; }
  }
  const rms = Math.sqrt(Math.max(0, bestMeanSq));
  return {
    time: (bestStart + block / 2) / sampleRate,
    db: rms > 0 ? 20 * Math.log10(rms) : -Infinity,
  };
}

// Scan a computed spectrogram for at-a-glance stats.
// All levels are signal-relative so the numbers stay meaningful:
//   Peak     - the single loudest bin overall.
//   Detected - the occupied band: bins (excluding DC) within SIGNAL_DB of the peak,
//              i.e. where real content lives, not the numerical-noise floor.
//   DynRange - peak above the noise floor, where the floor is the 10th-percentile
//              of bins that carry any energy (> -120 dB). Using dbMax-dbMin instead
//              would just report the -240 dB epsilon floor of empty bins (~190 dB).
// O(frames*bins), same order as the render pass.
const SIGNAL_DB = 60;
function specStats(spec) {
  const { frames, bins, sampleRate, data } = spec;
  if (!frames || !bins) return { peakHz: null, lowHz: null, highHz: null, dynRange: null };
  const nyq = sampleRate / 2;
  let peakBin = 0, peakDb = -Infinity;
  const binMax = new Float32Array(bins).fill(-Infinity);
  for (let f = 0; f < frames; f++) {
    const r = f * bins;
    for (let b = 0; b < bins; b++) {
      const d = data[r + b];
      if (d > binMax[b]) binMax[b] = d;
      if (d > peakDb) { peakDb = d; peakBin = b; }
    }
  }
  // Occupied band within SIGNAL_DB of the peak (skip DC bin 0).
  const thresh = peakDb - SIGNAL_DB;
  let lo = -1, hi = -1;
  for (let b = 1; b < bins; b++) if (binMax[b] >= thresh) { if (lo < 0) lo = b; hi = b; }
  // Noise floor = 10th-percentile of bins that carry energy (> -120 dB).
  const active = [];
  for (let b = 0; b < bins; b++) if (binMax[b] > -120) active.push(binMax[b]);
  active.sort((a, b) => a - b);
  const floorDb = active.length ? active[Math.floor(active.length * 0.1)] : peakDb;
  return {
    peakHz: peakBin / bins * nyq,
    lowHz:  lo < 0 ? null : lo / bins * nyq,
    highHz: hi < 0 ? null : hi / bins * nyq,
    dynRange: peakDb - floorDb,
  };
}

// m:ss.d clock for a time in seconds.
function fmtClock(s) {
  if (s == null || !isFinite(s)) return '-';
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return m + ':' + (sec < 10 ? '0' : '') + sec.toFixed(1);
}

// Per-metric explanations, one per row - each shown behind the row label's own
// [?] tip (the site's standard rowHelp idiom), the same as every other readout.
const SPEC_STAT_HELP = {
  peak: 'The single loudest moment in the clip - when it happens and how loud it is. The level is a short-term average (RMS over a 50 ms window) in dBFS, where 0 is the digital maximum.',
  detected: 'The span of pitches that carry real sound, from the lowest to the highest that stay within ' + SIGNAL_DB + ' dB of the loudest point - quieter frequencies below that are ignored.',
  cutoff: 'The highest pitch present in the sound. A hard ceiling well below 20 kHz (the top of human hearing) is the tell-tale sign of space-saving compression such as MP3 or AAC, and how high it sits hints at the bitrate (quality). Accurate to within half an FFT measurement step - raise FFT to refine.',
  dynRange: 'The gap between the loudest sound and the quiet background hiss (the noise floor, taken as the 10th-percentile level). A big gap means a clean recording with plenty of headroom; a small gap means it is noisy or heavily compressed.',
  resolution: 'How fine the analysis is - how many hertz each pitch step covers and how many milliseconds each time slice covers. The FFT size sets this, and sharpening one always blurs the other.',
};

// Build the stats header (just the caption; each row carries its own [?] tip).
// The values below it are (re)filled by buildSpecStats on every recompute.
function specStatsHead() {
  return el('div', { class: 'anr-spec-stats-head' }, [
    el('div', { class: 'anr-spec-stats-headleft' }, [
      el('span', { class: 'anr-spec-stats-title' }, 'Analysis'),
    ]),
  ]);
}

function buildSpecStats(statsEl, st, fftSize, sampleRate, loud) {
  const hzBin = sampleRate / fftSize;
  const msHop = Math.floor(fftSize / 4) / sampleRate * 1000;
  // Rendered as the site's standard label|value findings table (.anr-readout),
  // so it matches every other readout on the page - each row's label carries a
  // [?] tip (rowHelp) instead of one combined explanation above the table.
  const rows = [
    ['Peak', loud
      ? fmtClock(loud.time) + (isFinite(loud.db) ? '  ' + loud.db.toFixed(1) + ' dBFS' : '')
      : '-', SPEC_STAT_HELP.peak],
    ['Detected range', st.lowHz == null ? '-' : formatHz(st.lowHz) + '–' + formatHz(st.highHz) + ' Hz', SPEC_STAT_HELP.detected],
    // Exact high-frequency cutoff (the lossy-encode lowpass edge for compressed
    // audio). Resolution is one FFT bin (hzBin), so ±hzBin/2 - raise FFT to refine.
    ['Cutoff', st.highHz == null ? '-'
      : Math.round(st.highHz).toLocaleString() + ' Hz  ±' + Math.round(hzBin / 2), SPEC_STAT_HELP.cutoff],
    ['Dynamic range', st.dynRange == null ? '-' : st.dynRange.toFixed(0) + ' dB', SPEC_STAT_HELP.dynRange],
    ['Resolution', formatHz(hzBin) + ' Hz/bin  ·  ' + msHop.toFixed(0) + ' ms/frame', SPEC_STAT_HELP.resolution],
  ];
  statsEl.innerHTML = '';
  const tbl = el('table', { class: 'anr-readout' });
  for (const [lbl, val, help] of rows) tbl.appendChild(rowHelp(lbl, val, help));
  statsEl.appendChild(tbl);
}

// Shared spectrogram-control builders, used by both the file panel and the live
// card (previously duplicated verbatim in each). An inline-flex SVG icon span, a
// labelled control cell, and a captioned segmented group.
const specIco = (svg) => el('span', { html: svg, style: 'display:inline-flex;align-items:center;vertical-align:middle;margin-right:6px;' });
const specCtl = (label, ...nodes) => el('div', { class: 'anr-control' }, label ? [el('label', {}, label), ...nodes] : nodes);
const specGroup = (title, items) => el('div', { class: 'anr-control-group' }, [
  el('span', { class: 'anr-control-group-label' }, title),
  el('div', { class: 'anr-control-group-items' }, items),
]);
// Collapsible "Advanced" disclosure for the analysis params (Mode / FFT /
// Window). Spans the full controls-row width so it opens onto its own line
// under the View controls, using the site's standard <details> +/- pattern.
const specAdvanced = (items) => el('details', { class: 'anr-spec-advanced' }, [
  el('summary', {}, 'Advanced'),
  el('div', { class: 'anr-control-group-items' }, items),
]);

// Custom horizontal scrollbar for the spectrogram, shown under it only when the
// canvas is zoomed wider than the viewport. Drives (and is driven by) scrollEl's
// native scroll, so wheel/trackpad/playhead-follow scrolling all stay in sync.
// A leading spacer matches the y-axis column so the track aligns under the
// canvas, not the axis labels. Returns { el, update }.
function makeSpecScrollbar(scrollEl) {
  const thumb = el('div', { class: 'anr-spec-sb-thumb' });
  const track = el('div', { class: 'anr-spec-sb-track' }, [thumb]);
  const root = el('div', { class: 'anr-spec-sb is-hidden' }, [
    el('div', { class: 'anr-spec-sb-spacer' }),
    track,
  ]);

  function metrics() {
    const sw = scrollEl.scrollWidth, cw = scrollEl.clientWidth;
    return { sw, cw, maxScroll: Math.max(0, sw - cw) };
  }
  function update() {
    const { sw, cw, maxScroll } = metrics();
    // Hint grab-to-pan only when there's actually room to scroll (drives the cursor).
    scrollEl.classList.toggle('is-pannable', maxScroll > 1);
    if (maxScroll <= 1) { root.classList.add('is-hidden'); return; }
    root.classList.remove('is-hidden');
    const tw = track.clientWidth;
    const thumbW = Math.max(28, Math.round(tw * (cw / sw)));
    const maxThumb = tw - thumbW;
    const pos = maxScroll > 0 ? (scrollEl.scrollLeft / maxScroll) * maxThumb : 0;
    thumb.style.width = thumbW + 'px';
    thumb.style.transform = 'translateX(' + pos + 'px)';
  }

  scrollEl.addEventListener('scroll', update, { passive: true });

  // Drag the thumb.
  let dragStartX = 0, startScroll = 0, dragging = false;
  thumb.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dragging = true;
    dragStartX = e.clientX;
    startScroll = scrollEl.scrollLeft;
    track.classList.add('is-dragging');
    try { thumb.setPointerCapture(e.pointerId); } catch (_) {}
  });
  thumb.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const { maxScroll } = metrics();
    const tw = track.clientWidth, thumbW = thumb.clientWidth;
    const maxThumb = tw - thumbW;
    if (maxThumb <= 0) return;
    const startPos = maxScroll > 0 ? (startScroll / maxScroll) * maxThumb : 0;
    const pos = Math.max(0, Math.min(maxThumb, startPos + (e.clientX - dragStartX)));
    scrollEl.scrollLeft = (pos / maxThumb) * maxScroll;
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    track.classList.remove('is-dragging');
    try { thumb.releasePointerCapture(e.pointerId); } catch (_) {}
  };
  thumb.addEventListener('pointerup', endDrag);
  thumb.addEventListener('pointercancel', endDrag);

  // Click the track (off the thumb) → jump so the clicked fraction maps to scroll.
  track.addEventListener('pointerdown', (e) => {
    if (e.target === thumb) return;
    const rect = track.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    scrollEl.scrollLeft = frac * metrics().maxScroll;
  });

  return { el: root, update };
}
// Save the canvas as a PNG download (shared by both spectrogram panels).
function specSavePng(canvas, basename) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    downloadBlob((basename || 'spectrogram') + '.png', blob);
  }, 'image/png');
}

// Modal: before saving the PNG, prompt for the export Height + Zoom rather than
// locking the download to whatever the panel currently shows. Pre-filled from the
// live values; calls onConfirm(heightStr, zoomStr) with the chosen options.
function openSpecSaveModal(heightOpts, zoomOpts, curHeight, curZoom, onConfirm) {
  const hSel = el('select', { class: 'anr-spec-save-select' }, heightOpts.map((v) => el('option', { value: v }, v + 'px')));
  hSel.value = heightOpts.indexOf(curHeight) >= 0 ? curHeight : '720';
  const zSel = el('select', { class: 'anr-spec-save-select' }, zoomOpts.map((v) => el('option', { value: v }, v + 'x')));
  zSel.value = zoomOpts.indexOf(curZoom) >= 0 ? curZoom : '1';

  const fields = el('div', { class: 'anr-spec-save-fields' }, [
    el('label', { class: 'anr-spec-save-field' }, [el('span', {}, 'Height'), hSel]),
    el('label', { class: 'anr-spec-save-field' }, [el('span', {}, 'Zoom'), zSel]),
  ]);
  const cancelBtn = el('button', { type: 'button', class: 'anr-modal-btn anr-modal-cancel' }, 'Cancel');
  const okBtn = el('button', { type: 'button', class: 'anr-modal-btn anr-modal-ok' }, 'Download');
  const card = el('div', { class: 'anr-modal-card' }, [
    el('p', { class: 'anr-modal-kicker' }, 'Save PNG'),
    el('p', { class: 'anr-modal-title' }, 'Export size for the spectrogram image.'),
    fields,
    el('div', { class: 'anr-modal-actions' }, [cancelBtn, okBtn]),
  ]);
  const overlay = el('div', { class: 'anr-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Save spectrogram' }, card);
  document.body.appendChild(overlay);

  let settled = false;
  const close = () => {
    if (settled) return;
    settled = true;
    overlay.classList.remove('is-open');
    setTimeout(() => overlay.remove(), 200);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  okBtn.addEventListener('click', () => { const h = hSel.value, z = zSel.value; close(); onConfirm(h, z); });

  requestAnimationFrame(() => overlay.classList.add('is-open'));
}
// Wire fullscreen for a spectrogram card: the toggle button, a floating ✕ exit
// button (shown only in fullscreen via CSS), and the fullscreenchange handlers.
// `onChange(isFullscreen)` lets each panel do its own resize. Shared by both panels.
function attachFullscreen(card, fsBtn, allowFs, sig, onChange) {
  if (!allowFs || !fsBtn) return () => {};
  const isFs = () => document.fullscreenElement === card;
  const exitFs = () => { if (document.fullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document); };
  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) exitFs();
    else (card.requestFullscreen || card.webkitRequestFullscreen).call(card);
  });
  const fsClose = el('button', { type: 'button', class: 'anr-spec-fs-close', title: 'Exit fullscreen (Esc)', 'aria-label': 'Exit fullscreen' }, '✕');
  fsClose.addEventListener('click', exitFs);
  card.appendChild(fsClose);
  const onFsChange = () => {
    const fs = isFs();
    fsBtn.textContent = fs ? 'Exit fullscreen' : 'Fullscreen';
    onChange(fs);
  };
  const o = sig ? { signal: sig } : undefined;
  document.addEventListener('fullscreenchange', onFsChange, o);
  document.addEventListener('webkitfullscreenchange', onFsChange, o);
  return () => {
    document.removeEventListener('fullscreenchange', onFsChange);
    document.removeEventListener('webkitfullscreenchange', onFsChange);
    fsClose.remove();
  };
}

// --- Custom player (replaces native <audio>/<video> controls) ---
// --- Spectrogram UI panel (shared for file + recording) ---
export function makeSpectrogramPanel(samples, sampleRate, opts = {}) {
  const card = el('div', { class: 'anr-card anr-spec-card anr-spec-fillable' });

  // Isolate-frequencies state. Declared up here because the pan/seek guards below
  // and recompute's band repositioning reference it; the tool itself is wired up
  // in the isolate block near the end of this function.
  const NYQ = sampleRate / 2;
  // Bottom of the log frequency axis, in Hz. Below the old 20 Hz floor so sub-20 Hz
  // (infrasound / very low bass) is actually shown; render, axis labels and the
  // isolate-band overlays all key off this so they can't drift. Linear scale floors
  // at 0. Kept in sync with buildFreqAxis's own literal.
  const SPEC_LOG_MIN = 10;
  const isoBands = [];   // { lo, hi, el, row, fromIn, toIn }
  let isoActive = false;
  // 'bands' = the frequency band-stop tool (manual bands + solo presets, which are
  // just complement cuts). 'karaoke' = centre-cancel vocal removal (stereo L-R).
  let isoMode = 'bands';
  // The karaoke "deadzone" overlay (assigned when the interactive tool wires up).
  // Karaoke cancels centre content across the whole spectrum, but the removed
  // energy that matters is the vocal, so we draw it over the vocal band.
  let karaokeOverlay = null;
  const KARAOKE_LO = 300, KARAOKE_HI = 3400;

  const [specH, specHelp] = h3help('Spectrogram',
    '<strong>Axis</strong> Log spaces the pitches the way we hear them, so each step up an octave takes the same room (closer to human hearing). Linear spaces frequencies evenly in hertz instead.<br>' +
    '<strong>Mode</strong> STFT is the standard method (a windowed FFT). Reassigned sharpens both the time and pitch axes at once by nudging each cell’s energy to its true centre - thin ridges instead of blurred blobs - using the same FFT (3× the compute).<br>' +
    '<strong>FFT</strong> Fast Fourier Transform - the block size used to split the sound into pitches. Larger shows pitch more precisely but blurs timing; smaller does the reverse.<br>' +
    '<strong>Window</strong> A smoothing shape applied to each block before the FFT. Hann is a good default; Blackman further cuts smearing between nearby pitches (spectral leakage); Rect (rectangular) applies no smoothing.<br>' +
    '<strong>Colour</strong> The colour scheme used to show loudness. Magma, viridis and inferno keep equal loudness steps looking equally different (perceptually uniform).<br>' +
    '<strong>Zoom</strong> Horizontal zoom. Stretches the time axis so you can see finer detail.<br>' +
    '<strong>Height</strong> Vertical size of the spectrogram canvas in pixels. In fullscreen, “Fill” stretches it to the whole screen; pick a pixel value for a fixed size instead.');
  card.appendChild(specH);
  card.appendChild(specHelp);

  // --- controls ---
  const controls = el('div', { class: 'anr-controls' });
  const toggle = el('div', { class: 'anr-toggle' });
  const btnLog = el('button', { type: 'button', class: 'is-active' }, 'LOG');
  const btnLin = el('button', { type: 'button' }, 'LINEAR');
  toggle.appendChild(btnLog); toggle.appendChild(btnLin);

  const modeSel = el('select', {}, [
    el('option', { value: 'stft' }, 'STFT'),
    el('option', { value: 'reassigned' }, 'Reassigned'),
  ]);
  const fftSel  = el('select', {}, ['256','512','1024','2048','4096','8192'].map((v) => el('option', { value: v }, v)));
  fftSel.value = '2048';
  const winSel  = el('select', {}, ['hann','hamming','blackman','rect'].map((v) => el('option', { value: v }, v)));
  const cmapSel = el('select', {}, Object.keys(colormaps).map((v) => el('option', { value: v }, v)));
  cmapSel.value = 'magma';
  const zoomSel = el('select', {}, ['1','1.5','2','3','4','6','8','12','16','24','32','48'].map((v) => el('option', { value: v }, v + 'x')));
  zoomSel.value = '1';
  const heightSel = el('select', {}, ['240','320','420','560','720','900'].map((v) => el('option', { value: v }, v + 'px')));
  heightSel.value = '320';
  // Sensitivity maps to the render dB floor: higher % = lower floor = more faint
  // detail. 100% -> -90 dB (the default render floor), so the image is unchanged at
  // rest; the slider ranges 0%..300% (-60 dB .. -150 dB).
  const sensIn  = el('input', { type: 'range', min: '0', max: '300', value: '100', step: '1' });
  const sensOut = el('span', { class: 'anr-range-readout' }, '100%');
  // A slit marks the 100% default (at 100/300 = 33.33% of the track). It's purely
  // visual - clicks fall through to the slider, which snaps to exactly 100% near it
  // (see the input handler) - so the mark and a click-to-reset come for free.
  const sensTick = el('div', { class: 'anr-range-tick', style: 'left:33.333%', 'aria-hidden': 'true' });
  const sensWrap = el('div', { class: 'anr-range-wrap' }, [sensIn, sensTick]);
  // Clickable label resets the slider to its 100% default.
  const sensLabel = el('label', { class: 'anr-resettable', title: 'Click to reset to 100%' }, 'Sensitivity');
  const sensCtl = el('div', { class: 'anr-control' }, [sensLabel, sensWrap, sensOut]);

  // Fullscreen is desktop-only: mobile browsers can't fullscreen an arbitrary
  // element reliably, so we drop the button and its handlers on touch devices.
  const allowFs = !window.matchMedia('(pointer: coarse)').matches;

  const sIco = specIco;
  const saveBtn = el('button', { type: 'button', class: 'anr-btn' }, [sIco('<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 1v8M3 6l4 4 4-4"/><path d="M1 11v2h12v-2"/></svg>'), 'Save PNG']);
  const fsBtn   = allowFs ? el('button', { type: 'button', class: 'anr-btn' }, [sIco('<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9"/></svg>'), 'Fullscreen']) : null;

  // Settings are organised into labelled, hairline-divided groups (segmented):
  // View (how it looks) - Resolution (analysis params) - Actions (buttons).
  const ctl = specCtl, group = specGroup;

  controls.appendChild(group('View', [
    ctl('Axis', toggle),
    ctl('Colour', cmapSel),
    sensCtl,
    ctl('Zoom', zoomSel),
    // Height is hidden in fullscreen (the canvas auto-fills there).
    el('div', { class: 'anr-control anr-ctl-height' }, [el('label', {}, 'Height'), heightSel]),
  ]));
  controls.appendChild(specAdvanced([
    ctl('Mode', modeSel),
    ctl('FFT', fftSel),
    ctl('Window', winSel),
  ]));

  // Persistent capture controls (audio panel only - opts.capture). They delegate to
  // the top-level Record / Live buttons, reusing all their wiring; #audioLive already
  // toggles on/off via closeLive(), so the Live button is a true toggle.
  const actions = [ctl('', saveBtn)];
  if (fsBtn) actions.push(ctl('', fsBtn));
  // Isolate frequencies (band-stop) - only offered when driving file playback.
  const isoBtn = opts.audioEl
    ? el('button', { type: 'button', class: 'anr-btn anr-iso-toggle' }, [sIco('<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 4h5M9 4h4M1 10h4M8 10h5"/><circle cx="7.5" cy="4" r="1.6" fill="currentColor" stroke="none"/><circle cx="6.5" cy="10" r="1.6" fill="currentColor" stroke="none"/></svg>'), 'Isolate'])
    : null;
  if (isoBtn) {
    actions.unshift(ctl('', isoBtn));   // Isolate sits leftmost in the Actions row
    // Divider between the Isolate tool and the plain Save PNG / Fullscreen actions.
    actions.splice(1, 0, el('span', { class: 'anr-spec-actdiv', 'aria-hidden': 'true' }, '|'));
  }
  if (opts.capture) {
    const recBtn  = el('button', { type: 'button', class: 'anr-btn' }, [sIco('<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" fill="currentColor"/></svg>'), 'Record']);
    const liveBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Live spectrogram');
    // Call startRecording directly (same module) rather than clicking the dropzone's
    // #audioRecord button - a programmatic .click() can focus-scroll the dropzone
    // into view. Then scroll to the Sound section (02), where the result renders.
    recBtn.addEventListener('click', () => {
      const ar = document.getElementById('audioResults');
      const topRecBtn = document.getElementById('audioRecord');
      if (topRecBtn && topRecBtn.classList.contains('is-recording')) { if (topRecBtn._stopRec) topRecBtn._stopRec(); return; }
      if (ar) startRecording(ar, topRecBtn || recBtn);
    });
    liveBtn.addEventListener('click', () => document.getElementById('audioLive')?.click());
    actions.push(ctl('', recBtn), ctl('', liveBtn));
  }
  // The Actions group lives in its own row UNDER the scrubber (appended after the
  // transport below), separate from the settings controls above the canvas.
  const actionsBar = el('div', { class: 'anr-controls anr-spec-actions' }, [group('Actions', actions)]);
  card.appendChild(controls);

  // --- spectrogram body ---
  const wrap     = el('div', { class: 'anr-spec-wrap' });
  const yWrap    = el('div', { class: 'anr-spec-yaxis-wrap' });
  const axisY    = el('div', { class: 'anr-spec-yaxis' });
  const corner   = el('div', { class: 'anr-spec-corner' });
  yWrap.appendChild(axisY); yWrap.appendChild(corner);

  const scrollEl = el('div', { class: 'anr-spec-scroll anr-spec-pan' });
  const canvasWrap = el('div', { class: 'anr-spec-canvas-wrap' });
  const canvas   = el('canvas', { class: 'anr-spec-canvas' });
  const axisX    = el('div', { class: 'anr-spec-xaxis' });
  canvasWrap.appendChild(canvas);

  // Shared between the drag-to-pan handler (added after the audio block) and the
  // click-to-seek handler: once a drag pans the view, the trailing click is a pan,
  // not a seek.
  let panMoved = false;

  // Blend override: the vocal/instrumental blend slider (renderBlend, in the AI
  // section) morphs the MAIN spectrogram rather than a canvas of its own. When
  // active it parks a recombined spec here so recompute()/renderOnly() paint it
  // instead of the file's own spectrum; the two hooks let it drive the main
  // playhead and capture time-axis clicks while its audio plays. Declared HERE,
  // above the playhead block below, because that block assigns driveSpecLine
  // synchronously - a later `let` would be a temporal-dead-zone ReferenceError.
  let blendSpec = null;         // recombined spec while the blend owns the canvas, else null
  let driveSpecLine = null;     // (frac, playing, animate) => moves the main playhead
  let blendActive = false;      // true while the blend owns the spectrogram (analysed -> cleanup)
  let blendSeek = null;         // (frac) => seek the blend; while active, canvas/playhead seeks route here
  let blendPause = null;        // () => pause the blend (mutual exclusion with the file transport)
  let specTransport = null;     // the under-spectrogram makePlayer; the blend delegates to it while active
  let blendApplyIso = null;     // set while blend owns audio: re-route its stems through the isolate band-stop
  let blendReanalyse = null;    // set while blend owns the canvas: re-run the stem STFTs for new fft/window/mode

  // The blend plays through raw Web Audio buffer sources (not a media element), so
  // clearResultsUI's element pause doesn't reach it - register a stopper it calls
  // when a new file is imported, or the separated stems keep playing over it.
  (window._anrMediaStoppers = window._anrMediaStoppers || new Set())
    .add(() => { try { if (blendPause) blendPause(); } catch (_) {} });

  if (opts.audioEl) {
    const specLine = el('div', { class: 'anr-playhead' });
    canvasWrap.appendChild(specLine);
    const audioDur = () => opts.audioEl.duration || (samples.length / sampleRate);
    function scrollToLine(park) {
      if (canvas.clientWidth <= scrollEl.clientWidth) return;
      const linePos = canvas.clientWidth * parseFloat(specLine.style.left || '0') / 100;
      const maxScroll = scrollEl.scrollWidth - scrollEl.clientWidth;
      const parked = Math.max(0, Math.min(maxScroll, linePos - scrollEl.clientWidth / 5));
      if (park) {
        // Playing: lock the playhead at the left fifth of the viewport and slide the
        // spectrogram under it. Clamping lets the line drift in from the left edge at
        // the very start, sit fixed at clientWidth/5 through the middle, then slide out
        // to the right edge once the scroll bottoms out.
        scrollEl.scrollLeft = parked;
        return;
      }
      // Paused seek: leave the view put unless the line lands off-screen, then bring it
      // back to the left fifth.
      const viewLeft = scrollEl.scrollLeft, viewRight = viewLeft + scrollEl.clientWidth;
      if (linePos < viewLeft + 20 || linePos > viewRight - 20) scrollEl.scrollLeft = parked;
    }
    // Move the playhead to a playback fraction. `animate` lets the line ease into
    // place for discrete seeks while paused; during live playback it tracks
    // frame-by-frame with no transition so it can't lag behind the audio.
    function moveLine(frac, playing, animate) {
      specLine.style.transition = animate ? '' : 'none';
      specLine.style.left = (frac * 100) + '%';
      scrollToLine(playing);
    }
    // The blend player (renderBlend) drives the SAME line while its stems play.
    driveSpecLine = moveLine;
    function updateLine(animate) {
      const d = audioDur();
      moveLine(d > 0 ? opts.audioEl.currentTime / d : 0, !opts.audioEl.paused, animate);
    }
    function tickSpec() {
      updateLine(false);
      if (!opts.audioEl.paused) requestAnimationFrame(tickSpec);
    }
    opts.audioEl.addEventListener('play', () => { if (blendPause) blendPause(); requestAnimationFrame(tickSpec); });
    opts.audioEl.addEventListener('pause', () => updateLine(true));
    opts.audioEl.addEventListener('seeked', () => updateLine(opts.audioEl.paused));
    canvas.addEventListener('click', (e) => {
      if (isoActive) return;                         // isolate mode owns clicks/drags on the canvas
      if (panMoved) { panMoved = false; return; }   // a drag-pan ended here, not a seek
      const rect = canvas.getBoundingClientRect();
      const frac = (e.clientX - rect.left) / rect.width;
      if (blendActive && blendSeek) { blendSeek(Math.max(0, Math.min(1, frac))); return; }  // blend owns the transport
      opts.audioEl.currentTime = frac * audioDur();
    });
    // Grab the playhead line and drag to scrub (snappy - no easing while dragging).
    attachScrub(specLine, (clientX) => {
      const rect = canvas.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      if (blendActive && blendSeek) { blendSeek(frac); return; }   // blend drives the line back itself
      opts.audioEl.currentTime = frac * audioDur();
      specLine.style.transition = 'none';
      specLine.style.left = (frac * 100) + '%';
    });
  }

  scrollEl.appendChild(canvasWrap); scrollEl.appendChild(axisX);

  // Grab-and-pan: drag horizontally anywhere on the spectrogram body to scroll it
  // (mouse/pen), as an alternative to the scrollbar. A small movement threshold keeps a
  // plain click seeking. Pointer-down on the playhead is left to its own scrub handler,
  // and touch keeps the browser's native horizontal scroll.
  {
    let pid = null, startX = 0, startScroll = 0;
    const THRESH = 4;
    scrollEl.addEventListener('pointerdown', (e) => {
      if (isoActive) return;                         // isolate mode captures the drag itself
      if (e.button !== 0 || e.pointerType === 'touch') return;
      if (e.target.closest && e.target.closest('.anr-playhead')) return;
      pid = e.pointerId; startX = e.clientX; startScroll = scrollEl.scrollLeft;
      panMoved = false;
    });
    scrollEl.addEventListener('pointermove', (e) => {
      if (pid === null || e.pointerId !== pid) return;
      const maxScroll = scrollEl.scrollWidth - scrollEl.clientWidth;
      if (maxScroll <= 0) return;                  // nothing to pan when not zoomed in
      const dx = e.clientX - startX;
      if (!panMoved && Math.abs(dx) < THRESH) return;
      if (!panMoved) {
        panMoved = true;
        scrollEl.classList.add('is-panning');
        try { scrollEl.setPointerCapture(pid); } catch (_) {}
      }
      scrollEl.scrollLeft = Math.max(0, Math.min(maxScroll, startScroll - dx));
      e.preventDefault();
    });
    const endPan = (e) => {
      if (pid === null || (e && e.pointerId !== pid)) return;
      try { scrollEl.releasePointerCapture(pid); } catch (_) {}
      pid = null;
      scrollEl.classList.remove('is-panning');
    };
    scrollEl.addEventListener('pointerup', endPan);
    scrollEl.addEventListener('pointercancel', endPan);
  }

  wrap.appendChild(yWrap); wrap.appendChild(scrollEl);
  card.appendChild(wrap);

  // Custom horizontal scrollbar, directly under the spectrogram. Hidden until the
  // canvas is zoomed wider than the viewport.
  const scrollbar = makeSpecScrollbar(scrollEl);
  card.appendChild(scrollbar.el);

  if (opts.audioEl) {
    specTransport = makePlayer(opts.audioEl, samples.length / sampleRate);
    card.appendChild(el('div', { class: 'anr-spec-transport' }, [specTransport]));
  }

  // The vocal<->instrumental blend slider (renderBlend) mounts here once AI
  // separation finishes - between the scrubber and the actions row - so it sits
  // right beneath the spectrogram it morphs.
  const blendMount = el('div', { class: 'anr-blend-mount' });
  card.appendChild(blendMount);

  // Actions row sits under the scrubber (or directly under the canvas when there's
  // no transport).
  card.appendChild(actionsBar);

  const stats = el('div', { class: 'anr-spec-stats' });
  // The frame/bin/px/ms readout rides in the Analysis header (muted, right) rather
  // than as a stray line under the grid, so the block reads as one tidy unit.
  const status = el('span', { class: 'anr-spec-status' }, 'computing…');
  const statsHead = specStatsHead();
  statsHead.appendChild(status);
  // The "Analysis" block normally rides at the foot of this card, but the file
  // renderer hands us an external mount (opts.statsMount) so it can live in the
  // File info card instead. It still updates live from recompute()/renderOnly()
  // - the mount is cleared and refilled here (a channel switch recreates us).
  const statsBlock = el('div', { class: 'anr-spec-statsblock' }, [statsHead, stats]);
  if (opts.statsMount) { opts.statsMount.innerHTML = ''; opts.statsMount.appendChild(statsBlock); }
  else card.appendChild(statsBlock);

  let state = {
    mode: 'stft', scale: 'log', cmap: 'magma', fftSize: 2048, winName: 'hann',
    zoom: 1, height: 320, dbFloor: -90
  };
  let cached = null;
  // Loudest-moment figure for the Peak stat - signal-only, so compute it once.
  const loud = loudestMoment(samples, sampleRate);

  // Resolves after the first recompute() paints. renderAudio awaits this so the
  // bottom "Reading…" loader stays up until the spectrogram is actually on screen
  // (the panel computes on a deferred setTimeout, after renderAudio returns).
  let _resolveFirstPaint;
  card.firstPaint = new Promise((res) => { _resolveFirstPaint = res; });
  function markFirstPaint() {
    if (_resolveFirstPaint) { const r = _resolveFirstPaint; _resolveFirstPaint = null; r(); }
  }

  function isFs() { return document.fullscreenElement === card; }
  function availableWidth() {
    const total = wrap.clientWidth || 600;
    return Math.max(200, total - 44 - 4);
  }
  function sizeCanvas() {
    const baseW = availableWidth();
    // Cap the bitmap width: browsers silently refuse to paint a canvas wider than
    // their max dimension, so at high zoom on a wide window we clamp rather than
    // render blank. Chromium's per-dimension limit is 16384 (Firefox 32767,
    // iOS Safari lower via total area), so 16384 is the safe cross-browser cap.
    const w = Math.min(16384, Math.max(200, Math.round(baseW * state.zoom)));
    canvas.width = w;
    canvas.style.width = w + 'px';
    axisX.style.width = w + 'px';
    // Pin the wrapper to the canvas width. It's the containing block for the
    // absolutely-positioned playhead, whose `left` is a percentage. Left as a
    // stretched column-flex item, its width (the cross axis) collapses to the
    // viewport - cross-axis stretch ignores the min-content clamp - so the canvas
    // overflows it and the playhead's % mapped against the viewport, not the zoomed
    // canvas. That parked the line at ~1/zoom of its true position once zoomed in.
    canvasWrap.style.width = w + 'px';
    if (isFs()) {
      // In fullscreen the canvas always fills its box via CSS (height:100%). The Height
      // control changes the BOX (the .anr-spec-wrap) height, not the canvas directly -
      // via a class + CSS var - so the canvas AND the y-axis resize together and stay
      // aligned. 'fill' drops the fixed height and lets the box grow to the whole screen.
      if (state.height === 'fill') {
        card.classList.remove('is-spec-fixed-h');
      } else {
        card.style.setProperty('--spec-fixed-h', state.height + 'px');
        card.classList.add('is-spec-fixed-h');
      }
      // Read the resolved height (set by the class/var above) to size the bitmap.
      canvas.style.height = '100%';
      canvas.height = Math.max(160, canvas.clientHeight || 160);
    } else {
      // Windowed: the canvas height is the chosen pixel value directly.
      card.classList.remove('is-spec-fixed-h');
      const h = state.height === 'fill' ? 320 : state.height;
      canvas.style.height = h + 'px';
      canvas.height = h;
    }
  }

  function recompute() {
    const t0 = performance.now();
    if (!cached || cached.fftSize !== state.fftSize || cached.winName !== state.winName || cached.mode !== state.mode) {
      const params = {
        fftSize: state.fftSize,
        hopSize: Math.floor(state.fftSize / 4),
        window:  state.winName
      };
      const spec = state.mode === 'reassigned'
        ? computeReassignedSpectrogram(samples, sampleRate, params)
        : computeSpectrogram(samples, sampleRate, params);
      // Stats are signal-relative (independent of the dB floor / sensitivity), so
      // they only need computing once per spectrum - not on every render.
      cached = { fftSize: state.fftSize, winName: state.winName, mode: state.mode, spec, stats: specStats(spec) };
    }
    sizeCanvas();
    renderSpectrogram(canvas, blendSpec || cached.spec, { scale: state.scale, colormap: state.cmap, dbFloor: state.dbFloor, minHz: state.scale === 'log' ? SPEC_LOG_MIN : 0 });
    const duration = samples.length / sampleRate;
    buildFreqAxis(axisY, sampleRate, state.scale);
    buildTimeAxis(axisX, duration);
    buildSpecStats(stats, cached.stats, state.fftSize, sampleRate, loud);
    scrollbar.update();
    positionBands();
    const ms = (performance.now() - t0).toFixed(0);
    status.textContent = `${cached.spec.frames} frames × ${cached.spec.bins} bins | ${canvas.width}×${canvas.height} px | ${ms} ms`;
  }

  // Cheap path for changes that only affect pixels, not geometry or the spectrum
  // (sensitivity, colour). No FFT recompute, no canvas resize, no stats re-scan.
  function renderOnly() {
    if (!cached && !blendSpec) return;   // first paint hasn't computed the spectrum yet (recompute will)
    renderSpectrogram(canvas, blendSpec || cached.spec, { scale: state.scale, colormap: state.cmap, dbFloor: state.dbFloor, minHz: state.scale === 'log' ? SPEC_LOG_MIN : 0 });
    if (cached) buildSpecStats(stats, cached.stats, state.fftSize, sampleRate, loud);
  }

  btnLog.addEventListener('click', () => {
    state.scale = 'log';
    btnLog.classList.add('is-active'); btnLin.classList.remove('is-active');
    recompute();
  });
  btnLin.addEventListener('click', () => {
    state.scale = 'linear';
    btnLin.classList.add('is-active'); btnLog.classList.remove('is-active');
    recompute();
  });
  // While the AI blend owns the canvas, these controls must re-run the blend's own
  // spectrogram (recompute() only rebuilds the file's, which the blend paints over).
  const afterSpecParam = () => { if (blendActive && blendReanalyse) blendReanalyse(); };
  modeSel.addEventListener('change',   () => { state.mode    = modeSel.value; recompute(); afterSpecParam(); });
  fftSel.addEventListener('change',    () => { state.fftSize = parseInt(fftSel.value, 10); recompute(); afterSpecParam(); });
  winSel.addEventListener('change',    () => { state.winName = winSel.value; recompute(); afterSpecParam(); });
  cmapSel.addEventListener('change',   () => { state.cmap    = cmapSel.value; renderOnly(); });
  zoomSel.addEventListener('change',   () => { state.zoom    = parseFloat(zoomSel.value); recompute(); });
  // Ctrl/⌘ + wheel zooms horizontally, anchored on the pointer (keeps the time
  // under the cursor fixed) - matching the gyro timeline.
  scrollEl.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const next = Math.min(48, Math.max(1, state.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
    if (next === state.zoom) return;
    const off = e.clientX - scrollEl.getBoundingClientRect().left;
    const oldW = canvasWrap.clientWidth || canvas.width;
    const frac = (scrollEl.scrollLeft + off) / Math.max(1, oldW);
    state.zoom = next;
    const ZOOMS = ['1', '1.5', '2', '3', '4', '6', '8', '12', '16', '24', '32', '48'];
    zoomSel.value = ZOOMS.reduce((p, c) => Math.abs(+c - next) < Math.abs(+p - next) ? c : p, '1');
    recompute();
    scrollEl.scrollLeft = frac * (canvasWrap.clientWidth || canvas.width) - off;
  }, { passive: false });
  heightSel.addEventListener('change', () => {
    state.height = heightSel.value === 'fill' ? 'fill' : parseInt(heightSel.value, 10);
    recompute();
  });
  // The repaint is heavy (a full-canvas redraw), so doing it synchronously on
  // every input event stalls the drag. Update the cheap bits (state + readout)
  // immediately so the thumb tracks the pointer, and coalesce the redraw to at
  // most one per animation frame.
  let sensRaf = 0, sensManual = false;
  function applySensitivity(v) {
    v = Math.max(0, Math.min(300, Math.round(v)));
    sensIn.value = String(v);
    state.dbFloor = -60 - (v / 100) * 30;   // 0% -> -60 dB, 100% -> -90 dB, 300% -> -150 dB
    sensOut.textContent = v + '%';
    if (sensRaf) return;                    // a repaint is already queued for the next frame
    sensRaf = requestAnimationFrame(() => { sensRaf = 0; renderOnly(); });
  }
  sensIn.addEventListener('input', (e) => {
    // A genuine drag hands control to the user - stop auto-following the volume.
    // Programmatic value changes (the volume mirror below) dispatch nothing, so
    // isTrusted cleanly separates the two.
    if (e.isTrusted) sensManual = true;
    let v = parseInt(sensIn.value, 10);
    // Detent at the 100% slit: a user drag/click landing within a few percent of
    // 100 snaps to exactly 100 (so clicking the slit resets cleanly). The volume
    // mirror sets exact values and isn't trusted, so it's never snapped.
    if (e.isTrusted && Math.abs(v - 100) <= 6) v = 100;
    applySensitivity(v);
  });
  sensLabel.addEventListener('click', () => {
    sensManual = true;                      // an explicit reset is the user taking over too
    applySensitivity(100);
  });

  // Mirror a volume BOOST into the sensitivity: pushing the level from 100% to 225%
  // drags the display sensitivity along the same 100..225 range, so a boosted-quiet
  // clip's spectrogram brightens to match what you now hear. Only while the user
  // hasn't set sensitivity by hand, and only for the boosted range (a level below
  // 100% leaves sensitivity at its 100% floor). Skipped when this panel isn't
  // driving live audio (no volume control to follow).
  if (opts.audioEl) {
    const mirror = (level) => { if (!sensManual) applySensitivity(Math.max(100, Math.min(225, Math.round(level * 100)))); };
    mirror(sharedVolume());                 // adopt an already-boosted level on mount
    const unsub = onSharedVolume((level) => {
      if (!sensIn.isConnected) { unsub(); return; }   // panel gone - drop the subscription
      mirror(level);
    });
  }

  saveBtn.addEventListener('click', () => {
    const heightOpts = ['240', '320', '420', '560', '720', '900'];
    const zoomOpts = ['1', '1.5', '2', '3', '4', '6', '8', '12', '16', '24', '32', '48'];
    const curH = (state.height === 'fill' || !state.height) ? '720' : String(state.height);
    const curZ = String(state.zoom);
    openSpecSaveModal(heightOpts, zoomOpts, curH, curZ, (hVal, zVal) => {
      // Render the chosen size off-screen from the cached spectrum so the export
      // honours the picked Height/Zoom without disturbing the on-screen panel.
      if (!cached || !cached.spec) { specSavePng(canvas, opts.basename); return; }
      const w = Math.min(30000, Math.max(200, Math.round(availableWidth() * parseFloat(zVal))));
      const h = parseInt(hVal, 10) || 320;
      const out = el('canvas');
      out.width = w; out.height = h;
      renderSpectrogram(out, cached.spec, { scale: state.scale, colormap: state.cmap, dbFloor: state.dbFloor, minHz: state.scale === 'log' ? SPEC_LOG_MIN : 0 });
      specSavePng(out, opts.basename);
    });
  });

  // ---- Isolate frequencies (band-stop) ----
  // Frequency <-> vertical-fraction mapping, mirroring renderSpectrogram's y-axis
  // (SPEC_LOG_MIN 10 Hz floor .. Nyquist, log or linear). frac is 0 at the bottom,
  // 1 at the top.
  function freqToFrac(hz) {
    hz = Math.max(1, Math.min(NYQ, hz));
    if (state.scale === 'log') {
      const lo = Math.log10(SPEC_LOG_MIN), hi = Math.log10(Math.max(SPEC_LOG_MIN + 1, NYQ));
      return Math.max(0, Math.min(1, (Math.log10(Math.max(SPEC_LOG_MIN, hz)) - lo) / (hi - lo)));
    }
    return Math.max(0, Math.min(1, hz / NYQ));
  }
  function fracToFreq(frac) {
    frac = Math.max(0, Math.min(1, frac));
    if (state.scale === 'log') {
      const lo = Math.log10(SPEC_LOG_MIN), hi = Math.log10(Math.max(SPEC_LOG_MIN + 1, NYQ));
      return Math.pow(10, lo + frac * (hi - lo));
    }
    return frac * NYQ;
  }
  // Reposition every band overlay to its Hz range. Called from recompute, so the
  // overlays track the axis when the scale / height / zoom changes.
  function positionBands() {
    for (const b of isoBands) {
      const fa = freqToFrac(Math.min(b.lo, b.hi));
      const fb = freqToFrac(Math.max(b.lo, b.hi));
      b.el.style.top = ((1 - fb) * 100) + '%';
      b.el.style.height = Math.max(0, (fb - fa) * 100) + '%';
    }
    // Karaoke overlay tracks the vocal band on the same axis as the bands.
    if (karaokeOverlay && karaokeOverlay.style.display !== 'none') {
      const fa = freqToFrac(KARAOKE_LO), fb = freqToFrac(KARAOKE_HI);
      karaokeOverlay.style.top = ((1 - fb) * 100) + '%';
      karaokeOverlay.style.height = Math.max(0, (fb - fa) * 100) + '%';
    }
  }

  // The interactive tool filters live playback, so it only wires up when the panel
  // is driving a file (opts.audioEl). Without one, the helpers above stay harmless
  // no-ops (isoBands never gets entries).
  if (opts.audioEl && isoBtn) {
    const clampHz = (v) => Math.max(1, Math.min(Math.round(NYQ), Math.round(+v || 0)));

    // Overlay layer over the canvas (pointer-events off - the drag handler lives on
    // canvasWrap). Hidden until isolate is switched on.
    const bandLayer = el('div', { class: 'anr-spec-bandlayer', style: 'display:none;' });
    canvasWrap.appendChild(bandLayer);
    // Karaoke (Remove vocals) is a stereo centre-cancel. It has no single band, but
    // the removed energy that matters is the vocal, so draw the deadzone over the
    // vocal range (positioned by positionBands, toggled by rebuildGraph).
    karaokeOverlay = el('div', { class: 'anr-spec-karaoke', style: 'display:none;' });
    bandLayer.appendChild(karaokeOverlay);

    // --- control panel (presets + band list + numeric editing) ---
    const bandList = el('div', { class: 'anr-iso-list' });
    const addBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, '+ Custom band');
    const exportBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm anr-iso-export' }, 'Download WAV');
    // Only meaningful once there's a band to render; hidden until then (synced in
    // rebuildGraph, which every add/remove/preset/clear path funnels through).
    exportBtn.hidden = true;
    // Preset bar + its state, filled in the presets block below (kept empty here so
    // it can be a child of the panel before the band helpers exist).
    const presetBar = el('div', { class: 'anr-iso-presets' });
    const presetBtns = {};
    let activePreset = null, applyingPreset = false;
    // AI stem separation: a real model, unlike the EQ presets. Wired in the block
    // further down; the elements live here so they can sit inside the panel.
    const aiBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm anr-iso-ai' }, 'AI separation');
    const aiStatus = el('div', { class: 'anr-iso-aistatus', hidden: true });
    const aiStems = el('div', { class: 'anr-iso-stems' });
    // Explanation tucked behind a [?] next to the "Separate" label (site's
    // standard info-toggle idiom, same as h3help) so the section stays compact.
    // The section holds both approaches now (EQ presets + the AI model), so the
    // help covers both rather than just the AI part.
    const aiHelpBtn = el('button', { type: 'button', class: 'anr-info-btn', title: 'About separating parts' }, '[?]');
    const aiHelpPanel = el('div', { class: 'anr-info-panel is-hidden', html:
      'Two ways to pull a single part out of the mix. The <strong>presets</strong> (Underwater, Radio, Hollow) are one-tap character filters - they keep or cut ranges of pitch to colour the whole track: a muffled low-pass (<strong>Underwater</strong>), a tinny band-pass (<strong>Radio</strong>) or a scooped mid notch (<strong>Hollow</strong>). They are instant but rough. <strong>AI separation</strong> opens a row of real on-device AI tools. Pick <strong>Standard</strong> or <strong>Lite</strong> to split the track into a clean vocal and a clean backing track (separate "stems") - far cleaner than the presets, and a true separation rather than just a pitch cut; Standard is the cleanest, Lite is about half the download and lighter to run, for phones. <strong>Denoise</strong> (in the same row) does something different: instead of splitting vocals from music, it removes background noise and hiss while keeping the full sound, and shows the result as a Clean to Noise blend. The AI runs entirely on your device and nothing is uploaded; the first run downloads the chosen model once, then works offline.' });
    wireInfoToggle(aiHelpBtn, aiHelpPanel);
    const aiLabel = el('span', { class: 'anr-iso-seclabel' }, 'Separate');
    aiLabel.appendChild(aiHelpBtn);
    // One row: the AI separator on the far left, a divider, then the rough EQ
    // presets (Underwater/Radio/Hollow). Clear is appended
    // later and pushed to the far right. Both sides are one-tap tone tools.
    const aiSep = el('span', { class: 'anr-iso-seg-div', 'aria-hidden': 'true' }, '|');
    const aiRow = el('div', { class: 'anr-iso-ai-row' }, [aiBtn, aiSep, presetBar]);
    // Which AI model the Separate button uses. "standard" (Kim Vocal 2) is the
    // cleaner, heavier default; "lite" (UVR-MDX-NET 1) is roughly half the download
    // and lighter to run - meant for phones / slower machines. The models are
    // defined in mdx-model.js (MDX_MODELS); the picker just tracks the chosen id.
    // Default to the lighter Lite model on the narrow (mobile) layout, where it is the
    // better fit; the wider desktop layout defaults to the cleaner Standard model.
    const preferLite = !!(window.matchMedia && window.matchMedia('(max-width: 700px)').matches);
    let aiModelId = preferLite ? 'lite' : 'standard';
    const aiModelBtns = {};
    const aiModelSeg = el('div', { class: 'anr-btn-row anr-iso-modelseg' });
    [
      ['standard', 'Standard', 'Kim Vocal 2 - cleaner separation, about 85 MB to download once'],
      ['lite', 'Lite (mobile)', 'UVR-MDX-NET 1 - smaller and lighter for phones, about 50 MB. Slightly rougher.'],
    ].forEach(([id, label, title]) => {
      const b = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' + (id === aiModelId ? ' is-active' : ''), title }, label);
      b.addEventListener('click', () => {
        if (aiRunning) return;
        aiModelId = id;
        // Shared dispatch: highlight this tier, record that it runs SEPARATION, and
        // either re-render an open prompt for it or start the job. See pickAction.
        pickAction('separate', b);
      });
      aiModelBtns[id] = b; aiModelSeg.appendChild(b);
    });
    // The denoise action sits in the same row, to the right of the model tiers and
    // divided by a "|". Unlike Standard/Lite (which pick the SEPARATION model), this
    // is its own on-device AI job: DeepFilterNet3, which strips background noise and
    // hiss and shows the result in the same blend view relabelled Clean <-> Noise.
    // Its click handler is wired in the AI block below (with the separator's).
    const denoiseBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm', title: 'DeepFilterNet3 - remove background noise and hiss, about ' + DFN_MODEL.tierMb + ' MB to download once' }, 'denoise');
    aiModelSeg.appendChild(el('span', { class: 'anr-iso-seg-div', 'aria-hidden': 'true' }, '|'));
    aiModelSeg.appendChild(denoiseBtn);
    // Closed by default: the row (separation tiers + the denoise action) is revealed
    // when the user clicks AI separation, then stays open so denoise remains reachable.
    const aiModelRow = el('div', { class: 'anr-iso-modelrow', hidden: true }, [
      el('span', { class: 'anr-iso-modellabel' }, 'AI model'),
      aiModelSeg,
    ]);
    // Standard / Lite / denoise act as one visual radio group: clicking any of them
    // highlights it (black) and drops whichever was selected before.
    function setAiSelection(sel) {
      for (const x of Object.values(aiModelBtns)) x.classList.toggle('is-active', x === sel);
      denoiseBtn.classList.toggle('is-active', sel === denoiseBtn);
    }
    // Two labelled tiers: the EQ isolation tools (presets + manual bands + WAV
    // export) on top, then the on-device AI stem separator as its own block.
    const isoPanel = el('div', { class: 'anr-iso-panel is-hidden' }, [
      el('div', { class: 'anr-iso-sec' }, [
        el('span', { class: 'anr-iso-seclabel' }, 'Isolate'),
        el('div', { class: 'anr-iso-rule' }),
        el('div', { class: 'anr-iso-actions' }, [
          addBtn,
          el('span', { class: 'anr-iso-draghint' }, 'or drag vertically on the spectrogram'),
          exportBtn,
        ]),
        bandList,
      ]),
      el('div', { class: 'anr-iso-sec anr-iso-sec-ai' }, [
        aiLabel,
        aiHelpPanel,
        aiRow,
        aiModelRow,
        aiStatus,
        aiStems,
      ]),
    ]);
    actionsBar.insertAdjacentElement('afterend', isoPanel);

    // --- Web Audio band-stop graph ---
    // Route the <audio> element through the shared player graph once, then (re)build
    // a chain of per-band stops. A band [lo,hi] is rejected by summing a lowpass at
    // lo (keeps everything below) with a highpass at hi (keeps everything above);
    // chaining the stops rejects the union of every band.
    //
    // We tap the SHARED source/boost node from audio-player.js rather than calling
    // createMediaElementSource ourselves: an element gets only one source for its
    // lifetime, so the volume boost and this isolation graph must hang off the same
    // one. audioNode.boostGain is our input tap - we own its OUTPUT (the connection
    // to the filters/destination) but never touch source -> boostGain, so the volume
    // boost keeps working while isolation is active.
    let audioNode = null, filterNodes = [];
    // Channel-solo selection for PLAYBACK (from the Channel picker): null = normal
    // stereo (Mix), else the source channel index to solo. The panel is rebuilt per
    // channel switch, so this is fixed for the panel's life.
    const soloChannel = (opts.soloChannel == null) ? null : (opts.soloChannel | 0);
    function ensureAudioSource() {
      if (audioNode) return audioNode;
      audioNode = playerAudioNode(opts.audioEl);   // { ctx, source, boostGain, limiter } or null
      return audioNode;
    }
    // Merge the disabled bands into disjoint, sorted intervals. Overlaps become one
    // continuous stop instead of several shallow stages that can partly reconstruct
    // each other (why slightly-overlapping bands used to leak).
    function computeMerged() {
      const ivs = isoBands
        .map((b) => [Math.max(10, Math.min(b.lo, b.hi)), Math.min(NYQ - 1, Math.max(b.lo, b.hi))])
        .filter(([lo, hi]) => hi > lo)
        .sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const iv of ivs) {
        const last = merged[merged.length - 1];
        if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
        else merged.push(iv.slice());
      }
      return merged;
    }
    // Build the band-stop chain for `merged` from `input` in context `c`; returns the
    // output node, and pushes every created node into `track` (live teardown only -
    // omitted for one-shot offline renders, whose nodes die with the context). Each
    // interval sums "keep below lo" with "keep above hi". Each side is an 8th-order
    // Butterworth (four biquads with the staggered section Qs below, ~48 dB/octave,
    // -3 dB right at the cutoff) so the reject is deep and near-rectangular - a
    // shallower 24 dB/oct slope left an audible/visible transition band that made a
    // solo look like the whole spectrum survived.
    function buildStops(c, input, merged, track) {
      // Pole Qs for a maximally-flat 8th-order Butterworth, as four cascaded
      // 2nd-order sections: Q_k = 1 / (2 cos((2k+1)pi/16)).
      const BUTTER8_Q = [0.50979558, 0.60134489, 0.89997622, 2.56291540];
      const cascade = (type, freq) => {
        let first = null, prev = null;
        for (const q of BUTTER8_Q) {
          const f = c.createBiquadFilter();
          f.type = type; f.frequency.value = freq; f.Q.value = q;
          if (track) track.push(f);
          if (prev) prev.connect(f); else first = f;
          prev = f;
        }
        return { first, last: prev };
      };
      let prev = input;
      for (const [lo, hi] of merged) {
        const sum = c.createGain();
        if (track) track.push(sum);
        const lp = cascade('lowpass', lo);
        prev.connect(lp.first); lp.last.connect(sum);
        const hp = cascade('highpass', hi);
        prev.connect(hp.first); hp.last.connect(sum);
        prev = sum;
      }
      return prev;
    }
    // Karaoke centre-cancel: mono L-R, which drops anything panned dead-centre -
    // typically the lead vocal. Needs a stereo input; the output is mono.
    function buildKaraoke(c, input, track) {
      const splitter = c.createChannelSplitter(2);
      const inv = c.createGain(); inv.gain.value = -1;
      const sum = c.createGain();
      if (track) track.push(splitter, inv, sum);
      input.connect(splitter);
      splitter.connect(sum, 0);   // L  -> sum
      splitter.connect(inv, 1);   // R  -> invert
      inv.connect(sum);           // -R -> sum
      return sum;
    }
    // Solo one source channel (0 = L, 1 = R, 2 = C, ...): route only that channel to
    // BOTH outputs so you actually hear it, centred. Drives the Channel picker's
    // L/R/etc. buttons - selecting a single channel now plays just that channel.
    function buildChannelSolo(c, input, channel, track) {
      const nch = (opts.audioBuffer && opts.audioBuffer.numberOfChannels) || 2;
      const ch = Math.max(0, Math.min(nch - 1, channel));
      const splitter = c.createChannelSplitter(nch);
      const merger = c.createChannelMerger(2);
      if (track) track.push(splitter, merger);
      input.connect(splitter);
      splitter.connect(merger, ch, 0);   // chosen channel -> L out
      splitter.connect(merger, ch, 1);   // chosen channel -> R out
      return merger;
    }
    function rebuildGraph() {
      // The AI blend plays through its own AudioContext (buildKaraoke/buildStops on
      // that graph), so mirror every isolate change onto it too - BEFORE the
      // audioNode guard, since the blend can be the only thing playing (the file's
      // own source is created lazily on first play and may not exist yet).
      if (blendApplyIso) blendApplyIso();
      // Download WAV only shows once at least one isolate band exists.
      exportBtn.hidden = isoBands.length === 0;
      if (!audioNode) return;
      const c = audioNode.ctx;
      const tap = audioNode.boostGain;   // input tap, after the makeup gain
      const sink = audioNode.limiter;    // everything lands here; limiter -> destination is permanent
      try { tap.disconnect(); } catch (_) {}
      for (const n of filterNodes) { try { n.disconnect(); } catch (_) {} }
      filterNodes = [];
      // Vocal-band deadzone indicator for karaoke mode; positionBands() places it.
      karaokeOverlay.style.display = (isoActive && isoMode === 'karaoke') ? '' : 'none';
      if (isoActive && isoMode === 'karaoke') positionBands();
      // Channel solo first, so any frequency isolation below runs on the soloed
      // channel. When no channel is soloed this is a no-op (stage stays the tap).
      let stage = tap;
      if (soloChannel != null) stage = buildChannelSolo(c, stage, soloChannel, filterNodes);
      if (!isoActive) { stage.connect(sink); return; }
      if (isoMode === 'karaoke') { buildKaraoke(c, stage, filterNodes).connect(sink); return; }
      const merged = computeMerged();
      if (!merged.length) { stage.connect(sink); return; }
      buildStops(c, stage, merged, filterNodes).connect(sink);
    }
    // Route through Web Audio when a channel is soloed now, or when the element is
    // already routed (a prior solo / volume boost / isolate created the shared node) -
    // so this freshly-rebuilt panel owns the correct graph (and a switch back to Mix
    // reverts to plain stereo). Native playback is left untouched otherwise.
    if (soloChannel != null || (opts.audioEl && opts.audioEl._anrAudioNode)) {
      ensureAudioSource();
      rebuildGraph();
    }

    // --- band model ---
    // Any manual band edit (not one made while applying a preset) drops the active
    // preset highlight, since the config no longer matches that preset.
    function clearPresetHighlight() {
      for (const k in presetBtns) presetBtns[k].classList.remove('is-active');
      activePreset = null;
    }
    function removeBand(b) {
      const i = isoBands.indexOf(b);
      if (i < 0) return;
      isoBands.splice(i, 1);
      if (b.el) b.el.remove();
      if (b.row) b.row.remove();
      if (!applyingPreset) clearPresetHighlight();
      rebuildGraph();
    }
    function addBandRow(b) {
      const mk = (val) => el('input', { type: 'number', class: 'anr-iso-num', min: '1', max: String(Math.round(NYQ)), step: '1', value: String(Math.round(val)) });
      const fromIn = mk(b.lo), toIn = mk(b.hi);
      const rm = el('button', { type: 'button', class: 'anr-btn anr-btn-sm', title: 'Remove band' }, '×');
      const onEdit = () => { b.lo = clampHz(fromIn.value); b.hi = clampHz(toIn.value); positionBands(); clearPresetHighlight(); rebuildGraph(); };
      fromIn.addEventListener('change', onEdit);
      toIn.addEventListener('change', onEdit);
      rm.addEventListener('click', () => removeBand(b));
      b.fromIn = fromIn; b.toIn = toIn;
      b.row = el('div', { class: 'anr-iso-band' }, [
        fromIn, el('span', { class: 'anr-iso-sep' }, 'to'), toIn,
        el('span', { class: 'anr-iso-unit' }, 'Hz'), rm,
      ]);
      bandList.appendChild(b.row);
    }
    function addBand(lo, hi) {
      lo = clampHz(lo); hi = clampHz(hi);
      if (Math.abs(hi - lo) < 1) return;
      // Editing bands is a band-stop operation, so any manual add leaves karaoke mode.
      if (!applyingPreset) isoMode = 'bands';
      const b = { lo: Math.min(lo, hi), hi: Math.max(lo, hi), el: el('div', { class: 'anr-spec-band' }) };
      bandLayer.appendChild(b.el);
      isoBands.push(b);
      addBandRow(b);
      positionBands();
      rebuildGraph();
    }
    addBtn.addEventListener('click', () => { addBand(Math.round(fracToFreq(0.42)), Math.round(fracToFreq(0.6))); clearPresetHighlight(); });

    // --- drag-to-select a band on the spectrogram (isolate mode only) ---
    const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
    let selEl = null, selPid = null, selStart = 0;
    const fracAt = (clientY) => {
      const r = canvasWrap.getBoundingClientRect();
      return clamp01(1 - (clientY - r.top) / r.height);
    };
    const drawSel = (f0, f1) => {
      if (!selEl) return;
      const hi = Math.max(f0, f1), lo = Math.min(f0, f1);
      selEl.style.top = ((1 - hi) * 100) + '%';
      selEl.style.height = ((hi - lo) * 100) + '%';
    };
    canvasWrap.addEventListener('pointerdown', (e) => {
      if (!isoActive || e.button !== 0) return;
      // Leave the playhead to its own grab-scrub handler so it stays draggable here.
      if (e.target.closest && e.target.closest('.anr-playhead')) return;
      selPid = e.pointerId;
      selStart = fracAt(e.clientY);
      selEl = el('div', { class: 'anr-spec-bandsel' });
      bandLayer.appendChild(selEl);
      drawSel(selStart, selStart);
      try { canvasWrap.setPointerCapture(selPid); } catch (_) {}
      e.preventDefault(); e.stopPropagation();
    });
    canvasWrap.addEventListener('pointermove', (e) => {
      if (selPid === null || e.pointerId !== selPid) return;
      drawSel(selStart, fracAt(e.clientY));
      e.preventDefault();
    });
    const endSel = (e) => {
      if (selPid === null || (e && e.pointerId !== selPid)) return;
      const end = fracAt(e.clientY);
      try { canvasWrap.releasePointerCapture(selPid); } catch (_) {}
      selPid = null;
      if (selEl) { selEl.remove(); selEl = null; }
      if (Math.abs(end - selStart) > 0.01) {
        addBand(fracToFreq(Math.min(selStart, end)), fracToFreq(Math.max(selStart, end)));
        clearPresetHighlight();
      } else if (e) {
        // A tap with no vertical drag: seek to the clicked time, like a normal click.
        const r = canvas.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        if (blendActive && blendSeek) { blendSeek(frac); return; }  // blend owns the transport - move its playhead
        opts.audioEl.currentTime = frac * (opts.audioEl.duration || (samples.length / sampleRate));
      }
    };
    canvasWrap.addEventListener('pointerup', endSel);
    canvasWrap.addEventListener('pointercancel', endSel);

    // --- toggle ---
    function setIsoActive(on) {
      isoActive = on;
      isoBtn.classList.toggle('is-active', isoActive);
      isoPanel.classList.toggle('is-hidden', !isoActive);
      bandLayer.style.display = isoActive ? '' : 'none';
      canvasWrap.classList.toggle('anr-spec-isolating', isoActive);
      if (isoActive) ensureAudioSource();
      rebuildGraph();
    }
    isoBtn.addEventListener('click', () => setIsoActive(!isoActive));

    // --- presets: rough one-tap solos, like a stem player ---
    // EQ presets SOLO a range by cutting its complement (reusing the band-stop
    // graph): "keep 300-3400" is just "cut 1-300 and 3400-Nyquist". They only
    // approximate - instruments overlap in frequency - but need no downloads.
    // "Remove vocals" is the karaoke centre-cancel and needs a stereo source.
    const NYQi = Math.round(NYQ);
    const stereo = !!(opts.audioBuffer && opts.audioBuffer.numberOfChannels >= 2);
    function soloRange(lo, hi) {
      applyingPreset = true;
      isoMode = 'bands';
      for (const b of isoBands.slice()) removeBand(b);
      if (lo > 1) addBand(1, lo);
      if (hi < NYQi) addBand(hi, NYQi);
      applyingPreset = false;
    }
    // Cut a single mid band (keeping the lows AND highs) - the inverse of soloRange,
    // for the scooped "Hollow" preset.
    function cutRange(lo, hi) {
      applyingPreset = true;
      isoMode = 'bands';
      for (const b of isoBands.slice()) removeBand(b);
      addBand(lo, hi);
      applyingPreset = false;
    }
    function setKaraoke() {
      applyingPreset = true;
      for (const b of isoBands.slice()) removeBand(b);
      applyingPreset = false;
      isoMode = 'karaoke';
      rebuildGraph();
    }
    const PRESETS = [
      // One-tap character effects: keep or cut ranges of pitch to colour the track.
      { key: 'underwater', label: 'Underwater', run: () => soloRange(1, 400) },      // muffled low-pass
      { key: 'radio',      label: 'Radio',      run: () => soloRange(500, 3400) },   // tinny band-pass
      { key: 'hollow',     label: 'Hollow',     run: () => cutRange(500, 3000) },    // scooped mid notch
    ];
    // Drop any preset/bands but LEAVE isolation on (a cleared slate you can keep
    // editing). Shared by the Clear button and the toggle-off path. The main
    // Isolate toggle is what actually switches isolation off.
    function clearIso() {
      for (const b of isoBands.slice()) removeBand(b);
      isoMode = 'bands';
      clearPresetHighlight();
      rebuildGraph();
    }
    // The single Clear (drops presets/bands but keeps isolation on). Appended to
    // the AI row (after the presets) with margin-left:auto so it sits at the far
    // right, clear of both the AI button and the presets.
    const presetClear = el('button', { type: 'button', class: 'anr-btn anr-btn-sm anr-iso-preset-clear' }, 'Clear');
    presetClear.addEventListener('click', clearIso);
    for (const p of PRESETS) {
      if (p.stereoOnly && !stereo) continue;
      const b = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, p.label);
      presetBtns[p.key] = b;
      b.addEventListener('click', () => {
        // Clicking the already-active preset toggles its effect back off.
        if (isoActive && activePreset === p.key) { clearIso(); return; }
        if (!isoActive) setIsoActive(true);
        p.run();
        clearPresetHighlight();
        b.classList.add('is-active');
        activePreset = p.key;
      });
      presetBar.appendChild(b);
    }
    aiRow.appendChild(presetClear);

    // --- export the current isolate result as a WAV ---
    // Re-render the whole clip offline through the SAME processing that's live now,
    // from the original decoded buffer (mono analysis signal as a fallback), so the
    // download is exactly what you hear.
    function sourceBuffer() {
      if (opts.audioBuffer) return opts.audioBuffer;
      const b = ctx().createBuffer(1, samples.length, sampleRate);
      if (b.copyToChannel) b.copyToChannel(samples, 0); else b.getChannelData(0).set(samples);
      return b;
    }
    async function renderIsolated() {
      const buffer = sourceBuffer();
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const karaoke = isoActive && isoMode === 'karaoke' && buffer.numberOfChannels >= 2;
      const off = new OAC(karaoke ? 1 : buffer.numberOfChannels, buffer.length, buffer.sampleRate);
      const srcNode = off.createBufferSource();
      srcNode.buffer = buffer;
      let out = srcNode;
      if (karaoke) out = buildKaraoke(off, srcNode);
      else if (isoActive && isoMode === 'bands') {
        const merged = computeMerged();
        if (merged.length) out = buildStops(off, srcNode, merged);
      }
      out.connect(off.destination);
      srcNode.start();
      return off.startRendering();
    }
    let exporting = false;
    exportBtn.addEventListener('click', async () => {
      if (exporting) return;
      exporting = true;
      const orig = exportBtn.textContent;
      exportBtn.disabled = true; exportBtn.textContent = 'Rendering…';
      try {
        const blob = encodeWav(await renderIsolated());
        downloadBlob((opts.basename || 'audio') + '_isolated.wav', blob);
        exportBtn.textContent = orig;
      } catch (_) {
        exportBtn.textContent = 'Export failed';
        setTimeout(() => { exportBtn.textContent = orig; }, 1400);
      }
      exportBtn.disabled = false; exporting = false;
    });

    // --- AI vocal separation (MDX-Net, on-device) ---
    // Unlike the EQ presets, this runs a real source-separation model in a worker
    // and produces two playable/downloadable stems. Everything heavy (runtime +
    // model) is lazy-loaded on first click and cached for offline use.
    let aiRunning = false, aiUrls = [], blendCleanup = null;
    // Display config per AI job. Both jobs produce two stems shown in the same
    // blend view; only the labels/keys differ. The result object always carries the
    // left stem as result.vocals and the right as result.instrumental (denoise maps
    // clean -> vocals, noise -> instrumental when it runs), so the rendering code is
    // shared and only these strings change.
    const STEM_CFGS = {
      separate: { leftKey: 'vocals', leftLabel: 'Vocals', rightKey: 'instrumental', rightLabel: 'Instrumental', toward: ['vocals', 'instrumental'], aria: 'Blend vocals to instrumental' },
      denoise: { leftKey: 'clean', leftLabel: 'Clean', rightKey: 'noise', rightLabel: 'Noise', toward: ['clean', 'noise'], aria: 'Blend clean to noise' },
    };
    // Separate button is a toggle: clicking it reveals the model picker and opens the
    // model prompt (download-or-start), and clicking it again once a separation is
    // showing clears it. aiOn tracks whether results are showing. aiConfirming marks
    // the prompt open; aiConfirmRender re-renders it for the current model (called by
    // the picker so switching Standard/Lite updates the prompt in real time).
    let aiOn = false, aiConfirming = false, aiConfirmRender = null;
    // Dismiss an open confirm prompt from outside (e.g. the AI separation button
    // closing the panel). Resolves the pending confirmDownload() as cancelled so
    // startStems returns cleanly instead of leaving its await hanging.
    let aiConfirmCancel = null;
    // Which AI job is currently showing: null | 'separate' | 'denoise'. Only one
    // blend can own the spectrogram at a time, so starting one clears the other.
    let activeKind = null;
    // Which job the next Start will run: 'separate' (Standard/Lite) or 'denoise'.
    // Standard, Lite and denoise all funnel through pickAction so they act as one
    // radio group even while the confirm prompt is up: clicking any of them
    // highlights it and, if a prompt is already open, re-renders THAT prompt for
    // the new choice (title, blurb, size, button track it live) instead of being
    // ignored. Ignoring was the old bug - denoise was dropped whenever a separation
    // prompt was open, so its confirm box never appeared. With no prompt open it
    // just starts the job.
    let pendingKind = 'separate';
    function pickAction(kind, btn) {
      if (aiRunning) return;
      pendingKind = kind;
      setAiSelection(btn);
      if (aiConfirming) { if (aiConfirmRender) aiConfirmRender(); return; }
      startStems();
    }
    function revokeAiUrls() { for (const u of aiUrls) { try { URL.revokeObjectURL(u); } catch (_) {} } aiUrls = []; }

    function stemBuffer(channels, sr) {
      const c = ctx();
      const b = c.createBuffer(channels.length, channels[0].length, sr);
      for (let i = 0; i < channels.length; i++) {
        if (b.copyToChannel) b.copyToChannel(channels[i], i); else b.getChannelData(i).set(channels[i]);
      }
      return b;
    }
    function stemMono(channels) {
      if (channels.length === 1) return channels[0];
      const n = channels[0].length, out = new Float32Array(n), k = 1 / channels.length;
      for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] * k;
      return out;
    }
    // The blend playground: one horizontal slider that fades vocals <-> original
    // <-> instrumental, with a spectrogram that morphs in real time. The trick
    // (see computeStftComplex / combineStftToDb) is to analyse both stems once
    // and only RECOMBINE precomputed complex bins per slider move - no re-FFT -
    // so it stays truthful (exact magnitude of the blended audio) yet cheap.
    function gainsFor(s) { return { a: 1 - Math.max(0, s), b: 1 + Math.min(0, s) }; }
    function renderBlend(result, resume, cfg) {
      cfg = cfg || STEM_CFGS.separate;
      const sr = result.sampleRate;
      const L = result.vocals[0].length;
      const dur = L / sr;
      // Capped analysis grid. Match the main view's frequency resolution (up to
      // 1024 bins) so the replacement doesn't look softer, but bound the frame
      // count (widen the hop for long clips) so each per-move recombine stays
      // ~1.5M cells - fast enough (no per-cell sqrt) to redraw while dragging.
      if (L < 4096) return null;   // too short to be worth a blend view
      // The DRAG path recombines precomputed complex bins (cheap, no re-FFT) on a
      // frame-capped grid, so live morphing stays smooth; fftSize is capped for
      // that. The SETTLED path (below) re-runs the real spectrogram pipeline at the
      // full current FFT/window/mode, so the resting view honours those controls
      // just like the file's own spectrogram - but bounded to the canvas width so a
      // long track's re-FFT can't freeze the main thread.
      const FRAME_CAP = 1500;
      function dragStftOpts() {
        const fftSize = Math.min((state.fftSize | 0) || 2048, 2048);
        const hop = Math.max(Math.floor(fftSize / 4), Math.ceil((L - fftSize) / (FRAME_CAP - 1)));
        return { fftSize, hopSize: hop, window: state.winName };
      }
      // Mono stems, mixed on demand for the settled (full-pipeline) spectrogram.
      const vMono = stemMono(result.vocals), iMono = stemMono(result.instrumental);
      function mixStems(a, b) {
        const m = new Float32Array(L);
        for (let i = 0; i < L; i++) m[i] = a * vMono[i] + b * iMono[i];
        return m;
      }

      // Feed the Stereo analysis card the current blend mix (stems are always stereo
      // - see mdx-separate). Correlation/mid/side are accumulated allocation-free over
      // a strided subsample (<=40k points, plenty for these metrics), which doubles as
      // the vectorscope's L/R buffer - so a slider drag stays cheap on long tracks.
      function pushBlendStereo() {
        const sink = opts.stereoSink;
        if (!sink || !sink.update) return;   // mono file: no stereo card to update
        const v0 = result.vocals[0], v1 = result.vocals[1] || result.vocals[0];
        const i0 = result.instrumental[0], i1 = result.instrumental[1] || result.instrumental[0];
        const n = Math.min(v0.length, v1.length, i0.length, i1.length);
        if (!n) return;
        const { a, b } = gainsFor(sliderS());
        const stride = Math.max(1, Math.floor(n / 40000));
        const sL = new Float32Array(Math.ceil(n / stride));
        const sR = new Float32Array(sL.length);
        let sumLR = 0, sumLL = 0, sumRR = 0, sumMid = 0, sumSide = 0, cnt = 0, si = 0;
        for (let i = 0; i < n; i += stride) {
          const l = a * v0[i] + b * i0[i];
          const r = a * v1[i] + b * i1[i];
          sL[si] = l; sR[si] = r; si++;
          sumLR += l * r; sumLL += l * l; sumRR += r * r;
          const mid = (l + r) * 0.5, side = (l - r) * 0.5;
          sumMid += mid * mid; sumSide += side * side; cnt++;
        }
        const denom = Math.sqrt(sumLL * sumRR);
        const correlation = denom > 1e-12 ? sumLR / denom : 0;
        sink.update({
          correlation,
          width: 1 - Math.abs(correlation),
          midLevel: Math.sqrt(sumMid / cnt),
          sideLevel: Math.sqrt(sumSide / cnt),
        }, sL.subarray(0, si), sR.subarray(0, si));
      }

      // Slider: -100 (vocals) .. 0 (normal) .. +100 (instrumental). A centre tick
      // marks the middle; a click within the detent snaps the thumb exactly there
      // (same idiom as the sensitivity slider's 100% slit).
      const slider = el('input', {
        type: 'range', min: '-100', max: '100', value: '0', step: '1',
        class: 'anr-range anr-blend-slider', 'aria-label': cfg.aria,
      });
      const midTick = el('div', { class: 'anr-range-tick', style: 'left:50%', 'aria-hidden': 'true' });
      const sliderWrap = el('div', { class: 'anr-range-wrap anr-blend-wrap' }, [slider, midTick]);
      const sliderS = () => { let v = Number(slider.value); if (Math.abs(v) <= 6) v = 0; return v / 100; };
      // Light the centre slit while the pointer is over its snap zone (the tick is
      // pointer-events:none so it can't :hover itself, and a real hitbox would block
      // grabbing the thumb - so drive a proximity class from pointer movement).
      sliderWrap.addEventListener('pointermove', (e) => {
        const r = slider.getBoundingClientRect();
        const near = Math.abs(e.clientX - (r.left + r.width / 2)) <= Math.max(6, r.width * 0.03);
        sliderWrap.classList.toggle('is-mid-hover', near);
      });
      sliderWrap.addEventListener('pointerleave', () => sliderWrap.classList.remove('is-mid-hover'));

      const playBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm', disabled: true }, 'Play');
      const timeEl = el('span', { class: 'anr-blend-time' }, fmtClock(0) + ' / ' + fmtClock(dur));
      const tagEl = el('span', { class: 'anr-blend-tag' }, 'Analysing…');

      // --- audio: two stems through per-stem gains into a shared-volume master,
      // so dragging the slider crossfades what you hear, in sync. ---
      const ac = ctx();
      // The playback AudioBuffers are large; only build them if the user presses
      // Play (dragging the slider / morphing the spectrogram needs none of this).
      let vBuf = null, iBuf = null;
      function ensureBufs() { if (!vBuf) { vBuf = stemBuffer(result.vocals, sr); iBuf = stemBuffer(result.instrumental, sr); } }
      const master = ac.createGain(); master.gain.value = sharedVolume();
      const gV = ac.createGain(), gI = ac.createGain();
      gV.connect(master); gI.connect(master);
      const unsubVol = onSharedVolume((level) => { master.gain.value = level; });

      // Route master -> [isolate band-stop / karaoke / straight] -> destination on
      // the blend's OWN context, rebuilt from the same isoBands/isoMode the file
      // player uses. Nodes can't be shared across contexts (the file graph lives on
      // audio-player's shared context), so the band-stop is rebuilt here in parallel
      // - without it the separated stems bypassed the Isolate cuts entirely.
      let blendFilters = [];
      function applyBlendIso() {
        try { master.disconnect(); } catch (_) {}
        for (const n of blendFilters) { try { n.disconnect(); } catch (_) {} }
        blendFilters = [];
        if (!isoActive) { master.connect(ac.destination); return; }
        if (isoMode === 'karaoke') { buildKaraoke(ac, master, blendFilters).connect(ac.destination); return; }
        const merged = computeMerged();
        if (!merged.length) { master.connect(ac.destination); return; }
        buildStops(ac, master, merged, blendFilters).connect(ac.destination);
      }
      blendApplyIso = applyBlendIso;
      applyBlendIso();   // wire it up now (straight through unless isolate is already on)
      let vSrc = null, iSrc = null, playing = false, startCtx = 0, offset = 0, raf = 0, armed = false;

      function applyGains(ramp) {
        const { a, b } = gainsFor(sliderS()); const t = ac.currentTime;
        if (ramp) { gV.gain.setTargetAtTime(a, t, 0.02); gI.gain.setTargetAtTime(b, t, 0.02); }
        else { gV.gain.value = a; gI.gain.value = b; }
      }
      function stopSources() {
        for (const s of [vSrc, iSrc]) { if (s) { try { s.onended = null; s.stop(); } catch (_) {} } }
        vSrc = iSrc = null;
      }
      function startAt(sec) {
        ensureBufs();
        stopSources();
        vSrc = ac.createBufferSource(); vSrc.buffer = vBuf; vSrc.connect(gV);
        iSrc = ac.createBufferSource(); iSrc.buffer = iBuf; iSrc.connect(gI);
        applyGains(false);
        vSrc.start(0, sec); iSrc.start(0, sec);
        startCtx = ac.currentTime - sec;
        vSrc.onended = () => { if (playing) { pause(); offset = 0; moveHead(); } };
      }
      function pos() { return playing ? Math.min(dur, ac.currentTime - startCtx) : offset; }
      // Drive the MAIN spectrogram's playhead, this row's readout, AND the
      // under-spectrogram transport (via the controller it's delegated to) from the
      // single blend clock - so every scrubber moves together.
      function moveHead(animate) {
        const frac = dur ? pos() / dur : 0;
        // Snap (no ease) while playing OR actively scrubbing, so the line tracks the
        // pointer with no lag; only settle with a transition on a discrete seek.
        const anim = animate == null ? !playing : animate;
        if (driveSpecLine) driveSpecLine(frac, playing, anim);
        timeEl.textContent = fmtClock(pos()) + ' / ' + fmtClock(dur);
        if (blendActive && specTransport && specTransport._anrTransport) {
          specTransport._anrTransport.update(frac, pos(), dur, playing);
        }
      }
      function play() {
        if (playing || !armed) return;
        if (opts.audioEl && !opts.audioEl.paused) opts.audioEl.pause();  // one transport at a time
        if (ac.state === 'suspended' && ac.resume) ac.resume();
        playing = true;
        startAt(Math.max(0, Math.min(offset, dur - 0.02)));
        playBtn.textContent = 'Pause'; playBtn.classList.add('is-active'); tick();
      }
      function pause() {
        if (!playing) return;
        offset = pos(); playing = false; stopSources();
        playBtn.textContent = 'Play'; playBtn.classList.remove('is-active');
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        moveHead();
      }
      function seekFrac(frac) {
        offset = Math.max(0, Math.min(dur, frac * dur));
        if (playing) startAt(Math.min(offset, dur - 0.02));
        moveHead(false);   // snap to the pointer, no trailing ease
      }
      function tick() { moveHead(); if (playing) raf = requestAnimationFrame(tick); }

      playBtn.addEventListener('click', () => (playing ? pause() : play()));

      // --- spectrogram: once analysed, the blend OWNS the main canvas - it stays
      // the file's own spectrogram until separation finishes, then this replaces
      // it and every slider move recombines both stems into it (rAF-throttled). ---
      let A = null, B = null, out = null, pend = false;
      // Fast path (used while dragging): recombine the precomputed complex bins.
      function paintDrag() {
        pend = false;
        if (!A) return;
        const { a, b } = gainsFor(sliderS());
        blendSpec = combineStftToDb(A, B, a, b, out);
        renderOnly();
        pushBlendStereo();   // keep the stereo readout in step with the blend (same rAF)
      }
      function requestPaint() { if (!pend) { pend = true; requestAnimationFrame(paintDrag); } }
      // Settled path (arm, slider release, control change): run the REAL spectrogram
      // pipeline on the recombined audio at the current FFT / window / mode, so the
      // blend reacts to those controls exactly like the file's own spectrogram.
      function paintSettled() {
        const { a, b } = gainsFor(sliderS());
        const mix = mixStems(a, b);
        // renderSpectrogram samples ONE column per output pixel, so computing more
        // time frames than the canvas is wide is pure wasted STFT work - and doing
        // the full-length mix at hop = fftSize/4 froze the main thread for hundreds
        // of ms on long tracks (the lag right after changing FFT / window / mode, or
        // releasing the slider). Keep the full fftSize (frequency detail), window and
        // mode; only widen the hop so the frame count tracks the display width, the
        // same trick the drag grid already uses. The resting image is unchanged.
        const fftSize = (state.fftSize | 0) || 2048;
        const targetFrames = Math.max(FRAME_CAP, canvas.width || FRAME_CAP);
        const hopSize = Math.max(Math.floor(fftSize / 4), Math.ceil((L - fftSize) / Math.max(1, targetFrames - 1)));
        const params = { fftSize, hopSize, window: state.winName };
        blendSpec = state.mode === 'reassigned'
          ? computeReassignedSpectrogram(mix, sr, params)
          : computeSpectrogram(mix, sr, params);
        renderOnly();
      }
      // Re-run the drag-path STFTs (new window / capped fftSize) and repaint settled.
      // Wired to blendReanalyse so the FFT/window/mode controls drive it while active.
      function reanalyse() {
        const o = dragStftOpts();
        A = computeStftComplex(vMono, sr, o);
        B = computeStftComplex(iMono, sr, o);
        out = new Float32Array(A.frames * A.bins);
        paintSettled();
      }
      function updateTag() {
        const s = sliderS();
        tagEl.textContent = s === 0 ? 'Normal mix' : s < 0
          ? Math.round(-s * 100) + '% toward ' + cfg.toward[0]
          : Math.round(s * 100) + '% toward ' + cfg.toward[1];
      }
      slider.addEventListener('input', () => {
        const v = Number(slider.value);
        if (Math.abs(v) <= 6 && v !== 0) slider.value = '0';   // click detent -> exact centre
        updateTag(); applyGains(true); requestPaint();   // morph the picture + crossfade the audio live
      });
      // On release, snap the audio gain and paint one final recombine at the exact
      // resting value - still the cheap path, NO re-FFT. The full-pipeline re-FFT
      // (paintSettled) is reserved for FFT / window / mode changes only (reanalyse).
      slider.addEventListener('change', () => { applyGains(false); requestPaint(); });

      const block = el('div', { class: 'anr-blend' }, [
        el('div', { class: 'anr-blend-head' }, [
          el('span', { class: 'anr-iso-stem-label' }, 'Blend'),
          tagEl,
        ]),
        el('div', { class: 'anr-blend-sliderrow' }, [
          el('span', { class: 'anr-blend-end' }, cfg.leftLabel),
          sliderWrap,
          el('span', { class: 'anr-blend-end' }, cfg.rightLabel),
        ]),
      ]);

      // Heavy analysis deferred (two rAFs) so the block paints first, then the
      // spectrogram computes, the controls arm, and the blend REPLACES the file's
      // spectrogram on the main canvas (at centre = the normal mix).
      requestAnimationFrame(() => requestAnimationFrame(() => {
        playBtn.disabled = false; armed = true;
        // The blend now owns the spectrogram AND the under-spectrogram transport:
        // its play button plays the separated blend and every scrubber follows.
        blendActive = true; blendSeek = seekFrac; blendPause = pause;
        blendReanalyse = reanalyse;   // let FFT/window/mode changes re-run the blend view
        reanalyse();   // paint the main spectrogram at the settled (normal-mix) blend
        if (specTransport && specTransport._anrTransport) {
          specTransport._anrTransport.attach({ toggle: () => (playing ? pause() : play()), seek: seekFrac });
        }
        updateTag();   // Analysing… -> Normal mix
        pushBlendStereo();   // point the stereo readout at the (normal-mix) blend
        // If the track was still playing when the model finished, pick the blend up
        // from the same spot (and keep playing) instead of resetting to 0:00.
        if (resume && dur) { offset = Math.max(0, Math.min(dur, resume.at)); play(); }
        else moveHead();   // sync the under-spectrogram transport to the blend clock (0:00)
      }));

      blendCleanup = () => {
        pause();
        blendActive = false; blendSeek = null; blendPause = null;
        blendApplyIso = null; blendReanalyse = null;
        blendSpec = null;
        if (opts.stereoSink && opts.stereoSink.reset) { try { opts.stereoSink.reset(); } catch (_) {} }   // revert the stereo readout to the file
        if (specTransport && specTransport._anrTransport) { try { specTransport._anrTransport.detach(); } catch (_) {} }
        try { renderOnly(); } catch (_) {}   // restore the file's own spectrogram
        try { unsubVol(); } catch (_) {}
        for (const n of blendFilters) { try { n.disconnect(); } catch (_) {} }
        blendFilters = [];
        for (const n of [gV, gI, master]) { try { n.disconnect(); } catch (_) {} }
        armed = false; A = B = out = null; vBuf = iBuf = null;
      };
      return block;
    }

    function renderStems(result, cfg) {
      cfg = cfg || STEM_CFGS.separate;
      revokeAiUrls();
      // If the track was playing while the model ran, note where the playhead was so
      // the new blend can resume from there (rather than jumping back to 0:00).
      let resume = null;
      if (opts.audioEl && !opts.audioEl.paused && isFinite(opts.audioEl.currentTime)) {
        resume = { at: opts.audioEl.currentTime };
      }
      // Separation finished: stop whatever is currently playing (the file's own
      // player and any prior blend) so the new blend view starts from silence
      // instead of the original track carrying on underneath it.
      if (opts.audioEl) { try { opts.audioEl.pause(); } catch (_) {} }
      if (blendCleanup) { try { blendCleanup(); } catch (_) {} blendCleanup = null; }
      // Separation done: the results below replace the pitch, so drop the
      // description ([?] + panel). The Separate button stays visible so the run
      // can be repeated (it is re-enabled and relabelled by the click handler).
      aiHelpBtn.hidden = true;
      aiHelpPanel.classList.add('is-hidden');
      aiStems.textContent = '';
      blendMount.textContent = '';
      const blend = renderBlend(result, resume, cfg);
      if (blend) blendMount.appendChild(blend);
      const base = opts.basename || 'audio';
      const dur = result.vocals[0].length / result.sampleRate;
      const stems = [
        { key: cfg.leftKey, label: cfg.leftLabel, channels: result.vocals },
        { key: cfg.rightKey, label: cfg.rightLabel, channels: result.instrumental },
      ];
      for (const s of stems) {
        const blob = encodeWav(stemBuffer(s.channels, result.sampleRate));
        const url = URL.createObjectURL(blob);
        aiUrls.push(url);
        // Custom player (sharp-cornered, shared volume popup) instead of the native
        // browser pill, so the stems match the rest of the site. The <audio> is the
        // hidden playback source the player drives.
        const audioEl = el('audio', { src: url, preload: 'metadata', style: 'display:none;' });
        const player = makePlayer(audioEl, dur);
        const specBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, 'Analyse');
        const dl = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, 'Download WAV');
        dl.addEventListener('click', () => downloadBlob(base + '_' + s.key + '.wav', blob));
        // Lazy spectrogram of this stem, drawn with the main panel's current
        // FFT / scale / colour settings so it reads the same as the view above.
        const specWrap = el('div', { class: 'anr-iso-stem-spec', hidden: true });
        let specDrawn = false;
        specBtn.addEventListener('click', () => {
          if (!specWrap.hidden) { specWrap.hidden = true; specBtn.classList.remove('is-active'); return; }
          specWrap.hidden = false; specBtn.classList.add('is-active');
          if (specDrawn) return;
          specDrawn = true;
          specBtn.disabled = true;
          const t = specBtn.textContent; specBtn.textContent = 'Rendering…';
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const spec = computeSpectrogram(stemMono(s.channels), result.sampleRate, {
              fftSize: state.fftSize, hopSize: Math.floor(state.fftSize / 4), window: state.winName,
            });
            const cv = el('canvas', { class: 'anr-iso-stem-canvas' });
            cv.width = Math.min(1600, Math.max(320, spec.frames));
            cv.height = 200;
            renderSpectrogram(cv, spec, { scale: state.scale, colormap: state.cmap, dbFloor: state.dbFloor, minHz: state.scale === 'log' ? SPEC_LOG_MIN : 0 });
            specWrap.appendChild(cv);
            specBtn.textContent = t; specBtn.disabled = false;
          }));
        });
        aiStems.appendChild(el('div', { class: 'anr-iso-stem' }, [
          el('div', { class: 'anr-iso-stem-head' }, [
            el('span', { class: 'anr-iso-stem-label' }, s.label),
            audioEl, player, specBtn, dl,
          ]),
          specWrap,
        ]));
      }
    }
    // Reuse the app's standard ASCII progress bar (asciiBar) rather than a bespoke one.
    const aiBar = asciiBar({ fit: true });
    function setAiStatus(text, frac) {
      aiStatus.hidden = false; aiStatus.textContent = '';
      aiStatus.appendChild(el('span', { class: 'anr-iso-aimsg' }, text));
      if (typeof frac === 'number') { aiStatus.appendChild(aiBar); aiBar.set(frac); }
    }
    // One-off size prompt, skipped once the chosen model is already cached. The
    // model picker stays live while this is up (aiConfirmSizeEl), so the user can
    // switch tier here and the size - and what actually downloads - follows.
    // The model prompt shown on every Separate click. When the chosen model still
    // needs fetching it is a download notice (size shown, "Download and continue");
    // once it is already downloaded it is a plain start confirmation ("Start
    // separation"). Either way the model picker stays live above it (aiConfirmSizeEl),
    // so switching tier here updates the size and what actually runs.
    // `kind` selects the job: 'separate' (MDX, live tier picker) or 'denoise'
    // (DeepFilterNet3, a single fixed model). The separation prompt tracks the
    // Standard/Lite pick live; the denoise prompt is static.
    function confirmDownload() {
      return new Promise((resolve) => {
        aiConfirming = true;
        // The prompt drops the description ([?] + panel) while it's up, but the
        // buttons and the model picker stay visible.
        aiHelpBtn.hidden = true; aiHelpPanel.classList.add('is-hidden');
        aiStatus.hidden = false; aiStatus.textContent = '';
        const box = el('div', { class: 'anr-iso-confirm' });
        const yes = el('button', { type: 'button', class: 'anr-btn anr-btn-sm anr-iso-confirm-yes' }, '');
        const no = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, 'Cancel');
        const done = (v) => { aiConfirming = false; aiConfirmRender = null; aiConfirmCancel = null; aiStatus.textContent = ''; aiStatus.hidden = true; aiHelpBtn.hidden = false; resolve(v); };
        yes.addEventListener('click', () => done(true));
        no.addEventListener('click', () => done(false));
        // Rebuild the box for the current selection (pendingKind). Called again by
        // pickAction on every Standard/Lite/denoise switch, so the title, blurb, size
        // and button track the choice live - including switching between separation
        // and denoise.
        async function render() {
          box.textContent = '';
          const kind = pendingKind;
          if (kind === 'denoise') {
            const model = DFN_MODEL;
            const needsDownload = !(await modelReady(model, 'anr-dfn-ready-'));
            yes.textContent = needsDownload ? 'Download and continue' : 'Start denoise';
            const sizeEl = el('span', { class: 'anr-iso-confirm-size' }, 'about ' + model.tierMb + ' MB');
            const body = needsDownload
              ? el('p', {}, ['The first run fetches the denoise model (', el('strong', {}, model.name), ' - ', model.blurb, ') and its runtime (', sizeEl, '), then keeps them for offline use. Everything runs on your device - nothing is uploaded.'])
              : el('p', {}, ['Removes background noise and hiss from this track with ', el('strong', {}, model.name), ', keeping the full sound. Everything runs on your device - nothing is uploaded.']);
            box.appendChild(el('div', { class: 'anr-iso-confirm-title' }, needsDownload ? 'Download denoise model' : 'Denoise'));
            box.appendChild(body);
          } else {
            const model = MDX_MODELS[aiModelId] || MDX_MODELS.standard;
            const tier = model.label || 'Standard';
            const blurb = model.blurb || '';
            const needsDownload = !(await modelReady(model, 'anr-mdx-ready-'));
            yes.textContent = needsDownload ? 'Download and continue' : 'Start separation';
            const sizeEl = el('span', { class: 'anr-iso-confirm-size' }, 'about ' + model.tierMb + ' MB');
            const body = needsDownload
              ? el('p', {}, ['The first run fetches the ', el('strong', {}, tier), ' model (', blurb, ') and its runtime (', sizeEl, '), then keeps them for offline use. Everything runs on your device - nothing is uploaded.'])
              : el('p', {}, ['Splits this track into separate vocal and instrumental parts with the ', el('strong', {}, tier), ' model - ', blurb, '. Everything runs on your device - nothing is uploaded.']);
            box.appendChild(el('div', { class: 'anr-iso-confirm-title' }, needsDownload ? 'Download AI model' : 'Separate vocals'));
            box.appendChild(body);
          }
          box.appendChild(el('div', { class: 'anr-iso-confirm-btns' }, [yes, no]));
        }
        aiConfirmRender = render;
        aiConfirmCancel = () => done(false);
        aiStatus.appendChild(box);
        render();
      });
    }
    // Toggle OFF: tear down whatever job is showing and return to the original track.
    function clearStems() {
      revokeAiUrls();
      if (blendCleanup) { try { blendCleanup(); } catch (_) {} blendCleanup = null; }
      aiStems.textContent = '';
      blendMount.textContent = '';
      aiStatus.hidden = true; aiStatus.textContent = '';
      aiHelpBtn.hidden = false;   // bring the [?] description back
      aiOn = false; activeKind = null;
      // Note: the radio-group highlight (setAiSelection) is left as-is, like the
      // model tiers - the last-picked tool stays highlighted after a result clears.
    }
    // "Already downloaded" = present in ANY cache (the offline tier bucket OR the
    // service-worker's own cache, where a prior AI run's fetch lands), or a prior
    // successful run flagged it (each model on its own localStorage key).
    async function modelReady(model, keyPrefix) {
      try { if (await caches.match(model.url)) return true; } catch (_) {}
      try { return localStorage.getItem(keyPrefix + model.id) === '1'; } catch (_) { return false; }
    }
    // Shared runner for both AI jobs. Toggles off if its own job is showing; tears
    // down the other job first if switching; otherwise confirms, runs, and renders.
    async function startStems() {
      if (aiRunning || aiConfirming) return;
      // A result already showing is torn down before the new job (one blend owns the
      // view at a time). Turning a result fully OFF is the AI-separation button's job.
      if (aiOn) clearStems();
      const ok = await confirmDownload();
      if (!ok) return;   // cancelled -> idle
      // The user can switch Standard/Lite/denoise while the prompt is open (the whole
      // row is one radio group), so read the FINAL choice now, after they confirm.
      const kind = pendingKind;
      const btn = kind === 'denoise' ? denoiseBtn : aiBtn;
      const cfg = STEM_CFGS[kind];
      aiOn = true; activeKind = kind;
      const orig = btn.textContent;
      try {
        aiRunning = true;
        btn.disabled = true;
        setAiStatus('Preparing…', 0);
        let result;
        if (kind === 'denoise') {
          btn.textContent = 'Denoising…';
          const { enhanceAudio } = await import('../lib/dfn-client.js');
          const r = await enhanceAudio(sourceBuffer(), {
            onProgress: (phase, frac) => {
              const pct = Math.round(frac * 100);
              setAiStatus(phase === 'model' ? 'Downloading model… ' + pct + '%' : 'Denoising… ' + pct + '%', frac);
            },
            signal: opts.signal,
          });
          try { localStorage.setItem('anr-dfn-ready-' + DFN_MODEL.id, '1'); } catch (_) {}
          // Feed the shared blend/stem renderer: left stem = Clean, right = Noise.
          result = { vocals: r.clean, instrumental: r.noise, sampleRate: r.sampleRate };
        } else {
          btn.textContent = 'Separating…';
          const model = MDX_MODELS[aiModelId] || MDX_MODELS.standard;
          const { separateStems } = await import('../lib/mdx-client.js');
          result = await separateStems(sourceBuffer(), {
            modelId: aiModelId,
            onProgress: (phase, frac) => {
              const pct = Math.round(frac * 100);
              setAiStatus(phase === 'model' ? 'Downloading model… ' + pct + '%' : 'Separating… ' + pct + '%', frac);
            },
            signal: opts.signal,
          });
          try { localStorage.setItem('anr-mdx-ready-' + model.id, '1'); } catch (_) {}
        }
        aiStatus.hidden = true; aiStatus.textContent = '';
        renderStems(result, cfg);
        // Stays ON (button is-active, results shown) until the next click clears it.
      } catch (err) {
        aiOn = false; activeKind = null;
        if (err && err.name === 'AbortError') { aiStatus.hidden = true; aiStatus.textContent = ''; }
        else setAiStatus((kind === 'denoise' ? 'Denoise failed: ' : 'Separation failed: ') + ((err && err.message) || 'unknown error') + '. Check your connection and try again.');
      }
      // Restore the button label/enabled state; it must never be left hidden.
      btn.textContent = orig; btn.disabled = false; btn.hidden = false; aiRunning = false;
    }
    // AI separation is the panel toggle. Opening it reveals the options row (Standard
    // / Lite / denoise) AND pops the confirm card for the default selection straight
    // away; because that card is a live radio group, clicking denoise (or the other
    // tier) just re-renders it. Clicking AI separation again closes the panel,
    // dismissing any open card. While a result is showing it is the master "off" -
    // clear the stems and revert to the original track.
    aiBtn.addEventListener('click', () => {
      if (aiRunning) return;
      if (aiOn) { clearStems(); return; }
      if (!aiModelRow.hidden) {                       // open -> close, dropping any card
        if (aiConfirming && aiConfirmCancel) aiConfirmCancel();
        aiModelRow.hidden = true;
        return;
      }
      aiModelRow.hidden = false;                      // closed -> open with the default card
      pendingKind = 'separate';
      setAiSelection(aiModelBtns[aiModelId] || aiModelBtns.standard);
      startStems();                                   // shows the default AI's confirm card
    });
    // Same shared dispatch as the tiers: highlight denoise, mark that the next Start
    // runs DENOISE, and re-render an open prompt for it (or start it) - so denoise is
    // reachable even when a separation prompt is already up.
    denoiseBtn.addEventListener('click', () => pickAction('denoise', denoiseBtn));
    if (opts.signal) opts.signal.addEventListener('abort', revokeAiUrls);
  }

  // opts.signal (an AbortSignal) lets the caller tear these document/window
  // listeners down when a new file is analysed, instead of leaking the cached
  // spectrogram data they close over.
  const sig = opts.signal;
  // The Height dropdown is px-only out of fullscreen. Entering fullscreen adds a
  // 'Fill' option (stretch to the whole screen) and selects it by default; the user
  // can still pick a pixel height, which applies in fullscreen too. Exiting removes
  // 'Fill' and restores the previous pixel choice.
  function syncHeightForFs() {
    const fs = isFs();
    const hasFill = heightSel.options.length && heightSel.options[0].value === 'fill';
    if (fs && !hasFill) {
      heightSel._prevHeight = heightSel.value;
      heightSel.insertBefore(el('option', { value: 'fill' }, 'Fill'), heightSel.firstChild);
      heightSel.value = 'fill';
      state.height = 'fill';
    } else if (!fs && hasFill) {
      heightSel.remove(0);
      heightSel.value = heightSel._prevHeight || '320';
      state.height = parseInt(heightSel.value, 10);
    }
  }
  attachFullscreen(card, fsBtn, allowFs, sig, () => {
    syncHeightForFs();
    // Recompute on the next frame and again once the fullscreen layout settles, so
    // the bitmap height catches up to the (filled or fixed) display.
    requestAnimationFrame(recompute);
    setTimeout(recompute, 120);
  });

  let resizeRaf;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      const newW = Math.max(200, Math.round(availableWidth() * state.zoom));
      if (Math.abs(newW - canvas.width) > 2 || isFs()) recompute();
      else scrollbar.update();   // viewport changed but canvas didn't - resync the bar
    });
  }, { signal: sig });

  // Defer until in DOM so clientWidth is real. The first paint resolves
  // card.firstPaint (guaranteed even if recompute throws) so the drop loader can
  // wait for it.
  setTimeout(() => { try { recompute(); } finally { markFirstPaint(); } }, 0);
  setTimeout(recompute, 80);
  // Safety net: never let the loader hang on the spectrogram for more than ~6 s.
  setTimeout(markFirstPaint, 6000);

  return card;
}

// Known music-tag fields that earn an inline [?] explanation; everything else
// renders as a plain row. Keyed by the display label set in audio-codec.js.
const TAG_HELP = {
  ISRC: "A unique ID for one specific audio recording (not the song or the album). The International Standard Recording Code reads as CC-XXX-YY-NNNNN: country, registrant, year, and a per-recording number. Labels and stores use it to track royalties and to match the same recording across services.",
};
function tagRow(name, value) {
  return TAG_HELP[name] ? rowHelp(name, value, TAG_HELP[name]) : row(name, value);
}

function buildCoverArtCard(art, file, resultsEl) {
  // Embedded cover art is promoted to the dedicated Photo section and given the
  // full photo analysis there (preview, histogram, EXIF, OCR) - the Photo tab is
  // re-enabled for it. A slim pointer card stays here to say where it went.
  const ext = art.mime === 'image/png' ? 'png' : art.mime === 'image/bmp' ? 'bmp' : 'jpg';
  const base = (file.name || 'cover').replace(/\.[^.]+$/, '') || 'cover';
  const artFile = new File([art.bytes], base + '-cover.' + ext, { type: art.mime });
  const note = 'Embedded cover art from ' + (file.name || 'this audio file')
    + ' (' + art.mime + ' · ' + fmtBytes(art.bytes.length) + ').';

  // Decide the render target SYNCHRONOUSLY. On a normal page the Photo section
  // exists (#photoResults); we reveal + render there once photo.js loads. On the
  // compare view there is no Photo section, so append a local sub-photo slot NOW,
  // before returning - the compare merge bucketizes and tears down its staging
  // containers synchronously right after each file renders, so a slot created
  // inside the deferred import().then() below would land after teardown and the
  // cover's full analysis would vanish. Appended now, the slot is moved into the
  // merged Photo section while still connected; renderPhoto then fills the
  // moved-but-live node once the module resolves.
  let inlineSlot = null;
  if (resultsEl && !document.getElementById('photoResults')) {
    inlineSlot = el('div', { class: 'anr-results anr-cmp-subslot anr-cmp-sub-photo' });
    resultsEl.appendChild(inlineSlot);
  }
  // Lazy-load the photo module (kept out of the audio bundle) only when there is
  // actually cover art to analyse, then render into the slot chosen above.
  import('./photo.js').then(({ renderPhoto, revealPhotoSection }) => {
    if (inlineSlot) { renderPhoto(artFile, inlineSlot, { inline: true, sourceNote: note }); return; }
    const photoResults = revealPhotoSection();
    if (photoResults) renderPhoto(artFile, photoResults, { sourceNote: note });
  }).catch(() => {});

  const labelCard = el('div', { class: 'anr-card' });
  const [artH, artHelp] = h3help('Embedded cover art', 'The picture stored inside this file’s metadata. It is shown and analysed in full in the Photo section.');
  labelCard.appendChild(artH);
  labelCard.appendChild(artHelp);
  labelCard.appendChild(el('p', { class: 'anr-hint', style: 'margin:0;' },
    art.mime + ' · ' + fmtBytes(art.bytes.length)));
  return labelCard;
}

export function buildWaveformCard(file, mono, audioBuffer, audioEl) {
  const sr = audioBuffer.sampleRate;
  const waveCard = el('div', { class: 'anr-card' });
  const [waveH, waveHelp] = h3help('Waveform', 'Amplitude over time. Click and drag to select a region - then drag its edges to fine-tune, drag the middle to move it, or type exact start/end times. Zoom in or export the selection as a WAV file. The white playhead line shows the current playback position; drag it, or use the transport below, to scrub.');
  waveCard.appendChild(waveH); waveCard.appendChild(waveHelp);
  const waveCanvas = el('canvas', { class: 'anr-waveform' });
  waveCanvas.width = 1024; waveCanvas.height = 80;
  waveCard.appendChild(waveCanvas);
  renderWaveform(waveCanvas, mono);

  // --- Interactive waveform: region selection, zoom, WAV export ---
  let selStart = null, selEnd = null;   // sample indices (unordered mid-drag)
  let zoomStart = 0, zoomEnd = mono.length;

  // Overlay canvas for selection highlight
  const overlayCanvas = el('canvas', { class: 'anr-waveform anr-wave-overlay' });
  overlayCanvas.width = waveCanvas.width;
  overlayCanvas.height = waveCanvas.height;

  const waveWrap = el('div', { class: 'anr-wave-wrap' });
  waveCard.replaceChild(waveWrap, waveCanvas);
  waveWrap.appendChild(waveCanvas);
  waveWrap.appendChild(overlayCanvas);

  // Waveform playhead synced with audio
  const waveLine = el('div', { class: 'anr-playhead' });
  waveWrap.appendChild(waveLine);
  // `animate` lets the line ease into place for discrete seeks while paused; during
  // live playback (and scrubbing) it tracks frame-by-frame with transition:none so
  // it can't lag behind - the 0.28s CSS ease on .anr-playhead would otherwise make
  // every RAF update visibly trail the audio.
  function tickWaveLine(animate) {
    const d = audioBuffer.duration;
    const currentSample = (audioEl.currentTime / d) * mono.length;
    const visLen = zoomEnd - zoomStart;
    const pct = ((currentSample - zoomStart) / visLen) * 100;
    if (pct >= 0 && pct <= 100) {
      waveLine.style.transition = animate ? '' : 'none';
      waveLine.style.left = pct + '%';
      waveLine.hidden = false;
    } else {
      waveLine.hidden = true;
    }
  }
  // The RAF loop drives live playback, always non-animated (passing the bare
  // function would feed the RAF timestamp in as `animate`, re-enabling the ease).
  function tickWaveLoop() {
    tickWaveLine(false);
    if (!audioEl.paused) requestAnimationFrame(tickWaveLoop);
  }
  audioEl.addEventListener('play', () => requestAnimationFrame(tickWaveLoop));
  audioEl.addEventListener('pause', () => tickWaveLine(true));
  // Snap (no ease) on seek: dragging the transport fires a stream of coalesced
  // 'seeked' events, and the 0.28s CSS glide on each one stacks into visible lag.
  // A single click-seek snapping is a fair trade for a responsive scrub.
  audioEl.addEventListener('seeked', () => tickWaveLine(false));

  // Grab the playhead line and drag to scrub (respects the current zoom window).
  attachScrub(waveLine, (clientX) => {
    const rect = waveCanvas.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const sample = zoomStart + frac * (zoomEnd - zoomStart);
    audioEl.currentTime = (sample / mono.length) * audioBuffer.duration;
    tickWaveLine();
  });

  // Full transport (play/pause + seek + time) directly below the canvas, wired to
  // the same <audio> the rest of the card drives - so the waveform can run playback
  // on its own without scrolling back up to the main player.
  waveCard.appendChild(el('div', { class: 'anr-spec-transport' }, [makePlayer(audioEl, audioBuffer.duration)]));

  // Selection controls (shown when a selection exists): editable start/end times,
  // a stats readout, then zoom / export.
  const selInfo = el('div', { class: 'anr-controls anr-sel-controls is-hidden' });
  const startInput = el('input', { type: 'text', class: 'anr-sel-time', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Selection start time' });
  const endInput = el('input', { type: 'text', class: 'anr-sel-time', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Selection end time' });
  const times = el('span', { class: 'anr-sel-times' }, [
    el('label', {}, ['Start', startInput]),
    el('label', {}, ['End', endInput]),
  ]);
  const selLabel = el('span', { class: 'anr-sel-label' }, '');
  const zoomBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, 'Zoom');
  const exportBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, 'Export WAV');
  selInfo.append(times, selLabel, zoomBtn, exportBtn);
  waveCard.appendChild(selInfo);

  // Zoom bar in its OWN row so "Reset zoom" stays reachable after a zoom - zooming
  // clears the selection, which hides the selInfo row the button used to live in.
  // Shown only while zoomed, with a label of the visible window.
  const zoomLabel = el('span', { class: 'anr-sel-label' }, '');
  const resetZoomBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, 'Reset zoom');
  const zoomBar = el('div', { class: 'anr-controls anr-sel-controls is-hidden' }, [zoomLabel, resetZoomBtn]);
  waveCard.appendChild(zoomBar);

  function drawOverlay() {
    const octx = overlayCanvas.getContext('2d');
    octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (selStart == null || selEnd == null) return;
    const visLen = zoomEnd - zoomStart;
    const x1 = ((Math.min(selStart, selEnd) - zoomStart) / visLen) * overlayCanvas.width;
    const x2 = ((Math.max(selStart, selEnd) - zoomStart) / visLen) * overlayCanvas.width;
    octx.fillStyle = 'rgba(100, 180, 255, 0.3)';
    octx.fillRect(x1, 0, x2 - x1, overlayCanvas.height);
    octx.strokeStyle = 'rgba(100, 180, 255, 0.7)';
    octx.lineWidth = 1;
    octx.strokeRect(x1, 0, x2 - x1, overlayCanvas.height);
  }

  // m:ss.mmm for the time fields; parse accepts that, plain seconds, or ss.mmm.
  function fmtSelTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(3);
  }
  function parseSelTime(str) {
    str = String(str).trim();
    if (!str) return null;
    let sec;
    if (str.indexOf(':') >= 0) {
      const p = str.split(':');
      const m = parseFloat(p[0]), s = parseFloat(p[1]);
      if (!isFinite(m) || !isFinite(s)) return null;
      sec = m * 60 + s;
    } else {
      sec = parseFloat(str);
    }
    return isFinite(sec) ? sec : null;
  }
  // Push the current selection into the time fields, unless one is being edited.
  function refreshTimeInputs() {
    if (selStart == null || selEnd == null) return;
    const s = Math.min(selStart, selEnd), e = Math.max(selStart, selEnd);
    if (document.activeElement !== startInput) startInput.value = fmtSelTime(s / sr);
    if (document.activeElement !== endInput) endInput.value = fmtSelTime(e / sr);
  }

  function updateSelInfo() {
    if (selStart == null || selEnd == null || selStart === selEnd) {
      selInfo.classList.add('is-hidden');
      return;
    }
    selInfo.classList.remove('is-hidden');
    const s = Math.min(selStart, selEnd);
    const e = Math.max(selStart, selEnd);
    const selSamples = mono.subarray(s, e);
    const dur = (e - s) / sr;
    const selStats = computeStats(selSamples);
    selLabel.textContent = dur.toFixed(3) + ' s, '
      + (e - s).toLocaleString() + ' samples | Peak: '
      + selStats.peak.toFixed(3) + ' (' + selStats.peakDb.toFixed(1) + ' dBFS) | RMS: '
      + selStats.rms.toFixed(3) + ' (' + selStats.rmsDb.toFixed(1) + ' dBFS)';
    refreshTimeInputs();
  }

  // Type an exact start/end - clamped to the clip and re-ordered if reversed.
  function commitTimeInputs() {
    const sSec = parseSelTime(startInput.value), eSec = parseSelTime(endInput.value);
    if (sSec == null || eSec == null) { refreshTimeInputs(); return; }
    let s = Math.max(0, Math.min(mono.length, Math.round(sSec * sr)));
    let e = Math.max(0, Math.min(mono.length, Math.round(eSec * sr)));
    if (s > e) { const t = s; s = e; e = t; }
    if (s === e) { refreshTimeInputs(); return; }
    selStart = s; selEnd = e;
    drawOverlay(); updateSelInfo();
  }
  startInput.addEventListener('change', commitTimeInputs);
  endInput.addEventListener('change', commitTimeInputs);
  [startInput, endInput].forEach((inp) => inp.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { commitTimeInputs(); inp.blur(); }
  }));

  function xToSample(x) {
    const rect = waveCanvas.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
    return Math.round(zoomStart + frac * (zoomEnd - zoomStart));
  }
  function sampleToX(smp) {
    const rect = waveCanvas.getBoundingClientRect();
    return ((smp - zoomStart) / (zoomEnd - zoomStart)) * rect.width;
  }

  // Which part of an existing selection a press at clientX lands on: an edge (to
  // resize), the interior (to move the whole region), or neither (start a new one).
  const EDGE_PX = 6;
  function hitMode(clientX) {
    if (selStart == null || selEnd == null || selStart === selEnd) return 'new';
    const rect = waveCanvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const xs = sampleToX(Math.min(selStart, selEnd));
    const xe = sampleToX(Math.max(selStart, selEnd));
    if (Math.abs(px - xs) <= EDGE_PX) return 'left';
    if (Math.abs(px - xe) <= EDGE_PX) return 'right';
    if (px > xs && px < xe) return 'move';
    return 'new';
  }

  let dragMode = null, moveAnchor = 0, moveWidth = 0;
  // Selection drag. Move/up listeners live on WINDOW (not the canvas) so a fast drag
  // that races off the edges keeps updating and finishes cleanly - the old
  // canvas-only mousemove dropped events the moment the pointer left the canvas.
  function onSelMove(e) {
    if (!dragMode) return;
    const smp = xToSample(e.clientX);
    if (dragMode === 'new') selEnd = smp;
    else if (dragMode === 'left') selStart = Math.min(smp, selEnd - 1);
    else if (dragMode === 'right') selEnd = Math.max(smp, selStart + 1);
    else if (dragMode === 'move') {
      let ns = Math.max(0, Math.min(mono.length - moveWidth, smp - moveAnchor));
      selStart = ns; selEnd = ns + moveWidth;
    }
    drawOverlay(); updateSelInfo();
  }
  function onSelUp() {
    window.removeEventListener('mousemove', onSelMove);
    window.removeEventListener('mouseup', onSelUp);
    const mode = dragMode;
    dragMode = null;
    if (mode == null) return;
    if (selStart != null && selEnd != null && selStart > selEnd) { const t = selStart; selStart = selEnd; selEnd = t; }
    // A bare click (new drag with no width) leaves nothing selected.
    if (mode === 'new' && selStart === selEnd) { selStart = selEnd = null; }
    drawOverlay(); updateSelInfo();
  }

  waveCanvas.style.cursor = 'crosshair';
  waveCanvas.addEventListener('mousedown', (e) => {
    const mode = hitMode(e.clientX);
    const smp = xToSample(e.clientX);
    if (mode === 'new') {
      selStart = smp; selEnd = smp;
    } else {
      // Normalize the existing selection so the grabbed edge/body drags predictably.
      const s = Math.min(selStart, selEnd), en = Math.max(selStart, selEnd);
      selStart = s; selEnd = en;
      if (mode === 'move') { moveAnchor = smp - s; moveWidth = en - s; }
    }
    dragMode = mode;
    drawOverlay(); updateSelInfo();
    e.preventDefault();
    window.addEventListener('mousemove', onSelMove);
    window.addEventListener('mouseup', onSelUp);
  });

  // Hover cursor hints what a press will do (resize edges / move / new selection).
  waveCanvas.addEventListener('mousemove', (e) => {
    if (dragMode) return;
    const m = hitMode(e.clientX);
    waveCanvas.style.cursor = (m === 'left' || m === 'right') ? 'ew-resize' : (m === 'move' ? 'move' : 'crosshair');
  });

  function redrawWaveform() {
    const visibleSamples = mono.subarray(zoomStart, zoomEnd);
    renderWaveform(waveCanvas, visibleSamples);
    overlayCanvas.width = waveCanvas.width;
    overlayCanvas.height = waveCanvas.height;
    drawOverlay();
  }

  zoomBtn.addEventListener('click', () => {
    if (selStart == null || selEnd == null || selStart === selEnd) return;
    const s = Math.min(selStart, selEnd);
    const e = Math.max(selStart, selEnd);
    zoomStart = s;
    zoomEnd = e;
    selStart = null;
    selEnd = null;
    redrawWaveform();
    updateSelInfo();
    zoomLabel.textContent = 'Zoomed to ' + fmtSelTime(zoomStart / sr) + ' - ' + fmtSelTime(zoomEnd / sr);
    zoomBar.classList.remove('is-hidden');
  });

  resetZoomBtn.addEventListener('click', () => {
    zoomStart = 0;
    zoomEnd = mono.length;
    selStart = null;
    selEnd = null;
    redrawWaveform();
    updateSelInfo();
    zoomBar.classList.add('is-hidden');
  });

  exportBtn.addEventListener('click', () => {
    if (selStart == null || selEnd == null || selStart === selEnd) return;
    const s = Math.min(selStart, selEnd);
    const e = Math.max(selStart, selEnd);
    const selSamples = mono.subarray(s, e);
    const numSamples = selSamples.length;
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = audioBuffer.sampleRate * blockAlign;
    const dataSize = numSamples * blockAlign;
    const bufferSize = 44 + dataSize;
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // RIFF header
    let offset = 0;
    const writeStr = (s) => { for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i)); };
    writeStr('RIFF');
    view.setUint32(offset, 36 + dataSize, true); offset += 4;
    writeStr('WAVE');

    // fmt chunk
    writeStr('fmt ');
    view.setUint32(offset, 16, true); offset += 4;          // chunk size
    view.setUint16(offset, 1, true); offset += 2;           // PCM format
    view.setUint16(offset, numChannels, true); offset += 2;
    view.setUint32(offset, audioBuffer.sampleRate, true); offset += 4;
    view.setUint32(offset, byteRate, true); offset += 4;
    view.setUint16(offset, blockAlign, true); offset += 2;
    view.setUint16(offset, bitsPerSample, true); offset += 2;

    // data chunk
    writeStr('data');
    view.setUint32(offset, dataSize, true); offset += 4;

    // Convert Float32 to Int16
    for (let i = 0; i < numSamples; i++) {
      let sample = selSamples[i];
      sample = Math.max(-1, Math.min(1, sample));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }

    const blob = new Blob([buffer], { type: 'audio/wav' });
    downloadBlob((file.name || 'selection').replace(/\.[^.]+$/, '') + '_selection.wav', blob);
  });
  return waveCard;
}

// --- Amplitude histogram card (shared by the audio + video modules) ---
export function buildHistogramCard(samples) {
  const histCard = el('div', { class: 'anr-card' });
  const [ahH, ahHelp] = h3help('Histogram',
    'How often each loudness level shows up across the whole clip. ' +
    'The horizontal axis is the sample value from −1 to +1 (0 = silence, marked by the red line; ' +
    '±1 = the loudest the format allows). The vertical axis is how many samples sit at each level. ' +
    'A tall spike in the centre means lots of quiet moments; energy spread toward the edges means a loud, dynamic signal.');
  histCard.appendChild(ahH); histCard.appendChild(ahHelp);
  const histCanvas = el('canvas', { class: 'anr-histogram' });
  histCanvas.width = 1024; histCanvas.height = 100;
  histCard.appendChild(histCanvas);

  const bins = 256;
  const counts = new Uint32Array(bins);
  for (let i = 0; i < samples.length; i++) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((samples[i] + 1) * 0.5 * bins)));
    counts[idx]++;
  }
  let maxCount = 0;
  for (let i = 0; i < bins; i++) if (counts[i] > maxCount) maxCount = counts[i];
  const hctx = histCanvas.getContext('2d');
  const cw = histCanvas.width, ch = histCanvas.height;
  hctx.fillStyle = '#0a0a0a';
  hctx.fillRect(0, 0, cw, ch);
  const barW = cw / bins;
  for (let i = 0; i < bins; i++) {
    const h = maxCount > 0 ? (counts[i] / maxCount) * ch : 0;
    const t = i / bins;
    const g = Math.round(180 + t * 75);
    hctx.fillStyle = `rgb(${g},${g},${g})`;
    hctx.fillRect(i * barW, ch - h, barW, h);
  }
  hctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e60023';
  hctx.lineWidth = 1;
  const center = Math.floor(bins / 2) * barW;
  hctx.beginPath();
  hctx.moveTo(center, 0);
  hctx.lineTo(center, ch);
  hctx.stroke();

  // Axis markings: amplitude ticks under the canvas + a units caption.
  histCard.appendChild(el('div', { class: 'anr-hist-axis' }, [
    el('span', {}, '−1.0'), el('span', {}, '−0.5'), el('span', {}, '0'),
    el('span', {}, '+0.5'), el('span', {}, '+1.0')
  ]));
  histCard.appendChild(el('p', { class: 'anr-hist-caption' },
    'Amplitude (0 = silence)  ·  height = relative sample count'));
  return histCard;
}

// Tears down the previous render's persistent spectrogram listeners when a new
// audio file is analysed.
let audioRenderAbort = null;

// Fallback when the browser can't decode the audio (e.g. WMA, AC3, DTS, AMR,
// undecodable MKA). There's no waveform/spectrogram, but the container info, tags,
// lyrics, and cover art are all readable straight from the bytes.
async function renderUndecodableAudio(file, header, resultsEl, playable) {
  const infoCard = el('div', { class: 'anr-card' });
  const [infoH, infoHelp] = h3help('Audio file', 'The container details, tags, lyrics, and cover art below were still read straight from the file.');
  infoCard.appendChild(infoH);
  infoCard.appendChild(infoHelp);
  infoCard.appendChild(el('p', { class: 'anr-hint', style: 'margin: 0 0 10px;' },
    'This format can’t be decoded for analysis, so there’s no waveform or spectrogram.'));

  // Native-playback fallback. Web Audio's decodeAudioData couldn't decode this
  // file, but the platform media pipeline (a plain <audio> element) often still
  // plays it - the two use different decoders. This asymmetry is common for AAC:
  // Chromium/Edge and Samsung Internet frequently reject AAC in decodeAudioData
  // (so no waveform/spectrogram) while their <audio> element plays it fine. Offer
  // a player on the browser-playable form: for raw ADTS AAC that's the M4A-wrapped
  // `playable`; otherwise the file itself. The card stays hidden until the element
  // proves it can actually play, so a truly unplayable file shows no dead player.
  try {
    const src = playable || file;
    const playUrl = URL.createObjectURL(src);
    const audioEl = el('audio', { src: playUrl, class: 'is-hidden', preload: 'metadata' });
    const playCard = el('div', { class: 'anr-card', style: 'display:none;' });
    const [playH, playHelp] = h3help('Playback', 'Your browser can play this file even though it could not analyse it.');
    playCard.appendChild(playH);
    playCard.appendChild(playHelp);
    playCard.appendChild(audioEl);
    playCard.appendChild(makePlayer(audioEl));
    audioEl.addEventListener('loadedmetadata', () => { playCard.style.display = ''; });
    audioEl.addEventListener('error', () => { playCard.remove(); URL.revokeObjectURL(playUrl); });
    resultsEl.appendChild(playCard);
  } catch (_) { /* no playback fallback available */ }
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Name', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  tbl.appendChild(rowHelp('MIME', file.type || '-', "The MIME type is the standard label for the file's format (for example image/jpeg or audio/mpeg). The browser reads it from the extension or the operating system, so it's a hint rather than proof of the real format."));
  if (header.container) tbl.appendChild(row('Container', header.container));
  if (header.codec) tbl.appendChild(row('Codec', header.codec));
  if (header.sampleRate) tbl.appendChild(row('Sample rate', header.sampleRate.toLocaleString() + ' Hz'));
  if (header.channels) tbl.appendChild(row('Channels', String(header.channels)));
  if (header.bitDepth) tbl.appendChild(row('Bit depth', header.bitDepth + '-bit'));
  if (header.bitrateText || header.bitrate) tbl.appendChild(row('Bitrate',
    header.bitrateText || (Math.round(header.bitrate / 1000) + ' kbps')));
  try {
    if (header.encoder) tbl.appendChild(rowHelp('Encoder', header.encoder,
      'The software that created (encoded) this file, read from its Xing/LAME/VBRI header.'));
    if (header.compressionRatio) tbl.appendChild(row('Compression', header.compressionRatio.toFixed(2) + ':1'));
    if (header.flacMd5) tbl.appendChild(rowHelp('Audio MD5', header.flacMd5,
      "A fingerprint (MD5 checksum) of the raw decoded audio that FLAC stores inside the file (in its STREAMINFO block). A decoder can recompute it to confirm the audio survived re-encoding intact."));
  } catch (_) {}
  infoCard.appendChild(tbl);
  resultsEl.appendChild(infoCard);

  try {
    const meta = await readAudioTags(file);
    if (meta && meta.tags && meta.tags.length) {
      const card = el('div', { class: 'anr-card' });
      card.appendChild(el('h3', {}, 'Tags'));
      const t = el('table', { class: 'anr-readout' });
      for (const [n, v] of meta.tags) t.appendChild(tagRow(n, v));
      card.appendChild(t); resultsEl.appendChild(card);
    }
    if (meta && meta.lyrics) {
      const card = el('div', { class: 'anr-card' });
      card.appendChild(el('h3', {}, 'Lyrics'));
      card.appendChild(el('pre', { class: 'anr-lyrics' }, meta.lyrics));
      resultsEl.appendChild(card);
    }
  } catch (_) {}
  try { const art = await extractCoverArt(file); if (art && art.bytes && art.bytes.length) resultsEl.appendChild(buildCoverArtCard(art, file)); } catch (_) {}
  resultsEl.appendChild(integrityCard(file));
}

// Decode audio the browser's Web Audio can't handle by transcoding to PCM WAV
// with ffmpeg.wasm, then decoding that (raw PCM always decodes). Reuses the same
// lazily-loaded ffmpeg instance the video tools use. Returns an AudioBuffer or
// throws (so the caller can fall back to the metadata-only view). Source sample
// rate and channel count are preserved so the spectrogram's frequency axis and
// the channel readout stay accurate.
async function ffmpegDecodeAudio(file, resultsEl) {
  const note = el('div', { class: 'anr-info' },
    "Your browser can't decode this audio directly - decoding with FFmpeg to build the waveform and spectrogram...");
  resultsEl.appendChild(note);
  try {
    const { loadFFmpeg } = await import('./video.js');
    const ff = await loadFFmpeg();
    await ff.writeFile('adin', new Uint8Array(await file.arrayBuffer()));
    // -vn drops any cover-art video stream; keep source rate/channels.
    await ff.exec(['-i', 'adin', '-vn', '-c:a', 'pcm_s16le', '-f', 'wav', 'adout.wav']);
    const data = await ff.readFile('adout.wav');
    try { await ff.deleteFile('adin'); await ff.deleteFile('adout.wav'); } catch (_) {}
    const wav = new Blob([data.buffer || data], { type: 'audio/wav' });
    return await ctx().decodeAudioData(await wav.arrayBuffer());
  } finally {
    note.remove();
  }
}

// Loudness-over-time plot for the EBU R128 meter (momentary LUFS series). Clamped
// to a readable -40..0 LUFS window with a -14 LUFS streaming-target reference line.
function drawLoudnessGraph(series, duration, audioEl) {
  const W = 640, H = 120, pad = 6;
  const cv = el('canvas', { width: String(W), height: String(H),
    style: 'width:100%; height:auto; display:block; border:var(--bd-hairline); background:var(--bg);' });
  const ctx = cv.getContext('2d');
  if (!ctx) { cv.style.marginTop = '12px'; return cv; }
  const cs = getComputedStyle(document.body);
  const accent = (cs.getPropertyValue('--accent') || '').trim() || '#e60023';
  const muted = (cs.getPropertyValue('--muted') || '').trim() || '#888';
  const LO = -40, HI = 0;
  const yOf = (l) => pad + (HI - Math.max(LO, Math.min(HI, l))) / (HI - LO) * (H - pad * 2);
  const xOf = (t) => pad + (duration > 0 ? t / duration : 0) * (W - pad * 2);
  // -14 LUFS reference (common streaming target).
  ctx.strokeStyle = muted; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad, yOf(-14)); ctx.lineTo(W - pad, yOf(-14)); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = muted; ctx.font = '10px monospace'; ctx.fillText('−14', W - pad - 22, yOf(-14) - 3);
  // Momentary curve.
  ctx.strokeStyle = accent; ctx.lineWidth = 1.2; ctx.beginPath();
  let started = false;
  for (const p of series) {
    if (!isFinite(p.lufs)) { started = false; continue; }
    const x = xOf(p.t), y = yOf(p.lufs);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // No playback element: a static readout graph, as before.
  if (!audioEl) { cv.style.marginTop = '12px'; return cv; }

  // Playable, like the waveform: wrap the canvas so a playhead line can track
  // playback, click or drag the graph to seek, and a transport sits below. The
  // line is themed (var(--fg)) rather than the media-canvas white, since this
  // graph sits on the themed card surface, not a dark media canvas.
  const wrap = el('div', { class: 'anr-wave-wrap', style: 'margin-top:12px;' });
  wrap.appendChild(cv);
  const line = el('div', { class: 'anr-playhead', style: 'background:var(--fg);' });
  wrap.appendChild(line);

  const durOf = () => audioEl.duration || duration || 0;
  // `animate` eases the line into place for discrete seeks while paused; live
  // playback and scrubbing pass false so it tracks frame-by-frame without lag.
  function tick(animate) {
    const d = durOf();
    const pct = d > 0 ? (audioEl.currentTime / d) * 100 : 0;
    if (pct >= 0 && pct <= 100) {
      line.style.transition = animate ? '' : 'none';
      line.style.left = pct + '%';
      line.hidden = false;
    } else line.hidden = true;
  }
  function loop() { tick(false); if (!audioEl.paused) requestAnimationFrame(loop); }
  audioEl.addEventListener('play', () => requestAnimationFrame(loop));
  audioEl.addEventListener('pause', () => tick(true));
  audioEl.addEventListener('seeked', () => tick(false));

  function seekFromClientX(clientX) {
    const rect = cv.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    audioEl.currentTime = frac * durOf();
    tick(false);
  }
  cv.style.cursor = 'pointer';
  cv.addEventListener('click', (e) => seekFromClientX(e.clientX));
  attachScrub(line, seekFromClientX);

  const out = el('div');
  out.appendChild(wrap);
  out.appendChild(el('div', { class: 'anr-spec-transport' }, [makePlayer(audioEl, durOf())]));
  tick(true);
  return out;
}

// A collapsible <details> panel with a plain summary label and an optional [?]
// help button - the same idiom the video Advanced card's vAdvPanel uses, so the
// sound Advanced card reads identically. Returns { det, body }; append rows/tables
// to `body`.
function aAdvPanel(title, helpHtml, open) {
  const det = el('details', open ? { open: '' } : {});
  const sum = el('summary', {});
  // Title + optional [?] grouped in one span so the summary's flex space-between
  // keeps them together on the left (only the open/close marker sits at the right).
  const label = el('span', { class: 'anr-summary-label' });
  label.appendChild(document.createTextNode(title + (helpHtml ? ' ' : '')));
  det.appendChild(sum);
  const body = el('div');
  if (helpHtml) {
    const btn = el('button', { type: 'button', class: 'anr-info-btn', title: 'Info' }, '[?]');
    const panel = el('div', { class: 'anr-info-panel is-hidden', html: helpHtml });
    wireInfoToggle(btn, panel);
    label.appendChild(btn);
    body.appendChild(panel);
  }
  sum.appendChild(label);
  det.appendChild(body);
  return { det, body };
}

// --- Render uploaded / recorded audio results ---
export async function renderAudio(file, resultsEl, opts = {}) {
  // Inline renders (the compare view's side-by-side panels) use an isolated abort
  // controller so two analyses don't cancel each other's in-flight work; only the
  // main single-file flow uses the shared module-level one.
  let renderSignal;
  if (opts.inline) {
    renderSignal = new AbortController().signal;
  } else {
    if (audioRenderAbort) audioRenderAbort.abort();
    audioRenderAbort = new AbortController();
    renderSignal = audioRenderAbort.signal;
  }

  resultsEl.hidden = false;
  resultsEl.innerHTML = '';

  let header = {};
  // Pre-decoded entry point: callers that already hold the decoded sound (the
  // video module extracts + decodes a video's audio track itself) pass it in via
  // opts.audioBuffer so we skip our own container peek and decode, and render the
  // exact same ordered set of cards as a directly-dropped audio file.
  //   - opts.playbackFile: the blob/File the <audio> player should use (defaults
  //     to `file`, which for that caller is a WAV wrapping the same PCM).
  //   - opts.header: optional { container, codec } for the File info rows.
  let playbackFile = opts.playbackFile || file;
  let audioBuffer = opts.audioBuffer || null;
  // True when the browser's own decoder couldn't handle this file and we decoded
  // it with ffmpeg.wasm instead. That's precisely the population where the native
  // <audio> element is untrustworthy for playback too (it may accept the file and
  // fire no error yet produce no sound - e.g. HE-AAC, or a codec-stripped Chromium
  // build), so it's the signal to play from a WAV of the decoded PCM instead.
  let usedFfmpeg = false;

  if (audioBuffer) {
    header = opts.header || {};
  } else {
    resultsEl.appendChild(el('div', { class: 'anr-info' }, `Decoding "${file.name}"...`));

    try { header = await peekContainer(file); } catch (e) { /* ignore */ }

    if (header.container === 'AAC') {
      try {
        const wrapped = adtsToM4a(await file.arrayBuffer());
        if (wrapped) {
          playbackFile = new File([wrapped], file.name.replace(/\.[^.]+$/, '.m4a'), { type: 'audio/mp4' });
          audioBuffer = await ctx().decodeAudioData(wrapped.slice(0));
        }
      } catch (_) {}
    }

    if (!audioBuffer) {
      try {
        audioBuffer = await decodeFile(file);
      } catch (e) {
        // Web Audio's decodeAudioData rejected it. This happens for whole codec
        // families a given browser lacks - AAC in Chromium/Edge and Samsung Internet,
        // and commonly WMA, AC-3, DTS, AMR and friends everywhere. Fall back to
        // decoding via ffmpeg.wasm (a full decoder set) to PCM, which recovers the
        // full waveform/spectrogram/loudness for any of them instead of dropping to
        // a metadata-only view. Codec-agnostic: whatever failed above lands here.
        try {
          audioBuffer = await ffmpegDecodeAudio(file, resultsEl);
          usedFfmpeg = true;
        } catch (e2) {
          // Both decode paths failed - genuinely undecodable here. Log the real
          // reasons (helps diagnose a platform-specific codec gap) and fall back
          // to the metadata-only view.
          try { console.error('[audio] decodeAudioData failed:', e); } catch (_) {}
          try { console.error('[audio] ffmpeg decode failed:', e2); } catch (_) {}
          resultsEl.innerHTML = '';
          await renderUndecodableAudio(file, header, resultsEl, playbackFile);
          return;
        }
      }
    }
  }

  resultsEl.innerHTML = '';

  const mono = getMono(audioBuffer);
  const stats = computeStats(mono);

  // ---- Forensic DSP (all pure, computed once and reused across cards) ----
  const sampleRate = audioBuffer.sampleRate;
  const channelData = [];
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) channelData.push(audioBuffer.getChannelData(c));
  const LOSSLESS_EXTS = new Set(['flac', 'wav', 'wave', 'alac', 'aif', 'aiff', 'aifc', 'ape', 'wv', 'tta', 'tak', 'pcm', 'caf', 'w64']);
  const audioExt = (file.name || '').toLowerCase().split('.').pop();
  // opts.declaredLossless lets a pre-decoded caller override the file-name/header
  // guess. The video module hands us PCM wrapped in a WAV, whose .wav extension
  // would otherwise read as a genuine lossless-file claim and frame the lossy-source
  // check as a fake-lossless accusation - so it passes false, and the check simply
  // reports where the extracted sound was cut, without the fake-lossless framing.
  const declaredLossless = opts.declaredLossless != null ? opts.declaredLossless
    : (LOSSLESS_EXTS.has(audioExt)
      || /FLAC|WAV|AIFF|ALAC|PCM|Lossless|Monkey|WavPack/i.test((header.container || '') + ' ' + (header.codec || '')));
  let spec = null, health = null, keyResult = null, r128 = null, tpDb = null, dtmf = null;
  try { spec = longAverageSpectrum(mono, sampleRate); } catch (_) {}
  try { health = signalHealth(channelData); } catch (_) {}
  try { if (spec) keyResult = detectKey(spec); } catch (_) {}
  try { r128 = loudnessR128(mono, sampleRate); } catch (_) {}
  try { tpDb = truePeakDb(channelData, sampleRate); } catch (_) {}
  try { dtmf = detectDtmf(mono, sampleRate); } catch (_) {}

  // ---- File info card ----
  const infoCard = el('div', { class: 'anr-card' });
  infoCard.appendChild(el('h3', {}, 'File info'));
  // Pick the playback source. When the native decoder couldn't read the file
  // (usedFfmpeg), the <audio> element can't play it reliably either, so serve a
  // lossless WAV built from the PCM we already decoded - it plays in every browser
  // regardless of codec support. The WAV (16-bit) is smaller than the Float32
  // audioBuffer that's already in memory, so this adds no meaningful footprint.
  let playbackSrc = playbackFile;
  if (usedFfmpeg) {
    try { playbackSrc = new Blob([encodeWav(audioBuffer)], { type: 'audio/wav' }); } catch (_) {}
  }
  const audioUrl = URL.createObjectURL(playbackSrc);
  // Revoke the URL when the analysis is torn down (next drop / SPA navigation both
  // run the media stoppers), otherwise repeatedly analysing large audio pins each
  // backing blob for the page's lifetime.
  (window._anrMediaStoppers = window._anrMediaStoppers || new Set())
    .add(() => { try { URL.revokeObjectURL(audioUrl); } catch (_) {} });
  const audioEl = el('audio', { src: audioUrl, class: 'is-hidden' });
  infoCard.appendChild(audioEl);
  infoCard.appendChild(makePlayer(audioEl, audioBuffer.duration));

  // Download button for in-browser captures (recording / live spectrogram), where
  // the analysed sound exists only as a blob and would otherwise be unsaveable. A
  // normally-dropped file already lives on disk, so this is opt-in (opts.download).
  if (opts.download) {
    const dlName = playbackFile.name || 'recording';
    const dlLink = el('a', {
      href: audioUrl, download: dlName, class: 'anr-btn',
      style: 'margin-top:10px;display:inline-block;text-decoration:none;'
    }, opts.downloadLabel || 'Download recording');
    infoCard.appendChild(el('div', { class: 'anr-btn-row', style: 'margin-top:8px;' }, [dlLink]));
  }

  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Name',           file.name));
  tbl.appendChild(row('Size',           fmtBytes(file.size)));
  tbl.appendChild(rowHelp('MIME',       file.type || header.container || '-', "The MIME type is the standard label for the file's format (for example image/jpeg or audio/mpeg). The browser reads it from the extension or the operating system, so it's a hint rather than proof of the real format."));
  if (header.container) tbl.appendChild(row('Container',     header.container));
  if (header.codec)     tbl.appendChild(row('Codec',         header.codec));
  tbl.appendChild(row('Duration',       formatTime(audioBuffer.duration)));
  tbl.appendChild(rowHelp('Sample rate',    audioBuffer.sampleRate.toLocaleString() + ' Hz',
    'How many times per second the sound was measured when it was recorded, in hertz. Higher numbers capture higher-pitched sound - CD audio is 44,100 Hz, video audio is often 48,000 Hz.'));
  tbl.appendChild(row('Channels',       audioBuffer.numberOfChannels + describeChannels(audioBuffer.numberOfChannels)));
  if (header.bitDepth)  tbl.appendChild(rowHelp('Bit depth',     header.bitDepth + ' bit',
    'How many bits are used to store each measurement of the sound. More bits capture a wider range from quiet to loud with less background grain (quantization noise) - CD audio uses 16 bits.'));
  if (header.bitrateText || header.bitrate) tbl.appendChild(rowHelp('Bitrate',
    header.bitrateText || ((header.bitrate / 1000).toFixed(0) + ' kbps'),
    'How much data is spent on each second of audio, in kilobits per second. More data usually means better quality and a bigger file. VBR (variable bitrate) shows the average across the file.'));
  try {
    if (header.encoder) tbl.appendChild(rowHelp('Encoder', header.encoder,
      'The software that created (encoded) this file, read from its Xing/LAME/VBRI header.'));
    if (header.compressionRatio) tbl.appendChild(rowHelp('Compression',
      header.compressionRatio.toFixed(2) + ':1',
      'How much smaller lossless compression made the file compared with the same audio stored raw and uncompressed (PCM). A higher ratio means a smaller file for identical sound.'));
    if (header.flacMd5) tbl.appendChild(rowHelp('Audio MD5', header.flacMd5,
      "A fingerprint (MD5 checksum) of the raw decoded audio that FLAC stores inside the file (in its STREAMINFO block). A decoder can recompute it to confirm the audio survived re-encoding intact."));
  } catch (_) {}
  tbl.appendChild(rowHelp('Peak', stats.peak.toFixed(3) + '  (' + stats.peakDb.toFixed(1) + ' dBFS)',
    'The loudest single sample in the file. dBFS means decibels relative to full scale, where 0 dBFS is the digital maximum and lower (more negative) numbers are quieter.'));
  tbl.appendChild(rowHelp('RMS', stats.rms.toFixed(3)  + '  (' + stats.rmsDb.toFixed(1)  + ' dBFS)',
    'Root Mean Square - the average energy of the signal, which tracks how loud it actually feels better than the single loudest peak does. Typical mastered music sits around −10 dBFS.'));
  const lufsValue = computeLufs(mono, audioBuffer.sampleRate);
  tbl.appendChild(rowHelp('Loudness', (isFinite(lufsValue) ? lufsValue.toFixed(1) + ' LUFS' : '-'),
    'How loud the audio feels to human ears, measured the broadcast-standard way (ITU-R BS.1770) that follows our hearing rather than raw signal level. Streaming targets: Spotify −14, YouTube −14, Apple −16 LUFS.'));
  if (stats.clipped > 0) {
    const pct = ((stats.clipped / mono.length) * 100).toFixed(3);
    tbl.appendChild(rowHelp('Clipping', stats.clipped.toLocaleString() + ' samples  (' + pct + '%)',
      'Samples pushed to or past the digital ceiling (0 dBFS), which sounds like harsh distortion. The more samples clip, the rougher it sounds.'));
  } else {
    tbl.appendChild(rowHelp('Clipping', 'None',
      'Samples pushed to or past the digital ceiling (0 dBFS), which would cause distortion. None were found in this file.'));
  }
  if (health) {
    tbl.appendChild(rowHelp('Crest factor', health.crestDb.toFixed(1) + ' dB',
      'The gap between the loudest peak and the average (RMS) level - the peak-to-RMS ratio, a single number for how punchy or squashed the sound is. Loud, heavily compressed masters sit low (under about 8 dB); open, dynamic recordings sit higher (15 dB or more).'));
    const dcPct = (Math.abs(health.dcOffset) * 100);
    tbl.appendChild(rowHelp('DC offset', Math.abs(health.dcOffset) < 1e-4
        ? 'None (' + health.dcOffset.toExponential(1) + ')'
        : health.dcOffset.toFixed(5) + '  (' + health.dcDb.toFixed(1) + ' dBFS, ' + dcPct.toFixed(3) + '%)',
      'The average of all the samples, which should sit at about 0. A value away from 0 points to a recording or hardware fault, wastes loudness headroom, and can cause clicks where the audio is cut.'));
    if (health.effectiveBits > 0) {
      const declaredBits = header.bitDepth || null;
      const padded = declaredBits && health.effectiveBits < declaredBits - 1;
      tbl.appendChild(rowHelp('Effective bit depth', health.effectiveBits + ' bit'
          + (padded ? '  (declared ' + declaredBits + ' - likely padded/upscaled)' : ''),
        'The deepest bit that actually carries real sound, worked out from activity in the smallest bits. Sitting well below the stated bit depth means the file was padded or upscaled rather than genuinely high-resolution.'));
    }
  }
  const centroid = computeCentroid(mono, audioBuffer.sampleRate);
  if (centroid != null) {
    const label = centroid < 1500 ? 'warm' : centroid < 4000 ? 'neutral' : 'bright';
    tbl.appendChild(rowHelp('Spectral centroid', Math.round(centroid).toLocaleString() + ' Hz  (' + label + ')',
      'Where the "centre of gravity" of the sound sits on the pitch scale - roughly whether it leans low or high overall. Below 1500 Hz sounds warm or dark, above 4000 Hz sounds bright or sharp. Handy for comparing the tonal character of two files.'));
  }
  const pitchResult = detectPitch(mono, audioBuffer.sampleRate);
  if (pitchResult) {
    const centsStr = pitchResult.cents >= 0 ? '+' + pitchResult.cents : String(pitchResult.cents);
    tbl.appendChild(rowHelp('Pitch', pitchResult.note + '  (' + pitchResult.frequency.toFixed(1) + ' Hz, ' + centsStr + ' cents)',
      'The main musical note the sound settles on, found with the YIN pitch-detection method. Cents measure how far it drifts from the nearest exact note (±50 cents is half a semitone, the gap between two adjacent piano keys).'));
  } else {
    tbl.appendChild(rowHelp('Pitch', 'N/A',
      'The main musical note of the sound, found with the YIN pitch-detection method. No clear, steady pitch could be detected in this audio.'));
  }
  const tagBpm = await readTagBPM(file).catch(() => null);
  const estBpm = detectBPM(mono, audioBuffer.sampleRate);
  const bpmVal = tagBpm || estBpm;
  const bpmIsTag = tagBpm != null;
  const bpmRow = rowHelp('BPM', bpmVal != null ? bpmVal + ' BPM' : 'N/A',
    bpmIsTag ? 'Beats per minute - the tempo - read straight from the file’s saved metadata.'
             : 'Beats per minute - the tempo - estimated by tracking where the beats land in the sound. Most reliable on rhythmic music with a clear, steady beat.');
  if (bpmVal != null && !bpmIsTag) {
    const td = bpmRow.querySelector('td');
    td.appendChild(el('span', { style: 'font-size:0.8em;color:var(--muted);margin-left:4px' }, '(est)'));
  }
  tbl.appendChild(bpmRow);
  if (keyResult) {
    const conf = Math.round(keyResult.confidence * 100);
    const keyRow = rowHelp('Musical key', keyResult.key + '  (' + conf + '% confidence)',
      'The song’s likely musical key, estimated by matching its blend of notes against reference patterns for each key (the Krumhansl-Schmuckler templates). Most reliable on tonal music; the runner-up is often the relative major or minor. Pairs with the detected tempo.');
    keyRow.querySelector('td').appendChild(el('span', { style: 'font-size:0.8em;color:var(--muted);margin-left:4px' }, '· alt ' + keyResult.alt));
    tbl.appendChild(keyRow);
  }
  tbl.appendChild(rowHelp('Total samples',  mono.length.toLocaleString(),
    'The total count of individual sound measurements in the merged mono signal - roughly the sample rate multiplied by the duration in seconds.'));
  infoCard.appendChild(tbl);
  // Mount for the spectrogram's "Analysis" sub-block (Peak / detected range /
  // cutoff / dynamic range / resolution). It belongs to the spectrogram panel
  // below - which fills this element and refreshes it as its FFT/window settings
  // change - but is shown here inside File info at the user's request.
  const specStatsMount = el('div');
  infoCard.appendChild(specStatsMount);
  resultsEl.appendChild(infoCard);

  // ---- Advanced (forensic panels, collapsed) ----
  // Mirrors the photo and video Advanced cards: one collapsed anr-card holding
  // <details> panels (built with aAdvPanel). This keeps the deep forensic reads -
  // the full EBU R128 loudness set and the spectral checks - out of the way of the
  // everyday File info readout above, exactly as the video Advanced card does.
  // Built here (data is in scope) but appended last, below every other card.
  let advCardEl = null;
  {
    const advCard = el('div', { class: 'anr-card anr-adv' });
    const [advH, advHelp] = h3help('Advanced',
      'Deep forensic analysis of the sound, computed from the decoded audio. Each panel below is collapsed until you open it.');
    advCard.appendChild(advH); advCard.appendChild(advHelp);
    let advCount = 0;

    // -- Loudness meter (EBU R128) --
    if (r128 && isFinite(r128.integrated)) {
      const { det, body } = aAdvPanel('Loudness meter (EBU R128)',
        'The complete broadcast and streaming loudness set. Integrated loudness is the overall figure with silence ignored (gated, per ITU-R BS.1770); momentary (400 ms) and short-term (3 s) are the loudest brief windows; Loudness Range (LRA) is the spread between the quiet and loud passages; True peak is the real peak that falls between samples, found by oversampling 4x, which ordinary peak meters miss. All measured on the channel-merged signal.',
        true);   // headline panel, open on top (photo/video parity); the rest start closed
      const lt = el('table', { class: 'anr-readout' });
      const lufs = (v) => isFinite(v) ? v.toFixed(1) + ' LUFS' : '-';
      lt.appendChild(rowHelp('Integrated (gated)', lufs(r128.integrated),
        'The overall loudness of the whole file with silent gaps left out. Streaming targets: Spotify/YouTube −14, Apple −16, broadcast (EBU R128) −23 LUFS.'));
      lt.appendChild(rowHelp('Momentary max', lufs(r128.momentaryMax),
        'The loudest short 400 ms window - the peak of brief, punchy moments.'));
      lt.appendChild(rowHelp('Short-term max', lufs(r128.shortTermMax),
        'The loudest 3-second window - the peak of longer, sustained loud passages.'));
      lt.appendChild(rowHelp('Loudness range (LRA)', r128.lra != null ? r128.lra.toFixed(1) + ' LU' : '-',
        'The spread between the quiet and loud parts of the track (from the 10th to the 95th percentile of short-term loudness). A low range (under about 5 LU) means a flat, heavily compressed master; a high range means a dynamic one.'));
      if (tpDb != null) {
        const over = tpDb > 0;
        const tpRow = rowHelp('True peak', tpDb.toFixed(1) + ' dBTP' + (over ? '  (over 0 - inter-sample clipping)' : ''),
          'The real loudest point, including peaks that fall between samples (found by oversampling 4x). Anything above 0 dBTP can distort on playback even when no single sample looks clipped; delivery specs usually cap this at −1 dBTP.');
        if (over) tpRow.querySelector('td').style.color = 'var(--accent)';
        lt.appendChild(tpRow);
      }
      body.appendChild(lt);
      // Loudness-over-time (momentary series).
      if (r128.series && r128.series.length > 4) body.appendChild(drawLoudnessGraph(r128.series, r128.duration, audioEl));
      advCard.appendChild(det); advCount++;
    }

    // -- Spectral forensics (each its own panel) --
    if (spec) {
      // Lossy-transcode / fake-lossless verdict.
      {
        const tr = analyzeTranscode(spec, { declaredLossless });
        const { det, body } = aAdvPanel('Lossy-source check',
          'Whether a file that claims to be lossless was really built from a compressed (lossy) source such as MP3 or AAC, judged from where the sound’s high-frequency energy cuts off.');
        const verdictLine = el('p', { class: 'anr-hint', style: 'margin:0 0 8px;'
          + (tr.level === 'bad' ? 'color:var(--accent);' : '') }, tr.verdict);
        body.appendChild(verdictLine);
        const trTbl = el('table', { class: 'anr-readout' });
        trTbl.appendChild(rowHelp('Spectral cutoff', Math.round(tr.cutoffHz).toLocaleString() + ' Hz'
            + '  (' + Math.round(tr.fillFrac * 100) + '% of Nyquist)',
          'The pitch where the sound’s energy suddenly drops away to nothing. A genuine lossless file reaches about 95% or more of the way to its theoretical ceiling (the Nyquist limit); a lossy codec leaves a hard cut-off well below it.'));
        trTbl.appendChild(rowHelp('Rolloff steepness', tr.steepDbPerKHz > 0 ? tr.steepDbPerKHz.toFixed(0) + ' dB/kHz' : '-',
          'How sharply the high-frequency energy is cut off at that ceiling, in decibels per kilohertz. A lossy encode leaves a steep, abrupt drop; genuine lossless audio tapers off gently.'));
        if (tr.sourceGuess) trTbl.appendChild(rowHelp('Likely source', tr.sourceGuess,
          'A best guess at the original compressed format, based on where that cut-off sits. Approximate only, since encoders and their settings vary.'));
        body.appendChild(trTbl);
        advCard.appendChild(det); advCount++;
      }

      // Mains hum / ENF.
      try {
        const hum = analyzeMainsHum(spec);
        const { det, body } = aAdvPanel('Mains hum / ENF',
          'A steady tone at the frequency of the mains electricity supply (50 or 60 Hz), picked up from power lines during a recording. Its exact frequency underpins ENF forensic timestamping and hints at the recording region.');
        const humTbl = el('table', { class: 'anr-readout' });
        if (hum.present) {
          humTbl.appendChild(rowHelp('Mains hum', 'Detected at ' + hum.exactHz.toFixed(2) + ' Hz  (+' + hum.fundamentalDb.toFixed(0) + ' dB)',
            'A steady narrow tone at the frequency of the mains electricity supply, picked up from power lines or nearby equipment. Its exact frequency is what makes ENF forensic timestamping possible.'));
          humTbl.appendChild(rowHelp('Implied region', hum.region,
            'Mains electricity runs at 50 Hz across most of the world and 60 Hz in North America and parts of Asia - so the hum gives a rough hint of where it was recorded.'));
          if (hum.harmonics.length > 1) humTbl.appendChild(rowHelp('Harmonics', hum.harmonics.map((x) => Math.round(x.hz) + ' Hz').join(', '),
            'Steady tones at whole-number multiples of the mains-hum frequency (for example 100, 150 and 200 Hz above a 50 Hz hum), picked up from the power supply along with the hum itself.'));
        } else {
          humTbl.appendChild(rowHelp('Mains hum', 'None detected',
            'No clear 50 or 60 Hz tone was found - either a clean recording, or one where those low frequencies have been filtered out (high-pass filtered).'));
        }
        body.appendChild(humTbl);
        advCard.appendChild(det); advCount++;
      } catch (_) {}

      // Ultrasonic content.
      try {
        const us = analyzeUltrasonic(spec);
        const { det, body } = aAdvPanel('Ultrasonic content',
          'Energy and steady tones above about 18 kHz - too high for people to hear. Content this high can be tracking beacons, device-pairing tones or hidden watermarks.');
        const usTbl = el('table', { class: 'anr-readout' });
        if (!us.supported) {
          usTbl.appendChild(rowHelp('Above 18 kHz', 'N/A at ' + (spec.sampleRate / 1000).toFixed(1) + ' kHz sample rate',
            'The sample rate is too low to carry any meaningful ultrasonic content - it cannot represent frequencies that high (its Nyquist limit is below about 18.5 kHz).'));
        } else {
          usTbl.appendChild(rowHelp('Energy above ' + (us.startHz / 1000) + ' kHz',
            us.ratioDb.toFixed(0) + ' dB below full band' + (us.present ? '  (present)' : '  (negligible)'),
            'How much energy sits in the near-ultrasonic band compared with the whole signal. Steady content this high - inaudible to people - can be tracking beacons, device-pairing tones, or hidden watermarks.'));
          if (us.peaks.length) usTbl.appendChild(rowHelp('Ultrasonic tones',
            us.peaks.map((p) => Math.round(p.hz).toLocaleString() + ' Hz').join(', '),
            'Individual steady tones found in the near-ultrasonic band, listed by frequency. Too high for people to hear, they can be device-pairing tones, tracking beacons or hidden watermarks.'));
        }
        body.appendChild(usTbl);
        advCard.appendChild(det); advCount++;
      } catch (_) {}

      // DTMF touch-tones (only when digits are found).
      if (dtmf && dtmf.digits.length) {
        const { det, body } = aAdvPanel('Touch-tones (DTMF)',
          'Phone touch-tone (DTMF) digits decoded from the audio, read by listening at the 8 standard tone frequencies arranged in row/column pairs (via Goertzel filters) - it recovers numbers dialled in a recording.');
        const dt = el('table', { class: 'anr-readout' });
        dt.appendChild(rowHelp('Dialled digits', dtmf.sequence,
          'The phone touch-tone (DTMF) digits decoded from the audio, read by listening at the 8 standard tone frequencies arranged in row/column pairs (via Goertzel filters) - it recovers numbers that were dialled in a recording.'));
        dt.appendChild(row('Count', String(dtmf.digits.length)));
        body.appendChild(dt);
        const timing = el('details');
        timing.appendChild(el('summary', {}, 'Timing (' + dtmf.digits.length + ')'));
        const dtl = el('table', { class: 'anr-readout' });
        for (const d of dtmf.digits) dtl.appendChild(row(d.digit, formatTime(d.tStart) + ' - ' + formatTime(d.tEnd)));
        timing.appendChild(dtl);
        body.appendChild(timing);
        advCard.appendChild(det); advCount++;
      }
    }

    if (advCount) advCardEl = advCard;
  }

  // ---- Reverse playback (play / download the audio backwards) ----
  resultsEl.appendChild(buildReverseAudioCard(audioBuffer, (file.name || 'audio').replace(/\.[^/.]+$/, ''), renderSignal));

  // ---- Channel picker (multi-channel files) ----
  // For stereo / surround, let the user drive the spectrogram + waveform below off
  // a chosen channel (or the Mix downmix), instead of always analysing the merged
  // mono. Both visuals live in slots that re-render when the channel changes.
  const basename = (file.name || 'spectrogram').replace(/\.[^/.]+$/, '');
  const chans = channelOptions(audioBuffer, mono);
  const specSlot = el('div');
  const waveSlot = el('div');
  let curSpecPanel = null;
  // Filled in below when the Stereo analysis card is built (stereo files only). The
  // AI-separation blend, which lives inside the spectrogram panel, pushes its live
  // mix here so the stereo readout tracks the blend; reset() reverts to the file.
  const stereoSink = { update: null, reset: null };

  function renderSignalViews(idx, showLoader) {
    // A user channel switch (showLoader) rebuilds the spectrogram + waveform and
    // their transports; stop playback first so it doesn't carry on under the new
    // views (and the fresh transports show a clean paused state). showLoader is
    // false only for the initial render, where nothing is playing yet. The rebuild
    // also drops any active separation, so revert the stereo readout to the file.
    if (showLoader) {
      try { audioEl.pause(); } catch (_) {}
      if (stereoSink.reset) stereoSink.reset();
    }
    const sig = chans[idx].data;
    // chans[0] is the Mix downmix (normal stereo playback); chans[i>=1] is source
    // channel i-1 - selecting it solos that channel for playback too, not just the view.
    const soloChannel = idx >= 1 ? idx - 1 : null;
    specSlot.innerHTML = '';
    // On a channel switch the spectrogram recomputes on a deferred timeout, so drop
    // in the standard inline loader (as elsewhere) until the new panel first paints.
    let loader = null;
    if (showLoader) { loader = inlineLoader('Analysing ' + chans[idx].full + '…'); specSlot.appendChild(loader); }
    curSpecPanel = makeSpectrogramPanel(sig, audioBuffer.sampleRate, { basename, audioEl, signal: renderSignal, capture: true, audioBuffer, statsMount: specStatsMount, stereoSink, soloChannel });
    if (loader) curSpecPanel.style.visibility = 'hidden';   // keep the blank canvas out of view behind the bar
    specSlot.appendChild(curSpecPanel);
    waveSlot.innerHTML = '';
    waveSlot.appendChild(buildWaveformCard(file, sig, audioBuffer, audioEl));
    if (loader) {
      const panel = curSpecPanel;
      const clear = () => { loader.remove(); panel.style.visibility = ''; };
      if (panel.firstPaint) panel.firstPaint.then(clear).catch(clear);
      else clear();
    }
  }

  // The Mix/L/R channel selector that drives the spectrogram + waveform. It used to
  // live in its own card above the spectrogram; it now folds into the Stereo analysis
  // card at the bottom (built below), so keep references to drop it in there.
  let chanHead = null, chanHelpPanel = null, chanSeg = null, chanStat = null;
  if (chans.length > 1) {
    const [chanH, chanHelp] = h3help('Channel',
      'This file has ' + audioBuffer.numberOfChannels + ' separate channels. Choose which one feeds the spectrogram and waveform below - <strong>Mix</strong> blends every channel together, or pick a single speaker (Left, Right, Centre, LFE, surrounds) to inspect on its own. The per-channel peak and RMS update with your choice. Speaker names follow the layout the file declares, so treat them as a best guess.');
    const stat = el('span', { class: 'anr-chan-readout' });
    const seg = el('div', { class: 'anr-btn-row anr-chan-seg' });
    const btns = [];
    const setActive = (i) => {
      btns.forEach((b, j) => b.classList.toggle('is-active', j === i));
      const s = computeStats(chans[i].data);
      stat.textContent = chans[i].full + ' · peak ' + s.peakDb.toFixed(1) + ' dBFS · RMS ' + s.rmsDb.toFixed(1) + ' dBFS';
    };
    chans.forEach((c, i) => {
      const b = el('button', { type: 'button', class: 'anr-btn', title: c.full }, c.short);
      b.addEventListener('click', () => { setActive(i); renderSignalViews(i, true); });
      btns.push(b); seg.appendChild(b);
    });
    setActive(0);
    chanHead = chanH; chanHelpPanel = chanHelp; chanSeg = seg; chanStat = stat;
  }

  // ---- Spectrogram (leads the analysis, above the file-info card) ----
  // The spectrogram is the headline visual, so it sits at the very top of the
  // result - above the file info + player. (opts.spectrogramFirst predates this
  // being the default and is kept for the image-sonify caller; the placement is
  // now the same either way.)
  resultsEl.insertBefore(specSlot, infoCard);

  // ---- Embedded cover art (filled in asynchronously so it doesn't block) ----
  const coverSlot = el('div');
  resultsEl.appendChild(coverSlot);
  extractCoverArt(file).then((art) => {
    if (art && art.bytes && art.bytes.length) coverSlot.appendChild(buildCoverArtCard(art, file, resultsEl));
  }).catch(() => {});

  // ---- Embedded tags + lyrics (async, non-blocking) ----
  const tagSlot = el('div');
  resultsEl.appendChild(tagSlot);
  readAudioTags(file).then((meta) => {
    if (!meta) return;
    if (meta.tags && meta.tags.length) {
      const card = el('div', { class: 'anr-card' });
      card.appendChild(el('h3', {}, 'Tags'));
      const tbl = el('table', { class: 'anr-readout' });
      for (const [name, value] of meta.tags) tbl.appendChild(tagRow(name, value));
      card.appendChild(tbl);
      tagSlot.appendChild(card);
    }
    if (meta.lyrics) {
      const card = el('div', { class: 'anr-card' });
      card.appendChild(el('h3', {}, 'Lyrics'));
      card.appendChild(el('pre', { class: 'anr-lyrics' }, meta.lyrics));
      tagSlot.appendChild(card);
    }
  }).catch(() => {});

  // ---- Waveform card ----
  resultsEl.appendChild(waveSlot);

  // Fill the spectrogram + waveform slots now that both are in the DOM (Mix by default).
  renderSignalViews(0);

  // ---- Stereo Width / Vectorscope card (stereo files only) ----
  if (audioBuffer.numberOfChannels >= 2) {
    const origLeft  = audioBuffer.getChannelData(0);
    const origRight = audioBuffer.getChannelData(1);

    const stereoCard = el('div', { class: 'anr-card' });
    const [stH, stHelp] = h3help('Stereo analysis', '<strong>Phase correlation</strong> measures how alike the left and right channels are. +1 means identical (effectively mono), 0 means unrelated, and negative means they fight each other (out of phase, which can cancel out on a single mono speaker).<br><strong>Stereo width</strong> comes from that correlation. Higher means a wider stereo image.<br><strong>Mid/Side</strong> splits the sound into its centre (mid) and its left-right difference (side).<br>The <strong>vectorscope</strong> plots the left channel against the right. A vertical line means mono; a rounded blob means wide stereo; a horizontal line means out of phase.<br>These describe the file&#39;s original Left/Right pair, so they do not change when you switch Channel below (which only affects the spectrogram and waveform). After AI vocal separation they follow the current blend mix instead.');
    stereoCard.appendChild(stH); stereoCard.appendChild(stHelp);
    // Muted source line: shows when the readout reflects the separation blend rather
    // than the file itself (hidden by default = the file's own Left/Right).
    const stereoSrc = el('div', { class: 'anr-sel-label', style: 'margin:0 0 10px;', hidden: true });
    stereoCard.appendChild(stereoSrc);

    // Build the value rows once and keep handles so updates just rewrite the cells
    // (no per-frame DOM churn while the blend slider drags).
    const corrRow = rowHelp('Phase correlation', '', 'How alike the left and right channels are. +1 means identical (mono), 0 means unrelated, negative means out of phase (a problem on a single mono speaker).');
    const widthRow = rowHelp('Stereo width', '', 'How wide apart the two channels sound. 0 means mono (no width), 1 means the widest stereo spread.');
    const midRow = rowHelp('Mid level', '', 'The centre (mono) part of the sound: left and right added together, (L+R)/2. This carries vocals, bass and anything panned to the middle.');
    const sideRow = rowHelp('Side level', '', 'The stereo-difference part of the sound: left minus right, (L−R)/2. This carries reverb, panned instruments and the sense of space.');
    const ratioRow = rowHelp('Side / Mid ratio', '', 'How much side (stereo) energy there is compared with mid (centre) energy. Below 0.5 means a centre-heavy mix; above 1.0 means a very wide, spacious mix.');
    const stereoTbl = el('table', { class: 'anr-readout' });
    stereoTbl.append(corrRow, widthRow, midRow, sideRow, ratioRow);
    stereoCard.appendChild(stereoTbl);
    const cell = (tr) => tr.lastElementChild;

    // Vectorscope canvas
    const vsCanvas = el('canvas', { width: '200', height: '200', style: 'display:block; margin:8px auto 0;' });
    stereoCard.appendChild(vsCanvas);

    // Paint the readout + scope from a stats object and an L/R pair (which may be a
    // subsampled blend). `note` (non-empty) flags a blend source line.
    function paintStereo(stats, left, right, note) {
      const corrPct  = (stats.correlation * 100).toFixed(1);
      const corrHint = stats.correlation > 0.8 ? 'mono-like'
                     : stats.correlation < -0.2 ? 'out of phase'
                     : stats.correlation < 0.3 ? 'wide' : 'normal';
      cell(corrRow).textContent = stats.correlation.toFixed(3) + '  (' + corrPct + '%, ' + corrHint + ')';
      cell(widthRow).textContent = stats.width.toFixed(3);
      cell(midRow).textContent = stats.midLevel.toFixed(4);
      cell(sideRow).textContent = stats.sideLevel.toFixed(4);
      cell(ratioRow).textContent = stats.midLevel > 1e-12 ? (stats.sideLevel / stats.midLevel).toFixed(3) : '-';
      renderVectorscope(vsCanvas, left, right);
      if (note) { stereoSrc.textContent = note; stereoSrc.hidden = false; }
      else stereoSrc.hidden = true;
    }
    // Initial paint = the file's own Left/Right.
    paintStereo(computeStereoStats(origLeft, origRight), origLeft, origRight, null);
    // Wire the sink the separation blend pushes to. update() takes a precomputed
    // stats object + a (subsampled) L/R for the scope; reset() restores the file.
    stereoSink.update = (stats, left, right) => paintStereo(stats, left, right, 'Reflecting the current vocal-instrumental blend');
    stereoSink.reset = () => paintStereo(computeStereoStats(origLeft, origRight), origLeft, origRight, null);

    // Channel selector (Mix/L/R) folded in here as a sub-section - it drives the
    // spectrogram + waveform higher up the page. The 'Channel' h3 gives the same
    // visual break between it and the stereo stats above.
    if (chanSeg) stereoCard.append(chanHead, chanHelpPanel, chanSeg, chanStat);

    resultsEl.appendChild(stereoCard);
  }

  // Advanced sits last, below every other card.
  if (advCardEl) resultsEl.appendChild(advCardEl);

  // Keep the bottom "Reading…" loader up until the spectrogram has actually
  // painted (it computes on a deferred timeout after the cards are built), so the
  // bar doesn't vanish while the main visual is still blank.
  if (curSpecPanel && curSpecPanel.firstPaint) { try { await curSpecPanel.firstPaint; } catch (_) {} }
}

// --- Compact streaming spectrogram (mic visual for the Record card) ---
// Attaches a scrolling log-scale spectrogram to `mountEl`, fed live from
// `source` (a MediaStreamAudioSourceNode on audio context `ac`). Returns a
// stop() that ends the draw loop and disconnects the analyser. Mirrors the
// rendering in startLive() but stripped of controls - just the live visual.
function streamSpectrogram(ac, source, mountEl) {
  const analyser = ac.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);

  const wrap     = el('div', { class: 'anr-spec-wrap' });
  const yWrap    = el('div', { class: 'anr-spec-yaxis-wrap' });
  const axisY    = el('div', { class: 'anr-spec-yaxis' });
  yWrap.appendChild(axisY);
  const scrollEl = el('div', { class: 'anr-spec-scroll' });
  const canvas   = el('canvas', { class: 'anr-spec-canvas' });
  scrollEl.appendChild(canvas);
  wrap.appendChild(yWrap); wrap.appendChild(scrollEl);
  mountEl.appendChild(wrap);

  const height = 240;
  const ctxC = canvas.getContext('2d');
  function sizeCanvas() {
    const newW = Math.max(200, (wrap.clientWidth || 600) - 48);
    if (newW === canvas.width && height === canvas.height) return;
    canvas.width = newW; canvas.height = height;
    canvas.style.width = newW + 'px'; canvas.style.height = height + 'px';
    ctxC.fillStyle = '#0a0a0a'; ctxC.fillRect(0, 0, newW, height);
  }
  sizeCanvas();
  buildFreqAxis(axisY, ac.sampleRate, 'log');

  let raf, stopped = false;
  function onResize() { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { sizeCanvas(); }); }
  window.addEventListener('resize', onResize);

  let dbData = new Float32Array(analyser.frequencyBinCount);
  const cmap = colormaps.magma || colormaps.viridis;
  const nyq = ac.sampleRate / 2;
  const dbFloor = -100, dbCeil = -10, range = dbCeil - dbFloor;
  const drawW = 1;
  const logMin = Math.log10(10), logMax = Math.log10(nyq);   // 10 Hz floor to match buildFreqAxis (shows sub-20 Hz)

  function tick() {
    if (stopped) return;
    const bins = analyser.frequencyBinCount;
    if (dbData.length !== bins) dbData = new Float32Array(bins);
    analyser.getFloatFrequencyData(dbData);
    const w = canvas.width, h = canvas.height;
    if (w <= drawW || h <= 0) { raf = requestAnimationFrame(tick); return; }
    // Scroll the existing bitmap one column left, draw the newest FFT slice at the right edge.
    const img = ctxC.getImageData(drawW, 0, w - drawW, h);
    ctxC.putImageData(img, 0, 0);
    const colImg = ctxC.createImageData(drawW, h);
    for (let y = 0; y < h; y++) {
      const frac = 1 - y / (h - 1);
      const hz = Math.pow(10, logMin + frac * (logMax - logMin));
      const binF = (hz / nyq) * bins;
      const b0 = Math.max(0, Math.min(bins - 1, Math.floor(binF)));
      const b1 = Math.max(0, Math.min(bins - 1, b0 + 1));
      const k  = binF - b0;
      const db = dbData[b0] + (dbData[b1] - dbData[b0]) * k;
      let t = (db - dbFloor) / range;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const [r, g, bl] = cmap(t);
      const o = y * drawW * 4;
      colImg.data[o] = r; colImg.data[o + 1] = g; colImg.data[o + 2] = bl; colImg.data[o + 3] = 255;
    }
    ctxC.putImageData(colImg, w - drawW, 0);
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  return function stop() {
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    try { analyser.disconnect(); } catch (_) {}
    try { source.disconnect(); } catch (_) {}
  };
}

// --- Recording UI ---
async function startRecording(resultsEl, recordBtn) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    resultsEl.hidden = false;
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Microphone access denied or unavailable.'));
    return;
  }

  const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']
    .find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  resultsEl.hidden = false;
  resultsEl.innerHTML = '';

  const liveCard = el('div', { class: 'anr-card anr-spec-card' });
  liveCard.appendChild(el('h3', {}, 'Recording...'));
  const timer = el('p', { class: 'anr-hint' }, '0.0 s');
  liveCard.appendChild(timer);

  // Live spectrogram of the mic while recording. Feeds off the same stream; a
  // failure here must not abort the take, so it is best-effort.
  let stopSpec = null;
  try {
    const ac = ctx();
    await ac.resume();
    stopSpec = streamSpectrogram(ac, ac.createMediaStreamSource(stream), liveCard);
  } catch (_) {}

  const stopBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Stop');
  liveCard.appendChild(stopBtn);
  resultsEl.appendChild(liveCard);
  try { liveCard.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}

  const startMs = performance.now();
  const tick = setInterval(() => {
    timer.textContent = ((performance.now() - startMs) / 1000).toFixed(1) + ' s';
  }, 100);

  rec.start();
  recordBtn.classList.add('is-recording');
  // Expose a stop handle so the same Record button (or the panel's) can end the take -
  // not just the in-card Stop button. Cleared in finish().
  recordBtn._stopRec = () => { try { rec.stop(); } catch (_) {} };

  return new Promise((resolve) => {
    function finish() {
      clearInterval(tick);
      if (stopSpec) stopSpec();
      recordBtn.classList.remove('is-recording');
      recordBtn._stopRec = null;
      stream.getTracks().forEach((t) => t.stop());
    }
    rec.onstop = async () => {
      finish();
      const blob = new Blob(chunks, { type: mime || 'audio/webm' });
      const ext = (mime.match(/audio\/(\w+)/) || [, 'webm'])[1];
      const file = new File([blob], 'recording.' + ext, { type: blob.type });
      await renderAudio(file, resultsEl, { download: true });
      resolve(file);
    };
    stopBtn.addEventListener('click', () => rec.stop());
  });
}

// --- Live spectrogram (no recording, just visualise the mic) ---
async function startLive(resultsEl, liveBtn) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    resultsEl.hidden = false;
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Microphone access denied or unavailable.'));
    return;
  }

  const ac = ctx();
  await ac.resume();
  const src = ac.createMediaStreamSource(stream);
  const analyser = ac.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0;
  src.connect(analyser);

  // Rolling capture of the last CAPTURE_SECONDS of raw mic audio so it can be
  // re-analysed properly (different FFT / window / sensitivity) - the live
  // AnalyserNode can't re-process the past. A ScriptProcessor copies every sample
  // into a ring buffer; a zero-gain sink keeps it running without routing the mic
  // to the speakers (which would feed back).
  const CAPTURE_SECONDS = 15;
  const ringLen = Math.max(1, Math.floor(ac.sampleRate * CAPTURE_SECONDS));
  const ring = new Float32Array(ringLen);
  let ringWrite = 0, ringFilled = 0;
  const capNode = ac.createScriptProcessor(4096, 1, 1);
  capNode.onaudioprocess = (e) => {
    const inp = e.inputBuffer.getChannelData(0);
    for (let i = 0; i < inp.length; i++) {
      ring[ringWrite] = inp[i];
      ringWrite = (ringWrite + 1) % ringLen;
      if (ringFilled < ringLen) ringFilled++;
    }
  };
  const capSink = ac.createGain();
  capSink.gain.value = 0;
  src.connect(capNode);
  capNode.connect(capSink);
  capSink.connect(ac.destination);
  function captureSnapshot() {
    const n = ringFilled;
    const out = new Float32Array(n);
    const start = ringFilled < ringLen ? 0 : ringWrite;   // oldest sample first
    for (let i = 0; i < n; i++) out[i] = ring[(start + i) % ringLen];
    return out;
  }

  resultsEl.hidden = false;
  resultsEl.innerHTML = '';


  // --- card / controls ---
  const card = el('div', { class: 'anr-card anr-spec-card' });
  card.appendChild(el('h3', {}, 'Live spectrogram'));

  const controls = el('div', { class: 'anr-controls' });
  const toggle = el('div', { class: 'anr-toggle' });
  const btnLog = el('button', { type: 'button', class: 'is-active' }, 'LOG');
  const btnLin = el('button', { type: 'button' }, 'LINEAR');
  toggle.appendChild(btnLog); toggle.appendChild(btnLin);

  const fftSel    = el('select', {}, ['512','1024','2048','4096','8192'].map((v) => el('option', { value: v }, v)));
  fftSel.value = '2048';
  const cmapSel   = el('select', {}, Object.keys(colormaps).map((v) => el('option', { value: v }, v)));
  cmapSel.value = 'magma';
  const heightSel = el('select', {}, ['240','320','420','560','720','900'].map((v) => el('option', { value: v }, v + 'px')));
  heightSel.value = '320';
  const speedSel  = el('select', {}, [['0.5','Slowest'],['1','Slow'],['2','Normal'],['3','Fast'],['4','Faster'],['6','Fastest']].map(([v,l]) => el('option', { value: v }, l)));
  speedSel.value = '1';
  // Fullscreen is desktop-only (see makeSpectrogramPanel) - dropped on touch.
  const allowFs = !window.matchMedia('(pointer: coarse)').matches;
  const ico = specIco;
  const saveBtn   = el('button', { type: 'button', class: 'anr-btn' }, [ico('<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 1v8M3 6l4 4 4-4"/><path d="M1 11v2h12v-2"/></svg>'), 'Save PNG']);
  const fsBtn     = allowFs ? el('button', { type: 'button', class: 'anr-btn' }, [ico('<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9"/></svg>'), 'Fullscreen']) : null;
  const recBtn    = el('button', { type: 'button', class: 'anr-btn' }, [ico('<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" fill="currentColor"/></svg>'), 'Record']);
  const pauseBtn  = el('button', { type: 'button', class: 'anr-btn' }, [ico('<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="2" y="1" width="3.5" height="12"/><rect x="8.5" y="1" width="3.5" height="12"/></svg>'), 'Pause']);
  // Live is already on here, so this reads as the active half of the on/off toggle;
  // clicking it exits live (closeLive, wired below).
  const liveToggleBtn = el('button', { type: 'button', class: 'anr-btn is-active' }, [ico('<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" fill="currentColor"/></svg>'), 'Live spectrogram']);
  // Grabs the last CAPTURE_SECONDS of captured audio and opens it as a full static
  // analysis (re-analysable with different FFT / window / sensitivity). Wired below.
  const captureBtn = el('button', { type: 'button', class: 'anr-btn' }, [ico('<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 1v8M3 6l4 4 4-4"/><path d="M1 11v2h12v-2"/></svg>'), 'Analyse last ' + CAPTURE_SECONDS + 's']);

  // Same segmented grouping as the file panel: View / Resolution / Actions.
  const ctl = specCtl, group = specGroup;

  controls.appendChild(group('View', [
    ctl('Axis', toggle),
    ctl('Colour', cmapSel),
    el('div', { class: 'anr-control anr-ctl-height' }, [el('label', {}, 'Height'), heightSel]),
    ctl('Speed', speedSel),
  ]));
  controls.appendChild(specAdvanced([
    ctl('FFT', fftSel),
  ]));
  const liveActions = [ctl('', saveBtn)];
  if (fsBtn) liveActions.push(ctl('', fsBtn));
  liveActions.push(ctl('', recBtn), ctl('', liveToggleBtn), ctl('', captureBtn), ctl('', pauseBtn));
  controls.appendChild(group('Actions', liveActions));
  card.appendChild(controls);

  // --- body (yaxis + scroll/canvas), no x-axis (no fixed time in live mode) ---
  const wrap     = el('div', { class: 'anr-spec-wrap' });
  const yWrap    = el('div', { class: 'anr-spec-yaxis-wrap' });
  const axisY    = el('div', { class: 'anr-spec-yaxis' });
  yWrap.appendChild(axisY);
  const scrollEl = el('div', { class: 'anr-spec-scroll' });
  const canvas   = el('canvas', { class: 'anr-spec-canvas' });
  scrollEl.appendChild(canvas);
  wrap.appendChild(yWrap); wrap.appendChild(scrollEl);
  card.appendChild(wrap);
  resultsEl.appendChild(card);
  try { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}

  let state = { scale: 'log', cmap: 'magma', height: 320 };

  function isFs() { return document.fullscreenElement === card; }
  function availableWidth()  { return Math.max(200, (wrap.clientWidth || 600) - 48); }
  function availableHeight() { return Math.max(160, (wrap.clientHeight || state.height) - 2); }

  const ctxC = canvas.getContext('2d');

  // Resizing the canvas wipes its bitmap, which would lose the streaming
  // history in live mode. `preserve` snapshots the old contents into a temp
  // canvas, then redraws the rightmost slice (most recent audio) anchored
  // to the right edge of the new size - so the stream visually continues
  // instead of restarting from black.
  function sizeCanvas(preserve = true) {
    const newW = availableWidth();
    const newH = isFs() ? availableHeight() : state.height;
    if (newW === canvas.width && newH === canvas.height) return;

    if (preserve && canvas.width && canvas.height) {
      // Copy old content into a temp canvas, then redraw scaled-or-cropped
      const tmp = document.createElement('canvas');
      tmp.width  = canvas.width;
      tmp.height = canvas.height;
      tmp.getContext('2d').drawImage(canvas, 0, 0);
      canvas.width  = newW;
      canvas.height = newH;
      canvas.style.width  = newW + 'px';
      canvas.style.height = newH + 'px';
      ctxC.fillStyle = '#0a0a0a';
      ctxC.fillRect(0, 0, newW, newH);
      // Keep the rightmost portion at the right edge (visual continuity)
      const drawW = Math.min(tmp.width, newW);
      const drawH = Math.min(tmp.height, newH);
      ctxC.drawImage(tmp,
        tmp.width - drawW, tmp.height - drawH, drawW, drawH,
        newW - drawW,      newH - drawH,      drawW, drawH);
    } else {
      canvas.width  = newW;
      canvas.height = newH;
      canvas.style.width  = newW + 'px';
      canvas.style.height = newH + 'px';
      ctxC.fillStyle = '#0a0a0a';
      ctxC.fillRect(0, 0, newW, newH);
    }
  }

  function rebuildAxis() { buildFreqAxis(axisY, ac.sampleRate, state.scale); }

  sizeCanvas(false);
  rebuildAxis();

  btnLog.addEventListener('click', () => { state.scale = 'log';    btnLog.classList.add('is-active'); btnLin.classList.remove('is-active'); rebuildAxis(); });
  btnLin.addEventListener('click', () => { state.scale = 'linear'; btnLin.classList.add('is-active'); btnLog.classList.remove('is-active'); rebuildAxis(); });
  fftSel.addEventListener('change',    () => { analyser.fftSize = parseInt(fftSel.value, 10); });
  cmapSel.addEventListener('change',   () => { state.cmap = cmapSel.value; });
  heightSel.addEventListener('change', () => { state.height = parseInt(heightSel.value, 10); sizeCanvas(); });

  const detachFs = attachFullscreen(card, fsBtn, allowFs, null, () => { requestAnimationFrame(() => sizeCanvas()); });

  let liveRaf;
  function onWinResize() {
    cancelAnimationFrame(liveRaf);
    liveRaf = requestAnimationFrame(() => sizeCanvas());
  }
  window.addEventListener('resize', onWinResize);

  let dbData = new Float32Array(analyser.frequencyBinCount);
  let colW = 1;
  let colAccum = 0;
  let stopped = false;
  let paused = false;
  liveBtn.classList.add('is-active');
  speedSel.addEventListener('change', () => { colW = parseFloat(speedSel.value); });

  function tick() {
    if (stopped) return;
    if (paused) return requestAnimationFrame(tick);
    const bins = analyser.frequencyBinCount;
    if (dbData.length !== bins) dbData = new Float32Array(bins);
    analyser.getFloatFrequencyData(dbData);

    colAccum += colW;
    const drawW = Math.floor(colAccum);
    if (drawW < 1) return requestAnimationFrame(tick);
    colAccum -= drawW;

    const w = canvas.width, h = canvas.height;
    if (w <= drawW || h <= 0) return requestAnimationFrame(tick);

    const img = ctxC.getImageData(drawW, 0, w - drawW, h);
    ctxC.putImageData(img, 0, 0);
    ctxC.fillStyle = '#0a0a0a';
    ctxC.fillRect(w - drawW, 0, drawW, h);

    const cmap = colormaps[state.cmap] || colormaps.viridis;
    const nyq = ac.sampleRate / 2;
    const dbFloor = -100, dbCeil = -10;
    const range = dbCeil - dbFloor;
    const colImg = ctxC.createImageData(drawW, h);

    for (let y = 0; y < h; y++) {
      let binF;
      if (state.scale === 'log') {
        const logMin = Math.log10(10);   // 10 Hz floor to match buildFreqAxis (shows sub-20 Hz)
        const logMax = Math.log10(nyq);
        const frac = 1 - y / (h - 1);
        const hz = Math.pow(10, logMin + frac * (logMax - logMin));
        binF = (hz / nyq) * bins;
      } else {
        const frac = 1 - y / (h - 1);
        binF = frac * bins;
      }
      const b0 = Math.max(0, Math.min(bins - 1, Math.floor(binF)));
      const b1 = Math.max(0, Math.min(bins - 1, b0 + 1));
      const k  = binF - b0;
      const db = dbData[b0] + (dbData[b1] - dbData[b0]) * k;
      let t = (db - dbFloor) / range;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const [r, g, bl] = cmap(t);
      for (let x = 0; x < drawW; x++) {
        const o = (y * drawW + x) * 4;
        colImg.data[o]     = r;
        colImg.data[o + 1] = g;
        colImg.data[o + 2] = bl;
        colImg.data[o + 3] = 255;
      }
    }
    ctxC.putImageData(colImg, w - drawW, 0);

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  saveBtn.addEventListener('click', () => specSavePng(canvas, 'live-spectrogram'));

  // Pause and the Live toggle drive the same `paused` flag (the tick loop just
  // freezes when paused - the mic stream stays open). applyPause keeps both
  // buttons' visuals in sync: the Live toggle reads active while live is running.
  function applyPause() {
    const pauseIco = paused
      ? '<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><polygon points="2,1 13,7 2,13"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="2" y="1" width="3.5" height="12"/><rect x="8.5" y="1" width="3.5" height="12"/></svg>';
    pauseBtn.innerHTML = '<span style="display:inline-flex;align-items:center;vertical-align:middle;margin-right:6px;">' + pauseIco + '</span>' + (paused ? 'Resume' : 'Pause');
    liveToggleBtn.classList.toggle('is-active', !paused);
  }
  pauseBtn.addEventListener('click', () => { paused = !paused; applyPause(); });

  let liveRec = null;
  recBtn.addEventListener('click', () => {
    if (liveRec) {
      liveRec.stop();
      return;
    }
    const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']
      .find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
    liveRec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    liveRec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    liveRec.onstop = async () => {
      recBtn.classList.remove('is-recording');
      recBtn.innerHTML = '<span style="display:inline-flex;align-items:center;vertical-align:middle;margin-right:6px;"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" fill="currentColor"/></svg></span>Record';
      const blob = new Blob(chunks, { type: mime || 'audio/webm' });
      const ext = (mime.match(/audio\/(\w+)/) || [, 'webm'])[1];
      const file = new File([blob], 'recording.' + ext, { type: blob.type });
      liveRec = null;
      stopped = true;
      liveBtn.classList.remove('is-active');
      stream.getTracks().forEach((t) => t.stop());
      try { src.disconnect(); } catch (_) {}
      teardownCapture();
      detachFs();
      window.removeEventListener('resize', onWinResize);
      await renderAudio(file, resultsEl, { download: true });
    };
    liveRec.start();
    recBtn.classList.add('is-recording');
    recBtn.innerHTML = '<span style="display:inline-flex;align-items:center;vertical-align:middle;margin-right:6px;"><svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="2" y="2" width="10" height="10"/></svg></span>Stop rec';
  });

  function teardownCapture() {
    try { capNode.disconnect(); } catch (_) {}
    try { capSink.disconnect(); } catch (_) {}
    capNode.onaudioprocess = null;
  }

  function closeLive() {
    if (stopped) return;
    stopped = true;
    liveBtn.classList.remove('is-active');
    stream.getTracks().forEach((t) => t.stop());
    try { src.disconnect(); } catch (_) {}
    teardownCapture();
    detachFs();
    window.removeEventListener('resize', onWinResize);
    liveBtn.removeEventListener('click', closeLive);
    if (document.fullscreenElement === card) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    }
    card.remove();
    if (!resultsEl.children.length) resultsEl.hidden = true;
  }
  liveBtn.addEventListener('click', closeLive);
  // Disabling the in-card Live toggle pauses the stream rather than closing it.
  liveToggleBtn.addEventListener('click', () => { paused = !paused; applyPause(); });
  // Grab the buffered audio, stop live, and open it as a full static analysis so
  // it can be re-examined with different FFT / window / sensitivity.
  captureBtn.addEventListener('click', () => {
    const samples = captureSnapshot();
    if (!samples.length) return;
    const buf = ac.createBuffer(1, samples.length, ac.sampleRate);
    buf.getChannelData(0).set(samples);
    const wavBlob = encodeWav(buf);
    const secs = (samples.length / ac.sampleRate).toFixed(1);
    const file = new File([wavBlob], 'live-capture-' + secs + 's.wav', { type: 'audio/wav' });
    closeLive();
    renderAudio(file, resultsEl);
  });
}

// --- Setup ---
// dropEl / inputEl are optional: the single "any file" hero layout wires only the
// Record / Live buttons here (its drop + picker go through initVideo instead), so
// each piece is guarded rather than assumed present.
export function initAudio({ dropEl, inputEl, recordBtn, liveBtn, resultsEl, onFile }) {
  const handle = onFile || ((file) => renderAudio(file, resultsEl));

  if (inputEl) inputEl.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handle(file);
    inputEl.value = '';
  });

  // Visual highlight only; the actual drop is handled at the window level
  if (dropEl) {
    ['dragenter', 'dragover'].forEach((ev) =>
      dropEl.addEventListener(ev, () => dropEl.classList.add('is-dragover'))
    );
    ['dragleave', 'drop'].forEach((ev) =>
      dropEl.addEventListener(ev, () => dropEl.classList.remove('is-dragover'))
    );
  }

  if (recordBtn) recordBtn.addEventListener('click', () => {
    if (recordBtn.classList.contains('is-recording')) { if (recordBtn._stopRec) recordBtn._stopRec(); return; }
    startRecording(resultsEl, recordBtn);
  });

  if (liveBtn) liveBtn.addEventListener('click', () => {
    if (liveBtn.classList.contains('is-active')) return;
    startLive(resultsEl, liveBtn);
  });
}
