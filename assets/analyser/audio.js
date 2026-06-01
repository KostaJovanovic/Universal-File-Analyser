/* Analyser - audio module
   Handles uploaded files, mic recording, and live spectrogram.
   Renders waveform, file info, and an interactive spectrogram. */

import {
  computeSpectrogram, renderSpectrogram, colormaps, windows,
  frequencyTicks, timeTicks, formatHz, formatTime
} from './spectrogram.js';

let audioCtx = null;
function ctx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function fmtBytes(n) {
  if (n == null) return '-';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'html') e.innerHTML = attrs[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
    else e.setAttribute(k, attrs[k]);
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

function row(label, value) {
  return el('tr', {}, [
    el('th', {}, label),
    el('td', {}, value == null || value === '' ? '-' : String(value))
  ]);
}

// --- File header peek (sample rate, bit depth, codec hints) ---
async function peekContainer(file) {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const ascii = (s, l) => String.fromCharCode(...head.slice(s, s + l));

  // WAV
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') {
    // fmt chunk usually at offset 12
    const dv = new DataView(head.buffer);
    const fmtId = ascii(12, 4);
    if (fmtId === 'fmt ') {
      const audioFormat = dv.getUint16(20, true);
      const channels    = dv.getUint16(22, true);
      const sampleRate  = dv.getUint32(24, true);
      const byteRate    = dv.getUint32(28, true);
      const bitDepth    = dv.getUint16(34, true);
      const formatName  = { 1: 'PCM', 3: 'IEEE Float', 6: 'A-law', 7: 'µ-law', 0xFFFE: 'WAVE_FORMAT_EXTENSIBLE' }[audioFormat] || ('0x' + audioFormat.toString(16));
      return { container: 'WAV', codec: formatName, channels, sampleRate, bitDepth, bitrate: byteRate * 8 };
    }
    return { container: 'WAV' };
  }
  // FLAC
  if (ascii(0, 4) === 'fLaC') return { container: 'FLAC' };
  // OGG
  if (ascii(0, 4) === 'OggS') return { container: 'OGG' };
  // ID3-tagged MP3
  if (ascii(0, 3) === 'ID3') return { container: 'MP3', codec: 'MPEG Layer 3' };
  // Raw MPEG frame (FF Ex/Fx)
  if (head[0] === 0xFF && (head[1] & 0xE0) === 0xE0) return { container: 'MP3', codec: 'MPEG audio' };
  // MP4/M4A
  if (ascii(4, 4) === 'ftyp') return { container: 'MP4/M4A', codec: ascii(8, 4).trim() };
  // Opus in OGG handled above
  return { container: 'unknown' };
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

function computeStats(samples) {
  let peak = 0, sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
    sumSq += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSq / samples.length);
  const peakDb = 20 * Math.log10(peak + 1e-12);
  const rmsDb  = 20 * Math.log10(rms  + 1e-12);
  return { peak, rms, peakDb, rmsDb };
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
  ctxC.fillStyle = '#80a4ba';
  for (let x = 0; x < w; x++) {
    const start = Math.floor(x * samplesPerPx);
    const end   = Math.floor((x + 1) * samplesPerPx);
    let mn = 1, mx = -1;
    for (let i = start; i < end && i < samples.length; i++) {
      const v = samples[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    const y1 = ((1 - mx) / 2) * h;
    const y2 = ((1 - mn) / 2) * h;
    ctxC.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
  ctxC.strokeStyle = '#C8DCE8';
  ctxC.strokeRect(0, 0, w, h);
}

function buildFreqAxis(axisEl, sampleRate, scale) {
  axisEl.innerHTML = '';
  const minHz = scale === 'log' ? 20 : 0;
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
    span.style.top = ((1 - frac) * 100) + '%';
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

// --- Spectrogram UI panel (shared for file + recording) ---
function makeSpectrogramPanel(samples, sampleRate, opts = {}) {
  const card = el('div', { class: 'anr-card anr-spec-card' });
  card.appendChild(el('h3', {}, 'Spectrogram'));

  // --- controls ---
  const controls = el('div', { class: 'anr-controls' });
  const toggle = el('div', { class: 'anr-toggle' });
  const btnLog = el('button', { type: 'button', class: 'is-active' }, 'LOG');
  const btnLin = el('button', { type: 'button' }, 'LINEAR');
  toggle.appendChild(btnLog); toggle.appendChild(btnLin);

  const fftSel  = el('select', {}, ['256','512','1024','2048','4096','8192'].map((v) => el('option', { value: v }, v)));
  fftSel.value = '2048';
  const winSel  = el('select', {}, ['hann','hamming','blackman','rect'].map((v) => el('option', { value: v }, v)));
  const cmapSel = el('select', {}, Object.keys(colormaps).map((v) => el('option', { value: v }, v)));
  const zoomSel = el('select', {}, ['1','1.5','2','3','4','6','8','12','16'].map((v) => el('option', { value: v }, v + 'x')));
  zoomSel.value = '1';
  const heightSel = el('select', {}, ['240','320','420','560','720','900'].map((v) => el('option', { value: v }, v + 'px')));
  heightSel.value = '420';

  const saveBtn = el('button', { type: 'button', class: 'anr-fs-btn' }, 'Save PNG');
  const fsBtn   = el('button', { type: 'button', class: 'anr-fs-btn' }, 'Fullscreen');

  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'Axis'),   toggle]));
  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'FFT'),    fftSel]));
  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'Window'), winSel]));
  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'Colour'), cmapSel]));
  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'Zoom'),   zoomSel]));
  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'Height'), heightSel]));
  controls.appendChild(el('div', { class: 'anr-control' }, [saveBtn]));
  controls.appendChild(el('div', { class: 'anr-control' }, [fsBtn]));
  card.appendChild(controls);

  // --- spectrogram body ---
  const wrap     = el('div', { class: 'anr-spec-wrap' });
  const yWrap    = el('div', { class: 'anr-spec-yaxis-wrap' });
  const axisY    = el('div', { class: 'anr-spec-yaxis' });
  const corner   = el('div', { class: 'anr-spec-corner' });
  yWrap.appendChild(axisY); yWrap.appendChild(corner);

  const scrollEl = el('div', { class: 'anr-spec-scroll' });
  const canvas   = el('canvas', { class: 'anr-spec-canvas' });
  const axisX    = el('div', { class: 'anr-spec-xaxis' });
  scrollEl.appendChild(canvas); scrollEl.appendChild(axisX);

  wrap.appendChild(yWrap); wrap.appendChild(scrollEl);
  card.appendChild(wrap);

  const status = el('p', { class: 'anr-hint anr-spec-hint', style: 'margin: 6px 0 0; text-align: right;' }, 'computing...');
  card.appendChild(status);

  let state = {
    scale: 'log', cmap: 'viridis', fftSize: 2048, winName: 'hann',
    zoom: 1, height: 420
  };
  let cached = null;

  function isFs() { return document.fullscreenElement === card; }
  function availableWidth() {
    const total = wrap.clientWidth || 600;
    return Math.max(200, total - 44 - 4);
  }
  function availableHeight() {
    return Math.max(160, (wrap.clientHeight || state.height + 22) - 22);
  }
  function sizeCanvas() {
    const baseW = availableWidth();
    const w = Math.max(200, Math.round(baseW * state.zoom));
    const h = isFs() ? availableHeight() : state.height;
    canvas.width  = w;
    canvas.height = h;
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';
    axisX.style.width   = w + 'px';
  }

  function recompute() {
    const t0 = performance.now();
    if (!cached || cached.fftSize !== state.fftSize || cached.winName !== state.winName) {
      const spec = computeSpectrogram(samples, sampleRate, {
        fftSize: state.fftSize,
        hopSize: Math.floor(state.fftSize / 4),
        window:  state.winName
      });
      cached = { fftSize: state.fftSize, winName: state.winName, spec };
    }
    sizeCanvas();
    renderSpectrogram(canvas, cached.spec, { scale: state.scale, colormap: state.cmap });
    const duration = samples.length / sampleRate;
    buildFreqAxis(axisY, sampleRate, state.scale);
    buildTimeAxis(axisX, duration);
    const ms = (performance.now() - t0).toFixed(0);
    status.textContent = `${cached.spec.frames} frames × ${cached.spec.bins} bins | ${canvas.width}×${canvas.height} px | ${ms} ms`;
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
  fftSel.addEventListener('change',    () => { state.fftSize = parseInt(fftSel.value, 10); recompute(); });
  winSel.addEventListener('change',    () => { state.winName = winSel.value; recompute(); });
  cmapSel.addEventListener('change',   () => { state.cmap    = cmapSel.value; recompute(); });
  zoomSel.addEventListener('change',   () => { state.zoom    = parseFloat(zoomSel.value); recompute(); });
  heightSel.addEventListener('change', () => { state.height  = parseInt(heightSel.value, 10); recompute(); });

  saveBtn.addEventListener('click', () => {
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: (opts.basename || 'spectrogram') + '.png' });
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
    }, 'image/png');
  });

  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      (card.requestFullscreen || card.webkitRequestFullscreen).call(card);
    }
  });
  function onFsChange() {
    fsBtn.textContent = isFs() ? 'Exit fullscreen' : 'Fullscreen';
    requestAnimationFrame(recompute);
  }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  let resizeRaf;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      const newW = Math.max(200, Math.round(availableWidth() * state.zoom));
      if (Math.abs(newW - canvas.width) > 2 || isFs()) recompute();
    });
  });

  // Defer until in DOM so clientWidth is real
  setTimeout(recompute, 0);
  setTimeout(recompute, 80);

  return card;
}

