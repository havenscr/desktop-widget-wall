//! Wall 2 Meet: the next meetings from up to two Microsoft 365 accounts.
//!
//! Everything that touches a token, an authorization code or a join link happens here. The
//! web view gets account states, meeting titles and times, and opaque keys, nothing else.
//! Refresh tokens live in Windows Credential Manager; access tokens live in memory only.
//! The only log is `wall2-meet.log` (state changes and a reason code, see `meetlog.rs`); every
//! failure maps to a fixed string or a reason code built from numbers and a checked name.

mod auth;
mod graph;
mod meetlog;
mod reason;
mod service;
mod store;

pub(crate) use graph::civil_from_days;

use serde_json::Value;
use std::io::Read;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

pub(crate) const MAX_TITLE_CHARS: usize = 200;
const MAX_BODY: u64 = 1_000_000;
const TIMEOUT: Duration = Duration::from_secs(15);

const NOT_CONFIGURED: &str = "not-configured";
const INVALID_CONFIG: &str = "invalid-config";

// Section: shared http

pub(crate) fn agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| ureq::AgentBuilder::new().timeout(TIMEOUT).redirects(0).build())
}

/// At most `limit` plus one bytes of a body, for an error reply whose JSON is only read for a
/// code. The extra byte tells the reason builder that the body was over the limit.
pub(crate) fn read_capped(resp: ureq::Response, limit: u64) -> Vec<u8> {
    let mut buf = Vec::new();
    let _ = resp.into_reader().take(limit + 1).read_to_end(&mut buf);
    buf
}

/// Start `wall2-meet.log` in the app log directory (cleared at launch).
pub fn start_log(dir: Option<std::path::PathBuf>) {
    meetlog::start(dir);
}

/// The body, capped at 1 MB; None when it cannot be read or is larger.
pub(crate) fn read_body(resp: ureq::Response) -> Option<Vec<u8>> {
    let mut buf = Vec::new();
    resp.into_reader().take(MAX_BODY + 1).read_to_end(&mut buf).ok()?;
    if buf.len() as u64 > MAX_BODY {
        None
    } else {
        Some(buf)
    }
}

struct HttpGraph;

impl graph::GraphClient for HttpGraph {
    fn calendar_view(&self, access: &str, start: &str, end: &str) -> graph::GraphReply {
        use graph::GraphReply;
        let url = format!(
            "https://graph.microsoft.com/v1.0/me/calendarView?startDateTime={}&endDateTime={}&$select=subject,start,end,isAllDay,isCancelled,responseStatus,onlineMeeting,onlineMeetingUrl,iCalUId&$orderby=start/dateTime&$top=50",
            urlencoding::encode(start),
            urlencoding::encode(end),
        );
        let result = agent()
            .get(&url)
            .set("Authorization", &format!("Bearer {access}"))
            .set("Prefer", "outlook.timezone=\"UTC\"")
            .set("Accept", "application/json")
            .call();
        match result {
            // A redirect is never followed, so a 3xx arrives here as a reply, not an error.
            Ok(resp) if !(200..300).contains(&resp.status()) => {
                let status = resp.status();
                GraphReply::Failed(reason::graph_reason(status, &read_capped(resp, reason::MAX_ERROR_BODY)))
            }
            Ok(resp) => match read_body(resp).and_then(|b| serde_json::from_slice::<Value>(&b).ok()) {
                Some(v) => GraphReply::Ok(v),
                None => GraphReply::Failed(reason::GRAPH_BODY.to_string()),
            },
            Err(ureq::Error::Status(401, _)) => GraphReply::Unauthorized,
            Err(ureq::Error::Status(code, resp)) => {
                let why = reason::graph_reason(code, &read_capped(resp, reason::MAX_ERROR_BODY));
                if code == 429 || code >= 500 {
                    GraphReply::Transient(why)
                } else {
                    GraphReply::Failed(why)
                }
            }
            Err(ureq::Error::Transport(_)) => GraphReply::Transient(reason::GRAPH_NETWORK.to_string()),
        }
    }
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn core() -> &'static Mutex<service::Core> {
    static CORE: OnceLock<Mutex<service::Core>> = OnceLock::new();
    CORE.get_or_init(|| Mutex::new(service::Core::default()))
}

