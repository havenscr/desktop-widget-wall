//! Wall 2 window placement: fill the Corsair Xeneon Edge strip (2560 by 720
//! physical pixels) edge to edge. Everything is in physical pixels, straight
//! from the Win32 monitor list, so no display scale can skew the rectangle.
//!
//! Placement goes through Win32 on the window handle, not through tao: a move
//! onto a monitor with a different display scale makes Windows send
//! WM_DPICHANGED, and tao answers with its own SetWindowPos that can undo the
//! placement. `apply` moves, sets the full rectangle, verifies and retries; a
//! subclass re-applies the target after every DPI change; a log records each
//! step (`wall2-placement.log`, never the path, user or host names).

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MonitorRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

pub const STRIP_WIDTH: u32 = 2560;
pub const STRIP_HEIGHT: u32 = 720;

/// The first monitor that is exactly 2560 by 720.
pub fn exact_strip(monitors: &[MonitorRect]) -> Option<MonitorRect> {
    monitors
        .iter()
        .copied()
        .find(|m| m.width == STRIP_WIDTH && m.height == STRIP_HEIGHT)
}

/// Startup choice: an exact strip, else the monitor with the smallest height
/// (ties go to the first), else the primary monitor, else nothing.
pub fn startup_target(
    monitors: &[MonitorRect],
    primary: Option<MonitorRect>,
) -> Option<MonitorRect> {
    if let Some(strip) = exact_strip(monitors) {
        return Some(strip);
    }
    let mut smallest: Option<MonitorRect> = None;
    for m in monitors {
        match smallest {
            Some(best) if best.height <= m.height => {}
            _ => smallest = Some(*m),
        }
    }
    smallest.or(primary)
}

/// Target and reason in one place: an exact strip, else the smallest height,
/// else the primary monitor (only when the list is empty), else nothing.
pub fn choose_target(
    monitors: &[MonitorRect],
    primary: Option<MonitorRect>,
) -> (Option<MonitorRect>, &'static str) {
    if let Some(strip) = exact_strip(monitors) {
        return (Some(strip), "exact strip");
    }
    if !monitors.is_empty() {
        return (startup_target(monitors, primary), "smallest height");
    }
    match primary {
        Some(p) => (Some(p), "primary"),
        None => (None, "none"),
    }
}

/// True when `target` lies entirely inside one of the monitors.
pub fn target_on_monitor(target: MonitorRect, monitors: &[MonitorRect]) -> bool {
    monitors.iter().any(|m| {
        target.x >= m.x
            && target.y >= m.y
            && i64::from(target.x) + i64::from(target.width) <= i64::from(m.x) + i64::from(m.width)
            && i64::from(target.y) + i64::from(target.height) <= i64::from(m.y) + i64::from(m.height)
    })
}

/// After a display change with no exact strip present: clear the stored target
/// only when one was actually read (`Some`) and it lies on no current monitor.
/// `None` means nothing stored or a contended lock, and is left alone.
pub fn should_clear_target(read: Option<MonitorRect>, monitors: &[MonitorRect]) -> bool {
    read.is_some_and(|t| !target_on_monitor(t, monitors))
}

/// True when two rectangles are identical.
pub fn rect_matches(a: MonitorRect, b: MonitorRect) -> bool {
    a == b
}

/// How many times `apply` is tried before giving up.
pub const MAX_ATTEMPTS: u32 = 3;

/// Another attempt is made when the rect is wrong and attempts remain.
/// `attempt` counts attempts already made.
pub fn needs_retry(matched: bool, attempt: u32, max: u32) -> bool {
    !matched && attempt < max
}

/// One log line: milliseconds since start, step, data. Control characters in
/// the data become spaces so a line is always one line.
pub fn format_line(ms: u128, step: &str, data: &str) -> String {
    let clean: String = data
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    format!("{ms:>7} {step:<14} {clean}\n")
}

const LOG_CAP: usize = 256 * 1024;
const EVENT_CAP: usize = 300;
const EVENT_WINDOW_MS: u128 = 30_000;

