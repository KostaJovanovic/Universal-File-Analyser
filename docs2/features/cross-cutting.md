# Cross-cutting features

Features that apply across many file types rather than one: hashing and the
integrity card, the OSINT network-indicator card, the "Export data" chooser,
metadata search, the hex-dump fallback, the forensic integrity cards, and the
`/compare` two-file view. Sources: `core/forensics.js`, `core/osint.js`,
`core/export-data.js`, `core/search.js`, `renderers/unknown.js`,
`renderers/compare.js`, and the hash-cell wiring in `core/util.js` / `app.js`.

### Hashing and the Integrity card

**What it does.** Every analysed file gets a fingerprint. The Integrity card shows
the SHA-256 and, on demand, more checksums.

**How to reach it.** Automatic. Most renderers build their own SHA-256 row
(`sha256Row` in `util.js`); those that don't get a standard `integrityCard()`
appended by `handleFile` (guarded by `findIntegrityCard` so there's no duplicate;
see `docs2/pipeline.md`).

**How to use it.** SHA-256 computes automatically under 50 MB (`SHA256_AUTO_LIMIT`);
above that a button triggers it (hashing reads the whole file). A **Show more
hashes** affordance (`extraHashRows`) adds CRC-32, MD5, SHA-1 and SHA-512 over one
in-memory read. CRC-32 is noted as a non-cryptographic checksum.

### OSINT network-indicator card

**What it does.** Pulls URLs, IP addresses, domains and email addresses out of a
file's text and lists them with one-click lookup links to public OSINT services.

**How to reach it.** Built by `buildOsintCard`/`osintCard` in `core/osint.js`,
surfaced by the unknown/text viewers and others when a file has extractable text.

**How to use it.** Click an indicator to open a third-party lookup in a new tab.
**Nothing is sent automatically** - a link only contacts a service when *you* click
it, so the no-upload promise holds.

### Export data

**What it does.** Exports the whole on-page analysis in one of four formats.

**How to reach it.** The **Export data** button (left of "Analyse next file?"),
wired by `wireExportButton()` in `core/export-data.js`.

**How to use it.** Choose:

- **Complete report (HTML)** - a single self-contained `.html` with every metadata
  table inline and the visuals (spectrogram, histogram, previews, maps) embedded as
  base64. Opens in any browser, works offline.
- **PDF (print)** - opens that report and launches the print dialog ("Save as PDF").
- **Machine-readable (JSON)** - every field, table and text block, typed and grouped
  by section.
- **Plain text (CSV)** - a flat Section/Group/Field/Value sheet; text blobs are
  capped and images are noted as placeholder rows.

**Notes / limits.** Everything is scraped from the rendered DOM, so it works for any
format without per-format code; all generation is local.

### Metadata search

**What it does.** Highlights matching cards/rows across all result panels, with
synonym expansion and prev/next navigation.

**How to reach it.** The Search control (wired by `initSearch()` in `core/search.js`);
a separate overlay on mobile.

### Forensic integrity cards

**What it does.** Two content-vs-name checks, prepended above the analysis.

**How to reach it.** Automatic (non-forced loads), from `core/forensics.js`:

- **Signature mismatch** (`signatureCheck`/`signatureCard`) - the declared extension
  contradicted by the bytes (a renamed or disguised file).
- **Trailing data** (`trailingDataCheck`/`trailingCard`) - content smuggled past a
  file's logical end (polyglot content); an **"Analyse appended data"** button
  (`setReanalyse`) re-runs the pipeline on the trailer.

A related dotenv "never share this" warning is prepended for `.env` secrets files
(`isEnvFile` in `app.js`).

### The hex-dump fallback (unknown / extensionless)

**What it does.** The last-resort inspector: a best-effort magic-byte label, a
hex/ASCII dump, an entropy profile, SHA-256, the OSINT card, and enhanced previews
for plain text/JSON/XML.

**How to reach it.** `renderUnknown` (`renderers/unknown.js`) for `kind: 'unknown'`;
in `extensionless` mode it is framed as an expected category shown as text (hex
fallback for binary). It also offers still-image recovery for blobs (`carveImages`,
`repairJpeg` - see `docs2/features/images.md`).

### `/compare` two-file view

**What it does.** Runs two files through the same analysis side by side and
highlights every field where they differ.

**How to reach it.** The `/compare` page: drop or pick two files into the A/B zones;
the comparison runs automatically once both are present (`renderers/compare.js`; see
`docs2/pages.md`).

**How to use it.** Each file is analysed by the real renderer, and the readout cells
are **moved** into merged `Field | A | B` tables (so tooltips and deferred async
fills like SHA-256 keep working). Differing rows are tagged `.is-diff`, which powers
the **Show differences** toggle; non-readout content (previews, players, hex dumps)
falls back to a side-by-side A | B split. Both files count toward the anonymous
analysed tally.
