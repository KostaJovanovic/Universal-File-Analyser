@echo off
title analyser server
cd /d "%~dp0"

set PORT=3000

rem Kill whatever is still holding the port so every launch is a fresh instance
rem (a previous server.bat, or any other listener on %PORT%). Uses PowerShell so
rem it handles both IPv4 and IPv6 listeners without brittle netstat parsing.
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -ne 0 } | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }" 1>nul 2>nul

rem Find local IP for phone access
set LOCAL_IP=
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  if not defined LOCAL_IP (
    for /f "tokens=* delims= " %%b in ("%%a") do set "LOCAL_IP=%%b"
  )
)

echo.
echo ============================================
echo   Local:   http://localhost:%PORT%
echo   Network: http://%LOCAL_IP%:%PORT%
echo.
echo   Scan the QR below to open it on your phone.
echo   Phone must be on the same Wi-Fi.
echo ============================================
echo.

rem ---------------------------------------------------------------------------
rem TypeScript watchers. The site is served from web/assets/js/, which is BUILD
rem OUTPUT - editing src/*.ts does nothing until tsc recompiles. These two windows
rem keep the dev loop as close to the old "edit and reload" as possible: save a
rem .ts, the watcher emits within a second, refresh the browser.
rem
rem Two windows because lib.dom and lib.webworker cannot be loaded into one
rem program - the three module workers compile under tsconfig.worker.json.
rem Closing either window just stops that watcher; serve.py keeps running.
echo   Starting TypeScript watchers (edit src/, not web/assets/js/)...
start "analyser tsc (app)"    cmd /k npx tsc -p tsconfig.json --watch --preserveWatchOutput
start "analyser tsc (worker)" cmd /k npx tsc -p tsconfig.worker.json --watch --preserveWatchOutput

start "" "http://localhost:%PORT%"
rem serve.py mirrors the production Cloudflare routing (clean URLs + .html
rem redirects + SPA fallback), so local dev matches analyser.valjdakosta.com exactly.
rem It prints a scannable QR for the Network URL at startup (LOCAL_IP passed in).
python serve.py %PORT% %LOCAL_IP%
pause
