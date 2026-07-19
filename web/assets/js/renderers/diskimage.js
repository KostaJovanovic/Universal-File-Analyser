/* Analyser - raw disk-image browser
   Mounts a raw FAT12/16/32 filesystem image and lists its files as a browsable
   tree + treemap, exactly like a folder or archive - click any file to analyse
   it. Handles both a bare "superfloppy" (a FAT boot sector at offset 0, e.g. an
   SD-card / USB-stick image) and a whole-disk image behind an MBR partition
   table (the first FAT partition is browsed; every partition is listed).

   Everything stays on-device: the image is read once into memory and parsed in
   place (diskimage-fat.js), and each file's bytes are sliced out lazily only when
   you open it. When the image holds no FAT filesystem we can read (an ISO, ext4,
   NTFS, DMG, firmware blob, ...) it degrades to the normal identification card,
   with the partition table shown when present. */

import { el, row, rowHelp, fmtBytes, errorCard, integrityCard, isUnreadableError, cloudFileWarning } from '../core/util.js';
import { renderHandleTree } from './archive.js';
import { carveImages, repairJpeg } from './photo-recover.js';
import {
  looksLikeFatBoot, parseFatVolume, parseMbr, otherFsLabel,
  FAT_PART_TYPES, PART_TYPE_NAMES, MAX_ENTRIES,
} from './diskimage-fat.js';

// Mirrors renderArchive's ceiling: above this an in-browser ArrayBuffer is
// impractical, so decline rather than crash the tab trying to allocate it.
const MAX_IMAGE_BYTES = 1_500_000_000;

