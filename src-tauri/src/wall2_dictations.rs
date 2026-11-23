//! Wall 2 Shelf dictations: the newest dictations from Wispr Flow's own history on this PC.
//!
//! What the page can and cannot do:
//! - The page asks for a list and gets, per dictation, Flow's own entry id, the time (RFC 3339, UTC),
//!   the app it was dictated into, the cleaned text, the raw text (what was said, before the AI pass)
//!   and the word count, and whether Flow kept any raw text. At most 30 come back, newest first by time.
//! - Rust opens `%APPDATA%\Wispr Flow\flow.sqlite` read only, through SQLite itself (never `immutable`,
//!   so rows still in Flow's write-ahead log are seen), with a one second busy wait. The wall never changes
//!   Flow's history. While reading a write-ahead database, SQLite may create or touch the shared-memory
//!   file `flow.sqlite-shm` beside it, as any reader does.
//! - Only seven columns are named in a query: the entry id, the time, the app and the three text
//!   columns, plus the word count. Nothing else in the file is read: no recordings, no screenshots.
//! - `copy` takes only an id and which text; Rust re-reads that one row and puts its text on the
//!   clipboard. The page never sends text to copy.
//! - The newest 200 rows by row number are read (archived ones left out), sorted by time, and 30 kept.
//!   Entries with no text at all, or an id outside letters, digits, `_` and `-` (1 to 64), are skipped, and
//!   an id seen twice keeps its newest row. In the list each text is cut to 2000 characters; a copy takes
//!   the whole text (only a 200,000 character safety cap).
//! - Nothing is logged: no text, no id, no path.
//!
//! Errors are fixed words: `not-installed` (no Wispr Flow folder), `no-history` (no file, or no
//! History table), `changed` (a column the wall needs is gone), `busy` (the file is locked),
//! `missing` (the id is not in the newest entries), `forbidden` (the wrong window), `failed`. A file SQLite
//! cannot open, or may not read right now (cannot open, permission, read only), answers `busy`, so the page
//! offers Try again.
#![cfg_attr(not(windows), allow(dead_code))]

use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Dictations returned to the page.
const SHOWN: usize = 30;
/// Rows read from the newest end of the table before sorting by time.
const WINDOW: usize = 200;
/// Characters of each text in the list.
const TEXT_CHARS: usize = 2000;
/// Characters of a text that is copied: only a safety cap.
const COPY_CHARS: usize = 200_000;
const APP_CHARS: usize = 40;

const NOT_INSTALLED: &str = "not-installed";
const NO_HISTORY: &str = "no-history";
const CHANGED: &str = "changed";
const BUSY: &str = "busy";
const MISSING: &str = "missing";
const FAILED: &str = "failed";

/// The columns the wall needs to exist. The query below names only some of them.
const NEEDED: [&str; 8] = ["transcriptEntityId", "timestamp", "app", "formattedText", "editedText", "asrText", "isArchived", "numWords"];

/// The newest 200 rows by row number (archived ones left out); the caller sorts them by time and keeps 30. A row Flow rewrote has a new row number, so row order alone is not time order.
const LIST_SQL: &str = "SELECT transcriptEntityId, timestamp, app, editedText, formattedText, asrText, numWords \
    FROM History WHERE COALESCE(isArchived, 0) != 1 ORDER BY rowid DESC LIMIT 200";

/// One row by Flow's entry id, among the same newest 200 rows the list reads, so a row the list showed is found. The newest row wins when an id repeats.
const ONE_SQL: &str = "SELECT transcriptEntityId, timestamp, app, editedText, formattedText, asrText, numWords \
    FROM History WHERE rowid IN (SELECT rowid FROM History WHERE COALESCE(isArchived, 0) != 1 ORDER BY rowid DESC LIMIT 200) \
    AND transcriptEntityId = ?1 ORDER BY rowid DESC LIMIT 1";

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
    /// False when Flow kept no raw text for this one (the page disables Raw).
    pub has_raw: bool,
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

