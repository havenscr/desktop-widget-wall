/*
  ========================================================================
  WIDGET WALL DESKTOP - Session lock and display power watcher
  Copyright (c) 2024-2025 Havens Consulting Inc. All Rights Reserved.
  Fingerprint: AE-WWD-9F7C3E2A | analyticendeavors.com
  ========================================================================

  An always-on-top wall is almost never minimized, so tray-hide and minimize
  alone never put it to sleep: overnight the WebView kept rendering behind the
  lock screen and the dark monitors. This subclasses the main window to hear
  WM_WTSSESSION_CHANGE (lock / unlock, fast user switch and remote desktop
  connect / disconnect) and WM_POWERBROADCAST with
  GUID_CONSOLE_DISPLAY_STATE (display off / on / dimmed), records the state in
  atomics, and hands each change to a callback that runs off the window
  procedure.

  A subclass of the existing window was chosen over a hidden message-only
  window: both notifications are documented for top-level windows, and the
  subclass needs no extra thread or window class.
*/

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use windows::Win32::Foundation::{HANDLE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Power::{RegisterPowerSettingNotification, POWERBROADCAST_SETTING};
use windows::Win32::System::RemoteDesktop::{WTSRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION};
use windows::Win32::System::SystemServices::GUID_CONSOLE_DISPLAY_STATE;
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    DEVICE_NOTIFY_WINDOW_HANDLE, PBT_POWERSETTINGCHANGE, WM_POWERBROADCAST, WM_WTSSESSION_CHANGE,
    WTS_CONSOLE_CONNECT, WTS_CONSOLE_DISCONNECT, WTS_REMOTE_CONNECT,
    WTS_SESSION_LOCK, WTS_SESSION_UNLOCK,
};

static SESSION_LOCKED: AtomicBool = AtomicBool::new(false);
/// The physical console no longer shows this session: a fast user switch
/// (console disconnect) or a remote desktop connection took it over.
static SESSION_AWAY: AtomicBool = AtomicBool::new(false);
static DISPLAY_OFF: AtomicBool = AtomicBool::new(false);
static ON_CHANGE: OnceLock<fn()> = OnceLock::new();

const SUBCLASS_ID: usize = 0x5757_4453; // "WWDS"

/// True while Windows is locked, the console shows another session, or every
/// console display is off.
pub fn os_hidden() -> bool {
    os_hidden_reason().is_some()
}

/// Why the OS is hiding the wall, for the `display-state` event. Lock wins
/// when several hold, since unlocking is what the user will do first.
pub fn os_hidden_reason() -> Option<&'static str> {
    hidden_reason(
        SESSION_LOCKED.load(Ordering::SeqCst),
        SESSION_AWAY.load(Ordering::SeqCst),
        DISPLAY_OFF.load(Ordering::SeqCst),
    )
}

fn hidden_reason(locked: bool, away: bool, display_off: bool) -> Option<&'static str> {
    if locked {
        Some("lock")
    } else if away {
        Some("disconnected")
    } else if display_off {
        Some("display-off")
    } else {
        None
    }
}

/// Which flag a WM_WTSSESSION_CHANGE code sets, and to what. Remote connect
/// and console disconnect mean the console no longer shows this session;
/// console connect brings it back. Remote disconnect is ignored: the session
/// then shows on no screen, and returning to the console sends console connect.
fn session_change(code: u32) -> Option<(&'static AtomicBool, bool)> {
    match code {
        WTS_SESSION_LOCK => Some((&SESSION_LOCKED, true)),
        WTS_SESSION_UNLOCK => Some((&SESSION_LOCKED, false)),
        WTS_CONSOLE_DISCONNECT | WTS_REMOTE_CONNECT => Some((&SESSION_AWAY, true)),
        WTS_CONSOLE_CONNECT => Some((&SESSION_AWAY, false)),
        _ => None,
    }
}

/// Subclass `hwnd` and register for lock and display notifications.
/// `on_change` runs on the window's thread after a state transition; it must
/// not block. Safe to call once; later calls are ignored.
pub fn install(hwnd: *mut c_void, on_change: fn()) -> Result<(), String> {
    if ON_CHANGE.set(on_change).is_err() {
        return Ok(());
    }
    let hwnd = HWND(hwnd);
    unsafe {
        if !SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0).as_bool() {
            return Err("SetWindowSubclass failed".into());
        }
        WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION)
            .map_err(|e| format!("WTSRegisterSessionNotification: {e}"))?;
        // Windows sends the current display state right after registering, so
        // DISPLAY_OFF is correct from the first message on. The handle lives
        // as long as the window; the registration ends with the process.
        RegisterPowerSettingNotification(
            HANDLE(hwnd.0),
            &GUID_CONSOLE_DISPLAY_STATE,
            DEVICE_NOTIFY_WINDOW_HANDLE,
        )
        .map_err(|e| format!("RegisterPowerSettingNotification: {e}"))?;
    }
    Ok(())
}

unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    match msg {
        WM_WTSSESSION_CHANGE => {
            if let Some((flag, value)) = session_change(wparam.0 as u32) {
                if flag.swap(value, Ordering::SeqCst) != value {
                    notify();
                }
            }
        }
        WM_POWERBROADCAST if wparam.0 as u32 == PBT_POWERSETTINGCHANGE && lparam.0 != 0 => {
            let setting = &*(lparam.0 as *const POWERBROADCAST_SETTING);
            if setting.PowerSetting == GUID_CONSOLE_DISPLAY_STATE && setting.DataLength >= 1 {
                // 0 = off, 1 = on, 2 = dimmed. Dimmed is still visible.
                let off = setting.Data[0] == 0;
                if DISPLAY_OFF.swap(off, Ordering::SeqCst) != off {
                    notify();
                }
            }
        }
        _ => {}
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}

fn notify() {
    if let Some(f) = ON_CHANGE.get() {
        f();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::UI::WindowsAndMessaging::WTS_REMOTE_DISCONNECT;

    #[test]
    fn reason_priority() {
        assert_eq!(hidden_reason(false, false, false), None);
        assert_eq!(hidden_reason(true, true, true), Some("lock"));
        assert_eq!(hidden_reason(false, true, true), Some("disconnected"));
        assert_eq!(hidden_reason(false, false, true), Some("display-off"));
    }

    #[test]
    fn session_codes_map_to_flags() {
        let away = |code| session_change(code).map(|(f, v)| (std::ptr::eq(f, &SESSION_AWAY), v));
        assert_eq!(away(WTS_CONSOLE_DISCONNECT), Some((true, true)));
        assert_eq!(away(WTS_REMOTE_CONNECT), Some((true, true)));
        assert_eq!(away(WTS_CONSOLE_CONNECT), Some((true, false)));
        assert_eq!(away(WTS_REMOTE_DISCONNECT), None);
        assert_eq!(away(WTS_SESSION_LOCK), Some((false, true)));
        assert_eq!(away(WTS_SESSION_UNLOCK), Some((false, false)));
        assert_eq!(away(0), None);
    }
}
