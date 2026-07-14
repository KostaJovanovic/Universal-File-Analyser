# Architecture

Big-picture overview of how Analyser is put together: a static, zero-backend
site that classifies and analyses files entirely in the browser. This doc is
for engineers orienting themselves in the codebase before diving into the
pipeline, renderer, or page docs.

## Zero-backend model

Analyser has no application server. It is plain HTML/CSS/ES-module JavaScript
with no framework, no build step and no `node_modules` (see the repo root
`CLAUDE.md`). Every file a user drops is read locally through the browser's
File API and analysed with on-device code and lazy-loaded WebAssembly - nothing
is uploaded. The only server-side code in the whole project is the Cloudflare
Worker described in [`worker.md`](worker.md), which powers an anonymous
analysed-file counter and nothing else; it never sees file contents.

## Page shell

Each top-level page (`web/index.html`, `about.html`, `compare.html`, etc.) is
a static HTML document sharing the same head/header/footer structure (see
[`pages.md`](pages.md) and the `shared-partials` skill). `web/assets/js/core/app.js`
is the entry point loaded on every page. Its `boot()` function
(`web/assets/js/core/app.js:330`) wires up the drop zone, result containers
(`photoResults`, `audioResults`, `videoResults`, `unknownResults`), the boot
splash fade-out, and page-level drag/drop handling. One-time global listeners
(window drag/drop, letter-hover effects) are guarded by `boot._once`
(`web/assets/js/core/app.js:1254`) so they aren't re-registered on every SPA
navigation, while per-navigation setup (scroll-spy, dark mode, search) runs
every time `boot()` re-executes.

## Classification pipeline overview

Dropping a file runs it through `resolveKind()` / `handleFile` in `app.js`,
which combines extension/MIME classification (`classify.js`) with
content-based sniffing (`file-sniff.js`) to pick a "kind", then looks that
kind up in the `ROUTES` table to find the renderer that should render it. See
[`pipeline.md`](pipeline.md) for the full walkthrough.

## Lazy-loading strategy

Renderers are not statically imported for the most part. `app.js` defines a
`lazy(path, exportName)` helper (`web/assets/js/core/app.js:207`):

```js
const lazy = (p, name) => (...args) => import(p).then((m) => m[name](...args));
```

Every entry in `ROUTES` wraps its renderer's exported function in `lazy(...)`,
so the renderer module (and everything it imports - WASM loaders, vendored
libraries) is only fetched the first time a file of that kind is analysed. The
three heaviest domains - photo, audio, video - additionally have their dropzone
initialisation code (`initPhoto`/`initAudio`/`initVideo`) pulled in via
`import()` inside `boot()` (`web/assets/js/core/app.js:1060-1076`) rather than
imported at module load, keeping them out of the page's critical module graph
entirely until first use. Once fetched, a module is served from the browser
cache (or the service worker's precache) on subsequent uses, including
offline.

## PWA / service worker

`web/sw.js` implements a cache-first service worker. `SHELL` is a large,
hand-maintained array of every JS module, CSS file and top-level page that
makes up the "app shell" - on install it is precached into a version-epoched
cache (`analyser-v<COMMIT_COUNT>`). Requests are served from that cache first;
only a miss touches the network. `activate` deletes any cache whose name isn't
in `KEEP_CACHES` (the current `VERSION`, plus the persistent
`analyser-offline` and `analyser-mdx` caches used by the offline-tiers and
vocal-separation features), so old versioned shells are cleaned up on each
deploy without disturbing user-downloaded offline content. Localhost/LAN
hosts (`server.bat`) are detected via `DEV` and skip caching entirely so
edits show up on a single refresh. Full detail in [`pwa-offline.md`](pwa-offline.md).

## SPA navigation

`web/assets/js/core/navigate.js` intercepts same-origin link clicks and
`popstate` and swaps the page using the View Transitions API
(`document.startViewTransition`) instead of a full reload: it fetches the
target page's HTML, swaps the `.site-mark`, `.site-nav`, `.site-main` and
`.site-footer` nodes, updates `history`, and fires an `anr:navigate` event
that `app.js` listens for to re-run `boot()`. If the browser has no View
Transitions API, the whole module is a no-op and links fall back to normal
browser navigation. A live in-progress analysis on the home page is preserved
across a "leave and come back" navigation: `swap()` stashes the current
`.site-main` on `window._anrHomeMain` when leaving `/` with an
`anr-has-file` body class, and reinserts it verbatim (DOM, listeners, media
position) if the user navigates back home, rather than re-parsing an empty
one. Media elements and Web Audio players are explicitly stopped before a
page swap so audio doesn't keep playing on a detached node.

## Cloudflare deploy

`wrangler.jsonc` configures a static-asset deploy: `assets.directory` is
`web`, `not_found_handling` is `single-page-application` (any unmatched path
falls back to serving `index.html`), and `html_handling` defaults to
`auto-trailing-slash` (clean URLs are canonical - `/about` serves
`about.html`, and `/about.html` 308-redirects to `/about`). The config also
declares the Worker (`worker/index.js`) as `main`, plus a D1 database
binding (`DB`) and a rate-limit binding (`ANALYSED_LIMIT`, 15 requests/60s per
hashed IP) that back the visitor/analysed-file counters - the only
non-static part of the deploy. Every push to `main` ships (see [`tooling.md`](tooling.md)
for the commit/deploy flow via `save.bat`).
