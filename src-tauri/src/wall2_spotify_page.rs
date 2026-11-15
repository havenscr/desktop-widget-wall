//! Reads the songs of one public Spotify playlist from its public embed page, for playlists the signed in user saved but did not make.
//!
//! The owner chose this for his personal app knowing that it is against Spotify's developer terms and can stop working at any time.
//! The page is fetched from one fixed address with no sign in, no cookie and no referrer. The page's JSON also carries an anonymous
//! access token: nothing here reads, keeps, logs or returns it. Only the playlist's own row list is read, by a fixed path, and every
//! text is cleaned and cut. Every answer leaves as a row list or as one of the fixed words below.

use crate::wall2_spotify::{clean, valid_id, Track};
use crate::wall2_spotify_log::{Event, Reason};
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::io::Read;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::WebviewWindow;

const PAGE_PREFIX: &str = "https://open.spotify.com/embed/playlist/";
const USER_AGENT: &str = "Ridgeline/1.0";
const TIMEOUT: Duration = Duration::from_secs(6);
const PAGE_BODY: u64 = 512 * 1024;
const MAX_ROWS: usize = 200;
const MARKER: &str = "id=\"__NEXT_DATA__\"";
const TAG_REACH: usize = 200;
const SCRIPT_OPEN: &str = "<script";
const SCRIPT_CLOSE: &str = "</script>";
const ENTITY: &str = "/props/pageProps/state/data/entity";
const DATA: &str = "/props/pageProps/state/data";

const PAGE_OFF_LIST: &str = "not public";
const PAGE_CHANGED: &str = "page changed";
const PAGE_TOO_BIG: &str = "page too big";
const BUSY: &str = "busy";
const NO_CONNECTION: &str = "no connection";
const INVALID: &str = "invalid id";

const GOOD_LIVES: Duration = Duration::from_secs(30 * 60);
const FAILURE_LIVES: Duration = Duration::from_secs(60);
const HOUR: Duration = Duration::from_secs(60 * 60);
const READS_PER_HOUR: usize = 20;
const CACHE_PLAYLISTS: usize = 50;
const PAUSE_MISSING: u64 = 60;
const PAUSE_MOST: u64 = 3600;

/// The rows of one playlist and how many entries its page listed (rows are shaped for the first 200 only).
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageList { items: Vec<Track>, listed: u32 }

type Answer = Result<PageList, &'static str>;

/// The one address this module ever reads, built only from the fixed prefix and a checked id.
fn page_url(id: &str) -> Option<String> { valid_id(id).then(|| format!("{PAGE_PREFIX}{id}")) }

/// Ok when the answer is a normal page; otherwise the fixed word that names why not.
fn status_word(status: u16, content_type: Option<&str>) -> Result<(), &'static str> {
    match status {
        200 => if content_type.is_some_and(|t| t.trim_start().to_ascii_lowercase().starts_with("text/html")) { Ok(()) } else { Err(PAGE_CHANGED) },
        404 | 410 => Err(PAGE_OFF_LIST),
        429 => Err(BUSY),
        500..=599 => Err(NO_CONNECTION),
        _ => Err(PAGE_CHANGED),
    }
}

/// Moves a byte position forward to the next character boundary, so a slice never cuts a character.
fn boundary_up(text: &str, mut at: usize) -> usize {
    while at < text.len() && !text.is_char_boundary(at) { at += 1 }
    at.min(text.len())
}

/// The JSON text inside the page's single `__NEXT_DATA__` script element. Linear searches on bounded slices; no regex, no recursion.
fn find_next_data(html: &str) -> Result<&str, &'static str> {
    let at = html.find(MARKER).ok_or(PAGE_CHANGED)?;
    let after = at + MARKER.len();
    if html[after..].contains(MARKER) { return Err(PAGE_CHANGED) }
    let back = boundary_up(html, at.saturating_sub(TAG_REACH));
    let open = back + html[back..at].rfind(SCRIPT_OPEN).ok_or(PAGE_CHANGED)?;
    // The marker must sit inside the opening tag: no `>` between the tag's start and the marker.
    if html[open..at].contains('>') { return Err(PAGE_CHANGED) }
    let reach = boundary_up(html, (after + TAG_REACH).min(html.len()));
    let end = after + html[after..reach].find('>').ok_or(PAGE_CHANGED)? + 1;
    let close = html[end..].find(SCRIPT_CLOSE).ok_or(PAGE_CHANGED)?;
    Ok(&html[end..end + close])
}

