; Keep the original Windows NSIS install identity stable and still
; recognize the accidental rebrand-era uninstall key during upgrades.
!macro customHeader
  !define UNINSTALL_REGISTRY_KEY_2 "Software\Microsoft\Windows\CurrentVersion\Uninstall\5c9787f2-bfa8-5f80-8d17-445ff5a63dd3"
!macroend
