/* Analyser - video telemetry (GoPro GPMF, Android/Google CAMM, container GPS)
   ============================================================================
   Action cameras and phones write a timed-metadata track alongside the video:
   GPS position/speed and inertial (gyro + accelerometer) samples. This module
   reads three sources with byte-range slices only (never buffering the whole
   file) and best-effort throughout - any failure returns null so the normal
   video analysis is untouched:

   - GoPro GPMF ('gpmd' track): nested KLV (key / type / struct-size / repeat,
     32-bit aligned). GPS5/GPS9 give lat/lon/alt/speed; ACCL/GYRO the IMU; SCAL
     the per-stream divisors; TMPC temperature, GPSF fix, GPSU UTC time.
   - CAMM ('camm' track): fixed little-endian packets, one per sample, typed
     (2 gyro, 3 accel, 5/6 GPS). Written by Android phones, Insta360, drones.
   - Container point ('udta' -> '©xyz', or Apple 'com.apple.quicktime.location.
     ISO6709' in meta/keys/ilst): a single ISO-6709 lat/lon/alt for the clip.

   The GPS track is drawn on a local canvas (no map tiles are fetched - the file
   never leaves the device, matching the single-point GPS card), with an explicit
   "open in OpenStreetMap" link the user chooses to click. Motion traces reuse the
   Sony gyro timeline (buildImuTimeline). */

import { el, row, rowHelp, h3help, wireInfoToggle } from '../core/util.js';
import { buildImuTimeline } from './sony-rtmd.js';

const MAX_MOOV = 32 * 1024 * 1024;
const MAX_CHUNKS = 6000;          // cap chunks read (bounds time/memory on long clips)
const MAX_IMU_POINTS = 4000;      // decimate IMU to keep the trace light
const MAX_GPS_POINTS = 3000;

const fcc = (dv: DataView<ArrayBuffer>, p: number) => String.fromCharCode(dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2), dv.getUint8(p + 3));

// ---------- box helpers (self-contained, like sony-rtmd.js) ----------

function parseBoxes(dv: DataView<ArrayBuffer>, start: number, end: number) {
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

function findAllBoxes(dv: DataView<ArrayBuffer>, start: number, end: number, type: string) {
  const result = [], stack = [{ s: start, e: end }];
  const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'meta']);
  while (stack.length) {
    const { s, e } = stack.pop()!;
    for (const b of parseBoxes(dv, s, e)) {
      if (b.type === type) result.push(b);
      if (containers.has(b.type)) stack.push({ s: b.offset + b.headerSize, e: b.offset + b.size });
    }
  }
  return result;
}

