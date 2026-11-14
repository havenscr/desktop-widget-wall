//! Wall 2's On Air place: the run of show and the marks file.
//!
//! Two files with fixed names in the app config folder (the folder `feeds.json` lives in):
//! `run-of-show.txt`, read and parsed here so the page never sees raw file text, and
//! `marks.txt`, one appended line per "Mark a moment". A path is never taken from the page.
//! Only the `wall2` window may ask, the file work runs off the thread that serves the web view,
//! nothing is logged, and errors are three fixed words: `not-configured` (no config folder on
//! this PC), `failed` (a read, a write or the opener failed) and `refused` (an argument or a
//! file past its limit). The parser, the mark line and every limit are pure functions below.

use serde::Serialize;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;

// Section: limits

pub(crate) const SHOW_FILE: &str = "run-of-show.txt";
pub(crate) const MARKS_FILE: &str = "marks.txt";
/// The run-of-show file is refused past this size.
pub(crate) const SHOW_MAX_BYTES: u64 = 32 * 1024;
const TITLE_MAX: usize = 60;
const NAME_MAX: usize = 60;
const NOTE_MAX: usize = 160;
const NOTES_MAX: usize = 12;
const PARTS_MAX: usize = 40;
const MINUTES_MIN: u32 = 1;
const MINUTES_MAX: u32 = 240;
/// The marks file stops taking lines past this size.
pub(crate) const MARKS_MAX_BYTES: u64 = 1024 * 1024;
/// How much of the end of the marks file is read to count today's marks.
const MARKS_TAIL_BYTES: u64 = 64 * 1024;
/// A mark's show time is at most a day.
const SHOW_MS_MAX: u64 = 24 * 60 * 60 * 1000;
/// A mark's part name is at most this many characters.
const MARK_PART_MAX: usize = 60;
/// A second mark this soon after the last one is ignored.
const MARK_QUIET_MS: u64 = 1000;
/// How many of today's show times a mark answer carries (the most recent).
const LAST_SHOWN: usize = 3;

const OVER_SIZE: &str = "run-of-show.txt is over 32 KB";
const NOT_TEXT: &str = "run-of-show.txt is not UTF-8 text";

/// Written by Open file when there is no run of show yet (never over an existing file).
pub(crate) const STARTER: &str = "# My show\n\
// One part per ## line: its name, then | and its planned minutes.\n\
// Lines under a part are its notes. Lines starting // are comments.\n\
\n\
## Welcome | 5\n\
- Say hello and what today is about\n\
\n\
## Main topic | 20\n\
- The one thing to show today\n\
\n\
## Questions | 10\n\
- Take questions from the chat\n";

