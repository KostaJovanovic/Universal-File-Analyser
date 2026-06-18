# Content / copy inconsistencies - Analyser site

Scan date: 2026-06-18. Scope: user-facing text only (HTML pages, footer partial,
catalog `label`/`desc`/`tags` in formats.js, blurbs/facts in
format-page-content.mjs, generated copy in prerender-*.mjs). Internal `.md` and
code comments excluded.

House style being checked: British spelling; NO em-dash (spaced " - " instead);
consistent terminology and metrics.

Good news up front:
- **No literal em-dash (—)** found anywhere in user-facing text (HTML, formats.js,
  footer partial, tool .mjs). The em-dash-free rule is holding.
- British spelling is near-uniform (colour, analyse, visualise, colourmap,
  sanitise, organise) except for the items in section B below.

Ranked by severity: factual/metric drift first, then terminology, then style.

---

## A. FACTUAL / METRIC DRIFT (highest severity)

### A1. Offline download tier sizes contradict themselves on about.html
The footer (single-sourced, identical on every page) and the offline panel state
the three tiers as **50 MB / 78 MB / 325 MB**. But the about.html "Where" prose
still quotes the **OLD** sizes:

- `about.html:203` -
  "Use the download buttons on the main page to pre-cache dependencies, from the
  essentials (**~48 MB**) up to all OCR languages (**~310 MB**; the larger packs
  stream from a CDN)."

This disagrees with the canonical tiers shown 8 lines of footer below it on the
same page (`about.html:409-430`: 50 / 78 / 325 MB) and on every other page's
footer (`index.html:268-290`, `stats.html:146-167`, `privacy.html:139-160`,
`formats.html:1149-1170`, `atari.html:104-125`, `tools/partials/footer-shared.html:20-41`).
**Also note the `~` was deliberately dropped from the footer sizes (per patch 2.17)
but about.html keeps the `~`.**
- Fix: update `about.html:203` to "from the essentials (50 MB) up to all OCR
  languages (325 MB; ...)" - drop the tilde and use the current tier numbers.
  (The middle "Everything" tier is 78 MB.)

### A2. Format count: "1061" vs "1,000+" / "over 1,000" / "1,000-plus" drift
The exact catalog count is **1061** (stamped live via `data-fmt-count` and the
`<!--FMTCOUNT-->` markers). User-facing copy mixes the precise number with vague
round figures, inconsistently:

Exact "1061" / "1061+":
- `index.html:7,15,23,37` (meta/JSON-LD: "1061+ file types"/"file formats")
- `index.html:52` ("Identification of 1061+ file formats")
- `index.html:156,173` ("1061+ formats", overlay count "1061")
- `about.html:271,278,373` ("1061+ formats", "Browse all 1061 supported formats", overlay "1061")
- `formats.html:41,95,1113` ("1061 formats")
- File-ID dependency line "**1061+ file formats**" in EVERY footer
  (`index.html:323`, `about.html:464`, `stats.html:201`, `privacy.html:194`,
  `formats.html:1204`, `atari.html:159`, `tools/partials/footer-shared.html:75`)

Vague "1,000+" / "over 1,000" / "1,000-plus" (all on about.html + patch.html):
- `about.html:7,15,23` (meta description: "1,000+ formats")
- `about.html:72,348` (FAQ: "Over 1,000 file types")
- `about.html:112` (JSON-LD HowTo: "over 1,000 types")
- `about.html:218` ("over 1,000 file formats")
- `about.html:308` ("over 1,000 types")
- `formats.html:7,15,23` (meta description: "1,000+ formats")
- `patch.html:424,446` ("all 1,000-plus of them" / "1,000-plus file types")
  - these are historical patch entries (2.24/2.20), so arguably frozen, but they
    are the only place "1,000-plus" appears.
- Severity note: this is a deliberate-vs-precise inconsistency rather than a hard
  contradiction (1061 is "over 1,000"), but the index.html meta uses the exact
  "1061+" while about.html/formats.html meta use "1,000+" - the two homepage-tier
  SEO descriptions disagree on register. Recommend picking ONE convention for meta
  descriptions (either all exact "1,000+"-style or all live-stamped) so the count
  doesn't read as stale on one page and precise on another. The about.html "Where"
  body figures (~48/~310) in A1 are the genuinely wrong ones.

### A3. "Counting began" date - single source, verify against reality
- `stats.html:88` - "Counting began on 12 June 2026."
This is the only occurrence (no drift), but it is hand-stamped prose. Flagging for
verification only: confirm 12 June 2026 is the true counter epoch (patch 2.39
"Head Count", which introduced the counters, is dated `12 June 2026, 04:31` in
`patch.html:335` - consistent). No fix needed unless the epoch differs.

---

## B. US vs BRITISH SPELLING

### B1. "spiraled" (US) - should be "spiralled"
- `about.html:187` - "I have made this tool primarily for my needs, but it
  **spiraled** out of control..."
  - British spelling is **spiralled** (double-l). Only US-spelling instance found
    in body copy. Fix: "spiralled".

