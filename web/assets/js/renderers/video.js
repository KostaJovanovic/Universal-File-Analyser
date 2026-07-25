/* Analyser - video module
   Handles video files: playback, container/codec detection, frame rate,
   frame capture (routed to photo analysis), audio track extraction
   (waveform + spectrogram via audio module). */

import { makePlayer, renderAudio } from './audio.js';
import { renderPhoto, revealPhotoSection, openLightbox } from './photo.js';
import { el, row, rowHelp, fmtBytes, h3help, wireInfoToggle, sha256Row, integrityCard, roundFps, asciiBar, downloadBlob, inlineLoader, yieldToMain, setPlayerFill } from '../core/util.js';
import { HASH_FILE_MAX } from '../core/limits.js';
import { parseAviHeader, extractAviData, encodeWav } from './video-avi.js';
import { appendSonyGyroCard } from './sony-rtmd.js';
import { registerSyncedVideo, setAudioCompanion } from '../core/video-sync.js';
import { detectMoovlessMp4, extractMp4ParamSets, findInbandParamSets, carveAvccToAnnexB } from './video-recover.js';
import { analyzeMp4Structure, analyzeBitstream, BOX_GLOSS } from './video-forensics.js';
import { appendTelemetryCards } from './video-telemetry.js';

// iOS (iPhone/iPad) detection. On iOS the custom scrubber's touch handling is
// unreliable, so we show the native <video> controls there; everywhere else the
// styled makePlayer transport handles playback and native controls stay hidden.
function isIOS() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// Render context - lets the same renderer run normally (targets the fixed photo/
// audio/video section slots, syncs players, scrolls to the photo section) OR run
// "inline" for the compare view's side-by-side panels, where every target is a
// local slot inside the panel and cross-player sync is off so two videos don't
// steal each other's transport/audio. `videoCtx` is set at the top of renderVideo
// and CAPTURED synchronously by each helper/handler at build time, so deferred
// button clicks use the context of their own render even after a second render
// swaps the module-level value. It resets to the default on every renderVideo call.
const DEFAULT_VCTX = {
  inline: false,
  compare: false,
  photoTarget: () => document.getElementById('photoResults'),
  audioTarget: () => document.getElementById('audioResults'),
  previewTarget: () => document.getElementById('videoPreview'),
  afterPhoto: () => { const sec = document.getElementById('photo'); if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  photoOpts: (base) => base,
  sync: (playerEl) => registerSyncedVideo(playerEl),
  companion: (c) => setAudioCompanion(c),
};
let videoCtx = DEFAULT_VCTX;
const curVctx = () => videoCtx;

// Apply the right playback affordance to a visible <video>: native controls on
// iOS, click-to-toggle play/pause elsewhere (the makePlayer scrubber does the rest).
function applyVideoControls(playerEl) {
  if (isIOS()) {
    playerEl.setAttribute('controls', '');
  } else {
    playerEl.style.cursor = 'pointer';
    playerEl.addEventListener('click', () => { if (playerEl.paused) playerEl.play(); else playerEl.pause(); });
  }
  // Keep every player of this clip (main player, gyro mini-player, ...) in sync -
  // but not in inline/compare mode, where each panel's players stay independent.
  curVctx().sync(playerEl);
}

// A generated contact-sheet image. Click opens it full-size in the shared
// lightbox (no photo tools - it's a thumbnail grid, not a single photo).
function sheetImg(dataUrl) {
  return el('img', {
    src: dataUrl,
    alt: 'Contact sheet',
    style: 'max-width:100%; margin-top:10px; border:1px solid var(--hairline); display:block; cursor:zoom-in;',
    onclick: () => openLightbox(dataUrl, 'Contact sheet', 'Contact sheet', null, false, false)
  });
}

// Determinate sibling of util.js's inlineLoader: the same inline label + ASCII
// bar, but driven by a known step count instead of bouncing. Used by the jobs
// that scrub the player (contact sheet, scene detection) - both walk a fixed
// number of seeks, and both are slow enough on a big file that an unlabelled
// wait reads as a hang. Returns { node, set(frac, text) }.
function stepLoader(text) {
  // Fixed 20 characters, exactly like inlineLoader's bar. NOT fit:true - that
  // re-measures on every set(), and scene detection calls set() hundreds of
  // times, so any drift in the character-width estimate would compound.
  const bar = asciiBar();
  const label = el('span', { class: 'anr-inline-loader-label' }, text || 'Working…');
  const node = el('div', { class: 'anr-inline-loader' }, [label, bar]);
  bar.set(0);
  return {
    node,
    set(frac, t) { if (t) label.textContent = t; bar.set(frac); },
  };
}

// Smooth-scroll to the photo section. Called after the user explicitly clicks an
// "Analyse frame" button (not on the silent auto-analysis of the first frame).
function scrollToPhoto() {
  const sec = document.getElementById('photo');
  if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// The frame controls shown under a video player: an editable, button-styled
// timecode (click to set hours/minutes/seconds/frame individually and seek
// there) on top, then a 2×2 grid of Prev/Next frame and Analyse/Frame-grab.
// "Analyse frame" sends the current frame to the photo section; "Frame grab"
// downloads it as a PNG. `getFps` returns the current detected frame rate (it may
// update asynchronously). Returns { wrap, refresh }; call refresh() when fps
// becomes known so the frame field of the timecode is accurate.
function buildFrameControls(playerEl, getFps, file) {
  const ctx = curVctx();   // capture at build time for the deferred Analyse-frame handler
  const fps = () => { const f = getFps(); return (f && isFinite(f) && f > 0) ? f : 30; };
  const pad = (n) => String(n).padStart(2, '0');
  function parts(t) {
    const rf = Math.round(fps());
    const ts = Math.floor(t);
    let f = Math.floor((t - ts) * fps() + 1e-6);
    if (f >= rf) f = rf - 1;
    return { h: Math.floor(ts / 3600), m: Math.floor((ts % 3600) / 60), s: ts % 60, f };
  }

  const label = el('span', { class: 'anr-timecode-label' }, 'TIMECODE');
  const display = el('span', { class: 'anr-timecode-value' }, '00:00:00:00');
  const mkSeg = () => el('input', { class: 'anr-tc-seg', type: 'text', inputmode: 'numeric', maxlength: '2', spellcheck: 'false', autocomplete: 'off' });
  const sH = mkSeg(), sM = mkSeg(), sS = mkSeg(), sF = mkSeg();
  const sep = () => el('span', { class: 'anr-tc-sep' }, ':');
  const editWrap = el('span', { class: 'anr-timecode-edit', style: 'display:none;' }, [sH, sep(), sM, sep(), sS, sep(), sF]);
  const hint = el('span', { class: 'anr-timecode-hint', style: 'display:none;' }, 'hour : min : sec : frame');
  const tc = el('div', { class: 'anr-timecode', role: 'button', tabindex: '0', title: 'Click to edit - set hours, minutes, seconds and frame' }, [label, display, editWrap, hint]);

  let editing = false;
  function refresh() { if (editing) return; const p = parts(playerEl.currentTime); display.textContent = `${pad(p.h)}:${pad(p.m)}:${pad(p.s)}:${pad(p.f)}`; }
  function enterEdit() {
    editing = true; playerEl.pause();
    const p = parts(playerEl.currentTime);
    sH.value = pad(p.h); sM.value = pad(p.m); sS.value = pad(p.s); sF.value = pad(p.f);
    display.style.display = 'none'; editWrap.style.display = ''; hint.style.display = '';
    sH.focus(); sH.select();
  }
  function exitEdit() { editing = false; editWrap.style.display = 'none'; hint.style.display = 'none'; display.style.display = ''; }
  function commit() {
    if (!editing) return;
    const rf = Math.round(fps());
    const clamp = (v, max) => { v = parseInt(v, 10) || 0; return Math.max(0, max != null ? Math.min(v, max) : v); };
    const h = clamp(sH.value), m = clamp(sM.value, 59), s = clamp(sS.value, 59), f = clamp(sF.value, Math.max(0, rf - 1));
    let t = h * 3600 + m * 60 + s + f / fps();
    if (isFinite(playerEl.duration)) t = Math.min(t, playerEl.duration);
    exitEdit();
    playerEl.currentTime = Math.max(0, t);
    refresh();
  }
  tc.addEventListener('click', (e) => { if (!editing && !editWrap.contains(e.target)) enterEdit(); });
  tc.addEventListener('keydown', (e) => { if (!editing && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); enterEdit(); } });
  editWrap.addEventListener('focusout', (e) => { if (!editWrap.contains(e.relatedTarget)) commit(); });
  const order = [sH, sM, sS, sF];
  for (const seg of order) {
    seg.addEventListener('input', () => {
      seg.value = seg.value.replace(/\D/g, '').slice(0, 2);
      if (seg.value.length === 2) { const i = order.indexOf(seg); if (i < 3) { order[i + 1].focus(); order[i + 1].select(); } }
    });
    seg.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); exitEdit(); refresh(); }
    });
  }

  // Live timecode while playing.
  let raf = 0;
  function tick() { refresh(); if (!playerEl.paused) raf = requestAnimationFrame(tick); }
  playerEl.addEventListener('play', () => { raf = requestAnimationFrame(tick); });
  playerEl.addEventListener('pause', () => { cancelAnimationFrame(raf); refresh(); });
  playerEl.addEventListener('seeked', refresh);

  function grabCanvas() {
    const vw = playerEl.videoWidth, vh = playerEl.videoHeight;
    if (!vw || !vh) return null;
    const cv = document.createElement('canvas'); cv.width = vw; cv.height = vh;
    cv.getContext('2d').drawImage(playerEl, 0, 0, vw, vh);
    return cv;
  }
  // Step exactly one frame in either direction. Both buttons share this so they
  // behave symmetrically: snap to the current frame index, shift by `delta`, then
  // seek to the MIDDLE of the target frame (the + 0.5) so float rounding can never
  // spill the seek into a neighbouring frame or land on a boundary and drift.
  // (The old "Next" played the video and paused on the next painted frame, which
  // advanced by a non-deterministic number of frames in real wall-clock time.)
  function stepFrame(delta) {
    playerEl.pause();
    const f = fps();
    const idx = Math.floor(playerEl.currentTime * f + 1e-6);
    let target = (idx + delta + 0.5) / f;
    const dur = playerEl.duration;
    if (isFinite(dur) && dur > 0) target = Math.min(target, dur - 0.5 / f);
    playerEl.currentTime = Math.max(0, target);
  }
  const prevBtn = el('button', { type: 'button', class: 'anr-btn', onclick: () => stepFrame(-1) }, '← Prev frame');
  const nextBtn = el('button', { type: 'button', class: 'anr-btn', onclick: () => stepFrame(1) }, 'Next frame →');
  const analyseBtn = el('button', { type: 'button', class: 'anr-btn', onclick: async () => {
    const cv = grabCanvas(); if (!cv) return;
    analyseBtn.disabled = true; analyseBtn.textContent = 'Capturing…';
    try {
      const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
      const frameFile = new File([blob], `frame_${playerEl.currentTime.toFixed(3)}s.png`, { type: 'image/png' });
      const pr = ctx.photoTarget();
      if (pr) { renderPhoto(frameFile, pr, ctx.photoOpts(undefined)); ctx.afterPhoto(); }
    } catch (_) {}
    analyseBtn.disabled = false; analyseBtn.textContent = 'Analyse frame';
  } }, 'Analyse frame');
  const grabBtn = el('button', { type: 'button', class: 'anr-btn', onclick: async () => {
    const cv = grabCanvas(); if (!cv) return;
    grabBtn.disabled = true;
    try {
      const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
      // Name the grab after the timecode (HH-MM-SS-FF; ':' is illegal in filenames).
      const p = parts(playerEl.currentTime);
      const tc = `${pad(p.h)}-${pad(p.m)}-${pad(p.s)}-${pad(p.f)}`;
      downloadBlob((file.name || 'video').replace(/\.[^.]+$/, '') + `_${tc}.png`, blob);
    } catch (_) {}
    grabBtn.disabled = false;
  } }, 'Frame grab');

  // (No "Sonify frame" here. Sonifying a grabbed frame is still available from
  // the photo renderer once the frame has been sent there with "Analyse frame".)
  const grid = el('div', { class: 'anr-frame-grid' }, [prevBtn, nextBtn, analyseBtn, grabBtn]);
  const wrap = el('div', { class: 'anr-frame-wrap' }, [tc, grid]);
  refresh();
  return { wrap, refresh };
}

