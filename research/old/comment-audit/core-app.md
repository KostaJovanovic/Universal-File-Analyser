# core/app.js comment audit

- **Lines 8-14** — `Each commit listed in RELEASE_COMMITS bumps the major version ... commit 29 reads "1.0" (and 30 -> "1.01"), commit 60 reads "2.0" (and 61 -> "2.01"). To crown a future 3.0, append its commit number here ...` → Stale example. The constant directly below is `RELEASE_COMMITS = [29, 60, 100]`, so 3.0 has **already** been crowned (commit 100), and with `COMMIT_COUNT = 132` the live version is in the 3.x era (the `PATCH_DIGEST` block confirms a `3.0` milestone and `3.26 - 3.29` group). The comment still presents 3.0 as a "future" release to be added and only walks through 29/60, never mentioning 100, so it describes a list state that no longer exists. → **Fix:** "... commit 29 reads "1.0", commit 60 reads "2.0", and commit 100 reads "3.0" (with 101 -> "3.01"). To crown a future 4.0, append its commit number here (keep the list sorted ascending, and mirror the RELEASES constant in save.bat)."

Notes on items checked and found correct (not flagged):
- `exifr (74 KB)` (line 931): the file `assets/vendor/exifr.umd.js` is 75,848 bytes (~74 KB). Accurate.
- DICOM `DICM` at offset 128 (line 266), TAR `ustar` at offset 257 (line 267), PSD `8BPS`/`38 42 50 53` (line 234), MP3 frame-sync `0xFF` + `(b[1] & 0xE0) === 0xE0` (line 251), and the other magic-byte sniffs all match their code.
- OCCT CDN version note (lines 2089-2091): URLs pin `occt-import-js@0.0.23` and `occt-loader.js` defines `OCCT_VERSION = '0.0.23'` — in sync.
- Konami sequence comment (line 1744) matches the `KONAMI` array.
- The `keepPhoto = ext === 'exe' || ext === 'dll'` / PE-icon comments (lines 1281, 1359-1361) are consistent.
- The module header (lines 1-5) is a high-level summary that is incomplete (the file now classifies into ~70 kinds) but not factually wrong about what it lists; not flagged per the "incompleteness is not an error" rule.
