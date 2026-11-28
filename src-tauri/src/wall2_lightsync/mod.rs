//! Music light sync, part 1 (41-2): pair the wall with the Hue bridge and keep the key.
//!
//! The wall registers itself with the bridge (link button), keeps `{ username, clientkey, appId,
//! bridgeId }` in Windows Credential Manager (`store.rs`) and talks to the bridge over HTTPS
//! pinned to the Hue roots and the bridge id the home app gives (`bridge.rs`). The web view
//! learns `paired` and `bridgeChanged`, never a key or an address. Errors are fixed words.
//! `running`, `starting`, `lastError` and `stoppedHueSync` belong to the stream (41-4) and are
//! idle values until then.
//!
//! 41-3 adds the DTLS stream (`stream.rs`), the Nanoleaf UDP frame (`nanoleaf.rs`) and
//! `wall2_lightsync_test`: a 3 s magenta sweep over the Plays and a ring over the panels, then
//! stop. Every answer is a fixed word; no key, PSK, token or address ever reaches one.

//! 41-4 adds the engine: `start`, `tune`, `stop`, `stop_all` and `huesync_open`. A stream thread
//! takes the newest audio frame from a slot the capture loop fills (`publish`), runs the beat
//! detector (`beat.rs`) and the frame function (`engine.rs`), and sends one Hue frame and, at
//! about 30 Hz, one panel frame. It keeps sending through silence, and stops itself, restoring the
//! panels, when Windows locks, after five minutes of silence or when the Hue link is lost.

pub(crate) mod beat;
pub(crate) mod bridge;
pub(crate) mod engine;
pub(crate) mod huesync;
pub(crate) mod nanoleaf;
pub(crate) mod store;
pub(crate) mod stream;

use bridge::{BridgeNet, Facts};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use store::{KeyStore, Loaded, Saved};
use stream::Frames;

/// What the web view may learn. Never a key, a client key, an app id or an address.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LightSyncStatus {
    pub paired: bool,
    pub bridge_changed: bool,
    pub running: bool,
    pub starting: bool,
    pub last_error: Option<String>,
    pub stopped_hue_sync: bool,
}

/// `facts` is None when the home app could not be asked: the bridge is then assumed unchanged.
pub(crate) fn status_with(store: &dyn KeyStore, facts: Option<&Facts>) -> LightSyncStatus {
    let (paired, bridge_changed) = match store::load_with(store) {
        Loaded::Paired(saved) => (true, facts.is_some_and(|f| !f.bridge_id.eq_ignore_ascii_case(&saved.bridge_id))),
        Loaded::None | Loaded::Unreadable => (false, false),
    };
    LightSyncStatus { paired, bridge_changed, running: false, starting: false, last_error: None, stopped_hue_sync: false }
}

/// Pairing against a bridge whose facts are known: poll until the link button is pressed, read
/// the app id, save. The saved pair is replaced only when all of it worked.
pub(crate) fn pair_with(store: &dyn KeyStore, facts: &Facts, net: &dyn BridgeNet, tries: u32, wait: &mut dyn FnMut() -> bool) -> Result<(), &'static str> {
    let (username, clientkey) = bridge::pair_poll(net, tries, wait)?;
    let app_id = bridge::read_app_id(net, &username)?;
    let saved = Saved { username, clientkey, app_id, bridge_id: facts.bridge_id.clone() };
    if store::save_with(store, &saved) {
        Ok(())
    } else {
        Err(bridge::FAILED)
    }
}

/// One pairing at a time.
struct PairGuard;

fn pairing() -> &'static AtomicBool {
    static PAIRING: AtomicBool = AtomicBool::new(false);
    &PAIRING
}

impl PairGuard {
    fn take() -> Option<PairGuard> {
        pairing().compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).ok().map(|_| PairGuard)
    }
}

impl Drop for PairGuard {
    fn drop(&mut self) {
        pairing().store(false, Ordering::Release);
    }
}

/// The home app's bridge facts, or None when the base is not set or the home app does not answer.
fn home_facts(app: &tauri::AppHandle) -> Result<Facts, &'static str> {
    let base = crate::wall2_desk::base(app).map_err(|_| bridge::UNREACHABLE)?;
    let token = crate::wall2_desk_token::read_token();
    bridge::read_facts(&bridge::RealFacts, &base, token.as_deref())
}

// Section: the test flash (41-3)

/// What the home app says about the entertainment area and the panels (`/api/desk/office/lightsync`).
#[derive(Debug, PartialEq)]
pub(crate) struct Layout {
    pub area_id: String,
    /// Channel ids in order of their `x`, left to right.
    pub channels: Vec<u8>,
    /// The panels, when the home app knows them.
    pub panels: Option<Vec<nanoleaf::Panel>>,
}

/// The area and the panels from the facts answer. None when there is no usable area.
pub(crate) fn shape_layout(v: &serde_json::Value) -> Option<Layout> {
    let area = v.get("area").filter(|a| a.is_object())?;
    let area_id = area.get("id")?.as_str()?.trim().to_string();
    if !bridge::valid_area_id(&area_id) {
        return None;
    }
    let mut chans: Vec<(u8, f64)> = Vec::new();
    for c in area.get("channels")?.as_array()?.iter().take(20) {
        let id = u8::try_from(c.get("id")?.as_u64()?).ok()?;
        let x = c.get("x")?.as_f64().filter(|x| x.is_finite())?;
        chans.push((id, x));
    }
    if chans.is_empty() {
        return None;
    }
    chans.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    let panels = v.pointer("/panels/layout").and_then(nanoleaf::shape_layout);
    Some(Layout { area_id, channels: chans.into_iter().map(|c| c.0).collect(), panels })
}

/// Everything the test needs, so it can run against fakes.
pub(crate) trait Rig {
    fn layout(&self) -> Result<Layout, &'static str>;
    fn saved(&self) -> Loaded;
    fn area(&self, area_id: &str, action: &str) -> Result<(), &'static str>;
    /// Whether the area streams right now (anyone's stream).
    fn area_active(&self, area_id: &str) -> Result<bool, &'static str>;
    fn open_hue(&self, saved: &Saved) -> Result<Box<dyn Frames + '_>, &'static str>;
    /// Panels into extControl; the answer is where to send frames.
    fn panels_on(&self) -> Result<Box<dyn Frames + '_>, &'static str>;
    /// Ends the panel lease; with `restore` the home app puts the remembered look back.
    fn panels_off(&self, restore: bool);
    /// Extends the panel lease (the home app's lease lasts 90 s).
    fn panels_renew(&self);
    fn pause(&self, ms: u64);
}

/// The final area stop failed, so the Entertainment area may still be active.
pub(crate) const STOP_FAILED: &str = "stop-failed";

const TEST_SECONDS: u64 = 3;
const TEST_HZ: u64 = 50;

/// The test: stop any other streamer, start the area, connect, sweep for 3 s, stop. The Plays
/// always get their sweep; cleanup always runs. When several things fail the word is, in order:
/// `dtls` (a Hue frame did not go out), `stop-failed` (the area is still active), then
/// `panels-unavailable` (a panel link would not open or a panel packet did not go out).
pub(crate) fn run_test(rig: &dyn Rig) -> Result<&'static str, &'static str> {
    let saved = match rig.saved() {
        Loaded::Paired(s) => s,
        _ => return Err("not-paired"),
    };
    let layout = rig.layout()?;
    let area_id = layout.area_id.clone();
    // Another streamer (Hue Sync) would hold the area; ending it first is allowed to fail.
    let _ = rig.area(&area_id, "stop");
    rig.pause(300);
    rig.area(&area_id, "start")?;
    let outcome = flash(rig, &saved, &layout);
    let stopped = rig.area(&area_id, "stop");
    match outcome {
        Err(stream::DTLS) => Err(stream::DTLS),
        _ if stopped.is_err() => Err(STOP_FAILED),
        other => other,
    }
}

fn flash(rig: &dyn Rig, saved: &Saved, layout: &Layout) -> Result<&'static str, &'static str> {
    let mut hue = rig.open_hue(saved)?;
    let mut panels_down = false;
    let mut hue_failed = false;
    let mut panels: Option<Box<dyn Frames + '_>> = None;
    if layout.panels.is_some() {
        match rig.panels_on() {
            Ok(link) => panels = Some(link),
            Err(_) => panels_down = true,
        }
    }
    let total = TEST_SECONDS * TEST_HZ;
    for i in 0..=total {
        let t = i as f64 / total as f64;
        let frame = stream::encode_frame((i % 256) as u8, &layout.area_id, &stream::sweep_frame(&layout.channels, t));
        if !frame.is_some_and(|f| hue.send(&f)) {
            hue_failed = true;
            break;
        }
        // Panels at about 25 Hz: every other tick.
        if i % 2 == 0 {
            if let (Some(link), Some(ps)) = (panels.as_mut(), layout.panels.as_ref()) {
                if let Some(pkt) = nanoleaf::encode_packet(&nanoleaf::ring_frame(ps, t)) {
                    if !link.send(&pkt) {
                        panels_down = true;
                    }
                }
            }
        }
        rig.pause(1000 / TEST_HZ);
    }
    if panels.is_some() || panels_down {
        rig.panels_off(true);
    }
    if hue_failed {
        Err(stream::DTLS)
    } else if panels_down {
        Err(nanoleaf::UNAVAILABLE)
    } else {
        Ok("ok")
    }
}

/// The real rig: Credential Manager, the pinned bridge, the home app and real sockets.
struct RealRig {
    base: String,
    token: Option<String>,
    net: bridge::PinnedNet,
    facts: Facts,
    json: serde_json::Value,
}

