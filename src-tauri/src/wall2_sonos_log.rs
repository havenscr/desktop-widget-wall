//! Bounded fixed-word diagnostics for the sound service reads. One line for each failed
//! read and one for each slow successful read. Only fixed words and numbers are ever
//! written: no room, speaker, routine or track name, no address, no body. The log exists
//! to tell a slow answer from no answer when the wall's Sound card reports a failed read.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc::SyncSender;
use std::sync::OnceLock;

/// One file holds at most about this much; at the cap it moves to `wall2-sonos.log.1`.
const LOG_CAP: u64 = 64 * 1024;
const NAME: &str = "wall2-sonos.log";
const OLDER: &str = "wall2-sonos.log.1";
static TX: OnceLock<SyncSender<String>> = OnceLock::new();

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Event { Failed, Slow }
impl Event {
    fn word(self) -> &'static str { match self { Self::Failed => "failed", Self::Slow => "slow" } }
}

/// Which read a line is about. `Lists` is the whole answer set refused for an over-long list.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Read { Status, Speakers, Routines, Groups, Presets, Scenes, Timers, Capabilities, Lists, Art }
impl Read {
    fn word(self) -> &'static str {
        match self {
            Self::Status => "status", Self::Speakers => "speakers", Self::Routines => "routines", Self::Groups => "groups",
            Self::Presets => "presets", Self::Scenes => "scenes", Self::Timers => "timers", Self::Capabilities => "capabilities",
            Self::Lists => "lists", Self::Art => "art",
        }
    }
}

/// The kind of a failed read. The same words reach the page as the summary's error text. The last
/// three are only for a cover art fetch: an address not on the allow list, a body over the size
/// limit, and a body that does not begin as a JPEG, PNG or WebP picture.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind { None, TimedOut, NoAnswer, BadAnswer, Refused, TooBig, NotImage }
impl Kind {
    pub fn word(self) -> &'static str {
        match self {
            Self::None => "none", Self::TimedOut => "timed-out", Self::NoAnswer => "no-answer", Self::BadAnswer => "bad-answer",
            Self::Refused => "refused", Self::TooBig => "too-big", Self::NotImage => "not-image",
        }
    }
}

/// `<event> <read> <kind> <http status or 0> <milliseconds>`, newline ended.
pub fn line(event: Event, read: Read, kind: Kind, status: u16, elapsed_ms: u128) -> String {
    format!("{} {} {} {} {}\n", event.word(), read.word(), kind.word(), status, elapsed_ms.min(999_999))
}

pub fn write_line(line: String) {
    if let Some(tx) = TX.get() { let _ = tx.try_send(line); }
}

/// The log files: the current one, opened for append (a start never truncates it), and one older
/// file. When a line would pass the cap the current file moves to the older name (replacing an
/// older one) and a new file starts, so the two never pass about twice the cap and the newest lines
/// are always in the current file. Nothing here panics or blocks a read: a file that cannot be
/// opened, moved or written drops its lines.
pub(crate) struct Writer {
    dir: PathBuf,
    /// The current file's name and the older file's name (one pair for each log that shares this code).
    name: &'static str,
    older: &'static str,
    cap: u64,
    file: Option<File>,
    bytes: u64,
    /// The file is over the cap and could neither be moved nor removed: lines are dropped (never
    /// written past the cap) until a later attempt succeeds.
    stuck: bool,
    /// How files are moved and removed (the real ones; tests swap in failing ones).
    mv: fn(&Path, &Path) -> std::io::Result<()>,
    rm: fn(&Path) -> std::io::Result<()>,
}

impl Writer {
    #[cfg(test)]
    fn open(dir: &Path, cap: u64) -> Option<Writer> {
        Writer::open_named(dir, cap, NAME, OLDER)
    }

    /// The same writer for another log file (the media and weather logs share this code).
    pub(crate) fn open_named(dir: &Path, cap: u64, name: &'static str, older: &'static str) -> Option<Writer> {
        std::fs::create_dir_all(dir).ok()?;
        let file = OpenOptions::new().create(true).append(true).open(dir.join(name)).ok()?;
        let bytes = file.metadata().map(|m| m.len()).unwrap_or(0);
        Some(Writer { dir: dir.to_path_buf(), name, older, cap, file: Some(file), bytes, stuck: false, mv: |a, b| std::fs::rename(a, b), rm: |a| std::fs::remove_file(a) })
    }

    /// Moves the current file aside and starts a new one. False when neither moving nor removing the
    /// current file worked: the file is left alone and nothing more is written to it.
    fn rotate(&mut self) -> bool {
        self.file = None;
        let current = self.dir.join(self.name);
        if (self.mv)(&current, &self.dir.join(self.older)).is_err() && (self.rm)(&current).is_err() {
            self.stuck = true;
            return false;
        }
        self.stuck = false;
        self.bytes = 0;
        self.file = OpenOptions::new().create(true).append(true).open(&current).ok();
        true
    }

