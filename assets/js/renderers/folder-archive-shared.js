/* Analyser - shared folder/archive helpers
   Category classification, breakdown cards, and view toggle (treemap / tree)
   used by both folder.js and archive.js. */

import { el, row, rowHelp, fmtBytes, buildFileTree } from '../core/util.js';
import { PHOTO_EXTS, AUDIO_EXTS, VIDEO_EXTS, DOC_EXTS, ARCHIVE_EXTS } from '../core/formats.js';
import { renderTreemap, attachTreemapEvents } from './treemap.js';

// ---------- category classification ----------

export const CATEGORIES = ['photo', 'audio', 'video', 'document', 'archive', 'other'];

export const CATEGORY_COLORS = {
  photo:    { light: '#3b82f6', dark: '#60a5fa' },
  audio:    { light: '#f59e0b', dark: '#fbbf24' },
  video:    { light: '#8b5cf6', dark: '#a78bfa' },
  document: { light: '#10b981', dark: '#34d399' },
  archive:  { light: '#ef4444', dark: '#f87171' },
  other:    { light: '#6b7280', dark: '#9ca3af' },
};

export const CATEGORY_LABELS = {
  photo: 'Photo', audio: 'Audio', video: 'Video',
  document: 'Document', archive: 'Archive', other: 'Other',
};

export function categorizeExt(ext) {
  if (!ext) return 'other';
  ext = ext.toLowerCase();
  if (PHOTO_EXTS.has(ext) || ext === 'psd' || ext === 'svg') return 'photo';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (ARCHIVE_EXTS.has(ext)) return 'archive';
  if (DOC_EXTS.has(ext)) return 'document';
  return 'other';
}

function isDark() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

export function categoryColor(cat) {
  const c = CATEGORY_COLORS[cat] || CATEGORY_COLORS.other;
  return isDark() ? c.dark : c.light;
}

// ---------- normalize items ----------

function extOf(name) {
  const m = name.match(/\.([^./\\]+)$/);
  return m ? m[1].toLowerCase() : '';
}

export function normalizeFolder(files) {
  return files.map(f => {
    const ext = extOf(f.path);
    return { path: f.path, size: f.size, file: f.file || null, entry: null, category: categorizeExt(ext), ext };
  });
}

export function normalizeArchive(entries) {
  return entries.filter(e => !e.isDir).map(e => {
    const ext = extOf(e.name);
    return { path: e.name, size: e.uncompSize, file: null, entry: e, category: categorizeExt(ext), ext };
  });
}

// ---------- breakdown ----------

export function buildCategoryBreakdown(items) {
  const byCategory = {};
  const byExt = {};
  for (const cat of CATEGORIES) byCategory[cat] = { count: 0, size: 0 };
  for (const item of items) {
    byCategory[item.category].count += 1;
    byCategory[item.category].size += item.size;
    const ext = item.ext || '(no ext)';
    if (!byExt[ext]) byExt[ext] = { count: 0, size: 0 };
    byExt[ext].count += 1;
    byExt[ext].size += item.size;
  }
  const sorted = Object.entries(byExt).sort((a, b) => b[1].count - a[1].count);
  return { byCategory, byExt, sorted };
}

const VISIBLE_EXT_COUNT = 5;

function fmtExtRow(ext, data) {
  const dot = ext === '(no ext)' ? ext : '.' + ext;
  return row(dot, data.count + (data.count === 1 ? ' file' : ' files') + '  (' + fmtBytes(data.size) + ')');
}