async function findMoov(file: File) {
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

// Read a track's samples grouped by chunk, with per-sample decode time (seconds).
// Reading per chunk (not per sample) keeps the number of file slices small even
// for high-rate metadata tracks.
function readTrackChunks(dv: DataView<ArrayBuffer>, ts: number, te: number) {
  const box = (t: string) => findAllBoxes(dv, ts, te, t)[0];
  const stsz = box('stsz'), stsc = box('stsc'), stco = box('stco'), co64 = box('co64'), stts = box('stts'), mdhd = box('mdhd');
  if (!stsz || !stsc || !(stco || co64)) return null;
  const P = (b: { offset: number; headerSize: number }) => b.offset + b.headerSize;

  let o = P(stsz) + 4;
  const uniform = dv.getUint32(o), count = dv.getUint32(o + 4); o += 8;
  if (!count) return null;
  const sizes = new Array(count);
  for (let i = 0; i < count; i++) sizes[i] = uniform || dv.getUint32(o + i * 4);

  const offsets = [];
  if (stco) { let q = P(stco) + 4; const n = dv.getUint32(q); q += 4; for (let i = 0; i < n; i++) offsets.push(dv.getUint32(q + i * 4)); }
  else { let q = P(co64) + 4; const n = dv.getUint32(q); q += 4; for (let i = 0; i < n; i++) offsets.push(dv.getUint32(q + i * 8) * 0x100000000 + dv.getUint32(q + i * 8 + 4)); }

  let s = P(stsc) + 4; const sc = dv.getUint32(s); s += 4;
  const runs = [];
  for (let i = 0; i < sc; i++) runs.push([dv.getUint32(s + i * 12), dv.getUint32(s + i * 12 + 4)]);

  let timescale = 0;
  if (mdhd) { const d = P(mdhd); const ver = dv.getUint8(d); timescale = ver === 1 ? dv.getUint32(d + 20) : dv.getUint32(d + 12); }
  const durs = new Array(count).fill(0);
  if (stts) {
    let t = P(stts) + 4; const n = dv.getUint32(t); t += 4; let si = 0;
    for (let i = 0; i < n; i++) { const c = dv.getUint32(t + i * 8), del = dv.getUint32(t + i * 8 + 4); for (let k = 0; k < c && si < count; k++) durs[si++] = del; }
  }

  const chunks = [];
  let si = 0, acc = 0;
  for (let ci = 0; ci < offsets.length && si < count; ci++) {
    let spc = 1;
    for (let k = 0; k < runs.length; k++) if (runs[k][0] - 1 <= ci) spc = runs[k][1];
    let rel = 0; const samps = [];
    for (let j = 0; j < spc && si < count; j++) {
      samps.push({ rel, len: sizes[si], t: timescale ? acc / timescale : 0 });
      rel += sizes[si]; acc += durs[si]; si++;
    }
    chunks.push({ fileOffset: offsets[ci], sizeBytes: rel, samples: samps });
  }
  const durationSec = timescale ? acc / timescale : 0;
  return { chunks, timescale, durationSec, count };
}

// Find the first trak whose stsd sample-entry 4CC matches `codec`.
function findTrackByCodec(dv: DataView<ArrayBuffer>, moovSize: number, codec: string) {
  for (const trak of findAllBoxes(dv, 8, moovSize, 'trak')) {
    const ts = trak.offset + trak.headerSize, te = Math.min(trak.offset + trak.size, moovSize);
    const stsd = findAllBoxes(dv, ts, te, 'stsd')[0];
    if (!stsd) continue;
    const entry = stsd.offset + stsd.headerSize + 8;
    if (entry + 8 > moovSize) continue;
    if (fcc(dv, entry + 4) === codec) return { ts, te };
  }
  return null;
}

// ---------- geo helpers ----------

function haversine(a: any[], b: any[]) {                 // [lat,lon] in degrees -> metres
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toR, dLon = (b[1] - a[1]) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Reduce a raw GPS list to <= MAX_GPS_POINTS and compute distance / speed / alt.
function gpsStats(gps: any[]) {
  if (!gps.length) return null;
  const stride = Math.max(1, Math.ceil(gps.length / MAX_GPS_POINTS));
  const pts = stride > 1 ? gps.filter((_, i: number) => i % stride === 0) : gps;
  let distance = 0;
  for (let i = 1; i < gps.length; i++) distance += haversine([gps[i - 1].lat, gps[i - 1].lon], [gps[i].lat, gps[i].lon]);
  let maxSpeed = 0, altLo = Infinity, altHi = -Infinity;
  for (const p of gps) {
    if (isFinite(p.speed)) maxSpeed = Math.max(maxSpeed, p.speed);
    if (isFinite(p.alt)) { altLo = Math.min(altLo, p.alt); altHi = Math.max(altHi, p.alt); }
  }
  return { pts, count: gps.length, distance, maxSpeed, altLo, altHi };
}

/** The GPMF flavour, which also carries the per-stream extras CAMM has no
 *  equivalent for. */
type GpmfAcc = TelemetryAcc & Required<Pick<TelemetryAcc, 'streams'|'iso'|'shutter'|'wbal'>>;

/** What a GPMF / CAMM walk accumulates before finishTelemetry() reshapes it. */
interface TelemetryAcc {
  gps: { lat: number; lon: number; alt: number; speed: number; t: number }[];
  accl: { x: number; y: number; z: number; t: number }[];
  gyro: { x: number; y: number; z: number; t: number }[];
  temps: number[];
  fix: number|null;
  gpsu: string|null;
  streams?: Set<string>;
  iso?: number[];
  shutter?: number[];
  wbal?: number[];
}

// ---------- GoPro GPMF ----------

const GPMF_ELEM_SIZE: Record<string, number> = { b: 1, B: 1, c: 1, s: 2, S: 2, f: 4, l: 4, L: 4, F: 4, d: 8, j: 8, J: 8 };
function gpmfRead(dv: DataView<ArrayBuffer>, o: number, type: string) {
  switch (type) {
    case 'b': return dv.getInt8(o);
    case 'B': case 'c': return dv.getUint8(o);
    case 's': return dv.getInt16(o);
    case 'S': return dv.getUint16(o);
    case 'l': return dv.getInt32(o);
    case 'L': case 'F': return dv.getUint32(o);
    case 'f': return dv.getFloat32(o);
    case 'd': return dv.getFloat64(o);
    default: return dv.getUint8(o);
  }
}

// Decode a leaf KLV value into `repeat` structs, each of valsPerStruct numbers.
function gpmfValues(dv: DataView<ArrayBuffer>, dp: number, type: string, structSize: number, repeat: number) {
  const es = GPMF_ELEM_SIZE[type] || 1;
  const per = Math.max(1, Math.floor(structSize / es));
  const out = [];
  for (let r = 0; r < repeat; r++) {
    const struct = [];
    for (let c = 0; c < per; c++) struct.push(gpmfRead(dv, dp + (r * per + c) * es, type));
    out.push(struct);
  }
  return out;
}

// Walk one GPMF payload, collecting GPS + IMU into `acc`. `scope` carries the
// current STRM's SCAL divisors. baseT/dur place samples in time.
function gpmfWalk(dv: DataView<ArrayBuffer>, start: number, end: number, scope: any, acc: GpmfAcc, baseT: number, dur: number) {
  let p = start;
  while (p + 8 <= end) {
    const key = fcc(dv, p);
    const typeCode = dv.getUint8(p + 4);
    const type = String.fromCharCode(typeCode);
    const structSize = dv.getUint8(p + 5);
    const repeat = dv.getUint16(p + 6);
    const dataLen = structSize * repeat;
    const dp = p + 8;
    if (dp + dataLen > end) break;

    if (typeCode === 0) {                         // nested container
      const childScope = key === 'STRM' ? { scal: null } : scope;
      gpmfWalk(dv, dp, dp + dataLen, childScope, acc, baseT, dur);
    } else if (key === 'SCAL') {
      const v = gpmfValues(dv, dp, type, GPMF_ELEM_SIZE[type] || 1, repeat).map((s) => s[0]);
      scope.scal = v;
    } else if (key === 'GPS5' || key === 'GPS9') {
      const scal = scope.scal || [];
      const structs = gpmfValues(dv, dp, type, structSize, repeat);
      const n = structs.length;
      for (let i = 0; i < n; i++) {
        const s = structs[i];
        const div = (idx: number) => (scal.length ? scal[idx % scal.length] : 1) || 1;
        const lat = s[0] / div(0), lon = s[1] / div(1), alt = s[2] / div(2), speed = s[3] / div(3);
        if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0))
          acc.gps.push({ lat, lon, alt, speed, t: baseT + (n ? i / n : 0) * dur });
      }
    } else if (key === 'ACCL' || key === 'GYRO') {
      const scal = scope.scal || [];
      const div = (scal[0]) || 1;
      const structs = gpmfValues(dv, dp, type, structSize, repeat);
      const dst = key === 'ACCL' ? acc.accl : acc.gyro;
      const n = structs.length;
      for (let i = 0; i < n; i++) {
        const s = structs[i];
        // GoPro order is Z,X,Y; remap to X,Y,Z for a conventional trace.
        dst.push({ x: (s[1] || 0) / div, y: (s[2] || 0) / div, z: (s[0] || 0) / div, t: baseT + (n ? i / n : 0) * dur });
      }
    } else if (key === 'TMPC') {
      const v = gpmfRead(dv, dp, type); if (isFinite(v)) acc.temps.push(v);
    } else if (key === 'STNM') {                  // human-readable stream name
      let s = ''; for (let i = 0; i < dataLen; i++) { const c = dv.getUint8(dp + i); if (c) s += String.fromCharCode(c); }
      s = s.trim(); if (s) acc.streams.add(s);
    } else if (key === 'ISOE') {
      for (const v of gpmfValues(dv, dp, type, structSize, repeat)) if (isFinite(v[0])) acc.iso.push(v[0]);
    } else if (key === 'SHUT') {
      for (const v of gpmfValues(dv, dp, type, structSize, repeat)) if (isFinite(v[0]) && v[0] > 0) acc.shutter.push(v[0]);
    } else if (key === 'WBAL') {
      for (const v of gpmfValues(dv, dp, type, structSize, repeat)) if (isFinite(v[0]) && v[0] > 1000) acc.wbal.push(v[0]);
    } else if (key === 'GPSF') {
      acc.fix = gpmfRead(dv, dp, type);
    } else if (key === 'GPSU' && repeat >= 12) {
      let str = ''; for (let i = 0; i < Math.min(dataLen, 16); i++) str += String.fromCharCode(dv.getUint8(dp + i));
      acc.gpsu = acc.gpsu || str;
    }
    p += 8 + ((dataLen + 3) & ~3);              // 32-bit aligned advance
  }
}

