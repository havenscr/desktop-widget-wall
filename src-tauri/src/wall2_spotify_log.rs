//! Bounded fixed-word diagnostics for Spotify. No outside text is accepted.

use std::io::Write;
use std::sync::mpsc::SyncSender;
use std::sync::OnceLock;

const LOG_CAP: usize = 64 * 1024;
static TX: OnceLock<SyncSender<String>> = OnceLock::new();

#[derive(Clone, Copy)]
pub enum Event { SignInStart, SignInOk, SignInFailed, SignOut, RefreshOk, RefreshRefused, ApiFailed, CoverRefused, PageRead, PageFailed, StartLaunch }
impl Event {
    fn word(self) -> &'static str { match self { Self::SignInStart => "sign-in-start", Self::SignInOk => "sign-in-ok", Self::SignInFailed => "sign-in-failed", Self::SignOut => "sign-out", Self::RefreshOk => "refresh-ok", Self::RefreshRefused => "refresh-refused", Self::ApiFailed => "api-failed", Self::CoverRefused => "cover-refused", Self::PageRead => "page-read", Self::PageFailed => "page-failed", Self::StartLaunch => "start-launch" } }
}

#[derive(Clone, Copy)]
pub enum Reason { None, Busy, Down, Failed, SignInAgain, NoDevice, PortBusy, Missing, Changed, TooBig, Scope, NotAllowedUser, Premium, Market, BadRequest, Other, App, Uri }
impl Reason {
    fn word(self) -> &'static str { match self { Self::None => "none", Self::Busy => "busy", Self::Down => "down", Self::Failed => "failed", Self::SignInAgain => "sign-in-again", Self::NoDevice => "no-device", Self::PortBusy => "port-busy", Self::Missing => "missing", Self::Changed => "changed", Self::TooBig => "too-big", Self::Scope => "scope", Self::NotAllowedUser => "not-allowed-user", Self::Premium => "premium", Self::Market => "market", Self::BadRequest => "bad-request", Self::Other => "other", Self::App => "app", Self::Uri => "uri" } }
}

pub fn line(event: Event, reason: Reason, status: u16, elapsed_ms: u128) -> String {
    format!("{} {} {} {}\n", event.word(), reason.word(), status, elapsed_ms.min(999_999))
}

pub fn write(event: Event, reason: Reason, status: u16, elapsed_ms: u128) {
    if let Some(tx) = TX.get() { let _ = tx.try_send(line(event, reason, status, elapsed_ms)); }
}

pub fn write_devices(total: usize, computers: usize, phones: usize, other: usize) {
    if let Some(tx) = TX.get() {
        let _ = tx.try_send(device_line(total, computers, phones, other));
    }
}

fn device_line(total: usize, computers: usize, phones: usize, other: usize) -> String {
    format!("no-device {} {} {} {}\n", total.min(50), computers.min(50), phones.min(50), other.min(50))
}

/// One line when the launch script has answered: how it went and how many milliseconds it took.
pub fn write_start_launch(reason: Reason, elapsed_ms: u128) {
    write(Event::StartLaunch, reason, 0, elapsed_ms);
}

/// One line at the end of the wait: whole seconds until a computer appeared (`none` when it never
/// did), whether its name matched this PC, whether any was restricted, windows minimised.
pub fn write_start_end(seconds: Option<u64>, matched: bool, restricted: bool, minimised: usize) {
    if let Some(tx) = TX.get() {
        let _ = tx.try_send(start_end_line(seconds, matched, restricted, minimised));
    }
}

fn start_end_line(seconds: Option<u64>, matched: bool, restricted: bool, minimised: usize) -> String {
    let yes = |b: bool| if b { "yes" } else { "no" };
    let secs = seconds.map_or("none".to_string(), |s| s.min(999).to_string());
    format!("start-end {} {} {} {}\n", secs, yes(matched), yes(restricted), minimised.min(20))
}

pub fn start(dir: Option<std::path::PathBuf>) {
    let Some(dir) = dir else { return };
    let _ = std::fs::create_dir_all(&dir);
    let Ok(mut file) = std::fs::File::create(dir.join("wall2-spotify.log")) else { return };
    let (tx, rx) = std::sync::mpsc::sync_channel::<String>(64);
    if std::thread::Builder::new().name("wall2-spotify-log".into()).spawn(move || {
        let mut bytes = 0usize;
        while let Ok(line) = rx.recv() {
            if bytes + line.len() <= LOG_CAP && file.write_all(line.as_bytes()).is_ok() { bytes += line.len(); }
        }
    }).is_ok() { let _ = TX.set(tx); }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lines_contain_only_fixed_words_and_numbers() {
        let got = line(Event::ApiFailed, Reason::Down, 503, 42);
        assert_eq!(got, "api-failed down 503 42\n");
        let fields: Vec<_> = got.trim_end().split(' ').collect();
        assert_eq!(fields, ["api-failed", "down", "503", "42"]);
        assert!(fields[2].bytes().all(|b| b.is_ascii_digit()));
        assert!(fields[3].bytes().all(|b| b.is_ascii_digit()));
        for event in [Event::SignInStart, Event::SignInOk, Event::SignInFailed, Event::SignOut, Event::RefreshOk, Event::RefreshRefused, Event::ApiFailed, Event::CoverRefused, Event::PageRead, Event::PageFailed] {
            assert!(line(event, Reason::Failed, 0, 1).bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'-' | b' ' | b'\n')));
        }
        assert_eq!(line(Event::PageRead, Reason::None, 200, 80), "page-read none 200 80\n");
        assert_eq!(line(Event::PageFailed, Reason::TooBig, 200, 5), "page-failed too-big 200 5\n");
        for reason in [Reason::Missing, Reason::Changed, Reason::TooBig, Reason::Busy, Reason::Down, Reason::Scope, Reason::NotAllowedUser, Reason::Premium, Reason::Market, Reason::BadRequest, Reason::Other] {
            assert!(line(Event::PageFailed, reason, 0, 1).bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'-' | b' ' | b'\n')));
        }
        for (reason, word) in [(Reason::Scope, "scope"), (Reason::NotAllowedUser, "not-allowed-user"), (Reason::Premium, "premium"), (Reason::Market, "market"), (Reason::BadRequest, "bad-request"), (Reason::Other, "other")] {
            assert_eq!(line(Event::ApiFailed, reason, 403, 1), format!("api-failed {word} 403 1\n"));
        }
        assert_eq!(device_line(4, 1, 2, 1), "no-device 4 1 2 1\n");
        assert_eq!(line(Event::StartLaunch, Reason::App, 0, 1500), "start-launch app 0 1500\n");
        for reason in [Reason::App, Reason::Uri, Reason::Missing, Reason::Failed] {
            assert!(line(Event::StartLaunch, reason, 0, 1).bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'-' | b' ' | b'\n')));
        }
        assert_eq!(start_end_line(Some(7), true, false, 1), "start-end 7 yes no 1\n");
        assert_eq!(start_end_line(None, false, true, 0), "start-end none no yes 0\n");
        assert!(start_end_line(Some(7), true, false, 1).bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b' ' | b'\n')) );
    }
}
