# Root reorganisation plan - split the repo into `web/` + `native/` + root infra

Status: proposal / not yet executed. Written 2026-07-11.

## 1. Goal

Make the repo root readable at a glance. Today the root holds ~27 loose files
(10 HTML pages, sw.js, manifest, sitemaps, robots, llms, plus config and docs)
mixed in with 16 folders. The idea:

- **All website things** -> one folder (`web/`).
- **All app (native desktop) things** -> one folder (`native/`, which already exists).
- **Keep in root**: repo-wide folders (`.claude`, `.git`, `.github`, ...), the
  dev/deploy scripts (`save.bat`, `server.bat`, `serve.py`), any app `.bat`
  files, and the repo-level config/docs (`wrangler.jsonc`, `.assetsignore`,
  `.gitignore`, `.gitattributes`, `README.md`, `CLAUDE.md`, `LICENSE`).

## 2. The one constraint that makes this non-trivial

The root is not "next to" the website - **the root *is* the website**.
`wrangler.jsonc` sets `assets.directory: "."`, so Cloudflare uploads the whole
repo root as static assets, and `.assetsignore` exists solely to *exclude*
everything that is not a public asset (`.git/`, `.claude/`, `tools/`, `worker/`,
`native/`, `*.bat`, `serve.py`, `wrangler.jsonc`, `research*/`, `README.md`,
`CLAUDE.md`).

Moving the site under `web/` and pointing `assets.directory` at `web/` **inverts
the model**: instead of listing everything to exclude, we point at the one folder
to include. `.assetsignore` then shrinks to almost nothing. That is the payoff -
but the same path assumption is baked into `serve.py`, `save.bat`, every
`tools/*.mjs` generator, and `native/build-dist.mjs`, so all of those must move
with it.

### Why the HTML/CSS/JS content does NOT need editing

The site is served **at the domain root** today and will still be served at the
domain root after the move (Cloudflare serves the *contents* of `web/` at `/`).
Internal references are all either root-absolute clean URLs (`/about`,
`/assets/js/...`) or relative - none are filesystem paths. So moving the files
changes their disk location but **not their public URL**, and no page/link/import
needs rewriting. This is the linchpin; verify it holds (step 6.0) before trusting it.

## 3. Target layout

```
/ (root)
  .claude/              keep  - AI/tooling config + skills (repo-wide)
  .git/  .github/       keep  - VCS + CI (release.yml)
  .wrangler/            keep  - wrangler local state (gitignored)
  research/             keep  - notes (THIS FILE lives here)
  research2/            keep  - (consider merging into research/ - see 8)
  stats-backup/         keep  - local stats CSVs (gitignored)
  tools/                keep  - dev-only Node generators (never served)
  worker/               keep  - Cloudflare Worker /api backend (wrangler "main")
  native/               keep  - Tauri desktop app (already isolated)

  web/                  NEW   - the entire website (served at "/")
    assets/               (css, fonts, img, js, vendor)
    formats/              (generated per-extension pages)
    samples/              (sample files driving /samples)
    index.html about.html patch.html privacy.html stats.html
    samples.html compare.html atari.html formats.html test.html
    manifest.json sw.js robots.txt sitemap.xml sitemap-formats.xml llms.txt

  save.bat  server.bat  serve.py       keep in root (dev/deploy)
  native-dev.bat                       moved up from native/dev-build.bat
  wrangler.jsonc  .assetsignore        keep in root (deploy config)
  .gitignore  .gitattributes           keep in root (repo config)
  README.md  CLAUDE.md  LICENSE        keep in root (docs)
```

## 4. What moves into `web/` (the website)

| Item | Now | After |
|---|---|---|
| HTML pages (10) | `./*.html` | `web/*.html` |
| Assets | `assets/` | `web/assets/` |
| Generated format pages | `formats/` | `web/formats/` |
| Samples | `samples/` | `web/samples/` |
| Service worker | `sw.js` | `web/sw.js` |
| PWA manifest | `manifest.json` | `web/manifest.json` |
| Crawler files | `robots.txt`, `sitemap.xml`, `sitemap-formats.xml`, `llms.txt` | `web/...` |

## 5. What stays where it is

- **root docs/config**: `wrangler.jsonc`, `.assetsignore`, `.gitignore`,
  `.gitattributes`, `README.md`, `CLAUDE.md`, `LICENSE`.
