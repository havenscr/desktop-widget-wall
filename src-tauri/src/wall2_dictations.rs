//! Wall 2 Shelf dictations: the newest dictations from Wispr Flow's own history on this PC.
//!
//! What the page can and cannot do:
//! - The page asks for a list and gets, per dictation, Flow's own entry id, the time (RFC 3339, UTC),
//!   the app it was dictated into, the cleaned text, the raw text (what was said, before the AI pass)
//!   and the word count. At most 30 come back, newest first.
//! - Rust opens `%APPDATA%\Wispr Flow\flow.sqlite` read only, through SQLite itself (never `immutable`,
//!   so rows still in Flow's write-ahead log are seen), with a one second busy wait.
//! - Only seven columns are named in a query: the entry id, the time, the app and the three text
//!   columns, plus the word count. Nothing else in the file is read: no recordings, no screenshots.
//! - `copy` takes only an id and which text; Rust re-reads that one row and puts its text on the
//!   clipboard. The page never sends text to copy.
//! - Archived entries and entries with no text at all are skipped. Each text is cut to 2000 characters.
//! - Nothing is logged: no text, no id, no path.
//!
//! Errors are fixed words: `not-installed` (no Wispr Flow folder), `no-history` (no file, or no
//! History table), `changed` (a column the wall needs is gone), `busy` (the file is locked),
//! `missing` (the id is not in the newest entries), `forbidden` (the wrong window), `failed`.
#![cfg_attr(not(windows), allow(dead_code))]

use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Dictations returned to the page.
const SHOWN: usize = 30;
const TEXT_CHARS: usize = 2000;
const APP_CHARS: usize = 40;

const NOT_INSTALLED: &str = "not-installed";
const NO_HISTORY: &str = "no-history";
const CHANGED: &str = "changed";
const BUSY: &str = "busy";
const MISSING: &str = "missing";
const FAILED: &str = "failed";

/// The columns the wall needs to exist. The query below names only some of them.
const NEEDED: [&str; 8] = ["transcriptEntityId", "timestamp", "app", "formattedText", "editedText", "asrText", "isArchived", "numWords"];

/// The newest 60 rows by row number (archived ones left out), of which at most 30 are kept. Not ordered by time: the table is large and has no index on it.
const LIST_SQL: &str = "SELECT transcriptEntityId, timestamp, app, editedText, formattedText, asrText, numWords \
    FROM History WHERE COALESCE(isArchived, 0) != 1 ORDER BY rowid DESC LIMIT 60";

/// One row by Flow's entry id, among the newest 200 rows only: a little more than the list shows, so a row the list showed is found.
const ONE_SQL: &str = "SELECT transcriptEntityId, timestamp, app, editedText, formattedText, asrText, numWords \
    FROM History WHERE rowid IN (SELECT rowid FROM History WHERE COALESCE(isArchived, 0) != 1 ORDER BY rowid DESC LIMIT 200) \
    AND transcriptEntityId = ?1 LIMIT 1";

/// One dictation as the page sees it.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Dictation {
    pub id: String,
    /// RFC 3339 in UTC, or None when the stored time cannot be read.
    pub at: Option<String>,
    pub app: String,
    pub clean: String,
    pub raw: String,
    pub words: i64,
}

// Section: cleaning

fn invisible(c: char) -> bool {
    c.is_control() || matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}')
}

/// Text for the page: control, direction and zero width characters dropped, line breaks kept as
/// `\n`, tabs as spaces, ends trimmed, at most `max` characters.
fn clean_body(raw: &str, max: usize) -> String {
    let unified = raw.replace("\r\n", "\n").replace('\r', "\n");
    let kept: String = unified
        .chars()
        .filter_map(|c| match c {
            '\n' => Some('\n'),
            '\t' => Some(' '),
            c if invisible(c) => None,
            c => Some(c),
        })
        .collect();
    kept.trim().chars().take(max).collect()
}

/// A short single line (an app name): invisible characters become spaces, runs of space collapse.
fn one_line(raw: &str, max: usize) -> String {
    let spaced: String = raw.chars().map(|c| if invisible(c) { ' ' } else { c }).collect();
    spaced.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(max).collect()
}

// Section: time

/// Days since 1970-01-01 for a civil date.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let mp = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The civil date for days since 1970-01-01.
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn digits(s: &str, at: usize, n: usize) -> Option<i64> {
    let part = s.get(at..at + n)?;
    if !part.bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    part.parse::<i64>().ok()
}

