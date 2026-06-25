/* Analyser - SolidWorks reader (.sldprt / .sldasm / .slddrw)

   Two eras, two outcomes:

   - OLDER files (pre-~2015) are OLE2 / Compound File documents, like legacy
     Office. They embed a render preview (a "PreviewPNG" stream, or a CF_DIB
     thumbnail in the SummaryInformation property set) and standard document
     metadata (title, author, save dates). We read those - the f3d-style result.

   - MODERN files (~2015 onward) are encrypted end to end: no OLE2 header, no
     plaintext streams, ~8.0 bits/byte entropy throughout. SolidWorks' own shell
     extension decrypts to draw the Explorer thumbnail; a browser has no key and
     no documented format, so nothing can be extracted. We identify the file and
     say so plainly, pointing at STEP/STL export for the 3D viewer.

   The actual geometry is proprietary ShapeManager either way and is never
   reconstructed here - export to STEP/STL/3MF for the built-in 3D viewer. */

import { el, row, fmtBytes, integrityCard } from '../core/util.js';
import { openCfbf } from '../lib/cfbf.js';

const KIND_LABEL = {
  sldprt: 'SolidWorks part',
  sldasm: 'SolidWorks assembly',
  slddrw: 'SolidWorks drawing',
};
function swLabel(ext) { return KIND_LABEL[(ext || '').toLowerCase()] || 'SolidWorks document'; }

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
function isPng(b) { return b && b.length > 8 && PNG_MAGIC.every((v, i) => b[i] === v); }

function decodeLpwstr(bytes) { try { return new TextDecoder('utf-16le').decode(bytes).replace(/\0+$/, '').trim(); } catch (_) { return ''; } }
function decodeLpstr(bytes) { try { return new TextDecoder('latin1').decode(bytes).replace(/\0+$/, '').trim(); } catch (_) { return ''; } }

// FILETIME (100ns ticks since 1601-01-01 UTC) -> a readable date, or '' if absurd.
function filetimeToDate(lo, hi) {
  const ticks = hi * 0x100000000 + lo;
  if (!ticks) return '';
  const ms = ticks / 10000 - 11644473600000;
  const d = new Date(ms);
  if (isNaN(d) || d.getUTCFullYear() < 1985 || d.getUTCFullYear() > 2100) return '';
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// A clipboard DIB (BITMAPINFOHEADER + palette + pixels, no 14-byte file header)
// needs that header prepended to be a viewable .bmp. Returns null if implausible.
function dibToBmp(dib) {
  try {
    if (!dib || dib.length < 44) return null;
    const dv = new DataView(dib.buffer, dib.byteOffset, dib.byteLength);
    const dibHeaderSize = dv.getUint32(0, true);
    if (dibHeaderSize < 40 || dibHeaderSize > 124) return null;
    const bpp = dv.getUint16(14, true);
    let clrUsed = dv.getUint32(32, true);
    let paletteSize = 0;
    if (bpp <= 8) paletteSize = (clrUsed || (1 << bpp)) * 4;
    const pixelOffset = 14 + dibHeaderSize + paletteSize;
    const out = new Uint8Array(14 + dib.length);
    out[0] = 0x42; out[1] = 0x4d;                          // 'BM'
    new DataView(out.buffer).setUint32(2, out.length, true);
    new DataView(out.buffer).setUint32(10, pixelOffset, true);
    out.set(dib, 14);
    return out;
  } catch (_) { return null; }
}

// Decode the SummaryInformation property set: text fields, save/create dates, and
// the thumbnail (PIDSI_THUMBNAIL, VT_CF). Mirrors the property-table walk used for
// legacy Office (parsers-docs.js oleSummary), extended for FILETIME + VT_CF.
function parseSummary(bytes) {
  const out = { fields: {}, thumb: null };
  if (!bytes || bytes.length < 48) return out;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (dv.getUint16(0, true) !== 0xfffe) return out;
    const secOff = dv.getUint32(0x2c, true);
    if (secOff + 8 > bytes.length) return out;
    const numProps = dv.getUint32(secOff + 4, true);
    if (numProps > 256) return out;
    const PID = { 2: 'Title', 3: 'Subject', 4: 'Author', 5: 'Keywords', 6: 'Comments', 8: 'Last saved by', 9: 'Revision', 12: 'Created', 13: 'Last saved' };
    for (let i = 0; i < numProps; i++) {
      const e = secOff + 8 + i * 8;
      if (e + 8 > bytes.length) break;
      const pid = dv.getUint32(e, true);
      const off = secOff + dv.getUint32(e + 4, true);
      if (off + 8 > bytes.length) continue;
      const type = dv.getUint32(off, true);
      // Thumbnail: VT_CF (71) - a clipboard blob: Size, Format, Data[Size-4].
      if (pid === 17 && type === 71) {
        const size = dv.getUint32(off + 4, true);
        const fmt = dv.getUint32(off + 8, true);
        const dataLen = Math.min(size - 4, bytes.length - (off + 12));
        if (dataLen > 8 && off + 12 + dataLen <= bytes.length) {
          const data = bytes.subarray(off + 12, off + 12 + dataLen);
          if (isPng(data)) out.thumb = { bytes: data, mime: 'image/png' };
          else if (fmt === 8 || fmt === 17 || dv.getUint32(off + 12, true) >= 40) {
            const bmp = dibToBmp(data);
            if (bmp) out.thumb = { bytes: bmp, mime: 'image/bmp' };
          }
        }
        continue;
      }
      if (PID[pid] && (type === 30 || type === 31)) {            // VT_LPSTR / VT_LPWSTR
        const len = dv.getUint32(off + 4, true);
        if (len <= 0 || len > 4096) continue;
        const val = type === 31
          ? decodeLpwstr(bytes.subarray(off + 8, off + 8 + len * 2))
          : decodeLpstr(bytes.subarray(off + 8, off + 8 + len));
        if (val && !out.fields[PID[pid]]) out.fields[PID[pid]] = val;
      } else if (PID[pid] && type === 64) {                      // VT_FILETIME
        const lo = dv.getUint32(off + 4, true);
        const hi = dv.getUint32(off + 8, true);
        const d = filetimeToDate(lo, hi);
        if (d) out.fields[PID[pid]] = d;
      }
    }
  } catch (_) {}
  return out;
}

