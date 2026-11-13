//! Wall 2 Home: the home app's desk routes (house line, rooms, security alerts, clear).
//!
//! The base address is `feeds.json` key `homeBaseUrl` (as `wall2_home_security` reads it).
//! The write token is `feeds.json` key `homeDeskToken`: it is read here only, sent only as
//! the `X-Desk-Token` header, and never returned to the web view, logged or put in an error.
//! Every answer is capped at 64 KB and checked field by field. Errors are fixed words:
//! `not-configured`, `absent` (the route is not there yet), `failed`, `not-set-up` (no
//! token), `nothing-to-clear` and `forbidden`. Old data is never an error: each answer
//! carries its own `stale` flag, and a missing flag counts as stale. Nothing here logs.

use crate::wall2_feeds::{read_base, NOT_CONFIGURED};
use serde::Serialize;
use serde_json::Value;
use std::io::Read;
use tauri::Manager;

const MAX_BODY: u64 = 64 * 1024;
const MAX_ROOMS: usize = 24;
const MAX_ROOM_NAME: usize = 40;
const MAX_ALERTS: usize = 50;
const MAX_ALERT_TEXT: usize = 120;
const MAX_TOKEN: usize = 256;

pub(crate) const ABSENT: &str = "absent";
pub(crate) const FAILED: &str = "failed";
pub(crate) const NO_TOKEN: &str = "not-set-up";
pub(crate) const NOTHING: &str = "nothing-to-clear";
pub(crate) const FORBIDDEN: &str = "forbidden";

