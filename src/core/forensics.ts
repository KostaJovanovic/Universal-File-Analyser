/* Analyser - forensic integrity cards.
   Two content-vs-name checks and their readout cards, plus the integrity-card
   locator used to slot them into a renderer's output:
     - signature mismatch: the declared extension contradicted by the bytes
     - trailing data: content smuggled past a file's logical end
   Both take the sniffFileType() result (from file-sniff.js) as their `sniff` arg.
   trailingCard offers a "re-analyse the appended blob" button; app.js wires the
   handleFile callback in via setReanalyse() (mirrors its own _handleFile
   forward-reference, avoiding a circular import). */

import { fileExt, el, row, rowHelp, h3help, downloadBlob } from './util.js';
import { hexBytes } from './binutil.js';
import { SCAN_MED } from './limits.js';
import { sniffFileType } from './file-sniff.js';

// Re-analyse callback (app.js's handleFile), injected via setReanalyse() so this
// module doesn't import app.js back. Null until app.js boots.
let _reanalyse = null;
export function setReanalyse(fn) { _reanalyse = fn; }

// ---------- signature-vs-extension mismatch (forensic) ----------
// Extensions whose true content sniffFileType() can positively confirm, grouped
// by the sniffed ext(s) that legitimately satisfy them. Because we KNOW what these
// files' leading bytes should look like, we can flag two forensic tells: a wrong
// signature (a renamed/disguised file or a polyglot) and a missing one (the bytes
// match no known signature for the claimed type - corrupt, truncated, empty or
// disguised). Extensions NOT listed here get no warning - we can't be sure what
// their magic should be, so silence beats a false positive. `label` is the human
// name of the format the extension claims to be.
//   ftyp/ISO-BMFF (mp4/mov/m4a/heic/avif/3gp ...) all share one container, so any
//   ftyp-sniffed result satisfies any ftyp extension - renaming .m4a to .mp4 is
//   benign and must not flag. Likewise the whole PK zip family (docx/xlsx/epub ...).
const ISOBMFF = ['mp4', 'heic', 'avif', 'm4a', '3gp'];
const SIG_EXPECT = {
  jpg:  { sniff: ['jpg'],  label: 'JPEG image' }, jpeg: { sniff: ['jpg'], label: 'JPEG image' },
  jpe:  { sniff: ['jpg'],  label: 'JPEG image' }, jfif: { sniff: ['jpg'], label: 'JPEG image' },
  png:  { sniff: ['png'],  label: 'PNG image' },
  gif:  { sniff: ['gif'],  label: 'GIF image' },
  bmp:  { sniff: ['bmp'],  label: 'BMP image' }, dib: { sniff: ['bmp'], label: 'BMP image' },
  tif:  { sniff: ['tiff'], label: 'TIFF image' }, tiff: { sniff: ['tiff'], label: 'TIFF image' },
  webp: { sniff: ['webp'], label: 'WebP image' },
  psd:  { sniff: ['psd'],  label: 'Photoshop PSD' }, psb: { sniff: ['psd'], label: 'Photoshop PSD' },
  pdf:  { sniff: ['pdf'],  label: 'PDF document' },
  wav:  { sniff: ['wav'],  label: 'WAV audio' },
  avi:  { sniff: ['avi'],  label: 'AVI video' },
  mp3:  { sniff: ['mp3'],  label: 'MP3 audio' },
  flac: { sniff: ['flac'], label: 'FLAC audio' },
  ogg:  { sniff: ['ogg'],  label: 'Ogg media' }, oga: { sniff: ['ogg'], label: 'Ogg media' }, opus: { sniff: ['ogg'], label: 'Opus audio' },
  mkv:  { sniff: ['mkv'],  label: 'Matroska video' }, webm: { sniff: ['mkv'], label: 'WebM video' },
  mp4:  { sniff: ISOBMFF,  label: 'MP4 video' }, m4v: { sniff: ISOBMFF, label: 'MP4 video' }, mov: { sniff: ISOBMFF, label: 'QuickTime video' },
  m4a:  { sniff: ISOBMFF,  label: 'M4A audio' }, m4b: { sniff: ISOBMFF, label: 'M4B audio' },
  heic: { sniff: ISOBMFF,  label: 'HEIC image' }, heif: { sniff: ISOBMFF, label: 'HEIF image' }, avif: { sniff: ISOBMFF, label: 'AVIF image' },
  '3gp': { sniff: ISOBMFF, label: '3GP video' }, '3g2': { sniff: ISOBMFF, label: '3G2 video' },
  zip:  { sniff: ['zip'],  label: 'ZIP archive' }, docx: { sniff: ['zip'], label: 'Word document' },
  xlsx: { sniff: ['zip'],  label: 'Excel workbook' }, pptx: { sniff: ['zip'], label: 'PowerPoint deck' },
  epub: { sniff: ['zip'],  label: 'EPUB e-book' }, odt: { sniff: ['zip'], label: 'OpenDocument text' },
  ods:  { sniff: ['zip'],  label: 'OpenDocument sheet' }, odp: { sniff: ['zip'], label: 'OpenDocument slides' },
  odg:  { sniff: ['zip'],  label: 'OpenDocument drawing' }, jar: { sniff: ['zip'], label: 'Java archive' },
  apk:  { sniff: ['zip'],  label: 'Android package' }, hwpx: { sniff: ['zip'], label: 'HWPX document' },
  cbz:  { sniff: ['zip'],  label: 'Comic archive (ZIP)' },
  rar:  { sniff: ['rar'],  label: 'RAR archive' }, cbr: { sniff: ['rar'], label: 'Comic archive (RAR)' },
  '7z': { sniff: ['7z'],   label: '7-Zip archive' },
  gz:   { sniff: ['gz'],   label: 'GZip archive' }, tgz: { sniff: ['gz'], label: 'Gzipped tar' },
  xz:   { sniff: ['xz'],   label: 'XZ archive' },
  zst:  { sniff: ['zst'],  label: 'Zstandard archive' },
  bz2:  { sniff: ['bz2'],  label: 'bzip2 archive' },
  lz4:  { sniff: ['lz4'],  label: 'LZ4 archive' },
  exe:  { sniff: ['exe'],  label: 'Windows executable' }, dll: { sniff: ['exe'], label: 'Windows DLL' },
  elf:  { sniff: ['elf'],  label: 'ELF binary' }, so: { sniff: ['elf'], label: 'ELF shared object' },
  sqlite: { sniff: ['sqlite'], label: 'SQLite database' }, sqlite3: { sniff: ['sqlite'], label: 'SQLite database' },
  dcm:  { sniff: ['dcm'],  label: 'DICOM image' },
  tar:  { sniff: ['tar'],  label: 'TAR archive' },
  eps:  { sniff: ['eps'],  label: 'PostScript / EPS' }, ps: { sniff: ['eps'], label: 'PostScript' },
};

