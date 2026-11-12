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


/// Why the mode ended, for the `reason` of the `monitors-off-mode` event.
pub fn leave_reason_str(r: LeaveReason) -> &'static str {
    match r {
        LeaveReason::Key => "key",
        LeaveReason::Click => "click",
        LeaveReason::Touch => "touch",
        LeaveReason::Other => "other",
        LeaveReason::LargeMove => "large-move",
        LeaveReason::Cap => "cap",
    }
}

/// The reason string for any real input in `input`, if there is one.
pub fn hard_reason(input: InputSummary) -> Option<&'static str> {
    if input.key {
        Some("key")
    } else if input.click {
        Some("click")
    } else if input.touch {
        Some("touch")
    } else if input.other {
        Some("other")
    } else {
        None
    }
}

/// The hidden input window's lifecycle: at most one watcher thread and window exist.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Slot {
    Empty,
    Starting,
    Ready(isize),
}

impl Slot {
    /// True when the caller must spawn the watcher thread (only from Empty).
    pub fn begin(&mut self) -> bool {
        if *self == Slot::Empty {
            *self = Slot::Starting;
            true
        } else {
            false
        }
    }
    pub fn ready(&mut self, hwnd: isize) {
        *self = Slot::Ready(hwnd);
    }
    /// Creation failed: the thread is gone, so a later attempt may spawn a fresh one.
    pub fn failed(&mut self) {
        if *self == Slot::Starting {
            *self = Slot::Empty;
        }
    }
}

