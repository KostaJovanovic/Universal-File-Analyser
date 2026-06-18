/* Analyser - native 7z reader (listing + streamed solid-block extraction).

   Why this exists: the vendored libarchive WASM lists a 7z by walking the solid
   block entry-by-entry, loading the whole file into the WASM heap; on a large
   solid archive it runs out of memory after a few entries and silently stops,
   showing only a handful of the files. This module instead reads the file list
   straight from the 7z header (which needs no body decompression at all), so
   every entry is listed regardless of archive size, and extracts a single file
   by streaming its folder's coder output and keeping only that file's bytes.

   Layout of a 7z file:
     [32-byte SignatureHeader] [packed streams ...] [header]
   The SignatureHeader points (NextHeaderOffset/Size, relative to byte 32) at the
   header, which is either a plain header (id 0x01) or an "encoded header" (id
   0x17) - a tiny StreamsInfo describing the real header compressed as its own
   packed stream (usually LZMA). We decode that, then parse the real header.

   The parsing half (parseHeader) is a pure function over the decompressed header
   bytes so it can be unit-tested off-browser; the decode/extract half uses the
   app's existing LZMA-alone (lzma-loader) and xz/LZMA2 (xzwasm) decoders. */

import { lzmaDecompress } from './lzma-loader.js';
import { loadScript } from '../core/util.js';

// 7z property ids (kFoo) used below. Only the ones we read are named.
const K = {
  End: 0x00, Header: 0x01, MainStreamsInfo: 0x04, FilesInfo: 0x05,
  PackInfo: 0x06, UnpackInfo: 0x07, SubStreamsInfo: 0x08, Size: 0x09, CRC: 0x0a,
  Folder: 0x0b, CodersUnpackSize: 0x0c, NumUnpackStream: 0x0d,
  EmptyStream: 0x0e, EmptyFile: 0x0f, Anti: 0x10, Name: 0x11,
  CTime: 0x12, ATime: 0x13, MTime: 0x14, WinAttributes: 0x15,
  EncodedHeader: 0x17, Dummy: 0x19,
};

// Coder method ids we can decode natively (everything else falls back to
// libarchive in the caller). Bytes compared as a hex string for brevity.
const METHOD_LZMA  = '030101';
const METHOD_LZMA2 = '21';
const METHOD_COPY  = '00';

// ---------- byte cursor + 7z primitives ----------

function makeReader(bytes) {
  return {
    data: bytes, pos: 0,
    byte() { return this.data[this.pos++]; },
    bytes(n) { const s = this.data.subarray(this.pos, this.pos + n); this.pos += n; return s; },
    eof() { return this.pos >= this.data.length; },
  };
}

// 7z variable-length number (REAL_UINT64). Returned as a JS Number - safe for
// any real archive size (< 2^53). Uses multiplication, not <<, to stay 64-bit.
function readNumber(r) {
  const first = r.byte();
  let mask = 0x80, value = 0;
  for (let i = 0; i < 8; i++) {
    if ((first & mask) === 0) { value += (first & (mask - 1)) * 2 ** (8 * i); break; }
    value += r.byte() * 2 ** (8 * i);
    mask >>= 1;
  }
  return value;
}

// Bit vector, MSB-first, `n` bits packed into ceil(n/8) bytes.
function readBitVector(r, n) {
  const bits = new Array(n);
  let b = 0, mask = 0;
  for (let i = 0; i < n; i++) {
    if (mask === 0) { b = r.byte(); mask = 0x80; }
    bits[i] = (b & mask) !== 0;
    mask >>= 1;
  }
  return bits;
}

// "AllAreDefined" prefix: a 1 byte means every bit is set, else a bit vector.
function readAllOrBits(r, n) {
  if (r.byte() !== 0) return new Array(n).fill(true);
  return readBitVector(r, n);
}

// Skip the digest block (kCRC payload): AllAreDefined vector then a 4-byte CRC
// per defined entry. We do not verify CRCs, just consume the bytes.
function skipDigests(r, n) {
  const defined = readAllOrBits(r, n);
  for (let i = 0; i < n; i++) if (defined[i]) r.bytes(4);
}

// ---------- structure parsing ----------

