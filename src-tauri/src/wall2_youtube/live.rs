//! Bounded, read-only YouTube live state and chat.

use super::{access_with, api_url, clean_text, id_chars, lock, pacific_day, read_error, reason_of, Ctx, HttpReply, BUSY, DOWN, FAILED, NOT_FOUND, QUOTA_ALL, READ_BODY, READ_TIMEOUT, SIGN_AGAIN};
use serde::Serialize;
use serde_json::Value;
use std::collections::VecDeque;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Instant;
use tauri::Manager;

// Mirrors the study's videos.list read each 60 seconds.
const STATUS_FLOOR: u64 = 60;
// Mirrors the brief's 15 second Check again floor.
const STATUS_FRESH_FLOOR: u64 = 15;
// Mirrors half the parent's ten minute liked-list lifetime.
const FIND_FLOOR: u64 = 300;
// Mirrors the study's ten second chat floor.
const CHAT_FLOOR: u64 = 10;
// Mirrors two status units a minute for ten hours.
const STATUS_DAILY_UNITS: u32 = 1_200;
// Mirrors the study's 4,000 unit daily chat cap.
const CHAT_DAILY_UNITS: u32 = 4_000;
// Mirrors the study's last 30 YouTube messages.
const CHAT_KEEP: usize = 30;
// Mirrors three missed status reads.
const STATUS_STALE: u64 = 180;
// Mirrors six missed chat reads.
const CHAT_STALE: u64 = 60;
// Mirrors memory retained only for one show.
const CHAT_FORGET: u64 = 2 * 60 * 60;
// Mirrors the brief's 1 KB channel file cap.
const CHANNEL_MAX: u64 = 1_024;
static CHANNEL_TMP_SEQ: AtomicU64 = AtomicU64::new(0);
static STATE_WRITE: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, PartialEq)]
enum ReadKind { Channel, Find, Details, Chat }

#[derive(Clone, PartialEq)]
enum ChannelRef { Handle(String), Id(String) }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Channel { channel_id: String, title: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelState { set: bool, title: Option<String> }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveStatus {
    state: &'static str,
    started_at: Option<u64>,
    scheduled_at: Option<u64>,
    viewers: Option<u32>,
    chat: bool,
    read_at: Option<u64>,
    stale: bool,
    word: Option<&'static str>,
    status_left: u32,
    chat_left: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage { id: String, name: String, text: String, at: u64, super_chat: Option<String> }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveChat {
    state: &'static str,
    messages: Vec<ChatMessage>,
    read_at: Option<u64>,
    stale: bool,
    stopped_at: Option<u64>,
    word: Option<&'static str>,
}

struct Live {
    channel: Option<Channel>,
    candidates: Vec<String>,
    candidates_at: Option<u64>,
    find_attempt: Option<u64>,
    details_attempt: Option<u64>,
    chat_attempt: Option<u64>,
    find_inflight: Option<u64>,
    details_inflight: Option<u64>,
    chat_inflight: Option<u64>,
    status: LiveStatus,
    status_day: i64,
    status_used: u32,
    quota_all_day: Option<i64>,
    busy_until: u64,
    chat_id: Option<String>,
    last_live_at: Option<u64>,
    refresh_candidates: bool,
    chat: LiveChat,
    chat_day: i64,
    chat_used: u32,
    page_token: Option<String>,
    poll_secs: u64,
}

impl Live {
    fn new() -> Self {
        Self {
            channel: None, candidates: Vec::new(), candidates_at: None,
            find_attempt: None, details_attempt: None, chat_attempt: None,
            find_inflight: None, details_inflight: None, chat_inflight: None,
            status: LiveStatus {
                state: "not-set-up", started_at: None, scheduled_at: None,
                viewers: None, chat: false, read_at: None, stale: false,
                word: None, status_left: STATUS_DAILY_UNITS, chat_left: CHAT_DAILY_UNITS,
            },
            status_day: i64::MIN, status_used: 0, quota_all_day: None, busy_until: 0,
            chat_id: None, last_live_at: None, refresh_candidates: false,
            chat: LiveChat { state: "off", messages: Vec::new(), read_at: None, stale: false, stopped_at: None, word: None },
            chat_day: i64::MIN, chat_used: 0, page_token: None, poll_secs: CHAT_FLOOR,
        }
    }
    fn days(&mut self, now: u64) {
        let day = pacific_day(now);
        if self.status_day != day { self.status_day = day; self.status_used = 0; self.quota_all_day = None; }
        if self.chat_day != day { self.chat_day = day; self.chat_used = 0; self.chat.stopped_at = None; if self.chat.state == "quota" { self.chat.state = "off"; } }
    }
    fn status_answer(&self, now: u64) -> LiveStatus {
        let mut out = self.status.clone();
        out.stale = out.read_at.map_or(self.channel.is_some() && out.state != "signed-out", |at| now.saturating_sub(at) >= STATUS_STALE);
        out.status_left = STATUS_DAILY_UNITS.saturating_sub(self.status_used);
        out.chat_left = CHAT_DAILY_UNITS.saturating_sub(self.chat_used);
        out
    }
    fn chat_answer(&self, now: u64) -> LiveChat {
        let mut out = self.chat.clone();
        out.stale = out.read_at.is_some_and(|at| now.saturating_sub(at) >= CHAT_STALE);
        out
    }
    fn drop_chat(&mut self, ended: bool, now: u64) {
        self.chat_id = None; self.page_token = None; self.poll_secs = CHAT_FLOOR;
        self.status.chat = false;
        if ended { self.chat.state = "ended"; self.refresh_candidates = true; }
        if ended || self.last_live_at.is_some_and(|at| now.saturating_sub(at) >= CHAT_FORGET) { self.chat.messages.clear(); }
    }
}

static LIVE: Mutex<Option<Live>> = Mutex::new(None);
static GEN: AtomicU64 = AtomicU64::new(0);

fn with_live<R>(f: impl FnOnce(&mut Live) -> R) -> R { f(lock(&LIVE).get_or_insert_with(Live::new)) }
fn put_live<R>(generation: u64, f: impl FnOnce(&mut Live) -> R) -> Option<R> {
    let mut state = lock(&LIVE);
    if GEN.load(Ordering::SeqCst) != generation { return None }
    Some(f(state.get_or_insert_with(Live::new)))
}

/// Clears account and show memory. Quota counts and Google stop gates belong to the client and
/// survive every clear, including sign-out and client changes.
pub(super) fn clear(_keep_counts: bool) {
    let _write = lock(&STATE_WRITE);
    clear_locked();
}

fn clear_locked() {
    let mut state = lock(&LIVE);
    GEN.fetch_add(1, Ordering::SeqCst);
    let kept = state.as_ref().map(|v| (
        v.status_day, v.status_used, v.chat_day, v.chat_used,
        v.quota_all_day, v.busy_until,
    ));
    *state = kept.map(|(sd, su, cd, cu, quota, busy)| {
        let mut v = Live::new();
        v.status_day = sd; v.status_used = su;
        v.chat_day = cd; v.chat_used = cu;
        v.quota_all_day = quota; v.busy_until = busy;
        v
    });
}

#[cfg(test)]
pub(super) fn reset_for_test() {
    let _write = lock(&STATE_WRITE);
    GEN.fetch_add(1, Ordering::SeqCst);
    *lock(&LIVE) = None;
}

struct Lease { generation: u64, find: bool, details: bool, chat: bool }
impl Drop for Lease {
    fn drop(&mut self) {
        let mut state = lock(&LIVE);
        let Some(v) = state.as_mut() else { return };
        if self.find && v.find_inflight == Some(self.generation) { v.find_inflight = None; }
        if self.details && v.details_inflight == Some(self.generation) { v.details_inflight = None; }
        if self.chat && v.chat_inflight == Some(self.generation) { v.chat_inflight = None; }
    }
}

fn safe_chars(s: &str) -> bool { !s.chars().any(super::unsafe_char) }
fn valid_handle(s: &str) -> bool { (3..=30).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-')) }
fn valid_channel_id(s: &str) -> bool { s.starts_with("UC") && id_chars(s, 24..=24) }

fn parse_channel(text: &str) -> Option<ChannelRef> {
    let text = text.trim();
    if !safe_chars(text) { return None }
    if let Some(handle) = text.strip_prefix('@') { return valid_handle(handle).then(|| ChannelRef::Handle(handle.to_string())) }
    if valid_channel_id(text) { return Some(ChannelRef::Id(text.to_string())) }
    let rest = ["https://www.youtube.com/", "https://youtube.com/", "www.youtube.com/", "youtube.com/"]
        .iter().find_map(|prefix| text.strip_prefix(prefix))?;
    let rest = rest.strip_suffix('/').unwrap_or(rest);
    if let Some(handle) = rest.strip_prefix('@') { return valid_handle(handle).then(|| ChannelRef::Handle(handle.to_string())) }
    rest.strip_prefix("channel/").filter(|id| valid_channel_id(id)).map(|id| ChannelRef::Id(id.to_string()))
}

fn read_channel(path: &Path) -> Option<Channel> {
    let mut bytes = Vec::new();
    std::fs::File::open(path).ok()?.take(CHANNEL_MAX + 1).read_to_end(&mut bytes).ok()?;
    if bytes.len() as u64 > CHANNEL_MAX { return None }
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    let channel_id = value.get("channelId")?.as_str()?;
    if !valid_channel_id(channel_id) { return None }
    let title = clean_text(value.get("title"), 100)?;
    Some(Channel { channel_id: channel_id.to_string(), title })
}

fn write_channel(path: &Path, channel: &Channel) -> Result<(), &'static str> {
    let bytes = serde_json::to_vec(channel).map_err(|_| FAILED)?;
    if bytes.len() as u64 > CHANNEL_MAX { return Err(FAILED) }
    let parent = path.parent().ok_or(FAILED)?;
    std::fs::create_dir_all(parent).map_err(|_| FAILED)?;
    let sequence = CHANNEL_TMP_SEQ.fetch_add(1, Ordering::SeqCst);
    let temp = parent.join(format!("onair-channel-{}-{sequence}.tmp", std::process::id()));
    if std::fs::write(&temp, bytes).is_err() { return Err(FAILED) }
    let result = std::fs::rename(&temp, path).map_err(|_| FAILED);
    if result.is_err() { let _ = std::fs::remove_file(&temp); }
    result
}

fn finish_channel_write(generation: u64, path: &Path, channel: &Channel) -> Result<(), &'static str> {
    let _write = lock(&STATE_WRITE);
    if GEN.load(Ordering::SeqCst) != generation { return Err(FAILED) }
    write_channel(path, channel)?;
    clear_locked();
    Ok(())
}

fn channel_state(channel: Option<Channel>) -> ChannelState { ChannelState { set: channel.is_some(), title: channel.map(|v| v.title) } }

fn gate_word(now: u64) -> Option<&'static str> {
    with_live(|v| {
        v.days(now);
        if v.quota_all_day == Some(v.status_day) { Some(QUOTA_ALL) }
        else if now < v.busy_until { Some(BUSY) }
        else { None }
    })
}

fn record_gate(now: u64, word: &'static str) {
    with_live(|v| {
        v.days(now);
        if word == QUOTA_ALL { v.quota_all_day = Some(v.status_day); }
        if word == BUSY { v.busy_until = v.busy_until.max(now + 60); }
    });
}

