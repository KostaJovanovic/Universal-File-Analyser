@echo off
rem ---------------------------------------------------------------------------
rem Analyser desktop - double-click to run the Electron app.
rem
rem The counterpart to server.bat: that one serves the website at :3000, this one
rem opens the same web/ tree in the desktop shell. Drag a file onto this .bat and
rem the app opens straight into it.
rem
rem Four things happen before the window appears, and each exists for a reason:
rem   1. desktop/ has its OWN package.json, and its dependencies are gitignored,
rem      so a fresh clone has to install them once.
rem   2. web/assets/js/ is BUILD OUTPUT. An edit in src/ does nothing until tsc
rem      recompiles, so this builds once first - otherwise the window opens on
rem      the last build.
rem   3. Then it leaves two tsc --watch processes running INSIDE this console -
rem      no extra windows - so the edit loop is save-and-Ctrl+R rather than
rem      close-and-relaunch. They are stopped when the app quits. HTML and CSS
rem      are live already: the analyser:// handler reads web/ off disk.
rem   4. ELECTRON_RUN_AS_NODE turns electron.exe into a plain Node runtime, and
rem      then main.mjs dies on `import from 'electron'` with a confusing module
rem      error instead of opening a window. Some tooling sets it; clear it.
rem ---------------------------------------------------------------------------
title analyser desktop
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="

if not exist "desktop\node_modules\electron\" (
  echo.
  echo   First run - installing the desktop dependencies. This takes a minute.
  echo.
  pushd desktop
  call npm install
  popd
  if not exist "desktop\node_modules\electron\" (
    echo.
    echo   npm install failed. Fix that first, then run this again.
    pause
    exit /b 1
  )
)

echo.
echo   Building src/ ...
call npm run build
rem Deliberately NOT aborting on a non-zero exit. tsc reports TYPE errors with a
rem failing status but still emits, and this repo's rule is that type errors are
rem loud rather than blocking - only save.bat refuses to commit on a syntax
rem error. So print the warning and open the window anyway.
if errorlevel 1 (
  echo.
  echo   *** tsc reported errors above. Starting anyway - read them. ***
)

rem ---------------------------------------------------------------------------
rem TypeScript watchers, for the same reason server.bat runs them: the app reads
rem web/assets/js/, which is BUILD OUTPUT, so a saved .ts changes nothing until
rem tsc emits. With these the loop is save-then-Ctrl+R, not close-and-relaunch.
rem
rem HTML and CSS need no watcher at all - the analyser:// handler reads web/
rem straight off disk and sw.js is a pass-through on localhost, so Ctrl+R alone
rem picks those up.
rem
rem `start /b`, NOT `start`: no extra console windows. Both watchers run inside
rem this one, so their compile errors land here and they go away with it. Two of
rem them because lib.dom and lib.webworker cannot share one program - the three
rem module workers compile under tsconfig.worker.json.
rem
rem If server.bat already has a watcher pair up, reuse it and leave it alone on
rem the way out, or the two scripts end up with two pairs writing the same files.
rem ---------------------------------------------------------------------------
rem Written with .Where() rather than a Where-Object pipe on purpose: a bare `|`
rem would need escaping as ^| inside the for /f below but NOT inside the plain
rem powershell call further down, so one definition could not serve both. No
rem pipe, no escaping problem.
set "TSC_FIND=@(Get-CimInstance Win32_Process).Where({ $_.Name -eq 'node.exe' -and $_.CommandLine -like '*tsc*' -and $_.CommandLine -like '*--watch*' })"
set "TSC_MINE="
set "TSC_COUNT=0"
for /f %%c in ('powershell -NoProfile -Command "%TSC_FIND%.Count" 2^>nul') do set "TSC_COUNT=%%c"

if "%TSC_COUNT%"=="0" (
  echo.
  echo   Watching src/ for changes ^(edit src/, not web/assets/js/^)...
  start /b "" cmd /c npx tsc -p tsconfig.json --watch --preserveWatchOutput
  start /b "" cmd /c npx tsc -p tsconfig.worker.json --watch --preserveWatchOutput
  set "TSC_MINE=1"
) else (
  echo.
  echo   TypeScript watchers already running - reusing them.
)

echo.
echo   Starting Analyser. Save a file, then press Ctrl+R in the app.
echo.
rem The binary directly rather than `npm start`, so a file path dragged onto this
rem .bat reaches the app. main.mjs skips the first two argv entries in dev (the
rem electron binary and the app directory), and everything after them is a path
rem to open.
rem
rem `call` is load-bearing: electron.cmd is itself a batch file, and a batch file
rem invoked WITHOUT call transfers control instead of returning, which makes
rem every line below here dead.
call desktop\node_modules\.bin\electron.cmd desktop %*
set "ANR_EXIT=%errorlevel%"

rem Close the window and the watchers go too - but only the ones this script
rem started. A pair belonging to a running server.bat is left alone. `start /b`
rem hands back no PID, so they are found the same way they were counted. Written
rem as a single-line `if` rather than a block: the PowerShell brackets inside a
rem parenthesised block confuse cmd's parser.
if defined TSC_MINE powershell -NoProfile -Command "%TSC_FIND%.ForEach({ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue })" 1>nul 2>nul

rem Only stop on a real failure. A clean quit should leave no console behind.
if not "%ANR_EXIT%"=="0" (
  echo.
  echo   Analyser exited with an error.
  pause
)