function parseFolder(r) {
  const numCoders = readNumber(r);
  const coders = [];
  let totalIn = 0, totalOut = 0;
  for (let i = 0; i < numCoders; i++) {
    const flags = r.byte();
    const idSize = flags & 0x0f;
    const isComplex = (flags & 0x10) !== 0;
    const hasAttrs = (flags & 0x20) !== 0;
    const id = Array.from(r.bytes(idSize)).map((x) => x.toString(16).padStart(2, '0')).join('');
    let numIn = 1, numOut = 1;
    if (isComplex) { numIn = readNumber(r); numOut = readNumber(r); }
    let props = null;
    if (hasAttrs) { const ps = readNumber(r); props = r.bytes(ps).slice(); }
    coders.push({ id, numIn, numOut, props });
    totalIn += numIn; totalOut += numOut;
  }
  const numBindPairs = totalOut - 1;
  const bindPairs = [];
  for (let i = 0; i < numBindPairs; i++) bindPairs.push({ inIndex: readNumber(r), outIndex: readNumber(r) });
  const numPackedStreams = totalIn - numBindPairs;
  const packedIndices = [];
  if (numPackedStreams === 1) {
    // The single packed stream is the in-stream not bound by a bind pair.
    const bound = new Set(bindPairs.map((b) => b.inIndex));
    for (let i = 0; i < totalIn; i++) if (!bound.has(i)) { packedIndices.push(i); break; }
  } else {
    for (let i = 0; i < numPackedStreams; i++) packedIndices.push(readNumber(r));
  }
  return { coders, bindPairs, numPackedStreams, packedIndices, totalIn, totalOut, unpackSizes: [] };
}

function parsePackInfo(r) {
  const packPos = readNumber(r);
  const numPackStreams = readNumber(r);
  let packSizes = [];
  for (;;) {
    const id = readNumber(r);
    if (id === K.End) break;
    if (id === K.Size) { packSizes = []; for (let i = 0; i < numPackStreams; i++) packSizes.push(readNumber(r)); }
    else if (id === K.CRC) skipDigests(r, numPackStreams);
    else throw new Error('7z: bad PackInfo id ' + id);
  }
  return { packPos, numPackStreams, packSizes };
}

function parseUnpackInfo(r) {
  let id = readNumber(r);
  if (id !== K.Folder) throw new Error('7z: expected kFolder');
  const numFolders = readNumber(r);
  const external = r.byte();
  if (external !== 0) throw new Error('7z: external folders unsupported');
  const folders = [];
  for (let i = 0; i < numFolders; i++) folders.push(parseFolder(r));
  id = readNumber(r);
  if (id !== K.CodersUnpackSize) throw new Error('7z: expected kCodersUnpackSize');
  for (const f of folders) for (let o = 0; o < f.totalOut; o++) f.unpackSizes.push(readNumber(r));
  for (;;) {
    id = readNumber(r);
    if (id === K.End) break;
    if (id === K.CRC) skipDigests(r, numFolders);
    else throw new Error('7z: bad UnpackInfo id ' + id);
  }
  return { folders };
}

// The unpacked size a folder ultimately outputs = the out-stream not used as an
// input by any bind pair (the final coder's output).
function folderMainOutSize(f) {
  const usedOut = new Set(f.bindPairs.map((b) => b.outIndex));
  for (let o = 0; o < f.totalOut; o++) if (!usedOut.has(o)) return f.unpackSizes[o];
  return f.unpackSizes[f.unpackSizes.length - 1];
}

