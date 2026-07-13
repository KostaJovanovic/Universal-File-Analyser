# Tooling and version numbering

The dev loop, the local server's clean-URL routing, the commit + version-bump
flow, the Node generator scripts, and how the version number is computed. There is
no build, lint, or test pipeline - editing a file *is* the dev loop. All generator
scripts are dev-only Node in `tools/` and are never served; they read the website
from a `WEB = join(ROOT, 'web')` constant.

## Running locally

`server.bat` launches `serve.py` on port 3000 and opens a browser. Use it rather
than `python -m http.server`, because `serve.py` mirrors production Cloudflare
routing:

- Clean URLs: `/about` serves `about.html` (200); `/about.html` 308-redirects to
  `/about`; `/index.html` redirects to `/`.
- SPA fallback: unknown paths serve `index.html` so deep links and the SPA work.
- Mocks `/api/*` (the stats endpoints have no local Worker) for page previews.
- Binds `0.0.0.0` and prints a scannable QR for the LAN URL, so phone testing on
  the same Wi-Fi works. `server.bat` first frees port 3000 from any prior listener.

A plain static server 404s `/about`, `/compare`, `/patch` - the usual "the about
page is broken locally" cause.

## Committing: `save.bat` (the only correct way to commit)

`save.bat` (menu) or `save.bat save` is the **only** correct commit path. It:

1. Computes `NEXT_COUNT = git rev-list --count HEAD + 1` and the version label
   (mirroring `analyserVersion()`; see below).
2. Rewrites `const COMMIT_COUNT = N;` in `web/assets/js/core/app.js` and
   `const VERSION = 'analyser-vN';` in `web/sw.js` (both read/written as explicit
   UTF-8 to avoid code-page mangling). Bumping the SW cache epoch ships fresh
   JS/CSS instead of leaving clients on a stale shell.
3. Runs the generators in order (all non-fatal - a failure keeps the existing copy):
   `prerender-samples` -> `prerender-formats` -> `prerender-format-pages` ->
   `stamp-counts` -> `stamp-footer` -> `stamp-head` -> `prerender-testpage`.
4. `git add . && git commit && git push origin main`.

Subcommands: `save.bat commit` (commit, no push), `save.bat --force` (force-push),
`push`/`pull`/`backup`/`samples` menu options. **Do not hand-edit `COMMIT_COUNT` or
commit around this script.** (Per `CLAUDE.md`, never run `save.bat`, commit, push,
or write patch notes unless the user explicitly asks in that message.)

## The generator scripts (`tools/*.mjs`)

Everything they write is generated output - do not hand-edit the generated files.

| Script | What it generates |
|---|---|
| `prerender-samples.mjs` | `web/samples.html` from the files in `web/samples/` - one clickable card per sample. |
| `prerender-formats.mjs` | The static `/formats` hub (`web/formats.html`) from the `formats.js` catalog, so crawlers see the full list as real markup. |
| `prerender-format-pages.mjs` | One static `/formats/<ext>` landing page per full-analysis extension, plus `sitemap-formats.xml`. The `web/formats/` directory is wiped and rebuilt each run. |
| `stamp-counts.mjs` | Stamps the live format count into the crawler-only SEO surfaces (meta/OG/Twitter/JSON-LD descriptions, `manifest.json`, feature text) and refreshes `sitemap.xml` lastmod, so the hand-maintained numbers can't drift from the catalog. |
| `stamp-footer.mjs` | Stamps the shared footer block (the "Everything runs in your browser" heading + the whole offline-download section + dependency list) into every main page from `tools/partials/footer-shared.html`. Each page's own `.footer-bottom` row is left alone. |
| `stamp-head.mjs` | Stamps the shared `<head>` tail (stylesheet links + the before-first-paint theme bootstrap `THEME_SCRIPT` from `prerender-common.mjs`) into every main page. |
| `prerender-testpage.mjs` | Regenerates the token/animation sections of `/test` from `analyser.css`, between the `TOKENS:START`/`TOKENS:END` markers. The component demos in `test.html` are hand-authored and untouched. |
| `prerender-common.mjs` | Shared helpers (`esc`, `escAttr`, `buildFullKeys`, `makeHrefOf`, `THEME_SCRIPT`, `DEPTH_BADGE`) used by the generators - the single source for the theme script and format-key logic. |
| `backup-stats.mjs` | Read-only snapshot of the live `/api/stats` counters to `stats-backup/*.csv` (gitignored, local). |

See the `format-seo-pages` and `shared-partials` skills for the deeper workflow on
the generated pages and single-sourced partials, and `docs2/pages.md` for `/test`.

## Version numbering

Every commit is its own version. The logic lives in `analyserVersion(n, releases)`
in `web/assets/js/core/app.js`, driven by two constants:

- `COMMIT_COUNT` - the current commit number (bumped by `save.bat`).
- `RELEASE_COMMITS = [29, 60, 100, 151, 173, 195]` - the commits crowned as major
  releases.

The rule:

- Pre-1.0 (before commit 29): `0.NN`, where `NN` is the zero-padded 1-based commit
  position (`0.01`, `0.09`, `0.10`, …).
- At each release commit the major version increments and the minor resets: commit
  29 = `1.0`, 30 = `1.01`; commit 60 = `2.0`; 100 = `3.0`; 151 = `4.0`; 173 = `5.0`.
- Between releases: `major.NN`, where `NN` is the zero-padded offset from the last
  release commit.

To crown a new major release, append its commit number to `RELEASE_COMMITS` (sorted
ascending) **and** mirror it in the `RELEASES` constant in `save.bat` (which
recomputes the same label in PowerShell for the commit banner). See the
`version-numbering` skill.

## Deploy

Pushing to `main` ships via Cloudflare (`wrangler.jsonc`, `assets.directory = web`).
There is no manual deploy step. See `docs2/architecture.md` and `docs2/worker.md`.
