//! The meeting brief: plumbing only (no page uses it yet).
//!
//! The PC sends the brief helper one thing about a meeting: a key, `k`, made from the meeting's
//! iCalUId and the brief token (see `brief_key`). It sends no title, name, address or domain.
//! The helper answers with text and opaque `open` ids; Rust shapes the answer into `BriefOut`,
//! builds every link itself and keeps each behind a key (`b<read>-<n>`), so no URL, token or id
//! ever reaches the web view. Brief data lives only in the answer (and the link map, replaced
//! on each read); nothing is written to disk and nothing is logged. Error words are fixed:
//! `not-configured`, `invalid-config`, `not-set-up`, `forbidden`, `gone`, `failed`.
//!
//! The token is never sent anywhere but a checked `https://<name>.ts.net:<port>/` helper.

use super::graph::normalize;
use hmac::{Hmac, Mac};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

const NOT_CONFIGURED: &str = "not-configured";
const INVALID_CONFIG: &str = "invalid-config";
const NOT_SET_UP: &str = "not-set-up";
const FORBIDDEN: &str = "forbidden";
const GONE: &str = "gone";
const FAILED: &str = "failed";

/// The helper's answer is read up to this many bytes; one more and the read fails.
pub(crate) const MAX_ANSWER: usize = 64 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(10);

pub(crate) const MAX_PEOPLE: usize = 8;
pub(crate) const MAX_DEALS: usize = 5;
pub(crate) const MAX_ITEMS: usize = 40;
pub(crate) const MAX_TITLE: usize = 120;
pub(crate) const MAX_PREVIEW: usize = 200;
pub(crate) const MAX_ACTIONS: usize = 5;
pub(crate) const MAX_ACTION: usize = 120;
const MAX_SHORT: usize = 60;
const MAX_URL: usize = 2048;
/// How many raw entries of one list are looked at, so work stays bounded whatever the answer holds.
const SCAN: usize = 200;

// Section: config (feeds.json, the same file as `omniHelperUrl`)

/// The brief's settings from `feeds.json`. Never printed: `Debug` shows only counts.
#[derive(Clone, PartialEq)]
pub(crate) struct BriefConfig {
    /// `https://<name>.ts.net:<port>`, no trailing slash.
    pub base: String,
    /// HubSpot portal id (digits), when a HubSpot link may be built.
    pub portal: Option<String>,
    /// Exact lowercase hostnames a file or folder link may point at.
    pub file_hosts: Vec<String>,
}

impl std::fmt::Debug for BriefConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BriefConfig").field("portal", &self.portal.is_some()).field("file_hosts", &self.file_hosts.len()).finish()
    }
}

/// One DNS label: 1 to 63 letters, digits or hyphens, not starting or ending with a hyphen.
fn valid_label(label: &str) -> bool {
    (1..=63).contains(&label.len())
        && !label.starts_with('-')
        && !label.ends_with('-')
        && label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// A hostname of dot separated labels, 253 characters at most.
fn valid_hostname(host: &str) -> bool {
    !host.is_empty() && host.len() <= 253 && host.split('.').all(valid_label)
}

/// The brief helper's address: https, a host that ends in `.ts.net` with at least one label
/// before it, an explicit port 1 to 65535, and nothing after the authority but an optional
/// `/`. No userinfo, query, fragment, backslash, whitespace or control character. Returns the
/// checked base `https://<host>:<port>` (host in lowercase). A new check on purpose: it is not
/// `wall2_desk::token_may_go_to`, which lets a token go to any https host.
pub(crate) fn parse_helper_url(raw: &str) -> Option<String> {
    if raw.is_empty() || raw.len() > 300 || !raw.is_ascii() || raw.bytes().any(|b| !b.is_ascii_graphic()) {
        return None;
    }
    let lower = raw.to_ascii_lowercase();
    let rest = lower.strip_prefix("https://")?;
    let rest = rest.strip_suffix('/').unwrap_or(rest);
    // Anything left that is not `host:port` (a path, `?`, `#`, `@`, `\`, `[`) is refused below.
    let (host, port) = rest.rsplit_once(':')?;
    if port.is_empty() || port.len() > 5 || !port.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let n: u32 = port.parse().ok()?;
    if n == 0 || n > 65535 {
        return None;
    }
    let before = host.strip_suffix(".ts.net")?;
    if !valid_hostname(host) || !valid_hostname(before) {
        return None;
    }
    Some(format!("https://{host}:{n}"))
}

/// The portal id: a string of 1 to 20 digits, or a JSON integer.
fn portal_of(v: &Value) -> Option<String> {
    match v {
        Value::String(s) if (1..=20).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit()) => Some(s.clone()),
        Value::Number(n) => n.as_u64().map(|n| n.to_string()),
        _ => None,
    }
}

/// Parse `feeds.json` text for the brief. Never echoes file content in an error.
pub(crate) fn parse_config(text: Option<&str>) -> Result<BriefConfig, &'static str> {
    let text = text.ok_or(NOT_CONFIGURED)?;
    let value: Value = serde_json::from_str(text).map_err(|_| INVALID_CONFIG)?;
    let url = match value.get("briefHelperUrl") {
        None | Some(Value::Null) => return Err(NOT_CONFIGURED),
        Some(Value::String(s)) if s.trim().is_empty() => return Err(NOT_CONFIGURED),
        Some(Value::String(s)) => s,
        Some(_) => return Err(INVALID_CONFIG),
    };
    let base = parse_helper_url(url).ok_or(INVALID_CONFIG)?;
    let portal = match value.get("hubspotPortalId") {
        None | Some(Value::Null) => None,
        Some(v) => Some(portal_of(v).ok_or(INVALID_CONFIG)?),
    };
    let file_hosts = match value.get("briefFileHosts") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(rows)) if rows.len() <= 20 => {
            let mut out: Vec<String> = Vec::new();
            for row in rows {
                let host = row.as_str().map(str::to_ascii_lowercase).filter(|h| valid_hostname(h)).ok_or(INVALID_CONFIG)?;
                if !out.contains(&host) {
                    out.push(host);
                }
            }
            out
        }
        Some(_) => return Err(INVALID_CONFIG),
    };
    Ok(BriefConfig { base, portal, file_hosts })
}

fn load_config(window: &tauri::WebviewWindow) -> Result<BriefConfig, &'static str> {
    let dir = window.path().app_config_dir().map_err(|_| NOT_CONFIGURED)?;
    let text = std::fs::read_to_string(dir.join("feeds.json")).ok();
    parse_config(text.as_deref())
}

// Section: the key

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(DIGITS[(b >> 4) as usize] as char);
        out.push(DIGITS[(b & 15) as usize] as char);
    }
    out
}

/// sha256 of the token's bytes, 32 raw bytes.
pub(crate) fn token_hash(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

/// `k`: the lowercase hex of HMAC-SHA256 (key = the token hash, message = the iCalUId's UTF-8
/// bytes), first 32 hex characters. Outsiders who know an iCalUId cannot compute it, and it
/// does not link one meeting across logs.
pub(crate) fn brief_key(token: &str, ical: &str) -> String {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&token_hash(token)).expect("HMAC takes a key of any length");
    mac.update(ical.as_bytes());
    let full = hex(&mac.finalize().into_bytes());
    full[..32].to_string()
}

// Section: text, times, shaping

/// Display text: control and invisible format characters (bidi, zero width and the like) removed,
/// whitespace collapsed, then every word that holds `://`, `www.` or `@` dropped, cut at `max`
/// characters. None when nothing is left.
pub(crate) fn clean_text(raw: &str, max: usize) -> Option<String> {
    let norm = normalize(raw);
    let words: Vec<&str> = norm
        .split_whitespace()
        .filter(|w| {
            let lower = w.to_ascii_lowercase();
            !(lower.contains("://") || lower.contains("www.") || w.contains('@'))
        })
        .collect();
    let text: String = words.join(" ").chars().take(max).collect::<String>().trim().to_string();
    (!text.is_empty()).then_some(text)
}

fn text_at(v: &Value, key: &str, max: usize) -> Option<String> {
    v.get(key).and_then(Value::as_str).and_then(|s| clean_text(s, max))
}

