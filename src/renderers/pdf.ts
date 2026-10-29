/* Analyser - PDF module
   Lazy-loads pdf.js from CDN, extracts metadata, text, and page thumbnails. */

import { el, row, rowHelp, fmtBytes, errorCard, integrityCard, openOverlayBack, timeAnomalies, timeAnomalyCard, downloadBlob, crc32Hex } from '../core/util.js';
import { renderPhoto, revealPhotoSection, pickOcrLanguage, ocrLangPath } from './photo.js';
import { pagePreviewSkeleton } from './paged.js';
import { SCAN_SMALL, PDF_RANGE_MIN, PDF_RANGE_HEAD, OCR_WORKERS, CANVAS_EDGE_MAX, PDF_LONG_MAX_PX, PDF_LONG_BAND_PX } from '../core/limits.js';

// Resolved against this module's URL so the dynamic import() gets a valid
// absolute specifier (a bare "assets/..." path is not a resolvable module id).
const PDFJS_URL      = new URL('../../vendor/pdfjs/pdf.min.mjs', import.meta.url).href;
const WORKER_URL     = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
const TESSERACT_URL  = 'assets/vendor/tesseract/tesseract.min.js';

let pdfjsLib: any = null;

async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import(PDFJS_URL);
  pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
  return pdfjsLib;
}

// One pdf.js worker shared by every document: getDocument() would otherwise
// spawn a fresh worker (and keep a copy of the file in it) per PDF rendered.
// A document opened on a caller-supplied worker leaves it running on destroy().
let sharedWorker: any = null;
function pdfWorker(lib: any) {
  if (!sharedWorker || sharedWorker.destroyed) {
    try { sharedWorker = new lib.PDFWorker(); } catch (_) { sharedWorker = null; }
  }
  return sharedWorker;
}

// Documents still open, with the results element each was drawn into. A new
// render destroys the ones whose output is gone (or that drew into the same
// element), so pdf.js frees their parsed data; /compare's two live columns are
// both still in the page, so neither tears the other down.
const openDocs: { el: HTMLElement; marker: HTMLElement|null; task: any }[] = [];
function releaseStaleDocs(resultsEl: HTMLElement) {
  for (let i = openDocs.length - 1; i >= 0; i--) {
    const d = openDocs[i];
    const gone = d.el === resultsEl || !d.el.isConnected || (d.marker && !d.marker.isConnected);
    if (!gone) continue;
    openDocs.splice(i, 1);
    try { d.task.destroy(); } catch (_) { /* already gone */ }
  }
}

// The page viewer overlay is a single element reused by every document, so its
// in-flight work lives here: each showPage() takes a new sequence number and
// cancels the canvas render and text layer the previous call started, so a fast
// Next-Next never draws two pages into one canvas or interleaves text layers.
let viewerSeq = 0;
let viewerRenderTask: any = null;
let viewerTextTask: any = null;

// Resolve a PDF image XObject by name from a page's object store. pdf.js stores
// these asynchronously; race against a timeout so a never-resolving name can't
// hang the whole extraction.
function getPdfImage(page: any, name: string) {
  return new Promise<any>((resolve) => {
    let done = false;
    const finish = (v: any) => { if (!done) { done = true; resolve(v); } };
    try {
      if (page.objs.has && page.objs.has(name)) { finish(page.objs.get(name)); return; }
      page.objs.get(name, finish);
    } catch (_) { finish(null); }
    setTimeout(() => finish(null), 4000);
  });
}

// Convert a pdf.js image object (bitmap, or raw data with an ImageKind) to a
// canvas. Handles RGBA/RGB/1-bpp-grayscale; returns null for anything exotic.
function pdfImageToCanvas(img: any) {
  if (!img) return null;
  const cv = document.createElement('canvas');
  const bitmap = (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) ? img
    : (img.bitmap instanceof ImageBitmap ? img.bitmap : null);
  if (bitmap) {
    cv.width = bitmap.width; cv.height = bitmap.height;
    cv.getContext('2d')!.drawImage(bitmap, 0, 0);
    return cv;
  }
  const w = img.width, h = img.height, data = img.data;
  if (!w || !h || !data) return null;
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d')!;
  const out = ctx.createImageData(w, h);
  const px = w * h;
  if (img.kind === 3 || data.length >= px * 4) {
    out.data.set(data.subarray(0, px * 4));
  } else if (img.kind === 2 || data.length >= px * 3) {
    for (let i = 0, j = 0; i < px; i++) {
      out.data[j++] = data[i * 3]; out.data[j++] = data[i * 3 + 1];
      out.data[j++] = data[i * 3 + 2]; out.data[j++] = 255;
    }
  } else if (img.kind === 1) {
    const rowBytes = Math.ceil(w / 8);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
      const v = bit ? 255 : 0, o = (y * w + x) * 4;
      out.data[o] = out.data[o + 1] = out.data[o + 2] = v; out.data[o + 3] = 255;
    }
  } else return null;
  ctx.putImageData(out, 0, 0);
  return cv;
}

function fmtDate(d: any) {
  if (!d) return '-';
  // PDF dates are often in the format D:YYYYMMDDHHmmSS
  if (typeof d === 'string' && d.startsWith('D:')) {
    const s = d.slice(2);
    const year = s.slice(0, 4);
    const month = s.slice(4, 6) || '01';
    const day = s.slice(6, 8) || '01';
    const hour = s.slice(8, 10) || '00';
    const min = s.slice(10, 12) || '00';
    const sec = s.slice(12, 14) || '00';
    return `${year}-${month}-${day} ${hour}:${min}:${sec}`;
  }
  if (d instanceof Date) return d.toISOString().replace('T', ' ').replace(/\..*$/, '');
  return String(d);
}

// Parse a PDF date string (D:YYYYMMDDHHmmSS±HH'mm') into a Date, or null. Used by
// the timestamp-anomaly check; a missing timezone is treated as UTC.
function pdfDate(d: string|Date) {
  if (typeof d !== 'string') return d instanceof Date ? d : null;
  const m = /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([+\-Z])?(\d{2})?'?(\d{2})?/.exec(d);
  if (!m) return null;
  const [, Y, Mo = '01', D = '01', H = '00', Mi = '00', S = '00', tz, tzh = '00', tzm = '00'] = m;
  let iso = `${Y}-${Mo}-${D}T${H}:${Mi}:${S}`;
  iso += (!tz || tz === 'Z') ? 'Z' : `${tz}${tzh}:${tzm}`;
  const dt = new Date(iso);
  return isNaN(dt.getTime()) ? null : dt;
}

// Scan the raw PDF bytes for forensic signals pdf.js does not surface: how many
// times the file was saved (each save appends an %%EOF marker), whether it is
// linearised for "fast web view", and whether anything non-whitespace trails the
// final %%EOF (appended / polyglot data, a classic tamper/smuggling tell).
// Read in SCAN_SMALL slices with the "%%EOF" match carried across them, so a
// PDF of any size is scanned in one slice of memory (it used to be decoded into
// one string, which past the browser's longest string threw and the rows
// silently vanished).
async function scanRawPdf(file: Blob) {
  const head = new Uint8Array(await file.slice(0, 2048).arrayBuffer());
  const linearized = /\/Linearized\b/.test(new TextDecoder('latin1').decode(head));
  // `m` is how much of "%%EOF" the bytes so far end with. `printable` counts
  // bytes > 32 since the last complete marker: any non-blank content after the
  // final %%EOF is appended/polyglot data.
  const PAT = [0x25, 0x25, 0x45, 0x4F, 0x46];
  let eof = 0, printable = 0, m = 0;
  for (let off = 0; off < file.size; off += SCAN_SMALL) {
    const b = new Uint8Array(await file.slice(off, off + SCAN_SMALL).arrayBuffer());
    for (let i = 0; i < b.length; i++) {
      const c = b[i];
      if (c > 32) printable++;
      if (c === PAT[m]) {
        if (++m === 5) { eof++; printable = 0; m = 0; }
      } else {
        m = c === 0x25 ? (m === 2 ? 2 : 1) : 0;
      }
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  return { eof, appended: eof ? printable : 0, linearized };
}

// Past PDF_RANGE_MIN pdf.js is not handed the whole file: it asks for byte
// ranges and this answers each with a File.slice, so a multi-GB scan opens
// without being held in memory (twice - the old path also re-read it for the
// raw scan). The base class is pdf.js's own; requestDataRange is the one hook.
function fileRangeTransport(lib: any, file: File, head: Uint8Array) {
  const Base = lib.PDFDataRangeTransport as new (length: number, initialData: Uint8Array) => object;
  class FileRange extends Base {
    requestDataRange(begin: number, end: number) {
      file.slice(begin, end).arrayBuffer().then((b) => { (this as any).onDataRange(begin, new Uint8Array(b)); }, () => {});
    }
  }
  return new FileRange(file.size, head);
}

// ---------- one long page as a PNG ----------
// One PNG chunk: length, type, data, then the CRC-32 of type + data.
function pngChunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, parseInt(crc32Hex(out.subarray(4, 8 + data.length)), 16));
  return out;
}

