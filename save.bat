@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

set FORCE_MODE=0
set COMMIT_ONLY=0
set RELEASE_MODE=0
set ACTION=%~1

rem Quoted `set "VAR=1"` on purpose: an unquoted `set VAR=1 & ...` stores "1 "
rem with the trailing space, and then `if "%VAR%"=="1"` never matches.
if /i "%ACTION%"=="--force"   (set "FORCE_MODE=1" & set "ACTION=save")
if /i "%ACTION%"=="commit"    (set "COMMIT_ONLY=1" & set "ACTION=save")
if /i "%ACTION%"=="--commit"  (set "COMMIT_ONLY=1" & set "ACTION=save")
if /i "%ACTION%"=="--no-push" (set "COMMIT_ONLY=1" & set "ACTION=save")
if /i "%ACTION%"=="release"   (set "RELEASE_MODE=1" & set "ACTION=save")
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
echo   1  release  add + commit + push, then build and publish the apps on GitHub
echo   2  save     add + commit + push
echo   3  commit   add + commit, no push
echo   4  push     push current branch
echo   5  pull     pull current branch
echo   6  backup   download stats to local csv
echo   7  samples  rebuild /samples from samples\
echo   8  quit
echo.
set /p CHOICE=select [1-8]:
if "%CHOICE%"=="1" (set "RELEASE_MODE=1" & goto save)
if "%CHOICE%"=="2" goto save
if "%CHOICE%"=="3" (set "COMMIT_ONLY=1" & goto save)
if "%CHOICE%"=="4" goto push
if "%CHOICE%"=="5" goto pull
if "%CHOICE%"=="6" goto backup
if "%CHOICE%"=="7" goto samples
if "%CHOICE%"=="8" exit /b 0
echo [err]  invalid choice
goto menu


:save
echo.
echo === git: save ===
echo.

set SAVE_ERROR=0
set BUMPED=0

rem Which branch this commit lands on. Every push below targets THIS branch
rem (origin/<branch>), never a hard-coded main: pushing `main` from a feature
rem branch used to report "pushed origin/main" while the new commit stayed local,
rem and --force would overwrite the remote main with a stale local copy.
rem A release builds from main (the workflow runs with --ref main), so it is
rem refused on any other branch BEFORE anything is bumped or committed.
call :getbranch
if "%BRANCH%"=="" goto nobranch
if "%BRANCH%"=="HEAD" goto nobranch
if "%RELEASE_MODE%"=="1" if /i not "%BRANCH%"=="main" goto releasebranch
echo [git]  branch: %BRANCH%
if /i not "%BRANCH%"=="main" echo [warn] not on main - this commits and pushes to origin/%BRANCH%, which does not deploy

rem The commit count is the PROJECT's counter, not a property of this clone.
rem It used to come from `git rev-list --count HEAD`, which is per-device: it
rem collapses whenever history is squashed, re-initialised, or cloned shallow.
rem That is exactly what happened - rev-list returned 1, so the next count was
rem computed as 2 and the public version fell from 8.14 to 0.02.
rem
rem Read the committed value out of the source instead. It lives in
rem src/core/app.ts, which is in the repo, so it is identical on every machine
rem and only ever moves forward. If it cannot be read we ABORT rather than
rem guess - a wrong value here sends the public version number backwards.
for /f %%i in ('powershell -NoProfile -Command "$m=[regex]::Match((Get-Content 'src/core/app.ts' -Raw -Encoding UTF8),'const COMMIT_COUNT = (\d+);'); if($m.Success){$m.Groups[1].Value}"') do set COMMIT_COUNT=%%i
if not defined COMMIT_COUNT goto countfail
set /a NEXT_COUNT=%COMMIT_COUNT%+1
if %NEXT_COUNT% LEQ %COMMIT_COUNT% goto countfail

