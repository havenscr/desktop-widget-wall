//! Bounded fixed-word diagnostics for Spotify. No outside text is accepted.

use std::io::Write;
use std::sync::mpsc::SyncSender;
use std::sync::OnceLock;

const LOG_CAP: usize = 64 * 1024;
static TX: OnceLock<SyncSender<String>> = OnceLock::new();

#[derive(Clone, Copy)]
pub enum Event { SignInStart, SignInOk, SignInFailed, SignOut, RefreshOk, RefreshRefused, ApiFailed }
impl Event {
    fn word(self) -> &'static str { match self { Self::SignInStart => "sign-in-start", Self::SignInOk => "sign-in-ok", Self::SignInFailed => "sign-in-failed", Self::SignOut => "sign-out", Self::RefreshOk => "refresh-ok", Self::RefreshRefused => "refresh-refused", Self::ApiFailed => "api-failed" } }
}

#[derive(Clone, Copy)]
pub enum Reason { None, Busy, Down, Failed, SignInAgain, NoDevice, PortBusy }
impl Reason {
    fn word(self) -> &'static str { match self { Self::None => "none", Self::Busy => "busy", Self::Down => "down", Self::Failed => "failed", Self::SignInAgain => "sign-in-again", Self::NoDevice => "no-device", Self::PortBusy => "port-busy" } }
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
        for event in [Event::SignInStart, Event::SignInOk, Event::SignInFailed, Event::SignOut, Event::RefreshOk, Event::RefreshRefused, Event::ApiFailed] {
            assert!(line(event, Reason::Failed, 0, 1).bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'-' | b' ' | b'\n')));
        }
        assert_eq!(device_line(4, 1, 2, 1), "no-device 4 1 2 1\n");
    }
}
