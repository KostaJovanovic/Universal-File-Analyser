/* Analyser - Asteroids easter egg: end-of-game leaderboard (DOM, overlaid on canvas).
   The name-entry / top-5 panel, the client-side rate limiting (one submit per minute,
   15 per device per day, remembered name kept forever), and the /api score endpoints.
   Best-effort client-side only. The canvas-drawn left-margin board + GAME OVER fallback
   live in render.js. */

import { NAME_KEY, SUBMIT_KEY, DAY_MS, MIN_MS, MAX_PER_DAY, POWERUP_DEF, STARTWAVE_KEY } from './config.js';
import { g, maxStartWave } from './state.js';
import { restart } from './world.js';

export function clearEndPanel() {
  if (g.endPanel) { g.endPanel.remove(); g.endPanel = null; }
  g.nameEntry = false;
}

export function rememberedName() {
  try {
    const raw = JSON.parse(localStorage.getItem(NAME_KEY) || 'null');
    if (raw && raw.name) return String(raw.name);   // never expires
  } catch (_) {}
  return '';
}
export function rememberName(name) {
  try { localStorage.setItem(NAME_KEY, JSON.stringify({ name, ts: Date.now() })); } catch (_) {}
}
const dayBucket = () => Math.floor(Date.now() / DAY_MS);
function submitRecord() {
  try { return JSON.parse(localStorage.getItem(SUBMIT_KEY) || 'null'); } catch (_) { return null; }
}
function submitsToday() {
  const raw = submitRecord();
  return (raw && raw.day === dayBucket()) ? (raw.count || 0) : 0;
}
function lastSubmit() {
  const raw = submitRecord();
  return (raw && typeof raw.ts === 'number') ? raw.ts : 0;
}
// Two gates: at least a minute since the last submission, and under the daily cap.
export function canSubmitToday() { return Date.now() - lastSubmit() >= MIN_MS && submitsToday() < MAX_PER_DAY; }
function markSubmitted() {
  try { localStorage.setItem(SUBMIT_KEY, JSON.stringify({ day: dayBucket(), count: submitsToday() + 1, ts: Date.now() })); } catch (_) {}
}

// Game-over headline shown at the top of the end card: GAME OVER + score + high.
function endHeaderNodes() {
  const go = document.createElement('div');
  go.className = 'anr-score-go'; go.textContent = 'GAME OVER';
  const sub = document.createElement('div');
  sub.className = 'anr-score-sub'; sub.textContent = 'score ' + g.score + ' · wave ' + g.wave;
  const hi = document.createElement('div');
  hi.className = 'anr-score-sub';
  if (g.newHigh) { hi.textContent = '★ NEW HIGH SCORE'; hi.style.color = POWERUP_DEF.health.color; }
  else { hi.textContent = 'high ' + g.highScore; hi.style.color = g.MUTED; }
  return [go, sub, hi];
}

// Build a <ol> of the top 5, highlighting the player's own freshly-posted row.
function leaderboardList(top, mineIdx) {
  const ol = document.createElement('ol');
  ol.className = 'anr-score-list';
  if (!top || !top.length) {
    const li = document.createElement('li');
    li.textContent = 'No scores yet'; li.style.justifyContent = 'center'; li.style.color = g.MUTED;
    ol.appendChild(li); return ol;
  }
  top.forEach((s, i) => {
    const li = document.createElement('li');
    if (i === mineIdx) li.className = 'me';
    const r = document.createElement('span'); r.className = 'r'; r.textContent = (i + 1) + '.';
    const n = document.createElement('span'); n.className = 'n'; n.textContent = s.name;
    const sc = document.createElement('span'); sc.className = 's'; sc.textContent = Number(s.score).toLocaleString();
    li.append(r, n, sc); ol.appendChild(li);
  });
  return ol;
}

// After submit or skip: show the board plus play-again / exit.
function showLeaderboardView(top, mineName) {
  if (!g.endPanel) return;
  g.nameEntry = false;
  g.endPanel.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'anr-score-title'; title.textContent = 'HIGH SCORES';
  const mineIdx = mineName && top ? top.findIndex((s) => s.name === mineName) : -1;
  const row = document.createElement('div'); row.className = 'anr-score-row';
  const again = document.createElement('button');
  again.type = 'button'; again.className = 'anr-game-btn'; again.textContent = 'Play again';
  again.style.cssText = 'padding:7px 12px;font-size:13px;';
  again.addEventListener('click', restart);
  // Once the start-wave picker is unlocked, offer a one-tap jump to the deepest
  // wave you've earned, in place of Exit; otherwise keep the Exit button.
  const second = document.createElement('button');
  second.type = 'button'; second.className = 'anr-game-btn';
  second.style.cssText = 'padding:7px 12px;font-size:13px;';
  const maxWave = maxStartWave();
  if (g.bossEverBeaten && maxWave > 1) {
    second.textContent = 'Start W' + maxWave;
    second.title = 'Jump straight to your deepest unlocked wave';
    second.addEventListener('click', () => {
      g.startWavePref = maxWave;
      try { localStorage.setItem(STARTWAVE_KEY, String(maxWave)); } catch (_) {}
      if (g.startToggleBtn) { g.startToggleBtn.textContent = 'START W' + maxWave; g.startToggleBtn.classList.add('on'); }
      restart();
    });
  } else {
    second.textContent = 'Exit';
    second.addEventListener('click', () => g.teardown());
  }
  row.append(again, second);
  g.endPanel.append(...endHeaderNodes(), title, leaderboardList(top, mineIdx), row);
}

