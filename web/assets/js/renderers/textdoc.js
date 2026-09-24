/* Analyser - text & lightweight-markup document viewer
   ============================================================================
   A family of formats whose content is really just text or simple XML/HTML:
     - markup source (DITA, TEI, JATS, reStructuredText, AsciiDoc, Org, Textile,
       TeX/LaTeX, BibTeX) - shown as selectable source on page sheets;
     - RTF                - control words stripped to readable prose;
     - AbiWord (.abw)     - XML word processor, paragraph text;
     - FictionBook (.fb2) - XML ebook, titles + paragraphs;
     - HWPX               - Hangul Office (zip of XML), paragraph text;
     - MHTML (.mht)       - MIME web archive, the HTML part rendered (sanitised).

   Everything funnels into the shared page-preview + per-page selectable text
   cards in paged.js, so these read like the other document viewers. Every
   extractor is guarded so a malformed file degrades to a message.
   ============================================================================ */
import { el, buildReadout, fmtBytes, rowHelp, integrityCard, errorCard } from '../core/util.js';
// Saved web pages arrive as untrusted markup - sanitised with the shared rules.
import { sanitizeHtml } from '../core/sanitize.js';
import { buildOsintCard } from '../core/osint.js';
import { SCAN_LARGE, HASH_FILE_MAX, TEXTDOC_READ_MAX } from '../core/limits.js';
import { openZip } from './zip.js';
import { paginateText, paginateFlow, pagedPreviewCard, pagedTextCard, pagePreviewSkeleton } from './paged.js';
const LABELS = {
    rtf: 'Rich Text Format', abw: 'AbiWord document', fb2: 'FictionBook e-book',
    hwpx: 'Hangul (HWPX) document', mht: 'MHTML web archive', mhtml: 'MHTML web archive',
    dita: 'DITA topic', ditamap: 'DITA map', tei: 'TEI document', jats: 'JATS article',
    nxml: 'JATS / NLM article', rst: 'reStructuredText', adoc: 'AsciiDoc', asciidoc: 'AsciiDoc',
    org: 'Org-mode document', textile: 'Textile markup', tex: 'TeX / LaTeX source',
    latex: 'LaTeX source', ltx: 'LaTeX source', sty: 'LaTeX style', cls: 'LaTeX class',
    bib: 'BibTeX bibliography',
    mod: 'Go module file',
    rels: 'OPC relationships (XML)', md5: 'MD5 checksum',
};
function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    return doc.querySelector('parsererror') ? null : doc;
}
// ---------- RTF ----------
// Strip RTF control words / ignorable destinations down to readable text.
function stripRtf(rtf) {
    let out = '';
    let i = 0;
    const n = rtf.length;
    const stack = [];
    let ignore = false;
    // Destinations whose contents are not body text.
    const SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object',
        'header', 'footer', 'headerl', 'headerr', 'footerl', 'footerr', 'footnote', 'field',
        'generator', 'datastore', 'themedata', 'colorschememapping', 'latentstyles',
        'rsidtbl', 'listtable', 'listoverridetable', 'xmlnstbl', 'mmath', 'fldinst', 'filetbl']);
    let guard = 0;
    while (i < n && guard++ < 50_000_000) {
        const c = rtf[i];
        if (c === '{') {
            stack.push(ignore);
            i++;
            continue;
        }
        if (c === '}') {
            ignore = stack.length ? stack.pop() : false;
            i++;
            continue;
        }
        if (c === '\\') {
            const next = rtf[i + 1];
            if (next === '*') {
                ignore = true;
                i += 2;
                continue;
            } // ignorable destination
            if (next === "'") { // \'xx hex byte (cp1252-ish)
                const code = parseInt(rtf.substr(i + 2, 2), 16);
                if (!ignore && !isNaN(code))
                    out += String.fromCharCode(code);
                i += 4;
                continue;
            }
            if (next === '\\' || next === '{' || next === '}') {
                if (!ignore)
                    out += next;
                i += 2;
                continue;
            }
            if (next === '\n' || next === '\r' || next === '~') {
                if (!ignore)
                    out += (next === '~' ? ' ' : '\n');
                i += 2;
                continue;
            }
            const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i));
            if (m) {
                const word = m[1], arg = m[2];
                i += m[0].length;
                if (ignore)
                    continue;
                if (word === 'par' || word === 'line' || word === 'sect' || word === 'pard')
                    out += '\n';
                else if (word === 'tab')
                    out += '\t';
                else if (word === 'u' && arg != null) {
                    let code = parseInt(arg, 10);
                    if (code < 0)
                        code += 65536;
                    out += String.fromCharCode(code);
                    if (rtf[i] && rtf[i] !== '\\' && rtf[i] !== '{' && rtf[i] !== '}')
                        i++; // skip 1 fallback char
                }
                else if (SKIP.has(word))
                    ignore = true;
                continue;
            }
            i++;
            continue;
        }
        if (c === '\n' || c === '\r') {
            i++;
            continue;
        }
        if (!ignore)
            out += c;
        i++;
    }
    return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