(No other US-spelling violations found: analyse/analysed, colour/colourmap,
visualise/visualisation, sanitise, organise all British throughout. Matches for
"catalog", "Optimized", "Visualization", "color" were all inside proper nouns -
format/product names like "Lightroom catalog", "Camera catalog", "Optimized Row
Columnar", "Visualization Toolkit", and CSS `prefers-color-scheme`/`color:` style
attributes - not prose, so they are correct as-is.)

---

## C. TERMINOLOGY DRIFT

### C1. "ebook" (unhyphenated) vs "e-book" (hyphenated) - mixed
House body copy strongly prefers **"e-book"** (hyphenated), but category labels and
several catalog/blurb strings use unhyphenated **"ebook(s)"**. Both render to users.

Hyphenated "e-book" (the majority / preferred):
- about.html `248,348`, footer "E-books" dt on every page
  (`index.html:317`, etc.), formats.html `432`, formats.js `123` ("Kindle e-book"),
  and most format-page-content.mjs blurbs ("e-book format", lines 343-346, 995,
  1031-1032, 1188-1191).

Unhyphenated "ebook(s)" (the drift):
- `formats.js:225` - category label **`'Documents & ebooks'`** (renders as the
  section heading on formats.html:400 and the about-page table).
- `formats.js:257` - label `'Documents / ebooks (more)'` and key `'eBooks'`
  (note the third casing variant, **camelCase "eBooks"**).
- `formats.js:124` desc - "and EPUB **e-books**" (hyphenated - OK, but same row's
  tags use "ebook")
- `formats.js:125` desc - "FictionBook **ebooks** (FB2)" (unhyphenated)
- `formats.html:400,482,487,1054` - generated headings/descs: "Documents &amp;
  ebooks", "Documents / ebooks (more)", "documents, **ebooks** and publishing",
  "document, **ebook** and publishing files".
- format-page-content.mjs `146` ("EPUB **ebook**", "open **ebook** format"),
  `343,344,345` (names "Mobipocket ebook", "Kindle ebook (AZW)", "Kindle ebook
  (AZW3)"), `990` ("Documents, **ebooks** & publishing" section comment-adjacent
  copy), `1031,1032,1188-1191` (names "Microsoft Reader ebook", "Kindle KFX
  ebook", "Shanda Bambook ebook", "Sony BBeB ebook", "Psion ebook").

Net: THREE spellings in play - **e-book**, **ebook**, **eBook**. Pick one
(recommend "e-book" to match body copy and the footer "E-books" dt) and normalise
the category label `formats.js:225/257`, the formats.js descs, and the
format-page-content.mjs names/blurbs. The generated formats.html lines update
automatically once formats.js is fixed and the prerender script re-runs.

### C2. "spectrogram" casing - consistent (no issue)
All lowercase "spectrogram" in prose; "Live spectrogram" button (index.html:147)
is sentence-case, correct. No drift. (Listed only to confirm checked.)

### C3. Brand names - consistent (no issue found)
SolidWorks, SketchUp, OpenStreetMap, Fusion 360, DaVinci Resolve, Premiere Pro all
spelled uniformly with correct internal capitals across formats.js,
format-page-content.mjs and formats.html. No "Solidworks"/"Sketchup"/"Openstreetmap"
variants found. (Confirmed checked.)

### C4. "in-browser" vs "in your browser" - both used, but consistently scoped
- "in your browser" is used in running prose ("runs entirely in your browser",
  "Open any file in your browser").
- "in-browser" is used adjectivally ("the in-browser 3D viewer", meta image alt
  "in-browser file metadata ... tool", formats.js descs "in-browser").
These are grammatically distinct uses (adverbial phrase vs compound adjective), so
this is acceptable rather than a true inconsistency. No fix required - noted so it
isn't re-flagged.

---

## D. CAPITALISATION / PUNCTUATION

### D1. Offline tier feature copy - "iPhone (HEIC)" parenthetical only in some places
The "Everything" tier description appears twice per page (help-panel + button) and
reads identically ("...iPhone (HEIC) photos and archives"), and the about.html
"Where" prose paraphrases it differently. Not a contradiction, just two phrasings;
low priority. No fix needed unless tightening is wanted.

### D2. "Office docs" label vs "Office documents & presentations" heading
- `formats.js:124` label is **"Office docs"** (abbreviated).
- `about.html:243` uses the dt heading **"Office documents & presentations"** (full).
Both are fine in their own contexts (compact catalog label vs descriptive about-page
dt); flagged only as a register difference, not an error.

---

## Summary of actionable fixes (in priority order)

1. **about.html:203** - replace "~48 MB" / "~310 MB" with the current tier numbers
   (50 MB / 325 MB) and drop the tildes. (Hard metric contradiction - A1.)
2. **about.html:187** - "spiraled" -> "spiralled". (US spelling - B1.)
3. **Normalise "ebook" -> "e-book"** across `formats.js:225,257,125` (category
   labels + desc), and the names/blurbs in `tools/format-page-content.mjs`
   (lines 146, 343-345, 1031-1032, 1188-1191, and the "eBooks" camelCase key at
   formats.js:257), then re-run the prerender generators so formats.html follows.
   (Terminology - C1.)
4. **Optional/SEO**: align the meta-description format count register - about.html
   and formats.html meta use "1,000+" while index.html meta uses "1061+". (A2.)
