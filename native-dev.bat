@echo off
REM ---------------------------------------------------------------------------
REM  native-dev.bat - rebuild the native binary. Needed ONLY when you
REM  changed Rust (src-tauri) or tauri.conf.json.
REM
REM  Lives in the repo root but runs inside native/ (cd below). The exe serves
REM  dist/ live from disk, so frontend (JS/HTML/CSS) edits do NOT need this - use
REM  native-refresh.bat + Ctrl+R for those (~2s, no rebuild). Reach for this
REM  script only when the compiled binary itself must change: it kills the
REM  running app (Windows locks the exe), refreshes dist/, does a DEBUG cargo
REM  build (~13s when Rust changed, ~1s otherwise), and relaunches with
REM  devtools (F12).
REM
REM  Build output lands in the root build\ folder (build\desktop), not the
REM  default src-tauri\target - so `del build` reclaims every local build at
REM  once. This CARGO_TARGET_DIR override is local-only; CI keeps the default.
REM ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0native"
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
set "CARGO_TARGET_DIR=%~dp0build\desktop"

echo [1/4] Closing any running app (Windows locks the exe during build)...
taskkill /IM analyser.exe /F >nul 2>&1

echo [2/4] Assembling dist (vendored WASM from cache)...
call node build-dist.mjs || goto :err

echo [3/4] Building debug exe (incremental)...
cargo build --manifest-path src-tauri/Cargo.toml || goto :err

echo [4/4] Launching (press F12 for devtools)...
start "" "%~dp0build\desktop\debug\analyser.exe"
echo Done.
exit /b 0

:err
echo.
echo ** Build failed - see the errors above. **
exit /b 1