/// One lock for the access-token cache, the link map and every refresh, so two calls never
/// race on a rotated refresh token.
fn lock_core() -> std::sync::MutexGuard<'static, service::Core> {
    core().lock().unwrap_or_else(|e| e.into_inner())
}

fn links() -> &'static Mutex<service::Links> {
    static LINKS: OnceLock<Mutex<service::Links>> = OnceLock::new();
    LINKS.get_or_init(|| Mutex::new(service::Links::default()))
}

fn secrets() -> store::Chunked<store::CredBlobs> {
    store::Chunked(store::CredBlobs)
}

// Section: configuration

#[derive(Debug, Clone, PartialEq)]
pub struct Account {
    pub id: String,
    pub label: String,
    pub client_id: String,
    pub tenant: String,
}

fn is_guid(s: &str) -> bool {
    let parts: Vec<&str> = s.split('-').collect();
    let lens = [8usize, 4, 4, 4, 12];
    parts.len() == 5 && parts.iter().zip(lens).all(|(p, n)| p.len() == n && p.chars().all(|c| c.is_ascii_hexdigit()))
}

fn valid_id(s: &str) -> bool {
    (1..=16).contains(&s.len()) && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

/// Parse `meet.json` text. Never echoes file content in an error.
pub fn parse_config(text: Option<&str>) -> Result<Vec<Account>, &'static str> {
    let text = text.ok_or(NOT_CONFIGURED)?;
    let value: Value = serde_json::from_str(text).map_err(|_| INVALID_CONFIG)?;
    let rows = value.get("accounts").and_then(Value::as_array).ok_or(INVALID_CONFIG)?;
    if rows.is_empty() {
        return Err(NOT_CONFIGURED);
    }
    if rows.len() > 2 {
        return Err(INVALID_CONFIG);
    }
    let mut out: Vec<Account> = Vec::new();
    for row in rows {
        let text_of = |k: &str| row.get(k).and_then(Value::as_str);
        let id = text_of("id").filter(|s| valid_id(s)).ok_or(INVALID_CONFIG)?;
        let label = text_of("label")
            .filter(|s| (1..=16).contains(&s.chars().count()) && s.chars().all(|c| !c.is_control()) && s.trim() == *s)
            .ok_or(INVALID_CONFIG)?;
        let client_id = text_of("clientId").filter(|s| is_guid(s)).ok_or(INVALID_CONFIG)?;
        let tenant = match row.get("tenant") {
            None | Some(Value::Null) => "common",
            Some(Value::String(t)) if matches!(t.as_str(), "common" | "organizations" | "consumers") || is_guid(t) => t.as_str(),
            Some(_) => return Err(INVALID_CONFIG),
        };
        if out.iter().any(|a| a.id == id) {
            return Err(INVALID_CONFIG);
        }
        out.push(Account { id: id.into(), label: label.into(), client_id: client_id.to_string(), tenant: tenant.to_string() });
    }
    Ok(out)
}

fn load_config(window: &tauri::WebviewWindow) -> Result<Vec<Account>, &'static str> {
    let dir = window.path().app_config_dir().map_err(|_| NOT_CONFIGURED)?;
    let text = std::fs::read_to_string(dir.join("meet.json")).ok();
    parse_config(text.as_deref())
}

// Section: window guard

/// Only Wall 2's own window may drive Meet; the old app's window is refused.
pub fn require_wall2(label: &str) -> Result<(), String> {
    if label == crate::WALL2_LABEL {
        Ok(())
    } else {
        Err("forbidden".to_string())
    }
}

// Section: commands

#[tauri::command]
pub async fn wall2_meet_next(window: tauri::WebviewWindow) -> Result<service::MeetPayload, String> {
    require_wall2(window.label())?;
    let accounts = load_config(&window).map_err(str::to_string)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut core = lock_core();
        let payload = service::read_next(&accounts, &secrets(), &auth::HttpTokens, &HttpGraph, &mut core, links(), now_secs());
        meetlog::write_all(std::mem::take(&mut core.log_lines));
        payload
    })
    .await
    .map_err(|_| "failed".to_string())
}

