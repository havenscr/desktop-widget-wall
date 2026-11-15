//! Graph calendar read: UTC time helpers, response shaping, the join-link allowlist.

use super::reason::{clean_code, graph_reason, GRAPH_BODY, GRAPH_NETWORK, GRAPH_TIMEOUT, MAX_ERROR_BODY};
use super::{MAX_BODY, MAX_TITLE_CHARS};
use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;
use std::time::{Duration, Instant};

pub const MAX_MEETINGS: usize = 8;
/// The day view keeps up to this many events.
pub const MAX_DAY_EVENTS: usize = 40;

/// One meeting as read from one account. `join` stays in Rust.
#[derive(Clone, PartialEq)]
pub struct Candidate {
    pub ical: Option<String>,
    pub title: String,
    pub start: String,
    pub end: String,
    pub account_id: String,
    pub join: Option<String>,
    /// The event's Outlook web link, only when `web_link_allowed` passed. Stays in Rust.
    pub web: Option<String>,
    /// Classic Outlook EntryID as validated uppercase hex. Stays in Rust.
    pub entry: Option<String>,
    /// Names and a cleaned invite text, only from the next-meetings read (see `shape_details`).
    pub details: Option<Details>,
}

impl std::fmt::Debug for Candidate {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Candidate")
            .field("ical", &self.ical)
            .field("title", &self.title)
            .field("start", &self.start)
            .field("end", &self.end)
            .field("account_id", &self.account_id)
            .field("join", &self.join)
            .field("web", &self.web)
            .field("entry", &self.entry.as_ref().map(|_| "<redacted>"))
            .field("details", &self.details.as_ref().map(|_| "<redacted>"))
            .finish()
    }
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

/// Time, passed in so tests control it. Milliseconds on a monotonic scale, seconds since the
/// Unix epoch for HTTP dates, and a sleep that a test clock turns into a jump forward.
pub trait Clock {
    fn now_ms(&self) -> u64;
    fn epoch_secs(&self) -> u64;
    fn sleep(&self, d: Duration);
}

pub struct RealClock;

impl Clock for RealClock {
    fn now_ms(&self) -> u64 {
        static START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
        START.get_or_init(Instant::now).elapsed().as_millis() as u64
    }
    fn epoch_secs(&self) -> u64 {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
    }
    fn sleep(&self, d: Duration) {
        std::thread::sleep(d);
    }
}

/// One read's clock and its single absolute deadline: when it began and the instant by which
/// everything (the wait for the turn, the token request, the Graph attempts, the retry
/// waits and a forced refresh) must be over.
#[derive(Clone)]
pub struct Ctx {
    pub kind: Kind,
    pub clock: Arc<dyn Clock + Send + Sync>,
    pub began_ms: u64,
    pub deadline_ms: u64,
    /// Set when Graph refused the wider next read: the rest of this read asks for the plain fields.
    plain: Arc<std::sync::atomic::AtomicBool>,
}

impl Ctx {
    pub fn new(kind: Kind, clock: Arc<dyn Clock + Send + Sync>, budget: Duration) -> Ctx {
        let began_ms = clock.now_ms();
        Ctx { kind, clock, began_ms, deadline_ms: began_ms + budget.as_millis() as u64, plain: Arc::new(std::sync::atomic::AtomicBool::new(false)) }
    }
    /// True when this read asks for people and invite text: the next read, until Graph refuses it.
    pub fn wide(&self) -> bool {
        self.kind == Kind::Next && !self.plain.load(std::sync::atomic::Ordering::SeqCst)
    }
    /// Graph refused the wider fields: ask for the plain ones from now on.
    pub fn fall_back_to_plain(&self) {
        self.plain.store(true, std::sync::atomic::Ordering::SeqCst);
    }
    pub fn elapsed_ms(&self) -> u64 {
        self.clock.now_ms().saturating_sub(self.began_ms)
    }
    /// What is left before the deadline; zero once it has passed.
    pub fn remaining(&self) -> Duration {
        Duration::from_millis(self.deadline_ms.saturating_sub(self.clock.now_ms()))
    }
}

/// What a Graph failure leaves in the log. Ids and codes only; never a subject, an attendee,
/// an address, a token or a query value.
#[derive(Debug, Clone, PartialEq)]
pub struct Diag {
    pub kind: Kind,
    /// Which host the request went to: `graph` or `login`.
    pub host: &'static str,
    /// What kind of network failure it was (`dns`, `connect`, `timeout`, `reset`, `other`), when no reply came.
    pub net: Option<&'static str>,
    /// 0 when no reply arrived.
    pub status: u16,
    pub code: Option<String>,
    pub inner: Option<String>,
    pub request_id: Option<String>,
    pub client_request_id: Option<String>,
    pub attempt: u32,
    pub elapsed_ms: u64,
    /// Phase, address family and probe results for a network failure (see `netprobe.rs`).
    pub probe: Option<super::netprobe::NetProbe>,
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
            "req={} host={} status={} net={} af={} code={} inner={} request-id={} client-request-id={} attempt={} ms={} {}",
            self.kind.as_str(),
            self.host,
            status,
            self.net.unwrap_or("none"),
            self.probe.map(|p| p.af).unwrap_or("unknown"),
            code(&self.code),
            code(&self.inner),
            clean_id(&self.request_id),
            clean_id(&self.client_request_id),
            self.attempt,
            self.elapsed_ms,
            self.probe.map(|p| p.fields()).unwrap_or_else(|| super::netprobe::NO_PROBE_FIELDS.to_string())
        )
    }
}

/// One HTTP attempt as the transport saw it. `status` 0 means no reply at all.
pub struct Raw {
    pub status: u16,
    /// The kind of network failure when `status` is 0.
    pub net: Option<&'static str>,
    /// The `Retry-After` header as sent: whole seconds or an HTTP date.
    pub retry_after: Option<String>,
    pub request_id: Option<String>,
    pub client_request_id: Option<String>,
    pub body: Vec<u8>,
    /// Failure fields when no reply came (or the body could not be read).
    pub probe: Option<super::netprobe::NetProbe>,
}

/// Per address: the client tries a host's addresses one after another, so a dead IPv6 route
/// must not eat the budget before IPv4 is tried.
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
        host: "graph",
        net: raw.net,
        status: raw.status,
        code: text(&["error", "code"]),
        inner: text(&["error", "innerError", "code"]),
        request_id: raw.request_id.clone(),
        client_request_id: raw.client_request_id.clone(),
        attempt,
        // The probe's own time is not part of the call.
        elapsed_ms: ctx.elapsed_ms().saturating_sub(raw.probe.map(|p| p.probe_ms as u64).unwrap_or(0)),
        probe: raw.probe,
    }
}

/// What the HTTP client said went wrong, before it is narrowed to a class.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum NetKind {
    Dns,
    Connect,
    Io,
    Other,
}

/// The class of a network failure, from the client's error kind and the kind of the I/O error
/// under it. Never from error text, which could carry a host name or an address. The client
/// does not tell a TLS failure from other I/O errors, and a malformed reply is no class of its
/// own, so those are `other` (or `reset` when the peer dropped the connection).
pub fn classify_net(kind: NetKind, io: Option<std::io::ErrorKind>) -> &'static str {
    use std::io::ErrorKind as K;
    match (kind, io) {
        (NetKind::Dns, _) => "dns",
        (_, Some(K::TimedOut | K::WouldBlock)) => "timeout",
        (_, Some(K::ConnectionReset | K::ConnectionAborted | K::BrokenPipe | K::UnexpectedEof)) => "reset",
        (_, Some(K::ConnectionRefused | K::AddrNotAvailable)) => "connect",
        (NetKind::Connect, _) => "connect",
        _ => "other",
    }
}

/// Days since 1970-01-01 for a civil date (the inverse of `civil_from_days`).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// `Thu, 12 Nov 2026 05:00:03 GMT` as seconds since the epoch; None for any other shape.
pub fn parse_http_date(s: &str) -> Option<u64> {
    let parts: Vec<&str> = s.split_whitespace().collect();
    if parts.len() != 6 || parts[5] != "GMT" || !parts[0].ends_with(',') {
        return None;
    }
    let day: i64 = parts[1].parse().ok()?;
    let month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].iter().position(|m| *m == parts[2])? as i64 + 1;
    let year: i64 = parts[3].parse().ok()?;
    let mut hms = parts[4].split(':').map(|n| n.parse::<i64>().ok());
    let (h, mi, sec) = (hms.next()??, hms.next()??, hms.next()??);
    if hms.next().is_some() || !(1..=31).contains(&day) || !(0..24).contains(&h) || !(0..60).contains(&mi) || !(0..61).contains(&sec) || !(1970..=9999).contains(&year) {
        return None;
    }
    let secs = days_from_civil(year, month, day) * 86_400 + h * 3600 + mi * 60 + sec;
    u64::try_from(secs).ok()
}

/// How long `Retry-After` asks to wait: whole seconds, or an HTTP date measured from `now_epoch`.
/// Never negative (a past date is zero) and never over five seconds. None when the value is
/// neither form.
pub fn retry_after_wait(value: &str, now_epoch: u64) -> Option<Duration> {
    let v = value.trim();
    let secs = if !v.is_empty() && v.chars().all(|c| c.is_ascii_digit()) {
        v.parse::<u64>().unwrap_or(u64::MAX)
    } else {
        parse_http_date(v)?.saturating_sub(now_epoch)
    };
    Some(Duration::from_secs(secs.min(MAX_RETRY_AFTER_SECS)))
}