/// If no display-off is seen this long after sending off, leave the mode.
pub const WATCHDOG_MS: u64 = 3000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Idle,
    /// Tapped; waiting for the input watcher to report ready.
    Arming { tap_at: u64 },
    /// Watcher ready; waiting out the 500 ms before the first off.
    Delay { until: u64 },
    /// Off sent; waiting for the display to go off.
    AwaitOff { sent_at: u64 },
    /// Display off, watching for it to come back.
    Watching,
    /// Display came back on; judging the next second of input.
    OnSince { since: u64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Event {
    /// The Screens off button. While the mode runs, a second tap cancels it.
    Tap,
    WatcherReady(bool),
    /// A timer deadline passed.
    Tick,
    Display { off: bool },
    Lock(bool),
    /// The input watcher saw a key, click or touch (posted once per mode).
    Input,
    Shutdown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    ArmWatcher,
    SendOff,
    DisarmWatcher,
    ClearInput,
    /// Zero only the summed mouse movement. Key, click, touch and other input are never reset.
    ResetMovement,
    Emit { active: bool, reason: Option<&'static str> },
}

/// The whole mode as a pure state machine. The worker thread feeds it events and
/// performs the actions it returns. Every way out goes through one leave path
/// that disarms the watcher, clears input and emits `active: false` once.
#[derive(Debug)]
pub struct Machine {
    pub phase: Phase,
    reoffs: Vec<u64>,
    display_off: bool,
}

impl Machine {
    pub fn new() -> Self {
        Machine { phase: Phase::Idle, reoffs: Vec::new(), display_off: false }
    }

    /// Seed the display state at a tap, in case no change was heard yet.
    pub fn set_display_off(&mut self, off: bool) {
        self.display_off = off;
    }

    /// True from the tap until the mode ends (including arming).
    pub fn busy(&self) -> bool {
        self.phase != Phase::Idle
    }

    /// Milliseconds until the next timer deadline, if any.
    pub fn wait_ms(&self, now: u64) -> Option<u64> {
        let at = match self.phase {
            Phase::Delay { until } => until,
            Phase::AwaitOff { sent_at } => sent_at + WATCHDOG_MS,
            Phase::OnSince { since } => since + SETTLE_MS,
            _ => return None,
        };
        Some(at.saturating_sub(now))
    }

    fn leave(&mut self, reason: &'static str) -> Vec<Action> {
        if self.phase == Phase::Idle {
            return Vec::new();
        }
        self.phase = Phase::Idle;
        vec![Action::DisarmWatcher, Action::ClearInput, Action::Emit { active: false, reason: Some(reason) }]
    }

    pub fn step(&mut self, ev: Event, now: u64, input: InputSummary) -> Vec<Action> {
        if let Event::Display { off } = ev {
            self.display_off = off;
        }
        // Real input from the moment the watcher is ready ends the mode at the next step,
        // before any off is sent or re-sent. Only small mouse movement may continue.
        let watching_input = matches!(
            self.phase,
            Phase::Delay { .. } | Phase::AwaitOff { .. } | Phase::Watching | Phase::OnSince { .. }
        );
        if watching_input && !matches!(ev, Event::Shutdown | Event::Lock(_) | Event::Tap) {
            if let Some(reason) = hard_reason(input) {
                return self.leave(reason);
            }
        }
        match (ev, self.phase) {
            (Event::Shutdown, _) => self.leave("shutdown"),
            (Event::Lock(true), _) => self.leave("lock"),
            (Event::Lock(false), _) => Vec::new(),
            (Event::Tap, Phase::Idle) => {
                self.phase = Phase::Arming { tap_at: now };
                vec![Action::ArmWatcher]
            }
            (Event::Tap, _) => self.leave("cancelled"),
            (Event::WatcherReady(true), Phase::Arming { tap_at }) => {
                self.phase = Phase::Delay { until: (tap_at + OFF_DELAY.as_millis() as u64).max(now) };
                Vec::new()
            }
            (Event::WatcherReady(false), Phase::Arming { .. }) => self.leave("input-unavailable"),
            (Event::Tick, Phase::Delay { until }) if now >= until => {
                // Already off at the tap: nothing to wait for, so no watchdog.
                self.phase = if self.display_off { Phase::Watching } else { Phase::AwaitOff { sent_at: now } };
                vec![Action::ResetMovement, Action::Emit { active: true, reason: None }, Action::SendOff]
            }
            (Event::Tick, Phase::AwaitOff { sent_at }) if now.saturating_sub(sent_at) >= WATCHDOG_MS => {
                self.leave("watchdog")
            }
            (Event::Tick, Phase::OnSince { since }) if now.saturating_sub(since) >= SETTLE_MS => {
                self.reoffs.retain(|t| now.saturating_sub(*t) < HOUR_MS);
                match decide(now.saturating_sub(since), input, reoffs_in_last_hour(&self.reoffs, now)) {
                    Decision::ReOff => {
                        self.reoffs.push(now);
                        self.phase = Phase::AwaitOff { sent_at: now };
                        vec![Action::ResetMovement, Action::SendOff]
                    }
                    Decision::Ignore => {
                        self.phase = Phase::Watching;
                        vec![Action::ResetMovement]
                    }
                    Decision::Leave(r) => self.leave(leave_reason_str(r)),
                }
            }
            (Event::Display { off: true }, Phase::AwaitOff { .. } | Phase::OnSince { .. }) => {
                self.phase = Phase::Watching;
                vec![Action::ResetMovement]
            }
            (Event::Display { off: false }, Phase::Watching) => {
                self.phase = Phase::OnSince { since: now };
                Vec::new()
            }
            _ => Vec::new(),
        }
    }
}

impl Default for Machine {
    fn default() -> Self {
        Self::new()
    }
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

#[derive(serde::Serialize)]
pub struct ModeNow {
    pub active: bool,
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

#[derive(serde::Serialize)]
pub struct DisplayNow {
    pub visible: bool,
    pub reason: Option<&'static str>,
}

/// The current lock and display state, for the page's first read (the
/// `display-state` event only fires on a change).
#[tauri::command]
pub fn wall2_display_state(window: tauri::WebviewWindow) -> Result<DisplayNow, String> {
    require_wall2(window.label())?;
    #[cfg(windows)]
    {
        let reason = crate::display_watch::os_hidden_reason();
        Ok(DisplayNow { visible: reason.is_none(), reason })
    }
    #[cfg(not(windows))]
    Ok(DisplayNow { visible: true, reason: None })
}

/// Whether the monitors-off mode is running, for the button's first read.
#[tauri::command]
pub fn wall2_monitors_mode(window: tauri::WebviewWindow) -> Result<ModeNow, String> {
    require_wall2(window.label())?;
    #[cfg(windows)]
    {
        Ok(ModeNow { active: mode_active() })
    }
    #[cfg(not(windows))]
    Ok(ModeNow { active: false })
}

/// "Screens off", a toggle: 500 ms later the monitors go off and the re-off
/// watch starts; while the mode runs, calling it again cancels the mode and
/// leaves the screens as they are.
#[tauri::command]
pub fn wall2_monitors_off(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    require_wall2(window.label())?;
    #[cfg(windows)]
    {
        monitors_toggle(&app);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("monitors off is Windows only".to_string())
    }
}

#[cfg(windows)]
pub use sys::{display_changed, idle_state_now, lock_changed, mode_active, monitors_toggle, shutdown, start_idle_poller};

#[cfg(windows)]
mod sys {
    use super::*;
    use serde::Serialize;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
    use std::sync::{Condvar, Mutex, OnceLock};
    use std::time::Instant;
    use tauri::{AppHandle, Emitter};
    use windows::core::w;
    use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    use windows::Win32::UI::Input::{
        GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER, RIDEV_INPUTSINK,
        RIDEV_REMOVE, RID_INPUT,
    };
    use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, DispatchMessageW, GetMessageW, SendMessageTimeoutW, TranslateMessage, HMENU, HWND_BROADCAST,
        HWND_MESSAGE, MSG, SC_MONITORPOWER, SMTO_ABORTIFHUNG, SMTO_BLOCK, WINDOW_EX_STYLE, WINDOW_STYLE, WM_INPUT,
        WM_SYSCOMMAND,
    };

    const POLL: Duration = Duration::from_secs(2);
    const SUBCLASS_ID: usize = 0x5757_5057; // "WWPW"
    const WINDOW_WAIT: Duration = Duration::from_millis(1500);

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct IdleState {
        idle: bool,
        idle_secs: u64,
    }

    #[derive(Clone, Serialize)]
    struct ModeState {
        active: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<&'static str>,
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

    /// True only while the mode runs; WM_INPUT is ignored otherwise.
    static WATCHING: AtomicBool = AtomicBool::new(false);
    static INPUT: Mutex<InputSummary> = Mutex::new(InputSummary::new());
    /// The hidden message-only window, kept and reused across modes. None until a
    /// creation succeeds, so a failed attempt is retried on the next tap.
    static SLOT: Mutex<Slot> = Mutex::new(Slot::Empty);
    static SLOT_CHANGED: Condvar = Condvar::new();
    /// Set when the window procedure has told the worker about real input this mode.
    static NOTIFIED: AtomicBool = AtomicBool::new(false);

    fn with_input(f: impl FnOnce(&mut InputSummary)) {
        let mut guard = INPUT.lock().unwrap_or_else(|e| e.into_inner());
        f(&mut guard);
    }

    fn peek_input() -> InputSummary {
        *INPUT.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn clear_input() {
        with_input(|s| *s = InputSummary::new());
        NOTIFIED.store(false, Ordering::SeqCst);
    }

    fn reset_movement() {
        with_input(|s| s.move_px = 0);
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
            notify_hard();
            return;
        }
        match raw.header.dwType {
            0 => {
                let m = raw.data.mouse;
                if m.usFlags.0 & 1 != 0 {
                    // Absolute movement (remote desktop, pen): not a nudge.
                    with_input(|s| s.other = true);
                    notify_hard();
                } else {
                    let buttons = m.Anonymous.Anonymous.usButtonFlags;
                    let (dx, dy) = (m.lLastX, m.lLastY);
                    with_input(|s| {
                        s.add_move(dx, dy);
                        if buttons != 0 {
                            s.click = true;
                        }
                    });
                    if buttons != 0 {
                        notify_hard();
                    }
                }
            }
            1 => {
                with_input(|s| s.key = true);
                notify_hard();
            }
            _ => {
                with_input(|s| s.touch = true);
                notify_hard();
            }
        }
    }

    /// Tell the worker once per mode that real input arrived, so it can leave even when
    /// no display message follows. A flag swap and one channel send; nothing blocks.
    fn notify_hard() {
        if !NOTIFIED.swap(true, Ordering::SeqCst) {
            send(Event::Input);
        }
    }

    unsafe extern "system" fn input_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM, _id: usize, _data: usize) -> LRESULT {
        // A panic must never unwind across the FFI boundary: catch it and fall through.
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            if msg == WM_INPUT && WATCHING.load(Ordering::SeqCst) {
                read_raw(lparam);
            }
        }));
        DefSubclassProc(hwnd, msg, wparam, lparam)
    }

    /// The hidden window. One watcher thread owns it and stores its own handle in `SLOT`;
    /// a retry after a timeout waits on the same thread instead of spawning another, and
    /// only a thread that failed (so owns no window) is replaced. None on failure or timeout.
    fn ensure_window() -> Option<HWND> {
        let mut slot = SLOT.lock().unwrap_or_else(|e| e.into_inner());
        if slot.begin() {
            let spawned = std::thread::Builder::new().name("wall2-rawinput".into()).spawn(watcher_thread);
            if spawned.is_err() {
                slot.failed();
                return None;
            }
        }
        let deadline = Instant::now() + WINDOW_WAIT;
        loop {
            match *slot {
                Slot::Ready(h) => return Some(HWND(h as *mut _)),
                Slot::Empty => return None,
                Slot::Starting => {}
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return None;
            }
            slot = SLOT_CHANGED.wait_timeout(slot, left).unwrap_or_else(|e| e.into_inner()).0;
        }
    }

    fn watcher_thread() {
        unsafe {
            let hwnd = CreateWindowExW(
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
            );
            let hwnd = match hwnd {
                Ok(h) if SetWindowSubclass(h, Some(input_proc), SUBCLASS_ID, 0).as_bool() => h,
                Ok(h) => {
                    let _ = DestroyWindow(h);
                    SLOT.lock().unwrap_or_else(|e| e.into_inner()).failed();
                    SLOT_CHANGED.notify_all();
                    return;
                }
                Err(_) => {
                    SLOT.lock().unwrap_or_else(|e| e.into_inner()).failed();
                    SLOT_CHANGED.notify_all();
                    return;
                }
            };
            SLOT.lock().unwrap_or_else(|e| e.into_inner()).ready(hwnd.0 as isize);
            SLOT_CHANGED.notify_all();
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }

    /// Start receiving raw mouse, keyboard and touch input (even unfocused).
    /// True only when the window exists and Windows accepted the registration.
    fn arm_watcher() -> bool {
        let Some(hwnd) = ensure_window() else { return false };
        let device = |page: u16, usage: u16| RAWINPUTDEVICE {
            usUsagePage: page,
            usUsage: usage,
            dwFlags: RIDEV_INPUTSINK,
            hwndTarget: hwnd,
        };
        let devices = [device(0x01, 0x02), device(0x01, 0x06), device(0x0D, 0x04)];
        let ok = unsafe { RegisterRawInputDevices(&devices, std::mem::size_of::<RAWINPUTDEVICE>() as u32).is_ok() };
        if ok {
            clear_input();
            WATCHING.store(true, Ordering::SeqCst);
        }
        ok
    }

    /// Stop all raw input delivery to this process (RIDEV_REMOVE, null target).
    /// The hidden window is kept and reused by the next mode. Callable from any
    /// thread.
    fn disarm_watcher() {
        WATCHING.store(false, Ordering::SeqCst);
        let remove = |page: u16, usage: u16| RAWINPUTDEVICE {
            usUsagePage: page,
            usUsage: usage,
            dwFlags: RIDEV_REMOVE,
            hwndTarget: HWND::default(),
        };
        let devices = [remove(0x01, 0x02), remove(0x01, 0x06), remove(0x0D, 0x04)];
        unsafe {
            let _ = RegisterRawInputDevices(&devices, std::mem::size_of::<RAWINPUTDEVICE>() as u32);
        }
        clear_input();
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

    static TX: OnceLock<Mutex<Sender<Event>>> = OnceLock::new();
    static ACTIVE: AtomicBool = AtomicBool::new(false);

    pub fn mode_active() -> bool {
        ACTIVE.load(Ordering::SeqCst)
    }

    fn send(ev: Event) -> bool {
        match TX.get() {
            Some(tx) => tx.lock().unwrap_or_else(|e| e.into_inner()).send(ev).is_ok(),
            None => false,
        }
    }

    fn ensure_worker(app: &AppHandle) {
        TX.get_or_init(|| {
            let (tx, rx) = channel::<Event>();
            let app = app.clone();
            let _ = std::thread::Builder::new().name("wall2-monitors-off".into()).spawn(move || worker(app, rx));
            Mutex::new(tx)
        });
    }

    fn worker(app: AppHandle, rx: Receiver<Event>) {
        let epoch = Instant::now();
        let now_ms = || epoch.elapsed().as_millis() as u64;
        let mut machine = Machine::new();
        let mut pending: Vec<Event> = Vec::new();
        loop {
            let ev = match pending.pop() {
                Some(ev) => ev,
                None => {
                    let wait = machine.wait_ms(now_ms()).map(Duration::from_millis).unwrap_or(Duration::from_secs(3600));
                    match rx.recv_timeout(wait) {
                        Ok(ev) => ev,
                        Err(RecvTimeoutError::Timeout) => Event::Tick,
                        Err(RecvTimeoutError::Disconnected) => return,
                    }
                }
            };
            if matches!(ev, Event::Tap) {
                machine.set_display_off(crate::display_watch::display_is_off());
            }
            for action in machine.step(ev, now_ms(), peek_input()) {
                match action {
                    Action::ArmWatcher => pending.push(Event::WatcherReady(arm_watcher())),
                    Action::SendOff => send_off(),
                    Action::DisarmWatcher => disarm_watcher(),
                    Action::ClearInput => clear_input(),
                    Action::ResetMovement => reset_movement(),
                    Action::Emit { active, reason } => {
                        ACTIVE.store(active, Ordering::SeqCst);
                        let _ = app.emit("monitors-off-mode", ModeState { active, reason });
                    }
                }
            }
            // Arm succeeded and the delay may already be due (no wait in the channel).
            if machine.wait_ms(now_ms()) == Some(0) && pending.is_empty() {
                pending.push(Event::Tick);
            }
        }
    }

    /// The Screens off button. Starts the mode, or cancels it when it runs.
    pub fn monitors_toggle(app: &AppHandle) {
        ensure_worker(app);
        send(Event::Tap);
    }

    /// From the display watcher on every console display on or off change.
    pub fn display_changed(off: bool) {
        send(Event::Display { off });
    }

    /// From the display watcher on session lock and unlock.
    pub fn lock_changed(locked: bool) {
        send(Event::Lock(locked));
    }

    /// App exit: leave the mode and drop the raw input registration at once,
    /// without waiting for the worker.
    pub fn shutdown() {
        send(Event::Shutdown);
        disarm_watcher();
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

    fn run(m: &mut Machine, ev: Event, now: u64, input: InputSummary) -> Vec<Action> {
        m.step(ev, now, input)
    }
    fn left(actions: &[Action], reason: &'static str) -> bool {
        actions.contains(&Action::Emit { active: false, reason: Some(reason) })
            && actions.contains(&Action::DisarmWatcher)
            && actions.contains(&Action::ClearInput)
    }
    fn emits(actions: &[Action]) -> usize {
        actions.iter().filter(|a| matches!(a, Action::Emit { .. })).count()
    }
    /// Tap, watcher ready, 500 ms later off is sent: AwaitOff at t=500.
    fn started() -> Machine {
        let mut m = Machine::new();
        assert_eq!(run(&mut m, Event::Tap, 0, QUIET), vec![Action::ArmWatcher]);
        assert!(run(&mut m, Event::WatcherReady(true), 10, QUIET).is_empty());
        assert_eq!(m.wait_ms(100), Some(400));
        let a = run(&mut m, Event::Tick, 500, QUIET);
        assert!(a.contains(&Action::SendOff));
        assert!(a.contains(&Action::Emit { active: true, reason: None }));
        m
    }

    #[test]
    fn watcher_not_ready_leaves_without_sending_off() {
        let mut m = Machine::new();
        run(&mut m, Event::Tap, 0, QUIET);
        let a = run(&mut m, Event::WatcherReady(false), 5, QUIET);
        assert!(left(&a, "input-unavailable"));
        assert!(!a.contains(&Action::SendOff));
        assert_eq!(m.phase, Phase::Idle);
        // A later tap retries.
        assert_eq!(run(&mut m, Event::Tap, 9000, QUIET), vec![Action::ArmWatcher]);
    }

    #[test]
    fn off_is_not_sent_before_the_delay() {
        let mut m = Machine::new();
        run(&mut m, Event::Tap, 0, QUIET);
        run(&mut m, Event::WatcherReady(true), 10, QUIET);
        assert!(run(&mut m, Event::Tick, 499, QUIET).is_empty());
    }

    #[test]
    fn second_tap_cancels_once() {
        let mut m = started();
        let a = run(&mut m, Event::Tap, 800, QUIET);
        assert!(left(&a, "cancelled"));
        assert_eq!(emits(&a), 1);
        assert!(!a.contains(&Action::SendOff));
        assert!(run(&mut m, Event::Tap, 900, QUIET) == vec![Action::ArmWatcher]);
    }

    #[test]
    fn tap_while_arming_cancels() {
        let mut m = Machine::new();
        run(&mut m, Event::Tap, 0, QUIET);
        assert!(left(&run(&mut m, Event::Tap, 5, QUIET), "cancelled"));
    }

    #[test]
    fn lock_leaves_from_every_busy_phase_and_only_once() {
        let mut m = started();
        run(&mut m, Event::Display { off: true }, 600, QUIET);
        assert_eq!(m.phase, Phase::Watching);
        let a = run(&mut m, Event::Lock(true), 700, QUIET);
        assert!(left(&a, "lock"));
        assert_eq!(emits(&a), 1);
        assert!(run(&mut m, Event::Lock(true), 710, QUIET).is_empty());
        assert!(run(&mut m, Event::Lock(false), 720, QUIET).is_empty());
        let mut m2 = Machine::new();
        run(&mut m2, Event::Tap, 0, QUIET);
        assert!(left(&run(&mut m2, Event::Lock(true), 1, QUIET), "lock"));
    }

    #[test]
    fn watchdog_leaves_when_no_display_off_in_three_seconds() {
        let mut m = started();
        assert_eq!(m.wait_ms(600), Some(2900));
        assert!(run(&mut m, Event::Tick, 3499, QUIET).is_empty());
        let a = run(&mut m, Event::Tick, 3500, QUIET);
        assert!(left(&a, "watchdog"));
        assert_eq!(emits(&a), 1);
    }

    #[test]
    fn display_off_stops_the_watchdog() {
        let mut m = started();
        run(&mut m, Event::Display { off: true }, 700, QUIET);
        assert_eq!(m.wait_ms(800), None);
        assert!(run(&mut m, Event::Tick, 9000, QUIET).is_empty());
    }

    #[test]
    fn shutdown_leaves_and_is_quiet_when_idle() {
        let mut m = started();
        assert!(left(&run(&mut m, Event::Shutdown, 900, QUIET), "shutdown"));
        assert!(run(&mut m, Event::Shutdown, 910, QUIET).is_empty());
        assert!(run(&mut Machine::new(), Event::Shutdown, 0, QUIET).is_empty());
    }

    #[test]
    fn nudge_re_offs_then_key_leaves() {
        let mut m = started();
        run(&mut m, Event::Display { off: true }, 600, QUIET);
        run(&mut m, Event::Display { off: false }, 5000, QUIET);
        assert_eq!(m.wait_ms(5000), Some(1000));
        let a = run(&mut m, Event::Tick, 6000, moved(2));
        assert!(a.contains(&Action::SendOff));
        assert!(matches!(m.phase, Phase::AwaitOff { .. }));
        run(&mut m, Event::Display { off: true }, 6100, QUIET);
        run(&mut m, Event::Display { off: false }, 9000, QUIET);
        let key = InputSummary { key: true, ..QUIET };
        let a = run(&mut m, Event::Tick, 10000, key);
        assert!(left(&a, "key"));
    }

    #[test]
    fn cap_reached_leaves_after_twenty_re_offs() {
        let mut m = started();
        let mut t = 1000;
        for _ in 0..REOFF_CAP_PER_HOUR {
            run(&mut m, Event::Display { off: true }, t, QUIET);
            t += 10;
            run(&mut m, Event::Display { off: false }, t, QUIET);
            t += SETTLE_MS;
            assert!(run(&mut m, Event::Tick, t, moved(1)).contains(&Action::SendOff));
        }
        run(&mut m, Event::Display { off: true }, t + 10, QUIET);
        run(&mut m, Event::Display { off: false }, t + 20, QUIET);
        let a = run(&mut m, Event::Tick, t + 20 + SETTLE_MS, moved(1));
        assert!(left(&a, "cap"));
    }

    #[test]
    fn key_during_the_delay_leaves_without_sending_off() {
        let mut m = Machine::new();
        run(&mut m, Event::Tap, 0, QUIET);
        run(&mut m, Event::WatcherReady(true), 10, QUIET);
        let key = InputSummary { key: true, ..QUIET };
        let a = run(&mut m, Event::Tick, 500, key);
        assert!(left(&a, "key"));
        assert!(!a.contains(&Action::SendOff));
        assert_eq!(emits(&a), 1);
        assert_eq!(m.phase, Phase::Idle);
    }

    #[test]
    fn key_before_display_off_is_never_erased() {
        let mut m = started();
        let key = InputSummary { key: true, ..QUIET };
        let a = run(&mut m, Event::Display { off: true }, 550, key);
        assert!(left(&a, "key"));
        assert_eq!(emits(&a), 1);
        assert!(!a.contains(&Action::SendOff));
        // A click or touch in the wait for off ends it on the next timer step too.
        let mut m2 = started();
        let click = InputSummary { click: true, ..QUIET };
        assert!(left(&run(&mut m2, Event::Tick, 600, click), "click"));
        let mut m3 = started();
        let touch = InputSummary { touch: true, ..QUIET };
        assert!(left(&run(&mut m3, Event::Display { off: true }, 600, touch), "touch"));
    }

    #[test]
    fn small_nudge_before_display_off_keeps_the_mode() {
        let mut m = Machine::new();
        run(&mut m, Event::Tap, 0, QUIET);
        run(&mut m, Event::WatcherReady(true), 10, QUIET);
        let a = run(&mut m, Event::Tick, 500, moved(2));
        assert!(a.contains(&Action::SendOff));
        assert!(!a.contains(&Action::ClearInput));
        let a = run(&mut m, Event::Display { off: true }, 550, moved(3));
        assert_eq!(m.phase, Phase::Watching);
        assert_eq!(a, vec![Action::ResetMovement]);
    }

    #[test]
    fn movement_reset_never_clears_real_input() {
        // Every non-leave step uses ResetMovement, never ClearInput.
        let mut m = started();
        let a = run(&mut m, Event::Display { off: true }, 600, QUIET);
        assert!(!a.contains(&Action::ClearInput));
        run(&mut m, Event::Display { off: false }, 5000, QUIET);
        let a = run(&mut m, Event::Tick, 6000, moved(1));
        assert!(!a.contains(&Action::ClearInput));
    }

    #[test]
    fn real_input_message_leaves_a_stuck_mode() {
        let mut m = started();
        run(&mut m, Event::Display { off: true }, 600, QUIET);
        // A key woke the display with no display-on message.
        let key = InputSummary { key: true, ..QUIET };
        let a = run(&mut m, Event::Input, 700, key);
        assert!(left(&a, "key"));
        assert_eq!(emits(&a), 1);
        // A stale Input with nothing recorded does nothing.
        let mut m2 = started();
        assert!(run(&mut m2, Event::Input, 700, QUIET).is_empty());
    }

    #[test]
    fn display_already_off_at_the_tap_counts_as_off() {
        let mut m = Machine::new();
        m.set_display_off(true);
        run(&mut m, Event::Tap, 0, QUIET);
        run(&mut m, Event::WatcherReady(true), 10, QUIET);
        let a = run(&mut m, Event::Tick, 500, QUIET);
        assert!(a.contains(&Action::SendOff));
        assert_eq!(m.phase, Phase::Watching);
        assert_eq!(m.wait_ms(600), None);
        assert!(run(&mut m, Event::Tick, 9000, QUIET).is_empty());
        // The same through display events heard while idle.
        let mut m2 = Machine::new();
        run(&mut m2, Event::Display { off: true }, 0, QUIET);
        run(&mut m2, Event::Tap, 1, QUIET);
        run(&mut m2, Event::WatcherReady(true), 2, QUIET);
        run(&mut m2, Event::Tick, 501, QUIET);
        assert_eq!(m2.phase, Phase::Watching);
    }

    #[test]
    fn watcher_slot_never_spawns_twice() {
        let mut s = Slot::Empty;
        assert!(s.begin());
        // A retry after a timeout reuses the starting thread.
        assert!(!s.begin());
        s.ready(7);
        assert!(!s.begin());
        assert_eq!(s, Slot::Ready(7));
        // A failed thread owns no window, so the next attempt may spawn again.
        let mut f = Slot::Empty;
        assert!(f.begin());
        f.failed();
        assert_eq!(f, Slot::Empty);
        assert!(f.begin());
        // A failure never wipes a ready window.
        s.failed();
        assert_eq!(s, Slot::Ready(7));
    }
}