export async function extractGpmf(file: File) {
  const moov = await findMoov(file);
  if (!moov || moov.size > MAX_MOOV) return null;
  const dv = new DataView(await file.slice(moov.offset, moov.offset + moov.size).arrayBuffer());
  const trk = findTrackByCodec(dv, moov.size, 'gpmd');
  if (!trk) return null;
  const table = readTrackChunks(dv, trk.ts, trk.te);
  if (!table || !table.chunks.length) return null;

  const acc: GpmfAcc = { gps: [], accl: [], gyro: [], temps: [], fix: null, gpsu: null, streams: new Set(), iso: [], shutter: [], wbal: [] };
  let read = 0;
  for (const chunk of table.chunks) {
    if (read >= MAX_CHUNKS) break;
    read++;
    let buf;
    try { buf = await file.slice(chunk.fileOffset, chunk.fileOffset + chunk.sizeBytes).arrayBuffer(); } catch (_) { continue; }
    for (const samp of chunk.samples) {
      if (samp.rel + samp.len > buf.byteLength) continue;
      const sdv = new DataView(buf, samp.rel, samp.len);
      const dur = 1;   // GPMF payloads are ~1 s; sub-sample offset spreads within it
      try { gpmfWalk(sdv, 0, samp.len, { scal: null }, acc, samp.t, dur); } catch (_) {}
    }
  }
  if (!acc.gps.length && !acc.accl.length && !acc.gyro.length) return null;

  return finishTelemetry('GoPro GPMF', acc, table, file,
    'Gyroscope (rad/s)', 'Accelerometer (m/s²)');
}

