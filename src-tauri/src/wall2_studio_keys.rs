//! StreamYard studio keys: the studio window pick and the five studio chords (Solo, Two up, Share,
//! Go live, End show) of the On Air Live page.
//!
//! The window is picked by the owner bringing it to the front within 10 seconds, and only a
//! visible top-level window of a fixed browser image (Firefox, Chrome, Edge) is taken. It is kept in
//! memory only. The chords come from `keys.json`, key `studio`; nothing is typed that is not in that
//! file, and a chord Windows would not accept is refused. A window title can only refuse a send (it
//! must contain "StreamYard"), never pick or redirect one. The remembered window is looked at again
//! before every send. Go live and End show are refused here without `confirm`, whatever the page does.
//! No title, handle, process id or chord crosses to the page, and nothing is logged.
#![cfg_attr(not(windows), allow(dead_code))]

use crate::wall2_keys::{blocked_chord, parse_steps, Refusal, Step};
use crate::wall2_omni::require_wall2;
use serde::Serialize;
use serde_json::Value;

/// The keys, in the order of the page's row.
const KEYS: [&str; 5] = ["solo", "two", "share", "golive", "end"];

/// How long a pick waits for the owner to bring the window forward.
#[cfg_attr(not(windows), allow(dead_code))]
const PICK_MS: u64 = 10_000;

/// Whether a key starts or ends the broadcast, so it needs the second click.
pub(crate) fn needs_confirm(key: &str) -> bool {
    key == "golive" || key == "end"
}

/// The browser a program image is, from its file name; None for anything else (Brave is left out).
pub(crate) fn browser_kind(image: &str) -> Option<&'static str> {
    let lower = image.to_ascii_lowercase();
    match lower.rsplit(['\\', '/']).next().unwrap_or("") {
        "firefox.exe" => Some("firefox"),
        "chrome.exe" => Some("chrome"),
        "msedge.exe" => Some("edge"),
        _ => None,
    }
}

/// The extra refusal a title may give: the title must contain "StreamYard".
pub(crate) fn title_allows(title: &str) -> bool {
    title.to_ascii_lowercase().contains("streamyard")
}

/// StreamYard's own layout hotkeys (Shift+1 Solo, Shift+2 the second layout) and the two the owner sets in
/// StreamYard Settings, Hotkeys (Shift+Z Go live, Shift+X End). Share has no default. Used only when
/// `keys.json` is missing or has no `studio` entry at all.
const DEFAULTS: &str = r#"{ "studio": { "solo": "Shift+1", "two": "Shift+2", "golive": "Shift+Z", "end": "Shift+X" } }"#;

/// How many times a key is pressed: StreamYard wants Go live and End show pressed twice to confirm.
pub(crate) fn presses(key: &str) -> u8 {
    if needs_confirm(key) {
        2
    } else {
        1
    }
}

/// The chords to use from the file's text: the defaults only when the text is valid JSON without a
/// `studio` key; a `studio` value that is not an object, or text that is not JSON, gives none at all.
pub(crate) fn chords_for(text: &str) -> Vec<(&'static str, Vec<Step>)> {
    let Ok(root) = serde_json::from_str::<Value>(text) else { return Vec::new() };
    match root.get("studio") {
        None => studio_chords(DEFAULTS),
        Some(v) if v.is_object() => studio_chords(text),
        Some(_) => Vec::new(),
    }
}

/// The chords to use from one read of `keys.json`: only a missing file gets the defaults. A read error,
/// an oversized file, invalid UTF-8 or malformed JSON gives none, so every studio key is `not set up`.
pub(crate) fn chords_from_read(read: Result<Vec<u8>, std::io::ErrorKind>) -> Vec<(&'static str, Vec<Step>)> {
    match read {
        Err(std::io::ErrorKind::NotFound) => studio_chords(DEFAULTS),
        Err(_) => Vec::new(),
        Ok(buf) if buf.len() > 32 * 1024 => Vec::new(),
        Ok(buf) => match String::from_utf8(buf) {
            Ok(text) => chords_for(&text),
            Err(_) => Vec::new(),
        },
    }
}

