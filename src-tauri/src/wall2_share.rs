//! Wall 2 Shelf "Share link": one capture uploaded to go-ae.org, the short link on the clipboard.
//!
//! What the page can and cannot do:
//! - `wall2_captures_share` takes only a capture id. Rust resolves it to the file with the same
//!   rules as Open and Copy (`wall2_captures::path_for`, which runs `resolve`: an allowed local
//!   path, a regular file, an allowed extension, checked again after links are followed). The page
//!   never sends or receives a path.
//! - A file over 100 MB is refused from its metadata, before it is read.
//! - The upload key is typed once in Tools and kept in Windows Credential Manager at
//!   `crate::wall2_oauth::credential_target("share", "upload", 0)` (`WidgetWall2/share/upload/0`),
//!   with the desk token's store trait and value rule. Only Rust reads it. The page learns whether
//!   one is set (`set`, `unreadable`) and nothing else. The key can only upload.
//! - The upload is one POST of the file's bytes to `https://go-ae.org/api/share` with the key as a
//!   bearer token, the file's name only (no folder, safe characters, capped) in `X-Filename`, and
//!   `X-Share-Source: wall`. The answer must be a 201 whose `url` starts with exactly
//!   `https://go-ae.org/s/` followed by a short URL-safe code; anything else is `failed`.
//! - The link goes on the clipboard as text and is the only thing the page gets back.
//! - Nothing is logged or put in an error: not the key, the path, the file name or the link.
//!
//! Errors are fixed words: `no-key` (none saved, or the saved one cannot be read), `bad-key` (the
//! server answered 401 or 403), `too-big` (over 100 MB, or a 413), `missing` (the id or the file is
//! gone, or the path does not pass the capture rules), `failed`, `forbidden` (the wrong window).
//! The key commands answer `invalid` (a value that breaks the rule) or `failed`.

use crate::wall2_desk_token::{forget_with, read_with, set_with, status_with, TokenStatus, TokenStore};
use crate::wall2_meet::store::{BlobStore, CredBlobs, Fetch};
use std::io::Read;
use std::time::Duration;

const ENDPOINT: &str = "https://go-ae.org/api/share";
const URL_PREFIX: &str = "https://go-ae.org/s/";
/// The most the server takes: 100 MB.
pub(crate) const MAX_BYTES: u64 = 100 * 1024 * 1024;
const NAME_CHARS: usize = 100;
const CODE_CHARS: usize = 32;
const CONNECT_SECS: u64 = 10;
const OVERALL_SECS: u64 = 300;
/// The most of an answer that is read.
const ANSWER_BYTES: u64 = 8 * 1024;

pub(crate) const NO_KEY: &str = "no-key";
pub(crate) const BAD_KEY: &str = "bad-key";
pub(crate) const TOO_BIG: &str = "too-big";
pub(crate) const MISSING: &str = "missing";
pub(crate) const FAILED: &str = "failed";

// Section: the key

fn target() -> String {
    crate::wall2_oauth::credential_target("share", "upload", 0)
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

// Section: the upload

/// What one upload needs. The key is borrowed and never copied into a message.
pub(crate) struct Upload<'a> {
    pub key: &'a str,
    pub name: &'a str,
    pub path: &'a str,
    pub size: u64,
}

/// The server's answer. `status` is 0 when no answer came (no connection, a timeout, a read error).
pub(crate) struct Reply {
    pub status: u16,
    pub body: String,
}

/// The HTTP layer, so tests never touch the network.
pub(crate) trait Uploader {
    fn post(&self, up: &Upload) -> Reply;
}

struct RealUploader;

impl Uploader for RealUploader {
    fn post(&self, up: &Upload) -> Reply {
        let none = Reply { status: 0, body: String::new() };
        let Ok(file) = std::fs::File::open(up.path) else { return none };
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(CONNECT_SECS))
            .timeout(Duration::from_secs(OVERALL_SECS))
            .redirects(0)
            .build();
        let sent = agent
            .post(ENDPOINT)
            .set("Authorization", &format!("Bearer {}", up.key))
            .set("Content-Length", &up.size.to_string())
            .set("Content-Type", "application/octet-stream")
            .set("X-Filename", up.name)
            .set("X-Share-Source", "wall")
            .send(file.take(up.size));
        match sent {
            Ok(resp) | Err(ureq::Error::Status(_, resp)) => {
                let status = resp.status();
                let mut body = String::new();
                if resp.into_reader().take(ANSWER_BYTES).read_to_string(&mut body).is_err() {
                    body.clear();
                }
                Reply { status, body }
            }
            Err(_) => none,
        }
    }
}