/// Epoch seconds for `2026-11-23 14:41:05`, `2026-11-23T14:41:05.123Z`, or either with a zone such
/// as `+00:00` or ` -08:00` after the seconds. A time with no zone is taken as UTC.
fn parse_stored(text: &str) -> Option<i64> {
    let s = text.trim();
    let b = s.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || !(b[10] == b'T' || b[10] == b' ') || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let (y, mo, d) = (digits(s, 0, 4)?, digits(s, 5, 2)?, digits(s, 8, 2)?);
    let (h, mi, sec) = (digits(s, 11, 2)?, digits(s, 14, 2)?, digits(s, 17, 2)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || sec > 60 {
        return None;
    }
    // After the seconds: an optional fraction, optional spaces, then Z, +hh[:mm] or -hh[:mm], or nothing.
    let mut rest = s.get(19..)?;
    if let Some(frac) = rest.strip_prefix('.') {
        rest = frac.trim_start_matches(|c: char| c.is_ascii_digit());
    }
    let rest = rest.trim();
    let offset_min = if rest.is_empty() || rest.eq_ignore_ascii_case("z") {
        0
    } else {
        let sign = match rest.as_bytes()[0] {
            b'+' => 1,
            b'-' => -1,
            _ => return None,
        };
        let zone = &rest[1..];
        let oh = digits(zone, 0, 2)?;
        let om = if zone.len() > 2 { digits(zone, if zone.as_bytes()[2] == b':' { 3 } else { 2 }, 2)? } else { 0 };
        sign * (oh * 60 + om)
    };
    Some(days_from_civil(y, mo, d) * 86_400 + h * 3600 + mi * 60 + sec.min(59) - offset_min * 60)
}

/// `2026-11-23T14:41:05Z` for epoch seconds.
fn rfc3339_utc(secs: i64) -> String {
    let (y, m, d) = civil_from_days(secs.div_euclid(86_400));
    let rem = secs.rem_euclid(86_400);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, (rem % 3600) / 60, rem % 60)
}

/// A stored time cell as RFC 3339: text in the usual shapes, or a whole number of seconds or milliseconds.
fn time_of(v: &SqlValue) -> Option<String> {
    let secs = match v {
        SqlValue::Text(t) => parse_stored(t)?,
        SqlValue::Integer(n) if *n > 100_000_000_000 => n / 1000,
        SqlValue::Integer(n) if *n > 0 => *n,
        _ => return None,
    };
    if !(0..=253_402_300_799).contains(&secs) {
        return None;
    }
    Some(rfc3339_utc(secs))
}

// Section: reading

/// Where Wispr Flow keeps its history, or why it is not there.
fn history_path() -> Result<PathBuf, &'static str> {
    let appdata = std::env::var_os("APPDATA").ok_or(NOT_INSTALLED)?;
    let dir = Path::new(&appdata).join("Wispr Flow");
    if !dir.is_dir() {
        return Err(NOT_INSTALLED);
    }
    let file = dir.join("flow.sqlite");
    if !file.is_file() {
        return Err(NO_HISTORY);
    }
    Ok(file)
}

fn word_of(e: &rusqlite::Error) -> &'static str {
    match e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::DatabaseBusy || f.code == rusqlite::ErrorCode::DatabaseLocked => BUSY,
        _ => FAILED,
    }
}

/// A text cell: text stays text, anything else (NULL, a number, a blob) is empty.
fn text_cell(v: SqlValue) -> String {
    match v {
        SqlValue::Text(t) => t,
        _ => String::new(),
    }
}

/// One row, mapped, or None when it is to be skipped (no text at all).
fn entry_of(cells: [SqlValue; 7]) -> Option<(Dictation, Option<String>)> {
    let [id, when, app, edited, formatted, asr, words] = cells;
    let id = text_cell(id);
    if id.is_empty() {
        return None;
    }
    let (edited, formatted, raw) = (clean_body(&text_cell(edited), TEXT_CHARS), clean_body(&text_cell(formatted), TEXT_CHARS), clean_body(&text_cell(asr), TEXT_CHARS));
    let mut clean = if edited.is_empty() { formatted } else { edited };
    if clean.is_empty() && raw.is_empty() {
        return None;
    }
    if clean.is_empty() {
        clean = raw.clone();
    }
    let at = time_of(&when);
    let words = match words {
        SqlValue::Integer(n) => n.max(0),
        _ => 0,
    };
    let dictation = Dictation { id: one_line(&id, 64), at: at.clone(), app: one_line(&text_cell(app), APP_CHARS), clean, raw, words };
    Some((dictation, at))
}

