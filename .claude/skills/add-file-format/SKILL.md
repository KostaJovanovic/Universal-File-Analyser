---
name: add-file-format
description: How to add support for a new file type/extension to Analyser (formats.js catalog, proprietary.js parser, EXT_VARIANTS, new renderer, dropzone/patch-note polish). Use when adding, extending, or fixing recognition of a file extension.
---

**`web/assets/js/core/formats.js` is the single source of truth for supported
file types.** (The website lives under `web/`; all asset paths below are relative
to it.) The format overlay (index.html), the "All supported file types" tables
(about.html), the overlay search, and the `classifyFile()` routing in app.js are
all driven from it — edit one file and they all update.

## 1. The catalog (formats.js) — almost always the only file you touch
File: `web/assets/js/core/formats.js`

- **Routing**: add the lowercase extension to the right classification set —
  `PHOTO_EXTS`, `AUDIO_EXTS`, `VIDEO_EXTS`, `CSV_EXTS`, or `SVG_EXTS`. These drive
  `classifyFile()` in app.js. (Two further sets, `DOC_EXTS` and `ARCHIVE_EXTS`,
  don't route — they classify entries for the folder/archive treemap breakdowns.)
- **Display + search**: add (or extend) a row in `FULL_ANALYSIS` (deep analysis)
  or — for identification-only formats — `IDENTIFICATION_CORE` (well-known
  proprietary formats) / `IDENTIFICATION_EXTENDED` (the long-tail expansion, one
  row per parsers/ chunk domain). `IDENTIFICATION` is just the concatenation of
  the two. Each row is `{ label, exts, tags, desc, note? }`:
  - `exts` — space-separated extension list (curated casing) shown in the tables.
  - `tags` — extra search keywords: software/brand names and synonyms so a user
    can find SLDPRT by typing "solidworks". This is what makes the overlay search
    by origin work.
  - `desc` — one keyword-rich sentence shown under the ext list on the about page.
    This is the indexable SEO text for "how to open a .X file"-type searches, so
    name the key software/brands and what Analyser does with the format. The about
    page also gives each row a `#fmt-<slug>` anchor and each extension token an
    `#ext-<ext>` anchor (via renderAboutFormats) for deep-linking.
  - `note` (optional) — prose shown *instead of* the ext list on the about page,
    where a bare extension list undersells the feature (e.g. PDF).
- **Category mapping**: if you add a row with a **new `label`**, also map that
  label to one of the `CATEGORIES` keys in the `CAT_OF` object (same file) —
  the overlay/about list group rows by domain category, and unmapped labels
  fall back to 'system'.
- **Photo conversion**: if it's a photo needing conversion, also add it to
  `HEIC_EXTS` (heic2any) or `RAW_EXTS` (ImageMagick WASM) in this same file.

That's it for the common cases (a new photo/audio/video extension, or a new
identification-only format that also needs a parser — see step 2).

## 2. Header parser for identification-only formats (proprietary.js)
File: `web/assets/js/renderers/proprietary.js`

- Add an entry to the `FORMATS` object: key is the lowercase extension, value is
  `{ app, icon, magic?, parse?, zip? }`. `magic` matches header bytes; `parse`
  is a hint (`'text'`/`'xml'`/`'html'`). Add a dedicated `parseXxx()` if the
  format has a header worth decoding (see `parsePsd`, `parseDwg`, etc.).
- `formats.js` holds the *catalog/display*; `proprietary.js` holds the *parsing
  logic*. A purely identification-only format that just needs to be listed can
  live in `formats.js` alone, but to extract metadata it needs a `FORMATS` entry
  here too.

## 2b. Ambiguous extensions (one extension, several unrelated formats)
Some extensions name genuinely different file types (`.pkg` = macOS installer OR
Destiny package; `.cube` = colour LUT OR Gaussian volumetric grid; `.ts` =
TypeScript OR MPEG transport stream). These are declared in **`EXT_VARIANTS`** in
`formats.js` - the single source of truth, read by two consumers:
- `tools/prerender-format-pages.mjs` renders ONE `/formats/<ext>` page with a
  titled section per variant (instead of the single auto capability block).
- `detectVariant(ext, bytes, text, opts?)` (also in `formats.js`) sniffs the
  bytes/text at drop time so the in-app readout names the right variant.

To add one, add an `EXT_VARIANTS[ext] = { summary, variants: [{ name, desc, tell,
detect? }] }` entry (each `detect` is a rule like `{ magic, hex, hexAt, textStarts,
textIncludes, default }`). Drop-time wiring uses `detectVariant`:
- **Identification path** (`proprietary.js` `renderProprietary`) calls it with
  `{ specificOnly: true }` to set the card title only when a rule actually matched.
- **Heavy-renderer reroutes** (`app.js` `VARIANT_REROUTE` in `handleFile`) divert a
  file whose bytes prove the variant the default renderer can't handle (e.g. a
  TypeScript `.ts` to the text view instead of the video player).

## 3. New top-level category (rare)
If the format isn't photo/audio/video/csv/svg and needs its own renderer:
- Create a module (e.g. `web/assets/js/renderers/newtype.js`), export
  `renderNewtype(file, resultsEl)`.
- Import it in app.js and add a branch in `classifyFile()` and `handleFile()`.
  See how `csv`, `svg`, `pdf`, `zip`, `proprietary` are wired.
- Add the new module to the `SHELL` array in `web/sw.js` for offline caching.

## 4. Optional polish (only if the format is common)
- **Dropzone hints** (`index.html`, quickdrop section): the three dropzones list
  example extensions. Update only if the format is worth calling out.
- **Patch notes** (`patch.html`, section `id="when"` — the public changelog, a
  separate page from about.html): on every commit add one `<div class="patch-entry">`
  at the top (version, 1-3 word Title-Case codename, date/time from
  `git log -1 --format=%ai`, then `<ul class="patch-list">` of concrete changes),
  move what is now the 4th-from-top entry into the `<details class="about-formats">`
  "Older updates" block (exactly the latest 3 stay visible), and fold the release
  into `PATCH_DIGEST` in `app.js` (the "tl;dr" button data) — a short note in the
  newest group, starting a fresh group every 5 versions and keeping the `1.0`/`2.0`
  milestones standalone.
  An in-file HTML comment at the top of that section is the authoritative style
  guide (tags, naming, tone, hyperlink rules). The newest entry's version **must**
  equal the version computed by `analyserVersion()` in `app.js` — never let them
  drift.

See also the `format-seo-pages` skill for the generated `/formats`, `/formats/<ext>`,
and `/samples` pages that read from this same catalog.