fn leap(y: u32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn valid_ymd(y: u32, m: u32, d: u32) -> bool {
    let days = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if leap(y) {
                29
            } else {
                28
            }
        }
        _ => return false,
    };
    (1..=days).contains(&d)
}

fn digits_at(b: &[u8], from: usize, n: usize) -> Option<u32> {
    let part = b.get(from..from + n)?;
    if !part.iter().all(u8::is_ascii_digit) {
        return None;
    }
    part.iter().fold(Some(0u32), |acc, d| acc.map(|a| a * 10 + (*d - b'0') as u32))
}

/// `YYYY-MM-DD` as a real calendar date, else None.
pub(crate) fn plain_date(s: &str) -> Option<String> {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    valid_ymd(digits_at(b, 0, 4)?, digits_at(b, 5, 2)?, digits_at(b, 8, 2)?).then(|| s.to_string())
}

/// An RFC 3339 date-time (`2026-11-12T17:00:00Z`, optional fraction, `Z` or `+HH:MM`), else None.
pub(crate) fn rfc3339(s: &str) -> Option<String> {
    let b = s.as_bytes();
    if b.len() < 20 || b.len() > 40 || !s.is_ascii() {
        return None;
    }
    if b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' {
        return None;
    }
    if !valid_ymd(digits_at(b, 0, 4)?, digits_at(b, 5, 2)?, digits_at(b, 8, 2)?) {
        return None;
    }
    if digits_at(b, 11, 2)? > 23 || digits_at(b, 14, 2)? > 59 || digits_at(b, 17, 2)? > 60 {
        return None;
    }
    let mut i = 19;
    if b[i] == b'.' {
        i += 1;
        let start = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        if i == start || i - start > 9 {
            return None;
        }
    }
    let zone_ok = match b.get(i)? {
        b'Z' => i + 1 == b.len(),
        b'+' | b'-' => i + 6 == b.len() && b[i + 3] == b':' && digits_at(b, i + 1, 2)? <= 23 && digits_at(b, i + 4, 2)? <= 59,
        _ => false,
    };
    zone_ok.then(|| s.to_string())
}

fn time_at(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).and_then(rfc3339)
}

