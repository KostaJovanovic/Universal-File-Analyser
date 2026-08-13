/* Analyser - unknown-file inspector
   Magic-byte format guess, hex/ASCII dump, SHA-256, and enhanced
   previews for plain text, JSON, and XML. */

import { SCAN_MED, SCAN_LARGE } from '../core/limits.js';
import { el, row, rowHelp, h3help, fmtBytes, fileExt, errorCard } from '../core/util.js';
import { entropyProfile, hexBytes } from '../core/binutil.js';
import { buildOsintCard } from '../core/osint.js';
import { carveImages, repairJpeg, ensureJpegHuffman } from './photo-recover.js';
import { createCarveGallery } from './carve-gallery.js';

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s) {
  return esc(s).replace(/"/g, '&quot;');
}

/**
 * Best-effort format identification from the first ~128 bytes of a file.
 *
 * File formats start with distinctive byte sequences ("magic numbers") that
 * the OS and tools use to tell them apart even when the extension lies. This
 * function checks against the most common ones (PDF, PNG, JPEG, ZIP, MP3,
 * MP4, ELF, etc.). When nothing matches, it falls back to a printable-ASCII
 * heuristic to detect plain-text files.
 *
 * Returns a short human-readable label like "PNG image" or "ZIP container".
 */
export function guessFormat(b) {
  if (!b || b.length < 4) return 'unknown';
  const a = (s, l) => Array.from(b.slice(s, s + l)).map((c) => String.fromCharCode(c)).join('');

  if (a(0, 4) === '%PDF')                                return 'PDF document';
  if (b[0] === 0x89 && a(1, 3) === 'PNG')                return 'PNG image';
  if (b[0] === 0xFF && b[1] === 0xD8)                    return 'JPEG image';
  if (a(0, 4) === 'GIF8')                                return 'GIF image';
  if (a(0, 4) === 'RIFF' && a(8, 4) === 'WAVE')          return 'WAV audio';
  if (a(0, 4) === 'RIFF' && a(8, 4) === 'WEBP')          return 'WebP image';
  if (a(0, 4) === 'RIFF' && a(8, 4) === 'AVI ')          return 'AVI video';
  if (a(0, 4) === 'OggS')                                return 'Ogg container';
  if (a(0, 4) === 'fLaC')                                return 'FLAC audio';
  if (a(0, 3) === 'ID3')                                 return 'MP3 (ID3-tagged)';
  if (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0)           return 'MPEG audio';
  if (a(4, 4) === 'ftyp')                                return 'MP4 / MOV / M4A (' + a(8, 4).replace(/[^\w]/g, '') + ')';
  if (b[0] === 0x50 && b[1] === 0x4B)                    return 'ZIP container (docx / xlsx / epub / apk / jar / ...)';
  if (a(0, 6) === '7z\xBC\xAF\x27\x1C')                  return '7-Zip archive';
  if (b[0] === 0x1F && b[1] === 0x8B)                    return 'gzip archive';
  if (a(0, 4) === 'Rar!')                                return 'RAR archive';
  if (b[0] === 0x7F && a(1, 3) === 'ELF')                return 'ELF binary';
  if (a(0, 2) === 'MZ')                                  return 'Windows EXE / DLL (MZ)';
  if (a(0, 5) === '<?xml')                               return 'XML document';
  if (a(0, 6) === 'SQLite')                              return 'SQLite database';
  if (a(0, 2) === 'BM')                                  return 'BMP image';
  if (a(0, 4) === '\x00\x00\x01\x00')                    return 'ICO icon';
  if ((a(0, 2) === 'II' && b[2] === 0x2A) || (a(0, 2) === 'MM' && b[3] === 0x2A)) return 'TIFF image';
  if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return 'Matroska / WebM';
  if (b[0] === 0xCA && b[1] === 0xFE && b[2] === 0xBA && b[3] === 0xBE) return 'Java class / Mach-O fat binary';
  if (a(0, 12) === 'IDEA - MAKER')   return 'Raise3D ideaMaker project';
  if (a(0, 14) === 'IEDA - PROFILE') return 'Raise3D ideaMaker profile';

  // UTF-16 text (e.g. Windows .rdp, some config exports): a BOM, or - failing
  // that - a strong even/odd NUL split with printable ASCII in the other byte.
  const u16 = utf16Kind(b);
  if (u16) return u16 === 'le' ? 'UTF-16 LE text' : 'UTF-16 BE text';

  let printable = 0;
  for (const c of b) if (c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0x7E)) printable++;
  if (printable / b.length > 0.85) return 'plain text';
  return 'unrecognised (binary)';
}

