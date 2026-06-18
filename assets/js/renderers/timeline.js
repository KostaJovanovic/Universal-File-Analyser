/* Analyser - editing-timeline viewer
   Renders a visual timeline (tracks × time, with clip blocks) from the standard
   NLE interchange formats every editor (Premiere, Final Cut, DaVinci Resolve,
   Avid) can export:
     - EDL  (.edl)    CMX3600 edit decision list (plain text)
     - FCPXML (.fcpxml) Final Cut Pro X XML
     - OTIO (.otio)   OpenTimelineIO (JSON)
   The normalised model is:
     { name, fps, duration, tracks: [ { kind, name, clips: [ {name, start, duration, srcIn} ] } ] }
   with every time value in seconds. */

import { el, row, rowHelp, fmtBytes, sha256Row, errorCard } from '../core/util.js';

// ---------- shared helpers ----------

function tcToFrames(tc) {
  // HH:MM:SS:FF or HH:MM:SS;FF (drop-frame). Returns total frames given the fps
  // applied by the caller; here we return [h,m,s,f].
  const m = /^(\d{1,2}):(\d{2}):(\d{2})[:;](\d{2,3})$/.exec(tc.trim());
  if (!m) return null;
  return { h: +m[1], mm: +m[2], s: +m[3], f: +m[4] };
}
function tcToSeconds(tc, fps) {
  const p = tcToFrames(tc);
  if (!p) return null;
  return p.h * 3600 + p.mm * 60 + p.s + p.f / (fps || 25);
}
function secToTc(t, fps) {
  fps = Math.round(fps || 25);
  if (!isFinite(t) || t < 0) t = 0;
  const ts = Math.floor(t);
  const f = Math.min(fps - 1, Math.round((t - ts) * fps));
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(ts / 3600))}:${pad(Math.floor((ts % 3600) / 60))}:${pad(ts % 60)}:${pad(f)}`;
}
// Parse OTIO / FCPXML rational time like "120/24s", "0s", or a plain number.
function rationalSeconds(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const s = String(v).trim().replace(/s$/, '');
  if (s.indexOf('/') !== -1) { const [a, b] = s.split('/').map(Number); return b ? a / b : 0; }
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

// ---------- EDL (CMX3600) ----------
function parseEdl(text, fpsHint) {
  const lines = text.split(/\r?\n/);
  let fps = fpsHint || 25;
  let title = '';
  let dropFrame = false;
  // Event line: NNN  REEL  CHAN  TRANS  srcIn srcOut recIn recOut
  const evRe = /^(\d{1,4})\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+\S+)?\s+(\d{1,2}:\d{2}:\d{2}[:;]\d{2,3})\s+(\d{1,2}:\d{2}:\d{2}[:;]\d{2,3})\s+(\d{1,2}:\d{2}:\d{2}[:;]\d{2,3})\s+(\d{1,2}:\d{2}:\d{2}[:;]\d{2,3})/;
  const events = [];
  let pending = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^TITLE:/i.test(line)) { title = line.replace(/^TITLE:\s*/i, '').trim(); continue; }
    if (/DROP\s*FRAME/i.test(line) && !/NON-?DROP/i.test(line)) dropFrame = true;
    const cm = /^\*\s*(?:FROM\s+)?CLIP\s+NAME:\s*(.+)$/i.exec(line);
    if (cm && pending) { pending.name = cm[1].trim(); continue; }
    const m = evRe.exec(line);
    if (m) {
      const chan = m[3].toUpperCase();
      const ev = {
        reel: m[2],
        chan,
        kind: chan[0] === 'A' ? 'audio' : 'video',
        srcIn: m[5], srcOut: m[6], recIn: m[7], recOut: m[8],
        name: m[2] && m[2] !== 'AX' ? m[2] : ''
      };
      events.push(ev);
      pending = ev;
    }
  }
  if (!events.length) return null;
  // Group events into tracks by channel; position by record in/out.
  const trackMap = new Map();
  let maxEnd = 0;
  for (const ev of events) {
    const start = tcToSeconds(ev.recIn, fps);
    const end = tcToSeconds(ev.recOut, fps);
    if (start == null || end == null) continue;
    maxEnd = Math.max(maxEnd, end);
    const key = ev.chan;
    if (!trackMap.has(key)) trackMap.set(key, { kind: ev.kind, name: ev.chan, clips: [] });
    trackMap.get(key).clips.push({ name: ev.name || ev.reel || 'clip', start, duration: Math.max(0, end - start), srcIn: ev.srcIn });
  }
  // Order tracks: video channels first (V, then numbered), then audio.
  const tracks = [...trackMap.values()].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'video' ? -1 : 1));
  return { name: title || 'EDL sequence', fps, dropFrame, duration: maxEnd, tracks, format: 'EDL (CMX3600)' };
}

// ---------- OTIO (OpenTimelineIO JSON) ----------
function parseOtio(json) {
  const tl = (json && json.OTIO_SCHEMA && /^Timeline/.test(json.OTIO_SCHEMA)) ? json : null;
  if (!tl || !tl.tracks) return null;
  const stack = tl.tracks;
  let fps = 24, duration = 0;
  const tracks = [];
  for (const trk of (stack.children || [])) {
    if (!/^Track/.test(trk.OTIO_SCHEMA || '')) continue;
    const kind = (trk.kind || 'Video').toLowerCase() === 'audio' ? 'audio' : 'video';
    const clips = [];
    let playhead = 0;
    for (const child of (trk.children || [])) {
      const sr = child.source_range;
      // duration.value is in frames at duration.rate; convert to seconds.
      const durSec = sr && sr.duration ? (sr.duration.value || 0) / (sr.duration.rate || 24) : 0;
      if (sr && sr.duration && sr.duration.rate) fps = sr.duration.rate;
      if (/^Clip/.test(child.OTIO_SCHEMA || '')) {
        clips.push({ name: child.name || 'clip', start: playhead, duration: durSec });
      }
      playhead += durSec;   // gaps advance the playhead too
    }
    duration = Math.max(duration, playhead);
    tracks.push({ kind, name: trk.name || (kind === 'audio' ? 'A' : 'V'), clips });
  }
  if (!tracks.length) return null;
  return { name: tl.name || 'OTIO timeline', fps, duration, tracks, format: 'OpenTimelineIO' };
}

// ---------- FCPXML (Final Cut Pro X) ----------
function parseFcpxml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return null;
  // Frame rate from the first <format frameDuration="1/24s">.
  let fps = 24;
  const fmt = doc.getElementsByTagName('format')[0];
  if (fmt) { const fd = fmt.getAttribute('frameDuration'); const s = rationalSeconds(fd); if (s > 0) fps = Math.round(1 / s); }
  const spine = doc.getElementsByTagName('spine')[0];
  if (!spine) return null;
  const seqEl = doc.getElementsByTagName('sequence')[0];
  const name = (doc.getElementsByTagName('project')[0] || {}).getAttribute ? doc.getElementsByTagName('project')[0].getAttribute('name') : '';

  // Clip-like elements carry offset + duration; lane groups them onto tracks
  // (lane 0 = primary storyline, +n above, -n below / audio).
  const CLIP_TAGS = new Set(['asset-clip', 'clip', 'video', 'audio', 'title', 'gap', 'mc-clip', 'ref-clip', 'sync-clip']);
  const laneTracks = new Map();
  let duration = 0;
  for (const node of Array.from(spine.children)) {
    const tag = node.tagName;
    if (!CLIP_TAGS.has(tag)) continue;
    const offset = rationalSeconds(node.getAttribute('offset'));
    const dur = rationalSeconds(node.getAttribute('duration'));
    duration = Math.max(duration, offset + dur);
    const lane = parseInt(node.getAttribute('lane') || '0', 10) || 0;
    if (tag !== 'gap') {
      if (!laneTracks.has(lane)) laneTracks.set(lane, []);
      laneTracks.get(lane).push({ name: node.getAttribute('name') || tag, start: offset, duration: dur, lane });
    }
    // Connected clips nested inside also carry their own lane/offset.
    for (const sub of Array.from(node.children)) {
      if (!CLIP_TAGS.has(sub.tagName) || sub.tagName === 'gap') continue;
      const subLane = parseInt(sub.getAttribute('lane') || '0', 10) || 0;
      if (subLane === 0) continue;
      const subOff = offset + rationalSeconds(sub.getAttribute('offset'));
      const subDur = rationalSeconds(sub.getAttribute('duration'));
      duration = Math.max(duration, subOff + subDur);
      if (!laneTracks.has(subLane)) laneTracks.set(subLane, []);
      laneTracks.get(subLane).push({ name: sub.getAttribute('name') || sub.tagName, start: subOff, duration: subDur, lane: subLane });
    }
  }
  if (!laneTracks.size) return null;
  // Lanes high→low so upper video lanes render on top.
  const lanes = [...laneTracks.keys()].sort((a, b) => b - a);
  const tracks = lanes.map((lane) => ({
    kind: lane < 0 ? 'audio' : 'video',
    name: lane === 0 ? 'V1' : (lane > 0 ? 'V' + (lane + 1) : 'A' + (-lane)),
    clips: laneTracks.get(lane)
  }));
  return { name: name || 'FCPXML timeline', fps, duration, tracks, format: 'FCPXML (Final Cut Pro X)' };
}

// ---------- visual renderer ----------
const TICK_TARGET = 8;   // aim for ~8 ruler ticks
function niceStep(span) {
  const raw = span / TICK_TARGET;
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  for (const s of steps) if (s >= raw) return s;
  return 3600;
}

function buildTimelineCard(model) {
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Timeline'));

  const dur = model.duration || 1;
  const ruler = el('div', { class: 'anr-tl-ruler' });
  const step = niceStep(dur);
  for (let t = 0; t <= dur + 0.001; t += step) {
    const tick = el('span', { class: 'anr-tl-tick', style: `left:${(t / dur) * 100}%;` }, secToTc(t, model.fps).slice(0, 8));
    ruler.appendChild(tick);
  }

  const rows = el('div', { class: 'anr-tl-rows' });
  for (const track of model.tracks) {
    const rowEl = el('div', { class: 'anr-tl-row' });
    rowEl.appendChild(el('span', { class: 'anr-tl-rowlabel' }, track.name));
    const lane = el('div', { class: 'anr-tl-lane' });
    for (const clip of track.clips) {
      const left = (clip.start / dur) * 100;
      const width = Math.max(0.4, (clip.duration / dur) * 100);
      const block = el('div', {
        class: 'anr-tl-clip ' + (track.kind === 'audio' ? 'is-audio' : 'is-video'),
        style: `left:${left}%; width:${width}%;`,
        title: `${clip.name}\n${secToTc(clip.start, model.fps)} → ${secToTc(clip.start + clip.duration, model.fps)}  (${clip.duration.toFixed(2)}s)`
      }, el('span', { class: 'anr-tl-cliplabel' }, clip.name));
      lane.appendChild(block);
    }
    rowEl.appendChild(lane);
    rows.appendChild(rowEl);
  }

  const scroll = el('div', { class: 'anr-tl-scroll' }, [ruler, rows]);
  card.appendChild(scroll);
  card.appendChild(el('p', { class: 'anr-hint', style: 'margin-top:10px;' },
    `${model.tracks.length} track${model.tracks.length === 1 ? '' : 's'} · ${model.tracks.reduce((n, t) => n + t.clips.length, 0)} clips · ${secToTc(dur, model.fps)} · hover a clip for its name and timecode`));
  return card;
}

function infoCard(file, model) {
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Sequence'));
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Format', model.format));
  tbl.appendChild(row('Name', model.name));
  tbl.appendChild(row('Duration', secToTc(model.duration, model.fps) + `  (${model.duration.toFixed(2)} s)`));
  if (model.fps) tbl.appendChild(row('Frame rate', (model.dropFrame ? 'assumed ' : '') + model.fps + ' fps' + (model.dropFrame ? ' (drop-frame)' : '')));
  tbl.appendChild(row('Tracks', String(model.tracks.length)));
  tbl.appendChild(row('Clips', String(model.tracks.reduce((n, t) => n + t.clips.length, 0))));
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  tbl.appendChild(sha256Row(file));
  card.appendChild(tbl);
  return card;
}

export async function renderTimeline(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading timeline "${file.name}"…`));
  const ext = (file.name.split('.').pop() || '').toLowerCase();

  let model = null;
  try {
    if (ext === 'otio') { model = parseOtio(JSON.parse(await file.text())); }
    else if (ext === 'fcpxml') { model = parseFcpxml(await file.text()); }
    else { model = parseEdl(await file.text()); }   // edl
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read timeline: ' + (e && e.message ? e.message : e)));
    return;
  }

  resultsEl.innerHTML = '';
  if (!model || !model.tracks.length) {
    resultsEl.appendChild(errorCard('No timeline data found in this file.'));
    return;
  }
  resultsEl.appendChild(infoCard(file, model));
  resultsEl.appendChild(buildTimelineCard(model));
}