fn word_of(v: Option<&Value>, allowed: &[&'static str]) -> Option<&'static str> {
    let s = v.and_then(Value::as_str)?;
    allowed.iter().copied().find(|a| *a == s)
}

fn source_state(v: Option<&Value>) -> &'static str {
    word_of(v, &["ok", "empty", "not-set-up", "failed"]).unwrap_or("failed")
}

// Section: the answer for the page

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MatchOut {
    /// `client`, `internal`, `unknown`, `mixed` or `none`.
    pub kind: &'static str,
    pub label: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SourcesOut {
    pub crm: &'static str,
    pub mail: &'static str,
    pub chats: &'static str,
    pub notes: &'static str,
    pub files: &'static str,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanyOut {
    pub name: String,
    pub lifecycle: Option<String>,
    pub owner: Option<String>,
    pub last_activity: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BriefPerson {
    pub name: String,
    pub title: Option<String>,
    pub last_contact: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DealOut {
    pub name: String,
    pub stage: Option<String>,
    pub close_date: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemOut {
    pub id: String,
    /// `crm`, `mail`, `chat`, `note` or `file`.
    pub source: &'static str,
    /// `note`, `thread`, `chat`, `meeting`, `file` or `folder`.
    pub kind: &'static str,
    pub title: String,
    pub when: Option<String>,
    pub who: Option<String>,
    pub preview: Option<String>,
    pub actions: Vec<String>,
    pub recording: bool,
    pub unverified_sender: bool,
    /// `b<read>-<n>` when Rust holds a link for this item, else null. Never the link or the id.
    pub open_key: Option<String>,
}

/// What the page gets. No URL, token, address or helper id anywhere in it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BriefOut {
    /// `ready`, `building` or `none`.
    pub state: &'static str,
    pub built_at: Option<String>,
    pub start: Option<String>,
    pub stale: bool,
    #[serde(rename = "match")]
    pub matched: MatchOut,
    pub sources: SourcesOut,
    pub company: Option<CompanyOut>,
    pub people: Vec<BriefPerson>,
    pub deals: Vec<DealOut>,
    pub items: Vec<ItemOut>,
}

// Section: links (Rust builds every URL from an id; none crosses the wire)

fn enc(s: &str) -> String {
    urlencoding::encode(s).into_owned()
}

/// Mail: `https://outlook.office.com/mail/deeplink/read/<encoded id>`. The id is 1 to 512 of
/// `A-Za-z0-9+/=_-`. UNVERIFIED: this deeplink format is from memory; try it on a real message
/// and fix it here if Outlook on the web refuses it.
pub(crate) fn mail_url(id: &str) -> Option<String> {
    let ok = (1..=512).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'=' | b'_' | b'-'));
    ok.then(|| format!("https://outlook.office.com/mail/deeplink/read/{}", enc(id)))
}

/// Chat: `https://teams.microsoft.com/l/chat/<encoded id>/conversations`. The id starts with
/// `19:`, is at most 256 characters and has no whitespace or control character.
pub(crate) fn chat_url(id: &str) -> Option<String> {
    let ok = id.starts_with("19:") && id.len() <= 256 && id.bytes().all(|b| b.is_ascii_graphic());
    ok.then(|| format!("https://teams.microsoft.com/l/chat/{}/conversations", enc(id)))
}

/// HubSpot: `https://app.hubspot.com/contacts/<portal>/record/<type>/<digits>`. The object type
/// ids are contact `0-1`, company `0-2`, deal `0-3`. UNVERIFIED: from memory of HubSpot's
/// object type ids; check one record of each kind. With no portal id configured there is no link.
pub(crate) fn hubspot_url(portal: Option<&str>, object: &str, id: &str) -> Option<String> {
    let portal = portal.filter(|p| (1..=20).contains(&p.len()) && p.bytes().all(|b| b.is_ascii_digit()))?;
    let type_id = match object {
        "contact" => "0-1",
        "company" => "0-2",
        "deal" => "0-3",
        _ => return None,
    };
    let ok = (1..=20).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_digit());
    ok.then(|| format!("https://app.hubspot.com/contacts/{portal}/record/{type_id}/{id}"))
}

/// File or folder: the id is an https URL, accepted only when its host exactly equals one of
/// `hosts`, it has no userinfo, the port is 443 or absent, it is at most 2048 characters, and
/// the path starts with `/sites/`, `/personal/` or `/:`. Safe Links and other redirectors never
/// pass (their hosts are not in the list, and any `safelinks` host is refused outright).
pub(crate) fn file_url(id: &str, hosts: &[String]) -> Option<String> {
    if id.is_empty() || id.len() > MAX_URL || !id.is_ascii() || id.bytes().any(|b| !b.is_ascii_graphic() || b == b'\\') {
        return None;
    }
    let rest = id.get(..8).filter(|p| p.eq_ignore_ascii_case("https://")).map(|_| &id[8..])?;
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(end);
    if authority.contains('@') {
        return None;
    }
    let (host, port) = match authority.rsplit_once(':') {
        Some((h, p)) => (h, Some(p)),
        None => (authority, None),
    };
    if port.is_some_and(|p| p != "443") {
        return None;
    }
    let host = host.to_ascii_lowercase();
    if host.contains("safelinks") || !hosts.iter().any(|h| *h == host) {
        return None;
    }
    let path = tail.split(['?', '#']).next().unwrap_or("");
    if !(path.starts_with("/sites/") || path.starts_with("/personal/") || path.starts_with("/:")) {
        return None;
    }
    // Decode each segment strictly, then judge the decoded form: no dot segments, no encoded
    // separators, no double encoding, no redirector pages.
    let mut decoded: Vec<String> = Vec::new();
    for seg in path.split('/') {
        let seg = pct_decode_strict(seg)?;
        if seg == "." || seg == ".." || seg.contains(['/', '\\', '%']) {
            return None;
        }
        decoded.push(seg.to_ascii_lowercase());
    }
    if decoded.iter().any(|s| s == "redir.aspx" || s == "redirect.aspx") {
        return None;
    }
    if let Some(at) = decoded.iter().position(|s| s == "_layouts") {
        if decoded[at + 1..].iter().any(|s| s.ends_with("redirect.aspx")) {
            return None;
        }
    }
    let built = format!("https://{host}{tail}");
    let built_rest = &built[8..];
    let built_host = &built_rest[..built_rest.find(['/', '?', '#']).unwrap_or(built_rest.len())];
    let built_host = built_host.rsplit_once(':').map_or(built_host, |(h, _)| h);
    if !hosts.iter().any(|h| h == built_host) {
        return None;
    }
    Some(built)
}

/// Percent-decode one path segment. A `%` must be followed by two hex digits, else None. The
/// result must be valid UTF-8 with no control characters.
fn pct_decode_strict(seg: &str) -> Option<String> {
    let b = seg.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = b.get(i + 1..i + 3)?;
            let hi = (hex[0] as char).to_digit(16)?;
            let lo = (hex[1] as char).to_digit(16)?;
            out.push((hi * 16 + lo) as u8);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    let s = String::from_utf8(out).ok()?;
    (!s.chars().any(char::is_control)).then_some(s)
}

/// The URL for one item's `open` object, or None.
fn link_for(open: &Value, cfg: &BriefConfig) -> Option<String> {
    let kind = open.get("type")?.as_str()?;
    let id = open.get("id")?.as_str()?;
    match kind {
        "mail" => mail_url(id),
        "chat" => chat_url(id),
        "hubspot" => hubspot_url(cfg.portal.as_deref(), open.get("object").and_then(Value::as_str)?, id),
        "file" | "folder" => file_url(id, &cfg.file_hosts),
        _ => None,
    }
}

/// A last check on a stored URL before it opens: one of the fixed hosts with its fixed path
/// start, or a file link that still passes `file_url` for the current config.
pub(crate) fn url_still_allowed(url: &str, cfg: &BriefConfig) -> bool {
    if url.len() > MAX_URL || url.bytes().any(|b| !b.is_ascii_graphic()) {
        return false;
    }
    for (prefix, path) in [
        ("https://outlook.office.com", "/mail/deeplink/read/"),
        ("https://teams.microsoft.com", "/l/chat/"),
        ("https://app.hubspot.com", "/contacts/"),
    ] {
        if let Some(rest) = url.strip_prefix(prefix) {
            return rest.starts_with(path) && !rest.contains(['@', '\\', '#']);
        }
    }
    file_url(url, &cfg.file_hosts).is_some_and(|u| u == url || u.eq_ignore_ascii_case(url))
}

// Section: shaping

fn item_id(raw: Option<&str>, n: usize) -> String {
    match raw {
        Some(s) if (1..=32).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') => s.to_string(),
        _ => format!("i{}", n + 1),
    }
}

fn shape_item(raw: &Value, n: usize, cfg: &BriefConfig, read: u64, next_link: &mut usize, links: &mut HashMap<String, String>) -> Option<ItemOut> {
    let source = word_of(raw.get("source"), &["crm", "mail", "chat", "note", "file"])?;
    let kind = word_of(raw.get("kind"), &["note", "thread", "chat", "meeting", "file", "folder"])?;
    let title = text_at(raw, "title", MAX_TITLE)?;
    let actions: Vec<String> = raw
        .get("actions")
        .and_then(Value::as_array)
        .map(|rows| rows.iter().take(SCAN).filter_map(|a| a.as_str().and_then(|s| clean_text(s, MAX_ACTION))).take(MAX_ACTIONS).collect())
        .unwrap_or_default();
    let open_key = raw.get("open").filter(|o| o.is_object()).and_then(|o| link_for(o, cfg)).map(|url| {
        let key = format!("b{read}-{}", *next_link);
        *next_link += 1;
        links.insert(key.clone(), url);
        key
    });
    Some(ItemOut {
        id: item_id(raw.get("id").and_then(Value::as_str), n),
        source,
        kind,
        title,
        when: time_at(raw, "when"),
        who: text_at(raw, "who", MAX_SHORT),
        preview: text_at(raw, "preview", MAX_PREVIEW),
        actions,
        recording: raw.get("recording").and_then(Value::as_bool).unwrap_or(false),
        unverified_sender: raw.get("unverifiedSender").and_then(Value::as_bool).unwrap_or(false),
        open_key,
    })
}

/// The answer for a read whose body was not for the requested key: nothing but state `none`.
fn none_answer() -> BriefOut {
    BriefOut {
        state: "none",
        built_at: None,
        start: None,
        stale: false,
        matched: MatchOut { kind: "none", label: None },
        sources: SourcesOut { crm: "failed", mail: "failed", chats: "failed", notes: "failed", files: "failed" },
        company: None,
        people: Vec::new(),
        deals: Vec::new(),
        items: Vec::new(),
    }
}

/// Shape one helper answer into what the page gets, plus the links Rust keeps (key to URL).
/// Strict about types: an entry that is malformed is dropped, a bad time becomes null, a source
/// state it does not know becomes `failed`, and an unknown `state` or `match.kind` becomes
/// `none`. The answer's own `k` is required and must be the one that was asked for, else the
/// result is a plain `none` answer with nothing else.
/// True when the answer is an object whose `k` is exactly the key that was asked for.
fn k_matches(body: &Value, expected_k: &str) -> bool {
    body.get("k").and_then(Value::as_str) == Some(expected_k)
}

pub(crate) fn shape_answer(body: &Value, expected_k: &str, cfg: &BriefConfig, read: u64) -> Result<(BriefOut, HashMap<String, String>), &'static str> {
    let obj = body.as_object().ok_or(FAILED)?;
    // `k` is required and must be the one asked for; anything else is a normal "none" answer.
    if !k_matches(body, expected_k) {
        return Ok((none_answer(), HashMap::new()));
    }
    let state = word_of(obj.get("state"), &["ready", "building", "none"]).unwrap_or("none");
    let m = obj.get("match").filter(|m| m.is_object());
    let kind = word_of(m.and_then(|m| m.get("kind")), &["client", "internal", "unknown", "mixed", "none"]).unwrap_or("none");
    let src = obj.get("sources");
    let src_of = |k: &str| source_state(src.and_then(|s| s.get(k)));
    let company = obj.get("company").filter(|c| c.is_object()).and_then(|c| {
        Some(CompanyOut { name: text_at(c, "name", MAX_TITLE)?, lifecycle: text_at(c, "lifecycle", MAX_SHORT), owner: text_at(c, "owner", MAX_SHORT), last_activity: time_at(c, "lastActivity") })
    });
    let people: Vec<BriefPerson> = obj
        .get("people")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .take(SCAN)
                .filter(|p| p.is_object())
                .filter_map(|p| Some(BriefPerson { name: text_at(p, "name", MAX_TITLE)?, title: text_at(p, "title", MAX_TITLE), last_contact: time_at(p, "lastContact") }))
                .take(MAX_PEOPLE)
                .collect()
        })
        .unwrap_or_default();
    let deals: Vec<DealOut> = obj
        .get("deals")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .take(SCAN)
                .filter(|d| d.is_object())
                .filter_map(|d| {
                    Some(DealOut { name: text_at(d, "name", MAX_TITLE)?, stage: text_at(d, "stage", MAX_SHORT), close_date: d.get("closeDate").and_then(Value::as_str).and_then(plain_date) })
                })
                .take(MAX_DEALS)
                .collect()
        })
        .unwrap_or_default();
    let mut links: HashMap<String, String> = HashMap::new();
    let mut next_link = 0usize;
    let mut items: Vec<ItemOut> = Vec::new();
    if let Some(rows) = obj.get("items").and_then(Value::as_array) {
        for (n, raw) in rows.iter().take(SCAN).enumerate() {
            if items.len() >= MAX_ITEMS {
                break;
            }
            if !raw.is_object() {
                continue;
            }
            // Links are minted only for items that are kept.
            if let Some(item) = shape_item(raw, n, cfg, read, &mut next_link, &mut links) {
                items.push(item);
            }
        }
    }
    let out = BriefOut {
        state,
        built_at: time_at(body, "builtAt"),
        start: time_at(body, "start"),
        stale: obj.get("stale").and_then(Value::as_bool).unwrap_or(false),
        matched: MatchOut { kind, label: m.and_then(|m| text_at(m, "label", MAX_TITLE)) },
        sources: SourcesOut { crm: src_of("crm"), mail: src_of("mail"), chats: src_of("chats"), notes: src_of("notes"), files: src_of("files") },
        company,
        people,
        deals,
        items,
    };
    Ok((out, links))
}

