/* Analyser - fault-tolerant baseline JPEG decoder

   The browser's built-in decoder renders NOTHING from a JPEG whose entropy scan is
   truncated or corrupt partway - a carved fragment, a deleted photo whose tail was
   overwritten, an MJPEG frame that goes bad. It either errors outright or hands back
   a blank frame. This decoder is deliberately lenient: it decodes MCUs one at a time
   and, the moment the bitstream runs out or a Huffman code goes invalid, STOPS and
   returns everything it managed - the recoverable top of the picture - with the rest
   left mid-grey (the same "no data" fill libjpeg/PIL leave). That is the difference
   between "no preview" and seeing the top two-thirds of a lost photo.

   Baseline sequential, Huffman-coded only (SOF0/SOF1) - which is every camera still
   and every MJPEG frame. Progressive (SOF2), arithmetic and lossless return null;
   the browser handles those normally and they don't occur in the carve set here.

   Pure and DOM-free: takes a Uint8Array, returns { width, height, data (RGBA),
   rows } or null, so it runs under a Node test harness against real images. */

/** One frame component (Y / Cb / Cr). parseHeader fills the SOF fields; the
 *  decode loop then hangs its per-component decode state off the same object. */
interface JpegComp {
  id: number; h: number; v: number; qId: number;
  // Filled in by decodeJpegPartial before the scan loop starts (the SOF push
  // below is cast in, since parseHeader only knows the first four).
  dcTab: HuffTable; acTab: HuffTable; quant: Int32Array;
  pw: number; ph: number; plane: Uint8ClampedArray; pred: number;
}

/** A canonical Huffman decode table as built by buildHuff(). */
type HuffTable = ReturnType<typeof buildHuff>;

/** What decodeJpegPartial hands back: the RGBA raster plus how much of it is
 *  real (see the header comment). Spelled out because the function recurses. */
interface PartialJpeg {
  width: number; height: number; data: Uint8ClampedArray<ArrayBuffer>; rows: number;
  corrupt?: boolean; realRows?: number; thumb?: boolean;
}

// Natural-order position of each coefficient in zig-zag sequence.
const ZIG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

// Build the canonical Huffman decode tables (ITU-T T.81 Annex F) from a DHT's 16
// length-counts + value bytes: mincode/maxcode/valptr let decodeHuff walk bit by bit.
function buildHuff(counts: ArrayLike<number>, values: ArrayLike<number>) {
  const sizes = [];
  for (let l = 0; l < 16; l++) for (let i = 0; i < counts[l]; i++) sizes.push(l + 1);
  const codes = [];
  let code = 0, k = 0;
  while (k < sizes.length) {
    const si = sizes[k];
    while (k < sizes.length && sizes[k] === si) { codes.push(code); code++; k++; }
    // Shift by the jump to the next present length, not always 1: a length with no
    // codes (a gap, common in AC tables) needs multiple shifts or every longer code
    // comes out wrong and the bitstream desyncs.
    if (k < sizes.length) code <<= (sizes[k] - si);
  }
  const mincode = new Int32Array(17), maxcode = new Int32Array(18).fill(-1), valptr = new Int32Array(17);
  let p = 0;
  for (let l = 1; l <= 16; l++) {
    if (counts[l - 1]) { valptr[l] = p; mincode[l] = codes[p]; p += counts[l - 1]; maxcode[l] = codes[p - 1]; }
  }
  return { mincode, maxcode, valptr, values };
}