fn begin_attempt(generation: u64, kind: ReadKind, now: u64) -> Result<(), &'static str> {
    let mut state = lock(&LIVE);
    if GEN.load(Ordering::SeqCst) != generation { return Err(FAILED) }
    let v = state.get_or_insert_with(Live::new);
    v.days(now);
    if v.quota_all_day == Some(v.status_day) { return Err(QUOTA_ALL) }
    if now < v.busy_until { return Err(BUSY) }
    let (used, limit, cost) = if kind == ReadKind::Chat {
        (&mut v.chat_used, CHAT_DAILY_UNITS, 5)
    } else {
        (&mut v.status_used, STATUS_DAILY_UNITS, 1)
    };
    if used.saturating_add(cost) > limit { return Err("quota") }
    *used += cost;
    match kind {
        ReadKind::Find => v.find_attempt = Some(now),
        ReadKind::Details => v.details_attempt = Some(now),
        ReadKind::Chat => v.chat_attempt = Some(now),
        ReadKind::Channel => {}
    }
    Ok(())
}

fn refund_transport(kind: ReadKind) {
    with_live(|v| {
        if kind == ReadKind::Chat { v.chat_used = v.chat_used.saturating_sub(5); }
        else { v.status_used = v.status_used.saturating_sub(1); }
    });
}

fn live_get(
    ctx: &Ctx, endpoint: &str, params: &[(&str, &str)], kind: ReadKind,
    generation: u64, now: u64,
) -> Result<Value, &'static str> {
    use crate::wall2_youtube_log::{write, Event, Reason};
    let chat = kind == ReadKind::Chat;
    let (ok, failed) = if chat {
        (Event::ChatOk, Event::ChatFailed)
    } else {
        (Event::LiveOk, Event::LiveFailed)
    };
    let url = api_url(endpoint, params);
    let started = Instant::now();
    let mut forced = false;
    loop {
        let token = access_with(ctx.client, forced, ctx.http, ctx.creds)?;
        begin_attempt(generation, kind, now)?;
        let reply = match ctx.http.get(&url, &token, READ_BODY, READ_TIMEOUT) {
            Ok(v) => v,
            Err(()) => {
                refund_transport(kind);
                write(failed, Reason::Down, 0, started.elapsed().as_millis());
                return Err(DOWN)
            }
        };
        if reply.status == 401 && !forced { forced = true; continue }
        let ended = chat && chat_ended(&reply);
        let result = if ended { Err("ended") }
            else if (200..300).contains(&reply.status) {
                serde_json::from_slice(&reply.body).map_err(|_| DOWN)
            } else { Err(read_error(&reply, false)) };
        match result {
            Ok(value) => { write(ok, Reason::None, reply.status, started.elapsed().as_millis()); return Ok(value) }
            Err("ended") => { write(failed, Reason::Ended, reply.status, started.elapsed().as_millis()); return Err("ended") }
            Err(word) => {
                record_gate(now, word);
                write(failed, reason_of(word), reply.status, started.elapsed().as_millis());
                return Err(word)
            }
        }
    }
}

fn chat_ended(reply: &HttpReply) -> bool {
    if reply.status == 404 { return true }
    if reply.status != 403 { return false }
    let body: Value = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
    matches!(body.pointer("/error/errors/0/reason").and_then(Value::as_str), Some("liveChatEnded" | "liveChatNotFound" | "liveChatDisabled"))
}

fn resolve_channel(
    ctx: &Ctx, value: ChannelRef, generation: u64, now: u64,
) -> Result<Channel, &'static str> {
    let (key, text) = match &value { ChannelRef::Handle(v) => ("forHandle", v.as_str()), ChannelRef::Id(v) => ("id", v.as_str()) };
    let params = [("part", "id,snippet"), ("fields", "items(id,snippet/title)"), (key, text)];
    let answer = live_get(ctx, "channels", &params, ReadKind::Channel, generation, now)?;
    let item = answer.get("items").and_then(Value::as_array).and_then(|v| v.first()).ok_or(NOT_FOUND)?;
    let id = item.get("id").and_then(Value::as_str).filter(|v| valid_channel_id(v)).ok_or(FAILED)?;
    let title = clean_text(item.pointer("/snippet/title"), 100).ok_or(FAILED)?;
    Ok(Channel { channel_id: id.to_string(), title })
}

fn set_channel_with(ctx: &Ctx, value: ChannelRef, now: u64) -> Result<(Channel, u64), &'static str> {
    if ctx.creds.load().ok().flatten().is_none() { return Err(SIGN_AGAIN) }
    if let Some(word) = gate_word(now) { return Err(word) }
    let generation = GEN.load(Ordering::SeqCst);
    resolve_channel(ctx, value, generation, now).map(|channel| (channel, generation))
}

fn set_channel_word(word: &str) -> &'static str {
    match word {
        SIGN_AGAIN => "signed-out",
        NOT_FOUND => "not found",
        QUOTA_ALL | "quota" => QUOTA_ALL,
        BUSY => BUSY,
        DOWN => DOWN,
        super::SETUP_BROKEN => super::SETUP_BROKEN,
        _ => FAILED,
    }
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y }; let era = y.div_euclid(400); let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    era * 146_097 + (yoe * 365 + yoe / 4 - yoe / 100 + doy) - 719_468
}
fn leap(y: i64) -> bool { y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) }
fn rfc3339(text: &str) -> Option<u64> {
    if !text.is_ascii() || text.len() < 20 { return None }
    if &text[4..5] != "-" || &text[7..8] != "-" || &text[10..11] != "T"
        || &text[13..14] != ":" || &text[16..17] != ":"
    { return None }
    let n = |a, b| {
        let field = text.get(a..b)?;
        field.bytes().all(|v| v.is_ascii_digit())
            .then(|| field.parse::<i64>().ok())?
    };
    let (y, m, d, h, min, sec) = (n(0,4)?, n(5,7)?, n(8,10)?, n(11,13)?, n(14,16)?, n(17,19)?);
    let md = [31, if leap(y) {29} else {28}, 31,30,31,30,31,31,30,31,30,31];
    if !(1970..=9999).contains(&y) || !(1..=12).contains(&m) || !(1..=md[(m-1) as usize]).contains(&d) || h > 23 || min > 59 || sec > 59 { return None }
    let mut suffix = &text[19..];
    if let Some(fraction) = suffix.strip_prefix('.') {
        let digits = fraction.bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 { return None }
        suffix = &fraction[digits..];
    }
    let offset = if suffix == "Z" { 0 }
        else if suffix.len() == 6 && matches!(suffix.as_bytes()[0], b'+' | b'-')
            && &suffix[3..4] == ":"
        {
            let offset_number = |field: &str| {
                (field.len() == 2 && field.bytes().all(|v| v.is_ascii_digit()))
                    .then(|| field.parse::<i64>().ok())?
            };
            let hours = offset_number(&suffix[1..3])?;
            let minutes = offset_number(&suffix[4..6])?;
            if hours > 23 || minutes > 59 { return None }
            let value = hours * 3_600 + minutes * 60;
            if suffix.as_bytes()[0] == b'+' { value } else { -value }
        } else { return None };
    let local = days_from_civil(y,m,d) * 86_400 + h * 3_600 + min * 60 + sec;
    u64::try_from(local - offset).ok()
}

fn status_error(generation: u64, now: u64, word: &'static str) -> LiveStatus {
    let _ = put_live(generation, |v| v.status.word = Some(word));
    with_live(|v| v.status_answer(now))
}

fn acquire_status(
    channel: &Channel, now: u64, fresh: bool, shown: bool,
) -> Option<(Lease, bool, Vec<String>, u64)> {
    with_live(|v| {
        v.days(now);
        v.channel = Some(channel.clone());
        if v.last_live_at.is_some_and(|at| now.saturating_sub(at) >= CHAT_FORGET) {
            v.drop_chat(false, now);
        }
        if !shown || v.quota_all_day == Some(v.status_day) || now < v.busy_until {
            return None
        }
        let floor = if fresh { STATUS_FRESH_FLOOR } else { STATUS_FLOOR };
        let last_status_attempt = v.find_attempt.into_iter().chain(v.details_attempt).max();
        if last_status_attempt.is_some_and(|at| now.saturating_sub(at) < floor) {
            return None
        }
        let find = v.refresh_candidates
            || v.find_attempt.is_none_or(|at| now.saturating_sub(at) >= FIND_FLOOR);
        if v.details_inflight.is_some() || (find && v.find_inflight.is_some()) {
            return None
        }
        let needed = if find { 2 } else { 1 };
        if v.status_used.saturating_add(needed) > STATUS_DAILY_UNITS {
            v.status.word = Some("quota");
            return None
        }
        let generation = GEN.load(Ordering::SeqCst);
        v.details_inflight = Some(generation);
        if find { v.find_inflight = Some(generation); }
        let lease = Lease { generation, find, details: true, chat: false };
        Some((lease, find, v.candidates.clone(), generation))
    })
}

fn put_none(generation: u64, now: u64) {
    let _ = put_live(generation, |v| {
        if v.status.state == "live" { v.drop_chat(true, now); }
        v.status = LiveStatus {
            state: "none", started_at: None, scheduled_at: None, viewers: None,
            chat: false, read_at: Some(now), stale: false, word: None,
            status_left: 0, chat_left: 0,
        };
    });
}