// Every page of `pdf` stacked top to bottom in ONE PNG, `s` pixels per PDF
// point. A strip like that is far past what any browser will allocate as a
// canvas (a 40-page letter document at 300 dpi is 2550 x 132000), so it is
// never drawn whole: each page is rendered a band of rows at a time onto one
// reused canvas (pdf.js's viewport offset moves the page up under it), the
// band's pixels are written out as RGB scanlines, and CompressionStream deflates
// them straight into IDAT chunks. Memory stays at one band plus the compressed
// output, which is folded into Blobs as it grows so the browser can page it out.
// Pages narrower than the widest are centred on white. `sizes` are the pages'
// unscaled viewports (rotation applied); W and H must be the rounded totals the
// same sizes produce, since the header is written before the first row.
async function writeLongPng(pdf: any, sizes: { w: number; h: number }[], s: number, W: number, H: number, dpi: number,
  onProgress: (frac: number, page: number) => void, isCancelled: () => boolean, onTask: (task: any) => void): Promise<Blob> {
  const bandRows = Math.max(16, Math.min(CANVAS_EDGE_MAX, Math.floor(PDF_LONG_BAND_PX / W)));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = bandRows;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;

  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, W); hv.setUint32(4, H);
  ihdr[8] = 8; ihdr[9] = 2;   // 8-bit RGB, no alpha; deflate, no filter method, no interlace
  // pHYs carries the resolution, so the image opens at its real printed size.
  const ppm = Math.round(dpi / 0.0254);
  const phys = new Uint8Array(9);
  const pv = new DataView(phys.buffer);
  pv.setUint32(0, ppm); pv.setUint32(4, ppm); phys[8] = 1;

  const blobs: Blob[] = [];
  let parts: Uint8Array[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('pHYs', phys)];
  let held = 0;
  // 'deflate' is the zlib-wrapped stream, which is exactly what IDAT holds.
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  // Read concurrently with the writes below, or the stream's backpressure stalls them.
  const reading = (async () => {
    const r = cs.readable.getReader();
    let pend: Uint8Array[] = [], pendLen = 0;
    const flush = () => {
      if (!pendLen) return;
      const d = new Uint8Array(pendLen);
      let o = 0;
      for (const p of pend) { d.set(p, o); o += p.length; }
      pend = []; pendLen = 0;
      parts.push(pngChunk('IDAT', d));
      held += d.length;
      if (held >= 64 * 1024 * 1024) { blobs.push(new Blob(parts as BlobPart[])); parts = []; held = 0; }
    };
    for (;;) {
      const { done, value } = await r.read();
      if (done) break;
      pend.push(value); pendLen += value.length;
      if (pendLen >= 1024 * 1024) flush();
    }
    flush();
  })();

  try {
    let rowsDone = 0;
    const line = 1 + W * 3;
    for (let i = 0; i < sizes.length; i++) {
      const pw = Math.round(sizes[i].w * s), ph = Math.round(sizes[i].h * s);
      const x0 = Math.floor((W - pw) / 2);
      let pg: any = null;
      try { pg = await pdf.getPage(i + 1); } catch (_) { /* unreadable page - left white */ }
      for (let y = 0; y < ph; y += bandRows) {
        if (isCancelled()) throw new Error('cancelled');
        const rows = Math.min(bandRows, ph - y);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, bandRows);
        if (pg) {
          const task = pg.render({ canvasContext: ctx, viewport: pg.getViewport({ scale: s, offsetX: x0, offsetY: -y }) });
          onTask(task);
          try { await task.promise; } finally { onTask(null); }
          if (isCancelled()) throw new Error('cancelled');
        }
        const px = ctx.getImageData(0, 0, W, rows).data;
        const out = new Uint8Array(rows * line);
        for (let r = 0, o = 0, p = 0; r < rows; r++) {
          out[o++] = 0;   // filter type None
          for (let x = 0; x < W; x++, p += 4) { out[o++] = px[p]; out[o++] = px[p + 1]; out[o++] = px[p + 2]; }
        }
        await writer.write(out);
        rowsDone += rows;
        onProgress(rowsDone / H, i + 1);
      }
      if (pg) { try { pg.cleanup(); } catch (_) { /* ignore */ } }
    }
    await writer.close();
    await reading;
  } catch (e) {
    try { await writer.abort(e); } catch (_) { /* ignore */ }
    try { await reading; } catch (_) { /* ignore */ }
    throw e;
  } finally {
    cv.width = 0; cv.height = 0;
  }
  parts.push(pngChunk('IEND', new Uint8Array(0)));
  return new Blob([...blobs, ...parts] as BlobPart[], { type: 'image/png' });
}

