/* Analyser - Kindle / Mobipocket e-book reader (MOBI / AZW / AZW3)
   ============================================================================
   Uses the vendored foliate-js `mobi.js` (pure JavaScript, self-contained ES
   module) to decode MOBI 6 and KF8 (AZW3, and combo .mobi) e-books fully in the
   browser. Shows the metadata and cover, then a section-by-section reader: each
   section is decoded to a self-contained HTML blob and shown in a sandboxed
   iframe (no scripts), with images resolved. KF8's HUFF/CDIC decompression can
   be slow, so the pager is disabled while a section loads. */

import { el, row, rowHelp, h3help, fmtBytes, sha256Row, errorCard } from '../core/util.js';

const FFLATE_URL = new URL('../../vendor/fflate.js', import.meta.url).href;
const MOBI_URL = new URL('../../vendor/foliate/mobi.js', import.meta.url).href;

// foliate metadata values can be a string, an array, or a localised object.
function metaStr(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(metaStr).filter(Boolean).join(', ');
  if (typeof v === 'object') return v.name ? metaStr(v.name) : metaStr(Object.values(v)[0]);
  return String(v);
}

export async function renderMobi(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading e-book "${file.name}"…`));

  let book;
  try {
    const fflate = await import(FFLATE_URL);
    const { MOBI } = await import(MOBI_URL);
    book = await new MOBI({ unzlib: fflate.unzlibSync }).open(file);
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read this e-book: ' + (e && e.message)));
    return;
  }

  resultsEl.innerHTML = '';

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const md = book.metadata || {};

  // ---- Metadata ----
  const card = el('div', { class: 'anr-card' });
  const [h, help] = h3help('E-book', 'Kindle / Mobipocket e-book. Text, metadata and cover are decoded in the browser.');
  card.appendChild(h); card.appendChild(help);
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Format', ext === 'azw3' ? 'Kindle KF8 (AZW3)' : ext === 'azw' ? 'Kindle (AZW)' : 'Mobipocket / Kindle (MOBI)'));
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  const title = metaStr(md.title); if (title) tbl.appendChild(row('Title', title));
  const author = metaStr(md.author); if (author) tbl.appendChild(row('Author', author));
  const pub = metaStr(md.publisher); if (pub) tbl.appendChild(row('Publisher', pub));
  const lang = metaStr(md.language); if (lang) tbl.appendChild(row('Language', lang));
  const published = metaStr(md.published); if (published) tbl.appendChild(row('Published', published.replace('T', ' ').replace(/\..*$/, '')));
  if (book.sections) tbl.appendChild(row('Sections', String(book.sections.length)));
  tbl.appendChild(sha256Row(file));
  card.appendChild(tbl);
  resultsEl.appendChild(card);

  // ---- Cover ----
  try {
    const cover = book.getCover && await book.getCover();
    if (cover) {
      const pcard = el('div', { class: 'anr-card' });
      pcard.appendChild(el('h3', {}, 'Cover'));
      pcard.appendChild(el('img', { src: URL.createObjectURL(cover), alt: 'Cover', class: 'anr-iwork-preview' }));
      resultsEl.appendChild(pcard);
    }
  } catch (_) { /* no cover */ }

  // ---- Section reader ----
  const sections = book.sections || [];
  if (!sections.length) {
    resultsEl.appendChild(el('div', { class: 'anr-info' }, 'This e-book has no readable sections.'));
    return;
  }
  const view = el('div', { class: 'anr-card' });
  view.appendChild(el('h3', {}, 'Reader'));
  const prev = el('button', { type: 'button', class: 'anr-btn' }, '‹ Prev');
  const next = el('button', { type: 'button', class: 'anr-btn' }, 'Next ›');
  const status = el('span', { class: 'anr-djvu-status' }, '');
  view.appendChild(el('div', { class: 'anr-djvu-bar' }, [prev, status, next]));
  const frame = el('iframe', { class: 'anr-ebook-frame', sandbox: 'allow-same-origin' });
  view.appendChild(frame);
  resultsEl.appendChild(view);

  let cur = -1, busy = false;
  async function show(n) {
    if (busy) return;
    n = Math.max(0, Math.min(sections.length - 1, n));
    busy = true;
    prev.disabled = next.disabled = true;
    status.textContent = 'Loading section ' + (n + 1) + ' of ' + sections.length + '…';
    try {
      const url = await sections[n].load();
      frame.src = url;
      if (cur >= 0 && sections[cur] && sections[cur].unload) { try { sections[cur].unload(); } catch (_) {} }
      cur = n;
      status.textContent = 'Section ' + (n + 1) + ' of ' + sections.length;
    } catch (e) {
      status.textContent = 'Could not load section ' + (n + 1) + '.';
    }
    busy = false;
    prev.disabled = cur <= 0; next.disabled = cur >= sections.length - 1;
  }
  prev.addEventListener('click', () => show(cur - 1));
  next.addEventListener('click', () => show(cur + 1));
  show(0);
}
