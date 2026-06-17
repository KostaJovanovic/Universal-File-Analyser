/* Analyser - Microsoft Access database viewer (.mdb / .accdb)
   ============================================================================
   Uses the vendored mdb-reader (pure JS, bundled with browser polyfills) to open
   a Jet/ACE database fully in the browser: lists the user tables with their
   columns and row counts, and shows a sample of rows from each - the same
   table UI as the spreadsheet viewers. Nothing is uploaded. */

import { el, row, rowHelp, fmtBytes, integrityCard, errorCard } from '../core/util.js';
import { loadScript } from '../core/util.js';

const MDB_URL = 'assets/vendor/mdb/mdb.js';

async function loadMdb() {
  if (!window.MDBReader) { try { await loadScript(MDB_URL); } catch (_) {} }
  return window.MDBReader || null;
}

function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
  if (typeof v === 'object') {
    if (v.length != null) return '[' + v.length + ' bytes]';   // Buffer/Uint8Array (OLE/attachment)
    return JSON.stringify(v);
  }
  return String(v);
}

export async function renderMdb(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading Access database "${file.name}"…`));

  const MDBReader = await loadMdb();
  if (!MDBReader) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not load the Access database reader. Check your connection, then try again.'));
    return;
  }

  let reader, names, created = null;
  try {
    const u8 = new Uint8Array(await file.arrayBuffer());
    const buf = window.Buffer ? window.Buffer.from(u8) : u8;
    reader = new MDBReader(buf);
    names = reader.getTableNames();
    try { created = reader.getCreationDate(); } catch (_) { created = null; }
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read this Access database: ' + (e && e.message)));
    return;
  }

  resultsEl.innerHTML = '';

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  // ---- Metadata ----
  const metaCard = el('div', { class: 'anr-card' });
  metaCard.appendChild(el('h3', {}, 'Access database'));
  const metaTbl = el('table', { class: 'anr-readout' });
  metaTbl.appendChild(row('Format', ext === 'accdb' ? 'Access 2007+ (ACE / .accdb)' : 'Access 97-2003 (Jet / .mdb)'));
  metaTbl.appendChild(row('File', file.name));
  metaTbl.appendChild(row('Size', fmtBytes(file.size)));
  metaTbl.appendChild(row('Tables', String(names.length)));
  if (created) { try { metaTbl.appendChild(row('Created', created.toISOString().slice(0, 19).replace('T', ' '))); } catch (_) {} }
  metaCard.appendChild(metaTbl);
  resultsEl.appendChild(metaCard);

  if (!names.length) { resultsEl.appendChild(integrityCard(file)); return; }

  // Pre-read each table's column names + row count (cheap header reads).
  const tables = names.map((name) => {
    try {
      const t = reader.getTable(name);
      return { name, cols: t.getColumnNames(), rowCount: t.rowCount, table: t };
    } catch (_) { return { name, cols: [], rowCount: 0, table: null }; }
  });

  // ---- Tables tab strip + grid (same UI as the spreadsheet viewers) ----
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Tables'));
  const tabRow = el('div', { class: 'anr-xlsx-tabs' });
  const wrap = el('div', { class: 'anr-xlsx-table-wrap' });
  card.appendChild(tabRow);
  card.appendChild(wrap);
  resultsEl.appendChild(card);

  const ROW_CAP = 200;
  function renderTable(idx) {
    [...tabRow.children].forEach((c, i) => c.classList.toggle('is-active', i === idx));
    wrap.innerHTML = '';
    const t = tables[idx];
    const info = el('p', { class: 'anr-hint', style: 'margin:0 0 8px;' }, t.cols.length + ' columns · ' + t.rowCount.toLocaleString() + ' rows');
    wrap.appendChild(info);
    if (!t.table || !t.cols.length) { wrap.appendChild(el('p', { class: 'anr-hint' }, 'This table could not be read.')); return; }
    let data = [];
    try { data = t.table.getData({ rowLimit: ROW_CAP }); } catch (_) { data = []; }

    const table = el('table', { class: 'anr-xlsx-table' });
    const thead = el('tr', {}, [el('th', { class: 'anr-xlsx-corner' }, '')]);
    for (const c of t.cols) thead.appendChild(el('th', {}, c));
    table.appendChild(thead);
    data.forEach((r, i) => {
      const tr = el('tr', {}, [el('th', { class: 'anr-xlsx-rownum' }, String(i + 1))]);
      for (const c of t.cols) tr.appendChild(el('td', {}, cellText(r[c])));
      table.appendChild(tr);
    });
    wrap.appendChild(table);
    if (t.rowCount > ROW_CAP) wrap.appendChild(el('p', { class: 'anr-hint', style: 'margin-top:8px;' }, `Showing the first ${ROW_CAP} of ${t.rowCount.toLocaleString()} rows.`));
  }

  tables.forEach((t, i) => {
    const tab = el('button', { type: 'button', class: 'anr-xlsx-tab' + (i === 0 ? ' is-active' : '') }, t.name + ' (' + t.rowCount + ')');
    tab.addEventListener('click', () => renderTable(i));
    tabRow.appendChild(tab);
  });
  renderTable(0);
}
