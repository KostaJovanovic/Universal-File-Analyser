/* Analyser - Sony rtmd (Real-Time MetaData) gyro / IMU extractor
   ============================================================================
   Sony Alpha / FX / RX cameras (A7, A6700, FX3, ...) write a timed-metadata
   track to their MP4 / MOV files whose sample format is 'rtmd'. Each rtmd
   sample (one per video frame) carries that frame's exposure / lens / GPS data
   *and* a burst of inertial-measurement samples - the gyroscope (angular rate)
   and accelerometer used by Catalyst Browse and Gyroflow to stabilise footage.

   The sample is a sequence of 2-byte-tag / 2-byte-length TLVs, big-endian,
   preceded by a u16 header length at offset 0 (0x1c). Tag 0x8300 is a container
   you descend into; tag 0x060e is a fixed 16-byte SMPTE key. The two IMU tags
   (reverse-engineered, cross-checked against ExifTool's Sony.pm Process_rtmd):
     - 0xe43b  Gyroscope (ExifTool calls it "PitchRollYaw")
     - 0xe44b  Accelerometer
   Each value is an 8-byte header [u32 count][u32 stride=6] then count x (3 x
   int16): x, y, z. So a frame holds `count` IMU sub-samples (typically ~66,
   giving a ~2 kHz IMU rate at 30 fps). Accelerometer reads ~8192 counts per g
   (z sits near 8192 at rest); the gyro is in raw sensor counts (Gyroflow applies
   the camera-specific calibration to turn them into deg/s).

   Everything here is read with byte-range slices - we never buffer the whole
   video - and the whole thing is best-effort: any failure returns null so the
   normal video analysis is untouched. */

import { el, row, rowHelp, h3help } from '../core/util.js';
import { registerSyncedVideo, getAudioOwner, getAudioCompanion } from '../core/video-sync.js';
import { makePlayer } from './audio-player.js';

const ACCEL_LSB_PER_G = 8192;       // Sony accelerometer scale (z ~ 1 g at rest)
const MAX_FRAMES = 600;             // cap rtmd samples read for the trace (decimated when exceeded)
const MAX_MOOV = 32 * 1024 * 1024;  // sanity cap on the moov we'll buffer

const fcc = (dv, p) => String.fromCharCode(dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2), dv.getUint8(p + 3));

// Parse the immediate child boxes in [start,end) of a DataView. Handles 64-bit
// extended sizes and size==0 (runs to end).
function parseBoxes(dv, start, end) {
  const out = [];
  let p = start;
  while (p + 8 <= end) {
    let size = dv.getUint32(p);
    const type = fcc(dv, p + 4);
    let hs = 8;
    if (size === 1) { size = dv.getUint32(p + 8) * 0x100000000 + dv.getUint32(p + 12); hs = 16; }
    else if (size === 0) { size = end - p; }
    if (size < 8 || p + size > end) break;
    out.push({ type, offset: p, size, headerSize: hs });
    p += size;
  }
  return out;
}

// Recursive box search (same container set the video renderer uses).
function findAllBoxes(dv, start, end, type) {
  const result = [], stack = [{ s: start, e: end }];
  const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'meta']);
  while (stack.length) {
    const { s, e } = stack.pop();
    for (const b of parseBoxes(dv, s, e)) {
      if (b.type === type) result.push(b);
      if (containers.has(b.type)) stack.push({ s: b.offset + b.headerSize, e: b.offset + b.size });
    }
  }
  return result;
}

// Locate the moov box, which may sit at the head or the tail of the file.
async function findMoov(file) {
  if (file.size < 12) return null;
  const head = new DataView(await file.slice(0, Math.min(file.size, 64)).arrayBuffer());
  if (fcc(head, 4) !== 'ftyp') return null;
  let pos = 0;
  while (pos + 8 <= file.size) {
    const dv = new DataView(await file.slice(pos, pos + 16).arrayBuffer());
    if (dv.byteLength < 8) break;
    let size = dv.getUint32(0);
    const type = fcc(dv, 4);
    if (size === 1 && dv.byteLength >= 16) size = dv.getUint32(8) * 0x100000000 + dv.getUint32(12);
    if (size < 8) break;
    if (type === 'moov') return { offset: pos, size };
    pos += size;
  }
  return null;
}

