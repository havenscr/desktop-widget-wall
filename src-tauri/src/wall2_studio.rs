//! Wall 2 studio lights and office moods: the home app's studio and office routes.
//!
//! Reads are `GET {homeBaseUrl}/api/desk/studio` and `/api/desk/office/moods`; writes are
//! POSTs under `/api/desk/studio/...` and `/api/desk/office/moods/:id/apply`, each answering the
//! fresh read shape of its family. The base is `feeds.json` key `homeBaseUrl`; the desk token
//! is the one typed in Tools and kept by `wall2_desk_token`. The token goes only to the
//! configured base, only as the `X-Desk-Token` header, only on a POST to a path built here from
//! constants and a checked id, and only where `wall2_desk::token_may_go_to` allows (`https`,
//! loopback or tailnet). Redirects stay off, so a 3xx is `failed` and the token never follows one.
//!
//! Unlike `wall2_desk`, the body of a 4xx or 5xx answer is read (capped at 64 KB), because two
//! 503 answers differ only by their words. Only the fixed `error` words the home app is known to
//! use are compared; no part of an answer body is ever passed on. Every id is checked against
//! the last good read of its family (kept at most two minutes) before anything is sent, so the
//! page cannot name a preset, group, look or mood the home app did not offer. Numbers are range
//! checked; bodies are built with `serde_json`. Words, all fixed: `not-configured`, `absent`,
//! `not-set-up`, `needs-private-address`, `forbidden`, `studio-not-set-up`, `home-not-set-up`,
//! `not-answering`, `room-dark`, `nothing-to-undo`, `busy`, `unknown`, `refused`,
//! `unreachable`, `failed`. Nothing here logs.

use crate::wall2_desk::{base, clean_text, is_stale, off_thread, token_may_go_to, ABSENT, FAILED, FORBIDDEN, INSECURE, NO_TOKEN};
use crate::wall2_keylights::{BRI_MAX, BRI_MIN, KELVIN_MAX, KELVIN_MIN};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Mirrors `wall2_desk.rs` `MAX_BODY`.
const MAX_BODY: u64 = 64 * 1024;
/// The home app's own cap on presets and looks (contract section 2).
const MAX_PRESETS: usize = 6;
const MAX_LOOKS: usize = 6;
/// Mirrors `wall2_home.rs` `MAX_MOODS`.
const MAX_MOODS: usize = 12;
/// Mirrors `wall2_desk.rs` `MAX_ROOM_NAME`.
const MAX_LABEL: usize = 40;
/// Mirrors `wall2_desk.rs` `MAX_ALERT_TEXT`.
const MAX_LINE: usize = 120;
/// Mirrors `wall2_sonos.rs` `SUMMARY_MAX_AGE`: a read older than this is read again first.
const SEEN_MAX_AGE: Duration = Duration::from_secs(2 * 60);
/// A preset runs Hue, Nanoleaf and key light calls in turn (contract change 10): 30 s.
const WRITE_TIMEOUT: Duration = Duration::from_secs(30);

const GROUP_IDS: [&str; 3] = ["panels", "behindMonitor", "overhead"];

pub(crate) const UNREACHABLE: &str = "unreachable";
pub(crate) const REFUSED: &str = "refused";
pub(crate) const UNKNOWN: &str = "unknown";
pub(crate) const BUSY: &str = "busy";
pub(crate) const STUDIO_NOT_SET_UP: &str = "studio-not-set-up";
pub(crate) const HOME_NOT_SET_UP: &str = "home-not-set-up";
pub(crate) const NOT_ANSWERING: &str = "not-answering";
pub(crate) const ROOM_DARK: &str = "room-dark";
pub(crate) const NOTHING_TO_UNDO: &str = "nothing-to-undo";

