/* Analyser - archive module
   Lazy-loads fflate from CDN to inspect ZIP archives without full extraction.
   Uses the shared folder/archive modules for treemap, breakdown, and tree. */

import { el, row, rowHelp, fmtBytes, buildFileTree, isUnreadableError, cloudFileWarning, errorCard, integrityCard, loadScript, asciiBar } from '../core/util.js';
import { normalizeArchive, renderBreakdownCards, renderViewToggle, categorizeExt } from './folder-archive-shared.js';
import { ARCHIVE_EXTS } from '../core/formats.js';
import { extractArchive } from '../lib/libarchive-loader.js';
import { gunzip } from '../core/binutil.js';
import { xzDecompress } from '../lib/xz-loader.js';
import { unlz4, unlzw } from '../lib/legacy-decompress.js';
import { lzmaDecompress } from '../lib/lzma-loader.js';

const FFLATE_URL = new URL('../../vendor/fflate.js', import.meta.url).href;

let fflateLib = null;

async function loadFflate() {
  if (fflateLib) return fflateLib;
  fflateLib = await import(FFLATE_URL);
  return fflateLib;
}

// ---------- ZIP parsing via central directory ----------

function parseZipEntries(buf) {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const entries = [];

  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) return entries;

  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdSize   = view.getUint32(eocdOffset + 12, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);

  let pos = cdOffset;
  const decoder = new TextDecoder();

  for (let i = 0; i < entryCount && pos < cdOffset + cdSize; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;

    const versionMadeBy = view.getUint16(pos + 4, true);
    const flags         = view.getUint16(pos + 8, true);
    const compMethod    = view.getUint16(pos + 10, true);
    const modTime       = view.getUint16(pos + 12, true);
    const modDate       = view.getUint16(pos + 14, true);
    const crc           = view.getUint32(pos + 16, true);
    const compSize      = view.getUint32(pos + 20, true);
    const uncompSize    = view.getUint32(pos + 24, true);
    const nameLen       = view.getUint16(pos + 28, true);
    const extraLen      = view.getUint16(pos + 30, true);
    const commentLen    = view.getUint16(pos + 32, true);
    const name          = decoder.decode(bytes.slice(pos + 46, pos + 46 + nameLen));
    const isDir         = name.endsWith('/');

    // Scan the extra field for a Zip64 extended-information record (id 0x0001).
    let zip64 = false;
    {
      let ep = pos + 46 + nameLen;
      const extraEnd = ep + extraLen;
      while (ep + 4 <= extraEnd) {
        const id = view.getUint16(ep, true);
        const sz = view.getUint16(ep + 2, true);
        if (id === 0x0001) { zip64 = true; break; }
        ep += 4 + sz;
      }
    }

    entries.push({ name, compSize, uncompSize, compMethod, crc, isDir, flags, versionMadeBy, modTime, modDate, zip64 });
    pos += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

// ---------- MIME guess for extracted files ----------

const MIME_MAP = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', flac: 'audio/flac',
  ogg: 'audio/ogg', opus: 'audio/opus', aac: 'audio/aac',
  mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo', mkv: 'video/x-matroska',
  webm: 'video/webm', pdf: 'application/pdf', json: 'application/json',
  xml: 'application/xml', html: 'text/html', css: 'text/css', js: 'text/javascript',
  txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', zip: 'application/zip',
};

function guessMime(ext) {
  return MIME_MAP[ext] || 'application/octet-stream';
}

function extOf(name) {
  const m = name.match(/\.([^./\\]+)$/);
  return m ? m[1].toLowerCase() : '';
}

// ---------- safety / metadata helpers ----------