rem Version label mirrors analyserVersion() in app.js. RELEASES is the list of
rem commits crowned as major releases - keep it in sync with RELEASE_COMMITS in
rem app.js (sorted ascending). Each release reads X.0 and resets the minor counter:
rem commit 29 = 1.0, commit 60 = 2.0, etc.
set RELEASES=29,60,100,151,173,195,250,256,305
for /f %%v in ('powershell -NoProfile -Command "$n=%NEXT_COUNT%; $major=0; $base=0; foreach($r in @(%RELEASES%)){ if($n -ge $r){ $major++; $base=$r } else { break } }; if($major -eq 0){ '0.{0:D2}' -f $n } elseif(($n-$base) -eq 0){ '{0}.0' -f $major } else { '{0}.{1:D2}' -f $major,($n-$base) }"') do set VERLABEL=%%v
echo bump: v%VERLABEL% (commit %NEXT_COUNT%)

rem Both bumped files are read and written as UTF-8 through .NET directly:
rem   - Get-Content without -Encoding reads the ANSI code page and mangled every
rem     non-ASCII char (the ellipsis in "Reading file..." became "â€¦") a little
rem     more on every commit;
rem   - PowerShell 5's Set-Content -Encoding utf8 adds a BOM and rewrites every
rem     line ending as CRLF, against .gitattributes eol=lf.
rem ReadAllText/WriteAllText with UTF8Encoding($false) keeps the text byte-exact
rem apart from the one replaced number: no BOM, line endings as they were.
rem NB: COMMIT_COUNT now lives in the TypeScript SOURCE (src/core/app.ts);
rem web/assets/js/core/app.js is generated and is rewritten by the build below.
rem \d* (not \d+) so a previously-blanked "const COMMIT_COUNT = ;" is still
rem rewritten here. Reading the count above uses \d+ and aborts on a blank, so
rem a damaged value stops the commit rather than silently restarting from 1.
rem
rem The bump has to happen BEFORE the build (the emitted app.js carries the
rem count), so both files are backed up first and put back by :restorebump if
rem the build or the commit then fails - otherwise a failed save would burn a
rem version number and the next one would skip it.
copy /y "src\core\app.ts" "%TEMP%\anr-bump-app.ts" >nul
copy /y "web\sw.js" "%TEMP%\anr-bump-sw.js" >nul
set BUMPED=1
powershell -NoProfile -Command "$p=(Resolve-Path 'src/core/app.ts').Path; $t=[IO.File]::ReadAllText($p); $t=$t -replace 'const COMMIT_COUNT = \d*;', 'const COMMIT_COUNT = %NEXT_COUNT%;'; [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))"

rem Bump the service-worker cache epoch too, so every commit ships fresh JS/CSS
rem instead of leaving cached clients on a stale shell (stale-while-revalidate
rem otherwise keeps serving the old code until VERSION changes).
powershell -NoProfile -Command "$p=(Resolve-Path 'web/sw.js').Path; $t=[IO.File]::ReadAllText($p); $t=$t -replace 'const VERSION = ''analyser-v\d+'';', 'const VERSION = ''analyser-v%NEXT_COUNT%'';'; [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))"