/// The file name only (no folder), every character outside letters, digits, `.`, `-` and `_`
/// turned into `_`, no leading dot, at most `NAME_CHARS` long with a short extension kept.
pub(crate) fn safe_name(path: &str) -> String {
    let last = path.rsplit(['\\', '/']).next().unwrap_or("");
    let cleaned: String = last
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let cleaned = cleaned.trim_start_matches('.').to_string();
    if cleaned.is_empty() {
        return "capture".to_string();
    }
    if cleaned.chars().count() <= NAME_CHARS {
        return cleaned;
    }
    let (stem, ext) = match cleaned.rfind('.') {
        Some(i) if cleaned.len() - i <= 12 => (&cleaned[..i], &cleaned[i..]),
        _ => (cleaned.as_str(), ""),
    };
    let keep = NAME_CHARS.saturating_sub(ext.len());
    let short: String = stem.chars().take(keep).collect();
    format!("{short}{ext}")
}

/// The link in an answer, only when it is exactly `https://go-ae.org/s/<code>` with a short URL-safe code.
pub(crate) fn link_in(body: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    let url = v.get("url")?.as_str()?;
    let code = url.strip_prefix(URL_PREFIX)?;
    let ok = !code.is_empty() && code.len() <= CODE_CHARS && code.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    ok.then(|| url.to_string())
}

/// The whole job against injected parts: the held capture (`source` is the path and size, or why
/// not), the key store, the HTTP layer and the clipboard. Returns the link, or one fixed word.
pub(crate) fn share_with(
    source: Result<(String, u64), String>,
    store: &dyn TokenStore,
    http: &dyn Uploader,
    clip: &dyn Fn(&str) -> Result<(), String>,
) -> Result<String, String> {
    let (path, size) = source.map_err(|e| if e == FAILED { FAILED.to_string() } else { MISSING.to_string() })?;
    if size > MAX_BYTES {
        return Err(TOO_BIG.to_string());
    }
    let key = read_with(store).ok_or_else(|| NO_KEY.to_string())?;
    let name = safe_name(&path);
    let reply = http.post(&Upload { key: &key, name: &name, path: &path, size });
    let url = match reply.status {
        201 => link_in(&reply.body).ok_or_else(|| FAILED.to_string())?,
        401 | 403 => return Err(BAD_KEY.to_string()),
        413 => return Err(TOO_BIG.to_string()),
        _ => return Err(FAILED.to_string()),
    };
    clip(&url).map_err(|_| FAILED.to_string())?;
    Ok(url)
}

fn share_now(id: &str) -> Result<String, String> {
    share_with(crate::wall2_captures::path_for(id), &RealStore, &RealUploader, &|t| crate::wall2_captures::copy_text(t))
}

// Section: commands (wall2 window only; blocking work off the async thread)

/// Upload one capture by id and put its short link on the clipboard. Answers the link.
#[tauri::command]
pub async fn wall2_captures_share(window: tauri::WebviewWindow, id: String) -> Result<String, String> {
    crate::wall2_meet::require_wall2(window.label())?;
    crate::wall2_desk::off_thread(move || share_now(&id)).await
}

#[tauri::command]
pub async fn wall2_share_key_status(window: tauri::WebviewWindow) -> Result<TokenStatus, String> {
    crate::wall2_meet::require_wall2(window.label())?;
    crate::wall2_desk::off_thread(|| Ok(status_with(&RealStore))).await
}

#[tauri::command]
pub async fn wall2_share_key_set(window: tauri::WebviewWindow, key: String) -> Result<(), String> {
    crate::wall2_meet::require_wall2(window.label())?;
    crate::wall2_desk::off_thread(move || set_with(&RealStore, &key)).await
}

