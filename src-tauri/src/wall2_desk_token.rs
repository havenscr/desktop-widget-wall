//! The home app's desk token: typed once in Tools, kept in Windows Credential Manager.
//!
//! Target `crate::wall2_oauth::credential_target("home", "desk", 0)` (`WidgetWall2/home/desk/0`),
//! one chunk (a token is at most 256 bytes; `CHUNK` in `wall2_meet/store.rs` is 2560). Only Rust
//! reads it, for `wall2_desk` (Clear all) and `wall2_studio` (the studio writes); the web view
//! learns whether one is set and nothing else. The value is never logged, put in an error, a
//! `Debug` output or an answer. Value rule: trimmed, 1 to 256 characters, every one visible
//! ASCII (the rule `wall2_desk::MAX_TOKEN` stated for the old `feeds.json` key). Error words
//! are fixed: `invalid`, `failed`.

use crate::wall2_desk::MAX_TOKEN;
use crate::wall2_meet::store::{BlobStore, CredBlobs, Fetch};
use serde::Serialize;

pub(crate) const INVALID: &str = "invalid";
pub(crate) const FAILED: &str = "failed";

/// What the web view may learn: that a usable token is saved, or that the saved one cannot be
/// read. Never the token, its length or any part of it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TokenStatus {
    pub set: bool,
    pub unreadable: bool,
}

/// Where the token is kept. Production is Credential Manager; tests use a fake.
pub(crate) trait TokenStore {
    fn load(&self) -> Fetch<String>;
    fn save(&self, value: &str) -> bool;
    fn delete(&self);
}

fn target() -> String {
    crate::wall2_oauth::credential_target("home", "desk", 0)
}

struct RealStore;