// Section: the run of show (pure)

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Part {
    pub name: String,
    pub minutes: Option<u16>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Show {
    /// `ok`, `missing` or `refused`.
    pub state: &'static str,
    pub title: Option<String>,
    pub parts: Vec<Part>,
    /// Lines that were not used: before the first part, past a limit, or empty after cleaning.
    pub skipped: u32,
    /// Why a file was refused, one fixed line.
    pub reason: Option<String>,
    /// Epoch milliseconds of the read.
    pub read_at: u64,
}

/// True for a character that never reaches a file line or the page: every control character, the
/// line and paragraph separators, and the invisible direction marks and overrides.
fn is_dropped(c: char) -> bool {
    c.is_control()
        || matches!(c, '\u{2028}' | '\u{2029}' | '\u{200E}' | '\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}')
}

/// A tab becomes a space; every other dropped character (see `is_dropped`) is removed; the ends are trimmed.
pub(crate) fn clean(s: &str) -> String {
    s.chars()
        .filter_map(|c| if c == '\t' { Some(' ') } else if is_dropped(c) { None } else { Some(c) })
        .collect::<String>()
        .trim()
        .to_string()
}

/// At most `max` characters; a longer text keeps `max - 1` and ends with an ellipsis.
pub(crate) fn cut(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let kept: String = s.chars().take(max.saturating_sub(1)).collect();
    format!("{}\u{2026}", kept.trim_end())
}

/// The text after `## `: a name, then optionally `| minutes`. None when the name is empty.
pub(crate) fn part_line(rest: &str) -> Option<(String, Option<u16>)> {
    let (name, minutes) = match rest.rfind('|') {
        Some(at) => {
            let tail = clean(&rest[at + 1..]);
            match tail.parse::<u32>() {
                Ok(m) => (&rest[..at], if (MINUTES_MIN..=MINUTES_MAX).contains(&m) { Some(m as u16) } else { None }),
                // Not a number: the bar belongs to the name.
                Err(_) if !tail.is_empty() => (rest, None),
                Err(_) => (&rest[..at], None),
            }
        }
        None => (rest, None),
    };
    let name = clean(name);
    if name.is_empty() {
        None
    } else {
        Some((cut(&name, NAME_MAX), minutes))
    }
}

/// Parses the text of `run-of-show.txt` (already known to be UTF-8 and within its size).
pub(crate) fn parse_show(text: &str) -> (Option<String>, Vec<Part>, u32) {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut title = None;
    let mut parts: Vec<Part> = Vec::new();
    let mut skipped = 0u32;
    let mut seen_content = false;
    // True after a part past the limit: its notes are skipped too.
    let mut dropping = false;
    for raw in text.split('\n') {
        let line = raw.trim();
        if line.is_empty() || line.starts_with("//") {
            continue;
        }
        let first = !seen_content;
        seen_content = true;
        if let Some(rest) = line.strip_prefix("##") {
            match part_line(rest) {
                Some((name, minutes)) if parts.len() < PARTS_MAX => {
                    parts.push(Part { name, minutes, notes: Vec::new() });
                    dropping = false;
                }
                Some(_) => {
                    skipped += 1;
                    dropping = true;
                }
                None => skipped += 1,
            }
            continue;
        }
        if first && line.starts_with('#') {
            let t = clean(&line[1..]);
            if t.is_empty() {
                skipped += 1;
            } else {
                title = Some(cut(&t, TITLE_MAX));
            }
            continue;
        }
        let Some(part) = parts.last_mut() else {
            skipped += 1;
            continue;
        };
        if dropping || part.notes.len() >= NOTES_MAX {
            skipped += 1;
            continue;
        }
        let note = clean(line.strip_prefix('-').unwrap_or(line));
        if note.is_empty() {
            skipped += 1;
        } else {
            part.notes.push(cut(&note, NOTE_MAX));
        }
    }
    (title, parts, skipped)
}

/// The answer for the file's bytes (None: no file). `len` is the file's size on disk, so a file
/// over the limit is refused without reading it all.
pub(crate) fn show_from(bytes: Option<&[u8]>, len: u64, read_at: u64) -> Show {
    let empty = |state: &'static str, reason: Option<&str>| Show { state, title: None, parts: Vec::new(), skipped: 0, reason: reason.map(str::to_string), read_at };
    let Some(bytes) = bytes else { return empty("missing", None) };
    if len > SHOW_MAX_BYTES || bytes.len() as u64 > SHOW_MAX_BYTES {
        return empty("refused", Some(OVER_SIZE));
    }
    let Ok(text) = std::str::from_utf8(bytes) else { return empty("refused", Some(NOT_TEXT)) };
    let (title, parts, skipped) = parse_show(text);
    Show { state: "ok", title, parts, skipped, reason: None, read_at }
}

// Section: marks (pure)

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MarkResult {
    /// Marks dated today (local time) in the end of the file that was read.
    pub today: u32,
    /// The show times of today's last marks, oldest first, at most three.
    pub last: Vec<String>,
}

/// Refuses a show time past a day and a part name past 60 characters.
pub(crate) fn check_mark(show_ms: u64, part: Option<&str>) -> Result<(), &'static str> {
    if show_ms > SHOW_MS_MAX {
        return Err("refused");
    }
    if part.is_some_and(|p| p.chars().count() > MARK_PART_MAX) {
        return Err("refused");
    }
    Ok(())
}