// "Download audio (WAV)" link for the extracted-audio cards. Reuses the blob URL
// already created for the player so no re-encoding is needed.
// Extracting and analysing a video's audio track (full decode + waveform +
// spectrogram) is heavy, so it no longer runs automatically. Instead this drops
// an "Analyse audio" prompt card into the Sound section; the supplied routine
// only fires when the user clicks it. Returns nothing - purely a UI mount.
function mountAudioAnalyseButton(audioResultsEl, run) {
  const ctx = curVctx();
  audioResultsEl.hidden = false;
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Audio track'));
  card.appendChild(el('p', { class: 'anr-info' },
    'This video carries an embedded sound track. Extract it for a player, waveform, spectrogram and level stats.'));
  const btn = el('button', { type: 'button', class: 'anr-btn anr-btn--cta' }, 'Analyse audio');
  card.appendChild(btn);
  audioResultsEl.appendChild(card);
  btn.addEventListener('click', () => {
    card.remove();
    // Scroll to the top of the whole Sound section (heading + lede), not the
    // results container, which sits below them - landing on the container alone
    // scrolls past the heading and looks like it jumped to the section's middle.
    // Skipped inline (the compare view), where the analysis renders in place and
    // an autoscroll would yank the page around under the central button.
    if (!ctx.inline) {
      (audioResultsEl.closest('.section') || audioResultsEl)
        .scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    // Show the bottom loading popup while the (heavy) decode + spectrogram runs.
    const loader = window._anrLoader;
    if (loader) loader.show('Analysing audio…');
    Promise.resolve(run()).catch(() => {}).finally(() => { if (loader) loader.hide(); });
  });
}

// Photo counterpart of mountAudioAnalyseButton: a video frame is no longer pushed
// into the Photo section automatically. This drops an "Analyse photo" prompt card
// there; the current frame is only analysed when the user clicks.
function mountPhotoAnalyseButton(photoResultsEl, run) {
  const ctx = curVctx();
  photoResultsEl.hidden = false;
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Frame analysis'));
  card.appendChild(el('p', { class: 'anr-info' },
    'Pull the current video frame into the photo tools for colours, dimensions, EXIF and the rest.'));
  const btn = el('button', { type: 'button', class: 'anr-btn anr-btn--cta' }, 'Analyse photo');
  card.appendChild(btn);
  photoResultsEl.appendChild(card);
  btn.addEventListener('click', () => {
    card.remove();
    ctx.afterPhoto();
    Promise.resolve(run()).catch(() => {});
  });
}

// ---------- progress-tracked fetch ----------
async function fetchWithProgress(url, onProgress) {
  const resp = await fetch(url);
  const total = parseInt(resp.headers.get('content-length') || '0', 10);
  if (!total || !resp.body) return new Uint8Array(await resp.arrayBuffer());
  const reader = resp.body.getReader();
  const chunks = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (onProgress) onProgress(Math.min(1, loaded / total));
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function makeBlobURL(data, type) {
  return URL.createObjectURL(new Blob([data], { type }));
}

// ---------- FFmpeg WASM fallback (lazy, single-threaded) ----------
// The 31 MB core is too large for Cloudflare's 25 MiB asset cap, so it loads
// from a CDN on first use. The service worker caches it afterwards, so offline
// use survives once it's been fetched once. A bottom-of-window loader (same
// style as the drop loader) shows real download progress while it pulls.
// ESM build (not UMD): @ffmpeg/ffmpeg spawns its worker as `type:"module"`, where
// importScripts() doesn't exist, so the worker loads the core via `import(coreURL)`
// and reads its `default` export. The UMD build has no default export (it only
// assigns module.exports/AMD), so a module worker gets `undefined` and throws
// "failed to import ffmpeg-core.js". The ESM build has `export default`, so it works.
const FFMPEG_CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
let ffmpegInstance = null;
let _ffLoaderEl = null;

// There is ONE shared ffmpeg.wasm instance, so two heavy jobs can't run at once -
// on the compare page a user can hit "Convert to H.264" on both videos. Serialise
// FFmpeg jobs through this promise chain: the second job waits for the first to
// finish before it starts. `onWait` fires (once) if the job has to queue, so the
// caller can show a "waiting…" state instead of a stalled progress bar.
let _ffmpegBusy = false;
let _ffmpegChain = Promise.resolve();
function queueFFmpeg(job, onWait) {
  if (_ffmpegBusy && typeof onWait === 'function') { try { onWait(); } catch (_) {} }
  const run = _ffmpegChain.then(() => { _ffmpegBusy = true; return job(); });
  _ffmpegChain = run.then(() => { _ffmpegBusy = false; }, () => { _ffmpegBusy = false; });
  return run;
}

// The bottom-of-window loader. Default label/determinate bar for the FFmpeg core
// download; pass a custom label + indeterminate:true to reuse it for any other
// FFmpeg-backed wait (e.g. preparing a segment of a large raw stream).
function showFfmpegLoader(label, indeterminate) {
  if (!_ffLoaderEl || !_ffLoaderEl.isConnected) {
    const bar = asciiBar({ fit: true });
    const labelEl = el('div', { class: 'anr-drop-loader-label' }, '');
    _ffLoaderEl = el('div', { class: 'anr-drop-loader', role: 'status', 'aria-live': 'polite' }, [labelEl, bar]);
    _ffLoaderEl._bar = bar;
    _ffLoaderEl._label = labelEl;
    document.body.appendChild(_ffLoaderEl);
  }
  _ffLoaderEl._label.textContent = label || 'Loading FFmpeg…';
  if (indeterminate) _ffLoaderEl._bar.indeterminate();
  else _ffLoaderEl._bar.set(0);
  requestAnimationFrame(() => _ffLoaderEl.classList.add('is-open'));
}
function setFfmpegLoaderProgress(frac) {
  if (_ffLoaderEl && _ffLoaderEl._bar) _ffLoaderEl._bar.set(frac);
}
function hideFfmpegLoader() {
  if (_ffLoaderEl) {
    _ffLoaderEl.classList.remove('is-open');
    if (_ffLoaderEl._bar && _ffLoaderEl._bar.stop) _ffLoaderEl._bar.stop();
  }
}

// A hard ffmpeg.wasm failure (an out-of-memory abort, or an explicit terminate)
// leaves the worker's wasm runtime unusable - every later exec on it just rejects.
// Drop the cached instance so the next loadFFmpeg() builds a fresh one instead of
// handing back a corpse. Without this, the first reverse that ran out of memory
// poisoned the shared instance and every later reverse (and other ffmpeg feature)
// failed for the rest of the session.
// Both are exported: gcode.js borrows the shared instance (and the kill switch,
// for its Cancel button) to convert clip exports to MP4 where WebCodecs can't.
export function killFFmpeg() {
  if (ffmpegInstance) { try { ffmpegInstance.terminate(); } catch (_) {} ffmpegInstance = null; }
}

// Whether this browser can actually DECODE HEVC/H.265 in an MP4. Safari can, and
// Chromium can when the OS/hardware provides a decoder; Firefox cannot at all.
// canPlayType returns '' (falsy) when it can't, 'maybe'/'probably' when it can.
// Used to decide whether a raw HEVC stream can be stream-copied into MP4 (fast,
// lossless) or must be re-encoded to H.264 so it will actually play rather than
// producing a valid-but-black player. Cached; probes a throwaway <video>.
let _hevcPlayable = null;
function canPlayHevc() {
  if (_hevcPlayable !== null) return _hevcPlayable;
  let ok = false;
  try {
    const v = document.createElement('video');
    ok = !!(v.canPlayType('video/mp4; codecs="hvc1"') || v.canPlayType('video/mp4; codecs="hev1"'));
  } catch (_) { ok = false; }
  _hevcPlayable = ok;
  return ok;
}

export async function loadFFmpeg(onProgress) {
  if (ffmpegInstance && ffmpegInstance.loaded) return ffmpegInstance;
  if (ffmpegInstance) killFFmpeg();   // half-loaded / terminated leftover
  showFfmpegLoader();
  try {
    const { FFmpeg } = await import(new URL('../../vendor/ffmpeg/ffmpeg.js', import.meta.url).href);
    const report = (p) => { setFfmpegLoaderProgress(p); if (onProgress) onProgress(p); };
    const coreJS = makeBlobURL(await fetchWithProgress(FFMPEG_CORE_BASE + '/ffmpeg-core.js', (p) => report(p * 0.3)), 'text/javascript');
    const wasmData = await fetchWithProgress(FFMPEG_CORE_BASE + '/ffmpeg-core.wasm', (p) => report(0.3 + p * 0.7));
    const wasmURL = makeBlobURL(wasmData, 'application/wasm');
    const ff = new FFmpeg();
    await ff.load({ coreURL: coreJS, wasmURL });
    ffmpegInstance = ff;
    return ff;
  } finally {
    hideFfmpegLoader();
  }
}

async function ffmpegExtractAudio(file, container) {
  const barEl = el('div', { class: 'anr-progress-bar' }, '[                    ]');
  const labelEl = el('div', { class: 'anr-progress-label' }, 'loading ffmpeg');
  const wrap = el('div', { class: 'anr-progress' }, [barEl, labelEl]);
  container.appendChild(wrap);

  function setBar(frac) {
    const ch = parseFloat(getComputedStyle(barEl).fontSize) * 0.6 || 8;
    const total = Math.max(10, Math.floor((barEl.parentElement.clientWidth - ch * 2) / ch));
    const filled = Math.round(Math.max(0, Math.min(1, frac)) * total);
    barEl.innerHTML = '[<span class="anr-bar-fill">' + '/'.repeat(filled) + '</span>' + ' '.repeat(total - filled) + ']';
  }

  const ff = await loadFFmpeg((p) => { setBar(p); });
  labelEl.textContent = 'extracting audio';
  setBar(1);
  const { fetchFile } = await import(new URL('../../vendor/ffmpeg/ffmpeg-util.js', import.meta.url).href);
  await ff.writeFile('input', await fetchFile(file));
  await ff.exec(['-i', 'input', '-vn', '-acodec', 'pcm_s16le', '-ar', '48000', '-ac', '2', 'output.wav']);
  const data = await ff.readFile('output.wav');
  await ff.deleteFile('input');
  await ff.deleteFile('output.wav');
  wrap.remove();
  const wavBlob = new Blob([data.buffer || data], { type: 'audio/wav' });
  // Reuse the shared context - iOS Safari caps concurrent AudioContexts (~4), so
  // a fresh-and-never-closed one per decode exhausts them across a session.
  const ac = getAudioCtx();
  const buf = await wavBlob.arrayBuffer();
  return await ac.decodeAudioData(buf);
}

// Re-encode a video playing backwards (picture + sound) with FFmpeg WASM.
//
// The naive `-vf reverse` buffers EVERY decoded frame in memory, so it blows the
// 32-bit WASM heap (~2 GB) on any real HD clip - a 1080p clip OOMs after ~15 s,
// 4K after ~3 s - which is why a one-shot reverse failed on essentially every
// normal video. Instead we bound memory by working in chunks:
//   1. normalise the source to H.264 with a forced keyframe every SEG seconds
//      (a plain transcode - streaming, flat memory - which also makes a codec the
//      browser can't decode, e.g. HEVC, usable from here on);
//   2. losslessly split it at those keyframes into SEG-second segments;
//   3. reverse each segment on its own (only SEG seconds of frames in RAM);
//   4. concat the reversed segments in REVERSE order -> the whole clip reversed.
// SEG is sized from the resolution so a single segment's raw frames stay well
// under the heap. Output is H.264 + AAC MP4 (yuv420p) so it plays anywhere.
// `onLoad` reports 0..1 core-download progress; `onEnc` reports 0..1 progress.
// Returns a video/mp4 Blob, or null if nothing could be produced.
async function ffmpegReverseVideo(file, onLoad, onEnc, signal) {
  const ff = await loadFFmpeg(onLoad);
  if (signal && signal.aborted) return null;
  const aborted = () => signal && signal.aborted;
  const { fetchFile } = await import(new URL('../../vendor/ffmpeg/ffmpeg-util.js', import.meta.url).href);

  let log = '';
  const onLog = ({ message }) => { log += message + '\n'; };
  // Smooth, monotonic progress. The job runs ~N+2 ffmpeg commands and each emits
  // its OWN 0..1 - wiring that straight to the bar made it sweep 0..1 a dozen times
  // ("all over the place"). Instead map each command's progress into the slice of
  // the whole job it represents (set via phase()), and never let the bar go
  // backwards: normalise 0-30%, the per-segment reverses 30-92%, concat 92-100%.
  let pBase = 0, pSpan = 0.3, lastP = 0;
  const report = (frac) => { const v = Math.max(lastP, Math.max(0, Math.min(1, frac))); lastP = v; if (onEnc) onEnc(v); };
  const phase = (base, span) => { pBase = base; pSpan = span; };
  const onProg = ({ progress }) => { if (isFinite(progress)) report(pBase + Math.max(0, Math.min(1, progress)) * pSpan); };
  ff.on('log', onLog);
  ff.on('progress', onProg);
  const detachAll = () => { try { ff.off('log', onLog); } catch (_) {} try { ff.off('progress', onProg); } catch (_) {} };
  // `crashed` distinguishes a hard wasm abort (ff.exec rejects - instance is now
  // dead) from a clean non-zero exit (ff.exec resolves, output just isn't there).
  // On a crash we tear the instance down so the next attempt reloads fresh.
  let crashed = false;
  const exec = async (args) => { log = ''; try { await ff.exec(args); return true; } catch (_) { crashed = true; return false; } };
  const read = async (name) => { try { const d = await ff.readFile(name); return d && d.length ? d : null; } catch (_) { return null; } };
  const rm = async (name) => { try { await ff.deleteFile(name); } catch (_) {} };

  const src = 'rev_src';
  try { await ff.writeFile(src, await fetchFile(file)); }
  catch (_) { detachAll(); return null; }

  // Reverse one elementary clip whole (video + audio, retry video-only). Used per
  // segment and as the single-segment fast path.
  const reverseWhole = async (inName, outName, audio) => {
    const a = audio ? ['-af', 'areverse', '-c:a', 'aac'] : ['-an'];
    await exec(['-i', inName, '-vf', 'reverse', ...a,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', outName]);
    if (await read(outName)) return true;
    if (audio) {                       // areverse fails when there is no audio track
      await rm(outName);
      await exec(['-i', inName, '-vf', 'reverse', '-an',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', outName]);
      return !!(await read(outName));
    }
    return false;
  };

  try {
    // Probe resolution/fps from the demux log (a bare `-i` errors out fast without
    // decoding) to size the chunk so one segment's raw frames stay within a heap a
    // phone can spare. The `reverse` filter holds EVERY decoded frame of a segment
    // in memory at once, so the segment length is what bounds peak memory. The old
    // ~280 MB budget was fine on desktop but blew the wasm heap on mobile (where
    // imported videos usually come from) and on 4K, so every reverse there failed.
    // 96 MB leaves comfortable headroom; sub-second segments are allowed (no longer
    // floored at 1 s) so even 4K stays bounded.
    await exec(['-i', src]);
    const res = log.match(/, (\d{2,5})x(\d{2,5})[ ,]/);
    const fpsM = log.match(/(\d+(?:\.\d+)?) fps/);
    const w = res ? +res[1] : 1920, h = res ? +res[2] : 1080;
    const fps = fpsM ? Math.min(120, Math.max(1, parseFloat(fpsM[1]))) : 30;
    const perSec = w * h * 1.5 * fps;
    const SEG = Math.max(0.5, Math.min(5, 96e6 / Math.max(1, perSec))) || 2;
    const hadAudio = /Audio:/.test(log);
    if (aborted()) { await rm(src); detachAll(); return null; }

    // 1) Normalise to H.264 with a keyframe exactly every SEG seconds. (0-30%)
    const norm = 'rev_norm.mp4';
    const kf = 'expr:gte(t,n_forced*' + SEG + ')';
    let audio = hadAudio;
    phase(0, 0.30);
    await exec(['-i', src, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-force_key_frames', kf, '-c:a', 'aac', '-y', norm]);
    if (!await read(norm)) {           // no audio / unsupported audio -> video only
      audio = false; await rm(norm);
      await exec(['-i', src, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
        '-force_key_frames', kf, '-an', '-y', norm]);
    }
    await rm(src);
    if (aborted() || !await read(norm)) { await rm(norm); detachAll(); if (crashed) killFFmpeg(); return null; }

    // 2) Split losslessly at those keyframes (near-instant; hold the bar at 30%).
    phase(0.30, 0);
    await exec(['-i', norm, '-c', 'copy', '-map', '0', '-f', 'segment',
      '-segment_time', String(SEG), '-reset_timestamps', '1', 'rev_seg_%03d.mp4']);
    let segs = [];
    try { segs = (await ff.listDir('/')).map((n) => n.name).filter((n) => /^rev_seg_\d+\.mp4$/.test(n)).sort(); }
    catch (_) {}

    // Short clip (one chunk, or the splitter produced nothing) - reverse it whole.
    if (segs.length <= 1) {
      for (const s of segs) await rm(s);
      const out = 'rev_out.mp4';
      phase(0.30, 0.70);
      const ok = await reverseWhole(norm, out, audio);
      const data = ok ? await read(out) : null;
      await rm(norm); await rm(out); detachAll();
      if (!data && crashed) killFFmpeg();
      return data ? new Blob([data.buffer || data], { type: 'video/mp4' }) : null;
    }
    await rm(norm);

    // 3) Reverse each segment (bounded memory). Each segment is an equal slice of
    //    the 30-92% band, so the bar advances steadily across the whole clip.
    const revs = [];
    for (let i = 0; i < segs.length; i++) {
      if (aborted()) { for (const n of [...segs.slice(i), ...revs]) await rm(n); detachAll(); return null; }
      const rev = 'rev_out_' + String(i).padStart(3, '0') + '.mp4';
      phase(0.30 + 0.62 * (i / segs.length), 0.62 / segs.length);
      const ok = await reverseWhole(segs[i], rev, audio);
      await rm(segs[i]);
      if (!ok) { for (const n of [...segs.slice(i + 1), ...revs, rev]) await rm(n); detachAll(); if (crashed) killFFmpeg(); return null; }
      revs.push(rev);
      report(0.30 + 0.62 * ((i + 1) / segs.length));
    }

    // 4) Concat the reversed segments in reverse order. Stream-copy first; if the
    //    per-segment encoder params differ enough to refuse a copy, re-encode.
    const listName = 'rev_list.txt';
    const ordered = revs.slice().reverse();
    await ff.writeFile(listName, new TextEncoder().encode(ordered.map((n) => "file '" + n + "'").join('\n') + '\n'));
    const out = 'rev_out.mp4';
    phase(0.92, 0.08);
    await exec(['-f', 'concat', '-safe', '0', '-i', listName, '-c', 'copy', '-y', out]);
    if (!await read(out)) {
      await rm(out);
      const a = audio ? ['-c:a', 'aac'] : ['-an'];
      await exec(['-f', 'concat', '-safe', '0', '-i', listName,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', ...a, '-y', out]);
    }
    const data = await read(out);
    for (const n of [...revs, listName, out]) await rm(n);
    if (data) report(1);
    detachAll();
    return data ? new Blob([data.buffer || data], { type: 'video/mp4' }) : null;
  } catch (_) {
    detachAll();
    if (crashed) killFFmpeg();
    return null;
  }
}

// Transcode any FFmpeg-decodable video to browser-playable H.264 + AAC MP4. Used
// to rescue files whose codec the browser can't decode (HEVC, ProRes, 10-bit /
// 4:2:2, ...) so they can be played and fully analysed. Plain streaming transcode
// (no whole-video buffering), so memory stays flat regardless of length. Returns a
// video/mp4 Blob, or null. `onLoad`/`onEnc` report 0..1 progress.
async function ffmpegTranscodeToH264(file, onLoad, onEnc, signal, opts = {}) {
  // Fast viewing/analysis proxy by default: downscale to a 720p box, ultrafast
  // preset, cap 30 fps - encode time scales with pixels x frames, so this is
  // typically several times faster than a full-resolution re-encode. The Advanced
  // panel on the convert card overrides maxHeight / maxFps / preset.
  const maxHeight = opts.maxHeight != null ? opts.maxHeight : 720;
  const maxFps = opts.maxFps != null ? opts.maxFps : 30;
  const preset = opts.preset || 'ultrafast';
  const ff = await loadFFmpeg(onLoad);
  if (signal && signal.aborted) return null;
  const { fetchFile } = await import(new URL('../../vendor/ffmpeg/ffmpeg-util.js', import.meta.url).href);
  const inName = 'conv_in', outName = 'conv_out.mp4';
  try { await ff.writeFile(inName, await fetchFile(file)); } catch (_) { return null; }
  const onProg = ({ progress }) => { if (onEnc && isFinite(progress)) onEnc(Math.max(0, Math.min(1, progress))); };
  ff.on('progress', onProg);
  // "turbo" is faster than libx264's own fastest preset (ultrafast is already the
  // floor). The extra speed comes from the DECODE side, which for HEVC is a big
  // share of the work: -skip_loop_filter all is an INPUT option that drops the
  // in-loop deblocking filter while decoding the source (slightly blockier, no
  // frames dropped). It also disables encoder lookahead. Everything else is a
  // normal x264 preset. Input-side options must sit before -i.
  const inOpts = [];
  let x264preset = preset, tune = null;
  if (preset === 'turbo') { inOpts.push('-skip_loop_filter', 'all'); x264preset = 'ultrafast'; tune = 'zerolatency'; }
  // Shared video/rate options. The scale caps HEIGHT at maxHeight without ever
  // upscaling (min(H,ih)) and forces even dimensions (-2 width, 2*trunc(...) height)
  // that yuv420p / H.264 require. The comma inside min() is escaped so the
  // filtergraph parser doesn't read it as a filter separator.
  const vopts = ['-c:v', 'libx264', '-preset', x264preset, '-crf', '23', '-pix_fmt', 'yuv420p'];
  if (tune) vopts.push('-tune', tune);
  if (maxHeight > 0) vopts.push('-vf', 'scale=-2:2*trunc(min(' + maxHeight + '\\,ih)/2)');
  if (maxFps > 0) vopts.push('-r', String(maxFps));
  const run = async (args) => {
    try { await ff.exec(args); } catch (_) {}
    try { return await ff.readFile(outName); } catch (_) { return null; }
  };
  let data = await run([...inOpts, '-i', inName, ...vopts, '-c:a', 'aac', '-movflags', '+faststart', '-y', outName]);
  if (!data || !data.length) {
    try { await ff.deleteFile(outName); } catch (_) {}
    data = await run([...inOpts, '-i', inName, ...vopts, '-an', '-movflags', '+faststart', '-y', outName]);
  }
  ff.off('progress', onProg);
  try { await ff.deleteFile(inName); } catch (_) {}
  try { await ff.deleteFile(outName); } catch (_) {}
  if (!data || !data.length) return null;
  return new Blob([data.buffer || data], { type: 'video/mp4' });
}

// Card with a button that reverses the playable video on demand, then shows a
// reversed player + MP4 download. `file` is the browser-playable file (original or
// the remuxed MP4). `signal` revokes the result URL on teardown.
function buildReverseVideoCard(file, signal) {
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Reverse'));
  card.appendChild(el('p', { class: 'anr-hint' },
    'Re-encode this video playing backwards - picture and sound - in your browser with FFmpeg. This can take a while.'));
  const btn = el('button', { type: 'button', class: 'anr-btn' }, '↺ Reverse video');
  const out = el('div');
  const barEl = el('div', { class: 'anr-progress-bar' }, '[                    ]');
  const labelEl = el('div', { class: 'anr-progress-label' }, 'loading ffmpeg');
  const wrap = el('div', { class: 'anr-progress', style: 'display:none;' }, [barEl, labelEl]);
  const setBar = (frac) => {
    const ch = parseFloat(getComputedStyle(barEl).fontSize) * 0.6 || 8;
    const total = Math.max(10, Math.floor((barEl.parentElement.clientWidth - ch * 2) / ch));
    const filled = Math.round(Math.max(0, Math.min(1, frac)) * total);
    barEl.innerHTML = '[<span class="anr-bar-fill">' + '/'.repeat(filled) + '</span>' + ' '.repeat(total - filled) + ']';
  };
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'Reversing…';
    wrap.style.display = '';
    let blob = null;
    try {
      blob = await ffmpegReverseVideo(file,
        (p) => { labelEl.textContent = 'loading ffmpeg'; setBar(p); },
        (p) => { labelEl.textContent = 'reversing'; setBar(p); },
        signal);
    } catch (_) { blob = null; }
    wrap.style.display = 'none';
    if (signal && signal.aborted) return;
    if (!blob) {
      btn.disabled = false; btn.textContent = '↺ Reverse video';
      out.innerHTML = '';
      out.appendChild(el('p', { class: 'anr-hint', style: 'color:var(--accent);' },
        'Could not reverse this video this time - a very high resolution (4K) or a low-memory device can run the browser out of memory mid-encode. The engine has been reset, so pressing Reverse again will retry from scratch; a shorter or lower-resolution clip is the most reliable.'));
      return;
    }
    const url = URL.createObjectURL(blob);
    if (signal) signal.addEventListener('abort', () => { try { URL.revokeObjectURL(url); } catch (_) {} });
    const v = el('video', { src: url, playsinline: '' });
    v.setAttribute('webkit-playsinline', '');
    v.style.cssText = 'width:100%; max-height:480px; background:#0a0a0a; display:block; border:1px solid var(--hairline);';
    applyVideoControls(v);
    out.appendChild(v);
    out.appendChild(makePlayer(v));
    const base = (file.name || 'video').replace(/\.[^.]+$/, '');
    const revName = base + '_reversed.mp4';
    const analyseBtn = el('button', { type: 'button', class: 'anr-btn',
      style: 'display:inline-block;' }, 'Analyse reversed');
    // Feed the reversed clip back through the analyser as a fresh file, with a
    // breadcrumb back to the original (same pattern as drilling into an archive).
    analyseBtn.addEventListener('click', () => {
      const revFile = new File([blob], revName, { type: 'video/mp4' });
      if (window._anrPushNav) window._anrPushNav(file.name || 'video', () => { if (window._anrHandleFile) window._anrHandleFile(file, {}); });
      if (window._anrHandleFile) window._anrHandleFile(revFile, { nested: true });
    });
    out.appendChild(el('div', { style: 'margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;' }, [
      el('a', { href: url, download: revName, class: 'anr-btn',
        style: 'display:inline-block;text-decoration:none;' }, 'Download reversed (MP4)'),
      analyseBtn
    ]));
    btn.remove();
  });
  card.appendChild(btn);
  card.appendChild(wrap);
  card.appendChild(out);
  return card;
}

// Remux a raw H.264/H.265 elementary stream (Annex B, no container) into an MP4
// using FFmpeg WASM. Stream copy only (-c copy) - the bitstream is unchanged, so
// it's fast and lossless; it just gains an MP4 container the browser can play.
// faststart moves the moov atom to the front so it plays without a full read.
// A raw stream carries no timing, so FFmpeg's h264/h265 demuxer assumes 25 fps.
//
// rawKind ('h264' | 'h265') forces the input demuxer with -f. A bare elementary
// stream has no container and no useful extension for FFmpeg to probe, so without
// an explicit -f the demuxer is often never selected, -c copy finds no input,
// and we'd silently produce nothing - which is exactly the "doesn't open at all"
// case. We know the kind from detection, so we always pass it.
//
// Returns { blob, log }: blob is a video/mp4 Blob (or null on failure) and log is
// the captured FFmpeg output so the caller can show WHY a remux didn't produce a
// file instead of silently dropping to the unplayable card. Large inputs are
// mounted via WORKERFS (read by seeking) rather than copied whole into WASM heap.
async function ffmpegRemuxToMp4(file, signal, rawKind) {
  const ff = await loadFFmpeg();
  if (signal && signal.aborted) return { blob: null, log: '' };
  const demuxer = rawKind === 'h265' ? 'hevc' : 'h264';
  const outName = 'out.mp4';

  let log = '';
  const onLog = ({ message }) => { log += message + '\n'; };
  ff.on('log', onLog);

  const MOUNT = '/anrrx';
  let inName = null;
  let cleanup = async () => {};
  try {
    // Prefer a WORKERFS mount so a multi-GB stream is read by seeking, not copied
    // into WASM memory (fetchFile of a huge file blows the heap). Fall back to an
    // in-memory copy for smaller files / browsers without WORKERFS.
    let mounted = false;
    try { await ff.createDir(MOUNT); mounted = await ff.mount('WORKERFS', { files: [file] }, MOUNT); } catch (_) { mounted = false; }
    if (mounted) {
      inName = MOUNT + '/' + file.name;
      cleanup = async () => { try { await ff.unmount(MOUNT); } catch (_) {} try { await ff.deleteDir(MOUNT); } catch (_) {} };
    } else {
      try { await ff.deleteDir(MOUNT); } catch (_) {}
      const { fetchFile } = await import(new URL('../../vendor/ffmpeg/ffmpeg-util.js', import.meta.url).href);
      inName = 'in.' + (demuxer === 'hevc' ? 'h265' : 'h264');
      await ff.writeFile(inName, await fetchFile(file));
      cleanup = async () => { try { await ff.deleteFile(inName); } catch (_) {} };
    }

    // Re-encode to H.264 - the last-resort path, also used up front for HEVC that
    // this browser can't decode. Lossy, but it makes the clip play.
    const reencode = async () => {
      try { await ff.deleteFile(outName); } catch (_) {}
      try {
        await ff.exec(['-fflags', '+genpts', '-f', demuxer, '-i', inName,
          '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart', outName]);
      } catch (_) {}
      try { return await ff.readFile(outName); } catch (_) { return null; }
    };
    let data = null;
    // A raw HEVC stream copies into a valid hvc1 MP4 that Firefox (and Chromium
    // without a HEVC decoder) still can't play - the copy "succeeds" so the old
    // empty-output fallback never fired, leaving a black player. When the browser
    // can't decode HEVC, re-encode to H.264 up front instead.
    if (demuxer === 'hevc' && !canPlayHevc()) {
      data = await reencode();
    } else {
      try {
        await ff.exec(['-fflags', '+genpts', '-f', demuxer, '-i', inName, '-c', 'copy', '-movflags', '+faststart', outName]);
      } catch (_) { /* exec may resolve with a non-zero code instead of throwing */ }
      try { data = await ff.readFile(outName); } catch (_) { data = null; }
      if (!data || !data.length) {
        // Stream-copy can also fail on streams whose in-band SPS/PPS FFmpeg won't
        // lift into an MP4 sample-description as-is. Re-encode as a last resort.
        data = await reencode();
      }
    }
    try { await ff.deleteFile(outName); } catch (_) {}
    if (!data || !data.length) return { blob: null, log };
    return { blob: new Blob([data.buffer || data], { type: 'video/mp4' }), log };
  } finally {
    try { if (ff.off) ff.off('log', onLog); } catch (_) {}
    await cleanup();
  }
}

// Remux an MPEG-TS / AVCHD camcorder file (.mts / .m2ts / .ts) into an MP4 the
// browser can play. The video (normally H.264) is stream-copied - fast and
// lossless - while the audio is transcoded to AAC, because AVCHD audio is usually
// AC-3 or LPCM, which an MP4 can't carry for in-browser playback. +genpts repairs
// the timestamps some camcorder TS files omit; faststart moves the moov atom to
// the front. Returns { blob, log } like ffmpegRemuxToMp4 (blob null on failure).
async function ffmpegRemuxTsToMp4(file, signal) {
  const ff = await loadFFmpeg();
  if (signal && signal.aborted) return { blob: null, log: '' };
  const outName = 'out.mp4';

  let log = '';
  const onLog = ({ message }) => { log += message + '\n'; };
  ff.on('log', onLog);

  const MOUNT = '/anrts';
  let inName = null;
  let cleanup = async () => {};
  try {
    // WORKERFS mount where available so a big camcorder file is read by seeking
    // rather than copied whole into the WASM heap (mirrors ffmpegRemuxToMp4).
    let mounted = false;
    try { await ff.createDir(MOUNT); mounted = await ff.mount('WORKERFS', { files: [file] }, MOUNT); } catch (_) { mounted = false; }
    if (mounted) {
      inName = MOUNT + '/' + file.name;
      cleanup = async () => { try { await ff.unmount(MOUNT); } catch (_) {} try { await ff.deleteDir(MOUNT); } catch (_) {} };
    } else {
      try { await ff.deleteDir(MOUNT); } catch (_) {}
      const { fetchFile } = await import(new URL('../../vendor/ffmpeg/ffmpeg-util.js', import.meta.url).href);
      inName = 'in.ts';
      await ff.writeFile(inName, await fetchFile(file));
      cleanup = async () => { try { await ff.deleteFile(inName); } catch (_) {} };
    }

    // Copy the (H.264) video, transcode the audio to AAC.
    try {
      await ff.exec(['-fflags', '+genpts', '-i', inName, '-c:v', 'copy', '-c:a', 'aac', '-movflags', '+faststart', outName]);
    } catch (_) { /* exec may resolve with a non-zero code instead of throwing */ }
    let data = null;
    try { data = await ff.readFile(outName); } catch (_) { data = null; }
    if (!data || !data.length) {
      // Video copy fails when the TS video isn't H.264 (e.g. MPEG-2 from an older
      // camcorder) or carries SPS/PPS FFmpeg won't lift as-is. Re-encode the video
      // too as a last resort - lossy, but it makes the clip play.
      try { await ff.deleteFile(outName); } catch (_) {}
      try {
        await ff.exec(['-fflags', '+genpts', '-i', inName,
          '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-movflags', '+faststart', outName]);
      } catch (_) {}
      try { data = await ff.readFile(outName); } catch (_) { data = null; }
    }
    try { await ff.deleteFile(outName); } catch (_) {}
    if (!data || !data.length) return { blob: null, log };
    return { blob: new Blob([data.buffer || data], { type: 'video/mp4' }), log };
  } finally {
    try { if (ff.off) ff.off('log', onLog); } catch (_) {}
    await cleanup();
  }
}

// ---------- segmented playback for very large raw H.264/H.265 streams ----------
// A multi-GB elementary stream can't be remuxed in one piece (FFmpeg keeps the
// whole input AND output MP4 in WASM memory). Instead we split it at keyframes
// into part-sized chunks, remux each to MP4 on demand, and play them back-to-back.
// The split MUST land on an IDR and each chunk MUST carry the SPS/PPS (and VPS for
// HEVC), or the piece won't decode - so we capture the parameter sets from the
// head and only cut at IDR start codes.

// NAL type for a header byte. H.264 = low 5 bits; H.265 = bits 1..6.
function nalTypeOf(headerByte, h265) {
  return h265 ? ((headerByte >> 1) & 0x3f) : (headerByte & 0x1f);
}
// IDR / random-access NAL: H.264 type 5; HEVC IDR_W_RADL 19, IDR_N_LP 20, CRA 21.
function isIdrNal(t, h265) { return h265 ? (t === 19 || t === 20 || t === 21) : (t === 5); }
// Parameter-set NAL: H.264 SPS 7 / PPS 8; HEVC VPS 32 / SPS 33 / PPS 34.
function isParamNal(t, h265) { return h265 ? (t === 32 || t === 33 || t === 34) : (t === 7 || t === 8); }

// Pull the parameter sets (SPS/PPS, plus HEVC VPS) out of the stream head and
// return them as one Annex B blob with 4-byte start codes, ready to prepend to a
// chunk. Returns null if the essential sets aren't found.
async function extractRawParamSets(file, h265, signal) {
  const HEAD = Math.min(file.size, 1024 * 1024);
  const buf = new Uint8Array(await file.slice(0, HEAD).arrayBuffer());
  if (signal && signal.aborted) return null;
  const sets = [];
  const seen = new Set();
  let i = 0;
  while (i + 4 <= buf.length) {
    if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) {
      const nalStart = i + 3;
      let j = nalStart;
      while (j + 3 <= buf.length && !(buf[j] === 0 && buf[j + 1] === 0 && buf[j + 2] === 1)) j++;
      const nalEnd = (j + 3 <= buf.length) ? j : buf.length;
      let end = nalEnd;
      while (end > nalStart && buf[end - 1] === 0) end--;   // drop the next SC's leading zeros
      const t = nalTypeOf(buf[nalStart], h265);
      if (isParamNal(t, h265) && !seen.has(t)) { seen.add(t); sets.push({ t, payload: buf.slice(nalStart, end) }); }
      i = nalEnd;
    } else i++;
  }
  const needed = h265 ? [33, 34] : [7, 8];   // VPS is optional; SPS+PPS are not
  if (!needed.every((t) => seen.has(t))) return null;
  const order = h265 ? [32, 33, 34] : [7, 8];
  sets.sort((a, b) => order.indexOf(a.t) - order.indexOf(b.t));
  let total = 0;
  for (const s of sets) total += 4 + s.payload.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const s of sets) { out[p + 3] = 1; p += 4; out.set(s.payload, p); p += s.payload.length; }
  return out;
}

// Human-readable codec / profile from the captured parameter sets. An H.264 SPS
// carries profile_idc and level_idc right after the NAL header byte; HEVC profile
// parsing is far more involved, so it's reported generically.
function describeRawCodec(paramSets, h265) {
  let i = 0;
  while (i + 5 <= paramSets.length) {
    if (paramSets[i] === 0 && paramSets[i + 1] === 0 && paramSets[i + 2] === 1) {
      const s = i + 3;
      const t = nalTypeOf(paramSets[s], h265);
      if (!h265 && t === 7) {
        const profile = paramSets[s + 1], level = paramSets[s + 3];
        const names = { 66: 'Baseline', 77: 'Main', 88: 'Extended', 100: 'High', 110: 'High 10', 122: 'High 4:2:2', 244: 'High 4:4:4' };
        return 'H.264 / AVC (' + (names[profile] || ('profile ' + profile)) + ', level ' + (level / 10).toFixed(1) + ')';
      }
      if (h265 && t === 33) return 'H.265 / HEVC';
      i = s;
    } else i++;
  }
  return h265 ? 'H.265 / HEVC' : 'H.264 / AVC';
}

// Byte offset of the next IDR start code at or after `from`, scanning the file in
// windows (so a multi-GB file is read by seeking, never copied whole). Windows
// overlap by 4 bytes so a start code straddling a boundary isn't missed. Returns
// null if none within maxSpan.
async function findNextIdrOffset(file, from, h265, signal, maxSpan = 128 * 1024 * 1024) {
  const WIN = 8 * 1024 * 1024;
  const limit = Math.min(file.size, from + maxSpan);
  let pos = Math.max(0, from);
  while (pos < limit) {
    if (signal && signal.aborted) return null;
    const end = Math.min(file.size, pos + WIN);
    const buf = new Uint8Array(await file.slice(pos, end).arrayBuffer());
    for (let i = 0; i + 4 <= buf.length; i++) {
      if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1 && isIdrNal(nalTypeOf(buf[i + 3], h265), h265)) {
        return pos + i;
      }
    }
    if (end >= file.size) break;
    pos = end - 4;
  }
  return null;
}

// Work out where to cut a large stream: parameter sets + a list of byte
// boundaries, each on an IDR, sized ~TARGET so every produced MP4 fits in memory.
// Returns null if the stream can't be split (no param sets, or no keyframes found).
async function planRawSegments(file, h265, signal) {
  const paramSets = await extractRawParamSets(file, h265, signal);
  if (!paramSets) return null;
  const TARGET = 256 * 1024 * 1024;
  const boundaries = [0];
  const count = Math.ceil(file.size / TARGET);
  for (let k = 1; k < count; k++) {
    const approx = k * TARGET;
    if (approx >= file.size) break;
    const idr = await findNextIdrOffset(file, approx, h265, signal);
    if (signal && signal.aborted) return null;
    if (idr != null && idr > boundaries[boundaries.length - 1] + 4096) boundaries.push(idr);
  }
  boundaries.push(file.size);
  if (boundaries.length < 3) return null;   // couldn't actually split it
  return { paramSets, boundaries };
}

// Remux one [start,end) byte range into a self-contained MP4: parameter sets
// prepended (so the chunk decodes even though it starts mid-file), stream-copied.
// loaderLabel (optional): when set, the bottom loader bar shows that text while
// this part is being read + remuxed (foreground parts only - not prefetches).
async function remuxRawSegment(file, start, end, paramSets, h265, signal, loaderLabel) {
  const ff = await loadFFmpeg();
  if (signal && signal.aborted) return null;
  if (loaderLabel) showFfmpegLoader(loaderLabel, true);
  const demuxer = h265 ? 'hevc' : 'h264';
  const inName = 'seg.' + (h265 ? 'h265' : 'h264'), outName = 'seg.mp4';
  let blob = null;
  try {
    const body = new Uint8Array(await file.slice(start, end).arrayBuffer());
    if (signal && signal.aborted) return null;
    const chunk = new Uint8Array(paramSets.length + body.length);
    chunk.set(paramSets, 0);
    chunk.set(body, paramSets.length);
    await ff.writeFile(inName, chunk);
    // HEVC segments stream-copy fine but a browser without a HEVC decoder (Firefox,
    // Chromium without hardware support) plays them black. Re-encode those segments
    // to H.264 - slower per part, but the only way the segmented player shows video.
    if (h265 && !canPlayHevc()) {
      try { await ff.exec(['-fflags', '+genpts', '-f', demuxer, '-i', inName, '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outName]); } catch (_) {}
    } else {
      try { await ff.exec(['-fflags', '+genpts', '-f', demuxer, '-i', inName, '-c', 'copy', '-movflags', '+faststart', outName]); } catch (_) {}
    }
    let data = null;
    try { data = await ff.readFile(outName); } catch (_) { data = null; }
    if (data && data.length) blob = new Blob([data.buffer || data], { type: 'video/mp4' });
  } finally {
    try { await ff.deleteFile(inName); } catch (_) {}
    try { await ff.deleteFile(outName); } catch (_) {}
    if (loaderLabel) hideFfmpegLoader();
  }
  return blob;
}

// Opt-in scene-change detection scoped to the part currently loaded in the player
// (it scrubs the <video>, so it can only see the segment that's loaded). Mirrors
// the main player's scene card. Rebuildable so it can be run on each part.
function buildRawSceneCard(playerEl, signal) {
  const card = el('div', { class: 'anr-card' });
  const [scH, scHelp] = h3help('Scene changes',
    'Scans only the part currently loaded in the player. It scrubs through the video, so it can see just the segment that is loaded.');
  card.appendChild(scH); card.appendChild(scHelp);
  const out = el('div');
  const runBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Detect scene changes');
  out.appendChild(runBtn);
  card.appendChild(out);

  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    runBtn.textContent = 'Detecting…';
    const dur = playerEl.duration;
    const prog = stepLoader('Scanning for scene changes…');
    out.innerHTML = '';
    out.appendChild(prog.node);
    let changes = [];
    // Collect the per-sample colour/luma series too. This scan is the only pass
    // over the loaded part, so not collecting meant the segmented player - the one
    // path used for the very largest files - never got a Content timeline at all.
    const contentSamples = [];
    try {
      changes = await detectSceneChanges(playerEl, 55, signal, contentSamples,
        (f) => prog.set(f, 'Scanning for scene changes… ' + Math.round(f * 100) + '%'));
    } catch (_) {}
    try { playerEl.currentTime = 0; playerEl.pause(); } catch (_) {}
    if (signal && signal.aborted) return;
    out.innerHTML = '';
    out.appendChild(el('p', { class: 'anr-hint', style: 'margin-bottom:10px;' },
      changes.length ? changes.length + ' scene change' + (changes.length > 1 ? 's' : '') + ' detected in this part' : 'No scene changes detected in this part'));
    if (changes.length && isFinite(dur) && dur > 0) {
      const timeline = el('div', { class: 'anr-scene-timeline' });
      for (const sc of changes) {
        const marker = el('div', { class: 'anr-scene-marker', style: 'left:' + (sc.time / dur) * 100 + '%;', title: formatDuration(sc.time) + '  ·  ' + sc.confidence + '%' });
        marker.addEventListener('click', () => { playerEl.currentTime = sc.time; playerEl.pause(); });
        timeline.appendChild(marker);
      }
      out.appendChild(timeline);
      const details = el('details', { class: 'anr-scene-details' });
      details.appendChild(el('summary', {}, 'Thumbnails (' + changes.length + ')'));
      const grid = el('div', { class: 'anr-scene-grid' });
      for (const sc of changes) {
        const w = el('div', { class: 'anr-scene-thumb', onclick: () => { playerEl.currentTime = sc.time; playerEl.pause(); } });
        w.appendChild(el('img', { src: sc.thumbnail, alt: 'Scene at ' + formatDuration(sc.time) }));
        w.appendChild(el('span', { class: 'anr-scene-meta' }, formatDuration(sc.time) + ' · ' + sc.confidence + '%'));
        grid.appendChild(w);
      }
      details.appendChild(grid);
      out.appendChild(details);
    }
    const again = el('button', { type: 'button', class: 'anr-btn', style: 'margin-top:10px;' }, 'Run again (current part)');
    again.addEventListener('click', () => {
      // Drop this run's timeline before the card is swapped out, or the stale one
      // is left behind as a sibling and the new run adds a second below it.
      if (card._anrCt) { try { card._anrCt.remove(); } catch (_) {} card._anrCt = null; }
      card.replaceWith(buildRawSceneCard(playerEl, signal));
    });
    out.appendChild(again);
    // Content timeline for the same part, from the samples just collected. Sits
    // after this card, matching where it lands on the main player.
    try {
      const ctCard = buildContentTimelineCard(contentSamples, dur, playerEl);
      if (ctCard) {
        ctCard.appendChild(el('p', { class: 'anr-hint', style: 'margin:10px 0 0;' },
          'Covers only the part currently loaded in the player.'));
        card._anrCt = ctCard;
        card.after(ctCard);
      }
    } catch (_) {}
  });
  return card;
}

// Player for an over-size raw stream: scan -> split at keyframes -> lazily remux
// each part and play them back-to-back. Throws if FFmpeg/scan fails so the caller
// can fall back to the "open in VLC" note.
async function renderSegmentedRawVideo(file, header, resultsEl, kind, signal) {
  const h265 = kind === 'H.265';
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' },
    'Large raw ' + kind + ' stream (' + fmtBytes(file.size) + ') - scanning for keyframes to split it into playable parts…'));

  const plan = await planRawSegments(file, h265, signal);
  if (signal.aborted) return;
  if (!plan) {
    resultsEl.innerHTML = '';
    await renderUnplayableVideoInfo(file, header, resultsEl, signal);
    if (!signal.aborted) {
      resultsEl.appendChild(el('div', { class: 'anr-card' }, [
        el('p', {}, 'This raw ' + kind + ' stream is ' + fmtBytes(file.size) + ' - too large to remux in one piece, and it '
          + 'couldn’t be split (no keyframe index found). Open it in VLC, or wrap it with desktop ffmpeg: '
          + 'ffmpeg -i "' + (file.name || 'input.h264') + '" -c copy out.mp4.')
      ]));
    }
    return;
  }

  const { paramSets, boundaries } = plan;
  const N = boundaries.length - 1;
  resultsEl.innerHTML = '';

  const playerCard = el('div', { class: 'anr-card', style: 'position:relative;' });
  playerCard.appendChild(el('h3', {}, 'Player'));
  const playerEl = el('video', { playsinline: '' });
  playerEl.setAttribute('webkit-playsinline', '');
  playerEl.style.cssText = 'width:100%; max-height:480px; background:#0a0a0a; display:block; border:1px solid var(--hairline);';
  applyVideoControls(playerEl);
  playerCard.appendChild(playerEl);
  playerCard.appendChild(makePlayer(playerEl));

  // Frame-by-frame nav, editable timecode, capture-to-photo and frame-grab - the
  // same tools the normal player gets. Raw streams carry no timing, so 25 fps.
  const frameTools = buildFrameControls(playerEl, () => 25, file);
  playerCard.appendChild(frameTools.wrap);

  const status = el('span', { class: 'anr-hint', style: 'align-self:center;' }, '');
  const prevBtn = el('button', { type: 'button', class: 'anr-btn' }, '‹ Prev');
  const nextBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Next ›');
  playerCard.appendChild(el('div', { class: 'anr-btn-row', style: 'margin-top:8px; gap:8px; flex-wrap:wrap; align-items:center;' }, [prevBtn, nextBtn, status]));

  const strip = el('div', { class: 'anr-seg-strip' });
  const segBtns = [];
  for (let i = 0; i < N; i++) {
    const b = el('button', { type: 'button', class: 'anr-seg-btn' }, String(i + 1));
    b.addEventListener('click', () => goTo(i, true));
    segBtns.push(b);
    strip.appendChild(b);
  }
  playerCard.appendChild(strip);
  resultsEl.appendChild(playerCard);

  const infoCard = el('div', { class: 'anr-card' });
  infoCard.appendChild(el('h3', {}, 'File info'));
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Name', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size) + '   (' + file.size.toLocaleString() + ' bytes)'));
  if (header && header.container) tbl.appendChild(row('Container', header.container));
  tbl.appendChild(row('Codec', describeRawCodec(paramSets, h265)));
  const resRow = row('Resolution', '-');
  tbl.appendChild(resRow);
  const arRow = row('Aspect ratio', '-');
  tbl.appendChild(arRow);
  tbl.appendChild(row('Frame rate', '25 fps (assumed - a raw stream carries no timing)'));
  tbl.appendChild(row('Parts', N + ' × ~' + fmtBytes(Math.round(file.size / N)) + ', split at keyframes'));
  infoCard.appendChild(tbl);
  infoCard.appendChild(el('p', { class: 'anr-hint' },
    'Too big to convert in one piece, so it’s split at keyframes into ' + N + ' parts, each remuxed to MP4 on demand and '
    + 'played back-to-back.'));
  resultsEl.appendChild(infoCard);

  // Integrity: hashing a multi-GB file reads the whole thing, so keep it on-demand.
  const hashCard = el('div', { class: 'anr-card' });
  const [hashH, hashHelp] = h3help('Integrity',
    '<strong>SHA-256</strong> is a cryptographic fingerprint of the file’s exact contents. Computing it reads the whole file (' + fmtBytes(file.size) + '), so for a video this size it is left to a button rather than run automatically.');
  hashCard.appendChild(hashH); hashCard.appendChild(hashHelp);
  const hashBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Compute SHA-256');
  hashBtn.addEventListener('click', () => { hashCard.replaceWith(integrityCard(file)); });
  hashCard.appendChild(el('div', { class: 'anr-btn-row', style: 'margin-top:8px;' }, [hashBtn]));
  resultsEl.appendChild(hashCard);

  resultsEl.appendChild(buildRawSceneCard(playerEl, signal));

  const cache = new Map();   // i -> { url }
  let cur = -1;
  let gen = 0;

  async function ensureSegment(i, loaderLabel) {
    if (i < 0 || i >= N) return null;
    if (cache.has(i)) return cache.get(i);
    const blob = await remuxRawSegment(file, boundaries[i], boundaries[i + 1], paramSets, h265, signal, loaderLabel);
    if (!blob) return null;
    const entry = { url: URL.createObjectURL(blob) };
    cache.set(i, entry);
    // Keep only the neighbours of the current part so memory stays bounded.
    for (const key of [...cache.keys()]) {
      if (Math.abs(key - i) > 1) { try { URL.revokeObjectURL(cache.get(key).url); } catch (_) {} cache.delete(key); }
    }
    return entry;
  }

  async function goTo(i, autoplay) {
    if (i < 0 || i >= N || signal.aborted) return;
    const myGen = ++gen;
    cur = i;
    segBtns.forEach((b, j) => b.classList.toggle('is-active', j === i));
    prevBtn.disabled = i === 0;
    nextBtn.disabled = i === N - 1;
    status.textContent = 'Preparing part ' + (i + 1) + ' / ' + N + '…';
    let entry = null;
    try { entry = await ensureSegment(i, 'Preparing part ' + (i + 1) + ' / ' + N + '…'); } catch (_) { entry = null; }
    if (myGen !== gen || signal.aborted) return;
    if (!entry) { status.textContent = 'Part ' + (i + 1) + ' couldn’t be prepared.'; return; }
    playerEl.onloadedmetadata = () => {
      if (playerEl.videoWidth) {
        resRow.lastChild.textContent = playerEl.videoWidth + ' × ' + playerEl.videoHeight + ' px';
        arRow.lastChild.textContent = aspectRatio(playerEl.videoWidth, playerEl.videoHeight);
      }
      frameTools.refresh();
    };
    playerEl.src = entry.url;
    status.textContent = 'Part ' + (i + 1) + ' / ' + N;
    if (autoplay) playerEl.play().catch(() => {});
    if (i + 1 < N) ensureSegment(i + 1).catch(() => {});   // prefetch the next part
  }

  playerEl.addEventListener('ended', () => { if (cur + 1 < N) goTo(cur + 1, true); });
  signal.addEventListener('abort', () => {
    for (const v of cache.values()) { try { URL.revokeObjectURL(v.url); } catch (_) {} }
    cache.clear();
  });

  await goTo(0, false);
}

// Grab the very first frame of a video the browser itself can't decode (ProRes,
// DNxHD, HEVC-in-MKV, ...) using the FFmpeg WASM fallback, as { blob, time }.
// Decodes a SINGLE frame only - it no longer scans a ladder of timestamps for a
// non-black frame - so even a large or slow-to-decode master pays for just one
// decode. Prefers a WORKERFS mount so multi-GB files are read by seeking rather
// than copied whole into WASM memory; falls back to an in-memory copy for
// smaller files. Returns null if nothing usable could be extracted. Fully guarded.
async function ffmpegFirstFrame(file, signal) {
  const ff = await loadFFmpeg();
  if (signal && signal.aborted) return null;

  const MOUNT = '/anrmnt';
  let input = null;
  let cleanup = async () => {};
  try {
    // Preferred path: mount the File via WORKERFS (no full in-memory copy).
    let mounted = false;
    try {
      await ff.createDir(MOUNT);
      mounted = await ff.mount('WORKERFS', { files: [file] }, MOUNT);
    } catch (_) { mounted = false; }
    if (mounted) {
      input = MOUNT + '/' + file.name;
      cleanup = async () => {
        try { await ff.unmount(MOUNT); } catch (_) {}
        try { await ff.deleteDir(MOUNT); } catch (_) {}
      };
    } else {
      // Fallback: copy into MEMFS, but only when small enough to fit WASM memory.
      try { await ff.deleteDir(MOUNT); } catch (_) {}
      if (file.size > 1_200 * 1024 * 1024) return null;
      const { fetchFile } = await import(new URL('../../vendor/ffmpeg/ffmpeg-util.js', import.meta.url).href);
      await ff.writeFile('anr_input', await fetchFile(file));
      input = 'anr_input';
      cleanup = async () => { try { await ff.deleteFile('anr_input'); } catch (_) {} };
    }

    if (signal && signal.aborted) return null;
    // Decode exactly one frame - the first - and stop. No -ss ladder, so a large
    // or hard-to-decode video isn't paying for repeated seeks and decodes.
    try {
      await ff.exec(['-i', input, '-frames:v', '1', '-q:v', '3', '-y', 'anr_frame.jpg'], 45000);
    } catch (_) { return null; }
    let data = null;
    try { data = await ff.readFile('anr_frame.jpg'); } catch (_) {}
    try { await ff.deleteFile('anr_frame.jpg'); } catch (_) {}
    if (!data || !data.length) return null;
    const blob = new Blob([data.buffer || data], { type: 'image/jpeg' });
    return { blob, time: 0 };
  } catch (_) {
    return null;
  } finally {
    await cleanup();
  }
}

// ---------- helpers ----------

function gcd(a, b) { return b ? gcd(b, a % b) : a; }

function aspectRatio(w, h) {
  if (!w || !h) return '-';
  const d = gcd(w, h);
  return `${w / d}:${h / d}  (${(w / h).toFixed(4)})`;
}

function formatDuration(sec) {
  if (!isFinite(sec)) return '-';
  if (sec < 60) return sec.toFixed(2) + 's';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + s.toFixed(0).padStart(2, '0');
  return m + ':' + s.toFixed(1).padStart(4, '0');
}

function fmtDate(d) {
  if (!d) return '-';
  if (d instanceof Date) return d.toISOString().replace('T', ' ').replace(/\..*$/, '');
  return String(d);
}

let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

// ---------- MP4 PCM audio extraction ----------

function parseBoxes(view, start, end) {
  const boxes = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = view.getUint32(pos);
    const type = String.fromCharCode(view.getUint8(pos+4), view.getUint8(pos+5), view.getUint8(pos+6), view.getUint8(pos+7));
    if (size === 0) break;
    if (size === 1 && pos + 16 <= end) {
      size = Number(view.getBigUint64(pos + 8));
      boxes.push({ type, offset: pos, size, headerSize: 16 });
    } else {
      boxes.push({ type, offset: pos, size, headerSize: 8 });
    }
    pos += size;
  }
  return boxes;
}

function findAllBoxes(view, start, end, type) {
  const result = [];
  const stack = [{ s: start, e: end }];
  const containers = new Set(['moov','trak','mdia','minf','stbl','udta','edts','dinf','meta','ilst']);
  while (stack.length) {
    const { s, e } = stack.pop();
    for (const b of parseBoxes(view, s, e)) {
      if (b.type === type) result.push(b);
      if (containers.has(b.type)) stack.push({ s: b.offset + b.headerSize, e: b.offset + b.size });
    }
  }
  return result;
}

function extractPcmFromMp4(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const fileEnd = arrayBuffer.byteLength;

  const traks = findAllBoxes(view, 0, fileEnd, 'trak');
  for (const trak of traks) {
    const trakEnd = trak.offset + trak.size;
    const trakStart = trak.offset + trak.headerSize;

    const stsdBoxes = findAllBoxes(view, trakStart, trakEnd, 'stsd');
    if (!stsdBoxes.length) continue;
    const stsd = stsdBoxes[0];
    const stsdData = stsd.offset + stsd.headerSize + 8;
    if (stsdData + 8 > fileEnd) continue;
    const codecFcc = String.fromCharCode(
      view.getUint8(stsdData + 4), view.getUint8(stsdData + 5),
      view.getUint8(stsdData + 6), view.getUint8(stsdData + 7));
    const pcmCodecs = new Set(['twos','sowt','lpcm','in16','in24','in32','raw ','NONE','ulaw','alaw']);
    if (!pcmCodecs.has(codecFcc)) continue;

    const base = stsdData + 8;
    const channels = view.getUint16(base + 16);
    const bitsPerSample = view.getUint16(base + 18);
    const sampleRate = view.getUint16(base + 24);

    const stszBoxes = findAllBoxes(view, trakStart, trakEnd, 'stsz');
    const stcoBoxes = findAllBoxes(view, trakStart, trakEnd, 'stco');
    const co64Boxes = findAllBoxes(view, trakStart, trakEnd, 'co64');
    const stscBoxes = findAllBoxes(view, trakStart, trakEnd, 'stsc');
    if (!stcoBoxes.length && !co64Boxes.length) continue;

    const chunkOffsets = [];
    if (stcoBoxes.length) {
      const box = stcoBoxes[0];
      const d = box.offset + box.headerSize;
      const count = view.getUint32(d + 4);
      for (let i = 0; i < count; i++) chunkOffsets.push(view.getUint32(d + 8 + i * 4));
    } else {
      const box = co64Boxes[0];
      const d = box.offset + box.headerSize;
      const count = view.getUint32(d + 4);
      for (let i = 0; i < count; i++) chunkOffsets.push(Number(view.getBigUint64(d + 8 + i * 8)));
    }

    let samplesPerChunk = 1;
    let chunkSampleSize = 0;
    if (stscBoxes.length) {
      const box = stscBoxes[0];
      const d = box.offset + box.headerSize;
      const count = view.getUint32(d + 4);
      if (count > 0) samplesPerChunk = view.getUint32(d + 8 + 4);
    }
    if (stszBoxes.length) {
      const box = stszBoxes[0];
      const d = box.offset + box.headerSize;
      chunkSampleSize = view.getUint32(d + 4);
    }

    const bytesPerSample = bitsPerSample / 8;
    const frameSize = bytesPerSample * channels;
    const bigEndian = codecFcc === 'twos' || codecFcc === 'in16' || codecFcc === 'in24' || codecFcc === 'in32';

    // Only these widths decode below; anything else produced no samples in the
    // old code and fell through to the next trak, so bail here and keep the
    // sample-count arithmetic below honest (a 0 would divide by zero).
    if (bytesPerSample !== 2 && bytesPerSample !== 3 && bytesPerSample !== 4) continue;

    // Pass 1: how many samples does the chunk plan yield? Pure arithmetic - no
    // decoding, no allocation. Knowing the total up front is what lets pass 2
    // write straight into the AudioBuffer.
    //
    // This used to push every sample into a plain JS array and then walk that
    // array AGAIN to de-interleave into the channel data: two full passes over
    // ~817k samples for eight seconds of 48kHz stereo, plus a multi-megabyte
    // temporary that grows by reallocation throughout. It ran on the main thread
    // at the exact moment the player was starting, which is what chopped playback
    // in the first second or two on a PCM-audio clip - and it scaled with clip
    // length, so a longer take stuttered where a shorter one did not.
    const plan = [];
    let totalSamples = 0;
    for (const offset of chunkOffsets) {
      const chunkBytes = samplesPerChunk * (chunkSampleSize || frameSize);
      if (offset + chunkBytes > fileEnd) break;
      const n = Math.floor(Math.min(chunkBytes, fileEnd - offset) / bytesPerSample);
      if (n <= 0) continue;
      plan.push(offset, n);
      totalSamples += n;
    }

    const totalFrames = Math.floor(totalSamples / channels);
    if (totalFrames <= 0) continue;

    // Build the buffer via the shared context (createBuffer accepts any rate,
    // regardless of the context's own). Avoids a per-file OfflineAudioContext -
    // which needs a webkit fallback on old Safari and throws RangeError on an
    // out-of-range rate - and guards a mis-parsed/zero rate that would still throw.
    const sr = (sampleRate >= 3000 && sampleRate <= 384000) ? sampleRate : 44100;
    const audioBuf = getAudioCtx().createBuffer(channels, totalFrames, sr);
    const chans = [];
    for (let ch = 0; ch < channels; ch++) chans.push(audioBuf.getChannelData(ch));

    // Pass 2: decode each sample once, straight into its channel. `s` is the
    // running interleaved index, so frame = s / channels and channel = s % channels.
    let s = 0;
    for (let p = 0; p < plan.length; p += 2) {
      const offset = plan[p], n = plan[p + 1];
      for (let i = 0; i < n; i++, s++) {
        const frame = (s / channels) | 0;
        if (frame >= totalFrames) break;
        const pos = offset + i * bytesPerSample;
        let val;
        if (bytesPerSample === 2) {
          val = (bigEndian ? view.getInt16(pos) : view.getInt16(pos, true)) / 0x8000;
        } else if (bytesPerSample === 3) {
          const b0 = view.getUint8(pos), b1 = view.getUint8(pos + 1), b2 = view.getUint8(pos + 2);
          val = (bigEndian ? ((b0 << 24 | b1 << 16 | b2 << 8) >> 8) : ((b2 << 24 | b1 << 16 | b0 << 8) >> 8)) / 0x800000;
        } else {
          val = (bigEndian ? view.getInt32(pos) : view.getInt32(pos, true)) / 0x80000000;
        }
        chans[s % channels][frame] = val;
      }
    }
    return audioBuf;
  }
  return null;
}

// Encode a decoded AudioBuffer to a 16-bit PCM WAV blob URL for <audio> playback.
function audioBufferToWavUrl(audioBuf) {
  const channels = audioBuf.numberOfChannels;
  const sr = audioBuf.sampleRate;
  const samples = audioBuf.length;
  const block = channels * 2;
  const dataSize = samples * block;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  let o = 0;
  const ws = (s) => { for (let i = 0; i < s.length; i++) view.setUint8(o++, s.charCodeAt(i)); };
  ws('RIFF'); view.setUint32(o, 36 + dataSize, true); o += 4; ws('WAVEfmt ');
  view.setUint32(o, 16, true); o += 4;
  view.setUint16(o, 1, true); o += 2;
  view.setUint16(o, channels, true); o += 2;
  view.setUint32(o, sr, true); o += 4;
  view.setUint32(o, sr * block, true); o += 4;
  view.setUint16(o, block, true); o += 2;
  view.setUint16(o, 16, true); o += 2;
  ws('data'); view.setUint32(o, dataSize, true); o += 4;
  const ch = [];
  for (let c = 0; c < channels; c++) ch.push(audioBuf.getChannelData(c));
  for (let i = 0; i < samples; i++) {
    for (let c = 0; c < channels; c++) {
      let s = Math.max(-1, Math.min(1, ch[c][i]));
      view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true); o += 2;
    }
  }
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

// Audio sample-entry fourCCs the browser can't play in <video> - uncompressed PCM
// (twos/sowt/lpcm/in16/in24/in32/raw /NONE/fl32/fl64) plus companded mu-law/A-law.
// Browsers decode the VIDEO of such a clip but silently drop this audio (Sony
// cameras use 'twos').
const BROWSER_UNPLAYABLE_AUDIO = new Set(['twos','sowt','lpcm','in16','in24','in32','raw ','NONE','ulaw','alaw','fl32','fl64']);

// Cheaply find the audio track's codec fourCC by walking only box HEADERS over the
// File (seeking past mdat by size, never reading its bytes), so it's fast even on a
// multi-GB clip whose moov sits at the tail. Returns the lowercase-ish fourCC or ''.
async function sniffMp4AudioCodec(file) {
  const u32 = (b, p) => (b[p] << 24 | b[p+1] << 16 | b[p+2] << 8 | b[p+3]) >>> 0;
  const fourcc = (b, p) => String.fromCharCode(b[p], b[p+1], b[p+2], b[p+3]);
  // Locate the top-level moov box by reading 8-16 byte headers and jumping.
  async function findMoov() {
    let off = 0;
    for (let guard = 0; guard < 4096 && off + 8 <= file.size; guard++) {
      const h = new Uint8Array(await file.slice(off, off + 16).arrayBuffer());
      if (h.length < 8) return null;
      let size = u32(h, 0); let hdr = 8;
      const type = fourcc(h, 4);
      if (size === 1) { // 64-bit size
        size = Number((BigInt(u32(h, 8)) << 32n) | BigInt(u32(h, 12))); hdr = 16;
      }
      if (size < hdr) return null;
      if (type === 'moov') return { off, size };
      off += size;
    }
    return null;
  }
  try {
    const moov = await findMoov();
    if (!moov) return '';
    const moovBuf = await file.slice(moov.off, moov.off + moov.size).arrayBuffer();
    const view = new DataView(moovBuf);
    // Reuse the box walker (offsets relative to the moov slice).
    for (const trak of findAllBoxes(view, 0, moovBuf.byteLength, 'trak')) {
      const ts = trak.offset + trak.headerSize, te = trak.offset + trak.size;
      const hdlr = findAllBoxes(view, ts, te, 'hdlr')[0];
      if (!hdlr) continue;
      const handler = String.fromCharCode(
        view.getUint8(hdlr.offset + hdlr.headerSize + 8), view.getUint8(hdlr.offset + hdlr.headerSize + 9),
        view.getUint8(hdlr.offset + hdlr.headerSize + 10), view.getUint8(hdlr.offset + hdlr.headerSize + 11));
      if (handler !== 'soun') continue;
      const stsd = findAllBoxes(view, ts, te, 'stsd')[0];
      if (!stsd) continue;
      const d = stsd.offset + stsd.headerSize + 8;
      return String.fromCharCode(view.getUint8(d + 4), view.getUint8(d + 5), view.getUint8(d + 6), view.getUint8(d + 7));
    }
  } catch (_) {}
  return '';
}

// When a clip's audio codec is one browsers can't play, extract it to a WAV and
// register it as the synced audio companion so the muted <video> still has sound.
// Best-effort and fully in the background: silent on any failure. Skipped above a
// size cap (the whole file must be read into memory to extract PCM).
async function attachPcmAudioCompanion(file, playerCard, signal) {
  const ctx = curVctx();   // capture now: this runs fire-and-forget, resolving after renderVideo returns
  const COMPANION_MAX_BYTES = 2 * 1024 * 1024 * 1024;   // 2 GB: cap the in-memory decode
  try {
    if (!file || file.size > COMPANION_MAX_BYTES) return;
    const codec = await sniffMp4AudioCodec(file);
    if (!BROWSER_UNPLAYABLE_AUDIO.has(codec)) return;     // browser plays it natively
    if (signal && signal.aborted) return;
    const buf = await file.arrayBuffer();
    if (signal && signal.aborted) return;
    let audioBuf = extractPcmFromMp4(buf);
    if (!audioBuf) { try { audioBuf = await ffmpegExtractAudio(file, playerCard); } catch (_) {} }
    if (!audioBuf || (signal && signal.aborted)) return;
    const wavUrl = audioBufferToWavUrl(audioBuf);
    const companion = el('audio', { src: wavUrl, preload: 'auto' });
    companion.style.display = 'none';
    playerCard.appendChild(companion);
    ctx.companion(companion);
    if (signal) signal.addEventListener('abort', () => { try { ctx.companion(null); URL.revokeObjectURL(wavUrl); } catch (_) {} });
  } catch (_) { /* best-effort: no companion, video just stays mute */ }
}

// ---------- container detection from magic bytes ----------

async function peekVideoContainer(file) {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const ascii = (s, l) => String.fromCharCode(...head.slice(s, s + l));

  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4).trim();
    const names = {
      'isom': 'MP4', 'iso2': 'MP4', 'mp41': 'MP4', 'mp42': 'MP4',
      'M4V': 'M4V', 'qt': 'QuickTime MOV',
      'avc1': 'MP4 (H.264)', 'hvc1': 'MP4 (H.265)',
      '3gp4': '3GP', '3gp5': '3GP', '3g2a': '3G2'
    };
    return { container: names[brand] || 'MP4 / MOV', brand };
  }
  if (head[0] === 0x1A && head[1] === 0x45 && head[2] === 0xDF && head[3] === 0xA3)
    return { container: 'Matroska / WebM' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'AVI ')
    return { container: 'AVI' };
  if (ascii(0, 3) === 'FLV')
    return { container: 'FLV' };
  // MPEG-TS sync byte 0x47 at the packet start (188-byte TS), or at offset 4 of a
  // 192-byte M2TS/AVCHD packet whose 4-byte TP_extra_header (camcorder timecode)
  // precedes it - the .mts/.m2ts files Sony/Panasonic camcorders write.
  if (head[0] === 0x47 || head[4] === 0x47)
    return { container: 'MPEG-TS' };
  if (head[0] === 0x00 && head[1] === 0x00 && head[2] === 0x01 && head[3] === 0xBA)
    return { container: 'MPEG-PS' };
  if (ascii(0, 4) === 'OggS')
    return { container: 'OGG (Theora)' };
  if (head[0] === 0x30 && head[1] === 0x26 && head[2] === 0xB2 && head[3] === 0x75)
    return { container: 'WMV / ASF' };

  // Raw H.264 / H.265 elementary stream (Annex B): no container, just NAL units
  // separated by start codes (00 00 01 or 00 00 00 01). The first NAL header byte
  // identifies the stream: for H.264 the type is the low 5 bits (7=SPS, 8=PPS,
  // 5=IDR, 1=non-IDR); for HEVC it's bits 1..6 (32=VPS, 33=SPS, 34=PPS). The
  // forbidden_zero_bit (high bit) is always 0, which also rules out MPEG-PS
  // (00 00 01 BA, high bit set), handled above.
  if (head[0] === 0x00 && head[1] === 0x00 &&
      (head[2] === 0x01 || (head[2] === 0x00 && head[3] === 0x01))) {
    const nal = head[head[2] === 0x01 ? 3 : 4];
    if ((nal & 0x80) === 0) {
      const t264 = nal & 0x1f;
      if (t264 === 7 || t264 === 8 || t264 === 5 || t264 === 1)
        return { container: 'Raw H.264 (Annex B)', raw: 'h264' };
      const t265 = (nal >> 1) & 0x3f;
      if (t265 === 32 || t265 === 33 || t265 === 34)
        return { container: 'Raw H.265 (Annex B)', raw: 'h265' };
    }
  }
  return { container: 'unknown' };
}

// ---------- authoring software (container metadata) ----------

// Matroska / WebM store the writing app + muxing library as UTF-8 in the Segment
// Info element (WritingApp = element id 0x5741, MuxingApp = 0x4D80). Rather than
// fully parse EBML, scan the head for those two-byte ids, read the following data
// size (an EBML vint) and pull the string. The ids are distinctive and the Info
// element sits near the file start, so this is cheap and reliable.
async function readMatroskaApps(file) {
  const n = Math.min(file.size, 4 * 1024 * 1024);
  const b = new Uint8Array(await file.slice(0, n).arrayBuffer());
  const readVint = (p) => {
    let first = b[p], mask = 0x80, len = 1;
    while (len <= 8 && !(first & mask)) { mask >>= 1; len++; }
    if (len > 8 || first === undefined) return null;
    let val = first & (mask - 1);
    for (let i = 1; i < len; i++) val = val * 256 + b[p + i];
    return { len, val };
  };
  const grab = (id0, id1) => {
    for (let i = 0; i + 3 < b.length; i++) {
      if (b[i] !== id0 || b[i + 1] !== id1) continue;
      const v = readVint(i + 2);
      if (!v || v.val <= 0 || v.val > 256) continue;
      const s = i + 2 + v.len;
      if (s + v.val > b.length) continue;
      const str = new TextDecoder('utf-8').decode(b.slice(s, s + v.val)).replace(/\0+$/, '').trim();
      if (str && /^[ -~].*$/.test(str)) return str;
    }
    return '';
  };
  const out = {};
  const w = grab(0x57, 0x41), m = grab(0x4D, 0x80);
  if (w) out.writingApp = w;
  if (m) out.muxingApp = m;
  return out;
}

// AVI stores the authoring software as an ISFT entry inside a LIST INFO chunk -
// usually in the header LIST near the start, occasionally in a trailing INFO list.
async function readAviSoftware(file) {
  const scan = (b) => {
    for (let i = 0; i + 8 < b.length; i++) {
      if (b[i] === 0x49 && b[i + 1] === 0x53 && b[i + 2] === 0x46 && b[i + 3] === 0x54) { // 'ISFT'
        const len = b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24);
        if (len > 0 && len < 512 && i + 8 + len <= b.length) {
          const s = new TextDecoder('latin1').decode(b.slice(i + 8, i + 8 + len)).replace(/\0+$/, '').trim();
          if (s) return s;
        }
      }
    }
    return '';
  };
  const headN = Math.min(file.size, 2 * 1024 * 1024);
  let s = scan(new Uint8Array(await file.slice(0, headN).arrayBuffer()));
  if (!s && file.size > headN) {
    const tailN = Math.min(file.size, 512 * 1024);
    s = scan(new Uint8Array(await file.slice(file.size - tailN).arrayBuffer()));
  }
  return s ? { software: s } : {};
}

