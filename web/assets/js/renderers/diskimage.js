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
import { carveImages, repairJpeg, ensureJpegHuffman } from './photo-recover.js';
import { decodeJpegPartial } from './jpeg-salvage.js';
import {
  looksLikeFatBoot, parseFatVolume, parseMbr, otherFsLabel, readFileBytes,
  FAT_PART_TYPES, PART_TYPE_NAMES, MAX_ENTRIES,
} from './diskimage-fat.js';

// Mirrors renderArchive's ceiling: above this an in-browser ArrayBuffer is
// impractical, so decline rather than crash the tab trying to allocate it.
const MAX_IMAGE_BYTES = 1_500_000_000;

// A FAT filesystem's bookkeeping - boot sector, FAT tables, directory entries -
// lives at the front of the volume, so the whole file tree can usually be built
// from a small prefix: a 488 MB camera card needs about 16 MB of it. We read
// PREFIX_START, and only if the parser reports it ran off the end do we double
// and retry (a card that has been heavily deleted and rewritten can have
// directories sitting anywhere). The full image is still read eventually - the
// raw-sector carve scan needs every byte - but that now happens after the tree
// is on screen instead of in front of it.
const PREFIX_START = 16 * 1024 * 1024;

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

  // Read the front of the image first and only grow if the parse needs it, so a
  // half-gigabyte card doesn't have to be pulled into memory before the tree can
  // be drawn. `readFull` fetches the whole thing, once, on demand.
  let img;
  let fullPromise = null;
  const readFull = () => {
    if (!fullPromise) {
      fullPromise = (img && img.length >= file.size)
        ? Promise.resolve(img)
        : file.arrayBuffer().then((b) => new Uint8Array(b));
    }
    return fullPromise;
  };

  let vol = null;
  let partitions = null;
  let layout = 'Bare filesystem (no partition table)';
  let volStart = 0;

  const read = async (n) => new Uint8Array(await file.slice(0, Math.min(file.size, n)).arrayBuffer());

  try {
    // The layout is decided by the first sector alone: a FAT boot sector at
    // offset 0 (superfloppy), or an MBR whose partition table tells us where the
    // filesystems start. Settling this before reading anything substantial means
    // an image with no FAT in it never gets pulled into memory just to find out.
    img = await read(64 * 1024);
    const bare = looksLikeFatBoot(img, 0);
    partitions = bare ? null : parseMbr(img);
    if (partitions) layout = 'MBR partition table (' + partitions.length + ' partition' + (partitions.length === 1 ? '' : 's') + ')';

    // Where a browsable FAT volume might begin, if anywhere.
    let candidate = bare ? 0 : -1;
    if (partitions) {
      for (const p of partitions) {
        if (!FAT_PART_TYPES.has(p.type)) continue;
        const start = p.lba * 512;
        if (start < file.size) { candidate = start; break; }   // the first FAT partition
      }
    }

    if (candidate < 0) {
      // No FAT to mount. All the identification card needs is the volume header,
      // and renderProprietary reads its own slices - so stop here and let the
      // deferred carve scan be the thing that reads the rest.
      img = await read(1024 * 1024);
    } else {
      // Parse the tree from a prefix, growing only when the parser reports it ran
      // off the end. Four-fold steps keep the worst case to a couple of reads.
      let prefix = Math.min(file.size, candidate + PREFIX_START);
      for (;;) {
        img = await read(prefix);
        vol = parseFatVolume(img, candidate);
        if (vol) volStart = candidate;
        if (prefix >= file.size || (vol && !vol.shortRead)) break;
        prefix = Math.min(file.size, prefix * 4);
      }
    }
  } catch (e) {
    resultsEl.innerHTML = '';
    if (isUnreadableError(e)) resultsEl.appendChild(cloudFileWarning(file));
    else resultsEl.appendChild(errorCard('Could not read file: ' + (e && e.message)));
    return;
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
    // The card is positioned now but filled last (see carvedImageGallery).
    const galleryHost = el('div', {});
    resultsEl.appendChild(galleryHost);
    resultsEl.appendChild(integrityCard(file));
    // Hand off to the generic identifier so nothing is lost vs. the old behaviour.
    try {
      const { renderProprietary } = await import('./proprietary.js');
      const host = el('div', {});
      resultsEl.appendChild(host);
      await renderProprietary(file, host, 'img');
    } catch (_) {}
    carvedImageGallery(readFull, file, galleryHost, null);
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

  // The tree was parsed from a prefix, so an entry's bytes may well sit past its
  // end. Re-point every getBytes at the full image, fetched on first open - the
  // directory data we already have tells us exactly where to look, so nothing is
  // re-parsed. Files inside the prefix cost nothing extra; the first click on one
  // beyond it pays for the remainder of the read, once.
  const entries = vol.entries.map((e) => ({
    name: e.name,
    size: e.size,
    getBytes: async () => readFileBytes(await readFull(), vol.geom, e.startCl, e.size),
  }));

  // Synthetic libarchive-shaped handle so we can reuse the archive tree/treemap.
  const handle = { entries, close() {} };
  renderHandleTree(handle, entries, file, resultsEl, { label: 'Disk image', summaryRows });

  // Gallery of every image carved straight from the raw sectors - the live
  // photos above plus any deleted/orphaned ones the directory no longer lists.
  // Its card is positioned here now, but the scan that fills it is kicked off
  // last, once every cheap card below is on the page (see carvedImageGallery).
  const galleryHost = el('div', {});
  resultsEl.appendChild(galleryHost);

  if (partitions) resultsEl.appendChild(partitionCard(partitions));
  resultsEl.appendChild(integrityCard(file));

  carvedImageGallery(readFull, file, galleryHost, vol);
}

