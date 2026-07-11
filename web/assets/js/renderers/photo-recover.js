/* Analyser - photo recovery module
   Salvage broken / truncated / corrupt still images, the stills twin of
   video-recover.js. Turns a "could not load image" dead end into the maximum
   recoverable picture plus a downloadable repaired file. Strategies, by format:

   - JPEG: strip junk before the SOI, append the EOI a truncated file is missing,
     and (when the header itself is damaged) rebuild the DQT/DHT/SOF tables from a
     healthy reference photo shot on the same camera - the still-image analogue of
     borrowing SPS/PPS for video. Browsers then render the decodable top band.
   - PNG: inflate the IDAT stream until it errors and unfilter the scanlines that
     survived, so a truncated PNG yields its top rows instead of nothing.
   - Carving: scan a blob / wrong-extension file / disk fragment for embedded image
     signatures (JPEG, PNG, GIF, WebP, BMP) and pull each one out.
   - RAW / HEIF detection routes to the existing preview-extraction / ISOBMFF paths.

   Pure helpers (no DOM): they take a Uint8Array, or a reader(start,end) ->
   Promise<Uint8Array> for the carve, so the same code runs under a Node test
   harness exactly as video-recover.js does. */

// ---------------------------------------------------------------- format sniff

const PNG_SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

function eq(bytes, off, sig) {
  for (let i = 0; i < sig.length; i++) if (bytes[off + i] !== sig[i]) return false;
  return true;
}
function u16be(b, p) { return (b[p] << 8) | b[p + 1]; }
function u32be(b, p) { return ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0; }
function u32le(b, p) { return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0; }
function ascii(b, p, n) { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(b[p + i]); return s; }

// Identify the image format from a header sample. Returns a short tag or null.
export function sniffImageFormat(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'jpeg';
  if (eq(bytes, 0, PNG_SIG)) return 'png';
  if (ascii(bytes, 0, 3) === 'GIF') return 'gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  if (bytes[0] === 0x42 && bytes[1] === 0x4D) return 'bmp';
  if ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2A) ||
      (bytes[0] === 0x4D && bytes[1] === 0x4D && bytes[2] === 0x00)) return 'tiff';
  // ISOBMFF-based (HEIF/HEIC/AVIF): 'ftyp' at offset 4, brand tells which.
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4);
    if (/avif|avis/i.test(brand)) return 'avif';
    if (/heic|heix|hevc|mif1|msf1|heim|heis/i.test(brand)) return 'heif';
    return 'heif';
  }
  return null;
}

// ---------------------------------------------------------------- JPEG

// JPEG markers without a length payload (standalone).
function jpegMarkerHasNoLength(m) {
  return m === 0xD8 || m === 0xD9 || m === 0x01 || (m >= 0xD0 && m <= 0xD7);
}
// SOF (start of frame) markers carry the image geometry; all of C0..CF except
// DHT(C4), JPG(C8) and DAC(CC).
function isSofMarker(m) { return m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC; }

