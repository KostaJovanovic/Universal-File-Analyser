/* Analyser - photo module
   - File preview + basic info (size, MIME, dimensions, aspect ratio, megapixels)
   - Full EXIF / IPTC / XMP / ICC / GPS via exifr (global)
   - RGB color histogram (canvas)
   - Dominant colors (color quantization)
   - GPS map via lazy-loaded Leaflet + OSM
   - On-device OCR via lazy-loaded Tesseract.js with language picker
   - SHA-256 file hash */

import { el, row, rowHelp, fmtBytes, h3help, wireInfoToggle, fileExt, sha256Row, loadScript, loadCss, cloudFileWarning, errorCard, attachZoomPan, openOverlayBack, timeAnomalies, timeAnomalyCard, downloadBlob } from '../core/util.js';
import { HEIC_EXTS, RAW_EXTS } from '../core/formats.js';
import { convertHeic, extractRawPreview, convertWithImageMagick, demosaicRaw, extractRawJpegs, extractX3fPreview } from './photo-convert.js';
import { ascii, latin1, utf8, inflate, findBytes, hexByte, hexBytes } from '../core/binutil.js';
import { decodeGifFrames } from './gif-frames.js';
import { decodeWebpFrames } from './webp-frames.js';
import { ANIM_PIXEL_BUDGET } from '../core/limits.js';
import { encodeAnimatedGif } from './gif-encode.js';
import { buildIcoImagesCard } from './ico.js';
import { buildMpoImagesCard } from './mpo.js';
import { buildTiffPagesCard } from './tiff.js';
import { buildEmbeddedImagesCard } from './embedded-images.js';
import { computeElaCanvas, analyzeJpegQuantization, computeJpegGhosts, lsbChiSquare, parseXmpHistory, checkIptcDigest } from './photo-forensics.js';
import { diagnoseImage, repairJpeg, repairPng, decodePngPartial, extractJpegTables, spliceJpegHeader, rebuildHeaderlessJpeg, carveImages, repairHeifContainer, ensureJpegHuffman } from './photo-recover.js';
import { createCarveGallery } from './carve-gallery.js';
import { decodeJpegPartial } from './jpeg-salvage.js';
import { attachImageScrub } from './scrub.js';
import { buildC2paCard, readC2pa } from './c2pa.js';
import { buildAiSignalsCard } from './ai-signals.js';

// ---------- Browser-undecodable images ----------
// Some image formats a web browser has no decoder for, so an <img> can't paint
// them. When the decode fails (and the file is readable - not a cloud
// placeholder) we surface a clear "browser limitation" banner, like the ProRes
// video path, plus whatever metadata exifr can still read from the bytes -
// rather than a bare "couldn't load" error. Keyed by lowercase extension; the
// generic message covers anything not listed.
const UNDISPLAYABLE_IMAGES = {
  jxl: 'JPEG XL',
  tif: 'TIFF', tiff: 'TIFF',
  jp2: 'JPEG 2000', j2k: 'JPEG 2000', jpf: 'JPEG 2000', jpx: 'JPEG 2000', jpc: 'JPEG 2000', j2c: 'JPEG 2000',
  tga: 'Targa (TGA)', dds: 'DirectDraw Surface (DDS)', exr: 'OpenEXR', hdr: 'Radiance HDR', pic: 'Radiance HDR',
  pcx: 'PCX', sgi: 'SGI image', rgb: 'SGI image', ras: 'Sun Raster',
  xcf: 'GIMP XCF', psd: 'Photoshop PSD', psb: 'Photoshop PSB',
  cdr: 'CorelDRAW', wmf: 'Windows Metafile', emf: 'Enhanced Metafile', farbfeld: 'farbfeld',
};

function undecodableImageBanner(ext) {
  const name = UNDISPLAYABLE_IMAGES[ext];
  const msg = name
    ? name + ' images can’t be decoded by web browsers, so the picture can’t be shown here. The file is fine - convert it to PNG or JPEG to view it. Any metadata below was read straight from the file.'
    : 'Your browser can’t decode this image, so the picture can’t be shown here. The file itself may be fine - converting it to PNG or JPEG usually makes it viewable. Any metadata below was read straight from the file.';
  return el('div', { class: 'anr-info' }, msg);
}

// Banner for a camera RAW that none of the decoders (embedded preview, our IFD
// extractor, ImageMagick, libraw demosaic) could turn into pixels. The bytes are
// fine - the sensor format just isn't reconstructable here - so we still show the
// metadata below rather than a bare error.
function rawUndecodableBanner() {
  return el('div', { class: 'anr-info' },
    'This camera RAW couldn’t be turned into a picture here - there’s no usable embedded preview and the bundled decoders don’t support this sensor format. The file itself is fine; any metadata below was read straight from the bytes.');
}

// Shown when the browser can't display the image: the banner above (or a caller-
// supplied one), basic file info, and any EXIF/IPTC/XMP metadata exifr can still
// read from the raw bytes.
// ---------- broken / corrupt image salvage ----------
// The still-image twin of the video recovery path: when the browser refuses to
// paint a recognised image, photo-recover.js diagnoses the damage and we offer to
// salvage it - repair a truncated JPEG/PNG, rebuild a damaged JPEG header from a
// reference photo, or carve embedded images out of an unrecognised blob. The
// recovered picture is shown, downloadable, and can be re-run through the full
// photo analysis (opts.salvaged stops that re-render from looping back here).

// Probe whether a Blob/File decodes as an image in this browser (resolves boolean).
function imageDecodes(url) {
  return new Promise((res) => { const im = new Image(); im.onload = () => res(true); im.onerror = () => res(false); im.src = url; });
}
function rgbaToCanvas(rgba, w, h) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), w, h), 0, 0);
  return cv;
}
function canvasToPngFile(cv, name) {
  return new Promise((res) => cv.toBlob((b) => res(b ? new File([b], name, { type: 'image/png' }) : null), 'image/png'));
}

// Cheap gate: does the browser's decode look anything other than a clean photo? A
// corrupt JPEG never paints as a clean picture - it comes back with a grey "no data"
// band or saturated colour-block garbage - so a perfectly clean canvas means a healthy
// file and we can skip the (expensive) authoritative tolerant re-decode. Draw small,
// then flag any meaningful grey fill or high-chroma saturation. False alarms only cost
// the confirm step (which then finds nothing wrong); it never mislabels a real photo.
function browserCanvasSuspicious(img) {
  try {
    const nw = img.naturalWidth || 0, nh = img.naturalHeight || 0;
    if (!nw || !nh) return true;
    const s = Math.min(1, 384 / Math.max(nw, nh));
    const w = Math.max(1, Math.round(nw * s)), h = Math.max(1, Math.round(nh * s));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data, total = w * h;
    let grey = 0, garb = 0;
    for (let i = 0; i < d.length; i += 4) {
      const R = d[i], G = d[i + 1], B = d[i + 2];
      if (d[i + 3] === 0 || (Math.abs(R - 128) <= 2 && Math.abs(G - 128) <= 2 && Math.abs(B - 128) <= 2)) grey++;
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      if ((mx >= 250 || mn <= 5) && (mx - mn) >= 110) garb++;
    }
    return grey / total > 0.03 || garb / total > 0.06;
  } catch (_) { return true; }                          // tainted/unreadable - confirm to be safe
}

async function renderPhotoRecovery(file, bytes, diag, resultsEl, signal) {
  resultsEl.innerHTML = '';
  const base = (file.name || 'image').replace(/\.[^/.]+$/, '');

  const diagCard = el('div', { class: 'anr-card' });
  diagCard.appendChild(el('h3', {}, 'Broken image - salvage'));
  const t = el('table', { class: 'anr-readout' });
  t.appendChild(row('Name', file.name));
  t.appendChild(row('Size', fmtBytes(file.size) + '  (' + file.size.toLocaleString() + ' bytes)'));
  t.appendChild(rowHelp('Detected format', (diag.format || 'unrecognised data').toUpperCase(),
    'The file type worked out from the first few bytes inside the file (its ‘signature’), not from the name on the end of the filename. Salvage works on what the file really contains, not what its name claims.'));
  diagCard.appendChild(t);
  // The headerless case explains the damage (and the fix) once, in the Reference
  // photo card above - so skip the "What's wrong" restatement and the carving
  // blurb here (there's nothing to carve; it's a full header rebuild). Other
  // damage types keep the issue list and the salvage note.
  if (!diag.headerless) {
    diagCard.appendChild(el('p', { class: 'anr-hint', style: 'margin:10px 0 4px;' }, 'What’s wrong:'));
    const ul = el('ul', { style: 'margin:0; padding-left:18px;' });
    for (const is of (diag.issues || [])) ul.appendChild(el('li', { class: 'anr-hint', style: 'margin:2px 0;' }, is.msg));
    diagCard.appendChild(ul);
    diagCard.appendChild(el('p', { class: 'anr-hint', style: 'margin-top:10px;' },
      'Analyser can scoop up whatever still decodes and stitch it into a viewable image.'));
  }
  resultsEl.appendChild(diagCard);

  const out = el('div', { class: 'anr-card' });
  resultsEl.appendChild(out);

  // Show a recovered File: preview (if the browser can paint it), a download, and a
  // CTA to run the full photo analysis on it.
  async function present(recoveredFile, note, extra) {
    if (signal.aborted) return;
    const url = URL.createObjectURL(recoveredFile);
    const ok = await imageDecodes(url);
    out.appendChild(el('p', {}, note));
    if (ok) {
      out.appendChild(el('img', {
        src: url, alt: 'Recovered image', style: 'max-width:100%; display:block; border:1px solid var(--hairline); margin-top:10px; cursor:zoom-in;',
        onclick: () => openLightbox(url, 'Recovered image', 'Recovered image', null, false, false),
      }));
    } else {
      out.appendChild(el('p', { class: 'anr-hint' }, 'The recovered file can’t be shown inline in this browser, but the download below opens in desktop viewers (GIMP, Photoshop, IrfanView).'));
    }
    const analyse = el('button', { type: 'button', class: 'anr-btn anr-btn--cta' }, 'Run full analysis');
    analyse.addEventListener('click', () => renderPhoto(recoveredFile, resultsEl, { salvaged: true, sourceFile: file }));
    const dl = el('a', { class: 'anr-btn', href: url, download: recoveredFile.name }, 'Download recovered image');
    out.appendChild(el('div', { class: 'anr-btn-row', style: 'margin-top:12px;' }, [analyse, dl, ...(extra || [])]));
  }

  // ---- JPEG ----
  if (diag.format === 'jpeg') {
    // Headerless scan: the whole header is gone, only entropy data survives. There's
    // nothing to repair in-place - it only decodes once a full header (SOI..SOS) is
    // borrowed from a healthy same-camera photo. Same picker UX as the damaged-header
    // case below, but it rebuilds via rebuildHeaderlessJpeg (the reference's SOS too).
    if (diag.headerless) {
      // A headerless JPEG has no signature, so app.js prepends a red "Signature
      // mismatch" card at the top. Lead the renderer's own output with the
      // reference picker so it sits directly under that card - it's the one
      // action that gets the picture back - and keep the diagnosis below it.
      resultsEl.insertBefore(out, diagCard);
      {
        const [rpH, rpHelp] = h3help('Reference photo needed',
          'The JPEG header is gone - only the compressed image data survives. Analyser rebuilds a working header from your reference photo so this file decodes. How much of the picture returns depends on how much was lost with the header.');
        out.appendChild(rpH); out.appendChild(rpHelp);
      }
      out.appendChild(el('p', { class: 'anr-hint' },
        'Pick a healthy photo from the same camera - same resolution and mode:'));
      const inp = el('input', { type: 'file', accept: 'image/jpeg,.jpg,.jpeg', style: 'display:none' });
      const pick = el('button', { type: 'button', class: 'anr-btn' }, 'Choose reference photo…');
      pick.addEventListener('click', () => inp.click());
      out.appendChild(el('div', { class: 'anr-btn-row' }, [inp, pick]));
      const note = el('p', { class: 'anr-hint' }, '');
      out.appendChild(note);
      inp.addEventListener('change', async () => {
        const ref = inp.files && inp.files[0];
        if (!ref) return;
        pick.textContent = ref.name;
        note.textContent = 'Rebuilding the header from “' + ref.name + '”…';
        let rebuilt = null;
        try { rebuilt = rebuildHeaderlessJpeg(bytes, new Uint8Array(await ref.arrayBuffer())); } catch (_) {}
        if (!rebuilt || !rebuilt.data) { note.textContent = 'Couldn’t read a usable header from that photo. Pick a healthy JPEG from the same camera.'; return; }
        note.innerHTML = '';
        const f = new File([rebuilt.data], base + '.recovered.jpg', { type: 'image/jpeg' });
        await present(f, 'Rebuilt the missing header using “' + ref.name + '” (' + (rebuilt.width || '?') + ' × ' + (rebuilt.height || '?') + '). Any part of the picture lost with the header appears corrupted or blank.');
      });
      return;
    }
    // Tolerant decode first: a JPEG whose scan is truncated or corrupt partway is
    // rendered as NOTHING by the browser (it refuses the whole image). The built-in
    // fault-tolerant decoder (jpeg-salvage.js) recovers the rows that survive and
    // re-encodes them as a clean PNG the browser will show - the same approach the
    // PNG branch below uses. Only take over for a genuinely partial result; a full
    // decode falls through to repairJpeg, which keeps the original EXIF and quality.
    try {
      const dec = decodeJpegPartial(bytes);
      // Desync-into-garbage: the scan keeps decoding past the point it derailed, so the
      // lower picture is saturated colour-block noise. Show that raw decode (it's what a
      // system viewer paints) but say plainly how much is the real image and that the
      // rest is decoder noise, not the actual photo.
      if (dec && dec.corrupt && dec.realRows > 0) {
        const cv = rgbaToCanvas(dec.data, dec.width, dec.height);
        const f = await canvasToPngFile(cv, base + '.recovered.png');
        if (f) {
          const pct = Math.round((dec.realRows / dec.height) * 100);
          await present(f, 'The top ' + pct + '% of this picture (' + dec.realRows.toLocaleString() + ' of ' + dec.height.toLocaleString() + ' rows) is the real image. Below the break the JPEG scan is corrupt - what shows there is decoder noise from the dead data, not the real photo, and the lost part cannot be recovered.');
          return;
        }
      }
      if (dec && dec.rows > 0 && (dec.thumb || dec.rows < dec.height)) {
        const cv = rgbaToCanvas(dec.data, dec.width, dec.height);
        const f = await canvasToPngFile(cv, base + (dec.thumb ? '.thumbnail.png' : '.recovered.png'));
        if (f) {
          const msg = dec.thumb
            ? 'The full-size image could not be decoded - its data is truncated or overwritten - but the file’s embedded thumbnail survived in the header and is shown: a ' + dec.width + ' × ' + dec.height + ' preview of the picture.'
            : 'Recovered the top ' + Math.round((dec.rows / dec.height) * 100) + '% of the picture (' + dec.rows.toLocaleString() + ' of ' + dec.height.toLocaleString() + ' rows) with the built-in tolerant decoder. The rest was truncated, corrupt or overwritten and shows as grey.';
          await present(f, msg);
          return;
        }
      }
    } catch (_) {}
    const rep = repairJpeg(bytes);
    if (rep.ok && !rep.needsReference && rep.data) {
      const f = new File([rep.data], base + '.recovered.jpg', { type: 'image/jpeg' });
      await present(f, 'Recovered - ' + rep.actions.join('; ').replace(/^(.)/, (m) => m.toLowerCase()) + '. The decodable part of the picture is shown; any cut-off region appears blank.');
      return;
    }
    if (rep.needsReference) {
      {
        const [rpH, rpHelp] = h3help('Reference photo needed',
          'The JPEG header (its quantisation / Huffman tables) is damaged, so the picture data can’t be decoded on its own. Analyser rebuilds the header from your reference so the scan data decodes.');
        out.appendChild(rpH); out.appendChild(rpHelp);
      }
      out.appendChild(el('p', { class: 'anr-hint' },
        'Pick a healthy photo from the same camera, shot in the same mode:'));
      const inp = el('input', { type: 'file', accept: 'image/jpeg,.jpg,.jpeg', style: 'display:none' });
      const pick = el('button', { type: 'button', class: 'anr-btn' }, 'Choose reference photo…');
      pick.addEventListener('click', () => inp.click());
      out.appendChild(el('div', { class: 'anr-btn-row' }, [inp, pick]));
      const note = el('p', { class: 'anr-hint' }, '');
      out.appendChild(note);
      inp.addEventListener('change', async () => {
        const ref = inp.files && inp.files[0];
        if (!ref) return;
        pick.textContent = ref.name;
        note.textContent = 'Borrowing tables from “' + ref.name + '”…';
        let tables = null;
        try { tables = extractJpegTables(new Uint8Array(await ref.arrayBuffer())); } catch (_) {}
        if (!tables) { note.textContent = 'Couldn’t read tables from that photo. Pick a healthy JPEG from the same camera.'; return; }
        const spliced = spliceJpegHeader(bytes, tables);
        if (!spliced) { note.textContent = 'Couldn’t rebuild the header - no scan data could be located in the broken file.'; return; }
        note.innerHTML = '';
        const f = new File([spliced], base + '.recovered.jpg', { type: 'image/jpeg' });
        await present(f, 'Rebuilt the damaged header using tables borrowed from “' + ref.name + '” (' + (tables.width || '?') + ' × ' + (tables.height || '?') + ').');
      });
      return;
    }
    out.appendChild(el('p', { class: 'anr-hint' }, 'Could not salvage this JPEG: ' + (rep.reason || 'no recoverable scan data') + '.'));
    return;
  }

  // ---- PNG ----
  if (diag.format === 'png') {
    let done = false;
    try {
      const dec = await decodePngPartial(bytes);
      if (dec && dec.rowsRecovered > 0) {
        const cv = rgbaToCanvas(dec.rgba, dec.width, dec.height);
        const f = await canvasToPngFile(cv, base + '.recovered.png');
        if (f) {
          const pct = Math.round((dec.rowsRecovered / dec.height) * 100);
          await present(f, 'Recovered ' + dec.rowsRecovered.toLocaleString() + ' of ' + dec.height.toLocaleString() + ' rows (' + pct + '%) and re-encoded them as a clean PNG. Any unrecovered rows are blank.');
          done = true;
        }
      }
    } catch (_) {}
    if (!done) {
      const rep = repairPng(bytes);
      if (rep.ok && rep.data) {
        const f = new File([rep.data], base + '.recovered.png', { type: 'image/png' });
        await present(f, 'Repaired the PNG container - ' + rep.actions.join('; ').replace(/^(.)/, (m) => m.toLowerCase()) + '.');
      } else {
        out.appendChild(el('p', { class: 'anr-hint' }, 'Could not salvage this PNG: ' + ((rep && rep.reason) || 'unreadable') + '.'));
      }
    }
    return;
  }

  // ---- HEIF / HEIC / AVIF ----
  // These store metadata at the front, so a tail-truncated file keeps a decodable
  // image - libheif / the browser recover the surviving tiles once the over-large
  // mdat box is clamped to the real file length.
  if (diag.format === 'heif' || diag.format === 'avif') {
    const rep = repairHeifContainer(bytes);
    const note = rep.truncated ? 'Repaired the container (' + rep.actions.join('; ').replace(/^(.)/, (m) => m.toLowerCase()) + '); decoding the tiles that survived.' : 'Attempting to decode the damaged file.';
    if (diag.format === 'avif') {
      const f = new File([rep.data], base + '.recovered.avif', { type: 'image/avif' });
      await present(f, note + ' Any lost region appears blank.');
      return;
    }
    const f = new File([rep.data], base + '.recovered.heic', { type: 'image/heic' });
    try {
      const jpg = await convertHeic(f);
      await present(jpg, note + ' Converted the recovered tiles to JPEG; any lost region appears blank.');
    } catch (e) {
      out.appendChild(el('p', { class: 'anr-hint' }, 'Could not decode this HEIC even after repair (' + ((e && e.message) || e) + ') - it may be too damaged, or its front-stored metadata was lost. The repaired file below may still open in a desktop viewer.'));
      const url = URL.createObjectURL(f);
      out.appendChild(el('div', { class: 'anr-btn-row', style: 'margin-top:10px;' }, [el('a', { class: 'anr-btn', href: url, download: f.name }, 'Download repaired file')]));
    }
    return;
  }

  // ---- carving (unrecognised blob / wrong extension / disk fragment) ----
  const carved = (diag.carved && diag.carved.length) ? diag.carved : carveImages(bytes);
  out.appendChild(el('p', {}, 'Found ' + carved.length + ' embedded image' + (carved.length === 1 ? '' : 's') + ' in the data:'));
  // Bare thumbnails with their Analyse / Download actions overlaid on hover, each
  // decoding lazily as it scrolls into view - so the rest of the salvage report
  // never waits on them (carve-gallery.js).
  const gallery = createCarveGallery();
  gallery.grid.style.marginTop = '10px';
  const MIME = { jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
  for (let k = 0; k < carved.length; k++) {
    const c = carved[k];
    let sub = bytes.subarray(c.start, c.end);
    if (c.format === 'jpeg') {
      const r = repairJpeg(sub); if (r.data) sub = r.data;   // append EOI to a cut-off carve
      sub = ensureJpegHuffman(sub);                          // graft standard tables onto a tableless MJPEG frame
    }
    const cf = new File([sub], 'carved_' + (k + 1) + '.' + c.format, { type: MIME[c.format] || 'application/octet-stream' });
    gallery.add({
      file: cf, format: c.format, width: c.width, height: c.height, complete: c.complete,
      onAnalyse: () => renderPhoto(cf, resultsEl, { salvaged: true, sourceFile: file }),
    });
  }
  out.appendChild(gallery.grid);
}

async function renderUndisplayableImage(file, ext, resultsEl, bannerNode) {
  resultsEl.appendChild(bannerNode || undecodableImageBanner(ext));
  const info = el('div', { class: 'anr-card' });
  info.appendChild(el('h3', {}, 'File info'));
  const t = el('table', { class: 'anr-readout' });
  t.appendChild(row('Name', file.name));
  t.appendChild(row('Size', fmtBytes(file.size) + '  (' + file.size.toLocaleString() + ' bytes)'));
  t.appendChild(rowHelp('MIME', file.type || '-', "The MIME type is a short standard label for the kind of file this is, such as image/jpeg. Your browser guesses it from the filename or the operating system, so it is a hint about the format, not proof."));
  info.appendChild(t);
  resultsEl.appendChild(info);
  let exif = null;
  try {
    exif = await exifr.parse(file, { tiff: true, exif: true, gps: true, iptc: true, xmp: true, icc: true, mergeOutput: true, translateValues: true, translateKeys: true, reviveValues: true, sanitize: true, silentErrors: true });
  } catch (_) {}
  if (exif && typeof exif === 'object') {
    const entries = Object.entries(exif).filter(([k, v]) => v != null && (typeof v !== 'object' || v instanceof Date)).slice(0, 80);
    if (entries.length) {
      const card = el('div', { class: 'anr-card' });
      card.appendChild(el('h3', {}, 'Metadata'));
      const mt = el('table', { class: 'anr-readout' });
      for (const [k, v] of entries) mt.appendChild(row(k, v instanceof Date ? v.toLocaleString() : String(v)));
      card.appendChild(mt);
      resultsEl.appendChild(card);
    }
  }
}

const JSQR_URL      = 'assets/vendor/jsQR.js';
const TESSERACT_URL = 'assets/vendor/tesseract/tesseract.min.js';
const LEAFLET_CSS   = 'assets/vendor/leaflet/leaflet.css';
const LEAFLET_JS    = 'assets/vendor/leaflet/leaflet.js';

// OCR languages. Only English is bundled with the app (works fully offline);
// every other language is fetched from a CDN on demand and cached by the
// service worker after first use. LOCAL_OCR_LANGS decides which langPath a
// worker uses; keeping only English bundled keeps the repo small and well
// under Cloudflare's 25 MiB asset cap.
export const LOCAL_OCR_LANGS = new Set(['eng']);
export const TESS_CDN_LANGPATH = 'https://tessdata.projectnaptha.com/4.0.0';

// English first (the only bundled/offline language), then Serbian Latin and
// Cyrillic (primary audience), then every other language alphabetically by name.
export const TESSERACT_LANGS = [
  ['eng', 'English', '10 MB'],
  ['srp_latn', 'Serbian (Latin)', '2 MB'],
  ['srp', 'Serbian (Cyrillic)', '2 MB'],
  ['ara', 'Arabic', '2 MB'],
  ['bul', 'Bulgarian', '2 MB'],
  ['chi_sim', 'Chinese (Simplified)', '18 MB'],
  ['chi_tra', 'Chinese (Traditional)', '25 MB'],
  ['hrv', 'Croatian', '2 MB'],
  ['ces', 'Czech', '3 MB'],
  ['dan', 'Danish', '4 MB'],
  ['nld', 'Dutch', '5 MB'],
  ['fin', 'Finnish', '4 MB'],
  ['fra', 'French', '9 MB'],
  ['deu', 'German', '9 MB'],
  ['ell', 'Greek', '2 MB'],
  ['heb', 'Hebrew', '2 MB'],
  ['hun', 'Hungarian', '4 MB'],
  ['ita', 'Italian', '8 MB'],
  ['jpn', 'Japanese', '14 MB'],
  ['kor', 'Korean', '5 MB'],
  ['mkd', 'Macedonian', '1 MB'],
  ['nor', 'Norwegian', '4 MB'],
  ['pol', 'Polish', '4 MB'],
  ['por', 'Portuguese', '8 MB'],
  ['ron', 'Romanian', '2 MB'],
  ['rus', 'Russian', '11 MB'],
  ['slk', 'Slovak', '3 MB'],
  ['slv', 'Slovenian', '2 MB'],
  ['spa', 'Spanish', '9 MB'],
  ['swe', 'Swedish', '3 MB'],
  ['tur', 'Turkish', '4 MB'],
  ['ukr', 'Ukrainian', '3 MB']
];

// Tesseract langPath for a code: bundled English loads locally (offline); every
// other language streams from the CDN (then the service worker caches it).
export function ocrLangPath(code) {
  return LOCAL_OCR_LANGS.has(code) ? 'assets/vendor/tesseract' : TESS_CDN_LANGPATH;
}

// Where the trained-data file for a language lives (used both to load it and to
// check whether it has already been downloaded into the cache).
function ocrLangDataUrl(code) {
  return ocrLangPath(code) + '/' + code + '.traineddata.gz';
}

// Has this language's trained data already been downloaded (cached by the
// service worker)? Bundled English is always available offline.
async function ocrLangCached(code) {
  if (LOCAL_OCR_LANGS.has(code)) return true;
  if (typeof caches === 'undefined') return false;
  try {
    const hit = await caches.match(ocrLangDataUrl(code), { ignoreSearch: true });
    return !!hit;
  } catch (_) {
    return false;
  }
}

// Size/status span for a language menu item. Languages already available offline
// (bundled or previously cached) show nothing - just the language name. Only
// languages that still need fetching show a "[size · download]" hint.
function ocrLangSizeSpan(code, size) {
  const span = el('span', { class: 'anr-dropdown-item-size' }, '');
  ocrLangCached(code).then((cached) => {
    if (LOCAL_OCR_LANGS.has(code) || cached) {
      span.textContent = '';
    } else {
      span.textContent = '[' + size + ' · download]';
    }
  });
  return span;
}

// Modal language picker for OCR, reused wherever OCR is started outside the
// inline image picker (e.g. the PDF page-OCR popup). Same language menu as the
// image OCR dropdown. Resolves with the chosen Tesseract code, or null if the
// user cancels (Esc / backdrop / Cancel).
let _sessionOcrLang = null;

// What OCR is and its caveats - shown via the "?" button in the language picker.
const OCR_HELP_HTML = '<strong>Optical Character Recognition</strong> scans the image for text using <a href="https://github.com/naptha/tesseract.js" target="_blank" rel="noopener">Tesseract.js</a>, an open-source OCR engine running entirely in your browser.<br><br><strong>How it works:</strong> the image is upscaled if needed, then Tesseract looks for letter-shaped patterns, groups them into words and lines, and assigns a confidence score to each word. Words below 60% confidence are filtered out to reduce noise.<br><br><strong>Limitations:</strong> Tesseract was designed for scanned documents - clean text on plain backgrounds. On photos it will often hallucinate text from textures, foliage, buildings, or noise. Handwriting, stylised fonts, low contrast, small text, and rotated or curved text all reduce accuracy significantly. Results are best on screenshots, signs, printed labels, and document photos.';

export function pickOcrLanguage(opts = {}) {
  // Once "Remember for this session" is ticked, skip the popup and reuse that
  // language for every OCR until the page is reloaded.
  if (_sessionOcrLang) return Promise.resolve(_sessionOcrLang);
  return new Promise((resolve) => {
    let selected = 'eng';
    const remember = el('input', { type: 'checkbox' });
    const backdrop = el('div', { class: 'anr-ocr-lang', role: 'dialog', 'aria-modal': 'true' });
    const panel = el('div', { class: 'anr-ocr-lang-inner' });
    const head = el('div', { class: 'anr-ocr-lang-head' }, [
      el('h3', {}, opts.title || 'OCR language'),
      el('button', { type: 'button', class: 'fmt-overlay-close', 'aria-label': 'Cancel' }, '×')
    ]);
    panel.appendChild(head);
    const hintP = el('p', { class: 'anr-hint', style: 'margin:0 20px 12px;' },
      'Pick the language of the text - English works offline; others download once, then stay cached.');
    panel.appendChild(hintP);
    const list = el('ul', { class: 'anr-ocr-lang-list' });
    const items = [];
    for (const [code, name, size] of TESSERACT_LANGS) {
      const item = el('li', { class: 'anr-dropdown-item' + (code === 'eng' ? ' is-selected' : '') }, [
        el('span', {}, name),
        ocrLangSizeSpan(code, size)
      ]);
      item.dataset.value = code;
      item.addEventListener('click', () => {
        selected = code;
        items.forEach((li) => li.classList.remove('is-selected'));
        item.classList.add('is-selected');
      });
      item.addEventListener('dblclick', () => confirm(code));
      items.push(item);
      list.appendChild(item);
    }
    panel.appendChild(list);
    // "?" help text occupies the same area as the language list: clicking the
    // info button swaps the list (and its hint) for this panel, and back.
    const helpPanel = el('div', { class: 'anr-ocr-lang-help-panel', html: OCR_HELP_HTML });
    helpPanel.hidden = true;
    panel.appendChild(helpPanel);
    const rememberRow = el('label', { class: 'anr-ocr-lang-remember' }, [
      remember, el('span', {}, 'Remember for this session')
    ]);
    panel.appendChild(rememberRow);
    const helpBtn = el('button', { type: 'button', class: 'anr-ocr-lang-help', 'aria-label': 'About OCR' }, '?');
    helpBtn.addEventListener('click', () => {
      const showHelp = helpPanel.hidden;   // about to open the help
      helpPanel.hidden = !showHelp;
      list.hidden = showHelp;
      hintP.hidden = showHelp;
      helpBtn.classList.toggle('is-active', showHelp);
    });
    const cancelBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Cancel');
    const runBtn = el('button', { type: 'button', class: 'anr-btn anr-ocr-lang-run' }, 'Run OCR');
    panel.appendChild(el('div', { class: 'anr-ocr-lang-actions' }, [helpBtn, cancelBtn, runBtn]));
    backdrop.appendChild(panel);

    let resultVal = null;
    function finish() {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      resolve(resultVal);
    }
    // Pushing a history entry lets the device Back button cancel the picker; the
    // returned closer both hides it and unwinds that entry, whatever the outcome.
    const backClose = openOverlayBack(finish);
    function close(val) { resultVal = val; backClose(); }
    // Run with a language; if "Remember" is ticked, persist it for the session.
    function confirm(code) {
      if (remember.checked) _sessionOcrLang = code;
      close(code);
    }
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    head.querySelector('.fmt-overlay-close').addEventListener('click', () => close(null));
    cancelBtn.addEventListener('click', () => close(null));
    runBtn.addEventListener('click', () => confirm(selected));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(backdrop);
    runBtn.focus();
  });
}

// ---------- helpers ----------
function gcd(a, b) { return b ? gcd(b, a % b) : a; }

function aspectRatio(w, h) {
  if (!w || !h) return '-';
  const d = gcd(w, h);
  return `${w / d}:${h / d}  (${(w / h).toFixed(4)})`;
}

// Decode a blob to its pixel dimensions via a throwaway <img>. Used by the EXIF
// thumbnail-proportion check; resolves null if the browser can't decode it.
function decodeImageDims(blob) {
  return new Promise((resolve) => {
    const u = URL.createObjectURL(blob);
    const im = new Image();
    im.onload = () => { const d = { w: im.naturalWidth, h: im.naturalHeight }; URL.revokeObjectURL(u); resolve(d); };
    im.onerror = () => { URL.revokeObjectURL(u); resolve(null); };
    im.src = u;
  });
}

// The exact reduced ratio is often an ugly fraction (e.g. a 4288×2848 sensor is
// 134:89). Snap the decimal to the nearest standard photo/video ratio so there's
// a recognisable "≈ 3:2" to read next to it. Returns null when nothing common is
// close enough (a genuinely odd crop), so we don't invent a misleading label.
const COMMON_ASPECTS = [
  [1, 1], [6, 5], [5, 4], [4, 3], [7, 5], [3, 2], [14, 9], [16, 10],
  [5, 3], [16, 9], [2, 1], [21, 9], [7, 3], [5, 2], [3, 1],
];
function approxAspect(w, h) {
  if (!w || !h) return null;
  const landscape = w >= h;
  const r = landscape ? w / h : h / w;   // normalise to >= 1, re-orient on output
  let best = null, bestErr = Infinity;
  for (const [a, b] of COMMON_ASPECTS) {
    const err = Math.abs((a / b) - r);
    if (err < bestErr) { bestErr = err; best = [a, b]; }
  }
  if (bestErr / r > 0.04) return null;   // nothing standard within ~4%
  const [a, b] = best;
  return landscape ? `${a}:${b}` : `${b}:${a}`;
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image')); };
    img.src = url;
  });
}

