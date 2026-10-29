/* Analyser - pure-JS readers for the archives that need no WASM: TAR, gzip'd
   TAR (.tar.gz / .tgz) and ISO 9660 disc images.

   libarchive (lib/libarchive-loader.ts) copies the whole file into its 32-bit
   WASM heap before reading a byte, so a TAR or ISO past ~2 GB could not open
   at all, and phones failed far below that. These three formats need no such
   thing: a TAR is a run of 512-byte headers each followed by its file's bytes,
   and an ISO keeps a directory tree that points at each file's sectors. So the
   listing is read with small slices of the File, and an entry is a slice of it
   too (getBlob) - opening a 4 GB video inside an ISO reads nothing up front.

   A .tar.gz has no random access, so it is listed by streaming it once through
   the browser's own DecompressionStream (one chunk in memory at a time), and an
   entry is extracted by streaming again up to it.

   Same handle shape as extractArchive() - { names, entries: [{ name, size,
   getBytes, getBlob? }], close } - so every caller takes it unchanged.
   extractArchive() tries these first and only falls back to libarchive for
   everything else (RAR, 7z, CAB, xz/zstd/bzip2 tarballs, UDF-only discs). */

import { DECOMP_OUTPUT_MAX, LIST_ENTRIES_MAX } from '../core/limits.js';

export interface StreamEntry {
  name: string;
  size: number;
  getBytes: (maxOut?: number) => Promise<Uint8Array>;
  /** Present when the entry is stored as-is: a zero-copy slice of the file. */
  getBlob?: () => Blob;
}
export interface StreamHandle { names: string[]; entries: StreamEntry[]; close(): void; kind: string }

const utf8 = new TextDecoder();
const latin1 = new TextDecoder('latin1');
const WINDOW = 1 << 20;

/** A sequential byte source: read n bytes, or skip n. */
interface SeqSource { read(n: number): Promise<Uint8Array>; skip(n: number): Promise<void>; pos(): number; cancel(): void }

// Over a File: reads are served from a 1 MB window (TAR headers sit between
// files, so small ones share a read) and skips are free seeks.
function fileSource(file: Blob): SeqSource {
  let p = 0, wStart = -1, win = new Uint8Array(0);
  return {
    pos: () => p,
    async read(n) {
      if (n > WINDOW) { const b = new Uint8Array(await file.slice(p, p + n).arrayBuffer()); p += b.length; return b; }
      if (wStart < 0 || p < wStart || p + n > wStart + win.length) {
        wStart = p; win = new Uint8Array(await file.slice(p, p + WINDOW).arrayBuffer());
      }
      const b = win.subarray(p - wStart, p - wStart + n);
      p += b.length;
      return b;
    },
    async skip(n) { p = Math.min(file.size, p + n); },
    cancel() {},
  };
}

// Over a gzip stream: the browser decompresses; skipped bytes are discarded as
// they arrive, so memory is one decompressed chunk whatever the archive's size.
function gzipSource(file: Blob): SeqSource {
  const reader = file.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  // Unconsumed chunks from `ci`, `at` bytes into chunks[ci]; `have` bytes in all.
  // A list, not one growing buffer: re-joining everything buffered on every
  // chunk made a 1 GB read copy terabytes.
  const EMPTY = new Uint8Array(0);
  let chunks: Uint8Array[] = [], ci = 0, at = 0, have = 0, p = 0, done = false;
  const pull = async () => {
    const r = await reader.read();
    if (r.done) { done = true; return false; }
    chunks.push(r.value); have += r.value.length;
    return true;
  };
  // Consume k buffered bytes, copying them into `out` when given.
  const take = (k: number, out?: Uint8Array) => {
    for (let o = 0; k > 0;) {
      const c = chunks[ci], m = Math.min(k, c.length - at);
      if (out) out.set(c.subarray(at, at + m), o);
      o += m; k -= m; at += m; have -= m;
      if (at === c.length) {
        chunks[ci++] = EMPTY; at = 0;   // let it go now, not when the list empties
        if (ci === chunks.length) { chunks = []; ci = 0; }
      }
    }
  };
  return {
    pos: () => p,
    async read(n) {
      while (have < n && !done) await pull();
      const b = new Uint8Array(Math.min(n, have));
      take(b.length, b); p += b.length;
      return b;
    },
    async skip(n) {
      while (n > 0) {
        if (!have && (done || !(await pull()))) return;
        const k = Math.min(n, have);
        take(k); p += k; n -= k;
      }
    },
    cancel() { reader.cancel().catch(() => {}); },
  };
}

// ---------- TAR ----------

