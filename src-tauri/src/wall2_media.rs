//! Wall 2 media: which of Windows' media sessions the top player shows and controls.
//!
//! Windows names one session "current", but that session can be one that has ended while it
//! still says it plays (a video that reached its end, a player that stopped sending updates),
//! while another app really plays. The functions here are plain: they take plain facts about
//! each session and decide, so the choice is tested without Windows. The Windows calls that
//! gather the facts are in `lib.rs`. Nothing here reads a title or an artist; the log holds
//! app ids and fixed words only.

use std::collections::HashMap;
use std::sync::mpsc::SyncSender;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

/// A session counts as ended when its position plus the time since its last update is past
/// its end by more than this many seconds (the clock of a live player runs a little late).
pub const END_SLACK_S: f64 = 3.0;
/// A reported position this close to the end (either side) counts as "at the end".
pub const NEAR_END_S: f64 = 1.0;
/// At the end on two reads at least this far apart means stuck at the end.
pub const STUCK_AFTER_S: f64 = 3.0;
/// How much of a session's app id the log keeps.
const LOG_ID_CHARS: usize = 80;

const NAME: &str = "wall2-media.log";
const OLDER: &str = "wall2-media.log.1";
static TX: OnceLock<SyncSender<String>> = OnceLock::new();

/// The facts about one media session that decide the choice.
#[derive(Clone, Debug, PartialEq)]
pub struct Candidate {
    /// The session's app id (`SourceAppUserModelId`).
    pub source: String,
    /// The session's key (`session_keys`): its app id and its place among the sessions with that id.
    /// Two sessions of one app (two browser tabs) have two keys.
    pub key: String,
    /// Lower case status word: playing, paused, stopped, changing, opened, closed.
    pub status: &'static str,
    pub position_s: f64,
    /// The end of the timeline; zero or less when the session gives none.
    pub end_s: f64,
    /// Seconds since the session last updated its timeline (zero when unknown).
    pub since_update_s: f64,
    /// Windows names this one "current".
    pub current: bool,
}

impl Candidate {
    pub fn playing(&self) -> bool {
        self.status == "playing"
    }
    fn has_end(&self) -> bool {
        self.end_s.is_finite() && self.end_s > 0.0 && self.position_s.is_finite()
    }
}

/// Rule (a): playing, an end is known, and position plus the time since the last update is past
/// the end by more than three seconds.
pub fn past_end(c: &Candidate) -> bool {
    c.playing() && c.has_end() && c.position_s + c.since_update_s.max(0.0) > c.end_s + END_SLACK_S
}

/// How old (seconds) a near-end observation may be and still count: after a gap in reading (the
/// page hidden) the first read starts the two-reads clock again.
pub const NEAR_END_FORGET_S: f64 = 10.0;

/// Rule (b): the state kept per session key between reads. A session that keeps refreshing its
/// timeline at the end (so rule (a) never fires) is caught by its position staying within one
/// second of its end on two reads at least three seconds apart. The key, not the app id, so two
/// sessions of one app keep two clocks.
#[derive(Default, Debug)]
pub struct EndTracker {
    /// Per key: when it was first seen near its end, and when it was last observed.
    near: HashMap<String, (f64, f64)>,
}

impl EndTracker {
    /// Feeds one read of every session at `now_s` (any steady clock, in seconds) and returns,
    /// per session, whether it has been stuck at its end. A session that is not near its end,
    /// is gone, or was last observed more than ten seconds ago forgets its state.
    pub fn observe(&mut self, now_s: f64, cands: &[Candidate]) -> Vec<bool> {
        let mut next: HashMap<String, (f64, f64)> = HashMap::new();
        let mut out = Vec::with_capacity(cands.len());
        for c in cands {
            let near = c.playing() && c.has_end() && (c.end_s - c.position_s).abs() <= NEAR_END_S;
            if near {
                let known = next.get(&c.key).or_else(|| self.near.get(&c.key)).copied();
                let since = match known {
                    Some((since, last)) if now_s - last <= NEAR_END_FORGET_S => since,
                    _ => now_s,
                };
                next.insert(c.key.clone(), (since, now_s));
                out.push(now_s - since >= STUCK_AFTER_S);
            } else {
                out.push(false);
            }
        }
        self.near = next;
        out
    }
}