// The standard JPEG Huffman tables (Annex K), used when a scan cites a table the
// file never defined - the Motion-JPEG case (a frame, or a mid-stream thumbnail),
// where the tables live once in the container. Indexed [luma, chroma].
const STD = (() => {
  const DCV = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const ACL = [1,2,3,0,4,17,5,18,33,49,65,6,19,81,97,7,34,113,20,50,129,145,161,8,35,66,177,193,21,82,209,240,36,51,98,114,130,9,10,22,23,24,25,26,37,38,39,40,41,42,52,53,54,55,56,57,58,67,68,69,70,71,72,73,74,83,84,85,86,87,88,89,90,99,100,101,102,103,104,105,106,115,116,117,118,119,120,121,122,131,132,133,134,135,136,137,138,146,147,148,149,150,151,152,153,154,162,163,164,165,166,167,168,169,170,178,179,180,181,182,183,184,185,186,194,195,196,197,198,199,200,201,202,210,211,212,213,214,215,216,217,218,225,226,227,228,229,230,231,232,233,234,241,242,243,244,245,246,247,248,249,250];
  const ACC = [0,1,2,3,17,4,5,33,49,6,18,65,81,7,97,113,19,34,50,129,8,20,66,145,161,177,193,9,35,51,82,240,21,98,114,209,10,22,36,52,225,37,241,23,24,25,26,38,39,40,41,42,53,54,55,56,57,58,67,68,69,70,71,72,73,74,83,84,85,86,87,88,89,90,99,100,101,102,103,104,105,106,115,116,117,118,119,120,121,122,130,131,132,133,134,135,136,137,138,146,147,148,149,150,151,152,153,154,162,163,164,165,166,167,168,169,170,178,179,180,181,182,183,184,185,186,194,195,196,197,198,199,200,201,202,210,211,212,213,214,215,216,217,218,226,227,228,229,230,231,232,233,234,242,243,244,245,246,247,248,249,250];
  return {
    dc: [buildHuff([0,1,5,1,1,1,1,1,1,0,0,0,0,0,0,0], DCV), buildHuff([0,3,1,1,1,1,1,1,1,1,1,0,0,0,0,0], DCV)],
    ac: [buildHuff([0,2,1,3,3,2,4,3,5,5,4,4,0,0,1,0x7d], ACL), buildHuff([0,2,1,2,4,4,3,4,7,5,4,4,0,1,2,0x77], ACC)],
  };
})();

// Reads bits MSB-first out of the entropy stream, transparently un-stuffing FF00 and
// stopping cleanly at any real marker (restart, EOI, or corruption). `hitMarker`
// tells the decode loop the stream ended so it can finish the partial picture.
class BitReader {
  data: Uint8Array;
  pos: number;
  cur: number;
  count: number;
  hitMarker: boolean;
  constructor(data: Uint8Array, pos: number) { this.data = data; this.pos = pos; this.cur = 0; this.count = 0; this.hitMarker = false; }
  bit() {
    if (this.count === 0) {
      if (this.pos >= this.data.length) { this.hitMarker = true; return 0; }
      let b = this.data[this.pos++];
      if (b === 0xFF) {
        const b2 = this.pos < this.data.length ? this.data[this.pos] : 0xD9;
        if (b2 === 0x00) this.pos++;                 // stuffed literal 0xFF
        else { this.pos--; this.hitMarker = true; return 0; }   // real marker - stop
      }
      this.cur = b; this.count = 8;
    }
    this.count--;
    return (this.cur >> this.count) & 1;
  }
  bits(n: number) { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | this.bit(); return v; }
  // At a restart interval: drop the partial byte and skip an FF D0-D7 marker.
  restart() {
    this.count = 0;
    if (this.pos + 1 < this.data.length && this.data[this.pos] === 0xFF) {
      const m = this.data[this.pos + 1];
      if (m >= 0xD0 && m <= 0xD7) this.pos += 2;
    }
    this.hitMarker = false;
  }
}

function decodeHuff(br: BitReader, tab: HuffTable) {
  let code = 0;
  for (let len = 1; len <= 16; len++) {
    code = (code << 1) | br.bit();
    if (br.hitMarker) return -1;
    if (tab.maxcode[len] >= 0 && code <= tab.maxcode[len]) return tab.values[tab.valptr[len] + code - tab.mincode[len]];
  }
  return -1;                                          // no code matched - corrupt
}

// Sign-extend an s-bit magnitude to a signed DCT coefficient (T.81 receive/extend).
function extend(v: number, s: number) { return v < (1 << (s - 1)) ? v - (1 << s) + 1 : v; }

