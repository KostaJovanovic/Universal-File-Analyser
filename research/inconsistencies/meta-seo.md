# Analyser - META / SEO / structured-data inconsistencies

Scope: `index.html`, `about.html`, `patch.html`, `stats.html`, `privacy.html`,
`formats.html`, `atari.html`, the per-format template in
`tools/prerender-format-pages.mjs` (emits `formats/<ext>.html` +
`formats/id/<ext>.html`), plus `sitemap.xml`, `sitemap-formats.xml`, `robots.txt`,
`manifest.json`. No source files were modified.

Overall the `<head>` is remarkably consistent (theme-color pair, favicon set,
manifest link, OG/Twitter banner image + image:alt, canonical, the inline theme
`<script>`). The findings below are the deviations, ranked by SEO impact.

---

## High impact

### H1. Title separator is inconsistent ( ` - ` vs ` | ` ) and shape varies
No single title pattern. Three different shapes coexist:

| Page | Title | file:line | Separator |
|---|---|---|---|
| index.html | `Analyser - Online File Viewer to Open and Inspect Any File` | index.html:6 | ` - ` (no "Analyser" suffix; brand is the prefix) |
| about.html | `About Analyser - Free Online File Viewer, No Ads or Tracking` | about.html:6 | ` - ` (brand embedded, no suffix) |
| patch.html | `Changelog - Analyser` | patch.html:6 | ` - ` suffix |
| formats.html | `Supported file types - Analyser` | formats.html:6 | ` - ` suffix |
| stats.html | `Stats - Files Analysed and Visitors \| Analyser` | stats.html:6 | ` \| ` suffix |
| privacy.html | `Privacy - What Analyser Counts (and Never Sees)` | privacy.html:6 | ` - ` (brand embedded, no suffix) |
| atari.html | `Atari` | atari.html:6 | none (no brand at all) |
| per-format full | `.X file - what it is and how to open it online \| Analyser` | prerender-format-pages.mjs:290 | ` \| ` suffix |
| per-format id | `.X file - what it is and how to identify it online \| Analyser` | prerender-format-pages.mjs:291 | ` \| ` suffix |

- **`stats.html:6` is the lone `Page | Analyser` pipe outlier among the hand-authored
  pages** - patch and formats use `Page - Analyser` with a hyphen for the same
  "suffix" shape. The per-format generator also uses ` | Analyser`. So the site
  mixes ` - Analyser` (patch, formats) and ` | Analyser` (stats, all generated
  pages) for the identical "X then brand" pattern. Pick one separator.
- Note the project's house style forbids em-dashes in user-facing text (CLAUDE.md),
  so a spaced hyphen as separator is the established convention - which argues for
  standardising on ` - Analyser` and dropping the ` | ` variants in stats.html and
  the per-format template.
- index/about/privacy don't carry an explicit `... Analyser` suffix at all (brand is
  woven into the phrase). That's a deliberate "keyword title" style and is fine, but
  it means there is no enforced suffix convention across the site.

### H2. Format count drift: catalog total vs. category sum vs. stamped numbers
`formats.html:41` (the generated `<!--ITEMLIST:START-->` CollectionPage / ItemList):
- `description` advertises **"1061 formats across 12 categories"**.
- The 12 per-category `ListItem` names sum to **1065** (98+87+83+33+90+70+130+34+39+60+43+298 = 1065), not 1061.
- `numberOfItems` is **12** (categories) - correct, but easy to misread as a format count.

So the headline total (1061) and the category breakdown (1065) disagree by 4 inside
the same JSON-LD block. The same `1061` appears in index.html meta/JSON-LD
(index.html:7, 15, 23, 37, 52) and manifest.json:4. Whichever is canonical
(`formatCount()` via `tools/stamp-counts.mjs`), the category sum is out of step -
worth confirming the generator's category tallies vs. the live count.

### H3. Per-format pages omit OG image dimensions + alt and Twitter alt
The per-format template (`tools/prerender-format-pages.mjs:344-357`) is the only
page family **missing** OG/Twitter parity tags that every hand-authored indexable
page has:
- **Missing `og:image:width`** (others: index.html:18)
- **Missing `og:image:height`** (others: index.html:19)
- **Missing `og:image:alt`** (others: index.html:20)
- **Missing `twitter:image:alt`** (others: index.html:25)

These pages DO have og:image and twitter:image (prerender-format-pages.mjs:350,357)
but ship them without dimensions/alt. Since this template generates the bulk of the
site's indexable URLs (hundreds of `/formats/<ext>`), this is the widest-reaching
parity gap. Per-page OG/Twitter matrix below.

---

## Medium impact

### M1. Meta descriptions over the ~160-char guideline
Measured lengths of `<meta name="description">`:

