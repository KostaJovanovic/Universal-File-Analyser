/* Analyser - video forensics (ISOBMFF structure)

   UI-free parsers for MP4/MOV/M4V/3GP container structure. The video renderer
   builds the card chrome from what analyzeMp4Structure() returns; nothing here
   touches the DOM. Everything is best-effort and bounded: a malformed box stops
   its own subtree rather than throwing, and the moov is capped so a huge file
   never loads into memory whole (mdat is never read for structure).

   What it surfaces:
   - a recursive box (atom) tree - 4CC, absolute offset, size, one-line gloss;
   - every track (not just the first video + audio): handler, codec, language,
     duration, sample count, edit-list state, and timed-metadata streams
     (GoPro gpmd, CAMM, Sony rtmd, tmcd timecode);
   - editing / provenance "tells" - faststart (moov vs mdat order), ftyp brands,
     edit lists, padding boxes, trailing data, multiple mdat;
   - a GOP / keyframe / per-second bitrate map from the sample tables, plus a
     VFR-vs-CFR verdict and true average frame rate - all with zero decoding. */

import {
  parseHevcSps, parseAvcSps, stripEpb,
  COLOUR_PRIMARIES, TRANSFER_CHARS, MATRIX_COEFFS
} from './video-bitstream.js';

// ---------- low-level box reading ----------

function fourcc(view, p) {
  return String.fromCharCode(
    view.getUint8(p), view.getUint8(p + 1), view.getUint8(p + 2), view.getUint8(p + 3));
}

const IS_ALPHA_FCC = (s) => /^[\x20-\x7e]{4}$/.test(s) && /[A-Za-z]/.test(s[0]);