// Section: shapes

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: String,
    pub label: String,
    pub line: Option<String>,
    pub active: bool,
    pub sets_key_lights: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub label: String,
    pub on: bool,
    pub set_to: Option<String>,
    pub colour: Option<String>,
    pub can_switch: bool,
    pub can_dim: bool,
    pub level: Option<u8>,
    pub floor: Option<u8>,
    pub reachable: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum KeySide {
    Light { on: bool, brightness: u8, kelvin: u16 },
    Word(String),
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Keys {
    pub can_set: bool,
    pub left: Option<KeySide>,
    pub right: Option<KeySide>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Look {
    pub id: String,
    pub label: String,
    pub active: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Studio {
    pub stale: bool,
    pub presets: Vec<Preset>,
    pub changed: bool,
    pub groups: Vec<Group>,
    pub keys: Option<Keys>,
    pub looks: Vec<Look>,
    pub can_normal: bool,
    pub normal_line: Option<String>,
    /// A token is set on this PC and the base may carry it. Only the fact, never the token.
    pub can_write: bool,
    /// Why `can_write` is false: `not-set-up` or `needs-private-address`.
    pub write_block: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Mood {
    pub id: String,
    pub label: String,
    pub line: Option<String>,
    pub active: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Moods {
    pub stale: bool,
    pub moods: Vec<Mood>,
    pub can_write: bool,
    pub write_block: Option<String>,
}

/// `^[A-Za-z][A-Za-z0-9]{0,31}$`, as `wall2_home.rs` `valid_mood_id`.
pub(crate) fn valid_id(id: &str) -> bool {
    let mut chars = id.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() => {}
        _ => return false,
    }
    id.len() <= 32 && chars.all(|c| c.is_ascii_alphanumeric())
}

fn flag(v: &Value, key: &str) -> bool {
    v.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn id_of(v: &Value) -> Option<String> {
    let s = v.get("id")?.as_str()?;
    valid_id(s).then(|| s.to_string())
}

/// `#` and six hex digits, else None.
fn colour(raw: Option<&Value>) -> Option<String> {
    let s = raw?.as_str()?;
    let ok = s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit());
    ok.then(|| s.to_string())
}

/// A whole number 0 to 100, else None.
fn percent(raw: Option<&Value>) -> Option<u8> {
    let n = raw?.as_u64()?;
    (n <= 100).then_some(n as u8)
}

fn key_side(raw: Option<&Value>) -> Option<KeySide> {
    match raw? {
        Value::String(s) if s == "no-answer" || s == "other-model" => Some(KeySide::Word(s.clone())),
        Value::Object(o) => {
            let on = o.get("on")?.as_bool()?;
            let brightness = o.get("brightness")?.as_i64().filter(|n| (BRI_MIN..=BRI_MAX).contains(n))?;
            let kelvin = o.get("kelvin")?.as_i64().filter(|n| (KELVIN_MIN..=KELVIN_MAX).contains(n))?;
            Some(KeySide::Light { on, brightness: brightness as u8, kelvin: kelvin as u16 })
        }
        _ => None,
    }
}

fn shape_keys(raw: Option<&Value>) -> Option<Keys> {
    let o = raw?.as_object()?;
    Some(Keys { can_set: o.get("canSet").and_then(Value::as_bool).unwrap_or(false), left: key_side(o.get("left")), right: key_side(o.get("right")) })
}

/// The checked studio shape; None when the answer is not the studio shape at all (no
/// `presets` or no `groups` list). Entries with a bad or repeated id are dropped.
pub(crate) fn shape_studio(body: &Value, can_write: bool, write_block: Option<&str>) -> Option<Studio> {
    let presets_raw = body.get("presets")?.as_array()?;
    let groups_raw = body.get("groups")?.as_array()?;
    let mut presets: Vec<Preset> = Vec::new();
    for p in presets_raw {
        let (Some(id), Some(label)) = (id_of(p), clean_text(p.get("label"), MAX_LABEL)) else { continue };
        if presets.iter().any(|x| x.id == id) {
            continue;
        }
        presets.push(Preset { id, label, line: clean_text(p.get("line"), MAX_LINE), active: flag(p, "active"), sets_key_lights: flag(p, "setsKeyLights") });
        if presets.len() == MAX_PRESETS {
            break;
        }
    }
    let mut groups: Vec<Group> = Vec::new();
    for g in groups_raw {
        let Some(id) = id_of(g).filter(|i| GROUP_IDS.contains(&i.as_str())) else { continue };
        let Some(label) = clean_text(g.get("label"), MAX_LABEL) else { continue };
        if groups.iter().any(|x| x.id == id) {
            continue;
        }
        groups.push(Group {
            id,
            label,
            on: flag(g, "on"),
            set_to: clean_text(g.get("setTo"), MAX_LABEL),
            colour: colour(g.get("colour")),
            can_switch: flag(g, "canSwitch"),
            can_dim: flag(g, "canDim"),
            level: percent(g.get("level")),
            floor: percent(g.get("floor")),
            reachable: flag(g, "reachable"),
        });
    }
    let mut looks: Vec<Look> = Vec::new();
    if let Some(list) = body.get("looks").and_then(Value::as_array) {
        for l in list {
            let (Some(id), Some(label)) = (id_of(l), clean_text(l.get("label"), MAX_LABEL)) else { continue };
            if looks.iter().any(|x| x.id == id) {
                continue;
            }
            looks.push(Look { id, label, active: flag(l, "active") });
            if looks.len() == MAX_LOOKS {
                break;
            }
        }
    }
    Some(Studio {
        // A missing flag counts as stale (as `wall2_desk::is_stale`).
        stale: is_stale(body),
        presets,
        changed: flag(body, "changed"),
        groups,
        keys: shape_keys(body.get("keys")),
        looks,
        can_normal: flag(body, "canNormal"),
        normal_line: clean_text(body.get("normalLine"), MAX_LINE),
        can_write,
        write_block: write_block.map(str::to_string),
    })
}

/// The checked moods shape; None when there is no `moods` list.
pub(crate) fn shape_moods(body: &Value, can_write: bool, write_block: Option<&str>) -> Option<Moods> {
    let list = body.get("moods")?.as_array()?;
    let mut moods: Vec<Mood> = Vec::new();
    for m in list {
        let (Some(id), Some(label)) = (id_of(m), clean_text(m.get("label"), MAX_LABEL)) else { continue };
        if moods.iter().any(|x| x.id == id) {
            continue;
        }
        moods.push(Mood { id, label, line: clean_text(m.get("line"), MAX_LINE), active: flag(m, "active") });
        if moods.len() == MAX_MOODS {
            break;
        }
    }
    Some(Moods { stale: is_stale(body), moods, can_write, write_block: write_block.map(str::to_string) })
}

// Section: transport seam (tests use a fake; nothing in tests reaches a real service)

pub(crate) struct Reply {
    pub code: u16,
    pub body: Vec<u8>,
}

pub(crate) enum NetErr {
    /// No answer, a timeout or a connection error.
    Down,
    /// The answer was over the cap.
    TooBig,
}

pub(crate) trait StudioHttp {
    fn get(&self, url: &str) -> Result<Reply, NetErr>;
    fn post(&self, url: &str, headers: &[(&str, &str)], body: &str) -> Result<Reply, NetErr>;
}

/// The body when it is within `MAX_BODY`, else `TooBig`.
fn within_cap(buf: Vec<u8>) -> Result<Vec<u8>, NetErr> {
    if buf.len() as u64 > MAX_BODY {
        Err(NetErr::TooBig)
    } else {
        Ok(buf)
    }
}

fn read_capped(resp: ureq::Response) -> Result<Vec<u8>, NetErr> {
    let mut buf = Vec::new();
    resp.into_reader().take(MAX_BODY + 1).read_to_end(&mut buf).map_err(|_| NetErr::Down)?;
    within_cap(buf)
}

/// Unlike `wall2_desk::finish`, an error status keeps its (capped) body: the words matter.
fn finish(result: Result<ureq::Response, ureq::Error>) -> Result<Reply, NetErr> {
    match result {
        Ok(resp) => {
            let code = resp.status();
            Ok(Reply { code, body: read_capped(resp)? })
        }
        Err(ureq::Error::Status(code, resp)) => Ok(Reply { code, body: read_capped(resp)? }),
        Err(ureq::Error::Transport(_)) => Err(NetErr::Down),
    }
}

/// The write agent: like the shared one (`wall2_feeds::agent`, redirects off) but with the 30 s timeout.
fn write_agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| ureq::AgentBuilder::new().timeout(WRITE_TIMEOUT).redirects(0).build())
}

struct RealHttp;

impl StudioHttp for RealHttp {
    fn get(&self, url: &str) -> Result<Reply, NetErr> {
        finish(crate::wall2_feeds::agent().get(url).set("Accept", "application/json").call())
    }
    fn post(&self, url: &str, headers: &[(&str, &str)], body: &str) -> Result<Reply, NetErr> {
        let mut req = write_agent().post(url).set("Accept", "application/json");
        for (k, v) in headers {
            req = req.set(k, v);
        }
        finish(req.send_string(body))
    }
}

// Section: words

/// The fixed word for a home answer that is not a 2xx. Only exact `error` words are compared.
pub(crate) fn word_for(get: bool, code: u16, body: &[u8]) -> String {
    let error = serde_json::from_slice::<Value>(body).ok().and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_string));
    let word = match (code, error.as_deref()) {
        (404 | 501, _) if get => ABSENT,
        (404, Some("Unknown preset" | "Unknown group" | "Unknown look" | "Unknown mood")) => UNKNOWN,
        (404, _) => ABSENT,
        (409, Some("Studio not set up")) => STUDIO_NOT_SET_UP,
        (409, Some("Room would be dark")) => ROOM_DARK,
        (409, Some("Nothing to go back from")) => NOTHING_TO_UNDO,
        (409, Some("Studio busy")) => BUSY,
        (403, Some("Invalid desk token")) => FORBIDDEN,
        (503, Some("desk writes are not configured")) => HOME_NOT_SET_UP,
        (503, Some("Light not answering")) => NOT_ANSWERING,
        _ => FAILED,
    };
    word.to_string()
}

/// A good answer is a 2xx JSON object with `ok: true`; anything else is one fixed word.
fn interpret(get: bool, reply: Result<Reply, NetErr>) -> Result<Value, String> {
    let reply = match reply {
        Ok(r) => r,
        Err(NetErr::Down) => return Err(UNREACHABLE.to_string()),
        Err(NetErr::TooBig) => return Err(FAILED.to_string()),
    };
    if (200..300).contains(&reply.code) {
        let body: Value = serde_json::from_slice(&reply.body).map_err(|_| FAILED.to_string())?;
        if !body.is_object() || body.get("ok").and_then(Value::as_bool) != Some(true) {
            return Err(FAILED.to_string());
        }
        return Ok(body);
    }
    Err(word_for(get, reply.code, &reply.body))
}

// Section: last good read, token rule, operations

/// What the last good studio read offered: the only ids and limits a write may use.
#[derive(Debug, Clone)]
struct StudioIds {
    presets: Vec<String>,
    groups: Vec<GroupRule>,
    looks: Vec<String>,
    keys_can_set: bool,
}

#[derive(Debug, Clone)]
struct GroupRule {
    id: String,
    can_switch: bool,
    can_dim: bool,
    floor: Option<u8>,
}

fn ids_of(s: &Studio) -> StudioIds {
    StudioIds {
        presets: s.presets.iter().map(|p| p.id.clone()).collect(),
        groups: s.groups.iter().map(|g| GroupRule { id: g.id.clone(), can_switch: g.can_switch, can_dim: g.can_dim, floor: g.floor }).collect(),
        looks: s.looks.iter().map(|l| l.id.clone()).collect(),
        keys_can_set: s.keys.as_ref().is_some_and(|k| k.can_set),
    }
}

