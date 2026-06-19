# Analyser - Technical SEO Audit (current state)

Research note for a later optimisation plan. Site: zero-backend, browser-only
file analyser deployed to Cloudflare at `lab.valjdakosta.com`. Evidence is quoted
from the actual files; nothing here was modified.

Scope inspected: `index.html`, `about.html`, `patch.html`, `stats.html`,
`privacy.html`, `formats.html`; sample generated pages `formats/heic.html`,
`formats/id/yara.html`, `formats/atari.html`; `sitemap.xml`,
`sitemap-formats.xml`, `robots.txt`, `manifest.json`, `llms.txt`; generators
`tools/prerender-formats.mjs`, `tools/prerender-format-pages.mjs`,
`tools/stamp-counts.mjs`.

---

## 1. Per-page audit

All six main pages share: `<html lang="en">`, charset, viewport, canonical,
dual `theme-color`, full Open Graph block (`og:type`, `og:site_name`,
`og:locale=en_GB`, title, description, url, image 1200x630, image:alt on most),
Twitter `summary_large_image` card, favicons, manifest link. Every page has
**exactly one `<h1>`** (verified). No `<img>` tags exist on any main page (the
header wordmark is CSS text, share/icons are inline `<svg>` with `aria-hidden`),
so there are **no missing alt attributes** - the OG/Twitter banner is the only
raster image and it carries `og:image:alt`. No `meta keywords` anywhere (correct;
deprecated). Semantic HTML is good: `<header>`, `<nav aria-label>`, `<main>`,
`<section>`, `<footer>`, `<dl>` definition lists.

### index.html (`/`)
- **Title** (47 chars): `Analyser - Open and Inspect Any File in Your Browser` - good.
- **Description** (quoted): `"View EXIF, spectrograms, video frames & metadata for 1061+ file types in your browser. No ads, no telemetry, no upload - everything stays on your device."` - 156 chars, well-formed.
- **Canonical**: `https://lab.valjdakosta.com/` - correct.
- **OG/Twitter**: full, with image:alt. Good.
- **JSON-LD**: two blocks - `WebApplication` (name, url, description, `applicationCategory: MultimediaApplication`, `operatingSystem`, `browserRequirements`, image, `isAccessibleForFree`, `offers` price 0, `author` Person, 6-item `featureList`) and `WebSite` with a `SearchAction` `potentialAction` (`urlTemplate: .../?q={search_term_string}`). Strong, the richest page.
- **H1**: `Analyser` (1). Section headings are `<h2 class="section-head">` ("See every byte of metadata...", etc.). Good hierarchy.
- **Internal links**: header nav to /about /patch /formats /stats; footer to /formats /stats /privacy. Good.
- **Issue**: the `SearchAction` `urlTemplate` points at `/?q=...` but there is no evidence the app consumes a `q` query param to drive a search result (the search is client-side over format metadata). Likely a non-functional sitelinks-searchbox claim.
- **Issue (count drift)**: overlay heading still hardcodes a stale `740`: `<h3>Supported formats <span class="fmt-overlay-count" data-fmt-count="bare">740</span></h3>` (line 170), while the same page's meta says `1061+`. JS overwrites it at runtime, but the baked HTML a crawler sees is inconsistent.

### about.html (`/about`)
- **Title** (52 chars): `About Analyser - Local File Forensics, No Ads or Tracking` - good.
- **Description**: `"Why Analyser exists and how it works: a free, in-browser forensic tool for photos, sound, video & 1,000+ formats. No ads, no telemetry, nothing uploaded."` - good (note "1,000+" prose here vs numeric "1061+" elsewhere).
- **Canonical**: `/about` - correct.
- **JSON-LD**: `FAQPage` (3 Q&A: "Aren't there many similar tools already?", "What does Analyser do?", "Does Analyser work without internet?") + `BreadcrumbList` (Analyser > About). Good - the only main page with FAQPage.
- **H1**: `About` (1). Sections are `<h2>` (Why/Where/What). Good.
- **Issue (count drift)**: bakes `1017` in three spots (`data-fmt-count="bare">1017`, "Browse all 1017 supported formats", overlay `1017`) while index/formats meta say `1061`. Static fallbacks diverge.
- **Strength**: the `<details class="about-formats">` keeps an inline SEO-friendly format list with `#fmt-`/`#ext-` deep-link anchors (rendered by JS, but anchors also exist statically on /formats).