// MP4 / MOV record the encoding tool in the iTunes-style "©too" atom, inside
// moov/udta/meta/ilst. moov can sit at the head or the tail, so scan both. The
// atom is "©too" then a "data" child: [size][data][flags][reserved][UTF-8 value].
async function readMp4Encoder(file) {
  const find = (b) => {
    for (let i = 0; i + 24 < b.length; i++) {
      if (b[i] !== 0xA9 || b[i + 1] !== 0x74 || b[i + 2] !== 0x6F || b[i + 3] !== 0x6F) continue; // '©too'
      if (!(b[i + 8] === 0x64 && b[i + 9] === 0x61 && b[i + 10] === 0x74 && b[i + 11] === 0x61)) continue; // 'data'
      const dataSize = ((b[i + 4] << 24) | (b[i + 5] << 16) | (b[i + 6] << 8) | b[i + 7]) >>> 0;
      const vs = i + 20, vlen = dataSize - 16;
      if (vlen > 0 && vlen < 256 && vs + vlen <= b.length) {
        const s = new TextDecoder('utf-8').decode(b.slice(vs, vs + vlen)).replace(/\0+$/, '').trim();
        if (s && /[ -~]/.test(s)) return s;
      }
    }
    return '';
  };
  const headN = Math.min(file.size, 2 * 1024 * 1024);
  let s = find(new Uint8Array(await file.slice(0, headN).arrayBuffer()));
  if (!s && file.size > headN) s = find(new Uint8Array(await file.slice(Math.max(0, file.size - 4 * 1024 * 1024)).arrayBuffer()));
  return s ? { software: s } : {};
}

async function readContainerSoftware(file, container) {
  try {
    if (/Matroska|WebM/i.test(container || '')) return await readMatroskaApps(file);
    if (container === 'AVI') return await readAviSoftware(file);
    if (/MP4|MOV|M4V|QuickTime|3GP|3G2/i.test(container || '')) return await readMp4Encoder(file);
  } catch (_) { /* best-effort */ }
  return {};
}

// Append the "Created with" / "Muxer" rows from whatever the container recorded.
function appendCreatorRows(tbl, header) {
  if (!header) return;
  const created = header.writingApp || header.software;
  if (created) tbl.appendChild(rowHelp('Created with', created,
    'The app or software that created this file, as noted inside the file itself (the Matroska WritingApp or AVI ISFT field).'));
  if (header.muxingApp && header.muxingApp !== header.writingApp)
    tbl.appendChild(rowHelp('Muxer', header.muxingApp,
      'The tool that packaged (multiplexed) the separate video and audio streams together into this container file. It can differ from the app that created the content - for example, an edit finished in one program but wrapped into the file by another.'));
}

// ---------- frame rate detection ----------

async function detectFpsFromContainer(file) {
  if (file.size < 12) return null;
  const headBuf = await file.slice(0, Math.min(file.size, 64)).arrayBuffer();
  const hv = new DataView(headBuf);
  const ftyp = String.fromCharCode(hv.getUint8(4), hv.getUint8(5), hv.getUint8(6), hv.getUint8(7));
  if (ftyp !== 'ftyp') return null;

  // Walk top-level boxes to find moov (handles 64-bit extended sizes)
  let moovOffset = -1, moovSize = 0, pos = 0;
  while (pos < file.size) {
    const headerBuf = await file.slice(pos, pos + 16).arrayBuffer();
    const dv = new DataView(headerBuf);
    if (headerBuf.byteLength < 8) break;
    let boxSize = dv.getUint32(0);
    const type = String.fromCharCode(dv.getUint8(4), dv.getUint8(5), dv.getUint8(6), dv.getUint8(7));
    if (boxSize === 1 && headerBuf.byteLength >= 16) {
      const hi = dv.getUint32(8), lo = dv.getUint32(12);
      boxSize = hi * 0x100000000 + lo;
    }
    if (boxSize < 8) break;
    if (type === 'moov') { moovOffset = pos; moovSize = boxSize; break; }
    pos += boxSize;
  }

  if (moovOffset < 0 || moovSize > 20 * 1024 * 1024) return null;
  const moovBuf = await file.slice(moovOffset, moovOffset + moovSize).arrayBuffer();
  const view = new DataView(moovBuf);
  const traks = findAllBoxes(view, 8, moovSize, 'trak');
  for (const trak of traks) {
    const trakStart = trak.offset + trak.headerSize;
    const trakEnd = Math.min(trak.offset + trak.size, moovSize);
    if (!findAllBoxes(view, trakStart, trakEnd, 'vmhd').length) continue;
    const mdhdBoxes = findAllBoxes(view, trakStart, trakEnd, 'mdhd');
    if (!mdhdBoxes.length) continue;
    const mdhd = mdhdBoxes[0];
    const mdhdData = mdhd.offset + mdhd.headerSize;
    if (mdhdData + 24 > moovSize) continue;
    const mdhdVersion = view.getUint8(mdhdData);
    const timescale = mdhdVersion === 1
      ? view.getUint32(mdhdData + 20)
      : view.getUint32(mdhdData + 12);
    const sttsBoxes = findAllBoxes(view, trakStart, trakEnd, 'stts');
    if (!sttsBoxes.length) continue;
    const stts = sttsBoxes[0];
    const sttsData = stts.offset + stts.headerSize;
    if (sttsData + 16 > moovSize) continue;
    if (view.getUint32(sttsData + 4) < 1) continue;
    const sampleDuration = view.getUint32(sttsData + 12);
    if (sampleDuration <= 0 || timescale <= 0) continue;
    const fps = timescale / sampleDuration;
    if (fps > 1 && fps < 1000) return roundFps(fps);
  }
  return null;
}

// ---------- codec / rotation / HDR detection (ISOBMFF) ----------
// Walks the SAME moov/trak boxes as the fps detector to surface, per track:
// video codec (from stsd FourCC + avcC/hvcC profile/level), display rotation
// (from the tkhd 3x3 matrix), HDR/colour (from a 'colr' nclx box, plus mdcv/clli
// presence), and audio codec + channel count. Purely additive and best-effort:
// any failure is swallowed so the existing fps/preview/frame-stepping path is
// never affected.

