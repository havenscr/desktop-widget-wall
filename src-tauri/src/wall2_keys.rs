//! Wall 2 keys: send a short, fixed key chord to the program the owner is working in.
//!
//! A key is sent only when the owner clicks it on the wall, and only a chord that is written
//! in the local `keys.json` (or the small built-in default) for the program that was in front.
//! The page sends an app id and a key index; it never sends a chord, a key code or text. Each
//! step on the way fails closed with a fixed reason word (see `Refusal`), nothing is logged,
//! and no window title leaves this module. The one process name that does leave is the file
//! name of the program in front when it has no entry, so the owner can write one.
//!
//! The chord vocabulary is fixed (`parse_chord`): the modifiers Ctrl, Alt, Shift and Win, and
//! letters, digits, F1 to F12, Enter, Tab, Esc, Space, Backspace, Delete, Insert, Home, End,
//! PageUp, PageDown and the four arrows. A chord has at most six steps, a step has at most one
//! ordinary key. Every decision below is a pure function with a test; the Win32 calls are in
//! the `win` module, compiled on Windows only.
#![cfg_attr(not(windows), allow(dead_code))]

use crate::wall2_omni::require_wall2;
use crate::wall2_winutil::exe_matches;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;

// Section: limits

/// `keys.json` larger than this is not read.
const MAX_FILE_BYTES: u64 = 32 * 1024;
const MAX_APPS: usize = 12;
const MAX_KEYS: usize = 8;
const MAX_STEPS: usize = 6;
const MAX_CHORD_CHARS: usize = 64;
const MAX_LABEL_CHARS: usize = 16;
const MAX_ID_CHARS: usize = 24;
const MAX_EXE_CHARS: usize = 64;
/// The pause between the steps of a chord, in milliseconds. Fixed; the file cannot change it.
#[cfg_attr(not(windows), allow(dead_code))]
const STEP_GAP_MS: u64 = 150;

// Section: chords

const CTRL: u8 = 1;
const ALT: u8 = 2;
const SHIFT: u8 = 4;
const WIN: u8 = 8;

/// The virtual-key codes of the modifiers, in the order they are pressed.
const MODIFIER_KEYS: [(u8, u16); 4] = [(CTRL, 0x11), (ALT, 0x12), (SHIFT, 0x10), (WIN, 0x5B)];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Step {
    mods: u8,
    key: Option<u16>,
}

/// The virtual-key code of one ordinary key name, from the fixed vocabulary. Case does not
/// matter. None for anything else.
fn key_code(name: &str) -> Option<u16> {
    let n = name.to_ascii_lowercase();
    let b = n.as_bytes();
    if b.len() == 1 && b[0].is_ascii_lowercase() {
        return Some(b[0].to_ascii_uppercase() as u16);
    }
    if b.len() == 1 && b[0].is_ascii_digit() {
        return Some(b[0] as u16);
    }
    if let Some(num) = n.strip_prefix('f') {
        if let Ok(k) = num.parse::<u16>() {
            // No leading zero or plus sign: "f01" is not a key name.
            if (1..=12).contains(&k) && num == k.to_string() {
                return Some(0x70 + k - 1);
            }
        }
        return None;
    }
    Some(match n.as_str() {
        "enter" => 0x0D,
        "tab" => 0x09,
        "esc" => 0x1B,
        "space" => 0x20,
        "backspace" => 0x08,
        "delete" => 0x2E,
        "insert" => 0x2D,
        "home" => 0x24,
        "end" => 0x23,
        "pageup" => 0x21,
        "pagedown" => 0x22,
        "left" => 0x25,
        "up" => 0x26,
        "right" => 0x27,
        "down" => 0x28,
        _ => return None,
    })
}

fn modifier_bit(name: &str) -> Option<u8> {
    match name.to_ascii_lowercase().as_str() {
        "ctrl" => Some(CTRL),
        "alt" => Some(ALT),
        "shift" => Some(SHIFT),
        "win" => Some(WIN),
        _ => None,
    }
}

/// Keys that need the extended flag when sent, so the arrows do not act as the number pad.
fn is_extended(vk: u16) -> bool {
    matches!(vk, 0x21..=0x28 | 0x2D | 0x2E | 0x5B)
}

/// Parse a chord such as `Alt+H, R` or `Win+Shift+S`: steps separated by commas, each a
/// combination of modifiers and at most one ordinary key. Returns None for anything outside
/// the vocabulary, an empty step or chord, a repeated modifier, more than one ordinary key
/// in a step, or more than six steps.
fn parse_steps(text: &str) -> Option<Vec<Step>> {
    if text.is_empty() || text.chars().count() > MAX_CHORD_CHARS {
        return None;
    }
    let mut steps = Vec::new();
    for part in text.split(',') {
        let mut mods = 0u8;
        let mut key = None;
        let mut any = false;
        for token in part.split('+') {
            let token = token.trim();
            if token.is_empty() || !token.is_ascii() {
                return None;
            }
            any = true;
            if let Some(bit) = modifier_bit(token) {
                if mods & bit != 0 {
                    return None;
                }
                mods |= bit;
            } else {
                let code = key_code(token)?;
                if key.is_some() {
                    return None;
                }
                key = Some(code);
            }
        }
        if !any {
            return None;
        }
        steps.push(Step { mods, key });
        if steps.len() > MAX_STEPS {
            return None;
        }
    }
    Some(steps)
}

/// One key event of a send plan, or the pause between two steps.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Event {
    Key { vk: u16, up: bool },
    Gap,
}

/// The events for a chord: per step, the modifiers go down in a fixed order, then the key
/// goes down and up, then the modifiers come up in reverse (modifiers are released last).
/// A gap sits between steps. Every down has an up.
pub(crate) fn plan_events(steps: &[Step]) -> Vec<Event> {
    let mut events = Vec::new();
    for (i, step) in steps.iter().enumerate() {
        if i > 0 {
            events.push(Event::Gap);
        }
        let held: Vec<u16> = MODIFIER_KEYS.iter().filter(|(bit, _)| step.mods & bit != 0).map(|(_, vk)| *vk).collect();
        for &vk in &held {
            events.push(Event::Key { vk, up: false });
        }
        if let Some(vk) = step.key {
            events.push(Event::Key { vk, up: false });
            events.push(Event::Key { vk, up: true });
        }
        for &vk in held.iter().rev() {
            events.push(Event::Key { vk, up: true });
        }
    }
    events
}

/// The keys still held after the first `sent` events of a plan were delivered, most recently
/// pressed last. The release after a failure is built from this.
pub(crate) fn still_down(events: &[Event], sent: usize) -> Vec<u16> {
    let mut down: Vec<u16> = Vec::new();
    for e in events.iter().take(sent) {
        if let Event::Key { vk, up } = *e {
            if up {
                down.retain(|&k| k != vk);
            } else if !down.contains(&vk) {
                down.push(vk);
            }
        }
    }
    down
}