/// The retry policy, with the network and the clock passed in. A 429, 503 or 504 is tried
/// again (up to three attempts in all) after a short wait, `Retry-After` honoured up to five
/// seconds, and only while the wait fits before the read's deadline. Nothing else is retried.
/// A 401 is the caller's to handle (refresh the token, ask again).
pub fn run_attempts(ctx: &Ctx, send: &mut dyn FnMut(u32, Duration) -> Raw) -> (GraphReply, Option<Diag>) {
    let mut attempt = 0u32;
    loop {
        attempt += 1;
        let remaining = ctx.remaining();
        if remaining.is_zero() {
            return (GraphReply::Transient(GRAPH_TIMEOUT.to_string()), None);
        }
        let raw = send(attempt, remaining.min(READ_TIMEOUT));
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
                    let wait = raw
                        .retry_after
                        .as_deref()
                        .and_then(|v| retry_after_wait(v, ctx.clock.epoch_secs()))
                        .unwrap_or_else(|| backoff(attempt));
                    if wait < ctx.remaining() {
                        ctx.clock.sleep(wait);
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

pub const SELECT: &str = "id,subject,start,end,isAllDay,isCancelled,responseStatus,onlineMeeting,onlineMeetingUrl,iCalUId,webLink";
/// The next-meetings read also asks for who is in the meeting and the first words of the invite
/// (`shape_details` keeps names and cleaned text only). The day read keeps the plain `SELECT`.
pub const SELECT_DETAILS: &str = "id,subject,start,end,isAllDay,isCancelled,responseStatus,onlineMeeting,onlineMeetingUrl,iCalUId,webLink,organizer,attendees,bodyPreview";
pub const TOP: u32 = 50;
pub const CALENDAR_VIEW_PATH: &str = "https://graph.microsoft.com/v1.0/me/calendarView";
pub const PREFER: &str = "outlook.timezone=\"UTC\"";
const ENTRY_EXPAND_ENCODED: &str = "singleValueExtendedProperties%28%24filter%3Did%20eq%20%27Binary%200x0FFF%27%29";

/// The next-meetings calendarView request: the documented options only (`startDateTime`,
/// `endDateTime`, `$select`, `$orderby` on the start time, `$top`), both date-times in UTC with a `Z`.
pub fn calendar_view_url(start: &str, end: &str) -> String {
    calendar_view_url_inner(start, end, true, SELECT_DETAILS)
}

pub fn calendar_view_url_without_expand(start: &str, end: &str) -> String {
    calendar_view_url_inner(start, end, false, SELECT_DETAILS)
}

/// The day read's request: the same, with the plain `SELECT` (no people, no invite text).
pub fn calendar_view_url_day(start: &str, end: &str) -> String {
    calendar_view_url_inner(start, end, true, SELECT)
}

pub fn calendar_view_url_day_without_expand(start: &str, end: &str) -> String {
    calendar_view_url_inner(start, end, false, SELECT)
}

fn calendar_view_url_inner(start: &str, end: &str, expand: bool, select: &str) -> String {
    let expand = if expand { format!("&$expand={ENTRY_EXPAND_ENCODED}") } else { String::new() };
    format!(
        "{CALENDAR_VIEW_PATH}?startDateTime={}&endDateTime={}&$select={select}&$orderby=start/dateTime&$top={TOP}{expand}",
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

    fn calendar_view_without_expand_diag(&self, access: &str, start: &str, end: &str, _ctx: &Ctx) -> (GraphReply, Option<Diag>) {
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

/// Only an Outlook on the web event link on a fixed host may open the event: https, no user
/// name or password, the default port, no whitespace, backslash or control characters.
pub fn web_link_allowed(raw: &str) -> bool {
    if raw.len() > 4096 || raw.chars().any(|c| c == '\\' || c.is_whitespace() || c.is_control()) {
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
    matches!(
        url.host_str().map(str::to_ascii_lowercase).as_deref(),
        Some("outlook.office.com") | Some("outlook.office365.com") | Some("outlook.live.com") | Some("outlook.cloud.microsoft")
    )
}

/// Longest event id the address builder accepts.
const MAX_EVENT_ID: usize = 400;

/// The address of an event in Outlook on the web, built from the event's own id instead of
/// Graph's `webLink` (whose `/owa/?itemid=` form can fail in the new Outlook app). The id must
/// be 1 to 400 characters of `A-Z a-z 0-9 + / = _ -` (what Graph ids are made of). The host is
/// `outlook.live.com` when the event's own `webLink` is allowed and names that host, else
/// `outlook.office.com`; every
/// character outside the unreserved set is percent-encoded, so an id can never add a path
/// segment, a query or a fragment. None for any other id.
pub fn event_link(id: &str, web_link: Option<&str>) -> Option<String> {
    if id.is_empty() || id.len() > MAX_EVENT_ID || !id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '/' | '=' | '_' | '-')) {
        return None;
    }
    // The host is one of two literals. A personal account's own link, when it passes the
    // allow-list and names `outlook.live.com`, picks the second; nothing is copied from it.
    let personal = web_link
        .filter(|u| web_link_allowed(u))
        .and_then(|u| tauri::Url::parse(u).ok())
        .is_some_and(|u| u.host_str().map(str::to_ascii_lowercase).as_deref() == Some("outlook.live.com"));
    let mut out = String::from(if personal { "https://outlook.live.com/calendar/item/" } else { "https://outlook.office.com/calendar/item/" });
    for c in id.chars() {
        if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
            out.push(c);
        } else {
            out.push_str(&format!("%{:02X}", c as u32));
        }
    }
    Some(out)
}

// Section: shaping

/// Titles retain joiners used by composed glyphs while removing other hidden format characters.
fn normalize_title(raw: &str) -> String {
    let spaced: String = raw.chars().filter_map(|c| if c.is_control() { Some(' ') } else if c == '\u{200D}' || !is_invisible(c) { Some(c) } else { None }).collect();
    spaced.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A schemeless title link needs a host and a path with a join id or meeting code.
fn title_join_link(word: &str) -> bool {
    let Some((host, path)) = word.split_once('/') else { return false };
    if !host_shaped(host) { return false }
    let mut run = 0;
    path.chars().any(|c| { run = if c.is_ascii_digit() { run + 1 } else { 0 }; run >= 5 })
        || path.split(|c: char| !c.is_ascii_alphanumeric() && c != '-').any(meeting_code_shaped)
}

/// Title numbers use a nine-digit threshold, independently of invite filtering.
fn strip_title_numbers(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut remove = vec![false; chars.len()];
    let mut i = 0;
    while i < chars.len() {
        let start = i;
        while i < chars.len() && !chars[i].is_whitespace() { i += 1; }
        if chars[start..i].iter().filter(|c| c.is_ascii_digit()).count() >= 9 {
            remove[start..i].fill(true);
        }
        i += 1;
    }
    i = 0;
    while i < chars.len() {
        if (chars[i].is_ascii_digit() || matches!(chars[i], '+' | '('))
            && (i == 0 || !(chars[i - 1].is_alphanumeric() || chars[i - 1] == '.')) {
            let start = i;
            let mut digits = 0;
            while i < chars.len() && (chars[i].is_ascii_digit() || matches!(chars[i], ' ' | '-' | '.' | '(' | ')' | '+')) {
                digits += usize::from(chars[i].is_ascii_digit());
                i += 1;
            }
            if digits >= 9 { remove[start..i].fill(true); }
        } else {
            i += 1;
        }
    }
    let mut out = String::new();
    for (c, removed) in chars.into_iter().zip(remove) {
        out.push(if removed { ' ' } else { c });
    }
    out
}

/// Remove empty wrappers and edge separators left behind by removed join details.
fn tidy_title(text: &str) -> String {
    let mut out = text.split_whitespace().collect::<Vec<_>>().join(" ");
    loop {
        let next = out.replace("( )", "").replace("()", "").replace("[ ]", "").replace("[]", "");
        let next = next.split_whitespace().collect::<Vec<_>>().join(" ");
        if next == out { break; }
        out = next;
    }
    out.trim_matches(|c: char| c.is_whitespace() || matches!(c, '-' | '|' | ':' | ';' | ',' | '/' | '+')).to_string()
}

/// Titles remove join-shaped words and long numbers, never invite markers or line cuts.
fn clean_title(raw: &str) -> String {
    let normalized = normalize_title(raw);
    let words = normalized.split_whitespace().filter(|word| {
        let lower = word.to_ascii_lowercase();
        // Ignore joiners for link detection, but keep them in the displayed title.
        let probe = lower.replace('\u{200D}', "");
        let start = probe.trim_start_matches(|c: char| !c.is_alphanumeric());
        !(probe.contains("://")
            || start.starts_with("www.")
            || word.contains('@')
            || ["tel:", "sip:", "mailto:", "callto:"].iter().any(|p| start.starts_with(p))
            || title_join_link(&probe)
            || meeting_code_shaped(word))
    }).collect::<Vec<_>>().join(" ");
    tidy_title(&strip_title_numbers(&words))
}

fn cap_title(raw: &str) -> String {
    let t: String = clean_title(raw).chars().take(MAX_TITLE_CHARS).collect();
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

pub fn entry_hex(value: &str) -> Option<String> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(value).ok()?;
    if !(20..=512).contains(&bytes.len()) {
        return None;
    }
    Some(bytes.iter().map(|byte| format!("{byte:02X}")).collect())
}

pub fn is_entry_property_id(value: &str) -> bool {
    let Some((kind, tag)) = value.split_once(' ') else {
        return false;
    };
    kind.eq_ignore_ascii_case("Binary")
        && tag.strip_prefix("0x").or_else(|| tag.strip_prefix("0X")).and_then(|hex| u32::from_str_radix(hex, 16).ok()) == Some(0x0fff)
}

// Section: details (people and invite text)

/// People kept per meeting; the rest are only counted.
pub const MAX_PEOPLE: usize = 20;
/// A person's name is cut at this many characters.
pub const MAX_NAME_CHARS: usize = 60;
/// The cleaned invite text is cut at this many characters.
pub const MAX_INVITE_CHARS: usize = 400;

/// One invited person as the web view gets them: a name and how they replied. Never an address.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Person {
    pub name: String,
    /// `yes`, `maybe`, `no`, `none` or `organizer`.
    pub reply: &'static str,
}

/// What the next-meetings read passes about who is in a meeting and what the invite says.
/// Names and plain text only: no address, no domain, no link, no meeting id, no passcode.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Details {
    pub called_by: Option<String>,
    pub people: Vec<Person>,
    /// Invited people not in `people`: past the 20 kept, or with no usable name.
    pub people_more: u32,
    pub invite: Option<String>,
}

/// Characters that never reach the page and never hide a word from the rules below: every control character
/// (Cc) and the invisible format characters (Cf) that could split `://` or `www.`: the soft hyphen, the arabic
/// letter mark, zero-width and direction marks and overrides, the word joiner and invisible operators, the
/// byte order mark, the combining grapheme joiner and the tag block (U+E0000 to U+E007F).
fn is_invisible(c: char) -> bool {
    c.is_control()
        || matches!(c, '\u{00AD}' | '\u{034F}' | '\u{061C}' | '\u{180E}' | '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2064}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}' | '\u{E0000}'..='\u{E007F}')
}

/// A line with every control character turned to a space, every invisible format character removed
/// and the whitespace collapsed to single spaces. The rules below always look at this form.
fn normalize(raw: &str) -> String {
    let spaced: String = raw.chars().filter_map(|c| if c.is_control() { Some(' ') } else if is_invisible(c) { None } else { Some(c) }).collect();
    spaced.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A word shaped like a host, or a host with a path: a dot followed by two or more letters inside the word
/// ("meet.example/abc", "short.example/x"). The ends are trimmed of punctuation first, so "start." stays a word.
/// The one dot leader U+2024 and the full-width full stop U+FF0E count as dots; the ideographic full stop U+3002
/// does only when two ASCII letters follow it (it ends sentences in running Japanese and Chinese text).
fn host_shaped(word: &str) -> bool {
    let t = word.trim_matches(|c: char| !c.is_alphanumeric() && c != '/');
    let chars: Vec<char> = t.chars().collect();
    chars.windows(3).any(|w| match w[0] {
        '.' | '\u{2024}' | '\u{FF0E}' => w[1].is_alphabetic() && w[2].is_alphabetic(),
        '\u{3002}' => w[1].is_ascii_alphabetic() && w[2].is_ascii_alphabetic(),
        _ => false,
    })
}

/// A word shaped like a meeting code: three letters, a hyphen, four letters, a hyphen, three letters ("abc-defg-hij").
fn meeting_code_shaped(word: &str) -> bool {
    let t = word.trim_matches(|c: char| !c.is_alphanumeric());
    let parts: Vec<&str> = t.split('-').collect();
    parts.len() == 3 && [3usize, 4, 3].iter().zip(&parts).all(|(n, p)| p.chars().count() == *n && p.chars().all(|c| c.is_ascii_alphabetic()))
}

fn digits_in(text: &str) -> usize {
    text.chars().filter(|c| c.is_numeric()).count()
}

/// A name that is safe to pass: control and invisible characters dealt with, whitespace collapsed, a trailing
/// bracketed part (a company in brackets) removed, cut at 60 characters. None when nothing is left or when the
/// text looks like an address, a link, a domain, a word shaped like a host or a phone number (Outlook fills the
/// name with the address when it knows no name).
pub fn clean_name(raw: &str) -> Option<String> {
    let mut name = normalize(raw);
    loop {
        let open = if name.ends_with(')') { name.rfind('(') } else if name.ends_with(']') { name.rfind('[') } else { None };
        match open {
            Some(i) => name = name[..i].trim().to_string(),
            None => break,
        }
    }
    let lower = name.to_ascii_lowercase();
    // No name when any word is host shaped ("Ana corp.example", "Join meet.example/j/abc") or the name holds a phone number's worth of digits.
    if name.is_empty() || name.contains('@') || lower.contains("://") || lower.contains("www.") || name.split_whitespace().any(host_shaped) || digits_in(&name) >= 9 {
        return None;
    }
    Some(name.chars().take(MAX_NAME_CHARS).collect::<String>().trim().to_string()).filter(|n| !n.is_empty())
}

fn reply_word(response: Option<&str>) -> &'static str {
    match response {
        Some("accepted") => "yes",
        Some("tentativelyAccepted") => "maybe",
        Some("declined") => "no",
        Some("organizer") => "organizer",
        _ => "none",
    }
}

/// Markers that always cut: the text is cut before the first line that holds one. They are looked for in the
/// normalized, lower case line, so a tab, a hidden character or a double space cannot hide one.
const INVITE_MARKERS: [&str; 17] = [
    "microsoft teams",
    "join on your computer",
    "join zoom",
    "meeting id",
    "meeting-id",
    "meeting number",
    "meeting-number",
    "conference id",
    "access code",
    "c\u{f3}digo de acceso",
    "kenncode",
    "code secret",
    "passcode",
    "join by phone",
    "pin:",
    "pw:",
    "pwd",
];

/// Short credential markers cut at word boundaries, not inside agenda words.
fn invite_marker_cuts(lower: &str) -> bool {
    INVITE_MARKERS.iter().any(|marker| {
        if !matches!(*marker, "pin:" | "pw:" | "pwd") {
            return lower.contains(marker);
        }
        lower.match_indices(marker).any(|(at, _)| {
            !lower[..at].chars().next_back().is_some_and(char::is_alphanumeric)
                && (*marker != "pwd" || !lower[at + marker.len()..].chars().next().is_some_and(char::is_alphabetic))
        })
    })
}

/// Everyday words that are also the start of a join block ("Password: AbCd1234", "Join the Webex meeting"). A line is cut at
/// one only when it starts the line, or the rest of the line holds a colon or a word with a digit; otherwise a sentence
/// that merely mentions it ("rotate the shared password list") stays whole.
const EVERYDAY_MARKERS: [&str; 11] = ["password", "passwort", "kennwort", "contrase\u{f1}a", "mot de passe", "senha", "webex", "google meet", "pin", "dial in", "dial-in"];

/// The dividers some services draw around the join block.
const DIVIDERS: [&str; 1] = ["-::~:~::"];

/// True when this lower case line holds an everyday marker that cuts: at the start of the line (nothing but punctuation
/// before it), or with a colon or a word holding a digit after it.
fn everyday_marker_cuts(lower: &str) -> bool {
    for m in EVERYDAY_MARKERS {
        let mut from = 0;
        while let Some(at) = lower[from..].find(m) {
            let i = from + at;
            let end = i + m.len();
            from = i + m.len().max(1);
            let before = lower[..i].chars().next_back();
            let after = lower[end..].chars().next();
            // A whole word: not inside another one.
            if before.is_some_and(char::is_alphanumeric) || after.is_some_and(char::is_alphanumeric) {
                continue;
            }
            let rest = &lower[end..];
            if lower[..i].chars().all(|c| !c.is_alphanumeric()) || rest.contains(':') || rest.split_whitespace().any(|w| w.chars().any(char::is_numeric)) {
                return true;
            }
        }
    }
    false
}

fn has_underscore_run(line: &str) -> bool {
    let mut run = 0;
    for c in line.chars() {
        run = if c == '_' { run + 1 } else { 0 };
        if run >= 8 {
            return true;
        }
    }
    false
}

/// Mask only complete chains of one to three plain years, for the numeric filters.
/// Other digit groups, phone prefixes and dotted dates never receive this exemption.
fn mask_year_chains(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = chars.clone();
    let mut i = 0;
    while i < chars.len() {
        if !chars[i].is_ascii_digit() { i += 1; continue; }
        let start = i;
        while i < chars.len() && chars[i].is_ascii_digit() { i += 1; }
        if start > 0 && chars[start - 1].is_alphanumeric() { continue; }
        let start_boundary = start == 0 || !matches!(chars[start - 1], '.' | ',' | '+' | '(');
        let mut end = i;
        let mut groups = vec![(start, i)];
        loop {
            let mut next = end;
            while next < chars.len() && matches!(chars[next], ' ' | '-' | '/') { next += 1; }
            if next == end || next == chars.len() || !chars[next].is_ascii_digit() { break; }
            let begin = next;
            while next < chars.len() && chars[next].is_ascii_digit() { next += 1; }
            groups.push((begin, next));
            end = next;
        }
        let boundary = end == chars.len() || !(chars[end].is_alphanumeric() || matches!(chars[end], '.' | ','));
        if start_boundary && boundary && groups.len() <= 3 && groups.iter().all(|&(a, b)| {
            b - a == 4 && chars[a..b].iter().collect::<String>().parse::<u16>().is_ok_and(|n| (1900..=2099).contains(&n))
        }) {
            for &(a, b) in &groups { for c in &mut out[a..b] { *c = 'y'; } }
        }
        i = end;
    }
    out.into_iter().collect()
}

/// The longest separated digit run, excluding digits attached directly to a letter.
/// Spaces, hyphens and round brackets still join phone number groups.
fn longest_digit_run(text: &str) -> usize {
    let mut best = 0;
    let mut run = 0;
    let mut attached = false;
    for c in mask_year_chains(text).chars() {
        if c.is_numeric() {
            if !attached {
                run += 1;
                best = best.max(run);
            }
        } else {
            attached = c.is_alphabetic();
            if !matches!(c, ' ' | '-' | '(' | ')') {
                run = 0;
            }
        }
    }
    best
}

/// Remove whole long-number words before grouping can leave fragments of them behind.
fn without_long_number_words(text: &str) -> String {
    let masked = mask_year_chains(text);
    text.split_whitespace().zip(masked.split_whitespace()).filter(|(_, mask)| digits_in(mask) < 5)
        .map(|(word, _)| word).collect::<Vec<_>>().join(" ")
}

/// Takes out digit groups (three or more digits each) that are separated only by spaces, hyphens, dots or commas and
/// total seven or more digits, as one run: a phone number or an id written in groups. "10:30", "2026", "4.12" and
/// "$1,250" are not such runs and stay.
fn strip_digit_chains(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let year_mask: Vec<char> = mask_year_chains(text).chars().collect();
    // Digit runs of three or more.
    let mut runs: Vec<(usize, usize)> = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_numeric() {
            let start = i;
            while i < chars.len() && chars[i].is_numeric() {
                i += 1;
            }
            if i - start >= 3 {
                runs.push((start, i));
            }
        } else {
            i += 1;
        }
    }
    let mut remove = vec![false; chars.len()];
    let mut k = 0;
    while k < runs.len() {
        let mut j = k;
        // Extend while the next run follows after nothing but separators.
        while j + 1 < runs.len() && runs[j + 1].0 > runs[j].1 && chars[runs[j].1..runs[j + 1].0].iter().all(|c| matches!(c, ' ' | '-' | '/' | '.' | ',')) {
            j += 1;
        }
        let total: usize = runs[k..=j].iter().map(|(a, b)| b - a).sum();
        let years_only = runs[k..=j].iter().all(|&(a, b)| year_mask[a..b].iter().all(|c| *c == 'y'));
        if total >= 7 && !years_only {
            for r in remove.iter_mut().take(runs[j].1).skip(runs[k].0) {
                *r = true;
            }
        }
        k = j + 1;
    }
    let mut out = String::new();
    let mut gap = false;
    for (c, r) in chars.iter().zip(&remove) {
        if *r {
            gap = true;
        } else {
            if gap {
                out.push(' ');
                gap = false;
            }
            out.push(*c);
        }
    }
    if gap {
        out.push(' ');
    }
    out
}

/// Sentences of one line, each with its end punctuation and the space after it.
fn sentences(line: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut start = 0;
    let bytes = line.as_bytes();
    for (i, c) in line.char_indices() {
        if matches!(c, '.' | '!' | '?') && bytes.get(i + 1) == Some(&b' ') {
            out.push(&line[start..=i]);
            start = i + 1;
        }
    }
    if start < line.len() {
        out.push(&line[start..]);
    }
    out
}

/// True for a word the invite never keeps: a link, an address, a phone or sip address, anything shaped like a
/// host (with or without a path), and a number of five or more digits (an id, a code, a phone number).
fn dropped_word(word: &str) -> bool {
    let lower = word.to_ascii_lowercase();
    lower.contains("://")
        || lower.contains("www.")
        || word.contains('@')
        || ["tel:", "sip:", "mailto:", "callto:"].iter().any(|p| lower.trim_start_matches(|c: char| !c.is_alphanumeric()).starts_with(p))
        || host_shaped(word)
        || meeting_code_shaped(word)
        || digits_in(&mask_year_chains(word)) >= 5
}

/// The invite's own words from `bodyPreview`, as a best effort on text that anyone who can send an invitation
/// controls. Each line is normalized first (control and invisible characters, whitespace). The text is cut
/// before the first line that holds a join-block marker or a run of 8 underscores, and before the first line
/// or sentence with 9 or more digits. Every word that is a link, an address, a phone or sip address, host shaped
/// or has 5 or more digits is removed. The rest is collapsed and stops at 400 characters. None when
/// nothing is left.
pub fn clean_invite(raw: &str) -> Option<String> {
    let mut kept: Vec<String> = Vec::new();
    'lines: for line in raw.split(['\n', '\r']) {
        let norm = normalize(line);
        let lower = norm.to_lowercase();
        if has_underscore_run(&norm) || invite_marker_cuts(&lower) || DIVIDERS.iter().any(|m| lower.contains(m)) || everyday_marker_cuts(&lower) {
            break;
        }
        for sentence in sentences(&norm) {
            if longest_digit_run(sentence) >= 9 {
                break 'lines;
            }
            kept.push(strip_digit_chains(&without_long_number_words(sentence)));
        }
    }
    let words: Vec<&str> = kept.iter().flat_map(|l| l.split_whitespace()).filter(|w| !dropped_word(w)).collect();
    let text: String = words.join(" ").chars().take(MAX_INVITE_CHARS).collect::<String>().trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

/// People and invite text of one event, or None when the event carries none of them (the day
/// read does not ask for them, and a refused wider read falls back to the plain one).
pub fn shape_details(e: &Value) -> Option<Details> {
    if e.get("organizer").is_none() && e.get("attendees").is_none() && e.get("bodyPreview").is_none() {
        return None;
    }
    let called_by = str_at(e, &["organizer", "emailAddress", "name"]).and_then(clean_name);
    // The organizer is found among the attendees by identity (the address, kept in Rust and never sent; the
    // cleaned name when neither side has an address) before any cap, so they are listed once whatever their place.
    let org_address = str_at(e, &["organizer", "emailAddress", "address"]).map(|a| a.trim().to_ascii_lowercase()).filter(|a| !a.is_empty());
    let attendees: &[Value] = e.get("attendees").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]);
    let is_organizer = |a: &Value| {
        let addr = str_at(a, &["emailAddress", "address"]).map(|x| x.trim().to_ascii_lowercase()).filter(|x| !x.is_empty());
        match (&org_address, &addr) {
            (Some(o), Some(x)) => o == x,
            _ => called_by.is_some() && str_at(a, &["emailAddress", "name"]).and_then(clean_name).as_ref().map(|n| n.eq_ignore_ascii_case(called_by.as_deref().unwrap_or(""))) == Some(true),
        }
    };
    let mut people: Vec<Person> = Vec::new();
    let mut more: u32 = 0;
    let mut organizer_seen = false;
    if let Some(name) = &called_by {
        people.push(Person { name: name.clone(), reply: "organizer" });
        organizer_seen = true;
    }
    let mut organizer_matched = false;
    for a in attendees {
        if organizer_seen && !organizer_matched && is_organizer(a) {
            organizer_matched = true;
            continue;
        }
        match str_at(a, &["emailAddress", "name"]).and_then(clean_name) {
            Some(name) if people.len() < MAX_PEOPLE => people.push(Person { name, reply: reply_word(str_at(a, &["status", "response"])) }),
            _ => more = more.saturating_add(1),
        }
    }
    let invite = e.get("bodyPreview").and_then(Value::as_str).and_then(clean_invite);
    if called_by.is_none() && people.is_empty() && more == 0 && invite.is_none() {
        return None;
    }
    Some(Details { called_by, people, people_more: more, invite })
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
                // Built from the id; Graph's own link is only the fallback when the id is missing.
                web: e
                    .get("id")
                    .and_then(Value::as_str)
                    .and_then(|id| event_link(id, str_at(e, &["webLink"])))
                    .or_else(|| str_at(e, &["webLink"]).filter(|u| web_link_allowed(u)).map(str::to_string)),
                entry: e
                    .get("singleValueExtendedProperties")
                    .and_then(Value::as_array)
                    .and_then(|rows| rows.iter().find(|row| str_at(row, &["id"]).is_some_and(is_entry_property_id)))
                    .and_then(|row| str_at(row, &["value"]))
                    .and_then(entry_hex),
                details: shape_details(e),
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
    fn plain_year_chains_survive_without_preserving_ids_or_phones() {
        for text in ["Goals for Q3 2026 2027 plan", "2026 2027", "2025-2026", "2025/2026", "FY 2025 2026 budget", "Plan 2025 2026 2027 ahead"] {
            assert_eq!(clean_invite(text).as_deref(), Some(text), "{text}");
            assert_eq!(strip_digit_chains(text), text);
        }
        for text in ["987 6543 2101", "912-3456-7890", "+1 555 123 4567", "+1 2025 2026", "2024 2025 2026 2027"] {
            assert_eq!(clean_invite(&format!("Agenda.\n{text}\nLater.")), Some("Agenda.".into()), "{text}");
        }
        assert_eq!(clean_invite("Agenda 14.11.2026 later"), Some("Agenda later".into()));
        for text in ["1899 2026", "2100 2026", "2025.2026", "2025,2026", "2025 2026 999"] {
            assert_eq!(strip_digit_chains(text).trim(), "", "{text}");
        }
    }

    #[test]
    fn fair_titles_keep_years_technology_names_and_joiners() {
        let joined = "\u{1f469}\u{200D}\u{1f4bb} planning";
        for title in ["FY 2025 2026 budget", "FY2026-27", "Node.js/React.js", joined, "2025/2026 plan", "meet.example/agenda", "xwww.notes"] {
            assert_eq!(cap_title(title), title, "{title}");
        }
        for tail in ["https://meet.example/join", "meet.example/j/987654321", "meet.example/abc-defg-hij", "987 6543 2101", "abc-defg-hij"] {
            assert_eq!(cap_title(&format!("Sync {tail}")), "Sync");
            assert_eq!(cap_title(tail), "Untitled");
        }
        assert_eq!(cap_title("Sync https:\u{200D}//meet.example/join"), "Sync");
    }

    #[test]
    fn titles_preserve_short_numbers_with_punctuation() {
        for title in [
            "Plan (2026-2027)", "Plan (2026 2027)", "Plan 2026-2027.",
            "Plan 2026, 2027", "Budget 2026-27", "Review 2026/27",
            "Offsite (2026-2027) planning", "Q4 2026 / Q1 2027 roadmap",
            "Release 14.11.2026", "Release 2026-11-14", "Standup 9:30", "v2.1 review",
            "Q4 2026 2027", "v2.1 2026 2027 review", "Room 12345", "Count 12345678", "12345", "(12345678)", "FY2026-27",
        ] {
            assert_eq!(cap_title(title), title, "{title}");
        }
    }

    #[test]
    fn titles_remove_long_numbers_and_tidy_the_remainder() {
        for tail in ["912 3456 7890", "(912) 345-6789", "91234567890", "123456789",
            "912.3456.7890", "(9123456789 1)", "https://meet.example/abc-defg-hij", "meet.example/j/123456"] {
            assert_eq!(cap_title(&format!("Sync {tail}")), "Sync", "{tail}");
            assert_eq!(cap_title(tail), "Untitled", "{tail}");
            assert_eq!(cap_title(&format!("Sync [ {tail} ]")), "Sync", "{tail}");
            assert_eq!(cap_title(&format!("Sync ( {tail} )")), "Sync", "{tail}");
            assert_eq!(cap_title(&format!("{tail} | Sync | {tail}")), "Sync", "{tail}");
        }
        assert_eq!(cap_title("Call +1 555 123 4567"), "Call");
        assert_eq!(cap_title("Plan 2025 2026 2027"), "Plan");
        assert_eq!(cap_title("Sync [ ( 91234567890 ) ] next"), "Sync next");
    }

    #[test]
    fn short_invite_markers_do_not_cut_inside_agenda_words() {
        for line in ["Q4 spin: the new pricing", "pwdreset notes", "Review spw: notes", "Review épin: notes"] {
            let text = format!("{line}\nNext agenda item.");
            assert_eq!(clean_invite(&text), Some(format!("{line} Next agenda item.")));
        }
        for line in ["PIN: 1234", "PW: x", "pwd x", "pwd123", "https://meet.example/j/98765432101?pwd=x"] {
            assert_eq!(clean_invite(&format!("Agenda.\n{line}\nLater.")), Some("Agenda.".into()));
        }
    }

    #[test]
    fn label_digits_do_not_cut_the_following_agenda() {
        assert_eq!(longest_digit_run("Goals for Q3 2026 2027"), 0);
        // The full year phrase and the following agenda survive.
        assert_eq!(clean_invite("Goals for Q3 2026 2027\nNext agenda item."), Some("Goals for Q3 2026 2027 Next agenda item.".into()));
        for line in ["+1 555 123 4567", "Meeting 987 6543 2101", "9876543210"] {
            assert!(longest_digit_run(line) >= 9);
            assert_eq!(clean_invite(&format!("Agenda.\n{line}\nLater.")), Some("Agenda.".into()));
        }
        assert_eq!(clean_invite("ID9 8765 4321\nNext agenda item."), Some("ID9 Next agenda item.".into()));
        assert_eq!(clean_invite("Agenda x987654321\nNext agenda item."), Some("Agenda Next agenda item.".into()));
    }

    #[test]
    fn titles_drop_join_details_without_invite_line_cuts() {
        assert_eq!(cap_title("Sync 987 6543 2101 zoom.example.test/j/98765432101"), "Sync");
        for title in ["Q3 planning 2026", "1:1 with design", "Budget 4.12", "Review example.test launch", "Passcode rotation", "PIN review"] {
            assert_eq!(cap_title(title), title);
        }
        for title in ["https://meet.example/j/123", "www.meet.example/join", "meet.example/j/12345", "abc-defg-hij"] {
            assert_eq!(cap_title(title), "Untitled");
        }
        assert_eq!(cap_title("Sync x987654321"), "Sync");
        assert_eq!(cap_title("Sync tel:1234 sip:fixture mailto:fixture callto:fixture"), "Sync");
        assert_eq!(cap_title("Sync https:\u{200B}//meet.example/join"), "Sync");
        assert_eq!(cap_title(&"x".repeat(MAX_TITLE_CHARS + 10)).chars().count(), MAX_TITLE_CHARS);
    }

    #[test]
    fn capped_merge_keeps_more_and_still_dedupes() {
        let one = |n: u32, acct: &str| Candidate {
            ical: Some(format!("u{n}")),
            title: "T".into(),
            start: format!("2026-11-12T{:02}:00:00Z", n),
            end: format!("2026-11-12T{:02}:30:00Z", n),
            account_id: acct.into(),
            join: None,
            web: None,
            entry: None,
            details: None,
        };
        let a: Vec<_> = (0..12).map(|n| one(n, "a")).collect();
        let b: Vec<_> = (0..12).map(|n| one(n, "b")).collect();
        assert_eq!(merge_capped(vec![a.clone(), b.clone()], MAX_DAY_EVENTS).len(), 12);
        assert_eq!(merge_capped(vec![a, b], 5).len(), 5);
    }
    use serde_json::json;

    /// A clock the test controls: sleeping jumps it forward, and so does a request.
    struct TestClock {
        ms: std::sync::atomic::AtomicU64,
        epoch: u64,
        sleeps: std::sync::Mutex<Vec<Duration>>,
    }
    impl TestClock {
        fn new() -> Arc<TestClock> {
            Arc::new(TestClock { ms: 0.into(), epoch: 1_794_459_600, sleeps: Default::default() })
        }
        fn advance(&self, d: Duration) {
            self.ms.fetch_add(d.as_millis() as u64, std::sync::atomic::Ordering::SeqCst);
        }
    }
    impl Clock for TestClock {
        fn now_ms(&self) -> u64 {
            self.ms.load(std::sync::atomic::Ordering::SeqCst)
        }
        fn epoch_secs(&self) -> u64 {
            self.epoch
        }
        fn sleep(&self, d: Duration) {
            self.sleeps.lock().unwrap().push(d);
            self.advance(d);
        }
    }

    fn ctx_with(clock: &Arc<TestClock>, budget_ms: u64) -> Ctx {
        Ctx::new(Kind::Next, clock.clone(), Duration::from_millis(budget_ms))
    }

    fn raw(status: u16, retry_after: Option<&str>, body: &str) -> Raw {
        Raw { status, net: if status == 0 { Some("connect") } else { None }, retry_after: retry_after.map(str::to_string), request_id: Some("11111111-2222-3333-4444-555555555555".into()), client_request_id: Some("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee".into()), body: body.as_bytes().to_vec(), probe: None }
    }

    /// Runs the policy over a script of replies on a test clock; each request takes
    /// `request_ms`. Returns the outcome, the calls made, the waits taken and the clock.
    fn run_on(script: Vec<Raw>, budget_ms: u64, request_ms: u64) -> (GraphReply, Option<Diag>, u32, Vec<Duration>, u64) {
        let clock = TestClock::new();
        let ctx = ctx_with(&clock, budget_ms);
        let mut queue = script.into_iter();
        let mut calls = 0u32;
        let c2 = clock.clone();
        let (reply, diag) = run_attempts(&ctx, &mut |_attempt, timeout| {
            calls += 1;
            // A request never outlasts the timeout it was given.
            c2.advance(Duration::from_millis(request_ms).min(timeout));
            queue.next().expect("more calls than scripted")
        });
        let sleeps = clock.sleeps.lock().unwrap().clone();
        (reply, diag, calls, sleeps, clock.now_ms())
    }

    fn run(script: Vec<Raw>, budget_ms: u64) -> (GraphReply, Option<Diag>, u32, Vec<Duration>) {
        let (a, b, c, d, _) = run_on(script, budget_ms, 0);
        (a, b, c, d)
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
        let (_, _, _, sleeps) = run(vec![raw(429, Some("2"), ""), raw(429, Some("30"), ""), raw(200, None, "{}")], 12_000);
        assert_eq!(sleeps, vec![Duration::from_secs(2), Duration::from_secs(5)]);
    }

    #[test]
    fn retry_after_as_a_date_a_past_date_and_a_far_date() {
        let now = 1_794_459_600; // Thu, 12 Nov 2026 05:00:00 GMT
        assert_eq!(retry_after_wait("3", now), Some(Duration::from_secs(3)));
        assert_eq!(retry_after_wait("Thu, 12 Nov 2026 05:00:03 GMT", now), Some(Duration::from_secs(3)));
        assert_eq!(retry_after_wait("Thu, 12 Nov 2026 04:59:00 GMT", now), Some(Duration::ZERO));
        assert_eq!(retry_after_wait("Thu, 12 Nov 2026 06:00:00 GMT", now), Some(Duration::from_secs(5)));
        assert_eq!(retry_after_wait("99999999999999999999", now), Some(Duration::from_secs(5)));
        assert_eq!(retry_after_wait("soon", now), None);
        assert_eq!(retry_after_wait("", now), None);
        assert_eq!(parse_http_date("Thu, 01 Jan 1970 00:00:00 GMT"), Some(0));
        assert_eq!(parse_http_date("Sat, 29 Feb 2000 00:00:00 GMT"), Some(951_782_400));
    }

    #[test]
    fn a_date_retry_after_is_slept_on_the_test_clock() {
        let (_, _, calls, sleeps) = run(vec![raw(503, Some("Thu, 12 Nov 2026 05:00:02 GMT"), ""), raw(200, None, "{}")], 12_000);
        assert_eq!(calls, 2);
        assert_eq!(sleeps, vec![Duration::from_secs(2)]);
    }

    #[test]
    fn waits_and_request_time_stay_inside_the_budget() {
        // Three slow 503s with the longest wait: 3 s + 5 s wait + (4 s left of budget) ends at the budget.
        let (reply, _, calls, sleeps, end) = run_on(vec![raw(503, Some("5"), ""), raw(503, Some("5"), ""), raw(503, Some("5"), "")], 12_000, 4_000);
        assert!(end <= 12_000, "ended at {end} ms");
        assert!(calls >= 2 && calls <= 3);
        assert!(sleeps.iter().all(|d| *d <= Duration::from_secs(5)));
        assert!(matches!(reply, GraphReply::Transient(_)));
        // A request given only what is left of the budget never overshoots it.
        let (_, _, _, _, end) = run_on(vec![raw(503, Some("1"), ""), raw(503, Some("1"), ""), raw(503, Some("1"), "")], 5_000, 10_000);
        assert!(end <= 5_000, "ended at {end} ms");
    }

    #[test]
    fn a_wait_that_does_not_fit_in_the_budget_is_not_taken() {
        let (reply, _, calls, sleeps) = run(vec![raw(503, Some("5"), UNKNOWN)], 1_000);
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
    fn network_failures_are_classified_from_kinds_not_text() {
        use std::io::ErrorKind as K;
        assert_eq!(classify_net(NetKind::Dns, None), "dns");
        assert_eq!(classify_net(NetKind::Dns, Some(K::TimedOut)), "dns");
        assert_eq!(classify_net(NetKind::Connect, Some(K::TimedOut)), "timeout");
        assert_eq!(classify_net(NetKind::Io, Some(K::WouldBlock)), "timeout");
        assert_eq!(classify_net(NetKind::Io, Some(K::ConnectionReset)), "reset");
        assert_eq!(classify_net(NetKind::Io, Some(K::UnexpectedEof)), "reset");
        assert_eq!(classify_net(NetKind::Io, Some(K::InvalidData)), "other");
        assert_eq!(classify_net(NetKind::Connect, Some(K::ConnectionRefused)), "connect");
        assert_eq!(classify_net(NetKind::Connect, None), "connect");
        assert_eq!(classify_net(NetKind::Io, Some(K::PermissionDenied)), "other");
        assert_eq!(classify_net(NetKind::Other, None), "other");
    }

    #[test]
    fn a_network_failure_logs_its_class_and_host() {
        let (reply, diag, _, _) = run(vec![raw(0, None, "")], 12_000);
        assert!(matches!(reply, GraphReply::Transient(ref w) if w == "graph-network"));
        let f = diag.unwrap().log_fields();
        assert!(f.contains("host=graph status=network net=connect af=unknown"), "{f}");
    }

    #[test]
    fn log_fields_hold_the_listed_values_and_nothing_else() {
        let (_, diag, _, _) = run(vec![raw(503, None, UNKNOWN), raw(503, None, UNKNOWN), raw(503, None, UNKNOWN)], 12_000);
        let mut d = diag.unwrap();
        d.elapsed_ms = 4210;
        assert_eq!(
            d.log_fields(),
            "req=next host=graph status=503 net=none af=unknown code=UnknownError inner=InnerThing request-id=11111111-2222-3333-4444-555555555555 client-request-id=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee attempt=3 ms=4210 phase=none resolved=0 dns-ms=none v4=none v6=none"
        );
        assert!(!d.log_fields().contains("secret"));
    }

    #[test]
    fn hostile_ids_and_codes_are_not_logged() {
        let d = Diag {
            kind: Kind::Day,
            host: "login",
            net: Some("dns"),
            status: 0,
            code: Some("a@b.example".into()),
            inner: Some("x y".into()),
            request_id: Some("https://example.test/?q=1".into()),
            client_request_id: None,
            attempt: 1,
            elapsed_ms: 5,
            probe: None,
        };
        assert_eq!(d.log_fields(), "req=day host=login status=network net=dns af=unknown code=none inner=none request-id=none client-request-id=none attempt=1 ms=5 phase=none resolved=0 dns-ms=none v4=none v6=none");
    }

    #[test]
    fn the_request_uses_only_documented_options_and_utc_times() {
        let url = calendar_view_url("2026-11-12T17:00:00Z", "2026-11-13T17:00:00Z");
        assert_eq!(
            url,
            "https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=2026-11-12T17%3A00%3A00Z&endDateTime=2026-11-13T17%3A00%3A00Z&$select=id,subject,start,end,isAllDay,isCancelled,responseStatus,onlineMeeting,onlineMeetingUrl,iCalUId,webLink,organizer,attendees,bodyPreview&$orderby=start/dateTime&$top=50&$expand=singleValueExtendedProperties%28%24filter%3Did%20eq%20%27Binary%200x0FFF%27%29"
        );
        let names: Vec<&str> = url.split_once('?').unwrap().1.split('&').map(|p| p.split('=').next().unwrap()).collect();
        assert_eq!(names, ["startDateTime", "endDateTime", "$select", "$orderby", "$top", "$expand"]);
        assert_eq!(calendar_view_url_without_expand("2026-11-12T17:00:00Z", "2026-11-13T17:00:00Z"), url.split("&$expand=").next().unwrap());
        // The day read keeps the plain fields: no people, no invite text.
        let day = calendar_view_url_day("2026-11-12T17:00:00Z", "2026-11-13T17:00:00Z");
        assert_eq!(day, url.replace(SELECT_DETAILS, SELECT));
        assert!(!day.contains("attendees") && !day.contains("bodyPreview") && !day.contains("organizer"));
        assert_eq!(calendar_view_url_day_without_expand("2026-11-12T17:00:00Z", "2026-11-13T17:00:00Z"), day.split("&$expand=").next().unwrap());
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
            web: None,
            entry: None,
            details: None,
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

    #[test]
    fn web_link_is_kept_only_when_allowed() {
        let mut e = event("m", "2026-11-12T17:00:00.0000000", "1");
        e["webLink"] = json!("https://outlook.office365.com/owa/?itemid=AAMkAGI1&exvsurl=1&path=/calendar/item");
        let mut z = event("z", "2026-11-12T17:00:00.0000000", "2");
        z["webLink"] = json!("https://evil.example/owa/?itemid=x");
        let n = event("n", "2026-11-12T17:00:00.0000000", "3");
        let out = shape_events(&json!({ "value": [e, z, n] }), "work");
        assert_eq!(out[0].web.as_deref(), Some("https://outlook.office365.com/owa/?itemid=AAMkAGI1&exvsurl=1&path=/calendar/item"));
        assert!(out[1].web.is_none());
        assert!(out[2].web.is_none());
    }

    #[test]
    fn the_event_address_is_built_from_the_id_and_encoded() {
        assert_eq!(event_link("AAMkAGI1-x_y", None).as_deref(), Some("https://outlook.office.com/calendar/item/AAMkAGI1-x_y"));
        assert_eq!(event_link("a/b+c=", None).as_deref(), Some("https://outlook.office.com/calendar/item/a%2Fb%2Bc%3D"));
        assert!(web_link_allowed(&event_link("AAMk/x+y==", None).unwrap()));
    }

    #[test]
    fn a_personal_account_link_picks_the_personal_host_and_a_hostile_one_does_not() {
        let live = Some("https://outlook.live.com/owa/?itemid=zz&exvsurl=1&path=/calendar/item");
        assert_eq!(event_link("AAMk/1=", live).as_deref(), Some("https://outlook.live.com/calendar/item/AAMk%2F1%3D"));
        let work = Some("https://outlook.office365.com/owa/?itemid=zz");
        assert_eq!(event_link("AAMk", work).as_deref(), Some("https://outlook.office.com/calendar/item/AAMk"));
        for hostile in [
            "https://evil.example/owa/?itemid=zz",
            "https://outlook.live.com.evil.example/owa/",
            "https://outlook.live.com@evil.example/owa/",
            "http://outlook.live.com/owa/",
            "https://outlook.live.com:8443/owa/",
        ] {
            assert_eq!(event_link("AAMk", Some(hostile)).as_deref(), Some("https://outlook.office.com/calendar/item/AAMk"), "{hostile}");
        }
    }

    #[test]
    fn an_odd_or_long_event_id_is_refused() {
        assert!(event_link("", None).is_none());
        assert!(event_link(&"a".repeat(401), None).is_none());
        assert!(event_link(&"a".repeat(400), None).is_some());
        for bad in ["a b", "a?b", "a#b", "a%2Fb", "a\\b", "a\nb", "..", "a.b", "\u{e9}"] {
            assert!(event_link(bad, None).is_none(), "should refuse {bad:?}");
        }
    }

    #[test]
    fn shaping_prefers_the_built_address_and_falls_back_to_the_web_link() {
        let mut with_id = event("k", "2026-11-12T18:00:00.0000000", "4");
        with_id["id"] = json!("AAMk/1=");
        with_id["webLink"] = json!("https://outlook.office365.com/owa/?itemid=zz&exvsurl=1&path=/calendar/item");
        let mut no_id = event("k", "2026-11-12T19:00:00.0000000", "5");
        no_id["webLink"] = json!("https://outlook.office365.com/owa/?itemid=zz&exvsurl=1&path=/calendar/item");
        let mut odd_id = event("k", "2026-11-12T20:00:00.0000000", "6");
        odd_id["id"] = json!("a b");
        odd_id["webLink"] = json!("https://evil.example/x");
        let out = shape_events(&json!({ "value": [with_id, no_id, odd_id] }), "work");
        assert_eq!(out[0].web.as_deref(), Some("https://outlook.office.com/calendar/item/AAMk%2F1%3D"));
        assert_eq!(out[1].web.as_deref(), Some("https://outlook.office365.com/owa/?itemid=zz&exvsurl=1&path=/calendar/item"));
        assert_eq!(out[2].web, None);
    }

    #[test]
    fn entry_id_is_bounded_base64_and_uppercase_hex() {
        use base64::Engine;
        let encoded = |size| base64::engine::general_purpose::STANDARD.encode((0..size).map(|n| n as u8).collect::<Vec<_>>());
        assert!(entry_hex(&encoded(19)).is_none());
        assert_eq!(entry_hex(&encoded(20)).unwrap(), "000102030405060708090A0B0C0D0E0F10111213");
        assert_eq!(entry_hex(&encoded(512)).unwrap().len(), 1024);
        assert!(entry_hex(&encoded(513)).is_none());
        assert!(entry_hex("").is_none());
        assert!(entry_hex("not base64").is_none());
    }

    #[test]
    fn shaping_reads_only_the_entry_id_property() {
        use base64::Engine;
        let unrelated = base64::engine::general_purpose::STANDARD.encode([0xCD; 20]);
        let value = base64::engine::general_purpose::STANDARD.encode([0xAB; 20]);
        let mut row = event("k", "2026-11-12T18:00:00.0000000", "4");
        row["singleValueExtendedProperties"] = json!([
            { "id": "Binary 0x1234", "value": unrelated },
            { "id": "binary 0x0fff", "value": value }
        ]);
        let out = shape_events(&json!({ "value": [row] }), "work");
        assert_eq!(out[0].entry.as_deref(), Some("ABABABABABABABABABABABABABABABABABABABAB"));
    }

    #[test]
    fn entry_property_id_matches_the_numeric_tag() {
        for good in ["Binary 0x0FFF", "binary 0xfff", "BINARY 0x00000FFF"] {
            assert!(is_entry_property_id(good), "refused {good}");
        }
        for bad in ["Binary 0x0FFE", "String 0x0FFF", "Binary", "junk", "Binary 0xZZZZ"] {
            assert!(!is_entry_property_id(bad), "accepted {bad}");
        }
    }

    #[test]
    fn candidate_debug_redacts_the_entry_id() {
        let mut row = event("k", "2026-11-12T18:00:00.0000000", "4");
        row["singleValueExtendedProperties"] = json!([{ "id": "Binary 0x0FFF", "value": "q6urq6urq6urq6urq6urq6urq6s=" }]);
        let text = format!("{:?}", shape_events(&json!({ "value": [row] }), "work")[0]);
        assert!(!text.contains("ABABAB"));
        assert!(text.contains("<redacted>"));
    }

    #[test]
    fn web_link_allowlist_accepts_outlook_hosts() {
        assert!(web_link_allowed("https://outlook.office.com/calendar/item/AAMkAGI1"));
        assert!(web_link_allowed("https://outlook.office365.com/owa/?itemid=AAMkAGI1&exvsurl=1&path=/calendar/item"));
        assert!(web_link_allowed("https://outlook.live.com/owa/?itemid=AQMkADAw&exvsurl=1&path=/calendar/item"));
        assert!(web_link_allowed("https://outlook.cloud.microsoft/calendar/item/AAMkAGI1"));
        assert!(web_link_allowed("https://Outlook.Office.com/calendar/item/x"));
        assert!(web_link_allowed("https://outlook.office.com:443/calendar/item/x"));
    }

    #[test]
    fn web_link_allowlist_rejects_everything_else() {
        let long = format!("https://outlook.office.com/calendar/item/{}", "a".repeat(4097));
        let bad = [
            "http://outlook.office.com/calendar/item/x",
            "https://evil.example/calendar/item/x",
            "https://outlook.office.com.evil.example/calendar/item/x",
            "https://evil.example/outlook.office.com/calendar/item/x",
            "https://outlook.office.com@evil.example/",
            "https://user:pw@outlook.office.com/calendar/item/x",
            "https://user@outlook.office.com/calendar/item/x",
            "https://outlook.office.com:8443/calendar/item/x",
            "https://sub.outlook.office.com/calendar/item/x",
            "https://outlook.office.com/calendar/item/x y",
            "https://outlook.office.com/calendar/item/x\ty",
            "https://outlook.office.com/calendar/item/x\\y",
            "https://outlook.office.com/calendar/item/x\u{7}",
            "javascript:alert(1)",
            "",
            long.as_str(),
        ];
        for url in bad {
            assert!(!web_link_allowed(url), "should reject {url}");
        }
    }

    // Section: details tests (invented people and invites only)

    fn event_with(extra: Value) -> Value {
        let mut e = json!({
            "subject": "Planning",
            "start": { "dateTime": "2026-11-12T17:00:00.0000000" },
            "end": { "dateTime": "2026-11-12T18:00:00.0000000" },
            "isAllDay": false, "isCancelled": false,
            "responseStatus": { "response": "accepted" }
        });
        for (k, v) in extra.as_object().unwrap() {
            e[k] = v.clone();
        }
        e
    }

    fn attendee(name: &str, address: &str, response: &str) -> Value {
        json!({ "type": "required", "status": { "response": response, "time": "0001-01-01T00:00:00Z" }, "emailAddress": { "name": name, "address": address } })
    }

    fn details_of(extra: Value) -> Option<Details> {
        let body = json!({ "value": [event_with(extra)] });
        shape_events(&body, "work").remove(0).details
    }

    #[test]
    fn an_event_without_the_wider_fields_has_no_details() {
        assert_eq!(details_of(json!({})), None);
        // Fields present but empty: nothing to show, so null too.
        assert_eq!(details_of(json!({ "attendees": [], "bodyPreview": "" })), None);
    }

    #[test]
    fn people_are_names_and_replies_never_addresses() {
        let d = details_of(json!({
            "organizer": { "emailAddress": { "name": "Avery Example", "address": "avery@example.test" } },
            "attendees": [
                attendee("Avery Example", "avery@example.test", "organizer"),
                attendee("Blake Sample", "blake@sample.test", "accepted"),
                attendee("Lee Demo", "lee@demo.test", "tentativelyAccepted"),
                attendee("Jo Mock", "jo@mock.test", "declined"),
                attendee("Sam Fake", "sam@fake.test", "notResponded"),
            ]
        }))
        .unwrap();
        assert_eq!(d.called_by.as_deref(), Some("Avery Example"));
        let got: Vec<(&str, &str)> = d.people.iter().map(|p| (p.name.as_str(), p.reply)).collect();
        assert_eq!(got, [("Avery Example", "organizer"), ("Blake Sample", "yes"), ("Lee Demo", "maybe"), ("Jo Mock", "no"), ("Sam Fake", "none")]);
        assert_eq!(d.people_more, 0);
        let wire = serde_json::to_string(&d).unwrap();
        assert!(!wire.contains('@') && !wire.contains("example.test") && !wire.contains(".test"), "{wire}");
        assert!(wire.contains("\"calledBy\"") && wire.contains("\"peopleMore\""));
    }

    #[test]
    fn the_organizer_is_listed_once_even_when_the_attendees_leave_them_out() {
        let d = details_of(json!({
            "organizer": { "emailAddress": { "name": "Avery Example", "address": "avery@example.test" } },
            "attendees": [attendee("Blake Sample", "blake@sample.test", "accepted")]
        }))
        .unwrap();
        assert_eq!(d.people.len(), 2);
        assert_eq!(d.people[0], Person { name: "Avery Example".into(), reply: "organizer" });
    }

    #[test]
    fn a_name_that_is_an_address_or_empty_is_counted_not_listed() {
        let d = details_of(json!({
            "attendees": [
                attendee("alex@corp.test", "alex@corp.test", "accepted"),
                attendee("", "blank@corp.test", "accepted"),
                attendee("   ", "space@corp.test", "none"),
                attendee("Blake Sample", "blake@sample.test", "accepted"),
                json!({ "type": "required" }),
            ]
        }))
        .unwrap();
        assert_eq!(d.people.len(), 1);
        assert_eq!(d.people_more, 4);
        assert_eq!(clean_name("see www.corp.test"), None);
        assert_eq!(clean_name("https://corp.test/x"), None);
    }

    #[test]
    fn names_lose_control_characters_and_stop_at_sixty() {
        assert_eq!(clean_name("Blake\u{0}\u{7}\n  Sample\t"), Some("Blake Sample".into()));
        let long = "N".repeat(90);
        assert_eq!(clean_name(&long).unwrap().chars().count(), MAX_NAME_CHARS);
        assert_eq!(clean_name("\u{1}\u{2}"), None);
    }

    #[test]
    fn at_most_twenty_people_and_the_rest_are_counted() {
        let rows: Vec<Value> = (0..27).map(|n| attendee(&format!("Person {n}"), &format!("p{n}@corp.test"), "accepted")).collect();
        let d = details_of(json!({ "attendees": rows })).unwrap();
        assert_eq!(d.people.len(), MAX_PEOPLE);
        assert_eq!(d.people_more, 7);
        assert_eq!(d.people[19].name, "Person 19");
    }

    const TEAMS_INVITE: &str = "Agenda: capacity sizing and the cost estimate.\r\nPlease read the draft first.\r\n\r\n________________________________________________________________________________\r\nMicrosoft Teams meeting\r\nJoin: https://teams.example.test/l/meetup-join/19%3ameeting_SECRETTOKEN/0\r\nMeeting ID: 123 456 789 012\r\nPasscode: aB3dEf";
    const ZOOM_INVITE: &str = "Quick intro and a look at the depot list. Notes at www.docs.example.test/notes or mail ana@corp.test\r\nJoin Zoom Meeting\r\nhttps://zoom.example.test/j/98765432101?pwd=SECRETPWD\r\nMeeting ID: 987 6543 2101\r\nPasscode: 424242";

    #[test]
    fn a_teams_invite_keeps_the_agenda_and_drops_the_join_block() {
        let text = clean_invite(TEAMS_INVITE).unwrap();
        assert_eq!(text, "Agenda: capacity sizing and the cost estimate. Please read the draft first.");
        for secret in ["https", "teams.example", "SECRETTOKEN", "123 456", "Passcode", "aB3dEf", "Microsoft Teams", "____"] {
            assert!(!text.contains(secret), "{secret} reached the answer");
        }
    }

    #[test]
    fn a_zoom_invite_keeps_the_words_and_never_the_link_id_or_passcode() {
        let text = clean_invite(ZOOM_INVITE).unwrap();
        assert_eq!(text, "Quick intro and a look at the depot list. Notes at or mail");
        for secret in ["zoom.example", "SECRETPWD", "9876543", "987 6543", "424242", "Passcode", "www.", "@"] {
            assert!(!text.contains(secret), "{secret} reached the answer");
        }
        let d = details_of(json!({ "bodyPreview": ZOOM_INVITE })).unwrap();
        let wire = serde_json::to_string(&d).unwrap();
        assert!(!wire.contains("SECRETPWD") && !wire.contains("424242") && !wire.contains("zoom.example"), "{wire}");
    }

    #[test]
    fn each_cut_marker_ends_the_invite_and_a_bare_join_block_leaves_nothing() {
        for marker in ["Microsoft Teams", "Join on your computer", "Join Zoom", "Meeting ID", "Passcode", "Dial in:"] {
            let raw = format!("Words before.\r\nthing {marker} here\r\nWords after.");
            assert_eq!(clean_invite(&raw).as_deref(), Some("Words before."), "{marker}");
        }
        assert_eq!(clean_invite("Words before.\n________\nWords after.").as_deref(), Some("Words before."));
        assert_eq!(clean_invite("Words 7_______ stay.").as_deref(), Some("Words 7_______ stay."));
        assert_eq!(clean_invite("Microsoft Teams meeting\r\nhttps://t.example.test/x"), None);
        assert_eq!(clean_invite("  \r\n  "), None);
        assert_eq!(clean_invite("https://a.example.test www.b.example.test c@d.test"), None);
    }

    #[test]
    fn the_invite_stops_at_four_hundred_characters_and_collapses_whitespace() {
        let raw = format!("a   b\t\tc {}", "word ".repeat(200));
        let text = clean_invite(&raw).unwrap();
        assert!(text.starts_with("a b c word"));
        assert!(text.chars().count() <= MAX_INVITE_CHARS);
        assert!(!text.contains("  "));
    }

    #[test]
    fn debug_output_of_a_candidate_hides_the_details() {
        let d = details_of(json!({ "organizer": { "emailAddress": { "name": "Avery Example", "address": "m@example.test" } } }));
        let mut c = cand(None, "2026-11-12T18:00:00Z", "work");
        c.details = d;
        assert!(!format!("{c:?}").contains("Avery"));
    }

    // Section: the cleaner on other services' invites and on hostile text (invented tokens, ids and hosts)

    /// The final serialized `details` for an event with this body preview and organizer name.
    fn wire_of(body: &str, organizer: &str) -> String {
        let d = details_of(json!({ "bodyPreview": body, "organizer": { "emailAddress": { "name": organizer, "address": "org@host.example" } } }));
        serde_json::to_string(&d).unwrap()
    }

    fn assert_none_of(wire: &str, secrets: &[&str]) {
        for secret in secrets {
            assert!(!wire.contains(secret), "{secret} reached the answer: {wire}");
        }
    }

    #[test]
    fn a_google_meet_invite_keeps_nothing_of_the_room_the_number_or_the_pin() {
        let invite = "Planning sync for the quarter.\r\nJoin with Google Meet\r\nhttps://meet.example/abc-defg-hij\r\nOr dial: (US) +1 555-123-4567 PIN: 123456789#";
        // "Join with Google Meet" is an everyday phrase on a line of its own (no colon, no digit after it): it stays, the link line and the
        // number line after it do not.
        assert_eq!(clean_invite(invite).as_deref(), Some("Planning sync for the quarter. Join with Google Meet"));
        // A bare link before any marker, and a number alone on a line.
        let bare = "Agenda first.\r\nRoom: meet.example/abc-defg-hij\r\nDial +1 555 123 4567 then 987654321";
        assert_eq!(clean_invite(bare).as_deref(), Some("Agenda first. Room:"));
        let wire = wire_of(invite, "Avery Example");
        assert_none_of(&wire, &["meet.example", "abc-defg-hij", "555", "123456789", "PIN", "https", "dial"]);
        assert_none_of(&wire_of(bare, "Avery Example"), &["meet.example", "abc-defg-hij", "555", "987654321"]);
    }

    #[test]
    fn a_webex_invite_keeps_nothing_of_the_number_or_the_password() {
        let invite = "Quarterly review with the team.\r\nJoin from Webex\r\nMeeting number: 2551 234 5678\r\nPassword: Tk3xYz\r\nhttps://team.webex.example/meet/avery";
        assert_eq!(clean_invite(invite).as_deref(), Some("Quarterly review with the team. Join from Webex"));
        let no_webex_word = "Quarterly review.\r\nMeeting number: 2551 234 5678\r\nPassword: Tk3xYz";
        assert_eq!(clean_invite(no_webex_word).as_deref(), Some("Quarterly review."));
        assert_none_of(&wire_of(invite, "Avery Example"), &["2551", "5678", "Tk3xYz", "team.webex", "meet/avery", "https"]);
    }

    #[test]
    fn a_german_zoom_invite_cannot_hide_behind_the_hyphen() {
        let invite = "Kurze Vorstellung der Zahlen.\r\nMeeting-ID: 912 3456 7890\r\nKenncode: 123456";
        assert_eq!(clean_invite(invite).as_deref(), Some("Kurze Vorstellung der Zahlen."));
        assert_eq!(clean_invite("Kurz.\r\nCode secret : 654321").as_deref(), Some("Kurz."));
        assert_eq!(clean_invite("Kurz.\r\nAccess code 111222").as_deref(), Some("Kurz."));
        assert_eq!(clean_invite("Kurz.\r\nConference ID 5551212").as_deref(), Some("Kurz."));
        assert_eq!(clean_invite("Kurz.\r\nJoin by phone +49 30 123456").as_deref(), Some("Kurz."));
        assert_eq!(clean_invite("Kurz.\r\nDial-in: x").as_deref(), Some("Kurz."));
        assert_eq!(clean_invite("Kurz.\r\n-::~:~::~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~::~:~::-").as_deref(), Some("Kurz."));
        assert_none_of(&wire_of(invite, "Avery Example"), &["912", "7890", "123456", "Kenncode"]);
    }

    #[test]
    fn links_with_no_scheme_phone_and_sip_addresses_and_ids_are_removed_word_by_word() {
        let text = "Notes at host.example/j/12345?x=secret and tel:+1555 and sip:room.example plus short.example/Ab3 and code 54321 end.";
        assert_eq!(clean_invite(text).as_deref(), Some("Notes at and and plus and code end."));
        // The digit rule cuts a sentence with nine or more digits, however they are spaced.
        assert_eq!(clean_invite("Fine words. Call 555 123 4567 now. Never seen.").as_deref(), Some("Fine words."));
        assert_eq!(clean_invite("Fine words. Call (555) 123-4567 now.").as_deref(), Some("Fine words."));
        assert_none_of(&wire_of(text, "Avery Example"), &["host.example", "secret", "tel:", "sip:", "short.example", "54321"]);
    }

    #[test]
    fn an_invisible_character_inside_a_scheme_or_www_cannot_hide_it() {
        for hidden in ["\u{200B}", "\u{200C}", "\u{200D}", "\u{2060}", "\u{FEFF}", "\u{202E}", "\u{200E}", "\u{00AD}"] {
            let text = format!("Words. ht{hidden}tps://secret.example/x ww{hidden}w.corp.example and ma{hidden}ry@corp.example done.");
            let got = clean_invite(&text).unwrap();
            assert_eq!(got, "Words. and done.", "hidden {hidden:?}");
            assert_none_of(&wire_of(&text, "Avery Example"), &["secret", "corp", "https", "ww"]);
        }
        // A marker split by a hidden character or a tab is still a marker.
        assert_eq!(clean_invite("Words.\nMeeting\tID: 123456").as_deref(), Some("Words."));
        assert_eq!(clean_invite("Words.\nMeet\u{200B}ing  I\u{200D}D: 1").as_deref(), Some("Words."));
        assert_eq!(clean_invite("Words.\nPASS\u{FEFF}CODE 12").as_deref(), Some("Words."));
    }

    #[test]
    fn ordinary_words_that_end_a_sentence_stay() {
        assert_eq!(clean_invite("The review will start. Bring your notes.").as_deref(), Some("The review will start. Bring your notes."));
        assert_eq!(clean_invite("Version v1.2 ships. See e.g. the list.").as_deref(), Some("Version v1.2 ships. See e.g. the list."));
        assert_eq!(clean_invite("Room 4 is booked until 11.").as_deref(), Some("Room 4 is booked until 11."));
    }

    #[test]
    fn a_name_that_is_a_bare_domain_or_hides_a_company_in_brackets_is_cleaned() {
        assert_eq!(clean_name("corp.example"), None);
        assert_eq!(clean_name("  short.example/abc "), None);
        assert_eq!(clean_name("Avery Example (Orchard Example)").as_deref(), Some("Avery Example"));
        assert_eq!(clean_name("Avery Example [Orchard Example]").as_deref(), Some("Avery Example"));
        assert_eq!(clean_name("Avery Example (Ops) (Orchard Example)").as_deref(), Some("Avery Example"));
        assert_eq!(clean_name("(Orchard Example)"), None);
        assert_eq!(clean_name("Dr. Avery Example").as_deref(), Some("Dr. Avery Example"));
        assert_eq!(clean_name("Avery Example, Orchard Example (EMEA").as_deref(), Some("Avery Example, Orchard Example (EMEA"));
        assert_eq!(clean_name("Avery\u{200B} Exa\u{200D}mple").as_deref(), Some("Avery Example"));
        let d = details_of(json!({ "organizer": { "emailAddress": { "name": "Avery Example (Orchard Example)", "address": "a@host.example" } }, "attendees": [attendee("corp.example", "x@corp.example", "accepted"), attendee("Blake Sample [Orchard]", "b@x.example", "accepted")] })).unwrap();
        let wire = serde_json::to_string(&d).unwrap();
        assert_none_of(&wire, &["Orchard", "corp.example", "@"]);
        assert_eq!(d.people.len(), 2);
        assert_eq!(d.people_more, 1);
    }

    #[test]
    fn an_organizer_beyond_the_first_twenty_attendees_is_counted_once() {
        let mut rows: Vec<Value> = (0..24).map(|n| attendee(&format!("Person {n}"), &format!("p{n}@corp.test"), "accepted")).collect();
        rows.insert(20, attendee("Avery Example", "AVERY@example.test", "accepted"));
        let d = details_of(json!({ "organizer": { "emailAddress": { "name": "Avery Example", "address": "avery@example.test" } }, "attendees": rows })).unwrap();
        assert_eq!(d.people.len(), MAX_PEOPLE);
        assert_eq!(d.people[0], Person { name: "Avery Example".into(), reply: "organizer" });
        // 25 attendees including the organizer: 20 listed, 5 counted, 25 in all.
        assert_eq!(d.people_more, 5);
        assert_eq!(d.people.len() as u32 + d.people_more, 25);
        assert_eq!(d.people.iter().filter(|p| p.name == "Avery Example").count(), 1);
        // With the organizer absent from the attendees they are one more person.
        let d2 = details_of(json!({ "organizer": { "emailAddress": { "name": "Avery Example", "address": "avery@example.test" } }, "attendees": [attendee("Blake Sample", "b@x.test", "accepted")] })).unwrap();
        assert_eq!(d2.people.len() as u32 + d2.people_more, 2);
    }

    // Section: round 2 of the cleaner

    #[test]
    fn more_markers_cut_in_other_languages() {
        for line in ["Passwort: x", "Kennwort x1", "C\u{f3}digo de acceso 77", "Contrase\u{f1}a: x", "Mot de passe: x", "Senha: x", "PW: x", "pwd x", "Password: AbCd1234", "Dial-in: x", "PIN 1234", "Google Meet x1"] {
            let text = format!("Kurz.\r\n{line}\r\nNach dem Block.");
            assert_eq!(clean_invite(&text).as_deref(), Some("Kurz."), "{line}");
        }
    }

    #[test]
    fn everyday_words_do_not_wipe_a_sentence_that_only_mentions_them() {
        let agenda = "Agenda: rotate the shared password list, then Webex licences.";
        assert_eq!(clean_invite(agenda).as_deref(), Some(agenda));
        assert_eq!(clean_invite("Agenda: the pin on the board and a dial in plan for later.").as_deref(), Some("Agenda: the pin on the board and a dial in plan for later."));
        assert_eq!(clean_invite("Please use senha or contrase\u{f1}a managers only.").as_deref(), Some("Please use senha or contrase\u{f1}a managers only."));
        // "Join the Webex meeting" and then a link line: the words before the link, and no link.
        assert_eq!(clean_invite("Join the Webex meeting\r\nhttps://team.example/meet/x").as_deref(), Some("Join the Webex meeting"));
        // A marker word that starts the line, or is followed by a colon or a word with a digit, still cuts.
        assert_eq!(clean_invite("Words.\r\nPassword: AbCd1234").as_deref(), Some("Words."));
        assert_eq!(clean_invite("Words.\r\nPassword AbCd1234").as_deref(), Some("Words."));
        assert_eq!(clean_invite("Words.\r\nThe password is x7y.").as_deref(), Some("Words."));
        assert_eq!(clean_invite("Words.\r\nThe password: hidden").as_deref(), Some("Words."));
        // Inside a longer word it is not a marker at all.
        assert_eq!(clean_invite("Words.\r\nSpinning wheels: ok").as_deref(), Some("Words. Spinning wheels: ok"));
        // The unambiguous markers cut always.
        assert_eq!(clean_invite("Words.\r\nsee the meeting id below").as_deref(), Some("Words."));
        assert_eq!(clean_invite("Words.\r\nThe passcode for this call").as_deref(), Some("Words."));
    }

    #[test]
    fn full_width_digits_and_other_scripts_count_as_digits() {
        assert_eq!(clean_invite("Fine. ID \u{ff11}\u{ff12}\u{ff13}\u{ff14}\u{ff15}\u{ff16}\u{ff17}\u{ff18}\u{ff19} here. After.").as_deref(), Some("Fine."));
        assert_eq!(clean_invite("Fine. Code \u{661}\u{662}\u{663}\u{664}\u{665}\u{666} end.").as_deref(), Some("Fine. Code end."));
        assert_eq!(clean_name("Ana \u{ff11}\u{ff12}\u{ff13}\u{ff14}\u{ff15}\u{ff16}\u{ff17}\u{ff18}\u{ff19}"), None);
    }

    #[test]
    fn other_dots_and_invisible_marks_cannot_hide_a_host() {
        assert_eq!(clean_invite("Words. see meet\u{2024}example/abc and meet\u{ff0e}example now.").as_deref(), Some("Words. see and now."));
        // The ideographic full stop ends a sentence of running text; only ASCII letters after it make a host.
        let ja = "\u{4f1a}\u{8b70}\u{306e}\u{8cc7}\u{6599}\u{3092}\u{78ba}\u{8a8d}\u{3057}\u{3066}\u{304f}\u{3060}\u{3055}\u{3044}\u{3002}\u{6b21}\u{306e}\u{8b70}\u{984c}";
        assert_eq!(clean_invite(ja).as_deref(), Some(ja));
        assert_eq!(clean_invite("Words. go\u{3002}example/abc end.").as_deref(), Some("Words. end."));
        assert_eq!(clean_invite("Words. ht\u{34f}tps://x.example/y and ww\u{e0001}w.corp.example end.").as_deref(), Some("Words. and end."));
        assert_eq!(clean_name("Ana corp\u{2024}example"), None);
        assert_eq!(clean_name("A\u{34f}na\u{e0041} Example").as_deref(), Some("Ana Example"));
    }

    #[test]
    fn a_meeting_code_shaped_word_is_dropped() {
        assert_eq!(clean_invite("Room abc-defg-hij now.").as_deref(), Some("Room now."));
        assert_eq!(clean_invite("Room (abc-defg-hij), now.").as_deref(), Some("Room now."));
        assert_eq!(clean_invite("The well-known-fact stays: a-bcd-ef too.").as_deref(), Some("The well-known-fact stays: a-bcd-ef too."));
    }

    #[test]
    fn digit_groups_that_total_seven_or_more_are_dropped_as_one_run() {
        assert_eq!(clean_invite("Ref 1234 5678 done.").as_deref(), Some("Ref done."));
        assert_eq!(clean_invite("Ref 123-4567 done.").as_deref(), Some("Ref done."));
        assert_eq!(clean_invite("Ref 123.456.7890 done.").as_deref(), Some("Ref done."));
        assert_eq!(clean_invite("Ref 123, 456, 78 done.").as_deref(), Some("Ref 123, 456, 78 done."));
        // Everyday numbers survive.
        let ok = "Meet at 10:30 in 2026 for $1,250 by 4.12 with 3 or 12 people.";
        assert_eq!(clean_invite(ok).as_deref(), Some(ok));
        // A long price is a five-digit word and goes (best effort, the safe side).
        assert_eq!(clean_invite("Budget 1,250,000 later.").as_deref(), Some("Budget later."));
        assert_eq!(clean_invite("Items 12-34 and 12 34 56 stay.").as_deref(), Some("Items 12-34 and 12 34 56 stay."));
    }

    #[test]
    fn a_name_with_any_host_shaped_word_or_a_phone_number_is_no_name() {
        assert_eq!(clean_name("Join meet.example/j/abc"), None);
        assert_eq!(clean_name("Ana corp.example"), None);
        assert_eq!(clean_name("+1 555 123 4567"), None);
        assert_eq!(clean_name("Ana 555 1234"), Some("Ana 555 1234".into()));
        assert_eq!(clean_name("Dr. Avery Example").as_deref(), Some("Dr. Avery Example"));
        assert_eq!(clean_name("J.R. Smith").as_deref(), Some("J.R. Smith"));
        assert_eq!(clean_name("St. John"), Some("St. John".into()));
    }
}
