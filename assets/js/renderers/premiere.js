/* Analyser - Adobe Premiere Pro project (.prproj / .prel) viewer
   ============================================================================
   A .prproj is a gzip-compressed XML document (the "PremiereData" model). Once
   inflated it is a graph of cross-referenced objects, each carrying an ObjectID
   (a small integer, unique only within its class) and/or an ObjectUID (a globally
   unique GUID); references point at those via ObjectRef / ObjectURef. The bits we
   want form a clean chain:

     Project ──▶ Sequence (ObjectUID, has <Name>, <ID>)
       └ TrackGroups ▸ TrackGroup ▸ <Second ObjectRef> ─▶ {Video,Audio}TrackGroup
            ├ <FrameRect> "0,0,1080,1920"  (resolution)
            ├ TrackGroup ▸ <FrameRate>     (ticks-per-frame)
            └ Tracks ▸ Track <ObjectURef> ─▶ {Video,Audio}ClipTrack
                 └ ClipItems ▸ TrackItems ▸ TrackItem <ObjectRef> ─▶ {..}ClipTrackItem
                      ├ ClipTrackItem ▸ TrackItem ▸ <Start>/<End>  (ticks)
                      └ ClipTrackItem ▸ <SubClip ObjectRef> ─▶ SubClip ▸ <Name>

   Time is in ticks at 254016000000 ticks per second (Premiere's fixed timebase),
   so seconds = ticks / 254016000000 and fps = 254016000000 / ticks-per-frame.

   There is no public spec; the layout above was reverse-engineered from real
   project files. We rebuild each sequence's timeline - one row per track, each
   clip drawn as a bar positioned by its in / out point - mirroring the After
   Effects viewer, then show the project metadata and the clips it references. */

import { el, row, rowHelp, fmtBytes, integrityCard, errorCard } from '../core/util.js';

const TPS = 254016000000;                  // Premiere ticks per second (fixed timebase)
const MAX_COMPRESSED = 64 * 1024 * 1024;   // don't buffer absurdly large projects whole
const MAX_XML = 96 * 1024 * 1024;          // cap the inflated XML we hold / parse
const MAX_CLIP_S = 24 * 3600;              // ignore clips with runaway / sentinel out-points

const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const num = (s) => { const n = Number(s); return isFinite(n) ? n : 0; };
const basename = (p) => (p ? p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1) : '');

// --- tiny DOM helpers (the model nests deeply; CSS selectors get unwieldy) ---
const kids = (e, tag) => { const out = []; if (e) for (const c of e.children) if (c.tagName === tag) out.push(c); return out; };
const kid = (e, tag) => { if (e) for (const c of e.children) if (c.tagName === tag) return c; return null; };
const txt = (e, tag) => { const k = kid(e, tag); return k ? k.textContent.trim() : ''; };

// Inflate the gzip stream to a string (capped). Premiere also ships the odd
// uncompressed-XML project, so fall back to reading the file as text.
async function inflate(file) {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const gzipped = head[0] === 0x1F && head[1] === 0x8B;
  if (!gzipped) {
    const t = await file.slice(0, MAX_XML).text();
    return t.includes('<PremiereData') || t.includes('<Project') ? t : null;
  }
  if (typeof DecompressionStream === 'undefined') return null;
  const blob = file.slice(0, Math.min(file.size, MAX_COMPRESSED));
  const reader = blob.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const dec = new TextDecoder();
  let xml = '';
  while (xml.length < MAX_XML) {
    const { done, value } = await reader.read();
    if (done) break;
    xml += dec.decode(value, { stream: true });
  }
  reader.cancel().catch(() => {});
  return xml;
}

