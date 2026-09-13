; Analyser - ONE Windows installer that installs OR unpacks a portable copy.
;
; electron-builder puts this file (nsis.include) at the top of its NSIS script,
; ahead of its own template, and expands the macros below at the hooks that
; template offers. See desktop/README.md, "One Windows file".
;
; The template has no portable mode. Its install section always runs the
; uninstaller of any installed copy first (an upgrade, as it sees it), then
; writes the uninstall registry keys and the shortcuts. A portable copy must do
; none of that, so the portable choice never reaches that section:
;
;   page 1   "Install Analyser" or "Portable copy" (customWelcomePage). An
;            update run (/S --updated, from updater.mjs) never sees it.
;   page 2   "only for me / for everyone" - skipped for a portable copy
;            (customInstallMode), which also points the folder beside the
;            installer.
;   page 3   the folder, as before.
;   then     portable: section 0 (below) unpacks the app into that folder and
;            writes portable.txt, the marker main.mjs reads to keep every
;            setting in Analyser-data there. Section 1, the template's install
;            section, is switched off, so no registry key, no shortcut, no
;            uninstaller, and an installed copy is left alone.
;            install: section 0 is off, and section 1 runs as it always did.
;
; Section 0 is ours because customHeader comes before the template's own
; Section "install". customInstall stops the build if that ever changes, and
; customHeader stops it if either hook is not expanded.

; The uninstaller is compiled from this same file with BUILD_UNINSTALLER set,
; and it has no page 1. A variable it declares but never uses is a warning, and
; electron-builder treats warnings as errors - so the uninstaller declares none.
!ifndef BUILD_UNINSTALLER
  Var anrPortable
  Var anrRadioInstall
  Var anrRadioPortable
!endif

!macro customWelcomePage
  !define /ifndef ANR_WELCOME_HOOK
  Page custom anrModeShow anrModeLeave
!macroend

!macro customInstallMode
  !ifndef BUILD_UNINSTALLER
    !define /ifndef ANR_INSTALLMODE_HOOK
    ${if} $anrPortable == "1"
      !insertmacro setInstallModePerUser
      StrCpy $INSTDIR "$EXEDIR\${PRODUCT_FILENAME}"
      Abort
    ${endif}
  !endif
!macroend

!macro customInit
  ; The portable section starts switched off, so a silent run - the updater's
  ; - installs as it always did. Page 1 switches it on when the user asks.
  SectionSetFlags 0 0
!macroend

!macro customInstall
  !if ${INSTALL_SECTION_ID} != 1
    !error "installer.nsh: the install section is no longer section 1 - fix the SectionSetFlags numbers"
  !endif
!macroend

!macro customHeader
  !ifndef BUILD_UNINSTALLER
    !ifndef ANR_WELCOME_HOOK
      !error "installer.nsh: customWelcomePage was not expanded, so there is no install-or-portable page"
    !endif
    !ifndef ANR_INSTALLMODE_HOOK
      !error "installer.nsh: customInstallMode was not expanded, so a portable copy would ask who to install for"
    !endif
    !ifndef APP_64
      !error "installer.nsh: the portable section unpacks the x64 package only"
    !endif

    Section "-anrPortable"
      ${if} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
        ; A running copy locks its files, and a half-replaced copy is worse
        ; than none. A running exe cannot be opened for writing, so that is
        ; the test.
        anrRetry:
        ClearErrors
        FileOpen $1 "$INSTDIR\${APP_EXECUTABLE_FILENAME}" a
        ${if} ${Errors}
          MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Analyser is running from $INSTDIR. Close it, then click Retry." IDRETRY anrRetry
          Quit
        ${endif}
        FileClose $1
        ; Clear the old app files, so no page or script from the last version
        ; stays behind. Analyser-data, which holds the settings, stays.
        RMDir /r "$INSTDIR\resources"
        RMDir /r "$INSTDIR\locales"
      ${endif}
      CreateDirectory "$INSTDIR"
      InitPluginsDir
      ; The same File line as the template's x64_app_files, compression
      ; switches and all, so NSIS stores the app package once, not twice
      ; (SetDatablockOptimize is on by default).
      !ifdef COMPRESS
        SetCompress off
      !endif
      File /oname=$PLUGINSDIR\app-64.${COMPRESSION_METHOD} "${APP_64}"
      !ifdef COMPRESS
        SetCompress "${COMPRESS}"
      !endif
      SetOutPath "$INSTDIR"
      Nsis7z::Extract "$PLUGINSDIR\app-64.${COMPRESSION_METHOD}"
      Delete "$PLUGINSDIR\app-64.${COMPRESSION_METHOD}"
      FileOpen $0 "$INSTDIR\portable.txt" w
      FileWrite $0 "This copy of Analyser is portable. It keeps its settings in the Analyser-data folder beside it and writes nothing to the computer it runs on. Delete this file and Analyser keeps its settings in your user profile instead.$\r$\n"
      FileClose $0
      ; The finish page's "Run Analyser" box starts this.
      StrCpy $launchLink "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    SectionEnd

    Function anrModeShow
      ${if} ${isUpdated}
        Abort
      ${endif}
      !insertmacro MUI_HEADER_TEXT "Install or portable" "Choose how to set up Analyser."
      nsDialogs::Create 1018
      Pop $0
      ${NSD_CreateRadioButton} 0 0 100% 12u "Install Analyser"
      Pop $anrRadioInstall
      ${NSD_CreateLabel} 12u 14u 280u 24u "Adds Analyser to the Start menu and the desktop. It updates itself, and Windows Settings can remove it."
      Pop $0
      ${NSD_CreateRadioButton} 0 46u 100% 12u "Portable copy"
      Pop $anrRadioPortable
      ${NSD_CreateLabel} 12u 60u 280u 36u "Puts Analyser in a folder you choose, for example on a USB stick. It writes nothing to this computer and keeps its settings in that folder. To remove it, delete the folder."
      Pop $0
      ${if} $anrPortable == "1"
        ${NSD_Check} $anrRadioPortable
      ${else}
        ${NSD_Check} $anrRadioInstall
      ${endif}
      nsDialogs::Show
    FunctionEnd

    Function anrModeLeave
      ${NSD_GetState} $anrRadioPortable $0
      ${if} $0 == ${BST_CHECKED}
        StrCpy $anrPortable "1"
        SectionSetFlags 0 1 ; 1 = SF_SELECTED
        SectionSetFlags 1 0
        !ifdef APP_64_UNPACKED_SIZE
          SectionSetSize 0 ${APP_64_UNPACKED_SIZE}
        !endif
      ${else}
        StrCpy $anrPortable "0"
        SectionSetFlags 0 0
        SectionSetFlags 1 1
      ${endif}
    FunctionEnd
  !endif
!macroend
