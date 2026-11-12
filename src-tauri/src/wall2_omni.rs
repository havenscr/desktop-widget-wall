//! Wall 2 helper client: reads the agent lanes helper's summary and the machine numbers.
//!
//! The address comes from `feeds.json` (`omniHelperUrl`, https only, host and optional
//! port) and is never put in an error message. Session links use the host from
//! `feeds.json` (`omniLinkHost`, a bare hostname). Every failure maps to a fixed string:
//! `not-configured`, `invalid-config`, `failed`, `forbidden`. Nothing here logs, and
//! nothing here takes a wake lock. The web view never supplies a URL: it passes a session
//! id, and Rust builds the link after checking the id.

use crate::wall2_feeds::{agent, read_base, read_body, require_ok, NOT_CONFIGURED};
use serde::Serialize;
use serde_json::Value;
use std::sync::Mutex;
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
const MAX_DAY: usize = 200;
const MAX_TITLE_CHARS: usize = 80;
const MAX_LINE_CHARS: usize = 80;
const MAX_QUESTION_CHARS: usize = 200;
const MAX_STAMP_CHARS: usize = 40;
/// The box numbers ride on the helper summary, which is read at most this often.
const BOX_TTL: Duration = Duration::from_secs(15);

// Section: types

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Slots {
    pub used: u64,
    pub limit: u64,
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
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YourMoveFirst {
    pub session_id: String,
    pub title: String,
    pub kind: String,
    pub since: String,
    pub question: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct YourMove {
    pub total: u64,
    pub first: Option<YourMoveFirst>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub claude_week_pct: f64,
    pub claude5h_pct: f64,
    pub week_resets_at: Option<String>,
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

/// Text with control characters dropped, trimmed, cut to `max` characters.
fn clean_text(v: Option<&Value>, max: usize) -> Option<String> {
    let s = v?.as_str()?;
    let s: String = s.chars().filter(|c| !c.is_control()).collect();
    let s = s.trim();
    Some(s.chars().take(max).collect())
}

fn one_of(v: Option<&Value>, allowed: &[&str]) -> Option<String> {
    let s = v?.as_str()?;
    allowed.contains(&s).then(|| s.to_string())
}

fn count(v: Option<&Value>) -> Option<u64> {
    let n = v?.as_f64()?;
    (n.is_finite() && n >= 0.0).then(|| n.min(1.0e12) as u64)
}

fn percent(v: Option<&Value>) -> Option<f64> {
    let n = v?.as_f64()?;
    n.is_finite().then(|| n.clamp(0.0, 100.0))
}

fn shape_lane(v: &Value) -> Option<Lane> {
    let id = v.get("id")?.as_str().filter(|s| valid_session_id(s))?.to_string();
    let pr = v.get("pr").filter(|p| p.is_object()).and_then(|p| {
        Some(LanePr {
            number: count(p.get("number"))?,
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
        elapsed_s: count(v.get("elapsedS")).unwrap_or(0),
        waiting: v.get("waiting").and_then(Value::as_bool).unwrap_or(false),
        pr,
    })
}

fn shape_your_move(v: Option<&Value>) -> YourMove {
    let Some(v) = v else { return YourMove { total: 0, first: None } };
    let first = v.get("first").filter(|f| f.is_object()).and_then(|f| {
        Some(YourMoveFirst {
            session_id: f.get("sessionId")?.as_str().filter(|s| valid_session_id(s))?.to_string(),
            title: clean_text(f.get("title"), MAX_TITLE_CHARS)?,
            kind: one_of(f.get("kind"), &["gate", "awaiting", "blocked", "review"])?,
            since: clean_text(f.get("since"), MAX_STAMP_CHARS).unwrap_or_default(),
            question: clean_text(f.get("question"), MAX_QUESTION_CHARS).unwrap_or_default(),
        })
    });
    YourMove { total: count(v.get("total")).unwrap_or(0), first }
}

fn shape_usage(v: Option<&Value>) -> Option<Usage> {
    let v = v.filter(|u| u.is_object())?;
    Some(Usage {
        claude_week_pct: percent(v.get("claudeWeekPct"))?,
        claude5h_pct: percent(v.get("claude5hPct"))?,
        week_resets_at: clean_text(v.get("weekResetsAt"), MAX_STAMP_CHARS),
    })
}

fn shape_day(v: Option<&Value>) -> Vec<DaySpan> {
    let Some(items) = v.and_then(Value::as_array) else { return Vec::new() };
    items
        .iter()
        .filter_map(|d| {
            Some(DaySpan {
                lane: d.get("lane")?.as_str().filter(|s| valid_session_id(s))?.to_string(),
                start: clean_text(d.get("start"), MAX_STAMP_CHARS).filter(|s| !s.is_empty())?,
                end: clean_text(d.get("end"), MAX_STAMP_CHARS).filter(|s| !s.is_empty()),
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
    let limit = slots.and_then(|s| count(s.get("limit"))).unwrap_or(3);
    let used = slots.and_then(|s| count(s.get("used"))).unwrap_or(lanes.len() as u64);
    Some(OmniSummary {
        now: clean_text(obj.get("now"), MAX_STAMP_CHARS)?,
        tz: clean_text(obj.get("tz"), 64).unwrap_or_default(),
        stale: obj.get("stale").and_then(Value::as_bool).unwrap_or(false),
        slots: Slots { used, limit },
        lanes,
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

fn fetch_summary(base: &str) -> Result<OmniSummary, String> {
    let resp = agent()
        .get(&format!("{base}/wall/v1/summary"))
        .set("Accept", "application/json")
        .call()
        .map_err(|_| FAILED.to_string())?;
    let resp = require_ok(resp).map_err(|_| FAILED.to_string())?;
    let bytes = read_body(resp).map_err(|_| FAILED.to_string())?;
    parse_answer(&bytes)
}

fn require_wall2(label: &str) -> Result<(), String> {
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
    summary.links_available = link_host(&app).is_ok();
    Ok(summary)
}

#[tauri::command]
pub fn wall2_open_session(window: tauri::WebviewWindow, app: tauri::AppHandle, id: String) -> Result<(), String> {
    require_wall2(window.label())?;
    if !valid_session_id(&id) {
        return Err("Unknown session".to_string());
    }
    let host = link_host(&app)?;
    let url = session_url(&host, &id).ok_or_else(|| "Unknown session".to_string())?;
    app.opener().open_url(url, None::<&str>).map_err(|_| "Could not open the session".to_string())
}

// Section: machines

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PcStats {
    pub cpu_pct: f64,
    pub gpu_pct: f64,
    pub ram_pct: f64,
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

fn pc_from(stats: &crate::SystemStatsSummary) -> PcStats {
    let clamp = |n: f32| if n.is_finite() { f64::from(n).clamp(0.0, 100.0) } else { 0.0 };
    PcStats { cpu_pct: clamp(stats.cpu), gpu_pct: clamp(stats.gpu), ram_pct: clamp(stats.ram) }
}

type BoxReading = (Option<BoxStats>, bool);

/// The last helper reading and when it was taken. A failed read is kept too, so a helper
/// that is down is asked once per window, not on every PC poll.
static BOX_CACHE: Mutex<Option<(Instant, BoxReading)>> = Mutex::new(None);

fn cache_fresh(age: Duration) -> bool {
    age < BOX_TTL
}

fn read_box(app: &tauri::AppHandle) -> BoxReading {
    let Ok(base) = helper_base(app) else { return (None, false) };
    if let Ok(guard) = BOX_CACHE.lock() {
        if let Some((at, reading)) = guard.as_ref() {
            if cache_fresh(at.elapsed()) {
                return reading.clone();
            }
        }
    }
    let reading = match fetch_summary(&base) {
        Ok(summary) => box_from_summary(&summary),
        Err(_) => (None, false),
    };
    if let Ok(mut guard) = BOX_CACHE.lock() {
        *guard = Some((Instant::now(), reading.clone()));
    }
    reading
}

#[tauri::command]
pub async fn wall2_machines(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<Machines, String> {
    require_wall2(window.label())?;
    tauri::async_runtime::spawn_blocking(move || {
        let pc = pc_from(&crate::read_system_stats()?);
        let (box_stats, box_stale) = read_box(&app);
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
        assert_eq!(s.slots, Slots { used: 3, limit: 3 });
        assert_eq!(s.lanes.len(), 2);
        assert_eq!(s.lanes[0].title, "Voice: iPhone mic fix");
        assert_eq!(s.lanes[0].elapsed_s, 2520);
        assert_eq!(s.lanes[0].pr, Some(LanePr { number: 553, ci: "passing".into(), ready: true }));
        assert_eq!(s.lanes[1].pr, None);
        assert!(s.lanes[1].waiting);
        assert_eq!(s.parked, 4);
        assert_eq!(s.your_move.total, 1);
        assert_eq!(s.your_move.first.as_ref().unwrap().kind, "gate");
        assert_eq!(s.usage.as_ref().unwrap().claude_week_pct, 62.0);
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
        assert_eq!(s.your_move, YourMove { total: 0, first: None });
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
        let text = format!(r#"{{"now":"x","lanes":[]}}{pad}"#);
        assert_eq!(parse_answer(text.as_bytes()), Err("failed".to_string()));
        assert!(parse_answer(br#"{"now":"x","lanes":[]}"#).is_ok());
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
        assert_eq!(pc_from(&stats), PcStats { cpu_pct: 12.5, gpu_pct: 0.0, ram_pct: 100.0 });
    }

    #[test]
    fn machines_serialize_with_the_agreed_names() {
        let m = Machines {
            pc: PcStats { cpu_pct: 1.0, gpu_pct: 2.0, ram_pct: 3.0 },
            box_stats: None,
            box_stale: false,
        };
        let v = serde_json::to_value(&m).unwrap();
        assert!(v["pc"].get("cpuPct").is_some());
        assert!(v["box"].is_null());
        assert_eq!(v["boxStale"], json!(false));
    }

    #[test]
    fn box_cache_window() {
        assert!(cache_fresh(Duration::from_secs(0)));
        assert!(cache_fresh(Duration::from_secs(14)));
        assert!(!cache_fresh(Duration::from_secs(15)));
    }
}