/// `hh:mm:ss` of a show time.
pub(crate) fn show_time(show_ms: u64) -> String {
    let s = show_ms / 1000;
    format!("{:02}:{:02}:{:02}", s / 3600, (s / 60) % 60, s % 60)
}

/// The local date `YYYY-MM-DD` of an instant, given the zone's offset there.
pub(crate) fn local_date(utc: i64, offset: i64) -> String {
    let (y, m, d) = crate::wall2_meet::civil_from_days((utc + offset).div_euclid(86_400));
    format!("{y:04}-{m:02}-{d:02}")
}

/// RFC 3339 local time with its offset, to the second: `2026-11-13T21:05:09-08:00`.
pub(crate) fn rfc3339_local(utc: i64, offset: i64) -> String {
    let rem = (utc + offset).rem_euclid(86_400);
    let sign = if offset < 0 { '-' } else { '+' };
    let off = offset.unsigned_abs() / 60;
    format!("{}T{:02}:{:02}:{:02}{}{:02}:{:02}", local_date(utc, offset), rem / 3600, (rem / 60) % 60, rem % 60, sign, off / 60, off % 60)
}

/// One line of `marks.txt`: local time, show time and part name, tab separated, newline ended.
/// The part name loses tabs, line ends and every other control character; none (or nothing left) is `-`.
pub(crate) fn mark_line(utc: i64, offset: i64, show_ms: u64, part: Option<&str>) -> String {
    let part = part.map(clean).filter(|p| !p.is_empty()).unwrap_or_else(|| "-".to_string());
    format!("{}\t{}\t{}\n", rfc3339_local(utc, offset), show_time(show_ms), part)
}

/// The bytes of one appended write: the line, led by a newline when the file is not empty and its
/// last byte is not one (a file saved by hand without a final newline), so a mark never joins the
/// last line. A file ending in `\r\n` already ends in a newline byte.
pub(crate) fn append_bytes(last_byte: Option<u8>, line: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(line.len() + 1);
    if last_byte.is_some_and(|b| b != b'\n') {
        out.push(b'\n');
    }
    out.extend_from_slice(line.as_bytes());
    out
}

/// True when a line of this length still fits under the marks file's limit.
pub(crate) fn fits(file_len: u64, line_len: usize) -> bool {
    file_len + line_len as u64 <= MARKS_MAX_BYTES
}

/// True when a mark at `now_ms` comes too soon after the last one written.
pub(crate) fn too_soon(last_ms: Option<u64>, now_ms: u64) -> bool {
    last_ms.is_some_and(|l| now_ms >= l && now_ms - l < MARK_QUIET_MS)
}

/// Today's marks in the end of the file. `partial_first` drops the first line (the read began
/// inside it). `today` is the local date `YYYY-MM-DD`.
pub(crate) fn marks_today(tail: &str, partial_first: bool, today: &str) -> MarkResult {
    let mut times: Vec<&str> = Vec::new();
    for (i, line) in tail.split('\n').enumerate() {
        if i == 0 && partial_first {
            continue;
        }
        let mut fields = line.trim_end_matches('\r').split('\t');
        let (Some(when), Some(show)) = (fields.next(), fields.next()) else { continue };
        if when.len() >= 10 && when.get(..10) == Some(today) && when.as_bytes().get(10) == Some(&b'T') {
            times.push(show);
        }
    }
    let from = times.len().saturating_sub(LAST_SHOWN);
    MarkResult { today: times.len() as u32, last: times[from..].iter().map(|s| short_show_time(s)).collect() }
}

/// A show time as the tile shows it: `mm:ss` under an hour, `h:mm:ss` from an hour.
pub(crate) fn short_show_time(hms: &str) -> String {
    let clean: String = hms.chars().filter(|c| c.is_ascii_digit() || *c == ':').take(12).collect();
    match clean.strip_prefix("00:") {
        Some(rest) => rest.to_string(),
        None => clean.trim_start_matches('0').to_string(),
    }
}