/// Chords Windows does not accept from a program, so they could only fail or mislead: Win+L
/// (lock) and Ctrl+Alt+Delete. Alt+F4 stays allowed.
pub(crate) fn blocked_chord(steps: &[Step]) -> bool {
    steps.iter().any(|st| (st.mods & WIN != 0 && st.key == Some(b'L' as u16)) || (st.mods & CTRL != 0 && st.mods & ALT != 0 && st.key == Some(0x2E)))
}

/// A chord in the fixed vocabulary that a program can send; None otherwise (see
/// `parse_steps` for the vocabulary rules and `blocked_chord` for the refused ones).
pub(crate) fn parse_chord(text: &str) -> Option<Vec<Step>> {
    parse_steps(text).filter(|steps| !blocked_chord(steps))
}

// Section: config

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct KeyDef {
    pub label: String,
    pub icon: String,
    pub chord: Vec<Step>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AppDef {
    pub id: String,
    pub name: String,
    pub matcher: Matcher,
    pub keys: Vec<KeyDef>,
}

/// Which programs a set accepts: one executable name, or any program (the general set).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Matcher {
    Any,
    Exe(String),
}

impl AppDef {
    /// Whether this set's own rule accepts a program, given its image path: the file part
    /// equals the entry's executable name, ignoring case; the general set accepts any.
    pub(crate) fn accepts(&self, image_path: &str) -> bool {
        match &self.matcher {
            Matcher::Any => true,
            Matcher::Exe(exe) => exe_matches(image_path, exe),
        }
    }

    pub(crate) fn is_general(&self) -> bool {
        self.matcher == Matcher::Any
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Config {
    pub apps: Vec<AppDef>,
}

/// The built-in default when there is no `keys.json`: Power BI Desktop with two keys. Both
/// chords are unverified on a real machine; `keys.json` replaces them.
pub(crate) const DEFAULT_CONFIG: &str = r#"{"apps":[{"id":"powerbi","name":"Power BI","exe":"PBIDesktop.exe","keys":[{"label":"Refresh","icon":"refresh","chord":"Alt+H, R"},{"label":"Snip","icon":"screenshot","chord":"Win+Shift+S"}]}]}"#;

/// The icon names a key may use. The front end draws exactly these (`keyIcons.tsx`, and a test
/// there reads this list); anything else is a config error.
pub(crate) const ICON_NAMES: [&str; 17] = [
    "refresh",
    "screenshot",
    "camera",
    "clipboard",
    "desktop",
    "brush",
    "gauge",
    "code",
    "copy",
    "save",
    "undo",
    "search",
    "lock",
    "mic",
    "play",
    "window",
    "keyboard",
];

/// A short display text: ASCII letters, digits, spaces and a few marks; no control
/// characters; no leading or trailing space.
fn valid_label(s: &str, max: usize) -> bool {
    !s.is_empty()
        && s.chars().count() <= max
        && s == s.trim()
        && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '-' | '+' | '.' | '/' | '&' | '#'))
}

/// A lower case identifier: letters, digits and dashes.
fn valid_id(s: &str, max: usize) -> bool {
    !s.is_empty()
        && s.chars().count() <= max
        && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// A bare executable file name: no folder, ends in `.exe`, plain characters only.
fn valid_exe(s: &str) -> bool {
    let lower = s.to_ascii_lowercase();
    lower.len() > 4
        && lower.len() <= MAX_EXE_CHARS
        && lower.ends_with(".exe")
        && s == s.trim()
        && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ' '))
}

/// Read `keys.json` text. Any problem refuses the whole file with a message that names the
/// place (app and key number) and never repeats the file's own text.
pub(crate) fn parse_config(text: &str) -> Result<Config, String> {
    let root: Value = serde_json::from_str(text).map_err(|_| "keys.json is not valid JSON".to_string())?;
    let apps = root.get("apps").and_then(Value::as_array).ok_or_else(|| "keys.json needs an \"apps\" list".to_string())?;
    if apps.len() > MAX_APPS {
        return Err(format!("keys.json has more than {MAX_APPS} apps"));
    }
    let mut ids = HashSet::new();
    let mut exes = HashSet::new();
    let mut general = false;
    let mut out = Vec::new();
    for (ai, app) in apps.iter().enumerate() {
        let n = ai + 1;
        let field = |k: &str| app.get(k).and_then(Value::as_str);
        let id = field("id").filter(|s| valid_id(s, MAX_ID_CHARS)).ok_or_else(|| format!("app {n}: id must be lower case letters, digits and dashes"))?;
        let name = field("name").filter(|s| valid_label(s, MAX_LABEL_CHARS)).ok_or_else(|| format!("app {n}: name is missing or not plain text"))?;
        let matcher = match (field("match"), app.get("match").is_some(), field("exe")) {
            (Some("*"), _, None) => Matcher::Any,
            (None, false, Some(exe)) if valid_exe(exe) => Matcher::Exe(exe.to_string()),
            (None, false, _) => return Err(format!("app {n}: exe must be a file name ending in .exe")),
            _ => return Err(format!("app {n}: match must be \"*\" and then exe is left out")),
        };
        if !ids.insert(id.to_string()) {
            return Err(format!("app {n}: id is used twice"));
        }
        match &matcher {
            Matcher::Any if general => return Err(format!("app {n}: only one general set is allowed")),
            Matcher::Any => general = true,
            Matcher::Exe(exe) if !exes.insert(exe.to_ascii_lowercase()) => return Err(format!("app {n}: exe is used twice")),
            Matcher::Exe(_) => {}
        }
        let keys = app.get("keys").and_then(Value::as_array).ok_or_else(|| format!("app {n}: needs a \"keys\" list"))?;
        if keys.is_empty() || keys.len() > MAX_KEYS {
            return Err(format!("app {n}: needs between 1 and {MAX_KEYS} keys"));
        }
        let mut defs = Vec::new();
        for (ki, key) in keys.iter().enumerate() {
            let m = ki + 1;
            let kf = |k: &str| key.get(k).and_then(Value::as_str);
            let label = kf("label").filter(|s| valid_label(s, MAX_LABEL_CHARS)).ok_or_else(|| format!("app {n}, key {m}: label is missing or not plain text"))?;
            let icon = kf("icon").filter(|s| ICON_NAMES.contains(s)).ok_or_else(|| format!("app {n} (set \"{id}\"), key {m}: icon is not one of the allowed names"))?;
            let chord = match kf("chord").and_then(parse_steps) {
                None => return Err(format!("app {n}, key {m}: chord is not in the allowed key list")),
                Some(steps) if blocked_chord(&steps) => return Err(format!("app {n}, key {m}: Windows does not accept that chord from a program")),
                Some(steps) => steps,
            };
            defs.push(KeyDef { label: label.to_string(), icon: icon.to_string(), chord });
        }
        out.push(AppDef { id: id.to_string(), name: name.to_string(), matcher, keys: defs });
    }
    Ok(Config { apps: out })
}

