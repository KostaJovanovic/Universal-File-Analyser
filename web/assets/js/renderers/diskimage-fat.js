/* Analyser - FAT filesystem + MBR parser (pure, no DOM)
   The byte-level half of the disk-image browser (diskimage.js). Kept DOM-free and
   dependency-free so the exact code that runs in the browser also runs under a
   Node test harness against a real image - the same split photo-recover.js and
   video-recover.js use.

   parseFatVolume() mounts a FAT12/16/32 volume that begins at a byte offset in an
   in-memory image and returns a descriptor plus a flat entry list
   ([{ name, size, getBytes }]) where each file's bytes are sliced out lazily.
   Everything is defensive - cluster-chain loop guards, entry / depth caps,
   bounds-checked reads - because a common reason to open a disk image is that it
   is damaged. */

// Defensive caps so a corrupt image can't spin forever or exhaust memory while
// the directory tree is walked.
export const MAX_ENTRIES = 100000;
export const MAX_DEPTH = 64;

// ---------- little-endian readers over the in-memory image ----------
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
function trimAscii(b, o, n) {
  let s = '';
  for (let i = 0; i < n; i++) { const c = b[o + i]; if (c) s += String.fromCharCode(c); }
  return s.replace(/\s+$/, '');
}

// ---------- boot sector / BPB sniffing ----------
// A FAT boot sector begins with a jump (EB xx 90 or E9 xx xx), a power-of-two
// bytes-per-sector and a valid sectors-per-cluster. Checked before we trust any
// BPB field, so a random blob at this offset can't be mis-read as a filesystem.
export function looksLikeFatBoot(b, o) {
  if (o + 512 > b.length) return false;
  if (!(b[o] === 0xEB || b[o] === 0xE9)) return false;
  const bps = u16(b, o + 0x0B);
  if (bps !== 512 && bps !== 1024 && bps !== 2048 && bps !== 4096) return false;
  const spc = b[o + 0x0D];
  if (![1, 2, 4, 8, 16, 32, 64, 128].includes(spc)) return false;
  if (u16(b, o + 0x0E) === 0) return false;            // reserved sectors must be >= 1
  return true;
}

// ---------- FAT next-cluster lookup ----------
function nextCluster(img, fatStart, type, cl) {
  if (type === 'FAT12') {
    const o = fatStart + Math.floor(cl * 3 / 2);
    if (o + 1 >= img.length) return 0x0FFFFFFF;
    const v = img[o] | (img[o + 1] << 8);
    return (cl & 1) ? (v >> 4) : (v & 0x0FFF);
  }
  if (type === 'FAT16') {
    const o = fatStart + cl * 2;
    if (o + 1 >= img.length) return 0x0FFFFFFF;
    return img[o] | (img[o + 1] << 8);
  }
  const o = fatStart + cl * 4;
  if (o + 3 >= img.length) return 0x0FFFFFFF;
  return (img[o] | (img[o + 1] << 8) | (img[o + 2] << 16) | (img[o + 3] << 24)) & 0x0FFFFFFF;
}
function isEoc(type, v) {
  if (type === 'FAT12') return v >= 0x0FF8;
  if (type === 'FAT16') return v >= 0xFFF8;
  return v >= 0x0FFFFFF8;
}

// Follow a cluster chain into an array of cluster numbers, guarding against the
// loops and runaway chains a corrupt FAT can produce.
function chain(img, fatStart, type, first, maxClusters) {
  const out = [];
  const seen = new Set();
  let cl = first;
  while (cl >= 2 && !isEoc(type, cl) && out.length < maxClusters) {
    if (seen.has(cl)) break;                    // loop in the FAT
    seen.add(cl);
    out.push(cl);
    const nxt = nextCluster(img, fatStart, type, cl);
    if (nxt < 2 || nxt === cl || nxt === 0x0FFFFFFF) break;
    cl = nxt;
  }
  return out;
}

// Long-filename (VFAT) UCS-2 assembly for one 32-byte LFN slot.
function lfnPart(b, p) {
  let s = '';
  const grab = (off, count) => {
    for (let i = 0; i < count; i += 2) {
      const c = b[p + off + i] | (b[p + off + i + 1] << 8);
      if (c === 0x0000 || c === 0xFFFF) return false;
      s += String.fromCharCode(c);
    }
    return true;
  };
  grab(1, 10) && grab(14, 12) && grab(28, 4);
  return s;
}