// ---------- carved-image gallery ----------
// Scan the whole raw image for embedded image signatures (JPEG/PNG/GIF/WebP/BMP)
// and show each as a lazily-decoded thumbnail with Analyse / Download. This finds
// photos regardless of the filesystem - including deleted and orphaned files that
// are no longer in any directory, the usual win when a card's directory is
// corrupt. When the volume mounted (`vol`), a carve that begins at a cluster with
// a surviving FAT chain is read along that chain instead of straight through, so
// a *fragmented* file reassembles correctly rather than coming back garbled; only
// a deleted file whose chain was cleared falls back to the contiguous carve.
// Opt-in: the scan starts from a button, not automatically - it reads the whole
// image and carves every signature, so it stays out of the way until asked.
function carvedImageGallery(readFull, file, resultsEl, vol) {
  const card = el('div', { class: 'anr-card anr-collapsible' });
  card.appendChild(el('h3', {}, 'Images in this disk'));
  const body = el('div', {});
  card.appendChild(body);
  resultsEl.appendChild(card);

  // Not automatic: the tree above already lists the live files; this recovers what
  // it doesn't (deleted / orphaned photos, MJPEG frames) but must read the entire
  // image (up to ~1.5 GB) and carve every signature, so it runs only on request.
  body.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 12px;' },
    'Scan every raw sector for embedded image signatures to recover photos the directory no longer lists - deleted and orphaned files - plus MJPEG video frames. It reads the whole image, so it can take a few seconds.'));
  const scanBtn = el('button', { type: 'button', class: 'anr-btn anr-btn--cta' }, 'Scan for images');
  body.appendChild(scanBtn);

  scanBtn.addEventListener('click', async () => {
    scanBtn.replaceWith(el('p', { class: 'anr-hint', style: 'margin:0;' }, 'Scanning the raw sectors for embedded images…'));
    // The tree only needed the front of the image; the sector scan needs all of
    // it, so this is where the rest of the file is finally read.
    let img;
    try { img = await readFull(); } catch (_) {
      body.innerHTML = '';
      body.appendChild(el('p', { class: 'anr-hint', style: 'margin:0;' }, 'Could not read the rest of the image to scan it for embedded pictures.'));
      return;
    }

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
    _carveList = list; _carveImg = img; _carveFile = file; _carveVol = vol;

    // Read each shown photo's EXIF capture date from its header - it survives
    // carving even for deleted files - so the gallery can show it and sort by it.
    for (const c of list) { const raw = carveExifDate(img, c.start, c.end); c._dateFmt = fmtExifDate(raw); c._date = c._dateFmt ? raw : null; }

    body.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 12px;' },
      'Found ' + total + (total >= SCAN_CARVE ? '+' : '') + ' image' + (total === 1 ? '' : 's')
      + ' by scanning every sector for image signatures'
      + (total > shown ? ' - showing the ' + shown + ' largest (biggest first)' : '')
      + '. This includes deleted and orphaned photos no longer in the directory, plus MJPEG video frames and thumbnails, so it can show more - or different - files than the tree above. Fragmented files are reassembled from the filesystem when their allocation map survives; a deleted file whose map was cleared can only be read straight through, so it may come back partly garbled or without a preview.'));

    const grid = el('div', { class: 'anr-carve-grid' });

    // Controls sit in one row above the grid.
    const controls = el('div', { style: 'display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:0 0 12px;' });

    // Toggle to hide the small video frames / thumbnails (shown by default),
    // leaving just the full-size photos.
    if (frameShown) {
      let hidden = false;
      const toggle = el('button', { type: 'button', class: 'anr-btn anr-btn-sm', style: 'margin:0;' },
        'Hide frames & thumbnails (' + frameShown + ')');
      toggle.addEventListener('click', () => {
        hidden = !hidden;
        for (const cell of grid.children) {
          if (cell.dataset && cell.dataset.frame === '1') cell.style.display = hidden ? 'none' : '';
        }
        toggle.textContent = (hidden ? 'Show' : 'Hide') + ' frames & thumbnails (' + frameShown + ')';
      });
      controls.appendChild(toggle);
    }

    // Copy a report of every full-size photo - offset, size, and whether it
    // produces a preview or not - to the clipboard, so the list can be
    // cross-referenced against the card elsewhere. Each candidate is decoded on
    // click - most aren't decoded yet (thumbnails decode lazily on scroll) - and
    // the verdict is cached, shared with the on-screen labels.
    controls.appendChild(makeCopyCorruptButton(img, list, vol));

    // Sort control: largest first (the default), or by EXIF capture date. Re-orders
    // the cells in place; the lightbox index is unaffected (it tracks _carveList,
    // not the DOM order).
    const sortSel = el('select', { class: 'anr-btn anr-btn-sm anr-select', 'aria-label': 'Sort images', style: 'margin:0;' }, [
      el('option', { value: 'size' }, 'Largest first'),
      el('option', { value: 'newest' }, 'Newest first'),
      el('option', { value: 'oldest' }, 'Oldest first'),
    ]);
    controls.appendChild(sortSel);

    body.appendChild(controls);
    body.appendChild(grid);

    // One observer for the whole gallery: build each thumbnail only as it scrolls
    // into view, then revoke its full-size blob so memory stays bounded. Decodes
    // are pumped one at a time through a queue rather than fired all at once: a
    // single scroll can bring dozens of large photos into view together, and
    // decoding them concurrently exhausts the browser's image decoder so some come
    // back blank and show a false "no preview". Serial decoding matches what the
    // Copy photo list button reports.
    const queue = [];
    let pumping = false;
    const pump = async () => {
      if (pumping) return;
      pumping = true;
      while (queue.length) {
        await renderCarveThumb(queue.shift());
        await new Promise((r) => setTimeout(r));       // let the bitmap be reclaimed
      }
      pumping = false;
    };
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        io.unobserve(en.target);
        queue.push(en.target);
      }
      pump();
    }, { rootMargin: '300px' });

    const cells = [];
    for (let k = 0; k < list.length; k++) { const cell = carveCell(img, file, list[k], k, io, vol); cells.push({ c: list[k], cell }); grid.appendChild(cell); }

    // Re-order the built cells for the chosen sort by moving the DOM nodes (a carve
    // with no EXIF date - a video frame, or a reset camera clock - sinks to the
    // bottom of a date sort). The frames toggle still finds cells by their dataset.
    const bySize = (a, b) => (b.c.end - b.c.start) - (a.c.end - a.c.start);
    sortSel.addEventListener('change', () => {
      const mode = sortSel.value, newest = mode === 'newest';
      const arr = cells.slice();
      arr.sort(mode === 'size' ? bySize : (a, b) => {
        const da = a.c._date, db = b.c._date;
        if (da && db) return da === db ? bySize(a, b) : (newest ? (da < db ? 1 : -1) : (da < db ? -1 : 1));
        if (da) return -1;
        if (db) return 1;
        return bySize(a, b);
      });
      for (const { cell } of arr) grid.appendChild(cell);
    });
  });
}