// Walk the object graph into a flat model: sequences, each with tracks of clips.
function parsePremiere(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length && !doc.querySelector('PremiereData, Project')) {
    throw new Error('not a readable PremiereData document');
  }

  // Index every object by its GUID (unique) and by class+id (ObjectID repeats
  // across unrelated classes, so we disambiguate with a predicate on the tag).
  const byUid = new Map(), byId = new Map();
  for (const e of doc.getElementsByTagName('*')) {
    const uid = e.getAttribute('ObjectUID'); if (uid) byUid.set(uid, e);
    const oid = e.getAttribute('ObjectID');
    if (oid) { const a = byId.get(oid); if (a) a.push(e); else byId.set(oid, [e]); }
  }
  const derefId = (id, pred) => { const a = id != null && byId.get(id); if (!a) return null; return pred ? (a.find(pred) || null) : a[0]; };
  const ref = (e, tag) => { const k = kid(e, tag); return k ? (k.getAttribute('ObjectRef') || k.getAttribute('ObjectURef')) : null; };

  const kindOf = (tag) => tag.startsWith('Video') ? 'video' : tag.startsWith('Audio') ? 'audio' : 'data';

  // Resolve a master clip to its source media file path (the real filename on
  // disk): MasterClip ▸ Clips ▸ Clip ─▶ {Video,Audio}Clip ▸ Clip ▸ Source ─▶
  // Media ▸ <ActualMediaFilePath>. Graphics / nested-sequence sources have no
  // file path (their Source is a *SequenceSource), so this returns '' for them.
  const mediaPath = (mc) => {
    for (const c of kids(kid(mc, 'Clips'), 'Clip')) {
      const clip = derefId(c.getAttribute('ObjectRef'), (e) => /^(?:Video|Audio)Clip$/.test(e.tagName));
      const src = kid(kid(clip, 'Clip'), 'Source');
      const media = src && derefId(src.getAttribute('ObjectRef'), (e) => e.tagName === 'Media');
      const p = media && (txt(media, 'ActualMediaFilePath') || txt(media, 'FilePath'));
      if (p && /[\\/]|\.\w{2,5}$/.test(p)) return p.replace(/^file:\/+/, '/');   // skip synthetic numeric "paths"
    }
    return '';
  };
  const mediaPaths = new Set(), usedNames = new Set();

  const sequences = [];
  for (const seqEl of doc.getElementsByTagName('Sequence')) {
    if (!seqEl.getAttribute('ObjectUID')) continue;        // skip <Sequence ObjectRef> pointers
    const seq = { name: txt(seqEl, 'Name') || 'Sequence', id: txt(seqEl, 'ID'), w: 0, h: 0, fps: 0, tracks: [] };

    const groups = kids(kid(seqEl, 'TrackGroups'), 'TrackGroup')
      .map((g) => ref(g, 'Second'))
      .map((id) => derefId(id, (e) => /TrackGroup$/.test(e.tagName)))
      .filter(Boolean);

    for (const tg of groups) {
      const kind = kindOf(tg.tagName);
      const inner = kid(tg, 'TrackGroup');
      const tpf = num(txt(inner, 'FrameRate'));            // ticks per frame
      if (kind === 'video' && tpf) seq.fps = seq.fps || TPS / tpf;
      const rect = txt(tg, 'FrameRect').split(',');        // "left,top,right,bottom"
      if (kind === 'video' && rect.length === 4) { seq.w = seq.w || num(rect[2]); seq.h = seq.h || num(rect[3]); }

      const trackEls = kids(kid(inner, 'Tracks'), 'Track')
        .map((t) => t.getAttribute('ObjectURef'))
        .map((uid) => byUid.get(uid))
        .filter(Boolean);

      trackEls.forEach((ct, ti) => {
        const clipTrack = kid(ct, 'ClipTrack');
        const idx = num(txt(kid(clipTrack, 'Track'), 'Index'));
        const itemEls = kids(kid(kid(clipTrack, 'ClipItems'), 'TrackItems'), 'TrackItem')
          .map((t) => t.getAttribute('ObjectRef'))
          .map((id) => derefId(id, (e) => /ClipTrackItem$/.test(e.tagName)))
          .filter(Boolean);

        const clips = [];
        for (const it of itemEls) {
          const cti = kid(it, 'ClipTrackItem');
          const inner2 = kid(cti, 'TrackItem');
          const start = num(txt(inner2, 'Start')) / TPS;
          const end = num(txt(inner2, 'End')) / TPS;
          if (!(end > start) || end - start > MAX_CLIP_S) continue;   // skip empty / sentinel spans
          const sub = derefId(ref(cti, 'SubClip'), (e) => e.tagName === 'SubClip');
          const mc = sub && byUid.get(ref(sub, 'MasterClip'));
          const inst = (sub && txt(sub, 'Name')) || '';               // the instance / placeholder name
          const path = mc ? mediaPath(mc) : '';                       // real source file path, if any
          // The filename to show: the source file's basename, else the master
          // clip's name (which is the imported filename for real footage), else
          // the instance name.
          const file = basename(path) || (mc && txt(mc, 'Name')) || inst || 'Clip';
          if (path) mediaPaths.add(path);
          usedNames.add(file);
          clips.push({ file, path, inst: inst && inst !== file ? inst : '', start, end });
        }
        if (clips.length) seq.tracks.push({ kind, idx: isFinite(idx) ? idx : ti, clips });
      });
    }

    // Drop empty sequences; order tracks like Premiere stacks them: video on top
    // (highest index first), audio beneath (lowest index first).
    if (!seq.tracks.length) continue;
    seq.tracks.sort((a, b) => a.kind !== b.kind
      ? (a.kind === 'video' ? -1 : a.kind === 'data' ? 1 : b.kind === 'video' ? 1 : -1)
      : a.kind === 'video' ? b.idx - a.idx : a.idx - b.idx);
    const vN = {}, aN = {}, dN = {};
    seq.tracks.forEach((t) => {
      const n = (t.kind === 'video' ? vN : t.kind === 'audio' ? aN : dN);
      const c = (n.c = (n.c || 0) + 1);
      t.label = (t.kind === 'video' ? 'V' : t.kind === 'audio' ? 'A' : 'C') + (t.idx + 1 || c);
    });
    seq.dur = Math.max(0.01, ...seq.tracks.flatMap((t) => t.clips.map((c) => c.end)));
    seq.clipCount = seq.tracks.reduce((s, t) => s + t.clips.length, 0);
    sequences.push(seq);
  }

  // Project-level metadata + a referenced-clip list (the AE "footage" analogue).
  const projEl = doc.querySelector('Project[Version]') || doc.querySelector('Project');
  const projVer = projEl && projEl.getAttribute('Version');
  const pd = doc.querySelector('PremiereData');
  const dataVer = pd && pd.getAttribute('Version');
  const mediaItems = doc.getElementsByTagName('ClipProjectItem').length || doc.getElementsByTagName('MasterClip').length;

  return { sequences, projVer, dataVer, mediaItems, clipNames: [...usedNames], mediaPaths: [...mediaPaths] };
}

