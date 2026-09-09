# Analyser desktop (Electron)

The Windows desktop build of Analyser. It wraps the same `web/` tree Cloudflare
serves - there is no fork of the app code and nothing in the analysis pipeline
changes. The site keeps deploying exactly as it did.

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
npm run dist         # stamp the version, then NSIS installer + portable exe (x64)
npm run pack         # unpacked build in dist/win-unpacked, faster for a smoke test
```

Output lands in `desktop/dist/` (gitignored). Both builds are **unsigned**, so
Windows SmartScreen warns on first run. Signing is a Phase 4 decision - see
`research/ELECTRON-PLAN.md`.

## How it fits together

| File | Job |
| --- | --- |
| `main.mjs` | App lifecycle, scheme handlers, window, security policy, open-by-path |
| `router.mjs` | `route(pathname, webDir)` - a one-to-one port of `serve.py`'s `_route()` |
| `preload.cjs` | The only bridge to the page: one frozen object, `window.anrDesktop` |
| `menu.mjs` | File / Edit / View / Go / Help menu |
| `ffmpeg-native.mjs` | Finds an ffmpeg binary, probes its working hardware encoders, runs jobs |
| `electron-builder.yml` | Targets, `extraResources`, NSIS options |
| `tools/stamp-version.mjs` | Writes `major.minor.0` into `package.json` from `COMMIT_COUNT` |
| `build/icon.png` | The site mark, used for the window and the installer |

### Portable mode

`npm run dist` emits three artefacts: the NSIS installer, a self-extracting
`portable.exe`, and a `win.zip` of the unpacked folder.

By default Electron puts `userData` in `%APPDATA%`, which for this app means the
offline cache, the analysed history, the theme and the window position get
written to the host machine and left there. For a tool whose whole promise is
"nothing leaves your machine", that is the wrong default on a USB stick. So in
portable mode `main.mjs` calls `app.setPath('userData', <exe dir>/Analyser-data)`
before anything reads a path.

Two ways to be portable, both handled by `portableRoot()`:

1. **`PORTABLE_EXECUTABLE_DIR`** - electron-builder's `portable` target sets this
   at runtime to the directory the `.exe` was launched from. It is the only way
   to find that place: the app itself is unpacked to a temp folder, so
   `process.resourcesPath` points somewhere else entirely.
2. **A `portable.txt` marker** beside the executable. This is what makes the zip
   (or any copied `win-unpacked/`) portable, with no special build.

Consequences worth keeping in mind:

- `setPath` must run **before** `requestSingleInstanceLock()`, because Electron
  keys that lock on `userData`. Getting the order right is also what lets a
  portable copy and an installed copy run at the same time instead of one
  silently focusing the other.
- A read-only stick makes `mkdirSync` throw. That is caught, and the app starts
  in normal (non-portable) mode rather than failing - Help > "Where my data is
  stored" then reports the real location, so the user is never misled.
- `unpackDirName` stays at its default, a uuid regenerated per BUILD rather than
  per launch, so a given version extracts once and reuses it. Setting it to
  `false` would leave no persistent temp folder but re-extract 118 MB every run.
- A portable copy prefers an `ffmpeg.exe` sitting next to it (or under
  `ffmpeg/` or `ffmpeg/bin/`) over whatever is on the host's PATH, so the stick
  can carry its own hardware video path.

### Native FFmpeg (`ffmpeg-native.mjs`)

The reason the desktop build exists. `@ffmpeg/core` is WebAssembly, which is
software-only and single-threaded, so it cannot touch a GPU's encoder blocks.
Measured on one machine, the same 10 s 720p transcode: **30.5 s** on WASM,
**1.1 s** native software, **0.58 s** on NVENC. That is 52x.

Three parts:

1. **Find** a binary - a bundled one under `resources/ffmpeg/` (none shipped
   yet), then `PATH`, then the usual per-platform install directories.
2. **Probe.** `ffmpeg -encoders` is NOT evidence: a full build lists every
   family it was compiled with, so an NVIDIA-only machine still advertises
   `h264_qsv` and `h264_amf` and fails both at runtime. The probe encodes a
   throwaway frame with each candidate and keeps only what exits 0. Cached in
   `userData/ffmpeg-caps.json`, keyed by the binary's path, size and mtime.
3. **Rewrite and run.** `accelerate()` maps `-c:v libx264` onto this machine's
   encoder, translates the x264 preset name (NVENC wants `p1`..`p7`), converts
   `-crf` to the family's own quality flag, and adds `-hwaccel` for decode when
   no filter graph needs CPU frames. `-c copy` is never touched.

Two rules to keep:

- **A hardware failure retries the ORIGINAL software arguments.** Drivers refuse
  jobs for unglamorous reasons - NVENC rejects frames below roughly 145x49, for
  one. The retry is what stops a hardware quirk losing a user's work. Verified:
  a 32x32 clip fails on NVENC and completes in software with no visible error.
- **The page must not be able to tell which backend it got.**
  `loadNativeFFmpeg()` in `src/renderers/video.ts` returns an object with the
  same shape as an ffmpeg.wasm instance, which is the only reason the ~40 call
  sites in that file needed no edits. `exec` resolves on a non-zero exit and
  rejects only when ffmpeg could not start, because callers use exactly that
  difference to tell a clean failure from a dead instance.

With no binary installed, `caps().available` is false and `video.ts` loads the
WASM core exactly as the website does.

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

For a folder, the listing carries **stubs**, not files - materialising every
entry up front would copy the whole tree through the blob store just to draw a
treemap. `desktopFile()` in `src/core/util.ts` turns one into real bytes when
something actually reads it. The one place that costs is the folder view's
"Openability check", which reads every file by design.

## What ships in the package

`web/` goes in as `extraResources`, so it lands in `resources/web/` as ordinary
files rather than inside the asar - which keeps `net.fetch(pathToFileURL(...))`
trivial and sidesteps asar quirks around the 72 MB of vendor WASM.

Left out: `samples/**` (19 MB of gallery example files - which is why the menu
has no Samples entry), `**/*.map`, `sitemap*.xml`, `robots.txt`, `llms.txt` and
`_headers`. `formats/**` is kept: the `/formats` hub links straight at those
pages, and a hub full of dead links is a worse trade than the 25 MB.

## Icons

`build/icon.png` is `web/assets/img/icon-512.png`, copied verbatim.
electron-builder converts it to a Windows `.ico` at build time, so no `.ico` is
checked in and no image dependency is needed.

To supply a hand-made icon instead, drop a real multi-resolution `build/icon.ico`
(16, 32, 48, 64, 128 and 256 px) next to it and point `win.icon` in
`electron-builder.yml` at it. Nothing else changes.

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
  `mailto:` opens directly.
- `core/offline-tiers.ts` - the PWA install button is hidden. The download tiers
  stay: the ffmpeg core, OCCT, Tesseract language data and the ONNX models are
  all still remote.
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
    recedes exactly while a menu is being used.
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
- **Narrow windows shed parts in a fixed order** - section, wordmark, arrows,
  file name - at the breakpoints at the very END of the DESKTOP WINDOW CHROME
  block. They are last in the file on purpose: they override the component rules
  at the same specificity, so source order decides. The window controls never
  shrink away, because they are the only way to close a frameless window.

## Not done yet

File associations, a bundled ffmpeg core and OCCT, cross-origin isolation, CI
and code signing, and auto-update. All of them need a decision first - see
`research/ELECTRON-PLAN.md`, Phase 3 and Phase 4.