/// The set Auto shows for the program in front: the one whose executable matches the file
/// part of its image path, else the general set, else none.
pub(crate) fn auto_set<'a>(config: &'a Config, image_path: &str) -> Option<&'a AppDef> {
    config.apps.iter().find(|a| !a.is_general() && a.accepts(image_path)).or_else(|| config.apps.iter().find(|a| a.is_general()))
}

// Section: refusals

/// Why a send did not happen. The page turns each word into one short line.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Refusal {
    /// A send is already running.
    Busy,
    /// No such app id or key index in the loaded config.
    NoKey,
    /// Nothing is remembered, or the remembered program is not that app.
    NoApp,
    /// The remembered window is gone, hidden, or is now another program's.
    Gone,
    /// The program runs as administrator and the wall does not.
    Elevated,
    /// The window could not be brought to the front.
    NotForward,
    /// The keys could not be delivered.
    Failed,
    /// Not a Windows build.
    Unsupported,
}

impl Refusal {
    pub(crate) fn word(self) -> &'static str {
        match self {
            Refusal::Busy => "busy",
            Refusal::NoKey => "no key",
            Refusal::NoApp => "no app",
            Refusal::Gone => "gone",
            Refusal::Elevated => "elevated",
            Refusal::NotForward => "not forward",
            Refusal::Failed => "failed",
            Refusal::Unsupported => "unsupported",
        }
    }
}

/// What the program in front was when it was remembered.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Remembered {
    pub hwnd: isize,
    pub pid: u32,
    /// Full image path of the process.
    pub image: String,
}

/// What a live look at the remembered window found.
#[derive(Clone, Debug, Default)]
pub(crate) struct Live {
    pub exists: bool,
    pub visible: bool,
    /// The window still belongs to the process it did when it was remembered.
    pub same_process: bool,
    /// The image path of that process now; None when it cannot be read.
    pub image: Option<String>,
    /// A window of the wall itself.
    pub own: bool,
    /// Out of reach: elevated while the wall is not.
    pub elevated: bool,
}

/// The checks before anything is brought forward or sent, in order. Ok only when the
/// remembered window is the entry's app and is alive, visible, the same process, not the
/// wall, and reachable.
pub(crate) fn check_target(app: &AppDef, remembered: Option<&Remembered>, live: &Live) -> Result<(), Refusal> {
    let rem = remembered.ok_or(Refusal::NoApp)?;
    if !app.accepts(&rem.image) {
        return Err(Refusal::NoApp);
    }
    if live.own {
        return Err(Refusal::NoApp);
    }
    if !live.exists || !live.visible || !live.same_process {
        return Err(Refusal::Gone);
    }
    match (&app.matcher, &live.image) {
        (Matcher::Any, _) => {}
        (Matcher::Exe(_), Some(img)) if app.accepts(img) => {}
        _ => return Err(Refusal::Gone),
    }
    if live.elevated {
        return Err(Refusal::Elevated);
    }
    Ok(())
}

// Section: commands

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct KeyInfo {
    pub label: String,
    pub icon: String,
}

/// One set as the row shows it: name and key labels and icons only, never a chord.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SetInfo {
    pub id: String,
    pub name: String,
    pub general: bool,
    pub keys: Vec<KeyInfo>,
}

/// What the row shows: every set (so the page can step through them), the one Auto picks for
/// the program in front, and what is in front. `front` is `app` (a program is remembered),
/// or `idle` (nothing remembered yet). `exe` is the file name of that program, given only
/// when no set of its own matches it, so the owner can write one.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeysSummary {
    pub front: &'static str,
    pub auto_id: Option<String>,
    pub exe: Option<String>,
    pub sets: Vec<SetInfo>,
    /// `file` when `keys.json` is in use, `default` for the built-in one.
    pub source: &'static str,
}

/// Build the summary from the config and what was remembered. Pure.
pub(crate) fn summarise(config: &Config, source: &'static str, remembered: Option<&Remembered>) -> KeysSummary {
    let sets = config
        .apps
        .iter()
        .map(|a| SetInfo {
            id: a.id.clone(),
            name: a.name.clone(),
            general: a.is_general(),
            keys: a.keys.iter().map(|k| KeyInfo { label: k.label.clone(), icon: k.icon.clone() }).collect(),
        })
        .collect();
    let Some(rem) = remembered else {
        return KeysSummary { front: "idle", auto_id: None, exe: None, sets, source };
    };
    let auto = auto_set(config, &rem.image);
    let own = auto.is_some_and(|a| !a.is_general());
    KeysSummary {
        front: "app",
        auto_id: auto.map(|a| a.id.clone()),
        exe: (!own).then(|| crate::wall2_winutil::exe_file_part(&rem.image)).filter(|e| valid_exe(e)),
        sets,
        source,
    }
}

/// The loaded config from what reading the file gave: only a file that does not exist falls
/// back to the built-in keys; any other failure is the fixed "could not be read" state, with no
/// keys offered. An invalid file is an error too, never silently replaced.
pub(crate) fn config_from_read(read: Result<Vec<u8>, std::io::ErrorKind>) -> Result<(Config, &'static str), String> {
    let buf = match read {
        Err(std::io::ErrorKind::NotFound) => return parse_config(DEFAULT_CONFIG).map(|c| (c, "default")),
        Err(_) => return Err(UNREADABLE.to_string()),
        Ok(buf) => buf,
    };
    if buf.len() as u64 > MAX_FILE_BYTES {
        return Err("keys.json is larger than 32 KB".to_string());
    }
    let text = String::from_utf8(buf).map_err(|_| "keys.json is not text".to_string())?;
    parse_config(&text).map(|c| (c, "file"))
}

/// Shown when `keys.json` exists but cannot be read (permissions, a sharing violation).
pub(crate) const UNREADABLE: &str = "keys file could not be read";

/// Read the file, at most one byte past the limit.
fn read_keys_file(path: &std::path::Path) -> Result<Vec<u8>, std::io::ErrorKind> {
    use std::io::Read;
    let file = std::fs::File::open(path).map_err(|e| e.kind())?;
    let mut buf = Vec::new();
    file.take(MAX_FILE_BYTES + 1).read_to_end(&mut buf).map_err(|e| e.kind())?;
    Ok(buf)
}

fn load_config(app: &tauri::AppHandle) -> Result<(Config, &'static str), String> {
    use tauri::Manager;
    // No config folder at all is the same as no file: the built-in keys.
    let read = match app.path().app_config_dir() {
        Ok(dir) => read_keys_file(&dir.join("keys.json")),
        Err(_) => Err(std::io::ErrorKind::NotFound),
    };
    config_from_read(read)
}

