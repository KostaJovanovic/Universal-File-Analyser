# Analyser Android (Capacitor)

The Android build of Analyser. It wraps the same `web/` tree Cloudflare serves,
the way `desktop/` does. There is no fork of the app code, and the website keeps
deploying exactly as it did. The plan, its decisions and its open questions are
in `research/CAPACITOR-PLAN.md`. iOS is planned there but not started, because
it needs a Mac.

Everything here is dev-only. `web/` never sees it, and `save.bat` does not run
it.

## Run it

`mobile.bat` in the repo root is the one-step way:

```
mobile.bat          build, install on a USB-connected phone, and start it
mobile.bat apk      build only: mobile\android\app\build\outputs\apk\debug\app-debug.apk
mobile.bat open     stage and sync, then open Android Studio
```

It needs Node 22 or newer, the Android SDK (platform 36) on `ANDROID_HOME`, and
**JDK 21** for Gradle. JDK 17 is not enough for Capacitor 8. The script uses
`JAVA_HOME` when that is 21 or newer, and otherwise looks in
`%USERPROFILE%\.jdks` and in the `jbr` runtime that Android Studio bundles.

The steps by hand, from `mobile/`:

```
npm install                 # once
npm run sync                # stamp the version, stage web/, cap sync
cd android
gradlew assembleDebug       # the APK
gradlew testDebugUnitTest   # the Java port of the ffmpeg safety checks
```

**The APK carries a COPY of the site.** `tools/stage-web.mjs` copies `web/` into
`mobile/www/`, and `cap sync` copies that into the Android project. So an edit
in `src/` shows on the phone only after `tsc` and `mobile.bat` run again.

For a faster loop, point the WebView at `serve.py` on this machine. Start
`server.bat`, then from `mobile/` run
`npx cap run android --live-reload --host <this PC's LAN IP> --port 3000`. Then
save and reload in the app. `sw.js` and the dev-only reset buttons already
treat a LAN address as dev. The bridge and the native FFmpeg still work, because
`AnrWebViewClient` serves `/__anr/*` for the dev server too.

## How it fits together

| File | Job |
| --- | --- |
| `capacitor.config.json` | App id, `server.hostname: "app"`, `resolveServiceWorkerRequests: false`, SystemBars `insetsHandling: "disable"`, `minWebViewVersion: 110` |
| `tools/stage-web.mjs` | `web/` to `www/` with the same exclusions as the desktop. Also writes `anr-bridge.js` and `anr-files.txt` into the Android assets, and copies an FFmpeg binary in |
| `tools/stamp-version.mjs` | `versionName` from the version of the site, `versionCode` = `COMMIT_COUNT` |
| `tools/make-icons.mjs` | `npm run icons`: renders `web/assets/img/favicon.svg` without its rounded background into `assets/logo.png` and `logo-dark.png`, then writes the launcher icons and splash screens into `android/.../res/`. Rerun it when the mark changes |
| `bridge/anr-bridge.js` | The preload equivalent: `window.anrDesktop` for the phone |
| `ffmpeg/build-android.sh` | Cross-builds the FFmpeg executable (Linux, macOS or WSL) |
| `android/.../MainActivity.java` | Registers the plugins, owns the insets, the back button and incoming intents |
| `android/.../AnrShell.java` | Injects the bridge, installs the routing, `/api`, save, share, bar colour, opened files |
| `android/.../AnrWebViewClient.java` | Every request to the app origin, for the page and its service worker |
| `android/.../AnrRouter.java` | A port of `desktop/router.mjs`, so of `serve.py`'s `_route()` |
| `android/.../AnrBytes.java` | The byte channel, page to native (`window.anrBytes`) |
| `android/.../AnrFfmpeg.java` | Native FFmpeg: sessions, the encoder probe, jobs as child processes |
| `android/.../AnrFfmpegChecks.java` | The ffmpeg safety checks, a port of `desktop/ffmpeg-accel.mjs` |
| `android/.../AnrUpdate.java` | Release builds only: checks the GitHub release for a newer APK, then downloads, checks and installs it. The footer's "Check for updates" button runs it at once |

