/* Analyser - subtitle files (SRT / WebVTT / ASS / SSA / MicroDVD / SubViewer)
   Parses cues into a timed list and reports counts, timing, and styling info.
   Pure text parsing, no dependencies. The .sub extension is overloaded - it
   carries text (MicroDVD frame-based or SubViewer time-based) as well as the
   binary VobSub bitmap format, so we sniff which one a .sub actually is. */

import { el, row, rowHelp, h3help, errorCard, fmtBytes } from '../core/util.js';

function fmtTime(sec: number|null) {
  if (sec == null || !isFinite(sec)) return '-';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const ss = s.toFixed(2).padStart(5, '0');
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + ss;
}

// Parse "HH:MM:SS,mmm" / "HH:MM:SS.mmm" / "MM:SS.mmm" / "H:MM:SS.cc" -> seconds.
function parseTime(t: string) {
  t = t.trim().replace(',', '.');
  const parts = t.split(':');
  if (!parts.length) return null;
  let s = 0;
  for (const p of parts) s = s * 60 + parseFloat(p);
  return isFinite(s) ? s : null;
}

function parseSrtVtt(text: string, isVtt: boolean) {
  const cues = [];
  // Split on blank lines into blocks.
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/);
  const TIME = /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})/;
  for (let block of blocks) {
    const lines = block.split('\n').filter((l: string|any[]) => l.length);
    if (!lines.length) continue;
    if (isVtt && /^WEBVTT/.test(lines[0])) continue;
    if (/^(NOTE|STYLE|REGION)\b/.test(lines[0])) continue;   // VTT metadata blocks
    // Find the timing line (may be preceded by an index / cue id line).
    let ti = lines.findIndex((l: string) => TIME.test(l));
    if (ti < 0) continue;
    const m = lines[ti].match(TIME);
    const start = parseTime(m![1]), end = parseTime(m![2]);
    const txt = lines.slice(ti + 1).join('\n')
      .replace(/<[^>]+>/g, '')      // strip VTT/HTML tags
      .trim();
    if (start != null) cues.push({ start, end, text: txt });
  }
  return cues;
}

