//! The stage pop-out channel: a local WebSocket server the Firefox add-on connects to, so the wall can
//! open, close, place and switch the pop-out window and show which views it offers.
//!
//! Security, in the order a connection meets it:
//! - Bound to `127.0.0.1` only (`bind_ok`); a busy port is the state `port busy`, never another port.
//! - A peer that is not loopback is dropped; at most `MAX_CONNS` connections are served at once.
//! - The handshake needs an `Origin` of `moz-extension://<id>` (`origin_ok`); web pages send `http`,
//!   `https` or `null` and get 403. After the first good hello the origin is pinned and kept in
//!   `onair-stagepop.json`; any other origin is refused from then on.
//! - The first frame must be `{type:"hello", token, v:1}` within 2 seconds. The pairing token (32 random
//!   bytes, Credential Manager, `WidgetWall2/stagepop/token/0`) is compared with `ct_eq`. A wrong token closes
//!   the socket with 1008.
//! - Text frames only, 8 KiB per message and frame, at most 20 messages a second, ping every 30 s,
//!   closed after 60 s of silence.
//! The token is never logged (this module logs nothing) and never leaves Rust except as the answer to
//! the one-time show (`token_action`). One client at a time: a newer authenticated client replaces the old.

use crate::wall2_meet::store::{BlobStore, CredBlobs, Fetch};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
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
const FEEDS_MAX: usize = 12;
const KEY_MAX: usize = 128;
const NAME_MAX: usize = 64;
const COORD_MAX: i32 = 100_000;
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
    Hello { token: String, v: u64 },
    Feeds { list: Vec<Feed>, mode: String },
    Window { open: bool, fullscreen: bool },
}

