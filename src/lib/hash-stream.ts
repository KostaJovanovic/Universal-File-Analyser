/* Analyser - incremental (streaming) file hashes: SHA-256, SHA-1, SHA-512, MD5
   and CRC-32, each fed one slice at a time.

   crypto.subtle.digest takes the whole input in one go, so hashing a file with
   it means holding the file in memory whole - which is why the Integrity card
   used to stop at 500 MB, and a report export of a multi-GB video tried to read
   all of it. These hashers carry their state between slices instead, so a file
   of any size costs one slice of memory. They are slower than subtle (pure JS),
   so core/util.ts keeps subtle for files that fit comfortably and sends the rest
   here, through lib/hash-worker.ts so the page stays responsive.

   DOM-free on purpose: the worker imports it, and it compiles under both
   tsconfig.json and tsconfig.worker.json.

   The SHA-2 round constants are not typed out: they are the fractional parts of
   the cube roots (K) and square roots (initial state) of the first primes, so
   they are computed once here with BigInt integer roots. SHA-256's constants are
   the high 32 bits of SHA-512's, so one table serves both. */

export type HashAlgo = 'sha256' | 'sha1' | 'sha512' | 'md5' | 'crc32';

interface Hasher { update(b: Uint8Array): void; digest(): string }

const hex32 = (n: number) => (n >>> 0).toString(16).padStart(8, '0');

// ---- SHA-2 constants ----

function primes(n: number) {
  const out: number[] = [];
  for (let c = 2; out.length < n; c++) {
    let prime = true;
    for (const p of out) { if (p * p > c) break; if (c % p === 0) { prime = false; break; } }
    if (prime) out.push(c);
  }
  return out;
}
// Floor of the k-th root of a BigInt, by integer Newton iteration from an
// overestimate (each step then decreases until it reaches the floor).
function iroot(n: bigint, k: bigint) {
  let x = BigInt(Math.ceil(Math.pow(Number(n), 1 / Number(k)))) + (1n << 24n);
  for (;;) {
    const y = ((k - 1n) * x + n / x ** (k - 1n)) / k;
    if (y >= x) break;
    x = y;
  }
  while (x ** k > n) x--;
  while ((x + 1n) ** k <= n) x++;
  return x;
}
const M64 = (1n << 64n) - 1n;
// frac(root(p)) * 2^64 = floor(root(p * 2^(64k))) mod 2^64
const frac64 = (p: number, k: bigint) => iroot(BigInt(p) << (64n * k), k) & M64;
const P80 = primes(80);
const K512H = new Int32Array(80), K512L = new Int32Array(80);
for (let i = 0; i < 80; i++) {
  const v = frac64(P80[i], 3n);
  K512H[i] = Number(v >> 32n) | 0; K512L[i] = Number(v & 0xFFFFFFFFn) | 0;
}
const H512H = new Int32Array(8), H512L = new Int32Array(8);
for (let i = 0; i < 8; i++) {
  const v = frac64(P80[i], 2n);
  H512H[i] = Number(v >> 32n) | 0; H512L[i] = Number(v & 0xFFFFFFFFn) | 0;
}

// ---- block-hasher base: buffers a partial block between update() calls ----

