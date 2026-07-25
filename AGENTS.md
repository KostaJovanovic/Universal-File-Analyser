# Repository Guidelines

## Project Structure & Module Organization

The deployable static site is entirely under `web/`. The main analyser is
`web/index.html`; application code lives in `web/assets/js/`:

- `core/` contains bootstrapping, routing, classification, shared utilities, and the format catalog (`formats.js`).
- `renderers/` contains one ES-module per analysed file domain.
- `parsers/` contains lazy metadata-parser chunks; `lib/` contains shared binary and WASM loaders.
- `assets/css/analyser.css` is the central stylesheet; `vendor/` is third-party code.

Root-level `tools/*.mjs` regenerate SEO and shared-page content. `worker/` is the small Cloudflare stats Worker. Project documentation is in `docs/`.

## Build, Test, and Development Commands

There is no package manager, build, lint, or automated test suite.

- `server.bat` - start the supported development server at `http://localhost:3000`; use it instead of `python -m http.server` because `serve.py` mirrors production clean-URL and SPA routing.
- `node tools/prerender-formats.mjs` - regenerate the static formats hub when working on its generator inputs.
- `save.bat` - interactive commit/version-bump workflow. `save.bat commit` commits without pushing.

Edit files, refresh locally, and manually check the affected feature. Test UI changes in light and dark themes and at narrow viewport widths.

## Coding Style & Naming Conventions

Use vanilla HTML, CSS, and ES modules. Follow nearby code for indentation and naming: camelCase for JavaScript values/functions, kebab-case for CSS classes and filenames. Keep format definitions centralised in `web/assets/js/core/formats.js`; add specialised parsing through lazy modules rather than inflating initial-load code.

Reuse existing CSS tokens and component classes. New UI must keep the intentionally sharp design: no rounded corners. User-facing copy uses British spelling and must use ` - ` rather than em dashes.

## Generated Content & Configuration

Do not manually edit generated `web/formats/` pages or marker-delimited generated sections. Update their source data and run the appropriate script. Do not hand-edit `COMMIT_COUNT` in `app.js` or the service-worker `VERSION`; `save.bat` maintains both. Keep `wrangler.jsonc` aligned with the static `web/` deployment layout.

The canonical host is `analyser.valjdakosta.com`; the older `lab.valjdakosta.com` still serves the same Worker but must not appear in any absolute URL (canonical tags, og/twitter images, JSON-LD, sitemaps, `robots.txt`, `llms.txt`, share/export links, the `SITE` constants in `tools/`).

## Commit & Pull Request Guidelines

Recent history commonly uses short `update` messages, while substantive commits use imperative summaries (for example, `Fix ...` or `AI vocal separation ...`). Prefer a concise, specific imperative subject. Do not commit, push, or edit public patch notes unless explicitly requested. For pull requests, explain the user-visible change, note regenerated files, link relevant issues, and include screenshots for UI changes.