| Page | length | file:line | note |
|---|---|---|---|
| index.html | **193** | index.html:7 | longest; will truncate in SERP |
| privacy.html | **187** | privacy.html:7 | over 160 |
| about.html | **179** | about.html:7 | over 160 |
| stats.html | 169 | stats.html:7 | slightly over |
| formats.html | 160 | formats.html:7 | at the edge (OK) |
| patch.html | 139 | patch.html:7 | OK |

Four of six hand-authored pages exceed 160. index.html (193) and privacy (187) are
the worst. No two meta descriptions are duplicated across pages (good).

### M2. privacy.html ships three DIFFERENT descriptions (meta vs og vs twitter)
Unlike every other page (where meta == og:description == twitter:description
verbatim - see index.html:7/15/23, about.html:7/15/23, etc.), privacy.html
deliberately shortens each tier:
- `meta description` (187 chars): "...We count only anonymous aggregates - a file's extension and an anonymous visit count. No accounts, no tracking, no file data." (privacy.html:7)
- `og:description` (162 chars): drops the leading "Analyser's privacy page:" (privacy.html:15)
- `twitter:description` (112 chars): further drops "a file's extension and an anonymous visit count" (privacy.html:23)

This is the only page where the three diverge. If intentional (length-tuned per
network) it's defensible, but it breaks the site-wide "all three identical" pattern
and is worth flagging as the outlier. og:description (162) is also just over 160.

### M3. og:title == title and og:description == meta everywhere (consistent - good)
Verified: on every hand-authored page og:title duplicates `<title>` verbatim and
twitter:title duplicates og:title (e.g. index.html:6/14/22, stats.html:6/14/22).
No mismatches found. Per-format template likewise reuses one `title`/`desc` string
across title/og/twitter (prerender-format-pages.mjs:339-356). This dimension is clean.

---

## Low impact / by-design

### L1. atari.html is an intentional outlier (easter-egg, noindex)
`atari.html:6-7` has `<title>Atari</title>` and `<meta name="robots" content="noindex, nofollow">`,
and **no** meta description, no OG tags, no Twitter tags, no canonical, no JSON-LD.
This is correct for a noindex easter-egg page - flagging only so it isn't mistaken
for a regression. It still shares the theme-color pair, favicon set, manifest link
and theme `<script>` (atari.html:8-16), so it's visually consistent with the family.
It is also (correctly) absent from sitemap.xml.

### L2. JSON-LD @type coverage per page
| Page | JSON-LD @types | BreadcrumbList? | file:line |
|---|---|---|---|
| index.html | WebApplication, WebSite | **No** (home - acceptable; root of breadcrumb trail) | index.html:33,60 |
| about.html | FAQPage, HowTo, BreadcrumbList | Yes | about.html:33,105,120 |
| patch.html | BreadcrumbList, TechArticle | Yes | patch.html:33,43 |
| stats.html | BreadcrumbList | Yes | stats.html:33 |
| privacy.html | BreadcrumbList | Yes | privacy.html:33 |
| formats.html | BreadcrumbList, CollectionPage/ItemList | Yes | formats.html:33,41 |
| atari.html | (none) | n/a (noindex) | - |
| per-format | FAQPage, HowTo, BreadcrumbList | Yes | prerender-format-pages.mjs:297,308,320 |

- **index.html is the only indexable page without a BreadcrumbList** - defensible
  since it's the breadcrumb root, but if you want full uniformity it's the gap.
- **author/publisher nodes are consistent where present**: index.html:45-46 and
  patch.html:49-50 both use `Person "valjdakosta" / Organization "valjdakosta"` with
  `https://valjdakosta.com/`. No drift. Note this differs from the visible byline
  links which point at `https://link.valjdakosta.com/` (e.g. index.html:93) - the
  structured-data URL (`valjdakosta.com`) vs. the on-page link (`link.valjdakosta.com`)
  diverge, but that's a redirector vs. canonical-site distinction, likely intentional.
