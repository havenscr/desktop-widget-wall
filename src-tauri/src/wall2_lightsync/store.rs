//! The Hue entertainment key pair: made by the wall's own pairing with the bridge, kept in
//! Windows Credential Manager as one JSON value `{ username, clientkey, appId, bridgeId }`.
//!
//! Target `crate::wall2_oauth::credential_target("lightsync", "hue", 0)`, one chunk. Only Rust
//! reads it. The web view learns `paired` and `bridgeChanged` and nothing else. The value is
//! never logged, put in an error, a `Debug` output or an answer. Same shape as
//! `wall2_desk_token.rs`: a trait, the real store, and a fake in tests.

use crate::wall2_meet::store::{BlobStore, CredBlobs, Fetch};
use serde::{Deserialize, Serialize};

/// What pairing yields. `Debug` is written by hand so no key can reach a log.
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Saved {
    pub username: String,
    pub clientkey: String,
    pub app_id: String,
    pub bridge_id: String,
}

impl std::fmt::Debug for Saved {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Saved(..)")
    }
}

/// The value rule: every field 1 to 128 visible ASCII characters, the bridge id 16 hex digits.
pub(crate) fn valid(s: &Saved) -> bool {
    let field = |v: &str| !v.is_empty() && v.len() <= 128 && v.chars().all(|c| c.is_ascii_graphic());
    field(&s.username) && field(&s.clientkey) && field(&s.app_id) && super::bridge::valid_bridge_id(&s.bridge_id)
}

/// What the store holds.
#[derive(Debug, PartialEq)]
pub(crate) enum Loaded {
    None,
    Unreadable,
    Paired(Saved),
}

/// Where the pair is kept. Production is Credential Manager; tests use a fake.
pub(crate) trait KeyStore {
    fn load(&self) -> Fetch<String>;
    fn save(&self, value: &str) -> bool;
    fn delete(&self);
}

fn target() -> String {
    crate::wall2_oauth::credential_target("lightsync", "hue", 0)
}

pub(crate) struct RealStore;

impl KeyStore for RealStore {
    fn load(&self) -> Fetch<String> {
        match CredBlobs.read(&target()) {
            Fetch::Found(bytes) => String::from_utf8(bytes).map_or(Fetch::Failed, Fetch::Found),
            Fetch::Missing => Fetch::Missing,
            Fetch::Failed => Fetch::Failed,
        }
    }
    fn save(&self, value: &str) -> bool {
        CredBlobs.write(&target(), value.as_bytes())
    }
    fn delete(&self) {
        CredBlobs.remove(&target());
    }
}

pub(crate) fn load_with(store: &dyn KeyStore) -> Loaded {
    match store.load() {
        Fetch::Missing => Loaded::None,
        Fetch::Failed => Loaded::Unreadable,
        Fetch::Found(text) => match serde_json::from_str::<Saved>(&text) {
            Ok(s) if valid(&s) => Loaded::Paired(s),
            _ => Loaded::Unreadable,
        },
    }
}

pub(crate) fn save_with(store: &dyn KeyStore, saved: &Saved) -> bool {
    if !valid(saved) {
        return false;
    }
    match serde_json::to_string(saved) {
        Ok(text) => store.save(&text),
        Err(_) => false,
    }
}

/// Deletes the saved pair; false when it is still there afterwards.
pub(crate) fn forget_with(store: &dyn KeyStore) -> bool {
    store.delete();
    matches!(store.load(), Fetch::Missing)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    #[derive(Default)]
    pub(crate) struct Fake {
        pub value: RefCell<Option<String>>,
        pub read_fails: Cell<bool>,
        pub write_fails: Cell<bool>,
        pub delete_sticks: Cell<bool>,
    }

    impl KeyStore for Fake {
        fn load(&self) -> Fetch<String> {
            if self.read_fails.get() {
                return Fetch::Failed;
            }
            match self.value.borrow().clone() {
                Some(v) => Fetch::Found(v),
                None => Fetch::Missing,
            }
        }
        fn save(&self, value: &str) -> bool {
            if self.write_fails.get() {
                return false;
            }
            *self.value.borrow_mut() = Some(value.to_string());
            true
        }
        fn delete(&self) {
            if !self.delete_sticks.get() {
                *self.value.borrow_mut() = None;
            }
        }
    }

    pub(crate) fn sample() -> Saved {
        Saved {
            username: "uSeRnAmE-secret-1".into(),
            clientkey: "0123456789ABCDEF0123456789ABCDEF".into(),
            app_id: "app-id-secret-1".into(),
            bridge_id: "001788FFFE123456".into(),
        }
    }

    #[test]
    fn round_trip() {
        let f = Fake::default();
        assert_eq!(load_with(&f), Loaded::None);
        assert!(save_with(&f, &sample()));
        assert_eq!(load_with(&f), Loaded::Paired(sample()));
    }

    #[test]
    fn unreadable_value() {
        let f = Fake::default();
        *f.value.borrow_mut() = Some("not json".to_string());
        assert_eq!(load_with(&f), Loaded::Unreadable);
        *f.value.borrow_mut() = Some(r#"{"username":"","clientkey":"k","appId":"a","bridgeId":"001788FFFE123456"}"#.to_string());
        assert_eq!(load_with(&f), Loaded::Unreadable, "an empty field breaks the value rule");
        f.read_fails.set(true);
        assert_eq!(load_with(&f), Loaded::Unreadable);
    }

    #[test]
    fn save_refuses_a_bad_value_and_reports_a_failed_write() {
        let f = Fake::default();
        let mut bad = sample();
        bad.bridge_id = "short".into();
        assert!(!save_with(&f, &bad));
        f.write_fails.set(true);
        assert!(!save_with(&f, &sample()));
    }

    #[test]
    fn forget_deletes_and_notices_a_stuck_delete() {
        let f = Fake::default();
        save_with(&f, &sample());
        assert!(forget_with(&f));
        assert_eq!(load_with(&f), Loaded::None);
        save_with(&f, &sample());
        f.delete_sticks.set(true);
        assert!(!forget_with(&f));
    }

    #[test]
    fn debug_shows_no_key() {
        let text = format!("{:?}", sample());
        assert!(!text.contains("secret") && !text.contains("0123456789ABCDEF"));
    }
}