// Current gallery state, so the lightbox arrows / keyboard can step through it.
let _carveLbUrl = null;
let _carveList = null, _carveImg = null, _carveFile = null, _carveVol = null;

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
  const c = list[pos], img = _carveImg, file = _carveFile, vol = _carveVol;
  const f = carvedFile(img, c, pos, vol);
  const prevUrl = _carveLbUrl;
  // A carve the browser couldn't decode was shown from the salvage decoder; the
  // lightbox has to use that recovered raster too, or it would open blank. A data
  // URL needs no revoking, so only track blob URLs in _carveLbUrl.
  let url, blob = true;
  if (c._salvaged) { const sc = salvageFullCanvas(carveBytes(img, vol, c)); if (sc) { url = sc.toDataURL('image/png'); blob = false; } }
  if (!url) url = URL.createObjectURL(f);
  _carveLbUrl = blob ? url : null;
  const dims = (c.width && c.height) ? c.width + ' × ' + c.height : '';
  const meta = (pos + 1) + ' / ' + n + '  ·  ' + f.name + (dims ? '  ·  ' + dims : '')
    + '  ·  ' + fmtBytes(f.size) + (c._thumb ? '  · embedded thumbnail (full image overwritten)' : c._salvaged ? '  · recovered (partial)' : c.recovered ? '  · reassembled' : c.complete ? '' : '  · partial');
  import('./photo.js').then(({ openLightbox, closeLightbox }) => {
    const nav = {
      onPrev: () => openCarveLightboxAt(pos - 1),
      onNext: () => openCarveLightboxAt(pos + 1),
      checker: true,
      actions: [
        { label: 'Analyse', onClick: () => { closeLightbox(); analyseCarve(img, c, pos, file, vol); } },
        { label: 'Download', onClick: () => downloadCarve(img, c, pos, vol) },
      ],
    };
    openLightbox(url, f.name, meta, null, true, false, nav);
    if (prevUrl) URL.revokeObjectURL(prevUrl);
  }).catch(() => { if (prevUrl) URL.revokeObjectURL(prevUrl); });
}

