//! Wall 2 Shelf captures: the newest ShareX captures, read from ShareX's own history (`History.db`, or `History.json` in older ShareX).
//!
//! What the page can and cannot do:
//! - The page asks for a list and gets, per capture, an opaque id (a hash of its path, modified
//!   time and size; Rust keeps a bounded map of id to path across reads), the file name, the window title and app name (capped),
//!   the kind, the time, the size and whether the file still exists. It never gets a path or a
//!   folder, and it never sends one: `thumb` and `act` take only an id.
//! - Every path acted on comes from the parsed history, must be an absolute local `X:\...`
//!   path (no `\\server`, no `\\?\`, no URL), must be a regular file with an allowed extension,
//!   and is checked again after links are followed (see `resolve`).
//! - `act` is exactly one of eight fixed words: `open` (the default app, through the opener
//!   plugin, no shell, no arguments; the new window is then moved to the lower right quarter of
//!   the primary monitor), `copy` (the file goes on the clipboard as a file, like Copy in
//!   Explorer), `folder` (`explorer.exe /select,` and the quoted path), `path` (the file's path
//!   as text on the clipboard), `edit`, `pin` and `ocr` (ShareX started on this one file, see
//!   `wall2_sharex::FileTask`, pictures only) and `trash` (the Windows Recycle Bin, with undo).
//! - A `History.json` read is capped at 8 MB (the newest end of the file); `History.db` is opened
//!   read-only and only its newest 200 rows are read. At most 30 captures are returned. A busy
//!   database gives an empty list for that poll. Nothing is logged: no path, no title.
//!
//! Errors are fixed words: `not-found` (no ShareX history file or database), `failed`, `missing` (the id
//! or the file is gone), `refused` (a path or extension that does not pass), `too-big` and
//! `not-image` (thumbnails), `forbidden` (the wrong window).
//!
//! Playing a recording: the page never gets a path for a video either. `wall2_captures_media.rs` serves a held
//! video by id on the `wallcap` scheme (`held_video` here does the lookup, `resolve` and the id check). Ids are
//! an HMAC under a key made fresh each run; if the system cannot make the key, no video id resolves.
//!
//! Share link (`wall2_share.rs`) takes an id the same way and resolves it with `open_for`, which runs the same `resolve` as `act`.
#![cfg_attr(not(windows), allow(dead_code))]

use base64::Engine as _;
use serde::Serialize;
use serde_json::Value;
use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, OpenFlags};
use sha2::{Digest, Sha256};
use std::io::{Read, Seek, SeekFrom};
use crate::wall2_winutil::Rect;
use std::collections::HashSet;
use std::path::Path;
use std::sync::Mutex;
use tauri_plugin_opener::OpenerExt;

/// The most of the history file read, from its newest (last) end.
const MAX_HISTORY: u64 = 8 * 1024 * 1024;
/// The most captures returned.
const MAX_ENTRIES: usize = 30;
/// The biggest file a thumbnail is made from.
const MAX_THUMB: u64 = 6 * 1024 * 1024;
const TITLE_CHARS: usize = 120;
const APP_CHARS: usize = 60;

const NOT_FOUND: &str = "not-found";
const FAILED: &str = "failed";
const MISSING: &str = "missing";
const REFUSED: &str = "refused";
const TOO_BIG: &str = "too-big";
const NOT_IMAGE: &str = "not-image";
/// ShareX is not on this PC (edit, pin and read text need it). The page words it.
const NOT_INSTALLED: &str = "not-installed";
/// The Recycle Bin could not take the file; nothing was deleted.
const NOT_RECYCLED: &str = "recycle-failed";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Kind {
    Image,
    Gif,
    Video,
    Other,
}

impl Kind {
    fn as_str(self) -> &'static str {
        match self {
            Kind::Image => "image",
            Kind::Gif => "gif",
            Kind::Video => "video",
            Kind::Other => "other",
        }
    }
}

/// The kind a file name's extension gives (without case). `Other` is any extension that is not
/// allowed to be shown or acted on.
pub(crate) fn kind_of(name: &str) -> Kind {
    let ext = match name.rsplit_once('.') {
        Some((_, e)) => e.to_ascii_lowercase(),
        None => return Kind::Other,
    };
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "webp" | "bmp" => Kind::Image,
        "gif" => Kind::Gif,
        "mp4" | "webm" | "mkv" | "mov" | "avi" => Kind::Video,
        _ => Kind::Other,
    }
}

/// An absolute local path (`C:\...`) as text. Refuses a network path (`\\server\...`), a device
/// or verbatim prefix (`\\?\`, `\\.\`), forward slashes (so no URL), any `..` or empty part, a
/// colon after the drive (alternate streams), control characters and wildcard characters.
/// Pure text; the real file is checked by `resolve`.
pub(crate) fn plain_local_path(p: &str) -> bool {
    let b = p.as_bytes();
    if b.len() < 4 || p.len() > 520 || !b[0].is_ascii_alphabetic() || b[1] != b':' || b[2] != b'\\' {
        return false;
    }
    if p.chars().any(|c| c.is_control() || matches!(c, '/' | '*' | '?' | '"' | '<' | '>' | '|')) {
        return false;
    }
    if p[2..].contains(':') {
        return false;
    }
    p[3..].split('\\').all(|part| !part.is_empty() && part != ".." && part != ".")
}

/// The text of a path that may be shown or acted on: it passes `plain_local_path` and its
/// extension is an allowed one.
pub(crate) fn allowed_path(p: &str) -> bool {
    plain_local_path(p) && kind_of(p) != Kind::Other
}

/// Days since 1970-01-01 for a civil date (the inverse of the one in build.rs).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let mp = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn digits(s: &str, at: usize, n: usize) -> Option<i64> {
    let part = s.get(at..at + n)?;
    if !part.bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    part.parse::<i64>().ok()
}

/// Epoch milliseconds for `2026-11-11T10:24:00.1234567-08:00`, `...Z` or a time with no zone
/// (taken as UTC). None for anything that is not that shape.
pub(crate) fn parse_time_ms(s: &str) -> Option<i64> {
    let s = s.trim();
    let b = s.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || !(b[10] == b'T' || b[10] == b' ') || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let (y, mo, d) = (digits(s, 0, 4)?, digits(s, 5, 2)?, digits(s, 8, 2)?);
    let (h, mi, sec) = (digits(s, 11, 2)?, digits(s, 14, 2)?, digits(s, 17, 2)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || sec > 60 {
        return None;
    }
    let mut i = 19;
    let mut ms = 0i64;
    if b.get(i) == Some(&b'.') {
        i += 1;
        let mut scale = 100;
        while let Some(c) = b.get(i).filter(|c| c.is_ascii_digit()) {
            ms += i64::from(c - b'0') * scale;
            scale /= 10;
            i += 1;
        }
    }
    let offset_min = match b.get(i) {
        None | Some(b'Z') | Some(b'z') => 0,
        Some(&sign) if sign == b'+' || sign == b'-' => {
            let oh = digits(s, i + 1, 2)?;
            let rest = if b.get(i + 3) == Some(&b':') { i + 4 } else { i + 3 };
            let om = digits(s, rest, 2)?;
            let v = oh * 60 + om;
            if sign == b'-' { -v } else { v }
        }
        _ => return None,
    };
    let secs = days_from_civil(y, mo, d) * 86_400 + h * 3600 + mi * 60 + sec - offset_min * 60;
    Some(secs * 1000 + ms)
}

/// One history entry, reduced to what the wall uses. `path` stays in Rust.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Parsed {
    pub path: String,
    pub file_name: String,
    pub title: String,
    pub app: String,
    pub time: i64,
}

/// The first `n` characters, control characters dropped and ends trimmed.
pub(crate) fn cap_chars(s: &str, n: usize) -> String {
    s.chars().filter(|c| !c.is_control()).collect::<String>().trim().chars().take(n).collect()
}

/// A field of a JSON object by name, without regard to case.
fn field<'a>(obj: &'a serde_json::Map<String, Value>, key: &str) -> Option<&'a Value> {
    obj.get(key).or_else(|| obj.iter().find(|(k, _)| k.eq_ignore_ascii_case(key)).map(|(_, v)| v))
}

fn text_of<'a>(obj: &'a serde_json::Map<String, Value>, key: &str) -> &'a str {
    field(obj, key).and_then(Value::as_str).unwrap_or("")
}

