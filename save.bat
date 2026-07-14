@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

set FORCE_MODE=0
set COMMIT_ONLY=0
set ACTION=%~1

if /i "%ACTION%"=="--force"   (set FORCE_MODE=1 & set ACTION=save)
if /i "%ACTION%"=="commit"    (set COMMIT_ONLY=1 & set ACTION=save)
if /i "%ACTION%"=="--commit"  (set COMMIT_ONLY=1 & set ACTION=save)
if /i "%ACTION%"=="--no-push" (set COMMIT_ONLY=1 & set ACTION=save)
if /i "%ACTION%"=="save"   goto save
if /i "%ACTION%"=="commit" goto save
if /i "%ACTION%"=="push"    goto push
if /i "%ACTION%"=="pull"    goto pull
if /i "%ACTION%"=="backup"  goto backup
if /i "%ACTION%"=="samples" goto samples

:menu
echo.
echo === git ===
echo.
echo   1  save     add + commit + push
echo   2  commit   add + commit, no push
echo   3  push     push current branch
echo   4  pull     pull current branch
echo   5  backup   download stats to local csv
echo   6  samples  rebuild /samples from samples\
echo   7  quit
echo.
set /p CHOICE=select [1-7]:
if "%CHOICE%"=="1" goto save
if "%CHOICE%"=="2" (set COMMIT_ONLY=1 & goto save)
if "%CHOICE%"=="3" goto push
if "%CHOICE%"=="4" goto pull
if "%CHOICE%"=="5" goto backup
if "%CHOICE%"=="6" goto samples
if "%CHOICE%"=="7" exit /b 0
echo [err]  invalid choice
goto menu


:save
echo.
echo === git: save ===
echo.

set SAVE_ERROR=0

for /f %%i in ('git rev-list --count HEAD 2^>nul') do set COMMIT_COUNT=%%i
if not defined COMMIT_COUNT set COMMIT_COUNT=0
set /a NEXT_COUNT=%COMMIT_COUNT%+1

rem Version label mirrors analyserVersion() in app.js. RELEASES is the list of
rem commits crowned as major releases - keep it in sync with RELEASE_COMMITS in
rem app.js (sorted ascending). Each release reads X.0 and resets the minor counter:
rem commit 29 = 1.0, commit 60 = 2.0, etc.
set RELEASES=29,60,100,151,173,195
for /f %%v in ('powershell -NoProfile -Command "$n=%NEXT_COUNT%; $major=0; $base=0; foreach($r in @(%RELEASES%)){ if($n -ge $r){ $major++; $base=$r } else { break } }; if($major -eq 0){ '0.{0:D2}' -f $n } elseif(($n-$base) -eq 0){ '{0}.0' -f $major } else { '{0}.{1:D2}' -f $major,($n-$base) }"') do set VERLABEL=%%v
echo bump: v%VERLABEL% (commit %NEXT_COUNT%)

rem -Encoding UTF8 on BOTH ends is required: without it, Get-Content defaults to
rem the ANSI code page and reads this UTF-8 file as Windows-1252, mangling every
rem non-ASCII char (e.g. the ellipsis in "Reading file..." became "...â€¦...") a
rem little more on every commit. Read and write UTF-8 explicitly so it round-trips.
rem \d* (not \d+) so a previously-blanked "const COMMIT_COUNT = ;" still matches
rem and self-heals - with \d+ a blank value can never be repaired by this script.
powershell -Command "(Get-Content 'web/assets/js/core/app.js' -Encoding UTF8) -replace 'const COMMIT_COUNT = \d*;', 'const COMMIT_COUNT = %NEXT_COUNT%;' | Set-Content 'web/assets/js/core/app.js' -Encoding utf8"

rem Bump the service-worker cache epoch too, so every commit ships fresh JS/CSS
rem instead of leaving cached clients on a stale shell (stale-while-revalidate
rem otherwise keeps serving the old code until VERSION changes).
powershell -Command "(Get-Content 'web/sw.js' -Encoding UTF8) -replace 'const VERSION = ''analyser-v\d+'';', 'const VERSION = ''analyser-v%NEXT_COUNT%'';' | Set-Content 'web/sw.js' -Encoding utf8"

rem Rebuild the /samples gallery from the files in the samples/ directory, so the
rem clickable example cards always match the folder. Run first, before every other
rem generator/stamping step. Non-fatal.
echo [gen]  samples.html
node --no-warnings tools/prerender-samples.mjs
if errorlevel 1 echo [warn] samples gallery gen failed - keeping existing copy

rem Prerender the static /formats page from the catalog (single source of truth
rem in assets/js/core/formats.js), so the supported-formats list and its #fmt- /
rem #ext- deep-link anchors exist in plain HTML for crawlers. Non-fatal: a missing
rem Node or a generator error just commits the existing formats.html.
echo [gen]  formats.html
node --no-warnings tools/prerender-formats.mjs
if errorlevel 1 echo [warn] formats.html gen failed - keeping existing copy

rem Prerender the per-extension /format/<ext> landing pages (only for formats with
rem a real viewer/deep analysis - depth 'full' in the catalog) plus sitemap-formats.xml.
echo [gen]  formats/^<ext^> pages
node --no-warnings tools/prerender-format-pages.mjs
if errorlevel 1 echo [warn] per-format page gen failed - keeping existing copies

rem Stamp the live format count into the static crawler-only copy (meta/OG/JSON-LD
rem descriptions, manifest, feature text) and refresh the main sitemap lastmod, so
rem the hand-maintained numbers can't drift from the catalog. Non-fatal.
echo [gen]  format count + sitemap
node --no-warnings tools/stamp-counts.mjs
if errorlevel 1 echo [warn] count/sitemap stamp failed - keeping existing copies

