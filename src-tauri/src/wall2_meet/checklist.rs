//! The first-meeting checklist: `meet-checklist.txt` in the app config folder, read here so the
//! page never sees raw file text.
//!
//! One item a line, UTF-8, at most 4 KB. Lines starting `#` or `//` and empty lines are
//! skipped; at most 8 items of 80 characters are kept. A path is never taken from the page, only
//! the `wall2` window may ask, nothing is logged, and an error is one of two fixed words: `failed`
//! and `not-configured`. The file rules follow `wall2_onair.rs`; the parser and every limit are
//! pure functions below.

use crate::wall2_onair::{clean, cut, write_new};
use serde::Serialize;
use std::io::Read;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

// Section: limits

pub(crate) const CHECKLIST_FILE: &str = "meet-checklist.txt";
/// The file is refused past this size.
pub(crate) const CHECKLIST_MAX_BYTES: u64 = 4 * 1024;
const ITEMS_MAX: usize = 8;
const ITEM_MAX_CHARS: usize = 80;
const OVER_SIZE: &str = "meet-checklist.txt is over 4 KB";
const NOT_TEXT: &str = "meet-checklist.txt is not UTF-8 text";

/// Written by Open file when there is no checklist yet (never over an existing file).
pub(crate) const STARTER: &str = "# One item a line. Lines starting # or // are skipped.\n\
Who decides, and by when\n\
Agree one next step before the end\n";

// Section: the checklist (pure)

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Checklist {
    /// `ok`, `missing` or `refused`.
    pub state: &'static str,
    pub items: Vec<String>,
    /// Why a file was refused, one fixed line.
    pub reason: Option<String>,
}

/// The items of a file: comments and empty lines skipped, control characters dropped, each item cut
/// at 80 characters, at most 8 kept.
pub(crate) fn parse_items(text: &str) -> Vec<String> {
    text.lines()
        .map(clean)
        .filter(|l| !l.is_empty() && !l.starts_with('#') && !l.starts_with("//"))
        .take(ITEMS_MAX)
        .map(|l| cut(&l, ITEM_MAX_CHARS))
        .collect()
}

/// The answer for the file's bytes (None: no file). `len` is the file's size on disk, so a file
/// over the limit is refused without reading it all.
pub(crate) fn checklist_from(bytes: Option<&[u8]>, len: u64) -> Checklist {
    let empty = |state: &'static str, reason: Option<&str>| Checklist { state, items: Vec::new(), reason: reason.map(str::to_string) };
    let Some(bytes) = bytes else { return empty("missing", None) };
    if len > CHECKLIST_MAX_BYTES || bytes.len() as u64 > CHECKLIST_MAX_BYTES {
        return empty("refused", Some(OVER_SIZE));
    }
    let Ok(text) = std::str::from_utf8(bytes) else { return empty("refused", Some(NOT_TEXT)) };
    // An editor may start the file with a byte order mark; it is not part of the first item.
    let text = text.strip_prefix('\u{FEFF}').unwrap_or(text);
    Checklist { state: "ok", items: parse_items(text), reason: None }
}

// Section: commands

fn check(label: &str) -> Result<(), String> {
    crate::wall2_meet::require_wall2(label)
}

fn config_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_config_dir().map_err(|_| "not-configured".to_string())
}

fn read_checklist(app: &tauri::AppHandle) -> Result<Checklist, String> {
    let path = config_dir(app)?.join(CHECKLIST_FILE);
    let file = match std::fs::File::open(&path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(checklist_from(None, 0)),
        Err(_) => return Err("failed".to_string()),
    };
    let len = file.metadata().map_err(|_| "failed".to_string())?.len();
    let mut bytes = Vec::new();
    if len <= CHECKLIST_MAX_BYTES {
        file.take(CHECKLIST_MAX_BYTES + 1).read_to_end(&mut bytes).map_err(|_| "failed".to_string())?;
    }
    Ok(checklist_from(Some(&bytes), len))
}

fn open_checklist(app: &tauri::AppHandle) -> Result<(), String> {
    let dir = config_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|_| "failed".to_string())?;
    let path = dir.join(CHECKLIST_FILE);
    write_new(&path, STARTER).map_err(|_| "failed".to_string())?;
    app.opener().open_path(path.to_string_lossy().to_string(), None::<&str>).map_err(|_| "failed".to_string())
}