/// A key for each listed session that stays the same across reads while the same sessions exist:
/// the app id and the session's place (from zero, in list order) among those with that id, such as
/// `Example.App#0` and `Example.App#1`.
pub fn session_keys(sources: &[String]) -> Vec<String> {
    let mut seen: HashMap<&str, usize> = HashMap::new();
    sources
        .iter()
        .map(|id| {
            let n = seen.entry(id.as_str()).or_insert(0);
            let key = format!("{id}#{n}");
            *n += 1;
            key
        })
        .collect()
}

/// Which listed session a media command acts on: the one with this key, else the first with this app
/// id, else None (a targeted Wall 2 command must refuse). `keys` and `sources` are the
/// listed sessions' keys and app ids in list order.
pub fn resolve(keys: &[String], sources: &[String], key: Option<&str>, id: Option<&str>) -> Option<usize> {
    let key = key.map(str::trim).filter(|k| !k.is_empty());
    let id = id.map(str::trim).filter(|i| !i.is_empty());
    if let Some(k) = key {
        if let Some(i) = keys.iter().position(|x| x == k) {
            return Some(i);
        }
    }
    id.and_then(|id| sources.iter().position(|s| s == id))
}

#[derive(Debug, PartialEq, Eq)]
pub enum Target {
    Found(usize),
    Gone,
    Current,
}

/// Resolve an explicit Wall 2 target, refusing it when no listed session matches.
/// Other windows and commands with no target keep Windows' current-session behaviour.
pub fn target(window_label: &str, keys: &[String], sources: &[String], key: Option<&str>, id: Option<&str>) -> Target {
    if !honour_keys(window_label) || !key.into_iter().chain(id).any(|s| !s.trim().is_empty()) {
        return Target::Current;
    }
    resolve(keys, sources, key, id).map_or(Target::Gone, Target::Found)
}

/// Wait at most `timeout`, allowing only one worker until it really finishes.
pub fn run_bounded<T: Send + 'static>(
    f: impl FnOnce() -> T + Send + 'static,
    timeout: std::time::Duration,
    busy: &'static std::sync::atomic::AtomicBool,
) -> Result<T, String> {
    use std::sync::atomic::Ordering;
    if busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
        return Err("busy".into());
    }
    struct InFlight(&'static std::sync::atomic::AtomicBool);
    impl Drop for InFlight {
        fn drop(&mut self) {
            self.0.store(false, Ordering::Release);
        }
    }
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    if std::thread::Builder::new().spawn(move || {
        let guard = InFlight(busy);
        let result = f();
        drop(guard);
        let _ = tx.send(result);
    }).is_err() {
        busy.store(false, Ordering::Release);
        return Err("worker unavailable".into());
    }
    rx.recv_timeout(timeout).map_err(|e| match e {
        std::sync::mpsc::RecvTimeoutError::Timeout => "timed out".into(),
        std::sync::mpsc::RecvTimeoutError::Disconnected => "worker failed".into(),
    })
}

pub const THUMBNAIL_MAX: u64 = 1024 * 1024;

/// Accept only bounded image bytes; never trust the stream's declared content type.
pub fn thumbnail_ok(size: u64, bytes: &[u8]) -> Option<&'static str> {
    if size == 0 || size > THUMBNAIL_MAX || bytes.len() as u64 > THUMBNAIL_MAX {
        return None;
    }
    crate::wall2_sonos_read::sniff_image(bytes)
}

/// A session key counts only from the second window; any other window acts on the current session.
pub fn honour_keys(window_label: &str) -> bool {
    window_label == "wall2"
}

/// What identifies a listed session when the session objects themselves cannot be compared: its app
/// id, its title (never logged), the end of its timeline, its position and its status.
#[derive(Clone, Debug, PartialEq)]
pub struct Fingerprint {
    pub source: String,
    pub title: String,
    pub end_s: f64,
    pub position_s: f64,
    pub status: &'static str,
}

