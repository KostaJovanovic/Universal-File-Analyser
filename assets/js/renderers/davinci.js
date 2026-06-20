/* Analyser - DaVinci Resolve project (.drp / .drt) viewer
   ============================================================================
   A .drp is a ZIP archive of XML documents exported from the Resolve project
   database (DbAppVer / DbPrjVer in a comment at the top of each). The entries we
   care about:

     project.xml                         - project name, versions, dates
     SeqContainer/<uuid>.xml             - the TIMELINE: VideoTrackVec / AudioTrackVec
                                           of Sm2TiTrack, each with Items of
                                           Sm2TiVideoClip / Sm2TiAudioClip
     MediaPool/<bin>/MpFolder.xml        - the media pool bins and their clips
     Gallery.xml                         - colour stills (ignored)

   Each timeline clip carries plain-text fields we can read directly:
     <Name>             the source filename (or "Fusion Title", "Cross Dissolve"…)
     <Start> <Duration> timeline position, in FRAMES
     <In>               source in-point ("frame|hexdouble"; we take the frame)
     <MediaFilePath>    the real source path on disk (empty for titles/generators)
     <MediaFrameRate>   the source frame rate, a little-endian f64 in the first 8
                        hex bytes (e.g. "286b55e2…" -> 29.97)

   Resolve's default timeline start is 01:00:00:00, so the lowest Start divided by
   3600 gives the timeline frame rate (108000 / 3600 = 30). We rebuild each
   timeline - one row per track, each clip a bar positioned by Start/Duration -
   mirroring the Premiere and After Effects viewers, then show the project
   metadata, the media pool bins and the source files the timelines reference.

   There is no public spec; this was reverse-engineered from real .drp files. */

import { el, row, rowHelp, fmtBytes, integrityCard, errorCard, loadScript } from '../core/util.js';

const MAX_ENTRY = 64 * 1024 * 1024;        // cap any single inflated XML we hold
const STD_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];

const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const num = (s) => { const n = Number(s); return isFinite(n) ? n : 0; };
const basename = (p) => (p ? p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1) : '');

// --- tiny DOM helpers (direct-child only - clips nest sibling clips/media refs) ---
const kids = (e, tag) => { const out = []; if (e) for (const c of e.children) if (c.tagName === tag) out.push(c); return out; };
const kid = (e, tag) => { if (e) for (const c of e.children) if (c.tagName === tag) return c; return null; };
const txt = (e, tag) => { const k = kid(e, tag); return k ? k.textContent.trim() : ''; };

// Resolve's XML uses C++-style "::" inside some tag names (ListMgt::LmVersion,
// ListMgt::LmPowerNodeList, …). That is NOT well-formed XML - ":" is the namespace
// separator - so DOMParser('application/xml') rejects the WHOLE document and we'd
// get nothing back (the bug that made .drp fall through to the archive view).
// Rewrite "::" to "__" inside tag names before parsing; we never read those tags,
// and the ones we do read have plain names, so this is lossless for our purposes.
function parseXml(xml) {
  const safe = xml.replace(/<(\/?)([^\s>/!?][^\s>/]*)/g, (m, slash, name) => '<' + slash + name.replace(/::/g, '__'));
  const doc = new DOMParser().parseFromString(safe, 'application/xml');
  return doc.getElementsByTagName('parsererror').length ? null : doc;
}

// MediaFrameRate is the first 8 bytes of the field, a little-endian double.
function hexDouble(h) {
  if (!h || h.length < 16) return 0;
  const b = new DataView(new ArrayBuffer(8));
  for (let i = 0; i < 8; i++) b.setUint8(i, parseInt(h.substr(i * 2, 2), 16));
  const v = b.getFloat64(0, true);
  return isFinite(v) ? v : 0;
}