// Append the geometry note + integrity card, the parts every SolidWorks readout
// ends with regardless of era.
function appendTail(file, resultsEl, encrypted) {
  const note = el('div', { class: 'anr-card' });
  note.appendChild(el('h3', {}, 'About the geometry'));
  note.appendChild(el('p', { class: 'anr-hint', style: 'margin:0;' },
    (encrypted
      ? 'This is a modern (2015 or newer) SolidWorks file: its contents are encrypted with Dassault Systemes’ proprietary scheme, so neither the model, the metadata nor the preview thumbnail can be read outside SolidWorks. '
      : 'SolidWorks stores its solid model as proprietary Parasolid / ShapeManager geometry, which cannot be rebuilt in the browser. ')
    + 'To open the actual model, export it from SolidWorks as STEP, STL or 3MF and drop that here for the full 3D viewer.'));
  resultsEl.appendChild(note);
  resultsEl.appendChild(integrityCard(file));
}

export async function renderSolidworks(file, resultsEl) {
  resultsEl.hidden = false;   // the results container starts hidden (clearResultsUI)
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const label = swLabel(ext);

  // OLE2 / CFBF? Older SolidWorks files are; the encrypted modern format is not,
  // so openCfbf returns null (no D0CF11E0 magic) and we take the honest path.
  let cf = null;
  try { cf = await openCfbf(file); } catch (_) { cf = null; }

  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, label));
  const t = el('table', { class: 'anr-readout' });
  t.appendChild(row('Software', 'SolidWorks (Dassault Systemes)'));
  t.appendChild(row('Document', label.replace('SolidWorks ', '').replace(/^\w/, (c) => c.toUpperCase())));

  if (!cf) {
    // Modern, encrypted format.
    t.appendChild(row('Container', 'Encrypted (SolidWorks 2015+)'));
    t.appendChild(row('File size', fmtBytes(file.size)));
    card.appendChild(t);
    resultsEl.appendChild(card);
    appendTail(file, resultsEl, true);
    return;
  }

  // Older OLE2 file: read metadata + preview.
  t.appendChild(row('Container', 'OLE2 / CFBF v' + cf.version));
  const sumStream = cf.readStream((e) => /SummaryInformation$/i.test(e.name) && !/Document/i.test(e.name));
  const sum = sumStream ? parseSummary(sumStream) : { fields: {}, thumb: null };
  for (const [k, v] of Object.entries(sum.fields)) t.appendChild(row(k, v));
  t.appendChild(row('Streams', String(cf.entries.filter((e) => e.type === 2).length)));
  t.appendChild(row('File size', fmtBytes(file.size)));
  card.appendChild(t);
  resultsEl.appendChild(card);

  // Preview: a dedicated PreviewPNG stream wins; otherwise the SummaryInformation
  // thumbnail (PNG or a reconstructed BMP).
  let preview = null;
  const pngStream = cf.readStream((e) => /^PreviewPNG$/i.test(e.name) || /Preview.*PNG$/i.test(e.name));
  if (pngStream && isPng(pngStream)) preview = { bytes: pngStream, mime: 'image/png' };
  else if (sum.thumb) preview = sum.thumb;

  if (preview) {
    const pv = el('div', { class: 'anr-card' });
    pv.appendChild(el('h3', {}, 'Preview'));
    pv.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 10px;' }, 'The thumbnail SolidWorks saved inside the file.'));
    const url = URL.createObjectURL(new Blob([preview.bytes], { type: preview.mime }));
    const img = el('img', {
      src: url, alt: label + ' preview', loading: 'lazy',
      style: 'max-width:100%; height:auto; border:1px solid var(--rule); background:var(--surface);',
    });
    img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
    // A reconstructed BMP that didn't decode shouldn't leave a broken-image icon.
    img.addEventListener('error', () => { URL.revokeObjectURL(url); pv.remove(); }, { once: true });
    pv.appendChild(img);
    resultsEl.appendChild(pv);
  }

  appendTail(file, resultsEl, false);
}
