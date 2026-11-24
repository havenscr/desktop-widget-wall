//! Wall 2 Home Sound block: reads the owner's Sonos service and sends the few commands the
//! block offers.
//!
//! Every read and command goes through the home app's relay, `<homeBaseUrl>/api/sonos/<rest>`
//! for each `/api/<rest>` below, with the saved desk key sent as `X-Desk-Token` (read from
//! Credential Manager, only to a loopback or tailnet address, never logged). Only when no
//! `homeBaseUrl` is set does it use `feeds.json` `sonosBaseUrl` (`<base>/api/<rest>`). Addresses come
//! through the helpers in `wall2_feeds.rs` (scheme, host and port only; plain `http` to a private
//! address is allowed) and are never put in an error message or a log. Cover art still reads the
//! speaker addresses directly.
//!
//! Reads (`wall2_sonos_summary`, only when the front end asks): `GET /api/status`,
//! `/api/speakers`, `/api/routines`, `/api/groups`, `/api/group-presets`, `/api/scenes`,
//! `/api/sleep-timers` and `/api/capabilities`, side by side (the last five may fail on
//! their own; the capabilities answer `{"skip": true}` only when the service has the back
//! and next commands, and anything else means `canSkip` is false). An answer
//! with far more entries than the caps is refused as malformed; the rest is cut down to a
//! bounded, cleaned summary and kept as the last good read. A failed read answers one fixed
//! word, `timed-out`, `no-answer` or `bad-answer` (`wall2_sonos_read`), and failed or slow
//! reads are written, as fixed words and numbers, to `wall2-sonos.log` (`wall2_sonos_log`).
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
//! - `wall2_sonos_skip`: `POST /api/action/next` or `/api/action/previous` with `{}`,
//!   only when the last good read said `canSkip` and music plays; the service's own
//!   `nothing-playing` and `cannot-skip` answers come back as those fixed words
//!
//! Favorites (no screen uses them yet): `wall2_sonos_favorites` reads `GET /api/favorites`
//! (an array of `{title, uri, metadata, type, shuffleable}`; only `title` and `type` are
//! used) and answers `[{id, name, kind}]`, names cleaned and cut at 120 characters, at most
//! 100. The service has no id, so the id is a hash of its own title and Rust keeps the
//! id to title pairs of the last read (at most ten minutes old). `wall2_sonos_favorite_play`
//! takes only that id and sends `POST /api/action/play-favorite` `{"favorite", "coordinator"}`
//! with the title in the body, never in a path, to the current group's coordinator from the
//! last good summary; the loud-volume confirm rule is the same as for a preset.
//!
//! Cover art (`wall2_sonos_art`, takes nothing from the page): fetches the `albumArtURI` the
//! last good read held for the playing speaker, under the bounds in `wall2_sonos_read`.
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
use crate::wall2_sonos_log::{self, Event, Kind, Read};
use crate::wall2_sonos_read::{art_agent, get_json, art_cached, art_url, fetch_art, read_all_eight, ArtCache, ArtImage, Route};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const TIMEOUT: Duration = Duration::from_secs(4);
const MAX_SPEAKERS: usize = 24;
const MAX_GROUPS: usize = 24;
const MAX_PRESETS: usize = 12;
const MAX_ROUTINES: usize = 48;
const MAX_FAVORITES: usize = 100;
const MAX_FAVORITE_CHARS: usize = 120;
/// The service's own title, as bytes, that goes back to it unchanged; a longer one is left out.
const MAX_FAVORITE_TITLE: usize = 400;
const FAVORITE_KINDS: [&str; 3] = ["spotify", "radio", "other"];
/// How long the last favorites read may be played from.
const FAVORITES_MAX_AGE: Duration = Duration::from_secs(10 * 60);
const MAX_SCENES: usize = 12;
const MAX_TIMERS: usize = 6;
const MAX_NAME_CHARS: usize = 60;
const MAX_TRACK_CHARS: usize = 120;
const MAX_SECONDS: f64 = 86_400.0;
const MAX_ART_ADDRESS: usize = 1024;
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
const CANNOT_SKIP: &str = "cannot-skip";
const NOTHING_PLAYING: &str = "nothing-playing";
const OUT_OF_DATE: &str = "Sonos status is out of date";
const PARTIAL: &str = "Some speakers did not change";
const UNFINISHED: &str = "The request did not finish";
const NO_ROOM: &str = "No room to play on";
const UNKNOWN_FAVORITE: &str = "Unknown favorite";
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
    /// The track's length and position in whole seconds, when the service gave finite numbers from 0
    /// to 86,400 (a zero or missing length is None, as for a radio station; a position past the length
    /// is clamped to it). The position is as of `SonosSummary::read_at_ms`.
    pub duration: Option<u32>,
    pub position: Option<u32>,
    /// A short opaque key (a hash of the cover address, never the address) when the read held a cover address this wall
    /// may fetch (`wall2_sonos_art` fetches it). It changes when the address does, so the page asks again then.
    pub art: Option<String>,
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
    /// The service said it has the back and next commands.
    pub can_skip: bool,
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
    [&r.status, &r.speakers, &r.routines, &r.groups, &r.presets, &r.scenes, &r.timers, &r.capabilities].into_iter().any(too_big)
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
    pub capabilities: Value,
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
    // A speaker in several groups is judged by the loudest one it is in: a group that is
    // not line-in always counts, and a higher level (or an unknown one) replaces a lower.
    let mut add = |rooms: Vec<String>, set: Option<u8>, line_in: bool| {
        for r in touched_rooms(rooms, speakers) {
            match touched.iter_mut().find(|e| e.0 == r) {
                None => touched.push((r, set, line_in)),
                Some(entry) => {
                    if line_in {
                        continue;
                    }
                    let louder = match (entry.1, set) {
                        (Some(a), Some(b)) => b > a,
                        (Some(_), None) => true,
                        _ => false,
                    };
                    if entry.2 || louder {
                        *entry = (r, set, false);
                    }
                }
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

/// Whole seconds from a finite JSON number from 0 to 86,400, else None.
fn seconds(v: Option<&Value>) -> Option<u32> {
    v?.as_f64().filter(|n| n.is_finite() && (0.0..=MAX_SECONDS).contains(n)).map(|n| n.floor() as u32)
}

/// A track's length and position: no length (missing, zero or out of range) means neither, as for a
/// radio station; a position past the length is clamped to it; a missing position means none.
fn track_time(st: &Value) -> (Option<u32>, Option<u32>) {
    match seconds(st.get("duration")).filter(|d| *d > 0) {
        Some(d) => (Some(d), seconds(st.get("position")).map(|p| p.min(d))),
        None => (None, None),
    }
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
            let (duration, position) = track_time(st);
            let art = art_address(st).filter(|a| art_url(a).is_some()).map(|a| art_key(&a));
            return Some(NowPlaying { speaker: name.to_string(), track, artist, duration, position, art });
        }
    }
    None
}

/// The cover address one speaker's status holds, as the service wrote it (checked only when fetched).
fn art_address(st: &Value) -> Option<String> {
    st.get("albumArtURI").and_then(Value::as_str).filter(|a| !a.is_empty() && a.len() <= MAX_ART_ADDRESS).map(str::to_string)
}

/// A short opaque key for a cover address: 16 hex digits of its hash. It says only whether the address changed.
pub(crate) fn art_key(address: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    address.hash(&mut h);
    format!("{:016x}", h.finish())
}

/// The cover address of the speaker `now_playing` named, kept in memory beside the summary.
pub(crate) fn now_art_address(status: &Value, now: Option<&NowPlaying>) -> Option<String> {
    art_address(status.get(now?.speaker.as_str())?)
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
        can_skip: r.capabilities.get("skip") == Some(&Value::Bool(true)),
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

/// Checks that `key` may be forced and clears the skip memory in the same step, so a forced
/// write that failed or timed out cannot be sent again without a new unforced skip.
fn take_force(slot: &Mutex<Option<(String, Instant)>>, key: &str) -> Result<bool, String> {
    let mut guard = slot.lock().map_err(|_| REFUSED.to_string())?;
    let ok = force_allowed(guard.as_ref(), key);
    *guard = None;
    Ok(ok)
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

/// The answer to an unforced trigger as a fixed result. Only `{"skipped": true}` is a
/// skip (the service gives no reason; the page shows one fixed line). A reason is
/// kept only when a recognised reason key is present, mapped to one of three fixed
/// phrases, and never the service's own text.
pub(crate) fn play_outcome(body: &Value) -> PlayResult {
    // Only the JSON boolean `true` is a skip. An array there is the list of speakers a
    // routine that RAN left alone; a string, number, object or `false` also means it ran.
    let skipped = body.get("skipped") == Some(&Value::Bool(true));
    if !skipped {
        return PlayResult { started: true, reason: None };
    }
    let mut hint = String::new();
    for k in ["reason", "skipReason", "condition", "conditions"] {
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

/// Back or next: only when the last good read said the service has the commands, and music plays.
/// The words are fixed: `cannot-skip` and `nothing-playing` (the page shows them as sentences).
pub(crate) fn plan_skip(s: &SonosSummary, direction: &str) -> Result<Vec<Call>, String> {
    let path = match direction {
        "next" => "/api/action/next",
        "previous" => "/api/action/previous",
        _ => return Err(REFUSED.to_string()),
    };
    if !s.can_skip {
        return Err(CANNOT_SKIP.to_string());
    }
    if !s.speakers.iter().any(|sp| sp.online && sp.state == "playing" && sp.input.is_none()) {
        return Err(NOTHING_PLAYING.to_string());
    }
    Ok(vec![post(path.to_string(), Some(json!({})))])
}

/// What a 4xx answer to a skip says: the service's own two words, else the plain refusal.
pub(crate) fn skip_refusal(body: &Value) -> String {
    match body.get("error").and_then(Value::as_str) {
        Some(CANNOT_SKIP) => CANNOT_SKIP.to_string(),
        Some(NOTHING_PLAYING) => NOTHING_PLAYING.to_string(),
        _ => REFUSED.to_string(),
    }
}

/// A 2xx answer to a skip counts only as the contract says: a JSON object whose `ok` is exactly `true`. Anything else
/// (an empty object, null, a page, another object, `"true"`) is the fixed refusal.
pub(crate) fn skip_accepted(body: &Value) -> bool {
    body.as_object().and_then(|o| o.get("ok")) == Some(&Value::Bool(true))
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

/// The eight reads run side by side, so a slow service costs one timeout, not eight. A
/// failed read answers one fixed word for its kind (`timed-out`, `no-answer` or
/// `bad-answer`, see `wall2_sonos_read`); failed and slow reads are also written to
/// `wall2-sonos.log`.
fn read_all(route: &Route) -> Result<Reads, String> {
    let mut answers = read_all_eight(sonos_agent(), route).map_err(|k| k.word().to_string())?.into_iter();
    let mut next = || answers.next().unwrap_or(Value::Null);
    Ok(Reads { status: next(), speakers: next(), routines: next(), groups: next(), presets: next(), scenes: next(), timers: next(), capabilities: next() })
}

/// Writes never reuse a pooled connection, so a dropped connection is never retried by
/// the client with the same request.
fn write_agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| ureq::AgentBuilder::new().timeout(TIMEOUT).redirects(0).max_idle_connections(0).max_idle_connections_per_host(0).build())
}

/// Sends one write; the answer's JSON (bounded), or null when it has none.
fn send_one(route: &Route, c: &Call) -> Result<Value, String> {
    let req = route.apply(write_agent().request(c.method, &route.url(&c.path)).set("Accept", "application/json"));
    let result = match &c.body {
        Some(b) => req.set("Content-Type", "application/json").send_string(&b.to_string()),
        None => req.call(),
    };
    let resp = require_ok(result.map_err(fail)?).map_err(|_| REFUSED.to_string())?;
    Ok(read_body(resp).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null))
}

/// Sends the skip. A 4xx answer is read (bounded) for the service's own word; anything else that
/// is not a success is the plain refusal.
fn send_skip(route: &Route, c: &Call) -> Result<(), String> {
    let body = c.body.as_ref().map(Value::to_string).unwrap_or_else(|| "{}".to_string());
    let sent = route.apply(write_agent().request(c.method, &route.url(&c.path)).set("Accept", "application/json")).set("Content-Type", "application/json").send_string(&body);
    match sent {
        Ok(resp) => {
            let resp = require_ok(resp).map_err(|_| REFUSED.to_string())?;
            let answer = read_body(resp).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).unwrap_or(Value::Null);
            if skip_accepted(&answer) { Ok(()) } else { Err(REFUSED.to_string()) }
        }
        Err(ureq::Error::Status(code, resp)) if (400..500).contains(&code) => {
            let answer = read_body(resp).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).unwrap_or(Value::Null);
            Err(skip_refusal(&answer))
        }
        Err(e) => Err(fail(e)),
    }
}

/// Sends every write side by side. All failed: the first error. Some failed: "Some
/// speakers did not change".
fn send(route: &Route, calls: &[Call]) -> Result<(), String> {
    let results: Vec<Result<Value, String>> = std::thread::scope(|sc| {
        let handles: Vec<_> = calls.iter().map(|c| sc.spawn(move || send_one(route, c))).collect();
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

/// The cover address the last good read held for the playing speaker, and when that read was.
static LAST_ART: Mutex<Option<(Instant, Option<String>)>> = Mutex::new(None);
/// The one remembered cover (one fetch per distinct address), in memory only.
static ART: ArtCache = Mutex::new(None);

fn remember(s: &SonosSummary, art: Option<String>) {
    if let Ok(mut guard) = LAST.lock() {
        *guard = Some((Instant::now(), s.clone()));
    }
    if let Ok(mut guard) = LAST_ART.lock() {
        *guard = Some((Instant::now(), art));
    }
}

/// The held cover address, only while the read that held it is no older than a summary may be.
fn fresh_art_address() -> Option<String> {
    let guard = LAST_ART.lock().ok()?;
    match guard.as_ref() {
        Some((at, art)) if at.elapsed() <= SUMMARY_MAX_AGE => art.clone(),
        _ => None,
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

/// Where this call goes: the home app's relay when `homeBaseUrl` is set (with the saved desk key,
/// read off the async thread), else the sound service's own address (`sonosBaseUrl`).
/// Only a missing home address falls back; a home address that is set but invalid is an error,
/// so a typo never sends calls around the relay.
fn route_from(home: Result<String, String>, sonos: impl FnOnce() -> Result<String, String>, key: Option<String>) -> Result<Route, String> {
    match home {
        Ok(h) => Ok(Route::relay(h, key)),
        Err(e) if e == crate::wall2_feeds::NOT_CONFIGURED => Ok(Route::direct(sonos()?)),
        Err(e) => Err(e),
    }
}

async fn sonos_route(app: &tauri::AppHandle) -> Result<Route, String> {
    let home = read_base(app, "homeBaseUrl", false);
    let wants_key = matches!(&home, Ok(h) if crate::wall2_desk::token_may_go_to(h));
    let key = if wants_key { crate::wall2_desk::off_thread(|| Ok(crate::wall2_desk_token::read_token())).await? } else { None };
    route_from(home, || read_base(app, "sonosBaseUrl", false), key)
}

async fn dispatch(route: Route, calls: Vec<Call>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || send(&route, &calls)).await.map_err(|_| UNFINISHED.to_string())?
}

// Section: favorites

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Favorite {
    pub id: String,
    pub name: String,
    /// `spotify`, `radio` or `other` when the service said one of them, else None.
    pub kind: Option<String>,
}

/// The id of a favorite: a 64 bit FNV-1a hash of the service's own title, as 16 lowercase hex digits.
fn favorite_id(title: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in title.as_bytes() {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{h:016x}")
}

fn valid_favorite_id(id: &str) -> bool {
    id.len() == 16 && id.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f'))
}

/// The cleaned list and the id to title pairs behind it. None when the answer is not a list or
/// has far more entries than the caps (malformed). An entry with no usable title is left out, and
/// a repeated title counts once.
fn pick_favorites(body: &Value) -> Option<(Vec<Favorite>, Vec<(String, String)>)> {
    let items = body.as_array()?;
    if items.len() > MAX_ENTRIES {
        return None;
    }
    let mut list: Vec<Favorite> = Vec::new();
    let mut titles: Vec<(String, String)> = Vec::new();
    for f in items {
        if list.len() >= MAX_FAVORITES {
            break;
        }
        let Some(title) = f.get("title").and_then(Value::as_str).filter(|t| !t.is_empty() && t.len() <= MAX_FAVORITE_TITLE) else {
            continue;
        };
        let Some(name) = clean_text(title, MAX_FAVORITE_CHARS) else {
            continue;
        };
        let id = favorite_id(title);
        if titles.iter().any(|(i, _)| *i == id) {
            continue;
        }
        let kind = f.get("type").and_then(Value::as_str).filter(|k| FAVORITE_KINDS.contains(k)).map(str::to_string);
        list.push(Favorite { id: id.clone(), name, kind });
        titles.push((id, title.to_string()));
    }
    Some((list, titles))
}

/// The play request for one favorite id on the current group's coordinator. The title goes in
/// the JSON body only; the path is fixed. A group at an unknown level or above 40 needs a confirm.
fn plan_favorite(s: &SonosSummary, titles: &[(String, String)], id: &str, confirm: bool) -> Result<Call, String> {
    if !valid_favorite_id(id) {
        return Err(UNKNOWN_FAVORITE.to_string());
    }
    let title = titles.iter().find(|(i, _)| i == id).map(|(_, t)| t.as_str()).ok_or_else(|| UNKNOWN_FAVORITE.to_string())?;
    let group = s.current_group.as_deref().and_then(|g| s.groups.iter().find(|x| x.id == g)).ok_or_else(|| NO_ROOM.to_string())?;
    if !valid_speaker_name(&group.coordinator) {
        return Err(NO_ROOM.to_string());
    }
    let loud = group
        .members
        .iter()
        .filter_map(|m| s.speakers.iter().find(|sp| sp.name == *m))
        .filter(|sp| sp.online && !on_line_in(sp))
        .any(|sp| !sp.volume.is_some_and(|v| v <= SAFE_VOLUME));
    if loud && !confirm {
        return Err(NEEDS_CONFIRM.to_string());
    }
    Ok(post("/api/action/play-favorite".to_string(), Some(json!({ "favorite": title, "coordinator": group.coordinator }))))
}

/// The id to title pairs of the last favorites read, and when it was.
static FAVORITES: Mutex<Option<(Instant, Vec<(String, String)>)>> = Mutex::new(None);

fn fresh_favorites() -> Result<Vec<(String, String)>, String> {
    let guard = FAVORITES.lock().map_err(|_| OUT_OF_DATE.to_string())?;
    match guard.as_ref() {
        Some((at, t)) if at.elapsed() <= FAVORITES_MAX_AGE => Ok(t.clone()),
        _ => Err(OUT_OF_DATE.to_string()),
    }
}

// Section: commands

#[tauri::command]
pub async fn wall2_sonos_summary(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<SonosSummary, String> {
    require_wall2(window.label())?;
    let route = sonos_route(&app).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let reads = read_all(&route)?;
        if reads_too_big(&reads) {
            wall2_sonos_log::write_line(wall2_sonos_log::line(Event::Failed, Read::Lists, Kind::BadAnswer, 200, 0));
            return Err(Kind::BadAnswer.word().to_string());
        }
        let summary = shape(&reads, now_ms());
        let art = now_art_address(&reads.status, summary.now_playing.as_ref());
        remember(&summary, art);
        Ok(summary)
    })
    .await
    .map_err(|_| Kind::BadAnswer.word().to_string())?
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
    let route = sonos_route(&app).await?;
    let force = force.unwrap_or(false);
    if force && !take_force(&LAST_SKIP, &routine_key)? {
        return Err("Play anyway is offered only right after a skip".to_string());
    }
    let calls = plan_play(&last_good()?, &routine_key, confirm.unwrap_or(false), force)?;
    let call = calls.into_iter().next().ok_or_else(|| REFUSED.to_string())?;
    let body = tauri::async_runtime::spawn_blocking(move || send_one(&route, &call)).await.map_err(|_| UNFINISHED.to_string())??;
    let result = if force { PlayResult { started: true, reason: None } } else { play_outcome(&body) };
    if let Ok(mut guard) = LAST_SKIP.lock() {
        *guard = if result.started { None } else { Some((routine_key, Instant::now())) };
    }
    Ok(result)
}

#[tauri::command]
pub async fn wall2_sonos_preset(window: tauri::WebviewWindow, app: tauri::AppHandle, preset_id: String, confirm: Option<bool>) -> Result<(), String> {
    require_wall2(window.label())?;
    let route = sonos_route(&app).await?;
    let calls = plan_preset(&last_good()?, &preset_id, confirm.unwrap_or(false))?;
    dispatch(route, calls).await
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
    let route = sonos_route(&app).await?;
    let calls = plan_volume(&last_good()?, &target, level, step, confirm.unwrap_or(false))?;
    dispatch(route, calls).await
}

/// Pausing is the safe direction, so it does not wait for a fresh read.
#[tauri::command]
pub async fn wall2_sonos_pause_all(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    require_wall2(window.label())?;
    let route = sonos_route(&app).await?;
    dispatch(route, vec![post("/api/action/pause-all".to_string(), None)]).await
}

/// Back or next. Refused unless the last good read (at most two minutes old) said `canSkip`; the page
/// reads the summary again after it.
#[tauri::command]
pub async fn wall2_sonos_skip(window: tauri::WebviewWindow, app: tauri::AppHandle, direction: String) -> Result<(), String> {
    require_wall2(window.label())?;
    let route = sonos_route(&app).await?;
    let calls = plan_skip(&last_good()?, &direction)?;
    let call = calls.into_iter().next().ok_or_else(|| REFUSED.to_string())?;
    tauri::async_runtime::spawn_blocking(move || send_skip(&route, &call)).await.map_err(|_| UNFINISHED.to_string())?
}

/// The playing track's cover as `{ mime, base64 }`, or nothing. Takes no address from the page: it
/// fetches the one the last good read held (see `wall2_sonos_read` for every bound).
#[tauri::command]
pub async fn wall2_sonos_art(window: tauri::WebviewWindow) -> Result<Option<ArtImage>, String> {
    require_wall2(window.label())?;
    let address = fresh_art_address();
    tauri::async_runtime::spawn_blocking(move || art_cached(&ART, address.as_deref(), |url| fetch_art(art_agent(), url))).await.map_err(|_| UNFINISHED.to_string())
}

/// The service's favorites as `[{id, name, kind}]`. Failure is one fixed word: `timed-out`,
/// `no-answer` or `bad-answer`. Nothing is logged.
#[tauri::command]
pub async fn wall2_sonos_favorites(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<Vec<Favorite>, String> {
    require_wall2(window.label())?;
    let route = sonos_route(&app).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let body = get_json(sonos_agent(), &route, "/api/favorites").map_err(|f| f.kind.word().to_string())?;
        let (list, titles) = pick_favorites(&body).ok_or_else(|| Kind::BadAnswer.word().to_string())?;
        if let Ok(mut guard) = FAVORITES.lock() {
            *guard = Some((Instant::now(), titles));
        }
        Ok(list)
    })
    .await
    .map_err(|_| Kind::BadAnswer.word().to_string())?
}

/// Plays one favorite from the last favorites read on the current group. Needs a recent summary
/// read too (for the group); a loud or unknown level needs `confirm: true`.
#[tauri::command]
pub async fn wall2_sonos_favorite_play(window: tauri::WebviewWindow, app: tauri::AppHandle, favorite_id: String, confirm: Option<bool>) -> Result<(), String> {
    require_wall2(window.label())?;
    let route = sonos_route(&app).await?;
    let call = plan_favorite(&last_good()?, &fresh_favorites()?, &favorite_id, confirm.unwrap_or(false))?;
    let answer = tauri::async_runtime::spawn_blocking(move || send_one(&route, &call)).await.map_err(|_| UNFINISHED.to_string())??;
    if skip_accepted(&answer) { Ok(()) } else { Err(REFUSED.to_string()) }
}

#[tauri::command]
pub async fn wall2_sonos_sleep(window: tauri::WebviewWindow, app: tauri::AppHandle, minutes: u32) -> Result<(), String> {
    require_wall2(window.label())?;
    let route = sonos_route(&app).await?;
    let calls = plan_sleep(minutes)?;
    dispatch(route, calls).await
}

#[tauri::command]
pub async fn wall2_sonos_sleep_cancel(window: tauri::WebviewWindow, app: tauri::AppHandle, id: String) -> Result<(), String> {
    require_wall2(window.label())?;
    let route = sonos_route(&app).await?;
    let calls = plan_sleep_cancel(&last_good()?, &id)?;
    dispatch(route, calls).await
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
                "Den": {"state": "PLAYING", "volume": 12, "inputSource": null, "track": "Song A", "artist": "Band B", "duration": 201, "position": 65, "albumArtURI": "http://192.168.1.50:1400/getaa?s=1&u=x"},
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
            capabilities: json!({"skip": true}),
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
            capabilities: Value::Null,
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
        let started = PlayResult { started: true, reason: None };
        assert_eq!(play_outcome(&json!({"ok": true})), started);
        assert_eq!(play_outcome(&Value::Null), started);
        assert_eq!(play_outcome(&json!({"ok": true, "skipped": false})), started);
        // Only the JSON boolean true is a skip, and the service gives no reason.
        assert_eq!(play_outcome(&json!({"ok": true, "skipped": true})), PlayResult { started: false, reason: None });
        // A routine that ran may list the speakers it left alone: that is not a skip.
        assert_eq!(play_outcome(&json!({"ok": true, "skipped": ["a", "b"]})), started);
        assert_eq!(play_outcome(&json!({"ok": true, "skipped": "false"})), started);
        assert_eq!(play_outcome(&json!({"ok": true, "skipped": "true"})), started);
        assert_eq!(play_outcome(&json!({"ok": true, "skipped": 1})), started);
        assert_eq!(play_outcome(&json!({"ok": true, "skipped": {"a": 1}})), started);
        // A recognised reason key still maps to a fixed phrase.
        let away = play_outcome(&json!({"skipped": true, "reason": "presence is away"}));
        assert_eq!(away, PlayResult { started: false, reason: Some("nobody is home".into()) });
        let tv = play_outcome(&json!({"skipped": true, "condition": {"speaker": "Den", "source": "tv", "is": "on"}}));
        assert_eq!(tv.reason.as_deref(), Some("a speaker is on TV sound"));
        // Text the reader does not recognise never passes through, and `message` is not read.
        let odd = play_outcome(&json!({"skipped": true, "reason": "<b>whatever the service says</b>"}));
        assert_eq!(odd, PlayResult { started: false, reason: None });
        assert_eq!(play_outcome(&json!({"skipped": true, "message": "presence"})).reason, None);
        // "activity" holds "tv" but not as a word.
        assert_eq!(play_outcome(&json!({"skipped": true, "reason": "activity"})).reason, None);
    }

    #[test]
    fn a_forced_call_clears_the_skip_memory_before_it_is_sent() {
        let slot: Mutex<Option<(String, Instant)>> = Mutex::new(Some(("Sunrise_Mix".to_string(), Instant::now())));
        // Another key is refused, and the memory is cleared all the same.
        assert!(!take_force(&slot, "Loud_Party").unwrap());
        assert!(slot.lock().unwrap().is_none());
        *slot.lock().unwrap() = Some(("Sunrise_Mix".to_string(), Instant::now()));
        assert!(take_force(&slot, "Sunrise_Mix").unwrap());
        // A second "Play anyway" (the first write failed or timed out) is refused.
        assert!(!take_force(&slot, "Sunrise_Mix").unwrap());
    }

    #[test]
    fn a_speaker_in_several_preset_groups_is_judged_by_the_loudest() {
        let mut r = reads();
        r.presets = json!({
            "line_first": {"name": "Line first", "groups": [
                {"rooms": ["Studio"], "input": {"type": "lineIn"}},
                {"rooms": ["Studio"], "volume": 70}
            ]},
            "line_last": {"name": "Line last", "groups": [
                {"rooms": ["Studio"], "volume": 70},
                {"rooms": ["Studio"], "input": {"type": "lineIn"}}
            ]},
            "loud_then_quiet": {"name": "Loud then quiet", "groups": [
                {"rooms": ["Studio"], "volume": 70},
                {"rooms": ["Studio"], "volume": 20}
            ]},
            "line_only": {"name": "Line only", "groups": [
                {"rooms": ["Studio"], "input": {"type": "lineIn"}},
                {"rooms": ["Studio"], "input": {"type": "lineIn"}}
            ]}
        });
        let s = shape(&r, 0);
        let loud70 = vec![LoudSpeaker { name: "Studio".into(), level: Some(70), sets: true }];
        assert_eq!(s.presets[0].loud, loud70);
        assert_eq!(s.presets[1].loud, loud70);
        assert_eq!(s.presets[2].loud, loud70);
        assert!(s.presets[3].loud.is_empty());
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

    #[test]
    fn a_track_carries_its_length_position_and_whether_a_cover_may_be_fetched() {
        let np = summary().now_playing.unwrap();
        assert_eq!((np.duration, np.position), (Some(201), Some(65)));
        assert_eq!(np.art, Some(art_key("http://192.168.1.50:1400/getaa?s=1&u=x")));
    }

    #[test]
    fn track_time_table() {
        let t = |v: Value| track_time(&v);
        assert_eq!(t(json!({"duration": 201, "position": 65})), (Some(201), Some(65)));
        assert_eq!(t(json!({"duration": 201.9, "position": 65.9})), (Some(201), Some(65)));
        // A position past the length is clamped to it.
        assert_eq!(t(json!({"duration": 100, "position": 250})), (Some(100), Some(100)));
        // No length, a zero length or a length out of range: no time at all (a station).
        assert_eq!(t(json!({"position": 65})), (None, None));
        assert_eq!(t(json!({"duration": 0, "position": 65})), (None, None));
        assert_eq!(t(json!({"duration": -5, "position": 5})), (None, None));
        assert_eq!(t(json!({"duration": 86_401, "position": 5})), (None, None));
        assert_eq!(t(json!({"duration": "201", "position": 5})), (None, None));
        assert_eq!(t(json!({"duration": null, "position": 5})), (None, None));
        assert_eq!(t(json!({"duration": 86_400, "position": 86_400})), (Some(86_400), Some(86_400)));
        // A missing, negative, out of range or non-number position keeps the length and drops the position.
        assert_eq!(t(json!({"duration": 90})), (Some(90), None));
        assert_eq!(t(json!({"duration": 90, "position": -1})), (Some(90), None));
        assert_eq!(t(json!({"duration": 90, "position": 1_000_000})), (Some(90), None));
        assert_eq!(t(json!({"duration": 90, "position": "12"})), (Some(90), None));
        assert_eq!(t(json!({"duration": 90, "position": 0})), (Some(90), Some(0)));
    }

    #[test]
    fn the_cover_address_is_held_for_the_playing_speaker_only() {
        let r = reads();
        let s = shape(&r, 1);
        assert_eq!(now_art_address(&r.status, s.now_playing.as_ref()).as_deref(), Some("http://192.168.1.50:1400/getaa?s=1&u=x"));
        assert_eq!(now_art_address(&r.status, None), None);
        // A speaker with no address, an empty one or an over-long one holds none.
        for art in [json!(null), json!(""), json!("x".repeat(MAX_ART_ADDRESS + 1)), json!(7)] {
            let mut r = reads();
            r.status["Den"]["albumArtURI"] = art;
            let s = shape(&r, 1);
            assert_eq!(now_art_address(&r.status, s.now_playing.as_ref()), None);
            assert_eq!(s.now_playing.unwrap().art, None);
        }
        // An address this wall would not fetch is not offered to the page either.
        for art in ["http://8.8.8.8:1400/a", "/getaa?s=1", "https://evil.example/a.jpg", "http://127.0.0.1:1400/a"] {
            let mut r = reads();
            r.status["Den"]["albumArtURI"] = json!(art);
            let s = shape(&r, 1);
            assert_eq!(s.now_playing.unwrap().art, None, "{art}");
        }
        let mut r = reads();
        r.status["Den"]["albumArtURI"] = json!("https://i.scdn.co/image/abc");
        assert!(shape(&r, 1).now_playing.unwrap().art.is_some());
    }

    #[test]
    fn the_art_key_changes_with_the_address_and_never_holds_it() {
        let a = art_key("http://192.168.1.50:1400/getaa?s=1&u=x");
        let b = art_key("http://192.168.1.50:1400/getaa?s=1&u=y");
        assert_ne!(a, b);
        assert_eq!(a, art_key("http://192.168.1.50:1400/getaa?s=1&u=x"));
        assert_eq!(a.len(), 16);
        assert!(a.bytes().all(|c| c.is_ascii_hexdigit()));
        assert!(!a.contains("192") && !a.contains("getaa"));
        // The same title with different art, or the same art for the next track, shows in the key alone.
        let mut r = reads();
        r.status["Den"]["albumArtURI"] = json!("http://192.168.1.50:1400/getaa?s=1&u=y");
        assert_eq!(shape(&r, 1).now_playing.unwrap().art, Some(b));
    }

    #[test]
    fn can_skip_only_for_an_exact_true() {
        let with = |v: Value| {
            let mut r = reads();
            r.capabilities = v;
            shape(&r, 1).can_skip
        };
        assert!(with(json!({"skip": true})));
        assert!(!with(json!({"skip": false})));
        assert!(!with(json!({"skip": "true"})));
        assert!(!with(json!({"skip": 1})));
        assert!(!with(json!({})));
        assert!(!with(json!(true)));
        assert!(!with(Value::Null));
    }

    #[test]
    fn skip_is_planned_only_with_the_capability_and_music_playing() {
        let s = summary();
        let next = plan_skip(&s, "next").unwrap();
        assert_eq!((next[0].method, next[0].path.as_str(), next[0].body.clone()), ("POST", "/api/action/next", Some(json!({}))));
        assert_eq!(plan_skip(&s, "previous").unwrap()[0].path, "/api/action/previous");
        for bad in ["", "Next", "next ", "back", "../next", "next?x=1", "NEXT"] {
            assert_eq!(plan_skip(&s, bad).unwrap_err(), REFUSED, "{bad}");
        }
        let mut no_cap = summary();
        no_cap.can_skip = false;
        assert_eq!(plan_skip(&no_cap, "next").unwrap_err(), "cannot-skip");
        // Nothing playing (paused, or only a line-in or offline speaker): the service's own word.
        let mut quiet = summary();
        for sp in &mut quiet.speakers {
            if sp.input.is_none() { sp.state = "paused".to_string(); }
        }
        assert_eq!(plan_skip(&quiet, "previous").unwrap_err(), "nothing-playing");
    }

    #[test]
    fn a_refused_skip_says_the_services_own_word() {
        assert_eq!(skip_refusal(&json!({"error": "nothing-playing"})), "nothing-playing");
        assert_eq!(skip_refusal(&json!({"error": "cannot-skip"})), "cannot-skip");
        assert_eq!(skip_refusal(&json!({"error": "something else entirely"})), REFUSED);
        assert_eq!(skip_refusal(&json!({"error": 4})), REFUSED);
        assert_eq!(skip_refusal(&json!({})), REFUSED);
        assert_eq!(skip_refusal(&Value::Null), REFUSED);
        assert!(skip_accepted(&json!({"ok": true})));
        assert!(skip_accepted(&json!({"ok": true, "other": 1})));
        assert!(!skip_accepted(&json!({"ok": false})));
        assert!(!skip_accepted(&json!({})));
        assert!(!skip_accepted(&Value::Null));
        assert!(!skip_accepted(&json!({"ok": "true"})));
        assert!(!skip_accepted(&json!({"ok": 1})));
        assert!(!skip_accepted(&json!({"ok": null})));
        assert!(!skip_accepted(&json!({"done": true})));
        assert!(!skip_accepted(&json!([{"ok": true}])));
        assert!(!skip_accepted(&json!("ok")));
        assert!(!skip_accepted(&json!(true)));
    }

    /// A loopback-only listener for one test (never a real service): answers every request with the
    /// given status and body, and sends the request it read to the channel.
    fn skip_server(code: u16, body: &'static str) -> (String, std::sync::mpsc::Receiver<String>) {
        use std::io::{Read as _, Write as _};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            if let Ok((mut s, _)) = listener.accept() {
                // The head and the body may arrive in separate writes: read until the client pauses.
                let _ = s.set_read_timeout(Some(Duration::from_millis(300)));
                let mut seen = Vec::new();
                let mut buf = [0u8; 4096];
                while let Ok(n) = s.read(&mut buf) {
                    if n == 0 { break; }
                    seen.extend_from_slice(&buf[..n]);
                    if seen.windows(4).any(|w| w == b"\r\n\r\n") && seen.ends_with(b"{}") { break; }
                }
                let _ = tx.send(String::from_utf8_lossy(&seen).to_string());
                let _ = s.write_all(format!("HTTP/1.1 {code} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes());
            }
        });
        (base, rx)
    }

    fn skip_call() -> Call {
        plan_skip(&summary(), "next").unwrap().remove(0)
    }

    #[test]
    fn a_skip_goes_out_as_an_empty_json_post_and_each_answer_has_its_word() {
        let (base, rx) = skip_server(200, r#"{"ok":true}"#);
        assert_eq!(send_skip(&Route::direct(base), &skip_call()), Ok(()));
        let seen = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(seen.starts_with("POST /api/action/next HTTP/1.1"), "{seen}");
        assert!(seen.to_ascii_lowercase().contains("content-type: application/json"), "{seen}");
        assert!(seen.ends_with("{}"), "{seen}");
        assert_eq!(send_skip(&Route::direct(skip_server(200, r#"{"ok":false}"#).0), &skip_call()), Err(REFUSED.to_string()));
        // Only `{"ok": true}` is done: an empty object, null, a page, another object and "true" as text are the refusal.
        for odd in ["{}", "null", "<html>done</html>", r#"{"done":true}"#, r#"{"ok":"true"}"#, "", "true"] {
            assert_eq!(send_skip(&Route::direct(skip_server(200, odd).0), &skip_call()), Err(REFUSED.to_string()), "{odd}");
        }
        assert_eq!(send_skip(&Route::direct(skip_server(409, r#"{"error":"nothing-playing"}"#).0), &skip_call()), Err("nothing-playing".to_string()));
        assert_eq!(send_skip(&Route::direct(skip_server(400, r#"{"error":"cannot-skip"}"#).0), &skip_call()), Err("cannot-skip".to_string()));
        assert_eq!(send_skip(&Route::direct(skip_server(404, "not json").0), &skip_call()), Err(REFUSED.to_string()));
        assert_eq!(send_skip(&Route::direct(skip_server(500, r#"{"error":"cannot-skip"}"#).0), &skip_call()), Err(REFUSED.to_string()));
        let gone = {
            let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            format!("http://{}", l.local_addr().unwrap())
        };
        assert_eq!(send_skip(&Route::direct(gone.clone()), &skip_call()), Err(UNREACHABLE.to_string()));
    }

    fn favorites_body() -> Value {
        json!([
            {"title": "Quiet Radio", "uri": "x-sonosapi-radio:a", "metadata": "<x/>", "type": "radio", "shuffleable": false},
            {"title": "Pop Picks", "type": "spotify"},
            {"title": "Odd One", "type": "weird"},
            {"title": "Quiet Radio", "type": "radio"},
            {"title": "", "type": "radio"},
            {"type": "radio"},
            "text",
            {"title": 5}
        ])
    }

    #[test]
    fn favorites_are_cleaned_deduplicated_and_kept_with_their_titles() {
        let (list, titles) = pick_favorites(&favorites_body()).unwrap();
        let names: Vec<&str> = list.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, vec!["Quiet Radio", "Pop Picks", "Odd One"]);
        assert_eq!(list[0].kind.as_deref(), Some("radio"));
        assert_eq!(list[1].kind.as_deref(), Some("spotify"));
        assert_eq!(list[2].kind, None);
        assert_eq!(titles.len(), 3);
        assert!(list.iter().all(|f| valid_favorite_id(&f.id)));
        assert_eq!(list[0].id, favorite_id("Quiet Radio"));
    }

    #[test]
    fn favorites_with_missing_fields_or_a_wrong_shape() {
        assert_eq!(pick_favorites(&json!([])).unwrap().0, Vec::<Favorite>::new());
        assert_eq!(pick_favorites(&json!([{}, {"title": null}, {"uri": "x"}])).unwrap().0.len(), 0);
        assert!(pick_favorites(&json!({"items": []})).is_none());
        assert!(pick_favorites(&json!("no")).is_none());
        assert!(pick_favorites(&Value::Null).is_none());
    }

    #[test]
    fn favorites_are_bounded() {
        let many: Vec<Value> = (0..300).map(|i| json!({"title": format!("Station {i}")})).collect();
        let (list, titles) = pick_favorites(&Value::Array(many)).unwrap();
        assert_eq!(list.len(), MAX_FAVORITES);
        assert_eq!(titles.len(), MAX_FAVORITES);
        let far_too_many: Vec<Value> = (0..=MAX_ENTRIES).map(|i| json!({"title": format!("S{i}")})).collect();
        assert!(pick_favorites(&Value::Array(far_too_many)).is_none());
        let long = "w".repeat(300);
        let (list, _) = pick_favorites(&json!([{"title": long}])).unwrap();
        assert_eq!(list[0].name.chars().count(), MAX_FAVORITE_CHARS);
        assert!(list[0].name.ends_with('\u{2026}'));
        let huge = "w".repeat(MAX_FAVORITE_TITLE + 1);
        assert!(pick_favorites(&json!([{"title": huge}])).unwrap().0.is_empty());
        let wide = "\u{e9}".repeat(MAX_FAVORITE_CHARS + 20);
        let (list, _) = pick_favorites(&json!([{"title": wide}])).unwrap();
        assert_eq!(list[0].name.chars().count(), MAX_FAVORITE_CHARS);
    }

    #[test]
    fn favorite_names_lose_control_and_direction_characters() {
        let (list, titles) = pick_favorites(&json!([{"title": "Mor\u{202E}ning\n\u{0007}  Mix\u{200B}"}, {"title": "\u{0007}\u{202E}"}])).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Mor ning Mix");
        // The service gets its own title back untouched.
        assert_eq!(titles[0].1, "Mor\u{202E}ning\n\u{0007}  Mix\u{200B}");
    }

    #[test]
    fn favorite_ids_are_strict() {
        assert!(valid_favorite_id(&favorite_id("x")));
        assert_eq!(favorite_id("x").len(), 16);
        assert_ne!(favorite_id("a"), favorite_id("b"));
        for bad in ["", "abc", "../etc/passwd", "ABCDEF0123456789", "0123456789abcdeg", "0123456789abcde", "0123456789abcdef0", "0123456789abcde/", "0123456789abcd?x"] {
            assert!(!valid_favorite_id(bad), "{bad}");
        }
    }

    #[test]
    fn a_favorite_play_goes_to_the_current_groups_coordinator_with_a_fixed_path() {
        let (_, titles) = pick_favorites(&json!([{"title": "../x?y=1 \"q\""}, {"title": "Quiet Radio"}])).unwrap();
        let s = summary();
        let call = plan_favorite(&s, &titles, &titles[0].0, false).unwrap();
        assert_eq!(call.method, "POST");
        assert_eq!(call.path, "/api/action/play-favorite");
        assert_eq!(call.body, Some(json!({"favorite": "../x?y=1 \"q\"", "coordinator": "Den"})));
        let call = plan_favorite(&s, &titles, &titles[1].0, false).unwrap();
        assert_eq!(call.body.unwrap()["favorite"], "Quiet Radio");
    }

    #[test]
    fn a_favorite_play_refuses_unknown_ids_no_room_and_loud_rooms() {
        let (_, titles) = pick_favorites(&json!([{"title": "Quiet Radio"}])).unwrap();
        let id = titles[0].0.clone();
        let s = summary();
        for bad in ["", "nope", "../x", "0000000000000000"] {
            assert_eq!(plan_favorite(&s, &titles, bad, true).unwrap_err(), UNKNOWN_FAVORITE, "{bad}");
        }
        assert_eq!(plan_favorite(&s, &[], &id, true).unwrap_err(), UNKNOWN_FAVORITE);
        let mut none = summary();
        none.current_group = None;
        assert_eq!(plan_favorite(&none, &titles, &id, true).unwrap_err(), NO_ROOM);
        let mut bad_name = summary();
        bad_name.groups.iter_mut().find(|g| g.id == "G_TWO:2").unwrap().coordinator = "Den\u{7}".to_string();
        assert_eq!(plan_favorite(&bad_name, &titles, &id, true).unwrap_err(), NO_ROOM);
        let mut loud = summary();
        loud.speakers.iter_mut().find(|sp| sp.name == "Porch").unwrap().volume = Some(55);
        assert_eq!(plan_favorite(&loud, &titles, &id, false).unwrap_err(), NEEDS_CONFIRM);
        assert!(plan_favorite(&loud, &titles, &id, true).is_ok());
        let mut unknown_level = summary();
        unknown_level.speakers.iter_mut().find(|sp| sp.name == "Den").unwrap().volume = None;
        assert_eq!(plan_favorite(&unknown_level, &titles, &id, false).unwrap_err(), NEEDS_CONFIRM);
    }

    #[test]
    fn the_favorites_list_is_read_over_get_and_play_posts_the_title_in_the_body() {
        let (base, rx) = skip_server(200, r#"[{"title":"Quiet Radio","type":"radio"}]"#);
        let body = get_json(sonos_agent(), &Route::direct(base), "/api/favorites").unwrap();
        let seen = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(seen.starts_with("GET /api/favorites HTTP/1.1"), "{seen}");
        let (list, titles) = pick_favorites(&body).unwrap();
        assert_eq!(list.len(), 1);
        let call = plan_favorite(&summary(), &titles, &list[0].id, false).unwrap();
        let (base, rx) = skip_server(200, r#"{"ok":true}"#);
        let answer = send_one(&Route::direct(base), &call).unwrap();
        assert!(skip_accepted(&answer));
        let seen = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(seen.starts_with("POST /api/action/play-favorite HTTP/1.1"), "{seen}");
        assert!(seen.contains(r#""favorite":"Quiet Radio""#), "{seen}");
        assert!(seen.contains(r#""coordinator":"Den""#), "{seen}");
    }

    // Section: the relay route

    const HOME: &str = "http://100.64.0.9:5006";
    const ALL_PATHS: [&str; 15] = [
        "/api/status", "/api/speakers", "/api/routines", "/api/groups", "/api/group-presets", "/api/scenes",
        "/api/sleep-timers", "/api/capabilities", "/api/favorites", "/api/trigger/Sunrise_Mix?force=true",
        "/api/group-presets/desk_mode/apply", "/api/action/volume", "/api/action/pause-all",
        "/api/sleep-timer/t1", "/api/action/play-favorite",
    ];

    #[test]
    fn the_relay_url_keeps_every_path_under_api_sonos() {
        let r = Route::relay(HOME, None);
        assert_eq!(r.url("/api/status"), "http://100.64.0.9:5006/api/sonos/status");
        assert_eq!(r.url("/api/trigger/Sunrise_Mix?force=true"), "http://100.64.0.9:5006/api/sonos/trigger/Sunrise_Mix?force=true");
        assert_eq!(r.url("/api/group-presets/desk_mode/apply"), "http://100.64.0.9:5006/api/sonos/group-presets/desk_mode/apply");
        assert_eq!(r.url("/api/sleep-timer/t1"), "http://100.64.0.9:5006/api/sonos/sleep-timer/t1");
        for p in ALL_PATHS {
            let u = r.url(p);
            assert!(u.starts_with("http://100.64.0.9:5006/api/sonos/"), "{u}");
            assert!(!u.contains("/api/sonos/api/") && !u.contains(".."), "{u}");
        }
    }

    #[test]
    fn every_command_the_planners_build_stays_under_the_relay() {
        let s = summary();
        let r = Route::relay(HOME, None);
        let mut calls = plan_play(&s, "Sunrise_Mix", false, false).unwrap();
        calls.extend(plan_preset(&s, "desk_mode", false).unwrap());
        calls.extend(plan_sleep(30).unwrap());
        calls.extend(plan_sleep_cancel(&s, "t1").unwrap());
        calls.extend(plan_skip(&s, "next").unwrap());
        calls.extend(plan_skip(&s, "previous").unwrap());
        calls.push(post("/api/action/pause-all".to_string(), None));
        calls.push(post("/api/action/volume".to_string(), None));
        for c in calls {
            let u = r.url(&c.path);
            assert!(u.starts_with("http://100.64.0.9:5006/api/sonos/"), "{u}");
            assert!(!u.contains("/api/sonos/api/"), "{u}");
        }
    }

    #[test]
    fn without_a_relay_the_service_address_is_used_as_before() {
        let d = Route::direct("http://192.168.1.7:5005");
        assert_eq!(d.url("/api/status"), "http://192.168.1.7:5005/api/status");
        assert_eq!(d.url("/api/action/next"), "http://192.168.1.7:5005/api/action/next");
    }

    #[test]
    fn the_home_address_wins_and_the_service_address_is_the_fallback() {
        let sonos = || Ok("http://192.168.1.7:5005".to_string());
        let r = route_from(Ok(HOME.to_string()), sonos, None).unwrap();
        assert_eq!(r.url("/api/status"), "http://100.64.0.9:5006/api/sonos/status");
        let missing = || Err(crate::wall2_feeds::NOT_CONFIGURED.to_string());
        let r = route_from(missing(), sonos, None).unwrap();
        assert_eq!(r.url("/api/status"), "http://192.168.1.7:5005/api/status");
        assert_eq!(route_from(missing(), missing, None).unwrap_err(), crate::wall2_feeds::NOT_CONFIGURED);
        // A home address that is set but invalid is an error, never a quiet fallback.
        assert_eq!(route_from(Err("bad-address".to_string()), sonos, None).unwrap_err(), "bad-address");
    }

    #[test]
    fn the_desk_key_goes_only_on_the_relay_and_only_where_a_key_may_go() {
        assert_eq!(Route::relay(HOME, Some("k1".to_string())).key.as_deref(), Some("k1"));
        assert_eq!(Route::relay("http://127.0.0.1:5006", Some("k1".to_string())).key.as_deref(), Some("k1"));
        assert_eq!(Route::relay("http://192.168.1.7:5006", Some("k1".to_string())).key, None);
        assert_eq!(Route::relay("https://example.com", Some("k1".to_string())).key, None);
        assert_eq!(Route::direct(HOME).key, None);
        assert!(!format!("{:?}", Route::relay(HOME, Some("k1".to_string()))).contains("k1"));
    }

    #[test]
    fn the_desk_key_header_is_sent_on_a_relay_write_and_not_on_a_direct_one() {
        let (base, rx) = skip_server(200, r#"{"ok":true}"#);
        assert_eq!(send_skip(&Route::relay(base, Some("k1".to_string())), &skip_call()), Ok(()));
        let seen = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(seen.starts_with("POST /api/sonos/action/next HTTP/1.1"), "{seen}");
        assert!(seen.to_ascii_lowercase().contains("x-desk-token: k1"), "{seen}");
        let (base, rx) = skip_server(200, r#"{"ok":true}"#);
        assert_eq!(send_skip(&Route::direct(base), &skip_call()), Ok(()));
        let seen = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(!seen.to_ascii_lowercase().contains("x-desk-token"), "{seen}");
        let (base, rx) = skip_server(200, r#"{"ok":true}"#);
        assert_eq!(send_skip(&Route::relay(base, None), &skip_call()), Ok(()));
        assert!(!rx.recv_timeout(Duration::from_secs(5)).unwrap().to_ascii_lowercase().contains("x-desk-token"));
    }

    #[test]
    fn the_desk_key_header_is_sent_on_a_relay_read() {
        let (base, rx) = skip_server(200, r#"[{"title":"Quiet Radio","type":"radio"}]"#);
        let body = get_json(sonos_agent(), &Route::relay(base, Some("k1".to_string())), "/api/favorites").unwrap();
        assert!(body.is_array());
        let seen = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(seen.starts_with("GET /api/sonos/favorites HTTP/1.1"), "{seen}");
        assert!(seen.to_ascii_lowercase().contains("x-desk-token: k1"), "{seen}");
    }
}
