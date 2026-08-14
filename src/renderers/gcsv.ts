/* Analyser - Gyroflow .gcsv IMU log viewer
   ============================================================================
   A .gcsv is Gyroflow's generic IMU-log interchange format (the same format
   Analyser exports from a Sony video's gyro track). It's a small text file:

     GYROFLOW IMU LOG
     version,1.3
     id,my_cam
     orientation,XYZ
     tscale,0.001
     gscale,0.00122
     ascale,0.000122
     t,gx,gy,gz,ax,ay,az
     0,12,-4,3,0,1,8192
     ...

   A header of key,value lines (the *scale factors convert the raw columns into
   real units), then a column-header line beginning with `t`, then the samples.
   We apply tscale -> seconds, gscale -> rad/s (shown as deg/s), ascale -> g,
   then reuse the gyro/accel timeline viewer from sony-rtmd.js. */

import { el, row, rowHelp, h3help, fmtBytes, integrityCard, errorCard } from '../core/util.js';
import { buildImuTimeline } from './sony-rtmd.js';
import { SCAN_MED } from '../core/limits.js';

const MAX_TEXT = SCAN_MED;     // don't read absurdly large logs whole
const MAX_POINTS = 4000;               // decimate the trace to keep the canvas cheap
const RAD2DEG = 180 / Math.PI;

function parseGcsv(text: string) {
  const lines = text.split(/\r?\n/);
  const meta: Record<string, any> = { tscale: 1, gscale: 1, ascale: 1, id: '', version: '', orientation: '' };
  let cols: string[]|null = null, dataStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim();
    if (!ln) continue;
    if (/imu\s*log/i.test(ln) && i < 3) continue;          // "GYROFLOW IMU LOG" banner
    const parts = ln.split(/[,\t]/).map((s: string) => s.trim());
    if (parts[0].toLowerCase() === 't') { cols = parts.map((s: string) => s.toLowerCase()); dataStart = i + 1; break; }
    if (parts.length >= 2) {
      const k = parts[0].toLowerCase(), v = parts.slice(1).join(',').trim();
      if (k in meta) meta[k] = (k === 'tscale' || k === 'gscale' || k === 'ascale') ? (parseFloat(v) || 1) : v;
    }
  }
  if (!cols) return null;

  const ix = (name: string) => cols.indexOf(name);
  const it = ix('t');
  const ig = ['gx', 'gy', 'gz'].map(ix), ia = ['ax', 'ay', 'az'].map(ix);
  const hasGyro = ig.every((k) => k >= 0), hasAccel = ia.every((k) => k >= 0);
  if (it < 0 || (!hasGyro && !hasAccel)) return null;

  // First pass over data rows -> typed columns (raw), then decimate.
  const rowsT: number[] = [], rg: number[][] = [[], [], []], ra: number[][] = [[], [], []];
  for (let i = dataStart; i < lines.length; i++) {
    const ln = lines[i].trim();
    if (!ln) continue;
    const p = ln.split(/[,\t ]+/);
    const t = parseFloat(p[it]);
    if (!isFinite(t)) continue;
    rowsT.push(t * meta.tscale);
    if (hasGyro) for (let a = 0; a < 3; a++) rg[a].push((parseFloat(p[ig[a]]) || 0) * meta.gscale * RAD2DEG);
    if (hasAccel) for (let a = 0; a < 3; a++) ra[a].push((parseFloat(p[ia[a]]) || 0) * meta.ascale);
  }
  const n = rowsT.length;
  if (!n) return null;

  const t0 = rowsT[0];
  const stride = Math.max(1, Math.ceil(n / MAX_POINTS));
  const t: number[] = [], gyro: Record<string, number[]> = { x: [], y: [], z: [] }, accel: Record<string, number[]> = { x: [], y: [], z: [] };
  const ax = ['x', 'y', 'z'];
  for (let i = 0; i < n; i += stride) {
    t.push(rowsT[i] - t0);
    for (let a = 0; a < 3; a++) { if (hasGyro) gyro[ax[a]].push(rg[a][i]); if (hasAccel) accel[ax[a]].push(ra[a][i]); }
  }
  const durationSec = rowsT[n - 1] - t0;
  // Sample rate from the median dt (robust to gaps).
  const dts = [];
  for (let i = 1; i < Math.min(n, 2000); i++) dts.push(rowsT[i] - rowsT[i - 1]);
  dts.sort((a, b) => a - b);
  const medDt = dts.length ? dts[dts.length >> 1] : 0;
  const rate = medDt > 0 ? 1 / medDt : 0;

  return {
    meta, samples: n, durationSec, rate, hasGyro, hasAccel,
    d: {
      hasGyro, hasAccel, gyro, accel, t, durationSec,
      gyroName: 'Gyroscope (deg/s)', accelName: 'Accelerometer (g)',
    },
  };
}

