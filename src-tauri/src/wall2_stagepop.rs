//! The stage pop-out channel: a local WebSocket server the Firefox add-on connects to, so the wall can
//! open, close, place and switch the pop-out window and show which views it offers.
//!
//! Security, in the order a connection meets it:
//! - Bound to `127.0.0.1` only (`bind_ok`); a busy port is the state `port busy`, never another port.
//! - A peer that is not loopback is dropped; at most `MAX_CONNS` connections are served at once.
//! - The handshake needs an `Origin` of `moz-extension://<id>` (`origin_ok`); web pages send `http`,
//!   `https` or `null` and get 403. After the first good hello the origin is pinned and kept in
//!   `onair-stagepop.json`; any other origin is refused from then on.
//! - Right after the handshake the server sends `{type:"challenge", nonce, v:2}`. The client has 2 seconds to answer
//!   `{type:"hello", v:2, cnonce, mac}` with `mac` = base64(HMAC-SHA256(token, "stagepop-client|nonce|origin")); the
//!   server checks it with `ct_eq`, then answers `{type:"welcome", mac}` with base64(HMAC-SHA256(token,
//!   "stagepop-server|cnonce|nonce")) so the add-on can verify the server before it sends anything. The token itself
//!   never crosses the socket. A v1 hello (the raw token) is refused. The pairing token (32 random bytes, Credential
//!   Manager, `WidgetWall2/stagepop/token/0`) is shown once in Tools. A wrong MAC closes the socket with 1008.
//! - The pin is checked and set under the shared lock when a client authenticates (`authenticate`), so of two
//!   origins that both passed the handshake only the first to authenticate is kept.
//! - After the welcome the wall may send `{type:"studio", id, action, name?}` (action `scene`, `mute` or `camera`; a
//!   scene name of 1 to 80 characters with no control character; the other two take none) and the add-on answers
//!   `{type:"studio_result", id, ok, reason, why?, n?, state?}` (why: the step a miss failed at; n: a count; state: "on" or "off", the mic or camera after the press). One studio
//!   command is in flight at a time; a second is "busy". The answer is accepted only from the current authenticated
//!   client and only for the id that is waiting.
//! - Text frames only, 8 KiB per message and frame, at most 20 inbound frames a second (pings and pongs count), ping every 30 s,
//!   closed after 60 s of silence.
//! The token is never logged (this module logs nothing) and never leaves Rust except as the answer to
//! the one-time show (`token_action`). One client at a time: a newer authenticated client replaces the old.

use crate::wall2_meet::store::{BlobStore, CredBlobs, Fetch};
use base64::Engine;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use sha2::Sha256;
use std::time::{Duration, Instant};
use tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tungstenite::protocol::frame::coding::CloseCode;
use tungstenite::protocol::{CloseFrame, WebSocketConfig};
use tungstenite::Message;

// Section: limits

pub(crate) const PORT: u16 = 47231;
pub(crate) const MAX_MSG: usize = 8 * 1024;
pub(crate) const MAX_PER_SEC: u32 = 20;
const MAX_CONNS: usize = 8;
const HELLO_MS: u64 = 2000;
const PING_MS: u64 = 30_000;
const IDLE_MS: u64 = 60_000;
const POLL_MS: u64 = 200;
const RETRY_BIND: Duration = Duration::from_secs(5);
const ACCEPT_PAUSE: Duration = Duration::from_millis(50);
const WIRE_MAX: usize = 128;
const FEEDS_MAX: usize = 12;
const KEY_MAX: usize = 128;
const NAME_MAX: usize = 64;
const COORD_MAX: i32 = 100_000;
/// A scene name sent to the add-on: at most this many characters.
pub(crate) const SCENE_MAX: usize = 80;
const STUDIO_WAIT: Duration = Duration::from_secs(4);
pub(crate) const SETTINGS_FILE: &str = "onair-stagepop.json";

// Section: pure rules

/// The address the server may bind: IPv4 loopback only.
pub(crate) fn bind_ok(addr: &SocketAddr) -> bool {
    match addr.ip() {
        IpAddr::V4(ip) => ip.is_loopback(),
        IpAddr::V6(_) => false,
    }
}

/// An `Origin` header value that may connect: `moz-extension://<id>` with an id of letters, digits and
/// hyphens, and, when an origin is pinned, exactly that one.
pub(crate) fn origin_ok(origin: Option<&str>, pin: Option<&str>) -> bool {
    let Some(o) = origin else { return false };
    let Some(id) = o.strip_prefix("moz-extension://") else { return false };
    let shaped = !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    shaped && pin.map_or(true, |p| p == o)
}

/// Equal strings, with a time that does not depend on where they first differ (or on their lengths).
pub(crate) fn ct_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let mut diff = (a.len() ^ b.len()) as u32;
    for i in 0..a.len().max(b.len()) {
        diff |= (a.get(i).copied().unwrap_or(0) ^ b.get(i).copied().unwrap_or(0)) as u32;
    }
    diff == 0
}

/// At most `MAX_PER_SEC` messages in each fixed second; time is passed in so tests need no clock.
pub(crate) struct RateLimit {
    start_ms: u64,
    count: u32,
}

impl RateLimit {
    pub(crate) fn new() -> Self {
        RateLimit { start_ms: 0, count: 0 }
    }
    pub(crate) fn allow(&mut self, now_ms: u64) -> bool {
        if self.count == 0 || now_ms.saturating_sub(self.start_ms) >= 1000 {
            self.start_ms = now_ms;
            self.count = 0;
        }
        self.count += 1;
        self.count <= MAX_PER_SEC
    }
}

/// A feed key: "stage", or 1 to 128 characters of letters, digits, `{`, `}`, `_` and `-`.
pub(crate) fn valid_key(k: &str) -> bool {
    k == "stage" || (!k.is_empty() && k.len() <= KEY_MAX && k.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '{' | '}' | '_' | '-')))
}

/// A feed name: control characters removed, trimmed, then 1 to 64 characters.
pub(crate) fn clean_name(raw: &str) -> Option<String> {
    let s: String = raw.chars().filter(|c| !c.is_control()).collect();
    let s = s.trim().to_string();
    let n = s.chars().count();
    (1..=NAME_MAX).contains(&n).then_some(s)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Feed {
    pub key: String,
    pub name: String,
}

/// A message from the add-on, validated. Unknown types and anything malformed are None.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum In {
    Hello { v: u64, cnonce: String, mac: String },
    Feeds { list: Vec<Feed>, mode: String },
    Window { open: bool, fullscreen: bool },
    /// The add-on's answer to a studio command: the id it was sent with, ok or a reason word, and for a miss the
    /// step that failed (`why`) with a count (`n`) when the add-on sends them.
    Studio { id: u64, ok: bool, reason: String, why: Option<String>, n: Option<u64>, state: Option<String> },
}

/// A nonce or MAC as it travels: 1 to 128 base64 characters (either alphabet, padding allowed).
fn wire_ok(t: &str) -> bool {
    !t.is_empty() && t.len() <= WIRE_MAX && t.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '/' | '=' | '-' | '_'))
}

fn mac_b64(token: &str, message: &str) -> String {
    let Ok(mut m) = Hmac::<Sha256>::new_from_slice(token.as_bytes()) else { return String::new() };
    m.update(message.as_bytes());
    base64::engine::general_purpose::STANDARD.encode(m.finalize().into_bytes())
}

/// What the client must send as `mac`: HMAC-SHA256 keyed by the token over `stagepop-client|nonce|origin`.
pub(crate) fn client_mac(token: &str, nonce: &str, origin: &str) -> String {
    mac_b64(token, &format!("stagepop-client|{nonce}|{origin}"))
}

/// What the server answers in `welcome`: HMAC-SHA256 over `stagepop-server|cnonce|nonce`, so the add-on knows the
/// server holds the token before it sends anything.
pub(crate) fn server_mac(token: &str, cnonce: &str, nonce: &str) -> String {
    mac_b64(token, &format!("stagepop-server|{cnonce}|{nonce}"))
}

pub(crate) fn hello_ok(token: &str, nonce: &str, origin: &str, mac: &str) -> bool {
    ct_eq(&client_mac(token, nonce, origin), mac)
}

