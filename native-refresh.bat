@echo off
REM ---------------------------------------------------------------------------
REM  native-refresh.bat - INSTANT frontend refresh for the running app.
REM
REM  Lives in the repo root but runs inside native/ (cd below). The native exe
REM  serves dist/ live from disk - it does NOT bake the frontend into the binary
REM  - so JS/HTML/CSS edits need NO rebuild. This re-syncs your source into
REM  dist/ (~2s); then just press Ctrl+R in the app window to see the change, in
REM  the TRUE native shell (tauri:// origin, vendored WASM, real CSP).
REM
REM  Keep the app running and re-run this whenever you edit frontend files.
REM  Use native-dev.bat instead ONLY when you changed Rust (src-tauri) or
REM  tauri.conf.json - those are the only changes that need a cargo build.
REM ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0native"
call node build-dist.mjs || (echo build-dist failed & exit /b 1)
echo.
echo Refreshed. Now press Ctrl+R in the app window to reload.
exit /b 0