fn entry_of(v: &Value) -> Option<Parsed> {
    let obj = v.as_object()?;
    let path = text_of(obj, "FilePath").trim().to_string();
    if path.is_empty() {
        return None;
    }
    let file_name = match text_of(obj, "FileName").trim() {
        "" => path.rsplit('\\').next().unwrap_or("").to_string(),
        n => n.to_string(),
    };
    let tags = field(obj, "Tags").and_then(Value::as_object);
    let (title, app) = match tags {
        Some(t) => (text_of(t, "WindowTitle"), text_of(t, "ProcessName")),
        None => ("", ""),
    };
    Some(Parsed {
        path,
        file_name: cap_chars(&file_name, 200),
        title: cap_chars(title, TITLE_CHARS),
        app: cap_chars(app, APP_CHARS),
        time: parse_time_ms(text_of(obj, "DateTime")).unwrap_or(0),
    })
}

/// The first entry of a history file that was read from its middle: the start of the first
/// line that holds only an opening brace (ShareX writes each entry indented), else the text
/// after the first `},{`. An empty string when neither is there.
pub(crate) fn from_first_entry(text: &str) -> &str {
    let mut at = 0;
    for line in text.split_inclusive('\n') {
        if line.trim() == "{" || line.trim() == "{," {
            return &text[at..];
        }
        at += line.len();
    }
    match text.find("},{") {
        Some(i) => &text[i + 2..],
        None => "",
    }
}

/// Every entry a history text holds, in file order. Tolerant: a JSON array, an array whose
/// closing bracket is not written yet (ShareX is writing), a half-written last entry (dropped),
/// or comma-separated objects with no brackets (older builds).
pub(crate) fn parse_history(text: &str) -> Vec<Parsed> {
    let mut rest = text.trim_start_matches('\u{feff}');
    let mut out = Vec::new();
    loop {
        rest = rest.trim_start_matches(|c: char| c.is_whitespace() || c == ',' || c == '[' || c == ']');
        if rest.is_empty() {
            break;
        }
        let mut stream = serde_json::Deserializer::from_str(rest).into_iter::<Value>();
        let value = match stream.next() {
            Some(Ok(v)) => v,
            _ => break,
        };
        let used = stream.byte_offset();
        match &value {
            Value::Array(items) => out.extend(items.iter().filter_map(entry_of)),
            other => out.extend(entry_of(other)),
        }
        if used == 0 || used > rest.len() {
            break;
        }
        rest = &rest[used..];
    }
    out
}

/// The captures to show: entries whose path passes `allowed_path`, newest first by time (a
/// later line wins a tie), at most `n`.
pub(crate) fn newest(mut all: Vec<Parsed>, n: usize) -> Vec<Parsed> {
    all.retain(|p| allowed_path(&p.path));
    all.reverse();
    all.sort_by(|a, b| b.time.cmp(&a.time));
    all.truncate(n);
    all
}

/// `%NAME%` parts of a text replaced from `env`; one that `env` does not know stays as written.
pub(crate) fn expand_vars(s: &str, env: &dyn Fn(&str) -> Option<String>) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find('%') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        match after.find('%') {
            Some(j) => match env(&after[..j]) {
                Some(v) => {
                    out.push_str(&v);
                    rest = &after[j + 1..];
                }
                None => {
                    out.push('%');
                    rest = after;
                }
            },
            None => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// The folder a `PersonalPath.cfg` names: its first line, expanded, when that is an absolute
/// local path. None otherwise (a relative or network folder is not followed).
pub(crate) fn personal_folder(cfg: &str, env: &dyn Fn(&str) -> Option<String>) -> Option<String> {
    let line = cfg.trim_start_matches('\u{feff}').lines().next()?.trim().trim_matches('"');
    let dir = expand_vars(line, env).trim_end_matches('\\').to_string();
    plain_local_path(&format!("{dir}\\x")).then_some(dir)
}

/// The history files to try, in order: the personal folder named by a `PersonalPath.cfg` in
/// the Documents ShareX folder, then one beside the install, then the default Documents
/// ShareX folder. In each folder `History.db` (ShareX 18 and later) comes before `History.json`.
pub(crate) fn history_candidates(
    documents: Option<&str>,
    install: Option<&str>,
    read: &dyn Fn(&str) -> Option<String>,
    env: &dyn Fn(&str) -> Option<String>,
) -> Vec<String> {
    let default = documents.map(|d| format!("{}\\ShareX", d.trim_end_matches('\\')));
    let mut folders: Vec<String> = Vec::new();
    for base in [default.clone(), install.map(|i| i.trim_end_matches('\\').to_string())].into_iter().flatten() {
        if let Some(dir) = read(&format!("{base}\\PersonalPath.cfg")).and_then(|c| personal_folder(&c, env)) {
            folders.push(dir);
        }
    }
    folders.extend(default);
    let mut out: Vec<String> = Vec::new();
    for f in folders {
        for name in ["History.db", "History.json"] {
            let file = format!("{f}\\{name}");
            if !out.iter().any(|o| o.eq_ignore_ascii_case(&file)) {
                out.push(file);
            }
        }
    }
    out
}

/// The text of a history file: its newest end, at most `MAX_HISTORY` bytes.
fn read_tail(path: &str) -> Result<String, ()> {
    let mut f = std::fs::File::open(path).map_err(|_| ())?;
    let len = f.metadata().map_err(|_| ())?.len();
    let start = len.saturating_sub(MAX_HISTORY);
    f.seek(SeekFrom::Start(start)).map_err(|_| ())?;
    let mut buf = Vec::new();
    f.take(MAX_HISTORY).read_to_end(&mut buf).map_err(|_| ())?;
    let text = String::from_utf8_lossy(&buf).into_owned();
    Ok(if start > 0 { from_first_entry(&text).to_string() } else { text })
}

/// The most rows read from `History.db`.
const DB_ROWS: u32 = 200;

fn is_busy(e: &rusqlite::Error) -> bool {
    matches!(
        e,
        rusqlite::Error::SqliteFailure(f, _)
            if f.code == rusqlite::ErrorCode::DatabaseBusy || f.code == rusqlite::ErrorCode::DatabaseLocked
    )
}

/// The newest rows of a ShareX `History.db`, oldest first (file order, like the JSON path). A
/// busy or locked database is an empty list; any other problem (no table, no column) is an error.
pub(crate) fn read_db(path: &Path) -> Result<Vec<Parsed>, ()> {
    let run = || -> Result<Vec<Parsed>, rusqlite::Error> {
        let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
        conn.busy_timeout(std::time::Duration::from_millis(250))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT FileName, FilePath, DateTime, Tags FROM History ORDER BY Id DESC LIMIT {DB_ROWS}"
        ))?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, SqlValue>(0)?,
                r.get::<_, SqlValue>(1)?,
                r.get::<_, SqlValue>(2)?,
                r.get::<_, SqlValue>(3)?,
            ))
        })?;
        // Text stays text and NULL is empty; a cell of any other type skips its row, not the read.
        let text = |v: SqlValue| -> Option<Option<String>> {
            match v {
                SqlValue::Text(t) => Some(Some(t)),
                SqlValue::Null => Some(None),
                _ => None,
            }
        };
        let mut out = Vec::new();
        for row in rows {
            let (name, file, when, tags) = row?;
            let (Some(name), Some(file), Some(when)) = (text(name), text(file), text(when)) else {
                continue;
            };
            let tags = text(tags).flatten();
            let mut obj = serde_json::Map::new();
            obj.insert("FileName".into(), Value::String(name.unwrap_or_default()));
            obj.insert("FilePath".into(), Value::String(file.unwrap_or_default()));
            obj.insert("DateTime".into(), Value::String(when.unwrap_or_default()));
            let tags = tags.and_then(|t| serde_json::from_str::<Value>(&t).ok()).unwrap_or(Value::Null);
            obj.insert("Tags".into(), tags);
            out.extend(entry_of(&Value::Object(obj)));
        }
        out.reverse();
        Ok(out)
    };
    match run() {
        Ok(v) => Ok(v),
        Err(e) if is_busy(&e) => Ok(Vec::new()),
        Err(_) => Err(()),
    }
}

/// Every entry of a history file, in file order: `History.db` through SQLite, anything else as
/// JSON text.
fn read_history(file: &str) -> Result<Vec<Parsed>, ()> {
    if file.to_ascii_lowercase().ends_with(".db") {
        read_db(Path::new(file))
    } else {
        Ok(parse_history(&read_tail(file)?))
    }
}

/// The first file that reads, trying each in order. A file that errors falls through to the next
/// one; if none reads, the first error is returned. An empty list is an error.
fn read_first(files: &[String], reader: &dyn Fn(&str) -> Result<Vec<Parsed>, ()>) -> Result<Vec<Parsed>, ()> {
    for f in files {
        if let Ok(v) = reader(f) {
            return Ok(v);
        }
    }
    Err(())
}