impl RealRig {
    fn new(app: &tauri::AppHandle) -> Result<RealRig, &'static str> {
        let base = crate::wall2_desk::base(app).map_err(|_| bridge::UNREACHABLE)?;
        let token = crate::wall2_desk_token::read_token();
        let json = read_lightsync_json(&bridge::RealFacts, &base, token.as_deref())?;
        let facts = bridge::shape_facts(&json).ok_or(bridge::UNREACHABLE)?;
        let net = bridge::PinnedNet::new(facts.ip, &facts.bridge_id).ok_or(bridge::UNREACHABLE)?;
        Ok(RealRig { base, token, net, facts, json })
    }

    fn panels_post(&self, body: &str, secs: u64) -> Result<serde_json::Value, &'static str> {
        let token = self.token.as_deref().filter(|_| crate::wall2_desk::token_may_go_to(&self.base)).ok_or(nanoleaf::UNAVAILABLE)?;
        let agent = ureq::AgentBuilder::new().redirects(0).timeout(std::time::Duration::from_secs(secs)).build();
        let resp = agent
            .post(&format!("{}/api/desk/office/panels/stream", self.base))
            .set("Content-Type", "application/json")
            .set("X-Desk-Token", token)
            .send_string(body)
            .map_err(|_| nanoleaf::UNAVAILABLE)?;
        use std::io::Read;
        let mut buf = Vec::new();
        resp.into_reader().take(64 * 1024).read_to_end(&mut buf).map_err(|_| nanoleaf::UNAVAILABLE)?;
        serde_json::from_slice(&buf).map_err(|_| nanoleaf::UNAVAILABLE)
    }
}

/// The same GET `read_facts` makes, kept whole so the area and panels can be read from it too.
fn read_lightsync_json(http: &dyn bridge::FactsHttp, base: &str, token: Option<&str>) -> Result<serde_json::Value, &'static str> {
    let token = token.filter(|_| crate::wall2_desk::token_may_go_to(base));
    let (code, body) = http.get(&format!("{base}/api/desk/office/lightsync"), token).map_err(|_| bridge::UNREACHABLE)?;
    if !(200..300).contains(&code) {
        return Err(bridge::UNREACHABLE);
    }
    serde_json::from_slice(&body).map_err(|_| bridge::UNREACHABLE)
}

impl Rig for RealRig {
    fn layout(&self) -> Result<Layout, &'static str> {
        shape_layout(&self.json).ok_or("no-area")
    }
    fn saved(&self) -> Loaded {
        match store::load_with(&store::RealStore) {
            Loaded::Paired(s) if s.bridge_id.eq_ignore_ascii_case(&self.facts.bridge_id) => Loaded::Paired(s),
            Loaded::Paired(_) => Loaded::None,
            other => other,
        }
    }
    fn area(&self, area_id: &str, action: &str) -> Result<(), &'static str> {
        match store::load_with(&store::RealStore) {
            Loaded::Paired(s) => bridge::area_action(&self.net, &s.username, area_id, action),
            _ => Err("not-paired"),
        }
    }
    fn area_active(&self, area_id: &str) -> Result<bool, &'static str> {
        match store::load_with(&store::RealStore) {
            Loaded::Paired(s) => bridge::area_active(&self.net, &s.username, area_id),
            _ => Err("not-paired"),
        }
    }
    fn open_hue(&self, saved: &Saved) -> Result<Box<dyn Frames + '_>, &'static str> {
        Ok(Box::new(stream::HueLink::connect(self.facts.ip, &saved.app_id, &saved.clientkey)?))
    }
    fn panels_on(&self) -> Result<Box<dyn Frames + '_>, &'static str> {
        let answer = self.panels_post(&nanoleaf::stream_body(true, false, false), 8)?;
        let (ip, port) = nanoleaf::shape_stream_answer(&answer).ok_or(nanoleaf::UNAVAILABLE)?;
        Ok(Box::new(nanoleaf::PanelLink::open(ip, port)?))
    }
    fn panels_off(&self, restore: bool) {
        let _ = self.panels_post(&nanoleaf::stream_body(false, false, restore), 8);
    }
    fn panels_renew(&self) {
        // Short limit: the Hue stream is paused while this runs and the bridge drops it after about 10 s.
        let _ = self.panels_post(&nanoleaf::stream_body(true, true, false), 2);
    }
    fn pause(&self, ms: u64) {
        std::thread::sleep(std::time::Duration::from_millis(ms));
    }
}

/// One test at a time, and not while pairing.
fn testing() -> &'static AtomicBool {
    static TESTING: AtomicBool = AtomicBool::new(false);
    &TESTING
}

struct TestGuard;

/// Takes the test slot unless a pairing runs or a test already does.
fn test_slot(testing: &AtomicBool, pairing: &AtomicBool) -> bool {
    if pairing.load(Ordering::Acquire) {
        return false;
    }
    testing.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_ok()
}

impl TestGuard {
    fn take() -> Option<TestGuard> {
        test_slot(testing(), pairing()).then_some(TestGuard)
    }
}

impl Drop for TestGuard {
    fn drop(&mut self) {
        testing().store(false, Ordering::Release);
    }
}

// Section: the live stream (41-4)

/// Hue Sync still streams on the area two seconds after the stop.
pub(crate) const HUE_SYNC_STUCK: &str = "hue-sync-would-not-stop";
/// How long a competing stream gets to end, polled every `STOP_POLL_MS`.
const STOP_POLLS: u32 = 10;
const STOP_POLL_MS: u64 = 200;
/// Five minutes of silence ends the sync.
pub(crate) const SILENCE_STOP_MS: f64 = 5.0 * 60.0 * 1000.0;
/// A band byte under this (about -67 dB) is silence.
const SILENT_BYTE: u8 = 8;
/// No new audio frame for this long counts as silence.
const FRAME_STALE_MS: f64 = 500.0;
/// Panel frames go out at about 30 Hz.
const PANEL_EVERY_MS: f64 = 33.0;
/// The panel lease is renewed this often (the home app's lease is 90 s).
const RENEW_EVERY_MS: f64 = 30_000.0;
/// This many failed Hue writes in a row end the sync with `dtls` (about one second at 50 Hz).
const LINK_FAILS: u32 = 50;

/// What `preflight` hands the stream: the live links and what was found on the way.
pub(crate) struct Live<'a> {
    hue: Box<dyn Frames + 'a>,
    panels: Option<Box<dyn Frames + 'a>>,
    /// A panel lease was asked for (it must be released even if the link would not open).
    panels_touched: bool,
    layout: Layout,
    /// Another streamer held the area and was stopped.
    stopped_hue_sync: bool,
    panels_missing: bool,
}

/// The start order: need a pair and an area; stop any other streamer on the area and wait up to 2 s for
/// it to go inactive; start the area; open the Hue link; put the panels in extControl (a missing panel link
/// is a warning, the Plays still run).
pub(crate) fn preflight(rig: &dyn Rig) -> Result<Live<'_>, &'static str> {
    let saved = match rig.saved() {
        Loaded::Paired(s) => s,
        _ => return Err("not-paired"),
    };
    let layout = rig.layout()?;
    let area_id = layout.area_id.clone();
    let stopped_hue_sync = rig.area_active(&area_id)?;
    if stopped_hue_sync {
        let _ = rig.area(&area_id, "stop");
        let mut gone = false;
        for _ in 0..STOP_POLLS {
            rig.pause(STOP_POLL_MS);
            if rig.area_active(&area_id) == Ok(false) {
                gone = true;
                break;
            }
        }
        if !gone {
            return Err(HUE_SYNC_STUCK);
        }
    }
    rig.area(&area_id, "start")?;
    let hue = match rig.open_hue(&saved) {
        Ok(h) => h,
        Err(e) => {
            let _ = rig.area(&area_id, "stop");
            return Err(e);
        }
    };
    let (mut panels, mut panels_touched, mut panels_missing) = (None, false, false);
    if layout.panels.is_some() {
        panels_touched = true;
        match rig.panels_on() {
            Ok(link) => panels = Some(link),
            Err(_) => panels_missing = true,
        }
    }
    Ok(Live { hue, panels, panels_touched, layout, stopped_hue_sync, panels_missing })
}

/// Why the stream ended.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum Ending {
    Stopped,
    Locked,
    Silent,
    LinkLost,
}

/// What the thread shares with the commands: the stop flag, whether to restore the panels, the tuning.
pub(crate) struct Control {
    stop: AtomicBool,
    restore: AtomicBool,
    /// Set when the command gave up waiting for the start: the thread's late ending must keep that error word.
    timed_out: AtomicBool,
    tuning: Mutex<engine::Tuning>,
}

