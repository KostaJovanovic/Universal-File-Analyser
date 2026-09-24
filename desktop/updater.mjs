/* Analyser desktop - updates.
 *
 * .github/workflows/release.yml publishes each version as ONE GitHub release
 * with one file per system, and no update file beside them. The app asks
 * GitHub's API for the latest release instead: the answer gives the tag, the
 * download URL of every file and the SHA-256 digest GitHub computed for it.
 *
 * Every answer goes to the title bar's Update button (chrome/titlebar.js), never
 * a native dialog - the same design as mbrd's desktop/updates.ts. A check only
 * FINDS a new version and puts the button up; a press on it downloads the
 * update, with the button counting, and then installs it.
 *
 * Two kinds of copy can replace themselves:
 *
 *   installer  The Windows install (its uninstaller sits beside the exe). The
 *              new installer downloads, its digest must match, and it runs
 *              silently (/S --updated --force-run) as the app quits, then
 *              starts the new version. NSIS installs over the old copy in the
 *              same folder and keeps every setting.
 *   appimage   Linux. The new AppImage downloads beside the running one, its
 *              digest must match, it takes the old file's place, and the app
 *              relaunches into it.
 *
 * Everything else only announces a new version, and a press opens the download
 * page: a portable copy (portable.txt beside the exe, see main.mjs), and macOS,
 * where an app without an Apple Developer ID signature cannot install an update.
 *
 * A development copy (desktop.bat, npm start) never checks.
 *
 * What a check sends: one HTTPS request to api.github.com. No file, no history,
 * nothing about what was analysed.
 */

import { app, net, shell } from 'electron';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

/** The first look waits for start-up to settle. After that the clock looks
 *  every hour and checks when the last answer is a day old, so a laptop asleep
 *  for a week checks within the hour it wakes, and a restart does not check
 *  again. The time of the last answer is kept in userData. */
const FIRST_CHECK_MS = 20 * 1000;
const LOOK_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** How long a passing answer ("Up to date") stays on the button. */
const PASSING_MS = 5000;

/** The API answer must arrive within this, and a download may go this long
 *  without a byte before it is abandoned - a stalled request would otherwise
 *  hold `busy` for the rest of the session. */
const API_TIMEOUT_MS = 20 * 1000;
const DOWNLOAD_IDLE_MS = 60 * 1000;

/** A check the PAGE asked for (the footer button, via the preload) is dropped
 *  while one runs or within this long of the last one. The answer is only a
 *  word on the button now, but a page calling it in a loop still should not
 *  turn into a request to GitHub per call. Help > Check for updates is not
 *  limited. */
const PAGE_CHECK_GAP_MS = 10 * 1000;

/** Where a release file may come from: this repository's release downloads on
 *  github.com, and GitHub's asset storage (objects.githubusercontent.com,
 *  release-assets.githubusercontent.com, ...) that those redirect to. Anything
 *  else in the API answer, or at the end of the redirects, is refused. */
const GITHUB_ASSET_HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.githubusercontent\.com$/;

/* What the button says, as { state, version, progress?, note }:
     available    a newer version this copy can install; a press downloads it
     downloading  `progress` counts from 0 to 1
     installing   the app is closing into the new version
     manual       this copy cannot replace itself; a press opens the download page
     failed       a press tries again
     checking, current, dev   answers to Help > Check for updates, which pass
   `note` is the whole sentence the word stands for - the tooltip. */

let kind = 'dev';
let portableCopy = false;
let started = false;
/** A check or a download is running. */
let busy = false;
/** Somebody asked (the menu or the footer), so the running check answers aloud. */
let asked = false;
/** The newer release this copy can install, found by the last check. */
let pending = null;
/** A downloaded update waiting to take over: { version, file, sha256 }, or null. */
let ready = null;
/** The installer was started, so quitting must not start it twice. */
let launched = false;
/** The press on Update asked for this quit, so the new version starts after it. */
let restartAfter = false;
/** What the button says for good, or null for no button. */
let offered = null;
/** A passing answer's timer. When it runs out the button goes back to `offered`. */
let passing = null;
let announce = () => {};
let lastPageCheck = 0;

/** Put a lasting state on the button. */
function publish(offer) {
  if (passing) clearTimeout(passing);
  passing = null;
  offered = offer;
  announce(offer);
}

/** Put a passing answer on the button, and after `ms` go back to what it said.
 *  With no `ms` it stays until the next answer replaces it. */
