/* Analyser - SPA router
   View Transitions API navigation: swaps page content in place and fires the
   anr:navigate event so boot() re-runs, with no full reload. */

(function () {
  if (!document.startViewTransition) {
    // No View Transitions API (older WebKit): the SPA swap below is unavailable,
    // so links fall back to full navigations (the browser's default <a> behaviour).
    return;
  }

  // The path we're currently showing. Hash-only history changes (the sticky
  // #photo / #audio / #video nav strip, and back/forward across those) keep this
  // value, so popstate can tell a same-page scroll from a real page change.
  var currentPath = location.pathname;

  function isHomePath(path) { return path === '/' || path === '/index.html'; }

  function swap(doc, arrivingHome) {
    document.title = doc.title;

    // Swap the whole site-mark (kicker + title + byline + sub) so per-page
    // headers ("About", "Patch Notes", "Analyser") follow the navigation. The
    // fresh title has no letter-spans yet; app.js's setupHeaderFx() re-binds the
    // hover/sweep effect when it handles the anr:navigate event below.
    var oldMark = document.querySelector('.site-mark');
    var newMark = doc.querySelector('.site-mark');
    if (oldMark && newMark) oldMark.replaceWith(newMark);

    var oldNav = document.querySelector('.site-nav');
    var newNav = doc.querySelector('.site-nav');
    if (oldNav && newNav) {
      oldNav.replaceWith(newNav);
    } else if (oldNav && !newNav) {
      oldNav.remove();
    } else if (!oldNav && newNav) {
      var header = document.querySelector('.site-header');
      if (header) header.after(newNav);
    }

    var oldMain = document.querySelector('.site-main');
    var newMain = doc.querySelector('.site-main');
    if (oldMain && newMain) {
      // Stop media before detaching: a detached <audio>/<video> keeps playing,
      // and Web Audio players (AI blend, sonify) sound through no element at all,
      // so navigating away from an analysis would otherwise leave audio running
      // with no visible player. Mirror clearResultsUI()'s teardown. This still
      // applies even when the main below gets preserved rather than discarded -
      // a preserved analysis must go silent while off-page too (pausing keeps
      // currentTime, so position survives).
      try { oldMain.querySelectorAll('audio, video').forEach(function (m) { try { m.pause(); } catch (_) {} }); } catch (_) {}
      if (window._anrMediaStoppers) {
        for (var stop of window._anrMediaStoppers) { try { stop(); } catch (_) {} }
        window._anrMediaStoppers.clear();
      }
      // Leaving home with an analysis on screen (anr-has-file body class, set by
      // app.js's handleFile/enterLoadedUI): stash the live main instead of letting
      // it go to garbage collection, so a later return to home can reinsert it
      // verbatim - DOM, event listeners, media currentTime, resolved async cells -
      // with no re-analysis. JS memory (this window.* global) survives the SPA
      // swap even though the node itself is about to be detached below.
      if (isHomePath(currentPath) && document.body.classList.contains('anr-has-file')) {
        window._anrHomeMain = oldMain;
      }
      // Arriving home with a previously-stashed main: reuse it instead of the
      // freshly-parsed (empty) home main, so the preserved analysis reappears
      // exactly as left. app.js's boot() sees window._anrHomeRestored and skips
      // re-wiring the (already-wired) preserved nodes.
      if (arrivingHome && window._anrHomeMain) {
        oldMain.replaceWith(window._anrHomeMain);
        window._anrHomeMain = null;   // consumed; a fresh analysis re-arms it
        window._anrHomeRestored = true;
      } else {
        oldMain.replaceWith(newMain);
      }
    }

    var oldFooter = document.querySelector('.site-footer');
    var newFooter = doc.querySelector('.site-footer');
    if (oldFooter && newFooter) {
      oldFooter.replaceWith(newFooter);
    } else if (oldFooter && !newFooter) {
      oldFooter.remove();
    } else if (!oldFooter && newFooter) {
      var main = document.querySelector('.site-main');
      if (main) main.after(newFooter);
    }
  }

  function navigateTo(url, push) {
    var arrivingHome = isHomePath(new URL(url, location.href).pathname);
    fetch(url)
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        document.startViewTransition(function () {
          swap(doc, arrivingHome);
          currentPath = new URL(url).pathname;
          if (push) history.pushState({ anrNav: 1 }, '', url);
          // The swapped-in page inherits the old scroll offset, so reset it:
          // land on the linked #anchor if the URL has one, otherwise the top of
          // the new page (not wherever the link sat on the previous page).
          var hash = new URL(url).hash;
          var target = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
          if (target) target.scrollIntoView();
          else window.scrollTo(0, 0);
          window.dispatchEvent(new Event('anr:navigate'));
        });
      })
      .catch(function () {
        if (push) location.href = url;
        else location.reload();
      });
  }

  document.addEventListener('click', function (e) {
    // Another handler already claimed this click (e.g. the per-format pages' CTA
    // <a href="/"> that calls preventDefault to open the OS file picker instead of
    // navigating). Honour that - hijacking it here would swap the page out from
    // under the picker and break the pending-file hand-off home.
    if (e.defaultPrevented) return;
    var link = e.target.closest('a[href]');
    if (!link) return;
    var href = link.getAttribute('href');
    if (!href) return;
    if (link.target === '_blank' || link.hasAttribute('download')) return;
    if (href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto:')) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;

    // Canonical URLs are clean (no .html): /about, /patch, / . Normalise any
    // stray .html link to that form so the address bar and history stay clean
    // and a reload hits the same URL the server serves.
    var u = new URL(href, location.href);
    u.pathname = u.pathname.replace(/\/index\.html(?=$)/, '/').replace(/\.html(?=$)/, '');
    // The /docs tree renders its own shell (.docs-shell, no .site-main), so an SPA
    // swap would find nothing to replace and leave the current page's content in
    // place while the URL changed to /docs. Let those be full browser navigations.
    if (u.pathname === '/docs' || u.pathname.indexOf('/docs/') === 0) return;
    var url = u.href;
    if (url === location.href) return;

    e.preventDefault();
    navigateTo(url, true);
  });

  window.addEventListener('popstate', function () {
    // A hash-only move within the same document (the #photo/#audio/#video nav
    // strip, or going back/forward across those jumps) must stay a native scroll.
    // Re-fetching and swapping the page here would tear down the live analysis
    // results, players and blob URLs. Only swap when the path itself changed.
    if (location.pathname === currentPath) return;
    navigateTo(location.href, false);
  });
})();