// Decide whether a file's declared extension is contradicted by its leading
// bytes. `sniff` is the sniffFileType() result (or null). Returns a descriptor
// for signatureCard(), or null when the extension is unknown to us or the
// signature checks out. Reads the first 16 bytes for the hex readout.
export async function signatureCheck(file, sniff) {
  const ext = (fileExt(file.name) || '').toLowerCase();
  const expect = SIG_EXPECT[ext];
  if (!expect) return null;                                // no expectation - stay quiet
  if (sniff && expect.sniff.includes(sniff.ext)) return null;   // signature matches the extension
  let hex = '';
  try {
    const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    hex = hexBytes(b, ' ');
  } catch (_) {}
  return { ext, label: expect.label, sniff: sniff || null, missing: !sniff, hex };
}

// Forensic readout card: declared type vs. what the bytes actually are. Styled as
// a flagged integrity card (accent left border), prepended above the analysis.
export function signatureCard(info) {
  const card = el('div', { class: 'anr-card anr-sig-flag', role: 'alert' });
  const [h, help] = h3help('Signature mismatch',
    'Every file type opens with a distinctive pattern of bytes - its signature, or “magic number”. '
    + 'Analyser reads those opening bytes and checks them against what the extension claims the file to be. '
    + 'When they disagree the file may be renamed, disguised, corrupt, truncated or a polyglot (two formats in one file), '
    + 'so do not trust the extension alone - verify it before opening.');
  card.appendChild(h); card.appendChild(help);
  const t = el('table', { class: 'anr-readout' });
  t.appendChild(row('Declared as', '.' + info.ext + ' (' + info.label + ')'));
  if (info.missing) t.appendChild(row('Content', 'no recognised ' + info.label + ' signature'));
  else t.appendChild(row('Content looks like', info.sniff.label + ' (.' + info.sniff.ext + ')'));
  if (info.hex) t.appendChild(rowHelp('Leading bytes', info.hex,
    'The raw first bytes of the file, shown in hex. Because each format begins with its own signature, '
    + 'these opening bytes reveal what the file really is, whatever its name says.'));
  card.appendChild(t);
  const msg = info.missing
    ? 'The name claims a ' + info.label + ', but the leading bytes match no known ' + info.label + ' signature.'
    : 'The name says .' + info.ext + ', but the contents are actually a ' + info.sniff.label + '.';
  card.appendChild(el('p', { class: 'anr-sig-flag-note' }, msg));
  return card;
}

