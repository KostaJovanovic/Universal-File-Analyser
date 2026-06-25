/* Analyser - video recovery module
   Recovers playable video from a truncated / unfinalised ISOBMFF (MP4/MOV)
   recording whose `moov` index is missing - the classic "camera/card was
   interrupted before finalising" or "file copy stopped early" corruption (Sony
   XAVC, GoPro, DJI, phones). With no `moov` there are no sample tables, so no
   player can index the file; but the `mdat` still holds the encoded video.

   Strategy (verified against real Sony FX30 XAVC footage):
   1. Detect ftyp + mdat with no moov.
   2. Carve the H.264/H.265 video out of the mdat. MP4 stores each NAL unit
      length-prefixed (not Annex B), interleaved with audio/metadata samples we
      can't index. We walk the mdat as a chain of length-prefixed NALs, validating
      each against the next so audio/KLV bytes can't masquerade as video, and
      resync byte-by-byte across the gaps. Each accepted NAL is re-emitted with an
      Annex B start code.
   3. Cameras like Sony store the SPS/PPS only in the (missing) avcC, never in-band,
      so a carved stream alone won't decode. The caller supplies parameter sets -
      either found in-band, or lifted from a healthy reference clip shot on the
      same camera in the same mode - which we prepend.

   The result is a raw Annex B elementary stream the existing raw-H.264 segmented
   player can play and analyse. Pure helpers only (no DOM); reader(start,end) ->
   Promise<Uint8Array> abstracts the byte source so this runs identically under the
   browser File API and a Node test harness. */

function fourcc(u8, p) {
  return String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
}

// Walk the top-level ISOBMFF boxes looking for the moov-less signature: an ftyp
// followed by an mdat with no moov anywhere. Returns null for a normal file (moov
// present, or not ISOBMFF at all). On a hit, returns the mdat payload range plus
// how much data the mdat header claims is missing past EOF (the truncation gap).
export async function detectMoovlessMp4(reader, size) {
  if (size < 16) return null;
  const head = await reader(0, 16);
  if (head.length < 8 || fourcc(head, 4) !== 'ftyp') return null;

  let pos = 0, mdat = null, hasMoov = false;
  // A handful of giant boxes max; the mdat's (over-large) declared size ends the
  // walk for a truncated file before we'd ever loop unreasonably.
  for (let guard = 0; guard < 1024 && pos + 8 <= size; guard++) {
    const hb = await reader(pos, Math.min(size, pos + 16));
    if (hb.length < 8) break;
    const dv = new DataView(hb.buffer, hb.byteOffset, hb.length);
    let boxSize = dv.getUint32(0);
    const type = fourcc(hb, 4);
    let hsize = 8;
    if (boxSize === 1 && hb.length >= 16) {
      boxSize = dv.getUint32(8) * 0x100000000 + dv.getUint32(12);
      hsize = 16;
    } else if (boxSize === 0) {
      boxSize = size - pos;  // box runs to EOF
    }
    if (boxSize < 8) break;
    if (type === 'moov') { hasMoov = true; break; }
    if (type === 'mdat') mdat = { start: pos + hsize, declaredEnd: pos + boxSize };
    pos += boxSize;
  }

  if (hasMoov || !mdat) return null;
  const mdatEnd = Math.min(mdat.declaredEnd, size);
  return {
    moovless: true,
    mdatStart: mdat.start,
    mdatEnd,
    declaredMdatEnd: mdat.declaredEnd,
    truncated: mdat.declaredEnd > size,
    missingBytes: Math.max(0, mdat.declaredEnd - size),
  };
}

// Locate a 32-bit box by its 4CC anywhere inside an in-memory region via a byte
// scan, returning its data range. The codec-config boxes we want (avcC, hvcC) and
// the sample entries (avc1, hvc1) are nested inside the avc1/hvc1 VisualSampleEntry,
// which carries a fixed 78-byte header that a generic box-tree walk would have to
// special-case; a tag scan sidesteps that. The 4 bytes preceding the tag are the
// box size, validated to reject a coincidental match inside a string/payload.
function locateTag(u8, start, end, type) {
  const a = type.charCodeAt(0), b = type.charCodeAt(1), c = type.charCodeAt(2), d = type.charCodeAt(3);
  for (let i = Math.max(start, 4); i + 4 <= end; i++) {
    if (u8[i] === a && u8[i + 1] === b && u8[i + 2] === c && u8[i + 3] === d) {
      const boxSize = (u8[i - 4] << 24 | u8[i - 3] << 16 | u8[i - 2] << 8 | u8[i - 1]) >>> 0;
      if (boxSize >= 8 && i - 4 + boxSize <= end + 8) {
        return { dataStart: i + 4, dataEnd: Math.min(i - 4 + boxSize, end), tagAt: i };
      }
    }
  }
  return null;
}

