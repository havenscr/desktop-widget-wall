//! Music light sync, part 1 (41-2): pair the wall with the Hue bridge and keep the key.
//!
//! The wall registers itself with the bridge (link button), keeps `{ username, clientkey, appId,
//! bridgeId }` in Windows Credential Manager (`store.rs`) and talks to the bridge over HTTPS
//! pinned to the Hue roots and the bridge id the home app gives (`bridge.rs`). The web view
//! learns `paired` and `bridgeChanged`, never a key or an address. Errors are fixed words.
//! `running`, `starting`, `lastError` and `stoppedHueSync` belong to the stream (41-4) and are
//! idle values until then.

pub(crate) mod bridge;
pub(crate) mod store;

use bridge::{BridgeNet, Facts};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use store::{KeyStore, Loaded, Saved};

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

    /// Every command checks the window first: as many window checks as command attributes.
    #[test]
    fn every_command_checks_the_window() {
        let src = include_str!("mod.rs").replace("\r\n", "\n");
        let commands = src.matches(concat!("#[tauri::", "command]")).count();
        let checks = src.matches(concat!("crate::wall2_meet::require_", "wall2(window.label())?;")).count();
        assert_eq!(commands, 3);
        assert_eq!(commands, checks);
    }
}
