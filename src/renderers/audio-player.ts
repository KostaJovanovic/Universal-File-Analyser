/* Analyser - audio transport/player
   A small custom <audio> transport: play/pause button, a draggable seek track
   with a fill, and a current/total time readout. Built around any media element
   (the audio module's hidden <audio>, or a video's extracted-audio element).
   Drag listeners are attached on press and removed on release so they don't pile
   up as new files are analysed. Used by audio.js and (via re-export) video.js. */

import { el, setPlayerFill } from '../core/util.js';
import { isSynced, getAudioOwner, onAudioOwner, getAudioCompanion } from '../core/video-sync.js';

export function makePlayer(mediaEl: HTMLAudioElement, knownDuration?: number|undefined, opts: any = {}) {
  const listenerOpts = opts.signal ? { signal: opts.signal } : undefined;
  // MediaRecorder blobs (recorded audio) are written without a duration header, so
  // mediaEl.duration is Infinity until the clip is played/seeked to the end. When the
  // caller knows the real length (e.g. from decodeAudioData), use it as a fallback so
  // the total shows immediately instead of 0:00. durationchange (below) picks up the
  // browser's real value once it learns it.
  // opts.preferKnown: trust the caller's duration OVER the element's own. Needed for
  // raw ADTS AAC, where the browser reports a finite but wildly wrong .duration (no
  // container index to measure against) - so the usual "element value wins when
  // finite" rule would show e.g. 7319:30 for a 2-hour file.
  function dur() {
    if (opts.preferKnown && typeof knownDuration === 'number' && isFinite(knownDuration) && knownDuration > 0) return knownDuration;
    const d = mediaEl.duration;
    if (isFinite(d) && d > 0) return d;
    return (typeof knownDuration === 'number' && isFinite(knownDuration)) ? knownDuration : 0;
  }
  function fmt(sec: number) {
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
  // mutedPreview goes further: a standalone silent preview (the section-meta mini)
  // that never owns the audio, so it stays OUT of the shared registry entirely and
  // keeps whatever muted state it was built with.
  const vol = opts.noVolume ? null : makeVolume(mediaEl, opts.signal);
  const container = el('div', { class: 'anr-player' }, [playBtn, trackEl, timeEl, vol]);
  // When a controller is attached (see container._anrTransport below), this
  // transport stops driving its own <audio> and instead delegates play/pause and
  // scrubbing to that controller, with the controller pushing the fill/time/glyph
  // back via update(). The spectrogram's blend slider uses this so the play button
  // under the spectrogram drives the separated-stem playback, in sync.
  let controller: { toggle(): void; seek(frac: number): void }|null = null;
  // A volume-less synced player still needs to track the shared level/mute, so
  // register it directly (makeVolume already registers the ones that have a UI).
  const unregisterVol = opts.noVolume && !opts.mutedPreview
    ? registerVolPlayer(mediaEl, container, () => {})
    : null;
  if (opts.signal && unregisterVol) opts.signal.addEventListener('abort', unregisterVol, { once: true });

  function playMedia() {
    // Result stems use this hook to create their WAV URL only when playback is
    // actually requested, avoiding two whole-song encodes at separation finish.
    if (opts.beforePlay) opts.beforePlay();
    const pending = mediaEl.play();
    if (pending && pending.catch) pending.catch(() => {});
  }
  playBtn.addEventListener('click', () => {
    if (controller) { controller.toggle(); return; }
    // Once playback has ended the button is a replay control: restart from 0.
    if (mediaEl.ended) { mediaEl.currentTime = 0; playMedia(); }
    else if (mediaEl.paused) playMedia();
    else mediaEl.pause();
  });
  mediaEl.addEventListener('play', () => {
    if (controller) return;   // the controller owns the glyph/clock while attached
    playBtn.textContent = '❚❚'; playBtn.classList.remove('is-replay');
    playBtn.setAttribute('aria-label', 'Pause');
    tick();
  }, listenerOpts);
  // On a natural end some browsers fire 'pause' too; don't let it overwrite the
  // replay glyph (guard on mediaEl.ended, which is already true by then).
  mediaEl.addEventListener('pause', () => { if (!controller && !mediaEl.ended) { playBtn.textContent = '▶'; playBtn.setAttribute('aria-label', 'Play'); } }, listenerOpts);
  mediaEl.addEventListener('ended', () => {
    if (controller) return;
    playBtn.textContent = '↻'; playBtn.classList.add('is-replay');
    playBtn.setAttribute('aria-label', 'Replay from start');
  }, listenerOpts);

  let dragging = false;
  function scrub(clientX: number) {
    const rect = trackEl.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setPlayerFill(fillEl, frac);
    if (controller) { controller.seek(frac); return; }
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
  function onMouseMove(e: MouseEvent) { if (dragging) { scrub(e.clientX); tick(); } }
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
  function onTouchMove(e: TouchEvent) { if (dragging && e.touches[0]) { scrub(e.touches[0].clientX); tick(); } }
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
  if (opts.signal) opts.signal.addEventListener('abort', () => { onMouseUp(); onTouchEnd(); }, { once: true });

  let lastLabel = '';
  function tick() {
    if (controller) return;   // while delegated, the controller pushes UI via update()
    const d = dur();
    setPlayerFill(fillEl, d > 0 ? mediaEl.currentTime / d : 0);
    // The readout is whole seconds, so it changes ~once a second while this runs
    // 60 times a second. Writing textContent invalidates the node either way, so
    // compare first and leave it alone for the other 59 frames.
    const label = fmt(mediaEl.currentTime) + ' / ' + fmt(d);
    if (label !== lastLabel) { lastLabel = label; timeEl.textContent = label; }
    if (!mediaEl.paused) requestAnimationFrame(tick);
  }
  mediaEl.addEventListener('seeked', tick, listenerOpts);
  mediaEl.addEventListener('loadedmetadata', tick, listenerOpts);
  mediaEl.addEventListener('durationchange', tick, listenerOpts);
  tick();

  // Transport delegation hooks. attach() hands play/pause + scrubbing to an external
  // controller ({ toggle(), seek(frac) }) and freezes the media-driven UI; update()
  // lets that controller push the fill/time/glyph; detach() restores normal <audio>
  // driving. The spectrogram blend uses this so the under-spectrogram play button
  // controls the separated-stem playback and every scrubber stays in sync.
  container._anrTransport = {
    attach(ctl: { toggle(): void; seek(frac: number): void }) { controller = ctl; },
    detach() {
      controller = null;
      playBtn.classList.toggle('is-replay', mediaEl.ended);
      playBtn.textContent = mediaEl.ended ? '↻' : (mediaEl.paused ? '▶' : '❚❚');
      playBtn.setAttribute('aria-label', mediaEl.ended ? 'Replay from start' : (mediaEl.paused ? 'Play' : 'Pause'));
      tick();
    },
    update(frac: number, curSec: number, durSec: number, playing: boolean) {
      setPlayerFill(fillEl, frac);
      timeEl.textContent = fmt(curSec) + ' / ' + fmt(durSec);
      playBtn.classList.remove('is-replay');
      playBtn.textContent = playing ? '❚❚' : '▶';
      playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    },
  };

  return container;
}

// iOS Safari makes mediaEl.volume read-only (only the hardware buttons change
// volume), so a drag slider there is a dead control - we hide it and keep just the
// mute toggle (mediaEl.muted IS honoured) everywhere else.
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Monochrome speaker glyphs (inherit currentColor, so they invert on hover like
// the play button): two waves (loud), one wave (quiet), and a cross (muted).
const SPK = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 4V5L7 9H3z"/>';
const ICON_HI = SPK + '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a9 9 0 0 1 0 12"/></svg>';
const ICON_LO = SPK + '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>';
const ICON_MUTE = SPK + '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';

// All players share ONE volume/mute level, so changing it on any clip changes it
// everywhere at once. Every live player registers below; a change is applied to
// every registered media element and each player's UI follows. Disconnected
// players are pruned so the registry can't grow unbounded as files are analysed.
const VOL_KEY = 'anr-volume';
// Volume goes past the native 0-100% ceiling, up to 225%, for clips that are
// just recorded too quiet - but 100% (unity gain, no boost applied) is always
// the default a fresh player starts at.
const MAX_VOL = 2.25;
// The level is NOT remembered across page loads: every fresh load starts at exactly
// 100% (unity). A boost is a per-clip fix for one quiet recording, and a persisted
// mute/level is the classic "no sound anywhere" footgun (it survives cache/script
// clears and silences every future file with no obvious cause) - so neither the
// level nor the mute flag persists. The level is still shared LIVE across every
// player on the page within a session (sharedVol + the registry below); it just
// doesn't survive a refresh.
let sharedVol = 1, sharedMuted = false, lastNonZero = 1;
// Drop any level saved by earlier builds so a stale value can't leak back in.
try { localStorage.removeItem(VOL_KEY); } catch (_) {}
const volPlayers = new Set<{ mediaEl: any; wrap: HTMLElement; sync: () => void }>();

// A native <audio>/<video> element's own .volume is hard-capped at 1.0, so going
// past 100% needs a Web Audio GainNode inserted after it. But an element may have
// only ONE MediaElementSource for its whole life, so every effect that taps a
// player - this volume boost AND the spectrogram's frequency-isolation graph in
// audio.js - has to hang off the SAME source, or the second one to call
// createMediaElementSource throws and silently dies (that was the "isolate
// stopped working once volume shipped" bug).
//
// playerAudioNode builds `source -> boostGain -> destination` once and caches it
// on the element. Both features share the returned object: boost drives
// boostGain.gain; isolation connects FROM boostGain, reworking only its OUTPUT and
// never touching the source -> boostGain link. One shared context serves both.
let sharedCtx: AudioContext|null = null;
export function playerAudioCtx() {
  if (!sharedCtx) sharedCtx = new (window.AudioContext || window.webkitAudioContext)();
  return sharedCtx;
}
// Returns { ctx, source, boostGain } for mediaEl, or null if it can't be routed
// (already claimed by another context, cross-origin-tainted, etc.).
export function playerAudioNode(mediaEl: HTMLMediaElement) {
  if (mediaEl._anrAudioNode) return mediaEl._anrAudioNode;
  try {
    const ctx = playerAudioCtx();
    const source = ctx.createMediaElementSource(mediaEl);
    const boostGain = ctx.createGain();
    // A brick-wall limiter sits after the makeup gain. Without it, boosting a clip
    // that's already near full scale just multiplies the peaks past 0 dBFS and they
    // clip into distortion - louder numbers, barely louder sound. The limiter tames
    // those peaks so the boost raises the AVERAGE level toward the ceiling instead,
    // which is what actually reads as louder. Near-transparent at unity (a 0 dBFS
    // peak sits right at the threshold, ~no reduction); it only bites once the boost
    // pushes signal above the ceiling. Everything downstream (the isolation graph in
    // audio.js) connects INTO this limiter, so it's always the last stage.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = 0;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    source.connect(boostGain);
    boostGain.connect(limiter);
    limiter.connect(ctx.destination);
    // The element now reaches the speakers only through Web Audio, which bypasses
    // its native .volume - so fold the current shared level into the gain and pin
    // native volume to unity (driving both at once would attenuate twice).
    boostGain.gain.value = sharedVol;
    try { mediaEl.volume = 1; } catch (_) {}
    // A routed element needs a running context; browsers start it suspended until
    // a gesture, so resume on first play (and now, if a gesture already happened).
    const resume = () => { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); };
    mediaEl.addEventListener('play', resume);
    resume();
    const node = { ctx, source, boostGain, limiter };
    mediaEl._anrAudioNode = node;
    return node;
  } catch (_) {
    return null;
  }
}
// Apply a 0-MAX_VOL level to an element. Below 100% with no graph yet, the cheap
// native .volume is enough; going past 100% - or an element already routed through
// the graph by isolation - drives the boost gain instead, native pinned to 1.
function applyVolumeTo(mediaEl: HTMLMediaElement, level: number) {
  let node = mediaEl._anrAudioNode;
  if (!node && level > 1) node = playerAudioNode(mediaEl);
  try {
    if (node) { mediaEl.volume = 1; node.boostGain.gain.value = level; }
    else mediaEl.volume = Math.min(1, level);
  } catch (_) {}
}
// Register a media element with the shared-volume system. Both makeVolume (UI
// players) and the noVolume path (section-03 mini) funnel through here.
function registerVolPlayer(mediaEl: HTMLAudioElement, wrap: HTMLDivElement, sync: () => void) {
  const entry = { mediaEl, wrap, sync };
  volPlayers.add(entry);
  return () => volPlayers.delete(entry);
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
  if (comp) { try { applyVolumeTo(comp, sharedVol); comp.muted = sharedMuted; } catch (_) {} }
  for (const p of volPlayers) {
    if (!p.wrap.isConnected) { volPlayers.delete(p); continue; }
    try {
      applyVolumeTo(p.mediaEl, sharedVol);
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

// Anything that wants to react to the shared LEVEL changing (e.g. the spectrogram
// mirroring a boost into its display sensitivity) subscribes here. The callback
// gets the current level (0..MAX_VOL) and mute flag; returns an unsubscribe fn.
const volListeners = new Set<(vol: number, muted: boolean) => void>();
export function onSharedVolume(cb: (vol: number, muted: boolean) => void) { volListeners.add(cb); return () => volListeners.delete(cb); }
export function sharedVolume() { return sharedVol; }

function setShared(v: number, m: boolean) {
  sharedVol = Math.max(0, Math.min(MAX_VOL, v));
  if (sharedVol > 0) lastNonZero = sharedVol;
  sharedMuted = !!m;
  // Deliberately not persisted - see the load block above (every load starts 100%).
  applyShared();
  for (const cb of volListeners) { try { cb(sharedVol, sharedMuted); } catch (_) {} }
}

// A mute button that reveals a popup with a vertical volume slider (0-225%,
// default 100%) on hover or click. All instances drive/reflect the shared state
// above. The track mirrors the seek track's press/drag pattern (listeners
// attached on press, removed on release), just along the Y axis and scaled to
// MAX_VOL instead of 0-1.
function makeVolume(mediaEl: HTMLMediaElement, signal?: AbortSignal) {
  const muteBtn = el('button', { type: 'button', class: 'anr-player-mute', 'aria-label': 'Mute', html: ICON_HI });
  const pctEl = el('div', { class: 'anr-player-volpct' }, '100%');
  const volFill = el('div', { class: 'anr-player-volfill' });
  const volTrack = el('div', {
    class: 'anr-player-voltrack', role: 'slider', 'aria-orientation': 'vertical', 'aria-label': 'Volume',
    'aria-valuemin': '0', 'aria-valuemax': String(Math.round(MAX_VOL * 100)), 'aria-valuenow': '100',
  }, [volFill]);
  const volCard = el('div', { class: 'anr-player-volcard' }, [pctEl, volTrack]);
  const volPop = el('div', { class: 'anr-player-volpop' }, [volCard]);
  const wrap = el('div', { class: 'anr-player-vol' }, IS_IOS ? [muteBtn] : [muteBtn, volPop]);

  function sync() {
    const v = sharedMuted ? 0 : sharedVol;
    const frac = Math.min(1, v / MAX_VOL);
    volFill.style.height = (frac * 100) + '%';
    volFill.classList.toggle('is-boosted', v > 1);
    pctEl.textContent = Math.round(v * 100) + '%';
    volTrack.setAttribute('aria-valuenow', String(Math.round(v * 100)));
    muteBtn.innerHTML = v === 0 ? ICON_MUTE : (v < 0.5 ? ICON_LO : ICON_HI);
    muteBtn.setAttribute('aria-label', (sharedMuted || sharedVol === 0) ? 'Unmute' : 'Mute');
  }

  // Opening the popup differs by input:
  //  - Pointers that can hover (desktop mouse): hover opens, mouseleave closes.
  //  - Touch (no hover): the button's tap drives it. The FIRST tap (popup closed)
  //    only reveals the slider - muting on the way to the slider would be a nasty
  //    surprise - and a tap while it's already open falls through to the mute
  //    toggle. On desktop hover has already opened it, so a click always lands on
  //    that mute path. Net rule: a click mutes only when the popup is already open.
  // Only real hover-capable pointers get the mouseenter/leave handlers; attaching
  // them on touch would fire on the synthesized mouseenter a tap emits and pre-open
  // the popup, breaking the first-tap-reveals behaviour.
  let hovering = false, dragging = false, closeTimer: number|null|undefined = null;
  const canHover = !IS_IOS && !!(window.matchMedia && window.matchMedia('(hover: hover)').matches);
  function open() { if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; } wrap.classList.add('is-open'); }
  function closeNow() { if (!dragging) wrap.classList.remove('is-open'); }
  // Close on a short delay, not instantly. The card floats above the mute button
  // with a seam between them; the moment the cursor crosses that seam the browser
  // reports a mouseleave on the wrap even though the card is where the cursor is
  // heading, which used to snap the popup shut "one pixel above the button" before
  // you could reach the slider. Deferring the close by a beat lets the re-entering
  // mouseenter (onto the button, the bridge or the card) cancel it, so the popup
  // only actually collapses once the cursor has genuinely left the whole control.
  function close() {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { closeTimer = null; closeNow(); }, 180);
  }
  const isOpen = () => wrap.classList.contains('is-open');
  if (!IS_IOS) {
    if (canHover) {
      wrap.addEventListener('mouseenter', () => { hovering = true; open(); });
      wrap.addEventListener('mouseleave', () => { hovering = false; close(); });
    }
    // An outside tap/click dismisses an open popup at once (the main way to close on
    // touch) - the intent there is unambiguous, so no grace delay.
    function onDocPointerDown(e: PointerEvent) {
      if (!wrap.isConnected) { document.removeEventListener('pointerdown', onDocPointerDown); return; }
      if (!wrap.contains(e.target as Node)) closeNow();
    }
    document.addEventListener('pointerdown', onDocPointerDown, signal ? { signal } : undefined);
  }

  muteBtn.addEventListener('click', () => {
    if (!IS_IOS && !isOpen()) { open(); return; }   // touch first tap: reveal only
    if (!sharedMuted && sharedVol > 0) setShared(sharedVol, true);   // mute
    else if (sharedMuted) setShared(sharedVol, false);              // unmute, keep level
    else setShared(lastNonZero, false);                            // was 0 -> restore
    open();
  });

  function setVol(clientY: number) {
    const rect = volTrack.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (rect.bottom - clientY) / rect.height));
    let v = frac * MAX_VOL;
    if (Math.abs(v - 1) <= 0.06) v = 1;   // detent at the 100% slit (see the ::after tick)
    setShared(v, false);
  }
  function onMove(e: MouseEvent) { if (dragging) setVol(e.clientY); }
  function onUp() {
    dragging = false;
    window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
    if (!hovering) close();
  }
  volTrack.addEventListener('mousedown', (e) => {
    dragging = true; setVol(e.clientY); e.preventDefault();
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  });
  function onTMove(e: TouchEvent) { if (dragging && e.touches[0]) { setVol(e.touches[0].clientY); e.preventDefault(); } }
  function onTEnd() {
    dragging = false;
    window.removeEventListener('touchmove', onTMove); window.removeEventListener('touchend', onTEnd);
    // Stay open after a touch drag so the level can be fine-tuned with more drags;
    // an outside tap dismisses it.
  }
  volTrack.addEventListener('touchstart', (e) => {
    dragging = true; setVol(e.touches[0].clientY); e.preventDefault();
    window.addEventListener('touchmove', onTMove, { passive: false }); window.addEventListener('touchend', onTEnd);
  }, { passive: false });
  if (signal) signal.addEventListener('abort', () => { onUp(); onTEnd(); }, { once: true });

  // Reflect a change made outside our UI (e.g. native iOS/desktop controls) back
  // into the shared state. The epsilon guard stops a feedback loop with applyShared.
  // A boosted element's .volume is deliberately pinned at 1 by applyVolumeTo, so
  // it's not a real external change - skip straight to a re-sync instead of
  // reading it back as if the user had dragged to 100%.
  // For a synced video we ignore the muted flag: muting there is owned by the
  // exclusive-audio layer (a muted follower must NOT drag the shared mute down).
  mediaEl.addEventListener('volumechange', () => {
    if (mediaEl._anrAudioNode) { sync(); return; }
    const muteChanged = !isSynced(mediaEl) && mediaEl.muted !== sharedMuted;
    if (Math.abs(mediaEl.volume - sharedVol) > 0.001 || muteChanged) setShared(mediaEl.volume, isSynced(mediaEl) ? sharedMuted : mediaEl.muted);
    else sync();
  }, signal ? { signal } : undefined);

  const unregister = registerVolPlayer(mediaEl, wrap, sync);
  if (signal) signal.addEventListener('abort', unregister, { once: true });
  // Adopt the shared level now. Synced videos keep the muted state they were built
  // with (main unmuted, gyro/mini muted) until the user picks an audio owner; a
  // plain audio player just takes the shared mute directly.
  applyVolumeTo(mediaEl, sharedVol);
  try { if (!isSynced(mediaEl)) mediaEl.muted = sharedMuted; } catch (_) {}
  sync();
  return wrap;
}
