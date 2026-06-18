# Refactor assessment - HTML pages & `tools/` generator pipeline

Scope: the 7 hand-authored pages (`index`, `about`, `patch`, `stats`, `privacy`,
`formats`, plus `atari.html`) and the 6 generator scripts in `tools/`. The
generated `formats/<ext>` pages are produced by `prerender-format-pages.mjs` and
are out of scope as *source* (they already template the SVG/head via that one
script - see `SHARE_SVG`, `prerender-format-pages.mjs:129`).

Hard constraint that frames everything below: **no build step, no
`node_modules`, no framework** (CLAUDE.md). The site ships the `.html` files
*as written* to Cloudflare. Any "single-source the head" must therefore be a
**stamp generator run by `save.bat`** (the same pattern as `stamp-footer.mjs`) -
writing into in-file markers - NOT a runtime include, partial loader, or build
transform. The HTML on disk stays the artifact that's served.

Items are ranked by **value / risk**.

---

## 1. Stamp the shared `<head>` boilerplate from a partial - HIGH value / LOW-MED risk

### The duplication (measured)
Every one of the 7 pages repeats an almost-identical ~40-line `<head>`. Per page,
these blocks are byte-identical *except* for the per-page title/description/canonical/OG-url:

- **Theme-color pair** - 2 lines, identical on all 7
  (`index.html:9-10`, `about.html:9-10`, `patch.html:9-10`, `stats.html:9-10`,
  `privacy.html:9-10`, `formats.html:9-10`).
- **Favicon / apple-touch / manifest links** - 4 lines, identical on all 7
  (`index.html:26-29` and the matching `:26-29` / `:26-29` / `:26-29` /
  `:40-41`+`26-29` ranges on the others).
- **Stylesheet links** - 2 lines, identical
  (`index.html:74-75`, `about.html:72-73`, `patch.html:53-54`, etc.).
- **The inline theme `<script>`** - one ~330-char line, **byte-identical on all
  7 pages and on every generated per-format page**
  (`index.html:76`, `about.html:74`, `patch.html:55`, `stats.html:42`,
  `privacy.html:42`, `formats.html:45`, and `prerender-format-pages.mjs:373`).
  This is the single worst offender: a security/UX-sensitive snippet copied 7+
  times by hand, with a *second authoritative copy* embedded in a generator
  string. Any change (e.g. tuning the 7-day `604800000` TTL) is a 8-site edit
  today.
- **OG/Twitter scaffolding** - `og:type`/`og:site_name`/`og:locale` (3 lines,
  identical), plus the OG image block (`og:image` + width/height/alt, 4 lines,
  identical: `index.html:17-20` etc.) and `twitter:card` + `twitter:image` +
  `twitter:image:alt` (identical). Only `og:title`/`og:description`/`og:url` and
  the twitter title/desc are genuinely per-page.

So per page roughly **25-30 of the ~40 head lines are pure boilerplate**; ~10 are
real per-page content (title, description, canonical, the 3 OG text fields, the
JSON-LD).

### Proposal
Add `tools/partials/head-shared.html` (the invariant lines: theme-color, the
icon/manifest links, the two stylesheet links, the inline theme script) and a
`tools/stamp-head.mjs` that rewrites a `<!-- HEAD:START -->...<!-- HEAD:END -->`
region on each page - **exactly** the proven `stamp-footer.mjs` mechanism
(`stamp-footer.mjs:36-52`: lazy marker regex, function replacer so `$` is safe,
idempotent, `missing[]` warning). Register it in the `PAGES`-style list and add
one line to `save.bat` before `git add`.

Two design choices keep risk low:
- **Stamp only the invariant block**, leaving title/description/canonical/OG-text/
  JSON-LD hand-authored outside the markers (same split `stamp-footer` already
  uses for the per-page `.footer-bottom`). This avoids needing a per-page data
  table and keeps the diff surface tiny.
- **Export the theme script from one place** and have *both* `stamp-head.mjs`
  and `prerender-format-pages.mjs` import it (kill the `:373` second copy), so
  the generated pages stop carrying an independent hand-pasted twin. A shared
  `THEME_SCRIPT` const in `prerender-common.mjs` is the natural home (see item 4).

### Trade-off / risk
- The served HTML's head is no longer hand-authored between the markers - same
  "never hand-edit between markers" rule the footer already imposes. Acceptable;
  it's an established convention here.
- The inline theme script must run **before first paint** to avoid a
  light->dark flash; stamping doesn't change ordering as long as the markers sit
  where the script sits today (last in `<head>`). Verify the marker placement
  keeps it after the stylesheet links.