fn days_in_month(y: i64, m: i64) -> i64 {
    match m {
        2 if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
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
    if !(1..=12).contains(&mo) || !(1..=days_in_month(y, mo)).contains(&d) || h > 23 || mi > 59 || sec > 59 {
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
        let zone = rest.get(1..)?;
        let oh = digits(zone, 0, 2)?;
        let om = match zone.len() {
            2 => 0,
            4 => digits(zone, 2, 2)?,
            5 if zone.as_bytes()[2] == b':' => digits(zone, 3, 2)?,
            _ => return None,
        };
        if om > 59 || oh * 60 + om > 14 * 60 {
            return None;
        }
        sign * (oh * 60 + om)
    };
    Some(days_from_civil(y, mo, d) * 86_400 + h * 3600 + mi * 60 + sec - offset_min * 60)
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

/// The word for a SQLite result code. Busy, locked, cannot open, permission and read only are all
/// "not right now" (Flow holds the file, or the shared-memory file cannot be made yet): the page retries.
fn word_of_code(code: rusqlite::ErrorCode) -> &'static str {
    use rusqlite::ErrorCode as C;
    match code {
        C::DatabaseBusy | C::DatabaseLocked | C::CannotOpen | C::PermissionDenied | C::ReadOnly => BUSY,
        _ => FAILED,
    }
}

fn word_of(e: &rusqlite::Error) -> &'static str {
    match e {
        rusqlite::Error::SqliteFailure(f, _) => word_of_code(f.code),
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

/// One row, mapped with each text cut to `cap` characters, or None when it is to be skipped (no text
/// at all, or an id that cannot be looked up again).
fn entry_of(cells: [SqlValue; 7], cap: usize) -> Option<(Dictation, Option<String>)> {
    let [id, when, app, edited, formatted, asr, words] = cells;
    let id = text_cell(id);
    if !valid_id(&id) {
        return None;
    }
    let (edited, formatted, raw) = (clean_body(&text_cell(edited), cap), clean_body(&text_cell(formatted), cap), clean_body(&text_cell(asr), cap));
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
    let has_raw = !raw.is_empty();
    let dictation = Dictation { id, at: at.clone(), app: one_line(&text_cell(app), APP_CHARS), clean, raw, has_raw, words };
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
    let mut seen: HashSet<String> = HashSet::new();
    for row in rows {
        let cells = row.map_err(|e| word_of(&e))?;
        if let Some((d, at)) = entry_of(cells, TEXT_CHARS) {
            // The newest row number wins when an id repeats, as in the copy lookup.
            if seen.insert(d.id.clone()) {
                out.push((d, at));
            }
        }
    }
    // Newest first by time; rows with no readable time go last, in row order (the sort is stable).
    out.sort_by(|a, b| b.1.cmp(&a.1));
    out.truncate(SHOWN);
    Ok(out.into_iter().map(|(d, _)| d).collect())
}

/// One dictation by Flow's entry id, among the newest rows, with its whole text.
fn read_one(path: &Path, id: &str) -> Result<Dictation, &'static str> {
    let conn = open_checked(path)?;
    let mut stmt = conn.prepare(ONE_SQL).map_err(|e| word_of(&e))?;
    let mut rows = stmt.query_map([id], cells_of).map_err(|e| word_of(&e))?;
    match rows.next() {
        Some(row) => entry_of(row.map_err(|e| word_of(&e))?, COPY_CHARS).map(|(d, _)| d).ok_or(MISSING),
        None => Err(MISSING),
    }
}

/// Whether an id may be listed and looked up: 1 to 64 of letters, digits, `_` and `-`.
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
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
    fn the_window_is_the_newest_200_rows_then_time_decides_the_thirty() {
        assert!(LIST_SQL.ends_with(&format!("LIMIT {WINDOW}")));
        assert!(ONE_SQL.contains(&format!("LIMIT {WINDOW})")));
        let t = Temp::new();
        let c = Connection::open(&t.0).unwrap();
        c.execute(FULL, []).unwrap();
        // 250 rows. Row number i has time minute i, except row 100 (old row number), rewritten with the newest time.
        for i in 0..250 {
            let ts = if i == 100 { "2026-11-23 23:00:00".to_string() } else { format!("2026-11-23 {:02}:{:02}:00", i / 60, i % 60) };
            add(&c, &format!("r-{i}"), &ts, "Notes", Some(format!("Text {i}").as_str()), None, Some("x"), 0, 1);
        }
        let list = read_list(&t.0).unwrap();
        assert_eq!(list.len(), SHOWN);
        // Rows 0..50 are outside the 200 newest row numbers and never appear.
        assert!(list.iter().all(|d| d.id != "r-0" && d.id != "r-49"));
        // The row with an older row number (100) but the newest time is kept, and first.
        assert_eq!(list[0].id, "r-100");
        // Row 100 is inside the window (rows 50..250). The rest are the newest by time: 249 down.
        assert_eq!(list[1].id, "r-249");
        assert_eq!(list[SHOWN - 1].id, format!("r-{}", 249 - (SHOWN - 2)));
        // Only the window's rows can be looked up.
        assert!(read_one(&t.0, "r-50").is_ok());
        assert_eq!(read_one(&t.0, "r-49").unwrap_err(), MISSING);
    }

    #[test]
    fn a_whole_long_text_copies_while_the_list_is_cut() {
        let t = Temp::new();
        let c = Connection::open(&t.0).unwrap();
        c.execute(FULL, []).unwrap();
        let long = "word ".repeat(1000);
        add(&c, "long-1", "2026-11-23 09:00:00", "Notes", Some(long.as_str()), None, Some(long.as_str()), 0, 1000);
        let listed = read_list(&t.0).unwrap();
        assert_eq!(listed[0].clean.chars().count(), TEXT_CHARS);
        assert_eq!(listed[0].raw.chars().count(), TEXT_CHARS);
        let one = read_one(&t.0, "long-1").unwrap();
        assert_eq!(one.clean, long.trim());
        assert_eq!(one.raw, long.trim());
        assert_eq!(one.clean.chars().count(), 4999);
    }

    #[test]
    fn ids_must_be_lookup_safe_and_repeats_keep_the_newest_row() {
        let t = Temp::new();
        let c = Connection::open(&t.0).unwrap();
        c.execute(FULL, []).unwrap();
        add(&c, "good_id-1", "2026-11-23 09:00:00", "Notes", Some("kept"), None, None, 0, 1);
        add(&c, "bad id", "2026-11-23 09:01:00", "Notes", Some("space"), None, None, 0, 1);
        add(&c, "bad.id", "2026-11-23 09:02:00", "Notes", Some("dot"), None, None, 0, 1);
        add(&c, &"a".repeat(65), "2026-11-23 09:03:00", "Notes", Some("long id"), None, None, 0, 1);
        add(&c, "dup", "2026-11-23 09:04:00", "Notes", Some("old dup"), None, None, 0, 1);
        add(&c, "dup", "2026-11-23 09:05:00", "Notes", Some("new dup"), None, None, 0, 1);
        let list = read_list(&t.0).unwrap();
        let ids: Vec<&str> = list.iter().map(|d| d.id.as_str()).collect();
        assert_eq!(ids, vec!["dup", "good_id-1"]);
        assert_eq!(list[0].clean, "new dup");
        // Every listed id finds the same row again.
        for d in &list {
            assert_eq!(read_one(&t.0, &d.id).unwrap().clean, d.clean);
        }
    }

    #[test]
    fn no_raw_text_means_no_raw_flag() {
        let t = Temp::new();
        let c = Connection::open(&t.0).unwrap();
        c.execute(FULL, []).unwrap();
        add(&c, "n-1", "2026-11-23 09:00:00", "Notes", Some("Clean only."), None, Some(""), 0, 2);
        add(&c, "n-2", "2026-11-23 08:00:00", "Notes", Some("Clean too."), None, None, 0, 2);
        add(&c, "n-3", "2026-11-23 07:00:00", "Notes", Some("Has raw."), None, Some("has raw"), 0, 2);
        let list = read_list(&t.0).unwrap();
        assert_eq!(list.iter().map(|d| d.has_raw).collect::<Vec<_>>(), vec![false, false, true]);
        assert!(!read_one(&t.0, "n-1").unwrap().has_raw);
        assert!(read_one(&t.0, "n-3").unwrap().has_raw);
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
        assert!(valid_id("a_b-9"));
        assert!(!valid_id("a.b"));
        assert!(!valid_id("a\u{e9}"));
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
    fn impossible_dates_and_zones_are_rejected() {
        for bad in [
            "2026-02-30 10:00:00",
            "2026-02-29 10:00:00",
            "1900-02-29 10:00:00",
            "2026-04-31 10:00:00",
            "2026-00-10 10:00:00",
            "2026-13-10 10:00:00",
            "2026-11-00 10:00:00",
            "2026-11-23 24:00:00",
            "2026-11-23 10:60:00",
            "2026-11-23 10:00:60",
            "2026-11-23 10:00:00+14:01",
            "2026-11-23 10:00:00+15:00",
            "2026-11-23 10:00:00-23:00",
            "2026-11-23 10:00:00+05:60",
            "2026-11-23 10:00:00+0560",
            "2026-11-23 10:00:00+053",
        ] {
            assert_eq!(parse_stored(bad), None, "{bad}");
        }
        for good in ["2028-02-29 10:00:00", "2000-02-29 10:00:00", "2026-11-23 10:00:59", "2026-11-23 10:00:00+14:00", "2026-11-23 10:00:00-12:00", "2026-11-23 10:00:00+05"] {
            assert!(parse_stored(good).is_some(), "{good}");
        }
        assert_eq!(parse_stored("2028-02-29 10:00:00").map(rfc3339_utc).as_deref(), Some("2028-02-29T10:00:00Z"));
    }

    #[test]
    fn a_row_with_an_impossible_time_has_no_time_and_sorts_last() {
        let t = Temp::new();
        let c = Connection::open(&t.0).unwrap();
        c.execute(FULL, []).unwrap();
        add(&c, "t-1", "2026-02-30 10:00:00", "Notes", Some("Bad day."), None, None, 0, 2);
        add(&c, "t-2", "2026-11-23 09:00:00", "Notes", Some("Fine."), None, None, 0, 1);
        add(&c, "t-3", "2026-11-23 09:00:00+16:00", "Notes", Some("Bad zone."), None, None, 0, 2);
        let list = read_list(&t.0).unwrap();
        let ids: Vec<&str> = list.iter().map(|d| d.id.as_str()).collect();
        assert_eq!(ids, vec!["t-2", "t-3", "t-1"]);
        assert_eq!(list[1].at, None);
        assert_eq!(list[2].at, None);
    }

    #[test]
    fn locked_and_unopenable_files_ask_for_a_retry() {
        use rusqlite::ffi;
        for code in [ffi::SQLITE_BUSY, ffi::SQLITE_LOCKED, ffi::SQLITE_CANTOPEN, ffi::SQLITE_PERM, ffi::SQLITE_READONLY] {
            let e = rusqlite::Error::SqliteFailure(ffi::Error::new(code), None);
            assert_eq!(word_of(&e), BUSY, "{code}");
        }
        let corrupt = rusqlite::Error::SqliteFailure(ffi::Error::new(ffi::SQLITE_CORRUPT), None);
        assert_eq!(word_of(&corrupt), FAILED);
        assert_eq!(word_of(&rusqlite::Error::InvalidQuery), FAILED);
    }

    #[test]
    fn the_queries_name_exactly_the_text_columns() {
        for sql in [LIST_SQL, ONE_SQL] {
            let from = sql.find(" FROM ").expect("from");
            let cols: Vec<&str> = sql["SELECT ".len()..from].split(',').map(str::trim).collect();
            assert!(sql.starts_with("SELECT "));
            assert_eq!(cols, vec!["transcriptEntityId", "timestamp", "app", "editedText", "formattedText", "asrText", "numWords"]);
            // The inner window query names only the row number and the archived flag.
            assert!(!sql.contains('*'));
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
        // Needles are built here, so this test's own text never matches.
        let macros = ["print", "println", "eprint", "eprintln", "dbg", "log", "trace", "debug", "info", "warn", "error"];
        for m in macros {
            for gap in ["", " "] {
                let needle = format!("{m}!{gap}(");
                assert!(!src.contains(&needle), "{m}");
            }
        }
        assert!(!src.contains(&format!("{}::", "log")), "log crate path");
        assert!(!src.contains(&format!("{}::", "tracing")), "tracing crate path");
    }
}