/// The day view's window: the last local midnight at or before `now`, to 36 elapsed hours
/// after it. `offset` says how far the local clock is ahead of UTC at a given instant, so a
/// clock change between now and midnight is handled.
pub(crate) fn day_window(now: i64, offset: &dyn Fn(i64) -> i64) -> (u64, u64) {
    let start = crate::wall2_feeds::local_midnight(now, offset).max(0) as u64;
    (start, start + 36 * 3600)
}

/// Today's events from local midnight to 36 hours after it, past ones included.
#[tauri::command]
pub async fn wall2_meet_day(window: tauri::WebviewWindow) -> Result<service::DayPayload, String> {
    require_wall2(window.label())?;
    let accounts = load_config(&window).map_err(str::to_string)?;
    tauri::async_runtime::spawn_blocking(move || {
        let now = now_secs();
        let (from, to) = day_window(now as i64, &crate::wall2_feeds::local_offset_secs);
        let mut core = lock_core();
        service::read_day(&accounts, &secrets(), &auth::HttpTokens, &HttpGraph, &mut core, links(), now, from, to)
    })
    .await
    .map_err(|_| "failed".to_string())
}

#[tauri::command]
pub async fn wall2_meet_sign_in(window: tauri::WebviewWindow, id: String) -> Result<(), String> {
    require_wall2(window.label())?;
    let account = load_config(&window)
        .ok()
        .and_then(|list| list.into_iter().find(|a| a.id == id))
        .ok_or_else(|| NOT_CONFIGURED.to_string())?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let granted = auth::authorize(&app, &account).map_err(str::to_string)?;
        let result = service::complete_sign_in(&account, &granted, &secrets(), &auth::HttpTokens, core(), now_secs());
        meetlog::write_all(std::mem::take(&mut lock_core().log_lines));
        result
    })
    .await
    .map_err(|_| "failed".to_string())?
}

#[tauri::command]
pub fn wall2_meet_cancel_sign_in(window: tauri::WebviewWindow) -> Result<(), String> {
    require_wall2(window.label())?;
    auth::cancel_sign_in();
    Ok(())
}

#[tauri::command]
pub async fn wall2_meet_join(window: tauri::WebviewWindow, key: String) -> Result<(), String> {
    require_wall2(window.label())?;
    let url = service::lookup_link(links(), &key).ok_or_else(|| "gone".to_string())?;
    if !graph::join_allowed(&url) {
        return Err("gone".to_string());
    }
    window.opener().open_url(url, None::<&str>).map_err(|_| "failed".to_string())
}

#[tauri::command]
pub async fn wall2_meet_sign_out(window: tauri::WebviewWindow, id: String) -> Result<(), String> {
    require_wall2(window.label())?;
    if !valid_id(&id) {
        return Err("failed".to_string());
    }
    // Deleting credentials and waiting for the core lock can block, so not on an async worker.
    tauri::async_runtime::spawn_blocking(move || {
        let mut core = lock_core();
        service::sign_out(&id, &secrets(), &mut core);
    })
    .await
    .map_err(|_| "failed".to_string())
}


#[cfg(test)]
mod tests {
    use super::*;

    const GUID: &str = "00000000-0000-0000-0000-000000000000";

    fn cfg(accounts: &str) -> String {
        format!("{{\"accounts\":[{accounts}]}}")
    }

    fn one(extra: &str) -> String {
        cfg(&format!("{{\"id\":\"work\",\"label\":\"Work\",\"clientId\":\"{GUID}\"{extra}}}"))
    }

    #[test]
    fn valid_file_parses() {
        let text = cfg(&format!(
            "{{\"id\":\"work\",\"label\":\"Work\",\"clientId\":\"{GUID}\"}},{{\"id\":\"second\",\"label\":\"Second\",\"clientId\":\"{GUID}\",\"tenant\":\"organizations\"}}"
        ));
        let accounts = parse_config(Some(&text)).unwrap();
        assert_eq!(accounts.len(), 2);
        assert_eq!(accounts[0].tenant, "common");
        assert_eq!(accounts[1].tenant, "organizations");
        assert_eq!(accounts[1].label, "Second");
    }

    #[test]
    fn tenant_may_be_a_guid() {
        let ok = one(&format!(",\"tenant\":\"{GUID}\""));
        assert!(parse_config(Some(&ok)).is_ok());
    }