// ---------- exif formatting ----------
const ORIENTATIONS = {
  1: 'Normal',
  2: 'Mirrored',
  3: 'Rotated 180°',
  4: 'Mirrored + rotated 180°',
  5: 'Mirrored + rotated 90° CW',
  6: 'Rotated 90° CW',
  7: 'Mirrored + rotated 90° CCW',
  8: 'Rotated 90° CCW'
};
const EXP_PROG = { 0:'Not defined',1:'Manual',2:'Program AE',3:'Aperture priority',4:'Shutter priority',5:'Creative',6:'Action',7:'Portrait',8:'Landscape' };
const METERING = { 0:'Unknown',1:'Average',2:'Centre-weighted',3:'Spot',4:'Multi-spot',5:'Pattern',6:'Partial',255:'Other' };
const WHITE_BAL = { 0:'Auto',1:'Manual' };

function fmtShutter(s) {
  if (s == null) return null;
  if (s >= 1) return s + ' s';
  return '1/' + Math.round(1 / s) + ' s';
}
function fmtFNumber(n)    { return n != null ? 'f/' + (+n).toFixed(1) : null; }
function fmtFocal(mm)     { return mm != null ? (+mm).toFixed(1) + ' mm' : null; }
function fmtExpComp(ev)   { return ev != null ? (ev > 0 ? '+' : '') + (+ev).toFixed(1) + ' EV' : null; }
function fmtDate(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().replace('T', ' ').replace(/\..*$/, '');
  return String(d);
}

// Locate the TIFF header `sonyShutterCount` should treat as its base: 0 for a
// RAW/TIFF file (starts with the byte-order mark), or - for a JPEG - the offset
// just past the "Exif\0\0" tag in the APP1 segment, since a JPEG's maker-note
// offsets are relative to that embedded TIFF header rather than the file start.
// Returns -1 if neither is found.
function tiffBaseOf(buf) {
  const dv = new DataView(buf), len = buf.byteLength;
  if (len < 4) return -1;
  const b0 = dv.getUint16(0, false);
  if (b0 === 0x4949 || b0 === 0x4D4D) return 0;        // TIFF / RAW
  if (b0 !== 0xFFD8) return -1;                        // not a JPEG either
  let p = 2;
  while (p + 4 <= len) {
    if (dv.getUint8(p) !== 0xFF) break;
    const marker = dv.getUint8(p + 1);
    if (marker === 0xDA || marker === 0xD9) break;      // SOS / EOI - no more metadata
    const segLen = dv.getUint16(p + 2, false);
    if (segLen < 2) break;
    if (marker === 0xE1 && p + 10 <= len &&             // APP1, check for "Exif\0\0"
        dv.getUint32(p + 4, false) === 0x45786966 && dv.getUint16(p + 8, false) === 0x0000) {
      return p + 10;
    }
    p += 2 + segLen;
  }
  return -1;
}

// Sony hides the lifetime shutter-actuation count in an *encrypted* maker-note
// block (Tag 0x9050) that exifr doesn't decode - so on Sony photos we dig it out
// ourselves. The block is obfuscated with Sony's substitution cipher
// (decipher[(i*i*i) % 249] = i for i < 249, identity above); once decrypted the
// count is a 32-bit int whose offset depends on the body: 0x3a on newer models
// (ExifTool's "Tag9050b") and 0x32 on older NEX / first-gen ones ("Tag9050a"), so
// we read both and take the first plausible value. Verified against an ILCE-6400A
// (0x3a) and a NEX-6 (0x32); other modern Alpha bodies (A7/A7R/A7S, A6000-A6600,
// A9, ...) share the Tag9050b layout per ExifTool and should resolve the same way,
// but aren't individually tested - the range check below keeps an unexpected
// layout from yielding a bogus number rather than nothing. Works on both RAW
// (ARW/SR2) and JPEG; `buf` is the file's ArrayBuffer. Returns the count, or null
// if the file isn't laid out as expected, so we never show a guessed number.
function sonyShutterCount(buf) {
  try {
    const base = tiffBaseOf(buf);
    if (base < 0) return null;
    const dv = new DataView(buf);
    const len = buf.byteLength;
    if (base + 16 > len) return null;
    const bo = dv.getUint16(base, false);
    const le = bo === 0x4949;                 // 'II' little-endian; 'MM' big-endian
    if (!le && bo !== 0x4D4D) return null;
    const u16 = (o) => (o >= 0 && o + 2 <= len ? dv.getUint16(o, le) : -1);
    const u32 = (o) => (o >= 0 && o + 4 <= len ? dv.getUint32(o, le) : -1);
    if (u16(base + 2) !== 42) return null;    // TIFF magic
    const TS = { 1:1, 2:1, 3:2, 4:4, 5:8, 6:1, 7:1, 8:2, 9:4, 10:8, 11:4, 12:8 };
    // `ifd` is an absolute file position; stored offsets are relative to `base`.
    const findEntry = (ifd, tag) => {
      if (ifd <= 0 || ifd + 2 > len) return null;
      const n = u16(ifd);
      if (n < 0 || n > 4096) return null;
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > len) break;
        if (u16(e) === tag) {
          const type = u16(e + 2), count = u32(e + 4);
          const size = (TS[type] || 1) * count;
          return { type, count, size, off: size <= 4 ? e + 8 : base + u32(e + 8) };
        }
      }
      return null;
    };
    const exifP = findEntry(base + u32(base + 4), 0x8769);   // IFD0 -> Exif IFD pointer
    if (!exifP) return null;
    const maker = findEntry(base + u32(exifP.off), 0x927C);  // Exif IFD -> MakerNote
    if (!maker || maker.size < 64) return null;
    // Newer Sony bodies store the maker-note IFD directly; some prefix a header.
    let t9050 = null;
    for (const mb of [maker.off, maker.off + 12]) { t9050 = findEntry(mb, 0x9050); if (t9050) break; }
    if (!t9050 || t9050.size < 0x3e || t9050.off < 0 || t9050.off + t9050.size > len) return null;
    const dec = new Uint8Array(256);
    for (let i = 0; i < 249; i++) dec[(i * i * i) % 249] = i;
    for (let i = 249; i < 256; i++) dec[i] = i;
    const src = new Uint8Array(buf, t9050.off, t9050.size);
    const out = new Uint8Array(t9050.size);
    for (let i = 0; i < t9050.size; i++) out[i] = dec[src[i]];
    const odv = new DataView(out.buffer);
    for (const off of [0x3a, 0x32]) {        // Tag9050b (modern), then Tag9050a (older)
      if (off + 4 > t9050.size) continue;
      const count = odv.getUint32(off, le);
      if (count >= 1 && count <= 9_999_999) return count;
    }
    return null;
  } catch (_) { return null; }
}

// Nikon writes a *plaintext* shutter-actuation count in its maker note at tag
// 0x00A7 (int32u) - no decryption needed (unlike Sony). The modern "type 3"
// Nikon maker note begins with a "Nikon\0" signature + 2-byte version + 2 pad
// bytes (10 bytes), then its OWN embedded TIFF header whose internal offsets are
// relative to that embedded header - so we parse the inner TIFF and read 0x00A7.
// Built to Nikon's documented (ExifTool) layout and range-validated, so an
// unexpected file yields null rather than a wrong number. Works on RAW (NEF) and
// JPEG; `buf` is the file's ArrayBuffer. NOTE: validated structurally (synthetic
// file + the outer/inner offset maths) but not yet against a real Nikon sample.
function nikonShutterCount(buf) {
  try {
    const base = tiffBaseOf(buf);
    if (base < 0) return null;
    const dv = new DataView(buf), len = buf.byteLength;
    if (base + 16 > len) return null;
    const oLE = dv.getUint16(base, false) === 0x4949;
    const ou16 = (o) => (o >= 0 && o + 2 <= len ? dv.getUint16(o, oLE) : -1);
    const ou32 = (o) => (o >= 0 && o + 4 <= len ? dv.getUint32(o, oLE) : -1);
    if (ou16(base + 2) !== 42) return null;
    const TS = { 1:1, 2:1, 3:2, 4:4, 5:8, 6:1, 7:1, 8:2, 9:4, 10:8, 11:4, 12:8 };
    // Find `tag` in the IFD at absolute position `ifd`; `b` is the TIFF base its
    // stored data offsets are relative to. `valPos` is where the inline value sits.
    const findEntry = (ifd, tag, u16, u32, b) => {
      if (ifd <= 0 || ifd + 2 > len) return null;
      const n = u16(ifd);
      if (n < 0 || n > 4096) return null;
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > len) break;
        if (u16(e) === tag) {
          const type = u16(e + 2), count = u32(e + 4);
          const size = (TS[type] || 1) * count;
          return { type, count, size, valPos: e + 8, off: size <= 4 ? e + 8 : b + u32(e + 8) };
        }
      }
      return null;
    };
    // Outer TIFF: IFD0 -> Exif IFD -> MakerNote.
    const exifP = findEntry(base + ou32(base + 4), 0x8769, ou16, ou32, base);
    if (!exifP) return null;
    const maker = findEntry(base + ou32(exifP.off), 0x927C, ou16, ou32, base);
    if (!maker || maker.off < 0 || maker.off + 12 > len) return null;
    const mo = maker.off;
    // "Nikon\0" signature (type 3 maker note).
    const sig = [0x4E, 0x69, 0x6B, 0x6F, 0x6E, 0x00];
    for (let i = 0; i < 6; i++) if (dv.getUint8(mo + i) !== sig[i]) return null;
    // Embedded TIFF header at mo+10; inner offsets are relative to it.
    const tb = mo + 10;
    if (tb + 8 > len) return null;
    const iBO = dv.getUint16(tb, false);
    const iLE = iBO === 0x4949;
    if (!iLE && iBO !== 0x4D4D) return null;
    const iu16 = (o) => (o >= 0 && o + 2 <= len ? dv.getUint16(o, iLE) : -1);
    const iu32 = (o) => (o >= 0 && o + 4 <= len ? dv.getUint32(o, iLE) : -1);
    if (iu16(tb + 2) !== 42) return null;
    const sc = findEntry(tb + iu32(tb + 4), 0x00A7, iu16, iu32, tb);
    if (!sc) return null;
    const v = iu32(sc.valPos);     // ShutterCount is int32u, stored inline
    return (v >= 1 && v <= 9_999_999) ? v : null;
  } catch (_) { return null; }
}

// Brand dispatch for the maker-note shutter-count readers above.
function readShutterCount(buf, make) {
  if (/sony/i.test(make))  return sonyShutterCount(buf);
  if (/nikon/i.test(make)) return nikonShutterCount(buf);
  return null;
}

function buildExifSections(exif) {
  if (!exif) return [];
  const sections = [];

  const camera = [];
  if (exif.Make)             camera.push(['Make', exif.Make]);
  if (exif.Model)            camera.push(['Model', exif.Model]);
  if (exif.LensMake)         camera.push(['Lens make', exif.LensMake]);
  if (exif.LensModel)        camera.push(['Lens', exif.LensModel]);
  if (exif.Software)         camera.push(['Software', exif.Software]);
  if (exif.SerialNumber)     camera.push(['Body s/n', exif.SerialNumber]);
  if (exif.LensSerialNumber) camera.push(['Lens s/n', exif.LensSerialNumber]);
  // Shutter actuation count - cameras that record it keep it under various
  // maker-note names; surface the first present positive value. This is the
  // camera body's lifetime shutter wear (useful when buying a used camera).
  const shutter = [exif.ShutterCount, exif.ShutterCount2, exif.MechanicalShutterCount,
    exif.ImageCount, exif.ActuationCount, exif.TotalShutterReleases, exif.ShutterCounter,
    exif.ImageNumber, exif.FileNumber].find((v) => v != null && Number(v) > 0);
  if (shutter != null) camera.push(['Shutter count', Number(shutter).toLocaleString() + ' actuations', 'How many photos the camera body has taken in its lifetime (each shot trips the shutter once). Useful second-hand, as a rough gauge of wear.']);
  if (camera.length) sections.push({ title: 'Camera & lens', rows: camera });

  const exposure = [];
  if (exif.ISO != null)               exposure.push(['ISO', exif.ISO, 'How sensitive the camera’s sensor was set to be. A higher number (say 3200) copes with darker light but adds grain or noise; a lower number (say 100) is cleaner.']);
  if (exif.FNumber != null)           exposure.push(['Aperture', fmtFNumber(exif.FNumber), 'How wide the lens opening was, written as an f-number. A lower number (like f/2) means a wider opening - more light and a blurrier background; a higher number (like f/11) keeps more of the scene sharp.']);
  if (exif.ExposureTime != null)      exposure.push(['Shutter', fmtShutter(exif.ExposureTime), 'How long the sensor was exposed to light, in seconds. A fast time like 1/1000 freezes motion; a slow one like 1/15 can blur movement.']);
  if (exif.FocalLength != null)       exposure.push(['Focal length', fmtFocal(exif.FocalLength), 'The lens’s zoom setting, in millimetres. A small number is wide-angle (fits more in), a large number is telephoto (zoomed in on distant subjects).']);
  if (exif.FocalLengthIn35mmFormat != null) exposure.push(['Focal (35mm eq.)', fmtFocal(exif.FocalLengthIn35mmFormat), 'The zoom setting rescaled to the old 35mm film standard, so lenses on different-sized sensors can be compared on the same footing.']);
  if (exif.ExposureCompensation != null) exposure.push(['Exposure comp.', fmtExpComp(exif.ExposureCompensation), 'A deliberate brightness nudge the photographer dialled in, in EV steps. A positive value makes the shot brighter than the camera’s automatic reading, a negative value darker.']);
  if (exif.ExposureProgram != null)   exposure.push(['Exposure program', EXP_PROG[exif.ExposureProgram] || exif.ExposureProgram, 'Which automatic mode the camera used to balance brightness - for example aperture priority (you pick the opening), shutter priority (you pick the speed), or full manual.']);
  if (exif.MeteringMode != null)      exposure.push(['Metering', METERING[exif.MeteringMode] || exif.MeteringMode, 'How the camera measured the light to set exposure - for example reading the whole frame, weighting the centre, or just a small spot.']);
  if (exif.WhiteBalance != null)      exposure.push(['White balance', WHITE_BAL[exif.WhiteBalance] || exif.WhiteBalance, 'How the camera corrected for the colour of the lighting so whites look white. ‘Auto’ lets the camera judge it; ‘Manual’ means it was set by hand.']);
  if (exif.Flash != null)             exposure.push(['Flash', typeof exif.Flash === 'object' ? JSON.stringify(exif.Flash) : exif.Flash]);
  if (exposure.length) sections.push({ title: 'Exposure', rows: exposure });

  const time = [];
  if (exif.DateTimeOriginal) time.push(['Taken',     fmtDate(exif.DateTimeOriginal)]);
  if (exif.CreateDate)       time.push(['Created',   fmtDate(exif.CreateDate)]);
  if (exif.ModifyDate)       time.push(['Modified',  fmtDate(exif.ModifyDate)]);
  if (exif.OffsetTime)       time.push(['UTC offset', exif.OffsetTime]);
  if (time.length) sections.push({ title: 'Date / time', rows: time });

  const image = [];
  if (exif.Orientation != null) image.push(['Orientation', (ORIENTATIONS[exif.Orientation] || exif.Orientation) + '  (' + exif.Orientation + ')']);
  if (exif.ColorSpace)          image.push(['Colour space', exif.ColorSpace === 1 ? 'sRGB' : (exif.ColorSpace === 2 ? 'Adobe RGB' : exif.ColorSpace), 'The range of colours the image is meant to be shown in. sRGB is the standard for screens and the web; Adobe RGB covers more colours, mainly for print work.']);
  if (exif.XResolution)         image.push(['X resolution', exif.XResolution + ' ' + (exif.ResolutionUnit === 3 ? 'dpcm' : 'dpi'), 'The intended print density - dots per inch (dpi) or per centimetre (dpcm). It only affects printed size, not how many pixels the image has or how it looks on screen.']);
  if (exif.YResolution)         image.push(['Y resolution', exif.YResolution + ' ' + (exif.ResolutionUnit === 3 ? 'dpcm' : 'dpi'), 'The intended print density - dots per inch (dpi) or per centimetre (dpcm). It only affects printed size, not how many pixels the image has or how it looks on screen.']);
  if (image.length) sections.push({ title: 'Image', rows: image });

  // IPTC / XMP
  const desc = [];
  if (exif.title || exif.ObjectName)   desc.push(['Title',       exif.title || exif.ObjectName]);
  if (exif.description || exif.Caption) desc.push(['Description', exif.description || exif.Caption]);
  if (exif.creator || exif.Artist)     desc.push(['Creator',     Array.isArray(exif.creator) ? exif.creator.join(', ') : (exif.creator || exif.Artist)]);
  if (exif.rights || exif.Copyright)   desc.push(['Copyright',   exif.rights || exif.Copyright]);
  if (exif.keywords || exif.subject)   desc.push(['Keywords',    [].concat(exif.keywords || [], exif.subject || []).join(', ')]);
  if (desc.length) sections.push({ title: 'Description (IPTC/XMP)', rows: desc });

  // ICC
  const icc = [];
  if (exif.ProfileDescription) icc.push(['ICC profile', exif.ProfileDescription, 'An embedded colour profile that tells software exactly how this image’s colours should look, so they stay consistent across different screens and printers.']);
  if (exif.DeviceManufacturer) icc.push(['Device mfr', exif.DeviceManufacturer]);
  if (exif.DeviceModel)        icc.push(['Device model', exif.DeviceModel]);
  if (exif.ColorSpaceData)     icc.push(['Colour space', exif.ColorSpaceData, 'The colour model the embedded profile works in (for example RGB or CMYK) - the kind of colour data it manages.']);
  if (icc.length) sections.push({ title: 'ICC profile', rows: icc });

  return sections;
}

// Detect computational-photography wrappers - ProRAW, Apple Live Photo, Google/
// Samsung Motion Photo, Ultra HDR gain maps, depth maps - from the parsed EXIF/
// XMP plus a scan of the file head + tail for the markers/trailers they use.
// Returns [[label, value], ...]; empty when nothing is found.
async function detectComputational(file, exif) {
  const rows = [];
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  let blob = '';
  try {
    const head = new Uint8Array(await file.slice(0, 131072).arrayBuffer());
    blob = new TextDecoder('latin1').decode(head);
    if (file.size > 131072) {
      const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 262144)).arrayBuffer());
      blob += new TextDecoder('latin1').decode(tail);
    }
  } catch (_) {}

  if (ext === 'dng' && exif && /apple/i.test(exif.Make || '')) {
    rows.push(['Apple ProRAW', 'yes - a computational DNG written by an iPhone']);
  }
  if (exif && (exif.ContentIdentifier || exif.MediaGroupUUID)) {
    rows.push(['Live Photo', 'yes - pairs with a .mov via Content Identifier']);
  } else if (/com\.apple\.quicktime\.content\.identifier|ContentIdentifier/i.test(blob)) {
    rows.push(['Live Photo', 'likely - Apple Content Identifier present (pairs with a .mov)']);
  }
  if (/GCamera:MotionPhoto|MotionPhoto>|GCamera:MicroVideo|MicroVideoOffset/i.test(blob)) {
    rows.push(['Motion Photo', 'yes - Google Motion Photo with an embedded MP4']);
  } else if (/MotionPhoto_Data|Samsung[^<]{0,40}MotionPhoto/i.test(blob)) {
    rows.push(['Motion Photo', 'yes - Samsung Motion Photo (embedded MP4 trailer)']);
  }
  if (/hdrgm:|GainMapMax|GainMapMin|hdr_gain_map|UltraHDR/i.test(blob)) {
    rows.push(['Ultra HDR', 'yes - gain-map HDR (hdrgm); renders brighter on HDR displays']);
  }
  if (/(depth|disparity)map|PortraitEffectsMatte|xmp:depth/i.test(blob)) {
    rows.push(['Depth map', 'likely - an auxiliary depth/disparity image is present']);
  }
  return rows;
}