const VIDEO_CODEC_NAMES = {
  avc1: 'H.264 / AVC', avc3: 'H.264 / AVC',
  hvc1: 'H.265 / HEVC', hev1: 'H.265 / HEVC',
  av01: 'AV1', vp09: 'VP9', vp08: 'VP8',
  mp4v: 'MPEG-4 Visual', 'dvh1': 'Dolby Vision (HEVC)', 'dvhe': 'Dolby Vision (HEVC)',
  s263: 'H.263', 'mjpg': 'Motion JPEG', jpeg: 'Motion JPEG',
  // Professional / intermediate codecs. Browsers ship no decoder for these, so
  // they never play in <video>; we still name them for identification and to
  // explain why playback fails (see PRO_VIDEO_CODECS / renderUnplayableVideoInfo).
  apco: 'Apple ProRes 422 Proxy', apcs: 'Apple ProRes 422 LT',
  apcn: 'Apple ProRes 422', apch: 'Apple ProRes 422 HQ',
  ap4h: 'Apple ProRes 4444', ap4x: 'Apple ProRes 4444 XQ',
  AVdn: 'Avid DNxHD / DNxHR', AVdh: 'Avid DNxHR',
  cfhd: 'GoPro CineForm', CFHD: 'GoPro CineForm',
  dvc: 'DV', dvcp: 'DV (PAL)', dvpp: 'DVCPRO', dv5p: 'DVCPRO50', dvh5: 'DVCPRO HD',
  icod: 'Apple Intermediate Codec', 'rle ': 'QuickTime Animation (RLE)',
  png: 'PNG (video track)', 'v210': 'Uncompressed 10-bit 4:2:2', '2vuy': 'Uncompressed 8-bit 4:2:2'
};
// Codecs that are professional/intermediate/uncompressed - identifiable but never
// playable in a browser. Used to tailor the "can't play this codec" explanation.
const PRO_VIDEO_CODECS = new Set([
  'apco', 'apcs', 'apcn', 'apch', 'ap4h', 'ap4x', 'AVdn', 'AVdh',
  'cfhd', 'CFHD', 'dvc', 'dvcp', 'dvpp', 'dv5p', 'dvh5', 'icod',
  'rle ', 'v210', '2vuy'
]);
const AUDIO_CODEC_NAMES = {
  mp4a: 'AAC', alac: 'Apple Lossless (ALAC)', 'ac-3': 'Dolby Digital (AC-3)',
  'ec-3': 'Dolby Digital Plus (E-AC-3)', 'Opus': 'Opus', sowt: 'PCM', twos: 'PCM',
  lpcm: 'PCM', 'in24': 'PCM (24-bit)', 'in32': 'PCM (32-bit)', samr: 'AMR'
};
// H.264 profile_idc -> friendly name (subset that matters for consumer video).
const H264_PROFILES = {
  66: 'Baseline', 77: 'Main', 88: 'Extended', 100: 'High',
  110: 'High 10', 122: 'High 4:2:2', 244: 'High 4:4:4'
};
// chroma_format_idc (HEVC hvcC / H.264 avcC extension): 0 mono, 1 4:2:0, 2 4:2:2, 3 4:4:4.
const CHROMA_FORMATS = { 0: 'monochrome', 1: '4:2:0', 2: '4:2:2', 3: '4:4:4' };
// ISO/IEC 23001-8 colour primaries / transfer characteristics codes we care about.
const COLOUR_PRIMARIES = { 1: 'BT.709', 5: 'BT.601 (PAL)', 6: 'BT.601 (NTSC)', 9: 'BT.2020' };
const TRANSFER_CHARS = { 1: 'BT.709', 6: 'BT.601', 16: 'PQ', 18: 'HLG' };

function fcc(view, p) {
  return String.fromCharCode(view.getUint8(p), view.getUint8(p + 1), view.getUint8(p + 2), view.getUint8(p + 3));
}

// Derive a 0/90/180/270 display rotation from the tkhd 3x3 transform matrix.
// The matrix stores a,b,c,d as 16.16 fixed-point; rotation maps to the sign/
// magnitude pattern of (a,b,c,d). Returns 0 for identity / unknown.
function rotationFromMatrix(a, b, c, d) {
  const r = (x) => Math.round(x);
  a = r(a); b = r(b); c = r(c); d = r(d);
  if (a === 1 && b === 0 && c === 0 && d === 1) return 0;
  if (a === 0 && b === 1 && c === -1 && d === 0) return 90;
  if (a === -1 && b === 0 && c === 0 && d === -1) return 180;
  if (a === 0 && b === -1 && c === 1 && d === 0) return 270;
  // Fall back to atan2 of the first row for non-canonical matrices.
  const deg = Math.round(Math.atan2(b, a) * 180 / Math.PI);
  return ((deg % 360) + 360) % 360;
}

async function detectIsobmffTracks(file) {
  if (file.size < 12) return null;
  const headBuf = await file.slice(0, Math.min(file.size, 64)).arrayBuffer();
  const hv = new DataView(headBuf);
  if (fcc(hv, 4) !== 'ftyp') return null;

  // Find the moov box (same top-level walk as detectFpsFromContainer).
  let moovOffset = -1, moovSize = 0, pos = 0;
  while (pos < file.size) {
    const headerBuf = await file.slice(pos, pos + 16).arrayBuffer();
    const dv = new DataView(headerBuf);
    if (headerBuf.byteLength < 8) break;
    let boxSize = dv.getUint32(0);
    const type = fcc(dv, 4);
    if (boxSize === 1 && headerBuf.byteLength >= 16) {
      boxSize = dv.getUint32(8) * 0x100000000 + dv.getUint32(12);
    }
    if (boxSize < 8) break;
    if (type === 'moov') { moovOffset = pos; moovSize = boxSize; break; }
    pos += boxSize;
  }
  if (moovOffset < 0 || moovSize > 20 * 1024 * 1024) return null;

  const moovBuf = await file.slice(moovOffset, moovOffset + moovSize).arrayBuffer();
  const view = new DataView(moovBuf);
  const result = { video: null, audio: null };

  const traks = findAllBoxes(view, 8, moovSize, 'trak');
  for (const trak of traks) {
    const trakStart = trak.offset + trak.headerSize;
    const trakEnd = Math.min(trak.offset + trak.size, moovSize);
    const isVideo = findAllBoxes(view, trakStart, trakEnd, 'vmhd').length > 0;
    const isAudio = findAllBoxes(view, trakStart, trakEnd, 'smhd').length > 0;

    const stsdBoxes = findAllBoxes(view, trakStart, trakEnd, 'stsd');
    if (!stsdBoxes.length) continue;
    const stsd = stsdBoxes[0];
    // stsd: 8-byte box header + 4 version/flags + 4 entry-count, then the first
    // sample-entry box (4 size + 4 FourCC).
    const entryStart = stsd.offset + stsd.headerSize + 8;
    if (entryStart + 8 > moovSize) continue;
    const sampleEntryBox = view.getUint32(entryStart);
    const codecFcc = fcc(view, entryStart + 4);

    if (isVideo && !result.video) {
      const v = { codec: codecFcc, codecName: VIDEO_CODEC_NAMES[codecFcc] || codecFcc };

      // Stored pixel dimensions from the VisualSampleEntry: box hdr(8) +
      // SampleEntry(8) + 16 pre-defined/reserved, then width(2) height(2).
      try {
        const dim = entryStart + 8 + 8 + 16;
        if (dim + 4 <= moovSize) {
          const w = view.getUint16(dim), h = view.getUint16(dim + 2);
          if (w > 0 && h > 0) { v.width = w; v.height = h; }
        }
      } catch (_) {}

      // Rotation from tkhd matrix. tkhd: version(1) flags(3) then times; matrix
      // sits at a fixed offset from the box data start (version-dependent).
      try {
        const tkhd = findAllBoxes(view, trakStart, trakEnd, 'tkhd')[0];
        if (tkhd) {
          const d = tkhd.offset + tkhd.headerSize;
          const ver = view.getUint8(d);
          // matrix starts after: ver/flags(4) + create+modify+trackID+reserved+duration
          // + reserved(8) + layer(2)+altGroup(2)+volume(2)+reserved(2)
          const matrixOff = d + (ver === 1 ? 4 + 8 + 8 + 4 + 4 + 8 : 4 + 4 + 4 + 4 + 4 + 8) + 8;
          if (matrixOff + 36 <= moovSize) {
            const fx = (o) => view.getInt32(matrixOff + o) / 65536; // 16.16 fixed
            const a = fx(0), b = fx(4), c = fx(12), dd = fx(16);
            const rot = rotationFromMatrix(a, b, c, dd);
            if (rot) v.rotation = rot;
          }
        }
      } catch (_) {}

      // Profile/level from avcC (H.264) or hvcC (HEVC), searched within stbl.
      try {
        if (codecFcc === 'avc1' || codecFcc === 'avc3') {
          const avcc = findAllBoxes(view, trakStart, trakEnd, 'avcC')[0];
          if (avcc) {
            const d = avcc.offset + avcc.headerSize; // configVer(1) profile(1) compat(1) level(1)
            const avccEnd = Math.min(avcc.offset + avcc.size, moovSize);
            const profileIdc = view.getUint8(d + 1);
            const levelIdc = view.getUint8(d + 3);
            if (H264_PROFILES[profileIdc]) v.profile = H264_PROFILES[profileIdc];
            if (levelIdc) v.level = (levelIdc / 10).toFixed(1).replace(/\.0$/, '');
            // profile_idc alone is definitive for the 4:2:2 / 4:4:4 High profiles,
            // and browsers ship no decoder for either. Sony XAVC S-I / All-Intra
            // avcC boxes (High 4:2:2, profile 122) don't reliably carry the
            // optional chroma extension parsed below, so set chroma from the
            // profile up front - otherwise these files fall through the "can't
            // play" gate and only paint a black player. (High 4:2:2 Intra = 122,
            // High 4:4:4 Predictive = 244.)
            if (profileIdc === 122) v.chroma = '4:2:2';
            else if (profileIdc === 244) v.chroma = '4:4:4';
            // Bit depth / chroma live in the avcC extension that High-10, High
            // 4:2:2 and High 4:4:4 profiles append after the SPS/PPS NAL arrays.
            // Walk past those arrays (bounded by the box) to reach it.
            if ([100, 110, 122, 144, 244].includes(profileIdc)) {
              let p = d + 5;
              const numSps = view.getUint8(p) & 0x1f; p += 1;
              for (let i = 0; i < numSps && p + 2 <= avccEnd; i++) p += 2 + view.getUint16(p);
              if (p < avccEnd) { const numPps = view.getUint8(p); p += 1;
                for (let i = 0; i < numPps && p + 2 <= avccEnd; i++) p += 2 + view.getUint16(p);
              }
              if (p + 3 <= avccEnd) {
                const b0 = view.getUint8(p), b1 = view.getUint8(p + 1), b2 = view.getUint8(p + 2);
                // The avcC chroma/bit-depth extension is OPTIONAL even on High
                // profile (100); many ordinary 8-bit 4:2:0 files omit it. Its
                // reserved bits are all 1s (chroma byte: top 6; depth bytes: top
                // 5), so validate them before trusting the values - otherwise
                // trailing/padding bytes get misread as 4:2:2/4:4:4 or 12-bit+,
                // wrongly routing a perfectly playable file to the "can't play"
                // banner.
                if ((b0 & 0xFC) === 0xFC && (b1 & 0xF8) === 0xF8 && (b2 & 0xF8) === 0xF8) {
                  const chromaIdc = b0 & 0x03;
                  const depthLuma = (b1 & 0x07) + 8;
                  const depthChroma = (b2 & 0x07) + 8;
                  // Don't let a stray-but-valid-looking extension override the
                  // profile-derived chroma (122/244 are fixed at 4:2:2 / 4:4:4).
                  if (v.chroma === undefined && CHROMA_FORMATS[chromaIdc] !== undefined) v.chroma = CHROMA_FORMATS[chromaIdc];
                  if (depthLuma >= 8 && depthLuma <= 16) v.bitDepth = Math.max(depthLuma, depthChroma);
                }
              }
            }
          }
        } else if (codecFcc === 'hvc1' || codecFcc === 'hev1' || codecFcc === 'dvh1' || codecFcc === 'dvhe') {
          const hvcc = findAllBoxes(view, trakStart, trakEnd, 'hvcC')[0];
          if (hvcc) {
            const d = hvcc.offset + hvcc.headerSize; // configVer(1) then profile space/tier/idc byte
            const hvccEnd = Math.min(hvcc.offset + hvcc.size, moovSize);
            const b1 = view.getUint8(d + 1);
            const tier = (b1 & 0x20) ? 'High' : 'Main';
            const profileIdc = b1 & 0x1f;
            const HEVC_PROFILES = { 1: 'Main', 2: 'Main 10', 3: 'Main Still Picture', 4: 'Range Ext' };
            if (HEVC_PROFILES[profileIdc]) v.profile = HEVC_PROFILES[profileIdc] + ' (' + tier + ')';
            // general_level_idc is at offset d+12 in hvcC.
            const levelIdc = view.getUint8(d + 12);
            if (levelIdc) v.level = (levelIdc / 30).toFixed(1);
            // chroma_format_idc (d+16, low 2 bits) and bit_depth_luma/chroma_minus8
            // (d+17 / d+18, low 3 bits each) are at fixed offsets in the hvcC record.
            if (d + 19 <= hvccEnd) {
              const b0 = view.getUint8(d + 16), b1 = view.getUint8(d + 17), b2 = view.getUint8(d + 18);
              // Reserved bits are all 1s in a real hvcC record; validating them
              // guards against misreading a truncated/odd box as exotic chroma or
              // high bit depth and wrongly flagging a playable file unplayable.
              if ((b0 & 0xFC) === 0xFC && (b1 & 0xF8) === 0xF8 && (b2 & 0xF8) === 0xF8) {
                const chromaIdc = b0 & 0x03;
                const depthLuma = (b1 & 0x07) + 8;
                const depthChroma = (b2 & 0x07) + 8;
                if (CHROMA_FORMATS[chromaIdc] !== undefined) v.chroma = CHROMA_FORMATS[chromaIdc];
                if (depthLuma >= 8 && depthLuma <= 16) v.bitDepth = Math.max(depthLuma, depthChroma);
              }
            }
          }
        }
      } catch (_) {}

      // Colour / HDR from a 'colr' box (nclx variant) within the sample entry,
      // plus presence of mastering-display (mdcv) / content-light (clli) boxes.
      try {
        // The sample-entry box spans [entryStart, entryStart+sampleEntryBox); colr/
        // mdcv/clli live inside it. Search the whole trak (cheap, harmless).
        const colr = findAllBoxes(view, entryStart, Math.min(entryStart + sampleEntryBox, moovSize), 'colr')[0]
                  || findAllBoxes(view, trakStart, trakEnd, 'colr')[0];
        if (colr) {
          const d = colr.offset + colr.headerSize;
          const colourType = fcc(view, d);
          if (colourType === 'nclx' && d + 10 <= moovSize) {
            const primaries = view.getUint16(d + 4);
            const transfer = view.getUint16(d + 6);
            const matrix = view.getUint16(d + 8);
            v.primaries = COLOUR_PRIMARIES[primaries] || ('code ' + primaries);
            v.transfer = TRANSFER_CHARS[transfer] || ('code ' + transfer);
            v.matrixCoef = matrix;
            // HDR detection: PQ (16) or HLG (18) transfer, typically with BT.2020.
            if (transfer === 16) v.hdr = 'PQ (' + (v.primaries) + ')';
            else if (transfer === 18) v.hdr = 'HLG (' + (v.primaries) + ')';
          }
        }
        if (findAllBoxes(view, trakStart, trakEnd, 'mdcv').length) v.mdcv = true;
        if (findAllBoxes(view, trakStart, trakEnd, 'clli').length) v.clli = true;
      } catch (_) {}

      result.video = v;
    } else if (isAudio && !result.audio) {
      const a = { codec: codecFcc, codecName: AUDIO_CODEC_NAMES[codecFcc] || codecFcc };
      try {
        // Audio sample entry: after the 8-byte box hdr + 8 reserved, channelcount
        // is a uint16, then samplesize, predefined, reserved, then sample rate.
        const base = entryStart + 8 + 8;
        if (base + 4 <= moovSize) {
          const channels = view.getUint16(base);
          if (channels > 0 && channels <= 24) a.channels = channels;
        }
      } catch (_) {}
      result.audio = a;
    }
  }

  // Movie duration (seconds) from mvhd, for the bitrate/duration readout when the
  // file can't be decoded by the browser.
  try {
    const mvhd = findAllBoxes(view, 8, moovSize, 'mvhd')[0];
    if (mvhd) {
      const d = mvhd.offset + mvhd.headerSize;
      const ver = view.getUint8(d);
      let timescale, duration;
      if (ver === 1) {
        timescale = view.getUint32(d + 20);
        duration = view.getUint32(d + 24) * 0x100000000 + view.getUint32(d + 28);
      } else {
        timescale = view.getUint32(d + 12);
        duration = view.getUint32(d + 16);
      }
      if (timescale > 0 && duration > 0) result.durationSec = duration / timescale;
    }
  } catch (_) {}

  if (!result.video && !result.audio) return null;
  return result;
}

// Append codec/rotation/HDR/audio-codec rows to an existing readout <table>,
// next to the resolution/fps rows. Only adds rows that were actually found.
// Wrapped by the caller in try/catch; itself defends against partial data.
function appendTrackRows(tbl, tracks) {
  if (!tracks) return;
  const v = tracks.video, a = tracks.audio;
  if (v) {
    if (v.codecName) {
      let label = v.codecName;
      const extra = [];
      if (v.profile) extra.push(v.profile);
      if (v.level) extra.push('L' + v.level);
      if (extra.length) label += '  (' + extra.join(', ') + ')';
      tbl.appendChild(rowHelp('Video codec', label,
        'The recipe used to squeeze the picture down to a manageable size, such as H.264, and where available its profile and level. Read from the file’s codec settings (the MP4/MOV sample-description and codec-config boxes), the profile and level show which encoding features and quality ceiling were used.'));
    }
    if (v.bitDepth) {
      let depthText = v.bitDepth + '-bit';
      if (v.chroma) depthText += '  ·  ' + v.chroma + ' chroma';
      tbl.appendChild(rowHelp('Bit depth', depthText,
        'How many shades of colour each pixel can hold, plus how much colour detail is kept (the chroma subsampling), read from the codec settings. 8-bit is standard; 10-bit (e.g. Sony XAVC HS, HLG/HDR) stores smoother gradients. 4:2:0 is normal for delivery, 4:2:2 keeps more colour detail for editing. Browsers have no built-in player for 10-bit 4:2:2, so those files can be identified here but not played.'));
    }
    if (v.rotation) {
      const orient = (v.rotation === 90 || v.rotation === 270) ? 'portrait' : 'landscape';
      tbl.appendChild(rowHelp('Rotation', v.rotation + '°  (' + orient + ')',
        'A note stored inside the file (in the track header transform matrix) telling players to turn the picture the right way up. Phones film in the sensor’s native orientation and add this flag so the video plays upright.'));
    }
    if (v.hdr) {
      let hdrText = v.hdr;
      if (v.mdcv || v.clli) hdrText += '  · ' + [v.mdcv ? 'mastering display' : '', v.clli ? 'content-light' : ''].filter(Boolean).join(' + ') + ' metadata';
      tbl.appendChild(rowHelp('HDR', hdrText,
        'A flag marking the video as HDR (High Dynamic Range), which allows brighter highlights and a wider range of colour than normal video. The type is PQ (HDR10/Dolby Vision) or HLG, usually with the wide BT.2020 colour range; mastering-display and content-light data describe the HDR grade in more detail.'));
    } else if (v.primaries && v.transfer && (v.primaries !== '-' || v.transfer !== '-')) {
      tbl.appendChild(rowHelp('Colour', v.primaries + ' · ' + v.transfer,
        'Instructions that tell a player how to turn the stored numbers into the colours you see on screen (the colour primaries and gamma). BT.709 is standard HD; BT.2020 is the wider range used for UHD.'));
    }
  }
  if (a && a.codecName) {
    let label = a.codecName;
    if (a.channels) label += '  (' + (a.channels === 1 ? 'mono' : a.channels === 2 ? 'stereo' : a.channels + 'ch') + ')';
    tbl.appendChild(rowHelp('Audio codec', label,
      'The recipe used to compress the sound, such as AAC, and how many channels it has, read from the file’s own audio settings (the MP4/MOV sample-description box).'));
  }
}

// ---------- broken / unfinalised MP4-MOV recovery ----------

// A byte-range reader over a File for the recovery helpers (which are source-
// agnostic: the same code runs over Node fs in tests).
function fileRangeReader(file) {
  return async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer());
}

// Recover playable video from a moov-less (truncated / unfinalised) MP4-MOV. The
// moov index is gone, so we carve the encoded video straight out of the mdat: each
// NAL is stored length-prefixed and interleaved with audio/metadata we can't index,
// so video-recover.js walks the length-prefixed NAL chain (validating each against
// the next so audio bytes can't pose as video) and re-emits Annex B. Cameras like
// Sony keep the SPS/PPS only in the lost moov, so we look for them in-band first
// and otherwise borrow them from a healthy reference clip shot on the same camera.
// The carved Annex B stream then plays through the existing raw-H.264 segmented
// player. Audio (often LPCM, with no recoverable timing) is dropped.
// Clear the "decoding" bar that renderVideo drops into the #videoPreview panel
// while it works. Only ever removes OUR loader (checked by class), so it can be
// called freely on paths that mounted a real preview or never showed a bar at all.
// Lives here because the fallback renderers below each end the render without ever
// reaching the normal preview mount, and would otherwise strand it on screen.
function clearVideoPreviewBoot() {
  const pv = document.getElementById('videoPreview');
  if (pv && pv.querySelector('.anr-inline-loader')) pv.innerHTML = '';
}

async function renderMoovlessRecovery(file, header, det, resultsEl, signal) {
  const mctx = curVctx();   // preserve inline/compare when re-rendering the carved stream
  clearVideoPreviewBoot();
  resultsEl.innerHTML = '';
  const reader = fileRangeReader(file);
  const brandStr = (header.brand || '') + ' ' + (header.container || '');
  const codec = /hvc1|hev1|hevc|h\.?265/i.test(brandStr) ? 'h265' : 'h264';
  const codecName = codec === 'h265' ? 'HEVC (H.265)' : 'H.264 / AVC';

  // ---- diagnosis ----
  const diag = el('div', { class: 'anr-card' });
  diag.appendChild(el('h3', {}, 'Broken video - missing index'));
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Name', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size) + '   (' + file.size.toLocaleString() + ' bytes)'));
  if (header.container) tbl.appendChild(row('Container', header.container + (header.brand ? '  (' + header.brand + ')' : '')));
  tbl.appendChild(rowHelp('Index (moov atom)', 'missing',
    'MP4/MOV files keep a table of contents - the "moov" atom - that every player needs to locate the frames. Cameras write it last, so a recording that was cut off or a copy that did not finish leaves it out. The video itself is still inside the file; it just has no table of contents, which is why no player will open it.'));
  if (det.truncated) {
    const expect = det.declaredMdatEnd - det.mdatStart;
    tbl.appendChild(rowHelp('Media data', 'truncated - ' + fmtBytes(det.missingBytes) + ' short of the ' + fmtBytes(expect) + ' the header expects',
      'The file says it should hold more video data (in its mdat box) than it actually does, so the recording or copy stopped early. Everything up to the cut-off point can still be salvaged.'));
  }
  diag.appendChild(tbl);
  diag.appendChild(el('p', { class: 'anr-hint' },
    'Analyser can scan the leftover data, gather every video frame it can decode and stitch them into a playable clip. Audio can’t be recovered without the index.'));
  resultsEl.appendChild(diag);

  // ---- action card ----
  const action = el('div', { class: 'anr-card' });
  resultsEl.appendChild(action);
  const scanning = el('div', { class: 'anr-info' }, 'Checking for codec setup in the file…');
  action.appendChild(scanning);

  // Carve the whole mdat, prepend the parameter sets, wrap as a raw .h264/.h265
  // File and hand it to the normal raw-stream path (segmented player for big files).
  async function startSalvage(paramSets, refInfo) {
    action.innerHTML = '';
    const useCodec = (refInfo && refInfo.codec) || codec;
    const lenSize = (refInfo && refInfo.lenSize) || 4;
    const prog = el('div', { class: 'anr-info' }, 'Scanning and salvaging video… 0%');
    action.appendChild(prog);
    const blobs = [new Blob([paramSets])];
    let lastPct = -1;
    try {
      await carveAvccToAnnexB(reader, det.mdatStart, det.mdatEnd, {
        codec: useCodec, lenSize, signal,
        onChunk: (u8) => { blobs.push(new Blob([u8])); },
        onProgress: (f, info) => {
          const p = Math.floor(f * 100);
          if (p !== lastPct) {
            lastPct = p;
            prog.textContent = 'Scanning and salvaging video… ' + p + '%'
              + (info ? '   (' + info.nals.toLocaleString() + ' NAL units, ' + fmtBytes(info.bytes) + ' so far)' : '');
          }
        },
      });
    } catch (e) {
      if (signal.aborted) return;
      prog.textContent = 'Salvage failed: ' + ((e && e.message) || e);
      return;
    }
    if (signal.aborted) return;
    const ext = useCodec === 'h265' ? 'h265' : 'h264';
    const kind = useCodec === 'h265' ? 'H.265' : 'H.264';
    const base = (file.name || 'video').replace(/\.[^/.]+$/, '');
    const carved = new File(blobs, base + '.recovered.' + ext, { type: 'video/' + ext });
    // Re-enter the normal pipeline: the carved file is a raw Annex B stream, so it
    // takes the raw-H.264 branch (segmented player above the size cap). opts.recovered
    // stops the moov-less check from firing again; sourceFile keeps the original's
    // name/size on the info card.
    return renderVideo(carved, resultsEl, { recovered: true, sourceFile: file, sourceKind: kind, noAudio: true, inline: mctx.inline, compare: mctx.compare });
  }

  // Prefer the stream's own in-band SPS/PPS (correct ids, no reference needed);
  // cameras like Sony don't embed them, so fall back to a reference clip.
  let inband = null;
  try { inband = await findInbandParamSets(reader, det.mdatStart, det.mdatEnd, { codec, scanBytes: 128 * 1024 * 1024 }); } catch (_) {}
  if (signal.aborted) return;
  action.innerHTML = '';

  if (inband) {
    action.appendChild(el('p', {}, 'Codec setup (' + codecName + ') found inside the file - ready to salvage.'));
    const btn = el('button', { type: 'button', class: 'anr-btn anr-btn--cta' }, 'Salvage video');
    btn.addEventListener('click', () => startSalvage(inband, { codec }));
    action.appendChild(el('div', { class: 'anr-btn-row' }, [btn]));
    return;
  }

  // Reference-clip path.
  {
    const [refH, refHelp] = h3help('Reference clip needed',
      'This recording stored its codec setup (the SPS/PPS) only inside the missing index, so Analyser has to borrow that setup from a healthy clip before it can rebuild the picture. Everything stays on your device.');
    action.appendChild(refH); action.appendChild(refHelp);
  }
  action.appendChild(el('p', { class: 'anr-hint' },
    'Choose a healthy, complete clip shot on the same camera in the same mode - matching resolution and codec (for example another clip from the same memory card).'));
  const inp = el('input', { type: 'file', accept: 'video/mp4,video/quicktime,.mp4,.mov,.m4v,.3gp', style: 'display:none' });
  const pick = el('button', { type: 'button', class: 'anr-btn' }, 'Choose reference clip…');
  pick.addEventListener('click', () => inp.click());
  action.appendChild(el('div', { class: 'anr-btn-row' }, [inp, pick]));
  const note = el('p', { class: 'anr-hint' }, '');
  action.appendChild(note);
  inp.addEventListener('change', async () => {
    const ref = inp.files && inp.files[0];
    if (!ref) return;
    pick.textContent = ref.name;
    note.textContent = 'Reading codec setup from “' + ref.name + '”…';
    let rp = null;
    try { rp = await extractMp4ParamSets(fileRangeReader(ref), ref.size); } catch (_) {}
    if (!rp || !rp.paramSets) {
      note.textContent = 'Couldn’t read codec setup from that file. Pick a healthy, complete MP4/MOV from the same camera.';
      return;
    }
    note.innerHTML = '';
    const desc = (rp.codec === 'h265' ? 'HEVC' : 'H.264')
      + (rp.width ? '  ·  ' + rp.width + ' × ' + rp.height : '')
      + (rp.profile ? '  ·  profile ' + rp.profile : '')
      + (rp.level ? '  ·  L' + (rp.level / 10).toFixed(1).replace(/\.0$/, '') : '');
    note.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 8px;' }, 'Borrowing ' + desc + ' from “' + ref.name + '”. For a clean result this must match the broken clip’s resolution and codec.'));
    const btn = el('button', { type: 'button', class: 'anr-btn anr-btn--cta' }, 'Salvage video');
    btn.addEventListener('click', () => startSalvage(rp.paramSets, rp));
    note.appendChild(el('div', { class: 'anr-btn-row' }, [btn]));
  });
}

