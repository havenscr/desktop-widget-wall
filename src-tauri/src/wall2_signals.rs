//! Wall 2 microphone and camera use. Only fixed categories cross the bridge or enter the log.
#![cfg_attr(not(windows), allow(dead_code))]

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

const MAX_SUBKEYS: usize = 512;
const POLL: Duration = Duration::from_secs(2);
const WALL2_LABEL: &str = "wall2";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Uses { teams: bool, zoom: bool, browser: bool, recorder: bool, other: bool }

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Signals { known: bool, mic: Uses, camera: Uses }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind { Teams, Zoom, Browser, Recorder, Other }

fn kind_of(key: &str) -> Kind {
    let lower = key.to_ascii_lowercase();
    let file = lower.rsplit(['#', '\\', '/']).next().unwrap_or(&lower);
    if file == "ms-teams.exe" || file == "teams.exe" || lower.starts_with("msteams_") || lower.starts_with("microsoftteams_") { Kind::Teams }
    else if file == "zoom.exe" || file == "cpthost.exe" { Kind::Zoom }
    else if matches!(file, "chrome.exe" | "msedge.exe" | "firefox.exe" | "brave.exe") { Kind::Browser }
    else if file.starts_with("camtasia") || file.starts_with("camrec") || file == "obs64.exe" { Kind::Recorder }
    else { Kind::Other }
}

fn active(start: u64, stop: u64) -> bool { start != 0 && stop == 0 }
fn live_desktop(start: u64, stop: u64, image: &str, running: &std::collections::HashSet<String>) -> bool {
    active(start, stop) && running.contains(&image.to_ascii_lowercase())
}
fn within_cap(count: usize) -> bool { count <= MAX_SUBKEYS }

impl Uses {
    fn set(&mut self, kind: Kind) { match kind { Kind::Teams => self.teams = true, Kind::Zoom => self.zoom = true, Kind::Browser => self.browser = true, Kind::Recorder => self.recorder = true, Kind::Other => self.other = true } }
}

static CURRENT: Mutex<Signals> = Mutex::new(Signals { known: false, mic: Uses { teams: false, zoom: false, browser: false, recorder: false, other: false }, camera: Uses { teams: false, zoom: false, browser: false, recorder: false, other: false } });
static STOP: AtomicBool = AtomicBool::new(false);
static STARTED: AtomicBool = AtomicBool::new(false);

/// Whether a recorder holds the microphone or the camera in this reading. The same rule as the
/// page's `deriveRecording`.
pub(crate) fn recording_of(s: &Signals) -> bool { s.known && (s.mic.recorder || s.camera.recorder) }

/// Whether a recorder is running now, from the native poll. Only Rust asks this (the recording
/// keys in `wall2_keys`); the page's own idea of it is never trusted for a key press.
pub(crate) fn recording_now() -> bool { recording_of(&CURRENT.lock().unwrap_or_else(|e| e.into_inner())) }

#[tauri::command]
pub fn wall2_signals(window: tauri::WebviewWindow) -> Result<Signals, String> {
    if window.label() != WALL2_LABEL { return Err("forbidden".into()); }
    Ok(*CURRENT.lock().unwrap_or_else(|e| e.into_inner()))
}

const PAGE_WORDS: [&str; 7] = ["call start teams", "call start zoom", "call start browser", "call end", "recording on", "recording off", "leave found"];
fn page_line(word: &str, value: Option<u16>) -> Option<String> {
    if !PAGE_WORDS.contains(&word) { return None; }
    if word == "leave found" {
        let n = value?;
        if n > 720 { return None; }
        Some(format!("page leave found {n}"))
    } else if value.is_none() { Some(format!("page {word}")) } else { None }
}

fn page_rate_ok() -> bool {
    static LAST: OnceLock<Mutex<Option<std::time::Instant>>> = OnceLock::new();
    let mut last = LAST.get_or_init(|| Mutex::new(None)).lock().unwrap_or_else(|e| e.into_inner());
    let now = std::time::Instant::now();
    if last.is_some_and(|at| now.duration_since(at) < Duration::from_millis(100)) { return false; }
    *last = Some(now);
    true
}

#[tauri::command]
pub fn wall2_signals_report(window: tauri::WebviewWindow, word: String, value: Option<u16>) -> Result<(), String> {
    if window.label() != WALL2_LABEL { return Err("forbidden".into()); }
    let line = page_line(&word, value).ok_or_else(|| "refused".to_string())?;
    if !page_rate_ok() { return Err("rate-limited".into()); }
    log::write_page(line);
    Ok(())
}