// Distinguish UTF-16 LE/BE text from binary. Returns 'le', 'be', or null.
function utf16Kind(b) {
  if (b.length >= 2) {
    if (b[0] === 0xFF && b[1] === 0xFE) return 'le';   // BOM
    if (b[0] === 0xFE && b[1] === 0xFF) return 'be';   // BOM
  }
  // BOM-less: in ASCII-range UTF-16 text one byte of every pair is NUL. Sample up
  // to 512 bytes and require a lopsided NUL split plus printable low bytes.
  if (b.length >= 16) {
    const n = Math.min(b.length, 512) & ~1;
    let evenNul = 0, oddNul = 0, lowPrintable = 0;
    for (let i = 0; i < n; i += 2) {
      if (b[i] === 0) evenNul++;
      if (b[i + 1] === 0) oddNul++;
      const lo = b[i] || b[i + 1];                     // the non-NUL byte
      if (lo === 9 || lo === 10 || lo === 13 || (lo >= 0x20 && lo <= 0x7E)) lowPrintable++;
    }
    const pairs = n / 2;
    if (lowPrintable / pairs > 0.85) {
      if (oddNul / pairs > 0.6 && evenNul / pairs < 0.1) return 'le';
      if (evenNul / pairs > 0.6 && oddNul / pairs < 0.1) return 'be';
    }
  }
  return null;
}

function jsonStats(val, depth) {
  let keys = 0, maxD = depth, arrays = [];
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const ks = Object.keys(val);
    keys += ks.length;
    for (const k of ks) {
      const s = jsonStats(val[k], depth + 1);
      keys += s.keys; maxD = Math.max(maxD, s.maxDepth);
      arrays = arrays.concat(s.arrays);
    }
  } else if (Array.isArray(val)) {
    arrays.push(val.length);
    for (const item of val) {
      const s = jsonStats(item, depth + 1);
      keys += s.keys; maxD = Math.max(maxD, s.maxDepth);
      arrays = arrays.concat(s.arrays);
    }
  }
  return { keys, maxDepth: maxD, arrays };
}

function highlightJson(val, indent) {
  const sp = '  '.repeat(indent);
  if (val === null) return '<span class="anr-syn-kw">null</span>';
  if (typeof val === 'boolean') return '<span class="anr-syn-kw">' + val + '</span>';
  if (typeof val === 'number') return '<span class="anr-syn-num">' + val + '</span>';
  if (typeof val === 'string') {
    return '<span class="anr-syn-str">"' + escAttr(val) + '"</span>';
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return '[]';
    let out = '[\n';
    for (let i = 0; i < val.length; i++) {
      out += sp + '  ' + highlightJson(val[i], indent + 1);
      if (i < val.length - 1) out += ',';
      out += '\n';
    }
    out += sp + ']';
    return out;
  }
  if (typeof val === 'object') {
    const ks = Object.keys(val);
    if (ks.length === 0) return '{}';
    let out = '{\n';
    for (let i = 0; i < ks.length; i++) {
      out += sp + '  <span class="anr-syn-key">"' + escAttr(ks[i]) + '"</span>: ';
      out += highlightJson(val[ks[i]], indent + 1);
      if (i < ks.length - 1) out += ',';
      out += '\n';
    }
    out += sp + '}';
    return out;
  }
  return String(val);
}

function xmlStats(node, depth) {
  let count = 0, maxD = depth;
  if (node.nodeType === Node.ELEMENT_NODE) {
    count = 1;
    for (const child of node.childNodes) {
      const s = xmlStats(child, depth + 1);
      count += s.count;
      maxD = Math.max(maxD, s.maxDepth);
    }
  }
  return { count, maxDepth: maxD };
}