// Integer inverse DCT (row then column pass), after Fiedler's public-domain NanoJPEG.
const W1 = 2841, W2 = 2676, W3 = 2408, W5 = 1609, W6 = 1108, W7 = 565;
function rowIDCT(blk: Int32Array, o: number) {
  let x0, x1, x2, x3, x4, x5, x6, x7, x8;
  x1 = blk[o + 4] << 11; x2 = blk[o + 6]; x3 = blk[o + 2]; x4 = blk[o + 1];
  x5 = blk[o + 7]; x6 = blk[o + 5]; x7 = blk[o + 3];
  if (!(x1 | x2 | x3 | x4 | x5 | x6 | x7)) {
    const dc = blk[o] << 3;
    for (let i = 0; i < 8; i++) blk[o + i] = dc;
    return;
  }
  x0 = (blk[o] << 11) + 128;
  x8 = W7 * (x4 + x5); x4 = x8 + (W1 - W7) * x4; x5 = x8 - (W1 + W7) * x5;
  x8 = W3 * (x6 + x7); x6 = x8 - (W3 - W5) * x6; x7 = x8 - (W3 + W5) * x7;
  x8 = x0 + x1; x0 -= x1;
  x1 = W6 * (x3 + x2); x2 = x1 - (W2 + W6) * x2; x3 = x1 + (W2 - W6) * x3;
  x1 = x4 + x6; x4 -= x6; x6 = x5 + x7; x5 -= x7;
  x7 = x8 + x3; x8 -= x3; x3 = x0 + x2; x0 -= x2;
  x2 = (181 * (x4 + x5) + 128) >> 8; x4 = (181 * (x4 - x5) + 128) >> 8;
  blk[o] = (x7 + x1) >> 8; blk[o + 1] = (x3 + x2) >> 8; blk[o + 2] = (x0 + x4) >> 8; blk[o + 3] = (x8 + x6) >> 8;
  blk[o + 4] = (x8 - x6) >> 8; blk[o + 5] = (x0 - x4) >> 8; blk[o + 6] = (x3 - x2) >> 8; blk[o + 7] = (x7 - x1) >> 8;
}
function colIDCT(blk: Int32Array, o: number, out: Uint8ClampedArray, outPos: number, stride: number) {
  let x0, x1, x2, x3, x4, x5, x6, x7, x8;
  x1 = blk[o + 32] << 8; x2 = blk[o + 48]; x3 = blk[o + 16]; x4 = blk[o + 8];
  x5 = blk[o + 56]; x6 = blk[o + 40]; x7 = blk[o + 24];
  if (!(x1 | x2 | x3 | x4 | x5 | x6 | x7)) {
    let dc = ((blk[o] + 32) >> 6) + 128;
    dc = dc < 0 ? 0 : dc > 255 ? 255 : dc;
    for (let i = 0; i < 8; i++) { out[outPos] = dc; outPos += stride; }
    return;
  }
  x0 = (blk[o] << 8) + 8192;
  x8 = W7 * (x4 + x5) + 4; x4 = (x8 + (W1 - W7) * x4) >> 3; x5 = (x8 - (W1 + W7) * x5) >> 3;
  x8 = W3 * (x6 + x7) + 4; x6 = (x8 - (W3 - W5) * x6) >> 3; x7 = (x8 - (W3 + W5) * x7) >> 3;
  x8 = x0 + x1; x0 -= x1;
  x1 = W6 * (x3 + x2) + 4; x2 = (x1 - (W2 + W6) * x2) >> 3; x3 = (x1 + (W2 - W6) * x3) >> 3;
  x1 = x4 + x6; x4 -= x6; x6 = x5 + x7; x5 -= x7;
  x7 = x8 + x3; x8 -= x3; x3 = x0 + x2; x0 -= x2;
  x2 = (181 * (x4 + x5) + 128) >> 8; x4 = (181 * (x4 - x5) + 128) >> 8;
  const clip = (v: number) => { v = (v >> 14) + 128; return v < 0 ? 0 : v > 255 ? 255 : v; };
  out[outPos] = clip(x7 + x1); out[outPos + stride] = clip(x3 + x2); out[outPos + 2 * stride] = clip(x0 + x4); out[outPos + 3 * stride] = clip(x8 + x6);
  out[outPos + 4 * stride] = clip(x8 - x6); out[outPos + 5 * stride] = clip(x0 - x4); out[outPos + 6 * stride] = clip(x3 - x2); out[outPos + 7 * stride] = clip(x7 - x1);
}

