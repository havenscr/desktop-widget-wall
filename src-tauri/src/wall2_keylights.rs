//! The two desk key lights, reached directly on the local network.
//!
//! The page never sees an address: commands take the side as the word `left`, `right` (or
//! `both` for a write). The two addresses are typed once in Tools and kept in `keylights.json`
//! in the app config folder, which only this module writes. An address is never returned, never
//! logged and never part of an error word. Every failure is one of a few fixed words.
//!
//! The light's interface, as community write-ups and the maker's own app describe it (proved here
//! against a fake transport only): plain HTTP on port 9123, no sign-in. `GET /elgato/lights`
//! reads, `PUT /elgato/lights` writes. Both directions carry
//! `{"numberOfLights":1,"lights":[{"on":0|1,"brightness":3..100,"temperature":143..344}]}`;
//! a write may carry only the fields that change. `temperature` is a mired-like number;
//! kelvin = round(1 000 000 / temperature), shown to the nearest 50 K.
//!
//! This file is the testable core: the address rules, the conversions, the write coalescing,
//! the config file and the log line shapes. `wall2_keylights_cmd.rs` is the thin Tauri glue.

use serde::Serialize;
use serde_json::{json, Value};
use std::io::Read;
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::sync::mpsc::SyncSender;
use std::sync::{Condvar, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

// Section: constants

pub(crate) const PORT: u16 = 9123;
const LIGHTS_PATH: &str = "/elgato/lights";
const INFO_PATH: &str = "/elgato/accessory-info";
const CONFIG_NAME: &str = "keylights.json";
const CONFIG_TMP: &str = "keylights.json.tmp";
const LOG_NAME: &str = "wall2-keylights.log";
const LOG_OLDER: &str = "wall2-keylights.log.1";
/// An answer over this many bytes is `too-big`.
pub(crate) const MAX_BODY: usize = 16 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_millis(1500);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(3);
/// At least this long between two writes to one light.
const MIN_GAP: Duration = Duration::from_millis(100);
/// The read back comes this long after the last write.
const READBACK_AFTER: Duration = Duration::from_millis(250);

/// The documented ranges. The light does not report its own range, so these are the maker's figures.
pub(crate) const BRI_MIN: i64 = 3;
pub(crate) const BRI_MAX: i64 = 100;
pub(crate) const TEMP_MIN: i64 = 143;
pub(crate) const TEMP_MAX: i64 = 344;
pub(crate) const KELVIN_MIN: i64 = 2900;
pub(crate) const KELVIN_MAX: i64 = 7000;

// Section: the fixed words

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Word {
    NotSetUp,
    BadAddress,
    NoAnswer,
    Timeout,
    Failed,
    TooBig,
    OtherModel,
    Refused,
}

impl Word {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::NotSetUp => "not-set-up",
            Self::BadAddress => "bad-address",
            Self::NoAnswer => "no-answer",
            Self::Timeout => "timeout",
            Self::Failed => "failed",
            Self::TooBig => "too-big",
            Self::OtherModel => "other-model",
            Self::Refused => "refused",
        }
    }
}

// Section: sides

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Side {
    Left,
    Right,
}

impl Side {
    pub(crate) fn word(self) -> &'static str {
        match self {
            Self::Left => "left",
            Self::Right => "right",
        }
    }
}

/// Which lights a command is about.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Which {
    One(Side),
    Both,
}

/// `left` or `right`, exactly; anything else is `refused`.
pub(crate) fn parse_side(raw: &str) -> Result<Side, Word> {
    match raw {
        "left" => Ok(Side::Left),
        "right" => Ok(Side::Right),
        _ => Err(Word::Refused),
    }
}

/// `left`, `right` or `both`, exactly; anything else is `refused`.
pub(crate) fn parse_which(raw: &str) -> Result<Which, Word> {
    if raw == "both" {
        return Ok(Which::Both);
    }
    parse_side(raw).map(Which::One)
}

// Section: the address rule

/// A literal IPv4 address in 10.0.0.0/8, 172.16.0.0/12 or 192.168.0.0/16, written plainly: four
/// decimal parts, no leading zero in a part, no space, port, path, scheme, user or host name.
/// Link-local (169.254), loopback and public addresses are refused.
pub(crate) fn parse_address(raw: &str) -> Result<Ipv4Addr, Word> {
    let mut octets = [0u8; 4];
    let mut parts = raw.split('.');
    for slot in octets.iter_mut() {
        let part = parts.next().ok_or(Word::BadAddress)?;
        if part.is_empty() || part.len() > 3 || !part.bytes().all(|b| b.is_ascii_digit()) {
            return Err(Word::BadAddress);
        }
        if part.len() > 1 && part.starts_with('0') {
            return Err(Word::BadAddress);
        }
        *slot = part.parse::<u8>().map_err(|_| Word::BadAddress)?;
    }
    if parts.next().is_some() {
        return Err(Word::BadAddress);
    }
    let private = octets[0] == 10 || (octets[0] == 172 && (16..=31).contains(&octets[1])) || (octets[0] == 192 && octets[1] == 168);
    if !private {
        return Err(Word::BadAddress);
    }
    Ok(Ipv4Addr::from(octets))
}

// Section: conversions

/// Kelvin from the light's `temperature`, to the nearest 50. The input is clamped to the documented range first.
pub(crate) fn kelvin_from_temp(temp: i64) -> i64 {
    let t = temp.clamp(TEMP_MIN, TEMP_MAX);
    round_to_50((1_000_000.0 / t as f64).round() as i64)
}

fn round_to_50(v: i64) -> i64 {
    ((v + 25).div_euclid(50)) * 50
}

/// The `temperature` to send for a kelvin value: clamped to 2900..=7000 K, then to the documented number range.
pub(crate) fn temp_from_kelvin(kelvin: i64) -> i64 {
    let k = kelvin.clamp(KELVIN_MIN, KELVIN_MAX);
    ((1_000_000.0 / k as f64).round() as i64).clamp(TEMP_MIN, TEMP_MAX)
}

pub(crate) fn clamp_brightness(v: i64) -> i64 {
    v.clamp(BRI_MIN, BRI_MAX)
}

// Section: the light's state

/// What a light reports, in the units the page speaks.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
pub(crate) struct Light {
    pub on: bool,
    pub brightness: u8,
    pub kelvin: u32,
}

