//! Shared helpers for the two Wall 2 modules that act on other programs' windows
//! (`wall2_arrange.rs` and `wall2_keys.rs`).
//!
//! Everything that decides something is a pure function with a test. The Win32 calls sit in
//! the small `sys` module, compiled on Windows only. Nothing here logs, and no window title
//! is ever read into a string: a title is only tested for being empty.

use std::sync::atomic::{AtomicBool, Ordering};

/// Proof that this caller holds a one-at-a-time flag. Dropping it releases the flag, also
/// when the thread panics.
pub(crate) struct Busy<'a> {
    flag: &'a AtomicBool,
}

impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.flag.store(false, Ordering::Release);
    }
}

/// Take the flag if it is free. None while another guard on the same flag is alive.
pub(crate) fn try_begin(flag: &AtomicBool) -> Option<Busy<'_>> {
    flag.compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed).ok().map(|_| Busy { flag })
}

/// The file part of an image path, lower case: `C:\Apps\PBIDesktop.exe` gives
/// `pbidesktop.exe`. Both slash kinds count as separators.
pub(crate) fn exe_file_part(path: &str) -> String {
    let end = path.rsplit(['\\', '/']).next().unwrap_or("");
    end.trim().to_lowercase()
}

/// True when the image path's file part equals the wanted executable name, ignoring case.
/// An empty name never matches.
pub(crate) fn exe_matches(image_path: &str, wanted: &str) -> bool {
    let want = wanted.trim().to_lowercase();
    !want.is_empty() && exe_file_part(image_path) == want
}

/// Whether a process is one the wall may not type into: it is elevated, or it cannot be
/// inspected (`None`: a process that refuses a token read to a non-elevated caller is an
/// elevated one). Keys use this whatever the wall's own level, so an elevated wall never
/// types a chord into an administrator window.
pub(crate) fn blocks_keys(target_elevated: Option<bool>) -> bool {
    target_elevated != Some(false)
}

/// Whether a window cannot be moved from here: only a non-elevated wall is blocked by an
/// elevated program (an elevated wall may move anything, which gains nothing).
pub(crate) fn blocks_move(target_elevated: Option<bool>, self_elevated: bool) -> bool {
    !self_elevated && blocks_keys(target_elevated)
}

/// Window classes of the desktop shell: the taskbars, the desktop and its worker windows.
/// These are never arranged and never remembered as "the app in front".
pub(crate) fn is_shell_class(class: &str) -> bool {
    matches!(class, "Shell_TrayWnd" | "Shell_SecondaryTrayWnd" | "Progman" | "WorkerW" | "Windows.UI.Core.CoreWindow")
}

/// A screen rectangle, edges in pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl Rect {
    pub fn width(&self) -> i32 {
        self.right - self.left
    }
    pub fn height(&self) -> i32 {
        self.bottom - self.top
    }
}