pub(crate) fn parse_in(text: &str) -> Option<In> {
    if text.len() > MAX_MSG {
        return None;
    }
    let v: Value = serde_json::from_str(text).ok()?;
    match v.get("type")?.as_str()? {
        "hello" => {
            let cnonce = v.get("cnonce")?.as_str()?;
            let mac = v.get("mac")?.as_str()?;
            if !wire_ok(cnonce) || !wire_ok(mac) {
                return None;
            }
            Some(In::Hello { v: v.get("v")?.as_u64()?, cnonce: cnonce.to_string(), mac: mac.to_string() })
        }
        "feeds" => {
            let arr = v.get("list")?.as_array()?;
            if arr.is_empty() || arr.len() > FEEDS_MAX {
                return None;
            }
            let mut list: Vec<Feed> = Vec::new();
            for item in arr {
                let key = item.get("key")?.as_str()?;
                if !valid_key(key) || list.iter().any(|f| f.key == key) {
                    return None;
                }
                list.push(Feed { key: key.to_string(), name: clean_name(item.get("name")?.as_str()?)? });
            }
            let mode = v.get("mode")?.as_str()?;
            if !list.iter().any(|f| f.key == mode) {
                return None;
            }
            Some(In::Feeds { list, mode: mode.to_string() })
        }
        "window" => Some(In::Window { open: v.get("open")?.as_bool()?, fullscreen: v.get("fullscreen")?.as_bool()? }),
        "studio_result" => {
            let reason = v.get("reason")?.as_str()?;
            if reason.len() > 40 {
                return None;
            }
            // why and n are optional extras: a missing or odd one is left out, never a reason to drop the answer.
            let why = v.get("why").and_then(Value::as_str).filter(|w| w.len() <= 40).map(str::to_string);
            let n = v.get("n").and_then(Value::as_u64);
            let state = v.get("state").and_then(Value::as_str).map(str::to_string);
            Some(In::Studio { id: v.get("id")?.as_u64()?, ok: v.get("ok")?.as_bool()?, reason: reason.to_string(), why, n, state })
        }
        _ => None,
    }
}

/// The three studio actions the wall may ask for.
pub(crate) fn studio_action_ok(action: &str) -> bool {
    matches!(action, "scene" | "mute" | "camera")
}

/// The studio command for the add-on, fixed shape `{type:"studio", id, action, name?}`. The action must be one
/// of `scene`, `mute`, `camera`. A scene needs a name of 1 to `SCENE_MAX` characters with no control character;
/// the other two take none. Nothing is cleaned: a name that is not acceptable as typed is refused.
pub(crate) fn studio_message(id: u64, action: &str, name: Option<&str>) -> Result<String, &'static str> {
    if !studio_action_ok(action) {
        return Err("invalid");
    }
    let v = if action == "scene" {
        let n = name.ok_or("invalid")?;
        let len = n.chars().count();
        if len == 0 || len > SCENE_MAX || n.chars().any(|c| c.is_control()) || n.trim().is_empty() {
            return Err("invalid");
        }
        json!({"type": "studio", "id": id, "action": action, "name": n})
    } else {
        if name.is_some() {
            return Err("invalid");
        }
        json!({"type": "studio", "id": id, "action": action})
    };
    Ok(v.to_string())
}

/// What a studio key learns: ok, or one reason word the key can show.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct StudioAnswer {
    pub ok: bool,
    /// "ok", "already" (ok, nothing to do), "not found", "studio not open", "not connected", "no answer", "busy",
    /// "refused" or "failed".
    pub reason: &'static str,
    /// For a miss, the step that failed, from a fixed list (see `why_of`); absent when the add-on gave none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub why: Option<&'static str>,
    /// A count that goes with `why` (tabs, scenes or buttons), 0 to 99.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub n: Option<u8>,
    /// For a mute or camera key that went through: the mic or camera after the press, "on" or "off" ("off" is muted
    /// or camera off). Absent from an older add-on.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<&'static str>,
}

impl StudioAnswer {
    pub(crate) fn plain(ok: bool, reason: &'static str) -> Self {
        StudioAnswer { ok, reason, why: None, n: None, state: None }
    }
}

/// The add-on's mic or camera state; only the exact words "on" and "off" pass.
pub(crate) fn state_of(state: &str) -> Option<&'static str> {
    match state {
        "on" => Some("on"),
        "off" => Some("off"),
        _ => None,
    }
}

/// The add-on's step words for a miss; anything else is left out.
pub(crate) fn why_of(why: &str) -> Option<&'static str> {
    const WHYS: [&str; 10] = ["tabs", "no scenes", "several", "not usable", "too many leaves", "no card", "no leaf match", "no button", "unreadable", "error"];
    WHYS.iter().copied().find(|w| *w == why)
}

/// Maps the add-on's reason word to a fixed one; anything unknown is "failed".
pub(crate) fn answer_of(ok: bool, reason: &str) -> StudioAnswer {
    if ok {
        return StudioAnswer::plain(true, if reason == "already" { "already" } else { "ok" });
    }
    let reason = match reason {
        "busy" => "busy",
        "not found" => "not found",
        "studio not open" => "studio not open",
        "refused" => "refused",
        _ => "failed",
    };
    StudioAnswer::plain(false, reason)
}

/// `answer_of` plus the step that failed and its count, kept only for a miss and only when the step word is known,
/// and the mic or camera state, kept only for a sent key and only when it is "on" or "off".
pub(crate) fn answer_with(ok: bool, reason: &str, why: Option<&str>, n: Option<u64>, state: Option<&str>) -> StudioAnswer {
    let mut a = answer_of(ok, reason);
    if a.ok {
        a.state = state.and_then(state_of);
    } else {
        a.why = why.and_then(why_of);
        a.n = if a.why.is_some() { n.filter(|n| *n <= 99).map(|n| n as u8) } else { None };
    }
    a
}

/// What the page asks the wall to send to the add-on.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum Cmd {
    Mode { key: String },
    Open,
    Close,
    Fullscreen { on: bool },
}

/// The message for the add-on, or an error word. `place` is the left and top for an open.
pub(crate) fn out_message(cmd: &Cmd, feeds: &[Feed], place: Option<(i32, i32)>) -> Result<String, &'static str> {
    let v = match cmd {
        Cmd::Mode { key } => {
            if !feeds.iter().any(|f| &f.key == key) {
                return Err("invalid");
            }
            json!({"type": "mode", "key": key})
        }
        Cmd::Open => match place {
            Some((left, top)) => json!({"type": "open", "left": left, "top": top}),
            None => json!({"type": "open"}),
        },
        Cmd::Close => json!({"type": "close"}),
        Cmd::Fullscreen { on } => json!({"type": "fullscreen", "on": on}),
    };
    Ok(v.to_string())
}

// Section: saved settings (placement, pinned origin, whether the token was shown)

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct Settings {
    #[serde(default)]
    pub left: Option<i32>,
    #[serde(default)]
    pub top: Option<i32>,
    #[serde(default)]
    pub origin: Option<String>,
    #[serde(default)]
    pub shown: bool,
}

/// Saved settings from file text; anything unreadable or out of range falls back field by field to unset.
pub(crate) fn parse_settings(text: &str) -> Settings {
    let mut s: Settings = serde_json::from_str(text).unwrap_or_default();
    let ok = |n: i32| (-COORD_MAX..=COORD_MAX).contains(&n);
    if s.left.is_some_and(|n| !ok(n)) || s.top.is_some_and(|n| !ok(n)) || s.left.is_some() != s.top.is_some() {
        s.left = None;
        s.top = None;
    }
    if s.origin.as_deref().is_some_and(|o| !origin_ok(Some(o), None)) {
        s.origin = None;
    }
    s
}

// Section: the token

pub(crate) trait Vault: Send + Sync {
    fn load(&self) -> Fetch<String>;
    fn save(&self, value: &str) -> bool;
}

pub(crate) struct CredVault;

fn token_target() -> String {
    crate::wall2_oauth::credential_target("stagepop", "token", 0)
}

impl Vault for CredVault {
    fn load(&self) -> Fetch<String> {
        match CredBlobs.read(&token_target()) {
            Fetch::Found(b) => String::from_utf8(b).map_or(Fetch::Failed, Fetch::Found),
            Fetch::Missing => Fetch::Missing,
            Fetch::Failed => Fetch::Failed,
        }
    }
    fn save(&self, value: &str) -> bool {
        CredBlobs.write(&token_target(), value.as_bytes())
    }
}

