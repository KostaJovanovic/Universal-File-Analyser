---
name: docs-site
description: How Analyser's public /docs site is generated from the Markdown in docs/ by tools/build-docs-html.mjs (NAV array, output paths, sitemap-docs.xml, the self-contained page shell). Use when editing docs/*.md, adding a docs page, or touching build-docs-html.mjs.
---

`docs/` (repo root) is the project's own reference documentation: an
architecture set (architecture, pipeline, renderers, parsers-and-libs, pages,
pwa-offline, tooling, worker, design-system), a "start here" pair
(`user-guide.md`, `faq.md`), a usage-oriented `features/` set, and a reference
pair (`FEATURE-INVENTORY.md`, `PROGRESS.md`), mapped in `docs/README.md`. It is
both the working reference *and* the source for a public docs site.

**Never hand-edit `web/docs.html` or anything under `web/docs/` - both are
wiped (`rmSync`) and rebuilt on every commit.** Edit the Markdown in `docs/`.

`tools/build-docs-html.mjs` (run by save.bat) converts the Markdown to on-brand
HTML with its own tiny converter - no npm deps:

- `docs/README.md` → `web/docs.html` (served at `/docs`) - the hub is a
  **sibling file, not `web/docs/index.html`**, matching the `/formats` clean-URL
  pattern.
- `docs/<name>.md` → `web/docs/<name>.html`, `docs/features/<n>.md` →
  `web/docs/features/<n>.html`.

Adding a page also means adding it to the `NAV` array in the generator - it
drives the sidebar, the prev/next pager and the output filenames.

The docs pages are deliberately self-contained: they load `assets/css/docs.css`
plus `analyser.css`, and `assets/js/core/docs.js` (theme toggle, sidebar
filter, footer contact) rather than the main `app.js` - no drop pipeline, no
stats pings. They get the theme bootstrap from the generator directly, so they
are **not** in stamp-head's or stamp-footer's `PAGES`, and not in `sw.js`
`SHELL`. The `/docs` hub is listed in `sitemap.xml`; the sub-pages get their own
`sitemap-docs.xml`, emitted by `build-docs-html.mjs` (mirroring how
`prerender-format-pages.mjs` owns `sitemap-formats.xml`) and referenced from
`robots.txt`.

When you change how something works, update its `docs/` page in the same pass -
it's verified-against-source documentation and drifts silently otherwise.
