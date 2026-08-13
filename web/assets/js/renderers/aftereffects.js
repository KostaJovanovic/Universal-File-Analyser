/* Analyser - Adobe After Effects project (.aep) viewer
   ============================================================================
   An .aep is a RIFX file (big-endian RIFF) with form type "Egg!". It stores the
   project as nested chunk lists: a root "Fold" of "Item" lists, where each item
   is a folder, a composition (an "Item" carrying a "cdta" block plus one "Layr"
   list per layer) or footage. There is no public spec, so the layouts below were
   reverse-engineered:
     - cdta (composition): the per-comp time scale (ticks-per-second) is u32@8
       and the frame rate is u32@8 / u32@4; the composition duration is the
       rational u32@44 / scale (seconds); width = u16@140, height = u16@142.
     - idta (item):        type = u16@0 (1 folder, 4 comp, 7 footage), id = u32@16.
     - ldta (layer):       quality = u16@4; three (value, scale) rationals at
       offsets 12 / 20 / 28 give startTime / sourceIn / sourceOut in seconds, each
       value divided by ITS OWN denominator stored in the next u32 (16 / 24 / 32) -
       these are per-layer (a stretched / time-remapped layer carries a larger
       scale than the comp's), not the comp's u32@8. startTime is the comp time of
       the source's frame 0; sourceIn / sourceOut are the trimmed range measured
       from that frame 0, so the bar on the COMP timeline runs startTime+sourceIn
       .. startTime+sourceOut (this offset is what staggers a sequenced layer -
       without it every trimmed clip collapses onto t=0). Attribute bits at 37..39;
       source item id = u32@40; the layer name follows as a "Utf8".
   The authoring app + version live in an XMP packet near the end of the file
   (xmp:CreatorTool, the xmpMM history's softwareAgent entries, and the
   create/modify dates), which is where the "made in After Effects 20XX" comes
   from. We show the project metadata, then each composition's layer timeline. */
import { el, row, rowHelp, h3help, fmtBytes, integrityCard, errorCard } from '../core/util.js';
const SCALE = 30720; // default ticks-per-second; the real value is per-comp (cdta u32@8)
const MAX_READ = 256 * 1024 * 1024; // guard: don't buffer absurdly large projects whole
// AE's fixed 3D-view pseudo-layers, stored in every comp - not real timeline layers.
const VIEW_NAMES = new Set(['Default', 'Front', 'Left', 'Top', 'Back', 'Right', 'Bottom',
    'Active Camera', 'Custom View 1', 'Custom View 2', 'Custom View 3', 'Markers']);
// After Effects stores only a label-colour INDEX per layer (ldta @61); the
// index->RGB mapping is an app preference, not in the file, so we paint with AE's
// default 16-colour label palette. Index 0 = None (fall back to a type colour).
const AE_LABEL_COLOURS = [null,
    '#e5433d', '#e0e04a', '#7ecece', '#f1a4c8', '#b6a4d8', '#e6b48f', '#9ad6ac', '#6d9bd1',
    '#54a054', '#9a6fc0', '#e39a4f', '#9c6a4f', '#dd5cb2', '#4dc4d6', '#c3ae8a', '#3f7d54'];
const AE_LABEL_NAMES = [null,
    'Red', 'Yellow', 'Aqua', 'Pink', 'Lavender', 'Peach', 'Sea Foam', 'Blue',
    'Green', 'Purple', 'Orange', 'Brown', 'Fuchsia', 'Cyan', 'Sandstone', 'Dark Green'];
// Fallback fill when a layer carries no label (index 0), keyed by layer type.
const typeColour = (l) => (l.audio ? '#3ba776' : l.isComp ? '#8a6fd6' : l.src === 0 ? '#7f8896' : '#3b82c4');
const layerColour = (l) => AE_LABEL_COLOURS[l.labelIdx] || typeColour(l);
const AUDIO_EXT = /\.(mp3|wav|aac|m4a|aif|aiff|flac|ogg|opus|wma|mka)$/i;
const VIDEO_EXT = /\.(mp4|mov|avi|mkv|webm|m4v|mpg|mpeg|wmv|flv|m2ts|mts|mxf|prores|r3d|braw)$/i;
// A short glyph marking each layer kind, mirroring After Effects' source-type icons.
const TYPE_GLYPH = { text: 'T', shape: '◆', camera: '◉', light: '☼', audio: '♪',
    image: '▣', video: '►', precomp: '⧉', solid: '■' };