/// Which fixed file `wall2_onair_open` may open.
pub(crate) fn which_file(which: &str) -> Option<&'static str> {
    match which {
        "show" => Some(SHOW_FILE),
        "marks" => Some(MARKS_FILE),
        _ => None,
    }
}

/// Writes `contents` only when no file is there: true when it was written, false when one existed.
pub(crate) fn write_new(path: &Path, contents: &str) -> std::io::Result<bool> {
    match std::fs::OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(mut f) => f.write_all(contents.as_bytes()).map(|_| true),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
        Err(e) => Err(e),
    }
}

// Section: commands

use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

/// When the last mark was written (epoch milliseconds), for the one second quiet time.
static LAST_MARK: Mutex<Option<u64>> = Mutex::new(None);

fn check(label: &str) -> Result<(), String> {
    crate::wall2_meet::require_wall2(label)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn config_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_config_dir().map_err(|_| "not-configured".to_string())
}

fn read_show(app: &tauri::AppHandle) -> Result<Show, String> {
    let path = config_dir(app)?.join(SHOW_FILE);
    let read_at = now_ms();
    let file = match std::fs::File::open(&path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(show_from(None, 0, read_at)),
        Err(_) => return Err("failed".to_string()),
    };
    let len = file.metadata().map_err(|_| "failed".to_string())?.len();
    let mut bytes = Vec::new();
    if len <= SHOW_MAX_BYTES {
        file.take(SHOW_MAX_BYTES + 1).read_to_end(&mut bytes).map_err(|_| "failed".to_string())?;
    }
    Ok(show_from(Some(&bytes), len, read_at))
}

fn read_today(path: &Path, utc: i64, offset: i64) -> Result<MarkResult, String> {
    let today = local_date(utc, offset);
    let mut file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(marks_today("", false, &today)),
        Err(_) => return Err("failed".to_string()),
    };
    let len = file.metadata().map_err(|_| "failed".to_string())?.len();
    let from = len.saturating_sub(MARKS_TAIL_BYTES);
    file.seek(SeekFrom::Start(from)).map_err(|_| "failed".to_string())?;
    let mut bytes = Vec::new();
    file.take(MARKS_TAIL_BYTES).read_to_end(&mut bytes).map_err(|_| "failed".to_string())?;
    Ok(marks_today(&String::from_utf8_lossy(&bytes), from > 0, &today))
}

fn mark(app: &tauri::AppHandle, show_ms: u64, part: Option<String>) -> Result<MarkResult, String> {
    let path = config_dir(app)?.join(MARKS_FILE);
    let now = now_ms();
    let utc = (now / 1000) as i64;
    let offset = crate::wall2_feeds::local_offset_secs(utc);
    {
        let mut last = LAST_MARK.lock().map_err(|_| "failed".to_string())?;
        if too_soon(*last, now) {
            drop(last);
            return read_today(&path, utc, offset);
        }
        let line = mark_line(utc, offset, show_ms, part.as_deref());
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|_| "failed".to_string())?;
        }
        let mut file = std::fs::OpenOptions::new().create(true).read(true).append(true).open(&path).map_err(|_| "failed".to_string())?;
        let len = file.metadata().map_err(|_| "failed".to_string())?.len();
        let mut last_byte = None;
        if len > 0 {
            let mut one = [0u8; 1];
            file.seek(SeekFrom::Start(len - 1)).map_err(|_| "failed".to_string())?;
            file.read_exact(&mut one).map_err(|_| "failed".to_string())?;
            last_byte = Some(one[0]);
        }
        let bytes = append_bytes(last_byte, &line);
        if !fits(len, bytes.len()) {
            return Err("refused".to_string());
        }
        // One write, so a line is never split; an append always lands at the end of the file.
        file.write_all(&bytes).map_err(|_| "failed".to_string())?;
        *last = Some(now);
    }
    read_today(&path, utc, offset)
}

