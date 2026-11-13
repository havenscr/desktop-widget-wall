//! Wall 2 Home Sound block: reads the owner's Sonos service and sends the few commands the
//! block offers.
//!
//! The address comes from `feeds.json` (`sonosBaseUrl`) through the helpers in
//! `wall2_feeds.rs` (scheme, host and port only; plain `http` to a private address is
//! allowed, as for `homeBaseUrl`) and is never put in an error message or a log.
//!
//! Reads (`wall2_sonos_summary`, only when the front end asks): `GET /api/status`,
//! `/api/speakers`, `/api/routines`, `/api/groups`, `/api/group-presets`, `/api/scenes`
//! and `/api/sleep-timers`, side by side (the last four may fail on their own). An answer
//! with far more entries than the caps is refused as malformed; the rest is cut down to a
//! bounded, cleaned summary and kept as the last good read.
//!
//! Writes (each only on a click): every key, preset, speaker, group or timer id a write
//! names must be in the last good read (at most two minutes old), and every request body
//! is built here, never taken from the web view:
//! - `wall2_sonos_play`: `POST /api/trigger/<routine key>` (unforced, so the routine's own
//!   skip conditions apply; the answer becomes "started" or "skipped" with a fixed
//!   reason). `force: true` adds `?force=true` and is accepted only for the key whose
//!   last unforced call was answered "skipped" within the last minute ("Play anyway").
//! - `wall2_sonos_preset`: `POST /api/group-presets/<id>/apply`
//! - `wall2_sonos_volume`: `POST /api/action/volume` `{"room", "volume"}` per speaker; a
//!   group moves each of its music speakers by the same step from its own level, the
//!   writes in parallel
//! - `wall2_sonos_pause_all`: `POST /api/action/pause-all`
//! - `wall2_sonos_sleep`: `POST /api/sleep-timer` `{"minutes", "fadeMinutes": 5}`
//! - `wall2_sonos_sleep_cancel`: `DELETE /api/sleep-timer/<id>`
//!
//! Refused with `needs-confirm` unless the call carries `confirm: true` (the front end
//! asks first): any volume write whose target level is above 40, whatever the last read
//! said; a music routine whose volume is above 40 or not known (none of its own, or other
//! volume keys); a preset or a group-all control that touches a speaker above 40 or at an
//! unknown level, unless the preset itself sets that speaker to 40 or less (a line-in
//! group, the PC's own sound, does not count). Writes go out on an agent that never reuses
//! a pooled connection, so the HTTP client never re-sends one. Every command answers only
//! the `wall2` window.

use crate::wall2_feeds::{parse_iso, read_base, read_body, require_ok};
use crate::wall2_omni::require_wall2;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const TIMEOUT: Duration = Duration::from_secs(4);
const MAX_SPEAKERS: usize = 24;
const MAX_GROUPS: usize = 24;
const MAX_PRESETS: usize = 12;
const MAX_ROUTINES: usize = 48;
const MAX_SCENES: usize = 12;
const MAX_TIMERS: usize = 6;
const MAX_NAME_CHARS: usize = 60;
const MAX_TRACK_CHARS: usize = 120;
/// A map or list with more entries than this is a malformed read, refused whole.
const MAX_ENTRIES: usize = 500;
/// Names collected from one list (members, rooms) at most.
const MAX_NAMES: usize = 64;
/// "Play anyway" is accepted this long after the unforced call was skipped.
const SKIP_WINDOW: Duration = Duration::from_secs(60);
/// Routine keys that set volumes their own way; a routine carrying one has no known volume.
const OTHER_VOLUME_KEYS: [&str; 5] = ["volumes", "othersVolume", "volumeLevel", "volumeAdjust", "volumeRoom"];
/// The highest level a single call may raise a speaker to without `confirm: true`.
pub(crate) const SAFE_VOLUME: u8 = 40;
/// Writes are checked against a read no older than this (the front end reads every 30 s
/// and turns writes off after two minutes too).
const SUMMARY_MAX_AGE: Duration = Duration::from_secs(2 * 60);
const SLEEP_CHOICES: [u32; 3] = [30, 60, 90];
const SLEEP_FADE_MINUTES: u32 = 5;
/// Control routines the block may start. The others (TV volume profiles and the like) set
/// volumes of their own, so they are left out of the summary and cannot be triggered here.
const CONTROL_ACTIONS: [&str; 3] = ["pauseAll", "groupAll", "ungroupAll"];

const UNREACHABLE: &str = "Could not reach Sonos";
const REFUSED: &str = "Sonos could not do that";
const OUT_OF_DATE: &str = "Sonos status is out of date";
const PARTIAL: &str = "Some speakers did not change";
const UNFINISHED: &str = "The request did not finish";
/// Error text the front end reads as "ask first, then call again with confirm".
pub(crate) const NEEDS_CONFIRM: &str = "needs-confirm";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Speaker {
    pub name: String,
    /// `playing`, `paused`, `stopped`, `transitioning`, `offline` or `unknown`.
    pub state: String,
    pub volume: Option<u8>,
    /// `lineIn`, `tv` or `other`; None when the speaker plays its own queue.
    pub input: Option<String>,
    /// The id of the group the speaker is in.
    pub group: Option<String>,
    pub online: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub coordinator: String,
    pub members: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: String,
    pub name: String,
    /// The speakers are grouped the way this preset groups them right now.
    pub active: bool,
    /// The speakers that make applying it need a confirm; empty when one click is safe.
    pub loud: Vec<LoudSpeaker>,
}

/// A speaker an action would leave or set above 40, or whose level is not known.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoudSpeaker {
    pub name: String,
    /// The level the action sets (`sets`), else the level the speaker is at now; None when
    /// not known.
    pub level: Option<u8>,
    pub sets: bool,
}

/// What a play answered: started, or skipped with one of a few fixed reasons (None when
/// the service gave none this recognises). The service's own text never passes through.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayResult {
    pub started: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicRoutine {
    pub key: String,
    pub name: String,
    pub favorite: Option<String>,
    pub volume: Option<u8>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlRoutine {
    pub key: String,
    pub name: String,
    pub action: String,
    /// For a control that groups every speaker: the speakers that make it need a confirm.
    pub loud: Vec<LoudSpeaker>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SleepTimer {
    pub id: String,
    pub ends_at_ms: Option<i64>,
    pub fade_minutes: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub speaker: String,
    pub track: Option<String>,
    pub artist: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SonosSummary {
    pub speakers: Vec<Speaker>,
    pub groups: Vec<Group>,
    pub presets: Vec<Preset>,
    pub music: Vec<MusicRoutine>,
    pub controls: Vec<ControlRoutine>,
    pub scenes: Vec<Scene>,
    pub sleep_timers: Vec<SleepTimer>,
    /// What is playing, only when the service names a track.
    pub now_playing: Option<NowPlaying>,
    /// The group the block's one volume slider moves; None when no group plays music.
    pub current_group: Option<String>,
    pub read_at_ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VolumeTarget {
    /// `speaker` or `group`.
    pub kind: String,
    /// A speaker name or a group id from the last read.
    pub id: String,
}

// Section: cleaning

fn invisible(c: char) -> bool {
    c.is_control() || matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}')
}

/// One line of display text: control and direction characters become spaces, runs of
/// space collapse, and a long text is cut with an ellipsis. None when nothing is left.
fn clean_text(raw: &str, max: usize) -> Option<String> {
    let spaced: String = raw.chars().map(|c| if invisible(c) { ' ' } else { c }).collect();
    let text = spaced.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return None;
    }
    if text.chars().count() > max {
        let mut cut: String = text.chars().take(max.saturating_sub(1)).collect();
        cut.push('\u{2026}');
        return Some(cut);
    }
    Some(text)
}

/// A speaker name goes back to the service in a request body, so it must survive the
/// round trip unchanged: already clean and short, or the speaker is left out.
fn valid_speaker_name(name: &str) -> bool {
    clean_text(name, MAX_NAME_CHARS).is_some_and(|c| c == name)
}

/// Routine keys, preset, scene and timer ids go into a URL path: `^[A-Za-z0-9_-]{1,64}$`.
fn valid_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= 64 && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Group ids never go into a URL (a group is expanded to its speakers), but stay bounded.
fn valid_group_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 96 && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | ':' | '.'))
}

