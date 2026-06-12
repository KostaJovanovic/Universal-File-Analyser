/* Analyser - folder overview
   Recursively walks a dropped folder via webkitGetAsEntry
   and renders a treemap + summary using the shared folder/archive modules. */

import { el, row, fmtBytes, buildFileTree, inlineLoader, probeReadable, asciiBar } from '../core/util.js';
import { normalizeFolder, renderBreakdownCards, renderViewToggle } from './folder-archive-shared.js';
import { ARCHIVE_EXTS, RAW_EXTS, HEIC_EXTS, PHOTO_EXTS, AUDIO_EXTS, VIDEO_EXTS, SVG_EXTS, CSV_EXTS } from '../core/formats.js';
import { FORMATS } from './proprietary-formats.js';

// Marks a tree leaf (file) so directory objects can never be mistaken for files.
const LEAF = Symbol('leaf');

// ---- openability probe (the "which files can't be opened" scan) ----------
// The app treats a file as "can't be opened" only when its sole viewer path
// fails outright: bytes that won't read (cloud-only/permission), a HEIC that
// won't convert, or a RAW with neither a usable embedded preview nor a working
// full decode. Everything else it can always show (metadata, a hex dump, or a
// "browser can't preview this" banner), so it counts as openable. This probe
// mirrors that decision file-by-file without rendering anything.
const SCAN_TIMEOUT = 45000;

function withTimeout(p, ms) {
  return new Promise((resolve, reject) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; reject(new Error('timed out')); } }, ms);
    p.then(
      (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } },
      (e) => { if (!done) { done = true; clearTimeout(t); reject(e); } },
    );
  });
}

async function decodes(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    if (bmp && bmp.close) bmp.close();
    return true;
  } catch (_) { return false; }
}

// Index of a 4-char ASCII box type inside a byte buffer (-1 if absent).
function indexOfTag(buf, tag, end) {
  const a = tag.charCodeAt(0), b = tag.charCodeAt(1), c = tag.charCodeAt(2), d = tag.charCodeAt(3);
  const lim = (end == null ? buf.length : end) - 3;
  for (let i = 0; i < lim; i++) {
    if (buf[i] === a && buf[i + 1] === b && buf[i + 2] === c && buf[i + 3] === d) return i;
  }
  return -1;
}

// Decide whether a HEIC/HEIF file is decodable WITHOUT decoding any pixels.
// heic2any (libheif) taking ~1s per file just to confirm it opens is wasteful in
// a folder scan, so instead we read the ISOBMFF container: a HEIF `ftyp` brand
// plus an HEVC image (an `hvcC` config box and a `pict` handler in the `meta`
// box) is exactly what libheif decodes. Returns true (decodable) or null
// (couldn't tell - the caller falls back to a real decode).
//
// The boxes are walked by reading HEADERS ONLY and skipping each box's body via
// offset arithmetic, so the multi-megabyte `mdat` pixel payload is never read.
// This matters because box order varies wildly: iPhone writes `meta` first, but
// Samsung writes `mdat` first and `meta` near the END of the file - a fixed
// front-of-file read would miss it and force the slow decode.
async function heicDecodableFast(file) {
  try {
    const slice = async (off, len) => new Uint8Array(await file.slice(off, off + len).arrayBuffer());
    const tagAt = (buf, o) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
    const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'heif', 'hevm', 'hevs']);
    let p = 0, brandOk = false;
    for (let i = 0; i < 64 && p + 8 <= file.size; i++) {
      const hb = await slice(p, 32);   // box header (room for a 64-bit size / small ftyp)
      if (hb.length < 8) break;
      const dv = new DataView(hb.buffer);
      let size = dv.getUint32(0);
      const type = tagAt(hb, 4);
      let hdr = 8;
      if (size === 1) { if (hb.length < 16) break; size = Number(dv.getBigUint64(8)); hdr = 16; }
      else if (size === 0) { size = file.size - p; }
      if (size < hdr) break;
      if (type === 'ftyp') {
        const fb = size <= hb.length ? hb : await slice(p, Math.min(size, 256));
        for (let q = 8; q + 4 <= Math.min(size, fb.length); q += 4) {
          if (q === 12) continue;   // skip minor_version
          if (HEIF_BRANDS.has(tagAt(fb, q))) { brandOk = true; break; }
        }
      } else if (type === 'meta') {
        if (!brandOk) return null;
        const meta = await slice(p + hdr, Math.min(size - hdr, 1024 * 1024));
        return (indexOfTag(meta, 'hvcC') >= 0 && indexOfTag(meta, 'pict') >= 0) ? true : null;
      }
      p += size;
    }
    return null;   // no meta box reached - let a real decode decide
  } catch (_) { return null; }
}