// Section: the link map (replaced by each successful read, never on disk)

#[derive(Default)]
pub(crate) struct BriefLinks {
    /// The read that owns `map`.
    read: u64,
    map: HashMap<String, String>,
}

fn links() -> &'static Mutex<BriefLinks> {
    static LINKS: OnceLock<Mutex<BriefLinks>> = OnceLock::new();
    LINKS.get_or_init(|| Mutex::new(BriefLinks::default()))
}

static READS: AtomicU64 = AtomicU64::new(0);

/// A read starts: its number. The links already stored stay until a newer answer replaces them.
fn begin_read(counter: &AtomicU64) -> u64 {
    counter.fetch_add(1, Ordering::SeqCst) + 1
}

/// A read ends with a shaped answer: its links replace the stored ones, unless a newer read has
/// already stored its own. A read that fails never gets here, so the old links keep working.
fn finish_read(l: &Mutex<BriefLinks>, read: u64, map: HashMap<String, String>) {
    let mut g = l.lock().unwrap_or_else(|e| e.into_inner());
    if read > g.read {
        g.read = read;
        g.map = map;
    }
}

fn lookup_open(l: &Mutex<BriefLinks>, key: &str) -> Option<String> {
    l.lock().unwrap_or_else(|e| e.into_inner()).map.get(key).cloned()
}

/// True for exactly the shape `b<read>-<n>`: ASCII, 1 to 19 digits, `-`, 1 to 4 digits.
fn valid_open_key(key: &str) -> bool {
    let Some(rest) = key.strip_prefix('b') else { return false };
    let Some((read, n)) = rest.split_once('-') else { return false };
    let digits = |s: &str, max: usize| !s.is_empty() && s.len() <= max && s.bytes().all(|b| b.is_ascii_digit());
    key.len() <= 26 && digits(read, 19) && digits(n, 4)
}

/// True for a next-meetings key as `service::read_next_only` makes them: `<read>-<n>`.
fn valid_meeting_key(key: &str) -> bool {
    let Some((read, n)) = key.split_once('-') else { return false };
    let digits = |s: &str, max: usize| !s.is_empty() && s.len() <= max && s.bytes().all(|b| b.is_ascii_digit());
    key.len() <= 24 && digits(read, 19) && digits(n, 3)
}

// Section: fetch

/// The one call to the helper, behind a trait so the command's logic can be tested.
pub(crate) trait Helper {
    /// The body of a 2xx answer, at most `MAX_ANSWER` bytes. Errors are fixed words.
    fn get(&self, url: &str, token: &str) -> Result<Vec<u8>, &'static str>;
}

fn agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| ureq::AgentBuilder::new().timeout_connect(CONNECT_TIMEOUT).timeout(TOTAL_TIMEOUT).redirects(0).build())
}

struct HttpHelper;

/// A reader that stops after `MAX_ANSWER` plus one bytes; more than `MAX_ANSWER` fails.
fn read_capped<R: Read>(reader: R) -> Result<Vec<u8>, &'static str> {
    let mut buf = Vec::new();
    reader.take(MAX_ANSWER as u64 + 1).read_to_end(&mut buf).map_err(|_| FAILED)?;
    if buf.len() > MAX_ANSWER {
        return Err(FAILED);
    }
    Ok(buf)
}

impl Helper for HttpHelper {
    fn get(&self, url: &str, token: &str) -> Result<Vec<u8>, &'static str> {
        match agent().get(url).set("Authorization", &format!("Bearer {token}")).set("Accept", "application/json").call() {
            Ok(resp) if (200..300).contains(&resp.status()) => {
                // A declared length over the cap fails before any byte is read.
                if resp.header("content-length").and_then(|v| v.parse::<usize>().ok()).is_some_and(|n| n > MAX_ANSWER) {
                    return Err(FAILED);
                }
                read_capped(resp.into_reader())
            }
            Ok(_) => Err(FAILED),
            Err(ureq::Error::Status(401 | 403, _)) => Err(FORBIDDEN),
            Err(_) => Err(FAILED),
        }
    }
}

/// The whole read with its inputs given: config, token, iCalUId, helper and link map. Order of
/// refusals: no token (`not-set-up`), no iCalUId for the key (`gone`), then the helper.
pub(crate) fn brief_with(
    cfg: &BriefConfig,
    token: Option<&str>,
    ical: Option<&str>,
    helper: &dyn Helper,
    link_map: &Mutex<BriefLinks>,
    counter: &AtomicU64,
) -> Result<BriefOut, &'static str> {
    let token = token.ok_or(NOT_SET_UP)?;
    let ical = ical.ok_or(GONE)?;
    let k = brief_key(token, ical);
    let read = begin_read(counter);
    let bytes = helper.get(&format!("{}/wall/v1/brief?k={k}", cfg.base), token)?;
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| FAILED)?;
    let (out, links) = shape_answer(&value, &k, cfg, read)?;
    // Only an answer for this key replaces the stored links. An answer for another key (or with
    // none) reads as "none" for the page but keeps the last good keys, the same as a failed read.
    if k_matches(&value, &k) {
        finish_read(link_map, read, links);
    }
    Ok(out)
}

// Section: commands (wall2 window only; blocking work off the async thread)

/// The brief for a meeting from the last next-meetings read. `key` is that read's meeting key.
#[tauri::command]
pub async fn wall2_meet_brief(window: tauri::WebviewWindow, key: String) -> Result<BriefOut, String> {
    super::require_wall2(window.label())?;
    if !valid_meeting_key(&key) {
        return Err(GONE.to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = load_config(&window).map_err(str::to_string)?;
        let token = super::brief_token::read_token();
        let ical = super::service::lookup_ical(super::links(), &key);
        brief_with(&cfg, token.as_deref(), ical.as_deref(), &HttpHelper, links(), &READS).map_err(str::to_string)
    })
    .await
    .map_err(|_| FAILED.to_string())?
}