// ---------- CAMM ----------

export async function extractCamm(file: File) {
  const moov = await findMoov(file);
  if (!moov || moov.size > MAX_MOOV) return null;
  const dv = new DataView(await file.slice(moov.offset, moov.offset + moov.size).arrayBuffer());
  const trk = findTrackByCodec(dv, moov.size, 'camm');
  if (!trk) return null;
  const table = readTrackChunks(dv, trk.ts, trk.te);
  if (!table || !table.chunks.length) return null;

  const acc: TelemetryAcc = { gps: [], accl: [], gyro: [], temps: [], fix: null, gpsu: null };
  let read = 0;
  for (const chunk of table.chunks) {
    if (read >= MAX_CHUNKS) break;
    read++;
    let buf;
    try { buf = await file.slice(chunk.fileOffset, chunk.fileOffset + chunk.sizeBytes).arrayBuffer(); } catch (_) { continue; }
    const cdv = new DataView(buf);
    for (const samp of chunk.samples) {
      if (samp.rel + 4 > buf.byteLength) continue;
      const o = samp.rel;
      const type = cdv.getUint16(o + 2, true);   // CAMM is little-endian
      try {
        if (type === 2 && o + 16 <= buf.byteLength) {        // gyro (rad/s)
          acc.gyro.push({ x: cdv.getFloat32(o + 4, true), y: cdv.getFloat32(o + 8, true), z: cdv.getFloat32(o + 12, true), t: samp.t });
        } else if (type === 3 && o + 16 <= buf.byteLength) { // accel (m/s^2)
          acc.accl.push({ x: cdv.getFloat32(o + 4, true), y: cdv.getFloat32(o + 8, true), z: cdv.getFloat32(o + 12, true), t: samp.t });
        } else if (type === 5 && o + 28 <= buf.byteLength) { // min GPS: lat,lon,alt double
          const lat = cdv.getFloat64(o + 4, true), lon = cdv.getFloat64(o + 12, true), alt = cdv.getFloat64(o + 20, true);
          if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0)) acc.gps.push({ lat, lon, alt, speed: NaN, t: samp.t });
        } else if (type === 6 && o + 60 <= buf.byteLength) { // GPS: time, fix, lat, lon, alt, ...
          const fix = cdv.getInt32(o + 12, true);
          const lat = cdv.getFloat64(o + 16, true), lon = cdv.getFloat64(o + 24, true), alt = cdv.getFloat32(o + 32, true);
          const vE = cdv.getFloat32(o + 44, true), vN = cdv.getFloat32(o + 48, true), vU = cdv.getFloat32(o + 52, true);
          const speed = Math.hypot(vE, vN, vU);
          acc.fix = fix;
          if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0)) acc.gps.push({ lat, lon, alt, speed, t: samp.t });
        }
      } catch (_) {}
    }
  }
  if (!acc.gps.length && !acc.accl.length && !acc.gyro.length) return null;

  return finishTelemetry('CAMM', acc, table, file,
    'Gyroscope (rad/s)', 'Accelerometer (m/s²)');
}

