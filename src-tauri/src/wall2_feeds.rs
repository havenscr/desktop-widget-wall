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

/// Open tasks only (`kind` task, `status` open), the first three in server order.
fn pick_tasks(body: &Value) -> Vec<TaskItem> {
    let Some(rows) = body.get("tasks").and_then(Value::as_array) else {
        return Vec::new();
    };
    rows.iter()
        .filter(|t| t.get("kind").and_then(Value::as_str) == Some("task") && t.get("status").and_then(Value::as_str) == Some("open"))
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
            })
        })
        .take(TASK_LIMIT)
        .collect()
}

#[tauri::command]
pub async fn wall2_tasks_next(app: tauri::AppHandle) -> Result<Vec<TaskItem>, String> {
    let base = read_base(&app, "tasksBaseUrl", true)?;
    tauri::async_runtime::spawn_blocking(move || {
        let body = get_json(&format!("{base}/api/tasks?status=open"))?;
        Ok(pick_tasks(&body))
    })
    .await
    .map_err(|_| "The request did not finish".to_string())?
}

#[tauri::command]
pub async fn wall2_task_done(app: tauri::AppHandle, id: String) -> Result<(), String> {
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
fn parse_iso(s: &str) -> Option<f64> {
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
    }
    let health = summary.get("health");
    out.firewalla = firewalla_info(health);
    if let Some(fw) = health.and_then(|h| h.get("firewalla")).filter(|f| f.is_object()) {
        out.portal_url = portal_link(fw.get("portalUrl"));
    }
    out
}

#[tauri::command]
pub async fn wall2_home_security(app: tauri::AppHandle) -> Result<SecuritySummary, String> {
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
pub fn wall2_links(app: tauri::AppHandle) -> LinkAvailability {
    LinkAvailability { security: security_link(&app).is_some(), portal: last_portal().is_some() }
}

#[tauri::command]
pub fn wall2_open_link(app: tauri::AppHandle, kind: String) -> Result<(), String> {
    let url = match kind.as_str() {
        "security" => security_link(&app),
        "portal" => last_portal(),
        _ => None,
    }
    .ok_or_else(|| "No such link".to_string())?;
    app.opener().open_url(url, None::<&str>).map_err(|_| "Could not open the link".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
