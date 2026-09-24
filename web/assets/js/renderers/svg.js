/* Analyser - SVG inspector
   Renders an SVG at actual size, then reports stats, element counts,
   colour palette, and text content. */
import { el, row, rowHelp, fmtBytes, errorCard, integrityCard } from '../core/util.js';
import { SVG_MAX_NODES } from '../core/limits.js';
import { sanitizeSvgDoc, emptySanitizeReport } from '../core/sanitize.js';
import { renderPhoto } from './photo.js';
// Sanitise a parsed SVG document for the preview and return { findings, node },
// where `node` is a clean copy of the <svg>, already imported into this page and
// inserted AS A NODE (null if there's no <svg> root). The rules are core/
// sanitize.js's - scripts, <foreignObject>, <style>, SMIL, on* handlers,
// script-capable links, remote refs and non-SVG elements all go. The preview
// never goes through markup: serialising the cleaned tree and re-parsing it as
// HTML is what let `<!--><img src=x onerror=...>-->` come back to life.
// The parsed document itself is left untouched, so the statistics below still
// count what the file really contains.
function sanitizeSvg(doc) {
    const findings = [];
    // Sanitising is a walk over every node with per-attribute checks. A
    // pathologically large SVG (e.g. a DWG-derived drawing with 100k+ elements)
    // would freeze the tab, so decline to inline it rather than sanitising every
    // node. This never weakens sanitisation - an oversized SVG is simply not
    // rendered (node:null), the same fail-closed path as a missing <svg> root.
    if (doc.getElementsByTagName('*').length > SVG_MAX_NODES) {
        return { findings, node: null, tooComplex: true };
    }
    const rep = emptySanitizeReport();
    const node = sanitizeSvgDoc(doc, rep);
    const n = (count, one, many) => { if (count)
        findings.push(count + ' ' + (count > 1 ? many : one)); };
    n(rep.script, '<script> element', '<script> elements');
    n(rep.foreignObject, '<foreignObject> (embedded HTML)', '<foreignObject> (embedded HTML)');
    n(rep.html, 'embedded HTML element', 'embedded HTML elements');
    n(rep.style, '<style> element (document-wide CSS)', '<style> elements (document-wide CSS)');
    n(rep.smil, 'SMIL animation element', 'SMIL animation elements');
    n(rep.handlers, 'inline event handler (on*)', 'inline event handlers (on*)');
    n(rep.jsLinks, 'script-capable link (javascript:, vbscript:, ...)', 'script-capable links (javascript:, vbscript:, ...)');
    n(rep.extRefs, 'external/remote reference', 'external/remote references');
    n(rep.cssRefs, 'remote CSS url() reference', 'remote CSS url() references');
    return { findings, node };
}
// Sanitise a raw SVG markup string and return a safe <svg> element to insert
// (or null if there's no <svg> root / it won't parse / it is too large). Shared
// entry point for other renderers that show parser-produced SVG (dwg.js) so
// they get the same rules as the SVG viewer. Insert the node - never its markup.
export function sanitizeSvgMarkup(markup) {
    try {
        const doc = new DOMParser().parseFromString(String(markup || ''), 'image/svg+xml');
        if (doc.querySelector('parsererror'))
            return null;
        return sanitizeSvg(doc).node;
    }
    catch (_) {
        return null;
    }
}
// Which program exported this SVG - read from the generator comment or version
// attribute the exporter writes. Illustrator stamps "<!-- Generator: Adobe
// Illustrator ... -->", Inkscape sets inkscape:version, Sketch/Figma leave their
// own markers. Pure text matching so it works even when the XML won't parse.
function detectSvgCreator(text) {
    let m = text.match(/<!--\s*Generator:\s*([^]*?)\s*-->/i);
    if (m)
        return m[1].replace(/\s+/g, ' ').trim().slice(0, 120);
    m = text.match(/inkscape:version="([^"\s(]+)/i);
    if (m)
        return 'Inkscape ' + m[1];
    if (/>\s*Created with Sketch[.\s]*</i.test(text))
        return 'Sketch';
    if (/xmlns:figma=|figma\.com/i.test(text))
        return 'Figma';
    if (/\bvectornator\b|linearity\s+curve/i.test(text))
        return 'Vectornator / Linearity Curve';
    m = text.match(/<dc:creator>\s*(?:<[^>]*>\s*)*([^<]+)/i);
    if (m && m[1].trim())
        return m[1].trim().slice(0, 120);
    return '';
}
export async function renderSvg(file, resultsEl) {
    resultsEl.hidden = false;
    resultsEl.innerHTML = '';
    resultsEl.appendChild(el('div', { class: 'anr-info' }, `Inspecting SVG "${file.name}"…`));
    let svgText;
    try {
        svgText = await file.text();
    }
    catch (e) {
        resultsEl.innerHTML = '';
        resultsEl.appendChild(errorCard('Could not read SVG: ' + (e && e.message)));
        return;
    }
    resultsEl.innerHTML = '';
    // Parse first so we can sanitise BEFORE rendering (see sanitizeSvg above).
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const parseErr = doc.querySelector('parsererror');
    const svgRoot = doc.querySelector('svg');
    const { findings, node: safeNode, tooComplex } = sanitizeSvg(doc);
    // Markup of the sanitised copy, for the rasteriser only: it is drawn through an
    // <img>, where an SVG runs no script and loads nothing.
    let safe = null;
    if (safeNode) {
        try {
            safe = new XMLSerializer().serializeToString(safeNode);
        }
        catch (_) {
            safe = null;
        }
    }
    // --- Preview card: render the (sanitised) SVG, capped so it doesn't dominate ---
    const previewCard = el('div', { class: 'anr-card' });
    previewCard.appendChild(el('h3', {}, 'SVG preview'));
    if (safeNode) {
        // data-anr-untrusted: navigate.js leaves links inside it alone.
        const svgContainer = el('div', { class: 'anr-svg-preview', 'data-anr-untrusted': '' }, [safeNode]);
        svgContainer.style.maxHeight = '400px';
        svgContainer.style.overflow = 'auto';
        previewCard.appendChild(svgContainer);
    }
    else {
        previewCard.appendChild(el('p', { class: 'anr-hint' }, tooComplex
            ? 'This SVG has too many elements to render safely here, so the preview is skipped. The statistics below still apply.'
            : 'Could not safely render this SVG (invalid XML).'));
    }
    resultsEl.appendChild(previewCard);
    // --- Security card: list anything stripped from the preview ---
    if (findings.length) {
        const secCard = el('div', { class: 'anr-card' });
        secCard.appendChild(el('h3', {}, 'Security'));
        secCard.appendChild(el('p', { class: 'anr-hint anr-svg-error' }, 'Potentially unsafe content was found and removed from the preview:'));
        const ul = el('ul', { class: 'anr-svg-warnings' });
        for (const f of findings)
            ul.appendChild(el('li', {}, f));
        secCard.appendChild(ul);
        resultsEl.appendChild(secCard);
    }
    // --- Stats card ---
    const statsCard = el('div', { class: 'anr-card' });
    statsCard.appendChild(el('h3', {}, 'SVG statistics'));
    if (parseErr) {
        statsCard.appendChild(el('p', { class: 'anr-hint anr-svg-error' }, 'SVG parse error - stats may be incomplete'));
    }
    const tbl = el('table', { class: 'anr-readout' });
    tbl.appendChild(row('Application', 'SVG Vector Image'));
    const svgCreator = detectSvgCreator(svgText);
    if (svgCreator)
        tbl.appendChild(rowHelp('Created with', svgCreator, 'The program that made this SVG, taken from a note the exporting software left in the file (for example Adobe Illustrator, Inkscape, Sketch or Figma).'));
    tbl.appendChild(row('Name', file.name));
    tbl.appendChild(row('Size', `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`));
    if (svgRoot) {
        const viewBox = svgRoot.getAttribute('viewBox');
        const width = svgRoot.getAttribute('width');
        const height = svgRoot.getAttribute('height');
        tbl.appendChild(rowHelp('viewBox', viewBox || '-', 'The drawing area of the SVG, written as "min-x min-y width height". Because SVG is drawn from maths rather than fixed dots, this lets the image be shown at any size and stay crisp, never blocky.'));
        tbl.appendChild(row('Width', width || '-'));
        tbl.appendChild(row('Height', height || '-'));
    }
    // Count elements by type
    const elementTypes = ['path', 'rect', 'circle', 'ellipse', 'line', 'polyline',
        'polygon', 'text', 'tspan', 'g', 'use', 'defs', 'clipPath', 'mask',
        'linearGradient', 'radialGradient', 'pattern', 'image', 'filter'];
    const counts = {};
    for (const tag of elementTypes) {
        const els = doc.getElementsByTagName(tag);
        if (els.length > 0)
            counts[tag] = els.length;
    }
    // Count all nodes
    const allElements = doc.getElementsByTagName('*');
    tbl.appendChild(rowHelp('Total elements', String(allElements.length), 'How many individual building blocks the SVG contains in total - every shape, line, group and other tag added up.'));
    statsCard.appendChild(tbl);
    // Element breakdown
    if (Object.keys(counts).length > 0) {
        statsCard.appendChild(el('div', { class: 'anr-readout-section' }, 'Element counts'));
        const countTbl = el('table', { class: 'anr-readout' });
        for (const [tag, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
            countTbl.appendChild(row('<' + tag + '>', String(count)));
        }
        statsCard.appendChild(countTbl);
    }
    resultsEl.appendChild(statsCard);
    // --- Rasterise to PNG and analyse like a photo ---
    const rasterCard = el('div', { class: 'anr-card' });
    rasterCard.appendChild(el('h3', {}, 'Image analysis'));
    const rasterHint = el('p', { class: 'anr-hint', style: 'margin: 0 0 10px; font-size: 12px;' }, 'Render this SVG to a PNG and run the full photo analysis - histogram, palette, OCR and more.');
    rasterCard.appendChild(rasterHint);
    const rasterBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Analyse as image');
    const rasterTarget = el('div', { class: 'anr-results' });
    rasterBtn.addEventListener('click', () => {
        rasterBtn.disabled = true;
        rasterBtn.textContent = 'Rendering…';
        let w = 0, h = 0;
        if (svgRoot) {
            const vb = (svgRoot.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
            w = parseFloat(svgRoot.getAttribute('width')) || (vb.length === 4 ? vb[2] : 0);
            h = parseFloat(svgRoot.getAttribute('height')) || (vb.length === 4 ? vb[3] : 0);
        }
        // Scale up so small icons still produce a usable raster, cap the long edge.
        const longest = Math.max(w, h) || 512;
        const scale = Math.min(4, Math.max(1, 1024 / longest));
        const cw = Math.max(1, Math.round((w || 512) * scale));
        const ch = Math.max(1, Math.round((h || 512) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');
        const blob = new Blob([safe || svgText], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            ctx.drawImage(img, 0, 0, cw, ch);
            URL.revokeObjectURL(url);
            canvas.toBlob((pngBlob) => {
                if (!pngBlob) {
                    rasterBtn.textContent = 'Could not rasterise';
                    return;
                }
                const pngFile = new File([pngBlob], file.name.replace(/\.svg$/i, '') + '.png', { type: 'image/png' });
                rasterTarget.hidden = false;
                renderPhoto(pngFile, rasterTarget);
                rasterBtn.textContent = 'Re-analyse';
                rasterBtn.disabled = false;
            }, 'image/png');
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            rasterBtn.textContent = 'Could not rasterise';
            rasterBtn.disabled = false;
        };
        img.src = url;
    });
    rasterCard.appendChild(el('div', { class: 'anr-btn-row' }, [rasterBtn]));
    rasterCard.appendChild(rasterTarget);
    resultsEl.appendChild(rasterCard);
    // --- Color palette card ---
    const colors = new Set();
    for (const node of allElements) {
        const fill = node.getAttribute('fill');
        const stroke = node.getAttribute('stroke');
        const style = node.getAttribute('style') || '';
        if (fill && fill !== 'none' && fill !== 'inherit' && !fill.startsWith('url'))
            colors.add(fill);
        if (stroke && stroke !== 'none' && stroke !== 'inherit' && !stroke.startsWith('url'))
            colors.add(stroke);
        // Extract from inline style
        const fillMatch = style.match(/fill\s*:\s*([^;]+)/);
        const strokeMatch = style.match(/stroke\s*:\s*([^;]+)/);
        if (fillMatch) {
            const v = fillMatch[1].trim();
            if (v !== 'none' && v !== 'inherit' && !v.startsWith('url'))
                colors.add(v);
        }
        if (strokeMatch) {
            const v = strokeMatch[1].trim();
            if (v !== 'none' && v !== 'inherit' && !v.startsWith('url'))
                colors.add(v);
        }
    }
    if (colors.size > 0) {
        const colorCard = el('div', { class: 'anr-card' });
        colorCard.appendChild(el('h3', {}, 'Color palette'));
        const swatchWrap = el('div', { class: 'anr-svg-palette' });
        for (const c of colors) {
            const label = el('div', { class: 'anr-svg-swatch-label' }, c);
            const swatch = el('div', {
                class: 'anr-svg-swatch',
                title: c + ' - click to copy',
                onclick: () => {
                    navigator.clipboard.writeText(c).then(() => {
                        label.textContent = 'copied';
                        setTimeout(() => { label.textContent = c; }, 800);
                    });
                }
            });
            // backgroundColor, not background: the value comes straight from the file,
            // and the shorthand would also accept image-set(...) or an escaped u\72l(...)
            // - a remote fetch the moment the palette renders. A colour property takes
            // colours only; anything else is simply ignored.
            swatch.style.backgroundColor = c;
            const item = el('div', { class: 'anr-svg-swatch-item' }, [swatch, label]);
            swatchWrap.appendChild(item);
        }
        colorCard.appendChild(swatchWrap);
        resultsEl.appendChild(colorCard);
    }
    // --- Text content card ---
    const textElements = doc.querySelectorAll('text, tspan');
    if (textElements.length > 0) {
        const textCard = el('div', { class: 'anr-card' });
        textCard.appendChild(el('h3', {}, 'Text content'));
        const textSet = new Set();
        for (const t of textElements) {
            const txt = t.textContent.trim();
            if (txt)
                textSet.add(txt);
        }
        if (textSet.size > 0) {
            const textPre = el('pre', { class: 'anr-ocr-text anr-pre-scroll-sm' }, Array.from(textSet).join('\n'));
            textCard.appendChild(textPre);
        }
        else {
            textCard.appendChild(el('p', { class: 'anr-hint' }, 'No text content found'));
        }
        resultsEl.appendChild(textCard);
    }
    resultsEl.appendChild(integrityCard(file));
}
//# sourceMappingURL=svg.js.map