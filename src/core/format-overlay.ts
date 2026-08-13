/* Analyser - supported-formats catalog + 'help' overlay.
   Renders the format catalog into the overlay / about-page list / hub, stamps the
   live format count into [data-fmt-count] elements, and wires: deep-link reveal of
   collapsed catalog entries, the [data-fmt-open] help popup (category chips, live
   filter with highlight, expand/collapse, Esc/Back/close), the 'I'm feeling lucky'
   random /formats jump, and the inline search on the /formats hub page.
   setupFormatOverlay() runs once per navigation from boot(); the window-level
   listeners guard on module-local flags so they bind only once. */

import { el, openOverlayBack } from './util.js';
import { renderFmtOverlay, renderAboutFormats, formatCount, catalogGrouped, CATEGORIES } from './formats.js';
import { setupFmtHeaderFx } from './effects.js';

function $(id) { return document.getElementById(id); }

// Coalesce rapid input events. The catalog filter re-checks ~1,359 entries and
// re-parses their innerHTML for highlighting on every keystroke; without this a
// fast typist queues a full sweep per character and the overlay janks.
function debounce(fn, ms) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

// Persist across SPA navigations (the module loads once) so the window listeners
// below are added a single time, matching the old boot._hashWired / _fmtKeyWired guards.
let hashWired = false;
let fmtKeyWired = false;