fn volume_of(v: Option<&Value>) -> Option<u8> {
    v.and_then(Value::as_f64).filter(|n| n.is_finite()).map(|n| n.round().clamp(0.0, 100.0) as u8)
}

fn speaker_state(raw: Option<&str>, online: bool) -> String {
    if !online {
        return "offline".to_string();
    }
    let s = raw.map(|r| r.trim().to_ascii_lowercase()).unwrap_or_default();
    let word = match s.as_str() {
        "playing" => "playing",
        "paused" | "paused_playback" => "paused",
        "stopped" => "stopped",
        "transitioning" => "transitioning",
        _ => "unknown",
    };
    word.to_string()
}

fn input_kind(raw: Option<&str>) -> Option<String> {
    let squashed: String = raw?.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_ascii_lowercase();
    if squashed.is_empty() {
        return None;
    }
    let kind = if squashed.contains("linein") {
        "lineIn"
    } else if squashed.contains("tv") || squashed.contains("hdmi") || squashed.contains("spdif") {
        "tv"
    } else {
        "other"
    };
    Some(kind.to_string())
}

fn id_text(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => n.as_u64().map(|n| n.to_string()),
        _ => None,
    }
}

/// The strings of a list, without repeats, at most `MAX_NAMES` (it stops reading there).
fn name_list(v: Option<&Value>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for n in v.and_then(Value::as_array).into_iter().flatten().take(MAX_ENTRIES).filter_map(Value::as_str) {
        if out.len() >= MAX_NAMES {
            break;
        }
        if !out.iter().any(|o| o == n) {
            out.push(n.to_string());
        }
    }
    out
}

/// A map or list with more entries than `MAX_ENTRIES` anywhere in the top two levels is
/// a malformed read.
fn too_big(v: &Value) -> bool {
    let len = |x: &Value| match x {
        Value::Object(m) => m.len(),
        Value::Array(a) => a.len(),
        _ => 0,
    };
    if len(v) > MAX_ENTRIES {
        return true;
    }
    match v {
        Value::Object(m) => m.values().any(|x| len(x) > MAX_ENTRIES),
        Value::Array(a) => a.iter().any(|x| len(x) > MAX_ENTRIES),
        _ => false,
    }
}

pub(crate) fn reads_too_big(r: &Reads) -> bool {
    [&r.status, &r.speakers, &r.routines, &r.groups, &r.presets, &r.scenes, &r.timers].into_iter().any(too_big)
}

fn same_set(a: &[String], b: &[String]) -> bool {
    a.len() == b.len() && a.iter().all(|x| b.contains(x))
}

// Section: shaping

/// The raw answers of one read.
pub(crate) struct Reads {
    pub status: Value,
    pub speakers: Value,
    pub routines: Value,
    pub groups: Value,
    pub presets: Value,
    pub scenes: Value,
    pub timers: Value,
}

fn pick_speakers(speakers: &Value, status: &Value) -> Vec<Speaker> {
    let mut names: Vec<String> = Vec::new();
    'maps: for map in [speakers.as_object(), status.as_object()].into_iter().flatten() {
        for k in map.keys().take(MAX_ENTRIES) {
            if names.len() >= MAX_SPEAKERS {
                break 'maps;
            }
            if valid_speaker_name(k) && !names.contains(k) {
                names.push(k.clone());
            }
        }
    }
    names
        .into_iter()
        .map(|name| {
            let info = speakers.get(&name);
            let st = status.get(&name);
            let online = info.and_then(|i| i.get("online")).and_then(Value::as_bool) != Some(false);
            let state = speaker_state(st.and_then(|s| s.get("state")).and_then(Value::as_str), online);
            let volume = if online { volume_of(st.and_then(|s| s.get("volume"))) } else { None };
            let input = if online { input_kind(st.and_then(|s| s.get("inputSource")).and_then(Value::as_str)) } else { None };
            Speaker { name, state, volume, input, group: None, online }
        })
        .collect()
}

/// Groups in service order, members limited to known speakers (each speaker in one group),
/// and each speaker told its group.
fn pick_groups(body: &Value, speakers: &mut [Speaker]) -> Vec<Group> {
    let mut out: Vec<Group> = Vec::new();
    for g in body.as_array().into_iter().flatten().take(MAX_ENTRIES) {
        if out.len() >= MAX_GROUPS {
            break;
        }
        let Some(id) = g.get("id").and_then(Value::as_str).filter(|s| valid_group_id(s)) else {
            continue;
        };
        if out.iter().any(|o| o.id == id) {
            continue;
        }
        let members: Vec<String> = name_list(g.get("members"))
            .into_iter()
            .filter(|n| speakers.iter().any(|s| s.name == *n && s.group.is_none()))
            .collect();
        if members.is_empty() {
            continue;
        }
        let coordinator = g
            .get("coordinator")
            .and_then(Value::as_str)
            .filter(|c| members.iter().any(|m| m == c))
            .map(str::to_string)
            .unwrap_or_else(|| members[0].clone());
        for s in speakers.iter_mut() {
            if members.contains(&s.name) {
                s.group = Some(id.to_string());
            }
        }
        out.push(Group { id: id.to_string(), coordinator, members });
    }
    out
}

fn on_line_in(s: &Speaker) -> bool {
    s.input.as_deref() == Some("lineIn")
}

/// The group with the most speakers playing music (a speaker on line-in carries the PC's
/// sound, not music), then the most music speakers; the first such group on a tie. None
/// when no group has a speaker that could play music.
fn current_group(groups: &[Group], speakers: &[Speaker]) -> Option<String> {
    let find = |n: &str| speakers.iter().find(|s| s.name == n);
    let score = |g: &Group| -> (usize, usize) {
        let music: Vec<&Speaker> = g.members.iter().filter_map(|m| find(m.as_str())).filter(|s| s.online && !on_line_in(s)).collect();
        (music.iter().filter(|s| s.state == "playing").count(), music.len())
    };
    groups.iter().rev().filter(|g| score(g).1 > 0).max_by_key(|g| score(g)).map(|g| g.id.clone())
}

/// A preset is active when the speakers are grouped the way it groups them: every one of
/// its groups is a current group (same speakers). A preset with no groups of its own groups
/// its rooms (or, with none listed, every online speaker) into one.
fn preset_matches(p: &Value, groups: &[Group], speakers: &[Speaker]) -> bool {
    let has = |rooms: &[String]| !rooms.is_empty() && groups.iter().any(|g| same_set(&g.members, rooms));
    match p.get("groups").and_then(Value::as_array).filter(|l| !l.is_empty()) {
        Some(list) => list.iter().all(|g| has(&name_list(g.get("rooms")))),
        None => {
            let rooms = name_list(p.get("rooms"));
            if rooms.is_empty() {
                let online: Vec<String> = speakers.iter().filter(|s| s.online).map(|s| s.name.clone()).collect();
                has(&online)
            } else {
                has(&rooms)
            }
        }
    }
}

