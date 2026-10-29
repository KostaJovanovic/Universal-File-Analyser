# Analyser desktop (Electron)

The desktop build of Analyser, for Windows, macOS and Linux. It wraps the same
`web/` tree Cloudflare serves - there is no fork of the app code and nothing in
the analysis pipeline changes. The site keeps deploying exactly as it did.

Everything here is dev-only. `web/` never sees it, and `save.bat` does not run it.

## Run it

`desktop.bat` in the REPO ROOT is the one-step way, and the counterpart to
`server.bat`. It installs this folder's dependencies on the first run, builds
`src/` (`web/assets/js/` is build output, so an edit in `src/` does nothing until
`tsc` runs), then opens the window. A file path passed to it - including one
dragged onto the `.bat` - is opened in the app.

It also leaves two `tsc --watch` processes running, so the loop is **save, then
Ctrl+R in the app**. They run with `start /b`, inside the launcher's own console
rather than in two extra windows, and they are stopped when the app quits -
unless `server.bat` already had a pair up, in which case those are reused and
left alone. HTML and CSS need no watcher at all: Ctrl+R is enough, because the
`analyser://` handler reads `../web` straight off disk.

The two steps by hand, from this folder:

```
npm install          # once, in this folder
npm start            # electron .  ->  analyser://localhost/
```

`npm start` serves `../web` straight off disk, so the loop is `server.bat`'s two
`tsc --watch` windows plus Ctrl+R in the app. No dev server is involved - the
`analyser` scheme handler reads the files itself.

One environment trap, because the failure is baffling: **`ELECTRON_RUN_AS_NODE`
must not be set.** It turns `electron.exe` into a plain Node runtime, so
`main.mjs` resolves `import { app } from 'electron'` to the npm shim and dies
with `Cannot read properties of undefined (reading 'exports')` instead of
opening a window. Some tooling exports it. `desktop.bat` clears it.

## Build an installer

```
npm run dist         # stamp the version, then the Windows installer (x64): install or portable
npm run dist:mac     # on a Mac: one universal dmg (Apple silicon and Intel)
npm run dist:linux   # on Linux or WSL: the AppImage (x64)
npm run pack         # unpacked build in dist/win-unpacked, faster for a smoke test
```

Output lands in `desktop/dist/` (gitignored). No build carries a paid
certificate, so Windows SmartScreen warns on the first run and macOS asks for
"Open Anyway". Signing is a Phase 4 decision - see `research/ELECTRON-PLAN.md`.

The builds people download come from GitHub, not from this machine. See
"Releases and updates" below.

## How it fits together

| File | Job |
| --- | --- |
| `main.mjs` | App lifecycle, scheme handlers, window, security policy, open-by-path |
| `router.mjs` | `route(pathname, webDir)` - a one-to-one port of `serve.py`'s `_route()` |
| `preload.cjs` | The only bridge to the page: one frozen object, `window.anrDesktop` |
| `menu.mjs` | File / Edit / View / Go / Help menu |
| `updater.mjs` | Checks the GitHub release for a new version, and installs it where the copy allows |
| `ffmpeg-native.mjs` | Finds an ffmpeg binary, probes its working hardware encoders, runs jobs |
| `ffmpeg-accel.mjs` | Pure: the encoder families, the argument rewrite, and the safety checks. Shared with `mobile/` |
| `ffmpeg-setup.mjs` | Offers to download an ffmpeg build or choose one when none is found; Help > FFmpeg (hardware video) |
| `tools/check-ffmpeg-args.mjs` | Runs the safety checks against every argument list in `src/`, and against the attacks |
| `electron-builder.yml` | One target per system, `extraResources`, NSIS options, `publish: null` |
| `build/installer.nsh` | The Windows installer's pages (the "Install" or "Portable copy" choice, progress, finish) and the portable section |
| `tools/stamp-version.mjs` | Writes `major.minor.0` into `package.json` from `COMMIT_COUNT` |
| `tools/after-pack.cjs` | Gives the macOS app an ad-hoc signature, because there is no Apple certificate |
| `build/icon.png` | The site mark, used for the window and the installer |

### Portable mode

Windows ships one file, `Analyser-Windows-<version>.exe`. Its first page asks "Install"
or "Portable copy" - see "One Windows file" below.

By default Electron puts `userData` in `%APPDATA%`, which for this app means the
offline cache, the analysed history, the theme and the window position get
written to the host machine and left there. For a tool whose whole promise is
"nothing leaves your machine", that is the wrong default on a USB stick. So in
portable mode `main.mjs` calls `app.setPath('userData', <exe dir>/Analyser-data)`
before anything reads a path.

Two ways to be portable, both handled by `portableRoot()`:

1. **A `portable.txt` marker** beside the executable. The installer writes it
   for a portable copy, and any copied `win-unpacked/` folder with the file is
   portable too.
2. **`PORTABLE_EXECUTABLE_DIR`** - electron-builder's self-extracting
   `portable` target sets this at runtime. No release builds that target any
   more, but 9.1 shipped one, so the check stays for copies of it.

Consequences worth keeping in mind:

- `setPath` must run **before** `requestSingleInstanceLock()`, because Electron
  keys that lock on `userData`. Getting the order right is also what lets a
  portable copy and an installed copy run at the same time instead of one
  silently focusing the other.
- A read-only stick makes `mkdirSync` throw. That is caught, and the app starts
  in normal (non-portable) mode rather than failing - Help > "Where my data is
  stored" then reports the real location, so the user is never misled.
- A portable copy prefers an `ffmpeg.exe` sitting next to it (or under
  `ffmpeg/` or `ffmpeg/bin/`) over whatever is on the host's PATH, so the stick
  can carry its own hardware video path.

### One Windows file (`build/installer.nsh`)

electron-builder has no installer that offers "install or portable", so
`build/installer.nsh` adds the choice to its NSIS template through the hooks
the template offers. The result is three pages in the site's look: a flat
white window, `#0a0a0a` ink, the `#e60023` accent, 1 px frames, Segoe UI with
Consolas for the mono labels, no branding line and no etched rules. It is
light only, because a themed Windows radio button ignores a text colour. The
installer is also DPI-aware (`ManifestDPIAware`), so it is sharp on a scaled
display.

1. **How do you want Analyser?** (`customWelcomePage`, full window). Two
   cards: **Install**, or **Portable copy** with its own folder box and
   Browse button (default: `Analyser` beside the installer, and the path
   always ends in `\Analyser`). A red bar marks the chosen card, and the Next
   button reads "Install" or "Set up". A silent run (`/S --updated`, which is
   how `updater.mjs` installs an update) never sees the page, and neither does
   the elevated copy UAC starts. `customInit` keeps the portable section off
   for a silent run.
2. **Progress** - the template's own page, restyled through
   `customPageAfterChangeDir` (a flat red bar, a header per mode).
3. **Analyser is ready** (`customFinishPage`, full window, in place of MUI's
   finish page), with a "Start Analyser" box. `SetAutoClose true` moves the
   progress page on to it.

The template's two other pages never show. `customInstallMode` always skips
"only for me / for everyone": an install goes to this account, unless the
computer has only an everyone-copy, which is then updated in place (with
elevation). `allowToChangeInstallationDirectory: false` removes the folder
page. The portable path never says "install".

`customHeader` declares section 0. It unpacks the app package into the chosen
folder and writes `portable.txt`. For a portable copy the template's own
install section (section 1) is switched off. That section always runs the
uninstaller of an installed copy first, then writes registry keys and
shortcuts, and a portable copy must do none of that.

The section numbers are literals, so `customInstall` fails the build if the
install section ever stops being section 1. `customHeader` fails it if any
hook is not expanded, or if the folder page is switched back on. The portable
section uses the same `File` line as the template, so NSIS stores the app
package only once.

A portable copy updates the way it is set up: run the new file, pick
**Portable copy** and the same folder. The section refuses to overwrite a
running copy, clears the old `resources/` and `locales/`, and leaves
`Analyser-data` alone.

### Native FFmpeg (`ffmpeg-native.mjs`)

The reason the desktop build exists. `@ffmpeg/core` is WebAssembly, which is
software-only and single-threaded, so it cannot touch a GPU's encoder blocks.
Measured on one machine, the same 10 s 720p transcode: **30.5 s** on WASM,
**1.1 s** native software, **0.58 s** on NVENC. That is 52x.

Three parts:

1. **Find** a binary - the user's chosen file or Analyser's own download (see
   below), a bundled one under `resources/ffmpeg/` (none shipped yet), then
   `PATH`, then the usual per-platform install directories.
2. **Probe.** `ffmpeg -encoders` is NOT evidence: a full build lists every
   family it was compiled with, so an NVIDIA-only machine still advertises
   `h264_qsv` and `h264_amf` and fails both at runtime. The probe encodes a
   throwaway clip with each candidate and keeps only what exits 0, then decodes
   that clip with the family's `-hwaccel` and records the answer as `decode`
   (an encoder that works says nothing about the decoder). VAAPI tries
   `/dev/dri/renderD128`, then `renderD129`, and records the node that encoded
   as `device`. Cached in `userData/ffmpeg-caps.json`, keyed by the binary's
   path, size and mtime and `PROBE_VERSION` - bump that when the probe learns
   something new, so every cached record re-probes.