function parseSubStreamsInfo(r, folders) {
  let numUnpack = folders.map(() => 1);
  let id = readNumber(r);
  if (id === K.NumUnpackStream) {
    numUnpack = folders.map(() => readNumber(r));
    id = readNumber(r);
  }
  // Sizes: for each folder, the first (n-1) substream sizes are listed; the last
  // is the folder size minus their sum. A folder with one substream and no kSize
  // simply takes the whole folder size.
  const sizes = [];
  if (id === K.Size) {
    for (let fi = 0; fi < folders.length; fi++) {
      const n = numUnpack[fi];
      if (n === 0) continue;
      let sum = 0;
      for (let s = 0; s < n - 1; s++) { const v = readNumber(r); sizes.push(v); sum += v; }
      sizes.push(folderMainOutSize(folders[fi]) - sum);
    }
    id = readNumber(r);
  } else {
    for (let fi = 0; fi < folders.length; fi++) {
      if (numUnpack[fi] === 1) sizes.push(folderMainOutSize(folders[fi]));
      else throw new Error('7z: missing kSize for multi-substream folder');
    }
  }
  // Remaining: digests for streams without an already-defined folder CRC. We do
  // not verify, so consume to End.
  let numDigests = 0;
  for (let fi = 0; fi < folders.length; fi++) numDigests += numUnpack[fi];
  for (;;) {
    if (id === K.End) break;
    if (id === K.CRC) skipDigests(r, numDigests);
    else if (id === K.Size) { /* already handled above; tolerate */ }
    id = readNumber(r);
  }
  return { numUnpack, sizes };
}

function parseStreamsInfo(r) {
  let packInfo = null, unpackInfo = null, subStreams = null;
  for (;;) {
    const id = readNumber(r);
    if (id === K.End) break;
    if (id === K.PackInfo) packInfo = parsePackInfo(r);
    else if (id === K.UnpackInfo) unpackInfo = parseUnpackInfo(r);
    else if (id === K.SubStreamsInfo) subStreams = parseSubStreamsInfo(r, unpackInfo.folders);
    else throw new Error('7z: bad StreamsInfo id ' + id);
  }
  if (unpackInfo && !subStreams) {
    subStreams = { numUnpack: unpackInfo.folders.map(() => 1), sizes: unpackInfo.folders.map(folderMainOutSize) };
  }
  return { packInfo, unpackInfo, subStreams };
}

// Decode a UTF-16LE, NUL-terminated name list (kName) into `count` strings.
function readNames(r, byteLen, count) {
  const external = r.byte();
  if (external !== 0) throw new Error('7z: external names unsupported');
  const raw = r.bytes(byteLen - 1);
  const names = [];
  let cur = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const ch = raw[i] | (raw[i + 1] << 8);
    if (ch === 0) { names.push(String.fromCharCode(...cur)); cur = []; if (names.length === count) break; }
    else cur.push(ch);
  }
  return names.map((n) => n.replace(/\\/g, '/'));
}

function parseFilesInfo(r) {
  const numFiles = readNumber(r);
  let emptyStream = new Array(numFiles).fill(false);
  let emptyFile = [];
  let names = null;
  for (;;) {
    const propType = readNumber(r);
    if (propType === K.End) break;
    const size = readNumber(r);
    const end = r.pos + size;
    if (propType === K.EmptyStream) {
      emptyStream = readBitVector(r, numFiles);
    } else if (propType === K.EmptyFile) {
      const numEmpty = emptyStream.filter(Boolean).length;
      emptyFile = readBitVector(r, numEmpty);
    } else if (propType === K.Name) {
      names = readNames(r, size, numFiles);
    }
    // All other properties (times, attributes, anti, dummy) are skipped wholesale.
    r.pos = end;
  }
  return { numFiles, emptyStream, emptyFile, names };
}

// Parse a decompressed 7z header (must begin with kHeader, id 0x01) into a flat
// entry list plus the stream geometry needed to extract any file. Pure function.
export function parseHeader(headerBytes) {
  const r = makeReader(headerBytes);
  const id = readNumber(r);
  if (id !== K.Header) throw new Error('7z: not a plain header (id ' + id + ')');
  let streams = null, filesInfo = null;
  for (;;) {
    const pid = readNumber(r);
    if (pid === K.End) break;
    if (pid === K.MainStreamsInfo) streams = parseStreamsInfo(r);
    else if (pid === K.FilesInfo) filesInfo = parseFilesInfo(r);
    else {
      // ArchiveProperties / AdditionalStreamsInfo are rare and not
      // length-prefixed generically; stop and use what we have.
      break;
    }
  }
  return buildEntries(streams, filesInfo);
}

