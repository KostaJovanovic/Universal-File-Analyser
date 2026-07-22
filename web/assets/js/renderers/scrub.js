/* Analyser - metadata scrubber
   Lossless removal of identifying metadata from images. Works by container
   surgery, not re-encoding: we parse the segment/chunk structure and drop only
   the metadata blocks (EXIF, XMP, IPTC, comments), copying every other byte -
   including the pixel/scan data - verbatim. So the output is bit-identical in
   its imagery and colour handling; only the identifying metadata is gone.

   Rendering-critical blocks are deliberately KEPT so the picture looks the same:
   JPEG JFIF/ICC/Adobe segments, PNG colour chunks (iCCP/gAMA/cHRM/sRGB), WebP
   ICCP. GPS lives inside EXIF, so stripping EXIF removes location too.

   Supported: JPEG, PNG, WebP. Each stripper returns { out, removed } (or null if
   the bytes don't parse as that format) where `removed` is a list of
   { label, bytes } describing what was cut. */

import { el, fileExt, fmtBytes, wireInfoToggle } from '../core/util.js';

// ---------- JPEG ----------
// A JPEG is SOI (FF D8) then a run of marker segments, each FF <marker> <2-byte
// big-endian length> <payload>, until SOS (FF DA) after which the entropy-coded
// scan runs to EOI. All metadata sits in APPn/COM segments before SOS, so once
// we reach SOS we can copy the remainder verbatim.
const JPEG_KEEP_APP = new Set([0xE0, 0xE2, 0xEE]); // APP0 JFIF, APP2 ICC, APP14 Adobe

function app1Label(bytes, payloadStart) {
  // Identify what an APP1 segment carries from its leading signature.
  const sig = latin1(bytes, payloadStart, 34);
  if (sig.startsWith('Exif')) return 'EXIF';
  if (sig.startsWith('http://ns.adobe.com/xap')) return 'XMP';
  if (sig.startsWith('http://ns.adobe.com/xmp')) return 'XMP (extension)';
  return 'APP1 metadata';
}

function stripJpeg(b) {
  if (b[0] !== 0xFF || b[1] !== 0xD8) return null;
  const keep = [[0, 2]];          // SOI
  const removed = [];
  let i = 2;
  while (i + 1 < b.length) {
    if (b[i] !== 0xFF) return null; // not aligned on a marker - refuse rather than corrupt
    let marker = b[i + 1];
    while (marker === 0xFF && i + 2 < b.length) { i++; marker = b[i + 1]; } // skip fill bytes
    if (marker === 0xD9) { keep.push([i, b.length]); break; }               // EOI
    if (marker === 0xDA) { keep.push([i, b.length]); break; }               // SOS - copy scan to end
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { keep.push([i, i + 2]); i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) return null;
    const segEnd = i + 2 + len;
    if (segEnd > b.length) return null;
    const isApp = marker >= 0xE0 && marker <= 0xEF;
    const isCom = marker === 0xFE;
    if ((isApp && !JPEG_KEEP_APP.has(marker)) || isCom) {
      const label = isCom ? 'Comment'
        : marker === 0xE1 ? app1Label(b, i + 4)
        : marker === 0xED ? 'IPTC / Photoshop (APP13)'
        : 'APP' + (marker - 0xE0) + ' metadata';
      removed.push({ label, bytes: segEnd - i });
    } else {
      keep.push([i, segEnd]);
    }
    i = segEnd;
  }
  return { out: assemble(b, keep), removed };
}

// ---------- PNG ----------
// PNG is an 8-byte signature then length(4 BE) + type(4) + data + CRC(4) chunks.
// Metadata lives in text and timestamp chunks; every colour/rendering chunk is
// kept so the image is unchanged.
const PNG_SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

