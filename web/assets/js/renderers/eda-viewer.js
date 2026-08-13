/* Analyser - shared EDA board/schematic SVG viewer
   ============================================================================
   The pan / zoom / fit / layer-toggle SVG viewer used by both the Altium
   (altium.js) and KiCad (kicad.js) renderers. Extracted verbatim from altium.js
   (the reference implementation) so the two viewers stay pixel-identical; the
   handful of places the two differed are parameterised through `opts`:

     - opts.layers   normalised Array<{ id, name, color }> (already sorted by the
                     caller). Renders the per-layer toggle chips. Altium passes
                     numeric ids + Altium layer names/colours; KiCad passes string
                     layer names + palette colours. cssEsc() in the selector is a
                     no-op for numeric ids and correct for KiCad's dotted names.
     - opts.padAdd   constant added to the fit padding (altium 1, kicad 0.5).
     - opts.clampDim floor for the bbox width/height before padding (altium 0,
                     kicad 0.001 - guards a zero-span footprint/board).

   The returned object is EXACTLY { wrap, centerOn, flash, home }; callers (the
   project cross-probe views) augment it with a `.focus` method afterwards.
*/
import { el, wheelZoomToggle } from '../core/util.js';
const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs) => {
    const n = document.createElementNS(SVGNS, tag);
    if (attrs)
        for (const k in attrs)
            n.setAttribute(k, attrs[k]);
    return n;
};
// CSS.escape-lite for a [data-layer="..."] selector value: escape " and \.
const cssEsc = (s) => String(s).replace(/["\\]/g, '\\$&');
// Round to a "nice" 1/2/5 x 10^n step so the grid reads like graph paper
// whatever the document's unit scale (sheet units, mm, or a tiny footprint).
function niceStep(x) {
    if (!(x > 0))
        return 1;
    const p = Math.pow(10, Math.floor(Math.log10(x))), f = x / p;
    return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}
// Draw a graph-paper grid (minor lines + a heavier line every 5th) behind the
// geometry, emulating the Altium / KiCad sheet. Lines are in document space so
// they pan/zoom with the board, but use non-scaling strokes so they stay 1px.
function addPaperGrid(parent, bbox) {
    const w = bbox.maxx - bbox.minx, h = bbox.maxy - bbox.miny;
    const span = Math.max(w, h);
    if (!(span > 0) || !Number.isFinite(span))
        return;
    const step = niceStep(span / 28), pad = step * 2;
    const x0 = Math.floor((bbox.minx - pad) / step) * step, x1 = Math.ceil((bbox.maxx + pad) / step) * step;
    const y0 = Math.floor((bbox.miny - pad) / step) * step, y1 = Math.ceil((bbox.maxy + pad) / step) * step;
    if ((x1 - x0) / step > 2000 || (y1 - y0) / step > 2000)
        return; // safety cap
    const g = svg('g', { class: 'anr-eda-grid' });
    const line = (x1_, y1_, x2_, y2_, major) => svg('line', { x1: x1_, y1: y1_, x2: x2_, y2: y2_,
        stroke: major ? 'rgba(36,50,80,0.26)' : 'rgba(36,50,80,0.12)', 'stroke-width': major ? 0.9 : 0.5, 'vector-effect': 'non-scaling-stroke' });
    for (let x = x0, i = Math.round(x0 / step); x <= x1 + 1e-6; x += step, i++)
        g.appendChild(line(x, y0, x, y1, i % 5 === 0));
    for (let y = y0, i = Math.round(y0 / step); y <= y1 + 1e-6; y += step, i++)
        g.appendChild(line(x0, y, x1, y, i % 5 === 0));
    parent.insertBefore(g, parent.firstChild);
}
export function buildViewer(build, opts = {}) {
    // build(group) populates an SVG <g> and returns the data bbox {minx,miny,maxx,maxy}.
    const wrap = el('div', { class: 'anr-altium-wrap' });
    const s = svg('svg', { class: 'anr-altium-svg' });
    const root = svg('g', {});
    s.appendChild(root);
    // Positioned stage around the SVG so the scroll-zoom toggle anchors to the
    // drawing area's bottom-right, clear of the toolbar below.
    const stage = el('div', { class: 'anr-wheelzoom-stage' });
    stage.appendChild(s);
    const wheelZoom = wheelZoomToggle();
    stage.appendChild(wheelZoom.el);
    wrap.appendChild(stage);
    const bbox = build(root);
    addPaperGrid(root, bbox);
    const clampDim = opts.clampDim || 0, padAdd = opts.padAdd != null ? opts.padAdd : 1;
    const W = Math.max(bbox.maxx - bbox.minx, clampDim), H = Math.max(bbox.maxy - bbox.miny, clampDim);
    const pad = Math.max(W, H) * 0.06 + padAdd;
    const vb = { x: bbox.minx - pad, y: bbox.miny - pad, w: W + pad * 2, h: H + pad * 2 };
    const home = { ...vb };
    const apply = () => s.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    apply();
    // The viewBox preserves aspect ratio (xMidYMid meet), so it is letterboxed
    // inside the element and the screen->document scale is UNIFORM on both axes.
    // Using vb.w/width for x and vb.h/height for y separately (as before) makes the
    // axis with the spare letterbox margin move at the wrong rate - hence panning
    // felt slower on one axis. Map through the single uniform scale + its centring
    // offset instead.
    const screenToUser = (r) => {
        const scale = Math.min(r.width / vb.w, r.height / vb.h);
        return { scale, offX: (r.width - vb.w * scale) / 2, offY: (r.height - vb.h * scale) / 2 };
    };
    // wheel zoom toward the cursor
    s.addEventListener('wheel', (e) => {
        if (!wheelZoom.enabled())
            return; // let the wheel scroll the page instead
        e.preventDefault();
        const r = s.getBoundingClientRect();
        const { scale, offX, offY } = screenToUser(r);
        const mx = vb.x + (e.clientX - r.left - offX) / scale;
        const my = vb.y + (e.clientY - r.top - offY) / scale;
        const k = e.deltaY < 0 ? 0.85 : 1 / 0.85;
        vb.x = mx - (mx - vb.x) * k;
        vb.y = my - (my - vb.y) * k;
        vb.w *= k;
        vb.h *= k;
        apply();
    }, { passive: false });
    // drag pan
    let drag = null;
    s.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; s.setPointerCapture(e.pointerId); s.classList.add('is-grabbing'); });
    s.addEventListener('pointermove', (e) => {
        if (!drag)
            return;
        const { scale } = screenToUser(s.getBoundingClientRect());
        vb.x -= (e.clientX - drag.x) / scale;
        vb.y -= (e.clientY - drag.y) / scale;
        drag = { x: e.clientX, y: e.clientY };
        apply();
    });
    const end = () => { drag = null; s.classList.remove('is-grabbing'); };
    s.addEventListener('pointerup', end);
    s.addEventListener('pointerleave', end);
    // toolbar
    const bar = el('div', { class: 'anr-altium-bar' });
    const fit = el('button', { class: 'anr-btn', type: 'button' }, 'Fit');
    fit.addEventListener('click', () => { Object.assign(vb, home); apply(); });
    bar.appendChild(fit);
    if (opts.layers && opts.layers.length) {
        for (const { id, name, color } of opts.layers) {
            const chip = el('button', { class: 'anr-btn anr-altium-layer is-on', type: 'button', title: name });
            chip.appendChild(el('span', { class: 'anr-altium-swatch', style: `background:${color};color:${color}` }));
            chip.appendChild(document.createTextNode(name));
            chip.addEventListener('click', () => {
                const on = chip.classList.toggle('is-on');
                root.querySelectorAll(`[data-layer="${cssEsc(id)}"]`).forEach((n) => { n.style.display = on ? '' : 'none'; });
            });
            bar.appendChild(chip);
        }
    }
    // Programmatic pan/zoom (used by the project view's cross-probe): centre the
    // viewBox on a data-space point, optionally tightening to a target width.
    function centerOn(cx, cy, w) {
        if (w && w > 0) {
            const aspect = vb.h / vb.w;
            vb.w = w;
            vb.h = w * aspect;
        }
        vb.x = cx - vb.w / 2;
        vb.y = cy - vb.h / 2;
        apply();
    }
    // Drop a short-lived "ping" ring at a data-space point to draw the eye there.
    let flashNode = null, flashTimer = null;
    function flash(cx, cy) {
        if (flashNode)
            flashNode.remove();
        const span = Math.max(vb.w, vb.h);
        flashNode = svg('circle', { class: 'anr-altium-ping', cx, cy, r: span * 0.05,
            fill: 'none', stroke: '#e8480a', 'stroke-width': span * 0.014 });
        root.appendChild(flashNode);
        if (flashTimer)
            clearTimeout(flashTimer);
        const node = flashNode;
        flashTimer = setTimeout(() => { if (node)
            node.remove(); if (flashNode === node)
            flashNode = null; }, 1500);
    }
    wrap.appendChild(bar);
    return { wrap, centerOn, flash, home: { ...home } };
}
export function fitBox() { return { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity }; }
export function grow(b, x, y) { if (x < b.minx)
    b.minx = x; if (y < b.miny)
    b.miny = y; if (x > b.maxx)
    b.maxx = x; if (y > b.maxy)
    b.maxy = y; }
export function safeBox(b, { degenPad = 50, fallback = 100 } = {}) {
    if (!Number.isFinite(b.minx))
        return { minx: -fallback, miny: -fallback, maxx: fallback, maxy: fallback };
    if (b.minx === b.maxx) {
        b.minx -= degenPad;
        b.maxx += degenPad;
    }
    if (b.miny === b.maxy) {
        b.miny -= degenPad;
        b.maxy += degenPad;
    }
    return b;
}
//# sourceMappingURL=eda-viewer.js.map