/// What the wall keeps per listed capture. The path never leaves Rust.
#[derive(Clone, Debug)]
pub(crate) struct Held {
    path: String,
    kind: Kind,
}

/// The most ids kept across reads.
const MAX_HELD: usize = 64;

/// Id to capture, oldest first, merged across reads and bounded to `MAX_HELD`.
static HELD: Mutex<Vec<(String, Held)>> = Mutex::new(Vec::new());

/// The key the ids are made with: random for this run of the app, so an id cannot be worked out
/// from a path, a time and a size, and no id survives a restart. None when the system generator
/// failed; then no video id resolves (see `held_video`) and the list still draws.
fn id_key() -> Option<&'static [u8; 32]> {
    static KEY: std::sync::OnceLock<Option<[u8; 32]>> = std::sync::OnceLock::new();
    KEY.get_or_init(|| {
        let bytes = crate::wall2_oauth::random_b64(32).and_then(|t| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(t).ok())?;
        <[u8; 32]>::try_from(bytes.as_slice()).ok()
    })
    .as_ref()
}

/// The keyed id for a file state, or None without a key.
pub(crate) fn id_with(key: Option<&[u8; 32]>, path: &str, modified_ms: i64, size: u64) -> Option<String> {
    use hmac::{Hmac, Mac};
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key?).expect("HMAC takes a key of any length");
    mac.update(path.as_bytes());
    mac.update(&[0u8]);
    mac.update(&modified_ms.to_le_bytes());
    mac.update(&size.to_le_bytes());
    Some(mac.finalize().into_bytes().iter().take(8).map(|b| format!("{b:02x}")).collect())
}

/// A stable opaque id: 16 hex characters of an HMAC-SHA256, keyed per run, of the path, modified
/// time and size. The same file in the same state has the same id on every read in one run,
/// whichever read the page holds. With no key the id is a plain hash: distinct for the list, and
/// never served, because `held_video` refuses without a key.
pub(crate) fn id_for(path: &str, modified_ms: i64, size: u64) -> String {
    id_with(id_key(), path, modified_ms, size).unwrap_or_else(|| {
        let mut h = Sha256::new();
        h.update(path.as_bytes());
        h.update([0u8]);
        h.update(modified_ms.to_le_bytes());
        h.update(size.to_le_bytes());
        h.finalize().iter().take(8).map(|b| format!("{b:02x}")).collect()
    })
}

/// Add a read's captures to the map. An id already there moves to the newest end; the oldest
/// beyond `max` are dropped.
pub(crate) fn remember<T>(map: &mut Vec<(String, T)>, fresh: Vec<(String, T)>, max: usize) {
    for (id, held) in fresh {
        map.retain(|(k, _)| *k != id);
        map.push((id, held));
    }
    if map.len() > max {
        let extra = map.len() - max;
        map.drain(..extra);
    }
}

/// A held capture by id.
pub(crate) fn pick<'a, T>(map: &'a [(String, T)], id: &str) -> Option<&'a T> {
    map.iter().find(|(k, _)| k == id).map(|(_, h)| h)
}

/// One capture as the page sees it.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CaptureEntry {
    pub id: String,
    pub file_name: String,
    pub title: String,
    pub app: String,
    pub kind: &'static str,
    pub time: i64,
    pub size: u64,
    pub exists: bool,
}

/// The entry the page sees for a parsed capture; `size` and `exists` come from the file.
pub(crate) fn entry_for(id: String, p: &Parsed, kind: Kind, size: Option<u64>) -> CaptureEntry {
    CaptureEntry {
        id,
        file_name: p.file_name.clone(),
        title: p.title.clone(),
        app: p.app.clone(),
        kind: kind.as_str(),
        time: p.time,
        size: size.unwrap_or(0),
        exists: size.is_some(),
    }
}

/// Whether a path is a regular file once links are followed (a directory, or a link to one,
/// is not).
fn regular_size(path: &Path) -> Option<u64> {
    std::fs::metadata(path).ok().filter(|m| m.is_file()).map(|m| m.len())
}

/// Size and modified time (epoch milliseconds, 0 when unknown) of a regular file.
fn regular_stat(path: &Path) -> Option<(u64, i64)> {
    let m = std::fs::metadata(path).ok().filter(|m| m.is_file())?;
    let ms = m
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as i64);
    Some((m.len(), ms))
}

/// The path to act on: the held path checked as text, resolved through links, and checked as
/// text again, with an allowed extension, as a regular file. Err is `missing` (no such file)
/// or `refused`.
fn resolve(held: &Held) -> Result<String, &'static str> {
    if !allowed_path(&held.path) {
        return Err(REFUSED);
    }
    let resolved = std::fs::canonicalize(&held.path).map_err(|_| MISSING)?;
    let text = crate::wall2_sharex::strip_verbatim(resolved.to_str().ok_or(REFUSED)?).ok_or(REFUSED)?;
    if !allowed_path(&text) || kind_of(&text) != held.kind {
        return Err(REFUSED);
    }
    regular_size(Path::new(&text)).ok_or(MISSING)?;
    Ok(text)
}

fn documents_dir() -> Option<String> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::System::Com::CoTaskMemFree;
        use windows::Win32::UI::Shell::{FOLDERID_Documents, SHGetKnownFolderPath, KF_FLAG_DEFAULT};
        unsafe {
            let p = SHGetKnownFolderPath(&FOLDERID_Documents, KF_FLAG_DEFAULT, HANDLE::default()).ok()?;
            let dir = p.to_string().ok();
            CoTaskMemFree(Some(p.0 as *const std::ffi::c_void));
            dir
        }
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// The folder ShareX.exe sits in, when ShareX is installed and found.
fn install_dir() -> Option<String> {
    #[cfg(windows)]
    {
        crate::wall2_sharex::install_dir()
    }
    #[cfg(not(windows))]
    {
        None
    }
}

fn history_files() -> Vec<String> {
    let docs = documents_dir();
    let install = install_dir();
    let read = |p: &str| -> Option<String> {
        if !plain_local_path(p) {
            return None;
        }
        let mut f = std::fs::File::open(p).ok()?;
        let mut buf = Vec::new();
        f.by_ref().take(4096).read_to_end(&mut buf).ok()?;
        Some(String::from_utf8_lossy(&buf).into_owned())
    };
    let env = |k: &str| std::env::var(k).ok();
    history_candidates(docs.as_deref(), install.as_deref(), &read, &env)
        .into_iter()
        .filter(|p| plain_local_path(p) && regular_size(Path::new(p)).is_some())
        .collect()
}

fn list_now() -> Result<Vec<CaptureEntry>, String> {
    let files = history_files();
    if files.is_empty() {
        return Err(NOT_FOUND.to_string());
    }
    let all = read_first(&files, &read_history).map_err(|_| FAILED.to_string())?;
    let shown = newest(all, MAX_ENTRIES);
    let mut held = Vec::with_capacity(shown.len());
    let mut out = Vec::with_capacity(shown.len());
    for p in shown.iter() {
        let kind = kind_of(&p.path);
        let stat = regular_stat(Path::new(&p.path));
        let id = id_for(&p.path, stat.map_or(0, |s| s.1), stat.map_or(0, |s| s.0));
        out.push(entry_for(id.clone(), p, kind, stat.map(|s| s.0)));
        held.push((id, Held { path: p.path.clone(), kind }));
    }
    let mut list = HELD.lock().map_err(|_| FAILED.to_string())?;
    remember(&mut list, held, MAX_HELD);
    Ok(out)
}

/// The mime type for an image extension.
fn mime_of(name: &str) -> Option<&'static str> {
    match name.rsplit_once('.')?.1.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

/// Whether the first bytes are those of the format the extension claims.
pub(crate) fn magic_ok(name: &str, b: &[u8]) -> bool {
    match mime_of(name) {
        Some("image/png") => b.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]),
        Some("image/jpeg") => b.starts_with(&[0xFF, 0xD8, 0xFF]),
        Some("image/gif") => b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a"),
        Some("image/webp") => b.len() >= 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP",
        Some("image/bmp") => b.starts_with(b"BM"),
        _ => false,
    }
}