// Shown when neither the off-screen probe nor a visible <video> can decode the
// file: the browser has no decoder for this codec (ProRes, DNxHD, uncompressed,
// etc.). Instead of a bare "couldn't load" error, surface the container/codec
// metadata read straight from the file, with a plain explanation of why it won't
// play and how to make it playable. Degrades gracefully for non-ISOBMFF files
// (shows name / size / container only).
async function renderUnplayableVideoInfo(file, header, resultsEl, signal) {
  clearVideoPreviewBoot();
  const ctx = curVctx();
  let tracks = null;
  try { tracks = await detectIsobmffTracks(file); } catch (_) {}
  const v = tracks && tracks.video;
  const isPro = !!(v && PRO_VIDEO_CODECS.has(v.codec));
  const named = !!(v && v.codecName && v.codecName !== v.codec);

  const hiDepth = !!(v && v.bitDepth && v.bitDepth >= 10);
  let msg;
  if (isPro) {
    msg = (v.codecName || 'This codec') + ' is a professional master format no web browser can decode, so it can’t be played here.';
  } else if (hiDepth) {
    const cf = (v.chroma && v.chroma !== '4:2:0') ? ' ' + v.chroma : '';
    msg = 'This ' + v.bitDepth + '-bit' + cf + ' ' + (v.codecName || 'video') + ' file has no browser decoder, so it can’t be played here.';
  } else if (named) {
    msg = 'Your browser has no decoder for this codec (' + v.codecName + '), so it can’t be played here.';
  } else {
    msg = 'Your browser can’t decode this video’s codec, so it can’t be played here.';
  }
  // Second sentence: point at the convert card right below and VLC as an alternative.
  msg += ' Convert it to H.264 below to view and analyse it here, or open it in a desktop player like VLC (videolan.org).';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, msg));

  // File info first - it's available instantly from the header walk, with no
  // decode needed, so the page is useful immediately even for a huge file.
  const infoCard = el('div', { class: 'anr-card' });
  infoCard.appendChild(el('h3', {}, 'File info'));
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Name', file.name));
  tbl.appendChild(row('Size', `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`));
  tbl.appendChild(rowHelp('MIME', file.type || '-', "The standard label for a file's format, such as image/jpeg or audio/mpeg. The browser takes it from the file's name or the operating system, so it's a hint about the format, not proof."));
  if (header && header.container) tbl.appendChild(row('Container', header.container + (header.brand ? '  (' + header.brand + ')' : '')));
  appendCreatorRows(tbl, header);
  if (v && v.width && v.height) {
    tbl.appendChild(row('Resolution', `${v.width} × ${v.height} px`));
    tbl.appendChild(row('Aspect ratio', aspectRatio(v.width, v.height)));
  }
  const dur = tracks && tracks.durationSec;
  if (dur && dur > 0) {
    tbl.appendChild(row('Duration', formatDuration(dur)));
    const bitrate = (file.size * 8 / dur / 1000).toFixed(0) + ' kbps  (' + (file.size * 8 / dur / 1_000_000).toFixed(2) + ' Mbps)';
    tbl.appendChild(rowHelp('Bitrate (total)', bitrate, 'How much data the whole file uses per second of playback - video, audio and packaging combined. Worked out as file size ÷ duration, so it is an overall average rather than the encoder’s target.'));
  }
  if (v && v.width && v.height) {
    tbl.appendChild(rowHelp('Frame size', ((v.width * v.height) / 1_000_000).toFixed(2) + ' MP', 'How many pixels make up each frame, in megapixels (width × height ÷ 1,000,000). A rough guide to how much detail each frame holds before compression.'));
  }
  // Codec / rotation / HDR / audio-codec rows from the moov walk (best-effort).
  try { appendTrackRows(tbl, tracks); } catch (_) {}
  infoCard.appendChild(tbl);
  resultsEl.appendChild(infoCard);

  // Sony gyro / IMU metadata (rtmd track) - shown even when the codec can't play.
  await appendSonyGyroCard(file, resultsEl);

  // Telemetry (GoPro GPMF / CAMM / container GPS) and the Advanced container
  // structure card are read straight from the metadata boxes, so they work even
  // when the browser can't decode the video codec - the common GoPro-HEVC case.
  try { await appendTelemetryCards(file, resultsEl); } catch (_) {}
  let unplayableAdvCard = null;
  try {
    const adv = await buildVideoAdvancedCard(file);
    if (adv && !(signal && signal.aborted)) unplayableAdvCard = adv;   // appended last, below every other card
  } catch (_) {}

  // Convert to H.264 in-browser. The browser can't decode this codec, but FFmpeg
  // can, so re-encoding to H.264 / AAC MP4 makes the file playable AND unlocks the
  // full analysis (player, frame tools, scene detection, reverse, audio). On
  // success we hand the converted MP4 straight back to renderVideo, which restarts
  // the whole section through the normal playable path.
  const convName = (v && v.codecName) || (v && v.codec) || 'this codec';
  const convCard = el('div', { class: 'anr-card' });
  convCard.appendChild(el('h3', {}, 'Convert to H.264'));

  // Advanced settings: resolution / frame rate / encode speed. Lower values are
  // dramatically faster (encode cost scales with pixels x frames). Hidden until
  // the Advanced button is pressed; defaults make the fast proxy.
  const mkSel = (options, def) => {
    const s = el('select', { class: 'anr-select' }, options.map(([label, value]) => el('option', { value }, label)));
    s.value = def; return s;
  };
  const resSel = mkSel([['Full', '0'], ['2160p (4K)', '2160'], ['1440p', '1440'], ['1080p', '1080'], ['720p', '720'], ['480p', '480']], '720');
  const fpsSel = mkSel([['Original', '0'], ['60 fps', '60'], ['30 fps', '30'], ['24 fps', '24'], ['15 fps', '15']], '30');
  const spdSel = mkSel([['Turbo', 'turbo'], ['Fastest', 'ultrafast'], ['Fast', 'veryfast'], ['Balanced', 'faster'], ['Better quality', 'medium']], 'ultrafast');
  const settingCol = (label, sel) => el('label', { class: 'anr-conv-setting' }, [el('span', {}, label), sel]);
  const convSettings = el('div', { class: 'anr-conv-settings', hidden: '' }, [
    settingCol('Resolution', resSel), settingCol('Frame rate', fpsSel), settingCol('Speed', spdSel),
    el('p', { class: 'anr-hint', style: 'margin:8px 0 0; flex-basis:100%;' },
      'Lower resolution and frame rate convert much faster. "Speed" trades encode time for a slightly smaller/cleaner file.'),
  ]);

  const convBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Convert to H.264 and play');
  const advToggle = el('button', { type: 'button', class: 'anr-btn' }, 'Advanced');
  advToggle.addEventListener('click', () => {
    convSettings.hidden = !convSettings.hidden;
    advToggle.classList.toggle('is-active', !convSettings.hidden);
  });
  const convBar = el('div', { class: 'anr-progress-bar' }, '[                    ]');
  const convLabel = el('div', { class: 'anr-progress-label' }, 'loading ffmpeg');
  const convWrap = el('div', { class: 'anr-progress', style: 'display:none;' }, [convBar, convLabel]);
  const convSetBar = (frac) => {
    const ch = parseFloat(getComputedStyle(convBar).fontSize) * 0.6 || 8;
    const total = Math.max(10, Math.floor((convBar.parentElement.clientWidth - ch * 2) / ch));
    const filled = Math.round(Math.max(0, Math.min(1, frac)) * total);
    convBar.innerHTML = '[<span class="anr-bar-fill">' + '/'.repeat(filled) + '</span>' + ' '.repeat(total - filled) + ']';
  };
  const convErr = el('div');
  convBtn.addEventListener('click', async () => {
    convBtn.disabled = true; convBtn.textContent = 'Converting…';
    convWrap.style.display = ''; convErr.innerHTML = '';
    const convOpts = {
      maxHeight: parseInt(resSel.value, 10) || 0,
      maxFps: parseInt(fpsSel.value, 10) || 0,
      preset: spdSel.value,
    };
    let blob = null;
    try {
      // Serialise through the shared FFmpeg instance: if the other file's convert is
      // already running (compare page), wait for it rather than clashing on one core.
      // The button reads "Queued…" while waiting and flips to "Converting…" only when
      // this job actually starts, so it never claims to be converting while it waits.
      blob = await queueFFmpeg(
        () => { convBtn.textContent = 'Converting…'; return ffmpegTranscodeToH264(file,
          (p) => { convLabel.textContent = 'loading ffmpeg'; convSetBar(p); },
          (p) => { convLabel.textContent = 'converting'; convSetBar(p); },
          signal, convOpts); },
        () => { convBtn.textContent = 'Queued…'; convLabel.textContent = 'waiting for the other conversion to finish…'; });
    } catch (_) { blob = null; }
    convWrap.style.display = 'none';
    if (signal && signal.aborted) return;
    if (!blob) {
      convBtn.disabled = false; convBtn.textContent = 'Convert to H.264 and play';
      convErr.appendChild(el('p', { class: 'anr-hint', style: 'color:var(--accent);' },
        'Could not convert this video - it may be corrupt, or too large to hold in memory.'));
      return;
    }
    const base = (file.name || 'video').replace(/\.[^/.]+$/, '');
    const mp4File = new File([blob], base + ' (H.264).mp4', { type: 'video/mp4' });
    const reopts = { remuxed: true, converted: true, sourceFile: file, sourceCodec: convName };
    if (ctx.inline) {
      // Compare view: `resultsEl` is the off-screen staging container, emptied and
      // removed once its cards were moved into the merged view - re-rendering there
      // would draw into a detached node (nothing appears). Anchor to a node that is
      // actually live (the convert button, moved into the merged column) and render
      // the converted analysis there, in place of the now-spent convert prompt.
      // Kept inline so it doesn't reach for the (non-existent) page sections.
      const host = convBtn.closest('.anr-cmp-col') || convBtn.parentElement || resultsEl;
      const mount = el('div', { class: 'anr-results' });
      host.appendChild(mount);
      [convBtn.closest('.anr-btn-row'), convSettings, convWrap, convErr].forEach((n) => { if (n && n.parentElement) n.remove(); });
      renderVideo(mp4File, mount, Object.assign(reopts, { inline: true, compare: ctx.compare }));
    } else {
      renderVideo(mp4File, resultsEl, reopts);
    }
  });
  convCard.appendChild(el('div', { class: 'anr-btn-row', style: 'margin-top:8px;' }, [convBtn, advToggle]));
  convCard.appendChild(convSettings);
  convCard.appendChild(convWrap);
  convCard.appendChild(convErr);
  // Sit the convert card directly under the "can't decode" warning, above the
  // File info / telemetry / Advanced cards (which were appended earlier).
  resultsEl.insertBefore(convCard, infoCard);

  // Preview on demand. Decoding even a single frame from a codec the browser
  // can't play needs the ~31 MB FFmpeg WASM core and a single-threaded decode -
  // slow for big masters - so put it behind a button instead of auto-running.
  const prevCard = el('div', { class: 'anr-card' });
  prevCard.appendChild(el('h3', {}, 'Preview'));
  const prevHint = el('p', { class: 'anr-hint' }, 'No preview by default - the browser can’t decode this video. Extracting the first frame uses FFmpeg.');
  prevCard.appendChild(prevHint);
  const grabBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Extract first frame');
  const grabRow = el('div', { class: 'anr-btn-row', style: 'margin-top:8px;' }, [grabBtn]);
  prevCard.appendChild(grabRow);
  grabBtn.addEventListener('click', async () => {
    grabBtn.disabled = true;
    const status = el('p', { class: 'anr-hint' }, 'Extracting the first frame with FFmpeg…');
    grabRow.replaceWith(status);
    try {
      const frame = await ffmpegFirstFrame(file, signal);
      if (signal && signal.aborted) return;
      if (!frame) { status.textContent = 'Could not extract a frame from this file.'; return; }
      status.remove();
      prevHint.remove();
      prevCard.appendChild(el('img', {
        src: URL.createObjectURL(frame.blob),
        alt: 'First frame of ' + file.name,
        style: 'max-width:100%; max-height:480px; display:block; border:1px solid var(--hairline); background:#0a0a0a;',
      }));
      prevCard.appendChild(el('p', { class: 'anr-hint' }, 'First frame (decoded with FFmpeg).'));
      const basename = (file.name || 'video').replace(/\.[^/.]+$/, '');
      const frameFile = new File([frame.blob], basename + '_frame.jpg', { type: 'image/jpeg' });
      const analyseBtn = el('button', { type: 'button', class: 'anr-btn', onclick: () => {
        const pr = ctx.inline ? ctx.photoTarget() : revealPhotoSection();
        renderPhoto(frameFile, pr, ctx.photoOpts({ sourceNote: 'First frame extracted from ' + file.name + ' (the video itself can’t be decoded in the browser).' }));
        ctx.afterPhoto();
      } }, 'Analyse in Photo section');
      prevCard.appendChild(el('div', { class: 'anr-btn-row', style: 'margin-top:8px;' }, [analyseBtn]));
    } catch (_) {
      status.textContent = 'Could not extract a frame from this file.';
    }
  });
  resultsEl.appendChild(prevCard);

  // SHA-256 reads the whole file, so compute it automatically only for small
  // videos; for big ones put it behind a button so the page isn't held up.
  const SHA_AUTO_MAX = 200 * 1024 * 1024;
  if (file.size <= SHA_AUTO_MAX) {
    resultsEl.appendChild(integrityCard(file));
  } else if (file.size <= 2 * 1024 * 1024 * 1024) {
    const hashCard = el('div', { class: 'anr-card' });
    hashCard.appendChild(el('h3', {}, 'Integrity'));
    hashCard.appendChild(el('p', { class: 'anr-hint' }, 'SHA-256 reads the whole file (' + fmtBytes(file.size) + '), so it isn’t computed automatically for large videos.'));
    const hashBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Compute SHA-256');
    hashBtn.addEventListener('click', () => { hashCard.replaceWith(integrityCard(file)); });
    hashCard.appendChild(el('div', { class: 'anr-btn-row', style: 'margin-top:8px;' }, [hashBtn]));
    resultsEl.appendChild(hashCard);
  }

  // Advanced sits last, below every other card.
  if (unplayableAdvCard && !(signal && signal.aborted)) resultsEl.appendChild(unplayableAdvCard);
}

async function detectFpsWithFfmpeg(file, onProgress) {
  const ff = await loadFFmpeg(onProgress);
  const { fetchFile } = await import(new URL('../../vendor/ffmpeg/ffmpeg-util.js', import.meta.url).href);
  await ff.writeFile('probe', await fetchFile(file));
  let log = '';
  ff.on('log', ({ message }) => { log += message + '\n'; });
  await ff.exec(['-i', 'probe', '-f', 'null', '-t', '2', '-']);
  await ff.deleteFile('probe');
  const m = log.match(/(\d+(?:\.\d+)?) fps/);
  if (m) return roundFps(parseFloat(m[1]));
  const tbr = log.match(/(\d+(?:\.\d+)?) tbr/);
  if (tbr) return roundFps(parseFloat(tbr[1]));
  return null;
}

async function detectFps(file, fpsCell) {
  const containerFps = await detectFpsFromContainer(file);
  if (containerFps) return containerFps;
  if (fpsCell) fpsCell.textContent = 'loading ffmpeg…';
  try {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 30000));
    const detect = detectFpsWithFfmpeg(file, (p) => {
      const pct = Math.round(p * 100);
      if (fpsCell) fpsCell.textContent = pct >= 100 ? 'initialising ffmpeg…' : 'loading ffmpeg… ' + pct + '%';
    });
    return await Promise.race([detect, timeout]);
  } catch (_) {
    return null;
  }
}

// ---------- scene change detection ----------

// Walk the video at a fixed interval, comparing each sampled frame to the
// previous one by mean per-channel pixel difference. When the difference crosses
// `threshold` it's marked as a scene change, with a thumbnail and a confidence
// score (how decisively it cleared the threshold). `signal` lets an in-progress
// run bail when a new file is loaded.
// `collect`, if given an array, is filled with one { time, r, g, b, luma, diff }
// entry per sampled frame - the raw material for the content-timeline card (movie
// barcode + brightness/black-frame/freeze read). Computed in the same seek loop so
// it costs no extra scrubbing.
// `onProgress`, if given, is called with a 0..1 fraction before each sample.
// Scrubbing a long or large clip takes a while, so every caller feeds it a
// progress bar rather than leaving a bare "Detecting…" line on screen.
async function detectSceneChanges(video, threshold, signal, collect, onProgress) {
  if (!isFinite(video.duration) || video.duration <= 0) return [];

  const dur = video.duration;
  const tw = 160, th = 90;

  // Decide sample interval: aim for ~2 samples/sec for short clips, cap at
  // reasonable totals for long videos (max ~600 samples = 5 min at 0.5s).
  const interval = dur < 120 ? 0.5 : Math.max(0.5, dur / 600);
  const sampleCount = Math.floor(dur / interval);
  if (sampleCount < 2) return [];

  const cmpCanvas = document.createElement('canvas');
  cmpCanvas.width = tw;
  cmpCanvas.height = th;
  const cmpCtx = cmpCanvas.getContext('2d', { willReadFrequently: true });

  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = tw;
  thumbCanvas.height = th;
  const thumbCtx = thumbCanvas.getContext('2d');

  let prevData = null;
  const changes = [];

  const px = tw * th;
  for (let i = 0; i <= sampleCount; i++) {
    if (signal && signal.aborted) break;
    if (onProgress) { try { onProgress(i / (sampleCount + 1)); } catch (_) {} }
    const t = Math.min(i * interval, dur - 0.05);
    // Shorter patience than the contact sheet's: these seeks step forward in
    // small increments so they rarely stall, and there can be hundreds of them -
    // a long per-seek ceiling would turn one bad sample into a minutes-long wait.
    await seekAndPaint(video, t, 5000);

    cmpCtx.drawImage(video, 0, 0, tw, th);
    const frame = cmpCtx.getImageData(0, 0, tw, th);
    const d = frame.data;

    // Per-sample average colour + luma - drives the content-timeline barcode and
    // brightness curve. Cheap enough to always compute alongside the diff.
    let sr = 0, sg = 0, sb = 0;
    for (let j = 0; j < px; j++) {
      const off = j * 4;
      sr += d[off]; sg += d[off + 1]; sb += d[off + 2];
    }
    const ar = sr / px, ag = sg / px, ab = sb / px;
    const luma = 0.2126 * ar + 0.7152 * ag + 0.0722 * ab;

    let meanDiff = 0;
    if (prevData) {
      let sum = 0;
      const p = prevData.data;
      for (let j = 0; j < px; j++) {
        const off = j * 4;
        sum += Math.abs(d[off]     - p[off]);
        sum += Math.abs(d[off + 1] - p[off + 1]);
        sum += Math.abs(d[off + 2] - p[off + 2]);
      }
      meanDiff = sum / (px * 3);

      if (meanDiff > threshold) {
        thumbCtx.drawImage(video, 0, 0, tw, th);
        changes.push({
          time: t,
          diff: meanDiff,
          // How decisively the difference cleared the threshold, as a 0-99%
          // confidence (at the threshold ≈ 50%, twice the threshold ≈ 99%).
          confidence: Math.min(99, Math.round((meanDiff / threshold) * 50)),
          thumbnail: thumbCanvas.toDataURL('image/jpeg', 0.8)
        });
      }
    }

    if (collect) collect.push({ time: t, r: ar, g: ag, b: ab, luma, diff: prevData ? meanDiff : 0 });

    prevData = frame;
  }

  return changes;
}

// Turn the per-sample colour/luma series into a content-timeline card: a movie
// barcode (each sample -> one colour column), a brightness curve, and black-frame
// / freeze-segment flags. Returns null when there's nothing worth showing.
function buildContentTimelineCard(samples, dur, playerEl) {
  if (!samples || samples.length < 2 || !isFinite(dur) || dur <= 0) return null;

  const n = samples.length;
  const BLACK_LUMA = 12;   // near-black frame (0-255 mean luma)
  const FREEZE_DIFF = 1.5; // consecutive frames this close count as a still/freeze

  let minL = Infinity, maxL = -Infinity, sumL = 0, darkIdx = 0;
  for (let i = 0; i < n; i++) {
    const l = samples[i].luma;
    sumL += l;
    if (l < minL) { minL = l; darkIdx = i; }
    if (l > maxL) maxL = l;
  }
  const meanL = sumL / n;

  // Group consecutive flagged samples into [startTime, endTime] segments.
  const groupRuns = (test) => {
    const segs = [];
    let run = null;
    for (let i = 0; i < n; i++) {
      if (test(i)) {
        if (!run) run = { from: samples[i].time, to: samples[i].time, count: 0 };
        run.to = samples[i].time; run.count++;
      } else if (run) { segs.push(run); run = null; }
    }
    if (run) segs.push(run);
    return segs;
  };
  const blackSegs = groupRuns((i) => samples[i].luma < BLACK_LUMA);
  // Freeze needs at least a couple of near-identical consecutive frames (i>0 so a
  // diff exists); a lone still sample isn't a freeze.
  const freezeSegsRaw = groupRuns((i) => i > 0 && samples[i].diff < FREEZE_DIFF);
  const freezeSegs = freezeSegsRaw.filter((s) => s.count >= 2);

  const card = el('div', { class: 'anr-card' });
  const [h, help] = h3help('Content timeline',
    'Uses the same sampled frames as scene detection. The barcode squeezes each frame down to a single stripe of its average colour, so the whole video reads as a colour-over-time fingerprint. The curve below plots average brightness, flagging near-black frames and frozen or still stretches. Click the barcode to jump to that moment.');
  card.appendChild(h); card.appendChild(help);
  card.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 10px;' },
    n + ' frames sampled across ' + formatDuration(dur) + '.'));

  const cs = getComputedStyle(document.body);
  const accent = (cs.getPropertyValue('--accent') || '').trim() || (cs.getPropertyValue('--fg') || '').trim() || '#3a7';

  // -- Movie barcode: N colour columns drawn 1px tall, stretched by CSS. --
  const bar = el('canvas', { width: String(n), height: '1',
    style: 'width:100%; height:56px; display:block; border:var(--bd-hairline); image-rendering:auto; cursor:pointer;' });
  const bctx = bar.getContext('2d');
  if (bctx) {
    const img = bctx.createImageData(n, 1);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      img.data[o] = samples[i].r; img.data[o + 1] = samples[i].g;
      img.data[o + 2] = samples[i].b; img.data[o + 3] = 255;
    }
    bctx.putImageData(img, 0, 0);
  }
  bar.title = 'Click to jump to that point';
  bar.addEventListener('click', (e) => {
    const rect = bar.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (playerEl) { try { playerEl.currentTime = frac * dur; playerEl.pause(); } catch (_) {} }
  });
  card.appendChild(bar);

  // -- Brightness curve (mean luma over time). --
  const GW = 640, GH = 90, pad = 4;
  const g = el('canvas', { width: String(GW), height: String(GH),
    style: 'width:100%; height:auto; display:block; border:var(--bd-hairline); border-top:0; background:var(--bg);' });
  const gctx = g.getContext('2d');
  if (gctx) {
    // Shade black-frame stretches first, behind the curve.
    gctx.fillStyle = 'rgba(220,60,60,0.18)';
    for (const s of blackSegs) {
      const x0 = pad + (s.from / dur) * (GW - pad * 2);
      const x1 = pad + (s.to / dur) * (GW - pad * 2);
      gctx.fillRect(x0, pad, Math.max(1, x1 - x0), GH - pad * 2);
    }
    gctx.strokeStyle = accent;
    gctx.lineWidth = 1.5;
    gctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = pad + (samples[i].time / dur) * (GW - pad * 2);
      const y = GH - pad - (samples[i].luma / 255) * (GH - pad * 2);
      if (i === 0) gctx.moveTo(x, y); else gctx.lineTo(x, y);
    }
    gctx.stroke();
  }
  card.appendChild(g);

  // -- Readout. --
  const tbl = el('table', { class: 'anr-readout', style: 'margin-top:10px;' });
  const pct = (l) => Math.round((l / 255) * 100);
  tbl.appendChild(rowHelp('Brightness (mean)', pct(meanL) + '%  (luma ' + meanL.toFixed(0) + '/255)',
    'The average brightness of the sampled frames (measured as luma, the Rec. 709 standard). A very low value suggests the video is dark or underexposed overall.'));
  tbl.appendChild(row('Brightness range', pct(minL) + '% - ' + pct(maxL) + '%'));
  tbl.appendChild(row('Darkest sample', formatDuration(samples[darkIdx].time) + '  (' + pct(minL) + '%)'));
  tbl.appendChild(rowHelp('Black frames', blackSegs.length
      ? blackSegs.length + ' stretch' + (blackSegs.length > 1 ? 'es' : '')
      : 'none',
    'Sampled frames that are almost completely dark (brightness under ' + BLACK_LUMA + ' out of 255) - usually fades to black, cuts between shots, or black at the start or end.'));
  if (blackSegs.length) tbl.appendChild(row('', segList(blackSegs, dur)));
  tbl.appendChild(rowHelp('Freeze / still', freezeSegs.length
      ? freezeSegs.length + ' segment' + (freezeSegs.length > 1 ? 's' : '')
      : 'none',
    'Stretches where the picture barely changes from one sampled frame to the next - a frozen frame, a held title card, or a motionless shot. Only stretches longer than the sampling gap show up.'));
  if (freezeSegs.length) tbl.appendChild(row('', segList(freezeSegs, dur)));
  card.appendChild(tbl);

  return card;
}

// Compact "0:03 - 0:07 (n)" list of timeline segments, joined for a readout cell.
function segList(segs, dur) {
  return segs.map((s) => {
    const a = formatDuration(s.from), b = formatDuration(s.to);
    return (a === b ? a : a + ' - ' + b);
  }).join(',  ');
}

// ---------- iOS-safe frame capture ----------
// On iOS Safari, `loadeddata`/`seeked` can fire before a frame is actually
// composited, so drawImage() returns a black canvas. requestVideoFrameCallback
// fires only on a real painted frame; we gate every capture on it (with a
// rAF + timeout fallback for browsers/situations where it's unavailable).
function whenFramePainted(video) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(() => finish());
    else requestAnimationFrame(finish);
    setTimeout(finish, 2000);
  });
}

// Seek `video` to `t` and resolve once a frame from that position has actually
// been painted, so a following drawImage() can't capture the previous frame.
// Resolves true on success, false if the seek never landed - callers that build
// a picture out of the result use that to retry instead of baking in whatever
// happened to be on screen.
//
// Two bugs here used to corrupt contact sheets of large files:
//   - requestVideoFrameCallback was registered BEFORE the seek. It fires on the
//     next presented frame, which at that point is still the frame we're seeking
//     AWAY from, so the capture ran early and grabbed the wrong picture.
//   - the whole thing gave up after 2.5s and resolved anyway. A 1.5 GB clip
//     routinely needs longer to reach a distant keyframe, so tiles came out as
//     duplicates of the previous one or as bare background.
// So: wait for `seeked` first, and only then for a painted frame.
function seekAndPaint(video, t, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let done = false, timer = 0;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      resolve(ok);
    };
    // The seek has landed; now wait for the decoder to present a frame at the new
    // position. rVFC is the only trustworthy signal (iOS Safari fires `seeked`
    // before compositing), but a paused off-screen video can go quiet without
    // ever presenting again, so it never gets to be the only way out.
    function onSeeked() {
      if ('requestVideoFrameCallback' in video) {
        video.requestVideoFrameCallback(() => finish(true));
        setTimeout(() => finish(true), 600);
      } else {
        requestAnimationFrame(() => finish(true));
      }
    }
    video.addEventListener('seeked', onSeeked, { once: true });
    timer = setTimeout(() => finish(false), timeoutMs);
    try {
      video.currentTime = t;
      // Seeking to the position the element is already parked at fires no event.
      if (!video.seeking) onSeeked();
    } catch (_) { finish(false); }
  });
}