// ---------- AbiWord / HWPX (paragraph text from XML) ----------
function paragraphsFromXml(doc) {
    const paras = [];
    for (const p of doc.getElementsByTagName('*')) {
        if (p.localName === 'p') {
            const t = p.textContent.replace(/\s+/g, ' ').trim();
            paras.push(t);
        }
    }
    return paras.join('\n');
}
async function extractHwpx(file) {
    const zip = await openZip(file, 64 * 1024 * 1024);
    const sections = zip.match(/Contents\/section\d+\.xml$/i).sort((a, b) => a.name.localeCompare(b.name));
    let text = '';
    for (const s of sections) {
        const xml = await zip.text(s.name);
        const doc = xml && parseXml(xml);
        if (doc)
            text += (text ? '\n' : '') + paragraphsFromXml(doc);
    }
    return text;
}
// ---------- FictionBook (.fb2) ----------
function renderFb2Content(doc) {
    const container = document.createElement('div');
    const FB = doc.documentElement && doc.documentElement.namespaceURI;
    const bodies = doc.getElementsByTagNameNS(FB || '*', 'body');
    const emit = (node, depth) => {
        for (const c of node.children) {
            const ln = c.localName;
            if (ln === 'title') {
                const h = document.createElement('h' + Math.min(6, depth + 2));
                h.textContent = c.textContent.replace(/\s+/g, ' ').trim();
                if (h.textContent)
                    container.appendChild(h);
            }
            else if (ln === 'subtitle') {
                const p = document.createElement('p');
                p.style.fontWeight = 'bold';
                p.textContent = c.textContent.replace(/\s+/g, ' ').trim();
                container.appendChild(p);
            }
            else if (ln === 'p') {
                const p = document.createElement('p');
                p.style.margin = '0 0 10px';
                p.textContent = c.textContent.replace(/\s+/g, ' ').trim() || ' ';
                container.appendChild(p);
            }
            else if (ln === 'empty-line') {
                container.appendChild(document.createElement('br'));
            }
            else if (ln === 'section') {
                emit(c, depth + 1);
            }
        }
    };
    for (const b of bodies)
        emit(b, 0);
    return container;
}
// ---------- MHTML ----------
// Pull the text/html part out of a MIME multipart archive and decode it.
function extractMhtmlHtml(text) {
    const mb = /boundary="?([^"\r\n;]+)"?/i.exec(text);
    let html = null;
    const decodePart = (raw) => {
        const sep = raw.indexOf('\r\n\r\n') >= 0 ? '\r\n\r\n' : '\n\n';
        const split = raw.indexOf(sep);
        if (split < 0)
            return null;
        const headers = raw.slice(0, split).toLowerCase();
        if (!/content-type:\s*text\/html/.test(headers))
            return null;
        let body = raw.slice(split + sep.length);
        // QP and base64 decode to BYTES, which then need the part's own charset -
        // a windows-1251 or shift_jis page otherwise comes out as Latin-1 mojibake.
        const cs = /charset\s*=\s*"?([^";\s]+)/.exec(headers);
        const decode = (bytes) => {
            let dec;
            try {
                dec = new TextDecoder(cs ? cs[1] : 'utf-8');
            }
            catch (_) {
                dec = new TextDecoder('utf-8');
            }
            return dec.decode(bytes);
        };
        if (/content-transfer-encoding:\s*quoted-printable/.test(headers)) {
            // The archive was read as UTF-8 text, so literal non-ASCII characters go
            // back to their UTF-8 bytes and each =XX escape becomes the byte it names.
            const rawBytes = new TextEncoder().encode(body.replace(/=\r?\n/g, ''));
            const out = new Uint8Array(rawBytes.length);
            const hex = (b) => (b >= 48 && b <= 57) || (b >= 65 && b <= 70) || (b >= 97 && b <= 102);
            let n = 0;
            for (let i = 0; i < rawBytes.length; i++) {
                if (rawBytes[i] === 0x3d && i + 2 < rawBytes.length && hex(rawBytes[i + 1]) && hex(rawBytes[i + 2])) {
                    out[n++] = parseInt(String.fromCharCode(rawBytes[i + 1], rawBytes[i + 2]), 16);
                    i += 2;
                }
                else
                    out[n++] = rawBytes[i];
            }
            body = decode(out.subarray(0, n));
        }
        else if (/content-transfer-encoding:\s*base64/.test(headers)) {
            try {
                body = decode(Uint8Array.from(atob(body.replace(/\s+/g, '')), (c) => c.charCodeAt(0)));
            }
            catch (_) { }
        }
        return body;
    };
    if (mb) {
        const parts = text.split('--' + mb[1]);
        for (const part of parts) {
            const h = decodePart(part);
            if (h) {
                html = h;
                break;
            }
        }
    }
    if (!html && /content-type:\s*text\/html/i.test(text))
        html = decodePart(text);
    return html;
}
// ---------- main ----------
export async function renderTextDoc(file, container, kind, ext) {
    container.hidden = false;
    container.innerHTML = '';
    // Ghost sheets stand in while the file is read, decoded and paginated.
    container.appendChild(pagePreviewSkeleton({ note: 'Reading document...' }));
    try {
        ext = (ext || (file.name.split('.').pop() || '')).toLowerCase();
        let pages, pageLabel = 'Page';
        const label = LABELS[ext] || LABELS[kind] || 'Document';
        // Whole-file reads are capped (TEXTDOC_READ_MAX): everything below turns the
        // text into DOM, and a multi-GB file with a .tex name would take the tab down.
        // A truncated FB2 / AbiWord no longer parses as XML - the FB2 path says so,
        // the AbiWord one falls back to showing the text.
        let truncated = false;
        const readCapped = () => {
            if (file.size <= TEXTDOC_READ_MAX)
                return file.text();
            truncated = true;
            return file.slice(0, TEXTDOC_READ_MAX).text();
        };
        if (kind === 'hwpx') {
            const text = await extractHwpx(file);
            pages = paginateText(text);
        }
        else if (kind === 'mhtml') {
            // Cap the slice read: an adversarial multi-hundred-MB .mht would otherwise
            // be buffered whole and then regex-scanned on the main thread.
            const MHTML_CAP = SCAN_LARGE;
            const raw = await (file.size > MHTML_CAP ? file.slice(0, MHTML_CAP) : file).text();
            const html = extractMhtmlHtml(raw);
            if (html == null) {
                container.innerHTML = '';
                container.appendChild(errorCard('Could not find an HTML part in this MHTML archive.'));
                return;
            }
            pages = paginateFlow(sanitizeHtml(html));
        }
        else if (kind === 'fb2') {
            const doc = parseXml(await readCapped());
            if (!doc) {
                container.innerHTML = '';
                container.appendChild(errorCard('Could not parse this FictionBook file.'));
                return;
            }
            pages = paginateFlow(renderFb2Content(doc));
        }
        else if (kind === 'abw') {
            const text = await readCapped();
            const doc = parseXml(text);
            pages = paginateText(doc ? paragraphsFromXml(doc) : text);
        }
        else if (kind === 'rtf') {
            pages = paginateText(stripRtf(await readCapped()));
        }
        else {
            // markup / source: show the raw text as selectable source on page sheets.
            pages = paginateText(await readCapped(), { mono: true });
        }
        const pageTexts = pages.map((p) => p.textContent);
        container.innerHTML = '';
        const info = el('div', { class: 'anr-card' });
        info.appendChild(el('h3', {}, label));
        info.appendChild(buildReadout([
            ['File', file.name],
            ['Size', fmtBytes(file.size)],
            truncated && ['Shown', 'The first ' + fmtBytes(TEXTDOC_READ_MAX) + ' only'],
            file.type && rowHelp('MIME', file.type, "The MIME type is a short standard label for what kind of file this is - for example image/jpeg for a photo or audio/mpeg for an MP3. The browser guesses it from the file's extension or from the operating system, so it's a hint about the format, not proof."),
            file.lastModified && ['Last modified', new Date(file.lastModified).toLocaleString()],
        ]));
        container.appendChild(info);
        if (pages.length && pageTexts.some((t) => t.trim())) {
            container.insertBefore(pagedPreviewCard(pages, { title: 'Page previews', label: pageLabel }), container.firstChild);
            container.appendChild(pagedTextCard(pageTexts, { label: pageLabel }));
        }
        else {
            container.appendChild(el('div', { class: 'anr-card' }, [
                el('h3', {}, 'Page previews'),
                el('p', { class: 'anr-hint' }, 'No readable text content could be extracted from this file.'),
            ]));
        }
        // Network indicators (URLs / IPs / domains / emails) lifted from the source text.
        try {
            const oc = buildOsintCard(pageTexts.join('\n'), { limit: 100 });
            if (oc)
                container.appendChild(oc);
        }
        catch (_) { /* ignore */ }
        if (file.size <= HASH_FILE_MAX)
            container.appendChild(integrityCard(file));
    }
    catch (e) {
        container.innerHTML = '';
        container.appendChild(errorCard('Could not read document: ' + (e && e.message || 'unknown error')));
    }
}
export const renderRtf = (f, c, ext) => renderTextDoc(f, c, 'rtf', ext || 'rtf');
export const renderAbw = (f, c, ext) => renderTextDoc(f, c, 'abw', ext || 'abw');
export const renderFb2 = (f, c, ext) => renderTextDoc(f, c, 'fb2', ext || 'fb2');
export const renderHwpx = (f, c, ext) => renderTextDoc(f, c, 'hwpx', ext || 'hwpx');
export const renderMhtml = (f, c, ext) => renderTextDoc(f, c, 'mhtml', ext || 'mht');
export const renderMarkup = (f, c, ext) => renderTextDoc(f, c, 'markup', ext);
//# sourceMappingURL=textdoc.js.map