function stripPng(b) {
  for (let k = 0; k < 8; k++) if (b[k] !== PNG_SIG[k]) return null;
  const keep = [[0, 8]];
  const removed = [];
  let i = 8;
  while (i + 8 <= b.length) {
    const len = (b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]) >>> 0;
    const type = latin1(b, i + 4, 4);
    const chunkEnd = i + 12 + len;
    if (chunkEnd > b.length) return null;
    if (PNG_DROP.has(type)) {
      let label = type;
      if (type === 'eXIf') label = 'EXIF';
      else if (type === 'tIME') label = 'Timestamp (tIME)';
      else {
        const kw = latin1(b, i + 8, Math.min(len, 79)).split('\0')[0];
        label = (/xmp/i.test(kw) ? 'XMP' : 'Text') + (kw ? ' (' + kw + ')' : '');
      }
      removed.push({ label, bytes: chunkEnd - i });
    } else {
      keep.push([i, chunkEnd]);
    }
    if (type === 'IEND') { keep.push([chunkEnd, b.length]); break; }
    i = chunkEnd;
  }
  return { out: assemble(b, keep), removed };
}

// ---------- WebP ----------
// RIFF: "RIFF" size(4 LE) "WEBP" then FourCC(4) size(4 LE) data pad(to even).
// Drop the EXIF and XMP chunks; clear their presence flags in the VP8X header so
// the container stays self-consistent. The RIFF size is recomputed on assembly.
function stripWebp(b) {
  if (latin1(b, 0, 4) !== 'RIFF' || latin1(b, 8, 4) !== 'WEBP') return null;
  const removed = [];
  const chunks = [];         // kept chunk byte-ranges (excluding the 12-byte RIFF header)
  let vp8xFlagsOff = -1;
  let i = 12;
  while (i + 8 <= b.length) {
    const fourcc = latin1(b, i, 4);
    const size = (b[i + 4] | b[i + 5] << 8 | b[i + 6] << 16 | b[i + 7] * 0x1000000) >>> 0;
    const dataEnd = i + 8 + size;
    const padEnd = dataEnd + (size & 1);
    if (dataEnd > b.length) return null;
    if (fourcc === 'EXIF' || fourcc === 'XMP ') {
      removed.push({ label: fourcc === 'EXIF' ? 'EXIF' : 'XMP', bytes: Math.min(padEnd, b.length) - i });
    } else {
      if (fourcc === 'VP8X') vp8xFlagsOff = i + 8; // first payload byte holds the feature flags
      chunks.push([i, Math.min(padEnd, b.length)]);
    }
    i = padEnd;
  }
  if (!removed.length) return { out: b, removed };
  // Rebuild: RIFF header + kept chunks, with VP8X EXIF(0x08)/XMP(0x04) flags cleared.
  let total = 4; // "WEBP"
  for (const [s, e] of chunks) total += e - s;
  const out = new Uint8Array(12 + (total - 4));
  out.set(b.subarray(0, 12));
  out[4] = total & 0xFF; out[5] = (total >> 8) & 0xFF; out[6] = (total >> 16) & 0xFF; out[7] = (total >>> 24) & 0xFF;
  let p = 12;
  for (const [s, e] of chunks) {
    if (vp8xFlagsOff >= s && vp8xFlagsOff < e) {
      out.set(b.subarray(s, e), p);
      out[p + (vp8xFlagsOff - s)] &= ~0x0C; // clear EXIF + XMP presence bits
    } else {
      out.set(b.subarray(s, e), p);
    }
    p += e - s;
  }
  return { out, removed };
}

// ---------- shared helpers ----------
function latin1(b, start, len) {
  let s = '';
  const end = Math.min(start + len, b.length);
  for (let k = start; k < end; k++) s += String.fromCharCode(b[k]);
  return s;
}

// Concatenate a set of [start, end) byte-ranges from `b` into one Uint8Array.
function assemble(b, ranges) {
  let total = 0;
  for (const [s, e] of ranges) total += e - s;
  const out = new Uint8Array(total);
  let p = 0;
  for (const [s, e] of ranges) { out.set(b.subarray(s, e), p); p += e - s; }
  return out;
}

const STRIPPERS = { jpeg: stripJpeg, png: stripPng, webp: stripWebp };

// Pick a stripper from the magic bytes (trust the bytes, not the extension).
function detectFormat(b) {
  if (b[0] === 0xFF && b[1] === 0xD8) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png';
  if (latin1(b, 0, 4) === 'RIFF' && latin1(b, 8, 4) === 'WEBP') return 'webp';
  return null;
}

export function scrubSupportsImage(file) {
  const ext = fileExt(file.name);
  const type = file.type || '';
  return /^(jpe?g|jpe|png|webp)$/i.test(ext) || /^image\/(jpeg|png|webp)$/i.test(type);
}