rem Stamp the shared footer block (the "Everything runs in your browser" heading +
rem the whole Download-for-offline-use section) into every main page from
rem tools/partials/footer-shared.html, so the footer can't drift across pages. Each
rem page's own .footer-bottom row (return button + page links) is left alone. Non-fatal.
echo [gen]  footer partial
node --no-warnings tools/stamp-footer.mjs
if errorlevel 1 echo [warn] footer stamp failed - keeping existing copies

rem Stamp the shared <head> tail (stylesheet links + the before-first-paint theme
rem script) into every main page from the single THEME_SCRIPT in prerender-common,
rem so the UX-sensitive theme snippet can't drift across pages. Non-fatal.
echo [gen]  head partial
node --no-warnings tools/stamp-head.mjs
if errorlevel 1 echo [warn] head stamp failed - keeping existing copies

rem Regenerate the token/animation sections of /test (the hidden UI style-guide
rem sheet) straight from analyser.css, so it can't drift from the stylesheet. The
rem component demos in test.html are hand-authored and untouched. Non-fatal.
echo [gen]  test.html tokens
node --no-warnings tools/prerender-testpage.mjs
if errorlevel 1 echo [warn] test page gen failed - keeping existing copy

rem Rebuild the browsable /docs site (web/docs.html hub + web/docs/<slug> pages)
rem from the Markdown in docs/, so the HTML docs can't drift from the source docs.
rem Wipes and rewrites web/docs.html + web/docs/ each run. Non-fatal.
echo [gen]  docs site
node --no-warnings tools/build-docs-html.mjs
if errorlevel 1 echo [warn] docs site gen failed - keeping existing copies

rem Optional read-only stats snapshot to stats-backup\ (gitignored, kept local).
rem Pulls from the live /api/stats; non-fatal and skipped by default. The full
rem Save (option 1 / `save` / --force) skips it entirely; only the commit-only
rem path still offers it. Use menu option 5 (Backup) to snapshot on demand.
rem NB: a goto skip (not an if(...) block) - the "(y/n)" prompt text contains a
rem ")" that would prematurely close a parenthesised block and break parsing.
if not "%COMMIT_ONLY%"=="1" goto skipbackup
echo.
set /p DOBACKUP=download live stats to csv first? (y/n):
if /i "%DOBACKUP%"=="y" call :runbackup
:skipbackup

echo [git]  stage
git add .
git status

echo.
set /p MSG=commit message [update]:
if "%MSG%"=="" set MSG=update

git commit -m "%MSG%"
if errorlevel 1 (
  echo.
  echo [err]  git commit failed
  set SAVE_ERROR=1
  goto end
)

if "%COMMIT_ONLY%"=="1" goto committed
if "%FORCE_MODE%"=="1" goto forcepush

echo.
set /p DOPUSH=push to origin/main? (y/n):
if /i not "%DOPUSH%"=="y" goto skipped

git push origin main
if not errorlevel 1 goto pushed

echo.
echo [warn] push rejected - remote is ahead of local
echo.
set /p FETCH=pull + merge remote first? (y/n):
if /i "%FETCH%"=="y" goto fetch

set /p FORCE=force push instead? overwrites the remote. (y/n):
if /i "%FORCE%"=="y" goto forcepush

echo [git]  skipped - nothing pushed
set SAVE_ERROR=1
goto end

:fetch
git pull origin main
if errorlevel 1 set SAVE_ERROR=1
echo.
echo [git]  pulled - resolve any conflicts, then re-run
goto end

:forcepush
git push origin main --force
if errorlevel 1 set SAVE_ERROR=1
echo.
echo [git]  force pushed origin/main
goto end

:pushed
echo.
echo [git]  pushed origin/main
goto end

:skipped
echo.
echo [git]  push skipped
goto end


:committed
echo.
echo [git]  committed v%VERLABEL% (local, not pushed)
goto end


:push
echo.
echo === git: push ===
echo.
set SAVE_ERROR=0
git push origin main
if errorlevel 1 (
  echo.
  set /p FORCE=push failed. force push? overwrites the remote. (y/n):
  if /i "!FORCE!"=="y" (
    git push origin main --force
    if errorlevel 1 set SAVE_ERROR=1
  ) else (
    set SAVE_ERROR=1
  )
)
goto end


:pull
echo.
echo === git: pull ===
echo.
set SAVE_ERROR=0
git pull origin main
if errorlevel 1 set SAVE_ERROR=1
goto end


:backup
echo.
echo === stats: backup ===
echo.
set SAVE_ERROR=0
call :runbackup
goto end


rem Rebuild only the /samples gallery from the samples\ folder, without a version bump
rem or commit. Use this after adding/removing files in samples\ to refresh samples.html;
rem the next real Save re-runs it anyway, so changes here are just previewed locally.
:samples
echo.
echo === gen: samples ===
echo.
set SAVE_ERROR=0
echo [gen]  samples.html (from samples\)
node --no-warnings tools/prerender-samples.mjs
if errorlevel 1 (
  echo.
  echo [err]  samples gallery rebuild failed
  set SAVE_ERROR=1
) else (
  echo [ok]   review samples.html, then commit with a normal save
)
goto end

rem Read-only snapshot of the live counters to stats-backup\*.csv. Non-fatal:
rem a warning (offline / API down) never blocks a commit when called from :save.
:runbackup
echo [net]  download live stats -^> stats-backup\
node --no-warnings tools/backup-stats.mjs
if errorlevel 1 echo [warn] stats backup failed - is the network up?
exit /b 0


:end
echo.
pause
exit /b %SAVE_ERROR%
