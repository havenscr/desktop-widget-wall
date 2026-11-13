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
mod netprobe;
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

const NOT_CONFIGURED: &str = "not-configured";
const INVALID_CONFIG: &str = "invalid-config";

// Section: shared http

pub(crate) fn agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        ureq::AgentBuilder::new()
            .timeout_connect(graph::CONNECT_TIMEOUT)
            .timeout_read(graph::READ_TIMEOUT)
            .timeout_write(graph::READ_TIMEOUT)
            .timeout(graph::BUDGET)
            .redirects(0)
            .resolver(netprobe::TimedResolver)
            .build()
    })
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
    read_body_kind(resp).ok()
}

/// Like `read_body`, but says why it failed: `body-size` (over the cap, not a network fault)
/// or `body` (the read broke).
pub(crate) fn read_body_kind(resp: ureq::Response) -> Result<Vec<u8>, &'static str> {
    let mut buf = Vec::new();
    resp.into_reader().take(MAX_BODY + 1).read_to_end(&mut buf).map_err(|_| "body")?;
    if buf.len() as u64 > MAX_BODY {
        Err("body-size")
    } else {
        Ok(buf)
    }
}

const GRAPH_HOST: &str = "graph.microsoft.com";
const LOGIN_HOST: &str = "login.microsoftonline.com";

struct HttpGraph;

/// A unique id sent as `client-request-id`, so a failed call can be matched to Microsoft's
/// own record of it. Not secret and not a security token.
fn new_client_request_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let n = N.fetch_add(1, Ordering::Relaxed) as u128;
    let h = format!("{:032x}", nanos.wrapping_mul(0x9E37_79B9_7F4A_7C15).wrapping_add(n << 64 | n));
    format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32])
}

/// The class of a transport error (`dns`, `connect`, `timeout`, `reset`, `other`),
/// from the error kinds only.
pub(crate) fn net_of(t: &ureq::Transport) -> &'static str {
    let kind = match t.kind() {
        ureq::ErrorKind::Dns => graph::NetKind::Dns,
        ureq::ErrorKind::ConnectionFailed => graph::NetKind::Connect,
        ureq::ErrorKind::Io => graph::NetKind::Io,
        _ => graph::NetKind::Other,
    };
    let io = std::error::Error::source(t).and_then(|e| e.downcast_ref::<std::io::Error>()).map(|e| e.kind());
    graph::classify_net(kind, io)
}

/// The fixed failure fields for a transport error to `host_prefix` (see `netprobe.rs`).
pub(crate) fn probe_of(host_prefix: &str, t: &ureq::Transport) -> netprobe::NetProbe {
    let stage = match t.kind() {
        ureq::ErrorKind::Dns => netprobe::Stage::Dns,
        ureq::ErrorKind::ConnectionFailed => netprobe::Stage::Connect,
        ureq::ErrorKind::Io => netprobe::Stage::Io,
        ureq::ErrorKind::BadStatus | ureq::ErrorKind::BadHeader => netprobe::Stage::Reply,
        _ => netprobe::Stage::Other,
    };
    let io = std::error::Error::source(t).and_then(|e| e.downcast_ref::<std::io::Error>()).map(|e| e.kind());
    netprobe::describe(host_prefix, stage, io)
}

fn header_of(resp: &ureq::Response, name: &str) -> Option<String> {
    resp.header(name).map(str::to_string)
}

fn raw_of(resp: ureq::Response, success_body: bool) -> graph::Raw {
    let status = resp.status();
    // Any reply means the host is reachable again: the next failure may be probed.
    netprobe::reached(GRAPH_HOST);
    let retry_after = header_of(&resp, "retry-after");
    let request_id = header_of(&resp, "request-id");
    let client_request_id = header_of(&resp, "client-request-id");
    let mut probe = None;
    let body = if success_body {
        read_body_kind(resp).unwrap_or_else(|phase| {
            probe = Some(netprobe::NetProbe { phase, af: "unknown", resolved: 0, dns_ms: None, v4: netprobe::Probe::None, v6: netprobe::Probe::None, probe_ms: 0 });
            Vec::new()
        })
    } else {
        read_capped(resp, reason::MAX_ERROR_BODY)
    };
    graph::Raw { status, net: None, retry_after, request_id, client_request_id, body, probe }
}

impl graph::GraphClient for HttpGraph {
    fn calendar_view(&self, access: &str, start: &str, end: &str) -> graph::GraphReply {
        let ctx = graph::Ctx::new(graph::Kind::Next, std::sync::Arc::new(graph::RealClock), graph::BUDGET);
        self.calendar_view_diag(access, start, end, &ctx).0
    }