// Concatenate parameter-set NAL payloads into one Annex B blob (4-byte start codes).
function toAnnexB(nals) {
  let total = 0;
  for (const n of nals) total += 4 + n.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const n of nals) { out[p + 3] = 1; p += 4; out.set(n, p); p += n.length; }
  return out;
}

// Lift the codec parameter sets (SPS/PPS, plus HEVC VPS) and stream geometry from a
// healthy reference MP4/MOV's avcC / hvcC box. Used to supply the params a
// moov-less clip is missing. Returns null if the file has no usable config box.
export async function extractMp4ParamSets(reader, size) {
  const det = await (async () => {
    // Walk top-level boxes to the moov (may sit before or after mdat). Reference
    // clips are healthy and small, so reading the whole moov is cheap.
    let pos = 0;
    for (let guard = 0; guard < 1024 && pos + 8 <= size; guard++) {
      const hb = await reader(pos, Math.min(size, pos + 16));
      if (hb.length < 8) break;
      const dv = new DataView(hb.buffer, hb.byteOffset, hb.length);
      let boxSize = dv.getUint32(0);
      const type = fourcc(hb, 4);
      let hsize = 8;
      if (boxSize === 1 && hb.length >= 16) { boxSize = dv.getUint32(8) * 0x100000000 + dv.getUint32(12); hsize = 16; }
      else if (boxSize === 0) boxSize = size - pos;
      if (boxSize < 8) break;
      if (type === 'moov') return { start: pos + hsize, end: Math.min(pos + boxSize, size) };
      pos += boxSize;
    }
    return null;
  })();
  if (!det) return null;

  const moov = await reader(det.start, det.end);
  const dv = new DataView(moov.buffer, moov.byteOffset, moov.length);
  const N = moov.length;

  // H.264 avcC.
  const avcc = locateTag(moov, 0, N, 'avcC');
  if (avcc) {
    let p = avcc.dataStart;
    const profile = moov[p + 1], level = moov[p + 3];
    const lenSize = (moov[p + 4] & 0x03) + 1;
    p += 5;
    const nals = [];
    const numSps = moov[p] & 0x1f; p += 1;
    for (let i = 0; i < numSps && p + 2 <= avcc.dataEnd; i++) { const l = dv.getUint16(p); p += 2; nals.push(moov.slice(p, p + l)); p += l; }
    const numPps = p < avcc.dataEnd ? moov[p] : 0; p += 1;
    for (let i = 0; i < numPps && p + 2 <= avcc.dataEnd; i++) { const l = dv.getUint16(p); p += 2; nals.push(moov.slice(p, p + l)); p += l; }
    if (!nals.length) return null;
    const dims = avcDims(moov, dv, N);
    return { codec: 'h264', profile, level, lenSize, paramSets: toAnnexB(nals), ...dims };
  }

  // H.265 hvcC: configVer(1) ... then at +22 a NAL-array count, each array is
  // {type(1), numNalus(2), [len(2)+nalu]...}.
  const hvcc = locateTag(moov, 0, N, 'hvcC');
  if (hvcc) {
    const d = hvcc.dataStart;
    const lenSize = (moov[d + 21] & 0x03) + 1;
    let p = d + 22;
    const numArrays = moov[p]; p += 1;
    const nals = [];
    for (let a = 0; a < numArrays && p + 3 <= hvcc.dataEnd; a++) {
      p += 1; // array_completeness + NAL_unit_type
      const numNalus = dv.getUint16(p); p += 2;
      for (let i = 0; i < numNalus && p + 2 <= hvcc.dataEnd; i++) { const l = dv.getUint16(p); p += 2; nals.push(moov.slice(p, p + l)); p += l; }
    }
    if (!nals.length) return null;
    const dims = hvcDims(moov, dv, N);
    return { codec: 'h265', lenSize, paramSets: toAnnexB(nals), ...dims };
  }
  return null;
}

// Stored pixel width/height from the avc1/hvc1 VisualSampleEntry (box hdr 8 +
// SampleEntry 8 + 16 reserved, then width(2) height(2)). locateTag returns the
// position just after the 4CC, i.e. the SampleEntry body start, so width sits 24
// bytes in (8 SampleEntry reserved/data_ref + 16 VisualSampleEntry pre-defined).
function sampleEntryDims(u8, dv, N, fcc) {
  const box = locateTag(u8, 0, N, fcc);
  if (!box) return {};
  const dim = box.dataStart + 24;
  if (dim + 4 > N) return {};
  const w = dv.getUint16(dim), h = dv.getUint16(dim + 2);
  return (w > 0 && h > 0) ? { width: w, height: h } : {};
}
function avcDims(u8, dv, N) { return sampleEntryDims(u8, dv, N, 'avc1'); }
function hvcDims(u8, dv, N) { return sampleEntryDims(u8, dv, N, 'hvc1'); }

