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
import { makePlayer, playerAudioNode, onSharedVolume, sharedVolume } from './audio-player.js';
import { encodeWav } from './video-avi.js';
import { buildReverseAudioCard } from './media-reverse.js';

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

// Per-metric explanations for the stats block's [?] info panel.
const SPEC_STATS_HELP =
  '<strong>Peak</strong> When the audio is loudest &mdash; the timestamp of the loudest moment and its level (RMS over a 50&nbsp;ms window, in dBFS).<br>' +
  '<strong>Detected</strong> The band that actually carries energy &mdash; the lowest to highest frequency staying within ' + SIGNAL_DB + '&nbsp;dB of the peak.<br>' +
  '<strong>Cutoff</strong> The highest frequency present. A hard ceiling well below 20&nbsp;kHz is the tell-tale lowpass of lossy encoding (MP3 / AAC), and its height hints at the bitrate. Accurate to &plusmn;half an FFT bin &mdash; raise FFT to refine.<br>' +
  '<strong>Dyn. range</strong> The gap between the peak and the noise floor (the 10th-percentile bin). Larger means cleaner with more headroom; small means noisy or heavily compressed.<br>' +
  '<strong>Resolution</strong> The current analysis grid &mdash; hertz per frequency bin and milliseconds per time frame. Set by FFT size: finer in one axis is always coarser in the other.';

// Build the stats header (caption + [?] info toggle) once. The grid of values
// below it is (re)filled by buildSpecStats on every recompute.
function specStatsHelp() {
  const btn = el('button', { type: 'button', class: 'anr-info-btn', title: 'What do these mean?' }, '[?]');
  const panel = el('div', { class: 'anr-info-panel is-hidden', html: SPEC_STATS_HELP });
  const head = el('div', { class: 'anr-spec-stats-head' }, [
    el('span', { class: 'anr-spec-stats-title' }, 'Analysis'),
    btn,
  ]);
  wireInfoToggle(btn, panel);
  return [head, panel];
}