// Parse just enough of the JPEG header to decode the scan; ignore APPn/COM.
function parseHeader(d: Uint8Array) {
  if (d[0] !== 0xFF || d[1] !== 0xD8) return null;
  let p = 2;
  const qt: any = {}, huffDC: any = {}, huffAC: any = {};
  let frame = null, dri = 0;
  while (p + 4 <= d.length) {
    if (d[p] !== 0xFF) { p++; continue; }
    let m = d[p + 1]; p += 2;
    if (m === 0xD9 || (m >= 0xD0 && m <= 0xD7) || m === 0x01) continue;
    const len = (d[p] << 8) | d[p + 1];
    if (len < 2 || p + len > d.length) return null;
    const seg = p + 2, end = p + len;
    if (m === 0xDB) {                                 // DQT
      let q = seg;
      while (q < end) {
        const pq = d[q] >> 4, tq = d[q] & 15; q++;
        const t = new Int32Array(64);
        for (let i = 0; i < 64; i++) { t[i] = pq ? ((d[q] << 8) | d[q + 1]) : d[q]; q += pq ? 2 : 1; }
        qt[tq] = t;
      }
    } else if (m === 0xC4) {                           // DHT
      let q = seg;
      while (q < end) {
        const tc = d[q] >> 4, th = d[q] & 15; q++;
        const counts = d.subarray(q, q + 16); q += 16;
        let n = 0; for (let i = 0; i < 16; i++) n += counts[i];
        const values = d.subarray(q, q + n); q += n;
        (tc ? huffAC : huffDC)[th] = buildHuff(counts, values);
      }
    } else if (m === 0xDD) { dri = (d[seg] << 8) | d[seg + 1]; }   // DRI
    else if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
      if (m !== 0xC0 && m !== 0xC1) return null;       // baseline sequential only
      const comps: JpegComp[] = [];
      const nc = d[seg + 5];
      for (let i = 0; i < nc; i++) {
        const o = seg + 6 + i * 3;
        comps.push({ id: d[o], h: d[o + 1] >> 4, v: d[o + 1] & 15, qId: d[o + 2] } as JpegComp);
      }
      frame = { height: (d[seg + 1] << 8) | d[seg + 2], width: (d[seg + 3] << 8) | d[seg + 4], comps };
    } else if (m === 0xDA) {                           // SOS - scan header, then entropy data
      const ns = d[seg];
      const scan = [];
      for (let i = 0; i < ns; i++) { const o = seg + 1 + i * 2; scan.push({ id: d[o], dc: d[o + 1] >> 4, ac: d[o + 1] & 15 }); }
      return { frame, qt, huffDC, huffAC, dri, scan, scanStart: end };
    }
    p = end;
  }
  return null;
}

// Find the JPEG embedded as a thumbnail inside the header (a complete FF D8 ... FF D9
// within an APPn segment, before the main frame). EXIF (APP1) and some JFIF (APP0)
// files carry a small preview here; when the main image body was overwritten but the
// header cluster survived, this thumbnail still shows the real, downscaled picture.
// Returns the thumbnail's bytes, or null.
function findEmbeddedThumb(d: Uint8Array) {
  if (d.length < 4 || d[0] !== 0xFF || d[1] !== 0xD8) return null;
  let p = 2;
  while (p + 4 <= d.length) {
    if (d[p] !== 0xFF) { p++; continue; }
    const m = d[p + 1];
    // Stop at the main frame/scan - thumbnails only live in the APPn header block.
    if (m === 0xDA || m === 0xD9 || (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC)) break;
    if (m === 0xD8 || (m >= 0xD0 && m <= 0xD7) || m === 0x01) { p += 2; continue; }
    const len = (d[p + 2] << 8) | d[p + 3];
    if (len < 2 || p + 2 + len > d.length) break;
    if (m >= 0xE0 && m <= 0xEF) {                       // APPn may carry a nested JPEG
      const segEnd = p + 2 + len;
      for (let i = p + 4; i < segEnd - 3; i++) {
        if (d[i] === 0xFF && d[i + 1] === 0xD8 && d[i + 2] === 0xFF) {
          const lim = Math.min(d.length - 1, i + 300000);
          for (let j = i + 2; j < lim; j++) if (d[j] === 0xFF && d[j + 1] === 0xD9) return d.subarray(i, j + 2);
          return d.subarray(i, segEnd);                 // no EOI found - take the rest of the segment
        }
      }
    }
    p += 2 + len;
  }
  return null;
}