/// The same as `find_next_data`, for the bytes read from the network: the body must be UTF-8.
fn find_next_data_bytes(bytes: &[u8]) -> Result<&str, &'static str> {
    find_next_data(std::str::from_utf8(bytes).map_err(|_| PAGE_CHANGED)?)
}

/// The playlist's rows from the page's JSON. Only the fixed entity path and the row fields are read; nothing else of the JSON is looked at.
fn shape_page(json: &str, id: &str) -> Answer {
    let value: Value = serde_json::from_str(json).map_err(|_| PAGE_CHANGED)?;
    let Some(entity) = value.pointer(ENTITY) else {
        return Err(if value.pointer(DATA).is_some_and(Value::is_object) { PAGE_OFF_LIST } else { PAGE_CHANGED });
    };
    if !entity.is_object() || entity.get("type").and_then(Value::as_str) != Some("playlist") { return Err(PAGE_CHANGED) }
    if entity.get("uri").and_then(Value::as_str) != Some(format!("spotify:playlist:{id}").as_str()) { return Err(PAGE_CHANGED) }
    let Some(list) = entity.get("trackList").and_then(Value::as_array) else { return Err(PAGE_OFF_LIST) };
    let items = list.iter().take(MAX_ROWS).filter_map(shape_row).collect();
    Ok(PageList { items, listed: u32::try_from(list.len()).unwrap_or(u32::MAX) })
}

fn shape_row(entry: &Value) -> Option<Track> {
    if !entry.is_object() { return None }
    let name = clean(entry.get("title"), 80)?;
    let artists = clean(entry.get("subtitle"), 80).unwrap_or_default();
    let duration_ms = entry.get("duration").and_then(Value::as_u64).filter(|n| *n <= 86_400_000).and_then(|n| u32::try_from(n).ok()).unwrap_or(0);
    let id = entry.get("uri").and_then(Value::as_str).and_then(|u| u.strip_prefix("spotify:track:")).filter(|t| valid_id(t)).map(str::to_string);
    let playable = entry.get("isPlayable").and_then(Value::as_bool) == Some(true) && entry.get("entityType").and_then(Value::as_str) == Some("track") && id.is_some();
    Some(Track::page_row(id.filter(|_| playable), name, artists, duration_ms, playable))
}

/// The body, read to at most `PAGE_BODY` bytes: one more byte is `page too big`.
fn read_body(reader: &mut dyn Read) -> Result<Vec<u8>, &'static str> {
    let mut out = Vec::new();
    reader.take(PAGE_BODY + 1).read_to_end(&mut out).map_err(|_| NO_CONNECTION)?;
    if out.len() as u64 > PAGE_BODY { Err(PAGE_TOO_BIG) } else { Ok(out) }
}

enum Check { Cached(Answer), Go, Busy }