export async function renderGcsv(file: File, resultsEl: HTMLElement) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading "${file.name}"…`));

  let parsed = null;
  try {
    const text = await file.slice(0, MAX_TEXT).text();
    parsed = parseGcsv(text);
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read this file: ' + (e && e.message)));
    return;
  }
  if (!parsed) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('This does not look like a Gyroflow .gcsv IMU log (no t,gx,gy,gz / ax,ay,az columns found).'));
    return;
  }

  resultsEl.innerHTML = '';
  const m = parsed.meta;

  const card = el('div', { class: 'anr-card' });
  const [h, help] = h3help('Gyro log (.gcsv)',
    'A motion-sensor log from Gyroflow: moment by moment it records how fast the camera was turning (gyroscope) and the forces acting on it (accelerometer), the readings used to smooth out shaky footage. '
    + 'Analyser scales them using the file’s own settings (turning shown in degrees per second, force in g) and draws them over time.');
  card.appendChild(h); card.appendChild(help);

  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Format', 'Gyroflow IMU log (.gcsv)'));
  if (m.version) tbl.appendChild(row('Version', m.version));
  if (m.id) tbl.appendChild(row('Logger / camera', m.id));
  if (m.orientation) tbl.appendChild(rowHelp('IMU orientation', m.orientation, 'Which way round Gyroflow treats the sensor’s three directions (up/down, left/right, forward/back) so they line up with the picture.'));
  tbl.appendChild(rowHelp('Gyroscope', parsed.hasGyro ? 'Present' : 'Not found', 'How fast the camera turns around each of its three directions, shown in degrees per second after Analyser applies the file’s own scale value (gscale).'));
  tbl.appendChild(rowHelp('Accelerometer', parsed.hasAccel ? 'Present' : 'Not found', 'The push or pull felt along each of the camera’s three directions, in g (1 g is normal gravity), after applying the file’s own scale value (ascale).'));
  tbl.appendChild(row('Samples', parsed.samples.toLocaleString()));
  if (parsed.rate) tbl.appendChild(rowHelp('Sample rate', '~' + Math.round(parsed.rate).toLocaleString() + ' Hz', 'How many readings were taken each second, estimated from the typical time gap between them.'));
  if (parsed.durationSec) tbl.appendChild(row('Duration', parsed.durationSec.toFixed(2) + ' s'));
  tbl.appendChild(row('Size', fmtBytes(file.size)));

  card.appendChild(buildImuTimeline(parsed.d, null));
  card.appendChild(el('div', { class: 'anr-imu-legend' }, [
    el('span', { class: 'anr-hint' }, 'Colours: '),
    el('span', { style: 'color:#e0533a' }, parsed.hasGyro ? 'gyro X' : 'X'), el('span', { class: 'anr-hint' }, ' · '),
    el('span', { style: 'color:#3ba776' }, parsed.hasGyro ? 'gyro Y' : 'Y'), el('span', { class: 'anr-hint' }, ' · '),
    el('span', { style: 'color:#3b82c4' }, parsed.hasGyro ? 'gyro Z' : 'Z'),
    el('span', { class: 'anr-hint' }, '  -  hover the graph to read off a time; ctrl/⌘ + scroll to zoom.'),
  ]));
  card.appendChild(tbl);   // metadata table sits below the timeline render
  resultsEl.appendChild(card);
  resultsEl.appendChild(integrityCard(file));
}

// ---------------------------------------------------------------------------
// Plain gyro/accelerometer CSV (the .csv Analyser exports from a video's gyro
// track, or any CSV with time + gyro_x/y/z and/or accel_x/y/z columns). Unlike a
// .gcsv there are no scale headers: gyro is plotted in its given units (raw
// counts for our export), accelerometer in g.

// Does this text look like a gyro CSV? (Used by csv.js to route .csv files here.)
export function looksLikeGyroCsv(text: string) {
  const head = text.slice(0, 4000);
  if (/sony rtmd imu export/i.test(head)) return true;
  for (const ln of head.split(/\r?\n/)) {
    const t = ln.trim().toLowerCase();
    if (!t || t.startsWith('#')) continue;
    const cols = t.split(',').map((s: string) => s.trim());
    const has = (n: string) => cols.includes(n);
    if ((has('gyro_x') && has('gyro_y') && has('gyro_z')) ||
        (has('accel_x_g') && has('accel_y_g') && has('accel_z_g')) ||
        (has('accel_x') && has('accel_y') && has('accel_z'))) return true;
    return false;        // first real header line isn't a gyro header
  }
  return false;
}

function parsePlainGyroCsv(text: string) {
  const lines = text.split(/\r?\n/);
  let header = null, dataStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim();
    if (!ln || ln.startsWith('#')) continue;
    header = ln.split(',').map((s: string) => s.trim().toLowerCase());
    dataStart = i + 1;
    break;
  }
  if (!header) return null;
  const ix = (names: string[]) => { for (const n of names) { const k = header.indexOf(n); if (k >= 0) return k; } return -1; };
  const it = ix(['time_s', 'time', 't', 'timestamp']);
  const ig = [ix(['gyro_x', 'gx']), ix(['gyro_y', 'gy']), ix(['gyro_z', 'gz'])];
  const ia = [ix(['accel_x_g', 'accel_x', 'ax']), ix(['accel_y_g', 'accel_y', 'ay']), ix(['accel_z_g', 'accel_z', 'az'])];
  const hasGyro = ig.every((k) => k >= 0), hasAccel = ia.every((k) => k >= 0);
  if (it < 0 || (!hasGyro && !hasAccel)) return null;

  const T: number[] = [], G: number[][] = [[], [], []], A: number[][] = [[], [], []];
  for (let i = dataStart; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln || ln[0] === '#') continue;
    const p = ln.split(',');
    const t = parseFloat(p[it]);
    if (!isFinite(t)) continue;
    T.push(t);
    if (hasGyro) for (let a = 0; a < 3; a++) G[a].push(parseFloat(p[ig[a]]) || 0);
    if (hasAccel) for (let a = 0; a < 3; a++) A[a].push(parseFloat(p[ia[a]]) || 0);
  }
  const n = T.length;
  if (!n) return null;

  const t0 = T[0];
  const stride = Math.max(1, Math.ceil(n / MAX_POINTS));
  const t: number[] = [], gyro: Record<string, number[]> = { x: [], y: [], z: [] }, accel: Record<string, number[]> = { x: [], y: [], z: [] };
  const ax = ['x', 'y', 'z'];
  for (let i = 0; i < n; i += stride) {
    t.push(T[i] - t0);
    for (let a = 0; a < 3; a++) { if (hasGyro) gyro[ax[a]].push(G[a][i]); if (hasAccel) accel[ax[a]].push(A[a][i]); }
  }
  const durationSec = T[n - 1] - t0;
  const dts = [];
  for (let i = 1; i < Math.min(n, 2000); i++) dts.push(T[i] - T[i - 1]);
  dts.sort((a, b) => a - b);
  const medDt = dts.length ? dts[dts.length >> 1] : 0;
  const rate = medDt > 0 ? 1 / medDt : 0;

  return {
    samples: n, durationSec, rate, hasGyro, hasAccel,
    d: { hasGyro, hasAccel, gyro, accel, t, durationSec, gyroName: 'Gyroscope (raw counts)', accelName: 'Accelerometer (g)' },
  };
}

export async function renderGyroCsv(file: File, resultsEl: HTMLElement, preText: string) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading "${file.name}"…`));

  let text = preText;
  try { if (text == null) text = await file.slice(0, MAX_TEXT).text(); } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read this file: ' + (e && e.message)));
    return;
  }
  const parsed = parsePlainGyroCsv(text);
  if (!parsed) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('This CSV does not have recognisable gyro / accelerometer columns.'));
    return;
  }

  resultsEl.innerHTML = '';
  const card = el('div', { class: 'anr-card' });
  const [h, help] = h3help('Gyro log (CSV)',
    'A spreadsheet-style (CSV) log of motion-sensor readings - how fast the camera turned (gyroscope) and the forces on it (accelerometer) - like the one Analyser can pull from a video’s built-in motion track. '
    + 'Analyser draws the three directions over time on a timeline you can zoom into and hover over to read exact values.');
  card.appendChild(h); card.appendChild(help);

  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Format', 'Gyro / accelerometer CSV'));
  tbl.appendChild(rowHelp('Gyroscope', parsed.hasGyro ? 'Present' : 'Not found', 'How fast the camera turns around each of its three directions, shown in whatever units the file uses (raw sensor counts for files Analyser exports).'));
  tbl.appendChild(rowHelp('Accelerometer', parsed.hasAccel ? 'Present' : 'Not found', 'The push or pull felt along each of the camera’s three directions, in g (1 g is normal gravity).'));
  tbl.appendChild(row('Samples', parsed.samples.toLocaleString()));
  if (parsed.rate) tbl.appendChild(rowHelp('Sample rate', '~' + Math.round(parsed.rate).toLocaleString() + ' Hz', 'How many readings were taken each second, estimated from the typical time gap between rows.'));
  if (parsed.durationSec) tbl.appendChild(row('Duration', parsed.durationSec.toFixed(2) + ' s'));
  tbl.appendChild(row('Size', fmtBytes(file.size)));

  card.appendChild(buildImuTimeline(parsed.d, null));
  card.appendChild(el('div', { class: 'anr-imu-legend' }, [
    el('span', { class: 'anr-hint' }, 'Colours: '),
    el('span', { style: 'color:#e0533a' }, parsed.hasGyro ? 'gyro X' : 'X'), el('span', { class: 'anr-hint' }, ' · '),
    el('span', { style: 'color:#3ba776' }, parsed.hasGyro ? 'gyro Y' : 'Y'), el('span', { class: 'anr-hint' }, ' · '),
    el('span', { style: 'color:#3b82c4' }, parsed.hasGyro ? 'gyro Z' : 'Z'),
    el('span', { class: 'anr-hint' }, '  -  gyroscope (top), accelerometer in g (bottom); hover to inspect, ctrl/⌘ + scroll to zoom.'),
  ]));
  card.appendChild(tbl);   // metadata table sits below the timeline render
  resultsEl.appendChild(card);
  resultsEl.appendChild(integrityCard(file));
}