// Run the full analysis on a carved region (registers a Back-nav restore first).
function analyseCarve(img, c, idx, file, vol) {
  const f = carvedFile(img, c, idx, vol);
  if (window._anrPushNav) window._anrPushNav(file.name || 'disk image', () => { if (window._anrHandleFile) window._anrHandleFile(file, {}); });
  if (window._anrHandleFile) window._anrHandleFile(f, { nested: true });
}

// Download a carved region as a file.
function downloadCarve(img, c, idx, vol) {
  const f = carvedFile(img, c, idx, vol);
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
function carvedFile(img, c, idx, vol) {
  const sub = carveBytes(img, vol, c);
  const ext = CARVE_EXT[c.format] || 'bin';
  return new File([sub], 'carved_' + String(idx + 1).padStart(4, '0') + '_0x' + c.start.toString(16) + '.' + ext,
    { type: CARVE_MIME[c.format] || 'application/octet-stream' });
}

// The best bytes for a carve. On a mounted volume, a carve that begins at a
// cluster boundary with a surviving, fragmented FAT chain is read along that
// chain (recoverViaChain) - which reassembles a scattered file the straight
// contiguous carve would garble. Everything else uses the contiguous extent,
// closing off a cut-off JPEG so it still decodes. Cached on the carve so the
// thumbnail, lightbox, Analyse and Download all share one result.
function carveBytes(img, vol, c) {
  if (c._bytes) return c._bytes;
  let sub = vol ? recoverViaChain(img, vol, c) : null;
  if (sub) { c.recovered = true; }
  else {
    sub = img.subarray(c.start, c.end);
    if (c.format === 'jpeg' && !c.complete) { const r = repairJpeg(sub); if (r && r.data) sub = r.data; }
  }
  // A Motion-JPEG frame (the bulk of what a raw sector scan turns up on a card that
  // held video) carries no Huffman tables, so it decodes to nothing until the
  // standard ones are grafted back in. No-op for a normal JPEG that has its own.
  if (c.format === 'jpeg') sub = ensureJpegHuffman(sub);
  c._bytes = sub;
  return sub;
}

// If the carve starts exactly on a cluster whose FAT chain is allocated,
// multi-cluster and *fragmented* (non-contiguous), follow that chain and return
// the reassembled bytes trimmed to their last EOI; otherwise null (a contiguous
// or a cleared/deleted chain has nothing to add over the plain carve). This is
// what turns a fragmented-file carve from a garbled preview into the real image.
function recoverViaChain(img, vol, c) {
  const g = vol.geom;
  if (!g || (g.type !== 'FAT12' && g.type !== 'FAT16' && g.type !== 'FAT32')) return null;
  const dataStart = g.partStart + g.firstDataSector * g.bps;
  if (c.start < dataStart) return null;
  const rel = c.start - dataStart;
  if (rel % g.bytesPerCluster !== 0) return null;          // signature not at a cluster start
  const startCl = rel / g.bytesPerCluster + 2;

  const next = (cl) => {
    if (g.type === 'FAT16') { const o = g.fatStart + cl * 2; return (o + 1 < img.length) ? (img[o] | (img[o + 1] << 8)) : 0x0FFFFFFF; }
    if (g.type === 'FAT32') { const o = g.fatStart + cl * 4; return (o + 3 < img.length) ? ((img[o] | (img[o + 1] << 8) | (img[o + 2] << 16) | (img[o + 3] << 24)) & 0x0FFFFFFF) : 0x0FFFFFFF; }
    const o = g.fatStart + Math.floor(cl * 3 / 2); if (o + 1 >= img.length) return 0x0FFFFFFF;
    const v = img[o] | (img[o + 1] << 8); return (cl & 1) ? (v >> 4) : (v & 0x0FFF);
  };
  const isEoc = (v) => g.type === 'FAT12' ? v >= 0x0FF8 : g.type === 'FAT16' ? v >= 0xFFF8 : v >= 0x0FFFFFF8;

  // Walk the chain: it must terminate cleanly in an EOC marker, be longer than
  // one cluster, and be non-contiguous (a contiguous chain equals the plain
  // carve, so there's nothing to gain). A cleared entry (0 = free) mid-chain, a
  // loop, or a runaway length means the map is gone - bail to contiguous.
  const seen = new Set();
  let cur = startCl, len = 0, contiguous = true, prev = -1, terminated = false;
  while (cur >= 2 && len < 200000) {
    if (seen.has(cur)) return null;                        // loop -> untrustworthy
    seen.add(cur);
    if (prev >= 0 && cur !== prev + 1) contiguous = false;
    prev = cur; len++;
    const nx = next(cur);
    if (isEoc(nx)) { terminated = true; break; }
    if (nx < 2) return null;                               // free/bad -> deleted, chain lost
    cur = nx;
  }
  if (!terminated || len <= 1 || contiguous) return null;

  const bytes = readFileBytes(img, g, startCl, len * g.bytesPerCluster);
  // Trim to the last EOI so the file ends cleanly (JPEG only; others use as-is).
  if (c.format === 'jpeg') {
    for (let i = bytes.length - 2; i >= 2; i--) if (bytes[i] === 0xFF && bytes[i + 1] === 0xD9) return bytes.subarray(0, i + 2);
  }
  return bytes;
}

// One gallery cell: a bare thumbnail (no card around it) whose Analyse / Download
// actions sit overlaid on the image and only appear on hover, matching the PDF
// page previews. The caption lines go underneath. Clicking the thumbnail itself
// opens the lightbox, so the buttons stop their click from reaching it.
function carveCell(img, file, c, idx, io, vol) {
  const cell = el('div', { class: 'anr-carve-cell' });
  if (c.frame) cell.dataset.frame = '1';

  const thumb = el('div', { class: 'anr-carve-thumb', title: 'Click to view full size' },
    el('span', { class: 'anr-hint', style: 'margin:0;' }, c.format.toUpperCase()));
  thumb._carve = { img, c, vol };
  // Skip the lightbox for a carve that turned out undecodable - it would just be
  // an invisible transparent frame (renderCarveThumb sets the flag on decode).
  thumb.addEventListener('click', () => { if (!c.undecodable) openCarveLightboxAt(idx); });

  const an = el('button', { type: 'button', class: 'anr-carve-btn' }, 'Analyse');
  an.addEventListener('click', (e) => { e.stopPropagation(); analyseCarve(img, c, idx, file, vol); });
  const dl = el('button', { type: 'button', class: 'anr-carve-btn' }, 'Download');
  dl.addEventListener('click', (e) => { e.stopPropagation(); downloadCarve(img, c, idx, vol); });
  thumb.appendChild(el('div', { class: 'anr-carve-actions' }, [an, dl]));

  cell.appendChild(thumb);

  const dims = (c.width && c.height) ? c.width + ' × ' + c.height : '';
  cell.appendChild(el('div', { class: 'anr-carve-cap' },
    c.format.toUpperCase() + (dims ? '  ' + dims : '') + (c.complete ? '' : '  · partial') + (c.frame ? '  · frame' : '')));
  cell.appendChild(el('div', { class: 'anr-carve-cap', style: 'margin-top:2px;' },
    'offset 0x' + c.start.toString(16) + ' · ' + fmtBytes(c.end - c.start)));
  if (c._dateFmt) cell.appendChild(el('div', { class: 'anr-carve-cap', style: 'margin-top:2px;' }, c._dateFmt));

  io.observe(thumb);
  return cell;
}

// Read a carved photo's EXIF capture date from its header - the DateTimeOriginal
// (0x9003) in the Exif IFD, or the DateTime modify tag (0x0132) in IFD0 - as its
// raw "YYYY:MM:DD HH:MM:SS" string (lexicographically sortable), or null. The
// header survives carving even for deleted files, so this dates recovered photos.
// Only the header is scanned (bounded to 64 KB), so it stays cheap over the gallery.
function carveExifDate(img, start, end) {
  const lim = Math.min(end, start + 65536);
  if (start + 4 > lim || img[start] !== 0xFF || img[start + 1] !== 0xD8) return null;
  // Scan the header for the "Exif\0\0" APP1 signature. A byte scan is used
  // deliberately rather than a strict marker walk: a carved header can carry a
  // malformed segment that would stop a walk early, yet the signature is still
  // findable (this lifts date coverage on a real card from ~91% to ~99%).
  let tiff = -1;
  for (let i = start + 2; i + 6 < lim; i++) {
    if (img[i] === 0x45 && img[i + 1] === 0x78 && img[i + 2] === 0x69 && img[i + 3] === 0x66 && img[i + 4] === 0 && img[i + 5] === 0) { tiff = i + 6; break; }
  }
  if (tiff < 0 || tiff + 8 > lim) return null;
  const le = img[tiff] === 0x49;
  const u16 = (o) => le ? (img[o] | (img[o + 1] << 8)) : ((img[o] << 8) | img[o + 1]);
  const u32 = (o) => ((le ? (img[o] | (img[o + 1] << 8) | (img[o + 2] << 16) | (img[o + 3] * 0x1000000)) : (img[o] * 0x1000000 + (img[o + 1] << 16) + (img[o + 2] << 8) + img[o + 3])) >>> 0);
  if (u16(tiff + 2) !== 0x002A) return null;
  const readStr = (o, cnt) => { let s = ''; for (let j = 0; j < cnt - 1 && o + j < lim; j++) { const ch = img[o + j]; if (!ch) break; s += String.fromCharCode(ch); } return s; };
  const readIFD = (ifdOff, wantTag) => {
    const base = tiff + ifdOff; if (base + 2 > lim) return {};
    const n = u16(base); let exifPtr = 0, dt = null;
    for (let k = 0; k < n; k++) {
      const ent = base + 2 + k * 12; if (ent + 12 > lim) break;
      const tag = u16(ent), type = u16(ent + 2), cnt = u32(ent + 4);
      if (tag === 0x8769) exifPtr = u32(ent + 8);
      else if (tag === wantTag && type === 2 && cnt >= 8) { const vo = cnt <= 4 ? ent + 8 : tiff + u32(ent + 8); dt = readStr(vo, cnt); }
    }
    return { exifPtr, dt };
  };
  const ifd0 = readIFD(u32(tiff + 4), 0x0132);
  if (ifd0.exifPtr) { const ex = readIFD(ifd0.exifPtr, 0x9003); if (ex.dt) return ex.dt; }
  return ifd0.dt || null;
}

// Format an EXIF "YYYY:MM:DD HH:MM:SS" date as "YYYY-MM-DD HH:MM" for display, or
// null if it isn't a real date (an all-zero placeholder).
function fmtExifDate(s) {
  const m = /^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2})/.exec(s || '');
  return (m && m[1] !== '0000') ? m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] : null;
}

