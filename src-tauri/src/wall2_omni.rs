//! Wall 2 helper client: reads the agent lanes helper's summary and the machine numbers.
//!
//! The address comes from `feeds.json` (`omniHelperUrl`, https only, host and optional
//! port) and is never put in an error message. Session links use the host from
//! `feeds.json` (`omniLinkHost`, a bare hostname). Every failure maps to a fixed string:
//! `not-configured`, `invalid-config`, `failed`, `forbidden`. Nothing here logs, and
//! nothing here takes a wake lock. The web view never supplies a URL: it passes a session
//! id, and Rust builds the link after checking the id.

use crate::wall2_feeds::{agent, read_base, require_ok, NOT_CONFIGURED};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

const INVALID_CONFIG: &str = "invalid-config";
const FAILED: &str = "failed";
const FORBIDDEN: &str = "forbidden";
const WALL2_LABEL: &str = "wall2";

/// The helper caps its own answers at 64 KB; anything larger is not from the helper.
const MAX_ANSWER: usize = 64 * 1024;
const MAX_LANES: usize = 3;
/// The slot limit when the helper does not send one.
const DEFAULT_SLOTS: u64 = 3;
/// Slot numbers are shown as they are ("5 of 4 slots"); this only refuses nonsense.
const MAX_SLOTS: u64 = 99;
const MAX_ELAPSED_S: u64 = 7 * 24 * 3600;
const MAX_DAY: usize = 200;
const MAX_TITLE_CHARS: usize = 80;
const MAX_LINE_CHARS: usize = 80;
const MAX_QUESTION_CHARS: usize = 200;
const MAX_STAMP_CHARS: usize = 40;
/// Cap on the extra slot counts and on a parent's child counts; this only refuses nonsense.
const MAX_COUNT: u64 = 999;
/// The full session list (parents and standalone sessions) the helper sends after the lanes.
const MAX_SESSIONS_LIST: usize = 12;
/// Session names by id.
const MAX_NAMES: usize = 40;
/// Session ids of the your-move list.
const MAX_WAITING_IDS: usize = 5;
/// Usage accounts, one per subscription.
const MAX_ACCOUNTS: usize = 6;
const MAX_NEXT_CHARS: usize = 60;
const MAX_ACCOUNT_LABEL_CHARS: usize = 24;
/// The box numbers ride on the helper summary, which is read at most this often.
const BOX_TTL: Duration = Duration::from_secs(15);
/// The box read has its own, shorter timeout, and runs in the background.
const BOX_TIMEOUT: Duration = Duration::from_secs(3);
/// After a failed read the last good numbers stay, marked stale, for this long.
const BOX_STALE_LIMIT: Duration = Duration::from_secs(600);

// Section: types

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Slots {
    pub used: u64,
    pub limit: u64,
    /// Parents and standalone sessions that are working, blocked or in review. Null when the
    /// helper does not send it.
    pub sessions: Option<u64>,
    /// How many of those are working. Null when absent.
    pub working: Option<u64>,
    /// Child sessions in total. Null when absent.
    pub helpers: Option<u64>,
}

/// A parent session's children: how many, and how many of them are working.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Kids {
    pub total: u64,
    pub working: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LanePr {
    pub number: u64,
    pub ci: String,
    pub ready: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lane {
    pub id: String,
    pub title: String,
    pub stage: String,
    pub state: String,
    pub line: String,
    pub elapsed_s: u64,
    pub waiting: bool,
    pub pr: Option<LanePr>,
    /// `working` or `idle`, when the helper knows; null otherwise.
    pub live: Option<String>,
    /// Seconds since the session last did something; null when absent.
    pub idle_s: Option<u64>,
    /// Parents only; null otherwise.
    pub kids: Option<Kids>,
    /// Seconds the session has waited on the owner; null when absent.
    pub waiting_since_s: Option<u64>,
    /// The session's own next step text; null when absent or empty.
    pub next: Option<String>,
    /// `claude`, `codex` or `other`; null when absent.
    pub harness: Option<String>,
    /// True only when the helper sends exactly `true`.
    pub failed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YourMoveFirst {
    pub session_id: String,
    pub title: String,
    pub kind: String,
    /// None when the helper's value is not an RFC 3339 time.
    pub since: Option<String>,
    pub question: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct YourMove {
    pub total: u64,
    pub first: Option<YourMoveFirst>,
    /// Up to five session ids from the your-move list, in the helper's order. Empty when absent.
    pub ids: Vec<String>,
}

/// One subscription's usage. The label is made by the helper ("Claude 1"); no account name.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageAccount {
    /// `claude`, `codex` or `other`.
    pub provider: String,
    pub label: String,
    pub week_pct: Option<f64>,
    pub five_hour_pct: Option<f64>,
    pub week_resets_at: Option<String>,
}

/// A session's name and where it stands, for any id the wall may show.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SessionName {
    pub title: String,
    pub stage: Option<String>,
    pub state: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    /// None when the helper has no valid week figure but does list accounts.
    pub claude_week_pct: Option<f64>,
    /// None when the helper has no five hour figure; the wall hides that part.
    pub claude5h_pct: Option<f64>,
    pub week_resets_at: Option<String>,
    /// Up to six subscriptions. Empty when absent.
    pub accounts: Vec<UsageAccount>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DaySpan {
    pub lane: String,
    pub start: String,
    pub end: Option<String>,
    pub kind: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoxSystem {
    pub cpu_pct: f64,
    pub ram_pct: f64,
    pub gpu_pct: Option<f64>,
    pub temp_c: Option<f64>,
    pub load1: f64,
    pub uptime_s: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OmniSummary {
    pub now: String,
    pub tz: String,
    pub stale: bool,
    pub slots: Slots,
    pub lanes: Vec<Lane>,
    /// Every parent or standalone session that is open, up to 12. None when the helper does
    /// not send the list (an older helper), so the web view can fall back to `lanes`.
    #[serde(rename = "sessionsList")]
    pub sessions_list: Option<Vec<Lane>>,
    /// Session names by id, up to 40. Empty when absent.
    pub sessions: BTreeMap<String, SessionName>,
    pub parked: u64,
    #[serde(rename = "yourMove")]
    pub your_move: YourMove,
    pub usage: Option<Usage>,
    pub day: Vec<DaySpan>,
    pub system: Option<BoxSystem>,
    /// False when `omniLinkHost` is missing or invalid, so the web view can hide the tap.
    #[serde(rename = "linksAvailable")]
    pub links_available: bool,
}

// Section: validation and parsing

/// `^[a-f0-9-]{8,64}$`
fn valid_session_id(id: &str) -> bool {
    (8..=64).contains(&id.len()) && id.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f' | '-'))
}

/// A bare hostname: 1 to 253 characters, dot separated labels of letters, digits and
/// hyphens (1 to 63 each, none starting or ending with a hyphen). No scheme, port, path
/// or user name.
fn valid_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && host.split('.').all(|label| {
            (1..=63).contains(&label.len())
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        })
}

/// The `omniLinkHost` key of `feeds.json` text. Missing is `not-configured`; a bad value
/// is `invalid-config`.
fn link_host_from_config(json_text: Option<&str>) -> Result<String, String> {
    let text = json_text.ok_or_else(|| NOT_CONFIGURED.to_string())?;
    let value: Value = serde_json::from_str(text).map_err(|_| INVALID_CONFIG.to_string())?;
    match value.get("omniLinkHost").and_then(Value::as_str) {
        Some(s) if !s.trim().is_empty() => {
            let host = s.trim();
            if valid_host(host) {
                Ok(host.to_string())
            } else {
                Err(INVALID_CONFIG.to_string())
            }
        }
        _ => Err(NOT_CONFIGURED.to_string()),
    }
}

fn link_host(app: &tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_config_dir().map_err(|_| NOT_CONFIGURED.to_string())?;
    let text = std::fs::read_to_string(dir.join("feeds.json")).ok();
    link_host_from_config(text.as_deref())
}

/// The deep link for a session. None when the host or the id is not valid.
fn session_url(host: &str, id: &str) -> Option<String> {
    (valid_host(host) && valid_session_id(id)).then(|| format!("omnigent://{host}/c/{id}"))
}

/// Bidirectional controls and zero-width characters, which can disguise text.
fn is_format_char(c: char) -> bool {
    matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2069}' | '\u{FEFF}')
}

/// Text with control characters dropped, trimmed, cut to `max` characters.
fn clean_text(v: Option<&Value>, max: usize) -> Option<String> {
    let s = v?.as_str()?;
    let s: String = s.chars().filter(|c| !c.is_control() && !is_format_char(*c)).collect();
    let s = s.trim();
    Some(s.chars().take(max).collect())
}

/// Milliseconds since the Unix epoch of an RFC 3339 time with a `Z` or `+HH:MM` offset
/// (`2026-11-12T18:24:00Z`, `2026-11-12T10:24:00.5-08:00`). None for anything else: a date
/// alone, no offset, an impossible date or time, or more than 40 characters.
fn stamp_millis(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 20 || b.len() > MAX_STAMP_CHARS {
        return None;
    }
    let num = |from: usize, len: usize| -> Option<i64> {
        let part = b.get(from..from + len)?;
        part.iter().all(u8::is_ascii_digit).then(|| part.iter().fold(0i64, |n, d| n * 10 + i64::from(d - b'0')))
    };
    let sep = |at: usize, c: u8| b.get(at) == Some(&c);
    let (year, month, day) = (num(0, 4)?, num(5, 2)?, num(8, 2)?);
    let (hour, minute, second) = (num(11, 2)?, num(14, 2)?, num(17, 2)?);
    if !(sep(4, b'-') && sep(7, b'-') && (sep(10, b'T') || sep(10, b't')) && sep(13, b':') && sep(16, b':')) {
        return None;
    }
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let month_days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if !(1..=12).contains(&month) || day < 1 || day > month_days[(month - 1) as usize] || hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    let mut i = 19;
    let mut millis = 0;
    if sep(i, b'.') {
        i += 1;
        let digits = b[i..].iter().take_while(|c| c.is_ascii_digit()).count();
        if !(1..=9).contains(&digits) {
            return None;
        }
        millis = b[i..i + digits].iter().take(3).enumerate().fold(0i64, |n, (k, d)| n + i64::from(d - b'0') * [100, 10, 1][k]);
        i += digits;
    }
    let offset_min = match b.get(i).copied() {
        Some(b'Z' | b'z') if b.len() == i + 1 => 0,
        Some(sign) if (sign == b'+' || sign == b'-') && b.len() == i + 6 && sep(i + 3, b':') => {
            let (oh, om) = (num(i + 1, 2)?, num(i + 4, 2)?);
            if oh > 23 || om > 59 {
                return None;
            }
            if sign == b'+' {
                oh * 60 + om
            } else {
                -(oh * 60 + om)
            }
        }
        _ => return None,
    };
    // Days from the civil date (proleptic Gregorian), then seconds, then the offset.
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let secs = days * 86_400 + hour * 3600 + minute * 60 + second - offset_min * 60;
    Some(secs * 1000 + millis)
}

/// A helper timestamp, passed on only when it is a valid RFC 3339 time (never cut short).
fn stamp(v: Option<&Value>) -> Option<String> {
    let s = v?.as_str()?;
    stamp_millis(s).map(|_| s.to_string())
}

fn one_of(v: Option<&Value>, allowed: &[&str]) -> Option<String> {
    let s = v?.as_str()?;
    allowed.contains(&s).then(|| s.to_string())
}

/// A whole, non-negative JSON number. A fraction or a negative is None.
fn count(v: Option<&Value>) -> Option<u64> {
    v?.as_u64().map(|n| n.min(1_000_000_000_000))
}

fn percent(v: Option<&Value>) -> Option<f64> {
    let n = v?.as_f64()?;
    n.is_finite().then(|| n.clamp(0.0, 100.0))
}

fn shape_lane(v: &Value) -> Option<Lane> {
    let id = v.get("id")?.as_str().filter(|s| valid_session_id(s))?.to_string();
    let pr = v.get("pr").filter(|p| p.is_object()).and_then(|p| {
        Some(LanePr {
            number: count(p.get("number")).filter(|n| *n > 0)?,
            ci: one_of(p.get("ci"), &["passing", "failing", "pending", "none"])?,
            ready: p.get("ready")?.as_bool()?,
        })
    });
    Some(Lane {
        id,
        title: clean_text(v.get("title"), MAX_TITLE_CHARS)?,
        stage: one_of(v.get("stage"), &["plan", "build", "review", "pr", "live"])?,
        state: one_of(v.get("state"), &["working", "blocked", "review"])?,
        line: clean_text(v.get("line"), MAX_LINE_CHARS).unwrap_or_default(),
        elapsed_s: count(v.get("elapsedS")).map_or(0, |n| n.min(MAX_ELAPSED_S)),
        waiting: v.get("waiting").and_then(Value::as_bool).unwrap_or(false),
        pr,
        live: one_of(v.get("live"), &["working", "idle"]),
        idle_s: count(v.get("idleS")).map(|n| n.min(MAX_ELAPSED_S)),
        kids: shape_kids(v.get("kids")),
        waiting_since_s: count(v.get("waitingSinceS")).map(|n| n.min(MAX_ELAPSED_S)),
        next: clean_text(v.get("next"), MAX_NEXT_CHARS).filter(|s| !s.is_empty()),
        harness: v.get("harness").and_then(Value::as_str).filter(|s| !s.is_empty()).map(provider_name),
        failed: v.get("failed") == Some(&Value::Bool(true)),
    })
}

/// `{ total, working }`, both whole numbers, capped, with `working` never above `total`.
fn shape_kids(v: Option<&Value>) -> Option<Kids> {
    let v = v.filter(|k| k.is_object())?;
    let total = count(v.get("total"))?.min(MAX_COUNT);
    let working = count(v.get("working"))?.min(MAX_COUNT).min(total);
    Some(Kids { total, working })
}

/// `claude` and `codex` pass; any other harness or provider name is `other`.
fn provider_name(s: &str) -> String {
    match s {
        "claude" | "codex" => s.to_string(),
        _ => "other".to_string(),
    }
}

/// Valid lanes in order, the first of each id kept, at most `cap`.
fn shape_lane_list(items: &[Value], cap: usize) -> Vec<Lane> {
    let mut out: Vec<Lane> = Vec::new();
    for lane in items.iter().filter_map(shape_lane) {
        if out.len() >= cap {
            break;
        }
        if !out.iter().any(|l| l.id == lane.id) {
            out.push(lane);
        }
    }
    out
}

/// The helper's `sessions` map: valid ids with a title, in the helper's order, at most 40.
fn shape_names(v: Option<&Value>) -> BTreeMap<String, SessionName> {
    let Some(obj) = v.and_then(Value::as_object) else { return BTreeMap::new() };
    obj.iter()
        .filter(|(id, _)| valid_session_id(id))
        .filter_map(|(id, entry)| {
            entry.as_object()?;
            let title = clean_text(entry.get("title"), MAX_TITLE_CHARS).filter(|t| !t.is_empty())?;
            Some((
                id.clone(),
                SessionName {
                    title,
                    stage: one_of(entry.get("stage"), &["plan", "build", "review", "pr", "live"]),
                    state: one_of(entry.get("state"), &["working", "blocked", "review"]),
                },
            ))
        })
        .take(MAX_NAMES)
        .collect()
}

fn shape_your_move(v: Option<&Value>) -> YourMove {
    let Some(v) = v else { return YourMove { total: 0, first: None, ids: Vec::new() } };
    let first = v.get("first").filter(|f| f.is_object()).and_then(|f| {
        Some(YourMoveFirst {
            session_id: f.get("sessionId")?.as_str().filter(|s| valid_session_id(s))?.to_string(),
            title: clean_text(f.get("title"), MAX_TITLE_CHARS)?,
            kind: one_of(f.get("kind"), &["gate", "awaiting", "blocked", "review"])?,
            since: stamp(f.get("since")),
            question: clean_text(f.get("question"), MAX_QUESTION_CHARS).unwrap_or_default(),
        })
    });
    let mut ids: Vec<String> = Vec::new();
    for id in v.get("ids").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]) {
        if ids.len() >= MAX_WAITING_IDS {
            break;
        }
        if let Some(id) = id.as_str().filter(|s| valid_session_id(s)) {
            if !ids.iter().any(|k| k == id) {
                ids.push(id.to_string());
            }
        }
    }
    YourMove { total: count(v.get("total")).unwrap_or(0), first, ids }
}

