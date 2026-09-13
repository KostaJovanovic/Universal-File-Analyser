; Analyser - ONE Windows installer that installs OR sets up a portable copy.
;
; electron-builder puts this file (nsis.include) at the top of its NSIS script,
; ahead of its own template, and expands the macros below at the hooks that
; template offers. See desktop/README.md, "One Windows file".
;
; Three steps, in the site's own look: a flat white window, the site's
; near-black ink and red accent, sharp 1 px frames, no branding line.
;
;   1  "How do you want Analyser?" (customWelcomePage, full window). Two
;      cards: Install, or Portable copy with its own folder box. An update run
;      (/S --updated, from updater.mjs) never sees it, and neither does the
;      elevated second copy of the installer that UAC starts.
;   2  the template's progress page, restyled (customPageAfterChangeDir).
;   3  "Analyser is ready" (customFinishPage, full window), with a box that
;      starts Analyser.
;
; The template's two other pages never show. "Only for me / for everyone"
; always skips (customInstallMode): an install goes to this user account,
; unless the computer already has an everyone-copy, which is then updated where
; it is. The folder page is off (allowToChangeInstallationDirectory: false in
; electron-builder.yml): an install goes to the usual per-user folder, and the
; portable folder comes from page 1.
;
; The portable path never says "install": its button reads "Set up", and its
; progress and done pages speak of the portable copy.
;
; The template has no portable mode. Its install section always runs the
; uninstaller of any installed copy first (an upgrade, as it sees it), then
; writes the uninstall registry keys and the shortcuts. A portable copy must do
; none of that, so the portable choice never reaches that section. Section 0
; (below) unpacks the app into the folder and writes portable.txt, the marker
; main.mjs reads to keep every setting in Analyser-data there. Section 1, the
; template's install section, is switched off: no registry key, no shortcut,
; no uninstaller, and an installed copy is left alone. For an install, section
; 0 is off and section 1 runs as it always did.
;
; Section 0 is ours because customHeader comes before the template's own
; Section "install". customInstall stops the build if that ever changes, and
; customHeader stops it if any hook is not expanded.

; DPI-aware, so Windows draws the installer at the display's real resolution
; instead of stretching a 96-dpi picture of it, which blurs every letter on a
; scaled display.
ManifestDPIAware true

; The site's light theme (analyser.css --bg, --fg, --muted, --accent). Light
; only: themed Windows radio buttons ignore a text colour, so dark text on a
; dark page would vanish.
!define ANR_BG     FFFFFF
!define ANR_INK    0A0A0A
!define ANR_MUTED  6B6B6B
!define ANR_ACCENT E60023
!define MUI_TEXTCOLOR ${ANR_INK}

; The uninstaller is compiled from this same file with BUILD_UNINSTALLER set,
; and it uses none of this. A variable it declares but never uses is a warning,
; and electron-builder treats warnings as errors - so the uninstaller declares
; none.
!ifndef BUILD_UNINSTALLER
  !define MUI_CUSTOMFUNCTION_GUIINIT anrGuiInit
  Var anrPortable
  Var anrPortableDir
  Var anrPage
  Var anrRadioInstall
  Var anrRadioPortable
  Var anrBarInstall
  Var anrBarPortable
  Var anrDirBox
  Var anrFontMono
  Var anrFontHeading
  Var anrFontTitle
  Var anrFontBody
  Var anrFontHeader
  !ifndef HIDE_RUN_AFTER_FINISH
    Var anrRunBox
  !endif
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
      StrCpy $INSTDIR $anrPortableDir
      Abort
    ${elseif} $hasPerMachineInstallation == "1"
    ${andIf} $hasPerUserInstallation == "0"
      ; An everyone-copy is already there: update it in place rather than put
      ; a second copy in this account. The template asks for elevation.
      StrCpy $isForceMachineInstall "1"
    ${else}
      StrCpy $isForceCurrentInstall "1"
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

; Sits right before the template's progress page (MUI_PAGE_INSTFILES).
!macro customPageAfterChangeDir
  !define /ifndef ANR_PROGRESS_HOOK
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW anrProgressShow
  ; The page would title its last moment "Installation Complete", which a
  ; portable copy must never read. Blank instead: the done page covers the
  ; header straight after.
  !define MUI_INSTFILESPAGE_FINISHHEADER_TEXT " "
  !define MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT " "
  !define MUI_INSTFILESPAGE_ABORTHEADER_TEXT "Analyser was not set up"
  !define MUI_INSTFILESPAGE_ABORTHEADER_SUBTEXT "Close this window, then run the setup again."
!macroend