// Decode a carve for display: the browser first (fast, handles the valid majority),
// and when it yields nothing - a fragmented or corrupt JPEG it refuses to render -
// the fault-tolerant decoder (jpeg-salvage.js) recovers whatever top strip survives,
// or, if even that is gone, the file's embedded EXIF thumbnail. Resolves { canvas,
// cat, salvaged, thumb }; canvas is null only when nothing at all decodes.
function decodeCarveToCanvas(sub, format, maxD) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([sub], { type: CARVE_MIME[format] || 'application/octet-stream' }));
    const im = new Image();
    const done = (canvas, cat, salvaged, thumb) => { im.onload = im.onerror = null; im.src = ''; URL.revokeObjectURL(url); resolve({ canvas, cat, salvaged: !!salvaged, thumb: !!thumb }); };
    const trySalvage = () => { const s = format === 'jpeg' ? salvageCanvas(sub, maxD) : null; return s ? done(s.canvas, s.cat, true, s.thumb) : done(null, 'none', false, false); };
    im.onload = () => {
      const nw = im.naturalWidth || 0, nh = im.naturalHeight || 0;
      if (!nw || !nh) { trySalvage(); return; }           // loaded but nothing to draw
      const scale = Math.min(1, maxD / Math.max(nw, nh));
      const cw = Math.max(1, Math.round(nw * scale)), ch = Math.max(1, Math.round(nh * scale));
      const cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      const ctx = cv.getContext('2d');
      let drew = true;
      try { ctx.drawImage(im, 0, 0, cw, ch); } catch (_) { drew = false; }
      if (!drew) { trySalvage(); return; }
      const frac = emptyFraction(ctx, cw, ch);
      if (frac >= 0.99 && format === 'jpeg') {            // browser drew nothing - salvage may still recover a strip or the thumbnail
        const s = salvageCanvas(sub, maxD);
        if (s) { done(s.canvas, s.cat, true, s.thumb); return; }
      }
      done(cv, classifyFill(frac), false, false);
    };
    im.onerror = () => trySalvage();
    im.src = url;
  });
}