function parseAss(text: string) {
  const cues = [];
  const styleDefs = [];   // each [V4(+) Styles] "Style:" line, as a field object
  const info: any = {};        // [Script Info] keys (PlayResX/Y, ScriptType, ...)
  const lines = text.replace(/\r/g, '').split('\n');
  let dlgFmt = null, styleFmt = null, section = '';
  const DEFAULT_STYLE_COLS = ['name', 'fontname', 'fontsize', 'primarycolour', 'secondarycolour', 'outlinecolour', 'backcolour', 'bold', 'italic', 'underline', 'strikeout', 'scalex', 'scaley', 'spacing', 'angle', 'borderstyle', 'outline', 'shadow', 'alignment', 'marginl', 'marginr', 'marginv', 'encoding'];
  for (const line of lines) {
    const sm = /^\s*\[(.+?)\]\s*$/.exec(line);
    if (sm) { section = sm[1].toLowerCase(); continue; }
    if (section.includes('script info') && /^[a-z][\w ]*:/i.test(line)) {
      const i = line.indexOf(':');
      info[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    if (/^Format:/i.test(line)) {
      const cols = line.replace(/^Format:\s*/i, '').split(',').map((s: string) => s.trim().toLowerCase());
      if (section.includes('style')) styleFmt = cols;
      else if (section.includes('event') || (/start/i.test(line) && /text/i.test(line))) dlgFmt = cols;
      continue;
    }
    if (/^Style:/i.test(line)) {
      const cols = styleFmt || DEFAULT_STYLE_COLS;
      const vals = line.replace(/^Style:\s*/i, '').split(',');
      const o: any = {};
      cols.forEach((c: string, i: number) => { o[c] = vals[i] != null ? vals[i].trim() : ''; });
      styleDefs.push(o);
    }
    if (/^Dialogue:/i.test(line)) {
      const rest = line.replace(/^Dialogue:\s*/i, '');
      // Split into the fixed fields; Text is the last field (may contain commas).
      const cols = dlgFmt || ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
      const n = cols.length;
      const parts = rest.split(',');
      const head = parts.slice(0, n - 1);
      const txt = parts.slice(n - 1).join(',');
      const obj: any = {};
      cols.forEach((c: string|number, i: number) => { obj[c] = i < n - 1 ? head[i] : txt; });
      const start = parseTime(obj.start || ''), end = parseTime(obj.end || '');
      const clean = (obj.text || '').replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').trim();
      // A per-line margin of 0 is not "no margin" - it means "use the style's".
      const mg = (v: any) => { const n = parseFloat(String(v)); return isFinite(n) && n > 0 ? n : null; };
      if (start != null) cues.push({ start, end, text: clean, raw: obj.text || '', style: (obj.style || '').trim(),
        marginL: mg(obj.marginl), marginR: mg(obj.marginr), marginV: mg(obj.marginv) });
    }
  }
  return { cues, styles: styleDefs.length, styleDefs, info };
}

// ---- ASS/SSA styling ----

// An ASS colour is &H[AA]BBGGRR (or a raw decimal). Returns a CSS rgba() string,
// honouring the alpha (00 = opaque, FF = transparent in ASS) - or null.
function assColor(v: string) {
  if (!v) return null;
  const m = /&H([0-9A-Fa-f]{1,8})/.exec(String(v)) || /^\s*(\d+)\s*$/.exec(String(v));
  if (!m) return null;
  let hex = m[1];
  if (/^\d+$/.test(hex) && !/[a-f]/i.test(hex) && hex.length < 6) hex = Number(hex).toString(16);
  hex = hex.padStart(8, '0').slice(-8);
  const a = parseInt(hex.slice(0, 2), 16), b = parseInt(hex.slice(2, 4), 16);
  const g = parseInt(hex.slice(4, 6), 16), r = parseInt(hex.slice(6, 8), 16);
  return `rgba(${r}, ${g}, ${b}, ${(1 - a / 255).toFixed(3)})`;
}

const num = (v: any, dflt: number) => { const n = parseFloat(String(v)); return isFinite(n) ? n : dflt; };
const flag = (v: any) => /-?1/.test(String(v || '').trim());

interface AssStyle {
  name: string; font: string; size: number;
  primary: string; secondary: string; outline: string; back: string;
  bold: boolean; italic: boolean; underline: boolean; strike: boolean;
  borderStyle: number; outlineW: number; shadowW: number;
  align: number;                       // always \an numbering, 1-9
  marginL: number; marginR: number; marginV: number;
}

/* SSA v4 numbered its alignments by bit flags - 1/2/3 across the bottom, +4 for
   the top row, +8 for the middle - while ASS v4+ renumbered them 1-9 like a
   keypad. Same field name, different meaning, and getting it wrong puts every
   line of an old .ssa on the wrong edge of the screen. */
function legacyToAn(a: number) {
  const col = (a & 3) || 2;
  if (a & 8) return 3 + col;          // middle row -> 4,5,6
  if (a & 4) return 6 + col;          // top row    -> 7,8,9
  return col;                         // bottom row -> 1,2,3
}

// Reduce a parsed Style row to everything the stage needs to draw it.
function assBaseStyle(s: any, legacy: boolean): AssStyle {
  const rawAlign = num(s && s.alignment, 2);
  return {
    name: (s && s.name) || '',
    font: (s && s.fontname) || '',
    size: num(s && s.fontsize, 36),
    primary: (s && assColor(s.primarycolour)) || '#ffffff',
    secondary: (s && assColor(s.secondarycolour)) || '#ffcc00',
    outline: (s && assColor(s.outlinecolour)) || 'rgba(0, 0, 0, 1)',
    back: (s && assColor(s.backcolour)) || 'rgba(0, 0, 0, 0.6)',
    bold: flag(s && s.bold), italic: flag(s && s.italic),
    underline: flag(s && s.underline), strike: flag(s && s.strikeout),
    borderStyle: num(s && s.borderstyle, 1),
    outlineW: num(s && s.outline, 2), shadowW: num(s && s.shadow, 0),
    align: legacy ? legacyToAn(rawAlign) : (rawAlign >= 1 && rawAlign <= 9 ? rawAlign : 2),
    marginL: num(s && s.marginl, 10), marginR: num(s && s.marginr, 10), marginV: num(s && s.marginv, 10),
  };
}

interface Karaoke { type: 'k'|'kf'|'ko'; start: number; dur: number }   // seconds, from cue start
interface AssSeg {
  text: string; br: boolean;
  colour: string; bold: boolean; italic: boolean; underline: boolean; strike: boolean;
  k: Karaoke|null;
}
interface AssLayout {
  pos: { x: number; y: number }|null;
  move: { x1: number; y1: number; x2: number; y2: number; t1: number; t2: number }|null;
  align: number;
  hasK: boolean;
}

/* Split one Dialogue line into styled runs.

   ASS puts its formatting in `{...}` blocks between the words, and the tags are
   stateful: everything after `{\i1}` is italic until something turns it off. So
   this walks the line left to right carrying that state, and cuts a new run each
   time the state changes.

   Karaoke rides along the same walk. `\k50` means "the syllable that follows
   lasts 50 centiseconds", and the timings are cumulative from the start of the
   line - so a running total is all it takes to know when each syllable is sung.
   `\k` switches the syllable to the primary colour the moment its turn comes;
   `\kf` (and `\K`) sweeps the colour across it over its duration instead. */
function parseAssRuns(raw: string, base: AssStyle) {
  const segs: AssSeg[] = [];
  const layout: AssLayout = { pos: null, move: null, align: base.align, hasK: false };
  const state = { colour: base.primary, bold: base.bold, italic: base.italic, underline: base.underline, strike: base.strike };
  let kAccum = 0;              // seconds of karaoke consumed so far
  let pendingK: Karaoke|null = null;

  // A tag name is letters, optionally with one leading digit (\1c, \3a). Digits
  // must NOT be part of the greedy name match or `\k50` reads as a tag called
  // "k50" with no argument, and every karaoke timing is silently lost.
  const TAG = /\\(\d?[a-z]+)(\([^)]*\)|&H[0-9A-Fa-f]+&?|-?[\d.]+)?/gi;
  for (const part of raw.split(/(\{[^}]*\}|\\N|\\n|\\h)/)) {
    if (!part) continue;
    if (/^\{[^}]*\}$/.test(part)) {
      const body = part.slice(1, -1);
      let m;
      TAG.lastIndex = 0;
      while ((m = TAG.exec(body))) {
        const rawTag = m[1], tag = rawTag.toLowerCase(), arg = m[2] || '';
        // \r on its own resets to the line's style; \rSomeStyle switches to a
        // named one, which the name-greedy match above swallows whole - both
        // start with r, and no other ASS tag does.
        if (tag.charAt(0) === 'r') {
          state.colour = base.primary; state.bold = base.bold; state.italic = base.italic;
          state.underline = base.underline; state.strike = base.strike;
        } else if (tag === 'b') state.bold = arg !== '0' && arg !== '';
        else if (tag === 'i') state.italic = arg === '1';
        else if (tag === 'u') state.underline = arg === '1';
        else if (tag === 's') state.strike = arg === '1';
        else if (tag === 'c' || tag === '1c') { const c = assColor(arg); if (c) state.colour = c; }
        else if (tag === 'an') { const n = parseInt(arg, 10); if (n >= 1 && n <= 9) layout.align = n; }
        else if (tag === 'a') { const n = parseInt(arg, 10); if (n > 0) layout.align = legacyToAn(n); }
        else if (tag === 'pos') {
          const p = /\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/.exec(arg);
          if (p) layout.pos = { x: parseFloat(p[1]), y: parseFloat(p[2]) };
        } else if (tag === 'move') {
          const p = /\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)(?:\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+))?/.exec(arg);
          if (p) layout.move = {
            x1: parseFloat(p[1]), y1: parseFloat(p[2]), x2: parseFloat(p[3]), y2: parseFloat(p[4]),
            // Missing t1/t2 means "over the whole line", which the caller fills in
            // once it knows the duration; -1 is the marker for that.
            t1: p[5] != null ? parseFloat(p[5]) / 1000 : -1, t2: p[6] != null ? parseFloat(p[6]) / 1000 : -1,
          };
        } else if (tag === 'k' || tag === 'kf' || tag === 'ko' || tag === 'kt') {
          const cs = parseFloat(arg);
          if (isFinite(cs)) {
            if (tag === 'kt') { kAccum = cs / 100; continue; }   // absolute reset
            // Capital \K is the old spelling of \kf - a sweep, not a switch - so
            // the original case has to be consulted, not the lower-cased name.
            const type: Karaoke['type'] = (tag === 'kf' || rawTag === 'K') ? 'kf' : tag === 'ko' ? 'ko' : 'k';
            pendingK = { type, start: kAccum, dur: cs / 100 };
            kAccum += cs / 100;
            layout.hasK = true;
          }
        }
      }
      continue;
    }
    if (/^\\[Nn]$/.test(part)) { segs.push({ text: '', br: true, colour: state.colour, bold: state.bold, italic: state.italic, underline: state.underline, strike: state.strike, k: null }); continue; }
    if (part === '\\h') { segs.push({ text: ' ', br: false, ...state, k: null }); continue; }
    segs.push({ text: part, br: false, ...state, k: pendingK });
    pendingK = null;
  }
  // `\K` is the same tag as `\kf` but the regex above lower-cases it, so both
  // land on 'kf' already - nothing to do here beyond noting why.
  return { segs, layout };
}

