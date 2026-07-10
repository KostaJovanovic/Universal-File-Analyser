@echo off
REM ---------------------------------------------------------------------------
REM  native/dev-build.bat - rebuild the native binary. Needed ONLY when you
REM  changed Rust (src-tauri) or tauri.conf.json.
REM
REM  The exe serves dist/ live from disk, so frontend (JS/HTML/CSS) edits do NOT
REM  need this - use dev-refresh.bat + Ctrl+R for those (~2s, no rebuild). Reach
REM  for this script only when the compiled binary itself must change: it kills
REM  the running app (Windows locks the exe), refreshes dist/, does a DEBUG
REM  cargo build (~13s when Rust changed, ~1s otherwise), and relaunches with
REM  devtools (F12).
REM ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

echo [1/4] Closing any running app (Windows locks the exe during build)...
taskkill /IM analyser.exe /F >nul 2>&1

echo [2/4] Assembling dist (vendored WASM from cache)...
call node build-dist.mjs || goto :err

echo [3/4] Building debug exe (incremental)...
cargo build --manifest-path src-tauri/Cargo.toml || goto :err

echo [4/4] Launching (press F12 for devtools)...
start "" "src-tauri\target\debug\analyser.exe"
echo Done.
exit /b 0

:err
echo.
echo ** Build failed - see the errors above. **
exit /b 1