// ---------- visible-player fallback (iOS Safari) ----------
// The hidden probe above is parked 1px/near-invisible/z-index:-1 so it stays
// out of the layout, but iOS Safari refuses to allocate a decode surface for a
// video that small/hidden, so `loadeddata` never fires and even ordinary H.264
// files time out into the "could not load" error. A real, *visible* <video>
// element plays those same files. When the probe fails (and it isn't an AVI we
// can decode ourselves), we render this player instead: native controls,
// container/resolution/duration read straight off the loaded element, an
// on-demand frame grab into the photo section, and a SHA-256. Returns true if
// the player loaded (so the caller skips the error), false otherwise.
async function renderVisibleVideoFallback(file, url, header, resultsEl, signal) {
  const ctx = curVctx();
  const playerCard = el('div', { class: 'anr-card', style: 'position:relative;' });
  playerCard.appendChild(el('h3', {}, 'Player'));
  const playerEl = el('video', { src: url, playsinline: '' });
  playerEl.setAttribute('webkit-playsinline', '');
  playerEl.style.cssText = 'width:100%; max-height:480px; background:#0a0a0a; display:block; border:1px solid var(--hairline);';
  applyVideoControls(playerEl);
  playerCard.appendChild(playerEl);
  playerCard.appendChild(makePlayer(playerEl));
  // PCM-audio clips (Sony etc.) play mute natively - extract + sync the sound.
  attachPcmAudioCompanion(file, playerCard, signal);
  // This path has no off-screen probe (it's the iOS / decode-failed fallback), so
  // scene detection must seek the visible player. The badge flags that the brief
  // auto-scrub is analysis, not playback.
  const sceneBadge = el('div', { class: 'anr-video-analysing' }, 'Analysing…');
  playerCard.appendChild(sceneBadge);
  resultsEl.appendChild(playerCard);

  const loaded = await new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    playerEl.onloadedmetadata = () => finish(true);
    playerEl.onerror = () => finish(false);
    if (signal) signal.addEventListener('abort', () => finish(false));
    setTimeout(() => finish(false), 12000);
  });
  // Only keep the player (and offer reverse) if it actually decoded - otherwise
  // bail so the caller can fall through to the unplayable / convert path. The
  // reverse card is mounted lower down (just above Integrity), so an early bail
  // here keeps it off a player that never played.
  if (!loaded) { playerCard.remove(); return false; }

  const vw = playerEl.videoWidth, vh = playerEl.videoHeight, dur = playerEl.duration;

  // File info
  const infoCard = el('div', { class: 'anr-card' });
  infoCard.appendChild(el('h3', {}, 'File info'));
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Name', file.name));
  tbl.appendChild(row('Size', `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`));
  tbl.appendChild(rowHelp('MIME', file.type || '-', "The standard label for a file's format, such as image/jpeg or audio/mpeg. The browser takes it from the file's name or the operating system, so it's a hint about the format, not proof."));
  if (header && header.container) tbl.appendChild(row('Container', header.container + (header.brand ? '  (' + header.brand + ')' : '')));
  appendCreatorRows(tbl, header);
  if (vw && vh) {
    tbl.appendChild(row('Resolution', `${vw} × ${vh} px`));
    tbl.appendChild(row('Aspect ratio', aspectRatio(vw, vh)));
  }
  if (isFinite(dur) && dur > 0) tbl.appendChild(row('Duration', formatDuration(dur)));
  const bitrate = isFinite(dur) && dur > 0
    ? (file.size * 8 / dur / 1000).toFixed(0) + ' kbps  (' + (file.size * 8 / dur / 1_000_000).toFixed(2) + ' Mbps)' : '-';
  tbl.appendChild(rowHelp('Bitrate (total)', bitrate, 'How much data the whole file uses per second of playback - video, audio and packaging combined. Worked out as file size ÷ duration, so it is an overall average rather than the encoder’s target.'));
  const fpsRow = row('Frame rate', 'detecting…');
  tbl.appendChild(fpsRow);
  if (vw && vh) tbl.appendChild(rowHelp('Frame size', ((vw * vh) / 1_000_000).toFixed(2) + ' MP', 'How many pixels make up each frame, in megapixels (width × height ÷ 1,000,000). A rough guide to how much detail each frame holds before compression.'));
  // Codec / rotation / HDR / audio-codec from the ISOBMFF moov walk (best-effort).
  try {
    if (header && (/^(MP4|M4V|QuickTime MOV|3GP|3G2)/.test(header.container || '') || /MP4 \//.test(header.container || ''))) {
      const tracks = await detectIsobmffTracks(file);
      appendTrackRows(tbl, tracks);
    }
  } catch (_) {}
  infoCard.appendChild(tbl);
  resultsEl.insertBefore(infoCard, playerCard);

  // Detect FPS
  let detectedFps = 30;
  const fpsCell = fpsRow.querySelector('td');
  let frameControls = null;
  detectFps(file, fpsCell).then((fps) => {
    fpsCell.textContent = fps != null ? fps + ' fps' : 'N/A';
    if (fps != null) { detectedFps = fps; if (frameControls) frameControls.refresh(); }
  });

  // Frame-by-frame navigation, editable timecode, and frame grab (shared helper).
  if (vw && vh) {
    frameControls = buildFrameControls(playerEl, () => detectedFps, file);
    playerCard.appendChild(frameControls.wrap);
  }

  // EXIF metadata
  let exif = null;
  try { if (window.exifr) exif = await window.exifr.parse(file, { tiff: true, exif: true, gps: true, xmp: true, mergeOutput: true, translateValues: true, translateKeys: true, reviveValues: true, sanitize: true, silentErrors: true }); } catch (_) {}
  if (exif) {
    const metaRows = [];
    if (exif.Make) metaRows.push(['Make', exif.Make]);
    if (exif.Model) metaRows.push(['Model', exif.Model]);
    if (exif.Software) metaRows.push(['Software', exif.Software]);
    if (exif.DateTimeOriginal) metaRows.push(['Taken', new Date(exif.DateTimeOriginal).toISOString().replace('T', ' ').slice(0, 19)]);
    if (exif.CreateDate) metaRows.push(['Created', new Date(exif.CreateDate).toISOString().replace('T', ' ').slice(0, 19)]);
    if (metaRows.length) {
      const mc = el('div', { class: 'anr-card' });
      mc.appendChild(el('h3', {}, 'Metadata'));
      const mt = el('table', { class: 'anr-readout' });
      for (const [k, v] of metaRows) mt.appendChild(row(k, v));
      mc.appendChild(mt);
      resultsEl.appendChild(mc);
    }
  }

  // Sony gyro / IMU metadata (rtmd track) - best-effort, only appears for Sony MP4/MOV.
  await appendSonyGyroCard(file, resultsEl);

  // Contact sheet
  if (vw && vh && isFinite(dur) && dur > 0) {
    const sheetCard = el('div', { class: 'anr-card' });
    sheetCard.appendChild(el('h3', {}, 'Contact sheet'));
    const sheetBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Generate contact sheet');
    const sheetOut = el('div');
    sheetBtn.addEventListener('click', async () => {
      sheetBtn.disabled = true; sheetBtn.textContent = 'Generating…';
      const cols = 4, rows = 2, total = cols * rows;
      const tw = Math.round(vw * (320 / Math.max(vw, vh)));
      const th = Math.round(vh * (320 / Math.max(vw, vh)));
      const pad = 4;
      const gc = document.createElement('canvas');
      gc.width = cols * tw + (cols + 1) * pad;
      gc.height = rows * th + (rows + 1) * pad;
      const ctx = gc.getContext('2d');
      ctx.fillStyle = '#111'; ctx.fillRect(0, 0, gc.width, gc.height);
      const safeDur = Math.max(0, dur - 0.1);
      const prog = stepLoader('Capturing frame 1 of ' + total + '…');
      sheetOut.innerHTML = '';
      sheetOut.appendChild(prog.node);
      let missed = 0;
      for (let i = 0; i < total; i++) {
        prog.set(i / total, 'Capturing frame ' + (i + 1) + ' of ' + total + '…');
        const t = total > 1 ? (safeDur * i) / (total - 1) : 0;
        let ok = await seekAndPaint(playerEl, t);
        if (!ok) ok = await seekAndPaint(playerEl, Math.min(safeDur, t + 0.05));
        const c = i % cols, r = Math.floor(i / cols);
        if (ok) ctx.drawImage(playerEl, pad + c * (tw + pad), pad + r * (th + pad), tw, th);
        else missed++;
      }
      prog.set(1, 'Building the sheet…');
      sheetOut.innerHTML = '';
      sheetOut.appendChild(sheetImg(gc.toDataURL('image/png')));
      if (missed) sheetOut.appendChild(el('p', { class: 'anr-hint' },
        missed + ' of ' + total + ' frames could not be captured - the video stalled seeking to them.'));
      sheetBtn.disabled = false; sheetBtn.textContent = 'Generate contact sheet';
    });
    sheetCard.appendChild(el('div', { class: 'anr-btn-row' }, [sheetBtn]));
    sheetCard.appendChild(sheetOut);
    resultsEl.appendChild(sheetCard);

    // Scene detection
    const sceneCard = el('div', { class: 'anr-card' });
    sceneCard.appendChild(el('h3', {}, 'Scene changes'));
    const sceneOut = el('div');
    sceneOut.appendChild(el('p', { class: 'anr-hint' }, 'Detecting scene changes…'));
    sceneCard.appendChild(sceneOut);
    resultsEl.appendChild(sceneCard);
    const runScenes = async () => {
      const prog = stepLoader('Scanning for scene changes…');
      sceneOut.innerHTML = '';
      sceneOut.appendChild(prog.node);
      if (!isFinite(playerEl.duration) || playerEl.duration <= 0) {
        await new Promise(r => { playerEl.addEventListener('loadedmetadata', r, { once: true }); setTimeout(r, 6000); });
      }
      if (signal && signal.aborted) return;
      let changes = [];
      const contentSamples = [];
      try {
        changes = await detectSceneChanges(playerEl, 55, signal, contentSamples,
          (f) => prog.set(f, 'Scanning for scene changes… ' + Math.round(f * 100) + '%'));
      } catch (_) {}
      try { playerEl.currentTime = 0; playerEl.pause(); } catch (_) {}
      sceneBadge.remove();
      if (signal && signal.aborted) return;
      sceneOut.innerHTML = '';
      sceneOut.appendChild(el('p', { class: 'anr-hint', style: 'margin-bottom:10px;' },
        changes.length ? changes.length + ' scene change' + (changes.length > 1 ? 's' : '') + ' detected' : 'No scene changes detected'));
      try {
        const ctCard = buildContentTimelineCard(contentSamples, dur, playerEl);
        if (ctCard) sceneCard.after(ctCard);
      } catch (_) {}
      if (changes.length && isFinite(dur) && dur > 0) {
        const timeline = el('div', { class: 'anr-scene-timeline' });
        for (const sc of changes) {
          const marker = el('div', { class: 'anr-scene-marker',
            style: 'left:' + (sc.time / dur) * 100 + '%;',
            title: formatDuration(sc.time) + '  ·  ' + sc.confidence + '% confidence' });
          marker.addEventListener('click', () => { playerEl.currentTime = sc.time; playerEl.pause(); });
          timeline.appendChild(marker);
        }
        sceneOut.appendChild(timeline);
        const details = el('details', { class: 'anr-scene-details' });
        details.appendChild(el('summary', {}, 'Thumbnails (' + changes.length + ')'));
        const grid = el('div', { class: 'anr-scene-grid' });
        for (const sc of changes) {
          const wrap = el('div', { class: 'anr-scene-thumb',
            onclick: () => { playerEl.currentTime = sc.time; playerEl.pause(); } });
          wrap.appendChild(el('img', { src: sc.thumbnail, alt: 'Scene at ' + formatDuration(sc.time) }));
          wrap.appendChild(el('span', { class: 'anr-scene-meta' }, formatDuration(sc.time) + ' · ' + sc.confidence + '%'));
          grid.appendChild(wrap);
        }
        details.appendChild(grid);
        sceneOut.appendChild(details);
      }
    };
    // Large videos don't auto-run scene detection (it scrubs the player and can be
    // slow); offer a manual trigger instead.
    const bigVideo = file.size > 150 * 1024 * 1024 || (isFinite(dur) && dur > 600);
    if (bigVideo) {
      sceneBadge.remove();
      sceneOut.innerHTML = '';
      sceneOut.appendChild(el('p', { class: 'anr-hint', style: 'margin-bottom:8px;' },
        'Skipped automatically for large videos (' + (file.size / 1048576).toFixed(0) + ' MB). '
        + 'The Content timeline (movie barcode and brightness curve) is read from the same scan, so it appears with the results. Run it when you want:'));
      const runBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Detect scene changes');
      runBtn.addEventListener('click', () => { runBtn.remove(); runScenes(); });
      sceneOut.appendChild(runBtn);
    } else {
      runScenes();
    }
  }

  // Audio extraction (into Sound section) - gated behind an "Analyse audio" button.
  const audioResultsEl = ctx.audioTarget();
  if (audioResultsEl) mountAudioAnalyseButton(audioResultsEl, async () => {
    audioResultsEl.hidden = false;
    const audioCard = el('div', { class: 'anr-card' });
    audioCard.appendChild(el('h3', {}, 'Audio track'));
    const audioStatus = el('p', { class: 'anr-info' }, 'Decoding audio from video…');
    audioCard.appendChild(audioStatus);
    audioResultsEl.appendChild(audioCard);
    try {
      const ac = getAudioCtx();
      const buf = await file.arrayBuffer();
      let audioBuf;
      try { audioBuf = await ac.decodeAudioData(buf.slice(0)); } catch (_) {
        audioStatus.textContent = 'Trying PCM extraction…';
        audioBuf = extractPcmFromMp4(buf);
      }
      if (!audioBuf) {
        audioStatus.textContent = 'Web Audio failed, using FFmpeg…';
        audioBuf = await ffmpegExtractAudio(file, audioCard);
      }
      audioStatus.remove();
      // Hand the decoded PCM to the real audio renderer so the Sound section here
      // is identical to a directly-dropped audio file - same cards, same order, and
      // the full forensic set (File info, the EBU R128 / spectral Advanced card,
      // channel picker, ...). renderAudio clears audioResultsEl, replacing the
      // status card above in place. declaredLossless:false stops the WAV wrapper
      // from being read as a fake-lossless claim.
      const basename = (file.name || 'video').replace(/\.[^/.]+$/, '') + '_audio';
      const wavBlob = new Blob([encodeWav(audioBuf)], { type: 'audio/wav' });
      const audioFile = new File([wavBlob], basename + '.wav', { type: 'audio/wav' });
      await renderAudio(audioFile, audioResultsEl, {
        inline: true, audioBuffer: audioBuf, playbackFile: audioFile,
        declaredLossless: false, download: true, downloadLabel: 'Download audio (WAV)',
      });
    } catch (e) {
      audioStatus.remove();
      // renderAudio clears audioResultsEl, so re-attach the status card if the
      // failure happened after that (the common decode failures happen before it,
      // where the card is still in place).
      if (!audioCard.isConnected) audioResultsEl.appendChild(audioCard);
      audioCard.appendChild(el('p', { class: 'anr-hint' }, 'Audio decode failed: ' + (e && e.message || 'unknown error')));
    }
  });

  // ---- Reverse playback (re-encode the video backwards, on demand) ----
  // Sits just above Integrity, below the scene-change card.
  resultsEl.appendChild(buildReverseVideoCard(file, signal));

  // SHA-256
  if (file.size <= HASH_FILE_MAX) {
    resultsEl.appendChild(integrityCard(file));
  }

  return true;
}

// ---------- Advanced: container structure / forensics (ISOBMFF) ----------
// Card chrome for the UI-free parser in video-forensics.js. Mirrors the photo
// Advanced card: one collapsed anr-card holding flat parts - provenance tells,
// tracks, a frames/bitrate map, bitstream & authenticity, and the full box tree
// last. All read from the MP4/MOV boxes with zero decoding. Returns null for
// non-ISOBMFF files or any failure, so callers just skip it.

// A collapsible <details> panel with a plain summary label (no info button) -
// the same idiom photo.js's advPanel uses.
// One part of the Advanced card - a flat labelled block, not a disclosure of its
// own (the card is the single dropdown). The legacy `open` argument is accepted and
// ignored: with no per-part folding there is no headline part to pre-open.
function vAdvPanel(title, helpHtml, _open) {
  const det = el('div', { class: 'anr-adv-part' });
  const head = el('div', { class: 'anr-adv-parthead' }, title + (helpHtml ? ' ' : ''));
  const body = el('div');
  if (helpHtml) {
    const btn = el('button', { type: 'button', class: 'anr-info-btn', title: 'Info' }, '[?]');
    const panel = el('div', { class: 'anr-info-panel is-hidden', html: helpHtml });
    wireInfoToggle(btn, panel);
    head.appendChild(btn);
    body.appendChild(panel);
  }
  det.appendChild(head);
  det.appendChild(body);
  return { det, body };
}

// Render the atom tree. Container nodes become nested <details> (the top level
// open by default); leaves are single indented rows. Monospace, hairline-indented.
function renderBoxTree(nodes, container, depth) {
  for (const n of nodes) {
    const gloss = BOX_GLOSS[n.type] || '';
    const metaText = (gloss ? gloss + '  ·  ' : '') + fmtBytes(n.size) + '  ·  @' + n.offset.toLocaleString();
    const fcc = el('code', { class: 'anr-boxtree-fcc' }, n.type);
    const meta = el('span', { class: 'anr-boxtree-meta' }, metaText);
    if (n.children && n.children.length) {
      const det = el('details', { class: 'anr-boxtree-node' });
      if (depth === 0) det.setAttribute('open', '');
      det.appendChild(el('summary', { class: 'anr-boxtree-row' }, [fcc, meta]));
      const kids = el('div', { class: 'anr-boxtree-kids' });
      renderBoxTree(n.children, kids, depth + 1);
      det.appendChild(kids);
      container.appendChild(det);
    } else {
      container.appendChild(el('div', { class: 'anr-boxtree-row anr-boxtree-leaf' }, [fcc, meta]));
    }
  }
}

// A per-second bitrate bar chart on a themed canvas (peak-per-bucket when there
// are more seconds than pixels). Static like the photo ELA canvases.
function renderBitrateGraph(perSecKbps) {
  const W = 640, H = 130, pad = 5;
  const cv = el('canvas', { width: String(W), height: String(H),
    style: 'width:100%; height:auto; display:block; border:var(--bd-hairline); background:var(--bg);' });
  const ctx = cv.getContext('2d');
  if (!ctx) return cv;
  const cs = getComputedStyle(document.body);
  const accent = (cs.getPropertyValue('--accent') || '').trim() || (cs.getPropertyValue('--fg') || '').trim() || '#3a7';
  const n = perSecKbps.length;
  if (!n) return cv;
  const bars = Math.max(1, Math.min(n, W - pad * 2));
  const step = n / bars;
  let peak = 1;
  for (const v of perSecKbps) if (v > peak) peak = v;
  const bw = (W - pad * 2) / bars;
  ctx.fillStyle = accent;
  for (let i = 0; i < bars; i++) {
    let v = 0;
    for (let j = Math.floor(i * step); j < Math.floor((i + 1) * step) && j < n; j++) v = Math.max(v, perSecKbps[j]);
    const h = (v / peak) * (H - pad * 2);
    ctx.fillRect(pad + i * bw, H - pad - h, Math.max(1, bw - 0.5), h);
  }
  return cv;
}

async function buildVideoAdvancedCard(file) {
  let s = null;
  try { s = await analyzeMp4Structure(file); } catch (_) { return null; }
  if (!s) return null;

  const card = el('div', { class: 'anr-card anr-adv anr-collapsible is-collapsed' });
  const [advH, advHelp] = h3help('Advanced',
    'Container structure and stream forensics read straight from the MP4/MOV boxes, with nothing decoded. The headline provenance signs are shown up top; the deeper panels fold open when you want them.');
  card.appendChild(advH); card.appendChild(advHelp);

  // -- Provenance tells (the forensic headline - shown open, on top) --
  {
    const rows = [];
    if (s.faststart !== null) {
      rows.push(rowHelp('Faststart',
        s.faststart ? 'Yes - moov before mdat (progressive / web-optimised)'
          : 'No - mdat before moov (typical camera-original layout)',
        'Faststart puts the file’s index (the moov) before the video data so playback can start before the whole file has downloaded. Editors and upload tools add it; most cameras write the index last, so an original camera file often will not have it.'));
    }
    if (s.ftyp && s.ftyp.majorBrand) {
      const brands = (s.ftyp.brands || []).filter((b) => b && b !== s.ftyp.majorBrand);
      rows.push(rowHelp('Brand', s.ftyp.majorBrand + (brands.length ? '  (' + brands.join(', ') + ')' : ''),
        'Codes near the start of the file (the ftyp brands) that say which format standard it follows, such as mp42, isom, qt or M4V. They hint at which tool wrote the file and which device it was meant for.'));
    }
    if (isFinite(s.movieDurationSec) && s.movieDurationSec > 0)
      rows.push(row('Movie duration', formatDuration(s.movieDurationSec)));
    const edited = s.tracks.filter((t) => t.editList && t.editList.entries > 1).map((t) => 'Track ' + t.index);
    if (edited.length)
      rows.push(rowHelp('Edit lists', edited.join(', ') + '  (multi-segment)',
        'An edit list (elst) with several segments splices or trims a track’s timeline, which is a sign of editing. The plain single-segment version found in most MP4s is not flagged here.'));
    if (s.mdatCount > 1)
      rows.push(rowHelp('Media segments', s.mdatCount + ' mdat boxes',
        'More than one block of media data usually means the file was joined together or exported by an editor, rather than recorded in one continuous pass.'));
    if (s.padBytes > 0)
      rows.push(rowHelp('Padding', fmtBytes(s.padBytes) + ' in ' + s.padCount + ' free/skip box' + (s.padCount === 1 ? '' : 'es'),
        'Empty reserved space inside the file (free or skip boxes), often left behind when a faststart tool moved the index, or added as slack when the file was assembled.'));
    if (s.fragmented)
      rows.push(rowHelp('Fragmented', 'Yes - moof fragments',
        'The video is broken into many small fragments (moof) instead of one continuous block. This is how streaming formats (DASH/CMAF/HLS-fMP4) and some recorders lay out a file.'));
    if (s.trailing)
      rows.push(rowHelp('Trailing data', s.trailing.type + '  (' + fmtBytes(s.trailing.size) + ')',
        'Extra data sitting after the main media. Sometimes a marker added by an editor or app (a uuid box), sometimes leftover data tacked on after the file was first written.'));
    if (rows.length) {
      const { det, body } = vAdvPanel('Provenance tells',
        'Structural signs of how the file was produced - camera-original, re-muxed, edited or streamed.', true);
      const pt = el('table', { class: 'anr-readout' });
      for (const r of rows) pt.appendChild(r);
      body.appendChild(pt);
      card.appendChild(det);
    }
  }

  // -- Tracks --
  if (s.tracks.length) {
    const { det, body } = vAdvPanel('Tracks (' + s.tracks.length + ')',
      'Every track in the file, not just the first video and audio - including timecode and timed-metadata streams (GoPro, CAMM, Sony gyro).');
    const tt = el('table', { class: 'anr-readout' });
    for (const t of s.tracks) {
      const parts = [];
      if (t.codecName) parts.push(t.codecName);
      if (t.language && t.language !== 'und') parts.push(t.language);
      if (isFinite(t.durationSec) && t.durationSec > 0) parts.push(formatDuration(t.durationSec));
      if (t.sampleCount) parts.push(t.sampleCount.toLocaleString() + ' sample' + (t.sampleCount === 1 ? '' : 's'));
      if (t.timecode) parts.push('start ' + t.timecode + (t.dropFrame ? ' (drop-frame)' : ''));
      // A single identity edit is standard in nearly every MP4; only note edit
      // lists that actually splice/trim (more than one segment).
      if (t.editList && t.editList.entries > 1) parts.push('edit list (' + t.editList.entries + ' segments)');
      let label = 'Track ' + t.index + '  ·  ' + (t.handlerName || 'Unknown');
      if (t.enabled === false) label += '  (disabled)';
      tt.appendChild(row(label, parts.join('  ·  ') || (t.codec || '-')));
    }
    body.appendChild(tt);
    card.appendChild(det);
  }

  // -- Frames & bitrate --
  if (s.gop) {
    const g = s.gop;
    const { det, body } = vAdvPanel('Frames & bitrate',
      'Keyframe structure and data-rate over time, computed from the sample tables (sizes, sync samples and durations) - no frames are decoded.');
    const ft = el('table', { class: 'anr-readout' });
    ft.appendChild(rowHelp('Frame rate',
      g.cfr ? g.avgFps.toFixed(3).replace(/\.?0+$/, '') + ' fps (constant)'
        : 'Variable - avg ' + g.avgFps.toFixed(2) + ' fps (' + g.minFps.toFixed(2) + ' - ' + g.maxFps.toFixed(2) + ')',
      'How many frames play each second, added up from the timing of every frame. One steady value means a constant frame rate; several means it varies (variable frame rate), which is common in screen recordings and phone footage.'));
    ft.appendChild(rowHelp('Keyframe interval',
      g.allIntra ? 'All-intra (every frame a keyframe)'
        : 'avg ' + g.avgGop.toFixed(1) + ' frames  ·  max ' + g.maxGop + '  ·  ' + g.keyCount.toLocaleString() + ' keyframes',
      'The average and longest gap between keyframes - full, self-contained frames (also called the GOP length). Short, regular gaps suit streaming and editing; a single keyframe, or every frame being a keyframe, points to camera-original or editing-friendly formats.'));
    if (g.pAvg > 0)
      ft.appendChild(rowHelp('Frame size',
        'keyframe ~' + fmtBytes(g.iAvg) + '  ·  inter ~' + fmtBytes(g.pAvg),
        'The average stored size of keyframes compared with in-between frames. Keyframes are usually several times larger because each one holds a complete picture, while the others only store what changed.'));
    ft.appendChild(rowHelp('Bitrate (video)',
      (g.avgBitrateKbps / 1000).toFixed(2) + ' Mbps avg  ·  ' + (g.peakKbps / 1000).toFixed(2) + ' Mbps peak',
      'How much data the picture uses per second, on average and at its busiest, measured second by second. This is the video on its own, unlike the whole-file bitrate shown in File info.'));
    body.appendChild(ft);
    if (g.perSecKbps && g.perSecKbps.length > 1) {
      body.appendChild(el('div', { class: 'anr-readout-section' }, 'Bitrate over time'));
      body.appendChild(renderBitrateGraph(g.perSecKbps));
      body.appendChild(el('p', { class: 'anr-hint', style: 'margin:6px 0 0;' },
        'Per-second video bitrate across the clip. Peaks mark high-motion or scene-change sections.'));
    }
    card.appendChild(det);
  }

  // -- Bitstream & authenticity (deep SPS parse, encoder fingerprint, HDR, C2PA) --
  let bs = null;
  try { bs = await analyzeBitstream(file); } catch (_) {}
  if (bs) appendBitstreamPanel(card, bs);

  // -- Box tree (last) --
  // The raw atom dump goes to the very bottom: it is the longest part by far and
  // the least often read, so keeping it above the findings pushed everything else
  // down behind a wall of four-character codes.
  {
    const { det, body } = vAdvPanel('Box tree (' + s.tree.length + ' top-level box' + (s.tree.length === 1 ? '' : 'es') + ')',
      'Every atom (box) in the file: its 4-character type, size and byte offset. Expand a container to see what it holds.');
    const tree = el('div', { class: 'anr-boxtree' });
    renderBoxTree(s.tree, tree, 0);
    body.appendChild(tree);
    card.appendChild(det);
  }

  return card;
}

// The Advanced > "Bitstream & authenticity" panel, built from analyzeBitstream().
function appendBitstreamPanel(card, bs) {
  const { det, body } = vAdvPanel('Bitstream & authenticity',
    'Read from the actual H.264/H.265 stream, not just the container: the codec’s own SPS, an encoder fingerprint, HDR mastering values and any Content Credentials.');

  // Stream (SPS)
  if (bs.sps) {
    const p = bs.sps;
    body.appendChild(el('div', { class: 'anr-readout-section' }, 'Stream (from the codec SPS)'));
    const st = el('table', { class: 'anr-readout' });
    st.appendChild(rowHelp('Codec', p.codec + '  ·  ' + p.profile + '  ·  L' + p.level,
      'The profile and level read from deep inside the video stream itself (the sequence parameter set) - the true record of what the encoder actually produced, regardless of what the file’s outer labels claim.'));
    st.appendChild(rowHelp('Coded size', p.width + ' × ' + p.height + ' px',
      'The full frame size the encoder actually worked on, which can be slightly larger than the displayed resolution. Video is encoded in blocks, so the picture is padded up to the next block boundary (for example a 1080-tall video is often coded as 1088) and the extra rows are cropped off on playback.'));
    st.appendChild(rowHelp('Chroma / depth', p.chroma + '  ·  ' + p.bitDepth + '-bit',
      'How the colour is stored. Chroma subsampling (4:2:0, 4:2:2 or 4:4:4) is how much colour detail is kept relative to brightness - the eye notices brightness more, so most video keeps less colour to save space. Bit depth is how many shades each channel has (8-bit is standard; 10-bit gives smoother gradients and is common for HDR).'));
    st.appendChild(rowHelp('Scan', p.progressive ? 'Progressive' : 'Interlaced',
      'Whether each frame is stored complete (progressive) or as two interlaced half-frames. Read from the frame_mbs_only flag in the stream’s settings (the SPS).'));
    if (p.colourText) st.appendChild(rowHelp('Colour (VUI)', p.colourText,
      'The colour instructions and signal range carried inside the video stream itself (its VUI). If these disagree with the labels on the outer container, the file was re-tagged after encoding.'));
    if (p.fps) st.appendChild(rowHelp('Stream frame rate', p.fps.toFixed(3).replace(/\.?0+$/, '') + ' fps',
      'The frame rate read from the video stream itself, shown separately from the container’s stated frame rate. Usually they agree; if they disagree, the file was re-tagged or re-timed after it was encoded.'));
    body.appendChild(st);
  }

  // Consistency verdict
  if (bs.consistency && bs.consistency.length) {
    const mism = bs.consistency.filter((c) => !c.match);
    body.appendChild(el('div', { class: 'anr-readout-section' }, 'Stream vs container'));
    body.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 8px;' },
      mism.length
        ? mism.length + ' mismatch' + (mism.length === 1 ? '' : 'es') + ' - the container was re-tagged or the video re-encoded/edited after capture.'
        : 'Consistent - the stream\'s own dimensions, frame rate and colour match the container, as expected for a camera-original file.'));
    const ct = el('table', { class: 'anr-readout' });
    for (const c of bs.consistency)
      ct.appendChild(row((c.match ? '✓ ' : '✗ ') + c.field, c.container + '  vs  ' + c.stream));
    body.appendChild(ct);
  }

  // Encoder fingerprint
  body.appendChild(el('div', { class: 'anr-readout-section' }, 'Encoder fingerprint'));
  if (bs.encoder) {
    body.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 6px;' },
      (bs.encoder.tool ? bs.encoder.tool + ' - from' : 'From') + ' an unregistered SEI message in the first frame. Pins the exact encoder build and its settings.'));
    body.appendChild(el('pre', { style: 'white-space:pre-wrap; word-break:break-word; font-size:12px; margin:0; padding:8px; border:var(--bd-hairline); overflow:auto;' }, bs.encoder.string));
  } else {
    body.appendChild(el('p', { class: 'anr-hint', style: 'margin:0;' },
      'None found. Hardware and camera encoders (phones, GoPro, cameras) rarely embed one; software encoders like x264/x265 do, so its absence is itself a mild camera-original tell.'));
  }

  // HDR
  if (bs.hdr) {
    const h = bs.hdr;
    body.appendChild(el('div', { class: 'anr-readout-section' }, 'HDR'));
    const ht = el('table', { class: 'anr-readout' });
    if (h.mdcv) ht.appendChild(rowHelp('Mastering display',
      h.mdcv.maxLum.toFixed(0) + ' cd/m² peak  ·  ' + h.mdcv.minLum.toFixed(4) + ' cd/m² black',
      'The brightness range of the professional screen the video was colour-graded on (recorded as SMPTE ST 2086 data).'));
    if (h.clli) ht.appendChild(rowHelp('Content light', 'MaxCLL ' + h.clli.maxCLL + '  ·  MaxFALL ' + h.clli.maxFALL,
      'The brightest single point and the brightest whole-frame average in the video, measured in cd/m² (the CEA-861.3 standard).'));
    if (h.dolbyVision) ht.appendChild(rowHelp('Dolby Vision', 'profile ' + h.dolbyVision.profile + '  ·  level ' + h.dolbyVision.level,
      'Dolby Vision is a premium HDR format. The profile says which variant is used (which decides how it plays on non-Dolby screens) and the level indicates the resolution and frame-rate range it targets.'));
    else if (h.dolbyVisionCodec) ht.appendChild(rowHelp('Dolby Vision', 'signalled by codec',
      'Dolby Vision is a premium HDR format. Here it is declared only by the container’s codec label rather than by full stream metadata, so the profile and level details are not present to read.'));
    body.appendChild(ht);
  }

  // C2PA
  body.appendChild(el('div', { class: 'anr-readout-section' }, 'Content Credentials (C2PA)'));
  body.appendChild(el('p', { class: 'anr-hint', style: 'margin:0;' },
    bs.c2pa && bs.c2pa.present
      ? 'A C2PA / Content Credentials manifest is embedded (' + fmtBytes(bs.c2pa.size) + ')'
        + (bs.c2pa.generator ? ', generator "' + bs.c2pa.generator + '"' : '') + '. It records the file\'s claimed origin and edit history.'
      : 'No C2PA / Content Credentials manifest found in the container.'));

  card.appendChild(det);
}

// ---------- main render ----------

// Tears down the previous video's persistent listeners/observers when a new
// file is analysed.
let videoRenderAbort = null;

