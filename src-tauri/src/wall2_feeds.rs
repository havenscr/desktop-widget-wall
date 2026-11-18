//! Wall 2 home feeds: reads the task app and the home app from Rust.
//!
//! A native request carries no `Origin` or `Sec-Fetch-Site` header, which the task app
//! requires, and the home app sends no CORS headers, so the web view cannot call either.
//! The two base URLs are private. They are read at call time from `feeds.json` in Wall 2's
//! app config directory and never written to a log, an error message or the repository.

use serde::Serialize;
use serde_json::Value;
use std::io::Read;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

/// Error text the front end treats as "Not set up".
pub(crate) const NOT_CONFIGURED: &str = "not-configured";
const MAX_BODY: u64 = 1_000_000;
const TIMEOUT: Duration = Duration::from_secs(8);
const MAX_TITLE_CHARS: usize = 200;
const TASK_LIMIT: usize = 3;
const PORTAL_SUFFIX: &str = ".firewalla.net";
const ACTIONS: [&str; 3] = ["reviewed", "name", "revoke-key"];

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TaskItem {
    pub id: String,
    pub title: String,
    pub due_at: Option<String>,
    pub due_is_all_day: bool,
    pub quadrant: Option<String>,
    /// Effort estimate (the row's `estimate`): `15`, `30`, `45` or `60plus`; None when the task has none.
    pub est: Option<String>,
    /// Up to three of the row's tags, shaped for display (see `shape_tags`).
    pub tags: Vec<TaskTag>,
}

/// One tag on a task row. `icon` and `color` come from the task app's tag list and are
/// names only (never markup or CSS); both are None when the list had no usable entry.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TaskTag {
    pub label: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    /// The tag lower-cased: the key into the tag list. Not sent to the page.
    #[serde(skip)]
    key: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirewallaInfo {
    pub api: String,
    pub box_online: Option<bool>,
    pub checked_at: Option<String>,
    pub alarms24h: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecuritySummary {
    pub reachable: bool,
    pub stale: bool,
    pub last_scan: Option<String>,
    pub alerts: u64,
    pub firewalla: Option<FirewallaInfo>,
    pub portal_url: Option<String>,
    /// Up to three of the open alerts as one-line rows, newest first. Empty when the home
    /// app's alerts carry no readable text.
    pub top_alerts: Vec<AlertRow>,
}

/// One open alert, reduced to what the network tile shows on one line.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertRow {
    pub text: String,
    /// `high`, `medium` or `low`; None when the alert names no severity.
    pub severity: Option<String>,
    /// When the alert was raised, epoch milliseconds; None when unreadable.
    pub at_ms: Option<i64>,
}

// Section: configuration

/// A base URL: `http` or `https` (`https` only when `https_only`), a host and an optional
/// port, and nothing else. Returns the normalized base without a trailing slash.
fn validate_base_url(raw: &str, https_only: bool) -> Result<String, String> {
    let bad = || "feeds.json holds an invalid address".to_string();
    let text = raw.trim();
    let rest = if let Some(r) = text.strip_prefix("https://") {
        r
    } else if let Some(r) = text.strip_prefix("http://") {
        if https_only {
            return Err(bad());
        }
        r
    } else {
        return Err(bad());
    };
    if rest.is_empty() || rest.chars().any(|c| matches!(c, '/' | '?' | '#' | '@' | '\\') || c.is_whitespace() || c.is_control()) {
        return Err(bad());
    }
    let (host, port) = if let Some(inner) = rest.strip_prefix('[') {
        let end = inner.find(']').ok_or_else(bad)?;
        let host = &inner[..end];
        if host.is_empty() || !host.chars().all(|c| c.is_ascii_hexdigit() || c == ':' || c == '.') {
            return Err(bad());
        }
        let tail = &inner[end + 1..];
        let port = match tail.strip_prefix(':') {
            Some(p) => Some(p),
            None if tail.is_empty() => None,
            None => return Err(bad()),
        };
        (host, port)
    } else {
        match rest.split_once(':') {
            Some((h, p)) => (h, Some(p)),
            None => (rest, None),
        }
    };
    if !rest.starts_with('[') {
        if host.is_empty() || !host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') {
            return Err(bad());
        }
        if host.starts_with('.') || host.ends_with('.') || host.starts_with('-') {
            return Err(bad());
        }
    }
    if let Some(p) = port {
        let n: u32 = p.parse().map_err(|_| bad())?;
        if !p.chars().all(|c| c.is_ascii_digit()) || n == 0 || n > 65535 {
            return Err(bad());
        }
    }
    Ok(text.to_string())
}

/// Read one key of `feeds.json` text. Missing file content or key is "not configured".
fn base_from_config(json_text: Option<&str>, key: &str, https_only: bool) -> Result<String, String> {
    let text = json_text.ok_or_else(|| NOT_CONFIGURED.to_string())?;
    let value: Value = serde_json::from_str(text).map_err(|_| "feeds.json is not valid JSON".to_string())?;
    match value.get(key).and_then(Value::as_str) {
        Some(s) if !s.trim().is_empty() => validate_base_url(s, https_only),
        _ => Err(NOT_CONFIGURED.to_string()),
    }
}

pub(crate) fn read_base(app: &tauri::AppHandle, key: &str, https_only: bool) -> Result<String, String> {
    let dir = app.path().app_config_dir().map_err(|_| NOT_CONFIGURED.to_string())?;
    let text = std::fs::read_to_string(dir.join("feeds.json")).ok();
    base_from_config(text.as_deref(), key, https_only)
}

// Section: http

pub(crate) fn agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| ureq::AgentBuilder::new().timeout(TIMEOUT).redirects(0).build())
}

pub(crate) fn read_body(resp: ureq::Response) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    resp.into_reader()
        .take(MAX_BODY + 1)
        .read_to_end(&mut buf)
        .map_err(|_| "Could not read the answer".to_string())?;
    if buf.len() as u64 > MAX_BODY {
        return Err("The answer was too large".to_string());
    }
    Ok(buf)
}

/// With redirects off, a 3xx comes back as a success from the client; only 2xx counts here.
fn status_ok(code: u16) -> bool {
    (200..300).contains(&code)
}

pub(crate) fn require_ok(resp: ureq::Response) -> Result<ureq::Response, String> {
    let code = resp.status();
    if status_ok(code) {
        Ok(resp)
    } else {
        Err(format!("The service answered {code}"))
    }
}

pub(crate) fn describe(err: ureq::Error) -> String {
    match err {
        ureq::Error::Status(code, _) => format!("The service answered {code}"),
        ureq::Error::Transport(_) => "Could not reach the service".to_string(),
    }
}

pub(crate) fn get_json(url: &str) -> Result<Value, String> {
    let resp = agent().get(url).set("Accept", "application/json").call().map_err(describe)?;
    let resp = require_ok(resp)?;
    serde_json::from_slice(&read_body(resp)?).map_err(|_| "The answer was not JSON".to_string())
}

// Section: local day

pub(crate) fn now_epoch() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// Seconds the PC's local clock is ahead of UTC at the instant `utc` (daylight saving
/// included). Zero when the system will not say.
#[cfg(windows)]
pub(crate) fn local_offset_secs(utc: i64) -> i64 {
    use windows::Win32::Foundation::SYSTEMTIME;
    use windows::Win32::System::Time::SystemTimeToTzSpecificLocalTime;
    let (y, m, d) = crate::wall2_meet::civil_from_days(utc.div_euclid(86_400));
    let rem = utc.rem_euclid(86_400);
    let universal = SYSTEMTIME {
        wYear: y as u16,
        wMonth: m as u16,
        wDayOfWeek: 0,
        wDay: d as u16,
        wHour: (rem / 3600) as u16,
        wMinute: ((rem % 3600) / 60) as u16,
        wSecond: (rem % 60) as u16,
        wMilliseconds: 0,
    };
    let mut local = SYSTEMTIME::default();
    // SAFETY: both pointers are valid for the call; None means the current time zone.
    if unsafe { SystemTimeToTzSpecificLocalTime(None, &universal, &mut local) }.is_err() {
        return 0;
    }
    let secs = days_from_civil(local.wYear as i64, local.wMonth as i64, local.wDay as i64) * 86_400
        + local.wHour as i64 * 3600
        + local.wMinute as i64 * 60
        + local.wSecond as i64;
    secs - utc
}

#[cfg(not(windows))]
pub(crate) fn local_offset_secs(_utc: i64) -> i64 {
    0
}

/// Epoch seconds of the last local midnight at or before `utc`, given the zone's offset.
pub(crate) fn local_midnight(utc: i64, off: &dyn Fn(i64) -> i64) -> i64 {
    let local = utc + off(utc);
    let midnight_local = local.div_euclid(86_400) * 86_400;
    // The offset can differ between now and midnight (a clock change in between), so ask
    // again at the first guess.
    let guess = midnight_local - off(utc);
    midnight_local - off(guess)
}

// Section: tasks

