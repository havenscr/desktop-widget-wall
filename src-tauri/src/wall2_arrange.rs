//! Wall 2 big screen: three window layouts for the owner's big monitor.
//!
//! A layout runs only when the owner clicks it on the wall. It moves and resizes other
//! programs' ordinary windows on the big monitor (the monitor that is not the wall's own and
//! has the widest aspect ratio) and nothing else: nothing is closed, minimised or hidden,
//! and nothing is drawn outside the wall. Each decision is a pure function below, with a
//! test; the Win32 calls are in the small `win` module, compiled on Windows only.
//!
//! Every answer is a number or one of a few fixed words (`no big screen`, `no windows`,
//! `nothing to undo`, `busy`, `unknown layout`, `unsupported`, `forbidden`). No window title
//! or process name leaves this module, and nothing is logged.

use crate::wall2_omni::require_wall2;
use crate::wall2_winutil::Rect;
use std::time::{Duration, Instant};

/// The columns of the thirds layout never exceed this many windows.
const MAX_COLUMNS: usize = 3;
/// How long after a layout its undo still works. The wall shows the button for 60 seconds;
/// the extra seconds cover the click that lands just as it disappears.
const UNDO_WINDOW: Duration = Duration::from_secs(90);

// Section: layouts

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Layout {
    Thirds,
    Focus,
    Record,
}

/// The fixed list of layout names the page may send.
pub(crate) fn parse_layout(name: &str) -> Option<Layout> {
    match name {
        "thirds" => Some(Layout::Thirds),
        "focus" => Some(Layout::Focus),
        "record" => Some(Layout::Record),
        _ => None,
    }
}

impl Layout {
    /// How many of the top windows the layout places.
    fn windows(self) -> usize {
        match self {
            Layout::Thirds => MAX_COLUMNS,
            Layout::Focus | Layout::Record => 1,
        }
    }
}

/// Equal columns across the work area for `n` windows (at most three). The last column
/// takes the rounding remainder, so the columns always cover the width exactly.
fn columns(work: Rect, n: usize) -> Vec<Rect> {
    let k = n.min(MAX_COLUMNS) as i64;
    if k == 0 {
        return Vec::new();
    }
    let w = work.width() as i64;
    (0..k)
        .map(|i| Rect {
            left: work.left + (w * i / k) as i32,
            top: work.top,
            right: work.left + (w * (i + 1) / k) as i32,
            bottom: work.bottom,
        })
        .collect()
}

/// A column two thirds of the width, centred, full height.
fn focus_column(work: Rect) -> Rect {
    let w = work.width() * 2 / 3;
    let left = work.left + (work.width() - w) / 2;
    Rect { left, top: work.top, right: left + w, bottom: work.bottom }
}

/// The largest 16:9 rectangle that fits the work area, centred. On a 32:9 screen that is
/// as tall as the screen; on a screen narrower than 16:9 it is as wide as the screen.
fn record_frame(work: Rect) -> Rect {
    let (ww, wh) = (work.width() as i64, work.height() as i64);
    let (w, h) = if wh * 16 / 9 <= ww { (wh * 16 / 9, wh) } else { (ww, ww * 9 / 16) };
    let (w, h) = (w as i32, h as i32);
    let left = work.left + (work.width() - w) / 2;
    let top = work.top + (work.height() - h) / 2;
    Rect { left, top, right: left + w, bottom: top + h }
}

/// For windows listed in z order with their current left edges, the column each takes in a
/// thirds layout: left to right by where the window already is, so windows do not jump
/// across each other. Ties keep the z order.
fn column_order(lefts: &[i32]) -> Vec<usize> {
    let mut order: Vec<usize> = (0..lefts.len()).collect();
    order.sort_by_key(|&i| (lefts[i], i));
    let mut column = vec![0; lefts.len()];
    for (rank, &i) in order.iter().enumerate() {
        column[i] = rank;
    }
    column
}