/// Opens the file read only and checks the table has every column the wall needs.
fn open_checked(path: &Path) -> Result<Connection, &'static str> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).map_err(|e| word_of(&e))?;
    conn.busy_timeout(Duration::from_millis(1000)).map_err(|e| word_of(&e))?;
    let mut stmt = conn.prepare("PRAGMA table_info(History)").map_err(|e| word_of(&e))?;
    let names = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(|e| word_of(&e))?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|e| word_of(&e))?;
    drop(stmt);
    if names.is_empty() {
        return Err(NO_HISTORY);
    }
    if NEEDED.iter().any(|n| !names.iter().any(|c| c == n)) {
        return Err(CHANGED);
    }
    Ok(conn)
}

fn cells_of(r: &rusqlite::Row) -> rusqlite::Result<[SqlValue; 7]> {
    Ok([r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?])
}

/// The newest dictations in the file, newest first.
fn read_list(path: &Path) -> Result<Vec<Dictation>, &'static str> {
    let conn = open_checked(path)?;
    let mut stmt = conn.prepare(LIST_SQL).map_err(|e| word_of(&e))?;
    let rows = stmt.query_map([], cells_of).map_err(|e| word_of(&e))?;
    let mut out: Vec<(Dictation, Option<String>)> = Vec::new();
    for row in rows {
        let cells = row.map_err(|e| word_of(&e))?;
        out.extend(entry_of(cells));
        if out.len() >= SHOWN {
            break;
        }
    }
    // Newest first by time; rows with no readable time keep their place at the end, in row order.
    out.sort_by(|a, b| b.1.cmp(&a.1));
    Ok(out.into_iter().map(|(d, _)| d).collect())
}

/// One dictation by Flow's entry id, among the newest rows.
fn read_one(path: &Path, id: &str) -> Result<Dictation, &'static str> {
    let conn = open_checked(path)?;
    let mut stmt = conn.prepare(ONE_SQL).map_err(|e| word_of(&e))?;
    let mut rows = stmt.query_map([id], cells_of).map_err(|e| word_of(&e))?;
    match rows.next() {
        Some(row) => entry_of(row.map_err(|e| word_of(&e))?).map(|(d, _)| d).ok_or(MISSING),
        None => Err(MISSING),
    }
}

/// Whether an id may be looked up: 1 to 64 of letters, digits and hyphens.
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn list_now() -> Result<Vec<Dictation>, String> {
    let path = history_path().map_err(str::to_string)?;
    read_list(&path).map_err(str::to_string)
}

fn copy_now(id: &str, which: &str) -> Result<(), String> {
    if !valid_id(id) || !(which == "clean" || which == "raw") {
        return Err(FAILED.to_string());
    }
    let path = history_path().map_err(str::to_string)?;
    let one = read_one(&path, id).map_err(str::to_string)?;
    let text = if which == "raw" { one.raw } else { one.clean };
    if text.is_empty() {
        return Err(FAILED.to_string());
    }
    crate::wall2_captures::copy_text(&text)
}

// Section: commands

/// The calling window first.
fn check(label: &str) -> Result<(), String> {
    crate::wall2_meet::require_wall2(label)
}

/// The newest dictations, newest first.
#[tauri::command]
pub async fn wall2_dictations(window: tauri::WebviewWindow) -> Result<Vec<Dictation>, String> {
    check(window.label())?;
    tauri::async_runtime::spawn_blocking(list_now).await.map_err(|_| FAILED.to_string())?
}