fn status_with(ctx: &Ctx, channel: Option<Channel>, now: u64, fresh: bool, shown: bool) -> LiveStatus {
    let Some(channel) = channel else {
        return with_live(|v| {
            v.days(now); v.channel = None; v.status.state = "not-set-up";
            v.status.word = None; v.status.stale = false; v.status_answer(now)
        })
    };
    if ctx.creds.load().ok().flatten().is_none() {
        return with_live(|v| {
            v.status.state = "signed-out"; v.status.word = None; v.status_answer(now)
        })
    }
    let Some((_lease, find, mut ids, generation)) = acquire_status(&channel, now, fresh, shown)
        else { return with_live(|v| v.status_answer(now)) };
    if find {
        let uploads = format!("UU{}", &channel.channel_id[2..]);
        let params = [
            ("part", "contentDetails"), ("playlistId", uploads.as_str()),
            ("maxResults", "5"), ("fields", "items/contentDetails/videoId"),
        ];
        let answer = match live_get(ctx, "playlistItems", &params, ReadKind::Find, generation, now) {
            Ok(v) => v,
            Err(NOT_FOUND) => Value::Object(serde_json::Map::new()),
            Err(w) => return status_error(generation, now, w),
        };
        ids = answer.get("items").and_then(Value::as_array).into_iter().flatten()
            .filter_map(|v| v.pointer("/contentDetails/videoId").and_then(Value::as_str))
            .filter(|v| id_chars(v, 11..=11)).take(5).map(str::to_string).collect();
        let _ = put_live(generation, |v| {
            v.candidates = ids.clone(); v.candidates_at = Some(now);
            v.refresh_candidates = false;
        });
    }
    if ids.is_empty() {
        put_none(generation, now);
        return with_live(|v| v.status_answer(now))
    }
    let joined = ids.join(",");
    let fields = "items(id,snippet/liveBroadcastContent,liveStreamingDetails(\
        actualStartTime,actualEndTime,scheduledStartTime,concurrentViewers,activeLiveChatId))";
    let params = [("part", "snippet,liveStreamingDetails"), ("id", joined.as_str()), ("fields", fields)];
    let answer = match live_get(ctx, "videos", &params, ReadKind::Details, generation, now) {
        Ok(v) => v,
        Err(w) => return status_error(generation, now, w),
    };
    let mut live = None; let mut scheduled: Option<u64> = None;
    for item in answer.get("items").and_then(Value::as_array).into_iter().flatten() {
        let kind = item.pointer("/snippet/liveBroadcastContent").and_then(Value::as_str);
        if kind == Some("live") && item.pointer("/liveStreamingDetails/actualEndTime").is_none() {
            if let Some(at) = item.pointer("/liveStreamingDetails/actualStartTime").and_then(Value::as_str).and_then(rfc3339) { live = Some((item, at)); break }
        }
        if kind == Some("upcoming") {
            if let Some(at) = item.pointer("/liveStreamingDetails/scheduledStartTime")
                .and_then(Value::as_str).and_then(rfc3339)
                .filter(|at| *at >= now && *at <= now + 7 * 86_400)
            {
                scheduled = Some(scheduled.map_or(at, |old| old.min(at)));
            }
        }
    }
    put_live(generation, |v| {
        let was_live = v.status.state == "live";
        v.status = if let Some((item, at)) = live {
            let viewers = item.pointer("/liveStreamingDetails/concurrentViewers")
                .and_then(Value::as_str).and_then(|s| s.parse::<u32>().ok())
                .filter(|n| *n <= 10_000_000);
            let next_chat = item.pointer("/liveStreamingDetails/activeLiveChatId")
                .and_then(Value::as_str).filter(|s| id_chars(s, 1..=128))
                .map(str::to_string);
            if v.chat_id != next_chat {
                v.page_token = None;
                v.chat.messages.clear();
                v.chat.read_at = None;
            }
            v.chat_id = next_chat;
            v.last_live_at = Some(now);
            v.chat.state = if v.chat_id.is_some() { "ok" } else { "off" };
            LiveStatus {
                state: "live", started_at: Some(at * 1000), scheduled_at: None,
                viewers, chat: v.chat_id.is_some(), read_at: Some(now), stale: false,
                word: None, status_left: 0, chat_left: 0,
            }
        } else if let Some(at) = scheduled {
            if was_live { v.drop_chat(true, now); }
            LiveStatus {
                state: "scheduled", started_at: None, scheduled_at: Some(at * 1000),
                viewers: None, chat: false, read_at: Some(now), stale: false,
                word: None, status_left: 0, chat_left: 0,
            }
        } else {
            if was_live { v.drop_chat(true, now); }
            LiveStatus {
                state: "none", started_at: None, scheduled_at: None, viewers: None,
                chat: false, read_at: Some(now), stale: false, word: None,
                status_left: 0, chat_left: 0,
            }
        };
    });
    with_live(|v| v.status_answer(now))
}

fn valid_message_id(id: &str) -> bool {
    (1..=200).contains(&id.len())
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.'))
}

fn acquire_chat(now: u64, shown: bool) -> Option<(Lease, String, Option<String>, u64)> {
    with_live(|v| {
        v.days(now);
        if v.last_live_at.is_some_and(|at| now.saturating_sub(at) >= CHAT_FORGET) { v.drop_chat(false, now); }
        if v.status.state != "live"
            || v.status.read_at.is_none_or(|at| now.saturating_sub(at) > 120)
            || v.chat_id.is_none()
        {
            if v.chat.state != "ended" { v.chat.state = "off"; }
            return None
        }
        if !shown || v.quota_all_day == Some(v.chat_day) || now < v.busy_until {
            return None
        }
        if v.chat_attempt.is_some_and(|at| now.saturating_sub(at) < v.poll_secs.max(CHAT_FLOOR)) {
            return None
        }
        if v.chat_inflight.is_some() { return None }
        if v.chat_used + 5 > CHAT_DAILY_UNITS { v.chat.state = "quota"; v.chat.stopped_at.get_or_insert(now); return None }
        let generation = GEN.load(Ordering::SeqCst);
        v.chat_inflight = Some(generation);
        let lease = Lease { generation, find: false, details: false, chat: true };
        Some((lease, v.chat_id.clone().unwrap(), v.page_token.clone(), generation))
    })
}

fn chat_with(ctx: &Ctx, now: u64, shown: bool) -> LiveChat {
    let Some((_lease, chat_id, token, generation)) = acquire_chat(now, shown)
        else { return with_live(|v| v.chat_answer(now)) };
    let fields = "nextPageToken,pollingIntervalMillis,offlineAt,items(id,snippet(\
        type,publishedAt,displayMessage,superChatDetails(amountDisplayString,userComment),\
        messageDeletedDetails/deletedMessageId),authorDetails/displayName)";
    let mut params = vec![
        ("liveChatId", chat_id.as_str()), ("part", "snippet,authorDetails"),
        ("maxResults", "200"), ("fields", fields),
    ];
    if let Some(ref page) = token { params.push(("pageToken", page)); }
    let answer = match live_get(ctx, "liveChat/messages", &params, ReadKind::Chat, generation, now) {
        Ok(v) => v,
        Err("ended") => { let _ = put_live(generation, |v| v.drop_chat(true, now)); return with_live(|v| v.chat_answer(now)) }
        Err(word) => {
            let _ = put_live(generation, |v| {
                if word == super::INVALID && token.is_some() { v.page_token = None; }
                if word == QUOTA_ALL || word == "quota" {
                    v.chat.state = "quota";
                    v.chat.stopped_at.get_or_insert(now);
                }
                v.chat.word = Some(word);
            });
            return with_live(|v| v.chat_answer(now))
        }
    };
    put_live(generation, |v| {
        if answer.get("offlineAt").is_some() { v.drop_chat(true, now); return }
        let mut messages: VecDeque<ChatMessage> = v.chat.messages.drain(..).collect();
        for item in answer.get("items").and_then(Value::as_array).into_iter().flatten() {
            let kind = item.pointer("/snippet/type").and_then(Value::as_str);
            if kind == Some("messageDeletedEvent") {
                if let Some(id) = item.pointer("/snippet/messageDeletedDetails/deletedMessageId")
                    .and_then(Value::as_str).filter(|s| valid_message_id(s))
                {
                    messages.retain(|m| m.id != id);
                }
                continue
            }
            if !matches!(kind, Some("textMessageEvent" | "superChatEvent")) { continue }
            let Some(id) = item.get("id").and_then(Value::as_str).filter(|s| valid_message_id(s)) else { continue };
            let Some(name) = clean_text(item.pointer("/authorDetails/displayName"), 40) else { continue };
            let Some(at) = item.pointer("/snippet/publishedAt").and_then(Value::as_str).and_then(rfc3339) else { continue };
            let text = if kind == Some("superChatEvent") {
                clean_text(item.pointer("/snippet/superChatDetails/userComment"), 200).unwrap_or_default()
            } else {
                let Some(text) = clean_text(item.pointer("/snippet/displayMessage"), 200) else { continue };
                text
            };
            let super_chat = (kind == Some("superChatEvent"))
                .then(|| clean_text(item.pointer("/snippet/superChatDetails/amountDisplayString"), 16))
                .flatten();
            messages.retain(|m| m.id != id); messages.push_back(ChatMessage { id: id.to_string(), name, text, at: at * 1000, super_chat });
            while messages.len() > CHAT_KEEP { messages.pop_front(); }
        }
        v.chat.messages = messages.into(); v.chat.state = "ok"; v.chat.read_at = Some(now); v.chat.stale = false; v.chat.word = None;
        v.page_token = answer.get("nextPageToken").and_then(Value::as_str).filter(|s| id_chars(s, 1..=128)).map(str::to_string);
        v.poll_secs = answer.get("pollingIntervalMillis").and_then(Value::as_u64).map(|ms| ms.div_ceil(1000).clamp(CHAT_FLOOR, 60)).unwrap_or(CHAT_FLOOR);
    });
    with_live(|v| v.chat_answer(now))
}

fn path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path().app_config_dir().map(|p| p.join("onair-channel.json")).map_err(|_| FAILED.to_string())
}

#[tauri::command]
pub async fn wall2_ytlive_channel(window: tauri::WebviewWindow) -> Result<ChannelState, String> {
    super::require(&window)?; let file = path(window.app_handle())?;
    tauri::async_runtime::spawn_blocking(move || channel_state(read_channel(&file))).await.map_err(|_| FAILED.to_string())
}

#[tauri::command]
pub async fn wall2_ytlive_set_channel(window: tauri::WebviewWindow, text: String) -> Result<ChannelState, String> {
    super::require(&window)?; let value = parse_channel(&text).ok_or_else(|| "invalid".to_string())?; let app = window.app_handle().clone(); let file = path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (channel, generation) = super::read_with_app(&app, |ctx| {
            set_channel_with(ctx, value, (ctx.now)())
        }).map_err(|word| set_channel_word(&word).to_string())?;
        finish_channel_write(generation, &file, &channel).map_err(str::to_string)?;
        Ok(channel_state(Some(channel)))
    }).await.map_err(|_| FAILED.to_string())?
}

#[tauri::command]
pub async fn wall2_ytlive_forget_channel(window: tauri::WebviewWindow) -> Result<(), String> {
    super::require(&window)?; let file = path(window.app_handle())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _write = lock(&STATE_WRITE);
        if file.exists() { std::fs::remove_file(file).map_err(|_| FAILED.to_string())?; }
        clear_locked();
        Ok(())
    }).await.map_err(|_| FAILED.to_string())?
}

#[tauri::command]
pub async fn wall2_ytlive_status(window: tauri::WebviewWindow, fresh: Option<bool>) -> Result<LiveStatus, String> {
    super::require(&window)?; let app = window.app_handle().clone(); let file = path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let channel = read_channel(&file);
        if channel.is_none() {
            let now = super::unix_now();
            return Ok(with_live(|v| { v.days(now); v.channel = None; v.status.state = "not-set-up"; v.status.word = None; v.status.stale = false; v.status_answer(now) }));
        }
        super::read_with_app(&app, |ctx| Ok(status_with(ctx, channel, (ctx.now)(), fresh.unwrap_or(false), crate::webview_shown())))
    }).await.map_err(|_| FAILED.to_string())?
}