rem ---------------------------------------------------------------------------
rem Compile src/*.ts -> web/assets/js/*.js BEFORE any generator runs. Four
rem generators (prerender-samples/formats/format-pages, stamp-counts) import the
rem emitted web/assets/js/core/formats.js into Node, so they must see fresh output.
rem
rem tsc exits non-zero for TYPE errors even though it still emits correct JS.
rem During the TS migration there are outstanding type errors by design, so the
rem exit code is not the gate - tools/check-build.mjs is. It verifies every
rem source has fresh output, which is the failure that actually ships bad code.
rem (Once the migration reaches full strict, make these two calls fatal too.)
rem TS1xxx vs TS2xxx matters here. TS2xxx are TYPE errors: tsc still emits
rem correct JS, so they are reported but do not block a commit. TS1xxx are
rem SYNTAX/grammar errors: the parse failed, so the emitted JS for that file may
rem be wrong or truncated - that must never ship.
echo [build] tsc src -^> web/assets/js
call npx tsc -p tsconfig.json > "%TEMP%\anr-tsc.log" 2>&1
call npx tsc -p tsconfig.worker.json > "%TEMP%\anr-tsc-w.log" 2>&1
copy /b "%TEMP%\anr-tsc.log"+"%TEMP%\anr-tsc-w.log" "%TEMP%\anr-tsc-all.log" >nul 2>&1

rem Syntax errors first - the parse failed, so the emitted JS may be wrong.
findstr /R /C:"error TS1[0-9][0-9][0-9]:" "%TEMP%\anr-tsc-all.log" >nul
if not errorlevel 1 goto syntaxfail

rem The tree compiles clean, so a type error now means something actually broke
rem rather than migration backlog. It still does not abort the commit - tsc
rem emitted correct JS either way, and stopping a commit over a type error is
rem more disruptive than the error is - but the count is printed loudly enough
rem to notice. If it is ever non-zero, fix it before it accumulates again.
rem NB: goto rather than an if(...) block - see the parenthesis note further down.
set TSERRS=0
for /f %%c in ('type "%TEMP%\anr-tsc-all.log" ^| find /c "error TS"') do set TSERRS=%%c
if "%TSERRS%"=="0" goto tsclean
echo.
echo [build] *** %TSERRS% TYPE ERROR(S) - the tree was clean, so this is new. ***
echo [build]     Full log: %TEMP%\anr-tsc-all.log
echo.
goto tsdone
:tsclean
echo [build] emitted OK - no type errors
:tsdone

echo [chk]  build freshness
node --no-warnings tools/check-build.mjs
if errorlevel 1 goto buildfail
goto buildok
:syntaxfail
echo.
echo [FATAL] TypeScript SYNTAX errors - aborting commit.
echo         These are parse failures, so the emitted JS may be wrong or
echo         truncated. Type errors are reported but do NOT stop a commit;
echo         only these do:
echo.
findstr /R /C:"error TS1[0-9][0-9][0-9]:" "%TEMP%\anr-tsc-all.log"
call :restorebump
pause
exit /b 1
:nobranch
echo.
echo [FATAL] Not on a branch (detached HEAD?) - aborting.
echo         Check out the branch to commit to, then run save.bat again.
pause
exit /b 1
:releasebranch
echo.
echo [FATAL] A release is built from main, but this is branch "%BRANCH%" - aborting.
echo         Merge into main and release from there, or use a plain save.
echo         (Nothing was bumped, staged or committed.)
pause
exit /b 1
:countfail
echo.
echo [FATAL] Could not read COMMIT_COUNT from src/core/app.ts - aborting.
echo         Expected a line of the form:  const COMMIT_COUNT = 270;
echo         Refusing to guess: a wrong value sends the public version number
echo         backwards (a bad count once turned 8.14 into 0.02).
pause
exit /b 1
:buildfail
echo.
echo [FATAL] Build output is missing or stale - aborting commit.
echo         Committing now would ship the previous build against new sources.
echo         Fix the build, then run save.bat again.
echo         (Nothing was staged or committed.)
call :restorebump
pause
exit /b 1
:buildok

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

rem Verify the offline manifests (sw.js SHELL + the Essentials tier) still cover
rem every module, and that no precached module imports an un-precached one - the
rem failure mode that only shows up offline, so it never surfaces in dev. Purely a
rem check, writes nothing. Non-fatal: it reports and the commit continues.
echo [chk]  offline manifests
node --no-warnings tools/check-shell.mjs
if errorlevel 1 echo [warn] offline manifest gaps reported above - see tools/check-shell.mjs

rem Optional read-only stats snapshot to research\stats-backup\ (gitignored, kept local).
rem Pulls from the live /api/stats; non-fatal and skipped by default. Release
rem (option 1 / `release`) and the full Save (option 2 / `save` / --force) skip
rem it entirely; only the commit-only path still offers it. Use menu option 6
rem (Backup) to snapshot on demand.
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
set /p MSG=commit message [v%VERLABEL%]:
if "%MSG%"=="" set MSG=v%VERLABEL%

git commit -m "%MSG%"
if errorlevel 1 goto commitfail
set BUMPED=0

if "%COMMIT_ONLY%"=="1" goto committed
if "%FORCE_MODE%"=="1" goto forcepush

echo.
set /p DOPUSH=push to origin/%BRANCH%? (y/n):
if /i not "%DOPUSH%"=="y" goto skipped

git push origin %BRANCH%
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

:commitfail
echo.
echo [err]  git commit failed - the version bump is put back
call :restorebump
set SAVE_ERROR=1
goto end

:fetch
git pull origin %BRANCH%
if errorlevel 1 set SAVE_ERROR=1
echo.
echo [git]  pulled - resolve any conflicts, then re-run
goto end

rem Force-push only ever sends the CURRENT branch to its own name on origin.
:forcepush
git push origin %BRANCH% --force
if errorlevel 1 goto forcefail
echo.
echo [git]  force pushed origin/%BRANCH%
if "%RELEASE_MODE%"=="1" call :runrelease
goto end
:forcefail
set SAVE_ERROR=1
echo.
echo [err]  force push to origin/%BRANCH% failed
goto end

:pushed
echo.
echo [git]  pushed origin/%BRANCH%
if "%RELEASE_MODE%"=="1" call :runrelease
goto end

:skipped
echo.
echo [git]  push skipped
if "%RELEASE_MODE%"=="1" echo [warn] nothing was pushed, so no release was started
goto end

rem Option 1 (`release`): start the "Release apps" workflow once the push is in.
rem It builds Windows, macOS, Linux and Android on GitHub and publishes one
rem release with the four files (.github/workflows/release.yml). It needs the
rem GitHub CLI, logged in. Non-fatal: the commit and the push already happened,
rem and the Actions tab can still start the workflow by hand.
:runrelease
where gh >nul 2>nul
if errorlevel 1 goto releasenogh
echo.
echo [gh]   start Release apps for v%VERLABEL%
gh workflow run release.yml -R KostaJovanovic/Universal-File-Analyser --ref main -f publish=true
if errorlevel 1 goto releasefail
echo [gh]   started - the release goes live in about 8 minutes:
echo        https://github.com/KostaJovanovic/Universal-File-Analyser/actions/workflows/release.yml
exit /b 0
:releasenogh
echo [warn] gh, the GitHub CLI, is not installed - start Release apps from the Actions tab
exit /b 0
:releasefail
echo [warn] gh could not start Release apps - is it logged in? Start it from the Actions tab
exit /b 0


:committed
echo.
echo [git]  committed v%VERLABEL% (local, not pushed)
goto end


:push
echo.
echo === git: push ===
echo.
set SAVE_ERROR=0
call :getbranch
if "%BRANCH%"=="" goto nobranch
if "%BRANCH%"=="HEAD" goto nobranch
echo [git]  branch: %BRANCH%
rem The prompt's parentheses are escaped (^( ^)): inside this if-block an
rem unescaped close-paren would end the block early and break the parse.
git push origin %BRANCH%
if errorlevel 1 (
  echo.
  set /p FORCE=push failed. force push origin/%BRANCH%? overwrites the remote. ^(y/n^):
  if /i "!FORCE!"=="y" (
    git push origin %BRANCH% --force
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
call :getbranch
if "%BRANCH%"=="" goto nobranch
if "%BRANCH%"=="HEAD" goto nobranch
echo [git]  branch: %BRANCH%
git pull origin %BRANCH%
if errorlevel 1 set SAVE_ERROR=1
goto end


rem The checked-out branch name, or "HEAD" when detached (empty if git fails).
:getbranch
set BRANCH=
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set BRANCH=%%b
exit /b 0


rem Put src/core/app.ts and web/sw.js back as they were before the version bump
rem (byte-exact copies taken just before it), so an aborted save doesn't skip a
rem version number. A no-op unless the bump actually ran.
:restorebump
if not "%BUMPED%"=="1" exit /b 0
copy /y "%TEMP%\anr-bump-app.ts" "src\core\app.ts" >nul
copy /y "%TEMP%\anr-bump-sw.js" "web\sw.js" >nul
set BUMPED=0
echo [git]  version bump reverted - src\core\app.ts and web\sw.js restored
exit /b 0


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

rem Read-only snapshot of the live counters to research\stats-backup\*.csv. Non-fatal:
rem a warning (offline / API down) never blocks a commit when called from :save.
:runbackup
echo [net]  download live stats -^> research\stats-backup\
node --no-warnings tools/backup-stats.mjs
if errorlevel 1 echo [warn] stats backup failed - is the network up?
exit /b 0


:end
echo.
pause
exit /b %SAVE_ERROR%