function say(offer, ms = 0) {
  if (passing) clearTimeout(passing);
  passing = null;
  announce(offer);
  if (ms) passing = setTimeout(() => { passing = null; announce(offered); }, ms);
}

/** The button's state, for a title bar that loads after the answer came. */
export const currentOffer = () => offered;

const stampFile = () => join(app.getPath('userData'), 'update-check.json');

/** When the last check got an answer, in ms since the epoch. 0 when never. */
function lastCheck() {
  try {
    const at = Number(JSON.parse(readFileSync(stampFile(), 'utf8')).at);
    return Number.isFinite(at) ? at : 0;
  } catch (_) {
    return 0;
  }
}

function stamp() {
  try { writeFileSync(stampFile(), JSON.stringify({ at: Date.now() })); } catch (_) { /* checks again sooner */ }
}

/** A day since the last answer, or a clock set back past it. */
function due() {
  const since = Date.now() - lastCheck();
  return since >= DAY_MS || since < 0;
}

/** Remove what an earlier update left, and never fail the start for it: the
 *  installer that has just updated this copy starts it again before it exits,
 *  so its own file can still be locked here (EBUSY on Windows). */
function tidy(path, recursive = false) {
  try { rmSync(path, { recursive, force: true }); } catch (_) { /* the next start tries again */ }
}

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

/** Start the automatic checks. `announce` puts an offer on the title bar's
 *  Update button (null takes the button away). */
export function startUpdates(opts) {
  // macOS makes a new window on a dock click, and the checks must not arm twice.
  if (started) return;
  started = true;
  portableCopy = !!opts.portable;
  kind = installKind(portableCopy);
  announce = typeof opts.announce === 'function' ? opts.announce : () => {};
  if (kind === 'dev') return;
  if (kind === 'installer') {
    tidy(downloadDir(), true);
    // Where 9.12 and earlier kept it.
    tidy(join(app.getPath('temp'), 'analyser-update'), true);
    // After the window has gone: the installer closes a copy that is still
    // running. A download that finished as the window was closing installs
    // too, silently, without starting the app again.
    app.on('will-quit', () => runInstaller(restartAfter));
  }
  if (kind === 'appimage') {
    for (const stale of [process.env.APPIMAGE + '.new', process.env.APPIMAGE + '.new.part']) tidy(stale);
  }
  const look = () => { if (due()) check(false); };
  setTimeout(look, FIRST_CHECK_MS);
  setInterval(look, LOOK_MS).unref();
}

/**
 * The title bar's Update button. A press does what the button says: download
 * the update then install it, open the download page for a copy that cannot
 * replace itself, or try again after a failure.
 */
export function clickUpdate() {
  if (!offered || busy) return;
  if (offered.state === 'manual') {
    shell.openExternal(DOWNLOAD_PAGE).catch(() => {});
    return;
  }
  if (offered.state !== 'available' && offered.state !== 'failed') return;
  // A failed download tries the download again. A failed check has nothing to
  // download yet, so it checks again.
  if (pending) downloadAndInstall(pending);
  else check(true);
}

/** Help > Check for updates. Unlike the automatic check, it always answers. */
export function checkForUpdates() {
  return check(true);
}

/** The same check, asked for by the page (see PAGE_CHECK_GAP_MS). A dropped
 *  request resolves quietly: there is nothing the page could do with an error. */
export function checkForUpdatesFromPage() {
  const now = Date.now();
  if (busy || now - lastPageCheck < PAGE_CHECK_GAP_MS) return Promise.resolve();
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

const errorText = (err) => String((err && err.message) || err).slice(0, 200);

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
  const assets = Array.isArray(rel && rel.assets) ? rel.assets : [];
  return {
    version: String((rel && rel.tag_name) || '').replace(/^v/, ''),
    asset: (match) => assets.find((a) => a && match.test(String(a.name))) || null,
  };
}

/** Download a release asset to `dest`, hashing as it streams, and report how
 *  much has come, in whole-percent steps. Nothing lands at `dest` unless the
 *  SHA-256 matches the digest GitHub gives for the file. */