// Build the DOM for one line's runs. Karaoke spans are tagged so the transport can
// recolour them on every frame without rebuilding anything.
function buildAssLine(segs: AssSeg[], base: AssStyle) {
  const line = el('span', { class: 'anr-ass-line' });
  const kSpans: { node: HTMLElement; k: Karaoke }[] = [];
  for (const s of segs) {
    if (s.br) { line.appendChild(el('br')); continue; }
    if (!s.text) continue;
    const span = el('span', {}) as HTMLElement;
    span.style.color = s.colour;
    if (s.bold) span.style.fontWeight = '700';
    if (s.italic) span.style.fontStyle = 'italic';
    const deco = [s.underline ? 'underline' : '', s.strike ? 'line-through' : ''].filter(Boolean).join(' ');
    if (deco) span.style.textDecoration = deco;
    span.textContent = s.text;
    if (s.k) { span.style.color = base.secondary; kSpans.push({ node: span, k: s.k }); }
    line.appendChild(span);
  }
  return { line, kSpans };
}

// Recolour a line's karaoke spans for a moment in time (seconds from cue start).
function paintKaraoke(kSpans: { node: HTMLElement; k: Karaoke }[], base: AssStyle, t: number) {
  for (const { node, k } of kSpans) {
    const done = t >= k.start + k.dur, started = t >= k.start;
    if (k.type === 'kf' && started && !done && k.dur > 0) {
      // A sweep, so the fill has to be a gradient rather than a colour. The
      // outline is drawn with text-stroke rather than a shadow precisely so it
      // survives the transparent fill this needs.
      const f = ((t - k.start) / k.dur * 100).toFixed(1);
      node.style.color = 'transparent';
      node.style.backgroundImage = 'linear-gradient(to right, ' + base.primary + ' ' + f + '%, ' + base.secondary + ' ' + f + '%)';
      node.style.backgroundClip = 'text';
      (node.style as any).webkitBackgroundClip = 'text';
    } else {
      node.style.backgroundImage = '';
      node.style.color = (k.type === 'kf' ? done : started) ? base.primary : base.secondary;
    }
  }
}