    pub(crate) fn write(&mut self, line: &str) {
        let full = self.file.is_some() && self.bytes > 0 && self.bytes + line.len() as u64 > self.cap;
        if (self.stuck || full) && !self.rotate() {
            return;
        }
        if self.file.is_none() {
            self.file = OpenOptions::new().create(true).append(true).open(self.dir.join(self.name)).ok();
            self.bytes = self.file.as_ref().and_then(|f| f.metadata().ok()).map_or(0, |m| m.len());
        }
        if let Some(f) = self.file.as_mut() {
            if f.write_all(line.as_bytes()).is_ok() {
                self.bytes += line.len() as u64;
            } else {
                self.file = None;
            }
        }
    }
}

/// Starts a logging thread for one named log and returns the sender for its lines (the media and
/// weather logs use this; each keeps its own sender). None when the folder cannot be used.
pub(crate) fn start_named(dir: &Path, name: &'static str, older: &'static str, thread: &str) -> Option<SyncSender<String>> {
    let mut writer = Writer::open_named(dir, LOG_CAP, name, older)?;
    let (tx, rx) = std::sync::mpsc::sync_channel::<String>(64);
    std::thread::Builder::new().name(thread.into()).spawn(move || {
        while let Ok(line) = rx.recv() {
            writer.write(&line);
        }
    }).ok()?;
    Some(tx)
}

pub fn start(dir: Option<PathBuf>) {
    let Some(dir) = dir else { return };
    if let Some(tx) = start_named(&dir, NAME, OLDER, "wall2-sonos-log") { let _ = TX.set(tx); }
}

