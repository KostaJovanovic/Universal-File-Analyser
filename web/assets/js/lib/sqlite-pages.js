/* Analyser - SQLite read straight from the file's pages.

   sql.js copies the whole database into a 32-bit WASM heap, so past
   SQLITE_ENGINE_MAX a database is read here instead, with small slices of the
   File: the header, the schema table on page 1, each table's b-tree walked for
   its row count, and the first rows of the largest table decoded from their
   records. It returns the same shape as sqliteAnalysis() in sqlite.ts, so the
   caller draws one readout either way. There is no SQL here - this is what lets
   a multi-GB database open at all, read-only by construction.

   Layout reference: https://www.sqlite.org/fileformat2.html */
import { SQLITE_PAGE_SCAN_MAX, SQLITE_PAGE_READS_MAX } from '../core/limits.js';
const u32 = (b, p) => ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
const i32 = (b, p) => u32(b, p) | 0;
// SQLite varint: 1-9 bytes, big-endian, 7 bits a byte, the ninth byte whole.
function varint(b, p) {
    let v = 0;
    for (let i = 0; i < 8; i++) {
        const c = b[p + i];
        v = v * 128 + (c & 0x7f);
        if (!(c & 0x80))
            return [v, p + i + 1];
    }
    return [v * 256 + b[p + 8], p + 9];
}
// Reads are budgeted for the whole analysis: an honest database's interior pages
// are about 1% of it, while a forged one can make every page interior, or list
// thousands of tables over one tree, and walk for minutes. Past the budget a page
// reads as missing, which every walker already treats as "stop here".
function pager(file, ps) {
    const cache = new Map();
    let reads = 0;
    return async (n) => {
        const hit = cache.get(n);
        if (hit)
            return hit;
        const off = (n - 1) * ps;
        if (n < 1 || off >= file.size || ++reads > SQLITE_PAGE_READS_MAX)
            return null;
        const page = new Uint8Array(await file.slice(off, off + ps).arrayBuffer());
        if (page.length < ps)
            return null;
        if (cache.size > 4096)
            cache.clear();
        cache.set(n, page);
        return page;
    };
}
// A b-tree page's header. Page 1 carries the 100-byte file header first.
// Types: 2 interior index, 5 interior table, 10 leaf index, 13 leaf table.
function btree(page, n) {
    const h = n === 1 ? 100 : 0;
    const type = page[h];
    if (type !== 2 && type !== 5 && type !== 10 && type !== 13)
        return null;
    const leaf = type >= 10;
    const cells = (page[h + 3] << 8) | page[h + 4];
    const ptrs = h + (leaf ? 8 : 12);
    return {
        type, leaf, cells,
        right: leaf ? 0 : u32(page, h + 8),
        cell: (i) => (page[ptrs + 2 * i] << 8) | page[ptrs + 2 * i + 1],
    };
}
function children(page, t) {
    const out = [];
    for (let i = 0; i < t.cells; i++)
        out.push(u32(page, t.cell(i)));
    out.push(t.right);
    return out;
}
// A cell's payload, following its overflow chain, read only up to `cap` bytes.
// U is the usable page size; table and index b-trees spill at different points.
async function payload(read, page, at, P, U, index, cap) {
    const X = index ? Math.floor((U - 12) * 64 / 255) - 23 : U - 35;
    let local = P;
    if (P > X) {
        const M = Math.floor((U - 12) * 32 / 255) - 23;
        const K = M + ((P - M) % (U - 4));
        local = K <= X ? K : M;
    }
    const want = Math.min(P, cap);
    const out = new Uint8Array(want);
    let got = Math.min(local, want);
    out.set(page.subarray(at, at + got));
    let next = local < P ? u32(page, at + local) : 0;
    const seen = new Set();
    while (got < want && next && !seen.has(next)) {
        seen.add(next);
        const ov = await read(next);
        if (!ov)
            break;
        const take = Math.min(U - 4, want - got);
        out.set(ov.subarray(4, 4 + take), got);
        got += take;
        next = u32(ov, 0);
    }
    return out.subarray(0, got);
}
// Decode a record: a header of serial types, then the values. A value cut off
// by the payload cap decodes as far as it goes.
function record(b, dec) {
    const [hl, p0] = varint(b, 0);
    const types = [];
    for (let p = p0; p < hl && p < b.length;) {
        const [t, q] = varint(b, p);
        types.push(t);
        p = q;
    }
    const vals = [];
    let d = hl;
    for (const t of types) {
        let len = 0, v = null;
        if (t >= 1 && t <= 6) {
            len = [0, 1, 2, 3, 4, 6, 8][t];
            if (d + len <= b.length) {
                v = 0;
                for (let i = 0; i < len; i++)
                    v = v * 256 + b[d + i];
                if (b[d] & 0x80)
                    v -= Math.pow(2, 8 * len);
            }
        }
        else if (t === 7) {
            len = 8;
            if (d + 8 <= b.length)
                v = new DataView(b.buffer, b.byteOffset + d, 8).getFloat64(0);
        }
        else if (t === 8)
            v = 0;
        else if (t === 9)
            v = 1;
        else if (t >= 12) {
            len = (t - ((t & 1) ? 13 : 12)) / 2;
            const s = b.subarray(Math.min(d, b.length), Math.min(b.length, d + len));
            v = (t & 1) ? dec.decode(s) : s.slice();
        }
        vals.push(v);
        d += len;
    }
    return vals;
}
// Every leaf cell of a b-tree in key order, depth first. `cb` returns false to stop.
async function forEachLeafCell(read, root, cb) {
    const stack = [root];
    const seen = new Set();
    while (stack.length) {
        const n = stack.pop();
        if (!n || seen.has(n))
            continue;
        seen.add(n);
        const page = await read(n);
        const t = page && btree(page, n);
        if (!t)
            continue;
        if (t.leaf) {
            for (let i = 0; i < t.cells; i++)
                if (!(await cb(page, t.cell(i), t.type)))
                    return;
            continue;
        }
        const kids = children(page, t);
        for (let i = kids.length - 1; i >= 0; i--)
            stack.push(kids[i]);
    }
}
// Rows in a b-tree. Every leaf sits at the same depth, so the interior levels
// are read page by page (they are a few hundredth of the tree) and the leaf
// level is counted from each leaf's 2-byte cell count, read in large merged
// slices. An index b-tree (a WITHOUT ROWID table) also holds entries in its
// interior cells. Past SQLITE_PAGE_SCAN_MAX of leaves, an even sample of 1024
// leaves gives an estimate instead.
async function countRows(file, read, ps, root) {
    let level = [root], interiorCells = 0;
    const seen = new Set([root]);
    for (let depth = 0; depth < 24 && level.length; depth++) {
        const first = await read(level[0]);
        const ft = first && btree(first, level[0]);
        if (!ft)
            return null;
        if (ft.leaf) {
            const c = await countLeaves(file, ps, level);
            return { rows: c.count + interiorCells, estimated: c.estimated };
        }
        const next = [];
        for (const n of level) {
            const page = await read(n);
            const t = page && btree(page, n);
            if (!t || t.leaf)
                continue;
            if (t.type === 2)
                interiorCells += t.cells;
            for (const k of children(page, t))
                if (k && !seen.has(k)) {
                    seen.add(k);
                    next.push(k);
                }
        }
        level = next;
    }
    return null;
}
async function countLeaves(file, ps, leaves) {
    let pick = leaves, estimated = false;
    if (leaves.length * ps > SQLITE_PAGE_SCAN_MAX) {
        const step = Math.ceil(leaves.length / 1024);
        pick = leaves.filter((_, i) => i % step === 0);
        estimated = true;
    }
    const sorted = pick.slice().sort((a, b) => a - b);
    // Merge pages closer than GAP into one read of at most BATCH; sampled pages
    // are far apart, so they are read on their own.
    const GAP = estimated ? 0 : 1024 * 1024, BATCH = 16 * 1024 * 1024;
    let total = 0;
    for (let i = 0; i < sorted.length;) {
        const start = (sorted[i] - 1) * ps;
        let j = i;
        while (j + 1 < sorted.length && (sorted[j + 1] - sorted[j] - 1) * ps <= GAP && sorted[j + 1] * ps - start <= BATCH)
            j++;
        const span = new Uint8Array(await file.slice(start, (sorted[j] - 1) * ps + 112).arrayBuffer());
        for (let k = i; k <= j; k++) {
            const o = (sorted[k] - 1) * ps - start + (sorted[k] === 1 ? 100 : 0);
            if (span[o] === 10 || span[o] === 13)
                total += (span[o + 3] << 8) | span[o + 4];
        }
        i = j + 1;
    }
    return { count: estimated ? Math.round(total * leaves.length / pick.length) : total, estimated };
}
// Column list from a CREATE TABLE statement - what PRAGMA table_info would say,
// for the ordinary shapes: name, declared type, NOT NULL, PRIMARY KEY (on the
// column or as a table constraint).
function parseColumns(sql) {
    const cols = [];
    const s = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const open = s.indexOf('(');
    if (open < 0)
        return cols;
    const parts = [];
    let depth = 0, cur = '', q = '';
    for (let i = open + 1; i < s.length; i++) {
        const ch = s[i];
        if (q) {
            cur += ch;
            if (ch === q)
                q = '';
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`' || ch === '[') {
            q = ch === '[' ? ']' : ch;
            cur += ch;
            continue;
        }
        if (ch === '(')
            depth++;
        else if (ch === ')') {
            if (depth === 0) {
                parts.push(cur);
                break;
            }
            depth--;
        }
        else if (ch === ',' && depth === 0) {
            parts.push(cur);
            cur = '';
            continue;
        }
        cur += ch;
    }
    const unquote = (n) => {
        const m = /^(["`'])([\s\S]*)\1$/.exec(n) || /^\[([\s\S]*)\]$/.exec(n);
        if (!m)
            return n;
        return m.length === 3 ? m[2].split(m[1] + m[1]).join(m[1]) : m[1];
    };
    const tablePk = [];
    for (const raw of parts) {
        const p = raw.trim();
        if (!p)
            continue;
        if (/^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY)\b/i.test(p)) {
            const m = /PRIMARY\s+KEY\s*\(([^)]*)\)/i.exec(p);
            if (m)
                for (const n of m[1].split(','))
                    tablePk.push(unquote(n.trim().split(/\s+/)[0]).toLowerCase());
            continue;
        }
        const nm = /^("(?:[^"]|"")*"|`(?:[^`]|``)*`|'(?:[^']|'')*'|\[[^\]]*\]|\S+)\s*([\s\S]*)$/.exec(p);
        if (!nm)
            continue;
        const rest = nm[2];
        const kw = /\b(CONSTRAINT|PRIMARY|NOT|NULL|UNIQUE|CHECK|DEFAULT|COLLATE|REFERENCES|GENERATED|AS)\b/i.exec(rest);
        const type = (kw ? rest.slice(0, kw.index) : rest).trim().replace(/\s+/g, ' ');
        cols.push({ name: unquote(nm[1]), type: type || 'BLOB', notnull: /\bNOT\s+NULL\b/i.test(rest), pk: /\bPRIMARY\s+KEY\b/i.test(rest) });
    }
    for (const c of cols)
        if (tablePk.includes(c.name.toLowerCase()))
            c.pk = true;
    return cols;
}
export async function sqlitePageAnalysis(file) {
    try {
        const h = new Uint8Array(await file.slice(0, 100).arrayBuffer());
        if (h.length < 100 || new TextDecoder().decode(h.subarray(0, 16)) !== 'SQLite format 3\0')
            return null;
        const raw = (h[16] << 8) | h[17];
        const ps = raw === 1 ? 65536 : raw;
        if (ps < 512 || (ps & (ps - 1)))
            return null;
        const U = ps - h[20];
        const enc = u32(h, 56);
        const dec = new TextDecoder(enc === 2 ? 'utf-16le' : enc === 3 ? 'utf-16be' : 'utf-8');
        const read = pager(file, ps);
        // The in-header page count is valid only when its version-valid-for number
        // matches the change counter; older writers leave it stale.
        const inHeader = u32(h, 28);
        const pragma = {
            page_size: ps,
            page_count: inHeader && u32(h, 24) === u32(h, 92) ? inHeader : Math.floor(file.size / ps),
            encoding: ['UTF-8', 'UTF-8', 'UTF-16le', 'UTF-16be'][enc] || 'UTF-8',
            user_version: i32(h, 60),
            application_id: i32(h, 68),
            auto_vacuum: u32(h, 52) ? (u32(h, 64) ? 2 : 1) : 0,
        };
        // The schema table: type, name, tbl_name, rootpage, sql.
        const objs = [];
        await forEachLeafCell(read, 1, async (page, at, type) => {
            if (type !== 13)
                return true;
            const [P, p1] = varint(page, at);
            const [, p2] = varint(page, p1);
            const v = record(await payload(read, page, p2, P, U, false, 1024 * 1024), dec);
            if (typeof v[1] === 'string' && !/^sqlite_/i.test(v[1])) {
                objs.push({ type: String(v[0]), name: v[1], root: Number(v[3]) || 0, sql: typeof v[4] === 'string' ? v[4] : null });
            }
            return true;
        });
        objs.sort((a, b) => a.type < b.type ? -1 : a.type > b.type ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
        const tables = [];
        for (const o of objs.filter((o) => o.type === 'table')) {
            const cols = o.sql ? parseColumns(o.sql) : [];
            const c = o.root > 0 ? await countRows(file, read, ps, o.root) : null;
            const rowid = !(o.sql && /\)\s*WITHOUT\s+ROWID\s*;?\s*$/i.test(o.sql));
            // A WITHOUT ROWID table's key columns are NOT NULL whether stated or not.
            if (!rowid)
                for (const col of cols)
                    if (col.pk)
                        col.notnull = true;
            tables.push({ name: o.name, rows: c ? c.rows : null, cols, estimated: !!(c && c.estimated), root: o.root, rowid });
        }
        const views = objs.filter((o) => o.type === 'view').map((o) => o.name);
        const indexes = objs.filter((o) => o.type === 'index').map((o) => o.name);
        const triggers = objs.filter((o) => o.type === 'trigger').map((o) => o.name);
        const ddl = objs.filter((o) => o.sql).map((o) => o.sql.trim().replace(/;?\s*$/, ';')).join('\n\n');
        // First rows of the largest ordinary (rowid) table. An INTEGER PRIMARY KEY
        // column is the rowid itself and is stored as NULL in the record.
        let sample = null;
        const biggest = tables.filter((t) => t.rows && t.rowid && t.root > 0).sort((a, b) => b.rows - a.rows)[0];
        if (biggest) {
            const pks = biggest.cols.filter((c) => c.pk);
            const alias = pks.length === 1 && pks[0].type.toUpperCase() === 'INTEGER' ? biggest.cols.indexOf(pks[0]) : -1;
            const rows = [];
            await forEachLeafCell(read, biggest.root, async (page, at, type) => {
                if (type !== 13)
                    return false;
                const [P, p1] = varint(page, at);
                const [rowid, p2] = varint(page, p1);
                const v = record(await payload(read, page, p2, P, U, false, 64 * 1024), dec);
                while (v.length < biggest.cols.length)
                    v.push(null);
                if (alias >= 0 && v[alias] == null)
                    v[alias] = rowid;
                rows.push(v);
                return rows.length < 5;
            });
            if (rows.length) {
                const width = Math.max(biggest.cols.length, ...rows.map((r) => r.length));
                sample = { table: biggest.name, columns: Array.from({ length: width }, (_, i) => biggest.cols[i] ? biggest.cols[i].name : 'column' + (i + 1)), rows };
            }
        }
        return { pragma, tables, views, indexes, triggers, ddl, sample };
    }
    catch (_) {
        return null;
    }
}
//# sourceMappingURL=sqlite-pages.js.map