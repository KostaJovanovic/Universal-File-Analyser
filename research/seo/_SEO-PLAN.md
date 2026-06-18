# Analyser - SEO optimization plan (master)

Consolidated, prioritised action plan. Synthesises the three research notes in this
folder:
- `current-state.md` - technical SEO audit of every page (what exists, what's broken).
- `feature-inventory.md` - the full capability list (the keyword universe to surface).
- `format-catalog.md` - 1061 extensions / 86 rows / 12 categories with brand synonyms.

Nothing has been changed in the site. This file is the to-do list. Per project rules,
**no commits / patch notes** - implement when the user asks.

Headline: the site is already in good technical shape (clean canonicals, single H1s,
full OG/Twitter, BreadcrumbList everywhere, 1062 prerendered long-tail pages, two
sitemaps, robots welcoming crawlers). The wins are: **fix the format-count drift**,
**enrich structured data** (HowTo / SoftwareApplication / ItemList / Article),
**de-thin the 812 id-only pages**, and **rebuild the about page into a real keyword
surface** instead of a short essay.

---

## P0 - Correctness bugs that actively hurt SEO (do first, low effort)

1. **Format-count drift across static HTML.** Baked fallbacks disagree: meta/lede say
   `1061`, but `about.html` shows `1017` (3 spots), `index.html:170` overlay `740`,
   `formats.html:1110` overlay `1017`, the shared footer "File ID" line `1040+`
   (`tools/partials/footer-shared.html:75`, stamped into 6 pages), and
   `formats/atari.html` `1017+`. JS fixes them at runtime; crawlers + social cards see
   stale numbers. **Fix:** extend `tools/stamp-counts.mjs` to also rewrite (a) the
   footer-shared `1040+` string, (b) the `data-fmt-count="bare">NNN` static fallbacks
   in about/index/formats, and (c) optionally bake a count into the format-page footer
   template in `prerender-format-pages.mjs`. One source of truth = `formatCount()`.

2. **`WebSite` SearchAction is likely non-functional** (`index.html` JSON-LD).
   `urlTemplate: /?q={search_term_string}` but the app doesn't consume `?q=`. Either
   wire the home page to read `?q=` and auto-open the format search, or remove the
   `potentialAction` so Google isn't told about a sitelinks searchbox that doesn't work.

3. **Missing `og:image:alt` / `twitter:image:alt` on stats.html and privacy.html**
   (index/about/formats have them). Add for parity.

4. **stats.html OG description != meta description** - unify to one string.

5. **`sitemap-formats.xml` has no `<lastmod>`** (1062 URLs). The main sitemap has it.
   Add `<lastmod>` in `prerender-format-pages.mjs` (build date is fine).

6. **`atari.html` footer is stale** (old 48/72/310 MB tiers, "1017+", missing
   dependency rows) because it's not in `stamp-footer.mjs` `PAGES`. Either add it to
   `PAGES` or accept it's an Easter-egg page and drop its misleading FOOTER marker.
   (Also flagged in the comment audit - same root cause.)

---

## P1 - Rebuild the about page into an SEO surface (the explicit ask)

Today `about.html` is a short "why it exists" essay + a JS-rendered (empty without JS)
`<details>` format list + FAQPage (3 Q&A). It under-uses the enormous capability/
keyword material in `feature-inventory.md`. Plan:

1. **Add a "What Analyser can do" section with real, crawlable body text** organised by
   the 12-14 categories from the inventory (Photos, RAW, Audio, Video, Documents,
   Ebooks, 3D/CAD, Design, NLE projects, Archives, Maps/GIS, Developer/data, Email,
   Security/forensics, Disk/firmware, Games, Science/medical). Each category = an `<h2>`
   or `<h3>` + 2-4 sentences naming concrete features (the keywords): "EXIF + GPS map +
   colour histogram + on-device OCR + QR detection + AI-generation markers", "FFT
   spectrogram, LUFS loudness, BPM + key detection", "rebuild After Effects / Premiere /
   DaVinci / VEGAS timelines", etc. Pull verbatim from `feature-inventory.md` section 2.
   This is the single biggest content-depth win and it's all true, already-built copy.

2. **Prerender the inline format `<details>` list** (currently `renderAboutFormats`
   runs client-side, so a no-JS crawler sees an empty `<div id="aboutFormats">`). Either
   prerender it like `/formats` does, or rely on `/formats` as the canonical list and
   add a strong internal link. Recommendation: keep about's list JS-rendered but ensure
   `/formats` is the indexable catalogue (it already is) and link to it prominently.

3. **Expand the FAQPage** from 3 to ~8-10 Q&A targeting real search intent (each also
   becomes a rich result): "Is it safe to open files online?" / "Does Analyser upload my
   files?" / "Can I view EXIF without uploading?" / "How do I open a .HEIC / .ARW / .DRP
   file?" / "Does it work offline?" / "Is it free?" / "What file types does it support?"
   / "Can I extract GPS from a photo?". Answers already exist in the inventory + privacy
   copy.

4. **Add a "How it works" `HowTo` block** (drop a file -> it's classified -> view
   metadata/preview, all on-device) - models the core intent and earns HowTo rich
   results.

5. **Internal linking from about**: link category mentions to the relevant
   `/formats/<ext>` hero pages (e.g. "RAW photos" -> `/formats/arw`, "Photoshop" ->
   `/formats/psd`) and to `/formats` category anchors. Spreads link equity to the long
   tail.

6. **Keep house style**: British spelling, em-dash-free (spaced hyphen), match existing
   aesthetic (themes/glow/borders) - do not ship a bare version.

---

## P1 - Structured-data enrichment (site-wide, generator-driven)

1. **Per-format pages: add `HowTo`** alongside the existing FAQPage. "How to open a .X
   file" IS the query - HowTo with steps (open Analyser -> drop the .X file -> read
   metadata / view) is the on-the-nose type. Generate in
   `tools/prerender-format-pages.mjs` next to the `faq`/`crumbs` objects. Co-exists with
   FAQPage.