// ---------- trailing data after the logical end (forensic) ----------
// Bytes after a file's structural end are a classic way to smuggle or hide
// content (a polyglot, an appended archive, steganography) - normal viewers
// ignore them. PDF has its own appended-%%EOF check in pdf.js; this generalises
// the idea to the common containers whose true end we can pin down cheaply:
// declared-size formats (BMP, RIFF/WAV/AVI/WebP, ZIP-via-EOCD) and the chunk/
// marker-terminated images (PNG IEND, JPEG EOI, GIF trailer). Whole-file scans
// (PNG/JPEG/GIF) are capped so a giant image can't stall the drop.
const TRAIL_MAX_FULL = SCAN_MED;

// ZIP: the End Of Central Directory record is the last structure; anything after
// it (past its own comment field) is appended. Scan the tail for the last EOCD.
async function zipLogicalEnd(file) {
  const readLen = Math.min(file.size, 65557);   // EOCD(22) + max comment(65535)
  const start = file.size - readLen;
  const b = new Uint8Array(await file.slice(start).arrayBuffer());
  for (let i = b.length - 22; i >= 0; i--) {
    if (b[i] === 0x50 && b[i + 1] === 0x4B && b[i + 2] === 0x05 && b[i + 3] === 0x06) {
      const commentLen = b[i + 20] | (b[i + 21] << 8);
      return start + i + 22 + commentLen;
    }
  }
  return null;
}

// Fast path shared by the three whole-file scans below. These sit on the
// critical path for every PNG/JPEG/GIF - trailingDataCheck is awaited before the
// renderer is even dispatched - and each one used to pull the entire file into
// memory just to confirm the usual answer, "nothing is appended". A file whose
// final bytes are its own terminator has nothing after its logical end, so check
// that first and read a few bytes instead of up to TRAIL_MAX_FULL. The full scan
// still runs for the files that actually have something hidden after the end,
// which is the case worth spending time on.
async function endsWith(file, sig) {
  if (file.size < sig.length) return false;
  const b = new Uint8Array(await file.slice(file.size - sig.length).arrayBuffer());
  for (let i = 0; i < sig.length; i++) if (b[i] !== sig[i]) return false;
  return true;
}

// IEND is always a zero-length chunk with a fixed CRC, so all 12 bytes are known.
const PNG_IEND = [0, 0, 0, 0, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82];

// PNG: walk length-prefixed chunks from byte 8 to IEND; end is past IEND's CRC.
async function pngLogicalEnd(file) {
  if (await endsWith(file, PNG_IEND)) return file.size;
  const b = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(b.buffer);
  let pos = 8;
  while (pos + 12 <= b.length) {
    const len = dv.getUint32(pos);
    const type = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]);
    pos += 12 + len;                    // length(4) + type(4) + data + crc(4)
    if (type === 'IEND') return pos;
    if (pos > b.length) return null;    // malformed / truncated
  }
  return null;
}