// Render one Dialogue line as static styled text for the cue list (no timing).
function renderAssCue(raw: string, base: AssStyle) {
  const { segs } = parseAssRuns(raw, base);
  // In a still list every syllable has been sung, so karaoke runs take the
  // primary colour rather than the pre-highlight one.
  for (const s of segs) if (s.k) s.k = null;
  return buildAssLine(segs, base).line;
}

/* ---- The stage: ASS/SSA laid out where the author put it ----

   A subtitle file is a set of instructions for painting text over a frame of
   video, and until you draw that frame you are only reading the instructions.
   The stage is that frame: a box in the script's own coordinate system (PlayResX
   x PlayResY, the resolution the author was positioning against), scaled to
   whatever width the card has. Everything inside is positioned in script units
   and the whole layer is scaled by one CSS transform, so the geometry is exact
   at any size and there is no per-element arithmetic to get wrong.

   That is what makes \pos and \an mean something. Placement is otherwise the
   part of ASS most viewers throw away, and it is the part that carries the
   author's intent - a sign translated in the top-left corner is in the top-left
   corner because that is where the sign is. */

const DEFAULT_PLAYRES = { x: 384, y: 288 };   // what SSA assumed before PlayRes existed

interface StageCue {
  node: HTMLElement;
  kSpans: { node: HTMLElement; k: Karaoke }[];
  base: AssStyle;
  layout: AssLayout;
  start: number; end: number;
  marginL: number; marginR: number; marginV: number;
}