3. **Rewrite and run.** `accelerate()` maps `-c:v libx264` onto this machine's
   encoder, translates the x264 preset name (NVENC wants `p1`..`p7`), drops
   x264's `-tune` (NVENC refuses `zerolatency`, which used to send every turbo
   convert to software), and converts `-crf` to the family's own quality flag
   (NVENC adds `-b:v 0`, or ffmpeg's default ~2 Mbit/s target caps `-cq`). It
   adds `-hwaccel` for decode when no filter graph needs CPU frames, and on
   NVIDIA turns convert's one resize into `scale_cuda` on CUDA frames
   (`-hwaccel_output_format cuda`, `-pix_fmt` dropped). VAAPI gets
   `-vaapi_device` and a filter chain ending in `format=nv12,hwupload`. A job
   with no encoder whose output is `-f rawvideo` (scene detection) gets
   `-hwaccel` alone. `-c copy` is never touched.

Two rules to keep:

- **A hardware failure ends in the ORIGINAL software arguments.** Drivers refuse
  jobs for unglamorous reasons - NVENC rejects frames below roughly 145x49, for
  one. `runJob()` tries the full rewrite, then (when that one decoded on the
  GPU) the same rewrite with `{ decode: false }`, then the page's arguments
  untouched; a retry adds `-y`, since a failed attempt can leave a partial
  output behind. The last step is what stops a hardware quirk losing a user's
  work. Verified: a 32x32 clip fails on NVENC and completes in software with no
  visible error.
- **The page must not be able to tell which backend it got.**
  `loadNativeFFmpeg()` in `src/renderers/video.ts` returns an object with the
  same shape as an ffmpeg.wasm instance, which is the only reason the ~40 call
  sites in that file needed no edits. `exec` resolves on a non-zero exit and
  rejects only when ffmpeg could not start, because callers use exactly that
  difference to tell a clean failure from a dead instance.

With no binary installed, `caps().available` is false and `video.ts` loads the
WASM core exactly as the website does.

**Getting a binary (`ffmpeg-setup.mjs`).** The `anr:ffmpeg-caps` handler passes
its answer through `offerIfMissing()`: the first time in a run that a job finds
no binary, a native dialog offers **Download FFmpeg**, **Choose the ffmpeg
file** or **Not now**, with a "Don't ask again" box (kept in
`userData/ffmpeg-setup.json`). Help > FFmpeg (hardware video) shows the
probe's answer and offers the same at any time.

- The download is BtbN/FFmpeg-Builds' `latest` release: the newest release
  branch build for this system (`ffmpeg-nX.Y-latest-win64-gpl-X.Y.zip`,
  `linux64`, `winarm64`, `linuxarm64`), master as the fallback. It is refused
  unless its SHA-256 matches the API's `digest` (or `checksums.sha256`), and
  the hosts are held to BtbN's release downloads and GitHub's asset storage,
  like `updater.mjs`. The system tar unpacks it (`System32\tar.exe` on
  Windows, which reads zip), and only `bin/ffmpeg` is kept, as
  `userData/ffmpeg/ffmpeg(.exe)` - beside the program on a portable copy. No
  macOS build exists there; a Mac is pointed at Homebrew.
- A chosen file must answer `-version` as `ffmpeg version ...` before it is
  stored.
- `ffPaths()` in `main.mjs` searches the chosen file, then the download, then
  the bundled and portable paths, then PATH.
- After either, `resetCapabilities()` drops the cached probe, the new binary is
  probed, and main sends `anr:ffmpeg-changed`. `video.ts` listens through
  `anrDesktop.ffmpeg.onChange` and lets a WASM instance it already loaded give
  way on the next `loadFFmpeg()`.
- The job that raised the offer keeps its answer: a chosen file is used at
  once, a download only by the jobs after it.

**Reading an opened file in place.** `ffInputFile()` in `video.ts` first asks
the native instance to `linkFile(name, file)`: the page turns the File into a
token (`desktopFileToken()` in `core/util.ts`, below), main's `anr:ffmpeg-link`
resolves it, and `link()` in `ffmpeg-native.mjs` lets that bare name stand for
the real path. Everything is still checked against the bare name;
`checkInputs()` peeks the real file, and `withLinks()` swaps `file:<path>` in
for that `-i` value only after every check has passed. A link is an input
only: an output of the same name lands in the session folder, `get()` never
reads through one, and `del()` only forgets it. No token (a slice, a File the
page built, a file changed since) means the old chunked copy.

**Tokens for dropped files, and native hashing.** Files opened by path already
have `anr-open` tokens; `desktopFile()` remembers each File's token in a
WeakMap. A dropped or picked File has none, so `anrDesktop.fileToken(file)`
calls `webUtils.getPathForFile()` in the preload (which knows a path only for a
File the user handed the page) and main's `anr:file-token` mints one, after
checking the size and mtime still match. The page never sees the path.
`lib/hash-client.ts` hands such a file to `anrDesktop.hash()` (`anr:hash`),
which streams it through Node's `createHash` and `zlib.crc32` in one read, with
`anr:hash-progress` events; anything it cannot do comes back null and the
worker runs as on the website. `sha256Hex()` takes that route from
`HASH_INLINE_MAX` up in the app.

The families and `accelerate()` live in `ffmpeg-accel.mjs`, a pure module with
no Node imports, like `router.mjs`. The Android shell inlines the same file
into its bridge (`mobile/tools/stage-web.mjs`), so keep it import-free and use
only plain `export const` / `export function` exports.

### The safety checks

The page chooses ffmpeg's arguments, and a crafted file that finds an XSS in a
renderer controls the page. Before this check, such a page could read any file
the user can read (`-i C:\...`), write anywhere (`-y C:\Windows\...`), grab the
screen or the camera (`-f gdigrab`, `-f dshow`), open the network, or load a
native library (`-vf frei0r=...`).

So `runJob()` calls `checkArgs()` and `checkInputs()` before anything spawns.
They refuse:

- absolute paths, drive paths, drive-relative paths and `..` steps - with ONE
  exception, the value of `-vaapi_device`, and only in the exact shape
  `/dev/dri/renderD1NN` (a GPU, which cannot hand ffmpeg anyone's data)
- URLs and every ffmpeg protocol (`file:`, `concat:`, `subfile,`, `pipe:`, ...)
- capture and playback devices after `-f`
- filters that load code or open a socket (`frei0r`, `ladspa`, `lv2`, `zmq`,
  `sendcmd`)
- options that read more options from a file (`-/opt`, `-filter_script`)
- inside any text input (`checkInputBytes()`): a concat list line that is not
  `file '<bare session file>'`, a comment or `ffconcat version 1.0`; a playlist
  or manifest line with a path or URL; any control, non-ASCII or lone `\r`
  character in a list; a list larger than the 1 MiB peek; a NUL in a concat
  list, and a NUL in anything that starts like a list (a NUL early on
  otherwise marks a file as binary media). The reverse in `video.ts` feeds
  `-f concat -safe 0` a list it wrote itself; the check allows it, and the
  guard below turns the `0` into `1`.

On top of that deny-list sits an **allow-list**: only the options, `-f`
formats, filter graphs, codecs and file names the app actually emits pass,
including the hardware rewrites (`-hwaccel`, `-hwaccel_output_format cuda`,
`-vaapi_device`, the NVENC/QSV/AMF/VAAPI/VideoToolbox/MediaCodec quality
options and presets, `scale_cuda` and the `hwupload` tail) and the openh264
fallback. An unknown option is refused, and so are `-dump_attachment`,
`-attach`, `-protocol_whitelist` and muxers that write extra files (`hls`,
`dash`, `tee`, `image2`; `segment` only in the reverse's exact
`rev_seg_%03d.mp4` shape). Outputs must be bare `.mp4`/`.wav`/`.jpg`/`.rgb`
names (`.rgb` is scene detection's `-f rawvideo`), never a Windows device name.
`runJob()` checks the rewritten list too, since that is what spawns, and
`safeName()` refuses the same names for writeFile/readFile.

**The guard: ffmpeg enforces it too.** A text check reads a file once, and
ffmpeg reads it again later. A list rewritten in between, a playlist that
names another playlist, or a NUL that hides a line would all slip past a
check that only parses. So every try that spawns (hardware, encoder only,
software) goes through `guardInputs()`: every `-i` gets `-format_whitelist`
and `-protocol_whitelist file`, and `-safe` is forced to `1`. ffmpeg itself then
refuses playlists, manifests, scripts and paths outside the folder, on the
bytes it really opens. The whitelist is every demuxer in the binary's
`ffmpeg -demuxers` listing except devices and `FOLLOWERS` (`hls`, `dash`,
`imf`, `sdp`, `sap`, `rtsp`, `rtp`, `concat`, `avisynth`, `vapoursynth`,
`lavfi`); an `-f concat` input gets `concat` added, and its children are held
to the same list. The probe builds it once (`formats` in the record), and a
record without one refuses every job, which is why `PROBE_VERSION` went to 3.
The guard goes on after `checkArgs()`, never before: `checkArgs()` refuses
`-protocol_whitelist` from the page. A new ffmpeg demuxer that follows
references belongs in `FOLLOWERS`, in both ports.

**Limits, as on Android.** At most 16 sessions are open at once
(`openSession()` throws, and `video.ts` falls back to ffmpeg.wasm); `put()`
refuses a write that would leave less than 256 MiB free on the temp drive; and
no try runs longer than 6 hours (`MAX_JOB_MS`), whatever timeout the page
passes, so a page that never cancels cannot hold a process for ever.

The checks run in the main process, never the page. A refused job resolves with
code 1 and a log line, which `video.ts` treats as a clean failure. Never return
-1, which it reads as a dead instance.

`node desktop/tools/check-ffmpeg-args.mjs` runs every argument list in `src/`,
every hardware rewrite of each, and every attack through the checks. **A new
ffmpeg call must be added there, and to the allow-list in `ffmpeg-accel.mjs`,
or it is refused.** The Android shell has a Java port (`AnrFfmpegChecks.java`,
tested by `AnrFfmpegChecksTest`) against the same vectors. Both are ASCII-only
by design (no `\s`, `\b`, `.`, `$` or case-insensitive flags): JavaScript,
OpenJDK and Android's ICU regex engine read those differently.

### SharedArrayBuffer, so the on-device AI can use more than one core

`main.mjs` starts Chromium with `--enable-features=SharedArrayBuffer`. That one
line is what lets the two ONNX inference workers - MDX-Net vocal separation and
DeepFilterNet3 denoise - run on more than a single core.

The reasoning, because the alternative looks more correct and is worse:

ORT ships a threaded WASM build, and the app already downloads those `-threaded`
files. But pthreads need a shared `WebAssembly.Memory`, which needs
`SharedArrayBuffer`, which a browser hands only to a cross-origin-isolated page.
The website is deliberately not isolated - it sends no COOP/COEP, for the same
reason it ships no CSP - so it has always run this on one core. A desktop app
does not have to accept that bargain.

Measured on Electron 33.4.11 (Chromium 130), reported from inside a **module
worker** on the real `analyser://` origin. The probes are kept in
`research/sab-probe/`, with a README on how to run them:

| config | worker SAB | `crossOriginIsolated` | shared `WebAssembly.Memory` |
|---|---|---|---|
| nothing (what the website gets) | false | false | not available |
| `--enable-features=SharedArrayBuffer` | **true** | false | **true** |
| COOP + COEP `credentialless` | true | true | true |

**Serving COOP/COEP would have been the wrong fix.** It buys nothing the switch
does not already give - ORT needs SAB, not isolation - and it forces every
cross-origin subresource to satisfy COEP. This app's service worker replays
cached jsDelivr and HuggingFace responses for the ORT runtime and the models, so
that route risks breaking offline AI with no build-time signal. Exactly the
hazard the root `CLAUDE.md` describes for the missing CSP. Do not add those
headers as a tidy-up.

One thing that looked fatal and is not. ORT spawns its pthread workers from its
own script URL, and that URL is on jsDelivr, and a cross-origin `new Worker` is
refused outright:

```
SecurityError: Failed to construct 'Worker': Script at 'https://cdn.jsdelivr.net/
npm/onnxruntime-web@1.20.1/dist/ort-wasm-simd-threaded.jsep.mjs' cannot be
accessed from origin 'analyser://app'.
```

ORT works around that itself. Forcing the runtime up with deliberately invalid
model bytes returns `ERROR_CODE: 7 ... protobuf parsing failed` - a *model*
error, not a worker error - with `env.wasm.numThreads` still 6. The pool starts.
If you ever move ORT off the CDN, re-run `ort-threads-probe.cjs` rather than
assuming this still holds.

The consumer is `ortThreads()` in `src/lib/mdx-model.ts`, which both workers
call. It tests for `SharedArrayBuffer`, **not** for `window.anrDesktop`, and that
is deliberate: these run in module workers, which never see the preload bridge,
and any browser that grants SAB has earned the threads too. On the website the
test fails and the value stays 1, so nothing there changes.

This matters most for **denoise**, which has no GPU path at all: `dfn-worker.ts`
is pinned to WASM because ORT-web's WebGPU backend miscomputes its GRU graph, so
threads are the only speed it can gain. MDX separation still prefers WebGPU and
uses threads only on its fallback path - so on a machine with a working GPU,
**separation speed is unchanged by any of this**. Do not claim otherwise.

**The thread cap is 4. Measurement set it, not judgement.**
`research/sab-probe/dfn-bench.cjs` times the real DFN3 graph over 1000 frames
(10 s of audio) per run, on a 12-core machine:

| threads | median | vs 1 thread |
|---|---|---|
| 1 | 276 ms | 1.00x |
| 2 | 227 ms | 1.22x |
| 3 | 158 ms | **1.75x** |
| 4 | 174 ms | 1.59x |
| 5 | 161 ms | 1.71x |
| 6 | 173 ms | 1.60x |
| 8 | 221 ms | 1.22x |

The gain saturates around three or four threads and then goes backwards. Small
tensors on a partly sequential graph: past that point ORT spends more on
synchronising the pool than the split saves. So `ortThreads()` asks for half the
logical cores **capped at 4** - giving it half of a big machine would be slower.
If you change that constant, re-run the benchmark rather than reasoning about it.

### The `analyser://` scheme

`file://` was never an option: the app uses root-relative URLs, ES modules,
module workers, `import.meta.url`, `history.pushState`, the Cache API and a
service worker, and all of those break or degrade on `file://`. A registered
scheme gives the page a real origin and a secure context, so everything behaves
as it does on the website.

The host is deliberate. `sw.js` treats hostname `localhost` as dev and turns
itself into a pass-through, and `app.ts` / `asteroids.ts` show their dev-only
reset buttons on that host. So the app loads `analyser://localhost/` in dev and
`analyser://app/` when packaged, and both behave correctly with no code change.

Routing is `router.mjs`, ported from `serve.py`. Two deliberate differences:
`/x.html` is served directly instead of being 308-redirected to `/x` (there is
no canonical-URL reason to redirect inside an app), and `/api/*` is not mocked.

### `/api/*`

`API_ORIGIN` in `src/core/util.ts` is `''` (same origin) and the Worker sets no
CORS headers, so a renderer fetch from `analyser://app` to the live site would
fail. `main.mjs` forwards `/api/*` to `https://analyser.valjdakosta.com` with
`net.fetch()` from the main process, where CORS does not apply. The visitor
badge, the analysed-count ping, `/stats` and the Asteroids leaderboard all work
unchanged, and neither `util.ts` nor the Worker needed touching.

### Content types

`net.fetch()` on a `file:` URL fills Content-Type in from Chromium's own
extension map, and it gets the two that matter right: `.mjs` is
`text/javascript` and `.wasm` is `application/wasm`. A module script with the
wrong type is refused outright and streaming WASM compilation fails, so neither
is left to chance across Electron versions - the handler sets the type from the
`MIME` table in `router.mjs` whenever it knows the extension.

### Security

`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
`webviewTag: false`. The renderer never sees Node. A crafted file that finds an
XSS in a renderer gets the surface it has on the website, not the filesystem -
`core/sanitize.js` remains the only XSS defence, exactly as on the site, and
there is no CSP here for the same reasons `web/_headers` has none.

`http`, `https` and `mailto` go to the system browser or mail client through
`shell.openExternal`. Everything else is denied. The one allowed child window is
`about:blank` from our own origin, which the export report uses as a fallback.
`setPermissionRequestHandler` allows only fullscreen and clipboard.

### Opening a file by path

A renderer with no Node access cannot build a `File` from a path. So the main
process mints a one-time token on a second scheme, `anr-open://<token>`, mapped
to the approved path, and the page fetches it and wraps the blob in
`new File([blob], name)` before handing it to `window._anrHandleFile`. That is
what File > Open, Open folder, "Open with", a command-line argument and a
second launch all go through.

Known trade-off: a fetched blob is not disk-backed the way a dropped `File` is.
Drag-and-drop and the in-page file picker stay the primary paths and are
disk-backed, so a multi-GB file is best dropped rather than opened by path.
Native work - ffmpeg reading in place, hashing - goes by the token either way,
so it reads the file from disk whichever way it was opened.

For a folder, the listing carries **stubs**, not files - materialising every
entry up front would copy the whole tree through the blob store just to draw a
treemap. `desktopFile()` in `src/core/util.ts` turns one into real bytes when
something actually reads it. The one place that costs is the folder view's
"Openability check", which reads every file by design.

## What ships in the package

`web/` goes in as `extraResources`, so it lands in `resources/web/` as ordinary
files rather than inside the asar - which keeps `net.fetch(pathToFileURL(...))`
trivial and sidesteps asar quirks around the 72 MB of vendor WASM.

Left out: `**/*.map`, `sitemap*.xml`, `robots.txt`, `llms.txt`, `_headers` and
`samples/**` (18 MB). A sample missing from disk is routed as `{ remote }` by
`router.mjs` and downloaded from the live site by `main.mjs` when the `/samples`
page opens it; the page sees it on its own origin, so the service worker caches
it and the Everything offline download still lists it. In dev the files are on
disk and served from there. `formats/**` is kept: the `/formats` hub links
straight at those pages, and a hub full of dead links is a worse trade than the
25 MB.

## Icons

`build/icon.png` is `web/assets/img/icon-512.png`, copied verbatim. macOS,
Linux and the development window use it.

Windows uses `build/icon.ico`, which `tools/make-icon.mjs` writes. When
electron-builder made the `.ico` from `icon.png`, it only scaled that one
picture down, and the thin strokes of the mark came out soft at 16 to 48 px.
The script draws the mark again at each size from 16 to 256 px, rounds every
stroke to whole pixels, and mirrors the right side from the left. It borrows
`sharp` from `mobile/node_modules`, so run `npm install` in `mobile/` first.
Both files are tracked. Run the script again when the mark changes:

    node desktop/tools/make-icon.mjs [preview-dir]

## Releases and updates

`.github/workflows/release.yml` is the only release path, and it never runs on
a plain push. Start it with `save.bat release` (menu option 1), which saves,
pushes and then starts it through `gh`. Or open the Actions tab, pick
**Release apps**, then **Run workflow**. One run:

1. reads the version and runs `tools/check-ffmpeg-args.mjs`,
2. builds Windows, macOS and Linux in parallel, each on its own GitHub machine,
   with `electron-builder --<os> --publish never`,
3. builds the signed Android APK (see `mobile/README.md`),
4. creates the release `v<version>` with every file at once.

The last step uploads everything at once on purpose. An installed app reads the
latest release, and a half-uploaded one would point it at a missing file. A
second run on the same commit uploads into the same release again.

A release holds ONE file per system and nothing else:
`Analyser-Windows-<version>.exe`, `Analyser-mac-universal-<version>.dmg`,
`Analyser-linux-x64-<version>.AppImage` and `Analyser-android-<version>.apk`,
where the version is the tag without its `v` (9.9.0). There is no
`latest*.yml` and no `.blockmap`: `publish: null`,
`nsis.differentialPackage: false` and `dmg.writeUpdateInfo: false` keep
electron-builder from writing them. The apps find their file by the part of
the name before the version, so keep that part exactly as it is. The old
unversioned names of 9.8 and earlier still match, but a 9.8 copy looks only
for those old names, so it does not find a later release by itself.

`updater.mjs` does the rest, in a packaged app only. It asks the GitHub API
for the latest release, which gives the tag, every download URL and the
SHA-256 digest that GitHub computed for each file:

| Copy | What happens |
| --- | --- |
| NSIS install (its uninstaller sits beside the exe) | A press on Update downloads the new installer and checks the digest. The app quits, and the installer runs from `will-quit` with `/S --updated --force-run`, re-hashed first, and starts the new version |
| AppImage (`APPIMAGE` is set) | A press on Update downloads beside the running file, checks the digest, replaces the file and restarts through `app.relaunch` |
| Portable copy, macOS | The button says a new version is out, and a press opens the release page |

Every answer goes to the **Update button in the title bar**, never a native
dialog - the design mbrd's desktop uses (`../mbrd/desktop/updates.ts`).
`updater.mjs` publishes an offer, `{ state, version, progress?, note }`, which
main sends to the bar as `anr:chrome-update` (and replays on `anr:chrome-ready`,
since the bar can load after the answer); a press comes back as
`anr:update-press`, checked against the bar's contents. The states are
`available`, `downloading` (the button fills with `progress`), `installing`,
`manual` and `failed`, which stay, and `checking`, `current` and `dev`, which
answer a manual check and pass after five seconds. `note` is the tooltip. A
check only finds a version: nothing downloads until the button is pressed.

A download that does not match its digest never takes over, and a release
without a digest never installs. macOS cannot install an update by itself
until the app has an Apple Developer ID signature. `mac.identity: null` skips
signing, and `tools/after-pack.cjs` applies an ad-hoc signature to the merged
universal app instead, so macOS offers "Open Anyway" rather than calling the
app damaged.

The first look runs 20 seconds after start-up, then one every hour, and each
look checks only when the last answer is a day old (`update-check.json` in
userData), so a restart does not check again and a laptop that slept for a week
checks within the hour it wakes. **Help > Check for updates** and the footer's
button run one at once. A check is one HTTPS request to
api.github.com, and a development copy never checks.

## Versioning

`tools/stamp-version.mjs` reads `COMMIT_COUNT` and `RELEASE_COMMITS` out of
`src/core/app.ts` and applies the same formula as `analyserVersion()` (see the
`version-numbering` skill), writing `major.minor.0` into `package.json`. The app
keeps showing `analyserVersion()` in its footer, so the installer and the UI
always agree. `npm run dist` runs it first; run it alone with `npm run stamp`.

## What the app-side guards are

Every desktop-only branch in `src/` is behind `window.anrDesktop`, which does
not exist in a browser, so the website is unaffected:

- `core/popups.ts` - `probeOnline()` pings the live site rather than our own
  local origin, which would always answer. The Turnstile challenge is skipped
  (the widget is bound to the site's hostname and can never verify here) and the
  `mailto:` opens directly. `wireShareButtons()` also removes the green Get App
  chip from the header, since the reader already has the app.
- `core/offline-tiers.ts` - the footer install button (a link to the latest
  GitHub release on the website) becomes "Check for updates",
  which calls `anrDesktop.checkUpdates()` (IPC `anr:check-updates`, answered by
  `updater.mjs` on the title bar's Update button). The download tiers
  stay: OCCT, Tesseract language data and the ONNX models are all still
  remote. `tierUrls()` asks `anrDesktop.ffmpeg.caps({ quiet: true })` and
  leaves the WASM ffmpeg core out when a native binary is found (quiet, so
  the question never raises the download offer).
- `core/util.ts` - `desktopFileToken()`, and `sha256Hex()` taking the streamed
  path from `HASH_INLINE_MAX` up; `lib/hash-client.ts` tries `anrDesktop.hash`
  first.
- `renderers/video.ts` - beyond native FFmpeg itself: `linkFile` on the native
  instance, and `nativeSceneFrames()`, which reads scene detection's samples
  with one `-f rawvideo` pass when a file can be linked (the seek loop
  otherwise).
- `core/limits.ts` - the device tier reads `anrDesktop.memoryGB`, the real
  `os.totalmem()` figure, instead of `navigator.deviceMemory`, which Chromium
  clamps at 8.
- `core/export-data.ts` - the report goes through a native save dialog, with the
  `about:blank` child window kept as the fallback.
- `core/app.ts` and `renderers/folder.ts` - the open-by-path plumbing described
  above.
## Window chrome

`frame: false` everywhere except macOS, where the frame stays so the traffic
lights survive (`titleBarStyle: 'hidden'` plus `trafficLightPosition`, and the
CSS hides the app's own buttons and reserves `--anr-tb-lead` for the native
ones).

**The bar is not part of the app.** The window holds TWO web contents:

- the **window's own** contents are the bar - `desktop/chrome/titlebar.html` +
  `titlebar.js`, served from `analyser://<host>/__chrome/`, bridged by
  `chrome/preload.cjs` as `window.anrChrome`;
- the **site** is a child `WebContentsView`, bridged by `preload.cjs` as
  `window.anrDesktop`, positioned by `layout()` at `y = tbHeight`.

That orientation is load-bearing. Do not swap it: on Windows the OS computes the
drag hit-test from the window's own web contents, so `-webkit-app-region: drag`
has to live there or the bar stops moving the window.

The payoff is that the app has an ORDINARY viewport that starts below the bar.
`position: fixed`, `100vh`, `window.innerHeight` and the native scrollbar are all
correct by construction, and no page element needs to know the bar exists. That
deleted about 200 lines of offsets - the sticky bands, the full-window overlays
(`.page-drop`, `.lightbox`, `.splash`), the `html.anr-win-full` resets - and the
whole app-drawn scrollbar, which only existed because a native one ran the full
height of a viewport that started at the top of the window.

**If you find yourself writing `html.anr-desktop something { top: ... }`, the
split is not working and the fix belongs in `main.mjs`, not in the CSS.**

The rest:

- **The menu is drawn, not popped.** `menu.mjs` defines the tree ONCE and has
  three consumers: `buildMenu()` builds a real `Menu` purely to register the
  accelerators, `menuModel()` hands the same tree to the bar as plain data, and
  `runMenuItem()` checks an id the bar sends back against that tree before it
  runs anything. So the menus carry the site's own type and hairlines, and one
  definition still covers all three.
- **An open menu panel is its OWN WINDOW** (`chrome/panel.html` + `panel.js`,
  built by `ensurePanelWindow()`). It has to be. A child view always composites
  ABOVE the contents it was added to, so a panel drawn in the bar's page lands
  underneath the site and cannot be seen - and nothing in the page can detect
  that, because the DOM has no idea a native view is on top of it. The panel
  measured as perfectly on-screen the whole time it was invisible, which is why
  the width sweep and every `getBoundingClientRect()` check passed while the
  menus did nothing. **Any test of the bar that only reads geometry from the DOM
  cannot see this class of fault.**
  Three things about that window are load-bearing:
  - It is created at start-up, hidden, and reused. Created on the first click
    instead, it spends a second loading two stylesheets and the fonts, shows
    nothing, and the user's second click toggles it straight back off.
  - The panel keeps its NATURAL size (`width: max-content`), never the window's.
    Sizing it to the window and toggling a measuring mode around the read makes
    the two define each other, and the first measurement just reports the window
    back - a 220x100 panel whatever the menu.
  - `blur` on that window is the whole of "click outside to close", and
    `pushState` counts the panel's focus as the main window's, or the bar
    recedes exactly while a menu is being used. That blur also means a click
    on the open menu's own title closes it BEFORE the title's click handler
    runs, so main ignores a re-open of the menu that just closed - and it must
    then send `anr:menu-closed`, because the bar marked the title open before
    it asked. Without that reply the title stayed lit over no menu, and the
    next click did nothing.
  - It never plays the OS open animation. On Windows every `show()` zooms the
    window out of its middle, and `thickFrame: false` does not stop that. So
    on Windows and macOS the panel is shown ONCE, at creation, and then only
    veiled: `setOpacity(0)` plus `setIgnoreMouseEvents(true)` to close,
    `setOpacity(1)` and `focus()` to open (`VEIL` in `main.mjs`). A veiled
    window keeps focus, so a close by Escape or a run entry hands it back to
    the app view by hand. Linux has no `setOpacity`, so there it is still
    `show()`/`hide()`, and `type: 'toolbar'` keeps the compositors off it.
  - Its own motion is CSS: the box and border appear at once, anchored to the
    title, and the rows drop 4px while they fade up (`--dur-snappy`). Only on
    an open from nothing (`fresh`) - sliding across the bar swaps menus at
    once. The rows are held at the first frame (`is-armed`) until the panel
    reports its size, and a veiled panel waits two frames before it reports,
    so the last menu's frame never flashes. Reduced motion keeps the fade only.
- **The wordmark reloads the app** (`anr:chrome-nav` with `'reload'`, the same
  channel as the arrows). It is an `.anr-tb-btn`, so it opts out of the drag
  region.
- **Minimise, maximise and close have no native affordance left.** They go
  through `anr:win`, which checks the sender. Main pushes `anr:win-state` on
  maximize, unmaximize, full screen and focus, because the bar has to redraw for
  state changes it did not cause - Win+Up, Snap, a double-click on the drag
  region.
- **Full screen is tracked from the events, not read back.** Electron on Windows
  emits `enter-full-screen` and `leave-full-screen` BEFORE `isFullScreen()`
  returns the new value. `layout()` survived that because the resize that follows
  re-runs it. Main tells the bar once, so the bar latched the wrong state, hid
  itself in a window that was not full screen, and left nothing to close the
  window with. `main.mjs` now keeps its own flag, and those two events set it
  first.
- **The bar reports its own height** through `anr:chrome-height`, measured from
  `--anr-tb-h` in `analyser.css`, so that token stays the single source of truth
  and main never carries a second copy of the number.
- **View > Zoom zooms the BAR too, and main has to compensate.** Chromium stores
  the zoom level per ORIGIN, and the bar, the panel and the site are all
  `analyser://localhost`, so zooming the page zooms the chrome with it. The bar
  then paints `34 x factor` px tall while still reporting 34 CSS px, and the view
  parked at 34 covers its bottom hairline. `main.mjs` keeps `tbCssHeight` (what
  the bar reported) apart from `tbHeight` (what `layout()` uses) and multiplies by
  a `zoomFactor` it computes as `1.2 ^ level` at the moment it sets the level -
  Chromium's exact ratio. Do NOT read the factor back with `getZoomFactor()`
  instead: it lags the call by a step and the border tears at every other zoom.
  `Math.ceil`, not `Math.round`, so the rounding error is always a spare pixel of
  bar rather than a covered border. The panel window's size and position scale by
  the same factor.
- **Narrow windows shed parts in a fixed order** - section, wordmark, arrows,
  file name - at the breakpoints at the very END of the DESKTOP WINDOW CHROME
  block. They are last in the file on purpose: they override the component rules
  at the same specificity, so source order decides. The window controls never
  shrink away, because they are the only way to close a frameless window.

## Not done yet

File associations, a bundled ffmpeg core and OCCT, cross-origin isolation, and
code signing. A certificate would also let macOS install its own updates. All
of them need a decision first - see `research/ELECTRON-PLAN.md`, Phase 3 and
Phase 4.