#[tauri::command]
pub async fn wall2_ytlive_chat(window: tauri::WebviewWindow) -> Result<LiveChat, String> {
    super::require(&window)?; let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let now = super::unix_now();
        let off = with_live(|v| v.status.state != "live" || v.chat_id.is_none());
        if off {
            return Ok(with_live(|v| {
                if v.chat.state != "ended" { v.chat.state = "off"; }
                v.chat_answer(now)
            }))
        }
        super::read_with_app(&app, |ctx| Ok(chat_with(ctx, (ctx.now)(), crate::webview_shown())))
    }).await.map_err(|_| FAILED.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wall2_youtube::tests::{client, exclusive, reply, FakeCreds, FakeHttp};
    use serde_json::json;
    use std::sync::atomic::AtomicU64;
    use std::sync::{mpsc, Arc, Condvar};

    const T0: u64 = 1_704_067_200;
    const TEST_WAIT: std::time::Duration = std::time::Duration::from_secs(5);

    fn channel_id() -> String { format!("UC{}", "a".repeat(22)) }
    fn video_id(n: u8) -> String { format!("video{:06}", n) }
    fn chat_id() -> String { "chat-room".to_string() }
    fn ok(value: Value) -> Result<HttpReply, ()> { reply(200, &value.to_string()) }
    fn prime_token() {
        *super::super::lock(&super::super::TOKEN) = Some(super::super::Token {
            access: "access-one".into(),
            expires: std::time::Instant::now() + std::time::Duration::from_secs(3_600),
        });
    }
    fn run<R>(http: &FakeHttp, creds: &FakeCreds, now: &AtomicU64, f: impl FnOnce(&Ctx) -> R) -> R {
        let clock = || now.load(Ordering::SeqCst);
        f(&Ctx { http, creds, client: &client(), now: &clock })
    }
    fn saved_channel() -> Channel {
        Channel { channel_id: channel_id(), title: "Example Channel".into() }
    }
    fn candidates(ids: &[String]) -> Value {
        json!({ "items": ids.iter().map(|id| json!({ "contentDetails": { "videoId": id } })).collect::<Vec<_>>() })
    }
    fn videos(items: Vec<Value>) -> Value { json!({ "items": items }) }
    fn live_video(id: &str, viewers: &str, chat: Option<&str>) -> Value {
        let mut details = json!({
            "actualStartTime": "2024-01-01T00:00:00Z",
            "concurrentViewers": viewers,
        });
        if let Some(value) = chat { details["activeLiveChatId"] = json!(value); }
        json!({
            "id": id,
            "snippet": { "liveBroadcastContent": "live" },
            "liveStreamingDetails": details,
        })
    }
    fn upcoming_video(id: &str, time: &str) -> Value {
        json!({
            "id": id,
            "snippet": { "liveBroadcastContent": "upcoming" },
            "liveStreamingDetails": { "scheduledStartTime": time },
        })
    }
    fn set_live_memory(now: u64) {
        with_live(|v| {
            v.channel = Some(saved_channel());
            v.status.state = "live";
            v.status.read_at = Some(now);
            v.chat_id = Some(chat_id());
            v.last_live_at = Some(now);
            v.chat.state = "ok";
        });
    }
    fn spawn_result<T: Send + 'static>(
        work: impl FnOnce() -> T + Send + 'static,
    ) -> mpsc::Receiver<T> {
        let (sender, receiver) = mpsc::sync_channel(1);
        std::thread::spawn(move || {
            let result = work();
            sender.send(result).expect("test result receiver was dropped");
        });
        receiver
    }
    fn receive_result<T>(receiver: mpsc::Receiver<T>, label: &str) -> T {
        receiver.recv_timeout(TEST_WAIT).unwrap_or_else(|error| {
            panic!("{label} did not finish within five seconds: {error}")
        })
    }

    struct HoldingHttp {
        answer: Mutex<Option<Result<HttpReply, ()>>>,
        entered: (Mutex<bool>, Condvar),
        released: (Mutex<bool>, Condvar),
        calls: AtomicU64,
    }
    impl HoldingHttp {
        fn new(answer: Result<HttpReply, ()>) -> Self {
            Self {
                answer: Mutex::new(Some(answer)),
                entered: (Mutex::new(false), Condvar::new()),
                released: (Mutex::new(false), Condvar::new()),
                calls: AtomicU64::new(0),
            }
        }
        fn wait_entered(&self) {
            let (flag, cv) = &self.entered;
            let mut entered = lock(flag);
            let deadline = Instant::now() + TEST_WAIT;
            while !*entered {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    drop(entered);
                    self.release();
                    panic!("fake HTTP was not entered within five seconds");
                }
                let (next, timeout) = cv
                    .wait_timeout(entered, remaining)
                    .unwrap_or_else(|error| error.into_inner());
                entered = next;
                if timeout.timed_out() && !*entered {
                    drop(entered);
                    self.release();
                    panic!("fake HTTP was not entered within five seconds");
                }
            }
        }
        fn release(&self) {
            let (flag, cv) = &self.released;
            *lock(flag) = true;
            cv.notify_all();
        }
    }
    impl super::super::Http for HoldingHttp {
        fn post_form(
            &self, _url: &str, _form: &[(&str, &str)], _timeout: std::time::Duration,
        ) -> Result<HttpReply, ()> { Err(()) }
        fn get(
            &self, _url: &str, _bearer: &str, _limit: u64, _timeout: std::time::Duration,
        ) -> Result<HttpReply, ()> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let (entered, entered_cv) = &self.entered;
            *lock(entered) = true;
            entered_cv.notify_all();
            let (released, released_cv) = &self.released;
            let mut ready = lock(released);
            let deadline = Instant::now() + TEST_WAIT;
            while !*ready {
                let remaining = deadline.saturating_duration_since(Instant::now());
                assert!(
                    !remaining.is_zero(),
                    "fake HTTP was not released within five seconds"
                );
                let (next, timeout) = released_cv
                    .wait_timeout(ready, remaining)
                    .unwrap_or_else(|error| error.into_inner());
                ready = next;
                assert!(
                    !timeout.timed_out() || *ready,
                    "fake HTTP was not released within five seconds"
                );
            }
            lock(&self.answer).take().unwrap_or(Err(()))
        }
    }

    #[test]
    fn channel_parser_accepts_every_named_shape_and_refuses_every_other_shape() {
        let _guard = exclusive();
        let id = format!("UC{}", "a".repeat(22));
        let accepted = [
            "@example-channel".to_string(),
            id.clone(),
            "https://www.youtube.com/@example-channel".into(),
            "https://youtube.com/@example-channel/".into(),
            "youtube.com/@example-channel".into(),
            "www.youtube.com/@example-channel/".into(),
            format!("https://www.youtube.com/channel/{id}"),
            format!("https://youtube.com/channel/{id}/"),
            format!("youtube.com/channel/{id}"),
            format!("www.youtube.com/channel/{id}/"),
        ];
        for text in accepted { assert!(parse_channel(&text).is_some(), "{text}"); }
        let refused = [
            "", "@ab", "@abcdefghijklmnopqrstuvwxyzabcde", "youtube.com/@good?x=1",
            "youtube.com/@good#x", "http://other.example/@good", "youtube.com/watch?v=abcdefghijk",
            "youtube.com/c/name", "@bad name", "@bad\u{7}", "@bad\u{202e}",
        ];
        for text in refused { assert!(parse_channel(text).is_none(), "{text}"); }
        assert!(parse_channel(&format!("UC{}", "a".repeat(21))).is_none());
        assert!(parse_channel(&format!("UC{}", "a".repeat(23))).is_none());
    }

    #[test]
    fn set_channel_uses_one_checked_get_and_saves_only_two_keys() {
        let _guard = exclusive();
        prime_token();
        let answer = json!({ "items": [{ "id": channel_id(), "snippet": { "title": "Example Channel" } }] });
        let http = FakeHttp::reads(vec![ok(answer)], vec![]);
        let creds = FakeCreds::new(Some("refresh"));
        let now = AtomicU64::new(T0);
        let (channel, _) = run(&http, &creds, &now, |ctx| {
            set_channel_with(ctx, ChannelRef::Handle("example-channel".into()), T0).unwrap()
        });
        assert_eq!(channel.title, "Example Channel");
        let urls = http.get_urls();
        assert_eq!(urls.len(), 1);
        assert!(urls[0].contains("channels?part=id%2Csnippet"));
        assert!(urls[0].contains("fields=items%28id%2Csnippet%2Ftitle%29"));
        assert!(urls[0].contains("forHandle=example-channel"));
        let dir = std::env::temp_dir().join(format!("wall-ytlive-{}", std::process::id()));
        let path = dir.join("onair-channel.json");
        let _ = std::fs::remove_dir_all(&dir);
        write_channel(&path, &channel).unwrap();
        let value: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(value.as_object().unwrap().len(), 2);
        assert_eq!(value["channelId"], channel_id());
        assert_eq!(value["title"], "Example Channel");
        assert_eq!(read_channel(&path).unwrap().title, "Example Channel");
        std::fs::write(&path, vec![b'x'; 1_025]).unwrap();
        assert!(read_channel(&path).is_none());
        std::fs::write(&path, br#"{"channelId":"bad","title":"Example"}"#).unwrap();
        assert!(read_channel(&path).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn set_channel_refuses_missing_and_bad_answers_without_saving() {
        let _guard = exclusive();
        prime_token();
        let http = FakeHttp::reads(vec![ok(json!({ "items": [] }))], vec![]);
        let creds = FakeCreds::new(Some("refresh"));
        let now = AtomicU64::new(T0);
        let missing = run(&http, &creds, &now, |ctx| {
            set_channel_with(ctx, ChannelRef::Id(channel_id()), T0)
        });
        assert_eq!(missing.err(), Some(NOT_FOUND));
        prime_token();
        let bad = FakeHttp::reads(vec![ok(json!({
            "items": [{ "id": format!("UC{}", "a".repeat(23)), "snippet": { "title": "Example" } }]
        }))], vec![]);
        let invalid = run(&bad, &creds, &now, |ctx| {
            set_channel_with(ctx, ChannelRef::Id(channel_id()), T0)
        });
        assert_eq!(invalid.err(), Some(FAILED));
    }

    #[test]
    fn status_sends_nothing_when_unconfigured_signed_out_hidden_or_inside_floor() {
        let _guard = exclusive();
        prime_token();
        let empty = FakeHttp::reads(vec![], vec![]);
        let signed = FakeCreds::new(Some("refresh"));
        let out = FakeCreds::new(None);
        let now = AtomicU64::new(T0);
        let none = run(&empty, &signed, &now, |ctx| status_with(ctx, None, T0, false, true));
        assert_eq!(none.state, "not-set-up");
        let signed_out = run(&empty, &out, &now, |ctx| {
            status_with(ctx, Some(saved_channel()), T0, false, true)
        });
        assert_eq!(signed_out.state, "signed-out");
        let hidden = run(&empty, &signed, &now, |ctx| {
            status_with(ctx, Some(saved_channel()), T0, false, false)
        });
        assert_eq!(hidden.read_at, None);
        with_live(|v| {
            v.status.read_at = Some(T0);
            v.details_attempt = Some(T0);
        });
        let floored = run(&empty, &signed, &now, |ctx| {
            status_with(ctx, Some(saved_channel()), T0 + 59, false, true)
        });
        assert_eq!(floored.read_at, Some(T0));
        assert!(empty.get_urls().is_empty());
    }

    #[test]
    fn status_finds_candidates_on_first_and_301_second_reads_but_not_at_61() {
        let _guard = exclusive();
        prime_token();
        let ids = vec![video_id(1)];
        let http = FakeHttp::reads(vec![
            ok(candidates(&ids)), ok(videos(vec![])), ok(videos(vec![])),
            ok(candidates(&ids)), ok(videos(vec![])),
        ], vec![]);
        let creds = FakeCreds::new(Some("refresh"));
        let now = AtomicU64::new(T0);
        run(&http, &creds, &now, |ctx| status_with(ctx, Some(saved_channel()), T0, false, true));
        run(&http, &creds, &now, |ctx| status_with(ctx, Some(saved_channel()), T0 + 61, false, true));
        run(&http, &creds, &now, |ctx| status_with(ctx, Some(saved_channel()), T0 + 301, false, true));
        let urls = http.get_urls();
        assert_eq!(urls.len(), 5);
        assert!(urls[0].contains("playlistItems?"));
        assert!(urls[1].contains("videos?"));
        assert!(urls[2].contains("videos?"));
        assert!(urls[3].contains("playlistItems?"));
        assert!(urls[4].contains("videos?"));
        assert!(urls[0].contains("maxResults=5"));
        assert!(urls[1].contains("liveStreamingDetails"));
    }

    #[test]
    fn fresh_status_uses_15_second_floor() {
        let _guard = exclusive();
        prime_token();
        with_live(|v| {
            v.channel = Some(saved_channel());
            v.status.state = "none";
            v.status.read_at = Some(T0);
            v.candidates_at = Some(T0);
            v.details_attempt = Some(T0);
        });
        let http = FakeHttp::reads(vec![ok(videos(vec![]))], vec![]);
        let creds = FakeCreds::new(Some("refresh"));
        let now = AtomicU64::new(T0);
        run(&http, &creds, &now, |ctx| {
            status_with(ctx, Some(saved_channel()), T0 + 14, true, true)
        });
        assert!(http.get_urls().is_empty());
        run(&http, &creds, &now, |ctx| {
            status_with(ctx, Some(saved_channel()), T0 + 15, true, true)
        });
        assert_eq!(http.get_urls().len(), 1);
    }

    #[test]
    fn status_selects_live_scheduled_and_none_and_checks_fields() {
        let _guard = exclusive();
        let id = video_id(1);
        let cases = [
            (live_video(&id, "37", Some("private-chat-id")), "live", Some(37), true),
            (live_video(&id, "abc", None), "live", None, false),
            (live_video(&id, "99999999999", None), "live", None, false),
            (upcoming_video(&id, "2024-01-08T00:00:00Z"), "scheduled", None, false),
            (upcoming_video(&id, "2024-01-08T00:00:01Z"), "none", None, false),
            (upcoming_video(&id, "bad-time"), "none", None, false),
        ];
        for (item, state, viewers, has_chat) in cases {
            clear(false); prime_token();
            let ids = vec![id.clone()];
            let http = FakeHttp::reads(vec![ok(candidates(&ids)), ok(videos(vec![item]))], vec![]);
            let creds = FakeCreds::new(Some("refresh"));
            let now = AtomicU64::new(T0);
            let answer = run(&http, &creds, &now, |ctx| {
                status_with(ctx, Some(saved_channel()), T0, false, true)
            });
            assert_eq!(answer.state, state);
            assert_eq!(answer.viewers, viewers);
            assert_eq!(answer.chat, has_chat);
            assert!(!serde_json::to_string(&answer).unwrap().contains("private-chat-id"));
        }
    }

    #[test]
    fn status_budget_quota_all_day_and_stale_edges_are_fixed() {
        let _guard = exclusive();
        prime_token();
        with_live(|v| { v.days(T0); v.status_used = 1_199; });
        let empty = FakeHttp::reads(vec![], vec![]);
        let creds = FakeCreds::new(Some("refresh"));
        let now = AtomicU64::new(T0);
        let quota = run(&empty, &creds, &now, |ctx| {
            status_with(ctx, Some(saved_channel()), T0, false, true)
        });
        assert_eq!(quota.word, Some("quota"));
        assert!(empty.get_urls().is_empty());
        with_live(|v| { v.status.read_at = Some(T0); v.status.word = None; });
        assert!(!with_live(|v| v.status_answer(T0 + 179)).stale);
        assert!(with_live(|v| v.status_answer(T0 + 180)).stale);
        with_live(|v| { v.quota_all_day = Some(pacific_day(T0)); v.status_day = pacific_day(T0); });
        let blocked = run(&empty, &creds, &now, |ctx| {
            status_with(ctx, Some(saved_channel()), T0 + 301, false, true)
        });
        assert_eq!(blocked.read_at, Some(T0));
        with_live(|v| v.days(T0 + 86_400));
        assert_eq!(with_live(|v| v.quota_all_day), None);
    }

    #[test]
    fn quota_all_response_blocks_reads_until_pacific_day_changes() {
        let _guard = exclusive();
        prime_token();
        with_live(|v| {
            v.channel = Some(saved_channel());
            v.candidates = vec![video_id(1)];
            v.candidates_at = Some(T0);
        });
        let error = r#"{"error":{"errors":[{"reason":"quotaExceeded"}]}}"#;
        let ids = vec![video_id(1)];
        let http = FakeHttp::reads(vec![
            reply(403, error), ok(candidates(&ids)), ok(videos(vec![])),
        ], vec![]);
        let creds = FakeCreds::new(Some("refresh"));
        let now = AtomicU64::new(T0);
        let first = run(&http, &creds, &now, |ctx| {
            status_with(ctx, Some(saved_channel()), T0, false, true)
        });
        assert_eq!(first.word, Some(QUOTA_ALL));
        run(&http, &creds, &now, |ctx| {
            status_with(ctx, Some(saved_channel()), T0 + 301, false, true)
        });
        assert_eq!(http.get_urls().len(), 1);
        let tomorrow = run(&http, &creds, &now, |ctx| {
            status_with(ctx, Some(saved_channel()), T0 + 86_400, false, true)
        });
        assert_eq!(tomorrow.word, None);
        assert_eq!(http.get_urls().len(), 3);
        let spring = rfc3339("2024-03-10T09:59:59Z").unwrap();
        let after_spring = rfc3339("2024-03-10T10:00:01Z").unwrap();
        assert_eq!(pacific_day(spring), pacific_day(after_spring));
        let fall = rfc3339("2024-11-03T08:59:59Z").unwrap();
        let after_fall = rfc3339("2024-11-03T09:00:01Z").unwrap();
        assert_eq!(pacific_day(fall), pacific_day(after_fall));
    }

    #[test]
    fn chat_floor_poll_hint_and_page_token_are_enforced() {
        let _guard = exclusive();
        prime_token(); set_live_memory(T0);
        let first = ok(json!({ "nextPageToken": "next-page", "pollingIntervalMillis": 15_000, "items": [] }));
        let second = ok(json!({ "items": [] }));
        let http = FakeHttp::reads(vec![first, second], vec![]);
        let creds = FakeCreds::new(Some("refresh"));
        let now = AtomicU64::new(T0);
        run(&http, &creds, &now, |ctx| chat_with(ctx, T0, true));
        run(&http, &creds, &now, |ctx| chat_with(ctx, T0 + 9, true));
        run(&http, &creds, &now, |ctx| chat_with(ctx, T0 + 14, true));
        run(&http, &creds, &now, |ctx| chat_with(ctx, T0 + 15, true));
        let urls = http.get_urls();
        assert_eq!(urls.len(), 2);
        assert!(!urls[0].contains("pageToken"));
        assert!(urls[1].contains("pageToken=next-page"));

        clear(false); prime_token(); set_live_memory(T0);
        let bad = FakeHttp::reads(vec![
            ok(json!({ "nextPageToken": "bad token", "items": [] })),
            ok(json!({ "items": [] })),
        ], vec![]);
        run(&bad, &creds, &now, |ctx| chat_with(ctx, T0, true));
        run(&bad, &creds, &now, |ctx| chat_with(ctx, T0 + 10, true));
        assert_eq!(bad.get_urls().len(), 2);
        assert!(!bad.get_urls()[1].contains("pageToken"));
    }

    #[test]
    fn chat_keeps_supported_messages_replaces_deletes_and_caps_at_30() {
        let _guard = exclusive();
        prime_token(); set_live_memory(T0);
        let mut items = Vec::new();
        for n in 0..31 {
            items.push(json!({
                "id": format!("message-{n}"),
                "snippet": { "type": "textMessageEvent", "publishedAt": "2024-01-01T00:00:00Z", "displayMessage": format!("Text {n}") },
                "authorDetails": { "displayName": "Viewer One" },
            }));
        }
        let changes = vec![json!({
            "id": "message-30",
            "snippet": { "type": "superChatEvent", "publishedAt": "2024-01-01T00:00:00Z", "superChatDetails": { "amountDisplayString": "$5", "userComment": "Replacement" } },
            "authorDetails": { "displayName": "Viewer Two" },
        }),
        json!({ "id": "delete", "snippet": { "type": "messageDeletedEvent", "messageDeletedDetails": { "deletedMessageId": "message-1" } } }),
        json!({ "id": "skip-one", "snippet": { "type": "unknown", "publishedAt": "2024-01-01T00:00:00Z", "displayMessage": "Ignored" }, "authorDetails": { "displayName": "Viewer" } }),
        json!({ "id": "skip-two", "snippet": { "type": "textMessageEvent", "publishedAt": "2024-01-01T00:00:00Z", "displayMessage": "Ignored" }, "authorDetails": {} }),
        ];
        let http = FakeHttp::reads(vec![
            ok(json!({ "items": items })), ok(json!({ "items": changes })),
        ], vec![]);
        let creds = FakeCreds::new(Some("refresh"));
        let now = AtomicU64::new(T0);
        let capped = run(&http, &creds, &now, |ctx| chat_with(ctx, T0, true));
        assert_eq!(capped.messages.len(), 30);
        assert_eq!(capped.messages.first().unwrap().id, "message-1");
        let answer = run(&http, &creds, &now, |ctx| chat_with(ctx, T0 + 10, true));
        assert_eq!(answer.messages.len(), 29);
        assert_eq!(answer.messages.last().unwrap().text, "Replacement");
        assert_eq!(answer.messages.last().unwrap().super_chat.as_deref(), Some("$5"));
        assert_eq!(answer.messages.iter().filter(|m| m.id == "message-30").count(), 1);
        assert!(!answer.messages.iter().any(|m| m.id == "message-1"));
    }

    #[test]
    fn chat_ended_quota_stale_and_hidden_cases_send_only_when_allowed() {
        let _guard = exclusive();
        let creds = FakeCreds::new(Some("refresh"));
        let now = AtomicU64::new(T0);
        let empty = FakeHttp::reads(vec![], vec![]);
        let off = run(&empty, &creds, &now, |ctx| chat_with(ctx, T0, true));
        assert_eq!(off.state, "off");
        assert!(empty.get_urls().is_empty());

        prime_token(); set_live_memory(T0);
        let ended = FakeHttp::reads(vec![reply(403, r#"{"error":{"errors":[{"reason":"liveChatEnded"}]}}"#)], vec![]);
        let answer = run(&ended, &creds, &now, |ctx| chat_with(ctx, T0, true));
        assert_eq!(answer.state, "ended");
        assert!(with_live(|v| v.chat_id.is_none()));

        clear(false); prime_token(); set_live_memory(T0);
        let offline = FakeHttp::reads(vec![ok(json!({
            "offlineAt": "2024-01-01T00:00:00Z", "items": [],
        }))], vec![]);
        assert_eq!(run(&offline, &creds, &now, |ctx| chat_with(ctx, T0, true)).state, "ended");

        clear(false); prime_token(); set_live_memory(T0);
        let missing = FakeHttp::reads(vec![reply(404, r#"{"error":{}}"#)], vec![]);
        assert_eq!(run(&missing, &creds, &now, |ctx| chat_with(ctx, T0, true)).state, "ended");

        clear(false); prime_token(); set_live_memory(T0);
        with_live(|v| { v.days(T0); v.chat_used = 3_996; });
        let quota = run(&empty, &creds, &now, |ctx| chat_with(ctx, T0, true));
        assert_eq!(quota.state, "quota");
        assert_eq!(quota.stopped_at, Some(T0));
        let again = run(&empty, &creds, &now, |ctx| chat_with(ctx, T0 + 20, true));
        assert_eq!(again.stopped_at, Some(T0));
        with_live(|v| { v.chat.read_at = Some(T0); v.chat.state = "ok"; });
        assert!(!with_live(|v| v.chat_answer(T0 + 59)).stale);
        assert!(with_live(|v| v.chat_answer(T0 + 60)).stale);
        let hidden = run(&empty, &creds, &now, |ctx| chat_with(ctx, T0 + 70, false));
        assert!(hidden.stale);
        assert!(empty.get_urls().is_empty());
    }

    #[test]
    fn clear_drops_memory_rejects_inflight_write_and_can_keep_counts() {
        let _guard = exclusive();
        set_live_memory(T0);
        with_live(|v| { v.days(T0); v.status_used = 17; v.chat_used = 25; v.page_token = Some("page".into()); });
        let old = GEN.load(Ordering::SeqCst);
        clear(true);
        assert!(put_live(old, |v| v.status.state = "live").is_none());
        with_live(|v| {
            assert!(v.channel.is_none());
            assert!(v.chat_id.is_none());
            assert!(v.page_token.is_none());
            assert!(v.chat.messages.is_empty());
            assert_eq!(v.status_used, 17);
            assert_eq!(v.chat_used, 25);
        });
        clear(false);
        with_live(|v| { assert_eq!(v.status_used, 17); assert_eq!(v.chat_used, 25); });
    }

    #[test]
    fn sign_out_clear_keeps_channel_file_but_drops_all_live_memory() {
        let _guard = exclusive();
        let dir = std::env::temp_dir().join(format!("wall-ytlive-clear-{}", std::process::id()));
        let path = dir.join("onair-channel.json");
        let _ = std::fs::remove_dir_all(&dir);
        write_channel(&path, &saved_channel()).unwrap();
        set_live_memory(T0);
        with_live(|v| v.chat.messages.push(ChatMessage {
            id: "message-one".into(), name: "Viewer One".into(), text: "Hello".into(),
            at: T0 * 1_000, super_chat: None,
        }));
        clear(false);
        assert!(read_channel(&path).is_some());
        with_live(|v| {
            assert!(v.chat_id.is_none());
            assert!(v.chat.messages.is_empty());
            assert!(v.status.read_at.is_none());
        });
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn failed_status_and_chat_attempts_hold_their_floors() {
        let _guard = exclusive();
        prime_token();
        let status_http = FakeHttp::reads(vec![reply(500, "")], vec![]);
        let creds = FakeCreds::new(Some("refresh"));
        let now = AtomicU64::new(T0);
        let first = run(&status_http, &creds, &now, |ctx| {
            status_with(ctx, Some(saved_channel()), T0, false, true)
        });
        assert_eq!(first.word, Some(DOWN));
        run(&status_http, &creds, &now, |ctx| {
            status_with(ctx, Some(saved_channel()), T0 + 1, false, true)
        });
        assert_eq!(status_http.get_urls().len(), 1);

        reset_for_test();
        prime_token();
        with_live(|v| {
            v.candidates = vec![video_id(1)];
            v.find_attempt = Some(T0 - STATUS_FLOOR);
        });
        let details_http = FakeHttp::reads(vec![reply(500, "")], vec![]);
        run(&details_http, &creds, &now, |ctx| {
            status_with(ctx, Some(saved_channel()), T0 + 61, false, true)
        });
        run(&details_http, &creds, &now, |ctx| {
            status_with(ctx, Some(saved_channel()), T0 + 62, false, true)
        });
        assert_eq!(details_http.get_urls().len(), 1);
        with_live(|v| assert_eq!(v.details_attempt, Some(T0 + 61)));

        reset_for_test(); prime_token(); set_live_memory(T0);
        let chat_http = FakeHttp::reads(vec![reply(500, "")], vec![]);
        let chat_first = run(&chat_http, &creds, &now, |ctx| chat_with(ctx, T0, true));
        assert_eq!(chat_first.word, Some(DOWN));
        run(&chat_http, &creds, &now, |ctx| chat_with(ctx, T0 + 1, true));
        assert_eq!(chat_http.get_urls().len(), 1);
    }

    #[test]
    fn racing_status_and_chat_calls_each_send_once() {
        let _guard = exclusive();
        prime_token();
        with_live(|v| {
            v.candidates = vec![video_id(1)];
            v.find_attempt = Some(T0 - STATUS_FLOOR);
        });
        let status_http = Arc::new(HoldingHttp::new(ok(videos(vec![]))));
        let status_creds = Arc::new(FakeCreds::new(Some("refresh")));
        let first_http = status_http.clone();
        let first_creds = status_creds.clone();
        let status_result = spawn_result(move || {
            let client = client(); let clock = || T0;
            let ctx = Ctx { http: first_http.as_ref(), creds: first_creds.as_ref(), client: &client, now: &clock };
            status_with(&ctx, Some(saved_channel()), T0, false, true)
        });
        status_http.wait_entered();
        let status_client = client();
        let clock = || T0 + STATUS_FLOOR;
        let ctx = Ctx {
            http: status_http.as_ref(),
            creds: status_creds.as_ref(),
            client: &status_client,
            now: &clock,
        };
        let second = status_with(
            &ctx,
            Some(saved_channel()),
            T0 + STATUS_FLOOR,
            false,
            true,
        );
        assert_eq!(second.read_at, None);
        assert_eq!(status_http.calls.load(Ordering::SeqCst), 1);
        status_http.release();
        assert_eq!(receive_result(status_result, "racing status read").state, "none");

        reset_for_test(); prime_token(); set_live_memory(T0);
        let chat_http = Arc::new(HoldingHttp::new(ok(json!({ "items": [] }))));
        let chat_creds = Arc::new(FakeCreds::new(Some("refresh")));
        let first_http = chat_http.clone();
        let first_creds = chat_creds.clone();
        let chat_result = spawn_result(move || {
            let client = client(); let clock = || T0;
            let ctx = Ctx { http: first_http.as_ref(), creds: first_creds.as_ref(), client: &client, now: &clock };
            chat_with(&ctx, T0, true)
        });
        chat_http.wait_entered();
        let client = client(); let clock = || T0 + CHAT_FLOOR;
        let ctx = Ctx { http: chat_http.as_ref(), creds: chat_creds.as_ref(), client: &client, now: &clock };
        assert_eq!(chat_with(&ctx, T0 + CHAT_FLOOR, true).read_at, None);
        assert_eq!(chat_http.calls.load(Ordering::SeqCst), 1);
        chat_http.release();
        assert_eq!(receive_result(chat_result, "racing chat read").state, "ok");
    }

    #[test]
    fn busy_and_quota_all_from_chat_stop_status_and_survive_clear() {
        let _guard = exclusive();
        let creds = FakeCreds::new(Some("refresh"));
        let now = AtomicU64::new(T0);
        for (status, body, expected) in [
            (429, "{}", BUSY),
            (403, r#"{"error":{"errors":[{"reason":"rateLimitExceeded"}]}}"#, BUSY),
            (403, r#"{"error":{"errors":[{"reason":"quotaExceeded"}]}}"#, QUOTA_ALL),
        ] {
            reset_for_test(); prime_token(); set_live_memory(T0);
            let chat_http = FakeHttp::reads(vec![reply(status, body)], vec![]);
            let answer = run(&chat_http, &creds, &now, |ctx| chat_with(ctx, T0, true));
            assert_eq!(answer.word, Some(expected));
            clear(false);
            let status_http = FakeHttp::reads(vec![], vec![]);
            run(&status_http, &creds, &now, |ctx| {
                status_with(ctx, Some(saved_channel()), T0 + 1, false, true)
            });
            assert!(status_http.get_urls().is_empty());
            with_live(|v| {
                if expected == BUSY { assert!(v.busy_until >= T0 + 60); }
                else { assert_eq!(v.quota_all_day, Some(pacific_day(T0))); }
            });
        }
    }

    #[test]
    fn begin_attempt_refuses_a_crossing_budget_before_get() {
        let _guard = exclusive();
        prime_token();
        with_live(|v| {
            v.days(T0);
            v.status_used = STATUS_DAILY_UNITS;
        });
        let http = FakeHttp::reads(vec![], vec![]);
        let creds = FakeCreds::new(Some("refresh"));
        let now = AtomicU64::new(T0);
        let generation = GEN.load(Ordering::SeqCst);
        let result = run(&http, &creds, &now, |ctx| {
            live_get(
                ctx,
                "playlistItems",
                &[],
                ReadKind::Find,
                generation,
                T0,
            )
        });
        assert_eq!(result.err(), Some("quota"));
        assert!(http.get_urls().is_empty());
        with_live(|v| assert_eq!(v.find_attempt, None));
    }

    #[test]
    fn budgets_count_get_attempts_but_not_refresh_or_transport_failures() {
        let _guard = exclusive();
        let creds = FakeCreds::new(Some("refresh"));
        let now = AtomicU64::new(T0);

        let refresh_fail = FakeHttp::reads(vec![], vec![Err(())]);
        run(&refresh_fail, &creds, &now, |ctx| {
            status_with(ctx, Some(saved_channel()), T0, false, true)
        });
        with_live(|v| { assert_eq!(v.status_used, 0); assert_eq!(v.find_attempt, None); });

        reset_for_test(); prime_token();
        let transport = FakeHttp::reads(vec![Err(())], vec![]);
        run(&transport, &creds, &now, |ctx| {
            status_with(ctx, Some(saved_channel()), T0, false, true)
        });
        with_live(|v| { assert_eq!(v.status_used, 0); assert_eq!(v.find_attempt, Some(T0)); });

        reset_for_test(); prime_token();
        let unauthorized = FakeHttp::reads(vec![
            reply(401, "{}"), ok(json!({ "items": [] })),
        ], vec![super::super::tests::tokens(None, None)]);
        let answer = run(&unauthorized, &creds, &now, |ctx| {
            status_with(ctx, Some(saved_channel()), T0, false, true)
        });
        assert_eq!(answer.state, "none");
        assert_eq!(unauthorized.get_urls().len(), 2);
        with_live(|v| assert_eq!(v.status_used, 2));

        reset_for_test();
        prime_token();
        set_live_memory(T0);
        let chat_unauthorized = FakeHttp::reads(
            vec![reply(401, "{}"), ok(json!({ "items": [] }))],
            vec![super::super::tests::tokens(None, None)],
        );
        run(&chat_unauthorized, &creds, &now, |ctx| {
            chat_with(ctx, T0, true)
        });
        assert_eq!(chat_unauthorized.get_urls().len(), 2);
        with_live(|v| assert_eq!(v.chat_used, 10));
    }

    #[test]
    fn generation_clear_drops_held_success_and_error_results_but_keeps_channel_file() {
        let _guard = exclusive();
        let dir = std::env::temp_dir().join(format!("wall-ytlive-generation-{}", std::process::id()));
        let path = dir.join("onair-channel.json");
        let _ = std::fs::remove_dir_all(&dir);
        write_channel(&path, &saved_channel()).unwrap();
        for (answer, expect_busy) in [
            (ok(json!({ "items": [] })), false),
            (reply(429, ""), true),
        ] {
            reset_for_test(); prime_token();
            let http = Arc::new(HoldingHttp::new(answer));
            let creds = Arc::new(FakeCreds::new(Some("refresh")));
            let first_http = http.clone(); let first_creds = creds.clone();
            let worker = spawn_result(move || {
                let client = client(); let clock = || T0;
                let ctx = Ctx { http: first_http.as_ref(), creds: first_creds.as_ref(), client: &client, now: &clock };
                status_with(&ctx, Some(saved_channel()), T0, false, true)
            });
            http.wait_entered();
            clear(true);
            with_live(|v| { v.status.state = "signed-out"; v.status.word = None; });
            http.release();
            let _ = receive_result(worker, "held status read across clear");
            with_live(|v| {
                assert_eq!(v.status.state, "signed-out");
                assert_eq!(v.status.word, None);
                assert_eq!(v.status.read_at, None);
                assert_eq!(v.busy_until >= T0 + 60, expect_busy);
            });
            assert!(read_channel(&path).is_some());
        }

        reset_for_test();
        prime_token();
        write_channel(&path, &Channel {
            channel_id: channel_id(),
            title: "Original Channel".into(),
        }).unwrap();
        let http = Arc::new(HoldingHttp::new(ok(json!({ "items": [{
            "id": format!("UC{}", "b".repeat(22)),
            "snippet": { "title": "Replacement Channel" }
        }] }))));
        let creds = Arc::new(FakeCreds::new(Some("refresh")));
        let first_http = http.clone();
        let first_creds = creds.clone();
        let worker_path = path.clone();
        let worker = spawn_result(move || {
            let client = client();
            let clock = || T0;
            let ctx = Ctx {
                http: first_http.as_ref(),
                creds: first_creds.as_ref(),
                client: &client,
                now: &clock,
            };
            let (channel, generation) = set_channel_with(
                &ctx,
                ChannelRef::Id(channel_id()),
                T0,
            )?;
            finish_channel_write(generation, &worker_path, &channel)
        });
        http.wait_entered();
        clear(true);
        http.release();
        assert_eq!(
            receive_result(worker, "held channel write across clear"),
            Err(FAILED)
        );
        assert_eq!(read_channel(&path).unwrap().title, "Original Channel");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parser_accepts_fraction_offsets_and_refuses_multibyte_or_signed_fields() {
        let _guard = exclusive();
        assert_eq!(rfc3339("2024-01-01T00:00:00.123Z"), Some(T0));
        assert_eq!(rfc3339("2024-01-01T02:30:00+02:30"), Some(T0));
        assert_eq!(rfc3339("2023-12-31T16:00:00-08:00"), Some(T0));
        for bad in [
            "2024-01-01T00:00:00.éZ", "-024-01-01T00:00:00Z",
            "2024--1-01T00:00:00Z", "2024-01-01T-1:00:00Z",
            "2024-01-01T00:00:00.Z", "2024-01-01T00:00:00+24:00",
            "2024-01-01T00:00:00+-1:00", "2024-01-01T00:00:00++1:00",
            "2024-01-01T00:00:00+01:-1", "2024-01-01T00:00:00+00:60",
        ] { assert_eq!(rfc3339(bad), None, "{bad}"); }
    }

    #[test]
    fn message_ids_allow_dots_only_in_memory_and_empty_text_is_skipped() {
        let _guard = exclusive();
        assert!(valid_message_id("message.part_1-2"));
        assert!(valid_message_id(&"a".repeat(200)));
        assert!(!valid_message_id(&"a".repeat(201)));
        assert!(!valid_message_id("message/part"));
        assert!(!id_chars("message.part", 1..=128));
        prime_token(); set_live_memory(T0);
        let http = FakeHttp::reads(vec![ok(json!({ "items": [
            { "id": "message.part", "snippet": { "type": "textMessageEvent", "publishedAt": "2024-01-01T00:00:00.100Z", "displayMessage": "Hello" }, "authorDetails": { "displayName": "Viewer One" } },
            { "id": "empty.part", "snippet": { "type": "textMessageEvent", "publishedAt": "2024-01-01T00:00:00+00:00", "displayMessage": "" }, "authorDetails": { "displayName": "Viewer Two" } }
        ] }))], vec![]);
        let creds = FakeCreds::new(Some("refresh")); let now = AtomicU64::new(T0);
        let answer = run(&http, &creds, &now, |ctx| chat_with(ctx, T0, true));
        assert_eq!(answer.messages.len(), 1);
        assert_eq!(answer.messages[0].id, "message.part");
    }

    #[test]
    fn chat_bad_page_token_is_dropped_and_nonended_403_stays_an_error() {
        let _guard = exclusive();
        prime_token(); set_live_memory(T0);
        with_live(|v| v.page_token = Some("page-one".into()));
        let http = FakeHttp::reads(vec![
            reply(400, "{}"), ok(json!({ "items": [] })),
        ], vec![]);
        let creds = FakeCreds::new(Some("refresh")); let now = AtomicU64::new(T0);
        let first = run(&http, &creds, &now, |ctx| chat_with(ctx, T0, true));
        assert_eq!(first.word, Some(super::super::INVALID));
        assert_eq!(with_live(|v| v.page_token.clone()), None);
        run(&http, &creds, &now, |ctx| chat_with(ctx, T0 + 10, true));
        assert!(!http.get_urls()[1].contains("pageToken"));

        reset_for_test(); prime_token(); set_live_memory(T0);
        let denied = FakeHttp::reads(vec![reply(403, r#"{"error":{"errors":[{"reason":"forbidden"}]}}"#)], vec![]);
        let answer = run(&denied, &creds, &now, |ctx| chat_with(ctx, T0, true));
        assert_eq!(answer.state, "ok");
        assert_eq!(answer.word, Some(DOWN));

        reset_for_test(); prime_token(); set_live_memory(T0);
        let disabled = FakeHttp::reads(vec![reply(403, r#"{"error":{"errors":[{"reason":"liveChatDisabled"}]}}"#)], vec![]);
        let answer = run(&disabled, &creds, &now, |ctx| chat_with(ctx, T0, true));
        assert_eq!(answer.state, "ended");
        assert!(!with_live(|v| v.status.chat));
    }

    #[test]
    fn empty_missing_and_long_candidate_lists_are_bounded_without_empty_video_read() {
        let _guard = exclusive();
        let creds = FakeCreds::new(Some("refresh")); let now = AtomicU64::new(T0);
        for first in [ok(json!({ "items": [] })), reply(404, "{}") ] {
            reset_for_test(); prime_token();
            let http = FakeHttp::reads(vec![first], vec![]);
            let answer = run(&http, &creds, &now, |ctx| {
                status_with(ctx, Some(saved_channel()), T0, false, true)
            });
            assert_eq!(answer.state, "none");
            assert_eq!(answer.word, None);
            assert_eq!(http.get_urls().len(), 1);
            assert!(!http.get_urls()[0].contains("videos?"));
        }

        reset_for_test(); prime_token();
        let ids: Vec<String> = (0..7).map(video_id).collect();
        let http = FakeHttp::reads(vec![ok(candidates(&ids)), ok(videos(vec![]))], vec![]);
        run(&http, &creds, &now, |ctx| {
            status_with(ctx, Some(saved_channel()), T0, false, true)
        });
        let videos_url = &http.get_urls()[1];
        for id in ids.iter().take(5) { assert!(videos_url.contains(id)); }
        for id in ids.iter().skip(5) { assert!(!videos_url.contains(id)); }
    }

    #[test]
    fn ended_persists_new_chat_clears_old_data_and_two_hour_forget_runs_in_status() {
        let _guard = exclusive();
        prime_token(); set_live_memory(T0);
        let creds = FakeCreds::new(Some("refresh")); let now = AtomicU64::new(T0);
        let ended_http = FakeHttp::reads(vec![reply(404, "{}")], vec![]);
        assert_eq!(run(&ended_http, &creds, &now, |ctx| chat_with(ctx, T0, true)).state, "ended");
        let no_more = FakeHttp::reads(vec![], vec![]);
        assert_eq!(run(&no_more, &creds, &now, |ctx| chat_with(ctx, T0 + 20, true)).state, "ended");
        assert!(no_more.get_urls().is_empty());
        assert!(!with_live(|v| v.status.chat));
        let none_http = FakeHttp::reads(vec![ok(json!({ "items": [] }))], vec![]);
        let none = run(&none_http, &creds, &now, |ctx| {
            status_with(
                ctx,
                Some(saved_channel()),
                T0 + STATUS_FLOOR,
                false,
                true,
            )
        });
        assert_eq!(none.state, "none");
        assert_eq!(with_live(|v| v.chat.state), "ended");
        assert_eq!(none_http.get_urls().len(), 1);

        reset_for_test(); prime_token(); set_live_memory(T0 - 61);
        with_live(|v| {
            v.candidates = vec![video_id(1)]; v.find_attempt = Some(T0 - 61);
            v.page_token = Some("old-page".into());
            v.chat.messages.push(ChatMessage { id: "old.message".into(), name: "Viewer".into(), text: "Old".into(), at: T0, super_chat: None });
        });
        let details = FakeHttp::reads(vec![ok(videos(vec![live_video(&video_id(1), "1", Some("new-chat"))]))], vec![]);
        let answer = run(&details, &creds, &now, |ctx| {
            status_with(ctx, Some(saved_channel()), T0, false, true)
        });
        assert!(answer.chat);
        with_live(|v| { assert!(v.page_token.is_none()); assert!(v.chat.messages.is_empty()); });

        reset_for_test(); prime_token(); set_live_memory(T0);
        with_live(|v| v.chat.messages.push(ChatMessage { id: "old.message".into(), name: "Viewer".into(), text: "Old".into(), at: T0, super_chat: None }));
        let hidden = FakeHttp::reads(vec![], vec![]);
        run(&hidden, &creds, &now, |ctx| {
            status_with(ctx, Some(saved_channel()), T0 + CHAT_FORGET, false, false)
        });
        with_live(|v| { assert!(v.chat_id.is_none()); assert!(v.chat.messages.is_empty()); assert!(!v.status.chat); });
    }

    #[test]
    fn chat_default_floor_hint_cap_viewer_bound_and_field_caps_hold() {
        let _guard = exclusive();
        let creds = FakeCreds::new(Some("refresh")); let now = AtomicU64::new(T0);
        prime_token(); set_live_memory(T0);
        let default_http = FakeHttp::reads(vec![ok(json!({ "items": [] })), ok(json!({ "items": [] }))], vec![]);
        run(&default_http, &creds, &now, |ctx| chat_with(ctx, T0, true));
        run(&default_http, &creds, &now, |ctx| chat_with(ctx, T0 + 9, true));
        run(&default_http, &creds, &now, |ctx| chat_with(ctx, T0 + 10, true));
        assert_eq!(default_http.get_urls().len(), 2);

        reset_for_test(); prime_token(); set_live_memory(T0);
        let capped_http = FakeHttp::reads(vec![
            ok(json!({ "pollingIntervalMillis": 120_000, "items": [] })), ok(json!({ "items": [] })),
        ], vec![]);
        run(&capped_http, &creds, &now, |ctx| chat_with(ctx, T0, true));
        run(&capped_http, &creds, &now, |ctx| chat_with(ctx, T0 + 59, true));
        run(&capped_http, &creds, &now, |ctx| chat_with(ctx, T0 + 60, true));
        assert_eq!(capped_http.get_urls().len(), 2);

        reset_for_test(); prime_token();
        let ids = vec![video_id(1)];
        let status_http = FakeHttp::reads(vec![
            ok(candidates(&ids)), ok(videos(vec![live_video(&ids[0], "10000000", None)])),
        ], vec![]);
        let status = run(&status_http, &creds, &now, |ctx| {
            status_with(ctx, Some(saved_channel()), T0, false, true)
        });
        assert_eq!(status.viewers, Some(10_000_000));

        reset_for_test();
        prime_token();
        let over_http = FakeHttp::reads(vec![
            ok(candidates(&ids)),
            ok(videos(vec![live_video(&ids[0], "10000001", None)])),
        ], vec![]);
        let over = run(&over_http, &creds, &now, |ctx| {
            status_with(ctx, Some(saved_channel()), T0, false, true)
        });
        assert_eq!(over.viewers, None);

        reset_for_test(); prime_token(); set_live_memory(T0);
        let fields_http = FakeHttp::reads(vec![ok(json!({ "items": [{
            "id": "field.message",
            "snippet": {
                "type": "superChatEvent",
                "publishedAt": "2024-01-01T00:00:00Z",
                "superChatDetails": {
                    "amountDisplayString": "12345678901234567890",
                    "userComment": "x".repeat(250)
                }
            },
            "authorDetails": { "displayName": "n".repeat(50) }
        }] }))], vec![]);
        let chat = run(&fields_http, &creds, &now, |ctx| chat_with(ctx, T0, true));
        assert_eq!(chat.messages[0].name.chars().count(), 40);
        assert_eq!(chat.messages[0].text.chars().count(), 200);
        assert_eq!(chat.messages[0].super_chat.as_ref().unwrap().chars().count(), 16);
    }

    #[test]
    fn malformed_oversized_timeout_and_server_answers_are_fixed_down_words() {
        let _guard = exclusive();
        let creds = FakeCreds::new(Some("refresh")); let now = AtomicU64::new(T0);
        for answer in [reply(200, "not-json"), reply(598, ""), Err(()), reply(500, "")] {
            reset_for_test(); prime_token();
            let http = FakeHttp::reads(vec![answer], vec![]);
            let result = run(&http, &creds, &now, |ctx| {
                status_with(ctx, Some(saved_channel()), T0, false, true)
            });
            assert_eq!(result.word, Some(DOWN));
        }
    }

    #[test]
    fn exact_masks_and_bearer_are_used_for_status_and_chat() {
        let _guard = exclusive();
        prime_token();
        let ids = vec![video_id(1)];
        let status_http = FakeHttp::reads(vec![ok(candidates(&ids)), ok(videos(vec![]))], vec![]);
        let creds = FakeCreds::new(Some("refresh")); let now = AtomicU64::new(T0);
        run(&status_http, &creds, &now, |ctx| {
            status_with(ctx, Some(saved_channel()), T0, false, true)
        });
        let uploads = format!("UU{}", &channel_id()[2..]);
        let expected_find = api_url("playlistItems", &[
            ("part", "contentDetails"), ("playlistId", uploads.as_str()),
            ("maxResults", "5"), ("fields", "items/contentDetails/videoId"),
        ]);
        let expected_details = api_url("videos", &[
            ("part", "snippet,liveStreamingDetails"), ("id", ids[0].as_str()),
            (
                "fields",
                "items(id,snippet/liveBroadcastContent,liveStreamingDetails(actualStartTime,actualEndTime,scheduledStartTime,concurrentViewers,activeLiveChatId))",
            ),
        ]);
        assert_eq!(status_http.get_urls(), vec![expected_find, expected_details]);
        assert_eq!(status_http.get_bearers(), vec!["access-one", "access-one"]);

        reset_for_test(); prime_token(); set_live_memory(T0);
        let chat_http = FakeHttp::reads(vec![ok(json!({ "items": [] }))], vec![]);
        run(&chat_http, &creds, &now, |ctx| chat_with(ctx, T0, true));
        let expected_chat = api_url("liveChat/messages", &[
            ("liveChatId", "chat-room"), ("part", "snippet,authorDetails"),
            ("maxResults", "200"),
            (
                "fields",
                concat!(
                    "nextPageToken,pollingIntervalMillis,offlineAt,items(id,snippet(",
                    "type,publishedAt,displayMessage,superChatDetails(amountDisplayString,",
                    "userComment),messageDeletedDetails/deletedMessageId),",
                    "authorDetails/displayName)"
                ),
            ),
        ]);
        assert_eq!(chat_http.get_urls(), vec![expected_chat]);
        assert_eq!(chat_http.get_bearers(), vec!["access-one"]);
    }

    #[test]
    fn pacific_day_handles_utc_and_local_midnight_crossings() {
        let _guard = exclusive();
        let same_utc_before = rfc3339("2024-01-01T07:59:00Z").unwrap();
        let same_utc_after = rfc3339("2024-01-01T08:01:00Z").unwrap();
        assert_ne!(pacific_day(same_utc_before), pacific_day(same_utc_after));
        let prior_utc = rfc3339("2024-01-01T23:59:00Z").unwrap();
        let next_utc = rfc3339("2024-01-02T00:01:00Z").unwrap();
        assert_eq!(pacific_day(prior_utc), pacific_day(next_utc));

        reset_for_test();
        with_live(|v| {
            v.days(same_utc_before);
            v.status_used = 7;
            v.chat_used = 10;
            v.days(same_utc_after);
            assert_eq!(v.status_used, 0);
            assert_eq!(v.chat_used, 0);

            v.status_used = 8;
            v.chat_used = 15;
            v.days(prior_utc);
            v.days(next_utc);
            assert_eq!(v.status_used, 8);
            assert_eq!(v.chat_used, 15);
        });
    }

    #[test]
    fn channel_write_replaces_atomically_and_zero_items_leave_no_file() {
        let _guard = exclusive();
        let dir = std::env::temp_dir().join(format!("wall-ytlive-replace-{}", std::process::id()));
        let path = dir.join("onair-channel.json");
        let _ = std::fs::remove_dir_all(&dir);
        let first = Channel { channel_id: channel_id(), title: "First Channel".into() };
        let second = Channel { channel_id: format!("UC{}", "b".repeat(22)), title: "Second Channel".into() };
        let first_gen = GEN.load(Ordering::SeqCst);
        finish_channel_write(first_gen, &path, &first).unwrap();
        let second_gen = GEN.load(Ordering::SeqCst);
        finish_channel_write(second_gen, &path, &second).unwrap();
        assert_eq!(read_channel(&path).unwrap().title, "Second Channel");
        assert!(!std::fs::read_dir(&dir).unwrap().any(|entry| entry.unwrap().path().extension().and_then(|v| v.to_str()) == Some("tmp")));

        std::fs::remove_file(&path).unwrap();
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        prime_token();
        let http = FakeHttp::reads(vec![ok(json!({ "items": [] }))], vec![]);
        let creds = FakeCreds::new(Some("refresh")); let now = AtomicU64::new(T0);
        assert_eq!(run(&http, &creds, &now, |ctx| set_channel_with(ctx, ChannelRef::Id(channel_id()), T0)).err(), Some(NOT_FOUND));
        assert!(!path.exists());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);

        reset_for_test();
        prime_token();
        let title_http = FakeHttp::reads(vec![ok(json!({ "items": [{
            "id": channel_id(),
            "snippet": { "title": "t".repeat(120) }
        }] }))], vec![]);
        let (channel, generation) = run(&title_http, &creds, &now, |ctx| {
            set_channel_with(ctx, ChannelRef::Id(channel_id()), T0)
        }).unwrap();
        assert_eq!(channel.title.chars().count(), 100);
        finish_channel_write(generation, &path, &channel).unwrap();
        assert!(path.is_file());
        assert_eq!(read_channel(&path).unwrap().title.chars().count(), 100);

        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();
        assert_eq!(write_channel(&path, &first), Err(FAILED));
        assert!(!std::fs::read_dir(&dir).unwrap().any(|entry| {
            entry.unwrap().path().extension().and_then(|v| v.to_str()) == Some("tmp")
        }));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn session_clears_use_live_hook_and_preserve_client_wide_accounting() {
        let _guard = exclusive();
        let seed = || with_live(|v| {
            v.days(T0); v.status_used = 11; v.chat_used = 15;
            v.quota_all_day = Some(v.status_day); v.busy_until = T0 + 60;
            v.channel = Some(saved_channel()); v.status.read_at = Some(T0);
        });
        let check = || with_live(|v| {
            assert!(v.channel.is_none()); assert!(v.status.read_at.is_none());
            assert_eq!(v.status_used, 11); assert_eq!(v.chat_used, 15);
            assert_eq!(v.quota_all_day, Some(pacific_day(T0))); assert_eq!(v.busy_until, T0 + 60);
        });

        seed(); super::super::reset_session(); check();
        reset_for_test(); seed();
        let creds = FakeCreds::new(Some("dead-refresh"));
        let invalid = FakeHttp::reads(vec![], vec![reply(400, r#"{"error":"invalid_grant"}"#)]);
        assert_eq!(super::super::access_with(&client(), false, &invalid, &creds).err(), Some(SIGN_AGAIN));
        check();
        reset_for_test(); seed();
        let creds = FakeCreds::new(None);
        super::super::save_sign_in(&creds, "new-refresh", "access-two".into(), 3_600).unwrap();
        check();
    }

    #[test]
    fn set_channel_words_are_exactly_the_public_contract() {
        let _guard = exclusive();
        assert_eq!(set_channel_word(SIGN_AGAIN), "signed-out");
        assert_eq!(set_channel_word(NOT_FOUND), "not found");
        assert_eq!(set_channel_word("quota"), QUOTA_ALL);
        assert_eq!(set_channel_word(QUOTA_ALL), QUOTA_ALL);
        assert_eq!(set_channel_word(BUSY), BUSY);
        assert_eq!(set_channel_word(DOWN), DOWN);
        assert_eq!(set_channel_word(super::super::SETUP_BROKEN), super::super::SETUP_BROKEN);
        assert_eq!(set_channel_word(super::super::NOT_SETUP), FAILED);
        assert_eq!(set_channel_word(super::super::UNREADABLE), FAILED);
    }

    #[test]
    fn utc_parser_has_strict_edges() {
        let _guard = exclusive();
        assert_eq!(rfc3339("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(rfc3339("2024-02-29T12:34:56Z"), Some(1_709_210_096));
        for bad in [
            "2023-02-29T00:00:00Z", "2024-01-01T24:00:00Z",
            "2024-1-01T00:00:00Z",
        ] { assert_eq!(rfc3339(bad), None); }
        assert_eq!(rfc3339("2024-01-01T00:00:00+00:00"), Some(T0));
    }

    #[test]
    fn logs_never_contain_chat_names_text_ids_or_tokens() {
        let _guard = exclusive();
        let before = crate::wall2_youtube_log::test_lines().len();
        prime_token(); set_live_memory(T0);
        let http = FakeHttp::reads(vec![ok(json!({
            "nextPageToken": "private-page-token",
            "items": [{
                "id": "private-message-id",
                "snippet": { "type": "textMessageEvent", "publishedAt": "2024-01-01T00:00:00Z", "displayMessage": "Private message text" },
                "authorDetails": { "displayName": "Private Viewer" },
            }],
        }))], vec![]);
        let creds = FakeCreds::new(Some("refresh"));
        let now = AtomicU64::new(T0);
        run(&http, &creds, &now, |ctx| chat_with(ctx, T0, true));
        let lines = crate::wall2_youtube_log::test_lines();
        let added = lines[before..].join("");
        assert!(added.contains("chat-ok none 200"));
        for private in ["Private", "message", "private-message-id", "private-page-token"] {
            assert!(!added.contains(private), "{private}");
        }
    }
}