/// Where each chosen window goes: `(window id, rectangle)`. `windows` are in z order with
/// their current left edges. Focus and Record place the top window only.
fn plan(layout: Layout, work: Rect, windows: &[(isize, i32)]) -> Vec<(isize, Rect)> {
    let n = windows.len().min(layout.windows());
    let windows = &windows[..n];
    match layout {
        Layout::Thirds => {
            let cols = columns(work, n);
            let lefts: Vec<i32> = windows.iter().map(|w| w.1).collect();
            column_order(&lefts).into_iter().zip(windows).map(|(c, w)| (w.0, cols[c])).collect()
        }
        Layout::Focus => windows.first().map(|w| (w.0, focus_column(work))).into_iter().collect(),
        Layout::Record => windows.first().map(|w| (w.0, record_frame(work))).into_iter().collect(),
    }
}

/// Grow a target rectangle by the window's invisible frame, so its visible edges land on
/// the target. `win` is `GetWindowRect`, `frame` the visible bounds from the window manager.
/// An inset outside 0 to 32 pixels is not believed and counts as none.
fn outer_target(target: Rect, win: Rect, frame: Rect) -> Rect {
    let inset = |v: i32| if (0..=32).contains(&v) { v } else { 0 };
    Rect {
        left: target.left - inset(frame.left - win.left),
        top: target.top - inset(frame.top - win.top),
        right: target.right + inset(win.right - frame.right),
        bottom: target.bottom + inset(win.bottom - frame.bottom),
    }
}

// Section: monitors

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Monitor {
    pub id: isize,
    pub rect: Rect,
    pub work: Rect,
}

/// The big screen: not the wall's own monitor, the widest aspect ratio (a tie goes to the
/// larger one, then the first listed). None when the wall's monitor is the only one.
pub(crate) fn choose_monitor(monitors: &[Monitor], wall: isize) -> Option<usize> {
    let ratio_cmp = |a: &Rect, b: &Rect| {
        // a.w / a.h against b.w / b.h, without division.
        (a.width() as i64 * b.height() as i64).cmp(&(b.width() as i64 * a.height() as i64))
    };
    let area = |r: &Rect| r.width() as i64 * r.height() as i64;
    let mut best: Option<usize> = None;
    for (i, m) in monitors.iter().enumerate() {
        if m.id == wall || m.rect.width() <= 0 || m.rect.height() <= 0 {
            continue;
        }
        best = match best {
            None => Some(i),
            Some(b) => {
                let cur = &monitors[b].rect;
                let better = match ratio_cmp(&m.rect, cur) {
                    std::cmp::Ordering::Greater => true,
                    std::cmp::Ordering::Less => false,
                    std::cmp::Ordering::Equal => area(&m.rect) > area(cur),
                };
                Some(if better { i } else { b })
            }
        };
    }
    best
}

// Section: windows

/// One top-level window, as the filter sees it.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct WinRec {
    pub id: isize,
    pub monitor: isize,
    pub visible: bool,
    pub minimised: bool,
    pub cloaked: bool,
    pub has_title: bool,
    pub owned: bool,
    pub tool_window: bool,
    pub shell: bool,
    /// A window of this app (the wall's own).
    pub own_process: bool,
    /// No sizing frame: a fixed dialog.
    pub fixed_size: bool,
    /// Elevated while the wall is not, or not answering: it cannot be moved from here.
    pub out_of_reach: bool,
}

impl WinRec {
    fn eligible(&self) -> bool {
        self.visible
            && !self.minimised
            && !self.cloaked
            && self.has_title
            && !self.owned
            && !self.tool_window
            && !self.shell
            && !self.own_process
            && !self.fixed_size
            && !self.out_of_reach
    }
}

/// The windows a layout may place: ordinary application windows on `monitor`, in the order
/// given (z order, topmost first), at most `max`. Returns indices into `recs`.
pub(crate) fn pick_windows(recs: &[WinRec], monitor: isize, max: usize) -> Vec<usize> {
    recs.iter()
        .enumerate()
        .filter(|(_, r)| r.monitor == monitor && r.eligible())
        .map(|(i, _)| i)
        .take(max)
        .collect()
}