async function download(asset, dest, onProgress) {
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
    let told = 0;
    for await (const chunk of res.body) {
      poke();
      got += chunk.length;
      // Never more than the release says the file is.
      if (got > size) throw new Error('the download is larger than the release says');
      hash.update(chunk);
      const share = got / size;
      if (share - told >= 0.01) { told = share; onProgress(share); }
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
async function fetchUpdate(version, asset, onProgress) {
  if (kind === 'installer') {
    // The name from the API answer is only used as a file name, so strip it to
    // one: no folder, nothing Windows would read as a device or a stream.
    const safe = String(asset.name).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_') || 'update.exe';
    const file = join(downloadDir(), safe);
    await download(asset, file, onProgress);
    ready = { version, file, sha256: String(asset.digest).slice('sha256:'.length) };
  } else {
    // Beside the running AppImage, so the rename below stays on one disk.
    // Linux lets a running file be replaced: this copy keeps running from the
    // old one until it quits.
    const target = process.env.APPIMAGE;
    if (!target) throw new Error('APPIMAGE is not set');
    const next = target + '.new';
    await download(asset, next, onProgress);
    chmodSync(next, 0o755);
    renameSync(next, target);
    ready = { version, file: target };
  }
}

/** The press on Update: download with the button counting, then install. */
async function downloadAndInstall(want) {
  busy = true;
  const v = label(want.version);
  const counting = (progress) => publish({
    state: 'downloading', version: want.version, progress,
    note: `Downloading Analyser ${v}. Analyser restarts into it when the download is done.`,
  });
  counting(0);
  try {
    await fetchUpdate(want.version, want.asset, counting);
    publish({ state: 'installing', version: want.version, note: `Restarting into Analyser ${v}` });
    install();
  } catch (err) {
    publish({
      state: 'failed', version: want.version,
      note: `Analyser ${v} did not download: ${errorText(err)}. Press to try again.`,
    });
  } finally {
    busy = false;
  }
}

/** Put the downloaded update in place and restart into it. */
function install() {
  if (kind === 'installer') {
    // The quit runs the installer from will-quit (startUpdates), which waits
    // for this copy to close, installs, then starts the new version.
    restartAfter = true;
  } else {
    // relaunch starts the new file once this process has gone, so the two
    // never meet at the single-instance lock.
    app.relaunch({ execPath: process.env.APPIMAGE, args: [] });
  }
  app.quit();
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

/** What a copy that cannot replace itself tells somebody to do. */
function manualHow(version) {
  const out = `Analyser ${label(version)} is out.`;
  if (process.platform === 'darwin') {
    return `${out} Press to open the download page, then drag the new copy into Applications. Your settings stay.`;
  }
  if (portableCopy) {
    return `${out} Press to open the download page, run the new Windows file, choose "Portable copy" and pick this folder. The Analyser-data folder here keeps your settings.`;
  }
  return `${out} This copy cannot replace itself. Press to open the download page.`;
}

async function check(manual) {
  if (kind === 'dev') {
    if (manual) say({ state: 'dev', version: '', note: 'This copy runs the code in the desktop folder, so there is nothing to update.' }, PASSING_MS);
    return;
  }
  // The button already says what there is, and a new check adds nothing.
  if (manual && offered && offered.state !== 'failed') return;
  if (manual) {
    asked = true;
    say({ state: 'checking', version: '', note: 'Looking for a newer version' });
  }
  // A running check answers the question too, now that it has been asked.
  if (busy) return;
  busy = true;
  try {
    const rel = await latestRelease();
    stamp();
    if (!newer(rel.version, app.getVersion())) {
      // A failed check before this one, or a release since withdrawn, must not
      // stay on the button for the rest of the run.
      pending = null;
      if (offered) publish(null);
      if (asked) say({ state: 'current', version: '', note: `Version ${label(app.getVersion())} is the latest release.` }, PASSING_MS);
      return;
    }
    if (kind === 'installer' || kind === 'appimage') {
      const asset = rel.asset(ASSET[kind].match);
      if (!asset) throw new Error('the release has no ' + ASSET[kind].name);
      pending = { version: rel.version, asset };
      publish({
        state: 'available', version: rel.version,
        note: `Analyser ${label(rel.version)} is out. Press to download it. Analyser then restarts into it.`,
      });
      return;
    }
    publish({ state: 'manual', version: rel.version, note: manualHow(rel.version) });
  } catch (err) {
    // A background failure (offline, GitHub down) stays silent, and the next
    // look tries again.
    if (asked) {
      publish({
        state: 'failed', version: '',
        note: `Analyser could not check for updates. Check the connection. ${errorText(err)}. Press to try again.`,
      });
    }
  } finally {
    busy = false;
    asked = false;
  }
}