// Turn raw accumulated GPS/IMU into the card-ready shape (decimated motion trace
// + GPS stats), shared by GPMF and CAMM.
function finishTelemetry(source: string, acc: TelemetryAcc, table: any, file: File, gyroName: string, accelName: string) {
  const durationSec = table.durationSec || (acc.gps.length ? acc.gps[acc.gps.length - 1].t : 0) || 1;

  let motion = null;
  const hasGyro = acc.gyro.length > 0, hasAccel = acc.accl.length > 0;
  if (hasGyro || hasAccel) {
    // Gyro and accelerometer are independent streams that may have different
    // sample counts. buildImuTimeline plots every series against one shared time
    // axis, so resample both onto a common uniform grid (nearest sample by time,
    // both streams monotonic) - indexing by position would time-warp one trace.
    const dur = durationSec || 1;
    const N = Math.max(2, Math.min(MAX_IMU_POINTS, Math.max(acc.gyro.length, acc.accl.length)));
    const grid: any[] = [];
    for (let k = 0; k < N; k++) grid.push((k / (N - 1)) * dur);
    const resample = (arr: string|any[]) => {
      const x = [], y = [], z = [];
      if (!arr.length) { for (let k = 0; k < N; k++) { x.push(0); y.push(0); z.push(0); } return { x, y, z }; }
      let j = 0;
      for (let k = 0; k < N; k++) {
        const tt = grid[k];
        while (j + 1 < arr.length && Math.abs(arr[j + 1].t - tt) <= Math.abs(arr[j].t - tt)) j++;
        x.push(arr[j].x); y.push(arr[j].y); z.push(arr[j].z);
      }
      return { x, y, z };
    };
    motion = { t: grid, gyro: resample(acc.gyro), accel: resample(acc.accl), hasGyro, hasAccel, durationSec: dur, gyroName, accelName };
  }

  const gstats = gpsStats(acc.gps);
  const scalars: any = {};
  if (acc.temps && acc.temps.length) scalars.temperature = acc.temps.reduce((s, v) => s + v, 0) / acc.temps.length;
  if (acc.fix != null) scalars.fix = acc.fix;
  if (acc.gpsu) scalars.gpsu = acc.gpsu;

  const stat = (arr: number[]|null|undefined) => {
    if (!arr || !arr.length) return null;
    let mn = Infinity, mx = -Infinity, s = 0, n = 0;
    for (const v of arr) { if (!isFinite(v)) continue; mn = Math.min(mn, v); mx = Math.max(mx, v); s += v; n++; }
    return n ? { min: mn, max: mx, avg: s / n } : null;
  };
  const exposure: any = {};
  const isoS = stat(acc.iso); if (isoS) exposure.iso = isoS;
  const shutS = stat(acc.shutter); if (shutS) exposure.shutter = shutS;
  const wbS = stat(acc.wbal); if (wbS) exposure.wb = wbS;
  const streams = acc.streams ? [...acc.streams].sort() : [];

  return { source, gps: gstats, motion, scalars, exposure, streams, durationSec, file };
}

// ---------- container single-point location (©xyz / Apple ISO6709) ----------