/// The exact body the clear route accepts.
pub(crate) const CLEAR_BODY: &str = "{}";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct House {
    pub observed_at: Option<String>,
    pub inside_f: Option<i32>,
    pub lit_rooms: Option<u32>,
    pub rooms: Option<u32>,
    pub stale: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Room {
    pub id: String,
    pub name: String,
    pub on: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeskRooms {
    pub rooms: Vec<Room>,
    pub stale: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeskAlert {
    pub id: Option<String>,
    /// `high`, `medium` or `low`; None when the source names none we know.
    pub severity: Option<String>,
    pub text: String,
    pub at: Option<String>,
    pub age_seconds: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeskSecurity {
    pub available: bool,
    pub stale: bool,
    pub observed_at: Option<String>,
    pub devices: Option<u32>,
    pub blocked: Option<u32>,
    pub unseen: Option<u32>,
    pub alerts: Vec<DeskAlert>,
    /// True when a desk token is set on this PC, so Clear all can be offered. Only the
    /// fact; the token itself never leaves Rust.
    pub can_clear: bool,
}

// Section: transport seam (tests use a fake; nothing in tests reaches a real service)

/// One answer: the status code and at most `MAX_BODY` bytes of body.
pub(crate) struct Answer {
    pub code: u16,
    pub body: Vec<u8>,
}

pub(crate) trait DeskHttp {
    fn get(&self, url: &str) -> Result<Answer, ()>;
    fn post(&self, url: &str, headers: &[(&str, &str)], body: &str) -> Result<Answer, ()>;
}

struct RealHttp;

fn read_capped(resp: ureq::Response) -> Result<Vec<u8>, ()> {
    let mut buf = Vec::new();
    resp.into_reader().take(MAX_BODY + 1).read_to_end(&mut buf).map_err(|_| ())?;
    if buf.len() as u64 > MAX_BODY {
        return Err(());
    }
    Ok(buf)
}

fn finish(result: Result<ureq::Response, ureq::Error>) -> Result<Answer, ()> {
    match result {
        Ok(resp) => {
            let code = resp.status();
            Ok(Answer { code, body: read_capped(resp)? })
        }
        // Error bodies are not read: only the code matters, and nothing of them is shown.
        Err(ureq::Error::Status(code, _)) => Ok(Answer { code, body: Vec::new() }),
        Err(ureq::Error::Transport(_)) => Err(()),
    }
}

impl DeskHttp for RealHttp {
    fn get(&self, url: &str) -> Result<Answer, ()> {
        finish(crate::wall2_feeds::agent().get(url).set("Accept", "application/json").call())
    }
    fn post(&self, url: &str, headers: &[(&str, &str)], body: &str) -> Result<Answer, ()> {
        let mut req = crate::wall2_feeds::agent().post(url).set("Accept", "application/json");
        for (k, v) in headers {
            req = req.set(k, v);
        }
        finish(req.send_string(body))
    }
}

/// A read: 2xx with a JSON object whose `ok` is true. 404 is `absent`; anything else `failed`.
fn read_json(http: &dyn DeskHttp, url: &str) -> Result<Value, String> {
    let answer = http.get(url).map_err(|_| FAILED.to_string())?;
    if answer.code == 404 {
        return Err(ABSENT.to_string());
    }
    if !(200..300).contains(&answer.code) {
        return Err(FAILED.to_string());
    }
    let body: Value = serde_json::from_slice(&answer.body).map_err(|_| FAILED.to_string())?;
    if body.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(FAILED.to_string());
    }
    Ok(body)
}

// Section: field checks

/// Trimmed, control characters removed, spaces collapsed, at most `max` characters; None when empty.
fn clean_text(raw: Option<&Value>, max: usize) -> Option<String> {
    let s = raw?.as_str()?;
    let no_ctl: String = s.chars().filter(|c| !c.is_control()).collect();
    let joined = no_ctl.split_whitespace().collect::<Vec<_>>().join(" ");
    if joined.is_empty() {
        return None;
    }
    Some(joined.chars().take(max).collect())
}

/// An ISO time stamp kept as text when the shared parser reads it.
fn stamp(raw: Option<&Value>) -> Option<String> {
    let s = raw?.as_str()?.trim();
    if s.is_empty() || s.len() > 40 {
        return None;
    }
    crate::wall2_feeds::parse_iso(s).map(|_| s.to_string())
}

/// A whole number in `0..=max`.
fn count(raw: Option<&Value>, max: u64) -> Option<u32> {
    let n = raw?.as_u64()?;
    if n > max {
        return None;
    }
    u32::try_from(n).ok()
}

/// 1 to `max` characters from `A-Z a-z 0-9 _ - . :`.
fn safe_id(raw: Option<&Value>, max: usize) -> Option<String> {
    let s = raw?.as_str()?;
    let ok = !s.is_empty() && s.len() <= max && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | ':'));
    ok.then(|| s.to_string())
}

fn is_stale(body: &Value) -> bool {
    body.get("stale").and_then(Value::as_bool).unwrap_or(true)
}

// Section: shapes

pub(crate) fn shape_house(body: &Value) -> House {
    let rooms = count(body.get("rooms"), 64);
    let mut lit = count(body.get("lit_rooms"), 64);
    if let (Some(l), Some(r)) = (lit, rooms) {
        if l > r {
            lit = None;
        }
    }
    let inside = body
        .get("inside_temperature_f")
        .and_then(Value::as_f64)
        .filter(|f| f.is_finite() && (-40.0..=140.0).contains(f))
        .map(|f| f.round() as i32);
    House { observed_at: stamp(body.get("observed_at")), inside_f: inside, lit_rooms: lit, rooms, stale: is_stale(body) }
}

pub(crate) fn shape_rooms(body: &Value) -> DeskRooms {
    let rooms = body
        .get("rooms")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|r| {
                    Some(Room {
                        id: safe_id(r.get("id"), 16)?,
                        name: clean_text(r.get("name"), MAX_ROOM_NAME)?,
                        on: r.get("on")?.as_bool()?,
                    })
                })
                .take(MAX_ROOMS)
                .collect()
        })
        .unwrap_or_default();
    DeskRooms { rooms, stale: is_stale(body) }
}