function cstr(b: Uint8Array, o: number, n: number) {
  let e = o;
  while (e < o + n && e < b.length && b[e]) e++;
  return utf8.decode(b.subarray(o, e));
}
// Octal, or GNU base-256 when the top bit of the first byte is set (sizes past 8 GB).
function tarNum(b: Uint8Array, o: number, n: number) {
  if (b[o] & 0x80) {
    let v = b[o] & 0x7F;
    for (let i = 1; i < n; i++) v = v * 256 + b[o + i];
    return v;
  }
  const s = latin1.decode(b.subarray(o, o + n)).replace(/\0.*$/s, '').trim();
  return s ? parseInt(s, 8) || 0 : 0;
}
// A 512-byte header: { zero } for an end-of-archive block, null when the
// checksum fails (not a TAR, or a corrupt one), otherwise its fields.
function tarHeader(h: Uint8Array) {
  if (h.length < 512) return null;
  let zero = true;
  for (let i = 0; i < 512; i++) if (h[i]) { zero = false; break; }
  if (zero) return { zero: true, name: '', size: 0, type: '' };
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
  if (sum !== tarNum(h, 148, 8)) return null;
  let name = cstr(h, 0, 100);
  // POSIX ustar ("ustar\0") splits long paths into prefix + name; GNU tar
  // ("ustar  ") uses those bytes for other fields.
  if (latin1.decode(h.subarray(257, 262)) === 'ustar' && h[262] === 0) {
    const prefix = cstr(h, 345, 155);
    if (prefix) name = prefix + '/' + name;
  }
  return { zero: false, name, size: tarNum(h, 124, 12), type: h[156] ? String.fromCharCode(h[156]) : '0' };
}

// Walk the headers, returning each regular file's name, size and data offset
// (in the source's own byte positions). GNU long names ('L') and pax extended
// headers ('x': path=, size=) apply to the entry after them. Null when the
// first header isn't a valid TAR header.
async function walkTar(src: SeqSource, limit: number) {
  const out: { name: string; size: number; at: number }[] = [];
  let longName: string | null = null, paxPath: string | null = null, paxSize: number | null = null;
  let first = true;
  while (out.length < limit) {
    const h = tarHeader(await src.read(512));
    if (!h) { if (first) return null; break; }
    if (h.zero) { if (first) return null; break; }
    first = false;
    const pad = (512 - (h.size % 512)) % 512;
    if (h.type === 'L' || h.type === 'x' || h.type === 'K' || h.type === 'g') {
      if (h.size <= WINDOW) {
        const meta = await src.read(h.size);
        if (h.type === 'L') longName = cstr(meta, 0, meta.length);
        else if (h.type === 'x') {
          // Records are "<len> key=value\n".
          const text = utf8.decode(meta);
          for (const m of text.matchAll(/\d+ ([^=\n]+)=([^\n]*)\n/g)) {
            if (m[1] === 'path') paxPath = m[2];
            else if (m[1] === 'size') paxSize = Number(m[2]) || 0;
          }
        }
      } else {
        await src.skip(h.size);
      }
      await src.skip(pad);
      continue;
    }
    const size = paxSize != null ? paxSize : h.size;
    const name = paxPath || longName || h.name;
    longName = paxPath = null; paxSize = null;
    const at = src.pos();
    if ((h.type === '0' || h.type === '7') && name && !name.endsWith('/')) out.push({ name, size, at });
    await src.skip(Math.ceil(size / 512) * 512);
  }
  return out;
}

export async function openTar(file: Blob): Promise<StreamHandle | null> {
  if (file.size < 1024) return null;
  const list = await walkTar(fileSource(file), LIST_ENTRIES_MAX);
  if (!list || !list.length) return null;
  const entries: StreamEntry[] = list
    .filter((e) => e.at + e.size <= file.size)
    .map((e) => ({
      name: e.name,
      size: e.size,
      getBlob: () => file.slice(e.at, e.at + e.size),
      getBytes: async () => new Uint8Array(await file.slice(e.at, e.at + e.size).arrayBuffer()),
    }));
  return { kind: 'tar', names: entries.map((e) => e.name), entries, close() {} };
}

export async function openTarGz(file: Blob): Promise<StreamHandle | null> {
  if (typeof DecompressionStream === 'undefined' || file.size < 20) return null;
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] !== 0x1F || head[1] !== 0x8B) return null;
  const src = gzipSource(file);
  let list;
  try { list = await walkTar(src, LIST_ENTRIES_MAX); } finally { src.cancel(); }
  if (!list || !list.length) return null;
  const entries: StreamEntry[] = list.map((e) => ({
    name: e.name,
    size: e.size,
    // Stream the archive again up to this entry. Held to the same rule as the
    // libarchive handle: anything no larger than the archive itself is allowed,
    // past that `maxOut` holds.
    getBytes: async (maxOut: number = DECOMP_OUTPUT_MAX) => {
      if (e.size > Math.max(maxOut, file.size)) throw new Error('entry too large to extract');
      const s = gzipSource(file);
      try { await s.skip(e.at); return await s.read(e.size); } finally { s.cancel(); }
    },
  }));
  return { kind: 'tar.gz', names: entries.map((e) => e.name), entries, close() {} };
}