    #[test]
    fn missing_file_is_not_configured() {
        assert_eq!(parse_config(None), Err("not-configured"));
        assert_eq!(parse_config(Some("{\"accounts\":[]}")), Err("not-configured"));
    }

    #[test]
    fn each_rule_rejects() {
        let bad = [
            "not json".to_string(),
            "{}".to_string(),
            cfg(&format!("{{\"id\":\"Work\",\"label\":\"Work\",\"clientId\":\"{GUID}\"}}")),
            cfg(&format!("{{\"id\":\"\",\"label\":\"Work\",\"clientId\":\"{GUID}\"}}")),
            cfg(&format!("{{\"id\":\"abcdefghijklmnopq\",\"label\":\"Work\",\"clientId\":\"{GUID}\"}}")),
            cfg(&format!("{{\"id\":\"wo rk\",\"label\":\"Work\",\"clientId\":\"{GUID}\"}}")),
            cfg(&format!("{{\"id\":\"work\",\"label\":\"\",\"clientId\":\"{GUID}\"}}")),
            cfg(&format!("{{\"id\":\"work\",\"label\":\"A very long label here\",\"clientId\":\"{GUID}\"}}")),
            cfg(&format!("{{\"id\":\"work\",\"label\":\"Bad\\nlabel\",\"clientId\":\"{GUID}\"}}")),
            cfg("{\"id\":\"work\",\"label\":\"Work\",\"clientId\":\"not-a-guid\"}"),
            cfg("{\"id\":\"work\",\"label\":\"Work\"}"),
            one(",\"tenant\":\"contoso.example\""),
            one(",\"tenant\":5"),
        ];
        for text in bad {
            assert_eq!(parse_config(Some(&text)), Err("invalid-config"), "{text}");
        }
    }

    #[test]
    fn three_accounts_and_duplicate_ids_are_rejected() {
        let a = |id: &str| format!("{{\"id\":\"{id}\",\"label\":\"L\",\"clientId\":\"{GUID}\"}}");
        let three = cfg(&format!("{},{},{}", a("a"), a("b"), a("c")));
        assert_eq!(parse_config(Some(&three)), Err("invalid-config"));
        let dup = cfg(&format!("{},{}", a("a"), a("a")));
        assert_eq!(parse_config(Some(&dup)), Err("invalid-config"));
    }

    #[test]
    fn errors_never_echo_the_file() {
        let text = "{\"accounts\":[{\"id\":\"SECRETSECRET\"}]}";
        assert!(!parse_config(Some(text)).unwrap_err().contains("SECRET"));
    }

    #[test]
    fn only_wall2_passes_the_guard() {
        assert!(require_wall2("wall2").is_ok());
        assert!(require_wall2("main").is_err());
        assert!(require_wall2("").is_err());
    }

    // 2026-03-08 07:00 UTC: US east clocks go forward (UTC-5 to UTC-4).
    fn spring(utc: i64) -> i64 {
        if utc < 1_772_953_200 { -5 * 3600 } else { -4 * 3600 }
    }

    // 2026-11-01 06:00 UTC: US east clocks go back (UTC-4 to UTC-5).
    fn fall(utc: i64) -> i64 {
        if utc < 1_793_512_800 { -4 * 3600 } else { -5 * 3600 }
    }

    #[test]
    fn day_window_on_a_normal_day() {
        // 2026-11-12 17:00 UTC is 18:00 at UTC+1; local midnight was 2026-11-11 23:00 UTC.
        assert_eq!(day_window(1_794_502_800, &|_| 3600), (1_794_438_000, 1_794_438_000 + 36 * 3600));
        assert_eq!(day_window(1_794_502_800, &|_| 0), (1_794_441_600, 1_794_441_600 + 36 * 3600));
    }

    #[test]
    fn day_window_on_a_spring_forward_day() {
        // 14:00 local after the change; midnight was at UTC-5 (05:00 UTC). 36 elapsed hours later.
        assert_eq!(day_window(1_772_992_800, &spring), (1_772_946_000, 1_772_946_000 + 36 * 3600));
    }

    #[test]
    fn day_window_on_a_fall_back_day() {
        // 15:00 local after the change; midnight was at UTC-4 (04:00 UTC), 25 hours before the next one.
        assert_eq!(day_window(1_793_563_200, &fall), (1_793_505_600, 1_793_505_600 + 36 * 3600));
    }
}