/// `YYYY-MM-DDTHH:MM:SSZ` for a Unix time in seconds (UTC), the time stamp of the media and weather logs.
pub(crate) fn stamp(unix_secs: i64) -> String {
    let (y, m, d) = crate::wall2_meet::civil_from_days(unix_secs.div_euclid(86_400));
    let rem = unix_secs.rem_euclid(86_400);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    const EVENTS: [Event; 2] = [Event::Failed, Event::Slow];
    const READS: [Read; 10] = [Read::Status, Read::Speakers, Read::Routines, Read::Groups, Read::Presets, Read::Scenes, Read::Timers, Read::Capabilities, Read::Lists, Read::Art];
    const KINDS: [Kind; 7] = [Kind::None, Kind::TimedOut, Kind::NoAnswer, Kind::BadAnswer, Kind::Refused, Kind::TooBig, Kind::NotImage];

    #[test]
    fn stamp_formats_utc_time() {
        assert_eq!(stamp(0), "1970-01-01T00:00:00Z");
        assert_eq!(stamp(1_700_000_000), "2023-11-14T22:13:20Z");
        assert_eq!(stamp(86_399), "1970-01-01T23:59:59Z");
    }

    #[test]
    fn a_named_writer_uses_its_own_file_names() {
        let t = Tmp::new("named");
        let mut w = Writer::open_named(&t.0, 20, "other.log", "other.log.1").unwrap();
        for i in 0..4 {
            w.write(&numbered(i));
        }
        assert!(read(&t.0, "other.log").ends_with(&numbered(3)));
        assert!(!read(&t.0, "other.log.1").is_empty());
        assert_eq!(read(&t.0, NAME), "");
    }

    #[test]
    fn each_kind_and_a_slow_success_have_their_own_line() {
        assert_eq!(line(Event::Failed, Read::Status, Kind::TimedOut, 0, 4003), "failed status timed-out 0 4003\n");
        assert_eq!(line(Event::Failed, Read::Speakers, Kind::NoAnswer, 0, 12), "failed speakers no-answer 0 12\n");
        assert_eq!(line(Event::Failed, Read::Routines, Kind::BadAnswer, 503, 87), "failed routines bad-answer 503 87\n");
        assert_eq!(line(Event::Slow, Read::Status, Kind::None, 200, 2310), "slow status none 200 2310\n");
        assert_eq!(line(Event::Failed, Read::Capabilities, Kind::BadAnswer, 404, 6), "failed capabilities bad-answer 404 6\n");
        assert_eq!(line(Event::Failed, Read::Art, Kind::Refused, 0, 0), "failed art refused 0 0\n");
        assert_eq!(line(Event::Failed, Read::Art, Kind::TooBig, 200, 41), "failed art too-big 200 41\n");
        assert_eq!(line(Event::Failed, Read::Art, Kind::NotImage, 200, 7), "failed art not-image 200 7\n");
    }

    #[test]
    fn no_line_holds_anything_but_fixed_words_and_numbers() {
        let words = ["failed", "slow", "status", "speakers", "routines", "groups", "presets", "scenes", "timers", "capabilities", "lists", "art", "none", "timed-out", "no-answer", "bad-answer", "refused", "too-big", "not-image"];
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

    /// A fresh empty folder under the system temp folder, removed when dropped.
    struct Tmp(PathBuf);
    impl Tmp {
        fn new(tag: &str) -> Tmp {
            static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
            let n = N.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let dir = std::env::temp_dir().join(format!("wall2-sonos-log-test-{}-{tag}-{n}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            Tmp(dir)
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
    }

    fn read(dir: &Path, name: &str) -> String { std::fs::read_to_string(dir.join(name)).unwrap_or_default() }

    /// A numbered line of exactly 10 bytes ("line 0007" and a newline).
    fn numbered(i: usize) -> String { format!("line {i:04}\n") }

    #[test]
    fn an_existing_line_survives_a_restart_and_a_start_never_truncates() {
        let t = Tmp::new("restart");
        let mut a = Writer::open(&t.0, 1000).unwrap();
        a.write("failed status timed-out 0 4003\n");
        drop(a);
        let mut b = Writer::open(&t.0, 1000).unwrap();
        b.write("slow status none 200 2310\n");
        drop(b);
        assert_eq!(read(&t.0, NAME), "failed status timed-out 0 4003\nslow status none 200 2310\n");
        assert_eq!(read(&t.0, OLDER), "");
    }

    #[test]
    fn at_the_cap_the_file_moves_aside_and_the_newest_line_is_always_in_the_current_file() {
        let t = Tmp::new("rotate");
        let mut w = Writer::open(&t.0, 50).unwrap();
        let mut all = String::new();
        for i in 0..40 {
            let line = numbered(i);
            w.write(&line);
            all.push_str(&line);
            // The line just written is the last line of the current file, whatever rotated.
            assert!(read(&t.0, NAME).ends_with(&line), "line {i} is not the newest in the current file");
            assert!(std::fs::metadata(t.0.join(NAME)).unwrap().len() <= 50);
            assert!(std::fs::metadata(t.0.join(OLDER)).map_or(0, |m| m.len()) <= 50);
        }
        let older = read(&t.0, OLDER);
        assert!(!older.is_empty());
        // Older then current are the newest lines of the whole run, in order and unbroken.
        let kept = format!("{older}{}", read(&t.0, NAME));
        assert!(all.ends_with(&kept));
        assert!(kept.contains("line 0039\n") && !kept.contains("line 0000\n"));
    }

    #[test]
    fn a_restart_next_to_a_nearly_full_file_rotates_on_the_first_line() {
        let t = Tmp::new("full");
        let mut a = Writer::open(&t.0, 50).unwrap();
        for i in 0..5 {
            a.write(&numbered(i));
        }
        drop(a);
        let mut b = Writer::open(&t.0, 50).unwrap();
        b.write(&numbered(9));
        assert_eq!(read(&t.0, NAME), numbered(9));
        assert!(read(&t.0, OLDER).ends_with(&numbered(4)));
    }

    #[test]
    fn a_new_rotation_replaces_the_older_file() {
        let t = Tmp::new("replace");
        std::fs::create_dir_all(&t.0).unwrap();
        std::fs::write(t.0.join(OLDER), "stale old file\n").unwrap();
        let mut w = Writer::open(&t.0, 30).unwrap();
        for i in 0..6 {
            w.write(&numbered(i));
        }
        assert!(!read(&t.0, OLDER).contains("stale"));
    }

    #[test]
    fn when_the_file_can_neither_be_moved_nor_removed_nothing_more_is_written_until_it_can() {
        let t = Tmp::new("stuck");
        let mut w = Writer::open(&t.0, 30).unwrap();
        w.mv = |_, _| Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
        w.rm = |_| Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
        for i in 0..10 {
            w.write(&numbered(i));
        }
        // Three lines fit the 30 byte cap; every later attempt failed to rotate and dropped its line.
        assert_eq!(read(&t.0, NAME), format!("{}{}{}", numbered(0), numbered(1), numbered(2)));
        assert!(std::fs::metadata(t.0.join(NAME)).unwrap().len() <= 30);
        assert_eq!(read(&t.0, OLDER), "");
        assert!(w.stuck);
        // A later attempt that works rotates and the newest line is in the current file again.
        w.mv = |a, b| std::fs::rename(a, b);
        w.rm = |a| std::fs::remove_file(a);
        w.write(&numbered(10));
        assert!(!w.stuck);
        assert_eq!(read(&t.0, NAME), numbered(10));
        assert!(read(&t.0, OLDER).ends_with(&numbered(2)));
    }

    #[test]
    fn a_folder_that_cannot_be_used_is_harmless() {
        let t = Tmp::new("blocked");
        std::fs::create_dir_all(&t.0).unwrap();
        // A plain file where the folder should be: nothing can be created under it.
        let blocker = t.0.join("not-a-folder");
        std::fs::write(&blocker, "x").unwrap();
        assert!(Writer::open(&blocker.join("logs"), 100).is_none());
        start(Some(blocker.join("logs")));
        write_line("failed status none 0 1\n".to_string());
        start(None);
        // A writer whose file is gone drops its lines without a panic.
        let mut w = Writer::open(&t.0, 100).unwrap();
        w.file = None;
        std::fs::remove_dir_all(&t.0).unwrap();
        std::fs::write(&t.0, "now a file").unwrap();
        w.write("failed status none 0 1\n");
        w.write("failed status none 0 2\n");
        let _ = std::fs::remove_file(&t.0);
    }
}
