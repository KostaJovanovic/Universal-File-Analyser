# Contributing to Analyser

Thanks for taking an interest. Analyser is a one-person project, but bug
reports, format samples and well-scoped pull requests are welcome.

Before you start, a couple of things worth knowing so your time is not wasted.

## The licence gate

This project is under the [GNU General Public License v3.0](../LICENSE).
By opening a pull request you agree that your contribution is licensed to the
project under the same terms and can be redistributed under it. If you are not
comfortable with that, please do not submit code.

## What the project is

Analyser is a **zero-backend, browser-only** forensic workbench. A file is
dropped in and classified, parsed and visualised entirely on the visitor's
device. Nothing is ever uploaded. Two rules fall out of that and are
non-negotiable:

- **No network calls that touch a file's bytes or name.** The only permitted
  outbound request is the anonymous counter (a bare lowercase extension string),
  which is already built. Everything else stays on-device.
- **No backend.** The site is static assets on Cloudflare. There is one small
  Cloudflare Worker for the anonymous visit/analysed counters and nothing else.

## How the codebase works

It is vanilla HTML, CSS and ES-module JavaScript. **No framework, no build step,
no `node_modules`, no tests.** Editing a file and refreshing the page is the
entire dev loop.

- Run it locally with `server.bat` (launches `serve.py` on port 3000 and mirrors
  the production clean-URL routing). Do not use a plain static server - it will
  404 the clean URLs like `/about`.
- `web/` is the whole website. `web/assets/js/core/formats.js` is the single
  source of truth for supported file types; `web/assets/js/renderers/` has one
  module per top-level type; `web/assets/js/parsers/` holds the lazy per-domain
  metadata parsers.
- Heavy work (FFmpeg, ImageMagick, pdf.js, etc.) is WebAssembly, lazy-loaded
  only when a file actually needs it. Keep it that way - the initial page stays
  small.

## Style conventions (please read before touching UI)

Visual polish is treated as a first-class requirement, not an afterthought.

- **No rounded corners, anywhere.** The site is deliberately sharp-cornered. No
  pills, no rounded chips, no `border-radius` on new elements.
- Reuse existing idioms and theme variables (`var(--bg)`, `var(--fg)`,
  `var(--muted)`, `var(--font-mono)`) rather than hardcoding values. Find the
  closest existing component in `web/assets/css/analyser.css` and match it.
- Check every new element in **both light and dark themes** and at narrow
  widths before calling it done.
- **User-facing text is em-dash-free and uses British spelling** (colour,
  analyse, visualise). Use a spaced hyphen " - " as the separator, never an
  em-dash.

## Pull requests

- Keep them focused - one change per PR is far easier to review than a grab-bag.
- Describe what you changed and how you tested it (which browsers, light and
  dark themes).
- Do not bump the version or edit the changelog - versioning and patch notes are
  handled by the maintainer at commit time.
- New third-party dependencies are a hard sell. If a feature needs one, it must
  be vendored locally (the app must keep working fully offline) and the
  licensing must be compatible.

## Adding or fixing a file format

The most useful contributions are usually format support. If you have a sample
of a format that is misidentified or unsupported, an issue with that sample
attached is genuinely helpful even without a code change. If you want to add
support yourself, the format catalog lives in `web/assets/js/core/formats.js`
and the magic-byte identification in `web/assets/js/renderers/proprietary.js`.

## Reporting security issues

Please do **not** open a public issue for a security vulnerability. See
[SECURITY.md](SECURITY.md) for how to report privately.