## The bridge

`bridge/anr-bridge.js` defines `window.anrDesktop` with the **same shape as
`desktop/preload.cjs`**. Every guard in `src/` is written against that shape,
so each one works on the phone unchanged, and each one is also right there. For
example, the online probe pings the live site, and Turnstile is skipped
because it cannot verify on the app origin. The install button becomes
"Check for updates", and the
report goes through a native save. Two fields are new or differ:

- `shell: 'capacitor'`. The desktop leaves it unset, so a branch that must not
  run on a phone tests `!window.anrDesktop.shell`.
- `memoryGB: 0`, **on purpose**. `limits.ts` lets a `high` device tier lift
  every mobile out-of-memory wall. The real RAM of a phone would read as `high`,
  while its WebView gets only a fraction of that RAM. With 0, `limits.ts` falls
  back to `navigator.deviceMemory`, which is what the website sees on the same
  phone.

`AnrShell.load()` injects the bridge with `addDocumentStartJavaScript`, for the
app origin only, before Capacitor loads the first page. So `window.anrDesktop`
exists before any page script runs, as the preload guarantees on the desktop.
`stage-web.mjs` inlines `desktop/ffmpeg-accel.mjs` ahead of it, so the encoder
rewrite rules are the same as on the desktop. That file must stay import-free with plain
`export const|function` exports, or the staging step refuses to build.

The bridge also fixes what a WebView lacks:

- **Downloads.** A `blob:` or `data:` link with `download` does nothing in a
  WebView. The bridge catches those clicks (a capture listener, plus a wrapper
  on `HTMLAnchorElement.prototype.click` for detached links) and hands the file
  to the system "save to" picker. None of the ~45 download sites in `src/`
  changed.
- **`navigator.share`**, which the Android WebView does not have: text and
  links through the system share sheet.
- **The back button.** `window.__anrBack()` goes up one drill-down level
  through the Back bar of the page, then back in page history. It returns
  `'exit'` when neither is left, and the app then goes to the background.
- **The bar colour.** The bridge reports the page background on every theme
  change, so the status-bar and gesture-bar bands match it.

## Routing

The local server of Capacitor serves `index.html` for every path without an
extension, so `/about` would show the home page. Its `RouteProcessor` hook does
not help: Capacitor only ever calls it with the fixed string `/index.html`. So
`AnrShell` installs `AnrWebViewClient`, which asks `AnrRouter` for the asset and
hands Capacitor a request with the routed URL.

`AnrRouter` is a third port of `serve.py`'s `_route()`, after
`desktop/router.mjs`. `serve.py` stays the spec, with the same two deliberate
differences as the desktop. The router serves `/x.html` directly, and `/api/*`
never reaches the router. `stage-web.mjs` writes the staged file list as
`anr-files.txt`, so each "does this file exist" check is a set lookup.

**A `.gz` file is stored as `x.gz.anr`.** The Android Gradle plugin unpacks
every `.gz` asset and drops the extension. `eng.traineddata.gz` reached the APK
as a 23 MB `eng.traineddata`, so OCR and the Everything download both failed on
the phone. `stage-web.mjs` adds the suffix, and `AnrRouter` maps a request for
`x.gz` to `x.gz.anr` and serves it as `application/gzip`.

**The service worker needs the same routing.** `sw.js` fetches pages to
precache them, and those requests skip the WebView client. `AnrShell` sets a
service-worker client that runs the same code, and
`resolveServiceWorkerRequests: false` stops Capacitor from replacing it.
Without both, the app would cache the home page under `/about`.

The host is `app`, not `localhost`, the Capacitor default. `sw.js` treats
`localhost` as dev and becomes a pass-through, and the two dev-only reset
buttons show on it.

## Moving bytes

The Electron IPC structured-clones a `Uint8Array`. The Capacitor bridge is JSON,
so bytes would cross it as base64: a third larger, with several copies alive
at once. A 500 MB video would take the WebView down. So bytes never use that
bridge:

