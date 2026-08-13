/* Client behaviour for the generated docs pages (/docs, /docs/*). Deliberately
   small - the docs pages don't load the main app.js (no drop pipeline, no stats
   pings), so this handles the interactive bits directly: the dark-mode toggle,
   the sidebar filter, and the shared footer's "Email me!" contact button (which
   we borrow from the real popups.js so the standard footer behaves identically
   to every other page). The before-paint theme bootstrap (THEME_SCRIPT, shared
   with every page) has already applied the saved theme by the time this runs;
   here we only wire the toggle and keep persistence identical to app.js
   (anr-theme + a :ts stamp, 7-day TTL enforced by the bootstrap).
   ES module (imports popups.js). Built into web/ by tools/build-docs-html.mjs. */
import { wireFooterContact } from './popups.js';

(function () {
  'use strict';

  // ----- Standard-footer "Email me!" button (Turnstile-gated mailto), shared
  //       verbatim with the rest of the site so the footer works the same here.
  try { wireFooterContact(); } catch (e) { /* popups.js unavailable - footer link is non-critical */ }

  // ----- Size the linkback gif to match the "valjdakosta.com · 2026" line
  //       above it, same as app.js does for every other page's footer.
  var copyright = document.querySelector<HTMLElement>('.footer-copyright');
  var linkback = document.querySelector<HTMLElement>('.footer-linkback');
  if (copyright && linkback) linkback.style.width = copyright.offsetWidth + 'px';

  // ----- Dark-mode toggle (label shows the CURRENT mode, like the main site) -----
  var SUN = String.fromCodePoint(0x2600, 0xFE0E);   // sun + text-presentation VS
  var MOON = String.fromCodePoint(0x263E, 0xFE0E);  // moon + text-presentation VS
  function themeLabel() {
    return document.documentElement.getAttribute('data-theme') === 'dark'
      ? MOON + ' NIGHT' : SUN + ' DAY';
  }
  var btn = document.getElementById('darkToggle');
  if (btn) {
    btn.textContent = themeLabel();
    btn.addEventListener('click', function () {
      var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      var next = isDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try {
        localStorage.setItem('anr-theme', next);
        localStorage.setItem('anr-theme:ts', Date.now().toString());
      } catch (e) { /* private mode / quota */ }
      btn.textContent = themeLabel();
    });
  }

  // ----- Live component demos: make the buttons respond to clicks/taps the way
  //       the real controls do (visual only - no functionality; the CSS gives
  //       the press-invert). A button row that ships with exactly one active
  //       button among several behaves as a segmented radio (like the site's
  //       Log/Linear axis or Mix/L/R channel picker); a lone active button is
  //       an on/off toggle (like Loop or Wireframe); plain action rows just get
  //       the CSS press feedback. Docs pages are full-load (no SPA swap), so
  //       wiring once here is enough. -----
  var demoRows = document.querySelectorAll('.docs-demo .anr-btn-row');
  for (var r = 0; r < demoRows.length; r++) {
    (function (row) {
      var btns = row.querySelectorAll('.anr-btn');
      var actives = row.querySelectorAll('.anr-btn.is-active');
      var radio = btns.length >= 2 && actives.length === 1;
      var toggle = btns.length === 1 && actives.length === 1;
      if (!radio && !toggle) return;   // action-only row - CSS :active is enough
      row.addEventListener('click', function (e) {
        var btn = e.target && (e.target as HTMLElement).closest ? (e.target as HTMLElement).closest<HTMLButtonElement>('.anr-btn') : null;
        if (!btn || btn.disabled || !row.contains(btn)) return;
        if (radio) {
          for (var i = 0; i < btns.length; i++) btns[i].classList.remove('is-active');
          btn.classList.add('is-active');
        } else {
          btn.classList.toggle('is-active');
        }
      });
    })(demoRows[r]);
  }

  // ----- Sidebar filter: hide pages (and empty groups) that don't match -----
  var filter = (document.getElementById('docsFilter') as HTMLInputElement);
  if (filter) {
    filter.addEventListener('input', function () {
      var q = filter.value.trim().toLowerCase();
      var groups = document.querySelectorAll('.docs-nav-group');
      for (var i = 0; i < groups.length; i++) {
        var g = groups[i], links = g.querySelectorAll('a'), any = false;
        for (var j = 0; j < links.length; j++) {
          var hit = !q || links[j].textContent.toLowerCase().indexOf(q) !== -1;
          links[j].classList.toggle('is-filtered-out', !hit);
          if (hit) any = true;
        }
        g.classList.toggle('is-filtered-out', !!q && !any);
      }
    });
    // '/' focuses the filter (unless already typing in a field)
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && document.activeElement !== filter &&
          !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
        e.preventDefault();
        filter.focus();
      }
    });
  }
})();