// Classic 8.3 short name -> "NAME.EXT".
function shortName(b, p) {
  let n = '';
  for (let i = 0; i < 8; i++) {
    const c = b[p + i];
    if (c === 0x20) continue;
    n += String.fromCharCode(c === 0x05 && i === 0 ? 0xE5 : c);   // 0x05 escapes a real 0xE5 lead byte
  }
  let e = '';
  for (let i = 8; i < 11; i++) { const c = b[p + i]; if (c !== 0x20) e += String.fromCharCode(c); }
  return e ? n + '.' + e : n;
}

// Parse one directory's raw bytes into { files, dirs, volumeLabel }.
function readDir(raw) {
  const files = [];
  const dirs = [];
  let volumeLabel = '';
  let lfn = '';
  for (let p = 0; p + 32 <= raw.length; p += 32) {
    const first = raw[p];
    if (first === 0x00) break;                 // no more entries in this directory
    if (first === 0xE5) { lfn = ''; continue; } // deleted
    const attr = raw[p + 11];
    if ((attr & 0x3F) === 0x0F) { lfn = lfnPart(raw, p) + lfn; continue; }   // LFN slot (reverse order)
    if (attr & 0x08) {                          // volume-label entry (also the FAT32 root label)
      if (!(attr & 0x10)) volumeLabel = trimAscii(raw, p, 11);
      lfn = '';
      continue;
    }
    const name = (lfn || shortName(raw, p)).replace(/�/g, '');
    lfn = '';
    if (!name || name === '.' || name === '..') continue;
    const startCl = (u16(raw, p + 0x14) << 16) | u16(raw, p + 0x1A);
    const size = u32(raw, p + 0x1C);
    (attr & 0x10 ? dirs : files).push({ name, startCl, size });
  }
  return { files, dirs, volumeLabel };
}

// Parse a FAT volume that begins at byte `partStart`. Returns a descriptor plus a
// flat entry list ([{ name, size, getBytes }]) ready for renderHandleTree, or null
// when the boot sector isn't a FAT we can read.
export function parseFatVolume(img, partStart) {
  if (!looksLikeFatBoot(img, partStart)) return null;
  const bps = u16(img, partStart + 0x0B);
  const spc = img[partStart + 0x0D];
  const reserved = u16(img, partStart + 0x0E);
  const numFats = img[partStart + 0x10];
  const rootEntries = u16(img, partStart + 0x11);
  const totalSectors = u16(img, partStart + 0x13) || u32(img, partStart + 0x20);
  let fatSize = u16(img, partStart + 0x16);
  let rootCluster = 0;
  const isFat32 = fatSize === 0;
  if (isFat32) { fatSize = u32(img, partStart + 0x24); rootCluster = u32(img, partStart + 0x2C); }
  if (!fatSize || !numFats || !totalSectors) return null;

  const bytesPerCluster = bps * spc;
  const rootDirSectors = Math.ceil((rootEntries * 32) / bps);
  const firstDataSector = reserved + numFats * fatSize + rootDirSectors;
  const dataSectors = totalSectors - firstDataSector;
  const countOfClusters = Math.max(0, Math.floor(dataSectors / spc));
  const type = isFat32 ? 'FAT32' : (countOfClusters < 4085 ? 'FAT12' : 'FAT16');
  const fatStart = partStart + reserved * bps;
  const clusterOffset = (cl) => partStart + (firstDataSector + (cl - 2) * spc) * bps;
  const maxClusters = countOfClusters + 2;

  // Gather a cluster chain's raw bytes (directories are small; a cap keeps a
  // corrupt chain bounded).
  function clustersToBytes(clusters) {
    const out = new Uint8Array(clusters.length * bytesPerCluster);
    let off = 0;
    for (const cl of clusters) {
      const start = clusterOffset(cl);
      if (start < 0 || start >= img.length) break;
      const slice = img.subarray(start, Math.min(start + bytesPerCluster, img.length));
      out.set(slice, off);
      off += bytesPerCluster;
    }
    return out.subarray(0, off);
  }

  // Read a file's bytes by walking its cluster chain and trimming to the recorded
  // size. Returned lazily (only when the user opens the file).
  function fileBytes(startCl, size) {
    if (!size || startCl < 2) return new Uint8Array(0);
    const need = Math.ceil(size / bytesPerCluster) + 1;
    const clusters = chain(img, fatStart, type, startCl, Math.min(need, maxClusters));
    const out = new Uint8Array(size);
    let off = 0;
    for (const cl of clusters) {
      if (off >= size) break;
      const start = clusterOffset(cl);
      if (start < 0 || start >= img.length) break;
      const n = Math.min(bytesPerCluster, size - off);
      out.set(img.subarray(start, Math.min(start + n, img.length)), off);
      off += n;
    }
    return out;
  }

  // Root directory bytes: a fixed region on FAT12/16, a cluster chain on FAT32.
  let rootRaw;
  if (isFat32) {
    rootRaw = clustersToBytes(chain(img, fatStart, type, rootCluster, maxClusters));
  } else {
    const rootStart = partStart + (reserved + numFats * fatSize) * bps;
    rootRaw = img.subarray(rootStart, Math.min(rootStart + rootEntries * 32, img.length));
  }

  const entries = [];
  let fileCount = 0, dirCount = 0, truncated = false;
  const visitedDirs = new Set();
  let volumeLabel = '';

  function walk(raw, path, depth) {
    if (depth > MAX_DEPTH || entries.length >= MAX_ENTRIES) { truncated = truncated || entries.length >= MAX_ENTRIES; return; }
    const { files, dirs, volumeLabel: vl } = readDir(raw);
    if (depth === 0 && vl) volumeLabel = vl;
    for (const f of files) {
      if (entries.length >= MAX_ENTRIES) { truncated = true; return; }
      fileCount++;
      const startCl = f.startCl, size = f.size, name = path ? path + '/' + f.name : f.name;
      entries.push({ name, size, getBytes: async () => fileBytes(startCl, size) });
    }
    for (const d of dirs) {
      if (d.startCl < 2 || visitedDirs.has(d.startCl)) continue;   // loop / bad-pointer guard
      visitedDirs.add(d.startCl);
      dirCount++;
      const sub = clustersToBytes(chain(img, fatStart, type, d.startCl, maxClusters));
      walk(sub, path ? path + '/' + d.name : d.name, depth + 1);
    }
  }
  walk(rootRaw, '', 0);

  // Boot-sector volume label as a fallback when there's no label directory entry.
  if (!volumeLabel) volumeLabel = trimAscii(img, partStart + (isFat32 ? 0x47 : 0x2B), 11);
  const oem = trimAscii(img, partStart + 0x03, 8);

  // Free space: count zero (unallocated) entries across the valid cluster range.
  let freeClusters = 0;
  for (let cl = 2; cl < countOfClusters + 2; cl++) {
    if (nextCluster(img, fatStart, type, cl) === 0) freeClusters++;
  }

  return {
    type, oem, volumeLabel, bytesPerCluster,
    volumeBytes: totalSectors * bps,
    capacityBytes: countOfClusters * bytesPerCluster,
    freeBytes: freeClusters * bytesPerCluster,
    fileCount, dirCount, truncated,
    entries,
  };
}