// Decode a DOS date+time pair (as stored in the ZIP central directory) into a
// readable local timestamp. Returns '' when the fields are zero/invalid.
function dosDateTime(modDate, modTime) {
  try {
    if (!modDate) return '';
    const day    = modDate & 0x1f;
    const month  = (modDate >> 5) & 0x0f;
    const year   = ((modDate >> 9) & 0x7f) + 1980;
    const sec    = (modTime & 0x1f) * 2;
    const min    = (modTime >> 5) & 0x3f;
    const hour   = (modTime >> 11) & 0x1f;
    if (month < 1 || month > 12 || day < 1 || day > 31) return '';
    const d = new Date(year, month - 1, day, hour, min, sec);
    if (isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(min)}:${pad(sec)}`;
  } catch { return ''; }
}

// The high byte of "version made by" identifies the host OS that created the entry.
const HOST_OS = {
  0: 'MS-DOS / FAT', 1: 'Amiga', 2: 'OpenVMS', 3: 'Unix', 4: 'VM/CMS', 5: 'Atari ST',
  6: 'OS/2 HPFS', 7: 'Macintosh', 8: 'Z-System', 9: 'CP/M', 10: 'Windows NTFS',
  11: 'MVS', 12: 'VSE', 13: 'Acorn Risc', 14: 'VFAT', 15: 'alternate MVS',
  16: 'BeOS', 17: 'Tandem', 18: 'OS/400', 19: 'OS X (Darwin)',
};

// An entry is encrypted when general-purpose bit 0 of its flags is set.
function isEncrypted(e) {
  return ((e.flags || 0) & 0x0001) !== 0;
}

// ---------- timing & CRC forensics ----------

// DOS date+time -> epoch milliseconds (local), or null when zero/invalid. Parses
// the same fields as dosDateTime() but returns a number for span/histogram maths.
function dosToMs(modDate, modTime) {
  if (!modDate) return null;
  const day   = modDate & 0x1f;
  const month = (modDate >> 5) & 0x0f;
  const year  = ((modDate >> 9) & 0x7f) + 1980;
  const sec   = (modTime & 0x1f) * 2;
  const min   = (modTime >> 5) & 0x3f;
  const hour  = (modTime >> 11) & 0x1f;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day, hour, min, sec);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function fmtDuration(ms) {
  if (ms <= 0) return '0 seconds';
  const s = ms / 1000;
  if (s < 60) return (s < 1 ? Math.round(ms) + ' ms' : Math.round(s) + ' second' + (Math.round(s) === 1 ? '' : 's'));
  const m = s / 60; if (m < 60) return m.toFixed(m < 10 ? 1 : 0) + ' minutes';
  const h = m / 60; if (h < 24) return h.toFixed(h < 10 ? 1 : 0) + ' hours';
  const d = h / 24; if (d < 365) return d.toFixed(d < 10 ? 1 : 0) + ' days';
  return (d / 365).toFixed(1) + ' years';
}

// Standard table-based CRC-32 (the polynomial ZIP uses) for entry verification.
let CRC_TABLE = null;
function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// A small bar histogram of entry timestamps across [min, max] (left = earliest).
function buildTimeHistogram(stamps, min, max) {
  const N = 24;
  const span = max - min;
  const buckets = new Array(N).fill(0);
  for (const s of stamps) {
    const idx = span > 0 ? Math.min(N - 1, Math.floor((s - min) / span * N)) : 0;
    buckets[idx]++;
  }
  const peak = Math.max(...buckets, 1);
  const hist = el('div', { class: 'anr-ziphist' });
  buckets.forEach((c, i) => {
    const at = new Date(min + (span > 0 ? span * (i + 0.5) / N : 0));
    hist.appendChild(el('div', {
      class: 'anr-ziphist-bar',
      style: `height:${Math.max(2, Math.round(c / peak * 100))}%`,
      title: `${at.toLocaleString()} - ${c} file${c === 1 ? '' : 's'}`,
    }));
  });
  return el('div', {}, [el('div', { class: 'anr-hint', style: 'margin:10px 0 4px;' }, 'Timestamp distribution (earliest → latest)'), hist]);
}

// Decompress each verifiable entry, recompute its CRC-32, and compare to the
// value stored in the central directory. Bulk-decompress once, falling back to a
// per-entry pass so one bad stream can't void the whole run.
async function verifyArchiveCrcs(buf, verifiable) {
  const ffl = await loadFflate();
  const data = new Uint8Array(buf);
  await new Promise((r) => setTimeout(r, 0));   // let the progress bar paint first
  let decoded = null;
  try { decoded = ffl.unzipSync(data); } catch (_) { decoded = null; }
  let pass = 0, fail = 0, skipped = 0;
  const mismatches = [];
  for (const e of verifiable) {
    let content = decoded ? decoded[e.name] : null;
    if (!content) {
      try { content = ffl.unzipSync(data, { filter: (f) => f.name === e.name })[e.name]; } catch (_) {}
    }
    if (!content) { skipped++; continue; }
    if (crc32(content) === (e.crc >>> 0)) pass++;
    else { fail++; mismatches.push(e.name); }
  }
  return { pass, fail, skipped, mismatches };
}

// Build the "Timing & integrity" card: timestamp summary + flags + histogram, and
// an on-demand CRC verification control. Returns null when there's nothing to show.
function buildArchiveForensics(buf, fileEntries) {
  const dated = fileEntries.map((e) => dosToMs(e.modDate, e.modTime)).filter((t) => t != null).sort((a, b) => a - b);
  const verifiable = fileEntries.filter((e) => !isEncrypted(e));
  if (!dated.length && !verifiable.length) return null;

  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Timing & integrity'));

  if (dated.length) {
    const min = dated[0], max = dated[dated.length - 1], span = max - min;
    const fmtT = (ms) => { const d = new Date(ms), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
    const tbl = el('table', { class: 'anr-readout' });
    tbl.appendChild(row('Entries dated', `${dated.length} of ${fileEntries.length}`));
    tbl.appendChild(row('Earliest', fmtT(min)));
    tbl.appendChild(row('Latest', fmtT(max)));
    tbl.appendChild(rowHelp('Time span', fmtDuration(span),
      'How far apart the oldest and newest entry timestamps are. A span of seconds across many files suggests they were packed in one pass rather than gathered over time.'));

    const uniq = new Set(dated).size;
    const now = Date.now();
    const placeholder = dated.filter((s) => s === new Date(1980, 0, 1, 0, 0, 0).getTime()).length;
    const future = dated.filter((s) => s > now + 86400000).length;
    if (fileEntries.length >= 3 && span <= 2000) {
      tbl.appendChild(rowHelp('⚠ Bulk-added', `all ${dated.length} dated entries within ${fmtDuration(span)}`,
        'Every entry shares almost the same timestamp - a sign the archive was generated or repacked programmatically in a single pass, not assembled file by file.'));
    } else if (uniq === 1 && dated.length > 1) {
      tbl.appendChild(rowHelp('⚠ Identical timestamps', `all ${dated.length} dated entries share one timestamp`,
        'A single shared timestamp across every entry is typical of a tool-generated or repacked archive.'));
    }
    if (placeholder) tbl.appendChild(rowHelp('Placeholder dates', `${placeholder} entr${placeholder === 1 ? 'y' : 'ies'} at 1980-01-01`,
      'The DOS epoch (1980-01-01 00:00) is what tools write when no real modification time is available.'));
    if (future) tbl.appendChild(rowHelp('⚠ Future-dated', `${future} entr${future === 1 ? 'y' : 'ies'} dated after today`,
      'A timestamp in the future usually means a wrong system clock or a deliberately forged date.'));
    card.appendChild(tbl);
    card.appendChild(buildTimeHistogram(dated, min, max));
  }

  // On-demand CRC verification.
  const crcWrap = el('div', { style: 'margin-top:14px;' });
  crcWrap.appendChild(el('div', { class: 'anr-hint', style: 'margin:0 0 6px;' },
    'Recompute each entry’s CRC-32 and compare it to the value stored in the archive.'));
  const btn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' },
    `Verify entry CRCs (${verifiable.length} file${verifiable.length === 1 ? '' : 's'})`);
  const out = el('div', { style: 'margin-top:8px;' });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    out.textContent = '';
    const bar = asciiBar(); bar.indeterminate(); out.appendChild(bar);
    try {
      const res = await verifyArchiveCrcs(buf, verifiable);
      bar.stop(); out.textContent = '';
      const t = el('table', { class: 'anr-readout' });
      t.appendChild(row('Result', `${res.pass} passed, ${res.fail} failed${res.skipped ? `, ${res.skipped} unreadable` : ''}`));
      if (res.fail) {
        const sample = res.mismatches.slice(0, 8).join(', ') + (res.mismatches.length > 8 ? `, …(+${res.mismatches.length - 8} more)` : '');
        t.appendChild(rowHelp('⚠ CRC mismatches', sample,
          'These entries’ recomputed CRC-32 does not match the value stored in the archive - the data is corrupt or was altered after the archive was built.'));
      }
      out.appendChild(t);
    } catch (e) {
      bar.stop(); out.textContent = '';
      out.appendChild(errorCard('CRC verification failed: ' + (e && e.message)));
      btn.disabled = false;
    }
  });
  crcWrap.appendChild(btn);
  crcWrap.appendChild(out);
  card.appendChild(crcWrap);

  return card;
}

// A name is "unsafe" if it would escape the extraction directory: a parent
// traversal segment, an absolute POSIX path, or a Windows drive/UNC path.
function isUnsafePath(name) {
  if (!name) return false;
  const n = name.replace(/\\/g, '/');
  if (n.startsWith('/')) return true;                 // absolute POSIX
  if (/^[a-zA-Z]:/.test(n)) return true;              // C:\  drive letter
  if (name.startsWith('\\\\') || name.startsWith('//')) return true; // UNC
  const parts = n.split('/');
  return parts.indexOf('..') !== -1;                  // parent traversal
}

// Per-entry compression ratio (uncompressed ÷ compressed). 0 when not measurable.
function entryRatio(e) {
  if (!e || e.isDir || !e.compSize || !e.uncompSize) return 0;
  return e.uncompSize / e.compSize;
}

// ---------- main render ----------
// opts.embedded: true when this view is appended UNDER another analysis (the
// "browse as archive" feature). In that mode the whole-file SHA-256 card is
// skipped, since the primary analysis above already shows the file's hash.
export async function renderArchive(file, resultsEl, opts = {}) {
  const embedded = !!opts.embedded;
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading ZIP archive "${file.name}"…`));

  let buf;
  try {
    buf = await file.arrayBuffer();
  } catch (e) {
    resultsEl.innerHTML = '';
    if (isUnreadableError(e)) {
      resultsEl.appendChild(cloudFileWarning(file));
    } else {
      resultsEl.appendChild(errorCard('Could not read file: ' + (e && e.message)));
    }
    return;
  }

  const entries = parseZipEntries(buf);
  if (entries.length === 0) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('No entries found in this ZIP file, or the archive is corrupt.'));
    return;
  }

  resultsEl.innerHTML = '';

  // --- ZIP summary card ---
  const fileEntries = entries.filter((e) => !e.isDir);
  const dirEntries  = entries.filter((e) => e.isDir);
  const totalUncomp = fileEntries.reduce((s, e) => s + e.uncompSize, 0);
  const totalComp   = fileEntries.reduce((s, e) => s + e.compSize, 0);
  const ratio       = totalUncomp > 0 ? ((1 - totalComp / totalUncomp) * 100).toFixed(1) : '0';

  const infoCard = el('div', { class: 'anr-card' });
  infoCard.appendChild(el('h3', {}, 'ZIP archive'));

  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Application', 'ZIP Archive'));
  tbl.appendChild(row('Name', file.name));
  tbl.appendChild(row('Archive size', `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`));
  tbl.appendChild(row('Files', String(fileEntries.length)));
  tbl.appendChild(row('Directories', String(dirEntries.length)));
  tbl.appendChild(rowHelp('Total uncompressed', fmtBytes(totalUncomp), 'The combined size of all files once they are extracted from the archive.'));
  tbl.appendChild(rowHelp('Total compressed', fmtBytes(totalComp), 'The combined size of all files as they are stored inside the archive, after compression.'));
  tbl.appendChild(rowHelp('Compression ratio', ratio + '%', 'How much space the archive saves versus the uncompressed total, computed as 1 − compressed ÷ uncompressed. Higher percentages mean a smaller archive; 0% means no compression.'));
  // Compression methods used across the entries (8 = Deflate, 0 = Stored, etc.).
  const METHODS = { 0: 'Stored', 8: 'Deflate', 9: 'Deflate64', 12: 'BZIP2', 14: 'LZMA', 93: 'Zstandard', 95: 'XZ', 99: 'AES' };
  const methodCounts = {};
  for (const e of fileEntries) { const n = METHODS[e.compMethod] || ('Method ' + e.compMethod); methodCounts[n] = (methodCounts[n] || 0) + 1; }
  const methodStr = Object.entries(methodCounts).map(([k, v]) => k + ' ×' + v).join(', ');
  if (methodStr) tbl.appendChild(rowHelp('Compression', methodStr, 'The compression method(s) used for the entries. Deflate is the standard ZIP method; Stored means no compression.'));
  infoCard.appendChild(tbl);
  resultsEl.appendChild(infoCard);

  // --- Category breakdown (Overview + contents-slot + File types) ---
  // Rendered before the integrity/safety/forensics cards so the contents
  // visualisation (the treemap, which renderViewToggle drops into the slot this
  // leaves between Overview and File types) sits above the Integrity section.
  const items = normalizeArchive(entries);
  renderBreakdownCards(items, resultsEl);

  // SHA-256 of the whole archive (was previously missing for ZIP). Skipped when
  // embedded under another analysis that already shows the file hash.
  if (!embedded) resultsEl.appendChild(integrityCard(file));

  // --- Safety / integrity inspection (additive; only shown when noteworthy) ---
  try {
    const encrypted = fileEntries.filter(isEncrypted);
    const unsafe    = entries.filter((e) => isUnsafePath(e.name));
    const overallRatio = totalComp > 0 ? totalUncomp / totalComp : 0;
    const worstEntry = fileEntries.reduce((w, e) => {
      const r = entryRatio(e);
      return r > (w ? entryRatio(w) : 0) ? e : w;
    }, null);
    const worstRatio = worstEntry ? entryRatio(worstEntry) : 0;
    const zip64 = entries.some((e) => e.zip64);

    const ratioSuspicious = overallRatio > 100 || worstRatio > 1000;
    const hasFindings = encrypted.length > 0 || unsafe.length > 0 || ratioSuspicious || zip64;

    if (hasFindings) {
      const safeCard = el('div', { class: 'anr-card' });
      safeCard.appendChild(el('h3', {}, 'Safety'));
      const stbl = el('table', { class: 'anr-readout' });

      if (encrypted.length > 0) {
        const allEnc = encrypted.length === fileEntries.length;
        const note = allEnc
          ? ' - every file is encrypted, so contents cannot be previewed or extracted here.'
          : '';
        stbl.appendChild(rowHelp(
          'Encrypted entries',
          `${encrypted.length} of ${fileEntries.length}${note}`,
          'Files protected with a password (general-purpose flag bit 0). Analyser can list these entries but cannot decompress or preview their contents without the password.'
        ));
      }

      if (unsafe.length > 0) {
        const sample = unsafe.slice(0, 5).map((e) => e.name).join(', ');
        const more = unsafe.length > 5 ? `, …(+${unsafe.length - 5} more)` : '';
        stbl.appendChild(rowHelp(
          '⚠ Unsafe paths',
          `${unsafe.length} (path traversal) - ${sample}${more}`,
          'Entry names that contain "../", start with "/", or use a drive letter/UNC path. A naïve extractor could be tricked into writing these files outside the intended folder (a "Zip Slip" attack). Analyser never writes them to disk.'
        ));
      }

      if (ratioSuspicious) {
        const detail = worstRatio > 1000 && worstEntry
          ? `overall ${overallRatio.toFixed(0)}:1; one entry "${worstEntry.name}" expands ${worstRatio.toFixed(0)}:1`
          : `overall ${overallRatio.toFixed(0)}:1`;
        stbl.appendChild(rowHelp(
          '⚠ Suspicious compression ratio',
          detail,
          'A very high uncompressed-to-compressed ratio can indicate a "zip bomb" - a small archive that expands to an enormous size to exhaust memory or disk. Treat unfamiliar archives like this with caution.'
        ));
      }

      if (zip64) {
        stbl.appendChild(rowHelp(
          'ZIP64',
          'Yes (large-archive extensions present)',
          'This archive uses the ZIP64 format, which lifts the 4 GB / 65,535-entry limits of classic ZIP. It is normal for large archives.'
        ));
      }

      // Host OS / creating tool, from the first non-trivial "version made by".
      const vmb = (fileEntries[0] || entries[0] || {}).versionMadeBy;
      if (vmb != null) {
        const hostName = HOST_OS[(vmb >> 8) & 0xff] || ('host ' + ((vmb >> 8) & 0xff));
        const ver = (vmb & 0xff) / 10;
        stbl.appendChild(rowHelp(
          'Created on',
          `${hostName} (ZIP spec ${ver.toFixed(1)})`,
          'The host operating system and ZIP specification version recorded by the tool that produced this archive ("version made by" in the central directory).'
        ));
      }

      safeCard.appendChild(stbl);
      resultsEl.appendChild(safeCard);
    }
  } catch (e) {
    // Safety inspection is best-effort; never break ZIP browsing over it.
    if (window.console) console.warn('ZIP safety inspection failed:', e);
  }

  // --- Timing & CRC forensics ---
  try {
    const fcard = buildArchiveForensics(buf, fileEntries);
    if (fcard) resultsEl.appendChild(fcard);
  } catch (e) {
    if (window.console) console.warn('ZIP forensics failed:', e);
  }

  // --- Extract a file from the archive (for click-to-analyse) ---
  async function extractFile(entryName) {
    const ffl = await loadFflate();
    const data = new Uint8Array(buf);
    const unzipped = ffl.unzipSync(data, { filter: (f) => f.name === entryName });
    const content = unzipped[entryName];
    if (!content) return null;
    const ext = extOf(entryName);
    const fileName = entryName.split('/').pop() || entryName;
    return new File([content], fileName, { type: guessMime(ext) });
  }

  // Batch-extract a set of entries into [{ path, file }] for the EDA project views.
  async function extractFiles(names) {
    const ffl = await loadFflate();
    const set = new Set(names);
    const unzipped = ffl.unzipSync(new Uint8Array(buf), { filter: (f) => set.has(f.name) });
    const out = [];
    for (const name of names) {
      const content = unzipped[name];
      if (content) out.push({ path: name, file: new File([content], name.split('/').pop() || name, { type: 'application/octet-stream' }) });
    }
    return out;
  }

  // --- EDA project detection: if the archive holds an Altium or KiCad project,
  // stitch its documents into one combined cross-probing view at the top, exactly
  // as a dropped project FOLDER does (folder.js). The renderer module is loaded
  // lazily, only when a project is actually present. ---
  if (!embedded) detectEdaProject();
  function detectEdaProject() {
    const names = fileEntries.map((e) => e.name);
    const ALT_RE = /\.(prjpcb|prjpcbstructure|schdoc|schlib|pcbdoc|pcblib|epw|schdocpreview|pcbdocpreview)$/i;
    const ALT_DOC_RE = /\.(schdoc|schlib|pcbdoc|pcblib|prjpcb)$/i;
    const KI_RE = /(\.kicad_(pcb|sch|sym|mod|pro|prl)$|\.wbk$|(^|\/)(fp-lib-table|sym-lib-table|fp-info-cache)$)/i;
    const KI_DOC_RE = /\.kicad_(pcb|sch|pro)$/i;
    const altNames = names.filter((n) => ALT_RE.test(n));
    const kiNames = names.filter((n) => KI_RE.test(n));
    const folderLabel = (file.name || 'archive').replace(/\.[^.]+$/, '');
    if (altNames.some((n) => ALT_DOC_RE.test(n)) && altNames.length >= 2) loadProjectView('./altium.js', 'buildAltiumProjectCard', altNames, folderLabel, 'Altium');
    if (kiNames.some((n) => KI_DOC_RE.test(n)) && kiNames.length >= 2) loadProjectView('./kicad.js', 'buildKicadProjectCard', kiNames, folderLabel, 'KiCad');
  }
  function loadProjectView(mod, fn, names, label, kind) {
    const slot = el('div', { class: 'anr-card' }, el('div', { class: 'anr-info' }, `Building combined ${kind} project view…`));
    resultsEl.insertBefore(slot, resultsEl.firstChild);
    Promise.all([import(mod), extractFiles(names)])
      .then(([m, fileList]) => m[fn](fileList, label))
      .then((cardEl) => { slot.replaceWith(cardEl); })
      .catch(() => { slot.remove(); });
  }

  // Register a Back-bar restore that re-renders THIS archive before opening a
  // child, so the breadcrumb can step back to it one level at a time. Skipped in
  // embedded mode (the browse-as-archive view under a primary analysis), whose
  // sub-container is wiped by clearResultsUI - there's no standalone view to
  // restore there.
  const containerLabel = (file && file.name) || 'archive';
  function pushBack() {
    if ((opts && opts.embedded) || !window._anrPushNav) return;
    window._anrPushNav(containerLabel, () => { resultsEl.hidden = false; renderArchive(file, resultsEl); });
  }

  // --- Click-to-analyse handler (treemap) ---
  function onFileClick(item) {
    if (!item || !item.entry) return;
    const ext = extOf(item.entry.name);
    extractFile(item.entry.name).then(f => {
      if (!f) return;
      pushBack();
      if (ARCHIVE_EXTS.has(ext)) renderArchive(f, resultsEl);
      else if (window._anrHandleFile) window._anrHandleFile(f, { nested: true });
    });
  }

  // --- Click handler for tree view (receives key, value from buildFileTree) ---
  // We need an entry lookup by name
  const entryByName = {};
  for (const e of entries) entryByName[e.name] = e;

  function onTreeFileClick(key, val) {
    const entry = val && val.name ? val : null;
    if (!entry) return;
    const ext = extOf(entry.name);
    extractFile(entry.name).then(f => {
      if (!f) return;
      pushBack();
      if (ARCHIVE_EXTS.has(ext)) renderArchive(f, resultsEl);
      else if (window._anrHandleFile) window._anrHandleFile(f, { nested: true });
    });
  }

  // --- Build tree object ---
  const tree = {};
  for (const entry of entries) {
    const parts = entry.name.split('/').filter((p) => p);
    let node = tree;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1 && !entry.isDir) {
        node[part] = entry;
      } else {
        if (!node[part] || typeof node[part] !== 'object' || node[part].name) {
          node[part] = {};
        }
        node = node[part];
      }
    }
  }

  renderViewToggle(resultsEl, items, tree, {
    isDir: (v) => v && typeof v === 'object' && !v.name,
    fileSize: (v) => (v && v.uncompSize) || 0,
    copyPath: (_key, entry) => entry && entry.name,
    onFileClick: onTreeFileClick
  }, onFileClick);

  // --- Text file previews ---
  const textExts = new Set(['txt', 'md', 'json', 'xml', 'csv', 'tsv', 'html', 'htm',
    'css', 'js', 'ts', 'py', 'rb', 'java', 'c', 'h', 'cpp', 'rs', 'go',
    'yaml', 'yml', 'toml', 'ini', 'cfg', 'log', 'sh', 'bat', 'sql', 'svg']);

  const previewable = fileEntries.filter((e) => {
    if (e.uncompSize > 10240) return false;
    const ext = (e.name.match(/\.([^.]+)$/) || [])[1];
    return ext && textExts.has(ext.toLowerCase());
  });

  if (previewable.length > 0) {
    // Collapsed by default (.is-collapsed): the previews are a secondary detail
    // behind the file tree, so they start closed; the shared card-toggle in
    // app.js opens them when the "Text file previews" title is clicked.
    const prevCard = el('div', { class: 'anr-card is-collapsed' });
    prevCard.appendChild(el('h3', {}, 'Text file previews'));
    prevCard.appendChild(el('p', {
      class: 'anr-hint',
      style: 'margin: 0 0 8px; font-size: 12px;'
    }, `${previewable.length} small text file(s) can be previewed. Click to expand.`));

    let ffl = null;

    for (const entry of previewable.slice(0, 20)) {
      const details = el('details', {});
      let summaryMeta = '';
      try {
        const r = entryRatio(entry);
        const mt = dosDateTime(entry.modDate, entry.modTime);
        if (r > 1) summaryMeta += ' · ' + r.toFixed(1) + ':1';
        if (mt) summaryMeta += ' · ' + mt;
      } catch { /* metadata is optional */ }
      const summary = el('summary', {
        // overflow-wrap/word-break so long entry paths and the metadata tail wrap
        // instead of overflowing the card on narrow (mobile) viewports.
        style: 'cursor: pointer; font-weight: bold; margin: 4px 0; font-size: 13px;' +
               ' overflow-wrap: anywhere; word-break: break-word;'
      }, entry.name + '  (' + fmtBytes(entry.uncompSize) + ' · CRC ' + (entry.crc >>> 0).toString(16).padStart(8, '0') + summaryMeta + ')');
      details.appendChild(summary);

      const pre = el('pre', { class: 'anr-ocr-text' }, '');
      pre.style.maxHeight = '300px';
      pre.style.overflow = 'auto';
      details.appendChild(pre);

      let loaded = false;
      details.addEventListener('toggle', async () => {
        if (!details.open || loaded) return;
        loaded = true;
        pre.textContent = 'Decompressing…';
        try {
          if (!ffl) ffl = await loadFflate();
          const data = new Uint8Array(buf);
          const unzipped = ffl.unzipSync(data, {
            filter: (f) => f.name === entry.name
          });
          const content = unzipped[entry.name];
          if (content) {
            pre.textContent = new TextDecoder().decode(content);
          } else {
            pre.textContent = '(could not extract)';
          }
        } catch (e) {
          pre.textContent = 'Extraction error: ' + (e && e.message);
        }
      });

      prevCard.appendChild(details);
    }
    resultsEl.appendChild(prevCard);
  }
}