function formatXml(node, indent) {
  const sp = '  '.repeat(indent);
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node.textContent.trim();
    if (!t) return '';
    return sp + esc(t) + '\n';
  }
  if (node.nodeType === Node.COMMENT_NODE) {
    return sp + '<span class="anr-syn-comment">&lt;!-- ' + esc(node.textContent) + ' --&gt;</span>\n';
  }
  if (node.nodeType === Node.PROCESSING_INSTRUCTION_NODE) {
    return sp + '<span class="anr-syn-comment">&lt;?' + node.nodeName + ' ' + esc(node.textContent) + '?&gt;</span>\n';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const tagName = esc(node.nodeName);
  let attrs = '';
  for (const aNode of node.attributes) {
    attrs += ' <span class="anr-syn-attr">' + esc(aNode.name) + '</span>=<span class="anr-syn-str">"' + escAttr(aNode.value) + '"</span>';
  }
  const children = Array.from(node.childNodes);
  const meaningful = children.filter(c =>
    c.nodeType === Node.ELEMENT_NODE ||
    (c.nodeType === Node.TEXT_NODE && c.textContent.trim()) ||
    c.nodeType === Node.COMMENT_NODE
  );
  if (meaningful.length === 0) {
    return sp + '&lt;<span class="anr-syn-tag">' + tagName + '</span>' + attrs + ' /&gt;\n';
  }
  // Single text child: inline
  if (meaningful.length === 1 && meaningful[0].nodeType === Node.TEXT_NODE) {
    const txt = esc(meaningful[0].textContent.trim());
    return sp + '&lt;<span class="anr-syn-tag">' + tagName + '</span>' + attrs + '&gt;' +
      txt + '&lt;/<span class="anr-syn-tag">' + tagName + '</span>&gt;\n';
  }
  let out = sp + '&lt;<span class="anr-syn-tag">' + tagName + '</span>' + attrs + '&gt;\n';
  for (const child of children) {
    out += formatXml(child, indent + 1);
  }
  out += sp + '&lt;/<span class="anr-syn-tag">' + tagName + '</span>&gt;\n';
  return out;
}

