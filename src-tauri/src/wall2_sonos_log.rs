//! Bounded fixed-word diagnostics for the sound service reads. One line for each failed
//! read and one for each slow successful read. Only fixed words and numbers are ever
//! written: no room, speaker, routine or track name, no address, no body. The log exists
//! to tell a slow answer from no answer when the wall's Sound card reports a failed read.

use std::io::Write;
use std::sync::mpsc::SyncSender;
use std::sync::OnceLock;

const LOG_CAP: usize = 64 * 1024;
static TX: OnceLock<SyncSender<String>> = OnceLock::new();

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Event { Failed, Slow }
impl Event {
    fn word(self) -> &'static str { match self { Self::Failed => "failed", Self::Slow => "slow" } }
}

/// Which read a line is about. `Lists` is the whole answer set refused for an over-long list.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Read { Status, Speakers, Routines, Groups, Presets, Scenes, Timers, Lists }
impl Read {
    fn word(self) -> &'static str {
        match self {
            Self::Status => "status", Self::Speakers => "speakers", Self::Routines => "routines", Self::Groups => "groups",
            Self::Presets => "presets", Self::Scenes => "scenes", Self::Timers => "timers", Self::Lists => "lists",
        }
    }
}

/// The kind of a failed read. The same words reach the page as the summary's error text.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind { None, TimedOut, NoAnswer, BadAnswer }
impl Kind {
    pub fn word(self) -> &'static str {
        match self { Self::None => "none", Self::TimedOut => "timed-out", Self::NoAnswer => "no-answer", Self::BadAnswer => "bad-answer" }
    }
}

/// `<event> <read> <kind> <http status or 0> <milliseconds>`, newline ended.
pub fn line(event: Event, read: Read, kind: Kind, status: u16, elapsed_ms: u128) -> String {
    format!("{} {} {} {} {}\n", event.word(), read.word(), kind.word(), status, elapsed_ms.min(999_999))
}

pub fn write_line(line: String) {
    if let Some(tx) = TX.get() { let _ = tx.try_send(line); }
}

pub fn start(dir: Option<std::path::PathBuf>) {
    let Some(dir) = dir else { return };
    let _ = std::fs::create_dir_all(&dir);
    let Ok(mut file) = std::fs::File::create(dir.join("wall2-sonos.log")) else { return };
    let (tx, rx) = std::sync::mpsc::sync_channel::<String>(64);
    if std::thread::Builder::new().name("wall2-sonos-log".into()).spawn(move || {
        let mut bytes = 0usize;
        while let Ok(line) = rx.recv() {
            if bytes + line.len() <= LOG_CAP && file.write_all(line.as_bytes()).is_ok() { bytes += line.len(); }
        }
    }).is_ok() { let _ = TX.set(tx); }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EVENTS: [Event; 2] = [Event::Failed, Event::Slow];
    const READS: [Read; 8] = [Read::Status, Read::Speakers, Read::Routines, Read::Groups, Read::Presets, Read::Scenes, Read::Timers, Read::Lists];
    const KINDS: [Kind; 4] = [Kind::None, Kind::TimedOut, Kind::NoAnswer, Kind::BadAnswer];

    #[test]
    fn each_kind_and_a_slow_success_have_their_own_line() {
        assert_eq!(line(Event::Failed, Read::Status, Kind::TimedOut, 0, 4003), "failed status timed-out 0 4003\n");
        assert_eq!(line(Event::Failed, Read::Speakers, Kind::NoAnswer, 0, 12), "failed speakers no-answer 0 12\n");
        assert_eq!(line(Event::Failed, Read::Routines, Kind::BadAnswer, 503, 87), "failed routines bad-answer 503 87\n");
        assert_eq!(line(Event::Slow, Read::Status, Kind::None, 200, 2310), "slow status none 200 2310\n");
    }

    #[test]
    fn no_line_holds_anything_but_fixed_words_and_numbers() {
        let words = ["failed", "slow", "status", "speakers", "routines", "groups", "presets", "scenes", "timers", "lists", "none", "timed-out", "no-answer", "bad-answer"];
        for event in EVENTS {
            for read in READS {
                for kind in KINDS {
                    let got = line(event, read, kind, 599, 1_000_000_000_000);
                    assert!(got.ends_with('\n') && got.matches('\n').count() == 1);
                    let fields: Vec<&str> = got.trim_end().split(' ').collect();
                    assert_eq!(fields.len(), 5);
                    for f in &fields[..3] { assert!(words.contains(f), "unexpected word {f}"); }
                    assert!(fields[3].bytes().all(|b| b.is_ascii_digit()));
                    assert!(fields[4].bytes().all(|b| b.is_ascii_digit()));
                    assert_eq!(fields[4], "999999");
                }
            }
        }
    }
}