// The raw scan collects up to SCAN_CARVE hits (a used card is dominated by tiny
// thumbnails and video frames), then the gallery shows the MAX_CARVE largest so
// every full-size photo survives the cap and the DOM stays responsive. The "Hide
// frames" toggle, not a tight cap, is what declutters the frame-heavy view.
const MAX_CARVE = 2000;
const SCAN_CARVE = 20000;
// A carved image no bigger than this on its longer side is treated as a video
// frame or thumbnail, not a photo: MJPEG AVI frames (320x240 / 640x480, including
// the many orphaned ones left by deleted clips) and EXIF/THM thumbnails all fall
// here, while real stills (e.g. 2272x1704) sit well above it. Drives the toggle.
const FRAME_MAXDIM = 640;
// A carve larger than this is almost always a false signature match (random data
// that looked like a header with a huge declared length) - skip it rather than
// try to allocate a multi-hundred-MB blob that will never decode.
const MAX_CARVE_BYTES = 64 * 1024 * 1024;
const CARVE_MIME = { jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
const CARVE_EXT  = { jpeg: 'jpg', png: 'png', gif: 'gif', webp: 'webp', bmp: 'bmp' };

// ---------- main render ----------
export async function renderDiskImage(file, resultsEl, opts = {}) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading disk image "${file.name}"…`));

  if (file.size > MAX_IMAGE_BYTES) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard(
      'This disk image is ' + fmtBytes(file.size) + ' - too large to open in the browser without exhausting memory. The file was not read.'));
    return;
  }

  let img;
  try {
    img = new Uint8Array(await file.arrayBuffer());
  } catch (e) {
    resultsEl.innerHTML = '';
    if (isUnreadableError(e)) resultsEl.appendChild(cloudFileWarning(file));
    else resultsEl.appendChild(errorCard('Could not read file: ' + (e && e.message)));
    return;
  }

  // Work out the layout: a bare FAT boot sector at offset 0 (superfloppy), or a
  // partitioned disk (MBR) whose FAT partitions we can browse.
  const partitions = looksLikeFatBoot(img, 0) ? null : parseMbr(img);
  let vol = null;
  let layout = 'Bare filesystem (no partition table)';
  let volStart = 0;

  if (!partitions) {
    vol = parseFatVolume(img, 0);
  } else {
    layout = 'MBR partition table (' + partitions.length + ' partition' + (partitions.length === 1 ? '' : 's') + ')';
    for (const p of partitions) {
      if (!FAT_PART_TYPES.has(p.type)) continue;
      const start = p.lba * 512;
      if (start >= img.length) continue;
      const v = parseFatVolume(img, start);
      if (v) { vol = v; volStart = start; break; }   // browse the first readable FAT partition
    }
  }

  resultsEl.innerHTML = '';

  // Couldn't mount a FAT filesystem: fall back to the identification card (what a
  // .img got before), plus the partition table / detected-filesystem context.
  if (!vol || !vol.entries.length) {
    const otherFs = otherFsLabel(img, volStart) || (partitions ? null : otherFsLabel(img, 0));
    const note = el('div', { class: 'anr-card' });
    note.appendChild(el('h3', {}, 'Disk image'));
    const t = el('table', { class: 'anr-readout' });
    t.appendChild(row('Name', file.name));
    t.appendChild(row('Size', fmtBytes(file.size) + '   (' + file.size.toLocaleString() + ' bytes)'));
    t.appendChild(row('Layout', layout));
    if (otherFs) t.appendChild(rowHelp('Filesystem', otherFs, 'The filesystem detected inside the image. Only FAT12/16/32 filesystems can currently be browsed here; this one is identified but not opened.'));
    note.appendChild(t);
    note.appendChild(el('p', { class: 'anr-hint', style: 'margin-top:10px;' },
      vol && !vol.entries.length
        ? 'A FAT filesystem was found but it holds no readable files (empty, or the directory area is damaged).'
        : 'This image does not contain a FAT12/16/32 filesystem that Analyser can browse yet. It is identified below.'));
    resultsEl.appendChild(note);
    if (partitions) resultsEl.appendChild(partitionCard(partitions));
    // Even when the filesystem can't be mounted (ISO/NTFS/ext, or a damaged
    // directory) the raw bytes may still hold whole photos - carve and show them.
    carvedImageGallery(img, file, resultsEl);
    resultsEl.appendChild(integrityCard(file));
    // Hand off to the generic identifier so nothing is lost vs. the old behaviour.
    try {
      const { renderProprietary } = await import('./proprietary.js');
      const host = el('div', {});
      resultsEl.appendChild(host);
      await renderProprietary(file, host, 'img');
    } catch (_) {}
    return;
  }

  // A browsable FAT volume: summary rows for renderHandleTree's Overview card.
  const summaryRows = [
    row('Application', 'Disk image (' + vol.type + ')'),
    row('Name', file.name),
    row('Image size', fmtBytes(file.size) + '   (' + file.size.toLocaleString() + ' bytes)'),
    rowHelp('Layout', layout, 'Whether the image is a bare filesystem or a partitioned disk. Partitioned images are opened at their first FAT partition.'),
    rowHelp('Filesystem', vol.type + (vol.oem ? ' · ' + vol.oem : ''), 'The FAT variant (FAT12/16/32) and the OEM name recorded in the boot sector by the tool that formatted the volume.'),
  ];
  if (vol.volumeLabel) summaryRows.push(row('Volume label', vol.volumeLabel));
  summaryRows.push(rowHelp('Cluster size', fmtBytes(vol.bytesPerCluster), 'The allocation unit of the filesystem. Every file occupies a whole number of clusters, so small files still take at least one.'));
  if (vol.capacityBytes) {
    const usedPct = Math.round((1 - vol.freeBytes / vol.capacityBytes) * 100);
    summaryRows.push(rowHelp('Used space', fmtBytes(vol.capacityBytes - vol.freeBytes) + ' of ' + fmtBytes(vol.capacityBytes) + '  (' + usedPct + '%)',
      'How much of the filesystem is allocated, from the FAT free-cluster count.'));
  }
  if (vol.truncated) summaryRows.push(rowHelp('⚠ Listing truncated', 'over ' + MAX_ENTRIES.toLocaleString() + ' entries', 'The image holds more entries than are listed here; browsing was capped to keep the page responsive.'));

  // Synthetic libarchive-shaped handle so we can reuse the archive tree/treemap.
  const handle = { entries: vol.entries, close() {} };
  renderHandleTree(handle, vol.entries, file, resultsEl, { label: 'Disk image', summaryRows });

  // Gallery of every image carved straight from the raw sectors - the live
  // photos above plus any deleted/orphaned ones the directory no longer lists.
  carvedImageGallery(img, file, resultsEl);

  if (partitions) resultsEl.appendChild(partitionCard(partitions));
  resultsEl.appendChild(integrityCard(file));
}

// ---------- carved-image gallery ----------
// Scan the whole raw image for embedded image signatures (JPEG/PNG/GIF/WebP/BMP)
// and show each as a lazily-decoded thumbnail with Analyse / Download. This finds
// photos regardless of the filesystem - including deleted and orphaned files that
// are no longer in any directory, the usual win when a card's directory is
// corrupt. Contiguous carve only, so a fragmented file may come back partly
// garbled. The heavy scan is deferred one frame so the tree paints first.
function carvedImageGallery(img, file, resultsEl) {
  const card = el('div', { class: 'anr-card anr-collapsible' });
  card.appendChild(el('h3', {}, 'Images in this disk'));
  const body = el('div', {});
  body.appendChild(el('p', { class: 'anr-hint' }, 'Scanning the raw sectors for embedded images…'));
  card.appendChild(body);
  resultsEl.appendChild(card);

  requestAnimationFrame(() => setTimeout(() => {
    let carved = [];
    try { carved = carveImages(img, { max: SCAN_CARVE }); } catch (_) { carved = []; }

    // Drop false positives: implausibly large extents (a bad signature match) and
    // BMPs whose 2-byte 'BM' magic isn't backed by a real DIB header - both are
    // rife when scanning raw disk data and would otherwise dominate the gallery.
    carved = carved.filter((c) => {
      const len = c.end - c.start;
      if (len < 512 || len > MAX_CARVE_BYTES) return false;
      if (c.format === 'bmp' && !plausibleBmp(img, c.start)) return false;
      return true;
    });

    body.innerHTML = '';
    if (!carved.length) {
      body.appendChild(el('p', { class: 'anr-hint', style: 'margin:0;' }, 'No embedded images were found in the raw sectors.'));
      return;
    }

    // Classify the clutter the toggle hides: MJPEG video frames (including the
    // orphaned ones left behind by deleted AVI clips, whose container is gone) and
    // EXIF/THM thumbnails are all small; real photos are not. Size is the reliable
    // signal - the deleted-clip frames sit in no surviving AVI, so a container
    // scan would miss them.
    for (const c of carved) c.frame = !!(c.width && c.height && Math.max(c.width, c.height) <= FRAME_MAXDIM);

    // Largest first: a used card is dominated by tiny thumbnails and video
    // frames; sorting by extent floats the real full-size photos to the top so
    // the display cap never buries them.
    carved.sort((a, b) => (b.end - b.start) - (a.end - a.start));
    const total = carved.length;
    const shown = Math.min(total, MAX_CARVE);
    const list = carved.slice(0, shown);
    const frameShown = list.filter((c) => c.frame).length;
    // Publish this gallery as the current one so the lightbox arrows can step
    // through it (only one disk image is open at a time).
    _carveList = list; _carveImg = img; _carveFile = file;

    body.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 12px;' },
      'Found ' + total + (total >= SCAN_CARVE ? '+' : '') + ' image' + (total === 1 ? '' : 's')
      + ' by scanning every sector for image signatures'
      + (total > shown ? ' - showing the ' + shown + ' largest (biggest first)' : '')
      + '. This includes deleted and orphaned photos no longer in the directory, plus MJPEG video frames and thumbnails, so it can show more - or different - files than the tree above. Fragmented files may come back partly garbled.'));

    const grid = el('div', { style: 'display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:12px;' });

    // Toggle to hide the small video frames / thumbnails (shown by default),
    // leaving just the full-size photos.
    if (frameShown) {
      let hidden = false;
      const toggle = el('button', { type: 'button', class: 'anr-btn anr-btn-sm', style: 'margin:0 0 12px;' },
        'Hide frames & thumbnails (' + frameShown + ')');
      toggle.addEventListener('click', () => {
        hidden = !hidden;
        for (const cell of grid.children) {
          if (cell.dataset && cell.dataset.frame === '1') cell.style.display = hidden ? 'none' : '';
        }
        toggle.textContent = (hidden ? 'Show' : 'Hide') + ' frames & thumbnails (' + frameShown + ')';
      });
      body.appendChild(toggle);
    }

    body.appendChild(grid);

    // One observer for the whole gallery: build each thumbnail only as it scrolls
    // into view, then revoke its full-size blob so memory stays bounded.
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        io.unobserve(en.target);
        renderCarveThumb(en.target);
      }
    }, { rootMargin: '300px' });

    for (let k = 0; k < list.length; k++) grid.appendChild(carveCell(img, file, list[k], k, io));
  }, 0));
}

// Current gallery state, so the lightbox arrows / keyboard can step through it.
let _carveLbUrl = null;
let _carveList = null, _carveImg = null, _carveFile = null;

// Open carved image `pos` full-size in the shared photo lightbox, with prev/next
// arrows (← / → keys too), Analyse and Download actions, and the alpha
// checkerboard so a partly recovered image's transparent region shows. The
// full-resolution blob is built on demand (thumbnails revoke theirs after
// decoding) and only one lightbox URL is kept alive at a time.
function openCarveLightboxAt(pos) {
  const list = _carveList;
  if (!list || !list.length) return;
  const n = list.length;
  pos = ((pos % n) + n) % n;                 // wrap around at the ends
  const c = list[pos], img = _carveImg, file = _carveFile;
  const f = carvedFile(img, c, pos);
  const prevUrl = _carveLbUrl;
  const url = URL.createObjectURL(f);
  _carveLbUrl = url;
  const dims = (c.width && c.height) ? c.width + ' × ' + c.height : '';
  const meta = (pos + 1) + ' / ' + n + '  ·  ' + f.name + (dims ? '  ·  ' + dims : '')
    + '  ·  ' + fmtBytes(c.end - c.start) + (c.complete ? '' : '  · partial');
  import('./photo.js').then(({ openLightbox, closeLightbox }) => {
    const nav = {
      onPrev: () => openCarveLightboxAt(pos - 1),
      onNext: () => openCarveLightboxAt(pos + 1),
      checker: true,
      actions: [
        { label: 'Analyse', onClick: () => { closeLightbox(); analyseCarve(img, c, pos, file); } },
        { label: 'Download', onClick: () => downloadCarve(img, c, pos) },
      ],
    };
    openLightbox(url, f.name, meta, null, true, false, nav);
    if (prevUrl) URL.revokeObjectURL(prevUrl);
  }).catch(() => { if (prevUrl) URL.revokeObjectURL(prevUrl); });
}

// Run the full analysis on a carved region (registers a Back-nav restore first).
function analyseCarve(img, c, idx, file) {
  const f = carvedFile(img, c, idx);
  if (window._anrPushNav) window._anrPushNav(file.name || 'disk image', () => { if (window._anrHandleFile) window._anrHandleFile(file, {}); });
  if (window._anrHandleFile) window._anrHandleFile(f, { nested: true });
}

// Download a carved region as a file.
function downloadCarve(img, c, idx) {
  const f = carvedFile(img, c, idx);
  const url = URL.createObjectURL(f);
  const a = el('a', { href: url, download: f.name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// A real BMP has its declared file size fitting inside the image and a known DIB
// header size (12/40/52/56/64/108/124). Random 'BM' pairs almost never satisfy
// both, so this rejects the false positives the bare 2-byte magic lets through.
function plausibleBmp(img, off) {
  const n = img.length;
  if (off + 26 > n) return false;
  const u32 = (o) => (img[o] | (img[o + 1] << 8) | (img[o + 2] << 16) | (img[o + 3] * 0x1000000)) >>> 0;
  const fileSize = u32(off + 2);
  if (fileSize < 54 || off + fileSize > n) return false;
  const dib = u32(off + 14);
  return dib === 12 || dib === 40 || dib === 52 || dib === 56 || dib === 64 || dib === 108 || dib === 124;
}

// Build a File for one carved region (repairing a cut-off JPEG so it decodes).
function carvedFile(img, c, idx) {
  let sub = img.subarray(c.start, c.end);
  if (c.format === 'jpeg' && !c.complete) { const r = repairJpeg(sub); if (r && r.data) sub = r.data; }
  const ext = CARVE_EXT[c.format] || 'bin';
  return new File([sub], 'carved_' + String(idx + 1).padStart(4, '0') + '_0x' + c.start.toString(16) + '.' + ext,
    { type: CARVE_MIME[c.format] || 'application/octet-stream' });
}

function carveCell(img, file, c, idx, io) {
  const cell = el('div', { style: 'border:1px solid var(--hairline); padding:8px;' });
  if (c.frame) cell.dataset.frame = '1';
  const thumb = el('div', { style: 'min-height:120px; display:flex; align-items:center; justify-content:center; cursor:zoom-in;' },
    el('span', { class: 'anr-hint', style: 'margin:0;' }, c.format.toUpperCase()));
  thumb._carve = { img, c };
  thumb.addEventListener('click', () => openCarveLightboxAt(idx));
  cell.appendChild(thumb);

  const dims = (c.width && c.height) ? c.width + ' × ' + c.height : '';
  cell.appendChild(el('div', { class: 'anr-hint', style: 'margin:6px 0 0;' },
    c.format.toUpperCase() + (dims ? '  ' + dims : '') + (c.complete ? '' : '  · partial') + (c.frame ? '  · frame' : '')));
  cell.appendChild(el('div', { class: 'anr-hint', style: 'margin:2px 0 0;' },
    'offset 0x' + c.start.toString(16) + ' · ' + fmtBytes(c.end - c.start)));

  const an = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, 'Analyse');
  an.addEventListener('click', () => analyseCarve(img, c, idx, file));
  const dl = el('a', { class: 'anr-btn anr-btn-sm', href: '#', download: '' }, 'Download');
  dl.addEventListener('click', (e) => { e.preventDefault(); downloadCarve(img, c, idx); });
  cell.appendChild(el('div', { class: 'anr-btn-row', style: 'margin-top:8px; gap:6px;' }, [an, dl]));

  io.observe(thumb);
  return cell;
}

// Lazily decode a carved region into a downscaled canvas, revoking the full-size
// blob URL as soon as the image has painted so the gallery's memory stays small.
function renderCarveThumb(thumbEl) {
  const { img, c } = thumbEl._carve;
  let sub = img.subarray(c.start, c.end);
  if (c.format === 'jpeg' && !c.complete) { const r = repairJpeg(sub); if (r && r.data) sub = r.data; }
  const url = URL.createObjectURL(new Blob([sub], { type: CARVE_MIME[c.format] || 'application/octet-stream' }));
  const im = new Image();
  im.onload = () => {
    const maxD = 200;
    const scale = Math.min(1, maxD / Math.max(im.naturalWidth || maxD, im.naturalHeight || maxD));
    const cw = Math.max(1, Math.round((im.naturalWidth || maxD) * scale));
    const ch = Math.max(1, Math.round((im.naturalHeight || maxD) * scale));
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    cv.style.cssText = 'max-width:100%; height:auto; display:block;';
    try { cv.getContext('2d').drawImage(im, 0, 0, cw, ch); } catch (_) {}
    thumbEl.innerHTML = '';
    thumbEl.style.minHeight = '';
    thumbEl.appendChild(cv);
    URL.revokeObjectURL(url);
  };
  im.onerror = () => {
    thumbEl.innerHTML = '';
    thumbEl.appendChild(el('span', { class: 'anr-hint', style: 'margin:0;' }, c.format.toUpperCase() + ' · no preview'));
    URL.revokeObjectURL(url);
  };
  im.src = url;
}

// A readout card listing every MBR partition (type, offset, size, bootable).
function partitionCard(partitions) {
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Partitions'));
  const t = el('table', { class: 'anr-readout' });
  for (const p of partitions) {
    const name = PART_TYPE_NAMES[p.type] || ('Type 0x' + p.type.toString(16).padStart(2, '0'));
    const val = name + ' · ' + fmtBytes(p.sectors * 512) + ' · start LBA ' + p.lba.toLocaleString() + (p.boot ? ' · bootable' : '');
    t.appendChild(row('Partition ' + (p.index + 1), val));
  }
  card.appendChild(t);
  return card;
}
