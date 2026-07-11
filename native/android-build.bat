@echo off
REM ---------------------------------------------------------------------------
REM Local Android APK build for the Tauri native shell.
REM
REM Why this script exists: the repo lives under "...\Projekti\file analyser\",
REM and that SPACE breaks the NDK's clang.cmd linker wrapper (it double-quotes
REM %1 in `if "%1" == "-cc1"`, so the space splits the rustc response-file arg and
REM the link fails with `...linker-arguments"" was unexpected at this time`). The
REM fix is to build to a space-free CARGO_TARGET_DIR. That override is scoped to
REM this script only - it is NOT persisted globally, because it would needlessly
REM redirect the desktop build's target dir too. The desktop Windows build is
REM unaffected by the space (MSVC's linker handles it fine).
REM
REM Usage (from anywhere):
REM   native\android-build.bat            -> debug APK (default)
REM   native\android-build.bat release    -> release APK
REM
REM Output: src-tauri\gen\android\app\build\outputs\apk\universal\<profile>\
REM ---------------------------------------------------------------------------
setlocal

REM Toolchain locations. These are also persisted at User scope, but re-setting
REM them here means a fresh shell (or one opened before they were set) still works.
set "JAVA_HOME=C:\Program Files\Java\jdk-17"
set "ANDROID_HOME=C:\Android\sdk"
set "ANDROID_SDK_ROOT=C:\Android\sdk"
set "NDK_HOME=C:\Android\sdk\ndk\26.3.11579264"
set "ANDROID_NDK_ROOT=%NDK_HOME%"
set "PATH=%USERPROFILE%\.cargo\bin;%ANDROID_HOME%\platform-tools;%PATH%"

REM The actual fix: keep the linker response file off the spaced project path.
set "CARGO_TARGET_DIR=C:\anrtgt"

REM Build from the native/ dir (this script lives there).
cd /d "%~dp0"

REM Default to a debug APK; "release" as the first arg switches to a release build.
set "PROFILE=--debug"
if /I "%~1"=="release" set "PROFILE="

echo Building Android APK ( %PROFILE% ) with CARGO_TARGET_DIR=%CARGO_TARGET_DIR% ...
call npm run tauri android build -- --apk %PROFILE%
set "RC=%ERRORLEVEL%"

if "%RC%"=="0" (
  echo.
  echo Done. APK under src-tauri\gen\android\app\build\outputs\apk\universal\
) else (
  echo.
  echo Build FAILED with exit code %RC%.
)
endlocal & exit /b %RC%