impl Control {
    pub(crate) fn new(t: engine::Tuning) -> Control {
        Control { stop: AtomicBool::new(false), restore: AtomicBool::new(true), timed_out: AtomicBool::new(false), tuning: Mutex::new(t) }
    }
    fn tuning(&self) -> engine::Tuning {
        self.tuning.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
    pub(crate) fn tune(&self, t: engine::Tuning) {
        *self.tuning.lock().unwrap_or_else(|e| e.into_inner()) = t;
    }
}

/// The newest audio frame: its sequence number and the 32 band bytes (empty for silence).
pub(crate) type Latest<'a> = &'a dyn Fn() -> Option<(u64, Vec<u8>)>;

fn is_silent(bands: &[u8]) -> bool {
    bands.iter().all(|b| *b < SILENT_BYTE)
}

/// The stream loop. `now` is a millisecond clock, `locked` says whether Windows is locked, `latest` reads
/// the audio slot. Sends the last frame on through silence; returns why it ended.
pub(crate) fn run_stream(rig: &dyn Rig, live: &mut Live, ctl: &Control, latest: Latest, now: &mut dyn FnMut() -> f64, locked: &dyn Fn() -> bool) -> Ending {
    let mut stats = engine::Stats::new();
    let ending = run_stream_loop(rig, live, ctl, latest, now, locked, &mut stats);
    crate::wall2_window::log("lightsync", &stats.line());
    ending
}

fn run_stream_loop(rig: &dyn Rig, live: &mut Live, ctl: &Control, latest: Latest, now: &mut dyn FnMut() -> f64, locked: &dyn Fn() -> bool, stats: &mut engine::Stats) -> Ending {
    let first = ctl.tuning();
    let mut engine = engine::Engine::new(first.settings.floor);
    let mut detector = beat::BeatDetector::new();
    let plays = live.layout.channels.clone();
    let area_id = live.layout.area_id.clone();
    let panel_list: Vec<nanoleaf::Panel> = live.layout.panels.clone().unwrap_or_default();
    let panel_xy: Vec<(f64, f64)> = panel_list.iter().map(|p| (p.x, p.y)).collect();
    let started = now();
    let (mut last_seq, mut bands, mut last_frame_at, mut last_tick) = (0u64, Vec::<u8>::new(), started, started);
    let (mut last_panel, mut last_renew) = (f64::NEG_INFINITY, started);
    let (mut silent_since, mut sequence, mut fails) = (None::<f64>, 0u8, 0u32);
    loop {
        if ctl.stop.load(Ordering::Acquire) {
            return Ending::Stopped;
        }
        if locked() {
            return Ending::Locked;
        }
        let t = now();
        let tuning = ctl.tuning();
        let mut beat = false;
        if let Some((seq, b)) = latest() {
            if seq != last_seq {
                last_seq = seq;
                bands = b;
                last_frame_at = t;
                beat = detector.push(&beat::unit_bands(&bands)[..beat::BEAT_BANDS], t, t);
            }
        }
        if t - last_frame_at > FRAME_STALE_MS {
            bands.clear();
        }
        let (bass, high) = engine::levels_from_bands(&bands);
        let out = engine.step(&tuning, engine::Input { bass, high, beat, beat_lag_ms: if beat { t - detector.last_beat_at() } else { 0.0 }, dt_ms: t - last_tick }, plays.len(), &panel_xy);
        last_tick = t;
        stats.observe(t, beat, &out.plays, tuning.settings.plays);

        let channels: Vec<stream::Channel> = plays.iter().zip(&out.plays).map(|(id, c)| (*id, [stream::to16(c[0]), stream::to16(c[1]), stream::to16(c[2])])).collect();
        let sent = stream::encode_frame(sequence, &area_id, &channels).is_some_and(|f| live.hue.send(&f));
        sequence = sequence.wrapping_add(1);
        fails = if sent { 0 } else { fails + 1 };
        if fails >= LINK_FAILS {
            return Ending::LinkLost;
        }

        if let Some(link) = live.panels.as_mut() {
            if !out.panels.is_empty() && t - last_panel >= PANEL_EVERY_MS {
                let colours: Vec<nanoleaf::PanelColour> = panel_list.iter().zip(&out.panels).map(|(p, c)| (p.id, *c, 1)).collect();
                if let Some(pkt) = nanoleaf::encode_packet(&colours) {
                    let _ = link.send(&pkt);
                }
                last_panel = t;
            }
            if t - last_renew >= RENEW_EVERY_MS {
                rig.panels_renew();
                last_renew = now();
            }
        }

        if is_silent(&bands) {
            let since = *silent_since.get_or_insert(t);
            if t - since >= SILENCE_STOP_MS {
                return Ending::Silent;
            }
        } else {
            silent_since = None;
        }
        rig.pause((1000.0 / tuning.settings.send_hz) as u64);
    }
}

/// Always runs when the stream ends: close the Hue link, `action: stop` (the bridge puts the Plays back
/// as they were; tried twice), and release the panels. A lock, silence or lost link restores the panels;
/// a stop asks via `ctl.restore`.
pub(crate) fn finish(rig: &dyn Rig, live: Live, ending: Ending, ctl: &Control) {
    let restore = ending != Ending::Stopped || ctl.restore.load(Ordering::Acquire);
    let Live { hue, panels, panels_touched, layout, .. } = live;
    drop(hue);
    drop(panels);
    if rig.area(&layout.area_id, "stop").is_err() {
        rig.pause(300);
        let _ = rig.area(&layout.area_id, "stop");
    }
    if panels_touched {
        rig.panels_off(restore);
    }
}

/// What `status` says about the stream beyond the saved pair.
#[derive(Debug, Default, Clone, PartialEq)]
pub(crate) struct Notes {
    starting: bool,
    last_error: Option<&'static str>,
    stopped_hue_sync: bool,
}

impl Notes {
    fn on_starting(&mut self) {
        *self = Notes { starting: true, ..Notes::default() };
    }
    fn on_started(&mut self, stopped_hue_sync: bool, panels_missing: bool) {
        *self = Notes { starting: false, last_error: panels_missing.then_some(nanoleaf::UNAVAILABLE), stopped_hue_sync };
    }
    fn on_failed(&mut self, word: &'static str) {
        *self = Notes { starting: false, last_error: Some(word), stopped_hue_sync: false };
    }
    fn on_ended(&mut self, ending: Ending) {
        *self = Notes { starting: false, last_error: (ending == Ending::LinkLost).then_some(stream::DTLS), stopped_hue_sync: false };
    }
    /// The thread's own ending. When the start already timed out, `on_failed(UNREACHABLE)` stands.
    fn on_thread_ended(&mut self, ending: Ending, ctl: &Control) {
        if ctl.timed_out.load(Ordering::Acquire) {
            self.on_failed(bridge::UNREACHABLE);
        } else {
            self.on_ended(ending);
        }
    }
}

/// The status answer with the live parts filled in.
pub(crate) fn with_live(mut s: LightSyncStatus, running: bool, n: &Notes) -> LightSyncStatus {
    s.running = running;
    s.starting = n.starting;
    s.last_error = n.last_error.map(str::to_string);
    s.stopped_hue_sync = running && n.stopped_hue_sync;
    s
}

/// The extra step of "stop all sync": `action: stop` on the area whoever streams (this ends Hue Sync).
pub(crate) fn stop_area_for_all(rig: &dyn Rig) -> Result<(), &'static str> {
    let layout = rig.layout()?;
    rig.area(&layout.area_id, "stop")
}

// Section: the slot and the one live session (globals, kept thin)

struct Slot {
    seq: u64,
    bands: Vec<u8>,
}

static SLOT: Mutex<Slot> = Mutex::new(Slot { seq: 0, bands: Vec::new() });
static SYNC_ON: AtomicBool = AtomicBool::new(false);
static NOTES: Mutex<Notes> = Mutex::new(Notes { starting: false, last_error: None, stopped_hue_sync: false });

struct Session {
    ctl: Arc<Control>,
    handle: std::thread::JoinHandle<()>,
}

/// The one live session. `session` is held only for a moment, never across a wait. `starting` is the
/// Control of a start still waiting, so a stop can reach it. `gate` serialises the starts.
struct Host {
    session: Mutex<Option<Session>>,
    starting: Mutex<Option<Arc<Control>>>,
    gate: Mutex<()>,
}

static HOST: Host = Host { session: Mutex::new(None), starting: Mutex::new(None), gate: Mutex::new(()) };

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// True while a sync runs: the capture loop then analyses the audio even when the visualizer is hidden.
pub(crate) fn sync_on() -> bool {
    SYNC_ON.load(Ordering::Acquire)
}

/// From the capture loop, each analysed frame: the 32 band bytes, empty for silence. A single slot, no queue.
pub(crate) fn publish(bands: &[u8]) {
    let mut slot = lock(&SLOT);
    slot.seq = slot.seq.wrapping_add(1);
    slot.bands.clear();
    slot.bands.extend_from_slice(bands);
}

fn latest_frame() -> Option<(u64, Vec<u8>)> {
    let slot = lock(&SLOT);
    Some((slot.seq, slot.bands.clone()))
}

fn os_locked() -> bool {
    #[cfg(windows)]
    {
        crate::display_watch::session_locked()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

struct StartGuard<'a>(&'a Mutex<Notes>);

impl Drop for StartGuard<'_> {
    fn drop(&mut self) {
        lock(self.0).starting = false;
    }
}

/// Streams, and always cleans up: a panic in the loop is caught so `finish` runs and the sync flag
/// resets (a lost link is the ending it reports).
pub(crate) fn stream_and_finish(rig: &dyn Rig, mut live: Live<'_>, ctl: &Control, latest: Latest, now: &mut dyn FnMut() -> f64, locked: &dyn Fn() -> bool, sync: &AtomicBool) -> Ending {
    sync.store(true, Ordering::Release);
    let ending = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run_stream(rig, &mut live, ctl, latest, now, locked))).unwrap_or(Ending::LinkLost);
    sync.store(false, Ordering::Release);
    finish(rig, live, ending, ctl);
    ending
}

/// The thread: build the rig, run the start order, tell the command how it went, then stream until told to
/// stop (or until the stream ends itself), and always clean up.
fn session_thread(app: tauri::AppHandle, ctl: Arc<Control>, tx: std::sync::mpsc::Sender<Result<(bool, bool), &'static str>>) {
    let rig = match RealRig::new(&app) {
        Ok(r) => r,
        Err(e) => {
            let _ = tx.send(Err(e));
            return;
        }
    };
    let live = match preflight(&rig) {
        Ok(l) => l,
        Err(e) => {
            let _ = tx.send(Err(e));
            return;
        }
    };
    let _ = tx.send(Ok((live.stopped_hue_sync, live.panels_missing)));
    let clock = std::time::Instant::now();
    let ending = stream_and_finish(&rig, live, &ctl, &latest_frame, &mut || clock.elapsed().as_secs_f64() * 1000.0, &os_locked, &SYNC_ON);
    lock(&NOTES).on_thread_ended(ending, &ctl);
}

type Started = Result<(bool, bool), &'static str>;

enum Waited {
    Got(Started),
    Cancelled,
    TimedOut,
    Died,
}