// ---------- libarchive-backed browse (RAR / 7z / etc.) ----------
// renderArchive handles ZIP in pure JS; non-ZIP containers are listed and
// extracted lazily through the vendored libarchive WASM worker. Same tree +
// treemap + click-to-analyse UX as the ZIP path, fed from the entry list.

function extLower(name) {
  const m = name.match(/\.([^./\\]+)$/);
  return m ? m[1].toLowerCase() : '';
}

async function renderLibarchive(file, resultsEl, opts) {
  const label = (opts && opts.label) || 'Archive';
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading ${label} archive "${file.name}"…`));

  let handle;
  try {
    handle = await extractArchive(file);
  } catch (e) {
    resultsEl.innerHTML = '';
    if (isUnreadableError(e)) resultsEl.appendChild(cloudFileWarning(file));
    else resultsEl.appendChild(errorCard('Could not read this archive in the browser - it may be encrypted, solid, or use an unsupported codec.'));
    return;
  }

  const fileEntries = (handle.entries || []).filter((e) => e && e.name && !e.name.endsWith('/'));
  resultsEl.innerHTML = '';
  if (!fileEntries.length) {
    resultsEl.appendChild(errorCard('No files found inside this archive.'));
    return;
  }

  renderHandleTree(handle, fileEntries, file, resultsEl, opts);
}

// Render an already-opened libarchive handle as the tree + treemap + breakdown,
// with click-to-analyse. Shared by renderLibarchive and the compressed-tarball
// path so neither has to re-open the archive.
function renderHandleTree(handle, fileEntries, file, resultsEl, opts) {
  const label = (opts && opts.label) || 'Archive';
  const items = fileEntries.map((e) => {
    const ext = extLower(e.name);
    return { path: e.name, size: e.size || 0, file: null, entry: e, category: categorizeExt(ext), ext };
  });

  const summaryRows = [
    row('Application', label + ' Archive'),
    row('Name', file.name),
    row('Archive size', `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`),
  ];
  renderBreakdownCards(items, resultsEl, summaryRows);

  // Build the nested tree object (leaf = the libarchive entry, branch = plain {}).
  const tree = {};
  for (const e of fileEntries) {
    const parts = e.name.split('/').filter((p) => p);
    let node = tree;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        node[part] = e;
      } else {
        if (!node[part] || typeof node[part] !== 'object' || node[part].name) node[part] = {};
        node = node[part];
      }
    }
  }

  async function openEntry(entry) {
    try {
      const bytes = await entry.getBytes();
      const f = new File([bytes], entry.name.split('/').pop() || entry.name, { type: 'application/octet-stream' });
      // Register a Back-bar restore that re-renders this archive (one level up).
      if (window._anrPushNav) {
        window._anrPushNav(file.name || 'archive', () => { resultsEl.hidden = false; resultsEl.innerHTML = ''; renderHandleTree(handle, fileEntries, file, resultsEl, opts); });
      }
      if (window._anrHandleFile) window._anrHandleFile(f, { nested: true });
    } catch (_) { /* extraction failed - ignore */ }
  }
  const onFileClick = (item) => { if (item && item.entry) openEntry(item.entry); };
  const onTreeFileClick = (_key, val) => { if (val && val.name) openEntry(val); };

  renderViewToggle(resultsEl, items, tree, {
    isDir: (v) => v && typeof v === 'object' && !v.name,
    fileSize: (v) => (v && v.size) || 0,
    copyPath: (_key, entry) => entry && entry.name,
    onFileClick: onTreeFileClick,
  }, onFileClick);
}

// ---------- ar / static & import library (.a / .lib) ----------
// A Unix ar archive and a Microsoft COFF library (.lib) are the same !<arch>
// container. The vendored libarchive build may not include the ar reader, and the
// layout is trivial, so we walk the members ourselves and hand renderHandleTree a
// libarchive-shaped handle (flat entries + lazy getBytes) to reuse its tree,
// treemap and click-to-analyse UI. Members are COFF .obj objects (and, in an
// import library, short-import stubs), so opening one lands on identification.
async function extractAr(file) {
  const b = new Uint8Array(await file.arrayBuffer());
  const MAGIC = [0x21, 0x3c, 0x61, 0x72, 0x63, 0x68, 0x3e, 0x0a]; // !<arch>\n
  if (b.length < 8 || MAGIC.some((c, i) => b[i] !== c)) throw new Error('Not an ar archive');
  const dec = new TextDecoder('latin1');
  const field = (o, n) => dec.decode(b.subarray(o, o + n));
  const raw = [];
  let pos = 8;
  while (pos + 60 <= b.length) {
    if (b[pos + 58] !== 0x60 || b[pos + 59] !== 0x0a) break;     // member header ends with "`\n"
    const size = parseInt(field(pos + 48, 10).trim(), 10) || 0;
    raw.push({ name16: field(pos, 16), size, dataStart: pos + 60 });
    pos = pos + 60 + size + (size & 1);                          // members are 2-byte aligned
  }
  // GNU/MS long-name string table (member named "//"); names point in as "/<off>".
  let longnames = null;
  for (const r of raw) {
    if (r.name16.replace(/ +$/, '') === '//') { longnames = b.subarray(r.dataStart, r.dataStart + r.size); break; }
  }
  const resolveName = (name16) => {
    const lref = name16.match(/^\/(\d+)/);
    if (lref && longnames) {
      const off = parseInt(lref[1], 10);
      let end = off;
      while (end < longnames.length && longnames[end] !== 0x0a && longnames[end] !== 0x00) end++;
      return dec.decode(longnames.subarray(off, end)).replace(/\/$/, '');
    }
    let n = name16.replace(/ +$/, '');
    if (n.endsWith('/')) n = n.slice(0, -1);                     // GNU trailing-slash terminator
    return n;
  };
  // Drop the linker bookkeeping members (symbol tables named "/", long-name table
  // "//") and give same-named members - every import stub carries the DLL name -
  // a unique label so they all appear in the tree.
  const used = new Map();
  const uniq = (name) => {
    const seen = used.get(name) || 0; used.set(name, seen + 1);
    if (!seen) return name;
    const dot = name.lastIndexOf('.');
    return dot > 0 ? `${name.slice(0, dot)} (${seen + 1})${name.slice(dot)}` : `${name} (${seen + 1})`;
  };
  const entries = raw
    .map((r, i) => ({ r, name: resolveName(r.name16), i }))
    .filter(({ name }) => name !== '' && name !== '/')
    .map(({ r, name, i }) => ({
      name: uniq(name || ('member-' + i)),
      size: r.size,
      getBytes: async () => b.subarray(r.dataStart, r.dataStart + r.size),
    }));
  return { names: entries.map((e) => e.name), entries, close() {} };
}

