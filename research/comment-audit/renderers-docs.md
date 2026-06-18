# renderers (document group) comment audit

Audited 14 document-group renderer modules. Every `//`, `/* */` and JSDoc comment
was checked against the surrounding code, including claimed magic bytes, OOXML/OLE/
ZIP structure facts, byte offsets and numeric constants. No factual-correctness
problems were found — the comments accurately describe the code.

Key facts spot-verified as correct (not exhaustive):

- **pdf.js** — `pdfImageToCanvas` comment "RGBA/RGB/1-bpp-grayscale" matches the
  `img.kind === 3 / 2 / 1` branches (pdf.js ImageKind RGBA=3, RGB=2, GRAYSCALE_1BPP=1).
  `scanRawPdf` `%%EOF` revision-counting and code-point>32 trailing-data logic match
  the comments.
- **docx.js** — EMU→px divisor `cx / 9525` (line 63) and the OOXML W/A/R namespace
  URIs (lines 9-11) are correct.
- **odf.js** — OASIS ODF namespace URIs including `...xmlns:drawing:1.0` for the
  `draw` key (line 20) are correct; ZIP sniff `0x50 0x4B` (line 379) correct.
- **xlsx.js** — `parseRef` examples `"A1"→{0,0}` and `"BC12"→{col:54,row:11}` are
  correct (BC = 2·26+3−1 = 54). `serialToDate` epoch comment (25569 days from
  1899-12-30 to 1970-01-01, 1900 leap-bug baked in) is correct. `BUILTIN_FMT`
  date/currency id sets match their classification.
- **xlsb.js** — "BIFF12 record format" and SheetJS usage descriptions match.
- **pptx.js** — `EMU_PER_PX = 9525 // 914400 EMU/inch ÷ 96 px/inch` (line 8) is
  correct (914400/96 = 9525); 16:9 default slide `9144000 × 5143500` EMU correct.
- **epub.js** — OPF/spine/manifest/NCX/nav handling matches comments; "~220 wpm"
  matches `totalWords / 220`.
- **paged.js** — "A4 at ~96dpi is 794x1123" (lines 24-25) is correct; PAGE_W/PAGE_H
  = 760/1075 keeps the ~1:1.414 ratio as stated.
- **legacy-office.js** — Word97 FIB magic `0xA5EC` (line 65), the `0x0200` flag →
  `1Table`/`0Table` selection, CLX walk (Prc `0x01` / Pcdt `0x02`), the `0x40000000`
  compressed-piece flag with `(fc & 0x3FFFFFFF) >>> 1` offset, and the BIFF8 record
  numbers in the comments (BOUNDSHEET `0x0085`, SST `0x00FC`, CONTINUE `0x003C`,
  LABELSST `0x00FD`, LABEL `0x0204`, RK `0x027E`, MULRK `0x00BD`, NUMBER `0x0203`,
  FORMULA `0x0006`, STRING `0x0207`, BOF `0x0809`, EOF `0x000A`) and the PowerPoint
  atom types (TextCharsAtom `0x0FA0`, TextBytesAtom `0x0FA8`, container test
  `(verInst & 0x000F) === 0x000F`) all match the code and the real formats.
- **textdoc.js** — RTF stripping, MHTML MIME-part decoding, FB2/AbiWord/HWPX XML
  comments match the implementation.
- **notebook.js** — nbformat-3 `worksheets[0].cells` fallback (line 119) and the
  output-type handling described in the header match the code.
- **iwork.js** — "Snappy-compressed Protocol Buffer streams (.iwa)" and the
  Preview.pdf → preview-image → metadata fallback chain match the code.
- **mobi.js** — foliate-js MOBI/KF8 decoding and metadata-shape comment match.
- **mdb.js** — mdb-reader Jet/ACE usage and the cellText Buffer/Date handling match.

## assets/js/renderers/pdf.js — no issues
## assets/js/renderers/docx.js — no issues
## assets/js/renderers/odf.js — no issues
## assets/js/renderers/xlsx.js — no issues
## assets/js/renderers/xlsb.js — no issues
## assets/js/renderers/pptx.js — no issues
## assets/js/renderers/epub.js — no issues
## assets/js/renderers/paged.js — no issues
## assets/js/renderers/legacy-office.js — no issues
## assets/js/renderers/textdoc.js — no issues
## assets/js/renderers/notebook.js — no issues
## assets/js/renderers/iwork.js — no issues
## assets/js/renderers/mobi.js — no issues
## assets/js/renderers/mdb.js — no issues
