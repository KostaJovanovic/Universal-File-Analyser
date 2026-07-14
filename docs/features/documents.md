# Documents

PDF, paginated document rendering, DjVu scans, Office formats (modern OOXML
and legacy binary), OpenDocument, iWork, e-books, notebooks, Access
databases, and Markdown. Source: `pdf.js`, `paged.js`, `djvu.js`, `docx.js`,
`xlsx.js`, `xlsb.js`, `pptx.js`, `odf.js`, `legacy-office.js`, `textdoc.js`,
`iwork.js`, `epub.js`, `mobi.js`, `mdb.js`, `notebook.js`, `markdown.js`.

### PDF viewer

**What it does.** The most feature-complete document viewer on the site:
metadata, forensic document-structure analysis, full text extraction,
page-thumbnail previews with a full-page lightbox, embedded raster image
extraction, and OCR - all via the vendored **pdf.js**.

**How to reach it.** Drop any `.pdf`. Built in `web/assets/js/renderers/pdf.js`.

**How to use it.**

- **Info card**: application/name/size/page count, Title/Author/Creator/
  Producer, creation/modification dates, PDF spec version, page 1
  dimensions (points, inches, mm), plus a timestamp-anomaly check (future
  dates, modified-before-created, vs. the file's own last-modified time).
- **Document structure & security card** (shown only when something is
  found): revision count (each save appends a `%%EOF` marker - more than one
  means incremental edits are preserved inside the file), linearisation
  ("fast web view"), trailing data after the final `%%EOF` (⚠ a
  polyglot/tamper tell), outline/table of contents (expandable), embedded
  file attachments, **embedded JavaScript** with a heuristic risk scan
  (flags network/file-access/launch/obfuscation/crypto patterns per script,
  and separately flags auto-run triggers like "Document open" as the
  riskiest kind), encryption/permissions (allowed vs. restricted actions:
  print/copy/modify), Keywords/Subject/PDF-A conformance from XMP, and a
  fonts list (embedded vs. not-embedded, a portability/authenticity tell).
- **Text content**: extracted per page with reconstructed line breaks;
  **Copy** per page; **Show next 3 pages**/**Show all** reveal more. If a
  page has no embedded text (image-only/scanned), a note points at OCR
  instead.
- **Page previews**: thumbnails for the first 4 pages (**Show next 3
  pages**/**Show all** for the rest). Click a thumbnail to open a full-page
  lightbox with **Prev**/**Next**, **Zoom** (double-click/double-tap, or the
  toolbar button), and **High-res** (re-renders the current page at higher
  resolution for sharper zoom, at a memory/speed cost) - plus a selectable
  text layer overlaid on the canvas. Per-thumbnail hover actions (always
  visible on touch): **Analyse** (renders the page to an image and sends it
  through the full photo pipeline), **OCR** (Tesseract on that one page,
  shown in a popup overlay), **PNG** (downloads the page as an image).
- **Embedded images**: click **Extract embedded images** to pull the
  original raster images (logos, photos, scans) out of the PDF's content
  streams - distinct from the rendered page previews. Each found image gets
  a download link and an **Analyse** button (up to 300 images).
- **OCR - Scan pages as images** (collapsible): click **Scan all pages** to
  run Tesseract across every page (language picker first), with a progress
  bar; **Show more**/**Show all** reveal more pages of the transcript.

Per-page text controls:

```demo
btn: Copy
btn: Show next 3 pages
btn: Show all
```

The full-page lightbox toolbar:

```demo
btn: Prev
btn: Next
btn: Zoom
btn: High-res
```

Per-thumbnail hover actions, plus the embedded-image and OCR entry points:

```demo
btn: Analyse
btn: OCR
btn: PNG
```

```demo
btn: Extract embedded images
btn: Scan all pages
```

**Notes / limits.** pdf.js is lazy-loaded. OCR and per-page rendering are
CPU-heavy for large documents; the UI stages results in batches so nothing
blocks on a full-document scan by default.

### Shared page-preview presentation (Word/ODF/spreadsheet/presentation text)

**What it does.** Formats that have no real page geometry of their own
(Word/ODF flowing text, spreadsheets, presentations) get the same "page
sheet" experience as PDF: `paginateFlow()` lays flowing content onto
A4-proportioned sheets (breaking to a new sheet when one fills, never
splitting a block mid-page), and `pagedPreviewCard()` builds the thumbnail
grid + lightbox reader.

**How to reach it.** Not used directly - it's the shared rendering
substrate for `docx.js`, `odf.js`, `legacy-office.js`, and `textdoc.js`
(callers with genuine natural pages, like one-slide-per-page presentations,
build their own page nodes and skip straight to `pagedPreviewCard`). Built
in `paged.js`.

