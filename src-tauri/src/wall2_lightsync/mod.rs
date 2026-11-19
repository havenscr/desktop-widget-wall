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

pub(crate) mod bridge;
pub(crate) mod nanoleaf;
pub(crate) mod store;
pub(crate) mod stream;

use bridge::{BridgeNet, Facts};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
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
    fn open_hue(&self, saved: &Saved) -> Result<Box<dyn Frames + '_>, &'static str>;
    /// Panels into extControl; the answer is where to send frames.
    fn panels_on(&self) -> Result<Box<dyn Frames + '_>, &'static str>;
    fn panels_off(&self);
    fn pause(&self, ms: u64);
}

const TEST_SECONDS: u64 = 3;
const TEST_HZ: u64 = 50;

/// The test: stop any other streamer, start the area, connect, sweep for 3 s, stop. The Plays
/// always get their sweep; panels that are listed but would not answer end the test with
/// `panels-unavailable` after it.
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
    let _ = rig.area(&area_id, "stop");
    outcome
}

fn flash(rig: &dyn Rig, saved: &Saved, layout: &Layout) -> Result<&'static str, &'static str> {
    let mut hue = rig.open_hue(saved)?;
    let mut panels_down = false;
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
            break;
        }
        // Panels at about 25 Hz: every other tick.
        if i % 2 == 0 {
            if let (Some(link), Some(ps)) = (panels.as_mut(), layout.panels.as_ref()) {
                if let Some(pkt) = nanoleaf::encode_packet(&nanoleaf::ring_frame(ps, t)) {
                    link.send(&pkt);
                }
            }
        }
        rig.pause(1000 / TEST_HZ);
    }
    if panels.is_some() || panels_down {
        rig.panels_off();
    }
    if panels_down {
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

    fn panels_post(&self, body: &str) -> Result<serde_json::Value, &'static str> {
        let token = self.token.as_deref().filter(|_| crate::wall2_desk::token_may_go_to(&self.base)).ok_or(nanoleaf::UNAVAILABLE)?;
        let agent = ureq::AgentBuilder::new().redirects(0).timeout(std::time::Duration::from_secs(8)).build();
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
    fn open_hue(&self, saved: &Saved) -> Result<Box<dyn Frames + '_>, &'static str> {
        Ok(Box::new(stream::HueLink::connect(self.facts.ip, &saved.app_id, &saved.clientkey)?))
    }
    fn panels_on(&self) -> Result<Box<dyn Frames + '_>, &'static str> {
        let answer = self.panels_post(&nanoleaf::stream_body(true, false, false))?;
        let (ip, port) = nanoleaf::shape_stream_answer(&answer).ok_or(nanoleaf::UNAVAILABLE)?;
        Ok(Box::new(nanoleaf::PanelLink::open(ip, port)?))
    }
    fn panels_off(&self) {
        let _ = self.panels_post(&nanoleaf::stream_body(false, false, true));
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

impl TestGuard {
    fn take() -> Option<TestGuard> {
        testing().compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).ok().map(|_| TestGuard)
    }
}

impl Drop for TestGuard {
    fn drop(&mut self) {
        testing().store(false, Ordering::Release);
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
        Ok(status_with(&store, facts.as_ref()))
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
        let Some(_guard) = TestGuard::take() else { return Err(bridge::BUSY.to_string()) };
        let rig = RealRig::new(&app).map_err(str::to_string)?;
        run_test(&rig).map(str::to_string).map_err(str::to_string)
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

    struct Sink<'a>(&'a Log, bool);

    impl Frames for Sink<'_> {
        fn send(&mut self, bytes: &[u8]) -> bool {
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
    }

    impl<'a> FakeRig<'a> {
        fn new(log: &'a Log, with_panels: bool) -> FakeRig<'a> {
            let store = Fake::default();
            store::save_with(&store, &sample());
            let panels = with_panels.then(|| vec![nanoleaf::Panel { id: 5, x: 0.0, y: 0.0 }, nanoleaf::Panel { id: 6, x: 50.0, y: 0.0 }]);
            FakeRig { log, store, layout: Ok(Layout { area_id: AREA.to_string(), channels: vec![3, 1, 2, 0], panels }), start_fails: false, dtls_fails: false, panels_fail: false }
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
            if action == "start" && self.start_fails { Err(bridge::FAILED) } else { Ok(()) }
        }
        fn open_hue(&self, _s: &Saved) -> Result<Box<dyn Frames + '_>, &'static str> {
            self.note("hue:open");
            if self.dtls_fails { Err(stream::DTLS) } else { Ok(Box::new(Sink(self.log, true))) }
        }
        fn panels_on(&self) -> Result<Box<dyn Frames + '_>, &'static str> {
            self.note("panels:on");
            if self.panels_fail { Err(nanoleaf::UNAVAILABLE) } else { Ok(Box::new(Sink(self.log, false))) }
        }
        fn panels_off(&self) {
            self.note("panels:off");
        }
        fn pause(&self, _ms: u64) {}
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
        for variant in 0..4 {
            let mut rig = FakeRig::new(&log, true);
            match variant {
                0 => rig.dtls_fails = true,
                1 => rig.start_fails = true,
                2 => rig.panels_fail = true,
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
        for w in [bridge::FAILED, bridge::UNREACHABLE, bridge::CERT, bridge::BUSY, stream::DTLS, nanoleaf::UNAVAILABLE] {
            assert!(w.chars().all(|c| c.is_ascii_lowercase() || c == '-'));
        }
    }

    #[test]
    fn testing_runs_one_at_a_time() {
        let first = TestGuard::take().expect("free");
        assert!(TestGuard::take().is_none());
        drop(first);
        assert!(TestGuard::take().is_some());
    }

    /// Every command checks the window first: as many window checks as command attributes.
    #[test]
    fn every_command_checks_the_window() {
        let src = include_str!("mod.rs").replace("\r\n", "\n");
        let commands = src.matches(concat!("#[tauri::", "command]")).count();
        let checks = src.matches(concat!("crate::wall2_meet::require_", "wall2(window.label())?;")).count();
        assert_eq!(commands, 4);
        assert_eq!(commands, checks);
    }
}