/// None when the block is missing, or when it has neither a valid week figure nor any account.
fn shape_usage(v: Option<&Value>) -> Option<Usage> {
    let v = v.filter(|u| u.is_object())?;
    let claude_week_pct = percent(v.get("claudeWeekPct"));
    let accounts = shape_accounts(v.get("accounts"));
    if claude_week_pct.is_none() && accounts.is_empty() {
        return None;
    }
    Some(Usage {
        claude_week_pct,
        claude5h_pct: percent(v.get("claude5hPct")),
        week_resets_at: stamp(v.get("weekResetsAt")),
        accounts,
    })
}

/// Entries need a string provider and a non-empty label; at most six.
fn shape_accounts(v: Option<&Value>) -> Vec<UsageAccount> {
    let Some(items) = v.and_then(Value::as_array) else { return Vec::new() };
    items
        .iter()
        .filter_map(|a| {
            a.as_object()?;
            let provider = provider_name(a.get("provider")?.as_str()?);
            let label = clean_text(a.get("label"), MAX_ACCOUNT_LABEL_CHARS).filter(|s| !s.is_empty())?;
            Some(UsageAccount {
                provider,
                label,
                week_pct: percent(a.get("weekPct")),
                five_hour_pct: percent(a.get("fiveHourPct")),
                week_resets_at: stamp(a.get("weekResetsAt")),
            })
        })
        .take(MAX_ACCOUNTS)
        .collect()
}

fn shape_day(v: Option<&Value>) -> Vec<DaySpan> {
    let Some(items) = v.and_then(Value::as_array) else { return Vec::new() };
    items
        .iter()
        .filter_map(|d| {
            let start = stamp(d.get("start"))?;
            // A missing or null end is an open span; any other end must be a valid time.
            let end = match d.get("end") {
                None | Some(Value::Null) => None,
                Some(v) => Some(stamp(Some(v))?),
            };
            if let Some(e) = &end {
                if stamp_millis(e)? < stamp_millis(&start)? {
                    return None;
                }
            }
            Some(DaySpan {
                lane: d.get("lane")?.as_str().filter(|s| valid_session_id(s))?.to_string(),
                start,
                end,
                kind: one_of(d.get("kind"), &["run", "wait", "done"])?,
            })
        })
        .take(MAX_DAY)
        .collect()
}

fn shape_system(v: Option<&Value>) -> Option<BoxSystem> {
    let v = v.filter(|s| s.is_object())?;
    let load1 = v.get("load1").and_then(Value::as_f64).filter(|n| n.is_finite() && *n >= 0.0).unwrap_or(0.0);
    let temp_c = v.get("tempC").and_then(Value::as_f64).filter(|n| n.is_finite() && (-50.0..=200.0).contains(n));
    Some(BoxSystem {
        cpu_pct: percent(v.get("cpuPct"))?,
        ram_pct: percent(v.get("ramPct"))?,
        gpu_pct: percent(v.get("gpuPct")),
        temp_c,
        load1,
        uptime_s: count(v.get("uptimeS")).unwrap_or(0),
    })
}

/// Shape one helper answer. None when it is not a summary at all.
fn shape_summary(body: &Value) -> Option<OmniSummary> {
    let obj = body.as_object()?;
    let lanes: Vec<Lane> = obj.get("lanes")?.as_array()?.iter().filter_map(shape_lane).take(MAX_LANES).collect();
    let slots = obj.get("slots").filter(|s| s.is_object());
    let limit = slots.and_then(|s| count(s.get("limit"))).unwrap_or(DEFAULT_SLOTS).min(MAX_SLOTS);
    let used = slots.and_then(|s| count(s.get("used"))).unwrap_or(lanes.len() as u64).min(MAX_SLOTS);
    let extra = |key: &str| slots.and_then(|s| count(s.get(key))).map(|n| n.min(MAX_COUNT));
    Some(OmniSummary {
        now: stamp(obj.get("now"))?,
        tz: clean_text(obj.get("tz"), 64).unwrap_or_default(),
        stale: obj.get("stale").and_then(Value::as_bool).unwrap_or(false),
        slots: Slots { used, limit, sessions: extra("sessions"), working: extra("working"), helpers: extra("helpers") },
        lanes,
        sessions_list: obj.get("sessionsList").and_then(Value::as_array).map(|items| shape_lane_list(items, MAX_SESSIONS_LIST)),
        sessions: shape_names(obj.get("sessions")),
        parked: count(obj.get("parked")).unwrap_or(0),
        your_move: shape_your_move(obj.get("yourMove")),
        usage: shape_usage(obj.get("usage")),
        day: shape_day(obj.get("day")),
        system: shape_system(obj.get("system")),
        links_available: false,
    })
}

/// Parse the raw bytes of a helper answer: size cap, JSON, then shape.
fn parse_answer(bytes: &[u8]) -> Result<OmniSummary, String> {
    if bytes.len() > MAX_ANSWER {
        return Err(FAILED.to_string());
    }
    let value: Value = serde_json::from_slice(bytes).map_err(|_| FAILED.to_string())?;
    shape_summary(&value).ok_or_else(|| FAILED.to_string())
}

// Section: config and fetch

/// `not-configured` stays as it is; any other config problem is `invalid-config`.
fn config_error(err: String) -> String {
    if err == NOT_CONFIGURED {
        err
    } else {
        INVALID_CONFIG.to_string()
    }
}

fn helper_base(app: &tauri::AppHandle) -> Result<String, String> {
    read_base(app, "omniHelperUrl", true).map_err(config_error)
}

/// Read an answer through the size cap: stop as soon as it is over, never buffer more.
fn read_limited<R: Read>(reader: R) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    reader
        .take(MAX_ANSWER as u64 + 1)
        .read_to_end(&mut buf)
        .map_err(|_| FAILED.to_string())?;
    if buf.len() > MAX_ANSWER {
        return Err(FAILED.to_string());
    }
    Ok(buf)
}

/// Only a 2xx counts (redirects are off, so a 3xx arrives as a response).
fn accept(resp: ureq::Response) -> Result<ureq::Response, String> {
    require_ok(resp).map_err(|_| FAILED.to_string())
}

fn fetch_summary_within(base: &str, timeout: Option<Duration>) -> Result<OmniSummary, String> {
    let mut request = agent().get(&format!("{base}/wall/v1/summary")).set("Accept", "application/json");
    if let Some(t) = timeout {
        request = request.timeout(t);
    }
    let resp = accept(request.call().map_err(|_| FAILED.to_string())?)?;
    parse_answer(&read_limited(resp.into_reader())?)
}

fn fetch_summary(base: &str) -> Result<OmniSummary, String> {
    fetch_summary_within(base, None)
}

// Section: session ids

/// The session ids in the most recent successful summary. A session can be opened only if
/// its id is in here.
static KNOWN_IDS: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn ids_of(s: &OmniSummary) -> Vec<String> {
    let mut ids: Vec<String> = s.lanes.iter().map(|l| l.id.clone()).collect();
    if let Some(list) = &s.sessions_list {
        ids.extend(list.iter().map(|l| l.id.clone()));
    }
    if let Some(first) = &s.your_move.first {
        ids.push(first.session_id.clone());
    }
    ids.extend(s.your_move.ids.iter().cloned());
    ids.extend(s.sessions.keys().cloned());
    ids.extend(s.day.iter().map(|d| d.lane.clone()));
    ids.sort();
    ids.dedup();
    ids
}

fn remember_ids(ids: Vec<String>) {
    if let Ok(mut guard) = KNOWN_IDS.lock() {
        *guard = ids;
    }
}

fn id_is_known(id: &str) -> bool {
    KNOWN_IDS.lock().map(|g| g.iter().any(|k| k == id)).unwrap_or(false)
}

pub(crate) fn require_wall2(label: &str) -> Result<(), String> {
    if label == WALL2_LABEL {
        Ok(())
    } else {
        Err(FORBIDDEN.to_string())
    }
}