### patch.html (`/patch`)
- **Title** (20 chars): `Changelog - Analyser` - short but fine for a changelog.
- **Description**: `"Every update to Analyser, newest first - new file formats, viewers, bug fixes and offline improvements. Free, in-browser, nothing uploaded."` - good.
- **Canonical**: `/patch` - correct.
- **JSON-LD**: `BreadcrumbList` only (Analyser > Changelog). **Missing opportunity**: no structured `Article`/`TechArticle` or `SoftwareApplication.softwareVersion`/release schema for a changelog rich in dated, versioned entries.
- **H1**: `Changelog` (1); entries use `<p class="patch-version">` not headings (each `.patch-entry` is `<p>`-based, not `<h3>`). Acceptable but the version/codename could be semantic headings.
- **Internal links**: many in-body links to `/about#ext-<ext>` (good deep-linking), `/formats`, `/stats`, `/privacy`.
- **Issue**: very long single page (~1398 lines, ~40 patch entries); older entries inside `<details>` ("Older updates") are collapsed but present in DOM (fine for crawlers).

### stats.html (`/stats`)
- **Title** (40 chars): `Stats - Files Analysed and Visitors | Analyser` - good.
- **Description**: `"Live usage stats for Analyser: how many files have been analysed, how many people have visited, and which file extensions get dropped most - all anonymous and aggregate."` - good. **Note**: the OG description differs/shorter than the meta description (`"Live usage stats for Analyser: files analysed, visitors, and the most-dropped file extensions. Anonymous and aggregate."`) - minor inconsistency, not harmful.
- **Canonical**: `/stats` - correct.
- **JSON-LD**: `BreadcrumbList` only.
- **OG/Twitter**: present but **no `og:image:alt` / `twitter:image:alt`** here (index/about/formats have them) - minor inconsistency.
- **H1**: `Stats` (1). Body: one `<h2>` ("Live usage") then `<h3>` ("Most-dropped extensions", "High scores"). Good hierarchy.
- **Thin-content risk**: page content is JS-populated counters; crawler sees mostly empty `<span id="visitCount">...</span>` placeholders.

### privacy.html (`/privacy`)
- **Title** (47 chars): `Privacy - What Analyser Counts (and Never Sees)` - good.
- **Description**: `"Analyser's privacy page: your files never leave your browser. We count only anonymous aggregates - a file's extension and an anonymous visit count. No accounts, no tracking, no file data."` - good.
- **Canonical**: `/privacy` - correct.
- **JSON-LD**: `BreadcrumbList` only.
- **OG/Twitter**: present, but again **no image:alt** (like stats).
- **H1**: `Privacy` (1). Body has **three `<h2 class="section-head">`** ("Your files never leave your device.", "What the two counters do.", "The small print, kept small.") - good, real static text content (best non-JS body content of the utility pages).

### formats.html (`/formats`)
- **Title** (32 chars): `Supported file types - Analyser` - good, keyword-led.
- **Description**: `"Every file type Analyser can open and inspect - 1,000+ formats across photos, audio, video, documents, archives, 3D and CAD. Free, in-browser, nothing uploaded."` - good.
- **Canonical**: `/formats` - correct.
- **JSON-LD**: `BreadcrumbList` only. **Missing opportunity**: this is a large list page; an `ItemList`/`CollectionPage` schema enumerating the format categories or the per-format guide links would suit it.
- **H1**: `Formats` (1); body `<h2>` "Every file type Analyser can open." Good.
- **Strength**: between `<!-- FORMATS:START/END -->` the whole catalog is prerendered as static markup (1000+ `<details class="fmt-item">`), each extension carrying static `#ext-<ext>` anchors and a `Per-format guides:` line linking every `/formats/<ext>` page - **this is the internal-linking backbone feeding the long-tail pages**.
- **Count**: live count stamped between `<!--FMTCOUNT-->1061<!--/FMTCOUNT-->` (lede) but the in-page overlay still hardcodes `1017` (line 1110). Same drift.

---

## 2. Structured-data review

**Types currently used:**
| Page | Schema types |
|------|--------------|
| index | `WebApplication`, `WebSite` (with `SearchAction`) |
| about | `FAQPage`, `BreadcrumbList` |
| patch | `BreadcrumbList` |
| stats | `BreadcrumbList` |
| privacy | `BreadcrumbList` |
| formats | `BreadcrumbList` |
| /formats/<ext> | `FAQPage` (2 Q: "What is a .X file?" / "How do I open a .X file?"), `BreadcrumbList` (3-level) |
| /formats/id/<ext> | `FAQPage`, `BreadcrumbList` (id route) |

Generated per-format FAQ + breadcrumb is produced in
`tools/prerender-format-pages.mjs` (`faq` and `crumbs` objects, lines ~291-307) -
consistent and complete across ~1061 pages.

**What is well done:** every page has BreadcrumbList; the home page declares a
proper `WebApplication` with offers/featureList/author; per-format pages have
FAQPage with genuinely unique answer text (the "Did you know" facts feed the FAQ
`text`), reducing duplication.