export function renderBreakdownCards(items, resultsEl, extraSummaryRows) {
  const breakdown = buildCategoryBreakdown(items);
  const totalSize = items.reduce((s, i) => s + i.size, 0);

  // Summary card
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Overview'));
  const tbl = el('table', { class: 'anr-readout' });
  if (extraSummaryRows) {
    for (const r of extraSummaryRows) tbl.appendChild(r);
  }
  tbl.appendChild(row('Files', items.length.toLocaleString()));
  tbl.appendChild(row('Total size', fmtBytes(totalSize) + '  (' + totalSize.toLocaleString() + ' bytes)'));

  const catParts = [];
  for (const cat of CATEGORIES) {
    const d = breakdown.byCategory[cat];
    if (d.count) catParts.push(d.count + ' ' + CATEGORY_LABELS[cat].toLowerCase());
  }
  tbl.appendChild(rowHelp('Categories', catParts.join(', ') || '-',
    'A breakdown of the contents grouped by media kind: photos, audio, video, documents, archives, and other.'));
  tbl.appendChild(rowHelp('Unique extensions', String(breakdown.sorted.length),
    'How many distinct file extensions appear across all the files in this set.'));
  card.appendChild(tbl);
  resultsEl.appendChild(card);

  // Anchor slot sitting between Overview and File types. The Contents cards
  // (treemap + file tree) are inserted here by renderViewToggle, so the heavy
  // visualisation lands between the two summary cards rather than after them.
  resultsEl.appendChild(el('div', { class: 'anr-contents-slot', hidden: '' }));

  // File types card - first 5 visible, rest behind "show more"
  if (breakdown.sorted.length) {
    const extCard = el('div', { class: 'anr-card' });
    extCard.appendChild(el('h3', {}, 'File types'));

    const visible = breakdown.sorted.slice(0, VISIBLE_EXT_COUNT);
    const hidden = breakdown.sorted.slice(VISIBLE_EXT_COUNT);

    const extTbl = el('table', { class: 'anr-readout' });
    for (const [ext, data] of visible) extTbl.appendChild(fmtExtRow(ext, data));
    extCard.appendChild(extTbl);

    if (hidden.length) {
      const details = el('details', { class: 'anr-ext-more' });
      details.appendChild(el('summary', {}, hidden.length + ' more'));
      const hiddenTbl = el('table', { class: 'anr-readout' });
      for (const [ext, data] of hidden) hiddenTbl.appendChild(fmtExtRow(ext, data));
      details.appendChild(hiddenTbl);
      extCard.appendChild(details);
    }

    resultsEl.appendChild(extCard);
  }

  return breakdown;
}

// ---------- view toggle (treemap / tree) ----------

