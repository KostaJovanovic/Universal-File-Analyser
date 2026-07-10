/* Analyser - native (Tauri) auto-updater UI.

   Loaded ONLY under the native shell (dynamic-imported from app.js when
   window.__TAURI__ is present), so it never runs on the website. It calls the
   check_for_update / install_update commands in native/src-tauri/src/lib.rs,
   which talk to GitHub Releases via tauri-plugin-updater. The user always
   confirms before anything downloads; installing relaunches the app.

   The visible "Check for updates" entry point is window.anrCheckForUpdates(),
   wired here so a menu item / button (or the console) can trigger a manual check
   that also reports "you are up to date". */

import { anrConfirm } from './overlays.js';
import { el, asciiBar } from './util.js';

function invoke(cmd, args) {
  const core = typeof window !== 'undefined' && window.__TAURI__ && window.__TAURI__.core;
  if (!core || typeof core.invoke !== 'function') return Promise.reject(new Error('Tauri IPC unavailable'));
  return core.invoke(cmd, args);
}

function notice(msg) {
  // One-button modal reusing the shared confirm styling.
  return anrConfirm(msg, 'OK', { kicker: 'Update', hideCancel: true });
}

// Run the install while showing the site's bottom-of-window download bar (same
// component the FFmpeg core download uses), driven by the update://progress and
// update://finished events the Rust install_update command emits. Determinate
// while the byte total is known, indeterminate otherwise and during install.
async function installWithProgress() {
  const ev = typeof window !== 'undefined' && window.__TAURI__ && window.__TAURI__.event;
  const bar = asciiBar({ fit: true });
  const labelEl = el('div', { class: 'anr-drop-loader-label' }, 'Downloading update…');
  const loader = el('div', { class: 'anr-drop-loader', role: 'status', 'aria-live': 'polite' }, [labelEl, bar]);
  document.body.appendChild(loader);
  bar.set(0);
  requestAnimationFrame(() => loader.classList.add('is-open'));

  const unlisten = [];
  try {
    if (ev && typeof ev.listen === 'function') {
      unlisten.push(await ev.listen('update://progress', (e) => {
        const p = (e && e.payload) || [];       // [bytesSoFar, totalOrNull]
        const done = p[0] || 0, total = p[1];
        if (total && total > 0) {
          bar.set(Math.max(0, Math.min(1, done / total)));
          labelEl.textContent = 'Downloading update… ' + Math.round((done / total) * 100) + '%';
        } else {
          bar.indeterminate();
        }
      }));
      unlisten.push(await ev.listen('update://finished', () => {
        bar.indeterminate();
        labelEl.textContent = 'Installing update… Analyser will restart';
      }));
    }
    // On success the app restarts, so this never resolves; on failure it throws.
    await invoke('install_update');
  } finally {
    for (const u of unlisten) { try { u(); } catch (_) {} }
    loader.classList.remove('is-open');
    if (bar.stop) { try { bar.stop(); } catch (_) {} }
    setTimeout(() => { try { loader.remove(); } catch (_) {} }, 300);
  }
}

let _busy = false;

// interactive=true  (manual "check now"): also report "up to date" and errors.
// interactive=false (silent launch check): stay quiet unless an update exists.
export async function checkForUpdate(interactive) {
  if (_busy) return;
  _busy = true;
  try {
    let info;
    try {
      info = await invoke('check_for_update');
    } catch (e) {
      if (interactive) await notice('Could not check for updates right now. ' + (e && e.message || e));
      return;
    }
    if (!info) {
      if (interactive) await notice('Analyser is up to date.');
      return;
    }
    const go = await anrConfirm(
      'Version ' + info.version + ' is available. Download and install it now? Analyser will restart to finish.',
      'Update now',
      { kicker: 'Update available', cancelLabel: 'Later' }
    );
    if (!go) return;
    try {
      // Downloads (with a progress bar), installs, then relaunches - does not
      // return on success.
      await installWithProgress();
    } catch (e) {
      await notice('The update could not be installed. ' + (e && e.message || e));
    }
  } finally {
    _busy = false;
  }
}

// Expose the manual entry point + run one silent check per launch. Idempotent;
// app.js calls it once on boot under the shell.
let _inited = false;
export function initNativeUpdater() {
  if (_inited) return;
  _inited = true;
  try { window.anrCheckForUpdates = () => checkForUpdate(true); } catch (_) {}
  // Delay the launch check so it never competes with first paint / analysis.
  setTimeout(() => { checkForUpdate(false); }, 3500);
}