/// Put one dictation's cleaned or raw text on the clipboard, by Flow's entry id.
#[tauri::command]
pub async fn wall2_dictation_copy(window: tauri::WebviewWindow, id: String, which: String) -> Result<(), String> {
    check(window.label())?;
    tauri::async_runtime::spawn_blocking(move || copy_now(&id, &which)).await.map_err(|_| FAILED.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static N: AtomicU32 = AtomicU32::new(0);

    /// A temp file path that removes itself when dropped.
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Temp {
            let n = N.fetch_add(1, Ordering::SeqCst);
            Temp(std::env::temp_dir().join(format!("wall2-dictations-test-{}-{}.sqlite", std::process::id(), n)))
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    const FULL: &str = "CREATE TABLE History (transcriptEntityId TEXT, timestamp DATETIME, app TEXT, formattedText TEXT, editedText TEXT, asrText TEXT, \
        isArchived INTEGER, numWords INTEGER, builtInAudio BLOB)";

    #[allow(clippy::too_many_arguments)]
    fn add(c: &Connection, id: &str, ts: &str, app: &str, formatted: Option<&str>, edited: Option<&str>, asr: Option<&str>, archived: i64, words: i64) {
        c.execute(
            "INSERT INTO History VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, x'00ff00ff')",
            rusqlite::params![id, ts, app, formatted, edited, asr, archived, words],
        )
        .unwrap();
    }

    fn sample() -> Temp {
        let t = Temp::new();
        let c = Connection::open(&t.0).unwrap();
        c.execute(FULL, []).unwrap();
        add(&c, "a-1", "2026-11-23 09:00:00.250", "Notes", Some("Plain sample one."), None, Some("plain sample one"), 0, 3);
        add(&c, "a-2", "2026-11-23 09:05:00", "Mail", Some("Archived sample."), None, Some("archived sample"), 1, 2);
        add(&c, "a-3", "2026-11-23 09:10:00", "Mail", Some(""), Some(""), Some(""), 0, 0);
        add(&c, "a-4", "2026-11-23T09:15:00+02:00", "Editor", Some("Formatted four."), Some("Edited four."), Some("formatted four um"), 0, 3);
        add(&c, "a-5", "not a time", "Chat\u{202E}Box", None, None, Some("only said words"), 0, 3);
        t
    }

    #[test]
    fn maps_rows_and_skips_archived_and_empty() {
        let t = sample();
        let list = read_list(&t.0).unwrap();
        let ids: Vec<&str> = list.iter().map(|d| d.id.as_str()).collect();
        assert_eq!(ids, vec!["a-1", "a-4", "a-5"]);
        assert_eq!(list[0].clean, "Plain sample one.");
        assert_eq!(list[0].raw, "plain sample one");
        assert_eq!(list[0].words, 3);
        assert_eq!(list[0].at.as_deref(), Some("2026-11-23T09:00:00Z"));
        assert_eq!(list[0].app, "Notes");
    }

    #[test]
    fn an_edit_wins_and_a_zone_is_applied() {
        let t = sample();
        let list = read_list(&t.0).unwrap();
        assert_eq!(list[1].clean, "Edited four.");
        assert_eq!(list[1].raw, "formatted four um");
        assert_eq!(list[1].at.as_deref(), Some("2026-11-23T07:15:00Z"));
    }

    #[test]
    fn raw_only_rows_show_and_a_bad_time_is_null() {
        let t = sample();
        let list = read_list(&t.0).unwrap();
        assert_eq!(list[2].clean, "only said words");
        assert_eq!(list[2].at, None);
        assert_eq!(list[2].app, "Chat Box");
    }

    #[test]
    fn newest_row_numbers_only_and_at_most_thirty() {
        let t = Temp::new();
        let c = Connection::open(&t.0).unwrap();
        c.execute(FULL, []).unwrap();
        for i in 0..100 {
            add(&c, &format!("r-{i}"), "2026-11-23 10:00:00", "Notes", Some(format!("Text {i}").as_str()), None, Some("x"), 0, 1);
        }
        let list = read_list(&t.0).unwrap();
        assert_eq!(list.len(), SHOWN);
        assert!(list.iter().all(|d| d.clean.trim_start_matches("Text ").parse::<i32>().unwrap() >= 40));
    }

    #[test]
    fn a_missing_column_answers_changed() {
        let t = Temp::new();
        let c = Connection::open(&t.0).unwrap();
        c.execute("CREATE TABLE History (transcriptEntityId TEXT, timestamp DATETIME, app TEXT, formattedText TEXT, editedText TEXT, isArchived INTEGER, numWords INTEGER)", []).unwrap();
        assert_eq!(read_list(&t.0).unwrap_err(), CHANGED);
        assert_eq!(read_one(&t.0, "a-1").unwrap_err(), CHANGED);
    }

    #[test]
    fn no_table_answers_no_history() {
        let t = Temp::new();
        let c = Connection::open(&t.0).unwrap();
        c.execute("CREATE TABLE Other (x TEXT)", []).unwrap();
        assert_eq!(read_list(&t.0).unwrap_err(), NO_HISTORY);
    }

    #[test]
    fn one_row_by_id_and_a_parameter_is_never_text_in_the_query() {
        let t = sample();
        assert_eq!(read_one(&t.0, "a-4").unwrap().clean, "Edited four.");
        assert_eq!(read_one(&t.0, "a-2").unwrap_err(), MISSING);
        assert_eq!(read_one(&t.0, "a-3").unwrap_err(), MISSING);
        assert_eq!(read_one(&t.0, "x' OR '1'='1").unwrap_err(), MISSING);
    }

    #[test]
    fn ids_are_checked() {
        assert!(valid_id("0f3a-9C"));
        assert!(valid_id(&"a".repeat(64)));
        assert!(!valid_id(&"a".repeat(65)));
        assert!(!valid_id(""));
        assert!(!valid_id("a b"));
        assert!(!valid_id("a'b"));
        assert!(!valid_id("a_b"));
        assert_eq!(copy_now("bad id", "clean").unwrap_err(), FAILED);
        assert_eq!(copy_now("ok-id", "other").unwrap_err(), FAILED);
    }

    #[test]
    fn text_is_cut_by_characters_and_stripped() {
        let long = "\u{e9}".repeat(2500);
        assert_eq!(clean_body(&long, TEXT_CHARS).chars().count(), 2000);
        assert_eq!(clean_body("  a\u{202E}b\u{200B}c\u{7}\r\nnext\tline  ", 50), "abc\nnext line");
        assert_eq!(one_line("  Two   words\u{202A} ", 40), "Two words");
        assert_eq!(one_line(&"\u{1F600}".repeat(60), 40).chars().count(), 40);
    }

    #[test]
    fn times_read_in_the_usual_shapes() {
        assert_eq!(parse_stored("2026-11-23 14:41:05").map(rfc3339_utc).as_deref(), Some("2026-11-23T14:41:05Z"));
        assert_eq!(parse_stored("2026-11-23T14:41:05.123Z").map(rfc3339_utc).as_deref(), Some("2026-11-23T14:41:05Z"));
        assert_eq!(parse_stored("2026-11-23 14:41:05.5 -08:00").map(rfc3339_utc).as_deref(), Some("2026-11-23T22:41:05Z"));
        assert_eq!(parse_stored("2026-11-23 14:41:05+0530").map(rfc3339_utc).as_deref(), Some("2026-11-23T09:11:05Z"));
        assert_eq!(parse_stored("yesterday"), None);
        assert_eq!(parse_stored("2026-13-23 14:41:05"), None);
        assert_eq!(parse_stored("2026-11-23 14:41:05 junk"), None);
        assert_eq!(time_of(&SqlValue::Integer(1_700_000_000_000)).as_deref(), Some("2023-11-14T22:13:20Z"));
        assert_eq!(time_of(&SqlValue::Null), None);
    }

    #[test]
    fn the_queries_name_only_the_text_columns() {
        for sql in [LIST_SQL, ONE_SQL] {
            let low = sql.to_lowercase();
            for banned in ["audio", "screenshot", "select *"] {
                assert!(!low.contains(banned), "{banned}");
            }
        }
    }

    #[test]
    fn a_sql_text_cell_of_another_kind_is_empty() {
        assert_eq!(text_cell(SqlValue::Blob(vec![1, 2])), "");
        assert_eq!(text_cell(SqlValue::Integer(4)), "");
        assert_eq!(text_cell(SqlValue::Text("ok".into())), "ok");
    }

    #[test]
    fn only_the_wall_window_may_ask() {
        assert!(check("main").is_err());
        assert!(check("wall2").is_ok());
    }

    #[test]
    fn the_window_check_is_the_first_statement_of_every_command() {
        let src = include_str!("wall2_dictations.rs").replace("\r\n", "\n");
        for name in ["wall2_dictations", "wall2_dictation_copy"] {
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
        let src = include_str!("wall2_dictations.rs").replace("\r\n", "\n");
        let macros = ["print", "eprint", "dbg", "log", "info", "warn", "debug"];
        for m in macros {
            assert!(!src.contains(&format!("{m}!(")), "{m}");
        }
    }
}
