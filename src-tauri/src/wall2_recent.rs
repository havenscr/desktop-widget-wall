//! Wall 2 Shelf recent files: the last five files the user opened, from the Windows Recent folder.
//!
//! What the page can and cannot do:
//! - The page asks for a list and gets, per file, an opaque id (a hash of its path, the time it
//!   was last opened and its size; Rust keeps a bounded map of id to path across reads), the
//!   file name, the time (epoch milliseconds) and a coarse kind. It never gets a path or a
//!   folder, and it never sends one: `open` and `folder` take only an id.
//! - The reader is the old app's (`read_recent_files`: the Recent folder's shortcuts, resolved).
//!   A target must be an absolute local `X:\...` path (see `plain_local_path`), a regular file
//!   that still exists, and not a program or script: the kinds Windows runs when opened are
//!   never listed and never acted on. The check is made again, after links are followed, at
//!   the moment of an `open` or a `folder`.
//! - `open` is the default app (the opener plugin, no shell, no arguments); `folder` is
//!   `explorer.exe /select,` and the quoted path (the captures module's helper).
//! - At most 5 files are returned. Nothing is logged: no path, no name.
//!
//! Errors are fixed words: `failed`, `missing` (the id or the file is gone), `refused` (a path
//! that does not pass), `forbidden` (the wrong window).
#![cfg_attr(not(windows), allow(dead_code))]

use crate::wall2_captures::{cap_chars, id_for, parse_time_ms, pick, plain_local_path, remember};
use crate::RecentFileInfo;
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;
use tauri_plugin_opener::OpenerExt;

/// Files returned to the page.
const SHOWN: usize = 5;
/// Shortcuts asked of the reader: more than `SHOWN`, because some targets are filtered out.
const READ: usize = 30;
/// The most ids kept across reads.
const MAX_HELD: usize = 64;
const NAME_CHARS: usize = 120;

const FAILED: &str = "failed";
const MISSING: &str = "missing";
const REFUSED: &str = "refused";

/// Id to path, oldest first, merged across reads and bounded to `MAX_HELD`.
static HELD: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());

/// One file as the page sees it.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
    pub id: String,
    pub name: String,
    /// Epoch milliseconds; 0 when the time is unknown.
    pub modified: i64,
    pub kind: &'static str,
}

/// Extensions Windows runs, installs or hands to a script host when opened. Never listed, never opened.
const RUNNABLE: &[&str] = &[
    "exe", "com", "scr", "pif", "bat", "cmd", "msi", "msp", "msc", "lnk", "url", "hta", "cpl", "reg", "inf", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "jar",
    "appx", "msix", "appinstaller", "application", "gadget", "dll", "sys", "scf", "settingcontent-ms", "library-ms", "search-ms",
];

/// The lower-case extension of a file name, or "".
fn ext_of(name: &str) -> String {
    match name.rsplit_once('.') {
        Some((_, e)) => e.to_ascii_lowercase(),
        None => String::new(),
    }
}

/// Whether the text of a path may be listed or acted on: a plain local path whose extension is not a runnable one.
pub(crate) fn allowed_text(p: &str) -> bool {
    plain_local_path(p) && !RUNNABLE.contains(&ext_of(p).as_str())
}

/// The last part of a path.
fn file_name(p: &str) -> &str {
    p.rsplit('\\').next().unwrap_or(p)
}

/// A coarse kind for the page, from the extension.
fn kind_of(name: &str) -> &'static str {
    match ext_of(name).as_str() {
        "doc" | "docx" | "odt" | "rtf" | "txt" | "md" | "pdf" => "document",
        "xls" | "xlsx" | "xlsm" | "csv" | "ods" | "pbix" | "pbip" => "sheet",
        "ppt" | "pptx" | "odp" => "slides",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" => "image",
        "mp4" | "webm" | "mkv" | "mov" | "avi" => "video",
        "mp3" | "wav" | "flac" | "m4a" | "ogg" => "audio",
        "zip" | "7z" | "rar" | "gz" | "tar" => "archive",
        "json" | "yml" | "yaml" | "xml" | "html" | "css" | "ts" | "tsx" | "py" | "rs" | "sql" | "dax" | "tmdl" => "code",
        _ => "other",
    }
}