// Extensions classifyFile() (app.js) routes to a dedicated renderer beyond the
// format SETS checked below. Kept in step with that function - a file whose type
// matches none of these (and isn't sniffable as PDF/ZIP/SVG/text) only ever opens
// as a raw hex dump, which the scan reports as an unrecognised type.
const KNOWN_FIXED_EXTS = new Set([
  'docx', 'xlsx', 'epub', 'pptx', 'pdf', 'stl', '3mf', 'amf', 'obj', 'ply', 'off',
  'step', 'stp', 'iges', 'igs', 'brep', 'edl', 'fcpxml', 'otio', 'lrc', 'mid', 'midi',
  'srt', 'vtt', 'ass', 'ssa', 'gpx', 'kml', 'geojson', 'md', 'markdown', 'cbz', 'cbr', 'cbt', 'cb7',
]);

function extKnown(ext, type) {
  type = (type || '').toLowerCase();
  if (type.startsWith('image/') || type.startsWith('audio/') || type.startsWith('video/')) return true;
  if (type === 'text/csv' || type === 'text/tab-separated-values') return true;
  if (!ext) return false;
  return SVG_EXTS.has(ext) || CSV_EXTS.has(ext) || PHOTO_EXTS.has(ext)
    || AUDIO_EXTS.has(ext) || VIDEO_EXTS.has(ext) || HEIC_EXTS.has(ext) || RAW_EXTS.has(ext)
    || KNOWN_FIXED_EXTS.has(ext) || (ext in FORMATS);
}

// Last-resort sniff for files with an unrecognised extension: mirror the magic
// + text checks handleFile() does before treating a file as unknown, so a real
// PDF/ZIP/SVG or a plain-text file under an odd extension isn't false-flagged.
async function sniffKnown(file) {
  try {
    const buf = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
    if (!buf.length) return false;
    const head = String.fromCharCode.apply(null, buf.slice(0, Math.min(buf.length, 256)));
    if (head.slice(0, 4) === '%PDF') return true;                 // PDF
    if (buf[0] === 0x50 && buf[1] === 0x4B) return true;          // ZIP family (PK)
    if (head.includes('<svg') || head.trimStart().startsWith('<?xml')) return true;
    // Plain text (the app shows UTF-8/UTF-16 text rather than a hex dump): flag as
    // known when the sample is overwhelmingly printable, or NUL-patterned UTF-16.
    const n = Math.min(buf.length, 2048);
    let ctrl = 0, nul = 0;
    for (let i = 0; i < n; i++) {
      const c = buf[i];
      if (c === 0) nul++;
      if (c === 9 || c === 10 || c === 13) continue;
      if (c < 32 || c === 127) ctrl++;
    }
    if (ctrl / n < 0.1) return true;                              // mostly-printable UTF-8
    if (nul / n > 0.2 && nul / n < 0.6) return true;              // UTF-16 (regular NUL bytes)
    return false;
  } catch (_) { return false; }
}

async function probeOpenable(file) {
  if (!file) return { ok: false, reason: 'No file data available' };
  if (file.size === 0) return { ok: true };   // opens, just nothing to show
  if (await probeReadable(file)) {
    return { ok: false, reason: 'Bytes could not be read (cloud-only file, or no permission)' };
  }
  const ext = extOf(file.name);
  if (HEIC_EXTS.has(ext)) {
    // Fast path: confirm it's a decodable HEVC-coded HEIF from the container
    // alone (~1ms), instead of a full ~1s libheif pixel decode per file.
    const fast = await heicDecodableFast(file);
    if (fast === true) return { ok: true };
    if (await decodes(file)) return { ok: true };   // Safari decodes HEIC natively
    // Inconclusive or structurally suspect (fast === null/false): confirm with a
    // real decode so a genuinely-broken file is still caught accurately.
    try {
      const m = await import('./photo-convert.js');
      const jpg = await withTimeout(m.convertHeic(file), SCAN_TIMEOUT);
      if (await decodes(jpg)) return { ok: true };
    } catch (_) {}
    return { ok: false, reason: 'HEIC/HEIF could not be decoded' };
  }
  if (RAW_EXTS.has(ext)) {
    const m = await import('./photo-convert.js');
    // Sigma Foveon X3F embeds a full-res JPEG in its container (not findable by
    // the TIFF/byte-scan extractors) - read it straight from the X3F directory.
    if (ext === 'x3f') {
      try { const p = await m.extractX3fPreview(file); if (await decodes(p)) return { ok: true }; } catch (_) {}
    }
    // Fast path: a JPEG preview baked into the RAW (no WASM needed).
    let prev = null;
    try { const j = await m.extractRawJpegs(file, { max: 1 }); if (j && j[0]) prev = j[0].blob; } catch (_) {}
    if (!prev) { try { prev = await m.extractRawPreview(file); } catch (_) {} }
    if (prev && await decodes(prev)) return { ok: true };
    // Slow path 1: ImageMagick-WASM.
    try {
      const jpg = await withTimeout(m.convertWithImageMagick(file, null), SCAN_TIMEOUT);
      if (await decodes(jpg)) return { ok: true };
    } catch (_) {}
    // Slow path 2: full libraw demosaic - the viewer's last resort, so the scan
    // verdict matches what actually happens when you open the file.
    try {
      const jpg = await withTimeout(m.demosaicRaw(file, null), SCAN_TIMEOUT);
      if (await decodes(jpg)) return { ok: true };
    } catch (_) {}
    return { ok: false, reason: 'No usable preview and the RAW could not be decoded' };
  }
  // Unrecognised type: the app can only show a raw hex dump. Sniff magic/text
  // first so a mislabelled-but-real PDF/ZIP/SVG/text file isn't flagged - and
  // content-detect git objects (loose objects are extensionless).
  if (!extKnown(ext, file.type)) {
    if (await sniffKnown(file)) return { ok: true };
    try { const { sniffGitObject } = await import('./gitobject.js'); if (await sniffGitObject(file)) return { ok: true }; } catch (_) {}
    return { ok: false, reason: 'Unrecognised file type - opens only as a raw hex dump' };
  }
  return { ok: true };
}

