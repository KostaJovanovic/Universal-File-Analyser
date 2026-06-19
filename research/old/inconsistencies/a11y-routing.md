# Accessibility / Semantic / Link-Routing audit — Analyser

Scope: `index.html`, `about.html`, `patch.html`, `stats.html`, `privacy.html`,
`formats.html`, `atari.html`, and the per-format template in
`tools/prerender-format-pages.mjs` (verified against a generated sample,
`formats/stl.html`). No source files were modified.

**Overall:** the site is in good a11y/routing shape. Every page has exactly one
`<h1>`, `lang="en"`, an `aria-label`led page nav, clean internal URLs, and no
dead internal links found. The findings below are mostly low-impact polish, with
two genuine cross-page inconsistencies worth flagging.

---

## 1. Heading hierarchy

Exactly **one `<h1>` per page** on all 7 pages and on the generated format
template — good (verified by count).

- index.html:92 `<h1 class="site-title">Analyser</h1>`
- about.html:145 / patch.html:71 / stats.html:58 / privacy.html:58 /
  formats.html:61 / atari.html:32 — one each.
- format template: `prerender-format-pages.mjs:389` `<h1 class="site-title">.${d}</h1>`

**Level-skip (low impact):** the "Supported formats" overlay heading is an
`<h3>` that sits as a sibling of the page's `<h2>` sections, with no intervening
`<h2>`, so the document jumps h1 → h2 → h3 (and on the home page the overlay's
h3 is the first/only h3, reachable by AT even while the overlay is `hidden`):
- index.html:173 `<h3>Supported formats …`
- about.html:373 `<h3>Supported formats …`
  Could be an `<h2>` (or the overlay given its own labelled region). Cosmetic for
  sighted users; matters only to heading-navigation AT users.