static START: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
static LOG_TX: std::sync::OnceLock<std::sync::mpsc::SyncSender<String>> = std::sync::OnceLock::new();
static EVENTS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// Create (truncate) the log in `dir` and start the writer thread. Any
/// failure leaves logging off. All file writes happen on that thread, so no
/// caller (the window procedure included) ever waits on the disk.
pub fn start_log(dir: Option<std::path::PathBuf>) {
    use std::io::Write;
    let Some(dir) = dir else { return };
    let _ = std::fs::create_dir_all(&dir);
    let Ok(mut file) = std::fs::File::create(dir.join("wall2-placement.log")) else {
        return;
    };
    let (tx, rx) = std::sync::mpsc::sync_channel::<String>(512);
    let spawned = std::thread::Builder::new().name("wall2-log".into()).spawn(move || {
        let mut bytes = 0usize;
        while let Ok(line) = rx.recv() {
            if bytes + line.len() > LOG_CAP {
                continue;
            }
            if file.write_all(line.as_bytes()).is_ok() {
                bytes += line.len();
            }
        }
    });
    if spawned.is_ok() {
        let _ = START.set(std::time::Instant::now());
        let _ = LOG_TX.set(tx);
    }
}

/// Queue a line. Never blocks (a full queue drops the line), never panics,
/// never reports errors.
pub fn log(step: &str, data: &str) {
    let (Some(tx), Some(start)) = (LOG_TX.get(), START.get()) else { return };
    let _ = tx.try_send(format_line(start.elapsed().as_millis(), step, data));
}

fn log_age_ms() -> u128 {
    START.get().map(|s| s.elapsed().as_millis()).unwrap_or(u128::MAX)
}

/// Log a Wall 2 window event during the first 30 seconds, capped per run.
pub fn log_event(step: &str, data: &str) {
    use std::sync::atomic::Ordering;
    if log_age_ms() > EVENT_WINDOW_MS || EVENTS.fetch_add(1, Ordering::SeqCst) >= EVENT_CAP {
        return;
    }
    log(step, data);
}

#[cfg(windows)]
pub use win::{delayed_checks, follow_strip, install_guard, log_window_event, startup};