    fn calendar_view_diag(&self, access: &str, start: &str, end: &str, ctx: &graph::Ctx) -> (graph::GraphReply, Option<graph::Diag>) {
        let url = graph::calendar_view_url(start, end);
        let mut send = |_attempt: u32, timeout: Duration| -> graph::Raw {
            // Forget the last lookup of this host, so a failure never reports an old one.
            netprobe::begin(GRAPH_HOST);
            let result = agent()
                .get(&url)
                .timeout(timeout)
                .set("Authorization", &format!("Bearer {access}"))
                .set("Prefer", graph::PREFER)
                .set("Accept", "application/json")
                .set("client-request-id", &new_client_request_id())
                .set("return-client-request-id", "true")
                .call();
            match result {
                // A redirect is never followed, so a 3xx arrives here as a reply, not an error.
                Ok(resp) => {
                    let ok = (200..300).contains(&resp.status());
                    raw_of(resp, ok)
                }
                Err(ureq::Error::Status(_, resp)) => raw_of(resp, false),
                Err(ureq::Error::Transport(t)) => graph::Raw { status: 0, net: Some(net_of(&t)), retry_after: None, request_id: None, client_request_id: None, body: Vec::new(), probe: Some(probe_of(GRAPH_HOST, &t)) },
            }
        };
        graph::run_attempts(ctx, &mut send)
    }
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn core() -> &'static Mutex<service::Core> {
    static CORE: OnceLock<Mutex<service::Core>> = OnceLock::new();
    CORE.get_or_init(|| Mutex::new(service::Core::default()))
}

/// One lock for the access-token cache, the per-account generation and the log queue. It is
/// held in short steps only, never across a token request or a Graph call.
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

/// With no arguments: every account, in parallel. With `only`: that account only, the other
/// answered from what is held. With `peek`: nothing goes to the network; the accounts come
/// back at once with their last known state ("checking" before the first read).
#[tauri::command]
pub async fn wall2_meet_next(window: tauri::WebviewWindow, only: Option<String>, peek: Option<bool>) -> Result<service::MeetPayload, String> {
    require_wall2(window.label())?;
    let accounts = load_config(&window).map_err(str::to_string)?;
    if only.as_deref().is_some_and(|id| !valid_id(id)) {
        return Err("failed".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let now = now_secs();
        let payload = if peek == Some(true) {
            service::read_next_only(&accounts, &secrets(), &auth::HttpTokens, &HttpGraph, core(), links(), now, service::Only::Nobody)
        } else if let Some(id) = only.as_deref() {
            service::read_next_only(&accounts, &secrets(), &auth::HttpTokens, &HttpGraph, core(), links(), now, service::Only::One(id))
        } else {
            service::read_next_parallel(&accounts, &secrets(), &auth::HttpTokens, &HttpGraph, core(), links(), now)
        };
        let lines = std::mem::take(&mut lock_core().log_lines);
        meetlog::write_all(lines);
        payload
    })
    .await
    .map_err(|_| "failed".to_string())
}

pub(crate) fn day_window(now: i64, offset: &dyn Fn(i64) -> i64) -> (u64, u64) {
    let start = crate::wall2_feeds::local_midnight(now, offset);
    // Two local days are 46 to 50 hours long, so 50 hours after today's midnight is always
    // inside the day after tomorrow; its midnight is the end of tomorrow.
    let end = crate::wall2_feeds::local_midnight(start + 50 * 3600, offset);
    (start.max(0) as u64, end.max(0) as u64)
}

