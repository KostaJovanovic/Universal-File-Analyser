@echo off
REM ---------------------------------------------------------------------------
REM  native/dev-refresh.bat - INSTANT frontend refresh for the running app.
REM
REM  The native exe serves dist/ live from disk - it does NOT bake the frontend
REM  into the binary - so JS/HTML/CSS edits need NO rebuild. This re-syncs your
REM  source into dist/ (~2s); then just press Ctrl+R in the app window to see the
REM  change, in the TRUE native shell (tauri:// origin, vendored WASM, real CSP).
REM
REM  Keep the app running and re-run this whenever you edit frontend files.
REM  Use dev-build.bat instead ONLY when you changed Rust (src-tauri) or
REM  tauri.conf.json - those are the only changes that need a cargo build.
REM ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"
call node build-dist.mjs || (echo build-dist failed & exit /b 1)
echo.
echo Refreshed. Now press Ctrl+R in the app window to reload.
exit /b 0
