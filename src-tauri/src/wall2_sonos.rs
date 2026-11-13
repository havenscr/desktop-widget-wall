//! Wall 2 Home Sound block: reads the owner's Sonos service and sends the few commands the
//! block offers.
//!
//! The address comes from `feeds.json` (`sonosBaseUrl`) through the helpers in
//! `wall2_feeds.rs` (scheme, host and port only; plain `http` to a private address is
//! allowed, as for `homeBaseUrl`) and is never put in an error message or a log.
//!
//! Reads (`wall2_sonos_summary`, only when the front end asks): `GET /api/status`,
//! `/api/speakers`, `/api/routines`, then `/api/groups`, `/api/group-presets`,
//! `/api/scenes` and `/api/sleep-timers` (each of these four may fail on its own). The
//! answer is cut down to a bounded, cleaned summary and kept as the last good read.
//!
//! Writes (each only on a click): every key, preset, speaker, group or timer id a write
//! names must be in the last good read (at most ten minutes old), and every request body
//! is built here, never taken from the web view:
//! - `wall2_sonos_play`: `POST /api/trigger/<routine key>?force=true`
//! - `wall2_sonos_preset`: `POST /api/group-presets/<id>/apply`
//! - `wall2_sonos_volume`: `POST /api/action/volume` `{"room", "volume"}` per speaker
//! - `wall2_sonos_pause_all`: `POST /api/action/pause-all`
//! - `wall2_sonos_sleep`: `POST /api/sleep-timer` `{"minutes", "fadeMinutes": 5}`
//! - `wall2_sonos_sleep_cancel`: `DELETE /api/sleep-timer/<id>`
//!
//! A volume change that would raise any speaker above 40, or a music routine that sets a
//! volume above 40, is refused with `needs-confirm` unless the call carries
//! `confirm: true` (the front end asks first). Every command answers only the `wall2`
//! window.

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
/// The highest level a single call may raise a speaker to without `confirm: true`.
pub(crate) const SAFE_VOLUME: u8 = 40;
/// Writes are checked against a read no older than this.
const SUMMARY_MAX_AGE: Duration = Duration::from_secs(10 * 60);
const SLEEP_CHOICES: [u32; 3] = [30, 60, 90];
const SLEEP_FADE_MINUTES: u32 = 5;
/// Control routines the block may start. The others (TV volume profiles and the like) set
/// volumes of their own, so they are left out of the summary and cannot be triggered here.
const CONTROL_ACTIONS: [&str; 3] = ["pauseAll", "groupAll", "ungroupAll"];

const UNREACHABLE: &str = "Could not reach Sonos";
const REFUSED: &str = "Sonos could not do that";
const OUT_OF_DATE: &str = "Sonos status is out of date";
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

