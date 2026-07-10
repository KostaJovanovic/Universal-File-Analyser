---
name: shared-partials
description: How Analyser single-sources the footer's offline-use block and the head's stylesheet+theme-bootstrap tail across every main page. Use when editing the footer, the <head> tail, tools/stamp-footer.mjs, tools/stamp-head.mjs, or tools/partials/footer-shared.html.
---

## Single-sourced footer

The footer's **shared block** - the "Everything runs in your browser" heading plus
the whole "Download for offline use" section and its dependency list - is identical
on every main page, so it is single-sourced, not copy-pasted.

- **Source of truth:** `tools/partials/footer-shared.html` (the block exactly as it
  sits inside `<footer>`, 2-space indented). Edit it here, nowhere else.
- **Generator:** `tools/stamp-footer.mjs` (run by `save.bat` on every commit, before
  `git add`) stamps it into every page between `<!-- FOOTER:START -->` /
  `<!-- FOOTER:END -->` markers. **Never hand-edit between those markers** - the next
  `save.bat` overwrites it. Re-runnable and idempotent.
- **Scope:** the `PAGES` array in the generator — `index`, `about`, `patch`,
  `stats`, `privacy`, `formats`, `samples`, `compare`, `atari`. The per-format
  `/formats/<ext>` pages are deliberately excluded (they keep their own minimal
  footer).
- **What stays per-page:** everything *outside* the markers - crucially each page's
  own `<div class="footer-row footer-bottom">` (its `&larr; Main page` return button
  and page-specific links). The generator never touches it. So the offline block is
  universal while the bottom row is not.
- Adding a new main page: give its `<footer>` `class="site-footer site-footer--about"`,
  drop `<!-- FOOTER:START -->` / `<!-- FOOTER:END -->` inside it above the
  `.footer-bottom`, add its filename to `PAGES`, and run the generator.

## Single-sourced head

The `<head>` **tail** - the two stylesheet links plus the before-first-paint theme
bootstrap `<script>` - is byte-identical on every main page, so (like the footer)
it is single-sourced, not copy-pasted.

- **Source of truth:** `THEME_SCRIPT` in `tools/prerender-common.mjs` (the theme
  snippet). `tools/stamp-head.mjs` stamps it plus the stylesheet links into each
  page between `<!-- HEAD:START -->` / `<!-- HEAD:END -->` markers.
- **Generator:** `tools/stamp-head.mjs`, run by `save.bat` on every commit before
  `git add` (idempotent, re-runnable). **Never hand-edit between the markers.**
- **Scope:** almost the same `PAGES` as the footer (`index`, `about`, `patch`,
  `stats`, `privacy`, `formats`, `samples`, `compare`) — but with `test.html`
  instead of `atari.html` (test needs the theme bootstrap but keeps its own demo
  footer; atari keeps its own head). The per-format `/formats/<ext>` pages
  instead import `THEME_SCRIPT` directly in `prerender-format-pages.mjs`, so the
  theme snippet lives in exactly one place across all emitters.
- The theme `<script>` must stay byte-stable - it runs before paint to apply the
  saved/preferred theme without a flash, and is UX-sensitive.

(`save.bat`'s full generator order on each commit: prerender-samples →
prerender-formats → prerender-format-pages → stamp-counts → stamp-footer →
stamp-head → prerender-testpage, then `git add`.)
