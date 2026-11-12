/*
  ========================================================================
  WIDGET WALL DESKTOP - Wall 2 idle signal and monitors-off mode
  Copyright (c) 2024-2025 Havens Consulting Inc. All Rights Reserved.
  Fingerprint: AE-WWD-9F7C3E2A | analyticendeavors.com
  ========================================================================

  Two jobs, Wall 2 only (the old app's `turn_off_monitors` is untouched):

  1. Idle signal. `GetLastInputInfo` is polled every 2 seconds. The page gets an
     `idle-state` event when idle time crosses 4 minutes and again on the first
     input after that, so video can pause (rule R2) and resume.

  2. Monitors-off mode (rule R3). `wall2_monitors_off` waits 500 ms, sends the
     monitor-off broadcast, then watches raw input (mouse, keyboard, touch,
     delivered even when the window is not focused). If the display comes back
     on and the only input in the following second was small mouse movement
     (a phantom nudge), it sends off again. Any key, click, touch or larger
     movement leaves the mode. At most 20 re-offs an hour.

  This module never takes a wake lock (rule R1): no SetThreadExecutionState,
  no PowerSetRequest. The decision logic is pure and unit tested; the Windows
  calls live in the `sys` module at the bottom.
*/

use std::time::Duration;

/// Idle after this many seconds without input (rule R2).
pub const IDLE_EDGE_SECS: u64 = 240;
/// Wait after the tap before sending off (rule R3).
pub const OFF_DELAY: Duration = Duration::from_millis(500);
/// How long after the display comes back on the input is judged.
pub const SETTLE_MS: u64 = 1000;
/// Display-on shorter than this is a hot-plug blip and is ignored.
pub const BLIP_MAX_MS: u64 = 40;
/// Mouse movement below this many pixels within the settle window counts as a nudge.
pub const NUDGE_MAX_PX: u32 = 30;
/// Re-offs allowed per rolling hour.
pub const REOFF_CAP_PER_HOUR: usize = 20;
const HOUR_MS: u64 = 3_600_000;

/// Seconds since the last input, from two 32-bit tick counts (milliseconds,
/// wrapping every 49 days).
pub fn idle_secs(now_tick: u32, last_input_tick: u32) -> u64 {
    u64::from(now_tick.wrapping_sub(last_input_tick)) / 1000
}

/// The new idle state when it differs from the previous one, otherwise None.
pub fn idle_edge(was_idle: bool, idle_for_secs: u64) -> Option<bool> {
    let idle = idle_for_secs >= IDLE_EDGE_SECS;
    (idle != was_idle).then_some(idle)
}

/// What raw input arrived since the display came on.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct InputSummary {
    pub key: bool,
    pub click: bool,
    pub touch: bool,
    /// Input that could not be classified (read failure, absolute movement).
    pub other: bool,
    /// Summed relative mouse movement in pixels.
    pub move_px: u32,
}

impl InputSummary {
    pub const fn new() -> Self {
        InputSummary { key: false, click: false, touch: false, other: false, move_px: 0 }
    }