// ---------- MBR partition table ----------
export const FAT_PART_TYPES = new Set([0x01, 0x04, 0x06, 0x0B, 0x0C, 0x0E, 0x14, 0x16, 0x1B, 0x1C, 0x1E]);
export const PART_TYPE_NAMES = {
  0x01: 'FAT12', 0x04: 'FAT16 (<32M)', 0x05: 'Extended', 0x06: 'FAT16', 0x07: 'NTFS / exFAT',
  0x0B: 'FAT32 (CHS)', 0x0C: 'FAT32 (LBA)', 0x0E: 'FAT16 (LBA)', 0x0F: 'Extended (LBA)',
  0x82: 'Linux swap', 0x83: 'Linux', 0xA5: 'FreeBSD', 0xAF: 'HFS / HFS+', 0xEE: 'GPT protective',
};

// Parse a 4-entry MBR partition table, or null when the 0x55AA signature or the
// entries don't look like a partition table.
export function parseMbr(img) {
  if (img.length < 512 || img[510] !== 0x55 || img[511] !== 0xAA) return null;
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const o = 0x1BE + i * 16;
    const status = img[o];
    const type = img[o + 4];
    const lba = u32(img, o + 8);
    const sectors = u32(img, o + 12);
    // A valid entry has status 0x00/0x80 and a non-zero type + extent.
    if ((status !== 0x00 && status !== 0x80) || type === 0 || sectors === 0) continue;
    parts.push({ index: i, status, type, lba, sectors, boot: status === 0x80 });
  }
  return parts.length ? parts : null;
}

// Identify a non-FAT filesystem from signature bytes, so an image we can't browse
// still gets a helpful label rather than a bare "unknown".
export function otherFsLabel(img, off) {
  const at = (o, s) => { for (let i = 0; i < s.length; i++) if (img[off + o + i] !== s.charCodeAt(i)) return false; return true; };
  if (off + 0x8006 <= img.length && at(0x8001, 'CD001')) return 'ISO 9660 (CD/DVD)';
  if (at(0x03, 'NTFS')) return 'NTFS';
  if (at(0x03, 'EXFAT')) return 'exFAT';
  if (off + 0x43A <= img.length && img[off + 0x438] === 0x53 && img[off + 0x439] === 0xEF) return 'ext2/3/4';
  return null;
}
