/* Analyser - XLSX viewer
   Reads .xlsx (Office Open XML spreadsheet) and renders each worksheet as a
   table, with sheet tabs and document metadata. */

import { el, row, rowHelp, fmtBytes, integrityCard, errorCard } from '../core/util.js';
import { openZip } from './zip.js';
import { EXCEL_ROWS_MAX, EXCEL_COLS_MAX, SHEET_CELLS_MAX, SHEET_COLS_MAX } from '../core/limits.js';

// "A1" -> { col: 0, row: 0 }; "BC12" -> { col: 54, row: 11 }. Anything outside
// Excel's own grid (past XFD / row 1,048,576) is not a real cell: null.
function parseRef(ref: string|null) {
  const m = /^([A-Z]{1,3})(\d{1,7})$/.exec(ref || '');
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  const row = parseInt(m[2], 10);
  if (col > EXCEL_COLS_MAX || row < 1 || row > EXCEL_ROWS_MAX) return null;
  return { col: col - 1, row: row - 1 };
}

// Elements by LOCAL name, whatever prefix the writer chose: most workbooks use
// the default namespace (<c>), but some tools write <x:c> throughout, which a
// plain getElementsByTagName('c') never matches.
function byTag(root: Document|Element, local: string) {
  return root.getElementsByTagNameNS('*', local);
}

// The visible text of a string item (<si> or an inline <is>): its own <t>, or
// the <t> of each rich-text run <r>. <rPh> phonetic runs (furigana) are
// pronunciation hints, not part of the value, so they are skipped.
function stringItemText(si: Element) {
  let s = '';
  for (const ch of si.children) {
    if (ch.localName === 't') s += ch.textContent;
    else if (ch.localName === 'r') { for (const t of ch.children) if (t.localName === 't') s += t.textContent; }
  }
  return s;
}