// ---- ZIP reading (central directory + raw-deflate, all browser-native) ----
async function readZip(file) {
  const size = file.size;
  const tailLen = Math.min(size, 65557);
  const tail = new DataView(await file.slice(size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) { if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('not a ZIP archive');
  const count = tail.getUint16(eocd + 10, true);
  const cdOff = tail.getUint32(eocd + 16, true);
  const cd = new DataView(await file.slice(cdOff).arrayBuffer());
  const td = new TextDecoder();
  const entries = [];
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const method = cd.getUint16(p + 10, true);
    const compSize = cd.getUint32(p + 20, true);
    const uncompSize = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commLen = cd.getUint16(p + 32, true);
    const lho = cd.getUint32(p + 42, true);
    const name = td.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    entries.push({ name, method, compSize, uncompSize, lho });
    p += 46 + nameLen + extraLen + commLen;
  }
  return entries;
}

async function readEntryText(file, e) {
  if (e.uncompSize > MAX_ENTRY) throw new Error('entry too large');
  const lh = new DataView(await file.slice(e.lho, e.lho + 30).arrayBuffer());
  if (lh.getUint32(0, true) !== 0x04034b50) throw new Error('bad local header');
  const nameLen = lh.getUint16(26, true), extraLen = lh.getUint16(28, true);
  const ds = e.lho + 30 + nameLen + extraLen;
  const comp = file.slice(ds, ds + e.compSize);
  if (e.method === 0) return await comp.text();                 // stored
  if (typeof DecompressionStream === 'undefined') throw new Error('DecompressionStream unavailable');
  const stream = comp.stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return await new Response(stream).text();
}

// ---- colour-grade node graph (per-version "Body") ----------------------------
// Each clip's colour-page grade is stored in a <Body> under its active
// ListMgt::LmVersion: a 1-byte tag, then a zstd frame (magic 28 b5 2f fd)
// wrapping a protobuf. Reverse-engineered field map of the decompressed message:
//   1/7         repeated node entry (one per node in the chain)
//   1/7/6         the node's user label  ("CST IN", "LUT", "HSV SAT", "CON"…)
//   1/7/9         a LUT path when the node loads one (…\Look LUTs\Ochre.cube)
//   1/7/10        the ResolveFX / OFX plugin id of any effect on the node
// We harvest every printable length-delimited field generically, then pick those
// paths out - so a missing/renamed field just yields less, never an error.
const LUT_RE = /\.(cube|dctl|3dl|ilut|olut|clf|cdl|dat|look)$/i;
const FX_NAMES = {
  colorspacetransform: 'Color Space Transform', colorspacetransformv2: 'Color Space Transform',
  gamutmapping: 'Gamut Mapping', gamutlimiter: 'Gamut Limiter', filmlooklut: 'Film Look LUT',
  colorstabilizer: 'Color Stabilizer', facerefinement: 'Face Refinement', magicmask: 'Magic Mask',
  lensflare: 'Lens Flare', glow: 'Glow', blur: 'Blur', sharpen: 'Sharpen', filmgrain: 'Film Grain',
  deflicker: 'Deflicker', dehaze: 'Dehaze', warperfx: 'Warper', objectremoval: 'Object Removal',
};
const prettyFx = (id) => FX_NAMES[id] || ('ResolveFX ' + id.replace(/v\d+$/, ''));

function hexToBytes(hex) {
  const n = hex.length >> 1, out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// Generic protobuf walker: collect every printable length-delimited field as
// { path, str }, recursing into the ones that are themselves sub-messages.
function pbStrings(buf, depth, path, out) {
  let p = 0;
  while (p < buf.length) {
    let tag = 0, shift = 0, b;
    do { if (p >= buf.length) return; b = buf[p++]; tag |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    const field = tag >>> 3, wt = tag & 7;
    if (wt === 0) { do { if (p >= buf.length) return; b = buf[p++]; } while (b & 0x80); }
    else if (wt === 5) p += 4;
    else if (wt === 1) p += 8;
    else if (wt === 2) {
      let len = 0; shift = 0;
      do { if (p >= buf.length) return; b = buf[p++]; len |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
      if (len < 0 || p + len > buf.length) return;
      const sub = buf.subarray(p, p + len); p += len;
      let printable = len >= 1 && len <= 240;
      if (printable) for (let i = 0; i < sub.length; i++) { const c = sub[i]; if (!(c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126))) { printable = false; break; } }
      if (printable) out.push({ path: path + '/' + field, str: String.fromCharCode.apply(null, sub) });
      else if (depth < 10) pbStrings(sub, depth + 1, path + '/' + field, out);
    } else return;
  }
}

// Decode one Body hex -> { nodes:[labels], luts:[names], effects:[names] } (or null).
function decodeGrade(hex) {
  let bytes;
  try { bytes = hexToBytes(hex); } catch (_) { return null; }
  let z = -1;
  for (let i = 0; i < Math.min(8, bytes.length - 4); i++) {
    if (bytes[i] === 0x28 && bytes[i + 1] === 0xb5 && bytes[i + 2] === 0x2f && bytes[i + 3] === 0xfd) { z = i; break; }
  }
  if (z < 0 || !(window.fzstd && window.fzstd.decompress)) return null;
  let raw;
  try { raw = window.fzstd.decompress(bytes.subarray(z)); } catch (_) { return null; }
  const found = [];
  try { pbStrings(raw, 0, '', found); } catch (_) {}
  const nodes = [], luts = new Set(), effects = new Set();
  for (const o of found) {
    if (o.path === '/1/7/6') { const t = o.str.trim(); if (t && t.length <= 48) nodes.push(t); }
    if (LUT_RE.test(o.str)) { const clean = o.str.replace(/^[^A-Za-z0-9]+/, '').trim(); if (clean) luts.add(basename(clean) || clean); }
    const fx = o.str.match(/com\.blackmagicdesign\.resolvefx\.([a-z0-9]+)/i);
    if (fx) effects.add(prettyFx(fx[1].toLowerCase()));
  }
  if (!nodes.length && !luts.size && !effects.size) return null;
  return { nodes, luts: [...luts], effects: [...effects] };
}

// Pull the active grade's Body hex (+ version name / corrected flag) from a clip.
function clipGrade(clipEl) {
  const vers = clipEl.getElementsByTagName('ListMgt__LmVersion');
  for (const v of vers) {
    const body = txt(v, 'Body');
    if (body && body.length > 16 && /^[0-9a-f]+$/i.test(body)) {
      return { ver: txt(v, 'Name') || '', corrected: txt(v, 'HasCorrection') === 'true', bodyHex: body };
    }
  }
  return null;
}

// Render an ordered node chain as pill chips joined by arrows.
function nodeChipsHtml(nodes) {
  if (!nodes.length) return '<span class="anr-hint">grade present, no labelled nodes</span>';
  return nodes.map((n, i) => (i ? '<span class="anr-drt-arrow">→</span>' : '')
    + '<span class="anr-drt-node">' + esc(n) + '</span>').join('');
}

// ---- timeline parsing (one SeqContainer XML) ----
function parseTimeline(xml) {
  const doc = parseXml(xml);
  const container = doc && doc.getElementsByTagName('Sm2SequenceContainer')[0];
  if (!container) return null;

  const paths = new Set(), names = new Set();
  let seqId = '';

  function buildTracks(vecTag, kind) {
    const out = [];
    for (const elem of kids(kid(container, vecTag), 'Element')) {
      const trackEl = kid(elem, 'Sm2TiTrack');
      if (!trackEl) continue;
      if (!seqId) seqId = txt(trackEl, 'Sequence');
      const clips = [];
      for (const item of kids(kid(trackEl, 'Items'), 'Element')) {
        const clipEl = kid(item, 'Sm2TiVideoClip') || kid(item, 'Sm2TiAudioClip');
        if (!clipEl) continue;
        const name = txt(clipEl, 'Name') || 'Clip';
        const start = num(txt(clipEl, 'Start'));
        const dur = num(txt(clipEl, 'Duration'));
        if (!(dur > 0)) continue;
        const path = txt(clipEl, 'MediaFilePath');
        const inPt = parseInt(txt(clipEl, 'In'), 10);
        const fps = hexDouble(txt(clipEl, 'MediaFrameRate'));
        // A video-track clip with no source file is a title / generator / transition.
        const gen = kind === 'video' && !path;
        const grade = kind === 'video' ? clipGrade(clipEl) : null;
        clips.push({ name, start, dur, path, inPt: isFinite(inPt) ? inPt : null, fps, gen, grade });
        if (path) paths.add(path);
        names.add(basename(path) || name);
      }
      out.push({ kind, clips });
    }
    return out;
  }

  const videoTracks = buildTracks('VideoTrackVec', 'video');
  const audioTracks = buildTracks('AudioTrackVec', 'audio');
  if (!videoTracks.length && !audioTracks.length) return null;

  // Label like an NLE: V1 is the FIRST video vec entry (bottom of the stack), so
  // stack video high-index-first; audio A1..An top to bottom beneath it.
  videoTracks.forEach((t, i) => { t.label = 'V' + (i + 1); });
  audioTracks.forEach((t, i) => { t.label = 'A' + (i + 1); });
  const tracks = [...videoTracks].reverse().concat(audioTracks);

  const allClips = tracks.flatMap((t) => t.clips);
  if (!allClips.length) return null;
  const startFrame = Math.min(...allClips.map((c) => c.start));
  const endFrame = Math.max(...allClips.map((c) => c.start + c.dur));

  // Default Resolve timeline start is 01:00:00:00, so startFrame/3600 is the fps.
  // Snap to the NEAREST standard rate (108000/3600 = 30, not the first within
  // tolerance, which would wrongly grab 29.97).
  let fps = 30;
  if (startFrame > 0) {
    const f = startFrame / 3600;
    let best = 30, bestD = Infinity;
    for (const s of STD_FPS) { const d = Math.abs(s - f); if (d < bestD) { bestD = d; best = s; } }
    fps = bestD < 0.3 ? best : (Math.abs(Math.round(f) - f) < 0.02 ? Math.round(f) : 30);
  }

  return {
    seqId, tracks, fps, startFrame, durFrames: endFrame - startFrame,
    clipCount: allClips.length, paths: [...paths], names: [...names],
  };
}

// ---- media pool parsing (the bins and their clips) ----
function parseMediaPool(xml) {
  const doc = parseXml(xml);
  const folder = doc && doc.getElementsByTagName('Sm2MpFolder')[0];
  if (!folder) return null;
  const bin = { name: txt(folder, 'Name') || 'Bin', clips: [], timelines: [] };
  const seen = new Set();
  for (const tag of ['Sm2MpVideoClip', 'Sm2MpAudioClip', 'Sm2MpTimelineClip', 'Sm2MpImageClip', 'Sm2MpCompoundClip']) {
    for (const c of doc.getElementsByTagName(tag)) {
      const name = txt(c, 'Name');
      if (!name || seen.has(tag + name)) continue;
      seen.add(tag + name);
      if (tag === 'Sm2MpTimelineClip') {
        const seqEl = c.getElementsByTagName('Sm2Sequence')[0];
        bin.timelines.push({ name, seqId: seqEl ? seqEl.getAttribute('DbId') : '' });
      } else {
        bin.clips.push({ name, kind: tag.includes('Audio') ? 'audio' : 'video' });
      }
    }
  }
  return bin;
}

// ---- timecode + axis formatting ----
function tc(frame, fps) {
  const f = Math.round(fps);
  if (f <= 0) return String(frame);
  const ff = ((frame % f) + f) % f;
  let s = Math.floor(frame / f);
  const hh = Math.floor(s / 3600); s -= hh * 3600;
  const mm = Math.floor(s / 60); const ss = s - mm * 60;
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(hh)}:${p2(mm)}:${p2(ss)}:${p2(ff)}`;
}
const fmtFps = (v) => (v ? (v % 1 ? v.toFixed(2) : v.toFixed(0)) + ' fps' : '');

const LH = 26, TOP = 6, LABEL_W = 132;
const COLOR = { video: '#3b82c4', audio: '#3ba776', gen: '#9b6cc4' };
const colorOf = (t, c) => (c && c.gen ? COLOR.gen : COLOR[t.kind]);

function trackLabelsSvg(tracks, H) {
  let s = '';
  tracks.forEach((t, i) => {
    const y = TOP + i * LH;
    s += `<rect x="0" y="${y}" width="${LABEL_W}" height="${LH}" fill="${i % 2 ? 'rgba(128,128,128,.10)' : 'rgba(128,128,128,.04)'}"/>`;
    s += `<rect x="0" y="${y + 5}" width="4" height="${LH - 10}" fill="${COLOR[t.kind]}"/>`;
    s += `<text x="14" y="${y + LH / 2 + 4}" fill="currentColor" font-size="12" font-weight="600" opacity=".85">${esc(t.label)}</text>`;
    s += `<text x="${LABEL_W - 8}" y="${y + LH / 2 + 4}" text-anchor="end" fill="currentColor" font-size="10.5" opacity=".5">${t.clips.length}</text>`;
  });
  return `<svg viewBox="0 0 ${LABEL_W} ${H}" width="${LABEL_W}" height="${H}" style="display:block">${s}</svg>`;
}

function trackLanesSvg(tl, H, trackW, ppf) {
  const { tracks, startFrame, durFrames, fps } = tl;
  const x = (frame) => (frame - startFrame) * ppf;
  const bottom = TOP + tracks.length * LH;
  let stripes = '', grid = '', bars = '';
  tracks.forEach((t, i) => {
    stripes += `<rect x="0" y="${TOP + i * LH}" width="${trackW}" height="${LH}" fill="${i % 2 ? 'rgba(128,128,128,.10)' : 'rgba(128,128,128,.04)'}"/>`;
  });
  // Grid every "nice" number of seconds, labelled as timecode.
  const STEPS_S = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
  const stepS = STEPS_S.find((s) => s * fps * ppf >= 64) || STEPS_S[STEPS_S.length - 1];
  const stepF = Math.max(1, Math.round(stepS * fps));
  for (let f = 0; f <= durFrames + 1; f += stepF) {
    const gx = f * ppf;
    grid += `<line x1="${gx}" y1="${TOP}" x2="${gx}" y2="${bottom}" stroke="currentColor" stroke-width="1" opacity=".12"/>`;
    grid += `<text x="${gx + 3}" y="${bottom + 14}" fill="currentColor" font-size="9.5" opacity=".5">${tc(startFrame + f, fps)}</text>`;
  }
  tracks.forEach((t, i) => {
    const y = TOP + i * LH;
    t.clips.forEach((c) => {
      const bx = x(c.start), bw = Math.max(2, c.dur * ppf);
      const col = colorOf(t, c);
      const srcTc = c.inPt != null && c.fps ? '\nsrc in ' + tc(c.inPt, c.fps) : '';
      const gi = c.gradeInfo;
      const gradeTip = gi ? '\n' + gi.nodes.length + ' node' + (gi.nodes.length === 1 ? '' : 's')
        + (gi.nodes.length ? ': ' + gi.nodes.join(' → ') : '')
        + (gi.luts.length ? '\nLUT: ' + gi.luts.join(', ') : '')
        + (gi.effects.length ? '\nFX: ' + gi.effects.join(', ') : '') : '';
      const tip = c.name + (c.path ? '\n' + c.path : '') + (c.fps ? '\n' + fmtFps(c.fps) : '')
        + `\n${tc(c.start, fps)} · ${c.dur} frames` + srcTc + gradeTip;
      bars += `<rect x="${bx}" y="${y + 4}" width="${bw}" height="${LH - 8}" rx="3" fill="${col}"><title>${esc(tip)}</title></rect>`;
      // Small amber dot marks a clip that carries a colour grade (node graph).
      if (gi && bw > 10) bars += `<circle cx="${bx + bw - 6}" cy="${y + 9}" r="2.6" fill="#f0a830"><title>${esc((gi.nodes.length || '?') + ' grade nodes')}</title></circle>`;
      if (bw > 42) bars += `<text x="${bx + 5}" y="${y + LH / 2 + 4}" fill="#fff" font-size="9.5" opacity=".95" pointer-events="none">${esc(c.name.slice(0, Math.max(3, Math.floor(bw / 6.5))))}</text>`;
    });
  });
  return `<svg viewBox="0 0 ${trackW} ${H}" width="${trackW}" height="${H}" style="display:block">${stripes}${grid}${bars}</svg>`;
}

function buildTimelineCard(tl, title) {
  const tracks = tl.tracks;
  const H = TOP + tracks.length * LH + 22;
  let zoom = 1;
  const MIN_ZOOM = 1, MAX_ZOOM = 200;

  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, title || 'Timeline'));
  const durS = tl.fps ? tl.durFrames / tl.fps : 0;
  const metaLine = [fmtFps(tl.fps) + (tl.fps ? ' timeline' : ''), durS ? durS.toFixed(1) + 's' : '',
    `${tracks.length} tracks`, `${tl.clipCount} clips`, 'starts ' + tc(tl.startFrame, tl.fps)].filter(Boolean).join('  ·  ');
  card.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 8px' }, metaLine));

  const pct = el('span', { style: 'font-size:12px;opacity:.75;min-width:44px;text-align:center;font-variant-numeric:tabular-nums' }, '100%');
  const zbtn = (t, title) => el('button', { type: 'button', class: 'anr-btn', style: 'padding:1px 9px;min-width:0;line-height:1.4', title }, t);
  const bOut = zbtn('−', 'Zoom out'), bIn = zbtn('+', 'Zoom in'), bReset = zbtn('Reset', 'Reset zoom');
  card.appendChild(el('div', { class: 'anr-btn-row', style: 'gap:6px;align-items:center;margin:0 0 6px;flex-wrap:wrap' }, [
    el('span', { style: 'font-size:12px;opacity:.7' }, 'Zoom'), bOut, pct, bIn, bReset,
    el('span', { class: 'anr-hint', style: 'margin-left:6px' }, 'ctrl/⌘ + scroll to zoom, drag to pan'),
  ]));

  const labels = el('div', { html: trackLabelsSvg(tracks, H), style: `flex:0 0 ${LABEL_W}px;border-right:1px solid var(--hairline)` });
  const lanes = el('div', {});
  const scroller = el('div', { style: 'overflow-x:auto;overflow-y:hidden;flex:1 1 auto;cursor:grab;touch-action:pan-y', class: 'anr-aep-scroller' });
  scroller.appendChild(lanes);
  card.appendChild(el('div', { style: 'display:flex;align-items:flex-start;border:1px solid var(--hairline);border-radius:8px;overflow:hidden' }, [labels, scroller]));

  const basePpf = () => Math.max(0.0005, (scroller.clientWidth || 660) - 6) / Math.max(1, tl.durFrames);
  const ppfNow = () => basePpf() * zoom;
  function render() {
    const ppf = ppfNow();
    const trackW = Math.max(scroller.clientWidth || 660, Math.ceil(tl.durFrames * ppf) + 12);
    lanes.innerHTML = trackLanesSvg(tl, H, trackW, ppf);
    pct.textContent = Math.round(zoom * 100) + '%';
  }
  function setZoom(z, anchorClientX) {
    const oldPpf = ppfNow();
    const rect = scroller.getBoundingClientRect();
    const anchorPx = (anchorClientX != null ? anchorClientX - rect.left : rect.width / 2) + scroller.scrollLeft;
    const fAnchor = anchorPx / oldPpf;
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    render();
    const off = anchorClientX != null ? anchorClientX - rect.left : rect.width / 2;
    scroller.scrollLeft = fAnchor * ppfNow() - off;
  }
  bIn.onclick = () => setZoom(zoom * 1.5);
  bOut.onclick = () => setZoom(zoom / 1.5);
  bReset.onclick = () => { zoom = 1; render(); scroller.scrollLeft = 0; };

  scroller.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX); }
  }, { passive: false });

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

  if (typeof ResizeObserver !== 'undefined') {
    let lastW = -1;
    new ResizeObserver(() => { if (scroller.clientWidth !== lastW) { lastW = scroller.clientWidth; render(); } }).observe(scroller);
  }
  render();
  return card;
}

// ---- project.xml metadata ----
function parseProject(xml) {
  const m = {};
  const doc = parseXml(xml);
  const proj = doc && doc.getElementsByTagName('SM_Project')[0];
  m.name = proj ? txt(proj, 'ProjectName') : '';
  const ver = xml.match(/DbAppVer="([^"]*)"/);
  const dbVer = xml.match(/DbPrjVer="([^"]*)"/);
  m.appVer = ver ? ver[1] : '';
  m.dbVer = dbVer ? dbVer[1] : '';
  const modSecs = proj && num(txt(proj, 'LastModTimeInSecs'));
  m.modified = modSecs ? new Date(modSecs * 1000) : null;
  const ageMs = proj && num(txt(proj, 'ProjectAgeInMs'));
  m.ageMs = ageMs || 0;
  return m;
}

export async function renderDavinci(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading "${file.name}"…`));

  let entries;
  try { entries = await readZip(file); } catch (e) {
    resultsEl.innerHTML = '';
    const { renderProprietary } = await import('./proprietary.js');
    return renderProprietary(file, resultsEl);
  }
  const get = (name) => entries.find((e) => e.name === name);
  const byPrefix = (pre, suf) => entries.filter((e) => e.name.startsWith(pre) && e.name.endsWith(suf));

  // Parse the pieces (best-effort; any one failing shouldn't sink the rest).
  let project = {};
  try { const pe = get('project.xml'); if (pe) project = parseProject(await readEntryText(file, pe)); } catch (_) {}

  const mediaPool = [];
  for (const e of byPrefix('MediaPool/', 'MpFolder.xml')) {
    try { const bin = parseMediaPool(await readEntryText(file, e)); if (bin && (bin.clips.length || bin.timelines.length)) mediaPool.push(bin); } catch (_) {}
  }
  const tlNameBySeq = new Map();
  for (const bin of mediaPool) for (const t of bin.timelines) if (t.seqId) tlNameBySeq.set(t.seqId, t.name);

  const timelines = [];
  for (const e of byPrefix('SeqContainer/', '.xml')) {
    try { const tl = parseTimeline(await readEntryText(file, e)); if (tl) timelines.push(tl); } catch (_) {}
  }

  if (!timelines.length && !mediaPool.length && !project.name) {
    resultsEl.innerHTML = '';
    const { renderProprietary } = await import('./proprietary.js');
    return renderProprietary(file, resultsEl);
  }

  // Decode each graded clip's colour-page node graph (lazy zstd via fzstd).
  // Best-effort: if fzstd won't load or a Body won't decode, the clip just
  // shows no grade info - the rest of the view is unaffected.
  const gradedClips = [];
  for (const tl of timelines) for (const t of tl.tracks) for (const c of t.clips) if (c.grade) gradedClips.push(c);
  if (gradedClips.length) {
    try {
      if (!(window.fzstd && window.fzstd.decompress)) await loadScript('assets/vendor/fzstd.js');
      for (const c of gradedClips) { const g = decodeGrade(c.grade.bodyHex); if (g) c.gradeInfo = g; }
    } catch (_) { /* fzstd unavailable - skip grades */ }
  }

  resultsEl.innerHTML = '';

  // ---- Project metadata ----
  const isDrt = /\.drt$/i.test(file.name);
  const meta = el('div', { class: 'anr-card' });
  meta.appendChild(el('h3', {}, 'DaVinci Resolve project'));
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Application', 'Blackmagic DaVinci Resolve'));
  tbl.appendChild(rowHelp('Format', isDrt ? 'Resolve timeline (.drt)' : 'Resolve project (.drp)',
    'A .drp is a ZIP of XML documents exported from the Resolve project database. Analyser inflates it and walks the SeqContainer track/clip objects to rebuild each timeline.'));
  if (project.name) tbl.appendChild(row('Project name', project.name));
  if (project.appVer) tbl.appendChild(rowHelp('Resolve version', project.appVer,
    'The DaVinci Resolve build (DbAppVer) that last wrote this project.'));
  if (project.dbVer) tbl.appendChild(rowHelp('Database version', project.dbVer, 'The internal Resolve project-database schema version (DbPrjVer).'));
  if (project.modified && !isNaN(project.modified)) tbl.appendChild(row('Last modified', project.modified.toLocaleString()));
  if (project.ageMs > 0) tbl.appendChild(rowHelp('Project age', (project.ageMs / 86400000).toFixed(1) + ' days',
    'Total time the project has existed, accumulated by Resolve (ProjectAgeInMs).'));
  tbl.appendChild(row('Timelines', String(timelines.length)));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  meta.appendChild(tbl);
  resultsEl.appendChild(meta);

  // ---- Timelines: busiest first ----
  const sorted = timelines.slice().sort((a, b) => b.clipCount - a.clipCount);
  sorted.forEach((tl, i) => resultsEl.appendChild(buildTimelineCard(tl, tlNameBySeq.get(tl.seqId) || (timelines.length > 1 ? 'Timeline ' + (i + 1) : 'Timeline'))));

  // ---- Colour grades & nodes ----
  const graded = [];
  for (const tl of timelines) for (const t of tl.tracks) for (const c of t.clips) if (c.gradeInfo) graded.push(c);
  if (graded.length) {
    const totalVideo = timelines.reduce((s, tl) =>
      s + tl.tracks.reduce((a, t) => a + (t.kind === 'video' ? t.clips.length : 0), 0), 0);
    const card = el('div', { class: 'anr-card' });
    card.appendChild(el('h3', {}, 'Colour grades & nodes'));
    card.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 12px' },
      graded.length + ' of ' + totalVideo + ' video clips carry a colour grade. The node chain is read straight from the Color page graph stored (zstd-compressed) in each clip’s grade version.'));

    // Distinct node chains, busiest first.
    const chains = new Map();
    for (const c of graded) {
      const key = c.gradeInfo.nodes.join('');
      const e = chains.get(key) || { n: 0, nodes: c.gradeInfo.nodes };
      e.n++; chains.set(key, e);
    }
    [...chains.values()].sort((a, b) => b.n - a.n).slice(0, 12).forEach((ch) => {
      card.appendChild(el('div', { style: 'margin:0 0 9px' }, [
        el('div', { style: 'font-size:12px;opacity:.6;margin-bottom:3px' },
          '×' + ch.n + ' clip' + (ch.n === 1 ? '' : 's') + '  ·  ' + ch.nodes.length + ' node' + (ch.nodes.length === 1 ? '' : 's')),
        el('div', { class: 'anr-drt-nodes', html: nodeChipsHtml(ch.nodes) }),
      ]));
    });

    // LUTs + ResolveFX used across all grades.
    const luts = new Set(), fx = new Set();
    for (const c of graded) { c.gradeInfo.luts.forEach((l) => luts.add(l)); c.gradeInfo.effects.forEach((e) => fx.add(e)); }
    if (luts.size || fx.size) {
      const tbl2 = el('table', { class: 'anr-readout', style: 'margin-top:6px' });
      if (fx.size) tbl2.appendChild(rowHelp('ResolveFX', [...fx].join(', '), 'Blackmagic ResolveFX / OFX plugins applied on grade nodes.'));
      if (luts.size) tbl2.appendChild(rowHelp('LUTs', [...luts].join(', '), 'Look-up tables loaded by LUT nodes in the grade.'));
      card.appendChild(tbl2);
    }
    resultsEl.appendChild(card);
  }

  // ---- Legend ----
  if (timelines.length) {
    resultsEl.appendChild(el('div', { class: 'anr-card' }, [
      el('h3', {}, 'Legend'),
      el('p', { class: 'anr-hint', html:
        'Each bar is a clip, positioned by its Start and Duration (in frames) on the timeline. '
        + '<span style="color:#3b82c4">Video</span>, '
        + '<span style="color:#3ba776">audio</span> and '
        + '<span style="color:#9b6cc4">titles / generators / transitions</span> tracks are stacked as Resolve shows them (V1 at the bottom of the video stack). '
        + 'Hover a clip for its source path, frame rate and timecode. Each timeline zooms with ctrl/⌘ + scroll (or the buttons) and pans by dragging. '
        + 'The timeline frame rate is inferred from the 01:00:00:00 start. An <span style="color:#f0a830">amber dot</span> marks a clip that carries a colour grade - hover it for the node chain, or see the Colour grades card below. Fusion comps are not drawn.' }),
    ]));
  }

  // ---- Media pool bins ----
  if (mediaPool.length) {
    const card = el('div', { class: 'anr-card' });
    const total = mediaPool.reduce((s, b) => s + b.clips.length, 0);
    card.appendChild(el('h3', {}, 'Media pool (' + total + ' clips)'));
    for (const bin of mediaPool) {
      if (!bin.clips.length && !bin.timelines.length) continue;
      card.appendChild(el('p', { style: 'margin:10px 0 2px;font-weight:600;font-size:13px' },
        `${bin.name}  (${bin.clips.length})`));
      const ul = el('ul', { style: 'margin:0;padding-left:18px;font-size:13px;word-break:break-word;' });
      [...bin.timelines.map((t) => '◫ ' + t.name), ...bin.clips.map((c) => c.name)].slice(0, 120)
        .forEach((n) => ul.appendChild(el('li', {}, n)));
      card.appendChild(ul);
    }
    resultsEl.appendChild(card);
  }

  // ---- Source media paths referenced by the timelines ----
  const allPaths = [...new Set(timelines.flatMap((t) => t.paths))];
  if (allPaths.length) {
    const card = el('div', { class: 'anr-card' });
    card.appendChild(el('h3', {}, 'Source media (' + allPaths.length + ')'));
    const ul = el('ul', { style: 'margin:8px 0 0;padding-left:18px;font-size:12px;opacity:.85;word-break:break-all;' });
    allPaths.slice(0, 250).forEach((p) => ul.appendChild(el('li', {}, p)));
    if (allPaths.length > 250) ul.appendChild(el('li', { class: 'anr-hint' }, '… and ' + (allPaths.length - 250) + ' more'));
    card.appendChild(ul);
    resultsEl.appendChild(card);
  }

  resultsEl.appendChild(integrityCard(file));
}
