//! Graph calendar read: UTC time helpers, response shaping, the join-link allowlist.

use super::reason::{clean_code, graph_reason, GRAPH_BODY, GRAPH_NETWORK, GRAPH_TIMEOUT, MAX_ERROR_BODY};
use super::{MAX_BODY, MAX_TITLE_CHARS};
use serde_json::Value;
use std::time::{Duration, Instant};

pub const MAX_MEETINGS: usize = 8;
/// The day view keeps up to this many events.
pub const MAX_DAY_EVENTS: usize = 40;

/// One meeting as read from one account. `join` stays in Rust.
#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    pub ical: Option<String>,
    pub title: String,
    pub start: String,
    pub end: String,
    pub account_id: String,
    pub join: Option<String>,
}

pub enum GraphReply {
    Ok(Value),
    Unauthorized,
    /// Throttling, a server error or no connection: the reason code says which.
    Transient(String),
    /// Any other refusal or an unreadable reply, with its reason code.
    Failed(String),
}

/// Which read a Graph call belongs to, for the log line.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Kind {
    Next,
    Day,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Next => "next",
            Kind::Day => "day",
        }
    }
}

/// One read's clock: when it began and how long all of it (token and Graph, retries
/// included) may take.
#[derive(Debug, Clone, Copy)]
pub struct Ctx {
    pub kind: Kind,
    pub began: Instant,
    pub budget: Duration,
}

/// What a Graph failure leaves in the log. Ids and codes only; never a subject, an attendee,
/// an address, a token or a query value.
#[derive(Debug, Clone, PartialEq)]
pub struct Diag {
    pub kind: Kind,
    /// 0 when no reply arrived.
    pub status: u16,
    pub code: Option<String>,
    pub inner: Option<String>,
    pub request_id: Option<String>,
    pub client_request_id: Option<String>,
    pub attempt: u32,
    pub elapsed_ms: u64,
}

/// `[A-Za-z0-9-]{1,64}`, else none: a request id is a GUID, anything else is not logged.
fn clean_id(s: &Option<String>) -> String {
    match s {
        Some(v) if (1..=64).contains(&v.len()) && v.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') => v.clone(),
        _ => "none".to_string(),
    }
}

impl Diag {
    /// The extra fields for the log line, fixed order, no spaces inside a value.
    pub fn log_fields(&self) -> String {
        let status = if self.status == 0 { "network".to_string() } else { self.status.to_string() };
        let code = |c: &Option<String>| match c.as_deref().and_then(clean_code) {
            Some(c) => c.to_string(),
            None => "none".to_string(),
        };
        format!(
            "req={} status={} code={} inner={} request-id={} client-request-id={} attempt={} ms={}",
            self.kind.as_str(),
            status,
            code(&self.code),
            code(&self.inner),
            clean_id(&self.request_id),
            clean_id(&self.client_request_id),
            self.attempt,
            self.elapsed_ms
        )
    }
}

/// One HTTP attempt as the transport saw it. `status` 0 means no reply at all.
pub struct Raw {
    pub status: u16,
    pub retry_after: Option<u64>,
    pub request_id: Option<String>,
    pub client_request_id: Option<String>,
    pub body: Vec<u8>,
}

pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
pub const READ_TIMEOUT: Duration = Duration::from_secs(10);
/// All of one read (token request, Graph request and retries) stays inside this.
pub const BUDGET: Duration = Duration::from_secs(12);
pub const MAX_ATTEMPTS: u32 = 3;
const MAX_RETRY_AFTER_SECS: u64 = 5;

pub fn is_retryable(status: u16) -> bool {
    matches!(status, 429 | 503 | 504)
}

fn backoff(attempt: u32) -> Duration {
    Duration::from_millis(500 * attempt as u64)
}

fn diag_of(ctx: &Ctx, raw: &Raw, attempt: u32) -> Diag {
    let json: Option<Value> = if raw.body.len() as u64 <= MAX_ERROR_BODY { serde_json::from_slice(&raw.body).ok() } else { None };
    let text = |path: &[&str]| json.as_ref().and_then(|j| str_at(j, path)).map(str::to_string);
    Diag {
        kind: ctx.kind,
        status: raw.status,
        code: text(&["error", "code"]),
        inner: text(&["error", "innerError", "code"]),
        request_id: raw.request_id.clone(),
        client_request_id: raw.client_request_id.clone(),
        attempt,
        elapsed_ms: ctx.began.elapsed().as_millis() as u64,
    }
}