/// The level a group of a preset sets, when it sets one.
fn set_level(g: &Value) -> Option<u8> {
    if g.get("setVolume").and_then(Value::as_bool) == Some(false) {
        return None;
    }
    volume_of(g.get("volume"))
}

/// Which online speakers a list of rooms touches: an empty list means every speaker.
fn touched_rooms(rooms: Vec<String>, speakers: &[Speaker]) -> Vec<String> {
    let online = speakers.iter().filter(|s| s.online);
    if rooms.is_empty() {
        online.map(|s| s.name.clone()).collect()
    } else {
        online.filter(|s| rooms.contains(&s.name)).map(|s| s.name.clone()).collect()
    }
}

/// The speakers that make an action need a confirm, from `(speaker, level the action sets,
/// in a line-in group)`: a level it sets above 40, or, when it sets none, a level now above
/// 40 or unknown. A line-in group carries the PC's own sound and never counts.
fn loud_of(touched: Vec<(String, Option<u8>, bool)>, speakers: &[Speaker]) -> Vec<LoudSpeaker> {
    touched
        .into_iter()
        .filter(|(_, _, line_in)| !line_in)
        .filter_map(|(name, set, _)| match set {
            Some(v) if v <= SAFE_VOLUME => None,
            Some(v) => Some(LoudSpeaker { name, level: Some(v), sets: true }),
            None => {
                let now = speakers.iter().find(|s| s.name == name).and_then(|s| s.volume);
                if now.is_some_and(|v| v <= SAFE_VOLUME) {
                    None
                } else {
                    Some(LoudSpeaker { name, level: now, sets: false })
                }
            }
        })
        .collect()
}

/// What applying a preset would leave loud, from the last read (see `loud_of`).
fn preset_loud(p: &Value, speakers: &[Speaker]) -> Vec<LoudSpeaker> {
    let mut touched: Vec<(String, Option<u8>, bool)> = Vec::new();
    let mut add = |rooms: Vec<String>, set: Option<u8>, line_in: bool| {
        for r in touched_rooms(rooms, speakers) {
            if !touched.iter().any(|(n, _, _)| *n == r) {
                touched.push((r, set, line_in));
            }
        }
    };
    match p.get("groups").and_then(Value::as_array).filter(|l| !l.is_empty()) {
        Some(list) => {
            for g in list.iter().take(MAX_GROUPS) {
                let line_in = g.get("input").and_then(|i| i.get("type")).and_then(Value::as_str).is_some_and(|t| t.eq_ignore_ascii_case("lineIn"));
                add(name_list(g.get("rooms")), set_level(g), line_in);
            }
        }
        None => add(name_list(p.get("rooms")), set_level(p), false),
    }
    loud_of(touched, speakers)
}

fn pick_presets(body: &Value, groups: &[Group], speakers: &[Speaker]) -> Vec<Preset> {
    let mut out: Vec<Preset> = Vec::new();
    for (id, p) in body.as_object().into_iter().flatten().take(MAX_ENTRIES) {
        if out.len() >= MAX_PRESETS {
            break;
        }
        if !valid_key(id) || !p.is_object() {
            continue;
        }
        let name = p.get("name").and_then(Value::as_str).and_then(|n| clean_text(n, MAX_NAME_CHARS)).unwrap_or_else(|| id.clone());
        let active = !out.iter().any(|o| o.active) && preset_matches(p, groups, speakers);
        out.push(Preset { id: id.clone(), name, active, loud: preset_loud(p, speakers) });
    }
    out
}

fn pick_routines(body: &Value, speakers: &[Speaker]) -> (Vec<MusicRoutine>, Vec<ControlRoutine>) {
    let mut music = Vec::new();
    let mut controls = Vec::new();
    for (key, r) in body.as_object().into_iter().flatten().take(MAX_ENTRIES) {
        if !valid_key(key) || !r.is_object() || r.get("enabled").and_then(Value::as_bool) == Some(false) {
            continue;
        }
        let name = r.get("name").and_then(Value::as_str).and_then(|n| clean_text(n, MAX_NAME_CHARS)).unwrap_or_else(|| key.clone());
        match r.get("type").and_then(Value::as_str) {
            Some("music") if music.len() < MAX_ROUTINES => music.push(MusicRoutine {
                key: key.clone(),
                name,
                favorite: r.get("favorite").and_then(Value::as_str).and_then(|f| clean_text(f, MAX_NAME_CHARS)),
                // Any other volume key means the routine sets levels its own way: not known.
                volume: if OTHER_VOLUME_KEYS.iter().any(|k| r.get(*k).is_some()) { None } else { volume_of(r.get("volume")) },
            }),
            Some("control") if controls.len() < MAX_ROUTINES => {
                if let Some(action) = r.get("action").and_then(Value::as_str).filter(|a| CONTROL_ACTIONS.contains(a)) {
                    // Grouping every speaker pulls each one into the music group at its level.
                    let loud = if action == "groupAll" {
                        loud_of(touched_rooms(Vec::new(), speakers).into_iter().map(|n| (n, None, false)).collect(), speakers)
                    } else {
                        Vec::new()
                    };
                    controls.push(ControlRoutine { key: key.clone(), name, action: action.to_string(), loud });
                }
            }
            _ => {}
        }
    }
    (music, controls)
}

fn pick_scenes(body: &Value) -> Vec<Scene> {
    body.as_object()
        .into_iter()
        .flatten()
        .take(MAX_ENTRIES)
        .filter(|(id, s)| valid_key(id) && s.is_object())
        .take(MAX_SCENES)
        .map(|(id, s)| Scene {
            id: id.clone(),
            name: s.get("name").and_then(Value::as_str).and_then(|n| clean_text(n, MAX_NAME_CHARS)).unwrap_or_else(|| id.clone()),
        })
        .collect()
}

/// `endsAt` as epoch milliseconds: an ISO time with an offset, or a number, also one
/// written as a string (seconds when small, milliseconds otherwise).
fn ends_at(v: Option<&Value>) -> Option<i64> {
    let from_number = |x: f64| Some(x).filter(|x| x.is_finite() && *x > 0.0).map(|x| if x < 1e11 { (x * 1000.0) as i64 } else { x as i64 });
    match v? {
        Value::Number(n) => n.as_f64().and_then(from_number),
        Value::String(s) => {
            let t = s.trim();
            match t.parse::<f64>() {
                Ok(x) => from_number(x),
                Err(_) => parse_iso(t).map(|secs| (secs * 1000.0) as i64),
            }
        }
        _ => None,
    }
}

/// Running timers, the soonest first (an unknown end last); one that ended more than a
/// minute before `now_ms` is gone.
fn pick_timers(body: &Value, now_ms: i64) -> Vec<SleepTimer> {
    let entries: Vec<(String, &Value)> = match body {
        Value::Object(m) => m.iter().take(MAX_ENTRIES).map(|(k, v)| (k.clone(), v)).collect(),
        Value::Array(a) => a.iter().take(MAX_ENTRIES).filter_map(|v| Some((id_text(v.get("id")?)?, v))).collect(),
        _ => Vec::new(),
    };
    let mut out: Vec<SleepTimer> = entries
        .into_iter()
        .filter(|(id, v)| valid_key(id) && v.is_object())
        .map(|(id, v)| SleepTimer {
            id,
            ends_at_ms: ends_at(v.get("endsAt")),
            fade_minutes: v.get("fadeMinutes").and_then(Value::as_u64).filter(|m| *m <= 120).map(|m| m as u32),
        })
        .filter(|t| !t.ends_at_ms.is_some_and(|end| end < now_ms - 60_000))
        .collect();
    out.sort_by_key(|t| t.ends_at_ms.unwrap_or(i64::MAX));
    out.truncate(MAX_TIMERS);
    out
}

