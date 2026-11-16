//! Bounded fixed-word diagnostics for the YouTube sign-in. Only enum words and numbers are
//! accepted: no id, token, client value, title or query can reach the log by construction.

use std::io::Write;
use std::sync::mpsc::SyncSender;
use std::sync::OnceLock;

const LOG_CAP: usize = 64 * 1024;
static TX: OnceLock<SyncSender<String>> = OnceLock::new();

#[derive(Clone, Copy)]
pub enum Event { SignInStart, SignInOk, SignInFailed, SignOut, RevokeFailed, RefreshOk, RefreshRefused, RefreshFailed, ClientSaved, ClientForgotten, ReadOk, ReadFailed, SearchOk, SearchFailed, LiveOk, LiveFailed, ChatOk, ChatFailed }
impl Event {
    fn word(self) -> &'static str {
        match self {
            Self::SignInStart => "sign-in-start",
            Self::SignInOk => "sign-in-ok",
            Self::SignInFailed => "sign-in-failed",
            Self::SignOut => "sign-out",
            Self::RevokeFailed => "revoke-failed",
            Self::RefreshOk => "refresh-ok",
            Self::RefreshRefused => "refresh-refused",
            Self::RefreshFailed => "refresh-failed",
            Self::ClientSaved => "client-saved",
            Self::ClientForgotten => "client-forgotten",
            Self::ReadOk => "read-ok",
            Self::ReadFailed => "read-failed",
            Self::SearchOk => "search-ok",
            Self::SearchFailed => "search-failed",
            Self::LiveOk => "live-ok",
            Self::LiveFailed => "live-failed",
            Self::ChatOk => "chat-ok",
            Self::ChatFailed => "chat-failed",
        }
    }
}

#[derive(Clone, Copy)]
pub enum Reason { None, Busy, Down, Failed, SignInAgain, SetupBroken, Denied, Cancelled, TimedOut, Quota, QuotaAll, NotFound, Invalid, Ended }
impl Reason {
    fn word(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Busy => "busy",
            Self::Down => "down",
            Self::Failed => "failed",
            Self::SignInAgain => "sign-in-again",
            Self::SetupBroken => "setup-broken",
            Self::Denied => "denied",
            Self::Cancelled => "cancelled",
            Self::TimedOut => "timed-out",
            Self::Quota => "quota",
            Self::QuotaAll => "quota-all",
            Self::NotFound => "not-found",
            Self::Invalid => "invalid",
            Self::Ended => "ended",
        }
    }
}

pub fn line(event: Event, reason: Reason, status: u16, elapsed_ms: u128) -> String {
    format!("{} {} {} {}\n", event.word(), reason.word(), status, elapsed_ms.min(999_999))
}

#[cfg(test)]
static TEST_LINES: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

/// Tests only: every line written so far, in order.
#[cfg(test)]
pub fn test_lines() -> Vec<String> {
    TEST_LINES.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

pub fn write(event: Event, reason: Reason, status: u16, elapsed_ms: u128) {
    let text = line(event, reason, status, elapsed_ms);
    #[cfg(test)]
    TEST_LINES.lock().unwrap_or_else(|e| e.into_inner()).push(text.clone());
    if let Some(tx) = TX.get() { let _ = tx.try_send(text); }
}

pub fn start(dir: Option<std::path::PathBuf>) {
    let Some(dir) = dir else { return };
    let _ = std::fs::create_dir_all(&dir);
    let Ok(mut file) = std::fs::File::create(dir.join("wall2-youtube.log")) else { return };
    let (tx, rx) = std::sync::mpsc::sync_channel::<String>(64);
    if std::thread::Builder::new().name("wall2-youtube-log".into()).spawn(move || {
        let mut bytes = 0usize;
        while let Ok(line) = rx.recv() {
            if bytes + line.len() <= LOG_CAP && file.write_all(line.as_bytes()).is_ok() { bytes += line.len(); }
        }
    }).is_ok() { let _ = TX.set(tx); }
}

#[cfg(test)]
mod tests {
    use super::*;
    const EVENTS: [Event; 18] = [Event::SignInStart, Event::SignInOk, Event::SignInFailed, Event::SignOut, Event::RevokeFailed, Event::RefreshOk, Event::RefreshRefused, Event::RefreshFailed, Event::ClientSaved, Event::ClientForgotten, Event::ReadOk, Event::ReadFailed, Event::SearchOk, Event::SearchFailed, Event::LiveOk, Event::LiveFailed, Event::ChatOk, Event::ChatFailed];
    const REASONS: [Reason; 14] = [Reason::None, Reason::Busy, Reason::Down, Reason::Failed, Reason::SignInAgain, Reason::SetupBroken, Reason::Denied, Reason::Cancelled, Reason::TimedOut, Reason::Quota, Reason::QuotaAll, Reason::NotFound, Reason::Invalid, Reason::Ended];

    #[test]
    fn every_event_and_reason_renders_to_fixed_words_and_numbers_only() {
        let got = line(Event::RefreshRefused, Reason::SignInAgain, 400, 42);
        assert_eq!(got, "refresh-refused sign-in-again 400 42\n");
        assert_eq!(line(Event::SearchFailed, Reason::QuotaAll, 403, 7), "search-failed quota-all 403 7\n");
        assert_eq!(line(Event::ReadFailed, Reason::NotFound, 404, 7), "read-failed not-found 404 7\n");
        assert_eq!(line(Event::ReadOk, Reason::Invalid, 400, 1), "read-ok invalid 400 1\n");
        assert_eq!(line(Event::SearchOk, Reason::Quota, 200, 1), "search-ok quota 200 1\n");
        for event in EVENTS {
            for reason in REASONS {
                let text = line(event, reason, 503, 1_000_000_000);
                assert!(text.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'-' | b' ' | b'\n')), "{text}");
                let fields: Vec<_> = text.trim_end().split(' ').collect();
                assert_eq!(fields.len(), 4);
                assert!(fields[2].bytes().all(|b| b.is_ascii_digit()));
                assert_eq!(fields[3], "999999");
            }
        }
    }
}