const TYPE_NAME = { text: 'text', shape: 'shape', camera: 'camera', light: 'light',
    audio: 'audio', image: 'image', video: 'video', precomp: 'pre-comp', solid: 'solid', footage: 'footage' };
const typeGlyph = (l) => TYPE_GLYPH[l.ltype] || '';
const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
// Walk the RIFX chunk tree, collecting compositions (with layers), an id->name
// map for footage/precomp resolution, the set of composition item ids, and the
// names of footage items.
function parseAep(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const L1 = new TextDecoder('latin1'), U8 = new TextDecoder('utf-8');
    const id = (o) => L1.decode(buf.subarray(o, o + 4));
    const u32 = (o) => dv.getUint32(o, false), i32 = (o) => dv.getInt32(o, false), u16 = (o) => dv.getUint16(o, false);
    const comps = [], idName = {}, compIds = new Set(), footage = [];
    // Read a null-terminated string from a fixed-length buffer (the legacy layer
    // name field inside ldta - used when the modern Utf8 name chunk is absent).
    const cstr = (o, max) => { let s = ''; for (let i = 0; i < max && buf[o + i]; i++)
        s += String.fromCharCode(buf[o + i]); return s; };
    function walk(start, end, c) {
        let o = start;
        while (o + 8 <= end) {
            const t = id(o), sz = u32(o + 4), ds = o + 8;
            if (ds + sz > buf.length)
                break;
            if (t === 'idta') {
                c.lastType = u16(ds);
                c.lastId = u32(ds + 16);
                c.pn = null;
            }
            else if (t === 'Utf8') {
                const v = U8.decode(buf.subarray(ds, ds + sz)).replace(/\0+$/, '');
                if (c.eL) {
                    c.eL.name = v;
                    c.eL = null;
                }
                else if (c.lastType != null && c.pn == null) {
                    c.pn = v;
                    if (c.lastId != null && v)
                        idName[c.lastId] = v; // empty = unnamed; don't pollute the map
                }
            }
            else if (t === 'alas' && c.lastType === 0x07 && c.lastId != null) {
                // Footage items leave their custom name empty and reference the source
                // file via an "alas" (Adobe alias) chunk holding a JSON {"fullpath":...}.
                // Use the file's basename as the item (and so the layer) name.
                const m = U8.decode(buf.subarray(ds, ds + sz)).match(/"fullpath":"([^"]*)"/);
                if (m && m[1]) {
                    const fp = m[1];
                    const base = fp.slice(Math.max(fp.lastIndexOf('\\'), fp.lastIndexOf('/')) + 1);
                    if (base) {
                        if (!idName[c.lastId])
                            idName[c.lastId] = base;
                        footage.push(base);
                    }
                }
            }
            else if (t === 'cdta') {
                const scale = u32(ds + 8) || SCALE; // ticks-per-second (= the fps numerator)
                const divisor = u32(ds + 4) || 1;
                const comp = { name: c.pn, fps: scale / divisor, scale, durTicks: u32(ds + 44),
                    w: u16(ds + 140), h: u16(ds + 142), layers: [] };
                if (c.lastType === 0x04 && c.lastId != null)
                    compIds.add(c.lastId);
                comps.push(comp);
                c.cur = comp;
                c.curLayer = null;
            }
            else if (t === 'ldta') {
                const a = [buf[ds + 37], buf[ds + 38], buf[ds + 39]];
                const sc = (c.cur && c.cur.scale) || SCALE;
                const dn = (off) => u32(ds + off) || sc; // each rational's own denominator (per-layer time scale)
                const labelIdx = buf[ds + 61]; // AE label-colour index (1..16; 0 = None)
                // tIn/tOut are added just below, once start has been read.
                const L = {
                    start: i32(ds + 12) / dn(16), in: i32(ds + 20) / dn(24), out: i32(ds + 28) / dn(32),
                    threeD: !!(a[1] & 4), src: u32(ds + 40),
                    labelIdx: labelIdx <= 16 ? labelIdx : 0,
                    name: null, fld: cstr(ds + 64, 31), // legacy fixed-field layer name
                };
                // in/out are source-local (measured from source frame 0); the layer's
                // place on the comp timeline is offset by startTime.
                L.tIn = L.start + L.in;
                L.tOut = L.start + L.out;
                if (c.cur)
                    c.cur.layers.push(L);
                c.eL = L;
                c.curLayer = L;
            }
            else if (t === 'tdmn' && c.curLayer) {
                // The layer's property groups reveal its kind: a text / shape / camera /
                // light layer carries a tell-tale match-name; footage layers carry none.
                const mn = cstr(ds, sz);
                if (mn === 'ADBE Text Properties')
                    c.curLayer.isText = true;
                else if (mn === 'ADBE Root Vectors Group')
                    c.curLayer.isShape = true;
                else if (mn === 'ADBE Camera Options Group')
                    c.curLayer.isCamera = true;
                else if (mn === 'ADBE Light Options Group')
                    c.curLayer.isLight = true;
            }
            if (t === 'LIST' || t === 'RIFX')
                walk(ds + 4, ds + sz, c);
            o = ds + sz + (sz & 1); // chunks are padded to an even length
        }
    }
    walk(12, buf.length, { lastType: null, lastId: null, pn: null, cur: null, eL: null });
    for (const comp of comps) {
        comp.real = comp.layers.filter((l) => !VIEW_NAMES.has(l.name) && !VIEW_NAMES.has(l.fld));
        // Duration is authoritative from the comp header (cdta u32@44): individual
        // layer out-points are unreliable - an unset layer carries a huge sentinel
        // and a time-remapped layer can run far past the comp end. Only if the header
        // value is missing do we fall back to the longest sane layer.
        const headerDur = comp.durTicks > 0 ? comp.durTicks / comp.scale : 0;
        comp.dur = headerDur > 0.01 ? headerDur
            : Math.max(0.01, ...comp.real.map((l) => l.tOut).filter((x) => x > 0.01 && x < 1e5));
        // Name priority: renamed layer (Utf8) -> legacy ldta name -> source file /
        // comp name -> numbered fallback. The source resolves footage to its filename
        // and pre-comps to the composition name.
        comp.real.forEach((l, i) => {
            l.label = l.name || l.fld || idName[l.src] || ('Layer ' + (i + 1));
            l.isComp = compIds.has(l.src);
            // AE's per-layer audio bit is always on; identify audio by the source's extension instead.
            l.audio = AUDIO_EXT.test(l.label);
            l.ltype = l.audio ? 'audio' : l.isText ? 'text' : l.isShape ? 'shape'
                : l.isCamera ? 'camera' : l.isLight ? 'light' : l.isComp ? 'precomp'
                    : l.src === 0 ? 'solid' : VIDEO_EXT.test(l.label) ? 'video' : 'image';
        });
    }
    return { comps, footage };
}
// Pull the authoring app + dates from the trailing XMP packet (plain regex - the
// packet is small UTF-8 and we only want a handful of fields).
function parseXmp(buf) {
    // Scan the tail (XMP sits near the end); decode that slice as latin1 for regex.
    const tail = buf.subarray(Math.max(0, buf.length - 512 * 1024));
    const xml = new TextDecoder('latin1').decode(tail);
    const start = xml.indexOf('<?xpacket');
    if (start < 0)
        return null;
    const x = xml.slice(start);
    const grab = (re) => { const m = x.match(re); return m ? m[1].trim() : ''; };
    const agents = [...x.matchAll(/<stEvt:softwareAgent>([^<]+)<\/stEvt:softwareAgent>/g)].map((m) => m[1].trim());
    return {
        creatorTool: grab(/<xmp:CreatorTool>([^<]+)<\/xmp:CreatorTool>/),
        created: grab(/<xmp:CreateDate>([^<]+)<\/xmp:CreateDate>/),
        modified: grab(/<xmp:(?:ModifyDate|MetadataDate)>([^<]+)<\/xmp:/),
        lastAgent: agents.length ? agents[agents.length - 1] : '',
    };
}
const fmtTime = (s) => (s >= 60 ? Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0') : s.toFixed(s < 10 ? 2 : 1) + 's');
const LH = 24, TOP = 6, LABEL_W = 200; // row height, top pad, frozen label column
const fmtTick = (t) => (t >= 60 ? Math.floor(t / 60) + ':' + String(Math.round(t % 60)).padStart(2, '0') : (Number.isInteger(t) ? t + 's' : t.toFixed(1) + 's'));
// The frozen left column: one row per layer with its name (right-aligned).
function aepLabelsSvg(real, H) {
    let s = '';
    real.forEach((l, i) => {
        const y = TOP + i * LH;
        s += `<rect x="0" y="${y}" width="${LABEL_W}" height="${LH}" fill="${i % 2 ? 'rgba(128,128,128,.10)' : 'rgba(128,128,128,.04)'}"/>`;
        s += `<rect x="5" y="${y + LH / 2 - 5}" width="10" height="10" fill="${layerColour(l)}"/>`; // AE label-colour swatch
        const g = typeGlyph(l);
        if (g)
            s += `<text x="20" y="${y + LH / 2 + 4}" fill="currentColor" font-size="10" opacity=".7" font-weight="600">${g}</text>`;
        const full = (l.label || 'Layer') + '  (' + (TYPE_NAME[l.ltype] || 'layer') + (l.threeD ? ', 3D' : '') + ')';
        s += `<text x="${LABEL_W - 7}" y="${y + LH / 2 + 4}" text-anchor="end" fill="currentColor" font-size="11" opacity=".85"><title>${esc(full)}</title>${esc((l.label || 'Layer').slice(0, 28))}${l.threeD ? ' ◳' : ''}</text>`;
    });
    return `<svg viewBox="0 0 ${LABEL_W} ${H}" width="${LABEL_W}" height="${H}" style="display:block">${s}</svg>`;
}
// The scrollable track, drawn at a given pixels-per-second (zoom) and width.
function aepTrackSvg(real, dur, H, trackW, pps) {
    const x = (t) => Math.max(0, Math.min(dur, t)) * pps;
    const bottom = TOP + real.length * LH;
    let stripes = '', grid = '', bars = '';
    real.forEach((l, i) => {
        stripes += `<rect x="0" y="${TOP + i * LH}" width="${trackW}" height="${LH}" fill="${i % 2 ? 'rgba(128,128,128,.10)' : 'rgba(128,128,128,.04)'}"/>`;
    });
    const STEPS = [0.25, 0.5, 1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600];
    const step = STEPS.find((s) => s * pps >= 55) || STEPS[STEPS.length - 1];
    for (let t = 0; t <= dur + 1e-6; t += step) {
        const gx = x(t);
        grid += `<line x1="${gx}" y1="${TOP}" x2="${gx}" y2="${bottom}" stroke="currentColor" stroke-width="1" opacity=".12"/>`;
        grid += `<text x="${gx + 3}" y="${bottom + 14}" fill="currentColor" font-size="9.5" opacity=".5">${fmtTick(t)}</text>`;
    }
    real.forEach((l, i) => {
        const y = TOP + i * LH;
        const oo = Math.min(Math.max(l.tOut, 0), dur); // clamp runaway / unset out-points to the comp end
        const ii = Math.min(Math.max(l.tIn, 0), dur);
        const col = layerColour(l);
        const bx = x(ii), bw = Math.max(2, x(oo) - x(ii));
        const lname = l.labelIdx ? ' · ' + AE_LABEL_NAMES[l.labelIdx] : '';
        const typeTip = ' · ' + (TYPE_NAME[l.ltype] || 'layer') + (l.threeD ? ', 3D' : '');
        bars += `<rect x="${bx}" y="${y + 4}" width="${bw}" height="${LH - 8}" fill="${col}"${l.threeD ? ' stroke="#e0a23a" stroke-width="1.3"' : ''}><title>${esc(l.label || 'Layer')} · ${fmtTime(ii)}–${fmtTime(oo)}${lname}${typeTip}</title></rect>`;
        // A type glyph (T text, ◆ shape, ♪ audio…) sits at the bar start; 3D layers keep the amber outline above.
        const g = typeGlyph(l);
        if (g && bw > 14)
            bars += `<text x="${bx + 5}" y="${y + LH / 2 + 4}" fill="#fff" font-size="10" opacity=".95" pointer-events="none" font-weight="600">${g}</text>`;
        if (bw > 42)
            bars += `<text x="${bx + (g ? 17 : 5)}" y="${y + LH / 2 + 4}" fill="#fff" font-size="9.5" opacity=".9" pointer-events="none">${fmtTime(oo - ii)}</text>`;
    });
    return `<svg viewBox="0 0 ${trackW} ${H}" width="${trackW}" height="${H}" style="display:block">${stripes}${grid}${bars}</svg>`;
}
// Build one composition's card: header + a frozen label column beside a
// horizontally zoomable / pannable track (ctrl/cmd+wheel to zoom, drag to pan).
function buildCompTimeline(comp) {
    const real = comp.real, dur = comp.dur;
    const H = TOP + real.length * LH + 22;
    let zoom = 1;
    const MIN_ZOOM = 1, MAX_ZOOM = 60;
    const card = el('div', { class: 'anr-card' });
    card.appendChild(el('h3', {}, comp.name || 'Composition'));
    const fps = comp.fps && isFinite(comp.fps) ? (comp.fps % 1 ? comp.fps.toFixed(2) : comp.fps.toFixed(0)) + ' fps' : '';
    const metaLine = [comp.w && comp.h ? `${comp.w} × ${comp.h}` : '', fps, `${dur.toFixed(1)}s`, `${real.length} layers`].filter(Boolean).join('  ·  ');
    card.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 8px' }, metaLine));
    // Zoom controls.
    const pct = el('span', { style: 'font-size:12px;opacity:.75;min-width:44px;text-align:center;font-variant-numeric:tabular-nums' }, '100%');
    const zbtn = (txt, title) => el('button', { type: 'button', class: 'anr-btn', style: 'padding:1px 9px;min-width:0;line-height:1.4', title }, txt);
    const bOut = zbtn('−', 'Zoom out'), bIn = zbtn('+', 'Zoom in'), bReset = zbtn('Reset', 'Reset zoom');
    card.appendChild(el('div', { class: 'anr-btn-row', style: 'gap:6px;align-items:center;margin:0 0 6px;flex-wrap:wrap' }, [
        el('span', { style: 'font-size:12px;opacity:.7' }, 'Zoom'), bOut, pct, bIn, bReset,
        el('span', { class: 'anr-hint', style: 'margin-left:6px' }, 'ctrl/⌘ + scroll to zoom, drag to pan'),
    ]));
    // Layout: frozen labels | scrollable track. The track holds the SVG plus a
    // hover playhead (a frame-snapped vertical line + a time/frame readout).
    const labels = el('div', { html: aepLabelsSvg(real, H), style: `flex:0 0 ${LABEL_W}px;border-right:1px solid rgba(128,128,128,.25)` });
    const lineH = TOP + real.length * LH;
    const svgHolder = el('div', {});
    const playline = el('div', { style: `position:absolute;top:0;width:1px;height:${lineH}px;background:currentColor;opacity:.5;pointer-events:none;display:none;z-index:2` });
    const playbox = el('div', { style: 'position:absolute;top:2px;transform:translateX(-50%);pointer-events:none;display:none;z-index:3;background:rgba(20,20,22,.92);color:#fff;font:600 10px/1.5 var(--font-mono,ui-monospace,monospace);padding:0 6px;white-space:nowrap;border:1px solid rgba(255,255,255,.28)' });
    const track = el('div', { style: 'position:relative' }, [svgHolder, playline, playbox]);
    const scroller = el('div', { style: 'overflow-x:auto;overflow-y:hidden;flex:1 1 auto;cursor:grab;touch-action:pan-y', class: 'anr-aep-scroller' });
    scroller.appendChild(track);
    card.appendChild(el('div', { style: 'display:flex;align-items:flex-start;border:1px solid rgba(128,128,128,.25);overflow:hidden' }, [labels, scroller]));
    const basePps = () => Math.max(1, (scroller.clientWidth || 660) - 6) / dur; // fit whole comp at zoom 1
    const ppsNow = () => basePps() * zoom;
    function render() {
        const pps = ppsNow();
        const trackW = Math.max(scroller.clientWidth || 660, Math.ceil(dur * pps) + 12);
        svgHolder.innerHTML = aepTrackSvg(real, dur, H, trackW, pps);
        pct.textContent = Math.round(zoom * 100) + '%';
    }
    // Hover playhead: snap the cursor to the nearest frame and show its timecode + frame.
    const fpsN = comp.fps && isFinite(comp.fps) && comp.fps > 0 ? comp.fps : 30;
    const fpsR = Math.max(1, Math.round(fpsN));
    function movePlayhead(clientX) {
        const pps = ppsNow();
        const t = Math.max(0, Math.min(dur, (clientX - track.getBoundingClientRect().left) / pps));
        const frame = Math.round(t * fpsN);
        const sx = (frame / fpsN) * pps;
        const ff = frame % fpsR, secs = Math.floor(frame / fpsR), mm = Math.floor(secs / 60), ss = secs % 60;
        playbox.textContent = `${mm}:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}  f${frame}`;
        playline.style.left = playbox.style.left = sx + 'px';
        playline.style.display = playbox.style.display = 'block';
    }
    const hidePlayhead = () => { playline.style.display = playbox.style.display = 'none'; };
    function setZoom(z, anchorClientX) {
        const oldPps = ppsNow();
        const rect = scroller.getBoundingClientRect();
        const anchorPx = (anchorClientX != null ? anchorClientX - rect.left : rect.width / 2) + scroller.scrollLeft;
        const tAnchor = anchorPx / oldPps;
        zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
        render();
        const off = anchorClientX != null ? anchorClientX - rect.left : rect.width / 2;
        scroller.scrollLeft = tAnchor * ppsNow() - off;
    }
    bIn.onclick = () => setZoom(zoom * 1.5);
    bOut.onclick = () => setZoom(zoom / 1.5);
    bReset.onclick = () => { zoom = 1; render(); scroller.scrollLeft = 0; };
    scroller.addEventListener('wheel', (e) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX);
        }
    }, { passive: false });
    // Drag-to-pan (mouse / pen; touch uses native scrolling).
    let dragging = false, startX = 0, startScroll = 0;
    scroller.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch')
            return;
        // Ignore presses on the native horizontal scrollbar (the strip below the
        // content area) so grabbing it scrolls normally instead of starting a pan,
        // which would capture the pointer and steal the scrollbar drag.
        const rect = scroller.getBoundingClientRect();
        if (scroller.offsetHeight > scroller.clientHeight && e.clientY - rect.top >= scroller.clientHeight)
            return;
        dragging = true;
        startX = e.clientX;
        startScroll = scroller.scrollLeft;
        scroller.style.cursor = 'grabbing';
        try {
            scroller.setPointerCapture(e.pointerId);
        }
        catch (_) { /* ignore */ }
    });
    scroller.addEventListener('pointermove', (e) => {
        if (dragging)
            scroller.scrollLeft = startScroll - (e.clientX - startX);
        if (e.pointerType !== 'touch')
            movePlayhead(e.clientX);
    });
    scroller.addEventListener('pointerleave', hidePlayhead);
    const endDrag = (e) => { dragging = false; scroller.style.cursor = 'grab'; try {
        scroller.releasePointerCapture(e.pointerId);
    }
    catch (_) { /* ignore */ } };
    scroller.addEventListener('pointerup', endDrag);
    scroller.addEventListener('pointercancel', endDrag);
    // Render once mounted (needs clientWidth) and keep it fitted on resize.
    if (typeof ResizeObserver !== 'undefined') {
        let lastW = -1;
        new ResizeObserver(() => { if (scroller.clientWidth !== lastW) {
            lastW = scroller.clientWidth;
            render();
        } }).observe(scroller);
    }
    else {
        requestAnimationFrame(render);
    }
    render();
    return card;
}
export async function renderAep(file, resultsEl) {
    resultsEl.hidden = false;
    resultsEl.innerHTML = '';
    resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading "${file.name}"…`));
    let buf;
    try {
        if (file.size > MAX_READ) {
            buf = new Uint8Array(await file.slice(0, MAX_READ).arrayBuffer());
        }
        else {
            buf = new Uint8Array(await file.arrayBuffer());
        }
    }
    catch (e) {
        resultsEl.innerHTML = '';
        resultsEl.appendChild(errorCard('Could not read this file: ' + (e && e.message)));
        return;
    }
    // Validate the RIFX / Egg! signature before walking.
    const sig = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
    const form = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]);
    if (sig !== 'RIFX' || form !== 'Egg!') {
        const { renderProprietary } = await import('./proprietary.js');
        return renderProprietary(file, resultsEl);
    }
    let data, xmp;
    try {
        data = parseAep(buf);
        xmp = parseXmp(buf);
    }
    catch (e) {
        resultsEl.innerHTML = '';
        resultsEl.appendChild(errorCard('Could not parse this After Effects project: ' + (e && e.message)));
        return;
    }
    resultsEl.innerHTML = '';
    // ---- Project metadata ----
    const meta = el('div', { class: 'anr-card' });
    meta.appendChild(el('h3', {}, 'After Effects project'));
    const tbl = el('table', { class: 'anr-readout' });
    tbl.appendChild(row('Application', 'Adobe After Effects'));
    tbl.appendChild(rowHelp('Format', 'After Effects project (.aep)', 'An After Effects project (.aep) is a binary file made of labelled blocks (a big-endian "RIFX" chunk format). Analyser reads its composition and layer blocks to rebuild the timeline, and takes the software version and dates from the embedded XMP information.'));
    if (xmp && xmp.creatorTool)
        tbl.appendChild(rowHelp('Created with', xmp.creatorTool, 'The version of After Effects that first created this project, taken from its xmp:CreatorTool metadata tag.'));
    if (xmp && xmp.lastAgent && xmp.lastAgent !== (xmp && xmp.creatorTool))
        tbl.appendChild(rowHelp('Last saved with', xmp.lastAgent, 'The most recent version of After Effects to save this project, taken from the last entry in its XMP edit history.'));
    if (xmp && xmp.created)
        tbl.appendChild(row('Created', xmp.created));
    if (xmp && xmp.modified)
        tbl.appendChild(row('Modified', xmp.modified));
    tbl.appendChild(rowHelp('Compositions', String(data.comps.length), 'After Effects’ term for a timeline or scene - a canvas holding layers arranged over time. One project can hold several.'));
    tbl.appendChild(row('Size', fmtBytes(file.size)));
    meta.appendChild(tbl);
    resultsEl.appendChild(meta);
    // ---- Compositions: one timeline card each (most layers first) ----
    const comps = data.comps.slice().sort((a, b) => b.real.length - a.real.length);
    const _renderAnchor = resultsEl.firstChild;
    for (const c of comps) {
        if (!c.real.length)
            continue;
        resultsEl.insertBefore(buildCompTimeline(c), _renderAnchor);
    }
    // ---- Legend ----
    const usedLabels = [...new Set(data.comps.flatMap((c) => (c.real || []).map((l) => l.labelIdx)).filter(Boolean))].sort((a, b) => a - b);
    const swatches = usedLabels.map((i) => `<span style="display:inline-block;width:10px;height:10px;background:${AE_LABEL_COLOURS[i]};vertical-align:middle;margin:0 5px 0 10px"></span>${AE_LABEL_NAMES[i]}`).join('');
    const [legH, legP] = h3help('Legend', 'Colours use After Effects’ default label palette - the file stores only the label index, so a customised palette in your preferences will look different. '
        + 'Each timeline zooms with ctrl/⌘ + scroll (or the zoom buttons) and pans by dragging. '
        + 'Timings are decoded from the file; keyframes and effects-over-time are not drawn.');
    resultsEl.appendChild(el('div', { class: 'anr-card' }, [
        legH, legP,
        el('p', { class: 'anr-hint', html: 'Each bar is a layer, positioned by its in and out point on the composition timeline and coloured by its After Effects label. '
                + (swatches ? 'Labels used:' + swatches + '. ' : '')
                + 'A glyph on each bar marks its kind: <b>T</b> text, ◆ shape, ▣ image, ► video, ♪ audio, ⧉ pre-comp, ■ solid, ◉ camera, ☼ light. '
                + 'An amber outline and a ◳ marker additionally denote 3D layers.' }),
    ]));
    // ---- Footage sources ----
    if (data.footage.length) {
        const seen = new Set(), uniq = data.footage.filter((n) => (seen.has(n) ? false : seen.add(n)));
        const card = el('div', { class: 'anr-card' });
        card.appendChild(el('h3', {}, 'Footage & sources (' + uniq.length + ')'));
        const ul = el('ul', { style: 'margin:8px 0 0;padding-left:18px;font-size:13px;word-break:break-word;' });
        uniq.slice(0, 200).forEach((n) => ul.appendChild(el('li', {}, n)));
        if (uniq.length > 200)
            ul.appendChild(el('li', { class: 'anr-hint' }, '… and ' + (uniq.length - 200) + ' more'));
        card.appendChild(ul);
        resultsEl.appendChild(card);
    }
    resultsEl.appendChild(integrityCard(file));
}
//# sourceMappingURL=aftereffects.js.map