/// The first playing speaker with a track (the current group's coordinator first), never
/// one on an input.
fn now_playing(status: &Value, speakers: &[Speaker], groups: &[Group], current: Option<&str>) -> Option<NowPlaying> {
    let lead = current.and_then(|id| groups.iter().find(|g| g.id == id)).map(|g| g.coordinator.as_str());
    for name in lead.into_iter().chain(speakers.iter().map(|s| s.name.as_str())) {
        let Some(sp) = speakers.iter().find(|s| s.name == name) else {
            continue;
        };
        if sp.state != "playing" || sp.input.is_some() {
            continue;
        }
        let Some(st) = status.get(name) else {
            continue;
        };
        let track = st.get("track").and_then(Value::as_str).and_then(|t| clean_text(t, MAX_TRACK_CHARS));
        if track.is_some() {
            let artist = st.get("artist").and_then(Value::as_str).and_then(|t| clean_text(t, MAX_TRACK_CHARS));
            return Some(NowPlaying { speaker: name.to_string(), track, artist });
        }
    }
    None
}

pub(crate) fn shape(r: &Reads, read_at_ms: i64) -> SonosSummary {
    let mut speakers = pick_speakers(&r.speakers, &r.status);
    let groups = pick_groups(&r.groups, &mut speakers);
    let presets = pick_presets(&r.presets, &groups, &speakers);
    let (music, controls) = pick_routines(&r.routines, &speakers);
    let current = current_group(&groups, &speakers);
    let now = now_playing(&r.status, &speakers, &groups, current.as_deref());
    SonosSummary {
        speakers,
        groups,
        presets,
        music,
        controls,
        scenes: pick_scenes(&r.scenes),
        sleep_timers: pick_timers(&r.timers, read_at_ms),
        now_playing: now,
        current_group: current,
        read_at_ms,
    }
}

// Section: write plans

/// One request a write sends, built here from the shapes the service's own page uses.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Call {
    pub method: &'static str,
    pub path: String,
    pub body: Option<Value>,
}

fn post(path: String, body: Option<Value>) -> Call {
    Call { method: "POST", path, body }
}

/// Whether "Play anyway" may force this key: its last unforced call was skipped within
/// `SKIP_WINDOW`.
fn force_allowed(last_skip: Option<&(String, Instant)>, key: &str) -> bool {
    last_skip.is_some_and(|(k, at)| k == key && at.elapsed() <= SKIP_WINDOW)
}

pub(crate) fn plan_play(s: &SonosSummary, key: &str, confirm: bool, force: bool) -> Result<Vec<Call>, String> {
    if !valid_key(key) {
        return Err("Unknown routine".to_string());
    }
    if let Some(r) = s.music.iter().find(|r| r.key == key) {
        // A routine with no known volume starts at whatever the service sets: ask too.
        if !r.volume.is_some_and(|v| v <= SAFE_VOLUME) && !confirm {
            return Err(NEEDS_CONFIRM.to_string());
        }
    } else if let Some(c) = s.controls.iter().find(|c| c.key == key) {
        if !c.loud.is_empty() && !confirm {
            return Err(NEEDS_CONFIRM.to_string());
        }
    } else {
        return Err("Unknown routine".to_string());
    }
    let path = if force { format!("/api/trigger/{key}?force=true") } else { format!("/api/trigger/{key}") };
    Ok(vec![post(path, None)])
}

/// The answer to an unforced trigger as a fixed result. `{"skipped": true}` (or any
/// skipped value) is a skip; its reason comes from words in a few fields, read bounded,
/// mapped to one of three fixed phrases or none.
pub(crate) fn play_outcome(body: &Value) -> PlayResult {
    let skipped = match body.get("skipped") {
        Some(Value::Bool(b)) => *b,
        Some(Value::String(_)) | Some(Value::Object(_)) | Some(Value::Array(_)) => true,
        _ => false,
    };
    if !skipped {
        return PlayResult { started: true, reason: None };
    }
    let mut hint = String::new();
    for k in ["skipped", "reason", "message", "skipReason", "condition", "conditions"] {
        if let Some(v) = body.get(k) {
            let text: String = v.to_string().chars().take(400).collect();
            hint.push_str(&text.to_ascii_lowercase());
            hint.push(' ');
        }
    }
    // Every other character becomes a space, so `"source":"tv"` reads as the word "tv".
    let squashed: String = hint.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { ' ' }).collect();
    let has_word = |w: &str| squashed.split(' ').any(|t| t == w);
    let reason = if squashed.contains("presence") || has_word("away") || squashed.contains("nobody") {
        Some("nobody is home")
    } else if has_word("tv") || squashed.contains("tvsound") || squashed.contains("tvinput") {
        Some("a speaker is on TV sound")
    } else if squashed.contains("linein") || squashed.contains("line in") {
        Some("a speaker is on line-in")
    } else {
        None
    };
    PlayResult { started: false, reason: reason.map(str::to_string) }
}

pub(crate) fn plan_preset(s: &SonosSummary, id: &str, confirm: bool) -> Result<Vec<Call>, String> {
    let Some(p) = s.presets.iter().find(|p| p.id == id).filter(|_| valid_key(id)) else {
        return Err("Unknown speaker set".to_string());
    };
    if !p.loud.is_empty() && !confirm {
        return Err(NEEDS_CONFIRM.to_string());
    }
    Ok(vec![post(format!("/api/group-presets/{id}/apply"), None)])
}

fn volume_call(name: &str, level: u8) -> Call {
    post("/api/action/volume".to_string(), Some(json!({ "room": name, "volume": level })))
}

/// A speaker goes to `level`; a group moves each of its music speakers (online, not on
/// line-in, level known) by `step` from its own level, clamped to 0..100. Any target above
/// 40 needs `confirm`, whatever the read says the speaker is at now.
pub(crate) fn plan_volume(s: &SonosSummary, target: &VolumeTarget, level: Option<f64>, step: Option<f64>, confirm: bool) -> Result<Vec<Call>, String> {
    let targets: Vec<(&str, u8)> = match target.kind.as_str() {
        "speaker" => {
            let level = level.filter(|l| l.is_finite()).ok_or_else(|| "Volume must be a number".to_string())?;
            let level = level.round().clamp(0.0, 100.0) as u8;
            s.speakers.iter().filter(|sp| sp.name == target.id && sp.online).map(|sp| (sp.name.as_str(), level)).collect()
        }
        "group" => {
            let step = step.filter(|l| l.is_finite()).ok_or_else(|| "Volume must be a number".to_string())?;
            let step = step.round().clamp(-100.0, 100.0) as i32;
            s.groups
                .iter()
                .find(|g| g.id == target.id)
                .map(|g| {
                    g.members
                        .iter()
                        .filter_map(|m| s.speakers.iter().find(|sp| &sp.name == m))
                        .filter(|sp| sp.online && !on_line_in(sp))
                        .filter_map(|sp| sp.volume.map(|v| (sp.name.as_str(), (i32::from(v) + step).clamp(0, 100) as u8)))
                        .collect()
                })
                .unwrap_or_default()
        }
        _ => Vec::new(),
    };
    if targets.is_empty() {
        return Err(if target.kind == "group" { "Unknown group" } else { "Unknown speaker" }.to_string());
    }
    if targets.iter().any(|(_, l)| *l > SAFE_VOLUME) && !confirm {
        return Err(NEEDS_CONFIRM.to_string());
    }
    Ok(targets.into_iter().map(|(n, l)| volume_call(n, l)).collect())
}