// Valid video NAL types we accept while carving. Slices/IDR/SEI/AUD/SPS/PPS for
// H.264; for HEVC the set spans VCL 0..31 plus VPS/SPS/PPS/AUD/SEI (32..39).
const H264_VID = new Set([1, 5, 6, 7, 8, 9]);
function isVidType(t, h265) {
  if (h265) return (t >= 0 && t <= 21) || (t >= 32 && t <= 39);
  return H264_VID.has(t);
}

// Carve the length-prefixed video elementary stream out of a moov-less mdat into
// Annex B. Reads the mdat in large overlapping windows (so multi-GB files stream
// from disk, never loaded whole) and walks length-prefixed NALs, validating each
// position against a short following chain so interleaved audio/metadata can't be
// mistaken for video. Returns { parts, nals, bytes, types }: `parts` is an array
// of Uint8Array windows ready to wrap in a Blob with the parameter sets prepended.
// onProgress(fraction, info) is called periodically. opts.onChunk(uint8), if
// given, receives each window's Annex B output as it's produced and the chunk is
// NOT retained - essential in the browser, where a multi-GB carve must stream into
// a disk-backed Blob rather than pile ~9 GB of Uint8Arrays onto the JS heap. With
// no onChunk the chunks accumulate in the returned `parts` array (Node tests).
export async function carveAvccToAnnexB(reader, mdatStart, mdatEnd, opts = {}) {
  const lenSize = opts.lenSize || 4;
  const h265 = opts.codec === 'h265';
  const signal = opts.signal;
  const onProgress = opts.onProgress;
  const WIN = opts.windowSize || 64 * 1024 * 1024;
  const MARGIN = 24 * 1024 * 1024;       // largest single NAL we expect (a 4K IDR slice) + lookahead
  const MAX_NAL = 24 * 1024 * 1024;
  const parts = [];
  let nals = 0, bytes = 0;
  const types = {};
  // Capture the stream's OWN parameter sets as we pass them. Cameras vary on
  // whether (and how often) they embed SPS/PPS in-band, but when present these
  // carry the exact ids the slices reference - far more reliable than borrowing a
  // reference clip's (whose PPS ids may differ). Deduped by content; prepended by
  // the caller so frames before the first in-band copy still decode.
  const isParam = (t) => h265 ? (t === 32 || t === 33 || t === 34) : (t === 7 || t === 8);
  const paramSeen = new Set();
  const paramNals = [];   // { t, nal }

  // Read a uint of lenSize big-endian at buf offset i.
  const readLen = (buf, i) => {
    let v = 0;
    for (let k = 0; k < lenSize; k++) v = v * 256 + buf[i + k];
    return v;
  };
  // Is there a valid NAL at buf offset i (within [0,n))? Returns its total span
  // (lenSize + L) or 0.
  const nalAt = (buf, n, i) => {
    if (i + lenSize + 1 > n) return 0;
    const L = readLen(buf, i);
    if (L < 1 || L > MAX_NAL || i + lenSize + L > n) return 0;
    const hb = buf[i + lenSize];
    if (hb & 0x80) return 0;            // forbidden_zero_bit must be 0
    const t = h265 ? ((hb >> 1) & 0x3f) : (hb & 0x1f);
    if (!isVidType(t, h265)) return 0;
    return lenSize + L;
  };
  // Validate a chain of k NALs starting at i (so a stray valid-looking prefix in
  // PCM audio doesn't get accepted - real video NALs tile exactly).
  const chainOk = (buf, n, i, k) => {
    let q = i;
    for (let c = 0; c < k; c++) {
      const span = nalAt(buf, n, q);
      if (!span) return false;
      q += span;
    }
    return true;
  };

  let pos = mdatStart;
  while (pos < mdatEnd) {
    if (signal && signal.aborted) throw new DOMException('aborted', 'AbortError');
    const winEnd = Math.min(mdatEnd, pos + WIN);
    const buf = await reader(pos, winEnd);
    const n = buf.length;
    if (n < lenSize + 1) break;
    const atEof = winEnd >= mdatEnd;
    // Only emit NALs that fit fully before the margin (so nothing straddles the
    // window edge); the tail past the limit is reparsed at the start of the next
    // window. At EOF, parse right to the end.
    const limit = atEof ? n : Math.max(0, n - MARGIN);

    const out = new Uint8Array(n);   // output can't exceed input (we only drop bytes)
    let op = 0;
    let i = 0;
    while (i < limit) {
      const span = nalAt(buf, n, i);
      // Require a 3-NAL chain except right at EOF where the last NAL(s) may be cut.
      if (span && (chainOk(buf, n, i, 3) || (atEof && chainOk(buf, n, i, 1)))) {
        const L = span - lenSize;
        const hb = buf[i + lenSize];
        const t = h265 ? ((hb >> 1) & 0x3f) : (hb & 0x1f);
        // Annex B start code + NAL payload.
        out[op + 3] = 1; op += 4;
        out.set(buf.subarray(i + lenSize, i + lenSize + L), op); op += L;
        nals++; bytes += 4 + L; types[t] = (types[t] || 0) + 1;
        if (isParam(t) && L < 4096) {
          const nal = buf.slice(i + lenSize, i + lenSize + L);
          // Key on type + length + a few bytes - enough to distinguish distinct
          // SPS/PPS ids without hashing the whole NAL.
          const key = t + ':' + L + ':' + nal[1] + ',' + nal[2] + ',' + nal[3] + ',' + nal[Math.min(L - 1, 8)];
          if (!paramSeen.has(key)) { paramSeen.add(key); paramNals.push({ t, nal }); }
        }
        i += span;
      } else {
        i += 1;   // resync across audio / KLV metadata
      }
    }
    if (op > 0) {
      const chunk = out.slice(0, op);
      if (opts.onChunk) opts.onChunk(chunk); else parts.push(chunk);
    }

    if (atEof) break;
    pos += i;                 // resume exactly where we stopped (a NAL/resync boundary)
    if (onProgress) onProgress((pos - mdatStart) / (mdatEnd - mdatStart), { nals, bytes });
  }
  if (onProgress) onProgress(1, { nals, bytes });
  // Build Annex B parameter sets from what we captured in-band (VPS/SPS before PPS).
  const order = h265 ? [32, 33, 34, 7, 8] : [7, 8];
  paramNals.sort((a, b) => order.indexOf(a.t) - order.indexOf(b.t));
  const essential = h265 ? [33, 34] : [7, 8];
  const haveEssential = essential.every((t) => paramNals.some((p) => p.t === t));
  const inbandParams = haveEssential ? toAnnexB(paramNals.map((p) => p.nal)) : null;
  return { parts, nals, bytes, types, inbandParams };
}

