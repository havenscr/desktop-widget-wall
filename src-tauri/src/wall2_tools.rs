//! Wall 2's Tools drawer: open the keys file.
//!
//! The page sends nothing. The path is fixed here to `keys.json` in the app config folder (the
//! folder `feeds.json` lives in); a path is never taken from the page. If the file exists it
//! opens in the default editor, otherwise the folder opens so the file can be made. Only the
//! `wall2` window may ask. Errors are two fixed words: `not-configured` (no config folder on
//! this PC) and `failed` (the opener refused or the folder could not be made).

use std::path::{Path, PathBuf};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

const KEYS_FILE: &str = "keys.json";

/// What to open for a config folder: the keys file when it is there, else the folder.
pub(crate) fn target_for(dir: &Path, file_exists: bool) -> PathBuf {
    if file_exists {
        dir.join(KEYS_FILE)
    } else {
        dir.to_path_buf()
    }
}

/// The calling window first, then the fixed path.
fn check(label: &str) -> Result<(), String> {
    crate::wall2_meet::require_wall2(label)
}

/// The file and opener work, run off the thread that serves the web view.
fn open_keys(app: &tauri::AppHandle) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|_| "not-configured".to_string())?;
    let exists = dir.join(KEYS_FILE).is_file();
    if !exists {
        std::fs::create_dir_all(&dir).map_err(|_| "failed".to_string())?;
    }
    let target = target_for(&dir, exists);
    app.opener().open_path(target.to_string_lossy().to_string(), None::<&str>).map_err(|_| "failed".to_string())
}

/// Open `keys.json` in the default editor, or the config folder when there is no file yet.
#[tauri::command]
pub async fn wall2_open_keys_file(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    check(window.label())?;
    tauri::async_runtime::spawn_blocking(move || open_keys(&app)).await.map_err(|_| "failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_the_file_when_it_exists() {
        let dir = Path::new("config");
        assert_eq!(target_for(dir, true), dir.join("keys.json"));
    }

    #[test]
    fn opens_the_folder_when_there_is_no_file() {
        let dir = Path::new("config");
        assert_eq!(target_for(dir, false), dir.to_path_buf());
    }

    #[test]
    fn only_the_wall_window_may_ask() {
        assert!(check("main").is_err());
        assert!(check("wall2").is_ok());
    }

    #[test]
    fn the_window_check_is_the_first_statement_of_the_command() {
        let src = include_str!("wall2_tools.rs");
        let at = src.find("pub async fn wall2_open_keys_file(").expect("command");
        let body = &src[at..];
        let open = body.find('{').expect("body");
        let first = body[open + 1..].trim_start();
        assert!(first.starts_with("check(window.label())?;"), "first statement: {}", &first[..first.len().min(60)]);
    }
}
