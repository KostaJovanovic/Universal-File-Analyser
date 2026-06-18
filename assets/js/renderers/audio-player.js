/* Analyser - audio transport/player
   A small custom <audio> transport: play/pause button, a draggable seek track
   with a fill, and a current/total time readout. Built around any media element
   (the audio module's hidden <audio>, or a video's extracted-audio element).
   Drag listeners are attached on press and removed on release so they don't pile
   up as new files are analysed. Used by audio.js and (via re-export) video.js. */

import { el } from '../core/util.js';
import { isSynced, getAudioOwner, onAudioOwner, getAudioCompanion } from '../core/video-sync.js';

export function makePlayer(mediaEl, knownDuration, opts = {}) {
  // MediaRecorder blobs (recorded audio) are written without a duration header, so
  // mediaEl.duration is Infinity until the clip is played/seeked to the end. When the
  // caller knows the real length (e.g. from decodeAudioData), use it as a fallback so
  // the total shows immediately instead of 0:00. durationchange (below) picks up the
  // browser's real value once it learns it.
  function dur() {
    const d = mediaEl.duration;
    if (isFinite(d) && d > 0) return d;
    return (typeof knownDuration === 'number' && isFinite(knownDuration)) ? knownDuration : 0;
  }
  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }
  const playBtn = el('button', { type: 'button', class: 'anr-player-play' }, '▶');
  const fillEl = el('div', { class: 'anr-player-fill' });
  const trackEl = el('div', { class: 'anr-player-track' }, [fillEl]);
  const timeEl = el('span', { class: 'anr-player-time' }, '0:00 / 0:00');
  // The section-03 mini player passes noVolume: its narrow transport has no room
  // for a slider. It still joins the shared registry below (so the shared level
  // applies when it becomes the audio owner) - it just has no volume UI.
  const vol = opts.noVolume ? null : makeVolume(mediaEl);
  const container = el('div', { class: 'anr-player' }, [playBtn, trackEl, timeEl, vol]);
  // A volume-less synced player still needs to track the shared level/mute, so
  // register it directly (makeVolume already registers the ones that have a UI).
  if (opts.noVolume) registerVolPlayer(mediaEl, container, () => {});

  playBtn.addEventListener('click', () => {
    // Once playback has ended the button is a replay control: restart from 0.
    if (mediaEl.ended) { mediaEl.currentTime = 0; mediaEl.play(); }
    else if (mediaEl.paused) mediaEl.play();
    else mediaEl.pause();
  });
  mediaEl.addEventListener('play', () => {
    playBtn.textContent = '❚❚'; playBtn.classList.remove('is-replay');
    playBtn.setAttribute('aria-label', 'Pause');
    tick();
  });
  // On a natural end some browsers fire 'pause' too; don't let it overwrite the
  // replay glyph (guard on mediaEl.ended, which is already true by then).
  mediaEl.addEventListener('pause', () => { if (!mediaEl.ended) { playBtn.textContent = '▶'; playBtn.setAttribute('aria-label', 'Play'); } });
  mediaEl.addEventListener('ended', () => {
    playBtn.textContent = '↻'; playBtn.classList.add('is-replay');
    playBtn.setAttribute('aria-label', 'Replay from start');
  });

  let dragging = false;
  function scrub(clientX) {
    const rect = trackEl.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    fillEl.style.width = (frac * 100) + '%';
    const d = dur();
    // Set currentTime directly. The browser coalesces rapid seeks during a drag;
    // an explicit seeking-gate could get stuck (a no-op seek never fires 'seeked',
    // especially with two players sharing one element) and then block all scrubs.
    if (d > 0) mediaEl.currentTime = frac * d;
    // Scrubbing away from the very end clears the 'ended' state, so the button is
    // no longer a replay control - revert the glyph to play while paused (the
    // 'play' handler clears it on its own once playback resumes).
    if (mediaEl.paused && !mediaEl.ended && playBtn.classList.contains('is-replay')) {
      playBtn.textContent = '▶'; playBtn.classList.remove('is-replay');
      playBtn.setAttribute('aria-label', 'Play');
    }
  }
  // Window listeners are added on press and removed on release so they don't
  // pile up across files.
  function onMouseMove(e) { if (dragging) { scrub(e.clientX); tick(); } }
  function onMouseUp() {
    dragging = false;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }
  trackEl.addEventListener('mousedown', (e) => {
    dragging = true; scrub(e.clientX); e.preventDefault();
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
  function onTouchMove(e) { if (dragging && e.touches[0]) { scrub(e.touches[0].clientX); tick(); } }
  function onTouchEnd() {
    dragging = false;
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('touchend', onTouchEnd);
  }
  trackEl.addEventListener('touchstart', (e) => {
    dragging = true; scrub(e.touches[0].clientX); e.preventDefault();
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
  }, { passive: false });

  function tick() {
    const d = dur();
    const pct = d > 0 ? (mediaEl.currentTime / d) * 100 : 0;
    fillEl.style.width = pct + '%';
    timeEl.textContent = fmt(mediaEl.currentTime) + ' / ' + fmt(d);
    if (!mediaEl.paused) requestAnimationFrame(tick);
  }
  mediaEl.addEventListener('seeked', tick);
  mediaEl.addEventListener('loadedmetadata', tick);
  mediaEl.addEventListener('durationchange', tick);
  tick();

  return container;
}

// iOS Safari makes mediaEl.volume read-only (only the hardware buttons change
// volume), so a drag slider there is a dead control - we hide it and keep just the
// mute toggle (mediaEl.muted IS honoured). A CSS media query also hides the slider
// on narrow screens; the mute button stays everywhere.
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Monochrome speaker glyphs (inherit currentColor, so they invert on hover like
// the play button): two waves (loud), one wave (quiet), and a cross (muted).
const SPK = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 4V5L7 9H3z"/>';
const ICON_HI = SPK + '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a9 9 0 0 1 0 12"/></svg>';
const ICON_LO = SPK + '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>';
const ICON_MUTE = SPK + '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';

// All players share ONE volume/mute level, so changing it on any clip changes it
// everywhere at once - and it persists across files and sessions via localStorage.
// Every live player registers below; a change is applied to every registered media
// element and each player's UI follows. Disconnected players are pruned so the
// registry can't grow unbounded as files are analysed.
const VOL_KEY = 'anr-volume';
// Only the volume LEVEL is remembered across sessions - never the mute flag. A
// persisted mute (or a persisted volume of 0) is a silent footgun: it survives
// cache/script clears and silences every video on every future file with no
// obvious cause, which is exactly the "no sound anywhere" trap. So we always boot
// UN-muted, and a stored 0 is treated as unset (restored to full) rather than
// loading the page permanently silent.
let sharedVol = 1, sharedMuted = false, lastNonZero = 1;
try {
  const raw = localStorage.getItem(VOL_KEY);
  const o = raw ? JSON.parse(raw) : null;
  if (o && typeof o.v === 'number' && o.v > 0) { sharedVol = Math.min(1, o.v); lastNonZero = sharedVol; }
} catch (_) {}
const volPlayers = new Set();   // { mediaEl, wrap, sync }
// Register a media element with the shared-volume system. Both makeVolume (UI
// players) and the noVolume path (section-03 mini) funnel through here.
function registerVolPlayer(mediaEl, wrap, sync) {
  volPlayers.add({ mediaEl, wrap, sync });
}
// Pruning keys on isConnected, which is only reliable once the DOM has settled -
// so it happens HERE (applyShared runs on user interaction, well after render),
// never at registration time (a just-built player isn't appended yet and would be
// dropped before it could sync).
function applyShared() {
  const owner = getAudioOwner();
  // The audio companion (extracted PCM playing under a muted video) is the real
  // loudspeaker for clips with an undecodable audio codec - it always follows the
  // shared level/mute.
  const comp = getAudioCompanion();
  if (comp) { try { comp.volume = sharedVol; comp.muted = sharedMuted; } catch (_) {} }
  for (const p of volPlayers) {
    if (!p.wrap.isConnected) { volPlayers.delete(p); continue; }
    try {
      p.mediaEl.volume = sharedVol;
      if (isSynced(p.mediaEl)) {
        // Exclusive audio: only the audio owner may sound; every other synced
        // player stays muted so the page never plays the same clip twice over
        // itself. Until the user starts something (owner null) we leave the muted
        // state as each player was built with (main unmuted, minis muted).
        if (owner) p.mediaEl.muted = sharedMuted || (p.mediaEl !== owner);
      } else {
        p.mediaEl.muted = sharedMuted;   // plain audio players (not synced video)
      }
    } catch (_) {}
    p.sync();
  }
}
// When the audio owner changes (user pressed a different player), re-apply the
// shared level/mute so the new owner adopts it and the rest go quiet.
onAudioOwner(() => applyShared());
function setShared(v, m) {
  sharedVol = Math.max(0, Math.min(1, v));
  if (sharedVol > 0) lastNonZero = sharedVol;
  sharedMuted = !!m;
  // Persist only the level - never the mute flag (see the load block above).
  try { localStorage.setItem(VOL_KEY, JSON.stringify({ v: sharedVol })); } catch (_) {}
  applyShared();
}

// A mute button + draggable volume bar. All instances drive/reflect the shared
// state above. Mirrors the seek track's press/drag pattern (listeners attached on
// press, removed on release).
function makeVolume(mediaEl) {
  const muteBtn = el('button', { type: 'button', class: 'anr-player-mute', 'aria-label': 'Mute', html: ICON_HI });
  const volFill = el('div', { class: 'anr-player-volfill' });
  const volTrack = el('div', { class: 'anr-player-voltrack', role: 'slider', 'aria-label': 'Volume' }, [volFill]);
  const wrap = el('div', { class: 'anr-player-vol' }, IS_IOS ? [muteBtn] : [muteBtn, volTrack]);

  function sync() {
    const v = sharedMuted ? 0 : sharedVol;
    volFill.style.width = (v * 100) + '%';
    muteBtn.innerHTML = v === 0 ? ICON_MUTE : (v < 0.5 ? ICON_LO : ICON_HI);
    muteBtn.setAttribute('aria-label', (sharedMuted || sharedVol === 0) ? 'Unmute' : 'Mute');
  }
  muteBtn.addEventListener('click', () => {
    if (!sharedMuted && sharedVol > 0) setShared(sharedVol, true);   // mute
    else if (sharedMuted) setShared(sharedVol, false);              // unmute, keep level
    else setShared(lastNonZero, false);                            // was 0 -> restore
  });

  let dragging = false;
  function setVol(clientX) {
    const rect = volTrack.getBoundingClientRect();
    setShared(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)), false);
  }
  function onMove(e) { if (dragging) setVol(e.clientX); }
  function onUp() { dragging = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); }
  volTrack.addEventListener('mousedown', (e) => {
    dragging = true; setVol(e.clientX); e.preventDefault();
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  });
  function onTMove(e) { if (dragging && e.touches[0]) { setVol(e.touches[0].clientX); e.preventDefault(); } }
  function onTEnd() { dragging = false; window.removeEventListener('touchmove', onTMove); window.removeEventListener('touchend', onTEnd); }
  volTrack.addEventListener('touchstart', (e) => {
    dragging = true; setVol(e.touches[0].clientX); e.preventDefault();
    window.addEventListener('touchmove', onTMove, { passive: false }); window.addEventListener('touchend', onTEnd);
  }, { passive: false });

  // Reflect a change made outside our UI (e.g. native iOS/desktop controls) back
  // into the shared state. The epsilon guard stops a feedback loop with applyShared.
  // For a synced video we ignore the muted flag: muting there is owned by the
  // exclusive-audio layer (a muted follower must NOT drag the shared mute down).
  mediaEl.addEventListener('volumechange', () => {
    const muteChanged = !isSynced(mediaEl) && mediaEl.muted !== sharedMuted;
    if (Math.abs(mediaEl.volume - sharedVol) > 0.001 || muteChanged) setShared(mediaEl.volume, isSynced(mediaEl) ? sharedMuted : mediaEl.muted);
    else sync();
  });

  registerVolPlayer(mediaEl, wrap, sync);
  // Adopt the shared level now. Synced videos keep the muted state they were built
  // with (main unmuted, gyro/mini muted) until the user picks an audio owner; a
  // plain audio player just takes the shared mute directly.
  try { mediaEl.volume = sharedVol; if (!isSynced(mediaEl)) mediaEl.muted = sharedMuted; } catch (_) {}
  sync();
  return wrap;
}
