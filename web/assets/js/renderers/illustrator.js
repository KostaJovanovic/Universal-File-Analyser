/* Analyser - Adobe Illustrator (.ai) viewer
   ============================================================================
   Since Illustrator 9 (2000), .ai files are PDF-compatible: the artwork is a PDF
   stream with Illustrator's private data alongside it. So a modern .ai opens
   directly in the PDF viewer (pages, text, embedded images, metadata). Older
   EPS/PostScript-based .ai files aren't PDF, so they fall back to the identifier. */

import { renderPdf } from './pdf.js';

export async function renderAi(file, resultsEl) {
  let isPdf = false;
  try {
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    isPdf = String.fromCharCode(head[0], head[1], head[2], head[3]) === '%PDF';
  } catch (_) { /* fall through */ }

  if (isPdf) return renderPdf(file, resultsEl);

  // Older EPS/PostScript-based .ai - hand to the proprietary identifier, which
  // reads the PostScript header (creator, bounding box, etc.).
  const { renderProprietary } = await import('./proprietary.js');
  return renderProprietary(file, resultsEl);
}