// Walk a JPEG's marker structure starting at `start` (the SOI). Returns the
// segments found, the SOF geometry, where the entropy-coded scan begins/ends, and
// whether a terminating EOI is present. Tolerant: stops cleanly at truncation.
export function scanJpeg(bytes, start = 0) {
  const n = bytes.length;
  if (start + 2 > n || bytes[start] !== 0xFF || bytes[start + 1] !== 0xD8) return null;
  const out = { soi: start, segments: [], sof: null, dqt: 0, dht: 0, dri: null, sosAt: -1, scanStart: -1, scanEnd: n, hasEOI: false, progressive: false, truncated: false };
  let p = start + 2;
  while (p + 1 < n) {
    if (bytes[p] !== 0xFF) { out.truncated = true; break; }       // lost marker sync
    while (p < n && bytes[p] === 0xFF) p++;                        // skip fill bytes
    if (p >= n) { out.truncated = true; break; }
    const marker = bytes[p++];
    if (marker === 0xD9) { out.hasEOI = true; out.eoiAt = p - 2; break; }   // EOI
    if (jpegMarkerHasNoLength(marker)) continue;
    if (p + 2 > n) { out.truncated = true; break; }
    const len = u16be(bytes, p);
    if (len < 2 || p + len > n) { out.truncated = true; break; }   // truncated/lying length
    const segStart = p, segEnd = p + len;
    if (isSofMarker(marker)) {
      out.progressive = (marker === 0xC2 || marker === 0xC6 || marker === 0xCA || marker === 0xCE);
      out.sof = { marker, off: p - 2, len: len + 2 };
      if (segStart + 6 <= n) {
        out.sof.precision = bytes[segStart + 2];
        out.sof.height = u16be(bytes, segStart + 3);
        out.sof.width = u16be(bytes, segStart + 5);
        out.sof.components = bytes[segStart + 7];
      }
    } else if (marker === 0xDB) out.dqt++;
    else if (marker === 0xC4) out.dht++;
    else if (marker === 0xDD) out.dri = u16be(bytes, segStart + 2);
    out.segments.push({ marker, off: p - 2, len: len + 2 });

    if (marker === 0xDA) {                                          // SOS: entropy data follows
      out.sosAt = p - 2;
      out.scanStart = segEnd;
      // Scan the entropy stream for the next real marker (not a stuffed FF00 and
      // not a restart RSTn). That marker (normally EOI) ends the scan.
      let q = segEnd;
      while (q + 1 < n) {
        if (bytes[q] === 0xFF) {
          const m2 = bytes[q + 1];
          if (m2 !== 0x00 && !(m2 >= 0xD0 && m2 <= 0xD7)) break;    // real marker
        }
        q++;
      }
      out.scanEnd = q;
      if (q + 1 >= n) out.truncated = true;
      p = q;
      continue;
    }
    p = segEnd;
  }
  return out;
}

// Repair a JPEG: locate the true SOI (dropping any leading garbage from a carved /
// mis-typed file), and append the EOI a truncated file lacks. Returns the repaired
// bytes, the actions taken, and flags describing what's still wrong (a damaged
// header that needs a reference photo's tables). Does not re-encode pixels.
export function repairJpeg(bytes, opts = {}) {
  const actions = [];
  let soi = (bytes[0] === 0xFF && bytes[1] === 0xD8) ? 0 : -1;
  if (soi < 0) { soi = findBytesIn(bytes, [0xFF, 0xD8, 0xFF], 0); if (soi >= 0) actions.push('Dropped ' + soi + ' junk byte(s) before the JPEG start'); }
  if (soi < 0) return { data: null, actions, ok: false, reason: 'no JPEG start marker (FFD8) found' };

  let data = soi > 0 ? bytes.subarray(soi) : bytes;
  const scan = scanJpeg(data, 0);
  const info = scan ? {
    width: scan.sof && scan.sof.width, height: scan.sof && scan.sof.height,
    components: scan.sof && scan.sof.components, progressive: scan.progressive,
    hasDQT: scan.dqt > 0, hasDHT: scan.dht > 0, hasSOF: !!scan.sof, hasSOS: scan.sosAt >= 0,
    restartInterval: scan.dri, truncated: scan.truncated, hasEOI: scan.hasEOI,
  } : null;

  // Trim anything past a real EOI (trailing junk from carving); otherwise append one.
  if (scan && scan.hasEOI && scan.eoiAt != null) {
    const end = scan.eoiAt + 2;
    if (end < data.length) { data = data.subarray(0, end); actions.push('Trimmed trailing data after the JPEG end'); }
  } else {
    const withEoi = new Uint8Array(data.length + 2);
    withEoi.set(data, 0); withEoi[data.length] = 0xFF; withEoi[data.length + 1] = 0xD9;
    data = withEoi;
    actions.push('Appended the missing end-of-image marker (truncated file)');
  }

  const needsHeader = !info || !info.hasDQT || !info.hasDHT || !info.hasSOF;
  return {
    data: data.slice ? data.slice() : data, actions, ok: !!(info && info.hasSOS),
    info, needsReference: needsHeader && !!(info && info.hasSOS),
    reason: (info && info.hasSOS) ? null : 'no scan (SOS) data to recover',
  };
}

