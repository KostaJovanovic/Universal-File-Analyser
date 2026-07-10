@echo off
REM ---------------------------------------------------------------------------
REM  native/dev-build.bat - fast FAITHFUL native rebuild for troubleshooting.
REM
REM  Runs the TRUE native shell (tauri:// origin, vendored WASM, production CSP)
REM  - the parts `npm run dev` cannot reproduce (it serves the web build from
REM  serve.py). This refreshes dist/ (vendored WASM reused from .native-cache),
REM  does an incremental DEBUG build, and launches the exe with devtools (F12).
REM  ~15-25s, vs minutes for a full `tauri build` installer.
REM
REM  For UI / IPC / drag-drop / updater logic, prefer `npm run dev` (hot reload);
REM  reach for this when you specifically need vendored-WASM or CSP fidelity.
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