/// One side's answer: the light, or a fixed word.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
#[serde(untagged)]
pub(crate) enum Reading {
    Light(Light),
    Word(&'static str),
}

impl Reading {
    pub(crate) fn of(result: Result<Light, Word>) -> Reading {
        match result {
            Ok(l) => Reading::Light(l),
            Err(w) => Reading::Word(w.as_str()),
        }
    }
}

#[derive(Serialize, Debug, PartialEq, Eq)]
pub(crate) struct SideSet {
    pub set: bool,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
pub(crate) struct Status {
    pub left: SideSet,
    pub right: SideSet,
}

/// The two lights' answers. A side a write did not touch is null.
#[derive(Serialize, Debug, PartialEq, Eq)]
pub(crate) struct Pair {
    pub left: Option<Reading>,
    pub right: Option<Reading>,
}

/// Reads the light's state out of an answer body. Any other shape is `other-model`.
pub(crate) fn light_from_body(body: &[u8]) -> Result<Light, Word> {
    let v: Value = serde_json::from_slice(body).map_err(|_| Word::OtherModel)?;
    let n = v.get("numberOfLights").and_then(Value::as_i64).ok_or(Word::OtherModel)?;
    if n < 1 {
        return Err(Word::OtherModel);
    }
    let first = v.get("lights").and_then(Value::as_array).and_then(|a| a.first()).ok_or(Word::OtherModel)?;
    let on = match first.get("on").and_then(Value::as_i64) {
        Some(0) => false,
        Some(1) => true,
        _ => return Err(Word::OtherModel),
    };
    let bri = first.get("brightness").and_then(Value::as_i64).ok_or(Word::OtherModel)?;
    if !(0..=100).contains(&bri) {
        return Err(Word::OtherModel);
    }
    let temp = first.get("temperature").and_then(Value::as_i64).ok_or(Word::OtherModel)?;
    if !(1..=1000).contains(&temp) {
        return Err(Word::OtherModel);
    }
    Ok(Light { on, brightness: clamp_brightness(bri) as u8, kelvin: kelvin_from_temp(temp) as u32 })
}

// Section: a write

/// The fields a write changes, in the light's own units. Later values replace earlier ones.
#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
pub(crate) struct Patch {
    pub on: Option<bool>,
    pub bri: Option<i64>,
    pub temp: Option<i64>,
}

impl Patch {
    /// From the page's numbers: brightness in percent, warmth in kelvin, both clamped.
    pub(crate) fn from_page(on: Option<bool>, brightness: Option<i64>, kelvin: Option<i64>) -> Patch {
        Patch { on, bri: brightness.map(clamp_brightness), temp: kelvin.map(temp_from_kelvin) }
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.on.is_none() && self.bri.is_none() && self.temp.is_none()
    }

    fn merge(&mut self, newer: &Patch) {
        if newer.on.is_some() {
            self.on = newer.on;
        }
        if newer.bri.is_some() {
            self.bri = newer.bri;
        }
        if newer.temp.is_some() {
            self.temp = newer.temp;
        }
    }

    /// The request body: only the fields that change.
    pub(crate) fn body(&self) -> String {
        let mut light = serde_json::Map::new();
        if let Some(on) = self.on {
            light.insert("on".into(), json!(if on { 1 } else { 0 }));
        }
        if let Some(b) = self.bri {
            light.insert("brightness".into(), json!(b));
        }
        if let Some(t) = self.temp {
            light.insert("temperature".into(), json!(t));
        }
        json!({ "numberOfLights": 1, "lights": [Value::Object(light)] }).to_string()
    }

    /// The numbers sent, for the log: `on=1 bri=60 temp=227`.
    fn numbers(&self) -> String {
        let mut out: Vec<String> = Vec::new();
        if let Some(on) = self.on {
            out.push(format!("on={}", on as u8));
        }
        if let Some(b) = self.bri {
            out.push(format!("bri={b}"));
        }
        if let Some(t) = self.temp {
            out.push(format!("temp={t}"));
        }
        out.join(" ")
    }
}

/// A light's state in the log's units (the light's own temperature number, not kelvin).
fn light_numbers(body: &[u8]) -> Option<String> {
    let v: Value = serde_json::from_slice(body).ok()?;
    let first = v.get("lights")?.as_array()?.first()?;
    Some(format!("on={} bri={} temp={}", first.get("on")?.as_i64()?, first.get("brightness")?.as_i64()?, first.get("temperature")?.as_i64()?))
}

// Section: the transport seam (tests use a fake; nothing in tests reaches a real light)

pub(crate) struct Reply {
    pub code: u16,
    pub body: Vec<u8>,
}

/// How a request can fail before an answer: no connection, a timeout, or an answer over the cap.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Fail {
    NoAnswer,
    Timeout,
    TooBig,
}

impl Fail {
    fn word(self) -> Word {
        match self {
            Self::NoAnswer => Word::NoAnswer,
            Self::Timeout => Word::Timeout,
            Self::TooBig => Word::TooBig,
        }
    }
}

pub(crate) trait LightHttp: Send + Sync {
    fn get(&self, ip: Ipv4Addr, path: &str) -> Result<Reply, Fail>;
    fn put(&self, ip: Ipv4Addr, path: &str, body: &str) -> Result<Reply, Fail>;
}

/// At most `MAX_BODY` bytes; one more byte is `too-big`.
pub(crate) fn cap_body(reader: impl Read) -> Result<Vec<u8>, Fail> {
    let mut buf = Vec::new();
    reader.take(MAX_BODY as u64 + 1).read_to_end(&mut buf).map_err(|_| Fail::NoAnswer)?;
    if buf.len() > MAX_BODY {
        return Err(Fail::TooBig);
    }
    Ok(buf)
}

pub(crate) struct RealHttp;

fn agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| ureq::AgentBuilder::new().timeout_connect(CONNECT_TIMEOUT).timeout(REQUEST_TIMEOUT).redirects(0).build())
}

fn url(ip: Ipv4Addr, path: &str) -> String {
    format!("http://{ip}:{PORT}{path}")
}

fn timed_out(t: &ureq::Transport) -> bool {
    use std::error::Error;
    let mut cur: Option<&(dyn Error + 'static)> = t.source();
    while let Some(e) = cur {
        if let Some(io) = e.downcast_ref::<std::io::Error>() {
            return matches!(io.kind(), std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock);
        }
        cur = e.source();
    }
    false
}

fn finish(result: Result<ureq::Response, ureq::Error>) -> Result<Reply, Fail> {
    match result {
        Ok(resp) => {
            let code = resp.status();
            // With redirects off a 3xx comes back as a success from the client; only 2xx is read.
            if !(200..300).contains(&code) {
                return Ok(Reply { code, body: Vec::new() });
            }
            Ok(Reply { code, body: cap_body(resp.into_reader())? })
        }
        Err(ureq::Error::Status(code, _)) => Ok(Reply { code, body: Vec::new() }),
        Err(ureq::Error::Transport(t)) => Err(if timed_out(&t) { Fail::Timeout } else { Fail::NoAnswer }),
    }
}

impl LightHttp for RealHttp {
    fn get(&self, ip: Ipv4Addr, path: &str) -> Result<Reply, Fail> {
        finish(agent().get(&url(ip, path)).set("Accept", "application/json").call())
    }
    fn put(&self, ip: Ipv4Addr, path: &str, body: &str) -> Result<Reply, Fail> {
        finish(agent().put(&url(ip, path)).set("Content-Type", "application/json").send_string(body))
    }
}

// Section: the environment of one call (the real one, or a test's)

pub(crate) struct Env<'a> {
    pub http: &'a dyn LightHttp,
    pub sleep: &'a (dyn Fn(Duration) + Sync),
    pub now: &'a (dyn Fn() -> Instant + Sync),
    /// One log line, without its time stamp and without a newline.
    pub log: &'a (dyn Fn(String) + Sync),
    pub min_gap: Duration,
    pub readback_after: Duration,
}

fn real_sleep(d: Duration) {
    std::thread::sleep(d);
}

