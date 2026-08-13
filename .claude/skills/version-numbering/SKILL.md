---
name: version-numbering
description: How Analyser's version numbers are computed (COMMIT_COUNT, RELEASE_COMMITS, analyserVersion() in app.js) and how to crown a new major release. Use when discussing, computing, or bumping the site's version number.
---

Every commit is its own version. The number after the dot is the commit's
1-based position **within its major era**, zero-padded to two digits: `0.01`,
`0.02`, … `0.09`, `0.10`, `0.11`. Each commit listed in `RELEASE_COMMITS` (in
`app.js`) bumps the major version and resets the counter, so that commit shows as
`X.0` and the commit right after it is `X.01`.

- `COMMIT_COUNT` in `src/core/app.ts` is the current commit number, bumped
  automatically by `save.bat` on each commit. Don't change it manually.

  It is the **project's** counter and lives in the committed source on purpose.
  `save.bat` reads it from there and adds 1; it does *not* use
  `git rev-list --count HEAD`, which is a property of the individual clone and
  collapses when history is squashed or re-cloned shallow. (That once produced a
  count of 2 on a squashed history, dropping the public version from 8.14 to
  0.02.) If the value can't be read, `save.bat` aborts rather than guessing.
- `RELEASE_COMMITS` in `src/core/app.ts` is the sorted list of commit numbers
  crowned as major releases. It is currently
  `[29, 60, 100, 151, 173, 195, 250, 256]` (commit 29 = `1.0`, 60 = `2.0`,
  100 = `3.0`, 151 = `4.0`, 173 = `5.0`, 195 = `6.0`, 250 = `7.0`, 256 = `8.0`).
  To crown a future `9.0`, append that commit's number - and keep the `RELEASES`
  list in `save.bat` in sync, since it mirrors this array. The display logic
  lives in `analyserVersion()` in `src/core/app.ts`.
- `save.bat` mirrors this with a `RELEASES=29,60,100,151,173` constant (used only
  to echo the version it's bumping to). **Keep `RELEASES` in sync with
  `RELEASE_COMMITS`** — its PowerShell snippet walks the full list exactly like
  `analyserVersion()`, so crowning another release is just appending the commit
  number in both places.

History note: the scheme was reset on 3 June 2026 — every commit was re-derived
into this 0.NN / 1.0 / 1.NN sequence (commit 29, the "Checkpoint" mega-update with
Excel/EPUB/PPTX/STL viewers and full offline support, was chosen as `1.0`). The
patch notes in `about.html` (`id="when"`) were rewritten to one entry per commit.