pub(crate) fn plan_sleep(minutes: u32) -> Result<Vec<Call>, String> {
    if !SLEEP_CHOICES.contains(&minutes) {
        return Err("Sleep timer must be 30, 60 or 90 minutes".to_string());
    }
    Ok(vec![post("/api/sleep-timer".to_string(), Some(json!({ "minutes": minutes, "fadeMinutes": SLEEP_FADE_MINUTES })))])
}

pub(crate) fn plan_sleep_cancel(s: &SonosSummary, id: &str) -> Result<Vec<Call>, String> {
    if !valid_key(id) || !s.sleep_timers.iter().any(|t| t.id == id) {
        return Err("No such sleep timer".to_string());
    }
    Ok(vec![Call { method: "DELETE", path: format!("/api/sleep-timer/{id}"), body: None }])
}

// Section: http

fn sonos_agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| ureq::AgentBuilder::new().timeout(TIMEOUT).redirects(0).build())
}

fn fail(e: ureq::Error) -> String {
    let text = match e {
        ureq::Error::Status(..) => REFUSED,
        ureq::Error::Transport(_) => UNREACHABLE,
    };
    text.to_string()
}

fn get(base: &str, path: &str) -> Result<Value, String> {
    let resp = sonos_agent().get(&format!("{base}{path}")).set("Accept", "application/json").call().map_err(fail)?;
    let resp = require_ok(resp).map_err(|_| REFUSED.to_string())?;
    let body = read_body(resp).map_err(|_| REFUSED.to_string())?;
    serde_json::from_slice(&body).map_err(|_| REFUSED.to_string())
}

/// The seven reads run side by side, so a slow service costs one timeout, not seven.
fn read_all(base: &str) -> Result<Reads, String> {
    const PATHS: [&str; 7] = ["/api/status", "/api/speakers", "/api/routines", "/api/groups", "/api/group-presets", "/api/scenes", "/api/sleep-timers"];
    let mut answers: Vec<Result<Value, String>> = std::thread::scope(|sc| {
        let handles: Vec<_> = PATHS.iter().map(|path| sc.spawn(move || get(base, path))).collect();
        handles.into_iter().map(|h| h.join().unwrap_or_else(|_| Err(REFUSED.to_string()))).collect()
    });
    let mut next = || answers.remove(0);
    let status = next()?;
    let speakers = next()?;
    let routines = next()?;
    let mut optional = || next().unwrap_or(Value::Null);
    Ok(Reads { status, speakers, routines, groups: optional(), presets: optional(), scenes: optional(), timers: optional() })
}

/// Writes never reuse a pooled connection, so a dropped connection is never retried by
/// the client with the same request.
fn write_agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| ureq::AgentBuilder::new().timeout(TIMEOUT).redirects(0).max_idle_connections(0).max_idle_connections_per_host(0).build())
}

/// Sends one write; the answer's JSON (bounded), or null when it has none.
fn send_one(base: &str, c: &Call) -> Result<Value, String> {
    let req = write_agent().request(c.method, &format!("{base}{}", c.path)).set("Accept", "application/json");
    let result = match &c.body {
        Some(b) => req.set("Content-Type", "application/json").send_string(&b.to_string()),
        None => req.call(),
    };
    let resp = require_ok(result.map_err(fail)?).map_err(|_| REFUSED.to_string())?;
    Ok(read_body(resp).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null))
}

/// Sends every write side by side. All failed: the first error. Some failed: "Some
/// speakers did not change".
fn send(base: &str, calls: &[Call]) -> Result<(), String> {
    let results: Vec<Result<Value, String>> = std::thread::scope(|sc| {
        let handles: Vec<_> = calls.iter().map(|c| sc.spawn(move || send_one(base, c))).collect();
        handles.into_iter().map(|h| h.join().unwrap_or_else(|_| Err(REFUSED.to_string()))).collect()
    });
    merge_results(results)
}

fn merge_results(results: Vec<Result<Value, String>>) -> Result<(), String> {
    let total = results.len();
    let failed: Vec<String> = results.into_iter().filter_map(Result::err).collect();
    if failed.is_empty() {
        Ok(())
    } else if failed.len() == total {
        Err(failed[0].clone())
    } else {
        Err(PARTIAL.to_string())
    }
}

// Section: last good read

static LAST: Mutex<Option<(Instant, SonosSummary)>> = Mutex::new(None);
/// The key whose last unforced play was skipped, and when.
static LAST_SKIP: Mutex<Option<(String, Instant)>> = Mutex::new(None);

fn remember(s: &SonosSummary) {
    if let Ok(mut guard) = LAST.lock() {
        *guard = Some((Instant::now(), s.clone()));
    }
}

