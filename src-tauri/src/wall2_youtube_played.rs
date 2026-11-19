//! The wall's own play record for the YouTube side: video ids and times, nothing else. It holds only
//! what the wall itself played (a pick on the music card), at most 200 entries and nothing older than
//! 30 days, newest first, no id twice. The page never writes a title, a channel or a path: it passes a
//! video id (checked here), and the time is Rust's own clock. Sign-out clears the file.
//!
//! Everything before the `commands` marker is plain Rust over a path and a clock, so every path runs
//! in a test with a temporary file. The marker splits off the thin Tauri layer.

use serde::Serialize;
use serde_json::Value;
use std::io::Read;
use std::path::Path;
use std::sync::Mutex;

/// The most entries kept.
pub const MAX_PLAYED: usize = 200;
/// An entry older than this many seconds is dropped (30 days).
pub const MAX_AGE_S: u64 = 30 * 24 * 3600;
/// A file longer than this is not read at all (200 entries come to about 8 KB).
const FILE_MAX: u64 = 64 * 1024;
/// A time further ahead than this is a wrong clock or a forged entry, and is dropped.
const FUTURE_S: u64 = 3600;
const FILE_NAME: &str = "yt-played.json";
const FAILED: &str = "failed";
const INVALID: &str = "invalid";

/// One play: a video id and the time (seconds since 1970) the wall started it.
#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct YtPlayed { id: String, at: u64 }

fn valid_id(s: &str) -> bool { crate::wall2_youtube::valid_video_id(s) }

/// The list as it may be kept: ids of the exact shape, times neither too old nor in the future, newest
/// first, no id twice (its newest time stays), at most `MAX_PLAYED`.
fn clean(mut list: Vec<YtPlayed>, now: u64) -> Vec<YtPlayed> {
    list.retain(|p| valid_id(&p.id) && p.at <= now.saturating_add(FUTURE_S) && now.saturating_sub(p.at) <= MAX_AGE_S);
    // A stable sort: of two equal times the earlier-listed (the more recently added) stays first.
    list.sort_by(|a, b| b.at.cmp(&a.at));
    let mut seen = std::collections::HashSet::new();
    list.retain(|p| seen.insert(p.id.clone()));
    list.truncate(MAX_PLAYED);
    list
}

/// `id` played now: it goes first, and the rest is cleaned.
fn with_play(mut list: Vec<YtPlayed>, id: &str, now: u64) -> Vec<YtPlayed> {
    list.insert(0, YtPlayed { id: id.to_string(), at: now });
    clean(list, now)
}

/// The stored text as a list: anything that is not an array gives an empty list, and an entry that is
/// not exactly `{id, at}` with a string and a whole number is skipped. Never more than the file cap.
fn parse(text: &str, now: u64) -> Vec<YtPlayed> {
    if text.len() as u64 > FILE_MAX { return Vec::new() }
    let Ok(Value::Array(items)) = serde_json::from_str::<Value>(text) else { return Vec::new() };
    let list = items.iter().filter_map(|v| {
        let o = v.as_object()?;
        Some(YtPlayed { id: o.get("id")?.as_str()?.to_string(), at: o.get("at")?.as_u64()? })
    }).collect();
    clean(list, now)
}

fn render(list: &[YtPlayed]) -> String {
    let items: Vec<Value> = list.iter().map(|p| serde_json::json!({ "id": p.id, "at": p.at })).collect();
    Value::Array(items).to_string()
}

fn read_file(path: &Path, now: u64) -> Vec<YtPlayed> {
    let mut bytes = Vec::new();
    let Ok(file) = std::fs::File::open(path) else { return Vec::new() };
    if file.take(FILE_MAX + 1).read_to_end(&mut bytes).is_err() { return Vec::new() }
    match String::from_utf8(bytes) { Ok(text) => parse(&text, now), Err(_) => Vec::new() }
}

/// Write beside the file, then rename over it, so a crash leaves the old file or the new one.
fn write_file(path: &Path, list: &[YtPlayed]) -> Result<(), &'static str> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, render(list)).map_err(|_| FAILED)?;
    std::fs::rename(&tmp, path).map_err(|_| { let _ = std::fs::remove_file(&tmp); FAILED })
}