// JPEG: the real EOI is the last FF D9 (appended data after it has no marker
// meaning). Scanning from the end under-reports rather than false-flags.
async function jpegLogicalEnd(file) {
  if (await endsWith(file, [0xFF, 0xD9])) return file.size;
  const b = new Uint8Array(await file.arrayBuffer());
  for (let i = b.length - 2; i >= 2; i--) {
    if (b[i] === 0xFF && b[i + 1] === 0xD9) return i + 2;
  }
  return null;
}

// GIF: block walk (screen descriptor -> extensions / image blocks) to the 0x3B
// trailer; end is the byte after it.
async function gifLogicalEnd(file) {
  // A single 0x3B could in principle be the last byte of an appended blob rather
  // than the real trailer, so this can under-report - the same trade-off the JPEG
  // scan above already makes deliberately, and preferable to a false flag.
  if (await endsWith(file, [0x3B])) return file.size;
  const b = new Uint8Array(await file.arrayBuffer());
  let p = 6;                            // after "GIF87a"/"GIF89a"
  if (p + 7 > b.length) return null;
  const packed = b[p + 4];
  p += 7;
  if (packed & 0x80) p += 3 * (1 << ((packed & 7) + 1));   // global colour table
  const skipSubBlocks = () => { while (p < b.length) { const sz = b[p++]; if (sz === 0) break; p += sz; } };
  while (p < b.length) {
    const sep = b[p++];
    if (sep === 0x3B) return p;                             // trailer
    if (sep === 0x21) { p++; skipSubBlocks(); }             // extension: label + sub-blocks
    else if (sep === 0x2C) {                                // image descriptor
      if (p + 9 > b.length) return null;
      const ipacked = b[p + 8];
      p += 9;
      if (ipacked & 0x80) p += 3 * (1 << ((ipacked & 7) + 1));   // local colour table
      p++;                                                  // LZW min code size
      skipSubBlocks();
    } else return null;                                     // unknown block - bail
    if (p > b.length) return null;
  }
  return null;
}

// Decide whether a file carries data past its logical end. `sniff` (from
// sniffFileType) names the container. Returns a descriptor for trailingCard() or
// null. Pure zero-padding is treated as benign and ignored.
export async function trailingDataCheck(file, sniff) {
  if (!sniff) return null;
  const ext = sniff.ext;
  let logicalEnd = null;
  try {
    if (ext === 'bmp') {
      const b = new Uint8Array(await file.slice(0, 6).arrayBuffer());
      logicalEnd = b[2] | (b[3] << 8) | (b[4] << 16) | (b[5] << 24);
    } else if (ext === 'wav' || ext === 'avi' || ext === 'webp') {
      const b = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      logicalEnd = 8 + ((b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24)) >>> 0);
    } else if (ext === 'zip') {
      logicalEnd = await zipLogicalEnd(file);
    } else if (ext === 'png' || ext === 'jpg' || ext === 'gif') {
      if (file.size > TRAIL_MAX_FULL) return null;
      logicalEnd = ext === 'png' ? await pngLogicalEnd(file)
        : ext === 'jpg' ? await jpegLogicalEnd(file)
        : await gifLogicalEnd(file);
    } else {
      return null;
    }
  } catch (_) { return null; }
  if (logicalEnd == null || logicalEnd <= 0 || logicalEnd >= file.size) return null;
  const trailing = file.size - logicalEnd;
  if (trailing < 1) return null;
  // Ignore benign zero-padding (some tools pad to a block boundary).
  const sample = new Uint8Array(await file.slice(logicalEnd, logicalEnd + Math.min(trailing, 4096)).arrayBuffer());
  if (sample.every((x) => x === 0)) return null;
  const hex = hexBytes(sample.slice(0, 16), ' ');
  const tSniff = await sniffFileType(file.slice(logicalEnd)).catch(() => null);
  return {
    logicalEnd, trailing, hex, fmtLabel: sniff.label,
    sniffLabel: tSniff ? tSniff.label : null,
    sniffExt: tSniff ? tSniff.ext : null,
    sniffKind: tSniff ? tSniff.kind : null,
  };
}

