# Repository Guidelines

## Project Structure & Module Organization

The deployable static site is entirely under `web/`. The main analyser is
`web/index.html`. Application code is **TypeScript in `src/`**, compiled 1:1 by
`tsc` into `web/assets/js/` - that output is generated, so never edit or add a
module there. `src/` keeps the same tree shape:

- `core/` contains bootstrapping, routing, classification, shared utilities, and the format catalog (`formats.js`).
- `renderers/` contains one ES-module per analysed file domain.
- `parsers/` contains lazy metadata-parser chunks, and `lib/` contains shared binary and WASM loaders.
- `web/assets/css/analyser.css` is the central stylesheet; `web/assets/vendor/` is third-party code (kept out of the working tree by sparse-checkout, and nothing imports it as a module, so builds do not need it).

Root-level `tools/*.mjs` regenerate SEO and shared-page content. `worker/` is the small Cloudflare stats Worker. Project documentation is in `docs/`. `desktop/` is the Electron desktop shell - its own `package.json`, its own dependencies, and it wraps the same `web/` tree rather than forking it. `mobile/` is the Android shell (Capacitor 8), built the same way: its own `package.json`, a staged copy of `web/`, and a tracked `android/` Gradle project.

## Build, Test, and Development Commands

There is a TypeScript build, but no lint or automated test suite. `package.json`
has a single devDependency (`typescript`) and **must keep `"type": "module"`**,
or the `tools/*.mjs` generators that import the emitted `core/formats.js` break.

- `npx tsc -p tsconfig.json && npx tsc -p tsconfig.worker.json` - build once.
  Both configs are needed: the three module workers compile separately because
  `lib.dom` and `lib.webworker` cannot share a program.
- `node tools/check-build.mjs` - a build gate. It fails when output is missing or
  stale relative to `src/`.
- The tree compiles **clean** under both configs, so `tsc` exiting non-zero means
  something is actually wrong - fix it. `strict` is **on** (`strictNullChecks` +
  `noImplicitAny` included). Fix a strict error with an annotation, an `as` cast,
  a `!` assertion or a new `interface` - **never** a runtime guard: type syntax
  erases, so the emitted JS must stay byte-identical, and that is the only
  regression net this repo has. Never place a `type`/`interface` between a doc
  comment and the declaration it documents - the comment is deleted from the
  emit. See `CLAUDE.md` for the full rule and the `inferFromUsage` caveat.

- `server.bat` - start the development server at `http://localhost:3000` plus two `tsc --watch` windows; use it instead of `python -m http.server` because `serve.py` mirrors production clean-URL and SPA routing. Without a watcher running, edits to `src/` have no effect on the served site.
- `node tools/prerender-formats.mjs` - regenerate the static formats hub when working on its generator inputs.
- `save.bat` - interactive commit/version-bump workflow. `save.bat commit` commits without pushing.
- `desktop.bat` - run the Electron desktop shell against `../web`. It installs `desktop/`'s dependencies on the first run, builds `src/`, then opens the window. It also leaves two `tsc --watch` processes in its own console (`start /b`, so no extra windows), so the edit loop is save plus Ctrl+R in the app. Pass it a file path to open that file. The bare `cd desktop && npm start` skips the install, the build and the watchers. `npm run dist` builds the Windows installer into `desktop/dist/` (gitignored, as is `desktop/node_modules/`). That one `.exe` installs Analyser or unpacks a portable copy (`desktop/build/installer.nsh`). Releases for every system come from the manual `.github/workflows/release.yml`, which publishes one GitHub release with one file per system and no update files. `desktop/updater.mjs` and `AnrUpdate.java` find the new file through the GitHub API by its name, so keep the artifact names in `electron-builder.yml` free of versions. Desktop-only code paths in `src/` sit behind `window.anrDesktop`, which does not exist in a browser, so the website stays unaffected. See `desktop/README.md` and `docs/desktop.md`. Every native ffmpeg job passes the safety checks in `desktop/ffmpeg-accel.mjs` first. `node desktop/tools/check-ffmpeg-args.mjs` runs them against every argument list in `src/`, so add the shape of a new ffmpeg call there.
- `mobile.bat` - build and install the Android app on a USB-connected phone (build `src/`, stage `web/` into `mobile/www/`, `cap sync`, Gradle with JDK 21, `adb install`). The Android bridge publishes the same `window.anrDesktop` contract, with `shell: 'capacitor'` and `memoryGB: 0`, so the same guards apply there. The native half is Java under `mobile/android/app/src/main/java/`, and `gradlew testDebugUnitTest` runs the Java port of the ffmpeg checks. See `mobile/README.md` and `docs/mobile.md`. A release build checks the same GitHub release for a newer APK (`AnrUpdate.java`), but only when Gradle gets `-PanrUpdateFeed`, and only the release workflow passes it.

Edit files, refresh locally, and manually check the affected feature. Test UI changes in light and dark themes and at narrow viewport widths.

## Coding Style & Naming Conventions

Use vanilla HTML, CSS, and TypeScript ES modules. Write relative import specifiers with a `.js` extension (`from '../core/util.js'`) even though the file is `.ts` - TypeScript resolves it and emits it verbatim, which is what keeps the service-worker offline manifest valid. Follow nearby code for indentation and naming: camelCase for values/functions, kebab-case for CSS classes and filenames. Keep format definitions centralised in `src/core/formats.ts`; add specialised parsing through lazy modules rather than inflating initial-load code.

Reuse existing CSS tokens and component classes. New UI must keep the intentionally sharp design: no rounded corners. User-facing copy uses British spelling and must use ` - ` rather than em dashes.

## Generated Content & Configuration

Do not manually edit generated `web/formats/` pages or marker-delimited generated sections. Update their source data and run the appropriate script. Do not hand-edit `COMMIT_COUNT` in `app.js` or the service-worker `VERSION`. `save.bat` maintains both. Keep `wrangler.jsonc` aligned with the static `web/` deployment layout.

The canonical host is `analyser.valjdakosta.com`; the older `lab.valjdakosta.com` 307-redirects to it (every non-`/api/*` request, in `worker/index.js`) and must not appear in any absolute URL (canonical tags, og/twitter images, JSON-LD, sitemaps, `robots.txt`, `llms.txt`, share/export links, the `SITE` constants in `tools/`).

## Commit & Pull Request Guidelines

Recent history commonly uses short `update` messages, while substantive commits use imperative summaries (for example, `Fix ...` or `AI vocal separation ...`). Prefer a concise, specific imperative subject. Do not commit, push, or edit public patch notes unless explicitly requested. For pull requests, explain the user-visible change, note regenerated files, link relevant issues, and include screenshots for UI changes.
