# Cross-cutting features

Features available across many or all file types, rather than owned by one
format: hashing, the OSINT network-indicator card, exporting the analysis,
in-page metadata search, the hex-dump fallback, forensic integrity cards,
and the `/compare` two-file view. Source: `web/assets/js/core/osint.js`,
`web/assets/js/core/export-data.js`, `web/assets/js/core/search.js`,
`web/assets/js/core/forensics.js`, `web/assets/js/renderers/unknown.js`,
`web/assets/js/renderers/compare.js`, plus the hash-cell helpers in
`web/assets/js/core/util.js`.

### File hashing (SHA-256 and extras)

**What it does.** Every analysis includes a SHA-256 fingerprint of the
file's exact bytes, with CRC-32/MD5/SHA-1/SHA-512 available on demand.

**How to reach it.** Automatic in the Integrity card most renderers append
(`util.js`'s `sha256Row()`/`integrityCard()`) - the SHA-256 value fills in
asynchronously after hashing completes.

**How to use it.** Click **Show CRC-32 / MD5 / SHA-1 / SHA-512** (inserted
right below the SHA-256 row) to compute and reveal the additional hashes.

```demo
card: Integrity
  text: **SHA-256** fills in asynchronously once hashing completes.
  btn: Show CRC-32 / MD5 / SHA-1 / SHA-512
```

**Notes / limits.** For very large files where hashing the whole file
up-front would be slow (notably video), the hash is instead gated behind an
explicit **Compute SHA-256** button rather than computed automatically -
see [`video.md`](video.md).

### Fuzzy hashing (ssdeep / CTPH)

**What it does.** Answers a question no cryptographic hash can: not "are
these two files identical" but "how much of them is the same". A fuzzy hash
slides a 7-byte window along the file and cuts a block wherever a rolling
hash of that window hits a trigger value, so the boundaries are decided by
the content around them. Insert a byte and one boundary moves while the rest
stay put - which is exactly what a fixed-block scheme cannot do, since there
every boundary after the insertion shifts and every block hash changes.

**How to reach it.** On [`/compare`](../pages.md), below the cryptographic
hashes: a **Fuzzy hash** row with each file's signature and a **Similarity**
row scoring them out of 100. Built in `lib/ssdeep.js`.

**Notes / limits.** This is a from-scratch implementation of the published
spamsum algorithm (Tridgell, 2002) as ssdeep standardised it - same rolling
hash, same FNV block hash, same trigger rule, same scoring - so the strings
are ordinary ssdeep signatures and can be compared against one from
elsewhere. Two files can only be scored when their block sizes are equal or
one is double the other, which is why every signature carries a second hash
at double the block size; when they still don't line up the row says so
rather than reporting 0 and implying dissimilarity. Files over
`FUZZY_HASH_MAX` (256 MB) are skipped - it is a whole-file read that may run
more than once. There is no corpus to match against: everything stays on the
device, so this compares the two files in front of you and nothing else.

### OSINT network-indicator extraction

**What it does.** Pulls URLs, IP addresses, domains and email addresses out
of a file's text and builds a "Network indicators" card listing them with
one-click lookup links to public OSINT services (VirusTotal, urlscan,
AbuseIPDB, Shodan depending on indicator type).

**How to reach it.** Automatic wherever a renderer has extractable text
(built via `osintCard()`/`buildOsintCard()` in `osint.js`, e.g. from
`unknown.js`). Domain extraction filters out filename-shaped false
positives (a token like `bundle.min.js` isn't reported as a domain) via a
`FILE_TLDS` denylist, and IPv4 matches are octet-validated.

**How to use it.** Click any lookup link (VirusTotal, urlscan, AbuseIPDB,
Shodan) to open that service in a new tab.

```demo
card: Network indicators
  btn: VirusTotal
  btn: urlscan
  btn: AbuseIPDB
  btn: Shodan
```

**Notes / limits.** Nothing is ever sent automatically - links only open a
third-party service when clicked, preserving the no-upload promise. Each
indicator list is capped (300 extracted, 100 shown by default).

### Export analysis data

**What it does.** Exports everything currently on the page (every metadata
table, plus visuals) in one of four formats: **Complete report (HTML)** - a
single self-contained file with every table inline and visuals
(spectrogram, histogram, previews, maps) embedded as base64 images, opens
in any browser, works offline; **PDF (print)** - opens that same report in
a new tab and launches the browser's print dialog ("Save as PDF"); **JSON**
- every field/table/text block, typed and grouped by section; **CSV** - a
flat Section/Group/Field/Value sheet (text blobs like hex dumps/OCR text
are capped at 5000 chars; images become placeholder rows since a CSV can't
hold them).

**How to reach it.** Click **Export data** (next to "Analyse next file?").
Built in `export-data.js`.

```demo
btn: Export data
```

It offers four export formats:

```demo
btn: Complete report (HTML)
btn: PDF (print)
btn: JSON
btn: CSV
```

**Notes / limits.** Pure read-side: it scrapes the rendered DOM
(`.anr-card`/`.anr-readout` tables the renderers already built) rather than
needing per-format export logic, so it works automatically for every
current and future renderer. Everything is generated locally; nothing
leaves the browser.

### In-page metadata search

**What it does.** Highlights matching cards/rows across all result panels
as you type, with synonym expansion and prev/next navigation between
matches.

**How to reach it.** The search box in the sticky nav (desktop: inline
arrows; mobile: a dedicated full-screen overlay with its own prev/next/
close controls). Built in `search.js`'s `initSearch()`.

**Notes / limits.** Re-initialises on every SPA navigation, tearing down
the previous run's mobile overlay and resize listener first so neither
accumulates duplicates across page swaps.

### Hex-dump / unknown-file inspector (fallback)

**What it does.** The last-resort renderer for files with no dedicated
viewer: a magic-byte format guess, hex/ASCII dump, SHA-256, and enhanced
previews for plain text, JSON and XML.

**How to reach it.** Automatic for any `unknown`/`extensionless` kind (see
[`pipeline.md`](../pipeline.md)). Built in `unknown.js`.

**How to use it.** **Show full text** reveals the complete text of a large
text-like file (initially truncated); if the JSON inspector detects a
Lottie-shaped structure, **▶ Play as Lottie animation** offers to play it
(see [`animation-frames.md`](animation-frames.md)); when an embedded/carved image is
detected inside the blob, per-image **Analyse**/**Download** buttons hand
off to the photo pipeline via `photo-recover.js`.

```demo
btn: Show full text
btn: ▶ Play as Lottie animation
btn: Analyse
btn: Download
```

### Forensic integrity cards

**What it does.** Two content-vs-name checks surfaced as readout cards on
any file where they're conclusive: **signature mismatch** (the declared
extension is contradicted by the file's actual leading bytes - a
renamed/disguised file or polyglot) and **trailing data** (content
appended past a file's logical end, smuggled in). Both are built from
`file-sniff.js`'s `sniffFileType()` result.

**How to reach it.** Automatic wherever conclusive - shown for a defined
allow-list of extensions whose true magic bytes `sniffFileType()` can
positively confirm (JPEG, PNG, PDF, ZIP-family, ISO-BMFF-family, and more);
extensions not on that list get no warning, since an unconfirmed magic
would risk a false positive. Built in `forensics.js`.

**How to use it.** The trailing-data card offers a button to re-analyse the
appended blob as its own file (wired via `setReanalyse()`, which app.js
injects with its `handleFile` callback to avoid a circular import).

**Notes / limits.** Container families that legitimately share one magic
(ISO-BMFF: mp4/heic/avif/m4a/3gp; the ZIP-based Office/EPUB/OpenDocument
family) are grouped so renaming within the family (e.g. `.m4a` to `.mp4`)
doesn't falsely flag a mismatch. `findIntegrityCard()` locates an existing
integrity readout in a container, for callers that need to slot content
near it or to avoid appending a duplicate. It accepts two shapes: a card of
its own led by an `<h3>` starting with "Integrity" (what most renderers
build), or any element marked `[data-integrity]`, in which case it returns
the enclosing `.anr-card`. The second shape exists for `photo.js`, which
keeps the fingerprints as a part inside its Advanced card.

### /compare - two-file side-by-side view

**What it does.** Runs two files through their normal full analysis (into
off-screen staging containers), then merges the results into one view:
shared field labels down the left, file A's and file B's values in
adjacent columns (`Field | A | B`). Rows whose values differ are tagged
`.is-diff`. Non-readout content (image previews, video players, hex dumps,
histograms) that can't merge cell-by-cell falls back to a side-by-side A|B
split within its card instead.

**How to reach it.** Drop two files onto the `/compare` page's A/B
dropzones (see [`pages.md`](../pages.md)). Built in `compare.js`, called with
`{ classify, routes }` from `app.js` so it reuses the real
`classifyFile()`/`ROUTES`.

**How to use it.** Interactive video/audio sub-prompts (e.g. "Analyse
audio"/"Analyse frame" call-to-action buttons that would normally appear
twice) collapse to **one** central button that fires both files' actions at
once. Click **Show differences** to fade every row where A and B match,
leaving only the differing rows visible; click again to show everything.

```demo
btn cta: Analyse audio
btn: Show differences
```

**Notes / limits.** The merge **moves** (not clones) the real DOM cells
from each file's staged render into the merged table, so tooltips and
deferred async fills (like the SHA-256 cell, which resolves after hashing)
keep working - including a second pass that corrects a hash row's
`.is-diff` tag once the async hash comparison actually resolves (its
initial tag, decided from still-empty cells, can be wrong). Media
renderers are invoked with `{ inline: true }` so they target the compare
panel rather than the main page's fixed sections
(`#photoPreview`/`#videoPreview`/etc.).