// Read the sample table for a track (stbl) into absolute file offsets + sizes.
function sampleTable(dv, trakStart, trakEnd) {
  const box = (t) => findAllBoxes(dv, trakStart, trakEnd, t)[0];
  const stsz = box('stsz'), stsc = box('stsc'), stco = box('stco'), co64 = box('co64'), stts = box('stts');
  if (!stsz || !stsc || !(stco || co64)) return null;
  const p = (b) => b.offset + b.headerSize;
  // stsz: ver/flags(4) sample_size(4) count(4) [sizes]
  let o = p(stsz) + 4;
  const uniform = dv.getUint32(o); const count = dv.getUint32(o + 4); o += 8;
  const sizes = new Array(count);
  for (let i = 0; i < count; i++) sizes[i] = uniform || dv.getUint32(o + i * 4);
  // chunk offsets
  const offsets = [];
  if (stco) { let q = p(stco) + 4; const n = dv.getUint32(q); q += 4; for (let i = 0; i < n; i++) offsets.push(dv.getUint32(q + i * 4)); }
  else { let q = p(co64) + 4; const n = dv.getUint32(q); q += 4; for (let i = 0; i < n; i++) offsets.push(dv.getUint32(q + i * 8) * 0x100000000 + dv.getUint32(q + i * 8 + 4)); }
  // stsc: ver/flags(4) count(4) [first_chunk, samples_per_chunk, desc]
  let s = p(stsc) + 4; const sc = dv.getUint32(s); s += 4;
  const runs = [];
  for (let i = 0; i < sc; i++) runs.push([dv.getUint32(s + i * 12), dv.getUint32(s + i * 12 + 4)]);
  // map samples to chunk offsets
  const samples = [];
  let si = 0;
  for (let ci = 0; ci < offsets.length && si < count; ci++) {
    let spc = 1;
    for (let k = 0; k < runs.length; k++) if (runs[k][0] - 1 <= ci) spc = runs[k][1];
    let at = offsets[ci];
    for (let j = 0; j < spc && si < count; j++) { samples.push([at, sizes[si]]); at += sizes[si]; si++; }
  }
  // frame rate from stts + mdhd timescale
  let timescale = 0;
  const mdhd = box('mdhd');
  if (mdhd) { const d = p(mdhd); const ver = dv.getUint8(d); timescale = ver === 1 ? dv.getUint32(d + 20) : dv.getUint32(d + 12); }
  let totalDelta = 0, totalSamp = 0;
  if (stts) { let t = p(stts) + 4; const n = dv.getUint32(t); t += 4; for (let i = 0; i < n; i++) { const c = dv.getUint32(t + i * 8), del = dv.getUint32(t + i * 8 + 4); totalSamp += c; totalDelta += c * del; } }
  const fps = (timescale && totalDelta) ? timescale * totalSamp / totalDelta : 0;
  return { samples, fps };
}

// Pull the 0x... TLV map out of one rtmd sample (Sony Process_rtmd walk).
function rtmdTags(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const end = buf.length;
  const tags = {};
  let pos = dv.getUint16(0);          // header length (0x1c)
  while (pos + 4 < end) {
    const tag = dv.getUint16(pos);
    if (tag === 0) break;
    let len = dv.getUint16(pos + 2);
    if (tag === 0x060e) { len = 0x10; }
    else { pos += 4; if (tag === 0x8300) continue; }   // descend into container
    if (pos + len > end) break;
    if (tags[tag] === undefined) tags[tag] = [pos, len];
    pos += len;
  }
  return { dv, tags };
}

// Read an IMU tag's int16 triples (skips the 8-byte [count][stride] header).
function imuTriples(dv, span) {
  if (!span) return null;
  const [start, len] = span;
  const out = [];
  for (let o = start + 8; o + 6 <= start + len; o += 6) {
    out.push([dv.getInt16(o), dv.getInt16(o + 2), dv.getInt16(o + 4)]);
  }
  return out.length ? out : null;
}

