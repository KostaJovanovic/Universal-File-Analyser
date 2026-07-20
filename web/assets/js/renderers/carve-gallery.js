/* Analyser - carved-image gallery (shared)

   The grid of images recovered by scanning raw bytes for image signatures, used
   by the photo salvage view (photo.js), the unknown-file fallback (unknown.js)
   and - with extras of its own - the disk-image sector scan (diskimage.js).

   Two things matter here:

   1. Nothing blocks. Cells are built synchronously and returned immediately, so
      the analysis behind the gallery renders at once. Each thumbnail decodes
      only when it scrolls into view. The previous versions awaited every carve
      in turn, which meant a blob holding 48 images decoded them one after
      another before anything else on the page appeared.
   2. Memory stays bounded. A carve can be a full-resolution photo, so the
      thumbnail is drawn into a small canvas and the blob URL is released the
      moment it has painted. The lightbox and the download build a fresh URL on
      demand from the File, which is just a view onto bytes we already hold.

   Styling is .anr-carve-* in analyser.css; the thumbnails are bare, with their
   Analyse / Download actions overlaid on hover (see /test for the demo). */

import { el, downloadBlob } from '../core/util.js';
import { decodeJpegPartial, detectCorruptCut } from './jpeg-salvage.js';

// Longest edge of a gallery thumbnail, in CSS pixels. Matches the 200px cap in
// .anr-carve-thumb so a decoded carve is never scaled down again by the browser.
const THUMB_MAX = 200;

// Only one lightbox image is open at a time, so only one URL is kept alive.
let lbUrl = null;

// Open a carve full-size in the shared photo lightbox. photo.js is imported at
// click time, not up front: unknown.js is the fallback for files we can't
// identify and must not pull in the (large) photo module just to list carves.
function openCarve(file, salvageUrl) {
  const prev = lbUrl;
  // A carve the browser couldn't decode was shown from the salvage decoder; the
  // lightbox opens that recovered raster (a data URL, no revoke) rather than the
  // raw File, which would render blank.
  const url = salvageUrl || URL.createObjectURL(file);
  lbUrl = salvageUrl ? null : url;
  import('./photo.js').then(({ openLightbox }) => {
    openLightbox(url, 'Carved image', file.name, null, false, false, { checker: true });
    if (prev) URL.revokeObjectURL(prev);
  }).catch(() => { if (prev) URL.revokeObjectURL(prev); });
}

// Save a carve. The URL is built on click and released afterwards, so a gallery
// of 48 carves doesn't hold 48 object URLs open for the life of the page.
function downloadCarve(file) {
  downloadBlob(file.name, file);
}

// Downscale an Image or canvas into a fresh canvas whose long edge is <= maxD.
function downscaleTo(src, maxD) {
  const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
  const scale = Math.min(1, maxD / Math.max(w, h));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w * scale));
  cv.height = Math.max(1, Math.round(h * scale));
  cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
  return cv;
}

// Full-resolution salvage canvas from the fault-tolerant decoder (jpeg-salvage.js):
// the recovered top rows over mid-grey fill. null if nothing decoded.
export function salvageFullCanvas(bytes) {
  let dec;
  try { dec = decodeJpegPartial(bytes); } catch (_) { return null; }
  if (!dec || !dec.rows) return null;
  const cv = document.createElement('canvas');
  cv.width = dec.width; cv.height = dec.height;
  cv.getContext('2d').putImageData(new ImageData(dec.data, dec.width, dec.height), 0, 0);
  cv._realFrac = (dec.realRows != null ? dec.realRows : dec.rows) / dec.height;
  cv._thumb = !!dec.thumb;                              // the file's embedded thumbnail (full image gone)
  cv._corrupt = !!dec.corrupt;                          // top strip real, remainder decoder noise (the disk-image gallery reads this)
  return cv;
}