/// The wall's own limits: a cache, a floor of one read per playlist per minute, 20 reads an hour and a pause after a 429.
/// The time is passed in, so the rules can be tested without a clock.
struct Limits { cache: HashMap<String, (Instant, Answer)>, reads: VecDeque<Instant>, pause_until: Option<Instant> }
impl Limits {
    fn new() -> Self { Limits { cache: HashMap::new(), reads: VecDeque::new(), pause_until: None } }
    fn check(&mut self, id: &str, now: Instant) -> Check {
        if let Some((at, answer)) = self.cache.get(id) {
            let lives = if answer.is_ok() { GOOD_LIVES } else { FAILURE_LIVES };
            if now.saturating_duration_since(*at) < lives { return Check::Cached(answer.clone()) }
        }
        if self.pause_until.is_some_and(|until| now < until) { return Check::Busy }
        while self.reads.front().is_some_and(|at| now.saturating_duration_since(*at) >= HOUR) { self.reads.pop_front(); }
        if self.reads.len() >= READS_PER_HOUR { return Check::Busy }
        self.reads.push_back(now);
        Check::Go
    }
    fn store(&mut self, id: &str, now: Instant, answer: Answer) {
        if !self.cache.contains_key(id) && self.cache.len() >= CACHE_PLAYLISTS {
            if let Some(oldest) = self.cache.iter().min_by_key(|(_, (at, _))| *at).map(|(key, _)| key.clone()) { self.cache.remove(&oldest); }
        }
        self.cache.insert(id.to_string(), (now, answer));
    }
    /// A 429: no read at all until `Retry-After` seconds have passed (missing: a minute; at most an hour).
    fn pause(&mut self, now: Instant, retry_after: Option<u64>) {
        self.pause_until = Some(now + Duration::from_secs(retry_after.unwrap_or(PAUSE_MISSING).min(PAUSE_MOST)));
    }
}

fn limits() -> &'static Mutex<Limits> {
    static LIMITS: OnceLock<Mutex<Limits>> = OnceLock::new();
    LIMITS.get_or_init(|| Mutex::new(Limits::new()))
}
/// Held across a read, so two calls for the same playlist make one network read: the second waits, then finds the cache.
fn fetch_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}
/// This module's own agent: no cookie store, no redirects, and never shared with the Web API agent, so no bearer token can reach it.
fn agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| ureq::AgentBuilder::new().timeout(TIMEOUT).redirects(0).build())
}

struct Fetched { answer: Answer, status: u16, retry_after: Option<u64> }

fn fetch(id: &str) -> Fetched {
    let failed = |word: &'static str, status: u16, retry_after: Option<u64>| Fetched { answer: Err(word), status, retry_after };
    let Some(url) = page_url(id) else { return failed(INVALID, 0, None) };
    let result = agent().get(&url).set("User-Agent", USER_AGENT).set("Accept", "text/html").call();
    let response = match result { Ok(response) | Err(ureq::Error::Status(_, response)) => response, Err(_) => return failed(NO_CONNECTION, 0, None) };
    let status = response.status();
    let retry_after = response.header("Retry-After").and_then(|v| v.trim().parse::<u64>().ok());
    if let Err(word) = status_word(status, response.header("Content-Type")) { return failed(word, status, retry_after) }
    let bytes = match read_body(&mut response.into_reader()) { Ok(bytes) => bytes, Err(word) => return failed(word, status, None) };
    let answer = find_next_data_bytes(&bytes).and_then(|json| shape_page(json, id));
    Fetched { answer, status, retry_after: None }
}

fn reason(word: &str) -> Reason {
    match word { PAGE_OFF_LIST => Reason::Missing, PAGE_CHANGED => Reason::Changed, PAGE_TOO_BIG => Reason::TooBig, BUSY => Reason::Busy, NO_CONNECTION => Reason::Down, _ => Reason::Failed }
}

fn read_page(id: &str) -> Result<PageList, String> {
    let _one_read = fetch_lock().lock().unwrap_or_else(|e| e.into_inner());
    let check = limits().lock().unwrap_or_else(|e| e.into_inner()).check(id, Instant::now());
    match check {
        Check::Cached(answer) => return answer.map_err(str::to_string),
        Check::Busy => return Err(BUSY.to_string()),
        Check::Go => {}
    }
    let started = Instant::now();
    let Fetched { answer, status, retry_after } = fetch(id);
    let elapsed = started.elapsed().as_millis();
    match &answer {
        Ok(_) => crate::wall2_spotify_log::write(Event::PageRead, Reason::None, status, elapsed),
        Err(word) => crate::wall2_spotify_log::write(Event::PageFailed, reason(word), status, elapsed),
    }
    {
        let mut limits = limits().lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        if status == 429 { limits.pause(now, retry_after) }
        limits.store(id, now, answer.clone());
    }
    answer.map_err(str::to_string)
}