// Section: undo

/// What one layout click moved, kept for one step of undo.
pub(crate) struct UndoSet<T> {
    entries: Vec<T>,
    at: Instant,
}

impl<T> UndoSet<T> {
    pub fn new(entries: Vec<T>, at: Instant) -> Self {
        UndoSet { entries, at }
    }
}

/// Take the remembered set out of the slot. The slot is empty afterwards either way, so a
/// second undo finds nothing. None when there is nothing or it is older than the window.
pub(crate) fn take_undo<T>(slot: &mut Option<UndoSet<T>>, now: Instant) -> Option<Vec<T>> {
    let set = slot.take()?;
    if now.saturating_duration_since(set.at) > UNDO_WINDOW || set.entries.is_empty() {
        return None;
    }
    Some(set.entries)
}

// Section: commands

/// Fixed reason words.
const NO_BIG_SCREEN: &str = "no big screen";
const NO_WINDOWS: &str = "no windows";
const NOTHING_TO_UNDO: &str = "nothing to undo";
#[cfg_attr(not(windows), allow(dead_code))]
const BUSY: &str = "busy";
#[cfg_attr(windows, allow(dead_code))]
const UNSUPPORTED: &str = "unsupported";

/// Whether there is a big screen to arrange onto. An error on a system the commands do not
/// support, so the page shows no row there.
#[tauri::command]
pub async fn wall2_arrange_status(window: tauri::WebviewWindow) -> Result<bool, String> {
    require_wall2(window.label())?;
    #[cfg(windows)]
    {
        let wall = window.hwnd().ok().map(|h| h.0 as isize);
        tauri::async_runtime::spawn_blocking(move || win::big_screen_available(wall))
            .await
            .map_err(|_| BUSY.to_string())
    }
    #[cfg(not(windows))]
    {
        Err(UNSUPPORTED.to_string())
    }
}

/// Lay out the top windows on the big screen. Returns how many windows moved.
#[tauri::command]
pub async fn wall2_arrange(window: tauri::WebviewWindow, layout: String) -> Result<u32, String> {
    require_wall2(window.label())?;
    let layout = parse_layout(&layout).ok_or_else(|| "unknown layout".to_string())?;
    #[cfg(windows)]
    {
        let wall = window.hwnd().ok().map(|h| h.0 as isize);
        tauri::async_runtime::spawn_blocking(move || win::arrange(layout, wall).map_err(str::to_string))
            .await
            .map_err(|_| BUSY.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = layout;
        Err(UNSUPPORTED.to_string())
    }
}

/// Put back the windows the last layout moved, when they still exist.
#[tauri::command]
pub async fn wall2_arrange_undo(window: tauri::WebviewWindow) -> Result<u32, String> {
    require_wall2(window.label())?;
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(|| win::undo().map_err(str::to_string)).await.map_err(|_| BUSY.to_string())?
    }
    #[cfg(not(windows))]
    {
        Err(UNSUPPORTED.to_string())
    }
}

// Section: Windows

