//! The stage pop-out commands: thin glue over `wall2_stagepop.rs` (the rules and tests live there).
//! Each command refuses any window but `wall2`, answers with the status or one fixed word
//! (`not connected`, `invalid`, `hidden`, `failed`, `forbidden`), and runs its blocking work (Credential
//! Manager, the monitor list) off the thread that serves the web view. The pairing code leaves this
//! process only as the answer to `wall2_stagepop_token`, once.

use crate::wall2_stagepop::{loopback, parse_settings, run, Cmd, Core, CredVault, StatusView, SETTINGS_FILE};
use crate::wall2_window::MonitorRect;
use std::sync::{Arc, OnceLock};
use tauri::{Emitter, Manager};

static CORE: OnceLock<Arc<Core>> = OnceLock::new();

/// The pop-out's home: the top left of the monitor that is exactly 1024 by 600 (the Elgato).
pub(crate) fn elgato_origin(monitors: &[MonitorRect]) -> Option<(i32, i32)> {
    monitors.iter().find(|m| m.width == 1024 && m.height == 600).map(|m| (m.x, m.y))
}

fn elgato() -> Option<(i32, i32)> {
    #[cfg(windows)]
    {
        elgato_origin(&crate::wall2_window::monitor_rects())
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// Starts the server thread. Called once from setup, for the wall2 window only.
pub fn start(app: tauri::AppHandle) {
    let dir = app.path().app_config_dir().ok();
    let path = dir.as_ref().map(|d| d.join(SETTINGS_FILE));
    let settings = path.as_ref().and_then(|p| std::fs::read_to_string(p).ok()).map(|t| parse_settings(&t)).unwrap_or_default();
    let core = Arc::new(Core::new(Box::new(CredVault), settings));
    core.set_path(path);
    let emitter = Arc::clone(&core);
    let handle = app.clone();
    core.set_notifier(Box::new(move || {
        let _ = handle.emit("stagepop-state", emitter.status(elgato()));
    }));
    if CORE.set(Arc::clone(&core)).is_err() {
        return;
    }
    let _ = std::thread::Builder::new().name("stagepop-accept".into()).spawn(move || run(core, loopback()));
}

fn core() -> Result<Arc<Core>, String> {
    CORE.get().cloned().ok_or_else(|| "failed".to_string())
}

fn gate(window: &tauri::WebviewWindow) -> Result<(), String> {
    crate::wall2_meet::require_wall2(window.label())
}

async fn off_thread<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|_| "failed".to_string())?
}

#[tauri::command]
pub async fn wall2_stagepop_status(window: tauri::WebviewWindow) -> Result<StatusView, String> {
    gate(&window)?;
    off_thread(|| Ok(core()?.status(elgato()))).await
}

#[tauri::command]
pub async fn wall2_stagepop_send(window: tauri::WebviewWindow, cmd: Cmd) -> Result<(), String> {
    gate(&window)?;
    off_thread(move || core()?.send(&cmd, elgato()).map_err(str::to_string)).await
}

/// `show` or `new`. The one place the pairing code is handed to the web view, and only for the one-time show.
#[tauri::command]
pub async fn wall2_stagepop_token(window: tauri::WebviewWindow, action: String) -> Result<String, String> {
    gate(&window)?;
    off_thread(move || core()?.token_action(&action).map_err(str::to_string)).await
}

#[tauri::command]
pub async fn wall2_stagepop_placement_set(window: tauri::WebviewWindow, left: i32, top: i32) -> Result<(), String> {
    gate(&window)?;
    off_thread(move || core()?.placement_set(left, top).map_err(str::to_string)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(x: i32, y: i32, width: u32, height: u32) -> MonitorRect {
        MonitorRect { x, y, width, height }
    }

    #[test]
    fn the_elgato_is_the_monitor_exactly_1024_by_600() {
        let all = [m(0, 0, 2560, 1440), m(2560, 0, 2560, 720), m(-1024, 200, 1024, 600)];
        assert_eq!(elgato_origin(&all), Some((-1024, 200)));
        assert_eq!(elgato_origin(&all[..2]), None);
        assert_eq!(elgato_origin(&[m(5, 5, 1024, 601), m(6, 6, 1025, 600)]), None);
        assert_eq!(elgato_origin(&[]), None);
    }

    #[test]
    fn the_first_of_two_matches_wins() {
        assert_eq!(elgato_origin(&[m(1, 2, 1024, 600), m(3, 4, 1024, 600)]), Some((1, 2)));
    }
}
