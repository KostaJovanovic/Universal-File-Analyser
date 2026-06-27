/* Analyser - Lottie / Bodymovin animation player
   ============================================================================
   Lottie is a JSON vector-animation format (Bodymovin export). This renderer
   plays it live with the vendored lottie-web engine and adds a timeline scrubber,
   play/pause, speed and loop controls, plus the animation's metadata.

   Three carriers are handled:
     - .json            plain Lottie JSON
     - .tgs             Telegram sticker - gzip-compressed Lottie JSON
     - .lottie          dotLottie - a ZIP with animations/<id>.json (+ manifest)

   The engine is loaded lazily on first use and cached for offline. Everything is
   guarded so a malformed file degrades to an error card. */

import { el, row, rowHelp, fmtBytes, integrityCard, errorCard, loadScript } from '../core/util.js';
import { gunzip } from '../core/binutil.js';

const LOTTIE_URL = 'assets/vendor/lottie/lottie.min.js';

async function loadLottie() {
  if (!window.lottie && !window.bodymovin) await loadScript(LOTTIE_URL);
  return window.lottie || window.bodymovin || null;
}

// Does a parsed object look like a Lottie animation? (version + frame-rate +
// in/out points + a layers array.) Used here and by the JSON inspector's offer.
export function isLottie(obj) {
  return !!obj && typeof obj === 'object'
    && 'v' in obj && typeof obj.fr === 'number'
    && typeof obj.op === 'number' && Array.isArray(obj.layers);
}

// Pull the Lottie JSON out of whatever carrier the file is.
async function readLottieData(file, ext) {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isGzip = head[0] === 0x1f && head[1] === 0x8b;
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  if (ext === 'tgs' || isGzip) {
    const out = await gunzip(new Uint8Array(await file.arrayBuffer()));
    if (!out) throw new Error('could not decompress this .tgs');
    return JSON.parse(new TextDecoder().decode(out));
  }
  if (ext === 'lottie' || isZip) {
    const { openZip } = await import('./zip.js');
    const zip = await openZip(file);
    // dotLottie: manifest.json points at animations/<id>.json; otherwise grab the
    // first animation JSON we can find.
    let target = null;
    try {
      if (zip.has('manifest.json')) {
        const man = JSON.parse(await zip.text('manifest.json'));
        const id = man && man.animations && man.animations[0] && man.animations[0].id;
        if (id && zip.has('animations/' + id + '.json')) target = 'animations/' + id + '.json';
      }
    } catch (_) { /* fall through to a scan */ }
    if (!target) {
      const m = zip.match(/^animations\/.*\.json$/);
      target = m.length ? m[0].name : null;
    }
    if (!target) throw new Error('no animation JSON inside this .lottie');
    return JSON.parse(await zip.text(target));
  }
  return JSON.parse(await file.text());
}

// Build the player + metadata for an already-parsed Lottie object. Exported so the
// JSON inspector can offer "play as animation" without re-reading the file.
export async function renderLottieData(data, resultsEl, file) {
  const lib = await loadLottie();
  if (!lib) { resultsEl.appendChild(errorCard('Could not load the Lottie engine.')); return; }
  if (!isLottie(data)) { resultsEl.appendChild(errorCard('This JSON is not a Lottie animation.')); return; }

  // ---- Metadata ----
  const fr = data.fr || 0;
  const frames = Math.max(0, (data.op || 0) - (data.ip || 0));
  const metaCard = el('div', { class: 'anr-card' });
  metaCard.appendChild(el('h3', {}, 'Lottie animation'));
  const t = el('table', { class: 'anr-readout' });
  if (file) { t.appendChild(row('File', file.name)); t.appendChild(row('Size', fmtBytes(file.size))); }
  if (data.nm) t.appendChild(row('Name', String(data.nm)));
  t.appendChild(row('Bodymovin version', String(data.v || '-')));
  t.appendChild(row('Dimensions', (data.w || '?') + ' × ' + (data.h || '?') + ' px'));
  t.appendChild(rowHelp('Frame rate', fr ? fr + ' fps' : '-', 'Frames per second the animation is authored at.'));
  t.appendChild(row('Frames', frames ? Math.round(frames).toLocaleString() : '-'));
  t.appendChild(row('Duration', fr ? (frames / fr).toFixed(2) + ' s' : '-'));
  t.appendChild(row('Layers', Array.isArray(data.layers) ? data.layers.length : 0));
  if (Array.isArray(data.assets) && data.assets.length) t.appendChild(row('Assets', data.assets.length));
  metaCard.appendChild(t);
  resultsEl.appendChild(metaCard);

  // ---- Player ----
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Playback'));
  const stage = el('div', { class: 'anr-lottie-stage' });
  card.appendChild(stage);

  let anim;
  try {
    anim = lib.loadAnimation({ container: stage, renderer: 'svg', loop: true, autoplay: true, animationData: data });
  } catch (e) {
    card.appendChild(errorCard('The engine could not play this animation: ' + (e && e.message)));
    resultsEl.appendChild(card);
    return;
  }

  let playing = true, scrubbing = false;
  const playBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, '❚❚ Pause');
  playBtn.addEventListener('click', () => {
    playing = !playing;
    if (playing) anim.play(); else anim.pause();
    playBtn.textContent = playing ? '❚❚ Pause' : '▶ Play';
  });
  const range = el('input', { type: 'range', min: '0', max: '100', value: '0', step: '0.1', class: 'anr-lottie-range' });
  range.addEventListener('input', () => { scrubbing = true; anim.goToAndStop(parseFloat(range.value), true); });
  range.addEventListener('change', () => { scrubbing = false; if (playing) anim.play(); });
  anim.addEventListener('DOMLoaded', () => { range.max = String(anim.totalFrames || frames || 100); });
  anim.addEventListener('enterFrame', () => { if (!scrubbing) range.value = String(anim.currentFrame); });

  const speed = el('select', { class: 'anr-btn anr-btn-sm', title: 'Playback speed' });
  for (const s of [0.25, 0.5, 1, 1.5, 2]) { const o = el('option', { value: String(s) }, s + '×'); if (s === 1) o.selected = true; speed.appendChild(o); }
  speed.addEventListener('change', () => anim.setSpeed(parseFloat(speed.value)));

  const loopBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm is-on' }, 'Loop');
  loopBtn.addEventListener('click', () => { anim.loop = !anim.loop; loopBtn.classList.toggle('is-on', anim.loop); if (anim.loop && playing) anim.play(); });

  card.appendChild(el('div', { class: 'anr-btn-row', style: 'margin-top:8px;align-items:center;gap:8px;' }, [playBtn, range, speed, loopBtn]));
  resultsEl.appendChild(card);
}

export async function renderLottie(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading animation "${file.name}"…`));

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  let data;
  try {
    data = await readLottieData(file, ext);
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read this Lottie file: ' + (e && e.message || 'parse error')));
    return;
  }
  resultsEl.innerHTML = '';
  await renderLottieData(data, resultsEl, file);
  if (file.size <= 500 * 1024 * 1024) resultsEl.appendChild(integrityCard(file));
}