#[tauri::command]
pub async fn wall2_share_key_forget(window: tauri::WebviewWindow) -> Result<(), String> {
    crate::wall2_meet::require_wall2(window.label())?;
    crate::wall2_desk::off_thread(|| forget_with(&RealStore)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    const KEY: &str = "example-upload-key-0123456789";
    const GOOD: &str = r#"{"url":"https://go-ae.org/s/k7Qm2x","code":"k7Qm2x","kind":"image","size":10}"#;

    #[derive(Default)]
    struct Fake {
        value: RefCell<Option<String>>,
        read_fails: Cell<bool>,
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
            *self.value.borrow_mut() = Some(value.to_string());
            true
        }
        fn delete(&self) {
            *self.value.borrow_mut() = None;
        }
    }

    fn keyed() -> Fake {
        let f = Fake::default();
        set_with(&f, KEY).unwrap();
        f
    }

    /// A fake HTTP layer: one canned answer, and a record of what it was asked.
    struct Http {
        status: u16,
        body: String,
        seen: RefCell<Vec<(String, String, u64)>>,
    }

    impl Http {
        fn new(status: u16, body: &str) -> Http {
            Http { status, body: body.to_string(), seen: RefCell::new(Vec::new()) }
        }
    }

    impl Uploader for Http {
        fn post(&self, up: &Upload) -> Reply {
            self.seen.borrow_mut().push((up.key.to_string(), up.name.to_string(), up.size));
            Reply { status: self.status, body: self.body.clone() }
        }
    }

    fn src(size: u64) -> Result<(String, u64), String> {
        Ok((r"C:\Users\example\Pictures\Sales overview.png".to_string(), size))
    }

    fn run(source: Result<(String, u64), String>, store: &Fake, http: &Http) -> (Result<String, String>, Vec<String>) {
        let copied = RefCell::new(Vec::new());
        let r = share_with(source, store, http, &|t| {
            copied.borrow_mut().push(t.to_string());
            Ok(())
        });
        (r, copied.into_inner())
    }

    #[test]
    fn success_returns_the_link_and_puts_it_on_the_clipboard() {
        let http = Http::new(201, GOOD);
        let (r, copied) = run(src(1234), &keyed(), &http);
        assert_eq!(r, Ok("https://go-ae.org/s/k7Qm2x".to_string()));
        assert_eq!(copied, vec!["https://go-ae.org/s/k7Qm2x".to_string()]);
        let seen = http.seen.borrow();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0], (KEY.to_string(), "Sales_overview.png".to_string(), 1234));
    }

    #[test]
    fn no_key_is_no_key_and_nothing_is_sent() {
        let http = Http::new(201, GOOD);
        let (r, copied) = run(src(10), &Fake::default(), &http);
        assert_eq!(r, Err(NO_KEY.to_string()));
        assert!(http.seen.borrow().is_empty());
        assert!(copied.is_empty());
        // A store that cannot be read is the same word.
        let broken = Fake::default();
        broken.read_fails.set(true);
        assert_eq!(run(src(10), &broken, &http).0, Err(NO_KEY.to_string()));
        assert!(http.seen.borrow().is_empty());
    }

    #[test]
    fn a_refused_key_is_bad_key() {
        for status in [401u16, 403] {
            let http = Http::new(status, r#"{"error":"unauthorized"}"#);
            let (r, copied) = run(src(10), &keyed(), &http);
            assert_eq!(r, Err(BAD_KEY.to_string()));
            assert!(copied.is_empty());
        }
    }

    #[test]
    fn a_413_is_too_big() {
        let http = Http::new(413, r#"{"error":"too-big"}"#);
        assert_eq!(run(src(10), &keyed(), &http).0, Err(TOO_BIG.to_string()));
    }

    #[test]
    fn the_size_check_comes_before_any_read_or_send() {
        let http = Http::new(201, GOOD);
        assert_eq!(run(src(MAX_BYTES + 1), &keyed(), &http).0, Err(TOO_BIG.to_string()));
        assert!(http.seen.borrow().is_empty());
        // Exactly 100 MB is allowed.
        assert!(run(src(MAX_BYTES), &keyed(), &http).0.is_ok());
    }

    #[test]
    fn a_gone_or_refused_file_is_missing() {
        let http = Http::new(201, GOOD);
        for why in ["missing", "refused", "anything"] {
            assert_eq!(run(Err(why.to_string()), &keyed(), &http).0, Err(MISSING.to_string()));
        }
        assert_eq!(run(Err(FAILED.to_string()), &keyed(), &http).0, Err(FAILED.to_string()));
        assert!(http.seen.borrow().is_empty());
    }

    #[test]
    fn other_statuses_and_no_answer_are_failed() {
        for status in [0u16, 200, 400, 404, 429, 500, 502] {
            let http = Http::new(status, GOOD);
            assert_eq!(run(src(10), &keyed(), &http).0, Err(FAILED.to_string()), "{status}");
        }
    }

    #[test]
    fn a_malformed_or_foreign_link_is_failed_and_not_copied() {
        let long = format!(r#"{{"url":"https://go-ae.org/s/{}"}}"#, "a".repeat(33));
        let bodies = [
            "",
            "not json",
            "{}",
            r#"{"url":42}"#,
            r#"{"url":"https://evil.example/s/abc"}"#,
            r#"{"url":"http://go-ae.org/s/abc"}"#,
            r#"{"url":"https://go-ae.org.evil.example/s/abc"}"#,
            r#"{"url":"https://go-ae.org/s/"}"#,
            r#"{"url":"https://go-ae.org/s/a/b"}"#,
            r#"{"url":"https://go-ae.org/s/a b"}"#,
            r#"{"url":"https://go-ae.org/s/abc?x=1"}"#,
            r#"{"url":"https://go-ae.org/s/abc#x"}"#,
            r#"{"url":"https://go-ae.org/api/share"}"#,
            r#"{"url":"https://go-ae.org/s/ab\ncd"}"#,
            long.as_str(),
        ];
        for body in bodies {
            let http = Http::new(201, body);
            let (r, copied) = run(src(10), &keyed(), &http);
            assert_eq!(r, Err(FAILED.to_string()), "{body}");
            assert!(copied.is_empty(), "{body}");
        }
    }

    #[test]
    fn a_clipboard_that_fails_is_failed() {
        let http = Http::new(201, GOOD);
        let r = share_with(src(10), &keyed(), &http, &|_| Err("failed".to_string()));
        assert_eq!(r, Err(FAILED.to_string()));
    }

    #[test]
    fn file_names_are_only_the_name_with_safe_characters_and_a_cap() {
        assert_eq!(safe_name(r"C:\Users\example\Pictures\Sales overview.png"), "Sales_overview.png");
        assert_eq!(safe_name("/home/example/a.b.gif"), "a.b.gif");
        assert_eq!(safe_name(r"C:\x\y\name.mp4"), "name.mp4");
        assert_eq!(safe_name("caf\u{e9}\r\n\t:*?.png"), "caf_______.png");
        assert_eq!(safe_name(r"C:\x\.hidden"), "hidden");
        assert_eq!(safe_name(r"C:\x\..."), "capture");
        assert_eq!(safe_name(""), "capture");
        let long = format!(r"C:\x\{}.png", "a".repeat(300));
        let got = safe_name(&long);
        assert_eq!(got.chars().count(), NAME_CHARS);
        assert!(got.ends_with(".png"));
        let no_ext = safe_name(&"b".repeat(300));
        assert_eq!(no_ext.chars().count(), NAME_CHARS);
        assert!(safe_name(&long).chars().all(|c| c.is_ascii_graphic()));
    }

    #[test]
    fn the_key_is_never_in_any_answer() {
        let mut answers: Vec<String> = Vec::new();
        for status in [0u16, 201, 401, 403, 413, 500] {
            // The server echoing the key back must not change what the page sees.
            let body = format!(r#"{{"error":"{KEY}","url":"https://evil.example/{KEY}"}}"#);
            let http = Http::new(status, &body);
            if let Err(e) = run(src(10), &keyed(), &http).0 {
                answers.push(e);
            }
        }
        answers.push(run(src(10), &Fake::default(), &Http::new(201, GOOD)).0.unwrap_err());
        answers.push(run(Err(KEY.to_string()), &keyed(), &Http::new(201, GOOD)).0.unwrap_err());
        assert!(answers.len() >= 7);
        for a in answers {
            assert!(!a.contains(KEY), "{a}");
            assert!(["no-key", "bad-key", "too-big", "missing", "failed"].contains(&a.as_str()), "{a}");
        }
        let shown = format!("{:?}", status_with(&keyed()));
        assert!(!shown.contains(KEY));
        assert_eq!(serde_json::to_string(&status_with(&keyed())).unwrap(), "{\"set\":true,\"unreadable\":false}");
    }

    #[test]
    fn the_credential_target_is_the_share_upload_one() {
        assert_eq!(target(), "WidgetWall2/share/upload/0");
        assert_ne!(target(), crate::wall2_oauth::credential_target("home", "desk", 0));
    }

    #[test]
    fn only_the_wall_window_may_ask_and_it_is_checked_first() {
        assert!(crate::wall2_meet::require_wall2("main").is_err());
        let src = include_str!("wall2_share.rs").replace("\r\n", "\n");
        for name in ["wall2_captures_share", "wall2_share_key_status", "wall2_share_key_set", "wall2_share_key_forget"] {
            let needle = format!("pub async fn {}(", name);
            let at = src.find(&needle).expect("command");
            let body = &src[at..];
            let open = body.find('{').expect("body");
            let first = body[open + 1..].trim_start();
            assert!(first.starts_with("crate::wall2_meet::require_wall2(window.label())?;"), "{name}");
        }
    }

    #[test]
    fn the_source_never_logs() {
        let src = include_str!("wall2_share.rs").replace("\r\n", "\n");
        for m in ["print", "eprint", "dbg", "log", "info", "warn", "debug"] {
            assert!(!src.contains(&format!("{m}!(")), "{m}");
        }
    }
}
