# Dev tooling

The dev loop, the local server's Cloudflare-mirroring routing, the
commit/version-bump/deploy flow (`save.bat`), the static-generator scripts it
runs, and how the version number shown in the UI is computed. For engineers
who need to run the site locally or understand what a commit actually does.

## Dev loop (server.bat / serve.py)

`server.bat` is the only supported way to run the site locally - **not**
`python -m http.server`. It kills whatever already holds port 3000 (via a
PowerShell `Get-NetTCPConnection`/`Stop-Process` one-liner, so every launch
is a fresh instance), finds the machine's local IP for phone testing, opens
`http://localhost:3000` in a browser, and runs `python serve.py 3000
<LOCAL_IP>`.

`serve.py` exists because a plain static file server serves files
*literally* - `/about` would 404 and `/about.html` would not redirect -
which is the opposite of how the production Cloudflare deploy behaves. It
replicates Cloudflare's clean-URL routing:

- `/about.html` -> 308 redirect to `/about` (and `/index.html` -> `/`)
- `/about` -> serves `about.html` (200)
- `/` -> serves `index.html` (200)
- `/assets/...` -> served literally (real files with an extension)
- any other unmatched path -> `index.html` (200), the SPA fallback (mirroring
  `wrangler.jsonc`'s `not_found_handling: "single-page-application"`)

It also mocks the `/api/*` stats endpoints (`MOCK_STATS`, with a
deterministic seeded 45-day trend series) since there is no Worker or D1
locally - without this, `/api/*` would fall through to the SPA handler and
break the visitor badge and the `/stats`/`/atari` pages. Binds `0.0.0.0` so
the printed Network URL works for phone testing on the same Wi-Fi.

There is no build step: editing a file and refreshing is the entire dev
loop.

## Commit / version-bump flow (save.bat)

`save.bat` is **the only correct way to commit** to this repo - never
hand-edit `COMMIT_COUNT` or commit around it. Run as `save.bat` (interactive
menu: Save / Commit / Push / Pull / Backup / Samples / Quit) or with an
action argument (`save.bat save`, `save.bat commit` for commit-without-push,
`save.bat --force` for commit + force-push). The `:save` path:

1. Computes the next commit count (`git rev-list --count HEAD` + 1) and the
   version label via the same major/minor logic as `analyserVersion()` in
   `app.js` (a `RELEASES` list in the batch file that must stay in sync with
   `RELEASE_COMMITS` - see "Version numbering" below).
2. Bumps `const COMMIT_COUNT = N;` in `web/assets/js/core/app.js` and `const
   VERSION = 'analyser-vN';` in `web/sw.js` via UTF-8-safe PowerShell regex
   replacements (explicit `-Encoding UTF8` on both read and write, otherwise
   Windows' ANSI code page default mangles non-ASCII characters in the file).
3. Runs the generator scripts, in order (each non-fatal - a failure just
   commits the previous generated output with a warning): rebuild
   `/samples` from `samples/`, prerender `/formats` from the catalog,
   prerender per-extension `/formats/<ext>` pages + `sitemap-formats.xml`,
   stamp the live format count into static SEO surfaces + refresh
   `sitemap.xml` lastmod dates, stamp the shared footer block into every
   main page, stamp the shared `<head>` tail into every main page,
   regenerate `/test`'s token/animation sections from `analyser.css`.
4. Optionally offers a local stats CSV backup (commit-only path only).
5. `git add .`, shows `git status`, prompts for a commit message (default
   `"update"`), commits.
6. Unless commit-only: prompts to push, and on a rejected push offers to
   fetch+merge or force-push.

## Generator scripts (tools/*.mjs)

Node scripts (dev-only, never served) that keep hand-maintained pages in
sync with single sources of truth, run by `save.bat` on every commit:

| Script | Purpose |
|---|---|
| `stamp-head.mjs` | Stamps the shared `<head>` tail (stylesheet links + the before-first-paint theme bootstrap script) into every main page from one `THEME_SCRIPT` source in `prerender-common.mjs`, between each page's `HEAD:START`/`HEAD:END` markers |
| `stamp-footer.mjs` | Stamps the shared footer block (the "Everything runs in your browser" heading + the whole offline-download section) into every main page from `tools/partials/footer-shared.html`, between `FOOTER:START`/`FOOTER:END` markers |
| `stamp-counts.mjs` | Stamps the live format count into static, JS-free crawler surfaces (meta/OG/Twitter descriptions, the `WebApplication` JSON-LD `featureList`, the PWA manifest description) and refreshes `sitemap.xml` `<lastmod>` dates, so hand-maintained numbers can never drift from the real catalog size |
| `prerender-formats.mjs` | Bakes the format catalog into static `formats.html` markup (with `#fmt-`/`#ext-` deep-link anchors) so crawlers see the `/formats` hub content without running JS |
| `prerender-format-pages.mjs` | Emits one static landing page per extension with catalog depth `'full'` into `web/formats/`, plus `sitemap-formats.xml` - the long-tail SEO play ("how to open a .stl file") |
| `prerender-samples.mjs` | Rebuilds the `/samples` gallery from whatever files are in `samples/`, deriving each card's label/caption from the format catalog (with an optional override in `tools/sample-content.mjs`) |
| `prerender-testpage.mjs` | Regenerates only the token/animation sections of `/test` (`test.html`) from `analyser.css`, between `TOKENS:START`/`TOKENS:END` markers - the hand-authored component demos further down the page are untouched |

See the `format-seo-pages` and `shared-partials` skills for the fuller
picture of the generated-page and single-sourcing systems these scripts
maintain.

## Version numbering

See the `version-numbering` skill for the full mechanism. In short:
`COMMIT_COUNT` (bumped by `save.bat`) and `RELEASE_COMMITS` (a fixed list of
commit numbers crowned as major-version boundaries) feed
`analyserVersion(n, releases)` in `app.js`, which computes labels like
`0.09` (pre-1.0), `1.0`/`1.01` (post-crowning, counter reset), up through
the current `5.x` era. `save.bat`'s own `RELEASES` variable mirrors
`RELEASE_COMMITS` and must be kept in sync by hand when a future commit is
crowned a new major version.