/// One read-change-write at a time.
static LOCK: Mutex<()> = Mutex::new(());
fn locked() -> std::sync::MutexGuard<'static, ()> { LOCK.lock().unwrap_or_else(|e| e.into_inner()) }

fn note_in(dir: &Path, id: &str, now: u64) -> Result<(), &'static str> {
    if !valid_id(id) { return Err(INVALID) }
    let _g = locked();
    std::fs::create_dir_all(dir).map_err(|_| FAILED)?;
    let path = dir.join(FILE_NAME);
    write_file(&path, &with_play(read_file(&path, now), id, now))
}

fn played_in(dir: &Path, now: u64) -> Vec<YtPlayed> {
    let _g = locked();
    read_file(&dir.join(FILE_NAME), now)
}

/// Remove the file. A missing file is fine.
pub fn forget_in(dir: &Path) -> Result<(), &'static str> {
    let _g = locked();
    match std::fs::remove_file(dir.join(FILE_NAME)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(FAILED),
    }
}

fn unix_now() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) }

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_800_000_000;
    const DAY: u64 = 24 * 3600;
    fn id(n: usize) -> String { format!("vid{n:08}") }
    fn p(n: usize, at: u64) -> YtPlayed { YtPlayed { id: id(n), at } }
    fn temp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("wall2-played-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn a_play_goes_first_and_a_repeat_keeps_only_its_newest_time() {
        let list = with_play(vec![p(1, NOW - 50), p(2, NOW - 40)], &id(1), NOW);
        assert_eq!(list, vec![p(1, NOW), p(2, NOW - 40)]);
    }

    #[test]
    fn the_list_is_capped_at_200_and_the_oldest_leave_first() {
        let mut list = Vec::new();
        for n in 0..250 { list = with_play(list, &id(n), NOW - 1000 + n as u64); }
        assert_eq!(list.len(), MAX_PLAYED);
        assert_eq!(list[0].id, id(249));
        assert_eq!(list[MAX_PLAYED - 1].id, id(50));
    }

    #[test]
    fn nothing_older_than_30_days_stays_and_the_edge_second_does() {
        let list = clean(vec![p(1, NOW - MAX_AGE_S - 1), p(2, NOW - MAX_AGE_S), p(3, NOW - 5 * DAY)], NOW);
        assert_eq!(list, vec![p(3, NOW - 5 * DAY), p(2, NOW - MAX_AGE_S)]);
    }

    #[test]
    fn a_time_in_the_future_and_a_bad_id_are_dropped() {
        let bad = YtPlayed { id: "short".into(), at: NOW };
        let slash = YtPlayed { id: "abc/../x1234".into(), at: NOW };
        let list = clean(vec![p(1, NOW + FUTURE_S + 1), p(2, NOW + FUTURE_S), bad, slash], NOW);
        assert_eq!(list, vec![p(2, NOW + FUTURE_S)]);
    }

    #[test]
    fn junk_files_give_an_empty_list_and_bad_entries_are_skipped() {
        for junk in ["", "not json", "{}", "null", "42", "\"x\"", "{\"id\":1}"] { assert!(parse(junk, NOW).is_empty(), "{junk}"); }
        let text = format!(r#"[{{"id":"{}","at":{}}},{{"id":5,"at":1}},{{"id":"{}"}},{{"at":3}},7,{{"id":"{}","at":-4}},{{"id":"{}","at":"x"}}]"#, id(1), NOW - 10, id(2), id(3), id(4));
        assert_eq!(parse(&text, NOW), vec![p(1, NOW - 10)]);
        assert!(parse(&" ".repeat(FILE_MAX as usize + 1), NOW).is_empty());
    }

    #[test]
    fn the_file_holds_only_ids_and_times() {
        assert_eq!(render(&[p(1, NOW)]), format!(r#"[{{"id":"{}","at":{}}}]"#, id(1), NOW));
    }

    #[test]
    fn note_play_writes_reads_back_newest_first_and_forget_removes_the_file() {
        let dir = temp("roundtrip");
        assert!(played_in(&dir, NOW).is_empty());
        note_in(&dir, &id(1), NOW - 20).unwrap();
        note_in(&dir, &id(2), NOW - 10).unwrap();
        note_in(&dir, &id(1), NOW).unwrap();
        assert_eq!(played_in(&dir, NOW), vec![p(1, NOW), p(2, NOW - 10)]);
        assert!(!dir.join("yt-played.json.tmp").exists(), "the temporary file is renamed away");
        forget_in(&dir).unwrap();
        assert!(!dir.join(FILE_NAME).exists());
        assert!(played_in(&dir, NOW).is_empty());
        forget_in(&dir).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn note_play_refuses_a_bad_id_and_writes_nothing() {
        let dir = temp("refuse");
        for bad in ["", "short", "has space 11", "../../etc/pw", "twelve_chars"] { assert_eq!(note_in(&dir, bad, NOW), Err(INVALID), "{bad}"); }
        assert!(!dir.join(FILE_NAME).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_junk_or_oversized_file_on_disk_is_replaced_by_the_next_play() {
        let dir = temp("junk");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(FILE_NAME), vec![b'x'; FILE_MAX as usize + 10]).unwrap();
        assert!(played_in(&dir, NOW).is_empty());
        note_in(&dir, &id(7), NOW).unwrap();
        assert_eq!(played_in(&dir, NOW), vec![p(7, NOW)]);
        std::fs::write(dir.join(FILE_NAME), [0xff, 0xfe, 0x00]).unwrap();
        assert!(played_in(&dir, NOW).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn every_command_checks_the_window_first_and_sign_out_forgets_the_file() {
        // The needles are built at run time so this test's own text never matches them.
        let source = include_str!("wall2_youtube_played.rs").replace("\r\n", "\n");
        let function = ["pub async fn ", "wall2_youtube_"].concat();
        let attribute = ["#[tauri", "::command]"].concat();
        let commands = source.split(function.as_str()).skip(1).map(|rest| rest.split('(').next().unwrap_or("")).collect::<Vec<_>>();
        assert_eq!(commands, ["note_play", "played", "forget_played"]);
        for part in source.split(attribute.as_str()).skip(1) {
            let body: String = part.lines().skip(1).take(3).collect::<Vec<_>>().join("\n");
            assert!(body.contains("require(&window)?"), "{body}");
        }
        let youtube = include_str!("wall2_youtube.rs").replace("\r\n", "\n");
        let out = youtube.split("pub async fn wall2_youtube_sign_out").nth(1).unwrap().split("#[tauri").next().unwrap();
        assert!(out.contains("wall2_youtube_played::forget_in"), "{out}");
    }
}

// ---- commands -------------------------------------------------------------------------------

use tauri::{Manager, WebviewWindow};

fn require(window: &WebviewWindow) -> Result<(), String> { crate::wall2_meet::require_wall2(window.label()) }

/// The folder the record lives in: the app's config folder, beside the YouTube setup file.
pub fn dir_of(app: &tauri::AppHandle) -> Option<std::path::PathBuf> { app.path().app_config_dir().ok() }

/// The wall started this video: written to the record. Anything but a video id is refused.
#[tauri::command]
pub async fn wall2_youtube_note_play(window: WebviewWindow, id: String) -> Result<(), String> {
    require(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let dir = dir_of(&app).ok_or(FAILED)?;
        note_in(&dir, &id, unix_now())
    }).await.map_err(|_| FAILED.to_string())?.map_err(str::to_string)
}

/// What the wall played in the last 30 days, newest first (ids and times; titles come from `wall2_youtube_videos`).
#[tauri::command]
pub async fn wall2_youtube_played(window: WebviewWindow) -> Result<Vec<YtPlayed>, String> {
    require(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || dir_of(&app).map(|dir| played_in(&dir, unix_now())).unwrap_or_default()).await.map_err(|_| FAILED.to_string())
}

/// Forget the whole record.
#[tauri::command]
pub async fn wall2_youtube_forget_played(window: WebviewWindow) -> Result<(), String> {
    require(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || match dir_of(&app) { Some(dir) => forget_in(&dir).map_err(str::to_string), None => Ok(()) }).await.map_err(|_| FAILED.to_string())?
}
