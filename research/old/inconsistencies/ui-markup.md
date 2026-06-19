# UI / HTML-markup inconsistencies across Analyser pages

Scope compared: `index.html`, `about.html`, `patch.html`, `stats.html`,
`privacy.html`, `formats.html`, `atari.html`, and the per-format page template in
`tools/prerender-format-pages.mjs` (and the generated `formats/<ext>.html` it
produces). Plus the footer partial `tools/partials/footer-shared.html`.

Findings are ranked by visible impact + maintenance risk. Nothing was modified.

---

## Page-by-page header nav link set (for reference)

| Page | Nav links (in order, before Share) |
|---|---|
| index.html:96-99 | About · Patches · Formats · Stats |
| about.html:149-152 | Home · Patches · Formats · Stats |
| patch.html:75-78 | Home · About · Formats · Stats |
| stats.html:62-66 | Home · About · Patches · Formats · **Privacy** |
| privacy.html:62-66 | Home · About · Patches · Formats · Stats |
| formats.html:65-68 | Home · About · Patches · Stats |
| atari.html:36-40 | Home · About · Patches · Formats · **Privacy** |
| format pages (generator :392-398) | Home · About · Formats · Stats |

The intent is clearly "all the sibling pages except the current one, plus Share".
Several pages quietly break that rule (below).

---

## 1. HIGH - `index.html` footer-bottom is missing the "Main page" return button vs all siblings

Every other main page's `.footer-bottom` opens with a return link
(`<a href="/" class="footer-nav-btn">&larr; Main page</a>` on about/patch/stats/
privacy/atari/formats; `&larr; All formats` on the per-format pages). `index.html`
omits it, which is intentional (you are already on the main page) - **but** note
`index.html` is the only main page whose `.footer-bottom` has no leading
`footer-nav-btn` at all, so the row's flex layout differs from every sibling.
Likely fine, listed for completeness.

- index.html:331-333 (no `footer-nav-btn`)
- vs about.html:472-473, stats.html:209-210, privacy.html:202-203, patch.html:1374-1375.

## 2. HIGH - Per-page nav-link sets are inconsistent: Privacy is reachable from only 2 of 8 pages

The header nav is supposed to link to the other sibling pages. But the `/privacy`
link appears in the header nav of **only** `stats.html:66` and `atari.html:40`.
It is absent from index, about, patch, formats, and the per-format template -
even though privacy is a real top-level page. Symmetrically, `stats.html` and
`atari.html` are the only two that *include* Privacy, and they do so by **dropping
nothing** (they carry 5 links where the others carry 4), so the two pages have a
visibly longer nav strip than the rest.

