//! Person actions: copy an address, start an email, start a Teams chat.
//!
//! Rust reads each invitee's address from Graph (to match the organizer) and never sends it. The
//! next-meetings read keeps each listed person's address in `service::Links::person_map` behind
//! a key `p<read>-<n>` (see `service::read_next_only`), swapped on every next read, so a key
//! from an older read finds nothing. The page passes only that key and an action word; the
//! address is checked here, and every action opens an app or sets the clipboard: nothing is
//! sent. The address is never logged, returned or put in an error. Error words are fixed:
//! `gone` (no such key), `invalid` (the address failed the check), `failed`.
//!
//! "Open contact card" is not built: no documented way opens Outlook's contact card for an
//! address from outside Outlook (pending an owner decision).

use serde::Deserialize;
use tauri_plugin_opener::OpenerExt;

const GONE: &str = "gone";
const INVALID: &str = "invalid";
const FAILED: &str = "failed";
const MAX_ADDRESS: usize = 254;

/// What the address check lets through, or not. Exactly one `@`; a local part and a domain, both
/// non-empty; the domain has a dot that is neither first nor last; at most 254 characters; no
/// whitespace, control or invisible format character; and none of `?` `&` `%` `,` `;` `<` `>` `"`
/// `'`, so a hostile address cannot add recipients, a subject, a body or a query.
pub(crate) fn valid_address(address: &str) -> bool {
    if address.is_empty() || address.len() > MAX_ADDRESS {
        return false;
    }
    if address.chars().any(|c| c.is_whitespace() || c.is_control() || matches!(c, '?' | '&' | '%' | ',' | ';' | '<' | '>' | '"' | '\'')) {
        return false;
    }
    // Invisible format characters (bidi marks, zero width) are removed by the shared cleaner.
    if super::graph::normalize(address) != address {
        return false;
    }
    let mut parts = address.split('@');
    let (Some(local), Some(domain), None) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    !local.is_empty() && !domain.is_empty() && domain.contains('.') && !domain.starts_with('.') && !domain.ends_with('.')
}

/// `mailto:<address>`: ASCII letters, digits and `._-+@` stay, every other byte is percent
/// encoded. No query part, ever.
pub(crate) fn mailto_url(address: &str) -> Option<String> {
    if !valid_address(address) {
        return None;
    }
    let mut out = String::from("mailto:");
    for b in address.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b'+' | b'@') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    Some(out)
}

/// The documented Teams deep link to a 1:1 chat. Nothing else in the query.
pub(crate) fn teams_url(address: &str) -> Option<String> {
    valid_address(address).then(|| format!("https://teams.microsoft.com/l/chat/0/0?users={}", urlencoding::encode(address)))
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Action {
    Copy,
    Email,
    Teams,
}

fn action_of(word: &str) -> Option<Action> {
    match word {
        "copy" => Some(Action::Copy),
        "email" => Some(Action::Email),
        "teams" => Some(Action::Teams),
        _ => None,
    }
}

/// What to do for an action on an address: copy this text, or open this URL. The address check
/// comes first, for every action.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Plan {
    Copy(String),
    Open(String),
}

pub(crate) fn plan(action: Action, address: &str) -> Result<Plan, &'static str> {
    if !valid_address(address) {
        return Err(INVALID);
    }
    match action {
        Action::Copy => Ok(Plan::Copy(address.to_string())),
        Action::Email => mailto_url(address).map(Plan::Open).ok_or(INVALID),
        Action::Teams => teams_url(address).map(Plan::Open).ok_or(INVALID),
    }
}

/// True for exactly the shape `service::read_next_only` makes: `p`, the read (1 to 19 digits),
/// `-`, the person's number (1 to 4 digits). ASCII only.
pub(crate) fn valid_person_key(key: &str) -> bool {
    let Some(rest) = key.strip_prefix('p') else { return false };
    let Some((read, n)) = rest.split_once('-') else { return false };
    let digits = |s: &str, max: usize| !s.is_empty() && s.len() <= max && s.bytes().all(|b| b.is_ascii_digit());
    key.len() <= 26 && digits(read, 19) && digits(n, 4)
}