/// The files to show, newest first, at most `SHOWN`: each path must pass `allowed_text`, appear
/// once (the first, newest, time wins) and still be a regular file (`stat` gives its size, None
/// when it is not one). Returns the entry and the path behind its id.
pub(crate) fn shape(files: &[RecentFileInfo], stat: &dyn Fn(&str) -> Option<u64>) -> Vec<(RecentEntry, String)> {
    let mut rows: Vec<(i64, &RecentFileInfo)> = files.iter().map(|f| (parse_time_ms(&f.modified).unwrap_or(0), f)).collect();
    rows.sort_by(|a, b| b.0.cmp(&a.0));
    let mut out: Vec<(RecentEntry, String)> = Vec::new();
    for (time, f) in rows {
        if out.len() >= SHOWN {
            break;
        }
        if !allowed_text(&f.path) || out.iter().any(|(_, p)| p.eq_ignore_ascii_case(&f.path)) {
            continue;
        }
        let Some(size) = stat(&f.path) else { continue };
        let name = cap_chars(file_name(&f.path), NAME_CHARS);
        if name.is_empty() {
            continue;
        }
        let entry = RecentEntry { id: id_for(&f.path, time, size), kind: kind_of(&name), name, modified: time };
        out.push((entry, f.path.clone()));
    }
    out
}

/// Size of a regular file once links are followed (a directory is not one).
fn regular_size(path: &Path) -> Option<u64> {
    std::fs::metadata(path).ok().filter(|m| m.is_file()).map(|m| m.len())
}

/// The path to act on: the held path checked as text, resolved through links, checked as text
/// again, as a regular file. Err is `missing` (no such file) or `refused`.
fn resolve(path: &str) -> Result<String, &'static str> {
    if !allowed_text(path) {
        return Err(REFUSED);
    }
    let resolved = std::fs::canonicalize(path).map_err(|_| MISSING)?;
    let text = crate::wall2_sharex::strip_verbatim(resolved.to_str().ok_or(REFUSED)?).ok_or(REFUSED)?;
    if !allowed_text(&text) {
        return Err(REFUSED);
    }
    regular_size(Path::new(&text)).ok_or(MISSING)?;
    Ok(text)
}