2. **`/formats` hub: add `ItemList` / `CollectionPage`** enumerating the category guides
   or the per-format links - suits a 1000+ item index. Generate in
   `tools/prerender-formats.mjs`.

3. **index `WebApplication`: enrich** with `screenshot` (the OG banner), live
   `softwareVersion` (from `analyserVersion()`), and `aggregateRating` only if you have
   real ratings (don't fake it).

4. **patch.html: add `Article`/`TechArticle`** (dated, authored changelog) and consider
   making each entry's version/codename a semantic `<h3>` instead of `<p>`. Also lead the
   `<title>` with a keyword: "Analyser Changelog - new file formats & viewers".

5. **Site-wide `Organization`/`publisher` node + author `sameAs`.** Add an Organization
   (or Person with `sameAs` social/GitHub links) as publisher across JSON-LD for
   entity/authorship signals.

---

## P2 - De-thin the long tail (812 id-only pages)

`current-state.md` flags the real risk: sibling extensions in a catalog row share the
same `desc`, and id-only exts without an `EXT_PAGES` entry fall back to a generic blurb
+ 2-3 auto-derived facts -> near-duplicate clusters. Mitigation:

1. **Author `EXT_PAGES` blurbs for the highest-value id formats** - prioritise the
   brand-name long tail from `feature-inventory.md` section 4 and `format-catalog.md`'s
   "high-value keyword opportunities" (SLDPRT/SolidWorks, ARW/Sony, R3D/RED,
   BEPIS/ULTRAKILL, KDBX/KeePass, DCM/DICOM, GCSV/Gyroflow, etc.). Each unique blurb +
   the per-page facts breaks the duplication.

2. **Emit a WARNING for id-only exts missing copy** (the generator only warns for
   full-analysis exts today) so the gap is visible during `save.bat`. Or at least log a
   list to drive the backfill.

3. **Vary the shared `desc`** per page slightly using catalog data (the format's own
   name/category) so siblings aren't byte-identical - the `assembleFacts` backfill
   already does this for facts; consider the same for the intro line.

4. **Consider `noindex` for the very thinnest id pages** only if Search Console later
   shows them as "crawled, not indexed" / soft-duplicate - don't pre-emptively prune;
   the prerendered architecture is otherwise ideal for long-tail capture.

---

## P2 - Crawl / discovery polish

1. **Add `/llms.txt` to `sitemap.xml`** (it's referenced in robots.txt but in no
   sitemap).
2. **Image/screenshot assets**: per-format pages and about have zero `<img>`. A
   format-specific preview/screenshot would help differentiation + image search +
   `WebApplication.screenshot`. Optional, higher effort.
3. **stats/privacy thin static body**: stats is JS counters (crawler sees empty spans).
   Low priority (utility pages), but a one-line static summary sentence helps.

---

## Keyword strategy (where the traffic is)

From `format-catalog.md` + inventory, the durable organic targets, ranked:

1. **"how to open a .X file" / "what is a .X file"** - the per-format pages already own
   this; the P2 de-thinning is what unlocks it at scale. Highest-volume brand exts:
   HEIC, ARW/CR3/NEF/RAF (camera RAW), PSD, AI, DWG, STEP/STL/GLB, EPUB/MOBI/AZW3,
   DICOM, PCAP, KDBX, SQLITE, HAR, GGUF/SAFETENSORS.
2. **"view EXIF online without upload" / "read metadata in browser"** - privacy +
   on-device is the differentiator vs upload-based competitors. Hammer "no upload",
   "stays on your device", "offline" in titles/descriptions/FAQ.
3. **"<software> project file viewer"** - .aep/.prproj/.drp/.veg/.flp/.als/.sldprt -
   niche, low competition, Analyser genuinely renders these. Strong per-format copy.
4. **"open .X without <expensive software>"** - SolidWorks/Photoshop/AutoCAD/Premiere
   without the app. Frame the blurbs this way.
5. **Category hubs** - "online 3D model viewer", "spectrogram generator", "treemap of
   folder", "GPX viewer with elevation" - the interactive tools in inventory section 3
   each deserve a sentence-level keyword presence on about + formats.

Voice/consistency: keep "1000+ formats" as the safe headline (the exact number drifts);
British spelling; em-dash-free; never claim full "view/open" for id-only formats - say
"identify and read metadata".

---

## Suggested execution order

1. P0 #1 (count drift) + #2 (SearchAction) + #3-6 - all small, all generator/markup edits.
2. P1 about-page rebuild (the explicit request) - biggest content win.
3. P1 structured data (HowTo on format pages, ItemList on hub, Article on patch).
4. P2 id-page de-thinning - ongoing, prioritised by brand value.
5. P2 crawl polish + optional screenshots.

All P0/P1 generator changes flow through `save.bat`'s existing prerender/stamp steps,
so they regenerate the 1062 pages automatically - no manual page edits.