// Strip metadata from an image File; returns { out:Uint8Array, removed, format }
// or null if the bytes don't parse as a supported image.
export async function stripImage(file) {
  const b = new Uint8Array(await file.arrayBuffer());
  const format = detectFormat(b);
  if (!format) return null;
  const res = STRIPPERS[format](b);
  if (!res) return null;
  return { ...res, format };
}

// ---------- UI ----------
// Appends a "Remove metadata" control to an existing card (the photo Metadata
// card). On click it strips, lists what was removed, re-scans the output to
// confirm nothing remains, and offers the clean copy for download.
const SCRUB_HELP = 'Removes identifying information (EXIF, GPS location, XMP, IPTC and comments) by cutting out only those parts of the file - the actual image and its colour profile are copied across untouched, so the picture itself does not change. The cleaned copy is made here on your device and never uploaded. Colour-management data (ICC) is kept so the image still looks the same.';

export function attachImageScrub(file, cardEl) {
  if (!scrubSupportsImage(file)) return;

  const wrap = el('div', { class: 'anr-scrub', style: 'margin-top:14px;' });
  const titleRow = el('div', { style: 'display:flex; align-items:center; gap:6px; margin-bottom:8px;' });
  titleRow.appendChild(el('span', { class: 'anr-readout-section', style: 'margin:0;' }, 'Remove metadata'));
  const infoBtn = el('button', { type: 'button', class: 'anr-info-btn', title: 'Info' }, '[?]');
  const help = el('div', { class: 'anr-info-panel is-hidden', html: SCRUB_HELP });
  wireInfoToggle(infoBtn, help);
  titleRow.appendChild(infoBtn);
  wrap.appendChild(titleRow);
  wrap.appendChild(help);

  const btn = el('button', { type: 'button', class: 'anr-btn' }, 'Strip metadata & download clean copy');
  const out = el('div', { style: 'margin-top:10px;' });
  wrap.appendChild(btn);
  wrap.appendChild(out);

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    out.textContent = '';
    let res;
    try {
      res = await stripImage(file);
    } catch (e) {
      out.appendChild(el('div', { class: 'anr-info' }, 'Could not read the file to strip it.'));
      btn.disabled = false;
      return;
    }
    if (!res) {
      out.appendChild(el('div', { class: 'anr-info' }, 'This image could not be safely parsed for stripping, so nothing was changed.'));
      btn.disabled = false;
      return;
    }
    if (!res.removed.length) {
      out.appendChild(el('div', { class: 'anr-info' }, 'No removable metadata found - this file is already clean.'));
      btn.disabled = false;
      return;
    }

    // Removed-items summary.
    const tbl = el('table', { class: 'anr-readout' });
    let totalRemoved = 0;
    for (const r of res.removed) {
      totalRemoved += r.bytes;
      tbl.appendChild(el('tr', {}, [el('th', {}, r.label), el('td', {}, fmtBytes(r.bytes))]));
    }
    out.appendChild(el('div', { class: 'anr-readout-section', style: 'margin-top:0;' }, 'Removed'));
    out.appendChild(tbl);

    // Re-scan the output to confirm no metadata blocks remain.
    const verify = STRIPPERS[res.format](res.out);
    const clean = verify && verify.removed.length === 0;
    out.appendChild(el('p', { class: 'anr-hint', style: 'margin-top:8px;' },
      clean
        ? '✓ Verified - re-scanned the clean copy and found no remaining metadata blocks. ' + fmtBytes(totalRemoved) + ' removed; pixels unchanged.'
        : 'Stripped ' + fmtBytes(totalRemoved) + ', but a re-scan still sees metadata - the file may use an unusual structure.'));

    const cleanName = (file.name || 'image').replace(/(\.[^.]+)?$/, (m) => '-clean' + (m || ''));
    const blob = new Blob([res.out], { type: file.type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const dl = el('a', { class: 'anr-btn anr-btn--cta', href: url, download: cleanName, style: 'margin-top:10px;' }, 'Download clean copy (' + fmtBytes(res.out.length) + ')');
    dl.addEventListener('click', () => setTimeout(() => URL.revokeObjectURL(url), 2000));
    out.appendChild(dl);
    btn.disabled = false;
  });

  cardEl.appendChild(wrap);
}