function buildAssStage(cues: any[], styleMap: any, styleDefs: any[], info: any, legacy: boolean) {
  const resX = num(info.playresx, DEFAULT_PLAYRES.x) || DEFAULT_PLAYRES.x;
  const resY = num(info.playresy, DEFAULT_PLAYRES.y) || DEFAULT_PLAYRES.y;
  const duration = cues.reduce((mx, c) => Math.max(mx, c.end || c.start), 0) || 1;

  const wrap = el('div', { class: 'anr-ass-stage-wrap' });
  wrap.style.aspectRatio = resX + ' / ' + resY;
  const frame = el('div', { class: 'anr-ass-frame' });
  frame.style.width = resX + 'px';
  frame.style.height = resY + 'px';
  wrap.appendChild(frame);

  const staged: StageCue[] = [];
  let anyKaraoke = false;
  for (const c of cues) {
    const base = assBaseStyle(styleMap[c.style] || styleDefs[0], legacy);
    const { segs, layout } = parseAssRuns(c.raw || c.text || '', base);
    if (layout.hasK) anyKaraoke = true;
    const { line, kSpans } = buildAssLine(segs, base);
    const node = el('div', { class: 'anr-ass-cue' }) as HTMLElement;
    node.style.fontSize = base.size + 'px';
    if (base.font) node.style.fontFamily = '"' + base.font.replace(/"/g, '') + '", sans-serif';
    // Outline as a stroke rather than a stack of shadows: it is what ASS actually
    // specifies, and it is the only form that survives the transparent fill a
    // \kf sweep needs. paint-order puts the stroke behind the glyph so a thick
    // outline doesn't eat into the letterforms.
    if (base.borderStyle === 3) {
      node.style.background = base.back;
      node.style.padding = '0.05em 0.25em';
    } else if (base.outlineW > 0) {
      (node.style as any).webkitTextStrokeWidth = (base.outlineW * 2) + 'px';
      (node.style as any).webkitTextStrokeColor = base.outline;
      (node.style as any).paintOrder = 'stroke fill';
    }
    if (base.shadowW > 0) node.style.textShadow = base.shadowW + 'px ' + base.shadowW + 'px 0 ' + base.back;
    node.appendChild(line);
    node.hidden = true;
    frame.appendChild(node);
    staged.push({
      node, kSpans, base, layout, start: c.start, end: c.end || c.start + 2,
      marginL: c.marginL != null ? c.marginL : base.marginL,
      marginR: c.marginR != null ? c.marginR : base.marginR,
      marginV: c.marginV != null ? c.marginV : base.marginV,
    });
  }

  // Keep the script's coordinate system exact: lay everything out at PlayRes and
  // scale the whole layer once. Layout metrics (offsetHeight below) are unaffected
  // by a transform, so stacking still measures in script units.
  const rescale = () => {
    const w = wrap.clientWidth || resX;
    frame.style.transform = 'scale(' + (w / resX) + ')';
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(rescale).observe(wrap);
  setTimeout(rescale, 0);

  // Anchor -> the fraction of the element's own box that sits at the anchor point.
  const anchorOf = (an: number) => ({
    ax: an % 3 === 1 ? 0 : an % 3 === 2 ? 50 : 100,
    ay: an <= 3 ? 100 : an <= 6 ? 50 : 0,
  });

  const place = (t: number) => {
    // Cues sharing an alignment stack rather than overprint, the way a real
    // renderer keeps two simultaneous lines readable.
    const stack: Record<number, number> = {};
    for (const s of staged) {
      const on = t >= s.start && t < s.end;
      s.node.hidden = !on;
      if (!on) continue;
      const { ax, ay } = anchorOf(s.layout.align);
      // A wrapped line reads towards the edge it is anchored to.
      s.node.style.textAlign = ax === 0 ? 'left' : ax === 50 ? 'center' : 'right';
      let x: number, y: number;
      if (s.layout.move) {
        const m = s.layout.move;
        const t1 = m.t1 < 0 ? 0 : m.t1, t2 = m.t2 < 0 ? (s.end - s.start) : m.t2;
        const rel = t - s.start;
        const f = t2 > t1 ? Math.max(0, Math.min(1, (rel - t1) / (t2 - t1))) : 1;
        x = m.x1 + (m.x2 - m.x1) * f;
        y = m.y1 + (m.y2 - m.y1) * f;
        s.node.style.maxWidth = '';
      } else if (s.layout.pos) {
        x = s.layout.pos.x; y = s.layout.pos.y;
        s.node.style.maxWidth = '';
      } else {
        const left = s.marginL, right = resX - s.marginR;
        x = ax === 0 ? left : ax === 50 ? (left + right) / 2 : right;
        y = ay === 100 ? resY - s.marginV : ay === 50 ? resY / 2 : s.marginV;
        s.node.style.maxWidth = Math.max(40, right - left) + 'px';
        // Stack away from the anchored edge: upward from the bottom, downward
        // from the top and the middle.
        const used = stack[s.layout.align] || 0;
        y += ay === 100 ? -used : used;
        stack[s.layout.align] = used + s.node.offsetHeight;
      }
      s.node.style.left = x + 'px';
      s.node.style.top = y + 'px';
      s.node.style.transform = 'translate(' + (-ax) + '%, ' + (-ay) + '%)';
      if (s.kSpans.length) paintKaraoke(s.kSpans, s.base, t - s.start);
    }
  };

  // ---- transport ----
  const playBtn = el('button', { class: 'anr-btn anr-btn-sm', type: 'button' }, 'Play') as HTMLButtonElement;
  const slider = el('input', { class: 'anr-range', type: 'range', min: '0', max: String(duration), step: '0.02', value: '0' }) as HTMLInputElement;
  slider.style.flex = '1';
  const clock = el('span', { class: 'anr-ass-clock' }, fmtTime(0));
  let t = 0, playing = false, raf = 0, last = 0;

  const show = (v: number) => {
    t = Math.max(0, Math.min(duration, v));
    slider.value = String(t);
    clock.textContent = fmtTime(t);
    place(t);
  };
  const tick = (now: number) => {
    if (!playing) return;
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    if (t + dt >= duration) { show(duration); stop(); return; }
    show(t + dt);
    raf = requestAnimationFrame(tick);
  };
  const stop = () => { playing = false; last = 0; playBtn.textContent = 'Play'; if (raf) cancelAnimationFrame(raf); raf = 0; };
  const start = () => {
    if (t >= duration) show(0);
    playing = true; last = 0; playBtn.textContent = 'Pause';
    raf = requestAnimationFrame(tick);
  };
  playBtn.addEventListener('click', () => (playing ? stop() : start()));
  slider.addEventListener('input', () => { stop(); show(parseFloat(slider.value)); });
  // A stage that is no longer on the page must not keep a rAF loop alive - the
  // next file would be animating one nobody can see.
  (window._anrMediaStoppers = window._anrMediaStoppers || new Set()).add(stop);

  // Jump to the first cue rather than an empty frame at 0.
  show(cues.length ? cues[0].start : 0);

  const controls = el('div', { class: 'anr-ass-controls' }, [playBtn, slider, clock]);
  return { wrap, controls, anyKaraoke, resX, resY };
}

// MicroDVD: one cue per line as {startFrame}{endFrame}text. Times are frame
// numbers, so a frame rate is needed - it may be declared as the "text" of the
// very first {1}{1} (or {0}{0}) line, otherwise we assume 23.976. Text uses |
// for line breaks and {...} for inline style codes.
function parseMicroDvd(text: string) {
  const RE = /^\{(\d+)\}\{(\d+)\}(.*)$/;
  const raw = [];
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const m = line.match(RE);
    if (m) raw.push({ s: +m[1], e: +m[2], t: m[3] });
  }
  let fps = 23.976, declared = false;
  if (raw.length && raw[0].s <= 1 && raw[0].s === raw[0].e) {
    const f = parseFloat(raw[0].t);
    if (isFinite(f) && f > 0 && f < 200 && /^\s*[\d.]+\s*$/.test(raw[0].t)) {
      fps = f; declared = true; raw.shift();
    }
  }
  const cues = raw.map((r) => ({
    start: r.s / fps, end: r.e / fps,
    text: r.t.replace(/\{[^}]*\}/g, '').replace(/\|/g, '\n').trim(),
  }));
  return { cues, fps, declared };
}