pub fn start(app: tauri::AppHandle, dir: Option<std::path::PathBuf>) {
    log::start(dir);
    if STARTED.swap(true, Ordering::SeqCst) { return; }
    STOP.store(false, Ordering::SeqCst);
    #[cfg(windows)]
    let _ = std::thread::Builder::new().name("wall2-signals".into()).spawn(move || {
        use tauri::Emitter;
        let mut before: Option<Signals> = None;
        while !STOP.load(Ordering::SeqCst) {
            let next = win::read().unwrap_or_default();
            if before != Some(next) {
                if let Some(old) = before { for line in edge_lines(old, next) { log::write_native(line); } }
                else {
                    log::write_native(if next.known { "store ok" } else { "store unknown" }.into());
                    for line in edge_lines(Signals { known: next.known, ..Signals::default() }, next) { log::write_native(line); }
                }
                *CURRENT.lock().unwrap_or_else(|e| e.into_inner()) = next;
                let _ = app.emit("signals-changed", next);
                before = Some(next);
            }
            std::thread::sleep(POLL);
        }
    });
    #[cfg(not(windows))]
    let _ = app;
}

pub fn shutdown() { STOP.store(true, Ordering::SeqCst); }

fn edge_lines(old: Signals, new: Signals) -> Vec<String> {
    let mut lines = Vec::new();
    if old.known != new.known { lines.push(if new.known { "store ok" } else { "store unknown" }.into()); }
    for (device, a, b) in [("mic", old.mic, new.mic), ("camera", old.camera, new.camera)] {
        for (kind, was, is) in [("teams", a.teams, b.teams), ("zoom", a.zoom, b.zoom), ("browser", a.browser, b.browser), ("recorder", a.recorder, b.recorder), ("other", a.other, b.other)] {
            if was != is { lines.push(format!("{device} {kind} {}", if is { "on" } else { "off" })); }
        }
    }
    lines
}

mod log {
    use super::*;
    use std::sync::mpsc::SyncSender;
    const NATIVE_CAP: usize = 1800;
    const PAGE_CAP: usize = 200;
    static NATIVE_TX: OnceLock<SyncSender<String>> = OnceLock::new();
    static PAGE_TX: OnceLock<SyncSender<String>> = OnceLock::new();
    pub fn start(dir: Option<std::path::PathBuf>) {
        use std::io::Write;
        let Some(dir) = dir else { return };
        let _ = std::fs::create_dir_all(&dir);
        let Ok(mut file) = std::fs::File::create(dir.join("wall2-signals.log")) else { return };
        let (native_tx, native_rx) = std::sync::mpsc::sync_channel::<String>(64);
        let (page_tx, page_rx) = std::sync::mpsc::sync_channel::<String>(16);
        if std::thread::Builder::new().name("wall2-signals-log".into()).spawn(move || {
            let mut native_lines = 0;
            let mut page_lines = 0;
            loop {
                let next = native_rx.recv_timeout(Duration::from_millis(50)).ok().map(|line| (line, false))
                    .or_else(|| page_rx.try_recv().ok().map(|line| (line, true)));
                let Some((line, page)) = next else { continue };
                if (page && page_lines >= PAGE_CAP) || (!page && native_lines >= NATIVE_CAP) { continue; }
                let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
                if writeln!(file, "{now} {line}").is_ok() {
                    if page { page_lines += 1; } else { native_lines += 1; }
                }
            }
        }).is_ok() {
            let _ = NATIVE_TX.set(native_tx);
            let _ = PAGE_TX.set(page_tx);
        }
    }
    pub fn write_native(line: String) { if let Some(tx) = NATIVE_TX.get() { let _ = tx.try_send(line); } }
    pub fn write_page(line: String) { if let Some(tx) = PAGE_TX.get() { let _ = tx.try_send(line); } }
}

#[cfg(windows)]
mod win {
    use super::*;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::{ERROR_MORE_DATA, ERROR_NO_MORE_ITEMS, ERROR_SUCCESS};
    use windows::Win32::System::Registry::{RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ, REG_QWORD};