/// The data URL for image bytes, or the word for why not.
pub(crate) fn data_url(name: &str, bytes: &[u8]) -> Result<String, &'static str> {
    if bytes.len() as u64 > MAX_THUMB {
        return Err(TOO_BIG);
    }
    let mime = mime_of(name).ok_or(NOT_IMAGE)?;
    if !magic_ok(name, bytes) {
        return Err(NOT_IMAGE);
    }
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// A held capture opened once, by id, for the Share link upload: its checked path, the open handle
/// and the size read from that handle's metadata (which must say a regular file). Runs the same
/// `resolve` as Open and Copy (an allowed local path, a regular file, an allowed extension).
/// Err is `missing` (no such id or file), `refused` or `failed`.
pub(crate) fn open_for(id: &str) -> Result<(String, std::fs::File, u64), String> {
    let held = {
        let list = HELD.lock().map_err(|_| FAILED.to_string())?;
        pick(&list, id).cloned().ok_or_else(|| MISSING.to_string())?
    };
    let path = resolve(&held).map_err(str::to_string)?;
    let file = std::fs::File::open(&path).map_err(|_| MISSING.to_string())?;
    let meta = file.metadata().map_err(|_| MISSING.to_string())?;
    if !meta.is_file() {
        return Err(MISSING.to_string());
    }
    Ok((path, file, meta.len()))
}

/// A held video opened once, for the `wallcap` scheme: its path (for the extension only), the
/// open handle, the size read from that handle, and whether the id still matches the file as the
/// handle sees it (false when the file was swapped since it was listed). None when the id is not
/// held, is not a video, or does not resolve to a regular file. Never says why.
pub(crate) fn held_video(id: &str) -> Option<(String, std::fs::File, u64, bool)> {
    let held = {
        let list = HELD.lock().ok()?;
        pick(&list, id).cloned()?
    };
    if held.kind != Kind::Video {
        return None;
    }
    let key = id_key()?;
    let path = resolve(&held).ok()?;
    let file = std::fs::File::open(&path).ok()?;
    let meta = file.metadata().ok().filter(|m| m.is_file())?;
    let ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as i64);
    let id_ok = id_with(Some(key), &held.path, ms, meta.len()).as_deref() == Some(id);
    Some((path, file, meta.len(), id_ok))
}

fn thumb_now(id: &str) -> Result<String, String> {
    let held = {
        let list = HELD.lock().map_err(|_| FAILED.to_string())?;
        pick(&list, id).cloned().ok_or_else(|| MISSING.to_string())?
    };
    if !matches!(held.kind, Kind::Image | Kind::Gif) {
        return Err(NOT_IMAGE.to_string());
    }
    let path = resolve(&held).map_err(str::to_string)?;
    let mut f = std::fs::File::open(&path).map_err(|_| MISSING.to_string())?;
    let mut buf = Vec::new();
    // One byte past the cap, so a file that grew since the check still reads as too big.
    f.by_ref().take(MAX_THUMB + 1).read_to_end(&mut buf).map_err(|_| FAILED.to_string())?;
    data_url(&path, &buf).map_err(str::to_string)
}

/// What a button asks for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Action {
    Open,
    Copy,
    Folder,
    CopyPath,
    Edit,
    Pin,
    Ocr,
    Trash,
}

impl Action {
    /// Exactly one of the eight words below; anything else is None.
    pub(crate) fn parse(s: &str) -> Option<Action> {
        match s {
            "open" => Some(Action::Open),
            "copy" => Some(Action::Copy),
            "folder" => Some(Action::Folder),
            "path" => Some(Action::CopyPath),
            "edit" => Some(Action::Edit),
            "pin" => Some(Action::Pin),
            "ocr" => Some(Action::Ocr),
            "trash" => Some(Action::Trash),
            _ => None,
        }
    }

    /// The ShareX task for the three file actions.
    fn sharex(self) -> Option<crate::wall2_sharex::FileTask> {
        use crate::wall2_sharex::FileTask;
        match self {
            Action::Edit => Some(FileTask::Edit),
            Action::Pin => Some(FileTask::Pin),
            Action::Ocr => Some(FileTask::Ocr),
            _ => None,
        }
    }
}

/// The lower right quarter of a work area: the right half of its width and the bottom half of its
/// height. An odd size gives the extra pixel to the left and top parts, so the quarter always
/// ends on the work area's right and bottom edges.
pub(crate) fn lower_right_quarter(work: Rect) -> Rect {
    Rect { left: work.left + work.width() / 2, top: work.top + work.height() / 2, right: work.right, bottom: work.bottom }
}

fn act_now(app: &tauri::AppHandle, id: &str, action: Action) -> Result<(), String> {
    let held = {
        let list = HELD.lock().map_err(|_| FAILED.to_string())?;
        pick(&list, id).cloned().ok_or_else(|| MISSING.to_string())?
    };
    let path = resolve(&held).map_err(str::to_string)?;
    match action {
        Action::Open => open_and_place(app, path),
        Action::Folder => show_in_folder(&path),
        Action::Copy => copy_file(&path),
        Action::CopyPath => copy_text(&path),
        Action::Trash => recycle(&path).map_err(|_| NOT_RECYCLED.to_string()),
        Action::Edit | Action::Pin | Action::Ocr => {
            // Pictures only: ShareX cannot edit, pin or read a recording.
            if held.kind != Kind::Image {
                return Err(REFUSED.to_string());
            }
            launch_sharex(action, &path)
        }
    }
}

