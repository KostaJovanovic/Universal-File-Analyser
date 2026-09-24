/* Analyser desktop - updates.
 *
 * .github/workflows/release.yml publishes each version as ONE GitHub release
 * with one file per system, and no update file beside them. The app asks
 * GitHub's API for the latest release instead: the answer gives the tag, the
 * download URL of every file and the SHA-256 digest GitHub computed for it.
 *
 * Two kinds of copy can replace themselves:
 *
 *   installer  The Windows install (its uninstaller sits beside the exe). The
 *              new installer downloads in the background, and its digest must
 *              match. It then runs silently (/S --updated) when the app quits,
 *              or at once on "Restart now". NSIS installs over the old copy in
 *              the same folder and keeps every setting.
 *   appimage   Linux. The new AppImage downloads beside the running one, its
 *              digest must match, and it takes the old file's place. The next
 *              start runs it, or "Restart now" does.
 *
 * Everything else only announces a new version and opens the download page: a
 * portable copy (portable.txt beside the exe, see main.mjs), and macOS, where
 * an app without an Apple Developer ID signature cannot install an update.
 *
 * A development copy (desktop.bat, npm start) never checks.
 *
 * What a check sends: one HTTPS request to api.github.com. No file, no history,
 * nothing about what was analysed.
 */

import { app, dialog, net, shell } from 'electron';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

const OWNER = 'KostaJovanovic';
const REPO = 'Universal-File-Analyser';
/** The one place every build can be downloaded from. */
export const DOWNLOAD_PAGE = `https://github.com/${OWNER}/${REPO}/releases/latest`;
const API = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;

/** The release file each self-updating kind downloads. A name ends in the
 *  version (Analyser-Windows-9.9.0.exe), so a file is found by the part before
 *  it. The unversioned name that 9.8 and earlier shipped still matches. */
const ASSET = {
  installer: { name: 'Analyser-Windows-<version>.exe', match: /^Analyser-Windows(-\d+(\.\d+)*)?\.exe$/ },
  appimage: { name: 'Analyser-linux-x64-<version>.AppImage', match: /^Analyser-linux-x64(-\d+(\.\d+)*)?\.AppImage$/ },
};

/** The first check waits for start-up to settle, then one runs every six hours. */
const FIRST_CHECK_MS = 20 * 1000;
const EVERY_MS = 6 * 60 * 60 * 1000;

/** The API answer must arrive within this, and a download may go this long
 *  without a byte before it is abandoned - a stalled request would otherwise
 *  hold `busy` for the rest of the session. */
const API_TIMEOUT_MS = 20 * 1000;
const DOWNLOAD_IDLE_MS = 60 * 1000;

/** A check the PAGE asked for (the footer button, via the preload) is dropped
 *  silently while a check runs, while any update dialog is open, or within
 *  this long of the last one - so a page that calls it in a loop cannot stack
 *  modal dialogs. Help > Check for updates is not limited. */
const PAGE_CHECK_GAP_MS = 10 * 1000;

/** Where a release file may come from: this repository's release downloads on
 *  github.com, and GitHub's asset storage (objects.githubusercontent.com,
 *  release-assets.githubusercontent.com, ...) that those redirect to. Anything
 *  else in the API answer, or at the end of the redirects, is refused. */
const GITHUB_ASSET_HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.githubusercontent\.com$/;

let kind = 'dev';
let portableCopy = false;
let getWindow = () => null;
let busy = false;
/** A downloaded update waiting to take over: { version, file }, or null. */
let ready = null;
/** The installer was started, so quitting must not start it twice. */
let launched = false;
/** Versions the user answered "Later" to. The automatic check stays quiet about
 *  them for the rest of the session. The menu entry still reports them. */
const declined = new Set();
/** Update dialogs currently open, and when the page last asked for a check. */
let dialogsOpen = 0;
let lastPageCheck = 0;

/** How this copy was installed - see the header. */
export function installKind(portable) {
  if (!app.isPackaged) return 'dev';
  if (process.platform === 'win32') {
    if (portable) return 'manual';
    // The NSIS installer leaves its uninstaller beside the executable. A
    // portable copy has none, and must not be "updated" by an installer that
    // would put a second copy somewhere else.
    const uninstaller = join(dirname(app.getPath('exe')), `Uninstall ${app.getName()}.exe`);
    return existsSync(uninstaller) ? 'installer' : 'manual';
  }
  if (process.platform === 'linux' && process.env.APPIMAGE) return 'appimage';
  return 'manual';
}