function colName(n: number) {
  let s = '';
  n += 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function parseXml(text: string|null) {
  return new DOMParser().parseFromString(text!, 'application/xml');
}

// Resolve a relationship Target (possibly '../') against the part it came from.
function resolveRel(basePath: string|string[], target: string) {
  const dir = basePath.slice(0, basePath.lastIndexOf('/') + 1);
  const out = [];
  for (const p of (dir + target).split('/')) { if (p === '..') out.pop(); else if (p !== '.' && p !== '') out.push(p); }
  return out.join('/');
}

// Collect pivot-table definitions: name, target location, field counts, and the
// source range (followed through the table's rels to its pivot-cache definition).
// Purely additive - any malformed part is skipped, never thrown.
async function collectPivots(zip: any) {
  const out: any[] = [];
  let files;
  try { files = zip.match(/^xl\/pivotTables\/pivotTable\d+\.xml$/); } catch (_) { return out; }
  for (const f of files) {
    try {
      const def = parseXml(await zip.text(f.name));
      const root = def.documentElement;
      const name = root.getAttribute('name') || root.getAttribute('dataCaption') || '(unnamed)';
      const loc = def.getElementsByTagName('location')[0];
      const location = loc ? (loc.getAttribute('ref') || '') : '';
      const cnt = (tag: string) => { const e = def.getElementsByTagName(tag)[0]; return e ? (parseInt(e.getAttribute('count')!, 10) || e.getElementsByTagName('field').length || 0) : 0; };
      const fields = { row: cnt('rowFields'), col: cnt('colFields'), data: cnt('dataFields'), page: cnt('pageFields') };
      // Source range lives in the linked pivot-cache definition's worksheetSource.
      let source = '';
      try {
        const relName = f.name.replace(/pivotTables\/(pivotTable\d+)\.xml$/, 'pivotTables/_rels/$1.xml.rels');
        if (zip.has(relName)) {
          const rd = parseXml(await zip.text(relName));
          let cacheTarget = '';
          for (const r of rd.getElementsByTagName('Relationship')) {
            if (/pivotCacheDefinition/i.test(r.getAttribute('Target') || '')) { cacheTarget = r.getAttribute('Target')!; break; }
          }
          const cachePath = cacheTarget && resolveRel(f.name, cacheTarget);
          if (cachePath && zip.has(cachePath)) {
            const ws = parseXml(await zip.text(cachePath)).getElementsByTagName('worksheetSource')[0];
            if (ws) {
              const sheet = ws.getAttribute('sheet') || '';
              const ref = ws.getAttribute('ref') || ws.getAttribute('name') || '';
              source = (sheet && ref && !/!/.test(ref) ? sheet + '!' : '') + ref;
            }
          }
        }
      } catch (_) { /* ignore source */ }
      out.push({ name, location, source, fields });
    } catch (_) { /* ignore this pivot */ }
  }
  return out;
}

// Built-in number-format ids (a subset). Used to classify columns as date or
// currency when xl/styles.xml references them without an explicit format code.
const BUILTIN_FMT: Record<number, string> = {
  14: 'date', 15: 'date', 16: 'date', 17: 'date', 22: 'date',
  45: 'date', 46: 'date', 47: 'date',
  5: 'currency', 6: 'currency', 7: 'currency', 8: 'currency',
  41: 'currency', 42: 'currency', 43: 'currency', 44: 'currency'
};

// Classify a format code string as 'date', 'currency', or '' (general).
function classifyFmt(code: string) {
  if (!code) return '';
  const c = code.toLowerCase();
  // strip quoted literals and bracketed sections so we only look at tokens
  const stripped = c.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
  if (/[$£€¥]|\\u00a3|\\u20ac/.test(c)) return 'currency';
  if (/[dmy]/.test(stripped) && /[dy]|mm/.test(stripped) && !/[#0]/.test(stripped.replace(/[dmyhs:/.\-, ]/g, ''))) {
    // looks date-ish (has d/m/y separators, no general numeric placeholders left)
    if (/\b(d|dd|m|mm|mmm|yy|yyyy|h|hh|ss)\b/.test(stripped) || /[dy]/.test(stripped)) return 'date';
  }
  if (/[#0].*[#0]?\s*[$£€¥]|[$£€¥]\s*[#0]/.test(c)) return 'currency';
  return '';
}

// Excel date serial -> readable date string. The 1900 date system counts from
// 1900-01-01 = 1 and keeps Lotus 1-2-3's fictitious 29 February 1900 as serial
// 60, so from 61 on the 1899-12-30 epoch is right and below 60 it is a day
// out. A workbook saved with date1904 (old Mac Excel) counts from 1904-01-01 = 0.
function serialToDate(serial: string, date1904?: boolean) {
  let n = parseFloat(serial);
  if (!isFinite(n) || n < 0 || (n === 0 && !date1904)) return null;
  if (date1904) n += 1462;   // 1462 = days from 1899-12-30 to 1904-01-01
  else if (n < 61) {
    if (Math.floor(n) === 60) return n === 60 ? '1900-02-29' : '1900-02-29 ' + new Date(Math.round((n - 60) * 86400 * 1000)).toISOString().slice(11, 16);
    n += 1;
  }
  const ms = (n - 25569) * 86400 * 1000; // 25569 = days from 1899-12-30 to 1970-01-01
  const d = new Date(Math.round(ms));
  if (isNaN(d.getTime())) return null;
  // date-only if no fractional part
  if (n === Math.floor(n)) return d.toISOString().slice(0, 10);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

export async function renderXlsx(file: File, resultsEl: HTMLElement) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading spreadsheet "${file.name}"…`));

  let zip: any;
  try {
    zip = await openZip(file);
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read XLSX: ' + (e && e.message)));
    return;
  }
  resultsEl.innerHTML = '';

  // ---- Shared strings ----
  const shared: string[] = [];
  if (zip.has('xl/sharedStrings.xml')) {
    const doc = parseXml(await zip.text('xl/sharedStrings.xml'));
    // concatenate the <t> runs inside each string item (phonetic runs skipped)
    for (const si of byTag(doc, 'si')) shared.push(stringItemText(si));
  }

  // ---- Workbook: sheet names + relationship ids (+ hidden state, names) ----
  const sheets: any[] = [];
  const namedRanges = [];
  let externalLinkCount = 0;
  let date1904 = false;
  if (zip.has('xl/workbook.xml')) {
    const wb = parseXml(await zip.text('xl/workbook.xml'));
    for (const s of byTag(wb, 'sheet')) {
      const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      sheets.push({ name: s.getAttribute('name') || 'Sheet', rid, state: s.getAttribute('state') || 'visible' });
    }
    // <workbookPr date1904="1"/>: every date serial counts from 1904 instead.
    const pr = byTag(wb, 'workbookPr')[0];
    const d1904 = pr ? (pr.getAttribute('date1904') || '').toLowerCase() : '';
    date1904 = d1904 === '1' || d1904 === 'true';
    try {
      for (const dn of byTag(wb, 'definedName')) {
        const nm = dn.getAttribute('name') || '';
        if (nm && !/^_xlnm\./i.test(nm)) namedRanges.push(nm);
      }
    } catch (_) { /* ignore */ }
  }
  // External workbook links live in xl/externalLinks/.
  try { externalLinkCount = zip.match(/^xl\/externalLinks\/externalLink\d+\.xml$/).length; } catch (_) { /* ignore */ }
  // VBA macro project presence.
  const hasMacros = zip.has('xl/vbaProject.bin');
  // Pivot-table definitions (name / location / source / field counts).
  const pivots = await collectPivots(zip);

  // ---- Number formats from xl/styles.xml (cell xf index -> 'date'|'currency'|'') ----
  const xfKind: any[] = [];
  try {
    if (zip.has('xl/styles.xml')) {
      const st = parseXml(await zip.text('xl/styles.xml'));
      const fmtCode: any = {}; // numFmtId -> format code
      for (const nf of byTag(st, 'numFmt')) {
        const id = parseInt(nf.getAttribute('numFmtId')!, 10);
        if (!isNaN(id)) fmtCode[id] = nf.getAttribute('formatCode') || '';
      }
      const cellXfs = byTag(st, 'cellXfs')[0];
      if (cellXfs) {
        for (const xf of byTag(cellXfs, 'xf')) {
          const id = parseInt(xf.getAttribute('numFmtId')!, 10);
          let kind = '';
          if (!isNaN(id)) kind = BUILTIN_FMT[id] || classifyFmt(fmtCode[id]);
          xfKind.push(kind);
        }
      }
    }
  } catch (_) { /* ignore - cells just render raw */ }
  // ---- Rels: rid -> worksheet path ----
  const ridToPath: any = {};
  if (zip.has('xl/_rels/workbook.xml.rels')) {
    const rels = parseXml(await zip.text('xl/_rels/workbook.xml.rels'));
    for (const r of byTag(rels, 'Relationship')) {
      let target = r.getAttribute('Target') || '';
      if (!target.startsWith('xl/') && !target.startsWith('/')) target = 'xl/' + target;
      ridToPath[r.getAttribute('Id')!] = target.replace(/^\//, '');
    }
  }

  // ---- Sheet tabs + table (leads the analysis - it's the primary way to
  // work with the data). ----
  const sheetCard = el('div', { class: 'anr-card' });
  sheetCard.appendChild(el('h3', {}, 'Sheets'));
  const tabRow = el('div', { class: 'anr-xlsx-tabs' });
  const tableWrap = el('div', { class: 'anr-xlsx-table-wrap' });
  // Controls (show more rows/columns) + the per-sheet formula summary live OUTSIDE
  // the scrolling table box, so the buttons stay reachable without scrolling the
  // (height-capped) grid. Cleared and refilled on each sheet switch.
  const sheetExtra = el('div');
  sheetCard.appendChild(tabRow);
  sheetCard.appendChild(tableWrap);
  sheetCard.appendChild(sheetExtra);
  resultsEl.appendChild(sheetCard);

  // ---- Metadata ----
  const metaCard = el('div', { class: 'anr-card' });
  metaCard.appendChild(el('h3', {}, 'Spreadsheet'));
  const metaTbl = el('table', { class: 'anr-readout' });
  metaTbl.appendChild(row('File', file.name));
  metaTbl.appendChild(row('Size', fmtBytes(file.size)));
  metaTbl.appendChild(row('Sheets', sheets.length || '-'));
  if (zip.has('docProps/core.xml')) {
    const core = parseXml(await zip.text('docProps/core.xml'));
    const get = (tag: string) => { const e = core.getElementsByTagName(tag)[0]; return e ? e.textContent : ''; };
    const creator = get('dc:creator'); if (creator) metaTbl.appendChild(row('Author', creator));
    const modified = get('dcterms:modified'); if (modified) metaTbl.appendChild(row('Modified', modified.replace('T', ' ').replace('Z', '')));
  }
  if (zip.has('docProps/app.xml')) {
    const app = parseXml(await zip.text('docProps/app.xml'));
    const a = app.getElementsByTagName('Application')[0];
    if (a) metaTbl.appendChild(row('Application', a.textContent));
  }
  metaCard.appendChild(metaTbl);
  resultsEl.appendChild(metaCard);

  // ---- Computation & structure (additive) ----
  try {
    const hidden = sheets.filter((s) => s.state === 'hidden' || s.state === 'veryHidden');
    const showCard = hasMacros || hidden.length || namedRanges.length || externalLinkCount || pivots.length;
    if (showCard) {
      const c = el('div', { class: 'anr-card' });
      c.appendChild(el('h3', {}, 'Computation & structure'));
      const t = el('table', { class: 'anr-readout' });
      if (hasMacros) t.appendChild(row('Macros', '⚠ Contains macros (xl/vbaProject.bin)'));
      if (hidden.length) {
        t.appendChild(row('Hidden sheets', hidden.length + ' (' + hidden.map((s) => s.name + (s.state === 'veryHidden' ? ' [very hidden]' : '')).join(', ') + ')'));
      }
      if (namedRanges.length) t.appendChild(row('Named ranges', namedRanges.length));
      if (externalLinkCount) t.appendChild(row('External workbook links', externalLinkCount));
      if (pivots.length) t.appendChild(rowHelp('Pivot tables', pivots.length, 'A pivot table is a built-in spreadsheet tool that summarises a large table - totalling or averaging figures grouped by category, like sales per region. This counts how many the workbook contains.'));
      c.appendChild(t);
      if (pivots.length) {
        const det = el('details', { style: 'margin-top:8px;' });
        det.appendChild(el('summary', {}, 'View pivot tables (' + pivots.length + ')'));
        const pt = el('table', { class: 'anr-readout' });
        for (const p of pivots) {
          const fieldBits = [];
          if (p.fields.row) fieldBits.push(p.fields.row + ' row');
          if (p.fields.col) fieldBits.push(p.fields.col + ' col');
          if (p.fields.data) fieldBits.push(p.fields.data + ' value');
          if (p.fields.page) fieldBits.push(p.fields.page + ' filter');
          const detail = [
            p.source ? 'source ' + p.source : '',
            p.location ? 'at ' + p.location : '',
            fieldBits.join(', '),
          ].filter(Boolean).join('  ·  ');
          pt.appendChild(row(p.name, detail || '-'));
        }
        det.appendChild(pt);
        c.appendChild(det);
      }
      if (namedRanges.length) {
        const det = el('details', { style: 'margin-top:8px;' });
        det.appendChild(el('summary', {}, 'View named ranges (' + namedRanges.length + ')'));
        det.appendChild(el('p', { style: 'margin:6px 0;word-break:break-all;' }, namedRanges.slice(0, 200).join(', ')));
        c.appendChild(det);
      }
      resultsEl.appendChild(c);
    }
  } catch (_) { /* ignore */ }

  let tkHandle: any = null;
  let sheetSeq = 0;   // bumped per renderSheet(); a stale call stops at its next await
  async function renderSheet(idx: number) {
    const seq = ++sheetSeq;
    if (tkHandle) { tkHandle.destroy(); tkHandle = null; }
    [...tabRow.children].forEach((c, i) => c.classList.toggle('is-active', i === idx));
    tableWrap.innerHTML = '';
    sheetExtra.innerHTML = '';
    try {
      await renderSheetBody(idx, seq);
    } catch (e) {
      if (seq !== sheetSeq) return;
      tableWrap.innerHTML = '';
      tableWrap.appendChild(el('p', { class: 'anr-hint' }, 'Could not read this sheet: ' + ((e && e.message) || 'unknown error')));
    }
  }

  async function renderSheetBody(idx: number, seq: number) {
    const sheet = sheets[idx];
    const path = ridToPath[sheet.rid] || ('xl/worksheets/sheet' + (idx + 1) + '.xml');
    if (!zip.has(path)) { tableWrap.appendChild(el('p', { class: 'anr-hint' }, 'Could not locate sheet data.')); return; }
    const text = await zip.text(path);
    if (seq !== sheetSeq) return;   // another tab was clicked while this one loaded
    const doc = parseXml(text);

    // Collect cells into a sparse grid: row -> (col -> value). Only rows that
    // hold a cell take any memory, however far down the sheet they sit.
    let maxCol = 0, maxRow = 0;
    const cells = new Map<number, Map<number, string>>();
    const formulas = []; // { ref, formula } collected during iteration
    let dateCols = new Set(), currencyCols = new Set();
    for (const c of byTag(doc, 'c')) {
      const ref = parseRef(c.getAttribute('r'));
      if (!ref) continue;
      const type = c.getAttribute('t');
      let value = '';
      if (type === 'inlineStr') {
        const is = byTag(c, 'is')[0];
        value = is ? stringItemText(is) : '';
      } else {
        const v = byTag(c, 'v')[0];
        const raw = v ? v.textContent : '';
        if (type === 's') value = shared[parseInt(raw, 10)] || '';
        else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
        else {
          value = raw;
          // Apply number format from the cell's style index, when known.
          try {
            const si = parseInt(c.getAttribute('s')!, 10);
            const kind = !isNaN(si) ? xfKind[si] : '';
            if (kind === 'date' && raw !== '') {
              const d = serialToDate(raw, date1904);
              if (d) { value = d; dateCols.add(ref.col); }
            } else if (kind === 'currency' && raw !== '') {
              currencyCols.add(ref.col);
            }
          } catch (_) { /* keep raw value */ }
        }
      }
      // Collect formula (cached value already captured above as `value`).
      try {
        const f = byTag(c, 'f')[0];
        if (f && f.textContent) formulas.push({ ref: c.getAttribute('r'), formula: f.textContent });
      } catch (_) { /* ignore */ }
      let rowMap = cells.get(ref.row);
      if (!rowMap) { rowMap = new Map(); cells.set(ref.row, rowMap); }
      rowMap.set(ref.col, value);
      if (ref.col > maxCol) maxCol = ref.col;
      if (ref.row > maxRow) maxRow = ref.row;
    }

    // Dense grid (row 0 = headers) for the table-analysis workbench, built from
    // the sparse cell map above. The extent is clamped to SHEET_COLS_MAX columns
    // and SHEET_CELLS_MAX cells: a single cell at XFD1048576 must not turn into
    // seventeen billion empty ones.
    const gridCols = Math.min(maxCol + 1, SHEET_COLS_MAX);
    const gridRows = Math.min(maxRow, Math.max(1, Math.floor(SHEET_CELLS_MAX / gridCols)));
    const clipped = gridCols < maxCol + 1 || gridRows < maxRow;
    const headRow = cells.get(0);
    const wbHeaders = Array.from({ length: gridCols }, (_, c) => (headRow && headRow.get(c)) || colName(c));
    const wbRows: any[][] = [];
    for (let r = 1; r <= gridRows; r++) {
      const src = cells.get(r);
      const rowArr: any[] = new Array(gridCols).fill('');
      if (src) for (const [c, v] of src) if (c < gridCols && v) rowArr[c] = v;
      wbRows.push(rowArr);
    }
    if (clipped) {
      tableWrap.appendChild(el('p', { class: 'anr-hint' },
        'This sheet reaches ' + colName(maxCol) + (maxRow + 1) + '. The table below shows the first ' +
        gridRows.toLocaleString() + ' rows and ' + gridCols.toLocaleString() + ' columns.'));
    }
    const tkHost = el('div');
    sheetExtra.appendChild(tkHost);
    import('./tablekit.js').then(({ mountTableKit }) => {
      // A newer tab click already owns the workbench - don't mount a stale sheet.
      if (seq !== sheetSeq) return;
      tkHandle = mountTableKit(tkHost, { headers: wbHeaders, rows: wbRows, totalRows: wbRows.length }, { sheetName: sheet.name });
    }).catch(() => { /* workbench is additive - ignore load failure */ });

    // Formulas + format summary for this sheet (additive).
    try {
      if (formulas.length || dateCols.size || currencyCols.size) {
        const sum = el('div', { style: 'margin-top:8px;' });
        const parts = [];
        if (formulas.length) parts.push('Formulas: ' + formulas.length);
        if (dateCols.size) parts.push('Date columns: ' + dateCols.size);
        if (currencyCols.size) parts.push('Currency columns: ' + currencyCols.size);
        sum.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 4px;' }, parts.join(' · ')));
        if (formulas.length) {
          const det = el('details');
          det.appendChild(el('summary', {}, 'Sample formulas'));
          const code = el('pre', { style: 'white-space:pre-wrap;word-break:break-all;margin:6px 0;font-size:12px;' });
          code.textContent = formulas.slice(0, 25).map((f) => f.ref + ': =' + f.formula).join('\n');
          det.appendChild(code);
          sum.appendChild(det);
        }
        sheetExtra.appendChild(sum);
      }
    } catch (_) { /* ignore */ }
  }

  sheets.forEach((s, i) => {
    const tab = el('button', { type: 'button', class: 'anr-xlsx-tab' }, s.name);
    tab.addEventListener('click', () => renderSheet(i));
    tabRow.appendChild(tab);
  });

  if (sheets.length) renderSheet(0);
  else sheetCard.appendChild(el('p', { class: 'anr-hint' }, 'No sheets found.'));

  resultsEl.appendChild(integrityCard(file));
}