const fmtTime = (s) => (s >= 60 ? Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0') : s.toFixed(s < 10 ? 2 : 1) + 's');
const fmtTick = (t) => (t >= 60 ? Math.floor(t / 60) + ':' + String(Math.round(t % 60)).padStart(2, '0') : (Number.isInteger(t) ? t + 's' : t.toFixed(1) + 's'));

const LH = 26, TOP = 6, LABEL_W = 150;     // row height, top pad, frozen label column
const COLOR = { video: '#3b82c4', audio: '#3ba776', data: '#7f8896' };

// The frozen left column: one row per track with its name (V1, A1, ...).
function trackLabelsSvg(tracks, H) {
  let s = '';
  tracks.forEach((t, i) => {
    const y = TOP + i * LH;
    s += `<rect x="0" y="${y}" width="${LABEL_W}" height="${LH}" fill="${i % 2 ? 'rgba(128,128,128,.10)' : 'rgba(128,128,128,.04)'}"/>`;
    s += `<rect x="0" y="${y + 5}" width="4" height="${LH - 10}" fill="${COLOR[t.kind]}"/>`;
    s += `<text x="14" y="${y + LH / 2 + 4}" fill="currentColor" font-size="12" font-weight="600" opacity=".85">${esc(t.label)}</text>`;
    s += `<text x="${LABEL_W - 8}" y="${y + LH / 2 + 4}" text-anchor="end" fill="currentColor" font-size="10.5" opacity=".5">${t.clips.length} clip${t.clips.length === 1 ? '' : 's'}</text>`;
  });
  return `<svg viewBox="0 0 ${LABEL_W} ${H}" width="${LABEL_W}" height="${H}" style="display:block">${s}</svg>`;
}

// The scrollable track lane, drawn at a given pixels-per-second (zoom) and width.
function trackLanesSvg(tracks, dur, H, trackW, pps) {
  const x = (t) => Math.max(0, Math.min(dur, t)) * pps;
  const bottom = TOP + tracks.length * LH;
  let stripes = '', grid = '', bars = '';
  tracks.forEach((t, i) => {
    stripes += `<rect x="0" y="${TOP + i * LH}" width="${trackW}" height="${LH}" fill="${i % 2 ? 'rgba(128,128,128,.10)' : 'rgba(128,128,128,.04)'}"/>`;
  });
  const STEPS = [0.25, 0.5, 1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600];
  const step = STEPS.find((s) => s * pps >= 55) || STEPS[STEPS.length - 1];
  for (let t = 0; t <= dur + 1e-6; t += step) {
    const gx = x(t);
    grid += `<line x1="${gx}" y1="${TOP}" x2="${gx}" y2="${bottom}" stroke="currentColor" stroke-width="1" opacity=".12"/>`;
    grid += `<text x="${gx + 3}" y="${bottom + 14}" fill="currentColor" font-size="9.5" opacity=".5">${fmtTick(t)}</text>`;
  }
  tracks.forEach((t, i) => {
    const y = TOP + i * LH, col = COLOR[t.kind];
    t.clips.forEach((c) => {
      const bx = x(c.start), bw = Math.max(2, x(c.end) - x(c.start));
      const tip = c.file + (c.inst ? ' · ' + c.inst : '') + (c.path ? '\n' + c.path : '') + ` · ${fmtTime(c.start)}–${fmtTime(c.end)}`;
      bars += `<rect x="${bx}" y="${y + 4}" width="${bw}" height="${LH - 8}" rx="3" fill="${col}"><title>${esc(tip)}</title></rect>`;
      if (bw > 46) bars += `<text x="${bx + 5}" y="${y + LH / 2 + 4}" fill="#fff" font-size="9.5" opacity=".95" pointer-events="none" clip-path="inset(0 0 0 0)">${esc(c.file.slice(0, Math.max(3, Math.floor(bw / 6.5))))}</text>`;
    });
  });
  return `<svg viewBox="0 0 ${trackW} ${H}" width="${trackW}" height="${H}" style="display:block">${stripes}${grid}${bars}</svg>`;
}

// Build one sequence's card: header + a frozen track-label column beside a
// horizontally zoomable / pannable timeline (ctrl/cmd+wheel to zoom, drag to pan).
function buildSequenceTimeline(seq) {
  const tracks = seq.tracks, dur = seq.dur;
  const H = TOP + tracks.length * LH + 22;
  let zoom = 1;
  const MIN_ZOOM = 1, MAX_ZOOM = 80;

  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, seq.name || 'Sequence'));
  const fps = seq.fps && isFinite(seq.fps) ? (seq.fps % 1 ? seq.fps.toFixed(2) : seq.fps.toFixed(0)) + ' fps' : '';
  const metaLine = [seq.w && seq.h ? `${seq.w} × ${seq.h}` : '', fps, `${dur.toFixed(1)}s`, `${tracks.length} tracks`, `${seq.clipCount} clips`].filter(Boolean).join('  ·  ');
  card.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 8px' }, metaLine));

  // Zoom controls.
  const pct = el('span', { style: 'font-size:12px;opacity:.75;min-width:44px;text-align:center;font-variant-numeric:tabular-nums' }, '100%');
  const zbtn = (t, title) => el('button', { type: 'button', class: 'anr-btn', style: 'padding:1px 9px;min-width:0;line-height:1.4', title }, t);
  const bOut = zbtn('−', 'Zoom out'), bIn = zbtn('+', 'Zoom in'), bReset = zbtn('Reset', 'Reset zoom');
  card.appendChild(el('div', { class: 'anr-btn-row', style: 'gap:6px;align-items:center;margin:0 0 6px;flex-wrap:wrap' }, [
    el('span', { style: 'font-size:12px;opacity:.7' }, 'Zoom'), bOut, pct, bIn, bReset,
    el('span', { class: 'anr-hint', style: 'margin-left:6px' }, 'ctrl/⌘ + scroll to zoom, drag to pan'),
  ]));

  // Layout: frozen labels | scrollable lanes.
  const labels = el('div', { html: trackLabelsSvg(tracks, H), style: `flex:0 0 ${LABEL_W}px;border-right:1px solid var(--hairline)` });
  const lanes = el('div', {});
  const scroller = el('div', { style: 'overflow-x:auto;overflow-y:hidden;flex:1 1 auto;cursor:grab;touch-action:pan-y', class: 'anr-aep-scroller' });
  scroller.appendChild(lanes);
  card.appendChild(el('div', { style: 'display:flex;align-items:flex-start;border:1px solid var(--hairline);border-radius:8px;overflow:hidden' }, [labels, scroller]));

  const basePps = () => Math.max(1, (scroller.clientWidth || 660) - 6) / dur;   // fit whole sequence at zoom 1
  const ppsNow = () => basePps() * zoom;
  function render() {
    const pps = ppsNow();
    const trackW = Math.max(scroller.clientWidth || 660, Math.ceil(dur * pps) + 12);
    lanes.innerHTML = trackLanesSvg(tracks, dur, H, trackW, pps);
    pct.textContent = Math.round(zoom * 100) + '%';
  }
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
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX); }
  }, { passive: false });

  // Drag-to-pan (mouse / pen; touch uses native scrolling).
  let dragging = false, startX = 0, startScroll = 0;
  scroller.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    dragging = true; startX = e.clientX; startScroll = scroller.scrollLeft;
    scroller.style.cursor = 'grabbing';
    try { scroller.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  });
  scroller.addEventListener('pointermove', (e) => { if (dragging) scroller.scrollLeft = startScroll - (e.clientX - startX); });
  const endDrag = (e) => { dragging = false; scroller.style.cursor = 'grab'; try { scroller.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ } };
  scroller.addEventListener('pointerup', endDrag);
  scroller.addEventListener('pointercancel', endDrag);

  // Render once mounted (needs clientWidth) and keep it fitted on resize.
  if (typeof ResizeObserver !== 'undefined') {
    let lastW = -1;
    new ResizeObserver(() => { if (scroller.clientWidth !== lastW) { lastW = scroller.clientWidth; render(); } }).observe(scroller);
  } else {
    requestAnimationFrame(render);
  }
  render();
  return card;
}