**How to use it.** Same controls as PDF's thumbnail/lightbox pattern: **Show
next N pages**/**Show all**, per-page **Copy**, and **Copy all text**.

```demo
btn: Show next 3 pages
btn: Show all
btn: Copy all text
```

### DjVu scanned documents

**What it does.** Decodes and renders DjVu pages (a scanned-document format
common for archived books/journals) to canvas, with prev/next paging.

**How to reach it.** Drop a `.djvu`/`.djv`. Built in `djvu.js` around the
vendored pure-JS **DjVu.js**.

**How to use it.** **‹ Prev**/**Next ›** page through the document; the
pager is disabled while a page is rendering (decoding a scanned page can
take a moment).

```demo
btn: ‹ Prev
btn: Next ›
```

**Notes / limits.** On memory-constrained (mobile) devices, files over
200MB are rejected with a message to try a desktop browser instead - the
whole document is decoded page-by-page in a WASM heap, which can crash a
phone tab.

### DOCX (Word)

**What it does.** Reads Office Open XML Word documents and renders a
simplified document view: metadata, formatted text (via the shared
page-preview presentation), tables, and text extraction.

**How to reach it.** Drop a `.docx`/`.docm`/`.dotx`/`.dotm`. Built in
`docx.js`.

**How to use it.** Click any embedded inline image to send it through the
full photo analyser.

### XLSX (Excel, OOXML)

**What it does.** Reads Office Open XML spreadsheets and renders each
worksheet as a table with sheet tabs and document metadata.

**How to reach it.** Drop a `.xlsx`/`.xlsm`/`.xltx`/`.xltm`. Built in
`xlsx.js`.

**How to use it.** Click a **sheet tab** to switch worksheets. Each sheet
lazily mounts the full `tablekit.js` table/chart workbench (sort/filter/
search/hide/reorder columns, a chart builder, PNG/JSON/CSV export) - see
[`data-archive.md`](data-archive.md).

### XLSB (Excel Binary Workbook)

**What it does.** `.xlsb` stores a workbook in the binary BIFF12 record
format rather than XLSX's XML, so the in-house OOXML reader can't open it -
this uses the vendored **SheetJS** community build purely to decode it into
sheets, rendered with the same table UI as `.xlsx`.

**How to reach it.** Drop a `.xlsb`. Built in `xlsb.js`.

**How to use it.** Same sheet-tab switching and `tablekit.js` mounting as
XLSX. Metadata additionally flags **⚠ Contains macros (VBA project)** when
present.

### PPTX (PowerPoint)

**What it does.** Reads Office Open XML presentations and renders each
slide as a card with its title/body text and any embedded images, in
presentation order.

**How to reach it.** Drop a `.pptx`/`.pptm`/`.ppsx`/`.ppsm`/`.potx`/`.potm`.
Built in `pptx.js`.

**How to use it.** Click a slide thumbnail to open it full-size in a
lightbox (**×** to close); click an embedded image inside a slide to
analyse it as a photo.

### ODF (OpenDocument: ODT/ODS/ODP)

**What it does.** OpenDocument files are ZIP packages whose payload is
`content.xml` (plus `meta.xml` and a `Pictures/` folder). This converts that
XML into the same shared page-preview presentation as DOCX/XLSX/PPTX, so
ODT reads like the DOCX viewer, ODS like the XLSX viewer, and ODP like the
PPTX viewer.

**How to reach it.** Drop a `.odt`/`.ott`/`.fodt`/`.sxw` (text), `.ods`/
`.ots`/`.fods`/`.sxc` (spreadsheet), `.odp`/`.otp`/`.fodp`/`.sxi`
(presentation), or `.odg`/`.otg`/`.fodg`/`.sxd` (graphics). Built in
`odf.js`.

**How to use it.** Text documents get `paged.js`'s pagination controls;
spreadsheets mount the `tablekit.js` workbench.

### Legacy binary Office (DOC/XLS/PPT, 97-2003)

**What it does.** The pre-2007 Office formats are OLE2/Compound File
containers, not ZIP+XML - there's no clean styled layout to recover the way
DOCX/ODT give, so this is deliberately best-effort: it pulls the readable
content out and shows it through the same page-sheet preview as the other
document viewers. `.doc` reads Word text via the FIB piece table
(CLX/PlcPcd), paginated as pages.

**How to reach it.** Drop a `.doc`, `.xls`, or `.ppt`. Built in
`legacy-office.js`.

**How to use it.** Same pagination controls as the other paged-document
viewers; a plain hyperlink list surfaces embedded/external links the legacy
document referenced.