- **FAQPage on-page mirror is present**: about.html's 8 FAQ questions
  (about.html:37-93 in JSON-LD) each have a visible `<dt>` mirror
  (about.html:331-359). Per-format FAQPage questions ("What is a .X file?", "How do
  I open...", "Can I open... for free?", prerender-format-pages.mjs:300-305) are
  largely mirrored by the on-page `<h2>What is a .X file?` + capability `<dl>`
  (prerender-format-pages.mjs:421-427); the "for free" Q is the weakest-mirrored but
  the page body covers free/no-upload prose, so acceptable.

### L3. Theme-color / favicon / manifest / theme-script: identical everywhere
Byte-for-byte identical across all seven pages and the per-format template:
- theme-color light/dark pair (index.html:9-10 ... atari.html:8-9, prerender:342-343)
- favicon png+svg, apple-touch-icon, manifest link (index.html:26-29; per-format
  uses **root-absolute** `/assets/...` and `/manifest.json` at prerender:358-361,
  the hand pages use relative `assets/...` / `manifest.json` - a deliberate
  path-base difference for how the nested `/formats/<ext>` URLs are served, not a bug)
- inline theme `<script>` is identical on every page (index.html:76 ... prerender:373).

No drift in this group.

---

## Canonicals
All present and self-referential with clean URLs:
- index.html:8 `https://lab.valjdakosta.com/`
- about.html:8 `/about`, patch.html:8 `/patch`, stats.html:8 `/stats`,
  privacy.html:8 `/privacy`, formats.html:8 `/formats`
- per-format: prerender-format-pages.mjs:341 `${SITE}/formats/<ext>` (or `/formats/id/<ext>`)
- atari.html: none (noindex - acceptable)

og:url matches canonical on every page (e.g. index.html:8 vs :16). No canonical issues found.

---

## Per-page OG / Twitter parity matrix
Required set: og:type, og:site_name, og:locale, og:title, og:description, og:url,
og:image, og:image:width, og:image:height, og:image:alt + twitter:card, twitter:title,
twitter:description, twitter:image, twitter:image:alt.

| Page | og full set? | tw full set? | Missing |
|---|---|---|---|
| index.html | yes | yes | - (complete; index.html:11-25) |
| about.html | yes | yes | - (about.html:11-25) |
| patch.html | yes | yes | - (patch.html:11-25) |
| stats.html | yes | yes | - (stats.html:11-25) |
| privacy.html | yes | yes | - tags present, but text diverges (see M2; privacy.html:11-25) |
| formats.html | yes | yes | - (formats.html:11-25) |
| atari.html | no | no | ALL OG + Twitter (by design, noindex; atari.html) |
| per-format (full + id) | partial | partial | **og:image:width, og:image:height, og:image:alt, twitter:image:alt** (prerender-format-pages.mjs:344-357) |

og:type values: hand pages all `website` (index.html:11 etc.); per-format pages use
`article` (prerender-format-pages.mjs:344) - appropriate for the content type, not a bug.

---

## Sitemap / robots / manifest

### Routes listed vs. actual
`sitemap.xml` lists: `/`, `/about`, `/formats`, `/patch`, `/stats`, `/privacy`,
`/llms.txt` (sitemap.xml:3-44). `llms.txt` exists (referenced from robots.txt:6 and
listed in sitemap). `atari` correctly absent (noindex).
- **`sitemap.xml` does NOT list the per-format `/formats/<ext>` pages** - that's
  by design: they live in the separate `sitemap-formats.xml`
  (prerender-format-pages.mjs:507), which is referenced from robots.txt:9 and
  generated each commit. Both sitemaps are declared in robots.txt (robots.txt:8-9). OK.
- **Minor**: `sitemap.xml` includes `/llms.txt` as a crawlable URL (sitemap.xml:39-44).
  Listing a non-HTML resource in the sitemap is unusual but harmless.

### lastmod
- `sitemap.xml`: every URL has `<lastmod>2026-06-18</lastmod>` (sitemap.xml:5,11,...),
  stamped by `tools/stamp-counts.mjs`. Present and uniform.
- `sitemap-formats.xml`: every per-format URL gets `<lastmod>${TODAY}</lastmod>`
  (prerender-format-pages.mjs:497). Present.

### Count drift (manifest / meta)
- `manifest.json:4` description hardcodes **"1061+ file types"**; index.html meta
  + JSON-LD also say 1061 (index.html:7,37,52). These are stamped by
  `tools/stamp-counts.mjs` from `formatCount()`, so they agree with each other - but
  see **H2**: the formats.html ItemList category sum (1065) disagrees with this 1061.
- `manifest.json` theme_color `#ffffff` (manifest.json:10) matches the light
  theme-color in every page's `<meta name="theme-color" ... light>` (index.html:9).
  Consistent.

---

## Ranked summary of what to fix
1. **(H2)** Reconcile the format count - formats.html ItemList category sum (1065) vs.
   the advertised 1061 in the same block and across index/manifest.
2. **(H3)** Add `og:image:width/height/alt` + `twitter:image:alt` to the per-format
   template (`tools/prerender-format-pages.mjs:357`) - widest-reaching gap.
3. **(H1)** Standardise the title separator - stats.html and the per-format template
   use ` | Analyser` while patch/formats use ` - Analyser`; pick one (hyphen fits the
   no-em-dash house style).
4. **(M1)** Trim index.html (193), privacy.html (187), about.html (179),
   stats.html (169) meta descriptions toward <=160.
5. **(M2)** Decide whether privacy.html's three divergent descriptions are intentional;
   if not, unify like every other page.