// Run the fault-tolerant JPEG decoder over `sub` and paint what it recovered into a
// downscaled canvas (real top rows + mid-grey fill below, or the embedded thumbnail
// if the main image was overwritten). Returns { canvas, cat, thumb } or null.
function salvageCanvas(sub, maxD) {
  const full = salvageFullCanvas(sub);
  if (!full) return null;
  const scale = Math.min(1, maxD / Math.max(full.width, full.height));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(full.width * scale));
  cv.height = Math.max(1, Math.round(full.height * scale));
  cv.getContext('2d').drawImage(full, 0, 0, cv.width, cv.height);
  // A thumbnail-only recovery is 'partial' (you got a preview, not the full image).
  return { canvas: cv, cat: (full._thumb || full._realFrac <= 0.95) ? 'partial' : 'ok', thumb: full._thumb };
}

// Full-resolution salvage canvas (for the lightbox), or null if nothing decoded.
// `_thumb` marks a canvas that is the file's embedded EXIF thumbnail (its full-size
// image was overwritten and only the header, with its thumbnail, survived).
function salvageFullCanvas(sub) {
  let dec;
  try { dec = decodeJpegPartial(sub); } catch (_) { return null; }
  if (!dec || !dec.rows) return null;
  const cv = document.createElement('canvas');
  cv.width = dec.width; cv.height = dec.height;
  cv.getContext('2d').putImageData(new ImageData(dec.data, dec.width, dec.height), 0, 0);
  cv._realFrac = dec.rows / dec.height;
  cv._thumb = !!dec.thumb;
  return cv;
}

