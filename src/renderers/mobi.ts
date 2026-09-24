/* Analyser - Kindle / Mobipocket e-book reader (MOBI / AZW / AZW3)
   ============================================================================
   Uses the vendored foliate-js `mobi.js` (pure JavaScript, self-contained ES
   module) to decode MOBI 6 and KF8 (AZW3, and combo .mobi) e-books fully in the
   browser. Shows the metadata and cover, then a section-by-section reader: each
   section is decoded to a self-contained HTML blob and shown in a sandboxed
   iframe (no scripts), with images resolved. KF8's HUFF/CDIC decompression can
   be slow, so the pager is disabled while a section loads. */

import { el, row, h3help, fmtBytes, errorCard, blobImg } from '../core/util.js';

const FFLATE_URL = new URL('../../vendor/fflate.js', import.meta.url).href;
const MOBI_URL = new URL('../../vendor/foliate/mobi.js', import.meta.url).href;

// foliate metadata values can be a string, an array, or a localised object.
function metaStr(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(metaStr).filter(Boolean).join(', ');
  if (typeof v === 'object') return v.name ? metaStr(v.name) : metaStr(Object.values(v)[0]);
  return String(v);
}

// What a section may load: only what foliate already resolved into it (blob:
// images, stylesheets and fonts) and inline data: URIs. Nothing from the network.
const SECTION_CSP = "default-src 'none'; img-src blob: data:; style-src blob: data: 'unsafe-inline'; font-src blob: data:; media-src blob: data:";

// foliate hands back each section as a blob: URL of the book's own (X)HTML. The
// iframe sandbox stops script, but not a remote <img>, a remote stylesheet, or a
// <meta http-equiv="refresh"> that navigates the frame to any URL. Rewrite the
// section before showing it: drop refresh/base/script and any <link> that is not
// already local, and put a CSP <meta> first in <head> so every fetch the page -
// or its stylesheets - attempts is refused. Returns a new blob: URL (the caller
// revokes it); the sanitiser in core/sanitize.js is not used because it strips
// the blob: image sources foliate resolved, which would leave the book blank.
async function lockDown(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  const text = await blob.text();
  const type = blob.type || 'text/html';
  let xml = /xml/i.test(type);
  let doc = new DOMParser().parseFromString(text, xml ? 'application/xhtml+xml' : 'text/html');
  if (xml && doc.querySelector('parsererror')) { xml = false; doc = new DOMParser().parseFromString(text, 'text/html'); }
  const root = doc.documentElement;
  for (const n of Array.from(doc.getElementsByTagName('*'))) {
    const ln = n.localName.toLowerCase();
    if (ln === 'script' || ln === 'base' || (ln === 'meta' && n.hasAttribute('http-equiv'))) n.remove();
    else if (ln === 'link' && !/^\s*(?:blob|data):/i.test(n.getAttribute('href') || '')) n.remove();
  }
  const ns = root.namespaceURI;
  let head = doc.head;
  if (!head) {
    head = doc.createElementNS(ns, 'head') as HTMLHeadElement;
    root.insertBefore(head, root.firstChild);
  }
  const meta = doc.createElementNS(ns, 'meta');
  meta.setAttribute('http-equiv', 'Content-Security-Policy');
  meta.setAttribute('content', SECTION_CSP);
  head.insertBefore(meta, head.firstChild);
  const out = xml ? new XMLSerializer().serializeToString(doc) : '<!DOCTYPE html>\n' + root.outerHTML;
  return URL.createObjectURL(new Blob([out], { type: xml ? type : 'text/html' }));
}

export async function renderMobi(file: File, resultsEl: HTMLElement) {
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
  const [h, help] = h3help('E-book', 'A Kindle / Mobipocket e-book. Its text, details and cover image are read here in your browser.');
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
  card.appendChild(tbl);
  resultsEl.appendChild(card);

  const _renderAnchor = resultsEl.firstChild;

  // ---- Cover ----
  try {
    const cover = book.getCover && await book.getCover();
    if (cover) {
      const pcard = el('div', { class: 'anr-card' });
      pcard.appendChild(el('h3', {}, 'Cover'));
      pcard.appendChild(blobImg(cover, { alt: 'Cover', class: 'anr-iwork-preview' }));
      resultsEl.insertBefore(pcard, _renderAnchor);
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
  resultsEl.insertBefore(view, _renderAnchor);

  let cur = -1, busy = false, shownUrl = '';
  async function show(n: number) {
    if (busy) return;
    n = Math.max(0, Math.min(sections.length - 1, n));
    busy = true;
    prev.disabled = next.disabled = true;
    status.textContent = 'Loading section ' + (n + 1) + ' of ' + sections.length + '…';
    try {
      const url = await lockDown(await sections[n].load());
      frame.src = url;
      if (shownUrl) URL.revokeObjectURL(shownUrl);
      shownUrl = url;
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