#[cfg(windows)]
pub(crate) mod sys {
    use std::ffi::c_void;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, BOOL, HANDLE, HWND, LPARAM, TRUE};
    use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
    use windows::Win32::System::Threading::{
        GetCurrentProcess, OpenProcess, OpenProcessToken, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetWindowThreadProcessId, InternalGetWindowText,
    };

    pub fn hwnd(h: isize) -> HWND {
        HWND(h as *mut c_void)
    }

    unsafe extern "system" fn collect(h: HWND, data: LPARAM) -> BOOL {
        let list = &mut *(data.0 as *mut Vec<isize>);
        list.push(h.0 as isize);
        TRUE
    }

    /// Every top-level window, topmost first (the order `EnumWindows` gives).
    pub fn top_level_windows() -> Vec<isize> {
        let mut list: Vec<isize> = Vec::new();
        unsafe {
            let _ = EnumWindows(Some(collect), LPARAM(&mut list as *mut Vec<isize> as isize));
        }
        list
    }

    pub fn pid_of(h: isize) -> u32 {
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd(h), Some(&mut pid as *mut u32)) };
        pid
    }

    /// The full image path of a process, or None when it cannot be read.
    pub fn image_path(pid: u32) -> Option<String> {
        if pid == 0 {
            return None;
        }
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let read = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
            let _ = CloseHandle(handle);
            let len = (len as usize).min(buf.len());
            (read.is_ok() && len > 0).then(|| String::from_utf16_lossy(&buf[..len]))
        }
    }

    pub fn class_name(h: isize) -> String {
        let mut buf = [0u16; 128];
        let n = unsafe { GetClassNameW(hwnd(h), &mut buf) };
        let n = (n.max(0) as usize).min(buf.len());
        String::from_utf16_lossy(&buf[..n])
    }

    /// Whether a window has any title, read from the window's own record. It never sends a
    /// message to the window, so a window that stops answering cannot block this read.
    pub fn has_title(h: isize) -> bool {
        let mut buf = [0u16; 4];
        unsafe { InternalGetWindowText(hwnd(h), &mut buf) > 0 }
    }

    fn token_elevated(process: HANDLE) -> Option<bool> {
        unsafe {
            let mut token = HANDLE::default();
            OpenProcessToken(process, TOKEN_QUERY, &mut token).ok()?;
            let mut info = TOKEN_ELEVATION::default();
            let mut returned = 0u32;
            let got = GetTokenInformation(
                token,
                TokenElevation,
                Some(&mut info as *mut TOKEN_ELEVATION as *mut c_void),
                std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                &mut returned,
            );
            let _ = CloseHandle(token);
            got.ok().map(|_| info.TokenIsElevated != 0)
        }
    }

    /// Whether this app runs elevated.
    pub fn self_elevated() -> bool {
        token_elevated(unsafe { GetCurrentProcess() }).unwrap_or(false)
    }

    /// True when a window of this process cannot be moved or typed into from here: this app
    /// is not elevated and the process is elevated or cannot be inspected (a process that
    /// refuses a token read to a non-elevated caller is an elevated one).
    pub fn out_of_reach(pid: u32, self_elevated: bool) -> bool {
        if self_elevated || pid == 0 {
            return false;
        }
        super::blocks_move(target_token(pid), self_elevated)
    }

    /// Whether Keys must refuse this process, whatever the wall's own level.
    pub fn keys_blocked(pid: u32) -> bool {
        pid == 0 || super::blocks_keys(target_token(pid))
    }

    /// The target's elevation, or None when it cannot be opened or read.
    fn target_token(pid: u32) -> Option<bool> {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let elevated = token_elevated(handle);
            let _ = CloseHandle(handle);
            elevated
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_part_is_lower_case_and_ignores_the_folder() {
        assert_eq!(exe_file_part(r"C:\Program Files\Microsoft Power BI Desktop\bin\PBIDesktop.exe"), "pbidesktop.exe");
        assert_eq!(exe_file_part("C:/Apps/Tool.EXE"), "tool.exe");
        assert_eq!(exe_file_part("plain.exe"), "plain.exe");
        assert_eq!(exe_file_part(""), "");
    }

    #[test]
    fn exe_match_compares_the_whole_file_part() {
        assert!(exe_matches(r"C:\x\PBIDesktop.exe", "pbidesktop.exe"));
        assert!(exe_matches(r"C:\x\pbidesktop.exe", " PBIDesktop.exe "));
        // A longer or shorter name is not a match.
        assert!(!exe_matches(r"C:\x\PBIDesktop2.exe", "PBIDesktop.exe"));
        assert!(!exe_matches(r"C:\x\xPBIDesktop.exe", "PBIDesktop.exe"));
        assert!(!exe_matches(r"C:\x\PBIDesktop.exe", ""));
        assert!(!exe_matches("", ""));
        // A folder named like the wanted file does not count.
        assert!(!exe_matches(r"C:\PBIDesktop.exe\other.exe", "PBIDesktop.exe"));
    }

    #[test]
    fn shell_classes() {
        for c in ["Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Progman", "WorkerW"] {
            assert!(is_shell_class(c), "{c}");
        }
        assert!(!is_shell_class("Chrome_WidgetWin_1"));
        assert!(!is_shell_class(""));
    }

    #[test]
    fn one_at_a_time_and_a_panic_releases_the_flag() {
        let flag = AtomicBool::new(false);
        let first = try_begin(&flag).expect("free at first");
        assert!(try_begin(&flag).is_none());
        drop(first);
        let again = try_begin(&flag).expect("free after the guard is dropped");
        assert!(try_begin(&flag).is_none());
        drop(again);
        assert!(!flag.load(Ordering::Acquire));

        static FLAG: AtomicBool = AtomicBool::new(false);
        let guard = try_begin(&FLAG).expect("free");
        let joined = std::thread::spawn(move || {
            let _guard = guard;
            panic!("step failed");
        })
        .join();
        assert!(joined.is_err());
        assert!(try_begin(&FLAG).is_some());
    }

    #[test]
    fn keys_refuse_an_elevated_or_unreadable_target_whatever_the_walls_own_level() {
        assert!(blocks_keys(Some(true)), "elevated target");
        assert!(blocks_keys(None), "unreadable target counts as elevated");
        assert!(!blocks_keys(Some(false)));
    }

    #[test]
    fn moving_is_blocked_only_for_a_non_elevated_wall() {
        assert!(blocks_move(Some(true), false));
        assert!(blocks_move(None, false));
        assert!(!blocks_move(Some(false), false));
        // An elevated wall may move anything (Big screen only), but Keys still refuse it.
        assert!(!blocks_move(Some(true), true));
        assert!(blocks_keys(Some(true)));
    }

    #[test]
    fn rect_sizes() {
        let r = Rect { left: 10, top: 20, right: 110, bottom: 70 };
        assert_eq!((r.width(), r.height()), (100, 50));
    }
}