export function setupFormatOverlay() {
  // ----- Supported-formats catalog (generated from formats.js) -----
  // index.html has #fmtBody (the overlay); about.html has #aboutFormats and its
  // own copy of #fmtBody (the same overlay markup).
  renderFmtOverlay($('fmtBody'));
  renderAboutFormats($('aboutFormats'));
  // Per-letter cursor-hover effect on the group headers in the popup, the about
  // list and the /formats hub (same feel as the site header / footer mark).
  setupFmtHeaderFx(document);

  // Drop the live format count into every element that asks for it (popup
  // header, feature bullets, and the clickable "N supported formats"
  // affordances). data-fmt-count="bare" gets just the number; otherwise the
  // element keeps its template text with {n} substituted, or falls back to
  // "N supported formats".
  const fmtN = formatCount();
  document.querySelectorAll('[data-fmt-count]').forEach(elm => {
    const mode = elm.getAttribute('data-fmt-count');
    if (mode === 'bare') elm.textContent = String(fmtN);
    else if (elm.dataset.fmtCountTpl) elm.textContent = elm.dataset.fmtCountTpl.replace('{n}', fmtN);
    else elm.textContent = fmtN + ' supported formats';
  });

  // Deep-links into the (collapsed) supported-formats list: landing on
  // /about#ext-sldprt or #fmt-cad from a search result should expand the
  // dropdown and scroll to the target.
  function revealHashTarget() {
    const id = decodeURIComponent((location.hash || '').slice(1));
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    const details = target.closest('details');
    // Only reveal+scroll when the deep-link target is inside a collapsed <details>
    // (the supported-formats list), which a native hash jump can't reach. Plain
    // section anchors are left to the browser's native jump - no extra autoscroll.
    if (details) {
      details.open = true;
      requestAnimationFrame(() => target.scrollIntoView({ block: 'center' }));
    }
  }
  revealHashTarget();
  if (!hashWired) {
    hashWired = true;
    window.addEventListener('hashchange', revealHashTarget);
  }

  // ----- Format help overlay -----
  // Any element with the [data-fmt-open] attribute (the dropzone Info button,
  // the feature bullets, the "N supported formats" affordance, the about-page
  // summary) opens the popup. The overlay markup lives on both index.html and
  // about.html, so this runs per-navigation.
  const fmtOverlay = $('fmtOverlay');
  const fmtClose = $('fmtOverlayClose');
  const fmtSearch = $('fmtSearch');
  if (fmtOverlay) {
    const items = fmtOverlay.querySelectorAll('.fmt-item');
    const labels = fmtOverlay.querySelectorAll('.fmt-section-label');
    const fmtChips = $('fmtChips');
    const fmtResultCount = $('fmtResultCount');
    const fmtToggleAll = $('fmtToggleAll');
    const fmtBody = $('fmtBody');
    let activeCat = 'all';

    // Empty-state node lives inside the scroll body but is created here (rather
    // than in the HTML) so renderFmtOverlay's innerHTML reset doesn't wipe it.
    let fmtEmpty = $('fmtEmpty');
    if (fmtBody && !fmtEmpty) {
      fmtEmpty = el('p', { class: 'fmt-empty', id: 'fmtEmpty', hidden: 'hidden' });
      fmtBody.appendChild(fmtEmpty);
    }

    const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    // Wrap every case-insensitive occurrence of `q` in <mark>; restore the plain
    // text when `q` is empty. The original text is cached on the element so the
    // highlight is non-destructive and idempotent across keystrokes.
    function highlightEl(elm, q) {
      if (elm._orig == null) elm._orig = elm.textContent;
      const text = elm._orig;
      if (!q) { if (elm.innerHTML !== text) elm.textContent = text; return; }
      const lower = text.toLowerCase();
      let i = lower.indexOf(q), last = 0, html = '';
      if (i === -1) { elm.textContent = text; return; }
      while (i !== -1) {
        html += escapeHtml(text.slice(last, i)) +
          '<mark class="fmt-mark">' + escapeHtml(text.slice(i, i + q.length)) + '</mark>';
        last = i + q.length;
        i = lower.indexOf(q, last);
      }
      html += escapeHtml(text.slice(last));
      elm.innerHTML = html;
    }

    function buildChips() {
      if (!fmtChips) return;
      const chipDefs = [{ key: 'all', label: 'All' }, ...CATEGORIES];
      fmtChips.innerHTML = '';
      for (const c of chipDefs) {
        const on = c.key === activeCat;
        const btn = el('button', {
          type: 'button', class: 'fmt-chip' + (on ? ' is-active' : ''),
          'data-cat': c.key, role: 'tab', 'aria-selected': on ? 'true' : 'false',
        }, c.label);
        btn.addEventListener('click', () => {
          activeCat = c.key;
          fmtChips.querySelectorAll('.fmt-chip').forEach((b) => {
            const sel = b.dataset.cat === activeCat;
            b.classList.toggle('is-active', sel);
            b.setAttribute('aria-selected', sel ? 'true' : 'false');
          });
          applyFilter();
        });
        fmtChips.appendChild(btn);
      }
    }

    const visibleItems = () => [...items].filter((it) => !it.classList.contains('is-hidden'));
    function syncToggleAll() {
      if (!fmtToggleAll) return;
      const vis = visibleItems();
      fmtToggleAll.disabled = vis.length === 0;
      fmtToggleAll.textContent = vis.some((it) => !it.open) ? 'Expand all' : 'Collapse all';
    }

    function applyFilter() {
      const raw = fmtSearch ? fmtSearch.value.trim() : '';
      const q = raw.toLowerCase();
      let visCount = 0;
      const extSet = new Set();
      items.forEach((it) => {
        const labelEl = it.querySelector('.fmt-item-label');
        const extsEl = it.querySelector('.fmt-item-exts');
        const descEl = it.querySelector('.fmt-item-desc');
        const catOk = activeCat === 'all' || it.dataset.cat === activeCat;
        const text = (
          labelEl.textContent + ' ' + extsEl.textContent + ' ' +
          (it.dataset.tags || '') + ' ' + descEl.textContent
        ).toLowerCase();
        const match = catOk && (!q || text.includes(q));
        it.classList.toggle('is-hidden', !match);
        // Auto-open matches so the matched text shows; collapse when cleared.
        it.open = q ? match : false;
        const hq = (q && match) ? q : '';
        highlightEl(labelEl, hq);
        it.querySelectorAll('.fmt-item-ext').forEach((s) => highlightEl(s, hq));
        highlightEl(descEl, hq);
        if (match) {
          visCount++;
          extsEl.textContent.split(/\s+/).forEach((t) => { if (t) extSet.add(t.toLowerCase()); });
        }
      });
      let firstVisibleLabel = null;
      labels.forEach((label) => {
        const list = label.nextElementSibling;
        const visible = list ? list.querySelectorAll('.fmt-item:not(.is-hidden)').length : 0;
        label.style.display = visible ? '' : 'none';
        label.classList.remove('is-first-visible');
        if (visible && !firstVisibleLabel) firstVisibleLabel = label;
      });
      if (firstVisibleLabel) firstVisibleLabel.classList.add('is-first-visible');
      if (fmtResultCount) {
        fmtResultCount.textContent =
          visCount + (visCount === 1 ? ' format' : ' formats') + ' · ' + extSet.size + ' extensions';
      }
      if (fmtEmpty) {
        fmtEmpty.hidden = visCount !== 0;
        if (visCount === 0) fmtEmpty.textContent = raw ? `No formats match “${raw}”.` : 'No formats in this category.';
      }
      syncToggleAll();
    }

    function hideFmt() { fmtOverlay.hidden = true; document.body.style.overflow = ''; fmtOverlay._backClose = null; }
    function openFmt() {
      const wasHidden = fmtOverlay.hidden;
      fmtOverlay.hidden = false;
      document.body.style.overflow = 'hidden';
      if (wasHidden) fmtOverlay._backClose = openOverlayBack(hideFmt);   // device Back closes it
      activeCat = 'all';
      buildChips();
      if (fmtSearch) {
        fmtSearch.value = '';
        if (matchMedia('(pointer:fine)').matches) fmtSearch.focus();
      }
      applyFilter();
    }
    function closeFmt() { if (fmtOverlay._backClose) fmtOverlay._backClose(); else hideFmt(); }

    buildChips();

    document.querySelectorAll('[data-fmt-open]').forEach((trigger) => {
      if (trigger._fmtWired) return;
      trigger._fmtWired = true;
      trigger.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openFmt();
      });
    });

    if (fmtClose && !fmtClose._wired) { fmtClose._wired = true; fmtClose.addEventListener('click', closeFmt); }
    if (fmtToggleAll && !fmtToggleAll._wired) {
      fmtToggleAll._wired = true;
      fmtToggleAll.addEventListener('click', () => {
        const vis = visibleItems();
        const expand = vis.some((it) => !it.open);
        vis.forEach((it) => { it.open = expand; });
        syncToggleAll();
      });
    }
    if (!fmtOverlay._wired) {
      fmtOverlay._wired = true;
      fmtOverlay.addEventListener('click', (e) => { if (e.target === fmtOverlay) closeFmt(); });
    }
    // Each extension token is a link to its /formats page. The overlay lives
    // outside the SPA-swapped regions, so letting navigate.js do an in-place hop
    // would leave the (now orphaned) overlay open with the body scroll locked.
    // Intercept here: stop the click reaching navigate.js, suppress the parent
    // <details> toggle, and do a full navigation that tears the overlay down.
    if (!fmtOverlay._extNavWired) {
      fmtOverlay._extNavWired = true;
      fmtOverlay.addEventListener('click', (e) => {
        const a = e.target.closest('a.fmt-item-ext');
        if (!a || !fmtOverlay.contains(a)) return;
        e.preventDefault();
        e.stopPropagation();
        location.assign(a.getAttribute('href'));
      });
    }
    if (!fmtKeyWired) {
      // Persists across navigations, so close self-contained off a fresh lookup
      // rather than this boot's (possibly stale) closeFmt/fmtOverlay.
      fmtKeyWired = true;
      window.addEventListener('keydown', (e) => {
        const ov = $('fmtOverlay');
        if (e.key === 'Escape' && ov && !ov.hidden) {
          if (ov._backClose) ov._backClose();
          else { ov.hidden = true; document.body.style.overflow = ''; }
        }
      });
    }
    if (fmtSearch && !fmtSearch._wired) { fmtSearch._wired = true; fmtSearch.addEventListener('input', debounce(applyFilter, 120)); }

    // Sitelinks searchbox / deep-link: /?q=foo (the WebSite schema's SearchAction
    // target) and /formats?q=foo open the formats overlay pre-filtered, so a query
    // from search results lands directly on matching formats.
    if (fmtSearch) {
      const q = new URLSearchParams(location.search).get('q');
      if (q) {
        openFmt();
        fmtSearch.value = q;
        applyFilter();
      }
    }
  }

  // ----- "I'm feeling lucky" -> a random per-format landing page -----
  // Any [data-fmt-random] button jumps to a random /formats/<ext> page. The
  // ext list comes from the same catalog that drives the overlay, and the
  // full-wins routing mirrors tools/prerender-format-pages.mjs (a full row gets
  // /formats/<ext>, an id-only one /formats/id/<ext>), so it never points at a
  // page that does not exist. A throwaway <a> click lets navigate.js do the SPA
  // View Transition (and falls back to a plain navigation if it is absent).
  document.querySelectorAll('[data-fmt-random]').forEach((trigger) => {
    if (trigger._fmtRandWired) return;
    trigger._fmtRandWired = true;
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      const full = new Set();
      const all = new Set();
      for (const g of catalogGrouped()) {
        for (const r of g.rows) {
          for (const tok of r.exts) {
            const k = tok.toLowerCase();
            all.add(k);
            if (r.depth === 'full') full.add(k);
          }
        }
      }
      const keys = [...all];
      if (!keys.length) return;
      const k = keys[Math.floor(Math.random() * keys.length)];
      const path = full.has(k) ? `/formats/${k}` : `/formats/id/${k}`;
      const a = document.createElement('a');
      a.href = path;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  });

  // ----- Inline search on the /formats hub page -----
  // Filters the on-page catalog list (the same .fmt-item markup the overlay uses)
  // live, so visitors can narrow the whole catalog without opening the popup. An
  // AND match across the label, extension list, search tags and description.
  const fmtPageSearch = $('fmtPageSearch');
  if (fmtPageSearch && !fmtPageSearch._wired) {
    fmtPageSearch._wired = true;
    const pItems = Array.from(document.querySelectorAll('.formats-page .fmt-item'));
    const pLabels = Array.from(document.querySelectorAll('.formats-page .fmt-section-label'));
    const pStatus = $('fmtPageSearchStatus');
    const applyPageFilter = () => {
      const raw = fmtPageSearch.value.trim();
      const tokens = raw.toLowerCase().split(/\s+/).filter(Boolean);
      let vis = 0;
      pItems.forEach((it) => {
        const labelEl = it.querySelector('.fmt-item-label');
        const extsEl = it.querySelector('.fmt-item-exts');
        const descEl = it.querySelector('.fmt-item-desc');
        const hay = (
          (labelEl ? labelEl.textContent : '') + ' ' +
          (extsEl ? extsEl.textContent : '') + ' ' +
          (it.dataset.tags || '') + ' ' +
          (descEl ? descEl.textContent : '')
        ).toLowerCase();
        const match = !tokens.length || tokens.every((t) => hay.includes(t));
        it.classList.toggle('is-hidden', !match);
        it.open = tokens.length ? match : false;   // open matches so the desc shows
        if (match) vis++;
      });
      pLabels.forEach((label) => {
        const list = label.nextElementSibling;
        const n = list ? list.querySelectorAll('.fmt-item:not(.is-hidden)').length : 0;
        label.style.display = n ? '' : 'none';
      });
      if (pStatus) {
        pStatus.hidden = !raw;
        if (raw) pStatus.textContent = vis
          ? vis + (vis === 1 ? ' format matches' : ' formats match')
          : 'No formats match “' + raw + '”.';
      }
    };
    fmtPageSearch.addEventListener('input', debounce(applyPageFilter, 120));
  }
}
