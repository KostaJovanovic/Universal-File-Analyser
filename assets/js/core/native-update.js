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

function invoke(cmd, args) {
  const core = typeof window !== 'undefined' && window.__TAURI__ && window.__TAURI__.core;
  if (!core || typeof core.invoke !== 'function') return Promise.reject(new Error('Tauri IPC unavailable'));
  return core.invoke(cmd, args);
}

function notice(msg) {
  // One-button modal reusing the shared confirm styling.
  return anrConfirm(msg, 'OK', { kicker: 'Update', hideCancel: true });
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
      // Downloads, installs, then relaunches - does not return on success.
      await invoke('install_update');
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
