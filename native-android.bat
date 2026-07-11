@echo off
REM ---------------------------------------------------------------------------
REM Local Android APK build for the Tauri native shell.
REM
REM Rust intermediates and the final APK both land in the root build\ folder
REM (build\android), so `del build` reclaims every local build at once. This
REM CARGO_TARGET_DIR override is local-only; CI keeps the default target dir.
REM
REM (Historical note: the repo used to live under a path with a SPACE, which
REM broke the NDK's clang.cmd linker wrapper - it double-quotes %1 in
REM `if "%1" == "-cc1"`, so the space split the rustc response-file arg and the
REM link failed with `...linker-arguments"" was unexpected at this time`. The
REM path is now space-free, so the old C:\anrtgt workaround is gone. If you ever
REM move the repo back under a spaced path, point CARGO_TARGET_DIR at a
REM space-free location for Android only - MSVC's desktop linker is unaffected.)
REM
REM Usage (from anywhere):
REM   native-android.bat            -> debug APK (default)
REM   native-android.bat release    -> release APK
REM
REM Output: build\android\ (final APK, copied from gen\android after the build)
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

REM Redirect Rust intermediates into the root build\ folder (build\android).
set "CARGO_TARGET_DIR=%~dp0build\android"

REM Build from the native/ dir (this script lives in the repo root, one level up).
cd /d "%~dp0native"

REM Default to a debug APK; "release" as the first arg switches to a release build.
set "PROFILE=--debug"
if /I "%~1"=="release" set "PROFILE="

echo Building Android APK ( %PROFILE% ) with CARGO_TARGET_DIR=%CARGO_TARGET_DIR% ...
call npm run tauri android build -- --apk %PROFILE%
set "RC=%ERRORLEVEL%"

if "%RC%"=="0" (
  echo.
  echo Copying final APK into build\android\ ...
  if not exist "%~dp0build\android" mkdir "%~dp0build\android"
  for /r "src-tauri\gen\android\app\build\outputs\apk" %%F in (*.apk) do copy /Y "%%F" "%~dp0build\android\" >nul
  echo Done. APK in build\android\
) else (
  echo.
  echo Build FAILED with exit code %RC%.
)
endlocal & exit /b %RC%
