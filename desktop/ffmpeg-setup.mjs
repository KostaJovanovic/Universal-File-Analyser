/* Analyser desktop - getting an ffmpeg binary onto the machine.
 *
 * ffmpeg-native.mjs only FINDS ffmpeg. On a machine without one the app quietly
 * runs the WebAssembly build, and the user never learns the hardware path
 * exists. This module is the other half:
 *
 *   - The first time a video job asks for ffmpeg in a run and none is found,
 *     it offers, once, to download a build or to point at an ffmpeg file the
 *     user already has. "Don't ask again" is kept in userData.
 *   - Help > FFmpeg (hardware video) shows what is in use and offers the same
 *     two actions at any time.
 *
 * Where a download comes from: BtbN/FFmpeg-Builds on GitHub, the static builds
 * the FFmpeg project's own download page links for Windows and Linux. They carry
 * NVENC, Quick Sync, AMF and (on Linux) VAAPI. The release branch build is
 * preferred over master. The archive's SHA-256 comes from the GitHub API, or
 * from the release's checksums.sha256 when the API gives none, and nothing is
 * unpacked unless it matches. Only the ffmpeg program is kept, in
 * userData/ffmpeg/, so a portable copy carries it on the stick. BtbN publishes
 * no macOS build, so a Mac is pointed at Homebrew, which ffmpeg-native.mjs
 * already searches.
 *
 * A file the user chooses is asked for its version first, and refused unless it
 * answers as ffmpeg. Both the chosen and the downloaded copy are searched BEFORE
 * the bundled, portable and PATH locations (see ffPaths in main.mjs).
 *
 * Every dialog here is native, like Help > Where my data is stored. Text
 * follows the site's writing convention: British spelling, no em-dashes.
 */

import { app, dialog, net } from 'electron';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const EXE = isWin ? 'ffmpeg.exe' : 'ffmpeg';

const BUILDS = 'BtbN/FFmpeg-Builds';
const API = `https://api.github.com/repos/${BUILDS}/releases/tags/latest`;

/** BtbN's name for this system, or null where it publishes no build. */
const PLATFORM = {
  'win32-x64': 'win64', 'win32-arm64': 'winarm64',
  'linux-x64': 'linux64', 'linux-arm64': 'linuxarm64',
}[process.platform + '-' + process.arch] || null;
const ARCHIVE_EXT = isWin ? 'zip' : 'tar.xz';

const API_TIMEOUT_MS = 20 * 1000;
const DOWNLOAD_IDLE_MS = 60 * 1000;
const UNPACK_TIMEOUT_MS = 10 * 60 * 1000;
/** checksums.sha256 is a few kB. Anything far larger is not that file. */
const CHECKSUMS_MAX = 1024 * 1024;

/** Where a build may come from: BtbN's release downloads on github.com, and
 *  GitHub's asset storage those redirect to. Same rule as updater.mjs. */
const GITHUB_ASSET_HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.githubusercontent\.com$/;