fn real_now() -> Instant {
    Instant::now()
}

fn real_log(body: String) {
    write_line(format!("{} {body}\n", crate::wall2_sonos_log::stamp(unix_now())));
}

fn unix_now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

/// Runs `f` with the real transport, clock and log.
pub(crate) fn with_real_env<T>(f: impl FnOnce(&Env) -> T) -> T {
    f(&Env { http: &RealHttp, sleep: &real_sleep, now: &real_now, log: &real_log, min_gap: MIN_GAP, readback_after: READBACK_AFTER })
}

fn ms_since(env: &Env, t0: Instant) -> u128 {
    (env.now)().saturating_duration_since(t0).as_millis().min(999_999)
}

// Section: reads and the test

/// One read of the light. A failed read is logged (`read`, the word or status, milliseconds); a good one is not.
pub(crate) fn read_light(env: &Env, ip: Ipv4Addr, side: Side) -> Result<Light, Word> {
    let t0 = (env.now)();
    let res = env.http.get(ip, LIGHTS_PATH);
    let ms = ms_since(env, t0);
    match shape_read(res) {
        Ok(l) => Ok(l),
        Err((w, status)) => {
            (env.log)(format!("{} read {} {ms}", side.word(), status.unwrap_or_else(|| w.as_str().to_string())));
            Err(w)
        }
    }
}

/// The light, or the word and (for an answer that came) the HTTP status.
fn shape_read(res: Result<Reply, Fail>) -> Result<Light, (Word, Option<String>)> {
    let reply = res.map_err(|f| (f.word(), None))?;
    if !(200..300).contains(&reply.code) {
        return Err((Word::Failed, Some(reply.code.to_string())));
    }
    light_from_body(&reply.body).map_err(|w| (w, Some(reply.code.to_string())))
}

/// A product name made of letters and digits only, at most 32 of them: the one word the log keeps of the identity read.
pub(crate) fn product_word(body: &[u8]) -> String {
    let name = serde_json::from_slice::<Value>(body).ok().and_then(|v| v.get("productName").and_then(Value::as_str).map(str::to_string)).unwrap_or_default();
    let word: String = name.chars().filter(char::is_ascii_alphanumeric).take(32).collect();
    if word.is_empty() {
        "-".to_string()
    } else {
        word
    }
}

/// The Test button: one read, and (best effort) one identity read for the product word. One log line either way.
pub(crate) fn test_light(env: &Env, ip: Ipv4Addr, side: Side) -> Result<Light, Word> {
    let t0 = (env.now)();
    let res = env.http.get(ip, LIGHTS_PATH);
    let ms = ms_since(env, t0);
    match shape_read(res) {
        Ok(l) => {
            let product = match env.http.get(ip, INFO_PATH) {
                Ok(r) if (200..300).contains(&r.code) => product_word(&r.body),
                _ => "-".to_string(),
            };
            (env.log)(format!("{} test 200 {ms} product={product}", side.word()));
            Ok(l)
        }
        Err((w, status)) => {
            (env.log)(format!("{} test {} {ms}", side.word(), status.unwrap_or_else(|| w.as_str().to_string())));
            Err(w)
        }
    }
}

// Section: writes, coalesced to the latest value

struct Slot {
    pending: Option<Patch>,
    /// How many writes callers have submitted, and how many of them an answer covers.
    submitted: u64,
    done: u64,
    running: bool,
    last_put: Option<Instant>,
    result: Result<Light, Word>,
}

/// One light's write queue: at most one write in flight, at least `min_gap` apart, the last value
/// always sent, then one read back `readback_after` after the last write. A caller that arrives
/// while another is writing hands over its value and waits for the shared answer.
pub(crate) struct Coalescer {
    slot: Mutex<Slot>,
    cv: Condvar,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Frees the queue if the thread that is writing ever leaves without finishing (a panic).
struct Lead<'a>(&'a Coalescer, bool);

impl Drop for Lead<'_> {
    fn drop(&mut self) {
        if self.1 {
            return;
        }
        let mut g = lock(&self.0.slot);
        g.running = false;
        g.pending = None;
        g.done = g.submitted;
        g.result = Err(Word::Failed);
        self.0.cv.notify_all();
    }
}

impl Coalescer {
    pub(crate) const fn new() -> Coalescer {
        Coalescer { slot: Mutex::new(Slot { pending: None, submitted: 0, done: 0, running: false, last_put: None, result: Err(Word::Failed) }), cv: Condvar::new() }
    }

    #[cfg(test)]
    fn submitted(&self) -> u64 {
        lock(&self.slot).submitted
    }

    pub(crate) fn write(&self, env: &Env, ip: Ipv4Addr, side: Side, patch: Patch) -> Result<Light, Word> {
        let mut g = lock(&self.slot);
        match g.pending.as_mut() {
            Some(p) => p.merge(&patch),
            None => g.pending = Some(patch),
        }
        g.submitted += 1;
        let mine = g.submitted;
        if g.running {
            while g.done < mine {
                g = self.cv.wait(g).unwrap_or_else(|e| e.into_inner());
            }
            return g.result;
        }
        g.running = true;
        drop(g);
        let mut lead = Lead(self, false);
        // The log line of the last write waits here for its read back; a later write closes it without one.
        let mut held: Option<String> = None;
        let mut outcome: Result<Light, Word> = Err(Word::Failed);
        'run: loop {
            'step: {
                let wait = lock(&self.slot).last_put.map(|t| env.min_gap.saturating_sub((env.now)().saturating_duration_since(t)));
                if let Some(w) = wait {
                    if !w.is_zero() {
                        (env.sleep)(w);
                    }
                }
                let Some(sending) = lock(&self.slot).pending.take() else { break 'step };
                let t0 = (env.now)();
                let res = env.http.put(ip, LIGHTS_PATH, &sending.body());
                let ms = ms_since(env, t0);
                lock(&self.slot).last_put = Some((env.now)());
                if let Some(line) = held.take() {
                    (env.log)(format!("{line} back -"));
                }
                // What the log says (a status or a word) and the word the caller gets.
                let failed: Option<(String, Word)> = match &res {
                    Ok(r) if (200..300).contains(&r.code) => None,
                    Ok(r) => Some((r.code.to_string(), Word::Failed)),
                    Err(f) => Some((f.word().as_str().to_string(), f.word())),
                };
                if let Some((what, word)) = failed {
                    (env.log)(format!("{} write {what} {ms} sent {}", side.word(), sending.numbers()));
                    outcome = Err(word);
                    break 'step;
                }
                let code = res.map_or(0, |r| r.code);
                held = Some(format!("{} write {code} {ms} sent {}", side.word(), sending.numbers()));
                (env.sleep)(env.readback_after);
                if lock(&self.slot).pending.is_some() {
                    continue 'run;
                }
                let rt0 = (env.now)();
                let back = env.http.get(ip, LIGHTS_PATH);
                let rms = ms_since(env, rt0);
                let line = held.take().unwrap_or_default();
                match &back {
                    Ok(r) if (200..300).contains(&r.code) => {
                        let nums = light_numbers(&r.body).unwrap_or_else(|| "other-model".to_string());
                        (env.log)(format!("{line} back {nums}"));
                    }
                    Ok(r) => (env.log)(format!("{line} back {} {rms}", r.code)),
                    Err(f) => (env.log)(format!("{line} back {} {rms}", f.word().as_str())),
                }
                outcome = shape_read(back).map_err(|(w, _)| w);
            }
            // A value that arrived during the read back or the end is sent first; otherwise the answer is final.
            let mut g = lock(&self.slot);
            if g.pending.is_some() {
                continue 'run;
            }
            g.result = outcome;
            g.done = g.submitted;
            g.running = false;
            lead.1 = true;
            self.cv.notify_all();
            return g.result;
        }
    }
}