// Walk the boxes directly inside [start, end) of a DataView. Coordinates are
// whatever the view uses (callers pass a view over the moov buffer, so these are
// buffer-local). Handles 64-bit (size==1) and size==0 (extends to end).
function walkBoxes(view, start, end) {
  const out = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = view.getUint32(pos);
    const type = fourcc(view, pos + 4);
    let headerSize = 8;
    if (size === 1) {
      if (pos + 16 > end) break;
      size = Number(view.getBigUint64(pos + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < headerSize || pos + size > end + 8) break;
    out.push({ type, start: pos, size, headerSize });
    if (size <= 0) break;
    pos += size;
  }
  return out;
}

// Boxes whose payload is a sequence of child boxes (so the tree recurses into
// them). Leaf boxes with binary payloads (stsd internals, mdat, media samples)
// are intentionally NOT here - descending into them risks mis-parsing a preamble
// and silently truncating the tree.
const CONTAINER_BOXES = new Set([
  'moov', 'trak', 'edts', 'mdia', 'minf', 'stbl', 'dinf', 'udta', 'mvex',
  'moof', 'traf', 'mfra', 'meta', 'ilst', 'gmhd', 'tref', 'wave', 'sinf',
  'schi', 'iprp', 'ipco', 'grpl',
]);

// A 'meta' box is a FULL box (4 version/flags bytes before its children) in ISO
// files but a plain box in QuickTime. Peek: if bytes at `off` already look like
// a child box header, it's the QuickTime layout; otherwise skip the 4 bytes.
function metaChildStart(view, off, end) {
  if (off + 8 > end) return off;
  const size = view.getUint32(off);
  const type = fourcc(view, off + 4);
  if (size >= 8 && off + size <= end && IS_ALPHA_FCC(type)) return off;
  return off + 4;
}

// Recursively build the tree of boxes inside `box` (buffer-local coords in
// `view`). `base` is the absolute file offset of buffer index 0, used only to
// report absolute offsets. Depth-guarded so a pathological file can't recurse
// without bound.
function buildChildren(view, box, base, depth) {
  let childStart = box.start + box.headerSize;
  const childEnd = box.start + box.size;
  if (box.type === 'meta') childStart = metaChildStart(view, childStart, childEnd);
  const nodes = [];
  for (const c of walkBoxes(view, childStart, childEnd)) {
    const node = {
      type: c.type, offset: base + c.start, size: c.size, headerSize: c.headerSize, children: null,
    };
    if (CONTAINER_BOXES.has(c.type) && depth < 16) {
      try { node.children = buildChildren(view, c, base, depth + 1); } catch (_) { node.children = null; }
    }
    nodes.push(node);
  }
  return nodes;
}

// ---------- recursive field lookup within the moov buffer ----------
// Same container set as the tree, but returns boxes (buffer-local coords) of a
// given type. Used for pulling sample-table fields out of a trak.

function findAll(view, start, end, type) {
  const out = [];
  const stack = [{ s: start, e: end }];
  while (stack.length) {
    const { s, e } = stack.pop();
    for (const b of walkBoxes(view, s, e)) {
      if (b.type === type) out.push(b);
      if (CONTAINER_BOXES.has(b.type)) {
        let cs = b.start + b.headerSize;
        if (b.type === 'meta') cs = metaChildStart(view, cs, b.start + b.size);
        stack.push({ s: cs, e: b.start + b.size });
      }
    }
  }
  return out;
}

const first = (view, s, e, type) => findAll(view, s, e, type)[0] || null;

// ---------- reference tables ----------

// One-line glosses for the box tree. Not exhaustive - unknown boxes just show
// their 4CC. Kept terse; the tree is scanned, not read.
export const BOX_GLOSS = {
  ftyp: 'File type & compatible brands', styp: 'Segment type',
  moov: 'Movie header (index of all tracks)', mdat: 'Media data (the actual frames/samples)',
  free: 'Free space (padding)', skip: 'Free space (padding)', wide: 'Reserved placeholder (QuickTime)',
  mvhd: 'Movie header (timescale, duration)', trak: 'Track', tkhd: 'Track header (id, size, matrix)',
  edts: 'Edit box', elst: 'Edit list (trims / offsets)', mdia: 'Media',
  mdhd: 'Media header (timescale, language)', hdlr: 'Handler (track type)',
  minf: 'Media information', vmhd: 'Video media header', smhd: 'Sound media header',
  gmhd: 'Generic (base) media header', nmhd: 'Null media header', sthd: 'Subtitle media header',
  dinf: 'Data information', dref: 'Data references', stbl: 'Sample table',
  stsd: 'Sample descriptions (codec config)', stts: 'Time-to-sample (durations)',
  ctts: 'Composition offsets (B-frame reorder)', stss: 'Sync (key) sample list',
  stsc: 'Sample-to-chunk map', stsz: 'Sample sizes', stz2: 'Compact sample sizes',
  stco: 'Chunk offsets (32-bit)', co64: 'Chunk offsets (64-bit)', sdtp: 'Sample dependency flags',
  sgpd: 'Sample group description', sbgp: 'Sample-to-group', udta: 'User data',
  meta: 'Metadata', keys: 'Metadata keys', ilst: 'Metadata items (iTunes-style)',
  mvex: 'Movie extends (fragmented)', mehd: 'Movie extends header', trex: 'Track extends defaults',
  moof: 'Movie fragment', mfhd: 'Fragment header', traf: 'Track fragment',
  tfhd: 'Track fragment header', tfdt: 'Track fragment decode time', trun: 'Track fragment run',
  mfra: 'Fragment random access', tfra: 'Track fragment random access', mfro: 'Fragment RA offset',
  avcC: 'H.264 codec config', hvcC: 'H.265 codec config', av1C: 'AV1 codec config',
  vpcC: 'VP9 codec config', esds: 'Elementary stream descriptor', colr: 'Colour information',
  pasp: 'Pixel aspect ratio', clap: 'Clean aperture', mdcv: 'Mastering-display colour volume',
  clli: 'Content light level', dvcC: 'Dolby Vision config', dvvC: 'Dolby Vision config',
  SmDm: 'Mastering metadata (SMPTE 2086)', CoLL: 'Content light level',
  uuid: 'User-extension box (UUID-typed)', sinf: 'Protection scheme info', frma: 'Original format',
  gpmd: 'GoPro GPMF telemetry', camm: 'CAMM telemetry', rtmd: 'Sony real-time metadata',
  tmcd: 'Timecode', mebx: 'Apple timed metadata', wave: 'QuickTime audio extension',
};

// hdlr handler_type -> human label.
const HANDLERS = {
  vide: 'Video', soun: 'Audio', sbtl: 'Subtitle', subt: 'Subtitle', text: 'Text',
  subp: 'Subtitle', clcp: 'Closed caption', tmcd: 'Timecode', meta: 'Timed metadata',
  hint: 'Hint', mebx: 'Timed metadata', crsm: 'Clock reference', sdsm: 'Scene description',
  odsm: 'Object description', alis: 'Alias', url: 'Data reference',
};

// Codec / metadata-format 4CC (from the stsd sample entry) -> friendly name.
const CODEC_NAMES = {
  avc1: 'H.264 / AVC', avc3: 'H.264 / AVC', hvc1: 'H.265 / HEVC', hev1: 'H.265 / HEVC',
  dvh1: 'Dolby Vision (HEVC)', dvhe: 'Dolby Vision (HEVC)', av01: 'AV1', vp09: 'VP9', vp08: 'VP8',
  mp4v: 'MPEG-4 Visual', s263: 'H.263', mjpg: 'Motion JPEG', jpeg: 'Motion JPEG',
  apcn: 'ProRes 422', apch: 'ProRes 422 HQ', apcs: 'ProRes 422 LT', apco: 'ProRes 422 Proxy',
  ap4h: 'ProRes 4444', ap4x: 'ProRes 4444 XQ', mp4a: 'AAC', alac: 'ALAC', 'ac-3': 'AC-3',
  'ec-3': 'E-AC-3', Opus: 'Opus', sowt: 'PCM', twos: 'PCM', lpcm: 'PCM', 'in24': 'PCM 24-bit',
  samr: 'AMR', gpmd: 'GoPro GPMF', camm: 'CAMM', rtmd: 'Sony RTMD', mebx: 'Timed metadata',
  tmcd: 'Timecode', c608: 'CEA-608 caption', c708: 'CEA-708 caption', wvtt: 'WebVTT',
  tx3g: 'Timed text', 'text': 'QuickTime text',
};

// ---------- media header / language ----------

function readMdhd(view, box) {
  const d = box.start + box.headerSize;
  const ver = view.getUint8(d);
  let timescale, duration, langOff;
  if (ver === 1) {
    timescale = view.getUint32(d + 20);
    duration = Number(view.getBigUint64(d + 24));
    langOff = d + 32;
  } else {
    timescale = view.getUint32(d + 12);
    duration = view.getUint32(d + 16);
    langOff = d + 20;
  }
  const packed = view.getUint16(langOff);
  const c1 = ((packed >> 10) & 0x1f) + 0x60;
  const c2 = ((packed >> 5) & 0x1f) + 0x60;
  const c3 = (packed & 0x1f) + 0x60;
  const s = String.fromCharCode(c1, c2, c3);
  const language = /^[a-z]{3}$/.test(s) ? s : null;
  return { timescale, duration, language };
}

// ---------- sample tables ----------

function readStsz(view, box) {
  const d = box.start + box.headerSize;
  const sampleSize = view.getUint32(d + 4);
  const count = view.getUint32(d + 8);
  const sizes = [];
  if (sampleSize === 0) {
    for (let i = 0; i < count; i++) {
      const p = d + 12 + i * 4;
      if (p + 4 > box.start + box.size) break;
      sizes.push(view.getUint32(p));
    }
    return { count, sizes, fixed: 0 };
  }
  return { count, sizes: null, fixed: sampleSize };
}

function readStss(view, box) {
  const d = box.start + box.headerSize;
  const count = view.getUint32(d + 4);
  const set = new Set();
  for (let i = 0; i < count; i++) {
    const p = d + 8 + i * 4;
    if (p + 4 > box.start + box.size) break;
    set.add(view.getUint32(p));   // 1-based sample numbers
  }
  return set;
}

// time-to-sample: list of {count, delta}. delta is per-sample duration in the
// media timescale.
function readStts(view, box) {
  const d = box.start + box.headerSize;
  const entries = view.getUint32(d + 4);
  const out = [];
  for (let i = 0; i < entries; i++) {
    const p = d + 8 + i * 8;
    if (p + 8 > box.start + box.size) break;
    out.push({ count: view.getUint32(p), delta: view.getUint32(p + 4) });
  }
  return out;
}

function readChunkOffsets(view, trakStart, trakEnd) {
  const stco = first(view, trakStart, trakEnd, 'stco');
  if (stco) {
    const d = stco.start + stco.headerSize;
    const n = view.getUint32(d + 4);
    const offs = [];
    for (let i = 0; i < n; i++) {
      const p = d + 8 + i * 4;
      if (p + 4 > stco.start + stco.size) break;
      offs.push(view.getUint32(p));
    }
    return offs;
  }
  const co64 = first(view, trakStart, trakEnd, 'co64');
  if (co64) {
    const d = co64.start + co64.headerSize;
    const n = view.getUint32(d + 4);
    const offs = [];
    for (let i = 0; i < n; i++) {
      const p = d + 8 + i * 8;
      if (p + 8 > co64.start + co64.size) break;
      offs.push(Number(view.getBigUint64(p)));
    }
    return offs;
  }
  return [];
}

// ---------- edit list ----------

function readElst(view, box) {
  const d = box.start + box.headerSize;
  const ver = view.getUint8(d);
  const count = view.getUint32(d + 4);
  const entries = [];
  let p = d + 8;
  for (let i = 0; i < count; i++) {
    if (ver === 1) {
      if (p + 20 > box.start + box.size) break;
      entries.push({
        segmentDuration: Number(view.getBigUint64(p)),
        mediaTime: Number(view.getBigInt64(p + 8)),
      });
      p += 20;
    } else {
      if (p + 12 > box.start + box.size) break;
      entries.push({
        segmentDuration: view.getUint32(p),
        mediaTime: view.getInt32(p + 4),
      });
      p += 12;
    }
  }
  return entries;
}

// ---------- timecode (tmcd) ----------
// Decode the start timecode from a tmcd track: the stsd tmcd entry carries the
// drop-frame flag, timescale, frame duration and frames/second; the first sample
// (in mdat) is a 32-bit frame number. Needs one small file read for that sample.

async function readTimecode(file, view, trakStart, trakEnd) {
  const stsd = first(view, trakStart, trakEnd, 'stsd');
  if (!stsd) return null;
  const entryStart = stsd.start + stsd.headerSize + 8;   // full-box hdr + entry count
  if (entryStart + 8 > trakEnd) return null;
  // sample entry: size(4) type(4) + SampleEntry(8) then tmcd fields:
  // reserved(4) flags(4) timeScale(4) frameDuration(4) numFrames(1)
  const f = entryStart + 8 + 8;
  if (f + 17 > view.byteLength) return null;
  const flags = view.getUint32(f + 4);
  const timeScale = view.getUint32(f + 8);
  const frameDuration = view.getUint32(f + 12);
  const numFrames = view.getUint8(f + 16) || (frameDuration ? Math.round(timeScale / frameDuration) : 0);
  const dropFrame = !!(flags & 1);
  if (!numFrames || numFrames > 120) return null;

  const chunks = readChunkOffsets(view, trakStart, trakEnd);
  if (!chunks.length) return null;
  let frame = 0;
  try {
    const buf = await file.slice(chunks[0], chunks[0] + 4).arrayBuffer();
    if (buf.byteLength >= 4) frame = new DataView(buf).getUint32(0);
  } catch (_) { return null; }

  return { timecode: framesToTimecode(frame, numFrames, dropFrame), dropFrame, fps: numFrames };
}

function framesToTimecode(frame, fps, dropFrame) {
  const two = (n) => String(n).padStart(2, '0');
  if (dropFrame && (fps === 30 || fps === 60)) {
    // SMPTE drop-frame: drop 2 (or 4 at 60) frame numbers each minute except every tenth.
    const dropPerMin = fps === 60 ? 4 : 2;
    const framesPer10Min = fps * 60 * 10 - dropPerMin * 9;
    const framesPerMin = fps * 60 - dropPerMin;
    const d = Math.floor(frame / framesPer10Min);
    let m = frame % framesPer10Min;
    if (m > dropPerMin) frame += dropPerMin * 9 * d + dropPerMin * Math.floor((m - dropPerMin) / framesPerMin);
    else frame += dropPerMin * 9 * d;
  }
  const ff = frame % fps;
  const totalSec = Math.floor(frame / fps);
  const ss = totalSec % 60, mm = Math.floor(totalSec / 60) % 60, hh = Math.floor(totalSec / 3600);
  return `${two(hh)}:${two(mm)}:${two(ss)}${dropFrame ? ';' : ':'}${two(ff)}`;
}

// ---------- GOP / bitrate map (first video track) ----------

function computeGopMap(view, trakStart, trakEnd, timescale) {
  const stszBox = first(view, trakStart, trakEnd, 'stsz');
  const sttsBox = first(view, trakStart, trakEnd, 'stts');
  if (!stszBox || !sttsBox) return null;
  const stsz = readStsz(view, stszBox);
  const stts = readStts(view, sttsBox);
  const stssBox = first(view, trakStart, trakEnd, 'stss');
  const sync = stssBox ? readStss(view, stssBox) : null;   // null => all samples are sync
  const total = stsz.count;
  if (!total || !timescale) return null;

  // Per-sample durations, expanded from the run-length stts.
  const durations = new Array(total);
  let si = 0;
  for (const e of stts) {
    for (let k = 0; k < e.count && si < total; k++) durations[si++] = e.delta;
  }
  while (si < total) durations[si++] = stts.length ? stts[stts.length - 1].delta : 0;

  const size = (i) => (stsz.sizes ? (stsz.sizes[i] || 0) : stsz.fixed);

  // Per-second byte buckets.
  const totalTicks = durations.reduce((a, b) => a + b, 0);
  const durationSec = totalTicks / timescale;
  const seconds = Math.max(1, Math.ceil(durationSec));
  const perSecBytes = new Array(seconds).fill(0);
  let t = 0, iBytes = 0, iCount = 0, pBytes = 0, pCount = 0;
  for (let i = 0; i < total; i++) {
    const sec = Math.min(seconds - 1, Math.floor(t / timescale));
    perSecBytes[sec] += size(i);
    const isSync = sync ? sync.has(i + 1) : true;
    if (isSync) { iBytes += size(i); iCount++; } else { pBytes += size(i); pCount++; }
    t += durations[i];
  }
  const perSecKbps = perSecBytes.map((b) => (b * 8) / 1000);
  let peakKbps = 0;
  for (const v of perSecKbps) if (v > peakKbps) peakKbps = v;

  // Keyframe interval stats.
  let keyframes;
  if (sync) keyframes = [...sync].sort((a, b) => a - b);
  else keyframes = null;   // all-intra
  let avgGop, maxGop, keyCount;
  if (keyframes) {
    keyCount = keyframes.length;
    avgGop = keyCount ? total / keyCount : total;
    maxGop = 0;
    for (let i = 1; i < keyframes.length; i++) maxGop = Math.max(maxGop, keyframes[i] - keyframes[i - 1]);
    if (keyframes.length === 1) maxGop = total;
  } else {
    keyCount = total; avgGop = 1; maxGop = 1;
  }

  // Frame-rate: CFR if a single stts delta (or all deltas equal); else VFR.
  const deltaSet = new Set(stts.map((e) => e.delta).filter((d) => d > 0));
  const cfr = deltaSet.size <= 1;
  const avgFps = durationSec > 0 ? total / durationSec : 0;
  let minFps = 0, maxFps = 0;
  if (deltaSet.size) {
    const deltas = [...deltaSet];
    minFps = timescale / Math.max(...deltas);
    maxFps = timescale / Math.min(...deltas);
  }

  return {
    total, durationSec, allIntra: !sync, keyCount, avgGop, maxGop,
    iAvg: iCount ? iBytes / iCount : 0, pAvg: pCount ? pBytes / pCount : 0,
    perSecKbps, avgBitrateKbps: durationSec > 0 ? (perSecBytes.reduce((a, b) => a + b, 0) * 8 / 1000) / durationSec : 0,
    peakKbps,
    cfr, avgFps, minFps, maxFps, fpsPoints: deltaSet.size,
  };
}

// ---------- top-level walk over the File (slice-based) ----------

async function topLevelBoxes(file) {
  const boxes = [];
  let pos = 0;
  const max = file.size;
  let guard = 0;
  while (pos + 8 <= max && guard++ < 4096) {
    let hdr;
    try { hdr = new DataView(await file.slice(pos, pos + 16).arrayBuffer()); } catch (_) { break; }
    if (hdr.byteLength < 8) break;
    let size = hdr.getUint32(0);
    const type = fourcc(hdr, 4);
    let headerSize = 8;
    if (size === 1) {
      if (hdr.byteLength < 16) break;
      size = Number(hdr.getBigUint64(8));
      headerSize = 16;
    } else if (size === 0) {
      size = max - pos;
    }
    if (size < headerSize) break;
    boxes.push({ type, start: pos, size, headerSize });
    pos += size;
  }
  return boxes;
}

function readFtyp(file, box) {
  return file.slice(box.start, box.start + Math.min(box.size, 256)).arrayBuffer().then((buf) => {
    const v = new DataView(buf);
    const d = 8;   // box header is 8 bytes here (ftyp never uses 64-bit size)
    const majorBrand = fourcc(v, d).trim();
    const minorVersion = v.getUint32(d + 4);
    const brands = [];
    for (let p = d + 8; p + 4 <= buf.byteLength; p += 4) {
      const b = fourcc(v, p).trim();
      if (b) brands.push(b);
    }
    return { majorBrand, minorVersion, brands };
  }).catch(() => null);
}

// ---------- public entry point ----------

// Analyse the container structure of an ISOBMFF file. Returns null for
// non-ISOBMFF input or when no moov is found. Never throws.
export async function analyzeMp4Structure(file) {
  if (!file || file.size < 16) return null;
  let top;
  try { top = await topLevelBoxes(file); } catch (_) { return null; }
  if (!top.length) return null;
  const ftypBox = top.find((b) => b.type === 'ftyp');
  if (!ftypBox) return null;

  const ftyp = await readFtyp(file, ftypBox);

  // Provenance tells derivable from the top-level layout.
  const moovBox = top.find((b) => b.type === 'moov');
  const mdatBoxes = top.filter((b) => b.type === 'mdat');
  const padBoxes = top.filter((b) => b.type === 'free' || b.type === 'skip' || b.type === 'wide');
  const moovIdx = top.indexOf(moovBox);
  const firstMdatIdx = mdatBoxes.length ? top.indexOf(mdatBoxes[0]) : -1;
  const faststart = moovBox && firstMdatIdx >= 0 ? moovIdx < firstMdatIdx : null;
  const lastBox = top[top.length - 1];
  const trailing = lastBox && lastBox.type !== 'mdat' && lastBox.type !== 'moov'
    ? { type: lastBox.type, size: lastBox.size } : null;

  const result = {
    top, ftyp, tree: [],
    faststart, mdatCount: mdatBoxes.length,
    padBytes: padBoxes.reduce((a, b) => a + b.size, 0), padCount: padBoxes.length,
    fragmented: top.some((b) => b.type === 'moof') || false,
    trailing,
    tracks: [], gop: null,
  };

  // Build the tree. Expand only container top-level boxes we can afford to read
  // (moov, plus a small meta/moof/mfra); mdat and huge boxes stay leaves.
  const BUDGET = 48 * 1024 * 1024;
  for (const b of top) {
    const node = { type: b.type, offset: b.start, size: b.size, headerSize: b.headerSize, children: null };
    result.tree.push(node);
    if (CONTAINER_BOXES.has(b.type) && b.size <= BUDGET && b.size >= b.headerSize) {
      try {
        const buf = new DataView(await file.slice(b.start, b.start + b.size).arrayBuffer());
        // buffer index 0 == file offset b.start, so pass a box in buffer-local coords.
        node.children = buildChildren(buf, { type: b.type, start: 0, size: b.size, headerSize: b.headerSize }, b.start, 1);
      } catch (_) { /* leave as a leaf */ }
    }
  }

  if (!moovBox || moovBox.size > 64 * 1024 * 1024) return result;

  // Full track + GOP parse from the moov buffer (buffer-local coordinates).
  let moovView;
  try { moovView = new DataView(await file.slice(moovBox.start, moovBox.start + moovBox.size).arrayBuffer()); }
  catch (_) { return result; }
  const moovEnd = moovView.byteLength;

  // Movie header timescale/duration.
  try {
    const mvhd = first(moovView, 0, moovEnd, 'mvhd');
    if (mvhd) {
      const d = mvhd.start + mvhd.headerSize;
      const ver = moovView.getUint8(d);
      const ts = ver === 1 ? moovView.getUint32(d + 20) : moovView.getUint32(d + 12);
      const dur = ver === 1 ? Number(moovView.getBigUint64(d + 24)) : moovView.getUint32(d + 16);
      if (ts > 0 && dur > 0) result.movieDurationSec = dur / ts;
    }
  } catch (_) {}

  const traks = findAll(moovView, 0, moovEnd, 'trak');
  let videoTrakForGop = null, videoTimescale = 0;

  for (let ti = 0; ti < traks.length; ti++) {
    const trak = traks[ti];
    const ts = trak.start + trak.headerSize;
    const te = trak.start + trak.size;
    const track = { index: ti + 1 };
    try {
      const hdlr = first(moovView, ts, te, 'hdlr');
      let handler = null;
      if (hdlr) handler = fourcc(moovView, hdlr.start + hdlr.headerSize + 8);
      track.handler = handler;
      track.handlerName = HANDLERS[handler] || (handler ? handler : 'Unknown');

      const stsd = first(moovView, ts, te, 'stsd');
      if (stsd && stsd.start + stsd.headerSize + 16 <= moovEnd) {
        const codec = fourcc(moovView, stsd.start + stsd.headerSize + 12);
        track.codec = codec;
        track.codecName = CODEC_NAMES[codec] || codec;
      }

      const mdhdBox = first(moovView, ts, te, 'mdhd');
      if (mdhdBox) {
        const mdhd = readMdhd(moovView, mdhdBox);
        track.timescale = mdhd.timescale;
        track.language = mdhd.language;
        if (mdhd.timescale > 0) track.durationSec = mdhd.duration / mdhd.timescale;
      }

      // tkhd enabled flag + track id.
      const tkhd = first(moovView, ts, te, 'tkhd');
      if (tkhd) {
        const d = tkhd.start + tkhd.headerSize;
        track.enabled = (moovView.getUint32(d) & 0x1) === 1;   // low flag bit
      }

      const stszBox = first(moovView, ts, te, 'stsz');
      if (stszBox) track.sampleCount = readStsz(moovView, stszBox).count;

      const edts = first(moovView, ts, te, 'edts');
      if (edts) {
        const elst = first(moovView, edts.start + edts.headerSize, edts.start + edts.size, 'elst');
        if (elst) {
          const entries = readElst(moovView, elst);
          track.editList = {
            entries: entries.length,
            emptyEdit: entries.some((e) => e.mediaTime === -1),
            hasOffset: entries.some((e) => e.mediaTime > 0),
          };
        }
      }

      // Start timecode for tmcd tracks (reads one 4-byte sample from mdat).
      if (handler === 'tmcd') {
        try {
          const tc = await readTimecode(file, moovView, ts, te);
          if (tc) { track.timecode = tc.timecode; track.dropFrame = tc.dropFrame; }
        } catch (_) {}
      }

      // First real video track drives the GOP/bitrate map.
      if (handler === 'vide' && !videoTrakForGop) {
        videoTrakForGop = trak; videoTimescale = track.timescale || 0;
      }
    } catch (_) { /* skip a malformed trak, keep the rest */ }
    result.tracks.push(track);
  }

  if (videoTrakForGop && videoTimescale) {
    try {
      result.gop = computeGopMap(moovView, videoTrakForGop.start + videoTrakForGop.headerSize,
        videoTrakForGop.start + videoTrakForGop.size, videoTimescale);
    } catch (_) {}
  }

  return result;
}

// ============================================================================
// Codec-bitstream forensics + authenticity (Batch V3)
// ============================================================================
// Reads the actual H.264/H.265 SPS out of the codec-config box and parses it with
// an Exp-Golomb bitreader, then cross-checks the stream's own dimensions / colour /
// frame rate against what the container claims - a mismatch is a re-encode/edit
// tell. Also pulls the x264/x265 encoder fingerprint from the first frame's SEI,
// the HDR mastering-display / content-light values, Dolby Vision config, and any
// C2PA / Content Credentials manifest. All best-effort; returns null on non-H.26x.

const PRIMARIES = COLOUR_PRIMARIES;
const TRANSFER = TRANSFER_CHARS;
const MATRIX = MATRIX_COEFFS;

// Adapt a shared SPS parse to the shape this module's consistency check and the
// Advanced card expect. There used to be a second SPS parser in this file; it
// stopped at the bit depth for H.265, so an HEVC file never produced a frame
// rate or a colour description and the stream-vs-container verdict silently had
// nothing to compare. `nal` includes the NAL header byte(s).
function spsFacts(nal, h265) {
  const parsed = h265
    ? parseHevcSps(stripEpb(nal.subarray(2)))
    : parseAvcSps(stripEpb(nal.subarray(1)));
  if (!parsed) return null;
  const colour = {};
  if (parsed.primaries != null) colour.primaries = parsed.primaries;
  if (parsed.transfer != null) colour.transfer = parsed.transfer;
  if (parsed.matrix != null) colour.matrix = parsed.matrix;
  if (parsed.fullRange !== undefined) colour.fullRange = parsed.fullRange;
  return {
    codec: h265 ? 'H.265' : 'H.264',
    profile: (h265 && parsed.tier) ? parsed.profile + ' (' + parsed.tier + ')' : parsed.profile,
    profileIdc: parsed.profileIdc,
    level: parsed.level ? parsed.level.replace(/\.0$/, '') : null,
    chroma: parsed.chroma,
    bitDepth: Math.max(parsed.bitDepthLuma || 8, parsed.bitDepthChroma || 8),
    progressive: parsed.progressive !== undefined ? parsed.progressive : true,
    width: parsed.width, height: parsed.height,
    colour, fps: parsed.fps || null, partial: !!parsed.partial,
  };
}

// Pull the SPS NAL(s) + NAL length size out of an avcC / hvcC box (buffer-local).
function readParamSets(view, box, codec) {
  const d = box.start + box.headerSize;
  const end = box.start + box.size;
  const sps = [];
  if (codec === 'avc') {
    const lenSize = (view.getUint8(d + 4) & 0x03) + 1;
    let p = d + 5;
    const numSps = view.getUint8(p) & 0x1f; p += 1;
    for (let i = 0; i < numSps && p + 2 <= end; i++) { const l = view.getUint16(p); p += 2; sps.push(new Uint8Array(view.buffer, view.byteOffset + p, l)); p += l; }
    return { lenSize, sps };
  }
  const lenSize = (view.getUint8(d + 21) & 0x03) + 1;
  let p = d + 22;
  const numArrays = view.getUint8(p); p += 1;
  for (let a = 0; a < numArrays && p + 3 <= end; a++) {
    const nalType = view.getUint8(p) & 0x3f; p += 1;
    const numNalus = view.getUint16(p); p += 2;
    for (let i = 0; i < numNalus && p + 2 <= end; i++) { const l = view.getUint16(p); p += 2; if (nalType === 33) sps.push(new Uint8Array(view.buffer, view.byteOffset + p, l)); p += l; }
  }
  return { lenSize, sps };
}

// Scan length-prefixed NALs of one sample for a user_data_unregistered SEI and
// return its ASCII payload (the x264/x265 settings string), or null.
function findEncoderSei(bytes, lenSize, h265) {
  let p = 0;
  while (p + lenSize <= bytes.length) {
    let len = 0; for (let i = 0; i < lenSize; i++) len = len * 256 + bytes[p + i];
    p += lenSize;
    if (len <= 0 || p + len > bytes.length) break;
    const nal = bytes.subarray(p, p + len);
    const type = h265 ? (nal[0] >> 1) & 0x3f : nal[0] & 0x1f;
    if ((h265 && (type === 39 || type === 40)) || (!h265 && type === 6)) {
      const rb = stripEpb(nal.subarray(h265 ? 2 : 1));
      let i = 0;
      while (i < rb.length) {
        let pt = 0; while (i < rb.length && rb[i] === 0xff) { pt += 255; i++; } if (i < rb.length) { pt += rb[i]; i++; }
        let ps = 0; while (i < rb.length && rb[i] === 0xff) { ps += 255; i++; } if (i < rb.length) { ps += rb[i]; i++; }
        if (pt === 5) {
          const s = i + 16, e = Math.min(rb.length, i + ps);
          let str = ''; for (let k = s; k < e; k++) { const c = rb[k]; if (c >= 9 && c < 127) str += String.fromCharCode(c); }
          str = str.replace(/^[^\x20-\x7e]+/, '').trim();
          if (str) return str;
        }
        i += ps; if (ps === 0) break;
      }
    }
    p += len;
  }
  return null;
}

// The child-box region of the first video sample entry (avc1/hvc1/...). avcC,
// hvcC, colr, mdcv, clli and dvcC all live HERE, not directly under stbl - the
// generic findAll doesn't descend into stsd or the sample-entry box, so we locate
// the region and walk its children flat. Offsets: box header(8) + SampleEntry(8) +
// VisualSampleEntry fixed fields(70) = 86 before the first child box.
function videoSampleEntryRange(view, ts, te) {
  const stsd = first(view, ts, te, 'stsd');
  if (!stsd) return null;
  const se = stsd.start + stsd.headerSize + 8;
  if (se + 86 > view.byteLength) return null;
  const size = view.getUint32(se);
  return { seStart: se, seType: fourcc(view, se + 4), start: se + 86, end: Math.min(se + size, view.byteLength) };
}
function seFind(view, range, type) {
  if (!range) return null;
  return walkBoxes(view, range.start, range.end).find((b) => b.type === type) || null;
}

// Container-side reference values for the consistency check (dims/fps/colour).
function containerVideoFacts(view, ts, te, seRange) {
  const facts = {};
  const stsd = first(view, ts, te, 'stsd');
  if (stsd) {
    const dim = stsd.start + stsd.headerSize + 8 + 8 + 8 + 16;   // entry hdr + SampleEntry + 16 pre-defined
    if (dim + 4 <= view.byteLength) { facts.width = view.getUint16(dim); facts.height = view.getUint16(dim + 2); }
  }
  const colr = seFind(view, seRange, 'colr');
  if (colr) {
    const d = colr.start + colr.headerSize;
    if (fourcc(view, d) === 'nclx' && d + 11 <= view.byteLength) {
      facts.primaries = view.getUint16(d + 4); facts.transfer = view.getUint16(d + 6); facts.matrix = view.getUint16(d + 8);
      facts.fullRange = !!(view.getUint8(d + 10) & 0x80);
    }
  }
  const mdhdBox = first(view, ts, te, 'mdhd');
  const sttsBox = first(view, ts, te, 'stts');
  if (mdhdBox && sttsBox) {
    const mdhd = readMdhd(view, mdhdBox);
    const stts = readStts(view, sttsBox);
    let ticks = 0, count = 0;
    for (const e of stts) { ticks += e.count * e.delta; count += e.count; }
    if (mdhd.timescale > 0 && ticks > 0) facts.fps = mdhd.timescale * count / ticks;
  }
  return facts;
}

// Read the first video sample's leading bytes from mdat (for the SEI scan).
async function readFirstSample(file, view, ts, te) {
  const stco = first(view, ts, te, 'stco') || first(view, ts, te, 'co64');
  const stsz = first(view, ts, te, 'stsz');
  if (!stco || !stsz) return null;
  const co = stco.start + stco.headerSize;
  const n = view.getUint32(co + 4);
  if (!n) return null;
  const off = stco.type === 'co64' ? Number(view.getBigUint64(co + 8)) : view.getUint32(co + 8);
  const size = readStsz(view, stsz).sizes ? readStsz(view, stsz).sizes[0] : readStsz(view, stsz).fixed;
  const want = Math.min(size || 512 * 1024, 512 * 1024);
  try { return new Uint8Array(await file.slice(off, off + want).arrayBuffer()); } catch (_) { return null; }
}

function parseMdcv(view, box) {
  const d = box.start + box.headerSize;
  if (d + 24 > box.start + box.size) return null;
  const prim = [];
  for (let i = 0; i < 3; i++) prim.push([view.getUint16(d + i * 4) * 0.00002, view.getUint16(d + i * 4 + 2) * 0.00002]);
  const wp = [view.getUint16(d + 12) * 0.00002, view.getUint16(d + 14) * 0.00002];
  const maxLum = view.getUint32(d + 16) / 10000, minLum = view.getUint32(d + 20) / 10000;
  return { prim, wp, maxLum, minLum };
}
function parseClli(view, box) {
  const d = box.start + box.headerSize;
  if (d + 4 > box.start + box.size) return null;
  return { maxCLL: view.getUint16(d), maxFALL: view.getUint16(d + 2) };
}
function parseDvcC(view, box) {
  const d = box.start + box.headerSize;
  if (d + 4 > box.start + box.size) return null;
  const profile = view.getUint8(d + 2) >> 1;
  const level = ((view.getUint8(d + 2) & 1) << 5) | (view.getUint8(d + 3) >> 3);
  return { profile, level };
}

// Detect a C2PA / Content Credentials manifest in a top-level uuid box by scanning
// its head for the JUMBF/C2PA markers (the exact usertype UUID varies by tool).
async function detectC2pa(file, top) {
  for (const b of top.filter((x) => x.type === 'uuid')) {
    let buf;
    try { buf = new Uint8Array(await file.slice(b.start, b.start + Math.min(b.size, 65536)).arrayBuffer()); } catch (_) { continue; }
    let ascii = '';
    for (let i = 0; i < buf.length; i++) { const c = buf[i]; ascii += (c >= 32 && c < 127) ? String.fromCharCode(c) : '\n'; }
    if (/c2pa|jumbf|urn:[cu]|contentauth|c2pa\.assertions/i.test(ascii)) {
      const gen = (ascii.match(/([A-Za-z0-9_.\- ]+\/[0-9][^\s]*)/) || [])[1];
      return { present: true, size: b.size, generator: gen || null };
    }
  }
  return null;
}

export async function analyzeBitstream(file) {
  if (!file || file.size < 16) return null;
  let top;
  try { top = await topLevelBoxes(file); } catch (_) { return null; }
  const moovBox = top.find((b) => b.type === 'moov');
  if (!moovBox || moovBox.size > 64 * 1024 * 1024) return null;

  let view;
  try { view = new DataView(await file.slice(moovBox.start, moovBox.start + moovBox.size).arrayBuffer()); } catch (_) { return null; }
  const moovEnd = view.byteLength;

  // First video trak.
  let ts = 0, te = 0, codecFcc = null;
  for (const trak of findAll(view, 0, moovEnd, 'trak')) {
    const s = trak.start + trak.headerSize, e = trak.start + trak.size;
    if (!first(view, s, e, 'vmhd')) continue;
    const stsd = first(view, s, e, 'stsd');
    if (stsd) codecFcc = fourcc(view, stsd.start + stsd.headerSize + 12);
    ts = s; te = e; break;
  }
  if (!ts) return null;

  const isAvc = /^avc[13]$/.test(codecFcc);
  const isHevc = /^(hvc1|hev1|dvh1|dvhe)$/.test(codecFcc);
  const result = { codec: codecFcc, sps: null, consistency: [], encoder: null, hdr: null, c2pa: null };
  const seRange = videoSampleEntryRange(view, ts, te);

  // SPS parse from avcC / hvcC (inside the sample entry).
  const cfgBox = seFind(view, seRange, isAvc ? 'avcC' : 'hvcC');
  if (cfgBox && (isAvc || isHevc)) {
    try {
      const { lenSize, sps } = readParamSets(view, cfgBox, isAvc ? 'avc' : 'hvc');
      if (sps.length) {
        result.sps = spsFacts(sps[0], !isAvc);
        if (!result.sps) throw new Error('sps');
        result.lenSize = lenSize;
        const c = result.sps.colour;
        if (c && c.primaries != null) {
          result.sps.colourText = (PRIMARIES[c.primaries] || ('primaries ' + c.primaries)) + ' / '
            + (TRANSFER[c.transfer] || ('transfer ' + c.transfer)) + ' / ' + (MATRIX[c.matrix] || ('matrix ' + c.matrix))
            + (c.fullRange ? ' · full range' : ' · limited range');
        }
      }
    } catch (_) {}
  }

  // Consistency: SPS stream values vs what the container claims.
  if (result.sps) {
    const cf = containerVideoFacts(view, ts, te, seRange);
    const push = (field, container, stream, match) => result.consistency.push({ field, container, stream, match });
    if (cf.width && result.sps.width) {
      // Container dims can be rotated (portrait tkhd) vs the stream's stored dims.
      const match = (cf.width === result.sps.width && cf.height === result.sps.height) ||
        (cf.width === result.sps.height && cf.height === result.sps.width);
      push('Dimensions', cf.width + '×' + cf.height, result.sps.width + '×' + result.sps.height, match);
    }
    if (cf.fps && result.sps.fps) {
      const match = Math.abs(cf.fps - result.sps.fps) / cf.fps < 0.02;
      push('Frame rate', cf.fps.toFixed(3) + ' fps', result.sps.fps.toFixed(3) + ' fps', match);
    }
    if (result.sps.colour.primaries != null && cf.primaries != null) {
      const match = cf.primaries === result.sps.colour.primaries && cf.transfer === result.sps.colour.transfer;
      push('Colour', (PRIMARIES[cf.primaries] || cf.primaries) + ' / ' + (TRANSFER[cf.transfer] || cf.transfer),
        (PRIMARIES[result.sps.colour.primaries] || result.sps.colour.primaries) + ' / ' + (TRANSFER[result.sps.colour.transfer] || result.sps.colour.transfer), match);
    }
  }

  // Encoder fingerprint from the first sample's SEI.
  if (result.sps && (isAvc || isHevc)) {
    try {
      const bytes = await readFirstSample(file, view, ts, te);
      if (bytes) {
        const str = findEncoderSei(bytes, result.lenSize || 4, isHevc);
        if (str) {
          const tool = /x264/i.test(str) ? 'x264' : /x265/i.test(str) ? 'x265' : /lavc|ffmpeg/i.test(str) ? 'FFmpeg (libav)' : null;
          result.encoder = { string: str.length > 400 ? str.slice(0, 400) + '…' : str, tool };
        }
      }
    } catch (_) {}
  }

  // HDR: mastering-display / content-light values + Dolby Vision config.
  const hdr = {};
  const mdcvBox = seFind(view, seRange, 'mdcv') || seFind(view, seRange, 'SmDm');
  if (mdcvBox) hdr.mdcv = parseMdcv(view, mdcvBox);
  const clliBox = seFind(view, seRange, 'clli') || seFind(view, seRange, 'CoLL');
  if (clliBox) hdr.clli = parseClli(view, clliBox);
  const dvBox = seFind(view, seRange, 'dvcC') || seFind(view, seRange, 'dvvC') || seFind(view, seRange, 'dvwC');
  if (dvBox) hdr.dolbyVision = parseDvcC(view, dvBox);
  if (/^dv/.test(codecFcc)) hdr.dolbyVisionCodec = true;
  if (hdr.mdcv || hdr.clli || hdr.dolbyVision || hdr.dolbyVisionCodec) result.hdr = hdr;

  // C2PA / Content Credentials in a top-level uuid box.
  try { result.c2pa = await detectC2pa(file, top); } catch (_) {}

  if (!result.sps && !result.hdr && !result.c2pa) return null;
  return result;
}