// ---------- ISO 9660 ----------

const SECTOR = 2048;

export async function openIso(file: Blob): Promise<StreamHandle | null> {
  if (file.size < 17 * SECTOR) return null;
  // Volume descriptors from sector 16: 1 = primary, 2 = supplementary (Joliet
  // when its escape sequence names UCS-2), 255 = end of the set.
  let pvd: Uint8Array | null = null, joliet: Uint8Array | null = null;
  for (let s = 16; s < 64; s++) {
    const d = new Uint8Array(await file.slice(s * SECTOR, (s + 1) * SECTOR).arrayBuffer());
    if (d.length < SECTOR || latin1.decode(d.subarray(1, 6)) !== 'CD001') break;
    if (d[0] === 1 && !pvd) pvd = d;
    else if (d[0] === 2 && d[88] === 0x25 && d[89] === 0x2F && (d[90] === 0x40 || d[90] === 0x43 || d[90] === 0x45)) joliet = d;
    else if (d[0] === 255) break;
  }
  const vd = joliet || pvd;
  if (!vd) return null;
  const isJoliet = vd === joliet;
  const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
  const rootRec = dv(vd.subarray(156, 190));
  const out: StreamEntry[] = [];
  const seen = new Set<number>();
  const ucs2 = (b: Uint8Array) => { let s = ''; for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b[i] << 8 | b[i + 1]); return s; };

  // Rock Ridge 'NM' entries in a record's system-use area carry the real
  // (case-preserving, long) POSIX name on discs without Joliet.
  const rockRidgeName = (b: Uint8Array, p: number, len: number, nameLen: number) => {
    let q = p + 33 + nameLen + (nameLen % 2 === 0 ? 1 : 0);
    let name = '';
    while (q + 4 <= p + len) {
      const l = b[q + 2];
      if (l < 4) break;
      if (b[q] === 0x4E && b[q + 1] === 0x4D && l >= 5) name += utf8.decode(b.subarray(q + 5, q + l));
      q += l;
    }
    return name;
  };

  const walk = async (extent: number, size: number, prefix: string, depth: number) => {
    if (depth > 64 || seen.has(extent) || out.length >= LIST_ENTRIES_MAX) return;
    seen.add(extent);
    const start = extent * SECTOR;
    if (start + size > file.size || size > 64 * 1024 * 1024) return;
    const b = new Uint8Array(await file.slice(start, start + size).arrayBuffer());
    const v = dv(b);
    let p = 0;
    while (p < b.length && out.length < LIST_ENTRIES_MAX) {
      const len = b[p];
      // Records never cross a sector; a zero length pads to the next one.
      if (!len) { p = (Math.floor(p / SECTOR) + 1) * SECTOR; continue; }
      if (p + 33 > b.length || len < 34) break;
      const ext = v.getUint32(p + 2, true), dsize = v.getUint32(p + 10, true), flags = b[p + 25], nameLen = b[p + 32];
      const raw = b.subarray(p + 33, p + 33 + nameLen);
      if (!(nameLen === 1 && raw[0] <= 1)) {                       // skip "." and ".."
        let name = isJoliet ? ucs2(raw) : (rockRidgeName(b, p, len, nameLen) || latin1.decode(raw));
        name = name.replace(/;\d+$/, '');
        if (!isJoliet) name = name.replace(/\.$/, '');
        if (flags & 2) await walk(ext, dsize, prefix + name + '/', depth + 1);
        else {
          const off = ext * SECTOR;
          if (off + dsize <= file.size) {
            out.push({
              name: prefix + name,
              size: dsize,
              getBlob: () => file.slice(off, off + dsize),
              getBytes: async () => new Uint8Array(await file.slice(off, off + dsize).arrayBuffer()),
            });
          }
        }
      }
      p += len;
    }
  };
  await walk(rootRec.getUint32(2, true), rootRec.getUint32(10, true), '', 0);
  if (!out.length) return null;
  return { kind: 'iso', names: out.map((e) => e.name), entries: out, close() {} };
}

/** ISO, TAR or .tar.gz, read without WASM - or null for anything else. */
export async function openStreamArchive(file: Blob): Promise<StreamHandle | null> {
  try { const iso = await openIso(file); if (iso) return iso; } catch (_) {}
  try { const tar = await openTar(file); if (tar) return tar; } catch (_) {}
  try { const tgz = await openTarGz(file); if (tgz) return tgz; } catch (_) {}
  return null;
}
