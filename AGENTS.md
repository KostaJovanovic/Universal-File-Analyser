# Repository Guidelines

## Project Structure & Module Organization

The deployable static site is entirely under `web/`. The main analyser is
`web/index.html`. Application code is **TypeScript in `src/`**, compiled 1:1 by
`tsc` into `web/assets/js/` - that output is generated, so never edit or add a
module there. `src/` keeps the same tree shape:

- `core/` contains bootstrapping, routing, classification, shared utilities, and the format catalog (`formats.js`).
- `renderers/` contains one ES-module per analysed file domain.
- `parsers/` contains lazy metadata-parser chunks; `lib/` contains shared binary and WASM loaders.
- `web/assets/css/analyser.css` is the central stylesheet; `web/assets/vendor/` is third-party code (kept out of the working tree by sparse-checkout; nothing imports it as a module, so builds don't need it).

Root-level `tools/*.mjs` regenerate SEO and shared-page content. `worker/` is the small Cloudflare stats Worker. Project documentation is in `docs/`.

## Build, Test, and Development Commands

There is a TypeScript build, but no lint or automated test suite. `package.json`
has a single devDependency (`typescript`) and **must keep `"type": "module"`**,
or the `tools/*.mjs` generators that import the emitted `core/formats.js` break.

- `npx tsc -p tsconfig.json && npx tsc -p tsconfig.worker.json` - build once.
  Both configs are needed: the three module workers compile separately because
  `lib.dom` and `lib.webworker` cannot share a program.
- `node tools/check-build.mjs` - a build gate; fails when output is missing or
  stale relative to `src/`.
- The tree compiles **clean** under both configs, so `tsc` exiting non-zero means
  something is actually wrong - fix it. `strict` stays off deliberately:
  `strictNullChecks` + `noImplicitAny` report ~5,400 mostly-null-guard sites,
  which is its own project (see `CLAUDE.md`).

- `server.bat` - start the development server at `http://localhost:3000` plus two `tsc --watch` windows; use it instead of `python -m http.server` because `serve.py` mirrors production clean-URL and SPA routing. Without a watcher running, edits to `src/` have no effect on the served site.
- `node tools/prerender-formats.mjs` - regenerate the static formats hub when working on its generator inputs.
- `save.bat` - interactive commit/version-bump workflow. `save.bat commit` commits without pushing.

Edit files, refresh locally, and manually check the affected feature. Test UI changes in light and dark themes and at narrow viewport widths.

## Coding Style & Naming Conventions

Use vanilla HTML, CSS, and TypeScript ES modules. Write relative import specifiers with a `.js` extension (`from '../core/util.js'`) even though the file is `.ts` - TypeScript resolves it and emits it verbatim, which is what keeps the service-worker offline manifest valid. Follow nearby code for indentation and naming: camelCase for values/functions, kebab-case for CSS classes and filenames. Keep format definitions centralised in `src/core/formats.ts`; add specialised parsing through lazy modules rather than inflating initial-load code.

Reuse existing CSS tokens and component classes. New UI must keep the intentionally sharp design: no rounded corners. User-facing copy uses British spelling and must use ` - ` rather than em dashes.

## Generated Content & Configuration

Do not manually edit generated `web/formats/` pages or marker-delimited generated sections. Update their source data and run the appropriate script. Do not hand-edit `COMMIT_COUNT` in `app.js` or the service-worker `VERSION`; `save.bat` maintains both. Keep `wrangler.jsonc` aligned with the static `web/` deployment layout.

The canonical host is `analyser.valjdakosta.com`; the older `lab.valjdakosta.com` 307-redirects to it (every non-`/api/*` request, in `worker/index.js`) and must not appear in any absolute URL (canonical tags, og/twitter images, JSON-LD, sitemaps, `robots.txt`, `llms.txt`, share/export links, the `SITE` constants in `tools/`).

## Commit & Pull Request Guidelines

Recent history commonly uses short `update` messages, while substantive commits use imperative summaries (for example, `Fix ...` or `AI vocal separation ...`). Prefer a concise, specific imperative subject. Do not commit, push, or edit public patch notes unless explicitly requested. For pull requests, explain the user-visible change, note regenerated files, link relevant issues, and include screenshots for UI changes.