fn valid_task_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn as_id(v: &Value) -> Option<String> {
    match v {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// `est` as the wall shows it: `15`, `30`, `45` or `60plus`. Text or a number is read;
/// anything else is None. A number of 60 or more is `60plus`.
fn read_est(v: Option<&Value>) -> Option<String> {
    let minutes = match v? {
        Value::String(s) => match s.trim() {
            "60plus" => return Some("60plus".to_string()),
            other => other.parse::<u64>().ok()?,
        },
        Value::Number(n) => n.as_u64()?,
        _ => return None,
    };
    match minutes {
        15 | 30 | 45 => Some(minutes.to_string()),
        m if m >= 60 => Some("60plus".to_string()),
        _ => None,
    }
}

/// Minutes an `est` counts for in a sum (`60plus` counts as 60).
fn est_minutes(est: Option<&str>) -> u64 {
    match est {
        Some("15") => 15,
        Some("30") => 30,
        Some("45") => 45,
        Some("60plus") => 60,
        _ => 0,
    }
}

/// What `wall2_tasks_summary` keeps. Every field is optional.
#[derive(Debug, Default, Clone, Copy)]
struct Filters<'a> {
    /// Keep tasks whose `tags` contains this (case ignored).
    tag: Option<&'a str>,
    /// Drop tasks whose `tags` contains this (case ignored).
    not_tag: Option<&'a str>,
    /// Keep tasks whose `bucket_id` is this id.
    bucket_id: Option<&'a str>,
}

fn has_tag(t: &Value, want: &str) -> bool {
    t.get("tags")
        .and_then(Value::as_array)
        .is_some_and(|tags| tags.iter().filter_map(Value::as_str).any(|have| have.trim().eq_ignore_ascii_case(want)))
}

/// Open tasks only (`kind` task, `status` open), every one in server order, narrowed by the filters.
fn open_tasks(body: &Value, f: Filters) -> Vec<TaskItem> {
    let Some(rows) = body.get("tasks").and_then(Value::as_array) else {
        return Vec::new();
    };
    rows.iter()
        .filter(|t| t.get("kind").and_then(Value::as_str) == Some("task") && t.get("status").and_then(Value::as_str) == Some("open"))
        .filter(|t| f.tag.map_or(true, |want| has_tag(t, want)))
        .filter(|t| f.not_tag.map_or(true, |want| !has_tag(t, want)))
        .filter(|t| f.bucket_id.map_or(true, |id| t.get("bucket_id").and_then(Value::as_str) == Some(id)))
        .filter_map(|t| {
            let id = as_id(t.get("id")?)?;
            let raw_title = t.get("title").and_then(Value::as_str).unwrap_or("");
            let title: String = raw_title.chars().take(MAX_TITLE_CHARS).collect();
            Some(TaskItem {
                id,
                title,
                due_at: t.get("due_at").and_then(Value::as_str).map(str::to_string),
                due_is_all_day: t.get("due_is_all_day").and_then(Value::as_bool).unwrap_or(false),
                quadrant: t.get("quadrant").and_then(Value::as_str).map(str::to_string),
                est: read_est(t.get("estimate")),
                tags: shape_tags(t.get("tags"), f.tag),
            })
        })
        .collect()
}

// Section: task tags

/// Tags a row shows at most.
const MAX_ROW_TAGS: usize = 3;
/// Characters a displayed tag may have.
const MAX_TAG_CHARS: usize = 40;
/// Entries kept from the task app's tag list.
const MAX_TAG_META: usize = 200;
/// How long the last good tag list is reused before it is read again.
const TAG_META_TTL_SECS: i64 = 600;
/// After a failed tag list read, how long before the next try (the tasks read still goes on).
const TAG_META_RETRY_SECS: i64 = 60;
/// How long the last good tag list keeps serving when every read since has failed.
const TAG_META_KEEP_SECS: i64 = 3600;
/// The task app's colour names; anything else in its tag list is dropped.
const TAG_COLORS: [&str; 11] = ["teal", "blue", "green", "pink", "magenta", "lime", "brown", "slate", "khaki", "orange", "red"];

/// A character a displayed tag or tag name may not hold: a control character, or one of the
/// invisible format characters that can reorder or hide text (direction marks and overrides,
/// isolates, zero width characters, the soft hyphen, the byte order mark).
fn is_unsafe_char(c: char) -> bool {
    c.is_control()
        || matches!(c, '\u{ad}' | '\u{61c}' | '\u{200b}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2060}'..='\u{2064}' | '\u{2066}'..='\u{206f}' | '\u{feff}')
}

/// The tags a row shows: each tag string trimmed, empty ones dropped, those with a control
/// or invisible format character, or over 40 characters, dropped, duplicates dropped after lower-casing, the tag
/// the read filtered by (`drop`, case ignored) dropped, and at most three kept. The rule is
/// looser than `valid_tag` (which guards the filters the page sends): the owner's own tags
/// may carry accents or dots. The text stays plain text; the page never reads it as markup.
fn shape_tags(raw: Option<&Value>, drop: Option<&str>) -> Vec<TaskTag> {
    let Some(list) = raw.and_then(Value::as_array) else {
        return Vec::new();
    };
    let drop = drop.map(|d| d.trim().to_lowercase());
    let mut out: Vec<TaskTag> = Vec::new();
    for name in list.iter().filter_map(Value::as_str) {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > MAX_TAG_CHARS || name.chars().any(is_unsafe_char) {
            continue;
        }
        let key = name.to_lowercase();
        if drop.as_deref() == Some(key.as_str()) || out.iter().any(|t| t.key == key) {
            continue;
        }
        out.push(TaskTag { label: tag_label(name), icon: None, color: None, key });
        if out.len() == MAX_ROW_TAGS {
            break;
        }
    }
    out
}

/// Two letter words that stay in ordinary title case ("To Do", "My Garden"), not capitals.
const SHORT_WORDS: [&str; 26] = [
    "am", "an", "as", "at", "be", "by", "do", "go", "he", "if", "in", "is", "it", "me", "my", "no", "of", "oh", "ok", "on", "or", "so", "to", "up", "us", "we",
];

/// A tag as it reads on the wall. A tag typed with any capital letter keeps its text.
/// Otherwise the first letter of the tag and of each word after a space, slash, hyphen or
/// ampersand is a capital ("r&d" is "R&D": the letters around an ampersand each start a
/// word), with two generic acronym rules: a word of exactly two letters is written in
/// capitals unless it is one of the common words in `SHORT_WORDS`, and a word of up to five
/// letters with no vowel (a, e, i, o, u, y) is written in capitals. There is no table of tag
/// names here; a tag that reads wrong can be given an exception.
fn tag_label(name: &str) -> String {
    if name.chars().any(char::is_uppercase) {
        return name.to_string();
    }
    let mut out = String::with_capacity(name.len());
    let mut word = String::new();
    let flush = |word: &mut String, out: &mut String| {
        let letters = word.chars().count();
        let all_alpha = word.chars().all(char::is_alphabetic);
        let no_vowel = !word.chars().any(|c| matches!(c, 'a' | 'e' | 'i' | 'o' | 'u' | 'y'));
        let two_letter_acronym = letters == 2 && !SHORT_WORDS.contains(&word.as_str());
        if all_alpha && (two_letter_acronym || ((1..=5).contains(&letters) && no_vowel)) {
            out.extend(word.chars().flat_map(char::to_uppercase));
        } else {
            let mut chars = word.chars();
            if let Some(first) = chars.next() {
                out.extend(first.to_uppercase());
                out.push_str(chars.as_str());
            }
        }
        word.clear();
    };
    for c in name.chars() {
        if matches!(c, ' ' | '/' | '-' | '&') {
            flush(&mut word, &mut out);
            out.push(c);
        } else {
            word.push(c);
        }
    }
    flush(&mut word, &mut out);
    out
}

/// What the task app's tag list says about one tag.
#[derive(Debug, Clone, PartialEq)]
struct TagMeta {
    icon: Option<String>,
    color: Option<String>,
}

type TagMetaMap = std::collections::HashMap<String, TagMeta>;

/// A Tabler icon name: 1 to 64 of `a-z`, `0-9` and `-`.
fn valid_icon_name(icon: &str) -> bool {
    (1..=64).contains(&icon.len()) && icon.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

/// The task app's `GET /api/tags` answer as a map from lower-cased name to icon and colour.
/// At most 200 entries; an entry that is not an object or has no usable name is dropped; an
/// icon that is not a plain Tabler name and a colour outside the eleven names are dropped
/// from their entry.
fn parse_tag_meta(body: &Value) -> TagMetaMap {
    let mut map = TagMetaMap::new();
    let Some(list) = body.get("tags").and_then(Value::as_array) else {
        return map;
    };
    for entry in list.iter().take(MAX_TAG_META) {
        let Some(obj) = entry.as_object() else {
            continue;
        };
        let Some(name) = obj.get("name").and_then(Value::as_str) else {
            continue;
        };
        let key = name.trim().to_lowercase();
        if key.is_empty() || key.chars().count() > MAX_TAG_CHARS || key.chars().any(is_unsafe_char) {
            continue;
        }
        let icon = obj.get("icon").and_then(Value::as_str).filter(|i| valid_icon_name(i)).map(str::to_string);
        let color = obj.get("color").and_then(Value::as_str).filter(|c| TAG_COLORS.contains(c)).map(str::to_string);
        map.insert(key, TagMeta { icon, color });
    }
    map
}

/// Give every row tag its icon and colour from the tag list (matched by lower-cased name).
fn join_tag_meta(tasks: &mut [TaskItem], meta: &TagMetaMap) {
    for tag in tasks.iter_mut().flat_map(|t| t.tags.iter_mut()) {
        if let Some(m) = meta.get(&tag.key) {
            tag.icon = m.icon.clone();
            tag.color = m.color.clone();
        }
    }
}

/// The last good tag list and when it was read or last failed (epoch seconds).
#[derive(Default)]
struct TagCache {
    map: TagMetaMap,
    good_at: Option<i64>,
    failed_at: Option<i64>,
}

static TAG_CACHE: Mutex<Option<TagCache>> = Mutex::new(None);

/// Whether the tag list should be read now: never read, or the good copy is ten minutes
/// old, and not within a minute of a failed attempt.
fn tag_meta_due(now: i64, good_at: Option<i64>, failed_at: Option<i64>) -> bool {
    if failed_at.is_some_and(|f| now - f < TAG_META_RETRY_SECS) {
        return false;
    }
    good_at.map_or(true, |g| now - g >= TAG_META_TTL_SECS)
}

/// The task app's tag list for the rows in `tasks`, from memory when it is under ten
/// minutes old. A failed read never fails the tasks read: the last good list keeps serving
/// for at most an hour from when it was read, after which the rows carry their tags with no
/// icon and no colour until a read works. Not read at all when no row has a tag.
fn tag_meta_for(base: &str, tasks: &[TaskItem]) -> TagMetaMap {
    tag_meta_with(&TAG_CACHE, now_epoch(), tasks, &|| get_json(&format!("{base}/api/tags")))
}

/// `tag_meta_for` with its cache, clock and read handed in, so a test can drive the real
/// decisions: a good read, time passing, a failed read, more time passing.
fn tag_meta_with(cache: &Mutex<Option<TagCache>>, now: i64, tasks: &[TaskItem], fetch: &dyn Fn() -> Result<Value, String>) -> TagMetaMap {
    if tasks.iter().all(|t| t.tags.is_empty()) {
        return TagMetaMap::new();
    }
    // What the cache can serve now: its list while under an hour old, else nothing.
    let serve = |c: Option<&TagCache>| match c {
        Some(c) if c.good_at.is_some_and(|g| now - g < TAG_META_KEEP_SECS) => c.map.clone(),
        _ => TagMetaMap::new(),
    };
    let (due, held) = match cache.lock() {
        Ok(guard) => {
            let c = guard.as_ref();
            (tag_meta_due(now, c.and_then(|c| c.good_at), c.and_then(|c| c.failed_at)), serve(c))
        }
        Err(_) => return TagMetaMap::new(),
    };
    if !due {
        return held;
    }
    // The lock is not held across the request, so another read never waits on it.
    let fetched = fetch().map(|body| parse_tag_meta(&body));
    let Ok(mut guard) = cache.lock() else {
        return held;
    };
    let entry = guard.get_or_insert_with(TagCache::default);
    match fetched {
        Ok(map) => {
            entry.map = map;
            entry.good_at = Some(now);
            entry.failed_at = None;
        }
        Err(_) => entry.failed_at = Some(now),
    }
    serve(Some(entry))
}

/// Open tasks only, the first three in server order.
fn pick_tasks(body: &Value) -> Vec<TaskItem> {
    let mut all = open_tasks(body, Filters::default());
    all.truncate(TASK_LIMIT);
    all
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DueTomorrow {
    pub count: u64,
    pub est_minutes: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksSummary {
    pub next: Vec<TaskItem>,
    pub remaining: u64,
    pub due_tomorrow: DueTomorrow,
    /// With the `due` filter: how many tasks are due today or overdue, before the limit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_today: Option<u64>,
}

/// A tag: 1 to 40 characters, `^[A-Za-z0-9][A-Za-z0-9 &/_-]{0,39}$`.
fn valid_tag(tag: &str) -> bool {
    let mut chars = tag.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && tag.chars().count() <= 40
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '&' | '/' | '_' | '-'))
}

/// A list name: 1 to 60 characters, no control characters.
fn valid_list_name(name: &str) -> bool {
    (1..=60).contains(&name.chars().count()) && !name.chars().any(char::is_control)
}

type CheckedFilters = (Option<String>, Option<String>, Option<String>);

/// Trim the three filters, then validate them. A value of only spaces is refused.
#[allow(non_snake_case)]
fn check_filters(tag: Option<String>, notTag: Option<String>, list: Option<String>) -> Result<CheckedFilters, String> {
    let trim = |v: Option<String>| v.map(|s| s.trim().to_string());
    let (tag, notTag, list) = (trim(tag), trim(notTag), trim(list));
    if tag.as_deref().is_some_and(|t| !valid_tag(t)) || notTag.as_deref().is_some_and(|t| !valid_tag(t)) {
        return Err("Invalid tag".to_string());
    }
    if list.as_deref().is_some_and(|l| !valid_list_name(l)) {
        return Err("Invalid list name".to_string());
    }
    Ok((tag, notTag, list))
}

/// The id of the bucket whose `name` equals `want`, ignoring case and outer spaces.
fn find_bucket(body: &Value, want: &str) -> Option<String> {
    let want = want.trim().to_lowercase();
    body.get("buckets")?
        .as_array()?
        .iter()
        .find(|b| b.get("name").and_then(Value::as_str).is_some_and(|n| n.trim().to_lowercase() == want))
        .and_then(|b| as_id(b.get("id")?))
}

/// Whether a task is due on the local day that starts at `tomorrow` (epoch seconds) and
/// ends at `after`. A timed task is compared by instant; an all-day one by its date text.
fn due_tomorrow(t: &TaskItem, tomorrow: i64, after: i64, tomorrow_date: &str) -> bool {
    let Some(due) = t.due_at.as_deref() else {
        return false;
    };
    if t.due_is_all_day {
        return due.get(..10) == Some(tomorrow_date);
    }
    parse_iso(due).is_some_and(|secs| secs >= tomorrow as f64 && secs < after as f64)
}

/// The three next tasks, how many more are open, and what is due tomorrow (local day).
#[cfg(test)]
fn summarize(body: &Value, f: Filters, now: i64, off: &dyn Fn(i64) -> i64) -> TasksSummary {
    summarize_n(body, f, now, off, TASK_LIMIT)
}

/// Home's chores ask for more rows than three (a list that scrolls): at most this many.
const MAX_TASK_LIMIT: usize = 20;
/// The `due` filter lists every task due today or overdue: at most this many rows.
const MAX_DUE_LIMIT: usize = 60;

/// The `limit` a caller asked for, 1 to `MAX_TASK_LIMIT` (`MAX_DUE_LIMIT` with the `due`
/// filter); three when it names none.
fn task_limit(limit: Option<u32>, due: bool) -> usize {
    let cap = if due { MAX_DUE_LIMIT } else { MAX_TASK_LIMIT };
    limit.map_or(TASK_LIMIT, |n| (n as usize).clamp(1, cap))
}

/// The one value `due` may have.
fn check_due(due: Option<String>) -> Result<bool, String> {
    match due.as_deref().map(str::trim) {
        None => Ok(false),
        Some("today") => Ok(true),
        Some(_) => Err("Invalid due filter".to_string()),
    }
}

/// Where a task's due date falls against the local day that starts at `today` and ends at
/// `tomorrow` (epoch seconds); `today_date` is that day as `YYYY-MM-DD`. A timed task is
/// compared by instant, an all-day one (or a bare date) by its date text. No due date or an
/// unreadable one is `Later`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DueWhen {
    Overdue,
    Today,
    Later,
}

fn due_when(t: &TaskItem, today: i64, tomorrow: i64, today_date: &str) -> DueWhen {
    let Some(due) = t.due_at.as_deref() else {
        return DueWhen::Later;
    };
    let bare = due.len() == 10;
    if t.due_is_all_day || bare {
        let Some(date) = due.get(..10).filter(|d| {
            d.bytes().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == b'-' } else { c.is_ascii_digit() })
        }) else {
            return DueWhen::Later;
        };
        return match date.cmp(today_date) {
            std::cmp::Ordering::Less => DueWhen::Overdue,
            std::cmp::Ordering::Equal => DueWhen::Today,
            std::cmp::Ordering::Greater => DueWhen::Later,
        };
    }
    match parse_iso(due) {
        Some(secs) if secs < today as f64 => DueWhen::Overdue,
        Some(secs) if secs < tomorrow as f64 => DueWhen::Today,
        _ => DueWhen::Later,
    }
}