fn name_list(v: Option<&Value>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for n in v.and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
        if !out.iter().any(|o| o == n) {
            out.push(n.to_string());
        }
    }
    out
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
    for map in [speakers.as_object(), status.as_object()].into_iter().flatten() {
        for k in map.keys() {
            if valid_speaker_name(k) && !names.contains(k) {
                names.push(k.clone());
            }
        }
    }
    names.truncate(MAX_SPEAKERS);
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
    for g in body.as_array().into_iter().flatten() {
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

fn pick_presets(body: &Value, groups: &[Group], speakers: &[Speaker]) -> Vec<Preset> {
    let mut out: Vec<Preset> = Vec::new();
    for (id, p) in body.as_object().into_iter().flatten() {
        if out.len() >= MAX_PRESETS {
            break;
        }
        if !valid_key(id) || !p.is_object() {
            continue;
        }
        let name = p.get("name").and_then(Value::as_str).and_then(|n| clean_text(n, MAX_NAME_CHARS)).unwrap_or_else(|| id.clone());
        let active = !out.iter().any(|o| o.active) && preset_matches(p, groups, speakers);
        out.push(Preset { id: id.clone(), name, active });
    }
    out
}

fn pick_routines(body: &Value) -> (Vec<MusicRoutine>, Vec<ControlRoutine>) {
    let mut music = Vec::new();
    let mut controls = Vec::new();
    for (key, r) in body.as_object().into_iter().flatten() {
        if !valid_key(key) || !r.is_object() || r.get("enabled").and_then(Value::as_bool) == Some(false) {
            continue;
        }
        let name = r.get("name").and_then(Value::as_str).and_then(|n| clean_text(n, MAX_NAME_CHARS)).unwrap_or_else(|| key.clone());
        match r.get("type").and_then(Value::as_str) {
            Some("music") if music.len() < MAX_ROUTINES => music.push(MusicRoutine {
                key: key.clone(),
                name,
                favorite: r.get("favorite").and_then(Value::as_str).and_then(|f| clean_text(f, MAX_NAME_CHARS)),
                volume: volume_of(r.get("volume")),
            }),
            Some("control") if controls.len() < MAX_ROUTINES => {
                if let Some(action) = r.get("action").and_then(Value::as_str).filter(|a| CONTROL_ACTIONS.contains(a)) {
                    controls.push(ControlRoutine { key: key.clone(), name, action: action.to_string() });
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
        .filter(|(id, s)| valid_key(id) && s.is_object())
        .take(MAX_SCENES)
        .map(|(id, s)| Scene {
            id: id.clone(),
            name: s.get("name").and_then(Value::as_str).and_then(|n| clean_text(n, MAX_NAME_CHARS)).unwrap_or_else(|| id.clone()),
        })
        .collect()
}

/// `endsAt` as epoch milliseconds: an ISO time with an offset, or a number (seconds when
/// small, milliseconds otherwise).
fn ends_at(v: Option<&Value>) -> Option<i64> {
    match v? {
        Value::Number(n) => n.as_f64().filter(|x| x.is_finite() && *x > 0.0).map(|x| if x < 1e11 { (x * 1000.0) as i64 } else { x as i64 }),
        Value::String(s) => parse_iso(s.trim()).map(|secs| (secs * 1000.0) as i64),
        _ => None,
    }
}

fn pick_timers(body: &Value) -> Vec<SleepTimer> {
    let entries: Vec<(String, &Value)> = match body {
        Value::Object(m) => m.iter().map(|(k, v)| (k.clone(), v)).collect(),
        Value::Array(a) => a.iter().filter_map(|v| Some((id_text(v.get("id")?)?, v))).collect(),
        _ => Vec::new(),
    };
    entries
        .into_iter()
        .filter(|(id, v)| valid_key(id) && v.is_object())
        .take(MAX_TIMERS)
        .map(|(id, v)| SleepTimer {
            id,
            ends_at_ms: ends_at(v.get("endsAt")),
            fade_minutes: v.get("fadeMinutes").and_then(Value::as_u64).filter(|m| *m <= 120).map(|m| m as u32),
        })
        .collect()
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
    let (music, controls) = pick_routines(&r.routines);
    let current = current_group(&groups, &speakers);
    let now = now_playing(&r.status, &speakers, &groups, current.as_deref());
    SonosSummary {
        speakers,
        groups,
        presets,
        music,
        controls,
        scenes: pick_scenes(&r.scenes),
        sleep_timers: pick_timers(&r.timers),
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

pub(crate) fn plan_play(s: &SonosSummary, key: &str, confirm: bool) -> Result<Vec<Call>, String> {
    if !valid_key(key) {
        return Err("Unknown routine".to_string());
    }
    if let Some(r) = s.music.iter().find(|r| r.key == key) {
        if r.volume.is_some_and(|v| v > SAFE_VOLUME) && !confirm {
            return Err(NEEDS_CONFIRM.to_string());
        }
    } else if !s.controls.iter().any(|c| c.key == key) {
        return Err("Unknown routine".to_string());
    }
    Ok(vec![post(format!("/api/trigger/{key}?force=true"), None)])
}

pub(crate) fn plan_preset(s: &SonosSummary, id: &str) -> Result<Vec<Call>, String> {
    if !valid_key(id) || !s.presets.iter().any(|p| p.id == id) {
        return Err("Unknown speaker set".to_string());
    }
    Ok(vec![post(format!("/api/group-presets/{id}/apply"), None)])
}

pub(crate) fn plan_volume(s: &SonosSummary, target: &VolumeTarget, level: f64, confirm: bool) -> Result<Vec<Call>, String> {
    if !level.is_finite() {
        return Err("Volume must be a number".to_string());
    }
    let level = level.round().clamp(0.0, 100.0) as u8;
    let rooms: Vec<&Speaker> = match target.kind.as_str() {
        "speaker" => s.speakers.iter().filter(|sp| sp.name == target.id && sp.online).collect(),
        "group" => s
            .groups
            .iter()
            .find(|g| g.id == target.id)
            .map(|g| {
                g.members
                    .iter()
                    .filter_map(|m| s.speakers.iter().find(|sp| &sp.name == m))
                    .filter(|sp| sp.online && !on_line_in(sp))
                    .collect()
            })
            .unwrap_or_default(),
        _ => Vec::new(),
    };
    if rooms.is_empty() {
        return Err(if target.kind == "group" { "Unknown group" } else { "Unknown speaker" }.to_string());
    }
    if level > SAFE_VOLUME && !confirm && rooms.iter().any(|sp| sp.volume.unwrap_or(0) < level) {
        return Err(NEEDS_CONFIRM.to_string());
    }
    Ok(rooms
        .iter()
        .map(|sp| post("/api/action/volume".to_string(), Some(json!({ "room": sp.name, "volume": level }))))
        .collect())
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

fn read_all(base: &str) -> Result<Reads, String> {
    let status = get(base, "/api/status")?;
    let speakers = get(base, "/api/speakers")?;
    let routines = get(base, "/api/routines")?;
    let optional = |path: &str| get(base, path).unwrap_or(Value::Null);
    Ok(Reads {
        status,
        speakers,
        routines,
        groups: optional("/api/groups"),
        presets: optional("/api/group-presets"),
        scenes: optional("/api/scenes"),
        timers: optional("/api/sleep-timers"),
    })
}

fn send(base: &str, calls: &[Call]) -> Result<(), String> {
    for c in calls {
        let req = sonos_agent().request(c.method, &format!("{base}{}", c.path)).set("Accept", "application/json");
        let result = match &c.body {
            Some(b) => req.set("Content-Type", "application/json").send_string(&b.to_string()),
            None => req.call(),
        };
        match result {
            Ok(resp) => {
                require_ok(resp).map_err(|_| REFUSED.to_string())?;
            }
            Err(e) => return Err(fail(e)),
        }
    }
    Ok(())
}

// Section: last good read

static LAST: Mutex<Option<(Instant, SonosSummary)>> = Mutex::new(None);

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
        let summary = shape(&reads, now_ms());
        remember(&summary);
        Ok(summary)
    })
    .await
    .map_err(|_| UNFINISHED.to_string())?
}

#[tauri::command]
pub async fn wall2_sonos_play(window: tauri::WebviewWindow, app: tauri::AppHandle, routine_key: String, confirm: Option<bool>) -> Result<(), String> {
    require_wall2(window.label())?;
    let base = read_base(&app, "sonosBaseUrl", false)?;
    let calls = plan_play(&last_good()?, &routine_key, confirm.unwrap_or(false))?;
    dispatch(base, calls).await
}

#[tauri::command]
pub async fn wall2_sonos_preset(window: tauri::WebviewWindow, app: tauri::AppHandle, preset_id: String) -> Result<(), String> {
    require_wall2(window.label())?;
    let base = read_base(&app, "sonosBaseUrl", false)?;
    let calls = plan_preset(&last_good()?, &preset_id)?;
    dispatch(base, calls).await
}

#[tauri::command]
pub async fn wall2_sonos_volume(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    target: VolumeTarget,
    level: f64,
    confirm: Option<bool>,
) -> Result<(), String> {
    require_wall2(window.label())?;
    let base = read_base(&app, "sonosBaseUrl", false)?;
    let calls = plan_volume(&last_good()?, &target, level, confirm.unwrap_or(false))?;
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
    }

    #[test]
    fn routines_keep_enabled_music_and_safe_controls_only() {
        let s = summary();
        let keys: Vec<&str> = s.music.iter().map(|r| r.key.as_str()).collect();
        assert_eq!(keys, vec!["Sunrise_Mix", "Loud_Party"]);
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
        let list = pick_timers(&json!([{"id": 7, "endsAt": 1_794_520_800}, {"id": "a/b"}]));
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "7");
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
        assert_eq!(plan_play(&s, "Sunrise_Mix", false).unwrap()[0].path, "/api/trigger/Sunrise_Mix?force=true");
        assert_eq!(plan_play(&s, "Stop_All", false).unwrap().len(), 1);
        assert_eq!(plan_play(&s, "Tv_Up", false).unwrap_err(), "Unknown routine");
        assert_eq!(plan_play(&s, "Nope", false).unwrap_err(), "Unknown routine");
        assert_eq!(plan_play(&s, "../x", true).unwrap_err(), "Unknown routine");
        assert_eq!(plan_play(&s, "Loud_Party", false).unwrap_err(), NEEDS_CONFIRM);
        assert!(plan_play(&s, "Loud_Party", true).is_ok());
    }

    #[test]
    fn preset_and_timer_ids_are_checked() {
        let s = summary();
        assert_eq!(plan_preset(&s, "desk_mode").unwrap()[0].path, "/api/group-presets/desk_mode/apply");
        assert!(plan_preset(&s, "bad id").is_err());
        assert!(plan_preset(&s, "elsewhere").is_err());
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
    fn group_volume_skips_line_in_and_offline_speakers() {
        let s = summary();
        let t = VolumeTarget { kind: "group".into(), id: "G_TWO:2".into() };
        let calls = plan_volume(&s, &t, 20.0, false).unwrap();
        let rooms: Vec<&str> = calls.iter().map(|c| c.body.as_ref().unwrap()["room"].as_str().unwrap()).collect();
        assert_eq!(rooms, vec!["Den", "Porch", "Loft"]);
        assert_eq!(calls[0].body.as_ref().unwrap()["volume"], json!(20));
        // A group of one speaker on line-in has nothing the slider may move.
        let t = VolumeTarget { kind: "group".into(), id: "G_ONE:1".into() };
        assert_eq!(plan_volume(&s, &t, 20.0, false).unwrap_err(), "Unknown group");
    }

    #[test]
    fn volume_above_forty_needs_a_confirm_only_when_it_raises() {
        let s = summary();
        let den = VolumeTarget { kind: "speaker".into(), id: "Den".into() };
        assert_eq!(plan_volume(&s, &den, 41.0, false).unwrap_err(), NEEDS_CONFIRM);
        assert!(plan_volume(&s, &den, 40.0, false).is_ok());
        assert!(plan_volume(&s, &den, 80.0, true).is_ok());
        // The studio sits at 100: moving it to 60 lowers it, so no confirm.
        let studio = VolumeTarget { kind: "speaker".into(), id: "Studio".into() };
        assert!(plan_volume(&s, &studio, 60.0, false).is_ok());
        // Clamped to 0..100.
        let c = plan_volume(&s, &den, -5.0, false).unwrap();
        assert_eq!(c[0].body.as_ref().unwrap()["volume"], json!(0));
        assert_eq!(plan_volume(&s, &studio, 250.0, false).unwrap()[0].body.as_ref().unwrap()["volume"], json!(100));
        assert!(plan_volume(&s, &den, f64::NAN, true).is_err());
        // Unknown and offline speakers, unknown kinds.
        assert!(plan_volume(&s, &VolumeTarget { kind: "speaker".into(), id: "Attic".into() }, 5.0, false).is_err());
        assert!(plan_volume(&s, &VolumeTarget { kind: "speaker".into(), id: "Shed".into() }, 5.0, false).is_err());
        assert!(plan_volume(&s, &VolumeTarget { kind: "room".into(), id: "Den".into() }, 5.0, false).is_err());
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
