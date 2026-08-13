/* Analyser - cross-player video sync + exclusive audio
   ============================================================================
   Some analyses show more than one <video> of the same clip at once (the main
   Player, the section-03 mini player, the gyro mini player). This keeps every
   registered player on the same transport: play one and they all play, pause or
   seek one and they all follow.

   Exclusive audio: all the synced players decode the same clip independently, so
   only ONE may be audible at a time or they echo. Whichever player the *user*
   starts becomes the "audio owner" - it is unmuted and every other player is
   muted. Press a different player and ownership moves to it. This is also why the
   playhead/white-line code reads getAudioOwner(): the line must track the element
   that is actually making sound, not a muted follower that has drifted from it.

   The hard part is avoiding a feedback storm: when we programmatically play /
   pause / seek a *follower*, that follower fires its own play / pause / seeking
   event, which would propagate straight back and ping-pong forever (which froze
   playback entirely). So each programmatic change tags the target with an "echo"
   flag; the target's handler sees the flag, consumes it, and does NOT re-emit.
   We also only push a time when it differs by more than a small threshold (so
   normal playback drift between independent decoders never triggers a seek), and
   deliberately do NOT continuously correct drift - play / pause / seek is enough
   and a continuous corrector is exactly what caused the storm. */

const players = new Set<HTMLMediaElement>();

function live() {
  for (const v of players) if (!v.isConnected) players.delete(v);   // drop detached players
  return [...players];
}
function others(self) { return live().filter((v) => v !== self); }

// --- standalone (exclusive) players -----------------------------------------
// A "loner" is a player that must NOT join the synced group above: it never
// co-plays, never owns the audio, and never drives the graph playheads - it is a
// self-contained preview (the section-meta mini). Playback is still one-at-a-time,
// though: starting a loner pauses the synced group, and starting any synced player
// pauses the loners. That is the whole relationship - "either this one or that one,
// never both", with nothing shared between them.
const loners = new Set<HTMLMediaElement>();

function pauseLoners() {
  for (const v of loners) {
    if (!v.isConnected) { loners.delete(v); continue; }
    if (!v.paused) try { v.pause(); } catch (_) {}
  }
}
function pauseSynced() {
  for (const v of live()) if (!v.paused) try { v.pause(); } catch (_) {}
}

// Register a <video> as a standalone exclusive preview. Returns an unregister fn.
export function registerExclusiveVideo(video) {
  if (!video || loners.has(video)) return () => {};
  loners.add(video);
  const onPlay = () => {
    // Starting the preview stops everything else - the synced group (whose natural
    // pause handlers also stop the audio companion) and any other loner.
    pauseSynced();
    for (const o of loners) if (o !== video && !o.paused) try { o.pause(); } catch (_) {}
  };
  const onGone = () => { loners.delete(video); video.removeEventListener('play', onPlay); };
  video.addEventListener('play', onPlay);
  video.addEventListener('emptied', onGone);
  return onGone;
}

// --- decode only what is on screen ------------------------------------------
// Every synced player is an INDEPENDENT decoder of the same clip. Propagating a
// play to all of them therefore costs one full decode each, and the followers are
// usually nowhere near the viewport - the Sony gyro mini player sits thousands of
// pixels below the main Player. On a heavy clip (a 1080p60 50 Mbps XAVC-S file,
// say) that second decoder is enough to make the picture you are ACTUALLY
// watching stutter, for a picture nobody can see.
//
// So a follower that is off-screen does not play: it records the time it should
// be at and stays paused. When it scrolls into view it jumps to the current
// position and, if the transport is still running, starts. Visible followers
// behave exactly as before - the feature is intact, it just stops paying for
// pictures that are not on screen.
const visible = new WeakMap<HTMLMediaElement, boolean>();   // video -> is it in (or near) the viewport
const pendingTime = new WeakMap<HTMLMediaElement, number>();   // video -> time to adopt when it next appears
let observer = null;

function seen(v) {
  // No IntersectionObserver (very old browser): treat everything as visible, i.e.
  // exactly the old behaviour, rather than silently never playing a follower.
  return typeof IntersectionObserver === 'undefined' ? true : visible.get(v) !== false;
}

// Is the transport running right now? Ownership can sit on a detached element
// from a previous analysis, so read it through getAudioOwner()'s pruning.
function transportPlaying() {
  const o = getAudioOwner();
  return !!(o && !o.paused);
}

function watch(video) {
  if (typeof IntersectionObserver === 'undefined') return;
  if (!observer) {
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const v = e.target as HTMLMediaElement;
        const was = visible.get(v);
        visible.set(v, e.isIntersecting);
        if (!e.isIntersecting || was === true) continue;
        // Just came into view: adopt the position it missed, then join in if the
        // transport is still playing. Both are tagged as echoes so this does not
        // propagate back out and restart everyone else.
        const t = pendingTime.get(v);
        if (t != null) { pendingTime.delete(v); pushTime(v, t); }
        if (transportPlaying() && v.paused) {
          v.__syncPlay = true;
          const p = v.play();
          if (p && p.catch) p.catch(() => { v.__syncPlay = false; });
        }
      }
    }, { rootMargin: '200px' });   // start a shade before it is actually on screen
  }
  visible.set(video, false);   // assume off-screen until the observer says otherwise
  observer.observe(video);
}

