# Analyser - website inconsistencies (master)

Consolidated from 7 parallel audits (one file each in this folder). Each covered a
different class of inconsistency, with file:line evidence:
- `content-copy.md` - spelling / em-dash / terminology / metric drift
- `meta-seo.md` - head/meta/structured-data parity
- `ui-markup.md` - shared header/nav/footer markup drift
- `catalog-data.md` - formats.js catalog vs parsers vs routing
- `code-conventions.md` - JS convention drift
- `cross-system-drift.md` - lists that must agree (SHELL/TIERS/pins)
- `a11y-routing.md` - headings/aria/links/routing

Nothing was changed - this is a findings list. Grouped by severity below; see the
per-area file for full detail and every file:line.

Overall: the site is in good shape. No em-dashes, spelling near-uniformly British,
canonicals/OG-title/theme-script/Share-SVG/page-drop all consistent, one h1 per
page, clean URLs, no dead internal links, no missing img alt. The real issues are a
handful of data bugs and several "meant-to-be-identical-but-drifted" blocks.

---

## HIGH - factual / functional (fix first)

1. **Two advertised formats silently fail** (`catalog-data.md`). Catalog tokens
   `truehd` and `capnproto` are listed in formats.js but the parser keys are `thd`
   and `capnp`, so these files **neither parse nor route - they drop to "unknown"**
   despite being shown as supported. Either fix the catalog token or add the alias.

2. **Stale offline tier sizes on the about page** (`content-copy.md`,
   about.html ~line 146/203). Body text still says "essentials (~48 MB) ... all OCR
   languages (~310 MB)" while the canonical sizes everywhere else (footer, index)
   are **50 MB / 78 MB / 325 MB**. Also keeps the `~` that was dropped elsewhere.
   This is hand-written prose the count-stamper doesn't touch.

3. **Per-format pages (1062 of them) drift from the main pages** (`meta-seo.md`,
   `ui-markup.md`, `a11y-routing.md`) - all from one template,
   `tools/prerender-format-pages.mjs`:
   - missing `og:image:width/height`, `og:image:alt`, `twitter:image:alt` (main
     pages have them);
   - drop the **Visitors** `.site-meta` row and render **Version as dead text**
     instead of the clickable `version-link` used everywhere else;
   - footer byline order flipped vs the shared footer.
   One template fix corrects all 1062 pages.

4. **Offline "Essentials" tier is not actually the whole app** (`cross-system-drift.md`).
   app.js `TIERS.essentials` omits **22 statically-imported modules** that sw.js
   SHELL caches (the 14 asteroids game modules, video-sync/sony-rtmd/gcsv, and 5
   NLE-project viewers), yet the in-code comment claims Essentials = whole app.
   Derive both from one source (see the refactor plan's Phase-1 item).

5. **Same-extension collisions in the catalog** (`catalog-data.md`). Five exts
   appear in two same-depth rows where full-wins dedup can't resolve them: `aepx`,
   `sql`, `shp`, `nsf`, `ts`. `nsf` is a true meaning-collision (Lotus Notes vs NES
   Sound Format) - decide which wins or split the routing.

6. **formats.html ItemList count mismatch** (`meta-seo.md`). The generated
   `CollectionPage`/`ItemList` category counts sum to ~1065 while `formatCount()` =
   1061 - some exts are counted under multiple category rows. Reconcile the per-
   category counts with the distinct-ext total.

---

## MEDIUM - quality / maintainability

7. **~30-40 parseable formats are missing from the catalog** (`catalog-data.md`):
   cdr, qxp, prc, aseprite, scrivx, e01, etc. exist in proprietary.js FORMATS (they
   parse) but aren't in formats.js, so they get no SEO page, aren't searchable, and
   aren't counted. Add the high-value ones.

8. **Catalog grouping bugs** (`catalog-data.md`): 2 orphan `CAT_OF` keys
   (`Documents`, `eBooks`) map nothing; all 10 `"(more)"` labels fall through to the
   `system` default, so GIS/science "(more)" rows are mis-grouped under System & disk.

9. **Header nav is bespoke per page** (`ui-markup.md`, `a11y-routing.md`): link sets
   vary (4 vs 5 links), **Privacy is missing** from index/about/patch/formats navs
   (footer-only), and the patch page is labelled **"Patches"** in nav but titled
   **"Changelog"** (and "Patch" elsewhere). Pick one label; standardise the nav set.

10. **`e-book` / `ebook` / `eBook`** used in all three forms (`content-copy.md`):
    body + footer use "e-book"; the new category label and many EXT_PAGES
    names/blurbs use "ebook"/"eBook". Pick one (house copy uses "e-book").

11. **Meta descriptions over 160 chars on 4 pages; privacy.html ships 3 divergent
    descriptions** (meta + og + twitter all different) (`meta-seo.md`). Trim and
    unify.

12. **Title separator mix** (`meta-seo.md`): mostly `X - Analyser` but some use
    `X | Analyser`. Standardise.

13. **Code-convention drift** (`code-conventions.md`):
    - renderer 2nd param `resultsEl` (~40 files) vs `container` (14 files);
    - 25 inline `new TextDecoder(...)` calls bypass binutil's `latin1`/`utf8`/`utf16`;
    - docx.js hand-builds `anr-error` divs 3x instead of `errorCard()` (used 77x);
    - parser-dispatch error asymmetry: built-in `PARSERS` call is **unwrapped** while
      the lazy-chunk call is try/caught (proprietary.js:3903 vs 3911-3917), so a
      built-in parser throw escapes the swallow - uneven per-chunk guarding too.

14. **US spelling**: "spiraled" -> "spiralled" (about.html:187) (`content-copy.md`).

---

## LOW - cosmetic / nice-to-have

15. **Prose count drift** (`content-copy.md`, `meta-seo.md`): about/formats say
    "1,000+" while index says "1061+". Harmless but unify the headline figure.
16. **a11y niceties** (`a11y-routing.md`): format-overlay close button `&times;` has
    no accessible name; dark-mode toggle has no `aria-label` (only "DAY" text); one
    overlay `<h3>` skips a heading level.
17. **Code cosmetics** (`code-conventions.md`): `export default` in
    ghostscript-loader.js (codebase is otherwise all named exports); navigate.js
    missing the `/* Analyser - */` banner (112/113 have it); app.js has a UTF-8 BOM.
18. **manifest.json `theme_color` is light-only** vs pages' light+dark
    (`cross-system-drift.md`).
19. **Footer link drift** (`a11y-routing.md`, `ui-markup.md`): the GitHub link is
    only on about.html; atari drops "Stats"; per-format pages drop "Patches".

---

## Verified clean (no action)
No em-dashes anywhere; British spelling uniform (one exception above); canonicals
self-referential and correct; OG-title == title and og-desc == meta-desc where
intended; theme-color / favicon / manifest link / theme bootstrap script identical
across pages; Share SVG + page-drop overlay byte-identical; generated FOOTER block
matches the partial; one h1 + lang="en" + labelled navs on every page; clean
extensionless URLs with no `.html` or dead internal links; extension casing
consistent; EXT_PAGES fully in sync with the catalog (0 orphans, 0 missing
full-analysis copy); SHELL <-> files <-> imports in sync; occt/ffmpeg/tesseract
version pins in sync; RELEASE_COMMITS in sync. atari.html's missing OG/canonical is
a deliberate easter-egg-page choice, not a regression.