#[derive(Default)]
pub(crate) struct Seen {
    studio: Option<(Instant, StudioIds)>,
    moods: Option<(Instant, Vec<String>)>,
}

fn global_seen() -> &'static Mutex<Seen> {
    static SEEN: OnceLock<Mutex<Seen>> = OnceLock::new();
    SEEN.get_or_init(|| Mutex::new(Seen::default()))
}

fn lock(seen: &Mutex<Seen>) -> std::sync::MutexGuard<'_, Seen> {
    seen.lock().unwrap_or_else(|p| p.into_inner())
}

pub(crate) struct Env<'a> {
    pub http: &'a dyn StudioHttp,
    pub base: &'a str,
    pub token: Option<&'a str>,
    pub seen: &'a Mutex<Seen>,
    pub now: Instant,
}

impl Env<'_> {
    /// Whether this PC may write, and if not why (never the token or the base).
    fn write_state(&self) -> (bool, Option<&'static str>) {
        match self.token {
            None => (false, Some(NO_TOKEN)),
            Some(_) if !token_may_go_to(self.base) => (false, Some(INSECURE)),
            Some(_) => (true, None),
        }
    }

    /// Before any write: no token is `not-set-up`, a base the token may not go to is
    /// `needs-private-address`. Neither sends anything.
    fn gate(&self) -> Result<&str, String> {
        match self.write_state() {
            (true, _) => Ok(self.token.unwrap_or_default()),
            (false, why) => Err(why.unwrap_or(FAILED).to_string()),
        }
    }

    fn fresh(&self, at: Instant) -> bool {
        self.now.checked_duration_since(at).is_some_and(|age| age <= SEEN_MAX_AGE)
    }
}

pub(crate) fn read_studio(env: &Env) -> Result<Studio, String> {
    let body = interpret(true, env.http.get(&format!("{}/api/desk/studio", env.base)))?;
    finish_studio(env, &body)
}

fn finish_studio(env: &Env, body: &Value) -> Result<Studio, String> {
    let (can_write, block) = env.write_state();
    let studio = shape_studio(body, can_write, block).ok_or_else(|| FAILED.to_string())?;
    lock(env.seen).studio = Some((env.now, ids_of(&studio)));
    Ok(studio)
}

pub(crate) fn read_moods(env: &Env) -> Result<Moods, String> {
    let body = interpret(true, env.http.get(&format!("{}/api/desk/office/moods", env.base)))?;
    finish_moods(env, &body)
}

fn finish_moods(env: &Env, body: &Value) -> Result<Moods, String> {
    let (can_write, block) = env.write_state();
    let moods = shape_moods(body, can_write, block).ok_or_else(|| FAILED.to_string())?;
    lock(env.seen).moods = Some((env.now, moods.moods.iter().map(|m| m.id.clone()).collect()));
    Ok(moods)
}

/// The ids of the last good studio read, read again first when there is none or it is old.
fn studio_ids(env: &Env) -> Result<StudioIds, String> {
    if let Some((at, ids)) = lock(env.seen).studio.clone() {
        if env.fresh(at) {
            return Ok(ids);
        }
    }
    Ok(ids_of(&read_studio(env)?))
}

fn mood_ids(env: &Env) -> Result<Vec<String>, String> {
    if let Some((at, ids)) = lock(env.seen).moods.clone() {
        if env.fresh(at) {
            return Ok(ids);
        }
    }
    Ok(read_moods(env)?.moods.into_iter().map(|m| m.id).collect())
}

/// One POST: the token only as a header value, the body as given. The answer is the fresh read shape.
fn post(env: &Env, token: &str, path: &str, body: &str) -> Result<Value, String> {
    let url = format!("{}{}", env.base, path);
    let headers = [("Content-Type", "application/json"), ("X-Desk-Token", token)];
    interpret(false, env.http.post(&url, &headers, body))
}

/// The exact body of an apply or normal call.
const EMPTY_BODY: &str = "{}";

pub(crate) fn studio_preset(env: &Env, id: &str) -> Result<Studio, String> {
    let token = env.gate()?;
    if !valid_id(id) || !studio_ids(env)?.presets.iter().any(|p| p == id) {
        return Err(REFUSED.to_string());
    }
    let body = post(env, token, &format!("/api/desk/studio/presets/{id}/apply"), EMPTY_BODY)?;
    finish_studio(env, &body)
}

pub(crate) fn studio_normal(env: &Env) -> Result<Studio, String> {
    let token = env.gate()?;
    let body = post(env, token, "/api/desk/studio/normal", EMPTY_BODY)?;
    finish_studio(env, &body)
}

pub(crate) fn studio_look(env: &Env, id: &str) -> Result<Studio, String> {
    let token = env.gate()?;
    if !valid_id(id) || !studio_ids(env)?.looks.iter().any(|l| l == id) {
        return Err(REFUSED.to_string());
    }
    let body = post(env, token, &format!("/api/desk/studio/looks/{id}/apply"), EMPTY_BODY)?;
    finish_studio(env, &body)
}

pub(crate) fn studio_group(env: &Env, id: &str, on: bool, level: Option<i64>) -> Result<Studio, String> {
    let token = env.gate()?;
    if !GROUP_IDS.contains(&id) {
        return Err(REFUSED.to_string());
    }
    let ids = studio_ids(env)?;
    let Some(rule) = ids.groups.iter().find(|g| g.id == id) else { return Err(REFUSED.to_string()) };
    if !rule.can_switch {
        return Err(REFUSED.to_string());
    }
    let mut body = Map::new();
    body.insert("on".to_string(), json!(on));
    if let Some(level) = level {
        // The home app answers 400 for a level with `on: false`, and clamps one below the
        // floor (room groups) or below 1 (panels): the wall sends nothing it would clamp.
        let lowest = if id == "panels" { 1 } else { i64::from(rule.floor.unwrap_or(0)) };
        if !on || !rule.can_dim || !(lowest..=100).contains(&level) {
            return Err(REFUSED.to_string());
        }
        body.insert("level".to_string(), json!(level));
    }
    let body = post(env, token, &format!("/api/desk/studio/groups/{id}"), &Value::Object(body).to_string())?;
    finish_studio(env, &body)
}

pub(crate) fn studio_keys(env: &Env, which: &str, on: Option<bool>, brightness: Option<i64>, kelvin: Option<i64>) -> Result<Studio, String> {
    let token = env.gate()?;
    if !matches!(which, "left" | "right" | "both") || (on.is_none() && brightness.is_none() && kelvin.is_none()) {
        return Err(REFUSED.to_string());
    }
    if brightness.is_some_and(|b| !(BRI_MIN..=BRI_MAX).contains(&b)) || kelvin.is_some_and(|k| !(KELVIN_MIN..=KELVIN_MAX).contains(&k)) {
        return Err(REFUSED.to_string());
    }
    if !studio_ids(env)?.keys_can_set {
        return Err(REFUSED.to_string());
    }
    let mut body = Map::new();
    body.insert("which".to_string(), json!(which));
    if let Some(on) = on {
        body.insert("on".to_string(), json!(on));
    }
    if let Some(b) = brightness {
        body.insert("brightness".to_string(), json!(b));
    }
    if let Some(k) = kelvin {
        body.insert("kelvin".to_string(), json!(k));
    }
    let body = post(env, token, "/api/desk/studio/keylights", &Value::Object(body).to_string())?;
    finish_studio(env, &body)
}

pub(crate) fn office_mood(env: &Env, id: &str) -> Result<Moods, String> {
    let token = env.gate()?;
    if !valid_id(id) || !mood_ids(env)?.iter().any(|m| m == id) {
        return Err(REFUSED.to_string());
    }
    let body = post(env, token, &format!("/api/desk/office/moods/{id}/apply"), EMPTY_BODY)?;
    finish_moods(env, &body)
}