/// Open the link behind an item's `openKey`, after checking it once more.
#[tauri::command]
pub async fn wall2_meet_brief_open(window: tauri::WebviewWindow, open_key: String) -> Result<(), String> {
    super::require_wall2(window.label())?;
    if !valid_open_key(&open_key) {
        return Err(GONE.to_string());
    }
    let url = lookup_open(links(), &open_key).ok_or_else(|| GONE.to_string())?;
    let allowed = tauri::async_runtime::spawn_blocking({
        let window = window.clone();
        let url = url.clone();
        move || load_config(&window).map(|cfg| url_still_allowed(&url, &cfg))
    })
    .await
    .map_err(|_| FAILED.to_string())?
    .map_err(|_| GONE.to_string())?;
    if !allowed {
        return Err(GONE.to_string());
    }
    window.opener().open_url(url, None::<&str>).map_err(|_| FAILED.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const TOKEN: &str = "example-token-1234";
    const ICAL: &str = "040000008200E00074C5B7101A82E0080000000000000000000000000000000000000000310000007643616C2D55696401000000contoso-1";

    fn cfg() -> BriefConfig {
        BriefConfig { base: "https://brief-box.example.ts.net:8791".into(), portal: Some("1234567".into()), file_hosts: vec!["contoso.sharepoint.com".into()] }
    }

    /// Shapes a test body asked for with the key "k". A body with no `k` of its own gets that one,
    /// so these tests look at the shaping; the `k` rule has its own test.
    fn shape(mut body: Value) -> BriefOut {
        if let Some(obj) = body.as_object_mut() {
            obj.entry("k").or_insert_with(|| json!("k"));
        }
        shape_answer(&body, "k", &cfg(), 1).unwrap().0
    }

    // Section: config

    #[test]
    fn the_helper_url_check_accepts_only_the_exact_form() {
        for good in [
            "https://brief-box.example.ts.net:8791",
            "https://brief-box.example.ts.net:8791/",
            "HTTPS://Brief-Box.Example.TS.NET:8791",
            "https://a.ts.net:1",
            "https://a.ts.net:65535",
        ] {
            assert!(parse_helper_url(good).is_some(), "{good}");
        }
        assert_eq!(parse_helper_url("https://Brief-Box.Example.ts.net:08791/").as_deref(), Some("https://brief-box.example.ts.net:8791"));
        for bad in [
            "",
            "http://brief-box.example.ts.net:8791",
            "https://brief-box.example.ts.net",
            "https://brief-box.example.ts.net:",
            "https://brief-box.example.ts.net:0",
            "https://brief-box.example.ts.net:65536",
            "https://brief-box.example.ts.net:99999999",
            "https://brief-box.example.ts.net:+80",
            "https://brief-box.example.ts.net:8791/path",
            "https://brief-box.example.ts.net:8791//",
            "https://brief-box.example.ts.net:8791/?q=1",
            "https://brief-box.example.ts.net:8791#frag",
            "https://user@brief-box.example.ts.net:8791",
            "https://user:pw@brief-box.example.ts.net:8791",
            "https://ts.net:8791",
            "https://.ts.net:8791",
            "https://example.com:8791",
            "https://brief-box.example.ts.net.evil.example:8791",
            "https://evilts.net:8791",
            "https://brief-box.example.ts.net:8791 ",
            "https://brief box.example.ts.net:8791",
            "https://brief-box.example.ts.net:8791\\x",
            "https://[::1]:8791",
            "https://100.64.0.1:8791",
            "https://-bad.example.ts.net:8791",
            "https://bad..example.ts.net:8791",
            "https://caf\u{e9}.ts.net:8791",
        ] {
            assert!(parse_helper_url(bad).is_none(), "{bad:?}");
        }
    }

    #[test]
    fn config_words_and_the_optional_keys() {
        assert_eq!(parse_config(None), Err("not-configured"));
        assert_eq!(parse_config(Some("{}")), Err("not-configured"));
        assert_eq!(parse_config(Some("{\"briefHelperUrl\":\"  \"}")), Err("not-configured"));
        assert_eq!(parse_config(Some("not json")), Err("invalid-config"));
        assert_eq!(parse_config(Some("{\"briefHelperUrl\":5}")), Err("invalid-config"));
        assert_eq!(parse_config(Some("{\"briefHelperUrl\":\"https://example.com:1\"}")), Err("invalid-config"));
        let base = "\"briefHelperUrl\":\"https://box.example.ts.net:8791\"";
        let c = parse_config(Some(&format!("{{{base}}}"))).unwrap();
        assert_eq!((c.portal, c.file_hosts), (None, vec![]));
        let c = parse_config(Some(&format!("{{{base},\"hubspotPortalId\":\"4455\",\"briefFileHosts\":[\"Contoso.SharePoint.com\",\"contoso.sharepoint.com\",\"files.northwind.example\"]}}"))).unwrap();
        assert_eq!(c.portal.as_deref(), Some("4455"));
        assert_eq!(c.file_hosts, ["contoso.sharepoint.com", "files.northwind.example"]);
        assert_eq!(parse_config(Some(&format!("{{{base},\"hubspotPortalId\":4455}}"))).unwrap().portal.as_deref(), Some("4455"));
        for extra in [
            "\"hubspotPortalId\":\"12ab\"",
            "\"hubspotPortalId\":\"\"",
            "\"hubspotPortalId\":-5",
            "\"hubspotPortalId\":true",
            "\"briefFileHosts\":\"contoso.sharepoint.com\"",
            "\"briefFileHosts\":[5]",
            "\"briefFileHosts\":[\"https://contoso.sharepoint.com\"]",
            "\"briefFileHosts\":[\"contoso.sharepoint.com/x\"]",
            "\"briefFileHosts\":[\"user@contoso.sharepoint.com\"]",
            "\"briefFileHosts\":[\"contoso.sharepoint.com:443\"]",
        ] {
            assert_eq!(parse_config(Some(&format!("{{{base},{extra}}}"))), Err("invalid-config"), "{extra}");
        }
        // An error never echoes the file.
        assert!(!parse_config(Some("{\"briefHelperUrl\":\"SECRETSECRET\"}")).unwrap_err().contains("SECRET"));
        // Debug shows no address or host.
        assert!(!format!("{:?}", cfg()).contains("sharepoint"));
    }

    // Section: the key

    #[test]
    fn the_key_matches_the_pinned_vector() {
        assert_eq!(hex(&token_hash(TOKEN)), "7a8aac8df6a5cc5d84e738d669e7675e5d773f4e52de53d049d91b67d145ebc0");
        let k = brief_key(TOKEN, ICAL);
        assert_eq!(k, "8dd14b58bf7a23119e366045ddb77df0");
        assert_eq!(k.len(), 32);
        // A different token or iCalUId gives a different key.
        assert_ne!(brief_key("example-token-1235", ICAL), k);
        assert_ne!(brief_key(TOKEN, "other"), k);
    }

    // Section: times and text

    #[test]
    fn times_are_rfc_3339_or_nothing() {
        for good in ["2026-11-12T17:00:00Z", "2026-11-12T17:00:00.123Z", "2026-11-12T17:00:00+01:00", "2024-02-29T00:00:00-08:00", "2026-12-31T23:59:60Z"] {
            assert_eq!(rfc3339(good).as_deref(), Some(good), "{good}");
        }
        for bad in [
            "", "2026-11-12", "2026-11-12 17:00:00Z", "2026-11-12T17:00:00", "2026-13-12T17:00:00Z", "2026-02-29T17:00:00Z", "2026-11-31T17:00:00Z",
            "2026-11-12T24:00:00Z", "2026-11-12T17:60:00Z", "2026-11-12T17:00:61Z", "2026-11-12T17:00:00+0100", "2026-11-12T17:00:00+24:00",
            "2026-11-12T17:00:00.Z", "2026-11-12T17:00:00ZZ", "yesterday", "2026-11-12T17:00:00Z\n", "\u{ff12}026-11-12T17:00:00Z",
        ] {
            assert_eq!(rfc3339(bad), None, "{bad:?}");
        }
        assert_eq!(plain_date("2026-11-12").as_deref(), Some("2026-11-12"));
        assert_eq!(plain_date("2026-02-30"), None);
        assert_eq!(plain_date("2026-11-12T00:00:00Z"), None);
    }

    #[test]
    fn text_is_cleaned_like_a_name_and_loses_links_and_addresses() {
        assert_eq!(clean_text("  Quarterly \t review\n notes ", 120).as_deref(), Some("Quarterly review notes"));
        assert_eq!(clean_text("see https://evil.example/x now", 120).as_deref(), Some("see now"));
        assert_eq!(clean_text("visit www.evil.example today", 120).as_deref(), Some("visit today"));
        assert_eq!(clean_text("mail priya@contoso.example please", 120).as_deref(), Some("mail please"));
        // Bidi marks, zero width characters and controls cannot hide or reorder a word.
        assert_eq!(clean_text("ht\u{200B}tps://evil.example/x ok", 120).as_deref(), Some("ok"));
        assert_eq!(clean_text("a\u{202E}b\u{2066}c\u{200F}d\u{0007}e", 120).as_deref(), Some("abcd e"));
        assert_eq!(clean_text("w\u{2060}ww.evil.example", 120), None);
        assert_eq!(clean_text("https://evil.example", 120), None);
        assert_eq!(clean_text("   ", 120), None);
        assert_eq!(clean_text(&"x".repeat(500), 120).map(|t| t.chars().count()), Some(120));
        assert_eq!(clean_text("\u{e9}\u{e9}\u{e9}", 2).as_deref(), Some("\u{e9}\u{e9}"));
    }

    // Section: shaping

    fn full_answer() -> Value {
        json!({
            "k": "k", "builtAt": "2026-11-12T16:55:00Z", "start": "2026-11-12T17:00:00Z", "stale": true,
            "state": "ready",
            "match": { "kind": "client", "label": "Northwind Outfitters" },
            "sources": { "crm": "ok", "mail": "empty", "chats": "not-set-up", "notes": "failed", "files": "banana" },
            "company": { "name": "Northwind Outfitters", "lifecycle": "Customer", "owner": "Marcus Veld", "lastActivity": "2026-11-10T09:00:00Z" },
            "people": [{ "name": "Priya Calder", "title": "Head of Operations", "lastContact": "last tuesday" }],
            "deals": [{ "name": "Renewal", "stage": "Proposal", "closeDate": "2026-12-15" }],
            "items": [{
                "id": "i1", "source": "mail", "kind": "thread", "title": "Re: renewal terms", "when": "2026-11-11T10:00:00Z",
                "who": "Priya Calder", "preview": "Happy to go ahead", "actions": ["Send the revised quote"], "recording": false,
                "unverifiedSender": true, "open": { "type": "mail", "id": "AAMkAD-abc_123=" }
            }]
        })
    }

    #[test]
    fn k_is_required_and_must_match() {
        let busy = |k: Value| {
            let mut b = full_answer();
            match k {
                Value::Null => {
                    b.as_object_mut().unwrap().remove("k");
                }
                k => {
                    b["k"] = k;
                }
            }
            b
        };
        for bad in [Value::Null, json!("other"), json!(5)] {
            let (out, links) = shape_answer(&busy(bad), "k", &cfg(), 1).unwrap();
            assert_eq!(out, none_answer());
            assert_eq!(out.state, "none");
            assert!(out.items.is_empty() && out.people.is_empty() && out.deals.is_empty() && out.company.is_none());
            assert!(links.is_empty());
        }
        let (out, links) = shape_answer(&busy(json!("k")), "k", &cfg(), 1).unwrap();
        assert_eq!(out.state, "ready");
        assert!(!links.is_empty());
    }

    #[test]
    fn a_full_answer_is_shaped_for_the_page() {
        let out = shape(full_answer());
        assert_eq!((out.state, out.matched.kind, out.matched.label.as_deref()), ("ready", "client", Some("Northwind Outfitters")));
        assert!(out.stale);
        assert_eq!(out.built_at.as_deref(), Some("2026-11-12T16:55:00Z"));
        assert_eq!(out.sources, SourcesOut { crm: "ok", mail: "empty", chats: "not-set-up", notes: "failed", files: "failed" });
        assert_eq!(out.company.as_ref().unwrap().name, "Northwind Outfitters");
        // A bad time is null, not dropped with its person.
        assert_eq!(out.people[0].last_contact, None);
        assert_eq!(out.people[0].title.as_deref(), Some("Head of Operations"));
        assert_eq!(out.deals[0].close_date.as_deref(), Some("2026-12-15"));
        assert_eq!(out.items[0].open_key.as_deref(), Some("b1-0"));
        assert!(out.items[0].unverified_sender);
        let wire = serde_json::to_value(&out).unwrap();
        assert_eq!(wire["match"]["kind"], "client");
        assert_eq!(wire["items"][0]["openKey"], "b1-0");
        assert_eq!(wire["items"][0]["unverifiedSender"], true);
        assert_eq!(wire["builtAt"], "2026-11-12T16:55:00Z");
    }

    #[test]
    fn the_page_never_gets_an_id_or_a_url() {
        let (out, links) = shape_answer(&full_answer(), "k", &cfg(), 7).unwrap();
        let text = serde_json::to_string(&out).unwrap();
        for bad in ["AAMkAD", "outlook.office.com", "https://", "deeplink", "\"open\":"] {
            assert!(!text.contains(bad), "{bad}: {text}");
        }
        assert_eq!(links.get("b7-0").map(String::as_str), Some("https://outlook.office.com/mail/deeplink/read/AAMkAD-abc_123%3D"));
    }

    #[test]
    fn unknown_words_fall_back_and_a_non_object_fails() {
        let out = shape(json!({ "state": "weird", "match": { "kind": "enemy" }, "sources": { "crm": 5 } }));
        assert_eq!((out.state, out.matched.kind), ("none", "none"));
        assert_eq!(out.sources.crm, "failed");
        assert_eq!(out.sources.mail, "failed");
        assert!(out.items.is_empty() && out.people.is_empty() && out.company.is_none());
        for state in ["ready", "building", "none"] {
            assert_eq!(shape(json!({ "state": state })).state, state);
        }
        for kind in ["client", "internal", "unknown", "mixed", "none"] {
            assert_eq!(shape(json!({ "match": { "kind": kind } })).matched.kind, kind);
        }
        assert_eq!(shape_answer(&json!([1, 2]), "k", &cfg(), 1).unwrap_err(), "failed");
        assert_eq!(shape_answer(&json!("text"), "k", &cfg(), 1).unwrap_err(), "failed");
    }

    #[test]
    fn caps_hold_and_malformed_entries_are_dropped() {
        let people: Vec<Value> = (0..30).map(|n| json!({ "name": format!("Person {n}") })).collect();
        let deals: Vec<Value> = (0..30).map(|n| json!({ "name": format!("Deal {n}") })).collect();
        let mut items: Vec<Value> = vec![json!(5), json!({ "source": "mail" }), json!({ "source": "tweet", "kind": "note", "title": "x" }), json!({ "source": "crm", "kind": "note", "title": "   " })];
        items.extend((0..100).map(|n| json!({ "source": "crm", "kind": "note", "title": format!("Note {n}") })));
        let long = "abcdefghij ".repeat(40);
        items[4] = json!({ "source": "note", "kind": "meeting", "title": long, "preview": long, "who": long, "actions": (0..9).map(|_| json!(long)).chain([json!(3), json!("  ")]).collect::<Vec<_>>() });
        let mut body = json!({ "people": people, "deals": deals, "items": items });
        body["people"].as_array_mut().unwrap().insert(0, json!({ "title": "no name" }));
        let out = shape(body);
        assert_eq!(out.people.len(), MAX_PEOPLE);
        assert_eq!(out.people[0].name, "Person 0");
        assert_eq!(out.deals.len(), MAX_DEALS);
        assert_eq!(out.items.len(), MAX_ITEMS);
        // The four bad entries before the good ones did not take a slot.
        assert!(out.items.iter().all(|i| !i.title.is_empty()));
        let first = &out.items[0];
        assert_eq!(first.title.chars().count(), MAX_TITLE);
        assert_eq!(first.preview.as_ref().unwrap().chars().count(), MAX_PREVIEW);
        assert_eq!(first.actions.len(), MAX_ACTIONS);
        assert!(first.actions.iter().all(|a| a.chars().count() <= MAX_ACTION));
        // A missing or odd id is replaced by a plain one.
        let out = shape(json!({ "items": [{ "id": "has space/../x", "source": "crm", "kind": "note", "title": "A" }, { "id": "ok_1-b", "source": "crm", "kind": "note", "title": "B" }] }));
        assert_eq!((out.items[0].id.as_str(), out.items[1].id.as_str()), ("i1", "ok_1-b"));
    }

    #[test]
    fn a_hostile_title_loses_its_link_and_its_bidi_characters() {
        let out = shape(json!({
            "match": { "kind": "client", "label": "Evil\u{202E} https://evil.example/x" },
            "items": [{
                "source": "mail", "kind": "thread",
                "title": "Pay now \u{202E}https://evil.example/x\u{202C} or www.evil.example or boss@evil.example ok",
                "preview": "ht\u{200B}tps://evil.example/y click", "who": "a@b.example", "actions": ["go to https://evil.example/z"]
            }]
        }));
        let item = &out.items[0];
        assert_eq!(item.title, "Pay now or or ok");
        assert_eq!(item.preview.as_deref(), Some("click"));
        assert_eq!(item.who, None);
        assert_eq!(item.actions, ["go to"]);
        assert_eq!(out.matched.label.as_deref(), Some("Evil"));
        let wire = serde_json::to_string(&out).unwrap();
        for bad in ["evil.example", "https://", "www.", "@", "\u{202E}", "\u{200B}"] {
            assert!(!wire.contains(bad), "{bad}");
        }
    }

    // Section: links

    #[test]
    fn mail_links() {
        assert_eq!(mail_url("AAMk+AD/x=_-9").as_deref(), Some("https://outlook.office.com/mail/deeplink/read/AAMk%2BAD%2Fx%3D_-9"));
        assert!(mail_url(&"a".repeat(512)).is_some());
        for bad in ["", "a b", "a?b", "a#b", "a%2fb", "a\u{e9}", "../x", "a\nb", "a:b"] {
            assert_eq!(mail_url(bad), None, "{bad:?}");
        }
        assert_eq!(mail_url(&"a".repeat(513)), None);
    }

    #[test]
    fn chat_links() {
        assert_eq!(
            chat_url("19:abc123@thread.v2").as_deref(),
            Some("https://teams.microsoft.com/l/chat/19%3Aabc123%40thread.v2/conversations")
        );
        for bad in ["", "19", "18:abc", "x19:abc", "19:a b", "19:a\nb", "19:a\u{e9}"] {
            assert_eq!(chat_url(bad), None, "{bad:?}");
        }
        assert!(chat_url(&format!("19:{}", "a".repeat(253))).is_some());
        assert_eq!(chat_url(&format!("19:{}", "a".repeat(254))), None);
        // A slash in the id is encoded, so it cannot add path parts.
        assert!(chat_url("19:a/../b").unwrap().contains("19%3Aa%2F..%2Fb"));
    }

    #[test]
    fn hubspot_links() {
        for (object, type_id) in [("contact", "0-1"), ("company", "0-2"), ("deal", "0-3")] {
            assert_eq!(hubspot_url(Some("1234567"), object, "98765").as_deref(), Some(format!("https://app.hubspot.com/contacts/1234567/record/{type_id}/98765").as_str()));
        }
        // No portal id configured: no link.
        assert_eq!(hubspot_url(None, "contact", "98765"), None);
        assert_eq!(hubspot_url(Some(""), "contact", "98765"), None);
        assert_eq!(hubspot_url(Some("12/../3"), "contact", "98765"), None);
        let too_long = "9".repeat(21);
        for bad in ["", "12a", "../1", "1/2", "1 2", "-1", too_long.as_str()] {
            assert_eq!(hubspot_url(Some("1234567"), "contact", bad), None, "{bad:?}");
        }
        for object in ["", "ticket", "Contact", "0-1", "contact/../x"] {
            assert_eq!(hubspot_url(Some("1234567"), object, "1"), None, "{object:?}");
        }
    }

    #[test]
    fn file_links() {
        let hosts = vec!["contoso.sharepoint.com".to_string()];
        let good = "https://contoso.sharepoint.com/sites/team/Shared%20Documents/plan.docx";
        assert_eq!(file_url(good, &hosts).as_deref(), Some(good));
        assert!(file_url("https://contoso.sharepoint.com/personal/priya_contoso_example/Documents/x.pdf", &hosts).is_some());
        assert!(file_url("https://contoso.sharepoint.com/:b:/r/sites/team/x.pdf?e=AbC", &hosts).is_some());
        assert!(file_url("https://contoso.sharepoint.com:443/sites/team/x", &hosts).is_some());
        assert!(file_url("HTTPS://Contoso.SharePoint.com/sites/team/x", &hosts).is_some_and(|u| u.starts_with("https://contoso.sharepoint.com/")));
        for bad in [
            // Look-alike hosts.
            "https://contoso.sharepoint.com.evil.example/sites/team/x",
            "https://evilcontoso.sharepoint.com/sites/team/x",
            "https://sharepoint.com/sites/team/x",
            "https://contoso-my.sharepoint.com/sites/team/x",
            // Userinfo, ports, scheme.
            "https://user@contoso.sharepoint.com/sites/team/x",
            "https://contoso.sharepoint.com@evil.example/sites/team/x",
            "https://evil.example@contoso.sharepoint.com/sites/team/x",
            "https://contoso.sharepoint.com:8443/sites/team/x",
            "https://contoso.sharepoint.com:/sites/team/x",
            "http://contoso.sharepoint.com/sites/team/x",
            "ftp://contoso.sharepoint.com/sites/team/x",
            "//contoso.sharepoint.com/sites/team/x",
            "contoso.sharepoint.com/sites/team/x",
            // Path shapes.
            "https://contoso.sharepoint.com",
            "https://contoso.sharepoint.com/",
            "https://contoso.sharepoint.com/_layouts/15/redirect.aspx?u=https://evil.example",
            "https://contoso.sharepoint.com/sitesx/team/x",
            "https://contoso.sharepoint.com?x=/sites/a",
            "https://contoso.sharepoint.com/sites/../../x",
            "https://contoso.sharepoint.com/sites/team\\x",
            "https://contoso.sharepoint.com/sites/a b",
            "https://contoso.sharepoint.com/sites/a\nb",
            // Redirectors.
            "https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fcontoso.sharepoint.com%2Fsites%2Fa&data=x",
            "https://nam01.safelinks.protection.outlook.com/sites/x",
            "",
        ] {
            assert_eq!(file_url(bad, &hosts), None, "{bad:?}");
        }
        assert_eq!(file_url(&format!("https://contoso.sharepoint.com/sites/{}", "a".repeat(2048)), &hosts), None);
        // Even a configured Safe Links host is refused, and an empty list accepts nothing.
        let safe = vec!["nam01.safelinks.protection.outlook.com".to_string()];
        assert_eq!(file_url("https://nam01.safelinks.protection.outlook.com/sites/x", &safe), None);
        assert_eq!(file_url(good, &[]), None);
        let enc_ok = "https://contoso.sharepoint.com/sites/team/Shared%20Documents/file.docx";
        assert_eq!(file_url(enc_ok, &hosts).as_deref(), Some(enc_ok));
        for bad in [
            "https://contoso.sharepoint.com/sites/x/%2e%2e/%2e%2e/secret",
            "https://contoso.sharepoint.com/sites/x/%2E%2e/y",
            "https://contoso.sharepoint.com/sites/x/%2e/y",
            "https://contoso.sharepoint.com/sites/x/%252e%252e/y",
            "https://contoso.sharepoint.com/sites/x/a%2fb",
            "https://contoso.sharepoint.com/sites/x/a%5Cb",
            "https://contoso.sharepoint.com/sites/x/a%zzb",
            "https://contoso.sharepoint.com/sites/x/a%2",
            "https://contoso.sharepoint.com/sites/x/a%",
            "https://contoso.sharepoint.com/sites/x/_layouts/15/redirect.aspx?url=https%3A%2F%2Fexample.com",
            "https://contoso.sharepoint.com/sites/x/_LAYOUTS/15/Redirect.ASPX?u=1",
            "https://contoso.sharepoint.com/sites/x/_layouts/15/xredirect.aspx",
            "https://contoso.sharepoint.com/sites/x/redir.aspx?u=1",
            "https://contoso.sharepoint.com/sites/x/Redirect.aspx",
        ] {
            assert_eq!(file_url(bad, &hosts), None, "{bad:?}");
        }
        assert!(file_url("https://contoso.sharepoint.com/sites/x/_layouts/15/download.aspx?SourceUrl=a", &hosts).is_some());
    }

    #[test]
    fn the_open_object_picks_the_builder_and_bad_ones_give_no_link() {
        let c = cfg();
        let l = |v: Value| link_for(&v, &c);
        assert!(l(json!({ "type": "mail", "id": "AAMk" })).is_some());
        assert!(l(json!({ "type": "chat", "id": "19:x@thread.v2" })).is_some());
        assert!(l(json!({ "type": "hubspot", "object": "deal", "id": "5" })).is_some());
        assert!(l(json!({ "type": "file", "id": "https://contoso.sharepoint.com/sites/a/b" })).is_some());
        assert!(l(json!({ "type": "folder", "id": "https://contoso.sharepoint.com/sites/a" })).is_some());
        assert_eq!(l(json!({ "type": "hubspot", "id": "5" })), None);
        assert_eq!(l(json!({ "type": "web", "id": "https://evil.example" })), None);
        assert_eq!(l(json!({ "type": "mail", "id": 5 })), None);
        assert_eq!(l(json!({ "id": "AAMk" })), None);
        let no_portal = BriefConfig { portal: None, ..cfg() };
        assert_eq!(link_for(&json!({ "type": "hubspot", "object": "deal", "id": "5" }), &no_portal), None);
    }

    #[test]
    fn a_stored_url_is_checked_again_before_it_opens() {
        let c = cfg();
        for ok in [
            "https://outlook.office.com/mail/deeplink/read/AAMk",
            "https://teams.microsoft.com/l/chat/19%3Aa%40thread.v2/conversations",
            "https://app.hubspot.com/contacts/1/record/0-1/2",
            "https://contoso.sharepoint.com/sites/a/b",
        ] {
            assert!(url_still_allowed(ok, &c), "{ok}");
        }
        for bad in [
            "https://outlook.office.com.evil.example/mail/deeplink/read/x",
            "https://outlook.office.com@evil.example/mail/deeplink/read/x",
            "https://outlook.office.com/other",
            "https://teams.microsoft.com/l/call/x",
            "https://app.hubspot.com/x",
            "https://evil.example/sites/a",
            "http://contoso.sharepoint.com/sites/a",
            "javascript:alert(1)",
            "file:///c:/x",
            "https://contoso.sharepoint.com/sites/a b",
        ] {
            assert!(!url_still_allowed(bad, &c), "{bad}");
        }
        // A file host removed from the config stops its stored links.
        let none = BriefConfig { file_hosts: vec![], ..cfg() };
        assert!(!url_still_allowed("https://contoso.sharepoint.com/sites/a/b", &none));
    }

    // Section: link map and keys

    #[test]
    fn open_keys_have_a_fixed_shape_and_older_reads_are_refused() {
        for good in ["b1-0", "b12-34", "b1234567890123456789-9999"] {
            assert!(valid_open_key(good), "{good}");
        }
        let long_key = format!("b{}-0", "1".repeat(30));
        for bad in ["", "b", "b1", "b-1", "b1-", "B1-0", "b1-0x", "b1-12345", "c1-0", " b1-0", "b1--0", "b\u{661}-0", long_key.as_str()] {
            assert!(!valid_open_key(bad), "{bad:?}");
        }
        assert!(valid_meeting_key("3-1") && valid_meeting_key("12-0"));
        let long_meeting = "1".repeat(40);
        for bad in ["", "d3-1", "p1-0", "3", "3-", "-1", "3-1000", "3-1x", long_meeting.as_str()] {
            assert!(!valid_meeting_key(bad), "{bad:?}");
        }
    }

    #[test]
    fn links_change_only_when_a_newer_read_succeeds() {
        let l = Mutex::new(BriefLinks::default());
        let counter = AtomicU64::new(0);
        let good = |k: &str| HashMap::from([(k.to_string(), "https://outlook.office.com/mail/deeplink/read/a".to_string())]);
        let r1 = begin_read(&counter);
        finish_read(&l, r1, good("b1-0"));
        assert!(lookup_open(&l, "b1-0").is_some());
        // A read that starts and fails never calls finish_read: the old key still works.
        let _failed = begin_read(&counter);
        assert!(lookup_open(&l, "b1-0").is_some());
        // A successful read replaces the old links.
        let r3 = begin_read(&counter);
        let r4 = begin_read(&counter);
        finish_read(&l, r4, good("b4-0"));
        assert!(lookup_open(&l, "b1-0").is_none());
        assert!(lookup_open(&l, "b4-0").is_some());
        // An older read finishing after a newer one is ignored.
        finish_read(&l, r3, good("b3-0"));
        assert!(lookup_open(&l, "b3-0").is_none());
        assert!(lookup_open(&l, "b4-0").is_some());
    }

    // Section: the whole read, with a fake helper

    struct FakeHelper {
        answer: Result<Vec<u8>, &'static str>,
        seen: Mutex<Vec<(String, String)>>,
    }

    impl FakeHelper {
        fn new(answer: Result<Vec<u8>, &'static str>) -> Self {
            FakeHelper { answer, seen: Mutex::new(Vec::new()) }
        }
    }

    impl Helper for FakeHelper {
        fn get(&self, url: &str, token: &str) -> Result<Vec<u8>, &'static str> {
            self.seen.lock().unwrap().push((url.to_string(), token.to_string()));
            self.answer.clone()
        }
    }

    fn run(token: Option<&str>, ical: Option<&str>, helper: &FakeHelper) -> Result<BriefOut, &'static str> {
        brief_with(&cfg(), token, ical, helper, &Mutex::new(BriefLinks::default()), &AtomicU64::new(0))
    }

    #[test]
    fn the_read_sends_only_the_key_and_the_token() {
        let k = brief_key(TOKEN, ICAL);
        let body = serde_json::to_vec(&json!({ "k": k, "state": "ready" })).unwrap();
        let h = FakeHelper::new(Ok(body));
        let out = run(Some(TOKEN), Some(ICAL), &h).unwrap();
        assert_eq!(out.state, "ready");
        let seen = h.seen.lock().unwrap();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].0, format!("https://brief-box.example.ts.net:8791/wall/v1/brief?k={k}"));
        assert_eq!(seen[0].1, TOKEN);
        assert!(!seen[0].0.contains("contoso") && !seen[0].0.contains("040000008200"));
    }

    #[test]
    fn refusals_and_failures_use_the_fixed_words() {
        let ok = serde_json::to_vec(&json!({ "state": "none" })).unwrap();
        let h = FakeHelper::new(Ok(ok.clone()));
        assert_eq!(run(None, Some(ICAL), &h).unwrap_err(), "not-set-up");
        assert_eq!(run(Some(TOKEN), None, &h).unwrap_err(), "gone");
        assert!(h.seen.lock().unwrap().is_empty(), "nothing is sent without a token and a meeting");
        assert_eq!(run(Some(TOKEN), Some(ICAL), &FakeHelper::new(Err("forbidden"))).unwrap_err(), "forbidden");
        assert_eq!(run(Some(TOKEN), Some(ICAL), &FakeHelper::new(Err("failed"))).unwrap_err(), "failed");
        assert_eq!(run(Some(TOKEN), Some(ICAL), &FakeHelper::new(Ok(b"not json".to_vec()))).unwrap_err(), "failed");
        // An answer for another key is a plain "none".
        let other = serde_json::to_vec(&json!({ "k": "00000000000000000000000000000000", "state": "ready" })).unwrap();
        assert_eq!(run(Some(TOKEN), Some(ICAL), &FakeHelper::new(Ok(other))).unwrap().state, "none");
    }

    #[test]
    fn only_a_good_answer_for_this_key_replaces_the_link_keys() {
        let l = Mutex::new(BriefLinks::default());
        let counter = AtomicU64::new(0);
        let k = brief_key(TOKEN, ICAL);
        let mut good = full_answer();
        good["k"] = json!(k);
        let good = serde_json::to_vec(&good).unwrap();
        let read = |answer: Result<Vec<u8>, &'static str>| brief_with(&cfg(), Some(TOKEN), Some(ICAL), &FakeHelper::new(answer), &l, &counter);

        // Read 1 is good: its link key works.
        assert_eq!(read(Ok(good.clone())).unwrap().items[0].open_key.as_deref(), Some("b1-0"));
        assert!(lookup_open(&l, "b1-0").is_some());
        // Read 2 fails at the helper, read 3 is not JSON: the key from read 1 still works.
        assert_eq!(read(Err("failed")).unwrap_err(), "failed");
        assert!(lookup_open(&l, "b1-0").is_some());
        assert_eq!(read(Ok(b"not json".to_vec())).unwrap_err(), "failed");
        assert!(lookup_open(&l, "b1-0").is_some());
        // Read 4 answers for another key: the page gets "none", and the key from read 1 still works.
        let other = serde_json::to_vec(&json!({ "k": "00000000000000000000000000000000", "state": "ready" })).unwrap();
        assert_eq!(read(Ok(other)).unwrap().state, "none");
        assert!(lookup_open(&l, "b1-0").is_some());
        // Read 5 is good again: its key replaces the old one.
        assert_eq!(read(Ok(good)).unwrap().items[0].open_key.as_deref(), Some("b5-0"));
        assert!(lookup_open(&l, "b1-0").is_none());
        assert!(lookup_open(&l, "b5-0").is_some());
    }

    #[test]
    fn an_oversized_answer_fails_as_soon_as_it_is_over() {
        struct Endless(usize);
        impl Read for Endless {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                self.0 += buf.len();
                buf.fill(b' ');
                Ok(buf.len())
            }
        }
        let mut endless = Endless(0);
        assert_eq!(read_capped(&mut endless), Err("failed"));
        // It stopped a block or two past the cap, not at the end of an endless stream.
        assert!(endless.0 <= MAX_ANSWER + 16 * 1024);
        assert_eq!(read_capped(std::io::Cursor::new(vec![b' '; MAX_ANSWER])).map(|b| b.len()), Ok(MAX_ANSWER));
        assert_eq!(read_capped(std::io::Cursor::new(vec![b' '; MAX_ANSWER + 1])), Err("failed"));
    }
}