function renderScanReport(host, total, failures, cancelled, checked) {
  host.innerHTML = '';
  if (!failures.length) {
    host.appendChild(el('p', { class: 'anr-scan-ok' },
      cancelled
        ? 'Checked ' + checked + ' of ' + total + ' files before stopping - all of them open.'
        : 'All ' + total + ' files open in Analyser.'));
    return;
  }
  host.appendChild(el('p', { class: 'anr-scan-bad' },
    cancelled
      ? checked + ' of ' + total + ' files checked - ' + failures.length + ' can’t be opened:'
      : failures.length + ' of ' + total + ' files can’t be opened:'));
  const list = el('ul', { class: 'anr-scan-list' });
  for (const f of failures) {
    list.appendChild(el('li', {}, [
      el('span', { class: 'anr-scan-path' }, f.path),
      el('span', { class: 'anr-scan-reason' }, f.reason || 'Could not be opened'),
    ]));
  }
  host.appendChild(list);
}

function readEntries(reader) {
  return new Promise((resolve, reject) => {
    const all = [];
    (function read() {
      reader.readEntries(entries => {
        if (!entries.length) return resolve(all);
        all.push(...entries);
        read();
      }, reject);
    })();
  });
}

function entryToFile(entry) {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function walk(entry, path) {
  if (entry.isFile) {
    try {
      const file = await entryToFile(entry);
      return [{ path: path + entry.name, size: file.size, file }];
    } catch (_) {
      return [];
    }
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const children = await readEntries(reader);
    const results = [];
    for (const child of children) {
      results.push(...await walk(child, path + entry.name + '/'));
    }
    return results;
  }
  return [];
}

export async function walkItems(dataTransfer) {
  const items = dataTransfer.items;
  if (!items) return null;
  let hasFolder = false;
  const entries = [];
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
    if (entry && entry.isDirectory) { hasFolder = true; entries.push(entry); }
  }
  if (!hasFolder) return null;
  const files = [];
  for (const entry of entries) {
    files.push(...await walk(entry, ''));
  }
  return files;
}

function extOf(name) {
  const m = name.match(/\.([^./]+)$/);
  return m ? m[1].toLowerCase() : '';
}