// Parse an ISO-6709 string like "+40.7480-073.9860+016.000/" -> {lat,lon,alt}.
function parseISO6709(str: string) {
  if (!str) return null;
  const m = str.match(/([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)(?:([+-]\d+(?:\.\d+)?))?/);
  if (!m) return null;
  const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const alt = m[3] != null ? parseFloat(m[3]) : NaN;
  return { lat, lon, alt };
}

export async function extractContainerLocation(file: File) {
  const moov = await findMoov(file);
  if (!moov || moov.size > MAX_MOOV) return null;
  const dv = new DataView(await file.slice(moov.offset, moov.offset + moov.size).arrayBuffer());

  // QuickTime udta '©xyz': u16 length, u16 language, then the ISO-6709 string.
  for (const b of findAllBoxes(dv, 8, moov.size, '©xyz')) {
    const d = b.offset + b.headerSize;
    const len = dv.getUint16(d);
    let str = '';
    for (let i = 0; i < len && d + 4 + i < b.offset + b.size; i++) str += String.fromCharCode(dv.getUint8(d + 4 + i));
    const p = parseISO6709(str);
    if (p) return { ...p, source: 'QuickTime ©xyz' };
  }

  // Apple keys/ilst: com.apple.quicktime.location.ISO6709. The keys box lists
  // key names; the matching ilst item (1-based index) holds a 'data' payload.
  try {
    const meta = findAllBoxes(dv, 8, moov.size, 'meta')[0];
    if (meta) {
      const ms = meta.offset + meta.headerSize, me = meta.offset + meta.size;
      const keys = findAllBoxes(dv, ms, me, 'keys')[0];
      const ilst = findAllBoxes(dv, ms, me, 'ilst')[0];
      if (keys && ilst) {
        let kp = keys.offset + keys.headerSize + 4;   // ver/flags(4)
        const kcount = dv.getUint32(kp); kp += 4;
        let locIndex = -1;
        for (let i = 0; i < kcount; i++) {
          const ksize = dv.getUint32(kp);
          let name = ''; for (let j = 8; j < ksize; j++) name += String.fromCharCode(dv.getUint8(kp + j));
          if (name.indexOf('location.ISO6709') >= 0) { locIndex = i + 1; break; }
          kp += ksize;
        }
        if (locIndex > 0) {
          const items = parseBoxes(dv, ilst.offset + ilst.headerSize, ilst.offset + ilst.size);
          const item = items[locIndex - 1];
          if (item) {
            const data = findAllBoxes(dv, item.offset + item.headerSize, item.offset + item.size, 'data')[0]
              || parseBoxes(dv, item.offset + item.headerSize, item.offset + item.size).find((x) => x.type === 'data');
            if (data) {
              const dd = data.offset + data.headerSize + 8;   // type(4)+locale(4)
              let str = ''; for (let j = dd; j < data.offset + data.size; j++) str += String.fromCharCode(dv.getUint8(j));
              const p = parseISO6709(str);
              if (p) return { ...p, source: 'Apple QuickTime location' };
            }
          }
        }
      }
    }
  } catch (_) {}
  return null;
}

// ---------- cards ----------

const fmtDeg = (v: number) => v.toFixed(6) + '°';
const osmLink = (lat: string, lon: string) => 'https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lon + '#map=15/' + lat + '/' + lon;
// Exposure time in seconds -> photographic shutter notation.
const fmtShutter = (sec: number) => (!sec || sec <= 0) ? '-' : sec >= 1 ? sec.toFixed(1) + ' s' : '1/' + Math.round(1 / sec) + ' s';

// Draw the GPS track on a local canvas (equirectangular, lon scaled by cos(lat)).
// No map tiles are fetched - the shape of the path, with start (green) and end
// (red) markers, over the site's surface colour.
function buildTrackCanvas(pts: any[]) {
  const W = 640, H = 360, pad = 24;
  const cv = el('canvas', { width: String(W), height: String(H),
    style: 'width:100%; height:auto; display:block; border:var(--bd-hairline); background:var(--surface);' });
  const ctx = cv.getContext('2d');
  if (!ctx || pts.length < 2) return cv;
  const midLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const kx = Math.cos(midLat * Math.PI / 180);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const proj = pts.map((p) => ({ x: p.lon * kx, y: p.lat }));
  for (const q of proj) { minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y); }
  const spanX = (maxX - minX) || 1e-6, spanY = (maxY - minY) || 1e-6;
  const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
  const ox = (W - spanX * scale) / 2, oy = (H - spanY * scale) / 2;
  const X = (q: { x: number; y: number }) => ox + (q.x - minX) * scale;
  const Y = (q: { x: number; y: number }) => H - (oy + (q.y - minY) * scale);   // flip: north up

  const cs = getComputedStyle(document.body);
  const accent = (cs.getPropertyValue('--accent') || '').trim() || '#3a7';
  ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
  for (let i = 0; i < proj.length; i++) { const x = X(proj[i]), y = Y(proj[i]); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
  ctx.stroke();
  const dot = (q: { x: number; y: number }, color: string|CanvasGradient|CanvasPattern) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X(q), Y(q), 5, 0, Math.PI * 2); ctx.fill(); };
  dot(proj[0], '#2ecc71'); dot(proj[proj.length - 1], '#e74c3c');
  return cv;
}