// Section: shared state

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct WindowView {
    pub open: bool,
    pub fullscreen: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PlacementView {
    pub left: Option<i32>,
    pub top: Option<i32>,
    /// "saved", "elgato" (the monitor that is exactly 1024 by 600) or "none".
    pub source: &'static str,
}

/// What the web view may learn. No token, no origin.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct StatusView {
    pub state: &'static str,
    pub feeds: Vec<Feed>,
    pub mode: Option<String>,
    pub window: WindowView,
    pub placement: PlacementView,
    /// "none" (no code made yet), "ready" (made, not yet shown) or "hidden" (shown once already).
    pub token: &'static str,
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Run {
    Off,
    PortBusy,
    Waiting,
    Connected,
}

struct Shared {
    run: Run,
    feeds: Vec<Feed>,
    mode: Option<String>,
    window: WindowView,
    generation: u64,
    tx: Option<Sender<String>>,
    settings: Settings,
    /// The studio command waiting for its answer: its id and where the answer goes.
    studio: Option<(u64, Sender<StudioAnswer>)>,
    studio_id: u64,
}

pub(crate) struct Core {
    shared: Mutex<Shared>,
    vault: Box<dyn Vault>,
    path: Mutex<Option<PathBuf>>,
    notifier: Mutex<Option<Box<dyn Fn() + Send>>>,
    conns: AtomicUsize,
}

impl Core {
    pub(crate) fn new(vault: Box<dyn Vault>, settings: Settings) -> Core {
        Core {
            shared: Mutex::new(Shared {
                run: Run::Off,
                feeds: Vec::new(),
                mode: None,
                window: WindowView { open: false, fullscreen: false },
                generation: 0,
                tx: None,
                settings,
                studio: None,
                studio_id: 0,
            }),
            vault,
            path: Mutex::new(None),
            notifier: Mutex::new(None),
            conns: AtomicUsize::new(0),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Shared> {
        self.shared.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub(crate) fn set_notifier(&self, f: Box<dyn Fn() + Send>) {
        *self.notifier.lock().unwrap_or_else(|e| e.into_inner()) = Some(f);
    }

    pub(crate) fn set_path(&self, p: Option<PathBuf>) {
        *self.path.lock().unwrap_or_else(|e| e.into_inner()) = p;
    }

    fn notify(&self) {
        if let Some(f) = self.notifier.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
            f();
        }
    }

    /// Writes the settings. False when the write failed; true when it worked or no file is configured.
    fn persist(&self, s: &Settings) -> bool {
        let path = self.path.lock().unwrap_or_else(|e| e.into_inner()).clone();
        match (path, serde_json::to_string_pretty(s)) {
            (Some(p), Ok(text)) => std::fs::write(p, text).is_ok(),
            (Some(_), Err(_)) => false,
            (None, _) => true,
        }
    }

    fn set_run(&self, run: Run) {
        self.lock().run = run;
        self.notify();
    }

    pub(crate) fn pin(&self) -> Option<String> {
        self.lock().settings.origin.clone()
    }

    pub(crate) fn generation(&self) -> u64 {
        self.lock().generation
    }

    fn token_state(s: &Shared, saved: bool) -> &'static str {
        match (saved, s.settings.shown) {
            (false, _) => "none",
            (true, true) => "hidden",
            (true, false) => "ready",
        }
    }

    /// `elgato` is the left and top of the 1024 by 600 monitor when one is attached.
    pub(crate) fn status(&self, elgato: Option<(i32, i32)>) -> StatusView {
        // Credential Manager is read before the shared lock is taken, never under it.
        let saved = matches!(self.vault.load(), Fetch::Found(_));
        let s = self.lock();
        let state = match s.run {
            Run::Off => "off",
            Run::PortBusy => "port busy",
            Run::Waiting => "waiting",
            Run::Connected => "connected",
        };
        let place = place_of(&s.settings, elgato);
        let placement = PlacementView { left: place.map(|p| p.0), top: place.map(|p| p.1), source: source_of(&s.settings, elgato) };
        StatusView { state, feeds: s.feeds.clone(), mode: s.mode.clone(), window: s.window.clone(), placement, token: Self::token_state(&s, saved) }
    }

    /// The saved pairing code, when there is a readable one, with the generation read just before it. The
    /// generation goes to `authenticate`, which refuses if a new code (or another client) moved it since.
    pub(crate) fn token_at(&self) -> Option<(String, u64)> {
        let generation = self.generation();
        match self.vault.load() {
            Fetch::Found(t) => Some((t, generation)),
            _ => None,
        }
    }

    /// The saved pairing code alone.
    pub(crate) fn token(&self) -> Option<String> {
        self.token_at().map(|t| t.0)
    }

    /// Takes the client in after a good hello. Under one lock: a generation that moved since the token was read (a new code) is refused, an origin that is not the pinned one is refused,
    /// otherwise it is pinned (when none is) and any older client is replaced.
    pub(crate) fn authenticate(&self, origin: &str, seen: u64) -> Result<(u64, Receiver<String>), &'static str> {
        let (tx, rx) = channel();
        let (generation, pinned) = {
            let mut s = self.lock();
            if s.generation != seen {
                return Err("changed");
            }
            let mut pinned = None;
            match s.settings.origin.as_deref() {
                Some(p) if p != origin => return Err("origin"),
                Some(_) => {}
                None => {
                    s.settings.origin = Some(origin.to_string());
                    pinned = Some(s.settings.clone());
                }
            }
            s.generation += 1;
            s.tx = Some(tx);
            s.studio = None;
            s.run = Run::Connected;
            s.feeds.clear();
            s.mode = None;
            s.window = WindowView { open: false, fullscreen: false };
            (s.generation, pinned)
        };
        if let Some(p) = pinned {
            // A failed write leaves the pin in memory for this run; the next change writes it again.
            let _ = self.persist(&p);
        }
        self.notify();
        Ok((generation, rx))
    }

    /// A connection ended. Only the current client's end changes the state.
    pub(crate) fn gone(&self, generation: u64) {
        {
            let mut s = self.lock();
            if s.generation != generation || s.run != Run::Connected {
                return;
            }
            s.run = Run::Waiting;
            s.tx = None;
            s.studio = None;
            s.feeds.clear();
            s.mode = None;
            s.window = WindowView { open: false, fullscreen: false };
        }
        self.notify();
    }

    /// A message from the current client after its hello. Anything but feeds and window is dropped.
    pub(crate) fn handle_text(&self, text: &str) {
        let changed = match parse_in(text) {
            Some(In::Feeds { list, mode }) => {
                let mut s = self.lock();
                let same = s.feeds == list && s.mode.as_deref() == Some(mode.as_str());
                s.feeds = list;
                s.mode = Some(mode);
                !same
            }
            Some(In::Window { open, fullscreen }) => {
                let mut s = self.lock();
                let next = WindowView { open, fullscreen: open && fullscreen };
                let same = s.window == next;
                s.window = next;
                !same
            }
            Some(In::Studio { id, ok, reason, why, n, state }) => {
                let mut s = self.lock();
                if s.studio.as_ref().is_some_and(|(want, _)| *want == id) {
                    if let Some((_, answer)) = s.studio.take() {
                        let _ = answer.send(answer_with(ok, &reason, why.as_deref(), n, state.as_deref()));
                    }
                }
                false
            }
            _ => false,
        };
        if changed {
            self.notify();
        }
    }

    /// Sends a command to the connected add-on. `elgato` is the default place for an open.
    pub(crate) fn send(&self, cmd: &Cmd, elgato: Option<(i32, i32)>) -> Result<(), &'static str> {
        let s = self.lock();
        let tx = s.tx.as_ref().ok_or("not connected")?;
        let text = out_message(cmd, &s.feeds, place_of(&s.settings, elgato))?;
        tx.send(text).map_err(|_| "not connected")
    }

    /// Sends one studio command and waits (at most 4 s) for the add-on's answer. Every outcome is an answer with a
    /// reason word, never an error: a bad command is "refused", no add-on is "not connected", silence is "no answer".
    /// One command is in flight at a time; a second one while it waits is answered "busy" at once.
    pub(crate) fn studio(&self, action: &str, name: Option<&str>) -> StudioAnswer {
        self.studio_wait(action, name, STUDIO_WAIT)
    }

    pub(crate) fn studio_wait(&self, action: &str, name: Option<&str>, wait: Duration) -> StudioAnswer {
        let fail = |reason: &'static str| StudioAnswer::plain(false, reason);
        let (answer_tx, answer_rx) = channel();
        let id = {
            let mut s = self.lock();
            let Some(tx) = s.tx.clone() else { return fail("not connected") };
            let id = s.studio_id + 1;
            let Ok(text) = studio_message(id, action, name) else { return fail("refused") };
            // One command at a time: a second one is refused at once and never replaces the waiting one.
            if s.studio.is_some() {
                return fail("busy");
            }
            s.studio_id = id;
            s.studio = Some((id, answer_tx));
            if tx.send(text).is_err() {
                s.studio = None;
                return fail("not connected");
            }
            id
        };
        match answer_rx.recv_timeout(wait) {
            Ok(a) => a,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                let mut s = self.lock();
                if s.studio.as_ref().is_some_and(|(want, _)| *want == id) {
                    s.studio = None;
                }
                fail("no answer")
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => fail(if self.lock().tx.is_some() { "no answer" } else { "not connected" }),
        }
    }

    pub(crate) fn placement_set(&self, left: i32, top: i32) -> Result<(), &'static str> {
        let ok = |n: i32| (-COORD_MAX..=COORD_MAX).contains(&n);
        if !ok(left) || !ok(top) {
            return Err("invalid");
        }
        let snapshot = {
            let mut s = self.lock();
            s.settings.left = Some(left);
            s.settings.top = Some(top);
            s.settings.clone()
        };
        self.persist(&snapshot);
        self.notify();
        Ok(())
    }

    /// "show": the code, once. A first show makes it. "new": a fresh code, shown now, and the add-on
    /// that held the old one is dropped. A code already shown cannot be shown again. The check, the save, the
    /// write of the shown flag and the change of state happen under one lock, so one caller gets the code; if
    /// the flag cannot be written nothing is handed out.
    pub(crate) fn token_action(&self, action: &str) -> Result<String, &'static str> {
        let renew = match action {
            "show" => false,
            "new" => true,
            _ => return Err("invalid"),
        };
        let token = {
            let mut s = self.lock();
            let existing = match self.vault.load() {
                Fetch::Found(t) => Some(t),
                Fetch::Missing => None,
                Fetch::Failed => return Err("failed"),
            };
            let token = match existing {
                Some(t) if !renew => {
                    if s.settings.shown {
                        return Err("hidden");
                    }
                    t
                }
                _ => {
                    let t = crate::wall2_oauth::random_b64(32).ok_or("failed")?;
                    if !self.vault.save(&t) {
                        return Err("failed");
                    }
                    // A new code has not been shown, whatever the last one was.
                    s.settings.shown = false;
                    t
                }
            };
            let mut next = s.settings.clone();
            next.shown = true;
            if !self.persist(&next) {
                return Err("failed");
            }
            s.settings = next;
            if renew {
                s.generation += 1;
                if s.run == Run::Connected {
                    s.run = Run::Waiting;
                }
                s.tx = None;
                s.studio = None;
                s.feeds.clear();
                s.mode = None;
                s.window = WindowView { open: false, fullscreen: false };
            }
            token
        };
        self.notify();
        Ok(token)
    }
}

