; NSIS installer hooks for Ridgeline (the new app, config tauri.wall2.conf.json).
;
; Ridgeline was called "Widget Wall 2" while it was built. The installer keys its install
; folder, uninstall entry, shortcuts and sign-in Run value by the product name, so the new
; name would otherwise install beside the old one. Before Ridgeline is installed, this
; removes the old "Widget Wall 2" install through its own uninstaller, found through its own
; registry key. The identifier is unchanged, so the settings, keys file, sign-in tokens and
; web view storage (all keyed by the identifier) are never touched: the old uninstaller is
; run silently and in update mode, which skips its "delete app data" step.
;
; If the old product is not installed, or anything about it looks unexpected, nothing is
; done. If the old uninstall fails, or the old uninstall entry is still there afterwards, one
; message says so, the old install is left exactly as it was, and Ridgeline still installs.
;
; This replaces an old setup.exe install with the new setup.exe. An old MSI install is
; replaced by the new MSI through the pinned upgrade code instead; the two kinds do not
; replace each other.

Var RidgelineOldDir
Var RidgelineOldRun

; Deletes one shortcut of the old product, only if it exists and points at the old exe.
; In update mode the old uninstaller skips its own shortcut removal, so this does it.
!macro RidgelineRemoveOldShortcut shortcut
  ${If} ${FileExists} "${shortcut}"
    !insertmacro IsShortcutTarget "${shortcut}" "$RidgelineOldDir\${MAINBINARYNAME}.exe"
    Pop $3
    ${If} $3 = 1
      Delete "${shortcut}"
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  Push $0
  Push $1
  Push $2
  Push $3
  StrCpy $RidgelineOldDir ""
  StrCpy $RidgelineOldRun ""

  ; $0 is the old uninstall command, $1 the old install folder, both written by the old installer.
  ReadRegStr $0 SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\Widget Wall 2" "UninstallString"
  ReadRegStr $1 SHCTX "Software\${MANUFACTURER}\Widget Wall 2" ""

  ; Only when the command is exactly the quoted uninstall.exe inside that folder, and it exists.
  ${If} $0 != ""
  ${AndIf} $1 != ""
  ${AndIf} $0 == "$\"$1\uninstall.exe$\""
  ${AndIf} ${FileExists} "$1\uninstall.exe"
    ReadRegStr $RidgelineOldRun HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Widget Wall 2"
    StrCpy $RidgelineOldDir "$1"
    DetailPrint "Removing the previous install of Widget Wall 2"
    ClearErrors
    ; Same call the bundler's own reinstall step makes: run in place (_?=) so it can be waited on.
    ExecWait '$0 /S /UPDATE _?=$1' $2
    ${If} ${Errors}
    ${OrIf} $2 <> 0
      StrCpy $2 "failed"
    ${Else}
      ; The old uninstaller deletes its own uninstall entry even in update mode. If it is
      ; still there, the removal did not happen, whatever the exit code said.
      ReadRegStr $2 SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\Widget Wall 2" "UninstallString"
      ${If} $2 != ""
        StrCpy $2 "failed"
      ${Else}
        StrCpy $2 "removed"
      ${EndIf}
    ${EndIf}

    ${If} $2 == "removed"
      ; The in-place uninstaller cannot delete itself; remove it and the folder if empty.
      Delete "$1\uninstall.exe"
      RMDir "$1"
      ; Update mode also skips the old shortcuts and leaves the old install-folder key. Remove
      ; exactly the shortcuts the old installer made for this product name (the Start menu one
      ; and the desktop one) and exactly that one key, never the manufacturer key.
      !insertmacro RidgelineRemoveOldShortcut "$SMPROGRAMS\Widget Wall 2.lnk"
      !insertmacro RidgelineRemoveOldShortcut "$DESKTOP\Widget Wall 2.lnk"
      DeleteRegKey SHCTX "Software\${MANUFACTURER}\Widget Wall 2"
    ${Else}
      DetailPrint "The previous install of Widget Wall 2 could not be removed and was left in place"
      StrCpy $RidgelineOldDir ""
      StrCpy $RidgelineOldRun ""
      MessageBox MB_OK|MB_ICONEXCLAMATION "The earlier install, Widget Wall 2, could not be removed. Ridgeline will be installed beside it. Afterwards, remove Widget Wall 2 in Windows Settings, Installed apps." /SD IDOK
    ${EndIf}
  ${EndIf}

  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; A sign-in Run entry that pointed exactly at the old exe moves to the new name and folder.
  ; Anything else in that value (extra arguments, another program) is left alone. This app
  ; creates no Run entry itself.
  ${If} $RidgelineOldDir != ""
  ${AndIf} $RidgelineOldRun != ""
  ${AndIf} $RidgelineOldRun == "$\"$RidgelineOldDir\${MAINBINARYNAME}.exe$\""
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\""
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Widget Wall 2"
  ${EndIf}
!macroend
