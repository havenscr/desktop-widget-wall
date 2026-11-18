//! The brief token: typed once in Tools, kept in Windows Credential Manager.
//!
//! Target `WidgetWall2/brief/token/0`, built from `credential_target("brief", "token", 0)`. The
//! Meet accounts live at `WidgetWall2/meet/<id>/<n>`, so a target whose service is `brief` can
//! never be one of them, whatever an account id is called. Only Rust reads it, for
//! `brief::wall2_meet_brief`; the web view learns whether one is set and nothing else. The
//! value is never logged, put in an error, a `Debug` output or an answer. The value rule and the
//! store trait are the desk token's: trimmed, 1 to 256 visible ASCII characters. Error words
//! are fixed: `invalid`, `failed`.

use crate::wall2_desk_token::{forget_with, read_with, set_with, status_with, TokenStatus, TokenStore};
use crate::wall2_meet::store::{BlobStore, CredBlobs, Fetch};

pub(crate) fn target() -> String {
    crate::wall2_oauth::credential_target("brief", "token", 0)
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

/// The saved token when there is a usable one. Reads Credential Manager: call off the async thread.
pub(crate) fn read_token() -> Option<String> {
    read_with(&RealStore)
}

// Section: commands (wall2 window only; blocking work off the async thread)

#[tauri::command]
pub async fn wall2_meet_brief_token_status(window: tauri::WebviewWindow) -> Result<TokenStatus, String> {
    super::require_wall2(window.label())?;
    crate::wall2_desk::off_thread(|| Ok(status_with(&RealStore))).await
}

#[tauri::command]
pub async fn wall2_meet_brief_token_set(window: tauri::WebviewWindow, value: String) -> Result<(), String> {
    super::require_wall2(window.label())?;
    crate::wall2_desk::off_thread(move || set_with(&RealStore, &value)).await
}

#[tauri::command]
pub async fn wall2_meet_brief_token_clear(window: tauri::WebviewWindow) -> Result<(), String> {
    super::require_wall2(window.label())?;
    crate::wall2_desk::off_thread(|| forget_with(&RealStore)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    const TOKEN: &str = "example-token-9876";

    #[derive(Default)]
    struct Fake {
        value: RefCell<Option<String>>,
    }

    impl TokenStore for Fake {
        fn load(&self) -> Fetch<String> {
            match self.value.borrow().clone() {
                Some(v) => Fetch::Found(v),
                None => Fetch::Missing,
            }
        }
        fn save(&self, value: &str) -> bool {
            *self.value.borrow_mut() = Some(value.to_string());
            true
        }
        fn delete(&self) {
            *self.value.borrow_mut() = None;
        }
    }

    #[test]
    fn the_target_is_fixed_and_never_inside_the_account_namespace() {
        assert_eq!(target(), "WidgetWall2/brief/token/0");
        assert!(!target().starts_with("WidgetWall2/meet/"));
        // Every possible account target is `WidgetWall2/meet/<id>/<n>`, including an account called `brief`.
        for id in ["brief", "token", "0", "a", "brief-token"] {
            for n in 0..crate::wall2_meet::store::MAX_CHUNKS {
                assert_ne!(target(), crate::wall2_meet::store::target(id, n));
            }
        }
        // Nor the desk token's.
        assert_ne!(target(), crate::wall2_oauth::credential_target("home", "desk", 0));
    }

    #[test]
    fn set_read_clear_follow_the_value_rule() {
        let f = Fake::default();
        assert_eq!(status_with(&f), TokenStatus { set: false, unreadable: false });
        assert_eq!(set_with(&f, &format!(" {TOKEN}\n")), Ok(()));
        assert_eq!(f.value.borrow().as_deref(), Some(TOKEN));
        assert_eq!(read_with(&f).as_deref(), Some(TOKEN));
        for bad in ["", "   ", "two words", "caf\u{e9}"] {
            assert_eq!(set_with(&f, bad), Err("invalid".to_string()));
        }
        assert_eq!(set_with(&f, &"a".repeat(257)), Err("invalid".to_string()));
        assert_eq!(forget_with(&f), Ok(()));
        assert_eq!(read_with(&f), None);
    }

    #[test]
    fn status_never_leaks_the_value() {
        let f = Fake::default();
        set_with(&f, TOKEN).unwrap();
        let status = status_with(&f);
        let json = serde_json::to_string(&status).unwrap();
        for text in [format!("{status:?}"), json.clone()] {
            assert!(!text.contains(TOKEN));
            assert!(!text.contains(&TOKEN.len().to_string()));
        }
        assert_eq!(json, "{\"set\":true,\"unreadable\":false}");
        // A saved value that breaks the rule reads as unreadable, still without the value.
        *f.value.borrow_mut() = Some("two words".to_string());
        let status = status_with(&f);
        assert_eq!(status, TokenStatus { set: false, unreadable: true });
        assert!(!format!("{status:?}").contains("two words"));
    }
}
