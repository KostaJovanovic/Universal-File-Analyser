# SEO implementation steps (sequenced execution plan)

Turns `_SEO-PLAN.md` into an ordered, do-this-then-that checklist. Each step lists
the **files**, the **exact change**, **how to verify**, and **dependencies**. Steps
are grouped into batches that can each be one focused work session. Batches are
ordered so the cheap correctness wins land first and nothing later depends on
something not yet done.

House rules that apply to every step: British spelling, em-dash-free (spaced
hyphen " - "), keep the existing aesthetic, **do not commit / write patch notes**
(the user runs save.bat). Generator changes auto-regenerate the 1062 pages on the
next save.bat, so prefer editing a generator over hand-editing pages.

Status legend: [ ] todo. Fill in as you go.

---

## BATCH 1 - Correctness bugs (P0, ~1 session, highest ratio)

These fix wrong/stale signals crawlers and social cards actually see. All small.

- [ ] **1.1 Kill the format-count drift.** One number (`formatCount()` -> currently
  1061) must appear everywhere; today static fallbacks say 740 / 1017 / 1040.
  - Edit `tools/stamp-counts.mjs`: add regex passes for the strings it does NOT yet
    touch:
    - the footer "File ID" line `1040+` in `tools/partials/footer-shared.html`
      (so all 6 footer-stamped pages update),
    - `data-fmt-count="bare">NNN` static fallbacks in `index.html` (`740`),
      `about.html` (`1017` x3: the bare count, "Browse all 1017...", overlay),
      `formats.html` (overlay `1017`).
  - Decide on format-page footers: either add a count token + a pass for
    `formats/*.html`, or accept they show a build-time number (lower priority).
  - **Verify:** `grep -rn "740\|1017\|1040" index.html about.html formats.html tools/partials/footer-shared.html` returns nothing stale after a dry run of the stamp script; run `node tools/stamp-counts.mjs` (or `server.bat` preview) and confirm every visible count reads the live number.
  - **Dep:** none.

- [ ] **1.2 Fix or remove the WebSite SearchAction.** `index.html` JSON-LD declares
  `potentialAction` -> `/?q={search_term_string}` but nothing reads `?q=`.
  - Option A (preferred if cheap): in `app.js boot()`, read `?q=` and auto-open the
    format-search overlay prefilled with the term. Then the schema is honest.
  - Option B: delete the `potentialAction` block from `index.html`.
  - **Verify:** Rich Results Test on `/` shows no sitelinks-searchbox error; if
    Option A, `/?q=heic` opens search with "heic".
  - **Dep:** none.

- [ ] **1.3 OG/Twitter image:alt parity.** Add `og:image:alt` + `twitter:image:alt`
  to `stats.html` and `privacy.html` (copy the pattern from `index.html`).
  - **Verify:** both pages have the two tags; values describe the banner.
  - **Dep:** none.

- [ ] **1.4 Unify stats.html OG vs meta description** to a single string.
  - **Verify:** `og:description` == `meta[name=description]` on `stats.html`.

- [ ] **1.5 Add `<lastmod>` to sitemap-formats.xml.** In
  `tools/prerender-format-pages.mjs`, emit `<lastmod>` (build date) per `<url>`.
  - **Verify:** regenerated `sitemap-formats.xml` has lastmod on all 1062 urls.

- [ ] **1.6 Add `/llms.txt` to `sitemap.xml`** (referenced in robots.txt, in no
  sitemap). Add a `<url>` in `tools/stamp-counts.mjs`'s sitemap pass (or wherever
  sitemap.xml is generated/edited).
  - **Verify:** sitemap.xml lists `/llms.txt`.

- [ ] **1.7 atari.html footer staleness** (already half-handled in the comment pass).
  Either add `atari.html` to `PAGES` in `tools/stamp-footer.mjs` (makes its footer
  current and the marker truthful again) or leave the hand-maintained note. If
  adding: run the generator and confirm the footer matches the partial.
  - **Dep:** decision only.

---

## BATCH 2 - Rebuild the about page (P1, the original explicit ask)

Biggest content-depth win. Source copy is `feature-inventory.md` (already written,
all true). Keep the existing look.

- [ ] **2.1 Add a "What Analyser can do" section** to `about.html` with crawlable,
  static body text organised by the ~17 categories in `feature-inventory.md` s2.
  Each category = `<h2>`/`<h3>` + 2-4 sentences naming concrete features (the
  keywords): EXIF/GPS map/histogram/OCR/QR; FFT spectrogram/LUFS/BPM; rebuild
  After Effects/Premiere/DaVinci/VEGAS timelines; 3D viewer for STL/STEP/glTF; etc.
  - **Verify:** view-source (no JS) shows the full text; headings nest under the
    single page `<h1>`; British spelling, no em-dashes.
  - **Dep:** none (copy already exists in the research note).

- [ ] **2.2 Expand FAQPage from 3 to ~8-10 Q&A** in `about.html` JSON-LD + visible
  `<dl>`. Target real queries: "Does Analyser upload my files?", "View EXIF without
  uploading?", "How do I open a .HEIC / .ARW / .DRP file?", "Does it work offline?",
  "Is it free?", "What file types are supported?", "Extract GPS from a photo?".
  Answers come from inventory + privacy copy.
  - **Verify:** Rich Results Test validates FAQPage with N questions; visible Q&A
    matches the JSON-LD text exactly.
  - **Dep:** 2.1 (share wording).