abstract class BlockHasher implements Hasher {
  protected buf: Uint8Array;
  protected bufLen = 0;
  protected total = 0;                   // bytes fed so far (exact up to 2^53)
  constructor(protected size: number) { this.buf = new Uint8Array(size); }
  protected abstract block(b: Uint8Array, o: number): void;
  update(b: Uint8Array) {
    const n = b.length, size = this.size;
    let i = 0;
    this.total += n;
    if (this.bufLen) {
      const take = Math.min(size - this.bufLen, n);
      this.buf.set(b.subarray(0, take), this.bufLen);
      this.bufLen += take; i = take;
      if (this.bufLen < size) return;
      this.block(this.buf, 0);
      this.bufLen = 0;
    }
    for (; i + size <= n; i += size) this.block(b, i);
    if (i < n) { this.buf.set(b.subarray(i), 0); this.bufLen = n - i; }
  }
  // Merkle-Damgard padding: 0x80, zeros, then the bit length in `lenBytes`
  // bytes (big- or little-endian) at the end of the last block.
  protected pad(lenBytes: number, little: boolean) {
    const size = this.size, bits = this.total * 8;
    const tail = new Uint8Array(((this.bufLen + 1 + lenBytes + size - 1) / size | 0) * size);
    tail.set(this.buf.subarray(0, this.bufLen));
    tail[this.bufLen] = 0x80;
    const dv = new DataView(tail.buffer);
    const hi = Math.floor(bits / 0x100000000), lo = bits >>> 0;
    if (little) { dv.setUint32(tail.length - 8, lo, true); dv.setUint32(tail.length - 4, hi, true); }
    else { dv.setUint32(tail.length - 8, hi); dv.setUint32(tail.length - 4, lo); }
    for (let o = 0; o < tail.length; o += size) this.block(tail, o);
  }
  abstract digest(): string;
}

// ---- SHA-256 ----

class Sha256 extends BlockHasher {
  private h = Int32Array.from(H512H);
  private w = new Int32Array(64);
  constructor() { super(64); }
  protected block(b: Uint8Array, o: number) {
    const w = this.w, h = this.h, K = K512H;
    for (let t = 0; t < 16; t++, o += 4) w[t] = b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3];
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15], y = w[t - 2];
      const s0 = (x >>> 7 | x << 25) ^ (x >>> 18 | x << 14) ^ (x >>> 3);
      const s1 = (y >>> 17 | y << 15) ^ (y >>> 19 | y << 13) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let a = h[0], bb = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let t = 0; t < 64; t++) {
      const S1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7);
      const t1 = (hh + S1 + ((e & f) ^ (~e & g)) + K[t] + w[t]) | 0;
      const S0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10);
      const t2 = (S0 + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + bb) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  }
  digest() { this.pad(8, false); return Array.from(this.h, hex32).join(''); }
}

// ---- SHA-1 ----

class Sha1 extends BlockHasher {
  private h = Int32Array.from([0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0]);
  private w = new Int32Array(80);
  constructor() { super(64); }
  protected block(b: Uint8Array, o: number) {
    const w = this.w, h = this.h;
    for (let t = 0; t < 16; t++, o += 4) w[t] = b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3];
    for (let t = 16; t < 80; t++) { const x = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16]; w[t] = x << 1 | x >>> 31; }
    let a = h[0], bb = h[1], c = h[2], d = h[3], e = h[4];
    for (let t = 0; t < 80; t++) {
      let f, k;
      if (t < 20) { f = (bb & c) | (~bb & d); k = 0x5A827999; }
      else if (t < 40) { f = bb ^ c ^ d; k = 0x6ED9EBA1; }
      else if (t < 60) { f = (bb & c) | (bb & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = bb ^ c ^ d; k = 0xCA62C1D6; }
      const tmp = ((a << 5 | a >>> 27) + f + e + k + w[t]) | 0;
      e = d; d = c; c = bb << 30 | bb >>> 2; bb = a; a = tmp;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + bb) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0; h[4] = (h[4] + e) | 0;
  }
  digest() { this.pad(8, false); return Array.from(this.h, hex32).join(''); }
}

// ---- SHA-512 (64-bit words as hi/lo Int32 pairs) ----

// Carry out of a sum of unsigned 32-bit lows (the sum is exact as a double).
const carry = (lo: number) => (lo / 0x100000000) | 0;

