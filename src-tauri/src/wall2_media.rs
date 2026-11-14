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

/// Rule (b): the state kept per source id between reads. A session that keeps refreshing its
/// timeline at the end (so rule (a) never fires) is caught by its position staying within one
/// second of its end on two reads at least three seconds apart.
#[derive(Default, Debug)]
pub struct EndTracker {
    near: HashMap<String, f64>,
}

impl EndTracker {
    /// Feeds one read of every session at `now_s` (any steady clock, in seconds) and returns,
    /// per session, whether it has been stuck at its end. A source that is not near its end,
    /// or is gone, forgets its state.
    pub fn observe(&mut self, now_s: f64, cands: &[Candidate]) -> Vec<bool> {
        let mut next: HashMap<String, f64> = HashMap::new();
        let mut out = Vec::with_capacity(cands.len());
        for c in cands {
            let near = c.playing() && c.has_end() && (c.end_s - c.position_s).abs() <= NEAR_END_S;
            if near {
                let since = next.get(&c.source).or_else(|| self.near.get(&c.source)).copied().unwrap_or(now_s);
                next.insert(c.source.clone(), since);
                out.push(now_s - since >= STUCK_AFTER_S);
            } else {
                out.push(false);
            }
        }
        self.near = next;
        out
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

/// The log line without its time stamp: the chosen session and rule, then every session with its
/// status (`ended` replaces `playing` for one that plays but has ended). Ids and fixed words only.
pub fn choice_body(cands: &[Candidate], ended: &[bool], chosen: Option<Pick>) -> String {
    let chosen_id = chosen.map(|p| log_id(&cands[p.index].source)).unwrap_or_else(|| "none".to_string());
    let rule = chosen.map_or(Rule::NoSession, |p| p.rule).word();
    let sessions: Vec<String> = cands
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let word = if c.playing() && ended.get(i).copied().unwrap_or(false) { "ended" } else { c.status };
            let id = if c.source.is_empty() { "_".to_string() } else { log_id(&c.source) };
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
        Candidate { source: source.to_string(), status, position_s, end_s, since_update_s, current }
    }

    fn picked(cands: &[Candidate]) -> Option<(usize, Rule, bool)> {
        let ended: Vec<bool> = cands.iter().map(past_end).collect();
        pick(cands, &ended).map(|p| (p.index, p.rule, p.ended))
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
        assert_eq!(body, format!("rule=other-playing chosen=Music.exe sessions={}:ended:current;Music.exe:playing;_:paused;a_b_:paused", "x".repeat(80)));
        assert_eq!(choice_body(&[], &[], None), "rule=none chosen=none sessions=none");
    }
}