// Decode one thumbnail into a downscaled canvas, browser-first with a salvage
// fallback. Called by the observer the first time the cell comes near the viewport.
// The browser handles the valid majority; when it renders nothing from a fragmented
// or corrupt JPEG, the tolerant decoder recovers whatever top strip survives. A
// carve that yields nothing at all keeps its text placeholder. Returns a Promise
// that settles once decoded (or failed), so the gallery runs these one at a time.
function decodeThumb(thumb) {
  const file = thumb._carveFile;
  const fmt = (thumb._carveFmt || '').toLowerCase();
  const placeholder = thumb.querySelector('.anr-hint');
  const isJpeg = fmt === 'jpeg' || fmt === 'jpg';
  const show = (cv, salvaged, partial) => {
    if (placeholder) placeholder.replaceWith(cv); else thumb.prepend(cv);
    thumb.classList.remove('is-plain');
    thumb.title = partial ? 'Click to view full size (recovered data is incomplete)' : 'Click to view full size';
    thumb.addEventListener('click', () => openCarve(file, salvaged ? thumb._salvageUrl : null));
  };
  const fail = () => { if (placeholder) placeholder.textContent = (thumb._carveFmt || 'DATA') + ' · no preview'; };
  return new Promise((done) => {
    const salvage = async () => {
      if (!isJpeg) { fail(); done(); return; }
      try {
        const full = salvageFullCanvas(new Uint8Array(await file.arrayBuffer()));
        if (!full) { fail(); done(); return; }
        thumb._salvageUrl = full.toDataURL('image/png');   // full-res for the lightbox
        show(downscaleTo(full, THUMB_MAX), true, full._thumb || full._realFrac <= 0.95);
      } catch (_) { fail(); }
      done();
    };
    const url = URL.createObjectURL(file);
    const im = new Image();
    const cleanup = () => { im.onload = im.onerror = null; im.src = ''; URL.revokeObjectURL(url); };
    im.onload = () => {
      const w = im.naturalWidth || 0, h = im.naturalHeight || 0;
      if (!w || !h) { cleanup(); salvage(); return; }
      const cv = downscaleTo(im, THUMB_MAX);
      const ctx = cv.getContext('2d');
      let frac = 1, corrupt = false;
      try { frac = emptyFraction(ctx, cv.width, cv.height); } catch (_) {}
      // The browser draws a desynced JPEG as a real top strip over saturated colour-block
      // noise and reports success. Keep that raster (it's what a system viewer shows) but
      // flag it, so the cell is marked corrupt rather than passed off as a whole picture.
      if (isJpeg && frac < 0.99) { try { corrupt = detectCorruptCut(ctx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height) >= 0; } catch (_) {} }
      cleanup();
      if (isJpeg && frac >= 0.99) { salvage(); return; }   // browser drew nothing - salvage a strip or the thumbnail
      show(cv, false, frac >= 0.5 || corrupt);
      done();
    };
    im.onerror = () => { cleanup(); salvage(); };
    im.src = url;
  });
}

// Fraction of the decoded thumbnail that is the browser's "no data" fill: fully
// transparent (untouched canvas) or the exact mid-gray 128,128,128 an incomplete
// JPEG leaves behind. 0 = a full picture, ~1 = nothing decoded. Used only to set a
// tooltip hint now - nothing is hidden by it; every carve that produced a raster is
// shown. The narrow ±2 gray band avoids catching a genuinely grey photo.
export function emptyFraction(ctx, w, h) {
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

/* Create an empty gallery. Returns { grid, add } - append `grid` wherever it
   belongs and call `add` once per carve; both are safe to use immediately.

   add({ file, format, width, height, complete, onAnalyse })
     file       File holding the carved bytes (already repaired, if applicable)
     format     'jpeg' | 'png' | ... - shown in the caption and placeholder
     width      pixel dimensions when the carver read them (optional)
     height
     complete   false for a carve that ran off the end of the data
     onAnalyse  run the full analysis on this carve                          */
export function createCarveGallery() {
  const grid = el('div', { class: 'anr-carve-grid' });

  // One observer for the whole gallery; each thumbnail is decoded once and then
  // dropped from it. The margin starts the decode just before the cell appears.
  // Decodes are pumped one at a time rather than fired all at once: a single
  // scroll can bring dozens of large carves into view together, and decoding them
  // concurrently exhausts the browser's image decoder so some come back blank and
  // show a false "no preview".
  const queue = [];
  let pumping = false;
  const pump = async () => {
    if (pumping) return;
    pumping = true;
    while (queue.length) {
      await decodeThumb(queue.shift());
      await new Promise((r) => setTimeout(r));         // let the bitmap be reclaimed
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

  function add({ file, format, width, height, complete, onAnalyse }) {
    const fmt = (format || 'data').toUpperCase();
    const cell = el('div', { class: 'anr-carve-cell' });

    // Starts .is-plain (no zoom cursor): a cell that hasn't decoded yet must not
    // look clickable, or an early click does nothing.
    const thumb = el('div', { class: 'anr-carve-thumb is-plain' },
      el('span', { class: 'anr-hint', style: 'margin:0;' }, fmt));
    thumb._carveFile = file;
    thumb._carveFmt = fmt;

    // The buttons sit inside the thumbnail, which is itself a lightbox trigger -
    // so each one has to stop its click from also opening the lightbox.
    const actions = el('div', { class: 'anr-carve-actions' });
    if (onAnalyse) {
      const an = el('button', { type: 'button', class: 'anr-carve-btn' }, 'Analyse');
      an.addEventListener('click', (e) => { e.stopPropagation(); onAnalyse(); });
      actions.appendChild(an);
    }
    const dl = el('button', { type: 'button', class: 'anr-carve-btn' }, 'Download');
    dl.addEventListener('click', (e) => { e.stopPropagation(); downloadCarve(file); });
    actions.appendChild(dl);
    thumb.appendChild(actions);
    cell.appendChild(thumb);

    const dims = (width && height) ? width + ' × ' + height : '';
    cell.appendChild(el('div', { class: 'anr-carve-cap' },
      fmt + (dims ? '  ' + dims : '') + (complete === false ? '  · partial' : '')));

    io.observe(thumb);
    grid.appendChild(cell);
    return cell;
  }

  return { grid, add };
}