async function renderArEmbedded(file, resultsEl, opts) {
  const label = (opts && opts.label) || 'Library';
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading ${label} "${file.name}"…`));
  let handle;
  try {
    handle = await extractAr(file);
  } catch (e) {
    resultsEl.innerHTML = '';
    if (isUnreadableError(e)) resultsEl.appendChild(cloudFileWarning(file));
    else resultsEl.appendChild(errorCard('Could not read this library in the browser.'));
    return;
  }
  const fileEntries = (handle.entries || []).filter((e) => e && e.name);
  resultsEl.innerHTML = '';
  if (!fileEntries.length) { resultsEl.appendChild(errorCard('No members found inside this library.')); return; }
  renderHandleTree(handle, fileEntries, file, resultsEl, opts);
}

// Decompress a single-stream compressor (gzip / xz / zstd) by magic. Returns
// { data, codec, drop } where `drop` strips the compression extension from the
// inner filename, or null if the codec has no in-browser decoder (bzip2) or the
// magic is unknown. The tar/tarball case never reaches here - libarchive handles
// it directly (it bundles the gzip/xz/zstd/bzip2 read filters).
async function decompressStream(file) {
  const head = new Uint8Array(await file.slice(0, 13).arrayBuffer());
  const is = (sig) => sig.every((v, i) => head[i] === v);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (is([0x1F, 0x8B])) return { data: await gunzip(bytes), codec: 'gzip', drop: /\.(gz|tgz)$/i };
  if (is([0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00])) return { data: await xzDecompress(bytes), codec: 'xz', drop: /\.(xz|txz)$/i };
  if (is([0x28, 0xB5, 0x2F, 0xFD])) {
    if (!(window.fzstd && window.fzstd.decompress)) await loadScript('assets/vendor/fzstd.js');
    if (!(window.fzstd && window.fzstd.decompress)) return null;
    return { data: window.fzstd.decompress(bytes), codec: 'zstd', drop: /\.(zst|tzst)$/i };
  }
  if (is([0x04, 0x22, 0x4D, 0x18])) { const d = unlz4(bytes); return d ? { data: d, codec: 'LZ4', drop: /\.(lz4|tlz4)$/i } : null; }
  if (is([0x1F, 0x9D])) { const d = unlzw(bytes); return d ? { data: d, codec: 'LZW', drop: /\.(z|tz)$/i } : null; }
  // Legacy .lzma has no fixed magic; the default properties byte 0x5D plus the
  // 13-byte header is the reliable tell (matches the sniff in app.js).
  if (head[0] === 0x5D && bytes.length >= 13) { const d = await lzmaDecompress(bytes); if (d) return { data: d, codec: 'LZMA', drop: /\.(lzma|tlz)$/i }; }
  return null;   // bzip2 (no in-browser decoder) or unknown
}

// Browse/open a TAR or compressed stream: libarchive reads tar + tarballs
// (.tar.gz/.tgz/.tar.xz/.tar.zst/.tar.bz2) directly; a bare single compressed
// file is decompressed so the file inside can be analysed.
async function renderCompressedEmbedded(file, container, label) {
  const wrap = el('div', {});
  container.appendChild(wrap);
  wrap.appendChild(el('div', { class: 'anr-info' }, `Reading ${label} contents…`));

  let handle = null;
  try { handle = await extractArchive(file); } catch (_) { /* not a libarchive-readable archive */ }
  const fileEntries = handle ? (handle.entries || []).filter((e) => e && e.name && !e.name.endsWith('/')) : [];
  if (fileEntries.length) { wrap.remove(); renderHandleTree(handle, fileEntries, file, container, { label }); return; }

  // Single compressed stream: decompress and offer the file inside.
  let res = null;
  try { res = await decompressStream(file); } catch (_) { /* decompression failed */ }
  wrap.remove();
  if (!res || !res.data) {
    container.appendChild(el('p', { class: 'anr-hint', style: 'margin:0;font-size:12px;' },
      /bzip2|bz2/i.test(label)
        ? 'This is a single bzip2-compressed file. In-browser bzip2 decompression is not available, so only the identification above is shown.'
        : 'This compressed file could not be decompressed in the browser.'));
    return;
  }
  const innerName = (file.name || 'file').replace(res.drop, '') || 'decompressed';
  const inner = new File([res.data], innerName, { type: 'application/octet-stream' });
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Decompressed file'));
  card.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 8px;font-size:12px;' },
    `A single ${res.codec}-compressed file (${fmtBytes(res.data.length)} decompressed). Open the file inside to analyse it.`));
  const btn = el('button', { type: 'button', class: 'anr-btn' }, 'Analyse ' + innerName);
  btn.addEventListener('click', () => {
    if (window._anrPushNav) window._anrPushNav(file.name || 'archive', () => { if (window._anrHandleFile) window._anrHandleFile(file, {}); });
    if (window._anrHandleFile) window._anrHandleFile(inner, { nested: true });
  });
  card.appendChild(btn);
  container.appendChild(card);
}

// ---------- embeddable "browse as archive" view ----------
// Appended UNDER a file's primary analysis when that file is physically a
// container we can open. `opts.mode` is 'zip' (pure-JS path), 'libarchive'
// (RAR/7z/etc.), or 'compressed' (TAR + gz/xz/zst/bz2 tarballs and single
// streams); `opts.label` names the format.
export async function renderArchiveEmbedded(file, container, opts = {}) {
  const compressed = opts.mode === 'compressed';
  const label = opts.label || (opts.mode === 'zip' ? 'ZIP' : 'archive');
  const head = el('div', { class: 'anr-card' });
  head.appendChild(el('h3', {}, compressed ? 'Open contents' : 'Browse as archive'));
  head.appendChild(el('p', { class: 'anr-hint', style: 'margin:0;font-size:12px;' },
    compressed
      ? `This ${label} file is decompressed in your browser so you can open what is inside it.`
      : `This file is also a ${label} archive. Browse the files inside, and click any one to analyse it.`));
  container.appendChild(head);

  const wrap = el('div', {});
  container.appendChild(wrap);
  try {
    if (opts.mode === 'zip') await renderArchive(file, wrap, { embedded: true });
    else if (compressed) { wrap.remove(); await renderCompressedEmbedded(file, container, label); }
    else if (opts.mode === 'ar') await renderArEmbedded(file, wrap, { label });
    else await renderLibarchive(file, wrap, { label });
  } catch (e) {
    wrap.appendChild(errorCard('Could not browse this archive: ' + (e && e.message)));
  }
}