fn launch_sharex(action: Action, path: &str) -> Result<(), String> {
    let task = action.sharex().ok_or_else(|| REFUSED.to_string())?;
    #[cfg(windows)]
    {
        use crate::wall2_keys::Refusal;
        crate::wall2_sharex::launch_file(task, path).map_err(|r| (if r == Refusal::NotInstalled { NOT_INSTALLED } else { FAILED }).to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = (task, path);
        Err(FAILED.to_string())
    }
}

/// Open with the default app, then (on Windows) move the app's new window to the lower right
/// quarter of the primary monitor. The move runs on its own thread and gives up after about three
/// seconds. Only a new window titled with the file's name is moved; if none shows, nothing is.
fn open_and_place(app: &tauri::AppHandle, path: String) -> Result<(), String> {
    #[cfg(windows)]
    let (before, stem) = (place::snapshot(), file_stem_of(&path));
    app.opener().open_path(path, None::<&str>).map_err(|_| FAILED.to_string())?;
    #[cfg(windows)]
    {
        let _ = std::thread::Builder::new().name("wall2-cap-place".into()).spawn(move || place::after_open(&before, &stem));
    }
    Ok(())
}

/// The file's path text on the clipboard.
pub(crate) fn copy_text(text: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        place::set_clipboard_text(text).map_err(|_| FAILED.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = text;
        Err(FAILED.to_string())
    }
}

/// Move the file to the Recycle Bin (with undo), no dialogs. Never a permanent delete: when the bin
/// cannot take the file the answer is an error and the file stays.
fn recycle(path: &str) -> Result<(), ()> {
    #[cfg(windows)]
    {
        place::recycle(path)
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err(())
    }
}

/// The new window an open made: one that was not in the snapshot and whose title holds the opened
/// file's name (its stem, any case). Nothing else is ever moved: a changed front window or a
/// window with another title is left alone.
pub(crate) fn pick_new_window(windows: &[(isize, String)], before: &HashSet<isize>, stem: &str) -> Option<isize> {
    let stem = stem.trim().to_lowercase();
    if stem.is_empty() {
        return None;
    }
    windows.iter().find(|(h, title)| !before.contains(h) && title.to_lowercase().contains(&stem)).map(|(h, _)| *h)
}

/// The file name without its extension, for matching a window title.
fn file_stem_of(path: &str) -> String {
    Path::new(path).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

#[cfg(windows)]
mod place {
    use super::{lower_right_quarter, pick_new_window};
    use crate::wall2_winutil::sys;
    use std::collections::HashSet;
    use std::time::{Duration, Instant};
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
    use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData};
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::Storage::FileSystem::GetDriveTypeW;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, IBindCtx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{FileOperation, IFileOperation, IFileOperationProgressSink, IShellItem, SHCreateItemFromParsingName, FOFX_EARLYFAILURE, FOFX_RECYCLEONDELETE, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT};
    use windows::Win32::UI::WindowsAndMessaging::{GetWindow, GetWindowLongW, InternalGetWindowText, IsWindowVisible, GWL_EXSTYLE, GW_OWNER, WS_EX_TOOLWINDOW};

    /// The windows as they were just before the open.
    pub struct Before {
        windows: HashSet<isize>,
    }

    pub fn snapshot() -> Before {
        Before { windows: sys::top_level_windows().into_iter().collect() }
    }

    fn title_of(h: isize) -> String {
        let mut buf = [0u16; 256];
        let n = unsafe { InternalGetWindowText(sys::hwnd(h), &mut buf) };
        String::from_utf16_lossy(&buf[..(n.max(0) as usize).min(buf.len())])
    }

    /// A window the open could have made: ordinary, visible, shown, titled, in no shell or own
    /// process, and one this app is allowed to move.
    fn movable(h: isize, self_elevated: bool) -> bool {
        let hw = sys::hwnd(h);
        let pid = sys::pid_of(h);
        unsafe {
            if !IsWindowVisible(hw).as_bool() {
                return false;
            }
            let mut cloaked = 0u32;
            let _ = DwmGetWindowAttribute(hw, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut std::ffi::c_void, 4);
            let owned = GetWindow(hw, GW_OWNER).map(|o| !o.0.is_null()).unwrap_or(false);
            let tool = GetWindowLongW(hw, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW.0 != 0;
            cloaked == 0
                && !owned
                && !tool
                && sys::has_title(h)
                && pid != std::process::id()
                && !crate::wall2_winutil::is_shell_class(&sys::class_name(h))
                && !sys::out_of_reach(pid, self_elevated)
        }
    }

    /// The new window: one that was not there before, is movable and is titled with the file's name.
    fn find(before: &Before, stem: &str, self_elevated: bool) -> Option<isize> {
        let fresh: Vec<(isize, String)> = sys::top_level_windows().into_iter().filter(|h| !before.windows.contains(h) && movable(*h, self_elevated)).map(|h| (h, title_of(h))).collect();
        pick_new_window(&fresh, &before.windows, stem)
    }

    /// Wait up to about three seconds for the window, then move it twice (an app often resizes
    /// itself once it has loaded the picture).
    pub fn after_open(before: &Before, stem: &str) {
        let self_elevated = sys::self_elevated();
        let until = Instant::now() + Duration::from_millis(3_000);
        while Instant::now() < until {
            std::thread::sleep(Duration::from_millis(100));
            let Some(h) = find(before, stem, self_elevated) else { continue };
            let Some(work) = crate::wall2_arrange::primary_work_area() else { return };
            let target = lower_right_quarter(work);
            if crate::wall2_arrange::move_outer(h, target) {
                std::thread::sleep(Duration::from_millis(500));
                let _ = crate::wall2_arrange::move_outer(h, target);
            }
            return;
        }
    }

    /// Text on the clipboard (CF_UNICODETEXT).
    pub fn set_clipboard_text(text: &str) -> Result<(), ()> {
        const CF_UNICODETEXT: u32 = 13;
        let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
        let bytes = wide.len() * 2;
        unsafe {
            let hglobal = GlobalAlloc(GMEM_MOVEABLE, bytes).map_err(|_| ())?;
            let ptr = GlobalLock(hglobal) as *mut u8;
            if ptr.is_null() {
                let _ = windows::Win32::Foundation::GlobalFree(hglobal);
                return Err(());
            }
            std::ptr::copy_nonoverlapping(wide.as_ptr() as *const u8, ptr, bytes);
            let _ = GlobalUnlock(hglobal);
            if OpenClipboard(None).is_err() {
                let _ = windows::Win32::Foundation::GlobalFree(hglobal);
                return Err(());
            }
            let _ = EmptyClipboard();
            let set = SetClipboardData(CF_UNICODETEXT, HANDLE(hglobal.0));
            let _ = CloseClipboard();
            if set.is_err() {
                let _ = windows::Win32::Foundation::GlobalFree(hglobal);
                return Err(());
            }
        }
        Ok(())
    }

    /// One file to the Recycle Bin, never a permanent delete. `FOFX_RECYCLEONDELETE` makes the operation
    /// fail (rather than delete for good) when the bin cannot take the file; a path that is not on a
    /// fixed local drive is refused before anything runs. Runs on a COM thread of its own.
    pub fn recycle(path: &str) -> Result<(), ()> {
        const DRIVE_FIXED: u32 = 3;
        let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        let bytes = path.as_bytes();
        // "C:\..." only: a drive letter, a colon and a backslash (no UNC, no device path).
        if bytes.len() < 4 || !bytes[0].is_ascii_alphabetic() || bytes[1] != b':' || bytes[2] != b'\\' {
            return Err(());
        }
        let root: Vec<u16> = [bytes[0] as u16, b':' as u16, b'\\' as u16, 0].to_vec();
        if unsafe { GetDriveTypeW(windows::core::PCWSTR(root.as_ptr())) } != DRIVE_FIXED {
            return Err(());
        }
        let work = move || -> Result<(), ()> {
            unsafe {
                let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
                if init.is_err() {
                    return Err(());
                }
                let result = (|| -> windows::core::Result<bool> {
                    let op: IFileOperation = CoCreateInstance(&FileOperation, None, CLSCTX_ALL)?;
                    op.SetOperationFlags(FOFX_RECYCLEONDELETE | FOFX_EARLYFAILURE | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI)?;
                    let item: IShellItem = SHCreateItemFromParsingName(windows::core::PCWSTR(wide.as_ptr()), None::<&IBindCtx>)?;
                    op.DeleteItem(&item, None::<&IFileOperationProgressSink>)?;
                    op.PerformOperations()?;
                    Ok(op.GetAnyOperationsAborted()?.as_bool())
                })();
                CoUninitialize();
                match result {
                    Ok(false) => Ok(()),
                    _ => Err(()),
                }
            }
        };
        std::thread::Builder::new().name("wall2-cap-recycle".into()).spawn(work).map_err(|_| ())?.join().map_err(|_| ())?
    }
}

/// Explorer with the file selected. The path is always quoted (it was refused earlier if it
/// held a quote), so a space or a comma in it cannot split the argument.
pub(crate) fn show_in_folder(path: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe")
            .raw_arg(format!("/select,\"{path}\""))
            .spawn()
            .map(|_| ())
            .map_err(|_| FAILED.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err(FAILED.to_string())
    }
}

/// The file on the clipboard as a file (the same CF_HDROP copy the old app's file list uses).
fn copy_file(path: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        crate::copy_path_hdrop(path).map_err(|_| FAILED.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err(FAILED.to_string())
    }
}

/// The calling window first.
fn check(label: &str) -> Result<(), String> {
    crate::wall2_meet::require_wall2(label)
}

/// The newest captures from ShareX's history, newest first, at most 30.
#[tauri::command]
pub async fn wall2_captures_list(window: tauri::WebviewWindow) -> Result<Vec<CaptureEntry>, String> {
    check(window.label())?;
    tauri::async_runtime::spawn_blocking(list_now).await.map_err(|_| FAILED.to_string())?
}

/// A picture or GIF as a data URL (at most 6 MB), by id.
#[tauri::command]
pub async fn wall2_captures_thumb(window: tauri::WebviewWindow, id: String) -> Result<String, String> {
    check(window.label())?;
    tauri::async_runtime::spawn_blocking(move || thumb_now(&id)).await.map_err(|_| FAILED.to_string())?
}

/// One of the eight fixed action words for a capture, by id.
#[tauri::command]
pub async fn wall2_captures_act(window: tauri::WebviewWindow, app: tauri::AppHandle, id: String, action: String) -> Result<(), String> {
    check(window.label())?;
    let action = Action::parse(&action).ok_or_else(|| REFUSED.to_string())?;
    tauri::async_runtime::spawn_blocking(move || act_now(&app, &id, action)).await.map_err(|_| FAILED.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];

    fn entry(path: &str, when: &str, title: &str, app: &str) -> String {
        let p = path.replace('\\', "\\\\");
        let name = path.rsplit('\\').next().unwrap();
        format!(
            r#"{{"FileName":"{name}","FilePath":"{p}","DateTime":"{when}","Type":"Image","Host":"File","URL":"","Tags":{{"WindowTitle":"{title}","ProcessName":"{app}"}}}}"#
        )
    }

    const A: &str = r"C:\Users\example\Documents\ShareX\Screenshots\2026-11\shot-a.png";
    const B: &str = r"C:\Users\example\Documents\ShareX\Screenshots\2026-11\clip-b.gif";
    const C: &str = r"C:\Users\example\Documents\ShareX\Screenshots\2026-11\rec-c.mp4";

    #[test]
    fn no_key_means_no_keyed_id() {
        assert_eq!(id_with(None, "C:\\a.mp4", 1, 2), None);
        let k = [7u8; 32];
        let a = id_with(Some(&k), "C:\\a.mp4", 1, 2).unwrap();
        assert_eq!(a.len(), 16);
        assert_eq!(Some(a.clone()), id_with(Some(&k), "C:\\a.mp4", 1, 2));
        assert_ne!(Some(a), id_with(Some(&[8u8; 32]), "C:\\a.mp4", 1, 2));
    }

    #[test]
    fn parses_a_closed_array() {
        let text = format!("[\n{},\n{}\n]", entry(A, "2026-11-11T10:24:00.5-08:00", "Report", "app"), entry(B, "2026-11-11T11:00:00Z", "Flow", "tool"));
        let got = parse_history(&text);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].path, A);
        assert_eq!(got[0].file_name, "shot-a.png");
        assert_eq!(got[0].title, "Report");
        assert_eq!(got[1].app, "tool");
    }

    #[test]
    fn parses_an_array_missing_its_closing_bracket() {
        let text = format!("[\n{},\n{}", entry(A, "2026-11-11T10:24:00Z", "", ""), entry(B, "2026-11-11T10:25:00Z", "", ""));
        assert_eq!(parse_history(&text).len(), 2);
    }

    #[test]
    fn drops_a_half_written_last_entry() {
        let text = format!("[{},\n{{\"FileName\":\"x.png\",\"FileP", entry(A, "2026-11-11T10:24:00Z", "", ""));
        let got = parse_history(&text);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].path, A);
    }

    #[test]
    fn parses_objects_with_no_brackets() {
        let text = format!("{},\n{}\n", entry(A, "2026-11-11T10:24:00Z", "", ""), entry(C, "2026-11-11T10:26:00Z", "", ""));
        assert_eq!(parse_history(&text).len(), 2);
    }

    #[test]
    fn parses_after_a_byte_order_mark_and_with_lower_case_keys() {
        let text = format!("\u{feff}[{}]", entry(A, "2026-11-11T10:24:00Z", "T", "a").replace("FilePath", "filepath").replace("DateTime", "datetime"));
        let got = parse_history(&text);
        assert_eq!(got.len(), 1);
        assert!(got[0].time > 0);
    }

    #[test]
    fn skips_entries_without_a_file_and_nulls_in_tags() {
        let text = r#"[{"Type":"Text","Tags":null},{"FilePath":"C:\\Users\\example\\a.png","Tags":null}]"#;
        let got = parse_history(text);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].title, "");
        assert_eq!(got[0].time, 0);
        assert!(parse_history("").is_empty());
        assert!(parse_history("not json").is_empty());
    }

    #[test]
    fn caps_the_title_and_app_and_drops_control_characters() {
        let long = "T".repeat(300);
        let text = entry(A, "2026-11-11T10:24:00Z", &long, &"P".repeat(100));
        let got = parse_history(&text);
        assert_eq!(got[0].title.chars().count(), TITLE_CHARS);
        assert_eq!(got[0].app.chars().count(), APP_CHARS);
        assert_eq!(cap_chars("a\u{7}b\n c ", 10), "ab c");
    }

    #[test]
    fn newest_sorts_by_time_and_caps_the_count() {
        let all = vec![
            Parsed { path: A.into(), file_name: "a".into(), title: "".into(), app: "".into(), time: 10 },
            Parsed { path: B.into(), file_name: "b".into(), title: "".into(), app: "".into(), time: 30 },
            Parsed { path: C.into(), file_name: "c".into(), title: "".into(), app: "".into(), time: 20 },
        ];
        let got = newest(all.clone(), 2);
        assert_eq!(got.iter().map(|p| p.time).collect::<Vec<_>>(), vec![30, 20]);
        let mut many = Vec::new();
        for i in 0..40 {
            many.push(Parsed { path: A.into(), file_name: "a".into(), title: "".into(), app: "".into(), time: i });
        }
        assert_eq!(newest(many, MAX_ENTRIES).len(), 30);
        assert_eq!(MAX_ENTRIES, 30);
    }

    #[test]
    fn newest_keeps_the_later_line_on_a_tie_first() {
        let mk = |p: &str| Parsed { path: p.into(), file_name: "".into(), title: "".into(), app: "".into(), time: 5 };
        let got = newest(vec![mk(A), mk(B)], 5);
        assert_eq!(got[0].path, B);
    }

    #[test]
    fn newest_drops_paths_that_do_not_pass() {
        let mk = |p: &str| Parsed { path: p.into(), file_name: "".into(), title: "".into(), app: "".into(), time: 5 };
        let all = vec![mk(r"\\server\share\a.png"), mk(r"\\?\C:\a.png"), mk("a.png"), mk(r"C:\Users\example\notes.txt"), mk(A)];
        let got = newest(all, 5);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].path, A);
    }

    #[test]
    fn local_path_text_checks() {
        assert!(plain_local_path(A));
        assert!(plain_local_path(r"D:\a b\c.png"));
        for bad in [
            r"\\server\share\a.png",
            r"\\?\C:\Users\a.png",
            r"\\.\C:\a.png",
            "C:/Users/a.png",
            "https://example.com/a.png",
            "file:///C:/a.png",
            r"C:a.png",
            r"a.png",
            r"C:\Users\..\a.png",
            r"C:\Users\\a.png",
            r"C:\Users\a.png:stream",
            "C:\\Users\\a\u{0}.png",
            r"C:\Users\a*.png",
            r"C:\",
            "",
        ] {
            assert!(!plain_local_path(bad), "{bad}");
        }
    }

    #[test]
    fn extension_checks() {
        assert_eq!(kind_of("a.PNG"), Kind::Image);
        assert_eq!(kind_of("a.jpeg"), Kind::Image);
        assert_eq!(kind_of("a.gif"), Kind::Gif);
        assert_eq!(kind_of("a.mkv"), Kind::Video);
        assert_eq!(kind_of("a.MOV"), Kind::Video);
        assert_eq!(kind_of("a.avi"), Kind::Video);
        assert_eq!(kind_of("a.exe"), Kind::Other);
        assert_eq!(kind_of("a.png.exe"), Kind::Other);
        assert_eq!(kind_of("png"), Kind::Other);
        assert!(allowed_path(B));
        assert!(!allowed_path(r"C:\Users\example\run.bat"));
        assert!(!allowed_path(r"\\server\share\a.png"));
    }

    #[test]
    fn times_parse_to_epoch_milliseconds() {
        assert_eq!(parse_time_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_time_ms("1970-01-02T00:00:00.5Z"), Some(86_400_500));
        assert_eq!(parse_time_ms("2026-11-11T10:24:00.1234567-08:00"), Some(1_794_421_440_123));
        assert_eq!(parse_time_ms("2026-11-11T18:24:00"), Some(1_794_421_440_000));
        assert_eq!(parse_time_ms("2026-11-11 18:24:00+0000"), Some(1_794_421_440_000));
        assert_eq!(parse_time_ms("2026-13-11T18:24:00Z"), None);
        assert_eq!(parse_time_ms("yesterday"), None);
        assert_eq!(parse_time_ms("2026-11-11T18:24:00+x"), None);
    }

    #[test]
    fn a_middle_read_starts_at_the_first_whole_entry() {
        let text = "cut\":\"x\"}\n  },\n  {\n    \"FileName\": \"a.png\"\n  }\n]";
        assert!(from_first_entry(text).starts_with("  {\n    \"FileName\""));
        assert_eq!(from_first_entry("mid\"},{\"FileName\":\"a.png\"}"), "{\"FileName\":\"a.png\"}");
        assert_eq!(from_first_entry("nothing here"), "");
    }

    fn env(k: &str) -> Option<String> {
        (k == "USERPROFILE").then(|| r"C:\Users\example".to_string())
    }

    #[test]
    fn variables_expand_only_when_known() {
        assert_eq!(expand_vars(r"%USERPROFILE%\Docs", &env), r"C:\Users\example\Docs");
        assert_eq!(expand_vars(r"%NOPE%\Docs", &env), r"%NOPE%\Docs");
        assert_eq!(expand_vars("50% done", &env), "50% done");
    }

    #[test]
    fn personal_folder_takes_the_first_line_when_it_is_local() {
        assert_eq!(personal_folder("%USERPROFILE%\\Cloud\\ShareX\r\nignored", &env), Some(r"C:\Users\example\Cloud\ShareX".to_string()));
        assert_eq!(personal_folder(r"D:\Captures\", &env), Some(r"D:\Captures".to_string()));
        assert_eq!(personal_folder(r"\\server\share\ShareX", &env), None);
        assert_eq!(personal_folder(r"Relative\ShareX", &env), None);
        assert_eq!(personal_folder("", &env), None);
    }

    #[test]
    fn candidates_put_a_personal_folder_first_and_the_default_last() {
        let read = |p: &str| (p == r"C:\Users\example\Documents\ShareX\PersonalPath.cfg").then(|| r"D:\Captures".to_string());
        let got = history_candidates(Some(r"C:\Users\example\Documents"), Some(r"C:\Tools\ShareX"), &read, &env);
        assert_eq!(
            got,
            vec![
                r"D:\Captures\History.db".to_string(),
                r"D:\Captures\History.json".to_string(),
                r"C:\Users\example\Documents\ShareX\History.db".to_string(),
                r"C:\Users\example\Documents\ShareX\History.json".to_string()
            ]
        );
        let none = |_: &str| None;
        assert_eq!(history_candidates(Some(r"C:\Users\example\Documents"), None, &none, &env), vec![r"C:\Users\example\Documents\ShareX\History.db".to_string(), r"C:\Users\example\Documents\ShareX\History.json".to_string()]);
        assert!(history_candidates(None, None, &none, &env).is_empty());
    }

    #[test]
    fn an_install_folder_config_is_followed() {
        let read = |p: &str| (p == r"C:\Tools\ShareX\PersonalPath.cfg").then(|| r"E:\Portable".to_string());
        let got = history_candidates(Some(r"C:\Users\example\Documents"), Some(r"C:\Tools\ShareX\"), &read, &env);
        assert_eq!(got[0], r"E:\Portable\History.db");
    }

    static DB_N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

    fn temp_db(setup: &str) -> std::path::PathBuf {
        let n = DB_N.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos());
        let dir = std::env::temp_dir().join(format!("wall2-db-test-{}-{stamp}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("History.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(setup).unwrap();
        path
    }

    const SCHEMA: &str = "CREATE TABLE History (Id INTEGER PRIMARY KEY, FileName TEXT, FilePath TEXT, DateTime TEXT, Tags TEXT);";

    #[test]
    fn a_history_db_reads_oldest_first_with_tags() {
        let sql = format!(
            "{SCHEMA} INSERT INTO History VALUES (1,'a.png','C:\\x\\a.png','2026-11-01T10:00:00.0000000-05:00','{{\"WindowTitle\":\"Win\",\"ProcessName\":\"app\"}}');
             INSERT INTO History VALUES (2,'b.png','C:\\x\\b.png','2026-11-02T10:00:00.0000000-05:00',NULL);
             INSERT INTO History VALUES (3,'','','2026-11-03T10:00:00.0000000-05:00',NULL);"
        );
        let got = read_db(&temp_db(&sql)).unwrap();
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].file_name, "a.png");
        assert_eq!(got[0].title, "Win");
        assert_eq!(got[0].app, "app");
        assert_eq!(got[0].path, r"C:\x\a.png");
        assert!(got[0].time > 0 && got[0].time < got[1].time);
        assert_eq!(got[1].file_name, "b.png");
        assert_eq!(got[1].title, "");
        let shown = newest(got, 12);
        assert_eq!(shown[0].file_name, "b.png");
    }

    #[test]
    fn a_history_db_reads_only_its_newest_rows() {
        let mut sql = SCHEMA.to_string();
        for i in 1..=250 {
            sql.push_str(&format!("INSERT INTO History VALUES ({i},'f{i}.png','C:\\x\\f{i}.png','2026-11-01T10:00:00.0000000-05:00',NULL);"));
        }
        let got = read_db(&temp_db(&sql)).unwrap();
        assert_eq!(got.len(), 200);
        assert_eq!(got[199].file_name, "f250.png");
    }

    #[test]
    fn a_db_without_the_history_table_is_an_error_not_a_panic() {
        assert!(read_db(&temp_db("CREATE TABLE Other (Id INTEGER);")).is_err());
        assert!(read_db(&temp_db("CREATE TABLE History (Id INTEGER, FileName TEXT);")).is_err());
        assert!(read_db(Path::new("no-such-dir-wall2/History.db")).is_err());
    }

    #[test]
    fn history_db_is_tried_before_history_json_in_a_folder() {
        let none = |_: &str| None;
        let cands = history_candidates(Some(r"C:\Users\example\Documents"), None, &none, &env);
        let both = |_: &str| true;
        assert_eq!(cands.iter().find(|p| both(p)).unwrap(), r"C:\Users\example\Documents\ShareX\History.db");
        let json_only = |p: &str| p.ends_with("History.json");
        assert_eq!(cands.iter().find(|p| json_only(p)).unwrap(), r"C:\Users\example\Documents\ShareX\History.json");
    }

    #[test]
    fn read_history_picks_the_reader_by_extension() {
        let db = temp_db(&format!("{SCHEMA} INSERT INTO History VALUES (1,'a.png','C:\\x\\a.png','2026-11-01T10:00:00.0000000-05:00',NULL);"));
        let dir = db.parent().unwrap();
        let json = dir.join("History.json");
        std::fs::write(&json, format!("[{}]", entry(B, "2026-11-01T10:00:00.0000000-05:00", "", ""))).unwrap();
        assert_eq!(read_history(db.to_str().unwrap()).unwrap()[0].file_name, "a.png");
        assert_eq!(read_history(json.to_str().unwrap()).unwrap()[0].file_name, "clip-b.gif");
    }

    #[test]
    fn an_unreadable_history_file_falls_through_to_the_next() {
        let files = vec!["a.db".to_string(), "b.json".to_string()];
        let first_bad = |f: &str| if f == "a.db" { Err(()) } else { Ok(Vec::new()) };
        assert!(read_first(&files, &first_bad).is_ok());
        let all_bad = |_: &str| Err(());
        assert!(read_first(&files, &all_bad).is_err());
        let busy = |f: &str| if f == "a.db" { Ok(Vec::new()) } else { panic!("busy db must not fall back") };
        assert!(read_first(&files, &busy).is_ok());
        assert!(read_first(&[], &busy).is_err());
    }

    #[test]
    fn a_non_text_cell_skips_its_row_only() {
        let sql = format!(
            "{SCHEMA} INSERT INTO History VALUES (1,'a.png','C:\\x\\a.png','2026-11-01T10:00:00.0000000-05:00',5);
             INSERT INTO History VALUES (2,X'07','C:\\x\\b.png','2026-11-02T10:00:00.0000000-05:00',NULL);"
        );
        let got = read_db(&temp_db(&sql)).unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].file_name, "a.png");
    }

    #[test]
    fn thumbnails_need_the_right_bytes_and_a_small_file() {
        let url = data_url("a.png", PNG).unwrap();
        assert!(url.starts_with("data:image/png;base64,"));
        assert_eq!(data_url("a.png", b"GIF89a....."), Err(NOT_IMAGE));
        assert!(data_url("a.gif", b"GIF89a....").is_ok());
        assert!(data_url("a.jpg", &[0xFF, 0xD8, 0xFF, 0xE0]).is_ok());
        assert!(data_url("a.webp", b"RIFF\0\0\0\0WEBPVP8 ").is_ok());
        assert!(data_url("a.bmp", b"BM\0\0").is_ok());
        assert_eq!(data_url("a.mp4", b"\0\0\0\0ftyp"), Err(NOT_IMAGE));
        let big = vec![0x89u8; (MAX_THUMB + 1) as usize];
        assert_eq!(data_url("a.png", &big), Err(TOO_BIG));
        let edge = {
            let mut v = PNG.to_vec();
            v.resize(MAX_THUMB as usize, 0);
            v
        };
        assert!(data_url("a.png", &edge).is_ok());
    }

    #[test]
    fn actions_are_exactly_eight_words() {
        assert_eq!(Action::parse("open"), Some(Action::Open));
        assert_eq!(Action::parse("copy"), Some(Action::Copy));
        assert_eq!(Action::parse("folder"), Some(Action::Folder));
        assert_eq!(Action::parse("path"), Some(Action::CopyPath));
        assert_eq!(Action::parse("edit"), Some(Action::Edit));
        assert_eq!(Action::parse("pin"), Some(Action::Pin));
        assert_eq!(Action::parse("ocr"), Some(Action::Ocr));
        assert_eq!(Action::parse("trash"), Some(Action::Trash));
        for bad in ["", "Open", "open ", "delete", "open,copy", "../x", "Trash", "trash ", "recycle", "image", "-ImageEditor", "ocr -x"] {
            assert_eq!(Action::parse(bad), None, "{bad}");
        }
    }

    fn r(left: i32, top: i32, right: i32, bottom: i32) -> Rect {
        Rect { left, top, right, bottom }
    }

    #[test]
    fn the_open_window_goes_to_the_lower_right_quarter_of_the_work_area() {
        assert_eq!(lower_right_quarter(r(0, 0, 2560, 1400)), r(1280, 700, 2560, 1400));
        // A work area that does not start at the origin (a taskbar on the left, a monitor to the left).
        assert_eq!(lower_right_quarter(r(60, 0, 1980, 1040)), r(1020, 520, 1980, 1040));
        assert_eq!(lower_right_quarter(r(-1920, 30, 0, 1050)), r(-960, 540, 0, 1050));
        // Odd sizes end on the right and bottom edges, and the quarter is never wider than half plus one.
        let q = lower_right_quarter(r(0, 0, 1921, 1081));
        assert_eq!((q.right, q.bottom), (1921, 1081));
        assert_eq!((q.left, q.top), (960, 540));
        assert!(q.width() >= 960 && q.height() >= 540);
    }

    #[test]
    fn only_pictures_get_the_sharex_file_actions() {
        use crate::wall2_sharex::FileTask;
        assert_eq!(Action::Edit.sharex(), Some(FileTask::Edit));
        assert_eq!(Action::Pin.sharex(), Some(FileTask::Pin));
        assert_eq!(Action::Ocr.sharex(), Some(FileTask::Ocr));
        for a in [Action::Open, Action::Copy, Action::Folder, Action::CopyPath, Action::Trash] {
            assert_eq!(a.sharex(), None);
        }
    }

    fn held(path: &str) -> Held {
        Held { path: path.into(), kind: kind_of(path) }
    }

    #[test]
    fn an_unknown_id_picks_nothing() {
        let map = vec![("aaaa".to_string(), held(A))];
        assert!(pick(&map, "aaaa").is_some());
        assert!(pick(&map, "bbbb").is_none());
        assert!(pick::<Held>(&[], "aaaa").is_none());
    }

    #[test]
    fn an_id_is_stable_and_names_the_path_time_and_size() {
        let id = id_for(A, 100, 5);
        assert_eq!(id.len(), 16);
        assert!(id.bytes().all(|b| b.is_ascii_hexdigit()));
        assert_eq!(id, id_for(A, 100, 5));
        assert_ne!(id, id_for(B, 100, 5));
        assert_ne!(id, id_for(A, 101, 5));
        assert_ne!(id, id_for(A, 100, 6));
    }

    #[test]
    fn reads_that_land_out_of_order_still_resolve_each_id_to_its_own_path() {
        let (ia, ib, ic) = (id_for(A, 1, 1), id_for(B, 2, 2), id_for(C, 3, 3));
        let mut map = Vec::new();
        // The newer read (B, C) lands first, then the older read (A, B).
        remember(&mut map, vec![(ib.clone(), held(B)), (ic.clone(), held(C))], MAX_HELD);
        remember(&mut map, vec![(ia.clone(), held(A)), (ib.clone(), held(B))], MAX_HELD);
        assert_eq!(pick(&map, &ia).unwrap().path, A);
        assert_eq!(pick(&map, &ib).unwrap().path, B);
        assert_eq!(pick(&map, &ic).unwrap().path, C);
        assert_eq!(map.len(), 3);
    }

    #[test]
    fn the_map_keeps_only_the_newest_ids() {
        let mut map = Vec::new();
        for i in 0..100u64 {
            remember(&mut map, vec![(id_for(A, i as i64, i), held(A))], MAX_HELD);
        }
        assert_eq!(map.len(), MAX_HELD);
        assert!(pick(&map, &id_for(A, 99, 99)).is_some());
        assert!(pick(&map, &id_for(A, 0, 0)).is_none());
    }

    #[test]
    fn an_entry_with_an_unparseable_time_gets_zero_and_sorts_last() {
        let text = format!(
            "[{},{},{}]",
            entry(A, "not a date", "", ""),
            entry(B, "2026-11-11T10:24:00Z", "", ""),
            entry(C, "2026-11-11T09:00:00Z", "", "")
        );
        let got = parse_history(&text);
        assert_eq!(got[0].time, 0);
        let top = newest(got, 5);
        assert_eq!(top.iter().map(|p| p.path.as_str()).collect::<Vec<_>>(), vec![B, C, A]);
        assert_eq!(top[2].time, 0);
    }

    #[test]
    fn a_history_over_the_cap_reads_only_its_tail() {
        let pad = "x".repeat(1000);
        let row = |path: &str| format!("  {{\n    \"FilePath\": \"{}\",\n    \"Pad\": \"{pad}\"\n  }}", path.replace('\\', "\\\\"));
        let mut text = String::from("[\n");
        text.push_str(&row(r"C:\Users\example\oldest.png"));
        for _ in 0..9000 {
            text.push_str(",\n");
            text.push_str(&row(A));
        }
        text.push_str(",\n");
        text.push_str(&row(r"C:\Users\example\newest.png"));
        text.push_str("\n]");
        assert!(text.len() as u64 > MAX_HISTORY);
        let file = std::env::temp_dir().join(format!("wall2-captures-tail-{}.json", std::process::id()));
        std::fs::write(&file, &text).unwrap();
        let got = read_tail(file.to_str().unwrap());
        let _ = std::fs::remove_file(&file);
        let got = got.unwrap();
        assert!(got.len() as u64 <= MAX_HISTORY);
        let parsed = parse_history(&got);
        assert!(parsed.iter().any(|p| p.path.ends_with("newest.png")));
        assert!(!parsed.iter().any(|p| p.path.ends_with("oldest.png")));
    }

    #[test]
    fn the_page_entry_carries_no_path() {
        let p = Parsed { path: A.into(), file_name: "shot-a.png".into(), title: "Report".into(), app: "app".into(), time: 7 };
        let e = entry_for("abcd".to_string(), &p, Kind::Image, Some(42));
        let json = serde_json::to_string(&e).unwrap();
        assert!(!json.contains("Users") && !json.contains("ShareX") && !json.contains('\\'), "{json}");
        assert!(json.contains("\"fileName\":\"shot-a.png\"") && json.contains("\"exists\":true") && json.contains("\"size\":42"));
        assert!(!entry_for("abcd".to_string(), &p, Kind::Image, None).exists);
    }

    #[test]
    fn resolve_refuses_a_path_that_does_not_pass_before_touching_the_disk() {
        for bad in [r"\\server\share\a.png", r"C:\Users\example\run.bat", "a.png"] {
            assert_eq!(resolve(&Held { path: bad.into(), kind: Kind::Image }), Err(REFUSED), "{bad}");
        }
    }

    #[test]
    fn a_directory_is_not_a_regular_file() {
        let dir = std::env::temp_dir();
        assert_eq!(regular_size(&dir), None);
        assert_eq!(regular_size(&dir.join("wall2-captures-test-no-such-file.png")), None);
    }

    #[test]
    fn only_the_wall_window_may_ask() {
        assert!(check("main").is_err());
        assert!(check("wall2").is_ok());
    }

    #[test]
    fn the_window_check_is_the_first_statement_of_every_command() {
        let src = include_str!("wall2_captures.rs").replace("\r\n", "\n");
        for name in ["wall2_captures_list", "wall2_captures_thumb", "wall2_captures_act"] {
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
        let src = include_str!("wall2_captures.rs").replace("\r\n", "\n");
        let macros = ["print", "eprint", "dbg", "log", "info", "warn", "debug"];
        for m in macros {
            assert!(!src.contains(&format!("{m}!(")), "{m}");
        }
    }

    fn titled(list: &[(isize, &str)]) -> Vec<(isize, String)> {
        list.iter().map(|(h, t)| (*h, t.to_string())).collect()
    }

    #[test]
    fn a_new_window_titled_with_the_file_name_is_the_one() {
        let before: HashSet<isize> = [1, 2].into_iter().collect();
        let windows = titled(&[(1, "Chat"), (5, "Notes"), (7, "SHOT-A.png - Photos")]);
        assert_eq!(pick_new_window(&windows, &before, "shot-a"), Some(7));
    }

    #[test]
    fn a_window_that_was_already_there_is_ignored_even_with_the_name() {
        let before: HashSet<isize> = [1, 7].into_iter().collect();
        let windows = titled(&[(7, "shot-a.png - Photos")]);
        assert_eq!(pick_new_window(&windows, &before, "shot-a"), None);
    }

    #[test]
    fn no_title_match_returns_none() {
        let before: HashSet<isize> = HashSet::new();
        let windows = titled(&[(3, "Inbox"), (4, "Settings")]);
        assert_eq!(pick_new_window(&windows, &before, "shot-a"), None);
        assert_eq!(pick_new_window(&windows, &before, ""), None);
        assert_eq!(pick_new_window(&[], &before, "shot-a"), None);
    }

    // Windows paths: the standard library splits on backslashes only on Windows.
    #[cfg(windows)]
    #[test]
    fn the_file_stem_drops_the_folder_and_extension() {
        assert_eq!(file_stem_of(A), "shot-a");
        assert_eq!(file_stem_of(""), "");
    }

    #[test]
    fn the_bin_never_falls_back_to_a_permanent_delete() {
        let src = include_str!("wall2_captures.rs").replace("\r\n", "\n");
        let old = ["SHFile", "OperationW"].concat();
        let flag = ["FOF_", "ALLOWUNDO"].concat();
        assert!(!src.contains(&old));
        assert!(!src.contains(&flag));
    }
}