fn place_of(s: &Settings, elgato: Option<(i32, i32)>) -> Option<(i32, i32)> {
    match (s.left, s.top) {
        (Some(l), Some(t)) => Some((l, t)),
        _ => elgato,
    }
}

fn source_of(s: &Settings, elgato: Option<(i32, i32)>) -> &'static str {
    if s.left.is_some() && s.top.is_some() {
        "saved"
    } else if elgato.is_some() {
        "elgato"
    } else {
        "none"
    }
}

// Section: the server

fn forbidden() -> ErrorResponse {
    tungstenite::http::Response::builder().status(403).body(Some("forbidden".to_string())).unwrap_or_default()
}

fn close(ws: &mut tungstenite::WebSocket<TcpStream>, code: CloseCode) {
    let _ = ws.close(Some(CloseFrame { code, reason: "".into() }));
    let _ = ws.flush();
}

fn is_timeout(e: &tungstenite::Error) -> bool {
    matches!(e, tungstenite::Error::Io(io) if matches!(io.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut))
}

/// Serves one connection until it ends.
pub(crate) fn serve(core: &Core, stream: TcpStream) {
    let _ = stream.set_nodelay(true);
    let _ = stream.set_read_timeout(Some(Duration::from_millis(HELLO_MS)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    let pin = core.pin();
    let mut origin: Option<String> = None;
    let config = WebSocketConfig::default().max_message_size(Some(MAX_MSG)).max_frame_size(Some(MAX_MSG));
    let accepted = tungstenite::accept_hdr_with_config(
        stream,
        |req: &Request, resp: Response| {
            let o = req.headers().get("origin").and_then(|v| v.to_str().ok());
            if origin_ok(o, pin.as_deref()) {
                origin = o.map(str::to_string);
                Ok(resp)
            } else {
                Err(forbidden())
            }
        },
        Some(config),
    );
    let Ok(mut ws) = accepted else { return };
    let Some(origin) = origin else { return };
    let _ = ws.get_ref().set_read_timeout(Some(Duration::from_millis(POLL_MS)));
    let begin = Instant::now();
    // The challenge starts the 2 s clock for the hello.
    let Some(nonce) = crate::wall2_oauth::random_b64(32) else { return };
    if ws.send(Message::text(json!({"type": "challenge", "nonce": nonce, "v": 2}).to_string())).is_err() {
        return;
    }
    let ms = |t: Instant| t.duration_since(begin).as_millis() as u64;
    let mut limiter = RateLimit::new();
    let mut last_rx = Instant::now();
    let mut last_ping = Instant::now();
    let mut session: Option<(u64, Receiver<String>)> = None;
    loop {
        if let Some((generation, rx)) = &session {
            if core.generation() != *generation {
                close(&mut ws, CloseCode::Normal);
                break;
            }
            let mut failed = false;
            for text in rx.try_iter() {
                if ws.send(Message::text(text)).is_err() {
                    failed = true;
                    break;
                }
            }
            if failed {
                break;
            }
            if last_ping.elapsed().as_millis() as u64 >= PING_MS {
                last_ping = Instant::now();
                if ws.send(Message::Ping(Vec::new().into())).is_err() {
                    break;
                }
            }
        } else if ms(Instant::now()) >= HELLO_MS {
            close(&mut ws, CloseCode::Policy);
            break;
        }
        if last_rx.elapsed().as_millis() as u64 >= IDLE_MS {
            close(&mut ws, CloseCode::Away);
            break;
        }
        match ws.read() {
            Ok(Message::Close(_)) => break,
            Ok(msg) => {
                last_rx = Instant::now();
                // Every inbound frame but Close counts, control frames too.
                if !limiter.allow(ms(last_rx)) {
                    close(&mut ws, CloseCode::Policy);
                    break;
                }
                match msg {
                    Message::Text(t) => {
                        if session.is_none() {
                            let welcome = match parse_in(t.as_str()) {
                                Some(In::Hello { v: 2, cnonce, mac }) => core.token_at().and_then(|(token, seen)| {
                                    if !hello_ok(&token, &nonce, &origin, &mac) {
                                        return None;
                                    }
                                    let started = core.authenticate(&origin, seen).ok()?;
                                    Some((started, server_mac(&token, &cnonce, &nonce)))
                                }),
                                _ => None,
                            };
                            let Some((started, answer)) = welcome else {
                                close(&mut ws, CloseCode::Policy);
                                break;
                            };
                            session = Some(started);
                            if ws.send(Message::text(json!({"type": "welcome", "mac": answer}).to_string())).is_err() {
                                break;
                            }
                        } else {
                            core.handle_text(t.as_str());
                        }
                    }
                    Message::Ping(_) | Message::Pong(_) => {
                        let _ = ws.flush();
                    }
                    _ => {
                        close(&mut ws, CloseCode::Unsupported);
                        break;
                    }
                }
            }
            Err(e) if is_timeout(&e) => {}
            Err(_) => break,
        }
    }
    if let Some((generation, _)) = session {
        core.gone(generation);
    }
}

/// Binds `addr` (refused unless loopback) and serves until the process ends. Marks the state.
pub(crate) fn run(core: Arc<Core>, addr: SocketAddr) {
    run_with(core, addr, RETRY_BIND);
}

/// `run` with the pause between bind tries given: a busy port is the state `port busy` and is tried again.
pub(crate) fn run_with(core: Arc<Core>, addr: SocketAddr, retry: Duration) {
    if !bind_ok(&addr) {
        core.set_run(Run::Off);
        return;
    }
    loop {
        match TcpListener::bind(addr) {
            Ok(listener) => return serve_on(core, listener),
            Err(_) => {
                core.set_run(Run::PortBusy);
                std::thread::sleep(retry);
            }
        }
    }
}

/// The accept loop over an already bound listener.
pub(crate) fn serve_on(core: Arc<Core>, listener: TcpListener) {
    core.set_run(Run::Waiting);
    accept_loop(core, listener.incoming(), ACCEPT_PAUSE);
}

/// Serves each accepted stream on its own thread. An accept error waits `pause` so a failing listener cannot spin.
pub(crate) fn accept_loop(core: Arc<Core>, incoming: impl Iterator<Item = std::io::Result<TcpStream>>, pause: Duration) {
    for stream in incoming {
        let Ok(stream) = stream else {
            std::thread::sleep(pause);
            continue;
        };
        let local = stream.peer_addr().map(|a| a.ip().is_loopback()).unwrap_or(false);
        if !local || core.conns.load(Ordering::SeqCst) >= MAX_CONNS {
            continue;
        }
        core.conns.fetch_add(1, Ordering::SeqCst);
        let c = Arc::clone(&core);
        let spawned = std::thread::Builder::new().name("stagepop-conn".into()).spawn(move || {
            serve(&c, stream);
            c.conns.fetch_sub(1, Ordering::SeqCst);
        });
        if spawned.is_err() {
            core.conns.fetch_sub(1, Ordering::SeqCst);
        }
    }
}

pub(crate) fn loopback() -> SocketAddr {
    SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), PORT)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ORIGIN: &str = "moz-extension://1a2b3c4d-0000-4111-8222-abcdefabcdef";

    struct FakeVault(Mutex<Option<String>>);
    impl Vault for FakeVault {
        fn load(&self) -> Fetch<String> {
            match self.0.lock().unwrap().clone() {
                Some(v) => Fetch::Found(v),
                None => Fetch::Missing,
            }
        }
        fn save(&self, value: &str) -> bool {
            *self.0.lock().unwrap() = Some(value.to_string());
            true
        }
    }

    fn core_with(token: Option<&str>) -> Core {
        Core::new(Box::new(FakeVault(Mutex::new(token.map(str::to_string)))), Settings::default())
    }

    fn feeds_text(list: &str, mode: &str) -> String {
        format!("{{\"type\":\"feeds\",\"list\":{list},\"mode\":\"{mode}\"}}")
    }

    #[test]
    fn only_ipv4_loopback_binds() {
        assert!(bind_ok(&"127.0.0.1:47231".parse().unwrap()));
        assert!(bind_ok(&"127.9.9.9:1".parse().unwrap()));
        assert!(!bind_ok(&"0.0.0.0:47231".parse().unwrap()));
        assert!(!bind_ok(&"192.168.1.5:47231".parse().unwrap()));
        assert!(!bind_ok(&"[::1]:47231".parse().unwrap()));
        assert_eq!(loopback().to_string(), "127.0.0.1:47231");
    }

    #[test]
    fn origin_rules() {
        assert!(origin_ok(Some(ORIGIN), None));
        assert!(origin_ok(Some(ORIGIN), Some(ORIGIN)));
        assert!(!origin_ok(Some(ORIGIN), Some("moz-extension://other")));
        assert!(!origin_ok(None, None));
        for bad in ["http://localhost", "https://example.com", "null", "", "moz-extension://", "moz-extension://a/b", "chrome-extension://abc", "moz-extension://a b"] {
            assert!(!origin_ok(Some(bad), None), "{bad}");
        }
    }

    #[test]
    fn constant_time_compare_agrees_with_equality() {
        assert!(ct_eq("abc", "abc"));
        assert!(ct_eq("", ""));
        assert!(!ct_eq("abc", "abd"));
        assert!(!ct_eq("abc", "abcd"));
        assert!(!ct_eq("abcd", "abc"));
        assert!(!ct_eq("", "a"));
    }

    #[test]
    fn rate_limit_allows_twenty_a_second() {
        let mut r = RateLimit::new();
        for _ in 0..20 {
            assert!(r.allow(5000));
        }
        assert!(!r.allow(5500));
        assert!(!r.allow(5999));
        // A new second starts at 1000 ms after the first message of the last one.
        assert!(r.allow(6000));
    }

    #[test]
    fn keys_and_names() {
        assert!(valid_key("stage"));
        assert!(valid_key("{0a1b-2c}_x"));
        assert!(valid_key(&"a".repeat(128)));
        assert!(!valid_key(&"a".repeat(129)));
        for bad in ["", "a b", "a/b", "caf\u{e9}", "a.b"] {
            assert!(!valid_key(bad), "{bad:?}");
        }
        assert_eq!(clean_name("  Maya\u{7}\n ").as_deref(), Some("Maya"));
        assert_eq!(clean_name("\u{7}\t"), None);
        assert_eq!(clean_name(&"n".repeat(64)).map(|s| s.len()), Some(64));
        assert_eq!(clean_name(&"n".repeat(65)), None);
    }

    #[test]
    fn hello_and_window_parse() {
        assert_eq!(parse_in("{\"type\":\"hello\",\"v\":2,\"cnonce\":\"abc\",\"mac\":\"d+e=\"}"), Some(In::Hello { v: 2, cnonce: "abc".into(), mac: "d+e=".into() }));
        // A v1 hello (the raw token), a missing mac, a mac with odd characters and one that is too long are all dropped.
        assert_eq!(parse_in("{\"type\":\"hello\",\"token\":\"t\",\"v\":1}"), None);
        assert_eq!(parse_in("{\"type\":\"hello\",\"v\":2,\"cnonce\":\"abc\"}"), None);
        assert_eq!(parse_in("{\"type\":\"hello\",\"v\":2,\"cnonce\":\"abc\",\"mac\":\"a b\"}"), None);
        let long = "a".repeat(WIRE_MAX + 1);
        assert_eq!(parse_in(&format!("{{\"type\":\"hello\",\"v\":2,\"cnonce\":\"abc\",\"mac\":\"{long}\"}}")), None);
        assert_eq!(parse_in("{\"type\":\"window\",\"open\":true,\"fullscreen\":false}"), Some(In::Window { open: true, fullscreen: false }));
        assert_eq!(parse_in("{\"type\":\"window\",\"open\":true}"), None);
        assert_eq!(parse_in("{\"type\":\"nope\"}"), None);
        assert_eq!(parse_in("not json"), None);
        assert_eq!(parse_in("[]"), None);
    }

    #[test]
    fn feeds_parse_and_refusals() {
        let ok = feeds_text("[{\"key\":\"stage\",\"name\":\"Stage\"},{\"key\":\"{a-1}\",\"name\":\"Maya\"}]", "{a-1}");
        let Some(In::Feeds { list, mode }) = parse_in(&ok) else { panic!("feeds should parse") };
        assert_eq!(list.len(), 2);
        assert_eq!(mode, "{a-1}");
        // A mode that is not in the list.
        assert_eq!(parse_in(&feeds_text("[{\"key\":\"stage\",\"name\":\"Stage\"}]", "other")), None);
        // An empty list, a bad key, a bad name, a duplicate key.
        assert_eq!(parse_in(&feeds_text("[]", "stage")), None);
        assert_eq!(parse_in(&feeds_text("[{\"key\":\"a b\",\"name\":\"X\"}]", "a b")), None);
        assert_eq!(parse_in(&feeds_text("[{\"key\":\"stage\",\"name\":\"\"}]", "stage")), None);
        assert_eq!(parse_in(&feeds_text("[{\"key\":\"stage\",\"name\":\"A\"},{\"key\":\"stage\",\"name\":\"B\"}]", "stage")), None);
        // Thirteen entries is one too many; twelve is fine.
        let many = |n: usize| format!("[{}]", (0..n).map(|i| format!("{{\"key\":\"k{i}\",\"name\":\"N\"}}")).collect::<Vec<_>>().join(","));
        assert_eq!(parse_in(&feeds_text(&many(13), "k0")), None);
        assert!(parse_in(&feeds_text(&many(12), "k0")).is_some());
    }

    #[test]
    fn an_oversize_message_is_dropped() {
        let big = format!("{{\"type\":\"window\",\"open\":true,\"fullscreen\":false,\"pad\":\"{}\"}}", "x".repeat(MAX_MSG));
        assert!(big.len() > MAX_MSG);
        assert_eq!(parse_in(&big), None);
    }

    #[test]
    fn out_messages_are_checked_against_the_feed_list() {
        let feeds = vec![Feed { key: "stage".into(), name: "Stage".into() }];
        let mode = |k: &str| out_message(&Cmd::Mode { key: k.into() }, &feeds, None);
        assert_eq!(mode("stage").unwrap(), "{\"type\":\"mode\",\"key\":\"stage\"}");
        assert_eq!(mode("nope"), Err("invalid"));
        assert_eq!(out_message(&Cmd::Open, &feeds, Some((10, -20))).unwrap(), "{\"type\":\"open\",\"left\":10,\"top\":-20}");
        assert_eq!(out_message(&Cmd::Open, &feeds, None).unwrap(), "{\"type\":\"open\"}");
        assert_eq!(out_message(&Cmd::Close, &feeds, None).unwrap(), "{\"type\":\"close\"}");
        assert_eq!(out_message(&Cmd::Fullscreen { on: true }, &feeds, None).unwrap(), "{\"type\":\"fullscreen\",\"on\":true}");
    }

    #[test]
    fn commands_reject_unknown_fields_and_types() {
        assert!(serde_json::from_str::<Cmd>("{\"type\":\"open\"}").is_ok());
        assert!(serde_json::from_str::<Cmd>("{\"type\":\"mode\",\"key\":\"stage\"}").is_ok());
        assert!(serde_json::from_str::<Cmd>("{\"type\":\"mode\",\"key\":\"a\",\"left\":1}").is_err());
        assert!(serde_json::from_str::<Cmd>("{\"type\":\"reboot\"}").is_err());
    }

    #[test]
    fn studio_commands_are_checked() {
        let m = studio_message(7, "scene", Some("Presenter View")).unwrap();
        let v: Value = serde_json::from_str(&m).unwrap();
        assert_eq!(v, json!({"type": "studio", "id": 7, "action": "scene", "name": "Presenter View"}));
        assert_eq!(serde_json::from_str::<Value>(&studio_message(8, "mute", None).unwrap()).unwrap(), json!({"type": "studio", "id": 8, "action": "mute"}));
        assert!(studio_message(9, "camera", None).is_ok());
        for bad in ["", "Scene", "golive", "scene ", "mute;camera"] {
            assert_eq!(studio_message(1, bad, None), Err("invalid"), "{bad}");
        }
        assert_eq!(studio_message(1, "scene", None), Err("invalid"));
        assert_eq!(studio_message(1, "scene", Some("")), Err("invalid"));
        assert_eq!(studio_message(1, "scene", Some("   ")), Err("invalid"));
        assert_eq!(studio_message(1, "mute", Some("Speaker")), Err("invalid"));
        let long = "a".repeat(SCENE_MAX + 1);
        assert_eq!(studio_message(1, "scene", Some(&long)), Err("invalid"));
        assert!(studio_message(1, "scene", Some(&"a".repeat(SCENE_MAX))).is_ok());
        for ctl in ["a\nb", "a\u{0}b", "a\u{7f}b", "a\tb", "a\u{85}b"] {
            assert_eq!(studio_message(1, "scene", Some(ctl)), Err("invalid"), "{ctl:?}");
        }
    }

    #[test]
    fn studio_answers_map_to_fixed_reasons() {
        assert_eq!(answer_of(true, "whatever"), StudioAnswer::plain(true, "ok"));
        assert_eq!(answer_of(false, "not found").reason, "not found");
        assert_eq!(answer_of(false, "studio not open").reason, "studio not open");
        assert_eq!(answer_of(false, "refused").reason, "refused");
        assert_eq!(answer_of(false, "<script>").reason, "failed");
        assert_eq!(answer_of(true, "already"), StudioAnswer::plain(true, "already"));
        assert_eq!(answer_of(false, "busy").reason, "busy");
        assert!(!answer_of(false, "not found").ok);
        assert_eq!(parse_in(r#"{"type":"studio_result","id":3,"ok":false,"reason":"not found"}"#), Some(In::Studio { id: 3, ok: false, reason: "not found".into(), why: None, n: None, state: None }));
        assert_eq!(
            parse_in(r#"{"type":"studio_result","id":3,"ok":false,"reason":"not found","why":"no leaf match","n":4}"#),
            Some(In::Studio { id: 3, ok: false, reason: "not found".into(), why: Some("no leaf match".into()), n: Some(4), state: None })
        );
        // An odd why or n never drops the answer.
        assert_eq!(
            parse_in(r#"{"type":"studio_result","id":3,"ok":false,"reason":"not found","why":7,"n":"x"}"#),
            Some(In::Studio { id: 3, ok: false, reason: "not found".into(), why: None, n: None, state: None })
        );
        // A state passes only as the exact word "on" or "off"; a missing or odd one is left out, never a reason to drop the answer.
        assert_eq!(
            parse_in(r#"{"type":"studio_result","id":3,"ok":true,"reason":"ok","state":"off"}"#),
            Some(In::Studio { id: 3, ok: true, reason: "ok".into(), why: None, n: None, state: Some("off".into()) })
        );
        assert_eq!(answer_with(true, "ok", None, None, Some("off")).state, Some("off"));
        assert_eq!(answer_with(true, "ok", None, None, Some("on")).state, Some("on"));
        assert_eq!(answer_with(true, "ok", None, None, Some("ON")).state, None);
        assert_eq!(answer_with(true, "ok", None, None, Some("<b>")).state, None);
        assert_eq!(answer_with(true, "ok", None, None, None), StudioAnswer::plain(true, "ok"));
        assert_eq!(answer_with(true, "already", None, None, None), StudioAnswer::plain(true, "already"));
        assert_eq!(answer_with(false, "not found", None, None, Some("off")).state, None);
        assert_eq!(
            parse_in(r#"{"type":"studio_result","id":3,"ok":true,"reason":"ok","state":7}"#),
            Some(In::Studio { id: 3, ok: true, reason: "ok".into(), why: None, n: None, state: None })
        );
        let json = serde_json::to_string(&answer_with(true, "ok", None, None, Some("off"))).unwrap();
        assert!(json.contains(r#""state":"off""#));
        let json = serde_json::to_string(&StudioAnswer::plain(true, "ok")).unwrap();
        assert!(!json.contains("state"));
        assert_eq!(parse_in(r#"{"type":"studio_result","id":3,"ok":true}"#), None);
        assert_eq!(parse_in(&format!(r#"{{"type":"studio_result","id":3,"ok":false,"reason":"{}"}}"#, "x".repeat(41))), None);
    }

    #[test]
    fn a_miss_keeps_a_known_step_and_its_count() {
        assert_eq!(answer_with(false, "not found", Some("tabs"), Some(2), None), StudioAnswer { ok: false, reason: "not found", why: Some("tabs"), n: Some(2), state: None });
        assert_eq!(answer_with(false, "not found", Some("no scenes"), None, None), StudioAnswer { ok: false, reason: "not found", why: Some("no scenes"), n: None, state: None });
        assert_eq!(answer_with(false, "not found", Some("<b>"), Some(2), None), StudioAnswer::plain(false, "not found"));
        assert_eq!(answer_with(false, "not found", Some("several"), Some(100), None), StudioAnswer { ok: false, reason: "not found", why: Some("several"), n: None, state: None });
        assert_eq!(answer_with(true, "ok", Some("several"), Some(2), None), StudioAnswer::plain(true, "ok"));
        let json = serde_json::to_string(&StudioAnswer::plain(false, "busy")).unwrap();
        assert_eq!(json, r#"{"ok":false,"reason":"busy"}"#);
        let json = serde_json::to_string(&answer_with(false, "not found", Some("several"), Some(2), None)).unwrap();
        assert_eq!(json, r#"{"ok":false,"reason":"not found","why":"several","n":2}"#);
    }

    #[test]
    fn a_studio_command_waits_for_its_answer() {
        let core = Arc::new(core_with(Some("tok")));
        // Not connected.
        assert_eq!(core.studio_wait("mute", None, Duration::from_millis(10)), StudioAnswer::plain(false, "not connected"));
        let (_, rx) = core.authenticate(ORIGIN, 0).unwrap();
        // A bad command is refused before anything is sent.
        assert_eq!(core.studio_wait("golive", None, Duration::from_millis(10)).reason, "refused");
        assert!(rx.try_recv().is_err());
        // Silence is "no answer".
        assert_eq!(core.studio_wait("camera", None, Duration::from_millis(10)).reason, "no answer");
        let _ = rx.try_recv();
        // An answer with the right id arrives; a wrong id is ignored.
        let c = Arc::clone(&core);
        let t = std::thread::spawn(move || c.studio_wait("scene", Some("Speaker"), Duration::from_secs(3)));
        let sent: Value = serde_json::from_str(&rx.recv_timeout(Duration::from_secs(3)).unwrap()).unwrap();
        assert_eq!(sent["action"], "scene");
        let id = sent["id"].as_u64().unwrap();
        core.handle_text(&format!(r#"{{"type":"studio_result","id":{},"ok":true,"reason":"ok"}}"#, id + 5));
        core.handle_text(&format!(r#"{{"type":"studio_result","id":{id},"ok":false,"reason":"not found","why":"no leaf match","n":4}}"#));
        assert_eq!(t.join().unwrap(), StudioAnswer { ok: false, reason: "not found", why: Some("no leaf match"), n: Some(4), state: None });
    }

    #[test]
    fn a_second_studio_command_while_one_waits_is_busy_and_keeps_the_first() {
        let core = Arc::new(core_with(Some("tok")));
        let (_, rx) = core.authenticate(ORIGIN, 0).unwrap();
        let c = Arc::clone(&core);
        let t = std::thread::spawn(move || c.studio_wait("mute", None, Duration::from_secs(3)));
        let sent: Value = serde_json::from_str(&rx.recv_timeout(Duration::from_secs(3)).unwrap()).unwrap();
        let id = sent["id"].as_u64().unwrap();
        assert_eq!(core.studio_wait("camera", None, Duration::from_millis(10)), StudioAnswer::plain(false, "busy"));
        assert!(rx.try_recv().is_err());
        core.handle_text(&format!(r#"{{"type":"studio_result","id":{id},"ok":true,"reason":"already"}}"#));
        assert_eq!(t.join().unwrap(), StudioAnswer::plain(true, "already"));
    }

    #[test]
    fn settings_parse_falls_back() {
        let s = parse_settings(&format!("{{\"left\":-1024,\"top\":0,\"origin\":\"{ORIGIN}\",\"shown\":true}}"));
        assert_eq!((s.left, s.top, s.shown), (Some(-1024), Some(0), true));
        assert_eq!(s.origin.as_deref(), Some(ORIGIN));
        assert_eq!(parse_settings("garbage"), Settings::default());
        // One coordinate alone, or one out of range, drops both; a bad origin drops only the origin.
        let half = parse_settings("{\"left\":5}");
        assert_eq!((half.left, half.top), (None, None));
        let far = parse_settings("{\"left\":999999,\"top\":0}");
        assert_eq!((far.left, far.top), (None, None));
        let bad = parse_settings("{\"left\":1,\"top\":2,\"origin\":\"https://x\"}");
        assert_eq!((bad.left, bad.top, bad.origin), (Some(1), Some(2), None));
    }

    #[test]
    fn status_and_placement_sources() {
        let c = core_with(None);
        let v = c.status(None);
        assert_eq!((v.state, v.token, v.placement.source), ("off", "none", "none"));
        assert_eq!(c.status(Some((3840, 100))).placement.source, "elgato");
        assert_eq!(c.placement_set(7, 9), Ok(()));
        let v = c.status(Some((3840, 100)));
        assert_eq!((v.placement.source, v.placement.left, v.placement.top), ("saved", Some(7), Some(9)));
        assert_eq!(c.placement_set(COORD_MAX + 1, 0), Err("invalid"));
        assert_eq!(c.status(None).placement.left, Some(7));
    }

    #[test]
    fn the_token_shows_once_and_new_replaces_it() {
        let c = core_with(None);
        let first = c.token_action("show").unwrap();
        assert!(!first.is_empty());
        assert_eq!(c.token_action("show"), Err("hidden"));
        assert_eq!(c.status(None).token, "hidden");
        assert_eq!(c.token().as_deref(), Some(first.as_str()));
        let second = c.token_action("new").unwrap();
        assert_ne!(first, second);
        assert_eq!(c.token().as_deref(), Some(second.as_str()));
        assert_eq!(c.token_action("peek"), Err("invalid"));
        // The status never carries the code.
        let shown = format!("{:?}", c.status(None));
        assert!(!shown.contains(&second));
    }

    #[test]
    fn an_existing_unshown_token_shows_once() {
        let c = core_with(Some("saved-code"));
        assert_eq!(c.status(None).token, "ready");
        assert_eq!(c.token_action("show").as_deref(), Ok("saved-code"));
        assert_eq!(c.token_action("show"), Err("hidden"));
    }

    #[test]
    fn a_newer_client_replaces_the_older_and_the_first_origin_is_pinned() {
        let c = core_with(Some("t"));
        let (g1, _rx1) = c.authenticate(ORIGIN, c.generation()).unwrap();
        assert_eq!(c.pin().as_deref(), Some(ORIGIN));
        assert_eq!(c.status(None).state, "connected");
        let (g2, rx2) = c.authenticate(ORIGIN, c.generation()).unwrap();
        assert!(g2 > g1);
        assert_eq!(c.generation(), g2);
        // The old client's end changes nothing; the current one's end goes back to waiting.
        c.gone(g1);
        assert_eq!(c.status(None).state, "connected");
        assert_eq!(c.send(&Cmd::Close, None), Ok(()));
        assert_eq!(rx2.try_recv().unwrap(), "{\"type\":\"close\"}");
        c.gone(g2);
        assert_eq!(c.status(None).state, "waiting");
        assert_eq!(c.send(&Cmd::Close, None), Err("not connected"));
    }

    #[test]
    fn feeds_and_window_reach_the_status_and_a_new_code_drops_the_client() {
        let c = core_with(Some("t"));
        let (_g, _rx) = c.authenticate(ORIGIN, c.generation()).unwrap();
        c.handle_text(&feeds_text("[{\"key\":\"stage\",\"name\":\"Stage\"},{\"key\":\"k1\",\"name\":\"Maya\"}]", "k1"));
        c.handle_text("{\"type\":\"window\",\"open\":true,\"fullscreen\":true}");
        let v = c.status(None);
        assert_eq!(v.feeds.len(), 2);
        assert_eq!(v.mode.as_deref(), Some("k1"));
        assert_eq!(v.window, WindowView { open: true, fullscreen: true });
        // Mode must be in the list; a closed window is never full screen.
        assert_eq!(c.send(&Cmd::Mode { key: "zzz".into() }, None), Err("invalid"));
        c.handle_text("{\"type\":\"window\",\"open\":false,\"fullscreen\":true}");
        assert_eq!(c.status(None).window, WindowView { open: false, fullscreen: false });
        c.token_action("new").unwrap();
        let v = c.status(None);
        assert_eq!((v.state, v.feeds.len()), ("waiting", 0));
    }

    const ORIGIN_B: &str = "moz-extension://99999999-0000-4111-8222-000000000000";
    const TOKEN: &str = "pairing-token-for-tests";
    const NONCE: &str = "AAECAwQFBgcICQoLDA0ODw";
    const CNONCE: &str = "EBESExQVFhcYGRobHB0eHw";

    #[test]
    fn the_macs_match_a_fixed_vector_and_refuse_a_wrong_origin_nonce_or_token() {
        // Computed outside this code with HMAC-SHA256 over the strings in the plan, base64 with padding.
        let client = "y+pbeX6jmmiTOBNe1dE9iTpvyDmS5J4hQvQNWfYOmz8=";
        let server = "l5OOm0+vAr5y2yS2Pvl2QYGC9hQA7yIDsH0pYzdXB1w=";
        assert_eq!(client_mac(TOKEN, NONCE, ORIGIN), client);
        assert_eq!(server_mac(TOKEN, CNONCE, NONCE), server);
        assert!(hello_ok(TOKEN, NONCE, ORIGIN, client));
        // Another origin, another nonce (a replay of an earlier hello), another token, an empty mac.
        assert!(!hello_ok(TOKEN, NONCE, "moz-extension://other", client));
        assert!(!hello_ok(TOKEN, "AAECAwQFBgcICQoLDA0ODx", ORIGIN, client));
        assert!(!hello_ok("another-token", NONCE, ORIGIN, client));
        assert!(!hello_ok(TOKEN, NONCE, ORIGIN, ""));
        // The two directions never produce the same MAC from the same inputs.
        assert_ne!(client_mac(TOKEN, NONCE, ORIGIN), server_mac(TOKEN, NONCE, ORIGIN));
    }

    #[test]
    fn only_the_pinned_origin_authenticates_and_the_first_one_wins() {
        let c = core_with(Some(TOKEN));
        assert!(c.authenticate(ORIGIN, c.generation()).is_ok());
        assert_eq!(c.authenticate(ORIGIN_B, c.generation()).err(), Some("origin"));
        assert_eq!(c.pin().as_deref(), Some(ORIGIN));
        // The refused origin changed nothing: the first client is still the current one.
        assert_eq!(c.status(None).state, "connected");
        assert_eq!(c.generation(), 1);
        assert!(c.authenticate(ORIGIN, c.generation()).is_ok());
    }

    #[test]
    fn a_new_code_between_the_mac_check_and_authenticate_is_refused() {
        let c = core_with(Some(TOKEN));
        let (token, seen) = c.token_at().unwrap();
        assert_eq!(token, TOKEN);
        // The mac check passes, then a new code lands before authenticate runs.
        c.token_action("new").unwrap();
        assert_eq!(c.authenticate(ORIGIN, seen).err(), Some("changed"));
        assert_ne!(c.status(None).state, "connected");
        // A client that reads the new code and generation gets in.
        let (_, fresh) = c.token_at().unwrap();
        assert!(c.authenticate(ORIGIN, fresh).is_ok());
    }

    #[test]
    fn show_is_one_time_under_two_callers_on_one_instance() {
        for _ in 0..20 {
            let c = Arc::new(core_with(None));
            let gate = Arc::new(std::sync::Barrier::new(2));
            let hands: Vec<_> = (0..2)
                .map(|_| {
                    let (c, gate) = (Arc::clone(&c), Arc::clone(&gate));
                    std::thread::spawn(move || {
                        gate.wait();
                        c.token_action("show")
                    })
                })
                .collect();
            let answers: Vec<_> = hands.into_iter().map(|h| h.join().unwrap()).collect();
            assert_eq!(answers.iter().filter(|a| a.is_ok()).count(), 1);
            assert_eq!(answers.iter().filter(|a| **a == Err("hidden")).count(), 1);
        }
    }

    #[test]
    fn a_failed_write_of_the_settings_hands_out_nothing_and_a_retry_works() {
        let c = core_with(None);
        let missing = std::env::temp_dir().join(format!("stagepop-no-such-dir-{}", std::process::id())).join(SETTINGS_FILE);
        c.set_path(Some(missing));
        assert_eq!(c.token_action("show"), Err("failed"));
        // The code was made and kept, but not shown: it can still be shown once the write works.
        assert_eq!(c.status(None).token, "ready");
        let dir = std::env::temp_dir();
        let file = dir.join(format!("stagepop-settings-{}.json", std::process::id()));
        c.set_path(Some(file.clone()));
        let shown = c.token_action("show").unwrap();
        assert_eq!(c.token().as_deref(), Some(shown.as_str()));
        assert_eq!(c.token_action("show"), Err("hidden"));
        assert!(std::fs::read_to_string(&file).unwrap().contains("\"shown\": true"));
        let _ = std::fs::remove_file(&file);
        // New code with a failing write: nothing handed out, and the new code is not marked shown.
        c.set_path(Some(std::env::temp_dir().join("stagepop-no-such-dir-2").join(SETTINGS_FILE)));
        assert_eq!(c.token_action("new"), Err("failed"));
        assert_eq!(c.status(None).token, "ready");
    }

    struct ProbeVault {
        core: Mutex<Option<Arc<Core>>>,
        held: Mutex<Vec<bool>>,
    }
    impl Vault for Arc<ProbeVault> {
        fn load(&self) -> Fetch<String> {
            if let Some(core) = self.core.lock().unwrap().as_ref() {
                self.held.lock().unwrap().push(core.shared.try_lock().is_err());
            }
            Fetch::Found("t".to_string())
        }
        fn save(&self, _value: &str) -> bool {
            true
        }
    }

    #[test]
    fn status_reads_the_vault_outside_the_shared_lock() {
        let probe = Arc::new(ProbeVault { core: Mutex::new(None), held: Mutex::new(Vec::new()) });
        let core = Arc::new(Core::new(Box::new(Arc::clone(&probe)), Settings::default()));
        *probe.core.lock().unwrap() = Some(Arc::clone(&core));
        assert_eq!(core.status(None).token, "ready");
        let seen = probe.held.lock().unwrap().clone();
        assert_eq!(seen, vec![false]);
        *probe.core.lock().unwrap() = None;
    }

    #[test]
    fn an_accept_error_waits_before_the_next_try() {
        let core = Arc::new(core_with(None));
        let errors = std::iter::repeat_with(|| Err(std::io::Error::other("accept failed"))).take(3);
        let started = Instant::now();
        accept_loop(core, errors, Duration::from_millis(30));
        // Three errors, 30 ms each.
        assert!(started.elapsed() >= Duration::from_millis(90));
    }

    #[test]
    fn a_busy_port_is_tried_again_until_it_frees() {
        let holder = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = holder.local_addr().unwrap();
        let core = Arc::new(core_with(None));
        let c2 = Arc::clone(&core);
        std::thread::spawn(move || run_with(c2, addr, Duration::from_millis(30)));
        let until = |want: &str| {
            let waited = Instant::now();
            while core.status(None).state != want && waited.elapsed() < Duration::from_secs(5) {
                std::thread::sleep(Duration::from_millis(10));
            }
            core.status(None).state == want
        };
        assert!(until("port busy"));
        drop(holder);
        assert!(until("waiting"));
    }

    type Client = tungstenite::WebSocket<TcpStream>;

    fn serve_local(core: &Arc<Core>) -> SocketAddr {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let c2 = Arc::clone(core);
        std::thread::spawn(move || serve_on(c2, listener));
        addr
    }

    fn connect(addr: SocketAddr, origin: Option<&str>) -> Result<Client, ()> {
        let mut req = tungstenite::http::Request::builder().uri(format!("ws://{addr}/")).header("Host", addr.to_string()).header("Connection", "Upgrade").header("Upgrade", "websocket").header("Sec-WebSocket-Version", "13").header("Sec-WebSocket-Key", tungstenite::handshake::client::generate_key());
        if let Some(o) = origin {
            req = req.header("Origin", o);
        }
        let stream = TcpStream::connect(addr).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        tungstenite::client(req.body(()).unwrap(), stream).map(|(ws, _)| ws).map_err(|_| ())
    }

    /// The text of the next frame, parsed.
    fn next_json(ws: &mut Client) -> Value {
        loop {
            match ws.read().unwrap() {
                Message::Text(t) => return serde_json::from_str(t.as_str()).unwrap(),
                Message::Ping(_) | Message::Pong(_) => {}
                other => panic!("unexpected frame {other:?}"),
            }
        }
    }

    fn hello_text(token: &str, nonce: &str, origin: &str) -> String {
        json!({"type": "hello", "v": 2, "cnonce": CNONCE, "mac": client_mac(token, nonce, origin)}).to_string()
    }

    /// The connection ends within a few reads.
    fn ends(ws: &mut Client) -> bool {
        for _ in 0..50 {
            match ws.read() {
                Ok(Message::Close(_)) | Err(_) => return true,
                Ok(_) => {}
            }
        }
        false
    }

    fn wait_for(core: &Core, state: &str) -> bool {
        let waited = Instant::now();
        while core.status(None).state != state && waited.elapsed() < Duration::from_secs(3) {
            std::thread::sleep(Duration::from_millis(20));
        }
        core.status(None).state == state
    }

    /// Connects, reads the challenge and answers it with the right MAC; the welcome is checked.
    fn authed(addr: SocketAddr, origin: &str) -> Client {
        let mut ws = connect(addr, Some(origin)).unwrap();
        let ch = next_json(&mut ws);
        assert_eq!((ch["type"].as_str(), ch["v"].as_u64()), (Some("challenge"), Some(2)));
        let nonce = ch["nonce"].as_str().unwrap().to_string();
        ws.send(Message::text(hello_text(TOKEN, &nonce, origin))).unwrap();
        let welcome = next_json(&mut ws);
        assert_eq!(welcome["type"], "welcome");
        assert_eq!(welcome["mac"].as_str().unwrap(), server_mac(TOKEN, CNONCE, &nonce));
        ws
    }

    #[test]
    fn a_real_handshake_over_loopback() {
        let core = Arc::new(core_with(Some(TOKEN)));
        let addr = serve_local(&core);
        // Web page origins and a missing origin are refused at the handshake.
        assert!(connect(addr, Some("https://example.com")).is_err());
        assert!(connect(addr, None).is_err());
        // The old raw-token hello is refused.
        let mut v1 = connect(addr, Some(ORIGIN)).unwrap();
        next_json(&mut v1);
        v1.send(Message::text(json!({"type": "hello", "v": 1, "token": TOKEN}).to_string())).unwrap();
        assert!(ends(&mut v1));
        // A MAC made for another origin is refused.
        let mut wrong = connect(addr, Some(ORIGIN)).unwrap();
        let nonce = next_json(&mut wrong)["nonce"].as_str().unwrap().to_string();
        wrong.send(Message::text(hello_text(TOKEN, &nonce, ORIGIN_B))).unwrap();
        assert!(ends(&mut wrong));
        assert_eq!(core.status(None).state, "waiting");
        // A good hello connects, the welcome proves the server, and a command from the wall arrives.
        let mut ok = authed(addr, ORIGIN);
        assert!(wait_for(&core, "connected"));
        assert_eq!(core.send(&Cmd::Close, None), Ok(()));
        assert_eq!(next_json(&mut ok)["type"], "close");
        // The pinned origin refuses another at the handshake.
        assert!(connect(addr, Some(ORIGIN_B)).is_err());
    }

    #[test]
    fn a_hello_replayed_on_a_new_connection_is_refused() {
        let core = Arc::new(core_with(Some(TOKEN)));
        let addr = serve_local(&core);
        let mut first = connect(addr, Some(ORIGIN)).unwrap();
        let n1 = next_json(&mut first)["nonce"].as_str().unwrap().to_string();
        let captured = hello_text(TOKEN, &n1, ORIGIN);
        first.send(Message::text(captured.clone())).unwrap();
        assert_eq!(next_json(&mut first)["type"], "welcome");
        // A second connection gets its own nonce, so the captured hello does not fit it.
        let mut second = connect(addr, Some(ORIGIN)).unwrap();
        let n2 = next_json(&mut second)["nonce"].as_str().unwrap().to_string();
        assert_ne!(n1, n2);
        second.send(Message::text(captured)).unwrap();
        assert!(ends(&mut second));
    }

    #[test]
    fn two_origins_through_the_handshake_only_the_first_to_authenticate_wins() {
        let core = Arc::new(core_with(Some(TOKEN)));
        let addr = serve_local(&core);
        // Both pass the handshake while no origin is pinned, and both hold a challenge.
        let mut a = connect(addr, Some(ORIGIN)).unwrap();
        let mut b = connect(addr, Some(ORIGIN_B)).unwrap();
        let na = next_json(&mut a)["nonce"].as_str().unwrap().to_string();
        let nb = next_json(&mut b)["nonce"].as_str().unwrap().to_string();
        a.send(Message::text(hello_text(TOKEN, &na, ORIGIN))).unwrap();
        assert_eq!(next_json(&mut a)["type"], "welcome");
        // B's hello is correct for B, and still refused: A's origin is pinned now.
        b.send(Message::text(hello_text(TOKEN, &nb, ORIGIN_B))).unwrap();
        assert!(ends(&mut b));
        assert_eq!(core.pin().as_deref(), Some(ORIGIN));
        assert_eq!(core.status(None).state, "connected");
        assert_eq!(core.send(&Cmd::Close, None), Ok(()));
        assert_eq!(next_json(&mut a)["type"], "close");
    }

    #[test]
    fn flooding_control_frames_closes_the_connection() {
        let core = Arc::new(core_with(Some(TOKEN)));
        let addr = serve_local(&core);
        let mut ws = authed(addr, ORIGIN);
        // The hello was one message; thirty pings in a burst pass the limit of 20 a second.
        for _ in 0..30 {
            if ws.send(Message::Ping(Vec::new().into())).is_err() {
                break;
            }
        }
        assert!(ends(&mut ws));
        assert!(wait_for(&core, "waiting"));
    }
}