- **Page to native:** `AnrBytes`, a WebMessageListener that the page sees as
  `window.anrBytes`. It takes `ArrayBuffer` chunks directly, on a WebView with
  `WEB_MESSAGE_ARRAY_BUFFER`. On an older WebView it takes base64 chunks of at
  most 4 MB. Native acknowledges every message, and the page waits for each
  acknowledgement, so one chunk at most is in flight.
- **Native to page:** a plain GET. `/__anr/ff/<session>/<name>` streams an
  ffmpeg output from disk, and `/__anr/open/<token>` streams a file that
  another app handed in.

`sw.js` skips `/__anr/*`, so these bytes never land in a cache.

## `/api/*`

The desktop proxies `/api/*` at its scheme handler. That does not work on
Android: `shouldInterceptRequest` never sees a request body, so the POSTs
(`/api/analysed`, `/api/visit`, `/api/score`) could not be forwarded. The
bridge wraps `window.fetch` for same-origin `/api/` requests only, and
`AnrShell.api()` sends them to `https://analyser.valjdakosta.com` natively,
where CORS does not apply. Neither `util.ts` nor the Worker changed.

`api()` accepts one host, the `/api/` path prefix, and GET or POST. A general
native HTTP client would let a script injected through a crafted file read any
site without a CORS check. So do not enable `CapacitorHttp` as a shortcut.

## Opening and saving files

- **"Open with" and "Share to Analyser"** are in the manifest for any MIME
  type. The app shows in the chooser, but it is never the default unless the
  user picks "Always". `AnrShell.deliver()` turns the intent into the same
  open payload as the desktop, with a `/__anr/open/<token>` URL, and `app.ts`
  handles it exactly as it does on the desktop. It accepts `content://` only.
- **The file chooser** comes from Capacitor, and multiple selection works. There is
  no folder picker yet.
- **Saving:** the bytes stage through `AnrBytes`, then `AnrShell.save()` opens
  the Storage Access Framework "create document" dialog.

## Native FFmpeg

The reason this app exists, as on the desktop. ffmpeg.wasm is software-only and
single-threaded. A real ffmpeg binary is many times faster even in software,
and on a phone it can reach the encoder built into the chipset, through MediaCodec.

**The binary.** `ffmpeg/build-android.sh` builds an LGPL FFmpeg for
`arm64-v8a`, with MediaCodec, openh264 as the software H.264 encoder, no
network protocols and no capture devices. It needs Linux, macOS or WSL. On
Windows without WSL, run the manual-only **Build Android FFmpeg** workflow from
the Actions tab of the repository, and unzip its artifact into `mobile/ffmpeg/out/`.
The next `mobile.bat` copies it to
`android/app/src/main/jniLibs/arm64-v8a/libanrffmpeg.so`.

It is an executable with the name of a library, on purpose. Since targetSdk 29 an app
may not execute a file it wrote itself. The native library folder is the one
place the system extracts runnable files to, and `useLegacyPackaging` in
`build.gradle` makes sure it does. **With no binary, the app runs ffmpeg.wasm,
exactly as the website does.**

**A child process, not a JNI call.** This is a forensic tool that opens hostile
files on purpose. A file that crashes libavcodec kills only the child, and the
page shows an error card instead of the app vanishing. The child also gives
Cancel a real kill, lets `/compare` run two jobs at once, and matches
`runJob()` on the desktop.

**The probe** encodes three throwaway frames with each MediaCodec encoder, and
keeps only the encoders that exit cleanly. It caches the result, keyed by the
binary and `Build.FINGERPRINT`, because an OS update replaces the codec
drivers.

**The rewrite and the retry run in the bridge**, from `ffmpeg-accel.mjs`.
`accelerate()` maps `libx264` onto `h264_mediacodec`. MediaCodec has no
reliable constant-quality mode, so `-crf` becomes a VBR bitrate, and a job
with no CRF still gets one, because the default of the encoder is 200 kbit/s. If
the chipset refuses a job, `softwareFallback()` retries on openh264, since the
build has no libx264. The bitrate table is a first guess, so measure it on real
phones.