**Missing / under-used opportunities:**
- **`SoftwareApplication`** - index uses `WebApplication` (a subtype, fine) but
  lacks `aggregateRating`/`softwareVersion`/`screenshot`. A `screenshot` and the
  live version would enrich it.
- **`HowTo`** - the per-format pages are literally "how to open a .X file" intent
  but only model it as FAQPage. A `HowTo` (steps: drop file -> view metadata)
  would be the more on-the-nose type for that query class and can co-exist.
- **`BreadcrumbList` on per-format pages is present**, good, but the hub
  `/formats` has no `ItemList`/`CollectionPage` enumerating its children.
- **`TechArticle`/`Article` on patch.html** - a dated, authored changelog is a
  natural Article; currently only Breadcrumb.
- **`Organization`/`Person` sameAs** - author Person on index has no `sameAs`
  social links; no site-wide Organization/publisher node.
- **`WebSite SearchAction`** points at `/?q=` which the app does not appear to
  consume (search is local format-metadata search, no `q` param routing seen) -
  may be an unsupported sitelinks-searchbox declaration.

---

## 3. Per-format page SEO (`/formats/<ext>`, `/formats/id/<ext>`)

Counts (from disk): **249 full pages** in `formats/`, **812 id pages** in
`formats/id/`, **+1 hub** = **1062 URLs** (matches `sitemap-formats.xml`'s 1062
`<loc>` entries).

**Strengths:**
- Each page is a **real static HTML file** (not SPA-fallback), so no soft-404s -
  exactly the right architecture for long-tail crawling. The generator header
  documents this rationale explicitly.
- Unique, keyword-rich titles: `.HEIC file - what it is and how to open it | Analyser`
  (full) / `.YARA file - what it is and how to identify it | Analyser` (id).
- Unique meta description per page built from `EXT_PAGES[ext].blurb`
  (e.g. HEIC: `"HEIC (HEIF) is Apple's high-efficiency image format used by iPhones..."`).
- Per-page **FAQPage + 3-level BreadcrumbList** JSON-LD.
- A **"Did you know" section** with 3-5 researched facts per page (hand-authored
  `EXT_PAGES` facts plus auto-derived facts for ZIP/CFBF containers, MIME types,
  magic bytes - see `assembleFacts()` lines 193-265). These materially de-thin the
  pages.