class Sha512 extends BlockHasher {
  private hh = Int32Array.from(H512H);
  private hl = Int32Array.from(H512L);
  private wh = new Int32Array(80);
  private wl = new Int32Array(80);
  constructor() { super(128); }
  protected block(b: Uint8Array, o: number) {
    const wh = this.wh, wl = this.wl;
    for (let t = 0; t < 16; t++, o += 8) {
      wh[t] = b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3];
      wl[t] = b[o + 4] << 24 | b[o + 5] << 16 | b[o + 6] << 8 | b[o + 7];
    }
    for (let t = 16; t < 80; t++) {
      let xh = wh[t - 15], xl = wl[t - 15];
      // sigma0 = ROTR1 ^ ROTR8 ^ SHR7
      const s0h = (xh >>> 1 | xl << 31) ^ (xh >>> 8 | xl << 24) ^ (xh >>> 7);
      const s0l = (xl >>> 1 | xh << 31) ^ (xl >>> 8 | xh << 24) ^ (xl >>> 7 | xh << 25);
      xh = wh[t - 2]; xl = wl[t - 2];
      // sigma1 = ROTR19 ^ ROTR61 ^ SHR6
      const s1h = (xh >>> 19 | xl << 13) ^ (xl >>> 29 | xh << 3) ^ (xh >>> 6);
      const s1l = (xl >>> 19 | xh << 13) ^ (xh >>> 29 | xl << 3) ^ (xl >>> 6 | xh << 26);
      const lo = (s1l >>> 0) + (wl[t - 7] >>> 0) + (s0l >>> 0) + (wl[t - 16] >>> 0);
      wh[t] = (s1h + wh[t - 7] + s0h + wh[t - 16] + carry(lo)) | 0;
      wl[t] = lo | 0;
    }
    const HH = this.hh, HL = this.hl;
    let aH = HH[0], aL = HL[0], bH = HH[1], bL = HL[1], cH = HH[2], cL = HL[2], dH = HH[3], dL = HL[3];
    let eH = HH[4], eL = HL[4], fH = HH[5], fL = HL[5], gH = HH[6], gL = HL[6], hH = HH[7], hL = HL[7];
    for (let t = 0; t < 80; t++) {
      // Sigma1(e) = ROTR14 ^ ROTR18 ^ ROTR41
      const S1h = (eH >>> 14 | eL << 18) ^ (eH >>> 18 | eL << 14) ^ (eL >>> 9 | eH << 23);
      const S1l = (eL >>> 14 | eH << 18) ^ (eL >>> 18 | eH << 14) ^ (eH >>> 9 | eL << 23);
      const chH = (eH & fH) ^ (~eH & gH), chL = (eL & fL) ^ (~eL & gL);
      let lo = (hL >>> 0) + (S1l >>> 0) + (chL >>> 0) + (K512L[t] >>> 0) + (wl[t] >>> 0);
      const t1H = (hH + S1h + chH + K512H[t] + wh[t] + carry(lo)) | 0, t1L = lo | 0;
      // Sigma0(a) = ROTR28 ^ ROTR34 ^ ROTR39
      const S0h = (aH >>> 28 | aL << 4) ^ (aL >>> 2 | aH << 30) ^ (aL >>> 7 | aH << 25);
      const S0l = (aL >>> 28 | aH << 4) ^ (aH >>> 2 | aL << 30) ^ (aH >>> 7 | aL << 25);
      const mjH = (aH & bH) ^ (aH & cH) ^ (bH & cH), mjL = (aL & bL) ^ (aL & cL) ^ (bL & cL);
      lo = (S0l >>> 0) + (mjL >>> 0);
      const t2H = (S0h + mjH + carry(lo)) | 0, t2L = lo | 0;
      hH = gH; hL = gL; gH = fH; gL = fL; fH = eH; fL = eL;
      lo = (dL >>> 0) + (t1L >>> 0);
      eH = (dH + t1H + carry(lo)) | 0; eL = lo | 0;
      dH = cH; dL = cL; cH = bH; cL = bL; bH = aH; bL = aL;
      lo = (t1L >>> 0) + (t2L >>> 0);
      aH = (t1H + t2H + carry(lo)) | 0; aL = lo | 0;
    }
    const add = (i: number, h: number, l: number) => {
      const lo = (HL[i] >>> 0) + (l >>> 0);
      HH[i] = (HH[i] + h + carry(lo)) | 0; HL[i] = lo | 0;
    };
    add(0, aH, aL); add(1, bH, bL); add(2, cH, cL); add(3, dH, dL);
    add(4, eH, eL); add(5, fH, fL); add(6, gH, gL); add(7, hH, hL);
  }
  // 128-bit length field: the top 64 bits are always zero for a file.
  digest() {
    this.pad(16, false);
    let s = '';
    for (let i = 0; i < 8; i++) s += hex32(this.hh[i]) + hex32(this.hl[i]);
    return s;
  }
}