/// The retry policy, with the network and the clock passed in. A 429, 503 or 504 is tried
/// again (up to three attempts in all) after a short wait, `Retry-After` honoured up to five
/// seconds, and only while the wait fits in the read's budget. Nothing else is retried.
/// A 401 is the caller's to handle (refresh the token, ask again).
pub fn run_attempts(
    ctx: &Ctx,
    send: &mut dyn FnMut(u32, Duration) -> Raw,
    sleep: &mut dyn FnMut(Duration),
) -> (GraphReply, Option<Diag>) {
    let mut attempt = 0u32;
    loop {
        attempt += 1;
        let elapsed = ctx.began.elapsed();
        if elapsed >= ctx.budget {
            return (GraphReply::Transient(GRAPH_TIMEOUT.to_string()), None);
        }
        let raw = send(attempt, (ctx.budget - elapsed).min(READ_TIMEOUT));
        let status = raw.status;
        match status {
            200..=299 => {
                return match serde_json::from_slice::<Value>(&raw.body) {
                    Ok(v) if raw.body.len() as u64 <= MAX_BODY => (GraphReply::Ok(v), None),
                    _ => (GraphReply::Failed(GRAPH_BODY.to_string()), Some(diag_of(ctx, &raw, attempt))),
                };
            }
            401 => return (GraphReply::Unauthorized, None),
            0 => return (GraphReply::Transient(GRAPH_NETWORK.to_string()), Some(diag_of(ctx, &raw, attempt))),
            s if is_retryable(s) => {
                if attempt < MAX_ATTEMPTS {
                    let wait = raw.retry_after.map(|n| Duration::from_secs(n.min(MAX_RETRY_AFTER_SECS))).unwrap_or_else(|| backoff(attempt));
                    if ctx.began.elapsed() + wait < ctx.budget {
                        sleep(wait);
                        continue;
                    }
                }
                let why = graph_reason(s, &raw.body);
                return (GraphReply::Transient(why), Some(diag_of(ctx, &raw, attempt)));
            }
            s => {
                let why = graph_reason(s, &raw.body);
                let reply = if s >= 500 { GraphReply::Transient(why) } else { GraphReply::Failed(why) };
                return (reply, Some(diag_of(ctx, &raw, attempt)));
            }
        }
    }
}

pub const SELECT: &str = "subject,start,end,isAllDay,isCancelled,responseStatus,onlineMeeting,onlineMeetingUrl,iCalUId";
pub const TOP: u32 = 50;
pub const CALENDAR_VIEW_PATH: &str = "https://graph.microsoft.com/v1.0/me/calendarView";
pub const PREFER: &str = "outlook.timezone=\"UTC\"";

/// The calendarView request: the documented options only (`startDateTime`, `endDateTime`,
/// `$select`, `$orderby` on the start time, `$top`), both date-times in UTC with a `Z`.
pub fn calendar_view_url(start: &str, end: &str) -> String {
    format!(
        "{CALENDAR_VIEW_PATH}?startDateTime={}&endDateTime={}&$select={SELECT}&$orderby=start/dateTime&$top={TOP}",
        urlencoding::encode(start),
        urlencoding::encode(end),
    )
}

pub trait GraphClient {
    fn calendar_view(&self, access: &str, start: &str, end: &str) -> GraphReply;

    /// The same read with the budget and the failure details. The default ignores both;
    /// the real client uses them.
    fn calendar_view_diag(&self, access: &str, start: &str, end: &str, _ctx: &Ctx) -> (GraphReply, Option<Diag>) {
        (self.calendar_view(access, start, end), None)
    }
}

// Section: time