**stats.html** is clean: h1 → h2 ("Live usage") → h3 ("Most-dropped
extensions", "High scores"). **privacy.html** uses h1 then three sibling `<h2>`s
(no h3) — fine. **about.html** h1 → 6×h2 → the overlay h3 — fine apart from the
overlay note above.

## 2. `lang` attribute

**Consistent.** Every page and the generated template declares
`<html lang="en">`:
- index.html:2, about.html:2, patch.html:2, stats.html:2, privacy.html:2,
  formats.html:2, atari.html:2, `prerender-format-pages.mjs:335`.
No missing or differing `lang`. (Note: `og:locale` is `en_GB` everywhere, which
is consistent with the British-spelling content convention; `lang="en"` rather
than `en-GB` is acceptable.)

## 3. ARIA / labels on nav and icon controls

**`<nav>` labelling — consistent and present:**
- Page-switcher nav: `aria-label="Pages"` on every page header
  (index.html:95, about.html:148, patch.html:74, stats.html:61,
  privacy.html:61, atari.html:35) **except formats.html:64 which also uses
  `aria-label="Pages"`** — consistent.
- Section/anchor nav `aria-label="Primary"` (index.html:115, about.html:168).
- formats.html:84 hub nav uses `aria-label="Discover formats"`; the generated
  per-format prev/next nav uses `aria-label="Browse file types"`
  (`prerender-format-pages.mjs:122`). Distinct labels for distinct navs — good.

**Icon-only / icon controls — accessible names present but labelled
inconsistently (low-medium impact):**
- **Share button** has NO `aria-label`; it relies on the trailing visible text
  "Share" after the SVG (`…aria-hidden="true" focusable="false"></svg>Share`)
  — index.html:100, about.html:153, patch.html:79, stats.html:67,
  privacy.html:67, atari.html:41, template `prerender-format-pages.mjs:397`.
  This is fine (the SVG is correctly `aria-hidden`/`focusable="false"` and the
  text supplies the name), and it is consistent across pages.
- **Dark-mode toggle** `#darkToggle` has NO `aria-label`; its accessible name is
  the literal toggle text `☀︎ DAY` (the `&#9728;&#65038; DAY` content) —
  index.html:109 and the same on every page. Inconsistency of *kind*: this is
  the one icon control whose name is a state string ("DAY") rather than an
  action verb, and it has no `aria-label`. AT reads "DAY" with no indication
  it's a theme switch. Low-medium impact; an `aria-label="Toggle dark mode"`
  would be the consistent fix (compare the offline `[?]` and `Search` controls,
  which DO carry explicit `aria-label`s — see below).
- **Format-overlay close** `#fmtOverlayClose` is `&times;`-only with **no
  `aria-label`** (index.html:174, about.html:374). This is the one genuinely
  icon-only control lacking an accessible name — AT announces "times / multiply"
  or nothing. **Medium impact.** Contrast with the back-bar / scroll buttons
  which do have labels (index.html:168 `aria-label="Scroll to the analysis"`,
  index.html:159 `aria-label="Supported formats"`).
- Controls that **do** carry explicit `aria-label` (good, shows the intended
  convention): nav search button index.html:120 `aria-label="Search"`; offline
  `[?]` summary index.html:263 `aria-label="What each download includes"`;
  fmt-help button index.html:159 `aria-label="Supported formats"`; atari reset
  atari.html:70 `aria-label="Clear cache and reload"`.

**Inconsistency summary for the SAME control across pages:** none — every shared
control (Share, dark toggle, close, offline toggle) is labelled identically on
every page. The inconsistency is *between* controls (some get `aria-label`,
some rely on text/state), not across pages.

## 4. alt text / decorative SVG

- **No `<img>` elements** in any of the audited HTML pages (all imagery is CSS
  background / inline SVG / favicons), so there are no missing `alt`s.
  (`og:image:alt` is present in every page head, e.g. index.html:20.)
- **Decorative inline SVGs are consistently hidden:** the Share glyph carries
  both `aria-hidden="true"` and `focusable="false"` everywhere
  (index.html:100, template :397); the offline "crown" SVG and search SVG use
  `aria-hidden="true"` (index.html:280, :120). The `page-drop-icon`, drop `+`
  icons and back-arrow spans are all `aria-hidden="true"`. Consistent.

## 5. Internal link / routing consistency

**Clean URLs everywhere — no `.html` internal links found.** All nav/footer/
in-body internal links use extensionless routes: `/about`, `/patch`, `/formats`,
`/stats`, `/privacy`, `/`, `/formats/<ext>`, `/formats/id/<ext>` (e.g.
index.html:96-99, about.html:244/248/252/260/264/268, formats.html:120-131).
No mixed trailing slashes on internal routes; the only trailing slash is on the
external `https://link.valjdakosta.com/` and `https://valjdakosta.com/`, which is
consistent. All internal links are root-relative (no `http://`).

**Asset-path convention differs by page depth (correct, but worth noting):**
- Root pages use **relative** asset paths: `href="assets/css/analyser.css"`,
  `src="assets/js/core/app.js"`, `register('sw.js')` (index.html:74-75,344,362).
- The generated per-format pages (served from nested `/formats/<ext>`) correctly
  switch to **root-absolute** paths: `/assets/css/…`, `/assets/js/…`,
  `register('/sw.js')` (template `prerender-format-pages.mjs:371-373,448-449,461`).
  This is the right split (relative would break one level deep), and it matches
  the CLAUDE.md note. No bug — documented here only because the two conventions
  coexist deliberately.

## 6. Link-target validity (spot-check)

- Every in-body `/formats/<ext>` link in about.html (docx, xlsx, pptx, pdf,
  mobi, epub, stl, obj, glb, step, dwg, dxf, psd, ai, svg, gpx, eml, heic, arw)
  resolves to a real `formats/<ext>.html` file. **All present.**
- Every in-body `/formats/id/<ext>` link in about.html (pcap, kdbx, dcm, nii,
  fits) resolves to a real `formats/id/<ext>.html`. **All present.**
- Footer/nav routes `/about /patch /formats /stats /privacy /` all map to real
  files. `/atari` exists (`atari.html`, `noindex`) but is intentionally not
  linked from any page nav — not a dead link, just an unlinked easter-egg page.
- **No dead internal links found.**

## 7. Cross-page nav-set consistency — TWO real inconsistencies

The header page-nav is "current page omitted, others linked." That rule is
followed, but the *set* of pages offered is **not uniform** — Privacy and Stats
are swapped in and out arbitrarily:

| Page header nav offers | Home | About | Patches | Formats | Stats | Privacy |
|---|---|---|---|---|---|---|
| index.html:96 | (self) | ✓ | ✓ | ✓ | ✓ | **✗** |
| about.html:149 | ✓ | (self) | ✓ | ✓ | ✓ | **✗** |
| patch.html:75 | ✓ | ✓ | (self) | ✓ | ✓ | **✗** |
| formats.html:65 | ✓ | ✓ | ✓ | (self) | ✓ | **✗** |
| stats.html:62 | ✓ | ✓ | ✓ | ✓ | (self) | **✓** |
| privacy.html:63 | ✓ | ✓ | ✓ | ✓ | ✓ | (self) |
| atari.html:36 | ✓ | ✓ | ✓ | ✓ | **✗** | **✓** |
| format template :392 | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ |

**Finding 7a (medium impact):** **Privacy is unreachable from the header nav of
index, about, patch, and formats** — it only appears in the headers of stats and
atari. From the four most-visited pages, the only path to Privacy is the footer
(and it's not even in every footer bottom-row — see 7c). A user on the home page
cannot reach Privacy via the header.

**Finding 7b (low impact):** **atari.html drops "Stats" from its header**
(atari.html:36 lists Home/About/Patches/Formats/Privacy but not Stats), the only
page to do so. atari is `noindex` and unlinked, so low impact, but it's an
outlier.

**Finding 7c (low impact):** footer bottom-row link sets are also non-uniform:
- index.html:333 footer: Formats · Stats · Privacy, **and has no "← Main page"
  return button** (it IS the main page — correct).
- about.html:475-476 footer adds a **"Source on GitHub"** link
  (`https://github.com/KostaJovanovic/lab`) — this link appears on **about.html
  only**, on no other page's footer. Inconsistent.
- patch.html:1377 footer lists only "Supported file types" (no Stats/Privacy).
- privacy.html:205 lists Stats · Supported file types (no Patch/About).
- stats.html:212 lists Supported file types · Privacy.
These are outside the single-sourced `<!-- FOOTER -->` block (per CLAUDE.md the
bottom row is intentionally per-page), so the variance is by-design — but the
GitHub link being about-only and Privacy missing from several footers are the
notable gaps.

**Note (format template):** the per-format pages omit "Patches" from the header
nav (template :392-398, Home/About/Formats/Stats) and omit the Visitors stat
from the meta `<dl>` (template :400-407 — no `visit-stat` row, and Version is a
plain `<dd id="versionNum">` not a `/patch` link as on the main pages,
template :402 vs index.html:105). Intentional trimming for the long-tail pages,
but it means the version number on per-format pages is not click-through to the
changelog and offers no Patches/Stats/Visitors entry point. Low impact.

---

## Ranked by user/accessibility impact

1. **Format-overlay close button `#fmtOverlayClose` has no accessible name**
   (`&times;` only) — index.html:174, about.html:374. *(a11y, medium)*
2. **Privacy page is missing from the header nav of index/about/patch/formats**
   — reachable only via footer from the main pages. *(routing, medium)*
3. **Dark-mode toggle has no `aria-label`; its name is the state string "DAY"**
   — every page (index.html:109 et al.). *(a11y, low-medium)*
4. **Overlay heading is `<h3>` with no parent `<h2>`** (heading-level skip)
   — index.html:173, about.html:373. *(a11y, low)*
5. **"Source on GitHub" footer link exists only on about.html** — about.html:476.
   *(consistency, low)*
6. **atari.html header nav drops "Stats"** — atari.html:36. *(consistency, low)*
7. **Per-format pages drop Patches from nav and the Version→/patch link**
   — template :392-407. *(consistency, low)*

No dead internal links, no missing `lang`, no missing `<img alt>`, no `.html`
internal links, and exactly one `<h1>` per page.