// ---- MD5 (RFC 1321) - the same arithmetic as md5Hex in core/util.ts ----

const MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const MD5_K = new Int32Array(64);
for (let i = 0; i < 64; i++) MD5_K[i] = (Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)) | 0;

class Md5 extends BlockHasher {
  private h = Int32Array.from([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
  private m = new Int32Array(16);
  constructor() { super(64); }
  protected block(b: Uint8Array, o: number) {
    const M = this.m, h = this.h;
    for (let i = 0; i < 16; i++, o += 4) M[i] = b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24;
    let A = h[0], B = h[1], C = h[2], D = h[3];
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
      else { F = C ^ (B | ~D); g = (7 * i) & 15; }
      F = (F + A + MD5_K[i] + M[g]) | 0;
      A = D; D = C; C = B;
      B = (B + (F << MD5_S[i] | F >>> (32 - MD5_S[i]))) | 0;
    }
    h[0] = (h[0] + A) | 0; h[1] = (h[1] + B) | 0; h[2] = (h[2] + C) | 0; h[3] = (h[3] + D) | 0;
  }
  digest() {
    this.pad(8, true);
    let s = '';
    for (const v of this.h) for (let k = 0; k < 4; k++) s += ((v >>> (8 * k)) & 0xFF).toString(16).padStart(2, '0');
    return s;
  }
}

// ---- CRC-32 (IEEE 802.3) ----

let _crcTable: Uint32Array | null = null;
class Crc32 implements Hasher {
  private crc = 0xFFFFFFFF;
  update(b: Uint8Array) {
    if (!_crcTable) {
      _crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        _crcTable[n] = c >>> 0;
      }
    }
    const T = _crcTable;
    let crc = this.crc;
    for (let i = 0; i < b.length; i++) crc = (crc >>> 8) ^ T[(crc ^ b[i]) & 0xFF];
    this.crc = crc;
  }
  digest() { return ((this.crc ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0'); }
}

export function makeHasher(algo: HashAlgo): Hasher {
  switch (algo) {
    case 'sha256': return new Sha256();
    case 'sha1': return new Sha1();
    case 'sha512': return new Sha512();
    case 'md5': return new Md5();
    default: return new Crc32();
  }
}

/** Hash a Blob (a File) one `chunk`-byte slice at a time with every algorithm
 *  in `algos`, in a single pass. `onProgress` gets 0..1 after each slice;
 *  `yieldEvery` (main-thread fallback only) awaits a macrotask between slices
 *  so the page keeps painting. Resolves { algo: lowercase hex }. */
export async function hashBlob(blob: Blob, algos: HashAlgo[], chunk: number,
                               onProgress?: ((frac: number) => void) | null, yieldEvery = false) {
  const hs = algos.map(makeHasher);
  for (let off = 0; off < blob.size; off += chunk) {
    const bytes = new Uint8Array(await blob.slice(off, off + chunk).arrayBuffer());
    for (const h of hs) h.update(bytes);
    if (onProgress) onProgress(Math.min(1, (off + bytes.length) / blob.size));
    if (yieldEvery) await new Promise((r) => setTimeout(r, 0));
  }
  const out: Partial<Record<HashAlgo, string>> = {};
  algos.forEach((a, i) => { out[a] = hs[i].digest(); });
  return out;
}
