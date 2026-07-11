@echo off
REM ---------------------------------------------------------------------------
REM  native-build.bat - desktop RELEASE build (NSIS + MSI installers).
REM
REM  Lives in the repo root but runs inside native/ (cd below). This is the
REM  release counterpart to native-dev.bat: it assembles dist/ (vendored WASM)
REM  and runs `npm run build` (tauri build) to produce the signed installers.
REM
REM  Build output lands in the root build\ folder (build\desktop), not the
REM  default src-tauri\target - so `del build` reclaims every local build at
REM  once. This CARGO_TARGET_DIR override is local-only; CI keeps the default.
REM
REM  Output: build\desktop\release\bundle\{nsis,msi}\
REM ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0native"
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
set "CARGO_TARGET_DIR=%~dp0build\desktop"

echo [1/2] Assembling dist (vendored WASM from cache)...
call node build-dist.mjs || goto :err

echo [2/2] Building release installers...
call npm run build || goto :err

echo.
echo Done. Installers under build\desktop\release\bundle\
exit /b 0

:err
echo.
echo ** Build failed - see the errors above. **
exit /b 1