- Medium (not low) only because the head is render-critical and SEO-critical:
  a bad stamp that drops `<link rel=canonical>` or the OG image hurts more than a
  footer glitch. Mitigate with the same `missing[]`/marker-not-found warning
  `stamp-footer` prints (`stamp-footer.mjs:54-56`) and a quick `server.bat`
  smoke check. Net: highest payoff in the codebase (removes the largest, most
  dangerous copy-paste), low mechanical risk because the pattern is already in
  production.

---

## 2. Repeated `<header>` / nav / `<dl>` meta markup across pages - MED value / MED risk

The entire `<header class="site-header">` block (the `.site-mark`, the
`.site-mark-nav` button row, and the `.site-meta` `<dl>`) is ~25 lines repeated
on all 7 pages with only small per-page variation:

- `index.html:88-113`, `about.html:86-111`, `patch.html:67-92`,
  `stats.html:54-80`, `privacy.html:54-80`, `formats.html:57-82`
  (and `prerender-format-pages.mjs:385-409` builds the same shape a 7th way).
- **Invariant across pages**: the `.site-byline`, the `.site-sub` text on most
  pages, the whole `.site-meta` `<dl>` (Version/Visitors/Status/Other stuff/Dark
  mode - identical on `index/about/patch/stats/privacy/formats`), and the share
  `<button>`+SVG.
- **Per page**: `site-kicker` (`A 01 - 03`, `A 02 - 05`, `Z 21 - 47`...),
  `site-title`, an optional `site-mark--changelog`/`--privacy` modifier, the
  `.site-sub` wording on a couple of pages, and **which nav button is omitted**
  (each page drops its own link: home omits "Home", stats swaps in "Privacy",
  etc.).

The `.site-meta` `<dl>` in particular is fully identical on 6 pages and is the
clean win. The nav button row is *nearly* identical but each page hides its own
current page - templatable with a `current` param (the generator could mark the
active page and emit the rest), but that's the part carrying the variation.

### Proposal
Extend the same stamp approach: `tools/partials/header-shared.*` with marker
regions. Two sub-options, in increasing ambition:
1. **Low-risk slice**: stamp only the `.site-meta` `<dl>` (lines like
   `index.html:103-111`) - fully invariant on 6 pages, zero per-page data
   needed. Small, safe, removes a real 6x copy.
2. **Fuller slice**: stamp the whole header from a small per-page data table
   (kicker, title, sub, modifier class, current-page key) keyed by filename in
   the generator. More code-dedup but introduces a data table and the "active
   nav link" logic - more places to get a page wrong.

### Trade-off / risk
Higher risk than the head because the header is **structurally per-page** (every
page legitimately differs in kicker/title/active-link), so a naive single-source
needs a parameter table - that table is itself a thing to maintain and a thing
that can drift. Recommend doing **only sub-option 1 (the `.site-meta dl`)** now
and leaving the nav row hand-authored, unless header edits become frequent. The
`page-drop` overlay block (`index.html:80-86` etc., identical on all 7) is an
even safer trivial add to the same stamp pass.

---

## 3. Repeated inline share SVG (and the search SVG) - LOW-MED value / LOW risk

The share-icon `<svg>` (the ~600-char `viewBox="0 0 50 50"` path soup in the
share button) is byte-identical across all 7 hand pages
(`index.html:100`, `about.html:98`, `patch.html:79`, `stats.html:67`,
`privacy.html:67`, `formats.html:69`) **and** is already factored to a `SHARE_SVG`
constant inside `prerender-format-pages.mjs:129` for the generated pages - so the
codebase already acknowledges this is shareable; it just didn't reach the hand
pages. The nav search SVG (`index.html:120`) is a smaller, single-page case.

### Proposal
If item 1 or 2 ships, the share SVG rides along for free inside the stamped
header/nav region (it lives in `.site-mark-nav`). No separate effort. The
`SHARE_SVG` const in `prerender-format-pages.mjs` should then be promoted to
`prerender-common.mjs` and imported by both, so there's exactly one copy of the
path data in the whole repo (item 4). Standalone value is low (icons rarely
change); value is realised as a side effect of items 1-2.

### Trade-off / risk
Effectively none if bundled with item 2. As a standalone "stamp just the SVG"
job it's not worth its own marker pass.

---

## 4. Generator-pipeline consolidation - MED value / LOW risk