/// As `summarize`, with the first `limit` tasks as `next`.
#[cfg(test)]
fn summarize_n(body: &Value, f: Filters, now: i64, off: &dyn Fn(i64) -> i64, limit: usize) -> TasksSummary {
    summarize_core(body, f, now, off, limit, false)
}

/// The tasks due today or overdue (local day), overdue ones first and each group in server
/// order (`open_tasks` keeps the task app's own order, which is not sorted by due date),
/// the first `limit` of them as `next`, `remaining` the rest, `due_today` the whole count.
#[cfg(test)]
fn summarize_due(body: &Value, f: Filters, now: i64, off: &dyn Fn(i64) -> i64, limit: usize) -> TasksSummary {
    summarize_core(body, f, now, off, limit, true)
}

fn summarize_core(body: &Value, f: Filters, now: i64, off: &dyn Fn(i64) -> i64, limit: usize, due_only: bool) -> TasksSummary {
    let all = open_tasks(body, f);
    let today = local_midnight(now, off);
    let tomorrow = local_midnight(today + 36 * 3600, off);
    let after = local_midnight(today + 60 * 3600, off);
    let (y, m, d) = crate::wall2_meet::civil_from_days((tomorrow + off(tomorrow)).div_euclid(86_400));
    let date = format!("{y:04}-{m:02}-{d:02}");
    let mut count = 0;
    let mut est_total = 0;
    for t in all.iter().filter(|t| due_tomorrow(t, tomorrow, after, &date)) {
        count += 1;
        est_total += est_minutes(t.est.as_deref());
    }
    let (all, due_today) = if due_only {
        let (y, m, d) = crate::wall2_meet::civil_from_days((today + off(today)).div_euclid(86_400));
        let today_date = format!("{y:04}-{m:02}-{d:02}");
        let (mut overdue, mut todays) = (Vec::new(), Vec::new());
        for t in all {
            match due_when(&t, today, tomorrow, &today_date) {
                DueWhen::Overdue => overdue.push(t),
                DueWhen::Today => todays.push(t),
                DueWhen::Later => {}
            }
        }
        overdue.extend(todays);
        let n = overdue.len() as u64;
        (overdue, Some(n))
    } else {
        (all, None)
    };
    let remaining = all.len().saturating_sub(limit) as u64;
    let next = all.into_iter().take(limit).collect();
    TasksSummary { next, remaining, due_tomorrow: DueTomorrow { count, est_minutes: est_total }, due_today }
}

/// The next tasks with optional filters: `tag`, `notTag` (task tags) and `list` (a list
/// name, resolved to its bucket through `/api/buckets`). None of them goes into a URL. An
/// unknown list name gives an empty summary, not an error.
#[tauri::command]
#[allow(non_snake_case)]
pub async fn wall2_tasks_summary(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    tag: Option<String>,
    notTag: Option<String>,
    list: Option<String>,
    limit: Option<u32>,
    due: Option<String>,
) -> Result<TasksSummary, String> {
    crate::wall2_meet::require_wall2(window.label())?;
    let (tag, notTag, list) = check_filters(tag, notTag, list)?;
    let due = check_due(due)?;
    let limit = task_limit(limit, due);
    let base = read_base(&app, "tasksBaseUrl", true)?;
    tauri::async_runtime::spawn_blocking(move || {
        let bucket_id = match list.as_deref() {
            None => None,
            Some(name) => {
                let buckets = get_json(&format!("{base}/api/buckets"))?;
                match find_bucket(&buckets, name) {
                    Some(id) => Some(id),
                    None => return Ok(summarize_core(&Value::Null, Filters::default(), now_epoch(), &local_offset_secs, TASK_LIMIT, due)),
                }
            }
        };
        let body = get_json(&format!("{base}/api/tasks?status=open"))?;
        let f = Filters { tag: tag.as_deref(), not_tag: notTag.as_deref(), bucket_id: bucket_id.as_deref() };
        let mut summary = summarize_core(&body, f, now_epoch(), &local_offset_secs, limit, due);
        // The tag list is read only when a row has tags, and a failed read leaves the rows as they are.
        let meta = tag_meta_for(&base, &summary.next);
        join_tag_meta(&mut summary.next, &meta);
        remember_shown_n(&read_key(&tag, &notTag, &list, due), &summary.next, limit);
        Ok(summary)
    })
    .await
    .map_err(|_| "The request did not finish".to_string())?
}

#[tauri::command]
pub async fn wall2_tasks_next(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<Vec<TaskItem>, String> {
    crate::wall2_meet::require_wall2(window.label())?;
    let base = read_base(&app, "tasksBaseUrl", true)?;
    tauri::async_runtime::spawn_blocking(move || {
        let body = get_json(&format!("{base}/api/tasks?status=open"))?;
        let tasks = pick_tasks(&body);
        remember_shown("next", &tasks);
        Ok(tasks)
    })
    .await
    .map_err(|_| "The request did not finish".to_string())?
}

#[tauri::command]
pub async fn wall2_task_done(window: tauri::WebviewWindow, app: tauri::AppHandle, id: String) -> Result<(), String> {
    crate::wall2_meet::require_wall2(window.label())?;
    if !valid_task_id(&id) {
        return Err("Invalid task id".to_string());
    }
    let base = read_base(&app, "tasksBaseUrl", true)?;
    tauri::async_runtime::spawn_blocking(move || {
        agent()
            .request("PATCH", &format!("{base}/api/tasks/{id}"))
            .set("Content-Type", "application/json")
            .send_string("{\"status\":\"done\"}")
            .map_err(describe)
            .and_then(require_ok)
            .map(|_| ())
    })
    .await
    .map_err(|_| "The request did not finish".to_string())?
}

// Section: opening a task

/// The task ids each kind of read showed in its last good answer, by read (`next`, or the
/// summary's filters), oldest first. Only these can be opened, so the web view cannot ask
/// the system to open an address for an id it made up. The filters come from the web view,
/// so the list keeps at most `MAX_SHOWN_READS` kinds (the oldest goes first); each holds at
/// most the ids its read showed (up to 60 for the `due` read).
static SHOWN_TASKS: Mutex<ShownReads> = Mutex::new(Vec::new());
const MAX_SHOWN_READS: usize = 8;

/// One key per kind of read, so Work's list and Home's chores do not replace each other.
fn read_key(tag: &Option<String>, not_tag: &Option<String>, list: &Option<String>, due: bool) -> String {
    format!(
        "summary|{}|{}|{}|{}",
        tag.as_deref().unwrap_or(""),
        not_tag.as_deref().unwrap_or(""),
        list.as_deref().unwrap_or(""),
        if due { "due" } else { "" }
    )
}

/// One kind of read: its key, the ids it showed, the `limit` it asked for and when (epoch seconds).
#[derive(Debug, Clone, PartialEq)]
struct Shown {
    key: String,
    ids: Vec<String>,
    limit: usize,
    at: i64,
}

type ShownReads = Vec<Shown>;

/// The old freshness boundary, retained only to pin the stale-list regression test.
#[cfg(test)]
const SHOWN_FRESH_SECS: i64 = 300;

/// Keep `tasks` as the ids `key`'s read showed (at most three), and drop the oldest reads past
/// `MAX_SHOWN_READS`.
#[cfg(test)]
fn remember_in(reads: &mut ShownReads, key: &str, tasks: &[TaskItem]) {
    remember_in_n(reads, key, tasks, TASK_LIMIT, 0);
}

/// As `remember_in`, for a read that asked for `limit` rows, at time `now`. A read replaces
/// what the same kind of read remembered, except a shorter one:
/// a one-row read (the "open the first task" key) must not make the rows of the 60 row list
/// beside it unknown, so it adds its ids in front of the longer read's (bounded union, newest
/// first, at most `MAX_DUE_LIMIT`) and leaves that read's limit and time alone, so the union
/// lasts until the next full read replaces it. (Keying by the limit instead would
/// use up the eight kinds; the union costs none.)
fn remember_in_n(reads: &mut ShownReads, key: &str, tasks: &[TaskItem], limit: usize, now: i64) {
    let fresh: Vec<String> = tasks.iter().take(limit.min(MAX_DUE_LIMIT)).map(|t| t.id.clone()).collect();
    let old = reads.iter().position(|r| r.key == key).map(|i| reads.remove(i));
    let entry = match old {
        Some(o) if limit < o.limit => {
            let mut ids = fresh.clone();
            ids.extend(o.ids.iter().filter(|id| !fresh.contains(id)).cloned());
            ids.truncate(MAX_DUE_LIMIT);
            Shown { key: key.to_string(), ids, limit: o.limit, at: o.at }
        }
        _ => Shown { key: key.to_string(), ids: fresh, limit, at: now },
    };
    reads.push(entry);
    while reads.len() > MAX_SHOWN_READS {
        reads.remove(0);
    }
}

fn shown_in(reads: &ShownReads, id: &str) -> bool {
    reads.iter().any(|r| r.ids.iter().any(|known| known == id))
}

fn remember_shown(key: &str, tasks: &[TaskItem]) {
    remember_shown_n(key, tasks, TASK_LIMIT);
}

fn remember_shown_n(key: &str, tasks: &[TaskItem], limit: usize) {
    if let Ok(mut reads) = SHOWN_TASKS.lock() {
        remember_in_n(&mut reads, key, tasks, limit, now_epoch());
    }
}

/// The checks before a task is opened, in order: the calling window must be Wall 2's (the
/// shared check), then the id must be well formed and one the last good reads showed.
fn check_open_task(label: &str, id: &str, reads: &ShownReads) -> Result<(), String> {
    crate::wall2_omni::require_wall2(label)?;
    if !valid_task_id(id) || !shown_in(reads, id) {
        return Err("Unknown task".to_string());
    }
    Ok(())
}

/// The address that opens a task. The task app has no address for one task (its API is
/// `/api/tasks/{id}`, which is JSON, not a page), so this is the app's own page: the base
/// URL with a trailing slash. The id is checked before this is called.
fn task_link(base: &str, _id: &str) -> String {
    format!("{base}/")
}

/// Open a task the wall showed in the task app, with the system's default handler (as
/// `wall2_open_link`). Only the Wall 2 window may call it (`forbidden` otherwise), and only
/// an id from the last good task reads is accepted.
#[tauri::command]
pub fn wall2_open_task(window: tauri::WebviewWindow, app: tauri::AppHandle, id: String) -> Result<(), String> {
    {
        let reads = SHOWN_TASKS.lock().map_err(|_| "Unknown task".to_string())?;
        check_open_task(window.label(), &id, &reads)?;
    }
    let base = read_base(&app, "tasksBaseUrl", true)?;
    app.opener().open_url(task_link(&base, &id), None::<&str>).map_err(|_| "Could not open the link".to_string())
}

// Section: home security

/// Python truthiness of a JSON value, for the alert `id` test.
fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map_or(true, |f| f != 0.0),
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(a)) => !a.is_empty(),
        Some(Value::Object(o)) => !o.is_empty(),
    }
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Epoch seconds of an ISO 8601 timestamp (`Z` or an offset required), or NaN when it is unreadable, including a time with no offset.
fn parse_time(raw: Option<&Value>) -> f64 {
    let Some(s) = raw.and_then(Value::as_str) else {
        return f64::NAN;
    };
    parse_iso(s.trim()).unwrap_or(f64::NAN)
}

fn days_in_month(y: i64, m: i64) -> i64 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ => {
            if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 {
                29
            } else {
                28
            }
        }
    }
}