/// The source's severity words as high, medium or low; None for anything else.
pub(crate) fn severity(raw: Option<&Value>) -> Option<String> {
    let s = raw?.as_str()?.trim().to_ascii_lowercase();
    let level = match s.as_str() {
        "critical" | "high" | "severe" | "urgent" | "alarm" | "error" => "high",
        "notable" | "medium" | "moderate" | "warning" | "warn" => "medium",
        "low" | "info" | "minor" | "notice" | "routine" => "low",
        _ => return None,
    };
    Some(level.to_string())
}

pub(crate) fn shape_security(body: &Value, can_clear: bool) -> DeskSecurity {
    let available = body.get("available").and_then(Value::as_bool).unwrap_or(false);
    let alerts = if available {
        body.get("alerts")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(|a| {
                        Some(DeskAlert {
                            id: safe_id(a.get("id"), 64),
                            severity: severity(a.get("severity")),
                            text: clean_text(a.get("text"), MAX_ALERT_TEXT)?,
                            at: stamp(a.get("at")),
                            age_seconds: a.get("age_seconds").and_then(Value::as_u64).filter(|s| *s <= 10 * 365 * 86_400),
                        })
                    })
                    .take(MAX_ALERTS)
                    .collect()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    DeskSecurity {
        available,
        // Without a summary the home app says stale itself; an unreadable flag counts as stale.
        stale: !available || is_stale(body),
        observed_at: stamp(body.get("observed_at")),
        devices: count(body.get("devices"), 100_000),
        blocked: count(body.get("blocked"), 100_000_000),
        unseen: count(body.get("unseen_alerts"), 100_000),
        alerts,
        can_clear,
    }
}

/// The `homeDeskToken` key of `feeds.json` text: 1 to 256 visible ASCII characters, else None.
pub(crate) fn token_from_config(json_text: Option<&str>) -> Option<String> {
    let value: Value = serde_json::from_str(json_text?).ok()?;
    let t = value.get("homeDeskToken")?.as_str()?.trim();
    let ok = !t.is_empty() && t.len() <= MAX_TOKEN && t.chars().all(|c| c.is_ascii_graphic());
    ok.then(|| t.to_string())
}

fn read_token(app: &tauri::AppHandle) -> Option<String> {
    let dir = app.path().app_config_dir().ok()?;
    let text = std::fs::read_to_string(dir.join("feeds.json")).ok();
    token_from_config(text.as_deref())
}

/// The clear call: body exactly `{}`, JSON content type, the token header. The token is
/// only ever a header value; every error is one of the fixed words.
pub(crate) fn clear_with(http: &dyn DeskHttp, base: &str, token: Option<&str>) -> Result<u32, String> {
    let Some(token) = token else {
        return Err(NO_TOKEN.to_string());
    };
    let url = format!("{base}/api/desk/security/alerts/clear");
    let headers = [("Content-Type", "application/json"), ("X-Desk-Token", token)];
    let answer = http.post(&url, &headers, CLEAR_BODY).map_err(|_| FAILED.to_string())?;
    match answer.code {
        200..=299 => {
            let body: Value = serde_json::from_slice(&answer.body).map_err(|_| FAILED.to_string())?;
            if body.get("ok").and_then(Value::as_bool) != Some(true) {
                return Err(FAILED.to_string());
            }
            Ok(count(body.get("cleared"), 100_000).unwrap_or(0))
        }
        409 => Err(NOTHING.to_string()),
        403 => Err(FORBIDDEN.to_string()),
        404 => Err(ABSENT.to_string()),
        // The home app answers 503 while its own desk token is not set.
        503 => Err(NO_TOKEN.to_string()),
        _ => Err(FAILED.to_string()),
    }
}

// Section: commands (wall2 window only; blocking work off the main thread)

fn base(app: &tauri::AppHandle) -> Result<String, String> {
    read_base(app, "homeBaseUrl", false).map_err(|e| if e == NOT_CONFIGURED { NOT_CONFIGURED.to_string() } else { FAILED.to_string() })
}

async fn off_thread<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|_| FAILED.to_string())?
}