// Section: the config file

#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
pub(crate) struct Config {
    pub left: Option<Ipv4Addr>,
    pub right: Option<Ipv4Addr>,
}

impl Config {
    pub(crate) fn get(&self, side: Side) -> Option<Ipv4Addr> {
        match side {
            Side::Left => self.left,
            Side::Right => self.right,
        }
    }

    pub(crate) fn with(mut self, side: Side, ip: Option<Ipv4Addr>) -> Config {
        match side {
            Side::Left => self.left = ip,
            Side::Right => self.right = ip,
        }
        self
    }

    pub(crate) fn status(&self) -> Status {
        Status { left: SideSet { set: self.left.is_some() }, right: SideSet { set: self.right.is_some() } }
    }
}

/// The file's text to a config. A missing, unreadable or malformed file, or a value that fails the address rule, is "not set".
pub(crate) fn parse_config(text: Option<&str>) -> Config {
    let Some(v) = text.and_then(|t| serde_json::from_str::<Value>(t).ok()) else { return Config::default() };
    let side = |k: &str| v.get(k).and_then(Value::as_str).and_then(|s| parse_address(s).ok());
    Config { left: side("left"), right: side("right") }
}

fn render_config(c: &Config) -> String {
    let mut m = serde_json::Map::new();
    if let Some(ip) = c.left {
        m.insert("left".into(), json!(ip.to_string()));
    }
    if let Some(ip) = c.right {
        m.insert("right".into(), json!(ip.to_string()));
    }
    Value::Object(m).to_string()
}

pub(crate) fn read_config(dir: &Path) -> Config {
    parse_config(std::fs::read_to_string(dir.join(CONFIG_NAME)).ok().as_deref())
}

/// Written to a temporary file next to it, then renamed over it, so a reader never sees half a file.
pub(crate) fn write_config(dir: &Path, c: &Config) -> Result<(), Word> {
    std::fs::create_dir_all(dir).map_err(|_| Word::Failed)?;
    let tmp = dir.join(CONFIG_TMP);
    std::fs::write(&tmp, render_config(c)).map_err(|_| Word::Failed)?;
    std::fs::rename(&tmp, dir.join(CONFIG_NAME)).map_err(|_| {
        let _ = std::fs::remove_file(&tmp);
        Word::Failed
    })
}

/// One change at a time to the file.
static CONFIG_LOCK: Mutex<()> = Mutex::new(());

/// Validates and stores one side's address. The answer never carries the value.
pub(crate) fn set_address_in(dir: &Path, side: Side, raw: &str) -> Result<(), Word> {
    let ip = parse_address(raw)?;
    let _g = lock(&CONFIG_LOCK);
    write_config(dir, &read_config(dir).with(side, Some(ip)))
}

pub(crate) fn forget_in(dir: &Path, side: Side) -> Result<(), Word> {
    let _g = lock(&CONFIG_LOCK);
    write_config(dir, &read_config(dir).with(side, None))
}

// Section: the log

static TX: OnceLock<SyncSender<String>> = OnceLock::new();

fn write_line(line: String) {
    if let Some(tx) = TX.get() {
        let _ = tx.try_send(line);
    }
}