export async function renderVideo(file, resultsEl, opts = {}) {
  // Inline mode (compare view's side-by-side panels): isolate the abort controller
  // so two videos don't cancel each other, and route every cross-section target to
  // a local slot inside this panel with player-sync/companion off. See DEFAULT_VCTX.
  const inline = !!opts.inline;
  // A compare-view panel is a FULL analysis isolated to its own container, so it
  // should show the same telemetry/Advanced-structure cards the normal page does;
  // `full` gates those. `inline` still gates the genuine inline concerns (local
  // slots, isolated abort controller, no autoscroll/player-sync). Video inline mode
  // is only ever the compare view, so a panel is always the compare (full) case.
  const full = !inline || !!opts.compare;
  let renderSignal;
  if (inline) {
    renderSignal = new AbortController().signal;
  } else {
    if (videoRenderAbort) videoRenderAbort.abort();
    videoRenderAbort = new AbortController();
    renderSignal = videoRenderAbort.signal;
  }
  const localSlots = {};
  // Tag each sub-slot with its kind so the compare view can file the extracted
  // audio under the Sound section and the grabbed frame under the Photo section,
  // matching the normal single-file layout.
  const localSlot = (key) => localSlots[key] || (localSlots[key] = resultsEl.appendChild(el('div', { class: 'anr-results anr-cmp-subslot anr-cmp-sub-' + key })));
  const vctx = inline ? {
    inline: true,
    compare: !!opts.compare,
    photoTarget: () => localSlot('photo'),
    audioTarget: () => localSlot('audio'),
    previewTarget: () => localSlot('preview'),
    afterPhoto: () => {},
    // A grabbed frame gets the full photo analysis in compare too (matching the
    // normal page, where the frame renders into the real Photo section), so carry
    // the compare flag into the inline photo render.
    photoOpts: (base) => Object.assign({ inline: true, compare: !!opts.compare }, base),
    sync: () => {},
    companion: () => {},
  } : DEFAULT_VCTX;
  videoCtx = vctx;   // helpers/handlers capture this synchronously at build time

  // When we re-enter with an FFmpeg-built proxy (converted from an undecodable
  // codec, or remuxed from a raw/TS stream), `file` is the PLAYABLE proxy but the
  // user's real file is opts.sourceFile. Playback and pixel/frame analysis must use
  // the proxy (the original can't be decoded), but every metadata / container /
  // bitstream / telemetry / hash / fps read must describe the ORIGINAL - otherwise
  // we'd report the proxy's H.264 SPS, its stripped-out GoPro track, its fps cap,
  // etc. For a non-ISOBMFF original (raw/TS) the container analysers simply return
  // nothing, which is correct - the proxy's structure isn't the user's file.
  const analysisFile = opts.sourceFile || file;

  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Loading "${file.name}"…`));
  // Put a loading bar in the preview panel straight away. Everything between here
  // and the player - the container reads, then a probe decode that can sit on its
  // 8 s timeout - happens with that panel empty, which reads as nothing happening
  // at all. The normal path wipes the slot when it mounts the real player; the
  // fallback renderers call clearVideoPreviewBoot(). Inline renders own no such
  // panel, so they skip this.
  if (!inline) {
    const bootPv = document.getElementById('videoPreview');
    if (bootPv) { bootPv.innerHTML = ''; bootPv.appendChild(inlineLoader('Decoding video…')); }
  }


  let header = {};
  try { header = await peekVideoContainer(file); } catch (_) {}
  // Enrich with the authoring software recorded in the container (Matroska
  // WritingApp/MuxingApp, AVI ISFT). header is reused by every render path below.
  try { Object.assign(header, await readContainerSoftware(file, header.container)); } catch (_) { /* ignore */ }

  // Broken / unfinalised MP4-MOV: an ftyp + mdat with no moov index. An interrupted
  // recording or an incomplete file copy leaves out the moov (cameras write it
  // last), so no player can locate frames - but the encoded video is still in the
  // mdat. Offer to salvage it. Skipped on the recovered stream we re-enter with.
  if (!opts.recovered && /MP4|MOV|M4V|3GP|3G2|QuickTime/i.test(header.container || '')) {
    let moovless = null;
    try { moovless = await detectMoovlessMp4(fileRangeReader(file), file.size); } catch (_) {}
    if (moovless && moovless.moovless) {
      return renderMoovlessRecovery(file, header, moovless, resultsEl, renderSignal);
    }
  }

  // Raw H.264 / H.265 elementary stream: no container, so the browser can't open
  // it. FFmpeg stream-copies it into an MP4 (no re-encode, a second or two), and
  // we then render THAT through the normal playable path - real player, frame
  // tools, codec/profile readout and all. The original .h264 is still shown for
  // name / size / hash via opts.sourceFile. On failure (FFmpeg offline, or a
  // stream it won't copy) we fall back to the unplayable-info path.
  const looksRaw = header.raw === 'h264' || header.raw === 'h265' ||
    /\.(h?264|avc|h?265|hevc)$/i.test(file.name || '');
  if (!opts.remuxed && looksRaw) {
    const kind = header.raw === 'h265' || /\.(h?265|hevc)$/i.test(file.name || '') ? 'H.265' : 'H.264';
    // The remux holds the whole input AND the whole output MP4 in WASM memory, so
    // very large streams can't fit (the 32-bit core caps out near ~2 GB). Above the
    // limit, split the stream at keyframes and play it part-by-part instead.
    const REMUX_MAX = 1_400 * 1024 * 1024;
    if (file.size > REMUX_MAX) {
      try {
        await renderSegmentedRawVideo(file, header, resultsEl, kind, renderSignal);
      } catch (e) {
        if (renderSignal.aborted) return;
        resultsEl.innerHTML = '';
        await renderUnplayableVideoInfo(file, header, resultsEl, renderSignal);
        resultsEl.appendChild(el('div', { class: 'anr-card' }, [
          el('p', {}, 'This raw ' + kind + ' stream is ' + fmtBytes(file.size) + ' - too large to remux in one piece, and '
            + 'splitting it into parts failed (' + ((e && e.message) || e) + '). Open it in VLC, or wrap it with desktop ffmpeg: '
            + 'ffmpeg -i "' + (file.name || 'input.h264') + '" -c copy out.mp4.')
        ]));
      }
      return;
    }
    resultsEl.innerHTML = '';
    resultsEl.appendChild(el('div', { class: 'anr-info' },
      'Raw ' + kind + ' elementary stream - remuxing to MP4 with FFmpeg so it plays in the browser…'));
    let mp4Blob = null, remuxLog = '';
    const rawKind = kind === 'H.265' ? 'h265' : 'h264';
    try {
      const r = await ffmpegRemuxToMp4(file, renderSignal, rawKind);
      mp4Blob = r && r.blob;
      remuxLog = (r && r.log) || '';
    } catch (e) {
      remuxLog = (e && e.message) ? ('FFmpeg could not load: ' + e.message) : String(e);
    }
    if (renderSignal.aborted) return;
    if (mp4Blob) {
      const base = (file.name || 'video').replace(/\.[^/.]+$/, '');
      const mp4File = new File([mp4Blob], base + '.mp4', { type: 'video/mp4' });
      return renderVideo(mp4File, resultsEl, { remuxed: true, sourceFile: file, sourceKind: kind, noAudio: true, inline, compare: !!opts.compare });
    }
    resultsEl.innerHTML = '';
    await renderUnplayableVideoInfo(file, header, resultsEl, renderSignal);
    // Surface WHY the remux produced nothing instead of failing silently - the
    // FFmpeg log (or load error) makes a genuine failure diagnosable.
    if (!renderSignal.aborted) {
      const tail = remuxLog.split('\n').map((s) => s.trim()).filter(Boolean).slice(-14).join('\n');
      const diag = el('details', { class: 'anr-card' });
      diag.appendChild(el('summary', { style: 'cursor:pointer;' }, 'In-browser remux to MP4 didn’t produce a file - details'));
      diag.appendChild(el('pre', { style: 'white-space:pre-wrap; word-break:break-word; font-size:12px; margin:8px 0 0; overflow:auto;' },
        tail || 'FFmpeg produced no output and emitted no log (it may be offline or blocked).'));
      resultsEl.appendChild(diag);
    }
    return;
  }

  // MPEG-TS / AVCHD camcorder files (.mts / .m2ts / .ts). The transport-stream
  // container plays in no browser, but the video inside is normally H.264, so
  // FFmpeg stream-copies the video and transcodes the audio (commonly AC-3 / PCM)
  // to AAC - far quicker than the full re-encode the "Convert" button does - then
  // we render the resulting MP4 through the normal playable path. Gated on the TS
  // sync-byte (header.container), not the extension, so a TypeScript .ts is never
  // mistaken for a transport stream.
  if (!opts.remuxed && header.container === 'MPEG-TS') {
    // The remux holds the input and the output MP4 in WASM memory together, so a
    // very large file can't fit the 32-bit core. Above the cap, go straight to the
    // unplayable card (with its "Convert" button and VLC tip).
    const TS_REMUX_MAX = 1_400 * 1024 * 1024;
    if (file.size > TS_REMUX_MAX) {
      resultsEl.innerHTML = '';
      await renderUnplayableVideoInfo(file, header, resultsEl, renderSignal);
      return;
    }
    resultsEl.innerHTML = '';
    resultsEl.appendChild(el('div', { class: 'anr-info' },
      'AVCHD / MPEG-TS video - remuxing to MP4 with FFmpeg so it plays in the browser…'));
    let mp4Blob = null, remuxLog = '';
    try {
      const r = await ffmpegRemuxTsToMp4(file, renderSignal);
      mp4Blob = r && r.blob;
      remuxLog = (r && r.log) || '';
    } catch (e) {
      remuxLog = (e && e.message) ? ('FFmpeg could not load: ' + e.message) : String(e);
    }
    if (renderSignal.aborted) return;
    if (mp4Blob) {
      const base = (file.name || 'video').replace(/\.[^/.]+$/, '');
      const mp4File = new File([mp4Blob], base + '.mp4', { type: 'video/mp4' });
      return renderVideo(mp4File, resultsEl, { remuxed: true, converted: true, sourceFile: file, sourceCodec: 'AVCHD / MPEG-TS', inline, compare: !!opts.compare });
    }
    // Remux produced nothing - fall back to the unplayable card and surface why.
    resultsEl.innerHTML = '';
    await renderUnplayableVideoInfo(file, header, resultsEl, renderSignal);
    if (!renderSignal.aborted) {
      const tail = remuxLog.split('\n').map((s) => s.trim()).filter(Boolean).slice(-14).join('\n');
      const diag = el('details', { class: 'anr-card' });
      diag.appendChild(el('summary', { style: 'cursor:pointer;' }, 'In-browser remux to MP4 didn’t produce a file - details'));
      diag.appendChild(el('pre', { style: 'white-space:pre-wrap; word-break:break-word; font-size:12px; margin:8px 0 0; overflow:auto;' },
        tail || 'FFmpeg produced no output and emitted no log (it may be offline or blocked).'));
      resultsEl.appendChild(diag);
    }
    return;
  }

  // Up-front gate for codecs that load their metadata cleanly but can never
  // actually decode in a browser: 4:2:2 / 4:4:4 chroma (e.g. Sony XAVC HS /
  // FX-series 10-bit 4:2:2) and 12-bit+ video. For these the <video> element
  // fires loadeddata / loadedmetadata - so the probe and the visible fallback
  // both "succeed" - yet only ever paint a black, empty player with no error
  // event, so the code would otherwise never reach the unplayable path that
  // explains the limitation and recommends VLC. Route them there directly.
  // (10-bit 4:2:0 and pro/intermediate codecs still go through the probe, since
  // some browsers/devices can decode them.)
  try {
    if (/MP4|MOV|M4V|3GP|3G2|QuickTime/i.test(header.container || '')) {
      const earlyTracks = await detectIsobmffTracks(file);
      const ev = earlyTracks && earlyTracks.video;
      if (ev && (ev.chroma === '4:2:2' || ev.chroma === '4:4:4' || (ev.bitDepth && ev.bitDepth >= 12))) {
        resultsEl.innerHTML = '';
        await renderUnplayableVideoInfo(file, header, resultsEl, renderSignal);
        return;
      }
    }
  } catch (_) {}

  const url = URL.createObjectURL(file);

  // The probe is kept IN THE DOM (not display:none) so the browser gives it a
  // decode surface for off-screen frame capture - otherwise frames never paint
  // and captures come out black. It's parked 1px/near-transparent in the corner
  // via .anr-video-probe. iOS Safari often refuses to decode something this
  // small/hidden anyway; when the probe never loads, the catch block below falls
  // back to a real visible player (renderVisibleVideoFallback).
  const probe = el('video', { class: 'anr-video-probe' });
  probe.muted = true;
  probe.defaultMuted = true;
  probe.setAttribute('muted', '');
  probe.setAttribute('playsinline', '');
  probe.setAttribute('webkit-playsinline', '');
  probe.setAttribute('preload', 'auto');
  document.body.appendChild(probe);
  renderSignal.addEventListener('abort', () => probe.remove());

  try {
    // AVI never plays reliably through <video> - it's typically Motion-JPEG or DV,
    // for which browsers ship no decoder. Depending on the browser the probe either
    // errors, times out, or "loads" and paints a black frame (so the player looks
    // broken / wrongly trips the unplayable banner). Skip it entirely and let our
    // own AVI parser render the frames + extracted audio (the catch block below).
    if (header.container === 'AVI') throw new Error('avi-use-parser');
    await new Promise((resolve, reject) => {
      probe.onloadeddata = resolve;
      probe.onerror = () => reject(new Error('format not supported'));
      setTimeout(() => reject(new Error('timeout')), 8000); // iOS can hang here; fall back to a visible player below
      probe.src = url;
    });
    // iOS/Safari renders a black frame for a video that has never played, so it
    // needs a brief muted play to get frame 0 on screen before we capture it.
    // Every other platform can draw frame 0 straight from `loadeddata`, so we
    // skip the playback there - no need to spin the video up just to grab a frame
    // (this is why videos used to briefly "play" while being analysed on desktop).
    if (isIOS()) {
      try { await probe.play(); } catch (_) {}
      await whenFramePainted(probe);
      probe.pause();
    } else {
      // Frame 0 is already decoded at `loadeddata`; one rAF lets it settle before
      // we drawImage() it. (whenFramePainted would wait on the *next* presented
      // frame, which never comes for a paused video - a needless 2s timeout.)
      await new Promise((r) => requestAnimationFrame(r));
    }
  } catch (_) {
    probe.remove();
    resultsEl.innerHTML = '';

    let avi = null;
    try { avi = await parseAviHeader(file); } catch (_) {}

    if (avi) {
      resultsEl.appendChild(el('div', { class: 'anr-info' },
        'Your browser cannot play this codec. Analysis extracted from file data. ' +
        'To play it now, open it in a free desktop player like VLC (videolan.org), which handles virtually every codec.'));

      const infoCard = el('div', { class: 'anr-card' });
      infoCard.appendChild(el('h3', {}, 'File info'));
      const tbl = el('table', { class: 'anr-readout' });
      tbl.appendChild(row('Name', file.name));
      tbl.appendChild(row('Size', `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`));
      tbl.appendChild(rowHelp('MIME', file.type || '-', "The standard label for a file's format, such as image/jpeg or audio/mpeg. The browser takes it from the file's name or the operating system, so it's a hint about the format, not proof."));
      tbl.appendChild(row('Container', header.container || 'AVI'));
      appendCreatorRows(tbl, header);
      if (avi.codec) tbl.appendChild(row('Video codec', avi.codec.toUpperCase()));
      if (avi.audioCodec) tbl.appendChild(row('Audio codec', avi.audioCodec.toUpperCase()));
      tbl.appendChild(row('Resolution', `${avi.width} × ${avi.height} px`));
      tbl.appendChild(row('Aspect ratio', aspectRatio(avi.width, avi.height)));
      if (avi.duration) tbl.appendChild(row('Duration', formatDuration(avi.duration)));
      if (avi.fps) tbl.appendChild(row('Frame rate', avi.fps + ' fps'));
      if (avi.totalFrames) tbl.appendChild(row('Total frames', avi.totalFrames.toLocaleString()));
      const bitrate = avi.duration && avi.duration > 0
        ? (file.size * 8 / avi.duration / 1000).toFixed(0) + ' kbps  (' + (file.size * 8 / avi.duration / 1_000_000).toFixed(2) + ' Mbps)'
        : '-';
      tbl.appendChild(rowHelp('Bitrate (total)', bitrate, 'How much data the whole file uses per second of playback - video, audio and packaging combined. Worked out as file size ÷ duration, so it is an overall average rather than the encoder’s target.'));
      if (avi.width && avi.height)
        tbl.appendChild(rowHelp('Frame size', ((avi.width * avi.height) / 1_000_000).toFixed(2) + ' MP', 'How many pixels make up each frame, in megapixels (width × height ÷ 1,000,000). A rough guide to how much detail each frame holds before compression.'));
      if (avi.audioFormat)
        tbl.appendChild(row('Audio', `${avi.audioFormat.sampleRate} Hz, ${avi.audioFormat.bitsPerSample}-bit, ${avi.audioFormat.channels}ch`));
      infoCard.appendChild(tbl);
      // infoCard is appended AFTER the Frames card below, so frames lead.

      let aviData = null;
      try { aviData = await extractAviData(file, avi); } catch (_) {}

      // MJPEG frame viewer. Only show it when the extracted chunks are genuine
      // JPEGs (SOI marker FF D8) - a non-MJPEG AVI (DV, etc.) yields raw chunks
      // that aren't displayable images, so skip the viewer and just show metadata.
      const framesAreJpeg = aviData && aviData.videoFrames.length &&
        new Uint8Array(aviData.videoFrames[0].slice(0, 2))[0] === 0xFF &&
        new Uint8Array(aviData.videoFrames[0].slice(0, 2))[1] === 0xD8;
      if (framesAreJpeg) {
        const frames = aviData.videoFrames;
        const frameCard = el('div', { class: 'anr-card' });
        frameCard.appendChild(el('h3', {}, 'Frames'));
        frameCard.appendChild(el('p', { class: 'anr-hint' },
          frames.length + ' MJPEG frame' + (frames.length > 1 ? 's' : '') + ' extracted'));

        const frameImg = el('img', {
          style: 'max-width:100%; max-height:480px; display:block; border:1px solid var(--hairline); background:#0a0a0a;',
          alt: 'Frame 1'
        });
        frameImg.src = URL.createObjectURL(new Blob([frames[0]], { type: 'image/jpeg' }));
        frameCard.appendChild(frameImg);

        let currentFrame = 0;
        let onFrameShown = null;   // set by the playback controls to sync the scrubber
        const frameLabel = el('span', { class: 'anr-hint' }, `Frame 1 / ${frames.length}`);
        function showFrame(idx) {
          currentFrame = idx;
          URL.revokeObjectURL(frameImg.src);
          frameImg.src = URL.createObjectURL(new Blob([frames[idx]], { type: 'image/jpeg' }));
          frameImg.alt = `Frame ${idx + 1}`;
          frameLabel.textContent = `Frame ${idx + 1} / ${frames.length}`;
          if (onFrameShown) onFrameShown(idx);
        }

        const lastIdx = frames.length - 1;
        const fps = (avi.fps && avi.fps > 0 && avi.fps <= 120) ? avi.fps : 15;
        const frameMs = 1000 / fps;
        const fmtTc = (sec) => formatDuration(sec);

        // The AVI's own PCM audio (when present) plays in sync with the frames -
        // it becomes the master clock and the frames follow it. Same decoded PCM
        // the Sound section offers; encoded to a WAV the <audio> element can play.
        const hasAudio = !!(aviData && aviData.audioBuffer);
        let frameAudioEl = null, audioDur = 0;
        if (hasAudio) {
          const wavUrl = URL.createObjectURL(encodeWav(aviData.audioBuffer));
          frameAudioEl = el('audio', { src: wavUrl });
          frameAudioEl.style.display = 'none';
          frameAudioEl.loop = true;
          audioDur = aviData.audioBuffer.duration;
          frameCard.appendChild(frameAudioEl);
          renderSignal.addEventListener('abort', () => { try { frameAudioEl.pause(); } catch (_) {} URL.revokeObjectURL(wavUrl); });
        }
        const totalTime = hasAudio ? audioDur : frames.length / fps;
        // Timestamp of a frame. With sound we spread the frames evenly across the
        // audio's real duration (so they stay synced even if the header frame rate
        // is missing or wrong); silent clips use the nominal fps.
        const frameTimeOf = (idx) => hasAudio
          ? (lastIdx > 0 ? (idx / lastIdx) * audioDur : 0)
          : idx / fps;
        const frameAtTime = (t) => hasAudio
          ? Math.round((audioDur > 0 ? t / audioDur : 0) * lastIdx)
          : Math.round(t * fps);

        // Seek to a frame, keeping the audio clock aligned to it.
        const seekToFrame = (idx) => {
          idx = Math.max(0, Math.min(lastIdx, idx));
          if (hasAudio) { try { frameAudioEl.currentTime = Math.min(audioDur, frameTimeOf(idx)); } catch (_) {} }
          showFrame(idx);
        };

        const prevBtn = el('button', { type: 'button', class: 'anr-btn', onclick: () => seekToFrame(currentFrame - 1) }, '← Prev');
        const nextBtn = el('button', { type: 'button', class: 'anr-btn', onclick: () => seekToFrame(currentFrame + 1) }, 'Next →');
        const analyseBtn = el('button', { type: 'button', class: 'anr-btn', onclick: () => {
          const blob = new Blob([frames[currentFrame]], { type: 'image/jpeg' });
          const frameFile = new File([blob], `frame_${currentFrame}.jpg`, { type: 'image/jpeg' });
          const photoResults = vctx.photoTarget();
          if (photoResults) {
            renderPhoto(frameFile, photoResults, vctx.photoOpts(undefined));
            vctx.afterPhoto();
          }
        }}, 'Analyse frame');
        // Frame grab: download the current JPEG frame as-is.
        const grabBtn = el('button', { type: 'button', class: 'anr-btn', onclick: () => {
          downloadBlob((file.name || 'video').replace(/\.[^.]+$/, '') + `_frame_${currentFrame}.jpg`,
            new Blob([frames[currentFrame]], { type: 'image/jpeg' }));
        }}, 'Frame grab');

        // Contact sheet (>= 8 frames) - built here so it shares the action row.
        let sheetBtn = null;
        const sheetOut = el('div');
        if (frames.length >= 8) {
          sheetBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Generate contact sheet');
          sheetBtn.addEventListener('click', async () => {
            sheetBtn.disabled = true;
            sheetBtn.textContent = 'Generating…';
            const cols = 4, rows = 2, total = cols * rows;
            const tw = Math.round(avi.width * (320 / Math.max(avi.width, avi.height)));
            const th = Math.round(avi.height * (320 / Math.max(avi.width, avi.height)));
            const pad = 4;
            const gridCanvas = document.createElement('canvas');
            gridCanvas.width = cols * tw + (cols + 1) * pad;
            gridCanvas.height = rows * th + (rows + 1) * pad;
            const ctx = gridCanvas.getContext('2d');
            ctx.fillStyle = '#111';
            ctx.fillRect(0, 0, gridCanvas.width, gridCanvas.height);
            for (let i = 0; i < total; i++) {
              const fi = Math.floor(i * (frames.length - 1) / (total - 1));
              const img = new Image();
              img.src = URL.createObjectURL(new Blob([frames[fi]], { type: 'image/jpeg' }));
              await new Promise(r => { img.onload = r; img.onerror = r; });
              const c = i % cols, r = Math.floor(i / cols);
              ctx.drawImage(img, pad + c * (tw + pad), pad + r * (th + pad), tw, th);
              URL.revokeObjectURL(img.src);
            }
            sheetOut.innerHTML = '';
            sheetOut.appendChild(sheetImg(gridCanvas.toDataURL('image/png')));
            sheetBtn.disabled = false;
            sheetBtn.textContent = 'Generate contact sheet';
          });
        }

        // Analyse frame · Frame grab · Generate contact sheet - all one row.
        const actionBtns = [analyseBtn, grabBtn];
        if (sheetBtn) actionBtns.push(sheetBtn);
        const actionRow = el('div', { class: 'anr-btn-row', style: 'margin-top:10px;' }, actionBtns);

        // A single still has nothing to play or scrub - just the action row.
        // Multiple frames get a real transport (play / scrub / time) plus frame
        // stepping, built below.
        if (frames.length === 1) {
          frameCard.appendChild(actionRow);
        } else {
          // Frame playback: the browser can't decode MJPEG-in-AVI, so step through
          // the already-extracted JPEG frames. With sound, the AVI's audio is the
          // master clock and the frames follow it; silent clips step on an fps
          // timer and loop. Either way every tick decodes a full JPEG, so a big,
          // fast, long clip can hit the CPU hard; warn when that's likely.
          const mpPerSec = ((avi.width * avi.height) / 1_000_000) * fps;
          const heavy = mpPerSec > 120 || frames.length > 600;

          // Reuse the site's stylised transport (.anr-player) - the same play
          // button, draggable fill track and time readout the audio/video players
          // use - driven by the frame index (and the audio clock when present).
          const playBtn = el('button', { type: 'button', class: 'anr-player-play', 'aria-label': 'Play' }, '▶');
          const fillEl = el('div', { class: 'anr-player-fill' });
          const trackEl = el('div', { class: 'anr-player-track' }, [fillEl]);
          const timeEl = el('span', { class: 'anr-player-time' }, `${fmtTc(0)} / ${fmtTc(totalTime)}`);
          const playerBar = el('div', { class: 'anr-player', style: 'margin-top:10px;' }, [playBtn, trackEl, timeEl]);

          let playing = false;
          let rafId = 0;
          let lastTs = 0;
          // Runtime frame drops: when decoding/painting a JPEG can't keep up with the
          // target rate, playback has to skip ahead to stay in sync. We count those
          // skipped frames and surface them on the counter line (hidden at zero).
          let droppedFrames = 0;
          const dropOut = el('span', { class: 'anr-frame-drops', hidden: 'hidden' }, '');
          const bumpDrops = (n) => {
            if (!playing || n <= 0) return;
            if (n > fps * 2) return;   // a multi-second leap is a tab-switch/seek, not a decode hiccup
            droppedFrames += n;
            dropOut.hidden = false;
            dropOut.textContent = ` · ${droppedFrames} dropped`;
          };
          const setFrameFromTime = (t) => {
            const idx = Math.max(0, Math.min(lastIdx, frameAtTime(t)));
            if (idx !== currentFrame) {
              bumpDrops(idx - currentFrame - 1);   // a forward jump past +1 means frames were skipped
              showFrame(idx);
            }
          };
          const stop = () => {
            playing = false;
            if (rafId) cancelAnimationFrame(rafId);
            rafId = 0;
            if (hasAudio) { try { frameAudioEl.pause(); } catch (_) {} }
            playBtn.textContent = '▶';
            playBtn.setAttribute('aria-label', 'Play');
          };
          const loop = (ts) => {
            if (!playing) return;
            if (hasAudio) {
              setFrameFromTime(frameAudioEl.currentTime);   // audio drives the frame
            } else if (ts - lastTs >= frameMs) {
              // Catch up to wall-clock: advance as many frames as actually elapsed
              // (carrying the sub-frame remainder) so a slow tick skips ahead and
              // stays in real time rather than drifting. Each extra step is a drop.
              const steps = Math.floor((ts - lastTs) / frameMs);
              lastTs += steps * frameMs;
              bumpDrops(steps - 1);
              const next = currentFrame + steps;
              showFrame(next > lastIdx ? next % (lastIdx + 1) : next);
            }
            rafId = requestAnimationFrame(loop);
          };
          playBtn.addEventListener('click', () => {
            if (playing) { stop(); return; }
            playing = true;
            lastTs = 0;
            droppedFrames = 0; dropOut.hidden = true; dropOut.textContent = '';
            playBtn.textContent = '❚❚';
            playBtn.setAttribute('aria-label', 'Pause');
            if (hasAudio) {
              if (frameAudioEl.currentTime >= audioDur - 0.05) { try { frameAudioEl.currentTime = 0; } catch (_) {} }
              frameAudioEl.play().catch(() => {});
            }
            rafId = requestAnimationFrame((ts) => { lastTs = ts; loop(ts); });
          });

          // Click or drag the track to seek frames (and audio) together - the same
          // gesture as the audio/video scrubber (makePlayer). Window listeners live
          // only during a drag so they don't pile up across files.
          const seekFromX = (clientX) => {
            const rect = trackEl.getBoundingClientRect();
            const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            seekToFrame(Math.round(frac * lastIdx));
          };
          let dragging = false;
          const onMove = (e) => { if (dragging) seekFromX(e.clientX); };
          const onUp = () => { dragging = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
          trackEl.addEventListener('mousedown', (e) => {
            dragging = true; stop(); seekFromX(e.clientX); e.preventDefault();
            window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
          });
          const onTMove = (e) => { if (dragging && e.touches[0]) { e.preventDefault(); seekFromX(e.touches[0].clientX); } };
          const onTEnd = () => { dragging = false; window.removeEventListener('touchmove', onTMove); window.removeEventListener('touchend', onTEnd); };
          trackEl.addEventListener('touchstart', (e) => {
            dragging = true; stop(); seekFromX(e.touches[0].clientX); e.preventDefault();
            window.addEventListener('touchmove', onTMove, { passive: false }); window.addEventListener('touchend', onTEnd);
          }, { passive: false });

          // Keep the fill, counter and timecode in step with every frame change
          // (play, Prev/Next, or a direct seek). Time is the frame's own timestamp.
          onFrameShown = (idx) => {
            const t = frameTimeOf(idx);
            setPlayerFill(fillEl, totalTime > 0 ? t / totalTime : 0);
            timeEl.textContent = `${fmtTc(t)} / ${fmtTc(totalTime)}`;
          };
          // Tearing down the render (new file / navigation) must kill the loop.
          renderSignal.addEventListener('abort', stop);

          frameCard.appendChild(playerBar);

          // Sound toggle: when the AVI carries PCM audio it stays the master clock
          // either way (so the frames keep their sync); this only mutes/unmutes what
          // you hear. Same segmented control the rest of the site uses.
          if (hasAudio) {
            const soundToggle = el('div', { class: 'anr-toggle' });
            const soundOnBtn = el('button', { type: 'button', class: 'is-active' }, 'SOUND');
            const soundOffBtn = el('button', { type: 'button' }, 'MUTED');
            soundToggle.appendChild(soundOnBtn); soundToggle.appendChild(soundOffBtn);
            const setSound = (on) => {
              frameAudioEl.muted = !on;
              soundOnBtn.classList.toggle('is-active', on);
              soundOffBtn.classList.toggle('is-active', !on);
            };
            soundOnBtn.addEventListener('click', () => setSound(true));
            soundOffBtn.addEventListener('click', () => setSound(false));
            frameCard.appendChild(el('div', { style: 'margin-top:8px; text-align:center;' }, [soundToggle]));
          }

          // Frame counter + rate (and whether sound is along for the ride), centered.
          frameCard.appendChild(el('p', { class: 'anr-hint', style: 'margin-top:4px; text-align:center;' },
            [frameLabel, document.createTextNode(` · ${fps} fps${hasAudio ? '' : ' · loop'}`), dropOut]));
          // Symmetric frame stepping: Prev | Next.
          frameCard.appendChild(el('div', { class: 'anr-frame-grid', style: 'margin-top:10px;' }, [prevBtn, nextBtn]));
          if (heavy) {
            frameCard.appendChild(el('p', { class: 'anr-hint', style: 'margin-top:8px; color: var(--accent);' },
              '⚠ Heavy playback: this clip is large enough (' +
              (avi.width + '×' + avi.height) + ' at ' + fps + ' fps) that looping it may stutter or ' +
              'spike CPU. Step through with Prev / Next if it struggles.'));
          }
          frameCard.appendChild(actionRow);
        }
        // Contact-sheet output (if any) lands under the action row.
        frameCard.appendChild(sheetOut);
        resultsEl.appendChild(frameCard);

        // ---- Reverse playback (re-encode the AVI backwards, on demand) ----
        // The MJPEG frames + PCM are in memory, but a downloadable reversed video
        // needs a real file, so re-encode the original AVI to a reversed H.264 MP4
        // (picture + sound) with FFmpeg - same path as the normal player.
        if (frames.length > 1) resultsEl.appendChild(buildReverseVideoCard(file, renderSignal));

        // Current frame - gated behind an "Analyse photo" button. The frame is read
        // at click time from wherever the frame viewer is parked (currentFrame), not
        // fixed at frame 0.
        const photoResultsEl = vctx.photoTarget();
        if (photoResultsEl) {
          mountPhotoAnalyseButton(photoResultsEl, () => {
            const idx = Math.max(0, Math.min(currentFrame | 0, frames.length - 1));
            const blob = new Blob([frames[idx]], { type: 'image/jpeg' });
            const frameFile = new File([blob], `frame_${idx}.jpg`, { type: 'image/jpeg' });
            renderPhoto(frameFile, photoResultsEl, vctx.photoOpts({ sourceNote: 'Frame ' + idx + ' of ' + (file.name || 'the video') + '.' }));
          });
        }
      }

      // File info comes AFTER the Frames section (frames lead).
      resultsEl.appendChild(infoCard);

      // Audio from direct PCM extraction - gated behind an "Analyse audio" button.
      const audioResultsEl = vctx.audioTarget();
      if (audioResultsEl && aviData && aviData.audioBuffer) mountAudioAnalyseButton(audioResultsEl, async () => {
        audioResultsEl.hidden = false;
        const audioBuf = aviData.audioBuffer;
        // The AVI's PCM is already decoded (aviData.audioBuffer), so wrap it in a WAV
        // and hand it straight to the real audio renderer - same full Sound section
        // as a dropped audio file (see the MP4 path above for the rationale).
        const basename = (file.name || 'video').replace(/\.[^/.]+$/, '') + '_audio';
        const wavBlob = new Blob([encodeWav(audioBuf)], { type: 'audio/wav' });
        const audioFile = new File([wavBlob], basename + '.wav', { type: 'audio/wav' });
        await renderAudio(audioFile, audioResultsEl, {
          inline: true, audioBuffer: audioBuf, playbackFile: audioFile,
          declaredLossless: false, download: true, downloadLabel: 'Download audio (WAV)',
        });
      });

      // SHA-256
      if (file.size <= HASH_FILE_MAX) {
        resultsEl.appendChild(integrityCard(file));
      }

      return;
    }

    // Not an AVI we can decode - but the probe may simply have failed on iOS.
    // Try a real visible player before declaring the file unplayable.
    const shownFallback = await renderVisibleVideoFallback(file, url, header, resultsEl, renderSignal);
    if (shownFallback) return;

    // The browser genuinely can't decode this codec (ProRes, DNxHD, etc.). Show
    // the container/codec metadata and a clear explanation instead of a bare error,
    // and try to pull the first visible frame out with FFmpeg.
    await renderUnplayableVideoInfo(file, header, resultsEl, renderSignal);
    return;
  }

  const vw = probe.videoWidth;
  const vh = probe.videoHeight;
  const dur = probe.duration;

  resultsEl.innerHTML = '';

  // Capture the first frame once, here - reused for the section-meta thumbnail
  // AND the player poster so the first frame shows immediately on load (the
  // <video> can otherwise render black until played, especially on iOS).
  let posterUrl = '';
  if (vw && vh) {
    const pcv = document.createElement('canvas');
    const pscale = Math.min(1, 1280 / Math.max(vw, vh));
    pcv.width = Math.round(vw * pscale);
    pcv.height = Math.round(vh * pscale);
    pcv.getContext('2d').drawImage(probe, 0, 0, pcv.width, pcv.height);
    posterUrl = pcv.toDataURL('image/jpeg', 0.85);
  }

  // ---- Mini player in section-meta (desktop only, hidden by CSS on mobile) ----
  // A small synced player of the same clip: click to play, and it stays locked to
  // the main Player and the gyro mini-player via registerSyncedVideo (in
  // applyVideoControls). The poster shows frame 0 before it plays.
  const previewSlot = vctx.previewTarget();
  if (previewSlot && (posterUrl || vw)) {
    previewSlot.innerHTML = '';
    const thumb = el('div', { class: 'section-meta-preview' });
    const mini = el('video', { src: url, poster: posterUrl, playsinline: '', preload: 'metadata' });
    mini.setAttribute('webkit-playsinline', '');
    mini.muted = true;                   // muted: only the main Player makes sound (avoids echo)
    applyVideoControls(mini);            // click-to-play + registers it for cross-player sync
    // Site-styled transport (no volume control), overlaid on the video and shown on hover.
    const miniPlayer = el('div', { class: 'section-meta-player anr-video-hoverui' },
      [mini, makePlayer(mini, undefined, { noVolume: true })]);
    thumb.appendChild(miniPlayer);
    thumb.appendChild(el('p', { class: 'section-meta-preview-caption' },
      `${vw} × ${vh} · ${formatDuration(dur)} · ${fmtBytes(file.size)}`));
    previewSlot.appendChild(thumb);
  } else {
    clearVideoPreviewBoot();   // no preview to mount - don't strand the loading bar
  }

  // Frame 0, captured now from the probe (full-res) - kept only as a fallback for
  // the "Analyse photo" button while the visible player is still parked at the
  // start with no decoded frame to grab. The button itself is mounted after the
  // player is built (below), and prefers the player's CURRENT frame at click time.
  const photoResultsEl = vctx.photoTarget();
  let firstFrameFile = null;
  if (photoResultsEl && vw && vh) {
    const fcv = document.createElement('canvas');
    fcv.width = vw; fcv.height = vh;
    fcv.getContext('2d').drawImage(probe, 0, 0, vw, vh);
    fcv.toBlob(blob => { if (blob) firstFrameFile = new File([blob], 'frame_0.000s.png', { type: 'image/png' }); }, 'image/png');
  }

  // NOTE: the probe is intentionally kept alive here. It already decodes this
  // file off-screen, so scene detection seeks IT instead of the visible player -
  // letting the user scrub/play freely while analysis runs. It's torn down once
  // detection finishes (or on abort, via the handler registered above).

  // ---- Player ----
  const playerCard = el('div', { class: 'anr-card', style: 'position:relative;' });
  playerCard.appendChild(el('h3', {}, 'Player'));
  // playsinline keeps playback inline on iPhone instead of forcing fullscreen;
  // the poster shows the captured first frame right away.
  const playerEl = el('video', { src: url, playsinline: '', poster: posterUrl });
  playerEl.setAttribute('webkit-playsinline', '');
  playerEl.style.cssText = 'width:100%; max-height:480px; background:#0a0a0a; display:block; border:1px solid var(--hairline);';
  applyVideoControls(playerEl);
  playerCard.appendChild(playerEl);
  playerCard.appendChild(makePlayer(playerEl));
  // Sony (and other) clips carry PCM audio browsers can't decode, so the video
  // plays mute - extract that audio and play it in sync underneath. Background.
  attachPcmAudioCompanion(file, playerCard, renderSignal);
  // Non-blocking status badge shown while background scene detection runs on the
  // off-screen probe. It doesn't capture pointer events, so the player stays
  // fully interactive (scrub/play) underneath it.
  const sceneBadge = el('div', { class: 'anr-video-analysing' }, 'Analysing…');
  playerCard.appendChild(sceneBadge);

  // ---- Frame-by-frame navigation, editable timecode, and frame grab ----
  let detectedFps = 30;
  const frameControls = buildFrameControls(playerEl, () => detectedFps, file);
  playerCard.appendChild(frameControls.wrap);

  resultsEl.appendChild(playerCard);

  // Analyse photo -> the CURRENT frame of the player (wherever it has been scrubbed
  // or played to), captured at click time. While the player is still parked at the
  // very start it may have no decoded frame to grab, so fall back to the full-res
  // frame 0 captured from the probe above.
  if (photoResultsEl && vw && vh) {
    mountPhotoAnalyseButton(photoResultsEl, () => {
      let lastPhotoHeight = photoResultsEl.offsetHeight;
      const photoScrollComp = new ResizeObserver(() => {
        const newHeight = photoResultsEl.offsetHeight;
        const delta = newHeight - lastPhotoHeight;
        if (delta > 0) window.scrollBy(0, delta);
        lastPhotoHeight = newHeight;
      });
      photoScrollComp.observe(photoResultsEl);
      renderSignal.addEventListener('abort', () => photoScrollComp.disconnect());

      const t = playerEl.currentTime || 0;
      const live = playerEl.readyState >= 2 && playerEl.videoWidth && t > 0.001;
      if (live) {
        const cv = document.createElement('canvas');
        cv.width = playerEl.videoWidth; cv.height = playerEl.videoHeight;
        try {
          cv.getContext('2d').drawImage(playerEl, 0, 0, cv.width, cv.height);
          cv.toBlob(blob => {
            const f = blob ? new File([blob], `frame_${t.toFixed(3)}s.png`, { type: 'image/png' }) : firstFrameFile;
            if (f) renderPhoto(f, photoResultsEl, vctx.photoOpts({ sourceNote: 'Frame captured at ' + t.toFixed(3) + 's from ' + (file.name || 'the video') + '.' }));
          }, 'image/png');
          return;
        } catch (_) { /* tainted/undecoded - fall through to frame 0 */ }
      }
      if (firstFrameFile) renderPhoto(firstFrameFile, photoResultsEl, vctx.photoOpts({ sourceNote: 'First frame of ' + (file.name || 'the video') + '.' }));
    });
  }

  // ---- File info ----
  // For a remuxed raw stream, show the ORIGINAL file's name/size/MIME (and base
  // the bitrate on it) - the .mp4 we built is just a playback wrapper.
  const infoFile = opts.sourceFile || file;
  const infoCard = el('div', { class: 'anr-card' });
  infoCard.appendChild(el('h3', {}, 'File info'));
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Name', infoFile.name));
  tbl.appendChild(row('Size', `${fmtBytes(infoFile.size)}   (${infoFile.size.toLocaleString()} bytes)`));
  tbl.appendChild(rowHelp('MIME', infoFile.type || '-', "The standard label for a file's format, such as image/jpeg or audio/mpeg. The browser takes it from the file's name or the operating system, so it's a hint about the format, not proof."));
  if (opts.sourceFile && opts.converted)
    tbl.appendChild(rowHelp('Source', opts.sourceCodec || 'Original codec',
      'Your browser could not play the original format, so Analyser converted it to H.264 (MP4) on your device using FFmpeg. Converting loses a little quality, so this copy is for viewing and analysis, not for keeping as a master.'));
  else if (opts.sourceFile)
    tbl.appendChild(rowHelp('Source', 'Raw ' + (opts.sourceKind || 'H.264') + ' (Annex B)',
      'A raw ' + (opts.sourceKind || 'H.264') + ' stream has no container to hold it, so Analyser wrapped it in an MP4 on your device without re-encoding, just to play it. The stream carries no timing information, so the frame rate and length are assumed to be 25 fps.'));
  if (header.container)
    tbl.appendChild(row('Container', (
      opts.sourceFile && opts.converted ? (opts.sourceCodec || 'Original') + ' → H.264 / MP4 (converted)'
        : opts.sourceFile ? 'Raw ' + (opts.sourceKind || 'H.264') + ' → MP4 (remuxed)'
          : header.container + (header.brand ? '  (' + header.brand + ')' : ''))));
  appendCreatorRows(tbl, header);
  // Codec / dimensions / rotation / HDR from the ISOBMFF moov walk of the ORIGINAL
  // file. Best-effort and guarded so it never affects fps/preview.
  let isoTracks = null;
  try {
    if (/^(MP4|M4V|QuickTime MOV|3GP|3G2)/.test(header.container || '') || /MP4 \//.test(header.container || ''))
      isoTracks = await detectIsobmffTracks(analysisFile);
  } catch (_) {}
  // For a converted proxy (which may be downscaled), show the ORIGINAL stored
  // dimensions, not the decoded proxy frame size. For a normal file keep the
  // player's dimensions (they already reflect any rotation).
  const origV = isoTracks && isoTracks.video;
  const useOrigDim = analysisFile !== file && origV && origV.width;
  const dispW = useOrigDim ? origV.width : vw;
  const dispH = useOrigDim ? origV.height : vh;
  tbl.appendChild(row('Resolution', dispW && dispH ? `${dispW} × ${dispH} px` : '-'));
  tbl.appendChild(row('Aspect ratio', aspectRatio(dispW, dispH)));
  tbl.appendChild(row('Duration', isFinite(dur) ? formatDuration(dur) + (opts.sourceFile && !opts.converted ? ' (assumed 25 fps)' : '') : '-'));
  const bitrate = isFinite(dur) && dur > 0
    ? (infoFile.size * 8 / dur / 1000).toFixed(0) + ' kbps  (' + (infoFile.size * 8 / dur / 1_000_000).toFixed(2) + ' Mbps)'
    : '-';
  tbl.appendChild(rowHelp('Bitrate (total)', bitrate, 'How much data the whole file uses per second of playback - video, audio and packaging combined. Worked out as file size ÷ duration, so it is an overall average rather than the encoder’s target.'));
  const fpsRow = row('Frame rate', 'detecting…');
  tbl.appendChild(fpsRow);
  if (dispW && dispH) {
    const mp = ((dispW * dispH) / 1_000_000).toFixed(2);
    tbl.appendChild(rowHelp('Frame size', mp + ' MP', 'How many pixels make up each frame, in megapixels (width × height ÷ 1,000,000). A rough guide to how much detail each frame holds before compression.'));
  }
  try { appendTrackRows(tbl, isoTracks); } catch (_) {}
  infoCard.appendChild(tbl);
  resultsEl.appendChild(infoCard);

  const fpsCell = fpsRow.querySelector('td');
  // Show the ORIGINAL file's frame rate in File info (the proxy may be fps-capped).
  detectFps(analysisFile, fpsCell).then((fps) => {
    fpsCell.textContent = fps != null ? fps + ' fps' : 'N/A';
    if (analysisFile === file && fps != null) { detectedFps = fps; frameControls.refresh(); }
  });
  // Frame stepping runs on the playable file, so step at ITS actual frame rate.
  if (analysisFile !== file) {
    detectFps(file).then((fps) => { if (fps != null) { detectedFps = fps; frameControls.refresh(); } });
  }

  // ---- Metadata via exifr (of the original file) ----
  let exif = null;
  try {
    if (window.exifr) {
      exif = await window.exifr.parse(analysisFile, {
        tiff: true, exif: true, gps: true, xmp: true,
        mergeOutput: true, translateValues: true, translateKeys: true,
        reviveValues: true, sanitize: true, silentErrors: true
      });
    }
  } catch (_) {}

  if (exif) {
    const metaRows = [];
    if (exif.Make)             metaRows.push(['Make', exif.Make]);
    if (exif.Model)            metaRows.push(['Model', exif.Model]);
    if (exif.Software)         metaRows.push(['Software', exif.Software]);
    if (exif.DateTimeOriginal) metaRows.push(['Taken', fmtDate(exif.DateTimeOriginal)]);
    if (exif.CreateDate)       metaRows.push(['Created', fmtDate(exif.CreateDate)]);
    if (exif.ModifyDate)       metaRows.push(['Modified', fmtDate(exif.ModifyDate)]);
    if (exif.ImageDescription || exif.description)
      metaRows.push(['Description', exif.ImageDescription || exif.description]);
    if (exif.Copyright || exif.rights)
      metaRows.push(['Copyright', exif.Copyright || exif.rights]);

    if (metaRows.length) {
      const metaCard = el('div', { class: 'anr-card' });
      metaCard.appendChild(el('h3', {}, 'Metadata'));
      const mt = el('table', { class: 'anr-readout' });
      for (const [k, v] of metaRows) mt.appendChild(row(k, v));
      metaCard.appendChild(mt);
      resultsEl.appendChild(metaCard);
    }

    if (exif.latitude != null && exif.longitude != null) {
      const gpsCard = el('div', { class: 'anr-card' });
      gpsCard.appendChild(el('h3', {}, 'GPS'));
      const gt = el('table', { class: 'anr-readout' });
      gt.appendChild(row('Latitude', exif.latitude.toFixed(6) + '°'));
      gt.appendChild(row('Longitude', exif.longitude.toFixed(6) + '°'));
      if (exif.GPSAltitude != null)
        gt.appendChild(row('Altitude', (+exif.GPSAltitude).toFixed(1) + ' m'));
      gpsCard.appendChild(gt);
      gpsCard.appendChild(el('p', {}, [
        '> open in ',
        el('a', {
          href: `https://www.openstreetmap.org/?mlat=${exif.latitude}&mlon=${exif.longitude}#map=15/${exif.latitude}/${exif.longitude}`,
          target: '_blank'
        }, 'OpenStreetMap'),
        ' / ',
        el('a', {
          href: `https://www.google.com/maps?q=${exif.latitude},${exif.longitude}`,
          target: '_blank'
        }, 'Google Maps')
      ]));
      resultsEl.appendChild(gpsCard);
    }
  }

  // Sony gyro / IMU metadata (rtmd track) - read from the ORIGINAL (a converted
  // proxy has no rtmd track), but the Motion timeline's mini player mounts the
  // playable `file` so it still plays when the original codec can't decode here.
  await appendSonyGyroCard(analysisFile, resultsEl, file);

  // GoPro GPMF / CAMM telemetry (GPS track + gyro/accelerometer) or a single
  // container GPS point - from the ORIGINAL file (FFmpeg strips the timed-metadata
  // track from the proxy). The single-point card is suppressed when the exifr GPS
  // card above already showed coordinates.
  if (full) {
    // GPMF/CAMM/container-location, each re-reading the moov and walking up to
    // MAX_CHUNKS sequential slices. Yield first: the player and the metadata cards
    // are already on screen and the reader may be scrolling them.
    await yieldToMain();
    const hasExifGps = !!(exif && exif.latitude != null && exif.longitude != null);
    try { await appendTelemetryCards(analysisFile, resultsEl, { hasExifGps, playFile: file }); } catch (_) {}
  }

  // ---- Contact sheet / thumbnail grid ----
  if (vw && vh) {
    const sheetCard = el('div', { class: 'anr-card' });
    const [shH, shHelp] = h3help('Contact sheet', 'A 4×2 grid of 8 thumbnails taken at even intervals across the video, giving you a quick visual overview of the whole thing at a glance - like a photographer’s contact sheet.');
    sheetCard.appendChild(shH); sheetCard.appendChild(shHelp);
    // Marked so the data export can find this card and force the sheet to be
    // generated (via _anrEnsure below) before it scrapes the page.
    sheetCard.classList.add('anr-contact-sheet-card');
    const sheetBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Generate contact sheet');
    const sheetOut = el('div');

    async function buildSheet() {
      const cols = 4, rows = 2, total = cols * rows;
      const thumbW = Math.round(vw * (320 / Math.max(vw, vh)));
      const thumbH = Math.round(vh * (320 / Math.max(vw, vh)));
      const pad = 4;
      const gridW = cols * thumbW + (cols + 1) * pad;
      const gridH = rows * thumbH + (rows + 1) * pad;

      const gridCanvas = document.createElement('canvas');
      gridCanvas.width = gridW;
      gridCanvas.height = gridH;
      const ctx = gridCanvas.getContext('2d');
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, gridW, gridH);

      const safeDur = Math.max(0, dur - 0.1);

      const prog = stepLoader('Capturing frame 1 of ' + total + '…');
      sheetOut.innerHTML = '';
      sheetOut.appendChild(prog.node);

      let missed = 0;
      for (let i = 0; i < total; i++) {
        prog.set(i / total, 'Capturing frame ' + (i + 1) + ' of ' + total + '…');
        const t = total > 1 ? (safeDur * i) / (total - 1) : 0;
        // One retry a hair further in: a big file will often stall on one exact
        // position and come back on the next attempt.
        let ok = await seekAndPaint(playerEl, t);
        if (!ok) ok = await seekAndPaint(playerEl, Math.min(safeDur, t + 0.05));

        const c = i % cols;
        const r = Math.floor(i / cols);
        const x = pad + c * (thumbW + pad);
        const y = pad + r * (thumbH + pad);
        // A tile that couldn't be reached is left as bare background rather than
        // painted from the stale player, so a stalled seek shows up as a gap
        // instead of silently repeating the previous frame.
        if (ok) ctx.drawImage(playerEl, x, y, thumbW, thumbH);
        else missed++;
      }
      prog.set(1, 'Building the sheet…');

      const url = gridCanvas.toDataURL('image/png');
      sheetOut.innerHTML = '';
      sheetOut.appendChild(sheetImg(url));
      if (missed) sheetOut.appendChild(el('p', { class: 'anr-hint' },
        missed + ' of ' + total + ' frames could not be captured - the video stalled seeking to them. '
        + 'The blank tiles are those positions.'));

      const saveBtn = el('button', { type: 'button', class: 'anr-btn', style: 'margin-top:8px;', onclick: () => {
        const a = document.createElement('a');
        a.href = url;
        a.download = (file.name || 'video').replace(/\.[^/.]+$/, '') + '_contact_sheet.png';
        a.click();
      }}, 'Save as PNG');
      sheetOut.appendChild(saveBtn);
    }

    // Generate at most once; reuse the in-flight or finished promise. The button
    // and the data export both go through this.
    let sheetDone = false, sheetPromise = null;
    function ensureSheet() {
      if (sheetDone) return Promise.resolve();
      if (sheetPromise) return sheetPromise;
      sheetBtn.disabled = true;
      sheetBtn.textContent = 'Generating…';
      sheetPromise = buildSheet()
        .then(() => { sheetDone = true; })
        .catch(() => { sheetPromise = null; sheetOut.innerHTML = ''; })
        .finally(() => { sheetBtn.disabled = false; sheetBtn.textContent = 'Generate contact sheet'; });
      return sheetPromise;
    }
    sheetBtn.addEventListener('click', ensureSheet);
    sheetCard._anrEnsure = ensureSheet;

    sheetCard.appendChild(el('div', { class: 'anr-btn-row' }, [sheetBtn]));
    sheetCard.appendChild(sheetOut);
    resultsEl.appendChild(sheetCard);

    // ---- Scene change detection (runs automatically) ----
    const sceneCard = el('div', { class: 'anr-card' });
    const [scH, scHelp] = h3help('Scene changes',
      'Checks the video at regular intervals and measures how much each frame differs from the one before. When the change is big enough it marks a scene change, with a score for how clear-cut it was. Runs automatically; click any thumbnail or timeline marker to jump there.');
    sceneCard.appendChild(scH); sceneCard.appendChild(scHelp);
    const sceneOut = el('div');
    sceneOut.appendChild(el('p', { class: 'anr-hint' }, 'Detecting scene changes…'));
    sceneCard.appendChild(sceneOut);
    resultsEl.appendChild(sceneCard);
    // The Content timeline is drawn from the per-sample colour/luma series the
    // scene-detection loop collects on the way past, so it has no scan of its own.
    // It gets a reserved slot here rather than being appended when it happens to
    // exist: on a large video, where detection doesn't auto-run, the card would
    // otherwise just never appear, with nothing on screen to say why.
    const ctSlot = el('div');
    resultsEl.appendChild(ctSlot);

    // Detection seeks a video element around, so it runs on an off-screen element
    // (never the visible player - the user can scrub/play while it runs). Large
    // videos can be slow to walk, so they don't auto-run: a button triggers them.
    function renderSceneResults(changes) {
      sceneOut.innerHTML = '';
      sceneOut.appendChild(el('p', { class: 'anr-hint', style: 'margin-bottom:10px;' },
        changes.length
          ? changes.length + ' scene change' + (changes.length > 1 ? 's' : '') + ' detected'
          : 'No scene changes detected'));
      if (changes.length && isFinite(dur) && dur > 0) {
        const timeline = el('div', { class: 'anr-scene-timeline' });
        for (const sc of changes) {
          const marker = el('div', {
            class: 'anr-scene-marker',
            style: 'left:' + (sc.time / dur) * 100 + '%;',
            title: formatDuration(sc.time) + '  ·  ' + sc.confidence + '% confidence'
          });
          marker.addEventListener('click', () => { playerEl.currentTime = sc.time; playerEl.pause(); });
          timeline.appendChild(marker);
        }
        sceneOut.appendChild(timeline);
        const details = el('details', { class: 'anr-scene-details' });
        details.appendChild(el('summary', {}, 'Thumbnails (' + changes.length + ')'));
        const grid = el('div', { class: 'anr-scene-grid' });
        for (const sc of changes) {
          const wrap = el('div', {
            class: 'anr-scene-thumb',
            onclick: () => { playerEl.currentTime = sc.time; playerEl.pause(); }
          });
          wrap.appendChild(el('img', { src: sc.thumbnail, alt: 'Scene change at ' + formatDuration(sc.time) }));
          wrap.appendChild(el('span', { class: 'anr-scene-meta' },
            formatDuration(sc.time) + ' · ' + sc.confidence + '%'));
          grid.appendChild(wrap);
        }
        details.appendChild(grid);
        sceneOut.appendChild(details);
      }
    }

    async function detectAndRender(videoEl, removeAfter) {
      const prog = stepLoader('Scanning for scene changes…');
      sceneOut.innerHTML = '';
      sceneOut.appendChild(prog.node);
      let changes = [];
      const contentSamples = [];
      try {
        changes = await detectSceneChanges(videoEl, 55, renderSignal, contentSamples,
          (f) => prog.set(f, 'Scanning for scene changes… ' + Math.round(f * 100) + '%'));
      } catch (_) {}
      if (removeAfter) { try { videoEl.removeAttribute('src'); videoEl.load(); } catch (_) {} videoEl.remove(); }
      sceneBadge.remove();
      if (renderSignal.aborted) return;
      renderSceneResults(changes);
      ctSlot.innerHTML = '';
      try {
        const ctCard = buildContentTimelineCard(contentSamples, dur, playerEl);
        if (ctCard) ctSlot.appendChild(ctCard);
      } catch (_) {}
    }

    // Spin up a fresh off-screen video (same trick as the probe) for on-demand runs.
    function makeAnalysisVideo() {
      const v = el('video', { class: 'anr-video-probe' });
      v.muted = true; v.defaultMuted = true;
      v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
      v.setAttribute('webkit-playsinline', ''); v.setAttribute('preload', 'auto');
      v.src = url;
      document.body.appendChild(v);
      renderSignal.addEventListener('abort', () => v.remove());
      return v;
    }

    const BIG_VIDEO_BYTES = 150 * 1024 * 1024;
    // Bitrate gates the auto-run as well as size, because bitrate is what the scan
    // actually costs. Every sample is a seek, and a seek makes the decoder rebuild
    // a whole GOP - so on camera-original footage (a Sony XAVC-S clip runs 50+ Mbps
    // with a 60-frame GOP) each one is expensive, and they land while the user is
    // trying to watch that very same file through a second decoder. Total size
    // misses this entirely: such a clip is often only tens of MB because it is
    // short. 10 Mbps sits above ordinary streaming/phone-share footage and below
    // camera originals.
    const AUTO_SCAN_MAX_BPS = 10e6;
    const bitrate = (isFinite(dur) && dur > 0) ? (file.size * 8) / dur : 0;
    const hotBitrate = bitrate > AUTO_SCAN_MAX_BPS;
    const bigVideo = file.size > BIG_VIDEO_BYTES || (isFinite(dur) && dur > 600) || hotBitrate;
    // Say which of the two actually stopped it, so the notice matches the file in
    // front of you rather than claiming a short 40 MB clip is "large".
    const skipWhy = (hotBitrate && file.size <= BIG_VIDEO_BYTES && !(isFinite(dur) && dur > 600))
      ? 'high-bitrate videos (' + (bitrate / 1e6).toFixed(0) + ' Mbps)'
      : 'large videos (' + (file.size / 1048576).toFixed(0) + ' MB)';
    if (bigVideo) {
      // Don't auto-run on big videos: free the probe and offer a manual trigger.
      try { probe.removeAttribute('src'); probe.load(); } catch (_) {}
      probe.remove();
      sceneBadge.remove();
      sceneOut.innerHTML = '';
      sceneOut.appendChild(el('p', { class: 'anr-hint', style: 'margin-bottom:8px;' },
        'Skipped automatically for ' + skipWhy + '. '
        + 'One scan fills this and the Content timeline below. Run it when you want:'));

      // One scan, two cards. Both triggers call this, and it is one-shot, so
      // clicking the second button after the first does nothing.
      let scanStarted = false;
      function startScan() {
        if (scanStarted) return;
        scanStarted = true;
        sceneRunBtn.remove();
        ctRunBtn.remove();
        ctSlot.innerHTML = '';
        const v = makeAnalysisVideo();
        // The 6s timeout is a fallback for a `loadeddata` that never comes, so it
        // must not fire a SECOND run when the event did arrive. Without this guard
        // both ran: two loops seeking the same element, the first finishing and
        // tearing the element down under the second, which then timed out on every
        // remaining sample and finally overwrote the good results (and the Content
        // timeline built from them) with its own mangled set.
        let started = false;
        const go = () => { if (started) return; started = true; detectAndRender(v, true); };
        if (isFinite(v.duration) && v.duration > 0) go();
        else { v.addEventListener('loadeddata', go, { once: true }); setTimeout(go, 6000); }
      }

      const sceneRunBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Detect scene changes');
      sceneRunBtn.addEventListener('click', startScan);
      sceneOut.appendChild(sceneRunBtn);

      // Stand-in Content timeline card, so the feature is visible (and runnable)
      // instead of silently absent on every large video.
      const ctWait = el('div', { class: 'anr-card' });
      const [ctH, ctHelp] = h3help('Content timeline',
        'A movie barcode - every sampled frame squeezed to a single stripe of its average colour, so the whole video reads as a colour-over-time fingerprint - plus a brightness curve flagging near-black frames and frozen or still stretches.');
      ctWait.appendChild(ctH); ctWait.appendChild(ctHelp);
      ctWait.appendChild(el('p', { class: 'anr-hint', style: 'margin-bottom:8px;' },
        'Read from the same scan as Scene changes, which is skipped automatically for '
        + skipWhy + '. Running either fills both.'));
      const ctRunBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Scan the video');
      ctRunBtn.addEventListener('click', startScan);
      ctWait.appendChild(el('div', { class: 'anr-btn-row' }, [ctRunBtn]));
      ctSlot.appendChild(ctWait);
    } else {
      (async () => {
        if (renderSignal.aborted) { probe.remove(); return; }
        await detectAndRender(probe, true);
      })();
    }
  }

  // ---- Audio track extraction (renders into the Sound section) ----
  // Gated behind an "Analyse audio" button so a full decode + spectrogram only
  // runs when the user asks for it, not automatically on every video.
  // (Skipped for raw H.264/H.265, which is a video-only elementary stream.)
  const audioResultsEl = vctx.audioTarget();
  if (audioResultsEl && !opts.noAudio) mountAudioAnalyseButton(audioResultsEl, async () => {
    audioResultsEl.hidden = false;

    // (No scroll compensation here: clicking "Analyse audio" deliberately scrolls
    // to the top of the Sound section, so keeping the video section pinned in view
    // - the old behaviour - would fight that and leave the view drifting down past
    // the audio heading as the heavy spectrogram content loads in.)

    const audioCard = el('div', { class: 'anr-card' });
    audioCard.appendChild(el('h3', {}, 'Audio track'));
    const audioStatus = el('p', { class: 'anr-info' }, 'Decoding audio from video…');
    audioCard.appendChild(audioStatus);
    audioResultsEl.appendChild(audioCard);

    try {
      const ac = getAudioCtx();
      const buf = await file.arrayBuffer();
      let audioBuf;
      try {
        audioBuf = await ac.decodeAudioData(buf.slice(0));
      } catch (_) {
        audioStatus.textContent = 'Trying PCM extraction…';
        audioBuf = extractPcmFromMp4(buf);
      }
      if (!audioBuf) {
        audioStatus.textContent = 'Web Audio failed, using FFmpeg…';
        audioBuf = await ffmpegExtractAudio(file, audioCard);
      }

      audioStatus.remove();

      // Hand the decoded PCM to the real audio renderer so this Sound section is
      // identical to a directly-dropped audio file - same cards, same order, full
      // forensics (see the primary MP4 path above for the rationale). renderAudio
      // clears audioResultsEl, replacing the status card in place.
      const basename = (file.name || 'video').replace(/\.[^/.]+$/, '') + '_audio';
      const wavBlob = new Blob([encodeWav(audioBuf)], { type: 'audio/wav' });
      const audioFile = new File([wavBlob], basename + '.wav', { type: 'audio/wav' });
      await renderAudio(audioFile, audioResultsEl, {
        inline: true, audioBuffer: audioBuf, playbackFile: audioFile,
        declaredLossless: false, download: true, downloadLabel: 'Download audio (WAV)',
      });
    } catch (e) {
      console.warn('Audio extraction failed:', e);
      audioStatus.remove();
      // renderAudio clears audioResultsEl, so re-attach the status card if the
      // failure landed after that (decode failures happen before it).
      if (!audioCard.isConnected) audioResultsEl.appendChild(audioCard);
      audioCard.appendChild(el('p', { class: 'anr-hint' },
        'Audio decode failed: ' + (e && e.message || 'unknown error') + '. Try converting to MP4 (H.264 + AAC).'));
    }
  });

  // ---- Reverse playback (re-encode the video backwards, on demand) ----
  // Sits just above Integrity, below the scene-change card.
  resultsEl.appendChild(buildReverseVideoCard(file, renderSignal));

  // ---- SHA-256 ----
  // Hash the ORIGINAL bytes (the raw .h264), not the remuxed MP4 wrapper.
  const hashFile = opts.sourceFile || file;
  if (hashFile.size <= HASH_FILE_MAX) {
    const hashCard = el('div', { class: 'anr-card' });
    const [vhH, vhHelp] = h3help('Integrity', '<strong>SHA-256</strong> is a cryptographic hash - a short fingerprint calculated from the file’s exact contents. Change even a single bit and the fingerprint comes out completely different, which makes it a reliable way to check a file has not been tampered with.');
    hashCard.appendChild(vhH); hashCard.appendChild(vhHelp);
    const hashTbl = el('table', { class: 'anr-readout' });
    hashTbl.appendChild(sha256Row(hashFile));
    hashCard.appendChild(hashTbl);
    resultsEl.appendChild(hashCard);
  }

  // ---- Advanced (ISOBMFF container structure + stream forensics) ----
  // Box tree, full track list, provenance tells, frames/bitrate map and
  // bitstream/authenticity. Reads the ORIGINAL file so the SPS, codec and structure
  // describe the user's file, not the H.264 proxy.
  //
  // Built HERE rather than up with the other container reads, even though it is
  // ordered after them: it is by far the most expensive await in this renderer
  // (several full moov buffers, two box-tree walks, a GOP map over every sample)
  // and its card displays LAST. Running it early bought nothing and delayed every
  // card below it - contact sheet, scene changes, audio, reverse, integrity - none
  // of which need it. Now everything else is on screen before it starts.
  await yieldToMain();
  if (full && !renderSignal.aborted) {
    try {
      const adv = await buildVideoAdvancedCard(analysisFile);
      if (adv && !renderSignal.aborted) resultsEl.appendChild(adv);
    } catch (_) { /* structure parse failed - skip the Advanced card */ }
  }
}

// ---------- setup ----------
export function initVideo({ dropEl, inputEl, resultsEl, onFile }) {
  const handle = onFile || ((file) => renderVideo(file, resultsEl));
  inputEl.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handle(file);
    inputEl.value = '';
  });
  ['dragenter', 'dragover'].forEach((ev) =>
    dropEl.addEventListener(ev, () => dropEl.classList.add('is-dragover'))
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dropEl.addEventListener(ev, () => dropEl.classList.remove('is-dragover'))
  );
}
