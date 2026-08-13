/* Analyser - Markdown files
   Renders .md / .markdown as formatted HTML alongside document stats and the
   raw source. Self-contained CommonMark-ish + GitHub-flavoured parser (no
   dependency): headings (ATX + setext), bold/italic/strikethrough, inline and
   fenced code, links, images, blockquotes, nested ordered/unordered lists,
   task lists, GFM tables, and horizontal rules.

   Safety: all text is HTML-escaped, raw inline HTML is rendered as literal
   text (not executed), and link/image URLs with a javascript: (or other
   script-y) scheme are neutralised. */
import { el, row, rowHelp, fileExt, errorCard } from '../core/util.js';
import { paginateFlow, openDocLightbox } from './paged.js';
function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s) {
    return esc(s).replace(/"/g, '&quot;');
}
// Neutralise dangerous URL schemes. Allows http(s), mailto, tel, relative,
// anchor, and data:image; anything else (javascript:, vbscript:, …) → '#'.
function safeUrl(raw) {
    const url = (raw || '').trim();
    if (/^(https?:|mailto:|tel:|#|\/|\.|[^:]*$)/i.test(url) || /^data:image\//i.test(url)) {
        return escAttr(url);
    }
    return '#';
}
// ---------- inline ----------
// Operates on already-HTML-escaped text. Order matters: code spans are pulled
// out first (so * and _ inside them are left alone), then images, links, then
// emphasis, then autolinks and hard breaks.
function inlineMd(escaped) {
    let s = escaped;
    // Code spans: a run of N backticks ... N backticks. Protect their contents
    // by stashing them behind a placeholder while the rest is processed.
    const codeStash = [];
    s = s.replace(/(`+)([\s\S]+?)\1/g, (m, ticks, body) => {
        const i = codeStash.length;
        codeStash.push('<code class="anr-md-icode">' + body.replace(/^ | $/g, '') + '</code>');
        return '\x00C' + i + '\x00';
    });
    // Images: ![alt](src "title")
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^)]*?)&quot;)?\)/g, (m, alt, src, title) => '<img class="anr-md-img" src="' + safeUrl(src) + '" alt="' + escAttr(alt) + '"' +
        (title ? ' title="' + escAttr(title) + '"' : '') + ' loading="lazy">');
    // Links: [text](href "title")
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^)]*?)&quot;)?\)/g, (m, text, href, title) => '<a class="anr-md-link" href="' + safeUrl(href) + '" target="_blank" rel="noopener noreferrer"' +
        (title ? ' title="' + escAttr(title) + '"' : '') + '>' + text + '</a>');
    // Autolinks: <https://…> (angle brackets are escaped to &lt; / &gt;)
    s = s.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, (m, url) => '<a class="anr-md-link" href="' + safeUrl(url) + '" target="_blank" rel="noopener noreferrer">' + url + '</a>');
    // Emphasis. Bold+italic first, then bold, then italic, then strikethrough.
    s = s.replace(/\*\*\*([^*]+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+?)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^\w])\*([^*\s][^*]*?)\*(?=[^\w]|$)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^\w])_([^_\s][^_]*?)_(?=[^\w]|$)/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+?)~~/g, '<del>$1</del>');
    // Hard line break: two+ trailing spaces before a newline.
    s = s.replace(/ {2,}\n/g, '<br>\n');
    // Restore code spans.
    s = s.replace(/\x00C(\d+)\x00/g, (m, i) => codeStash[+i]);
    return s;
}
// If a rendered fragment is a single wrapping <p>…</p>, drop the tags so tight
// list items don't get paragraph spacing.
function unwrapP(html) {
    const m = html.match(/^<p[^>]*>([\s\S]*)<\/p>$/);
    if (m && !/<p[\s>]/.test(m[1]))
        return m[1];
    return html;
}
// Split a GFM table row on unescaped pipes, trimming the optional outer pipes.
function splitTableRow(line) {
    let s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    const cells = [];
    let cur = '';
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '\\' && s[i + 1] === '|') {
            cur += '|';
            i++;
            continue;
        }
        if (s[i] === '|') {
            cells.push(cur);
            cur = '';
            continue;
        }
        cur += s[i];
    }
    cells.push(cur);
    return cells.map((c) => c.trim());
}
function isBlockStart(line) {
    return /^\s{0,3}(#{1,6}\s|>|([-*+])\s|\d+[.)]\s|```|~~~|([-*_])\s*\3\s*\3)/.test(line);
}
// ---------- list parsing (recursive via mdToHtml on item bodies) ----------
function parseList(lines, start) {
    const first = lines[start].match(/^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/);
    const baseIndent = first[1].length;
    const ordered = /\d/.test(first[2]);
    const startNum = ordered ? parseInt(first[2], 10) : 1;
    const items = [];
    let i = start;
    let loose = false;
    while (i < lines.length) {
        const line = lines[i];
        if (/^\s*$/.test(line)) {
            // Blank line: keep going only if the list visibly continues afterwards.
            let j = i + 1;
            while (j < lines.length && /^\s*$/.test(lines[j]))
                j++;
            if (j >= lines.length)
                break;
            const ind = lines[j].match(/^(\s*)/)[1].length;
            const itemAhead = lines[j].match(/^(\s*)([-*+]|\d+[.)])\s+/);
            // A more-indented continuation, or another item of the SAME type at the
            // same indent, keeps the (now loose) list going. A same-indent item of the
            // other type (ordered↔unordered) starts a fresh list, so stop here.
            const sameType = itemAhead && itemAhead[1].length === baseIndent && /\d/.test(itemAhead[2]) === ordered;
            if (ind > baseIndent || sameType) {
                loose = true;
                if (items.length)
                    items[items.length - 1].lines.push('');
                i++;
                continue;
            }
            break;
        }
        const m = line.match(/^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/);
        if (m && m[1].length === baseIndent && /\d/.test(m[2]) === ordered) {
            items.push({ lines: [m[4]], contentIndent: m[1].length + m[2].length + m[3].length });
            i++;
        }
        else if (items.length && line.match(/^(\s*)/)[1].length > baseIndent) {
            const cur = items[items.length - 1];
            cur.lines.push(line.slice(Math.min(cur.contentIndent, line.match(/^(\s*)/)[1].length)));
            i++;
        }
        else {
            break;
        }
    }
    const tag = ordered ? 'ol' : 'ul';
    const attr = ordered && startNum !== 1 ? ' start="' + startNum + '"' : '';
    let html = '<' + tag + ' class="anr-md-list"' + attr + '>';
    for (const it of items) {
        let body = it.lines.join('\n');
        const task = body.match(/^\[([ xX])\]\s+([\s\S]*)$/);
        if (task) {
            const checked = task[1].toLowerCase() === 'x';
            const rendered = unwrapP(mdToHtml(task[2]).trim());
            html += '<li class="anr-md-task"><input type="checkbox" disabled' +
                (checked ? ' checked' : '') + '> ' + rendered + '</li>';
        }
        else {
            let rendered = mdToHtml(body).trim();
            if (!loose)
                rendered = unwrapP(rendered);
            html += '<li>' + rendered + '</li>';
        }
    }
    html += '</' + tag + '>';
    return [html, i];
}
// ---------- block parsing ----------
function mdToHtml(md) {
    const lines = md.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
    let html = '';
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        // Blank
        if (/^\s*$/.test(line)) {
            i++;
            continue;
        }
        // Fenced code block
        const fence = line.match(/^(\s*)(```+|~~~+)\s*([\w+#.-]*)\s*$/);
        if (fence) {
            const ch = fence[2][0];
            const len = fence[2].length;
            const lang = fence[3];
            const close = new RegExp('^\\s*\\' + ch + '{' + len + ',}\\s*$');
            const buf = [];
            i++;
            while (i < lines.length && !close.test(lines[i])) {
                buf.push(lines[i]);
                i++;
            }
            i++; // consume closing fence (if present)
            html += '<div class="anr-md-codewrap">' +
                (lang ? '<span class="anr-md-codelang">' + escAttr(lang) + '</span>' : '') +
                '<pre class="anr-md-code"><code>' + esc(buf.join('\n')) + '</code></pre></div>';
            continue;
        }
        // ATX heading
        const h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
        if (h) {
            const lvl = h[1].length;
            html += '<h' + lvl + ' class="anr-md-h anr-md-h' + lvl + '">' + inlineMd(esc(h[2])) + '</h' + lvl + '>';
            i++;
            continue;
        }
        // Setext heading: a text line underlined by === (h1) or --- (h2).
        if (i + 1 < lines.length && /\S/.test(line) && !isBlockStart(line)) {
            if (/^\s{0,3}=+\s*$/.test(lines[i + 1])) {
                html += '<h1 class="anr-md-h anr-md-h1">' + inlineMd(esc(line.trim())) + '</h1>';
                i += 2;
                continue;
            }
            if (/^\s{0,3}-+\s*$/.test(lines[i + 1])) {
                html += '<h2 class="anr-md-h anr-md-h2">' + inlineMd(esc(line.trim())) + '</h2>';
                i += 2;
                continue;
            }
        }
        // Horizontal rule
        if (/^\s{0,3}([-*_])\s*(\1\s*){2,}$/.test(line)) {
            html += '<hr class="anr-md-hr">';
            i++;
            continue;
        }
        // Blockquote (one or more consecutive lines starting with >, recursed).
        if (/^\s{0,3}>/.test(line)) {
            const buf = [];
            while (i < lines.length && /^\s{0,3}>/.test(lines[i])) {
                buf.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
                i++;
            }
            html += '<blockquote class="anr-md-quote">' + mdToHtml(buf.join('\n')) + '</blockquote>';
            continue;
        }
        // GFM table: a header row, then a |---|:--:|---| delimiter row.
        if (line.includes('|') && i + 1 < lines.length &&
            /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
            const header = splitTableRow(line);
            const aligns = splitTableRow(lines[i + 1]).map((c) => {
                const l = c.startsWith(':'), r = c.endsWith(':');
                return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
            });
            i += 2;
            const bodyRows = [];
            while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) {
                bodyRows.push(splitTableRow(lines[i]));
                i++;
            }
            let t = '<div class="anr-md-tablewrap"><table class="anr-md-table"><thead><tr>';
            header.forEach((c, k) => {
                t += '<th' + (aligns[k] ? ' style="text-align:' + aligns[k] + '"' : '') + '>' + inlineMd(esc(c)) + '</th>';
            });
            t += '</tr></thead><tbody>';
            for (const r of bodyRows) {
                t += '<tr>';
                for (let k = 0; k < header.length; k++) {
                    t += '<td' + (aligns[k] ? ' style="text-align:' + aligns[k] + '"' : '') + '>' + inlineMd(esc(r[k] || '')) + '</td>';
                }
                t += '</tr>';
            }
            t += '</tbody></table></div>';
            html += t;
            continue;
        }
        // List
        if (/^(\s*)([-*+]|\d+[.)])\s+/.test(line)) {
            const [listHtml, next] = parseList(lines, i);
            html += listHtml;
            i = next;
            continue;
        }
        // Paragraph: gather consecutive lines until a blank line or a new block.
        const para = [];
        while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines[i])) {
            // Stop if the *next* line is a setext underline for this run.
            if (para.length && i + 1 <= lines.length &&
                (/^\s{0,3}=+\s*$/.test(lines[i])))
                break;
            para.push(lines[i]);
            i++;
            if (i < lines.length && (/^\s{0,3}=+\s*$/.test(lines[i]) || (/^\s{0,3}-+\s*$/.test(lines[i]) && para.length)))
                break;
        }
        if (para.length) {
            html += '<p class="anr-md-p">' + inlineMd(esc(para.join('\n'))) + '</p>';
        }
        else {
            i++;
        }
    }
    return html;
}
// ---------- entry point ----------
export async function renderMarkdown(file, resultsEl) {
    resultsEl.hidden = false;
    resultsEl.innerHTML = '';
    resultsEl.appendChild(el('div', { class: 'anr-info' }, `Rendering "${file.name}"…`));
    let text;
    try {
        text = await file.text();
    }
    catch (e) {
        resultsEl.innerHTML = '';
        resultsEl.appendChild(errorCard('Could not read this Markdown file: ' + (e && e.message)));
        return;
    }
    resultsEl.innerHTML = '';
    // ---- Stats ----
    const charCount = text.length;
    const words = text.trim().length === 0 ? [] : text.trim().split(/\s+/);
    const lineCount = text.split(/\n/).length;
    const headings = (text.match(/^\s{0,3}#{1,6}\s+/gm) || []).length;
    const codeBlocks = (text.match(/^\s*(```+|~~~+)/gm) || []).length;
    const links = (text.match(/(?<!!)\[[^\]]+\]\([^)]+\)/g) || []).length;
    const images = (text.match(/!\[[^\]]*\]\([^)]+\)/g) || []).length;
    const tables = (text.match(/^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/gm) || []).length;
    const readingTime = Math.max(1, Math.ceil(words.length / 200));
    const infoCard = el('div', { class: 'anr-card' });
    infoCard.appendChild(el('h3', {}, 'Markdown'));
    const tbl = el('table', { class: 'anr-readout' });
    tbl.appendChild(row('File', file.name));
    tbl.appendChild(row('Format', fileExt(file.name) === 'markdown' ? 'Markdown (.markdown)' : 'Markdown (.md)'));
    tbl.appendChild(row('Characters', charCount.toLocaleString()));
    tbl.appendChild(row('Words', words.length.toLocaleString()));
    tbl.appendChild(row('Lines', lineCount.toLocaleString()));
    tbl.appendChild(row('Headings', String(headings)));
    if (links)
        tbl.appendChild(row('Links', String(links)));
    if (images)
        tbl.appendChild(row('Images', String(images)));
    if (codeBlocks)
        tbl.appendChild(row('Code blocks', String(Math.floor(codeBlocks / 2) || codeBlocks)));
    if (tables)
        tbl.appendChild(row('Tables', String(tables)));
    tbl.appendChild(rowHelp('Est. reading time', readingTime + ' min', 'A rough guess at how long this takes to read, based on about 200 words a minute.'));
    infoCard.appendChild(tbl);
    resultsEl.appendChild(infoCard);
    // ---- Rendered view ----
    // Short docs render in full; longer ones show the first few rows inline with a
    // "See full" button that opens the whole thing in the shared document lightbox
    // (the same full-screen pager used for Word / ODF / PDF text).
    const PREVIEW_ROWS = 10;
    const renderCard = el('div', { class: 'anr-card' });
    renderCard.appendChild(el('h3', {}, 'Rendered'));
    let bodyHtml;
    try {
        bodyHtml = mdToHtml(text);
    }
    catch (e) {
        bodyHtml = '<p class="anr-syn-error">Could not render Markdown: ' + esc(String(e && e.message)) + '</p>';
    }
    // The full rendered body as a list of top-level blocks ("rows").
    const fullBody = el('div', { class: 'anr-md-body', html: bodyHtml });
    const blocks = Array.from(fullBody.children);
    if (blocks.length <= PREVIEW_ROWS) {
        // Short enough to show whole - no preview/lightbox needed.
        renderCard.appendChild(fullBody);
    }
    else {
        // Inline preview: the first N rows (cloned now, before paginateFlow moves the
        // originals onto pages below).
        const preview = el('div', { class: 'anr-md-body' });
        blocks.slice(0, PREVIEW_ROWS).forEach((b) => preview.appendChild(b.cloneNode(true)));
        // Paginate the full body onto sheets for the lightbox. paginateFlow moves
        // fullBody's children onto bare pages, so re-wrap each in .anr-md-body (at
        // full page width, to match the break measurement) to keep markdown styling.
        const pages = paginateFlow(fullBody);
        for (const p of pages) {
            const w = el('div', { class: 'anr-md-body', style: 'max-width:none' });
            while (p.firstChild)
                w.appendChild(p.firstChild);
            p.appendChild(w);
        }
        // "See full document" goes above the excerpt, so it's reachable without
        // scrolling past the preview rows.
        const fullBtn = el('button', { type: 'button', class: 'anr-btn' }, 'See full document');
        fullBtn.addEventListener('click', () => openDocLightbox(pages, 0, 'Page'));
        renderCard.appendChild(el('div', { class: 'anr-btn-row' }, [fullBtn]));
        renderCard.appendChild(el('p', { class: 'anr-hint' }, 'Showing the first ' + PREVIEW_ROWS + ' rows of ' + blocks.length + '.'));
        renderCard.appendChild(preview);
    }
    resultsEl.insertBefore(renderCard, resultsEl.firstChild);
    // ---- Raw source ----
    const rawCard = el('div', { class: 'anr-card' });
    const details = el('details', {});
    details.appendChild(el('summary', { class: 'anr-fmt-summary' }, 'Raw source'));
    const pre = el('pre', { class: 'anr-ocr-text anr-pre-scroll' }, '');
    pre.textContent = text;
    details.appendChild(pre);
    rawCard.appendChild(details);
    resultsEl.appendChild(rawCard);
}
//# sourceMappingURL=markdown.js.map