### Text and lightweight-markup documents

**What it does.** A family of formats whose content is really just text or
simple XML/HTML, each shown as readable prose or selectable source: markup
source (DITA, TEI, JATS, reStructuredText, AsciiDoc, Org, Textile,
TeX/LaTeX, BibTeX), RTF (control words stripped to readable prose),
AbiWord (`.abw`, XML), FictionBook (`.fb2`, XML e-book), HWPX, MHTML.

**How to reach it.** Drop any of the above extensions. Built in
`textdoc.js`, reusing `paged.js`'s pagination controls (Show next N pages/
Show all, Copy all text, per-page Copy).

### Apple iWork (Pages / Numbers / Keynote)

**What it does.** Modern iWork files (2013+) store content as
Snappy-compressed, undocumented Protocol Buffer streams in `Index/*.iwa` -
there's no practical way to re-render that in the browser. Instead,
Analyser shows the QuickLook preview Apple bakes into the package: an
embedded `Preview.pdf` (rendered page-by-page via the PDF viewer) or,
failing that, the largest preview/thumbnail image. Files saved without a
preview fall back to a metadata-only readout.

**How to reach it.** Drop a `.pages`/`.numbers`/`.key`/`.keynote`. Built in
`iwork.js`.

**How to use it.** If a `Preview.pdf` exists, it's shown via the full PDF
viewer (inheriting all its controls). Otherwise, if a thumbnail image
exists, click **Analyse this image** to send it through the photo pipeline.

```demo
btn: Analyse this image
```

**Notes / limits.** `.key` collides with PEM cryptographic key files (not a
ZIP); if the dropped `.key` isn't actually a ZIP package, it's handed to
`proprietary.js`'s identifier instead so a real private key still gets
read. Format detected as "iWork 2013+ (IWA)" vs. "iWork '09 (XML)" based on
package contents.

### EPUB reader

**What it does.** Reads zipped XHTML e-books: metadata, cover, and
chapter-by-chapter reading with navigation.

**How to reach it.** Drop a `.epub`. Built in `epub.js`.

**How to use it.** **← Prev**/**Next →** page through chapters; the
**chapter select** dropdown jumps directly to any chapter.

```demo
btn: ← Prev
btn: Next →
```

### Kindle / Mobipocket e-books (MOBI/AZW/AZW3)

**What it does.** Decodes MOBI 6 and KF8 (AZW3, and combo `.mobi`) e-books
fully in the browser via the vendored **foliate-js**: metadata and cover,
then a section-by-section reader with each section decoded to a
self-contained HTML blob shown in a sandboxed (scriptless) iframe with
images resolved.

**How to reach it.** Drop a `.mobi`/`.azw`/`.azw3`. Built in `mobi.js`.

**How to use it.** **‹ Prev**/**Next ›** step through sections; the pager
is disabled while a section loads (KF8's HUFF/CDIC decompression can be
slow).

```demo
btn: ‹ Prev
btn: Next ›
```

### Microsoft Access databases (MDB/ACCDB)

**What it does.** Opens a Jet/ACE database fully in the browser via the
vendored **mdb-reader**: lists user tables with their columns and row
counts, and shows a sample of rows from each - the same table UI as the
spreadsheet viewers.

**How to reach it.** Drop a `.mdb`/`.accdb`. Built in `mdb.js`.

**How to use it.** Click a **table tab** to switch tables; rows are capped
at 200 shown per table (a note states the true count when truncated).

### Jupyter notebooks

**What it does.** Renders an `.ipynb` the way a reader sees it: narrative
markdown cells, code cells with their `In[n]` prompt, and captured outputs
(stream text, execute results, rich display data including PNG/JPEG images
decoded from base64 data URIs, and errors).

**How to reach it.** Drop a `.ipynb`. Built in `notebook.js`.

**How to use it.** **Show more cells**/**Show all** reveal more of a long
notebook.

```demo
btn: Show more cells
btn: Show all
```

### Markdown

**What it does.** Renders `.md`/`.markdown` as formatted HTML alongside
document stats and the raw source, using a self-contained CommonMark-ish +
GitHub-Flavoured-Markdown parser (no dependency): headings (ATX + setext),
bold/italic/strikethrough, inline and fenced code, links, images,
blockquotes, nested ordered/unordered lists, task lists, GFM tables, and
horizontal rules.

**How to reach it.** Drop a `.md`/`.markdown` file. Built in `markdown.js`.

**Notes / limits.** All text is HTML-escaped and raw inline HTML is
rendered as literal text - the renderer never executes embedded HTML/script
content, for safety when previewing an untrusted Markdown file.