/** Start the automatic checks. `window` returns the main window, or null. */
export function startUpdates({ window, portable }) {
  portableCopy = !!portable;
  kind = installKind(portableCopy);
  getWindow = window;
  if (kind === 'dev') return;
  if (kind === 'installer') {
    rmSync(downloadDir(), { recursive: true, force: true });
    // Where 9.12 and earlier kept it.
    rmSync(join(app.getPath('temp'), 'analyser-update'), { recursive: true, force: true });
    // "Later" still installs: the downloaded installer runs as the app closes,
    // silently, without starting the app again.
    app.on('will-quit', () => runInstaller(false));
  }
  if (kind === 'appimage') {
    for (const stale of [process.env.APPIMAGE + '.new', process.env.APPIMAGE + '.new.part']) rmSync(stale, { force: true });
  }
  setTimeout(() => check(false), FIRST_CHECK_MS);
  setInterval(() => check(false), EVERY_MS);
}

/** Help > Check for updates. Unlike the automatic check, it always answers. */
export function checkForUpdates() {
  return check(true);
}

/** The same check, asked for by the page (see PAGE_CHECK_GAP_MS). A dropped
 *  request resolves quietly: there is nothing the page could do with an error. */
export function checkForUpdatesFromPage() {
  const now = Date.now();
  if (busy || dialogsOpen > 0 || now - lastPageCheck < PAGE_CHECK_GAP_MS) return Promise.resolve();
  lastPageCheck = now;
  return check(true);
}

/** '9.1.0' -> '9.1', the label the footer shows. */
const label = (v) => String(v || '').replace(/\.0$/, '');

/** True when version `a` is newer than `b`, compared number by number. */
function newer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

/* Under userData, not %TEMP%: the installer sits there until the app quits and
   then runs, and a folder only this user's profile holds is a smaller target
   than the shared temp directory. It is re-hashed right before it runs too. */
const downloadDir = () => join(app.getPath('userData'), 'update');

/** True for an https URL GitHub serves release files from (see
 *  GITHUB_ASSET_HOST). `first` is the URL from the API answer, which must be
 *  this repository's own release download on github.com. */
function allowedDownload(url, first) {
  let u;
  try { u = new URL(String(url || '')); } catch (_) { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  if (u.hostname === 'github.com') return u.pathname.startsWith(`/${OWNER}/${REPO}/releases/download/`);
  return !first && GITHUB_ASSET_HOST.test(u.hostname);
}

async function latestRelease() {
  const res = await net.fetch(API, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  if (!res.ok) throw new Error('GitHub answered ' + res.status);
  const rel = await res.json();
  const assets = Array.isArray(rel.assets) ? rel.assets : [];
  return {
    version: String(rel.tag_name || '').replace(/^v/, ''),
    asset: (match) => assets.find((a) => a && match.test(String(a.name))) || null,
  };
}

/** Download a release asset to `dest`, hashing as it streams. Nothing lands at
 *  `dest` unless the SHA-256 matches the digest GitHub gives for the file. */
async function download(asset, dest) {
  const want = /^sha256:([0-9a-f]{64})$/.exec(String(asset.digest || ''));
  if (!want) throw new Error('the release gives no SHA-256 for ' + asset.name);
  const size = Number(asset.size);
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error('the release gives no size for ' + asset.name);
  if (!allowedDownload(asset.browser_download_url, true)) throw new Error('the release points outside GitHub for ' + asset.name);
  // An idle timer rather than a total one: a slow line may take minutes over a
  // large file, but a connection that sends nothing for a minute is dead.
  const ctl = new AbortController();
  let idle = setTimeout(() => ctl.abort(), DOWNLOAD_IDLE_MS);
  const poke = () => { clearTimeout(idle); idle = setTimeout(() => ctl.abort(), DOWNLOAD_IDLE_MS); };
  const part = dest + '.part';
  const hash = createHash('sha256');
  let out = null;
  try {
    const res = await net.fetch(String(asset.browser_download_url), { signal: ctl.signal });
    if (!res.ok || !res.body) throw new Error('the download failed: ' + res.status);
    // Where the redirects ended up must be GitHub's too.
    if (res.url && !allowedDownload(res.url, false)) throw new Error('the download was redirected outside GitHub');
    mkdirSync(dirname(dest), { recursive: true });
    out = createWriteStream(part);
    let got = 0;
    for await (const chunk of res.body) {
      poke();
      got += chunk.length;
      // Never more than the release says the file is.
      if (got > size) throw new Error('the download is larger than the release says');
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve));
    }
    if (got !== size) throw new Error('the download is shorter than the release says');
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  } catch (err) {
    if (out) out.destroy();
    rmSync(part, { force: true });
    throw err;
  } finally {
    clearTimeout(idle);
  }
  if (hash.digest('hex') !== want[1]) {
    rmSync(part, { force: true });
    throw new Error('the download does not match its SHA-256');
  }
  rmSync(dest, { force: true });
  renameSync(part, dest);
}