fn last_good() -> Result<SonosSummary, String> {
    let guard = LAST.lock().map_err(|_| OUT_OF_DATE.to_string())?;
    match guard.as_ref() {
        Some((at, s)) if at.elapsed() <= SUMMARY_MAX_AGE => Ok(s.clone()),
        _ => Err(OUT_OF_DATE.to_string()),
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

async fn dispatch(base: String, calls: Vec<Call>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || send(&base, &calls)).await.map_err(|_| UNFINISHED.to_string())?
}

// Section: commands

#[tauri::command]
pub async fn wall2_sonos_summary(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<SonosSummary, String> {
    require_wall2(window.label())?;
    let base = read_base(&app, "sonosBaseUrl", false)?;
    tauri::async_runtime::spawn_blocking(move || {
        let reads = read_all(&base)?;
        if reads_too_big(&reads) {
            return Err(REFUSED.to_string());
        }
        let summary = shape(&reads, now_ms());
        remember(&summary);
        Ok(summary)
    })
    .await
    .map_err(|_| UNFINISHED.to_string())?
}

/// Unforced by default: the answer says started or skipped (with a fixed reason). With
/// `force: true` (the page's "Play anyway"), only for the key whose unforced call was just
/// skipped.
#[tauri::command]
pub async fn wall2_sonos_play(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    routine_key: String,
    confirm: Option<bool>,
    force: Option<bool>,
) -> Result<PlayResult, String> {
    require_wall2(window.label())?;
    let base = read_base(&app, "sonosBaseUrl", false)?;
    let force = force.unwrap_or(false);
    if force {
        let guard = LAST_SKIP.lock().map_err(|_| REFUSED.to_string())?;
        if !force_allowed(guard.as_ref(), &routine_key) {
            return Err("Play anyway is offered only right after a skip".to_string());
        }
    }
    let calls = plan_play(&last_good()?, &routine_key, confirm.unwrap_or(false), force)?;
    let call = calls.into_iter().next().ok_or_else(|| REFUSED.to_string())?;
    let body = tauri::async_runtime::spawn_blocking(move || send_one(&base, &call)).await.map_err(|_| UNFINISHED.to_string())??;
    let result = if force { PlayResult { started: true, reason: None } } else { play_outcome(&body) };
    if let Ok(mut guard) = LAST_SKIP.lock() {
        *guard = if result.started { None } else { Some((routine_key, Instant::now())) };
    }
    Ok(result)
}

#[tauri::command]
pub async fn wall2_sonos_preset(window: tauri::WebviewWindow, app: tauri::AppHandle, preset_id: String, confirm: Option<bool>) -> Result<(), String> {
    require_wall2(window.label())?;
    let base = read_base(&app, "sonosBaseUrl", false)?;
    let calls = plan_preset(&last_good()?, &preset_id, confirm.unwrap_or(false))?;
    dispatch(base, calls).await
}

#[tauri::command]
pub async fn wall2_sonos_volume(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    target: VolumeTarget,
    level: Option<f64>,
    step: Option<f64>,
    confirm: Option<bool>,
) -> Result<(), String> {
    require_wall2(window.label())?;
    let base = read_base(&app, "sonosBaseUrl", false)?;
    let calls = plan_volume(&last_good()?, &target, level, step, confirm.unwrap_or(false))?;
    dispatch(base, calls).await
}

/// Pausing is the safe direction, so it does not wait for a fresh read.
#[tauri::command]
pub async fn wall2_sonos_pause_all(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    require_wall2(window.label())?;
    let base = read_base(&app, "sonosBaseUrl", false)?;
    dispatch(base, vec![post("/api/action/pause-all".to_string(), None)]).await
}

#[tauri::command]
pub async fn wall2_sonos_sleep(window: tauri::WebviewWindow, app: tauri::AppHandle, minutes: u32) -> Result<(), String> {
    require_wall2(window.label())?;
    let base = read_base(&app, "sonosBaseUrl", false)?;
    let calls = plan_sleep(minutes)?;
    dispatch(base, calls).await
}

#[tauri::command]
pub async fn wall2_sonos_sleep_cancel(window: tauri::WebviewWindow, app: tauri::AppHandle, id: String) -> Result<(), String> {
    require_wall2(window.label())?;
    let base = read_base(&app, "sonosBaseUrl", false)?;
    let calls = plan_sleep_cancel(&last_good()?, &id)?;
    dispatch(base, calls).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Invented names only: a den, a porch, a studio on line-in, a loft and a shed.
    fn reads() -> Reads {
        Reads {
            speakers: json!({
                "Den": {"model": "x", "online": true},
                "Porch": {"online": true},
                "Studio": {"online": true},
                "Loft": {"online": true},
                "Shed": {"online": false}
            }),
            status: json!({
                "Den": {"state": "PLAYING", "volume": 12, "inputSource": null, "track": "Song A", "artist": "Band B"},
                "Porch": {"state": "playing", "volume": 9.6},
                "Studio": {"state": "playing", "volume": 100, "inputSource": "Line In"},
                "Loft": {"state": "PAUSED_PLAYBACK", "volume": 30},
                "Shed": {"state": "playing", "volume": 50}
            }),
            groups: json!([
                {"id": "G_ONE:1", "coordinator": "Studio", "members": ["Studio"]},
                {"id": "G_TWO:2", "coordinator": "Den", "members": ["Den", "Porch", "Loft", "Nobody"]}
            ]),
            presets: json!({
                "everywhere": {"name": "Every Room", "rooms": []},
                "desk_mode": {"name": "Desk Mode", "groups": [
                    {"rooms": ["Studio"], "volume": 100, "input": {"type": "lineIn"}},
                    {"rooms": ["Loft", "Den", "Porch"], "volume": 10}
                ]},
                "bad id": {"name": "Skipped"}
            }),
            routines: json!({
                "Sunrise_Mix": {"name": "Sunrise Mix", "type": "music", "favorite": "Station One", "volume": 8, "enabled": true},
                "Loud_Party": {"name": "Loud Party", "type": "music", "favorite": "Station Two", "volume": 55},
                "Off_Now": {"name": "All Off", "type": "music", "enabled": false},
                "No_Level": {"name": "No Level", "type": "music", "favorite": "Station Three"},
                "Stop_All": {"name": "Stop All", "type": "control", "action": "pauseAll"},
                "Tv_Up": {"name": "TV Loud", "type": "control", "action": "tvVolume"},
                "Plug": {"name": "Plug", "type": "webhook"},
                "../x": {"name": "Bad", "type": "music"}
            }),
            scenes: json!({"calm": {"name": "Calm"}}),
            timers: json!({"t1": {"endsAt": "2026-11-12T22:00:00Z", "fadeMinutes": 5}}),
        }
    }

    fn summary() -> SonosSummary {
        shape(&reads(), 1)
    }

    #[test]
    fn shapes_speakers_with_state_volume_input_and_group() {
        let s = summary();
        let names: Vec<&str> = s.speakers.iter().map(|x| x.name.as_str()).collect();
        assert_eq!(names, vec!["Den", "Porch", "Studio", "Loft", "Shed"]);
        assert_eq!(s.speakers[0].state, "playing");
        assert_eq!(s.speakers[1].volume, Some(10));
        assert_eq!(s.speakers[2].input.as_deref(), Some("lineIn"));
        assert_eq!(s.speakers[3].state, "paused");
        assert_eq!(s.speakers[4].state, "offline");
        assert_eq!(s.speakers[4].volume, None);
        assert_eq!(s.speakers[0].group.as_deref(), Some("G_TWO:2"));
        assert_eq!(s.groups[1].members, vec!["Den", "Porch", "Loft"]);
    }

    #[test]
    fn current_group_skips_line_in_and_now_playing_names_the_track() {
        let s = summary();
        assert_eq!(s.current_group.as_deref(), Some("G_TWO:2"));
        let np = s.now_playing.unwrap();
        assert_eq!(np.speaker, "Den");
        assert_eq!(np.track.as_deref(), Some("Song A"));
        assert_eq!(np.artist.as_deref(), Some("Band B"));
    }

    #[test]
    fn active_preset_matches_the_current_grouping() {
        let s = summary();
        let ids: Vec<(&str, bool)> = s.presets.iter().map(|p| (p.id.as_str(), p.active)).collect();
        assert_eq!(ids, vec![("everywhere", false), ("desk_mode", true)]);
        // No rooms and no volume: it pulls every speaker in as it is, so the studio at 100
        // makes it loud. The desk preset's 100 is a line-in group, so it is not.
        assert_eq!(s.presets[0].loud, vec![LoudSpeaker { name: "Studio".into(), level: Some(100), sets: false }]);
        assert!(s.presets[1].loud.is_empty());
    }

    #[test]
    fn a_preset_that_sets_a_speaker_above_forty_needs_a_confirm() {
        let mut r = reads();
        r.presets = json!({
            "party": {"name": "Party", "groups": [{"rooms": ["Den"], "volume": 70}]},
            "quiet_set": {"name": "Quiet", "groups": [{"rooms": ["Den"], "volume": 70, "setVolume": false}]}
        });
        let s = shape(&r, 0);
        assert_eq!(s.presets[0].loud, vec![LoudSpeaker { name: "Den".into(), level: Some(70), sets: true }]);
        // setVolume false leaves Den at its own 12: quiet.
        assert!(s.presets[1].loud.is_empty());
        assert_eq!(plan_preset(&s, "party", false).unwrap_err(), NEEDS_CONFIRM);
        assert!(plan_preset(&s, "party", true).is_ok());
        assert!(plan_preset(&s, "quiet_set", false).is_ok());
    }

    #[test]
    fn a_preset_with_no_rooms_and_no_volume_against_a_line_in_speaker_at_100_asks() {
        let mut r = reads();
        r.presets = json!({
            "all": {"name": "All", "rooms": []},
            "all_twenty": {"name": "All at twenty", "rooms": [], "volume": 20},
            "unknown": {"name": "Unknown level", "rooms": ["Den"]}
        });
        let mut s = shape(&r, 0);
        assert_eq!(s.presets[0].loud, vec![LoudSpeaker { name: "Studio".into(), level: Some(100), sets: false }]);
        assert_eq!(plan_preset(&s, "all", false).unwrap_err(), NEEDS_CONFIRM);
        // A preset that sets everything to 20 is safe in one click.
        assert!(s.presets[1].loud.is_empty());
        assert!(plan_preset(&s, "all_twenty", false).is_ok());
        // A level the read does not know asks too.
        s.speakers[0].volume = None;
        let p = r.presets.get("unknown").unwrap().clone();
        assert_eq!(preset_loud(&p, &s.speakers), vec![LoudSpeaker { name: "Den".into(), level: None, sets: false }]);
    }

    #[test]
    fn a_control_that_groups_all_asks_when_a_speaker_is_loud() {
        let mut r = reads();
        r.routines = json!({
            "Group_All": {"name": "Group All", "type": "control", "action": "groupAll"},
            "Split": {"name": "Split", "type": "control", "action": "ungroupAll"}
        });
        let s = shape(&r, 0);
        assert_eq!(s.controls[0].loud, vec![LoudSpeaker { name: "Studio".into(), level: Some(100), sets: false }]);
        assert_eq!(plan_play(&s, "Group_All", false, false).unwrap_err(), NEEDS_CONFIRM);
        assert!(plan_play(&s, "Group_All", true, false).is_ok());
        assert!(s.controls[1].loud.is_empty());
        assert!(plan_play(&s, "Split", false, false).is_ok());
    }

    #[test]
    fn routines_keep_enabled_music_and_safe_controls_only() {
        let s = summary();
        let keys: Vec<&str> = s.music.iter().map(|r| r.key.as_str()).collect();
        assert_eq!(keys, vec!["Sunrise_Mix", "Loud_Party", "No_Level"]);
        assert_eq!(s.music[0].favorite.as_deref(), Some("Station One"));
        let controls: Vec<&str> = s.controls.iter().map(|r| r.key.as_str()).collect();
        assert_eq!(controls, vec!["Stop_All"]);
        assert_eq!(s.scenes.len(), 1);
    }

    #[test]
    fn timers_parse_iso_and_numbers() {
        let s = summary();
        assert_eq!(s.sleep_timers[0].ends_at_ms, Some(1_794_520_800_000));
        assert_eq!(ends_at(Some(&json!(1_794_520_800))), Some(1_794_520_800_000));
        assert_eq!(ends_at(Some(&json!(1_794_520_800_000_i64))), Some(1_794_520_800_000));
        assert_eq!(ends_at(Some(&json!("soon"))), None);
        let list = pick_timers(&json!([{"id": 7, "endsAt": 1_794_520_800}, {"id": "a/b"}]), 0);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "7");
        // A number written as a string.
        assert_eq!(ends_at(Some(&json!("1794520800000"))), Some(1_794_520_800_000));
        // Soonest first; one that ended more than a minute ago is gone.
        let now = 1_794_520_800_000_i64;
        let list = pick_timers(
            &json!({"late": {"endsAt": now + 90 * 60_000}, "soon": {"endsAt": now + 5 * 60_000}, "gone": {"endsAt": now - 2 * 60_000}, "odd": {}}),
            now,
        );
        let ids: Vec<&str> = list.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, vec!["soon", "late", "odd"]);
    }

    #[test]
    fn cleans_and_bounds_text() {
        assert_eq!(clean_text("  a\u{0007}b \n c ", 60).as_deref(), Some("a b c"));
        assert_eq!(clean_text("\u{202E}\u{200B}", 60), None);
        let long = clean_text(&"x".repeat(200), 60).unwrap();
        assert_eq!(long.chars().count(), 60);
        assert!(long.ends_with('\u{2026}'));
        assert!(valid_speaker_name("Den"));
        assert!(!valid_speaker_name("Den\u{0007}"));
        assert!(!valid_speaker_name(" Den"));
        assert!(!valid_speaker_name(&"y".repeat(61)));
    }

    #[test]
    fn caps_every_list() {
        let mut sp = serde_json::Map::new();
        let mut st = serde_json::Map::new();
        let mut rt = serde_json::Map::new();
        for i in 0..80 {
            sp.insert(format!("Room {i}"), json!({"online": true}));
            st.insert(format!("Room {i}"), json!({"state": "stopped", "volume": 5}));
            rt.insert(format!("R_{i}"), json!({"name": format!("Mix {i}"), "type": "music", "volume": 5}));
        }
        let r = Reads {
            speakers: Value::Object(sp),
            status: Value::Object(st),
            routines: Value::Object(rt),
            groups: Value::Null,
            presets: json!("not an object"),
            scenes: Value::Null,
            timers: Value::Null,
        };
        let s = shape(&r, 0);
        assert_eq!(s.speakers.len(), MAX_SPEAKERS);
        assert_eq!(s.music.len(), MAX_ROUTINES);
        assert!(s.groups.is_empty() && s.presets.is_empty() && s.current_group.is_none());
    }

    #[test]
    fn play_is_checked_against_the_read() {
        let s = summary();
        // Unforced by default; forced only when asked.
        assert_eq!(plan_play(&s, "Sunrise_Mix", false, false).unwrap()[0].path, "/api/trigger/Sunrise_Mix");
        assert_eq!(plan_play(&s, "Sunrise_Mix", false, true).unwrap()[0].path, "/api/trigger/Sunrise_Mix?force=true");
        assert_eq!(plan_play(&s, "Stop_All", false, false).unwrap().len(), 1);
        assert_eq!(plan_play(&s, "Tv_Up", false, false).unwrap_err(), "Unknown routine");
        assert_eq!(plan_play(&s, "Nope", false, false).unwrap_err(), "Unknown routine");
        assert_eq!(plan_play(&s, "../x", true, false).unwrap_err(), "Unknown routine");
        assert_eq!(plan_play(&s, "Loud_Party", false, false).unwrap_err(), NEEDS_CONFIRM);
        assert!(plan_play(&s, "Loud_Party", true, false).is_ok());
        assert_eq!(plan_play(&s, "No_Level", false, false).unwrap_err(), NEEDS_CONFIRM);
    }

    #[test]
    fn a_routine_with_other_volume_keys_has_no_known_volume() {
        let mut r = reads();
        r.routines = json!({
            "Mixed": {"name": "Mixed", "type": "music", "volume": 10, "othersVolume": 60},
            "Rooms": {"name": "Rooms", "type": "music", "volume": 10, "volumes": {"Den": 80}},
            "Plain": {"name": "Plain", "type": "music", "volume": 10}
        });
        let s = shape(&r, 0);
        assert_eq!(s.music.iter().map(|m| m.volume).collect::<Vec<_>>(), vec![None, None, Some(10)]);
        assert_eq!(plan_play(&s, "Mixed", false, false).unwrap_err(), NEEDS_CONFIRM);
        assert!(plan_play(&s, "Plain", false, false).is_ok());
    }

    #[test]
    fn play_answers_become_fixed_results() {
        assert_eq!(play_outcome(&json!({"ok": true})), PlayResult { started: true, reason: None });
        assert_eq!(play_outcome(&Value::Null), PlayResult { started: true, reason: None });
        assert_eq!(play_outcome(&json!({"skipped": false})), PlayResult { started: true, reason: None });
        let away = play_outcome(&json!({"skipped": true, "reason": "presence is away"}));
        assert_eq!(away, PlayResult { started: false, reason: Some("nobody is home".into()) });
        let tv = play_outcome(&json!({"skipped": true, "condition": {"speaker": "Den", "source": "tv", "is": "on"}}));
        assert_eq!(tv.reason.as_deref(), Some("a speaker is on TV sound"));
        let line = play_outcome(&json!({"skipped": "Studio is on lineIn"}));
        assert_eq!(line.reason.as_deref(), Some("a speaker is on line-in"));
        // Text the reader does not recognise never passes through.
        let odd = play_outcome(&json!({"skipped": true, "reason": "<b>whatever the service says</b>"}));
        assert_eq!(odd, PlayResult { started: false, reason: None });
        // "activity" holds "tv" but not as a word.
        assert_eq!(play_outcome(&json!({"skipped": true, "reason": "activity"})).reason, None);
    }

    #[test]
    fn play_anyway_only_right_after_a_skip_of_that_key() {
        let just = ("Sunrise_Mix".to_string(), Instant::now());
        assert!(force_allowed(Some(&just), "Sunrise_Mix"));
        assert!(!force_allowed(Some(&just), "Loud_Party"));
        assert!(!force_allowed(None, "Sunrise_Mix"));
        if let Some(old) = Instant::now().checked_sub(Duration::from_secs(61)) {
            assert!(!force_allowed(Some(&("Sunrise_Mix".to_string(), old)), "Sunrise_Mix"));
        }
    }

    #[test]
    fn partial_group_writes_say_so() {
        assert!(merge_results(vec![Ok(Value::Null), Ok(Value::Null)]).is_ok());
        assert_eq!(merge_results(vec![Ok(Value::Null), Err(UNREACHABLE.into())]).unwrap_err(), PARTIAL);
        assert_eq!(merge_results(vec![Err(UNREACHABLE.into()), Err(REFUSED.into())]).unwrap_err(), UNREACHABLE);
    }

    #[test]
    fn a_huge_answer_is_refused_quickly() {
        let mut big = serde_json::Map::new();
        for i in 0..50_000 {
            big.insert(format!("Room {i}"), json!({"state": "playing", "volume": 5}));
        }
        let started = Instant::now();
        let mut r = reads();
        r.status = Value::Object(big.clone());
        r.speakers = Value::Object(big);
        assert!(reads_too_big(&r));
        let s = shape(&r, 0);
        assert_eq!(s.speakers.len(), MAX_SPEAKERS);
        let rooms = json!({"p": {"rooms": vec!["x"; 50_000]}});
        assert!(too_big(&rooms["p"]));
        assert!(name_list(rooms["p"].get("rooms")).len() <= MAX_NAMES);
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(!reads_too_big(&reads()));
    }

    #[test]
    fn preset_and_timer_ids_are_checked() {
        let s = summary();
        assert_eq!(plan_preset(&s, "desk_mode", false).unwrap()[0].path, "/api/group-presets/desk_mode/apply");
        assert!(plan_preset(&s, "bad id", true).is_err());
        assert!(plan_preset(&s, "elsewhere", true).is_err());
        let cancel = plan_sleep_cancel(&s, "t1").unwrap();
        assert_eq!((cancel[0].method, cancel[0].path.as_str()), ("DELETE", "/api/sleep-timer/t1"));
        assert!(plan_sleep_cancel(&s, "t2").is_err());
    }

    #[test]
    fn sleep_takes_three_lengths_only() {
        let c = plan_sleep(60).unwrap();
        assert_eq!(c[0].body, Some(json!({"minutes": 60, "fadeMinutes": 5})));
        assert!(plan_sleep(30).is_ok() && plan_sleep(90).is_ok());
        assert!(plan_sleep(45).is_err());
        assert!(plan_sleep(0).is_err());
    }

    #[test]
    fn group_volume_moves_each_speaker_by_the_same_step_without_line_in_or_offline() {
        let s = summary();
        let t = VolumeTarget { kind: "group".into(), id: "G_TWO:2".into() };
        let calls = plan_volume(&s, &t, None, Some(5.0), false).unwrap();
        let got: Vec<(&str, u64)> = calls.iter().map(|c| (c.body.as_ref().unwrap()["room"].as_str().unwrap(), c.body.as_ref().unwrap()["volume"].as_u64().unwrap())).collect();
        assert_eq!(got, vec![("Den", 17), ("Porch", 15), ("Loft", 35)]);
        // Down, clamped at 0.
        let down: Vec<u64> = plan_volume(&s, &t, None, Some(-20.0), false).unwrap().iter().map(|c| c.body.as_ref().unwrap()["volume"].as_u64().unwrap()).collect();
        assert_eq!(down, vec![0, 0, 10]);
        // A step that takes any speaker above 40 asks first: Loft 30 + 11 = 41.
        assert_eq!(plan_volume(&s, &t, None, Some(11.0), false).unwrap_err(), NEEDS_CONFIRM);
        assert!(plan_volume(&s, &t, None, Some(11.0), true).is_ok());
        // A group needs a step, a speaker a level.
        assert!(plan_volume(&s, &t, Some(20.0), None, false).is_err());
        // A group of one speaker on line-in has nothing the slider may move.
        let t = VolumeTarget { kind: "group".into(), id: "G_ONE:1".into() };
        assert_eq!(plan_volume(&s, &t, None, Some(5.0), false).unwrap_err(), "Unknown group");
    }

    #[test]
    fn any_volume_above_forty_needs_a_confirm_whatever_the_read_says() {
        let s = summary();
        let den = VolumeTarget { kind: "speaker".into(), id: "Den".into() };
        assert_eq!(plan_volume(&s, &den, Some(41.0), None, false).unwrap_err(), NEEDS_CONFIRM);
        assert!(plan_volume(&s, &den, Some(40.0), None, false).is_ok());
        assert!(plan_volume(&s, &den, Some(80.0), None, true).is_ok());
        // The studio reads 100, but 60 could still be a raise from where it is now: ask.
        let studio = VolumeTarget { kind: "speaker".into(), id: "Studio".into() };
        assert_eq!(plan_volume(&s, &studio, Some(60.0), None, false).unwrap_err(), NEEDS_CONFIRM);
        assert!(plan_volume(&s, &studio, Some(30.0), None, false).is_ok());
        // Clamped to 0..100.
        let c = plan_volume(&s, &den, Some(-5.0), None, false).unwrap();
        assert_eq!(c[0].body.as_ref().unwrap()["volume"], json!(0));
        assert_eq!(plan_volume(&s, &studio, Some(250.0), None, true).unwrap()[0].body.as_ref().unwrap()["volume"], json!(100));
        assert!(plan_volume(&s, &den, Some(f64::NAN), None, true).is_err());
        assert!(plan_volume(&s, &den, None, None, true).is_err());
        // Unknown and offline speakers, unknown kinds.
        assert!(plan_volume(&s, &VolumeTarget { kind: "speaker".into(), id: "Attic".into() }, Some(5.0), None, false).is_err());
        assert!(plan_volume(&s, &VolumeTarget { kind: "speaker".into(), id: "Shed".into() }, Some(5.0), None, false).is_err());
        assert!(plan_volume(&s, &VolumeTarget { kind: "room".into(), id: "Den".into() }, Some(5.0), None, false).is_err());
    }

    #[test]
    fn input_and_state_words() {
        assert_eq!(input_kind(Some("Line-In")).as_deref(), Some("lineIn"));
        assert_eq!(input_kind(Some("TV")).as_deref(), Some("tv"));
        assert_eq!(input_kind(Some("Radio")).as_deref(), Some("other"));
        assert_eq!(input_kind(Some("  ")), None);
        assert_eq!(input_kind(None), None);
        assert_eq!(speaker_state(Some("weird"), true), "unknown");
        assert_eq!(speaker_state(Some("playing"), false), "offline");
    }
}