export async function renderPremiere(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading "${file.name}"…`));

  let xml;
  try { xml = await inflate(file); } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read this file: ' + (e && e.message)));
    return;
  }
  // Not a PremiereData document we can read - hand off to the generic identifier.
  if (!xml || (!xml.includes('<PremiereData') && !xml.includes('<Project'))) {
    const { renderProprietary } = await import('./proprietary.js');
    return renderProprietary(file, resultsEl);
  }

  let data;
  try { data = parsePremiere(xml); } catch (e) {
    const { renderProprietary } = await import('./proprietary.js');
    return renderProprietary(file, resultsEl);
  }

  resultsEl.innerHTML = '';
  const isPrel = /\.prel$/i.test(file.name);

  // ---- Project metadata ----
  const meta = el('div', { class: 'anr-card' });
  meta.appendChild(el('h3', {}, 'Premiere Pro project'));
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Application', isPrel ? 'Adobe Premiere Elements' : 'Adobe Premiere Pro'));
  tbl.appendChild(rowHelp('Format', isPrel ? 'Premiere Elements project (.prel)' : 'Premiere Pro project (.prproj)',
    'A .prproj is a gzip-compressed XML document (the PremiereData model). Analyser inflates it and walks the sequence, track and clip objects to rebuild each timeline.'));
  if (data.projVer) tbl.appendChild(rowHelp('Project version', data.projVer,
    'The internal Project object version stored in the PremiereData model - it tracks with the Premiere release that last saved the file.'));
  if (data.dataVer) tbl.appendChild(row('Model version', data.dataVer));
  tbl.appendChild(row('Sequences', String(data.sequences.length)));
  if (data.mediaItems) tbl.appendChild(row('Media items', String(data.mediaItems)));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  meta.appendChild(tbl);
  resultsEl.appendChild(meta);

  // ---- Sequences: one timeline card each (busiest first) ----
  const MAX_CARDS = 40;
  const seqs = data.sequences.slice().sort((a, b) => b.clipCount - a.clipCount);
  for (const s of seqs.slice(0, MAX_CARDS)) resultsEl.appendChild(buildSequenceTimeline(s));
  if (seqs.length > MAX_CARDS) {
    resultsEl.appendChild(el('div', { class: 'anr-card' },
      el('p', { class: 'anr-hint', style: 'margin:0' }, `… and ${seqs.length - MAX_CARDS} more sequences not shown.`)));
  }

  // ---- Legend ----
  resultsEl.appendChild(el('div', { class: 'anr-card' }, [
    el('h3', {}, 'Legend'),
    el('p', { class: 'anr-hint', html:
      'Each bar is a clip, positioned by its in and out point on the sequence timeline. '
      + '<span style="color:#3b82c4">Video</span>, '
      + '<span style="color:#3ba776">audio</span>, '
      + '<span style="color:#7f8896">caption / data</span> tracks are stacked as Premiere shows them (V1 at the bottom of the video stack). '
      + 'Each timeline zooms with ctrl/⌘ + scroll (or the zoom buttons) and pans by dragging. '
      + 'Timings are decoded from the file; effects, keyframes and transitions are not drawn.' }),
  ]));

  // ---- Clips referenced on the timelines ----
  if (data.clipNames.length) {
    const card = el('div', { class: 'anr-card' });
    card.appendChild(el('h3', {}, 'Clips & sources (' + data.clipNames.length + ')'));
    const ul = el('ul', { style: 'margin:8px 0 0;padding-left:18px;font-size:13px;word-break:break-word;' });
    data.clipNames.slice(0, 200).forEach((n) => ul.appendChild(el('li', {}, n)));
    if (data.clipNames.length > 200) ul.appendChild(el('li', { class: 'anr-hint' }, '… and ' + (data.clipNames.length - 200) + ' more'));
    card.appendChild(ul);
    if (data.mediaPaths.length) {
      card.appendChild(el('p', { class: 'anr-hint', style: 'margin:12px 0 4px' }, 'Source media paths (' + data.mediaPaths.length + ')'));
      const ul2 = el('ul', { style: 'margin:0;padding-left:18px;font-size:12px;opacity:.8;word-break:break-all;' });
      data.mediaPaths.slice(0, 200).forEach((p) => ul2.appendChild(el('li', {}, p)));
      if (data.mediaPaths.length > 200) ul2.appendChild(el('li', { class: 'anr-hint' }, '… and ' + (data.mediaPaths.length - 200) + ' more'));
      card.appendChild(ul2);
    }
    resultsEl.appendChild(card);
  }

  resultsEl.appendChild(integrityCard(file));
}