### Findings
- **`prerender-common.mjs` is underused but correctly scoped.** It currently
  holds only `esc`/`escAttr` and the full-vs-id routing (`buildFullKeys`,
  `makeHrefOf`), shared by the two prerender scripts (`prerender-formats.mjs:22`,
  `prerender-format-pages.mjs:39`). That's good. But several things that *should*
  live there are duplicated instead:
  - The **`TODAY` local-date snippet** is reimplemented in both
    `prerender-format-pages.mjs:48-49` and `stamp-counts.mjs:33-34` (same
    `getFullYear/padStart` recipe). Hoist a `today()` helper.
  - The **`pathToFileURL(... formats.js).href` dynamic import** of the catalog
    is repeated in all three catalog-reading scripts
    (`prerender-formats.mjs:29`, `prerender-format-pages.mjs:51`,
    `stamp-counts.mjs:27`). A `loadCatalog()` helper in common would centralise
    the Windows-path-to-ESM-URL gotcha (already commented at
    `prerender-formats.mjs:28`).
  - The **theme `<script>`** and **`SHARE_SVG`** (items 1, 3) belong here too.
- **The four `tools/*.mjs` scripts share no pass-runner.** `stamp-counts.mjs`
  and `stamp-footer.mjs` both implement the same shape independently: read file,
  run regex/marker replacement, write only if changed, count `changed`, warn on
  missing (`stamp-counts.mjs:64-81`, `stamp-footer.mjs:43-57`). A tiny shared
  `stampFile(path, passes)` / `stampRegion(html, start, end, block)` in
  `prerender-common.mjs` would let `stamp-counts`, `stamp-footer`, and a future
  `stamp-head` (item 1) all reuse one idempotent, change-tracking writer. This
  is the enabling refactor for item 1 - do it first.
- **`save.bat` ordering coupling is real and currently load-bearing.** The four
  Node scripts MUST run in this order (`save.bat:73,79,86,94`):
  1. `prerender-formats.mjs`  2. `prerender-format-pages.mjs`
  3. `stamp-counts.mjs`  4. `stamp-footer.mjs`.
  The ordering matters because `stamp-counts.mjs` edits the **footer partial**
  `tools/partials/footer-shared.html` (`stamp-counts.mjs:57`) and must run
  **before** `stamp-footer.mjs` stamps that partial into pages - this dependency
  is documented in-code (`stamp-counts.mjs:46-48`) but enforced only by line
  order in a `.bat`. Likewise `stamp-counts` rewrites `formats.html`
  (`stamp-counts.mjs:52`) which `prerender-formats` also rewrites, so
  prerender-first is required too. Adding `stamp-head` (item 1) inserts another
  node into this implicit DAG.

### Proposal
- Move `today()`, `loadCatalog()`, `THEME_SCRIPT`, `SHARE_SVG`, and a
  `stampFile()/stampRegion()` helper into `prerender-common.mjs`. Low risk -
  these are pure extractions of code that already exists and is already tested by
  every commit.
- Replace the 4 separate `node tools/...` lines + 4 `if errorlevel 1` blocks in
  `save.bat` with a **single `tools/build.mjs` orchestrator** that imports and
  runs the passes in the correct, *encoded* order (so the
  stamp-counts-before-stamp-footer dependency lives in code, not in `.bat` line
  order), prints one summary, and exits non-zero on hard failure. `save.bat`
  then calls one script. This removes the ordering footgun and the per-step
  boilerplate, and makes "add `stamp-head`" a one-line insertion in a place where
  the dependency is visible.

### Trade-off / risk
Low. It's mechanical extraction plus one orchestrator. The only caveat: keep each
pass independently runnable (`node tools/stamp-footer.mjs` is referenced in
CLAUDE.md and docstrings as a standalone command), so the orchestrator should
*compose* exported functions rather than shell out, and the individual files
should keep a `if (isMain) run()` guard so the documented standalone invocations
still work. Verify with a single `save.bat commit` dry run + `server.bat`.

---

## Recommended order of execution

1. **Item 4 (pipeline helpers + `stampFile`/orchestrator)** first - it's the
   low-risk enabler and removes the `save.bat` ordering footgun on its own.
2. **Item 1 (stamp the shared `<head>` + single-source the theme script)** -
   highest payoff, rides on the `stampFile` helper from step 1, and finally kills
   the 8-site theme-script copy.
3. **Item 3** falls out of items 1/2 for free (promote `SHARE_SVG` to common).
4. **Item 2 (header)** last and **only the `.site-meta dl` + `page-drop` slice**
   unless header churn justifies the fuller per-page data table.

Everything stays within the build-free constraint: all of it is `save.bat`-time
stamping into in-file markers, exactly like the footer single-sourcing already in
production (`stamp-footer.mjs`).