const WB = { 1: 'Incandescent', 2: 'Fluorescent', 4: 'Daylight', 5: 'Cloudy', 6: 'Custom / Shade', 255: 'Preset' };

// Decode a small set of friendly scalar fields from the first sample.
function scalarFields(dv, tags) {
  const f = {};
  const u32 = (t) => tags[t] && dv.getUint32(tags[t][0]);
  const u8 = (t) => tags[t] && dv.getUint8(tags[t][0]);
  const iso = u32(0xe301); if (iso) f.ISO = iso;
  const wb = u8(0xe303); if (wb != null && WB[wb]) f['White balance'] = WB[wb];
  if (tags[0xe304]) {                 // DateTime: skip 1, BCD yyyy mm dd hh mm ss
    const d = tags[0xe304][0], hx = (o, n) => { let s = ''; for (let i = 0; i < n; i++) s += dv.getUint8(o + i).toString(16).padStart(2, '0'); return s; };
    const yr = hx(d + 1, 2), mo = hx(d + 3, 1), da = hx(d + 4, 1), hh = hx(d + 5, 1), mm = hx(d + 6, 1), ss = hx(d + 7, 1);
    if (/^\d{4}$/.test(yr)) f['Recorded'] = `${yr}-${mo}-${da} ${hh}:${mm}:${ss}`;
  }
  return f;
}

// Locate the rtmd track and return its sample table { samples, fps }, or null.
async function openRtmd(file) {
  const moov = await findMoov(file);
  if (!moov || moov.size > MAX_MOOV) return null;
  const dv = new DataView(await file.slice(moov.offset, moov.offset + moov.size).arrayBuffer());
  for (const trak of findAllBoxes(dv, 8, moov.size, 'trak')) {
    const ts = trak.offset + trak.headerSize, te = Math.min(trak.offset + trak.size, moov.size);
    const stsd = findAllBoxes(dv, ts, te, 'stsd')[0];
    if (!stsd) continue;
    const entry = stsd.offset + stsd.headerSize + 8;     // ver/flags(4)+count(4)
    if (entry + 8 > moov.size) continue;
    if (fcc(dv, entry + 4) !== 'rtmd') continue;
    const table = sampleTable(dv, ts, te);
    if (table && table.samples.length) return table;
  }
  return null;
}

// Read + decode one rtmd sample into gyro / accel int16 triples + scalar fields.
async function readImuSample(file, off, len) {
  let buf;
  try { buf = new Uint8Array(await file.slice(off, off + len).arrayBuffer()); } catch (_) { return null; }
  const { dv, tags } = rtmdTags(buf);
  return { g: imuTriples(dv, tags[0xe43b]), a: imuTriples(dv, tags[0xe44b]), scalars: scalarFields(dv, tags) };
}

// ---------------------------------------------------------------------------
// Extract a decimated gyro + accel series (for the on-screen chart). Returns
// null if there's no rtmd track.
export async function extractSonyGyro(file) {
  const table = await openRtmd(file);
  if (!table) return null;
  const total = table.samples.length;
  const stride = Math.max(1, Math.ceil(total / MAX_FRAMES));
  const fps = table.fps || 30;

  const gyro = { x: [], y: [], z: [] }, accel = { x: [], y: [], z: [] }, t = [];
  let perFrame = 0, hasGyro = false, hasAccel = false, scalars = null;

  for (let fi = 0; fi < total; fi += stride) {
    const s = await readImuSample(file, table.samples[fi][0], table.samples[fi][1]);
    if (!s) continue;
    if (!scalars) scalars = s.scalars;
    const g = s.g, a = s.a, n = Math.max(g ? g.length : 0, a ? a.length : 0);
    if (!n) continue;
    perFrame = Math.max(perFrame, n);
    if (g) hasGyro = true;
    if (a) hasAccel = true;
    // Per sub-sample: push a point. Decimate sub-samples too if a frame is huge.
    const sub = Math.max(1, Math.ceil(n / 80));
    for (let i = 0; i < n; i += sub) {
      t.push((fi + i / n) / fps);
      const gi = g && g[i]; const ai = a && a[i];
      gyro.x.push(gi ? gi[0] : 0); gyro.y.push(gi ? gi[1] : 0); gyro.z.push(gi ? gi[2] : 0);
      accel.x.push(ai ? ai[0] / ACCEL_LSB_PER_G : 0); accel.y.push(ai ? ai[1] / ACCEL_LSB_PER_G : 0); accel.z.push(ai ? ai[2] / ACCEL_LSB_PER_G : 0);
    }
  }
  if (!hasGyro && !hasAccel) return null;

  return {
    frames: total, sampled: Math.ceil(total / stride), perFrame, fps,
    imuRate: perFrame * fps, durationSec: total / fps,
    hasGyro, hasAccel, gyro, accel, t,
    scalars: scalars || {},
  };
}