    /// Add one relative mouse movement. A diagonal step counts as its longer side.
    pub fn add_move(&mut self, dx: i32, dy: i32) {
        let step = dx.unsigned_abs().max(dy.unsigned_abs());
        self.move_px = self.move_px.saturating_add(step);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LeaveReason {
    Key,
    Click,
    Touch,
    Other,
    LargeMove,
    Cap,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// Send the monitors off again.
    ReOff,
    /// Leave the mode; the displays stay as they are.
    Leave(LeaveReason),
    /// Not a real wake (hot-plug blip); do nothing.
    Ignore,
}

/// A display-on this short is a hot-plug blip.
pub fn is_blip(on_ms: u64) -> bool {
    on_ms <= BLIP_MAX_MS
}

/// How many re-offs happened in the last hour.
pub fn reoffs_in_last_hour(reoffs_ms: &[u64], now_ms: u64) -> usize {
    reoffs_ms.iter().filter(|t| now_ms.saturating_sub(**t) < HOUR_MS).count()
}

/// The re-off rule. `on_ms` is how long the display has been on, `input` what
/// arrived in that time, `reoffs_last_hour` the re-offs already sent.
pub fn decide(on_ms: u64, input: InputSummary, reoffs_last_hour: usize) -> Decision {
    if is_blip(on_ms) {
        return Decision::Ignore;
    }
    if input.key {
        return Decision::Leave(LeaveReason::Key);
    }
    if input.click {
        return Decision::Leave(LeaveReason::Click);
    }
    if input.touch {
        return Decision::Leave(LeaveReason::Touch);
    }
    if input.other {
        return Decision::Leave(LeaveReason::Other);
    }
    if input.move_px >= NUDGE_MAX_PX {
        return Decision::Leave(LeaveReason::LargeMove);
    }
    if reoffs_last_hour >= REOFF_CAP_PER_HOUR {
        return Decision::Leave(LeaveReason::Cap);
    }
    Decision::ReOff
}

const WALL2_LABEL: &str = "wall2";

fn require_wall2(label: &str) -> Result<(), String> {
    if label == WALL2_LABEL {
        Ok(())
    } else {
        Err("forbidden".to_string())
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdleNow {
    pub idle: bool,
    pub idle_secs: u64,
}

/// The page's first read of the idle state; `idle-state` events follow.
#[tauri::command]
pub fn wall2_idle_state(window: tauri::WebviewWindow) -> Result<IdleNow, String> {
    require_wall2(window.label())?;
    #[cfg(windows)]
    {
        let (idle, idle_secs) = idle_state_now();
        Ok(IdleNow { idle, idle_secs })
    }
    #[cfg(not(windows))]
    Ok(IdleNow { idle: false, idle_secs: 0 })
}

/// "Screens off": 500 ms later the monitors go off and the re-off watch starts.
#[tauri::command]
pub fn wall2_monitors_off(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    require_wall2(window.label())?;
    #[cfg(windows)]
    {
        monitors_off(&app);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("monitors off is Windows only".to_string())
    }
}

#[cfg(windows)]
pub use sys::{display_changed, idle_state_now, monitors_off, start_idle_poller};

#[cfg(windows)]
mod sys {
    use super::*;
    use serde::Serialize;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
    use std::sync::{Mutex, OnceLock};
    use std::time::Instant;
    use tauri::{AppHandle, Emitter};
    use windows::core::w;
    use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    use windows::Win32::UI::Input::{
        GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER, RIDEV_INPUTSINK,
        RID_INPUT,
    };
    use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DispatchMessageW, GetMessageW, SendMessageTimeoutW, TranslateMessage, HMENU, HWND_BROADCAST,
        HWND_MESSAGE, MSG, SC_MONITORPOWER, SMTO_ABORTIFHUNG, SMTO_BLOCK, WINDOW_EX_STYLE, WINDOW_STYLE, WM_INPUT,
        WM_SYSCOMMAND,
    };

    const POLL: Duration = Duration::from_secs(2);
    const SUBCLASS_ID: usize = 0x5757_5057; // "WWPW"

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct IdleState {
        idle: bool,
        idle_secs: u64,
    }

    #[derive(Clone, Serialize)]
    struct ModeState {
        active: bool,
    }

    /// Seconds since the last input, or None when Windows gives no reading.
    fn read_idle_secs() -> Option<u64> {
        let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
        unsafe {
            let _ = GetLastInputInfo(&mut info);
            if info.dwTime == 0 {
                return None;
            }
            Some(idle_secs(GetTickCount(), info.dwTime))
        }
    }

    static IDLE: AtomicBool = AtomicBool::new(false);

    /// The current idle state, for the page's first read.
    pub fn idle_state_now() -> (bool, u64) {
        let secs = read_idle_secs().unwrap_or(0);
        (secs >= IDLE_EDGE_SECS, secs)
    }

    /// Poll idle time and emit `idle-state` on each edge. One thread, started once.
    pub fn start_idle_poller(app: AppHandle) {
        static STARTED: AtomicBool = AtomicBool::new(false);
        if STARTED.swap(true, Ordering::SeqCst) {
            return;
        }
        let _ = std::thread::Builder::new().name("wall2-idle".into()).spawn(move || loop {
            std::thread::sleep(POLL);
            let Some(secs) = read_idle_secs() else { continue };
            if let Some(idle) = idle_edge(IDLE.load(Ordering::SeqCst), secs) {
                IDLE.store(idle, Ordering::SeqCst);
                let _ = app.emit("idle-state", IdleState { idle, idle_secs: secs });
            }
        });
    }

    // ---- raw input collection --------------------------------------------

    static WATCHING: AtomicBool = AtomicBool::new(false);
    static INPUT: Mutex<InputSummary> = Mutex::new(InputSummary::new());

    fn with_input(f: impl FnOnce(&mut InputSummary)) {
        let mut guard = INPUT.lock().unwrap_or_else(|e| e.into_inner());
        f(&mut guard);
    }

    fn take_input() -> InputSummary {
        let mut guard = INPUT.lock().unwrap_or_else(|e| e.into_inner());
        std::mem::take(&mut *guard)
    }

    unsafe fn read_raw(lparam: LPARAM) {
        let mut raw: RAWINPUT = std::mem::zeroed();
        let mut size = std::mem::size_of::<RAWINPUT>() as u32;
        let got = GetRawInputData(
            HRAWINPUT(lparam.0 as *mut _),
            RID_INPUT,
            Some(&mut raw as *mut RAWINPUT as *mut _),
            &mut size,
            std::mem::size_of::<RAWINPUTHEADER>() as u32,
        );
        if got == u32::MAX {
            // Could not read it (a large HID report, for one). Be conservative.
            with_input(|s| s.other = true);
            return;
        }
        match raw.header.dwType {
            0 => {
                let m = raw.data.mouse;
                if m.usFlags.0 & 1 != 0 {
                    // Absolute movement (remote desktop, pen): not a nudge.
                    with_input(|s| s.other = true);
                } else {
                    let buttons = m.Anonymous.Anonymous.usButtonFlags;
                    let (dx, dy) = (m.lLastX, m.lLastY);
                    with_input(|s| {
                        s.add_move(dx, dy);
                        if buttons != 0 {
                            s.click = true;
                        }
                    });
                }
            }
            1 => with_input(|s| s.key = true),
            _ => with_input(|s| s.touch = true),
        }
    }

    unsafe extern "system" fn input_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM, _id: usize, _data: usize) -> LRESULT {
        if msg == WM_INPUT && WATCHING.load(Ordering::SeqCst) {
            read_raw(lparam);
        }
        DefSubclassProc(hwnd, msg, wparam, lparam)
    }

    /// A hidden message-only window that receives WM_INPUT in the background
    /// (RIDEV_INPUTSINK). Runs its own message loop on its own thread.
    fn start_input_thread() {
        let _ = std::thread::Builder::new().name("wall2-rawinput".into()).spawn(|| unsafe {
            let hwnd = match CreateWindowExW(
                WINDOW_EX_STYLE(0),
                w!("STATIC"),
                w!("wall2-rawinput"),
                WINDOW_STYLE(0),
                0,
                0,
                0,
                0,
                HWND_MESSAGE,
                HMENU::default(),
                HINSTANCE::default(),
                None,
            ) {
                Ok(h) => h,
                Err(_) => return,
            };
            if !SetWindowSubclass(hwnd, Some(input_proc), SUBCLASS_ID, 0).as_bool() {
                return;
            }
            // Mouse, keyboard, touch screen.
            let device = |page: u16, usage: u16| RAWINPUTDEVICE {
                usUsagePage: page,
                usUsage: usage,
                dwFlags: RIDEV_INPUTSINK,
                hwndTarget: hwnd,
            };
            let devices = [device(0x01, 0x02), device(0x01, 0x06), device(0x0D, 0x04)];
            if RegisterRawInputDevices(&devices, std::mem::size_of::<RAWINPUTDEVICE>() as u32).is_err() {
                return;
            }
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        });
    }

    // ---- the mode ---------------------------------------------------------

    /// SC_MONITORPOWER, lParam 2 = off. A bounded broadcast, like the old
    /// app's command, so one hung window cannot hang this thread.
    fn send_off() {
        unsafe {
            let mut result: usize = 0;
            let _ = SendMessageTimeoutW(
                HWND_BROADCAST,
                WM_SYSCOMMAND,
                WPARAM(SC_MONITORPOWER as usize),
                LPARAM(2),
                SMTO_ABORTIFHUNG | SMTO_BLOCK,
                1000,
                Some(&mut result as *mut usize),
            );
        }
    }

    enum Msg {
        Off,
        Display { off: bool },
    }

    static TX: OnceLock<Mutex<Sender<Msg>>> = OnceLock::new();

    fn send(msg: Msg) -> bool {
        match TX.get() {
            Some(tx) => tx.lock().unwrap_or_else(|e| e.into_inner()).send(msg).is_ok(),
            None => false,
        }
    }

    fn ensure_worker(app: &AppHandle) {
        TX.get_or_init(|| {
            let (tx, rx) = channel::<Msg>();
            start_input_thread();
            let app = app.clone();
            let _ = std::thread::Builder::new().name("wall2-monitors-off".into()).spawn(move || worker(app, rx));
            Mutex::new(tx)
        });
    }

    fn worker(app: AppHandle, rx: std::sync::mpsc::Receiver<Msg>) {
        let epoch = Instant::now();
        let now_ms = || epoch.elapsed().as_millis() as u64;
        let mut active = false;
        let mut reoffs: Vec<u64> = Vec::new();
        let mut on_since: Option<u64> = None;
        loop {
            let wait = match on_since {
                Some(t) => Duration::from_millis(SETTLE_MS.saturating_sub(now_ms().saturating_sub(t))),
                None => Duration::from_secs(3600),
            };
            match rx.recv_timeout(wait) {
                Ok(Msg::Off) => {
                    std::thread::sleep(OFF_DELAY);
                    on_since = None;
                    drop(take_input());
                    WATCHING.store(true, Ordering::SeqCst);
                    if !active {
                        active = true;
                        let _ = app.emit("monitors-off-mode", ModeState { active: true });
                    }
                    send_off();
                }
                Ok(Msg::Display { off }) => {
                    if !active {
                        continue;
                    }
                    if off {
                        on_since = None;
                        drop(take_input());
                    } else if on_since.is_none() {
                        on_since = Some(now_ms());
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    let Some(since) = on_since.take() else { continue };
                    let now = now_ms();
                    reoffs.retain(|t| now.saturating_sub(*t) < HOUR_MS);
                    match decide(now.saturating_sub(since), take_input(), reoffs_in_last_hour(&reoffs, now)) {
                        Decision::ReOff => {
                            reoffs.push(now);
                            send_off();
                        }
                        Decision::Ignore => {}
                        Decision::Leave(_) => {
                            active = false;
                            WATCHING.store(false, Ordering::SeqCst);
                            let _ = app.emit("monitors-off-mode", ModeState { active: false });
                        }
                    }
                }
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
    }

    /// Tap on "Screens off": start the mode (500 ms later, off).
    pub fn monitors_off(app: &AppHandle) {
        ensure_worker(app);
        send(Msg::Off);
    }

    /// From the display watcher on every console display on or off change.
    pub fn display_changed(off: bool) {
        send(Msg::Display { off });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const QUIET: InputSummary = InputSummary::new();

    fn moved(px: u32) -> InputSummary {
        InputSummary { move_px: px, ..QUIET }
    }

    #[test]
    fn small_movement_re_offs() {
        assert_eq!(decide(1000, moved(0), 0), Decision::ReOff);
        assert_eq!(decide(1000, moved(2), 0), Decision::ReOff);
        assert_eq!(decide(1000, moved(29), 0), Decision::ReOff);
    }

    #[test]
    fn large_movement_leaves() {
        assert_eq!(decide(1000, moved(30), 0), Decision::Leave(LeaveReason::LargeMove));
        assert_eq!(decide(1000, moved(400), 0), Decision::Leave(LeaveReason::LargeMove));
    }

    #[test]
    fn key_click_touch_leave_even_with_tiny_movement() {
        let key = InputSummary { key: true, move_px: 1, ..QUIET };
        let click = InputSummary { click: true, move_px: 1, ..QUIET };
        let touch = InputSummary { touch: true, ..QUIET };
        let other = InputSummary { other: true, ..QUIET };
        assert_eq!(decide(1000, key, 0), Decision::Leave(LeaveReason::Key));
        assert_eq!(decide(1000, click, 0), Decision::Leave(LeaveReason::Click));
        assert_eq!(decide(1000, touch, 0), Decision::Leave(LeaveReason::Touch));
        assert_eq!(decide(1000, other, 0), Decision::Leave(LeaveReason::Other));
    }

    #[test]
    fn blips_are_ignored_whatever_arrived() {
        assert_eq!(decide(5, QUIET, 0), Decision::Ignore);
        assert_eq!(decide(40, moved(2), 0), Decision::Ignore);
        assert_eq!(decide(40, InputSummary { key: true, ..QUIET }, 0), Decision::Ignore);
        assert_eq!(decide(41, moved(2), 0), Decision::ReOff);
    }

    #[test]
    fn cap_stops_the_re_offs() {
        assert_eq!(decide(1000, moved(2), 19), Decision::ReOff);
        assert_eq!(decide(1000, moved(2), 20), Decision::Leave(LeaveReason::Cap));
        assert_eq!(decide(1000, moved(2), 35), Decision::Leave(LeaveReason::Cap));
    }

    #[test]
    fn re_offs_age_out_after_an_hour() {
        let times = [0, 1_000, 3_599_999, 3_600_000];
        assert_eq!(reoffs_in_last_hour(&times, 3_600_000), 3);
        assert_eq!(reoffs_in_last_hour(&times, 3_599_999), 4);
        assert_eq!(reoffs_in_last_hour(&[], 10), 0);
    }

    #[test]
    fn movement_sums_the_longer_side_and_saturates() {
        let mut s = InputSummary::new();
        s.add_move(3, -4);
        s.add_move(-1, 0);
        assert_eq!(s.move_px, 5);
        s.move_px = u32::MAX;
        s.add_move(10, 10);
        assert_eq!(s.move_px, u32::MAX);
        s.add_move(i32::MIN, 0);
        assert_eq!(s.move_px, u32::MAX);
    }

    #[test]
    fn idle_seconds_survive_the_tick_wrap() {
        assert_eq!(idle_secs(10_000, 4_000), 6);
        assert_eq!(idle_secs(500, u32::MAX - 999), 1);
        assert_eq!(idle_secs(7, 7), 0);
    }

    #[test]
    fn idle_edge_fires_only_on_change() {
        assert_eq!(idle_edge(false, 239), None);
        assert_eq!(idle_edge(false, 240), Some(true));
        assert_eq!(idle_edge(true, 500), None);
        assert_eq!(idle_edge(true, 0), Some(false));
        assert_eq!(idle_edge(false, 0), None);
    }
}