/// The start, without the app: `spawn` runs the session thread. Holds no session lock while it waits,
/// and a stop that reaches `starting` ends the wait within 50 ms.
fn start_core(host: &Host, notes: &Mutex<Notes>, sync: &AtomicBool, tuning: engine::Tuning, wait: std::time::Duration, spawn: impl FnOnce(Arc<Control>, std::sync::mpsc::Sender<Started>) -> std::thread::JoinHandle<()>) -> Result<&'static str, &'static str> {
    let _gate = lock(&host.gate);
    if let Some(s) = lock(&host.session).as_ref() {
        if sync.load(Ordering::Acquire) && !s.handle.is_finished() {
            s.ctl.tune(tuning);
            return Ok("running");
        }
    }
    let old = lock(&host.session).take();
    if let Some(old) = old {
        let _ = old.handle.join();
    }
    lock(notes).on_starting();
    let _guard = StartGuard(notes);
    let ctl = Arc::new(Control::new(tuning));
    *lock(&host.starting) = Some(ctl.clone());
    let (tx, rx) = std::sync::mpsc::channel();
    let handle = spawn(ctl.clone(), tx);
    let deadline = std::time::Instant::now() + wait;
    let waited = loop {
        if ctl.stop.load(Ordering::Acquire) {
            break Waited::Cancelled;
        }
        let left = deadline.saturating_duration_since(std::time::Instant::now());
        if left.is_zero() {
            break Waited::TimedOut;
        }
        match rx.recv_timeout(left.min(std::time::Duration::from_millis(50))) {
            Ok(r) => break Waited::Got(r),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break Waited::Died,
        }
    };
    *lock(&host.starting) = None;
    match waited {
        Waited::Got(Ok((stopped, panels_missing))) => {
            if ctl.stop.load(Ordering::Acquire) {
                // A stop landed as the start finished: the thread ends itself; keep it to be joined.
                lock(notes).on_ended(Ending::Stopped);
                *lock(&host.session) = Some(Session { ctl, handle });
                return Ok("stopped");
            }
            lock(notes).on_started(stopped, panels_missing);
            *lock(&host.session) = Some(Session { ctl, handle });
            Ok("running")
        }
        Waited::Got(Err(word)) => {
            let _ = handle.join();
            lock(notes).on_failed(word);
            Err(word)
        }
        Waited::Died => {
            let _ = handle.join();
            lock(notes).on_failed(bridge::UNREACHABLE);
            Err(bridge::UNREACHABLE)
        }
        Waited::Cancelled => {
            // The stop flag is set: the thread cleans up as soon as it gets past its start order.
            lock(notes).on_ended(Ending::Stopped);
            *lock(&host.session) = Some(Session { ctl, handle });
            Ok("stopped")
        }
        Waited::TimedOut => {
            ctl.timed_out.store(true, Ordering::Release);
            ctl.stop.store(true, Ordering::Release);
            lock(notes).on_failed(bridge::UNREACHABLE);
            *lock(&host.session) = Some(Session { ctl, handle });
            Err(bridge::UNREACHABLE)
        }
    }
}

fn start_session(app: &tauri::AppHandle, t: &engine::TuneIn) -> Result<&'static str, &'static str> {
    let tuning = engine::Tuning::from_in(t)?;
    if pairing().load(Ordering::Acquire) || testing().load(Ordering::Acquire) {
        return Err(bridge::BUSY);
    }
    let app = app.clone();
    start_core(&HOST, &NOTES, &SYNC_ON, tuning, std::time::Duration::from_secs(30), move |ctl, tx| std::thread::spawn(move || session_thread(app, ctl, tx)))
}

fn tune_session(t: &engine::TuneIn) -> Result<(), &'static str> {
    let tuning = engine::Tuning::from_in(t)?;
    if let Some(s) = lock(&HOST.session).as_ref() {
        s.ctl.tune(tuning.clone());
    }
    if let Some(c) = lock(&HOST.starting).as_ref() {
        c.tune(tuning);
    }
    Ok(())
}

/// Ends the stream and waits for its cleanup. Safe when nothing runs. A start still waiting is told to
/// stop and cleans up on its own thread; this does not wait for it.
fn stop_session(restore_panels: bool) {
    stop_in(&HOST, &NOTES, restore_panels);
}

fn stop_in(host: &Host, notes: &Mutex<Notes>, restore_panels: bool) {
    if let Some(c) = lock(&host.starting).as_ref() {
        c.restore.store(restore_panels, Ordering::Release);
        c.stop.store(true, Ordering::Release);
    }
    let taken = lock(&host.session).take();
    if let Some(s) = taken {
        s.ctl.restore.store(restore_panels, Ordering::Release);
        s.ctl.stop.store(true, Ordering::Release);
        let _ = s.handle.join();
    }
    lock(notes).on_ended(Ending::Stopped);
}

/// A lock that is only ever held for a moment: try for up to `max`, then give up.
fn try_lock_for<'a, T>(m: &'a Mutex<T>, max: std::time::Duration) -> Option<std::sync::MutexGuard<'a, T>> {
    let until = std::time::Instant::now() + max;
    loop {
        match m.try_lock() {
            Ok(g) => return Some(g),
            Err(std::sync::TryLockError::Poisoned(e)) => return Some(e.into_inner()),
            Err(std::sync::TryLockError::WouldBlock) => {
                if std::time::Instant::now() >= until {
                    return None;
                }
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
        }
    }
}

/// App exit, best effort and never blocking on a lock: set the stop flags, then give the cleanup three seconds.
pub(crate) fn shutdown() {
    shutdown_in(&HOST, std::time::Duration::from_secs(3));
}

