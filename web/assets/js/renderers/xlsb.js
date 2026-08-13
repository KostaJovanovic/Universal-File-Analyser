/* Analyser - Excel Binary Workbook (.xlsb) viewer
   ============================================================================
   .xlsb stores a workbook in the binary BIFF12 record format rather than the
   XML of .xlsx, so the in-house OOXML reader (xlsx.js) cannot open it. This uses
   the vendored SheetJS community build (pure JS, runs in the browser) purely to
   decode .xlsb into sheets, which we render with the same table UI as .xlsx. */
import { el, row, fmtBytes, integrityCard, errorCard } from '../core/util.js';
import { loadScript } from '../core/util.js';
const SHEETJS_URL = 'assets/vendor/sheetjs/xlsx.full.min.js';
async function loadSheetJs() {
    if (!window.XLSX)
        await loadScript(SHEETJS_URL);
    return window.XLSX || null;
}
function colName(n) {
    let s = '';
    n += 1;
    while (n > 0) {
        const m = (n - 1) % 26;
        s = String.fromCharCode(65 + m) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
}
export async function renderXlsb(file, resultsEl) {
    resultsEl.hidden = false;
    resultsEl.innerHTML = '';
    resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading Excel workbook "${file.name}"…`));
    const XLSX = await loadSheetJs();
    if (!XLSX) {
        resultsEl.innerHTML = '';
        resultsEl.appendChild(errorCard('Could not load the spreadsheet reader. Check your connection, then try again.'));
        return;
    }
    let wb;
    try {
        const buf = new Uint8Array(await file.arrayBuffer());
        wb = XLSX.read(buf, { type: 'array', cellDates: true, cellNF: false, cellStyles: false });
    }
    catch (e) {
        resultsEl.innerHTML = '';
        resultsEl.appendChild(errorCard('Could not read this .xlsb workbook: ' + (e && e.message)));
        return;
    }
    resultsEl.innerHTML = '';
    const names = wb.SheetNames || [];
    // ---- Sheet tabs + table (same UI as .xlsx; leads the analysis - it's the
    // primary way to work with the data). ----
    if (names.length) {
        const sheetCard = el('div', { class: 'anr-card' });
        sheetCard.appendChild(el('h3', {}, 'Sheets'));
        const tabRow = el('div', { class: 'anr-xlsx-tabs' });
        const tableWrap = el('div', { class: 'anr-xlsx-table-wrap' });
        sheetCard.appendChild(tabRow);
        sheetCard.appendChild(tableWrap);
        resultsEl.appendChild(sheetCard);
        let tkHandle = null;
        const renderSheet = (idx) => {
            if (tkHandle) {
                tkHandle.destroy();
                tkHandle = null;
            }
            [...tabRow.children].forEach((c, i) => c.classList.toggle('is-active', i === idx));
            tableWrap.innerHTML = '';
            const ws = wb.Sheets[names[idx]];
            if (!ws || !ws['!ref']) {
                tableWrap.appendChild(el('p', { class: 'anr-hint' }, 'This sheet is empty.'));
                return;
            }
            const range = XLSX.utils.decode_range(ws['!ref']);
            const maxCol = range.e.c;
            const sheetRows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: true });
            const wbHeaders = Array.from({ length: maxCol + 1 }, (_, c) => {
                const v = (sheetRows[0] || [])[c];
                return v == null || v === '' ? colName(c) : String(v);
            });
            const wbRows = sheetRows.slice(1).map((r) => Array.from({ length: maxCol + 1 }, (_, c) => (r[c] == null ? '' : String(r[c]))));
            const tkHost = el('div');
            tableWrap.appendChild(tkHost);
            import('./tablekit.js').then(({ mountTableKit }) => {
                tkHandle = mountTableKit(tkHost, { headers: wbHeaders, rows: wbRows, totalRows: wbRows.length }, { sheetName: names[idx] });
            }).catch(() => { });
        };
        names.forEach((name, i) => {
            const tab = el('button', { type: 'button', class: 'anr-xlsx-tab' + (i === 0 ? ' is-active' : '') }, name || ('Sheet' + (i + 1)));
            tab.addEventListener('click', () => renderSheet(i));
            tabRow.appendChild(tab);
        });
        renderSheet(0);
    }
    // ---- Metadata ----
    const metaCard = el('div', { class: 'anr-card' });
    metaCard.appendChild(el('h3', {}, 'Excel binary workbook'));
    const metaTbl = el('table', { class: 'anr-readout' });
    metaTbl.appendChild(row('Format', 'Excel Binary Workbook (.xlsb, BIFF12)'));
    metaTbl.appendChild(row('File', file.name));
    metaTbl.appendChild(row('Size', fmtBytes(file.size)));
    metaTbl.appendChild(row('Sheets', String(names.length || '-')));
    const p = wb.Props || {};
    if (p.Author)
        metaTbl.appendChild(row('Author', p.Author));
    if (p.LastAuthor && p.LastAuthor !== p.Author)
        metaTbl.appendChild(row('Last saved by', p.LastAuthor));
    if (p.ModifiedDate) {
        try {
            metaTbl.appendChild(row('Modified', new Date(p.ModifiedDate).toISOString().slice(0, 19).replace('T', ' ')));
        }
        catch (_) { }
    }
    if (p.Application)
        metaTbl.appendChild(row('Application', p.Application + (p.AppVersion ? ' ' + p.AppVersion : '')));
    if (wb.vbaraw)
        metaTbl.appendChild(row('Macros', '⚠ Contains macros (VBA project)'));
    metaCard.appendChild(metaTbl);
    resultsEl.appendChild(metaCard);
    if (!names.length)
        resultsEl.appendChild(integrityCard(file));
}
//# sourceMappingURL=xlsb.js.map