export function renderFolder(files, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';

  const folderName = files.length ? files[0].path.split('/')[0] : 'folder';
  const items = normalizeFolder(files);

  // Build a lookup from path → original file object for click-to-analyse
  const fileByPath = {};
  for (const f of files) fileByPath[f.path] = f.file;

  // Summary + breakdown cards (with folder name as extra row) - rendered
  // immediately so the Overview/File-types paint instantly for big folders.
  renderBreakdownCards(items, resultsEl, [
    row('Name', folderName)
  ]);

  // Openability check: walk every file and flag the ones the app can't open.
  if (files.length) {
    const scanCard = el('div', { class: 'anr-card anr-folder-scan' });
    scanCard.appendChild(el('h3', {}, 'Openability check'));
    scanCard.appendChild(el('p', { class: 'anr-folder-scan-intro' },
      'Check every file and flag the ones Analyser can’t open or doesn’t recognise - unknown file types, cloud-only files that won’t download, undecodable HEIC, and RAW with no usable preview. Large RAW folders may load the full decoder, so this can take a while.'));
    const scanBtn = el('button', { type: 'button', class: 'anr-btn anr-folder-scan-btn' }, 'Check which files open (' + files.length + ')');
    const scanBar = asciiBar({ fit: true });
    const scanProgress = el('div', { class: 'anr-folder-scan-progress', hidden: '' }, scanBar);
    const scanStatus = el('div', { class: 'anr-folder-scan-status', hidden: '' });
    const scanReport = el('div', { class: 'anr-folder-scan-report' });
    scanCard.appendChild(scanBtn);
    scanCard.appendChild(scanProgress);
    scanCard.appendChild(scanStatus);
    scanCard.appendChild(scanReport);
    resultsEl.appendChild(scanCard);

    let scanning = false, cancelScan = false;
    scanBtn.addEventListener('click', async () => {
      if (scanning) { cancelScan = true; scanBtn.textContent = 'Stopping…'; return; }
      scanning = true; cancelScan = false;
      scanReport.innerHTML = '';
      scanProgress.hidden = false;
      scanBar.set(0);
      scanStatus.hidden = false;
      scanBtn.textContent = 'Stop checking';
      const failures = [];
      let i = 0, lastPaint = performance.now();
      for (const f of files) {
        if (cancelScan) break;
        i++;
        scanBar.set(i / files.length);
        scanStatus.textContent = 'Checking ' + i + ' / ' + files.length + ' - ' + f.path;
        let res;
        try { res = await probeOpenable(f.file); }
        catch (e) { res = { ok: false, reason: 'Unexpected error: ' + ((e && e.message) || e) }; }
        if (res && !res.ok) failures.push({ path: f.path, size: f.size, reason: res.reason });
        // Throttle repaints so a folder of cheap (non-image) files doesn't pay a
        // frame each - yield only when ~a frame has passed since the last paint.
        const now = performance.now();
        if (now - lastPaint > 60) {
          await new Promise((r) => requestAnimationFrame(() => r()));
          lastPaint = performance.now();
        }
      }
      scanning = false;
      scanProgress.hidden = true;
      scanStatus.hidden = true;
      scanBtn.textContent = 'Re-check (' + files.length + ')';
      renderScanReport(scanReport, files.length, failures, cancelScan, i);
    });
  }

  // Contents (treemap/tree) can be heavy to build for a large folder, so show a
  // placeholder with a loading bar and defer the real build to the next frames.
  const pendingCard = el('div', { class: 'anr-card' });
  pendingCard.appendChild(el('h3', {}, 'Contents'));
  pendingCard.appendChild(inlineLoader('Building file map…'));
  // Sit the placeholder at the anchor slot (between Overview and File types) so
  // it occupies the spot the real tree/treemap will take when they finish.
  const contentsSlot = resultsEl.querySelector('.anr-contents-slot');
  if (contentsSlot) resultsEl.insertBefore(pendingCard, contentsSlot);
  else resultsEl.appendChild(pendingCard);

  // Open a file: nested archive → archive view; everything else → main analyser.
  // Before leaving, register a Back-bar restore that re-renders this folder so the
  // breadcrumb can step back to it one level at a time.
  function pushBack() {
    if (window._anrPushNav) {
      window._anrPushNav(folderName, () => { resultsEl.hidden = false; renderFolder(files, resultsEl); });
    }
  }
  function openFile(file) {
    if (!file) return;
    const ext = extOf(file.name);
    if (ARCHIVE_EXTS.has(ext)) {
      import('./archive.js').then(m => {
        pushBack();
        resultsEl.innerHTML = '';
        m.renderArchive(file, resultsEl);
      });
    } else if (window._anrHandleFile) {
      pushBack();
      window._anrHandleFile(file, { nested: true });
    }
  }

  // Treemap click → normalized item carries .file / .path directly.
  function onFileClick(item) {
    openFile(item.file || fileByPath[item.path]);
  }

  // Tree click → the leaf object carries the File directly (no name matching).
  function onTreeFileClick(_key, leaf) {
    if (leaf && leaf.file) openFile(leaf.file);
  }

  // Defer the (potentially heavy) tree build + treemap layout by two frames so
  // the Overview and File-types cards paint first, then swap in the real card.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    // Leaves are tagged with a Symbol so directory objects (plain {}) can never
    // be mistaken for files, even if a file is literally named "name"/"size".
    const tree = {};
    for (const f of files) {
      const parts = f.path.split('/');
      let node = tree;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!node[parts[i]] || typeof node[parts[i]] !== 'object' || node[parts[i]][LEAF]) node[parts[i]] = {};
        node = node[parts[i]];
      }
      node[parts[parts.length - 1]] = { [LEAF]: true, size: f.size, file: f.file, path: f.path };
    }

    pendingCard.remove();
    renderViewToggle(resultsEl, items, tree, {
      isDir: (v) => v !== null && typeof v === 'object' && !v[LEAF],
      fileSize: (v) => v.size,
      copyPath: (_key, leaf) => leaf && leaf.path,
      onFileClick: onTreeFileClick
    }, onFileClick);
  }));
}