#[cfg(windows)]
mod win {
    use super::*;
    use crate::wall2_winutil::{sys, try_begin};
    use std::ffi::c_void;
    use std::sync::atomic::AtomicBool;
    use std::sync::Mutex;
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT, TRUE};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, MonitorFromWindow, HDC, HMONITOR, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindow, GetWindowLongW, GetWindowPlacement, GetWindowRect, IsHungAppWindow, IsIconic, IsWindow,
        IsWindowVisible, IsZoomed, SetWindowPlacement, SetWindowPos, ShowWindowAsync, GWL_EXSTYLE, GWL_STYLE, GW_OWNER,
        SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOZORDER, SW_RESTORE, WINDOWPLACEMENT, WS_EX_TOOLWINDOW, WS_THICKFRAME,
    };

    /// Held while a layout or an undo runs, so clicks never overlap.
    static WORKING: AtomicBool = AtomicBool::new(false);

    struct Saved {
        hwnd: isize,
        pid: u32,
        placement: WINDOWPLACEMENT,
    }

    static UNDO: Mutex<Option<UndoSet<Saved>>> = Mutex::new(None);

    fn to_rect(r: RECT) -> Rect {
        Rect { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    }

    unsafe extern "system" fn enum_proc(monitor: HMONITOR, _hdc: HDC, _rect: *mut RECT, data: LPARAM) -> BOOL {
        let list = &mut *(data.0 as *mut Vec<Monitor>);
        let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if GetMonitorInfoW(monitor, &mut info).as_bool() {
            list.push(Monitor { id: monitor.0 as isize, rect: to_rect(info.rcMonitor), work: to_rect(info.rcWork) });
        }
        TRUE
    }

    fn monitors() -> Vec<Monitor> {
        let mut list: Vec<Monitor> = Vec::new();
        unsafe {
            let _ = EnumDisplayMonitors(HDC::default(), None, Some(enum_proc), LPARAM(&mut list as *mut Vec<Monitor> as isize));
        }
        list
    }

    fn monitor_of(h: isize) -> isize {
        unsafe { MonitorFromWindow(sys::hwnd(h), MONITOR_DEFAULTTONEAREST).0 as isize }
    }

    /// The big monitor, or None when the wall's own is the only one (or the wall's window
    /// is unknown, which fails closed).
    fn big_monitor(wall: Option<isize>) -> Option<Monitor> {
        let wall = monitor_of(wall?);
        let list = monitors();
        choose_monitor(&list, wall).map(|i| list[i])
    }

    pub fn big_screen_available(wall: Option<isize>) -> bool {
        big_monitor(wall).is_some()
    }

    fn record(h: isize, monitor: isize, self_elevated: bool) -> WinRec {
        let hw = sys::hwnd(h);
        unsafe {
            let visible = IsWindowVisible(hw).as_bool();
            let minimised = IsIconic(hw).as_bool();
            let mut cloaked = 0u32;
            let _ = DwmGetWindowAttribute(hw, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut c_void, 4);
            let pid = sys::pid_of(h);
            let ex = GetWindowLongW(hw, GWL_EXSTYLE) as u32;
            let style = GetWindowLongW(hw, GWL_STYLE) as u32;
            let mut rec = WinRec {
                id: h,
                monitor,
                visible,
                minimised,
                cloaked: cloaked != 0,
                has_title: false,
                owned: GetWindow(hw, GW_OWNER).map(|o| !o.0.is_null()).unwrap_or(false),
                tool_window: ex & WS_EX_TOOLWINDOW.0 != 0,
                shell: false,
                own_process: pid == std::process::id(),
                fixed_size: style & WS_THICKFRAME.0 == 0,
                out_of_reach: false,
            };
            // The slower reads run only for windows still in the running.
            if rec.visible && !rec.minimised && !rec.cloaked && !rec.owned && !rec.tool_window && !rec.own_process {
                rec.has_title = sys::has_title(h);
                rec.shell = crate::wall2_winutil::is_shell_class(&sys::class_name(h));
                rec.out_of_reach = IsHungAppWindow(hw).as_bool() || sys::out_of_reach(pid, self_elevated);
            }
            rec
        }
    }

    fn frame_of(h: isize) -> Option<(Rect, Rect)> {
        let hw = sys::hwnd(h);
        unsafe {
            let mut win = RECT::default();
            GetWindowRect(hw, &mut win).ok()?;
            let mut frame = RECT::default();
            DwmGetWindowAttribute(hw, DWMWA_EXTENDED_FRAME_BOUNDS, &mut frame as *mut RECT as *mut c_void, std::mem::size_of::<RECT>() as u32)
                .ok()?;
            Some((to_rect(win), to_rect(frame)))
        }
    }

    /// Restore a maximised window, then place it. True when the move was accepted.
    fn place(h: isize, target: Rect) -> bool {
        let hw = sys::hwnd(h);
        unsafe {
            if IsZoomed(hw).as_bool() {
                let _ = ShowWindowAsync(hw, SW_RESTORE);
            }
            let outer = match frame_of(h) {
                Some((win, frame)) => outer_target(target, win, frame),
                None => target,
            };
            SetWindowPos(
                hw,
                HWND::default(),
                outer.left,
                outer.top,
                outer.width(),
                outer.height(),
                SWP_NOZORDER | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS,
            )
            .is_ok()
        }
    }

    pub fn arrange(layout: Layout, wall: Option<isize>) -> Result<u32, &'static str> {
        let _busy = try_begin(&WORKING).ok_or(BUSY)?;
        let monitor = big_monitor(wall).ok_or(NO_BIG_SCREEN)?;
        let self_elevated = sys::self_elevated();
        let recs: Vec<WinRec> = sys::top_level_windows().into_iter().map(|h| record(h, monitor_of(h), self_elevated)).collect();
        let picked = pick_windows(&recs, monitor.id, layout.windows());
        if picked.is_empty() {
            return Err(NO_WINDOWS);
        }
        let lefts: Vec<(isize, i32)> = picked
            .iter()
            .map(|&i| {
                let id = recs[i].id;
                let mut r = RECT::default();
                let left = unsafe { GetWindowRect(sys::hwnd(id), &mut r).is_ok() }.then_some(r.left).unwrap_or(0);
                (id, left)
            })
            .collect();
        let mut saved: Vec<Saved> = Vec::new();
        let mut moved = 0u32;
        for (id, target) in plan(layout, monitor.work, &lefts) {
            let mut placement = WINDOWPLACEMENT { length: std::mem::size_of::<WINDOWPLACEMENT>() as u32, ..Default::default() };
            let have = unsafe { GetWindowPlacement(sys::hwnd(id), &mut placement).is_ok() };
            if place(id, target) {
                moved += 1;
                if have {
                    saved.push(Saved { hwnd: id, pid: sys::pid_of(id), placement });
                }
            }
        }
        if moved == 0 {
            return Err(NO_WINDOWS);
        }
        if let Ok(mut slot) = UNDO.lock() {
            *slot = Some(UndoSet::new(saved, Instant::now()));
        }
        Ok(moved)
    }

    pub fn undo() -> Result<u32, &'static str> {
        let _busy = try_begin(&WORKING).ok_or(BUSY)?;
        let entries = {
            let mut slot = UNDO.lock().map_err(|_| NOTHING_TO_UNDO)?;
            take_undo(&mut slot, Instant::now()).ok_or(NOTHING_TO_UNDO)?
        };
        let mut restored = 0u32;
        for e in entries {
            let hw = sys::hwnd(e.hwnd);
            // The window must still exist and still belong to the same process (a handle
            // can be reused), and must be answering.
            let same = unsafe { IsWindow(hw).as_bool() && sys::pid_of(e.hwnd) == e.pid && !IsHungAppWindow(hw).as_bool() };
            if same && unsafe { SetWindowPlacement(hw, &e.placement).is_ok() } {
                restored += 1;
            }
        }
        if restored == 0 {
            return Err(NOTHING_TO_UNDO);
        }
        Ok(restored)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn r(left: i32, top: i32, right: i32, bottom: i32) -> Rect {
        Rect { left, top, right, bottom }
    }

    /// A monitor's work area with a 40 px taskbar on one edge.
    fn work(mon: Rect, edge: char) -> Rect {
        let mut w = mon;
        match edge {
            'b' => w.bottom -= 40,
            't' => w.top += 40,
            'l' => w.left += 40,
            'r' => w.right -= 40,
            _ => {}
        }
        w
    }

    const SCREENS: [Rect; 3] = [r(0, 0, 5120, 1440), r(0, 0, 3840, 1080), r(0, 0, 2560, 1440)];

    fn inside(a: Rect, b: Rect) -> bool {
        a.left >= b.left && a.top >= b.top && a.right <= b.right && a.bottom <= b.bottom
    }

    #[test]
    fn layout_names_are_a_fixed_list() {
        assert_eq!(parse_layout("thirds"), Some(Layout::Thirds));
        assert_eq!(parse_layout("focus"), Some(Layout::Focus));
        assert_eq!(parse_layout("record"), Some(Layout::Record));
        for bad in ["", "Thirds", "thirds ", "record 16:9", "halves", "../focus"] {
            assert_eq!(parse_layout(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn thirds_cover_the_work_area_exactly_on_every_screen_and_taskbar_edge() {
        for mon in SCREENS {
            for edge in ['b', 't', 'l', 'r', 'n'] {
                let w = work(mon, edge);
                for n in 1..=3usize {
                    let cols = columns(w, n);
                    assert_eq!(cols.len(), n);
                    assert_eq!(cols[0].left, w.left);
                    assert_eq!(cols[n - 1].right, w.right);
                    for pair in cols.windows(2) {
                        assert_eq!(pair[0].right, pair[1].left, "no gap, no overlap");
                    }
                    for c in &cols {
                        assert!(inside(*c, w));
                        assert_eq!((c.top, c.bottom), (w.top, w.bottom));
                    }
                }
            }
        }
    }

    #[test]
    fn thirds_at_5120_by_1440() {
        let cols = columns(work(SCREENS[0], 'b'), 3);
        assert_eq!(cols, vec![r(0, 0, 1706, 1400), r(1706, 0, 3413, 1400), r(3413, 0, 5120, 1400)]);
        // Two windows are halves; one window takes the whole width (never more than three).
        assert_eq!(columns(work(SCREENS[0], 'b'), 2), vec![r(0, 0, 2560, 1400), r(2560, 0, 5120, 1400)]);
        assert_eq!(columns(work(SCREENS[0], 'b'), 1), vec![r(0, 0, 5120, 1400)]);
        assert_eq!(columns(work(SCREENS[0], 'b'), 7).len(), 3);
        assert!(columns(work(SCREENS[0], 'b'), 0).is_empty());
    }

    #[test]
    fn focus_is_a_centred_two_thirds_column_with_a_taskbar_on_each_edge() {
        for mon in SCREENS {
            for edge in ['b', 't', 'l', 'r'] {
                let w = work(mon, edge);
                let f = focus_column(w);
                assert!(inside(f, w));
                assert_eq!((f.top, f.bottom), (w.top, w.bottom));
                assert_eq!(f.width(), w.width() * 2 / 3);
                // Centred to within one pixel.
                assert!(((f.left - w.left) - (w.right - f.right)).abs() <= 1);
            }
        }
        assert_eq!(focus_column(work(SCREENS[0], 'b')), r(853, 0, 4266, 1400));
    }

    #[test]
    fn record_is_the_largest_centred_16_by_9_that_fits() {
        // 32:9 is as tall as the work area.
        let f = record_frame(work(SCREENS[0], 'b'));
        assert_eq!(f.height(), 1400);
        assert_eq!(f.width(), 2488);
        assert_eq!(f, r(1316, 0, 3804, 1400));
        // 3840 by 1080 with the taskbar at the top.
        let f = record_frame(work(SCREENS[1], 't'));
        assert_eq!((f.height(), f.width()), (1040, 1848));
        assert_eq!((f.top, f.bottom), (40, 1080));
        // An ordinary 16:9 monitor: the work area is a little wider than 16:9 at the bottom
        // taskbar, so it is as tall as the area, and with a side taskbar it is as wide.
        let f = record_frame(work(SCREENS[2], 'l'));
        assert_eq!(f.width(), 2520);
        assert_eq!(f.height(), 1417);
        assert!(f.top > 0 && f.bottom < 1440, "centred vertically");
        for mon in SCREENS {
            for edge in ['b', 't', 'l', 'r', 'n'] {
                let w = work(mon, edge);
                let f = record_frame(w);
                assert!(inside(f, w));
                assert!((f.width() as i64 * 9 - f.height() as i64 * 16).abs() <= 16, "16:9 within rounding");
                assert!(f.width() == w.width() || f.height() == w.height(), "as large as fits");
            }
        }
    }

    #[test]
    fn thirds_keep_windows_in_the_order_they_already_stand() {
        // Z order: A at x=3000, B at x=100, C at x=1500.
        assert_eq!(column_order(&[3000, 100, 1500]), vec![2, 0, 1]);
        assert_eq!(column_order(&[10, 10, 10]), vec![0, 1, 2]);
        assert_eq!(column_order(&[]), Vec::<usize>::new());
        let w = work(SCREENS[0], 'b');
        let placed = plan(Layout::Thirds, w, &[(1, 3000), (2, 100), (3, 1500)]);
        let cols = columns(w, 3);
        assert_eq!(placed, vec![(1, cols[2]), (2, cols[0]), (3, cols[1])]);
        // Four windows offered: only the top three are placed.
        assert_eq!(plan(Layout::Thirds, w, &[(1, 0), (2, 1), (3, 2), (4, 3)]).len(), 3);
        // Two windows: halves.
        let two = plan(Layout::Thirds, w, &[(1, 0), (2, 900)]);
        assert_eq!(two, vec![(1, r(0, 0, 2560, 1400)), (2, r(2560, 0, 5120, 1400))]);
    }

    #[test]
    fn focus_and_record_place_only_the_top_window() {
        let w = work(SCREENS[0], 'b');
        let list = [(7, 0), (8, 500), (9, 900)];
        assert_eq!(plan(Layout::Focus, w, &list), vec![(7, focus_column(w))]);
        assert_eq!(plan(Layout::Record, w, &list), vec![(7, record_frame(w))]);
        assert!(plan(Layout::Focus, w, &[]).is_empty());
        assert!(plan(Layout::Thirds, w, &[]).is_empty());
    }

    #[test]
    fn invisible_borders_are_compensated_and_odd_insets_are_ignored() {
        let target = r(1000, 0, 2000, 1000);
        // The usual Windows 10 and 11 frame: 7 px left, right and bottom.
        let win = r(993, 0, 2007, 1007);
        let frame = r(1000, 0, 2000, 1000);
        assert_eq!(outer_target(target, win, frame), r(993, 0, 2007, 1007));
        // Frame outside the window rectangle (negative inset) or far away: ignored.
        assert_eq!(outer_target(target, r(0, 0, 100, 100), r(500, 500, 600, 600)), target);
        assert_eq!(outer_target(target, r(10, 10, 100, 100), r(5, 5, 200, 200)), target);
    }

    fn mon(id: isize, w: i32, h: i32) -> Monitor {
        Monitor { id, rect: r(0, 0, w, h), work: r(0, 0, w, h - 40) }
    }

    #[test]
    fn the_big_screen_is_the_widest_monitor_that_is_not_the_wall() {
        // The wall is a 2560 by 720 strip; the owner's monitor is 32:9.
        let list = [mon(1, 2560, 720), mon(2, 5120, 1440), mon(3, 1920, 1080)];
        assert_eq!(choose_monitor(&list, 1), Some(1));
        assert_eq!(choose_monitor(&[mon(2, 3840, 1080), mon(1, 2560, 720)], 1), Some(0));
        // An ordinary 16:9 monitor is chosen when it is the only other one.
        assert_eq!(choose_monitor(&[mon(1, 2560, 720), mon(2, 2560, 1440)], 1), Some(1));
        // The widest wins even when the other one is bigger.
        assert_eq!(choose_monitor(&[mon(1, 2560, 720), mon(2, 3840, 2160), mon(3, 3440, 1440)], 1), Some(2));
        // Equal ratio: the larger one.
        assert_eq!(choose_monitor(&[mon(1, 2560, 720), mon(2, 1920, 1080), mon(3, 3840, 2160)], 1), Some(2));
    }

    #[test]
    fn with_only_the_wall_there_is_no_big_screen() {
        assert_eq!(choose_monitor(&[mon(1, 2560, 720)], 1), None);
        assert_eq!(choose_monitor(&[], 1), None);
        assert_eq!(choose_monitor(&[mon(1, 2560, 720), mon(2, 0, 0)], 1), None);
    }

    fn ok(id: isize) -> WinRec {
        WinRec { id, monitor: 5, visible: true, has_title: true, ..Default::default() }
    }

    #[test]
    fn the_filter_keeps_only_ordinary_windows_on_the_big_screen_in_z_order() {
        let recs = [
            ok(1),
            WinRec { minimised: true, ..ok(2) },
            WinRec { own_process: true, ..ok(3) },
            WinRec { monitor: 9, ..ok(4) },
            WinRec { visible: false, ..ok(5) },
            WinRec { cloaked: true, ..ok(6) },
            WinRec { has_title: false, ..ok(7) },
            WinRec { owned: true, ..ok(8) },
            WinRec { tool_window: true, ..ok(9) },
            WinRec { shell: true, ..ok(10) },
            WinRec { fixed_size: true, ..ok(11) },
            WinRec { out_of_reach: true, ..ok(12) },
            ok(13),
            ok(14),
            ok(15),
        ];
        let ids = |max| pick_windows(&recs, 5, max).into_iter().map(|i| recs[i].id).collect::<Vec<_>>();
        assert_eq!(ids(3), vec![1, 13, 14]);
        assert_eq!(ids(1), vec![1]);
        assert_eq!(ids(10), vec![1, 13, 14, 15]);
        assert!(pick_windows(&recs, 77, 3).is_empty());
        assert!(pick_windows(&[], 5, 3).is_empty());
    }

    #[test]
    fn the_walls_own_and_minimised_windows_are_never_chosen() {
        let only_bad = [WinRec { own_process: true, ..ok(1) }, WinRec { minimised: true, ..ok(2) }];
        assert!(pick_windows(&only_bad, 5, 3).is_empty());
    }

    #[test]
    fn undo_is_one_step_and_expires() {
        let t0 = Instant::now();
        let mut slot = Some(UndoSet::new(vec![1, 2, 3], t0));
        assert_eq!(take_undo(&mut slot, t0 + Duration::from_secs(5)), Some(vec![1, 2, 3]));
        assert!(slot.is_none(), "a second undo finds nothing");
        assert_eq!(take_undo(&mut slot, t0), None);

        let mut stale = Some(UndoSet::new(vec![1], t0));
        assert_eq!(take_undo(&mut stale, t0 + Duration::from_secs(300)), None);
        assert!(stale.is_none(), "an expired set is dropped");

        let mut empty: Option<UndoSet<i32>> = Some(UndoSet::new(vec![], t0));
        assert_eq!(take_undo(&mut empty, t0), None);

        // The page shows the button for 60 seconds; the command still works at 60.
        let mut edge = Some(UndoSet::new(vec![1], t0));
        assert_eq!(take_undo(&mut edge, t0 + Duration::from_secs(60)), Some(vec![1]));
    }

    #[test]
    fn the_commands_are_gated_to_wall2_before_anything_else() {
        assert_eq!(require_wall2("main"), Err("forbidden".to_string()));
        let src = include_str!("wall2_arrange.rs");
        for name in ["pub async fn wall2_arrange_status(", "pub async fn wall2_arrange(", "pub async fn wall2_arrange_undo("] {
            let at = src.find(name).expect("command");
            let body = &src[at..];
            let open = body.find('{').expect("body");
            let first = body[open + 1..].trim_start();
            assert!(first.starts_with("require_wall2(window.label())?;"), "{name}: {}", &first[..first.len().min(60)]);
        }
    }
}