// ---------- Live Photo / Motion Photo - the appended motion clip ----------
// A "live" still (Google/Samsung Motion Photo, or an Apple Live Photo exported as
// a single file) appends a whole MP4/QuickTime clip after the picture. The browser
// only paints the still, so the motion is invisible. We locate that trailer, then
// - on demand, behind a button - run it through the real video + audio renderers so
// the live part gets the full player, frame tools, waveform and spectrogram.
const VIDEO_BRANDS = ['isom', 'iso2', 'mp41', 'mp42', 'mmp4', 'M4V ', 'M4VH', 'avc1', 'qt  ', '3gp4', '3gp5', '3gg6'];

// Find where the appended clip starts, reading as little of the file as possible.
// Returns { start, kind, brand } or null. Strategy, most-trusted first:
//   1. XMP MicroVideoOffset  - Google's older tag: clip starts `offset` bytes
//      before EOF (computed from metadata; only a 12-byte probe confirms it).
//   2. XMP Container:Directory - Google's newer tag: trailing items appended after
//      the primary image; sum the lengths of every item after the first.
//   3. Marker-gated full scan - Samsung/Apple trailers with no usable offset: read
//      the whole file and find an ISO-BMFF box whose major brand is a *video* brand
//      (which naturally skips a HEIC's own leading `ftyp`, brand heic/mif1/avif).
async function detectLiveVideo(file) {
  const size = file.size;
  if (size < 65536) return null;
  let xmp = '';
  try {
    const head = latin1(new Uint8Array(await file.slice(0, 131072).arrayBuffer()));
    const tail = latin1(new Uint8Array(await file.slice(Math.max(0, size - 262144)).arrayBuffer()));
    xmp = head + tail;
  } catch (_) { return null; }

  // Confirm a candidate offset really is the head of an ISO-BMFF clip (`....ftyp`).
  const confirm = async (start, kind) => {
    if (!(start > 0 && start < size)) return null;
    try {
      const p = new Uint8Array(await file.slice(start, start + 12).arrayBuffer());
      if (ascii(p, 4, 4) === 'ftyp') return { start, kind, brand: ascii(p, 8, 4) };
    } catch (_) {}
    return null;
  };

  let m = xmp.match(/MicroVideoOffset["'\s>=]+(\d{3,})/i);
  if (m) { const r = await confirm(size - (+m[1]), 'Google Motion Photo'); if (r) return r; }

  const lengths = [...xmp.matchAll(/Item:Length["'\s>=]+(\d+)/gi)].map((x) => +x[1]);
  const mimes = [...xmp.matchAll(/Item:Mime["'\s>=]+([^"'\s>]+)/gi)].map((x) => x[1].toLowerCase());
  if (lengths.length >= 2) {
    let trailing = 0;
    for (let i = 1; i < lengths.length; i++) trailing += lengths[i] || 0;
    const kind = mimes.some((x) => /quicktime|qt/.test(x)) ? 'Live Photo (embedded video)' : 'Google Motion Photo';
    const r = await confirm(size - trailing, kind); if (r) return r;
  }

  // Full scan only when markers say this really is a live/motion still - the clip's
  // ftyp can sit megabytes deep, so a tail-only scan would miss it.
  if (/MotionPhoto|MicroVideo|ContentIdentifier|com\.apple\.quicktime|GContainer/i.test(xmp)) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let from = 0;
      for (;;) {
        const ft = findBytes(bytes, [0x66, 0x74, 0x79, 0x70], from); // "ftyp"
        if (ft < 4) break;
        const start = ft - 4;
        const brand = ascii(bytes, ft + 4, 4);
        const boxSz = (bytes[start] << 24) | (bytes[start + 1] << 16) | (bytes[start + 2] << 8) | bytes[start + 3];
        if (VIDEO_BRANDS.includes(brand) && boxSz >= 8 && boxSz <= 4096) {
          return { start, kind: /qt/i.test(brand) ? 'Live Photo (embedded video)' : 'Motion Photo', brand };
        }
        from = ft + 4;
      }
    } catch (_) {}
  }
  return null;
}

// Does the carved clip carry a decodable audio track? Probes with the Web Audio
// decoder so a silent Motion Photo shows a tidy "no audio" note instead of the
// audio renderer's scary "can't decode this format" card.
async function liveClipHasAudio(clipFile) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return true; // can't probe - let the audio renderer try
    const c = new AC();
    let ab = null;
    try { ab = await c.decodeAudioData((await clipFile.arrayBuffer()).slice(0)); } finally { try { c.close(); } catch (_) {} }
    return !!(ab && ab.length > 0 && ab.duration > 0);
  } catch (_) { return false; }
}

// On-demand: carve the trailer with file.slice (no full in-memory copy) and hand it
// to the real video + audio renderers, each in its own sub-section.
async function analyseLivePhoto(file, found, container) {
  container.innerHTML = '';
  const isQt = /qt/i.test(found.brand || '') || /Live Photo/i.test(found.kind);
  const clipFile = new File([file.slice(found.start)],
    (file.name.replace(/\.[^.]+$/, '') || 'live') + (isQt ? '.mov' : '.mp4'),
    { type: isQt ? 'video/quicktime' : 'video/mp4' });

  const head = el('div', { class: 'anr-card' });
  const [lmH, lmHelp] = h3help('Live motion', 'The moving clip appended to this still, analysed as a full video and its own audio track.');
  head.appendChild(lmH); head.appendChild(lmHelp);
  head.appendChild(el('p', { class: 'anr-hint' },
    found.kind + ' (' + fmtBytes(clipFile.size) + ' from 0x' + found.start.toString(16) + ').'));
  container.appendChild(head);

  // Heavy modules, loaded only now (dynamic import also sidesteps the photo<->video
  // circular static import).
  let renderVideo, renderAudio;
  try { ({ renderVideo } = await import('./video.js')); ({ renderAudio } = await import('./audio.js')); }
  catch (_) { container.appendChild(errorCard('Could not load the video/audio analysers.')); return; }

  const videoSlot = el('div');
  container.appendChild(videoSlot);
  try { await renderVideo(clipFile, videoSlot); }
  catch (_) { videoSlot.appendChild(errorCard('Could not play the embedded video clip.')); }

  if (await liveClipHasAudio(clipFile)) {
    container.appendChild(el('p', { style: 'margin:22px 0 6px; font-weight:600;' }, 'Audio track'));
    const audioSlot = el('div');
    container.appendChild(audioSlot);
    try { await renderAudio(clipFile, audioSlot); }
    catch (_) { audioSlot.appendChild(errorCard('Could not decode the embedded audio track.')); }
  } else {
    container.appendChild(el('p', { class: 'anr-hint', style: 'margin-top:10px;' }, 'This live clip has no audio track.'));
  }
}

// The "Analyse live photo" button (lives beside the preview, like the RAW demosaic
// button): detects the clip in the background and reveals itself only if one is
// found; on click it renders the video + audio sections at the foot of the column.
function wireLivePhotoButton(file, previewSlot, resultsEl, signal) {
  const btn = el('button', { type: 'button', class: 'anr-btn', style: 'margin-top:10px;font-size:11px;width:100%;', hidden: '' }, 'Analyse live photo');
  const slot = el('div', { class: 'anr-live-slot' });
  let found = null;
  btn.addEventListener('click', () => {
    if (!found) return;
    btn.disabled = true;
    btn.textContent = 'Analysing live photo…';
    if (!slot.isConnected) resultsEl.appendChild(slot);
    analyseLivePhoto(file, found, slot)
      .then(() => { btn.hidden = true; })
      .catch(() => { btn.disabled = false; btn.textContent = 'Analyse live photo'; });
  });
  previewSlot.appendChild(btn);
  (async () => {
    try {
      const f = await detectLiveVideo(file);
      if (f && !(signal && signal.aborted)) { found = f; btn.hidden = false; }
    } catch (_) {}
  })();
}

// ---------- RAW develop-settings sidecar (.xmp) ----------
// Parse the develop recipe an Adobe (or compatible) raw developer writes into a
// .xmp sidecar next to a RAW file (crs: = Camera Raw Settings namespace), plus
// rating / label / keywords. Returns [[label, value], ...] or null.
function parseDevelopSettings(xmpText) {
  if (!xmpText) return null;
  const get = (ns, key) => {
    let m = xmpText.match(new RegExp(ns + ':' + key + '\\s*=\\s*"([^"]*)"'));
    if (m) return m[1];
    m = xmpText.match(new RegExp('<' + ns + ':' + key + '>([^<]*)</'));
    return m ? m[1] : null;
  };
  const crs = (k) => get('crs', k);
  const rows = [];
  const sw = get('xmp', 'CreatorTool') || (crs('Version') ? 'Camera Raw ' + crs('Version') : null);
  if (sw) rows.push(['Edited with', sw]);
  if (crs('ProcessVersion')) rows.push(['Process version', crs('ProcessVersion'), 'Which generation of Adobe’s raw-processing engine made these edits. Newer versions render tones and colours slightly differently, so the same settings can look different between them.']);
  if (crs('CameraProfile')) rows.push(['Camera profile', crs('CameraProfile')]);
  const wb = crs('WhiteBalance');
  if (wb) rows.push(['White balance', wb + (crs('Temperature') ? '  (' + crs('Temperature') + 'K, tint ' + (crs('Tint') || '0') + ')' : '')]);
  const signed = (v) => (Number(v) > 0 ? '+' : '') + v;
  const tone = [['Exposure', 'Exposure2012'], ['Contrast', 'Contrast2012'], ['Highlights', 'Highlights2012'],
    ['Shadows', 'Shadows2012'], ['Whites', 'Whites2012'], ['Blacks', 'Blacks2012']]
    .map(([l, k]) => { const v = crs(k); return v != null ? l + ' ' + signed(v) : null; }).filter(Boolean);
  if (tone.length) rows.push(['Tone', tone.join('  ·  ')]);
  const presence = [['Texture', 'Texture'], ['Clarity', 'Clarity2012'], ['Dehaze', 'Dehaze'],
    ['Vibrance', 'Vibrance'], ['Saturation', 'Saturation']]
    .map(([l, k]) => { const v = crs(k); return (v != null && v !== '0') ? l + ' ' + signed(v) : null; }).filter(Boolean);
  if (presence.length) rows.push(['Presence', presence.join('  ·  ')]);
  if (crs('HasCrop') === 'True') rows.push(['Crop', 'cropped' + (crs('CropAngle') && crs('CropAngle') !== '0' ? '  (rotated ' + (+crs('CropAngle')).toFixed(1) + '°)' : '')]);
  if (crs('LensProfileEnable') === '1') rows.push(['Lens corrections', 'enabled']);
  const rating = get('xmp', 'Rating');
  if (rating) rows.push(['Rating', '★'.repeat(Math.max(0, Math.min(5, +rating))) + '  (' + rating + ')']);
  const lbl = get('xmp', 'Label');
  if (lbl) rows.push(['Label', lbl]);
  const kw = xmpText.match(/<dc:subject>[\s\S]*?<\/dc:subject>/);
  if (kw) { const items = [...kw[0].matchAll(/<rdf:li[^>]*>([^<]+)<\/rdf:li>/g)].map((m) => m[1]); if (items.length) rows.push(['Keywords', items.join(', ')]); }
  const all = new Set([...xmpText.matchAll(/crs:(\w+)[=>]/g)].map((m) => m[1]));
  if (all.size) rows.push(['Total adjustments', String(all.size)]);
  return rows.length ? rows : null;
}

function buildDevelopCard(xmpText, label) {
  const rows = parseDevelopSettings(xmpText);
  const card = el('div', { class: 'anr-card' });
  const [h, helpPanel] = h3help('Develop settings (XMP sidecar)',
    (label ? 'Read from ' + label + '. ' : '') + 'The non-destructive edits a raw developer (such as Lightroom) recorded; the RAW pixels themselves are left unchanged.');
  card.appendChild(h); card.appendChild(helpPanel);
  if (!rows) {
    card.appendChild(el('p', { class: 'anr-hint' }, 'No develop settings were found in the XMP' + (label ? ' (' + label + ')' : '') + '.'));
    return card;
  }
  const t = el('table', { class: 'anr-readout' });
  for (const [k, v, rowHelpText] of rows) t.appendChild(rowHelpText ? rowHelp(k, v, rowHelpText) : row(k, v));
  card.appendChild(t);
  return card;
}

// ---------- AI detection ----------
const AI_KEYWORDS = [
  'stable diffusion', 'stablediffusion', 'automatic1111', 'comfyui', 'invokeai',
  'dall-e', 'dall·e', 'dalle', 'openai',
  'midjourney',
  'adobe firefly', 'firefly',
  'bing image creator',
  'leonardo ai', 'leonardo.ai',
  'dreamstudio', 'stability ai',
  'playground ai',
  'nightcafe', 'starryai', 'artbreeder', 'deepai',
  'runway ml', 'runwayml',
  'imagen', 'parti',
  'craiyon', 'deep dream',
  'novelai', 'nai diffusion',
  'canva ai', 'canva text to image',
  'copilot designer',
  'ideogram',
  'flux',
  'ai generated', 'ai-generated', 'text2img', 'txt2img', 'img2img',
];

function detectAI(exif) {
  if (!exif) return null;
  const hints = [];
  const check = (field, label) => {
    if (!field) return;
    const lower = String(field).toLowerCase();
    for (const kw of AI_KEYWORDS) {
      if (lower.includes(kw)) {
        hints.push({ field: label, value: String(field), match: kw });
        return;
      }
    }
  };
  check(exif.Software, 'Software');
  check(exif.Make, 'Make');
  check(exif.Model, 'Model');
  check(exif.ImageDescription, 'Description');
  check(exif.description, 'Description');
  check(exif.UserComment, 'UserComment');
  check(exif.title, 'Title');
  check(exif.creator, 'Creator');
  check(exif.Artist, 'Artist');
  check(exif.Copyright, 'Copyright');
  check(exif.rights, 'Rights');
  const comment = exif.Comment || exif.comment;
  check(comment, 'Comment');
  const xmpCreator = exif.CreatorTool || exif.creator_tool;
  check(xmpCreator, 'CreatorTool');
  const history = exif.History || exif.history;
  if (typeof history === 'string') check(history, 'History');
  // Check for C2PA / Content Credentials marker
  if (exif['c2pa:actions'] || exif['c2pa:ingredient'] || exif['dcterms:provenance'])
    hints.push({ field: 'C2PA', value: 'Content Credentials detected', match: 'c2pa' });
  // Check all remaining keys for AI keywords
  for (const key of Object.keys(exif)) {
    if (typeof exif[key] !== 'string') continue;
    const lower = exif[key].toLowerCase();
    if (lower.includes('generated by ai') || lower.includes('ai-generated') ||
        lower.includes('synthetic media') || lower.includes('artificially generated'))
      hints.push({ field: key, value: exif[key], match: 'ai marker' });
  }
  return hints.length ? hints : null;
}

function buildRawDump(exif) {
  if (!exif) return null;
  const keys = Object.keys(exif).sort();
  const rows = [];
  for (const k of keys) {
    let v = exif[k];
    if (v instanceof Date)        v = v.toISOString();
    else if (v instanceof Uint8Array) v = `Uint8Array(${v.length})`;
    else if (typeof v === 'object') v = JSON.stringify(v);
    rows.push([k, v]);
  }
  return rows;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0, l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return Math.round(h * 360) + '°,' + Math.round(s * 100) + '%,' + Math.round(l * 100) + '%';
}

// ---------- optics (derived from EXIF exposure/lens data) ----------
// Field of view, hyperfocal distance and depth of field, plus the exposure value
// at ISO 100 with a plain-language lighting label - all pure arithmetic over tags
// the camera already recorded. `meanLuma` (0-255, from the decoded pixels) drives a
// gentle sanity note when the frame's brightness clearly contradicts the settings.
function evDescriptor(ev) {
  if (ev >= 15) return 'snow / sand in sun';
  if (ev === 14) return 'bright sun';
  if (ev === 13) return 'hazy sun';
  if (ev === 12) return 'cloudy bright';
  if (ev === 11) return 'overcast';
  if (ev === 10) return 'open shade / sunset';
  if (ev >= 8) return 'bright indoors / dim daylight';
  if (ev >= 6) return 'well-lit indoors';
  if (ev >= 4) return 'dim indoors';
  if (ev >= 2) return 'dark indoors';
  return 'night / very low light';
}
function opticsRows(exif, meanLuma) {
  if (!exif) return [];
  const num = (v) => { const n = (typeof v === 'object' && v !== null) ? NaN : parseFloat(v); return isFinite(n) ? n : NaN; };
  const rows = [];
  const fReal = num(exif.FocalLength);
  const f35 = num(exif.FocalLengthIn35mmFormat);
  const N = num(exif.FNumber != null ? exif.FNumber : exif.ApertureValue);
  const t = num(exif.ExposureTime);
  const iso = num(Array.isArray(exif.ISO) ? exif.ISO[0] : exif.ISO);
  const subj = num(exif.SubjectDistance);
  if (f35 > 0) {
    const hfov = 2 * Math.atan(36 / (2 * f35)) * 180 / Math.PI;
    const dfov = 2 * Math.atan(43.27 / (2 * f35)) * 180 / Math.PI;
    rows.push(['Field of view', hfov.toFixed(0) + '° wide · ' + dfov.toFixed(0) + '° diagonal', 'How much of the scene the lens took in, in degrees - a wider angle fits more in the frame. ‘Wide’ measures across the frame, ‘diagonal’ corner to corner.']);
  }
  if (fReal > 0 && N > 0 && f35 > 0) {
    const crop = f35 / fReal;
    const coc = 0.03 / crop;                       // circle of confusion, mm
    const H = (fReal * fReal) / (N * coc) + fReal; // hyperfocal, mm
    rows.push(['Hyperfocal distance', (H / 1000).toFixed(1) + ' m', 'The focus distance that keeps the most of the scene sharp at once - focus here and everything from about half this distance out to the horizon looks acceptably sharp. Worked out from the lens and aperture.']);
    if (subj > 0) {
      const s = subj * 1000;                       // m -> mm
      const near = (H * s) / (H + (s - fReal));
      const far = (s < H) ? (H * s) / (H - (s - fReal)) : Infinity;
      rows.push(['Depth of field', (isFinite(far) ? ((far - near) / 1000).toFixed(2) + ' m' : 'near ' + (near / 1000).toFixed(1) + ' m to infinity') + '  (subject ' + subj.toFixed(2) + ' m)', 'How deep the sharp zone is, in front of and behind the subject - a small range means only a thin slice is in focus. Estimated from the lens, aperture and subject distance.']);
    }
  }
  if (N > 0 && t > 0) {
    let ev = Math.log2((N * N) / t);
    if (iso > 0) ev -= Math.log2(iso / 100);
    const evR = Math.round(ev);
    rows.push(['Exposure value (ISO 100)', 'EV ' + evR + ' - ' + evDescriptor(evR), 'A single number summing up how much light the exposure settings let in, with a plain-language guess at the scene brightness. Lower numbers mean darker conditions.']);
    const flash = exif.Flash && (typeof exif.Flash === 'object' ? exif.Flash.fired : (num(exif.Flash) & 1));
    if (!flash && meanLuma != null) {
      if (evR <= 5 && meanLuma > 150) rows.push(['⚠ Note', 'The frame is brighter than these low-light settings imply']);
      else if (evR >= 14 && meanLuma < 60) rows.push(['⚠ Note', 'The frame is darker than these bright-light settings imply']);
    }
  }
  return rows;
}

// A collapsible <details> panel for the Advanced card. Pass `help` to add a [?]
// info button to the summary (its panel shows inside the body when the panel is
// open, matching the LSB panel). Returns { det, body }; callers fill body and
// append det.
function advPanel(title, help) {
  const det = el('details');
  const sum = el('summary', {});
  const label = el('span', { class: 'anr-summary-label' }, title);
  let panel = null;
  if (help) {
    label.appendChild(document.createTextNode(' '));
    const btn = el('button', { type: 'button', class: 'anr-info-btn', title: 'Info' }, '[?]');
    panel = el('div', { class: 'anr-info-panel is-hidden', html: help });
    wireInfoToggle(btn, panel);
    label.appendChild(btn);
  }
  sum.appendChild(label);
  det.appendChild(sum);
  const body = el('div');
  if (panel) body.appendChild(panel);
  det.appendChild(body);
  return { det, body };
}

// Like h3help, but for a `.anr-readout-section` sub-heading: returns
// [sectionLabel, panel] with a [?] info button folding helpHtml behind it.
function sectionHelp(title, helpHtml) {
  const wrap = el('div', { class: 'anr-readout-section' });
  wrap.appendChild(document.createTextNode(title + ' '));
  const btn = el('button', { type: 'button', class: 'anr-info-btn', title: 'Info' }, '[?]');
  const panel = el('div', { class: 'anr-info-panel is-hidden', html: helpHtml });
  wireInfoToggle(btn, panel);
  wrap.appendChild(btn);
  return [wrap, panel];
}

// Personally-identifying / sensitive metadata fields, for the privacy report.
function privacyRows(exif) {
  if (!exif) return [];
  const rows = [];
  const cap = (v) => { const s = String(v); return s.length > 90 ? s.slice(0, 90) + '…' : s; };
  const push = (label, val) => { if (val != null && val !== '') rows.push([label, cap(val)]); };
  if (Number.isFinite(exif.latitude) && Number.isFinite(exif.longitude) && !(exif.latitude === 0 && exif.longitude === 0))
    push('GPS location', exif.latitude.toFixed(5) + ', ' + exif.longitude.toFixed(5));
  push('Camera serial', exif.SerialNumber || exif.BodySerialNumber || exif.InternalSerialNumber || exif.CameraSerialNumber);
  push('Lens serial', exif.LensSerialNumber);
  push('Owner', exif.OwnerName || exif.CameraOwnerName);
  push('Artist / author', exif.Artist || exif.XPAuthor || exif.Creator || exif['by-line']);
  push('Copyright', exif.Copyright || exif.Rights);
  push('Software', exif.Software || exif.ProcessingSoftware || exif.CreatorTool);
  push('Host computer', exif.HostComputer);
  push('Unique ID', exif.ImageUniqueID || exif.DocumentID || exif.OriginalDocumentID);
  push('User comment', typeof exif.UserComment === 'string' ? exif.UserComment : (typeof exif.XPComment === 'string' ? exif.XPComment : null));
  return rows;
}

// ---------- sharpness (normalised Laplacian energy) ----------
// Raw Laplacian variance scales with scene contrast and image size, so it pins
// almost every real photo at the top of the range and even rewards high-contrast
// blur. Instead we report the Laplacian (high-frequency) energy as a fraction of
// the image's total luminance energy: lapVar / lumVar. That ratio cancels overall
// contrast, so a flat-but-focused shot still scores well and a punchy-but-blurred
// shot scores low - it tracks focus, not contrast. The ratio runs ~0 (perfectly
// smooth) up towards ~20 (pure high-frequency noise); a saturating curve maps it
// onto a clean 0-100 score.
const SHARP_K = 0.35; // curve steepness - the one tuning knob (see score map below)

function computeSharpness(imgData) {
  const w = imgData.width, h = imgData.height, d = imgData.data;
  const gray = new Float32Array(w * h);
  let lumSum = 0, lumSqSum = 0;
  for (let i = 0; i < w * h; i++) {
    const y = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    gray[i] = y;
    lumSum += y;
    lumSqSum += y * y;
  }
  const npx = w * h;
  // Global luminance variance (E[Y^2] - E[Y]^2) = the image's total energy.
  const lumMean = npx > 0 ? lumSum / npx : 0;
  const lumVar = npx > 0 ? Math.max(0, lumSqSum / npx - lumMean * lumMean) : 0;
  let sum = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const lap = -4 * gray[y * w + x]
        + gray[(y - 1) * w + x] + gray[(y + 1) * w + x]
        + gray[y * w + x - 1]   + gray[y * w + x + 1];
      sum += lap * lap;
      n++;
    }
  }
  const lapVar = n > 0 ? sum / n : 0;
  // eps guards flat/near-uniform frames (tiny lumVar) from blowing the ratio up.
  const ratio = lapVar / (lumVar + 1);
  // Saturating map: ratio 0.3 -> ~10, 1 -> ~30, 3 -> ~65, 6 -> ~88. Bounded 0-100.
  return Math.round(100 * (1 - Math.exp(-SHARP_K * ratio)));
}

function sharpnessLabel(v) {
  if (v >= 80) return 'very sharp';
  if (v >= 60) return 'sharp';
  if (v >= 40) return 'normal';
  if (v >= 20) return 'soft';
  return 'blurry';
}

function detectFocusRegion(imgData, gridSize) {
  const w = imgData.width, h = imgData.height, d = imgData.data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * d[i*4] + 0.587 * d[i*4+1] + 0.114 * d[i*4+2];
  const cols = Math.ceil(w / gridSize), rows = Math.ceil(h / gridSize);
  const grid = new Float32Array(cols * rows);
  let maxVar = 0, maxIdx = 0;
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      let sum = 0, n = 0;
      const x0 = gx * gridSize, y0 = gy * gridSize;
      const x1 = Math.min(x0 + gridSize, w - 1), y1 = Math.min(y0 + gridSize, h - 1);
      for (let y = Math.max(1, y0); y < y1; y++) {
        for (let x = Math.max(1, x0); x < x1; x++) {
          const lap = -4*gray[y*w+x] + gray[(y-1)*w+x] + gray[(y+1)*w+x] + gray[y*w+x-1] + gray[y*w+x+1];
          sum += lap * lap; n++;
        }
      }
      const v = n > 0 ? sum / n : 0;
      grid[gy * cols + gx] = v;
      if (v > maxVar) { maxVar = v; maxIdx = gy * cols + gx; }
    }
  }
  return { grid, cols, rows, gridSize, maxIdx, maxVar,
    focusX: (maxIdx % cols) * gridSize + gridSize / 2,
    focusY: Math.floor(maxIdx / cols) * gridSize + gridSize / 2 };
}