// Pull the header tables (DQT, DHT, SOF, DRI, plus APP0/APP1) out of a healthy
// reference JPEG so a damaged file's missing/garbled header can be rebuilt. Returns
// the raw segment bytes (with their FFxx markers) in canonical order, or null.
export function extractJpegTables(bytes) {
  const scan = scanJpeg(bytes, bytes[0] === 0xFF ? 0 : Math.max(0, findBytesIn(bytes, [0xFF, 0xD8, 0xFF], 0)));
  if (!scan || !scan.sof) return null;
  const wanted = [];
  for (const s of scan.segments) {
    // Everything up to (not including) the SOS: DQT/DHT/SOF/DRI/APPn/COM.
    if (s.marker === 0xDA) break;
    wanted.push(bytes.subarray(s.off, s.off + s.len));
  }
  if (!wanted.length) return null;
  return { segments: wanted, width: scan.sof.width, height: scan.sof.height, components: scan.sof.components };
}

// Rebuild a damaged JPEG from a reference's header tables + the broken file's own
// scan data. Used when the header is corrupt but the entropy-coded scan survives.
// Produces SOI + reference header segments + broken SOS-onward (+ EOI).
export function spliceJpegHeader(brokenBytes, refTables) {
  const scan = scanJpeg(brokenBytes, brokenBytes[0] === 0xFF ? 0 : Math.max(0, findBytesIn(brokenBytes, [0xFF, 0xD8], 0)));
  if (!scan || scan.sosAt < 0) return null;     // need a locatable scan
  const sosOnward = brokenBytes.subarray(scan.sosAt, scan.hasEOI && scan.eoiAt != null ? scan.eoiAt + 2 : brokenBytes.length);
  const parts = [new Uint8Array([0xFF, 0xD8])];
  for (const seg of refTables.segments) parts.push(seg);
  parts.push(sosOnward);
  if (!(scan.hasEOI)) parts.push(new Uint8Array([0xFF, 0xD9]));
  let total = 0; for (const p of parts) total += p.length;
  const out = new Uint8Array(total); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ---------------------------------------------------------------- PNG

const PNG_BPP = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };   // channels by colour type (at 8-bit)

// Walk a PNG's chunks. Returns IHDR geometry, the concatenated IDAT payload, the
// palette/transparency for indexed images, IEND presence, and any CRC mismatches.
export function scanPng(bytes) {
  if (!eq(bytes, 0, PNG_SIG)) return null;
  const out = { ihdr: null, idat: [], idatBytes: 0, hasIEND: false, plte: null, trns: null, crcErrors: 0, truncated: false };
  let p = 8;
  const n = bytes.length;
  while (p + 8 <= n) {
    const len = u32be(bytes, p);
    const type = ascii(bytes, p + 4, 4);
    const dataStart = p + 8;
    if (dataStart + len + 4 > n) { out.truncated = true; if (type === 'IDAT' && dataStart < n) { out.idat.push(bytes.subarray(dataStart, n)); out.idatBytes += n - dataStart; } break; }
    if (type === 'IHDR') {
      out.ihdr = {
        width: u32be(bytes, dataStart), height: u32be(bytes, dataStart + 4),
        bitDepth: bytes[dataStart + 8], colorType: bytes[dataStart + 9],
        interlace: bytes[dataStart + 12],
      };
    } else if (type === 'PLTE') out.plte = bytes.subarray(dataStart, dataStart + len);
    else if (type === 'tRNS') out.trns = bytes.subarray(dataStart, dataStart + len);
    else if (type === 'IDAT') { out.idat.push(bytes.subarray(dataStart, dataStart + len)); out.idatBytes += len; }
    else if (type === 'IEND') { out.hasIEND = true; break; }
    p = dataStart + len + 4;     // skip data + 4-byte CRC
  }
  return out;
}