// Forensic readout for appended data, styled like the signature-mismatch card.
// `file` is supplied so the hidden trailing blob can be extracted (downloaded) or
// fed straight back into the analyser (browse an appended ZIP, view a smuggled JPEG).
export function trailingCard(info, file) {
  // A plain card (not the red anr-sig-flag alert): trailing data is worth noting
  // but not an integrity failure, and it sits low in the readout, just above the
  // Integrity card, rather than leading the analysis.
  const card = el('div', { class: 'anr-card' });
  const [h, help] = h3help('Trailing data',
    'Content that sits after a file’s real, structural end. Normal viewers stop at that end and ignore it, '
    + 'which makes appended bytes a classic way to hide or smuggle content - a polyglot, an appended archive, '
    + 'or steganography. Inspect it if the file came from an untrusted source.');
  card.appendChild(h); card.appendChild(help);
  const t = el('table', { class: 'anr-readout' });
  t.appendChild(row('File type', info.fmtLabel));
  t.appendChild(rowHelp('Logical end', info.logicalEnd.toLocaleString() + ' bytes',
    'Where the file’s own structure actually ends. Anything between here and the total size is extra data added afterwards.'));
  t.appendChild(row('Trailing data', info.trailing.toLocaleString() + ' bytes after the end'));
  if (info.sniffLabel) t.appendChild(row('Appended content', 'looks like ' + info.sniffLabel));
  if (info.hex) t.appendChild(rowHelp('First bytes', info.hex,
    'The opening bytes of the appended data, in hex. Their signature hints at what the hidden content is.'));
  card.appendChild(t);
  card.appendChild(el('p', { class: 'anr-sig-flag-note' },
    info.trailing.toLocaleString() + ' bytes sit after the logical end of this ' + info.fmtLabel + '.'));
  // Extraction: carve the trailing region out as a blob. Download it, or analyse it
  // in place (an appended ZIP opens the archive browser, a JPEG the photo analyser).
  if (file) {
    const slice = () => file.slice(info.logicalEnd);
    const base = (file.name || 'file').replace(/\.[^.]*$/, '') || 'file';
    const dlName = base + '.appended.' + (info.sniffExt || 'bin');
    // Create the object URL lazily on click (via downloadBlob, which revokes it
    // after) instead of eagerly: an eager createObjectURL pins a Blob slice of
    // every polyglot file for the page's lifetime whether or not it's downloaded.
    const dl = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, 'Extract appended data');
    dl.addEventListener('click', () => downloadBlob(dlName, slice()));
    const btns = [dl];
    if (info.sniffKind) {
      const an = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' },
        'Analyse appended ' + (info.sniffExt ? info.sniffExt.toUpperCase() : 'data'));
      an.addEventListener('click', () => { if (_reanalyse) _reanalyse(new File([slice()], dlName, { type: '' })); });
      btns.push(an);
    }
    card.appendChild(el('div', { class: 'anr-btn-row', style: 'margin-top:8px;' }, btns));
  }
  return card;
}

// Find the renderer's integrity readout and return the .anr-card holding it.
// Used both to avoid appending a second, generic Integrity card over the top of a
// renderer's own, and to slot the trailing-data card in just above it (integrity
// is the last card most renderers append).
//
// Two shapes count. Most renderers give it a card of its own, led by an <h3>
// starting with "Integrity" (plain or the h3help "Integrity[?]" form). photo.js
// instead keeps the fingerprints as a part inside its Advanced card, which marks
// itself [data-integrity] so it is still found - and since Advanced is the last
// card on the page, "just above it" stays the right place for trailing data.
export function findIntegrityCard(root) {
  const part = root.querySelector('[data-integrity]');
  if (part) {
    const card = part.closest('.anr-card');
    if (card) return card;
  }
  for (const card of root.querySelectorAll('.anr-card')) {
    const h = card.querySelector('h3');
    if (h && h.textContent.trim().startsWith('Integrity')) return card;
  }
  return null;
}