pub fn civil_from_days(z: i64) -> (i64, i64, i64) {
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

/// Seconds since the Unix epoch as `2026-11-12T17:00:00Z`.
pub fn utc_iso(secs: u64) -> String {
    let secs = secs as i64;
    let (y, m, d) = civil_from_days(secs.div_euclid(86_400));
    let rem = secs.rem_euclid(86_400);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, (rem % 3600) / 60, rem % 60)
}

/// Graph sends `2026-11-12T17:00:00.0000000` (UTC when asked with the Prefer header).
/// Returns `2026-11-12T17:00:00Z`, or None when the text is not that shape.
pub fn normalize_graph_time(raw: &str) -> Option<String> {
    let head = raw.get(..19)?;
    let ok = head.char_indices().all(|(i, c)| match i {
        4 | 7 => c == '-',
        10 => c == 'T',
        13 | 16 => c == ':',
        _ => c.is_ascii_digit(),
    });
    if !ok {
        return None;
    }
    let tail = &raw[19..];
    let tail_ok = match tail.strip_suffix('Z').unwrap_or(tail) {
        "" => true,
        frac => frac.strip_prefix('.').map(|f| !f.is_empty() && f.chars().all(|c| c.is_ascii_digit())).unwrap_or(false),
    };
    if !tail_ok {
        return None;
    }
    Some(format!("{head}Z"))
}

// Section: join allowlist

/// Only a Teams meeting link on a fixed host and path shape may get a Join button.
pub fn join_allowed(raw: &str) -> bool {
    if raw.len() > 2048 || raw.chars().any(|c| c == '\\' || c.is_whitespace() || c.is_control()) {
        return false;
    }
    let Ok(url) = tauri::Url::parse(raw) else {
        return false;
    };
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    if !matches!(url.port(), None | Some(443)) {
        return false;
    }
    let host_ok = matches!(url.host_str().map(str::to_ascii_lowercase).as_deref(), Some("teams.microsoft.com") | Some("teams.live.com"));
    host_ok && (url.path().starts_with("/l/meetup-join/") || url.path().starts_with("/meet/"))
}

// Section: shaping

fn cap_title(raw: &str) -> String {
    let t: String = raw.trim().chars().take(MAX_TITLE_CHARS).collect();
    let t = t.trim().to_string();
    if t.is_empty() {
        "Untitled".to_string()
    } else {
        t
    }
}

fn str_at<'a>(v: &'a Value, path: &[&str]) -> Option<&'a str> {
    let mut cur = v;
    for key in path {
        cur = cur.get(*key)?;
    }
    cur.as_str()
}

/// Events of one account: not cancelled, not declined, not all-day, with a valid start and end.
pub fn shape_events(body: &Value, account_id: &str) -> Vec<Candidate> {
    let Some(rows) = body.get("value").and_then(Value::as_array) else {
        return Vec::new();
    };
    rows.iter()
        .filter(|e| e.get("isCancelled").and_then(Value::as_bool) != Some(true))
        .filter(|e| e.get("isAllDay").and_then(Value::as_bool) != Some(true))
        .filter(|e| str_at(e, &["responseStatus", "response"]) != Some("declined"))
        .filter_map(|e| {
            let start = normalize_graph_time(str_at(e, &["start", "dateTime"])?)?;
            let end = normalize_graph_time(str_at(e, &["end", "dateTime"])?)?;
            let join = [str_at(e, &["onlineMeeting", "joinUrl"]), str_at(e, &["onlineMeetingUrl"])]
                .into_iter()
                .flatten()
                .find(|u| join_allowed(u))
                .map(str::to_string);
            Some(Candidate {
                ical: e.get("iCalUId").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string),
                title: cap_title(e.get("subject").and_then(Value::as_str).unwrap_or("")),
                start,
                end,
                account_id: account_id.to_string(),
                join,
            })
        })
        .collect()
}

/// Both accounts together, sorted by start, first eight. The same invite seen on two
/// accounts shows once, but only when `iCalUId`, start, end and join link all match: a copied
/// UID alone must not hide a different meeting or take its Join button.
pub fn merge(per_account: Vec<Vec<Candidate>>) -> Vec<Candidate> {
    merge_capped(per_account, MAX_MEETINGS)
}