/// The checklist, parsed: never the file's own text.
#[tauri::command]
pub async fn wall2_meet_checklist(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<Checklist, String> {
    check(window.label())?;
    tauri::async_runtime::spawn_blocking(move || read_checklist(&app)).await.map_err(|_| "failed".to_string())?
}

/// Opens `meet-checklist.txt`, written as a three-line starter first when there is none.
#[tauri::command]
pub async fn wall2_meet_checklist_open(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    check(window.label())?;
    tauri::async_runtime::spawn_blocking(move || open_checklist(&app)).await.map_err(|_| "failed".to_string())?
}

// Section: tests

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_typical_file() {
        let got = parse_items("# My list\n// note\n\nWho decides\n  What they measure today  \nNext step\n");
        assert_eq!(got, ["Who decides", "What they measure today", "Next step"]);
    }

    #[test]
    fn at_most_eight_items_of_eighty_characters() {
        let text: String = (0..12).map(|n| format!("Item {n}\n")).collect();
        let got = parse_items(&text);
        assert_eq!(got.len(), 8);
        assert_eq!(got[7], "Item 7");
        let long = "w".repeat(200);
        let cut_item = &parse_items(&long)[0];
        assert_eq!(cut_item.chars().count(), 80);
        assert!(cut_item.ends_with('\u{2026}'));
        let exact = "x".repeat(80);
        assert_eq!(parse_items(&exact)[0], exact);
    }

    #[test]
    fn comments_and_empty_lines_never_count_toward_the_eight() {
        let text = format!("{}A\n", "# c\n// d\n\n".repeat(10));
        assert_eq!(parse_items(&text), ["A"]);
    }

    #[test]
    fn control_and_direction_characters_are_dropped() {
        assert_eq!(parse_items("Ask\u{0}\u{7} about\u{202E} scope\n"), ["Ask about scope"]);
        assert_eq!(parse_items("A\tB\n"), ["A B"]);
        assert!(parse_items("\u{1}\u{2}\n").is_empty());
    }

    #[test]
    fn missing_refused_or_read() {
        assert_eq!(checklist_from(None, 0).state, "missing");
        let big = vec![b'a'; CHECKLIST_MAX_BYTES as usize + 1];
        let over = checklist_from(Some(&big), big.len() as u64);
        assert_eq!((over.state, over.reason.as_deref()), ("refused", Some("meet-checklist.txt is over 4 KB")));
        assert!(over.items.is_empty());
        // A file the size on disk says is too big is refused without its bytes.
        assert_eq!(checklist_from(Some(b""), 5_000).state, "refused");
        let exact = vec![b'a'; CHECKLIST_MAX_BYTES as usize];
        assert_eq!(checklist_from(Some(&exact), exact.len() as u64).state, "ok");
        let bad = checklist_from(Some(&[0x41, 0xff, 0xfe]), 3);
        assert_eq!((bad.state, bad.reason.as_deref()), ("refused", Some("meet-checklist.txt is not UTF-8 text")));
        let empty = checklist_from(Some(b""), 0);
        assert_eq!((empty.state, empty.items.len()), ("ok", 0));
    }

    #[test]
    fn a_byte_order_mark_is_not_part_of_the_first_item() {
        let with = checklist_from(Some("\u{FEFF}Who decides\nNext\n".as_bytes()), 20);
        assert_eq!(with.items, ["Who decides", "Next"]);
        let comment = checklist_from(Some("\u{FEFF}# note\nOne\n".as_bytes()), 20);
        assert_eq!(comment.items, ["One"]);
    }

    #[test]
    fn the_starter_is_three_lines_and_gives_two_items() {
        assert_eq!(STARTER.lines().count(), 3);
        assert_eq!(parse_items(STARTER).len(), 2);
    }

    #[test]
    fn the_answer_is_camel_case_and_carries_no_file_text_but_the_items() {
        let v = serde_json::to_value(checklist_from(Some(b"# c\nOne\n"), 8)).unwrap();
        assert_eq!(v, serde_json::json!({ "state": "ok", "items": ["One"], "reason": null }));
    }

    #[test]
    fn the_starter_never_overwrites_a_file() {
        let dir = std::env::temp_dir().join(format!("wall2-checklist-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(CHECKLIST_FILE);
        let _ = std::fs::remove_file(&path);
        assert!(write_new(&path, STARTER).unwrap());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), STARTER);
        std::fs::write(&path, "Mine\n").unwrap();
        assert!(!write_new(&path, STARTER).unwrap());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "Mine\n");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_the_wall_window_may_ask() {
        assert!(check("main").is_err());
        assert!(check("wall2").is_ok());
    }

    #[test]
    fn the_window_check_is_the_first_statement_of_every_command() {
        let src = include_str!("checklist.rs");
        for name in ["wall2_meet_checklist(", "wall2_meet_checklist_open("] {
            let at = src.find(&format!("pub async fn {name}")).expect("command");
            let body = &src[at..];
            let open = body.find('{').expect("body");
            let first = body[open + 1..].trim_start();
            assert!(first.starts_with("check(window.label())?;"), "{name} first statement: {}", &first[..first.len().min(60)]);
        }
    }
}