// Inflate (zlib) bytes, returning whatever decompressed before any error - so a
// truncated IDAT stream still yields its leading scanlines. Uses the platform
// DecompressionStream (browser + Node 18+).
async function inflatePartial(chunks) {
  let blobBytes = 0; for (const c of chunks) blobBytes += c.length;
  const input = new Uint8Array(blobBytes); let o = 0;
  for (const c of chunks) { input.set(c, o); o += c.length; }
  const tryFormat = async (fmt) => {
    const ds = new DecompressionStream(fmt);
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    const got = [];
    const pump = (async () => { try { for (;;) { const { done, value } = await reader.read(); if (done) break; if (value) got.push(value); } } catch (_) { /* keep what we got */ } })();
    try { await writer.write(input); await writer.close(); } catch (_) { /* truncated tail */ }
    try { await pump; } catch (_) {}
    let total = 0; for (const g of got) total += g.length;
    const res = new Uint8Array(total); let q = 0; for (const g of got) { res.set(g, q); q += g.length; }
    return res;
  };
  // PNG is zlib ('deflate'); fall back to raw deflate just in case.
  let res = await tryFormat('deflate');
  if (!res.length) { try { res = await tryFormat('deflate-raw'); } catch (_) {} }
  return res;
}

// Decode as many scanlines of a (possibly truncated) PNG as survive, into RGBA.
// Handles 8-bit greyscale / RGB / RGBA / palette, non-interlaced - the overwhelming
// common case. Returns { width, height, rgba, rowsRecovered } or null.
export async function decodePngPartial(bytes) {
  const scan = scanPng(bytes);
  if (!scan || !scan.ihdr || !scan.idat.length) return null;
  const { width, height, bitDepth, colorType, interlace } = scan.ihdr;
  if (interlace !== 0 || bitDepth !== 8 || PNG_BPP[colorType] == null) return null;  // common case only
  const channels = PNG_BPP[colorType];
  const stride = width * channels;
  const raw = await inflatePartial(scan.idat);
  if (!raw.length) return null;
  // Each scanline is 1 filter byte + stride data bytes.
  const rowsAvail = Math.floor(raw.length / (stride + 1));
  const rows = Math.min(rowsAvail, height);
  const rgba = new Uint8Array(width * height * 4);     // unrecovered rows stay transparent
  const cur = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  const paeth = (a, b, c) => { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); };
  prev.fill(0);
  for (let y = 0; y < rows; y++) {
    const base = y * (stride + 1);
    const ft = raw[base];
    for (let i = 0; i < stride; i++) {
      const x = raw[base + 1 + i];
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v;
      switch (ft) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: v = x;
      }
      cur[i] = v & 0xFF;
    }
    // Emit RGBA.
    for (let xpx = 0; xpx < width; xpx++) {
      const o = (y * width + xpx) * 4;
      if (colorType === 2) { rgba[o] = cur[xpx * 3]; rgba[o + 1] = cur[xpx * 3 + 1]; rgba[o + 2] = cur[xpx * 3 + 2]; rgba[o + 3] = 255; }
      else if (colorType === 6) { rgba[o] = cur[xpx * 4]; rgba[o + 1] = cur[xpx * 4 + 1]; rgba[o + 2] = cur[xpx * 4 + 2]; rgba[o + 3] = cur[xpx * 4 + 3]; }
      else if (colorType === 0) { const g = cur[xpx]; rgba[o] = g; rgba[o + 1] = g; rgba[o + 2] = g; rgba[o + 3] = 255; }
      else if (colorType === 3) { const idx = cur[xpx]; const pl = scan.plte; rgba[o] = pl ? pl[idx * 3] : 0; rgba[o + 1] = pl ? pl[idx * 3 + 1] : 0; rgba[o + 2] = pl ? pl[idx * 3 + 2] : 0; rgba[o + 3] = (scan.trns && idx < scan.trns.length) ? scan.trns[idx] : 255; }
    }
    prev.set(cur);
  }
  return { width, height, rgba, rowsRecovered: rows };
}