// Build a telemetry card for GPMF/CAMM data (source, GPS stats + track map,
// motion timeline). Feature-level, like the Sony gyro card.
export function buildTelemetryCard(d: any) {
  const card = el('div', { class: 'anr-card' });
  const [h, help] = h3help('Telemetry - ' + d.source,
    'Action cameras and phones can record a hidden data track alongside the video: where you were and how fast you moved (GPS), plus movement sensed by the gyroscope and accelerometer. '
    + 'Analyser reads this straight from the file - nothing is uploaded, and no map tiles are fetched. '
    + 'The route is drawn here as a simple local sketch; use the OpenStreetMap link to see it on a real map if you want to.');
  card.appendChild(h); card.appendChild(help);

  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Source', d.source + ' timed-metadata track'));
  const g = d.gps;
  if (g) {
    tbl.appendChild(rowHelp('GPS points', g.count.toLocaleString(),
      'How many times the camera recorded its GPS position during the clip.'));
    tbl.appendChild(row('Track distance', (g.distance >= 1000 ? (g.distance / 1000).toFixed(2) + ' km' : g.distance.toFixed(0) + ' m')));
    if (g.maxSpeed > 0) tbl.appendChild(rowHelp('Max speed', (g.maxSpeed * 3.6).toFixed(1) + ' km/h  (' + g.maxSpeed.toFixed(1) + ' m/s)',
      'The fastest speed recorded during the clip, taken from the GPS.'));
    if (isFinite(g.altLo) && isFinite(g.altHi)) tbl.appendChild(row('Altitude', g.altLo.toFixed(0) + ' - ' + g.altHi.toFixed(0) + ' m'));
    const start = g.pts[0];
    tbl.appendChild(rowHelp('Start', fmtDeg(start.lat) + ', ' + fmtDeg(start.lon),
      'Where the clip began, from the first GPS reading. Use the map link to see the whole route.'));
  } else {
    tbl.appendChild(rowHelp('GPS', d.source === 'GoPro GPMF' ? 'No satellite lock in this clip' : 'Not found',
      'This clip has movement and exposure data but no usable GPS position - the camera had GPS turned off, or never managed to lock onto satellites (common indoors or in a short clip).'));
  }
  tbl.appendChild(rowHelp('Gyroscope', d.motion && d.motion.hasGyro ? 'Present' : 'Not found',
    'Readings of how fast the camera was turning on each of its three axes, used by stabilisation tools such as Gyroflow and ReelSteady.'));
  tbl.appendChild(rowHelp('Accelerometer', d.motion && d.motion.hasAccel ? 'Present' : 'Not found',
    'Readings of the camera’s acceleration along its three axes. When it is still, one axis reads about 9.8 m/s², which is gravity.'));
  if (d.scalars.temperature != null) tbl.appendChild(rowHelp('Temperature', d.scalars.temperature.toFixed(1) + ' °C',
    'A temperature the camera measured from its own internal sensors while recording, in degrees Celsius. This is the hardware’s heat, not the white-balance colour temperature.'));
  if (isFinite(d.durationSec) && d.durationSec > 0) tbl.appendChild(row('Duration', d.durationSec.toFixed(1) + ' s'));
  card.appendChild(tbl);

  // Exposure telemetry (GoPro logs ISO / shutter / white balance per frame).
  const ex = d.exposure || {};
  if (ex.iso || ex.shutter || ex.wb) {
    card.appendChild(el('div', { class: 'anr-readout-section' }, 'Exposure (per frame)'));
    const et = el('table', { class: 'anr-readout' });
    if (ex.iso) et.appendChild(rowHelp('ISO', Math.round(ex.iso.min) + ' - ' + Math.round(ex.iso.max) + '  (avg ' + Math.round(ex.iso.avg) + ')',
      'How sensitive to light the camera set its sensor, noted for each frame. A wide range means the light was changing; a high ISO means the scene was dark.'));
    if (ex.shutter) et.appendChild(rowHelp('Shutter', fmtShutter(ex.shutter.min) + ' - ' + fmtShutter(ex.shutter.max) + '  (avg ' + fmtShutter(ex.shutter.avg) + ')',
      'How long each frame was exposed to light. A fast shutter (e.g. 1/1000 s) freezes motion; a slow one blurs it. It cannot go slower than the frame rate allows.'));
    if (ex.wb) et.appendChild(rowHelp('White balance', Math.round(ex.wb.min) + ' - ' + Math.round(ex.wb.max) + ' K  (avg ' + Math.round(ex.wb.avg) + ' K)',
      'The colour of light the camera adjusted for, measured in Kelvin. Low values are warm indoor light; high values are cool daylight or shade.'));
    card.appendChild(et);
  }

  if (g && g.pts.length > 1) {
    card.appendChild(el('div', { class: 'anr-readout-section' }, 'GPS track'));
    card.appendChild(buildTrackCanvas(g.pts));
    const [lat, lon] = [g.pts[0].lat, g.pts[0].lon];
    card.appendChild(el('p', { style: 'margin:6px 0 0' }, [
      el('span', { class: 'anr-hint', style: 'margin:0' }, 'Green marks the start, red the end.  '),
      el('a', { href: osmLink(lat, lon), target: '_blank', rel: 'noopener' }, 'open start in OpenStreetMap'),
    ]));
  }

  if (d.motion && (d.motion.hasGyro || d.motion.hasAccel) && d.motion.t.length) {
    card.appendChild(el('div', { class: 'anr-readout-section' }, 'Motion'));
    card.appendChild(buildImuTimeline(d.motion, d.file || null));
    card.appendChild(el('div', { style: 'margin:4px 0 2px' }, [
      el('span', { class: 'anr-hint', style: 'margin:0' }, 'Colours: '),
      el('span', { style: 'color:#e0533a' }, 'X'), el('span', { class: 'anr-hint', style: 'margin:0' }, ' · '),
      el('span', { style: 'color:#3ba776' }, 'Y'), el('span', { class: 'anr-hint', style: 'margin:0' }, ' · '),
      el('span', { style: 'color:#3b82c4' }, 'Z'),
      el('span', { class: 'anr-hint', style: 'margin:0' }, '  -  ' + (d.motion.gyroName || 'gyroscope') + ' (top), ' + (d.motion.accelName || 'accelerometer') + ' (bottom).'),
    ]));
  }

  // The camera's own labels for every stream it logged - self-documenting, and it
  // makes clear how much more the file records beyond what is charted above.
  if (d.streams && d.streams.length) {
    const det = el('details', { style: 'margin-top:12px' });
    const sum = el('summary', {});
    const label = el('span', { class: 'anr-summary-label' });
    label.appendChild(document.createTextNode('All recorded streams (' + d.streams.length + ') '));
    const infoBtn = el('button', { type: 'button', class: 'anr-info-btn', title: 'Info' }, '[?]');
    const infoPanel = el('div', { class: 'anr-info-panel is-hidden',
      html: 'Every metadata stream the camera wrote into this clip, by its own name. Analyser charts GPS, motion and exposure above; the rest are listed here.' });
    wireInfoToggle(infoBtn, infoPanel);
    label.appendChild(infoBtn);
    sum.appendChild(label);
    det.appendChild(sum);
    const body = el('div');
    body.appendChild(infoPanel);
    const ul = el('ul', { style: 'margin:0; padding-left:18px; font-size:var(--t-small)' });
    for (const s of d.streams) ul.appendChild(el('li', {}, s));
    body.appendChild(ul);
    det.appendChild(body);
    card.appendChild(det);
  }
  return card;
}

