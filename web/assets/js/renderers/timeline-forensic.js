/* Analyser - forensic timestamp timeline
   A shared, all-file-types card that gathers every timestamp a file carries -
   the filesystem "last modified" the browser reports, plus whatever the container
   itself records - lays them out in chronological order, and flags relationships
   that cannot be true (a file modified before it was created, a document that
   predates its own filesystem save, a date in the future).

   It reads only what it can cheaply reach with ranged reads, so it stays fast on
   large videos and never pulls a whole file into memory just for a date:
     - filesystem last-modified (File.lastModified)
     - Office Open XML / OpenDocument document dates (docProps/core.xml,
       meta.xml) - the human-set created/modified stamps inside DOCX/XLSX/PPTX/ODT
     - MP4 / QuickTime movie header (mvhd) creation + modification times
     - PNG tIME chunk (the "last modification" the encoder wrote)

   Images and PDFs already carry their own EXIF/XMP anomaly cards inside their
   renderers, built from richer capture dates; this generic card complements them
   (it adds the filesystem correlation) rather than replacing them. It stays hidden
   unless there are at least two independent timestamps or something is provably
   inconsistent, so it adds no noise to a file that has nothing to say. */
import { el, row, wireInfoToggle, fmtDate, timeAnomalies } from '../core/util.js';
import { ascii } from '../core/binutil.js';
const MAC_EPOCH = 2082844800; // seconds between 1904-01-01 and 1970-01-01 (UTC)
const okDate = (d) => d instanceof Date && !isNaN(d.getTime()) && d.getTime() > 0;
// ---------- MP4 / QuickTime movie header ----------
async function readBoxHeader(file, pos) {
    const hdr = new Uint8Array(await file.slice(pos, pos + 16).arrayBuffer());
    if (hdr.length < 8)
        return null;
    const dv = new DataView(hdr.buffer);
    let size = dv.getUint32(0);
    let headerSize = 8;
    if (size === 1) { // 64-bit largesize
        size = dv.getUint32(8) * 4294967296 + dv.getUint32(12);
        headerSize = 16;
    }
    return { size, type: ascii(hdr, 4, 4), headerSize, pos };
}
function mvhdFromMoov(moov) {
    const dv = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
    const toDate = (s) => (s > MAC_EPOCH ? new Date((s - MAC_EPOCH) * 1000) : null);
    let p = 0;
    while (p + 8 <= moov.length) {
        let size = dv.getUint32(p);
        let hs = 8;
        if (size === 1) {
            size = dv.getUint32(p + 8) * 4294967296 + dv.getUint32(p + 12);
            hs = 16;
        }
        if (size < 8)
            break;
        if (ascii(moov, p + 4, 4) === 'mvhd') {
            const version = moov[p + hs];
            const u64 = (o) => dv.getUint32(o) * 4294967296 + dv.getUint32(o + 4);
            let c, m;
            if (version === 1) {
                c = u64(p + hs + 4);
                m = u64(p + hs + 12);
            }
            else {
                c = dv.getUint32(p + hs + 4);
                m = dv.getUint32(p + hs + 8);
            }
            return { created: toDate(c), modified: toDate(m) };
        }
        p += size;
    }
    return null;
}
async function mp4Dates(file) {
    let pos = 0, guard = 0;
    while (pos < file.size && guard++ < 200) {
        const box = await readBoxHeader(file, pos);
        if (!box || box.size < 8)
            break;
        if (box.type === 'moov') {
            const start = box.pos + box.headerSize;
            const len = Math.min(box.size - box.headerSize, 1 << 16);
            const moov = new Uint8Array(await file.slice(start, start + len).arrayBuffer());
            return mvhdFromMoov(moov);
        }
        pos += box.size;
    }
    return null;
}
// ---------- PNG tIME ----------
async function pngTime(file) {
    const b = new Uint8Array(await file.slice(0, Math.min(file.size, 1 << 20)).arrayBuffer());
    if (b[0] !== 0x89 || b[1] !== 0x50)
        return null;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let i = 8;
    while (i + 12 <= b.length) {
        const len = (b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]) >>> 0;
        const type = ascii(b, i + 4, 4);
        const ds = i + 8;
        if (type === 'tIME' && len >= 7 && ds + 7 <= b.length) {
            const d = new Date(Date.UTC(dv.getUint16(ds), b[ds + 2] - 1, b[ds + 3], b[ds + 4], b[ds + 5], b[ds + 6]));
            return isNaN(d.getTime()) ? null : d;
        }
        if (type === 'IEND')
            break;
        i = ds + len + 4; // + 4-byte CRC
    }
    return null;
}
// ---------- ZIP-based documents (OOXML / ODF) ----------
function pickTag(xml, tag) {
    const m = xml.match(new RegExp('<' + tag + '[^>]*>([^<]+)</' + tag + '>', 'i'));
    if (!m)
        return null;
    const d = new Date(m[1].trim());
    return isNaN(d.getTime()) ? null : d;
}
async function zipDocDates(file) {
    const { openZip } = await import('./zip.js');
    const zip = await openZip(file);
    const out = {};
    if (zip.has('docProps/core.xml')) {
        const xml = await zip.text('docProps/core.xml');
        if (xml) {
            out.created = pickTag(xml, 'dcterms:created') || pickTag(xml, 'created');
            out.modified = pickTag(xml, 'dcterms:modified') || pickTag(xml, 'modified');
        }
    }
    else if (zip.has('meta.xml')) {
        const xml = await zip.text('meta.xml');
        if (xml) {
            out.created = pickTag(xml, 'meta:creation-date');
            out.modified = pickTag(xml, 'dc:date');
        }
    }
    return out;
}
// ---------- gather every timestamp ----------
export async function collectTimestamps(file) {
    // stamps: what we list. probe: the named dates fed to the anomaly detector.
    const stamps = [];
    const probe = {};
    const add = (label, d, key) => {
        if (!okDate(d))
            return;
        stamps.push({ label, date: d });
        if (key)
            probe[key] = d;
    };
    if (file.lastModified)
        add('Filesystem last-modified', new Date(file.lastModified), 'filesystem');
    let head;
    try {
        head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    }
    catch (_) {
        head = new Uint8Array(0);
    }
    try {
        if (head[0] === 0x89 && head[1] === 0x50) {
            add('PNG tIME (last modification)', await pngTime(file), 'modified');
        }
        else if (ascii(head, 4, 4) === 'ftyp') {
            const m = await mp4Dates(file);
            if (m) {
                add('Movie header created (mvhd)', m.created, 'created');
                add('Movie header modified (mvhd)', m.modified, 'modified');
            }
        }
        else if (head[0] === 0x50 && head[1] === 0x4B) {
            const z = await zipDocDates(file);
            add('Document created (metadata)', z.created, 'created');
            add('Document modified (metadata)', z.modified, 'modified');
        }
    }
    catch (_) { /* a missing/damaged container just yields fewer stamps */ }
    return { stamps, probe };
}
// ---------- card ----------
const TL_HELP = 'A file can carry several dates: the "last modified" time your computer reports, and the dates the file records inside itself (a document’s created and modified dates, a video’s movie-header times, a PNG’s tIME). This card lists them in order and flags combinations that should be impossible - a file modified before it was created, or a document dated earlier than its own last save - which can point to a date that was faked or edited by hand. Every date is read on your device.';
export async function forensicTimelineCard(file) {
    let stamps, probe;
    try {
        ({ stamps, probe } = await collectTimestamps(file));
    }
    catch (_) {
        return null;
    }
    const anomalies = timeAnomalies(probe);
    if (stamps.length < 2 && !anomalies.length)
        return null;
    const card = el('div', { class: 'anr-card' });
    const head = el('div', { style: 'display:flex; align-items:center; gap:6px;' });
    head.appendChild(el('h3', { style: 'margin:0;' }, 'Timestamp timeline'));
    const infoBtn = el('button', { type: 'button', class: 'anr-info-btn', title: 'Info' }, '[?]');
    const help = el('div', { class: 'anr-info-panel is-hidden', html: TL_HELP });
    wireInfoToggle(infoBtn, help);
    head.appendChild(infoBtn);
    card.appendChild(head);
    card.appendChild(help);
    const sorted = [...stamps].sort((a, b) => +a.date - +b.date);
    const tbl = el('table', { class: 'anr-readout' });
    for (const s of sorted)
        tbl.appendChild(row(s.label, fmtDate(s.date)));
    card.appendChild(tbl);
    if (anomalies.length) {
        card.appendChild(el('div', { class: 'anr-readout-section' }, 'Inconsistencies'));
        for (const a of anomalies) {
            card.appendChild(el('p', { class: 'anr-hint', style: 'color:var(--accent); font-weight:600; margin:4px 0;' }, a));
        }
    }
    return card;
}
//# sourceMappingURL=timeline-forensic.js.map