#[cfg(windows)]
mod win {
    use super::*;
    use std::cell::Cell;
    use std::sync::Mutex;
    use tauri::Manager;
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, LRESULT, RECT, TRUE, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW,
    };
    use windows::Win32::UI::HiDpi::{
        GetAwarenessFromDpiAwarenessContext, GetDpiForMonitor, GetDpiForWindow,
        GetThreadDpiAwarenessContext, MDT_EFFECTIVE_DPI,
    };
    use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClientRect, GetWindowRect, IsWindowVisible, SetWindowPos, SWP_NOACTIVATE, SWP_NOSIZE,
        SWP_NOZORDER, WM_DPICHANGED, WM_NCDESTROY,
    };

    /// Own subclass id, separate from display_watch.rs.
    const GUARD_ID: usize = 0x5732_4750; // "W2GP"

    static TARGET: Mutex<Option<MonitorRect>> = Mutex::new(None);

    thread_local! {
        static IN_GUARD: Cell<bool> = const { Cell::new(false) };
    }

    #[repr(C)]
    struct OsVersionInfo {
        size: u32,
        major: u32,
        minor: u32,
        build: u32,
        platform: u32,
        csd: [u16; 128],
    }

    #[link(name = "ntdll")]
    extern "system" {
        fn RtlGetVersion(info: *mut OsVersionInfo) -> i32;
    }

    fn windows_build() -> u32 {
        let mut info = OsVersionInfo {
            size: std::mem::size_of::<OsVersionInfo>() as u32,
            major: 0,
            minor: 0,
            build: 0,
            platform: 0,
            csd: [0; 128],
        };
        let status = unsafe { RtlGetVersion(&mut info) };
        if status == 0 { info.build } else { 0 }
    }

    #[derive(Clone, Debug)]
    struct Display {
        name: String,
        rect: MonitorRect,
        work: MonitorRect,
        dpi: u32,
        primary: bool,
    }

    fn to_rect(r: RECT) -> MonitorRect {
        MonitorRect {
            x: r.left,
            y: r.top,
            width: (r.right - r.left).max(0) as u32,
            height: (r.bottom - r.top).max(0) as u32,
        }
    }

    unsafe extern "system" fn enum_proc(
        monitor: HMONITOR,
        _hdc: HDC,
        _rect: *mut RECT,
        data: LPARAM,
    ) -> BOOL {
        let list = &mut *(data.0 as *mut Vec<Display>);
        let mut info: MONITORINFOEXW = std::mem::zeroed();
        info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
        if GetMonitorInfoW(monitor, &mut info as *mut MONITORINFOEXW as *mut MONITORINFO).as_bool() {
            let (mut dx, mut dy) = (0u32, 0u32);
            let dpi = match GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dx, &mut dy) {
                Ok(()) => dx,
                Err(_) => 0,
            };
            let end = info.szDevice.iter().position(|&c| c == 0).unwrap_or(info.szDevice.len());
            list.push(Display {
                name: String::from_utf16_lossy(&info.szDevice[..end]),
                rect: to_rect(info.monitorInfo.rcMonitor),
                work: to_rect(info.monitorInfo.rcWork),
                dpi,
                primary: info.monitorInfo.dwFlags & 1 != 0,
            });
        }
        TRUE
    }

    fn displays() -> Vec<Display> {
        let mut list: Vec<Display> = Vec::new();
        unsafe {
            let _ = EnumDisplayMonitors(
                HDC::default(),
                None,
                Some(enum_proc),
                LPARAM(&mut list as *mut Vec<Display> as isize),
            );
        }
        list
    }

    fn set_target(rect: Option<MonitorRect>) {
        if let Ok(mut t) = TARGET.lock() {
            *t = rect;
        }
    }

    fn get_target() -> Option<MonitorRect> {
        TARGET.try_lock().ok().and_then(|t| *t)
    }

    fn window_rect(hwnd: HWND) -> Option<MonitorRect> {
        let mut r = RECT::default();
        unsafe { GetWindowRect(hwnd, &mut r).ok()? };
        Some(to_rect(r))
    }

    fn state(hwnd: HWND, scale: Option<f64>) -> String {
        let rect = window_rect(hwnd);
        let mut c = RECT::default();
        let client = unsafe { GetClientRect(hwnd, &mut c) }.ok().map(|_| to_rect(c));
        let dpi = unsafe { GetDpiForWindow(hwnd) };
        let visible = unsafe { IsWindowVisible(hwnd) }.as_bool();
        format!(
            "rect={} client={} dpi={} scale={:?} visible={}",
            rect.map(fmt_rect).unwrap_or_else(|| "?".into()),
            client.map(|c| format!("{}x{}", c.width, c.height)).unwrap_or_else(|| "?".into()),
            dpi,
            scale,
            visible
        )
    }

    fn fmt_rect(r: MonitorRect) -> String {
        format!("{},{} {}x{}", r.x, r.y, r.width, r.height)
    }

    fn hwnd_of(window: &tauri::WebviewWindow) -> Option<HWND> {
        window.hwnd().ok().map(|h| HWND(h.0))
    }

    fn log_state(step: &str, window: &tauri::WebviewWindow) {
        if let Some(hwnd) = hwnd_of(window) {
            log(step, &state(hwnd, window.scale_factor().ok()));
        }
    }

    /// Move onto the target monitor (so the DPI change happens now), set the
    /// full rect, and report whether the window now sits exactly on it.
    fn apply(hwnd: HWND, rect: MonitorRect) -> bool {
        unsafe {
            let _ = SetWindowPos(
                hwnd,
                HWND::default(),
                rect.x,
                rect.y,
                0,
                0,
                SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
            );
            let _ = SetWindowPos(
                hwnd,
                HWND::default(),
                rect.x,
                rect.y,
                rect.width as i32,
                rect.height as i32,
                SWP_NOZORDER | SWP_NOACTIVATE,
            );
        }
        window_rect(hwnd).map(|r| rect_matches(r, rect)).unwrap_or(false)
    }

    /// `apply` with verification: up to MAX_ATTEMPTS tries, each logged.
    fn place(window: &tauri::WebviewWindow, rect: MonitorRect, why: &str) -> bool {
        let Some(hwnd) = hwnd_of(window) else { return false };
        let mut attempt = 0;
        loop {
            attempt += 1;
            let matched = apply(hwnd, rect);
            log(
                "apply",
                &format!("{why} attempt={attempt} matched={matched} {}", state(hwnd, window.scale_factor().ok())),
            );
            if !needs_retry(matched, attempt, MAX_ATTEMPTS) {
                return matched;
            }
        }
    }

    /// Startup: log the environment, choose the target, place hidden, show,
    /// place again.
    pub fn startup(window: &tauri::WebviewWindow) {
        log(
            "start",
            &format!(
                "windows_build={} dpi_awareness={}",
                windows_build(),
                unsafe { GetAwarenessFromDpiAwarenessContext(GetThreadDpiAwarenessContext()).0 }
            ),
        );
        let list = displays();
        for d in &list {
            log(
                "monitor",
                &format!(
                    "{} pos={},{} size={}x{} work={} dpi={} scale={:.2} primary={}",
                    d.name,
                    d.rect.x,
                    d.rect.y,
                    d.rect.width,
                    d.rect.height,
                    fmt_rect(d.work),
                    d.dpi,
                    d.dpi as f64 / 96.0,
                    d.primary
                ),
            );
        }
        let rects: Vec<MonitorRect> = list.iter().map(|d| d.rect).collect();
        let primary = list.iter().find(|d| d.primary).map(|d| d.rect);
        let (target, why) = choose_target(&rects, primary);
        log("target", &format!("{} reason={why}", target.map(fmt_rect).unwrap_or_else(|| "none".into())));
        log_state("before_place", window);
        let Some(rect) = target.filter(|_| hwnd_of(window).is_some()) else {
            // Show anyway, so Wall 2 is never left hidden.
            log("skipped", "no target monitor or window handle, showing in place");
            let _ = window.show();
            log_state("after_show", window);
            return;
        };
        set_target(Some(rect));
        place(window, rect, "hidden");
        let _ = window.show();
        log_state("after_show", window);
        place(window, rect, "visible");
    }

    /// After a display change: move onto an exact strip if one is present;
    /// with none, keep the stored target while it still lies on a current
    /// monitor and clear it only when it is off every one (its coordinates
    /// are off screen), and do nothing else, never jumping to the main
    /// monitor on unplug.
    /// Returns true only after the move ran on the main thread and the rect
    /// was verified, so the caller keeps retrying otherwise.
    pub fn follow_strip(app: &tauri::AppHandle, label: &str) -> bool {
        let rects: Vec<MonitorRect> = displays().iter().map(|d| d.rect).collect();
        let found = exact_strip(&rects);
        log(
            "displays_changed",
            &format!("monitors={} exact_strip={}", rects.len(), found.map(fmt_rect).unwrap_or_else(|| "none".into())),
        );
        let Some(rect) = found else {
            let clear = should_clear_target(get_target(), &rects);
            if clear {
                set_target(None);
            }
            log("target_kept", if clear { "cleared" } else { "kept" });
            return false;
        };
        set_target(Some(rect));
        let (tx, rx) = std::sync::mpsc::channel::<bool>();
        let handle = app.clone();
        let label = label.to_string();
        let queued = app.run_on_main_thread(move || {
            let ok = handle
                .get_webview_window(&label)
                .map(|window| check_and_place(&window, "follow_strip"))
                .unwrap_or(false);
            let _ = tx.send(ok);
        });
        queued.is_ok() && rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap_or(false)
    }

    /// Re-apply only when the window is not on the stored target and the
    /// target still lies on a current monitor. Returns whether the window
    /// ends on the target.
    fn check_and_place(window: &tauri::WebviewWindow, why: &str) -> bool {
        let Some(hwnd) = hwnd_of(window) else { return false };
        let Some(rect) = get_target() else { return false };
        let current = window_rect(hwnd);
        let ok = current.map(|c| rect_matches(c, rect)).unwrap_or(false);
        log(why, &format!("rect_ok={ok} {}", state(hwnd, window.scale_factor().ok())));
        if ok {
            return true;
        }
        let rects: Vec<MonitorRect> = displays().iter().map(|d| d.rect).collect();
        if !target_on_monitor(rect, &rects) {
            log(why, "target is off every monitor, not moving");
            return false;
        }
        place(window, rect, why)
    }

    /// Re-check at about 250 ms, 1 s and 3 s after startup.
    pub fn delayed_checks(app: &tauri::AppHandle, label: &str) {
        let app = app.clone();
        let label = label.to_string();
        let _ = std::thread::Builder::new().name("wall2-checks".into()).spawn(move || {
            let mut elapsed = 0u64;
            for at in [250u64, 1000, 3000] {
                std::thread::sleep(std::time::Duration::from_millis(at - elapsed));
                elapsed = at;
                let handle = app.clone();
                let label = label.clone();
                let _ = app.run_on_main_thread(move || {
                    if let Some(window) = handle.get_webview_window(&label) {
                        check_and_place(&window, &format!("check_{at}ms"));
                    }
                });
            }
        });
    }

    /// Log a Wall 2 Moved, Resized or ScaleFactorChanged event.
    pub fn log_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
        let name = match event {
            tauri::WindowEvent::Moved(_) => "moved",
            tauri::WindowEvent::Resized(_) => "resized",
            tauri::WindowEvent::ScaleFactorChanged { .. } => "scale_changed",
            _ => return,
        };
        let data = match (window.hwnd(), event) {
            (Ok(h), tauri::WindowEvent::ScaleFactorChanged { scale_factor, .. }) => {
                format!("new_scale={scale_factor:.2} {}", state(HWND(h.0), None))
            }
            (Ok(h), _) => state(HWND(h.0), None),
            _ => String::new(),
        };
        log_event(name, &data);
    }

    /// Subclass the Wall 2 window so a DPI change cannot undo the placement.
    /// Installed after tao's own handling, so it runs first and lets the
    /// default procedure (tao) finish before re-applying the target.
    pub fn install_guard(window: &tauri::WebviewWindow) {
        let Some(hwnd) = hwnd_of(window) else {
            log("guard", "no window handle");
            return;
        };
        let ok = unsafe { SetWindowSubclass(hwnd, Some(guard_proc), GUARD_ID, 0).as_bool() };
        log("guard", &format!("installed={ok}"));
    }

    unsafe extern "system" fn guard_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _data: usize,
    ) -> LRESULT {
        if msg == WM_DPICHANGED {
            // Set the flag before the default handling, so a WM_DPICHANGED
            // that tao's own SetWindowPos provokes gets default processing only.
            if IN_GUARD.with(|g| g.replace(true)) {
                return DefSubclassProc(hwnd, msg, wparam, lparam);
            }
            let new_dpi = wparam.0 & 0xFFFF;
            let suggested = if lparam.0 != 0 {
                Some(to_rect(*(lparam.0 as *const RECT)))
            } else {
                None
            };
            let result = DefSubclassProc(hwnd, msg, wparam, lparam);
            if let Some(rect) = get_target() {
                let after_tao = window_rect(hwnd);
                // Only reassert onto a rect that is still on a current monitor.
                let rects: Vec<MonitorRect> = displays().iter().map(|d| d.rect).collect();
                let on_screen = target_on_monitor(rect, &rects);
                if on_screen {
                    let _ = SetWindowPos(
                        hwnd,
                        HWND::default(),
                        rect.x,
                        rect.y,
                        rect.width as i32,
                        rect.height as i32,
                        SWP_NOZORDER | SWP_NOACTIVATE,
                    );
                }
                log(
                    "dpi_changed",
                    &format!(
                        "new_dpi={new_dpi} suggested={} after_tao={} reasserted={on_screen} after_reassert={}",
                        suggested.map(fmt_rect).unwrap_or_else(|| "?".into()),
                        after_tao.map(fmt_rect).unwrap_or_else(|| "?".into()),
                        window_rect(hwnd).map(fmt_rect).unwrap_or_else(|| "?".into())
                    ),
                );
            }
            IN_GUARD.with(|g| g.set(false));
            return result;
        }
        let result = DefSubclassProc(hwnd, msg, wparam, lparam);
        if msg == WM_NCDESTROY {
            // The window is going away: remove this subclass (same callback
            // and id as installed) after default processing, as the
            // subclassing contract asks.
            let _ = RemoveWindowSubclass(hwnd, Some(guard_proc), GUARD_ID);
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(x: i32, w: u32, h: u32) -> MonitorRect {
        MonitorRect { x, y: 0, width: w, height: h }
    }

    #[test]
    fn exact_strip_beats_smaller_height() {
        let list = [r(0, 1920, 600), r(1920, 2560, 720)];
        assert_eq!(startup_target(&list, None), Some(list[1]));
    }

    #[test]
    fn two_exact_strips_pick_first() {
        let list = [r(0, 2560, 720), r(2560, 2560, 720)];
        assert_eq!(exact_strip(&list), Some(list[0]));
    }

    #[test]
    fn no_exact_strip_picks_smallest_height() {
        let list = [r(0, 2560, 1440), r(2560, 1920, 1080), r(4480, 1280, 1080)];
        assert_eq!(startup_target(&list, None), Some(list[1]));
    }

    #[test]
    fn rotated_and_taller_are_not_exact() {
        let list = [r(0, 720, 2560), r(720, 2560, 1440)];
        assert_eq!(exact_strip(&list), None);
    }

    #[test]
    fn tie_on_smallest_height_picks_first() {
        let list = [r(0, 1920, 1080), r(1920, 1280, 1080)];
        assert_eq!(startup_target(&list, None), Some(list[0]));
    }

    #[test]
    fn non_empty_list_never_uses_primary() {
        let list = [r(0, 1920, 1080), r(1920, 1280, 1080)];
        let primary = r(5000, 800, 600);
        assert_eq!(startup_target(&list, Some(primary)), Some(list[0]));
    }

    #[test]
    fn empty_list_falls_back_to_primary() {
        let primary = r(0, 1920, 1080);
        assert_eq!(startup_target(&[], Some(primary)), Some(primary));
    }

    #[test]
    fn empty_and_no_primary_is_none() {
        assert_eq!(startup_target(&[], None), None);
    }

    #[test]
    fn rect_matching_is_exact() {
        assert!(rect_matches(r(0, 2560, 720), r(0, 2560, 720)));
        assert!(!rect_matches(r(0, 2560, 720), r(1, 2560, 720)));
        assert!(!rect_matches(r(0, 2560, 720), r(0, 3200, 900)));
    }

    #[test]
    fn retry_only_when_wrong_and_attempts_remain() {
        assert!(!needs_retry(true, 1, 3));
        assert!(needs_retry(false, 1, 3));
        assert!(needs_retry(false, 2, 3));
        assert!(!needs_retry(false, 3, 3));
    }

    #[test]
    fn log_line_is_one_clean_line() {
        let line = format_line(42, "apply", "a\nb\tc");
        assert_eq!(line.matches('\n').count(), 1);
        assert!(line.ends_with("a b c\n"));
        assert!(line.contains("apply"));
        assert!(line.trim_start().starts_with("42 "));
    }

    #[test]
    fn choose_target_cases() {
        let strip = r(2560, 2560, 720);
        let main = r(0, 2560, 1440);
        let p = r(9000, 800, 600);
        assert_eq!(choose_target(&[main, strip], Some(main)), (Some(strip), "exact strip"));
        let a = r(0, 2560, 1440);
        let b = r(2560, 1920, 1080);
        assert_eq!(choose_target(&[a, b], Some(a)), (Some(b), "smallest height"));
        assert_eq!(choose_target(&[], Some(p)), (Some(p), "primary"));
        assert_eq!(choose_target(&[], None), (None, "none"));
    }

    #[test]
    fn display_change_clears_target_only_when_read_and_off_every_monitor() {
        let main = r(0, 2560, 1440);
        let strip = MonitorRect { x: 0, y: 1440, width: 2560, height: 720 };
        // Still on a monitor: kept, even with no exact strip in the list.
        assert!(!should_clear_target(Some(main), &[main]));
        assert!(!should_clear_target(Some(strip), &[main, strip]));
        // Read and gone: cleared.
        assert!(should_clear_target(Some(strip), &[main]));
        assert!(should_clear_target(Some(strip), &[]));
        // Nothing read (no target, or a contended lock): left alone.
        assert!(!should_clear_target(None, &[main]));
        assert!(!should_clear_target(None, &[]));
    }

    #[test]
    fn target_must_lie_on_a_monitor() {
        let main = r(0, 2560, 1440);
        let strip = MonitorRect { x: 0, y: 1440, width: 2560, height: 720 };
        assert!(target_on_monitor(strip, &[main, strip]));
        assert!(!target_on_monitor(strip, &[main]));
        assert!(!target_on_monitor(strip, &[]));
        assert!(target_on_monitor(main, &[main]));
    }
}