- [ ] **2.3 Add a HowTo block** (drop file -> classified -> view, all on-device) as
  visible steps + `HowTo` JSON-LD.
  - **Verify:** HowTo validates; steps render.

- [ ] **2.4 Internal links from about** category mentions to hero
  `/formats/<ext>` pages (RAW->/formats/arw, Photoshop->/formats/psd, DaVinci->
  /formats/drp...) and to `/formats`.
  - **Verify:** links resolve (preview via server.bat), use clean URLs.

- [ ] **2.5 Decide about's inline `<details>` list.** It's JS-rendered
  (`renderAboutFormats`), empty without JS. Lowest-effort: keep it, but make sure
  `/formats` is the canonical indexable catalogue (it is, prerendered) and link to
  it prominently from 2.4. Only prerender about's list too if you want the
  redundancy. Recommend: link to /formats, don't duplicate.
  - **Dep:** 2.4.

---

## BATCH 3 - Structured-data enrichment (P1, generator-driven, scales to 1062 pages)

- [ ] **3.1 Add HowTo to every per-format page.** In
  `tools/prerender-format-pages.mjs`, next to the existing `faq`/`crumbs` objects,
  emit a `HowTo` ("How to open a .X file": open Analyser -> drop the .X file ->
  read metadata / view). Co-exists with FAQPage.
  - **Verify:** sample `formats/heic.html` + `formats/id/yara.html` validate with
    both FAQPage and HowTo.
  - **Dep:** none.

- [ ] **3.2 Add ItemList / CollectionPage to `/formats` hub.** In
  `tools/prerender-formats.mjs`, emit an `ItemList` of the category guides (or
  per-format links).
  - **Verify:** `formats.html` validates ItemList.

- [ ] **3.3 Enrich index `WebApplication`** with `screenshot` (OG banner URL) and
  live `softwareVersion` from `analyserVersion()`. Do NOT add `aggregateRating`
  unless real ratings exist.
  - **Verify:** Rich Results Test; version matches the app.

- [ ] **3.4 patch.html as Article/TechArticle.** Add `TechArticle` JSON-LD (dated,
  authored). Optionally lead `<title>` with a keyword ("Analyser Changelog - new
  file formats & viewers") and make each entry's version/codename a semantic
  `<h3>`. (Low priority - heavier markup change; the title tweak alone is cheap.)
  - **Verify:** validates; title updated.

- [ ] **3.5 Site-wide publisher/author identity.** Add an `Organization` (or Person
  with `sameAs` GitHub/social) as `publisher` across the JSON-LD blocks.
  - **Verify:** entity present on every page's primary JSON-LD.

---

## BATCH 4 - De-thin the long tail (P2, ongoing, prioritised by brand value)

The 812 id-only pages share row `desc`; ones without `EXT_PAGES` copy fall back to
a generic blurb. Risk: near-duplicate clusters.

- [ ] **4.1 Make the gap visible.** In `tools/prerender-format-pages.mjs`, also emit
  a WARNING (or a printed list) for **id-only** exts missing an `EXT_PAGES` entry
  (today only full-analysis exts warn).
  - **Verify:** save.bat / generator prints the missing-id list.
  - **Dep:** none. Do this first so 4.2 is data-driven.

- [ ] **4.2 Author `EXT_PAGES` blurbs for the highest-value id formats**, prioritised
  by the brand long-tail in `feature-inventory.md` s4 and `format-catalog.md`'s
  keyword callouts: SLDPRT/SolidWorks, ARW/Sony, R3D/RED, BEPIS/ULTRAKILL,
  KDBX/KeePass, DCM/DICOM, GCSV/Gyroflow, PCAP, EVTX, P12/PFX, JKS, GGUF/SAFETENSORS,
  AEP/PRPROJ/VEG, NES/GB/Z64 ROMs, etc. One unique sentence each (what it is + where
  it comes from). House style.
  - **Verify:** `node tools/prerender-format-pages.mjs` no longer warns for those;
    pages show unique blurbs.
  - **Dep:** 4.1.

- [ ] **4.3 Vary the shared intro line** per page using catalog data (name/category),
  the way `assembleFacts` already varies facts, so siblings aren't byte-identical.
  - **Verify:** two siblings (e.g. /formats/jpg vs /formats/png) differ in intro.

- [ ] **4.4 (Later, data-driven) noindex the thinnest** only if Search Console shows
  "crawled - not indexed"/soft-duplicate. Do NOT pre-prune.

---

## BATCH 5 - Crawl / polish (P2, optional)

- [ ] **5.1 Static one-liner on stats.html** so a no-JS crawler sees a sentence, not
  just empty counter spans.
- [ ] **5.2 (Optional, higher effort) per-format / about screenshots** for
  differentiation + image search + `WebApplication.screenshot`.

---

## Cross-cutting verification (run after each batch)

1. `server.bat` -> spot-check the changed pages render and counts are live.
2. Google **Rich Results Test** / Schema validator on: `/`, `/about`, `/formats`,
   `/patch`, a `/formats/<ext>` and a `/formats/id/<ext>` sample.
3. `grep` for any remaining hardcoded count (`740|1017|1040`) after Batch 1.
4. Confirm all internal links use clean URLs (no `.html`) and resolve.
5. View-source (JS disabled) on `/about` and `/formats` to confirm body text is
   server-rendered, not JS-only.

## Recommended order
Batch 1 (correctness) -> Batch 2 (about page, the ask) -> Batch 3 (schema) ->
Batch 4 (long tail) -> Batch 5 (polish). 1 and 2 deliver most of the value.