export async function renderUnknown(file, resultsEl, opts) {
  opts = opts || {};
  // "Extensionless" mode: a file with no extension that didn't match any magic
  // route. Same inspector, but framed as an expected category (shown as text,
  // hex fallback for binary) instead of "unrecognised". handleFile still pops the
  // "this looks like a X - open as X" suggestion when the bytes match a pattern.
  const extensionless = !!opts.extensionless;
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Inspecting "${file.name}"…`));

  let headBytes;
  try {
    headBytes = new Uint8Array(await file.slice(0, 128).arrayBuffer());
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read this file: ' + (e && e.message)));
    if (window._anrSuggest) window._anrSuggest.show(fileExt(file.name));
    return;
  }

  const hex   = hexBytes(headBytes, ' ');
  const ascii = Array.from(headBytes).map((b) => (b >= 0x20 && b <= 0x7E) ? String.fromCharCode(b) : '.').join('');
  const guess = guessFormat(headBytes);

  resultsEl.innerHTML = '';

  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, extensionless
    ? 'Extensionless file - shown as text'
    : 'Unknown file - best-effort inspection'));

  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Application', extensionless ? 'Extensionless (no file extension)' : 'Unknown'));
  tbl.appendChild(row('Name',     file.name));
  tbl.appendChild(row('Size',     `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`));
  tbl.appendChild(rowHelp('MIME',     file.type || '-', "A MIME type is a standard label for a file's format, such as image/jpeg or audio/mpeg. Your browser works it out from the file's extension or from the operating system, so it is only a hint at the format, not proof."));
  tbl.appendChild(row('Modified', file.lastModified ? new Date(file.lastModified).toISOString().replace('T', ' ').replace(/\..*$/, '') : '-'));
  tbl.appendChild(row('Extension', fileExt(file.name) || '-'));
  tbl.appendChild(rowHelp('Magic guess', guess, 'A best guess at the real file type, read from the first few bytes at the very start of the file - its "magic number" fingerprint. Used when the file’s extension is missing, unknown, or possibly wrong.'));
  card.appendChild(tbl);

  // Hex dump. For extensionless files the content IS the point, so the
  // text/JSON/XML preview goes first and this is appended below it (see end of
  // the function); for unknown files it stays up top as the primary readout.
  // The file's SHA-256 (and the on-demand extra hashes) live in the standard
  // Integrity card that app.js appends, so it isn't repeated here.
  const hexBlock = [
    el('div', { class: 'anr-readout-section' }, 'First 128 bytes'),
    el('pre', { class: 'anr-unknown-dump' }, 'HEX:\n' + hex + '\n\nASCII:\n' + ascii),
  ];
  if (!extensionless) {
    hexBlock.forEach((n) => card.appendChild(n));
  }

  // If it looks like text, JSON, or XML, show enhanced previews
  let osintText = '';   // text fed to the network-indicator (OSINT) scan below
  const ext = fileExt(file.name);
  const isJsonExt = ext === 'json';
  const isXmlExt = ext === 'xml' || ext === 'html' || ext === 'htm';
  const isMarkdown = ext === 'md' || ext === 'markdown';

  // Detect JSON by peeking at first non-whitespace character
  let isJsonContent = false;
  if (guess === 'plain text' && !isJsonExt) {
    const peekText = await file.slice(0, 256).text().catch(() => '');
    const trimmed = peekText.trimStart();
    if (trimmed.length > 0 && (trimmed[0] === '{' || trimmed[0] === '[')) {
      isJsonContent = true;
    }
  }

  // UTF-16 text decodes via TextDecoder (Blob.text() is always UTF-8, which would
  // mangle it). readSlice() returns the correctly-decoded text for either case.
  const u16enc = guess === 'UTF-16 LE text' ? 'utf-16le' : guess === 'UTF-16 BE text' ? 'utf-16be' : null;
  const readSlice = async (start, end) => {
    if (!u16enc) return file.slice(start, end).text();
    const buf = await file.slice(start, end & ~1).arrayBuffer();
    return new TextDecoder(u16enc).decode(buf);
  };

  const showJson = isJsonExt || isJsonContent;
  const showXml = guess === 'XML document' || (isXmlExt && guess === 'plain text');
  const showPlainText = ((guess === 'plain text' || u16enc) && !showJson && !showXml) || guess === 'XML document';

  if (showPlainText && !showXml) {
    // --- Plain text preview + stats ---
    const previewLabel = el('div', { class: 'anr-readout-section' }, 'Text preview (first 2 kB)');
    card.appendChild(previewLabel);
    const previewOut = el('pre', { class: 'anr-ocr-text' }, '');
    card.appendChild(previewOut);
    readSlice(0, 2048).then((txt) => { previewOut.textContent = txt; }).catch(() => {});

    // "Show full text" - load the whole file into the (already scrollable) preview
    // box. Plain text has no page structure, so it expands inline as a scrollable
    // monospace block rather than the Word/PDF-style page lightbox. Only offered
    // when the file holds more than the 2 kB preview above; the read is capped.
    if (file.size > 2048) {
      const FULL_CAP = 4 * 1024 * 1024;
      const fullBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Show full text');
      fullBtn.addEventListener('click', async () => {
        fullBtn.disabled = true;
        fullBtn.textContent = 'Loading…';
        try {
          const full = await readSlice(0, FULL_CAP);
          previewOut.textContent = full;
          previewLabel.textContent = full.length >= FULL_CAP ? 'Full text (first 4 MB)' : 'Full text';
          fullBtn.remove();
        } catch (_) { fullBtn.disabled = false; fullBtn.textContent = 'Show full text'; }
      });
      card.appendChild(el('div', { class: 'anr-btn-row' }, [fullBtn]));
    }

    // Text statistics
    try {
      const fullText = await readSlice(0, 1024 * 1024);
      osintText = fullText;
      const charCount = fullText.length;
      const words = fullText.trim().length === 0 ? [] : fullText.trim().split(/\s+/);
      const wordCount = words.length;
      const lines = fullText.split(/\n/);
      const lineCount = lines.length;
      const paragraphs = fullText.split(/\n\s*\n/).filter(p => p.trim().length > 0);
      const paragraphCount = paragraphs.length;
      const readingTime = Math.ceil(wordCount / 200);
      const detectedFormat = isMarkdown ? 'Markdown' : u16enc ? 'Plain text (UTF-16 ' + (u16enc === 'utf-16le' ? 'LE' : 'BE') + ')' : 'Plain text';

      card.appendChild(el('div', { class: 'anr-readout-section' }, 'Text statistics'));
      const statsTbl = el('table', { class: 'anr-readout' });
      statsTbl.appendChild(row('Format', detectedFormat));
      statsTbl.appendChild(row('Characters', charCount.toLocaleString()));
      statsTbl.appendChild(row('Words', wordCount.toLocaleString()));
      statsTbl.appendChild(row('Lines', lineCount.toLocaleString()));
      statsTbl.appendChild(rowHelp('Paragraphs', paragraphCount.toLocaleString(), 'How many separate blocks of text there are, counting a blank line as the break between one block and the next.'));
      statsTbl.appendChild(rowHelp('Est. reading time', readingTime + ' min', 'A rough estimate of how long the text takes to read, assuming about 200 words per minute.'));
      card.appendChild(statsTbl);
    } catch (_) {}
  }

  if (showJson) {
    // --- JSON pretty printer ---
    try {
      const jsonText = await file.slice(0, 500 * 1024).text();
      osintText = jsonText;
      let parsed;
      let parseError = null;
      try {
        parsed = JSON.parse(jsonText);
      } catch (e) {
        parseError = e;
      }

      if (parseError) {
        card.appendChild(el('div', { class: 'anr-readout-section' }, 'JSON (parse error)'));
        card.appendChild(el('p', { class: 'anr-hint anr-syn-error' },
          'JSON parse error: ' + parseError.message));
        const rawPre = el('pre', { class: 'anr-ocr-text' }, '');
        rawPre.textContent = jsonText.slice(0, 4096);
        card.appendChild(rawPre);
      } else {
        const stats = jsonStats(parsed, 0);

        const details = el('details', { open: '' });
        const summary = el('summary', { class: 'anr-fmt-summary' }, 'JSON - formatted view');
        details.appendChild(summary);

        card.appendChild(el('div', { class: 'anr-readout-section' }, 'JSON statistics'));
        const jsTbl = el('table', { class: 'anr-readout' });
        jsTbl.appendChild(rowHelp('Total keys', stats.keys.toLocaleString(), 'How many named fields the file holds in total. JSON stores data as name-and-value pairs; this counts every name, including those tucked inside others.'));
        jsTbl.appendChild(rowHelp('Max depth', stats.maxDepth, 'How many levels deep the data is boxed - the most times you have to open one group inside another to reach the innermost value.'));
        if (stats.arrays.length > 0) {
          jsTbl.appendChild(rowHelp('Arrays', stats.arrays.length + ' (lengths: ' + stats.arrays.join(', ') + ')', 'How many lists the file contains, with the number of items in each. An array is JSON’s word for a list of values.'));
        }
        card.appendChild(jsTbl);

        const jsonPre = el('pre', { class: 'anr-ocr-text anr-pre-scroll', html: highlightJson(parsed, 0) });
        details.appendChild(jsonPre);
        card.appendChild(details);

        // If this JSON is actually a Lottie animation, offer to play it. (Re-reads
        // the full file via the Lottie renderer, so large animations work even
        // though the preview above only parsed the first slice.)
        if (parsed && typeof parsed === 'object' && 'v' in parsed && typeof parsed.fr === 'number'
          && typeof parsed.op === 'number' && Array.isArray(parsed.layers)) {
          const btn = el('button', { type: 'button', class: 'anr-btn' }, '▶ Play as Lottie animation');
          btn.addEventListener('click', async () => {
            btn.disabled = true; btn.textContent = 'Loading…';
            try {
              const { renderLottie } = await import('./lottie.js');
              const holder = el('div', {});
              resultsEl.appendChild(holder);
              await renderLottie(file, holder);
              btn.remove();
            } catch (_) { btn.disabled = false; btn.textContent = '▶ Play as Lottie animation'; }
          });
          card.appendChild(el('div', { class: 'anr-btn-row', style: 'margin-top:8px;' }, [btn]));
        }
      }
    } catch (_) {}
  }

  if (showXml || (guess === 'XML document' && !showJson)) {
    // --- XML pretty printer ---
    try {
      const xmlText = await file.slice(0, 500 * 1024).text();
      osintText = xmlText;

      card.appendChild(el('div', { class: 'anr-readout-section' }, 'Text preview (first 2 kB)'));
      const previewOut = el('pre', { class: 'anr-ocr-text' }, '');
      previewOut.textContent = xmlText.slice(0, 2048);
      card.appendChild(previewOut);

      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, 'application/xml');
      const parseErr = doc.querySelector('parsererror');

      if (parseErr) {
        card.appendChild(el('div', { class: 'anr-readout-section' }, 'XML (parse error)'));
        card.appendChild(el('p', { class: 'anr-hint anr-syn-error' },
          'XML parse error - showing raw text above'));
      } else {
        const xstats = xmlStats(doc.documentElement, 0);

        card.appendChild(el('div', { class: 'anr-readout-section' }, 'XML statistics'));
        const xmlTbl = el('table', { class: 'anr-readout' });
        xmlTbl.appendChild(rowHelp('Elements', xstats.count.toLocaleString(), 'How many tags the file contains in total. XML marks up data with tags such as <name>...</name>; this counts every one.'));
        xmlTbl.appendChild(rowHelp('Max depth', xstats.maxDepth, 'How many levels deep the tags are nested - the most times one tag sits inside another to reach the innermost.'));
        card.appendChild(xmlTbl);

        let formattedXml = '';
        // Include XML declaration if present
        for (const child of doc.childNodes) {
          if (child.nodeType === Node.PROCESSING_INSTRUCTION_NODE) {
            formattedXml += formatXml(child, 0);
          }
        }
        formattedXml += formatXml(doc.documentElement, 0);

        const xmlDetails = el('details', { open: '' });
        xmlDetails.appendChild(el('summary', { class: 'anr-fmt-summary' }, 'XML - formatted view'));
        const xmlPre = el('pre', { class: 'anr-ocr-text anr-pre-scroll', html: formattedXml });
        xmlDetails.appendChild(xmlPre);
        card.appendChild(xmlDetails);
      }
    } catch (_) {}
  }

  // Extensionless: the text preview rendered above; drop the hex dump below it.
  if (extensionless) {
    hexBlock.forEach((n) => card.appendChild(n));
  }

  resultsEl.appendChild(card);

  // Network indicators (URLs / IPs / domains / emails) found in the text, with
  // OSINT lookup links. Only when we actually read text out of the file.
  if (osintText) {
    const oc = buildOsintCard(osintText, { limit: 100 });
    if (oc) resultsEl.appendChild(oc);
  }

  // Byte-entropy heatmap - most telling for binary blobs (packed/encrypted regions,
  // appended archives). Skipped for files shown as text/JSON/XML, where it adds little.
  if (!showPlainText && !showJson && !showXml) {
    try { await appendEntropyCard(file, resultsEl); } catch (_) {}
  }

  // An unrecognised type (no dedicated parser) - nudge the visitor to email the
  // format in so it can be supported. Skipped for extensionless files: there's no
  // "format" to support, they're just shown as text (and handleFile already offers
  // a re-open when the bytes match a known pattern).
  if (!extensionless && window._anrSuggest) window._anrSuggest.show(fileExt(file.name));

  // Carve any embedded images out of the blob (recovered disk fragments, joined
  // dumps, mis-typed files often hide whole JPEGs/PNGs inside). NOT automatic: the
  // scan reads and sweeps up to 128 MB and then decodes every hit, which is heavy on
  // a large blob (a disk image, a system backup), so it runs only on request - the
  // same "Scan for images" control the disk-image renderer uses.
  const carveHost = el('div', {});
  resultsEl.appendChild(carveHost);
  const scanCard = el('div', { class: 'anr-card' });
  const [scanH, scanHelp] = h3help('Embedded images', 'Scans this file for embedded image signatures - whole JPEGs, PNGs, GIFs, WebPs and BMPs hidden inside a recovered fragment, a joined dump or a mis-typed blob.');
  scanCard.appendChild(scanH);
  scanCard.appendChild(scanHelp);
  scanCard.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 12px;' },
    'Recover images hidden inside this file. It reads up to ' + fmtBytes(CARVE_SCAN_CAP) + ', so it can take a moment.'));
  const scanBtn = el('button', { type: 'button', class: 'anr-btn anr-btn--cta' }, 'Scan for images');
  scanCard.appendChild(scanBtn);
  carveHost.appendChild(scanCard);
  scanBtn.addEventListener('click', async () => {
    scanCard.innerHTML = '';
    scanCard.appendChild(el('p', { class: 'anr-hint', style: 'margin:0;' }, 'Scanning for embedded images…'));
    const resultHost = el('div', {});
    carveHost.appendChild(resultHost);
    try { await appendEmbeddedImagesCard(file, resultsEl, resultHost); } catch (_) {}
    if (resultHost.children.length) {
      scanCard.remove();                                // the real gallery card was added below
    } else {
      scanCard.innerHTML = '';
      scanCard.appendChild(el('h3', {}, 'Embedded images'));
      scanCard.appendChild(el('p', { class: 'anr-hint', style: 'margin:0;' }, 'No embedded images were found in this file.'));
    }
  });
}

// Byte-entropy heatmap. Slices the file into chunks, plots each chunk's Shannon
// entropy as a coloured column (blue = low/repetitive, red = high/random), and
// reports the mean/range with a plain-language assessment. Reads up to a cap so a
// huge blob can't blow the heap.
const ENTROPY_SCAN_CAP = SCAN_MED;
async function appendEntropyCard(file, resultsEl) {
  if (file.size < 256) return;   // too small for a meaningful profile
  let bytes;
  try { bytes = new Uint8Array(await file.slice(0, Math.min(file.size, ENTROPY_SCAN_CAP)).arrayBuffer()); }
  catch (_) { return; }
  const buckets = Math.max(64, Math.min(512, Math.floor(bytes.length / 256)));
  const prof = entropyProfile(bytes, buckets);
  if (!prof.length) return;

  let sum = 0, min = 8, max = 0;
  for (const p of prof) { sum += p.entropy; if (p.entropy < min) min = p.entropy; if (p.entropy > max) max = p.entropy; }
  const mean = sum / prof.length;

  let assessment;
  if (max > 7.5 && (max - min) > 1.5) assessment = 'Contains a high-entropy region - likely compressed, encrypted or packed data embedded in lower-entropy content.';
  else if (mean > 7.5) assessment = 'Uniformly high - the whole file looks compressed or encrypted.';
  else if (mean < 4.5) assessment = 'Low - consistent with text or simple structured data.';
  else assessment = 'Mixed - typical of a structured binary (headers plus packed payloads).';

  const card = el('div', { class: 'anr-card' });
  const [entH, entHelp] = h3help('Byte entropy', 'Shannon entropy measures how random each chunk of bytes is: 0 means very repetitive, 8 means completely random. High flat regions suggest compressed or encrypted data; sharp steps mark a boundary between unlike sections.');
  card.appendChild(entH);
  card.appendChild(entHelp);
  card.appendChild(el('p', { class: 'anr-hint' },
    'Shannon entropy per chunk'
    + (file.size > ENTROPY_SCAN_CAP ? ' (first ' + fmtBytes(ENTROPY_SCAN_CAP) + ' scanned)' : '') + '.'));

  const cv = el('canvas', { class: 'anr-entropy-map' });
  cv.width = prof.length; cv.height = 1;   // 1px-tall strip, CSS-stretched; columns stay crisp
  const ctx = cv.getContext('2d');
  for (let i = 0; i < prof.length; i++) {
    const t = Math.max(0, Math.min(1, prof[i].entropy / 8));
    ctx.fillStyle = 'hsl(' + Math.round(220 - 220 * t) + ', 75%, 50%)';   // blue (low) -> red (high)
    ctx.fillRect(i, 0, 1, 1);
  }
  card.appendChild(cv);

  // Hover readout: which offset + entropy sits under the cursor.
  const hoverEl = el('div', { class: 'anr-hint', style: 'margin:6px 0 2px;min-height:1.2em;font-variant-numeric:tabular-nums;' }, 'Hover the strip for per-chunk detail.');
  card.appendChild(hoverEl);
  const scanned = Math.min(file.size, ENTROPY_SCAN_CAP);
  cv.addEventListener('mousemove', (e) => {
    const r = cv.getBoundingClientRect();
    const idx = Math.max(0, Math.min(prof.length - 1, Math.floor((e.clientX - r.left) / r.width * prof.length)));
    const off = Math.floor(idx * scanned / prof.length);
    hoverEl.textContent = 'Offset 0x' + off.toString(16).toUpperCase() + ' (' + fmtBytes(off) + ')  ·  entropy ' + prof[idx].entropy.toFixed(2) + ' / 8';
  });
  cv.addEventListener('mouseleave', () => { hoverEl.textContent = 'Hover the strip for per-chunk detail.'; });

  const t = el('table', { class: 'anr-readout' });
  t.appendChild(rowHelp('Mean entropy', mean.toFixed(2) + ' / 8 bits', 'The average randomness across the file, from 0 (very repetitive) to 8 (completely random). Higher values point to compressed, encrypted or already-packed content.'));
  t.appendChild(row('Range', min.toFixed(2) + ' - ' + max.toFixed(2)));
  t.appendChild(row('Assessment', assessment));
  card.appendChild(t);
  resultsEl.appendChild(card);
}

// Scan an unrecognised file for embedded image signatures and, if any are found,
// append a card that previews each one with download + "analyse" buttons. Mines
// recovered disk fragments / joined dumps / mis-typed files for whole JPEGs, PNGs,
// GIFs, WebPs and BMPs. Reads up to a cap so a huge blob can't blow the heap.
const CARVE_SCAN_CAP = SCAN_LARGE;
const CARVE_MIME = { jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };

// `host` is an empty div already sitting in the right place in the results, so
// the card can be filled in late without the page reordering under the reader.
// `resultsEl` stays the target for the drill-in when an Analyse button is used.
async function appendEmbeddedImagesCard(file, resultsEl, host) {
  const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, CARVE_SCAN_CAP)).arrayBuffer());
  const carved = carveImages(bytes, { max: 48 });
  if (!carved.length) return;

  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Embedded images'));
  card.appendChild(el('p', { class: 'anr-hint' },
    'Found ' + carved.length + ' image' + (carved.length === 1 ? '' : 's') + ' hidden in this file'
    + (file.size > CARVE_SCAN_CAP ? ' (first ' + fmtBytes(CARVE_SCAN_CAP) + ' scanned)' : '') + '.'));
  // Bare thumbnails with their Analyse / Download actions overlaid on hover, each
  // decoding lazily as it scrolls into view - so the cards below this one appear
  // straight away (carve-gallery.js).
  const gallery = createCarveGallery();
  gallery.grid.style.marginTop = '10px';

  for (let k = 0; k < carved.length; k++) {
    const c = carved[k];
    let sub = bytes.subarray(c.start, c.end);
    if (c.format === 'jpeg') {
      const r = repairJpeg(sub); if (r && r.data) sub = r.data;   // close off a cut-off carve
      sub = ensureJpegHuffman(sub);                               // graft standard tables onto a tableless MJPEG frame
    }
    const cf = new File([sub], 'carved_' + (k + 1) + '.' + c.format, { type: CARVE_MIME[c.format] || 'application/octet-stream' });
    gallery.add({
      file: cf, format: c.format, width: c.width, height: c.height, complete: c.complete,
      // photo.js is pulled in only on click: unknown.js is the fallback for files
      // we can't identify and shouldn't load the photo module just to list carves.
      onAnalyse: async () => {
        const { renderPhoto } = await import('./photo.js');
        renderPhoto(cf, resultsEl, { salvaged: true, sourceFile: file });
      },
    });
  }
  card.appendChild(gallery.grid);
  host.appendChild(card);
}
