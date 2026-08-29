/* Analyser - DAW project files (Ableton Live .als/.alp, Reaper .rpp/.rpp-bak)

   A DAW project holds no audio. It is an edit decision list: which clip sits on
   which track at which moment, plus the plugins and settings to play it back.
   That makes the arrangement itself the thing worth showing - a picture of the
   session, drawn from the same numbers the DAW uses to lay it out.

   The two formats here are the two that can be read honestly:

   - **Ableton .als** is gzipped XML. Gunzip it and the whole LiveSet is there:
     one element per track, each clip carrying CurrentStart and CurrentEnd in
     BEATS, and the tempo on the master track. Beats, not seconds - so nothing
     can be placed on a real timeline until the tempo is read.
   - **Reaper .rpp** is plain text in a nested block syntax. TRACK blocks contain
     ITEM blocks with POSITION and LENGTH in SECONDS, and a SOURCE block naming
     the media file on disk, which is how a project tells you what it needs that
     it does not contain.

   FL Studio's .flp is deliberately not here. It is a binary event stream where
   an unknown event's length is inferred from its ID range, so a walk that meets
   an event it does not know either guesses or stops - and clip positions live in
   exactly the kind of data event that varies between versions. Its metadata is
   read out instead, by parseFlp() in proprietary.js. */

import { el, row, rowHelp, h3help, errorCard, fmtBytes } from '../core/util.js';
import { gunzip } from '../core/binutil.js';
import { DAW_PROJECT_MAX, DAW_CLIP_MAX } from '../core/limits.js';

interface Clip { name: string; start: number; end: number; }
interface Track { name: string; kind: string; clips: Clip[]; muted: boolean; devices: string[]; }
interface Project {
  app: string; version: string;
  tempo: number|null; sig: string|null;
  tracks: Track[];
  media: string[];
  units: 'seconds'|'beats';
  truncated: boolean;
}

const clean = (s: string|null|undefined) => (s || '').trim();

/* ---- Ableton Live ---- */

// Live nests the name two levels down (<Name><EffectiveName Value="..."/></Name>)
// and the user-visible one is EffectiveName, not the raw Name.
function liveName(track: Element) {
  const eff = track.querySelector(':scope > Name > EffectiveName');
  if (eff) return clean(eff.getAttribute('Value'));
  const nm = track.querySelector(':scope > Name > UserName');
  return clean(nm && nm.getAttribute('Value'));
}
const attrNum = (n: Element|null, a = 'Value') => {
  if (!n) return null;
  const v = parseFloat(n.getAttribute(a) || '');
  return isFinite(v) ? v : null;
};

function parseAls(xml: Document): Project|null {
  const root = xml.documentElement;
  if (!root || root.tagName !== 'Ableton') return null;
  const creator = clean(root.getAttribute('Creator')) || 'Ableton Live';
  const version = clean(root.getAttribute('MinorVersion')) || clean(root.getAttribute('MajorVersion'));

  // Tempo lives on the master track's mixer. Live has renamed that track
  // (MasterTrack, then MainTrack in 12), so match either.
  let tempo: number|null = null;
  for (const sel of ['MasterTrack Tempo Manual', 'MainTrack Tempo Manual', 'Tempo Manual']) {
    tempo = attrNum(xml.querySelector(sel));
    if (tempo) break;
  }
  const sigNum = attrNum(xml.querySelector('TimeSignature TimeSignatureNumerator'))
    || attrNum(xml.querySelector('MasterTrack TimeSignature Numerator'));
  const sigDen = attrNum(xml.querySelector('TimeSignature TimeSignatureDenominator'))
    || attrNum(xml.querySelector('MasterTrack TimeSignature Denominator'));

  const tracks: Track[] = [];
  let clipCount = 0, truncated = false;
  const KINDS: Record<string, string> = {
    MidiTrack: 'MIDI', AudioTrack: 'Audio', GroupTrack: 'Group',
    ReturnTrack: 'Return', MasterTrack: 'Master', MainTrack: 'Main',
  };
  for (const t of xml.querySelectorAll('Tracks > *')) {
    const kind = KINDS[t.tagName];
    if (!kind) continue;
    const clips: Clip[] = [];
    // Arrangement clips only. Session-view clips live under ClipSlotList and have
    // no position on a timeline, so putting them on one would be an invention.
    for (const c of t.querySelectorAll('ArrangerAutomation > Events > MidiClip, ArrangerAutomation > Events > AudioClip')) {
      if (clipCount >= DAW_CLIP_MAX) { truncated = true; break; }
      const start = attrNum(c.querySelector(':scope > CurrentStart'));
      const end = attrNum(c.querySelector(':scope > CurrentEnd'));
      if (start == null || end == null || end <= start) continue;
      clips.push({ name: clean(c.querySelector(':scope > Name')?.getAttribute('Value')), start, end });
      clipCount++;
    }
    const devices: string[] = [];
    for (const d of t.querySelectorAll('DeviceChain Devices > *')) {
      const plug = d.querySelector('PlugName, VstPluginInfo > Name, Vst3PluginInfo > Name');
      const nm = plug ? clean(plug.getAttribute('Value')) : '';
      devices.push(nm || d.tagName);
    }
    tracks.push({
      name: liveName(t) || kind, kind, clips,
      muted: attrNum(t.querySelector('DeviceChain Mixer Speaker Manual')) === 0,
      devices,
    });
    if (truncated) break;
  }

  return {
    app: creator, version,
    tempo, sig: sigNum && sigDen ? sigNum + '/' + sigDen : null,
    tracks, media: [],
    // Live times everything in beats, so a real timeline needs the tempo.
    units: tempo ? 'seconds' : 'beats',
    truncated,
  };
}

