//! Whether a Camtasia recorder window is open, for the Recording page. Wall window only.
//!
//! The answer is one word: `open`, `none` or `unknown`. No title, path or process id leaves this
//! module; a title is only tested for a starting word. The read is cached for two seconds so a
//! fast poll cannot spin the window list. Recording itself is not read here (the mic and camera
//! signal in `wall2_signals.rs` stays the only source for that).

use crate::wall2_winutil::exe_file_part;
use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// The recorder's program names, lower case. The editor (`camtasiastudio.exe`, `camtasia.exe`) is not the recorder.
const RECORDER_EXES: [&str; 2] = ["camtasiarecorder.exe", "camrecorder.exe"];
/// The recorder window's title starts with this.
const RECORDER_TITLE: &str = "Camtasia Recorder";
/// A repeat read inside this time gets the last answer.
const CACHE: Duration = Duration::from_secs(2);

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Open,
    None,
    Unknown,
}

#[derive(Serialize, Clone, Copy)]
pub struct RecorderView {
    state: State,
}

/// True when an image path's file part is a recorder's program. The folder never counts.
pub(crate) fn is_recorder_exe(file_part: &str) -> bool {
    RECORDER_EXES.contains(&exe_file_part(file_part).as_str())
}

/// True when a window belongs to the recorder: its program is one of the known names, or its
/// title starts with the recorder's name and the program is a Camtasia one (a name starting `cam`),
/// so a browser tab titled the same does not count.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub(crate) fn is_recorder_window(file_part: &str, title_is_recorder: impl FnOnce() -> bool) -> bool {
    is_recorder_exe(file_part) || (exe_file_part(file_part).starts_with("cam") && !is_editor_exe(file_part) && title_is_recorder())
}

/// Whether a title starts with the recorder's name (the tests' stand in for `sys::title_matches`).
#[cfg(test)]
pub(crate) fn title_is_recorder(title: &str) -> bool {
    crate::wall2_winutil::title_starts_with(title, RECORDER_TITLE)
}

fn is_editor_exe(file_part: &str) -> bool {
    matches!(exe_file_part(file_part).as_str(), "camtasiastudio.exe" | "camtasia.exe")
}

/// The word for a read: no windows listed at all is unknown, a recorder among them is open.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub(crate) fn state_of(listed: usize, recorder_found: bool) -> State {
    if recorder_found {
        State::Open
    } else if listed == 0 {
        State::Unknown
    } else {
        State::None
    }
}

#[cfg(windows)]
fn read_now() -> State {
    use crate::wall2_winutil::sys;
    use std::collections::HashMap;
    use windows::Win32::UI::WindowsAndMessaging::IsWindowVisible;
    let windows = sys::top_level_windows();
    let mut images: HashMap<u32, Option<String>> = HashMap::new();
    let mut found = false;
    for h in &windows {
        let h = *h;
        if !unsafe { IsWindowVisible(sys::hwnd(h)).as_bool() } || !sys::has_title(h) {
            continue;
        }
        let pid = sys::pid_of(h);
        let Some(image) = images.entry(pid).or_insert_with(|| sys::image_path(pid)).clone() else {
            continue;
        };
        if is_recorder_window(&image, || sys::title_matches(h, RECORDER_TITLE)) {
            found = true;
            break;
        }
    }
    state_of(windows.len(), found)
}

#[cfg(not(windows))]
fn read_now() -> State {
    State::Unknown
}

static LAST: Mutex<Option<(Instant, State)>> = Mutex::new(None);

fn read_cached() -> State {
    let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((at, state)) = *last {
        if at.elapsed() < CACHE {
            return state;
        }
    }
    let state = read_now();
    *last = Some((Instant::now(), state));
    state
}

#[tauri::command]
pub async fn wall2_recorder_status(window: tauri::WebviewWindow) -> Result<RecorderView, String> {
    crate::wall2_meet::require_wall2(window.label())?;
    tauri::async_runtime::spawn_blocking(|| RecorderView { state: read_cached() }).await.map_err(|_| "failed".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recorder_programs_are_in_and_the_editor_and_others_are_out() {
        assert!(is_recorder_exe("camtasiarecorder.exe"));
        assert!(is_recorder_exe("CamRecorder.exe"));
        assert!(is_recorder_exe(r"C:\Program Files\TechSmith\Camtasia 2024\CamtasiaRecorder.exe"));
        assert!(!is_recorder_exe("camtasiastudio.exe"));
        assert!(!is_recorder_exe("camtasia.exe"));
        assert!(!is_recorder_exe("chrome.exe"));
        assert!(!is_recorder_exe(""));
    }

    #[test]
    fn the_folder_never_makes_a_recorder() {
        assert!(!is_recorder_exe(r"C:\CamRecorder.exe\other.exe"));
    }

    #[test]
    fn a_window_counts_by_program_or_by_title_in_a_camtasia_program() {
        let titled = |t: &'static str| move || title_is_recorder(t);
        assert!(is_recorder_window("camrecorder.exe", titled("anything")));
        assert!(is_recorder_window("camtasiaapp.exe", titled("Camtasia Recorder")));
        assert!(is_recorder_window("camtasiaapp.exe", titled("camtasia recorder - ready")));
        // The editor is never the recorder, whatever its title says.
        assert!(!is_recorder_window("camtasia.exe", titled("Camtasia Recorder")));
        assert!(!is_recorder_window("camtasiastudio.exe", titled("Camtasia Recorder")));
        // A browser tab with the same title is not it.
        assert!(!is_recorder_window("chrome.exe", titled("Camtasia Recorder")));
        assert!(!is_recorder_window("camtasiaapp.exe", titled("Untitled")));
    }

    #[test]
    fn no_windows_listed_is_unknown_and_never_none() {
        assert_eq!(state_of(0, false), State::Unknown);
        assert_eq!(state_of(40, false), State::None);
        assert_eq!(state_of(40, true), State::Open);
    }

    #[test]
    fn the_answer_is_one_lower_case_word() {
        assert_eq!(serde_json::to_string(&RecorderView { state: State::Open }).unwrap(), r#"{"state":"open"}"#);
        assert_eq!(serde_json::to_string(&State::None).unwrap(), r#""none""#);
        assert_eq!(serde_json::to_string(&State::Unknown).unwrap(), r#""unknown""#);
    }
}