// Detect where a decoded scan silently went to garbage. A truncated/overwritten JPEG
// often keeps producing *valid* Huffman codes past the point its bitstream desynced,
// so the decode loop never errors - it just reconstructs nonsense: the DC predictor
// runs away and blocks pin to saturated, wildly-coloured noise (neon cyan/magenta
// bands), usually preceded by a stretch of flat DC-only slabs where the AC energy died.
// The browser shows exactly this mess; here we catch it. Returns the pixel row where
// the real picture ends (everything below is decoder garbage to be flagged), or -1 if clean.
//
// Two-stage so it never fires on a genuine photo: first require a *confirmed* blowout -
// a sustained band of pixels that are channel-pinned (>=250 or <=5) AND high-chroma
// (a real bright sky or black shadow pins channels too, but near-neutral, not neon).
// Only once that is seen do we walk back to the desync onset: the first flat band
// (variance collapsed) that a textured band led into. A clean image never reaches the
// walk-back, so its flat skies/walls are never mistaken for corruption.
export function detectCorruptCut(data: Uint8ClampedArray, w: number, h: number, rows = h) {
  const BAND = 8, nb = Math.ceil(rows / BAND);
  if (nb < 3) return -1;
  const garb = new Float64Array(nb), sd = new Float64Array(nb);
  for (let b = 0; b < nb; b++) {
    const y0 = b * BAND, y1 = Math.min(rows, y0 + BAND);
    let n = 0, g = 0, sR = 0, sG = 0, sB = 0, qR = 0, qG = 0, qB = 0;
    for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, R = data[o], G = data[o + 1], B = data[o + 2];
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      if ((mx >= 250 || mn <= 5) && (mx - mn) >= 110) g++;
      sR += R; sG += G; sB += B; qR += R * R; qG += G * G; qB += B * B; n++;
    }
    garb[b] = g / n;
    sd[b] = Math.sqrt(Math.max(0, ((qR / n - (sR / n) ** 2) + (qG / n - (sG / n) ** 2) + (qB / n - (sB / n) ** 2)) / 3));
  }
  let blow = -1;
  for (let b = 0; b + 1 < nb; b++) if (garb[b] > 0.35 && garb[b + 1] > 0.35) { blow = b; break; }
  if (blow < 0) return -1;
  // Terminal-to-the-bottom guard: baseline-JPEG desync never self-heals (DC prediction
  // is cumulative), so the garbage runs unbroken to the last row. A *real* saturated
  // region - a sunset sky, a neon sign - sits somewhere in the frame with ordinary
  // content below it. Require a blowout band inside the bottom quarter, so a genuine
  // vivid photo (its saturation up top, normal ground below) is never mistaken for corruption.
  let bottomGarb = false;
  for (let b = Math.floor(nb * 0.75); b < nb; b++) if (garb[b] > 0.35) { bottomGarb = true; break; }
  if (!bottomGarb) return -1;
  let onset = blow;                                    // desync onset = first flat band a textured band led into
  for (let b = 1; b <= blow; b++) {
    if (sd[b] < 32) {
      let textured = false;
      for (let k = Math.max(0, b - 2); k < b; k++) if (sd[k] > 45) textured = true;
      if (textured) { onset = b; break; }
    }
  }
  if (onset < 1) return -1;                            // no real top strip survived - let the normal decode handle it
  return onset * BAND;
}