function buildLocationCard(loc: any) {
  const card = el('div', { class: 'anr-card' });
  const [h, help] = h3help('Location',
    'A single GPS location saved inside the file itself (the QuickTime ©xyz or Apple location field). '
    + 'Nothing is sent anywhere - the coordinates below are read from the file, and the map link opens only if you click it.');
  card.appendChild(h); card.appendChild(help);
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Source', loc.source));
  tbl.appendChild(row('Latitude', fmtDeg(loc.lat)));
  tbl.appendChild(row('Longitude', fmtDeg(loc.lon)));
  if (isFinite(loc.alt)) tbl.appendChild(row('Altitude', loc.alt.toFixed(1) + ' m'));
  card.appendChild(tbl);
  card.appendChild(el('p', { style: 'margin:8px 0 0' }, [
    el('a', { href: osmLink(loc.lat, loc.lon), target: '_blank', rel: 'noopener' }, 'open in OpenStreetMap'),
    el('span', { class: 'anr-hint', style: 'margin:0' }, '  /  '),
    el('a', { href: 'https://www.google.com/maps?q=' + loc.lat + ',' + loc.lon, target: '_blank', rel: 'noopener' }, 'Google Maps'),
  ]));
  return card;
}

// Convenience: try GoPro GPMF, then CAMM, then a single container location.
// Appends whichever is present. `opts.hasExifGps` suppresses the single-point
// card when the renderer already showed a GPS card from exifr. Returns true if
// any telemetry/location card was appended.
export async function appendTelemetryCards(file: File, resultsEl: HTMLElement, opts: any = {}) {
  try {
    let d = null;
    try { d = await extractGpmf(file); } catch (_) {}
    if (!d) { try { d = await extractCamm(file); } catch (_) {} }
    if (d) {
      // The Motion timeline mounts a small synced player. Extraction above read the
      // ORIGINAL's telemetry track, but when the browser can't decode the original
      // codec the caller passes a playable H.264 proxy to mount instead of it.
      if (opts.playFile) d.file = opts.playFile;
      resultsEl.appendChild(buildTelemetryCard(d));
      return true;
    }

    if (!opts.hasExifGps) {
      let loc = null;
      try { loc = await extractContainerLocation(file); } catch (_) {}
      if (loc) { resultsEl.appendChild(buildLocationCard(loc)); return true; }
    }
  } catch (_) {}
  return false;
}