- **dev scripts**: `save.bat`, `server.bat`, `serve.py` (serve.py stays in root
  but points its document root at `web/` - see 6.4).
- **tools/**: dev-only generators; never served, so they stay in root and just
  learn the new output path (6.5).
- **worker/**: the `/api` stats backend is server-side, not a static asset. It is
  referenced by `wrangler.jsonc` `main: "worker/index.js"` (a path relative to the
  config file in root), so keeping it in root is simplest. (Option: nest under a
  `server/` folder later; out of scope here.)
- **native/**: already the isolated app folder. The only change: pull its `.bat`
  up to root (6.7).

## 6. Required config / tooling edits (the ripple list)

Do these in lockstep with the file moves or the site/build breaks.

### 6.0 Pre-flight: confirm no filesystem-relative internal links
Grep the pages for `src="./` / `href="./` / `src="assets/` (relative-without-leading-slash)
and any hardcoded `file://` or disk paths. Expectation: everything is `/...`
absolute or safely relative-within-`web/`. If a stray relative path breaks when
the file’s directory context is unchanged (it should not, since the whole tree
moves together), fix it. This validates the section 2 assumption.

### 6.1 `wrangler.jsonc`
- `assets.directory: "."` -> `assets.directory: "web"`.
- `main: "worker/index.js"` stays (root-relative, worker stays in root).
- Everything else (d1, ratelimit, not_found_handling) unchanged.

### 6.2 `.assetsignore`
- With `directory: "web"`, all the non-website stuff is already outside `web/`
  and no longer needs listing. Reduce this file to (at most) anything inside
  `web/` that must not ship (currently nothing obvious). Likely becomes empty or
  deletable.
- **Keep it LF-only** if retained (`.gitattributes` enforces this; CRLF appends a
  stray `\r` and breaks the patterns).

### 6.3 `save.bat`
- Line ~69: `assets/js/core/app.js` -> `web/assets/js/core/app.js` (COMMIT_COUNT bump).
- Line ~74: `sw.js` -> `web/sw.js` (VERSION cache-epoch bump).
- The `tools/*.mjs` invocations stay as-is (tools remain in root); the tools
  themselves are repointed in 6.5.

### 6.4 `serve.py`
- `ROOT = os.path.dirname(os.path.abspath(__file__))` ->
  `ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'web')`.
- `os.chdir(ROOT)` and the clean-URL routing then operate on `web/` transparently.
- `server.bat` needs no change (still runs `python serve.py`), because serve.py
  stays in root.

### 6.5 `tools/*.mjs` (output roots)
Each generator resolves a `ROOT` near its top (e.g. `join(__dirname, '..')`).
Repoint the ones that WRITE website files to `web/` (e.g.
`join(__dirname, '..', 'web')`), or introduce a shared `WEB` constant in
`tools/prerender-common.mjs` and import it:
- writes website files -> repoint: `prerender-samples.mjs`, `prerender-formats.mjs`,
  `prerender-format-pages.mjs`, `stamp-counts.mjs`, `stamp-footer.mjs`,
  `stamp-head.mjs`, `prerender-testpage.mjs`, `disperse-unsupported.mjs`.
- reads `assets/js/core/formats.js` etc. as input -> also under `web/` now; update
  the read paths too (these tools both read from and write to the site tree).
- unaffected: `backup-stats.mjs` (writes `stats-backup/` in root), plus data/helpers
  `format-page-content.mjs`, `dyk-extra.json`, `sample-content.mjs`,
  `prerender-common.mjs`, `native-version.mjs`.
- `tools/partials/` (footer-shared.html, head partials) stay in `tools/`.

### 6.6 `native/build-dist.mjs`
- Today: `ROOT = join(NATIVE_DIR, '..')` (repo root) and a large EXCLUDE_DIRS /
  EXCLUDE_FILES list that strips every non-website dir/file before copying into
  `native/dist/`.
- After: `ROOT = join(NATIVE_DIR, '..', 'web')`. The big exclude lists collapse to
  just the native-only drops **inside** `web/` (`sw.js`, `robots.txt`,
  `sitemap*.xml`, `llms.txt`). The VENDOR (WASM) logic is unchanged.
- Keep the VENDOR pinned URLs in lockstep with the renderer constants as today.

### 6.7 `native/dev-build.bat`
- Move to root as `native-dev.bat` (per "app `.bat` files in root"). Update any
  internal `cd`/path so it still `cd`s into `native/` before running the Tauri
  commands.

### 6.8 `.github/workflows/release.yml`
- Audit for hardcoded paths (the "Cache vendored WASM" step keys on
  `native/.native-cache`, the version stamp runs `tools/native-version.mjs`). Most
  are under `native/` or `tools/` and unaffected, but confirm none assume website
  files sit at repo root.

### 6.9 Docs
- `CLAUDE.md`: the entire "File structure" tree and every inline path reference
  (`assets/js/core/app.js`, `sw.js`, "COMMIT_COUNT lives in app.js", etc.) gains a
  `web/` prefix. Also update the "Commands", "Native app", and skills-pointer
  sections.
- `.claude/skills/*` (add-file-format, format-seo-pages, shared-partials,
  version-numbering): repoint every path they cite into `web/`.
- `README.md`: update any structure/paths mentioned.

## 7. Migration steps (order matters)

1. **Branch**: `git switch -c reorg-web-folder` (never do this on `main` directly).
2. **Create + move with history**: `git mv` each website item into `web/`
   (git mv preserves blame/history):
   - `git mv index.html about.html patch.html privacy.html stats.html samples.html compare.html atari.html formats.html test.html web/`
   - `git mv assets formats samples web/`
   - `git mv sw.js manifest.json robots.txt sitemap.xml sitemap-formats.xml llms.txt web/`
3. **Move the app bat**: `git mv native/dev-build.bat native-dev.bat` (then fix its paths).
4. **Edit config/tooling** per section 6 (wrangler, .assetsignore, save.bat,
   serve.py, tools/*, build-dist.mjs, release.yml).
5. **Update docs** (CLAUDE.md, skills, README).
6. **Cleanup stray root files** (section 8): delete `nul`, ensure `__pycache__/`
   is gitignored.
7. **Verify** (section 8 checklist) locally + on a Cloudflare preview deploy.
8. **Commit via `save.bat`** as usual (it now bumps `web/assets/js/core/app.js`
   and `web/sw.js`). Do a real deploy only after the preview passes.

## 8. Verification checklist

- [ ] `server.bat` serves the site locally and `/about`, `/patch`, `/formats`,
      `/compare` all resolve (clean URLs still work through the new `web/` root).
- [ ] A full `save.bat` run: version bumps land in `web/assets/js/core/app.js`
      and `web/sw.js`; all `tools/*` generators write into `web/` (no stray files
      regenerate at the old root).
- [ ] Service worker: `/sw.js` still served (from `web/sw.js`), scope `/`,
      precache SHELL paths resolve. Existing installs pick up the new VERSION
      epoch and re-cache cleanly (verify the SW registration URL in app.js /
      navigate.js is still `/sw.js`).
- [ ] Cloudflare **preview** deploy: home page loads, an asset (`/assets/css/analyser.css`)
      loads, `/api/stats` still answers (worker unaffected), 404 fallback works.
- [ ] Native: `node native/build-dist.mjs --no-vendor` assembles `native/dist`
      from `web/`; `npm run dev` (Tauri) loads; a full `npm run build` vendors WASM.
- [ ] Nothing website-shaped remains at the old root; `git status` is clean.

## 9. Open decisions (pick before executing)

- **Website folder name**: `web/` (recommended, short) vs `site/` vs `www/`.
- **Rename `native/` -> `app/`?** Cosmetic symmetry with `web/`, but high churn
  (gitignore, CLAUDE.md, release.yml, build config all reference `native/`).
  Recommendation: keep `native/` - it is already the isolated app folder, and the
  user's "app things in one folder" goal is already met.
- **`worker/`**: keep in root (recommended) or nest under a future `server/`.
- **`research2/`**: merge into `research/` to drop one root folder, or keep both.
- **Root cleanup**: delete the stray `nul` file (a botched `> nul` redirect
  artifact) and confirm `__pycache__/` + `.wrangler/` + `stats-backup/` are
  gitignored.

## 10. Risk / rollback

- Highest-risk items: `wrangler.jsonc` directory (a wrong value 404s the whole
  site) and the service-worker URL/scope (a changed `/sw.js` path can strand
  existing installs on a dead SW). Both are caught by the section 8 preview-deploy
  and SW checks before touching `main`.
- No test suite exists, so verification is manual (per section 8). Do it all on
  the branch.
- Rollback: the work is one branch and history-preserving `git mv`s; if the
  preview deploy misbehaves, `git switch main` and the live site is untouched
  (nothing shipped until a real push to `main`).
