# Desktop app (Electron)

Analyser also runs as a desktop application for Windows, macOS and Linux. Get
it from the [download page](download.md). It wraps **the same
`web/` tree Cloudflare serves** - there is no fork of the app code, and nothing
in the analysis pipeline changes. The privacy promise is identical: everything
still happens on your own machine and no file ever leaves it.

The source lives in `desktop/` and is dev-only. Cloudflare never serves it,
`save.bat` never runs it, and it does not touch the website deploy.

## Hardware video acceleration

This is the main reason to run the desktop app rather than the website.

On the web, video work runs on FFmpeg compiled to WebAssembly. WebAssembly is
sandboxed software, with no route to the dedicated encoding hardware on a
graphics card, so a transcode that a GPU finishes in well under a second takes
it about half a minute. The desktop app runs a real FFmpeg binary instead.

Measured on one machine, the same ten-second 720p transcode:

| Path | Time |
|---|---|
| WebAssembly FFmpeg, what the website uses | 30.5 s |
| Native FFmpeg, software encoder | 1.1 s |
| Native FFmpeg, NVIDIA NVENC | 0.58 s |

The app detects the graphics hardware for you. It supports NVIDIA NVENC, Intel
Quick Sync, AMD AMF, Apple VideoToolbox and, on Linux, VAAPI (Intel and AMD
graphics through the open drivers), and it picks whichever one the machine
really has. The VAAPI route has not yet been tried on a real Linux machine; if
it fails there, the software retry below covers it.

"Really" is the important word. Asking FFmpeg which encoders it contains is not
a useful answer, because a build lists every family it was compiled with. A
machine with only an NVIDIA card still advertises the Intel and AMD encoders,
and both fail the moment you use them. So the app tests each one by encoding a
throwaway clip, and only trusts the ones that succeed. It then decodes that clip
on the same hardware, which tells it whether the graphics card can also do the
decoding. The result is cached, so only the first launch pays for it.

Decoding moves to the graphics card too where it can. With NVIDIA, the convert
tool's resize also runs on the card, so a frame never visits the processor. The
fast "Turbo" convert uses the hardware encoder as well; it used to fall back to
software on NVIDIA.

If a hardware job fails anyway, for instance because a driver refuses an unusual
frame size or cannot decode a stream, the app retries it - first with the
hardware encoder alone, then entirely in software. You get the result either
way. It also falls back to the WebAssembly build in full when no FFmpeg binary
is installed, so the app still works without one.

### Other work the desktop does natively

- **Large files are not copied.** A file you opened, dropped or picked is read
  by FFmpeg where it is on disk, instead of being copied into a temporary
  folder first.
- **Hashes run at disk speed.** For files past 32 MB, the Integrity card's
  SHA-256, and the extra CRC-32, MD5, SHA-1 and SHA-512, are computed by the app
  itself straight from the file, not by JavaScript in the page.
- **Scene changes come from one pass.** Scene detection, and the content
  timeline built on it, read their samples with one FFmpeg decode instead of
  hundreds of seeks in the player.
- **No WebAssembly FFmpeg in the offline download** when a native binary is
  found, since it would never run. Without one, it is cached as on the website.

The page still names a file only by a token the app hands it. The app looks the
token up itself, and FFmpeg only ever reads such a file, never writes to it.

### Getting FFmpeg

The app looks for FFmpeg by itself: on your PATH, in the usual install folders,
and next to a portable copy. If it finds none, the first video job of a session
offers to get one:

- **Download FFmpeg** fetches a build from
  [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) on GitHub (about
  150 to 200 MB), checks it against its SHA-256, and keeps only the `ffmpeg`
  program, in Analyser's own data folder. Nothing else is installed, and a
  portable copy keeps it on the stick. The job that asked carries on in the
  WebAssembly build meanwhile, and the next one uses FFmpeg.
- **Choose the ffmpeg file** points Analyser at a copy you already have. It is
  asked for its version first, and refused unless it answers as FFmpeg.
- **Don't ask again** stops the offer for good.

