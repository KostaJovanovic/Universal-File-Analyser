# Android app (Capacitor)

An Android version of Analyser is in development. Early builds are on the
[download page](download.md). Like the [desktop app](desktop.md), it wraps **the same `web/` tree Cloudflare
serves**. There is no fork of the app code, and nothing in the analysis
pipeline changes. The privacy promise is identical: everything still happens on
your own phone, and no file ever leaves it.

The source lives in `mobile/` and is dev-only. Cloudflare never serves it, and
it does not touch the website deploy. The plan includes an iOS version, but
work on it has not started.

## Getting the app and updates

Download `Analyser-android.apk` from the [download page](download.md) and open
it. The app needs Android 7 or later. Android asks you once to allow installs
from your browser or file manager.

The app looks for a new version when it starts, at most once every six hours.
When one is out, it asks you first. **Update** downloads the new version with a
progress bar and makes sure that the file is complete and really is Analyser.
Then it opens the Android installer, which asks you to confirm. Android also
refuses any update that does not carry the same signature as the app you have.

A check asks GitHub which release is the latest, and sends nothing else. A build you make yourself with `mobile.bat` never
checks.

## Hardware video

This is the main reason for the app, as it is for the desktop one.

On the web, video work runs on FFmpeg compiled to WebAssembly. That build is
software-only and uses one processor core, and the processor in a phone is
slower than a desktop one anyway. The app runs a real FFmpeg program instead.
On top of that, it can reach the video encoder built into the chip of the
phone, through Android MediaCodec.

The app tests the encoders of the phone by encoding a few throwaway frames, and
trusts only the ones that succeed. Chips differ a lot, so a list of what the
phone claims to support is not good enough. The app keeps the result until the
next system update, which can change the drivers.

If the chip refuses a job, for example because of an unusual frame size, the
app repeats it on a software encoder. You get the result either way. With no
FFmpeg program in the build at all, the app uses the WebAssembly version,
exactly as the website does.

The build of the FFmpeg program leaves out every GPL part. That is why its
software H.264 encoder is openh264, from Cisco, rather than x264.

## The AI models

The vocal separator uses the graphics chip through WebGPU wherever the WebView
of the phone offers it, on the website and here alike.

The desktop app also runs the noise remover on several processor cores. That
needs a browser feature that an Android WebView does not give an app, so on a
phone the noise remover uses one core, as it does on the website.

## How the page loads

The app serves the site from inside the app, at `https://app`. That address is
fixed on purpose. The service worker treats `localhost` as a development
server and turns its caching off there, so `localhost` would lose the offline
behaviour.

Clean URLs work as on the website: `/about` serves `about.html`, and an unknown
path serves the 404 page with a 404 status. The app ships its own router for
this. It is a port of the same routing the local development server and the
desktop app use, because the stock Capacitor server would show the home page
for `/about`. The requests of the service worker go through that router too,
or it would cache the wrong page.

## Moving files between the page and the phone

The page and the native side of the app exchange messages as text. Sending a
video that way would make it a third larger and hold several copies in memory
at once, and a large file would crash the WebView. So files take two other
routes:

- **Into the native side:** a dedicated channel that takes raw binary chunks, 4
  MB at a time, and confirms each one before the page sends the next.
- **Back to the page:** the page simply downloads the finished file from an
  address inside the app.

The service worker never caches either route, so none of your files lands in
the offline cache.

## Opening and saving files

- **Open with** and **Share to Analyser** from any app hand the file straight
  to the analysis pipeline. Analyser appears in the list, but it never becomes
  the default app for a file type unless you choose that.
- **The file picker** works as it does in a phone browser, including picking
  several files.
- **Every download** - a converted video, an extracted file, the exported
  report - opens the system "save to" dialog. On the website a download goes
  to the downloads folder of your browser.
- **Share** buttons open the system share sheet.

## The stats API

The anonymous analysed-count ping, `/stats` and the Asteroids leaderboard work
as on the website. The app sends those requests through its native side,
because a WebView cannot forward them the way the desktop app does. It still
sends only a lowercase extension string - see [`worker.md`](worker.md) and the
privacy page.

## Security model

- `core/sanitize.js` remains the only defence against a crafted file that
  tries to run script in the page, exactly as on the site.
- A script that got past it could call the native features of the app, so each
  one takes only what it needs. Web requests go to one address on the Analyser
  site. Saving writes only where you choose in the system dialog. FFmpeg works
  only inside a temporary folder of its own.
- The app checks every FFmpeg job before it runs. It refuses any job that
  names a file outside that folder, a network address, a camera or the screen,
  or a filter that loads outside code. The FFmpeg program itself also leaves
  out network support and capture devices.
- The app switches off two built-in Capacitor routes that would let the page
  read files anywhere the app can reach.

## What differs from the website

| Area | In the Android app |
|---|---|
| Video encoding | A real FFmpeg program, on the video encoder of the phone where it works |
| Downloads | The system "save to" dialog |
| "Open with" and "Share to" | Supported |
| The back button | Goes up one level inside an archive or folder first, then back a page |
| Status bar | Takes the background colour of the page, in light and dark themes |
| "Install as app" | Becomes **Check for updates** |
| "Get App" button | Hidden. You already have the app |
| "Email me!" and "Suggest this format" | The app skips the human-check, because that widget belongs to the address of the site. The mail app opens directly |
| Memory limits | The same as the browser on the phone. The app deliberately does not raise them, because a WebView gets only part of the memory of the phone |

## Not built yet

The app builds and its safety checks pass their tests. No one tested it on a
range of phones yet, and no one built or measured the FFmpeg program yet. Also
outstanding: a folder picker, keeping long video jobs running in the
background, a store release and the iOS version.