/// Today's and tomorrow's events, from local midnight to the end of tomorrow, past ones included.
#[tauri::command]
pub async fn wall2_meet_day(window: tauri::WebviewWindow) -> Result<service::DayPayload, String> {
    require_wall2(window.label())?;
    let accounts = load_config(&window).map_err(str::to_string)?;
    tauri::async_runtime::spawn_blocking(move || {
        let now = now_secs();
        let (from, to) = day_window(now as i64, &crate::wall2_feeds::local_offset_secs);
        let payload = service::read_day_parallel(&accounts, &secrets(), &auth::HttpTokens, &HttpGraph, core(), links(), now, from, to);
        let lines = std::mem::take(&mut lock_core().log_lines);
        meetlog::write_all(lines);
        payload
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
        let lines = std::mem::take(&mut lock_core().log_lines);
        meetlog::write_all(lines);
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

/// True when a key has exactly the shape of a day key as `service::read_day` makes them:
/// `d`, the generation (1 to 19 digits), `-`, the event's index (1 to 3 digits). ASCII only
/// and at most 24 characters, so nothing long or odd ever reaches the map.
fn valid_day_key(key: &str) -> bool {
    if key.len() > 24 || !key.is_ascii() {
        return false;
    }
    let Some(rest) = key.strip_prefix('d') else {
        return false;
    };
    let Some((generation, index)) = rest.split_once('-') else {
        return false;
    };
    let digits = |s: &str, max: usize| !s.is_empty() && s.len() <= max && s.bytes().all(|b| b.is_ascii_digit());
    digits(generation, 19) && digits(index, 3)
}

/// Open a day view event in Outlook on the web. The web view passes only the event's key;
/// a key without the day key shape is refused before any lookup. The link stays in Rust
/// and is checked against the Outlook host list again before opening.
#[tauri::command]
pub async fn wall2_open_event(window: tauri::WebviewWindow, key: String) -> Result<(), String> {
    require_wall2(window.label())?;
    if !valid_day_key(&key) {
        return Err("gone".to_string());
    }
    let url = service::lookup_web_link(links(), &key).ok_or_else(|| "gone".to_string())?;
    if !graph::web_link_allowed(&url) {
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
    // Deleting credentials takes the core lock briefly (no read holds it across the network),
    // but it is still blocking work, so not on an async worker.
    tauri::async_runtime::spawn_blocking(move || {
        service::sign_out(&id, &secrets(), core(), links());
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
    fn day_keys_must_have_the_generated_shape() {
        assert!(valid_day_key("d1-0"));
        assert!(valid_day_key("d42-7"));
        assert!(valid_day_key("d1234567890123456789-999"));
        // Oversized: too many digits, or simply too long.
        assert!(!valid_day_key("d12345678901234567890-1"));
        assert!(!valid_day_key("d1-1000"));
        assert!(!valid_day_key(&format!("d1-{}", "1".repeat(40))));
        assert!(!valid_day_key(&"d".repeat(4096)));
        // A join key from the next meetings read has no `d`.
        assert!(!valid_day_key("3-1"));
        // Malformed.
        for key in ["", "d", "d-", "d-1", "d1-", "d1-1x", "d1--1", "dd1-1", "D1-1", " d1-1", "d1-1 ", "d1_1", "d+1-1", "d1-+1", "d1-1-2"] {
            assert!(!valid_day_key(key), "{key:?}");
        }
        // Digits outside ASCII (Arabic-Indic and full width) are refused.
        assert!(!valid_day_key("d\u{0661}-1"));
        assert!(!valid_day_key("d1-\u{FF11}"));
    }

    #[test]
    fn a_stale_day_key_finds_nothing() {
        let mut links = service::Links { generation: 5, ..Default::default() };
        links.web_map.insert("d5-0".to_string(), ("work".to_string(), "https://outlook.office.com/calendar/item/example".to_string()));
        let links = Mutex::new(links);
        // Well formed, but from an older generation of the day view.
        assert!(valid_day_key("d4-0"));
        assert!(service::lookup_web_link(&links, "d4-0").is_none());
        assert!(service::lookup_web_link(&links, "d5-0").is_some());
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
        // 2026-11-12 17:00 UTC is 18:00 at UTC+1; local midnight was 2026-11-11 23:00 UTC,
        // and tomorrow ends 48 hours after it.
        assert_eq!(day_window(1_794_502_800, &|_| 3600), (1_794_438_000, 1_794_438_000 + 48 * 3600));
        assert_eq!(day_window(1_794_502_800, &|_| 0), (1_794_441_600, 1_794_441_600 + 48 * 3600));
    }

    #[test]
    fn day_window_covers_all_of_tomorrow_late_in_the_evening() {
        // 21:00 local at UTC+0: a 13:00 event tomorrow (40 hours after midnight) is inside.
        let (from, to) = day_window(1_794_441_600 + 21 * 3600, &|_| 0);
        assert_eq!(from, 1_794_441_600);
        assert!(from + 40 * 3600 < to);
        assert_eq!(to, from + 48 * 3600);
    }

    #[test]
    fn day_window_on_a_spring_forward_day() {
        // 14:00 local after the change; midnight was at UTC-5 (05:00 UTC). Today has 23 hours
        // and tomorrow 24, so the window is 47 elapsed hours.
        assert_eq!(day_window(1_772_992_800, &spring), (1_772_946_000, 1_772_946_000 + 47 * 3600));
    }

    #[test]
    fn day_window_on_a_fall_back_day() {
        // 15:00 local after the change; midnight was at UTC-4 (04:00 UTC). Today has 25 hours
        // and tomorrow 24, so the window is 49 elapsed hours.
        assert_eq!(day_window(1_793_563_200, &fall), (1_793_505_600, 1_793_505_600 + 49 * 3600));
    }

    #[test]
    fn day_window_the_evening_before_a_clock_change() {
        // 2026-03-07 20:00 local (UTC-5) is 2026-03-08 01:00 UTC. Today starts 2026-03-07 05:00
        // UTC (24 hours) and tomorrow, the spring-forward day, has 23: 47 hours in all.
        let (from, to) = day_window(1_772_931_600, &spring);
        assert_eq!(from, 1_772_859_600);
        assert_eq!(to, 1_772_859_600 + 47 * 3600);
        // The fall-back day as tomorrow: 2026-10-31 20:00 local (UTC-4) is 2026-11-01 00:00
        // UTC. Today starts 2026-10-31 04:00 UTC; tomorrow has 25 hours: 49 in all.
        let (from, to) = day_window(1_793_491_200, &fall);
        assert_eq!(from, 1_793_419_200);
        assert_eq!(to, 1_793_419_200 + 49 * 3600);
    }
}