**Help**, then **FFmpeg (hardware video)**, shows which FFmpeg is in use and
which graphics hardware it encodes on, and offers the same two actions at any
time. There is no download for macOS, because BtbN builds none: install it with
Homebrew (`brew install ffmpeg`) and Analyser finds it.

## What about the AI models

The vocal separator and the noise remover run on ONNX Runtime, and the separator
**already uses your GPU**, through WebGPU, on the website as well as here. The
desktop app changes nothing about that because there was nothing to fix.

The noise remover deliberately stays on the processor. Its network is a
recurrent one, and the WebGPU backend computes that kind of graph incorrectly,
producing a near-silent result with the voice pushed into the noise track. It is
a small model and the processor handles it comfortably, so correctness wins.

## Portable use

Windows has one download, `Analyser-Windows-<version>.exe`. Its first page asks how to
set Analyser up:

- **Install** adds it to the Start menu and the desktop for your user account,
  keeps its settings in your user profile, and updates itself.
- **Portable copy** puts the program in a folder you choose on the same page,
  for example on a USB stick. It writes nothing to the computer: no Start menu
  entry, no registry key and no uninstaller. To remove it, delete the folder.

Then a progress page, and a last page with a box that starts Analyser.

A portable copy keeps **everything** in a folder called `Analyser-data`, beside
the program. That covers the offline downloads, the recently-analysed list, the
theme and the window size. Delete the folder and no trace of your use remains.
Files you analyse are never stored by any build.

The switch is a file named `portable.txt` next to `Analyser.exe`, which the
installer writes. Delete it and the copy behaves like an installed one.

To check any of this, open **Help**, then **Where my data is stored**. It names
the exact folder and offers to open it.

A portable copy runs alongside an installed one, because the two keep separate
settings. To update a portable copy, run the new Windows file, choose
**Portable copy** and pick the same folder. It replaces the program and keeps
`Analyser-data`.

You can also drop an `ffmpeg.exe` next to the portable program, or in an
`ffmpeg` folder there. The app prefers that one, so the stick carries its own
hardware video support rather than relying on the computer it is plugged into.
A portable copy runs whatever `ffmpeg.exe` it finds there, so only put a copy
you trust in that folder, and keep the folder where nobody else can write to it.

## Updates

