/* Analyser - DjVu document viewer
   ============================================================================
   DjVu is a scanned-document format (common for archived books and journals).
   Uses the vendored DjVu.js (pure JavaScript, bundled for the browser) to decode
   pages to ImageData and paint them to a canvas, with prev/next paging. Decoding
   a scanned page can take a moment, so the pager is disabled while a page renders. */

import { el, row, rowHelp, h3help, fmtBytes, sha256Row, errorCard, loadScript } from '../core/util.js';

const DJVU_URL = 'assets/vendor/djvu/djvu.js';

async function loadDjVu() {
  if (!window.DjVu) { try { await loadScript(DJVU_URL); } catch (_) {} }
  return window.DjVu || null;
}

export async function renderDjvu(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading DjVu document "${file.name}"…`));

  const DjVu = await loadDjVu();
  if (!DjVu) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not load the DjVu reader. Check your connection, then try again.'));
    return;
  }

  let doc, count, sizes = null;
  try {
    const buf = await file.arrayBuffer();
    doc = new DjVu.Document(buf);
    count = doc.getPagesQuantity();
    try { sizes = doc.getPagesSizes(); } catch (_) { sizes = null; }
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read this DjVu document: ' + (e && e.message)));
    return;
  }

  resultsEl.innerHTML = '';

  // ---- Metadata ----
  const card = el('div', { class: 'anr-card' });
  const [h, help] = h3help('DjVu document', 'A scanned-document format. Analyser decodes and renders each page in the browser.');
  card.appendChild(h); card.appendChild(help);
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Format', (doc.isBundled && doc.isBundled()) ? 'DjVu (bundled)' : 'DjVu'));
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  tbl.appendChild(row('Pages', String(count)));
  if (sizes && sizes[0]) {
    const s = sizes[0];
    tbl.appendChild(row('First page', s.width + ' × ' + s.height + ' px' + (s.dpi ? ' · ' + s.dpi + ' dpi' : '')));
  }
  tbl.appendChild(sha256Row(file));
  card.appendChild(tbl);
  resultsEl.appendChild(card);

  // ---- Page viewer ----
  const view = el('div', { class: 'anr-card' });
  view.appendChild(el('h3', {}, 'Pages'));
  const prev = el('button', { type: 'button', class: 'anr-btn' }, '‹ Prev');
  const next = el('button', { type: 'button', class: 'anr-btn' }, 'Next ›');
  const status = el('span', { class: 'anr-djvu-status' }, '');
  view.appendChild(el('div', { class: 'anr-djvu-bar' }, [prev, status, next]));
  const canvas = el('canvas', { class: 'anr-djvu-canvas' });
  view.appendChild(canvas);
  resultsEl.appendChild(view);

  let cur = 0, busy = false;
  async function show(n) {
    if (busy) return;
    n = Math.max(1, Math.min(count, n));
    busy = true;
    prev.disabled = next.disabled = true;
    status.textContent = 'Rendering page ' + n + ' of ' + count + '…';
    try {
      const page = await doc.getPage(n);
      const img = page.getImageData();
      canvas.width = img.width; canvas.height = img.height;
      canvas.getContext('2d').putImageData(img, 0, 0);
      cur = n;
      status.textContent = 'Page ' + n + ' of ' + count;
    } catch (e) {
      status.textContent = 'Could not render page ' + n + '.';
    }
    busy = false;
    prev.disabled = cur <= 1; next.disabled = cur >= count;
  }
  prev.addEventListener('click', () => show(cur - 1));
  next.addEventListener('click', () => show(cur + 1));
  show(1);
}
