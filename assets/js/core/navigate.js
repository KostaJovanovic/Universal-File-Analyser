/* Analyser - SPA router
   View Transitions API navigation: swaps page content in place and fires the
   anr:navigate event so boot() re-runs, with no full reload. */

(function () {
  // Detect the Tauri native shell once. Under it the OS asset protocol serves
  // files literally - there is no Cloudflare/serve.py rewriting /about ->
  // about.html - and a service worker would only add a stale-cache layer that
  // fights the native updater. Both are handled here, before the rest of the page
  // scripts run. Everything below is a no-op on the web build (window.__TAURI__
  // is undefined), so the site behaves exactly as before in a browser.
  var IS_TAURI = typeof window !== 'undefined' && !!(window.__TAURI__ || window.__TAURI_INTERNALS__);

  if (IS_TAURI && typeof navigator !== 'undefined' && navigator.serviceWorker) {
    // This classic script runs before every page's inline
    // `navigator.serviceWorker.register('sw.js', ...)` block, so turn registration
    // into a successful no-op. The native bundle also omits sw.js entirely
    // (tools/build-dist.mjs), making this belt-and-braces: it just keeps the
    // console clean instead of logging a failed registration on every page.
    try {
      navigator.serviceWorker.register = function () {
        return Promise.resolve({ update: function () {}, unregister: function () { return Promise.resolve(true); } });
      };
    } catch (_) { /* read-only in some engines - the absent sw.js still stops it */ }
  }

  // Map an internal, extensionless path to its real .html file under the shell
  // (/about -> /about.html; '/' and paths that already have an extension are left
  // alone). No-op on the web, where clean URLs resolve server-side.
  function toShellPath(pathname) {
    if (!IS_TAURI) return pathname;
    if (pathname === '/' || /\.[a-z0-9]+$/i.test(pathname)) return pathname;
    return pathname.replace(/\/+$/, '') + '.html';
  }

  if (!document.startViewTransition) {
    // No View Transitions API (older WebKit): the SPA swap below is unavailable,
    // so links fall back to full navigations. On the web the server resolves a
    // clean /about; under the shell that would 404, so intercept internal clicks
    // and point them at the real .html file. Inert on the web build.
    if (IS_TAURI) {
      document.addEventListener('click', function (e) {
        if (e.defaultPrevented) return;
        var link = e.target.closest('a[href]');
        if (!link) return;
        var href = link.getAttribute('href');
        if (!href) return;
        if (link.target === '_blank' || link.hasAttribute('download')) return;
        if (href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto:')) return;
        var u = new URL(href, location.href);
        var mapped = toShellPath(u.pathname);
        if (mapped === u.pathname) return;
        u.pathname = mapped;
        e.preventDefault();
        location.href = u.href;
      });
    }
    return;
  }

  // The path we're currently showing. Hash-only history changes (the sticky
  // #photo / #audio / #video nav strip, and back/forward across those) keep this
  // value, so popstate can tell a same-page scroll from a real page change.
  var currentPath = location.pathname;

  function swap(doc) {
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
    if (oldMain && newMain) oldMain.replaceWith(newMain);

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
    fetch(url)
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        document.startViewTransition(function () {
          swap(doc);
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
    // and a reload hits the same URL the server serves. Under the Tauri shell it
    // is the reverse - there is no server rewrite, so map to the real .html file.
    var u = new URL(href, location.href);
    if (IS_TAURI) {
      u.pathname = toShellPath(u.pathname);
    } else {
      u.pathname = u.pathname.replace(/\/index\.html(?=$)/, '/').replace(/\.html(?=$)/, '');
    }
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