/// UTF-16 with a trailing NUL, as CF_UNICODETEXT wants it.
#[cfg(any(windows, test))]
fn utf16_nul(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// The address as CF_UNICODETEXT, with the wall2 window as clipboard owner (`owner` is its
/// HWND value; without an owner `SetClipboardData` can fail after `EmptyClipboard`). Other
/// targets have no clipboard here, so they fail.
#[cfg(windows)]
fn write_clipboard(text: &str, owner: isize) -> bool {
    use std::time::Duration;
    use windows::Win32::Foundation::{GlobalFree, HANDLE, HWND};
    use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData};
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::System::Ole::CF_UNICODETEXT;

    let wide = utf16_nul(text);
    let bytes = wide.len() * 2;
    let hwnd = HWND(owner as *mut core::ffi::c_void);
    unsafe {
        // Another program may hold the clipboard for a moment.
        let mut opened = false;
        for _ in 0..5 {
            if OpenClipboard(hwnd).is_ok() {
                opened = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        if !opened {
            return false;
        }
        let ok = (|| {
            if EmptyClipboard().is_err() {
                return false;
            }
            let Ok(hglobal) = GlobalAlloc(GMEM_MOVEABLE, bytes) else {
                return false;
            };
            let ptr = GlobalLock(hglobal) as *mut u16;
            if ptr.is_null() {
                let _ = GlobalFree(hglobal);
                return false;
            }
            std::ptr::copy_nonoverlapping(wide.as_ptr(), ptr, wide.len());
            let _ = GlobalUnlock(hglobal);
            if SetClipboardData(CF_UNICODETEXT.0 as u32, HANDLE(hglobal.0)).is_err() {
                // The clipboard did not take ownership of the memory.
                let _ = GlobalFree(hglobal);
                return false;
            }
            true
        })();
        let _ = CloseClipboard();
        ok
    }
}

#[cfg(not(windows))]
fn write_clipboard(_text: &str, _owner: isize) -> bool {
    false
}

/// Copy, email or message one listed person. `key` is a person key from the last next-meetings
/// read; `action` is `copy`, `email` or `teams`.
#[tauri::command]
pub async fn wall2_meet_person_action(window: tauri::WebviewWindow, key: String, action: String) -> Result<(), String> {
    super::require_wall2(window.label())?;
    let action = action_of(&action).ok_or_else(|| FAILED.to_string())?;
    if !valid_person_key(&key) {
        return Err(GONE.to_string());
    }
    let address = super::service::lookup_person(super::links(), &key).ok_or_else(|| GONE.to_string())?;
    match plan(action, &address).map_err(str::to_string)? {
        Plan::Copy(text) => {
            #[cfg(windows)]
            let owner = window.hwnd().map(|h| h.0 as isize).map_err(|_| FAILED.to_string())?;
            #[cfg(not(windows))]
            let owner = 0isize;
            let done = tauri::async_runtime::spawn_blocking(move || write_clipboard(&text, owner)).await.map_err(|_| FAILED.to_string())?;
            if done {
                Ok(())
            } else {
                Err(FAILED.to_string())
            }
        }
        Plan::Open(url) => window.opener().open_url(url, None::<&str>).map_err(|_| FAILED.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clipboard_text_is_utf16_with_one_trailing_nul() {
        assert_eq!(utf16_nul(""), vec![0]);
        assert_eq!(utf16_nul("a@b.co"), vec![97, 64, 98, 46, 99, 111, 0]);
        assert_eq!(utf16_nul("\u{e9}\u{1F600}"), vec![0xe9, 0xD83D, 0xDE00, 0]);
    }

    #[test]
    fn good_addresses_pass() {
        for good in ["priya@contoso.example", "marcus.veld+ops@northwind.example", "a@b.co", "o_brien-x@sub.contoso.example", "x@xn--caf-dma.example"] {
            assert!(valid_address(good), "{good}");
        }
        assert!(valid_address(&format!("{}@{}.example", "a".repeat(60), "b".repeat(60))));
    }

    #[test]
    fn hostile_addresses_fail_the_check() {
        let long_domain = format!("a@{}.example", "b".repeat(250));
        let at_limit = format!("{}@contoso.example", "a".repeat(254 - "@contoso.example".len()));
        assert!(valid_address(&at_limit) && at_limit.len() == 254);
        let over = format!("a{at_limit}");
        for bad in [
            "",
            "priya",
            "@contoso.example",
            "priya@",
            "priya@contoso",
            "priya@.example",
            "priya@contoso.",
            "a@@contoso.example",
            "a@b@contoso.example",
            "priya@contoso.example?cc=boss@evil.example",
            "priya@contoso.example?subject=hi",
            "priya@contoso.example&bcc=x@evil.example",
            "priya@contoso.example,boss@evil.example",
            "priya@contoso.example;boss@evil.example",
            "priya@contoso.example%0aBcc:boss@evil.example",
            "priya%40evil.example@contoso.example",
            "pri ya@contoso.example",
            "priya@contoso.example ",
            " priya@contoso.example",
            "priya@contoso.example\n",
            "priya\t@contoso.example",
            "priya\u{0}@contoso.example",
            "\"priya\"@contoso.example",
            "priya'@contoso.example",
            "<priya@contoso.example>",
            "Priya <priya@contoso.example>",
            "priya@contoso.example>",
            "priya\u{202E}@contoso.example",
            "pri\u{200B}ya@contoso.example",
            "priya@contoso.example\u{2028}",
            "priya\u{a0}@contoso.example",
            long_domain.as_str(),
            over.as_str(),
        ] {
            assert!(!valid_address(bad), "{bad:?}");
        }
    }

    #[test]
    fn mailto_has_no_query_and_encodes_the_unusual() {
        assert_eq!(mailto_url("priya@contoso.example").as_deref(), Some("mailto:priya@contoso.example"));
        assert_eq!(mailto_url("marcus.veld+ops@northwind.example").as_deref(), Some("mailto:marcus.veld+ops@northwind.example"));
        assert_eq!(mailto_url("o!brien@contoso.example").as_deref(), Some("mailto:o%21brien@contoso.example"));
        assert_eq!(mailto_url("caf\u{e9}@contoso.example").as_deref(), Some("mailto:caf%C3%A9@contoso.example"));
        for bad in ["a@b.example?cc=x@evil.example", "a@b.example,c@evil.example", "a@b.example%0aBcc:x", "a b@c.example"] {
            assert_eq!(mailto_url(bad), None, "{bad}");
        }
        // Whatever passes, the result carries no query separator and exactly one scheme colon.
        let url = mailto_url("a/b=c@contoso.example").unwrap();
        assert!(!url.contains('?') && !url.contains('&') && url.matches(':').count() == 1, "{url}");
    }

    #[test]
    fn teams_has_only_the_users_query() {
        assert_eq!(teams_url("priya@contoso.example").as_deref(), Some("https://teams.microsoft.com/l/chat/0/0?users=priya%40contoso.example"));
        assert_eq!(teams_url("a+b@contoso.example").as_deref(), Some("https://teams.microsoft.com/l/chat/0/0?users=a%2Bb%40contoso.example"));
        for bad in ["a@b.example&message=hi", "a@b.example?topicName=x", "a@b.example%26x", "x"] {
            assert_eq!(teams_url(bad), None, "{bad}");
        }
        let url = teams_url("a/b@contoso.example").unwrap();
        assert_eq!(url.matches('?').count(), 1);
        assert!(!url.contains('&'), "{url}");
        assert!(url.ends_with("users=a%2Fb%40contoso.example"));
    }

    #[test]
    fn a_plan_checks_the_address_first_for_every_action() {
        assert_eq!(plan(Action::Copy, "priya@contoso.example"), Ok(Plan::Copy("priya@contoso.example".into())));
        assert_eq!(plan(Action::Email, "priya@contoso.example"), Ok(Plan::Open("mailto:priya@contoso.example".into())));
        assert!(matches!(plan(Action::Teams, "priya@contoso.example"), Ok(Plan::Open(u)) if u.starts_with("https://teams.microsoft.com/l/chat/0/0?users=")));
        for action in [Action::Copy, Action::Email, Action::Teams] {
            for bad in ["a@b.example?cc=x", "a@b.example,c@d.example", "a@b.example%0a", "a@b.example\"x", "a@b.example'x", "nope"] {
                assert_eq!(plan(action, bad), Err("invalid"), "{action:?} {bad}");
            }
        }
        // An error is a fixed word, never the address.
        assert!(!plan(Action::Email, "secret?x@contoso.example").unwrap_err().contains("secret"));
    }

    #[test]
    fn action_words() {
        assert_eq!(action_of("copy"), Some(Action::Copy));
        assert_eq!(action_of("email"), Some(Action::Email));
        assert_eq!(action_of("teams"), Some(Action::Teams));
        for bad in ["", "Copy", "contact", "card", "open", "email ", "mailto"] {
            assert_eq!(action_of(bad), None, "{bad}");
        }
    }

    #[test]
    fn person_keys_have_a_fixed_shape() {
        for good in ["p1-0", "p12-34", "p1234567890123456789-9999"] {
            assert!(valid_person_key(good), "{good}");
        }
        let long = format!("p{}-0", "1".repeat(30));
        for bad in ["", "p", "p1", "p-1", "p1-", "P1-0", "p1-0x", "p1-12345", "1-0", "d1-0", "b1-0", " p1-0", "p1--0", "p\u{661}-0", long.as_str()] {
            assert!(!valid_person_key(bad), "{bad:?}");
        }
    }

    #[test]
    fn a_key_from_an_older_read_is_refused() {
        use super::super::service::{lookup_person, Links};
        use std::collections::HashMap;
        use std::sync::Mutex;
        let mut links = Links { generation: 2, ..Default::default() };
        links.person_map = HashMap::from([("p2-0".to_string(), ("work".to_string(), "priya@contoso.example".to_string()))]);
        let links = Mutex::new(links);
        assert_eq!(lookup_person(&links, "p2-0").as_deref(), Some("priya@contoso.example"));
        // Well formed, but from the read before.
        assert!(valid_person_key("p1-0"));
        assert_eq!(lookup_person(&links, "p1-0"), None);
        // Clearing the map on the next read refuses the old key too.
        links.lock().unwrap().person_map.clear();
        assert_eq!(lookup_person(&links, "p2-0"), None);
    }

    #[cfg(not(windows))]
    #[test]
    fn copy_fails_where_there_is_no_clipboard() {
        assert!(!write_clipboard("priya@contoso.example"));
    }
}