/** Fetch the update for a self-updating copy, and leave it ready to take over. */
async function fetchUpdate(version, asset) {
  if (kind === 'installer') {
    // The name from the API answer is only used as a file name, so strip it to
    // one: no folder, nothing Windows would read as a device or a stream.
    const safe = String(asset.name).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_') || 'update.exe';
    const file = join(downloadDir(), safe);
    await download(asset, file);
    ready = { version, file, sha256: String(asset.digest).slice('sha256:'.length) };
  } else {
    // Beside the running AppImage, so the rename below stays on one disk.
    // Linux lets a running file be replaced: this copy keeps running from the
    // old one until it quits.
    const target = process.env.APPIMAGE;
    const next = target + '.new';
    await download(asset, next);
    chmodSync(next, 0o755);
    renameSync(next, target);
    ready = { version, file: target };
  }
}

function runInstaller(restart) {
  if (kind !== 'installer' || !ready || launched) return;
  launched = true;
  // Hashed again right before it runs: the file sat on disk since the download,
  // and a check made then says nothing about what is there now.
  try {
    if (createHash('sha256').update(readFileSync(ready.file)).digest('hex') !== ready.sha256) throw new Error('changed');
  } catch (_) {
    rmSync(ready.file, { force: true });
    ready = null;
    return;
  }
  const args = ['/S', '--updated'];
  if (restart) args.push('--force-run');
  try {
    const child = spawn(ready.file, args, { detached: true, stdio: 'ignore' });
    // Without a listener, a spawn failure (the file removed, blocked by
    // antivirus) is an uncaught error in the main process during will-quit.
    child.on('error', () => {});
    child.unref();
  } catch (_) { /* the next start downloads it again */ }
}

async function check(manual) {
  if (kind === 'dev') {
    if (manual) tell('Updates are off in a development copy', 'This copy runs the code in the desktop folder, so there is nothing to update.');
    return;
  }
  if (ready) {
    if (manual) offerRestart();
    return;
  }
  if (busy) {
    if (manual) tell('Analyser is already checking for an update', 'Try again in a moment.');
    return;
  }
  busy = true;
  try {
    const rel = await latestRelease();
    if (!newer(rel.version, app.getVersion())) {
      if (manual) tell('Analyser is up to date', `Version ${label(app.getVersion())} is the latest release.`);
      return;
    }
    if (kind === 'installer' || kind === 'appimage') {
      const asset = rel.asset(ASSET[kind].match);
      if (!asset) throw new Error('the release has no ' + ASSET[kind].name);
      if (manual) tell(`Analyser ${label(rel.version)} is downloading`, 'A message offers a restart as soon as the download is done.');
      await fetchUpdate(rel.version, asset);
      offerRestart();
      return;
    }
    if (manual || !declined.has(rel.version)) offerDownload(rel.version);
  } catch (err) {
    // A background failure (offline, GitHub down, a bad download) stays
    // silent, and the next check tries again.
    if (manual) {
      tell('Analyser could not update',
        'Check the connection, then try again.\n\n' + String((err && err.message) || err).slice(0, 300));
    }
  } finally {
    busy = false;
  }
}

function show(options) {
  const win = getWindow();
  const opts = Object.assign({ type: 'info', title: 'Analyser', noLink: true }, options);
  dialogsOpen++;
  return (win && !win.isDestroyed() ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts))
    .catch(() => ({ response: -1 }))
    .then((r) => { dialogsOpen--; return r; });
}

function tell(message, detail) {
  show({ message, detail, buttons: ['Close'] });
}

function offerRestart() {
  if (!ready) return;
  show({
    message: `Analyser ${label(ready.version)} is ready`,
    detail: kind === 'installer'
      ? 'Restart now to finish the update, or keep working and it installs when you quit.'
      : 'Restart now to start the new version, or keep working and it starts next time.',
    buttons: ['Restart now', 'Later'],
    defaultId: 0,
    cancelId: 1,
  }).then((r) => {
    if (r.response !== 0) return;
    if (kind === 'installer') {
      // The installer waits for this copy to close, installs, then starts
      // the new version (--force-run).
      runInstaller(true);
    } else {
      // relaunch starts the new file once this process has gone, so the two
      // never meet at the single-instance lock.
      app.relaunch({ execPath: process.env.APPIMAGE, args: [] });
    }
    app.quit();
  });
}

function offerDownload(version) {
  let how;
  if (process.platform === 'darwin') how = 'Download it, then drag it into Applications to replace this copy. Your settings stay.';
  else if (portableCopy) how = 'Download the new Windows file, run it, choose "Portable copy", and pick this folder. The Analyser-data folder here keeps your settings.';
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