/* ---- Reaper ---- */

/* Reaper's project file is a nested block format: a line beginning `<NAME`
   opens a block, a line that is just `>` closes it, and everything else is a
   token line. That is all the structure there is, so a depth counter and a
   stack of block names is enough to read it - no grammar, no escaping beyond
   double-quoted strings. */
function rppTokens(line: string) {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|`([^`]*)`|(\S+)/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
  return out;
}

function parseRpp(text: string): Project|null {
  const lines = text.split(/\r?\n/);
  if (!/^\s*<REAPER_PROJECT\b/.test(lines[0] || '')) return null;

  let version = '', tempo: number|null = null, sig: string|null = null;
  const tracks: Track[] = [];
  const media: string[] = [];
  let cur: Track|null = null, item: Clip|null = null;
  const stack: string[] = [];
  let clipCount = 0, truncated = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line === '>') {
      const closed = stack.pop();
      if (closed === 'ITEM' && cur && item) { cur.clips.push(item); item = null; }
      if (closed === 'TRACK' && cur) { tracks.push(cur); cur = null; }
      continue;
    }
    const tok = rppTokens(line);
    if (line.startsWith('<')) {
      const name = tok[0].slice(1);
      stack.push(name);
      if (name === 'REAPER_PROJECT') version = tok[2] || '';
      else if (name === 'TRACK') cur = { name: '', kind: 'Track', clips: [], muted: false, devices: [] };
      else if (name === 'ITEM' && cur) {
        if (clipCount >= DAW_CLIP_MAX) { truncated = true; item = null; }
        else { item = { name: '', start: 0, end: 0 }; clipCount++; }
      }
      // A plugin block names itself on its opening line:
      //   <VST "VST: Pro-Q 3 (FabFilter)" ProQ3.vst3 0 "" ...
      else if ((name === 'VST' || name === 'CLAP' || name === 'AU' || name === 'JS') && cur && tok[1]) {
        cur.devices.push(tok[1]);
      }
      continue;
    }
    const key = tok[0];
    const inside = stack[stack.length - 1];
    if (key === 'TEMPO' && stack.length <= 1) {
      const t = parseFloat(tok[1]); if (isFinite(t)) tempo = t;
      if (tok[2] && tok[3]) sig = tok[2] + '/' + tok[3];
    } else if (cur && inside === 'TRACK') {
      if (key === 'NAME') cur.name = tok[1] || '';
      else if (key === 'MUTESOLO') cur.muted = tok[1] === '1';
    } else if (item && inside === 'ITEM') {
      if (key === 'POSITION') item.start = parseFloat(tok[1]) || 0;
      else if (key === 'LENGTH') item.end = item.start + (parseFloat(tok[1]) || 0);
      else if (key === 'NAME') item.name = tok[1] || '';
    } else if (key === 'FILE' && tok[1]) {
      media.push(tok[1]);
      if (item) item.name = item.name || (tok[1].split(/[\\/]/).pop() || '');
    }
  }
  if (cur) tracks.push(cur);

  // Item ends are only known once LENGTH has been seen; drop any that never got one.
  for (const t of tracks) t.clips = t.clips.filter((c) => c.end > c.start);
  return {
    app: 'Reaper', version,
    tempo, sig, tracks, media: [...new Set(media)],
    units: 'seconds', truncated,
  };
}

/* ---- Timeline ---- */

// Where a project ends: the last moment anything is playing.
function projectEnd(p: Project) {
  let end = 0;
  for (const t of p.tracks) for (const c of t.clips) if (c.end > end) end = c.end;
  return end;
}

function fmtClock(sec: number) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}

/* Draw the arrangement.

   One row per track, clips positioned as a percentage of the project length, so
   the whole thing reflows with the card and needs no redraw on resize. A zoom
   control widens the inner strip past 100% and the wrapper scrolls, which is how
   you read a dense session without a canvas and its own hit-testing. */
function buildTimeline(p: Project) {
  const end = projectEnd(p);
  const wrap = el('div', { class: 'anr-daw' });
  if (!end) {
    wrap.appendChild(el('p', { class: 'anr-hint' }, 'No positioned clips in this project - nothing to lay out.'));
    return { wrap, controls: null, end };
  }
  // Reaper already stores seconds. Live stores beats, so one factor converts the
  // whole timeline - and without a tempo there is no factor, which is exactly
  // when `units` stays 'beats' and the ruler says so.
  const factor = p.units === 'seconds' && p.tempo && !p.app.includes('Reaper') ? 60 / p.tempo : 1;
  const toSec = (v: number) => v * factor;
  const endSec = toSec(end);

  const scroll = el('div', { class: 'anr-daw-scroll' });
  const strip = el('div', { class: 'anr-daw-strip' });

  // Ruler: a mark roughly every 80px at 100% zoom, on a round number of seconds.
  const ruler = el('div', { class: 'anr-daw-ruler' });
  const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => endSec / s <= 20) || 600;
  for (let t = 0; t <= endSec; t += step) {
    const mark = el('span', { class: 'anr-daw-mark' }, fmtClock(t));
    mark.style.left = (t / endSec * 100) + '%';
    ruler.appendChild(mark);
  }
  strip.appendChild(ruler);

  for (const t of p.tracks) {
    const lane = el('div', { class: 'anr-daw-lane' + (t.muted ? ' is-muted' : '') });
    for (const c of t.clips) {
      const s = toSec(c.start), e = toSec(c.end);
      const block = el('div', { class: 'anr-daw-clip', title: (c.name || 'clip') + ' - ' + fmtClock(s) + ' to ' + fmtClock(e) });
      block.style.left = (s / endSec * 100) + '%';
      block.style.width = Math.max(0.15, (e - s) / endSec * 100) + '%';
      if (c.name) block.appendChild(el('span', { class: 'anr-daw-cliplabel' }, c.name));
      lane.appendChild(block);
    }
    strip.appendChild(lane);
  }
  scroll.appendChild(strip);

  // Track names in a fixed column beside the scrolling strip, so a wide project
  // can be scrubbed without losing track of which lane is which.
  const names = el('div', { class: 'anr-daw-names' });
  names.appendChild(el('div', { class: 'anr-daw-nameruler' }, ''));
  for (const t of p.tracks) {
    names.appendChild(el('div', { class: 'anr-daw-name' + (t.muted ? ' is-muted' : ''), title: t.name }, [
      el('span', { class: 'anr-daw-namekind' }, t.kind === 'Track' ? '' : t.kind),
      el('span', {}, t.name || '(unnamed)'),
    ]));
  }
  wrap.appendChild(names);
  wrap.appendChild(scroll);

  const zoom = el('input', { class: 'anr-range', type: 'range', min: '100', max: '1200', step: '10', value: '100' }) as HTMLInputElement;
  zoom.style.flex = '1';
  zoom.addEventListener('input', () => { strip.style.width = zoom.value + '%'; });
  const controls = el('div', { class: 'anr-daw-controls' }, [
    el('span', { class: 'anr-daw-zoomlabel' }, 'Zoom'), zoom,
    el('span', { class: 'anr-daw-zoomlabel' }, fmtClock(endSec) + ' long'),
  ]);
  return { wrap, controls, end: endSec };
}

export async function renderDaw(file: File, resultsEl: HTMLElement) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';

  if (file.size > DAW_PROJECT_MAX) {
    resultsEl.appendChild(errorCard('This project file is larger than ' + fmtBytes(DAW_PROJECT_MAX) + ', which is far past what a session should be. Not opened.'));
    return;
  }

  let p: Project|null = null;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes[0] === 0x1F && bytes[1] === 0x8B) {
      // Ableton gzips its XML; the extension alone never says so.
      const xmlBytes = await gunzip(bytes);
      if (!xmlBytes) throw new Error('gunzip failed');
      const doc = new DOMParser().parseFromString(new TextDecoder().decode(xmlBytes), 'application/xml');
      if (doc.querySelector('parsererror')) throw new Error('bad xml');
      p = parseAls(doc);
    } else {
      const text = new TextDecoder().decode(bytes);
      if (/^\s*<\?xml/.test(text) && /<Ableton\b/.test(text)) {
        const doc = new DOMParser().parseFromString(text, 'application/xml');
        p = parseAls(doc);
      } else {
        p = parseRpp(text);
      }
    }
  } catch (e) {
    resultsEl.appendChild(errorCard('Could not read this project file.'));
    return;
  }
  if (!p) {
    resultsEl.appendChild(errorCard('This does not look like an Ableton Live set or a Reaper project.'));
    return;
  }

  const clipTotal = p.tracks.reduce((n, t) => n + t.clips.length, 0);
  const timeline = buildTimeline(p);

  // ---- Info ----
  const [h, help] = h3help(p.app.includes('Reaper') ? 'Reaper project' : 'Ableton Live set',
    'A project file contains no audio - it is the arrangement: which clip sits on which track at which moment, and the plugins that play it back. What follows is read from those same numbers.');
  const card = el('div', { class: 'anr-card' });
  card.appendChild(h); card.appendChild(help);
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  tbl.appendChild(row('Created with', p.app + (p.version ? ' ' + p.version : '')));
  if (p.tempo) tbl.appendChild(row('Tempo', (Math.round(p.tempo * 100) / 100) + ' BPM'));
  else tbl.appendChild(rowHelp('Tempo', 'not stated', 'Without a tempo, clip positions can only be given in beats - there is nothing to convert them to seconds with.'));
  if (p.sig) tbl.appendChild(row('Time signature', p.sig));
  tbl.appendChild(row('Tracks', String(p.tracks.length)));
  tbl.appendChild(rowHelp('Clips', clipTotal.toLocaleString() + (p.truncated ? ' (stopped counting here)' : ''),
    'Every positioned clip in the arrangement. Session-view clips in a Live set are not counted: they have no position on a timeline.'));
  if (timeline.end) tbl.appendChild(row('Length', fmtClock(timeline.end) + (p.units === 'beats' ? ' (in beats)' : '')));
  if (p.media.length) tbl.appendChild(rowHelp('Media files referenced', String(p.media.length),
    'A project points at its audio rather than containing it, so these are the files it needs alongside it to open complete.'));
  card.appendChild(tbl);
  resultsEl.appendChild(card);

  // ---- Timeline ----
  {
    const c = el('div', { class: 'anr-card' });
    const [th, thelp] = h3help('Arrangement',
      p.units === 'beats'
        ? 'The arrangement laid out in beats, because this project states no tempo to convert them with.'
        : 'The arrangement laid out on a real clock. Each row is a track and each block a clip, positioned exactly where the project puts it. Hover a clip for its name and times; drag the zoom to open up a busy section.');
    c.appendChild(th); c.appendChild(thelp);
    if (timeline.controls) c.appendChild(timeline.controls);
    c.appendChild(timeline.wrap);
    if (p.truncated) c.appendChild(el('p', { class: 'anr-hint' }, 'Stopped after ' + DAW_CLIP_MAX.toLocaleString() + ' clips; the rest of the project was not read.'));
    resultsEl.appendChild(c);
  }

  // ---- Tracks ----
  {
    const c = el('div', { class: 'anr-card' });
    c.appendChild(el('h3', {}, 'Tracks (' + p.tracks.length + ')'));
    const t = el('table', { class: 'anr-readout' });
    t.appendChild(el('tr', {}, [el('th', {}, 'Track'), el('th', {}, 'Type'), el('th', {}, 'Clips'), el('th', {}, 'Devices')]));
    for (const tr of p.tracks) {
      t.appendChild(el('tr', {}, [
        el('td', {}, (tr.name || '(unnamed)') + (tr.muted ? ' - muted' : '')),
        el('td', {}, tr.kind),
        el('td', {}, String(tr.clips.length)),
        el('td', {}, tr.devices.length ? tr.devices.slice(0, 8).join(', ') + (tr.devices.length > 8 ? ' and ' + (tr.devices.length - 8) + ' more' : '') : '-'),
      ]));
    }
    c.appendChild(t);
    resultsEl.appendChild(c);
  }

  // ---- Media ----
  if (p.media.length) {
    const c = el('div', { class: 'anr-card' });
    const [mh, mhelp] = h3help('Media files (' + p.media.length + ')',
      'The recordings and samples this project plays. They are not inside the file - a project that has been moved without them opens with silent tracks, which is what this list is for checking.');
    c.appendChild(mh); c.appendChild(mhelp);
    const pre = el('pre', { class: 'anr-code anr-pre-scroll-sm' });
    pre.textContent = p.media.slice(0, 500).join('\n');
    c.appendChild(pre);
    resultsEl.appendChild(c);
  }
}
