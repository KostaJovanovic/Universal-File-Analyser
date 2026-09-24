/* Analyser - archive module
   Reads a ZIP's central directory and unpacks single entries on demand by
   their local-header offset (inflation shared with zip.js, capped per entry),
   so the archive is never unpacked whole.
   Uses the shared folder/archive modules for treemap, breakdown, and tree. */
import { el, row, rowHelp, h3help, fmtBytes, buildFileTree, isUnreadableError, cloudFileWarning, errorCard, integrityCard, loadScript, asciiBar } from '../core/util.js';
import { normalizeArchive, renderBreakdownCards, renderViewToggle, categorizeExt } from './folder-archive-shared.js';
import { ARCHIVE_EXTS } from '../core/formats.js';
import { WALL_INDEX, DECOMP_ENTRY_MAX, DECOMP_OUTPUT_MAX, LIST_ENTRIES_MAX } from '../core/limits.js';
import { inflateZipData } from './zip.js';
import { extractArchive } from '../lib/libarchive-loader.js';
import { gunzip } from '../core/binutil.js';
import { xzDecompress } from '../lib/xz-loader.js';
import { unlz4, unlzw } from '../lib/legacy-decompress.js';
import { lzmaDecompress } from '../lib/lzma-loader.js';
// ---------- ZIP parsing via central directory ----------
// Code page 437, bytes 0x80-0xFF - the encoding APPNOTE assigns to a ZIP name
// whose general-purpose bit 11 (UTF-8) is clear.
const CP437_HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
const utf8Strict = new TextDecoder('utf-8', { fatal: true });
const utf8Loose = new TextDecoder();
// Decode an entry name. Bit 11 set means UTF-8. With it clear the spec says
// CP437, but plenty of tools (macOS Archive Utility, many Linux zips) write
// UTF-8 without setting the flag, so a name that is valid UTF-8 is read as
// such and only the rest falls back to CP437. Entries are extracted by their
// local-header offset, never by this name, so the display choice cannot make
// an entry unopenable.
function decodeZipName(raw, flags) {
    if (flags & 0x0800)
        return utf8Loose.decode(raw);
    let ascii = true;
    for (let i = 0; i < raw.length; i++)
        if (raw[i] > 0x7F) {
            ascii = false;
            break;
        }
    if (ascii)
        return String.fromCharCode.apply(null, Array.from(raw));
    try {
        return utf8Strict.decode(raw);
    }
    catch (_) { /* not UTF-8 */ }
    let s = '';
    for (let i = 0; i < raw.length; i++)
        s += raw[i] < 0x80 ? String.fromCharCode(raw[i]) : CP437_HIGH[raw[i] - 0x80];
    return s;
}
function parseZipEntries(buf) {
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);
    const entries = [];
    let eocdOffset = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
        if (view.getUint32(i, true) === 0x06054b50) {
            eocdOffset = i;
            break;
        }
    }
    if (eocdOffset === -1)
        return entries;
    const cdOffset = view.getUint32(eocdOffset + 16, true);
    const cdSize = view.getUint32(eocdOffset + 12, true);
    const entryCount = view.getUint16(eocdOffset + 10, true);
    // A malformed EOCD can point cdOffset/cdSize outside the buffer. Clamp the
    // central-directory window to what actually exists so the per-header reads
    // below can't run a DataView getter past the end (which throws).
    if (cdOffset >= bytes.length)
        return entries;
    const cdEnd = Math.min(cdOffset + cdSize, bytes.length);
    let pos = cdOffset;
    // Each central-directory header is a fixed 46-byte record plus variable
    // name/extra/comment fields; require the fixed part to fit before reading it.
    for (let i = 0; i < entryCount && pos + 46 <= cdEnd; i++) {
        if (view.getUint32(pos, true) !== 0x02014b50)
            break;
        const versionMadeBy = view.getUint16(pos + 4, true);
        const flags = view.getUint16(pos + 8, true);
        const compMethod = view.getUint16(pos + 10, true);
        const modTime = view.getUint16(pos + 12, true);
        const modDate = view.getUint16(pos + 14, true);
        const crc = view.getUint32(pos + 16, true);
        let compSize = view.getUint32(pos + 20, true);
        let uncompSize = view.getUint32(pos + 24, true);
        const nameLen = view.getUint16(pos + 28, true);
        const extraLen = view.getUint16(pos + 30, true);
        const commentLen = view.getUint16(pos + 32, true);
        let lho = view.getUint32(pos + 42, true);
        const name = decodeZipName(bytes.subarray(pos + 46, Math.min(pos + 46 + nameLen, cdEnd)), flags);
        const isDir = name.endsWith('/');
        // Scan the extra field for a Zip64 extended-information record (id 0x0001).
        // It carries, in order, the 64-bit value of each field whose 32-bit slot
        // holds the 0xFFFFFFFF sentinel.
        let zip64 = false;
        {
            let ep = pos + 46 + nameLen;
            const extraEnd = Math.min(ep + extraLen, cdEnd);
            while (ep + 4 <= extraEnd) {
                const id = view.getUint16(ep, true);
                const sz = view.getUint16(ep + 2, true);
                if (id === 0x0001) {
                    zip64 = true;
                    let zp = ep + 4;
                    const zEnd = Math.min(ep + 4 + sz, extraEnd);
                    const next = () => { if (zp + 8 > zEnd)
                        return -1; const v = view.getUint32(zp, true) + view.getUint32(zp + 4, true) * 0x100000000; zp += 8; return v; };
                    if (uncompSize === 0xFFFFFFFF) {
                        const v = next();
                        if (v >= 0)
                            uncompSize = v;
                    }
                    if (compSize === 0xFFFFFFFF) {
                        const v = next();
                        if (v >= 0)
                            compSize = v;
                    }
                    if (lho === 0xFFFFFFFF) {
                        const v = next();
                        if (v >= 0)
                            lho = v;
                    }
                    break;
                }
                ep += 4 + sz;
            }
        }
        entries.push({ name, compSize, uncompSize, compMethod, crc, isDir, flags, versionMadeBy, modTime, modDate, zip64, lho, index: i });
        pos += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
}
// Read one entry's data straight from its local header (the central-directory
// offset), so an entry is found by position rather than by name - duplicate or
// oddly encoded names still open the right bytes. Inflation stops at `maxOut`,
// and an entry whose declared size is already past it is refused unread.
// Returns null for an encrypted, unsupported, corrupt or over-cap entry.
async function readZipEntry(buf, e, maxOut) {
    if (!e || e.isDir || isEncrypted(e))
        return null;
    if (e.uncompSize > maxOut)
        return null;
    const bytes = new Uint8Array(buf);
    const lho = e.lho;
    if (typeof lho !== 'number' || lho + 30 > bytes.length)
        return null;
    const view = new DataView(buf);
    if (view.getUint32(lho, true) !== 0x04034b50)
        return null;
    const ds = lho + 30 + view.getUint16(lho + 26, true) + view.getUint16(lho + 28, true);
    if (ds + e.compSize > bytes.length)
        return null;
    return inflateZipData(bytes.subarray(ds, ds + e.compSize), e.compMethod, maxOut);
}
// True when a blob starts with a ZIP signature (local header or an empty
// archive's EOCD) - the only thing renderArchive can read.
async function isZipBlob(f) {
    try {
        const h = new Uint8Array(await f.slice(0, 4).arrayBuffer());
        return h[0] === 0x50 && h[1] === 0x4B && ((h[2] === 0x03 && h[3] === 0x04) || (h[2] === 0x05 && h[3] === 0x06));
    }
    catch (_) {
        return false;
    }
}
// Build the nested object buildFileTree() walks from a flat entry list. Entry
// paths are attacker-chosen text, so every directory node is prototype-free
// (`__proto__/x` must be a folder, never a write to Object.prototype) and
// directories are recognised by identity (dirNodes), not by the absence of a
// `name` field. Two entries with the same path - legal in a ZIP - both stay
// listed, the later one suffixed " (2)".
function buildEntryTree(entries, isDirEntry) {
    const dirNodes = new WeakSet();
    const fileNodes = new WeakSet();
    const mkDir = () => { const d = Object.create(null); dirNodes.add(d); return d; };
    const tree = mkDir();
    const dupes = new Map();
    for (const entry of entries) {
        const parts = String(entry.name).split('/').filter((p) => p);
        let node = tree;
        const dirEntry = isDirEntry(entry);
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (i === parts.length - 1 && !dirEntry) {
                let key = part;
                if (node[key] !== undefined) {
                    const full = parts.join('/');
                    let n = dupes.get(full) || 1;
                    const dot = part.lastIndexOf('.');
                    do {
                        n++;
                        key = dot > 0 ? `${part.slice(0, dot)} (${n})${part.slice(dot)}` : `${part} (${n})`;
                    } while (node[key] !== undefined);
                    dupes.set(full, n);
                }
                node[key] = entry;
                fileNodes.add(entry);
            }
            else {
                if (!dirNodes.has(node[part]))
                    node[part] = mkDir();
                node = node[part];
            }
        }
    }
    return { tree, dirNodes, fileNodes };
}
// ---------- MIME guess for extracted files ----------
const MIME_MAP = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
    mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', flac: 'audio/flac',
    ogg: 'audio/ogg', opus: 'audio/opus', aac: 'audio/aac',
    mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo', mkv: 'video/x-matroska',
    webm: 'video/webm', pdf: 'application/pdf', json: 'application/json',
    xml: 'application/xml', html: 'text/html', css: 'text/css', js: 'text/javascript',
    txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', zip: 'application/zip',
};
function guessMime(ext) {
    return MIME_MAP[ext] || 'application/octet-stream';
}
function extOf(name) {
    const m = name.match(/\.([^./\\]+)$/);
    return m ? m[1].toLowerCase() : '';
}
// ---------- safety / metadata helpers ----------
// Decode a DOS date+time pair (as stored in the ZIP central directory) into a
// readable local timestamp. Returns '' when the fields are zero/invalid.
function dosDateTime(modDate, modTime) {
    try {
        if (!modDate)
            return '';
        const day = modDate & 0x1f;
        const month = (modDate >> 5) & 0x0f;
        const year = ((modDate >> 9) & 0x7f) + 1980;
        const sec = (modTime & 0x1f) * 2;
        const min = (modTime >> 5) & 0x3f;
        const hour = (modTime >> 11) & 0x1f;
        if (month < 1 || month > 12 || day < 1 || day > 31)
            return '';
        const d = new Date(year, month - 1, day, hour, min, sec);
        if (isNaN(d.getTime()))
            return '';
        const pad = (n) => String(n).padStart(2, '0');
        return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(min)}:${pad(sec)}`;
    }
    catch {
        return '';
    }
}
// The high byte of "version made by" identifies the host OS that created the entry.
const HOST_OS = {
    0: 'MS-DOS / FAT', 1: 'Amiga', 2: 'OpenVMS', 3: 'Unix', 4: 'VM/CMS', 5: 'Atari ST',
    6: 'OS/2 HPFS', 7: 'Macintosh', 8: 'Z-System', 9: 'CP/M', 10: 'Windows NTFS',
    11: 'MVS', 12: 'VSE', 13: 'Acorn Risc', 14: 'VFAT', 15: 'alternate MVS',
    16: 'BeOS', 17: 'Tandem', 18: 'OS/400', 19: 'OS X (Darwin)',
};
// An entry is encrypted when general-purpose bit 0 of its flags is set.
function isEncrypted(e) {
    return ((e.flags || 0) & 0x0001) !== 0;
}
// ---------- timing & CRC forensics ----------
// DOS date+time -> epoch milliseconds (local), or null when zero/invalid. Parses
// the same fields as dosDateTime() but returns a number for span/histogram maths.
function dosToMs(modDate, modTime) {
    if (!modDate)
        return null;
    const day = modDate & 0x1f;
    const month = (modDate >> 5) & 0x0f;
    const year = ((modDate >> 9) & 0x7f) + 1980;
    const sec = (modTime & 0x1f) * 2;
    const min = (modTime >> 5) & 0x3f;
    const hour = (modTime >> 11) & 0x1f;
    if (month < 1 || month > 12 || day < 1 || day > 31)
        return null;
    const d = new Date(year, month - 1, day, hour, min, sec);
    return isNaN(d.getTime()) ? null : d.getTime();
}
function fmtDuration(ms) {
    if (ms <= 0)
        return '0 seconds';
    const s = ms / 1000;
    if (s < 60)
        return (s < 1 ? Math.round(ms) + ' ms' : Math.round(s) + ' second' + (Math.round(s) === 1 ? '' : 's'));
    const m = s / 60;
    if (m < 60)
        return m.toFixed(m < 10 ? 1 : 0) + ' minutes';
    const h = m / 60;
    if (h < 24)
        return h.toFixed(h < 10 ? 1 : 0) + ' hours';
    const d = h / 24;
    if (d < 365)
        return d.toFixed(d < 10 ? 1 : 0) + ' days';
    return (d / 365).toFixed(1) + ' years';
}
// Standard table-based CRC-32 (the polynomial ZIP uses) for entry verification.
let CRC_TABLE = null;
function crc32(bytes) {
    if (!CRC_TABLE) {
        CRC_TABLE = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++)
                c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            CRC_TABLE[n] = c >>> 0;
        }
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++)
        crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}
// A small bar histogram of entry timestamps across [min, max] (left = earliest).
function buildTimeHistogram(stamps, min, max) {
    const N = 24;
    const span = max - min;
    const buckets = new Array(N).fill(0);
    for (const s of stamps) {
        const idx = span > 0 ? Math.min(N - 1, Math.floor((s - min) / span * N)) : 0;
        buckets[idx]++;
    }
    const peak = Math.max(...buckets, 1);
    const hist = el('div', { class: 'anr-ziphist' });
    buckets.forEach((c, i) => {
        const at = new Date(min + (span > 0 ? span * (i + 0.5) / N : 0));
        hist.appendChild(el('div', {
            class: 'anr-ziphist-bar',
            style: `height:${Math.max(2, Math.round(c / peak * 100))}%`,
            title: `${at.toLocaleString()} - ${c} file${c === 1 ? '' : 's'}`,
        }));
    });
    return el('div', {}, [el('div', { class: 'anr-hint', style: 'margin:10px 0 4px;' }, 'Timestamp distribution (earliest → latest)'), hist]);
}
// Decompress each verifiable entry, recompute its CRC-32, and compare to the
// value stored in the central directory. One entry at a time, each read by its
// own offset and dropped before the next, so peak memory is one entry rather
// than the whole unpacked archive. Entries declared (or found) larger than
// DECOMP_ENTRY_MAX are skipped and counted, never inflated.
async function verifyArchiveCrcs(buf, verifiable) {
    await new Promise((r) => setTimeout(r, 0)); // let the progress bar paint first
    let pass = 0, fail = 0, skipped = 0, tooLarge = 0;
    const mismatches = [];
    let lastYield = performance.now();
    for (const e of verifiable) {
        if (e.compMethod !== 0 && e.uncompSize > DECOMP_ENTRY_MAX) {
            tooLarge++;
            continue;
        }
        let content = null;
        try {
            content = await readZipEntry(buf, e, Math.max(DECOMP_ENTRY_MAX, e.compMethod === 0 ? e.compSize : 0));
        }
        catch (_) {
            content = null;
        }
        if (!content) {
            skipped++;
            continue;
        }
        if (crc32(content) === (e.crc >>> 0))
            pass++;
        else {
            fail++;
            mismatches.push(e.name);
        }
        if (performance.now() - lastYield > 50) {
            await new Promise((r) => setTimeout(r, 0));
            lastYield = performance.now();
        }
    }
    return { pass, fail, skipped, tooLarge, mismatches };
}
// Build the "Timing & integrity" card: timestamp summary + flags + histogram, and
// an on-demand CRC verification control. Returns null when there's nothing to show.
function buildArchiveForensics(buf, fileEntries) {
    const dated = fileEntries.map((e) => dosToMs(e.modDate, e.modTime)).filter((t) => t != null).sort((a, b) => a - b);
    const verifiable = fileEntries.filter((e) => !isEncrypted(e));
    if (!dated.length && !verifiable.length)
        return null;
    const card = el('div', { class: 'anr-card' });
    const [tiHead, tiHelp] = h3help('Timing & integrity', 'The "Verify entry CRCs" button below recomputes each file\'s CRC-32 - a short fingerprint worked out from its contents - and compares it to the value stored in the archive, so you can spot any entry whose data was damaged or changed after the archive was made.');
    card.appendChild(tiHead);
    card.appendChild(tiHelp);
    if (dated.length) {
        const min = dated[0], max = dated[dated.length - 1], span = max - min;
        const fmtT = (ms) => { const d = new Date(ms), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
        const tbl = el('table', { class: 'anr-readout' });
        tbl.appendChild(row('Entries dated', `${dated.length} of ${fileEntries.length}`));
        tbl.appendChild(row('Earliest', fmtT(min)));
        tbl.appendChild(row('Latest', fmtT(max)));
        tbl.appendChild(rowHelp('Time span', fmtDuration(span), 'How far apart the oldest and newest file dates inside the archive are. A span of just seconds across many files suggests they were all packed in one go, rather than added over time.'));
        const uniq = new Set(dated).size;
        const now = Date.now();
        const placeholder = dated.filter((s) => s === new Date(1980, 0, 1, 0, 0, 0).getTime()).length;
        const future = dated.filter((s) => s > now + 86400000).length;
        if (fileEntries.length >= 3 && span <= 2000) {
            tbl.appendChild(rowHelp('⚠ Bulk-added', `all ${dated.length} dated entries within ${fmtDuration(span)}`, 'Every file inside carries almost the same date and time - a sign a program built or repacked the whole archive in one go, rather than files being added one at a time.'));
        }
        else if (uniq === 1 && dated.length > 1) {
            tbl.appendChild(rowHelp('⚠ Identical timestamps', `all ${dated.length} dated entries share one timestamp`, 'Every file inside carries the exact same date and time, which usually means a program created or repacked the archive rather than a person adding files over time.'));
        }
        if (placeholder)
            tbl.appendChild(rowHelp('Placeholder dates', `${placeholder} entr${placeholder === 1 ? 'y' : 'ies'} at 1980-01-01`, 'When a program has no real last-changed date for a file, it often fills in a stand-in date of 1 January 1980 - the earliest date the old DOS and ZIP formats can store.'));
        if (future)
            tbl.appendChild(rowHelp('⚠ Future-dated', `${future} entr${future === 1 ? 'y' : 'ies'} dated after today`, 'A file dated later than today usually means the computer’s clock was set wrong, or the date was deliberately faked.'));
        card.appendChild(tbl);
        card.appendChild(buildTimeHistogram(dated, min, max));
    }
    // On-demand CRC verification. (The explanation lives in the card's [?].)
    const crcWrap = el('div', { style: 'margin-top:14px;' });
    const btn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, `Verify entry CRCs (${verifiable.length} file${verifiable.length === 1 ? '' : 's'})`);
    const out = el('div', { style: 'margin-top:8px;' });
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        out.textContent = '';
        const bar = asciiBar();
        bar.indeterminate();
        out.appendChild(bar);
        try {
            const res = await verifyArchiveCrcs(buf, verifiable);
            bar.stop();
            out.textContent = '';
            const t = el('table', { class: 'anr-readout' });
            t.appendChild(row('Result', `${res.pass} passed, ${res.fail} failed${res.skipped ? `, ${res.skipped} unreadable` : ''}${res.tooLarge ? `, ${res.tooLarge} too large to check here` : ''}`));
            if (res.fail) {
                const sample = res.mismatches.slice(0, 8).join(', ') + (res.mismatches.length > 8 ? `, …(+${res.mismatches.length - 8} more)` : '');
                t.appendChild(rowHelp('⚠ CRC mismatches', sample, 'A CRC-32 is a short check number worked out from a file’s contents, like a fingerprint. Re-checking these files gives a different number from the one saved in the archive, so their data is damaged or was changed after the archive was made.'));
            }
            out.appendChild(t);
        }
        catch (e) {
            bar.stop();
            out.textContent = '';
            out.appendChild(errorCard('CRC verification failed: ' + (e && e.message)));
            btn.disabled = false;
        }
    });
    crcWrap.appendChild(btn);
    crcWrap.appendChild(out);
    card.appendChild(crcWrap);
    return card;
}
// A name is "unsafe" if it would escape the extraction directory: a parent
// traversal segment, an absolute POSIX path, or a Windows drive/UNC path.
function isUnsafePath(name) {
    if (!name)
        return false;
    const n = name.replace(/\\/g, '/');
    if (n.startsWith('/'))
        return true; // absolute POSIX
    if (/^[a-zA-Z]:/.test(n))
        return true; // C:\  drive letter
    if (name.startsWith('\\\\') || name.startsWith('//'))
        return true; // UNC
    const parts = n.split('/');
    return parts.indexOf('..') !== -1; // parent traversal
}
// Per-entry compression ratio (uncompressed ÷ compressed). 0 when not measurable.
function entryRatio(e) {
    if (!e || e.isDir || !e.compSize || !e.uncompSize)
        return 0;
    return e.uncompSize / e.compSize;
}
// ---------- main render ----------
// opts.embedded: true when this view is appended UNDER another analysis (the
// "browse as archive" feature). In that mode the whole-file SHA-256 card is
// skipped, since the primary analysis above already shows the file's hash.
export async function renderArchive(file, resultsEl, opts = {}) {
    const embedded = !!opts.embedded;
    resultsEl.hidden = false;
    resultsEl.innerHTML = '';
    resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading ZIP archive "${file.name}"…`));
    // A ZIP is read whole into an ArrayBuffer here; a multi-GB archive would
    // allocate several copies and crash the tab before any inspection. Above a
    // ceiling, decline rather than attempt the allocation. (In-browser ArrayBuffers
    // are impractical near this size anyway.)
    if (file.size > WALL_INDEX) {
        resultsEl.innerHTML = '';
        resultsEl.appendChild(errorCard('This archive is ' + fmtBytes(file.size) + ' - too large to browse in the browser without exhausting memory. '
            + 'The file was not opened.'));
        return;
    }
    let buf;
    try {
        buf = await file.arrayBuffer();
    }
    catch (e) {
        resultsEl.innerHTML = '';
        if (isUnreadableError(e)) {
            resultsEl.appendChild(cloudFileWarning(file));
        }
        else {
            resultsEl.appendChild(errorCard('Could not read file: ' + (e && e.message)));
        }
        return;
    }
    const entries = parseZipEntries(buf);
    if (entries.length === 0) {
        resultsEl.innerHTML = '';
        resultsEl.appendChild(errorCard('No entries found in this ZIP file, or the archive is corrupt.'));
        return;
    }
    resultsEl.innerHTML = '';
    // --- ZIP summary card ---
    const fileEntries = entries.filter((e) => !e.isDir);
    const dirEntries = entries.filter((e) => e.isDir);
    const totalUncomp = fileEntries.reduce((s, e) => s + e.uncompSize, 0);
    const totalComp = fileEntries.reduce((s, e) => s + e.compSize, 0);
    const ratio = totalUncomp > 0 ? ((1 - totalComp / totalUncomp) * 100).toFixed(1) : '0';
    const infoCard = el('div', { class: 'anr-card' });
    infoCard.appendChild(el('h3', {}, 'ZIP archive'));
    const tbl = el('table', { class: 'anr-readout' });
    tbl.appendChild(row('Application', 'ZIP Archive'));
    tbl.appendChild(row('Name', file.name));
    tbl.appendChild(row('Archive size', `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`));
    tbl.appendChild(row('Files', String(fileEntries.length)));
    tbl.appendChild(row('Directories', String(dirEntries.length)));
    tbl.appendChild(rowHelp('Total uncompressed', fmtBytes(totalUncomp), 'The combined size of all the files once they are unpacked out of the archive.'));
    tbl.appendChild(rowHelp('Total compressed', fmtBytes(totalComp), 'The combined size of all the files as they are actually stored inside the archive, after being squeezed down.'));
    tbl.appendChild(rowHelp('Compression ratio', ratio + '%', 'How much space squeezing the files saved, compared with their full unpacked size - worked out as 1 − compressed ÷ uncompressed. A higher percentage means a smaller archive; 0% means no space was saved.'));
    // Compression methods used across the entries (8 = Deflate, 0 = Stored, etc.).
    const METHODS = { 0: 'Stored', 8: 'Deflate', 9: 'Deflate64', 12: 'BZIP2', 14: 'LZMA', 93: 'Zstandard', 95: 'XZ', 99: 'AES' };
    const methodCounts = {};
    for (const e of fileEntries) {
        const n = METHODS[e.compMethod] || ('Method ' + e.compMethod);
        methodCounts[n] = (methodCounts[n] || 0) + 1;
    }
    const methodStr = Object.entries(methodCounts).map(([k, v]) => k + ' ×' + v).join(', ');
    if (methodStr)
        tbl.appendChild(rowHelp('Compression', methodStr, 'The method used to shrink each file. Deflate is the usual ZIP squeezing method; Stored means the file was kept as-is with no shrinking.'));
    infoCard.appendChild(tbl);
    resultsEl.appendChild(infoCard);
    // --- Category breakdown (Overview + contents-slot + File types) ---
    // Rendered before the integrity/safety/forensics cards. renderViewToggle
    // (below, with treemapFirst) hoists the treemap to the very top of the result
    // so the visual render leads; the file tree stays in the slot this leaves
    // between Overview and File types. All of it sits above the Integrity section.
    const items = normalizeArchive(entries);
    renderBreakdownCards(items, resultsEl);
    // SHA-256 of the whole archive (was previously missing for ZIP). Skipped when
    // embedded under another analysis that already shows the file hash.
    if (!embedded)
        resultsEl.appendChild(integrityCard(file));
    // --- Safety / integrity inspection (additive; only shown when noteworthy) ---
    try {
        const encrypted = fileEntries.filter(isEncrypted);
        const unsafe = entries.filter((e) => isUnsafePath(e.name));
        const overallRatio = totalComp > 0 ? totalUncomp / totalComp : 0;
        const worstEntry = fileEntries.reduce((w, e) => {
            const r = entryRatio(e);
            return r > (w ? entryRatio(w) : 0) ? e : w;
        }, null);
        const worstRatio = worstEntry ? entryRatio(worstEntry) : 0;
        const zip64 = entries.some((e) => e.zip64);
        const ratioSuspicious = overallRatio > 100 || worstRatio > 1000;
        const hasFindings = encrypted.length > 0 || unsafe.length > 0 || ratioSuspicious || zip64;
        if (hasFindings) {
            const safeCard = el('div', { class: 'anr-card' });
            safeCard.appendChild(el('h3', {}, 'Safety'));
            const stbl = el('table', { class: 'anr-readout' });
            if (encrypted.length > 0) {
                const allEnc = encrypted.length === fileEntries.length;
                const note = allEnc
                    ? ' - every file is encrypted, so contents cannot be previewed or extracted here.'
                    : '';
                stbl.appendChild(rowHelp('Encrypted entries', `${encrypted.length} of ${fileEntries.length}${note}`, 'Files locked with a password (marked by the ZIP general-purpose flag bit 0). Analyser can list them but cannot unpack or preview their contents without the password.'));
            }
            if (unsafe.length > 0) {
                const sample = unsafe.slice(0, 5).map((e) => e.name).join(', ');
                const more = unsafe.length > 5 ? `, …(+${unsafe.length - 5} more)` : '';
                stbl.appendChild(rowHelp('⚠ Unsafe paths', `${unsafe.length} (path traversal) - ${sample}${more}`, 'The names of files inside point outside the archive - they contain "../", start with "/", or name a drive letter or network (UNC) path. Unpacked by a careless program, these could be written outside the folder you chose and overwrite other files (a trick called "Zip Slip"). Analyser never writes them to disk.'));
            }
            if (ratioSuspicious) {
                const detail = worstRatio > 1000 && worstEntry
                    ? `overall ${overallRatio.toFixed(0)}:1; one entry "${worstEntry.name}" expands ${worstRatio.toFixed(0)}:1`
                    : `overall ${overallRatio.toFixed(0)}:1`;
                stbl.appendChild(rowHelp('⚠ Suspicious compression ratio', detail, 'These files unpack to a huge size from very little stored data. That can be a "zip bomb" - a tiny archive deliberately built to balloon into something enormous and swamp your memory or disk. Treat an unfamiliar archive like this with caution.'));
            }
            if (zip64) {
                stbl.appendChild(rowHelp('ZIP64', 'Yes (large-archive extensions present)', 'This archive uses ZIP64, an extension that lets a ZIP hold more than the classic limits of 4 GB or 65,535 files. It is normal for very large archives.'));
            }
            // Host OS / creating tool, from the first non-trivial "version made by".
            const vmb = (fileEntries[0] || entries[0] || {}).versionMadeBy;
            if (vmb != null) {
                const hostName = HOST_OS[(vmb >> 8) & 0xff] || ('host ' + ((vmb >> 8) & 0xff));
                const ver = (vmb & 0xff) / 10;
                stbl.appendChild(rowHelp('Created on', `${hostName} (ZIP spec ${ver.toFixed(1)})`, 'The operating system and ZIP format version that the program which built this archive recorded inside it (labelled "version made by" in the archive’s index).'));
            }
            safeCard.appendChild(stbl);
            resultsEl.appendChild(safeCard);
        }
    }
    catch (e) {
        // Safety inspection is best-effort; never break ZIP browsing over it.
        if (window.console)
            console.warn('ZIP safety inspection failed:', e);
    }
    // --- Timing & CRC forensics ---
    try {
        const fcard = buildArchiveForensics(buf, fileEntries);
        if (fcard)
            resultsEl.appendChild(fcard);
    }
    catch (e) {
        if (window.console)
            console.warn('ZIP forensics failed:', e);
    }
    // --- Extract a file from the archive (for click-to-analyse) ---
    // A user-chosen entry may be large, so it gets the general output ceiling (or
    // its own stored size, for an entry kept uncompressed); a bomb still stops at
    // DECOMP_OUTPUT_MAX.
    async function extractFile(entry) {
        const cap = Math.max(DECOMP_OUTPUT_MAX, entry.compMethod === 0 ? entry.compSize : 0);
        const content = await readZipEntry(buf, entry, cap);
        if (!content) {
            if (!isEncrypted(entry) && entry.uncompSize > cap) {
                resultsEl.insertBefore(errorCard(`"${entry.name}" unpacks to ${fmtBytes(entry.uncompSize)}, past the ${fmtBytes(cap)} the browser can safely unpack. It was not opened.`), resultsEl.firstChild);
            }
            return null;
        }
        const ext = extOf(entry.name);
        const fileName = entry.name.split('/').pop() || entry.name;
        return new File([content], fileName, { type: guessMime(ext) });
    }
    // Batch-extract a set of entries into [{ path, file }] for the EDA project
    // views. Automatic, so each entry is held to DECOMP_ENTRY_MAX.
    async function extractFiles(list) {
        const out = [];
        for (const e of list) {
            const content = await readZipEntry(buf, e, DECOMP_ENTRY_MAX);
            if (content)
                out.push({ path: e.name, file: new File([content], e.name.split('/').pop() || e.name, { type: 'application/octet-stream' }) });
        }
        return out;
    }
    // --- EDA project detection: if the archive holds an Altium or KiCad project,
    // stitch its documents into one combined cross-probing view at the top, exactly
    // as a dropped project FOLDER does (folder.js). The renderer module is loaded
    // lazily, only when a project is actually present. ---
    if (!embedded)
        detectEdaProject();
    function detectEdaProject() {
        const ALT_RE = /\.(prjpcb|prjpcbstructure|schdoc|schlib|pcbdoc|pcblib|epw|schdocpreview|pcbdocpreview)$/i;
        const ALT_DOC_RE = /\.(schdoc|schlib|pcbdoc|pcblib|prjpcb)$/i;
        const KI_RE = /(\.kicad_(pcb|sch|sym|mod|pro|prl)$|\.wbk$|(^|\/)(fp-lib-table|sym-lib-table|fp-info-cache)$)/i;
        const KI_DOC_RE = /\.kicad_(pcb|sch|pro)$/i;
        const altEntries = fileEntries.filter((e) => ALT_RE.test(e.name));
        const kiEntries = fileEntries.filter((e) => KI_RE.test(e.name));
        const folderLabel = (file.name || 'archive').replace(/\.[^.]+$/, '');
        if (altEntries.some((e) => ALT_DOC_RE.test(e.name)) && altEntries.length >= 2)
            loadProjectView('./altium.js', 'buildAltiumProjectCard', altEntries, folderLabel, 'Altium');
        if (kiEntries.some((e) => KI_DOC_RE.test(e.name)) && kiEntries.length >= 2)
            loadProjectView('./kicad.js', 'buildKicadProjectCard', kiEntries, folderLabel, 'KiCad');
    }
    function loadProjectView(mod, fn, list, label, kind) {
        const slot = el('div', { class: 'anr-card' }, el('div', { class: 'anr-info' }, `Building combined ${kind} project view…`));
        resultsEl.insertBefore(slot, resultsEl.firstChild);
        Promise.all([import(mod), extractFiles(list)])
            .then(([m, fileList]) => m[fn](fileList, label))
            .then((cardEl) => { slot.replaceWith(cardEl); })
            .catch(() => { slot.remove(); });
    }
    // Register a Back-bar restore that re-renders THIS archive before opening a
    // child, so the breadcrumb can step back to it one level at a time. Skipped in
    // embedded mode (the browse-as-archive view under a primary analysis), whose
    // sub-container is wiped by clearResultsUI - there's no standalone view to
    // restore there.
    const containerLabel = (file && file.name) || 'archive';
    function pushBack() {
        if ((opts && opts.embedded) || !window._anrPushNav)
            return;
        window._anrPushNav(containerLabel, () => { resultsEl.hidden = false; renderArchive(file, resultsEl); });
    }
    // --- Click-to-analyse (treemap + tree) ---
    // Only a real PK container is re-rendered here (renderArchive reads ZIP
    // only); a nested .rar/.7z/.tar/.gz goes through the main pipeline, whose
    // resolveKind routes it to the right viewer.
    function openEntry(entry) {
        if (!entry)
            return;
        const ext = extOf(entry.name);
        extractFile(entry).then(async (f) => {
            if (!f)
                return;
            pushBack();
            if (ARCHIVE_EXTS.has(ext) && await isZipBlob(f))
                renderArchive(f, resultsEl);
            else if (window._anrHandleFile)
                window._anrHandleFile(f, { nested: true });
        });
    }
    function onFileClick(item) {
        if (item && item.entry)
            openEntry(item.entry);
    }
    function onTreeFileClick(_key, val) {
        if (val && fileNodes.has(val))
            openEntry(val);
    }
    const { tree, dirNodes, fileNodes } = buildEntryTree(entries, (e) => !!e.isDir);
    renderViewToggle(resultsEl, items, tree, {
        isDir: (v) => dirNodes.has(v),
        fileSize: (v) => (v && v.uncompSize) || 0,
        copyPath: (_key, entry) => entry && entry.name,
        onFileClick: onTreeFileClick
    }, onFileClick, { treemapFirst: true });
    // --- Text file previews ---
    const textExts = new Set(['txt', 'md', 'json', 'xml', 'csv', 'tsv', 'html', 'htm',
        'css', 'js', 'ts', 'py', 'rb', 'java', 'c', 'h', 'cpp', 'rs', 'go',
        'yaml', 'yml', 'toml', 'ini', 'cfg', 'log', 'sh', 'bat', 'sql', 'svg']);
    const previewable = fileEntries.filter((e) => {
        if (e.uncompSize > 10240)
            return false;
        const ext = (e.name.match(/\.([^.]+)$/) || [])[1];
        return ext && textExts.has(ext.toLowerCase());
    });
    if (previewable.length > 0) {
        // Collapsed by default (.is-collapsed): the previews are a secondary detail
        // behind the file tree, so they start closed. .anr-collapsible opts this card
        // into the shared card-toggle in app.js (which is otherwise disabled), so its
        // "Text file previews" title opens and re-closes it.
        const prevCard = el('div', { class: 'anr-card is-collapsed anr-collapsible' });
        prevCard.appendChild(el('h3', {}, 'Text file previews'));
        prevCard.appendChild(el('p', {
            class: 'anr-hint',
            style: 'margin: 0 0 8px; font-size: 12px;'
        }, `${previewable.length} small text file(s) can be previewed.`));
        for (const entry of previewable.slice(0, 20)) {
            const details = el('details', {});
            let summaryMeta = '';
            try {
                const r = entryRatio(entry);
                const mt = dosDateTime(entry.modDate, entry.modTime);
                if (r > 1)
                    summaryMeta += ' · ' + r.toFixed(1) + ':1';
                if (mt)
                    summaryMeta += ' · ' + mt;
            }
            catch { /* metadata is optional */ }
            const summary = el('summary', {
                // overflow-wrap/word-break so long entry paths and the metadata tail wrap
                // instead of overflowing the card on narrow (mobile) viewports.
                style: 'cursor: pointer; font-weight: bold; margin: 4px 0; font-size: 13px;' +
                    ' overflow-wrap: anywhere; word-break: break-word;'
            }, entry.name + '  (' + fmtBytes(entry.uncompSize) + ' · CRC ' + (entry.crc >>> 0).toString(16).padStart(8, '0') + summaryMeta + ')');
            details.appendChild(summary);
            const pre = el('pre', { class: 'anr-ocr-text' }, '');
            pre.style.maxHeight = '300px';
            pre.style.overflow = 'auto';
            details.appendChild(pre);
            let loaded = false;
            details.addEventListener('toggle', async () => {
                if (!details.open || loaded)
                    return;
                loaded = true;
                pre.textContent = 'Decompressing…';
                try {
                    // Declared small (filtered above), but the header can lie - the read
                    // still stops at DECOMP_ENTRY_MAX.
                    const content = await readZipEntry(buf, entry, DECOMP_ENTRY_MAX);
                    if (content) {
                        pre.textContent = new TextDecoder().decode(content);
                    }
                    else {
                        pre.textContent = '(could not extract)';
                    }
                }
                catch (e) {
                    pre.textContent = 'Extraction error: ' + (e && e.message);
                }
            });
            prevCard.appendChild(details);
        }
        resultsEl.appendChild(prevCard);
    }
}
// ---------- libarchive-backed browse (RAR / 7z / etc.) ----------
// renderArchive handles ZIP in pure JS; non-ZIP containers are listed and
// extracted lazily through the vendored libarchive WASM worker. Same tree +
// treemap + click-to-analyse UX as the ZIP path, fed from the entry list.
function extLower(name) {
    const m = name.match(/\.([^./\\]+)$/);
    return m ? m[1].toLowerCase() : '';
}
async function renderLibarchive(file, resultsEl, opts) {
    const label = (opts && opts.label) || 'Archive';
    resultsEl.hidden = false;
    resultsEl.innerHTML = '';
    resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading ${label} archive "${file.name}"…`));
    let handle;
    try {
        handle = await extractArchive(file);
    }
    catch (e) {
        resultsEl.innerHTML = '';
        if (isUnreadableError(e))
            resultsEl.appendChild(cloudFileWarning(file));
        else
            resultsEl.appendChild(errorCard('Could not read this archive in the browser - it may be encrypted, solid, or use an unsupported codec.'));
        return;
    }
    const fileEntries = (handle.entries || []).filter((e) => e && e.name && !e.name.endsWith('/'));
    resultsEl.innerHTML = '';
    if (!fileEntries.length) {
        handle.close(); // nothing to extract - release its worker
        resultsEl.appendChild(errorCard('No files found inside this archive.'));
        return;
    }
    renderHandleTree(handle, fileEntries, file, resultsEl, opts);
}
// Render an already-opened libarchive handle as the tree + treemap + breakdown,
// with click-to-analyse. Shared by renderLibarchive and the compressed-tarball
// path so neither has to re-open the archive. Also reused by the disk-image
// browser (diskimage.js), which passes its own entry list + opts.summaryRows.
export function renderHandleTree(handle, fileEntries, file, resultsEl, opts) {
    const label = (opts && opts.label) || 'Archive';
    const items = fileEntries.map((e) => {
        const ext = extLower(e.name);
        return { path: e.name, size: e.size || 0, file: null, entry: e, category: categorizeExt(ext), ext };
    });
    // Callers (e.g. the disk-image browser) can supply their own Overview rows.
    const summaryRows = (opts && opts.summaryRows) || [
        row('Application', label + ' Archive'),
        row('Name', file.name),
        row('Archive size', `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`),
    ];
    renderBreakdownCards(items, resultsEl, summaryRows);
    // Build the nested tree object (leaf = the libarchive entry, branch = a
    // prototype-free node tracked in dirNodes).
    const { tree, dirNodes, fileNodes } = buildEntryTree(fileEntries, () => false);
    async function openEntry(entry) {
        try {
            const bytes = await entry.getBytes();
            const f = new File([bytes], entry.name.split('/').pop() || entry.name, { type: 'application/octet-stream' });
            // Register a Back-bar restore that re-renders this archive (one level up).
            if (window._anrPushNav) {
                window._anrPushNav(file.name || 'archive', () => { resultsEl.hidden = false; resultsEl.innerHTML = ''; renderHandleTree(handle, fileEntries, file, resultsEl, opts); });
            }
            if (window._anrHandleFile)
                window._anrHandleFile(f, { nested: true });
        }
        catch (_) { /* extraction failed - ignore */ }
    }
    const onFileClick = (item) => { if (item && item.entry)
        openEntry(item.entry); };
    const onTreeFileClick = (_key, val) => { if (val && fileNodes.has(val))
        openEntry(val); };
    renderViewToggle(resultsEl, items, tree, {
        isDir: (v) => dirNodes.has(v),
        fileSize: (v) => (v && v.size) || 0,
        copyPath: (_key, entry) => entry && entry.name,
        onFileClick: onTreeFileClick,
    }, onFileClick, { treemapFirst: true });
}
// ---------- ar / static & import library (.a / .lib) ----------
// A Unix ar archive and a Microsoft COFF library (.lib) are the same !<arch>
// container. The vendored libarchive build may not include the ar reader, and the
// layout is trivial, so we walk the members ourselves and hand renderHandleTree a
// libarchive-shaped handle (flat entries + lazy getBytes) to reuse its tree,
// treemap and click-to-analyse UI. Members are COFF .obj objects (and, in an
// import library, short-import stubs), so opening one lands on identification.
async function extractAr(file) {
    if (file.size > WALL_INDEX)
        throw new Error('This library is ' + fmtBytes(file.size) + ' - too large to browse in the browser.');
    const b = new Uint8Array(await file.arrayBuffer());
    const MAGIC = [0x21, 0x3c, 0x61, 0x72, 0x63, 0x68, 0x3e, 0x0a]; // !<arch>\n
    if (b.length < 8 || MAGIC.some((c, i) => b[i] !== c))
        throw new Error('Not an ar archive');
    const dec = new TextDecoder('latin1');
    const field = (o, n) => dec.decode(b.subarray(o, o + n));
    const raw = [];
    let pos = 8;
    while (pos + 60 <= b.length) {
        if (b[pos + 58] !== 0x60 || b[pos + 59] !== 0x0a)
            break; // member header ends with "`\n"
        // Decimal digits only: a negative size would move the cursor backwards and
        // re-read the same header forever. A size past the end is clamped.
        const sizeStr = field(pos + 48, 10).trim();
        if (!/^\d*$/.test(sizeStr))
            break;
        const size = Math.min(parseInt(sizeStr, 10) || 0, b.length - (pos + 60));
        if (raw.length >= LIST_ENTRIES_MAX)
            break;
        raw.push({ name16: field(pos, 16), size, dataStart: pos + 60 });
        pos = pos + 60 + size + (size & 1); // members are 2-byte aligned
    }
    // GNU/MS long-name string table (member named "//"); names point in as "/<off>".
    let longnames = null;
    for (const r of raw) {
        if (r.name16.replace(/ +$/, '') === '//') {
            longnames = b.subarray(r.dataStart, r.dataStart + r.size);
            break;
        }
    }
    const resolveName = (name16) => {
        const lref = name16.match(/^\/(\d+)/);
        if (lref && longnames) {
            const off = parseInt(lref[1], 10);
            let end = off;
            while (end < longnames.length && longnames[end] !== 0x0a && longnames[end] !== 0x00)
                end++;
            return dec.decode(longnames.subarray(off, end)).replace(/\/$/, '');
        }
        let n = name16.replace(/ +$/, '');
        if (n.endsWith('/'))
            n = n.slice(0, -1); // GNU trailing-slash terminator
        return n;
    };
    // Drop the linker bookkeeping members (symbol tables named "/", long-name table
    // "//") and give same-named members - every import stub carries the DLL name -
    // a unique label so they all appear in the tree.
    const used = new Map();
    const uniq = (name) => {
        const seen = used.get(name) || 0;
        used.set(name, seen + 1);
        if (!seen)
            return name;
        const dot = name.lastIndexOf('.');
        return dot > 0 ? `${name.slice(0, dot)} (${seen + 1})${name.slice(dot)}` : `${name} (${seen + 1})`;
    };
    const entries = raw
        .map((r, i) => ({ r, name: resolveName(r.name16), i }))
        .filter(({ name }) => name !== '' && name !== '/')
        .map(({ r, name, i }) => ({
        name: uniq(name || ('member-' + i)),
        size: r.size,
        getBytes: async () => b.subarray(r.dataStart, r.dataStart + r.size),
    }));
    return { names: entries.map((e) => e.name), entries, close() { } };
}
async function renderArEmbedded(file, resultsEl, opts) {
    const label = (opts && opts.label) || 'Library';
    resultsEl.hidden = false;
    resultsEl.innerHTML = '';
    resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading ${label} "${file.name}"…`));
    let handle;
    try {
        handle = await extractAr(file);
    }
    catch (e) {
        resultsEl.innerHTML = '';
        if (isUnreadableError(e))
            resultsEl.appendChild(cloudFileWarning(file));
        else
            resultsEl.appendChild(errorCard('Could not read this library in the browser.'));
        return;
    }
    const fileEntries = (handle.entries || []).filter((e) => e && e.name);
    resultsEl.innerHTML = '';
    if (!fileEntries.length) {
        resultsEl.appendChild(errorCard('No members found inside this library.'));
        return;
    }
    renderHandleTree(handle, fileEntries, file, resultsEl, opts);
}
// Decompress a single-stream compressor (gzip / xz / zstd) by magic. Returns
// { data, codec, drop } where `drop` strips the compression extension from the
// inner filename, or null if the codec has no in-browser decoder (bzip2) or the
// magic is unknown. The tar/tarball case never reaches here - libarchive handles
// it directly (it bundles the gzip/xz/zstd/bzip2 read filters).
//
// Every codec's output is capped at DECOMP_OUTPUT_MAX (a small bomb returns
// null, not a crashed tab), and the input itself must fit WALL_INDEX before it
// is read into memory.
async function decompressStream(file) {
    if (file.size > WALL_INDEX)
        return null;
    const head = new Uint8Array(await file.slice(0, 13).arrayBuffer());
    const is = (sig) => sig.every((v, i) => head[i] === v);
    // gzip streams straight off the Blob - no whole-file copy first.
    if (is([0x1F, 0x8B]))
        return { data: await gunzip(file, DECOMP_OUTPUT_MAX), codec: 'gzip', drop: /\.(gz|tgz)$/i };
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (is([0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00]))
        return { data: await xzDecompress(bytes), codec: 'xz', drop: /\.(xz|txz)$/i };
    if (is([0x28, 0xB5, 0x2F, 0xFD])) {
        if (!(window.fzstd && window.fzstd.Decompress))
            await loadScript('assets/vendor/fzstd.js');
        if (!(window.fzstd && window.fzstd.Decompress))
            return null;
        return { data: await inflateZipData(bytes, 93, DECOMP_OUTPUT_MAX), codec: 'zstd', drop: /\.(zst|tzst)$/i };
    }
    if (is([0x04, 0x22, 0x4D, 0x18])) {
        const d = unlz4(bytes);
        return d ? { data: d, codec: 'LZ4', drop: /\.(lz4|tlz4)$/i } : null;
    }
    if (is([0x1F, 0x9D])) {
        const d = unlzw(bytes);
        return d ? { data: d, codec: 'LZW', drop: /\.(z|tz)$/i } : null;
    }
    // Legacy .lzma has no fixed magic; the default properties byte 0x5D plus the
    // 13-byte header is the reliable tell (matches the sniff in app.js).
    if (head[0] === 0x5D && bytes.length >= 13) {
        const d = await lzmaDecompress(bytes);
        if (d)
            return { data: d, codec: 'LZMA', drop: /\.(lzma|tlz)$/i };
    }
    return null; // bzip2 (no in-browser decoder) or unknown
}
// Browse/open a TAR or compressed stream: libarchive reads tar + tarballs
// (.tar.gz/.tgz/.tar.xz/.tar.zst/.tar.bz2) directly; a bare single compressed
// file is decompressed so the file inside can be analysed.
async function renderCompressedEmbedded(file, container, label) {
    const wrap = el('div', {});
    container.appendChild(wrap);
    wrap.appendChild(el('div', { class: 'anr-info' }, `Reading ${label} contents…`));
    let handle = null;
    try {
        handle = await extractArchive(file);
    }
    catch (_) { /* not a libarchive-readable archive */ }
    const fileEntries = handle ? (handle.entries || []).filter((e) => e && e.name && !e.name.endsWith('/')) : [];
    if (fileEntries.length) {
        wrap.remove();
        renderHandleTree(handle, fileEntries, file, container, { label });
        return;
    }
    if (handle)
        handle.close(); // unused - release its worker
    // Single compressed stream: decompress and offer the file inside.
    let res = null;
    try {
        res = await decompressStream(file);
    }
    catch (_) { /* decompression failed */ }
    wrap.remove();
    if (!res || !res.data) {
        container.appendChild(el('p', { class: 'anr-hint', style: 'margin:0;font-size:12px;' }, /bzip2|bz2/i.test(label)
            ? 'Single bzip2-compressed file. In-browser bzip2 decompression is not available, so only the identification above is shown.'
            : (file.size > WALL_INDEX
                ? 'This compressed file is ' + fmtBytes(file.size) + ' - too large to decompress in the browser.'
                : 'This compressed file could not be decompressed in the browser, or it unpacks to more than ' + fmtBytes(DECOMP_OUTPUT_MAX) + '.')));
        return;
    }
    const innerName = (file.name || 'file').replace(res.drop, '') || 'decompressed';
    const inner = new File([res.data], innerName, { type: 'application/octet-stream' });
    const card = el('div', { class: 'anr-card' });
    card.appendChild(el('h3', {}, 'Decompressed file'));
    card.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 8px;font-size:12px;' }, `A single ${res.codec}-compressed file (${fmtBytes(res.data.length)} decompressed).`));
    const btn = el('button', { type: 'button', class: 'anr-btn' }, 'Analyse ' + innerName);
    btn.addEventListener('click', () => {
        if (window._anrPushNav)
            window._anrPushNav(file.name || 'archive', () => { if (window._anrHandleFile)
                window._anrHandleFile(file, {}); });
        if (window._anrHandleFile)
            window._anrHandleFile(inner, { nested: true });
    });
    card.appendChild(btn);
    container.appendChild(card);
}
// ---------- embeddable "browse as archive" view ----------
// Appended UNDER a file's primary analysis when that file is physically a
// container we can open. `opts.mode` is 'zip' (pure-JS path), 'libarchive'
// (RAR/7z/etc.), or 'compressed' (TAR + gz/xz/zst/bz2 tarballs and single
// streams); `opts.label` names the format.
export async function renderArchiveEmbedded(file, container, opts = {}) {
    const compressed = opts.mode === 'compressed';
    const label = opts.label || (opts.mode === 'zip' ? 'ZIP' : 'archive');
    const head = el('div', { class: 'anr-card' });
    head.appendChild(el('h3', {}, compressed ? 'Open contents' : 'Browse as archive'));
    head.appendChild(el('p', { class: 'anr-hint', style: 'margin:0;font-size:12px;' }, compressed
        ? `Decompressed in your browser so you can open the file inside.`
        : `This file is also a ${label} archive - browse the files inside.`));
    container.appendChild(head);
    const wrap = el('div', {});
    container.appendChild(wrap);
    try {
        if (opts.mode === 'zip')
            await renderArchive(file, wrap, { embedded: true });
        else if (compressed) {
            wrap.remove();
            await renderCompressedEmbedded(file, container, label);
        }
        else if (opts.mode === 'ar')
            await renderArEmbedded(file, wrap, { label });
        else
            await renderLibarchive(file, wrap, { label });
    }
    catch (e) {
        wrap.appendChild(errorCard('Could not browse this archive: ' + (e && e.message)));
    }
}
//# sourceMappingURL=archive.js.map