// Lazily decode a carved region into a downscaled canvas. Only the placeholder is
// swapped out - the hover-actions overlay is a sibling inside the same thumb and
// has to survive. Returns a Promise that settles once the thumbnail has decoded (or
// failed), so the gallery can run these one at a time (the pump in carvedImageGallery).
function renderCarveThumb(thumbEl) {
  const { img, c, vol } = thumbEl._carve;
  const placeholder = thumbEl.querySelector('.anr-hint');
  // carveBytes reassembles a fragmented file via its FAT chain when it can, so a
  // scattered photo previews correctly here instead of as garbage.
  const sub = carveBytes(img, vol, c);
  return decodeCarveToCanvas(sub, c.format, 200).then(({ canvas, cat, salvaged, thumb }) => {
    c._cat = cat; c._decoded = cat !== 'none'; c.undecodable = cat === 'none'; c._salvaged = salvaged; c._thumb = thumb;
    if (!canvas) {
      // Nothing at all decodes - keep the text placeholder, but the cell stays in
      // the gallery; nothing is removed.
      thumbEl.classList.add('is-plain'); thumbEl.title = '';
      if (placeholder) placeholder.textContent = c.format.toUpperCase() + ' · no preview';
    } else {
      if (placeholder) placeholder.replaceWith(canvas); else thumbEl.prepend(canvas);
      if (thumb) thumbEl.title = 'Embedded thumbnail - the full-size image was overwritten';
      else if (cat !== 'ok') thumbEl.title = 'Click to view full size (' + cat + ' - recovered data is incomplete)';
    }
  });
}

// Fraction of the decoded thumbnail that is the browser's "no data" fill: fully
// transparent (untouched canvas) or the exact mid-gray 128,128,128 an incomplete
// JPEG leaves where it couldn't reach. 0 = a full picture, ~1 = nothing decoded.
// The narrow ±2 gray band avoids catching a genuinely grey photo. This no longer
// hides anything - every carve that produced any raster is shown - it only labels
// how much of it is real (see classifyFill).
function emptyFraction(ctx, w, h) {
  try {
    const d = ctx.getImageData(0, 0, w, h).data;
    const total = d.length / 4;
    if (total < 8) return 0;
    let fill = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) { fill++; continue; }      // transparent = untouched
      if (Math.abs(d[i] - 128) <= 2 && Math.abs(d[i + 1] - 128) <= 2 && Math.abs(d[i + 2] - 128) <= 2) fill++;
    }
    return fill / total;
  } catch (_) { return 0; }                          // tainted/unreadable - assume it drew
}