// Section: one home write at a time

/// Held while a write is out; a second write from the page meanwhile is `busy` and sends nothing.
pub(crate) struct WriteGuard<'a>(&'a AtomicBool);

impl<'a> WriteGuard<'a> {
    pub(crate) fn try_take(flag: &'a AtomicBool) -> Option<WriteGuard<'a>> {
        flag.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).ok().map(|_| WriteGuard(flag))
    }
}

impl Drop for WriteGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

fn writing() -> &'static AtomicBool {
    static WRITING: AtomicBool = AtomicBool::new(false);
    &WRITING
}

// Section: commands (wall2 window only; blocking work off the async thread)

/// A read: no write guard, the token is read only to say whether a write is possible.
async fn run_read<T: Send + 'static>(app: tauri::AppHandle, f: impl FnOnce(&Env) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    let base = base(&app)?;
    off_thread(move || {
        let token = crate::wall2_desk_token::read_token();
        let env = Env { http: &RealHttp, base: &base, token: token.as_deref(), seen: global_seen(), now: Instant::now() };
        f(&env)
    })
    .await
}

/// A write: one at a time from the wall; the guard is held for the whole call.
async fn run_write<T: Send + 'static>(app: tauri::AppHandle, f: impl FnOnce(&Env) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    let base = base(&app)?;
    off_thread(move || {
        let Some(_guard) = WriteGuard::try_take(writing()) else { return Err(BUSY.to_string()) };
        let token = crate::wall2_desk_token::read_token();
        let env = Env { http: &RealHttp, base: &base, token: token.as_deref(), seen: global_seen(), now: Instant::now() };
        f(&env)
    })
    .await
}