// ---------------------------------------------------------------------------
// Full-resolution IMU dump for export: every sub-sample of every frame, raw
// int16, with the original time stamp. Used by the CSV / Gyroflow exporters.
const MAX_EXPORT_FRAMES = 36000;   // ~20 min at 30 fps - guards memory on huge clips

export async function collectSonyImu(file, onProgress) {
  const table = await openRtmd(file);
  if (!table) return null;
  const fps = table.fps || 30;
  const total = Math.min(table.samples.length, MAX_EXPORT_FRAMES);
  const rows = [];
  let perFrame = 0, hasGyro = false, hasAccel = false;
  for (let fi = 0; fi < total; fi++) {
    if (onProgress && fi % 32 === 0) onProgress(fi, total);
    const s = await readImuSample(file, table.samples[fi][0], table.samples[fi][1]);
    if (!s) continue;
    const g = s.g, a = s.a, n = Math.max(g ? g.length : 0, a ? a.length : 0);
    if (!n) continue;
    perFrame = Math.max(perFrame, n);
    if (g) hasGyro = true;
    if (a) hasAccel = true;
    for (let i = 0; i < n; i++) {
      const gi = g && g[i], ai = a && a[i];
      rows.push({
        t: (fi + i / n) / fps,
        gx: gi ? gi[0] : 0, gy: gi ? gi[1] : 0, gz: gi ? gi[2] : 0,
        ax: ai ? ai[0] : 0, ay: ai ? ai[1] : 0, az: ai ? ai[2] : 0,
      });
    }
  }
  if (onProgress) onProgress(total, total);
  if (!rows.length) return null;
  return { fps, perFrame, rows, frames: total, totalFrames: table.samples.length, truncated: table.samples.length > total, hasGyro, hasAccel };
}

// ---- Export formats ----
const G_PER_LSB = 1 / ACCEL_LSB_PER_G;                 // accel raw -> g (Sony ±4 g over int16)
const GYRO_DPS_PER_LSB = 2000 / 32768;                 // assumed ±2000 deg/s full scale
const GYRO_RAD_PER_LSB = GYRO_DPS_PER_LSB * Math.PI / 180;

// Plain CSV: time + raw gyro + accelerometer in g. Universally readable.
function toCSV(full) {
  const out = [
    '# Sony rtmd IMU export - Analyser',
    '# gyro_* = raw sensor counts; accel_*_g = g (raw / ' + ACCEL_LSB_PER_G + ')',
    '# samples: ' + full.rows.length + ', rate ~' + Math.round(full.perFrame * full.fps) + ' Hz',
    'time_s,gyro_x,gyro_y,gyro_z,accel_x_g,accel_y_g,accel_z_g',
  ];
  for (const r of full.rows) {
    out.push(r.t.toFixed(6) + ',' + r.gx + ',' + r.gy + ',' + r.gz + ',' +
      (r.ax * G_PER_LSB).toFixed(6) + ',' + (r.ay * G_PER_LSB).toFixed(6) + ',' + (r.az * G_PER_LSB).toFixed(6));
  }
  return out.join('\n');
}

// Gyroflow .gcsv: raw integer samples with scale factors in the header. Loads
// straight into Gyroflow and other gcsv-aware stabilisers.
function toGCSV(full, name) {
  const out = [
    'GYROFLOW IMU LOG',
    'version,1.3',
    'id,' + (name || 'sony_rtmd'),
    'orientation,XYZ',
    'tscale,1.0',
    'gscale,' + GYRO_RAD_PER_LSB,
    'ascale,' + G_PER_LSB,
    't,gx,gy,gz,ax,ay,az',
  ];
  for (const r of full.rows) {
    out.push(r.t.toFixed(6) + ',' + r.gx + ',' + r.gy + ',' + r.gz + ',' + r.ax + ',' + r.ay + ',' + r.az);
  }
  return out.join('\n');
}

