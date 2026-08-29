/* Analyser - tracker module viewer (MOD, XM, IT, S3M and ~60 relatives)

   A tracker module is a score, not a recording: a bank of instrument samples
   plus a pattern grid saying which sample to trigger, on which channel, at which
   row. Playing one means running a tracker engine, which is why these have been
   identification-only here for so long.

   The approach: libopenmpt renders the song offline to PCM (lib/openmpt-loader),
   and that buffer is handed to the ordinary audio renderer. A .mod therefore
   gets the entire Sound section - waveform, spectrogram, transport, loudness,
   key and BPM - with no parallel player to maintain. Above it sits a tracker
   card for what a WAV has no equivalent of: the tracker that wrote it, the
   channel and pattern counts, and the sample and instrument name lists, which
   are traditionally where authors left greetings and credits. */

import { el, row, fmtBytes, h3help, inlineLoader, preBlock } from '../core/util.js';
import { renderTracker, type TrackerInfo } from '../lib/openmpt-loader.js';
import { renderAudio } from './audio.js';
import { encodeWav } from './video-avi.js';

function fmtDuration(sec: number) {
  if (!isFinite(sec) || sec <= 0) return '-';
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}

// Names worth listing: tracker files pad their tables with empty slots, and a
// list of forty blanks tells the reader nothing.
function namedOnly(list: string[]) {
  return list.map((n, i) => ({ i, n: (n || '').trim() })).filter((e) => e.n.length > 0);
}

function nameList(title: string, list: string[], total: number) {
  const named = namedOnly(list);
  if (!named.length) return null;
  const body = named.map((e) => String(e.i + 1).padStart(3, ' ') + '  ' + e.n).join('\n');
  return {
    title: title + ' (' + named.length + ' named of ' + total + ')',
    node: preBlock(body),
  };
}

/** Render a tracker module: the tracker card, then the full audio analysis of
    the rendered song. */
export async function renderTrackerModule(file: File, resultsEl: HTMLElement) {
  const loader = inlineLoader('Rendering module…');
  resultsEl.appendChild(loader);

  let result = null;
  let failure = '';
  try {
    result = await renderTracker(new Uint8Array(await file.arrayBuffer()));
  } catch (e: any) {
    failure = (e && e.message) ? String(e.message) : 'the tracker engine could not be loaded';
  }
  loader.remove();

  if (!result) {
    resultsEl.appendChild(el('div', { class: 'anr-info' },
      failure
        ? 'This module could not be rendered: ' + failure + '.'
        : 'This file has a tracker-module extension, but the tracker engine could not open it as one.'));
    return;
  }
  const { info, left, right, sampleRate, truncated } = result;

  // ---- tracker card ----
  const card = el('div', { class: 'anr-card' });
  const [h, help] = h3help('Tracker module',
    'A module stores instrument samples plus a pattern score, not recorded audio. The sound below is rendered from that score on your device by libopenmpt - the same engine OpenMPT uses - so it is a performance of the file, not a decode of it.');
  card.appendChild(h); card.appendChild(help);

  const tbl = el('table', { class: 'anr-table' });
  if (info.title) tbl.appendChild(row('Title', info.title));
  if (info.artist) tbl.appendChild(row('Artist', info.artist));
  tbl.appendChild(row('Format', info.typeLong || info.type || 'tracker module'));
  if (info.tracker) tbl.appendChild(row('Made with', info.tracker));
  tbl.appendChild(row('Duration', fmtDuration(info.durationSec)));
  tbl.appendChild(row('Channels', info.channels));
  tbl.appendChild(row('Patterns', info.patterns + ' (' + info.orders + ' in the order list)'));
  const namedInst = namedOnly(info.instruments).length;
  const namedSamp = namedOnly(info.samples).length;
  if (info.instruments.length) tbl.appendChild(row('Instruments', info.instruments.length + (namedInst ? ' (' + namedInst + ' named)' : '')));
  if (info.samples.length) tbl.appendChild(row('Samples', info.samples.length + (namedSamp ? ' (' + namedSamp + ' named)' : '')));
  tbl.appendChild(row('File size', fmtBytes(file.size)));
  card.appendChild(tbl);

  if (truncated) {
    card.appendChild(el('div', { class: 'anr-info' },
      'This module runs longer than the render ceiling (or loops without end), so the audio below is the first '
      + fmtDuration(left.length / sampleRate) + ' of it.'));
  }

  // The song message is a free-text block many trackers carry - liner notes,
  // greetings, instructions - and is often the most interesting thing in the file.
  const sections: { title: string; node: Node }[] = [];
  if (info.message && info.message.trim()) {
    sections.push({ title: 'Song message', node: preBlock(info.message.replace(/\r\n?/g, '\n')) });
  }
  const sampleSec = nameList('Sample names', info.samples, info.samples.length);
  if (sampleSec) sections.push(sampleSec);
  const instSec = nameList('Instrument names', info.instruments, info.instruments.length);
  if (instSec) sections.push(instSec);
  for (const s of sections) {
    const d = el('details', { style: 'margin-top:10px;' });
    d.appendChild(el('summary', {}, s.title));
    d.appendChild(s.node);
    card.appendChild(d);
  }
  resultsEl.appendChild(card);

  // ---- hand the rendered PCM to the real audio renderer ----
  // encodeWav takes anything with the AudioBuffer read surface, so the planar
  // channels go straight in without building a real AudioBuffer first.
  const wavSource = {
    numberOfChannels: 2,
    sampleRate,
    length: left.length,
    getChannelData: (i: number) => (i === 0 ? left : right),
  };
  const wavBlob = encodeWav(wavSource);
  const base = (file.name || 'module').replace(/\.[^/.]+$/, '');
  const audioFile = new File([wavBlob], base + '.wav', { type: 'audio/wav' });

  let audioBuffer: AudioBuffer | null = null;
  try {
    const AC = window.AudioContext || window.webkitAudioContext!;
    const ctx = new AC();
    audioBuffer = ctx.createBuffer(2, left.length, sampleRate);
    audioBuffer.getChannelData(0).set(left);
    audioBuffer.getChannelData(1).set(right);
  } catch (_) {
    audioBuffer = null;
  }

  await renderAudio(audioFile, resultsEl, {
    inline: true,
    audioBuffer,
    playbackFile: audioFile,
    declaredLossless: false,
    download: true,
    downloadLabel: 'Download rendered audio (WAV)',
    sourceNote: 'Rendered from ' + (file.name || 'the module') + ' on this device.',
  });
}