Every build is on one page, the
[latest release](https://github.com/KostaJovanovic/Universal-File-Analyser/releases/latest)
on GitHub. The [download page](download.md) says which file to pick.

The app looks for a new version 20 seconds after it starts, and then once a
day. **Help > Check for updates** and the **Check for updates** button in the
footer look at once. The app never opens a message about updates. It shows the
answer on a green **Update** button at the right of the title bar, next to the
window buttons, and the button shows only while there is something to say.
Point at it to read the whole sentence. What a press does depends on the copy
you run:

| Copy | A press on Update |
|---|---|
| Windows, installed | Downloads the new version, with the button counting the percentage, then restarts into it |
| Linux AppImage | The same |
| Windows portable copy, macOS | Opens the download page |

If a download or a check fails, the button reads **Retry update**, and a press
tries again. A check that fails on its own, for example while you are offline,
shows nothing and tries again later.

The copies in the last row cannot replace themselves. For a portable copy, run
the new Windows file, choose **Portable copy** and pick the same folder. macOS
installs an update by itself only for an app with a paid Apple signature, and
this one has none yet.

The app checks every download against the checksum that GitHub publishes for
the file, and throws away a download that does not match.

A check asks GitHub which release is the latest. It sends nothing about you or
your files. A copy you run from the source code (`desktop.bat`) never checks.

## Why a custom scheme instead of `file://`

The app uses root-relative URLs (`/assets/vendor/exifr.umd.js`, every nav
link), ES modules, module workers, `import.meta.url`, `history.pushState`, the
Cache API and a service worker. All of those break or degrade on `file://`.

So `desktop/main.mjs` registers a scheme, `analyser`, with the privileges
`standard`, `secure`, `supportFetchAPI`, `corsEnabled`, `stream` and
`allowServiceWorkers`. The page then has a real origin and a secure context,
and behaves exactly as it does on the website - service worker, offline tiers
and all.

The host is load-bearing rather than cosmetic:

| Build | URL | Effect |
|---|---|---|
| Dev (`desktop.bat`, or `npm start`) | `analyser://localhost/` | `sw.js` sees hostname `localhost` and becomes a pass-through; the dev-only reset buttons appear |
| Packaged | `analyser://app/` | Production behaviour, service worker active |

Neither needed a line of app code to arrange.

## Routing

`desktop/router.mjs` is a one-to-one port of `serve.py`'s `_route()`, which
itself mirrors the production Cloudflare routing:

- `/` serves `index.html`
- `/about` serves `about.html`, `/formats/pdf` serves `formats/pdf.html`
- the handler serves real files (`/assets/...`) as they are, after percent-decoding
- anything else serves `404.html` with a 404 status

Two deliberate differences from `serve.py`. The handler serves `/x.html`
directly instead of redirecting it to `/x`, because inside an app no
canonical-URL argument applies. And it does not mock `/api/*` - see below.

Content types come from a small table in `router.mjs` whenever the handler knows
the extension. Chromium refuses a module script unless `.mjs` carries
`text/javascript`, and streaming compilation fails unless `.wasm` carries
`application/wasm`. The table leaves neither to the platform's own guess.

## The stats API

`API_ORIGIN` in `src/core/util.ts` is `''` (same origin) and the Worker sets no
CORS headers, so a fetch from `analyser://app` straight to the live site would
fail. The main process forwards `/api/*` to `https://analyser.valjdakosta.com`
with `net.fetch()`, where CORS does not apply.

The result: the visitor badge, the anonymous analysed-count ping, `/stats` and
the Asteroids leaderboard all work exactly as on the website, and neither
`util.ts` nor the Worker needed changing. Desktop analyses count into the same
site totals, and still send only a lowercase extension string - see
[`worker.md`](worker.md) and the privacy page.

## Security model

The renderer runs with `contextIsolation`, `sandbox` and no Node integration,
and `webviewTag` off. It never sees Node. A crafted file that finds an XSS in a
renderer gets the surface it has on the website, not your filesystem -
`core/sanitize.js` remains the only XSS defence, exactly as on the site.

- `http`, `https` and `mailto` links open in your own browser or mail client.
  Nothing else opens at all.
- The page itself opens the one permitted child window, the export report's
  `about:blank`.
- The permission handler allows fullscreen and clipboard, and denies everything
  else - notifications, geolocation, camera, microphone, MIDI, USB, serial.
- The main process checks every FFmpeg job before it runs. The page chooses
  FFmpeg's arguments, so the app refuses any job that names a file outside the
  job's own temporary folder, a network address, a camera or the screen, or a
  filter that loads outside code. The one path it accepts is a Linux graphics
  device (`/dev/dri/renderD128` and its siblings), and only as the VAAPI
  device. A file you opened is read in place only after the job has passed
  these checks under its plain name.
- Native work on a dropped file needs a token, and the app mints one only for a
  file you gave the page. A file the page built itself has no path to name.
- There is no Content Security Policy, for the same reason `web/_headers` has
  none: the app lazy-loads WebAssembly, spawns blob and module workers and uses
  `data:` URIs, and a wrong policy would silently break individual viewers.

The preload exposes a single object, `window.anrDesktop`. Every method on it is
a message to the main process, never a handle to anything.

## Opening files

Drag-and-drop and the in-page file picker work as they always have, and remain
the best paths: the `File` they produce points straight at the file on disk, so
the app reads a multi-GB video in slices instead of copying it.

The menu adds two more, for the case a browser tab cannot cover:

- **File > Open file** (`Ctrl+O`)
- **File > Open folder** (`Ctrl+Shift+O`)

Plus a path passed on the command line, and a second launch handing its argument
to the running window.

A renderer with no Node access cannot build a `File` from a path, so the main
process mints a one-time token on a second scheme, `anr-open://<token>`, and
maps it to the approved path. The page fetches that and wraps the result in a
real `File` before handing it to the normal analysis pipeline. The app therefore
holds a file opened this way as a blob instead of reading it off disk - so drop
a very large file rather than opening it by path.

The app lists a folder opened by path without reading any of it. Each entry
becomes real bytes only when you click it, or when you run the folder view's
"Openability check", which reads every file by design.

## What differs from the website

Every desktop-only branch in the app source sits behind `window.anrDesktop`,
which does not exist in a browser. The website is unaffected.

| Area | On the desktop |
|---|---|
| Header status | The Online/Offline probe pings the live site, not the local origin, which would always answer |
| "Email me!" and "Suggest this format" | The app skips the human-check, because that widget belongs to the site's hostname and can never verify here. The mail client opens directly |
| "Install as app" | Becomes **Check for updates** |
| "Get App" button | Hidden. You already have the app |
| Download for offline use | Still worth doing. OCCT, the Tesseract language data and the ONNX models all still come from the network on first use. The WebAssembly FFmpeg is left out when a native FFmpeg is found |
| Hashes | Files past 32 MB are hashed by the app straight from disk |
| Device tier | Sized from real total RAM, not `navigator.deviceMemory`, which browsers clamp at 8 GB. A large machine gets the caps it deserves |
| Export report | Offers a native save dialog, and keeps the browser path as a fallback |
| Video encoding | Runs on your graphics hardware through a real FFmpeg binary, which also decodes and finds scene changes. See the section above |
| Title bar | The window draws its own, above the page. See below |

## The title bar

The window has no system frame on Windows, so it draws the whole title bar
itself: the menu bar, the wordmark, back and forward, the section you are on,
the name of the file you are analysing, and the minimise, maximise and close
controls. It is the same hairline band as the rest of the site - square corners,
mono type - so the window edge and the page read as one surface instead of two.

The bar is a separate layer, not part of the page. The site sits in its own view
below it and never has to leave room for it, so anything the page pins to the
top of the window - the navigation strip, the dashed frame that appears when you
drag a file over the window, an image opened full size - lines up against the
bar and stops there. The minimise, maximise and close buttons stay reachable
whatever is open.

The menus are drawn to match the site rather than popped from the system, and
they carry the same shortcuts as before. The window controls use the system
glyphs, from the icon font every native Windows title bar draws, so they sit at
the weight and size you expect. Drag anywhere on the bar to move the window, and
double-click it to maximise. Click the wordmark to reload the app.

Narrow the window and the bar sheds what it can spare, in order: the section
name, then the wordmark, then the arrows, then the file name. The window
controls always stay.

macOS keeps its native frame, so the traffic lights stay where they belong and
the app draws no buttons of its own. In full screen the bar goes away and the
page gets the whole screen.

## What ships in the package

The web assets go in as ordinary files under `resources/web/`, not inside the
asar archive, which keeps the 72 MB of vendor WebAssembly straightforward to
read.

The build leaves out the source maps, the sitemaps, `robots.txt`, `llms.txt`,
`_headers` and the `/samples` gallery files. A sample is downloaded from the
website the first time you open it, and after that it opens offline like the
rest of the app. The generated `/formats/<ext>` pages are kept, so the formats
hub works offline.

## Version numbers

`desktop/tools/stamp-version.mjs` reads `COMMIT_COUNT` from `src/core/app.ts`
and applies the same formula as `analyserVersion()`, writing `major.minor.0`
into `desktop/package.json`. The installer version and the number in the app's
own footer therefore always agree. See [`tooling.md`](tooling.md) for how the
site's version numbering works.

## Not built yet

The app uses an FFmpeg binary it finds on your machine, or one it downloads when
you ask (see "Getting FFmpeg" above), and falls back to the WebAssembly build
when there is none. Shipping one inside the installer would make the hardware
path work on a fresh machine with no download at all.

Intel graphics do not yet resize on the card the way NVIDIA's do (the decode
and the encode both run there already).

Also outstanding: file associations, a bundled OCCT and code signing. No build
carries a paid certificate yet, so Windows SmartScreen warns the first time one
runs, and macOS asks you to allow it in Privacy & Security. A certificate would
also let macOS install updates by itself.