/// `merge` with a chosen cap on how many come back.
pub fn merge_capped(per_account: Vec<Vec<Candidate>>, cap: usize) -> Vec<Candidate> {
    let mut all: Vec<Candidate> = Vec::new();
    for list in per_account {
        let earlier = all.len();
        for c in list {
            let same_invite_elsewhere = c.ical.is_some()
                && all[..earlier].iter().any(|e| {
                    e.account_id != c.account_id && e.ical == c.ical && e.start == c.start && e.end == c.end && e.join == c.join
                });
            if !same_invite_elsewhere {
                all.push(c);
            }
        }
    }
    all.sort_by(|a, b| a.start.cmp(&b.start));
    all.truncate(cap);
    all
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capped_merge_keeps_more_and_still_dedupes() {
        let one = |n: u32, acct: &str| Candidate {
            ical: Some(format!("u{n}")),
            title: "T".into(),
            start: format!("2026-11-12T{:02}:00:00Z", n),
            end: format!("2026-11-12T{:02}:30:00Z", n),
            account_id: acct.into(),
            join: None,
        };
        let a: Vec<_> = (0..12).map(|n| one(n, "a")).collect();
        let b: Vec<_> = (0..12).map(|n| one(n, "b")).collect();
        assert_eq!(merge_capped(vec![a.clone(), b.clone()], MAX_DAY_EVENTS).len(), 12);
        assert_eq!(merge_capped(vec![a, b], 5).len(), 5);
    }
    use serde_json::json;

    fn ctx_ms(budget_ms: u64) -> Ctx {
        Ctx { kind: Kind::Next, began: Instant::now(), budget: Duration::from_millis(budget_ms) }
    }

    fn raw(status: u16, retry_after: Option<u64>, body: &str) -> Raw {
        Raw { status, retry_after, request_id: Some("11111111-2222-3333-4444-555555555555".into()), client_request_id: Some("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee".into()), body: body.as_bytes().to_vec() }
    }

    /// Runs the policy over a script of replies; returns the outcome, how many calls were
    /// made and the waits it asked for (none are really slept).
    fn run(script: Vec<Raw>, budget_ms: u64) -> (GraphReply, Option<Diag>, u32, Vec<Duration>) {
        let ctx = ctx_ms(budget_ms);
        let mut queue = script.into_iter();
        let mut calls = 0u32;
        let mut sleeps: Vec<Duration> = Vec::new();
        let (reply, diag) = run_attempts(
            &ctx,
            &mut |_attempt, _timeout| {
                calls += 1;
                queue.next().expect("more calls than scripted")
            },
            &mut |d| sleeps.push(d),
        );
        (reply, diag, calls, sleeps)
    }

    const UNKNOWN: &str = r#"{"error":{"code":"UnknownError","message":"secret subject here","innerError":{"code":"InnerThing","request-id":"x"}}}"#;

    #[test]
    fn a_503_is_tried_twice_more_then_succeeds() {
        let (reply, diag, calls, sleeps) = run(vec![raw(503, None, UNKNOWN), raw(503, None, UNKNOWN), raw(200, None, r#"{"value":[]}"#)], 12_000);
        assert!(matches!(reply, GraphReply::Ok(_)));
        assert!(diag.is_none());
        assert_eq!(calls, 3);
        assert_eq!(sleeps.len(), 2);
    }

    #[test]
    fn three_failures_give_up_with_the_last_attempt_in_the_details() {
        let (reply, diag, calls, _) = run(vec![raw(503, None, UNKNOWN), raw(504, None, ""), raw(503, None, UNKNOWN)], 12_000);
        assert_eq!(calls, 3);
        assert!(matches!(reply, GraphReply::Transient(ref w) if w == "graph-503-UnknownError"));
        let d = diag.unwrap();
        assert_eq!((d.status, d.attempt, d.kind), (503, 3, Kind::Next));
        assert_eq!(d.code.as_deref(), Some("UnknownError"));
        assert_eq!(d.inner.as_deref(), Some("InnerThing"));
    }

    #[test]
    fn retry_after_is_honoured_up_to_five_seconds() {
        let (_, _, _, sleeps) = run(vec![raw(429, Some(2), ""), raw(429, Some(30), ""), raw(200, None, "{}")], 12_000);
        assert_eq!(sleeps, vec![Duration::from_secs(2), Duration::from_secs(5)]);
    }

    #[test]
    fn a_wait_that_does_not_fit_in_the_budget_is_not_taken() {
        let (reply, _, calls, sleeps) = run(vec![raw(503, Some(5), UNKNOWN)], 1_000);
        assert_eq!(calls, 1);
        assert!(sleeps.is_empty());
        assert!(matches!(reply, GraphReply::Transient(_)));
    }

    #[test]
    fn a_spent_budget_makes_no_call() {
        let (reply, diag, calls, _) = run(vec![], 0);
        assert_eq!(calls, 0);
        assert!(diag.is_none());
        assert!(matches!(reply, GraphReply::Transient(ref w) if w == "graph-timeout"));
    }

    #[test]
    fn nothing_else_is_retried() {
        for status in [0u16, 400, 403, 404, 500, 502] {
            let (_, diag, calls, sleeps) = run(vec![raw(status, None, "")], 12_000);
            assert_eq!(calls, 1, "status {status}");
            assert!(sleeps.is_empty());
            assert_eq!(diag.unwrap().status, status);
        }
        let (reply, _, calls, _) = run(vec![raw(401, None, "")], 12_000);
        assert_eq!(calls, 1);
        assert!(matches!(reply, GraphReply::Unauthorized));
    }

    #[test]
    fn a_network_failure_is_transient_and_a_4xx_is_not() {
        assert!(matches!(run(vec![raw(0, None, "")], 12_000).0, GraphReply::Transient(ref w) if w == "graph-network"));
        assert!(matches!(run(vec![raw(403, None, UNKNOWN)], 12_000).0, GraphReply::Failed(_)));
        assert!(matches!(run(vec![raw(502, None, "")], 12_000).0, GraphReply::Transient(_)));
    }

    #[test]
    fn log_fields_hold_the_listed_values_and_nothing_else() {
        let (_, diag, _, _) = run(vec![raw(503, None, UNKNOWN), raw(503, None, UNKNOWN), raw(503, None, UNKNOWN)], 12_000);
        let mut d = diag.unwrap();
        d.elapsed_ms = 4210;
        assert_eq!(
            d.log_fields(),
            "req=next status=503 code=UnknownError inner=InnerThing request-id=11111111-2222-3333-4444-555555555555 client-request-id=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee attempt=3 ms=4210"
        );
        assert!(!d.log_fields().contains("secret"));
    }

    #[test]
    fn hostile_ids_and_codes_are_not_logged() {
        let d = Diag {
            kind: Kind::Day,
            status: 0,
            code: Some("a@b.example".into()),
            inner: Some("x y".into()),
            request_id: Some("https://example.test/?q=1".into()),
            client_request_id: None,
            attempt: 1,
            elapsed_ms: 5,
        };
        assert_eq!(d.log_fields(), "req=day status=network code=none inner=none request-id=none client-request-id=none attempt=1 ms=5");
    }

    #[test]
    fn the_request_uses_only_documented_options_and_utc_times() {
        let url = calendar_view_url("2026-11-12T17:00:00Z", "2026-11-13T17:00:00Z");
        assert_eq!(
            url,
            "https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=2026-11-12T17%3A00%3A00Z&endDateTime=2026-11-13T17%3A00%3A00Z&$select=subject,start,end,isAllDay,isCancelled,responseStatus,onlineMeeting,onlineMeetingUrl,iCalUId&$orderby=start/dateTime&$top=50"
        );
        let names: Vec<&str> = url.split_once('?').unwrap().1.split('&').map(|p| p.split('=').next().unwrap()).collect();
        assert_eq!(names, ["startDateTime", "endDateTime", "$select", "$orderby", "$top"]);
        assert!(!url.contains("$filter"));
        assert_eq!(PREFER, "outlook.timezone=\"UTC\"");
    }

    #[test]
    fn utc_formatter_known_dates() {
        assert_eq!(utc_iso(0), "1970-01-01T00:00:00Z");
        assert_eq!(utc_iso(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(utc_iso(1_709_164_800 + 86_399), "2024-02-29T23:59:59Z");
        assert_eq!(utc_iso(1_798_761_599), "2026-12-31T23:59:59Z");
        assert_eq!(utc_iso(1_798_761_600), "2027-01-01T00:00:00Z");
        assert_eq!(utc_iso(1_794_459_600), "2026-11-12T05:00:00Z");
    }

    #[test]
    fn graph_time_is_normalized() {
        assert_eq!(normalize_graph_time("2026-11-12T17:00:00.0000000").as_deref(), Some("2026-11-12T17:00:00Z"));
        assert_eq!(normalize_graph_time("2026-11-12T17:00:00").as_deref(), Some("2026-11-12T17:00:00Z"));
        assert_eq!(normalize_graph_time("2026-11-12T17:00:00Z").as_deref(), Some("2026-11-12T17:00:00Z"));
        assert!(normalize_graph_time("2026-11-12").is_none());
        assert!(normalize_graph_time("2026-11-12T17:00:00+02:00").is_none());
        assert!(normalize_graph_time("nonsense text here!!").is_none());
    }

    fn event(subject: &str, start: &str, ical: &str) -> Value {
        json!({
            "subject": subject,
            "start": { "dateTime": start, "timeZone": "UTC" },
            "end": { "dateTime": "2026-11-12T23:00:00.0000000", "timeZone": "UTC" },
            "isAllDay": false,
            "isCancelled": false,
            "responseStatus": { "response": "accepted" },
            "iCalUId": ical,
        })
    }

    #[test]
    fn shaping_drops_cancelled_declined_and_all_day() {
        let mut cancelled = event("c", "2026-11-12T17:00:00.0000000", "1");
        cancelled["isCancelled"] = json!(true);
        let mut declined = event("d", "2026-11-12T17:00:00.0000000", "2");
        declined["responseStatus"] = json!({ "response": "declined" });
        let mut all_day = event("a", "2026-11-12T00:00:00.0000000", "3");
        all_day["isAllDay"] = json!(true);
        let keep = event("k", "2026-11-12T18:00:00.0000000", "4");
        let out = shape_events(&json!({ "value": [cancelled, declined, all_day, keep] }), "work");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].title, "k");
        assert_eq!(out[0].start, "2026-11-12T18:00:00Z");
        assert_eq!(out[0].account_id, "work");
    }

    #[test]
    fn titles_are_trimmed_capped_and_defaulted() {
        let long = "x".repeat(300);
        let out = shape_events(
            &json!({ "value": [
                event(&long, "2026-11-12T17:00:00.0000000", "1"),
                event("   ", "2026-11-12T17:00:00.0000000", "2"),
                event("  Standup  ", "2026-11-12T17:00:00.0000000", "3"),
            ] }),
            "work",
        );
        assert_eq!(out[0].title.chars().count(), 200);
        assert_eq!(out[1].title, "Untitled");
        assert_eq!(out[2].title, "Standup");
    }

    fn cand(ical: Option<&str>, start: &str, account: &str) -> Candidate {
        Candidate {
            ical: ical.map(str::to_string),
            title: "t".into(),
            start: start.into(),
            end: "2026-11-12T23:00:00Z".into(),
            account_id: account.into(),
            join: None,
        }
    }

    #[test]
    fn merge_dedupes_sorts_and_caps() {
        let a = vec![cand(Some("same"), "2026-11-12T18:00:00Z", "work"), cand(None, "2026-11-12T20:00:00Z", "work")];
        let b = vec![cand(Some("same"), "2026-11-12T18:00:00Z", "second"), cand(None, "2026-11-12T17:00:00Z", "second")];
        let out = merge(vec![a, b]);
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].start, "2026-11-12T17:00:00Z");
        assert_eq!(out[1].account_id, "work");
        let many: Vec<Candidate> = (0..12).map(|i| cand(None, &format!("2026-11-12T{:02}:00:00Z", i), "work")).collect();
        let capped = merge(vec![many]);
        assert_eq!(capped.len(), MAX_MEETINGS);
        assert_eq!(capped[0].start, "2026-11-12T00:00:00Z");
    }

    #[test]
    fn same_uid_with_different_join_links_both_survive() {
        let mut a = cand(Some("uid"), "2026-11-12T18:00:00Z", "work");
        a.join = Some("https://teams.microsoft.com/l/meetup-join/real".into());
        let mut b = cand(Some("uid"), "2026-11-12T18:00:00Z", "second");
        b.join = Some("https://teams.microsoft.com/l/meetup-join/other".into());
        assert_eq!(merge(vec![vec![a], vec![b]]).len(), 2);
    }

    #[test]
    fn same_everything_across_two_accounts_shows_once() {
        let mut a = cand(Some("uid"), "2026-11-12T18:00:00Z", "work");
        a.join = Some("https://teams.microsoft.com/l/meetup-join/same".into());
        let mut b = a.clone();
        b.account_id = "second".into();
        let out = merge(vec![vec![a], vec![b]]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].account_id, "work");
    }

    #[test]
    fn recurring_occurrences_with_one_uid_both_survive() {
        let one = cand(Some("series"), "2026-11-12T18:00:00Z", "work");
        let two = cand(Some("series"), "2026-11-13T18:00:00Z", "work");
        let other = cand(Some("series"), "2026-11-12T18:00:00Z", "second");
        let out = merge(vec![vec![one, two], vec![other]]);
        // Same account, different starts: both stay. The second account's copy of the first
        // occurrence matches it exactly and collapses.
        assert_eq!(out.len(), 2);
        let both_second = merge(vec![vec![cand(Some("series"), "2026-11-12T18:00:00Z", "work")], vec![cand(Some("series"), "2026-11-13T18:00:00Z", "second")]]);
        assert_eq!(both_second.len(), 2);
    }

    #[test]
    fn join_link_is_kept_only_when_allowed() {
        let mut e = event("m", "2026-11-12T17:00:00.0000000", "1");
        e["onlineMeeting"] = json!({ "joinUrl": "https://teams.microsoft.com/l/meetup-join/abc" });
        let mut z = event("z", "2026-11-12T17:00:00.0000000", "2");
        z["onlineMeetingUrl"] = json!("https://zoom.example/j/1");
        let out = shape_events(&json!({ "value": [e, z] }), "work");
        assert_eq!(out[0].join.as_deref(), Some("https://teams.microsoft.com/l/meetup-join/abc"));
        assert!(out[1].join.is_none());
    }

    #[test]
    fn allowlist_accepts_teams_links() {
        assert!(join_allowed("https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0?context=%7b%7d"));
        assert!(join_allowed("https://teams.live.com/meet/9876543210?p=abc"));
        assert!(join_allowed("https://Teams.Microsoft.com/l/meetup-join/x"));
        assert!(join_allowed("https://teams.microsoft.com:443/l/meetup-join/x"));
    }

    #[test]
    fn allowlist_rejects_everything_else() {
        let long = format!("https://teams.microsoft.com/l/meetup-join/{}", "a".repeat(2049));
        let bad = [
            "http://teams.microsoft.com/l/meetup-join/x",
            "https://teams.microsoft.com.evil.example/l/meetup-join/x",
            "https://evil.example/teams.microsoft.com/l/meetup-join/x",
            "https://teams.microsoft.com@evil.example/",
            "https://teams.microsoft.com@evil.example/l/meetup-join/x",
            "https://user:pw@teams.microsoft.com/l/meetup-join/x",
            "https://teams.microsoft.com:8443/l/meetup-join/x",
            "https://nam06.safelinks.protection.outlook.com/?url=https%3A%2F%2Fteams.microsoft.com%2Fl%2Fmeetup-join%2Fx",
            "javascript:alert(1)",
            "https://teams.microsoft.com/l/meetup-join/x\\y",
            "https://teams.microsoft.com/l/meetup-join/x y",
            "https://teams.microsoft.com/other/path",
            "https://sub.teams.microsoft.com/l/meetup-join/x",
            "",
            long.as_str(),
        ];
        for url in bad {
            assert!(!join_allowed(url), "should reject {url}");
        }
    }
}
