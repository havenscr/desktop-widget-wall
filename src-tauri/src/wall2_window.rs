//! Wall 2 window placement: fill the Corsair Xeneon Edge strip (2560 by 720
//! physical pixels) edge to edge. Everything is in physical pixels, straight
//! from the monitor list, so no display scale can skew the rectangle.

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

fn monitor_rects(window: &tauri::WebviewWindow) -> Vec<MonitorRect> {
    window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(to_rect)
        .collect()
}

fn to_rect(m: &tauri::Monitor) -> MonitorRect {
    let position = *m.position();
    let size = *m.size();
    MonitorRect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    }
}

/// Move Wall 2 onto the chosen monitor and size it to the monitor.
pub fn place_at_startup(window: &tauri::WebviewWindow) {
    let monitors = monitor_rects(window);
    let primary = window.primary_monitor().ok().flatten().map(|m| to_rect(&m));
    match startup_target(&monitors, primary) {
        Some(rect) => fill(window, rect),
        None => println!("[Wall2] no monitor found, leaving the window where it is"),
    }
}

/// After a display change: move onto an exact strip if one is present, and do
/// nothing otherwise (never jump to the main monitor on unplug).
pub fn follow_strip(window: &tauri::WebviewWindow) {
    let Some(rect) = exact_strip(&monitor_rects(window)) else {
        return;
    };
    if let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) {
        if pos.x == rect.x
            && pos.y == rect.y
            && size.width == rect.width
            && size.height == rect.height
        {
            return;
        }
    }
    fill(window, rect);
}

fn fill(window: &tauri::WebviewWindow, rect: MonitorRect) {
    // Move first, so a display scale change on arrival happens before the size.
    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
        x: rect.x,
        y: rect.y,
    }));
    let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
        width: rect.width,
        height: rect.height,
    }));
    println!(
        "[Wall2] target {:?} scale {:?} outer_pos {:?} outer_size {:?} inner_size {:?}",
        rect,
        window.scale_factor().ok(),
        window.outer_position().ok(),
        window.outer_size().ok(),
        window.inner_size().ok()
    );
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
    fn empty_list_falls_back_to_primary() {
        let primary = r(0, 1920, 1080);
        assert_eq!(startup_target(&[], Some(primary)), Some(primary));
    }

    #[test]
    fn empty_and_no_primary_is_none() {
        assert_eq!(startup_target(&[], None), None);
    }
}