// Combine streams + files into the entry list. Each real (stream-backed) file
// records which folder it lives in and its byte offset inside that folder's
// decompressed output, so extraction can stream to it.
function buildEntries(streams, filesInfo) {
  const folders = (streams && streams.unpackInfo && streams.unpackInfo.folders) || [];
  const subSizes = (streams && streams.subStreams && streams.subStreams.sizes) || [];
  const numUnpack = (streams && streams.subStreams && streams.subStreams.numUnpack) || folders.map(() => 1);
  const packSizes = (streams && streams.packInfo && streams.packInfo.packSizes) || [];
  const packPos = (streams && streams.packInfo && streams.packInfo.packPos) || 0;

  // File offset of each folder's first packed stream (packed area starts at 32).
  const folderPackStart = [];
  const folderPackSize = [];
  let packIdx = 0, packByte = 32 + packPos;
  for (const f of folders) {
    let sz = 0;
    for (let p = 0; p < f.numPackedStreams; p++) sz += packSizes[packIdx + p] || 0;
    folderPackStart.push(packByte);
    folderPackSize.push(sz);
    packByte += sz; packIdx += f.numPackedStreams;
  }

  // Walk real files folder by folder, assigning substream sizes + offsets.
  const folderOf = [];   // for each real file: folder index
  const offsetIn = [];   // for each real file: offset inside the folder
  let si = 0;
  for (let fi = 0; fi < folders.length; fi++) {
    let off = 0;
    for (let s = 0; s < numUnpack[fi]; s++) {
      folderOf[si] = fi; offsetIn[si] = off; off += subSizes[si]; si++;
    }
  }

  const { numFiles, emptyStream, emptyFile, names } = filesInfo;
  const entries = [];
  let emptyIdx = 0, realIdx = 0;
  for (let i = 0; i < numFiles; i++) {
    const name = names ? names[i] : ('file' + i);
    const hasStream = !emptyStream[i];
    let isDir = false, size = 0, folderIndex = -1, offset = 0;
    if (hasStream) {
      size = subSizes[realIdx];
      folderIndex = folderOf[realIdx];
      offset = offsetIn[realIdx];
      realIdx++;
    } else {
      const isEmptyFile = emptyFile[emptyIdx++] === true;
      isDir = !isEmptyFile;   // empty stream + not empty-file flag => directory
    }
    entries.push({ name, isDir, size, folderIndex, offset, hasStream });
  }
  return {
    entries,
    folders,
    folderPackStart,
    folderPackSize,
  };
}

// ---------- LZMA1 "alone" wrapper (header + LZMA1 folders) ----------

// Build a legacy .lzma "alone" stream from a raw 7z LZMA1 coder: 5 prop bytes
// (lc/lp/pb + dict-size LE) and an 8-byte uncompressed size, then the raw data.
// Setting `unpackSize` below the true size makes the decoder stop early.
function aloneWrap(props, packed, unpackSize) {
  const out = new Uint8Array(13 + packed.length);
  out.set(props.subarray(0, 5), 0);
  let n = unpackSize;
  for (let i = 0; i < 8; i++) { out[5 + i] = n & 0xff; n = Math.floor(n / 256); }
  out.set(packed, 13);
  return out;
}

async function decodeLzma1(props, packed, wantBytes) {
  const out = await lzmaDecompress(aloneWrap(props, packed, wantBytes));
  return out || null;
}

// ---------- synthetic .xz around a raw LZMA2 stream (LZMA2 folders) ----------

function crc32(bytes, start, end) {
  let c = ~0;
  for (let i = start; i < end; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function putU32LE(arr, v) { arr.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); }
// xz multibyte integer (LEB128-style, 7 bits/byte).
function putVarint(arr, v) { while (v >= 0x80) { arr.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); } arr.push(v); }

