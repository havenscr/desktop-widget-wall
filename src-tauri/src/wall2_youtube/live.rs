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
const CHANNEL_MAX: u64 = 1_024;

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

pub(super) fn clear(keep_counts: bool) {
    let mut state = lock(&LIVE);
    GEN.fetch_add(1, Ordering::SeqCst);
    let kept = keep_counts.then(|| state.as_ref().map(|v| (v.status_day, v.status_used, v.chat_day, v.chat_used))).flatten();
    *state = kept.map(|(sd, su, cd, cu)| { let mut v = Live::new(); v.status_day = sd; v.status_used = su; v.chat_day = cd; v.chat_used = cu; v });
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
    let temp = parent.join("onair-channel.tmp");
    std::fs::write(&temp, bytes).map_err(|_| FAILED)?;
    std::fs::rename(&temp, path).map_err(|_| FAILED)
}

fn channel_state(channel: Option<Channel>) -> ChannelState { ChannelState { set: channel.is_some(), title: channel.map(|v| v.title) } }

fn live_get(ctx: &Ctx, endpoint: &str, params: &[(&str, &str)], chat: bool) -> Result<Value, &'static str> {
    use crate::wall2_youtube_log::{write, Event, Reason};
    let (ok, failed) = if chat { (Event::ChatOk, Event::ChatFailed) } else { (Event::LiveOk, Event::LiveFailed) };
    let url = api_url(endpoint, params);
    let started = Instant::now();
    let mut forced = false;
    loop {
        let token = access_with(ctx.client, forced, ctx.http, ctx.creds)?;
        let reply = match ctx.http.get(&url, &token, READ_BODY, READ_TIMEOUT) {
            Ok(v) => v,
            Err(()) => { write(failed, Reason::Down, 0, started.elapsed().as_millis()); return Err(DOWN) }
        };
        if reply.status == 401 && !forced { forced = true; continue }
        let ended = chat && chat_ended(&reply);
        let result = if ended { Err("ended") } else if (200..300).contains(&reply.status) { serde_json::from_slice(&reply.body).map_err(|_| DOWN) } else { Err(read_error(&reply, false)) };
        match result {
            Ok(value) => { write(ok, Reason::None, reply.status, started.elapsed().as_millis()); return Ok(value) }
            Err("ended") => { write(failed, Reason::Ended, reply.status, started.elapsed().as_millis()); return Err("ended") }
            Err(word) => { write(failed, reason_of(word), reply.status, started.elapsed().as_millis()); return Err(word) }
        }
    }
}

fn chat_ended(reply: &HttpReply) -> bool {
    if reply.status == 404 { return true }
    if reply.status != 403 { return false }
    let body: Value = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
    matches!(body.pointer("/error/errors/0/reason").and_then(Value::as_str), Some("liveChatEnded" | "liveChatNotFound" | "liveChatDisabled"))
}

fn resolve_channel(ctx: &Ctx, value: ChannelRef) -> Result<Channel, &'static str> {
    let (key, text) = match &value { ChannelRef::Handle(v) => ("forHandle", v.as_str()), ChannelRef::Id(v) => ("id", v.as_str()) };
    let answer = live_get(ctx, "channels", &[("part", "id,snippet"), ("fields", "items(id,snippet/title)"), (key, text)], false)?;
    let item = answer.get("items").and_then(Value::as_array).and_then(|v| v.first()).ok_or(NOT_FOUND)?;
    let id = item.get("id").and_then(Value::as_str).filter(|v| valid_channel_id(v)).ok_or(FAILED)?;
    let title = clean_text(item.pointer("/snippet/title"), 100).ok_or(FAILED)?;
    Ok(Channel { channel_id: id.to_string(), title })
}

fn set_channel_with(ctx: &Ctx, value: ChannelRef, now: u64) -> Result<Channel, &'static str> {
    if ctx.creds.load().ok().flatten().is_none() { return Err(SIGN_AGAIN) }
    with_live(|v| {
        v.days(now);
        if v.quota_all_day == Some(v.status_day) { return Err(QUOTA_ALL) }
        if now < v.busy_until { return Err(BUSY) }
        if v.status_used >= STATUS_DAILY_UNITS { return Err("quota") }
        v.status_used += 1;
        Ok(())
    })?;
    match resolve_channel(ctx, value) {
        Ok(channel) => Ok(channel),
        Err(word) => {
            with_live(|v| {
                if word == QUOTA_ALL { v.quota_all_day = Some(v.status_day); }
                if word == BUSY { v.busy_until = now + 60; }
            });
            Err(word)
        }
    }
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y }; let era = y.div_euclid(400); let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    era * 146_097 + (yoe * 365 + yoe / 4 - yoe / 100 + doy) - 719_468
}
fn leap(y: i64) -> bool { y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) }
fn rfc3339(text: &str) -> Option<u64> {
    if text.len() != 20 || &text[4..5] != "-" || &text[7..8] != "-" || &text[10..11] != "T" || &text[13..14] != ":" || &text[16..17] != ":" || &text[19..] != "Z" { return None }
    let n = |a, b| text.get(a..b)?.parse::<i64>().ok();
    let (y, m, d, h, min, sec) = (n(0,4)?, n(5,7)?, n(8,10)?, n(11,13)?, n(14,16)?, n(17,19)?);
    let md = [31, if leap(y) {29} else {28}, 31,30,31,30,31,31,30,31,30,31];
    if !(1970..=9999).contains(&y) || !(1..=12).contains(&m) || !(1..=md[(m-1) as usize]).contains(&d) || h > 23 || min > 59 || sec > 59 { return None }
    u64::try_from(days_from_civil(y,m,d) * 86_400 + h * 3600 + min * 60 + sec).ok()
}