function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------------------------------------------------------------------------
// Visualisation: a card with stats + line traces for gyro and accelerometer.
const range = (arrs) => { let lo = Infinity, hi = -Infinity; for (const a of arrs) for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; } return [lo, hi]; };

const TRACE_COLORS = ['#e0533a', '#3ba776', '#3b82c4'];   // x/pitch, y/roll, z/yaw
const MAX_CANVAS_W = 30000;                               // browser canvas width ceiling

const fmtSec = (s) => (s >= 60 ? Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0')
  : (Number.isInteger(s) ? s + 's' : s.toFixed(s < 1 ? 2 : 1) + 's'));

// Nice time-grid tick positions (seconds) so labels stay ~60 px apart at this zoom.
function timeGrid(duration, trackW) {
  const pps = trackW / (duration || 1);
  const STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600];
  const step = STEPS.find((s) => s * pps >= 60) || STEPS[STEPS.length - 1];
  const out = [];
  for (let t = 0; t <= duration + 1e-6; t += step) out.push(t);
  return out;
}

// Paint gyro (top) + accel (bottom) line plots onto a dark canvas across the
// full (possibly zoomed) track width. Time maps left->right; one white playhead
// (a sibling element) overlays both. Mirrors the spectrogram's wide-canvas model.
function drawGyroCanvas(canvas, d, trackW, H, duration) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(trackW * dpr));
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0b0d10'; ctx.fillRect(0, 0, trackW, H);

  const both = d.hasGyro && d.hasAccel;
  const regions = [];
  if (d.hasGyro) regions.push({ top: 0, h: both ? H / 2 : H, series: [d.gyro.x, d.gyro.y, d.gyro.z], name: d.gyroName || 'Gyroscope (raw counts)' });
  if (d.hasAccel) regions.push({ top: both ? H / 2 : 0, h: both ? H / 2 : H, series: [d.accel.x, d.accel.y, d.accel.z], name: d.accelName || 'Accelerometer (g)' });
  const x = (t) => (duration > 0 ? t / duration : 0) * trackW;
  const ticks = timeGrid(duration, trackW);

  for (const r of regions) {
    const padT = r.top + 16, padB = r.top + r.h - 14;
    const [lo, hi] = range(r.series);
    const pad = (hi - lo) * 0.08 || 1;
    const ylo = lo - pad, yhi = hi + pad, span = (yhi - ylo) || 1;
    const y = (v) => padT + (1 - (v - ylo) / span) * (padB - padT);

    if (r.top > 0) { ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, r.top + 0.5); ctx.lineTo(trackW, r.top + 0.5); ctx.stroke(); }
    // time gridlines + labels
    ctx.font = '9.5px ui-monospace, SFMono-Regular, Menlo, monospace';
    for (const tk of ticks) {
      const gx = x(tk);
      ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(gx, padT); ctx.lineTo(gx, padB + 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.fillText(fmtSec(tk), gx + 3, r.top + r.h - 3);
    }
    // zero baseline
    if (ylo < 0 && yhi > 0) { ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.beginPath(); ctx.moveTo(0, y(0)); ctx.lineTo(trackW, y(0)); ctx.stroke(); }
    // series polylines
    for (let si = 0; si < 3; si++) {
      const data = r.series[si];
      ctx.strokeStyle = TRACE_COLORS[si]; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 0; i < data.length; i++) { const px = x(d.t[i]), py = y(data[i]); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
      ctx.stroke();
    }
    // region label + range
    ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(r.name, 6, r.top + 12);
    ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.font = '9.5px ui-monospace, SFMono-Regular, Menlo, monospace';
    const dec = Math.max(Math.abs(hi), Math.abs(lo)) < 10 ? 2 : 0;
    ctx.fillText(hi.toFixed(dec) + ' / ' + lo.toFixed(dec), 6, r.top + 24);
  }
}

