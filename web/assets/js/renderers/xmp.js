/* Analyser - XMP develop sidecar (.xmp) reader + visualiser
   ============================================================================
   An .xmp sidecar is the little XML file a RAW developer writes NEXT TO a raw
   photo (photo.CR3 -> photo.CR3.xmp / photo.xmp) so the untouched sensor file
   stays byte-for-byte original while every edit lives beside it. It is an
   Adobe XMP packet (RDF/XML): namespaced properties carrying the develop
   recipe (crs: - Camera Raw Settings, written by Lightroom / Adobe Camera Raw),
   the capture metadata copied from the raw (tiff:/exif:/aux:), the catalog
   fields (dc: title/keywords, xmp: rating/label/dates) and, for a darktable
   sidecar, an opaque module history stack (darktable:).

   Like the .cube LUT viewer, we don't just name it - we parse the recipe and
   VISUALISE it: the tone curve drawn as a real curve, the basic-panel sliders
   as bipolar bars, the HSL colour mixer, the crop rectangle. A sidecar we can't
   read as XMP is handed back to the generic identifier so it is never worse off. */
import { el, rowHelp, h3help, fmtBytes, integrityCard, errorCard, buildReadout } from '../core/util.js';
// ---- small value helpers -----------------------------------------------------
const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };
// Reduce an XMP rational ("56/10", "500/1") to a plain number where it is one.
function rational(v) {
    if (v == null)
        return null;
    const m = String(v).match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    if (m) {
        const d = parseFloat(m[2]);
        return d ? parseFloat(m[1]) / d : null;
    }
    return num(v);
}
const signed = (n, dp = 0) => (n > 0 ? '+' : '') + n.toFixed(dp).replace(/\.0+$/, '');
// ---- parse the packet --------------------------------------------------------
// Flatten every namespaced property - both the attribute form Lightroom uses
// (crs:Exposure2012="+0.55" on rdf:Description) and the element form - into two
// maps keyed by a lowercased "prefix:local": scalars in V, rdf:Seq/Bag/Alt
// lists in L. darktable's history (li with attributes, no text) is pulled out
// separately since its edits are an opaque module stack, not scalar properties.
function parseXmp(doc) {
    const V = new Map(), L = new Map(), ns = new Set();
    const put = (prefix, local, val) => {
        if (val == null)
            return;
        const key = (prefix + ':' + local).toLowerCase();
        const s = String(val).trim();
        if (s && !V.has(key))
            V.set(key, s);
    };
    const childByLocal = (node, name) => [...node.children].find((c) => c.localName === name);
    const descs = [...doc.getElementsByTagName('*')].filter((e) => e.localName === 'Description' && e.prefix === 'rdf');
    for (const d of descs) {
        for (const a of d.attributes) {
            if (a.prefix === 'xmlns' || a.name === 'xmlns' || !a.prefix)
                continue;
            if (a.prefix === 'rdf')
                continue;
            ns.add(a.prefix.toLowerCase());
            put(a.prefix, a.localName, a.value);
        }
    }
    for (const e of doc.getElementsByTagName('*')) {
        const p = e.prefix, ln = e.localName;
        if (!p || p === 'rdf' || p === 'x' || p === 'xmlns')
            continue;
        ns.add(p.toLowerCase());
        const key = (p + ':' + ln).toLowerCase();
        const seq = childByLocal(e, 'Seq') || childByLocal(e, 'Bag') || childByLocal(e, 'Alt');
        if (seq) {
            const items = [...seq.children].filter((c) => c.localName === 'li').map((li) => li.textContent.trim()).filter(Boolean);
            if (items.length && !L.has(key))
                L.set(key, items);
        }
        else if (!e.children.length) {
            put(p, ln, e.textContent);
        }
    }
    return { V, L, ns };
}
// darktable stores its edit as a history of module operations (each an rdf:li
// carrying darktable:operation / darktable:enabled attributes); list the modules
// so the readout says what was touched, the way the .look viewer lists a grade
// stack it can name but not re-bake.
function darktableHistory(doc) {
    const out = [];
    for (const e of doc.getElementsByTagName('*')) {
        if (e.localName !== 'li' || e.prefix !== 'rdf')
            continue;
        let op = null, enabled = true;
        for (const a of e.attributes) {
            if (a.localName === 'operation')
                op = a.value;
            else if (a.localName === 'enabled')
                enabled = a.value !== '0';
        }
        if (op)
            out.push({ op, enabled });
    }
    return out;
}
// ---- tone curve --------------------------------------------------------------
// crs tone curves are an rdf:Seq of "x, y" control points, 0..255 each. We plot
// them exactly like the LUT viewer's neutral tone-response curve: a framed
// square, a dashed identity diagonal, and one line per channel.
function parsePoints(list) {
    if (!list)
        return null;
    const pts = list.map((s) => s.split(',').map((n) => parseFloat(n.trim()))).filter((p) => p.length >= 2 && isFinite(p[0]) && isFinite(p[1]));
    pts.sort((a, b) => a[0] - b[0]);
    return pts.length >= 2 ? pts : null;
}
const isIdentityCurve = (pts) => pts.length === 2 && pts[0][0] === 0 && pts[0][1] === 0 && pts[1][0] === 255 && pts[1][1] === 255;
function toneCurveSvg(curves, W, H) {
    const pad = 6, w = W - pad - 6, h = H - pad - 6, x0 = pad, y0 = pad;
    const X = (t) => x0 + (t / 255) * w, Y = (v) => y0 + (1 - v / 255) * h;
    let g = `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="rgba(128,128,128,.05)" stroke="currentColor" stroke-opacity=".15"/>`;
    for (let q = 1; q < 4; q++) {
        const gx = X(q / 4 * 255), gy = Y(q / 4 * 255);
        g += `<line x1="${gx}" y1="${y0}" x2="${gx}" y2="${y0 + h}" stroke="currentColor" stroke-opacity=".07"/><line x1="${x0}" y1="${gy}" x2="${x0 + w}" y2="${gy}" stroke="currentColor" stroke-opacity=".07"/>`;
    }
    g += `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(255)}" y2="${Y(255)}" stroke="currentColor" stroke-opacity=".25" stroke-dasharray="3 3"/>`;
    for (const c of curves) {
        const path = c.pts.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join(' ');
        g += `<path d="${path}" fill="none" stroke="${c.color}" stroke-width="1.8" stroke-linejoin="round"/>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" style="display:block">${g}</svg>`;
}
// ---- a bipolar / unipolar develop slider, drawn as a bar ---------------------
function sliderRow(grid, label, value, min, max, fmt) {
    const n = num(value);
    if (n == null)
        return false;
    const span = max - min;
    const frac = Math.max(0, Math.min(1, (n - min) / span));
    const zero = min < 0 ? (0 - min) / span : 0;
    const bar = el('div', { class: 'anr-xmp-bar' });
    if (min < 0)
        bar.appendChild(el('div', { class: 'anr-xmp-bar-zero', style: `left:${(zero * 100).toFixed(2)}%` }));
    const from = n >= 0 || min >= 0 ? zero : frac;
    const to = n >= 0 || min >= 0 ? frac : zero;
    bar.appendChild(el('div', { class: 'anr-xmp-bar-fill', style: `left:${(from * 100).toFixed(2)}%;width:${(Math.abs(to - from) * 100).toFixed(2)}%` }));
    grid.appendChild(el('div', { class: 'anr-xmp-sk' }, label));
    grid.appendChild(bar);
    grid.appendChild(el('div', { class: 'anr-xmp-sv' }, fmt ? fmt(n) : (min < 0 ? signed(n) : String(n))));
    return true;
}
// ---- HSL colour-mixer grid ---------------------------------------------------
const HUES = [
    ['Red', '#d64545'], ['Orange', '#d98a3d'], ['Yellow', '#c7c23a'], ['Green', '#4fae5a'],
    ['Aqua', '#3bb3ad'], ['Blue', '#3d6fd9'], ['Purple', '#8a5cd9'], ['Magenta', '#d24d9e'],
];
function miniBar(n) {
    const frac = Math.max(0, Math.min(1, (n + 100) / 200)), zero = 0.5;
    const from = n >= 0 ? zero : frac, to = n >= 0 ? frac : zero;
    return el('div', { class: 'anr-xmp-bar anr-xmp-bar--mini', title: signed(n) }, [
        el('div', { class: 'anr-xmp-bar-zero', style: 'left:50%' }),
        el('div', { class: 'anr-xmp-bar-fill', style: `left:${(from * 100).toFixed(2)}%;width:${(Math.abs(to - from) * 100).toFixed(2)}%` }),
    ]);
}
// ------------------------------------------------------------------------------
export async function renderXmp(file, resultsEl) {
    resultsEl.hidden = false;
    resultsEl.innerHTML = '';
    resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading "${file.name}"…`));
    let text;
    try {
        text = await file.slice(0, 8 * 1024 * 1024).text();
    }
    catch (e) {
        resultsEl.innerHTML = '';
        resultsEl.appendChild(errorCard('Could not read this file: ' + (e && e.message)));
        return;
    }
    // Parse the RDF/XML. Anything that isn't a readable XMP packet is handed back
    // to the generic identifier (which still reads a basic field list + hex).
    let doc = null;
    try {
        doc = new DOMParser().parseFromString(text, 'application/xml');
    }
    catch (_) {
        doc = null;
    }
    const ok = doc && !doc.getElementsByTagName('parsererror').length && /<(?:x:xmpmeta|rdf:RDF)/i.test(text);
    if (!ok) {
        resultsEl.innerHTML = '';
        const { renderProprietary } = await import('./proprietary.js');
        return renderProprietary(file, resultsEl, 'xmp');
    }
    const { V, L, ns } = parseXmp(doc);
    const get = (k) => V.get(k.toLowerCase());
    const getList = (k) => L.get(k.toLowerCase());
    const getAny = (k) => get(k) ?? (getList(k) ? getList(k).join(', ') : undefined);
    const isDarktable = ns.has('darktable');
    const hasCrs = [...V.keys()].some((k) => k.startsWith('crs:')) || ns.has('crs');
    resultsEl.innerHTML = '';
    // ---- Identity ----
    const creatorTool = get('xmp:CreatorTool');
    const editor = creatorTool || (isDarktable ? 'darktable' : hasCrs ? 'Adobe Camera Raw / Lightroom' : 'unknown');
    // The raw this sidecar develops: crs:RawFileName when the writer records it,
    // else the sidecar's own basename with the .xmp suffix peeled off.
    const rawName = get('crs:RawFileName') || (file.name.replace(/\.xmp$/i, '') || null);
    const ratingN = num(get('xmp:Rating'));
    const rating = ratingN != null ? (ratingN > 0 ? '★'.repeat(Math.min(5, Math.round(ratingN))) + '☆'.repeat(Math.max(0, 5 - Math.round(ratingN))) + `  (${ratingN})` : 'unrated (0)') : null;
    const idCard = el('div', { class: 'anr-card' });
    idCard.appendChild(el('h3', {}, 'XMP develop sidecar'));
    idCard.appendChild(buildReadout([
        ['Format', isDarktable ? 'XMP sidecar (.xmp) - darktable' : 'XMP sidecar (.xmp)'],
        rowHelp('Develops', rawName || '-', 'The raw photo this sidecar belongs to. A sidecar keeps every edit in this separate file so the raw stays byte-for-byte original; the two travel together and are matched by name.'),
        rowHelp('Editor', editor, 'The program that wrote this sidecar and its edits, read from the file. Lightroom and Adobe Camera Raw share the same settings, so they read the same here.'),
        get('crs:Version') && rowHelp('Camera Raw version', get('crs:Version'), 'The version of the Adobe develop engine that wrote these settings.'),
        get('crs:ProcessVersion') && rowHelp('Process version', get('crs:ProcessVersion'), 'Adobe\'s rendering generation. Newer process versions (11 and later, the "2012" sliders) demosaic and tone-map the raw differently, so the same numbers can look different across versions.'),
        rating && rowHelp('Rating', rating, 'The star rating set in the catalog, 0 to 5.'),
        get('xmp:Label') && ['Colour label', get('xmp:Label')],
        getAny('crs:WhiteBalance') && rowHelp('White balance', getAny('crs:WhiteBalance'), 'The white-balance mode chosen in the develop settings ("As Shot" keeps the camera\'s, "Custom" a hand-picked temperature and tint).'),
        get('xmp:CreateDate') && ['Created', get('xmp:CreateDate')],
        get('xmp:ModifyDate') && ['Modified', get('xmp:ModifyDate')],
        get('xmp:MetadataDate') && ['Metadata edited', get('xmp:MetadataDate')],
        ['File size', fmtBytes(file.size)],
    ]));
    resultsEl.appendChild(idCard);
    // ---- Capture (copied from the raw's EXIF) ----
    const iso = getAny('exif:ISOSpeedRatings') || get('exif:ISOSpeedRatings');
    const expTime = get('exif:ExposureTime');
    const fnum = rational(get('exif:FNumber'));
    const focal = rational(get('exif:FocalLength'));
    const captureRows = [
        (get('tiff:Make') || get('tiff:Model')) && ['Camera', [get('tiff:Make'), get('tiff:Model')].filter(Boolean).join(' ')],
        (get('aux:Lens') || get('exifEX:LensModel')) && ['Lens', get('aux:Lens') || get('exifEX:LensModel')],
        iso && ['ISO', iso],
        expTime && ['Shutter', expTime + ' s'],
        fnum != null && ['Aperture', 'f/' + fnum],
        focal != null && ['Focal length', focal + ' mm'],
        get('exif:DateTimeOriginal') && ['Captured', get('exif:DateTimeOriginal')],
    ].filter(Boolean);
    if (captureRows.length) {
        const capCard = el('div', { class: 'anr-card' });
        capCard.appendChild(el('h3', {}, 'Capture'));
        capCard.appendChild(buildReadout(captureRows));
        resultsEl.appendChild(capCard);
    }
    // ---- Basic develop panel (the sliders), drawn as bars ----
    // Modern (process 2012+) sliders first; fall back to the legacy names so an
    // older sidecar still charts something sensible.
    const BASIC_2012 = [
        ['Exposure', 'Exposure2012', -5, 5, (n) => signed(n, 2) + ' EV'],
        ['Contrast', 'Contrast2012', -100, 100], ['Highlights', 'Highlights2012', -100, 100],
        ['Shadows', 'Shadows2012', -100, 100], ['Whites', 'Whites2012', -100, 100], ['Blacks', 'Blacks2012', -100, 100],
        ['Texture', 'Texture', -100, 100], ['Clarity', 'Clarity2012', -100, 100], ['Dehaze', 'Dehaze', -100, 100],
        ['Vibrance', 'Vibrance', -100, 100], ['Saturation', 'Saturation', -100, 100],
    ];
    const BASIC_LEGACY = [
        ['Exposure', 'Exposure', -4, 4, (n) => signed(n, 2) + ' EV'],
        ['Brightness', 'Brightness', -150, 150], ['Contrast', 'Contrast', -50, 100],
        ['Recovery', 'Recovery', 0, 100], ['Fill light', 'FillLight', 0, 100], ['Blacks', 'Blacks', 0, 100],
        ['Clarity', 'Clarity', -100, 100], ['Vibrance', 'Vibrance', -100, 100], ['Saturation', 'Saturation', -100, 100],
    ];
    const useLegacy = !BASIC_2012.some(([, k]) => get('crs:' + k) != null) && BASIC_LEGACY.some(([, k]) => get('crs:' + k) != null);
    const basicGrid = el('div', { class: 'anr-xmp-sliders' });
    let basicN = 0;
    for (const [label, key, min, max, fmt] of (useLegacy ? BASIC_LEGACY : BASIC_2012)) {
        if (sliderRow(basicGrid, label, get('crs:' + key), min, max, fmt))
            basicN++;
    }
    // Temperature / tint sit outside the -100..+100 sliders, so read them as text.
    const temp = get('crs:Temperature'), tint = get('crs:Tint');
    if (basicN) {
        const dvCard = el('div', { class: 'anr-card' });
        const [h, help] = h3help('Develop settings', 'The Basic panel adjustments this sidecar applies to the raw. Each bar fills from the centre - right (brighter, more) or left (darker, less) - so the shape of the edit is readable at a glance. These are settings, not the finished pixels: the raw itself is untouched.');
        dvCard.appendChild(h);
        dvCard.appendChild(help);
        if (temp || tint) {
            dvCard.appendChild(buildReadout([
                temp && rowHelp('Temperature', temp + (num(temp) > 100 ? ' K' : ''), 'The colour temperature the raw is developed at. Lower is cooler (bluer), higher is warmer (more amber).'),
                tint && rowHelp('Tint', (num(tint) != null ? signed(num(tint)) : tint), 'The green-magenta balance. Negative leans green, positive leans magenta.'),
            ].filter(Boolean)));
        }
        dvCard.appendChild(basicGrid);
        resultsEl.appendChild(dvCard);
    }
    // ---- Tone curve ----
    const curveDefs = [
        ['crs:ToneCurvePV2012', 'currentColor'], ['crs:ToneCurvePV2012Red', '#e0524d'],
        ['crs:ToneCurvePV2012Green', '#3ba776'], ['crs:ToneCurvePV2012Blue', '#3b82c4'],
    ];
    let curves = curveDefs.map(([k, color]) => ({ pts: parsePoints(getList(k)), color })).filter((c) => c.pts);
    if (!curves.length) {
        const legacy = parsePoints(getList('crs:ToneCurve'));
        if (legacy)
            curves = [{ pts: legacy, color: 'currentColor' }];
    }
    // Only worth drawing if at least one channel actually bends the line.
    if (curves.some((c) => !isIdentityCurve(c.pts))) {
        const draw = curves.filter((c) => !isIdentityCurve(c.pts) || c.color === 'currentColor');
        const tcCard = el('div', { class: 'anr-card' });
        const [h, help] = h3help('Tone curve', 'The point curve this sidecar bends light through, from blacks (bottom-left) to whites (top-right). The dashed diagonal is no change; a bump above it lifts those tones, a dip below darkens them. Any red, green or blue line is a per-channel curve on top of the main one.');
        tcCard.appendChild(h);
        tcCard.appendChild(help);
        tcCard.appendChild(el('div', { html: toneCurveSvg(draw, 260, 260), style: 'max-width:280px;border:1px solid var(--hairline);overflow:hidden' }));
        resultsEl.appendChild(tcCard);
    }
    // ---- HSL colour mixer ----
    const hslRows = [];
    for (const [name, swatch] of HUES) {
        const hh = num(get('crs:HueAdjustment' + name)), ss = num(get('crs:SaturationAdjustment' + name)), ll = num(get('crs:LuminanceAdjustment' + name));
        if (!hh && !ss && !ll)
            continue;
        hslRows.push([name, swatch, hh || 0, ss || 0, ll || 0]);
    }
    if (hslRows.length) {
        const hslCard = el('div', { class: 'anr-card' });
        const [h, help] = h3help('Colour mixer (HSL)', 'Per-colour hue, saturation and luminance tweaks - the HSL / colour-mixer panel. Only the colours actually adjusted are shown. Each bar fills from the centre; left is a negative shift, right positive.');
        hslCard.appendChild(h);
        hslCard.appendChild(help);
        const grid = el('div', { class: 'anr-xmp-hsl' });
        grid.appendChild(el('div', { class: 'anr-xmp-hsl-head' }, ''));
        for (const c of ['Hue', 'Sat', 'Lum'])
            grid.appendChild(el('div', { class: 'anr-xmp-hsl-head' }, c));
        for (const [name, swatch, hh, ss, ll] of hslRows) {
            grid.appendChild(el('div', { class: 'anr-xmp-hsl-name' }, [el('span', { class: 'anr-xmp-hsl-chip', style: 'background:' + swatch }), name]));
            grid.appendChild(miniBar(hh));
            grid.appendChild(miniBar(ss));
            grid.appendChild(miniBar(ll));
        }
        hslCard.appendChild(grid);
        resultsEl.appendChild(hslCard);
    }
    // ---- Detail / optics ----
    const detailRows = [
        get('crs:Sharpness') != null && rowHelp('Sharpening', get('crs:Sharpness'), 'The sharpening amount applied on develop (0 to 150).'),
        get('crs:LuminanceSmoothing') != null && num(get('crs:LuminanceSmoothing')) > 0 && rowHelp('Luminance noise reduction', get('crs:LuminanceSmoothing'), 'How strongly grain-like luminance noise is smoothed away (0 to 100).'),
        get('crs:ColorNoiseReduction') != null && rowHelp('Colour noise reduction', get('crs:ColorNoiseReduction'), 'How strongly blotchy colour noise is removed (0 to 100).'),
        get('crs:LensProfileEnable') != null && rowHelp('Lens corrections', get('crs:LensProfileEnable') === '1' ? 'on' + (get('crs:LensProfileName') ? ' - ' + get('crs:LensProfileName') : '') : 'off', 'Whether the built-in lens profile (distortion and vignette correction for this specific lens) is switched on.'),
        (get('crs:AutoLateralCA') === '1') && ['Chromatic aberration', 'auto-removed'],
    ].filter(Boolean);
    if (detailRows.length) {
        const dCard = el('div', { class: 'anr-card' });
        dCard.appendChild(el('h3', {}, 'Detail & optics'));
        dCard.appendChild(buildReadout(detailRows));
        resultsEl.appendChild(dCard);
    }
    // ---- Crop & geometry ----
    const hasCrop = /^true$/i.test(get('crs:HasCrop') || '');
    const cl = num(get('crs:CropLeft')), ct = num(get('crs:CropTop')), cr = num(get('crs:CropRight')), cb = num(get('crs:CropBottom'));
    const angle = num(get('crs:CropAngle'));
    if (hasCrop && cl != null && ct != null && cr != null && cb != null) {
        const geoCard = el('div', { class: 'anr-card' });
        geoCard.appendChild(el('h3', {}, 'Crop & geometry'));
        const W = 220, H = 150, x = cl * W, y = ct * H, w = (cr - cl) * W, h = (cb - ct) * H;
        const svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="max-width:100%;display:block">
      <rect x="0" y="0" width="${W}" height="${H}" fill="rgba(128,128,128,.10)" stroke="currentColor" stroke-opacity=".25"/>
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="rgba(128,128,128,.12)" stroke="currentColor" stroke-opacity=".8" stroke-width="1.5"/>
    </svg>`;
        geoCard.appendChild(el('div', { html: svg, style: 'margin-bottom:8px' }));
        geoCard.appendChild(buildReadout([
            rowHelp('Kept area', Math.round((cr - cl) * (cb - ct) * 100) + '% of the frame', 'How much of the original frame the crop keeps. The outline above shows where the crop sits inside the full photo.'),
            angle != null && Math.abs(angle) > 0.001 && rowHelp('Straighten', signed(angle, 1) + '°', 'The straightening rotation applied inside the crop.'),
        ].filter(Boolean)));
        resultsEl.appendChild(geoCard);
    }
    // ---- darktable module stack ----
    if (isDarktable) {
        const hist = darktableHistory(doc);
        const active = hist.filter((m) => m.enabled);
        const dtCard = el('div', { class: 'anr-card' });
        const [h, help] = h3help('darktable modules', 'darktable stores its edit as a stack of processing modules rather than named sliders, and the pixel maths lives in an encoded block this reader can\'t re-run. So instead we list the modules the edit switches on - the closest read to what was done.');
        dtCard.appendChild(h);
        dtCard.appendChild(help);
        dtCard.appendChild(buildReadout([
            ['Modules active', active.length + ' of ' + hist.length],
            get('darktable:history_end') && ['History steps', get('darktable:history_end')],
        ].filter(Boolean)));
        if (active.length) {
            const names = [...new Set(active.map((m) => m.op))].sort();
            dtCard.appendChild(el('div', { class: 'anr-xmp-kws', style: 'margin-top:8px' }, names.map((n) => el('span', { class: 'anr-xmp-kw' }, n))));
        }
        resultsEl.appendChild(dtCard);
    }
    // ---- Catalog: keywords / description ----
    const kw = getList('dc:subject') || getList('lr:hierarchicalSubject');
    const catRows = [
        getAny('dc:title') && ['Title', getAny('dc:title')],
        getAny('dc:description') && ['Description', getAny('dc:description')],
        getAny('dc:creator') && ['Creator', getAny('dc:creator')],
        getAny('dc:rights') && ['Copyright', getAny('dc:rights')],
        (get('photoshop:City') || get('photoshop:Country')) && ['Location', [get('photoshop:City'), get('photoshop:State'), get('photoshop:Country')].filter(Boolean).join(', ')],
    ].filter(Boolean);
    if (catRows.length || (kw && kw.length)) {
        const kwCard = el('div', { class: 'anr-card' });
        kwCard.appendChild(el('h3', {}, 'Catalog metadata'));
        if (catRows.length)
            kwCard.appendChild(buildReadout(catRows));
        if (kw && kw.length) {
            kwCard.appendChild(el('p', { class: 'anr-readout-section' }, 'Keywords'));
            kwCard.appendChild(el('div', { class: 'anr-xmp-kws' }, kw.map((k) => el('span', { class: 'anr-xmp-kw' }, k))));
        }
        resultsEl.appendChild(kwCard);
    }
    // ---- Raw XMP packet ----
    const rawCard = el('div', { class: 'anr-card' });
    const det = el('details');
    det.appendChild(el('summary', { class: 'anr-readout-section', style: 'cursor:pointer' }, 'Raw XMP packet'));
    det.appendChild(el('pre', { class: 'anr-pre', style: 'max-height:360px;overflow:auto;white-space:pre-wrap;word-break:break-word' }, text));
    rawCard.appendChild(det);
    resultsEl.appendChild(rawCard);
    // ---- Integrity ----
    resultsEl.appendChild(integrityCard(file));
}
//# sourceMappingURL=xmp.js.map