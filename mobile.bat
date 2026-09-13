@echo off
rem ---------------------------------------------------------------------------
rem Analyser Android - build the app and put it on a phone.
rem
rem The counterpart to desktop.bat. Connect a phone over USB with USB debugging
rem on (Settings > About phone > tap "Build number" seven times, then
rem Developer options > USB debugging), then run this.
rem
rem   mobile.bat          build, install on the phone, and start the app
rem   mobile.bat apk      build only - the APK lands in
rem                       mobile\android\app\build\outputs\apk\debug\
rem   mobile.bat open     stage and sync, then open Android Studio
rem
rem What happens, in order, and why:
rem   1. mobile/ has its OWN package.json (Capacitor), installed on first run.
rem   2. web/assets/js/ is BUILD OUTPUT, so tsc runs first, as in desktop.bat.
rem   3. `npm run sync` stamps the version, stages web/ into mobile/www/, builds
rem      the bridge, copies an FFmpeg binary if mobile/ffmpeg/out/ has one, and
rem      `cap sync` copies all of it into the Android project. The APK carries a
rem      copy of the site, so an edit shows only after this runs again.
rem   4. Gradle needs JDK 21. JAVA_HOME is used when it already points at 21 or
rem      newer. Otherwise this looks in %USERPROFILE%\.jdks and in Android
rem      Studio's bundled runtime.
rem   5. adb installs the debug APK over the previous one and starts it.
rem ---------------------------------------------------------------------------
title analyser mobile
cd /d "%~dp0"
set "ANR_MODE=%~1"

if not exist "mobile\node_modules\@capacitor\cli\" (
  echo.
  echo   First run - installing the mobile dependencies.
  echo.
  pushd mobile
  call npm install --no-audit --no-fund
  popd
)
if not exist "mobile\node_modules\@capacitor\cli\" (
  echo.
  echo   npm install failed. Fix that first, then run this again.
  pause
  exit /b 1
)

echo.
echo   Building src/ ...
call npm run build
rem Not fatal, for desktop.bat's reason: tsc still emits on a TYPE error.
if errorlevel 1 (
  echo.
  echo   *** tsc reported errors above. Continuing anyway - read them. ***
)

echo.
echo   Staging web/ and syncing the Android project ...
pushd mobile
call npm run sync
set "ANR_ERR=%errorlevel%"
popd
if not "%ANR_ERR%"=="0" (
  echo.
  echo   The sync failed - see above.
  pause
  exit /b 1
)

if /i "%ANR_MODE%"=="open" (
  pushd mobile
  call npx cap open android
  popd
  exit /b 0
)

call :findjdk
if not defined ANR_JDK (
  echo.
  echo   Gradle needs JDK 21 or newer, and none was found. Install Android
  echo   Studio, or unzip a JDK 21 into %USERPROFILE%\.jdks\, then run this again.
  pause
  exit /b 1
)
set "JAVA_HOME=%ANR_JDK%"

echo.
echo   Building the APK with %JAVA_HOME% ...
pushd mobile\android
call gradlew.bat assembleDebug
set "ANR_ERR=%errorlevel%"
popd
if not "%ANR_ERR%"=="0" (
  echo.
  echo   The Gradle build failed - see above.
  pause
  exit /b 1
)

set "ANR_APK=mobile\android\app\build\outputs\apk\debug\app-debug.apk"
if /i "%ANR_MODE%"=="apk" (
  echo.
  echo   Built: %ANR_APK%
  exit /b 0
)

where adb >nul 2>nul
if errorlevel 1 if defined ANDROID_HOME set "PATH=%PATH%;%ANDROID_HOME%\platform-tools"
adb get-state >nul 2>nul
if errorlevel 1 (
  echo.
  echo   No phone found over adb. Connect one with USB debugging on, or install
  echo   this APK by hand: %ANR_APK%
  pause
  exit /b 0
)

echo.
echo   Installing on the phone ...
adb install -r "%ANR_APK%"
if errorlevel 1 (
  echo.
  echo   adb could not install the APK - see above.
  pause
  exit /b 1
)
adb shell am start -n com.valjdakosta.analyser/.MainActivity >nul
echo   Started. Make an edit, then run mobile.bat again.
exit /b 0

rem ---- find a JDK 21 or newer ----------------------------------------------------
:findjdk
set "ANR_JDK="
if defined JAVA_HOME call :tryjdk "%JAVA_HOME%"
for /d %%d in ("%USERPROFILE%\.jdks\*") do call :tryjdk "%%~d"
call :tryjdk "%ProgramFiles%\Android\Android Studio\jbr"
call :tryjdk "%LOCALAPPDATA%\Programs\Android Studio\jbr"
for /d %%d in ("%ProgramFiles%\Eclipse Adoptium\jdk-2*" "%ProgramFiles%\Microsoft\jdk-2*" "%ProgramFiles%\Java\jdk-2*") do call :tryjdk "%%~d"
exit /b 0

rem The first hit wins. `java -version` prints `version "21.0.12"`; the dot in the
rem pattern stands for the quote, which findstr cannot take inside /c:"...".
:tryjdk
if defined ANR_JDK exit /b 0
if not exist "%~1\bin\java.exe" exit /b 0
"%~1\bin\java.exe" -version 2>&1 | findstr /r /c:"version .2[1-9]" /c:"version .[3-9][0-9]" >nul && set "ANR_JDK=%~1"
exit /b 0