// Fetch the current top 5 into g.leaderboard (drawn in the left margin).
export async function loadLeaderboard() {
  try {
    const resp = await fetch('/api/leaderboard', { headers: { accept: 'application/json' } });
    const data = await resp.json().catch(() => ({}));
    if (data && Array.isArray(data.top)) g.leaderboard = data.top;
  } catch (_) {}
}

// Skip submitting: just fetch and show the current board.
async function skipToLeaderboard() {
  await loadLeaderboard();
  if (g.endPanel) showLeaderboardView(g.leaderboard, null);
}

// POST this run's score under `name`, then show the returned board.
async function submitScore(name, msgEl, submitBtn) {
  if (submitBtn) submitBtn.disabled = true;
  if (msgEl) { msgEl.className = 'anr-score-msg'; msgEl.textContent = 'Sending...'; }
  try {
    const resp = await fetch('/api/score', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, score: g.score, wave: g.wave, cause: g.cause })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) {
      if (msgEl) { msgEl.className = 'anr-score-msg err'; msgEl.textContent = data.error || 'Could not send score.'; }
      if (submitBtn) submitBtn.disabled = false;
      return;
    }
    g.scoreDone = true;
    rememberName(name);   // prefill next time (kept forever)
    markSubmitted();      // rate limit: one per minute, 15 per day
    g.leaderboard = data.top || g.leaderboard;
    showLeaderboardView(data.top, name);
  } catch (_) {
    if (msgEl) { msgEl.className = 'anr-score-msg err'; msgEl.textContent = 'Offline - score not sent.'; }
    if (submitBtn) submitBtn.disabled = false;
  }
}

// Name-entry view: a 5-char [A-Z0-9] field, Submit and Skip.
function showSubmitView() {
  clearEndPanel();
  g.nameEntry = true;
  g.endPanel = document.createElement('div');
  g.endPanel.className = 'anr-score-panel';
  const title = document.createElement('div');
  title.className = 'anr-score-title'; title.textContent = 'ENTER NAME';
  const hint = document.createElement('div');
  hint.className = 'anr-score-msg'; hint.textContent = '5 letters or numbers';
  const input = document.createElement('input');
  input.type = 'text'; input.className = 'anr-score-input';
  input.maxLength = 5; input.autocomplete = 'off'; input.spellcheck = false;
  input.setAttribute('aria-label', 'Leaderboard name, 5 letters or numbers');
  input.value = rememberedName();   // prefill with the remembered name (kept forever)
  input.addEventListener('input', () => {
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  });
  const msg = document.createElement('div');
  msg.className = 'anr-score-msg';
  const row = document.createElement('div'); row.className = 'anr-score-row';
  const submit = document.createElement('button');
  submit.type = 'button'; submit.className = 'anr-game-btn'; submit.textContent = 'Submit';
  submit.style.cssText = 'padding:7px 12px;font-size:13px;';
  const skip = document.createElement('button');
  skip.type = 'button'; skip.className = 'anr-game-btn'; skip.textContent = 'Skip';
  skip.style.cssText = 'padding:7px 12px;font-size:13px;';
  const doSubmit = () => {
    const name = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (name.length !== 5) { msg.className = 'anr-score-msg err'; msg.textContent = 'Need 5 letters or numbers.'; input.focus(); return; }
    submitScore(name, msg, submit);
  };
  submit.addEventListener('click', doSubmit);
  skip.addEventListener('click', () => { g.scoreDone = true; skipToLeaderboard(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSubmit(); } });
  row.append(submit, skip);
  g.endPanel.append(...endHeaderNodes(), title, hint, input, msg, row);
  g.overlay.appendChild(g.endPanel);
  setTimeout(() => input.focus(), 30);   // focus once it's in the DOM (helps on mobile)
}

// End the run. Prompt to post the score only if this run beat the player's personal best,
// unless it's already been sent this run or the device hit the daily cap. Otherwise just
// show the board.
export function endGame() {
  if (g.gameOver) return;
  g.gameOver = true;
  g.mobileControls.forEach((elm) => { elm.style.display = 'none'; });
  if (g.pauseBtn) g.pauseBtn.style.display = 'none';
  g.input.left = g.input.right = g.input.thrust = g.input.fire = false;
  g.joy.active = false; g.joy.mag = 0;
  if (g.newHigh && !g.scoreDone && !g.sandboxUsed && canSubmitToday()) showSubmitView();
  else { g.endPanel = document.createElement('div'); g.endPanel.className = 'anr-score-panel'; g.overlay.appendChild(g.endPanel); skipToLeaderboard(); }
}
