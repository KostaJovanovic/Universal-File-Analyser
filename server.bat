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

start "" "http://localhost:%PORT%"
rem serve.py mirrors the production Cloudflare routing (clean URLs + .html
rem redirects + SPA fallback), so local dev matches lab.valjdakosta.com exactly.
rem It prints a scannable QR for the Network URL at startup (LOCAL_IP passed in).
python serve.py %PORT% %LOCAL_IP%
pause