**The safety checks run natively**, in `AnrFfmpegChecks.java`, on every exec.
The page chooses the arguments, and a script injected through a crafted file
can call the plugin directly. So the checks cannot live in the bridge. The
checks are a Java port of `checkArgs()` / `checkInputText()` in
`desktop/ffmpeg-accel.mjs`. `AnrFfmpegChecksTest` runs them against the same
vectors as `desktop/tools/check-ffmpeg-args.mjs`. Change one, change all
three. A refused job returns code 1, a clean failure, and the bridge does not
retry it.

## Security

The threat model is the same as on the desktop. `core/sanitize.js` stays the only XSS
defence, and there is no CSP, for the reasons in the root `CLAUDE.md`. A
crafted file that finds an XSS in a renderer can call every plugin, so each
plugin takes only what it needs:

- `AnrShell.api()`: one host, one path prefix.
- `AnrShell.save()`: writes only where the user picks in the system dialog.
- `AnrFfmpeg`: bare names inside its session folder, and the native safety
  checks on every job.
- The byte channel: registered for the app origin only, and names are
  flattened.
- `/_capacitor_file_/` and `/_capacitor_content_/` answer 404. Nothing here
  uses them, and they would give any page script a file reader.
- No general-purpose Capacitor plugins are installed.

## Releases and updates

`.github/workflows/release.yml` builds the APK on GitHub, next to the desktop
builds, and puts it in the same release as `Analyser-android.apk`. The Android
job does two things:

1. It restores the FFmpeg binary from the Actions cache. When
   `ffmpeg/build-android.sh` changes, it builds the binary again (about 4
   minutes on GitHub). A failed FFmpeg build does not stop the release: the APK then runs
   ffmpeg.wasm, and the run shows a warning.
2. It runs `npm run sync`, then `gradlew testReleaseUnitTest assembleRelease`
   with the release key, and names the APK `Analyser-android.apk`.

The key comes from the repository secrets `ANDROID_KEYSTORE_BASE64`,
`ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_ALIAS`, plus
`ANDROID_KEY_PASSWORD` when the key has a password of its own. **Once a release
is out, keep that key forever.** Android refuses an update signed with another
key, so a new key strands every installed copy.
`build.gradle` signs with it only when `ANR_KEYSTORE` names the file, so a local
build does not change.

`AnrUpdate.java` is the updater. It runs only when `BuildConfig.UPDATE_FEED`
holds a URL, and only the workflow sets one (`-PanrUpdateFeed`): the GitHub API
address of the latest release. The release holds no update file. At start-up,
at most once every six hours, the updater reads that API answer. A newer tag
than the installed `versionName` asks the user first. **Update** downloads the
asset named `Analyser-android.apk` into the cache, with a progress bar. Then
the updater checks it against the SHA-256 digest that GitHub gives for the
asset, checks the package name and that the `versionCode` is higher, and opens
the system installer through the FileProvider. That step needs
`REQUEST_INSTALL_PACKAGES`. Android checks the signature itself.
`AnrUpdateTest` covers the version comparison.

A Google Play build must not pass the feed, and must drop
`REQUEST_INSTALL_PACKAGES` from the manifest: Play forbids an app that updates
itself.

## Versioning

`tools/stamp-version.mjs` applies the formula from `analyserVersion()`, as
`desktop/tools/stamp-version.mjs` does. `versionName` is the label in the
footer, for example `9.0`. `versionCode` is `COMMIT_COUNT`, which only ever
grows, and Android needs exactly that for an update.

## Not done yet

- **Testing on a phone.** Everything here compiles and the checks pass their
  tests, but no one ran the build on a device yet. The checklist is in
  `research/CAPACITOR-PLAN.md`.
- **The FFmpeg binary.** The build script and the workflows exist, but no one
  built or measured a binary yet. The first question is whether
  `h264_mediacodec` works from a standalone executable on real chipsets.
- A foreground service for long transcodes, a folder picker, bundled OCCT and
  ONNX Runtime, a store listing, and iOS.