function allowedDownload(url, first) {
  let u;
  try { u = new URL(String(url || '')); } catch (_) { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  if (u.hostname === 'github.com') return u.pathname.startsWith(`/${BUILDS}/releases/download/`);
  return !first && GITHUB_ASSET_HOST.test(u.hostname);
}

const errorText = (err) => String((err && err.message) || err).slice(0, 300);
const mb = (bytes) => Math.max(1, Math.round(bytes / (1024 * 1024))) + ' MB';

// ---------------------------------------------------------------------------
// Settings: { path?: the file the user chose, never?: "Don't ask again" }
// ---------------------------------------------------------------------------

const settingsFile = () => join(app.getPath('userData'), 'ffmpeg-setup.json');

function readSettings() {
  try {
    const s = JSON.parse(readFileSync(settingsFile(), 'utf8'));
    return s && typeof s === 'object' ? s : {};
  } catch (_) {
    return {};
  }
}

function writeSettings(s) {
  try {
    mkdirSync(dirname(settingsFile()), { recursive: true });
    writeFileSync(settingsFile(), JSON.stringify(s));
  } catch (_) { /* the choice is lost, and the next run asks again */ }
}

/** Where a downloaded build lives. */
const downloadedPath = () => join(app.getPath('userData'), 'ffmpeg', EXE);

/** The binaries this module put in charge, best first: the user's own choice,
 *  then the downloaded copy. Missing files are skipped by findFfmpeg(). */
export function preferredPaths() {
  const s = readSettings();
  return [typeof s.path === 'string' && s.path ? s.path : null, downloadedPath()].filter(Boolean);
}

/** The first line of `ffmpeg -version`, or null when `bin` does not answer as
 *  ffmpeg (ffprobe, ffplay and anything else are refused). */
function ffmpegVersion(bin) {
  return new Promise((resolve) => {
    try {
      execFile(bin, ['-hide_banner', '-version'], { timeout: 15000, windowsHide: true }, (err, stdout) => {
        const first = String(stdout || '').split(/\r?\n/)[0];
        resolve(!err && /^ffmpeg version /.test(first) ? first : null);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

// ---------------------------------------------------------------------------
// Finding and downloading a build
// ---------------------------------------------------------------------------

/** Fetch at most `max` bytes of a GitHub release file as text. */
async function fetchSmall(url, max) {
  if (!allowedDownload(url, true)) throw new Error('the builds page points outside GitHub');
  const res = await net.fetch(url, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  if (!res.ok) throw new Error('GitHub answered ' + res.status);
  if (res.url && !allowedDownload(res.url, false)) throw new Error('the download was redirected outside GitHub');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > max) throw new Error('checksums.sha256 is larger than expected');
  return buf.toString('utf8');
}

/** The SHA-256 for `name` from the release's checksums.sha256. */
async function digestFromList(assets, name) {
  const list = assets.find((a) => a && a.name === 'checksums.sha256');
  if (!list) throw new Error('the build gives no SHA-256 for ' + name);
  const text = await fetchSmall(String(list.browser_download_url), CHECKSUMS_MAX);
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (m && m[2].trim() === name) return m[1].toLowerCase();
  }
  throw new Error('checksums.sha256 does not list ' + name);
}

/** The build for this system: { name, url, size, sha256 }. The newest release
 *  branch (n7.1 and the like) wins, and master is the fallback. */
async function latestBuild() {
  const res = await net.fetch(API, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  if (!res.ok) throw new Error('GitHub answered ' + res.status);
  const rel = await res.json();
  const assets = Array.isArray(rel && rel.assets) ? rel.assets : [];
  const ext = ARCHIVE_EXT.replace('.', '\\.');
  const branch = new RegExp(`^ffmpeg-n(\\d+)\\.(\\d+)(?:\\.\\d+)?-latest-${PLATFORM}-gpl-[0-9.]+\\.${ext}$`);
  const master = new RegExp(`^ffmpeg-master-latest-${PLATFORM}-gpl\\.${ext}$`);

  let best = null;
  let bestRank = -1;
  for (const a of assets) {
    const m = a && branch.exec(String(a.name));
    if (!m) continue;
    const rank = Number(m[1]) * 1000 + Number(m[2]);
    if (rank > bestRank) { bestRank = rank; best = a; }
  }
  if (!best) best = assets.find((a) => a && master.test(String(a.name))) || null;
  if (!best) throw new Error('the builds page has no file for this system');

  const size = Number(best.size);
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error('the builds page gives no size for ' + best.name);
  const given = /^sha256:([0-9a-f]{64})$/.exec(String(best.digest || ''));
  const sha256 = given ? given[1] : await digestFromList(assets, String(best.name));
  return { name: String(best.name), url: String(best.browser_download_url), size, sha256 };
}

/** Download `build` to `dest`, hashing as it streams. Nothing lands at `dest`
 *  unless the SHA-256 matches. The same shape as download() in updater.mjs. */
async function download(build, dest, onProgress) {
  if (!allowedDownload(build.url, true)) throw new Error('the builds page points outside GitHub');
  const ctl = new AbortController();
  let idle = setTimeout(() => ctl.abort(), DOWNLOAD_IDLE_MS);
  const poke = () => { clearTimeout(idle); idle = setTimeout(() => ctl.abort(), DOWNLOAD_IDLE_MS); };
  const part = dest + '.part';
  const hash = createHash('sha256');
  let out = null;
  try {
    const res = await net.fetch(build.url, { signal: ctl.signal });
    if (!res.ok || !res.body) throw new Error('the download failed: ' + res.status);
    if (res.url && !allowedDownload(res.url, false)) throw new Error('the download was redirected outside GitHub');
    mkdirSync(dirname(dest), { recursive: true });
    out = createWriteStream(part);
    let writeErr = null;
    out.on('error', (err) => { writeErr = err; });
    let got = 0;
    let told = 0;
    for await (const chunk of res.body) {
      if (writeErr) throw writeErr;
      poke();
      got += chunk.length;
      if (got > build.size) throw new Error('the download is larger than the builds page says');
      hash.update(chunk);
      const share = got / build.size;
      if (share - told >= 0.01) { told = share; onProgress(share); }
      if (!out.write(chunk)) await once(out, 'drain');
    }
    if (writeErr) throw writeErr;
    if (got !== build.size) throw new Error('the download is shorter than the builds page says');
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  } catch (err) {
    if (out) out.destroy();
    rmSync(part, { force: true });
    throw err;
  } finally {
    clearTimeout(idle);
  }
  if (hash.digest('hex') !== build.sha256) {
    rmSync(part, { force: true });
    throw new Error('the download does not match its SHA-256');
  }
  rmSync(dest, { force: true });
  renameSync(part, dest);
}

/** Unpack with the system's own tar, named by full path so nothing on PATH can
 *  stand in for it. Windows 10 and later ship bsdtar as System32\tar.exe, which
 *  reads zip too. `member` limits it to one entry; null unpacks everything. */
function untar(archive, dir, member) {
  const tar = isWin
    ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    : (['/usr/bin/tar', '/bin/tar'].find((p) => existsSync(p)) || 'tar');
  const args = ['-xf', archive, '-C', dir];
  if (member) args.push(...(isWin ? [] : ['--wildcards']), member);
  return new Promise((resolve) => {
    try {
      execFile(tar, args, { timeout: UNPACK_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err) => resolve(!err));
    } catch (_) {
      resolve(false);
    }
  });
}

/** The ffmpeg program inside an unpacked build: <top>/bin/ffmpeg(.exe). */
function findExe(dir, depth = 0) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch (_) { return null; }
  for (const e of entries) {
    if (e.isFile() && e.name === EXE && basename(dir) === 'bin') return join(dir, e.name);
  }
  if (depth >= 3) return null;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const hit = findExe(join(dir, e.name), depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** Download, check, unpack and put the build's ffmpeg in place. */
async function install(build, onProgress, onUnpack) {
  // Under userData, so the final rename stays on one disk.
  const work = join(app.getPath('userData'), 'ffmpeg-download');
  rmSync(work, { recursive: true, force: true });
  try {
    // The name from the API answer is only used as a file name, so strip it to one.
    const archive = join(work, build.name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_'));
    await download(build, archive, onProgress);
    onUnpack();
    const out = join(work, 'unpacked');
    mkdirSync(out, { recursive: true });
    // Just the one program first. If this tar will not take the pattern, all of it.
    if (!(await untar(archive, out, '*/bin/' + EXE)) || !findExe(out)) {
      rmSync(out, { recursive: true, force: true });
      mkdirSync(out, { recursive: true });
      if (!(await untar(archive, out, null))) throw new Error('the download could not be unpacked');
    }
    const found = findExe(out);
    if (!found) throw new Error('the download holds no ' + EXE);
    if (!isWin) chmodSync(found, 0o755);
    if (!(await ffmpegVersion(found))) throw new Error('the downloaded ffmpeg does not run on this computer');

    const target = downloadedPath();
    mkdirSync(dirname(target), { recursive: true });
    try {
      renameSync(found, target);
    } catch (err) {
      // Windows will not replace a program that is running.
      if (err && (err.code === 'EBUSY' || err.code === 'EPERM')) throw new Error('ffmpeg is busy with a video job. Try again when it has finished');
      throw err;
    }
    return target;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// The dialogs
// ---------------------------------------------------------------------------

/** What main.mjs supplies: the window to parent dialogs on, and `changed`,
 *  which forgets the cached probe, probes the new binary, tells the page and
 *  resolves with the new capability record. */
let host = { window: () => null, changed: async () => ({ available: false }) };

export function setupFfmpeg(opts) {
  host = { ...host, ...opts };
}

/** This run already offered, so the next job does not ask again. */
let asked = false;
/** The open offer, shared by jobs that ask together (the /compare page). */
let offering = null;
/** { progress } while a download runs. */
let downloading = null;

function box(opts) {
  const w = host.window();
  const all = { title: 'Analyser', noLink: true, ...opts };
  return w && !w.isDestroyed() ? dialog.showMessageBox(w, all) : dialog.showMessageBox(all);
}

function taskbar(progress) {
  const w = host.window();
  if (w && !w.isDestroyed()) w.setProgressBar(progress);
}

const WHY = 'Without FFmpeg, video jobs (converting, reversing, pulling out the audio, '
  + 'and previews of files the player cannot open) run in the built-in browser '
  + 'version, which uses one processor core and no graphics card.\n\n'
  + 'With FFmpeg they run natively, on your graphics card\'s video encoder where it '
  + 'has one (NVIDIA, AMD, Intel or Apple), and are often many times faster.';

function howToGet() {
  if (PLATFORM) {
    return '\n\nDownload fetches a build from BtbN/FFmpeg-Builds on GitHub, checks it '
      + 'against its SHA-256 and keeps only the ffmpeg program, in Analyser\'s own '
      + 'data folder. Nothing else is installed.';
  }
  if (isMac) {
    return '\n\nOn a Mac, install it with Homebrew (brew install ffmpeg) and Analyser '
      + 'finds it by itself, or choose an ffmpeg file you already have.';
  }
  return '\n\nInstall it with your system\'s package manager and Analyser finds it by '
    + 'itself, or choose an ffmpeg file you already have.';
}

function readyDetail(caps) {
  const how = caps.accel
    ? `Video jobs now use ${caps.accel.label}.`
    : 'Video jobs now run in FFmpeg on the processor. No hardware video encoder answered on this computer.';
  return how + (caps.version ? '\n\n' + caps.version : '');
}

/** Ask for an ffmpeg file and put it in charge. Resolves with the new
 *  capability record, or null when nothing changed. */
async function choose() {
  const w = host.window();
  const opts = { title: 'Choose the ffmpeg program', properties: ['openFile'] };
  if (isWin) opts.filters = [{ name: 'ffmpeg', extensions: ['exe'] }];
  const r = w && !w.isDestroyed() ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
  const path = !r.canceled && r.filePaths && r.filePaths[0];
  if (!path) return null;
  if (!statSync(path, { throwIfNoEntry: false })?.isFile() || !(await ffmpegVersion(path))) {
    await box({
      type: 'warning', message: 'That file is not ffmpeg',
      detail: 'It did not answer as ffmpeg when asked for its version, so Analyser keeps what it used before.\n\n' + path,
      buttons: ['Close'],
    });
    return null;
  }
  writeSettings({ ...readSettings(), path });
  const caps = await host.changed();
  box({ type: 'info', message: 'FFmpeg is ready', detail: readyDetail(caps), buttons: ['Close'] }).catch(() => {});
  return caps;
}

/** Download a build in the background, with progress on the taskbar button.
 *  The job that asked carries on in the built-in version meanwhile. */
async function startDownload() {
  if (downloading) return;
  downloading = { progress: 0 };
  let failure = null;
  try {
    const build = await latestBuild();
    box({
      type: 'info', message: 'Downloading FFmpeg',
      detail: `${build.name}, ${mb(build.size)}. It downloads in the background${isWin ? ', with progress on the taskbar button' : ''}, and Analyser says when it is ready.`,
      buttons: ['Close'],
    }).catch(() => {});
    await install(build,
      (p) => { downloading.progress = p; taskbar(p); },
      () => taskbar(2));   // above 1 is the indeterminate bar, while it unpacks
    // A download replaces a file chosen earlier: it is what was asked for last.
    const s = readSettings();
    delete s.path;
    writeSettings(s);
  } catch (err) {
    failure = err;
  } finally {
    taskbar(-1);
    downloading = null;
  }
  if (failure) {
    const r = await box({
      type: 'warning', message: 'FFmpeg did not download',
      detail: errorText(failure) + '.\n\nVideo jobs keep using the built-in version.',
      buttons: ['Close', 'Try again'], defaultId: 0, cancelId: 0,
    }).catch(() => ({ response: 0 }));
    if (r.response === 1) startDownload();
    return;
  }
  const caps = await host.changed();
  box({ type: 'info', message: 'FFmpeg is ready', detail: readyDetail(caps), buttons: ['Close'] }).catch(() => {});
}

/**
 * The page's caps request (anr:ffmpeg-caps) passes through here. When no binary
 * was found it offers to get one, once per run and never after "Don't ask
 * again". Resolves with the record the job should use: the new one when the
 * user chose a file, otherwise the one it came with (a download finishes after
 * the job, which runs in the built-in version).
 */
export function offerIfMissing(caps) {
  if (caps && caps.available) return Promise.resolve(caps);
  if (offering) return offering;
  if (asked || downloading || readSettings().never) return Promise.resolve(caps);
  asked = true;
  offering = offer(caps).finally(() => { offering = null; });
  return offering;
}

async function offer(caps) {
  const acts = [];
  const buttons = [];
  if (PLATFORM) { buttons.push('Download FFmpeg'); acts.push('download'); }
  buttons.push('Choose the ffmpeg file'); acts.push('choose');
  buttons.push('Not now'); acts.push('none');
  let r;
  try {
    r = await box({
      type: 'question', message: 'Make video work faster with FFmpeg',
      detail: 'Analyser did not find FFmpeg on this computer.\n\n' + WHY + howToGet(),
      buttons, defaultId: 0, cancelId: buttons.length - 1,
      checkboxLabel: 'Don\'t ask again', checkboxChecked: false,
    });
  } catch (_) {
    return caps;
  }
  if (r.checkboxChecked) writeSettings({ ...readSettings(), never: true });
  const act = acts[r.response];
  if (act === 'choose') return (await choose().catch(() => null)) || caps;
  if (act === 'download') startDownload();
  return caps;
}

/** Help > FFmpeg (hardware video): what is in use, and the same two actions. */
export async function showFfmpegStatus(caps) {
  if (downloading) {
    await box({
      type: 'info', message: 'Downloading FFmpeg',
      detail: `${Math.round(downloading.progress * 100)}% done. Analyser says when it is ready.`,
      buttons: ['Close'],
    });
    return;
  }
  const s = readSettings();
  const chosen = typeof s.path === 'string' && s.path ? s.path : null;
  let message;
  let detail;
  if (caps && caps.available) {
    const source = caps.path === chosen ? 'Chosen by you.'
      : caps.path === downloadedPath() ? 'Downloaded by Analyser.'
      : 'Found on this computer.';
    message = 'FFmpeg: ' + (caps.accel ? caps.accel.label : 'software only');
    detail = [caps.version, caps.path, source].filter(Boolean).join('\n')
      + (caps.accel ? '' : '\n\nNo hardware video encoder answered on this computer, so FFmpeg encodes on the processor. That is still much faster than the built-in version.');
  } else {
    message = 'FFmpeg is not installed';
    detail = WHY + howToGet();
  }
  const acts = ['close'];
  const buttons = ['Close'];
  if (PLATFORM) { buttons.push(caps && caps.available ? 'Download the latest' : 'Download FFmpeg'); acts.push('download'); }
  buttons.push('Choose the ffmpeg file'); acts.push('choose');
  if (chosen) { buttons.push('Forget the chosen file'); acts.push('forget'); }
  const r = await box({ type: 'info', message, detail, buttons, defaultId: 0, cancelId: 0 });
  const act = acts[r.response];
  if (act === 'download') startDownload();
  else if (act === 'choose') await choose();
  else if (act === 'forget') {
    delete s.path;
    writeSettings(s);
    await host.changed();
  }
}