/// Starts the log next to the other wall logs. Without a folder nothing is logged.
pub(crate) fn start_log(dir: Option<PathBuf>) {
    let Some(dir) = dir else { return };
    if let Some(tx) = crate::wall2_sonos_log::start_named(&dir, LOG_NAME, LOG_OLDER, "wall2-keylights-log") {
        let _ = TX.set(tx);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    const IP: &str = "192.168.50.21";
    const IP2: &str = "10.1.2.3";

    fn ip(s: &str) -> Ipv4Addr {
        s.parse().unwrap()
    }

    fn state(on: i64, bri: i64, temp: i64) -> String {
        format!("{{\"numberOfLights\":1,\"lights\":[{{\"on\":{on},\"brightness\":{bri},\"temperature\":{temp}}}]}}")
    }

    fn ok(body: &str) -> Result<Reply, Fail> {
        Ok(Reply { code: 200, body: body.as_bytes().to_vec() })
    }

    type Script = Box<dyn Fn(&str, Ipv4Addr, &str, &str) -> Result<Reply, Fail> + Send + Sync>;

    /// A scripted transport that records every call as `METHOD path body`.
    struct Fake {
        script: Script,
        calls: Mutex<Vec<String>>,
    }

    impl Fake {
        fn new(script: impl Fn(&str, Ipv4Addr, &str, &str) -> Result<Reply, Fail> + Send + Sync + 'static) -> Fake {
            Fake { script: Box::new(script), calls: Mutex::new(Vec::new()) }
        }
        fn calls(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl LightHttp for Fake {
        fn get(&self, addr: Ipv4Addr, path: &str) -> Result<Reply, Fail> {
            self.calls.lock().unwrap().push(format!("GET {path}"));
            (self.script)("GET", addr, path, "")
        }
        fn put(&self, addr: Ipv4Addr, path: &str, body: &str) -> Result<Reply, Fail> {
            self.calls.lock().unwrap().push(format!("PUT {path} {body}"));
            (self.script)("PUT", addr, path, body)
        }
    }

    struct Rig {
        logs: Arc<Mutex<Vec<String>>>,
    }

    fn rig() -> Rig {
        Rig { logs: Arc::new(Mutex::new(Vec::new())) }
    }

    /// Runs `f` with the fake transport, short real waits and the rig's log.
    fn run<T>(rig: &Rig, http: &Fake, f: impl FnOnce(&Env) -> T) -> T {
        let logs = rig.logs.clone();
        let log = move |s: String| logs.lock().unwrap().push(s);
        let sleep = |d: Duration| std::thread::sleep(d.min(Duration::from_millis(5)));
        let now = Instant::now;
        f(&Env { http, sleep: &sleep, now: &now, log: &log, min_gap: Duration::from_millis(1), readback_after: Duration::from_millis(1) })
    }

    // ---- the address rule ----

    #[test]
    fn each_private_range_and_its_edges_pass() {
        for good in ["10.0.0.0", "10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.254", "192.168.0.1", "192.168.255.255", "192.168.50.21", "10.1.2.3", "172.20.0.9"] {
            assert!(parse_address(good).is_ok(), "{good} should pass");
        }
        assert_eq!(parse_address("192.168.50.21").unwrap(), ip(IP));
    }

    #[test]
    fn neighbours_of_the_ranges_are_refused() {
        for bad in ["172.15.255.255", "172.32.0.1", "11.0.0.1", "9.255.255.255", "192.167.1.1", "192.169.1.1", "169.254.1.1", "169.254.169.254"] {
            assert_eq!(parse_address(bad), Err(Word::BadAddress), "{bad} should be refused");
        }
    }

    #[test]
    fn loopback_public_and_unusual_addresses_are_refused() {
        for bad in ["127.0.0.1", "8.8.8.8", "1.1.1.1", "0.0.0.0", "255.255.255.255", "100.64.0.1", "224.0.0.1"] {
            assert_eq!(parse_address(bad), Err(Word::BadAddress), "{bad} should be refused");
        }
    }

    #[test]
    fn host_names_ports_paths_schemes_credentials_and_spaces_are_refused() {
        for bad in [
            "light.local",
            "localhost",
            "192.168.50.21:9123",
            "192.168.50.21/",
            "192.168.50.21/elgato/lights",
            "http://192.168.50.21",
            "user@192.168.50.21",
            "user:pass@192.168.50.21",
            " 192.168.50.21",
            "192.168.50.21 ",
            "192.168. 50.21",
            "192.168.50.21\n",
            "192.168.50.21\t",
            "",
            "   ",
            "192.168.50",
            "192.168.50.21.5",
            "192.168.50.",
            ".192.168.50.21",
            "192.168..21",
            "192,168,50,21",
            "192.168.50.256",
            "192.168.50.-1",
            "192.168.50.+1",
            "192.168.50.2a",
            "0xC0.0xA8.0x32.0x15",
            "3232248341",
            "192.168.50.1000",
            "192.168.050.21",
            "192.168.50.021",
            "010.1.2.3",
            "10.01.2.3",
            "10.1.2.00",
        ] {
            assert_eq!(parse_address(bad), Err(Word::BadAddress), "{bad:?} should be refused");
        }
    }

    #[test]
    fn ipv6_is_refused() {
        for bad in ["::1", "fe80::1", "fd00::1", "[fd00::1]", "::ffff:192.168.50.21", "[::ffff:192.168.50.21]:9123"] {
            assert_eq!(parse_address(bad), Err(Word::BadAddress), "{bad:?} should be refused");
        }
    }

    #[test]
    fn a_single_zero_part_is_not_a_leading_zero() {
        assert!(parse_address("10.0.0.0").is_ok());
        assert!(parse_address("172.16.0.0").is_ok());
    }

    // ---- sides ----

    #[test]
    fn the_side_word_is_exact() {
        assert_eq!(parse_side("left"), Ok(Side::Left));
        assert_eq!(parse_side("right"), Ok(Side::Right));
        for bad in ["both", "Left", "LEFT", " left", "left ", "", "192.168.50.21", "middle", "left\n"] {
            assert_eq!(parse_side(bad), Err(Word::Refused), "{bad:?}");
        }
        assert_eq!(parse_which("both"), Ok(Which::Both));
        assert_eq!(parse_which("left"), Ok(Which::One(Side::Left)));
        assert_eq!(parse_which("Both"), Err(Word::Refused));
        assert_eq!(parse_which("192.168.50.21"), Err(Word::Refused));
    }

    // ---- conversions ----

    #[test]
    fn kelvin_converts_both_ways_with_the_stated_defaults() {
        assert_eq!(kelvin_from_temp(143), 7000);
        assert_eq!(kelvin_from_temp(344), 2900);
        assert_eq!(kelvin_from_temp(227), 4400);
        assert_eq!(temp_from_kelvin(7000), 143);
        assert_eq!(temp_from_kelvin(2900), 344);
        assert_eq!(temp_from_kelvin(4400), 227);
        assert_eq!(temp_from_kelvin(5600), 179);
    }

    #[test]
    fn writes_clamp_to_the_documented_ranges() {
        assert_eq!(temp_from_kelvin(1000), 344);
        assert_eq!(temp_from_kelvin(2000), 344);
        assert_eq!(temp_from_kelvin(9000), 143);
        assert_eq!(temp_from_kelvin(i64::MAX), 143);
        assert_eq!(temp_from_kelvin(i64::MIN), 344);
        assert_eq!(clamp_brightness(0), 3);
        assert_eq!(clamp_brightness(-5), 3);
        assert_eq!(clamp_brightness(101), 100);
        assert_eq!(clamp_brightness(60), 60);
        let p = Patch::from_page(Some(true), Some(250), Some(12_000));
        assert_eq!(p, Patch { on: Some(true), bri: Some(100), temp: Some(143) });
    }

    #[test]
    fn kelvin_read_back_is_rounded_to_fifty_and_never_leaves_the_range() {
        for t in 1..=1000 {
            let k = kelvin_from_temp(t);
            assert!(k % 50 == 0 && (2900..=7000).contains(&k), "temp {t} gave {k}");
        }
        // Every kelvin a slider can send comes back as the same kelvin after the round trip, within one step.
        for k in (2900..=7000).step_by(50) {
            let back = kelvin_from_temp(temp_from_kelvin(k));
            assert!((back - k).abs() <= 100, "{k} came back as {back}");
        }
    }

    #[test]
    fn a_body_carries_only_the_fields_that_change() {
        let on_only = Patch { on: Some(false), ..Patch::default() };
        let v: Value = serde_json::from_str(&on_only.body()).unwrap();
        assert_eq!(v, json!({"numberOfLights": 1, "lights": [{"on": 0}]}));
        let all = Patch { on: Some(true), bri: Some(60), temp: Some(227) };
        let v: Value = serde_json::from_str(&all.body()).unwrap();
        assert_eq!(v, json!({"numberOfLights": 1, "lights": [{"on": 1, "brightness": 60, "temperature": 227}]}));
        assert_eq!(all.numbers(), "on=1 bri=60 temp=227");
        assert_eq!(Patch { bri: Some(40), ..Patch::default() }.numbers(), "bri=40");
        assert!(Patch::default().is_empty());
    }

    // ---- reading ----

    #[test]
    fn a_good_answer_reads_as_a_light() {
        let l = light_from_body(state(1, 60, 227).as_bytes()).unwrap();
        assert_eq!(l, Light { on: true, brightness: 60, kelvin: 4400 });
        let off = light_from_body(state(0, 3, 344).as_bytes()).unwrap();
        assert_eq!(off, Light { on: false, brightness: 3, kelvin: 2900 });
        // A light below the stated minimum is shown at the minimum; one above the temperature range is clamped.
        assert_eq!(light_from_body(state(1, 0, 100).as_bytes()).unwrap(), Light { on: true, brightness: 3, kelvin: 7000 });
        // Extra fields are ignored.
        let extra = r#"{"numberOfLights":2,"lights":[{"on":1,"brightness":50,"temperature":200,"x":1},{"on":0,"brightness":9,"temperature":300}]}"#;
        assert_eq!(light_from_body(extra.as_bytes()).unwrap(), Light { on: true, brightness: 50, kelvin: 5000 });
    }

    #[test]
    fn an_answer_of_another_shape_is_other_model() {
        for body in [
            "",
            "not json",
            "[]",
            "{}",
            r#"{"numberOfLights":1}"#,
            r#"{"numberOfLights":1,"lights":[]}"#,
            r#"{"numberOfLights":0,"lights":[{"on":1,"brightness":50,"temperature":200}]}"#,
            r#"{"numberOfLights":1,"lights":[{"on":true,"brightness":50,"temperature":200}]}"#,
            r#"{"numberOfLights":1,"lights":[{"on":2,"brightness":50,"temperature":200}]}"#,
            r#"{"numberOfLights":1,"lights":[{"on":1,"brightness":"50","temperature":200}]}"#,
            r#"{"numberOfLights":1,"lights":[{"on":1,"brightness":500,"temperature":200}]}"#,
            r#"{"numberOfLights":1,"lights":[{"on":1,"brightness":50,"temperature":0}]}"#,
            r#"{"numberOfLights":1,"lights":[{"on":1,"brightness":50}]}"#,
            r#"{"status":"ok"}"#,
        ] {
            assert_eq!(light_from_body(body.as_bytes()), Err(Word::OtherModel), "{body:?}");
        }
    }

    #[test]
    fn the_cap_is_sixteen_kilobytes() {
        assert_eq!(cap_body(std::io::Cursor::new(vec![b'a'; MAX_BODY])).unwrap().len(), MAX_BODY);
        assert_eq!(cap_body(std::io::Cursor::new(vec![b'a'; 17 * 1024])), Err(Fail::TooBig));
        assert_eq!(cap_body(std::io::Cursor::new(vec![b'a'; MAX_BODY + 1])), Err(Fail::TooBig));
    }

    #[test]
    fn a_read_maps_each_failure_to_its_word() {
        let cases: Vec<(Box<dyn Fn() -> Result<Reply, Fail> + Send + Sync>, Word)> = vec![
            (Box::new(|| Err(Fail::NoAnswer)), Word::NoAnswer),
            (Box::new(|| Err(Fail::Timeout)), Word::Timeout),
            (Box::new(|| Err(Fail::TooBig)), Word::TooBig),
            (Box::new(|| Ok(Reply { code: 302, body: Vec::new() })), Word::Failed),
            (Box::new(|| Ok(Reply { code: 404, body: Vec::new() })), Word::Failed),
            (Box::new(|| Ok(Reply { code: 500, body: Vec::new() })), Word::Failed),
            (Box::new(|| ok("{\"hello\":1}")), Word::OtherModel),
            (Box::new(|| ok("<html></html>")), Word::OtherModel),
        ];
        for (reply, want) in cases {
            let http = Fake::new(move |_, _, _, _| reply());
            let r = rig();
            let got = run(&r, &http, |env| read_light(env, ip(IP), Side::Left));
            assert_eq!(got, Err(want));
            // A failed read is logged: side, `read`, a status or the word, milliseconds.
            let logs = r.logs.lock().unwrap().clone();
            assert_eq!(logs.len(), 1, "{logs:?}");
            let f: Vec<&str> = logs[0].split(' ').collect();
            assert_eq!((f[0], f[1]), ("left", "read"));
            assert!(f[3].bytes().all(|b| b.is_ascii_digit()));
        }
    }

    #[test]
    fn a_good_read_is_not_logged() {
        let http = Fake::new(|_, _, _, _| ok(&state(1, 60, 227)));
        let r = rig();
        let got = run(&r, &http, |env| read_light(env, ip(IP), Side::Right));
        assert_eq!(got, Ok(Light { on: true, brightness: 60, kelvin: 4400 }));
        assert!(r.logs.lock().unwrap().is_empty());
        assert_eq!(http.calls(), vec!["GET /elgato/lights".to_string()]);
    }

    #[test]
    fn requests_go_only_to_the_address_asked_and_the_two_paths() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let s2 = seen.clone();
        let http = Fake::new(move |_, addr, path, _| {
            s2.lock().unwrap().push((addr, path.to_string()));
            ok(&state(1, 60, 227))
        });
        let r = rig();
        let _ = run(&r, &http, |env| test_light(env, ip(IP2), Side::Left));
        let co = Coalescer::new();
        let _ = run(&r, &http, |env| co.write(env, ip(IP2), Side::Left, Patch { on: Some(true), ..Patch::default() }));
        for (addr, path) in seen.lock().unwrap().iter() {
            assert_eq!(*addr, ip(IP2));
            assert!(path == "/elgato/lights" || path == "/elgato/accessory-info", "{path}");
        }
    }

    // ---- the test button ----

    #[test]
    fn test_logs_one_line_with_the_product_word_only() {
        let http = Fake::new(|_, _, path, _| {
            if path == INFO_PATH {
                ok(r#"{"productName":"Elgato Key Light","serialNumber":"SECRET123","displayName":"Bob's desk","firmwareVersion":"1.0.3"}"#)
            } else {
                ok(&state(1, 60, 227))
            }
        });
        let r = rig();
        let got = run(&r, &http, |env| test_light(env, ip(IP), Side::Left));
        assert_eq!(got, Ok(Light { on: true, brightness: 60, kelvin: 4400 }));
        let logs = r.logs.lock().unwrap().clone();
        assert_eq!(logs.len(), 1);
        assert!(logs[0].starts_with("left test 200 ") && logs[0].ends_with(" product=ElgatoKeyLight"), "{}", logs[0]);
        assert!(!logs[0].contains("SECRET") && !logs[0].contains("Bob"));
    }

    #[test]
    fn test_without_an_identity_answer_still_succeeds() {
        let http = Fake::new(|_, _, path, _| if path == INFO_PATH { Err(Fail::NoAnswer) } else { ok(&state(0, 40, 250)) });
        let r = rig();
        let got = run(&r, &http, |env| test_light(env, ip(IP), Side::Right));
        assert_eq!(got, Ok(Light { on: false, brightness: 40, kelvin: 4000 }));
        assert!(r.logs.lock().unwrap()[0].ends_with("product=-"));
    }

    #[test]
    fn a_failed_test_says_its_word_and_logs_it() {
        let http = Fake::new(|_, _, _, _| Err(Fail::Timeout));
        let r = rig();
        assert_eq!(run(&r, &http, |env| test_light(env, ip(IP), Side::Right)), Err(Word::Timeout));
        assert!(r.logs.lock().unwrap()[0].starts_with("right test timeout "));
        let http = Fake::new(|_, _, _, _| ok("{\"other\":1}"));
        assert_eq!(run(&r, &http, |env| test_light(env, ip(IP), Side::Right)), Err(Word::OtherModel));
        assert!(r.logs.lock().unwrap()[1].starts_with("right test 200 ") || r.logs.lock().unwrap()[1].starts_with("right test other-model "));
    }

    #[test]
    fn the_product_word_is_letters_and_digits_only() {
        assert_eq!(product_word(br#"{"productName":"Key Light Air MK.2!"}"#), "KeyLightAirMK2");
        assert_eq!(product_word(br#"{"productName":"<script>x</script>"}"#), "scriptxscript");
        assert_eq!(product_word(br#"{"productName":"a very very very very very long product name"}"#).len(), 32);
        assert_eq!(product_word(b"nope"), "-");
        assert_eq!(product_word(br#"{"productName":"   "}"#), "-");
    }

    // ---- writing, coalesced ----

    #[test]
    fn one_write_sends_the_patch_then_reads_back_and_returns_what_the_light_reports() {
        // The light takes the brightness but reports 58: the answer is what it reports.
        let http = Fake::new(|m, _, _, _| if m == "PUT" { ok("{}") } else { ok(&state(1, 58, 227)) });
        let r = rig();
        let co = Coalescer::new();
        let got = run(&r, &http, |env| co.write(env, ip(IP), Side::Left, Patch { bri: Some(60), ..Patch::default() }));
        assert_eq!(got, Ok(Light { on: true, brightness: 58, kelvin: 4400 }));
        let calls = http.calls();
        assert_eq!(calls.len(), 2);
        assert!(calls[0].starts_with("PUT /elgato/lights ") && calls[0].contains("\"brightness\":60") && !calls[0].contains("temperature"));
        assert_eq!(calls[1], "GET /elgato/lights");
        let logs = r.logs.lock().unwrap().clone();
        assert_eq!(logs.len(), 1);
        assert!(logs[0].starts_with("left write 200 ") && logs[0].contains(" sent bri=60 back on=1 bri=58 temp=227"), "{}", logs[0]);
    }

    #[test]
    fn a_burst_of_twenty_sends_a_few_always_the_last_then_one_read_back() {
        use std::sync::mpsc;
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let release_rx = Mutex::new(release_rx);
        let first = AtomicUsize::new(0);
        let http = Arc::new(Fake::new(move |m, _, _, _| {
            if m == "PUT" && first.fetch_add(1, Ordering::SeqCst) == 0 {
                // The first write is held until the whole burst has arrived.
                let _ = release_rx.lock().unwrap().recv();
            }
            if m == "PUT" { ok("{}") } else { ok(&state(1, 99, 227)) }
        }));
        let co = Arc::new(Coalescer::new());
        let r = rig();
        let mut handles = Vec::new();
        for i in 0..20i64 {
            let (http, co2, logs) = (http.clone(), co.clone(), r.logs.clone());
            handles.push(std::thread::spawn(move || {
                let rg = Rig { logs };
                run(&rg, &http, |env| co2.write(env, ip(IP), Side::Left, Patch { bri: Some(40 + i), ..Patch::default() }))
            }));
            // Arrivals in a fixed order: wait until this one is counted before sending the next.
            while co.submitted() < (i as u64 + 1) {
                std::thread::sleep(Duration::from_millis(1));
            }
            if i == 0 {
                // The leader is now inside its first write.
                std::thread::sleep(Duration::from_millis(20));
            }
        }
        release_tx.send(()).unwrap();
        let answers: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        let calls = http.calls();
        let puts: Vec<&String> = calls.iter().filter(|c| c.starts_with("PUT")).collect();
        let gets = calls.iter().filter(|c| c.starts_with("GET")).count();
        assert!(puts.len() <= 3, "{} writes for 20 values", puts.len());
        assert!(puts.last().unwrap().contains("\"brightness\":59"), "the last value must be the last one sent: {puts:?}");
        assert_eq!(gets, 1, "exactly one read back for the burst");
        assert!(answers.iter().all(|a| *a == Ok(Light { on: true, brightness: 99, kelvin: 4400 })));
        // Earlier writes are logged closed, the last one carries the read back.
        let logs = r.logs.lock().unwrap().clone();
        assert_eq!(logs.len(), puts.len());
        assert!(logs.last().unwrap().contains(" back on=1 bri=99 temp=227"));
    }

    #[test]
    fn a_later_field_replaces_an_earlier_one_and_other_fields_are_kept() {
        let mut p = Patch { on: Some(true), bri: Some(50), temp: None };
        p.merge(&Patch { on: None, bri: Some(70), temp: Some(200) });
        assert_eq!(p, Patch { on: Some(true), bri: Some(70), temp: Some(200) });
    }

    #[test]
    fn writes_are_at_least_the_minimum_gap_apart() {
        let times = Arc::new(Mutex::new(Vec::<Instant>::new()));
        let t2 = times.clone();
        let http = Fake::new(move |m, _, _, _| {
            if m == "PUT" {
                t2.lock().unwrap().push(Instant::now());
            }
            ok(&state(1, 60, 227))
        });
        let r = rig();
        let co = Coalescer::new();
        let logs = r.logs.clone();
        let log = move |s: String| logs.lock().unwrap().push(s);
        let sleep = |d: Duration| std::thread::sleep(d);
        let now = Instant::now;
        let env = Env { http: &http, sleep: &sleep, now: &now, log: &log, min_gap: Duration::from_millis(100), readback_after: Duration::from_millis(1) };
        for v in [10, 20, 30] {
            let _ = co.write(&env, ip(IP), Side::Left, Patch { bri: Some(v), ..Patch::default() });
        }
        let t = times.lock().unwrap().clone();
        assert_eq!(t.len(), 3);
        for pair in t.windows(2) {
            assert!(pair[1].duration_since(pair[0]) >= Duration::from_millis(99), "two writes closer than the gap");
        }
    }

    #[test]
    fn a_failed_write_is_a_word_and_a_log_line_with_the_numbers_sent() {
        for (script, want, logged) in [
            (Box::new(|m: &str| if m == "PUT" { Err(Fail::Timeout) } else { ok(&state(1, 60, 227)) }) as Box<dyn Fn(&str) -> Result<Reply, Fail> + Send + Sync>, Word::Timeout, "left write timeout "),
            (Box::new(|m: &str| if m == "PUT" { Err(Fail::NoAnswer) } else { ok(&state(1, 60, 227)) }), Word::NoAnswer, "left write no-answer "),
            (Box::new(|m: &str| if m == "PUT" { Ok(Reply { code: 302, body: Vec::new() }) } else { ok(&state(1, 60, 227)) }), Word::Failed, "left write 302 "),
            (Box::new(|m: &str| if m == "PUT" { Ok(Reply { code: 400, body: Vec::new() }) } else { ok(&state(1, 60, 227)) }), Word::Failed, "left write 400 "),
        ] {
            let http = Fake::new(move |m, _, _, _| script(m));
            let r = rig();
            let co = Coalescer::new();
            let got = run(&r, &http, |env| co.write(env, ip(IP), Side::Left, Patch { on: Some(true), bri: Some(60), temp: None }));
            assert_eq!(got, Err(want));
            let logs = r.logs.lock().unwrap().clone();
            assert_eq!(logs.len(), 1, "{logs:?}");
            assert!(logs[0].starts_with(logged) && logs[0].ends_with(" sent on=1 bri=60"), "{}", logs[0]);
            // No read back after a failed write.
            assert_eq!(http.calls().iter().filter(|c| c.starts_with("GET")).count(), 0);
        }
    }

    #[test]
    fn a_wrong_shape_on_the_read_back_is_other_model_and_logged() {
        let http = Fake::new(|m, _, _, _| if m == "PUT" { ok("{}") } else { ok("{\"nope\":1}") });
        let r = rig();
        let co = Coalescer::new();
        let got = run(&r, &http, |env| co.write(env, ip(IP), Side::Right, Patch { bri: Some(60), ..Patch::default() }));
        assert_eq!(got, Err(Word::OtherModel));
        assert!(r.logs.lock().unwrap()[0].ends_with(" back other-model"));
    }

    #[test]
    fn the_queue_is_free_again_after_every_write() {
        let http = Fake::new(|_, _, _, _| ok(&state(1, 60, 227)));
        let r = rig();
        let co = Coalescer::new();
        for _ in 0..3 {
            let got = run(&r, &http, |env| co.write(env, ip(IP), Side::Left, Patch { on: Some(true), ..Patch::default() }));
            assert!(got.is_ok());
        }
        assert_eq!(http.calls().iter().filter(|c| c.starts_with("PUT")).count(), 3);
    }

    // ---- the config file ----

    struct Tmp(PathBuf);
    impl Tmp {
        fn new(tag: &str) -> Tmp {
            static N: AtomicUsize = AtomicUsize::new(0);
            let n = N.fetch_add(1, Ordering::SeqCst);
            let dir = std::env::temp_dir().join(format!("wall2-keylights-test-{}-{tag}-{n}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            Tmp(dir)
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn an_address_is_validated_then_saved_and_read_back_from_the_file() {
        let t = Tmp::new("save");
        assert_eq!(read_config(&t.0).status(), Status { left: SideSet { set: false }, right: SideSet { set: false } });
        assert_eq!(set_address_in(&t.0, Side::Left, IP), Ok(()));
        assert_eq!(set_address_in(&t.0, Side::Right, IP2), Ok(()));
        let c = read_config(&t.0);
        assert_eq!((c.left, c.right), (Some(ip(IP)), Some(ip(IP2))));
        // The file holds exactly the two values and no temporary file is left behind.
        let v: Value = serde_json::from_str(&std::fs::read_to_string(t.0.join("keylights.json")).unwrap()).unwrap();
        assert_eq!(v, json!({"left": IP, "right": IP2}));
        assert!(!t.0.join("keylights.json.tmp").exists());
        // Forgetting one side leaves the other.
        assert_eq!(forget_in(&t.0, Side::Left), Ok(()));
        let c = read_config(&t.0);
        assert_eq!((c.left, c.right), (None, Some(ip(IP2))));
        assert_eq!(c.status(), Status { left: SideSet { set: false }, right: SideSet { set: true } });
    }

    #[test]
    fn a_bad_address_is_a_word_and_never_touches_the_file() {
        let t = Tmp::new("bad");
        assert_eq!(set_address_in(&t.0, Side::Left, IP), Ok(()));
        let before = std::fs::read_to_string(t.0.join("keylights.json")).unwrap();
        for bad in ["8.8.8.8", "light.local", "192.168.50.21:9123", "169.254.1.1", "010.0.0.1", ""] {
            assert_eq!(set_address_in(&t.0, Side::Left, bad), Err(Word::BadAddress));
        }
        assert_eq!(std::fs::read_to_string(t.0.join("keylights.json")).unwrap(), before);
    }

    #[test]
    fn a_hand_edited_or_broken_file_never_yields_an_unchecked_address() {
        for text in [None, Some(""), Some("not json"), Some("[]"), Some(r#"{"left":"8.8.8.8","right":"http://192.168.1.2"}"#), Some(r#"{"left":5,"right":null}"#)] {
            assert_eq!(parse_config(text), Config::default(), "{text:?}");
        }
        let c = parse_config(Some(r#"{"left":"192.168.50.21","right":"169.254.1.1"}"#));
        assert_eq!((c.left, c.right), (Some(ip(IP)), None));
    }

    #[test]
    fn a_write_into_an_unusable_folder_is_failed_not_a_panic() {
        let t = Tmp::new("blocked");
        std::fs::create_dir_all(&t.0).unwrap();
        let blocker = t.0.join("file");
        std::fs::write(&blocker, "x").unwrap();
        assert_eq!(set_address_in(&blocker.join("sub"), Side::Left, IP), Err(Word::Failed));
    }

    // ---- nothing leaks the address ----

    #[test]
    fn no_answer_error_word_or_log_line_carries_the_address() {
        let t = Tmp::new("leak");
        let mut seen: Vec<String> = Vec::new();
        // Words and the config answers.
        for w in [Word::NotSetUp, Word::BadAddress, Word::NoAnswer, Word::Timeout, Word::Failed, Word::TooBig, Word::OtherModel, Word::Refused] {
            seen.push(w.as_str().to_string());
        }
        seen.push(format!("{:?}", set_address_in(&t.0, Side::Left, IP)));
        seen.push(format!("{:?}", set_address_in(&t.0, Side::Left, "10.9.9.9:80")));
        seen.push(serde_json::to_string(&read_config(&t.0).status()).unwrap());
        // Every transport outcome, through reads, tests and writes: answers (as the page sees them) and log lines.
        let outcomes: Vec<Box<dyn Fn(&str) -> Result<Reply, Fail> + Send + Sync>> = vec![
            Box::new(|_| ok(&state(1, 60, 227))),
            Box::new(|_| Err(Fail::NoAnswer)),
            Box::new(|_| Err(Fail::Timeout)),
            Box::new(|_| Err(Fail::TooBig)),
            Box::new(|_| ok("{\"x\":1}")),
            Box::new(|_| Ok(Reply { code: 302, body: Vec::new() })),
            Box::new(|m| if m == "PUT" { Err(Fail::Timeout) } else { ok(&state(1, 60, 227)) }),
        ];
        for outcome in outcomes {
            let http = Fake::new(move |m, _, _, _| outcome(m));
            let r = rig();
            let co = Coalescer::new();
            let answers = vec![
                run(&r, &http, |env| read_light(env, ip(IP), Side::Left)),
                run(&r, &http, |env| test_light(env, ip(IP), Side::Left)),
                run(&r, &http, |env| co.write(env, ip(IP), Side::Left, Patch { on: Some(true), bri: Some(60), temp: Some(227) })),
            ];
            for a in answers {
                seen.push(serde_json::to_string(&Reading::of(a)).unwrap());
                seen.push(format!("{a:?}"));
            }
            seen.push(serde_json::to_string(&Pair { left: Some(Reading::Word("failed")), right: None }).unwrap());
            seen.extend(r.logs.lock().unwrap().iter().cloned());
        }
        for text in &seen {
            assert!(!text.contains(IP) && !text.contains("192.168") && !text.contains("10.9.9.9"), "address in: {text}");
        }
    }

    #[test]
    fn every_log_line_is_side_kind_status_milliseconds_and_numbers() {
        let http = Fake::new(|m, _, _, _| if m == "PUT" { ok("{}") } else { ok(&state(1, 60, 227)) });
        let r = rig();
        let co = Coalescer::new();
        let _ = run(&r, &http, |env| test_light(env, ip(IP), Side::Right));
        let _ = run(&r, &http, |env| co.write(env, ip(IP), Side::Right, Patch { on: Some(true), bri: Some(60), temp: Some(227) }));
        let logs = r.logs.lock().unwrap().clone();
        assert_eq!(logs.len(), 2);
        assert!(logs[1].starts_with("right write 200 ") && logs[1].ends_with(" sent on=1 bri=60 temp=227 back on=1 bri=60 temp=227"), "{}", logs[1]);
        for l in &logs {
            assert!(l.is_ascii() && !l.contains('\n'));
        }
    }
}