#[tauri::command]
pub async fn wall2_omni_summary(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<OmniSummary, String> {
    require_wall2(window.label())?;
    let base = helper_base(&app)?;
    let mut summary = tauri::async_runtime::spawn_blocking(move || fetch_summary(&base))
        .await
        .map_err(|_| FAILED.to_string())??;
    remember_ids(ids_of(&summary));
    summary.links_available = link_host(&app).is_ok();
    Ok(summary)
}

/// Open a session by id: the id must be well formed and in the last summary, and the link
/// is built here from `omniLinkHost`.
fn open_known_session(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    if !valid_session_id(id) {
        return Err("Unknown session".to_string());
    }
    if !id_is_known(id) {
        return Err("Unknown session".to_string());
    }
    let host = link_host(app)?;
    let url = session_url(&host, id).ok_or_else(|| "Unknown session".to_string())?;
    app.opener().open_url(url, None::<&str>).map_err(|_| "Could not open the session".to_string())
}

#[tauri::command]
pub fn wall2_open_session(window: tauri::WebviewWindow, app: tauri::AppHandle, id: String) -> Result<(), String> {
    require_wall2(window.label())?;
    open_known_session(&app, &id)
}

/// Open a session (when an id is given, with the same checks as `wall2_open_session`), then
/// bring the OmniGent desktop window forward onto the primary monitor. The forward step runs
/// on its own thread, so this returns at once, and only one forward step runs at a time: a
/// click while one is under way opens the session but starts no second one. The step trusts
/// only windows whose process image is the exact executable registered for `omnigent://`
/// links (HKCU first, then HKLM); with no handler registered, or one that cannot be read, no
/// window is brought forward (the session link still opens). Hung windows are skipped, and
/// the window is shown and moved with the asynchronous calls, so a stuck OmniGent can never
/// hold the thread. If no OmniGent window shows up within two seconds nothing more happens.
/// On other systems the forward step does nothing.
#[tauri::command]
pub fn wall2_focus_omnigent(window: tauri::WebviewWindow, app: tauri::AppHandle, id: Option<String>) -> Result<(), String> {
    require_wall2(window.label())?;
    if let Some(id) = id {
        open_known_session(&app, &id)?;
    }
    if let Some(guard) = try_begin(&FORWARDING) {
        // The guard moves into the thread and is released when the thread ends, even by a
        // panic. If the thread cannot start, the closure (and the guard) is dropped here.
        let _ = std::thread::Builder::new().spawn(move || {
            let _guard = guard;
            bring_omnigent_forward();
        });
    }
    Ok(())
}

// Section: bringing OmniGent forward

const FOCUS_POLL: Duration = Duration::from_millis(100);
const FOCUS_WAIT: Duration = Duration::from_secs(2);
/// A registered command line longer than this is not trusted.
const MAX_HANDLER_COMMAND: usize = 2048;

/// Held while a forward step runs, so clicks never pile up threads.
static FORWARDING: AtomicBool = AtomicBool::new(false);

/// Proof that this caller holds the forward flag. Dropping it releases the flag.
struct ForwardGuard<'a> {
    flag: &'a AtomicBool,
}

impl Drop for ForwardGuard<'_> {
    fn drop(&mut self) {
        self.flag.store(false, Ordering::Release);
    }
}

/// Take the flag if it is free. None while another guard on the same flag is alive.
fn try_begin(flag: &AtomicBool) -> Option<ForwardGuard<'_>> {
    flag.compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed).ok().map(|_| ForwardGuard { flag })
}

/// The executable path in the command line registered for a link handler. A quoted path
/// (`"C:\Apps\x.exe" "%1"`) gives the text inside the first pair of quotes; an unquoted one
/// gives the text up to the first `.exe` (any case) inclusive, or else up to the first space.
/// None when the line is empty, longer than 2048 characters, or the path does not end in
/// `.exe`.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
fn handler_exe(command_line: &str) -> Option<String> {
    if command_line.chars().count() > MAX_HANDLER_COMMAND {
        return None;
    }
    let line = command_line.trim_start();
    if line.is_empty() {
        return None;
    }
    let path = if let Some(rest) = line.strip_prefix('"') {
        &rest[..rest.find('"')?]
    } else {
        // Lowering ASCII letters keeps every byte offset, so the offset fits the original.
        match line.to_ascii_lowercase().find(".exe") {
            Some(at) => &line[..at + 4],
            None => line.split(' ').next().unwrap_or(""),
        }
    };
    let ends_in_exe = path.len() >= 4 && path.is_char_boundary(path.len() - 4) && path[path.len() - 4..].eq_ignore_ascii_case(".exe");
    ends_in_exe.then(|| path.to_string())
}

/// True when two executable paths name the same file: compared without regard to case,
/// after turning `/` into `\` and removing a leading `\\?\` from either.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
fn same_exe(a: &str, b: &str) -> bool {
    fn plain(p: &str) -> String {
        let p = p.replace('/', "\\");
        let p = p.strip_prefix(r"\\?\").unwrap_or(&p);
        p.to_lowercase()
    }
    let (a, b) = (plain(a), plain(b));
    !a.is_empty() && a == b
}

/// A screen rectangle, edges in pixels.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
#[derive(Clone, Copy, Debug, PartialEq)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

/// The window moved into the work area: same size unless larger than the work area (then cut
/// to it, per dimension), centred.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
fn fit_into(work: Rect, win: Rect) -> Rect {
    let work_w = (i64::from(work.right) - i64::from(work.left)).max(0);
    let work_h = (i64::from(work.bottom) - i64::from(work.top)).max(0);
    let w = (i64::from(win.right) - i64::from(win.left)).clamp(0, work_w);
    let h = (i64::from(win.bottom) - i64::from(win.top)).clamp(0, work_h);
    let left = i64::from(work.left) + (work_w - w) / 2;
    let top = i64::from(work.top) + (work_h - h) / 2;
    // Every value lies inside the work area, so it fits back into i32.
    Rect { left: left as i32, top: top as i32, right: (left + w) as i32, bottom: (top + h) as i32 }
}

/// What matters about one window of the OmniGent process when picking which to bring forward.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
#[derive(Clone, Copy, Debug, PartialEq)]
struct Candidate {
    visible: bool,
    /// It has an owner window (a dialog or tool window), so it is not the main window.
    owned: bool,
    has_title: bool,
}

/// The first visible, unowned window with a title.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
fn pick_window(cands: &[Candidate]) -> Option<usize> {
    cands.iter().position(|c| c.visible && !c.owned && c.has_title)
}

/// Read the registered `omnigent://` handler, then poll every 100 ms for up to two seconds
/// for a window of exactly that executable and bring it forward. No handler, no forward step.
#[cfg(windows)]
fn bring_omnigent_forward() {
    let Some(exe) = focus_win::registered_exe() else {
        return;
    };
    let started = Instant::now();
    loop {
        if focus_win::focus_once(&exe) {
            return;
        }
        if started.elapsed() >= FOCUS_WAIT {
            return;
        }
        std::thread::sleep(FOCUS_POLL);
    }
}

#[cfg(not(windows))]
fn bring_omnigent_forward() {
    let _ = (FOCUS_POLL, FOCUS_WAIT);
}

#[cfg(windows)]
mod focus_win {
    use super::{fit_into, handler_exe, pick_window, same_exe, Candidate, Rect, MAX_HANDLER_COMMAND};
    use std::collections::HashMap;
    use windows::core::{w, PCWSTR, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, BOOL, ERROR_SUCCESS, HWND, LPARAM, POINT, RECT, TRUE};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
        MONITOR_DEFAULTTOPRIMARY,
    };
    use windows::Win32::System::Registry::{RegGetValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindow, GetWindowPlacement, GetWindowRect, GetWindowThreadProcessId,
        InternalGetWindowText, IsHungAppWindow, IsIconic, IsWindowVisible, IsZoomed, SetForegroundWindow, SetWindowPos, ShowWindowAsync,
        GW_OWNER, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOZORDER, SW_MAXIMIZE, SW_RESTORE, WINDOWPLACEMENT,
        WPF_RESTORETOMAXIMIZED,
    };

    /// The default value of `Software\Classes\omnigent\shell\open\command` under one root, as
    /// text. None when it is missing, not a string, or too long to be trusted.
    fn handler_command(root: HKEY) -> Option<String> {
        // Room for the longest accepted line plus one character (so an overlong line is seen
        // and refused by `handler_exe`) and the terminating null.
        let mut buf = vec![0u16; MAX_HANDLER_COMMAND + 2];
        let mut bytes = (buf.len() * 2) as u32;
        let status = unsafe {
            RegGetValueW(
                root,
                w!("Software\\Classes\\omnigent\\shell\\open\\command"),
                PCWSTR::null(),
                RRF_RT_REG_SZ,
                None,
                Some(buf.as_mut_ptr().cast::<std::ffi::c_void>()),
                Some(&mut bytes as *mut u32),
            )
        };
        if status != ERROR_SUCCESS {
            return None;
        }
        let len = ((bytes as usize) / 2).min(buf.len());
        let text = &buf[..len];
        let end = text.iter().position(|&c| c == 0).unwrap_or(text.len());
        Some(String::from_utf16_lossy(&text[..end]))
    }

    /// The executable registered for `omnigent://` links: the current user's handler, else the
    /// machine's. None when neither is registered or the registered one cannot be parsed.
    pub fn registered_exe() -> Option<String> {
        handler_command(HKEY_CURRENT_USER)
            .or_else(|| handler_command(HKEY_LOCAL_MACHINE))
            .and_then(|line| handler_exe(&line))
    }

    unsafe extern "system" fn collect(hwnd: HWND, data: LPARAM) -> BOOL {
        let list = &mut *(data.0 as *mut Vec<HWND>);
        list.push(hwnd);
        TRUE
    }

    fn top_level_windows() -> Vec<HWND> {
        let mut list: Vec<HWND> = Vec::new();
        unsafe {
            let _ = EnumWindows(Some(collect), LPARAM(&mut list as *mut Vec<HWND> as isize));
        }
        list
    }

    /// The full image path of a process, or None when it cannot be read.
    fn image_path(pid: u32) -> Option<String> {
        if pid == 0 {
            return None;
        }
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let read = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
            let _ = CloseHandle(handle);
            let len = (len as usize).min(buf.len());
            (read.is_ok() && len > 0).then(|| String::from_utf16_lossy(&buf[..len]))
        }
    }

    /// Top-level windows, in z order, of processes whose image is exactly `exe`, leaving out
    /// any window that is not answering.
    fn omnigent_windows(exe: &str) -> Vec<HWND> {
        let mut by_pid: HashMap<u32, bool> = HashMap::new();
        top_level_windows()
            .into_iter()
            .filter(|hwnd| {
                let mut pid = 0u32;
                unsafe { GetWindowThreadProcessId(*hwnd, Some(&mut pid as *mut u32)) };
                *by_pid.entry(pid).or_insert_with(|| image_path(pid).is_some_and(|p| same_exe(&p, exe)))
            })
            .filter(|hwnd| unsafe { !IsHungAppWindow(*hwnd).as_bool() })
            .collect()
    }

    fn rect_of(r: RECT) -> Rect {
        Rect { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    }

    /// Restore it if minimised, move it onto the primary monitor if it is elsewhere (keeping
    /// it maximised if it was), then make it the foreground window. Every change is posted to
    /// the window's own thread (`ShowWindowAsync`, `SWP_ASYNCWINDOWPOS`) and is carried out
    /// there in the order posted, so nothing here waits on OmniGent. Because the restore has
    /// not happened yet when the size is read, a minimised or maximised window's size comes
    /// from its normal placement.
    fn bring_forward(hwnd: HWND) {
        unsafe {
            let mut placement = WINDOWPLACEMENT { length: std::mem::size_of::<WINDOWPLACEMENT>() as u32, ..Default::default() };
            let placed = GetWindowPlacement(hwnd, &mut placement).is_ok();
            let iconic = IsIconic(hwnd).as_bool();
            // A minimised window that comes back maximised counts as maximised.
            let zoomed = IsZoomed(hwnd).as_bool()
                || (iconic && placed && (placement.flags.0 & WPF_RESTORETOMAXIMIZED.0) != 0);
            if iconic {
                let _ = ShowWindowAsync(hwnd, SW_RESTORE);
            }
            let primary = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
            let current = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            if current != primary {
                let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
                if GetMonitorInfoW(primary, &mut info).as_bool() {
                    if zoomed {
                        let _ = ShowWindowAsync(hwnd, SW_RESTORE);
                    }
                    // Only the size is used: `fit_into` places the window itself.
                    let size = if iconic || zoomed {
                        placed.then_some(placement.rcNormalPosition)
                    } else {
                        let mut r = RECT::default();
                        GetWindowRect(hwnd, &mut r).is_ok().then_some(r)
                    };
                    if let Some(r) = size {
                        let to = fit_into(rect_of(info.rcWork), rect_of(r));
                        let _ = SetWindowPos(
                            hwnd,
                            HWND::default(),
                            to.left,
                            to.top,
                            to.right - to.left,
                            to.bottom - to.top,
                            SWP_NOZORDER | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS,
                        );
                    }
                    if zoomed {
                        let _ = ShowWindowAsync(hwnd, SW_MAXIMIZE);
                    }
                }
            }
            let _ = SetForegroundWindow(hwnd);
        }
    }

    /// Whether a window has any title, read from the window's own record. Unlike
    /// `GetWindowTextLengthW` it never sends a message to the window, so a window that stops
    /// answering just after the hung check cannot block this read.
    fn has_title(hwnd: HWND) -> bool {
        let mut buf = [0u16; 4];
        unsafe { InternalGetWindowText(hwnd, &mut buf) > 0 }
    }

    /// One look for a window of the registered OmniGent executable. True when one was found
    /// and brought forward.
    pub fn focus_once(exe: &str) -> bool {
        let hwnds = omnigent_windows(exe);
        let cands: Vec<Candidate> = hwnds
            .iter()
            .map(|hwnd| unsafe {
                Candidate {
                    visible: IsWindowVisible(*hwnd).as_bool(),
                    owned: GetWindow(*hwnd, GW_OWNER).is_ok(),
                    has_title: has_title(*hwnd),
                }
            })
            .collect();
        match pick_window(&cands) {
            Some(i) => {
                bring_forward(hwnds[i]);
                true
            }
            None => false,
        }
    }
}