export function renderViewToggle(container, items, treeObj, treeOpts, onFileClick) {
  // The Contents cards land at the anchor slot (between Overview and File types)
  // when renderBreakdownCards left one; otherwise they append to the end.
  const slot = container.querySelector('.anr-contents-slot');
  const place = (node) => { if (slot && slot.parentNode === container) container.insertBefore(node, slot); else container.appendChild(node); };

  // File-tree card - built here but placed AFTER (under) the treemap below.
  const treeCard = el('div', { class: 'anr-card' });
  treeCard.appendChild(el('h3', {}, 'File tree'));
  const treeFullOpts = {
    ...treeOpts,
    fileAccent: (key) => categoryColor(categorizeExt(extOf(key))),
  };
  treeCard.appendChild(buildFileTree(treeObj, treeFullOpts));

  // Treemap section, placed first so it sits above the file tree.
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Treemap'));

  const bk = buildCategoryBreakdown(items);

  // Controls row: a "Filter by type" button (opens the extension filter in a
  // popup, rather than a long always-there chip row) on the left, category legend
  // on the right.
  const controls = el('div', { class: 'anr-view-controls' });
  let activeExt = null;
  const fmtExtLabel = (ext) => ext === '(no ext)' ? ext : '.' + ext;
  const filterBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm anr-treemap-filterbtn' }, 'Filter by type');
  function updateFilterBtn() {
    filterBtn.textContent = activeExt ? ('Filter: ' + fmtExtLabel(activeExt)) : 'Filter by type';
    filterBtn.classList.toggle('is-active', !!activeExt);
  }
  filterBtn.addEventListener('click', openExtFilterModal);
  controls.appendChild(filterBtn);

  const legend = el('div', { class: 'anr-treemap-legend' });
  for (const cat of CATEGORIES) {
    const d = bk.byCategory[cat];
    if (!d.count) continue;
    const swatch = el('span', { class: 'anr-legend-swatch', style: 'background:' + categoryColor(cat) });
    legend.appendChild(el('span', { class: 'anr-legend-item' }, [swatch, ' ' + CATEGORY_LABELS[cat]]));
  }
  controls.appendChild(legend);
  card.appendChild(controls);

  // The extension filter as a popup: a chip for every extension (most common
  // first) plus an "All" chip. Picking one redraws the treemap with just that
  // extension's files and closes the popup; "All" (or re-picking the active one)
  // clears the filter. `bk.sorted` is [ext, {count, size}] ordered by count, with
  // '(no ext)' for extensionless files.
  function openExtFilterModal() {
    const chipRow = el('div', { class: 'anr-extfilter-chips' });
    const mkChip = (key, content, title) => {
      const chip = el('button', { type: 'button', class: 'anr-extchip' + (key === activeExt ? ' is-active' : ''), title: title || '' }, content);
      chip.addEventListener('click', () => { setFilter(key === activeExt ? null : key); close(); });
      return chip;
    };
    chipRow.appendChild(mkChip(null, 'All'));
    for (const [ext, data] of bk.sorted) {
      chipRow.appendChild(mkChip(ext,
        [fmtExtLabel(ext), el('span', { class: 'anr-extchip-n' }, String(data.count))],
        data.count + (data.count === 1 ? ' file' : ' files') + ' · ' + fmtBytes(data.size)));
    }
    const closeBtn = el('button', { type: 'button', class: 'anr-modal-btn anr-modal-cancel' }, 'Close');
    const cardEl = el('div', { class: 'anr-modal-card' }, [
      el('p', { class: 'anr-modal-kicker' }, 'Treemap'),
      el('p', { class: 'anr-modal-title' }, 'Filter by file type'),
      el('div', { class: 'anr-modal-scroll' }, [chipRow]),
      el('div', { class: 'anr-modal-actions' }, [closeBtn]),
    ]);
    const overlay = el('div', { class: 'anr-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Filter by file type' }, cardEl);
    document.body.appendChild(overlay);
    let settled = false;
    function close() {
      if (settled) return;
      settled = true;
      overlay.classList.remove('is-open');
      setTimeout(() => overlay.remove(), 200);
      document.removeEventListener('keydown', onKey);
    }
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => overlay.classList.add('is-open'));
  }

  const contentArea = el('div', { class: 'anr-treemap-content' });
  card.appendChild(contentArea);

  // (Re)build the treemap on a fresh canvas/wrap for the active filter. A new
  // canvas lets renderTreemap rebuild its cached hierarchy from the filtered set,
  // and clearing contentArea drops the previous canvas with its listeners,
  // tooltip and breadcrumb. The old ResizeObserver is disconnected first.
  let currentRO = null;
  function mount() {
    if (currentRO) { currentRO.disconnect(); currentRO = null; }
    contentArea.innerHTML = '';
    const shown = activeExt
      ? items.filter((i) => (i.ext || '(no ext)') === activeExt)
      : items;

    const wrap = el('div', { class: 'anr-treemap-wrap' });
    const canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
    contentArea.appendChild(wrap);

    function draw() {
      const rect = wrap.getBoundingClientRect();
      const w = Math.floor(rect.width);
      const h = Math.max(380, Math.min(560, Math.round(w * 0.6)));
      const dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      renderTreemap(canvas, shown, { categoryColor, onFileClick });
    }

    draw();
    attachTreemapEvents(canvas, wrap, shown, { categoryColor, onFileClick });
    const ro = new ResizeObserver(() => {
      clearTimeout(canvas._roTimer);
      canvas._roTimer = setTimeout(draw, 150);
    });
    ro.observe(wrap);
    currentRO = ro;
  }

  function setFilter(ext) {
    activeExt = ext;
    updateFilterBtn();
    mount();
  }

  mount();
  place(card);       // treemap first
  place(treeCard);   // file tree under it
}