/// The chords of `keys.json` key `studio`: each one that parses and is not a refused chord. A missing
/// key or a bad value leaves that key out.
pub(crate) fn studio_chords(text: &str) -> Vec<(&'static str, Vec<Step>)> {
    let Ok(root) = serde_json::from_str::<Value>(text) else { return Vec::new() };
    let Some(studio) = root.get("studio").and_then(Value::as_object) else { return Vec::new() };
    let mut out = Vec::new();
    for name in KEYS {
        let Some(steps) = studio.get(name).and_then(Value::as_str).and_then(parse_steps) else { continue };
        if !blocked_chord(&steps) {
            out.push((name, steps));
        }
    }
    out
}

/// What a click may do before any window is looked at: the chord to send, or the refusal word.
pub(crate) fn plan(key: &str, confirm: bool, chords: &[(&'static str, Vec<Step>)]) -> Result<Vec<Step>, &'static str> {
    if !KEYS.contains(&key) {
        return Err("not set up");
    }
    if needs_confirm(key) && !confirm {
        return Err("needs confirm");
    }
    chords.iter().find(|(name, _)| *name == key).map(|(_, steps)| steps.clone()).ok_or("not set up")
}

/// The fixed word for a refusal of the shared send.
pub(crate) fn refusal_word(r: Refusal) -> &'static str {
    match r {
        Refusal::NoApp => "no studio window",
        Refusal::NotStreamYard => "not streamyard",
        Refusal::Gone => "gone",
        Refusal::Busy => "busy",
        Refusal::NoKey => "not set up",
        Refusal::Failed => "failed",
        Refusal::Unsupported => "unsupported",
        Refusal::Elevated | Refusal::NotForward | Refusal::NotInstalled => "not forward",
    }
}

/// The state of the pick for the page. `armed` wins while a pick waits.
pub(crate) fn pick_state(armed: bool, remembered: bool, alive: bool, minimized: bool) -> &'static str {
    if armed {
        "waiting"
    } else if !remembered {
        "none"
    } else if !alive {
        "gone"
    } else if minimized {
        "minimized"
    } else {
        "picked"
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct PickStart {
    state: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct PickStatus {
    state: &'static str,
    browser: Option<&'static str>,
    /// Which studio keys have a chord in `keys.json`: names only, never a chord.
    keys: Vec<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Sent {
    sent: &'static str,
    at: u64,
}

/// The studio chords of the keys file, read fresh; the defaults only when the file is missing or has no `studio` entry.
fn load_chords(app: &tauri::AppHandle) -> Vec<(&'static str, Vec<Step>)> {
    use tauri::Manager;
    match app.path().app_config_dir() {
        Ok(dir) => chords_from_read(crate::wall2_keys::read_keys_file(&dir.join("keys.json"))),
        Err(_) => Vec::new(),
    }
}

/// Wait for the owner to bring the studio window to the front. Answers at once; the pick runs for 10 seconds.
#[tauri::command]
pub async fn wall2_studio_pick_start(window: tauri::WebviewWindow) -> Result<PickStart, String> {
    require_wall2(window.label())?;
    #[cfg(windows)]
    {
        win::start_pick()?;
        Ok(PickStart { state: "waiting" })
    }
    #[cfg(not(windows))]
    {
        Err(Refusal::Unsupported.word().to_string())
    }
}

/// Where the pick stands, and which studio keys have a chord. Never a title, handle or id.
#[tauri::command]
pub async fn wall2_studio_pick_status(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<PickStatus, String> {
    require_wall2(window.label())?;
    let keys: Vec<&'static str> = load_chords(&app).into_iter().map(|(name, _)| name).collect();
    #[cfg(windows)]
    {
        let (state, browser) = tauri::async_runtime::spawn_blocking(win::status).await.map_err(|_| Refusal::Busy.word().to_string())?;
        Ok(PickStatus { state, browser, keys })
    }
    #[cfg(not(windows))]
    {
        Ok(PickStatus { state: "none", browser: None, keys })
    }
}

/// Send one studio key to the picked window. Answers what was sent, or a refusal word.
#[tauri::command]
pub async fn wall2_studio_key(window: tauri::WebviewWindow, app: tauri::AppHandle, key: String, confirm: bool) -> Result<Sent, String> {
    require_wall2(window.label())?;
    let chords = load_chords(&app);
    let steps = plan(&key, confirm, &chords).map_err(|w| w.to_string())?;
    let name = KEYS.iter().copied().find(|k| *k == key).ok_or_else(|| "not set up".to_string())?;
    #[cfg(windows)]
    {
        let times = presses(name);
        tauri::async_runtime::spawn_blocking(move || win::send(&steps, times))
            .await
            .map_err(|_| Refusal::Busy.word().to_string())?
            .map_err(|r| refusal_word(r).to_string())?;
        let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
        Ok(Sent { sent: name, at })
    }
    #[cfg(not(windows))]
    {
        let _ = (steps, name);
        Err(Refusal::Unsupported.word().to_string())
    }
}

#[cfg(windows)]
mod win {
    use super::*;
    use crate::wall2_keys::{win as keys_win, AppDef, Matcher, Remembered};
    use crate::wall2_winutil::{is_shell_class, sys};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, InternalGetWindowText, IsIconic, IsWindow, IsWindowVisible};

    /// The picked window, in memory only.
    static PICKED: Mutex<Option<Remembered>> = Mutex::new(None);
    /// When the running pick gives up; None when no pick waits.
    static ARMED_UNTIL: Mutex<Option<Instant>> = Mutex::new(None);
    /// A new pick replaces the one before it: the older thread sees the number change and ends.
    static ROUND: AtomicU64 = AtomicU64::new(0);

    fn armed() -> bool {
        ARMED_UNTIL.lock().ok().and_then(|g| *g).is_some_and(|t| Instant::now() < t)
    }

    pub fn start_pick() -> Result<(), String> {
        let round = ROUND.fetch_add(1, Ordering::SeqCst) + 1;
        let until = Instant::now() + Duration::from_millis(PICK_MS);
        if let Ok(mut g) = ARMED_UNTIL.lock() {
            *g = Some(until);
        }
        let first = unsafe { GetForegroundWindow() }.0 as isize;
        std::thread::Builder::new()
            .name("wall2-studio-pick".into())
            .spawn(move || {
                while Instant::now() < until && ROUND.load(Ordering::SeqCst) == round {
                    if let Some(found) = candidate(first) {
                        if ROUND.load(Ordering::SeqCst) == round {
                            if let Ok(mut g) = PICKED.lock() {
                                *g = Some(found);
                            }
                            if let Ok(mut g) = ARMED_UNTIL.lock() {
                                *g = None;
                            }
                        }
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                if ROUND.load(Ordering::SeqCst) == round {
                    if let Ok(mut g) = ARMED_UNTIL.lock() {
                        *g = None;
                    }
                }
            })
            .map(|_| ())
            .map_err(|_| Refusal::Failed.word().to_string())
    }

    /// The foreground window when it is a visible, titled top-level window of a fixed browser image, not the wall,
    /// not the one that was in front when the pick started, and reachable.
    fn candidate(first: isize) -> Option<Remembered> {
        let fg = unsafe { GetForegroundWindow() }.0 as isize;
        if fg == 0 || fg == first {
            return None;
        }
        let pid = sys::pid_of(fg);
        if pid == 0 || pid == std::process::id() || is_shell_class(&sys::class_name(fg)) || !sys::has_title(fg) {
            return None;
        }
        if !unsafe { IsWindowVisible(sys::hwnd(fg)).as_bool() } || sys::keys_blocked(pid) {
            return None;
        }
        let image = sys::image_path(pid)?;
        browser_kind(&image)?;
        Some(Remembered { hwnd: fg, pid, image })
    }

    pub fn status() -> (&'static str, Option<&'static str>) {
        let rem = PICKED.lock().ok().and_then(|g| g.clone());
        let (alive, minimized) = match &rem {
            Some(r) => {
                let hw = sys::hwnd(r.hwnd);
                let alive = unsafe { IsWindow(hw).as_bool() } && sys::pid_of(r.hwnd) == r.pid;
                (alive, alive && unsafe { IsIconic(hw).as_bool() })
            }
            None => (false, false),
        };
        let state = pick_state(armed(), rem.is_some(), alive, minimized);
        let browser = rem.as_ref().and_then(|r| browser_kind(&r.image));
        (state, browser)
    }

    fn title_of(hwnd: isize) -> String {
        let mut buf = [0u16; 256];
        let n = unsafe { InternalGetWindowText(sys::hwnd(hwnd), &mut buf) };
        String::from_utf16_lossy(&buf[..(n.max(0) as usize).min(buf.len())])
    }

    pub fn send(steps: &[Step], times: u8) -> Result<(), Refusal> {
        let rem = PICKED.lock().ok().and_then(|g| g.clone()).ok_or(Refusal::NoApp)?;
        let app = AppDef {
            id: "studio".to_string(),
            name: "Studio".to_string(),
            matcher: Matcher::Exe(vec!["firefox.exe".to_string(), "chrome.exe".to_string(), "msedge.exe".to_string()]),
            fallback: false,
            keys: Vec::new(),
        };
        keys_win::send_studio(&app, &rem, steps, times, &|h| title_allows(&title_of(h)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FILE: &str = r#"{ "apps": [], "studio": { "solo": "Alt+1", "two": "Alt+2", "share": "Alt+3", "golive": "Ctrl+Shift+G", "end": "Win+L", "extra": "Alt+9" } }"#;

    #[test]
    fn only_the_three_browsers_are_picked() {
        assert_eq!(browser_kind("C:\\Program Files\\Mozilla Firefox\\firefox.exe"), Some("firefox"));
        assert_eq!(browser_kind("C:\\X\\CHROME.EXE"), Some("chrome"));
        assert_eq!(browser_kind("C:\\X\\msedge.exe"), Some("edge"));
        assert_eq!(browser_kind("C:\\X\\brave.exe"), None);
        assert_eq!(browser_kind("C:\\X\\notepad.exe"), None);
    }

    #[test]
    fn a_title_only_refuses() {
        assert!(title_allows("Studio | StreamYard - Mozilla Firefox"));
        assert!(!title_allows("Inbox - Mozilla Firefox"));
    }

    #[test]
    fn the_chords_come_from_the_file_and_a_refused_chord_is_left_out() {
        let names: Vec<&str> = studio_chords(FILE).iter().map(|(n, _)| *n).collect();
        assert_eq!(names, vec!["solo", "two", "share", "golive"]);
        assert!(studio_chords("not json").is_empty());
        assert!(studio_chords(r#"{ "apps": [] }"#).is_empty());
        assert!(studio_chords(r#"{ "studio": { "solo": "Alt+Alt" } }"#).is_empty());
    }

    #[test]
    fn with_no_studio_entry_the_defaults_apply_and_share_is_unset() {
        let names = |c: Vec<(&str, Vec<Step>)>| c.iter().map(|(n, _)| n.to_string()).collect::<Vec<_>>();
        let defaults = vec!["solo", "two", "golive", "end"];
        assert_eq!(names(chords_for(r#"{ "apps": [] }"#)), defaults);
        assert_eq!(names(chords_from_read(Err(std::io::ErrorKind::NotFound))), defaults);
        assert!(chords_for(r#"{ "studio": {} }"#).is_empty());
        assert_eq!(names(chords_for(FILE)), vec!["solo", "two", "share", "golive"]);
    }

    #[test]
    fn a_bad_file_never_falls_back_to_the_defaults() {
        assert!(chords_for("not json").is_empty());
        assert!(chords_for(r#"{ "studio": "Shift+1" }"#).is_empty());
        assert!(chords_for(r#"{ "studio": null }"#).is_empty());
        assert!(chords_from_read(Ok(b"not json".to_vec())).is_empty());
        assert!(chords_from_read(Ok(vec![0xff, 0xfe])).is_empty());
        assert!(chords_from_read(Ok(vec![b' '; 40_000])).is_empty());
        assert!(chords_from_read(Err(std::io::ErrorKind::PermissionDenied)).is_empty());
        assert!(chords_from_read(Err(std::io::ErrorKind::Other)).is_empty());
        assert_eq!(chords_from_read(Ok(FILE.as_bytes().to_vec())).len(), 4);
    }

    #[test]
    fn go_live_and_end_are_pressed_twice_and_the_rest_once() {
        assert_eq!(presses("golive"), 2);
        assert_eq!(presses("end"), 2);
        assert_eq!(presses("solo"), 1);
        assert_eq!(presses("share"), 1);
    }

    #[test]
    fn go_live_and_end_need_confirm_and_the_others_do_not() {
        let chords = studio_chords(FILE);
        assert_eq!(plan("golive", false, &chords), Err("needs confirm"));
        assert_eq!(plan("end", false, &chords), Err("needs confirm"));
        assert!(plan("golive", true, &chords).is_ok());
        assert!(plan("solo", false, &chords).is_ok());
    }

    #[test]
    fn a_key_without_a_chord_or_a_name_is_not_set_up() {
        let chords = studio_chords(FILE);
        assert_eq!(plan("end", true, &chords), Err("not set up"));
        assert_eq!(plan("scene", true, &chords), Err("not set up"));
        assert_eq!(plan("solo", false, &[]), Err("not set up"));
    }

    #[test]
    fn the_pick_states() {
        assert_eq!(pick_state(true, true, true, false), "waiting");
        assert_eq!(pick_state(false, false, false, false), "none");
        assert_eq!(pick_state(false, true, false, false), "gone");
        assert_eq!(pick_state(false, true, true, true), "minimized");
        assert_eq!(pick_state(false, true, true, false), "picked");
    }

    #[test]
    fn refusal_words_are_the_fixed_ones() {
        assert_eq!(refusal_word(Refusal::NoApp), "no studio window");
        assert_eq!(refusal_word(Refusal::Gone), "gone");
        assert_eq!(refusal_word(Refusal::NotForward), "not forward");
        assert_eq!(refusal_word(Refusal::NotStreamYard), "not streamyard");
        assert_eq!(refusal_word(Refusal::Busy), "busy");
    }

    #[test]
    fn each_command_checks_the_window_first() {
        assert_eq!(require_wall2("main"), Err("forbidden".to_string()));
        let src = include_str!("wall2_studio_keys.rs").replace("\r\n", "\n");
        let head = "pub async fn ";
        for tail in ["wall2_studio_pick_start(", "wall2_studio_pick_status(", "wall2_studio_key("] {
            let name = format!("{head}{tail}");
            let at = src.find(&name).expect("command");
            let body = &src[at..];
            let open = body.find('{').expect("body");
            let first = body[open + 1..].trim_start();
            assert!(first.starts_with("require_wall2(window.label())?;"), "{name}");
        }
    }

    #[test]
    fn the_send_looks_at_the_window_again_and_the_page_never_gets_a_title() {
        let keys = include_str!("wall2_keys.rs").replace("\r\n", "\n");
        let at = keys.find(&["pub fn send_", "studio("].concat()).expect("send");
        let body = &keys[at..];
        let check = body.find(&["check_", "target("].concat()).expect("check");
        let raise = body.find(&["bring_", "forward("].concat()).expect("raise");
        let play = body.find(&["pl", "ay(steps"].concat()).expect("play");
        assert!(check < raise && raise < play);
        let me = include_str!("wall2_studio_keys.rs").replace("\r\n", "\n");
        let sent = me.find(&["pub struct ", "Sent"].concat()).expect("sent");
        let shape = &me[sent..sent + me[sent..].find('}').expect("end of shape")];
        assert!(!shape.contains("title") && !shape.contains("hwnd") && !shape.contains("pid"));
    }
}
