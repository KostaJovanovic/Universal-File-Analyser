# Desktop app (Electron)

Analyser also runs as a Windows desktop application. It wraps **the same
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
Quick Sync, AMD AMF and Apple VideoToolbox, and it picks whichever one the
machine really has.

"Really" is the important word. Asking FFmpeg which encoders it contains is not
a useful answer, because a build lists every family it was compiled with. A
machine with only an NVIDIA card still advertises the Intel and AMD encoders,
and both fail the moment you use them. So the app tests each one by encoding a
throwaway frame, and only trusts the ones that succeed. The result is cached, so
only the first launch pays for it.

If a hardware encode fails anyway, for instance because a driver refuses an
unusual frame size, the app silently repeats the job on the software encoder.
You get the result either way. It also falls back to the WebAssembly build in
full when no FFmpeg binary is installed, so the app still works without one.

## What about the AI models

The vocal separator and the noise remover run on ONNX Runtime, and the separator
**already uses your GPU**, through WebGPU, on the website as well as here. The
desktop app changes nothing about that because there was nothing to fix.

The noise remover deliberately stays on the processor. Its network is a
recurrent one, and the WebGPU backend computes that kind of graph incorrectly,
producing a near-silent result with the voice pushed into the noise track. It is
a small model and the processor handles it comfortably, so correctness wins.

## Portable use

There are three downloads, and two of them leave the computer as they found it.

| Build | What it is |
|---|---|
| `Analyser-Setup-<version>.exe` | The normal installer. Settings go in your user profile |
| `Analyser-<version>-portable.exe` | One file. Run it from anywhere, including a USB stick |
| `Analyser-<version>-win.zip` | Unzip and run. Nothing is extracted at start-up, so it opens quicker |

A portable copy keeps **everything** in a folder called `Analyser-data`, beside
the program. That covers the offline downloads, the recently-analysed list, the
theme and the window size. Delete the folder and no trace of your use remains.
Files you analyse are never stored by any build.

For the zip, put an empty file named `portable.txt` next to `Analyser.exe`. That
is the switch that turns portable storage on. Without it a copied folder behaves
like an installed copy.

To check any of this, open **Help**, then **Where my data is stored**. It names
the exact folder and offers to open it.

Two details worth knowing. The single-file build unpacks itself to a temporary
folder the first time each version runs, then reuses it, so only the first
start-up is slow. And a portable copy runs alongside an installed one, because
the two keep separate settings.

You can also drop an `ffmpeg.exe` next to the portable program, or in an
`ffmpeg` folder there. The app prefers that one, so the stick carries its own
hardware video support rather than relying on the computer it is plugged into.

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
| Dev (`npm start`) | `analyser://localhost/` | `sw.js` sees hostname `localhost` and becomes a pass-through; the dev-only reset buttons appear |
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
| "Install as app" | Hidden. You already installed it |
| Download for offline use | Unchanged, and still worth doing. The ffmpeg core, OCCT, the Tesseract language data and the ONNX models all still come from the network on first use |
| Device tier | Sized from real total RAM, not `navigator.deviceMemory`, which browsers clamp at 8 GB. A large machine gets the caps it deserves |
| Export report | Offers a native save dialog, and keeps the browser path as a fallback |
| Video encoding | Runs on your graphics hardware through a real FFmpeg binary. See the section above |

## What ships in the package

The web assets go in as ordinary files under `resources/web/`, not inside the
asar archive, which keeps the 72 MB of vendor WebAssembly straightforward to
read.

The build leaves out the `/samples` gallery files (19 MB of examples), the
source maps, the sitemaps, `robots.txt`, `llms.txt` and `_headers`. It keeps the
generated `/formats/<ext>` pages, so the formats hub works offline.

## Version numbers

`desktop/tools/stamp-version.mjs` reads `COMMIT_COUNT` from `src/core/app.ts`
and applies the same formula as `analyserVersion()`, writing `major.minor.0`
into `desktop/package.json`. The installer version and the number in the app's
own footer therefore always agree. See [`tooling.md`](tooling.md) for how the
site's version numbering works.

## Not built yet

The app uses an FFmpeg binary it finds on your machine, and falls back to the
WebAssembly build when there is none. Shipping one inside the installer is the
obvious next step, and would make the hardware path work on a fresh machine.

Also outstanding: file associations, a bundled OCCT, a frameless title bar,
automated release builds, code signing and auto-update. Builds today are
unsigned, so Windows SmartScreen warns the first time one runs.