// ---------- main render ----------
export async function renderPdf(file: File, resultsEl: HTMLElement, opts: any = {}) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Loading PDF library…`));

  let lib: any;
  try {
    lib = await loadPdfJs();
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Failed to load PDF.js: ' + (e && e.message)));
    return;
  }

  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading "${file.name}"…`));

  releaseStaleDocs(resultsEl);
  let pdf: any;
  const docEntry: { el: HTMLElement; marker: HTMLElement|null; task: any } = { el: resultsEl, marker: null, task: null };
  try {
    // isEvalSupported: false - pdf.js would otherwise compile font glyph paths
    // into a Function; with it on, a crafted FontMatrix runs script in this page
    // (CVE-2024-4367). Every getDocument() call must pass it.
    if (file.size > PDF_RANGE_MIN && lib.PDFDataRangeTransport) {
      const head = new Uint8Array(await file.slice(0, PDF_RANGE_HEAD).arrayBuffer());
      docEntry.task = lib.getDocument({ range: fileRangeTransport(lib, file, head), length: file.size,
        disableAutoFetch: true, disableStream: true, isEvalSupported: false, worker: pdfWorker(lib) || undefined });
    } else {
      const buf = await file.arrayBuffer();
      docEntry.task = lib.getDocument({ data: buf, isEvalSupported: false, worker: pdfWorker(lib) || undefined });
    }
    openDocs.push(docEntry);
    pdf = await docEntry.task.promise;
  } catch (e) {
    const idx = openDocs.indexOf(docEntry);
    // Destroyed by a newer render into the same place - that one owns the output.
    if (docEntry.task && idx === -1) return;
    if (idx !== -1) { openDocs.splice(idx, 1); try { docEntry.task.destroy(); } catch (_) { /* ignore */ } }
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not parse PDF: ' + (e && e.message)));
    return;
  }

  resultsEl.innerHTML = '';

  // Default first 4 pages; the compare view passes previewPages:1 so each file
  // shows just one page up front (the rest are behind "Show all").
  const initialPages = Math.min(pdf.numPages, Math.max(1, opts.previewPages || 4));

  // Ghost sheets stand in until the thumbnails below are rendered. Everything
  // between here and there - metadata, structure, text extraction, and a pdf.js
  // render pass per page - happens with the info cards already on screen, so
  // without this the page previews arrive late and push the lot downwards.
  const thumbSkeleton = pagePreviewSkeleton({ count: initialPages, note: 'Rendering pages…' });
  resultsEl.appendChild(thumbSkeleton);

  // A 3D PDF's model (PRC / U3D), under the page previews. pdf3d.js reads the
  // raw file alongside everything below and leaves the slot empty when there is
  // none; the compare view gets its readout but no viewer.
  const slot3d = el('div');
  resultsEl.appendChild(slot3d);
  import('./pdf3d.js').then((m) => m.renderPdf3d(file, slot3d, { viewer: !opts.previewPages })).catch(() => {});

  // --- Info card ---
  const infoCard = el('div', { class: 'anr-card' });
  infoCard.appendChild(el('h3', {}, 'PDF document'));

  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Application', 'PDF Document'));
  tbl.appendChild(row('Name', file.name));
  tbl.appendChild(row('Size', `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`));
  tbl.appendChild(row('Pages', String(pdf.numPages)));

  // Metadata
  let meta: any = {};
  let metaXmp = null;
  try {
    const info = await pdf.getMetadata();
    meta = (info && info.info) || {};
    metaXmp = (info && info.metadata) || null;
  } catch (_) {}
  tbl.appendChild(row('Title', meta.Title));
  tbl.appendChild(row('Author', meta.Author));
  tbl.appendChild(rowHelp('Creator', meta.Creator, 'The program used to write the original content - for example a word processor or a design tool - before it became a PDF.'));
  tbl.appendChild(rowHelp('Producer', meta.Producer, 'The software that actually turned the content into a PDF - often a "Print to PDF" feature or a PDF-writing tool. This can be different from the Creator, which is the program that wrote the original content.'));
  tbl.appendChild(row('Creation date', fmtDate(meta.CreationDate)));
  tbl.appendChild(row('Modification date', fmtDate(meta.ModDate)));
  tbl.appendChild(rowHelp('PDF version', meta.PDFFormatVersion || '-', 'Which version of the PDF standard this file was built to follow.'));

  // Page dimensions from page 1
  try {
    const page1 = await pdf.getPage(1);
    const vp = page1.getViewport({ scale: 1 });
    const wPt = vp.width;
    const hPt = vp.height;
    const wIn = (wPt / 72).toFixed(2);
    const hIn = (hPt / 72).toFixed(2);
    const wMm = (wPt / 72 * 25.4).toFixed(1);
    const hMm = (hPt / 72 * 25.4).toFixed(1);
    tbl.appendChild(rowHelp('Page 1 size', `${wPt.toFixed(0)} x ${hPt.toFixed(0)} pt  (${wIn} x ${hIn} in / ${wMm} x ${hMm} mm)`, 'The real-world size of the first page, given in points, with inches and millimetres alongside. A point is a printer’s unit equal to 1/72 of an inch.'));
  } catch (_) {}
  infoCard.appendChild(tbl);
  resultsEl.appendChild(infoCard);
  docEntry.marker = infoCard;
  resultsEl.appendChild(integrityCard(file));

  // Timestamp anomaly check: PDF creation/modification dates against each other and
  // the file's own last-modified time (future dates, mod-before-create, etc.).
  try {
    const tac = timeAnomalyCard(timeAnomalies({
      created: pdfDate(meta.CreationDate),
      modified: pdfDate(meta.ModDate),
      filesystem: file.lastModified ? new Date(file.lastModified) : null,
    }));
    if (tac) resultsEl.appendChild(tac);
  } catch (_) { /* ignore */ }

  // --- Document structure (outline, forms, links, attachments, security) ---
  // Everything here is additive and best-effort: each pdf.js call may reject or
  // be absent, so every step is guarded and only rows with real data are shown.
  // A failure here must never break text extraction / thumbnails / OCR below.
  try {
    const structCard = el('div', { class: 'anr-card' });
    structCard.appendChild(el('h3', {}, 'Document structure & security'));
    const stbl = el('table', { class: 'anr-readout' });
    let structRows = 0;       // count of plain readout rows added
    const extras = [];        // collapsible <details> blocks to append after the table
    const addRow = (node: HTMLTableRowElement) => { stbl.appendChild(node); structRows++; };

    // -- Raw-byte forensics: revisions, linearisation, appended data --
    // Read straight off the File, a slice at a time (getDocument() has detached
    // any buffer it was given).
    try {
      const fx = await scanRawPdf(file);
      if (fx.eof > 1) {
        const updates = fx.eof - 1;
        addRow(rowHelp('Revisions', String(fx.eof) + ' (incrementally updated ' + updates + ' time' + (updates === 1 ? '' : 's') + ')',
          'Every time a PDF is saved it adds another end-of-file marker (%%EOF). More than one means the file was edited and saved again without rewriting it from scratch, so older versions of the content are still tucked inside - a strong clue about where the file came from and whether it was altered.'));
      }
      if (fx.linearized) {
        addRow(rowHelp('Linearised', 'yes',
          'The PDF is "linearised" (also called "fast web view"): its parts are rearranged so a viewer can show the first page before the whole file has finished downloading. Usually done by tools that optimise PDFs for the web.'));
      }
      if (fx.appended > 0) {
        addRow(rowHelp('Trailing data', '⚠ ' + fx.appended + ' byte' + (fx.appended === 1 ? '' : 's') + ' after final %%EOF',
          'There is extra content after the file’s final end-of-file marker. This is often a harmless leftover from re-saving, but it is also a common way to hide data inside a PDF (for example files that are secretly two formats at once, or payloads tacked onto the end) - so it is worth a closer look.'));
      }
    } catch (_) {}

    // -- Outline / table of contents --
    try {
      const outline = await pdf.getOutline().catch(() => null);
      if (Array.isArray(outline) && outline.length) {
        addRow(rowHelp('Outline entries', String(outline.length),
          'The main bookmarks in the document’s outline - its built-in table of contents. Any bookmarks nested underneath them appear indented in the list you can open below.'));
        const det = el('details');
        det.appendChild(el('summary', {}, 'Outline / table of contents'));
        const list = el('ul', { style: 'margin:8px 0 0;padding-left:18px;font-size:13px;' });
        for (const item of outline) {
          const title = (item && item.title) ? String(item.title).trim() : '(untitled)';
          const li = el('li', { style: 'margin:2px 0;' }, title);
          // Recurse one level into children.
          if (item && Array.isArray(item.items) && item.items.length) {
            const sub = el('ul', { style: 'margin:2px 0;padding-left:16px;opacity:0.8;' });
            for (const child of item.items) {
              const ct = (child && child.title) ? String(child.title).trim() : '(untitled)';
              sub.appendChild(el('li', { style: 'margin:2px 0;' }, ct));
            }
            li.appendChild(sub);
          }
          list.appendChild(li);
        }
        det.appendChild(list);
        extras.push(det);
      }
    } catch (_) {}

    // -- Attachments / embedded files --
    try {
      const att = await pdf.getAttachments().catch(() => null);
      const names = att ? Object.keys(att) : [];
      if (names.length) {
        addRow(rowHelp('Embedded files', String(names.length),
          'Other files tucked away inside this PDF, which can carry attachments just like a folder can. They are listed below.'));
        const det = el('details');
        det.appendChild(el('summary', {}, 'Embedded files'));
        const list = el('ul', { style: 'margin:8px 0 0;padding-left:18px;font-size:13px;' });
        for (const n of names) {
          const entry = att[n];
          const fname = (entry && entry.filename) ? String(entry.filename) : String(n);
          const len = entry && entry.content && entry.content.length;
          const label = len ? `${fname}  (${fmtBytes(len)})` : fname;
          list.appendChild(el('li', { style: 'margin:2px 0;' }, label));
        }
        det.appendChild(list);
        extras.push(det);
      }
    } catch (_) {}

    // -- Embedded JavaScript: trace which trigger runs which script, and scan each
    //    script for higher-risk patterns (network / file / launch / obfuscation /
    //    crypto). The getJSActions() keys ARE the trigger events. --
    try {
      const PDF_JS_PATTERNS = [
        { label: 'network', re: /\b(?:submitForm|getURL|launchURL|SOAP\.|Net\.HTTP|XMLHttpRequest|fetch\s*\()/i },
        { label: 'file access', re: /\b(?:exportDataObject|importDataObject|createDataObject|saveAs|app\.openDoc)/i },
        { label: 'launch/exec', re: /\b(?:launchURL|app\.launchURL|Launch)\b|\.exec\s*\(/i },
        { label: 'obfuscation', re: /\b(?:eval|unescape|String\.fromCharCode|util\.byteToChar)\s*\(?/i },
        { label: 'crypto', re: /\b(?:encrypt|decrypt|Crypt)\b/i },
      ];
      // Trigger names that fire automatically (no user choice) - the dangerous ones.
      const AUTO_TRIGGERS: Record<string, string> = { OpenAction: 'Document open', WillPrint: 'Before print', DidPrint: 'After print', WillSave: 'Before save', DidSave: 'After save', WillClose: 'Before close' };
      const triggerLabel = (k: string) => AUTO_TRIGGERS[k] ? AUTO_TRIGGERS[k] + ' (auto-run)' : 'Named script: ' + k;
      const actions: { trigger: string; source: string; flags: string[] }[] = [];          // { trigger, source, flags }
      const seen = new Set<string>();
      const pushAction = (k: string, s: any) => {
        if (!s) return;
        const src = String(s);
        const key = k + '\x00' + src;
        if (seen.has(key)) return;
        seen.add(key);
        actions.push({ trigger: k, source: src, flags: PDF_JS_PATTERNS.filter((p) => p.re.test(src)).map((p) => p.label) });
      };
      try {
        const jsActions = await pdf.getJSActions().catch(() => null);
        if (jsActions) for (const k of Object.keys(jsActions)) {
          const v = jsActions[k];
          for (const s of (Array.isArray(v) ? v : [v])) pushAction(k, s);
        }
      } catch (_) {}
      try {
        if (typeof pdf.getOpenAction === 'function') {
          const oa = await pdf.getOpenAction().catch(() => null);
          if (oa && oa.action === 'JavaScript') pushAction('OpenAction', oa.jsCode || '(script present, source not exposed)');
        }
      } catch (_) {}
      if (actions.length) {
        addRow(rowHelp('Embedded JavaScript', '⚠ yes (' + actions.length + ' action' + (actions.length === 1 ? '' : 's') + ')',
          'This PDF contains JavaScript - small programs a PDF viewer might run. They can be harmless (for example making a form work), but are also a common way to deliver malware, so treat unexpected ones with caution.'));
        const autoRun = actions.filter((a) => AUTO_TRIGGERS[a.trigger]);
        if (autoRun.length) addRow(rowHelp('Auto-run scripts', '⚠ ' + [...new Set(autoRun.map((a) => AUTO_TRIGGERS[a.trigger]))].join(', '),
          'These scripts start on their own when the named thing happens (such as simply opening the file), without you doing anything - the riskiest kind.'));
        const allFlags = [...new Set(actions.flatMap((a) => a.flags))];
        if (allFlags.length) addRow(rowHelp('Suspicious patterns', '⚠ ' + allFlags.join(', '),
          'An automated scan of the scripts spotted commands linked to: ' + allFlags.join(', ') + ' - higher-risk actions such as contacting the internet, reading or writing files, launching other programs, or deliberately scrambling the code to hide what it does.'));
        // Per-trigger source so each action can be reviewed in place.
        const det = el('details');
        det.appendChild(el('summary', {}, 'JavaScript actions (' + actions.length + ')'));
        for (const a of actions) {
          det.appendChild(el('div', { class: 'anr-readout-section', style: 'margin-top:8px;' },
            triggerLabel(a.trigger) + (a.flags.length ? '  -  ⚠ ' + a.flags.join(', ') : '')));
          const pre = el('pre', { class: 'anr-ocr-text', style: 'max-height:240px;overflow:auto;white-space:pre-wrap;font-size:12px;margin:6px 0 0;' });
          pre.textContent = a.source;
          det.appendChild(pre);
        }
        extras.push(det);
      }
    } catch (_) {}

    // -- Permissions / encryption --
    try {
      const encrypted = !!(meta && (meta.IsEncrypted || meta.Encrypted));
      let perms = null;
      try { perms = await pdf.getPermissions().catch(() => null); } catch (_) {}
      // getPermissions() returns a non-null array only when usage is restricted.
      if (encrypted || Array.isArray(perms)) {
        addRow(rowHelp('Encrypted', encrypted ? 'yes' : 'no',
          'Whether the PDF is encrypted (its contents scrambled for protection). An encrypted PDF may still open without asking for a password, yet block certain actions such as printing, copying text, or editing.'));
      }
      if (Array.isArray(perms) && lib.PermissionFlag) {
        const PF = lib.PermissionFlag;
        const has = (flag: any) => flag != null && perms.indexOf(flag) !== -1;
        const allowed: string[] = [];
        if (has(PF.PRINT) || has(PF.PRINT_HIGH_QUALITY)) allowed.push('print');
        if (has(PF.COPY)) allowed.push('copy');
        if (has(PF.MODIFY_CONTENTS) || has(PF.MODIFY_ANNOTATIONS)) allowed.push('modify');
        const allActions = ['print', 'copy', 'modify'];
        const denied = allActions.filter((a) => allowed.indexOf(a) === -1);
        addRow(rowHelp('Allowed actions', allowed.length ? allowed.join(', ') : 'none',
          'The things the document’s permissions let you do. Anything left out - such as printing, copying text, or editing - is blocked, and that block is enforced by the PDF’s encryption.'));
        if (denied.length) addRow(row('Restricted actions', denied.join(', ')));
      }
    } catch (_) {}

    // -- Annotations / form fields / links (first ~20 pages, capped) --
    try {
      const cap = Math.min(pdf.numPages, 20);
      let widgets = 0, links = 0, others = 0;
      for (let i = 1; i <= cap; i++) {
        try {
          const page = await pdf.getPage(i);
          const anns = await page.getAnnotations().catch(() => null);
          if (!Array.isArray(anns)) continue;
          for (const a of anns) {
            const t = a && a.subtype;
            if (t === 'Widget') widgets++;
            else if (t === 'Link') links++;
            else others++;
          }
        } catch (_) {}
      }
      const scope = pdf.numPages > cap ? ` (first ${cap} pages)` : '';
      if (widgets) addRow(rowHelp('Form fields', String(widgets) + scope,
        'The number of fill-in fields found across the pages checked - text boxes, tick boxes and buttons. Their presence means this is a form you can fill in on screen (an AcroForm).'));
      if (links) addRow(row('Links', String(links) + scope));
      if (others) addRow(rowHelp('Annotations', String(others) + scope, 'Annotations are marks added on top of the page - highlights, sticky notes, stamps and freehand drawings - rather than part of the original document. This counts them across the pages checked.'));
    } catch (_) {}

    // -- XMP metadata (Keywords / Subject / PDF/A) --
    try {
      const getXmp = (key: string) => {
        if (!metaXmp || typeof metaXmp.get !== 'function') return null;
        try { const v = metaXmp.get(key); return v ? String(v).trim() : null; } catch (_) { return null; }
      };
      const subject = (meta && meta.Subject) || getXmp('dc:description');
      const keywords = (meta && meta.Keywords) || getXmp('pdf:Keywords');
      if (keywords) addRow(row('Keywords', keywords));
      if (subject) addRow(row('Subject', subject));
      const part = getXmp('pdfaid:part');
      if (part) {
        const conf = getXmp('pdfaid:conformance');
        addRow(rowHelp('PDF/A', 'PDF/A-' + part + (conf ? conf.toUpperCase() : ''),
          'The file says it meets PDF/A, an international standard for long-term archiving. It requires everything the document needs (fonts, images and so on) to be stored inside, so it still displays correctly years from now.'));
      }
    } catch (_) {}

    // -- Fonts (distinct fonts used across the first pages) --
    // pdf.js loads each font into page.commonObjs keyed by the id seen in the
    // setFont operator; resolve those (with a timeout, like image XObjects).
    try {
      const cap = Math.min(pdf.numPages, 15);
      const fonts = new Map();   // id -> { name, embedded, type }
      const resolveFont = (page: any, id: any) => new Promise<any>((resolve) => {
        let done = false;
        const finish = (v: any) => { if (!done) { done = true; resolve(v); } };
        try {
          if (page.commonObjs.has && page.commonObjs.has(id)) { finish(page.commonObjs.get(id)); return; }
          page.commonObjs.get(id, finish);
        } catch (_) { finish(null); }
        setTimeout(() => finish(null), 3000);
      });
      for (let i = 1; i <= cap; i++) {
        try {
          const page = await pdf.getPage(i);
          const ops = await page.getOperatorList();
          const ids = new Set();
          for (let k = 0; k < ops.fnArray.length; k++) {
            if (ops.fnArray[k] === lib.OPS.setFont) {
              const id = ops.argsArray[k][0];
              if (typeof id === 'string') ids.add(id);
            }
          }
          for (const id of ids) {
            if (fonts.has(id)) continue;
            const fo = await resolveFont(page, id);
            if (!fo) continue;
            // Strip the 6-letter subset prefix (e.g. "ABCDEF+Arial").
            const name = String(fo.name || fo.loadedName || id).replace(/^[A-Z]{6}\+/, '');
            fonts.set(id, { name, embedded: !!fo.data, type: fo.type || '' });
          }
        } catch (_) {}
      }
      if (fonts.size) {
        const list = [...fonts.values()];
        const notEmbedded = list.filter((f) => !f.embedded).length;
        const scope = pdf.numPages > cap ? ' (first ' + cap + ' pages)' : '';
        addRow(rowHelp('Fonts', list.length + (notEmbedded ? ', ' + notEmbedded + ' not embedded' : ', all embedded') + scope,
          'How many different fonts the document uses. A font that is not stored inside the file (not embedded) relies on the reader’s device already having it, so the document can look different on another computer - a useful clue to how portable and how genuine the file is.'));
        const det = el('details');
        det.appendChild(el('summary', {}, 'Fonts (' + list.length + ')'));
        const ul = el('ul', { style: 'margin:8px 0 0;padding-left:18px;font-size:13px;' });
        for (const f of list) {
          const bits = [];
          if (f.type) bits.push(f.type);
          bits.push(f.embedded ? 'embedded' : 'not embedded');
          ul.appendChild(el('li', { style: 'margin:2px 0;' }, f.name + '  (' + bits.join(', ') + ')'));
        }
        det.appendChild(ul);
        extras.push(det);
      }
    } catch (_) {}

    // Only show the card if we actually surfaced something.
    if (structRows || extras.length) {
      structCard.appendChild(stbl);
      for (const d of extras) structCard.appendChild(d);
      resultsEl.appendChild(structCard);
    }
  } catch (_) { /* never break the rest of the render */ }

  // --- Text extraction (all pages, revealed in batches of 3) ---
  const textCard = el('div', { class: 'anr-card' });
  textCard.appendChild(el('h3', {}, 'Text content'));
  const textNote = el('p', { class: 'anr-hint', style: 'font-size:12px;margin:0 0 10px;display:none;' });
  textCard.appendChild(textNote);
  const textWrap = el('div', { style: 'max-height:420px;overflow:auto;' });
  textWrap.appendChild(el('div', { class: 'anr-info' }, 'Extracting…'));
  textCard.appendChild(textWrap);

  const btnRow = el('div', { class: 'anr-btn-row' });
  const moreBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Show next 3 pages');
  const allBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Show all');
  btnRow.appendChild(moreBtn);
  btnRow.appendChild(allBtn);
  textCard.appendChild(btnRow);
  resultsEl.appendChild(textCard);

  // Reconstruct line breaks: pdf.js flags the last item of a visual line with
  // hasEOL, so honouring it reads far closer to the page than a space-joined blob.
  const pageTexts: { n: number; text: string }[] = [];     // { n, text }
  const emptyPages = [];    // pages with no extractable text (likely scanned images)
  for (let i = 1; i <= pdf.numPages; i++) {
    try {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let out = '';
      for (const item of content.items) {
        out += item.str;
        if (item.hasEOL) out += '\n';
        else if (item.str && !item.str.endsWith(' ')) out += ' ';
      }
      const text = out.replace(/[ \t]+\n/g, '\n').trim();
      pageTexts.push({ n: i, text });
      if (!text) emptyPages.push(i);
    } catch (_) {
      pageTexts.push({ n: i, text: '(could not extract text)' });
    }
  }

  if (emptyPages.length) {
    textNote.style.display = '';
    if (emptyPages.length === pdf.numPages) {
      textNote.textContent = 'No embedded text on any page - this looks like a scanned / image-only PDF. Use OCR below to read it.';
    } else {
      const list = emptyPages.length > 12 ? emptyPages.slice(0, 12).join(', ') + '…' : emptyPages.join(', ');
      textNote.textContent = emptyPages.length + ' page' + (emptyPages.length === 1 ? '' : 's') +
        ' have no embedded text (likely scanned): ' + list + '. Use OCR for those.';
    }
  }

  let visibleCount = Math.min(3, pageTexts.length);

  function renderVisible() {
    textWrap.innerHTML = '';
    if (!pageTexts.length) {
      textWrap.appendChild(el('div', { class: 'anr-info' }, '(no text content found)'));
    }
    for (const pt of pageTexts.slice(0, visibleCount)) {
      const block = el('div', { style: 'margin:0 0 14px;' });
      const head = el('div', { style: 'display:flex;align-items:center;gap:10px;margin:0 0 4px;' });
      head.appendChild(el('span', { style: 'font-size:11px;opacity:0.7;font-family:var(--font-mono);' }, 'Page ' + pt.n));
      if (pt.text && pt.text !== '(could not extract text)') {
        const copyBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, 'Copy');
        copyBtn.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(pt.text); copyBtn.textContent = 'Copied'; }
          catch (_) { copyBtn.textContent = 'Failed'; }
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
        });
        head.appendChild(copyBtn);
      }
      block.appendChild(head);
      const pre = el('pre', { class: 'anr-ocr-text', style: 'white-space:pre-wrap;margin:0;' });
      pre.textContent = pt.text || '(no text on this page)';
      block.appendChild(pre);
      textWrap.appendChild(block);
    }
    if (visibleCount >= pageTexts.length) {
      btnRow.hidden = true;
    } else {
      btnRow.hidden = false;
      moreBtn.textContent = 'Show next 3 pages (' + visibleCount + '/' + pageTexts.length + ')';
    }
  }

  renderVisible();

  moreBtn.addEventListener('click', () => {
    visibleCount = Math.min(visibleCount + 3, pageTexts.length);
    renderVisible();
  });
  allBtn.addEventListener('click', () => {
    visibleCount = pageTexts.length;
    renderVisible();
  });

  // --- Thumbnail previews (first 4 pages, click to view full page) ---
  const thumbCard = el('div', { class: 'anr-card' });
  thumbCard.appendChild(el('h3', {}, 'Page previews'));

  // Touch devices have no hover, so the per-page action buttons (Analyse / OCR /
  // PNG) that normally appear on hover are shown permanently there instead.
  const isTouch = !!(window.matchMedia && window.matchMedia('(hover: none), (pointer: coarse)').matches);
  const thumbContainer = el('div', {
    style: 'display: flex; flex-wrap: wrap; gap: 12px; justify-content: flex-start;'
  });

  const PDF_ZOOM = 2;   // double-click / double-tap zoom factor in the viewer
  function openPageViewer(startPage: number) {
    let overlay = document.getElementById('anr-pdf-viewer')!;
    if (!overlay) {
      overlay = el('div', { id: 'anr-pdf-viewer', class: 'lightbox anr-doc-lightbox' });
      const closeBtn = el('button', { type: 'button', class: 'lightbox-close' }, 'Close');
      const center = el('div', { class: 'lightbox-center' });
      const stage = el('div', { class: 'anr-doc-stage anr-pdf-stage' });
      const pagebox = el('div', { class: 'anr-pdf-pagebox' });
      const cv = el('canvas', {});
      const textLayer = el('div', { class: 'textLayer' });
      pagebox.appendChild(cv);
      pagebox.appendChild(textLayer);
      stage.appendChild(pagebox);
      const toolbar = el('div', { class: 'lightbox-toolbar' });
      const meta = el('p', { class: 'lightbox-meta' });
      center.appendChild(stage);
      center.appendChild(toolbar);
      center.appendChild(meta);
      overlay.appendChild(closeBtn);
      overlay.appendChild(center);
      // Raw hide vs. user-close: close() also unwinds the Back-button history entry.
      overlay._hide = function () { overlay.hidden = true; document.body.style.overflow = ''; overlay._backClose = null; };
      function close() { if (overlay._backClose) overlay._backClose(); else overlay._hide(); }
      closeBtn.addEventListener('click', close);
      // Backdrop click closes - but not when finishing a text selection on it.
      overlay.addEventListener('click', (e) => {
        if (e.target !== overlay) return;
        const sel = window.getSelection && window.getSelection();
        if (sel && String(sel).length) return;
        close();
      });
      document.addEventListener('keydown', (e) => {
        if (overlay.hidden) return;
        if (e.key === 'Escape') close();
        else if (e.key === 'ArrowLeft') overlay._prev && overlay._prev();
        else if (e.key === 'ArrowRight') overlay._next && overlay._next();
      });

      // Zoom on double-click / double-tap (single tap+drag stays free for
      // selecting text on the layer). CSS `zoom` scales canvas + text layer
      // together while keeping selection live; the stage scrolls to pan.
      // Firefox only supports CSS `zoom` from v126, so fall back to an equivalent
      // `transform: scale()` with a top-left origin - it contributes the same
      // scaled overflow to the stage's scroll area, so the pan/scroll math below
      // is unchanged. Supported browsers keep the identical `zoom` path.
      const hasCssZoom = !!(window.CSS && CSS.supports && CSS.supports('zoom', '2'));
      const applyScale = (factor: number) => {
        if (!factor || factor === 1) {
          if (hasCssZoom) pagebox.style.zoom = '';
          else { pagebox.style.transform = ''; pagebox.style.transformOrigin = ''; }
        } else if (hasCssZoom) {
          pagebox.style.zoom = String(factor);
        } else {
          pagebox.style.transformOrigin = '0 0';
          pagebox.style.transform = `scale(${factor})`;
        }
      };
      let zoomed = false;
      overlay._resetZoom = () => { zoomed = false; applyScale(1); overlay._trimHScroll && overlay._trimHScroll(); };
      overlay._toggleZoom = (clientX: number, clientY: number) => {
        zoomed = !zoomed;
        if (!zoomed) { applyScale(1); overlay._trimHScroll && overlay._trimHScroll(); overlay._updatePanCursor && overlay._updatePanCursor(); return; }
        // Zooming in can add real horizontal overflow, so re-enable the axis
        // before positioning the scroll.
        stage.style.overflowX = 'auto';
        const rect = pagebox.getBoundingClientRect();
        const cx = stage.scrollLeft + (clientX - rect.left);
        const cy = stage.scrollTop + (clientY - rect.top);
        applyScale(PDF_ZOOM);
        stage.scrollLeft = cx * PDF_ZOOM - stage.clientWidth / 2;
        stage.scrollTop = cy * PDF_ZOOM - stage.clientHeight / 2;
        overlay._trimHScroll && overlay._trimHScroll();
        overlay._updatePanCursor && overlay._updatePanCursor();
      };
      stage.addEventListener('dblclick', (e) => { e.preventDefault(); overlay._toggleZoom(e.clientX, e.clientY); });
      let lastTap = 0, lastX = 0, lastY = 0;
      stage.addEventListener('pointerup', (e) => {
        if (e.pointerType !== 'touch') return;
        const now = e.timeStamp;
        if (now - lastTap < 320 && Math.abs(e.clientX - lastX) < 30 && Math.abs(e.clientY - lastY) < 30) {
          const sel = window.getSelection && window.getSelection();
          if (!(sel && String(sel).length)) overlay._toggleZoom(e.clientX, e.clientY);
          lastTap = 0;
        } else { lastTap = now; lastX = e.clientX; lastY = e.clientY; }
      });

      // Grab-to-pan: when the page overflows the stage (zoomed in, or just a
      // large page), dragging with the mouse moves it like a hand tool. Only
      // engages while there's something to scroll, so an un-zoomed page that
      // fits keeps its normal drag-to-select-text behaviour; touch keeps its
      // native scroll/selection.
      const canPanX = () => stage.scrollWidth - stage.clientWidth > 1;
      const canPanY = () => stage.scrollHeight - stage.clientHeight > 1;
      const canPan = () => canPanX() || canPanY();
      overlay._updatePanCursor = () => { stage.classList.toggle('is-grabbable', canPan()); };
      // Sub-pixel rounding can leave the page ~1px wider than the stage, which
      // renders a pointless horizontal scrollbar. Hide the horizontal axis when
      // the overflow is trivially small; keep it scrollable for real overflow
      // (zoomed-in or genuinely wide pages).
      overlay._trimHScroll = () => {
        stage.style.overflowX = stage.scrollWidth - stage.clientWidth > 3 ? 'auto' : 'hidden';
      };
      let panId: number|null = null, panX = 0, panY = 0, panL = 0, panT = 0, panAllowX = false, panAllowY = false;
      stage.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch' || e.button !== 0 || !canPan()) return;
        panId = e.pointerId;
        panX = e.clientX; panY = e.clientY;
        panL = stage.scrollLeft; panT = stage.scrollTop;
        // Only pan an axis that actually overflows, so a page that fits
        // horizontally can't be dragged sideways (and vice versa).
        panAllowX = canPanX(); panAllowY = canPanY();
        stage.classList.add('is-panning');
        stage.setPointerCapture(panId);
        e.preventDefault();   // suppress text selection while dragging to pan
      });
      stage.addEventListener('pointermove', (e) => {
        if (panId === null || e.pointerId !== panId) return;
        if (panAllowX) stage.scrollLeft = panL - (e.clientX - panX);
        if (panAllowY) stage.scrollTop = panT - (e.clientY - panY);
      });
      const endPan = (e: PointerEvent) => {
        if (panId === null || e.pointerId !== panId) return;
        try { stage.releasePointerCapture(panId); } catch (_) {}
        panId = null;
        stage.classList.remove('is-panning');
      };
      stage.addEventListener('pointerup', endPan);
      stage.addEventListener('pointercancel', endPan);

      document.body.appendChild(overlay);
    }
    const stage = overlay.querySelector<HTMLElement>('.anr-pdf-stage')!;
    const pagebox = overlay.querySelector<HTMLElement>('.anr-pdf-pagebox')!;
    const cv = pagebox.querySelector('canvas')!;
    const textLayer = pagebox.querySelector<HTMLElement>('.textLayer')!;
    const toolbar = overlay.querySelector<HTMLElement>('.lightbox-toolbar')!;
    const meta = overlay.querySelector<HTMLElement>('.lightbox-meta')!;
    toolbar.innerHTML = '';

    let current = startPage;
    let hiRes = true;             // on by default; toggled by the High-res button below

    // Overlay a selectable, position-aligned text layer on top of the canvas.
    async function buildTextLayer(pg: any, cssScale: number, cssW: number, cssH: number, seq: number) {
      textLayer.innerHTML = '';
      textLayer.style.width = cssW + 'px';
      textLayer.style.height = cssH + 'px';
      textLayer.style.setProperty('--scale-factor', String(cssScale));
      try {
        const tc = await pg.getTextContent();
        if (seq !== viewerSeq) return;
        const vp = pg.getViewport({ scale: cssScale });
        // pdf.js 4.1+ replaced renderTextLayer() with the TextLayer class.
        if (lib.TextLayer) {
          const layer = new lib.TextLayer({ textContentSource: tc, container: textLayer, viewport: vp });
          viewerTextTask = layer;
          try { await layer.render(); }
          finally {
            // TextLayer measures glyphs on a canvas it appends to <body>; pdf.js's
            // own stylesheet hides it, ours does not, so hide and release it here.
            document.querySelectorAll<HTMLElement>('body > canvas.hiddenCanvasElement').forEach((c) => { c.style.display = 'none'; });
            try { lib.TextLayer.cleanup && lib.TextLayer.cleanup(); } catch (_) { /* ignore */ }
          }
        } else {
          const task = lib.renderTextLayer({ textContentSource: tc, container: textLayer, viewport: vp });
          viewerTextTask = task;
          await (task && task.promise ? task.promise : task);
        }
      } catch (_) { /* page just won't be selectable */ }
    }

    async function showPage(num: number, keepZoom?: boolean|undefined) {
      // Cancel whatever the previous call still has in flight, so only the page
      // asked for last is drawn and only its text layer is built.
      const seq = ++viewerSeq;
      if (viewerRenderTask) { try { viewerRenderTask.cancel(); } catch (_) { /* ignore */ } viewerRenderTask = null; }
      if (viewerTextTask) { try { viewerTextTask.cancel(); } catch (_) { /* ignore */ } viewerTextTask = null; }
      current = num;
      if (!keepZoom) { overlay._resetZoom(); stage.scrollTop = 0; stage.scrollLeft = 0; }
      meta.textContent = 'Page ' + num + ' / ' + pdf.numPages + (hiRes ? '  (hi-res)' : '') +
        '  -  double-click to zoom';
      prevBtn.style.visibility = num > 1 ? 'visible' : 'hidden';
      nextBtn.style.visibility = num < pdf.numPages ? 'visible' : 'hidden';
      try {
        const pg = await pdf.getPage(num);
        if (seq !== viewerSeq) return;
        const vp = pg.getViewport({ scale: 1 });
        const maxW = window.innerWidth * 0.9;
        const maxH = window.innerHeight * 0.82;
        // The page is laid out (CSS) at fit-to-screen size; the canvas backing
        // store is rendered larger (device density, or High-res oversampling)
        // so it stays crisp when the viewer is zoomed. Clamp the longest side to
        // MAX_SIDE to stay within browser canvas/memory limits (lower on touch).
        const cssScale = Math.min(maxW / vp.width, maxH / vp.height, 3);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const OVERSAMPLE = hiRes ? 3 : 1;
        const MAX_SIDE = isTouch ? 4096 : 8192;
        let renderScale = cssScale * dpr * OVERSAMPLE;
        const longest = Math.max(vp.width, vp.height) * renderScale;
        if (longest > MAX_SIDE) renderScale = MAX_SIDE / Math.max(vp.width, vp.height);
        const sv = pg.getViewport({ scale: renderScale });
        cv.width = Math.floor(sv.width);
        cv.height = Math.floor(sv.height);
        const cssW = Math.floor(vp.width * cssScale);
        const cssH = Math.floor(vp.height * cssScale);
        cv.style.width = cssW + 'px';
        cv.style.height = cssH + 'px';
        pagebox.style.width = cssW + 'px';
        pagebox.style.height = cssH + 'px';
        const task = pg.render({ canvasContext: cv.getContext('2d'), viewport: sv });
        viewerRenderTask = task;
        await task.promise;
        if (seq !== viewerSeq) return;
        viewerRenderTask = null;
        await buildTextLayer(pg, cssScale, cssW, cssH, seq);
        if (seq !== viewerSeq) return;
        viewerTextTask = null;
        requestAnimationFrame(() => { overlay._trimHScroll && overlay._trimHScroll(); overlay._updatePanCursor && overlay._updatePanCursor(); });
      } catch (_) {
        // A newer showPage() cancelled this one - not a failure.
        if (seq !== viewerSeq) return;
        meta.textContent = 'Page ' + num + ' - could not render';
      }
    }

    const prevBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, '← Prev');
    prevBtn.addEventListener('click', (e) => { e.stopPropagation(); if (current > 1) showPage(current - 1); });
    const nextBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, 'Next →');
    nextBtn.addEventListener('click', (e) => { e.stopPropagation(); if (current < pdf.numPages) showPage(current + 1); });
    const zoomBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, 'Zoom');
    zoomBtn.addEventListener('click', (e) => { e.stopPropagation(); overlay._toggleZoom(window.innerWidth / 2, window.innerHeight / 2); });
    const hiResBtn = el('button', { type: 'button', class: 'lightbox-tool-btn is-active', title: 'Render this page at much higher resolution for sharper zooming (slower, more memory)' }, 'High-res');
    hiResBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      hiRes = !hiRes;
      hiResBtn.classList.toggle('is-active', hiRes);
      hiResBtn.disabled = true;
      hiResBtn.textContent = hiRes ? 'Rendering…' : 'High-res';
      await showPage(current, true);   // re-render in place, keep the current zoom
      hiResBtn.disabled = false;
      hiResBtn.textContent = 'High-res';
    });
    overlay._prev = () => { if (current > 1) showPage(current - 1); };
    overlay._next = () => { if (current < pdf.numPages) showPage(current + 1); };
    toolbar.appendChild(prevBtn);
    toolbar.appendChild(nextBtn);
    toolbar.appendChild(zoomBtn);
    toolbar.appendChild(hiResBtn);

    const wasHidden = overlay.hidden;
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    if (wasHidden) overlay._backClose = openOverlayBack(overlay._hide);
    showPage(startPage);
  }

  // "One long page": every page stacked in a single scrolling column, with a
  // Save as PNG that writes the same column as ONE tall image at the chosen
  // resolution (writeLongPng). Pages draw only while near the view and are
  // dropped again once scrolled well past, so a 500-page document holds a
  // handful of canvases, not 500. Placeholders start at page 1's size; a
  // background pass then measures every page (the export needs the exact
  // total height before it writes the header), resizing any that differ.
  const LONG_DPI = [150, 300, 600];
  async function openLongView() {
    const n: number = pdf.numPages;
    const p1vp = (await pdf.getPage(1)).getViewport({ scale: 1 });
    const p1 = { w: p1vp.width, h: p1vp.height };
    const sizes: ({ w: number; h: number }|null)[] = new Array(n).fill(null);
    const cssScale = Math.min(Math.min(window.innerWidth * 0.9, 1000) / p1.w, 2);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let closed = false;
    let exporting: { cancel: () => void }|null = null;

    const overlay = el('div', { class: 'lightbox anr-doc-lightbox anr-pdf-long' });
    const closeBtn = el('button', { type: 'button', class: 'lightbox-close' }, 'Close');
    const center = el('div', { class: 'lightbox-center' });
    const stage = el('div', { class: 'anr-doc-stage anr-pdf-long-stage' });
    const column = el('div', { class: 'anr-pdf-long-col' });
    const toolbar = el('div', { class: 'lightbox-toolbar' });
    const meta = el('p', { class: 'lightbox-meta' });
    stage.appendChild(column);
    center.appendChild(stage);
    center.appendChild(toolbar);
    center.appendChild(meta);
    overlay.appendChild(closeBtn);
    overlay.appendChild(center);

    const slots: { box: HTMLElement; canvas: HTMLCanvasElement|null; task: any; visible: boolean }[] = [];
    for (let i = 0; i < n; i++) {
      const box = el('div', { class: 'anr-pdf-long-page', 'data-page': String(i + 1) });
      box.style.width = Math.floor(p1.w * cssScale) + 'px';
      box.style.height = Math.floor(p1.h * cssScale) + 'px';
      column.appendChild(box);
      slots.push({ box, canvas: null, task: null, visible: false });
    }

    // Record a page's real size. A page above the view that changes height moves
    // everything below it, so the scroll position is shifted by the same amount.
    function sizeSlot(i: number, w: number, h: number) {
      sizes[i] = { w, h };
      const box = slots[i].box;
      const cw = Math.floor(w * cssScale), ch = Math.floor(h * cssScale);
      if (box.style.width === cw + 'px' && box.style.height === ch + 'px') return;
      const oldH = box.offsetHeight;
      const above = box.offsetTop + oldH <= stage.scrollTop;
      box.style.width = cw + 'px';
      box.style.height = ch + 'px';
      if (above) stage.scrollTop += ch - oldH;
    }

    async function drawSlot(i: number) {
      const sl = slots[i];
      if (sl.canvas || sl.task) return;
      let pg: any;
      try { pg = await pdf.getPage(i + 1); } catch (_) { return; }
      if (closed || !sl.visible || sl.canvas || sl.task) return;
      const vp1 = pg.getViewport({ scale: 1 });
      sizeSlot(i, vp1.width, vp1.height);
      const vp = pg.getViewport({ scale: cssScale * dpr });
      const cv = el('canvas', {});
      cv.width = Math.floor(vp.width);
      cv.height = Math.floor(vp.height);
      const task = pg.render({ canvasContext: cv.getContext('2d'), viewport: vp });
      sl.task = task;
      // Only clear the slot's task if it is still THIS one: a drop-and-redraw while
      // this render was in flight has already handed the slot a newer task.
      try { await task.promise; }
      catch (_) { if (sl.task === task) sl.task = null; cv.width = 0; return; }   // cancelled by dropSlot, or a bad page
      if (sl.task === task) sl.task = null;
      if (closed || !sl.visible || sl.canvas) { cv.width = 0; return; }
      sl.box.appendChild(cv);
      sl.canvas = cv;
    }
    function dropSlot(i: number) {
      const sl = slots[i];
      if (sl.task) { try { sl.task.cancel(); } catch (_) { /* ignore */ } sl.task = null; }
      if (sl.canvas) { sl.canvas.remove(); sl.canvas.width = 0; sl.canvas = null; }
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const i = Number((e.target as HTMLElement).dataset.page) - 1;
        slots[i].visible = e.isIntersecting;
        if (e.isIntersecting) drawSlot(i); else dropSlot(i);
      }
    }, { root: stage, rootMargin: '100% 0px' });
    for (const sl of slots) io.observe(sl.box);

    // Page indicator: the page under the middle of the view.
    function currentPage() {
      const mid = stage.scrollTop + stage.clientHeight / 2;
      let lo = 0, hi = n - 1;
      while (lo < hi) {
        const m = (lo + hi + 1) >> 1;
        if (slots[m].box.offsetTop <= mid) lo = m; else hi = m - 1;
      }
      return lo + 1;
    }
    let metaQueued = false;
    function showPageMeta() {
      if (exporting || closed) return;
      meta.textContent = 'Page ' + currentPage() + ' / ' + n + '  -  one long page';
    }
    stage.addEventListener('scroll', () => {
      if (metaQueued) return;
      metaQueued = true;
      requestAnimationFrame(() => { metaQueued = false; showPageMeta(); });
    }, { passive: true });

    // Size of the saved image at a given dpi, from the measured pages (page 1's
    // size stands in for any not measured yet).
    function geometry(dpi: number) {
      const s = dpi / 72;
      let W = 0, H = 0;
      for (const z of sizes) {
        const sz = z || p1;
        W = Math.max(W, Math.round(sz.w * s));
        H += Math.round(sz.h * s);
      }
      return { s, W, H, ok: W <= CANVAS_EDGE_MAX && W * H <= PDF_LONG_MAX_PX };
    }

    let dpi = 300;
    const chips = LONG_DPI.map((d) => {
      const b = el('button', { type: 'button', class: 'lightbox-tool-btn' }, d + ' dpi');
      b.addEventListener('click', (e) => { e.stopPropagation(); if (exporting) return; dpi = d; syncChips(); });
      return b;
    });
    const saveBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, 'Save as PNG');
    // Grey out a resolution whose image would be too big for this device, and step
    // the selection down to the largest one that fits.
    function syncChips() {
      const fits = LONG_DPI.map((d) => geometry(d));
      if (!fits[LONG_DPI.indexOf(dpi)].ok) {
        for (let k = LONG_DPI.length - 1; k >= 0; k--) if (fits[k].ok) { dpi = LONG_DPI[k]; break; }
      }
      chips.forEach((b, k) => {
        const g = fits[k];
        b.disabled = !g.ok;
        b.classList.toggle('is-active', LONG_DPI[k] === dpi && g.ok);
        b.title = (g.ok ? '' : 'Too large to save on this device - ') + g.W.toLocaleString() + ' x ' + g.H.toLocaleString() + ' px';
      });
      saveBtn.disabled = !fits.some((g) => g.ok);
      saveBtn.title = saveBtn.disabled ? 'This document is too long to save as one image on this device' : 'Save every page as one tall PNG';
    }

    async function savePng() {
      if (exporting) { exporting.cancel(); return; }
      if (typeof CompressionStream === 'undefined') {
        meta.textContent = 'This browser cannot write the PNG - try a current Chrome, Firefox or Safari';
        return;
      }
      let cancelled = false;
      let task: any = null;
      exporting = { cancel: () => { cancelled = true; if (task) { try { task.cancel(); } catch (_) { /* ignore */ } } } };
      saveBtn.textContent = 'Cancel';
      saveBtn.classList.add('is-active');
      const at = dpi;
      try {
        meta.textContent = 'Measuring pages…';
        await measured;
        if (cancelled || closed) throw new Error('cancelled');
        const g = geometry(at);
        if (!g.ok) throw new Error('the image would be ' + g.W.toLocaleString() + ' x ' + g.H.toLocaleString() + ' px, too large for this device');
        const blob = await writeLongPng(pdf, sizes as { w: number; h: number }[], g.s, g.W, g.H, at,
          (frac, page) => { meta.textContent = 'Saving ' + at + ' dpi PNG - page ' + page + ' / ' + n + '  (' + Math.round(frac * 100) + '%)'; },
          () => cancelled || closed, (t) => { task = t; });
        if (cancelled || closed) throw new Error('cancelled');
        downloadBlob(file.name.replace(/\.pdf$/i, '') + '-long-' + at + 'dpi.png', blob);
        meta.textContent = 'Saved ' + g.W.toLocaleString() + ' x ' + g.H.toLocaleString() + ' px PNG  (' + fmtBytes(blob.size) + ')';
      } catch (e) {
        if (!closed) meta.textContent = cancelled ? 'Save cancelled' : 'Could not save the image - ' + ((e && e.message) || 'unknown error');
      } finally {
        exporting = null;
        saveBtn.textContent = 'Save as PNG';
        saveBtn.classList.remove('is-active');
      }
    }
    saveBtn.addEventListener('click', (e) => { e.stopPropagation(); savePng(); });
    for (const b of chips) toolbar.appendChild(b);
    toolbar.appendChild(saveBtn);

    const measured = (async () => {
      sizes[0] = p1;
      for (let i = 1; i < n && !closed; i++) {
        if (sizes[i]) continue;
        try {
          const vp = (await pdf.getPage(i + 1)).getViewport({ scale: 1 });
          if (!closed) sizeSlot(i, vp.width, vp.height);
        } catch (_) { sizes[i] = p1; }   // unreadable: kept at page 1's size, drawn white
      }
      if (!closed) syncChips();
    })();

    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') backClose(); }
    function hide() {
      closed = true;
      if (exporting) exporting.cancel();
      io.disconnect();
      for (let i = 0; i < n; i++) dropSlot(i);
      overlay.remove();
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    }
    const backClose = openOverlayBack(hide);   // device Back closes it
    closeBtn.addEventListener('click', backClose);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) backClose(); });
    document.addEventListener('keydown', onKey);

    syncChips();
    document.body.appendChild(overlay);
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    showPageMeta();
  }

  // Render a page to a high-resolution canvas (for photo analysis / OCR).
  async function renderPageHiRes(pageNum: number) {
    const pg = await pdf.getPage(pageNum);
    const vp = pg.getViewport({ scale: 1 });
    const scale = Math.min(3, 2000 / Math.max(vp.width, vp.height));
    const sv = pg.getViewport({ scale });
    const cv = document.createElement('canvas');
    cv.width = Math.floor(sv.width);
    cv.height = Math.floor(sv.height);
    await pg.render({ canvasContext: cv.getContext('2d'), viewport: sv }).promise;
    return cv;
  }

  // Lightweight overlay used to show a single page's OCR result.
  function showOcrOverlay(pageNum: number, text: string) {
    const overlay = el('div', {
      style: 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;'
    });
    const inner = el('div', {
      style: 'background:var(--bg);max-width:90vw;max-height:90vh;overflow:auto;padding:24px;border:1px solid var(--hairline);position:relative;width:760px;'
    });
    const closeBtn = el('button', {
      type: 'button',
      style: 'position:absolute;top:8px;right:12px;background:transparent;border:none;font-size:22px;cursor:pointer;color:var(--fg);'
    }, '×');
    inner.appendChild(closeBtn);
    inner.appendChild(el('h3', { style: 'margin-bottom:12px;' }, 'OCR - Page ' + pageNum));
    const pre = el('pre', { class: 'anr-ocr-text', style: 'white-space:pre-wrap;font-size:13px;margin:0;' });
    pre.textContent = text || '(no text detected)';
    inner.appendChild(pre);
    overlay.appendChild(inner);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    function hide() { overlay.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); }
    const backClose = openOverlayBack(hide);   // device Back closes it
    closeBtn.addEventListener('click', backClose);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) backClose(); });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') backClose(); };
    document.addEventListener('keydown', onKey);
  }

  let thumbsRendered = 0;
  async function renderThumb(pageNum: number) {
    try {
      const page = await pdf.getPage(pageNum);
      const vp = page.getViewport({ scale: 1 });
      // Fit the whole page inside an A4-proportioned box (200px wide, A4-tall):
      // some PDFs carry a single enormously tall page (long receipts, stitched
      // scans) whose fixed-width thumbnail would run thousands of px down the
      // card. Scaling to fit shrinks such a page to fit the box so all of it
      // shows, instead of a giant strip; normal pages are unaffected (they hit
      // the width limit first).
      const A4_RATIO = 297 / 210;   // A4 portrait, height : width
      const boxW = 200, boxH = boxW * A4_RATIO;
      const scale = Math.min(boxW / vp.width, boxH / vp.height);
      const scaled = page.getViewport({ scale });
      const canvas = el('canvas', {
        width: String(Math.floor(scaled.width)),
        height: String(Math.floor(scaled.height)),
        style: 'border: 1px solid var(--hairline); cursor: pointer; display:block;'
      });
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: scaled }).promise;
      canvas.addEventListener('click', () => openPageViewer(pageNum));

      // Hover actions: analyse the page as a photo, or OCR just this page.
      const actions = el('div', {
        style: 'position:absolute;top:6px;left:6px;right:6px;display:flex;gap:6px;justify-content:center;' +
               (isTouch ? 'opacity:1;pointer-events:auto;' : 'opacity:0;transition:opacity 0.15s;pointer-events:none;')
      });
      const btnStyle = 'font-size:10px;padding:2px 6px;background:var(--bg);border:1px solid var(--hairline);' +
                       'color:var(--fg);cursor:pointer;font-family:var(--font-mono);';
      const analyseBtn = el('button', { type: 'button', style: btnStyle }, 'Analyse');
      const ocrBtn = el('button', { type: 'button', style: btnStyle }, 'OCR');
      const pngBtn = el('button', { type: 'button', style: btnStyle }, 'PNG');
      actions.appendChild(analyseBtn);
      actions.appendChild(ocrBtn);
      actions.appendChild(pngBtn);

      pngBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        pngBtn.textContent = '…';
        try {
          const cv = await renderPageHiRes(pageNum);
          cv.toBlob((blob) => {
            const url = URL.createObjectURL(blob!);
            const a = el('a', { href: url, download: file.name.replace(/\.pdf$/i, '') + '-page-' + pageNum + '.png' });
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            pngBtn.textContent = 'PNG';
          }, 'image/png');
        } catch (_) { pngBtn.textContent = 'PNG'; }
      });

      analyseBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        analyseBtn.textContent = '…';
        try {
          const cv = await renderPageHiRes(pageNum);
          cv.toBlob((blob) => {
            const photoFile = new File([blob!], 'page-' + pageNum + '.png', { type: 'image/png' });
            const photoResults = revealPhotoSection();
            if (photoResults) {
              renderPhoto(photoFile, photoResults,
                { sourceNote: 'Page ' + pageNum + ' of ' + (file.name || 'this PDF') + ', rendered and analysed as an image.' });
            }
            analyseBtn.textContent = 'Analyse';
          }, 'image/png');
        } catch (_) { analyseBtn.textContent = 'Analyse'; }
      });

      ocrBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const lang = await pickOcrLanguage({ title: 'OCR language - page ' + pageNum });
        if (!lang) return;
        ocrBtn.textContent = '…';
        try {
          if (!window.Tesseract) {
            const s = document.createElement('script');
            s.src = TESSERACT_URL;
            await new Promise((res, rej) => { s.onload = res; s.onerror = rej; document.head.appendChild(s); });
          }
          const cv = await renderPageHiRes(pageNum);
          const worker = await window.Tesseract.createWorker(lang, undefined, {
            workerPath: 'assets/vendor/tesseract/worker.min.js',
            langPath: ocrLangPath(lang),
            corePath: 'assets/vendor/tesseract'
          });
          const result = await worker.recognize(cv);
          await worker.terminate();
          showOcrOverlay(pageNum, (result.data.text || '').trim());
        } catch (_) {
          showOcrOverlay(pageNum, '(OCR failed)');
        }
        ocrBtn.textContent = 'OCR';
      });

      const wrapper = el('div', { style: 'text-align: center; position: relative;' }, [
        canvas,
        actions,
        el('div', { style: 'font-size: 11px; margin-top: 4px; opacity: 0.7;' }, `Page ${pageNum}`)
      ]);
      if (!isTouch) {
        wrapper.addEventListener('mouseenter', () => { actions.style.opacity = '1'; actions.style.pointerEvents = 'auto'; });
        wrapper.addEventListener('mouseleave', () => { actions.style.opacity = '0'; actions.style.pointerEvents = 'none'; });
      }
      thumbContainer.appendChild(wrapper);
    } catch (_) {}
  }

  for (let i = 1; i <= initialPages; i++) await renderThumb(i);
  thumbsRendered = initialPages;

  const thumbBtnRow = el('div', { class: 'anr-btn-row' });
  const thumbMoreBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Show next 3 pages');
  const thumbAllBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Show all');
  // Stays in the row after the paging buttons go, so the row itself never hides.
  const longBtn = el('button', { type: 'button', class: 'anr-btn', title: 'Every page in one scrolling column, savable as a single tall PNG' }, 'View as one long page');
  longBtn.addEventListener('click', async () => {
    longBtn.disabled = true;
    try { await openLongView(); } catch (_) { /* document gone (a newer render released it) */ }
    longBtn.disabled = false;
  });

  function updateThumbBtns() {
    const remaining = pdf.numPages - thumbsRendered;
    if (remaining <= 0) {
      thumbMoreBtn.hidden = true;
      thumbAllBtn.hidden = true;
    } else {
      // With fewer than 3 pages left, "Show next 3 pages" would just do what
      // "Show all" does - hide it and leave the single "Show all" button.
      thumbMoreBtn.hidden = remaining < 3;
      thumbMoreBtn.textContent = `Show next 3 pages (${thumbsRendered}/${pdf.numPages})`;
    }
  }

  thumbMoreBtn.addEventListener('click', async () => {
    const end = Math.min(thumbsRendered + 3, pdf.numPages);
    for (let i = thumbsRendered + 1; i <= end; i++) await renderThumb(i);
    thumbsRendered = end;
    updateThumbBtns();
  });
  thumbAllBtn.addEventListener('click', async () => {
    thumbAllBtn.disabled = true;
    thumbMoreBtn.disabled = true;
    for (let i = thumbsRendered + 1; i <= pdf.numPages; i++) await renderThumb(i);
    thumbsRendered = pdf.numPages;
    updateThumbBtns();
  });

  thumbBtnRow.appendChild(thumbMoreBtn);
  thumbBtnRow.appendChild(thumbAllBtn);
  thumbBtnRow.appendChild(longBtn);
  updateThumbBtns();

  thumbCard.appendChild(thumbContainer);
  thumbCard.appendChild(thumbBtnRow);
  // Page previews sit above the "PDF document" info card so the pages are the
  // first thing you see - which is where the ghost sheets have been holding the
  // space since before the metadata was read.
  thumbSkeleton.replaceWith(thumbCard);

  // --- Embedded image extraction ---
  const imgCard = el('div', { class: 'anr-card' });
  imgCard.appendChild(el('h3', {}, 'Embedded images'));
  imgCard.appendChild(el('p', { class: 'anr-hint', style: 'font-size:12px;margin:0 0 10px;' },
    'The original photos, logos and scans stored inside the PDF - separate from the page previews above.'));
  const imgExtractBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Extract embedded images');
  const imgStatus = el('span', { class: 'anr-hint', style: 'font-size:12px;margin-left:10px;' }, '');
  const imgGrid = el('div', { style: 'display:flex;flex-wrap:wrap;gap:12px;margin-top:12px;' });
  imgCard.appendChild(el('div', { class: 'anr-btn-row' }, [imgExtractBtn, imgStatus]));
  imgCard.appendChild(imgGrid);
  resultsEl.appendChild(imgCard);

  imgExtractBtn.addEventListener('click', async () => {
    imgExtractBtn.disabled = true;
    imgGrid.innerHTML = '';
    imgStatus.textContent = 'Scanning…';
    let found = 0;
    const seen = new Set();
    try {
      const OPS = lib.OPS;
      for (let p = 1; p <= pdf.numPages; p++) {
        imgStatus.textContent = 'Scanning page ' + p + ' / ' + pdf.numPages + '…';
        const page = await pdf.getPage(p);
        const ops = await page.getOperatorList();
        for (let i = 0; i < ops.fnArray.length; i++) {
          const fn = ops.fnArray[i];
          if (fn !== OPS.paintImageXObject && fn !== OPS.paintImageXObjectRepeat) continue;
          const name = ops.argsArray[i][0];
          if (typeof name !== 'string' || seen.has(name)) continue;
          seen.add(name);
          const imgObj = await getPdfImage(page, name);
          const cv = imgObj && pdfImageToCanvas(imgObj);
          if (!cv) continue;
          found++;
          const link = el('a', {
            href: '#', title: 'Download', download: file.name.replace(/\.pdf$/i, '') + '-img-' + found + '.png',
            style: 'display:block;text-align:center;text-decoration:none;color:var(--muted);font-size:11px;'
          });
          cv.style.cssText = 'max-width:120px;max-height:120px;border:1px solid var(--hairline);display:block;background:#fff;';
          link.appendChild(cv);
          link.appendChild(el('div', { style: 'margin-top:4px;' }, cv.width + '×' + cv.height));
          link.addEventListener('click', (e) => {
            e.preventDefault();
            cv.toBlob((b: Blob|null) => {
              const url = URL.createObjectURL(b!);
              const a = el('a', { href: url, download: link.getAttribute('download') });
              document.body.appendChild(a); a.click(); a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }, 'image/png');
          });
          const wrap = el('div', { style: 'text-align:center;' }, [link]);
          const aBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm', style: 'margin-top:4px;' }, 'Analyse');
          // Analysing an extracted image replaces this PDF's results, so leave a
          // Back-bar breadcrumb to the PDF first - same pattern as drilling into
          // an archive or a folder.
          aBtn.addEventListener('click', () => cv.toBlob((b: Blob|null) => {
            if (!b || !window._anrHandleFile) return;
            if (window._anrPushNav) {
              window._anrPushNav(file.name || 'PDF', () => { if (window._anrHandleFile) window._anrHandleFile(file, {}); });
            }
            window._anrHandleFile(new File([b], 'pdf-image.png', { type: 'image/png' }), { nested: true });
          }, 'image/png'));
          wrap.appendChild(aBtn);
          imgGrid.appendChild(wrap);
          if (found >= 300) break;
        }
        if (found >= 300) break;
      }
      imgStatus.textContent = found ? found + ' image' + (found === 1 ? '' : 's') + ' found - click to download' : 'No embedded raster images found.';
    } catch (e) {
      imgStatus.textContent = 'Extraction failed: ' + (e && e.message);
    }
    imgExtractBtn.disabled = false;
  });

  // --- OCR scan (render pages as images → Tesseract) ---
  const ocrCard = el('div', { class: 'anr-card' });
  const ocrDet = el('details');
  ocrDet.appendChild(el('summary', {}, 'OCR - Scan pages as images'));
  const ocrContent = el('div');

  const ocrBarEl = el('div', { class: 'anr-progress-bar' });
  const ocrLabelEl = el('div', { class: 'anr-progress-label' }, 'Ready');
  const ocrProgress = el('div', { class: 'anr-progress', style: 'display:none;' }, [ocrBarEl, ocrLabelEl]);
  ocrContent.appendChild(ocrProgress);

  const ocrOutput = el('pre', { class: 'anr-ocr-text', style: 'max-height:400px; overflow:auto;' });
  ocrOutput.hidden = true;
  ocrContent.appendChild(ocrOutput);

  const ocrBtnRow = el('div', { class: 'anr-btn-row' });
  const ocrRunBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Scan all pages');
  const ocrMoreBtn = el('button', { type: 'button', class: 'anr-btn', style: 'display:none;' }, 'Show more');
  const ocrAllBtn = el('button', { type: 'button', class: 'anr-btn', style: 'display:none;' }, 'Show all');
  ocrBtnRow.appendChild(ocrRunBtn);
  ocrBtnRow.appendChild(ocrMoreBtn);
  ocrBtnRow.appendChild(ocrAllBtn);
  ocrContent.appendChild(ocrBtnRow);
  ocrDet.appendChild(ocrContent);
  ocrCard.appendChild(ocrDet);
  resultsEl.appendChild(ocrCard);

  function setOcrBar(frac: number) {
    const ch = parseFloat(getComputedStyle(ocrBarEl).fontSize) * 0.6 || 8;
    const total = Math.max(10, Math.floor((ocrBarEl.parentElement!.clientWidth - ch * 2) / ch));
    const filled = Math.round(Math.max(0, Math.min(1, frac)) * total);
    ocrBarEl.innerHTML = '[<span class="anr-bar-fill">' + '/'.repeat(filled) + '</span>' + ' '.repeat(total - filled) + ']';
  }

  let ocrPageTexts: string[] = [];
  let ocrVisible = 0;
  let ocrBusy = false;

  function renderOcrVisible() {
    ocrOutput.textContent = ocrPageTexts.slice(0, ocrVisible).join('\n\n') || '(no text found)';
    if (ocrVisible >= ocrPageTexts.length) {
      ocrMoreBtn.style.display = 'none';
      ocrAllBtn.style.display = 'none';
    } else {
      ocrMoreBtn.style.display = '';
      ocrMoreBtn.textContent = 'Show next 3 pages (' + ocrVisible + '/' + ocrPageTexts.length + ')';
      ocrAllBtn.style.display = '';
    }
  }

  ocrMoreBtn.addEventListener('click', () => {
    ocrVisible = Math.min(ocrVisible + 3, ocrPageTexts.length);
    renderOcrVisible();
  });
  ocrAllBtn.addEventListener('click', () => {
    ocrVisible = ocrPageTexts.length;
    renderOcrVisible();
  });

  ocrRunBtn.addEventListener('click', async () => {
    if (ocrBusy) return;
    const ocrLang = await pickOcrLanguage({ title: 'OCR language - all pages' });
    if (!ocrLang) return;
    ocrBusy = true;
    ocrRunBtn.textContent = 'Scanning…';
    ocrRunBtn.disabled = true;
    ocrProgress.style.display = '';
    ocrOutput.hidden = false;
    ocrOutput.textContent = '';

    // Load Tesseract
    ocrLabelEl.textContent = 'Loading Tesseract.js…';
    setOcrBar(0);
    if (!window.Tesseract) {
      const s = document.createElement('script');
      s.src = TESSERACT_URL;
      await new Promise((res, rej) => { s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    }
    const T = window.Tesseract;

    // A small pool of workers (OCR_WORKERS, from limits.ts) each takes the next
    // page until none are left. A worker is created once and kept for the run:
    // starting one loads the engine and the language data, which used to be
    // paid again for every page. One that fails a page is replaced, so a
    // broken worker cannot spoil the pages after it.
    const total = pdf.numPages;
    const texts: string[] = new Array(total);
    const makeWorker = () => T.createWorker(ocrLang, undefined, {
      workerPath: 'assets/vendor/tesseract/worker.min.js',
      langPath: ocrLangPath(ocrLang),
      corePath: 'assets/vendor/tesseract'
    });
    let next = 1, done = 0;
    ocrLabelEl.textContent = 'Scanning page 1 / ' + total + '…';
    const lane = async () => {
      let worker: any = null;
      while (next <= total) {
        const i = next++;
        try {
          const page = await pdf.getPage(i);
          const vp = page.getViewport({ scale: 1 });
          const scale = Math.min(3, 2000 / Math.max(vp.width, vp.height));
          const scaled = page.getViewport({ scale });
          const cv = document.createElement('canvas');
          cv.width = Math.floor(scaled.width);
          cv.height = Math.floor(scaled.height);
          await page.render({ canvasContext: cv.getContext('2d'), viewport: scaled }).promise;
          if (!worker) worker = await makeWorker();
          const result = await worker.recognize(cv);
          cv.width = cv.height = 0;
          const text = (result.data.text || '').trim();
          texts[i - 1] = '--- Page ' + i + ' ---\n' + (text || '(no text detected)');
        } catch (_) {
          texts[i - 1] = '--- Page ' + i + ' ---\n(scan failed)';
          if (worker) { try { await worker.terminate(); } catch (_) {} worker = null; }
        }
        done++;
        ocrLabelEl.textContent = 'Scanning page ' + Math.min(done + 1, total) + ' / ' + total + '…';
        setOcrBar(done / total);
      }
      if (worker) { try { await worker.terminate(); } catch (_) {} }
    };
    await Promise.all(Array.from({ length: Math.min(OCR_WORKERS, total) }, lane));
    ocrPageTexts = texts;

    setOcrBar(1);
    ocrLabelEl.textContent = 'Done - ' + total + ' pages scanned';
    ocrVisible = Math.min(3, ocrPageTexts.length);
    renderOcrVisible();
    ocrRunBtn.textContent = 'Scan complete';
    ocrBusy = false;
  });
}