// Wrap a raw LZMA2 coder stream (`packed`, with its 1-byte dict-size property)
// in a minimal single-block .xz with no integrity check, so the app's xzwasm
// (liblzma) decoder reads it. `unpackSize` is the folder's decompressed length.
function buildXz(propByte, packed, unpackSize) {
  // Stream header: magic, flags (00 00 = check None), CRC32(flags).
  const head = [0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00, 0x00, 0x00];
  const flagsCrc = crc32(Uint8Array.from([0x00, 0x00]), 0, 2);
  putU32LE(head, flagsCrc);

  // Block header: flags (0x00 = 1 filter, no sizes), LZMA2 filter (id 0x21,
  // 1 prop byte), pad to 4, CRC32(header-so-far).
  let bh = [0x00, 0x21, 0x01, propByte];
  // header size byte is (totalLen/4 - 1); totalLen = 1 + bh.length + pad + 4.
  // Try padding lengths until the whole header is a multiple of 4.
  let realBlockHeaderLen, pad;
  for (pad = 0; pad < 4; pad++) {
    realBlockHeaderLen = 1 + bh.length + pad + 4;
    if (realBlockHeaderLen % 4 === 0) break;
  }
  const sizeByte = realBlockHeaderLen / 4 - 1;
  const bhFull = [sizeByte, ...bh];
  for (let i = 0; i < pad; i++) bhFull.push(0x00);
  const bhCrc = crc32(Uint8Array.from(bhFull), 0, bhFull.length);
  putU32LE(bhFull, bhCrc);

  // Compressed data + padding to 4-byte boundary.
  const dataPad = (4 - (packed.length % 4)) % 4;

  // Index: indicator 0x00, count 1, record(unpaddedSize, uncompressedSize),
  // pad to 4, CRC32(index).
  const unpaddedSize = bhFull.length + packed.length; // block header + data, no check
  const idx = [0x00];
  putVarint(idx, 1);
  putVarint(idx, unpaddedSize);
  putVarint(idx, unpackSize);
  while (idx.length % 4 !== 0) idx.push(0x00);
  const idxCrc = crc32(Uint8Array.from(idx), 0, idx.length);
  const idxFull = idx.slice(); putU32LE(idxFull, idxCrc);

  // Stream footer: CRC32(backwardSize+flags), backwardSize, flags, magic 'YZ'.
  const backwardSize = idxFull.length / 4 - 1;
  const footMid = []; putU32LE(footMid, backwardSize); footMid.push(0x00, 0x00);
  const footCrc = crc32(Uint8Array.from(footMid), 0, footMid.length);
  const foot = []; putU32LE(foot, footCrc); foot.push(...footMid); foot.push(0x59, 0x5A);

  const total = head.length + bhFull.length + packed.length + dataPad + idxFull.length + foot.length;
  const xz = new Uint8Array(total);
  let o = 0;
  xz.set(head, o); o += head.length;
  xz.set(bhFull, o); o += bhFull.length;
  xz.set(packed, o); o += packed.length;
  o += dataPad;
  xz.set(idxFull, o); o += idxFull.length;
  xz.set(foot, o);
  return xz;
}

// Stream a synthetic-.xz through xzwasm, returning the byte range
// [offset, offset+size) of the decompressed output and stopping early. Keeps
// only the wanted slice in memory, so extracting a small file from a huge solid
// folder costs ~the file's size, not the folder's.
async function xzExtractRange(xzBytes, offset, size) {
  if (!(window.xzwasm && window.xzwasm.XzReadableStream)) {
    await loadScript('assets/vendor/xzwasm/xzwasm.min.js');
  }
  const XzReadableStream = window.xzwasm && window.xzwasm.XzReadableStream;
  if (typeof XzReadableStream !== 'function') return null;

  const out = new Uint8Array(size);
  let produced = 0;   // total decompressed bytes seen so far
  let filled = 0;     // bytes copied into `out`
  const wantEnd = offset + size;

  const compressed = new Response(xzBytes).body;
  const reader = new XzReadableStream(compressed).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || !value.byteLength) continue;
      const chunkStart = produced;
      const chunkEnd = produced + value.byteLength;
      produced = chunkEnd;
      if (chunkEnd <= offset) continue;            // entirely before our range
      const from = Math.max(0, offset - chunkStart);
      const to = Math.min(value.byteLength, wantEnd - chunkStart);
      if (to > from) { out.set(value.subarray(from, to), filled); filled += to - from; }
      if (produced >= wantEnd) break;              // got everything we need
    }
  } finally {
    try { await reader.cancel(); } catch (_) {}
  }
  return filled === size ? out : (filled > 0 ? out.subarray(0, filled) : null);
}

// ---------- public API ----------

async function sliceBytes(file, start, len) {
  return new Uint8Array(await file.slice(start, start + len).arrayBuffer());
}