function buildSpecStats(statsEl, st, fftSize, sampleRate, loud) {
  const hzBin = sampleRate / fftSize;
  const msHop = Math.floor(fftSize / 4) / sampleRate * 1000;
  // A stat cell: caption on top, value below, with an optional muted suffix
  // (units / tolerance) trailing the value.
  const cell = (lbl, val, sub) => el('div', { class: 'anr-spec-stat' }, [
    el('span', { class: 'anr-spec-stat-label' }, lbl),
    el('span', { class: 'anr-spec-stat-val' },
      sub ? [val, el('span', { class: 'anr-spec-stat-sub' }, ' ' + sub)] : val),
  ]);
  statsEl.innerHTML = '';
  statsEl.append(
    cell('Peak',       loud ? fmtClock(loud.time) : '-',
                       loud && isFinite(loud.db) ? loud.db.toFixed(1) + ' dBFS' : ''),
    cell('Detected',   st.lowHz == null ? '-' : formatHz(st.lowHz) + '–' + formatHz(st.highHz) + ' Hz'),
    // Exact high-frequency cutoff (the lossy-encode lowpass edge for compressed
    // audio). Resolution is one FFT bin (hzBin), so ±hzBin/2 - raise FFT to refine.
    cell('Cutoff',     st.highHz == null ? '-' : Math.round(st.highHz).toLocaleString() + ' Hz',
                       st.highHz == null ? '' : '±' + Math.round(hzBin / 2)),
    cell('Dyn. range', st.dynRange == null ? '-' : st.dynRange.toFixed(0) + ' dB'),
    cell('Resolution', formatHz(hzBin) + ' Hz/bin', msHop.toFixed(0) + ' ms/frame'),
  );
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
    '<strong>Axis</strong> Log maps frequencies logarithmically (closer to human hearing). Linear spaces them evenly.<br>' +
    '<strong>Mode</strong> STFT is the standard windowed FFT. Reassigned sharpens both the time and frequency axes at once by moving each cell’s energy to its true centre - thin ridges instead of blurred blobs - using the same FFT (3× the compute).<br>' +
    '<strong>FFT</strong> Fast Fourier Transform window size. Larger = better frequency resolution but lower time resolution.<br>' +
    '<strong>Window</strong> Windowing function applied before the FFT. Hann is a good default; Blackman reduces spectral leakage; Rect (rectangular) applies no smoothing.<br>' +
    '<strong>Colour</strong> Colour mapping for intensity values. Magma, viridis, and inferno are perceptually uniform.<br>' +
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
  if (isoBtn) actions.unshift(ctl('', isoBtn));   // Isolate sits leftmost in the Actions row
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
  const [statsHead, statsInfo] = specStatsHelp();
  card.appendChild(el('div', { class: 'anr-spec-statsblock' }, [statsHead, statsInfo, stats]));

  const status = el('p', { class: 'anr-hint anr-spec-hint', style: 'margin: 6px 0 0; text-align: right;' }, 'computing...');
  card.appendChild(status);

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
  modeSel.addEventListener('change',   () => { state.mode    = modeSel.value; recompute(); });
  fftSel.addEventListener('change',    () => { state.fftSize = parseInt(fftSel.value, 10); recompute(); });
  winSel.addEventListener('change',    () => { state.winName = winSel.value; recompute(); });
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
    // Preset bar + its state, filled in the presets block below (kept empty here so
    // it can be a child of the panel before the band helpers exist).
    const presetBar = el('div', { class: 'anr-iso-presets' });
    const presetBtns = {};
    let activePreset = null, applyingPreset = false;
    // AI stem separation: a real model, unlike the EQ presets. Wired in the block
    // further down; the elements live here so they can sit inside the panel.
    const aiBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm anr-iso-ai' }, 'Separate vocals (AI)');
    const aiStatus = el('div', { class: 'anr-iso-aistatus', hidden: true });
    const aiStems = el('div', { class: 'anr-iso-stems' });
    // Short explanation, sat permanently under the "Separate" section label so the
    // AI feature reads as its own thing, distinct from the EQ presets above.
    const aiInfo = el('p', { class: 'anr-hint anr-iso-hint' },
      'This uses a real AI model to split the track into separate vocal and instrumental stems - a true separation, not a frequency cut. It runs entirely on your device and nothing is uploaded. The first run downloads the model once, then works offline.');
    // Two labelled tiers: the EQ isolation tools (presets + manual bands + WAV
    // export) on top, then the on-device AI stem separator as its own block.
    const isoPanel = el('div', { class: 'anr-iso-panel is-hidden' }, [
      el('div', { class: 'anr-iso-sec' }, [
        el('span', { class: 'anr-iso-seclabel' }, 'Isolate'),
        presetBar,
        el('div', { class: 'anr-iso-rule' }),
        el('div', { class: 'anr-iso-actions' }, [
          addBtn,
          el('span', { class: 'anr-iso-draghint' }, 'or drag vertically on the spectrogram'),
          exportBtn,
        ]),
        bandList,
      ]),
      el('div', { class: 'anr-iso-sec anr-iso-sec-ai' }, [
        el('span', { class: 'anr-iso-seclabel' }, 'Separate (AI)'),
        aiInfo,
        aiBtn,
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
    function rebuildGraph() {
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
      if (!isoActive) { tap.connect(sink); return; }
      if (isoMode === 'karaoke') { buildKaraoke(c, tap, filterNodes).connect(sink); return; }
      const merged = computeMerged();
      if (!merged.length) { tap.connect(sink); return; }
      buildStops(c, tap, merged, filterNodes).connect(sink);
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
    function setKaraoke() {
      applyingPreset = true;
      for (const b of isoBands.slice()) removeBand(b);
      applyingPreset = false;
      isoMode = 'karaoke';
      rebuildGraph();
    }
    const PRESETS = [
      { key: 'vocals',  label: 'Vocals',        run: () => soloRange(300, 3400) },
      { key: 'bass',    label: 'Bass',          run: () => soloRange(1, 250) },
      { key: 'drums',   label: 'Drums',         run: () => soloRange(3000, NYQi) },
      { key: 'novocal', label: 'Remove vocals', stereoOnly: true, run: setKaraoke },
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
    // The single Clear (drops presets/bands but keeps isolation on). Appended
    // after the presets so it floats to the far right of the row.
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
    presetBar.appendChild(presetClear);

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
    function renderBlend(result) {
      const sr = result.sampleRate;
      const L = result.vocals[0].length;
      const dur = L / sr;
      // Capped analysis grid. Match the main view's frequency resolution (up to
      // 1024 bins) so the replacement doesn't look softer, but bound the frame
      // count (widen the hop for long clips) so each per-move recombine stays
      // ~1.5M cells - fast enough (no per-cell sqrt) to redraw while dragging.
      const fftSize = Math.min((state.fftSize | 0) || 2048, 2048);
      if (L < fftSize * 2) return null;   // too short to be worth a blend view
      const FRAME_CAP = 1500;
      const hop = Math.max(Math.floor(fftSize / 4), Math.ceil((L - fftSize) / (FRAME_CAP - 1)));
      const stftOpts = { fftSize, hopSize: hop, window: state.winName };

      // Slider: -100 (vocals) .. 0 (normal) .. +100 (instrumental). A centre tick
      // marks the middle; a click within the detent snaps the thumb exactly there
      // (same idiom as the sensitivity slider's 100% slit).
      const slider = el('input', {
        type: 'range', min: '-100', max: '100', value: '0', step: '1',
        class: 'anr-range anr-blend-slider', 'aria-label': 'Blend vocals to instrumental',
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
      const master = ac.createGain(); master.gain.value = sharedVolume(); master.connect(ac.destination);
      const gV = ac.createGain(), gI = ac.createGain();
      gV.connect(master); gI.connect(master);
      const unsubVol = onSharedVolume((level) => { master.gain.value = level; });
      let vSrc = null, iSrc = null, playing = false, startCtx = 0, offset = 0, raf = 0;

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
        if (playing || !A) return;
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
      function paintMain() {
        pend = false;
        if (!A) return;
        const { a, b } = gainsFor(sliderS());
        blendSpec = combineStftToDb(A, B, a, b, out);
        renderOnly();
      }
      function requestPaint() { if (!pend) { pend = true; requestAnimationFrame(paintMain); } }
      function updateTag() {
        const s = sliderS();
        tagEl.textContent = s === 0 ? 'Normal mix' : s < 0
          ? Math.round(-s * 100) + '% toward vocals'
          : Math.round(s * 100) + '% toward instrumental';
      }
      slider.addEventListener('input', () => {
        const v = Number(slider.value);
        if (Math.abs(v) <= 6 && v !== 0) slider.value = '0';   // click detent -> exact centre
        updateTag(); applyGains(true); requestPaint();
      });

      const block = el('div', { class: 'anr-blend' }, [
        el('div', { class: 'anr-blend-head' }, [
          el('span', { class: 'anr-iso-stem-label' }, 'Blend'),
          tagEl,
        ]),
        el('div', { class: 'anr-blend-sliderrow' }, [
          el('span', { class: 'anr-blend-end' }, 'Vocals'),
          sliderWrap,
          el('span', { class: 'anr-blend-end' }, 'Instrumental'),
        ]),
      ]);

      // Heavy analysis deferred (two rAFs) so the block paints first, then the
      // complex STFTs compute, the controls arm, and the blend REPLACES the file's
      // spectrogram on the main canvas (at centre = the normal mix).
      requestAnimationFrame(() => requestAnimationFrame(() => {
        A = computeStftComplex(stemMono(result.vocals), sr, stftOpts);
        B = computeStftComplex(stemMono(result.instrumental), sr, stftOpts);
        out = new Float32Array(A.frames * A.bins);
        playBtn.disabled = false;
        // The blend now owns the spectrogram AND the under-spectrogram transport:
        // its play button plays the separated blend and every scrubber follows.
        blendActive = true; blendSeek = seekFrac; blendPause = pause;
        if (specTransport && specTransport._anrTransport) {
          specTransport._anrTransport.attach({ toggle: () => (playing ? pause() : play()), seek: seekFrac });
        }
        updateTag();   // Analysing… -> Normal mix
        paintMain();   // hand the main spectrogram over to the blend
        moveHead();    // sync the under-spectrogram transport to the blend clock (0:00)
      }));

      blendCleanup = () => {
        pause();
        blendActive = false; blendSeek = null; blendPause = null;
        blendSpec = null;
        if (specTransport && specTransport._anrTransport) { try { specTransport._anrTransport.detach(); } catch (_) {} }
        try { renderOnly(); } catch (_) {}   // restore the file's own spectrogram
        try { unsubVol(); } catch (_) {}
        for (const n of [gV, gI, master]) { try { n.disconnect(); } catch (_) {} }
        A = B = out = null; vBuf = iBuf = null;
      };
      return block;
    }

    function renderStems(result) {
      revokeAiUrls();
      if (blendCleanup) { try { blendCleanup(); } catch (_) {} blendCleanup = null; }
      // Separation done: the results below replace the pitch, so drop the
      // description and the Separate button.
      aiInfo.hidden = true;
      aiBtn.hidden = true;
      aiStems.textContent = '';
      blendMount.textContent = '';
      const blend = renderBlend(result);
      if (blend) blendMount.appendChild(blend);
      const base = opts.basename || 'audio';
      const dur = result.vocals[0].length / result.sampleRate;
      const stems = [
        { key: 'vocals', label: 'Vocals', channels: result.vocals },
        { key: 'instrumental', label: 'Instrumental', channels: result.instrumental },
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
    // One-off size warning, skipped once the model is already cached offline.
    function confirmDownload(mb) {
      return new Promise((resolve) => {
        // The prompt stands in for the description + button while it's up, rather
        // than stacking below them.
        aiInfo.hidden = true; aiBtn.hidden = true;
        aiStatus.hidden = false; aiStatus.textContent = '';
        const yes = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, 'Download and continue');
        const no = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, 'Cancel');
        const done = (v) => { aiStatus.textContent = ''; aiStatus.hidden = true; aiInfo.hidden = false; aiBtn.hidden = false; resolve(v); };
        yes.addEventListener('click', () => done(true));
        no.addEventListener('click', () => done(false));
        aiStatus.appendChild(el('div', { class: 'anr-iso-confirm' }, [
          el('p', {}, 'This downloads the AI model and runtime (about ' + mb + ' MB) once, then keeps it for offline use. It runs on your device - nothing is uploaded. Continue?'),
          el('div', { class: 'anr-iso-confirm-btns' }, [yes, no]),
        ]));
      });
    }
    // "Already downloaded" = present in ANY cache (the offline tier bucket OR the
    // service-worker's own cache, where a prior AI run's fetch lands), or a prior
    // successful run flagged it. caches.match searches every cache, unlike a single
    // caches.open('analyser-offline'), which is why the popup used to keep showing.
    async function modelReady(url) {
      try { if (await caches.match(url)) return true; } catch (_) {}
      try { return localStorage.getItem('anr-mdx-ready') === '1'; } catch (_) { return false; }
    }
    aiBtn.addEventListener('click', async () => {
      if (aiRunning) return;
      aiRunning = true; aiBtn.disabled = true;
      const orig = aiBtn.textContent;
      try {
        const [{ separateStems }, { MDX_MODEL, MDX_TIER_MB }] = await Promise.all([
          import('../lib/mdx-client.js'),
          import('../lib/mdx-model.js'),
        ]);
        if (!(await modelReady(MDX_MODEL.url))) {
          const ok = await confirmDownload(MDX_TIER_MB);
          if (!ok) { aiBtn.disabled = false; aiRunning = false; return; }
        }
        aiBtn.textContent = 'Separating…';
        setAiStatus('Preparing…', 0);
        const result = await separateStems(sourceBuffer(), {
          onProgress: (phase, frac) => {
            const pct = Math.round(frac * 100);
            setAiStatus(phase === 'model' ? 'Downloading model… ' + pct + '%' : 'Separating… ' + pct + '%', frac);
          },
          signal: opts.signal,
        });
        // Remember the model is downloaded so the size warning never reappears.
        try { localStorage.setItem('anr-mdx-ready', '1'); } catch (_) {}
        aiStatus.hidden = true; aiStatus.textContent = '';
        renderStems(result);
      } catch (err) {
        if (err && err.name === 'AbortError') { aiStatus.hidden = true; aiStatus.textContent = ''; }
        else setAiStatus('Separation failed: ' + ((err && err.message) || 'unknown error') + '. Check your connection and try again.');
      }
      aiBtn.textContent = orig; aiBtn.disabled = false; aiRunning = false;
    });
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
  ISRC: "The International Standard Recording Code uniquely identifies a specific audio recording (not the song or the release). It reads as CC-XXX-YY-NNNNN: country, registrant, year, and a per-recording number. Labels and stores use it for royalty tracking and to match the same recording across services.",
};
function tagRow(name, value) {
  return TAG_HELP[name] ? rowHelp(name, value, TAG_HELP[name]) : row(name, value);
}

function buildCoverArtCard(art, file) {
  // Embedded cover art is promoted to the dedicated Photo section and given the
  // full photo analysis there (preview, histogram, EXIF, OCR) - the Photo tab is
  // re-enabled for it. A slim pointer card stays here to say where it went.
  const ext = art.mime === 'image/png' ? 'png' : art.mime === 'image/bmp' ? 'bmp' : 'jpg';
  const base = (file.name || 'cover').replace(/\.[^.]+$/, '') || 'cover';
  const artFile = new File([art.bytes], base + '-cover.' + ext, { type: art.mime });
  const note = 'Embedded cover art from ' + (file.name || 'this audio file')
    + ' (' + art.mime + ' · ' + fmtBytes(art.bytes.length) + ').';

  // Lazy-load the photo module (kept out of the audio bundle) only when there is
  // actually cover art to analyse, then reveal the Photo section and render there.
  import('./photo.js').then(({ renderPhoto, revealPhotoSection }) => {
    const photoResults = revealPhotoSection();
    if (photoResults) renderPhoto(artFile, photoResults, { sourceNote: note });
  }).catch(() => {});

  const labelCard = el('div', { class: 'anr-card' });
  labelCard.appendChild(el('h3', {}, 'Embedded cover art'));
  labelCard.appendChild(el('p', { class: 'anr-hint', style: 'margin:0;' },
    'Found in the file’s metadata (' + art.mime + ' · ' + fmtBytes(art.bytes.length) + ') and analysed in the Photo section.'));
  return labelCard;
}

export function buildWaveformCard(file, mono, audioBuffer, audioEl) {
  const waveCard = el('div', { class: 'anr-card' });
  const [waveH, waveHelp] = h3help('Waveform', 'Amplitude over time. Click and drag to select a region, then zoom in or export the selection as a WAV file. The white playhead line shows the current playback position.');
  waveCard.appendChild(waveH); waveCard.appendChild(waveHelp);
  const waveCanvas = el('canvas', { class: 'anr-waveform' });
  waveCanvas.width = 1024; waveCanvas.height = 80;
  waveCard.appendChild(waveCanvas);
  renderWaveform(waveCanvas, mono);

  // --- Interactive waveform: region selection, zoom, WAV export ---
  let selStart = null, selEnd = null;
  let isSelecting = false;
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
  audioEl.addEventListener('seeked', () => tickWaveLine(audioEl.paused));

  // Grab the playhead line and drag to scrub (respects the current zoom window).
  attachScrub(waveLine, (clientX) => {
    const rect = waveCanvas.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const sample = zoomStart + frac * (zoomEnd - zoomStart);
    audioEl.currentTime = (sample / mono.length) * audioBuffer.duration;
    tickWaveLine();
  });

  // Selection info + buttons container (shown when selection exists)
  const selInfo = el('div', { class: 'anr-controls anr-sel-controls is-hidden' });
  const selLabel = el('span', { class: 'anr-sel-label' }, '');
  const zoomBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, 'Zoom');
  const resetZoomBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm is-hidden' }, 'Reset zoom');
  const exportBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, 'Export WAV');
  selInfo.appendChild(selLabel);
  selInfo.appendChild(zoomBtn);
  selInfo.appendChild(resetZoomBtn);
  selInfo.appendChild(exportBtn);
  waveCard.appendChild(selInfo);

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

  function updateSelInfo() {
    if (selStart == null || selEnd == null || selStart === selEnd) {
      selInfo.classList.add('is-hidden');
      return;
    }
    selInfo.classList.remove('is-hidden');
    const s = Math.min(selStart, selEnd);
    const e = Math.max(selStart, selEnd);
    const selSamples = mono.subarray(s, e);
    const dur = (e - s) / audioBuffer.sampleRate;
    const selStats = computeStats(selSamples);
    selLabel.textContent = 'Selection: ' + dur.toFixed(3) + ' s, '
      + (e - s).toLocaleString() + ' samples | Peak: '
      + selStats.peak.toFixed(3) + ' (' + selStats.peakDb.toFixed(1) + ' dBFS) | RMS: '
      + selStats.rms.toFixed(3) + ' (' + selStats.rmsDb.toFixed(1) + ' dBFS)';
  }

  function xToSample(x) {
    const rect = waveCanvas.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
    const visLen = zoomEnd - zoomStart;
    return Math.round(zoomStart + frac * visLen);
  }

  // Finish a selection on release; the window listener is added on mousedown
  // and removed here so it doesn't persist across files.
  function onSelectMouseUp() {
    window.removeEventListener('mouseup', onSelectMouseUp);
    if (!isSelecting) return;
    isSelecting = false;
    if (selStart != null && selEnd != null && selStart !== selEnd) {
      // Normalize order
      if (selStart > selEnd) { const tmp = selStart; selStart = selEnd; selEnd = tmp; }
      updateSelInfo();
    }
    drawOverlay();
  }

  waveCanvas.style.cursor = 'crosshair';
  waveCanvas.addEventListener('mousedown', (e) => {
    isSelecting = true;
    selStart = xToSample(e.clientX);
    selEnd = selStart;
    drawOverlay();
    updateSelInfo();
    e.preventDefault();
    window.addEventListener('mouseup', onSelectMouseUp);
  });

  waveCanvas.addEventListener('mousemove', (e) => {
    if (!isSelecting) return;
    selEnd = xToSample(e.clientX);
    drawOverlay();
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
    resetZoomBtn.classList.remove('is-hidden');
  });

  resetZoomBtn.addEventListener('click', () => {
    zoomStart = 0;
    zoomEnd = mono.length;
    selStart = null;
    selEnd = null;
    redrawWaveform();
    updateSelInfo();
    resetZoomBtn.classList.add('is-hidden');
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
    'Amplitude distribution - how often each sample value occurs across the whole clip. ' +
    'The horizontal axis is amplitude from −1 to +1 (0 = silence, marked by the red line; ' +
    '±1 = full scale). The vertical axis is the relative number of samples at each amplitude. ' +
    'A tall spike at the centre means lots of quiet; energy spread toward the edges means a loud, dynamic signal.');
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
  infoCard.appendChild(el('h3', {}, 'Audio file'));
  infoCard.appendChild(el('p', { class: 'anr-hint', style: 'margin: 0 0 10px;' },
    "Your browser can't decode this format for analysis, so there's no waveform or spectrogram - but the container info, tags, and cover art below were read straight from the file."));

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
    playCard.appendChild(el('h3', {}, 'Playback'));
    playCard.appendChild(el('p', { class: 'anr-hint', style: 'margin: 0 0 10px;' },
      'Your browser can play this file even though it could not analyse it.'));
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
    if (header.encoder) tbl.appendChild(row('Encoder', header.encoder));
    if (header.compressionRatio) tbl.appendChild(row('Compression', header.compressionRatio.toFixed(2) + ':1'));
    if (header.flacMd5) tbl.appendChild(row('Audio MD5', header.flacMd5));
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
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Decoding "${file.name}"...`));


  let header = {};
  try { header = await peekContainer(file); } catch (e) { /* ignore */ }

  let playbackFile = file;
  let audioBuffer;
  // True when the browser's own decoder couldn't handle this file and we decoded
  // it with ffmpeg.wasm instead. That's precisely the population where the native
  // <audio> element is untrustworthy for playback too (it may accept the file and
  // fire no error yet produce no sound - e.g. HE-AAC, or a codec-stripped Chromium
  // build), so it's the signal to play from a WAV of the decoded PCM instead.
  let usedFfmpeg = false;

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
        resultsEl.innerHTML = '';
        await renderUndecodableAudio(file, header, resultsEl, playbackFile);
        return;
      }
    }
  }

  resultsEl.innerHTML = '';

  const mono = getMono(audioBuffer);
  const stats = computeStats(mono);

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
    }, 'Download recording');
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
    'Audio samples per second, in hertz. Higher rates capture higher frequencies - CD audio is 44,100 Hz, video audio is often 48,000 Hz.'));
  tbl.appendChild(row('Channels',       audioBuffer.numberOfChannels + describeChannels(audioBuffer.numberOfChannels)));
  if (header.bitDepth)  tbl.appendChild(rowHelp('Bit depth',     header.bitDepth + ' bit',
    'Bits used to store each audio sample. More bits give greater dynamic range and lower quantization noise - CD audio is 16-bit.'));
  if (header.bitrateText || header.bitrate) tbl.appendChild(rowHelp('Bitrate',
    header.bitrateText || ((header.bitrate / 1000).toFixed(0) + ' kbps'),
    'Compressed data rate in kilobits per second for lossy formats. Higher generally means better quality and a larger file. VBR shows the average across the file.'));
  try {
    if (header.encoder) tbl.appendChild(rowHelp('Encoder', header.encoder,
      'Software/library that encoded this file, read from the Xing/LAME/VBRI header.'));
    if (header.compressionRatio) tbl.appendChild(rowHelp('Compression',
      header.compressionRatio.toFixed(2) + ':1',
      'Lossless compression ratio versus uncompressed PCM of the same samples (higher means a smaller file for the same audio).'));
    if (header.flacMd5) tbl.appendChild(rowHelp('Audio MD5', header.flacMd5,
      "FLAC's MD5 checksum of the raw decoded audio, stored in STREAMINFO. Lets a decoder verify the audio survived re-encoding intact."));
  } catch (_) {}
  tbl.appendChild(rowHelp('Peak', stats.peak.toFixed(3) + '  (' + stats.peakDb.toFixed(1) + ' dBFS)',
    'Highest sample amplitude in the file. dBFS = decibels relative to full scale, where 0 dBFS is the digital maximum.'));
  tbl.appendChild(rowHelp('RMS', stats.rms.toFixed(3)  + '  (' + stats.rmsDb.toFixed(1)  + ' dBFS)',
    'Root Mean Square - average signal power, closer to perceived loudness than peak. Typical mastered music sits around −10 dBFS.'));
  const lufsValue = computeLufs(mono, audioBuffer.sampleRate);
  tbl.appendChild(rowHelp('Loudness', (isFinite(lufsValue) ? lufsValue.toFixed(1) + ' LUFS' : '-'),
    'Perceived loudness per ITU-R BS.1770. Accounts for human hearing sensitivity. Streaming targets: Spotify −14, YouTube −14, Apple −16 LUFS.'));
  if (stats.clipped > 0) {
    const pct = ((stats.clipped / mono.length) * 100).toFixed(3);
    tbl.appendChild(rowHelp('Clipping', stats.clipped.toLocaleString() + ' samples  (' + pct + '%)',
      'Samples at or beyond the digital ceiling (0 dBFS). Causes audible distortion. More clipped samples = harsher artifacts.'));
  } else {
    tbl.appendChild(rowHelp('Clipping', 'None',
      'Samples at or beyond the digital ceiling (0 dBFS). None detected in this file.'));
  }
  const centroid = computeCentroid(mono, audioBuffer.sampleRate);
  if (centroid != null) {
    const label = centroid < 1500 ? 'warm' : centroid < 4000 ? 'neutral' : 'bright';
    tbl.appendChild(rowHelp('Spectral centroid', Math.round(centroid).toLocaleString() + ' Hz  (' + label + ')',
      'Frequency "center of mass" of the spectrum. Below 1500 Hz sounds warm/dark, above 4000 Hz sounds bright/sharp. Useful for comparing tonal character.'));
  }
  const pitchResult = detectPitch(mono, audioBuffer.sampleRate);
  if (pitchResult) {
    const centsStr = pitchResult.cents >= 0 ? '+' + pitchResult.cents : String(pitchResult.cents);
    tbl.appendChild(rowHelp('Pitch', pitchResult.note + '  (' + pitchResult.frequency.toFixed(1) + ' Hz, ' + centsStr + ' cents)',
      'Fundamental frequency via the YIN algorithm. Cents = deviation from the nearest note (±50 cents = half a semitone).'));
  } else {
    tbl.appendChild(rowHelp('Pitch', 'N/A',
      'Fundamental frequency via the YIN algorithm. Could not detect a clear pitch in this audio.'));
  }
  const tagBpm = await readTagBPM(file).catch(() => null);
  const estBpm = detectBPM(mono, audioBuffer.sampleRate);
  const bpmVal = tagBpm || estBpm;
  const bpmIsTag = tagBpm != null;
  const bpmRow = rowHelp('BPM', bpmVal != null ? bpmVal + ' BPM' : 'N/A',
    bpmIsTag ? 'Beats per minute read from file metadata.'
             : 'Beats per minute via onset envelope analysis. Most reliable on rhythmic material with a clear beat.');
  if (bpmVal != null && !bpmIsTag) {
    const td = bpmRow.querySelector('td');
    td.appendChild(el('span', { style: 'font-size:0.8em;color:var(--muted);margin-left:4px' }, '(est)'));
  }
  tbl.appendChild(bpmRow);
  tbl.appendChild(rowHelp('Total samples',  mono.length.toLocaleString(),
    'Total number of individual amplitude values in the (channel-merged mono) signal - roughly sample rate × duration.'));
  infoCard.appendChild(tbl);
  resultsEl.appendChild(infoCard);

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

  function renderSignalViews(idx, showLoader) {
    const sig = chans[idx].data;
    specSlot.innerHTML = '';
    // On a channel switch the spectrogram recomputes on a deferred timeout, so drop
    // in the standard inline loader (as elsewhere) until the new panel first paints.
    let loader = null;
    if (showLoader) { loader = inlineLoader('Analysing ' + chans[idx].full + '…'); specSlot.appendChild(loader); }
    curSpecPanel = makeSpectrogramPanel(sig, audioBuffer.sampleRate, { basename, audioEl, signal: renderSignal, capture: true, audioBuffer });
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

  let chanCard = null;
  if (chans.length > 1) {
    chanCard = el('div', { class: 'anr-card' });
    const [chH, chHelp] = h3help('Channel',
      'This file has ' + audioBuffer.numberOfChannels + ' channels. Choose which one feeds the spectrogram and waveform - <strong>Mix</strong> is every channel averaged together, or isolate a single speaker (Left, Right, Centre, LFE, surrounds) to inspect it on its own. Per-channel peak and RMS update with your choice. Speaker names follow the file\'s declared layout, so treat them as a best-effort label.');
    chanCard.appendChild(chH); chanCard.appendChild(chHelp);
    const seg = el('div', { class: 'anr-btn-row', style: 'margin-top:4px;' });
    const stat = el('p', { class: 'anr-hint', style: 'margin:8px 0 0;' });
    const btns = [];
    const setActive = (i) => {
      btns.forEach((b, j) => b.classList.toggle('is-active', j === i));
      const s = computeStats(chans[i].data);
      stat.textContent = chans[i].full + '  -  peak ' + s.peakDb.toFixed(1) + ' dBFS, RMS ' + s.rmsDb.toFixed(1) + ' dBFS';
    };
    chans.forEach((c, i) => {
      const b = el('button', { type: 'button', class: 'anr-btn', title: c.full }, c.short);
      b.addEventListener('click', () => { setActive(i); renderSignalViews(i, true); });
      btns.push(b); seg.appendChild(b);
    });
    setActive(0);
    chanCard.appendChild(seg); chanCard.appendChild(stat);
  }

  // ---- Spectrogram (leads the analysis, above the file-info card) ----
  // The spectrogram is the headline visual, so it sits at the very top of the
  // result - above the file info + player. (opts.spectrogramFirst predates this
  // being the default and is kept for the image-sonify caller; the placement is
  // now the same either way.)
  resultsEl.insertBefore(specSlot, infoCard);

  // Channel picker (multi-channel files) sits directly under the spectrogram it drives.
  if (chanCard) resultsEl.insertBefore(chanCard, specSlot.nextSibling);

  // ---- Embedded cover art (filled in asynchronously so it doesn't block) ----
  const coverSlot = el('div');
  resultsEl.appendChild(coverSlot);
  extractCoverArt(file).then((art) => {
    if (art && art.bytes && art.bytes.length) coverSlot.appendChild(buildCoverArtCard(art, file));
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
    const left  = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);
    const stereo = computeStereoStats(left, right);

    const stereoCard = el('div', { class: 'anr-card' });
    const [stH, stHelp] = h3help('Stereo analysis', '<strong>Phase correlation</strong> measures how similar the left and right channels are. +1 = identical (mono), 0 = unrelated, negative = out of phase (can cause cancellation on mono speakers).<br><strong>Stereo width</strong> is derived from correlation. Higher = wider stereo image.<br><strong>Mid/Side</strong> splits the signal into centre (mid) and difference (side) components.<br>The <strong>vectorscope</strong> plots left vs right samples. A vertical line = mono; a circle = wide stereo; a horizontal line = out of phase.');
    stereoCard.appendChild(stH); stereoCard.appendChild(stHelp);

    const stereoTbl = el('table', { class: 'anr-readout' });
    const corrPct  = (stereo.correlation * 100).toFixed(1);
    const corrHint = stereo.correlation > 0.8 ? 'mono-like'
                   : stereo.correlation < -0.2 ? 'out of phase'
                   : stereo.correlation < 0.3 ? 'wide' : 'normal';
    stereoTbl.appendChild(rowHelp('Phase correlation', stereo.correlation.toFixed(3) + '  (' + corrPct + '%, ' + corrHint + ')',
      'Left/right channel similarity. +1 = identical (mono), 0 = unrelated, negative = out of phase (problematic on mono speakers).'));
    stereoTbl.appendChild(rowHelp('Stereo width', stereo.width.toFixed(3),
      'Spatial separation between channels. 0 = mono, 1 = maximum stereo spread.'));
    stereoTbl.appendChild(rowHelp('Mid level', stereo.midLevel.toFixed(4),
      'Center (mono) component: (L+R)/2. Carries vocals, bass, and center-panned elements.'));
    stereoTbl.appendChild(rowHelp('Side level', stereo.sideLevel.toFixed(4),
      'Difference (stereo) component: (L−R)/2. Carries reverb, panned instruments, and spatial content.'));
    const msRatio = stereo.midLevel > 1e-12
      ? (stereo.sideLevel / stereo.midLevel).toFixed(3)
      : '-';
    stereoTbl.appendChild(rowHelp('Side / Mid ratio', msRatio,
      'Ratio of side to mid energy. Below 0.5 = center-heavy mix, above 1.0 = very wide/spatial mix.'));
    stereoCard.appendChild(stereoTbl);

    // Vectorscope canvas
    const vsCanvas = el('canvas', { width: '200', height: '200', style: 'display:block; margin:8px auto 0;' });
    stereoCard.appendChild(vsCanvas);
    renderVectorscope(vsCanvas, left, right);

    resultsEl.appendChild(stereoCard);
  }

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