    struct Key(HKEY);
    impl Drop for Key { fn drop(&mut self) { unsafe { let _ = RegCloseKey(self.0); } } }
    fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain(Some(0)).collect() }
    fn open(parent: HKEY, name: &str) -> Result<Key, ()> {
        let mut out = HKEY::default();
        let w = wide(name);
        (unsafe { RegOpenKeyExW(parent, PCWSTR(w.as_ptr()), 0, KEY_READ, &mut out) } == ERROR_SUCCESS).then_some(Key(out)).ok_or(())
    }
    fn names(key: HKEY, total: &mut usize) -> Result<Vec<String>, ()> {
        let mut out = Vec::new();
        for index in 0..=MAX_SUBKEYS {
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let code = unsafe { RegEnumKeyExW(key, index as u32, PWSTR(buf.as_mut_ptr()), &mut len, None, PWSTR::null(), None, None) };
            if code == ERROR_NO_MORE_ITEMS { return Ok(out); }
            if code == ERROR_MORE_DATA || code != ERROR_SUCCESS { return Err(()); }
            *total += 1;
            if !within_cap(*total) { return Err(()); }
            out.push(String::from_utf16(&buf[..len as usize]).map_err(|_| ())?);
        }
        Err(())
    }
    fn qword(key: HKEY, name: &str) -> Result<u64, ()> {
        let mut kind = REG_QWORD;
        let mut bytes = [0u8; 8];
        let mut size = bytes.len() as u32;
        let w = wide(name);
        let code = unsafe { RegQueryValueExW(key, PCWSTR(w.as_ptr()), None, Some(&mut kind), Some(bytes.as_mut_ptr()), Some(&mut size)) };
        if code != ERROR_SUCCESS || kind != REG_QWORD || size != 8 { return Err(()); }
        Ok(u64::from_le_bytes(bytes))
    }
    fn running() -> std::collections::HashSet<String> {
        let mut system = sysinfo::System::new();
        system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        system.processes().values().map(|p| p.name().to_string_lossy().to_ascii_lowercase()).collect()
    }
    fn device(name: &str, running: &std::collections::HashSet<String>) -> Result<Uses, ()> {
        let base = open(HKEY_CURRENT_USER, &format!("Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\{name}"))?;
        let mut total = 0;
        let mut uses = Uses::default();
        for entry in names(base.0, &mut total)? {
            let child = open(base.0, &entry)?;
            if entry.eq_ignore_ascii_case("NonPackaged") {
                for desktop in names(child.0, &mut total)? {
                    let item = open(child.0, &desktop)?;
                    let start = qword(item.0, "LastUsedTimeStart")?;
                    let stop = qword(item.0, "LastUsedTimeStop")?;
                    let image = desktop.rsplit('#').next().unwrap_or(&desktop);
                    if live_desktop(start, stop, image, running) { uses.set(kind_of(&desktop)); }
                }
            } else if active(qword(child.0, "LastUsedTimeStart")?, qword(child.0, "LastUsedTimeStop")?) { uses.set(kind_of(&entry)); }
        }
        Ok(uses)
    }
    pub fn read() -> Result<Signals, ()> {
        let processes = running();
        Ok(Signals { known: true, mic: device("microphone", &processes)?, camera: device("webcam", &processes)? })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn maps_fixed_kinds() {
        assert_eq!(kind_of(r"C:#Program Files#Teams#MS-TEAMS.EXE"), Kind::Teams);
        assert_eq!(kind_of("MSTeams_8wekyb3d8bbwe"), Kind::Teams);
        assert_eq!(kind_of(r"C:#Zoom#CptHost.exe"), Kind::Zoom);
        assert_eq!(kind_of(r"C:#Apps#Chrome.exe"), Kind::Browser);
        assert_eq!(kind_of(r"C:#Apps#CamtasiaStudio.exe"), Kind::Recorder);
        assert_eq!(kind_of("odd_package"), Kind::Other);
    }
    #[test] fn recording_needs_a_known_reading_and_a_recorder_on_the_mic_or_camera() {
        let on = Uses { recorder: true, ..Uses::default() };
        assert!(recording_of(&Signals { known: true, mic: on, camera: Uses::default() }));
        assert!(recording_of(&Signals { known: true, mic: Uses::default(), camera: on }));
        assert!(!recording_of(&Signals { known: false, mic: on, camera: on }), "an unknown reading is never a recording");
        assert!(!recording_of(&Signals { known: true, mic: Uses { teams: true, browser: true, other: true, ..Uses::default() }, camera: Uses { zoom: true, ..Uses::default() } }), "a call is not a recording");
        assert!(!recording_of(&Signals::default()));
    }
    #[test] fn active_value_rule() { assert!(active(1, 0)); assert!(!active(0, 0)); assert!(!active(1, 2)); }
    #[test] fn stale_desktop_needs_a_process() {
        let mut running = std::collections::HashSet::new();
        assert!(!live_desktop(1, 0, "zoom.exe", &running));
        running.insert("zoom.exe".into());
        assert!(live_desktop(1, 0, "ZOOM.EXE", &running));
    }
    #[test] fn subkey_cap_is_exact() { assert!(within_cap(512)); assert!(!within_cap(513)); }
    #[test] fn payload_has_only_fixed_shape() {
        let json = serde_json::to_value(Signals::default()).unwrap();
        let mut keys = json.as_object().unwrap().keys().map(String::as_str).collect::<Vec<_>>();
        keys.sort_unstable();
        assert_eq!(keys, ["camera", "known", "mic"]);
        assert_eq!(json["mic"].as_object().unwrap().len(), 5);
    }
    #[test] fn page_log_refuses_free_text_and_bad_numbers() {
        assert_eq!(page_line("call start teams", None).as_deref(), Some("page call start teams"));
        assert_eq!(page_line("leave found", Some(45)).as_deref(), Some("page leave found 45"));
        assert!(page_line("leave found", Some(721)).is_none());
        assert!(page_line("call start teams now", None).is_none());
        assert!(page_line("call end", Some(1)).is_none());
    }
    #[test] fn native_edges_use_only_fixed_words() {
        let old = Signals { known: true, ..Signals::default() };
        let new = Signals { known: true, mic: Uses { teams: true, ..Uses::default() }, camera: Uses { recorder: true, ..Uses::default() } };
        assert_eq!(edge_lines(old, new), ["mic teams on", "camera recorder on"]);
        assert_eq!(edge_lines(new, Signals::default()), ["store unknown", "mic teams off", "camera recorder off"]);
    }
}