// A horizontally-zoomable gyro/accel timeline with a white playhead. With a file
// it mounts a small synced video player above the graph and the playhead tracks
// (and scrubs) playback; without one it's a standalone viewer whose playhead
// follows the pointer on hover. Styling lives in analyser.css (.anr-imu-*).
export function buildImuTimeline(d, file) {
  const wrap = el('div', { class: 'anr-imu' });
  const duration = d.durationSec || (d.t.length ? d.t[d.t.length - 1] : 1);

  // --- optional synced mini player ---
  let video = null;
  if (file) {
    const url = URL.createObjectURL(file);
    // Bare <video> + the site's own makePlayer transport (no native browser
    // controls), so it matches the main Player rather than looking foreign.
    video = el('video', { src: url, playsinline: '', preload: 'metadata', class: 'anr-imu-video' });
    video.setAttribute('webkit-playsinline', '');
    video.muted = true;
    video.style.cursor = 'pointer';
    video.addEventListener('click', () => { if (video.paused) video.play(); else video.pause(); });
    registerSyncedVideo(video);          // sync with the main Player and any other players
    wrap.appendChild(video);
    // Same transport as the main Player (play / seek / time / volume). It starts
    // muted; pressing play on it makes it the audio owner (exclusive audio) so you
    // hear exactly the clip whose motion the white line is tracking.
    wrap.appendChild(makePlayer(video, undefined, {}));
  }

  // --- zoom control ---
  const ZOOMS = ['1', '1.5', '2', '3', '4', '6', '8', '12', '16', '24', '32', '48'];
  const zoomSel = el('select', { class: 'anr-select anr-imu-zoom' }, ZOOMS.map((v) => el('option', { value: v }, v + 'x')));
  zoomSel.value = '1';
  wrap.appendChild(el('div', { class: 'anr-imu-ctl' }, [
    el('span', { class: 'anr-imu-ctl-label' }, 'Zoom'), zoomSel,
    el('span', { class: 'anr-hint anr-imu-ctl-hint' }, video
      ? 'ctrl/⌘ + scroll to zoom · drag to scrub · the white line tracks the video'
      : 'ctrl/⌘ + scroll to zoom · hover to inspect'),
  ]));

  // --- zoomable canvas + playhead ---
  const H = (d.hasGyro && d.hasAccel) ? 300 : 168;
  const canvas = el('canvas', { class: 'anr-imu-canvas', style: 'height:' + H + 'px' });
  const playhead = el('div', { class: 'anr-imu-playhead' });
  const track = el('div', { class: 'anr-imu-track', style: 'height:' + H + 'px' });
  track.appendChild(canvas); track.appendChild(playhead);
  const scroller = el('div', { class: 'anr-imu-scroller' });
  scroller.appendChild(track);
  wrap.appendChild(scroller);

  let zoom = 1, trackW = 0, hoverTime = 0;
  const baseW = () => Math.max(220, (scroller.clientWidth || 700) - 2);
  // Drive the line from whatever is actually making the sound the user hears, so
  // it can't drift from the audio. Priority: the audio companion (the extracted
  // PCM <audio> that plays under a muted video for codecs browsers can't decode -
  // it has its own startup/decode lag, so following the video clock instead would
  // run the line ahead of the sound), then the audio owner, then this element.
  const clock = () => (video ? (getAudioCompanion() || getAudioOwner() || video) : null);
  const curDur = () => { const c = clock(); return (c && isFinite(c.duration) && c.duration > 0) ? c.duration : duration; };
  const curTime = () => { const c = clock(); return c ? c.currentTime : hoverTime; };

  function place(follow) {
    const x = (curDur() > 0 ? curTime() / curDur() : 0) * trackW;
    playhead.style.left = x + 'px';
    if (follow && video && !video.paused) {
      const vw = scroller.clientWidth, left = scroller.scrollLeft;
      if (x < left + vw * 0.1 || x > left + vw * 0.85) scroller.scrollLeft = Math.max(0, x - vw * 0.2);
    }
  }
  function layout() {
    trackW = Math.min(MAX_CANVAS_W, Math.round(baseW() * zoom));
    track.style.width = trackW + 'px';
    canvas.style.width = trackW + 'px';
    drawGyroCanvas(canvas, d, trackW, H, duration);
    place(false);
  }
  if (video) {
    const loop = () => { place(true); if (!video.paused && !video.ended) requestAnimationFrame(loop); };
    video.addEventListener('play', () => requestAnimationFrame(loop));
    video.addEventListener('timeupdate', () => { if (video.paused) place(false); });
    video.addEventListener('seeked', () => place(false));
  }

  // Zoom anchored on the pointer (or viewport centre), keeping that time fixed.
  function setZoom(z, anchorClientX) {
    const rect = scroller.getBoundingClientRect();
    const off = anchorClientX != null ? anchorClientX - rect.left : scroller.clientWidth / 2;
    const anchorFrac = (scroller.scrollLeft + off) / Math.max(1, trackW);
    zoom = Math.min(48, Math.max(1, z));
    zoomSel.value = ZOOMS.reduce((p, c) => Math.abs(+c - zoom) < Math.abs(+p - zoom) ? c : p, '1');
    layout();
    scroller.scrollLeft = anchorFrac * trackW - off;
  }
  zoomSel.addEventListener('change', () => setZoom(parseFloat(zoomSel.value)));
  scroller.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX); } }, { passive: false });

  // With a video: drag/click the graph to scrub. Without: hover moves the playhead.
  const fracAt = (clientX) => Math.max(0, Math.min(1, (clientX - scroller.getBoundingClientRect().left + scroller.scrollLeft) / Math.max(1, trackW)));
  if (video) {
    let scrubbing = false;
    const seekAt = (clientX) => { video.currentTime = fracAt(clientX) * curDur(); place(false); };
    scroller.addEventListener('pointerdown', (e) => { scrubbing = true; try { scroller.setPointerCapture(e.pointerId); } catch (_) {} seekAt(e.clientX); });
    scroller.addEventListener('pointermove', (e) => { if (scrubbing) seekAt(e.clientX); });
    const endScrub = (e) => { scrubbing = false; try { scroller.releasePointerCapture(e.pointerId); } catch (_) {} };
    scroller.addEventListener('pointerup', endScrub);
    scroller.addEventListener('pointercancel', endScrub);
  } else {
    scroller.addEventListener('pointermove', (e) => { hoverTime = fracAt(e.clientX) * duration; place(false); });
  }

  if (typeof ResizeObserver !== 'undefined') {
    let lw = -1;
    new ResizeObserver(() => { if (scroller.clientWidth !== lw) { lw = scroller.clientWidth; layout(); } }).observe(scroller);
  }
  requestAnimationFrame(layout);
  return wrap;
}

