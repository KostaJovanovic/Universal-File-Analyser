/* Analyser desktop - updates.
 *
 * .github/workflows/release.yml publishes every build to ONE GitHub release,
 * together with the latest.yml, latest-mac.yml and latest-linux.yml files that
 * electron-builder writes. electron-updater reads those. What happens next
 * depends on how this copy was installed, because only two kinds of copy can
 * replace themselves:
 *
 *   installer  The NSIS install on Windows and the AppImage on Linux. The new
 *              version downloads in the background and installs when the app
 *              quits, or at once when the user picks "Restart now".
 *   manual     Everything else: the portable .exe, the zip, the .deb and macOS.
 *              The app says a new version is out and opens the download page.
 *              macOS is here because Squirrel.Mac installs only an app signed
 *              with an Apple Developer ID, and these builds carry an ad-hoc
 *              signature (tools/after-pack.cjs). The .deb is here because its
 *              install needs a password prompt, which a background update must
 *              never spring on anyone.
 *
 * A development copy (desktop.bat, npm start) never checks.
 *
 * What a check sends: one HTTPS request to github.com for the update file of
 * the latest release. No file, no history, nothing about what was analysed.
 */

import { app, dialog, shell } from 'electron';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const OWNER = 'KostaJovanovic';
const REPO = 'Universal-File-Analyser';
/** The one place every build can be downloaded from. */
export const DOWNLOAD_PAGE = `https://github.com/${OWNER}/${REPO}/releases/latest`;

/** The first check waits for start-up to settle, then one runs every six hours. */
const FIRST_CHECK_MS = 20 * 1000;
const EVERY_MS = 6 * 60 * 60 * 1000;

let kind = 'dev';
let portableCopy = false;
let getWindow = () => null;
let updater = null;
let busy = false;
/** A downloaded version waiting for a restart, or ''. */
let ready = '';
/** Versions the user answered "Later" to. The automatic check stays quiet about
 *  them for the rest of the session. The menu entry still reports them. */
const declined = new Set();

/** How this copy was installed - see the header. */
export function installKind(portable) {
  if (!app.isPackaged) return 'dev';
  if (process.platform === 'win32') {
    if (portable) return 'manual';
    // The NSIS installer leaves its uninstaller beside the executable. A copy
    // unzipped by hand has none, and must not be "updated" by an installer that
    // would put a second copy somewhere else.
    const uninstaller = join(dirname(app.getPath('exe')), `Uninstall ${app.getName()}.exe`);
    return existsSync(uninstaller) ? 'installer' : 'manual';
  }
  if (process.platform === 'linux') return process.env.APPIMAGE ? 'installer' : 'manual';
  return 'manual';
}

/** Start the automatic checks. `window` returns the main window, or null. */
export function startUpdates({ window, portable }) {
  portableCopy = !!portable;
  kind = installKind(portableCopy);
  getWindow = window;
  if (kind === 'dev') return;
  setTimeout(() => check(false), FIRST_CHECK_MS);
  setInterval(() => check(false), EVERY_MS);
}

/** Help > Check for updates. Unlike the automatic check, it always answers. */
export function checkForUpdates() {
  return check(true);
}

/** '9.1.0' -> '9.1', the label the footer shows. */
const label = (v) => String(v || '').replace(/\.0$/, '');

async function load() {
  if (updater) return updater;
  // Loaded on first use, so a development copy never loads it at all.
  const mod = await import('electron-updater');
  const u = (mod.default || mod).autoUpdater;
  // Set here rather than read from resources/app-update.yml, so a portable or
  // unzipped copy can check too. An installed copy still has that file, and
  // electron-updater reads it for the name of its download folder.
  u.setFeedURL({ provider: 'github', owner: OWNER, repo: REPO });
  u.autoDownload = kind === 'installer';
  u.autoInstallOnAppQuit = kind === 'installer';
  u.allowPrerelease = false;
  u.allowDowngrade = false;
  u.logger = null;
  // check() reports a failure when the user asked. A background failure (offline,
  // GitHub down) stays silent and the next check tries again.
  u.on('error', () => {});
  u.on('update-downloaded', (info) => offerRestart(info.version));
  updater = u;
  return u;
}

async function check(manual) {
  if (kind === 'dev') {
    if (manual) tell('Updates are off in a development copy', 'This copy runs the code in the desktop folder, so there is nothing to update.');
    return;
  }
  if (ready) {
    if (manual) offerRestart(ready);
    return;
  }
  if (busy) {
    if (manual) tell('Analyser is already checking for an update', 'Try again in a moment.');
    return;
  }
  busy = true;
  try {
    const u = await load();
    const r = await u.checkForUpdates();
    // With autoDownload on, the download carries on after the check resolves.
    // A failure there also reaches the 'error' listener, so the promise only
    // needs a catch.
    if (r && r.downloadPromise) r.downloadPromise.catch(() => {});
    if (!r || !r.isUpdateAvailable) {
      if (manual) tell('Analyser is up to date', `Version ${label(app.getVersion())} is the latest release.`);
      return;
    }
    const next = r.updateInfo.version;
    if (kind === 'installer') {
      if (manual) tell(`Analyser ${label(next)} is downloading`, 'It installs when you quit. A message offers a restart as soon as the download is done.');
      return;
    }
    if (manual || !declined.has(next)) offerDownload(next);
  } catch (err) {
    if (manual) {
      tell('Analyser could not check for updates',
        'GitHub did not answer. Check the connection, then try again.\n\n' + String((err && err.message) || err).slice(0, 300));
    }
  } finally {
    busy = false;
  }
}

function show(options) {
  const win = getWindow();
  const opts = Object.assign({ type: 'info', title: 'Analyser', noLink: true }, options);
  return (win && !win.isDestroyed() ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts))
    .catch(() => ({ response: -1 }));
}

function tell(message, detail) {
  show({ message, detail, buttons: ['Close'] });
}

function offerRestart(version) {
  ready = version;
  show({
    message: `Analyser ${label(version)} is ready to install`,
    detail: 'Restart now to finish the update, or keep working and it installs the next time you quit.',
    buttons: ['Restart now', 'Later'],
    defaultId: 0,
    cancelId: 1,
  }).then((r) => {
    // A silent install, then the new version starts.
    if (r.response === 0) setImmediate(() => updater.quitAndInstall(true, true));
  });
}

function offerDownload(version) {
  let how;
  if (process.platform === 'darwin') how = 'Download it, then drag it into Applications to replace this copy. Your settings stay.';
  else if (portableCopy) how = 'Download the new version and put it in this folder in place of this one. The Analyser-data folder beside it keeps your settings.';
  else if (process.platform === 'linux') how = 'Download the new .deb and install it over this one. Your settings stay.';
  else how = 'This copy cannot replace itself. Download the new version and use it in place of this one.';
  show({
    message: `Analyser ${label(version)} is out`,
    detail: how,
    buttons: ['Open the download page', 'Later'],
    defaultId: 0,
    cancelId: 1,
  }).then((r) => {
    if (r.response === 0) shell.openExternal(DOWNLOAD_PAGE).catch(() => {});
    else declined.add(version);
  });
}
