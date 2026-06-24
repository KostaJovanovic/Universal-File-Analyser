/* Analyser - folder overview
   Recursively walks a dropped folder via webkitGetAsEntry
   and renders a treemap + summary using the shared folder/archive modules. */

import { el, row, fmtBytes, buildFileTree, inlineLoader, probeReadable, asciiBar, copyText } from '../core/util.js';
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

function extKnown(file) {
  // Prefer the real drop-path classifier (exposed by app.js as window._anrClassify)
  // so the scan's verdict can never drift from what actually opens - it already
  // knows every dedicated-renderer extension (glb, doc, gltf, pdn, the Office/ODF
  // variants, ...) that this file's local sets would otherwise miss. Fall back to
  // the sets only if the hook is absent (folder.js used outside the app).
  if (typeof window !== 'undefined' && typeof window._anrClassify === 'function') {
    try { return window._anrClassify(file) !== 'unknown'; } catch (_) {}
  }
  const ext = extOf(file.name);
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/') || type.startsWith('audio/') || type.startsWith('video/')) return true;
  if (type === 'text/csv' || type === 'text/tab-separated-values') return true;
  if (!ext) return false;
  return SVG_EXTS.has(ext) || CSV_EXTS.has(ext) || PHOTO_EXTS.has(ext)
    || AUDIO_EXTS.has(ext) || VIDEO_EXTS.has(ext) || HEIC_EXTS.has(ext) || RAW_EXTS.has(ext)
    || KNOWN_FIXED_EXTS.has(ext) || (ext in FORMATS);
}

// Last-resort magic/CSV sniff for files with an unrecognised extension - the
// FALLBACK mirror used only when the app's shared resolver (window._anrResolveContent)
// is absent (folder.js run outside the app). In the app, probeOpenable calls that
// resolver instead, so the two can never drift.
//
// No text rule here on purpose - readable text is handled separately by
// looksLikeText() in probeOpenable, so an extensionless plain-text file (COPYING,
// README, Makefile) passes (it opens as text), while a binary with no recognised
// type is flagged (it opens only as a hex dump). git loose objects are
// content-detected via sniffGitObject.
async function sniffKnown(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 128).arrayBuffer());
    if (!head.length) return false;
    const a = (s, l) => Array.from(head.slice(s, s + l)).map((c) => String.fromCharCode(c)).join('');
    if (a(0, 4) === '%PDF') return true;                              // PDF
    if (head[0] === 0x50 && head[1] === 0x4B) return true;            // ZIP family (PK)
    // Raise3D ideaMaker / DJI firmware: distinctive signatures shipped under a
    // generic .bin, routed by magic in handleFile().
    if (a(0, 12) === 'IDEA - MAKER' || a(0, 14) === 'IEDA - PROFILE') return true;
    if (head[0] === 0x78 && head[1] === 0x56 && head[2] === 0x34 && head[3] === 0x12 &&
        head[12] === 0x44 && head[13] === 0x4A && head[14] === 0x49) return true;   // DJI firmware
    const headStr = a(0, Math.min(head.length, 128));
    // SVG and extensionless HTML - same tests handleFile() uses (note: a bare
    // <?xml without an <svg> root is NOT routed by the app, so it isn't here).
    if (headStr.trimStart().startsWith('<svg') || (headStr.includes('<svg') && headStr.includes('xmlns'))) return true;
    if (/^\s*(<!doctype html|<html[\s>])/i.test(headStr)) return true;
    // CSV heuristic: consistent comma/tab counts across the first lines (mirrors
    // handleFile's extensionless-CSV detection).
    const peekText = await file.slice(0, 2048).text().catch(() => '');
    const lines = peekText.split('\n').filter((l) => l.trim()).slice(0, 10);
    if (lines.length >= 2) {
      const commas = lines.map((l) => (l.match(/,/g) || []).length);
      const tabs = lines.map((l) => (l.match(/\t/g) || []).length);
      const avgCommas = commas.reduce((s, n) => s + n, 0) / commas.length;
      const avgTabs = tabs.reduce((s, n) => s + n, 0) / tabs.length;
      const commaConsistent = avgCommas >= 1 && commas.every((c) => Math.abs(c - avgCommas) <= 1);
      const tabConsistent = avgTabs >= 1 && tabs.every((c) => Math.abs(c - avgTabs) <= 1);
      if (commaConsistent || tabConsistent) return true;
    }
    return false;
  } catch (_) { return false; }
}