// Scan the head of a moov-less mdat for in-band parameter sets (length-prefixed
// SPS/PPS, or HEVC VPS/SPS/PPS). Cameras that embed them per-IDR (GoPro, DJI, many
// phones) need no reference clip; Sony XAVC does not embed them, so this returns
// null and the caller asks for a reference. scanBytes defaults to 64 MB.
export async function findInbandParamSets(reader, mdatStart, mdatEnd, opts = {}) {
  const lenSize = opts.lenSize || 4;
  const h265 = opts.codec === 'h265';
  const scanEnd = Math.min(mdatEnd, mdatStart + (opts.scanBytes || 64 * 1024 * 1024));
  const buf = await reader(mdatStart, scanEnd);
  const n = buf.length;
  const want = h265 ? [32, 33, 34] : [7, 8];
  const found = new Map();
  const readLen = (i) => { let v = 0; for (let k = 0; k < lenSize; k++) v = v * 256 + buf[i + k]; return v; };
  const nalAt = (i) => {
    if (i + lenSize + 1 > n) return 0;
    const L = readLen(i);
    if (L < 1 || L > 24 * 1024 * 1024 || i + lenSize + L > n) return 0;
    if (buf[i + lenSize] & 0x80) return 0;
    const t = h265 ? ((buf[i + lenSize] >> 1) & 0x3f) : (buf[i + lenSize] & 0x1f);
    return isVidType(t, h265) ? lenSize + L : 0;
  };
  let i = 0;
  while (i + lenSize + 1 <= n) {
    const span = nalAt(i);
    if (span) {
      const hb = buf[i + lenSize];
      const t = h265 ? ((hb >> 1) & 0x3f) : (hb & 0x1f);
      // Param-set NALs are small; guard against a giant false positive.
      const L = span - lenSize;
      if (want.includes(t) && !found.has(t) && L < 4096) found.set(t, buf.slice(i + lenSize, i + lenSize + L));
      i += span;
      if (want.every((t2) => found.has(t2))) break;
    } else i += 1;
  }
  const essential = h265 ? [33, 34] : [7, 8];   // VPS optional
  if (!essential.every((t) => found.has(t))) return null;
  const order = h265 ? [32, 33, 34] : [7, 8];
  const nals = order.filter((t) => found.has(t)).map((t) => found.get(t));
  return toAnnexB(nals);
}
