/* Analyser - Sketch documents (.sketch)

   A .sketch file is a ZIP of JSON, which is why this can be a real viewer rather
   than a header readout. Inside:

     meta.json          app version, the page/artboard index, fonts used
     document.json      document-level assets: colours, shared text/layer styles
     user.json          per-page view state (scroll position, zoom)
     pages/<uuid>.json  one page, holding its whole layer tree
     images/<hash>.png  every bitmap placed in the document
     previews/preview.png  a render of the last-viewed page

   Every object in a page carries a `_class` naming what it is - artboard, group,
   text, symbolMaster, symbolInstance, shapePath - a `frame`, and for containers
   a `layers` array. That is the component tree, and walking it is the whole job.

   The two things worth pulling out beyond the tree are symbols and text. A
   symbolMaster is a reusable component and a symbolInstance points at one by
   symbolID, so counting instances per master says which components a design
   system actually leans on. And the text is the copy: reviewing a design usually
   means reading it, and the strings are otherwise buried several levels down in
   attributedString objects. */
import { el, row, rowHelp, h3help, errorCard, fmtBytes } from '../core/util.js';
import { openZip } from './zip.js';
import { buildEmbeddedImagesCard } from './embedded-images.js';
import { SKETCH_LAYER_MAX, EMBEDDED_IMAGES_MAX } from '../core/limits.js';
// How each _class reads in plain words. Anything not listed falls back to the
// raw class name, which is still informative and is better than hiding it.
const CLASS_LABEL = {
    page: 'Page', artboard: 'Artboard', group: 'Group', symbolMaster: 'Component',
    symbolInstance: 'Instance', text: 'Text', bitmap: 'Image', shapeGroup: 'Shape',
    shapePath: 'Path', rectangle: 'Rectangle', oval: 'Oval', star: 'Star',
    polygon: 'Polygon', triangle: 'Triangle', slice: 'Slice', hotspot: 'Hotspot',
    MSImmutableHotspotLayer: 'Hotspot', SymbolMaster: 'Component',
};
// The string of a text layer lives under attributedString; older files put it in
// a plain `string`. Both spellings appear in files still in circulation.
function textOf(o) {
    const s = (o.attributedString && o.attributedString.string) || o.string;
    if (typeof s !== 'string')
        return null;
    const t = s.replace(/\r/g, '').trim();
    return t || null;
}
function walk(o, doc, pageName) {
    if (!o || typeof o !== 'object')
        return null;
    if (doc.total >= SKETCH_LAYER_MAX) {
        doc.truncated = true;
        return null;
    }
    doc.total++;
    const cls = String(o._class || 'layer');
    doc.counts[cls] = (doc.counts[cls] || 0) + 1;
    const frame = o.frame || {};
    const node = {
        cls,
        name: typeof o.name === 'string' ? o.name : '',
        w: Math.round(Number(frame.width) || 0),
        h: Math.round(Number(frame.height) || 0),
        visible: o.isVisible !== false,
        symbolId: typeof o.symbolID === 'string' ? o.symbolID : null,
        text: cls === 'text' ? textOf(o) : null,
        children: [],
    };
    if (cls === 'symbolMaster' && node.symbolId)
        doc.masters.push({ id: node.symbolId, name: node.name });
    if (cls === 'symbolInstance' && node.symbolId)
        doc.instanceCounts[node.symbolId] = (doc.instanceCounts[node.symbolId] || 0) + 1;
    if (node.text)
        doc.texts.push({ page: pageName, text: node.text });
    if (Array.isArray(o.layers)) {
        for (const child of o.layers) {
            const c = walk(child, doc, pageName);
            if (c)
                node.children.push(c);
        }
    }
    return node;
}
// Build one <details> subtree. Leaves are rows; anything with children folds.
// Artboards open by default because that is the level a design is read at - one
// level in from the page, and above the individual shapes.
function treeNode(n, depth) {
    const label = CLASS_LABEL[n.cls] || n.cls;
    const meta = [
        n.w && n.h ? n.w + ' x ' + n.h : '',
        n.visible ? '' : 'hidden',
    ].filter(Boolean).join('  ');
    const name = n.name || '(unnamed)';
    if (!n.children.length) {
        const rowEl = el('div', { class: 'anr-tree-file' }, [
            el('span', { class: 'anr-tree-lead' }, '-'),
            el('span', { class: 'anr-tree-name' }, name),
            el('span', { class: 'anr-tree-meta' }, label + (meta ? '  ' + meta : '')),
        ]);
        return rowEl;
    }
    const det = el('details', { class: 'anr-tree-dir' });
    if (depth <= 1 || n.cls === 'artboard')
        det.open = true;
    const sum = el('summary', {}, [
        el('span', { class: 'anr-tree-icon' }, '>'),
        el('span', { class: 'anr-tree-name' }, name),
        el('span', { class: 'anr-tree-meta' }, label + '  ' + n.children.length + (meta ? '  ' + meta : '')),
    ]);
    det.appendChild(sum);
    const kids = el('div', { class: 'anr-tree-children' });
    for (const c of n.children)
        kids.appendChild(treeNode(c, depth + 1));
    det.appendChild(kids);
    return det;
}
export async function renderSketch(file, resultsEl) {
    resultsEl.hidden = false;
    resultsEl.innerHTML = '';
    let zip;
    try {
        zip = await openZip(file);
    }
    catch (e) {
        resultsEl.appendChild(errorCard('Could not open this .sketch file - it should be a ZIP package.'));
        return;
    }
    let meta = {}, document_ = {};
    try {
        meta = JSON.parse((await zip.text('meta.json')) || '{}');
    }
    catch (_) {
        meta = {};
    }
    try {
        document_ = JSON.parse((await zip.text('document.json')) || '{}');
    }
    catch (_) {
        document_ = {};
    }
    const doc = { pages: [], masters: [], instanceCounts: {}, texts: [], counts: {}, total: 0, truncated: false };
    const pageFiles = zip.match(/^pages\/.+\.json$/i);
    for (const e of pageFiles) {
        try {
            const json = JSON.parse((await zip.text(e.name)) || 'null');
            if (!json)
                continue;
            const pageName = typeof json.name === 'string' ? json.name : e.name;
            const n = walk(json, doc, pageName);
            if (n)
                doc.pages.push(n);
        }
        catch (_) { /* one unreadable page shouldn't lose the rest */ }
    }
    if (!doc.pages.length && !pageFiles.length) {
        resultsEl.appendChild(errorCard('This does not look like a Sketch document - no pages/ entries inside.'));
        return;
    }
    // ---- Info card ----
    const [h, help] = h3help('Sketch document', 'A .sketch file is a ZIP of JSON, so the whole document can be read: every page, artboard, group and layer, the components it defines and the copy it contains. Nothing is rendered from the vector data - the preview below is the picture Sketch itself saved into the file.');
    const card = el('div', { class: 'anr-card' });
    card.appendChild(h);
    card.appendChild(help);
    const tbl = el('table', { class: 'anr-readout' });
    tbl.appendChild(row('File', file.name));
    tbl.appendChild(row('Size', fmtBytes(file.size)));
    if (meta.appVersion)
        tbl.appendChild(row('Created with', 'Sketch ' + meta.appVersion + (meta.build ? ' (build ' + meta.build + ')' : '')));
    if (meta.commit)
        tbl.appendChild(rowHelp('Document commit', String(meta.commit).slice(0, 12), 'Sketch versions its document format; this identifies the exact build of the file format, not the design.'));
    if (meta.variant)
        tbl.appendChild(row('Variant', String(meta.variant)));
    tbl.appendChild(row('Pages', String(doc.pages.length)));
    const artboards = doc.counts.artboard || 0;
    if (artboards)
        tbl.appendChild(row('Artboards', String(artboards)));
    tbl.appendChild(rowHelp('Layers', doc.total.toLocaleString() + (doc.truncated ? ' (stopped counting here)' : ''), 'Every object in the document, counting groups and artboards as well as the shapes inside them.'));
    if (doc.masters.length)
        tbl.appendChild(rowHelp('Components', String(doc.masters.length), 'Sketch calls these symbols: a master that other parts of the document reuse by reference rather than by copying.'));
    const instances = doc.counts.symbolInstance || 0;
    if (instances)
        tbl.appendChild(row('Component instances', String(instances)));
    if (doc.counts.text)
        tbl.appendChild(row('Text layers', String(doc.counts.text)));
    if (doc.counts.bitmap)
        tbl.appendChild(row('Placed images', String(doc.counts.bitmap)));
    const fonts = Array.isArray(meta.fonts) ? meta.fonts.filter((f) => typeof f === 'string') : [];
    if (fonts.length)
        tbl.appendChild(rowHelp('Fonts used', fonts.slice(0, 12).join(', ') + (fonts.length > 12 ? ' and ' + (fonts.length - 12) + ' more' : ''), 'The typefaces the document refers to. A font listed here that is not installed will render as a substitute wherever the file is opened.'));
    const assets = (document_.assets && document_.assets.colorAssets) || document_.colorAssets;
    if (Array.isArray(assets) && assets.length)
        tbl.appendChild(row('Colour assets', String(assets.length)));
    const layerStyles = document_.layerStyles && document_.layerStyles.objects;
    if (Array.isArray(layerStyles) && layerStyles.length)
        tbl.appendChild(row('Shared layer styles', String(layerStyles.length)));
    const textStyles = document_.layerTextStyles && document_.layerTextStyles.objects;
    if (Array.isArray(textStyles) && textStyles.length)
        tbl.appendChild(row('Shared text styles', String(textStyles.length)));
    card.appendChild(tbl);
    resultsEl.appendChild(card);
    // ---- Preview ----
    const previewName = zip.has('previews/preview.png') ? 'previews/preview.png'
        : (zip.match(/^previews\/.+\.png$/i)[0] || {}).name;
    if (previewName) {
        try {
            const bytes = await zip.bytes(previewName);
            if (bytes) {
                const blob = new Blob([bytes], { type: 'image/png' });
                const pv = el('div', { class: 'anr-card' });
                pv.appendChild(el('h3', {}, 'Preview'));
                pv.appendChild(el('p', { class: 'anr-hint' }, 'The picture Sketch saved into the file - the last page as it was left, not a render of the vector data.'));
                const img = el('img', { alt: 'Sketch document preview' });
                img.src = URL.createObjectURL(blob);
                img.addEventListener('load', () => URL.revokeObjectURL(img.src), { once: true });
                pv.appendChild(el('div', { class: 'anr-preview' }, [img]));
                resultsEl.appendChild(pv);
            }
        }
        catch (_) { /* preview is a bonus */ }
    }
    // ---- Component tree ----
    {
        const t = el('div', { class: 'anr-card' });
        const [th, thelp] = h3help('Component tree', 'Every page, artboard, group and layer in the document, in the order Sketch stores them - which is back to front, so the first child of a group sits behind the ones after it. Each row names what the object is, how many children it has, and its size in points.');
        t.appendChild(th);
        t.appendChild(thelp);
        const tree = el('div', { class: 'anr-tree' });
        for (const p of doc.pages)
            tree.appendChild(treeNode(p, 0));
        t.appendChild(tree);
        if (doc.truncated) {
            t.appendChild(el('p', { class: 'anr-hint' }, 'Stopped after ' + SKETCH_LAYER_MAX.toLocaleString() + ' layers. Everything above is real; the rest of the document was not walked.'));
        }
        resultsEl.appendChild(t);
    }
    // ---- Components and their usage ----
    if (doc.masters.length) {
        const c = el('div', { class: 'anr-card' });
        const [ch, chelp] = h3help('Components (' + doc.masters.length + ')', 'Sketch calls these symbols. Each is defined once and referenced everywhere it appears, so the instance count is a fair measure of how much of the design actually rests on it - and a component with no instances is one nothing uses.');
        c.appendChild(ch);
        c.appendChild(chelp);
        const t = el('table', { class: 'anr-readout' });
        t.appendChild(el('tr', {}, [el('th', {}, 'Component'), el('th', {}, 'Instances')]));
        const rows = doc.masters
            .map((m) => ({ name: m.name || '(unnamed)', n: doc.instanceCounts[m.id] || 0 }))
            .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
        for (const r of rows)
            t.appendChild(el('tr', {}, [el('td', {}, r.name), el('td', {}, r.n ? String(r.n) : 'unused')]));
        c.appendChild(t);
        resultsEl.appendChild(c);
    }
    // ---- Copy ----
    if (doc.texts.length) {
        const c = el('div', { class: 'anr-card' });
        const [ch, chelp] = h3help('Text (' + doc.texts.length + ')', 'Every string in the document, in document order, with the page it sits on. Reviewing a design usually means reading it, and these are otherwise several levels down inside each text layer.');
        c.appendChild(ch);
        c.appendChild(chelp);
        const list = el('div', { class: 'anr-lrc-list' });
        for (const t of doc.texts.slice(0, 2000)) {
            list.appendChild(el('div', { class: 'anr-lrc-line' }, [
                el('span', { class: 'anr-lrc-time' }, t.page),
                el('span', { class: 'anr-lrc-text' }, t.text),
            ]));
        }
        c.appendChild(list);
        if (doc.texts.length > 2000)
            c.appendChild(el('p', { class: 'anr-hint' }, 'Showing the first 2,000 of ' + doc.texts.length.toLocaleString() + '.'));
        resultsEl.appendChild(c);
    }
    // ---- Placed bitmaps ----
    try {
        const imgEntries = zip.match(/^images\/.+\.(png|jpe?g)$/i).slice(0, EMBEDDED_IMAGES_MAX);
        const items = [];
        for (const e of imgEntries) {
            const bytes = await zip.bytes(e.name);
            if (!bytes)
                continue;
            const type = /\.png$/i.test(e.name) ? 'image/png' : 'image/jpeg';
            const blob = new Blob([bytes], { type });
            items.push({
                viewBlob: blob, downloadBlob: blob,
                downloadName: e.name.split('/').pop() || 'image',
                label: type === 'image/png' ? 'PNG' : 'JPEG', bytes: bytes.length,
            });
        }
        if (items.length) {
            resultsEl.appendChild(buildEmbeddedImagesCard({
                title: 'Placed images (' + items.length + ')',
                help: 'The bitmaps placed into the design, stored whole inside the package. They are named by content hash rather than by the file they came from, so an image used on five artboards is stored once.',
                items, resultsEl, sourceFile: file,
            }));
        }
    }
    catch (_) { /* images are a bonus */ }
}
//# sourceMappingURL=sketch.js.map