fn status_error(now: u64, word: &'static str) -> LiveStatus {
    with_live(|v| { v.days(now); if word == QUOTA_ALL { v.quota_all_day = Some(v.status_day); } if word == BUSY { v.busy_until = now + 60; } v.status.word = Some(word); v.status_answer(now) })
}

fn status_with(ctx: &Ctx, channel: Option<Channel>, now: u64, fresh: bool, shown: bool) -> LiveStatus {
    if channel.is_none() { return with_live(|v| { v.channel = None; v.status.state = "not-set-up"; v.status.word = None; v.status.stale = false; v.status_answer(now) }) }
    if ctx.creds.load().ok().flatten().is_none() { return with_live(|v| { v.status.state = "signed-out"; v.status.word = None; v.status_answer(now) }) }
    let channel = channel.unwrap();
    let generation = GEN.load(Ordering::SeqCst);
    let plan = with_live(|v| {
        v.days(now); v.channel = Some(channel.clone());
        if !shown { return None }
        if v.quota_all_day == Some(v.status_day) || now < v.busy_until { return None }
        let floor = if fresh { STATUS_FRESH_FLOOR } else { STATUS_FLOOR };
        if v.status.read_at.is_some_and(|at| now.saturating_sub(at) < floor) { return None }
        let find = v.refresh_candidates || v.candidates_at.is_none_or(|at| now.saturating_sub(at) >= FIND_FLOOR);
        let cost = if find { 2 } else { 1 };
        if v.status_used + cost > STATUS_DAILY_UNITS { v.status.word = Some("quota"); return None }
        v.status_used += cost; Some((find, v.candidates.clone()))
    });
    let Some((find, mut ids)) = plan else { return with_live(|v| v.status_answer(now)) };
    if find {
        let uploads = format!("UU{}", &channel.channel_id[2..]);
        let params = [
            ("part", "contentDetails"), ("playlistId", uploads.as_str()),
            ("maxResults", "5"), ("fields", "items/contentDetails/videoId"),
        ];
        let answer = match live_get(ctx, "playlistItems", &params, false) {
            Ok(v) => v,
            Err(w) => return status_error(now, w),
        };
        ids = answer.get("items").and_then(Value::as_array).into_iter().flatten()
            .filter_map(|v| v.pointer("/contentDetails/videoId").and_then(Value::as_str))
            .filter(|v| id_chars(v, 11..=11)).map(str::to_string).collect();
        let _ = put_live(generation, |v| { v.candidates = ids.clone(); v.candidates_at = Some(now); v.refresh_candidates = false; });
    }
    let joined = ids.join(",");
    let fields = "items(id,snippet/liveBroadcastContent,liveStreamingDetails(\
        actualStartTime,actualEndTime,scheduledStartTime,concurrentViewers,activeLiveChatId))";
    let params = [("part", "snippet,liveStreamingDetails"), ("id", joined.as_str()), ("fields", fields)];
    let answer = match live_get(ctx, "videos", &params, false) {
        Ok(v) => v,
        Err(w) => return status_error(now, w),
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
            v.chat_id = item.pointer("/liveStreamingDetails/activeLiveChatId")
                .and_then(Value::as_str).filter(|s| id_chars(s, 1..=128))
                .map(str::to_string);
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

fn chat_with(ctx: &Ctx, now: u64, shown: bool) -> LiveChat {
    let generation = GEN.load(Ordering::SeqCst);
    let plan = with_live(|v| {
        v.days(now);
        if v.last_live_at.is_some_and(|at| now.saturating_sub(at) >= CHAT_FORGET) { v.drop_chat(false, now); }
        if v.status.state != "live"
            || v.status.read_at.is_none_or(|at| now.saturating_sub(at) > 120)
            || v.chat_id.is_none()
        {
            v.chat.state = "off";
            return None
        }
        if !shown || v.chat.read_at.is_some_and(|at| now.saturating_sub(at) < v.poll_secs.max(CHAT_FLOOR)) { return None }
        if v.chat_used + 5 > CHAT_DAILY_UNITS { v.chat.state = "quota"; v.chat.stopped_at.get_or_insert(now); return None }
        v.chat_used += 5; Some((v.chat_id.clone().unwrap(), v.page_token.clone()))
    });
    let Some((chat_id, token)) = plan else { return with_live(|v| v.chat_answer(now)) };
    let fields = "nextPageToken,pollingIntervalMillis,offlineAt,items(id,snippet(\
        type,publishedAt,displayMessage,superChatDetails(amountDisplayString,userComment),\
        messageDeletedDetails/deletedMessageId),authorDetails/displayName)";
    let mut params = vec![
        ("liveChatId", chat_id.as_str()), ("part", "snippet,authorDetails"),
        ("maxResults", "200"), ("fields", fields),
    ];
    if let Some(ref page) = token { params.push(("pageToken", page)); }
    let answer = match live_get(ctx, "liveChat/messages", &params, true) {
        Ok(v) => v,
        Err("ended") => { let _ = put_live(generation, |v| v.drop_chat(true, now)); return with_live(|v| v.chat_answer(now)) }
        Err(word) => { let _ = put_live(generation, |v| v.chat.word = Some(word)); return with_live(|v| v.chat_answer(now)) }
    };
    put_live(generation, |v| {
        if answer.get("offlineAt").is_some() { v.drop_chat(true, now); return }
        let mut messages: VecDeque<ChatMessage> = v.chat.messages.drain(..).collect();
        for item in answer.get("items").and_then(Value::as_array).into_iter().flatten() {
            let kind = item.pointer("/snippet/type").and_then(Value::as_str);
            if kind == Some("messageDeletedEvent") {
                if let Some(id) = item.pointer("/snippet/messageDeletedDetails/deletedMessageId")
                    .and_then(Value::as_str).filter(|s| id_chars(s, 1..=128))
                {
                    messages.retain(|m| m.id != id);
                }
                continue
            }
            if !matches!(kind, Some("textMessageEvent" | "superChatEvent")) { continue }
            let Some(id) = item.get("id").and_then(Value::as_str).filter(|s| id_chars(s, 1..=128)) else { continue };
            let Some(name) = clean_text(item.pointer("/authorDetails/displayName"), 40) else { continue };
            let Some(at) = item.pointer("/snippet/publishedAt").and_then(Value::as_str).and_then(rfc3339) else { continue };
            let text = if kind == Some("superChatEvent") {
                clean_text(item.pointer("/snippet/superChatDetails/userComment"), 200).unwrap_or_default()
            } else {
                clean_text(item.pointer("/snippet/displayMessage"), 200).unwrap_or_default()
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
        let channel = super::read_with_app(&app, |ctx| set_channel_with(ctx, value, (ctx.now)())).map_err(|v| v.to_string())?;
        write_channel(&file, &channel).map_err(str::to_string)?; clear(true); Ok(channel_state(Some(channel)))
    }).await.map_err(|_| FAILED.to_string())?
}

#[tauri::command]
pub async fn wall2_ytlive_forget_channel(window: tauri::WebviewWindow) -> Result<(), String> {
    super::require(&window)?; let file = path(window.app_handle())?;
    tauri::async_runtime::spawn_blocking(move || { if file.exists() { std::fs::remove_file(file).map_err(|_| FAILED.to_string())?; } clear(true); Ok(()) }).await.map_err(|_| FAILED.to_string())?
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
        if off { return Ok(with_live(|v| { v.chat.state = "off"; v.chat_answer(now) })) }
        super::read_with_app(&app, |ctx| Ok(chat_with(ctx, (ctx.now)(), crate::webview_shown())))
    }).await.map_err(|_| FAILED.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wall2_youtube::tests::{client, exclusive, reply, FakeCreds, FakeHttp};
    use serde_json::json;
    use std::sync::atomic::AtomicU64;

    const T0: u64 = 1_704_067_200;

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
        let channel = run(&http, &creds, &now, |ctx| {
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
        with_live(|v| v.status.read_at = Some(T0));
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
        with_live(|v| { assert_eq!(v.status_used, 0); assert_eq!(v.chat_used, 0); });
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
    fn utc_parser_has_strict_edges() {
        let _guard = exclusive();
        assert_eq!(rfc3339("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(rfc3339("2024-02-29T12:34:56Z"), Some(1_709_210_096));
        for bad in [
            "2023-02-29T00:00:00Z", "2024-01-01T24:00:00Z",
            "2024-01-01T00:00:00+00:00", "2024-1-01T00:00:00Z",
        ] { assert_eq!(rfc3339(bad), None); }
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