/// Epoch seconds of `YYYY-MM-DDTHH:MM[:SS[.fraction]]` followed by `Z` or `+HH:MM` / `-HH:MM`.
/// This matches the reference's `datetime.fromisoformat` for the shapes the home app sends,
/// with one deliberate difference: a value with no offset (naive) or a date only is
/// unreadable here, where the reference would read it as local time. The home app always
/// sends an offset, and an unreadable time keeps a done request hiding, the safe side.
pub(crate) fn parse_iso(s: &str) -> Option<f64> {
    let b = s.as_bytes();
    let num = |from: usize, to: usize| -> Option<i64> {
        let part = s.get(from..to)?;
        if part.is_empty() || !part.bytes().all(|c| c.is_ascii_digit()) {
            return None;
        }
        part.parse().ok()
    };
    if b.len() < 16 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' {
        return None;
    }
    let (y, mo, d) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    let (h, mi) = (num(11, 13)?, num(14, 16)?);
    if y < 1 || !(1..=12).contains(&mo) || d < 1 || d > days_in_month(y, mo) || h > 23 || mi > 59 {
        return None;
    }
    let mut i = 16;
    let mut sec = 0;
    let mut has_seconds = false;
    if b.get(i) == Some(&b':') {
        sec = num(i + 1, i + 3)?;
        if sec > 59 {
            return None;
        }
        i += 3;
        has_seconds = true;
    }
    let mut frac = 0.0;
    if b.get(i) == Some(&b'.') {
        if !has_seconds {
            return None; // a fraction needs seconds before it
        }
        let start = i + 1;
        let mut end = start;
        while end < b.len() && b[end].is_ascii_digit() {
            end += 1;
        }
        if end == start {
            return None;
        }
        frac = format!("0.{}", &s[start..end]).parse().ok()?;
        i = end;
    }
    let offset = match b.get(i) {
        Some(b'Z') if i + 1 == b.len() => 0,
        Some(&sign) if (sign == b'+' || sign == b'-') && b.len() == i + 6 && b[i + 3] == b':' => {
            let (oh, om) = (num(i + 1, i + 3)?, num(i + 4, i + 6)?);
            if oh > 23 || om > 59 {
                return None;
            }
            let total = oh * 3600 + om * 60;
            if sign == b'-' { -total } else { total }
        }
        _ => return None, // no offset (naive) or trailing text
    };
    let days = days_from_civil(y, mo, d);
    Some((days * 86_400 + h * 3600 + mi * 60 + sec - offset) as f64 + frac)
}

/// Whether the home app's own page hides this alert (port of its `alertHidden` rule).
/// A waiting "reviewed" request hides at once. A done request hides until a summary
/// newer than the request arrives. A failed request hides nothing. An unreadable time
/// leaves a done request hiding.
fn alert_hidden(alert: &Value, received: f64) -> bool {
    let Some(obj) = alert.as_object() else {
        return false;
    };
    if !truthy(obj.get("id")) {
        return false;
    }
    let mut found: std::collections::HashMap<String, &Value> = std::collections::HashMap::new();
    if let Some(reqs) = obj.get("requests").and_then(Value::as_object) {
        for (k, v) in reqs {
            if v.is_object() {
                found.insert(k.clone(), v);
            }
        }
    }
    if let Some(latest) = obj.get("request").filter(|v| v.is_object()) {
        if let Some(action) = latest.get("action").and_then(Value::as_str) {
            found.entry(action.to_string()).or_insert(latest);
        }
    }
    if let Some(r) = found.get("reviewed") {
        if r.get("status").and_then(Value::as_str) == Some("requested") {
            return true;
        }
    }
    for action in ACTIONS {
        let Some(req) = found.get(action) else { continue };
        if req.get("status").and_then(Value::as_str) != Some("done") {
            continue;
        }
        let finished = parse_time(req.get("finishedAt"));
        if !(received > finished) {
            return true;
        }
    }
    false
}

fn visible_alerts(alerts: &[Value], received_at: Option<&Value>) -> u64 {
    let received = parse_time(received_at);
    alerts.iter().filter(|a| !alert_hidden(a, received)).count() as u64
}

const MAX_ALERT_ROWS: usize = 3;
const MAX_ALERT_CHARS: usize = 120;

/// The first string field present among `keys`, trimmed, with control characters removed
/// and capped at `MAX_ALERT_CHARS`.
fn first_text(obj: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|k| {
        let raw = obj.get(*k)?.as_str()?;
        let clean: String = raw.chars().filter(|c| !c.is_control()).collect();
        let clean = clean.split_whitespace().collect::<Vec<_>>().join(" ");
        if clean.is_empty() {
            return None;
        }
        Some(clean.chars().take(MAX_ALERT_CHARS).collect())
    })
}

/// A type slug as words: underscores and hyphens become spaces, runs of spaces collapse,
/// and the first letter is capitalised (`abnormal_upload` reads "Abnormal upload").
fn humanize_slug(raw: &str) -> String {
    let spaced: String = raw.chars().map(|c| if c == '_' || c == '-' { ' ' } else { c }).collect();
    let words = spaced.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = words.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// `high`, `medium` or `low` from the common severity words; None for anything else.
fn alert_severity(obj: &serde_json::Map<String, Value>) -> Option<String> {
    let raw = first_text(obj, &["severity", "level", "priority"])?.to_ascii_lowercase();
    let level = match raw.as_str() {
        "critical" | "high" | "severe" | "error" | "urgent" => "high",
        "medium" | "moderate" | "warning" | "warn" => "medium",
        "low" | "info" | "minor" | "notice" => "low",
        _ => return None,
    };
    Some(level.to_string())
}

/// Epoch milliseconds from an ISO time string or a number of seconds (or milliseconds,
/// when it is too large to be seconds).
fn alert_time(obj: &serde_json::Map<String, Value>) -> Option<i64> {
    for k in ["ts", "at", "time", "createdAt", "detectedAt", "firstSeen", "lastSeen"] {
        match obj.get(k) {
            Some(Value::String(_)) => {
                let secs = parse_time(obj.get(k));
                if secs.is_finite() {
                    return Some((secs * 1000.0).round() as i64);
                }
            }
            Some(Value::Number(n)) => {
                let Some(f) = n.as_f64().filter(|f| f.is_finite() && *f > 0.0) else { continue };
                return Some(if f > 1e11 { f.round() as i64 } else { (f * 1000.0).round() as i64 });
            }
            _ => {}
        }
    }
    None
}

/// Up to three visible alerts with readable text, newest first (alerts with no time last,
/// in the home app's order).
fn alert_rows(alerts: &[Value], received_at: Option<&Value>) -> Vec<AlertRow> {
    let received = parse_time(received_at);
    let mut rows: Vec<AlertRow> = alerts
        .iter()
        .filter(|a| !alert_hidden(a, received))
        .filter_map(|a| {
            let obj = a.as_object()?;
            Some(AlertRow {
                text: first_text(obj, &["title", "message", "text", "summary", "reason"])
                    .or_else(|| first_text(obj, &["type"]).map(|t| humanize_slug(&t)))
                    .filter(|t| !t.is_empty())?,
                severity: alert_severity(obj),
                at_ms: alert_time(obj),
            })
        })
        .collect();
    rows.sort_by(|a, b| b.at_ms.unwrap_or(i64::MIN).cmp(&a.at_ms.unwrap_or(i64::MIN)));
    rows.truncate(MAX_ALERT_ROWS);
    rows
}

/// The portal link, kept only when it is `https` on `firewalla.net` or a subdomain.
fn portal_link(raw: Option<&Value>) -> Option<String> {
    let text = raw?.as_str()?.trim();
    let rest = text.strip_prefix("https://")?;
    if text.len() > 300 || text.chars().any(|c| c.is_whitespace() || c.is_control() || c == '\\') {
        return None;
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() || authority.contains('@') {
        return None;
    }
    let host = match authority.rsplit_once(':') {
        Some((h, p)) if !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()) => h,
        Some(_) => return None,
        None => authority,
    }
    .to_ascii_lowercase();
    if host.is_empty() || !host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') {
        return None;
    }
    if host == "firewalla.net" || host.ends_with(PORTAL_SUFFIX) {
        Some(text.to_string())
    } else {
        None
    }
}

fn stamp(raw: Option<&Value>) -> Option<String> {
    match raw.and_then(Value::as_str) {
        Some(s) if !s.is_empty() && s.chars().count() <= 40 => Some(s.to_string()),
        _ => None,
    }
}

fn firewalla_info(health: Option<&Value>) -> Option<FirewallaInfo> {
    let fw = health?.get("firewalla")?.as_object()?;
    let api = match fw.get("api").and_then(Value::as_str) {
        Some(a @ ("up" | "down" | "unknown")) => a.to_string(),
        _ => "unknown".to_string(),
    };
    Some(FirewallaInfo {
        api,
        box_online: fw.get("boxOnline").and_then(Value::as_bool),
        checked_at: stamp(fw.get("checkedAt")),
        alarms24h: fw.get("alarms24h").and_then(Value::as_u64),
    })
}

/// The compact answer from the home app's body. A body of the wrong shape is unreachable.
fn shape_security(body: &Value) -> SecuritySummary {
    let mut out = SecuritySummary {
        reachable: false,
        stale: false,
        last_scan: None,
        alerts: 0,
        firewalla: None,
        portal_url: None,
        top_alerts: Vec::new(),
    };
    if body.get("ok").and_then(Value::as_bool) != Some(true) {
        return out;
    }
    out.reachable = true;
    let Some(summary) = body.get("summary").filter(|s| s.is_object()) else {
        // The home app answered but has no scan yet: say so as stale.
        out.stale = true;
        return out;
    };
    out.stale = truthy(body.get("stale"));
    out.last_scan = stamp(summary.get("lastScan"));
    if let Some(alerts) = summary.get("alerts").and_then(Value::as_array) {
        out.alerts = visible_alerts(alerts, body.get("receivedAt"));
        out.top_alerts = alert_rows(alerts, body.get("receivedAt"));
    }
    let health = summary.get("health");
    out.firewalla = firewalla_info(health);
    if let Some(fw) = health.and_then(|h| h.get("firewalla")).filter(|f| f.is_object()) {
        out.portal_url = portal_link(fw.get("portalUrl"));
    }
    out
}

