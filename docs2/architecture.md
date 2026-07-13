# Architecture

Big-picture view of how Analyser is built: a zero-backend, browser-only forensic
file workbench of vanilla HTML/CSS/ES-module JavaScript, with no build step. This
doc is for anyone who wants to understand the shape of the codebase before diving
into a specific area; the pipeline, renderer, page and PWA docs go deeper on each
piece.

## The zero-backend model

Analyser is a static site. Every byte of analysis happens on the visitor's device
through the File API and lazy-loaded WebAssembly - nothing is uploaded. There is
no application server: the site is deployed as static assets to Cloudflare (see
`wrangler.jsonc`, `assets.directory = "web"`), and the only server-side code is a
small Cloudflare Worker (`worker/index.js`) that powers an anonymous "file
analysed" counter behind `/api/*`. The analyser itself never calls it except for
that one extension-only ping (see `docs2/worker.md`).

Because there is no backend and no framework, the dev loop is just editing a file
and refreshing. `server.bat` launches `serve.py` on port 3000 to mirror the
production clean-URL routing locally (see `docs2/tooling.md`).

## The page shell

Every page shares one shell: a `.site-header` (the animated site-mark), a
`.site-nav`, a `.site-main`, and a `.site-footer`. The home page (`web/index.html`)
is the drop-and-analyse app; the other top-level pages (`about`, `patch`,
`formats`, `stats`, `privacy`, `samples`, `compare`, `atari`) share the same
chrome (see `docs2/pages.md`). The `<head>` stylesheet + theme-bootstrap tail and
the footer's offline-use block are single-sourced across pages by the stamp tools
(see `docs2/tooling.md` and the `shared-partials` skill).

The entry point is `web/assets/js/core/app.js`. Its `boot()` function wires the
page: the drop targets, nav behaviour, search, dark-mode toggle, the compare
zones, the samples gallery, and the "Recently analysed" history panel. `boot()` is
re-run on every SPA navigation (via the `anr:navigate` event); one-time window
listeners are guarded behind `if (!boot._once)`.

## Classification and rendering pipeline (overview)

A dropped file flows through:

```
drop / paste / pick
   -> handleFile(file)                 (app.js)
        -> classifyFile(file)          (classify.js: name + MIME only)
        -> byte-sniff reroutes         (file-sniff.js, VARIANT_REROUTE, SPICE .raw)
        -> kind  ->  ROUTES[kind]      (app.js dispatch table)
        -> renderer module (lazy import) draws into its results section
        + forensic cards, integrity/hash card, browse-as-archive, share nudge
```

`classifyFile()` decides a `kind` from the extension and MIME type alone; the
`ROUTES` table in `app.js` maps each `kind` to a renderer. Content-based sniffing
(`file-sniff.js`) layers on top to catch files whose name lies or is missing. The
full walk-through is in `docs2/pipeline.md`.

## Lazy-loading strategy

Keeping the initial page small is a first-class concern:

- **Renderers are lazily imported.** `ROUTES` wraps most renderers in
  `lazy(path, name)`, which does `import(path).then(m => m[name](...))` on first
  dispatch - so the ~82 renderer modules are not in the initial module graph; only
  the type actually dropped is fetched. The hot-path renderers
  (`archive`, `proprietary`, `unknown`, `folder`, `compare`, `spice`) stay
  statically imported.
- **Photo/audio/video** are heavy (spectrogram, codecs, frame tools, recovery), so
  even their dropzone init is dynamically imported inside `boot()` rather than at
  the top of `app.js`.
- **exifr** (photo/video metadata, ~74 KB) is injected on demand the first time the
  pipeline needs it (`ensureExifr()` in `app.js`), not shipped on every page.
- **Parser chunks and WASM engines** (`web/assets/js/parsers/*`, the loaders in
  `web/assets/js/lib/*`, and vendored libraries under `web/assets/vendor/`) load
  only when a file needs them. See `docs2/parsers-and-libs.md`.

Because the service worker precaches the app shell, an `import()` of an
already-cached module is instant and works offline.

## PWA and the service worker

`web/sw.js` precaches an explicit `SHELL` array (the app's HTML routes, all core
JS, every renderer, parser chunk and lib loader, plus icons and exifr) under a
version-epoched cache name (`VERSION = 'analyser-vNNN'`). It serves cache-first:
a hit is returned with no revalidation, and only a miss touches the network. On
localhost / LAN IPs it becomes a pass-through so edits show on a single refresh.

Separate caches survive version bumps: `analyser-offline` (the user's explicitly
downloaded offline tiers) and `analyser-mdx` (the AI vocal-separation model). See
`docs2/pwa-offline.md`.

## SPA navigation

`web/assets/js/core/navigate.js` intercepts same-origin link clicks and swaps the
page in place using the View Transitions API, dispatching `anr:navigate` so
`boot()` re-runs - no full reload. It swaps `.site-mark`, `.site-nav`,
`.site-main` and `.site-footer`. Leaving home with a live analysis on screen
stashes the whole `.site-main` in `window._anrHomeMain` so a later return restores
it verbatim (DOM, listeners, media position, resolved async cells), and `boot()`
skips re-wiring the preserved nodes via `window._anrHomeRestored`. Browsers
without the View Transitions API fall back to normal full-page navigation. See
`docs2/pages.md`.

## Cloudflare deploy

Deployment is a static-asset push: every push to `main` ships via Cloudflare
(`wrangler.jsonc`). `assets.directory` is `web`, `html_handling` gives canonical
clean URLs (`/about` serves `about.html`; `/about.html` 308-redirects to
`/about`), and `not_found_handling: "single-page-application"` sends unknown paths
to `index.html` so deep links and the SPA keep working. The Worker (`main`) only
handles `/api/*` and otherwise hands requests back to the assets system via
`env.ASSETS.fetch`. There is no manual deploy step and no build.