// Section: machines

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PcStats {
    pub cpu_pct: f64,
    pub gpu_pct: f64,
    pub ram_pct: f64,
    /// The graphics card's temperature in whole degrees (NVML), or None.
    pub temp_c: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoxStats {
    pub cpu_pct: f64,
    pub gpu_pct: Option<f64>,
    pub ram_pct: f64,
    pub temp_c: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Machines {
    pub pc: PcStats,
    #[serde(rename = "box")]
    pub box_stats: Option<BoxStats>,
    pub box_stale: bool,
}

/// The box numbers and the stale flag from a helper summary.
fn box_from_summary(s: &OmniSummary) -> (Option<BoxStats>, bool) {
    match &s.system {
        Some(sys) => (
            Some(BoxStats { cpu_pct: sys.cpu_pct, gpu_pct: sys.gpu_pct, ram_pct: sys.ram_pct, temp_c: sys.temp_c }),
            s.stale,
        ),
        None => (None, false),
    }
}

/// The widest range a graphics card temperature can sensibly have; anything else is a bad read.
const GPU_TEMP_RANGE: std::ops::RangeInclusive<u32> = 0..=150;

/// A graphics card temperature from an NVML read: Some only for a successful read in range.
fn gpu_temp_from<E>(read: Result<u32, E>) -> Option<u32> {
    read.ok().filter(|t| GPU_TEMP_RANGE.contains(t))
}

/// The graphics card's temperature, or None with no NVIDIA driver or a failed read.
#[cfg(windows)]
fn read_gpu_temp() -> Option<u32> {
    let device = crate::nvml_handle()?.device_by_index(0).ok()?;
    gpu_temp_from(device.temperature(nvml_wrapper::enum_wrappers::device::TemperatureSensor::Gpu))
}

#[cfg(not(windows))]
fn read_gpu_temp() -> Option<u32> {
    None
}

fn pc_from(stats: &crate::SystemStatsSummary) -> PcStats {
    let clamp = |n: f32| if n.is_finite() { f64::from(n).clamp(0.0, 100.0) } else { 0.0 };
    PcStats { cpu_pct: clamp(stats.cpu), gpu_pct: clamp(stats.gpu), ram_pct: clamp(stats.ram), temp_c: read_gpu_temp() }
}

type BoxReading = (Option<BoxStats>, bool);

/// What the last helper reads showed, for one helper address.
struct BoxState {
    /// The helper address these numbers belong to; a different address starts over.
    base: Option<String>,
    /// When the last good numbers were read, the numbers, and the helper's own stale flag.
    good: Option<(Instant, BoxStats, bool)>,
    /// When the last read was started.
    attempted: Option<Instant>,
    in_flight: bool,
    /// The most recent read failed (or had no box numbers).
    failed: bool,
}

impl BoxState {
    const fn new() -> Self {
        BoxState { base: None, good: None, attempted: None, in_flight: false, failed: false }
    }

    fn sync_base(&mut self, base: &str) {
        if self.base.as_deref() != Some(base) {
            *self = BoxState::new();
            self.base = Some(base.to_string());
        }
    }
}

/// The box numbers, read in the background: asking never waits for the helper, and only
/// one read runs at a time, at most one every 15 seconds.
struct BoxCache(Mutex<BoxState>);

impl BoxCache {
    const fn new() -> Self {
        BoxCache(Mutex::new(BoxState::new()))
    }

    fn state(&self) -> MutexGuard<'_, BoxState> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The numbers to show now. After a failed read the last good numbers stay, marked
    /// stale, for 10 minutes since they were read; then none.
    fn view(&self, base: &str, now: Instant) -> BoxReading {
        let mut st = self.state();
        st.sync_base(base);
        match &st.good {
            Some((at, stats, helper_stale)) if now.saturating_duration_since(*at) < BOX_STALE_LIMIT => {
                (Some(stats.clone()), st.failed || *helper_stale)
            }
            _ => (None, false),
        }
    }

    /// True for exactly one caller when a read is due: none running and none started in
    /// the last 15 seconds.
    fn claim(&self, base: &str, now: Instant) -> bool {
        let mut st = self.state();
        st.sync_base(base);
        if st.in_flight {
            return false;
        }
        if let Some(at) = st.attempted {
            if now.saturating_duration_since(at) < BOX_TTL {
                return false;
            }
        }
        st.in_flight = true;
        st.attempted = Some(now);
        true
    }

    fn finish(&self, base: &str, result: Result<OmniSummary, String>, now: Instant) {
        let mut st = self.state();
        if st.base.as_deref() != Some(base) {
            return; // the address changed while this read ran
        }
        st.in_flight = false;
        match result.map(|s| box_from_summary(&s)) {
            Ok((Some(stats), helper_stale)) => {
                st.good = Some((now, stats, helper_stale));
                st.failed = false;
            }
            _ => st.failed = true,
        }
    }
}

static BOX: BoxCache = BoxCache::new();

/// Claim a read and, if it is due, run `fetch` and record the result.
#[cfg(test)]
fn refresh_with<F>(cache: &BoxCache, base: &str, now: Instant, fetch: F) -> bool
where
    F: FnOnce() -> Result<OmniSummary, String>,
{
    if !cache.claim(base, now) {
        return false;
    }
    let result = fetch();
    cache.finish(base, result, Instant::now());
    true
}

#[tauri::command]
pub async fn wall2_machines(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<Machines, String> {
    require_wall2(window.label())?;
    tauri::async_runtime::spawn_blocking(move || {
        let pc = pc_from(&crate::read_system_stats()?);
        let (box_stats, box_stale) = match helper_base(&app) {
            Ok(base) => {
                let now = Instant::now();
                let reading = BOX.view(&base, now);
                if BOX.claim(&base, now) {
                    tauri::async_runtime::spawn_blocking(move || {
                        let result = fetch_summary_within(&base, Some(BOX_TIMEOUT));
                        BOX.finish(&base, result, Instant::now());
                    });
                }
                reading
            }
            Err(_) => (None, false),
        };
        Ok(Machines { pc, box_stats, box_stale })
    })
    .await
    .map_err(|_| FAILED.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn full() -> Value {
        json!({
            "now": "2026-11-12T18:24:00Z", "tz": "America/Los_Angeles", "stale": false,
            "slots": { "used": 3, "limit": 3 },
            "lanes": [
                { "id": "a1b2c3d4-0001", "title": "Voice: iPhone mic fix", "stage": "build", "state": "working",
                  "line": "Running web tests, 56 of 89", "elapsedS": 2520, "waiting": false,
                  "pr": { "number": 553, "ci": "passing", "ready": true } },
                { "id": "a1b2c3d4-0002", "title": "Social card", "stage": "plan", "state": "blocked",
                  "line": "", "elapsedS": 60, "waiting": true, "pr": null }
            ],
            "parked": 4,
            "yourMove": { "total": 1, "first": { "sessionId": "a1b2c3d4-0002", "title": "Friday social card",
                          "kind": "gate", "since": "2026-11-12T18:21:00Z", "question": "which thumbnail?", "options": ["x"] } },
            "usage": { "claudeWeekPct": 62, "claude5hPct": 18, "weekResetsAt": "2026-11-15T00:00:00Z" },
            "day": [ { "lane": "a1b2c3d4-0001", "start": "2026-11-12T17:00:00Z", "end": null, "kind": "run" } ],
            "system": { "cpuPct": 61, "ramPct": 48, "gpuPct": null, "tempC": 52.5, "load1": 1.2, "uptimeS": 86400 }
        })
    }

    /// Slots as an older helper sends them: no extra counts.
    fn slots(used: u64, limit: u64) -> Slots {
        Slots { used, limit, sessions: None, working: None, helpers: None }
    }

    #[test]
    fn session_ids() {
        assert!(valid_session_id("a1b2c3d4"));
        assert!(valid_session_id("0123abcd-ef01-2345-6789-abcdef012345"));
        assert!(valid_session_id(&"a".repeat(64)));
        assert!(!valid_session_id("a1b2c3d")); // 7
        assert!(!valid_session_id(&"a".repeat(65)));
        assert!(!valid_session_id(""));
        assert!(!valid_session_id("A1B2C3D4")); // upper case
        assert!(!valid_session_id("a1b2c3d4/../x"));
        assert!(!valid_session_id("a1b2c3d4?x=1"));
        assert!(!valid_session_id("a1b2c3d4 "));
        assert!(!valid_session_id("a1b2c3d4\n"));
        assert!(!valid_session_id("a1b2c3d4g"));
        assert!(!valid_session_id("caf\u{e9}cafe"));
    }

    #[test]
    fn session_link_is_built_in_rust() {
        assert_eq!(
            session_url("example.invalid", "a1b2c3d4-0001").as_deref(),
            Some("omnigent://example.invalid/c/a1b2c3d4-0001")
        );
        assert_eq!(session_url("example.invalid", "https://evil.example"), None);
        assert_eq!(session_url("example.invalid", "../../x"), None);
        assert_eq!(session_url("example.invalid:8080", "a1b2c3d4-0001"), None);
    }

    #[test]
    fn host_check() {
        assert!(valid_host("example.invalid"));
        assert!(valid_host("a"));
        assert!(valid_host("my-box.example.invalid"));
        assert!(valid_host(&format!("{}.{}", "a".repeat(63), "b".repeat(63))));
        assert!(!valid_host(""));
        assert!(!valid_host(&"a".repeat(64)));
        assert!(!valid_host(&format!("{0}.{0}.{0}.{0}.{0}", "a".repeat(60))));
        assert!(!valid_host("https://example.invalid"));
        assert!(!valid_host("example.invalid:8443"));
        assert!(!valid_host("example.invalid/c"));
        assert!(!valid_host("user@example.invalid"));
        assert!(!valid_host("-example.invalid"));
        assert!(!valid_host("example-.invalid"));
        assert!(!valid_host("example..invalid"));
        assert!(!valid_host(".example.invalid"));
        assert!(!valid_host("example.invalid."));
        assert!(!valid_host("exa mple.invalid"));
        assert!(!valid_host("caf\u{e9}.invalid"));
    }

    #[test]
    fn link_host_config() {
        assert_eq!(link_host_from_config(None), Err("not-configured".to_string()));
        assert_eq!(link_host_from_config(Some("{}")), Err("not-configured".to_string()));
        assert_eq!(link_host_from_config(Some(r#"{"omniLinkHost":"  "}"#)), Err("not-configured".to_string()));
        assert_eq!(link_host_from_config(Some(r#"{"omniLinkHost":"example.invalid"}"#)), Ok("example.invalid".to_string()));
        assert_eq!(link_host_from_config(Some(r#"{"omniLinkHost":"https://example.invalid"}"#)), Err("invalid-config".to_string()));
        assert_eq!(link_host_from_config(Some(r#"{"omniLinkHost":5}"#)), Err("not-configured".to_string()));
        assert_eq!(link_host_from_config(Some("nope")), Err("invalid-config".to_string()));
    }

    #[test]
    fn shapes_a_full_summary() {
        let s = shape_summary(&full()).expect("summary");
        assert_eq!(s.slots, slots(3, 3));
        assert_eq!(s.lanes.len(), 2);
        assert_eq!(s.lanes[0].title, "Voice: iPhone mic fix");
        assert_eq!(s.lanes[0].elapsed_s, 2520);
        assert_eq!(s.lanes[0].pr, Some(LanePr { number: 553, ci: "passing".into(), ready: true }));
        assert_eq!(s.lanes[1].pr, None);
        assert!(s.lanes[1].waiting);
        assert_eq!(s.parked, 4);
        assert_eq!(s.your_move.total, 1);
        assert_eq!(s.your_move.first.as_ref().unwrap().kind, "gate");
        assert_eq!(s.usage.as_ref().unwrap().claude_week_pct, Some(62.0));
        assert_eq!(s.day.len(), 1);
        assert_eq!(s.day[0].end, None);
        let sys = s.system.unwrap();
        assert_eq!((sys.cpu_pct, sys.ram_pct, sys.gpu_pct, sys.temp_c), (61.0, 48.0, None, Some(52.5)));
        assert_eq!(sys.uptime_s, 86400);
    }

    #[test]
    fn options_are_never_passed_on() {
        let json = serde_json::to_string(&shape_summary(&full()).unwrap()).unwrap();
        assert!(!json.contains("options"));
    }

    #[test]
    fn a_missing_five_hour_figure_keeps_the_week() {
        let mut body = full();
        body["usage"]["claude5hPct"] = Value::Null;
        let u = shape_summary(&body).unwrap().usage.unwrap();
        assert_eq!((u.claude_week_pct, u.claude5h_pct), (Some(62.0), None));
        let v = serde_json::to_value(shape_summary(&body).unwrap()).unwrap();
        assert!(v["usage"]["claude5hPct"].is_null());
        body["usage"]["claudeWeekPct"] = Value::Null;
        assert!(shape_summary(&body).unwrap().usage.is_none());
    }

    #[test]
    fn timestamps_must_be_rfc3339_with_an_offset() {
        assert_eq!(stamp_millis("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(stamp_millis("1970-01-01T00:00:01.5Z"), Some(1500));
        assert_eq!(stamp_millis("2026-11-12T18:24:00Z"), stamp_millis("2026-11-12T10:24:00-08:00"));
        assert_eq!(stamp_millis("2026-11-12T18:24:00Z"), stamp_millis("2026-11-12T23:54:00+05:30"));
        assert_eq!(stamp_millis("2024-02-29T12:00:00.123456789Z"), Some(1_709_208_000_123));
        assert!(stamp_millis("2026-11-12").is_none()); // date only
        assert!(stamp_millis("2026-11-12T18:24:00").is_none()); // no offset
        assert!(stamp_millis("2026-11-12 18:24:00Z").is_none());
        assert!(stamp_millis("2026-02-29T00:00:00Z").is_none()); // not a leap year
        assert!(stamp_millis("2026-13-01T00:00:00Z").is_none());
        assert!(stamp_millis("2026-04-31T00:00:00Z").is_none());
        assert!(stamp_millis("2026-11-12T24:00:00Z").is_none());
        assert!(stamp_millis("2026-11-12T18:60:00Z").is_none());
        assert!(stamp_millis("2026-11-12T18:24:61Z").is_none());
        assert!(stamp_millis("2026-11-12T18:24:00+25:00").is_none());
        assert!(stamp_millis("2026-11-12T18:24:00+0800").is_none());
        assert!(stamp_millis("2026-11-12T18:24:00.Z").is_none());
        assert!(stamp_millis("2026-11-12T18:24:00.1234567890Z").is_none());
        assert!(stamp_millis("2026-11-12T18:24:00Zjunk").is_none());
        assert!(stamp_millis(&format!("2026-11-12T18:24:00.{}Z", "1".repeat(30))).is_none()); // oversized
        assert!(stamp_millis("+2026-11-12T18:24:00Z").is_none());
        assert!(stamp_millis("2026-1a-12T18:24:00Z").is_none());
    }

    #[test]
    fn a_bad_now_refuses_the_summary_and_bad_optional_times_are_dropped() {
        let mut body = full();
        body["now"] = json!("2026-11-12");
        assert!(shape_summary(&body).is_none());
        body["now"] = json!("2026-11-12T18:24:00+02:00");
        assert_eq!(shape_summary(&body).unwrap().now, "2026-11-12T18:24:00+02:00");
        body["yourMove"]["first"]["since"] = json!("yesterday");
        body["usage"]["weekResetsAt"] = json!("2026-02-30T00:00:00Z");
        let s = shape_summary(&body).unwrap();
        let first = s.your_move.first.unwrap();
        assert_eq!(first.since, None);
        assert_eq!(first.title, "Friday social card");
        assert_eq!(s.usage.unwrap().week_resets_at, None);
    }

    #[test]
    fn day_spans_with_bad_or_backwards_times_are_dropped() {
        let mut body = full();
        let span = |start: Value, end: Value| json!({ "lane": "a1b2c3d4-0001", "start": start, "end": end, "kind": "run" });
        body["day"] = json!([
            span(json!("2026-11-12T17:00:00Z"), json!("2026-11-12T18:00:00Z")),
            span(json!("2026-11-12T17:00:00Z"), Value::Null),
            span(json!("2026-11-12T17:00:00Z"), json!("2026-11-12T16:00:00Z")),
            span(json!("2026-11-12"), Value::Null),
            span(json!("2026-11-12T17:00:00Z"), json!("soon")),
            span(json!("2026-11-12T17:00:00Z"), json!("")),
            span(json!("2026-11-12T10:00:00-08:00"), json!("2026-11-12T18:30:00Z")),
        ]);
        let s = shape_summary(&body).unwrap();
        let kept: Vec<(&str, Option<&str>)> = s.day.iter().map(|d| (d.start.as_str(), d.end.as_deref())).collect();
        assert_eq!(
            kept,
            vec![
                ("2026-11-12T17:00:00Z", Some("2026-11-12T18:00:00Z")),
                ("2026-11-12T17:00:00Z", None),
                ("2026-11-12T10:00:00-08:00", Some("2026-11-12T18:30:00Z")),
            ]
        );
    }

    #[test]
    fn output_uses_camel_case_names() {
        let v = serde_json::to_value(shape_summary(&full()).unwrap()).unwrap();
        assert!(v["lanes"][0].get("elapsedS").is_some());
        assert!(v["yourMove"]["first"].get("sessionId").is_some());
        assert!(v["usage"].get("claudeWeekPct").is_some());
        assert!(v["usage"].get("claude5hPct").is_some());
        assert!(v["system"].get("tempC").is_some());
    }

    #[test]
    fn titles_and_lines_are_capped_and_cleaned() {
        let mut body = full();
        body["lanes"][0]["title"] = json!(format!("{}\u{7}x", "t".repeat(200)));
        body["lanes"][0]["line"] = json!("l".repeat(500));
        body["yourMove"]["first"]["question"] = json!("q".repeat(500));
        let s = shape_summary(&body).unwrap();
        assert_eq!(s.lanes[0].title.chars().count(), 80);
        assert!(!s.lanes[0].title.chars().any(char::is_control));
        assert_eq!(s.lanes[0].line.chars().count(), 80);
        assert_eq!(s.your_move.first.unwrap().question.chars().count(), 200);
    }

    #[test]
    fn format_characters_are_dropped() {
        let mut body = full();
        body["lanes"][0]["title"] = json!("a\u{202E}b\u{200B}c\u{2066}d\u{FEFF}e\u{200F}f\u{2060}g");
        let s = shape_summary(&body).unwrap();
        assert_eq!(s.lanes[0].title, "abcdefg");
        assert!(is_format_char('\u{200B}') && is_format_char('\u{202A}') && is_format_char('\u{2069}'));
        assert!(!is_format_char('a') && !is_format_char('\u{200A}') && !is_format_char('\u{202F}'));
    }

    #[test]
    fn counts_must_be_whole_numbers() {
        let mut body = full();
        body["parked"] = json!(4.5);
        body["lanes"][0]["elapsedS"] = json!(-5);
        body["lanes"][1]["elapsedS"] = json!(60.5);
        body["yourMove"]["total"] = json!(-1);
        let s = shape_summary(&body).unwrap();
        assert_eq!(s.parked, 0);
        assert_eq!(s.lanes[0].elapsed_s, 0);
        assert_eq!(s.lanes[1].elapsed_s, 0);
        assert_eq!(s.your_move.total, 0);
    }

    #[test]
    fn pr_number_must_be_positive_and_whole() {
        for bad in [json!(0), json!(-3), json!(5.5), json!("7")] {
            let mut body = full();
            body["lanes"][0]["pr"]["number"] = bad;
            let s = shape_summary(&body).unwrap();
            assert_eq!(s.lanes.len(), 2);
            assert_eq!(s.lanes[0].pr, None);
        }
    }

    #[test]
    fn slots_are_kept_as_sent_and_elapsed_is_capped() {
        let mut body = full();
        body["slots"] = json!({ "used": 5, "limit": 4 });
        body["lanes"][0]["elapsedS"] = json!(9_000_000_000u64);
        let s = shape_summary(&body).unwrap();
        assert_eq!(s.slots, slots(5, 4));
        body["slots"] = json!({ "used": 5000, "limit": 5000 });
        assert_eq!(shape_summary(&body).unwrap().slots, slots(99, 99));
        assert_eq!(s.lanes[0].elapsed_s, 7 * 24 * 3600);
        body["slots"] = json!({ "used": 1.5, "limit": -2 });
        let s = shape_summary(&body).unwrap();
        assert_eq!(s.slots, slots(2, 3));
    }

    #[test]
    fn lanes_with_bad_ids_or_values_are_dropped() {
        let mut body = full();
        body["lanes"][0]["id"] = json!("../etc");
        body["lanes"][1]["stage"] = json!("nonsense");
        let s = shape_summary(&body).unwrap();
        assert!(s.lanes.is_empty());
    }

    #[test]
    fn lanes_are_cut_to_three() {
        let mut body = full();
        let lane = body["lanes"][0].clone();
        body["lanes"] = json!([lane, lane, lane, lane, lane]);
        assert_eq!(shape_summary(&body).unwrap().lanes.len(), 3);
    }

    #[test]
    fn bad_first_move_keeps_the_total() {
        let mut body = full();
        body["yourMove"]["first"]["sessionId"] = json!("x");
        let s = shape_summary(&body).unwrap();
        assert_eq!(s.your_move.total, 1);
        assert!(s.your_move.first.is_none());
    }

    #[test]
    fn percentages_are_clamped_and_junk_is_refused() {
        let mut body = full();
        body["system"]["cpuPct"] = json!(250);
        body["system"]["tempC"] = json!(9999);
        let sys = shape_summary(&body).unwrap().system.unwrap();
        assert_eq!(sys.cpu_pct, 100.0);
        assert_eq!(sys.temp_c, None);
        body["system"]["cpuPct"] = json!("high");
        assert!(shape_summary(&body).unwrap().system.is_none());
    }

    #[test]
    fn missing_optional_blocks_are_fine() {
        let body = json!({ "now": "2026-11-12T18:24:00Z", "lanes": [] });
        let s = shape_summary(&body).unwrap();
        assert_eq!(s.slots.limit, 3);
        assert!(s.usage.is_none() && s.system.is_none() && s.day.is_empty());
        assert_eq!(s.your_move, YourMove { total: 0, first: None, ids: Vec::new() });
    }

    #[test]
    fn day_entries_are_checked_and_capped() {
        let mut body = full();
        let ok = body["day"][0].clone();
        let bad_kind = json!({ "lane": "a1b2c3d4-0001", "start": "x", "kind": "party" });
        let bad_lane = json!({ "lane": "nope", "start": "x", "kind": "run" });
        let mut many = vec![bad_kind, bad_lane];
        for _ in 0..300 {
            many.push(ok.clone());
        }
        body["day"] = json!(many);
        assert_eq!(shape_summary(&body).unwrap().day.len(), 200);
    }

    #[test]
    fn malformed_answers_fail() {
        assert_eq!(parse_answer(b"not json"), Err("failed".to_string()));
        assert_eq!(parse_answer(b"[1,2]"), Err("failed".to_string()));
        assert_eq!(parse_answer(b"{}"), Err("failed".to_string()));
        assert_eq!(parse_answer(br#"{"now":"x"}"#), Err("failed".to_string()));
        assert_eq!(parse_answer(br#"{"lanes":[]}"#), Err("failed".to_string()));
    }

    #[test]
    fn oversized_answers_fail() {
        let pad = " ".repeat(MAX_ANSWER);
        let text = format!(r#"{{"now":"2026-11-12T18:24:00Z","lanes":[]}}{pad}"#);
        assert_eq!(parse_answer(text.as_bytes()), Err("failed".to_string()));
        assert!(parse_answer(br#"{"now":"2026-11-12T18:24:00Z","lanes":[]}"#).is_ok());
    }

    #[test]
    fn config_errors_map_to_fixed_codes() {
        assert_eq!(config_error(NOT_CONFIGURED.to_string()), "not-configured");
        assert_eq!(config_error("feeds.json holds an invalid address".to_string()), "invalid-config");
        assert_eq!(config_error("feeds.json is not valid JSON".to_string()), "invalid-config");
    }

    #[test]
    fn only_the_wall2_window_may_call() {
        assert!(require_wall2("wall2").is_ok());
        assert_eq!(require_wall2("main"), Err("forbidden".to_string()));
    }

    #[test]
    fn box_numbers_follow_the_system_block_and_stale_flag() {
        let s = shape_summary(&full()).unwrap();
        let (b, stale) = box_from_summary(&s);
        let b = b.unwrap();
        assert_eq!((b.cpu_pct, b.ram_pct, b.gpu_pct, b.temp_c), (61.0, 48.0, None, Some(52.5)));
        assert!(!stale);
        let mut body = full();
        body["stale"] = json!(true);
        assert!(box_from_summary(&shape_summary(&body).unwrap()).1);
        body["system"] = Value::Null;
        assert_eq!(box_from_summary(&shape_summary(&body).unwrap()), (None, false));
    }

    #[test]
    fn pc_numbers_are_clamped() {
        let stats = crate::SystemStatsSummary { cpu: 12.5, gpu: f32::NAN, ram: 140.0, drives: Vec::new() };
        let pc = pc_from(&stats);
        assert_eq!((pc.cpu_pct, pc.gpu_pct, pc.ram_pct), (12.5, 0.0, 100.0));
    }

    #[test]
    fn gpu_temperature_is_none_on_failure_or_out_of_range() {
        assert_eq!(gpu_temp_from::<()>(Ok(61)), Some(61));
        assert_eq!(gpu_temp_from::<()>(Ok(0)), Some(0));
        assert_eq!(gpu_temp_from::<()>(Ok(150)), Some(150));
        assert_eq!(gpu_temp_from::<()>(Ok(151)), None);
        assert_eq!(gpu_temp_from::<()>(Ok(u32::MAX)), None);
        assert_eq!(gpu_temp_from(Err("no sensor")), None);
    }

    #[test]
    fn machines_serialize_with_the_agreed_names() {
        let m = Machines {
            pc: PcStats { cpu_pct: 1.0, gpu_pct: 2.0, ram_pct: 3.0, temp_c: Some(61) },
            box_stats: None,
            box_stale: false,
        };
        let v = serde_json::to_value(&m).unwrap();
        assert!(v["pc"].get("cpuPct").is_some());
        assert_eq!(v["pc"]["tempC"], json!(61));
        assert!(v["box"].is_null());
        assert_eq!(v["boxStale"], json!(false));
    }

    const BASE: &str = "https://example.invalid:8790";

    fn summary_with(stale: bool, with_system: bool) -> OmniSummary {
        let mut body = full();
        body["stale"] = json!(stale);
        if !with_system {
            body["system"] = Value::Null;
        }
        shape_summary(&body).unwrap()
    }

    fn secs(t: Instant, n: u64) -> Instant {
        t + Duration::from_secs(n)
    }

    #[test]
    fn box_cache_hit_inside_the_window() {
        let cache = BoxCache::new();
        let t0 = Instant::now();
        assert_eq!(cache.view(BASE, t0), (None, false));
        assert!(cache.claim(BASE, t0));
        cache.finish(BASE, Ok(summary_with(false, true)), t0);
        let (b, stale) = cache.view(BASE, secs(t0, 1));
        assert_eq!(b.unwrap().cpu_pct, 61.0);
        assert!(!stale);
        assert!(!cache.claim(BASE, secs(t0, 5)));
        assert!(!cache.claim(BASE, secs(t0, 14)));
        assert!(cache.claim(BASE, secs(t0, 15)));
    }

    #[test]
    fn only_one_read_runs_at_a_time() {
        let cache = BoxCache::new();
        let t0 = Instant::now();
        assert!(cache.claim(BASE, t0));
        assert!(!cache.claim(BASE, secs(t0, 60)));
        cache.finish(BASE, Err("failed".into()), secs(t0, 61));
        assert!(cache.claim(BASE, secs(t0, 61)));
    }

    #[test]
    fn failed_read_with_nothing_good_shows_nothing() {
        let cache = BoxCache::new();
        let t0 = Instant::now();
        assert!(cache.claim(BASE, t0));
        cache.finish(BASE, Err("failed".into()), t0);
        assert_eq!(cache.view(BASE, secs(t0, 1)), (None, false));
    }

    #[test]
    fn failed_read_keeps_last_good_stale_for_ten_minutes() {
        let cache = BoxCache::new();
        let t0 = Instant::now();
        assert!(cache.claim(BASE, t0));
        cache.finish(BASE, Ok(summary_with(false, true)), t0);
        assert!(cache.claim(BASE, secs(t0, 16)));
        cache.finish(BASE, Err("failed".into()), secs(t0, 16));
        let (b, stale) = cache.view(BASE, secs(t0, 17));
        assert!(b.is_some() && stale);
        let (b, stale) = cache.view(BASE, secs(t0, 599));
        assert!(b.is_some() && stale);
        assert_eq!(cache.view(BASE, secs(t0, 600)), (None, false));
        assert_eq!(cache.view(BASE, secs(t0, 900)), (None, false));
    }

    #[test]
    fn a_new_good_read_clears_the_stale_mark() {
        let cache = BoxCache::new();
        let t0 = Instant::now();
        assert!(cache.claim(BASE, t0));
        cache.finish(BASE, Err("failed".into()), t0);
        assert!(cache.claim(BASE, secs(t0, 16)));
        cache.finish(BASE, Ok(summary_with(false, true)), secs(t0, 16));
        assert!(!cache.view(BASE, secs(t0, 17)).1);
    }

    #[test]
    fn helper_stale_flag_and_missing_system_block() {
        let cache = BoxCache::new();
        let t0 = Instant::now();
        assert!(cache.claim(BASE, t0));
        cache.finish(BASE, Ok(summary_with(true, true)), t0);
        assert!(cache.view(BASE, secs(t0, 1)).1);
        // A summary with no system block counts as a failed read.
        assert!(cache.claim(BASE, secs(t0, 16)));
        cache.finish(BASE, Ok(summary_with(false, false)), secs(t0, 16));
        let (b, stale) = cache.view(BASE, secs(t0, 17));
        assert!(b.is_some() && stale);
        let fresh = BoxCache::new();
        assert!(fresh.claim(BASE, t0));
        fresh.finish(BASE, Ok(summary_with(false, false)), t0);
        assert_eq!(fresh.view(BASE, secs(t0, 1)), (None, false));
    }

    #[test]
    fn a_changed_helper_address_never_shows_the_old_numbers() {
        let cache = BoxCache::new();
        let other = "https://other.example.invalid";
        let t0 = Instant::now();
        assert!(cache.claim(BASE, t0));
        cache.finish(BASE, Ok(summary_with(false, true)), t0);
        assert!(cache.view(BASE, secs(t0, 1)).0.is_some());
        assert_eq!(cache.view(other, secs(t0, 2)), (None, false));
        // The new address is due at once, and a late answer from the old one is ignored.
        assert!(cache.claim(other, secs(t0, 2)));
        cache.finish(BASE, Ok(summary_with(false, true)), secs(t0, 3));
        assert_eq!(cache.view(other, secs(t0, 4)), (None, false));
        cache.finish(other, Ok(summary_with(false, true)), secs(t0, 5));
        assert!(cache.view(other, secs(t0, 6)).0.is_some());
    }

    #[test]
    fn simultaneous_cold_calls_cause_one_fetch() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;
        let cache = Arc::new(BoxCache::new());
        let fetches = Arc::new(AtomicUsize::new(0));
        let mut handles = Vec::new();
        for _ in 0..8 {
            let (cache, fetches) = (cache.clone(), fetches.clone());
            handles.push(std::thread::spawn(move || {
                refresh_with(&cache, BASE, Instant::now(), || {
                    fetches.fetch_add(1, Ordering::SeqCst);
                    std::thread::sleep(Duration::from_millis(100));
                    Ok(summary_with(false, true))
                })
            }));
        }
        let ran: usize = handles.into_iter().map(|h| usize::from(h.join().unwrap())).sum();
        assert_eq!(ran, 1);
        assert_eq!(fetches.load(Ordering::SeqCst), 1);
        assert!(cache.view(BASE, Instant::now()).0.is_some());
    }

    #[test]
    fn a_slow_helper_never_delays_the_numbers() {
        use std::sync::{mpsc, Arc};
        let cache = Arc::new(BoxCache::new());
        let (release, wait) = mpsc::channel::<()>();
        let worker = {
            let cache = cache.clone();
            std::thread::spawn(move || {
                refresh_with(&cache, BASE, Instant::now(), || {
                    let _ = wait.recv_timeout(Duration::from_secs(10));
                    Err("failed".to_string())
                })
            })
        };
        // Wait until the slow read has started.
        let started = Instant::now();
        while !cache.state().in_flight {
            assert!(started.elapsed() < Duration::from_secs(5), "read never started");
            std::thread::sleep(Duration::from_millis(5));
        }
        let asked = Instant::now();
        assert_eq!(cache.view(BASE, Instant::now()), (None, false));
        assert!(!cache.claim(BASE, Instant::now()));
        assert!(asked.elapsed() < Duration::from_millis(500));
        release.send(()).unwrap();
        assert!(worker.join().unwrap());
    }

    #[test]
    fn a_redirect_is_not_an_answer() {
        assert!(accept(ureq::Response::new(302, "Found", "").unwrap()).is_err());
        assert!(accept(ureq::Response::new(301, "Moved", "").unwrap()).is_err());
        assert!(accept(ureq::Response::new(404, "Not Found", "").unwrap()).is_err());
        assert!(accept(ureq::Response::new(200, "OK", "{}").unwrap()).is_ok());
    }

    #[test]
    fn the_read_stops_at_the_cap() {
        use std::io::Cursor;
        assert_eq!(read_limited(Cursor::new(vec![b' '; 70 * 1024])), Err("failed".to_string()));
        assert_eq!(read_limited(Cursor::new(vec![b' '; MAX_ANSWER + 1])), Err("failed".to_string()));
        assert_eq!(read_limited(Cursor::new(vec![b' '; MAX_ANSWER])).unwrap().len(), MAX_ANSWER);
        assert_eq!(read_limited(Cursor::new(Vec::new())).unwrap().len(), 0);
    }

    #[test]
    fn the_cap_reader_never_pulls_more_than_the_cap() {
        struct Endless(usize);
        impl Read for Endless {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                self.0 += buf.len();
                buf.fill(b' ');
                Ok(buf.len())
            }
        }
        let mut src = Endless(0);
        assert_eq!(read_limited(&mut src), Err("failed".to_string()));
        assert!(src.0 <= MAX_ANSWER + 1 + 8192, "read {} bytes", src.0);
    }

    #[test]
    fn only_ids_from_the_last_summary_can_be_opened() {
        let s = shape_summary(&full()).unwrap();
        let ids = ids_of(&s);
        assert!(ids.contains(&"a1b2c3d4-0001".to_string()));
        assert!(ids.contains(&"a1b2c3d4-0002".to_string()));
        assert_eq!(ids.len(), 2);
        assert!(!id_is_known("deadbeef-0000-0000"));
        remember_ids(ids);
        assert!(id_is_known("a1b2c3d4-0001"));
        // Well formed, but never in a summary.
        assert!(valid_session_id("deadbeef-0000-0000"));
        assert!(!id_is_known("deadbeef-0000-0000"));
    }

    // Section: tests for the 1.1.0 fields

    fn lane_json(id: &str) -> Value {
        json!({ "id": id, "title": "Lane", "stage": "build", "state": "working", "line": "", "elapsedS": 10,
                "waiting": false, "pr": null })
    }

    fn id(n: usize) -> String {
        format!("a1b2c3d4-{n:04}")
    }

    #[test]
    fn an_old_answer_has_no_new_fields() {
        let s = shape_summary(&full()).unwrap();
        assert_eq!(s.sessions_list, None);
        assert!(s.sessions.is_empty());
        assert!(s.your_move.ids.is_empty());
        assert!(s.usage.as_ref().unwrap().accounts.is_empty());
        assert_eq!((s.slots.sessions, s.slots.working, s.slots.helpers), (None, None, None));
        let lane = &s.lanes[0];
        assert_eq!((lane.live.as_deref(), lane.idle_s, lane.kids, lane.waiting_since_s), (None, None, None, None));
        assert_eq!((lane.next.as_deref(), lane.harness.as_deref(), lane.failed), (None, None, false));
        let v = serde_json::to_value(&s).unwrap();
        assert!(v["sessionsList"].is_null());
        assert_eq!(v["sessions"], json!({}));
        assert_eq!(v["yourMove"]["ids"], json!([]));
        assert_eq!(v["usage"]["accounts"], json!([]));
        for key in ["sessions", "working", "helpers"] {
            assert!(v["slots"].get(key).unwrap().is_null(), "slots.{key}");
        }
        for key in ["live", "idleS", "kids", "waitingSinceS", "next", "harness"] {
            assert!(v["lanes"][0].get(key).unwrap().is_null(), "lane {key}");
        }
        assert_eq!(v["lanes"][0]["failed"], json!(false));
    }

    #[test]
    fn slot_extras_are_whole_numbers_capped_at_999() {
        let mut body = full();
        body["slots"] = json!({ "used": 8, "limit": 4, "sessions": 5, "working": 2, "helpers": 7 });
        let s = shape_summary(&body).unwrap();
        assert_eq!(s.slots, Slots { used: 8, limit: 4, sessions: Some(5), working: Some(2), helpers: Some(7) });
        body["slots"] = json!({ "used": 8, "limit": 4, "sessions": 5000, "working": -1, "helpers": "7" });
        let s = shape_summary(&body).unwrap();
        assert_eq!((s.slots.sessions, s.slots.working, s.slots.helpers), (Some(999), None, None));
        body["slots"]["working"] = json!(1.5);
        assert_eq!(shape_summary(&body).unwrap().slots.working, None);
        let v = serde_json::to_value(shape_summary(&body).unwrap()).unwrap();
        assert_eq!(v["slots"]["sessions"], json!(999));
    }

    #[test]
    fn lane_extras_are_parsed() {
        let mut body = full();
        body["lanes"][0]["live"] = json!("working");
        body["lanes"][0]["idleS"] = json!(120);
        body["lanes"][0]["kids"] = json!({ "total": 5, "working": 3 });
        body["lanes"][0]["waitingSinceS"] = json!(90);
        body["lanes"][0]["next"] = json!("  Merge the fix\u{7}  ");
        body["lanes"][0]["harness"] = json!("codex");
        body["lanes"][0]["failed"] = json!(true);
        let s = shape_summary(&body).unwrap();
        let lane = &s.lanes[0];
        assert_eq!(lane.live.as_deref(), Some("working"));
        assert_eq!(lane.idle_s, Some(120));
        assert_eq!(lane.kids, Some(Kids { total: 5, working: 3 }));
        assert_eq!(lane.waiting_since_s, Some(90));
        assert_eq!(lane.next.as_deref(), Some("Merge the fix"));
        assert_eq!(lane.harness.as_deref(), Some("codex"));
        assert!(lane.failed);
        let v = serde_json::to_value(&s).unwrap();
        let l = &v["lanes"][0];
        assert_eq!(l["live"], json!("working"));
        assert_eq!(l["idleS"], json!(120));
        assert_eq!(l["kids"], json!({ "total": 5, "working": 3 }));
        assert_eq!(l["waitingSinceS"], json!(90));
        assert_eq!(l["next"], json!("Merge the fix"));
        assert_eq!(l["harness"], json!("codex"));
        assert_eq!(l["failed"], json!(true));
    }

    #[test]
    fn lane_extras_junk_is_dropped() {
        let mut body = full();
        let lane = &mut body["lanes"][0];
        lane["live"] = json!("running");
        lane["idleS"] = json!(-4);
        lane["kids"] = json!({ "total": 2 });
        lane["waitingSinceS"] = json!("90");
        lane["next"] = json!("   ");
        lane["harness"] = json!(7);
        lane["failed"] = json!("true");
        let s = shape_summary(&body).unwrap();
        let lane = &s.lanes[0];
        assert_eq!((lane.live.as_deref(), lane.idle_s, lane.kids, lane.waiting_since_s), (None, None, None, None));
        assert_eq!((lane.next.as_deref(), lane.harness.as_deref(), lane.failed), (None, None, false));
        // The lane itself survives every junk extra.
        assert_eq!(s.lanes.len(), 2);
    }

    #[test]
    fn lane_extras_caps_and_clamps() {
        let mut body = full();
        body["lanes"][0]["idleS"] = json!(9_000_000_000u64);
        body["lanes"][0]["waitingSinceS"] = json!(9_000_000_000u64);
        body["lanes"][0]["kids"] = json!({ "total": 3, "working": 8 });
        body["lanes"][0]["next"] = json!("n".repeat(200));
        body["lanes"][1]["kids"] = json!({ "total": 5000, "working": 5000 });
        let s = shape_summary(&body).unwrap();
        assert_eq!(s.lanes[0].idle_s, Some(MAX_ELAPSED_S));
        assert_eq!(s.lanes[0].waiting_since_s, Some(MAX_ELAPSED_S));
        assert_eq!(s.lanes[0].kids, Some(Kids { total: 3, working: 3 }));
        assert_eq!(s.lanes[0].next.as_ref().unwrap().chars().count(), 60);
        assert_eq!(s.lanes[1].kids, Some(Kids { total: 999, working: 999 }));
        body["lanes"][0]["kids"] = json!({ "total": 3.5, "working": 1 });
        assert_eq!(shape_summary(&body).unwrap().lanes[0].kids, None);
        body["lanes"][0]["kids"] = json!([3, 1]);
        assert_eq!(shape_summary(&body).unwrap().lanes[0].kids, None);
    }

    #[test]
    fn harness_names_map_to_three_values() {
        for (raw, want) in [
            (json!("claude"), Some("claude")),
            (json!("codex"), Some("codex")),
            (json!("gemini"), Some("other")),
            (json!("Claude"), Some("other")),
            (json!(""), None),
            (json!(null), None),
            (json!(true), None),
            (json!(["claude"]), None),
        ] {
            let mut body = full();
            body["lanes"][0]["harness"] = raw.clone();
            assert_eq!(shape_summary(&body).unwrap().lanes[0].harness.as_deref(), want, "harness {raw}");
        }
    }

    #[test]
    fn failed_is_true_only_for_true() {
        for (raw, want) in [(json!(true), true), (json!(false), false), (json!(1), false), (json!("true"), false), (json!(null), false)] {
            let mut body = full();
            body["lanes"][0]["failed"] = raw.clone();
            assert_eq!(shape_summary(&body).unwrap().lanes[0].failed, want, "failed {raw}");
        }
    }

    #[test]
    fn sessions_list_is_checked_deduplicated_and_capped() {
        let mut body = full();
        let mut items: Vec<Value> = vec![lane_json(&id(1)), lane_json("not-an-id"), lane_json(&id(1))];
        items[2]["title"] = json!("Second copy");
        items[0]["kids"] = json!({ "total": 2, "working": 1 });
        items.push(json!("junk"));
        for n in 2..30 {
            items.push(lane_json(&id(n)));
        }
        body["sessionsList"] = json!(items);
        let s = shape_summary(&body).unwrap();
        let list = s.sessions_list.as_ref().unwrap();
        assert_eq!(list.len(), 12);
        assert_eq!(list[0].id, id(1));
        assert_eq!(list[0].title, "Lane", "the first copy of an id wins");
        assert_eq!(list[0].kids, Some(Kids { total: 2, working: 1 }));
        assert_eq!(list.iter().filter(|l| l.id == id(1)).count(), 1);
        assert_eq!(list[11].id, id(12));
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["sessionsList"].as_array().unwrap().len(), 12);
        assert!(v["sessionsList"][0].get("elapsedS").is_some());
        // Lanes stay capped at three on their own.
        assert_eq!(s.lanes.len(), 2);
    }

    #[test]
    fn sessions_list_missing_or_not_a_list_is_none_and_empty_is_some() {
        let mut body = full();
        body["sessionsList"] = json!({ "a": 1 });
        assert_eq!(shape_summary(&body).unwrap().sessions_list, None);
        body["sessionsList"] = json!(null);
        assert_eq!(shape_summary(&body).unwrap().sessions_list, None);
        body["sessionsList"] = json!([]);
        assert_eq!(shape_summary(&body).unwrap().sessions_list, Some(Vec::new()));
        body["sessionsList"] = json!([lane_json("BAD")]);
        assert_eq!(shape_summary(&body).unwrap().sessions_list, Some(Vec::new()));
    }

    #[test]
    fn session_names_are_checked_and_capped_at_forty() {
        let mut body = full();
        let mut names = serde_json::Map::new();
        names.insert("not-an-id".into(), json!({ "title": "Bad id" }));
        names.insert(id(900), json!({ "stage": "build" }));
        names.insert(id(901), json!("just text"));
        names.insert(id(904), json!({ "title": "   " }));
        names.insert(id(902), json!({ "title": "Odd values", "stage": "ship", "state": "asleep" }));
        names.insert(id(903), json!({ "title": format!("{}\u{202E}", "t".repeat(200)), "stage": "pr", "state": "review" }));
        for n in 0..60 {
            names.insert(id(n), json!({ "title": format!("Session {n}"), "stage": "build", "state": "working" }));
        }
        body["sessions"] = Value::Object(names);
        let s = shape_summary(&body).unwrap();
        assert_eq!(s.sessions.len(), 40);
        assert!(!s.sessions.contains_key("not-an-id"));
        assert!(!s.sessions.contains_key(&id(900)), "no title, no entry");
        assert!(!s.sessions.contains_key(&id(901)));
        assert!(!s.sessions.contains_key(&id(904)), "an empty title is no title");
        let odd = &s.sessions[&id(902)];
        assert_eq!((odd.title.as_str(), odd.stage.as_deref(), odd.state.as_deref()), ("Odd values", None, None));
        let long = &s.sessions[&id(903)];
        assert_eq!(long.title.chars().count(), 80);
        assert_eq!((long.stage.as_deref(), long.state.as_deref()), (Some("pr"), Some("review")));
        // The first 40 valid entries in the helper's order: 902, 903 and sessions 0 to 37.
        assert!(s.sessions.contains_key(&id(37)));
        assert!(!s.sessions.contains_key(&id(38)));
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["sessions"][id(0)], json!({ "title": "Session 0", "stage": "build", "state": "working" }));
        body["sessions"] = json!([1, 2]);
        assert!(shape_summary(&body).unwrap().sessions.is_empty());
    }

    #[test]
    fn your_move_ids_are_checked_deduplicated_and_capped() {
        let mut body = full();
        body["yourMove"]["ids"] = json!([id(1), "nope", 5, id(1), id(2), null, id(3), id(4), id(5), id(6)]);
        let s = shape_summary(&body).unwrap();
        assert_eq!(s.your_move.ids, vec![id(1), id(2), id(3), id(4), id(5)]);
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["yourMove"]["ids"], json!([id(1), id(2), id(3), id(4), id(5)]));
        body["yourMove"]["ids"] = json!("a1b2c3d4-0001");
        assert!(shape_summary(&body).unwrap().your_move.ids.is_empty());
    }

    fn account(provider: Value, label: Value) -> Value {
        json!({ "provider": provider, "label": label, "weekPct": 44, "fiveHourPct": null, "weekResetsAt": "2026-11-18T02:00:00Z" })
    }

    #[test]
    fn usage_accounts_are_parsed() {
        let mut body = full();
        body["usage"]["accounts"] = json!([
            account(json!("claude"), json!("Claude 1")),
            { "provider": "codex", "label": "Codex", "weekPct": 250, "fiveHourPct": 12.5, "weekResetsAt": "soon" },
            account(json!("gemini"), json!("Other")),
        ]);
        let u = shape_summary(&body).unwrap().usage.unwrap();
        assert_eq!(u.accounts.len(), 3);
        assert_eq!(
            u.accounts[0],
            UsageAccount {
                provider: "claude".into(),
                label: "Claude 1".into(),
                week_pct: Some(44.0),
                five_hour_pct: None,
                week_resets_at: Some("2026-11-18T02:00:00Z".into()),
            }
        );
        assert_eq!((u.accounts[1].week_pct, u.accounts[1].five_hour_pct, u.accounts[1].week_resets_at.as_deref()), (Some(100.0), Some(12.5), None));
        assert_eq!(u.accounts[2].provider, "other");
        let v = serde_json::to_value(shape_summary(&body).unwrap()).unwrap();
        let a = &v["usage"]["accounts"][0];
        for key in ["provider", "label", "weekPct", "fiveHourPct", "weekResetsAt"] {
            assert!(a.get(key).is_some(), "account {key}");
        }
    }

    #[test]
    fn usage_accounts_junk_is_dropped_and_capped_at_six() {
        let mut body = full();
        let mut items = vec![
            account(json!(5), json!("No provider")),
            account(json!("claude"), json!("")),
            account(json!("claude"), json!("   ")),
            account(json!("claude"), json!(7)),
            json!("junk"),
        ];
        for n in 0..10 {
            items.push(account(json!("claude"), json!(format!("Claude {n}"))));
        }
        body["usage"]["accounts"] = json!(items);
        let u = shape_summary(&body).unwrap().usage.unwrap();
        assert_eq!(u.accounts.len(), 6);
        assert_eq!(u.accounts[0].label, "Claude 0");
        body["usage"]["accounts"] = json!([account(json!("claude"), json!("x".repeat(100)))]);
        let u = shape_summary(&body).unwrap().usage.unwrap();
        assert_eq!(u.accounts[0].label.chars().count(), 24);
        body["usage"]["accounts"] = json!({ "provider": "claude" });
        assert!(shape_summary(&body).unwrap().usage.unwrap().accounts.is_empty());
    }

    #[test]
    fn a_null_week_with_accounts_keeps_usage() {
        let mut body = full();
        body["usage"]["claudeWeekPct"] = Value::Null;
        body["usage"]["accounts"] = json!([account(json!("codex"), json!("Codex"))]);
        let u = shape_summary(&body).unwrap().usage.unwrap();
        assert_eq!(u.claude_week_pct, None);
        assert_eq!(u.accounts.len(), 1);
        let v = serde_json::to_value(shape_summary(&body).unwrap()).unwrap();
        assert!(v["usage"]["claudeWeekPct"].is_null());
        // No valid week and no surviving account: no usage block at all.
        body["usage"]["accounts"] = json!([account(json!(1), json!("Codex"))]);
        assert!(shape_summary(&body).unwrap().usage.is_none());
    }

    #[test]
    fn known_ids_include_every_new_source() {
        let mut body = full();
        body["sessionsList"] = json!([lane_json(&id(11))]);
        body["yourMove"]["ids"] = json!([id(12)]);
        body["sessions"] = json!({});
        body["sessions"][id(13)] = json!({ "title": "Named" });
        body["day"] = json!([{ "lane": id(14), "start": "2026-11-12T17:00:00Z", "end": null, "kind": "run" }]);
        let ids = ids_of(&shape_summary(&body).unwrap());
        for n in [1, 2, 11, 12, 13, 14] {
            assert!(ids.contains(&id(n)), "missing {}", id(n));
        }
        assert_eq!(ids.len(), 6);
    }

    const EXE: &str = r"C:\Program Files\Example\omnigent.exe";

    #[test]
    fn handler_command_lines_are_parsed() {
        // Quoted, with and without arguments.
        assert_eq!(handler_exe(r#""C:\Program Files\Example\omnigent.exe" "%1""#).as_deref(), Some(EXE));
        assert_eq!(handler_exe(r#""C:\Program Files\Example\omnigent.exe""#).as_deref(), Some(EXE));
        assert_eq!(handler_exe(r#"  "C:\Program Files\Example\omnigent.exe" open "%1""#).as_deref(), Some(EXE));
        // Unquoted: up to the first `.exe`, spaces in the folder name included.
        assert_eq!(handler_exe(r#"C:\Program Files\Example\omnigent.exe "%1""#).as_deref(), Some(EXE));
        assert_eq!(handler_exe(r"C:\Apps\Example\OmniGent.EXE %1").as_deref(), Some(r"C:\Apps\Example\OmniGent.EXE"));
        assert_eq!(handler_exe(r"C:\Apps\Example\omnigent.exe").as_deref(), Some(r"C:\Apps\Example\omnigent.exe"));
        // Unquoted with no `.exe`: up to the first space, which then fails the `.exe` rule.
        assert_eq!(handler_exe(r"C:\Apps\Example\omnigent %1"), None);
        assert_eq!(handler_exe(r"rundll32 url.dll,FileProtocolHandler %1"), None);
        // Empty and whitespace.
        assert_eq!(handler_exe(""), None);
        assert_eq!(handler_exe("   \t "), None);
        assert_eq!(handler_exe(r#""""#), None);
        // An unclosed quote, and a quoted path that is not an executable.
        assert_eq!(handler_exe(r#""C:\Program Files\Example\omnigent.exe %1"#), None);
        assert_eq!(handler_exe(r#""C:\Program Files\Example\omnigent.cmd" "%1""#), None);
        assert_eq!(handler_exe(r#""C:\Program Files\Example\omnigent.exe.bak" "%1""#), None);
        // Oversized: 2048 characters pass, 2049 do not.
        let path = format!(r"C:\{}\omnigent.exe", "a".repeat(2048 - 16));
        assert_eq!(path.chars().count(), 2048);
        assert_eq!(handler_exe(&path).as_deref(), Some(path.as_str()));
        let long = format!(r"C:\{}\omnigent.exe", "a".repeat(2048 - 15));
        assert_eq!(handler_exe(&long), None);
        assert_eq!(handler_exe(&format!(r#""{EXE}" {}"#, "x".repeat(4096))), None);
    }

    #[test]
    fn only_the_registered_executable_matches() {
        assert!(same_exe(EXE, EXE));
        assert!(same_exe(r"C:\PROGRAM FILES\EXAMPLE\OMNIGENT.EXE", EXE));
        assert!(same_exe(r"\\?\C:\Program Files\Example\omnigent.exe", EXE));
        assert!(same_exe(EXE, r"\\?\c:\program files\example\omnigent.exe"));
        assert!(same_exe("C:/Program Files/Example/omnigent.exe", EXE));
        // The same file name in another folder is refused.
        assert!(!same_exe(r"C:\Users\Public\Downloads\omnigent.exe", EXE));
        assert!(!same_exe(r"C:\Program Files\Example2\omnigent.exe", EXE));
        assert!(!same_exe("omnigent.exe", EXE));
        assert!(!same_exe(r"C:\Program Files\Example\omnigent.exe.bak", EXE));
        assert!(!same_exe("", ""));
        // The two pieces together: a look-alike is refused against the parsed handler.
        let registered = handler_exe(r#""C:\Program Files\Example\omnigent.exe" "%1""#).expect("parsed");
        assert!(same_exe(r"C:\Program Files\Example\omnigent.exe", &registered));
        assert!(!same_exe(r"D:\Other\omnigent.exe", &registered));
    }

    #[test]
    fn one_forward_step_at_a_time() {
        let flag = AtomicBool::new(false);
        let first = try_begin(&flag).expect("free at first");
        assert!(try_begin(&flag).is_none());
        assert!(try_begin(&flag).is_none());
        drop(first);
        let again = try_begin(&flag).expect("free after the first guard is dropped");
        assert!(try_begin(&flag).is_none());
        drop(again);
        assert!(!flag.load(Ordering::Acquire));
    }

    #[test]
    fn a_panic_releases_the_forward_flag() {
        static FLAG: AtomicBool = AtomicBool::new(false);
        let guard = try_begin(&FLAG).expect("free");
        let joined = std::thread::spawn(move || {
            let _guard = guard;
            panic!("forward step failed");
        })
        .join();
        assert!(joined.is_err());
        assert!(try_begin(&FLAG).is_some());
    }

    fn rect(left: i32, top: i32, right: i32, bottom: i32) -> Rect {
        Rect { left, top, right, bottom }
    }

    #[test]
    fn a_smaller_window_is_centred_in_the_work_area() {
        let work = rect(0, 0, 1920, 1040);
        assert_eq!(fit_into(work, rect(3000, 200, 3800, 800)), rect(560, 220, 1360, 820));
    }

    #[test]
    fn a_larger_window_is_shrunk_to_the_work_area() {
        let work = rect(0, 0, 1920, 1040);
        assert_eq!(fit_into(work, rect(-100, -50, 5000, 2000)), work);
        // Only the dimension that is too large shrinks.
        assert_eq!(fit_into(work, rect(2000, 0, 2800, 1400)), rect(560, 0, 1360, 1040));
    }

    #[test]
    fn fit_into_handles_negative_coordinates() {
        // A primary work area left of and above the origin of the virtual screen.
        let work = rect(-2560, -200, 0, 1200);
        assert_eq!(fit_into(work, rect(100, 100, 900, 700)), rect(-1680, 200, -880, 800));
        // A window on a monitor to the left of the primary one.
        let primary = rect(0, 0, 1920, 1040);
        assert_eq!(fit_into(primary, rect(-1500, 100, -700, 700)), rect(560, 220, 1360, 820));
        // A backwards window rectangle is treated as empty, never as negative size.
        assert_eq!(fit_into(primary, rect(10, 10, 0, 0)), rect(960, 520, 960, 520));
    }

    #[test]
    fn the_first_visible_unowned_titled_window_is_picked() {
        let c = |visible, owned, has_title| Candidate { visible, owned, has_title };
        assert_eq!(pick_window(&[]), None);
        assert_eq!(pick_window(&[c(false, false, true), c(true, true, true), c(true, false, false)]), None);
        assert_eq!(pick_window(&[c(false, false, true), c(true, false, true), c(true, false, true)]), Some(1));
        assert_eq!(pick_window(&[c(true, false, true)]), Some(0));
    }

    #[test]
    fn the_focus_command_is_gated_to_wall2() {
        assert_eq!(require_wall2("main"), Err("forbidden".to_string()));
        // The gate is the first thing the command does, before any id check or window search.
        let src = include_str!("wall2_omni.rs");
        let at = src.find("pub fn wall2_focus_omnigent(").expect("command");
        let body = &src[at..];
        let open = body.find('{').expect("body");
        let first = body[open + 1..].trim_start();
        assert!(first.starts_with("require_wall2(window.label())?;"), "first statement: {}", &first[..first.len().min(60)]);
    }
}