// Name a decode by how much real content it has, for the copy-list report and the
// on-hover caption. Nothing is hidden - even 'empty' carves are shown as whatever
// grey/noise they decoded to, so the gallery reflects everything the scan found.
function classifyFill(frac) { return frac < 0.5 ? 'ok' : frac < 0.99 ? 'partial' : 'empty'; }

// Classify how much of a carve is real content - 'ok' | 'partial' | 'empty' |
// 'none' - caching the verdict. Uses the same browser-then-salvage path the
// thumbnail does, so the copy-list report and the on-screen thumbnails always
// agree. A carve already classified (on scroll or a previous run) short-circuits.
function checkCarveDecodes(img, c, vol) {
  if (c._cat) return Promise.resolve(c._cat);
  const sub = carveBytes(img, vol, c);
  return decodeCarveToCanvas(sub, c.format, 200).then(({ cat, salvaged, thumb }) => {
    c._cat = cat; c.undecodable = cat === 'none'; c._decoded = cat !== 'none'; c._salvaged = salvaged; c._thumb = thumb;
    return cat;
  });
}

// A button that decodes every full-size photo (frames and thumbnails excluded)
// and copies a report of all of them to the clipboard: offset, byte size and how
// much of the picture is real - ok (a full image), partial (a recovered top strip
// over undecoded fill), empty (decoded to nothing but grey/noise) or none (no
// decodable image at all). Tab-separated so it pastes into a spreadsheet. Most
// photos aren't decoded yet (thumbnails decode lazily on scroll), so they are
// decoded one at a time on click with a running count; each verdict is cached on
// the carve and shared with the on-screen thumbnails.
function makeCopyCorruptButton(img, list, vol) {
  const btn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm', style: 'margin:0; white-space:nowrap; flex-shrink:0;' }, 'Copy photo list');
  const idle = 'Copy photo list';
  const reset = (msg) => { btn.textContent = msg; btn.disabled = false; btn._busy = false; setTimeout(() => { if (!btn._busy) btn.textContent = idle; }, 2500); };
  btn.addEventListener('click', async () => {
    if (btn._busy) return;
    btn._busy = true; btn.disabled = true;
    // Full-size photos only: the scan also turns up thousands of tiny MJPEG video
    // frames and EXIF thumbnails (the "N found" total), which aren't what this
    // list is about, so they're skipped here just as the frames toggle hides them.
    const photos = list.filter((c) => !c.frame);
    if (!photos.length) { reset('No photos'); return; }
    const rows = [];
    const tally = { ok: 0, partial: 0, empty: 0, none: 0 };
    for (let i = 0; i < photos.length; i++) {
      btn.textContent = 'Checking ' + (i + 1) + '/' + photos.length + '…';
      const c = photos[i];
      const cat = await checkCarveDecodes(img, c, vol);          // eslint-disable-line no-await-in-loop
      tally[cat] = (tally[cat] || 0) + 1;
      rows.push('0x' + c.start.toString(16) + '\t' + (c.end - c.start) + '\t' + fmtBytes(c.end - c.start) + '\t' + cat);
      // Let the browser reclaim the decoded bitmap before the next one, so a burst
      // of large photos can't exhaust the image decoder (see checkCarveDecodes).
      await new Promise((r) => setTimeout(r));                   // eslint-disable-line no-await-in-loop
    }
    const text = 'offset\tbytes\tsize\tcontent\n' + rows.join('\n');
    const note = photos.length + ' photos: ' + tally.ok + ' ok, ' + tally.partial + ' partial, ' + (tally.empty + tally.none) + ' empty';
    try {
      await navigator.clipboard.writeText(text);
      reset('Copied ' + note);
    } catch (_) {
      // Fallback for a context without the async clipboard API.
      const ta = el('textarea', { style: 'position:fixed; opacity:0; pointer-events:none;' });
      ta.value = text; document.body.appendChild(ta); ta.select();
      let done = false; try { done = document.execCommand('copy'); } catch (_) {}
      ta.remove();
      reset(done ? 'Copied ' + note : 'Copy failed');
    }
  });
  return btn;
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