- Single `<h1>` (the `.EXT` token), `<h2>` "What is a .X file?", semantic `<dl>`.
- **Pager nav** (Previous / I'm feeling lucky / Next) cross-links every page to
  its neighbours in catalog order, plus "Related formats" links siblings, plus
  header nav and footer "All formats" - **good internal-link depth**; every page
  is reachable and links outward.

**Thin-content / duplication risks:**
- **Shared `desc` per row**: all sibling extensions in a catalog row share the
  same "What Analyser shows you" text. E.g. every image ext (jpg/png/heic/...)
  repeats the identical paragraph `"View EXIF, GPS, camera settings, histograms..."`.
  Uniqueness rests entirely on the blurb + "Did you know" facts; for id-only exts
  **without** an `EXT_PAGES` entry, the blurb is a generic fallback
  (`.X files belong to the "<label>" family of formats.`) and facts may be just
  the 2-3 auto-derived/backfilled lines - those pages are genuinely thin and
  near-duplicate of their siblings.
- The generator WARNS on full-analysis exts missing `EXT_PAGES` copy, but id-only
  exts get no warning, so the long tail of 812 id pages is where thin-content risk
  concentrates.
- **No `<img>`/visual content** on any guide page - all text. Fine, but a
  format-specific preview/screenshot would help differentiation and image search.
- **Count drift reaches generated pages**: `formats/atari.html` footer still reads
  `1040+`/`1017+` while `formats/heic.html` and the live count say `1061` - the
  static footer number is baked at generation time and these pages were last
  regenerated at a different commit than the count stamp ran (no `data-fmt-count`
  hooks exist on format pages: `grep` returns 0). So format pages can carry a
  stale, hardcoded count.

---

## 4. Crawl / indexing

**robots.txt** - clean: `User-agent: * / Allow: /`, explicitly welcomes AI/LLM
crawlers, points at both sitemaps:
```
Sitemap: https://lab.valjdakosta.com/sitemap.xml
Sitemap: https://lab.valjdakosta.com/sitemap-formats.xml
```
Mentions `llms.txt` in a comment but **does not list it in either sitemap** (minor).

**sitemap.xml** - 6 URLs (/, /about, /formats, /patch, /stats, /privacy) with
`lastmod` 2026-06-18 (stamped to build date by `stamp-counts.mjs`),
`changefreq`, sensible `priority` (1.0 home, 0.8 formats, 0.6 about, 0.5 stats,
0.4 patch, 0.3 privacy). **Does not list `/llms.txt`.** Correct and current.

**sitemap-formats.xml** - 1062 URLs (hub + 249 full + 812 id), regenerated each
build by `prerender-format-pages.mjs`. **Has NO `<lastmod>`** (only `changefreq`
+ `priority`) - the main sitemap has lastmod, this one does not. Minor.

**Canonical strategy** - every page self-canonicalises to its clean URL
(`https://lab.valjdakosta.com/about`, etc.). Per-format pages canonicalise to
`/formats/<ext>` and `/formats/id/<ext>`. Consistent, no parameterised dupes.

**Clean-URL handling** - per CLAUDE.md and `serve.py`/Cloudflare: `/about` serves
`about.html`, `/about.html` 308-redirects to `/about`. The `/formats` file and
`formats/` directory coexist (server resolves `/formats` to the file). Internal
links all use clean URLs (`/about`, `/formats/heic`) - good, no `.html` leakage in
nav. Per-format pages correctly use **root-absolute** asset paths (`/assets/...`,
`/manifest.json`) since they're served from a nested path.

**Indexability** - no `noindex` anywhere (verified on samples); no `robots` meta
blocking. All generated pages are indexable.

**PWA/manifest** - `manifest.json` present, description stamped to `1061+`,
192/512 icons + maskable. `theme_color`/`background_color` set. Good.

---

## 5. Concrete issues list

1. **Format-count drift across static HTML** (multiple files). Baked fallback
   numbers disagree: `index.html:170` overlay `740`; `about.html:186,193,211`
   `1017`; `formats.html:1110` overlay `1017`; footer "File ID" line `1040+` in
   `index/about/patch/stats/privacy/formats` (and `tools/partials/footer-shared.html:75`);
   `formats/atari.html` `1017+`; meta/lede say `1061`. `stamp-counts.mjs` only
   rewrites `index/patch/manifest/sitemap` and patterns `"N+ file types"`,
   `"N+ file formats"`, `">N+ formats<"` - it does **not** touch the `1040+`
   footer string, the `1017` `data-fmt-count="bare"` static fallbacks, or
   format-page footers. JS fixes them at runtime, but crawlers/social cards see
   stale numbers. *Fix surface: extend `stamp-counts.mjs` passes (footer-shared,
   about, formats overlay) and/or add a count hook to generated format pages.*

2. **`WebSite` SearchAction likely non-functional** (`index.html:61-68`).
   `urlTemplate: https://lab.valjdakosta.com/?q={search_term_string}` - no
   evidence the app reads `?q=`. Either wire it up or remove to avoid a false
   sitelinks-searchbox signal.

3. **Missing `og:image:alt` / `twitter:image:alt` on stats.html and
   privacy.html** while index/about/formats include them. Inconsistent; add for
   parity.

4. **stats.html OG description differs from meta description** (shorter variant).
   Harmless but should be unified.

5. **`sitemap-formats.xml` has no `<lastmod>`** on any of its 1062 URLs (main
   sitemap does). Add lastmod for freshness signalling.

6. **`llms.txt` referenced in robots.txt comment but not in any sitemap.** Add to
   sitemap.xml if it should be discoverable.

7. **Thin/near-duplicate id-only guide pages** (`formats/id/*`, 812 pages).
   Sibling extensions share the row `desc`; id-only exts without `EXT_PAGES` copy
   fall back to a generic blurb + 2-3 auto-derived facts. No warning is emitted
   for missing id copy, so the gap is invisible. Risk of "thin content"/duplicate
   clustering. *Mitigation already partly in place via auto-facts; consider
   per-ext blurbs for the highest-traffic id formats.*

8. **No `HowTo` structured data** on per-format pages despite "how to open a .X
   file" being the exact query intent - only FAQPage is used. Adding HowTo (or
   merging the open steps) is a low-effort enrichment.

9. **patch.html lacks Article/TechArticle schema** and uses `<p>` (not headings)
   for version/codename per entry - a dated authored changelog is under-marked-up.

10. **`/formats` hub lacks `ItemList`/`CollectionPage` schema** - a 1000+ item
    catalogue page enumerating child guides would benefit from list structured
    data.

11. **JS-dependent body content on stats.html** (counters) and the about/formats
    inline format `<details>` (rendered client-side via `renderAboutFormats`).
    `/formats` is prerendered statically (good), but about.html's inline list is
    **not** prerendered - a no-JS crawler sees an empty `<div id="aboutFormats">`.
    The canonical SEO surface is `/formats` so this is low-severity, but about's
    "All supported file types" `<details>` is empty without JS.

12. **patch.html `<title>` is bare** (`Changelog - Analyser`) - could lead with a
    keyword ("Analyser Changelog - new file formats & viewers") for marginal gain.

13. **Author `Person` has no `sameAs`** and there is no site-wide
    `Organization`/publisher node in any JSON-LD - weak entity/authorship signals.