export function buildGyroCard(d, file) {
  const card = el('div', { class: 'anr-card' });
  const [h, help] = h3help('Gyro & motion metadata',
    'Sony cameras record a per-frame inertial-measurement burst (gyroscope + accelerometer) in the MP4 "rtmd" timed-metadata track. '
    + 'Analyser walks that track and decodes the raw IMU samples - the same data Gyroflow and Catalyst Browse read to stabilise footage. '
    + 'Gyroscope is shown in raw sensor counts; accelerometer is scaled to g (about 8192 counts per g).');
  card.appendChild(h); card.appendChild(help);

  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Source', 'Sony rtmd (Real-Time MetaData) track'));
  tbl.appendChild(rowHelp('Gyroscope', d.hasGyro ? 'Present' : 'Not found',
    'Three-axis angular-rate (pitch / roll / yaw) samples, used for stabilisation in Gyroflow and Catalyst Browse.'));
  tbl.appendChild(rowHelp('Accelerometer', d.hasAccel ? 'Present' : 'Not found',
    'Three-axis acceleration samples. At rest one axis reads about 1 g (gravity).'));
  tbl.appendChild(row('Frames', d.frames.toLocaleString() + (d.sampled < d.frames ? ` (${d.sampled.toLocaleString()} sampled)` : '')));
  if (d.perFrame) tbl.appendChild(rowHelp('IMU samples / frame', String(d.perFrame), 'How many inertial samples the camera packs into each video frame.'));
  if (d.imuRate) tbl.appendChild(rowHelp('IMU rate', '~' + Math.round(d.imuRate).toLocaleString() + ' Hz', 'Approximate inertial-sensor sampling rate (samples per frame × frame rate).'));
  if (d.fps) tbl.appendChild(row('Frame rate', (Math.round(d.fps * 100) / 100) + ' fps'));
  if (d.durationSec) tbl.appendChild(row('Duration', d.durationSec.toFixed(1) + ' s'));
  for (const k in d.scalars) tbl.appendChild(row(k, d.scalars[k]));
  card.appendChild(tbl);

  if ((d.hasGyro || d.hasAccel) && d.t.length) {
    card.appendChild(buildImuTimeline(d, file || null));
    card.appendChild(el('div', { style: 'margin:4px 0 2px' }, [
      el('span', { class: 'anr-hint', style: 'margin:0' }, 'Colours: '),
      el('span', { style: 'color:#e0533a' }, d.hasGyro ? 'pitch / X' : 'X'), el('span', { class: 'anr-hint', style: 'margin:0' }, ' · '),
      el('span', { style: 'color:#3ba776' }, d.hasGyro ? 'roll / Y' : 'Y'), el('span', { class: 'anr-hint', style: 'margin:0' }, ' · '),
      el('span', { style: 'color:#3b82c4' }, d.hasGyro ? 'yaw / Z' : 'Z'),
      el('span', { class: 'anr-hint', style: 'margin:0' }, '  -  gyroscope in raw counts (top), accelerometer in g (bottom).'),
    ]));
  }

  // ---- Export ----
  if (file && (d.hasGyro || d.hasAccel)) {
    let cached = null;                       // collected once, reused by both buttons
    const baseName = (file.name || 'video').replace(/\.[^.]+$/, '');
    const status = el('span', { class: 'anr-hint', style: 'margin:0' }, '');
    const run = async (btn, kind) => {
      const csvBtn = btn; csvBtn.disabled = true; const label = csvBtn.textContent;
      try {
        if (!cached) {
          status.textContent = 'reading full-resolution IMU…';
          cached = await collectSonyImu(file, (done, total) => { status.textContent = 'reading… ' + Math.round(done / total * 100) + '%'; });
        }
        if (!cached) { status.textContent = 'no IMU data to export'; return; }
        if (kind === 'csv') downloadText(baseName + '-gyro.csv', toCSV(cached));
        else downloadText(baseName + '.gcsv', toGCSV(cached, baseName));
        status.textContent = cached.rows.length.toLocaleString() + ' samples exported'
          + (cached.truncated ? ' (truncated to first ' + cached.frames.toLocaleString() + ' frames)' : '');
      } catch (_) {
        status.textContent = 'export failed';
      } finally { csvBtn.disabled = false; csvBtn.textContent = label; }
    };
    const csvBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Export CSV');
    const gcsvBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Export Gyroflow (.gcsv)');
    csvBtn.addEventListener('click', () => run(csvBtn, 'csv'));
    gcsvBtn.addEventListener('click', () => run(gcsvBtn, 'gcsv'));
    card.appendChild(el('div', { class: 'anr-btn-row', style: 'gap:8px;margin-top:12px;flex-wrap:wrap;align-items:center' }, [csvBtn, gcsvBtn, status]));
    card.appendChild(el('p', { class: 'anr-hint', style: 'margin-top:6px' },
      'CSV holds raw gyro plus accelerometer in g for any tool or spreadsheet. The .gcsv loads into Gyroflow and other stabilisers, '
      + 'then you bring the stabilised clip into your video editor. The accelerometer scale is exact; the gyro scale assumes Sony’s '
      + '±2000°/s range, so for the most precise stabilisation import the original file into Gyroflow directly - it reads this Sony gyro natively.'));
  }
  return card;
}

// Convenience: extract and append the card if a Sony gyro track is present.
export async function appendSonyGyroCard(file, resultsEl) {
  try {
    const d = await extractSonyGyro(file);
    if (d) resultsEl.appendChild(buildGyroCard(d, file));
    return !!d;
  } catch (_) { return false; }
}
