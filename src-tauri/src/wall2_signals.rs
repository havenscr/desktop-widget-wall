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
        Some(format!("leave found {n}"))
    } else if value.is_none() { Some(word.to_string()) } else { None }
}

#[tauri::command]
pub fn wall2_signals_report(window: tauri::WebviewWindow, word: String, value: Option<u16>) -> Result<(), String> {
    if window.label() != WALL2_LABEL { return Err("forbidden".into()); }
    log::write(page_line(&word, value).ok_or_else(|| "refused".to_string())?);
    Ok(())
}

pub fn start(app: tauri::AppHandle, dir: Option<std::path::PathBuf>) {
    log::start(dir);
    if STARTED.swap(true, Ordering::SeqCst) { return; }
    STOP.store(false, Ordering::SeqCst);
    #[cfg(windows)]
    let _ = std::thread::Builder::new().name("wall2-signals".into()).spawn(move || {
        use tauri::Emitter;
        let mut before = Signals::default();
        while !STOP.load(Ordering::SeqCst) {
            let next = win::read().unwrap_or_default();
            if next != before {
                log_edges(before, next);
                *CURRENT.lock().unwrap_or_else(|e| e.into_inner()) = next;
                let _ = app.emit("signals-changed", next);
                before = next;
            }
            std::thread::sleep(POLL);
        }
    });
    #[cfg(not(windows))]
    let _ = app;
}

pub fn shutdown() { STOP.store(true, Ordering::SeqCst); }

fn log_edges(old: Signals, new: Signals) {
    if old.known != new.known { log::write(if new.known { "store ok" } else { "store unknown" }.into()); }
    for (device, a, b) in [("mic", old.mic, new.mic), ("camera", old.camera, new.camera)] {
        for (kind, was, is) in [("teams", a.teams, b.teams), ("zoom", a.zoom, b.zoom), ("browser", a.browser, b.browser), ("recorder", a.recorder, b.recorder), ("other", a.other, b.other)] {
            if was != is { log::write(format!("{device} {kind} {}", if is { "on" } else { "off" })); }
        }
    }
}

mod log {
    use super::*;
    use std::sync::mpsc::SyncSender;
    static TX: OnceLock<SyncSender<String>> = OnceLock::new();
    pub fn start(dir: Option<std::path::PathBuf>) {
        use std::io::Write;
        let Some(dir) = dir else { return };
        let _ = std::fs::create_dir_all(&dir);
        let Ok(mut file) = std::fs::File::create(dir.join("wall2-signals.log")) else { return };
        let (tx, rx) = std::sync::mpsc::sync_channel::<String>(64);
        if std::thread::Builder::new().name("wall2-signals-log".into()).spawn(move || {
            let mut lines = 0;
            while let Ok(line) = rx.recv() {
                if lines >= 2000 { continue; }
                let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
                if writeln!(file, "{now} {line}").is_ok() { lines += 1; }
            }
        }).is_ok() { let _ = TX.set(tx); }
    }
    pub fn write(line: String) { if let Some(tx) = TX.get() { let _ = tx.try_send(line); } }
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
        assert_eq!(page_line("call start teams", None).as_deref(), Some("call start teams"));
        assert_eq!(page_line("leave found", Some(45)).as_deref(), Some("leave found 45"));
        assert!(page_line("leave found", Some(721)).is_none());
        assert!(page_line("call start teams now", None).is_none());
        assert!(page_line("call end", Some(1)).is_none());
    }
}
