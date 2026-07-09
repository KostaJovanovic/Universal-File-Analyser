/* Analyser - shared ZIP reader
   Reader for ZIP-based formats. Primary path reads the archive's central
   directory (at the tail of the file) and fetches each entry with a ranged read
   of just its local header + data, so it is order-independent and never loads the
   whole file - a large media-heavy archive whose XML parts sit after tens of MB
   of embedded media (e.g. a PowerPoint with the slides written after the video)
   still resolves. Falls back to a sequential local-header walk for truncated or
   headerless archives with no usable central directory. Inflates on demand with
   DecompressionStream (fflate fallback). Widely shared: imported by many
   renderers (xlsx, epub, pptx, docx, odf, iwork, comic, textdoc, paint, f3d,
   lottie, proprietary, ...) and several parsers-*.js chunks. */

import { loadScript } from '../core/util.js';

// fflate (vendored ES module) is the pure-JS raw-DEFLATE fallback for the
// method-8 path below, used when DecompressionStream is missing (Safari < 16.4,
// Firefox < 113) or throws on 'deflate-raw' (Chromium 80-102 / old Android
// WebView). Lazy-loaded on first use so it never costs anything on modern
// browsers that take the native path.
const FFLATE_URL = new URL('../../vendor/fflate.js', import.meta.url).href;
let fflateLib = null;
async function loadFflate() {
  if (fflateLib) return fflateLib;
  fflateLib = await import(FFLATE_URL);
  return fflateLib;
}

// Inflate raw DEFLATE (ZIP method 8). Prefers the native DecompressionStream,
// falling back to fflate. Returns bytes, or null if every path fails.
async function inflateRaw(raw) {
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(raw);
      writer.close();
      const reader = ds.readable.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const total = chunks.reduce((s, c) => s + c.length, 0);
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { out.set(c, off); off += c.length; }
      return out;
    } catch (_) {
      // 'deflate-raw' unsupported on this build - fall through to fflate.
    }
  }
  try {
    const { inflateSync } = await loadFflate();
    return inflateSync(raw);
  } catch (_) {
    return null;
  }
}

// Zstandard (ZIP method 93) - Autodesk Fusion 360 .f3d packs every member this
// way. Decompressed lazily via the vendored fzstd UMD library, loaded on first
// use. Returns the bytes, or null on any failure so callers degrade gracefully.
async function zstdInflate(raw) {
  try {
    if (!(window.fzstd && window.fzstd.decompress)) await loadScript('assets/vendor/fzstd.js');
    if (!(window.fzstd && window.fzstd.decompress)) return null;
    const out = window.fzstd.decompress(raw);
    return out instanceof Uint8Array ? out : (out ? new Uint8Array(out) : null);
  } catch (_) {
    return null;
  }
}

// Sequential local-header walk (fallback path). Returns { entries, buf } where
// each entry is { name, method, compSize, uncompSize, dataStart } indexing into
// buf. Reads up to maxBytes. Used only when the central directory is absent or
// unusable (truncated / headerless archives).
export async function readZipEntries(file, maxBytes = 32 * 1024 * 1024) {
  const maxRead = Math.min(file.size, maxBytes);
  const buf = new Uint8Array(await file.slice(0, maxRead).arrayBuffer());
  const view = new DataView(buf.buffer);
  const entries = [];
  let pos = 0;
  while (pos + 30 < buf.length) {
    if (buf[pos] !== 0x50 || buf[pos + 1] !== 0x4B ||
        buf[pos + 2] !== 0x03 || buf[pos + 3] !== 0x04) break;
    const flags = view.getUint16(pos + 6, true);
    const method = view.getUint16(pos + 8, true);
    let compSize = view.getUint32(pos + 18, true);
    const uncompSize = view.getUint32(pos + 22, true);
    const nameLen = view.getUint16(pos + 26, true);
    const extraLen = view.getUint16(pos + 28, true);
    let name = '';
    for (let i = 0; i < nameLen; i++) name += String.fromCharCode(buf[pos + 30 + i]);
    const dataStart = pos + 30 + nameLen + extraLen;
    // Bit 3 set means sizes live in a trailing data descriptor; we can't trust
    // compSize, so bail out of sequential walking for that entry.
    if ((flags & 0x08) && compSize === 0) break;
    entries.push({ name, method, compSize, uncompSize, dataStart });
    pos = dataStart + compSize;
  }
  return { entries, buf };
}

