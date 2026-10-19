/* Analyser - CSV / TSV preview
   Detects the delimiter, parses quoted fields, infers per-column types,
   reports numeric statistics, and previews the first 100 rows. */
import { el, row, rowHelp, fmtBytes, fileExt, errorCard, integrityCard } from '../core/util.js';
import { looksLikeGyroCsv, renderGyroCsv } from './gcsv.js';
import { percentile, inferColumnTypes, columnValues, parseDateValue, looksMonthFirst } from '../lib/table-stats.js';
import { CSV_FULL_MAX, CSV_STREAM_CHUNK, CSV_KEEP_CHARS } from '../core/limits.js';
// Quote-aware CSV/TSV parser. Walks the whole text in a single pass so a
// quoted field may contain the delimiter, CR/LF newlines, or escaped ""
// quotes without breaking the row boundaries. (The previous version split the
// text into lines BEFORE parsing quotes, which silently mangled any quoted
// field that spanned a newline - a common case in exported spreadsheets.)
function parseCsv(text, delim) {
    const rows = [];
    let row = [];
    let cur = '';
    let inQuote = false;
    const endField = () => { row.push(cur); cur = ''; };
    // A record made of a single blank field is an empty line - drop it, matching
    // the old `.filter(l => l.trim())` behaviour.
    const endRow = () => {
        endField();
        if (!(row.length === 1 && row[0].trim() === ''))
            rows.push(row);
        row = [];
    };
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuote) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    cur += '"';
                    i++;
                } // escaped quote
                else
                    inQuote = false;
            }
            else {
                cur += ch;
            }
        }
        else if (ch === '"') {
            inQuote = true;
        }
        else if (ch === delim) {
            endField();
        }
        else if (ch === '\r') {
            if (text[i + 1] === '\n')
                i++; // swallow CRLF as one break
            endRow();
        }
        else if (ch === '\n') {
            endRow();
        }
        else {
            cur += ch;
        }
    }
    // Flush a trailing record that wasn't terminated by a newline.
    if (cur !== '' || row.length > 0)
        endRow();
    return rows;
}
// The same parser as a state machine fed text a chunk at a time, for files too
// large to hold as one string. Identical rules; the two things that can straddle
// a chunk edge - a CR whose LF is in the next chunk, and a quote inside a quoted
// field that may be the first half of an escaped "" - are carried as flags.
// Plain runs are copied with slice rather than one character at a time.
function csvStreamParser(delim, onRow) {
    const D = delim.charCodeAt(0);
    let row = [];
    let cur = '';
    let inQuote = false, pendingQuote = false, pendingCR = false;
    const endRow = () => {
        row.push(cur);
        cur = '';
        if (!(row.length === 1 && row[0].trim() === ''))
            onRow(row);
        row = [];
    };
    return {
        feed(text) {
            const n = text.length;
            let i = 0;
            if (n === 0)
                return;
            if (pendingQuote) {
                pendingQuote = false;
                if (text.charCodeAt(0) === 34) {
                    cur += '"';
                    i = 1;
                }
                else
                    inQuote = false;
            }
            if (pendingCR) {
                pendingCR = false;
                if (text.charCodeAt(i) === 10)
                    i++;
            }
            let run = i;
            while (i < n) {
                const c = text.charCodeAt(i);
                if (inQuote) {
                    if (c === 34) {
                        cur += text.slice(run, i);
                        if (i + 1 >= n) {
                            pendingQuote = true;
                            i++;
                            run = i;
                            break;
                        }
                        if (text.charCodeAt(i + 1) === 34) {
                            cur += '"';
                            i += 2;
                        }
                        else {
                            inQuote = false;
                            i++;
                        }
                        run = i;
                    }
                    else
                        i++;
                    continue;
                }
                if (c === 34) {
                    cur += text.slice(run, i);
                    inQuote = true;
                    run = ++i;
                }
                else if (c === D) {
                    row.push(cur + text.slice(run, i));
                    cur = '';
                    run = ++i;
                }
                else if (c === 13) {
                    cur += text.slice(run, i);
                    endRow();
                    i++;
                    if (i >= n)
                        pendingCR = true;
                    else if (text.charCodeAt(i) === 10)
                        i++;
                    run = i;
                }
                else if (c === 10) {
                    cur += text.slice(run, i);
                    endRow();
                    run = ++i;
                }
                else
                    i++;
            }
            if (run < n)
                cur += text.slice(run, n);
        },
        end() {
            pendingQuote = false;
            if (cur !== '' || row.length > 0)
                endRow();
        },
    };
}
// Pick the delimiter from the first line: the commonest of the four.
function pickDelimiter(text, ext) {
    if (ext === 'tsv')
        return '\t';
    const firstLine = text.split('\n')[0] || '';
    const candidates = [
        [',', (firstLine.match(/,/g) || []).length],
        ['\t', (firstLine.match(/\t/g) || []).length],
        [';', (firstLine.match(/;/g) || []).length],
        ['|', (firstLine.match(/\|/g) || []).length],
    ];
    candidates.sort((a, b) => b[1] - a[1]);
    return candidates[0][1] > 0 ? candidates[0][0] : ',';
}
function delimiterLabel(d) {
    if (d === '\t')
        return 'Tab';
    if (d === ',')
        return 'Comma';
    if (d === ';')
        return 'Semicolon';
    if (d === '|')
        return 'Pipe';
    return JSON.stringify(d);
}
// Trim trailing zeros from a fixed-precision number for compact display.
function num(n) {
    if (!isFinite(n))
        return String(n);
    return Number(n.toFixed(4)).toString();
}
// Build the additive "extended" stats: fill rate, numeric quartiles/stddev/
// median, text cardinality + top values, date ranges, and a data-quality
// section (ragged rows, duplicates, BOM/line-endings, delimiter confidence).
function buildProfile(card, ctx) {
    const { headers, dataRows, colCount, colTypes, totalRows, hasHeader, delimiter, hasBom, lineEnding } = ctx;
    // Cap the heavy passes so a giant file stays responsive.
    const SAMPLE_CAP = 50000;
    const sample = dataRows.length > SAMPLE_CAP ? dataRows.slice(0, SAMPLE_CAP) : dataRows;
    const sampled = sample.length < dataRows.length;
    // Day-first by default, but a column that PROVES itself month-first (a
    // value like 8/25/2024, where 25 can only be a day) reads correctly here
    // too, matching the workbench above.
    const monthFirst = looksMonthFirst(sample, colCount, colTypes);
    // ---- Per-column profiling ----
    const fillTbl = el('table', { class: 'anr-readout' });
    const numTbl = el('table', { class: 'anr-readout' });
    const textTbl = el('table', { class: 'anr-readout' });
    const dateTbl = el('table', { class: 'anr-readout' });
    let hasNum = false, hasText = false, hasDate = false;
    // Per-column anomaly tells (statistical outliers, synthetic/placeholder
    // patterns, identifier-like text) gathered as [label, detail] for the
    // additive "Anomalies" section rendered after data quality.
    const anomalies = [];
    for (let c = 0; c < colCount; c++) {
        const header = headers[c] || `Col ${c + 1}`;
        let filled = 0;
        const nums = [];
        const dates = [];
        const freq = new Map();
        for (const r of sample) {
            const val = (r[c] || '').trim();
            if (val === '')
                continue;
            filled++;
            if (colTypes[c] === 'number') {
                const n = Number(val);
                if (!isNaN(n))
                    nums.push(n);
            }
            else if (colTypes[c] === 'date') {
                const t = parseDateValue(val, monthFirst);
                if (!isNaN(t))
                    dates.push(t);
            }
            else {
                freq.set(val, (freq.get(val) || 0) + 1);
            }
        }
        const pct = sample.length ? Math.round((filled / sample.length) * 100) : 0;
        fillTbl.appendChild(row(header, `${pct}% filled  (${filled} of ${sample.length})`));
        if (colTypes[c] === 'number' && nums.length > 0) {
            hasNum = true;
            const sorted = nums.slice().sort((a, b) => a - b);
            const mean = nums.reduce((s, n) => s + n, 0) / nums.length;
            const variance = nums.reduce((s, n) => s + (n - mean) * (n - mean), 0) / nums.length;
            const std = Math.sqrt(variance);
            const q1 = percentile(sorted, 0.25);
            const median = percentile(sorted, 0.5);
            const q3 = percentile(sorted, 0.75);
            numTbl.appendChild(row(header, `median: ${num(median)}  Q1: ${num(q1)}  Q3: ${num(q3)}  stddev: ${num(std)}`));
            // Anomaly: values more than 3 standard deviations from the mean, or a
            // column that never varies (often a placeholder / stuck sensor).
            if (std > 0) {
                const out = nums.filter((n) => Math.abs(n - mean) > 3 * std);
                if (out.length) {
                    const ex = out.slice().sort((a, b) => Math.abs(b - mean) - Math.abs(a - mean)).slice(0, 3).map(num).join(', ');
                    anomalies.push([`${header}: outliers`,
                        `${out.length} value(s) beyond ±3σ (mean ${num(mean)}, stddev ${num(std)}) - e.g. ${ex}`]);
                }
            }
            else if (nums.length > 1) {
                anomalies.push([`${header}: constant`, `every numeric value is ${num(nums[0])}`]);
            }
        }
        else if (colTypes[c] === 'date' && dates.length > 0) {
            hasDate = true;
            const minD = new Date(Math.min(...dates)).toISOString().slice(0, 10);
            const maxD = new Date(Math.max(...dates)).toISOString().slice(0, 10);
            dateTbl.appendChild(row(header, `${minD}  →  ${maxD}  (${dates.length} dates)`));
            // Anomaly: all dates identical, or a perfectly regular cadence (a
            // generated/synthetic series rather than organically recorded events).
            const uniqD = new Set(dates);
            if (dates.length > 1 && uniqD.size === 1) {
                anomalies.push([`${header}: constant date`, `all ${dates.length} dates are ${minD}`]);
            }
            else if (dates.length > 2) {
                const sd = dates.slice().sort((a, b) => a - b);
                const step = sd[1] - sd[0];
                let even = step > 0;
                for (let i = 2; even && i < sd.length; i++)
                    if (sd[i] - sd[i - 1] !== step)
                        even = false;
                if (even)
                    anomalies.push([`${header}: regular cadence`,
                        `dates evenly spaced by ${fmtStep(step)} - looks like a generated series`]);
            }
        }
        else if (colTypes[c] === 'text' && freq.size > 0) {
            hasText = true;
            const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
                .map(([v, n]) => `${truncate(v)} (${n})`).join(',  ');
            textTbl.appendChild(row(header, `${freq.size} distinct  •  top: ${top}`));
            // Anomaly: every value distinct (identifier-like / maximal entropy) or one
            // value swamping the column (near-zero entropy - a stuck/placeholder field).
            const topCount = Math.max(...freq.values());
            if (freq.size === filled && filled > 3) {
                anomalies.push([`${header}: all unique`,
                    `every value distinct across ${filled} rows - identifier-like (maximal entropy)`]);
            }
            else if (filled > 0 && freq.size > 1 && topCount / filled >= 0.95) {
                anomalies.push([`${header}: single value`,
                    `${Math.round(topCount / filled * 100)}% of rows share one value (very low entropy)`]);
            }
        }
    }
    card.appendChild(el('div', { class: 'anr-readout-section' }, sampled ? `Fill rate (sampled ${sample.length} rows)` : 'Fill rate'));
    card.appendChild(fillTbl);
    if (hasNum) {
        card.appendChild(el('div', { class: 'anr-readout-section' }, 'Numeric distribution'));
        card.appendChild(numTbl);
    }
    if (hasText) {
        card.appendChild(el('div', { class: 'anr-readout-section' }, 'Text columns (cardinality / top values)'));
        card.appendChild(textTbl);
    }
    if (hasDate) {
        card.appendChild(el('div', { class: 'anr-readout-section' }, 'Date ranges'));
        card.appendChild(dateTbl);
    }
    // ---- Data-quality checks ----
    const expected = headers.length;
    let ragged = 0;
    for (const r of dataRows) {
        if (r.length !== expected)
            ragged++;
    }
    // Fully-duplicate data rows (compared by joined cells).
    const seen = new Set();
    let dupes = 0;
    for (const r of sample) {
        const key = r.join('');
        if (seen.has(key))
            dupes++;
        else
            seen.add(key);
    }
    // Delimiter confidence: share of data rows split into exactly `expected` cols.
    let consistent = 0;
    for (const r of dataRows) {
        if (r.length === expected)
            consistent++;
    }
    const conf = dataRows.length ? Math.round((consistent / dataRows.length) * 100) : 100;
    const issues = [];
    if (ragged > 0) {
        issues.push(['Ragged rows',
            `${ragged} row(s) have a column count different from the header (${expected}).`]);
    }
    if (dupes > 0) {
        issues.push(['Duplicate rows',
            `${dupes} fully-duplicate data row(s)${sampled ? ' in sample' : ''}.`]);
    }
    if (hasBom) {
        issues.push(['Encoding', 'A UTF-8 byte-order mark (BOM) was found at the start of the file.']);
    }
    if (lineEnding === 'Mixed (CRLF + LF)') {
        issues.push(['Line endings', 'File mixes CRLF and LF line endings.']);
    }
    if (conf < 100) {
        issues.push(['Delimiter confidence',
            `Only ${conf}% of rows split cleanly into ${expected} columns with "${delimiterLabel(delimiter)}".`]);
    }
    if (issues.length > 0) {
        card.appendChild(el('div', { class: 'anr-readout-section' }, 'Data quality'));
        const qTbl = el('table', { class: 'anr-readout' });
        for (const [k, v] of issues)
            qTbl.appendChild(row(k, v));
        card.appendChild(qTbl);
    }
    else {
        card.appendChild(el('div', { class: 'anr-readout-section' }, 'Data quality'));
        const qTbl = el('table', { class: 'anr-readout' });
        qTbl.appendChild(row('Status', 'No issues detected.'));
        qTbl.appendChild(row('Line endings', lineEnding));
        qTbl.appendChild(row('Delimiter confidence', `${conf}% of rows split cleanly into ${expected} columns.`));
        card.appendChild(qTbl);
    }
    // ---- Anomalies (statistical / synthetic-pattern tells) ----
    if (anomalies.length > 0) {
        card.appendChild(el('div', { class: 'anr-readout-section' }, 'Anomalies'));
        const aTbl = el('table', { class: 'anr-readout' });
        for (const [k, v] of anomalies)
            aTbl.appendChild(row(k, v));
        card.appendChild(aTbl);
    }
}
// Human-readable spacing between two timestamps, for the regular-cadence tell.
function fmtStep(ms) {
    const day = 86400000;
    if (ms % day === 0) {
        const d = ms / day;
        return d === 1 ? '1 day' : d + ' days';
    }
    if (ms % 3600000 === 0) {
        const h = ms / 3600000;
        return h === 1 ? '1 hour' : h + ' hours';
    }
    if (ms % 60000 === 0) {
        const m = ms / 60000;
        return m === 1 ? '1 minute' : m + ' minutes';
    }
    return Math.round(ms / 1000) + ' seconds';
}
// Decode a CSV's bytes. Excel's "Unicode text" export is UTF-16 with a BOM,
// and its plain "CSV" export is the Windows ANSI code page, so UTF-8 is only
// the first guess: a UTF-16 BOM picks UTF-16, and bytes that are not valid
// UTF-8 fall back to windows-1252 rather than turning every accented letter
// into U+FFFD. A UTF-8 BOM is kept as U+FEFF, as File.text() always did, so
// the BOM check below still sees it.
function decodeCsvBytes(b) {
    if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe)
        return { text: new TextDecoder('utf-16le').decode(b), encoding: 'UTF-16 LE' };
    if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff)
        return { text: new TextDecoder('utf-16be').decode(b), encoding: 'UTF-16 BE' };
    try {
        return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(b), encoding: 'UTF-8' };
    }
    catch (_) {
        return { text: new TextDecoder('windows-1252').decode(b), encoding: 'Windows-1252 (not valid UTF-8)' };
    }
}
function truncate(s, n = 24) {
    s = String(s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
export async function renderCsv(file, resultsEl) {
    resultsEl.hidden = false;
    resultsEl.innerHTML = '';
    resultsEl.appendChild(el('div', { class: 'anr-info' }, `Parsing "${file.name}"…`));
    if (file.size > CSV_FULL_MAX) {
        try {
            await renderCsvStreamed(file, resultsEl);
        }
        catch (e) {
            resultsEl.innerHTML = '';
            resultsEl.appendChild(errorCard('Could not read file: ' + (e && e.message)));
        }
        return;
    }
    let text;
    let encoding = 'UTF-8';
    try {
        const decoded = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
        encoding = decoded.encoding;
        text = decoded.text;
    }
    catch (e) {
        resultsEl.innerHTML = '';
        resultsEl.appendChild(errorCard('Could not read file: ' + (e && e.message)));
        return;
    }
    resultsEl.innerHTML = '';
    // --- Encoding / line-ending sniffing (cheap, on raw text) ---
    // A UTF-8 BOM survives File.text() as U+FEFF at index 0.
    const hasBom = text.charCodeAt(0) === 0xfeff;
    if (hasBom)
        text = text.slice(1);
    // A gyro / accelerometer CSV (e.g. exported from a video's gyro track) - draw
    // the traces on a timeline instead of a generic column table.
    if (looksLikeGyroCsv(text)) {
        await renderGyroCsv(file, resultsEl, text);
        return;
    }
    const crlfCount = (text.match(/\r\n/g) || []).length;
    const lfOnly = (text.match(/[^\r]\n/g) || []).length + (text[0] === '\n' ? 1 : 0);
    let lineEnding;
    if (crlfCount > 0 && lfOnly === 0)
        lineEnding = 'CRLF (Windows)';
    else if (crlfCount === 0 && lfOnly > 0)
        lineEnding = 'LF (Unix)';
    else if (crlfCount > 0 && lfOnly > 0)
        lineEnding = 'Mixed (CRLF + LF)';
    else
        lineEnding = 'None';
    // Detect delimiter. For non-TSV files, score the first line across the four
    // common delimiters (comma, tab, semicolon, pipe) instead of only tab-vs-comma.
    const delimiter = pickDelimiter(text, fileExt(file.name));
    // Quote-aware parse of the whole text (handles fields spanning newlines).
    const allRows = parseCsv(text, delimiter);
    const totalRows = allRows.length;
    // Reduce, not Math.max(...spread): a CSV with hundreds of thousands of rows
    // would blow the call-stack arg limit when spread as function arguments.
    const colCount = allRows.reduce((mx, r) => (r.length > mx ? r.length : mx), 0);
    const hasHeader = totalRows > 1; // assume first row is a header
    // --- Workbench: virtualised grid, stats, group-by, charts, export (leads
    // the analysis - it's the primary way to work with the data). ---
    const wbHeaders = hasHeader && allRows.length > 0
        ? allRows[0]
        : Array.from({ length: colCount }, (_, c) => `Col ${c + 1}`);
    const wbRows = allRows.slice(hasHeader ? 1 : 0);
    const tkHost = el('div');
    resultsEl.appendChild(tkHost);
    import('./tablekit.js').then(({ mountTableKit }) => {
        mountTableKit(tkHost, { headers: wbHeaders, rows: wbRows, totalRows: wbRows.length });
    }).catch(() => { });
    // --- Stats card ---
    const statsCard = el('div', { class: 'anr-card' });
    statsCard.appendChild(el('h3', {}, 'CSV / TSV file'));
    const tbl = el('table', { class: 'anr-readout' });
    tbl.appendChild(row('Application', 'CSV / TSV Spreadsheet'));
    tbl.appendChild(row('Name', file.name));
    tbl.appendChild(row('Size', `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`));
    if (encoding !== 'UTF-8')
        tbl.appendChild(row('Text encoding', encoding));
    tbl.appendChild(rowHelp('Delimiter', delimiterLabel(delimiter), 'The character that marks where one column ends and the next begins - a comma (.csv files), a tab (.tsv), a semicolon, or a pipe (|).'));
    tbl.appendChild(row('Columns', String(colCount)));
    tbl.appendChild(row('Data rows', String(hasHeader ? totalRows - 1 : totalRows)));
    statsCard.appendChild(tbl);
    // Detect column types and compute stats for numeric columns
    if (hasHeader && allRows.length > 1) {
        const headers = allRows[0];
        const dataRows = allRows.slice(1);
        const colTypes = inferColumnTypes(dataRows, colCount);
        const numericStats = [];
        for (let c = 0; c < colCount; c++) {
            if (colTypes[c] !== 'number')
                continue;
            const nums = columnValues(dataRows, c, 'number');
            if (!nums.length)
                continue;
            // Same call-stack hazard as colCount above - a numeric column with
            // hundreds of thousands of values cannot be spread as arguments, and
            // this sits outside the buildProfile try/catch, so a throw here would
            // take the whole render down. One pass, no spread.
            let min = Infinity, max = -Infinity, sum = 0;
            for (let i = 0; i < nums.length; i++) {
                const n = nums[i];
                if (n < min)
                    min = n;
                if (n > max)
                    max = n;
                sum += n;
            }
            const mean = sum / nums.length;
            numericStats.push({
                col: headers[c] || `Col ${c + 1}`,
                min, max, mean: mean.toFixed(2), count: nums.length
            });
        }
        // Column types table
        statsCard.appendChild(el('div', { class: 'anr-readout-section' }, 'Column types'));
        const typesTbl = el('table', { class: 'anr-readout' });
        for (let c = 0; c < colCount; c++) {
            const header = headers[c] || `Col ${c + 1}`;
            typesTbl.appendChild(row(header, colTypes[c]));
        }
        statsCard.appendChild(typesTbl);
        // Numeric column stats
        if (numericStats.length > 0) {
            statsCard.appendChild(el('div', { class: 'anr-readout-section' }, 'Numeric column statistics'));
            const numTbl = el('table', { class: 'anr-readout' });
            for (const s of numericStats) {
                numTbl.appendChild(row(s.col, `min: ${s.min}  max: ${s.max}  mean: ${s.mean}  (${s.count} values)`));
            }
            statsCard.appendChild(numTbl);
        }
        // --- Additive: richer per-column profiling + data-quality checks ---
        // Wrapped so any malformed data can never break the preview below.
        try {
            buildProfile(statsCard, {
                headers, dataRows, colCount, colTypes,
                totalRows, hasHeader, delimiter, hasBom, lineEnding,
            });
        }
        catch (e) {
            statsCard.appendChild(el('div', { class: 'anr-info' }, 'Extended statistics unavailable: ' + (e && e.message)));
        }
    }
    resultsEl.appendChild(statsCard);
    resultsEl.appendChild(integrityCard(file));
}
// A CSV past CSV_FULL_MAX, read in slices through csvStreamParser. What can be
// counted as it goes covers the whole file - rows, columns, ragged rows, line
// endings, numeric min/max/mean. What needs the rows held (column types, the
// profile, the workbench) uses the first rows that fit CSV_KEEP_CHARS.
async function renderCsvStreamed(file, resultsEl) {
    const status = resultsEl.firstElementChild;
    const head = new Uint8Array(await file.slice(0, Math.min(file.size, 1024 * 1024)).arrayBuffer());
    let label = 'utf-8', encoding = 'UTF-8';
    if (head[0] === 0xff && head[1] === 0xfe) {
        label = 'utf-16le';
        encoding = 'UTF-16 LE';
    }
    else if (head[0] === 0xfe && head[1] === 0xff) {
        label = 'utf-16be';
        encoding = 'UTF-16 BE';
    }
    else {
        try {
            new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: true });
        }
        catch (_) {
            label = 'windows-1252';
            encoding = 'Windows-1252 (not valid UTF-8)';
        }
    }
    const headText = new TextDecoder(label).decode(head, { stream: true });
    const delimiter = pickDelimiter(headText, fileExt(file.name));
    const pass = async (enc, fatal) => {
        // The UTF-8 BOM is kept and reported, as the whole-file path does; UTF-16's
        // is consumed by the decoder there too.
        const dec = new TextDecoder(enc, { fatal, ignoreBOM: enc === 'utf-8' });
        const s = {
            rows: 0, colCount: 0, header: null, kept: [], keptChars: 0, keepOpen: true,
            ragged: 0, nCount: [], nMin: [], nMax: [], nSum: [],
            crlf: 0, lf: 0, hasBom: false,
        };
        const parser = csvStreamParser(delimiter, (r) => {
            s.rows++;
            if (r.length > s.colCount)
                s.colCount = r.length;
            if (!s.header) {
                s.header = r;
                return;
            }
            if (r.length !== s.header.length)
                s.ragged++;
            if (s.keepOpen) {
                let chars = 0;
                for (const v of r)
                    chars += v.length;
                if (s.keptChars + chars > CSV_KEEP_CHARS)
                    s.keepOpen = false;
                else {
                    s.kept.push(r);
                    s.keptChars += chars;
                }
            }
            for (let c = 0; c < r.length; c++) {
                const v = r[c].trim();
                if (v === '')
                    continue;
                const x = Number(v);
                if (isNaN(x))
                    continue;
                if (s.nCount[c] === undefined) {
                    s.nCount[c] = 0;
                    s.nMin[c] = Infinity;
                    s.nMax[c] = -Infinity;
                    s.nSum[c] = 0;
                }
                s.nCount[c]++;
                if (x < s.nMin[c])
                    s.nMin[c] = x;
                if (x > s.nMax[c])
                    s.nMax[c] = x;
                s.nSum[c] += x;
            }
        });
        let prevCR = false;
        for (let off = 0; off < file.size; off += CSV_STREAM_CHUNK) {
            // A new file dropped meanwhile has emptied the results area: stop.
            if (status && !status.isConnected)
                return null;
            const end = Math.min(file.size, off + CSV_STREAM_CHUNK);
            let text = dec.decode(new Uint8Array(await file.slice(off, end).arrayBuffer()), { stream: end < file.size });
            if (off === 0 && text.charCodeAt(0) === 0xfeff) {
                s.hasBom = true;
                text = text.slice(1);
            }
            for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
                if (i > 0 ? text.charCodeAt(i - 1) === 13 : prevCR)
                    s.crlf++;
                else
                    s.lf++;
            }
            if (text.length)
                prevCR = text.charCodeAt(text.length - 1) === 13;
            parser.feed(text);
            if (status)
                status.textContent = `Reading "${file.name}"… ${Math.round(end / file.size * 100)}%  (${s.rows.toLocaleString()} rows)`;
        }
        parser.end();
        return s;
    };
    let st;
    try {
        st = await pass(label, label === 'utf-8');
    }
    catch (e) {
        // Invalid UTF-8 past the first megabyte: the whole-file path would have
        // fallen back to windows-1252, so this does too.
        if (label !== 'utf-8' || !(e instanceof TypeError))
            throw e;
        encoding = 'Windows-1252 (not valid UTF-8)';
        st = await pass('windows-1252', false);
    }
    if (!st)
        return;
    resultsEl.innerHTML = '';
    const colCount = st.colCount;
    const hasHeader = st.rows > 1;
    const headers = hasHeader ? st.header : Array.from({ length: colCount }, (_, c) => `Col ${c + 1}`);
    const dataRows = hasHeader ? st.kept : (st.header ? [st.header] : []);
    const dataTotal = hasHeader ? st.rows - 1 : st.rows;
    const held = dataRows.length < dataTotal;
    let lineEnding;
    if (st.crlf > 0 && st.lf === 0)
        lineEnding = 'CRLF (Windows)';
    else if (st.crlf === 0 && st.lf > 0)
        lineEnding = 'LF (Unix)';
    else if (st.crlf > 0 && st.lf > 0)
        lineEnding = 'Mixed (CRLF + LF)';
    else
        lineEnding = 'None';
    const tkHost = el('div');
    resultsEl.appendChild(tkHost);
    import('./tablekit.js').then(({ mountTableKit }) => {
        mountTableKit(tkHost, { headers, rows: dataRows, totalRows: dataRows.length });
    }).catch(() => { });
    const statsCard = el('div', { class: 'anr-card' });
    statsCard.appendChild(el('h3', {}, 'CSV / TSV file'));
    const tbl = el('table', { class: 'anr-readout' });
    tbl.appendChild(row('Application', 'CSV / TSV Spreadsheet'));
    tbl.appendChild(row('Name', file.name));
    tbl.appendChild(row('Size', `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`));
    if (encoding !== 'UTF-8')
        tbl.appendChild(row('Text encoding', encoding));
    tbl.appendChild(rowHelp('Delimiter', delimiterLabel(delimiter), 'The character that marks where one column ends and the next begins - a comma (.csv files), a tab (.tsv), a semicolon, or a pipe (|).'));
    tbl.appendChild(row('Columns', String(colCount)));
    tbl.appendChild(row('Data rows', dataTotal.toLocaleString()));
    if (held) {
        tbl.appendChild(rowHelp('Rows held', `the first ${dataRows.length.toLocaleString()} of ${dataTotal.toLocaleString()}`, 'This file is too large to hold every row in memory, so it was read in pieces. The row and column counts, ragged rows, line endings and the numeric min / max / mean cover the whole file; the column types, the profile and the workbench use the first rows.'));
        if (hasHeader)
            tbl.appendChild(row('Ragged rows (whole file)', st.ragged
                ? `${st.ragged.toLocaleString()} row(s) have a column count different from the header (${headers.length}).`
                : 'none'));
    }
    statsCard.appendChild(tbl);
    if (hasHeader && dataRows.length > 0) {
        const colTypes = inferColumnTypes(dataRows, colCount);
        statsCard.appendChild(el('div', { class: 'anr-readout-section' }, 'Column types'));
        const typesTbl = el('table', { class: 'anr-readout' });
        for (let c = 0; c < colCount; c++)
            typesTbl.appendChild(row(headers[c] || `Col ${c + 1}`, colTypes[c]));
        statsCard.appendChild(typesTbl);
        const numTbl = el('table', { class: 'anr-readout' });
        let anyNum = false;
        for (let c = 0; c < colCount; c++) {
            if (colTypes[c] !== 'number' || !st.nCount[c])
                continue;
            anyNum = true;
            numTbl.appendChild(row(headers[c] || `Col ${c + 1}`, `min: ${st.nMin[c]}  max: ${st.nMax[c]}  mean: ${(st.nSum[c] / st.nCount[c]).toFixed(2)}  (${st.nCount[c]} values)`));
        }
        if (anyNum) {
            statsCard.appendChild(el('div', { class: 'anr-readout-section' }, held ? 'Numeric column statistics (whole file)' : 'Numeric column statistics'));
            statsCard.appendChild(numTbl);
        }
        try {
            buildProfile(statsCard, {
                headers, dataRows, colCount, colTypes,
                totalRows: dataRows.length + 1, hasHeader, delimiter, hasBom: st.hasBom, lineEnding,
            });
        }
        catch (e) {
            statsCard.appendChild(el('div', { class: 'anr-info' }, 'Extended statistics unavailable: ' + (e && e.message)));
        }
    }
    resultsEl.appendChild(statsCard);
    resultsEl.appendChild(integrityCard(file));
}
//# sourceMappingURL=csv.js.map