#[tauri::command]
pub async fn wall2_home_security(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<SecuritySummary, String> {
    crate::wall2_meet::require_wall2(window.label())?;
    let base = read_base(&app, "homeBaseUrl", false)?;
    let summary = tauri::async_runtime::spawn_blocking(move || {
        let body = get_json(&format!("{base}/api/security?lite=1"))?;
        Ok::<_, String>(shape_security(&body))
    })
    .await
    .map_err(|_| "The request did not finish".to_string())??;
    remember_portal(summary.portal_url.clone());
    Ok(summary)
}

// Section: links

/// The portal link from the most recent successful security read. Only ever set from
/// `portal_link`, so it is already checked; the web view never supplies a URL.
static LAST_PORTAL: Mutex<Option<String>> = Mutex::new(None);

/// The stored value after a good read: replaced only by a new `Some`; a read without a
/// portal link keeps the last good one.
fn next_portal(current: Option<String>, read: Option<String>) -> Option<String> {
    read.or(current)
}

fn remember_portal(read: Option<String>) {
    if let Ok(mut slot) = LAST_PORTAL.lock() {
        *slot = next_portal(slot.take(), read);
    }
}

fn last_portal() -> Option<String> {
    LAST_PORTAL.lock().ok().and_then(|p| p.clone())
}

/// An `https` link with a host and any path; no userinfo, whitespace or backslashes.
fn https_link(raw: &str) -> Option<String> {
    let text = raw.trim();
    let rest = text.strip_prefix("https://")?;
    if text.len() > 500 || text.chars().any(|c| c.is_whitespace() || c.is_control() || c == '\\') {
        return None;
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() || authority.contains('@') {
        return None;
    }
    let host = match authority.rsplit_once(':') {
        Some((h, p)) if !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()) => h,
        Some(_) => return None,
        None => authority,
    };
    if host.is_empty()
        || host.starts_with(['.', '-'])
        || host.ends_with('.')
        || !host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    {
        return None;
    }
    Some(text.to_string())
}

/// The optional `homeSecurityUrl` key of `feeds.json` text, validated.
fn security_link_from_config(json_text: Option<&str>) -> Option<String> {
    let value: Value = serde_json::from_str(json_text?).ok()?;
    https_link(value.get("homeSecurityUrl")?.as_str()?)
}

fn security_link(app: &tauri::AppHandle) -> Option<String> {
    let dir = app.path().app_config_dir().ok()?;
    let text = std::fs::read_to_string(dir.join("feeds.json")).ok();
    security_link_from_config(text.as_deref())
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LinkAvailability {
    pub security: bool,
    pub portal: bool,
}

#[tauri::command]
pub fn wall2_links(window: tauri::WebviewWindow, app: tauri::AppHandle) -> LinkAvailability {
    if crate::wall2_meet::require_wall2(window.label()).is_err() {
        return LinkAvailability { security: false, portal: false };
    }
    LinkAvailability { security: security_link(&app).is_some(), portal: last_portal().is_some() }
}

#[tauri::command]
pub fn wall2_open_link(window: tauri::WebviewWindow, app: tauri::AppHandle, kind: String) -> Result<(), String> {
    crate::wall2_meet::require_wall2(window.label())?;
    let url = match kind.as_str() {
        "security" => security_link(&app),
        "portal" => last_portal(),
        fixed => fixed_link(fixed).map(str::to_string),
    }
    .ok_or_else(|| "No such link".to_string())?;
    app.opener().open_url(url, None::<&str>).map_err(|_| "Could not open the link".to_string())
}

/// The one address `wall2_open_camera` opens: the Windows Camera app. Fixed here, never built from anything the page sends.
const CAMERA_URI: &str = "microsoft.windows.camera:";

/// Opens the Windows Camera app so the camera can be checked before a call. Takes no arguments; only the Wall 2
/// window may call it (`forbidden` otherwise); any other failure answers `failed`.
#[tauri::command]
pub fn wall2_open_camera(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    crate::wall2_meet::require_wall2(window.label())?;
    app.opener().open_url(CAMERA_URI, None::<&str>).map_err(|_| "failed".to_string())
}

fn fixed_link(kind: &str) -> Option<&'static str> {
    match kind {
        "youtube-music" => Some("https://music.youtube.com/"),
        // The two links YouTube API Services asks every app that uses them to show.
        "youtube-terms" => Some("https://www.youtube.com/t/terms"),
        "google-privacy" => Some("https://policies.google.com/privacy"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn link_commands_check_the_window_first() {
        let src = include_str!("wall2_feeds.rs");
        for (command, check) in [
            ("pub fn wall2_links(", "if crate::wall2_meet::require_wall2(window.label()).is_err()"),
            ("pub fn wall2_open_link(", "crate::wall2_meet::require_wall2(window.label())?;"),
            ("pub fn wall2_open_camera(", "crate::wall2_meet::require_wall2(window.label())?;"),
            ("pub async fn wall2_tasks_summary(", "crate::wall2_meet::require_wall2(window.label())?;"),
            ("pub async fn wall2_tasks_next(", "crate::wall2_meet::require_wall2(window.label())?;"),
            ("pub async fn wall2_task_done(", "crate::wall2_meet::require_wall2(window.label())?;"),
            ("pub async fn wall2_home_security(", "crate::wall2_meet::require_wall2(window.label())?;"),

        ] {
            let body = &src[src.find(command).expect("command")..];
            let first = body[body.find('{').expect("body") + 1..].trim_start();
            assert!(first.starts_with(check), "{command}");
        }
    }

    #[test]
    fn camera_command_opens_one_fixed_uri_and_takes_no_arguments() {
        assert_eq!(CAMERA_URI, "microsoft.windows.camera:");
        let src = include_str!("wall2_feeds.rs");
        let start = src.find("pub fn wall2_open_camera(").expect("command");
        let body = &src[start..start + src[start..].find("\n}\n").expect("end")];
        // No argument besides the window and the app handle, and the opener gets the constant only.
        assert!(body.lines().next().unwrap().ends_with("(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {"));
        assert!(body.contains("open_url(CAMERA_URI, None::<&str>)"));
        assert_eq!(body.matches("open_url(").count(), 1);
    }

    #[test]
    fn base_url_accepts_scheme_host_port() {
        assert_eq!(validate_base_url("https://example.invalid:8443", true).unwrap(), "https://example.invalid:8443");
        assert_eq!(validate_base_url(" http://192.0.2.10:8080 ", false).unwrap(), "http://192.0.2.10:8080");
        assert!(validate_base_url("https://example.invalid", true).is_ok());
        assert!(validate_base_url("http://[2001:db8::1]:8080", false).is_ok());
    }

    #[test]
    fn base_url_rejects_path_query_fragment_userinfo_scheme() {
        assert!(validate_base_url("https://example.invalid/api", true).is_err());
        assert!(validate_base_url("https://example.invalid/", true).is_err());
        assert!(validate_base_url("https://example.invalid?x=1", true).is_err());
        assert!(validate_base_url("https://example.invalid#top", true).is_err());
        assert!(validate_base_url("https://user:pw@example.invalid", true).is_err());
        assert!(validate_base_url("http://example.invalid:8443", true).is_err());
        assert!(validate_base_url("ftp://example.invalid", false).is_err());
        assert!(validate_base_url("example.invalid", false).is_err());
        assert!(validate_base_url("https://", true).is_err());
        assert!(validate_base_url("https://example.invalid:99999", true).is_err());
        assert!(validate_base_url("https://example.invalid:", true).is_err());
    }

    #[test]
    fn config_missing_file_or_key_is_not_configured() {
        assert_eq!(base_from_config(None, "tasksBaseUrl", true), Err(NOT_CONFIGURED.to_string()));
        assert_eq!(base_from_config(Some("{}"), "tasksBaseUrl", true), Err(NOT_CONFIGURED.to_string()));
        let both = r#"{"tasksBaseUrl":"https://example.invalid:8443","homeBaseUrl":"http://192.0.2.10:8080"}"#;
        assert!(base_from_config(Some(both), "tasksBaseUrl", true).is_ok());
        assert!(base_from_config(Some(both), "homeBaseUrl", false).is_ok());
        assert!(base_from_config(Some("not json"), "tasksBaseUrl", true).is_err());
    }

    /// A zone that is UTC-5 until 2026-03-08 07:00 UTC, then UTC-4 (a spring-forward night).
    fn us_east(utc: i64) -> i64 {
        // 2026-03-08T07:00:00Z
        if utc < 1_772_953_200 { -5 * 3600 } else { -4 * 3600 }
    }

    fn shown_task(id: &str) -> TaskItem {
        TaskItem { id: id.to_string(), title: "A".to_string(), due_at: None, due_is_all_day: false, quadrant: None, est: None, tags: Vec::new() }
    }

    #[test]
    fn open_task_accepts_only_ids_from_a_good_read() {
        let mut reads = ShownReads::new();
        assert!(!shown_in(&reads, "open-test-1"));
        remember_in(&mut reads, "work", &[shown_task("open-test-1"), shown_task("open-test-2")]);
        remember_in(&mut reads, "home", &[shown_task("open-test-3")]);
        assert!(shown_in(&reads, "open-test-1"));
        assert!(shown_in(&reads, "open-test-3"), "a second kind of read does not replace the first");
        // The next good read of the same kind replaces its ids.
        remember_in(&mut reads, "work", &[shown_task("open-test-2")]);
        assert!(!shown_in(&reads, "open-test-1"));
        assert!(shown_in(&reads, "open-test-2"));
        assert!(!shown_in(&reads, "open-test-9"));
        assert!(!valid_task_id("../x"));
        assert_eq!(task_link("https://example.invalid:8443", "open-test-2"), "https://example.invalid:8443/");
        assert_ne!(read_key(&Some("home".into()), &None, &None, false), read_key(&None, &Some("home".into()), &None, false));
        assert_ne!(read_key(&None, &Some("home".into()), &None, false), read_key(&None, &Some("home".into()), &None, true));
    }

    #[test]
    fn open_task_checks_the_window_first() {
        let mut reads = ShownReads::new();
        remember_in(&mut reads, "work", &[shown_task("win-test-1")]);
        assert_eq!(check_open_task("wall2", "win-test-1", &reads), Ok(()));
        assert_eq!(check_open_task("main", "win-test-1", &reads), Err("forbidden".to_string()));
        assert_eq!(check_open_task("main", "../x", &reads), Err("forbidden".to_string()));
        assert_eq!(check_open_task("wall2", "win-test-9", &reads), Err("Unknown task".to_string()));
        assert_eq!(check_open_task("wall2", "../x", &reads), Err("Unknown task".to_string()));
    }

    #[test]
    fn shown_task_reads_are_bounded() {
        let mut reads = ShownReads::new();
        // Many kinds of read: only the newest MAX_SHOWN_READS are kept, the oldest go first.
        for i in 0..(MAX_SHOWN_READS + 20) {
            remember_in(&mut reads, &format!("kind-{i}"), &[shown_task(&format!("bound-{i}"))]);
        }
        assert_eq!(reads.len(), MAX_SHOWN_READS);
        assert!(!shown_in(&reads, "bound-0"));
        assert!(shown_in(&reads, &format!("bound-{}", MAX_SHOWN_READS + 19)));
        // A read never keeps more than the three ids it shows.
        let many: Vec<TaskItem> = (0..10).map(|i| shown_task(&format!("many-{i}"))).collect();
        remember_in(&mut reads, "many", &many);
        assert!(shown_in(&reads, "many-2"));
        assert!(!shown_in(&reads, "many-3"));
    }

    #[test]
    fn est_mapping() {
        assert_eq!(read_est(Some(&json!("15"))).as_deref(), Some("15"));
        assert_eq!(read_est(Some(&json!(45))).as_deref(), Some("45"));
        assert_eq!(read_est(Some(&json!("60plus"))).as_deref(), Some("60plus"));
        assert_eq!(read_est(Some(&json!(90))).as_deref(), Some("60plus"));
        assert_eq!(read_est(Some(&json!(20))), None);
        assert_eq!(read_est(Some(&json!("soon"))), None);
        assert_eq!(read_est(Some(&json!(null))), None);
        assert_eq!(read_est(None), None);
        let body = json!({"tasks": [{"id": "1", "title": "A", "kind": "task", "status": "open", "estimate": "30"}]});
        assert_eq!(pick_tasks(&body)[0].est.as_deref(), Some("30"));
    }

    #[test]
    fn tag_and_list_validation() {
        for ok in ["home", "Home", "a", "errand & chores", "tax/business", "a_b-c", "a234567890123456789012345678901234567890"] {
            assert!(valid_tag(ok), "{ok}");
        }
        for bad in ["", " home", "&home", "a?b", "a.b", "a\nb", "a%20b", "é", "a2345678901234567890123456789012345678901"] {
            assert!(!valid_tag(bad), "{bad}");
        }
        for ok in ["Tasks (To-Do)", "Tax / Business", "DevOps (other board, parked)", "012345678901234567890123456789012345678901234567890123456789"] {
            assert!(valid_list_name(ok), "{ok}");
        }
        for bad in ["", "0123456789012345678901234567890123456789012345678901234567890", "a\nb", "a\u{7}b"] {
            assert!(!valid_list_name(bad), "{bad:?}");
        }
    }

    #[test]
    fn filters_are_trimmed_before_they_are_checked() {
        let s = |v: &str| Some(v.to_string());
        assert_eq!(
            check_filters(s("  home "), None, s(" Tax / Business  ")),
            Ok((s("home"), None, s("Tax / Business")))
        );
        assert!(check_filters(s("   "), None, None).is_err());
        assert!(check_filters(None, s(""), None).is_err());
        assert!(check_filters(None, None, s("    ")).is_err());
        assert!(check_filters(s("a?b"), None, None).is_err());
        assert_eq!(check_filters(None, None, None), Ok((None, None, None)));
    }

    #[test]
    fn bucket_lookup_ignores_case_and_outer_spaces() {
        let body = json!({"buckets": [
            {"id": "B1", "name": "Tasks (To-Do)", "hidden": false},
            {"id": "B2", "name": "Tax / Business", "hidden": false},
            {"id": "B3", "name": "DevOps (other board, parked)", "hidden": true}
        ]});
        assert_eq!(find_bucket(&body, "  tax / business ").as_deref(), Some("B2"));
        assert_eq!(find_bucket(&body, "TASKS (to-do)").as_deref(), Some("B1"));
        assert_eq!(find_bucket(&body, "devops (other board, parked)").as_deref(), Some("B3"));
        assert_eq!(find_bucket(&body, "Garage"), None);
        assert_eq!(find_bucket(&json!({"nope": 1}), "Tasks"), None);
    }

    #[test]
    fn local_midnight_follows_the_clock_change() {
        // 2026-03-08T18:00:00Z is 14:00 local (UTC-4); local midnight was 05:00Z (UTC-5).
        assert_eq!(local_midnight(1_772_992_800, &us_east), 1_772_946_000);
        // The next midnight is 04:00Z the next day, 23 hours after the first.
        assert_eq!(local_midnight(1_772_946_000 + 36 * 3600, &us_east), 1_772_946_000 + 23 * 3600);
        assert_eq!(local_midnight(1_000_000, &|_| 0), 950_400);
    }

    fn summary_body() -> Value {
        json!({"tasks": [
            {"id": "1", "title": "One", "kind": "task", "status": "open", "tags": ["home", "errand"], "bucket_id": "B1", "estimate": "15", "due_at": "2026-03-09T16:00:00Z"},
            {"id": "2", "title": "Two", "kind": "task", "status": "open", "tags": ["work"], "bucket_id": "B2", "estimate": "60plus", "due_at": "2026-03-09", "due_is_all_day": true},
            {"id": "3", "title": "Three", "kind": "task", "status": "open", "tags": ["Home"], "bucket_id": "B2", "estimate": "30", "due_at": "2026-03-09T03:00:00Z"},
            {"id": "4", "title": "Four", "kind": "task", "status": "open", "tags": ["home"], "bucket_id": "B1", "estimate": "45", "due_at": "2026-03-10T03:30:00Z"},
            {"id": "5", "title": "Five", "kind": "task", "status": "open", "tags": [], "bucket_id": "B1", "estimate": null},
            {"id": "6", "title": "Six", "kind": "task", "status": "done", "tags": ["home"], "bucket_id": "B1", "due_at": "2026-03-09T16:00:00Z"},
            {"id": "7", "title": "Seven", "kind": "note", "status": "open", "tags": ["home"], "bucket_id": "B1"}
        ]})
    }

    const NOW: i64 = 1_772_992_800;

    fn ids(s: &TasksSummary) -> Vec<&str> {
        s.next.iter().map(|t| t.id.as_str()).collect()
    }

    #[test]
    fn summary_counts_remaining_and_tomorrow() {
        // Now is 2026-03-08 14:00 local. Tomorrow is 2026-03-09 local: 04:00Z to 04:00Z next day.
        let got = summarize(&summary_body(), Filters::default(), NOW, &us_east);
        assert_eq!(ids(&got), ["1", "2", "3"]);
        assert_eq!(got.remaining, 2);
        // Task 1 (16:00Z), task 2 (all-day 03-09), task 4 (2026-03-10T03:30Z = 23:30 local on 03-09).
        // Task 3 (03:00Z on 03-09 = 23:00 local on 03-08) is today, so it does not count.
        assert_eq!(got.due_tomorrow, DueTomorrow { count: 3, est_minutes: 15 + 60 + 45 });
    }

    #[test]
    fn summary_limit_asks_for_more_rows_and_remembers_them() {
        assert_eq!(task_limit(None, false), 3);
        assert_eq!(task_limit(Some(0), false), 1);
        assert_eq!(task_limit(Some(5), false), 5);
        assert_eq!(task_limit(Some(500), false), MAX_TASK_LIMIT);
        let got = summarize_n(&summary_body(), Filters::default(), NOW, &us_east, 20);
        assert_eq!(ids(&got), ["1", "2", "3", "4", "5"]);
        assert_eq!(got.remaining, 0);
        let two = summarize_n(&summary_body(), Filters::default(), NOW, &us_east, 2);
        assert_eq!((ids(&two), two.remaining), (vec!["1", "2"], 3));
        let mut reads = ShownReads::new();
        let many: Vec<TaskItem> = (0..30).map(|i| shown_task(&format!("lim-{i}"))).collect();
        remember_in_n(&mut reads, "home", &many, 20, 0);
        assert!(shown_in(&reads, "lim-19"));
        assert!(!shown_in(&reads, "lim-20"));
    }

    #[test]
    fn summary_filters_by_tag() {
        let got = summarize(&summary_body(), Filters { tag: Some("HOME"), ..Filters::default() }, NOW, &us_east);
        assert_eq!(ids(&got), ["1", "3", "4"]);
        assert_eq!(got.remaining, 0);
        assert_eq!(got.due_tomorrow, DueTomorrow { count: 2, est_minutes: 15 + 45 });
    }

    fn tag_names(t: &TaskItem) -> Vec<&str> {
        t.tags.iter().map(|g| g.label.as_str()).collect()
    }

    #[test]
    fn row_tags_are_shaped_for_display() {
        let long = "y".repeat(40);
        let body = json!({"tasks": [
            {"id": "1", "title": "A", "kind": "task", "status": "open", "tags": ["home", "errands", "  Garden  ", "phone call", "repairs"]},
            {"id": "2", "title": "B", "kind": "task", "status": "open", "tags": ["Errands", "errands", "ERRANDS", "", "   "]},
            {"id": "3", "title": "C", "kind": "task", "status": "open", "tags": ["fine", "bad\ttab", "bell\u{7}", "x".repeat(41), long]},
            {"id": "4", "title": "D", "kind": "task", "status": "open", "tags": ["<b onload=x>Hi</b>", 5, null, {"a": 1}]},
            {"id": "5", "title": "E", "kind": "task", "status": "open"},
            {"id": "6", "title": "F", "kind": "task", "status": "open", "tags": "home"}
        ]});
        let rows = open_tasks(&body, Filters::default());
        // Without a filter the `home` tag is kept like any other, and the cap is three.
        assert_eq!(tag_names(&rows[0]), ["Home", "Errands", "Garden"]);
        // With the filtered tag dropped (case and outer spaces ignored) the next ones fill the three.
        let tags = shape_tags(body["tasks"][0].get("tags"), Some(" HOME "));
        assert_eq!(tags.iter().map(|t| t.label.as_str()).collect::<Vec<_>>(), ["Errands", "Garden", "Phone Call"]);
        // Duplicates after lower-casing and empty tags go; the first spelling wins.
        assert_eq!(tag_names(&rows[1]), ["Errands"]);
        // A control character or more than 40 characters drops that tag only; exactly 40 stays.
        let forty = format!("Y{}", "y".repeat(39));
        assert_eq!(tag_names(&rows[2]), ["Fine", forty.as_str()]);
        // Hostile text is kept as plain text, untouched when it has a capital letter; non-strings are ignored.
        assert_eq!(tag_names(&rows[3]), ["<b onload=x>Hi</b>"]);
        assert!(rows[4].tags.is_empty() && rows[5].tags.is_empty());
    }

    #[test]
    fn tag_labels_follow_the_rule() {
        let table = [
            ("errands", "Errands"),
            ("phone call", "Phone Call"),
            ("Phone call", "Phone call"),
            ("iPhone", "iPhone"),
            ("AE", "AE"),
            ("ae", "AE"),
            ("hc", "HC"),
            ("tv", "TV"),
            ("dbx", "DBX"),
            ("msft", "MSFT"),
            ("power bi", "Power BI"),
            ("qa gate", "QA Gate"),
            ("eos", "Eos"),
            // Common two letter words keep ordinary title case; other two letter words are acronyms.
            ("to do", "To Do"),
            ("my to do", "My To Do"),
            ("to-do/later", "To-Do/Later"),
            ("go live", "Go Live"),
            ("up next", "Up Next"),
            ("ok", "Ok"),
            ("us", "Us"),
            ("is it", "Is It"),
            ("r&d", "R&D"),
            ("q&a", "Q&A"),
            ("xy", "XY"),
            ("ux", "UX"),
            ("gym", "Gym"),
            ("rhythm", "Rhythm"),
            ("x", "X"),
            ("a", "A"),
            ("plant-2", "Plant-2"),
            ("home/garden", "Home/Garden"),
            ("front-door repairs", "Front-Door Repairs"),
            ("\u{e9}cole", "\u{c9}cole"),
        ];
        for (raw, want) in table {
            assert_eq!(tag_label(raw), want, "{raw}");
        }
    }

    #[test]
    fn tag_list_parse_keeps_only_safe_names() {
        let mut many: Vec<Value> = (0..250).map(|i| json!({"name": format!("t{i}"), "icon": "tag", "color": "teal"})).collect();
        let body = json!({"tags": [
            {"name": "Errands", "icon": "shopping-cart", "color": "orange"},
            {"name": "garden", "icon": "Plant 2", "color": "chartreuse"},
            {"name": "  Phone Call ", "icon": null, "color": "blue"},
            {"name": "", "icon": "tag", "color": "red"},
            {"name": "bad\u{7}", "icon": "tag"},
            {"icon": "tag"},
            "text",
            5,
            {"name": "iconless", "icon": "<svg onload=x>", "color": "<b>"},
            {"name": "long", "icon": "a".repeat(65), "color": "slate"}
        ]});
        let map = parse_tag_meta(&body);
        assert_eq!(map.get("errands"), Some(&TagMeta { icon: Some("shopping-cart".into()), color: Some("orange".into()) }));
        assert_eq!(map.get("garden"), Some(&TagMeta { icon: None, color: None }), "a bad icon and a bad colour are dropped, the entry stays");
        assert_eq!(map.get("phone call"), Some(&TagMeta { icon: None, color: Some("blue".into()) }));
        assert_eq!(map.get("iconless"), Some(&TagMeta { icon: None, color: None }));
        assert_eq!(map.get("long"), Some(&TagMeta { icon: None, color: Some("slate".into()) }));
        assert_eq!(map.len(), 5, "empty, control-character and nameless entries and non-objects are dropped");
        for c in TAG_COLORS {
            assert!(parse_tag_meta(&json!({"tags": [{"name": "k", "color": c}]})).get("k").is_some_and(|m| m.color.as_deref() == Some(c)));
        }
        many.insert(0, json!({"name": "first"}));
        let capped = parse_tag_meta(&json!({"tags": many}));
        assert_eq!(capped.len(), MAX_TAG_META);
        assert!(capped.contains_key("first") && capped.contains_key("t198") && !capped.contains_key("t199"));
        assert!(parse_tag_meta(&json!([1, 2])).is_empty());
        assert!(parse_tag_meta(&json!({"tags": "x"})).is_empty());
        assert!(parse_tag_meta(&Value::Null).is_empty());
    }

    #[test]
    fn row_tags_join_the_tag_list_by_lower_case_name() {
        let body = json!({"tasks": [{"id": "1", "title": "A", "kind": "task", "status": "open", "tags": ["Errands", "unlisted", "PHONE call"]}]});
        let mut rows = open_tasks(&body, Filters::default());
        let meta = parse_tag_meta(&json!({"tags": [
            {"name": "errands", "icon": "shopping-cart", "color": "orange"},
            {"name": "phone call", "icon": "phone", "color": "blue"}
        ]}));
        join_tag_meta(&mut rows, &meta);
        let t = &rows[0].tags;
        assert_eq!((t[0].icon.as_deref(), t[0].color.as_deref()), (Some("shopping-cart"), Some("orange")));
        assert_eq!((t[1].icon.as_deref(), t[1].color.as_deref()), (None, None), "a tag the list does not know has neither");
        assert_eq!((t[2].icon.as_deref(), t[2].color.as_deref(), t[2].label.as_str()), (Some("phone"), Some("blue"), "PHONE call"));
        // What the page receives: label, icon and colour only.
        let sent = serde_json::to_value(&rows[0]).unwrap();
        assert_eq!(sent["tags"][0], json!({"label": "Errands", "icon": "shopping-cart", "color": "orange"}));
    }

    #[test]
    fn a_failed_tag_list_read_still_returns_the_rows() {
        let body = json!({"tasks": [{"id": "1", "title": "A", "kind": "task", "status": "open", "tags": ["errands"]}]});
        let mut got = summarize_n(&body, Filters::default(), NOW, &us_east, 3);
        // A failed read joins nothing: the tag stays with no icon and no colour.
        join_tag_meta(&mut got.next, &TagMetaMap::new());
        assert_eq!(ids(&got), ["1"]);
        assert_eq!(got.next[0].tags[0], TaskTag { label: "Errands".into(), icon: None, color: None, key: "errands".into() });
        // The read is skipped when no row has tags, so a bare list never waits on it.
        assert!(tag_meta_for("https://example.invalid", &[shown_task("1")]).is_empty());
    }

    #[test]
    fn the_tag_list_is_read_again_after_ten_minutes_and_not_right_after_a_failure() {
        assert!(tag_meta_due(1000, None, None));
        assert!(!tag_meta_due(1000 + 599, Some(1000), None));
        assert!(tag_meta_due(1000 + 600, Some(1000), None));
        assert!(!tag_meta_due(1030, None, Some(1000)), "a failure waits a minute");
        assert!(tag_meta_due(1060, None, Some(1000)));
        assert!(!tag_meta_due(1000 + 700, Some(1000), Some(1000 + 690)), "a recent failure holds back even a stale copy");
    }

    fn due_body() -> Value {
        json!({"tasks": [
            {"id": "later", "title": "L", "kind": "task", "status": "open", "tags": ["home"], "due_at": "2026-03-09T04:00:00Z"},
            {"id": "none", "title": "N", "kind": "task", "status": "open", "tags": ["home"]},
            {"id": "today-last", "title": "T", "kind": "task", "status": "open", "tags": ["home"], "due_at": "2026-03-09T03:59:00Z"},
            {"id": "overdue-timed", "title": "O", "kind": "task", "status": "open", "tags": ["home"], "due_at": "2026-03-08T04:59:00Z"},
            {"id": "today-first", "title": "F", "kind": "task", "status": "open", "tags": ["work"], "due_at": "2026-03-08T05:00:00Z"},
            {"id": "all-day-today", "title": "A", "kind": "task", "status": "open", "tags": ["work"], "due_at": "2026-03-08", "due_is_all_day": true},
            {"id": "all-day-old", "title": "D", "kind": "task", "status": "open", "tags": ["work"], "due_at": "2026-03-07T00:00:00Z", "due_is_all_day": true},
            {"id": "all-day-next", "title": "X", "kind": "task", "status": "open", "tags": ["work"], "due_at": "2026-03-09", "due_is_all_day": true},
            {"id": "bare", "title": "B", "kind": "task", "status": "open", "tags": ["work"], "due_at": "2026-03-08"},
            {"id": "junk", "title": "J", "kind": "task", "status": "open", "tags": ["work"], "due_at": "soon"},
            {"id": "done", "title": "Z", "kind": "task", "status": "done", "due_at": "2026-03-08T12:00:00Z"}
        ]})
    }

    #[test]
    fn the_last_good_tag_list_serves_for_an_hour_through_failed_reads_then_stops() {
        let rows = open_tasks(&json!({"tasks": [{"id": "1", "title": "A", "kind": "task", "status": "open", "tags": ["errands"]}]}), Filters::default());
        let plain = [shown_task("1")];
        let cache: Mutex<Option<TagCache>> = Mutex::new(None);
        let calls = std::cell::Cell::new(0);
        let good = json!({"tags": [{"name": "errands", "icon": "shopping-cart", "color": "orange"}]});
        let ok = || {
            calls.set(calls.get() + 1);
            Ok(good.clone())
        };
        let err = || {
            calls.set(calls.get() + 1);
            Err("The service answered 500".to_string())
        };
        let has = |m: &TagMetaMap| m.get("errands").is_some_and(|t| t.icon.as_deref() == Some("shopping-cart"));
        // A good read.
        assert!(has(&tag_meta_with(&cache, 0, &rows, &ok)));
        assert_eq!(calls.get(), 1);
        // Within ten minutes nothing is read again.
        assert!(has(&tag_meta_with(&cache, 599, &rows, &err)));
        assert_eq!(calls.get(), 1);
        // Ten minutes on, the read fails: the old list still serves.
        assert!(has(&tag_meta_with(&cache, 700, &rows, &err)));
        assert_eq!(calls.get(), 2);
        // Within a minute of the failure nothing is tried; a minute on it is tried and fails again.
        assert!(has(&tag_meta_with(&cache, 759, &rows, &err)));
        assert_eq!(calls.get(), 2);
        assert!(has(&tag_meta_with(&cache, 760, &rows, &err)));
        assert_eq!(calls.get(), 3);
        // One second short of an hour from the good read, the list still serves; at the hour it stops.
        assert!(has(&tag_meta_with(&cache, 3599, &rows, &err)));
        let expired = tag_meta_with(&cache, 3600, &rows, &err);
        assert!(expired.is_empty(), "after an hour of failures the rows carry no icon and no colour");
        let mut joined = rows.clone();
        join_tag_meta(&mut joined, &expired);
        assert_eq!((joined[0].tags[0].icon.clone(), joined[0].tags[0].color.clone()), (None, None));
        // It stays empty while reads keep failing, and a read that works brings the list back.
        assert!(tag_meta_with(&cache, 3700, &rows, &err).is_empty());
        assert!(has(&tag_meta_with(&cache, 3800, &rows, &ok)));
        // Rows with no tags never read it, whatever the cache holds.
        let before = calls.get();
        assert!(tag_meta_with(&cache, 99_999, &plain, &err).is_empty());
        assert_eq!(calls.get(), before);
    }

    #[test]
    fn invisible_format_characters_are_dropped_like_control_characters() {
        let tags = json!(["fine", "a\u{200e}b", "a\u{200f}b", "a\u{202a}b", "a\u{202e}b", "a\u{2066}b", "a\u{2069}b", "a\u{200b}b", "a\u{feff}b", "a\u{ad}b", "ok\u{e9}"]);
        let got = shape_tags(Some(&tags), None);
        assert_eq!(got.iter().map(|t| t.label.as_str()).collect::<Vec<_>>(), ["Fine", "Ok\u{e9}"]);
        let meta = parse_tag_meta(&json!({"tags": [{"name": "a\u{202e}b", "color": "red"}, {"name": "plain", "color": "red"}]}));
        assert_eq!(meta.len(), 1);
        assert!(meta.contains_key("plain"));
    }

    #[test]
    fn due_today_keeps_today_and_overdue_with_overdue_first() {
        // Now is 2026-03-08 14:00 local (UTC-4 after the clock change); the local day is 05:00Z to 04:00Z.
        let got = summarize_due(&due_body(), Filters::default(), NOW, &us_east, 60);
        assert_eq!(ids(&got), ["overdue-timed", "all-day-old", "today-last", "today-first", "all-day-today", "bare"]);
        assert_eq!((got.due_today, got.remaining), (Some(6), 0));
        // A task with no due date, an unreadable one, tomorrow's and a done one never show.
        for id in ["later", "none", "junk", "done", "all-day-next"] {
            assert!(!ids(&got).contains(&id), "{id}");
        }
        // The filters still apply: only `work` tasks, or not `home`.
        let work = summarize_due(&due_body(), Filters { tag: Some("work"), ..Filters::default() }, NOW, &us_east, 60);
        assert_eq!(ids(&work), ["all-day-old", "today-first", "all-day-today", "bare"]);
        let not_home = summarize_due(&due_body(), Filters { not_tag: Some("home"), ..Filters::default() }, NOW, &us_east, 60);
        assert_eq!(ids(&not_home), ids(&work));
    }

    #[test]
    fn due_today_follows_the_local_day_in_a_positive_offset() {
        let ahead = |_: i64| 10 * 3600;
        // NOW is 04:00 on 2026-03-09 local; that day is 2026-03-08T14:00Z to 2026-03-09T14:00Z.
        let body = json!({"tasks": [
            {"id": "late", "title": "A", "kind": "task", "status": "open", "due_at": "2026-03-09T13:59:00Z"},
            {"id": "after", "title": "B", "kind": "task", "status": "open", "due_at": "2026-03-09T14:00:00Z"},
            {"id": "yesterday", "title": "C", "kind": "task", "status": "open", "due_at": "2026-03-08T13:59:00Z"},
            {"id": "date", "title": "D", "kind": "task", "status": "open", "due_at": "2026-03-09", "due_is_all_day": true},
            {"id": "date-old", "title": "E", "kind": "task", "status": "open", "due_at": "2026-03-08", "due_is_all_day": true}
        ]});
        let got = summarize_due(&body, Filters::default(), NOW, &ahead, 60);
        assert_eq!(ids(&got), ["yesterday", "date-old", "late", "date"]);
        // The same body against UTC-4: the all-day 03-09 is tomorrow there.
        let behind = summarize_due(&body, Filters::default(), NOW, &us_east, 60);
        assert_eq!(ids(&behind), ["yesterday", "date-old"]);
    }

    #[test]
    fn due_today_limit_counts_and_remembers_up_to_sixty() {
        assert_eq!(task_limit(Some(500), true), MAX_DUE_LIMIT);
        assert_eq!(task_limit(Some(60), true), 60);
        assert_eq!(task_limit(Some(60), false), MAX_TASK_LIMIT);
        assert_eq!(task_limit(None, true), 3);
        assert_eq!(check_due(None), Ok(false));
        assert_eq!(check_due(Some("today".into())), Ok(true));
        assert!(check_due(Some("tomorrow".into())).is_err());
        assert!(check_due(Some("".into())).is_err());
        let rows: Vec<Value> = (0..70)
            .map(|i| json!({"id": format!("r{i}"), "title": "R", "kind": "task", "status": "open", "due_at": "2026-03-08T12:00:00Z"}))
            .collect();
        let got = summarize_due(&json!({"tasks": rows}), Filters::default(), NOW, &us_east, 60);
        assert_eq!((got.next.len(), got.remaining, got.due_today), (60, 10, Some(70)));
        // Every row the page can tick can be opened and completed: all sixty ids are remembered.
        let mut reads = ShownReads::new();
        remember_in_n(&mut reads, "due", &got.next, 60, 0);
        assert!(shown_in(&reads, "r59") && !shown_in(&reads, "r60"));
        // The plain read still reports no due count.
        assert_eq!(summarize_n(&due_body(), Filters::default(), NOW, &us_east, 3).due_today, None);
    }

    #[test]
    fn a_short_read_does_not_make_the_rows_of_the_long_read_unknown() {
        // The 60 row list is read, then the "open the first task" key reads one row with the same filters.
        let sixty: Vec<TaskItem> = (0..60).map(|i| shown_task(&format!("row-{i}"))).collect();
        let mut reads = ShownReads::new();
        remember_in_n(&mut reads, "work-due", &sixty, 60, 1000);
        remember_in_n(&mut reads, "work-due", &sixty[..1], 1, 1100);
        // Row 12 can still be opened (the check Rust makes before it opens one), and ticking needs only a good id.
        assert_eq!(check_open_task("wall2", "row-11", &reads), Ok(()));
        assert!(shown_in(&reads, "row-59"));
        assert_eq!(reads.len(), 1, "the same kind of read keeps one entry");
        assert_eq!(reads[0].ids.len(), 60, "the union holds each id once");
        // The union keeps the long read's limit and time, so a one row read cannot extend it.
        assert_eq!((reads[0].limit, reads[0].at), (60, 1000));
        // A newer id from the short read is in front and also openable.
        let newer = [shown_task("row-new")];
        remember_in_n(&mut reads, "work-due", &newer, 1, 1200);
        assert!(shown_in(&reads, "row-new") && shown_in(&reads, "row-11"));
        assert_eq!(reads[0].ids[0], "row-new");
        // Even after five minutes, a short read must preserve rows the page still shows.
        remember_in_n(&mut reads, "work-due", &sixty[..1], 1, 1000 + SHOWN_FRESH_SECS + 1);
        assert!(shown_in(&reads, "row-0") && shown_in(&reads, "row-11"));
        // The next full read replaces the union at once and sets the limit again.
        remember_in_n(&mut reads, "work-due", &sixty[10..20], 60, 2000);
        assert!(shown_in(&reads, "row-12") && !shown_in(&reads, "row-0"));
        assert_eq!(reads[0].limit, 60);
        // A different kind of read is never merged in.
        remember_in_n(&mut reads, "other", &sixty[..1], 1, 2001);
        assert_eq!(reads.len(), 2);
    }

    #[test]
    fn summary_drops_by_not_tag() {
        let got = summarize(&summary_body(), Filters { not_tag: Some("home"), ..Filters::default() }, NOW, &us_east);
        assert_eq!(ids(&got), ["2", "5"]);
        assert_eq!(got.due_tomorrow, DueTomorrow { count: 1, est_minutes: 60 });
    }

    #[test]
    fn summary_filters_by_bucket_and_combines() {
        let by_bucket = summarize(&summary_body(), Filters { bucket_id: Some("B1"), ..Filters::default() }, NOW, &us_east);
        assert_eq!(ids(&by_bucket), ["1", "4", "5"]);
        let both = summarize(&summary_body(), Filters { tag: Some("home"), bucket_id: Some("B2"), ..Filters::default() }, NOW, &us_east);
        assert_eq!(ids(&both), ["3"]);
        let none = summarize(&summary_body(), Filters { bucket_id: Some("B9"), ..Filters::default() }, NOW, &us_east);
        assert!(none.next.is_empty());
        assert_eq!(none.remaining, 0);
    }

    #[test]
    fn summary_of_a_missing_body_is_empty() {
        let got = summarize(&Value::Null, Filters::default(), NOW, &us_east);
        assert_eq!(got, TasksSummary { next: vec![], remaining: 0, due_tomorrow: DueTomorrow { count: 0, est_minutes: 0 }, due_today: None });
    }

    #[test]
    fn task_id_validation() {
        assert!(valid_task_id("abc_123-XYZ"));
        assert!(valid_task_id(&"a".repeat(64)));
        assert!(!valid_task_id(""));
        assert!(!valid_task_id(&"a".repeat(65)));
        assert!(!valid_task_id("../x"));
        assert!(!valid_task_id("a b"));
        assert!(!valid_task_id("a?b=1"));
    }

    #[test]
    fn tasks_filter_and_cut_to_three() {
        let body = json!({"tasks": [
            {"id": "n", "title": "A note", "kind": "note", "status": "open"},
            {"id": "d", "title": "Done one", "kind": "task", "status": "done"},
            {"id": "1", "title": "One", "kind": "task", "status": "open", "due_at": "2026-11-11T20:00:00Z", "due_is_all_day": false, "quadrant": "hotfix"},
            {"id": "2", "title": "Two", "kind": "task", "status": "open", "due_is_all_day": true},
            {"id": "3", "title": "x".repeat(300), "kind": "task", "status": "open"},
            {"id": "4", "title": "Four", "kind": "task", "status": "open"}
        ]});
        let got = pick_tasks(&body);
        assert_eq!(got.len(), 3);
        assert_eq!(got[0].id, "1");
        assert_eq!(got[0].due_at.as_deref(), Some("2026-11-11T20:00:00Z"));
        assert_eq!(got[0].quadrant.as_deref(), Some("hotfix"));
        assert!(got[1].due_is_all_day);
        assert_eq!(got[1].due_at, None);
        assert_eq!(got[2].title.chars().count(), 200);
        assert!(pick_tasks(&json!({"nope": 1})).is_empty());
    }

    fn alert(extra: Value) -> Value {
        let mut a = json!({"id": "a1"});
        a.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        a
    }

    #[test]
    fn requested_review_hides() {
        let a = alert(json!({"requests": {"reviewed": {"status": "requested"}}}));
        assert!(alert_hidden(&a, 100.0));
        let latest = alert(json!({"request": {"action": "reviewed", "status": "requested"}}));
        assert!(alert_hidden(&latest, 100.0));
    }

    #[test]
    fn done_request_hides_until_newer_summary() {
        let a = alert(json!({"requests": {"name": {"status": "done", "finishedAt": "2026-11-11T10:00:00Z"}}}));
        let before = parse_iso("2026-11-11T09:00:00Z").unwrap();
        let after = parse_iso("2026-11-11T11:00:00Z").unwrap();
        assert!(alert_hidden(&a, before));
        assert!(alert_hidden(&a, parse_iso("2026-11-11T10:00:00Z").unwrap()));
        assert!(!alert_hidden(&a, after));
    }

    #[test]
    fn failed_request_hides_nothing() {
        let a = alert(json!({"requests": {"reviewed": {"status": "failed"}, "revoke-key": {"status": "failed"}}}));
        assert!(!alert_hidden(&a, 100.0));
    }

    #[test]
    fn unreadable_times_keep_a_done_request_hiding() {
        let bad_finished = alert(json!({"requests": {"reviewed": {"status": "done", "finishedAt": "soon"}}}));
        assert!(alert_hidden(&bad_finished, 100.0));
        let ok = alert(json!({"requests": {"reviewed": {"status": "done", "finishedAt": "2026-11-11T10:00:00Z"}}}));
        assert!(alert_hidden(&ok, f64::NAN));
        // Without a usable receivedAt the count keeps the hidden alert out.
        assert_eq!(visible_alerts(&[ok.clone(), json!({"id": "b"})], Some(&json!("garbage"))), 1);
        assert_eq!(visible_alerts(&[ok, json!({"id": "b"})], Some(&json!("2026-11-12T00:00:00Z"))), 2);
    }

    #[test]
    fn alert_without_id_is_never_hidden() {
        assert!(!alert_hidden(&json!({"requests": {"reviewed": {"status": "requested"}}}), 1.0));
        assert!(!alert_hidden(&json!("text"), 1.0));
    }

    #[test]
    fn time_parsing_accepts_these_shapes() {
        assert_eq!(parse_iso("1970-01-01T00:00:00Z"), Some(0.0));
        assert_eq!(parse_iso("1970-01-01T00:00Z"), Some(0.0)); // no seconds
        assert_eq!(parse_iso("1970-01-01T01:00:00+01:00"), Some(0.0));
        assert_eq!(parse_iso("1970-01-01T01:00+01:00"), Some(0.0));
        assert_eq!(parse_iso("1969-12-31T16:00:00-08:00"), Some(0.0));
        assert_eq!(parse_iso("1970-01-01T00:00:00.500Z"), Some(0.5));
        assert_eq!(parse_iso("1970-01-01T00:00:00.123456+00:00"), Some(0.123456));
        assert_eq!(parse_iso("1970-01-01T23:59:59-23:59"), Some(86_399.0 + 86_340.0));
        assert!(parse_iso("2024-02-29T12:00:00Z").is_some()); // leap day
        assert!(parse_iso("2000-02-29T12:00:00Z").is_some()); // 400 year rule
        assert!(parse_iso("2026-12-31T23:59:59Z").is_some());
    }

    #[test]
    fn time_parsing_rejects_these_shapes() {
        for bad in [
            "nope",
            "",
            "2026-11-11",                // date only
            "2026-11-11T10:00",          // naive, no seconds
            "2026-11-11T10:00:00",       // naive
            "2026-11-11T10:00:00.5",     // naive with fraction
            "2026-11-11 10:00:00Z",      // space separator
            "2026-11-11t10:00:00Z",      // lower case T
            "2026-11-11T10:00:00z",      // lower case z
            "2026-13-01T00:00:00Z",      // month 13
            "2026-00-10T00:00:00Z",      // month 0
            "2026-04-31T00:00:00Z",      // April has 30 days
            "2025-02-29T00:00:00Z",      // not a leap year
            "1900-02-29T00:00:00Z",      // century, not a leap year
            "2026-11-00T00:00:00Z",      // day 0
            "2026-11-11T24:00:00Z",      // hour 24
            "2026-11-11T10:60:00Z",      // minute 60
            "2026-11-11T10:00:60Z",      // second 60 (leap seconds are not read)
            "2026-11-11T10:00:00.Z",     // empty fraction
            "2026-11-11T10:00.5Z",       // fraction without seconds
            "2026-11-11T10:00.5+01:00",  // fraction without seconds, with offset
            "2026-11-11T10:00:00+24:00", // offset of a full day
            "2026-11-11T10:00:00+01:60", // offset minute 60
            "2026-11-11T10:00:00+0100",  // offset without a colon
            "2026-11-11T10:00:00+01",    // offset hour only
            "2026-11-11T10:00:00Zjunk",  // trailing text
            "0000-01-01T00:00:00Z",      // year 0
            "+026-11-11T10:00:00Z",      // sign in a date field
        ] {
            assert_eq!(parse_iso(bad), None, "{bad}");
        }
    }

    #[test]
    fn naive_time_keeps_a_done_request_hiding() {
        let a = alert(json!({"requests": {"name": {"status": "done", "finishedAt": "2026-11-11T10:00:00"}}}));
        assert!(alert_hidden(&a, parse_iso("2026-12-01T00:00:00Z").unwrap()));
    }

    #[test]
    fn only_2xx_counts_as_success() {
        assert!(status_ok(200));
        assert!(status_ok(204));
        assert!(status_ok(299));
        assert!(!status_ok(199));
        assert!(!status_ok(301));
        assert!(!status_ok(302));
        assert!(!status_ok(404));
        assert!(!status_ok(500));
    }

    #[test]
    fn https_link_checks() {
        assert!(https_link("https://example.invalid/app/#/security").is_some());
        assert!(https_link("https://home.example.invalid:8443/a?b=1").is_some());
        assert!(https_link("http://example.invalid/").is_none());
        assert!(https_link("https://user@example.invalid/").is_none());
        assert!(https_link("https://example.invalid@evil.example/").is_none());
        assert!(https_link("https://example.invalid:abc/").is_none());
        assert!(https_link("https:///path").is_none());
        assert!(https_link("https://exa mple.invalid/").is_none());
        assert!(https_link("https://example.invalid\\evil").is_none());
        assert!(https_link("javascript:alert(1)").is_none());
        assert!(https_link("").is_none());
    }

    #[test]
    fn security_link_reads_the_optional_key() {
        let ok = r#"{"homeSecurityUrl": "https://example.invalid/app/#/security"}"#;
        assert_eq!(security_link_from_config(Some(ok)).as_deref(), Some("https://example.invalid/app/#/security"));
        assert!(security_link_from_config(Some(r#"{"homeBaseUrl": "http://192.0.2.5:5000"}"#)).is_none());
        assert!(security_link_from_config(Some(r#"{"homeSecurityUrl": "http://example.invalid/"}"#)).is_none());
        assert!(security_link_from_config(Some(r#"{"homeSecurityUrl": 5}"#)).is_none());
        assert!(security_link_from_config(Some("not json")).is_none());
        assert!(security_link_from_config(None).is_none());
    }

    #[test]
    fn youtube_music_link_is_fixed() {
        assert_eq!(fixed_link("youtube-music"), Some("https://music.youtube.com/"));
        assert_eq!(fixed_link("youtube-terms"), Some("https://www.youtube.com/t/terms"));
        assert_eq!(fixed_link("google-privacy"), Some("https://policies.google.com/privacy"));
        assert_eq!(fixed_link("https://www.youtube.com/t/terms"), None);
        assert_eq!(fixed_link("other"), None);
    }

    #[test]
    fn portal_link_is_replaced_by_a_new_one_and_never_cleared() {
        let a = Some("https://my.firewalla.net/a".to_string());
        let b = Some("https://my.firewalla.net/b".to_string());
        assert_eq!(next_portal(None, a.clone()), a);
        assert_eq!(next_portal(a.clone(), b.clone()), b);
        assert_eq!(next_portal(a.clone(), None), a);
        assert_eq!(next_portal(None, None), None);
    }

    #[test]
    fn portal_host_check() {
        let ok = |s: &str| portal_link(Some(&json!(s)));
        assert!(ok("https://firewalla.net/x").is_some());
        assert!(ok("https://my.firewalla.net/box/abc?x=1").is_some());
        assert!(ok("https://MY.Firewalla.NET").is_some());
        assert!(ok("http://my.firewalla.net/").is_none());
        assert!(ok("https://evilfirewalla.net/").is_none());
        assert!(ok("https://firewalla.net.evil.example/").is_none());
        assert!(ok("https://my.firewalla.net@evil.example/").is_none());
        assert!(ok("https://example.invalid/").is_none());
        assert!(portal_link(Some(&json!(5))).is_none());
        assert!(portal_link(None).is_none());
    }

    #[test]
    fn shape_reads_a_full_body() {
        let body = json!({
            "ok": true, "stale": false, "receivedAt": "2026-11-11T12:00:00Z",
            "summary": {
                "lastScan": "2026-11-11T11:55:00Z",
                "alerts": [{"id": "a"}, {"id": "b", "requests": {"reviewed": {"status": "requested"}}}],
                "health": {"firewalla": {"api": "up", "boxOnline": true, "checkedAt": "2026-11-11T11:58:00Z", "alarms24h": 3,
                    "portalUrl": "https://my.firewalla.net/x"}}
            }
        });
        let s = shape_security(&body);
        assert!(s.reachable && !s.stale);
        assert_eq!(s.alerts, 1);
        assert_eq!(s.last_scan.as_deref(), Some("2026-11-11T11:55:00Z"));
        let fw = s.firewalla.unwrap();
        assert_eq!((fw.api.as_str(), fw.box_online, fw.alarms24h), ("up", Some(true), Some(3)));
        assert_eq!(s.portal_url.as_deref(), Some("https://my.firewalla.net/x"));
    }

    #[test]
    fn humanize_slug_reads_a_type_as_words() {
        assert_eq!(humanize_slug("abnormal_upload"), "Abnormal upload");
        assert_eq!(humanize_slug("new-device__joined"), "New device joined");
        assert_eq!(humanize_slug("Already words"), "Already words");
        assert_eq!(humanize_slug("_-_"), "");
        assert_eq!(humanize_slug("étrange_type"), "Étrange type");
        // A title is never rewritten, only a type.
        let rows = alert_rows(&[json!({"id": "t", "title": "keep_this", "type": "x_y"})], None);
        assert_eq!(rows[0].text, "keep_this");
    }

    #[test]
    fn alert_rows_read_text_severity_and_time() {
        let alerts = vec![
            json!({"id": "a", "title": "  New device\n joined  ", "severity": "High", "firstSeen": "2026-11-11T10:00:00Z"}),
            json!({"id": "b", "message": "Port scan blocked", "level": "info", "ts": 1_794_380_000}),
            json!({"id": "c", "type": "abnormal_upload", "ts": 1_794_395_000_000u64}),
            json!({"id": "d"}),
            json!({"id": "e", "title": "Hidden", "requests": {"reviewed": {"status": "requested"}}}),
            json!({"id": "f", "title": "No time", "severity": "sideways"}),
        ];
        let rows = alert_rows(&alerts, None);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].text, "Abnormal upload");
        assert_eq!(rows[0].at_ms, Some(1_794_395_000_000));
        assert_eq!((rows[1].text.as_str(), rows[1].severity.as_deref()), ("New device joined", Some("high")));
        assert_eq!(rows[1].at_ms, Some(1_794_391_200_000));
        assert_eq!((rows[2].text.as_str(), rows[2].severity.as_deref()), ("Port scan blocked", Some("low")));
        assert_eq!(rows[2].at_ms, Some(1_794_380_000_000));
        let long = alert_rows(&[json!({"id": "x", "title": "y".repeat(500)})], None);
        assert_eq!(long[0].text.chars().count(), MAX_ALERT_CHARS);
        assert_eq!((long[0].severity.clone(), long[0].at_ms), (None, None));
    }

    #[test]
    fn shape_handles_odd_bodies() {
        assert!(!shape_security(&json!("x")).reachable);
        assert!(!shape_security(&json!({"ok": false})).reachable);
        let no_scan = shape_security(&json!({"ok": true}));
        assert!(no_scan.reachable && no_scan.stale);
        let odd = shape_security(&json!({"ok": true, "summary": {"health": {"firewalla": {"api": "sideways", "boxOnline": "yes"}}}}));
        let fw = odd.firewalla.unwrap();
        assert_eq!((fw.api.as_str(), fw.box_online), ("unknown", None));
    }
}