#[tauri::command]
pub async fn wall2_desk_house(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<House, String> {
    crate::wall2_meet::require_wall2(window.label())?;
    let base = base(&app)?;
    off_thread(move || Ok(shape_house(&read_json(&RealHttp, &format!("{base}/api/desk/house"))?))).await
}

#[tauri::command]
pub async fn wall2_desk_rooms(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<DeskRooms, String> {
    crate::wall2_meet::require_wall2(window.label())?;
    let base = base(&app)?;
    off_thread(move || Ok(shape_rooms(&read_json(&RealHttp, &format!("{base}/api/desk/rooms"))?))).await
}

#[tauri::command]
pub async fn wall2_desk_security(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<DeskSecurity, String> {
    crate::wall2_meet::require_wall2(window.label())?;
    let base = base(&app)?;
    let can_clear = read_token(&app).is_some();
    off_thread(move || Ok(shape_security(&read_json(&RealHttp, &format!("{base}/api/desk/security"))?, can_clear))).await
}

#[tauri::command]
pub async fn wall2_desk_clear_alerts(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<u32, String> {
    crate::wall2_meet::require_wall2(window.label())?;
    let base = base(&app)?;
    let token = read_token(&app);
    off_thread(move || clear_with(&RealHttp, &base, token.as_deref())).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::RefCell;

    #[derive(Default)]
    struct Fake {
        code: u16,
        body: String,
        transport_down: bool,
        seen: RefCell<Vec<(String, Vec<(String, String)>, String)>>,
    }

    impl DeskHttp for Fake {
        fn get(&self, url: &str) -> Result<Answer, ()> {
            self.seen.borrow_mut().push((url.to_string(), Vec::new(), String::new()));
            if self.transport_down {
                return Err(());
            }
            Ok(Answer { code: self.code, body: self.body.clone().into_bytes() })
        }
        fn post(&self, url: &str, headers: &[(&str, &str)], body: &str) -> Result<Answer, ()> {
            let h = headers.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
            self.seen.borrow_mut().push((url.to_string(), h, body.to_string()));
            if self.transport_down {
                return Err(());
            }
            Ok(Answer { code: self.code, body: self.body.clone().into_bytes() })
        }
    }

    fn fake(code: u16, body: &str) -> Fake {
        Fake { code, body: body.to_string(), ..Fake::default() }
    }

    const TOKEN: &str = "s3cr3t-desk-token-value";

    #[test]
    fn house_shape() {
        let h = shape_house(&json!({"ok": true, "observed_at": "2026-11-12T19:58:00.000Z", "inside_temperature_f": 68, "lit_rooms": 2, "rooms": 4, "stale": false}));
        assert_eq!(h, House { observed_at: Some("2026-11-12T19:58:00.000Z".into()), inside_f: Some(68), lit_rooms: Some(2), rooms: Some(4), stale: false });
        // Temperature outside -40..140, or not a number, is None; 67.6 rounds.
        assert_eq!(shape_house(&json!({"inside_temperature_f": 141})).inside_f, None);
        assert_eq!(shape_house(&json!({"inside_temperature_f": -41})).inside_f, None);
        assert_eq!(shape_house(&json!({"inside_temperature_f": "68"})).inside_f, None);
        assert_eq!(shape_house(&json!({"inside_temperature_f": 67.6})).inside_f, Some(68));
        assert_eq!(shape_house(&json!({"inside_temperature_f": null})).inside_f, None);
        // More lit rooms than rooms is not believed.
        assert_eq!(shape_house(&json!({"lit_rooms": 5, "rooms": 4})).lit_rooms, None);
        assert_eq!(shape_house(&json!({"lit_rooms": -1})).lit_rooms, None);
        // A missing stale flag counts as stale; a bad time stamp is dropped.
        let h = shape_house(&json!({"observed_at": "yesterday"}));
        assert!(h.stale);
        assert_eq!(h.observed_at, None);
    }

    #[test]
    fn rooms_shape() {
        let r = shape_rooms(&json!({"ok": true, "stale": false, "rooms": [
            {"id": "1", "name": "Office", "on": true, "brightness": 50},
            {"id": "bad id", "name": "Den", "on": true},
            {"id": "2", "name": "  Den\u{7}  room ", "on": false},
            {"id": "3", "name": "Kitchen"},
            {"id": "4", "name": "", "on": true},
            {"id": "x".repeat(17), "name": "Long", "on": true},
            {"id": "5", "name": "n".repeat(60), "on": false}
        ]}));
        assert!(!r.stale);
        let ids: Vec<&str> = r.rooms.iter().map(|x| x.id.as_str()).collect();
        assert_eq!(ids, vec!["1", "2", "5"]);
        assert_eq!(r.rooms[1].name, "Den room");
        assert_eq!(r.rooms[2].name.chars().count(), 40);
        let many: Vec<Value> = (0..40).map(|i| json!({"id": format!("r{i}"), "name": "Room", "on": false})).collect();
        assert_eq!(shape_rooms(&json!({"rooms": many, "stale": false})).rooms.len(), 24);
        assert!(shape_rooms(&json!({"rooms": "no"})).rooms.is_empty());
        assert!(shape_rooms(&json!({})).stale);
    }

    #[test]
    fn security_shape_and_severity_words() {
        let s = shape_security(
            &json!({"ok": true, "available": true, "stale": false, "observed_at": "2026-11-12T19:00:00Z", "devices": 27, "blocked": 1, "unseen_alerts": 1,
                "alerts": [
                    {"id": "alert:0123456789abcdef", "severity": "notable", "text": "New device", "at": "2026-11-12T19:30:00Z", "age_seconds": 1800},
                    {"severity": "critical", "text": "  Two\nlines  "},
                    {"id": "bad id!", "severity": "odd", "text": "Kept without id"},
                    {"severity": "low"}
                ]}),
            true,
        );
        assert!(s.available && !s.stale && s.can_clear);
        assert_eq!((s.devices, s.blocked, s.unseen), (Some(27), Some(1), Some(1)));
        assert_eq!(s.alerts.len(), 3);
        assert_eq!(s.alerts[0].id.as_deref(), Some("alert:0123456789abcdef"));
        assert_eq!(s.alerts[0].severity.as_deref(), Some("medium"));
        assert_eq!(s.alerts[0].age_seconds, Some(1800));
        assert_eq!(s.alerts[1].severity.as_deref(), Some("high"));
        assert_eq!(s.alerts[1].text, "Two lines");
        assert_eq!(s.alerts[2].id, None);
        assert_eq!(s.alerts[2].severity, None);
        assert_eq!(severity(Some(&json!("Warning"))).as_deref(), Some("medium"));
        assert_eq!(severity(Some(&json!("info"))).as_deref(), Some("low"));
        assert_eq!(severity(Some(&json!(3))), None);
        let long = "t".repeat(300);
        assert_eq!(shape_security(&json!({"available": true, "stale": false, "alerts": [{"text": long}]}), false).alerts[0].text.chars().count(), 120);
        let many: Vec<Value> = (0..80).map(|i| json!({"text": format!("a{i}")})).collect();
        assert_eq!(shape_security(&json!({"available": true, "stale": false, "alerts": many}), false).alerts.len(), 50);
    }

    #[test]
    fn security_without_a_summary_is_stale_and_empty() {
        let s = shape_security(&json!({"ok": true, "available": false, "stale": true, "devices": null, "alerts": [{"text": "x"}], "unseen_alerts": null}), true);
        assert!(!s.available && s.stale);
        assert!(s.alerts.is_empty());
        assert_eq!((s.devices, s.unseen), (None, None));
        // A missing available flag is not available.
        assert!(!shape_security(&json!({"stale": false}), false).available);
    }

    #[test]
    fn reads_map_codes_to_fixed_words() {
        assert_eq!(read_json(&fake(404, ""), "http://h/api/desk/house").unwrap_err(), ABSENT);
        assert_eq!(read_json(&fake(503, "{\"ok\":false}"), "u").unwrap_err(), FAILED);
        assert_eq!(read_json(&fake(200, "not json"), "u").unwrap_err(), FAILED);
        assert_eq!(read_json(&fake(200, "{\"ok\":false}"), "u").unwrap_err(), FAILED);
        assert_eq!(read_json(&Fake { transport_down: true, ..Fake::default() }, "u").unwrap_err(), FAILED);
        assert!(read_json(&fake(200, "{\"ok\":true}"), "u").is_ok());
        // Redirects are not followed and are not success.
        assert_eq!(read_json(&fake(302, ""), "u").unwrap_err(), FAILED);
    }

    #[test]
    fn clear_sends_exactly_the_empty_object_with_both_headers() {
        let f = fake(200, "{\"ok\":true,\"cleared\":3,\"seen_alert_ids\":3}");
        assert_eq!(clear_with(&f, "http://home.test", Some(TOKEN)), Ok(3));
        let seen = f.seen.borrow();
        assert_eq!(seen.len(), 1);
        let (url, headers, body) = &seen[0];
        assert_eq!(url, "http://home.test/api/desk/security/alerts/clear");
        assert_eq!(body, "{}");
        assert!(headers.contains(&("Content-Type".to_string(), "application/json".to_string())));
        assert!(headers.contains(&("X-Desk-Token".to_string(), TOKEN.to_string())));
    }

    #[test]
    fn clear_errors_are_fixed_words_and_never_carry_the_token() {
        let cases = [(409, NOTHING), (403, FORBIDDEN), (404, ABSENT), (503, NO_TOKEN), (500, FAILED), (415, FAILED), (400, FAILED)];
        for (code, word) in cases {
            let err = clear_with(&fake(code, TOKEN), "http://home.test", Some(TOKEN)).unwrap_err();
            assert_eq!(err, word);
            assert!(!err.contains(TOKEN));
        }
        let down = Fake { transport_down: true, ..Fake::default() };
        let err = clear_with(&down, "http://home.test", Some(TOKEN)).unwrap_err();
        assert_eq!(err, FAILED);
        assert!(!err.contains(TOKEN));
        // A 200 that is not the success shape is a failure, not a count.
        assert_eq!(clear_with(&fake(200, TOKEN), "http://h", Some(TOKEN)).unwrap_err(), FAILED);
        assert_eq!(clear_with(&fake(200, "{\"ok\":true}"), "http://h", Some(TOKEN)), Ok(0));
    }

    #[test]
    fn clear_without_a_token_never_calls_out() {
        let f = fake(200, "{\"ok\":true,\"cleared\":1}");
        assert_eq!(clear_with(&f, "http://h", None).unwrap_err(), NO_TOKEN);
        assert!(f.seen.borrow().is_empty());
    }

    #[test]
    fn token_from_config_rules() {
        assert_eq!(token_from_config(Some(&format!("{{\"homeDeskToken\": \" {TOKEN} \"}}"))).as_deref(), Some(TOKEN));
        assert_eq!(token_from_config(Some("{\"homeDeskToken\": \"\"}")), None);
        assert_eq!(token_from_config(Some("{\"homeDeskToken\": \"two words\"}")), None);
        assert_eq!(token_from_config(Some("{\"homeDeskToken\": \"caf\u{e9}\"}")), None);
        assert_eq!(token_from_config(Some(&format!("{{\"homeDeskToken\": \"{}\"}}", "a".repeat(257)))), None);
        assert_eq!(token_from_config(Some("{\"homeDeskToken\": 5}")), None);
        assert_eq!(token_from_config(Some("not json")), None);
        assert_eq!(token_from_config(None), None);
    }
}