// Decode as much of the baseline scan as survives. Returns RGBA + how many pixel
// rows are real (the rest is mid-grey fill); `thumb` is set when the returned image
// is the file's embedded thumbnail (its full-size image could not be decoded), and
// `corrupt` when the scan desynced into garbage that was detected and greyed out.
export function decodeJpegPartial(bytes: Uint8Array, allowThumb = true): PartialJpeg | null {
  // Last resort when the main image yields nothing (its body was overwritten but the
  // header cluster, with its EXIF thumbnail, survived): decode that thumbnail. It's
  // decoded with allowThumb=false so a thumbnail can't recurse into its own.
  const bail = () => {
    if (!allowThumb) return null;
    const t = findEmbeddedThumb(bytes);
    if (!t) return null;
    const d = decodeJpegPartial(t, false);
    if (d && d.rows > 0) { d.thumb = true; return d; }
    return null;
  };
  const H = parseHeader(bytes);
  if (!H || !H.frame || !H.scan.length) return bail();
  const { width, height, comps } = H.frame;
  if (!width || !height || width > 20000 || height > 20000) return bail();
  let maxH = 1, maxV = 1;
  for (const c of comps) { if (c.h > maxH) maxH = c.h; if (c.v > maxV) maxV = c.v; }
  const mcuW = 8 * maxH, mcuH = 8 * maxV;
  const mcusPerLine = Math.ceil(width / mcuW), mcusPerCol = Math.ceil(height / mcuH);

  // One full-resolution plane per component, pre-filled mid-grey so undecoded area
  // reads as "no data" rather than as garbage or black.
  for (const c of comps) {
    const sc = H.scan.find((s) => s.id === c.id) || H.scan[0];
    // Fall back to the standard tables when the file cites one it never defined
    // (tableless MJPEG frames / embedded thumbnails).
    c.dcTab = H.huffDC[sc.dc] || STD.dc[sc.dc & 1];
    c.acTab = H.huffAC[sc.ac] || STD.ac[sc.ac & 1];
    c.quant = H.qt[c.qId];
    c.pw = mcusPerLine * c.h * 8; c.ph = mcusPerCol * c.v * 8;
    c.plane = new Uint8ClampedArray(c.pw * c.ph).fill(128);
    c.pred = 0;
  }
  if (comps.some((c) => !c.dcTab || !c.acTab || !c.quant)) return bail();

  const br = new BitReader(bytes, H.scanStart);
  const blk = new Int32Array(64);
  let mcuRow = 0;
  outer:
  for (let my = 0; my < mcusPerCol; my++) {
    for (let mx = 0; mx < mcusPerLine; mx++) {
      for (const c of comps) {
        for (let by = 0; by < c.v; by++) {
          for (let bx = 0; bx < c.h; bx++) {
            if (!decodeBlock(br, c, blk)) break outer;     // bitstream ended/corrupt
            const px = (mx * c.h + bx) * 8, py = (my * c.v + by) * 8;
            for (let i = 0; i < 8; i++) rowIDCT(blk, i * 8);
            for (let i = 0; i < 8; i++) colIDCT(blk, i, c.plane, (py + 0) * c.pw + px + i, c.pw);
          }
        }
      }
      if (H.dri && ((my * mcusPerLine + mx + 1) % H.dri === 0)) { br.restart(); for (const c of comps) c.pred = 0; }
    }
    mcuRow = my + 1;
  }

  const rows = Math.min(height, mcuRow * mcuH);
  if (rows === 0) return bail();                        // main image gone - try the thumbnail
  const out = new Uint8ClampedArray(width * height * 4);
  const [Y, Cb, Cr] = [comps[0], comps[1], comps[2]];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const yv = Y.plane[((y * Y.v / maxV) | 0) * Y.pw + ((x * Y.h / maxH) | 0)];
      if (comps.length === 1) { out[o] = out[o + 1] = out[o + 2] = yv; }
      else {
        const cb = Cb.plane[((y * Cb.v / maxV) | 0) * Cb.pw + ((x * Cb.h / maxH) | 0)] - 128;
        const cr = Cr.plane[((y * Cr.v / maxV) | 0) * Cr.pw + ((x * Cr.h / maxH) | 0)] - 128;
        out[o] = yv + 1.402 * cr;
        out[o + 1] = yv - 0.344136 * cb - 0.714136 * cr;
        out[o + 2] = yv + 1.772 * cb;
      }
      out[o + 3] = 255;
    }
  }
  // The Huffman decode may have "succeeded" well past the point the stream desynced,
  // filling the lower picture with saturated colour-block garbage. We keep those raw
  // pixels (that's the picture a lenient system viewer paints, and the user asked to
  // see it) but flag it and record where the real image ends (`realRows`), so callers
  // caption it honestly: below the break it's decoder noise, not the actual photo.
  const cut = detectCorruptCut(out, width, height, rows);
  if (cut >= 0 && cut < rows) {
    if (cut === 0) { const b = bail(); if (b) return b; }   // garbage from the very top - prefer the thumbnail
    return { width, height, data: out, rows, corrupt: true, realRows: cut };
  }
  return { width, height, data: out, rows };
}

// Decode one 8x8 block into `blk` (dequantised, natural order). false => stream ended.
function decodeBlock(br: BitReader, c: JpegComp, blk: Int32Array) {
  if (br.hitMarker) return false;
  blk.fill(0);
  const t = decodeHuff(br, c.dcTab);
  if (t < 0) return false;
  c.pred += t ? extend(br.bits(t), t) : 0;
  blk[0] = c.pred * c.quant[0];
  let k = 1;
  while (k < 64) {
    const rs = decodeHuff(br, c.acTab);
    if (rs < 0) return false;
    const r = rs >> 4, s = rs & 15;
    if (s === 0) { if (r === 15) { k += 16; continue; } break; }   // ZRL / EOB
    k += r;
    if (k > 63) break;
    blk[ZIG[k]] = extend(br.bits(s), s) * c.quant[k];
    k++;
  }
  return true;
}