fn list_now() -> Result<Vec<RecentEntry>, String> {
    let files = crate::read_recent_files(READ);
    let shaped = shape(&files, &|p| regular_size(Path::new(p)));
    let fresh: Vec<(String, String)> = shaped.iter().map(|(e, p)| (e.id.clone(), p.clone())).collect();
    let mut held = HELD.lock().map_err(|_| FAILED.to_string())?;
    remember(&mut held, fresh, MAX_HELD);
    Ok(shaped.into_iter().map(|(e, _)| e).collect())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Act {
    Open,
    Folder,
}

fn act_now(app: &tauri::AppHandle, id: &str, act: Act) -> Result<(), String> {
    let held = {
        let list = HELD.lock().map_err(|_| FAILED.to_string())?;
        pick(&list, id).cloned().ok_or_else(|| MISSING.to_string())?
    };
    let path = resolve(&held).map_err(str::to_string)?;
    match act {
        Act::Open => app.opener().open_path(path, None::<&str>).map_err(|_| FAILED.to_string()),
        Act::Folder => crate::wall2_captures::show_in_folder(&path),
    }
}

/// The calling window first.
fn check(label: &str) -> Result<(), String> {
    crate::wall2_meet::require_wall2(label)
}

/// The last five files opened, newest first.
#[tauri::command]
pub async fn wall2_recent_files(window: tauri::WebviewWindow) -> Result<Vec<RecentEntry>, String> {
    check(window.label())?;
    tauri::async_runtime::spawn_blocking(list_now).await.map_err(|_| FAILED.to_string())?
}

/// Open a listed file in its default app, by id.
#[tauri::command]
pub async fn wall2_recent_open(window: tauri::WebviewWindow, app: tauri::AppHandle, id: String) -> Result<(), String> {
    check(window.label())?;
    tauri::async_runtime::spawn_blocking(move || act_now(&app, &id, Act::Open)).await.map_err(|_| FAILED.to_string())?
}

/// Show a listed file in File Explorer, selected, by id.
#[tauri::command]
pub async fn wall2_recent_folder(window: tauri::WebviewWindow, app: tauri::AppHandle, id: String) -> Result<(), String> {
    check(window.label())?;
    tauri::async_runtime::spawn_blocking(move || act_now(&app, &id, Act::Folder)).await.map_err(|_| FAILED.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = r"C:\Users\someone\Documents\alpha.docx";
    const B: &str = r"C:\Users\someone\Documents\beta.xlsx";

    fn info(path: &str, modified: &str) -> RecentFileInfo {
        RecentFileInfo { name: file_name(path).to_string(), path: path.to_string(), modified: modified.to_string() }
    }

    fn exists(_: &str) -> Option<u64> {
        Some(10)
    }

    #[test]
    fn programs_and_scripts_never_pass() {
        assert!(allowed_text(A));
        assert!(!allowed_text(r"C:\Tools\setup.exe"));
        assert!(!allowed_text(r"C:\Tools\RUN.BAT"));
        assert!(!allowed_text(r"C:\Tools\link.lnk"));
        assert!(!allowed_text(r"C:\Tools\x.Ps1"));
        assert!(!allowed_text(r"\\server\share\alpha.docx"));
        assert!(!allowed_text("https://example.com/a.docx"));
        assert!(!allowed_text(r"alpha.docx"));
    }

    #[test]
    fn the_newest_five_come_back_newest_first() {
        let files: Vec<RecentFileInfo> = (1..=8).map(|i| info(&format!(r"C:\Docs\f{i}.txt"), &format!("2026-11-1{i}T10:00:00Z"))).collect();
        let out = shape(&files, &exists);
        let names: Vec<&str> = out.iter().map(|(e, _)| e.name.as_str()).collect();
        assert_eq!(names, ["f8.txt", "f7.txt", "f6.txt", "f5.txt", "f4.txt"]);
        assert!(out[0].0.modified > out[1].0.modified);
    }

    #[test]
    fn missing_files_programs_and_repeats_are_skipped() {
        let files = vec![
            info(r"C:\Docs\gone.txt", "2026-11-11T10:05:00Z"),
            info(r"C:\Docs\tool.exe", "2026-11-11T10:04:00Z"),
            info(A, "2026-11-11T10:03:00Z"),
            info(&A.to_ascii_uppercase(), "2026-11-11T10:02:00Z"),
            info(B, "2026-11-11T10:01:00Z"),
        ];
        let stat = |p: &str| if p.contains("gone") { None } else { Some(1) };
        let out = shape(&files, &stat);
        let names: Vec<&str> = out.iter().map(|(e, _)| e.name.as_str()).collect();
        assert_eq!(names, ["alpha.docx", "beta.xlsx"]);
    }

    #[test]
    fn an_unreadable_time_gets_zero_and_sorts_last() {
        let files = vec![info(A, "not a date"), info(B, "2026-11-11T10:01:00Z")];
        let out = shape(&files, &exists);
        assert_eq!(out[0].0.name, "beta.xlsx");
        assert_eq!(out[1].0.modified, 0);
    }

    #[test]
    fn an_id_is_stable_opaque_and_leaves_the_path_out_of_the_entry() {
        let files = vec![info(A, "2026-11-11T10:03:00Z")];
        let one = shape(&files, &exists);
        let two = shape(&files, &exists);
        assert_eq!(one[0].0.id, two[0].0.id);
        assert_eq!(one[0].0.id.len(), 16);
        let json = serde_json::to_string(&one[0].0).unwrap();
        assert!(!json.contains("Users") && !json.contains('\\'));
        let later = shape(&[info(A, "2026-11-11T10:04:00Z")], &exists);
        assert_ne!(one[0].0.id, later[0].0.id);
    }

    #[test]
    fn the_map_keeps_only_the_newest_ids_and_an_unknown_id_picks_nothing() {
        let mut map: Vec<(String, String)> = Vec::new();
        for i in 0..100u64 {
            remember(&mut map, vec![(id_for(A, i as i64, i), A.to_string())], MAX_HELD);
        }
        assert_eq!(map.len(), MAX_HELD);
        assert!(pick(&map, &id_for(A, 99, 99)).is_some());
        assert!(pick(&map, &id_for(A, 0, 0)).is_none());
        assert!(pick(&map, "ffffffffffffffff").is_none());
    }

    #[test]
    fn resolve_refuses_a_path_that_does_not_pass_before_touching_the_disk() {
        assert_eq!(resolve(r"\\server\share\a.docx"), Err(REFUSED));
        assert_eq!(resolve(r"C:\Tools\setup.exe"), Err(REFUSED));
        assert_eq!(resolve("a.docx"), Err(REFUSED));
    }

    #[test]
    fn a_directory_is_not_a_regular_file() {
        let dir = std::env::temp_dir();
        assert_eq!(regular_size(&dir), None);
        assert_eq!(regular_size(&dir.join("wall2-recent-test-no-such-file.txt")), None);
    }

    #[test]
    fn only_the_wall_window_may_ask() {
        assert!(check("main").is_err());
        assert!(check("wall2").is_ok());
    }

    #[test]
    fn the_window_check_is_the_first_statement_of_every_command() {
        let src = include_str!("wall2_recent.rs").replace("\r\n", "\n");
        for name in ["wall2_recent_files", "wall2_recent_open", "wall2_recent_folder"] {
            let needle = format!("pub async fn {}(", name);
            let at = src.find(&needle).expect("command");
            let body = &src[at..];
            let open = body.find('{').expect("body");
            let first = body[open + 1..].trim_start();
            assert!(first.starts_with("check(window.label())?;"), "{name}");
        }
    }

    #[test]
    fn the_source_never_logs() {
        let src = include_str!("wall2_recent.rs").replace("\r\n", "\n");
        let macros = ["print", "eprint", "dbg", "log", "info", "warn", "debug"];
        for m in macros {
            assert!(!src.contains(&format!("{m}!(")), "{m}");
        }
    }
}