/// The program the owner is working in, and its keys. An error (a fixed word) on a system the
/// commands do not support, so the page shows no row there; an error text when `keys.json`
/// has a problem.
#[tauri::command]
pub async fn wall2_keys_summary(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<KeysSummary, String> {
    require_wall2(window.label())?;
    #[cfg(windows)]
    {
        win::start_tracking();
        let (config, source) = load_config(&app)?;
        let remembered = tauri::async_runtime::spawn_blocking(win::current).await.map_err(|_| Refusal::Busy.word().to_string())?;
        Ok(summarise(&config, source, remembered.as_ref()))
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err(Refusal::Unsupported.word().to_string())
    }
}

/// Send one key of the program in front. Ok when the chord was delivered; an error is one
/// of the fixed words of `Refusal`.
#[tauri::command]
pub async fn wall2_keys_send(window: tauri::WebviewWindow, app: tauri::AppHandle, set_id: String, index: usize) -> Result<(), String> {
    require_wall2(window.label())?;
    #[cfg(windows)]
    {
        let (config, _) = load_config(&app).map_err(|_| Refusal::NoKey.word().to_string())?;
        tauri::async_runtime::spawn_blocking(move || win::send(&config, &set_id, index).map_err(|r| r.word().to_string()))
            .await
            .map_err(|_| Refusal::Busy.word().to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (app, set_id, index);
        Err(Refusal::Unsupported.word().to_string())
    }
}

// Section: Windows

#[cfg(windows)]
mod win {
    use super::*;
    use crate::wall2_winutil::{is_shell_class, sys, try_begin};
    use std::sync::atomic::AtomicBool;
    use std::sync::{Mutex, Once};
    use std::time::{Duration, Instant};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, VIRTUAL_KEY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, IsHungAppWindow, IsIconic, IsWindow, IsWindowVisible, SetForegroundWindow, ShowWindowAsync, SW_RESTORE,
    };

    /// Held while a send runs, so clicks never overlap.
    static SENDING: AtomicBool = AtomicBool::new(false);
    static REMEMBERED: Mutex<Option<Remembered>> = Mutex::new(None);
    static TRACKING: Once = Once::new();

    const POLL: Duration = Duration::from_millis(400);
    const FOREGROUND_WAIT: Duration = Duration::from_millis(800);
    const FOREGROUND_POLL: Duration = Duration::from_millis(25);

    /// Start the light poll that remembers the last foreground window that is not the wall's
    /// own. Starts once; the thread ends with the app.
    pub fn start_tracking() {
        TRACKING.call_once(|| {
            let _ = std::thread::Builder::new().name("wall2-keys-foreground".into()).spawn(|| {
                let mut last = 0isize;
                loop {
                    poll_once(&mut last);
                    std::thread::sleep(POLL);
                }
            });
        });
    }

    fn poll_once(last: &mut isize) {
        let fg = unsafe { GetForegroundWindow() }.0 as isize;
        if fg == 0 || fg == *last {
            return;
        }
        *last = fg;
        let pid = sys::pid_of(fg);
        // The wall taking focus when clicked, and the desktop shell, never replace it.
        if pid == 0 || pid == std::process::id() || is_shell_class(&sys::class_name(fg)) || !sys::has_title(fg) {
            return;
        }
        let next = sys::image_path(pid).map(|image| Remembered { hwnd: fg, pid, image });
        if let Ok(mut slot) = REMEMBERED.lock() {
            *slot = next;
        }
    }

    /// The remembered program, when its window still exists and is the same process.
    pub fn current() -> Option<Remembered> {
        let rem = REMEMBERED.lock().ok()?.clone()?;
        let alive = unsafe { IsWindow(sys::hwnd(rem.hwnd)).as_bool() } && sys::pid_of(rem.hwnd) == rem.pid;
        alive.then_some(rem)
    }

    fn look(rem: &Remembered) -> Live {
        let hw = sys::hwnd(rem.hwnd);
        let exists = unsafe { IsWindow(hw).as_bool() };
        let pid = if exists { sys::pid_of(rem.hwnd) } else { 0 };
        Live {
            exists,
            visible: exists && unsafe { IsWindowVisible(hw).as_bool() },
            same_process: exists && pid == rem.pid,
            image: if exists { sys::image_path(pid) } else { None },
            own: pid == std::process::id(),
            elevated: exists && sys::keys_blocked(pid),
        }
    }

    fn bring_forward(hwnd: isize) -> bool {
        let hw = sys::hwnd(hwnd);
        unsafe {
            if IsHungAppWindow(hw).as_bool() {
                return false;
            }
            if IsIconic(hw).as_bool() {
                let _ = ShowWindowAsync(hw, SW_RESTORE);
            }
            let _ = SetForegroundWindow(hw);
        }
        let started = Instant::now();
        loop {
            if foreground_is(hwnd) {
                return true;
            }
            if started.elapsed() >= FOREGROUND_WAIT {
                return false;
            }
            std::thread::sleep(FOREGROUND_POLL);
        }
    }

    fn foreground_is(hwnd: isize) -> bool {
        unsafe { GetForegroundWindow() }.0 as isize == hwnd
    }

    fn key_input(vk: u16, up: bool) -> INPUT {
        let mut flags = KEYBD_EVENT_FLAGS(0);
        if up {
            flags |= KEYEVENTF_KEYUP;
        }
        if is_extended(vk) {
            flags |= KEYEVENTF_EXTENDEDKEY;
        }
        INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(vk), wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } } }
    }

    /// Deliver key events; returns how many were accepted.
    fn deliver(events: &[Event]) -> usize {
        let inputs: Vec<INPUT> = events
            .iter()
            .filter_map(|e| match *e {
                Event::Key { vk, up } => Some(key_input(vk, up)),
                Event::Gap => None,
            })
            .collect();
        if inputs.is_empty() {
            return 0;
        }
        unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) as usize }
    }

    /// Release everything still held, best effort.
    fn release(down: &[u16]) {
        let ups: Vec<Event> = down.iter().rev().map(|&vk| Event::Key { vk, up: true }).collect();
        if !ups.is_empty() {
            deliver(&ups);
        }
    }

    pub fn send(config: &Config, set_id: &str, index: usize) -> Result<(), Refusal> {
        let _busy = try_begin(&SENDING).ok_or(Refusal::Busy)?;
        let app = config.apps.iter().find(|a| a.id == set_id).ok_or(Refusal::NoKey)?;
        let key = app.keys.get(index).ok_or(Refusal::NoKey)?;
        let remembered = current_for_send();
        check_target(app, remembered.as_ref(), &remembered.as_ref().map(look).unwrap_or_default())?;
        let target = remembered.as_ref().map(|r| r.hwnd).ok_or(Refusal::NoApp)?;
        if !foreground_is(target) && !bring_forward(target) {
            return Err(Refusal::NotForward);
        }
        // One step at a time: the front window must still be the target before each step,
        // and anything held is released if a step fails.
        let events = plan_events(&key.chord);
        let mut sent = 0usize;
        let mut step: Vec<Event> = Vec::new();
        for (i, e) in events.iter().enumerate() {
            match e {
                Event::Gap => {
                    if !flush(&mut step, &mut sent) {
                        release(&still_down(&events, sent));
                        return Err(Refusal::Failed);
                    }
                    std::thread::sleep(Duration::from_millis(STEP_GAP_MS));
                    if !foreground_is(target) {
                        return Err(Refusal::NotForward);
                    }
                    sent += 1; // the gap itself
                }
                Event::Key { .. } => step.push(*e),
            }
        }
        if !flush(&mut step, &mut sent) {
            release(&still_down(&events, sent));
            return Err(Refusal::Failed);
        }
        Ok(())
    }

    /// The remembered window as it is right now (the poll may be up to 400 ms behind, and
    /// the window the owner clicked from is the wall).
    fn current_for_send() -> Option<Remembered> {
        REMEMBERED.lock().ok()?.clone()
    }

    /// Deliver the buffered step. `sent` counts events of the whole plan delivered so far.
    fn flush(step: &mut Vec<Event>, sent: &mut usize) -> bool {
        if step.is_empty() {
            return true;
        }
        let want = step.len();
        let got = deliver(step);
        *sent += got;
        step.clear();
        got == want
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chord(s: &str) -> Vec<Step> {
        parse_chord(s).unwrap_or_else(|| panic!("{s:?} should parse"))
    }

    #[test]
    fn every_vocabulary_item_parses() {
        for c in 'a'..='z' {
            assert_eq!(key_code(&c.to_string()), Some(c.to_ascii_uppercase() as u16));
            assert_eq!(key_code(&c.to_ascii_uppercase().to_string()), Some(c.to_ascii_uppercase() as u16));
        }
        for d in '0'..='9' {
            assert_eq!(key_code(&d.to_string()), Some(d as u16));
        }
        for k in 1..=12u16 {
            assert_eq!(key_code(&format!("F{k}")), Some(0x70 + k - 1));
            assert_eq!(key_code(&format!("f{k}")), Some(0x70 + k - 1));
        }
        let named = [
            ("Enter", 0x0D),
            ("Tab", 0x09),
            ("Esc", 0x1B),
            ("Space", 0x20),
            ("Backspace", 0x08),
            ("Delete", 0x2E),
            ("Insert", 0x2D),
            ("Home", 0x24),
            ("End", 0x23),
            ("PageUp", 0x21),
            ("PageDown", 0x22),
            ("Left", 0x25),
            ("Up", 0x26),
            ("Right", 0x27),
            ("Down", 0x28),
        ];
        for (name, code) in named {
            assert_eq!(key_code(name), Some(code), "{name}");
            assert_eq!(key_code(&name.to_uppercase()), Some(code), "{name} upper");
        }
        for m in ["Ctrl", "Alt", "Shift", "Win", "ctrl", "WIN"] {
            assert!(modifier_bit(m).is_some(), "{m}");
        }
    }

    #[test]
    fn the_two_default_chords() {
        assert_eq!(chord("Alt+H, R"), vec![Step { mods: ALT, key: Some(b'H' as u16) }, Step { mods: 0, key: Some(b'R' as u16) }]);
        assert_eq!(chord("Win+Shift+S"), vec![Step { mods: WIN | SHIFT, key: Some(b'S' as u16) }]);
    }

    #[test]
    fn bad_chords_are_refused() {
        let long_but_ok = ["A"; 6].join(", ");
        assert!(parse_chord(&long_but_ok).is_some());
        let too_many = ["A"; 7].join(", ");
        for bad in [
            "",
            " ",
            ",",
            "A,",
            ",A",
            "+",
            "Ctrl+",
            "+A",
            "Ctrl++A",
            "Ctrl+Ctrl+A",
            "ctrl+CTRL+A",
            "A+B",
            "F0",
            "F13",
            "F01",
            "F+1",
            "Windows+A",
            "Super+A",
            "Meta+A",
            "Cmd+A",
            "Control+A",
            "Ctrl+Alt+Del",
            "Ctrl+Alt+Delete+A",
            "0x41",
            "65",
            "AA",
            "Hello",
            "Ctrl+é",
            "Ctrl+\u{0}",
            "Ctrl+A;B",
            "Ctrl A",
            "type:hello",
            "Ctrl+Alt+Shift+Win+Ctrl+A",
        ] {
            assert!(parse_chord(bad).is_none(), "{bad:?} should be refused");
        }
        assert!(parse_chord(&too_many).is_none(), "seven steps");
        assert!(parse_chord(&"A, ".repeat(40)).is_none(), "over the length bound");
        // Shifted punctuation and plain text are not in the vocabulary.
        for punct in ["Ctrl+;", "Ctrl+.", "Ctrl+-", "Ctrl+=", "Shift+/", "Ctrl+\\"] {
            assert!(parse_chord(punct).is_none(), "{punct:?}");
        }
    }

    #[test]
    fn chords_windows_will_not_accept_from_a_program_are_refused() {
        for bad in ["Win+L", "win+l", "Win+Shift+L", "Ctrl+Alt+Delete", "Alt+Ctrl+Delete", "Ctrl+Alt+Shift+Delete", "A, Win+L", "Ctrl+Alt+Delete, A"] {
            assert!(parse_chord(bad).is_none(), "{bad:?}");
        }
        // Alt+F4 and near misses stay allowed.
        for good in ["Alt+F4", "Win+D", "Win+V", "Ctrl+Delete", "Alt+Delete", "Ctrl+Alt+L", "Win+K", "Delete"] {
            assert!(parse_chord(good).is_some(), "{good:?}");
        }
        let text = config_with(r#"{"label":"Lock","icon":"lock","chord":"Win+L"}"#);
        let err = parse_config(&text).unwrap_err();
        assert!(err.contains("app 1, key 1") && err.contains("does not accept that chord"), "{err}");
    }

    #[test]
    fn every_allowed_icon_name_is_accepted_and_an_unknown_one_names_the_set_and_key() {
        for name in ICON_NAMES {
            let text = config_with(&format!(r#"{{"label":"A","icon":"{name}","chord":"A"}}"#));
            assert!(parse_config(&text).is_ok(), "{name}");
        }
        assert_eq!(ICON_NAMES.len(), 17);
        let unique: HashSet<&str> = ICON_NAMES.iter().copied().collect();
        assert_eq!(unique.len(), ICON_NAMES.len());
        let key = r#"{"label":"A","icon":"refresh","chord":"A"}"#;
        let text = config_with(&format!(r#"{key},{{"label":"B","icon":"refersh","chord":"A"}}"#));
        let err = parse_config(&text).unwrap_err();
        assert!(err.contains("set \"pbi\"") && err.contains("key 2") && err.contains("icon"), "{err}");
        assert!(!err.contains("refersh"), "the file's own text is never repeated: {err}");
        for bad in ["", "Refresh", "REFRESH", "<b>", "x", "refresh "] {
            let text = config_with(&format!(r#"{{"label":"A","icon":"{bad}","chord":"A"}}"#));
            assert!(parse_config(&text).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn only_a_missing_keys_file_falls_back_to_the_built_in_keys() {
        use std::io::ErrorKind;
        let (c, source) = config_from_read(Err(ErrorKind::NotFound)).expect("missing is fine");
        assert_eq!((source, c.apps.len()), ("default", 1));
        for kind in [ErrorKind::PermissionDenied, ErrorKind::Other, ErrorKind::TimedOut, ErrorKind::WouldBlock, ErrorKind::InvalidData] {
            assert_eq!(config_from_read(Err(kind)), Err(UNREADABLE.to_string()), "{kind:?}");
        }
        let good = config_with(r#"{"label":"A","icon":"keyboard","chord":"A"}"#);
        assert_eq!(config_from_read(Ok(good.into_bytes())).map(|(_, s)| s), Ok("file"));
        assert!(config_from_read(Ok(vec![b'x'; 40_000])).unwrap_err().contains("larger than 32 KB"));
        assert!(config_from_read(Ok(vec![0xff, 0xfe])).is_err());
        assert!(config_from_read(Ok(b"nope".to_vec())).is_err(), "an invalid file is never replaced by the default");
    }

    #[test]
    fn a_real_unreadable_path_is_not_a_missing_one() {
        let missing = std::env::temp_dir().join("wall2-keys-test-missing-folder").join("keys.json");
        assert_eq!(read_keys_file(&missing), Err(std::io::ErrorKind::NotFound));
        // A folder where the file should be cannot be read as a file.
        let dir = std::env::temp_dir();
        let got = read_keys_file(&dir);
        assert!(got.is_err() && got != Err(std::io::ErrorKind::NotFound), "{got:?}");
    }

    #[test]
    fn spaces_and_case_do_not_matter() {
        assert_eq!(chord("  alt + h ,r "), chord("Alt+H, R"));
        assert_eq!(chord("CTRL+SHIFT+F5"), chord("Ctrl+Shift+f5"));
    }

    #[test]
    fn a_step_may_be_modifiers_only() {
        assert_eq!(chord("Alt"), vec![Step { mods: ALT, key: None }]);
        assert_eq!(plan_events(&chord("Alt")), vec![Event::Key { vk: 0x12, up: false }, Event::Key { vk: 0x12, up: true }]);
    }

    fn down(vk: u16) -> Event {
        Event::Key { vk, up: false }
    }
    fn up(vk: u16) -> Event {
        Event::Key { vk, up: true }
    }

    #[test]
    fn the_plan_presses_modifiers_first_and_releases_them_last() {
        assert_eq!(
            plan_events(&chord("Win+Shift+S")),
            vec![down(0x10), down(0x5B), down(b'S' as u16), up(b'S' as u16), up(0x5B), up(0x10)]
        );
        assert_eq!(
            plan_events(&chord("Ctrl+Alt+Shift+Win+F5")),
            vec![down(0x11), down(0x12), down(0x10), down(0x5B), down(0x74), up(0x74), up(0x5B), up(0x10), up(0x12), up(0x11)]
        );
        // Two steps get one gap between them; the first step ends before the second starts.
        assert_eq!(
            plan_events(&chord("Alt+H, R")),
            vec![down(0x12), down(b'H' as u16), up(b'H' as u16), up(0x12), Event::Gap, down(b'R' as u16), up(b'R' as u16)]
        );
        assert!(plan_events(&[]).is_empty());
    }

    #[test]
    fn every_down_has_an_up_for_every_chord_shape() {
        for text in ["A", "Ctrl+A", "Ctrl+Alt+Shift+Win+Esc", "Alt+H, R", "F1, F2, F3, F4, F5, F6", "Win", "Ctrl+Shift+Left, Enter"] {
            let events = plan_events(&chord(text));
            assert!(still_down(&events, events.len()).is_empty(), "{text}: nothing stays down");
            let mut depth: Vec<u16> = Vec::new();
            for e in &events {
                if let Event::Key { vk, up } = *e {
                    if up {
                        // Releases never come before their press.
                        assert!(depth.contains(&vk), "{text}: up before down");
                        depth.retain(|&k| k != vk);
                    } else {
                        depth.push(vk);
                    }
                }
            }
            assert!(depth.is_empty(), "{text}");
        }
    }

    #[test]
    fn what_is_still_down_after_a_partial_send_is_released() {
        let events = plan_events(&chord("Ctrl+Shift+S"));
        // Delivered: Ctrl down, Shift down, S down. S up and the two modifier releases are not.
        assert_eq!(still_down(&events, 3), vec![0x11, 0x10, b'S' as u16]);
        assert_eq!(still_down(&events, 0), Vec::<u16>::new());
        assert_eq!(still_down(&events, 1), vec![0x11]);
        assert_eq!(still_down(&events, 4), vec![0x11, 0x10]);
        assert_eq!(still_down(&events, 99), Vec::<u16>::new());
    }

    #[test]
    fn extended_keys_are_the_arrows_and_navigation() {
        for vk in [0x21u16, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0x5B] {
            assert!(is_extended(vk), "{vk:#x}");
        }
        for vk in [b'A' as u16, 0x0D, 0x09, 0x1B, 0x20, 0x08, 0x70, 0x11, 0x12, 0x10] {
            assert!(!is_extended(vk), "{vk:#x}");
        }
    }

    fn config_with(keys: &str) -> String {
        format!(r#"{{"apps":[{{"id":"pbi","name":"Power BI","exe":"PBIDesktop.exe","keys":[{keys}]}}]}}"#)
    }

    #[test]
    fn the_default_config_is_valid_with_exactly_the_two_default_keys() {
        let c = parse_config(DEFAULT_CONFIG).expect("valid");
        assert_eq!(c.apps.len(), 1);
        let app = &c.apps[0];
        assert_eq!((app.id.as_str(), app.name.as_str()), ("powerbi", "Power BI"));
        assert_eq!(app.matcher, Matcher::Exe("PBIDesktop.exe".to_string()));
        let labels: Vec<&str> = app.keys.iter().map(|k| k.label.as_str()).collect();
        assert_eq!(labels, vec!["Refresh", "Snip"]);
        assert_eq!(app.keys[0].chord, chord("Alt+H, R"));
        assert_eq!(app.keys[1].chord, chord("Win+Shift+S"));
    }

    #[test]
    fn the_readme_example_with_five_keys_is_valid() {
        let text = config_with(
            r#"{"label":"Format","icon":"brush","chord":"Alt+H, F, P"},
               {"label":"Refresh","icon":"refresh","chord":"Alt+H, R"},
               {"label":"Perf","icon":"gauge","chord":"Alt+V, P"},
               {"label":"TMDL","icon":"code","chord":"Ctrl+Shift+M"},
               {"label":"Snip","icon":"screenshot","chord":"Win+Shift+S"}"#,
        );
        let c = parse_config(&text).expect("valid");
        assert_eq!(c.apps[0].keys.len(), 5);
    }

    #[test]
    fn config_bounds_hold() {
        let key = r#"{"label":"A","icon":"keyboard","chord":"A"}"#;
        let nine = vec![key; 9].join(",");
        assert!(parse_config(&config_with(&nine)).unwrap_err().contains("between 1 and 8"));
        let eight = vec![key; 8].join(",");
        assert!(parse_config(&config_with(&eight)).is_ok());
        assert!(parse_config(&config_with("")).is_err(), "an app with no keys");
        // Thirteen apps.
        let app = |i: usize| format!(r#"{{"id":"a{i}","name":"A","exe":"a{i}.exe","keys":[{key}]}}"#);
        let many = (0..13).map(app).collect::<Vec<_>>().join(",");
        assert!(parse_config(&format!(r#"{{"apps":[{many}]}}"#)).unwrap_err().contains("more than 12"));
        let twelve = (0..12).map(app).collect::<Vec<_>>().join(",");
        assert!(parse_config(&format!(r#"{{"apps":[{twelve}]}}"#)).is_ok());
    }

    #[test]
    fn a_hostile_file_cannot_make_it_type_arbitrary_text_or_exceed_limits() {
        let bad_chords = [
            r#""chord":"type hello world""#,
            r#""chord":"Ctrl+A, Ctrl+B, Ctrl+C, Ctrl+D, Ctrl+E, Ctrl+F, Ctrl+G""#,
            r#""chord":["Ctrl+A"]"#,
            r#""chord":65"#,
            r#""chord":"0x41""#,
            r#""chord":"""#,
            r#""chord":"Ctrl+A+B""#,
            r#""chord":"Ctrl+Ctrl+A""#,
            r#""text":"hello""#,
        ];
        for c in bad_chords {
            let text = config_with(&format!(r#"{{"label":"X","icon":"keyboard",{c}}}"#));
            assert!(parse_config(&text).is_err(), "{c}");
        }
        // Delays and key codes by number have nowhere to go: unknown fields are ignored, and
        // the chord still has to be valid.
        let text = config_with(r#"{"label":"X","icon":"keyboard","chord":"A","delayMs":60000,"vk":13,"text":"rm"}"#);
        let c = parse_config(&text).expect("extra fields are ignored");
        assert_eq!(c.apps[0].keys[0].chord, chord("A"));
    }

    #[test]
    fn labels_ids_and_exe_names_are_plain() {
        for bad_label in ["", " A", "A ", "<b>", "A\nB", "this label is far too long", "é", "A\"B"] {
            let text = config_with(&format!(r#"{{"label":{},"icon":"keyboard","chord":"A"}}"#, serde_json::to_string(bad_label).unwrap()));
            assert!(parse_config(&text).is_err(), "{bad_label:?}");
        }
        for bad_exe in ["", ".exe", "tool", "tool.dll", r"C:\x\tool.exe", "a/b.exe", "..\\tool.exe", "tool.exe ", &format!("{}.exe", "a".repeat(70))] {
            let text = format!(r#"{{"apps":[{{"id":"a","name":"A","exe":{},"keys":[{{"label":"A","icon":"keyboard","chord":"A"}}]}}]}}"#, serde_json::to_string(bad_exe).unwrap());
            assert!(parse_config(&text).is_err(), "{bad_exe:?}");
        }
        for bad_id in ["", "A", "a b", "a_b", "a/b", &"a".repeat(25)] {
            let text = format!(r#"{{"apps":[{{"id":{},"name":"A","exe":"a.exe","keys":[{{"label":"A","icon":"keyboard","chord":"A"}}]}}]}}"#, serde_json::to_string(bad_id).unwrap());
            assert!(parse_config(&text).is_err(), "{bad_id:?}");
        }
    }

    #[test]
    fn duplicates_and_shapes_are_refused() {
        let key = r#"{"label":"A","icon":"keyboard","chord":"A"}"#;
        let app = |id: &str, exe: &str| format!(r#"{{"id":"{id}","name":"A","exe":"{exe}","keys":[{key}]}}"#);
        assert!(parse_config(&format!(r#"{{"apps":[{},{}]}}"#, app("a", "a.exe"), app("a", "b.exe"))).unwrap_err().contains("id is used twice"));
        assert!(parse_config(&format!(r#"{{"apps":[{},{}]}}"#, app("a", "A.exe"), app("b", "a.EXE"))).unwrap_err().contains("exe is used twice"));
        for bad in ["", "not json", "[]", "{}", r#"{"apps":{}}"#, r#"{"apps":[1]}"#, r#"{"apps":[null]}"#, r#"{"apps":[{"keys":5}]}"#] {
            assert!(parse_config(bad).is_err(), "{bad:?}");
        }
        assert_eq!(parse_config(r#"{"apps":[]}"#), Ok(Config { apps: vec![] }));
        // The error text never repeats the file's own words.
        let err = parse_config(&config_with(r#"{"label":"X","icon":"keyboard","chord":"SECRETWORD"}"#)).unwrap_err();
        assert!(!err.contains("SECRETWORD"), "{err}");
    }

    fn pbi() -> AppDef {
        parse_config(DEFAULT_CONFIG).unwrap().apps.remove(0)
    }

    fn rem(image: &str) -> Remembered {
        Remembered { hwnd: 10, pid: 20, image: image.to_string() }
    }

    fn good_live() -> Live {
        Live { exists: true, visible: true, same_process: true, image: Some(r"C:\P\bin\PBIDesktop.exe".to_string()), own: false, elevated: false }
    }

    fn with_general() -> Config {
        let text = r#"{"apps":[{"id":"general","name":"General","match":"*","keys":[{"label":"Snip","icon":"screenshot","chord":"Win+Shift+S"}]},{"id":"powerbi","name":"Power BI","exe":"PBIDesktop.exe","keys":[{"label":"Refresh","icon":"refresh","chord":"Alt+H, R"}]}]}"#;
        parse_config(text).expect("valid")
    }

    #[test]
    fn the_app_match_rule_compares_the_file_part_case_insensitively() {
        let c = parse_config(DEFAULT_CONFIG).unwrap();
        assert!(auto_set(&c, r"C:\Program Files\Microsoft Power BI Desktop\bin\PBIDesktop.exe").is_some());
        assert!(auto_set(&c, r"c:\x\pbidesktop.EXE").is_some());
        assert!(auto_set(&c, r"C:\x\PBIDesktopSetup.exe").is_none());
        assert!(auto_set(&c, r"C:\PBIDesktop.exe\other.exe").is_none());
        assert!(auto_set(&c, "").is_none());
    }

    #[test]
    fn auto_prefers_the_apps_own_set_then_the_general_one() {
        let c = with_general();
        assert_eq!(auto_set(&c, r"C:\x\PBIDesktop.exe").map(|a| a.id.as_str()), Some("powerbi"));
        assert_eq!(auto_set(&c, r"C:\x\notepad.exe").map(|a| a.id.as_str()), Some("general"));
        assert!(auto_set(&parse_config(DEFAULT_CONFIG).unwrap(), r"C:\x\notepad.exe").is_none());
    }

    #[test]
    fn a_general_set_accepts_any_remembered_window_and_keeps_every_other_check() {
        let c = with_general();
        let general = &c.apps[0];
        assert!(general.is_general());
        let r = rem(r"C:\x\notepad.exe");
        let live = Live { image: Some(r"C:\x\notepad.exe".into()), ..good_live() };
        assert_eq!(check_target(general, Some(&r), &live), Ok(()));
        assert_eq!(check_target(general, None, &live), Err(Refusal::NoApp));
        assert_eq!(check_target(general, Some(&r), &Live { own: true, ..live.clone() }), Err(Refusal::NoApp));
        assert_eq!(check_target(general, Some(&r), &Live { exists: false, ..live.clone() }), Err(Refusal::Gone));
        assert_eq!(check_target(general, Some(&r), &Live { visible: false, ..live.clone() }), Err(Refusal::Gone));
        assert_eq!(check_target(general, Some(&r), &Live { same_process: false, ..live.clone() }), Err(Refusal::Gone));
        assert_eq!(check_target(general, Some(&r), &Live { elevated: true, ..live }), Err(Refusal::Elevated));
        // A specific set still refuses another app (a held set in the wrong app).
        assert_eq!(check_target(&c.apps[1], Some(&r), &good_live()), Err(Refusal::NoApp));
    }

    #[test]
    fn only_one_general_set_and_match_must_be_a_star() {
        let key = r#"{"label":"A","icon":"keyboard","chord":"A"}"#;
        let set = |id: &str, extra: &str| format!(r#"{{"id":"{id}","name":"A",{extra},"keys":[{key}]}}"#);
        assert!(parse_config(&format!(r#"{{"apps":[{},{}]}}"#, set("a", r#""match":"*""#), set("b", r#""match":"*""#))).unwrap_err().contains("only one general"));
        for bad in [r#""match":"all""#, r#""match":"""#, r#""match":1"#, r#""match":"*","exe":"a.exe""#, r#""match":"*.exe""#] {
            assert!(parse_config(&format!(r#"{{"apps":[{}]}}"#, set("a", bad))).is_err(), "{bad}");
        }
        assert!(parse_config(&format!(r#"{{"apps":[{}]}}"#, set("a", r#""match":"*""#))).is_ok());
    }

    #[test]
    fn a_good_target_passes() {
        let r = rem(r"C:\P\bin\PBIDesktop.exe");
        assert_eq!(check_target(&pbi(), Some(&r), &good_live()), Ok(()));
    }

    #[test]
    fn each_refusal() {
        let app = pbi();
        let r = rem(r"C:\P\bin\PBIDesktop.exe");
        // Nothing remembered, or another program remembered.
        assert_eq!(check_target(&app, None, &good_live()), Err(Refusal::NoApp));
        assert_eq!(check_target(&app, Some(&rem(r"C:\x\notepad.exe")), &good_live()), Err(Refusal::NoApp));
        // The wall itself.
        assert_eq!(check_target(&app, Some(&r), &Live { own: true, ..good_live() }), Err(Refusal::NoApp));
        // The window is gone, hidden, or another process now.
        assert_eq!(check_target(&app, Some(&r), &Live { exists: false, ..good_live() }), Err(Refusal::Gone));
        assert_eq!(check_target(&app, Some(&r), &Live { visible: false, ..good_live() }), Err(Refusal::Gone));
        assert_eq!(check_target(&app, Some(&r), &Live { same_process: false, ..good_live() }), Err(Refusal::Gone));
        // The process's image no longer equals the entry's, or cannot be read.
        assert_eq!(check_target(&app, Some(&r), &Live { image: Some(r"C:\x\other.exe".into()), ..good_live() }), Err(Refusal::Gone));
        assert_eq!(check_target(&app, Some(&r), &Live { image: None, ..good_live() }), Err(Refusal::Gone));
        // Elevated while the wall is not.
        assert_eq!(check_target(&app, Some(&r), &Live { elevated: true, ..good_live() }), Err(Refusal::Elevated));
    }

    #[test]
    fn refusal_words_are_fixed_and_distinct() {
        let all = [Refusal::Busy, Refusal::NoKey, Refusal::NoApp, Refusal::Gone, Refusal::Elevated, Refusal::NotForward, Refusal::Failed, Refusal::Unsupported];
        let words: HashSet<&str> = all.iter().map(|r| r.word()).collect();
        assert_eq!(words.len(), all.len());
        assert_eq!(Refusal::NotForward.word(), "not forward");
    }

    #[test]
    fn the_summary_lists_sets_by_name_and_never_a_chord_or_title() {
        let c = parse_config(DEFAULT_CONFIG).unwrap();
        let s = summarise(&c, "default", Some(&rem(r"C:\P\PBIDesktop.exe")));
        assert_eq!((s.front, s.auto_id.as_deref(), s.exe.clone()), ("app", Some("powerbi"), None));
        assert_eq!(s.sets.len(), 1);
        assert_eq!((s.sets[0].id.as_str(), s.sets[0].name.as_str(), s.sets[0].general), ("powerbi", "Power BI", false));
        assert_eq!(s.sets[0].keys, vec![KeyInfo { label: "Refresh".into(), icon: "refresh".into() }, KeyInfo { label: "Snip".into(), icon: "screenshot".into() }]);
        // No set of its own and no general set: nothing picked, the file name is given.
        let other = summarise(&c, "file", Some(&rem(r"C:\x\Notepad.exe")));
        assert_eq!((other.front, other.auto_id.clone(), other.exe.as_deref(), other.source), ("app", None, Some("notepad.exe"), "file"));
        let idle = summarise(&c, "default", None);
        assert_eq!((idle.front, idle.auto_id.clone(), idle.sets.len()), ("idle", None, 1));
        // With a general set the fallback is picked, and the file name is still given.
        let g = with_general();
        let fall = summarise(&g, "file", Some(&rem(r"C:\x\Notepad.exe")));
        assert_eq!((fall.auto_id.as_deref(), fall.exe.as_deref()), (Some("general"), Some("notepad.exe")));
        assert!(fall.sets[0].general && !fall.sets[1].general);
        let own = summarise(&g, "file", Some(&rem(r"C:\x\PBIDesktop.exe")));
        assert_eq!((own.auto_id.as_deref(), own.exe), (Some("powerbi"), None));
    }

    #[test]
    fn the_commands_are_gated_to_wall2_before_anything_else() {
        assert_eq!(require_wall2("main"), Err("forbidden".to_string()));
        let src = include_str!("wall2_keys.rs");
        for name in ["pub async fn wall2_keys_summary(", "pub async fn wall2_keys_send("] {
            let at = src.find(name).expect("command");
            let body = &src[at..];
            let open = body.find('{').expect("body");
            let first = body[open + 1..].trim_start();
            assert!(first.starts_with("require_wall2(window.label())?;"), "{name}: {}", &first[..first.len().min(60)]);
        }
    }
}
