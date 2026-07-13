# Documents (PDF, office, e-books, notebooks, text)

Viewers for paginated documents, office files, e-books, notebooks and plain/markup
text. Most share a common "page preview" presentation (`paged.js`): pages rendered
with selectable, copyable text and progressive **Show more / Show all** loading.
Renderers: `pdf.js`, `paged.js`, `djvu.js`, `docx.js`, `xlsx.js`, `xlsb.js`,
`pptx.js`, `odf.js`, `legacy-office.js`, `textdoc.js`, `iwork.js`, `epub.js`,
`mobi.js`, `mdb.js`, `notebook.js`, `markdown.js`. Routing is by extension (see
`docs2/pipeline.md`).

### The shared page-preview presentation

**What it does.** Renders a document as page sheets with selectable text.

**How to reach it.** Used by DOCX, ODF, legacy Office, text/markup, iWork and PDF
via `paged.js`.

**How to use it.** **Show next N pages** / **Show all** load more pages; **Copy**
(per page) and **Copy all text** copy the extracted text. Click a page to open it in
a full-screen overlay.

### PDF

**What it does.** Renders pages, extracts text and embedded images, runs OCR on
image-only pages, and reads metadata plus document structure/security.

**How to reach it.** Drop a `.pdf` (`pdf.js`, using pdf.js); modern `.ai` files
reuse the same renderer via `illustrator.js`.

**How to use it.** Page through the preview; **Extract embedded images** pulls out
the images (each with **Analyse** / **Download**); the **OCR - Scan pages as images**
control recognises text on scanned pages (with the shared language picker - see
`docs2/features/images.md`); the "Document structure & security" card reports the PDF
internals and any encryption. Timestamp anomalies are flagged.

**Notes / limits.** OCR needs Tesseract (Everything tier); non-English languages
download on first use.

### DjVu

**What it does.** Decodes and renders DjVu scanned-document pages with paging.

**How to reach it.** Drop a `.djvu`/`.djv` (`djvu.js`, DjVu.js). Reads the page count
and dimensions; pages render to images with prev/next.

### Microsoft Office (modern, binary, and OpenDocument)

**What it does.** Opens Word/Excel/PowerPoint (OOXML), the binary XLSB, the legacy
97-2003 binaries, and the full OpenDocument family as page/sheet/slide previews with
selectable text and metadata.

**How to reach it.** By extension: `docx.js` (DOCX + template/macro variants),
`xlsx.js` / `xlsb.js` (spreadsheets), `pptx.js` (slides as cards), `odf.js`
(ODT/ODS/ODP/ODG), `legacy-office.js` (DOC/XLS/PPT).

**How to use it.** Read the page/slide previews and the "Document info" /
"Collaboration & metadata" cards. Spreadsheets (XLSX and variants, XLSB, ODS)
additionally mount the **table workbench** (`tablekit.js`) below the sheet preview -
a virtualised grid with sort/filter/search, a group-by summary and a chart builder
(detailed in `docs2/features/data-archive.md`).

**Notes / limits.** XLSB uses SheetJS; ZIP-based formats use fflate. Some viewers are
preview-depth (`depth: partial` in the catalog) - the file's editable internals may
stay in a private format.

### Apple iWork (Pages / Numbers / Keynote)

**What it does.** Shows the QuickLook preview Apple embeds (a PDF rendered page by
page, or a preview image) and reads the document type and iWork version.

**How to reach it.** Drop a `.pages`/`.numbers`/`.key` (`iwork.js`).

**Notes / limits.** Identify-plus-preview only: the document body is stored in
Apple's undocumented Snappy/Protocol-Buffer `.iwa` format, which is not re-rendered.

### E-books (EPUB, Kindle/MOBI)

**What it does.** Reads title/author/cover and renders the book chapter by chapter
with prev/next paging.

**How to reach it.** Drop an `.epub` (`epub.js`) - **Read** opens the reader; or a
`.mobi`/`.azw`/`.azw3` (`mobi.js`, foliate-js) - **Reader** opens it. MOBI 6 and KF8
are decoded on-device.

### Jupyter notebooks

**What it does.** Renders an `.ipynb` cell by cell with its outputs.

**How to reach it.** Drop a `.ipynb` (`notebook.js`); shows the Cells view and stats.

### Markdown and plain/markup text

**What it does.** Markdown renders to formatted HTML alongside document stats; RTF,
AbiWord, FB2, HWPX, MHTML and the markup/typesetting sources (DITA, TEI, LaTeX, …)
render as selectable page previews.

**How to reach it.** `markdown.js` (`.md`/`.markdown`, with a **Rendered** view);
`textdoc.js` for the text/markup family. Plain-text and licence/marker files open in
the Plain Text view (`renderProprietary(..., 'txt')`) with an "Open full" reader.

### Microsoft Access databases

**What it does.** Reads tables and rows from `.mdb`/`.accdb`.

**How to reach it.** Drop an Access database (`mdb.js`, mdb-reader); browse the tables.