function unwatch(video) {
  if (observer) try { observer.unobserve(video); } catch (_) {}
  visible.delete(video);
  pendingTime.delete(video);
}

// --- exclusive audio ownership ---------------------------------------------
// The one synced video allowed to make sound. null until the user starts a clip.
let audioOwner = null;
let onOwner = null;   // callback so the volume system re-applies level/mute on change

export function getAudioOwner() {
  // A leftover owner from a previous analysis (now detached) must not silence the
  // next file's players - drop it so ownership starts clean for the new clip.
  if (audioOwner && !audioOwner.isConnected) audioOwner = null;
  return audioOwner;
}
export function isSynced(video) { return players.has(video); }
// Register a callback fired whenever the audio owner changes (the volume system
// uses it to push the shared level/mute onto the new owner and mute the rest).
export function onAudioOwner(cb) { onOwner = cb; }

// Make `video` the sole audio source: unmute it, mute every other synced player.
export function claimAudio(video) {
  if (!video || !players.has(video)) return;
  audioOwner = video;
  for (const v of live()) { try { v.muted = (v !== video); } catch (_) {} }
  if (onOwner) try { onOwner(video); } catch (_) {}
}

// --- audio companion --------------------------------------------------------
// Some clips carry an audio codec browsers can't decode (e.g. Sony's PCM 'twos'),
// so the <video> plays mute no matter what. video.js extracts that audio to a
// playable <audio> and registers it here as the "companion": it is NOT a synced
// video (exclusive-audio ownership leaves it alone) - it simply shadows whichever
// video owns the audio (same play / pause / seek, nudged back into step during
// playback). The shared-volume system drives its level/mute. Result: you hear the
// clip you pressed, in sync with the picture, with no echo.
let companion = null;
export function setAudioCompanion(audioEl) {
  companion = audioEl || null;
  if (onOwner) try { onOwner(companion); } catch (_) {}   // let the volume system adopt it
}
export function getAudioCompanion() { return companion; }
function shadow(t, play?) {
  if (!companion) return;
  if (isFinite(t) && Math.abs(companion.currentTime - t) > 0.15) { try { companion.currentTime = t; } catch (_) {} }
  if (play === true) { if (companion.paused) { const p = companion.play(); if (p && p.catch) p.catch(() => {}); } }
  else if (play === false) { if (!companion.paused) { try { companion.pause(); } catch (_) {} } }
}

// Push src's time onto target, but only if meaningfully different, and tag the
// resulting 'seeking' as an echo so it isn't propagated back.
function pushTime(target, t) {
  if (!isFinite(t) || Math.abs(target.currentTime - t) < 0.06) return;
  target.__syncSeek = (target.__syncSeek || 0) + 1;
  try { target.currentTime = t; } catch (_) { target.__syncSeek = Math.max(0, (target.__syncSeek || 1) - 1); }
}

// Register a <video> so it stays in sync with every other registered player.
// Returns an unregister function. Safe to call more than once per element.
export function registerSyncedVideo(video) {
  if (!video || players.has(video)) return () => {};
  live();                       // prune stale entries from previous analyses
  players.add(video);
  watch(video);                 // track whether it is on screen (see above)

  video.addEventListener('play', () => {
    if (video.__syncPlay) { video.__syncPlay = false; return; }      // echo of a synced play
    claimAudio(video);          // a user-started play takes over the audio
    shadow(video.currentTime, true);   // start the companion audio alongside it
    pauseLoners();              // a synced play stops the standalone preview(s)
    for (const v of others(video)) {
      // Off-screen followers bank the time instead of decoding it - see the
      // "decode only what is on screen" note above.
      if (!seen(v)) { pendingTime.set(v, video.currentTime); continue; }
      pushTime(v, video.currentTime);
      if (v.paused) { v.__syncPlay = true; const p = v.play(); if (p && p.catch) p.catch(() => { v.__syncPlay = false; }); }
    }
  });
  video.addEventListener('pause', () => {
    if (video.__syncPause) { video.__syncPause = false; return; }    // echo of a synced pause
    if (audioOwner === video) shadow(video.currentTime, false);
    for (const v of others(video)) if (!v.paused) { v.__syncPause = true; v.pause(); }
  });
  video.addEventListener('seeking', () => {
    if (audioOwner === video) shadow(video.currentTime);
    if (video.__syncSeek) { video.__syncSeek -= 1; return; }         // echo of a synced seek
    // A seek on a hidden follower is a full decode too (the browser has to build
    // the frame to satisfy it), and a scrub fires these continuously - so hidden
    // players bank the position and take it when they appear.
    for (const v of others(video)) {
      if (seen(v)) pushTime(v, video.currentTime);
      else pendingTime.set(v, video.currentTime);
    }
  });
  // Keep the companion in step during playback (it's an independent decoder, so it
  // drifts); only the owner's clock drives it. shadow()'s 0.15s deadband stops this
  // from seeking every tick.
  video.addEventListener('timeupdate', () => { if (audioOwner === video && !video.paused) shadow(video.currentTime, true); });
  video.addEventListener('ended', () => { if (audioOwner === video) shadow(video.currentTime, false); });
  video.addEventListener('emptied', () => { unwatch(video); players.delete(video); if (audioOwner === video) audioOwner = null; });

  return () => { unwatch(video); players.delete(video); if (audioOwner === video) audioOwner = null; };
}