// Read the central directory at the tail of the file. Returns an array of
// { name, method, compSize, uncompSize, lho } (lho = local-header offset), or
// null when there is no usable EOCD (empty tail, ZIP64, or corrupt) - the caller
// then falls back to readZipEntries. Only the tail + directory bytes are read.
async function readCentralDirectory(file) {
  const tailLen = Math.min(file.size, 65557 + 22); // max ZIP comment (65535) + EOCD (22)
  if (tailLen < 22) return null;
  const tailStart = file.size - tailLen;
  const tail = new Uint8Array(await file.slice(tailStart, file.size).arrayBuffer());
  // Scan backwards for the End Of Central Directory signature (PK\x05\x06).
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4B && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { e = i; break; }
  }
  if (e < 0) return null;
  const edv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  const count = edv.getUint16(e + 10, true);
  const cdSize = edv.getUint32(e + 12, true);
  const cdOff = edv.getUint32(e + 16, true);
  // 0xFFFF/0xFFFFFFFF sentinels mean the real values live in a ZIP64 record;
  // leave those (and any impossible offsets) to the sequential fallback.
  if (count === 0xFFFF || cdSize === 0xFFFFFFFF || cdOff === 0xFFFFFFFF) return null;
  if (cdOff + cdSize > file.size || cdSize < 46) return null;
  // The central directory is usually inside the tail we already read; otherwise
  // fetch just those bytes.
  let cd;
  if (cdOff >= tailStart) cd = tail.subarray(cdOff - tailStart, cdOff - tailStart + cdSize);
  else cd = new Uint8Array(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const cdv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const entries = [];
  let p = 0;
  while (p + 46 <= cd.length && cdv.getUint32(p, true) === 0x02014b50) {
    const method = cdv.getUint16(p + 10, true);
    const compSize = cdv.getUint32(p + 20, true);
    const uncompSize = cdv.getUint32(p + 24, true);
    const nameLen = cdv.getUint16(p + 28, true);
    const extraLen = cdv.getUint16(p + 30, true);
    const cmtLen = cdv.getUint16(p + 32, true);
    const lho = cdv.getUint32(p + 42, true);
    let name = '';
    for (let i = 0; i < nameLen && p + 46 + i < cd.length; i++) name += String.fromCharCode(cd[p + 46 + i]);
    entries.push({ name, method, compSize, uncompSize, lho });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return entries.length ? entries : null;
}

// Read one entry's raw (still-compressed) bytes. Sequential-walk entries have
// their data in `buf` at `dataStart`; central-directory entries carry `lho` and
// are fetched with a ranged read of the local header (whose name/extra lengths
// can differ from the central record) plus the compressed data.
async function readEntryRaw(file, buf, entry) {
  if (entry.dataStart != null && buf) {
    return buf.slice(entry.dataStart, entry.dataStart + entry.compSize);
  }
  const lh = new Uint8Array(await file.slice(entry.lho, entry.lho + 30).arrayBuffer());
  if (lh.length < 30 || !(lh[0] === 0x50 && lh[1] === 0x4B && lh[2] === 0x03 && lh[3] === 0x04)) return null;
  const ldv = new DataView(lh.buffer);
  const nameLen = ldv.getUint16(26, true);
  const extraLen = ldv.getUint16(28, true);
  const ds = entry.lho + 30 + nameLen + extraLen;
  return new Uint8Array(await file.slice(ds, ds + entry.compSize).arrayBuffer());
}

async function decodeEntry(file, buf, entry) {
  const raw = await readEntryRaw(file, buf, entry);
  if (raw == null) return null;
  if (entry.method === 0) return raw;
  if (entry.method === 8) return inflateRaw(raw);
  if (entry.method === 93) return zstdInflate(raw);
  return null;
}

// Legacy helpers kept for callers that already hold a sequential-walk buffer +
// entry (buf/dataStart model). New code should prefer openZip's text()/bytes().
export async function inflateToBytes(buf, entry) {
  const raw = buf.slice(entry.dataStart, entry.dataStart + entry.compSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return inflateRaw(raw);
  if (entry.method === 93) return zstdInflate(raw);
  return null;
}

export async function inflateToText(buf, entry) {
  const bytes = await inflateToBytes(buf, entry);
  return bytes ? new TextDecoder().decode(bytes) : null;
}

// Open an archive as a name -> entry map. Reads the central directory first
// (order-independent, ranged), falling back to the sequential local-header walk.
// `maxBytes` bounds only the fallback buffer read.
export async function openZip(file, maxBytes) {
  let entries;
  let buf = null;
  try { entries = await readCentralDirectory(file); } catch (_) { entries = null; }
  if (!entries) { const seq = await readZipEntries(file, maxBytes); entries = seq.entries; buf = seq.buf; }
  const map = new Map();
  for (const e of entries) map.set(e.name, e);
  return {
    buf,
    entries,
    has: (name) => map.has(name),
    names: () => [...map.keys()],
    text: async (name) => { const e = map.get(name); if (!e) return null; const b = await decodeEntry(file, buf, e); return b ? new TextDecoder().decode(b) : null; },
    bytes: async (name) => { const e = map.get(name); return e ? decodeEntry(file, buf, e) : null; },
    // All entries whose name matches a predicate, in archive order.
    match: (re) => entries.filter((e) => re.test(e.name)),
  };
}