; In place of MUI's finish page, whose texts say "installed" either way.
!macro customFinishPage
  !define /ifndef ANR_FINISH_HOOK
  Page custom anrDoneShow anrDoneLeave
!macroend

!macro customHeader
  !ifndef BUILD_UNINSTALLER
    !ifndef ANR_WELCOME_HOOK
      !error "installer.nsh: customWelcomePage was not expanded, so there is no install-or-portable page"
    !endif
    !ifndef ANR_INSTALLMODE_HOOK
      !error "installer.nsh: customInstallMode was not expanded, so the 'for me or for everyone' page would show"
    !endif
    !ifndef ANR_PROGRESS_HOOK
      !error "installer.nsh: customPageAfterChangeDir was not expanded, so the progress page keeps the stock look"
    !endif
    !ifndef ANR_FINISH_HOOK
      !error "installer.nsh: customFinishPage was not expanded, so the last page would say installed for a portable copy"
    !endif
    !ifdef allowToChangeInstallationDirectory
      !error "installer.nsh: set nsis.allowToChangeInstallationDirectory to false - page 1 picks the portable folder, and the template's folder page says install"
    !endif
    !ifndef APP_64
      !error "installer.nsh: the portable section unpacks the x64 package only"
    !endif

    ; Here, not at the top: nsDialogs.nsh and WinMessages.nsh come in after
    ; the top of this file, and may define these themselves.
    !define /ifndef ANR_SS_RIGHT 0x00000002
    !define /ifndef PBM_SETBARCOLOR 0x0409
    !define /ifndef PBM_SETBKCOLOR 0x2001

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
      ; Our own line on the progress page, and none of NSIS's own: those read
      ; "Extract:" and the like.
      SetDetailsPrint textonly
      DetailPrint "Copying Analyser into $INSTDIR"
      SetDetailsPrint none
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
      ; The done page's "Start Analyser" box starts this.
      StrCpy $launchLink "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      SetDetailsPrint textonly
      DetailPrint "The portable copy is ready."
      SetDetailsPrint none
    SectionEnd

    ; ---- the window ----------------------------------------------------------

    Function anrGuiInit
      ; White behind every page and around the buttons, as the site's page.
      SetCtlColors $HWNDPARENT ${ANR_INK} ${ANR_BG}
      ; No "Analyser 9.x" branding line and no etched rules: the site draws
      ; none between its sections.
      ShowWindow $mui.Branding.Background ${SW_HIDE}
      ShowWindow $mui.Branding.Text ${SW_HIDE}
      ShowWindow $mui.Line.Standard ${SW_HIDE}
      ShowWindow $mui.Line.FullWindow ${SW_HIDE}
      ; Segoe UI is the Windows interface font. Consolas stands in for the
      ; site's mono labels (Geist Mono ships as WOFF2, which Windows cannot
      ; load here).
      CreateFont $anrFontMono "Consolas" 8 400
      CreateFont $anrFontHeading "Segoe UI Semibold" 16 400
      CreateFont $anrFontTitle "Segoe UI Semibold" 10 400
      CreateFont $anrFontBody "Segoe UI" 9 400
      CreateFont $anrFontHeader "Segoe UI Semibold" 9 400
      SendMessage $mui.Header.Text ${WM_SETFONT} $anrFontHeader 0
      SetCtlColors $mui.Header.SubText ${ANR_MUTED} ${ANR_BG}
      ; The progress page moves on to the done page by itself, as MUI's own
      ; finish page arranges.
      SetAutoClose true
    FunctionEnd

    ; Pages 1 and 3 fill the window, as MUI's welcome and finish pages do: the
    ; page covers the header, and the header's texts hide so Alt cannot show
    ; them through it. The branding and the rules stay hidden throughout.
    Function anrFullWindowOn
      LockWindow on
      ShowWindow $mui.Header.Text ${SW_HIDE}
      ShowWindow $mui.Header.SubText ${SW_HIDE}
      ShowWindow $mui.Header.Image ${SW_HIDE}
      LockWindow off
    FunctionEnd

    Function anrFullWindowOff
      LockWindow on
      ShowWindow $mui.Header.Text ${SW_NORMAL}
      ShowWindow $mui.Header.SubText ${SW_NORMAL}
      ShowWindow $mui.Header.Image ${SW_NORMAL}
      LockWindow off
    FunctionEnd

    ; A small mono label in the site's red, above each page's heading.
    Function anrEyebrow
      ${NSD_CreateLabel} 5% 12u 90% 10u "ANALYSER SETUP"
      Pop $0
      SendMessage $0 ${WM_SETFONT} $anrFontMono 0
      SetCtlColors $0 ${ANR_ACCENT} ${ANR_BG}
    FunctionEnd

    ; A card: a 1 px frame in the site's ink from 5 % to 95 % of the page
    ; width, and a 3 px accent bar just inside its left edge, hidden until the
    ; card is chosen. Pixels, not dialog units, so every line is one pixel at
    ; any display scale.
    ; In (stack): top, then height, in dialog units. Out (stack): the bar.
    Function anrCard
      Pop $R1
      Pop $R0
      IntOp $R1 $R0 + $R1
      ; Top and bottom: MapDialogRect turns dialog units into pixels.
      System::Call "*(i 0, i R0, i 0, i R1) p .R2"
      System::Call "user32::MapDialogRect(p $anrPage, p R2)"
      System::Call "*$R2(i .R6, i .R0, i .R7, i .R1)"
      ; Left and right: 5 % and 95 % of the page's width.
      System::Call "user32::GetClientRect(p $anrPage, p R2)"
      System::Call "*$R2(i .R6, i .R7, i .R3, i .R8)"
      System::Free $R2
      IntOp $R4 $R3 * 5
      IntOp $R4 $R4 / 100
      IntOp $R5 $R3 * 95
      IntOp $R5 $R5 / 100
      IntOp $R6 $R5 - $R4
      IntOp $R7 $R1 - $R0
      ${NSD_CreateLabel} $R4 $R0 $R6 1 ""
      Pop $R8
      SetCtlColors $R8 "" ${ANR_INK}
      IntOp $R9 $R1 - 1
      ${NSD_CreateLabel} $R4 $R9 $R6 1 ""
      Pop $R8
      SetCtlColors $R8 "" ${ANR_INK}
      ${NSD_CreateLabel} $R4 $R0 1 $R7 ""
      Pop $R8
      SetCtlColors $R8 "" ${ANR_INK}
      IntOp $R9 $R5 - 1
      ${NSD_CreateLabel} $R9 $R0 1 $R7 ""
      Pop $R8
      SetCtlColors $R8 "" ${ANR_INK}
      IntOp $R9 $R4 + 1
      IntOp $R3 $R0 + 1
      IntOp $R7 $R7 - 2
      ${NSD_CreateLabel} $R9 $R3 3 $R7 ""
      Pop $R8
      SetCtlColors $R8 "" ${ANR_ACCENT}
      ShowWindow $R8 ${SW_HIDE}
      Push $R8
    FunctionEnd

    ; ---- page 1: install, or a portable copy --------------------------------

    Function anrModeShow
      ; An update run, and the elevated copy UAC starts, go straight on.
      ${if} ${isUpdated}
      ${orIf} ${UAC_IsInnerInstance}
        Abort
      ${endif}
      ${if} $anrPortableDir == ""
        StrCpy $anrPortableDir "$EXEDIR\${APP_FILENAME}"
      ${endif}
      nsDialogs::Create 1044
      Pop $anrPage
      ${if} $anrPage == error
        Abort
      ${endif}
      SetCtlColors $anrPage ${ANR_INK} ${ANR_BG}

      Call anrEyebrow
      ${NSD_CreateLabel} 5% 23u 90% 22u "How do you want Analyser?"
      Pop $0
      SendMessage $0 ${WM_SETFONT} $anrFontHeading 0
      SetCtlColors $0 ${ANR_INK} ${ANR_BG}

      ; Card 1: install.
      Push 52
      Push 52
      Call anrCard
      Pop $anrBarInstall
      ${NSD_CreateRadioButton} 8% 58u 55% 12u "Install"
      Pop $anrRadioInstall
      SendMessage $anrRadioInstall ${WM_SETFONT} $anrFontTitle 0
      SetCtlColors $anrRadioInstall ${ANR_INK} ${ANR_BG}
      ${NSD_OnClick} $anrRadioInstall anrModeClick
      ${NSD_CreateLabel} 64% 60u 28% 10u "RECOMMENDED"
      Pop $0
      ${NSD_AddStyle} $0 ${ANR_SS_RIGHT}
      SendMessage $0 ${WM_SETFONT} $anrFontMono 0
      SetCtlColors $0 ${ANR_MUTED} ${ANR_BG}
      ${NSD_OnClick} $0 anrPickInstall
      ${NSD_CreateLabel} 12% 72u 80% 26u "Adds Analyser to the Start menu and the desktop. It updates itself, and Windows Settings can remove it."
      Pop $0
      SendMessage $0 ${WM_SETFONT} $anrFontBody 0
      SetCtlColors $0 ${ANR_MUTED} ${ANR_BG}
      ${NSD_OnClick} $0 anrPickInstall

      ; Card 2: a portable copy, with its folder.
      Push 112
      Push 76
      Call anrCard
      Pop $anrBarPortable
      ${NSD_CreateRadioButton} 8% 118u 55% 12u "Portable copy"
      Pop $anrRadioPortable
      SendMessage $anrRadioPortable ${WM_SETFONT} $anrFontTitle 0
      SetCtlColors $anrRadioPortable ${ANR_INK} ${ANR_BG}
      ${NSD_OnClick} $anrRadioPortable anrModeClick
      ${NSD_CreateLabel} 12% 132u 80% 26u "Runs from a folder you choose, for example on a USB stick. It writes nothing to this computer. To remove it, delete the folder."
      Pop $0
      SendMessage $0 ${WM_SETFONT} $anrFontBody 0
      SetCtlColors $0 ${ANR_MUTED} ${ANR_BG}
      ${NSD_OnClick} $0 anrPickPortable
      ${NSD_CreateText} 12% 162u 60% 13u "$anrPortableDir"
      Pop $anrDirBox
      SendMessage $anrDirBox ${WM_SETFONT} $anrFontBody 0
      SetCtlColors $anrDirBox ${ANR_INK} ${ANR_BG}
      ${NSD_OnChange} $anrDirBox anrPickPortable
      ${NSD_CreateBrowseButton} 74% 161u 18% 15u "Browse..."
      Pop $0
      SendMessage $0 ${WM_SETFONT} $anrFontBody 0
      ${NSD_OnClick} $0 anrBrowse

      ${if} $anrPortable == "1"
        ${NSD_Check} $anrRadioPortable
      ${else}
        ${NSD_Check} $anrRadioInstall
      ${endif}
      Call anrModeSync
      Call anrFullWindowOn
      nsDialogs::Show
      Call anrFullWindowOff
    FunctionEnd

    ; The chosen card gets its accent bar, and the button says what it does.
    Function anrModeSync
      ${NSD_GetState} $anrRadioPortable $0
      GetDlgItem $1 $HWNDPARENT 1
      ${if} $0 == ${BST_CHECKED}
        ShowWindow $anrBarInstall ${SW_HIDE}
        ShowWindow $anrBarPortable ${SW_SHOW}
        SendMessage $1 ${WM_SETTEXT} 0 "STR:Set up"
      ${else}
        ShowWindow $anrBarPortable ${SW_HIDE}
        ShowWindow $anrBarInstall ${SW_SHOW}
        SendMessage $1 ${WM_SETTEXT} 0 "STR:Install"
      ${endif}
    FunctionEnd

    Function anrModeClick
      Pop $0
      Call anrModeSync
    FunctionEnd

    ; A click anywhere in a card's text picks that card.
    Function anrPickInstall
      Pop $0
      ${NSD_Uncheck} $anrRadioPortable
      ${NSD_Check} $anrRadioInstall
      Call anrModeSync
    FunctionEnd

    ; Also runs when the folder box changes: typing a folder means portable.
    Function anrPickPortable
      Pop $0
      ${NSD_Uncheck} $anrRadioInstall
      ${NSD_Check} $anrRadioPortable
      Call anrModeSync
    FunctionEnd

    Function anrBrowse
      Pop $0
      ${NSD_GetText} $anrDirBox $1
      nsDialogs::SelectFolderDialog "Choose where the portable copy goes." $1
      Pop $1
      ${if} $1 != error
        Push $1
        Call anrFolder
        Pop $1
        ; Fires the box's change callback, which picks the portable card.
        ${NSD_SetText} $anrDirBox $1
      ${endif}
    FunctionEnd

    ; The portable folder always ends in \Analyser, as the template's folder
    ; page made sure of: picking D:\ puts the copy in D:\Analyser, not loose in
    ; the root of the drive. In and out: the stack.
    Function anrFolder
      Exch $R0
      Push $R1
      anrFolderTrim:
        StrCpy $R1 $R0 1 -1
        ${if} $R1 == "\"
        ${orIf} $R1 == "/"
          StrCpy $R0 $R0 -1
          Goto anrFolderTrim
        ${endif}
      ${GetFileName} $R0 $R1
      ${if} $R1 != "${APP_FILENAME}"
        StrCpy $R0 "$R0\${APP_FILENAME}"
      ${endif}
      Pop $R1
      Exch $R0
    FunctionEnd

    Function anrModeLeave
      ${NSD_GetState} $anrRadioPortable $0
      ${if} $0 == ${BST_CHECKED}
        ${NSD_GetText} $anrDirBox $1
        ; A full path only: a drive (D:\...) or a network share (\\server\...).
        StrCpy $2 $1 1 1
        StrCpy $3 $1 2
        ${if} $2 != ":"
        ${andIf} $3 != "\\"
          MessageBox MB_OK|MB_ICONEXCLAMATION "Type a full folder path for the portable copy, for example D:\Analyser, or click Browse."
          Abort
        ${endif}
        Push $1
        Call anrFolder
        Pop $anrPortableDir
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

    ; ---- page 2: progress ------------------------------------------------------

    Function anrProgressShow
      FindWindow $0 "#32770" "" $HWNDPARENT
      SetCtlColors $0 ${ANR_INK} ${ANR_BG}
      GetDlgItem $1 $0 1006
      SetCtlColors $1 ${ANR_MUTED} ${ANR_BG}
      SendMessage $1 ${WM_SETFONT} $anrFontBody 0
      ; A flat bar in the site's red. Themed, Windows paints its own green one
      ; and ignores the colour.
      GetDlgItem $1 $0 1004
      System::Call "uxtheme::SetWindowTheme(p r1, w ' ', w ' ')"
      SendMessage $1 ${PBM_SETBARCOLOR} 0 0x002300E6
      SendMessage $1 ${PBM_SETBKCOLOR} 0 0x00FFFFFF
      ${if} $anrPortable == "1"
        !insertmacro MUI_HEADER_TEXT "Setting up the portable copy" "Analyser is going into $INSTDIR."
      ${else}
        !insertmacro MUI_HEADER_TEXT "Installing Analyser" "This takes a moment."
      ${endif}
    FunctionEnd

    ; ---- page 3: done ------------------------------------------------------------

    Function anrDoneShow
      GetDlgItem $0 $HWNDPARENT 1
      SendMessage $0 ${WM_SETTEXT} 0 "STR:Finish"
      nsDialogs::Create 1044
      Pop $anrPage
      ${if} $anrPage == error
        Abort
      ${endif}
      SetCtlColors $anrPage ${ANR_INK} ${ANR_BG}

      Call anrEyebrow
      ${NSD_CreateLabel} 5% 23u 90% 22u "Analyser is ready"
      Pop $0
      SendMessage $0 ${WM_SETFONT} $anrFontHeading 0
      SetCtlColors $0 ${ANR_INK} ${ANR_BG}

      ${if} $anrPortable == "1"
        ${NSD_CreateLabel} 5% 52u 90% 12u "The portable copy is in this folder:"
        Pop $0
        SendMessage $0 ${WM_SETFONT} $anrFontBody 0
        SetCtlColors $0 ${ANR_MUTED} ${ANR_BG}
        ${NSD_CreateLabel} 5% 66u 90% 12u "$INSTDIR"
        Pop $0
        SendMessage $0 ${WM_SETFONT} $anrFontMono 0
        SetCtlColors $0 ${ANR_INK} ${ANR_BG}
        ${NSD_CreateLabel} 5% 84u 90% 36u "It keeps its settings in the Analyser-data folder beside it, so the whole folder can move to another computer. To remove it, delete the folder."
        Pop $0
        SendMessage $0 ${WM_SETFONT} $anrFontBody 0
        SetCtlColors $0 ${ANR_MUTED} ${ANR_BG}
      ${else}
        ${NSD_CreateLabel} 5% 52u 90% 36u "Analyser is installed. Start it from the Start menu or the desktop. It updates itself, and Windows Settings can remove it."
        Pop $0
        SendMessage $0 ${WM_SETFONT} $anrFontBody 0
        SetCtlColors $0 ${ANR_MUTED} ${ANR_BG}
      ${endif}

      !ifndef HIDE_RUN_AFTER_FINISH
        ${NSD_CreateCheckBox} 5% 130u 90% 12u "Start Analyser"
        Pop $anrRunBox
        SendMessage $anrRunBox ${WM_SETFONT} $anrFontBody 0
        SetCtlColors $anrRunBox ${ANR_INK} ${ANR_BG}
        ${NSD_Check} $anrRunBox
      !endif

      Call anrFullWindowOn
      nsDialogs::Show
      Call anrFullWindowOff
    FunctionEnd

    ; Starts the app the way the template's own finish page does.
    Function anrDoneLeave
      !ifndef HIDE_RUN_AFTER_FINISH
        ${NSD_GetState} $anrRunBox $0
        ${if} $0 == ${BST_CHECKED}
          ${if} ${isUpdated}
            StrCpy $1 "--updated"
          ${else}
            StrCpy $1 ""
          ${endif}
          ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
        ${endif}
      !endif
    FunctionEnd
  !endif
!macroend