fn shutdown_in(host: &Host, grace: std::time::Duration) {
    if let Some(g) = try_lock_for(&host.starting, std::time::Duration::from_millis(200)) {
        if let Some(c) = g.as_ref() {
            c.stop.store(true, Ordering::Release);
        }
    }
    let Some(mut g) = try_lock_for(&host.session, std::time::Duration::from_millis(200)) else {
        return;
    };
    let taken = g.take();
    drop(g);
    if let Some(s) = taken {
        s.ctl.stop.store(true, Ordering::Release);
        let until = std::time::Instant::now() + grace;
        while !s.handle.is_finished() && std::time::Instant::now() < until {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }
}

// Section: commands (wall2 window only; blocking work off the async thread)

#[tauri::command]
pub async fn wall2_lightsync_status(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<LightSyncStatus, String> {
    crate::wall2_meet::require_wall2(window.label())?;
    crate::wall2_desk::off_thread(move || {
        let store = store::RealStore;
        // The home app is asked only when a pair is saved: that is the one case the answer matters.
        let facts = match store::load_with(&store) {
            Loaded::Paired(_) => home_facts(&app).ok(),
            _ => None,
        };
        Ok(with_live(status_with(&store, facts.as_ref()), sync_on(), &lock(&NOTES)))
    })
    .await
}

#[tauri::command]
pub async fn wall2_lightsync_pair(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<String, String> {
    crate::wall2_meet::require_wall2(window.label())?;
    crate::wall2_desk::off_thread(move || {
        let Some(_guard) = PairGuard::take() else { return Err(bridge::BUSY.to_string()) };
        let facts = home_facts(&app).map_err(str::to_string)?;
        let net = bridge::PinnedNet::new(facts.ip, &facts.bridge_id).ok_or_else(|| bridge::UNREACHABLE.to_string())?;
        pair_with(&store::RealStore, &facts, &net, bridge::POLL_TRIES, &mut {
            let deadline = std::time::Instant::now() + bridge::POLL_DEADLINE;
            move || {
                let left = deadline.saturating_duration_since(std::time::Instant::now());
                if left.is_zero() { return false }
                std::thread::sleep(left.min(bridge::POLL_EVERY));
                true
            }
        }).map_err(str::to_string)?;
        Ok("paired".to_string())
    })
    .await
}

#[tauri::command]
pub async fn wall2_lightsync_forget(window: tauri::WebviewWindow) -> Result<(), String> {
    crate::wall2_meet::require_wall2(window.label())?;
    crate::wall2_desk::off_thread(|| {
        if store::forget_with(&store::RealStore) {
            Ok(())
        } else {
            Err(bridge::FAILED.to_string())
        }
    })
    .await
}

#[tauri::command]
pub async fn wall2_lightsync_test(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<String, String> {
    crate::wall2_meet::require_wall2(window.label())?;
    crate::wall2_desk::off_thread(move || {
        if sync_on() {
            return Err(bridge::BUSY.to_string());
        }
        let Some(_guard) = TestGuard::take() else { return Err(bridge::BUSY.to_string()) };
        let rig = RealRig::new(&app).map_err(str::to_string)?;
        run_test(&rig).map(str::to_string).map_err(str::to_string)
    })
    .await
}

#[tauri::command]
pub async fn wall2_lightsync_start(window: tauri::WebviewWindow, app: tauri::AppHandle, palette: engine::PaletteIn, settings: engine::SettingsIn) -> Result<String, String> {
    crate::wall2_meet::require_wall2(window.label())?;
    crate::wall2_desk::off_thread(move || start_session(&app, &engine::TuneIn { palette, settings }).map(str::to_string).map_err(str::to_string)).await
}

#[tauri::command]
pub async fn wall2_lightsync_tune(window: tauri::WebviewWindow, palette: engine::PaletteIn, settings: engine::SettingsIn) -> Result<(), String> {
    crate::wall2_meet::require_wall2(window.label())?;
    crate::wall2_desk::off_thread(move || tune_session(&engine::TuneIn { palette, settings }).map_err(str::to_string)).await
}

#[tauri::command]
pub async fn wall2_lightsync_stop(window: tauri::WebviewWindow, restore_panels: Option<bool>) -> Result<(), String> {
    crate::wall2_meet::require_wall2(window.label())?;
    crate::wall2_desk::off_thread(move || {
        stop_session(restore_panels.unwrap_or(true));
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn wall2_lightsync_stop_all(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    crate::wall2_meet::require_wall2(window.label())?;
    crate::wall2_desk::off_thread(move || {
        stop_session(true);
        let rig = RealRig::new(&app).map_err(str::to_string)?;
        stop_area_for_all(&rig).map_err(str::to_string)
    })
    .await
}

#[tauri::command]
pub async fn wall2_huesync_open(window: tauri::WebviewWindow) -> Result<String, String> {
    crate::wall2_meet::require_wall2(window.label())?;
    crate::wall2_desk::off_thread(|| {
        stop_session(false);
        huesync::open_with(&huesync::PowerShell).map(str::to_string).map_err(str::to_string)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wall2_meet::store::Fetch;
    use store::tests::{sample, Fake};

    fn facts(id: &str) -> Facts {
        Facts { ip: "192.168.1.20".parse().unwrap(), bridge_id: id.to_string() }
    }

    #[test]
    fn status_not_paired() {
        let s = status_with(&Fake::default(), Some(&facts("001788FFFE123456")));
        assert_eq!((s.paired, s.bridge_changed), (false, false));
    }

    #[test]
    fn status_paired_and_same_bridge() {
        let f = Fake::default();
        store::save_with(&f, &sample());
        let s = status_with(&f, Some(&facts("001788fffe123456")));
        assert_eq!((s.paired, s.bridge_changed), (true, false));
        assert_eq!(status_with(&f, None).bridge_changed, false, "home app silent");
    }

    #[test]
    fn status_bridge_changed_when_the_home_app_names_another_bridge() {
        let f = Fake::default();
        store::save_with(&f, &sample());
        let s = status_with(&f, Some(&facts("001788FFFE999999")));
        assert_eq!((s.paired, s.bridge_changed), (true, true));
    }

    #[test]
    fn status_unreadable_value_is_not_paired() {
        let f = Fake::default();
        *f.value.borrow_mut() = Some("garbage".to_string());
        assert!(!status_with(&f, None).paired);
    }

    #[test]
    fn status_answer_carries_no_key_or_address() {
        let f = Fake::default();
        store::save_with(&f, &sample());
        let text = serde_json::to_string(&status_with(&f, Some(&facts("001788FFFE123456")))).unwrap();
        assert!(!text.contains("secret") && !text.contains("0123456789ABCDEF") && !text.contains("192.168"));
        for key in ["paired", "bridgeChanged", "running", "starting", "lastError", "stoppedHueSync"] {
            assert!(text.contains(key), "{key}");
        }
    }

    struct Script(std::cell::RefCell<std::collections::VecDeque<Result<bridge::Reply, bridge::NetFail>>>);

    impl BridgeNet for Script {
        fn send(&self, _m: &str, _p: &str, _k: Option<&str>, _b: Option<&str>) -> Result<bridge::Reply, bridge::NetFail> {
            self.0.borrow_mut().pop_front().unwrap_or(Err(bridge::NetFail::Down))
        }
    }

    fn reply(body: &str, app_id: Option<&str>) -> Result<bridge::Reply, bridge::NetFail> {
        Ok(bridge::Reply { code: 200, body: body.as_bytes().to_vec(), app_id: app_id.map(Into::into) })
    }

    const SUCCESS: &str = r#"[{"success":{"username":"user-secret-1","clientkey":"CLIENTKEY-SECRET-1"}}]"#;
    const NOT_PRESSED: &str = r#"[{"error":{"type":101}}]"#;

    #[test]
    fn pair_saves_the_pair_with_the_bridge_id() {
        let f = Fake::default();
        let net = Script(std::cell::RefCell::new(vec![reply(NOT_PRESSED, None), reply(SUCCESS, None), reply("", Some("app-id-1"))].into()));
        assert_eq!(pair_with(&f, &facts("001788FFFE123456"), &net, 4, &mut || true), Ok(()));
        match store::load_with(&f) {
            Loaded::Paired(s) => {
                assert_eq!((s.username.as_str(), s.clientkey.as_str(), s.app_id.as_str()), ("user-secret-1", "CLIENTKEY-SECRET-1", "app-id-1"));
                assert_eq!(s.bridge_id, "001788FFFE123456");
            }
            other => panic!("not paired: {other:?}"),
        }
    }

    #[test]
    fn pair_without_a_button_press_saves_nothing() {
        let f = Fake::default();
        let net = Script(std::cell::RefCell::new((0..4).map(|_| reply(NOT_PRESSED, None)).collect()));
        assert_eq!(pair_with(&f, &facts("001788FFFE123456"), &net, 4, &mut || true), Err(bridge::LINK_NOT_PRESSED));
        assert!(matches!(f.load(), Fetch::Missing));
    }

    #[test]
    fn pair_keeps_the_old_pair_when_the_app_id_fails() {
        let f = Fake::default();
        store::save_with(&f, &sample());
        let before = f.value.borrow().clone();
        let net = Script(std::cell::RefCell::new(vec![reply(SUCCESS, None), reply("", None)].into()));
        assert!(pair_with(&f, &facts("001788FFFE123456"), &net, 4, &mut || true).is_err());
        assert_eq!(*f.value.borrow(), before);
    }

    #[test]
    fn pair_reports_a_failed_save() {
        let f = Fake::default();
        f.write_fails.set(true);
        let net = Script(std::cell::RefCell::new(vec![reply(SUCCESS, None), reply("", Some("app-id-1"))].into()));
        assert_eq!(pair_with(&f, &facts("001788FFFE123456"), &net, 4, &mut || true), Err(bridge::FAILED));
    }

    #[test]
    fn pairing_runs_one_at_a_time() {
        let first = PairGuard::take().expect("free");
        assert!(PairGuard::take().is_none());
        drop(first);
        assert!(PairGuard::take().is_some());
    }

    // Section: the test flash

    const AREA: &str = "0a1b2c3d-0000-4000-8000-123456789abc";

    #[derive(Default)]
    struct Log {
        events: std::cell::RefCell<Vec<String>>,
        hue_frames: std::cell::RefCell<Vec<Vec<u8>>>,
        panel_frames: std::cell::RefCell<Vec<Vec<u8>>>,
    }

    struct Sink<'a>(&'a Log, bool, bool);

    impl Frames for Sink<'_> {
        fn send(&mut self, bytes: &[u8]) -> bool {
            if self.2 {
                return false;
            }
            if self.1 { self.0.hue_frames.borrow_mut().push(bytes.to_vec()) } else { self.0.panel_frames.borrow_mut().push(bytes.to_vec()) }
            true
        }
    }

    struct FakeRig<'a> {
        log: &'a Log,
        store: Fake,
        layout: Result<Layout, &'static str>,
        start_fails: bool,
        dtls_fails: bool,
        panels_fail: bool,
        hue_send_fails: bool,
        panel_send_fails: bool,
        stop_fails: bool,
        /// Another streamer (Hue Sync) holds the area until a stop reaches it.
        active: std::cell::Cell<bool>,
        /// A streamer that ignores `stop`.
        stubborn: bool,
        paused: std::cell::Cell<u64>,
    }

    impl<'a> FakeRig<'a> {
        fn new(log: &'a Log, with_panels: bool) -> FakeRig<'a> {
            let store = Fake::default();
            store::save_with(&store, &sample());
            let panels = with_panels.then(|| vec![nanoleaf::Panel { id: 5, x: 0.0, y: 0.0 }, nanoleaf::Panel { id: 6, x: 50.0, y: 0.0 }]);
            FakeRig { log, store, layout: Ok(Layout { area_id: AREA.to_string(), channels: vec![3, 1, 2, 0], panels }), start_fails: false, dtls_fails: false, panels_fail: false, hue_send_fails: false, panel_send_fails: false, stop_fails: false, active: std::cell::Cell::new(false), stubborn: false, paused: std::cell::Cell::new(0) }
        }
        fn note(&self, e: &str) {
            self.log.events.borrow_mut().push(e.to_string());
        }
    }

    impl Rig for FakeRig<'_> {
        fn layout(&self) -> Result<Layout, &'static str> {
            match &self.layout {
                Ok(l) => Ok(Layout { area_id: l.area_id.clone(), channels: l.channels.clone(), panels: l.panels.clone() }),
                Err(e) => Err(e),
            }
        }
        fn saved(&self) -> Loaded {
            store::load_with(&self.store)
        }
        fn area(&self, _id: &str, action: &str) -> Result<(), &'static str> {
            self.note(&format!("area:{action}"));
            match action {
                "start" => self.active.set(true),
                "stop" if !self.stubborn => self.active.set(false),
                _ => {}
            }
            if (action == "start" && self.start_fails) || (action == "stop" && self.stop_fails) { Err(bridge::FAILED) } else { Ok(()) }
        }
        fn open_hue(&self, _s: &Saved) -> Result<Box<dyn Frames + '_>, &'static str> {
            self.note("hue:open");
            if self.dtls_fails { Err(stream::DTLS) } else { Ok(Box::new(Sink(self.log, true, self.hue_send_fails))) }
        }
        fn panels_on(&self) -> Result<Box<dyn Frames + '_>, &'static str> {
            self.note("panels:on");
            if self.panels_fail { Err(nanoleaf::UNAVAILABLE) } else { Ok(Box::new(Sink(self.log, false, self.panel_send_fails))) }
        }
        fn area_active(&self, _id: &str) -> Result<bool, &'static str> {
            Ok(self.active.get())
        }
        fn panels_off(&self, restore: bool) {
            self.note(if restore { "panels:off" } else { "panels:off:keep" });
        }
        fn panels_renew(&self) {
            self.note("panels:renew");
        }
        fn pause(&self, ms: u64) {
            self.paused.set(self.paused.get() + ms);
        }
    }

    #[test]
    fn test_flash_runs_in_order_and_ends_with_stop() {
        let log = Log::default();
        let rig = FakeRig::new(&log, true);
        assert_eq!(run_test(&rig), Ok("ok"));
        assert_eq!(*log.events.borrow(), vec!["area:stop", "area:start", "hue:open", "panels:on", "panels:off", "area:stop"]);
        let hue = log.hue_frames.borrow();
        assert_eq!(hue.len(), 151);
        assert_eq!(hue[0].len(), stream::HEADER_LEN + 4 * 7);
        assert_eq!(&hue[0][..9], b"HueStream");
        assert_eq!(hue[0][11], 0);
        assert_eq!(hue[150][11], 150);
        assert_eq!(hue[0][stream::HEADER_LEN], 3, "first channel by x");
        assert!(!log.panel_frames.borrow().is_empty());
        assert_eq!(&log.panel_frames.borrow()[0][..2], &[0, 2]);
    }

    #[test]
    fn test_flash_without_panels_skips_them() {
        let log = Log::default();
        assert_eq!(run_test(&FakeRig::new(&log, false)), Ok("ok"));
        assert!(!log.events.borrow().iter().any(|e| e.starts_with("panels")));
    }

    #[test]
    fn test_flash_needs_a_pair() {
        let log = Log::default();
        let rig = FakeRig::new(&log, true);
        rig.store.delete();
        assert_eq!(run_test(&rig), Err("not-paired"));
        assert!(log.events.borrow().is_empty());
    }

    #[test]
    fn test_flash_without_an_area_says_so() {
        let log = Log::default();
        let mut rig = FakeRig::new(&log, true);
        rig.layout = Err("no-area");
        assert_eq!(run_test(&rig), Err("no-area"));
        assert!(!log.events.borrow().iter().any(|e| e == "area:start"));
    }

    #[test]
    fn test_flash_stops_the_area_when_the_handshake_fails() {
        let log = Log::default();
        let mut rig = FakeRig::new(&log, true);
        rig.dtls_fails = true;
        assert_eq!(run_test(&rig), Err("dtls"));
        assert_eq!(log.events.borrow().last().map(String::as_str), Some("area:stop"));
        assert!(log.hue_frames.borrow().is_empty());
    }

    #[test]
    fn test_flash_does_not_connect_when_the_area_will_not_start() {
        let log = Log::default();
        let mut rig = FakeRig::new(&log, true);
        rig.start_fails = true;
        assert_eq!(run_test(&rig), Err(bridge::FAILED));
        assert!(!log.events.borrow().iter().any(|e| e == "hue:open"));
    }

    #[test]
    fn test_flash_runs_the_plays_even_when_panels_are_down() {
        let log = Log::default();
        let mut rig = FakeRig::new(&log, true);
        rig.panels_fail = true;
        assert_eq!(run_test(&rig), Err(nanoleaf::UNAVAILABLE));
        assert_eq!(log.hue_frames.borrow().len(), 151);
        assert!(log.events.borrow().iter().any(|e| e == "panels:off"));
    }

    #[test]
    fn test_flash_reports_a_failed_hue_write_and_still_cleans_up() {
        let log = Log::default();
        let mut rig = FakeRig::new(&log, true);
        rig.hue_send_fails = true;
        assert_eq!(run_test(&rig), Err("dtls"));
        let events = log.events.borrow();
        assert!(events.iter().any(|e| e == "panels:off"));
        assert_eq!(events.last().map(String::as_str), Some("area:stop"));
    }

    #[test]
    fn test_flash_reports_a_failed_final_stop() {
        let log = Log::default();
        let mut rig = FakeRig::new(&log, true);
        rig.stop_fails = true;
        assert_eq!(run_test(&rig), Err(STOP_FAILED));
        let events = log.events.borrow();
        assert!(events.iter().any(|e| e == "panels:off"));
        assert_eq!(events.last().map(String::as_str), Some("area:stop"));
        assert_eq!(log.hue_frames.borrow().len(), 151);
    }

    #[test]
    fn test_flash_reports_a_failed_panel_write_after_the_full_sweep() {
        let log = Log::default();
        let mut rig = FakeRig::new(&log, true);
        rig.panel_send_fails = true;
        assert_eq!(run_test(&rig), Err(nanoleaf::UNAVAILABLE));
        assert_eq!(log.hue_frames.borrow().len(), 151);
        let events = log.events.borrow();
        assert!(events.iter().any(|e| e == "panels:off"));
        assert_eq!(events.last().map(String::as_str), Some("area:stop"));
    }

    #[test]
    fn test_flash_failure_words_rank_dtls_then_stop_then_panels() {
        let log = Log::default();
        let mut rig = FakeRig::new(&log, true);
        rig.stop_fails = true;
        rig.panel_send_fails = true;
        assert_eq!(run_test(&rig), Err(STOP_FAILED));
        rig.hue_send_fails = true;
        assert_eq!(run_test(&rig), Err("dtls"));
    }

    #[test]
    fn layout_orders_channels_by_x_and_reads_panels() {
        let v = serde_json::json!({
            "ok": true,
            "area": { "id": AREA, "name": "Gaming Desk", "channels": [
                { "id": 0, "x": 0.5, "y": 0 }, { "id": 1, "x": -0.5, "y": 0 }, { "id": 2, "x": 0.9, "y": 0 }, { "id": 3, "x": -0.9, "y": 0 } ] },
            "panels": { "ip": "192.168.1.30", "layout": [ { "id": 5, "x": 0, "y": 0 } ] }
        });
        let l = shape_layout(&v).unwrap();
        assert_eq!(l.channels, vec![3, 1, 0, 2]);
        assert_eq!(l.panels.unwrap()[0].id, 5);
    }

    #[test]
    fn layout_refuses_a_missing_or_odd_area() {
        assert!(shape_layout(&serde_json::json!({ "area": null })).is_none());
        assert!(shape_layout(&serde_json::json!({ "area": { "id": "short", "channels": [{ "id": 0, "x": 0 }] } })).is_none());
        assert!(shape_layout(&serde_json::json!({ "area": { "id": AREA, "channels": [] } })).is_none());
        assert!(shape_layout(&serde_json::json!({ "area": { "id": AREA, "channels": [{ "id": 300, "x": 0 }] } })).is_none());
        let no_panels = shape_layout(&serde_json::json!({ "area": { "id": AREA, "channels": [{ "id": 0, "x": 0 }] }, "panels": null })).unwrap();
        assert!(no_panels.panels.is_none());
    }

    /// No answer or error word of the test carries a key, an identity or an address.
    #[test]
    fn test_words_carry_no_secret() {
        let log = Log::default();
        let mut words = Vec::new();
        for variant in 0..5 {
            let mut rig = FakeRig::new(&log, true);
            match variant {
                0 => rig.dtls_fails = true,
                1 => rig.start_fails = true,
                2 => rig.panels_fail = true,
                3 => rig.stop_fails = true,
                _ => rig.layout = Err("no-area"),
            }
            words.push(run_test(&rig).unwrap_err().to_string());
        }
        words.push(run_test(&FakeRig::new(&log, true)).unwrap().to_string());
        let secrets = ["secret", "0123456789ABCDEF", "192.168", "user-secret", "app-id"];
        for w in &words {
            for s in secrets {
                assert!(!w.to_lowercase().contains(&s.to_lowercase()), "{w}");
            }
            assert!(w.len() <= 20 && w.chars().all(|c| c.is_ascii_lowercase() || c == '-'), "{w}");
        }
        for w in [bridge::FAILED, bridge::UNREACHABLE, bridge::CERT, bridge::BUSY, stream::DTLS, nanoleaf::UNAVAILABLE, STOP_FAILED] {
            assert!(w.chars().all(|c| c.is_ascii_lowercase() || c == '-'));
        }
    }

    #[test]
    fn testing_refuses_while_pairing_runs() {
        let testing = AtomicBool::new(false);
        let pairing = AtomicBool::new(true);
        assert!(!test_slot(&testing, &pairing));
        assert!(!testing.load(Ordering::Acquire));
        pairing.store(false, Ordering::Release);
        assert!(test_slot(&testing, &pairing));
        assert!(!test_slot(&testing, &pairing));
    }

    #[test]
    fn testing_runs_one_at_a_time() {
        // Local flags, so the pairing tests holding the global flag never race this one.
        let testing = AtomicBool::new(false);
        let pairing = AtomicBool::new(false);
        assert!(test_slot(&testing, &pairing));
        assert!(!test_slot(&testing, &pairing));
        testing.store(false, Ordering::Release);
        assert!(test_slot(&testing, &pairing));
    }

    // Section: the live stream (41-4)

    fn events(log: &Log) -> Vec<String> {
        log.events.borrow().clone()
    }

    fn tuning() -> engine::Tuning {
        engine::Tuning::from_in(&engine::TuneIn {
            palette: engine::PaletteIn { colors: vec!["#ff00aa".into(), "#35e6ea".into()], kick: "#ffffff".into(), rest: "#301060".into() },
            settings: engine::SettingsIn::default(),
        })
        .unwrap()
    }

    fn loud() -> Vec<u8> {
        vec![255; 32]
    }

    /// Runs the stream for `ticks` ticks of `step_ms` each (the clock moves on every read), then stops it.
    fn stream_for(rig: &FakeRig, ticks: u32, step_ms: f64, bands: Vec<u8>, fresh_frames: bool) -> (Ending, Control) {
        let mut live = preflight(rig).unwrap();
        let ctl = Control::new(tuning());
        let calls = std::cell::Cell::new(0u32);
        let seq = std::cell::Cell::new(0u64);
        let latest = || {
            if fresh_frames {
                seq.set(seq.get() + 1);
            }
            Some((seq.get(), bands.clone()))
        };
        let mut now = || {
            calls.set(calls.get() + 1);
            if calls.get() > ticks {
                ctl.stop.store(true, Ordering::Release);
            }
            f64::from(calls.get()) * step_ms
        };
        let ending = run_stream(rig, &mut live, &ctl, &latest, &mut now, &|| false);
        finish(rig, live, ending, &ctl);
        (ending, ctl)
    }

    #[test]
    fn start_stops_another_streamer_before_it_starts_the_area() {
        let log = Log::default();
        let rig = FakeRig::new(&log, true);
        rig.active.set(true);
        let live = preflight(&rig).unwrap();
        assert!(live.stopped_hue_sync && !live.panels_missing);
        assert_eq!(events(&log), ["area:stop", "area:start", "hue:open", "panels:on"]);
    }

    #[test]
    fn start_without_another_streamer_does_not_send_a_stop() {
        let log = Log::default();
        let rig = FakeRig::new(&log, true);
        let live = preflight(&rig).unwrap();
        assert!(!live.stopped_hue_sync);
        assert_eq!(events(&log), ["area:start", "hue:open", "panels:on"]);
    }

    #[test]
    fn a_streamer_that_will_not_stop_is_given_two_seconds_then_named() {
        let log = Log::default();
        let mut rig = FakeRig::new(&log, true);
        rig.active.set(true);
        rig.stubborn = true;
        assert_eq!(preflight(&rig).err(), Some(HUE_SYNC_STUCK));
        assert_eq!(rig.paused.get(), 2000);
        assert_eq!(events(&log), ["area:stop"], "the area is never started and no link is opened");
    }

    #[test]
    fn start_needs_a_pair_and_an_area() {
        let log = Log::default();
        let rig = FakeRig::new(&log, true);
        *rig.store.value.borrow_mut() = None;
        assert_eq!(preflight(&rig).err(), Some("not-paired"));
        let mut rig = FakeRig::new(&log, true);
        rig.layout = Err("no-area");
        assert_eq!(preflight(&rig).err(), Some("no-area"));
        assert!(events(&log).is_empty());
    }

    #[test]
    fn start_ends_the_area_again_when_the_handshake_fails() {
        let log = Log::default();
        let mut rig = FakeRig::new(&log, true);
        rig.dtls_fails = true;
        assert_eq!(preflight(&rig).err(), Some("dtls"));
        assert_eq!(events(&log), ["area:start", "hue:open", "area:stop"]);
    }

    #[test]
    fn missing_panels_are_a_warning_and_the_plays_still_run() {
        let log = Log::default();
        let mut rig = FakeRig::new(&log, true);
        rig.panels_fail = true;
        let live = preflight(&rig).unwrap();
        assert!(live.panels_missing && live.panels.is_none());
        let mut notes = Notes::default();
        notes.on_started(false, true);
        assert_eq!(notes.last_error, Some("panels-unavailable"));
        let (ending, _) = stream_for(&rig, 5, 20.0, loud(), true);
        assert_eq!(ending, Ending::Stopped);
        assert!(!log.hue_frames.borrow().is_empty() && log.panel_frames.borrow().is_empty());
        assert!(events(&log).iter().any(|e| e == "panels:off"), "a lease that was asked for is released");
    }

    #[test]
    fn the_stream_sends_hue_frames_in_x_order_and_panel_frames_at_half_rate() {
        let log = Log::default();
        let rig = FakeRig::new(&log, true);
        let (ending, _) = stream_for(&rig, 40, 20.0, loud(), true);
        assert_eq!(ending, Ending::Stopped);
        let hue = log.hue_frames.borrow();
        assert_eq!(hue.len(), 40);
        for (i, f) in hue.iter().enumerate() {
            assert_eq!(&f[..9], b"HueStream");
            assert_eq!(f[11], i as u8, "sequence counts up");
            assert_eq!(f.len(), stream::HEADER_LEN + 4 * 7);
            let ids: Vec<u8> = (0..4).map(|c| f[stream::HEADER_LEN + c * 7]).collect();
            assert_eq!(ids, vec![3, 1, 2, 0], "channels in order of x");
        }
        let panels = log.panel_frames.borrow();
        assert!(panels.len() >= 15 && panels.len() <= 25, "about 30 Hz of a 50 Hz tick: {}", panels.len());
        assert_eq!(panels[0].len(), 2 + 2 * 8);
        // Loud music lifts the Plays clearly above what silence shows (the floor).
        let silent_log = Log::default();
        let silent_rig = FakeRig::new(&silent_log, true);
        let _ = stream_for(&silent_rig, 40, 20.0, Vec::new(), false);
        let level = |f: &Vec<u8>| f[stream::HEADER_LEN + 1..stream::HEADER_LEN + 7].iter().step_by(2).map(|b| u32::from(*b)).sum::<u32>();
        let silent = level(&silent_log.hue_frames.borrow()[39]);
        assert!(level(&hue[39]) > silent + 15, "loud {} vs silent {silent}", level(&hue[39]));
    }

    #[test]
    fn the_stream_keeps_sending_through_silence() {
        let log = Log::default();
        let rig = FakeRig::new(&log, false);
        let (ending, _) = stream_for(&rig, 60, 20.0, Vec::new(), false);
        assert_eq!(ending, Ending::Stopped);
        assert_eq!(log.hue_frames.borrow().len(), 60);
    }

    #[test]
    fn stop_sends_the_area_stop_then_releases_the_panels_with_or_without_restore() {
        let log = Log::default();
        let rig = FakeRig::new(&log, true);
        let (_, _) = stream_for(&rig, 3, 20.0, loud(), true);
        let e = events(&log);
        assert_eq!(&e[e.len() - 2..], ["area:stop", "panels:off"], "restore is the default");

        let log = Log::default();
        let rig = FakeRig::new(&log, true);
        let mut live = preflight(&rig).unwrap();
        let ctl = Control::new(tuning());
        ctl.restore.store(false, Ordering::Release);
        ctl.stop.store(true, Ordering::Release);
        let ending = run_stream(&rig, &mut live, &ctl, &|| None, &mut || 0.0, &|| false);
        assert_eq!(ending, Ending::Stopped);
        finish(&rig, live, ending, &ctl);
        let e = events(&log);
        assert_eq!(&e[e.len() - 2..], ["area:stop", "panels:off:keep"]);
    }

    #[test]
    fn a_failed_area_stop_is_tried_once_more() {
        let log = Log::default();
        let mut rig = FakeRig::new(&log, false);
        rig.stop_fails = true;
        let live = preflight(&rig).unwrap();
        finish(&rig, live, Ending::Stopped, &Control::new(tuning()));
        assert_eq!(events(&log).iter().filter(|e| *e == "area:stop").count(), 2);
    }

    #[test]
    fn locking_the_pc_stops_the_stream_and_restores_the_panels() {
        let log = Log::default();
        let rig = FakeRig::new(&log, true);
        let mut live = preflight(&rig).unwrap();
        let ctl = Control::new(tuning());
        let checks = std::cell::Cell::new(0);
        let locked = || {
            checks.set(checks.get() + 1);
            checks.get() > 3
        };
        let mut t = 0.0;
        let ending = run_stream(&rig, &mut live, &ctl, &|| None, &mut || { t += 20.0; t }, &locked);
        assert_eq!(ending, Ending::Locked);
        assert_eq!(log.hue_frames.borrow().len(), 3);
        // Even when the command asked to keep the look, a lock restores.
        ctl.restore.store(false, Ordering::Release);
        finish(&rig, live, ending, &ctl);
        let e = events(&log);
        assert_eq!(&e[e.len() - 2..], ["area:stop", "panels:off"]);
    }

    #[test]
    fn five_minutes_of_silence_stops_the_stream() {
        let log = Log::default();
        let rig = FakeRig::new(&log, false);
        let mut live = preflight(&rig).unwrap();
        let ctl = Control::new(tuning());
        let mut t = 0.0;
        let ending = run_stream(&rig, &mut live, &ctl, &|| Some((1, Vec::new())), &mut || { t += 60_000.0; t }, &|| false);
        assert_eq!(ending, Ending::Silent);
        // The first read is the start; silence is measured from the first silent tick: 5 minutes is 5 steps of 60 s after it.
        assert_eq!(log.hue_frames.borrow().len(), 6);
    }

    #[test]
    fn sound_resets_the_silence_clock() {
        let log = Log::default();
        let rig = FakeRig::new(&log, false);
        let mut live = preflight(&rig).unwrap();
        let ctl = Control::new(tuning());
        let n = std::cell::Cell::new(0u64);
        let t = std::cell::Cell::new(0.0);
        // A loud frame every fourth tick, 60 s apart: never five silent minutes in a row.
        let latest = || {
            n.set(n.get() + 1);
            Some((n.get(), if n.get() % 4 == 0 { loud() } else { Vec::new() }))
        };
        let mut now = || {
            t.set(t.get() + 60_000.0);
            if t.get() > 60_000.0 * 40.0 {
                ctl.stop.store(true, Ordering::Release);
            }
            t.get()
        };
        assert_eq!(run_stream(&rig, &mut live, &ctl, &latest, &mut now, &|| false), Ending::Stopped);
    }

    #[test]
    fn a_dead_hue_link_ends_the_stream_with_dtls() {
        let log = Log::default();
        let mut rig = FakeRig::new(&log, true);
        rig.hue_send_fails = true;
        let mut live = preflight(&rig).unwrap();
        let ctl = Control::new(tuning());
        let mut t = 0.0;
        let ending = run_stream(&rig, &mut live, &ctl, &|| None, &mut || { t += 20.0; t }, &|| false);
        assert_eq!(ending, Ending::LinkLost);
        finish(&rig, live, ending, &ctl);
        let mut notes = Notes::default();
        notes.on_ended(ending);
        assert_eq!(notes.last_error, Some("dtls"));
        let e = events(&log);
        assert_eq!(&e[e.len() - 2..], ["area:stop", "panels:off"]);
    }

    #[test]
    fn the_panel_lease_is_renewed_every_30_seconds() {
        let log = Log::default();
        let rig = FakeRig::new(&log, true);
        let (_, _) = stream_for(&rig, 14, 5_000.0, loud(), true);
        let renews = events(&log).iter().filter(|e| *e == "panels:renew").count();
        assert_eq!(renews, 2, "70 s of stream: renewed at about 30 s and 60 s");
        let log = Log::default();
        let rig = FakeRig::new(&log, false);
        let (_, _) = stream_for(&rig, 14, 5_000.0, loud(), true);
        assert!(!events(&log).iter().any(|e| e == "panels:renew"), "no panels, no lease");
    }

    #[test]
    fn tune_takes_effect_on_the_next_tick() {
        let log = Log::default();
        let rig = FakeRig::new(&log, false);
        let mut live = preflight(&rig).unwrap();
        let ctl = Control::new(tuning());
        let calls = std::cell::Cell::new(0u32);
        let mut now = || {
            calls.set(calls.get() + 1);
            if calls.get() == 10 {
                let mut t = tuning();
                t.settings.plays = false;
                ctl.tune(t);
            }
            if calls.get() > 20 {
                ctl.stop.store(true, Ordering::Release);
            }
            f64::from(calls.get()) * 20.0
        };
        let ending = run_stream(&rig, &mut live, &ctl, &|| Some((1, loud())), &mut now, &|| false);
        assert_eq!(ending, Ending::Stopped);
        let frames = log.hue_frames.borrow();
        let lit = |f: &Vec<u8>| f[stream::HEADER_LEN..].chunks(7).any(|c| c[1..].iter().any(|b| *b > 0));
        assert!(lit(&frames[2]), "lit before the tune");
        assert!(!lit(frames.last().unwrap()), "dark after plays was switched off");
    }

    #[test]
    fn stop_all_adds_an_area_stop_for_whoever_streams() {
        let log = Log::default();
        let rig = FakeRig::new(&log, true);
        rig.active.set(true);
        assert_eq!(stop_area_for_all(&rig), Ok(()));
        assert_eq!(events(&log), ["area:stop"]);
        assert!(!rig.active.get());
        let mut rig = FakeRig::new(&log, true);
        rig.layout = Err("no-area");
        assert_eq!(stop_area_for_all(&rig), Err("no-area"));
    }

    #[test]
    fn status_shows_the_live_parts_only_while_running() {
        let base = status_with(&Fake::default(), None);
        let mut n = Notes::default();
        n.on_starting();
        assert!(with_live(base.clone(), false, &n).starting);
        n.on_started(true, false);
        let s = with_live(base.clone(), true, &n);
        assert_eq!((s.running, s.starting, s.stopped_hue_sync, s.last_error.clone()), (true, false, true, None));
        n.on_ended(Ending::Stopped);
        let s = with_live(base.clone(), false, &n);
        assert_eq!((s.running, s.stopped_hue_sync, s.last_error), (false, false, None));
        n.on_failed("dtls");
        assert_eq!(with_live(base.clone(), false, &n).last_error.as_deref(), Some("dtls"));
        n.on_ended(Ending::Locked);
        assert_eq!(with_live(base, false, &n).last_error, None, "a lock or silence stop is not an error");
    }

    #[test]
    fn the_slot_keeps_only_the_newest_frame() {
        let first = latest_frame().unwrap().0;
        publish(&[1, 2, 3]);
        publish(&[]);
        let (seq, bands) = latest_frame().unwrap();
        assert!(seq != first, "a new sequence number");
        assert!(bands.len() <= 32);
    }

    /// Words of the engine commands carry no key, PSK, token or address.
    #[test]
    fn start_tune_and_stop_words_carry_no_secret() {
        let log = Log::default();
        let mut words: Vec<String> = Vec::new();
        for variant in 0..6 {
            let mut rig = FakeRig::new(&log, true);
            match variant {
                0 => rig.dtls_fails = true,
                1 => rig.layout = Err("no-area"),
                2 => {
                    rig.active.set(true);
                    rig.stubborn = true;
                }
                3 => *rig.store.value.borrow_mut() = None,
                4 => rig.start_fails = true,
                _ => rig.panels_fail = true,
            }
            let outcome = preflight(&rig).err();
            words.extend(outcome.map(str::to_string));
        }
        words.push(engine::BAD_PALETTE.to_string());
        words.extend([huesync::OPENED, huesync::NOT_INSTALLED].map(str::to_string));
        words.extend(huesync::answer("boom").err().map(str::to_string));
        words.push(stop_area_for_all(&{
            let mut r = FakeRig::new(&log, true);
            r.layout = Err("no-area");
            r
        }).unwrap_err().to_string());
        let secrets = ["secret", "0123456789ABCDEF", "192.168", "user-secret", "app-id", "token", "psk"];
        for w in &words {
            for s in secrets {
                assert!(!w.to_lowercase().contains(&s.to_lowercase()), "{w}");
            }
            assert!(w.len() <= 30 && w.chars().all(|c| c.is_ascii_lowercase() || c == '-'), "{w}");
        }
        assert!(words.len() >= 8);
        // The status the page polls, after every ending, never carries more than a word.
        let base = status_with(&Fake::default(), None);
        for ending in [Ending::Stopped, Ending::Locked, Ending::Silent, Ending::LinkLost] {
            let mut n = Notes::default();
            n.on_ended(ending);
            let text = serde_json::to_string(&with_live(base.clone(), false, &n)).unwrap();
            for s in secrets {
                assert!(!text.to_lowercase().contains(&s.to_lowercase()), "{text}");
            }
        }
    }

    fn local_host() -> Host {
        Host { session: Mutex::new(None), starting: Mutex::new(None), gate: Mutex::new(()) }
    }

    /// A stand-in session thread: runs the fake rig's start order, takes `slow_ms` to report, then streams
    /// (which ends at once when the stop flag is already set) and cleans up. Returns the rig's event log.
    fn slow_session(ctl: Arc<Control>, tx: std::sync::mpsc::Sender<Started>, slow_ms: u64, sync: Arc<AtomicBool>, notes: Option<Arc<Mutex<Notes>>>, events: Arc<Mutex<Vec<String>>>) -> std::thread::JoinHandle<()> {
        std::thread::spawn(move || {
            let log = Log::default();
            let rig = FakeRig::new(&log, true);
            let live = preflight(&rig).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(slow_ms));
            let _ = tx.send(Ok((live.stopped_hue_sync, live.panels_missing)));
            let clock = std::time::Instant::now();
            let ending = stream_and_finish(&rig, live, &ctl, &|| Some((0, Vec::new())), &mut || clock.elapsed().as_secs_f64() * 1000.0, &|| false, &sync);
            if let Some(n) = notes {
                lock(&n).on_thread_ended(ending, &ctl);
            }
            *lock(&events) = log.events.borrow().clone();
        })
    }

    #[test]
    fn a_stop_during_a_start_returns_promptly_and_the_start_ends_stopped_with_cleanup() {
        let host = local_host();
        let notes = Arc::new(Mutex::new(Notes::default()));
        let sync = Arc::new(AtomicBool::new(false));
        let events = Arc::new(Mutex::new(Vec::<String>::new()));
        let began = std::time::Instant::now();
        let result = std::thread::scope(|sc| {
            let starter = sc.spawn(|| {
                start_core(&host, &notes, &sync, tuning(), std::time::Duration::from_secs(30), |ctl, tx| slow_session(ctl, tx, 3000, sync.clone(), None, events.clone()))
            });
            while lock(&host.starting).is_none() {
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
            let stop_began = std::time::Instant::now();
            stop_in(&host, &notes, true);
            assert!(stop_began.elapsed() < std::time::Duration::from_millis(1500), "the stop does not wait for the start");
            starter.join().unwrap()
        });
        assert_eq!(result, Ok("stopped"));
        assert!(began.elapsed() < std::time::Duration::from_millis(2500), "the start gave up waiting as soon as the stop came");
        let n = lock(&notes).clone();
        assert!(!n.starting && n.last_error.is_none());
        assert!(lock(&host.starting).is_none());
        let late = lock(&host.session).take().expect("the late thread is kept to be joined");
        late.handle.join().unwrap();
        assert!(lock(&events).iter().any(|e| e == "area:stop"), "cleanup ran: {:?}", lock(&events));
        assert!(!sync.load(Ordering::Acquire));
    }

    #[test]
    fn a_start_that_times_out_keeps_its_error_word_after_the_late_thread_ends() {
        let host = local_host();
        let notes = Arc::new(Mutex::new(Notes::default()));
        let sync = Arc::new(AtomicBool::new(false));
        let events = Arc::new(Mutex::new(Vec::<String>::new()));
        let n2 = notes.clone();
        let result = start_core(&host, &notes, &sync, tuning(), std::time::Duration::from_millis(100), |ctl, tx| slow_session(ctl, tx, 600, sync.clone(), Some(n2), events.clone()));
        assert_eq!(result, Err(bridge::UNREACHABLE));
        let late = lock(&host.session).take().expect("the late thread is kept");
        late.handle.join().unwrap();
        let n = lock(&notes).clone();
        assert_eq!((n.starting, n.last_error), (false, Some(bridge::UNREACHABLE)));
        assert!(lock(&events).iter().any(|e| e == "area:stop"));
    }

    #[test]
    fn a_thread_ending_by_itself_clears_the_error_word_only_when_the_start_did_not_time_out() {
        let ctl = Control::new(tuning());
        let mut n = Notes::default();
        n.on_failed(bridge::UNREACHABLE);
        n.on_thread_ended(Ending::Stopped, &ctl);
        assert_eq!(n.last_error, None);
        ctl.timed_out.store(true, Ordering::Release);
        n.on_thread_ended(Ending::Stopped, &ctl);
        assert_eq!(n.last_error, Some(bridge::UNREACHABLE));
    }

    #[test]
    fn a_session_thread_that_dies_before_it_reports_fails_the_start_at_once() {
        let host = local_host();
        let notes = Mutex::new(Notes::default());
        let sync = AtomicBool::new(false);
        let result = start_core(&host, &notes, &sync, tuning(), std::time::Duration::from_secs(30), |_ctl, tx| std::thread::spawn(move || drop(tx)));
        assert_eq!(result, Err(bridge::UNREACHABLE));
        assert_eq!(lock(&notes).last_error, Some(bridge::UNREACHABLE));
    }

    #[test]
    fn a_panic_in_the_stream_still_cleans_up_and_resets_the_sync_flag() {
        let log = Log::default();
        let rig = FakeRig::new(&log, true);
        let live = preflight(&rig).unwrap();
        let ctl = Control::new(tuning());
        let sync = AtomicBool::new(false);
        let was_on = std::cell::Cell::new(false);
        let latest = || -> Option<(u64, Vec<u8>)> {
            was_on.set(sync.load(Ordering::Acquire));
            panic!("test panic in the stream");
        };
        let ending = stream_and_finish(&rig, live, &ctl, &latest, &mut || 0.0, &|| false, &sync);
        assert!(was_on.get(), "the flag was on while it streamed");
        assert_eq!(ending, Ending::LinkLost);
        assert!(!sync.load(Ordering::Acquire), "the flag is reset");
        let events = log.events.borrow().clone();
        assert!(events.iter().any(|e| e == "area:stop"), "{events:?}");
        assert!(events.iter().any(|e| e == "panels:off"), "{events:?}");
    }

    #[test]
    fn shutdown_never_blocks_on_a_held_lock_and_still_flags_a_waiting_start() {
        let host = local_host();
        let ctl = Arc::new(Control::new(tuning()));
        *lock(&host.starting) = Some(ctl.clone());
        let held = lock(&host.session);
        let began = std::time::Instant::now();
        shutdown_in(&host, std::time::Duration::from_secs(3));
        assert!(began.elapsed() < std::time::Duration::from_secs(2));
        assert!(ctl.stop.load(Ordering::Acquire));
        drop(held);
    }

    /// The capture loop analyses for the sync as well as the visualizer, publishes to the slot, and
    /// emits only for the visualizer. Reads the loop's source text.
    #[test]
    fn the_audio_gate_is_split_and_the_emit_stays_with_the_visualizer() {
        let lib = include_str!("../lib.rs").replace("\r\n", "\n");
        let gate = lib.find(concat!("if !push", " && !sync")).expect("gate");
        let publish_at = lib.find(concat!("wall2_lightsync::", "publish(&levels.bands)")).expect("publish");
        let emit_at = lib.find(concat!("app.emit(\"audio-", "levels\", &levels)")).expect("emit");
        assert!(gate < publish_at && publish_at < emit_at);
        assert!(lib[publish_at..emit_at].contains(concat!("if !push", " {")), "nothing is emitted unless the visualizer asked");
        assert!(lib.contains(concat!("let sync = wall2_lightsync::", "sync_on();")));
    }

    #[test]
    fn the_exit_paths_stop_the_sync() {
        let lib = include_str!("../lib.rs").replace("\r\n", "\n");
        assert_eq!(lib.matches(concat!("wall2_lightsync::", "shutdown();")).count(), 2);
    }

    /// Every command checks the window first: as many window checks as command attributes.
    #[test]
    fn every_command_checks_the_window() {
        let src = include_str!("mod.rs").replace("\r\n", "\n");
        let commands = src.matches(concat!("#[tauri::", "command]")).count();
        let checks = src.matches(concat!("crate::wall2_meet::require_", "wall2(window.label())?;")).count();
        assert_eq!(commands, 9);
        assert_eq!(commands, checks);
    }
}