// Repair a PNG container: keep the chunks up to corruption, ensure an IEND. When
// the IDAT stream is intact this lets the browser decode it; when truncated, pair
// with decodePngPartial. Returns repaired bytes + actions.
export function repairPng(bytes) {
  const actions = [];
  if (!eq(bytes, 0, PNG_SIG)) {
    const at = findBytesIn(bytes, PNG_SIG, 0);
    if (at < 0) return { data: null, actions, ok: false, reason: 'no PNG signature found' };
    bytes = bytes.subarray(at); actions.push('Dropped ' + at + ' junk byte(s) before the PNG signature');
  }
  const scan = scanPng(bytes);
  if (!scan || !scan.ihdr) return { data: null, actions, ok: false, reason: 'no IHDR' };
  if (scan.hasIEND) return { data: bytes.slice(), actions, ok: true, info: scan.ihdr, truncated: false };
  // Append an IEND chunk so decoders treat the stream as complete.
  const iend = new Uint8Array([0, 0, 0, 0, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]);
  const out = new Uint8Array(bytes.length + iend.length);
  out.set(bytes, 0); out.set(iend, bytes.length);
  actions.push('Appended the missing IEND chunk (truncated file)');
  return { data: out, actions, ok: true, info: scan.ihdr, truncated: scan.truncated, needsPartialDecode: true };
}

// ---------------------------------------------------------------- carving