fn open(app: &tauri::AppHandle, name: &'static str) -> Result<(), String> {
    let dir = config_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|_| "failed".to_string())?;
    let path = dir.join(name);
    let starter = if name == SHOW_FILE { STARTER } else { "" };
    write_new(&path, starter).map_err(|_| "failed".to_string())?;
    app.opener().open_path(path.to_string_lossy().to_string(), None::<&str>).map_err(|_| "failed".to_string())
}

/// The run of show, parsed: never the file's own text.
#[tauri::command]
pub async fn wall2_onair_show(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<Show, String> {
    check(window.label())?;
    tauri::async_runtime::spawn_blocking(move || read_show(&app)).await.map_err(|_| "failed".to_string())?
}

/// Appends one line to `marks.txt` and answers with today's count and last show times.
#[tauri::command]
pub async fn wall2_onair_mark(window: tauri::WebviewWindow, app: tauri::AppHandle, show_ms: u64, part: Option<String>) -> Result<MarkResult, String> {
    check(window.label())?;
    check_mark(show_ms, part.as_deref()).map_err(str::to_string)?;
    tauri::async_runtime::spawn_blocking(move || mark(&app, show_ms, part)).await.map_err(|_| "failed".to_string())?
}

/// Today's count and last show times, from the end of `marks.txt`.
#[tauri::command]
pub async fn wall2_onair_marks_today(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<MarkResult, String> {
    check(window.label())?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = config_dir(&app)?.join(MARKS_FILE);
        let utc = (now_ms() / 1000) as i64;
        read_today(&path, utc, crate::wall2_feeds::local_offset_secs(utc))
    })
    .await
    .map_err(|_| "failed".to_string())?
}

/// Opens `run-of-show.txt` (`show`, written as a starter first when there is none) or `marks.txt` (`marks`).
#[tauri::command]
pub async fn wall2_onair_open(window: tauri::WebviewWindow, app: tauri::AppHandle, which: String) -> Result<(), String> {
    check(window.label())?;
    let name = which_file(&which).ok_or_else(|| "refused".to_string())?;
    tauri::async_runtime::spawn_blocking(move || open(&app, name)).await.map_err(|_| "failed".to_string())?
}

// Section: tests

#[cfg(test)]
mod tests {
    use super::*;

    fn parts(text: &str) -> Vec<Part> {
        parse_show(text).1
    }