/// Which listed session Windows' current one is, when its object is not found in the list: the
/// sessions with the same app id; with one, that one; with several, the one with the same title,
/// end and status and a position within two seconds (reads a moment apart); with several of those
/// (they cannot be told apart), the first of them; with none of those, the first with the same id.
pub fn match_current(list: &[Fingerprint], current: &Fingerprint) -> Option<usize> {
    let same: Vec<usize> = (0..list.len()).filter(|&i| list[i].source == current.source).collect();
    match same.len() {
        0 => None,
        1 => Some(same[0]),
        _ => same
            .iter()
            .copied()
            .find(|&i| {
                let f = &list[i];
                f.title == current.title && (f.end_s - current.end_s).abs() < 0.5 && f.status == current.status && (f.position_s - current.position_s).abs() <= 2.0
            })
            .or(Some(same[0])),
    }
}

/// Which rule chose the session (the log names it).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rule {
    CurrentPlaying,
    OtherPlaying,
    CurrentShown,
    NoSession,
}

impl Rule {
    pub fn word(self) -> &'static str {
        match self {
            Self::CurrentPlaying => "current-playing",
            Self::OtherPlaying => "other-playing",
            Self::CurrentShown => "current-shown",
            Self::NoSession => "none",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Pick {
    pub index: usize,
    pub rule: Rule,
    /// The chosen session says it plays but has ended: it is reported as paused.
    pub ended: bool,
}

/// The rule that picks the session, in order:
/// 1. the current session, when it plays and has not ended;
/// 2. else any other session that plays and has not ended, the most recently updated first;
/// 3. else the current session, shown as it is (an ended one is reported as paused);
/// 4. else none.
/// `ended[i]` says session `i` has ended (rule (a) or (b) above; see `classify`).
pub fn pick(cands: &[Candidate], ended: &[bool]) -> Option<Pick> {
    let live = |i: usize| cands[i].playing() && !ended.get(i).copied().unwrap_or(false);
    let current = cands.iter().position(|c| c.current);
    if let Some(i) = current {
        if live(i) {
            return Some(Pick { index: i, rule: Rule::CurrentPlaying, ended: false });
        }
    }
    let mut best: Option<usize> = None;
    for i in 0..cands.len() {
        if Some(i) == current || !live(i) {
            continue;
        }
        if best.map_or(true, |b| cands[i].since_update_s < cands[b].since_update_s) {
            best = Some(i);
        }
    }
    if let Some(i) = best {
        return Some(Pick { index: i, rule: Rule::OtherPlaying, ended: false });
    }
    current.map(|i| Pick { index: i, rule: Rule::CurrentShown, ended: cands[i].playing() && ended.get(i).copied().unwrap_or(false) })
}

/// Which sessions have ended: rule (a) on its own facts, or rule (b) from the tracker.
pub fn classify(tracker: &mut EndTracker, now_s: f64, cands: &[Candidate]) -> Vec<bool> {
    let stuck = tracker.observe(now_s, cands);
    cands.iter().zip(stuck).map(|(c, s)| past_end(c) || s).collect()
}

/// Seconds since a timeline's last update, from its `LastUpdatedTime` (Windows universal time:
/// 100 nanosecond ticks since 1601-01-01) and the current Unix time. Zero when the session gave
/// no time (zero or a negative tick count) or the time is in the future.
pub fn since_update_s(universal_ticks: i64, now_unix_s: f64) -> f64 {
    if universal_ticks <= 0 {
        return 0.0;
    }
    let updated_unix = universal_ticks as f64 / 10_000_000.0 - 11_644_473_600.0;
    (now_unix_s - updated_unix).max(0.0)
}

/// Keeps only printable ASCII without spaces (anything else becomes `_`) and at most 80 characters.
fn log_id(source: &str) -> String {
    source.chars().take(LOG_ID_CHARS).map(|c| if c.is_ascii_graphic() { c } else { '_' }).collect()
}

/// The log line without its time stamp: the chosen session (by key) and rule, then every session with its
/// status (`ended` replaces `playing` for one that plays but has ended). Ids and fixed words only.
pub fn choice_body(cands: &[Candidate], ended: &[bool], chosen: Option<Pick>) -> String {
    let chosen_id = chosen.map(|p| log_id(&cands[p.index].key)).unwrap_or_else(|| "none".to_string());
    let rule = chosen.map_or(Rule::NoSession, |p| p.rule).word();
    let sessions: Vec<String> = cands
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let word = if c.playing() && ended.get(i).copied().unwrap_or(false) { "ended" } else { c.status };
            let id = if c.key.is_empty() { "_".to_string() } else { log_id(&c.key) };
            format!("{id}:{word}{}", if c.current { ":current" } else { "" })
        })
        .collect();
    format!("rule={rule} chosen={chosen_id} sessions={}", if sessions.is_empty() { "none".to_string() } else { sessions.join(";") })
}