// ---------- color statistics ----------
function computeColorStats(imgData) {
  const d = imgData.data, total = imgData.width * imgData.height;
  let rSum = 0, gSum = 0, bSum = 0, shadows = 0, midtones = 0, highlights = 0;
  for (let i = 0; i < d.length; i += 4) {
    rSum += d[i]; gSum += d[i + 1]; bSum += d[i + 2];
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (lum < 64) shadows++;
    else if (lum < 192) midtones++;
    else highlights++;
  }
  return {
    avgR: Math.round(rSum / total), avgG: Math.round(gSum / total), avgB: Math.round(bSum / total),
    shadows: ((shadows / total) * 100).toFixed(1),
    midtones: ((midtones / total) * 100).toFixed(1),
    highlights: ((highlights / total) * 100).toFixed(1)
  };
}

// ---------- perceptual hash (pHash) ----------
function computePHash(img) {
  const S = 32;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  cv.getContext('2d').drawImage(img, 0, 0, S, S);
  const d = cv.getContext('2d').getImageData(0, 0, S, S).data;
  const gray = new Float64Array(S * S);
  for (let i = 0; i < S * S; i++) gray[i] = 0.299 * d[i*4] + 0.587 * d[i*4+1] + 0.114 * d[i*4+2];
  const dct = new Float64Array(S * S);
  for (let y = 0; y < S; y++)
    for (let u = 0; u < S; u++) {
      let s = 0;
      for (let x = 0; x < S; x++) s += gray[y*S+x] * Math.cos(Math.PI * u * (2*x+1) / (2*S));
      dct[y*S+u] = s;
    }
  const dct2 = new Float64Array(S * S);
  for (let u = 0; u < S; u++)
    for (let v = 0; v < S; v++) {
      let s = 0;
      for (let y = 0; y < S; y++) s += dct[y*S+u] * Math.cos(Math.PI * v * (2*y+1) / (2*S));
      dct2[v*S+u] = s;
    }
  const vals = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) vals.push(dct2[y*S+x]);
  const sorted = [...vals].sort((a, b) => a - b);
  const med = sorted[32];
  let hex = '';
  for (let i = 0; i < 64; i += 4)
    hex += ((vals[i]>med?8:0)|(vals[i+1]>med?4:0)|(vals[i+2]>med?2:0)|(vals[i+3]>med?1:0)).toString(16);
  return hex;
}

// ---------- QR code detection ----------
async function detectQrCode(img) {
  await loadScript(JSQR_URL);
  if (!window.jsQR) return null;
  const MAX = 800;
  const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(img, 0, 0, w, h);
  return window.jsQR(cv.getContext('2d').getImageData(0, 0, w, h).data, w, h);
}

// Pretty-print a BarcodeDetector format id (e.g. 'ean_13' -> 'EAN-13').
function fmtCodeFormat(f) {
  const map = {
    qr_code: 'QR code', micro_qr_code: 'Micro QR', rm_qr_code: 'rMQR',
    aztec: 'Aztec', data_matrix: 'Data Matrix', pdf417: 'PDF417', maxi_code: 'MaxiCode',
    ean_13: 'EAN-13', ean_8: 'EAN-8', upc_a: 'UPC-A', upc_e: 'UPC-E',
    code_128: 'Code 128', code_39: 'Code 39', code_93: 'Code 93', codabar: 'Codabar', itf: 'ITF', dx_film_edge: 'DX film edge',
  };
  return map[f] || String(f || 'Barcode').replace(/_/g, ' ').toUpperCase();
}

// Detect every 1D/2D code in the image: native BarcodeDetector (many formats,
// Chromium/Android) first, with the vendored jsQR as a QR fallback for browsers
// without it. Returns a de-duplicated [{ format, data }].
async function detectCodes(img) {
  const results = [];
  try {
    if ('BarcodeDetector' in window) {
      const det = new window.BarcodeDetector();
      const found = await det.detect(img);
      for (const f of found) if (f.rawValue) results.push({ format: f.format, data: f.rawValue });
    }
  } catch (_) { /* detector unsupported or failed - fall through to jsQR */ }
  if (!results.some((r) => r.format === 'qr_code')) {
    try { const qr = await detectQrCode(img); if (qr && qr.data) results.push({ format: 'qr_code', data: qr.data }); } catch (_) {}
  }
  const seen = new Set();
  return results.filter((r) => r.data && !seen.has(r.data) && seen.add(r.data));
}

// ---------- histogram + palette ----------
function getPixelData(img) {
  const MAX = 240;
  const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d', { willReadFrequently: true });
  c.drawImage(img, 0, 0, w, h);
  return c.getImageData(0, 0, w, h);
}

function computeHistogram(imgData) {
  const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    r[d[i]]++; g[d[i + 1]]++; b[d[i + 2]]++;
    const y = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    l[y]++;
  }
  return { r, g, b, l };
}

function renderHistogram(canvas, hist) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, w, h);

  // grid
  ctx.strokeStyle = '#2a2a2a';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = (i / 4) * h;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  // luminance backdrop (light)
  const lmax = Math.max(...hist.l);
  ctx.fillStyle = 'rgba(200, 220, 232, 0.35)';
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * w;
    const bh = (hist.l[i] / lmax) * h;
    ctx.fillRect(x, h - bh, w / 256 + 1, bh);
  }

  // RGB lines, additively blended for the classic look
  const max = Math.max(
    Math.max.apply(null, hist.r),
    Math.max.apply(null, hist.g),
    Math.max.apply(null, hist.b)
  );
  const channels = [
    { data: hist.r, color: 'rgba(255,80,80,0.75)' },
    { data: hist.g, color: 'rgba(120,220,120,0.75)' },
    { data: hist.b, color: 'rgba(80,140,255,0.75)' }
  ];
  ctx.lineWidth = 1;
  for (const ch of channels) {
    ctx.strokeStyle = ch.color;
    ctx.beginPath();
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * w;
      const y = h - (ch.data[i] / max) * h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// Tiny color quantizer: bin into an 8-level-per-channel cube (512 buckets, STEP 32),
// sort by population, merge near duplicates.
function dominantColors(imgData, n = 8) {
  const d = imgData.data;
  const STEP = 32;
  const map = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const r = (d[i]     >> 5) << 5;
    const g = (d[i + 1] >> 5) << 5;
    const b = (d[i + 2] >> 5) << 5;
    const k = (r << 16) | (g << 8) | b;
    map.set(k, (map.get(k) || 0) + 1);
  }
  const entries = [...map.entries()].sort((a, b) => b[1] - a[1]);
  const out = [];
  for (const [k, count] of entries) {
    const r = (k >> 16) & 255;
    const g = (k >> 8)  & 255;
    const b = k & 255;
    // Skip near-duplicates already in `out`
    if (out.some((c) => Math.abs(c.r - r) + Math.abs(c.g - g) + Math.abs(c.b - b) < 60)) continue;
    out.push({ r, g, b, count });
    if (out.length >= n) break;
  }
  return out;
}

function toHex(c) {
  const h = hexByte;
  return '#' + h(c.r) + h(c.g) + h(c.b);
}

// ---------- GPS / Leaflet (lazy) ----------
async function makeMap(container, lat, lon, label) {
  try {
    await loadCss(LEAFLET_CSS);
    await loadScript(LEAFLET_JS);
  } catch (e) {
    container.innerHTML = '';
    container.appendChild(errorCard('Map library failed to load. Offline?'));
    return;
  }
  container.innerHTML = '';
  const map = L.map(container).setView([lat, lon], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  L.marker([lat, lon]).addTo(map).bindPopup(label || (lat.toFixed(5) + ', ' + lon.toFixed(5))).openPopup();
  // Force resize after attach (Leaflet quirk inside flex layouts)
  setTimeout(() => map.invalidateSize(), 50);
}

// ---------- OCR (lazy) ----------
function prepareOcrCanvas(img) {
  const MIN_DIM = 2000;
  let w = img.naturalWidth, h = img.naturalHeight;
  const scale = Math.max(1, MIN_DIM / Math.min(w, h));
  w = Math.round(w * scale);
  h = Math.round(h * scale);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return cv;
}

async function ensureTesseract() {
  if (window.Tesseract) return window.Tesseract;
  await loadScript(TESSERACT_URL);
  return window.Tesseract;
}

function makeOcrCard(file, img) {
  const card = el('div', { class: 'anr-card' });
  const det = el('details');
  // The "?" help now lives in the language picker popup (see pickOcrLanguage).
  const summary = el('summary', {}, [el('span', { class: 'anr-summary-label' }, ['OCR - Extract text'])]);
  det.appendChild(summary);
  const detContent = el('div');

  const ocrCanvas = img ? prepareOcrCanvas(img) : null;
  const ocrInput = ocrCanvas || file;

  // Same flow as PDF OCR: a single button that opens the shared language picker
  // (pickOcrLanguage) before running, rather than an inline language dropdown.
  const runBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Extract text');
  detContent.appendChild(el('div', { class: 'anr-btn-row' }, [runBtn]));

  const progressWrap  = el('div', { class: 'anr-progress', style: 'display:none' });
  const progressBar   = el('div', { class: 'anr-progress-bar' }, '[                    ]');
  const progressLabel = el('div', { class: 'anr-progress-label' }, '');
  progressWrap.appendChild(progressBar);
  progressWrap.appendChild(progressLabel);
  detContent.appendChild(progressWrap);

  function setBar(frac) {
    const ch = parseFloat(getComputedStyle(progressBar).fontSize) * 0.6 || 8;
    const total = Math.max(10, Math.floor((progressBar.parentElement.clientWidth - ch * 2) / ch));
    const filled = Math.round(Math.max(0, Math.min(1, frac)) * total);
    progressBar.innerHTML = '[<span class="anr-bar-fill">' + '/'.repeat(filled) + '</span>' + ' '.repeat(total - filled) + ']';
  }

  const out = el('pre', { class: 'anr-ocr-text' });
  detContent.appendChild(out);

  let busy = false;
  let activeWorker = null;

  async function run() {
    if (busy) return;
    // Modal language picker - the same one PDF OCR uses. Cancelling aborts.
    const lang = await pickOcrLanguage({ title: 'OCR language' });
    if (!lang) return;
    busy = true;
    runBtn.textContent = 'Stop';
    out.textContent = '';
    progressWrap.style.display = '';
    setBar(0);
    progressLabel.textContent = 'starting…';

    const setProgress = (m) => {
      if (m && m.progress != null) {
        const status = m.status || 'working';
        const isRecognising = status === 'recognizing text';
        setBar(isRecognising ? m.progress : 0);
        progressLabel.textContent = status + '  ' + (m.progress * 100).toFixed(0) + '%';
      }
    };

    try {
      const T = await ensureTesseract();
      activeWorker = await T.createWorker(lang, undefined, {
        logger: setProgress,
        workerPath: 'assets/vendor/tesseract/worker.min.js',
        langPath: ocrLangPath(lang),
        corePath: 'assets/vendor/tesseract'
      });
      progressLabel.textContent = 'Recognising…';
      const r = await activeWorker.recognize(ocrInput);
      await activeWorker.terminate();
      activeWorker = null;
      const MIN_CONF = 60;
      const MIN_WORD_LEN = 2;
      const words = (r.data && r.data.words) || [];
      const good = words.filter(w => w.confidence >= MIN_CONF && w.text.trim().length >= MIN_WORD_LEN);
      if (good.length === 0) {
        out.textContent = '(no text detected)';
      } else {
        const lines = {};
        for (const w of good) {
          const key = w.line ? w.line.text : '_';
          if (!lines[key]) lines[key] = [];
          lines[key].push(w.text);
        }
        out.textContent = Object.values(lines).map(ws => ws.join(' ')).join('\n');
      }
      setBar(1);
      progressLabel.textContent = good.length ? 'done' : 'no text found';
    } catch (e) {
      if (!busy) {
        out.textContent = '';
        progressLabel.textContent = 'stopped';
      } else {
        out.textContent = '[OCR failed: ' + (e && e.message ? e.message : e) + ']';
        progressLabel.textContent = 'failed';
      }
    } finally {
      busy = false;
      activeWorker = null;
      runBtn.textContent = 'Extract text';
    }
  }

  function stop() {
    busy = false;
    if (activeWorker) {
      try { activeWorker.terminate(); } catch (_) {}
      activeWorker = null;
    }
  }

  runBtn.addEventListener('click', () => {
    if (busy) stop(); else run();
  });

  det.appendChild(detContent);
  card.appendChild(det);
  return card;
}

// ---------- LSB steganography planes ----------
function makeLsbPlane(srcData, w, h, offset, bit = 0) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const out = ctx.createImageData(w, h);
  const od = out.data;
  for (let i = 0; i < w * h; i++) {
    const v = ((srcData[i * 4 + offset] >> bit) & 1) * 255;
    od[i * 4] = v; od[i * 4 + 1] = v; od[i * 4 + 2] = v; od[i * 4 + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return cv;
}

function renderLsbPlanes(img, container) {
  const MAX_W = 400;
  const scale = Math.min(1, MAX_W / img.naturalWidth);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const srcCv = document.createElement('canvas');
  srcCv.width = w; srcCv.height = h;
  const srcCtx = srcCv.getContext('2d', { willReadFrequently: true });
  srcCtx.drawImage(img, 0, 0, w, h);
  const srcData = srcCtx.getImageData(0, 0, w, h).data;

  const channels = [
    { label: 'R', offset: 0 },
    { label: 'G', offset: 1 },
    { label: 'B', offset: 2 }
  ];

  // The export collector (export-data.js) treats an .anr-export-gallery container as
  // one image group, rendering its canvases as smaller side-by-side figures under
  // the data-export-heading rather than three full-width images.
  const wrap = el('div', { class: 'anr-export-gallery', 'data-export-heading': 'LSB Analysis', style: 'display:flex; gap:12px; flex-wrap:wrap;' });

  // Which bit plane is on show (0 = LSB, 7 = MSB). The classic steganalysis view is
  // the LSB, but hidden data occasionally lives higher up, so all eight are browsable.
  let currentBit = 0;
  const bitLabel = (b) => 'bit ' + b + (b === 0 ? ' (LSB)' : (b === 7 ? ' (MSB)' : ''));

  // Full-resolution planes are built lazily on lightbox open, cached per bit.
  const fullByBit = {};
  function ensureFullRes(bit) {
    if (fullByBit[bit]) return fullByBit[bit];
    const fullCv = document.createElement('canvas');
    fullCv.width = img.naturalWidth; fullCv.height = img.naturalHeight;
    const fCtx = fullCv.getContext('2d', { willReadFrequently: true });
    fCtx.drawImage(img, 0, 0);
    const fullData = fCtx.getImageData(0, 0, img.naturalWidth, img.naturalHeight).data;
    fullByBit[bit] = channels.map((ch) =>
      makeLsbPlane(fullData, img.naturalWidth, img.naturalHeight, ch.offset, bit).toDataURL('image/png'));
    return fullByBit[bit];
  }

  // ---- Chi-square steganalysis verdict (statistical LSB-replacement test) ----
  const fmtPct = (v) => (v == null ? '-' : Math.round(v * 100) + '%');
  try {
    const chi = lsbChiSquare(img);
    if (chi) {
      const level = chi.max >= 0.95 ? 'High' : (chi.max >= 0.5 ? 'Elevated' : 'Low');
      const vt = el('table', { class: 'anr-readout' });
      vt.appendChild(rowHelp('LSB embedding likelihood', level + '  (' + fmtPct(chi.max) + ')',
        'Checks whether a hidden message may have been tucked into the least-significant bit (LSB) - the last, least-important bit of each pixel’s colour, where tiny changes are invisible. This chi-square test (Westfeld-Pfitzmann) measures how far each colour channel’s brightness histogram has been flattened towards the tell-tale ‘pairs of values’ pattern this kind of hiding leaves behind. A high score is a real signal, but it only catches classic LSB replacement - not LSB matching, nor data hidden in the compressed (DCT/frequency) data. A low score is normal - the last bits of an untouched photo look like random noise - and a raised score can also come from a very plain or heavily-compressed picture, so read it together with the black-and-white bit views below.'));
      vt.appendChild(row('Per channel', 'R ' + fmtPct(chi.R) + '  ·  G ' + fmtPct(chi.G) + '  ·  B ' + fmtPct(chi.B)));
      container.appendChild(vt);
    }
  } catch (_) { /* too small / undecodable - skip the verdict */ }

  function openLsbLightbox(startIdx) {
    const lb = ensureLightbox();
    const lbWrap = lb.querySelector('.lightbox-img-wrap');
    const lbImg = lbWrap.querySelector('img:first-child');
    const toolbar = lb.querySelector('.lightbox-toolbar');
    const meta = lb.querySelector('.lightbox-meta');
    toolbar.innerHTML = '';
    lbWrap.classList.remove('anr-checkerboard');
    const overlays = lbWrap.querySelectorAll('.lightbox-peaking');
    overlays.forEach(o => { o.hidden = true; });
    lbWrap.querySelector('.lightbox-focus-map').hidden = true;
    lbWrap.querySelector('.lightbox-focus-dot').hidden = true;

    let idx = startIdx;
    function show(i) {
      idx = i;
      const ch = channels[idx];
      const srcs = ensureFullRes(currentBit);
      lbImg.src = srcs[idx];
      lbImg.onload = () => sizeWrap(lbWrap, img.naturalWidth, img.naturalHeight);
      meta.textContent = ch.label + ' ' + bitLabel(currentBit) + '  (' + img.naturalWidth + ' × ' + img.naturalHeight + ')';
      prevBtn.style.visibility = idx > 0 ? 'visible' : 'hidden';
      nextBtn.style.visibility = idx < channels.length - 1 ? 'visible' : 'hidden';
      label.textContent = ch.label + ' (' + (idx + 1) + '/' + channels.length + ')';
    }

    const prevBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, '← Prev');
    prevBtn.addEventListener('click', (e) => { e.stopPropagation(); if (idx > 0) show(idx - 1); });
    const nextBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, 'Next →');
    nextBtn.addEventListener('click', (e) => { e.stopPropagation(); if (idx < channels.length - 1) show(idx + 1); });
    const label = el('span', { style: 'color:#fff;font-family:var(--font-mono);font-size:11px;letter-spacing:0.1em;text-transform:uppercase;align-self:center' });
    const saveBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, 'Save PNG');
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const a = el('a', { href: ensureFullRes(currentBit)[idx], download: 'plane_bit' + currentBit + '_' + channels[idx].label.toLowerCase() + '.png' });
      document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 500);
    });

    toolbar.appendChild(prevBtn);
    toolbar.appendChild(label);
    toolbar.appendChild(nextBtn);
    toolbar.appendChild(saveBtn);

    // Preview src first, full-res loaded in show()
    const previewSrc = makeLsbPlane(srcData, w, h, channels[idx].offset, currentBit).toDataURL('image/png');
    lbImg.src = previewSrc;
    meta.textContent = channels[idx].label + ' ' + bitLabel(currentBit) + '  (loading full resolution…)';
    lb.hidden = false;
    document.body.style.overflow = 'hidden';
    sizeWrap(lbWrap, w, h);
    show(idx);
  }

  // (Re)build the three channel previews at the current bit plane.
  function renderPreviews() {
    wrap.innerHTML = '';
    for (let ci = 0; ci < channels.length; ci++) {
      const ch = channels[ci];
      const cv = makeLsbPlane(srcData, w, h, ch.offset, currentBit);
      cv.setAttribute('data-export-label', ch.label + ' ' + bitLabel(currentBit));
      cv.style.maxWidth = '100%';
      cv.style.imageRendering = 'pixelated';
      cv.style.cursor = 'zoom-in';
      const chIdx = ci;
      cv.addEventListener('click', () => openLsbLightbox(chIdx));
      wrap.appendChild(el('div', { style: 'flex:1; min-width:100px; text-align:center;' }, [
        el('div', { style: 'font-weight:600; margin-bottom:4px; font-size:13px;' }, ch.label),
        cv,
      ]));
    }
  }

  // Bit-plane selector (0 = LSB on the left, 7 = MSB on the right).
  const bitBtns = [];
  const styleBits = () => bitBtns.forEach((b, i) => {
    b.style.cssText = 'min-width:30px; padding:3px 6px; font-size:12px;' +
      (i === currentBit ? ' background:var(--fg); color:var(--bg);' : '');
  });
  const bitRow = el('div', { style: 'display:flex; flex-wrap:wrap; gap:4px; align-items:center; margin-bottom:8px;' },
    [el('span', { class: 'anr-hint', style: 'margin-right:4px;' }, 'Bit plane')]);
  for (let b = 0; b < 8; b++) {
    const btn = el('button', { type: 'button', class: 'anr-btn', title: bitLabel(b) }, String(b));
    btn.addEventListener('click', () => { currentBit = b; styleBits(); renderPreviews(); });
    bitBtns.push(btn);
    bitRow.appendChild(btn);
  }
  styleBits();
  container.appendChild(bitRow);
  container.appendChild(wrap);
  renderPreviews();
}

// ---------- lightbox (singleton, lazy) ----------
let lightboxEl = null;
let lbZoom = null;
// Current gallery navigation config ({onPrev, onNext} + action buttons), set per
// open by openLightbox. Drives the prev/next arrows and the ArrowLeft/Right keys.
let lbNav = null;
let lbClose = null;   // history-aware closer while the lightbox is open
function ensureLightbox() {
  if (lightboxEl) return lightboxEl;
  lightboxEl = document.createElement('div');
  lightboxEl.className = 'lightbox';
  lightboxEl.hidden = true;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'lightbox-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = 'Close';
  const wrap = document.createElement('div');
  wrap.className = 'lightbox-img-wrap';
  const img = document.createElement('img');
  img.alt = '';
  const mapOverlay = document.createElement('img');
  mapOverlay.className = 'lightbox-focus-map';
  mapOverlay.hidden = true;
  const dot = document.createElement('div');
  dot.className = 'lightbox-focus-dot';
  dot.hidden = true;
  const peakingCanvas = document.createElement('canvas');
  peakingCanvas.className = 'lightbox-peaking';
  peakingCanvas.hidden = true;
  const highlightsCanvas = document.createElement('canvas');
  highlightsCanvas.className = 'lightbox-peaking';
  highlightsCanvas.hidden = true;
  const shadowsCanvas = document.createElement('canvas');
  shadowsCanvas.className = 'lightbox-peaking';
  shadowsCanvas.hidden = true;
  wrap.appendChild(img);
  wrap.appendChild(peakingCanvas);
  wrap.appendChild(highlightsCanvas);
  wrap.appendChild(shadowsCanvas);
  wrap.appendChild(mapOverlay);
  wrap.appendChild(dot);
  const toolbar = document.createElement('div');
  toolbar.className = 'lightbox-toolbar';
  // Extra action buttons for gallery use (e.g. Analyse / Download a carved image).
  const actions = document.createElement('div');
  actions.className = 'lightbox-actions';
  const meta = document.createElement('p');
  meta.className = 'lightbox-meta';
  const center = document.createElement('div');
  center.className = 'lightbox-center';
  center.appendChild(wrap);
  center.appendChild(toolbar);
  center.appendChild(actions);
  center.appendChild(meta);
  // Prev/next arrows for stepping through a gallery; hidden unless a nav config
  // is supplied to openLightbox.
  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'lightbox-nav lightbox-prev';
  prevBtn.setAttribute('aria-label', 'Previous');
  prevBtn.innerHTML = '&#8249;';
  prevBtn.hidden = true;
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'lightbox-nav lightbox-next';
  nextBtn.setAttribute('aria-label', 'Next');
  nextBtn.innerHTML = '&#8250;';
  nextBtn.hidden = true;
  prevBtn.addEventListener('click', (e) => { e.stopPropagation(); if (lbNav && lbNav.onPrev) lbNav.onPrev(); });
  nextBtn.addEventListener('click', (e) => { e.stopPropagation(); if (lbNav && lbNav.onNext) lbNav.onNext(); });
  lbZoom = attachZoomPan(wrap);
  lightboxEl.appendChild(closeBtn);
  lightboxEl.appendChild(prevBtn);
  lightboxEl.appendChild(nextBtn);
  lightboxEl.appendChild(center);
  lightboxEl.addEventListener('click', (e) => {
    if (e.target === lightboxEl || e.target === closeBtn) closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (lightboxEl.hidden) return;
    if (e.key === 'Escape') { closeLightbox(); return; }
    if (e.key === 'ArrowLeft' && lbNav && lbNav.onPrev) { e.preventDefault(); lbNav.onPrev(); }
    else if (e.key === 'ArrowRight' && lbNav && lbNav.onNext) { e.preventDefault(); lbNav.onNext(); }
  });
  // Re-fit the image to the viewport on resize / device rotation while the
  // lightbox is open, so it scales correctly at any window size (rAF-coalesced).
  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    if (lightboxEl.hidden) return;
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      if (lbZoom) lbZoom.reset();
      const im = wrap.querySelector('img:first-child');
      if (im && im.naturalWidth) sizeWrap(wrap, im.naturalWidth, im.naturalHeight);
    });
  });
  document.body.appendChild(lightboxEl);
  return lightboxEl;
}
function sizeWrap(wrap, w, h) {
  // Fit the image to the viewport, reserving ~140px of vertical room for the
  // toolbar, meta line and padding so nothing clips on short / landscape windows.
  // Re-run on resize (see ensureLightbox) so it stays correct at any window size.
  const maxW = window.innerWidth * 0.9;
  const maxH = Math.max(160, window.innerHeight - 140);
  const scale = Math.min(maxW / w, maxH / h, 1);
  wrap.style.width = Math.round(w * scale) + 'px';
  wrap.style.height = Math.round(h * scale) + 'px';
}
function computePeaking(imgEl, canvas) {
  const w = imgEl.naturalWidth, h = imgEl.naturalHeight;
  const scale = Math.min(1, 2000 / Math.max(w, h));
  const sw = Math.round(w * scale), sh = Math.round(h * scale);
  const tmp = document.createElement('canvas');
  tmp.width = sw; tmp.height = sh;
  const tctx = tmp.getContext('2d');
  tctx.drawImage(imgEl, 0, 0, sw, sh);
  const id = tctx.getImageData(0, 0, sw, sh);
  const d = id.data;

  canvas.width = sw; canvas.height = sh;
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(sw, sh);
  const od = out.data;
  const threshold = 220;

  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const i = (y * sw + x) * 4;
      const tl = ((y-1)*sw+(x-1))*4, tc = ((y-1)*sw+x)*4, tr = ((y-1)*sw+(x+1))*4;
      const ml = (y*sw+(x-1))*4,                            mr = (y*sw+(x+1))*4;
      const bl = ((y+1)*sw+(x-1))*4, bc = ((y+1)*sw+x)*4, br = ((y+1)*sw+(x+1))*4;

      let maxEdge = 0;
      for (let c = 0; c < 3; c++) {
        const gx = -d[tl+c] - 2*d[ml+c] - d[bl+c] + d[tr+c] + 2*d[mr+c] + d[br+c];
        const gy = -d[tl+c] - 2*d[tc+c] - d[tr+c] + d[bl+c] + 2*d[bc+c] + d[br+c];
        const mag = Math.sqrt(gx*gx + gy*gy);
        if (mag > maxEdge) maxEdge = mag;
      }

      if (maxEdge > threshold) {
        const a = Math.min(230, Math.round((maxEdge - threshold) * 1.0));
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= sw || ny < 0 || ny >= sh) continue;
            const ni = (ny * sw + nx) * 4;
            if (a > od[ni + 3]) {
              od[ni]     = 230;
              od[ni + 1] = 20;
              od[ni + 2] = 20;
              od[ni + 3] = a;
            }
          }
        }
      }
    }
  }
  ctx.putImageData(out, 0, 0);
}