pub(crate) fn parse_in(text: &str) -> Option<In> {
    if text.len() > MAX_MSG {
        return None;
    }
    let v: Value = serde_json::from_str(text).ok()?;
    match v.get("type")?.as_str()? {
        "hello" => Some(In::Hello { token: v.get("token")?.as_str()?.to_string(), v: v.get("v")?.as_u64()? }),
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
        _ => None,
    }
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

    /// Writes the settings; a failed write is ignored (the next change tries again).
    fn persist(&self, s: &Settings) {
        let path = self.path.lock().unwrap_or_else(|e| e.into_inner()).clone();
        if let (Some(p), Ok(text)) = (path, serde_json::to_string_pretty(s)) {
            let _ = std::fs::write(p, text);
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

    fn token_state(s: &Shared, vault: &dyn Vault) -> &'static str {
        match vault.load() {
            Fetch::Found(_) => {
                if s.settings.shown {
                    "hidden"
                } else {
                    "ready"
                }
            }
            _ => "none",
        }
    }

    /// `elgato` is the left and top of the 1024 by 600 monitor when one is attached.
    pub(crate) fn status(&self, elgato: Option<(i32, i32)>) -> StatusView {
        let s = self.lock();
        let state = match s.run {
            Run::Off => "off",
            Run::PortBusy => "port busy",
            Run::Waiting => "waiting",
            Run::Connected => "connected",
        };
        let place = place_of(&s.settings, elgato);
        let placement = PlacementView { left: place.map(|p| p.0), top: place.map(|p| p.1), source: source_of(&s.settings, elgato) };
        StatusView { state, feeds: s.feeds.clone(), mode: s.mode.clone(), window: s.window.clone(), placement, token: Self::token_state(&s, self.vault.as_ref()) }
    }

    pub(crate) fn token_ok(&self, supplied: &str) -> bool {
        match self.vault.load() {
            Fetch::Found(t) => ct_eq(&t, supplied),
            _ => false,
        }
    }

    /// Takes the client in after a good hello: pins the origin if none is pinned, replaces any older client.
    pub(crate) fn authenticate(&self, origin: &str) -> (u64, Receiver<String>) {
        let (tx, rx) = channel();
        let (generation, pinned) = {
            let mut s = self.lock();
            let mut pinned = None;
            if s.settings.origin.is_none() {
                s.settings.origin = Some(origin.to_string());
                pinned = Some(s.settings.clone());
            }
            s.generation += 1;
            s.tx = Some(tx);
            s.run = Run::Connected;
            s.feeds.clear();
            s.mode = None;
            s.window = WindowView { open: false, fullscreen: false };
            (s.generation, pinned)
        };
        if let Some(p) = pinned {
            self.persist(&p);
        }
        self.notify();
        (generation, rx)
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
    /// that held the old one is dropped. A code already shown cannot be shown again.
    pub(crate) fn token_action(&self, action: &str) -> Result<String, &'static str> {
        match action {
            "show" => match self.vault.load() {
                Fetch::Found(t) => {
                    if self.lock().settings.shown {
                        return Err("hidden");
                    }
                    return self.mark_shown(t, false);
                }
                Fetch::Missing => {}
                Fetch::Failed => return Err("failed"),
            },
            "new" => {}
            _ => return Err("invalid"),
        }
        let t = crate::wall2_oauth::random_b64(32).ok_or("failed")?;
        if !self.vault.save(&t) {
            return Err("failed");
        }
        self.mark_shown(t, action == "new")
    }

    fn mark_shown(&self, token: String, drop_client: bool) -> Result<String, &'static str> {
        let snapshot = {
            let mut s = self.lock();
            s.settings.shown = true;
            if drop_client {
                s.generation += 1;
                if s.run == Run::Connected {
                    s.run = Run::Waiting;
                }
                s.tx = None;
                s.feeds.clear();
                s.mode = None;
                s.window = WindowView { open: false, fullscreen: false };
            }
            s.settings.clone()
        };
        self.persist(&snapshot);
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
            Ok(Message::Text(t)) => {
                last_rx = Instant::now();
                if !limiter.allow(ms(last_rx)) {
                    close(&mut ws, CloseCode::Policy);
                    break;
                }
                if session.is_none() {
                    match parse_in(t.as_str()) {
                        Some(In::Hello { token, v: 1 }) if core.token_ok(&token) => session = Some(core.authenticate(&origin)),
                        _ => {
                            close(&mut ws, CloseCode::Policy);
                            break;
                        }
                    }
                } else {
                    core.handle_text(t.as_str());
                }
            }
            Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => {
                last_rx = Instant::now();
                let _ = ws.flush();
            }
            Ok(Message::Close(_)) => break,
            Ok(_) => {
                close(&mut ws, CloseCode::Unsupported);
                break;
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
    if !bind_ok(&addr) {
        core.set_run(Run::Off);
        return;
    }
    let listener = match TcpListener::bind(addr) {
        Ok(l) => l,
        Err(_) => {
            core.set_run(Run::PortBusy);
            return;
        }
    };
    serve_on(core, listener);
}

/// The accept loop over an already bound listener.
pub(crate) fn serve_on(core: Arc<Core>, listener: TcpListener) {
    core.set_run(Run::Waiting);
    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
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
        assert_eq!(parse_in("{\"type\":\"hello\",\"token\":\"t\",\"v\":1}"), Some(In::Hello { token: "t".into(), v: 1 }));
        assert_eq!(parse_in("{\"type\":\"hello\",\"v\":1}"), None);
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
        assert!(c.token_ok(&first));
        let second = c.token_action("new").unwrap();
        assert_ne!(first, second);
        assert!(c.token_ok(&second));
        assert!(!c.token_ok(&first));
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
        let (g1, _rx1) = c.authenticate(ORIGIN);
        assert_eq!(c.pin().as_deref(), Some(ORIGIN));
        assert_eq!(c.status(None).state, "connected");
        let (g2, rx2) = c.authenticate(ORIGIN);
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
        let (_g, _rx) = c.authenticate(ORIGIN);
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

    /// A client over a real loopback socket: wrong origin, wrong token, then a good hello that is answered by a command.
    #[test]
    fn a_real_handshake_over_loopback() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        assert!(bind_ok(&addr));
        let core = Arc::new(core_with(Some("good-token")));
        let c2 = Arc::clone(&core);
        std::thread::spawn(move || serve_on(c2, listener));
        let connect = |origin: Option<&str>| {
            let mut req = tungstenite::http::Request::builder().uri(format!("ws://{addr}/")).header("Host", addr.to_string()).header("Connection", "Upgrade").header("Upgrade", "websocket").header("Sec-WebSocket-Version", "13").header("Sec-WebSocket-Key", tungstenite::handshake::client::generate_key());
            if let Some(o) = origin {
                req = req.header("Origin", o);
            }
            tungstenite::client(req.body(()).unwrap(), TcpStream::connect(addr).unwrap())
        };
        // Web page origins and a missing origin are refused at the handshake.
        assert!(connect(Some("https://example.com")).is_err());
        assert!(connect(None).is_err());
        // A wrong token is closed.
        let (mut bad, _) = connect(Some(ORIGIN)).unwrap();
        bad.send(Message::text("{\"type\":\"hello\",\"token\":\"nope\",\"v\":1}")).unwrap();
        let mut closed = false;
        for _ in 0..5 {
            match bad.read() {
                Ok(Message::Close(_)) | Err(_) => {
                    closed = true;
                    break;
                }
                Ok(_) => {}
            }
        }
        assert!(closed);
        assert_eq!(core.status(None).state, "waiting");
        // A good hello connects; a command sent from the wall arrives; the pinned origin refuses another.
        let (mut ok, _) = connect(Some(ORIGIN)).unwrap();
        ok.send(Message::text("{\"type\":\"hello\",\"token\":\"good-token\",\"v\":1}")).unwrap();
        let waited = Instant::now();
        while core.status(None).state != "connected" && waited.elapsed() < Duration::from_secs(3) {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(core.status(None).state, "connected");
        assert_eq!(core.send(&Cmd::Close, None), Ok(()));
        let got = ok.read().unwrap();
        assert_eq!(got, Message::text("{\"type\":\"close\"}"));
        assert!(connect(Some("moz-extension://someone-else")).is_err());
    }
}