function findBytesIn(hay, needle, from) {
  const n0 = needle[0], L = needle.length, end = hay.length - L;
  for (let i = from; i <= end; i++) {
    if (hay[i] !== n0) continue;
    let ok = true;
    for (let k = 1; k < L; k++) if (hay[i + k] !== needle[k]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

// Carve every embedded image out of a blob / fragment / mis-typed file by scanning
// for format signatures and measuring each image's real extent (JPEG via the marker
// walk so an embedded EXIF thumbnail isn't mistaken for the end; PNG via its chunk
// walk; GIF/WebP/BMP via their declared sizes). Returns [{format, start, end}].
export function carveImages(bytes, opts = {}) {
  const found = [];
  const max = opts.max || 64;
  const n = bytes.length;
  let i = 0;
  while (i < n - 8 && found.length < max) {
    // JPEG: FF D8 FF
    if (bytes[i] === 0xFF && bytes[i + 1] === 0xD8 && bytes[i + 2] === 0xFF) {
      const scan = scanJpeg(bytes, i);
      if (scan && scan.sosAt >= 0) {
        const end = scan.hasEOI && scan.eoiAt != null ? scan.eoiAt + 2 : scan.scanEnd;
        found.push({ format: 'jpeg', start: i, end, complete: scan.hasEOI, width: scan.sof && scan.sof.width, height: scan.sof && scan.sof.height });
        i = Math.max(i + 2, end); continue;
      }
    }
    // PNG
    if (eq(bytes, i, PNG_SIG)) {
      const scan = scanPng(bytes.subarray(i));
      if (scan && scan.ihdr) {
        // Walk to IEND (or EOF) for the extent.
        let p = i + 8, end = n;
        while (p + 8 <= n) {
          const len = u32be(bytes, p); const type = ascii(bytes, p + 4, 4);
          if (p + 8 + len + 4 > n) { end = n; break; }
          if (type === 'IEND') { end = p + 8 + len + 4; break; }
          p = p + 8 + len + 4;
        }
        found.push({ format: 'png', start: i, end, complete: scan.hasIEND, width: scan.ihdr.width, height: scan.ihdr.height });
        i = Math.max(i + 8, end); continue;
      }
    }
    // GIF
    if (ascii(bytes, i, 3) === 'GIF' && (ascii(bytes, i + 3, 3) === '87a' || ascii(bytes, i + 3, 3) === '89a')) {
      const w = bytes[i + 6] | (bytes[i + 7] << 8), h = bytes[i + 8] | (bytes[i + 9] << 8);
      found.push({ format: 'gif', start: i, end: n, complete: false, width: w, height: h });
      i += 6; continue;
    }
    // WebP (RIFF....WEBP)
    if (ascii(bytes, i, 4) === 'RIFF' && ascii(bytes, i + 8, 4) === 'WEBP') {
      const size = u32le(bytes, i + 4) + 8;
      found.push({ format: 'webp', start: i, end: Math.min(n, i + size), complete: i + size <= n });
      i += 12; continue;
    }
    // BMP
    if (bytes[i] === 0x42 && bytes[i + 1] === 0x4D) {
      const size = u32le(bytes, i + 2);
      if (size > 26 && size < n - i + 1024) { found.push({ format: 'bmp', start: i, end: Math.min(n, i + size), complete: i + size <= n }); i += 2; continue; }
    }
    i++;
  }
  return found;
}

// ---------------------------------------------------------------- ISOBMFF (HEIF/AVIF)

// Detect a truncated HEIF/HEIC/AVIF: an ftyp + a meta/mdat whose iloc points past
// EOF, or an mdat that overruns the file. Geometry/decoding reuse the existing HEIF
// path; this just flags damage and the recoverable byte range.
export function diagnoseHeif(bytes) {
  if (ascii(bytes, 4, 4) !== 'ftyp') return null;
  const n = bytes.length;
  let p = 0, mdat = null, hasMeta = false;
  for (let guard = 0; guard < 256 && p + 8 <= n; guard++) {
    let size = u32be(bytes, p); const type = ascii(bytes, p + 4, 4); let hs = 8;
    if (size === 1) { size = u32be(bytes, p + 8) * 0x100000000 + u32be(bytes, p + 12); hs = 16; }
    else if (size === 0) size = n - p;
    if (size < 8) break;
    if (type === 'meta') hasMeta = true;
    if (type === 'mdat') mdat = { start: p + hs, declaredEnd: p + size };
    p += size;
  }
  const truncated = !!(mdat && mdat.declaredEnd > n);
  return { format: sniffImageFormat(bytes), hasMeta, mdat, truncated, missingBytes: mdat ? Math.max(0, mdat.declaredEnd - n) : 0 };
}

// Repair a truncated HEIF/HEIC/AVIF container so a tolerant decoder (libheif /
// browser) can still extract the tiles that survived. These formats put their
// metadata (iloc/hvcC) at the FRONT, so a tail-truncated file keeps a decodable
// image - but the mdat box header still declares its full original length, which
// overruns EOF and makes stricter decoders reject the whole file. Clamping that
// length to the bytes actually present fixes it. Returns repaired bytes + actions.
export function repairHeifContainer(bytes) {
  const actions = [];
  const n = bytes.length;
  let p = 0, mdatAt = -1, hs = 8, declaredEnd = 0;
  for (let g = 0; g < 256 && p + 8 <= n; g++) {
    let size = u32be(bytes, p); const type = ascii(bytes, p + 4, 4); let h = 8;
    if (size === 1) { size = u32be(bytes, p + 8) * 0x100000000 + u32be(bytes, p + 12); h = 16; }
    else if (size === 0) size = n - p;
    if (type === 'mdat') { mdatAt = p; hs = h; declaredEnd = p + size; break; }
    if (size < 8) break;
    p += size;
  }
  if (mdatAt < 0 || declaredEnd <= n) return { data: bytes.slice(), actions, truncated: false };
  const out = bytes.slice();
  const actual = n - mdatAt;
  if (hs === 16) {
    const hi = Math.floor(actual / 0x100000000), lo = actual >>> 0;
    out[mdatAt + 8] = (hi >>> 24) & 0xFF; out[mdatAt + 9] = (hi >>> 16) & 0xFF; out[mdatAt + 10] = (hi >>> 8) & 0xFF; out[mdatAt + 11] = hi & 0xFF;
    out[mdatAt + 12] = (lo >>> 24) & 0xFF; out[mdatAt + 13] = (lo >>> 16) & 0xFF; out[mdatAt + 14] = (lo >>> 8) & 0xFF; out[mdatAt + 15] = lo & 0xFF;
  } else if (actual <= 0xFFFFFFFF) {
    out[mdatAt] = (actual >>> 24) & 0xFF; out[mdatAt + 1] = (actual >>> 16) & 0xFF; out[mdatAt + 2] = (actual >>> 8) & 0xFF; out[mdatAt + 3] = actual & 0xFF;
  }
  actions.push('Clamped the truncated media-data box to the file length');
  return { data: out, actions, truncated: true, missingBytes: declaredEnd - n };
}

// ---------------------------------------------------------------- diagnosis

// Top-level health check. Returns the format and a list of concrete problems, used
// to decide whether to offer salvage and what to tell the user.
export function diagnoseImage(bytes) {
  const format = sniffImageFormat(bytes);
  const issues = [];
  if (!format) {
    const carved = carveImages(bytes, { max: 8 });
    return { format: null, healthy: false, carved, issues: carved.length ? [{ code: 'embedded', msg: carved.length + ' embedded image(s) found in unrecognised data' }] : [{ code: 'unknown', msg: 'no recognised image signature' }] };
  }
  if (format === 'jpeg') {
    const scan = scanJpeg(bytes, 0) || scanJpeg(bytes, Math.max(0, findBytesIn(bytes, [0xFF, 0xD8, 0xFF], 0)));
    if (!scan) issues.push({ code: 'jpeg-nosoi', msg: 'JPEG start marker not found at the head' });
    else {
      if (!scan.hasEOI) issues.push({ code: 'jpeg-noeoi', msg: 'no end-of-image marker - file is truncated' });
      if (!scan.dqt) issues.push({ code: 'jpeg-nodqt', msg: 'quantisation tables (DQT) missing - header damaged' });
      if (!scan.dht) issues.push({ code: 'jpeg-nodht', msg: 'Huffman tables (DHT) missing - header damaged' });
      if (!scan.sof) issues.push({ code: 'jpeg-nosof', msg: 'frame header (SOF) missing - dimensions unknown' });
      if (scan.truncated) issues.push({ code: 'jpeg-trunc', msg: 'marker stream ends early - file is truncated' });
    }
    return { format, healthy: issues.length === 0, issues, jpeg: scan };
  }
  if (format === 'png') {
    const scan = scanPng(bytes);
    if (!scan || !scan.ihdr) issues.push({ code: 'png-noihdr', msg: 'IHDR header chunk missing or unreadable' });
    else {
      if (!scan.hasIEND) issues.push({ code: 'png-noiend', msg: 'no IEND chunk - file is truncated' });
      if (scan.truncated) issues.push({ code: 'png-trunc', msg: 'chunk stream ends early - file is truncated' });
    }
    return { format, healthy: issues.length === 0, issues, png: scan };
  }
  if (format === 'heif' || format === 'avif') {
    const h = diagnoseHeif(bytes);
    if (h && h.truncated) issues.push({ code: 'heif-trunc', msg: 'media data is truncated (' + h.missingBytes + ' bytes short)' });
    return { format, healthy: issues.length === 0, issues, heif: h };
  }
  return { format, healthy: true, issues };
}