function computeExposureOverlay(imgEl, canvas, mode) {
  const w = imgEl.naturalWidth, h = imgEl.naturalHeight;
  const scale = Math.min(1, 2000 / Math.max(w, h));
  const sw = Math.round(w * scale), sh = Math.round(h * scale);
  const tmp = document.createElement('canvas');
  tmp.width = sw; tmp.height = sh;
  const tctx = tmp.getContext('2d');
  tctx.drawImage(imgEl, 0, 0, sw, sh);
  const id = tctx.getImageData(0, 0, sw, sh);
  const d = id.data;

  canvas.width = sw; canvas.height = sh;
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(sw, sh);
  const od = out.data;

  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
    if (mode === 'highlights' && lum > 245) {
      od[i] = 230; od[i+1] = 20; od[i+2] = 20;
      od[i+3] = Math.min(255, Math.round((lum - 245) * 25));
    } else if (mode === 'shadows' && lum < 10) {
      od[i] = 40; od[i+1] = 100; od[i+2] = 230;
      od[i+3] = Math.min(255, Math.round((10 - lum) * 25));
    }
  }
  ctx.putImageData(out, 0, 0);
}

export function openLightbox(src, alt, metaText, focusOpts, showAlpha, photoTools = true, nav = null) {
  const lb = ensureLightbox();
  if (lbZoom) lbZoom.reset();
  const wrap = lb.querySelector('.lightbox-img-wrap');
  const lbImg = wrap.querySelector('img:first-child');
  const mapOverlay = wrap.querySelector('.lightbox-focus-map');
  const dot = wrap.querySelector('.lightbox-focus-dot');
  const toolbar = lb.querySelector('.lightbox-toolbar');
  toolbar.innerHTML = '';
  // Photo-analysis tools (focus peaking, exposure overlays, focus map) only make
  // sense for actual photos - hide the whole toolbar for histograms and the like.
  toolbar.hidden = !photoTools;
  wrap.classList.remove('anr-checkerboard');
  // Forensic/carve views ask for the raw stored raster (nav.rawOrientation): ignore
  // the EXIF orientation tag so the preview matches the reported pixel dimensions.
  // Normal photos leave it unset and honour the tag.
  lbImg.style.imageOrientation = (nav && nav.rawOrientation) ? 'none' : '';
  lbImg.src = src;
  lbImg.alt = alt || '';
  lbImg.onload = () => { sizeWrap(wrap, lbImg.naturalWidth, lbImg.naturalHeight); };
  if (lbImg.complete && lbImg.naturalWidth) sizeWrap(wrap, lbImg.naturalWidth, lbImg.naturalHeight);
  const overlays = wrap.querySelectorAll('.lightbox-peaking');
  const peakingCv = overlays[0], highlightsCv = overlays[1], shadowsCv = overlays[2];
  peakingCv.hidden = true;
  highlightsCv.hidden = true;
  shadowsCv.hidden = true;
  mapOverlay.hidden = true;
  mapOverlay.src = '';
  dot.hidden = true;
  lb.querySelector('.lightbox-meta').textContent = metaText || '';

  // Gallery navigation: prev/next arrows, ArrowLeft/Right keys, and action buttons
  // (Analyse / Download …). nav.checker paints the alpha checkerboard so a partly
  // recovered image's transparent region is visible against the dark backdrop.
  lbNav = nav || null;
  const prevBtn = lb.querySelector('.lightbox-prev');
  const nextBtn = lb.querySelector('.lightbox-next');
  const actionsEl = lb.querySelector('.lightbox-actions');
  prevBtn.hidden = !(nav && nav.onPrev);
  nextBtn.hidden = !(nav && nav.onNext);
  actionsEl.innerHTML = '';
  if (nav && Array.isArray(nav.actions)) {
    for (const a of nav.actions) {
      const b = el('button', { type: 'button', class: 'lightbox-tool-btn' }, a.label);
      b.addEventListener('click', (e) => { e.stopPropagation(); if (a.onClick) a.onClick(); });
      actionsEl.appendChild(b);
    }
  }
  if (nav && nav.checker) wrap.classList.add('anr-checkerboard');

  if (photoTools) {
  let peakingReady = false, highlightsReady = false, shadowsReady = false;

  const peakBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, 'Focus peaking');
  peakBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!peakingReady) { computePeaking(lbImg, peakingCv); peakingReady = true; }
    peakingCv.hidden = !peakingCv.hidden;
    peakBtn.classList.toggle('is-active', !peakingCv.hidden);
  });

  const hlBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, 'Highlights');
  hlBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!highlightsReady) { computeExposureOverlay(lbImg, highlightsCv, 'highlights'); highlightsReady = true; }
    highlightsCv.hidden = !highlightsCv.hidden;
    hlBtn.classList.toggle('is-active', !highlightsCv.hidden);
  });

  const shBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, 'Shadows');
  shBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!shadowsReady) { computeExposureOverlay(lbImg, shadowsCv, 'shadows'); shadowsReady = true; }
    shadowsCv.hidden = !shadowsCv.hidden;
    shBtn.classList.toggle('is-active', !shadowsCv.hidden);
  });

  toolbar.appendChild(peakBtn);
  toolbar.appendChild(hlBtn);

  toolbar.appendChild(shBtn);

  if (showAlpha) {
    const alphaBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, 'Transparency');
    alphaBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      wrap.classList.toggle('anr-checkerboard');
      alphaBtn.classList.toggle('is-active', wrap.classList.contains('anr-checkerboard'));
    });
    toolbar.appendChild(alphaBtn);
  }

  if (focusOpts) {
    const mapSrc = focusOpts.focusCv.toDataURL();
    mapOverlay.src = mapSrc;
    dot.style.left = focusOpts.fpX + '%';
    dot.style.top = focusOpts.fpY + '%';
    const mapBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, 'Focus map');
    mapBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      mapOverlay.hidden = !mapOverlay.hidden;
      mapBtn.classList.toggle('is-active', !mapOverlay.hidden);
    });
    const ptBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, 'Probable focus point');
    ptBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dot.hidden = !dot.hidden;
      ptBtn.classList.toggle('is-active', !dot.hidden);
    });
    toolbar.appendChild(mapBtn);
    toolbar.appendChild(ptBtn);
  }
  }
  var wasHidden = lb.hidden;
  lb.hidden = false;
  document.body.style.overflow = 'hidden';
  // Push a history entry so the device Back button closes the lightbox. Only on
  // a real open (not when swapping to another image while already open).
  if (wasHidden) lbClose = openOverlayBack(hideLightbox);
}
// Raw hide (no history side effects) - this is what the Back button invokes.
function hideLightbox() {
  if (!lightboxEl) return;
  lightboxEl.hidden = true;
  document.body.style.overflow = '';
  lbClose = null;
}
// User-initiated close (button / Esc / backdrop): also unwinds the history entry.
export function closeLightbox() {
  if (lbClose) lbClose();
  else hideLightbox();
}

// ---------- container structure (additive) ----------
// Read the raw bytes the photo pipeline (img decode + exifr) ignores and surface
// the file's *container* layout: chunk/marker structure, bit depth, chroma, and
// - most useful of all - AI-generation prompts embedded in PNG text chunks
// (AUTOMATIC1111 'parameters', ComfyUI 'prompt'/'workflow', NovelAI 'Comment'/
// 'Dream', etc). Returns { rows: [[label,value],…], ai: [{key,value}] } or null
// when the format isn't one we structurally parse / has nothing extra to add.
// Everything here is best-effort and must never throw out to the caller.

// Keys whose tEXt/iTXt/zTXt value is (or contains) an AI-generation prompt.
const PNG_AI_TEXT_KEYS = new Set([
  'parameters',          // AUTOMATIC1111 / Stable Diffusion WebUI
  'prompt', 'workflow',  // ComfyUI (JSON)
  'comment', 'dream',    // NovelAI / others
  'description', 'title', 'sd-metadata', 'invokeai_metadata', 'invokeai'
]);

function pngColourType(t) {
  return { 0: 'Grayscale', 2: 'RGB', 3: 'Palette (indexed)', 4: 'Grayscale + alpha', 6: 'RGBA' }[t] || ('type ' + t);
}

function parsePngContainer(bytes) {
  const rows = [];
  const text = [];          // { key, value } for every text chunk
  const seen = new Set();
  let frames = 0, loops = null, hasPLTE = false, hasTRNS = false;
  let pos = 8;              // skip the 8-byte signature
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (pos + 8 <= bytes.length) {
    const len = dv.getUint32(pos); pos += 4;
    const type = ascii(bytes, pos, 4); pos += 4;
    const dataStart = pos;
    if (len > bytes.length - pos) break;   // truncated / lying length
    seen.add(type);
    if (type === 'IHDR' && len >= 13) {
      const w = dv.getUint32(dataStart), h = dv.getUint32(dataStart + 4);
      const depth = bytes[dataStart + 8], ctype = bytes[dataStart + 9];
      const interlace = bytes[dataStart + 12];
      rows.push(['PNG image', w + ' × ' + h + ' px']);
      rows.push(['Bit depth', depth + '-bit / channel']);
      rows.push(['Colour type', pngColourType(ctype), 'How each pixel’s colour is stored - for example truecolour (full RGB), indexed (a small fixed palette), or greyscale, any of which can also carry transparency.']);
      rows.push(['Interlace', interlace === 1 ? 'Adam7 (progressive)' : 'None', 'Whether a rough version of the image can appear before it finishes loading. ‘Adam7’ loads progressively in passes; ‘None’ loads top to bottom.']);
    } else if (type === 'PLTE') {
      hasPLTE = true;
      rows.push(['Palette', (len / 3) + ' colours']);
    } else if (type === 'tRNS') {
      hasTRNS = true;
    } else if (type === 'pHYs' && len >= 9) {
      const px = dv.getUint32(dataStart), py = dv.getUint32(dataStart + 4);
      const unit = bytes[dataStart + 8];
      if (unit === 1) {     // pixels per metre → DPI
        rows.push(['Resolution', Math.round(px * 0.0254) + ' × ' + Math.round(py * 0.0254) + ' dpi']);
      } else {
        rows.push(['Pixel aspect', px + ':' + py]);
      }
    } else if (type === 'gAMA' && len >= 4) {
      rows.push(['Gamma', (dv.getUint32(dataStart) / 100000).toFixed(4), 'A stored brightness-correction value that helps the image display with the right tone across different screens.']);
    } else if (type === 'sRGB') {
      rows.push(['Colour space', 'sRGB (tagged)']);
    } else if (type === 'acTL' && len >= 8) {
      frames = dv.getUint32(dataStart);
      const lc = dv.getUint32(dataStart + 4);
      loops = lc === 0 ? 'infinite' : lc;
    } else if (type === 'tEXt') {
      const raw = bytes.subarray(dataStart, dataStart + len);
      const nul = raw.indexOf(0);
      if (nul > 0) text.push({ key: latin1(raw.subarray(0, nul)), value: latin1(raw.subarray(nul + 1)) });
    } else if (type === 'iTXt') {
      const raw = bytes.subarray(dataStart, dataStart + len);
      const nul = raw.indexOf(0);
      if (nul > 0) {
        const key = latin1(raw.subarray(0, nul));
        const compressed = raw[nul + 1] === 1;
        // skip: compression flag (1) + method (1) + language tag (cstr) + translated key (cstr)
        let p = nul + 3;
        while (p < raw.length && raw[p] !== 0) p++; p++;        // language tag
        while (p < raw.length && raw[p] !== 0) p++; p++;        // translated keyword
        let value;
        if (compressed) value = null;                          // inflated below (async)
        else value = utf8(raw.subarray(p));
        text.push({ key, value, deflate: compressed ? raw.subarray(p) : null });
      }
    } else if (type === 'zTXt') {
      const raw = bytes.subarray(dataStart, dataStart + len);
      const nul = raw.indexOf(0);
      if (nul > 0) {
        const key = latin1(raw.subarray(0, nul));
        // raw[nul+1] = compression method (0 = zlib); compressed data follows
        text.push({ key, value: null, deflate: raw.subarray(nul + 2) });
      }
    }
    pos = dataStart + len + 4;   // skip data + CRC
    if (type === 'IEND') break;
  }
  if (hasPLTE || hasTRNS) {
    const parts = [];
    if (hasPLTE) parts.push('palette');
    if (hasTRNS) parts.push('transparency (tRNS)');
    rows.push(['Ancillary', parts.join(' + '), 'Optional PNG data blocks beyond the raw pixels - here, a colour palette and/or transparency information.']);
  }
  if (frames > 0) {
    rows.push(['Animation', 'APNG · ' + frames + ' frames']);
    if (loops != null) rows.push(['Loop count', String(loops)]);
  }
  return { rows, text };
}

function parseJpegContainer(bytes) {
  const rows = [];
  let pos = 2;   // skip SOI
  let sof = null, progressive = false, hasExif = false, comment = null, adobe = null, jfif = null;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xFF) { pos++; continue; }
    let marker = bytes[pos + 1];
    while (marker === 0xFF && pos + 2 < bytes.length) { pos++; marker = bytes[pos + 1]; }
    pos += 2;
    if (marker === 0xD9 || marker === 0xDA) break;          // EOI / start of scan
    if (marker >= 0xD0 && marker <= 0xD7) continue;          // RSTn (no length)
    if (pos + 2 > bytes.length) break;
    const seg = (bytes[pos] << 8) | bytes[pos + 1];
    const dataStart = pos + 2, dataEnd = pos + seg;
    if ((marker >= 0xC0 && marker <= 0xCF) && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      // SOFn frame header
      const precision = bytes[dataStart];
      const h = (bytes[dataStart + 1] << 8) | bytes[dataStart + 2];
      const w = (bytes[dataStart + 3] << 8) | bytes[dataStart + 4];
      const comps = bytes[dataStart + 5];
      progressive = (marker === 0xC2 || marker === 0xC6 || marker === 0xCA || marker === 0xCE);
      let chroma = null;
      if (comps === 3) {
        // sampling factors of the luma (first) component → subsampling label
        const hv = bytes[dataStart + 7];
        const hi = hv >> 4, vi = hv & 0x0F;
        chroma = hi === 2 && vi === 2 ? '4:2:0' : hi === 2 && vi === 1 ? '4:2:2'
          : hi === 1 && vi === 1 ? '4:4:4' : hi === 1 && vi === 2 ? '4:4:0' : hi + 'x' + vi;
      }
      sof = { precision, w, h, comps, chroma };
    } else if (marker === 0xE0 && ascii(bytes, dataStart, 4) === 'JFIF') {
      const units = bytes[dataStart + 7];
      const xd = (bytes[dataStart + 8] << 8) | bytes[dataStart + 9];
      const yd = (bytes[dataStart + 10] << 8) | bytes[dataStart + 11];
      if (units === 1) jfif = xd + ' × ' + yd + ' dpi';
      else if (units === 2) jfif = xd + ' × ' + yd + ' dpcm';
      else jfif = 'aspect ' + xd + ':' + yd;
    } else if (marker === 0xE1 && ascii(bytes, dataStart, 4) === 'Exif') {
      hasExif = true;
    } else if (marker === 0xEE && ascii(bytes, dataStart, 5) === 'Adobe') {
      const t = bytes[dataStart + 11];
      adobe = t === 0 ? 'unknown/RGB or CMYK' : t === 1 ? 'YCbCr' : t === 2 ? 'YCCK' : ('transform ' + t);
    } else if (marker === 0xFE) {
      comment = latin1(bytes.subarray(dataStart, Math.min(dataEnd, bytes.length))).trim();
    }
    pos += seg;
  }
  if (sof) {
    rows.push(['JPEG image', sof.w + ' × ' + sof.h + ' px']);
    rows.push(['Bit depth', sof.precision + '-bit / channel']);
    rows.push(['Mode', progressive ? 'Progressive' : 'Baseline', 'How the JPEG is laid out. ‘Baseline’ loads top to bottom; ‘Progressive’ shows the whole frame blurry first, then sharpens as more data arrives.']);
    rows.push(['Components', sof.comps + (sof.comps === 1 ? ' (grayscale)' : sof.comps === 3 ? ' (YCbCr)' : sof.comps === 4 ? ' (CMYK/YCCK)' : ''), 'How many colour channels the image uses. 3 (YCbCr) is normal colour, 1 is greyscale, 4 (CMYK/YCCK) is a print-style colour set.']);
    if (sof.chroma) rows.push(['Chroma subsampling', sof.chroma, 'How much colour detail was thrown away to save space (brightness is always kept in full). ‘4:4:4’ keeps all the colour; ‘4:2:0’ keeps a quarter of it - common, usually invisible, and a useful tell about how the file was saved.']);
  }
  if (jfif) rows.push(['JFIF density', jfif, 'A print-size hint stored in the JPEG header - the intended dots per inch or centimetre. It does not change the pixels or how the image looks on screen.']);
  if (adobe) rows.push(['Adobe transform', adobe, 'A flag Adobe software adds recording how the colour channels were encoded (such as YCbCr or YCCK), so the colours are read back correctly.']);
  if (hasExif) rows.push(['EXIF', 'present (APP1)']);
  if (comment) rows.push(['Comment', comment]);
  return rows.length ? { rows, text: [] } : null;
}

function parseGifContainer(bytes) {
  const rows = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const w = dv.getUint16(6, true), h = dv.getUint16(8, true);
  const packed = bytes[10];
  const gctSize = (packed & 0x80) ? (2 << (packed & 0x07)) : 0;
  rows.push(['GIF image', w + ' × ' + h + ' px']);
  rows.push(['Version', ascii(bytes, 0, 6)]);
  if (gctSize) rows.push(['Global colour table', gctSize + ' colours', 'The shared palette of colours a GIF can draw from - at most 256. A smaller table means fewer distinct colours in the image.']);
  // walk blocks for animation
  let pos = 13 + (gctSize ? gctSize * 3 : 0);
  let frameCount = 0, totalDelay = 0, loop = null;
  while (pos < bytes.length) {
    const b = bytes[pos];
    if (b === 0x3B) break;                                   // trailer
    if (b === 0x2C) {                                        // image descriptor
      frameCount++;
      const lp = bytes[pos + 9];
      pos += 10 + ((lp & 0x80) ? (2 << (lp & 0x07)) * 3 : 0);
      pos++;                                                 // LZW min code size
      while (pos < bytes.length && bytes[pos] !== 0) pos += bytes[pos] + 1;
      pos++;
    } else if (b === 0x21) {                                 // extension
      const label = bytes[pos + 1];
      if (label === 0xF9) {                                  // graphic control
        totalDelay += dv.getUint16(pos + 4, true);
      } else if (label === 0xFF && ascii(bytes, pos + 3, 8) === 'NETSCAPE') {
        loop = dv.getUint16(pos + 16, true);
      }
      pos += 2;
      while (pos < bytes.length && bytes[pos] !== 0) pos += bytes[pos] + 1;
      pos++;
    } else { pos++; }
  }
  if (frameCount > 1) {
    rows.push(['Animation', frameCount + ' frames']);
    if (totalDelay) rows.push(['Total duration', (totalDelay / 100).toFixed(2) + ' s']);
    if (loop != null) rows.push(['Loop count', loop === 0 ? 'infinite' : String(loop)]);
  }
  return { rows, text: [] };
}

function parseWebpContainer(bytes) {
  const rows = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fourcc = ascii(bytes, 12, 4);
  if (fourcc === 'VP8 ') {
    rows.push(['WebP', 'lossy (VP8)']);
  } else if (fourcc === 'VP8L') {
    rows.push(['WebP', 'lossless (VP8L)']);
  } else if (fourcc === 'VP8X') {
    rows.push(['WebP', 'extended (VP8X)']);
    const flags = bytes[20];
    const feat = [];
    if (flags & 0x10) feat.push('alpha');
    if (flags & 0x02) feat.push('animation');
    if (flags & 0x08) feat.push('EXIF');
    if (flags & 0x04) feat.push('XMP');
    if (flags & 0x20) feat.push('ICC');
    if (feat.length) rows.push(['Features', feat.join(', ')]);
    // canvas dimensions: 24-bit each, stored minus one
    const cw = (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1;
    const ch = (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1;
    rows.push(['Canvas', cw + ' × ' + ch + ' px']);
    if (flags & 0x02) {
      // find ANIM chunk for loop count + count ANMF frames
      let pos = 12, frames = 0, loop = null;
      while (pos + 8 <= bytes.length) {
        const cc = ascii(bytes, pos, 4);
        const sz = dv.getUint32(pos + 4, true);
        if (cc === 'ANIM') loop = dv.getUint16(pos + 8 + 4, true);
        else if (cc === 'ANMF') frames++;
        pos += 8 + sz + (sz & 1);
      }
      if (frames) rows.push(['Animation', frames + ' frames']);
      if (loop != null) rows.push(['Loop count', loop === 0 ? 'infinite' : String(loop)]);
    }
  } else {
    return null;
  }
  return { rows, text: [] };
}

function parseBmpContainer(bytes) {
  const rows = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = dv.getUint32(14, true);
  if (headerSize < 40 || bytes.length < 38) return null;     // not BITMAPINFOHEADER
  const w = dv.getInt32(18, true), h = dv.getInt32(22, true);
  const bpp = dv.getUint16(28, true);
  const compression = dv.getUint32(30, true);
  const xppm = dv.getInt32(38, true), yppm = dv.getInt32(42, true);
  const COMP = { 0: 'none (BI_RGB)', 1: 'RLE8', 2: 'RLE4', 3: 'bitfields', 4: 'JPEG', 5: 'PNG' };
  rows.push(['BMP image', w + ' × ' + Math.abs(h) + ' px']);
  rows.push(['Bit depth', bpp + '-bit']);
  rows.push(['Compression', COMP[compression] || String(compression)]);
  if (xppm > 0) rows.push(['Resolution', Math.round(xppm * 0.0254) + ' × ' + Math.round(yppm * 0.0254) + ' dpi']);
  return { rows, text: [] };
}

// Sniff format from magic bytes and dispatch. Async because PNG zTXt/compressed
// iTXt prompts need inflate(). Returns { rows, ai } or null.
async function peekImageContainer(file) {
  // A 4 MiB head covers every container header and any reasonable text/prompt
  // chunk; AI prompts in PNG sit near the front, before the IDAT pixel data.
  const SLICE = 4 * 1024 * 1024;
  const buf = await (file.size > SLICE ? file.slice(0, SLICE) : file).arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes.length < 16) return null;

  let parsed = null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    parsed = parsePngContainer(bytes);
  } else if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    parsed = parseJpegContainer(bytes);
  } else if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    parsed = parseGifContainer(bytes);
  } else if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    parsed = parseWebpContainer(bytes);
  } else if (bytes[0] === 0x42 && bytes[1] === 0x4D) {
    parsed = parseBmpContainer(bytes);
  }
  if (!parsed) return null;

  // Resolve any compressed PNG text chunks, then pull out AI prompts.
  const ai = [];
  if (parsed.text && parsed.text.length) {
    for (const t of parsed.text) {
      if (t.value == null && t.deflate) {
        // zlib stream → try 'deflate' (zlib-wrapped) then 'deflate-raw'.
        let out = await inflate(t.deflate, 'deflate');
        if (!out) out = await inflate(t.deflate, 'deflate-raw');
        t.value = out ? utf8(out) : null;
      }
    }
    for (const t of parsed.text) {
      if (!t.value) continue;
      const k = (t.key || '').toLowerCase();
      if (PNG_AI_TEXT_KEYS.has(k)) ai.push({ key: t.key, value: t.value });
    }
    // Surface non-AI text-chunk keywords compactly in the rows table too.
    const otherKeys = parsed.text
      .filter(t => t.value && !PNG_AI_TEXT_KEYS.has((t.key || '').toLowerCase()))
      .map(t => t.key)
      .filter(Boolean);
    if (otherKeys.length) parsed.rows.push(['Text chunks', otherKeys.join(', ')]);
  }

  if (!parsed.rows.length && !ai.length) return null;
  return { rows: parsed.rows, ai };
}

// Pretty-format an AI prompt value: ComfyUI/A1111 JSON is parsed for the positive
// prompt where easy, otherwise the raw text is shown verbatim.
function formatAiPrompt(value) {
  const out = { pretty: null, raw: value };
  const trimmed = value.trim();
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed);
      // ComfyUI 'workflow'/'prompt' graphs: hunt for CLIPTextEncode positive text.
      const texts = [];
      const walk = (o) => {
        if (!o || typeof o !== 'object') return;
        if (o.class_type === 'CLIPTextEncode' && o.inputs && typeof o.inputs.text === 'string')
          texts.push(o.inputs.text);
        for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v);
      };
      walk(obj);
      if (texts.length) out.pretty = texts.join('\n---\n');
      else out.pretty = JSON.stringify(obj, null, 2);
    } catch (_) { /* not valid JSON - fall through to raw */ }
  }
  return out;
}

function buildContainerCard(container) {
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Container structure'));
  if (container.rows.length) {
    const t = el('table', { class: 'anr-readout' });
    for (const [k, v, help] of container.rows) t.appendChild(help ? rowHelp(k, v, help) : row(k, v));
    card.appendChild(t);
  }
  for (const a of container.ai) {
    const det = el('details', { open: '' });
    const isPrompt = /^(parameters|prompt|workflow|dream|sd-metadata|invokeai)/i.test(a.key);
    det.appendChild(el('summary', {}, [
      el('span', { class: 'anr-summary-label', style: 'color:var(--accent);font-weight:600;' },
        (isPrompt ? 'AI prompt' : 'Embedded text') + '  ·  ' + a.key)
    ]));
    const { pretty, raw } = formatAiPrompt(a.value);
    const pre = el('pre', { class: 'anr-ocr-text', style: 'white-space:pre-wrap;word-break:break-word;' }, pretty || raw);
    det.appendChild(pre);
    if (pretty && pretty !== raw) {
      const rawDet = el('details');
      rawDet.appendChild(el('summary', {}, 'Raw metadata'));
      rawDet.appendChild(el('pre', { class: 'anr-ocr-text', style: 'white-space:pre-wrap;word-break:break-word;' }, raw));
      det.appendChild(rawDet);
    }
    card.appendChild(det);
  }
  return card;
}