    #[test]
    fn a_typical_file() {
        let (title, parts, skipped) = parse_show("# Friday stream\n\n## Welcome | 5\n- Say hello\n## Demo | 20\n- First note\nsecond note\n");
        assert_eq!(title.as_deref(), Some("Friday stream"));
        assert_eq!(skipped, 0);
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0], Part { name: "Welcome".into(), minutes: Some(5), notes: vec!["Say hello".into()] });
        assert_eq!(parts[1].notes, vec!["First note".to_string(), "second note".to_string()]);
    }

    #[test]
    fn minutes_are_optional_and_held_to_1_to_240() {
        let p = parts("## A\n## B | 1\n## C | 240\n## D | 0\n## E | 241\n## F |\n## G | x\n## H|7");
        let got: Vec<(&str, Option<u16>)> = p.iter().map(|p| (p.name.as_str(), p.minutes)).collect();
        assert_eq!(got, vec![("A", None), ("B", Some(1)), ("C", Some(240)), ("D", None), ("E", None), ("F", None), ("G | x", None), ("H", Some(7))]);
    }

    #[test]
    fn names_are_1_to_60_characters() {
        let (_, p, skipped) = parse_show(&format!("##   | 5\n## {}\n## {}", "n".repeat(60), "m".repeat(61)));
        assert_eq!(skipped, 1);
        assert_eq!(p[0].name.chars().count(), 60);
        assert!(!p[0].name.ends_with('\u{2026}'));
        assert_eq!(p[1].name.chars().count(), 60);
        assert!(p[1].name.ends_with('\u{2026}'));
    }

    #[test]
    fn the_title_is_the_first_line_only_and_60_characters() {
        let (title, p, skipped) = parse_show(&format!("// a comment first\n# {}\n# not a title\n## A", "t".repeat(80)));
        assert_eq!(title.as_ref().map(|t| t.chars().count()), Some(60));
        assert!(title.unwrap().ends_with('\u{2026}'));
        assert_eq!(skipped, 1);
        assert_eq!(p.len(), 1);
        let (title, _, _) = parse_show("## A\n# late title");
        assert_eq!(title, None);
    }

    #[test]
    fn notes_are_cut_at_160_and_at_most_12_a_part() {
        let mut text = String::from("## A\n");
        text.push_str(&format!("- {}\n", "x".repeat(200)));
        for i in 0..14 {
            text.push_str(&format!("- note {i}\n"));
        }
        let (_, p, skipped) = parse_show(&text);
        assert_eq!(p[0].notes.len(), 12);
        assert_eq!(p[0].notes[0].chars().count(), 160);
        assert!(p[0].notes[0].ends_with('\u{2026}'));
        assert_eq!(p[0].notes[1], "note 0");
        assert_eq!(skipped, 3);
    }

    #[test]
    fn comments_are_never_counted_and_lines_before_the_first_part_are() {
        let (_, p, skipped) = parse_show("# T\nstray one\n- stray two\n// comment\n   // indented comment\n## A\n// under a part\n- n");
        assert_eq!(skipped, 2);
        assert_eq!(p[0].notes, vec!["n".to_string()]);
    }

    #[test]
    fn at_most_40_parts_and_the_rest_with_their_notes_skipped() {
        let mut text = String::new();
        for i in 0..42 {
            text.push_str(&format!("## Part {i} | 3\n- note\n"));
        }
        let (_, p, skipped) = parse_show(&text);
        assert_eq!(p.len(), 40);
        assert_eq!(p[39].name, "Part 39");
        assert_eq!(skipped, 4);
    }

    #[test]
    fn control_characters_are_dropped() {
        let (title, p, _) = parse_show("\u{feff}# Sh\u{7}ow\r\n## Pa\u{1b}rt\t| 5\r\n- a\u{0}b\u{9}c\r\n-  \u{7} \n");
        assert_eq!(title.as_deref(), Some("Show"));
        assert_eq!(p[0].name, "Part");
        assert_eq!(p[0].minutes, Some(5));
        assert_eq!(p[0].notes, vec!["ab c".to_string()]);
    }

    #[test]
    fn separators_and_direction_marks_are_dropped_and_a_tab_is_a_space() {
        assert_eq!(clean("a\u{2028}b\u{2029}c"), "abc");
        assert_eq!(clean("\u{200E}x\u{200F}y\u{202A}\u{202B}\u{202C}\u{202D}\u{202E}z\u{2066}\u{2067}\u{2068}\u{2069}"), "xyz");
        assert_eq!(clean("Part\tTwo"), "Part Two");
        assert_eq!(clean("\t\u{2028}\t"), "");
        // Ordinary text, including right-to-left letters themselves, is kept.
        assert_eq!(clean("caf\u{e9} \u{5e9}\u{5dc}\u{5d5}\u{5dd}"), "caf\u{e9} \u{5e9}\u{5dc}\u{5d5}\u{5dd}");
        let (title, p, _) = parse_show("# A\u{202E}B\n## Na\u{2028}me\tx | 5\n- n\u{200F}ote\tone\n");
        assert_eq!(title.as_deref(), Some("AB"));
        assert_eq!(p[0].name, "Name x");
        assert_eq!(p[0].notes, vec!["note one".to_string()]);
        let line = mark_line(1_794_603_909, 0, 0, Some("P\u{2029}a\u{202E}r\tt"));
        assert_eq!(line, "2026-11-13T21:05:09+00:00\t00:00:00\tPar t\n");
    }

    #[test]
    fn a_mark_never_joins_the_last_line() {
        let line = "2026-11-13T21:05:09+00:00\t00:00:00\t-\n";
        assert_eq!(append_bytes(None, line), line.as_bytes());
        assert_eq!(append_bytes(Some(b'\n'), line), line.as_bytes());
        // A file saved by hand without a final newline: the same write starts with one.
        let mut want = vec![b'\n'];
        want.extend_from_slice(line.as_bytes());
        assert_eq!(append_bytes(Some(b'x'), line), want);
        // A file ending in a Windows line end already ends in a newline byte.
        let file = b"2026-11-12T09:00:00+00:00\t00:01:00\tA\r\n";
        assert_eq!(append_bytes(file.last().copied(), line), line.as_bytes());
        // The size limit counts the extra byte.
        assert_eq!(append_bytes(Some(b'x'), line).len(), line.len() + 1);
    }

    #[test]
    fn files_are_missing_refused_or_read() {
        assert_eq!(show_from(None, 0, 7).state, "missing");
        let big = vec![b'a'; SHOW_MAX_BYTES as usize + 1];
        let over = show_from(Some(&big), big.len() as u64, 7);
        assert_eq!((over.state, over.reason.as_deref()), ("refused", Some("run-of-show.txt is over 32 KB")));
        assert_eq!(show_from(Some(b""), 40_000, 7).state, "refused");
        let exact = vec![b'a'; SHOW_MAX_BYTES as usize];
        assert_eq!(show_from(Some(&exact), exact.len() as u64, 7).state, "ok");
        let bad = show_from(Some(&[0x23, 0xff, 0xfe]), 3, 7);
        assert_eq!((bad.state, bad.reason.as_deref()), ("refused", Some("run-of-show.txt is not UTF-8 text")));
        let ok = show_from(Some(STARTER.as_bytes()), STARTER.len() as u64, 9);
        assert_eq!((ok.state, ok.read_at, ok.parts.len()), ("ok", 9, 3));
    }

    #[test]
    fn the_starter_has_three_parts_with_one_note_each() {
        let (title, p, skipped) = parse_show(STARTER);
        assert_eq!(title.as_deref(), Some("My show"));
        assert_eq!(skipped, 0);
        let got: Vec<(&str, Option<u16>, usize)> = p.iter().map(|p| (p.name.as_str(), p.minutes, p.notes.len())).collect();
        assert_eq!(got, vec![("Welcome", Some(5), 1), ("Main topic", Some(20), 1), ("Questions", Some(10), 1)]);
    }

    #[test]
    fn the_answer_is_camel_case_and_carries_no_file_text() {
        let s = serde_json::to_value(show_from(Some(b"## A | 5\n- n"), 12, 3)).unwrap();
        assert_eq!(s, serde_json::json!({ "state": "ok", "title": null, "parts": [{ "name": "A", "minutes": 5, "notes": ["n"] }], "skipped": 0, "reason": null, "readAt": 3 }));
    }

    #[test]
    fn a_mark_line_is_local_time_show_time_and_part() {
        // 2026-11-13 21:05:09 UTC, Pacific standard time.
        let utc = 1_794_603_909;
        assert_eq!(mark_line(utc, -8 * 3600, 2_533_000, Some("Product demo")), "2026-11-13T13:05:09-08:00\t00:42:13\tProduct demo\n");
        assert_eq!(mark_line(utc, 0, 0, None), "2026-11-13T21:05:09+00:00\t00:00:00\t-\n");
        assert_eq!(mark_line(utc, 5 * 3600 + 1800, 3_725_999, Some("A\tB\nC\r")), "2026-11-14T02:35:09+05:30\t01:02:05\tA BC\n");
        assert_eq!(mark_line(utc, 0, 1, Some(" \t\n")), "2026-11-13T21:05:09+00:00\t00:00:00\t-\n");
        assert_eq!(mark_line(utc, 0, SHOW_MS_MAX, Some("x")).split('\t').nth(1), Some("24:00:00"));
        assert_eq!(mark_line(utc, 0, 0, Some("x")).matches('\t').count(), 2);
    }

    #[test]
    fn a_mark_past_its_limits_is_refused() {
        assert_eq!(check_mark(SHOW_MS_MAX, Some(&"p".repeat(60))), Ok(()));
        assert_eq!(check_mark(SHOW_MS_MAX + 1, None), Err("refused"));
        assert_eq!(check_mark(0, Some(&"p".repeat(61))), Err("refused"));
        assert!(fits(MARKS_MAX_BYTES - 10, 10));
        assert!(!fits(MARKS_MAX_BYTES - 10, 11));
        assert!(!fits(MARKS_MAX_BYTES + 5, 1));
    }

    #[test]
    fn a_second_mark_within_a_second_is_ignored() {
        assert!(!too_soon(None, 5_000));
        assert!(too_soon(Some(5_000), 5_000));
        assert!(too_soon(Some(5_000), 5_999));
        assert!(!too_soon(Some(5_000), 6_000));
        // A clock that went back never blocks marks.
        assert!(!too_soon(Some(9_000), 5_000));
    }

    #[test]
    fn todays_marks_are_counted_from_the_end_of_the_file() {
        let tail = "13T09:00:00-08:00\t00:01:00\tcut\n\
2026-11-12T21:00:00-08:00\t00:05:00\tA\n\
2026-11-13T09:45:00-08:00\t00:03:12\tA\n\
garbage line\n\
2026-11-13T09:52:00-08:00\t00:09:40\tB\n\
2026-11-13T10:30:00-08:00\t01:02:03\t-\n\
2026-11-13T10:31:00-08:00\t01:03:00\t-\n";
        let r = marks_today(tail, true, "2026-11-13");
        assert_eq!(r.today, 4);
        assert_eq!(r.last, vec!["09:40".to_string(), "1:02:03".to_string(), "1:03:00".to_string()]);
        let r = marks_today("2026-11-13T09:45:00-08:00\t00:03:12\tA\n", false, "2026-11-13");
        assert_eq!((r.today, r.last), (1, vec!["03:12".to_string()]));
        assert_eq!(marks_today("", false, "2026-11-13"), MarkResult { today: 0, last: vec![] });
    }

    #[test]
    fn local_dates_follow_the_offset() {
        assert_eq!(local_date(1_794_603_909, -8 * 3600), "2026-11-13");
        assert_eq!(local_date(1_794_603_909, 3 * 3600), "2026-11-14");
        assert_eq!(rfc3339_local(0, 0), "1970-01-01T00:00:00+00:00");
    }

    #[test]
    fn only_the_two_fixed_files_open() {
        assert_eq!(which_file("show"), Some("run-of-show.txt"));
        assert_eq!(which_file("marks"), Some("marks.txt"));
        assert_eq!(which_file("../feeds.json"), None);
        assert_eq!(which_file("Show"), None);
    }

    #[test]
    fn the_starter_never_overwrites_a_file() {
        let dir = std::env::temp_dir().join(format!("wall2-onair-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(SHOW_FILE);
        let _ = std::fs::remove_file(&path);
        assert!(write_new(&path, STARTER).unwrap());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), STARTER);
        std::fs::write(&path, "## Mine\n").unwrap();
        assert!(!write_new(&path, STARTER).unwrap());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "## Mine\n");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_the_wall_window_may_ask() {
        assert!(check("main").is_err());
        assert!(check("wall2").is_ok());
    }

    #[test]
    fn the_window_check_is_the_first_statement_of_every_command() {
        let src = include_str!("wall2_onair.rs");
        for name in ["wall2_onair_show(", "wall2_onair_mark(", "wall2_onair_marks_today(", "wall2_onair_open("] {
            let at = src.find(&format!("pub async fn {name}")).expect("command");
            let body = &src[at..];
            let open = body.find('{').expect("body");
            let first = body[open + 1..].trim_start();
            assert!(first.starts_with("check(window.label())?;"), "{name} first statement: {}", &first[..first.len().min(60)]);
        }
    }
}