struct State {
    tracker: EndTracker,
    last_body: Option<String>,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);

fn mono_s() -> f64 {
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_secs_f64()
}

fn unix_now_s() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

/// Starts the log (next to the other wall logs). Without a folder nothing is logged.
pub fn start_log(dir: Option<std::path::PathBuf>) {
    let Some(dir) = dir else { return };
    if let Some(tx) = crate::wall2_sonos_log::start_named(&dir, NAME, OLDER, "wall2-media-log") {
        let _ = TX.set(tx);
    }
}

/// Chooses the session to show from one read of all sessions, keeping the tracker's state and
/// writing one log line when the set of sessions or the choice changed since the last read.
/// Returns the pick and which sessions have ended.
pub fn choose(cands: &[Candidate]) -> (Option<Pick>, Vec<bool>) {
    let mut guard = STATE.lock().unwrap_or_else(|e| e.into_inner());
    let state = guard.get_or_insert_with(|| State { tracker: EndTracker::default(), last_body: None });
    let ended = classify(&mut state.tracker, mono_s(), cands);
    let chosen = pick(cands, &ended);
    let body = choice_body(cands, &ended, chosen);
    if state.last_body.as_deref() != Some(body.as_str()) {
        if let Some(tx) = TX.get() {
            let _ = tx.try_send(format!("{} {body}\n", crate::wall2_sonos_log::stamp(unix_now_s() as i64)));
        }
        state.last_body = Some(body);
    }
    (chosen, ended)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(source: &str, status: &'static str, position_s: f64, end_s: f64, since_update_s: f64, current: bool) -> Candidate {
        Candidate { source: source.to_string(), key: format!("{source}#0"), status, position_s, end_s, since_update_s, current }
    }

    /// A session with an explicit key (a second session of one app).
    fn ck(source: &str, key: &str, status: &'static str, position_s: f64, end_s: f64, since_update_s: f64, current: bool) -> Candidate {
        Candidate { key: key.to_string(), ..c(source, status, position_s, end_s, since_update_s, current) }
    }

    fn picked(cands: &[Candidate]) -> Option<(usize, Rule, bool)> {
        let ended: Vec<bool> = cands.iter().map(past_end).collect();
        pick(cands, &ended).map(|p| (p.index, p.rule, p.ended))
    }

    #[test]
    fn targeted_commands_refuse_missing_sessions() {
        let sources = strings(&["a", "b"]);
        let keys = session_keys(&sources);
        for (window, key, id, expected) in [
            ("wall2", Some("b#0"), Some("a"), Target::Found(1)),
            ("wall2", None, Some("a"), Target::Found(0)),
            ("wall2", Some("gone#0"), None, Target::Gone),
            ("wall2", None, Some("gone"), Target::Gone),
            ("wall2", None, None, Target::Current),
            ("wall2", Some(" "), Some(""), Target::Current),
            ("main", Some("gone#0"), None, Target::Current),
        ] {
            assert_eq!(target(window, &keys, &sources, key, id), expected);
        }
        assert_eq!(target("wall2", &[], &[], Some("a#0"), Some("a")), Target::Gone);
        assert_eq!(target("wall2", &[], &[], None, Some("a")), Target::Gone);
    }

    #[test]
    fn bounded_read_finishes_or_times_out_without_another_worker() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::time::Duration;
        let busy: &'static AtomicBool = Box::leak(Box::new(AtomicBool::new(false)));
        assert_eq!(run_bounded(|| 7, Duration::from_secs(1), busy), Ok(7));
        assert!(!busy.load(Ordering::Acquire));
        let (release, held) = std::sync::mpsc::channel();
        assert_eq!(run_bounded(move || held.recv().unwrap(), Duration::from_millis(20), busy), Err("timed out".into()));
        assert_eq!(run_bounded(|| panic!("must not start"), Duration::from_millis(20), busy), Err::<(), _>("busy".into()));
        release.send(()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        while busy.load(Ordering::Acquire) && Instant::now() < deadline {
            std::thread::yield_now();
        }
        assert!(!busy.load(Ordering::Acquire));
        assert_eq!(run_bounded(|| 9, Duration::from_secs(1), busy), Ok(9));
    }

    #[test]
    fn thumbnails_require_bounded_image_bytes() {
        let png = b"\x89PNG\r\n\x1a\n";
        assert_eq!(thumbnail_ok(THUMBNAIL_MAX + 1, png), None);
        assert_eq!(thumbnail_ok(0, png), None);
        assert_eq!(thumbnail_ok(png.len() as u64, png), Some("image/png"));
        assert_eq!(thumbnail_ok(THUMBNAIL_MAX, png), Some("image/png"));
        assert_eq!(thumbnail_ok(4, b"text"), None);
        assert_eq!(thumbnail_ok(3, &[0xff, 0xd8, 0xff]), Some("image/jpeg"));
        assert_eq!(thumbnail_ok(12, b"RIFF1234WEBP"), Some("image/webp"));
    }

    #[test]
    fn current_playing_wins_even_when_another_plays_too() {
        let s = [c("a", "playing", 10.0, 200.0, 1.0, true), c("b", "playing", 5.0, 100.0, 0.0, false)];
        assert_eq!(picked(&s), Some((0, Rule::CurrentPlaying, false)));
    }

    #[test]
    fn an_ended_current_loses_to_another_that_plays() {
        // The current one plays but its position plus 60 s is far past its end.
        let s = [c("video", "playing", 150.0, 150.0, 60.0, true), c("music", "playing", 20.0, 200.0, 2.0, false)];
        assert_eq!(picked(&s), Some((1, Rule::OtherPlaying, false)));
    }

    #[test]
    fn two_other_players_the_most_recently_updated_wins() {
        let s = [
            c("cur", "paused", 1.0, 100.0, 5.0, true),
            c("old", "playing", 5.0, 100.0, 30.0, false),
            c("new", "playing", 5.0, 100.0, 3.0, false),
        ];
        assert_eq!(picked(&s), Some((2, Rule::OtherPlaying, false)));
    }

    #[test]
    fn nothing_plays_the_current_session_is_shown() {
        let s = [c("a", "paused", 10.0, 200.0, 1.0, false), c("b", "paused", 10.0, 200.0, 1.0, true)];
        assert_eq!(picked(&s), Some((1, Rule::CurrentShown, false)));
    }

    #[test]
    fn nothing_plays_and_the_current_has_ended_it_is_shown_as_ended() {
        let s = [c("a", "playing", 150.0, 150.0, 60.0, true)];
        assert_eq!(picked(&s), Some((0, Rule::CurrentShown, true)));
    }

    #[test]
    fn no_current_session_and_nothing_playing_gives_none() {
        let s = [c("a", "paused", 10.0, 200.0, 1.0, false)];
        assert_eq!(picked(&s), None);
    }

    #[test]
    fn zero_sessions_gives_none() {
        assert_eq!(picked(&[]), None);
    }

    #[test]
    fn a_playing_session_with_no_other_current_is_chosen_by_rule_two() {
        let s = [c("a", "playing", 10.0, 200.0, 1.0, false)];
        assert_eq!(picked(&s), Some((0, Rule::OtherPlaying, false)));
    }

    #[test]
    fn an_unknown_end_never_counts_as_ended() {
        assert!(!past_end(&c("a", "playing", 9999.0, 0.0, 9999.0, true)));
        assert!(!past_end(&c("a", "playing", 9999.0, -1.0, 9999.0, true)));
        assert!(!past_end(&c("a", "playing", 9999.0, f64::NAN, 9999.0, true)));
        let s = [c("live", "playing", 9999.0, 0.0, 9999.0, true), c("b", "playing", 1.0, 100.0, 0.0, false)];
        assert_eq!(picked(&s), Some((0, Rule::CurrentPlaying, false)));
    }

    #[test]
    fn rule_a_needs_more_than_three_seconds_past_the_end() {
        assert!(!past_end(&c("a", "playing", 100.0, 100.0, 3.0, true)));
        assert!(past_end(&c("a", "playing", 100.0, 100.0, 3.1, true)));
        // Position plus the age counts: 50 + 54 is 104, past 100 by 4.
        assert!(past_end(&c("a", "playing", 50.0, 100.0, 54.0, true)));
        assert!(!past_end(&c("a", "playing", 50.0, 100.0, 52.0, true)));
        // A paused session never ends this way, and a negative age is no age.
        assert!(!past_end(&c("a", "paused", 100.0, 100.0, 60.0, true)));
        assert!(!past_end(&c("a", "playing", 100.0, 100.0, -50.0, true)));
    }

    #[test]
    fn rule_b_two_reads_at_the_end_three_seconds_apart() {
        let mut t = EndTracker::default();
        let at_end = |pos: f64| [c("a", "playing", pos, 100.0, 0.0, true)];
        assert_eq!(t.observe(10.0, &at_end(99.5)), vec![false]);
        assert_eq!(t.observe(12.0, &at_end(99.6)), vec![false]);
        assert_eq!(t.observe(13.0, &at_end(100.0)), vec![true]);
        assert_eq!(t.observe(15.0, &at_end(100.0)), vec![true]);
        // Leaving the end forgets it.
        assert_eq!(t.observe(17.0, &at_end(3.0)), vec![false]);
        assert_eq!(t.observe(18.0, &at_end(99.9)), vec![false]);
        assert_eq!(t.observe(20.0, &at_end(99.9)), vec![false]);
        assert_eq!(t.observe(21.0, &at_end(99.9)), vec![true]);
    }

    #[test]
    fn rule_b_state_is_per_source_and_dropped_when_the_source_goes() {
        let mut t = EndTracker::default();
        let both = |_: ()| [c("a", "playing", 100.0, 100.0, 0.0, true), c("b", "playing", 100.0, 100.0, 0.0, false)];
        assert_eq!(t.observe(0.0, &both(())), vec![false, false]);
        // Only "b" remains, then "a" returns: its clock starts again.
        assert_eq!(t.observe(2.0, &[c("b", "playing", 100.0, 100.0, 0.0, false)]), vec![false]);
        assert_eq!(t.observe(4.0, &both(())), vec![false, true]);
        // A paused session at its end is not stuck: it is simply paused.
        assert_eq!(t.observe(10.0, &[c("b", "paused", 100.0, 100.0, 0.0, false)]), vec![false]);
    }

    #[test]
    fn a_stuck_session_that_keeps_refreshing_its_timeline_is_ended() {
        // since_update stays 0 (it refreshes), so rule (a) never fires; rule (b) does.
        let mut t = EndTracker::default();
        let mk = || [c("video", "playing", 100.0, 100.0, 0.0, true), c("music", "playing", 5.0, 200.0, 0.5, false)];
        let first = classify(&mut t, 0.0, &mk());
        assert_eq!(first, vec![false, false]);
        assert_eq!(pick(&mk(), &first).map(|p| p.index), Some(0));
        let later = classify(&mut t, 4.0, &mk());
        assert_eq!(later, vec![true, false]);
        let p = pick(&mk(), &later).unwrap();
        assert_eq!((p.index, p.rule, p.ended), (1, Rule::OtherPlaying, false));
    }

    #[test]
    fn a_stopped_music_session_does_not_hide_a_playing_video() {
        // The other direction: the current one is a stopped music player, the video plays.
        let s = [c("music", "stopped", 0.0, 0.0, 400.0, true), c("video", "playing", 30.0, 600.0, 1.0, false)];
        assert_eq!(picked(&s), Some((1, Rule::OtherPlaying, false)));
    }

    #[test]
    fn since_update_converts_windows_universal_time() {
        let unix = 1_700_000_000.0;
        let ticks = ((unix - 12.5 + 11_644_473_600.0) * 10_000_000.0) as i64;
        assert!((since_update_s(ticks, unix) - 12.5).abs() < 0.001);
        assert_eq!(since_update_s(0, unix), 0.0);
        assert_eq!(since_update_s(-5, unix), 0.0);
        let future = ((unix + 30.0 + 11_644_473_600.0) * 10_000_000.0) as i64;
        assert_eq!(since_update_s(future, unix), 0.0);
    }

    #[test]
    fn the_log_body_holds_ids_status_and_rule_only() {
        let long = "x".repeat(200);
        let s = [c(&long, "playing", 150.0, 150.0, 60.0, true), c("Music.exe", "playing", 20.0, 200.0, 2.0, false), c("", "paused", 0.0, 0.0, 0.0, false), c("a b\u{e9}", "paused", 0.0, 0.0, 0.0, false)];
        let ended: Vec<bool> = s.iter().map(past_end).collect();
        let p = pick(&s, &ended);
        let body = choice_body(&s, &ended, p);
        assert_eq!(body, format!("rule=other-playing chosen=Music.exe#0 sessions={}:ended:current;Music.exe#0:playing;#0:paused;a_b_#0:paused", "x".repeat(80)));
        assert_eq!(choice_body(&[], &[], None), "rule=none chosen=none sessions=none");
    }

    fn strings(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn keys_are_the_app_id_and_its_place_among_sessions_with_that_id_in_list_order() {
        assert_eq!(session_keys(&strings(&["a", "b", "a", "a"])), strings(&["a#0", "b#0", "a#1", "a#2"]));
        // Two tabs of one app: two keys, in the order Windows lists them, the same on every read.
        let two = strings(&["Example.Browser", "Example.Browser"]);
        assert_eq!(session_keys(&two), strings(&["Example.Browser#0", "Example.Browser#1"]));
        assert_eq!(session_keys(&two), session_keys(&two));
        assert_eq!(session_keys(&[]), Vec::<String>::new());
        // A session that is not the first of its id keeps its own ordinal whichever is current.
        let sources = strings(&["x", "x"]);
        let keys = session_keys(&sources);
        let cands = [ck("x", &keys[0], "paused", 1.0, 100.0, 5.0, false), ck("x", &keys[1], "playing", 1.0, 100.0, 1.0, true)];
        assert_eq!(cands.iter().position(|c| c.current), Some(1));
        assert_eq!(cands[1].key, "x#1");
    }

    #[test]
    fn a_command_resolves_by_key_then_by_app_id_then_not_at_all() {
        let sources = strings(&["a", "b", "a"]);
        let keys = session_keys(&sources);
        // The key wins, even for the second session of an id.
        assert_eq!(resolve(&keys, &sources, Some("a#1"), Some("a")), Some(2));
        assert_eq!(resolve(&keys, &sources, Some("b#0"), Some("a")), Some(1));
        // A key that is gone falls back to the first session with the id.
        assert_eq!(resolve(&keys, &sources, Some("a#7"), Some("a")), Some(0));
        assert_eq!(resolve(&keys, &sources, None, Some("b")), Some(1));
        // Nothing found: a targeted Wall 2 command must refuse.
        assert_eq!(resolve(&keys, &sources, Some("zzz#0"), Some("zzz")), None);
        assert_eq!(resolve(&keys, &sources, None, None), None);
        assert_eq!(resolve(&keys, &sources, Some("  "), Some("")), None);
        assert_eq!(resolve(&[], &[], Some("a#0"), Some("a")), None);
    }

    #[test]
    fn a_key_counts_only_from_the_second_window() {
        assert!(honour_keys("wall2"));
        assert!(!honour_keys("main"));
        assert!(!honour_keys(""));
    }

    #[test]
    fn two_sessions_of_one_app_keep_two_end_clocks() {
        // Tab 0 sits at its end; tab 1 plays mid-song. Same app id, so only the key tells them apart.
        let mk = || [ck("tab", "tab#0", "playing", 100.0, 100.0, 0.0, false), ck("tab", "tab#1", "playing", 30.0, 200.0, 0.5, true)];
        let mut t = EndTracker::default();
        assert_eq!(classify(&mut t, 0.0, &mk()), vec![false, false]);
        assert_eq!(classify(&mut t, 4.0, &mk()), vec![true, false]);
        // Windows' current is tab 1 and it plays: it is shown.
        let ended = classify(&mut t, 6.0, &mk());
        let p = pick(&mk(), &ended).unwrap();
        assert_eq!((p.index, p.rule), (1, Rule::CurrentPlaying));
        // The other way round: the current one is the stuck tab, the other tab plays: rule two picks it.
        let swapped = [ck("tab", "tab#0", "playing", 100.0, 100.0, 0.0, true), ck("tab", "tab#1", "playing", 30.0, 200.0, 0.5, false)];
        let ended = classify(&mut t, 8.0, &swapped);
        assert_eq!(ended, vec![true, false]);
        let p = pick(&swapped, &ended).unwrap();
        assert_eq!((p.index, p.rule, p.ended), (1, Rule::OtherPlaying, false));
    }

    #[test]
    fn an_old_near_end_observation_is_forgotten_after_a_gap_in_reading() {
        let mut t = EndTracker::default();
        let at_end = [c("a", "playing", 100.0, 100.0, 0.0, true)];
        assert_eq!(t.observe(0.0, &at_end), vec![false]);
        // The page was hidden for 20 seconds: the first read after it starts the clock again.
        assert_eq!(t.observe(20.0, &at_end), vec![false]);
        assert_eq!(t.observe(22.0, &at_end), vec![false]);
        assert_eq!(t.observe(23.0, &at_end), vec![true]);
        // A gap of exactly ten seconds is still the same observation.
        assert_eq!(t.observe(33.0, &at_end), vec![true]);
        assert_eq!(t.observe(33.0 + 10.5, &at_end), vec![false]);
    }

    fn fp(source: &str, title: &str, end_s: f64, position_s: f64, status: &'static str) -> Fingerprint {
        Fingerprint { source: source.to_string(), title: title.to_string(), end_s, position_s, status }
    }

    #[test]
    fn the_current_session_is_found_by_its_facts_when_the_objects_cannot_be_compared() {
        let list = [fp("tab", "One", 200.0, 50.0, "playing"), fp("other", "Z", 10.0, 1.0, "paused"), fp("tab", "Two", 300.0, 120.0, "playing"), fp("tab", "Two", 300.0, 20.0, "playing")];
        // One session with the id: that one, whatever its facts.
        assert_eq!(match_current(&list, &fp("other", "anything", 1.0, 1.0, "playing")), Some(1));
        // Several: the title, end, status and a close position decide, not the first of the id.
        assert_eq!(match_current(&list, &fp("tab", "Two", 300.0, 121.0, "playing")), Some(2));
        assert_eq!(match_current(&list, &fp("tab", "Two", 300.0, 21.5, "playing")), Some(3));
        assert_eq!(match_current(&list, &fp("tab", "One", 200.0, 51.0, "playing")), Some(0));
        // Several that fit equally: the first of them. None fit: the first with the id.
        let twins = [fp("tab", "Same", 100.0, 10.0, "playing"), fp("tab", "Same", 100.0, 10.5, "playing")];
        assert_eq!(match_current(&twins, &fp("tab", "Same", 100.0, 10.2, "playing")), Some(0));
        assert_eq!(match_current(&list, &fp("tab", "Nothing alike", 9.0, 9.0, "paused")), Some(0));
        // No session with the id.
        assert_eq!(match_current(&list, &fp("gone", "Two", 300.0, 120.0, "playing")), None);
        assert_eq!(match_current(&[], &fp("tab", "Two", 300.0, 120.0, "playing")), None);
    }
}