// ---------- main render ----------
// Reveal the dedicated Photo section and re-enable its nav tab, so an image
// extracted from a non-photo file (audio cover art, an EPUB cover, a PDF page)
// can be analysed there instead of inline. Returns the #photoResults container
// (or null if the page has no photo section). The caller then renders into it.
export function revealPhotoSection() {
  const photoResults = document.getElementById('photoResults');
  const photoSection = document.getElementById('photo');
  if (photoSection) photoSection.hidden = false;
  if (photoResults) photoResults.hidden = false;
  const navLink = document.querySelector('.site-nav a[href="#photo"]');
  if (navLink) navLink.classList.remove('is-disabled');
  return photoResults;
}

// Build an animated-image frame viewer: a still-canvas stage plus the site's
// stylised transport (play / draggable scrub / time), Prev/Next stepping, and
// Analyse frame / Frame grab / contact-sheet actions - the photo-side counterpart
// of the AVI MJPEG viewer. Shared by animated GIF (decodeGifFrames) and animated
// WebP (decodeWebpFrames), which both hand back a lazy frame SOURCE:
//   { width, height, count, loop, anyTransparency, delaysMs, get(idx)->Promise<RGBA>, close() }
// Frames are decoded on demand via source.get() so a long animation never holds
// every frame in memory at once. `signal` aborts the playback loop and closes the
// source on teardown. `opts`: { kindLabel?: 'animated GIF' }.
function buildFrameViewerCard(file, source, resultsEl, signal, opts = {}) {
  const kindLabel = opts.kindLabel || 'animated GIF';
  const { width, height, count, loop, anyTransparency, delaysMs } = source;
  const n = count;
  const lastIdx = n - 1;

  // Frame start times and the total loop duration, from the source's per-frame
  // millisecond delays (GIF centiseconds are already converted+clamped upstream).
  const startTimes = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) { startTimes[i] = acc / 1000; acc += delaysMs[i]; }
  const totalTime = acc / 1000;
  const fmtTc = (sec) => sec < 60 ? sec.toFixed(2) + 's'
    : Math.floor(sec / 60) + ':' + (sec % 60).toFixed(1).padStart(4, '0');
  // Binary search for the frame whose interval contains time t.
  const frameAtTime = (t) => {
    if (t <= 0) return 0;
    if (t >= totalTime) return lastIdx;
    let lo = 0, hi = lastIdx;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (startTimes[mid] <= t) lo = mid; else hi = mid - 1; }
    return lo;
  };

  // Display stage: a canvas at the GIF's real resolution, scaled by CSS. A
  // checkerboard sits behind it when the animation has transparency.
  const cv = document.createElement('canvas');
  cv.width = width; cv.height = height;
  cv.style.cssText = 'max-width:100%; max-height:480px; height:auto; display:block;';
  const ctx = cv.getContext('2d');
  // Async on-demand draw. A monotonically increasing token means that if several
  // draws are requested in quick succession (e.g. fast scrubbing), only the most
  // recent one paints - stale decodes are dropped rather than flickering.
  let drawToken = 0;
  const draw = (idx) => {
    const my = ++drawToken;
    return source.get(idx).then((data) => {
      if (my !== drawToken) return;
      ctx.putImageData(new ImageData(data, width, height), 0, 0);
    }).catch(() => {});
  };
  // Warm the next frame's cache so forward playback stays smooth.
  const prefetch = (idx) => { if (idx >= 0 && idx <= lastIdx) source.get(idx).catch(() => {}); };
  const stage = el('div', {
    class: 'anr-gif-stage' + (anyTransparency ? ' anr-checkerboard' : ''),
    style: 'display:inline-block; max-width:100%; border:1px solid var(--hairline); background:'
      + (anyTransparency ? 'transparent' : '#0a0a0a') + ';'
  }, [cv]);

  let currentFrame = 0;
  let onFrameShown = null;
  const frameLabel = el('span', { class: 'anr-hint' }, `Frame 1 / ${n}`);
  const showFrame = (idx) => {
    idx = Math.max(0, Math.min(lastIdx, idx));
    currentFrame = idx;
    draw(idx);
    prefetch(idx + 1);
    frameLabel.textContent = `Frame ${idx + 1} / ${n}`;
    if (onFrameShown) onFrameShown(idx);
  };
  draw(0);

  // Composite a frame to a standalone PNG blob, for Analyse frame / Frame grab.
  const frameToBlob = async (idx) => {
    const data = await source.get(idx);
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    c.getContext('2d').putImageData(new ImageData(data, width, height), 0, 0);
    return new Promise((res) => c.toBlob(res, 'image/png'));
  };
  const base = (file.name || 'image').replace(/\.[^.]+$/, '');

  // ---- Transport (variable per-frame delay, wall-clock driven, infinite loop) ----
  const playBtn = el('button', { type: 'button', class: 'anr-player-play', 'aria-label': 'Play' }, '▶');
  const fillEl = el('div', { class: 'anr-player-fill' });
  const trackEl = el('div', { class: 'anr-player-track' }, [fillEl]);
  const timeEl = el('span', { class: 'anr-player-time' }, `${fmtTc(0)} / ${fmtTc(totalTime)}`);
  const playerBar = el('div', { class: 'anr-player', style: 'margin-top:10px;' }, [playBtn, trackEl, timeEl]);

  onFrameShown = (idx) => {
    const t = startTimes[idx];
    fillEl.style.width = (totalTime > 0 ? Math.min(1, t / totalTime) * 100 : 0) + '%';
    timeEl.textContent = `${fmtTc(t)} / ${fmtTc(totalTime)}`;
  };

  let playing = false, rafId = 0, playStart = 0, baseTime = 0;
  const stop = () => {
    if (!playing) return;
    playing = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    playBtn.textContent = '▶';
    playBtn.setAttribute('aria-label', 'Play');
  };
  const tick = (ts) => {
    if (!playing) return;
    let t = baseTime + (ts - playStart) / 1000;
    if (t >= totalTime) { t = totalTime > 0 ? t % totalTime : 0; baseTime = t; playStart = ts; }
    showFrame(frameAtTime(t));
    rafId = requestAnimationFrame(tick);
  };
  playBtn.addEventListener('click', () => {
    if (playing) { stop(); return; }
    playing = true;
    baseTime = currentFrame >= lastIdx ? 0 : startTimes[currentFrame];
    playBtn.textContent = '❚❚';
    playBtn.setAttribute('aria-label', 'Pause');
    rafId = requestAnimationFrame((ts) => { playStart = ts; tick(ts); });
  });

  // Click or drag the track to scrub (stops playback, like the AVI/audio scrubber).
  const seekFromX = (clientX) => {
    const rect = trackEl.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    showFrame(frameAtTime(frac * totalTime));
  };
  let dragging = false;
  const onMove = (e) => { if (dragging) seekFromX(e.clientX); };
  const onUp = () => { dragging = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  trackEl.addEventListener('mousedown', (e) => {
    dragging = true; stop(); seekFromX(e.clientX); e.preventDefault();
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  });
  const onTMove = (e) => { if (dragging && e.touches[0]) { e.preventDefault(); seekFromX(e.touches[0].clientX); } };
  const onTEnd = () => { dragging = false; window.removeEventListener('touchmove', onTMove); window.removeEventListener('touchend', onTEnd); };
  trackEl.addEventListener('touchstart', (e) => {
    dragging = true; stop(); seekFromX(e.touches[0].clientX); e.preventDefault();
    window.addEventListener('touchmove', onTMove, { passive: false }); window.addEventListener('touchend', onTEnd);
  }, { passive: false });

  // Tearing down the render (new file / navigation) must kill the loop and release
  // the source's decoder + frame cache.
  signal.addEventListener('abort', () => { stop(); try { source.close(); } catch (_) {} });

  const prevBtn = el('button', { type: 'button', class: 'anr-btn', onclick: () => { stop(); showFrame(currentFrame - 1); } }, '← Prev');
  const nextBtn = el('button', { type: 'button', class: 'anr-btn', onclick: () => { stop(); showFrame(currentFrame + 1); } }, 'Next →');
  const analyseBtn = el('button', { type: 'button', class: 'anr-btn', onclick: async () => {
    analyseBtn.disabled = true; analyseBtn.textContent = 'Analysing…';
    const blob = await frameToBlob(currentFrame);
    analyseBtn.disabled = false; analyseBtn.textContent = 'Analyse frame';
    if (!blob) return;
    const frameFile = new File([blob], `${base}_frame_${currentFrame + 1}.png`, { type: 'image/png' });
    renderPhoto(frameFile, resultsEl, { sourceNote: `Frame ${currentFrame + 1} of ${n} extracted from ${file.name} (${kindLabel}).` });
  } }, 'Analyse frame');
  const grabBtn = el('button', { type: 'button', class: 'anr-btn', onclick: async () => {
    const blob = await frameToBlob(currentFrame);
    if (!blob) return;
    downloadBlob(`${base}_frame_${currentFrame + 1}.png`, blob);
  } }, 'Frame grab');

  // Contact sheet (>= 8 frames): a 4×2 grid sampled evenly across the animation.
  let sheetBtn = null;
  const sheetOut = el('div');
  if (n >= 8) {
    sheetBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Generate contact sheet');
    sheetBtn.addEventListener('click', async () => {
      sheetBtn.disabled = true; sheetBtn.textContent = 'Generating…';
      const cols = 4, rows = 2, total = cols * rows;
      const scale = 320 / Math.max(width, height);
      const tw = Math.max(1, Math.round(width * scale)), th = Math.max(1, Math.round(height * scale));
      const pad = 4;
      const g = document.createElement('canvas');
      g.width = cols * tw + (cols + 1) * pad;
      g.height = rows * th + (rows + 1) * pad;
      const gctx = g.getContext('2d');
      gctx.fillStyle = '#111'; gctx.fillRect(0, 0, g.width, g.height);
      const tmp = document.createElement('canvas');
      tmp.width = width; tmp.height = height;
      const tctx = tmp.getContext('2d');
      for (let i = 0; i < total; i++) {
        const fi = Math.floor(i * (n - 1) / (total - 1));
        tctx.putImageData(new ImageData(await source.get(fi), width, height), 0, 0);
        const c = i % cols, r = Math.floor(i / cols);
        gctx.drawImage(tmp, pad + c * (tw + pad), pad + r * (th + pad), tw, th);
      }
      sheetOut.innerHTML = '';
      sheetOut.appendChild(el('img', { src: g.toDataURL('image/png'),
        style: 'max-width:100%; margin-top:10px; border:1px solid var(--hairline);' }));
      sheetBtn.disabled = false; sheetBtn.textContent = 'Generate contact sheet';
    });
  }

  // ---- Assemble ----
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Frames'));
  const avgFps = totalTime > 0 ? n / totalTime : 0;
  card.appendChild(el('p', { class: 'anr-hint' },
    `${n} frames · ${fmtTc(totalTime)} total` + (loop != null ? ` · loop ${loop === 0 ? '∞' : loop}` : '')));
  card.appendChild(stage);
  card.appendChild(playerBar);
  card.appendChild(el('p', { class: 'anr-hint', style: 'margin-top:4px; text-align:center;' },
    [frameLabel, document.createTextNode(` · ${avgFps.toFixed(1)} fps avg`)]));
  card.appendChild(el('div', { class: 'anr-frame-grid', style: 'margin-top:10px;' }, [prevBtn, nextBtn]));
  // Full-width action buttons, matching the Prev/Next grid: Analyse frame / Frame
  // grab share a row; the contact-sheet button spans both columns on its own row.
  const actionBtns = [analyseBtn, grabBtn];
  if (sheetBtn) { sheetBtn.style.gridColumn = '1 / -1'; actionBtns.push(sheetBtn); }
  card.appendChild(el('div', { class: 'anr-frame-grid', style: 'margin-top:10px;' }, actionBtns));
  card.appendChild(sheetOut);
  return card;
}

// Reverse card for the animated GIF / WebP viewers: on demand it builds a second
// frame viewer playing the frames backwards (a lazy reversed view over the same
// source), and a reversed-GIF download encoded from those frames. Mirrors the
// audio/video reverse controls. `source` is the same lazy frame source the forward
// viewer used; `opts` carries kindLabel.
function buildReverseAnimationCard(file, source, resultsEl, signal, opts = {}) {
  const kindLabel = opts.kindLabel || 'animated GIF';
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Reverse'));
  card.appendChild(el('p', { class: 'anr-hint' },
    `Play this ${kindLabel} backwards and download it as a reversed GIF.`));
  const out = el('div');
  const btn = el('button', { type: 'button', class: 'anr-btn' }, '↺ Reverse');
  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.textContent = 'Reversing…';
    // Defer so the button repaints before the reverse view + GIF encode.
    setTimeout(async () => {
      try {
        const n = source.count;
        const delaysMs = source.delaysMs.slice().reverse();
        // Lazy reversed view: its frame i maps to the source's frame n-1-i, so
        // playing it forward plays the animation backwards with no extra retention.
        const revSource = {
          width: source.width, height: source.height, count: n,
          loop: source.loop, anyTransparency: source.anyTransparency, delaysMs,
          get: (i) => source.get(n - 1 - Math.max(0, Math.min(n - 1, i | 0))),
          close() {},   // the underlying source is owned + closed by the forward card
        };
        out.appendChild(buildFrameViewerCard(file, revSource, resultsEl, signal,
          { kindLabel: kindLabel + ' (reversed)' }));

        // Encoding a reversed GIF needs every frame's pixels; pull them on demand.
        const framesData = [];
        for (let i = 0; i < n; i++) framesData.push(await source.get(n - 1 - i));
        const delaysCs = delaysMs.map((ms) => Math.max(2, Math.round(ms / 10)));
        const blob = encodeAnimatedGif(source.width, source.height,
          framesData, delaysCs, source.loop == null ? 0 : source.loop);
        const url = URL.createObjectURL(blob);
        if (signal) signal.addEventListener('abort', () => { try { URL.revokeObjectURL(url); } catch (_) {} });
        const base = (file.name || 'image').replace(/\.[^.]+$/, '');
        out.appendChild(el('div', { style: 'margin-top:10px;' }, [
          el('a', { href: url, download: base + '_reversed.gif', class: 'anr-btn',
            style: 'display:inline-block;text-decoration:none;' }, 'Download reversed (GIF)')
        ]));
        btn.remove();
      } catch (_) {
        btn.disabled = false;
        btn.textContent = 'Reverse failed - try again';
      }
    }, 0);
  });
  card.appendChild(btn);
  card.appendChild(out);
  return card;
}

// Tears down the previous photo's persistent loops (the GIF frame player's
// requestAnimationFrame loop) when a new file is analysed or the page navigates.
let photoRenderAbort = null;