#[tauri::command]
pub async fn wall2_studio(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<Studio, String> {
    crate::wall2_meet::require_wall2(window.label())?;
    run_read(app, |env| read_studio(env)).await
}

#[tauri::command]
pub async fn wall2_studio_preset(window: tauri::WebviewWindow, app: tauri::AppHandle, id: String) -> Result<Studio, String> {
    crate::wall2_meet::require_wall2(window.label())?;
    run_write(app, move |env| studio_preset(env, &id)).await
}

#[tauri::command]
pub async fn wall2_studio_normal(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<Studio, String> {
    crate::wall2_meet::require_wall2(window.label())?;
    run_write(app, |env| studio_normal(env)).await
}

#[tauri::command]
pub async fn wall2_studio_group(window: tauri::WebviewWindow, app: tauri::AppHandle, id: String, on: bool, level: Option<i64>) -> Result<Studio, String> {
    crate::wall2_meet::require_wall2(window.label())?;
    run_write(app, move |env| studio_group(env, &id, on, level)).await
}

#[tauri::command]
pub async fn wall2_studio_look(window: tauri::WebviewWindow, app: tauri::AppHandle, id: String) -> Result<Studio, String> {
    crate::wall2_meet::require_wall2(window.label())?;
    run_write(app, move |env| studio_look(env, &id)).await
}

#[tauri::command]
pub async fn wall2_studio_keys(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    which: String,
    on: Option<bool>,
    brightness: Option<i64>,
    kelvin: Option<i64>,
) -> Result<Studio, String> {
    crate::wall2_meet::require_wall2(window.label())?;
    run_write(app, move |env| studio_keys(env, &which, on, brightness, kelvin)).await
}

#[tauri::command]
pub async fn wall2_office_moods(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<Moods, String> {
    crate::wall2_meet::require_wall2(window.label())?;
    run_read(app, |env| read_moods(env)).await
}

#[tauri::command]
pub async fn wall2_office_mood(window: tauri::WebviewWindow, app: tauri::AppHandle, id: String) -> Result<Moods, String> {
    crate::wall2_meet::require_wall2(window.label())?;
    run_write(app, move |env| office_mood(env, &id)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::VecDeque;

    const TOKEN: &str = "s3cr3t-desk-token-value";
    const HTTPS: &str = "https://home.invalid";

    #[derive(Debug, Clone)]
    struct Call {
        method: &'static str,
        url: String,
        headers: Vec<(String, String)>,
        body: String,
    }

    #[derive(Default)]
    struct Fake {
        replies: RefCell<VecDeque<Result<Reply, NetErr>>>,
        calls: RefCell<Vec<Call>>,
    }

    impl Fake {
        fn push(&self, code: u16, body: &str) {
            self.replies.borrow_mut().push_back(Ok(Reply { code, body: body.as_bytes().to_vec() }));
        }
        fn push_err(&self, e: NetErr) {
            self.replies.borrow_mut().push_back(Err(e));
        }
        fn calls(&self) -> Vec<Call> {
            self.calls.borrow().clone()
        }
        fn next(&self) -> Result<Reply, NetErr> {
            self.replies.borrow_mut().pop_front().unwrap_or(Err(NetErr::Down))
        }
    }

    impl StudioHttp for Fake {
        fn get(&self, url: &str) -> Result<Reply, NetErr> {
            self.calls.borrow_mut().push(Call { method: "GET", url: url.to_string(), headers: Vec::new(), body: String::new() });
            self.next()
        }
        fn post(&self, url: &str, headers: &[(&str, &str)], body: &str) -> Result<Reply, NetErr> {
            let h = headers.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
            self.calls.borrow_mut().push(Call { method: "POST", url: url.to_string(), headers: h, body: body.to_string() });
            self.next()
        }
    }

    fn env<'a>(f: &'a Fake, base: &'a str, token: Option<&'a str>, seen: &'a Mutex<Seen>, now: Instant) -> Env<'a> {
        Env { http: f, base, token, seen, now }
    }

    fn studio_body() -> Value {
        json!({
            "ok": true, "stale": false, "changed": false,
            "presets": [
                {"id": "onAir", "label": "On air", "line": "Key lights on, panels bright", "active": false, "setsKeyLights": true},
                {"id": "recording", "label": "Recording", "line": "Room 80%", "active": true, "setsKeyLights": true}
            ],
            "groups": [
                {"id": "panels", "label": "Panels", "on": true, "setTo": "Glow 70%", "colour": null, "canSwitch": true, "canDim": true, "level": 70, "floor": null, "reachable": true},
                {"id": "behindMonitor", "label": "Behind monitor", "on": true, "setTo": "White 80%", "colour": "#fff1dd", "canSwitch": true, "canDim": true, "level": 80, "floor": 45, "reachable": true},
                {"id": "overhead", "label": "Overhead", "on": false, "setTo": "Off", "colour": null, "canSwitch": true, "canDim": true, "level": 0, "floor": 45, "reachable": true}
            ],
            "keys": {"canSet": true, "left": {"on": true, "brightness": 60, "kelvin": 4400}, "right": "no-answer"},
            "looks": [{"id": "glow", "label": "Glow", "active": true}, {"id": "calm", "label": "Calm", "active": false}],
            "canNormal": false, "normalLine": null
        })
    }

    fn moods_body() -> Value {
        json!({"ok": true, "stale": false, "moods": [
            {"id": "gaming", "label": "Gaming", "line": "Room 25%", "active": false},
            {"id": "reading", "label": "Reading", "line": "Room 60%", "active": true}
        ]})
    }

    // Section: shape rules

    #[test]
    fn studio_shape_good_answer() {
        let s = shape_studio(&studio_body(), true, None).unwrap();
        assert!(!s.stale && !s.changed && s.can_write && s.write_block.is_none());
        assert_eq!(s.presets.len(), 2);
        assert_eq!(s.presets[0], Preset { id: "onAir".into(), label: "On air".into(), line: Some("Key lights on, panels bright".into()), active: false, sets_key_lights: true });
        assert!(s.presets[1].active);
        assert_eq!(s.groups.iter().map(|g| g.id.as_str()).collect::<Vec<_>>(), vec!["panels", "behindMonitor", "overhead"]);
        assert_eq!(s.groups[0].colour, None);
        assert_eq!(s.groups[1].colour.as_deref(), Some("#fff1dd"));
        assert_eq!(s.groups[1].floor, Some(45));
        assert_eq!(s.groups[0].floor, None);
        let keys = s.keys.unwrap();
        assert!(keys.can_set);
        assert_eq!(keys.left, Some(KeySide::Light { on: true, brightness: 60, kelvin: 4400 }));
        assert_eq!(keys.right, Some(KeySide::Word("no-answer".into())));
        assert_eq!(s.looks.len(), 2);
        assert!(!s.can_normal);
        assert_eq!(s.normal_line, None);
    }

    #[test]
    fn presets_and_looks_are_capped_and_bad_entries_dropped() {
        let many: Vec<Value> = (0..10).map(|i| json!({"id": format!("p{i}"), "label": "Preset"})).collect();
        let looks: Vec<Value> = (0..10).map(|i| json!({"id": format!("l{i}"), "label": "Look"})).collect();
        let mut b = studio_body();
        b["presets"] = json!(many);
        b["looks"] = json!(looks);
        let s = shape_studio(&b, false, Some("not-set-up")).unwrap();
        assert_eq!(s.presets.len(), 6);
        assert_eq!(s.looks.len(), 6);
        assert_eq!(s.write_block.as_deref(), Some("not-set-up"));
        assert!(!s.can_write);

        let mut b = studio_body();
        b["presets"] = json!([
            {"id": "ok1", "label": "One"},
            {"id": "bad id", "label": "Spaces"},
            {"id": "1starts", "label": "Digit first"},
            {"id": "x".repeat(33), "label": "Too long"},
            {"id": "ok1", "label": "Duplicate"},
            {"id": "..", "label": "Dots"},
            {"id": "ok2", "label": "  "},
            {"id": "ok3"},
            {"label": "No id"},
            {"id": "ok4", "label": "Four"}
        ]);
        let s = shape_studio(&b, true, None).unwrap();
        assert_eq!(s.presets.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), vec!["ok1", "ok4"]);
        assert_eq!(s.presets[0].label, "One");
    }

    #[test]
    fn groups_unknown_ids_and_duplicates_dropped_in_the_home_order() {
        let mut b = studio_body();
        b["groups"] = json!([
            {"id": "overhead", "label": "Overhead", "on": true},
            {"id": "kitchen", "label": "Kitchen", "on": true},
            {"id": "__proto__", "label": "Proto", "on": true},
            {"id": "constructor", "label": "Ctor", "on": true},
            {"id": "overhead", "label": "Overhead again", "on": false},
            {"id": "panels", "label": "Panels", "on": true}
        ]);
        let s = shape_studio(&b, true, None).unwrap();
        assert_eq!(s.groups.iter().map(|g| g.id.as_str()).collect::<Vec<_>>(), vec!["overhead", "panels"]);
        assert_eq!(s.groups[0].label, "Overhead");
        // Booleans missing or not boolean count as false.
        assert!(s.groups[0].on);
        assert!(!s.groups[0].can_switch && !s.groups[0].can_dim && !s.groups[0].reachable);
        b["groups"] = json!([{"id": "panels", "label": "Panels", "on": "yes", "canSwitch": 1, "reachable": null}]);
        let g = &shape_studio(&b, true, None).unwrap().groups[0];
        assert!(!g.on && !g.can_switch && !g.reachable);
    }

    #[test]
    fn text_is_cleaned_and_cut() {
        let mut b = studio_body();
        b["presets"] = json!([{"id": "a", "label": "n".repeat(60), "line": "l".repeat(200)}, {"id": "b", "label": "Two\nlines\u{7}here", "line": "  "}]);
        b["normalLine"] = json!("z".repeat(500));
        b["groups"] = json!([{"id": "panels", "label": "Panels", "setTo": "s".repeat(90)}]);
        let s = shape_studio(&b, true, None).unwrap();
        assert_eq!(s.presets[0].label.chars().count(), 40);
        assert_eq!(s.presets[0].line.as_ref().unwrap().chars().count(), 120);
        assert_eq!(s.presets[1].label, "Two lines here");
        assert_eq!(s.presets[1].line, None);
        assert_eq!(s.normal_line.as_ref().unwrap().chars().count(), 120);
        assert_eq!(s.groups[0].set_to.as_ref().unwrap().chars().count(), 40);
    }

    #[test]
    fn colour_and_level_rules() {
        for (raw, want) in [
            (json!("#a1B2c3"), Some("#a1B2c3")),
            (json!("#fff"), None),
            (json!("fff1dd"), None),
            (json!("#fff1ddd"), None),
            (json!("#gggggg"), None),
            (json!("red; background:url(x)"), None),
            (json!(5), None),
            (json!(null), None),
        ] {
            assert_eq!(colour(Some(&raw)).as_deref(), want, "{raw}");
        }
        for (raw, want) in [(json!(0), Some(0)), (json!(100), Some(100)), (json!(101), None), (json!(-1), None), (json!(45.5), None), (json!("45"), None), (json!(null), None)] {
            assert_eq!(percent(Some(&raw)), want, "{raw}");
        }
        assert_eq!(percent(None), None);
    }

    #[test]
    fn stale_missing_counts_as_stale_and_a_bad_shape_is_none() {
        let mut b = studio_body();
        b.as_object_mut().unwrap().remove("stale");
        assert!(shape_studio(&b, true, None).unwrap().stale);
        b["stale"] = json!("no");
        assert!(shape_studio(&b, true, None).unwrap().stale);
        assert!(shape_studio(&json!({"ok": true}), true, None).is_none());
        assert!(shape_studio(&json!({"ok": true, "presets": [], "groups": "x"}), true, None).is_none());
        assert!(shape_studio(&json!({"ok": true, "presets": {}, "groups": []}), true, None).is_none());
        assert!(shape_studio(&json!([1, 2]), true, None).is_none());
        // Looks and keys are optional.
        let s = shape_studio(&json!({"ok": true, "presets": [], "groups": []}), true, None).unwrap();
        assert!(s.looks.is_empty() && s.keys.is_none() && s.stale);
    }

    #[test]
    fn key_light_words_and_numbers() {
        let mut b = studio_body();
        for (raw, want) in [
            (json!("no-answer"), Some(KeySide::Word("no-answer".into()))),
            (json!("other-model"), Some(KeySide::Word("other-model".into()))),
            (json!("<script>"), None),
            (json!(null), None),
            (json!({"on": true, "brightness": 3, "kelvin": 2900}), Some(KeySide::Light { on: true, brightness: 3, kelvin: 2900 })),
            (json!({"on": false, "brightness": 100, "kelvin": 7000}), Some(KeySide::Light { on: false, brightness: 100, kelvin: 7000 })),
            (json!({"on": true, "brightness": 2, "kelvin": 4400}), None),
            (json!({"on": true, "brightness": 101, "kelvin": 4400}), None),
            (json!({"on": true, "brightness": 60, "kelvin": 2899}), None),
            (json!({"on": true, "brightness": 60, "kelvin": 7001}), None),
            (json!({"on": true, "brightness": 60.5, "kelvin": 4400}), None),
            (json!({"on": 1, "brightness": 60, "kelvin": 4400}), None),
            (json!({"brightness": 60, "kelvin": 4400}), None),
        ] {
            b["keys"] = json!({"canSet": true, "left": raw.clone(), "right": null});
            assert_eq!(shape_studio(&b, true, None).unwrap().keys.unwrap().left, want, "{raw}");
        }
        b["keys"] = json!(null);
        assert!(shape_studio(&b, true, None).unwrap().keys.is_none());
        b["keys"] = json!("x");
        assert!(shape_studio(&b, true, None).unwrap().keys.is_none());
        // The serialized form: a light is an object, a word is a string, absent is null.
        b["keys"] = json!({"canSet": true, "left": {"on": true, "brightness": 60, "kelvin": 4400}, "right": "no-answer"});
        let out = serde_json::to_value(shape_studio(&b, true, None).unwrap()).unwrap();
        assert_eq!(out["keys"]["left"], json!({"on": true, "brightness": 60, "kelvin": 4400}));
        assert_eq!(out["keys"]["right"], json!("no-answer"));
        assert_eq!(out["canWrite"], json!(true));
        assert_eq!(out["writeBlock"], json!(null));
        assert!(out["presets"][0].get("setsKeyLights").is_some());
    }

    #[test]
    fn moods_shape() {
        let m = shape_moods(&moods_body(), true, None).unwrap();
        assert_eq!(m.moods.len(), 2);
        assert!(m.moods[1].active && !m.moods[0].active);
        let many: Vec<Value> = (0..20).map(|i| json!({"id": format!("m{i}"), "label": "Mood"})).collect();
        let b = json!({"ok": true, "stale": false, "moods": many});
        assert_eq!(shape_moods(&b, false, Some("not-set-up")).unwrap().moods.len(), 12);
        let b = json!({"moods": [{"id": "a b", "label": "x"}, {"id": "ok", "label": "Ok"}, {"id": "ok", "label": "Dup"}]});
        let m = shape_moods(&b, true, None).unwrap();
        assert_eq!(m.moods.len(), 1);
        assert!(m.stale);
        assert!(shape_moods(&json!({"ok": true}), true, None).is_none());
        assert!(shape_moods(&json!({"moods": []}), true, None).unwrap().moods.is_empty());
    }

    // Section: the word table

    #[test]
    fn every_row_of_the_word_table() {
        let body = |e: &str| json!({"ok": false, "error": e}).to_string();
        let rows: Vec<(bool, u16, String, &str)> = vec![
            (true, 404, "<html>not found</html>".into(), "absent"),
            (true, 404, body("anything"), "absent"),
            (true, 501, String::new(), "absent"),
            (true, 409, body("Studio not set up"), "studio-not-set-up"),
            (true, 403, body("Invalid desk token"), "forbidden"),
            (false, 403, body("Invalid desk token"), "forbidden"),
            (false, 503, body("desk writes are not configured"), "home-not-set-up"),
            (false, 503, body("Light not answering"), "not-answering"),
            (false, 409, body("Studio not set up"), "studio-not-set-up"),
            (false, 409, body("Room would be dark"), "room-dark"),
            (false, 409, body("Nothing to go back from"), "nothing-to-undo"),
            (false, 409, body("Studio busy"), "busy"),
            (false, 404, body("Unknown preset"), "unknown"),
            (false, 404, body("Unknown group"), "unknown"),
            (false, 404, body("Unknown look"), "unknown"),
            (false, 404, body("Unknown mood"), "unknown"),
            (false, 404, "<html><body>Cannot POST</body></html>".into(), "absent"),
            (false, 404, body("Something else"), "absent"),
            (false, 400, body("Bad value"), "failed"),
            (false, 403, body("Cross-site requests are not allowed"), "failed"),
            (false, 413, body("Body too large (16 KB limit)"), "failed"),
            (false, 415, body("Content-Type must be application/json"), "failed"),
            (false, 400, body("Invalid JSON"), "failed"),
            (false, 500, body("Could not set the lights"), "failed"),
            (false, 302, String::new(), "failed"),
            (false, 307, body("Studio busy"), "failed"),
            (true, 301, String::new(), "failed"),
            (false, 503, body("something unlisted"), "failed"),
            (false, 503, "not json".into(), "failed"),
            (false, 409, body("Another 409"), "failed"),
            (true, 500, String::new(), "failed"),
        ];
        for (get, code, text, want) in rows {
            assert_eq!(word_for(get, code, text.as_bytes()), want, "get={get} code={code} body={text}");
        }
    }

    #[test]
    fn the_two_503_answers_are_told_apart_by_words_not_status() {
        let f = Fake::default();
        f.push(503, r#"{"ok":false,"error":"desk writes are not configured"}"#);
        f.push(503, r#"{"ok":false,"error":"Light not answering"}"#);
        let seen = Mutex::new(Seen::default());
        let t0 = Instant::now();
        let e = env(&f, HTTPS, Some(TOKEN), &seen, t0);
        // `normal` takes no id, so there is no read first: each call is one POST.
        assert_eq!(studio_normal(&e).unwrap_err(), "home-not-set-up");
        assert_eq!(studio_normal(&e).unwrap_err(), "not-answering");
    }

    #[test]
    fn replies_that_are_not_good_are_one_word() {
        let seen = Mutex::new(Seen::default());
        let t0 = Instant::now();
        let f = Fake::default();
        f.push_err(NetErr::Down);
        assert_eq!(read_studio(&env(&f, HTTPS, None, &seen, t0)).unwrap_err(), "unreachable");
        f.push_err(NetErr::TooBig);
        assert_eq!(read_studio(&env(&f, HTTPS, None, &seen, t0)).unwrap_err(), "failed");
        // A 2xx without ok:true, not JSON, not an object, or with a bad shape is failed.
        for body in [r#"{"ok":false,"presets":[],"groups":[]}"#, "not json", "[]", r#"{"ok":true}"#, r#"{"presets":[],"groups":[]}"#, r#"{"ok":"true","presets":[],"groups":[]}"#] {
            let f = Fake::default();
            f.push(200, body);
            assert_eq!(read_studio(&env(&f, HTTPS, None, &seen, t0)).unwrap_err(), "failed", "{body}");
        }
        // A 3xx is failed, even with a good looking body.
        let f = Fake::default();
        f.push(302, &studio_body().to_string());
        assert_eq!(read_studio(&env(&f, HTTPS, None, &seen, t0)).unwrap_err(), "failed");
    }

    #[test]
    fn an_answer_over_the_cap_is_failed() {
        assert!(within_cap(vec![0u8; 64 * 1024]).is_ok());
        assert!(matches!(within_cap(vec![0u8; 64 * 1024 + 1]), Err(NetErr::TooBig)));
        let seen = Mutex::new(Seen::default());
        let f = Fake::default();
        f.push_err(NetErr::TooBig);
        assert_eq!(read_moods(&env(&f, HTTPS, None, &seen, Instant::now())).unwrap_err(), "failed");
    }

    // Section: the token rules

    #[test]
    fn reads_need_no_token_and_say_why_writes_cannot() {
        let seen = Mutex::new(Seen::default());
        let t0 = Instant::now();
        let f = Fake::default();
        f.push(200, &studio_body().to_string());
        let s = read_studio(&env(&f, HTTPS, None, &seen, t0)).unwrap();
        assert!(!s.can_write);
        assert_eq!(s.write_block.as_deref(), Some("not-set-up"));
        assert!(f.calls()[0].headers.is_empty());
        let f = Fake::default();
        f.push(200, &studio_body().to_string());
        let s = read_studio(&env(&f, "http://192.0.2.7:8080", Some(TOKEN), &seen, t0)).unwrap();
        assert!(!s.can_write);
        assert_eq!(s.write_block.as_deref(), Some("needs-private-address"));
        let f = Fake::default();
        f.push(200, &moods_body().to_string());
        let m = read_moods(&env(&f, "http://localhost:5006", Some(TOKEN), &seen, t0)).unwrap();
        assert!(m.can_write);
        assert_eq!(m.write_block, None);
        // A tailnet base counts too.
        assert!(env(&f, "http://100.100.1.2:5006", Some(TOKEN), &seen, t0).write_state().0);
    }

    #[test]
    fn a_write_without_a_token_or_to_a_plain_http_lan_base_sends_nothing() {
        let seen = Mutex::new(Seen::default());
        let t0 = Instant::now();
        let f = Fake::default();
        f.push(200, &studio_body().to_string());
        let no_token = env(&f, HTTPS, None, &seen, t0);
        assert_eq!(studio_preset(&no_token, "onAir").unwrap_err(), "not-set-up");
        assert_eq!(studio_normal(&no_token).unwrap_err(), "not-set-up");
        assert_eq!(studio_group(&no_token, "panels", true, None).unwrap_err(), "not-set-up");
        assert_eq!(studio_look(&no_token, "glow").unwrap_err(), "not-set-up");
        assert_eq!(studio_keys(&no_token, "both", Some(true), None, None).unwrap_err(), "not-set-up");
        assert_eq!(office_mood(&no_token, "gaming").unwrap_err(), "not-set-up");
        let lan = env(&f, "http://203.0.113.50:5006", Some(TOKEN), &seen, t0);
        assert_eq!(studio_preset(&lan, "onAir").unwrap_err(), "needs-private-address");
        assert_eq!(studio_normal(&lan).unwrap_err(), "needs-private-address");
        assert_eq!(studio_group(&lan, "panels", true, None).unwrap_err(), "needs-private-address");
        assert_eq!(studio_look(&lan, "glow").unwrap_err(), "needs-private-address");
        assert_eq!(studio_keys(&lan, "both", Some(true), None, None).unwrap_err(), "needs-private-address");
        assert_eq!(office_mood(&lan, "gaming").unwrap_err(), "needs-private-address");
        assert!(f.calls().is_empty(), "nothing may be sent");
    }

    #[test]
    fn the_token_is_only_the_header_of_a_post_and_in_no_output() {
        let seen = Mutex::new(Seen::default());
        let t0 = Instant::now();
        let f = Fake::default();
        f.push(200, &studio_body().to_string());
        f.push(200, &studio_body().to_string());
        let e = env(&f, HTTPS, Some(TOKEN), &seen, t0);
        let s = studio_preset(&e, "onAir").unwrap();
        let calls = f.calls();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].method, "GET");
        assert!(calls[0].headers.is_empty());
        assert_eq!(calls[1].method, "POST");
        assert_eq!(calls[1].url, "https://home.invalid/api/desk/studio/presets/onAir/apply");
        assert!(calls[1].headers.contains(&("X-Desk-Token".to_string(), TOKEN.to_string())));
        assert!(calls[1].headers.contains(&("Content-Type".to_string(), "application/json".to_string())));
        for c in &calls {
            assert!(!c.url.contains(TOKEN) && !c.body.contains(TOKEN));
            for (k, v) in &c.headers {
                if k != "X-Desk-Token" {
                    assert!(!v.contains(TOKEN));
                }
            }
        }
        let shown = format!("{s:?}");
        let json = serde_json::to_string(&s).unwrap();
        assert!(!shown.contains(TOKEN) && !json.contains(TOKEN));
        // Every error word is free of the token as well, whatever the home app echoes back.
        let f = Fake::default();
        f.push(403, &format!(r#"{{"ok":false,"error":"Invalid desk token {TOKEN}"}}"#));
        let err = studio_normal(&env(&f, HTTPS, Some(TOKEN), &seen, t0)).unwrap_err();
        assert_eq!(err, "failed");
        assert!(!err.contains(TOKEN));
        let f = Fake::default();
        f.push(403, r#"{"ok":false,"error":"Invalid desk token"}"#);
        assert_eq!(studio_normal(&env(&f, HTTPS, Some(TOKEN), &seen, t0)).unwrap_err(), "forbidden");
    }

    // Section: inputs checked before anything is sent

    fn seeded<'a>(f: &'a Fake, seen: &'a Mutex<Seen>, t0: Instant) -> Env<'a> {
        let e = env(f, HTTPS, Some(TOKEN), seen, t0);
        f.push(200, &studio_body().to_string());
        read_studio(&e).unwrap();
        f.push(200, &moods_body().to_string());
        read_moods(&e).unwrap();
        e
    }

    #[test]
    fn ids_not_in_the_last_good_read_are_refused_with_no_request() {
        let seen = Mutex::new(Seen::default());
        let t0 = Instant::now();
        let f = Fake::default();
        let e = seeded(&f, &seen, t0);
        let before = f.calls().len();
        let long = "a".repeat(33);
        for id in ["unknown", "constructor", "__proto__", "..", "../normal", "onAir/apply", "on Air", "", long.as_str(), "1abc", "onair"] {
            assert_eq!(studio_preset(&e, id).unwrap_err(), "refused", "{id}");
            assert_eq!(studio_look(&e, id).unwrap_err(), "refused", "{id}");
            assert_eq!(office_mood(&e, id).unwrap_err(), "refused", "{id}");
        }
        // A look id is not a preset id, a preset id is not a mood id.
        assert_eq!(studio_preset(&e, "glow").unwrap_err(), "refused");
        assert_eq!(studio_look(&e, "onAir").unwrap_err(), "refused");
        assert_eq!(office_mood(&e, "onAir").unwrap_err(), "refused");
        for id in ["kitchen", "constructor", "Panels", "behindmonitor", "panels/x", ""] {
            assert_eq!(studio_group(&e, id, true, None).unwrap_err(), "refused", "{id}");
        }
        assert_eq!(f.calls().len(), before, "no request for a refused id");
    }

    #[test]
    fn group_levels_and_switches() {
        let seen = Mutex::new(Seen::default());
        let t0 = Instant::now();
        let f = Fake::default();
        let e = seeded(&f, &seen, t0);
        let before = f.calls().len();
        // level with on:false; below the floor; above 100; below 1 for panels; not a level for a group that cannot dim.
        assert_eq!(studio_group(&e, "panels", false, Some(50)).unwrap_err(), "refused");
        assert_eq!(studio_group(&e, "behindMonitor", true, Some(44)).unwrap_err(), "refused");
        assert_eq!(studio_group(&e, "behindMonitor", true, Some(101)).unwrap_err(), "refused");
        assert_eq!(studio_group(&e, "behindMonitor", true, Some(-5)).unwrap_err(), "refused");
        assert_eq!(studio_group(&e, "panels", true, Some(0)).unwrap_err(), "refused");
        assert_eq!(f.calls().len(), before);
        // A group that cannot switch is refused; one that cannot dim takes no level.
        let mut b = studio_body();
        b["groups"][1]["canSwitch"] = json!(false);
        b["groups"][2]["canDim"] = json!(false);
        f.push(200, &b.to_string());
        read_studio(&e).unwrap();
        let n = f.calls().len();
        assert_eq!(studio_group(&e, "behindMonitor", true, None).unwrap_err(), "refused");
        assert_eq!(studio_group(&e, "overhead", true, Some(60)).unwrap_err(), "refused");
        assert_eq!(f.calls().len(), n);
        // On with no level, and the floor itself, are fine.
        for _ in 0..4 {
            f.push(200, &studio_body().to_string());
        }
        read_studio(&e).unwrap();
        studio_group(&e, "behindMonitor", true, Some(45)).unwrap();
        studio_group(&e, "overhead", false, None).unwrap();
        studio_group(&e, "panels", true, Some(1)).unwrap();
    }

    #[test]
    fn key_light_inputs() {
        let seen = Mutex::new(Seen::default());
        let t0 = Instant::now();
        let f = Fake::default();
        let e = seeded(&f, &seen, t0);
        let before = f.calls().len();
        assert_eq!(studio_keys(&e, "middle", Some(true), None, None).unwrap_err(), "refused");
        assert_eq!(studio_keys(&e, "192.0.2.4", Some(true), None, None).unwrap_err(), "refused");
        assert_eq!(studio_keys(&e, "Left", Some(true), None, None).unwrap_err(), "refused");
        assert_eq!(studio_keys(&e, "both", None, None, None).unwrap_err(), "refused");
        assert_eq!(studio_keys(&e, "both", None, Some(2), None).unwrap_err(), "refused");
        assert_eq!(studio_keys(&e, "both", None, Some(101), None).unwrap_err(), "refused");
        assert_eq!(studio_keys(&e, "both", None, None, Some(2899)).unwrap_err(), "refused");
        assert_eq!(studio_keys(&e, "both", None, None, Some(7001)).unwrap_err(), "refused");
        assert_eq!(f.calls().len(), before);
        // canSet false (or keys null): refused with no request.
        let mut b = studio_body();
        b["keys"]["canSet"] = json!(false);
        f.push(200, &b.to_string());
        read_studio(&e).unwrap();
        let n = f.calls().len();
        assert_eq!(studio_keys(&e, "both", Some(true), None, None).unwrap_err(), "refused");
        b["keys"] = json!(null);
        f.push(200, &b.to_string());
        read_studio(&e).unwrap();
        let n2 = f.calls().len();
        assert_eq!(studio_keys(&e, "both", Some(true), None, None).unwrap_err(), "refused");
        assert_eq!(f.calls().len(), n2);
        assert!(n2 > n);
    }

    #[test]
    fn bodies_are_exact_json() {
        let seen = Mutex::new(Seen::default());
        let t0 = Instant::now();
        let f = Fake::default();
        let e = seeded(&f, &seen, t0);
        let cases: Vec<(Box<dyn Fn() -> Result<Studio, String>>, &str, Value)> = vec![
            (Box::new(|| studio_preset(&e, "recording")), "/api/desk/studio/presets/recording/apply", json!({})),
            (Box::new(|| studio_normal(&e)), "/api/desk/studio/normal", json!({})),
            (Box::new(|| studio_look(&e, "calm")), "/api/desk/studio/looks/calm/apply", json!({})),
            (Box::new(|| studio_group(&e, "overhead", true, Some(70))), "/api/desk/studio/groups/overhead", json!({"on": true, "level": 70})),
            (Box::new(|| studio_group(&e, "panels", false, None)), "/api/desk/studio/groups/panels", json!({"on": false})),
            (Box::new(|| studio_keys(&e, "left", Some(false), None, None)), "/api/desk/studio/keylights", json!({"which": "left", "on": false})),
            (Box::new(|| studio_keys(&e, "both", None, Some(55), Some(4600))), "/api/desk/studio/keylights", json!({"which": "both", "brightness": 55, "kelvin": 4600})),
        ];
        for (call, path, want) in cases {
            f.push(200, &studio_body().to_string());
            let n = f.calls().len();
            call().unwrap();
            let c = f.calls()[n].clone();
            assert_eq!(c.method, "POST");
            assert_eq!(c.url, format!("{HTTPS}{path}"));
            assert_eq!(serde_json::from_str::<Value>(&c.body).unwrap(), want, "{path}");
            if want == json!({}) {
                assert_eq!(c.body, "{}");
            }
        }
        f.push(200, &moods_body().to_string());
        let n = f.calls().len();
        let m = office_mood(&e, "gaming").unwrap();
        assert_eq!(m.moods.len(), 2);
        let c = f.calls()[n].clone();
        assert_eq!((c.method, c.url.as_str(), c.body.as_str()), ("POST", "https://home.invalid/api/desk/office/moods/gaming/apply", "{}"));
    }

    #[test]
    fn an_old_read_is_read_again_first() {
        let seen = Mutex::new(Seen::default());
        let t0 = Instant::now();
        let f = Fake::default();
        {
            let e = seeded(&f, &seen, t0);
            let n = f.calls().len();
            // Within two minutes: no read first, one POST.
            f.push(200, &studio_body().to_string());
            let at_two_min = env(&f, HTTPS, Some(TOKEN), &seen, t0 + Duration::from_secs(120));
            studio_preset(&at_two_min, "onAir").unwrap();
            let methods: Vec<&str> = f.calls()[n..].iter().map(|c| c.method).collect();
            assert_eq!(methods, vec!["POST"]);
            let _ = e;
        }
        // Over two minutes after the last good read (the POST answer counts as one, at t0 + 120 s).
        let n = f.calls().len();
        f.push(200, &studio_body().to_string());
        f.push(200, &studio_body().to_string());
        let late = env(&f, HTTPS, Some(TOKEN), &seen, t0 + Duration::from_secs(120 + 121));
        studio_look(&late, "glow").unwrap();
        let methods: Vec<&str> = f.calls()[n..].iter().map(|c| c.method).collect();
        assert_eq!(methods, vec!["GET", "POST"]);
        // The fresh read is what the id is checked against: a look that left the list is refused.
        let mut b = studio_body();
        b["looks"] = json!([{"id": "calm", "label": "Calm", "active": false}]);
        let n = f.calls().len();
        f.push(200, &b.to_string());
        let later = env(&f, HTTPS, Some(TOKEN), &seen, t0 + Duration::from_secs(1000));
        assert_eq!(studio_look(&later, "glow").unwrap_err(), "refused");
        assert_eq!(f.calls()[n..].iter().filter(|c| c.method == "POST").count(), 0);
        // With no read at all, and the fresh read failing, the word of the read is the answer.
        let empty = Mutex::new(Seen::default());
        let f2 = Fake::default();
        f2.push_err(NetErr::Down);
        assert_eq!(studio_preset(&env(&f2, HTTPS, Some(TOKEN), &empty, t0), "onAir").unwrap_err(), "unreachable");
        assert_eq!(f2.calls().len(), 1);
        assert_eq!(f2.calls()[0].method, "GET");
    }

    #[test]
    fn a_failed_write_keeps_the_words_and_leaves_the_last_good_read() {
        let seen = Mutex::new(Seen::default());
        let t0 = Instant::now();
        let f = Fake::default();
        let e = seeded(&f, &seen, t0);
        f.push(409, r#"{"ok":false,"error":"Room would be dark"}"#);
        assert_eq!(studio_group(&e, "overhead", false, None).unwrap_err(), "room-dark");
        f.push(409, r#"{"ok":false,"error":"Studio busy"}"#);
        assert_eq!(studio_preset(&e, "onAir").unwrap_err(), "busy");
        f.push(404, r#"{"ok":false,"error":"Unknown preset"}"#);
        assert_eq!(studio_preset(&e, "onAir").unwrap_err(), "unknown");
        f.push_err(NetErr::Down);
        assert_eq!(studio_preset(&e, "onAir").unwrap_err(), "unreachable");
        f.push(302, "");
        assert_eq!(studio_normal(&e).unwrap_err(), "failed");
        f.push(200, r#"{"ok":true}"#);
        assert_eq!(studio_normal(&e).unwrap_err(), "failed");
        // The last good read still stands: the next write needs no read first.
        let n = f.calls().len();
        f.push(200, &studio_body().to_string());
        studio_preset(&e, "onAir").unwrap();
        assert_eq!(f.calls().len(), n + 1);
    }

    #[test]
    fn one_write_at_a_time() {
        let flag = AtomicBool::new(false);
        let first = WriteGuard::try_take(&flag);
        assert!(first.is_some());
        assert!(WriteGuard::try_take(&flag).is_none(), "a second write while one is out is refused");
        drop(first);
        assert!(WriteGuard::try_take(&flag).is_some(), "the guard is released on drop");
    }

    #[test]
    fn valid_id_rule() {
        for ok in ["a", "onAir", "behindMonitor", &"a".repeat(32)] {
            assert!(valid_id(ok), "{ok}");
        }
        for bad in ["", "1a", "a-b", "a_b", "a b", "a/b", "..", "a.b", &"a".repeat(33), "\u{e9}a", "a\n"] {
            assert!(!valid_id(bad), "{bad:?}");
        }
    }
}