// --- Render uploaded / recorded audio results ---
export async function renderAudio(file, resultsEl, opts = {}) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Decoding "${file.name}"...`));
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

  let header = {};
  try { header = await peekContainer(file); } catch (e) { /* ignore */ }

  let audioBuffer;
  try {
    audioBuffer = await decodeFile(file);
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(el('div', { class: 'anr-error' }, 'Could not decode this file. Format may not be supported by your browser.'));
    return;
  }

  resultsEl.innerHTML = '';

  const mono = getMono(audioBuffer);
  const stats = computeStats(mono);

  // ---- File info card ----
  const infoCard = el('div', { class: 'anr-card' });
  infoCard.appendChild(el('h3', {}, 'File info'));
  const audioEl = el('audio', { controls: '', src: URL.createObjectURL(file), style: 'width:100%; margin-bottom:8px;' });
  infoCard.appendChild(audioEl);

  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Name',           file.name));
  tbl.appendChild(row('Size',           fmtBytes(file.size)));
  tbl.appendChild(row('MIME',           file.type || header.container || '-'));
  if (header.container) tbl.appendChild(row('Container',     header.container));
  if (header.codec)     tbl.appendChild(row('Codec',         header.codec));
  tbl.appendChild(row('Duration',       formatTime(audioBuffer.duration)));
  tbl.appendChild(row('Sample rate',    audioBuffer.sampleRate.toLocaleString() + ' Hz'));
  tbl.appendChild(row('Channels',       audioBuffer.numberOfChannels));
  if (header.bitDepth)  tbl.appendChild(row('Bit depth',     header.bitDepth + ' bit'));
  if (header.bitrate)   tbl.appendChild(row('Bitrate',       (header.bitrate / 1000).toFixed(0) + ' kbps'));
  tbl.appendChild(row('Peak',           stats.peak.toFixed(3) + '  (' + stats.peakDb.toFixed(1) + ' dBFS)'));
  tbl.appendChild(row('RMS',            stats.rms.toFixed(3)  + '  (' + stats.rmsDb.toFixed(1)  + ' dBFS)'));
  tbl.appendChild(row('Total samples',  mono.length.toLocaleString()));
  infoCard.appendChild(tbl);
  resultsEl.appendChild(infoCard);

  // ---- Waveform card ----
  const waveCard = el('div', { class: 'anr-card' });
  waveCard.appendChild(el('h3', {}, 'Waveform'));
  const waveCanvas = el('canvas', { class: 'anr-waveform' });
  waveCanvas.width = 1024; waveCanvas.height = 80;
  waveCard.appendChild(waveCanvas);
  renderWaveform(waveCanvas, mono);
  resultsEl.appendChild(waveCard);

  // ---- Spectrogram ----
  const basename = (file.name || 'spectrogram').replace(/\.[^/.]+$/, '');
  resultsEl.appendChild(makeSpectrogramPanel(mono, audioBuffer.sampleRate, { basename }));
}

// --- Recording UI ---
async function startRecording(resultsEl, recordBtn) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    resultsEl.hidden = false;
    resultsEl.innerHTML = '';
    resultsEl.appendChild(el('div', { class: 'anr-error' }, 'Microphone access denied or unavailable.'));
    return;
  }

  const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']
    .find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const liveCard = el('div', { class: 'anr-card' });
  liveCard.appendChild(el('h3', {}, 'Recording...'));
  const timer = el('p', { class: 'anr-hint' }, '0.0 s');
  const stopBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Stop');
  liveCard.appendChild(timer);
  liveCard.appendChild(stopBtn);
  resultsEl.appendChild(liveCard);

  const startMs = performance.now();
  const tick = setInterval(() => {
    timer.textContent = ((performance.now() - startMs) / 1000).toFixed(1) + ' s';
  }, 100);

  rec.start();
  recordBtn.classList.add('is-recording');

  return new Promise((resolve) => {
    function finish() {
      clearInterval(tick);
      recordBtn.classList.remove('is-recording');
      stream.getTracks().forEach((t) => t.stop());
    }
    rec.onstop = async () => {
      finish();
      const blob = new Blob(chunks, { type: mime || 'audio/webm' });
      const ext = (mime.match(/audio\/(\w+)/) || [, 'webm'])[1];
      const file = new File([blob], 'recording.' + ext, { type: blob.type });
      await renderAudio(file, resultsEl);
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
    resultsEl.appendChild(el('div', { class: 'anr-error' }, 'Microphone access denied or unavailable.'));
    return;
  }

  const ac = ctx();
  await ac.resume();
  const src = ac.createMediaStreamSource(stream);
  const analyser = ac.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0;
  src.connect(analyser);

  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

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
  const heightSel = el('select', {}, ['240','320','420','560','720','900'].map((v) => el('option', { value: v }, v + 'px')));
  heightSel.value = '420';
  const fsBtn     = el('button', { type: 'button', class: 'anr-fs-btn' }, 'Fullscreen');
  const stopBtn   = el('button', { type: 'button', class: 'anr-btn' }, 'Stop');

  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'Axis'),   toggle]));
  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'FFT'),    fftSel]));
  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'Colour'), cmapSel]));
  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'Height'), heightSel]));
  controls.appendChild(el('div', { class: 'anr-control' }, [fsBtn]));
  controls.appendChild(el('div', { class: 'anr-control' }, [stopBtn]));
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

  let state = { scale: 'log', cmap: 'viridis', height: 420 };

  function isFs() { return document.fullscreenElement === card; }
  function availableWidth()  { return Math.max(200, (wrap.clientWidth || 600) - 48); }
  function availableHeight() { return Math.max(160, (wrap.clientHeight || state.height) - 2); }

  const ctxC = canvas.getContext('2d');

  // Resizing the canvas wipes its bitmap, which would lose the streaming
  // history in live mode. `preserve` snapshots the old contents into a temp
  // canvas, then redraws the rightmost slice (most recent audio) anchored
  // to the right edge of the new size — so the stream visually continues
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

  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      (card.requestFullscreen || card.webkitRequestFullscreen).call(card);
    }
  });
  function onFsChange() {
    fsBtn.textContent = isFs() ? 'Exit fullscreen' : 'Fullscreen';
    requestAnimationFrame(() => sizeCanvas());
  }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  let liveRaf;
  function onWinResize() {
    cancelAnimationFrame(liveRaf);
    liveRaf = requestAnimationFrame(() => sizeCanvas());
  }
  window.addEventListener('resize', onWinResize);

  let dbData = new Float32Array(analyser.frequencyBinCount);
  const colW = 2;
  let stopped = false;
  liveBtn.classList.add('is-active');

  function tick() {
    if (stopped) return;
    const bins = analyser.frequencyBinCount;
    if (dbData.length !== bins) dbData = new Float32Array(bins);
    analyser.getFloatFrequencyData(dbData);

    const w = canvas.width, h = canvas.height;
    if (w <= colW || h <= 0) return requestAnimationFrame(tick);

    const img = ctxC.getImageData(colW, 0, w - colW, h);
    ctxC.putImageData(img, 0, 0);
    ctxC.fillStyle = '#0a0a0a';
    ctxC.fillRect(w - colW, 0, colW, h);

    const cmap = colormaps[state.cmap] || colormaps.viridis;
    const nyq = ac.sampleRate / 2;
    const dbFloor = -100, dbCeil = -10;
    const range = dbCeil - dbFloor;
    const colImg = ctxC.createImageData(colW, h);

    for (let y = 0; y < h; y++) {
      let binF;
      if (state.scale === 'log') {
        const logMin = Math.log10(20);
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
      for (let x = 0; x < colW; x++) {
        const o = (y * colW + x) * 4;
        colImg.data[o]     = r;
        colImg.data[o + 1] = g;
        colImg.data[o + 2] = bl;
        colImg.data[o + 3] = 255;
      }
    }
    ctxC.putImageData(colImg, w - colW, 0);

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  stopBtn.addEventListener('click', () => {
    stopped = true;
    liveBtn.classList.remove('is-active');
    stream.getTracks().forEach((t) => t.stop());
    try { src.disconnect(); } catch (_) {}
    document.removeEventListener('fullscreenchange', onFsChange);
    document.removeEventListener('webkitfullscreenchange', onFsChange);
    window.removeEventListener('resize', onWinResize);
  });
}

// --- Setup ---
export function initAudio({ dropEl, inputEl, recordBtn, liveBtn, resultsEl, onFile }) {
  const handle = onFile || ((file) => renderAudio(file, resultsEl));

  inputEl.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handle(file);
    inputEl.value = '';
  });

  // Visual highlight only; the actual drop is handled at the window level
  ['dragenter', 'dragover'].forEach((ev) =>
    dropEl.addEventListener(ev, () => dropEl.classList.add('is-dragover'))
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dropEl.addEventListener(ev, () => dropEl.classList.remove('is-dragover'))
  );

  recordBtn.addEventListener('click', () => {
    if (recordBtn.classList.contains('is-recording')) return;
    startRecording(resultsEl, recordBtn);
  });

  liveBtn.addEventListener('click', () => {
    if (liveBtn.classList.contains('is-active')) return;
    startLive(resultsEl, liveBtn);
  });
}