export async function renderPhoto(file, resultsEl, opts = {}) {
  // Inline renders (e.g. the compare view's side-by-side panels) must NOT touch
  // the shared abort controller - otherwise a second render would cancel the
  // first's in-flight async (EXIF/OCR/histogram). They get their own isolated
  // controller instead; only the main single-file flow uses the module-level one.
  let renderSignal;
  if (opts.inline) {
    renderSignal = new AbortController().signal;
  } else {
    if (photoRenderAbort) photoRenderAbort.abort();
    photoRenderAbort = new AbortController();
    renderSignal = photoRenderAbort.signal;
  }
  // Inline mode (e.g. embedded cover art analysed inside the audio section):
  // the preview, histogram, and OCR normally target fixed photo-section slots
  // (#photoPreview / #photoHistSlot / #photoOcrSlot). When rendering inline,
  // those slots belong to a different section, so route all three into the given
  // container instead - otherwise they'd leak into the (empty) photo section.
  const inline = !!opts.inline;
  // A compare-view panel is a FULL analysis, just isolated to its own container -
  // it should show everything the normal page does (forensics, C2PA/AI signals,
  // animated-frame viewers, ICO/MPO, embedded thumbnails, edit history, salvage).
  // An extracted sub-image (audio cover art, a video frame - inline WITHOUT
  // compare) stays trimmed so it doesn't bury the host file. `full` gates the heavy
  // extras a sub-image omits; `inline` still gates the genuine inline concerns
  // (local preview/OCR slots, isolated abort controller, no autoscroll/sync).
  const full = !inline || !!opts.compare;
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Loading "${file.name}"...`));

  let imgInfo;
  let convertedFile = null;
  // True once a full libraw demosaic has produced the displayed image (manual
  // "Demosaic RAW" button, or the automatic last-resort fallback below). It tells
  // the downstream code the picture is the real sensor image, not an embedded
  // preview, so it skips the "report the RAW's recorded size" and "offer full
  // decode" steps that only make sense for a preview.
  let fullDecode = opts.rawMode === 'demosaic';
  try {
    imgInfo = await loadImageFromFile(file);
  } catch (e) {
    const ext = fileExt(file.name);
    if (HEIC_EXTS.has(ext)) {
      resultsEl.innerHTML = '';
      resultsEl.appendChild(el('div', { class: 'anr-info' }, 'Converting HEIC/HEIF to JPEG…'));
      try {
        convertedFile = await convertHeic(file);
        imgInfo = await loadImageFromFile(convertedFile);
      } catch (e2) {
        resultsEl.innerHTML = '';
        // A truncated HEIC/HEIF keeps a decodable image (metadata sits at the front)
        // - route to salvage, which clamps the over-large mdat box and re-decodes
        // the surviving tiles. Only when actually truncated; a healthy-but-unsupported
        // HEIC still shows the plain conversion error.
        if (!opts.salvaged) {
          let hb = null; try { hb = new Uint8Array(await file.arrayBuffer()); } catch (_) {}
          let hd = null; if (hb) { try { hd = diagnoseImage(hb); } catch (_) {} }
          if (hd && !hd.healthy && (hd.format === 'heif' || hd.format === 'avif')) {
            return renderPhotoRecovery(file, hb, hd, resultsEl, renderSignal);
          }
        }
        resultsEl.appendChild(errorCard('HEIC conversion failed: ' + (e2 && e2.message ? e2.message : e2)));
        return;
      }
    } else if (RAW_EXTS.has(ext)) {
      resultsEl.innerHTML = '';
      if (opts.rawMode === 'demosaic') {
        // Full sensor decode on demand (libraw WASM): demosaics the Bayer data
        // into a real RGB image, so every downstream metric runs on the actual
        // photo rather than the embedded preview. Triggered by the button under
        // the preview.
        try {
          convertedFile = await demosaicRaw(file, resultsEl);
          imgInfo = await loadImageFromFile(convertedFile);
        } catch (eD) {
          // Even a full decode failed - show metadata + a banner, not an error.
          resultsEl.innerHTML = '';
          await renderUndisplayableImage(file, ext, resultsEl, rawUndecodableBanner());
          return;
        }
      } else {
        // Sigma Foveon X3F: pull the full-res JPEG straight from the X3F
        // container first. It's not TIFF and its sensor block spoofs the
        // JPEG-marker scan, so the generic extractors miss the preview - but the
        // container always embeds one, and this is far more reliable (and lighter)
        // than trying to develop the Foveon sensor without the demosaic pack.
        if (ext === 'x3f') {
          try {
            convertedFile = await extractX3fPreview(file);
            imgInfo = await loadImageFromFile(convertedFile);
          } catch (_) { /* fall through to the generic RAW chain */ }
        }
        if (!imgInfo) try {
          convertedFile = await convertWithImageMagick(file, resultsEl);
          imgInfo = await loadImageFromFile(convertedFile);
        } catch (_) {
          resultsEl.innerHTML = '';
          resultsEl.appendChild(el('div', { class: 'anr-info' }, 'Full decode failed - using embedded preview…'));
          try {
            convertedFile = await extractRawPreview(file);
            imgInfo = await loadImageFromFile(convertedFile);
          } catch (e3) {
            // No embedded preview either. Reconstruct from the sensor data with
            // libraw - the same full decode the manual button uses. Heavyweight,
            // but it's the only way older/compact RAWs (CRW, MRW, ORF, DCR, MOS,
            // X3F…) open at all.
            resultsEl.innerHTML = '';
            resultsEl.appendChild(el('div', { class: 'anr-info' }, 'No preview found - decoding sensor data…'));
            try {
              convertedFile = await demosaicRaw(file, resultsEl);
              imgInfo = await loadImageFromFile(convertedFile);
              fullDecode = true;
            } catch (eD) {
              // Nothing could produce pixels - metadata + banner, never an error.
              resultsEl.innerHTML = '';
              await renderUndisplayableImage(file, ext, resultsEl, rawUndecodableBanner());
              return;
            }
          }
        }
      }
    } else {
      resultsEl.innerHTML = '';
      // The <img> load failed. A 1-byte probe can pass for a cloud-only file
      // (OneDrive serves a cached header) while the full image body is missing,
      // so do a real full read here: if the bytes can't be read AT ALL, it's an
      // unavailable/cloud file, not an unsupported format. Any throw counts -
      // renderUndisplayableImage below needs readable bytes anyway, so a failed
      // full read can only mean the file is unavailable (sync app off, online-only,
      // permission lost), regardless of the exact DOMException name/message.
      let unreadable = false, fileBytes = null;
      try { fileBytes = new Uint8Array(await file.arrayBuffer()); } catch (re) { unreadable = true; }
      // Broken / truncated / corrupt image the browser refused to paint: if the
      // bytes show a recognisable-but-damaged image (or embedded images inside an
      // unrecognised blob), offer to salvage it rather than dropping to the bare
      // "undecodable" banner. Guarded so the repaired file we re-render doesn't loop.
      let salvageDiag = null;
      if (!unreadable && full && !opts.salvaged) {
        try { salvageDiag = diagnoseImage(fileBytes); } catch (_) { salvageDiag = null; }
      }
      const canSalvage = salvageDiag && !salvageDiag.healthy &&
        (salvageDiag.format === 'jpeg' || salvageDiag.format === 'png' ||
          salvageDiag.format === 'avif' || salvageDiag.format === 'heif' ||
          (!salvageDiag.format && salvageDiag.carved && salvageDiag.carved.length));
      // The browser may refuse a JPEG that structurally looks healthy (so diagnoseImage
      // sees no defect) yet desyncs into garbage partway. The tolerant decoder catches
      // that from the bytes; if it flags corruption, salvage it rather than dropping to
      // the bare "browser can't decode" banner.
      let decCorrupt = false;
      if (!unreadable && full && !opts.salvaged && fileBytes && !canSalvage
          && /^(jpg|jpeg|jpe|jfif)$/.test(fileExt(file.name))) {
        try { const dd = decodeJpegPartial(fileBytes); decCorrupt = !!(dd && dd.corrupt); } catch (_) {}
      }
      if (unreadable) {
        resultsEl.appendChild(cloudFileWarning(file));
      } else if (canSalvage) {
        return renderPhotoRecovery(file, fileBytes, salvageDiag, resultsEl, renderSignal);
      } else if (decCorrupt) {
        const diag = {
          format: 'jpeg', healthy: false,
          issues: [{ msg: 'The JPEG scan desynchronises partway - past that point it decodes to garbage. Only the rows above the break are the real picture.' }],
        };
        return renderPhotoRecovery(file, fileBytes, diag, resultsEl, renderSignal);
      } else if (full && (ext === 'tif' || ext === 'tiff')) {
        // Browsers can't decode TIFF, but a TIFF can hold many pages. Render them
        // all with ImageMagick (only if there are 2+; single-page falls through to
        // the normal undecodable-info card).
        resultsEl.innerHTML = '';
        resultsEl.appendChild(el('div', { class: 'anr-info' }, 'Reading TIFF pages…'));
        let pagesCard = null;
        try { pagesCard = await buildTiffPagesCard(file, renderSignal, resultsEl); } catch (_) { pagesCard = null; }
        if (renderSignal.aborted) return;
        resultsEl.innerHTML = '';
        if (pagesCard) {
          resultsEl.appendChild(pagesCard);
          await renderUndisplayableImage(file, ext, resultsEl,
            el('div', { class: 'anr-info' }, 'Multi-page TIFF - every page is decoded above. The metadata below is read straight from the file.'));
        } else {
          await renderUndisplayableImage(file, ext, resultsEl);
        }
      } else if (full && ext === 'jxl') {
        // Browsers dropped JPEG XL support, but the bundled ImageMagick has the
        // JXL coder - decode it to a viewable image, then run the normal photo
        // analysis on it. On failure, fall back to the metadata-only banner.
        resultsEl.innerHTML = '';
        try {
          convertedFile = await convertWithImageMagick(file, resultsEl, 'decoding JPEG XL');
          imgInfo = await loadImageFromFile(convertedFile);
        } catch (_) {
          resultsEl.innerHTML = '';
          await renderUndisplayableImage(file, ext, resultsEl);
          return;
        }
      } else {
        // Readable, but the browser has no decoder for this image format. Show a
        // clear browser-limitation banner (like the ProRes video path) plus any
        // metadata still readable from the bytes - not a bare error.
        await renderUndisplayableImage(file, ext, resultsEl);
      }
      return;
    }
  }
  const { img, url } = imgInfo;

  // The browser can decode a corrupt JPEG "successfully" - a desynced scan is painted
  // as a genuine top strip over garbage (or comes back near-empty), so it reaches here
  // looking like a healthy photo. Detecting that on the *browser's* canvas is unreliable
  // (its error concealment differs from ours), so ask the tolerant decoder directly: it
  // reads the bytes and flags the desync deterministically, browser-independent. When it
  // does, route to the salvage view (real top strip + greyed remainder + a note on how
  // much is real). Guarded to the plain single-file JPEG path so a good photo is never
  // diverted, and `corrupt` is the well-guarded signal (never trips on a real photo).
  if (full && !opts.salvaged && !fullDecode && !convertedFile
      && /^(jpg|jpeg|jpe|jfif)$/.test(fileExt(file.name)) && browserCanvasSuspicious(img)) {
    let bytes = null, dec = null;
    try { bytes = new Uint8Array(await file.arrayBuffer()); } catch (_) {}
    if (renderSignal.aborted) return;
    if (bytes) { try { dec = decodeJpegPartial(bytes); } catch (_) {} }
    if (dec && dec.corrupt) {
      URL.revokeObjectURL(url);
      const diag = {
        format: 'jpeg', healthy: false,
        issues: [{ msg: 'The JPEG scan desynchronises partway - past that point it decodes to garbage (the browser paints it as saturated colour-block noise). Only the rows above the break are the real picture.' }],
      };
      return renderPhotoRecovery(file, bytes, diag, resultsEl, renderSignal);
    }
  }

  // EXIF
  let exif = null;
  try {
    exif = await exifr.parse(file, {
      tiff: true, exif: true, gps: true, iptc: true, xmp: true, icc: true, ihdr: true,
      // makerNote unlocks maker-specific fields - most importantly the shutter
      // actuation count (Nikon/Pentax/Sony and some others store it there, in both
      // RAW files and JPEGs).
      makerNote: true,
      mergeOutput: true, translateValues: true, translateKeys: true, reviveValues: true,
      sanitize: true, silentErrors: true
    });
  } catch (e) {
    console.warn('exifr error:', e);
  }

  // For RAW files the on-screen picture is the JPEG preview embedded in the RAW,
  // which is usually smaller than the sensor's real output. So the *reported*
  // resolution (Dimensions, Megapixels, Aspect ratio, captions) should come from
  // the RAW's own recorded full-image size - EXIF PixelXDimension/PixelYDimension
  // (translated by exifr to ExifImageWidth/Height), falling back to the TIFF
  // ImageWidth/Length - not from the preview's pixel count. Per-pixel analysis
  // (sharpness, histogram, focus, colours) still runs on the preview pixels.
  let dimW = img.naturalWidth, dimH = img.naturalHeight, dimsFromMeta = false;
  if (RAW_EXTS.has(fileExt(file.name)) && exif && !fullDecode) {
    const ew = exif.ExifImageWidth || exif.ImageWidth || 0;
    const eh = exif.ExifImageHeight || exif.ImageHeight || 0;
    if (ew > 0 && eh > 0 && ew * eh >= img.naturalWidth * img.naturalHeight) {
      // Match the preview's orientation: a browser auto-rotates the preview by its
      // EXIF Orientation, but the sensor dimensions are stored pre-rotation, so a
      // portrait shot would otherwise report landscape figures.
      dimW = ew; dimH = eh;
      if ((dimW > dimH) !== (img.naturalWidth > img.naturalHeight) && img.naturalWidth !== img.naturalHeight) {
        const t = dimW; dimW = dimH; dimH = t;
      }
      dimsFromMeta = true;
    }
  }

  const pixData = getPixelData(img);
  const hist = computeHistogram(pixData);
  const palette = dominantColors(pixData, 8);
  const sharpness = computeSharpness(pixData);
  const colorStats = computeColorStats(pixData);
  const blockSize = Math.max(4, Math.round(Math.min(pixData.width, pixData.height) / 48));
  const focus = detectFocusRegion(pixData, blockSize);

  let hasAlpha = false;
  for (let i = 3; i < pixData.data.length; i += 16) {
    if (pixData.data[i] < 250) { hasAlpha = true; break; }
  }

  resultsEl.innerHTML = '';

  // RAW view toggle (top of the analysis column): switch every metric between the
  // camera's embedded-preview JPEG and a full libraw demosaic of the sensor data.
  // Both matter - the preview is the camera's own rendering, the demosaic is the
  // real sensor - so this re-runs the whole analysis on whichever is picked. Only
  // for a genuinely dropped RAW that produced pixels (not inline/cover-art).
  if (full && !opts.sourceNote && convertedFile && RAW_EXTS.has(fileExt(file.name))) {
    const mode = fullDecode ? 'demosaic' : 'preview';
    const bar = el('div', { class: 'anr-raw-modebar' });
    bar.appendChild(el('span', { class: 'anr-raw-modebar-label' }, 'Analyse'));
    const mk = (label, m, help) => {
      const b = el('button', { type: 'button', class: 'anr-btn' + (mode === m ? ' is-active' : ''), title: help }, label);
      if (mode !== m) b.addEventListener('click', () => { b.disabled = true; renderPhoto(file, resultsEl, { ...opts, rawMode: m }); });
      return b;
    };
    bar.appendChild(mk('RAW (embedded preview)', 'preview', 'Analyse the JPEG preview the camera embedded in the RAW, alongside the RAW metadata.'));
    bar.appendChild(mk('Demosaiced (full decode)', 'demosaic', 'Decode the sensor data with libraw into a full RGB image and analyse that instead.'));
    resultsEl.appendChild(bar);
  }

  // When this image was extracted from another file (audio cover art, an EPUB
  // cover, a PDF page), a one-line note records where it came from.
  if (opts.sourceNote) {
    const srcCard = el('div', { class: 'anr-card' });
    srcCard.appendChild(el('p', { class: 'anr-hint', style: 'margin:0;' }, opts.sourceNote));
    resultsEl.appendChild(srcCard);
  }

  // ---- Preview thumb in section-meta column ----
  // Develop-settings (.xmp sidecar) card. showDevelop fills/replaces it; it's fed
  // either by a RAW+XMP drop (opts.sidecarXmp) or the per-RAW "Import XMP" button.
  const developContainer = el('div');
  const showDevelop = (xmpText, label) => {
    developContainer.innerHTML = '';
    developContainer.appendChild(buildDevelopCard(xmpText, label));
  };

  const previewSlot = inline ? el('div') : document.getElementById('photoPreview');
  if (inline) resultsEl.appendChild(previewSlot);
  if (previewSlot) {
    previewSlot.innerHTML = '';
    const thumb = el('div', { class: 'section-meta-preview' });
    const thumbImg = el('img', { src: url, alt: file.name, title: 'Click to enlarge' });
    const lightboxCaption = `${dimW} × ${dimH}  ·  ${fmtBytes(file.size)}  ·  ${file.name}`;
    thumbImg.addEventListener('click', () => {
      const fpPctX = (focus.focusX / pixData.width * 100).toFixed(2);
      const fpPctY = (focus.focusY / pixData.height * 100).toFixed(2);
      openLightbox(url, file.name, lightboxCaption, { focusCv, fpX: parseFloat(fpPctX), fpY: parseFloat(fpPctY) }, hasAlpha);
    });
    const imgWrap = el('div', { class: 'anr-preview-img-wrap' });
    if (hasAlpha) imgWrap.classList.add('anr-checkerboard');
    imgWrap.appendChild(thumbImg);
    thumb.appendChild(imgWrap);
    thumb.appendChild(el('p', { class: 'section-meta-preview-caption' },
      `${dimW} × ${dimH} · ${fmtBytes(file.size)}`));


    const focusCv = document.createElement('canvas');
    focusCv.width = focus.cols; focusCv.height = focus.rows;
    const fCtx = focusCv.getContext('2d');
    const fImg = fCtx.createImageData(focus.cols, focus.rows);
    for (let i = 0; i < focus.grid.length; i++) {
      const t = Math.min(1, focus.grid[i] / (focus.maxVar * 0.8));
      fImg.data[i*4] = Math.round(t * 255);
      fImg.data[i*4+1] = Math.round(t * 80);
      fImg.data[i*4+2] = Math.round((1 - t) * 40);
      fImg.data[i*4+3] = Math.round(t * 200);
    }
    fCtx.putImageData(fImg, 0, 0);

    if (convertedFile && RAW_EXTS.has(fileExt(file.name)) && !fullDecode) {
      // The full-decode option now lives in the "Analyse" toggle at the top of the
      // results; here we just note the preview's resolution caveat.
      thumb.appendChild(el('p', { class: 'anr-raw-warning' },
        'This is the camera\'s embedded preview - use "Demosaiced (full decode)" at the top to analyse the full sensor image.'));
    }
    previewSlot.appendChild(thumb);

    // Download the displayed image. For HEIC/RAW the preview is a converted JPEG,
    // so offer it under a .jpg name; otherwise it's the original file's own bytes.
    const dlName = convertedFile ? (file.name.replace(/\.[^.]+$/, '') + '.jpg') : file.name;
    const dlBtn = el('a', {
      href: url, download: dlName, class: 'anr-btn',
      style: 'margin-top:10px;font-size:11px;width:100%;text-align:center;text-decoration:none;display:block;box-sizing:border-box;'
    }, convertedFile ? 'Download photo (JPEG)' : 'Download photo');
    previewSlot.appendChild(dlBtn);

    // Sonify: read the picture as a spectrogram and resynthesise audio from it.
    // Presented as a card in the Sound section (like a video's "Audio track"
    // prompt), not a button under the thumbnail. Only for a genuinely dropped
    // photo - skipped for inline cover art and for video frames / cover art pulled
    // in with a sourceNote, so the host file's own Sound section stays clean. It
    // reuses the image we already decoded (so HEIC/RAW work without re-decoding);
    // the heavy synthesis module loads on demand.
    if (full && !opts.sourceNote) {
      // Normally the Sonify prompt goes in the page's dedicated Sound section. On a
      // page with no Sound section (the compare view) route it into a local slot
      // tagged anr-cmp-sub-audio, which the compare merge files under Sound and, as
      // an interactive prompt, collapses into one central "Sonify (both files)"
      // button - exactly like a video's "Analyse audio" prompt.
      const audioResultsEl = document.getElementById('audioResults')
        || (inline ? resultsEl.appendChild(el('div', { class: 'anr-results anr-cmp-subslot anr-cmp-sub-audio' })) : null);
      if (audioResultsEl) {
        audioResultsEl.hidden = false;
        const sonifyCard = el('div', { class: 'anr-card' });
        sonifyCard.appendChild(el('h3', {}, 'Sonify image'));
        sonifyCard.appendChild(el('p', { class: 'anr-info' },
          'Read this picture as a spectrogram - brightness becomes loudness, height becomes pitch - and resynthesise it as sound you can play, scrub and export.'));
        const sonifyBtn = el('button', { type: 'button', class: 'anr-btn anr-btn--cta' }, 'Sonify (play as spectrogram)');
        sonifyCard.appendChild(sonifyBtn);
        audioResultsEl.appendChild(sonifyCard);
        sonifyBtn.addEventListener('click', async () => {
          sonifyBtn.disabled = true;
          sonifyBtn.textContent = 'Loading sonifier…';
          const mount = el('div', { id: 'photoSonifyMount' });
          sonifyCard.replaceWith(mount);
          // Scroll to the top of the Sound section (heading + lede), matching the
          // video "Analyse audio" behaviour, not just the results container.
          (audioResultsEl.closest('.section') || audioResultsEl)
            .scrollIntoView({ behavior: 'smooth', block: 'start' });
          try {
            const { renderSonify } = await import('./sonify.js');
            await renderSonify(file, mount, { source: img, signal: renderSignal });
          } catch (e) {
            mount.appendChild(el('div', { class: 'anr-info' }, 'Sonifier failed to load: ' + (e && e.message ? e.message : e)));
          }
        });
      }
    }

    // Live Photo / Motion Photo: if a motion clip is appended to this still, show an
    // "Analyse live photo" button that plays it in the full video + audio sections.
    wireLivePhotoButton(file, previewSlot, resultsEl, renderSignal);

    // RAW only: a button under the thumbnail to import the .xmp develop-settings
    // sidecar a raw developer (Photoshop / Lightroom / Camera Raw) saved alongside.
    if (RAW_EXTS.has(fileExt(file.name))) {
      const xmpInput = el('input', { type: 'file', accept: '.xmp', hidden: '' });
      const importBtn = el('button', { type: 'button', class: 'anr-btn', style: 'margin-top:10px;font-size:11px;width:100%;' }, 'Import XMP settings');
      importBtn.addEventListener('click', () => xmpInput.click());
      xmpInput.addEventListener('change', async () => {
        const f = xmpInput.files && xmpInput.files[0];
        if (!f) return;
        importBtn.textContent = 'Reading…';
        try { showDevelop(await f.text(), f.name); importBtn.textContent = 'Replace XMP settings'; }
        catch (_) { importBtn.textContent = 'Could not read XMP'; }
      });
      previewSlot.appendChild(el('div', { class: 'anr-raw-xmp-import' }, [importBtn, xmpInput]));
    }
  }
  // Develop-settings card sits at the top of the results column (empty until an
  // XMP sidecar is dropped with the RAW or imported via the button above).
  resultsEl.appendChild(developContainer);
  if (opts && opts.sidecarXmp) {
    try { showDevelop(await opts.sidecarXmp.text(), opts.sidecarXmp.name); } catch (_) {}
  }

  // ---- Basic info ----
  const infoCard = el('div', { class: 'anr-card' });
  infoCard.appendChild(el('h3', {}, 'File & image'));
  const w = dimW, h = dimH;
  const mp = ((w * h) / 1_000_000).toFixed(2);

  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Name',          file.name));
  tbl.appendChild(row('Size',          fmtBytes(file.size)));
  // .THM has no MIME type, so fill the slot with what it actually is: the small
  // JPEG preview a camera writes beside each movie clip.
  const isThm = /\.thm$/i.test(file.name || '');
  tbl.appendChild(rowHelp('Type', file.type || (isThm ? 'image/jpeg - movie thumbnail (.THM)' : '-'),
    isThm
      ? 'A .THM file is the thumbnail a camera saves next to a video clip - a small JPEG (here ' + w + '×' + h + ') previewing the movie. Canon, and others, write one per clip. It is a normal JPEG, just with a .THM extension.'
      : "The MIME type is a short standard label for the kind of file this is, such as image/jpeg. Your browser guesses it from the filename or the operating system, so it is a hint about the format, not proof."));
  tbl.appendChild(row('Modified',      file.lastModified ? new Date(file.lastModified).toISOString().replace('T', ' ').replace(/\..*$/, '') : '-'));
  tbl.appendChild(row('Dimensions',    `${w} × ${h} px`));
  const d = gcd(w, h);
  const exactReduced = `${w / d}:${h / d}`;
  const approx = approxAspect(w, h);
  // Decimal of the estimated (nearest-standard) ratio, in the same orientation
  // as w:h, so it can be compared against the true proportion.
  let approxDec = null;
  if (approx) { const [an, ad] = approx.split(':').map(Number); if (an && ad) approxDec = an / ad; }
  let aspectVal;
  if (approx && (d === 1 || d === 2) && approxDec !== null && Math.abs(w / h - approxDec) < 0.0002) {
    // The exact reduced ratio is just the raw resolution (or half it: gcd 1 or 2),
    // so the fraction carries no meaning - yet the proportion sits within 0.0002
    // of a standard ratio. Show only that standard ratio, unqualified (no "≈").
    aspectVal = `${approx}  (${(w / h).toFixed(4)})`;
  } else if (approx && approx !== exactReduced) {
    // Show the nearest-standard ratio with its own decimal in brackets, so it
    // can be read directly against the exact proportion (e.g. "258:145 (1.7793)
    // ≈ 16:9 (1.7778)").
    const approxStr = approxDec !== null ? `${approx} (${approxDec.toFixed(4)})` : approx;
    aspectVal = `${aspectRatio(w, h)}  ≈ ${approxStr}`;
  } else {
    aspectVal = aspectRatio(w, h);
  }
  tbl.appendChild(rowHelp('Aspect ratio', aspectVal,
    'The shape of the picture - its width compared with its height. The first figure is the exact ratio in lowest terms (with its decimal); “≈” marks the nearest common ratio, such as 3:2 or 16:9.'));
  tbl.appendChild(rowHelp('Megapixels', mp + ' MP',
    'How many pixels (the tiny coloured dots that make up the picture) there are in total, counted in millions - width × height ÷ 1,000,000.'));
  tbl.appendChild(rowHelp('Sharpness', sharpness + ' / 100  (' + sharpnessLabel(sharpness) + ')',
    'How much fine detail and crisp edges the picture holds (measured with a Laplacian filter), taken as a share of the image’s overall contrast and scored from 0 to 100. Comparing against contrast means the score follows focus rather than how bold the scene is, so a flat but sharp photo still scores well and a punchy but blurred one scores low. Around 60 and up looks sharp, under 40 soft or blurry.'));
  const fpx = Math.round(focus.focusX / pixData.width * w);
  const fpy = Math.round(focus.focusY / pixData.height * h);
  tbl.appendChild(rowHelp('Focus point', fpx + ', ' + fpy + '  (estimated)',
    'A best guess at where the picture is sharpest, found by scanning small patches across the image and picking the one with the most fine detail (highest Laplacian variance).'));
  const avgHex = '#' + hexBytes([colorStats.avgR, colorStats.avgG, colorStats.avgB], '');
  tbl.appendChild(rowHelp('Average colour', avgHex + '  (R' + colorStats.avgR + ' G' + colorStats.avgG + ' B' + colorStats.avgB + ')',
    'The average colour of all the pixels (their red, green and blue values averaged together), shown as a hex-coded swatch. It gives a quick sense of the picture’s overall tint and brightness.'));
  tbl.appendChild(rowHelp('Tonal split', colorStats.shadows + '% shadows · ' + colorStats.midtones + '% midtones · ' + colorStats.highlights + '% highlights',
    'How the picture’s pixels divide up by brightness (on a 0-255 scale): dark ‘shadows’ below 64, mid-tones from 64 to 191, and bright ‘highlights’ at 192 and above.'));
  if (exif && exif.Orientation != null) {
    tbl.appendChild(row('Orientation', (ORIENTATIONS[exif.Orientation] || exif.Orientation)));
  }
  if (convertedFile) {
    const ext = fileExt(file.name).toUpperCase();
    const isPreview = convertedFile.name.includes('_preview');
    const convLabel = isPreview ? 'embedded preview' : 'full resolution';
    tbl.appendChild(rowHelp('Converted', ext + ' → JPEG (' + convLabel + ')',
      'The original format cannot be shown directly, so your browser converted a copy to JPEG on your device for previewing and analysis here. The original file is left untouched.'));
  }
  infoCard.appendChild(tbl);

  if (convertedFile) {
    const dlBtn = el('button', { type: 'button', class: 'anr-btn', style: 'margin-top:12px;' }, 'Download as JPEG');
    dlBtn.addEventListener('click', () => {
      downloadBlob(convertedFile.name, convertedFile);
    });
    infoCard.appendChild(dlBtn);
  }

  resultsEl.appendChild(infoCard);

  // ---- Animated GIF / WebP: frame-by-frame viewer ----
  // A browser plays a GIF or animated WebP in the <img> preview above but won't
  // let you step through it. Decode the frames ourselves and offer the same
  // transport the AVI viewer does (play / scrub / Prev / Next / grab / analyse).
  // Only in the main photo section - skipped for inline cover-art renders.
  if (full && (fileExt(file.name) === 'gif' || file.type === 'image/gif') && file.size <= 200 * 1024 * 1024) {
    try {
      const source = decodeGifFrames(await file.arrayBuffer(), ANIM_PIXEL_BUDGET);
      if (source && source.count > 1) {
        resultsEl.appendChild(buildFrameViewerCard(file, source, resultsEl, renderSignal));
        resultsEl.appendChild(buildReverseAnimationCard(file, source, resultsEl, renderSignal));
      }
    } catch (_) { /* malformed GIF - leave the normal photo view untouched */ }
  } else if (full && (fileExt(file.name) === 'webp' || file.type === 'image/webp')) {
    try {
      const source = await decodeWebpFrames(file, ANIM_PIXEL_BUDGET);
      if (source && source.count > 1) {
        resultsEl.appendChild(buildFrameViewerCard(file, source, resultsEl, renderSignal, { kindLabel: 'animated WebP' }));
        resultsEl.appendChild(buildReverseAnimationCard(file, source, resultsEl, renderSignal, { kindLabel: 'animated WebP' }));
      }
    } catch (_) { /* not animated / no ImageDecoder - leave the normal photo view */ }
  } else if (full && (fileExt(file.name) === 'ico' || fileExt(file.name) === 'cur' ||
      file.type === 'image/x-icon' || file.type === 'image/vnd.microsoft.icon')) {
    // An icon container holds several images; the <img> above paints only one, so
    // pull out and show every embedded size/depth.
    try {
      const icoCard = await buildIcoImagesCard(file, renderSignal, resultsEl);
      if (icoCard && !renderSignal.aborted) resultsEl.appendChild(icoCard);
    } catch (_) { /* malformed ICO - leave the normal photo view untouched */ }
  } else if (full && (/^(jpe?g|jpe|jfif|mpo)$/.test(fileExt(file.name)) || file.type === 'image/jpeg')) {
    // A JPEG / MPO can carry several full images via Multi-Picture Format (stereo
    // 3D pairs, multi-angle sets). The <img> paints only the first - show them all.
    try {
      const mpoCard = await buildMpoImagesCard(file, renderSignal, resultsEl);
      if (mpoCard && !renderSignal.aborted) resultsEl.appendChild(mpoCard);
    } catch (_) { /* not a multi-picture JPEG - leave the normal photo view */ }
  }

  // ---- EXIF sections ----
  // Sony/Nikon RAW/JPEG: recover the shutter-actuation count from the maker-note
  // block exifr can't read (Sony's is encrypted, Nikon's is a plain tag), so the
  // "Shutter count" row can appear.
  const sExt = fileExt(file.name);
  const sMake = (exif && exif.Make) || '';
  if (exif && /sony|nikon/i.test(sMake) && !(Number(exif.ShutterCount) > 0)
      && (RAW_EXTS.has(sExt) || /^jpe?g$/.test(sExt) || file.type === 'image/jpeg')) {
    try { const sc = readShutterCount(await file.arrayBuffer(), sMake); if (sc) exif.ShutterCount = sc; } catch (_) {}
  }
  // Mean luminance of the decoded pixels, feeding the optics EV-vs-brightness note.
  let meanLuma = null;
  try {
    const pd = pixData.data; let sum = 0, cnt = 0;
    for (let i = 0; i < pd.length; i += 16) { sum += 0.299 * pd[i] + 0.587 * pd[i + 1] + 0.114 * pd[i + 2]; cnt++; }
    if (cnt) meanLuma = sum / cnt;
  } catch (_) {}
  const optRows = opticsRows(exif, meanLuma);
  const sections = buildExifSections(exif);
  if (sections.length || optRows.length) {
    const exifCard = el('div', { class: 'anr-card' });
    exifCard.appendChild(el('h3', {}, 'Metadata'));
    for (const sec of sections) {
      exifCard.appendChild(el('div', { class: 'anr-readout-section' }, sec.title));
      const t = el('table', { class: 'anr-readout' });
      for (const [k, v, help] of sec.rows) t.appendChild(help ? rowHelp(k, v, help) : row(k, v));
      exifCard.appendChild(t);
    }
    // ---- Optics (derived, not stored) ----
    if (optRows.length) {
      exifCard.appendChild(el('div', { class: 'anr-readout-section' }, 'Optics (derived)'));
      const t = el('table', { class: 'anr-readout' });
      for (const [k, v, help] of optRows) t.appendChild(help ? rowHelp(k, v, help) : row(k, v));
      exifCard.appendChild(t);
    }
    if (full) attachImageScrub(file, exifCard);
    resultsEl.appendChild(exifCard);
  } else {
    resultsEl.appendChild(el('div', { class: 'anr-info' }, 'No EXIF / IPTC / XMP / ICC metadata found.'));
  }

  // ---- Content Credentials (C2PA) + AI-generation signals ----
  // Both cards read the C2PA manifest; parse it once here and share it so the
  // file isn't read (and the JUMBF/CBOR manifest parsed) twice.
  if (full) {
    const c2paManifests = await readC2pa(file).catch(() => null);
    try {
      const c2paCard = await buildC2paCard(file, c2paManifests);
      if (c2paCard && !renderSignal.aborted) resultsEl.appendChild(c2paCard);
    } catch (_) { /* no C2PA / unparsable - show nothing */ }

    try {
      const aiCard = await buildAiSignalsCard(file, exif, c2paManifests);
      if (aiCard && !renderSignal.aborted) resultsEl.appendChild(aiCard);
    } catch (_) { /* no AI indicators - show nothing */ }
  }

  // ---- EXIF thumbnail proportion check ----
  // The embedded EXIF thumbnail is a downscaled copy cached at capture time. If the
  // photo is later cropped/edited but the thumbnail isn't refreshed, the two carry
  // different proportions - a tell the pixels were changed after capture. Compare
  // orientation-independent aspect ratios and only flag a clear gap. Fully isolated;
  // a failure (or no thumbnail) just shows nothing.
  try {
    if (typeof exifr !== 'undefined' && exifr.thumbnail && w && h) {
      const thumbBytes = await exifr.thumbnail(file).catch(() => null);
      if (thumbBytes && thumbBytes.byteLength) {
        const tDim = await decodeImageDims(new Blob([thumbBytes], { type: 'image/jpeg' }));
        if (tDim && tDim.w && tDim.h) {
          const longShort = (a, b) => Math.max(a, b) / Math.min(a, b);
          const mainAR = longShort(w, h);
          const thumbAR = longShort(tDim.w, tDim.h);
          // Many older cameras write a fixed 160×120 thumbnail regardless of the
          // photo's real shape - that's not an edit tell, so don't flag it.
          const isFixedThumb = (tDim.w === 160 && tDim.h === 120) || (tDim.w === 120 && tDim.h === 160);
          const diff = Math.abs(mainAR - thumbAR) / mainAR;
          if (!isFixedThumb && diff > 0.05) {
            const card = el('div', { class: 'anr-card' });
            const [tcH, tcHelp] = h3help('Thumbnail check',
              'The embedded thumbnail is a cached copy made at capture. Proportions that no longer match the full image can mean the photo was cropped or edited afterwards without the thumbnail being refreshed. Some cameras store a fixed-size thumbnail, which on its own is not a sign of editing.');
            card.appendChild(tcH); card.appendChild(tcHelp);
            card.appendChild(el('p', { style: 'color:var(--accent);font-weight:600;margin-bottom:8px;' },
              '⚠ Embedded thumbnail proportions differ from the full image'));
            const tt = el('table', { class: 'anr-readout' });
            tt.appendChild(row('Full image', w + ' × ' + h + '  (' + mainAR.toFixed(3) + ':1)'));
            tt.appendChild(row('EXIF thumbnail', tDim.w + ' × ' + tDim.h + '  (' + thumbAR.toFixed(3) + ':1)'));
            tt.appendChild(row('Difference', (diff * 100).toFixed(1) + '%'));
            card.appendChild(tt);
            resultsEl.appendChild(card);
          }
        }
      }
    }
  } catch (_) { /* ignore */ }

  // ---- Timestamp anomaly check ----
  // Compare the EXIF capture/create/modify dates against each other and the file's
  // own last-modified time; flag impossible relationships (future dates, modified
  // before captured, a file that predates the photo it holds). Generous skew margin.
  try {
    if (exif) {
      const tac = timeAnomalyCard(timeAnomalies({
        captured: exif.DateTimeOriginal instanceof Date ? exif.DateTimeOriginal : null,
        created: exif.CreateDate instanceof Date ? exif.CreateDate
          : (exif.DateTimeDigitized instanceof Date ? exif.DateTimeDigitized : null),
        modified: exif.ModifyDate instanceof Date ? exif.ModifyDate : null,
        filesystem: file.lastModified ? new Date(file.lastModified) : null,
      }));
      if (tac) resultsEl.appendChild(tac);
    }
  } catch (_) { /* ignore */ }

  // ---- AI detection ----
  const aiHints = detectAI(exif);
  if (aiHints) {
    const aiCard = el('div', { class: 'anr-card' });
    const [aiH, aiHelp] = h3help('AI detection',
      'Based on metadata fields. Not all AI-generated images contain markers, and some markers can be spoofed.');
    aiCard.appendChild(aiH); aiCard.appendChild(aiHelp);
    aiCard.appendChild(el('p', { style: 'color:var(--accent);font-weight:600;margin-bottom:8px;' },
      'AI-generated content markers found'));
    const at = el('table', { class: 'anr-readout' });
    for (const h of aiHints) at.appendChild(row(h.field, h.value));
    aiCard.appendChild(at);
    resultsEl.appendChild(aiCard);
  } else if (exif) {
    const aiCard = el('div', { class: 'anr-card' });
    aiCard.appendChild(el('h3', {}, 'AI detection'));
    aiCard.appendChild(el('p', { class: 'anr-hint' }, 'No AI-generation markers found in metadata.'));
    resultsEl.appendChild(aiCard);
  }

  // ---- Histogram (full-width, in the body just above the container structure) ----
  const histBlock = el('div', { class: 'anr-card anr-hist-block' });
  const [histH, histHelp] = h3help('RGB histogram',
    'A graph of how many pixels sit at each brightness level, plotted separately for red, green and blue - black on the far left (0), white on the far right (255). Click to enlarge.');
  histBlock.appendChild(histH); histBlock.appendChild(histHelp);
  const histCanvas = el('canvas', { class: 'anr-histogram' });
  histCanvas.width = 1024; histCanvas.height = 200;
  histCanvas.style.cursor = 'zoom-in';
  histCanvas.addEventListener('click', () => {
    openLightbox(histCanvas.toDataURL('image/png'), 'RGB Histogram', 'RGB Histogram', null, false, false);
  });
  histBlock.appendChild(histCanvas);
  renderHistogram(histCanvas, hist);
  resultsEl.appendChild(histBlock);

  // ---- Forensics panel (JPEG only) ----
  // The JPEG/pixel tamper tools, built as a collapsible panel and stashed in
  // `advForensics` so it can be dropped into the shared "Advanced" card lower down
  // (next to LSB analysis). Runs only for a genuinely-dropped JPEG (not a preview
  // transcoded from HEIC/RAW - re-encoding an already-transcoded frame would say
  // nothing about the original). Stacked sub-sections, like the Metadata card.
  let advForensics = null;
  if (full && !convertedFile && (/^(jpe?g|jpe|jfif)$/.test(fileExt(file.name)) || file.type === 'image/jpeg')) {
    const fDet = el('details');
    const fSum = el('summary', {});
    fSum.appendChild(el('span', { class: 'anr-summary-label' }, 'Forensics'));
    fDet.appendChild(fSum);
    const fCard = el('div');   // panel content container (kept named fCard below)
    fDet.appendChild(fCard);
    fCard.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 10px;' },
      'Pixel- and compression-level checks for signs the photo was edited after capture. No single one is proof - weigh them together, and alongside the metadata and thumbnail checks.'));

    // -- Error-level analysis --
    const [elaSec, elaSecHelp] = sectionHelp('Error-level analysis',
      'The picture is saved again as a JPEG and the difference from the original is brightened up. A photo saved just once looks fairly even all over; an area pasted in from another picture, or painted on top, was often compressed differently and shows up brighter or darker than its surroundings. Bright outlines along sharp, high-contrast edges are normal - look instead for whole patches that stand out from what is around them.');
    fCard.appendChild(elaSec); fCard.appendChild(elaSecHelp);
    const elaStatus = el('p', { class: 'anr-hint', style: 'margin:0 0 8px;' }, 'Computing...');
    fCard.appendChild(elaStatus);
    const elaStage = el('div', { style: 'border:var(--bd-hairline); background:#000; display:flex; justify-content:center; align-items:center; min-height:80px;' });
    fCard.appendChild(elaStage);
    const qVal = el('span', { class: 'anr-hint', style: 'min-width:40px; text-align:right;' }, '90%');
    const qSlider = el('input', { type: 'range', class: 'anr-range', min: '60', max: '98', step: '1', value: '90', style: 'width:100%;' });
    const aVal = el('span', { class: 'anr-hint', style: 'min-width:40px; text-align:right;' }, '18×');
    const aSlider = el('input', { type: 'range', class: 'anr-range', min: '5', max: '40', step: '1', value: '18', style: 'width:100%;' });
    fCard.appendChild(el('div', { style: 'display:grid; grid-template-columns:auto 1fr auto; gap:8px 10px; align-items:center; margin-top:10px; font-family:var(--font-mono); font-size:var(--t-small);' }, [
      el('span', { class: 'anr-hint' }, 'Quality'), qSlider, qVal,
      el('span', { class: 'anr-hint' }, 'Amplify'), aSlider, aVal,
    ]));

    // -- Quantization fingerprint --
    let qBytes = null;
    try { qBytes = new Uint8Array(await file.arrayBuffer()); } catch (_) {}
    const qz = qBytes ? analyzeJpegQuantization(qBytes) : null;
    if (qz) {
      fCard.appendChild(el('div', { class: 'anr-readout-section' }, 'Quantization fingerprint'));
      const qt = el('table', { class: 'anr-readout' });
      qt.appendChild(rowHelp('Effective quality',
        '~' + qz.lumaQuality + '%' + (qz.chromaQuality != null ? ' luma / ~' + qz.chromaQuality + '% chroma' : ''),
        'The quality setting the JPEG was saved at (roughly 1 to 100, where higher means less compression). It is worked back out by comparing the file’s compression tables (its ‘quantization tables’) against the standard tables at each quality level.'));
      qt.appendChild(rowHelp('Tables',
        qz.isStandard ? 'Standard (IJG / libjpeg)' : 'Custom (camera or encoder-specific)',
        'These compression tables can be the standard ones (called Annex-K) that most software uses - editors, "Save for Web", browsers and converters. Cameras almost always use their own custom tables, so finding standard tables on a photo that claims to come straight from a camera suggests it was re-saved by software.'));
      fCard.appendChild(qt);
      // Cross-reference the claimed software when the tables disagree with it.
      const sw = exif && exif.Software ? String(exif.Software) : '';
      let verdict = qz.isStandard
        ? 'These are the standard tables that software uses. If the file is being presented as a straight-from-camera original, that is a warning sign - it has been through an editor or converter.'
        : 'These are custom tables, which fits an original camera JPEG (or a particular program that uses its own tables).';
      if (sw) verdict += ' Metadata names the software as "' + sw + '".';
      fCard.appendChild(el('p', { class: 'anr-hint', style: 'margin:8px 0 0;' }, verdict));
      // The luminance table itself - the literal fingerprint - as a compact grid.
      const grid = el('div', { style: 'display:grid; grid-template-columns:repeat(8, 1fr); gap:2px; margin-top:10px; max-width:340px; font-family:var(--font-mono); font-size:11px; text-align:center;' });
      for (let i = 0; i < 64; i++) {
        grid.appendChild(el('div', { style: 'background:var(--surface); border:var(--bd-hairline); padding:2px 0;' }, String(qz.luma.table[i])));
      }
      fCard.appendChild(el('div', { class: 'anr-hint', style: 'margin-top:10px;' }, 'Luminance quantization table'));
      fCard.appendChild(grid);
    }

    // -- JPEG ghosts (on demand - it does a full sweep of recompressions) --
    const [ghostSec, ghostSecHelp] = sectionHelp('JPEG ghosts',
      'Saves the picture again at many different quality settings and compares each one. An area brought in from another, differently-compressed picture turns dark - a ‘ghost’ - in the map whose quality matches how that area was first saved, while the rest of the frame stays plain. Look for a small dark blob that appears in only some of the maps.');
    fCard.appendChild(ghostSec); fCard.appendChild(ghostSecHelp);
    const ghostGrid = el('div', { style: 'display:grid; grid-template-columns:repeat(auto-fill, minmax(120px, 1fr)); gap:10px; margin-top:6px;' });
    const ghostBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Run ghost sweep');
    ghostBtn.addEventListener('click', async () => {
      ghostBtn.disabled = true; ghostBtn.textContent = 'Analysing...';
      const ghosts = await computeJpegGhosts(img).catch(() => null);
      if (renderSignal.aborted) return;
      if (!ghosts || !ghosts.length) { ghostBtn.textContent = 'Ghost sweep unavailable'; return; }
      for (const g of ghosts) {
        const url = g.canvas.toDataURL('image/png');
        const im = el('img', { src: url, alt: 'ghost ' + g.quality, loading: 'lazy',
          style: 'width:100%; height:auto; display:block; border:var(--bd-hairline); cursor:zoom-in;' });
        im.addEventListener('click', () => openLightbox(url, file.name,
          'JPEG ghost - quality ' + g.quality + '% - ' + file.name, null, false, false));
        ghostGrid.appendChild(el('div', {}, [im,
          el('p', { class: 'anr-hint', style: 'margin:4px 0 0; text-align:center;' }, g.quality + '%')]));
      }
      ghostBtn.remove();
    });
    fCard.appendChild(ghostBtn);
    fCard.appendChild(ghostGrid);

    advForensics = fDet;

    let elaBusy = false, elaPending = false;
    const runEla = async () => {
      if (elaBusy) { elaPending = true; return; }
      elaBusy = true;
      const q = (+qSlider.value) / 100, amp = +aSlider.value;
      const cv = await computeElaCanvas(img, { quality: q, amplify: amp }).catch(() => null);
      elaBusy = false;
      if (renderSignal.aborted) return;
      if (!cv) { elaStatus.textContent = 'Error-level analysis unavailable for this image.'; return; }
      elaStage.innerHTML = '';
      cv.style.cssText = 'max-width:100%; height:auto; display:block; cursor:zoom-in;';
      cv.addEventListener('click', () => openLightbox(cv.toDataURL('image/png'), file.name,
        'Error-level analysis - ' + file.name, null, false, false));
      elaStage.appendChild(cv);
      const st = cv._elaStats;
      elaStatus.textContent = st
        ? 'Re-saved at ' + Math.round(q * 100) + '% quality, amplified ' + amp + '×. Mean error ' + st.meanErr.toFixed(1) + ', peak ' + Math.round(st.maxErr) + ' (0-255).'
        : '';
      if (elaPending) { elaPending = false; runEla(); }
    };
    qSlider.addEventListener('input', () => { qVal.textContent = qSlider.value + '%'; });
    aSlider.addEventListener('input', () => { aVal.textContent = aSlider.value + '×'; });
    qSlider.addEventListener('change', runEla);
    aSlider.addEventListener('change', runEla);
    // Compute lazily the first time the panel is expanded, not on every load.
    fDet.addEventListener('toggle', () => { if (fDet.open && !fDet._elaRan) { fDet._elaRan = true; runEla(); } });
  }

  // ---- Container structure (raw bytes the img/exifr pipeline ignores) ----
  // Best-effort and fully isolated: a parse failure must never break the rest of
  // the photo analysis, and nothing is appended when there's nothing to show.
  try {
    const container = await peekImageContainer(file);
    if (container) resultsEl.appendChild(buildContainerCard(container));
  } catch (e) {
    console.warn('container peek failed:', e);
  }

  // ---- Computational photo (ProRAW / Live Photo / Motion Photo / Ultra HDR) ----
  try {
    const comp = await detectComputational(file, exif);
    if (comp.length) {
      const card = el('div', { class: 'anr-card' });
      const [ch, cHelp] = h3help('Computational photo', 'Detected from XMP / maker metadata and embedded markers.');
      card.appendChild(ch); card.appendChild(cHelp);
      const t = el('table', { class: 'anr-readout' });
      for (const [k, v] of comp) t.appendChild(row(k, v));
      card.appendChild(t);
      resultsEl.appendChild(card);
    }
  } catch (e) { /* never break the rest of the analysis */ }

  // ---- GPS ----
  // Number.isFinite (not `!= null`) so NaN/undefined coordinates are rejected -
  // mobile camera photos without a GPS fix were slipping through as NaN and
  // rendering a 0,0 / NaN map. Also skip the 0,0 null-island placeholder.
  if (exif && Number.isFinite(exif.latitude) && Number.isFinite(exif.longitude) && !(exif.latitude === 0 && exif.longitude === 0)) {
    const gpsCard = el('div', { class: 'anr-card' });
    gpsCard.appendChild(el('h3', {}, 'GPS'));
    const lat = exif.latitude, lon = exif.longitude;
    const gt = el('table', { class: 'anr-readout' });
    gt.appendChild(row('Latitude',  lat.toFixed(6) + '°'));
    gt.appendChild(row('Longitude', lon.toFixed(6) + '°'));
    if (exif.GPSAltitude != null) gt.appendChild(rowHelp('Altitude', (+exif.GPSAltitude).toFixed(1) + ' m',
      'How high above sea level the camera’s GPS recorded the photo being taken, in metres.'));
    if (exif.GPSImgDirection != null) gt.appendChild(rowHelp('Image direction', (+exif.GPSImgDirection).toFixed(1) + '°',
      'Which way the camera was pointing when the photo was taken, as a compass bearing in degrees (0° = north, 90° = east, and so on).'));
    if (exif.GPSSpeed != null) gt.appendChild(row('Speed', exif.GPSSpeed + ' ' + (exif.GPSSpeedRef || '')));
    gpsCard.appendChild(gt);

    const linkRow = el('p', {}, [
      '> open in ',
      el('a', { href: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`, target: '_blank' }, 'OpenStreetMap'),
      ' / ',
      el('a', { href: `https://www.google.com/maps?q=${lat},${lon}`, target: '_blank' }, 'Google Maps')
    ]);
    gpsCard.appendChild(linkRow);

    const mapDiv = el('div', { class: 'anr-map' });
    mapDiv.appendChild(el('p', { style: 'padding:8px; margin:0;' }, 'loading map...'));
    gpsCard.appendChild(mapDiv);
    resultsEl.appendChild(gpsCard);
    makeMap(mapDiv, lat, lon, file.name);
  }

  // ---- Palette ----
  const palCard = el('div', { class: 'anr-card' });
  const [palH, palHelp] = h3help('Dominant colours', 'The picture’s most common colours. Every pixel is sorted into one of 512 colour bins (8 steps each for red, green and blue), the busiest bins are counted, near-identical ones are merged, and the top 8 colours are shown. Click a swatch to copy its hex code.');
  palCard.appendChild(palH); palCard.appendChild(palHelp);
  const palDiv = el('div', { class: 'anr-palette' });
  const totalPx = pixData.width * pixData.height;
  for (const c of palette) {
    const hex = toHex(c);
    const sw = el('div', {
      class: 'anr-swatch',
      title: hex + '  ' + ((c.count / totalPx) * 100).toFixed(1) + '% - click to copy',
      style: 'cursor:pointer;',
      onclick: () => {
        navigator.clipboard.writeText(hex).then(() => {
          const label = sw.querySelector('span');
          if (label) { label.textContent = 'copied'; setTimeout(() => { label.textContent = hex; }, 800); }
        });
      }
    });
    sw.style.background = hex;
    sw.appendChild(el('span', {}, hex));
    palDiv.appendChild(sw);
  }
  palCard.appendChild(palDiv);
  resultsEl.appendChild(palCard);

  // ---- Embedded images / thumbnails ----
  // Nearly every camera still caches a smaller JPEG copy of itself inside its own
  // metadata: an ordinary JPEG/TIFF stores an EXIF thumbnail (IFD1), and a RAW packs
  // a full-size preview plus a screen thumbnail beside the sensor data. The browser
  // only ever paints the main picture, so pull every stored JPEG straight from the
  // bytes and lay them out so each is visible, downloadable and re-analysable.
  // extractRawJpegs walks the TIFF/EXIF IFDs (RAW II/MM at 0, or the Exif block of a
  // JPEG) and returns only the JPEGs those IFDs reference - i.e. the embedded
  // thumbnails/previews, never the main image. Fully isolated: on failure or when
  // there's nothing embedded, the card simply doesn't appear.
  if (full) {
    const isRaw = RAW_EXTS.has(fileExt(file.name));
    try {
      const jpegs = await extractRawJpegs(file);
      if (jpegs.length && !renderSignal.aborted) {
        const baseName = (file.name || 'image').replace(/\.[^/.]+$/, '');
        const items = jpegs.map((j, i) => ({
          bytes: j.length,
          viewBlob: j.blob,
          downloadBlob: j.blob,
          downloadName: baseName + '_thumb_' + (i + 1) + '.jpg',
        }));
        const hint = isRaw
          ? 'Cached JPEG previews extracted straight from the file bytes.'
          : (jpegs.length === 1
              ? 'A cached JPEG copy extracted straight from the file bytes.'
              : jpegs.length + ' cached JPEG copies extracted straight from the file bytes, largest first.');
        const help = isRaw
          ? 'RAW files store one or more complete JPEGs alongside the sensor data - a small thumbnail for camera playback, plus larger preview(s) a viewer can show without decoding the RAW. The main image above is handled separately.'
          : 'An EXIF thumbnail is a smaller JPEG copy of the photo that the camera caches inside the file for quick previewing.';
        const embCard = buildEmbeddedImagesCard({
          title: isRaw ? 'Embedded images' : 'Embedded thumbnails',
          hint, help, items, signal: renderSignal, resultsEl, sourceFile: file,
        });
        resultsEl.appendChild(embCard);
      }
    } catch (_) { /* no embedded JPEGs - show nothing */ }
  }

  // ---- Barcode / QR detection (async) ----
  const qrPlaceholder = el('div');
  resultsEl.appendChild(qrPlaceholder);
  detectCodes(img).then((codes) => {
    if (!codes.length) { qrPlaceholder.remove(); return; }
    const qrCard = el('div', { class: 'anr-card' });
    qrCard.appendChild(el('h3', {}, codes.length === 1 ? 'Code detected' : codes.length + ' codes detected'));
    const qt = el('table', { class: 'anr-readout' });
    for (const c of codes) {
      qt.appendChild(row(fmtCodeFormat(c.format), c.data.length > 300 ? c.data.slice(0, 300) + '…' : c.data));
      if (/^https?:\/\//i.test(c.data))
        qt.appendChild(row('Link', el('a', { href: c.data, target: '_blank', rel: 'noopener' }, c.data)));
    }
    qrCard.appendChild(qt);
    qrPlaceholder.replaceWith(qrCard);
  }).catch(() => { qrPlaceholder.remove(); });

  // ---- OCR in section-meta column ----
  const ocrSlot = inline ? el('div') : document.getElementById('photoOcrSlot');
  if (inline) resultsEl.appendChild(ocrSlot);
  if (ocrSlot) {
    ocrSlot.innerHTML = '';
    ocrSlot.appendChild(makeOcrCard(file, img));
  }

  // ---- Hash + raw EXIF dump (collapsible) ----
  const hashCard = el('div', { class: 'anr-card' });
  const [hashH, hashHelp] = h3help('Integrity', '<strong>pHash</strong> (perceptual hash) is a short fingerprint of what the picture looks like. Two images that look alike get similar fingerprints, even after resizing or re-saving - handy for spotting duplicates.<br><strong>SHA-256</strong> is a fingerprint of the exact file data instead. Change even a single bit of the file and this fingerprint changes completely - handy for checking a file has not been altered.');
  hashCard.appendChild(hashH); hashCard.appendChild(hashHelp);
  const phash = computePHash(img);
  const hashTbl = el('table', { class: 'anr-readout' });
  hashTbl.appendChild(rowHelp('pHash', phash,
    'Perceptual hash - a short fingerprint of what the picture looks like. Images that look alike get similar fingerprints, even after resizing or compression.'));
  hashTbl.appendChild(sha256Row(file));
  hashCard.appendChild(hashTbl);
  resultsEl.appendChild(hashCard);

  // ---- Advanced (forensic + technical panels, collapsed) ----
  // One card holding the heavier/technical views, sitting where LSB analysis used
  // to: the JPEG Forensics panel (built earlier - ELA, quantization fingerprint,
  // JPEG ghosts; JPEG only) and LSB / bit-plane analysis. Each panel is a <details>
  // collapsed by default, so the card stays compact until a tool is opened.
  const advCard = el('div', { class: 'anr-card' });
  advCard.appendChild(el('h3', {}, 'Advanced'));
  advCard.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 4px;' },
    'More detailed forensic and technical views.'));
  if (advForensics) advCard.appendChild(advForensics);

  // -- Edit history + Privacy panels (read the raw bytes once) --
  if (full) {
    let advBytes = null;
    try { advBytes = new Uint8Array(await file.arrayBuffer()); } catch (_) {}
    if (advBytes) try {
      // Edit history: XMP xmpMM:History timeline + Photoshop IPTC-digest check.
      const xh = parseXmpHistory(advBytes);
      const digest = checkIptcDigest(advBytes);
      const hasHistory = xh && (xh.history.length || xh.creatorTool || xh.documentId || xh.instanceId);
      if (hasHistory || (digest && digest.hasDigest)) {
        const { det, body } = advPanel('Edit history',
          'Traces that editing software left behind in this file. The XMP history is a log written by Lightroom, Photoshop and similar tools; the IPTC digest check tests whether the caption and keyword details were changed after Photoshop last saved the file.');
        if (digest && digest.hasDigest) {
          const dt = el('table', { class: 'anr-readout' });
          dt.appendChild(rowHelp('IPTC digest',
            digest.match ? 'Matches - metadata intact since Photoshop wrote it'
              : (digest.computed ? '⚠ Mismatch - IPTC metadata changed after Photoshop' : 'Present, but no IPTC block to verify against'),
            'When Photoshop saves a file it stores a small checksum (an MD5) of the caption, keyword and creator details. If that no longer matches, those details were changed by another program after Photoshop last saved the file.'));
          body.appendChild(dt);
        }
        if (xh && (xh.creatorTool || xh.documentId || xh.instanceId)) {
          const it = el('table', { class: 'anr-readout' });
          if (xh.creatorTool) it.appendChild(row('Creator tool', xh.creatorTool));
          if (xh.documentId) it.appendChild(rowHelp('Document ID', xh.documentId, 'A hidden identifier XMP tools give the original document. It stays the same across edits and re-saves, so it can link different versions of one file back to a common source.'));
          if (xh.instanceId) it.appendChild(rowHelp('Instance ID', xh.instanceId, 'A hidden identifier that changes each time the file is saved, so it marks this particular saved version - useful for telling one edit of a file from another.'));
          body.appendChild(it);
        }
        if (xh && xh.history.length) {
          body.appendChild(el('div', { class: 'anr-readout-section' }, 'Timeline (' + xh.history.length + ' events)'));
          const tt = el('table', { class: 'anr-readout' });
          for (const h of xh.history) {
            const when = h.when ? h.when.replace('T', ' ').replace(/[+-]\d\d:\d\d$/, '') : '-';
            const what = [h.action, h.softwareAgent].filter(Boolean).join('  ·  ') + (h.changed ? '  (' + h.changed + ')' : '');
            tt.appendChild(row(when, what || '-'));
          }
          body.appendChild(tt);
        }
        advCard.appendChild(det);
      }

      // Privacy: report which identifying fields are present. The lossless
      // metadata stripper itself is the "Remove metadata" control on the
      // Metadata card (scrub.js) - not duplicated here.
      const sens = privacyRows(exif);
      if (sens.length) {
        const { det, body } = advPanel('Privacy',
          'Details in this file’s metadata that could help identify you or reveal where the photo was taken. They stay inside the file when you share it.');
        body.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 8px;' },
          'Use "Remove metadata" on the Metadata card to strip these out.'));
        const st = el('table', { class: 'anr-readout' });
        for (const [k, v] of sens) st.appendChild(row(k, v));
        body.appendChild(st);
        advCard.appendChild(det);
      }
    } catch (_) { /* edit-history / privacy parsing failed - skip these panels */ }
  }

  // -- LSB / bit-plane analysis panel --
  const lsbDet = el('details');
  const lsbHelp = el('div', { class: 'anr-info-panel is-hidden', html: 'Every pixel’s colour is stored as bits (ones and zeros). Bit-plane analysis pulls out a single bit from each colour channel (red, green, blue) and shows it as a black-and-white image. In an ordinary photo the lowest bits look like random speckle; clear patterns, text or shapes there can point to a hidden message (steganography) or heavy editing. A chi-square test also estimates how likely it is that data has been tucked into the least-significant bits, and you can flick through all eight bit planes (0 = the least-significant bit, up to 7 = the most-significant). Click a preview to open it at full resolution.' });
  const lsbSummary = el('summary', {});
  // Title + [?] grouped in one span so the summary's flex space-between keeps them
  // together on the left (only the open/close marker sits at the right edge).
  const lsbTitle = el('span', { class: 'anr-summary-label' });
  lsbTitle.appendChild(document.createTextNode('LSB Analysis '));
  const lsbInfoBtn = el('button', { type: 'button', class: 'anr-info-btn', title: 'Info' }, '[?]');
  wireInfoToggle(lsbInfoBtn, lsbHelp);
  lsbTitle.appendChild(lsbInfoBtn);
  lsbSummary.appendChild(lsbTitle);
  lsbDet.appendChild(lsbSummary);
  const lsbContent = el('div');
  lsbContent.appendChild(lsbHelp);
  renderLsbPlanes(img, lsbContent);
  lsbDet.appendChild(lsbContent);
  advCard.appendChild(lsbDet);

  resultsEl.appendChild(advCard);

  const raw = buildRawDump(exif);
  if (raw && raw.length) {
    const dumpCard = el('div', { class: 'anr-card' });
    const det = el('details');
    det.appendChild(el('summary', {}, 'Raw metadata dump  (' + raw.length + ' tags)'));
    const t = el('table', { class: 'anr-readout' });
    for (const [k, v] of raw) t.appendChild(row(k, v));
    det.appendChild(t);
    dumpCard.appendChild(det);
    resultsEl.appendChild(dumpCard);
  }
}

// ---------- setup ----------
export function initPhoto({ dropEl, inputEl, resultsEl, onFile }) {
  const handle = onFile || ((file) => renderPhoto(file, resultsEl));
  inputEl.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handle(file);
    inputEl.value = '';
  });
  // Visual highlight only; the actual drop is handled at the window level
  // so it can dispatch the file to the right module based on its type.
  ['dragenter', 'dragover'].forEach((ev) =>
    dropEl.addEventListener(ev, () => dropEl.classList.add('is-dragover'))
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dropEl.addEventListener(ev, () => dropEl.classList.remove('is-dragover'))
  );
}