async function probeOpenable(file) {
  if (!file) return { ok: false, reason: 'No file data available', cloud: true };
  if (file.size === 0) return { ok: true };   // opens, just nothing to show
  if (await probeReadable(file)) {
    return { ok: false, reason: 'Bytes could not be read (cloud-only file, or no permission)', cloud: true };
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
  // A file the extension classifier sends to a dedicated renderer opens as its
  // type (HEIC/RAW were decided above). Everything else - an unrecognised
  // extension OR no extension at all - can only open by content or as a text/hex
  // view, so probe the bytes and decide.
  const cls = classifyOf(file);
  const openableByExt = cls ? (cls !== 'unknown' && cls !== 'extensionless') : extKnown(file);
  if (openableByExt) return { ok: true };

  // Resolve the true type from content with the SAME resolver the drop path uses
  // (window._anrResolveContent), so the scan can't disagree with what opens - this
  // covers images saved under an odd/absent extension, the niche game/dev magics,
  // git objects and CSV. Fall back to folder.js's local mirror if the hook is
  // absent (used outside the app).
  if (typeof window !== 'undefined' && window._anrResolveContent) {
    try { const r = await window._anrResolveContent(file); if (r && r.kind && r.kind !== 'unknown') return { ok: true }; } catch (_) {}
  } else {
    if (await sniffKnown(file)) return { ok: true };
    try { const { sniffGitObject } = await import('./gitobject.js'); if (await sniffGitObject(file)) return { ok: true }; } catch (_) {}
  }
  // Readable text opens fine (an extensionless LICENSE / README / Makefile shows
  // as text); a binary with no recognised type only opens as a raw hex dump, so
  // flag it - including extensionless binaries, which used to slip through.
  if (await looksLikeText(file)) return { ok: true };
  return { ok: false, reason: extOf(file.name)
    ? 'Unrecognised file type - opens only as a raw hex dump'
    : 'No extension and unreadable binary content - opens only as a hex dump' };
}

// The real drop-path classifier (window._anrClassify), guarded - '' when the hook
// is absent (folder.js used outside the app). Lets probeOpenable tell an
// extensionless file (which classifies as 'extensionless', not 'unknown') apart
// from a file a dedicated renderer handles, so the former gets a content probe.
function classifyOf(file) {
  if (typeof window !== 'undefined' && typeof window._anrClassify === 'function') {
    try { return window._anrClassify(file) || ''; } catch (_) {}
  }
  return '';
}

// Whether a file opens as readable text rather than a raw hex dump - mirrors the
// unknown/extensionless viewer's rule (UTF-16 BOM, or >85% printable bytes).
// Prefers the app's shared implementation so the two never diverge.
async function looksLikeText(file) {
  if (typeof window !== 'undefined' && window._anrReadableText) {
    try { return await window._anrReadableText(file); } catch (_) {}
  }
  try {
    const b = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
    if (!b.length) return true;
    if (b.length >= 2 && ((b[0] === 0xFF && b[1] === 0xFE) || (b[0] === 0xFE && b[1] === 0xFF))) return true;
    let p = 0;
    for (const c of b) if (c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0x7E)) p++;
    return p / b.length > 0.85;
  } catch (_) { return false; }
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

  // "Copy paths" - one representative path per unsupported format, skipping the
  // cloud-only / unreadable failures (those aren't a format problem, just files
  // that never downloaded). Format key = extension, or the lowercased basename
  // for extensionless files (so COPYING / LICENSE / Makefile each count once but
  // duplicate copies across sub-folders collapse to a single path).
  const formatKey = (path) => {
    const name = path.split('/').pop() || path;
    const ext = extOf(name);
    return ext ? ext : name.toLowerCase();
  };
  const samplePaths = [];
  const seenFmts = new Set();
  for (const f of failures) {
    if (f.cloud) continue;
    const k = formatKey(f.path);
    if (seenFmts.has(k)) continue;
    seenFmts.add(k);
    samplePaths.push(f.path);
  }
  if (samplePaths.length) {
    const copyBtn = el('button', { type: 'button', class: 'anr-btn anr-scan-copy' },
      'Copy paths (' + samplePaths.length + ' format' + (samplePaths.length === 1 ? '' : 's') + ')');
    copyBtn.title = 'Copy one file path per unrecognised format (cloud-only files skipped)';
    copyBtn.addEventListener('click', async () => {
      const ok = await copyText(samplePaths.join('\n'));
      copyBtn.textContent = ok
        ? 'Copied ' + samplePaths.length + ' path' + (samplePaths.length === 1 ? '' : 's') + ' ✓'
        : 'Press Ctrl+C';
      setTimeout(() => {
        copyBtn.textContent = 'Copy paths (' + samplePaths.length + ' format' + (samplePaths.length === 1 ? '' : 's') + ')';
      }, 2200);
    });
    host.appendChild(copyBtn);
  }

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

  // KiCad project detection (done early): when the folder is a KiCad project, the
  // combined board/schematic view is the main thing, so the generic folder
  // analysis (breakdown, treemap, openability) is rendered into a collapsible
  // container - `host` - that sits behind a "Show folder analysis" button, instead
  // of straight into resultsEl.
  const KI_RE = /(\.kicad_(pcb|sch|sym|mod|pro|prl)$|\.wbk$|[\\/](fp-lib-table|sym-lib-table|fp-info-cache)$|^(fp-lib-table|sym-lib-table|fp-info-cache)$)/i;
  const KI_DOC_RE = /\.kicad_(pcb|sch|pro)$/i;
  const kiFiles = files.filter((f) => KI_RE.test(f.path) || KI_RE.test(f.path.split('/').pop() || ''));
  const isKiProject = kiFiles.some((f) => KI_DOC_RE.test(f.path)) && kiFiles.length >= 2;
  const analysisHost = isKiProject ? el('div', { class: 'anr-folder-analysis', hidden: '' }) : null;
  const host = analysisHost || resultsEl;

  // Summary + breakdown cards (with folder name as extra row) - rendered
  // immediately so the Overview/File-types paint instantly for big folders.
  renderBreakdownCards(items, host, [
    row('Name', folderName)
  ]);

  // Altium project: if the folder holds Altium documents, stitch them into one
  // combined cross-probing view above the generic breakdown. altium.js (and its
  // CFBF reader) is loaded lazily, only for folders that actually need it.
  const ALT_RE = /\.(prjpcb|prjpcbstructure|schdoc|schlib|pcbdoc|pcblib|epw|schdocpreview|pcbdocpreview)$/i;
  const ALT_DOC_RE = /\.(schdoc|schlib|pcbdoc|pcblib|prjpcb)$/i;
  const altFiles = files.filter((f) => ALT_RE.test(f.path));
  if (altFiles.some((f) => ALT_DOC_RE.test(f.path)) && altFiles.length >= 2) {
    const slot = el('div', { class: 'anr-card' }, inlineLoader('Building combined Altium project view…'));
    resultsEl.insertBefore(slot, resultsEl.firstChild);
    import('./altium.js')
      .then((m) => m.buildAltiumProjectCard(altFiles, folderName))
      .then((cardEl) => { slot.replaceWith(cardEl); })
      .catch(() => { slot.remove(); });
  }

  // KiCad project: same idea - if the folder holds KiCad documents, stitch the
  // schematic + board + libraries into one cross-probing view. kicad.js loads
  // lazily, only for folders that actually contain KiCad files.
  if (isKiProject) {
    const slot = el('div', { class: 'anr-card' }, inlineLoader('Building combined KiCad project view…'));
    resultsEl.insertBefore(slot, resultsEl.firstChild);
    import('./kicad.js')
      .then((m) => m.buildKicadProjectCard(kiFiles, folderName))
      .then((cardEl) => { slot.replaceWith(cardEl); })
      .catch(() => { slot.remove(); });
    // The folder analysis lives in `host` (analysisHost) - tuck it behind a button
    // below the project view.
    const toggle = el('button', { type: 'button', class: 'anr-btn anr-folder-analysis-toggle' }, 'Show folder analysis');
    toggle.addEventListener('click', () => {
      const reveal = analysisHost.hidden;
      analysisHost.hidden = !reveal;
      toggle.textContent = reveal ? 'Hide folder analysis' : 'Show folder analysis';
    });
    resultsEl.appendChild(toggle);
    resultsEl.appendChild(analysisHost);
  }

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
    host.appendChild(scanCard);

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
        if (res && !res.ok) failures.push({ path: f.path, size: f.size, reason: res.reason, cloud: !!res.cloud });
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
  const contentsSlot = host.querySelector('.anr-contents-slot');
  if (contentsSlot) host.insertBefore(pendingCard, contentsSlot);
  else host.appendChild(pendingCard);

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
    renderViewToggle(host, items, tree, {
      isDir: (v) => v !== null && typeof v === 'object' && !v[LEAF],
      fileSize: (v) => v.size,
      copyPath: (_key, leaf) => leaf && leaf.path,
      onFileClick: onTreeFileClick
    }, onFileClick);
  }));
}
