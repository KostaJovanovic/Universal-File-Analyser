/* Analyser - subtitle files (SRT / WebVTT / ASS / SSA / MicroDVD / SubViewer)
   Parses cues into a timed list and reports counts, timing, and styling info.
   Pure text parsing, no dependencies. The .sub extension is overloaded - it
   carries text (MicroDVD frame-based or SubViewer time-based) as well as the
   binary VobSub bitmap format, so we sniff which one a .sub actually is. */

import { el, row, rowHelp, h3help, errorCard, fmtBytes } from '../core/util.js';

function fmtTime(sec) {
  if (sec == null || !isFinite(sec)) return '-';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const ss = s.toFixed(2).padStart(5, '0');
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + ss;
}

// Parse "HH:MM:SS,mmm" / "HH:MM:SS.mmm" / "MM:SS.mmm" / "H:MM:SS.cc" -> seconds.
function parseTime(t) {
  t = t.trim().replace(',', '.');
  const parts = t.split(':');
  if (!parts.length) return null;
  let s = 0;
  for (const p of parts) s = s * 60 + parseFloat(p);
  return isFinite(s) ? s : null;
}

function parseSrtVtt(text, isVtt) {
  const cues = [];
  // Split on blank lines into blocks.
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/);
  const TIME = /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})/;
  for (let block of blocks) {
    const lines = block.split('\n').filter((l) => l.length);
    if (!lines.length) continue;
    if (isVtt && /^WEBVTT/.test(lines[0])) continue;
    if (/^(NOTE|STYLE|REGION)\b/.test(lines[0])) continue;   // VTT metadata blocks
    // Find the timing line (may be preceded by an index / cue id line).
    let ti = lines.findIndex((l) => TIME.test(l));
    if (ti < 0) continue;
    const m = lines[ti].match(TIME);
    const start = parseTime(m[1]), end = parseTime(m[2]);
    const txt = lines.slice(ti + 1).join('\n')
      .replace(/<[^>]+>/g, '')      // strip VTT/HTML tags
      .trim();
    if (start != null) cues.push({ start, end, text: txt });
  }
  return cues;
}

function parseAss(text) {
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
      const cols = line.replace(/^Format:\s*/i, '').split(',').map((s) => s.trim().toLowerCase());
      if (section.includes('style')) styleFmt = cols;
      else if (section.includes('event') || (/start/i.test(line) && /text/i.test(line))) dlgFmt = cols;
      continue;
    }
    if (/^Style:/i.test(line)) {
      const cols = styleFmt || DEFAULT_STYLE_COLS;
      const vals = line.replace(/^Style:\s*/i, '').split(',');
      const o: any = {};
      cols.forEach((c, i) => { o[c] = vals[i] != null ? vals[i].trim() : ''; });
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
      cols.forEach((c, i) => { obj[c] = i < n - 1 ? head[i] : txt; });
      const start = parseTime(obj.start || ''), end = parseTime(obj.end || '');
      const clean = (obj.text || '').replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').trim();
      if (start != null) cues.push({ start, end, text: clean, raw: obj.text || '', style: (obj.style || '').trim() });
    }
  }
  return { cues, styles: styleDefs.length, styleDefs, info };
}

// ---- ASS/SSA styling ----

// An ASS colour is &H[AA]BBGGRR (or a raw decimal). Returns a CSS rgba() string,
// honouring the alpha (00 = opaque, FF = transparent in ASS) - or null.
function assColor(v) {
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

// Reduce a parsed Style row to the visual basics we render.
function assBaseStyle(s) {
  return {
    color: (s && assColor(s.primarycolour)) || '#ffffff',
    bold: !!s && /-?1/.test(String(s.bold || '').trim()),
    italic: !!s && /-?1/.test(String(s.italic || '').trim()),
    font: (s && s.fontname) || '',
  };
}

// Apply a run of override tags (the contents of a {...} block) to the live state.
function applyAssTags(tags, state, base) {
  const re = /\\([a-z0-9]+)(&H[0-9A-Fa-f]+&?|\([^)]*\)|-?\d+)?/gi;
  let m;
  while ((m = re.exec(tags))) {
    const tag = m[1].toLowerCase(), arg = m[2] || '';
    if (tag === 'r') { state.color = base.color; state.bold = base.bold; state.italic = base.italic; }
    else if (tag === 'b') state.bold = arg !== '0' && arg !== '';
    else if (tag === 'i') state.italic = arg === '1';
    else if (tag === 'c' || tag === '1c') { const c = assColor(arg); if (c) state.color = c; }
  }
}

// Render one Dialogue line (with its {\..} overrides and \N breaks) to a styled
// DOM fragment, starting from its style's base look. Unknown tags (\k, \pos, \fad,
// drawing) are ignored, text preserved - so it's a faithful look, not a full layout.
function renderAssCue(raw, base) {
  const line = el('span', { class: 'anr-ass-line' });
  const state = { color: base.color, bold: base.bold, italic: base.italic };
  for (const p of raw.split(/(\{[^}]*\}|\\N|\\n)/i)) {
    if (!p) continue;
    if (/^\{[^}]*\}$/.test(p)) { applyAssTags(p.slice(1, -1), state, base); continue; }
    if (/^\\[Nn]$/.test(p)) { line.appendChild(el('br')); continue; }
    const span = el('span', {});
    span.style.color = state.color;
    if (state.bold) span.style.fontWeight = '700';
    if (state.italic) span.style.fontStyle = 'italic';
    span.textContent = p;
    line.appendChild(span);
  }
  return line;
}

// MicroDVD: one cue per line as {startFrame}{endFrame}text. Times are frame
// numbers, so a frame rate is needed - it may be declared as the "text" of the
// very first {1}{1} (or {0}{0}) line, otherwise we assume 23.976. Text uses |
// for line breaks and {...} for inline style codes.
function parseMicroDvd(text) {
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
function parseSubViewer(text) {
  const cues = [];
  const TIME = /^(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}),\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})/;
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const ti = lines.findIndex((l) => TIME.test(l));
    if (ti < 0) continue;
    const m = lines[ti].match(TIME);
    const start = parseTime(m[1]), end = parseTime(m[2]);
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
  let format, cues = [], styles = 0, fps = null, styleDefs = null;
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
    const r = parseAss(text); cues = r.cues; styles = r.styles; styleDefs = r.styleDefs;
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
        const base = assBaseStyle(styleMap[c.style] || styleDefs[0]);
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