Also: `formats.html:65-68` is the only main page whose nav **omits its own
neighbour set inconsistently** - it lists Home·About·Patches·Stats but **drops
Formats** (correct, it's the current page) yet **also silently drops the chance to
link Privacy** like the others. Net effect: the nav link set is bespoke per page
with no single rule, so adding/removing a page means hand-editing 8 files.

- Privacy present: stats.html:66, atari.html:40
- Privacy absent: index.html:96-99, about.html:149-152, patch.html:75-78, formats.html:65-68, generator prerender-format-pages.mjs:393-396

## 3. HIGH - Label drift: "Patches" vs the page titled "Changelog"

The nav button label is **"Patches"** everywhere (index.html:97, about.html:150,
stats.html:64, privacy.html:64, formats.html:67, atari.html:38, generator has no
Patches link). But the patch page's own `<h1 class="site-title">` is
**"Changelog"** (patch.html:71), and its `<dt>Version</dt>` link and the footer
"Supported file types"/version links all point at `/patch`. So the same
destination is called "Patches" in nav, "Changelog" as the page title, and
`/patch` in the URL. Pick one user-facing noun. (Not a bug, but a visible
inconsistency.)

## 4. HIGH - The `.site-meta <dl>` row set is inconsistent across pages

Two distinct dl shapes are in use:

**Shape A (5 rows, with Visitors):** index.html:104-110, stats.html:71-77,
privacy.html:71-77, formats.html:73-79, atari.html:45-51 - and notably
**about.html:157-163** and **patch.html:82-89 do NOT have it...** wait, they do.
Concretely:

- **Has the `Visitors` row** (`<dt class="visit-stat">Visitors</dt>`):
  index.html:106, about.html:159, stats.html:73, privacy.html:73, formats.html:75,
  atari.html:47. (Note patch.html does too - patch.html:85.)
- **Omits the `Visitors` row entirely:** the **per-format page template**
  (`prerender-format-pages.mjs:401-406`) - its dl is Version / Status / Other
  stuff / Dark mode only. So `formats/<ext>.html` shows a 4-row meta block while
  every hand-authored page shows 5. Visible difference in the header sidebar.

**Version-link markup also drifts:** every hand-authored page renders Version as a
link - `<dd><a href="/patch" id="versionNum" class="version-link" ...>0.00</a></dd>`
(e.g. index.html:105, about.html:158). The **per-format template** renders it as a
**non-link** `<dd id="versionNum">0.00</dd>` (prerender-format-pages.mjs:402) - no
`<a>`, no `version-link` class, not clickable. So on /formats/<ext> the version is
dead text; everywhere else it links to the changelog.

This is the single biggest structural drift: the generated pages (hundreds of
them) have a materially different header meta block from the hand-authored pages.

## 5. MEDIUM - Primary `.site-nav` strip present on some pages, absent on others

`<nav class="site-nav">` (the sticky section-nav strip under the header) exists on:
index.html:115, about.html:168, formats.html:84, and every `formats/<ext>.html`
(generator :411 via `siteNav()`). It is **absent** on patch.html, stats.html,
privacy.html, atari.html. This is mostly intentional (those pages have no section
anchors), but it means the header-to-content vertical rhythm differs page to page,
and the CSS rule `body:has(.about-page) .site-nav` is relied on by the generator
(prerender-format-pages.mjs:113-116 comment) - a structural coupling worth noting.

`about.html`'s site-nav (about.html:169-173: Why/Where/What/How/FAQ) and
`index.html`'s (index.html:116-122: Photo/Sound/Video + search) are page-specific
and correct - not drift.

## 6. MEDIUM - `formats.html` hub nav is a one-off variant

`formats.html:84` uses `<nav class="site-nav format-nav formats-hub-nav"
aria-label="Discover formats">` containing only an "I'm feeling lucky" button,
whereas the per-format pages use `<nav class="site-nav format-nav"
aria-label="Browse file types">` with Prev / Lucky / Next (generator :122). Same
base classes, three different `aria-label` strings across the formats family
("Discover formats" vs "Browse file types" vs the main "Primary"). Minor a11y/label
drift.

## 7. LOW - `.footer-bottom` content varies per page (mostly intentional, one oddity)

The bottom row's secondary links differ per page by design, but the variety is wide
and the per-format pages reverse the byline order:

- index.html:332 / about.html:474 / etc.: `valjdakosta.com &middot; 2026`
- **per-format pages** (generator :443): `2026 &middot; valjdakosta.com` - **year
  first, order flipped** from every other page.
- about.html:476 is the **only** page with a `Source on GitHub ↗` link in the
  footer; no other page has it.
- Secondary-link sets differ: index has "Supported file types · Stats · Privacy"
  (index.html:333); stats has "Supported file types · Privacy" (stats.html:212);
  privacy has "Stats · Supported file types" (privacy.html:205, order flipped);
  patch (patch.html:1377) and about (about.html:475) have only "Supported file
  types". No single rule.

Year is `2026` everywhere (no stale-year bug found). The generator stamps `2026` as
a **hardcoded literal** (prerender-format-pages.mjs:443) while it computes `TODAY`
from `new Date()` for the sitemap (:48-49) - so the footer year will silently go
stale in 2027 unless edited, whereas the sitemap won't.

## 8. LOW - `footer-contact` line present on most pages, absent on a couple

`footer-contact` "Email me!" button: present on index.html:336, atari.html:171,
stats.html (via the Turnstile comment block), privacy, formats, and every
per-format page (generator :444). **about.html** ends its footer-bottom with the
GitHub link and the contact line (about.html:478+, after the Turnstile comment),
**patch.html** keeps it. No page is actually missing it, but the ordering of the
last two `<p class="footer-meta">` lines varies (GitHub vs contact vs supported
types) page to page.

---

## Items verified IDENTICAL (no drift) - good news

- **Inline Share SVG**: byte-identical on index.html:100, about.html:153,
  patch.html:79, stats.html:67, privacy.html:67, formats.html:69, atari.html:41,
  and the generator's `SHARE_SVG` constant (prerender-format-pages.mjs:129). Same
  viewBox `0 0 50 50`, same 5 paths. No drift.
- **`page-drop` overlay**: identical block on every page (index.html:80-86,
  about.html:133-139, patch.html:59-65, stats.html:46-52, privacy.html:46-52,
  formats.html:49-55, atari.html:20-26, generator :377-383). Same markup, same
  copy ("Drop anywhere" / "Photo, sound, video, or anything else. I'll figure it
  out").
- **Theme `<script>`** (the no-FOUC dark-mode bootstrap): byte-identical on every
  page including the generator (index.html:76, ..., prerender-format-pages.mjs:373).
- **Footer FOOTER:START/END block**: the generated region matches the partial
  `tools/partials/footer-shared.html` on the 6 stamped pages (about/patch/stats/
  privacy/formats/index) and atari.html (atari.html:84-166). The per-format pages
  deliberately use a minimal footer (no offline block) per CLAUDE.md - that is by
  design, not drift.
- **`site-kicker` codes** are unique per page (`A 01 - 03`, `A 02 - 07`,
  `Z 21 - 47`, `A 04 - 06`, `A 05 - 07`, `F 01 - 12`, `Arcade`) - intentional, not
  an error.

---

## Top fixes by leverage

1. **Per-format template (#4)** - give `formats/<ext>.html` the same 5-row meta dl
   and the clickable `version-link` markup the hand-authored pages use
   (prerender-format-pages.mjs:401-406). Highest leverage: one edit fixes hundreds
   of pages. Also flip the footer byline to `valjdakosta.com &middot; 2026` and
   derive the year (#7).
2. **Nav link set (#2)** - decide a single rule (e.g. always link all siblings
   except self, including Privacy) and apply across all 8 surfaces; or single-source
   the nav like the footer already is.
3. **"Patches" vs "Changelog" (#3)** - unify the label.