#[tauri::command]
pub async fn wall2_spotify_public_page(window: WebviewWindow, id: String) -> Result<PageList, String> {
    crate::wall2_meet::require_wall2(window.label())?;
    if !valid_id(&id) { return Err(INVALID.to_string()) }
    tauri::async_runtime::spawn_blocking(move || read_page(&id)).await.map_err(|_| NO_CONNECTION.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "AAAAAAAAAAAAAAAAAAAAA1";
    const OTHER: &str = "BBBBBBBBBBBBBBBBBBBBB2";
    const T1: &str = "TTTTTTTTTTTTTTTTTTTTT1";
    const T2: &str = "TTTTTTTTTTTTTTTTTTTTT2";
    const T3: &str = "TTTTTTTTTTTTTTTTTTTTT3";

    fn page(json: &str) -> String {
        format!("<html><head><script>var a = 1;</script><script id=\"__NEXT_DATA__\" type=\"application/json\">{json}</script><script>var b = 2;</script></head><body></body></html>")
    }
    fn data(entity: &str) -> String { format!("{{\"props\":{{\"pageProps\":{{\"state\":{{\"data\":{{\"entity\":{entity}}}}}}}}}}}") }
    fn good_entity() -> String {
        format!("{{\"type\":\"playlist\",\"name\":\"Lantern Mix\",\"uri\":\"spotify:playlist:{ID}\",\"coverArt\":\"https://example.invalid/cover\",\"accessToken\":\"FAKE-TOKEN-0000\",\"trackList\":[\
            {{\"uri\":\"spotify:track:{T1}\",\"uid\":\"u1\",\"title\":\"Lantern Song 1\",\"subtitle\":\"Paper Kites Collective\",\"duration\":200000,\"isPlayable\":true,\"entityType\":\"track\"}},\
            {{\"uri\":\"spotify:track:{T2}\",\"uid\":\"u2\",\"title\":\"Lantern Song 2\",\"subtitle\":\"Paper Kites Collective, Quiet Harbour\",\"duration\":185500,\"isPlayable\":false,\"entityType\":\"track\",\"accessToken\":\"FAKE-TOKEN-0000\"}},\
            {{\"uri\":\"spotify:track:{T3}\",\"uid\":\"u3\",\"title\":\"Lantern Song 3\",\"subtitle\":\"\",\"duration\":90000,\"isPlayable\":true,\"entityType\":\"track\"}}]}}")
    }
    fn good_json() -> String {
        format!("{{\"accessToken\":\"FAKE-TOKEN-0000\",\"props\":{{\"pageProps\":{{\"state\":{{\"data\":{{\"entity\":{}}}}}}}}}}}", good_entity())
    }
    fn with_list(list: &str) -> String {
        data(&format!("{{\"type\":\"playlist\",\"uri\":\"spotify:playlist:{ID}\",\"trackList\":{list}}}"))
    }
    fn row(extra: &str) -> String { format!("[{{\"title\":\"Lantern Song\",\"subtitle\":\"Paper Kites Collective\"{extra}}}]") }

    #[test]
    fn a_good_page_gives_rows_and_never_the_token() {
        let html = page(&good_json());
        let json = find_next_data(&html).unwrap();
        let answer = shape_page(json, ID).unwrap();
        assert_eq!(answer.listed, 3);
        assert_eq!(answer.items.len(), 3);
        let names: Vec<&str> = answer.items.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, ["Lantern Song 1", "Lantern Song 2", "Lantern Song 3"]);
        assert_eq!(answer.items[0].artists, "Paper Kites Collective");
        assert_eq!(answer.items[1].artists, "Paper Kites Collective, Quiet Harbour");
        assert_eq!(answer.items[2].artists, "");
        assert_eq!(answer.items[0].duration_ms, 200000);
        assert_eq!(answer.items[1].duration_ms, 185500);
        assert_eq!(answer.items[0].id, Some(T1.to_string()));
        assert!(answer.items[0].playable);
        assert_eq!(answer.items[1].id, None);
        assert!(!answer.items[1].playable);
        assert_eq!(answer.items[2].id, Some(T3.to_string()));
        assert!(answer.items[2].playable);
        assert!(answer.items.iter().all(|t| t.album.is_empty() && t.image_url.is_none() && t.thumb_url.is_none()));
        let sent = serde_json::to_string(&answer).unwrap();
        assert!(!sent.contains("FAKE-TOKEN"));
        assert!(!sent.contains("accessToken"));
        assert!(!sent.contains("coverArt"));
        assert!(!sent.contains("uid"));
        assert!(sent.contains("\"listed\":3"));
    }

    #[test]
    fn the_address_is_the_fixed_prefix_and_a_checked_id() {
        assert_eq!(page_url(ID), Some(format!("https://open.spotify.com/embed/playlist/{ID}")));
        for bad in ["AAAAAAAAAAAAAAAAAAAAA", "AAAAAAAAAAAAAAAAAAAAA12", "AAAAAAAAAAAAAAAAAAAA/1", "AAAAAAAAAAAAAAAAAAAA?1", "AAAAAAAAAAAAAAAA%2F123", "..AAAAAAAAAAAAAAAAAAAA", "AAAAAAAAAAAAAAAAAAAA 1", "AAAAAAAAAAAAAAAAAAAAé", "", "AAAAAAAAAAAAAAAAAAAA#1", "AAAAAAAAAAAAAA../AAAAA"] {
            assert_eq!(page_url(bad), None, "{bad}");
        }
    }

    #[test]
    fn status_words_are_fixed() {
        assert_eq!(status_word(200, Some("text/html; charset=utf-8")), Ok(()));
        assert_eq!(status_word(200, Some("TEXT/HTML")), Ok(()));
        assert_eq!(status_word(200, Some("application/json")), Err(PAGE_CHANGED));
        assert_eq!(status_word(200, None), Err(PAGE_CHANGED));
        for status in [301, 302, 307, 308] { assert_eq!(status_word(status, Some("text/html")), Err(PAGE_CHANGED)); }
        assert_eq!(status_word(204, Some("text/html")), Err(PAGE_CHANGED));
        assert_eq!(status_word(403, Some("text/html")), Err(PAGE_CHANGED));
        assert_eq!(status_word(404, None), Err(PAGE_OFF_LIST));
        assert_eq!(status_word(410, None), Err(PAGE_OFF_LIST));
        assert_eq!(status_word(429, None), Err(BUSY));
        assert_eq!(status_word(500, None), Err(NO_CONNECTION));
        assert_eq!(status_word(503, None), Err(NO_CONNECTION));
    }

    #[test]
    fn the_script_element_is_found_only_when_it_is_clear() {
        assert_eq!(find_next_data("<script id=\"__NEXT_DATA__\" type=\"application/json\">{\"a\":1}</script>"), Ok("{\"a\":1}"));
        assert_eq!(find_next_data("<script type=\"application/json\" id=\"__NEXT_DATA__\">{\"a\":2}</script>"), Ok("{\"a\":2}"));
        assert_eq!(find_next_data("<html><script>var x = 1;</script></html>"), Err(PAGE_CHANGED));
        assert_eq!(find_next_data(""), Err(PAGE_CHANGED));
        let twice = "<script id=\"__NEXT_DATA__\">{}</script><script id=\"__NEXT_DATA__\">{}</script>";
        assert_eq!(find_next_data(twice), Err(PAGE_CHANGED));
        let far = format!("<script>{}</script>{} id=\"__NEXT_DATA__\">{{}}</script>", "x".repeat(10), " ".repeat(300));
        assert_eq!(find_next_data(&far), Err(PAGE_CHANGED));
        assert_eq!(find_next_data("<div id=\"__NEXT_DATA__\">{}</div>"), Err(PAGE_CHANGED));
        assert_eq!(find_next_data("<script id=\"__NEXT_DATA__\""), Err(PAGE_CHANGED));
        assert_eq!(find_next_data("<script id=\"__NEXT_DATA__\">{\"a\":1}"), Err(PAGE_CHANGED));
        assert_eq!(find_next_data("<script></script> id=\"__NEXT_DATA__\">{}</script>"), Err(PAGE_CHANGED));
        let wide = format!("<script id=\"__NEXT_DATA__\"{}>", " ".repeat(300));
        assert_eq!(find_next_data(&wide), Err(PAGE_CHANGED));
        assert_eq!(find_next_data_bytes(b"<script id=\"__NEXT_DATA__\">{}</script>"), Ok("{}"));
        assert_eq!(find_next_data_bytes(&[0x3c, 0xff, 0xfe, 0x3e]), Err(PAGE_CHANGED));
        let mut bad = b"<script id=\"__NEXT_DATA__\">{}</script>".to_vec();
        bad.push(0xff);
        assert_eq!(find_next_data_bytes(&bad), Err(PAGE_CHANGED));
        assert_eq!(find_next_data_bytes(b""), Err(PAGE_CHANGED));
    }

    #[test]
    fn a_page_that_is_not_the_expected_playlist_is_refused() {
        assert_eq!(shape_page("{not json", ID), Err(PAGE_CHANGED));
        let deep = format!("{}1{}", "[".repeat(200), "]".repeat(200));
        assert_eq!(shape_page(&deep, ID), Err(PAGE_CHANGED));
        assert_eq!(shape_page("[]", ID), Err(PAGE_CHANGED));
        assert_eq!(shape_page("{\"props\":{}}", ID), Err(PAGE_CHANGED));
        assert_eq!(shape_page("{\"props\":{\"pageProps\":{\"state\":{\"data\":{}}}}}", ID), Err(PAGE_OFF_LIST));
        assert_eq!(shape_page(&data("\"text\""), ID), Err(PAGE_CHANGED));
        assert_eq!(shape_page(&data(&format!("{{\"type\":\"album\",\"uri\":\"spotify:playlist:{ID}\",\"trackList\":[]}}")), ID), Err(PAGE_CHANGED));
        assert_eq!(shape_page(&data(&format!("{{\"type\":\"playlist\",\"uri\":\"spotify:playlist:{OTHER}\",\"trackList\":[]}}")), ID), Err(PAGE_CHANGED));
        assert_eq!(shape_page(&data("{\"type\":\"playlist\",\"trackList\":[]}"), ID), Err(PAGE_CHANGED));
        assert_eq!(shape_page(&with_list("\"text\""), ID), Err(PAGE_OFF_LIST));
        assert_eq!(shape_page(&data(&format!("{{\"type\":\"playlist\",\"uri\":\"spotify:playlist:{ID}\"}}")), ID), Err(PAGE_OFF_LIST));
        assert_eq!(shape_page(&with_list("[]"), ID), Ok(PageList { items: vec![], listed: 0 }));
    }

    #[test]
    fn a_long_list_is_shaped_only_up_to_the_cap_and_counted() {
        let entries: Vec<String> = (0..5000).map(|n| format!("{{\"title\":\"Lantern Song {n}\",\"subtitle\":\"Paper Kites Collective\"}}")).collect();
        let list = format!("[{}]", entries.join(","));
        let answer = shape_page(&with_list(&list), ID).unwrap();
        assert_eq!(answer.items.len(), 200);
        assert_eq!(answer.listed, 5000);
        assert_eq!(answer.items[199].name, "Lantern Song 199");
    }

    #[test]
    fn odd_entries_come_out_dim_or_skipped_as_the_rules_say() {
        let one = |extra: &str| shape_page(&with_list(&row(extra)), ID).unwrap();
        // A title that is not text: the entry is skipped, but still counted as listed.
        let skipped = shape_page(&with_list("[{\"title\":5,\"subtitle\":\"Paper Kites Collective\"},{\"subtitle\":\"x\"},7,\"text\",null]"), ID).unwrap();
        assert!(skipped.items.is_empty());
        assert_eq!(skipped.listed, 5);
        // Duration: negative, huge, text and a float are all 0; a day is kept; a day and a millisecond is 0.
        assert_eq!(one(",\"duration\":-5").items[0].duration_ms, 0);
        assert_eq!(one(",\"duration\":1e20").items[0].duration_ms, 0);
        assert_eq!(one(",\"duration\":\"5000\"").items[0].duration_ms, 0);
        assert_eq!(one(",\"duration\":86400000").items[0].duration_ms, 86_400_000);
        assert_eq!(one(",\"duration\":86400001").items[0].duration_ms, 0);
        assert_eq!(one("").items[0].duration_ms, 0);
        // Track ids: only spotify:track: with exactly 22 letters or digits, and only when playable.
        let playable = |uri: &str, flag: &str, kind: &str| one(&format!(",\"uri\":\"{uri}\",\"isPlayable\":{flag},\"entityType\":\"{kind}\""));
        let good = playable(&format!("spotify:track:{T1}"), "true", "track");
        assert_eq!(good.items[0].id, Some(T1.to_string()));
        assert!(good.items[0].playable);
        for uri in ["spotify:track:short".to_string(), format!("spotify:episode:{T1}"), format!("spotify:track:{T1}/../x"), format!("spotify:track:{T1}x"), "".to_string()] {
            let got = playable(&uri, "true", "track");
            assert_eq!(got.items.len(), 1);
            assert_eq!(got.items[0].id, None, "{uri}");
            assert!(!got.items[0].playable, "{uri}");
        }
        let unplayable = playable(&format!("spotify:track:{T1}"), "false", "track");
        assert_eq!((unplayable.items[0].id.clone(), unplayable.items[0].playable), (None, false));
        let wrong_kind = playable(&format!("spotify:track:{T1}"), "true", "episode");
        assert_eq!((wrong_kind.items[0].id.clone(), wrong_kind.items[0].playable), (None, false));
        let missing = one(&format!(",\"uri\":\"spotify:track:{T1}\",\"entityType\":\"track\""));
        assert_eq!((missing.items[0].id.clone(), missing.items[0].playable), (None, false));
        let text_flag = one(&format!(",\"uri\":\"spotify:track:{T1}\",\"isPlayable\":\"true\",\"entityType\":\"track\""));
        assert_eq!((text_flag.items[0].id.clone(), text_flag.items[0].playable), (None, false));
    }

    #[test]
    fn titles_are_cleaned_and_cut() {
        let controls = shape_page(&with_list("[{\"title\":\"  Lantern\\u0007 \\u202eSong\\u200b  \",\"subtitle\":\"Paper\\u0000 Kites\"}]"), ID).unwrap();
        assert_eq!(controls.items[0].name, "Lantern Song");
        assert_eq!(controls.items[0].artists, "Paper Kites");
        let long = "L".repeat(500);
        let cut = shape_page(&with_list(&format!("[{{\"title\":\"{long}\",\"subtitle\":\"{long}\"}}]")), ID).unwrap();
        assert_eq!(cut.items[0].name.chars().count(), 80);
        assert_eq!(cut.items[0].artists.chars().count(), 80);
    }

    #[test]
    fn the_body_is_read_to_the_cap_and_no_further() {
        assert_eq!(read_body(&mut std::io::Cursor::new(vec![b'x'; PAGE_BODY as usize])).map(|b| b.len()), Ok(PAGE_BODY as usize));
        assert_eq!(read_body(&mut std::io::Cursor::new(vec![b'x'; PAGE_BODY as usize + 1])), Err(PAGE_TOO_BIG));
        assert_eq!(read_body(&mut std::io::Cursor::new(Vec::new())), Ok(Vec::new()));
    }

    fn good_answer() -> Answer { Ok(PageList { items: vec![], listed: 0 }) }
    fn secs(base: Instant, n: u64) -> Instant { base + Duration::from_secs(n) }

    #[test]
    fn a_good_answer_is_cached_for_thirty_minutes() {
        let t0 = Instant::now();
        let mut limits = Limits::new();
        assert!(matches!(limits.check(ID, t0), Check::Go));
        limits.store(ID, t0, good_answer());
        assert!(matches!(limits.check(ID, secs(t0, 29 * 60)), Check::Cached(Ok(_))));
        assert!(matches!(limits.check(ID, secs(t0, 31 * 60)), Check::Go));
    }

    #[test]
    fn a_failure_is_cached_for_a_minute() {
        let t0 = Instant::now();
        let mut limits = Limits::new();
        assert!(matches!(limits.check(ID, t0), Check::Go));
        limits.store(ID, t0, Err(PAGE_OFF_LIST));
        assert!(matches!(limits.check(ID, secs(t0, 59)), Check::Cached(Err(PAGE_OFF_LIST))));
        assert!(matches!(limits.check(ID, secs(t0, 61)), Check::Go));
    }

    #[test]
    fn twenty_reads_an_hour_then_busy() {
        let t0 = Instant::now();
        let mut limits = Limits::new();
        for n in 0..20u64 {
            let id = format!("{n:022}");
            assert!(matches!(limits.check(&id, secs(t0, n)), Check::Go), "read {n}");
        }
        assert!(matches!(limits.check(OTHER, secs(t0, 30)), Check::Busy));
        assert!(matches!(limits.check(OTHER, secs(t0, 3599)), Check::Busy));
        assert!(matches!(limits.check(OTHER, secs(t0, 3600)), Check::Go));
    }

    #[test]
    fn a_429_pauses_for_retry_after_with_a_floor_and_a_cap() {
        let t0 = Instant::now();
        let mut limits = Limits::new();
        limits.pause(t0, Some(120));
        assert!(matches!(limits.check(ID, secs(t0, 119)), Check::Busy));
        assert!(matches!(limits.check(ID, secs(t0, 121)), Check::Go));
        let mut missing = Limits::new();
        missing.pause(t0, None);
        assert!(matches!(missing.check(ID, secs(t0, 59)), Check::Busy));
        assert!(matches!(missing.check(ID, secs(t0, 61)), Check::Go));
        let mut huge = Limits::new();
        huge.pause(t0, Some(999_999));
        assert!(matches!(huge.check(ID, secs(t0, 3599)), Check::Busy));
        assert!(matches!(huge.check(ID, secs(t0, 3601)), Check::Go));
    }

    #[test]
    fn the_cache_holds_fifty_playlists_and_drops_the_oldest() {
        let t0 = Instant::now();
        let mut limits = Limits::new();
        for n in 0..51u64 { limits.store(&format!("{n:022}"), secs(t0, n), good_answer()); }
        assert_eq!(limits.cache.len(), 50);
        assert!(!limits.cache.contains_key(&format!("{:022}", 0)));
        assert!(limits.cache.contains_key(&format!("{:022}", 1)));
        assert!(limits.cache.contains_key(&format!("{:022}", 50)));
        limits.store(&format!("{:022}", 1), secs(t0, 60), good_answer());
        assert_eq!(limits.cache.len(), 50);
    }

    #[test]
    fn fixed_words_map_to_fixed_log_reasons() {
        for word in [PAGE_OFF_LIST, PAGE_CHANGED, PAGE_TOO_BIG, BUSY, NO_CONNECTION, INVALID] {
            let line = crate::wall2_spotify_log::line(Event::PageFailed, reason(word), 0, 1);
            assert!(line.starts_with("page-failed "), "{line}");
        }
    }
}
