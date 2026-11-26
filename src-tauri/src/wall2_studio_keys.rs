//! StreamYard studio keys: the studio window pick and the five studio chords (Solo, Two up, Share,
//! Go live, End show) of the On Air Live page.
//!
//! The wall finds the studio window itself: the one visible top-level window of a fixed browser image
//! (Firefox, Chrome, Edge, Brave, Vivaldi, Opera) whose title contains "StreamYard". With none or
//! several, the owner brings the window to the front within 10 seconds (Find window) and that one is
//! taken. The window is kept in memory only and is found again when its handle dies. Every key has a built-in StreamYard default chord; `keys.json`, key `studio`, may override
//! one, and a chord Windows would not accept is refused (the default is used instead). A window title can only refuse a send (it
//! must contain "StreamYard"), never pick or redirect one. The remembered window is looked at again
//! before every send. Go live and End show are refused here without `confirm`, whatever the page does.
//! No title, handle, process id or chord crosses to the page, and nothing is logged.
#![cfg_attr(not(windows), allow(dead_code))]

use crate::wall2_keys::{blocked_chord, parse_steps, Refusal, Remembered, Step};
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

/// The browser a program image is, from its file name; None for anything else.
pub(crate) fn browser_kind(image: &str) -> Option<&'static str> {
    let lower = image.to_ascii_lowercase();
    match lower.rsplit(['\\', '/']).next().unwrap_or("") {
        "firefox.exe" => Some("firefox"),
        "chrome.exe" => Some("chrome"),
        "msedge.exe" => Some("edge"),
        "brave.exe" => Some("brave"),
        "vivaldi.exe" => Some("vivaldi"),
        "opera.exe" => Some("opera"),
        _ => None,
    }
}

/// One visible top-level window, as the scan sees it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Seen {
    pub hwnd: isize,
    pub pid: u32,
    pub image: String,
    pub title: String,
}

/// What a scan of the windows found.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Found {
    None,
    One(Remembered),
    Several,
}

/// The browser windows titled StreamYard among `seen`. A window of any other program is ignored, whatever its title.
pub(crate) fn scan_studio(seen: &[Seen]) -> Found {
    let mut hits = seen.iter().filter(|w| browser_kind(&w.image).is_some() && title_allows(&w.title));
    match (hits.next(), hits.next()) {
        (None, _) => Found::None,
        (Some(w), None) => Found::One(Remembered { hwnd: w.hwnd, pid: w.pid, image: w.image.clone() }),
        (Some(_), Some(_)) => Found::Several,
    }
}

/// The window in use: the kept one while it is alive, else what a fresh scan finds. `scan` runs only when the
/// kept window is missing or dead, so a window that died is looked up again.
pub(crate) fn resolve(kept: Option<Remembered>, alive: impl Fn(&Remembered) -> bool, scan: impl FnOnce() -> Found) -> Found {
    match kept {
        Some(k) if alive(&k) => Found::One(k),
        _ => scan(),
    }
}

/// The extra refusal a title may give: the title must contain "StreamYard".
pub(crate) fn title_allows(title: &str) -> bool {
    title.to_ascii_lowercase().contains("streamyard")
}

/// The built-in chord of each key. Solo, Two up (StreamYard's "Cropped layout") and Share screen are
/// StreamYard's own defaults. Go live and End show are the owner's chosen chords, set once in StreamYard
/// Settings, Hotkeys (Start stream and End stream); they are always two different chords, never a shared
/// toggle. Each key uses its `keys.json` chord when that parses and is allowed, and its default otherwise.
const DEFAULTS: [(&str, &str); 5] = [("solo", "Shift+1"), ("two", "Shift+2"), ("share", "Shift+S"), ("golive", "Shift+Z"), ("end", "Shift+X")];

/// How many times a key is pressed: StreamYard wants Go live and End show pressed twice to confirm.
pub(crate) fn presses(key: &str) -> u8 {
    if needs_confirm(key) {
        2
    } else {
        1
    }
}

/// The built-in chord of one key; None for a name that is not a studio key.
fn default_chord(name: &str) -> Option<Vec<Step>> {
    let (_, chord) = DEFAULTS.iter().find(|(n, _)| *n == name)?;
    parse_steps(chord).filter(|steps| !blocked_chord(steps))
}