// SubViewer (1.0/2.0): a "hh:mm:ss.cc,hh:mm:ss.cc" time-pair line followed by
// the cue text ([br] line breaks), blocks separated by blank lines. An
// [INFORMATION]/[SUBTITLE] header may precede the cues.
function parseSubViewer(text: string) {
  const cues = [];
  const TIME = /^(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}),\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})/;
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const ti = lines.findIndex((l: string) => TIME.test(l));
    if (ti < 0) continue;
    const m = lines[ti].match(TIME);
    const start = parseTime(m![1]), end = parseTime(m![2]);
    const txt = lines.slice(ti + 1).join('\n')
      .replace(/\[br\]/gi, '\n').replace(/<[^>]+>/g, '').trim();
    if (start != null) cues.push({ start, end, text: txt });
  }
  return cues;
}

export async function renderSubtitles(file: File, resultsEl: HTMLElement) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';

  let text = '';
  try { text = await file.text(); }
  catch (e) { resultsEl.appendChild(errorCard('Could not read this subtitle file.')); return; }

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  let format: string|undefined, cues: any[] = [], styles = 0, fps: number|null = null, styleDefs: any[]|null = null;
  let assInfo: any = {}, assLegacy = false;
  if (ext === 'sub') {
    // .sub is overloaded: text (MicroDVD frame-based / SubViewer time-based) or
    // the binary VobSub bitmap format. Sniff the text shapes; if neither matches
    // (and it looks binary) it is almost certainly VobSub, which carries no text.
    if (/^\{\d+\}\{\d+\}/m.test(text)) {
      format = 'MicroDVD';
      const r = parseMicroDvd(text); cues = r.cues; fps = r.fps;
    } else if (/\[SUBTITLE\]/i.test(text) || /^\d{1,2}:\d{2}:\d{2}[.,]\d{1,3},/m.test(text)) {
      format = 'SubViewer';
      cues = parseSubViewer(text);
    } else {
      // Replacement chars / NULs mean we read binary as text - flag VobSub.
      const binary = /[\x00�]/.test(text.slice(0, 4096));
      const infoCard = el('div', { class: 'anr-card' });
      const [h, help] = h3help('Subtitles', 'This .sub file does not contain text subtitles of the MicroDVD or SubViewer kind.');
      infoCard.appendChild(h); infoCard.appendChild(help);
      const tbl = el('table', { class: 'anr-readout' });
      tbl.appendChild(row('File', file.name));
      tbl.appendChild(row('Size', fmtBytes(file.size)));
      tbl.appendChild(row('Format', binary ? 'VobSub (binary image subtitle)' : 'Unrecognised .sub'));
      tbl.appendChild(rowHelp('Note', binary ? 'VobSub stores subtitles as bitmaps' : 'No MicroDVD or SubViewer cues found',
        binary ? 'VobSub (.sub) stores its subtitles as ready-made pictures, paired with an .idx file that holds the timings - there is no actual text to read out. The matching .idx file is the readable half.' : 'The file did not match any of the text subtitle formats Analyser can read.'));
      infoCard.appendChild(tbl);
      resultsEl.appendChild(infoCard);
      return;
    }
  } else if (ext === 'ass' || ext === 'ssa' || /^\s*\[Script Info\]/i.test(text)) {
    format = ext === 'ssa' ? 'SubStation Alpha (SSA)' : 'Advanced SubStation Alpha (ASS)';
    const r = parseAss(text); cues = r.cues; styles = r.styles; styleDefs = r.styleDefs; assInfo = r.info || {};
    // The Alignment field means one thing in SSA v4 and another in ASS v4.00+.
    // ScriptType decides it; the extension is only a fallback for files that
    // omit the header.
    const st = String(assInfo.scripttype || '');
    assLegacy = st ? !/\+/.test(st) : ext === 'ssa';
  } else if (ext === 'vtt' || /^﻿?WEBVTT/.test(text)) {
    format = 'WebVTT';
    cues = parseSrtVtt(text, true);
  } else {
    format = 'SubRip (SRT)';
    cues = parseSrtVtt(text, false);
  }

  cues.sort((a, b) => a.start - b.start);

  // ---- Stats ----
  const [h, help] = h3help('Subtitles', 'Reads the subtitle lines and when each one appears on screen. SRT, WebVTT, ASS/SSA, MicroDVD and SubViewer files are supported.');
  const infoCard = el('div', { class: 'anr-card' });
  infoCard.appendChild(h); infoCard.appendChild(help);
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  tbl.appendChild(row('Format', format));
  tbl.appendChild(row('Cues', String(cues.length)));
  if (fps != null) tbl.appendChild(rowHelp('Frame rate', fps.toFixed(3).replace(/\.?0+$/, '') + ' fps',
    'MicroDVD subtitles are timed by frame number rather than by the clock, so a frame rate (frames per second) is needed to turn those into real times. Assumed to be 23.976 fps unless the file states its own.'));
  if (styles) tbl.appendChild(row('Styles', String(styles)));
  if (cues.length) {
    const first = cues[0].start;
    const last = cues.reduce((mx, c) => Math.max(mx, c.end || c.start), 0);
    const covered = cues.reduce((sum, c) => sum + Math.max(0, (c.end || c.start) - c.start), 0);
    const chars = cues.reduce((sum, c) => sum + c.text.replace(/\s+/g, ' ').length, 0);
    tbl.appendChild(row('First cue', fmtTime(first)));
    tbl.appendChild(row('Last cue end', fmtTime(last)));
    tbl.appendChild(rowHelp('On-screen time', fmtTime(covered),
      'The total time that at least one subtitle line is showing, adding up how long every line stays on screen.'));
    tbl.appendChild(row('Total characters', chars.toLocaleString()));
  }
  infoCard.appendChild(tbl);
  resultsEl.appendChild(infoCard);

  // ---- ASS/SSA style table ----
  const styleMap: any = {};
  if (styleDefs && styleDefs.length) {
    for (const s of styleDefs) styleMap[(s.name || '').trim()] = s;
    const card = el('div', { class: 'anr-card' });
    card.appendChild(el('h3', {}, 'Styles (' + styleDefs.length + ')'));
    const t = el('table', { class: 'anr-readout' });
    t.appendChild(el('tr', {}, [el('th', {}, 'Name'), el('th', {}, 'Font'), el('th', {}, 'Size'), el('th', {}, 'Colour'), el('th', {}, 'B/I')]));
    for (const s of styleDefs) {
      const col = assColor(s.primarycolour) || '#fff';
      const swatch = el('span', { style: 'display:inline-block;width:12px;height:12px;vertical-align:middle;margin-right:6px;border:1px solid var(--rule);background:' + col + ';' });
      const colTd = el('td', {}); colTd.appendChild(swatch); colTd.appendChild(document.createTextNode(s.primarycolour || '-'));
      const bi = [/-?1/.test(String(s.bold || '')) ? 'B' : '', /-?1/.test(String(s.italic || '')) ? 'I' : ''].filter(Boolean).join('/') || '-';
      t.appendChild(el('tr', {}, [el('td', {}, s.name || '-'), el('td', {}, s.fontname || '-'), el('td', {}, s.fontsize || '-'), colTd, el('td', {}, bi)]));
    }
    card.appendChild(t);
    resultsEl.appendChild(card);
  }

  // ---- Playable stage (ASS/SSA only) ----
  // Everything above reads the file; this draws it. Positioning and karaoke are
  // the two parts of ASS that only mean anything once there is a frame and a
  // clock, so they get both.
  if (styleDefs && styleDefs.length && cues.length) {
    try {
      const stage = buildAssStage(cues, styleMap, styleDefs, assInfo, assLegacy);
      const card = el('div', { class: 'anr-card' });
      const [sh, shelp] = h3help('Preview',
        'The subtitles drawn where the file actually places them, at the resolution the author positioned against (' + stage.resX + ' x ' + stage.resY + '). Lines land at their own alignment, margins and \\pos coordinates, move along a \\move path, and karaoke lines fill in syllable by syllable as they are sung. There is no video behind them - only the subtitle layer.');
      card.appendChild(sh); card.appendChild(shelp);
      card.appendChild(stage.controls);
      card.appendChild(stage.wrap);
      if (stage.anyKaraoke) {
        card.appendChild(el('p', { class: 'anr-hint' },
          'This file carries karaoke timing: each syllable has its own duration, so the words change colour in time with the singing. Press play to see it.'));
      }
      card.appendChild(el('p', { class: 'anr-hint' },
        'Vector drawing commands (\\p), rotation and blur are not drawn - a line built from those shows as its text.'));
      resultsEl.appendChild(card);
    } catch (e) { /* the readout and cue list stand on their own */ }
  }

  // ---- Cue list ----
  // For ASS/SSA, render each cue with its style + inline overrides applied (colour,
  // bold, italic, line breaks) on a dark stage. Other formats get the plain list.
  if (cues.length) {
    const styled = styleDefs && styleDefs.length;
    const card = el('div', { class: 'anr-card' });
    card.appendChild(el('h3', {}, styled ? 'Cues (styled preview)' : 'Cues'));
    const list = el('div', { class: styled ? 'anr-lrc-list anr-ass-stage' : 'anr-lrc-list' });
    for (const c of cues) {
      const timeEl = el('span', { class: 'anr-lrc-time' }, fmtTime(c.start));
      let textEl;
      if (styled) {
        const base = assBaseStyle(styleMap[c.style] || styleDefs![0], assLegacy);
        textEl = el('span', { class: 'anr-lrc-text' }, [renderAssCue(c.raw || c.text || '', base)]);
      } else {
        textEl = el('span', { class: 'anr-lrc-text' }, c.text || ' ');
      }
      list.appendChild(el('div', { class: 'anr-lrc-line' }, [timeEl, textEl]));
    }
    card.appendChild(list);
    resultsEl.appendChild(card);
  }
}