impl TokenStore for RealStore {
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

/// The value rule: trimmed, 1 to `MAX_TOKEN` characters, every one visible ASCII.
pub(crate) fn valid_token(raw: &str) -> Option<String> {
    let t = raw.trim();
    let ok = !t.is_empty() && t.len() <= MAX_TOKEN && t.chars().all(|c| c.is_ascii_graphic());
    ok.then(|| t.to_string())
}

/// The saved token when there is a usable one; None when none is saved, the store cannot be
/// read, or the saved text breaks the value rule.
pub(crate) fn read_with(store: &dyn TokenStore) -> Option<String> {
    match store.load() {
        Fetch::Found(v) => valid_token(&v),
        _ => None,
    }
}

pub(crate) fn status_with(store: &dyn TokenStore) -> TokenStatus {
    match store.load() {
        Fetch::Found(v) => {
            let usable = valid_token(&v).is_some();
            TokenStatus { set: usable, unreadable: !usable }
        }
        Fetch::Missing => TokenStatus { set: false, unreadable: false },
        Fetch::Failed => TokenStatus { set: false, unreadable: true },
    }
}

pub(crate) fn set_with(store: &dyn TokenStore, raw: &str) -> Result<(), String> {
    let token = valid_token(raw).ok_or_else(|| INVALID.to_string())?;
    if store.save(&token) {
        Ok(())
    } else {
        Err(FAILED.to_string())
    }
}

pub(crate) fn forget_with(store: &dyn TokenStore) -> Result<(), String> {
    store.delete();
    // A delete that left the token behind is a failure the page must say.
    match store.load() {
        Fetch::Missing => Ok(()),
        _ => Err(FAILED.to_string()),
    }
}

/// The token for a studio write or Clear all. Reads Credential Manager: call off the async thread.
pub(crate) fn read_token() -> Option<String> {
    read_with(&RealStore)
}

// Section: commands (wall2 window only; blocking work off the async thread)

#[tauri::command]
pub async fn wall2_desk_token_status(window: tauri::WebviewWindow) -> Result<TokenStatus, String> {
    crate::wall2_meet::require_wall2(window.label())?;
    crate::wall2_desk::off_thread(|| Ok(status_with(&RealStore))).await
}

#[tauri::command]
pub async fn wall2_desk_token_set(window: tauri::WebviewWindow, token: String) -> Result<(), String> {
    crate::wall2_meet::require_wall2(window.label())?;
    crate::wall2_desk::off_thread(move || set_with(&RealStore, &token)).await
}

#[tauri::command]
pub async fn wall2_desk_token_forget(window: tauri::WebviewWindow) -> Result<(), String> {
    crate::wall2_meet::require_wall2(window.label())?;
    crate::wall2_desk::off_thread(|| forget_with(&RealStore)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wall2_meet::store::MemoryBlobs;
    use std::cell::{Cell, RefCell};

    const TOKEN: &str = "s3cr3t-desk-token-value";

    /// A fake store: a value, plus switches for a failed read, a failed write and a delete that does nothing.
    #[derive(Default)]
    struct Fake {
        value: RefCell<Option<String>>,
        read_fails: Cell<bool>,
        write_fails: Cell<bool>,
        delete_sticks: Cell<bool>,
    }

    impl TokenStore for Fake {
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

    #[test]
    fn value_rule() {
        assert_eq!(valid_token(&format!("  {TOKEN}\n")).as_deref(), Some(TOKEN));
        assert_eq!(valid_token(""), None);
        assert_eq!(valid_token("   "), None);
        assert_eq!(valid_token(&"a".repeat(256)).map(|t| t.len()), Some(256));
        assert_eq!(valid_token(&"a".repeat(257)), None);
        assert_eq!(valid_token("two words"), None);
        assert_eq!(valid_token("caf\u{e9}"), None);
        assert_eq!(valid_token("tab\tinside"), None);
        assert_eq!(valid_token("a\u{7f}b"), None);
    }

    #[test]
    fn set_then_read_then_forget() {
        let f = Fake::default();
        assert_eq!(status_with(&f), TokenStatus { set: false, unreadable: false });
        assert_eq!(read_with(&f), None);
        assert_eq!(set_with(&f, &format!(" {TOKEN} ")), Ok(()));
        // The stored value is the trimmed one.
        assert_eq!(f.value.borrow().as_deref(), Some(TOKEN));
        assert_eq!(status_with(&f), TokenStatus { set: true, unreadable: false });
        assert_eq!(read_with(&f).as_deref(), Some(TOKEN));
        assert_eq!(forget_with(&f), Ok(()));
        assert_eq!(status_with(&f), TokenStatus { set: false, unreadable: false });
        assert_eq!(read_with(&f), None);
    }

    #[test]
    fn a_bad_value_is_invalid_and_saves_nothing() {
        let f = Fake::default();
        let long = "a".repeat(257);
        for bad in ["", "   ", "has space", "caf\u{e9}", long.as_str()] {
            let err = set_with(&f, bad).unwrap_err();
            assert_eq!(err, INVALID);
        }
        assert!(f.value.borrow().is_none());
    }

    #[test]
    fn a_failed_write_is_failed_and_leaves_the_old_value() {
        let f = Fake::default();
        set_with(&f, TOKEN).unwrap();
        f.write_fails.set(true);
        let err = set_with(&f, "another-token").unwrap_err();
        assert_eq!(err, FAILED);
        assert!(!err.contains("another-token"));
        assert_eq!(f.value.borrow().as_deref(), Some(TOKEN));
    }

    #[test]
    fn status_never_carries_the_token_or_its_length() {
        let f = Fake::default();
        set_with(&f, TOKEN).unwrap();
        let shown = format!("{:?}", status_with(&f));
        let json = serde_json::to_string(&status_with(&f)).unwrap();
        for text in [shown, json.clone()] {
            assert!(!text.contains(TOKEN));
            assert!(!text.contains(&TOKEN.len().to_string()));
        }
        assert_eq!(json, "{\"set\":true,\"unreadable\":false}");
    }

    #[test]
    fn an_unreadable_store_or_a_broken_saved_value_says_unreadable() {
        let f = Fake::default();
        f.read_fails.set(true);
        assert_eq!(status_with(&f), TokenStatus { set: false, unreadable: true });
        assert_eq!(read_with(&f), None);
        let g = Fake::default();
        *g.value.borrow_mut() = Some("two words".to_string());
        assert_eq!(status_with(&g), TokenStatus { set: false, unreadable: true });
        assert_eq!(read_with(&g), None);
    }

    #[test]
    fn a_forget_that_left_the_token_is_failed() {
        let f = Fake::default();
        set_with(&f, TOKEN).unwrap();
        f.delete_sticks.set(true);
        assert_eq!(forget_with(&f), Err(FAILED.to_string()));
        // Forgetting when nothing is saved is fine.
        assert_eq!(forget_with(&Fake::default()), Ok(()));
    }

    #[test]
    fn the_credential_target_is_the_home_desk_one() {
        assert_eq!(target(), "WidgetWall2/home/desk/0");
        // Another service's targets do not collide with it.
        assert_ne!(target(), crate::wall2_oauth::credential_target("youtube", "client", 0));
        // The memory store used by every other secret test keeps it as one blob.
        let blobs = MemoryBlobs::default();
        assert!(blobs.write(&target(), TOKEN.as_bytes()));
        assert_eq!(blobs.len(), 1);
    }
}