/// All five keys: the file's chord for a key when it has a valid one, else the key's built-in chord.
fn with_defaults(file: Vec<(&'static str, Vec<Step>)>) -> Vec<(&'static str, Vec<Step>)> {
    let mut out = Vec::new();
    for name in KEYS {
        let own = file.iter().find(|(n, _)| *n == name).map(|(_, steps)| steps.clone());
        if let Some(steps) = own.or_else(|| default_chord(name)) {
            out.push((name, steps));
        }
    }
    // Go live and End show must never be the same chord, or one press could end a show it started.
    let same = match (out.iter().find(|(n, _)| *n == "golive"), out.iter().find(|(n, _)| *n == "end")) {
        (Some((_, a)), Some((_, b))) => a == b,
        _ => false,
    };
    if same {
        for (name, steps) in out.iter_mut() {
            if needs_confirm(name) {
                if let Some(own) = default_chord(name) {
                    *steps = own;
                }
            }
        }
    }
    out
}

/// The chords to use from the file's text: every key takes its chord from `studio` when that parses and
/// is allowed, and its built-in chord otherwise. Text that is not JSON, or a `studio` value that is not
/// an object, gives the built-in chords.
pub(crate) fn chords_for(text: &str) -> Vec<(&'static str, Vec<Step>)> {
    with_defaults(studio_chords(text))
}

/// The chords to use from one read of `keys.json`: a missing, unreadable, oversized or damaged file
/// gives the built-in chords, so the keys file is never required.
pub(crate) fn chords_from_read(read: Result<Vec<u8>, std::io::ErrorKind>) -> Vec<(&'static str, Vec<Step>)> {
    match read {
        Ok(buf) if buf.len() <= 32 * 1024 => match String::from_utf8(buf) {
            Ok(text) => chords_for(&text),
            Err(_) => with_defaults(Vec::new()),
        },
        _ => with_defaults(Vec::new()),
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

/// The state of the pick for the page. `armed` wins while a pick waits. `several` is a scan that found
/// more than one StreamYard window and nothing is kept.
pub(crate) fn pick_state(armed: bool, remembered: bool, alive: bool, minimized: bool, several: bool) -> &'static str {
    if armed {
        "waiting"
    } else if !remembered {
        if several {
            "several"
        } else {
            "none"
        }
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
    /// Which studio keys have a chord to send: names only, never a chord.
    keys: Vec<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Sent {
    sent: &'static str,
    at: u64,
}

/// The studio chords: the keys file read fresh, each key falling back to its built-in chord.
fn load_chords(app: &tauri::AppHandle) -> Vec<(&'static str, Vec<Step>)> {
    use tauri::Manager;
    match app.path().app_config_dir() {
        Ok(dir) => chords_from_read(crate::wall2_keys::read_keys_file(&dir.join("keys.json"))),
        Err(_) => with_defaults(Vec::new()),
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
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, InternalGetWindowText, IsIconic, IsWindow, IsWindowVisible};

    /// Whether the last scan found more than one StreamYard window.
    static SEVERAL: AtomicBool = AtomicBool::new(false);
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

    fn alive(r: &Remembered) -> bool {
        unsafe { IsWindow(sys::hwnd(r.hwnd)).as_bool() } && sys::pid_of(r.hwnd) == r.pid
    }

    /// Every visible, titled, reachable top-level window of another program, with its image and title.
    fn seen_windows() -> Vec<Seen> {
        let me = std::process::id();
        let mut out = Vec::new();
        for h in sys::top_level_windows() {
            if !unsafe { IsWindowVisible(sys::hwnd(h)).as_bool() } || !sys::has_title(h) {
                continue;
            }
            let pid = sys::pid_of(h);
            if pid == 0 || pid == me || is_shell_class(&sys::class_name(h)) || sys::keys_blocked(pid) {
                continue;
            }
            if let Some(image) = sys::image_path(pid) {
                out.push(Seen { hwnd: h, pid, image, title: title_of(h) });
            }
        }
        out
    }

    /// The window in use: the kept one while alive, else found again. One match is kept; none or several clear it.
    fn current() -> Option<Remembered> {
        let kept = PICKED.lock().ok().and_then(|g| g.clone());
        let found = resolve(kept, alive, || scan_studio(&seen_windows()));
        let (now, several) = match found {
            Found::One(r) => (Some(r), false),
            Found::Several => (None, true),
            Found::None => (None, false),
        };
        SEVERAL.store(several, Ordering::SeqCst);
        if let Ok(mut g) = PICKED.lock() {
            *g = now.clone();
        }
        now
    }

    pub fn status() -> (&'static str, Option<&'static str>) {
        let armed = armed();
        let rem = if armed { PICKED.lock().ok().and_then(|g| g.clone()) } else { current() };
        let minimized = rem.as_ref().is_some_and(|r| unsafe { IsIconic(sys::hwnd(r.hwnd)).as_bool() });
        let state = pick_state(armed, rem.is_some(), rem.is_some(), minimized, SEVERAL.load(Ordering::SeqCst));
        let browser = rem.as_ref().and_then(|r| browser_kind(&r.image));
        (state, browser)
    }

    fn title_of(hwnd: isize) -> String {
        let mut buf = [0u16; 256];
        let n = unsafe { InternalGetWindowText(sys::hwnd(hwnd), &mut buf) };
        String::from_utf16_lossy(&buf[..(n.max(0) as usize).min(buf.len())])
    }

    pub fn send(steps: &[Step], times: u8) -> Result<(), Refusal> {
        let rem = current().ok_or(Refusal::NoApp)?;
        let app = AppDef {
            id: "studio".to_string(),
            name: "Studio".to_string(),
            matcher: Matcher::Exe(["firefox.exe", "chrome.exe", "msedge.exe", "brave.exe", "vivaldi.exe", "opera.exe"].iter().map(|e| e.to_string()).collect()),
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
    fn only_the_six_browsers_are_taken() {
        assert_eq!(browser_kind("C:\\Program Files\\Mozilla Firefox\\firefox.exe"), Some("firefox"));
        assert_eq!(browser_kind("C:\\X\\CHROME.EXE"), Some("chrome"));
        assert_eq!(browser_kind("C:\\X\\msedge.exe"), Some("edge"));
        assert_eq!(browser_kind("C:\\X\\brave.exe"), Some("brave"));
        assert_eq!(browser_kind("C:\\X\\vivaldi.exe"), Some("vivaldi"));
        assert_eq!(browser_kind("C:\\X\\opera.exe"), Some("opera"));
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

    fn names(c: Vec<(&str, Vec<Step>)>) -> Vec<String> {
        c.iter().map(|(n, _)| n.to_string()).collect()
    }

    fn chord_of(c: &[(&'static str, Vec<Step>)], key: &str) -> Vec<Step> {
        c.iter().find(|(n, _)| *n == key).map(|(_, s)| s.clone()).expect("key")
    }

    #[test]
    fn the_defaults_give_all_five_keys() {
        let all = vec!["solo", "two", "share", "golive", "end"];
        assert_eq!(names(chords_for(r#"{ "apps": [] }"#)), all);
        assert_eq!(names(chords_from_read(Err(std::io::ErrorKind::NotFound))), all);
        assert_eq!(names(chords_for(r#"{ "studio": {} }"#)), all);
        assert_eq!(names(chords_for(FILE)), all);
        assert_eq!(chord_of(&chords_for("{}"), "golive"), parse_steps("Shift+Z").unwrap());
        assert_eq!(chord_of(&chords_for("{}"), "end"), parse_steps("Shift+X").unwrap());
        assert_eq!(chord_of(&chords_for("{}"), "solo"), parse_steps("Shift+1").unwrap());
    }

    #[test]
    fn a_partial_studio_object_keeps_the_defaults_for_the_rest() {
        let c = chords_for(r#"{ "studio": { "solo": "Alt+1" } }"#);
        assert_eq!(names(c.clone()).len(), 5);
        assert_eq!(chord_of(&c, "solo"), parse_steps("Alt+1").unwrap());
        assert_eq!(chord_of(&c, "two"), parse_steps("Shift+2").unwrap());
        assert_eq!(chord_of(&c, "share"), parse_steps("Shift+S").unwrap());
    }

    #[test]
    fn a_bad_or_refused_chord_falls_back_to_its_own_default() {
        let c = chords_for(r#"{ "studio": { "solo": "Alt+Alt", "two": "Win+L", "golive": 5, "end": "Alt+9" } }"#);
        assert_eq!(names(c.clone()).len(), 5);
        assert_eq!(chord_of(&c, "solo"), parse_steps("Shift+1").unwrap());
        assert_eq!(chord_of(&c, "two"), parse_steps("Shift+2").unwrap());
        assert_eq!(chord_of(&c, "golive"), parse_steps("Shift+Z").unwrap());
        assert_eq!(chord_of(&c, "end"), parse_steps("Alt+9").unwrap());
    }

    #[test]
    fn a_bad_file_gives_the_defaults() {
        let all = 5;
        assert_eq!(chords_for("not json").len(), all);
        assert_eq!(chords_for(r#"{ "studio": "Shift+1" }"#).len(), all);
        assert_eq!(chords_for(r#"{ "studio": null }"#).len(), all);
        assert_eq!(chords_from_read(Ok(b"not json".to_vec())).len(), all);
        assert_eq!(chords_from_read(Ok(vec![0xff, 0xfe])).len(), all);
        assert_eq!(chords_from_read(Ok(vec![b' '; 40_000])).len(), all);
        assert_eq!(chords_from_read(Err(std::io::ErrorKind::PermissionDenied)).len(), all);
        assert_eq!(chords_from_read(Err(std::io::ErrorKind::Other)).len(), all);
        assert_eq!(chord_of(&chords_from_read(Ok(FILE.as_bytes().to_vec())), "solo"), parse_steps("Alt+1").unwrap());
    }

    #[test]
    fn every_default_parses_and_is_allowed() {
        for (name, _) in DEFAULTS {
            assert!(default_chord(name).is_some(), "{name}");
        }
        assert!(default_chord("scene").is_none());
        assert_eq!(DEFAULTS.len(), KEYS.len());
    }

    #[test]
    fn go_live_and_end_defaults_are_two_different_chords() {
        let c = chords_for("{}");
        assert_ne!(chord_of(&c, "golive"), chord_of(&c, "end"));
    }

    #[test]
    fn a_file_that_gives_go_live_and_end_the_same_chord_falls_back_to_the_two_defaults() {
        let c = chords_for(r#"{ "studio": { "golive": "Alt+9", "end": "Alt+9" } }"#);
        assert_eq!(c.len(), 5);
        assert_eq!(chord_of(&c, "golive"), parse_steps("Shift+Z").unwrap());
        assert_eq!(chord_of(&c, "end"), parse_steps("Shift+X").unwrap());
        let own = chords_for(r#"{ "studio": { "golive": "Alt+8", "end": "Alt+9" } }"#);
        assert_eq!(chord_of(&own, "golive"), parse_steps("Alt+8").unwrap());
        assert_eq!(chord_of(&own, "end"), parse_steps("Alt+9").unwrap());
    }

    #[test]
    fn no_config_folder_gives_the_defaults_not_no_chords() {
        assert_eq!(names(with_defaults(Vec::new())).len(), 5);
        let src = include_str!("wall2_studio_keys.rs").replace("\r\n", "\n");
        let at = src.find(&["fn load_", "chords("].concat()).expect("load");
        let body = &src[at..at + src[at..].find("\n}\n").expect("end")];
        assert!(body.contains(&["Err(_) => with_", "defaults(Vec::new())"].concat()));
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
        assert_eq!(pick_state(true, true, true, false, false), "waiting");
        assert_eq!(pick_state(false, false, false, false, false), "none");
        assert_eq!(pick_state(false, false, false, false, true), "several");
        assert_eq!(pick_state(false, true, false, false, false), "gone");
        assert_eq!(pick_state(false, true, true, true, false), "minimized");
        assert_eq!(pick_state(false, true, true, false, false), "picked");
    }

    fn seen(hwnd: isize, image: &str, title: &str) -> Seen {
        Seen { hwnd, pid: hwnd as u32, image: image.to_string(), title: title.to_string() }
    }

    const SY: &str = "Studio | StreamYard - Google Chrome";

    fn rem(h: isize, image: &str) -> Remembered {
        Remembered { hwnd: h, pid: h as u32, image: image.to_string() }
    }

    #[test]
    fn a_scan_with_no_streamyard_window_finds_none() {
        let w = [seen(1, "C:\\X\\chrome.exe", "Inbox - Gmail"), seen(2, "C:\\X\\notepad.exe", "notes")];
        assert_eq!(scan_studio(&w), Found::None);
        assert_eq!(scan_studio(&[]), Found::None);
    }

    #[test]
    fn a_scan_with_one_browser_window_uses_it() {
        let w = [seen(1, "C:\\X\\chrome.exe", "Inbox"), seen(2, "C:\\X\\brave.exe", SY)];
        assert_eq!(scan_studio(&w), Found::One(rem(2, "C:\\X\\brave.exe")));
    }

    #[test]
    fn a_scan_with_two_browser_windows_reports_several() {
        let w = [seen(1, "C:\\X\\chrome.exe", SY), seen(2, "C:\\X\\firefox.exe", "StreamYard - Mozilla Firefox")];
        assert_eq!(scan_studio(&w), Found::Several);
    }

    #[test]
    fn a_non_browser_window_titled_streamyard_is_ignored() {
        let w = [seen(1, "C:\\X\\notepad.exe", "StreamYard notes"), seen(2, "C:\\X\\chrome.exe", SY)];
        assert_eq!(scan_studio(&w), Found::One(rem(2, "C:\\X\\chrome.exe")));
        assert_eq!(scan_studio(&w[..1]), Found::None);
    }

    #[test]
    fn a_dead_handle_is_looked_up_again_and_a_live_one_is_not_scanned() {
        let old = rem(5, "C:\\X\\chrome.exe");
        let fresh = [seen(9, "C:\\X\\chrome.exe", SY)];
        assert_eq!(resolve(Some(old.clone()), |_| false, || scan_studio(&fresh)), Found::One(rem(9, "C:\\X\\chrome.exe")));
        assert_eq!(resolve(Some(old.clone()), |_| true, || panic!("scanned a live window")), Found::One(old));
        assert_eq!(resolve(None, |_| true, || scan_studio(&fresh)), Found::One(rem(9, "C:\\X\\chrome.exe")));
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