// Read + decode the 7z header from `file`, returning the parsed model. Throws on
// anything we cannot handle so the caller can fall back to libarchive.
async function readModel(file) {
  const sig = await sliceBytes(file, 0, 32);
  const magic = [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C];
  if (!magic.every((b, i) => sig[i] === b)) throw new Error('7z: bad signature');
  // NextHeaderOffset (8) + NextHeaderSize (8), little-endian, both < 2^53 here.
  let nho = 0, nhs = 0;
  for (let i = 0; i < 8; i++) { nho += sig[12 + i] * 2 ** (8 * i); nhs += sig[20 + i] * 2 ** (8 * i); }
  if (nhs === 0) throw new Error('7z: empty header');
  let header = await sliceBytes(file, 32 + nho, nhs);

  if (header[0] === K.EncodedHeader) {
    // Tiny StreamsInfo describing the real header as one packed (usually LZMA) stream.
    const r = makeReader(header); readNumber(r); // consume the 0x17 id
    const si = parseStreamsInfo(r);
    const folder = si.unpackInfo.folders[0];
    if (folder.coders.length !== 1) throw new Error('7z: multi-coder encoded header');
    const coder = folder.coders[0];
    const packStart = 32 + si.packInfo.packPos;
    const packLen = si.packInfo.packSizes[0];
    const unpackLen = folderMainOutSize(folder);
    const packed = await sliceBytes(file, packStart, packLen);
    let real;
    if (coder.id === METHOD_LZMA) real = await decodeLzma1(coder.props, packed, unpackLen);
    else if (coder.id === METHOD_LZMA2) {
      const { xzDecompress } = await import('./xz-loader.js');
      real = await xzDecompress(buildXz(coder.props[0], packed, unpackLen));
    } else if (coder.id === METHOD_COPY) real = packed;
    else throw new Error('7z: encoded header coder ' + coder.id);
    if (!real) throw new Error('7z: header decode failed');
    header = real;
  }
  return parseHeader(header);
}

// Open a 7z File and return a libarchive-loader-compatible handle:
//   { entries: [{ name, size, getBytes() }], names, close() }
// `getBytes` streams just that file's bytes out of its (possibly huge, solid)
// folder. Returns null when the archive uses coder chains we cannot decode
// natively (the caller then tries libarchive).
export async function open7z(file) {
  const model = await readModel(file);

  // We can extract a file only if its folder is a single coder we support.
  const supported = (fi) => {
    const f = model.folders[fi];
    if (!f || f.coders.length !== 1) return false;
    const id = f.coders[0].id;
    return id === METHOD_LZMA || id === METHOD_LZMA2 || id === METHOD_COPY;
  };

  const entries = model.entries
    .filter((e) => !e.isDir)
    .map((e) => ({
      name: e.name,
      size: e.size,
      getBytes: async () => {
        if (!e.hasStream || e.size === 0) return new Uint8Array(0);
        if (!supported(e.folderIndex)) throw new Error('7z: unsupported coder for ' + e.name);
        const f = model.folders[e.folderIndex];
        const coder = f.coders[0];
        const packStart = model.folderPackStart[e.folderIndex];
        const packLen = model.folderPackSize[e.folderIndex];
        const packed = await sliceBytes(file, packStart, packLen);
        if (coder.id === METHOD_LZMA2) {
          const xz = buildXz(coder.props[0], packed, folderMainOutSize(f));
          const got = await xzExtractRange(xz, e.offset, e.size);
          if (!got) throw new Error('7z: extract failed for ' + e.name);
          return got;
        }
        if (coder.id === METHOD_LZMA) {
          const full = await decodeLzma1(coder.props, packed, e.offset + e.size);
          if (!full) throw new Error('7z: extract failed for ' + e.name);
          return full.subarray(e.offset, e.offset + e.size);
        }
        // COPY: stored, just slice the folder output.
        return packed.subarray(e.offset, e.offset + e.size);
      },
    }));

  return { entries, names: entries.map((e) => e.name), close() {} };
}

// Exposed for off-browser tests of the structure parser / xz wrapper.
export const _internal = { parseHeader, buildXz, aloneWrap, folderMainOutSize };
