//! The For you tab's mood chips. A mood's results are one YouTube music search, kept for 7 days per mood,
//! and at most `MAX_SPENDS` searches are made in any rolling 7 days across all eight moods. Both live in one
//! small file beside the other YouTube files in the app config folder, so a restart keeps them. A mood that is
//! cached never spends a search. The page sends only a mood word; the words searched for are built here.
//!
//! Everything before the `commands` marker is plain Rust over a path, a clock and a search closure, so every
//! path runs in a test with a temporary folder and no network.

use super::{unsafe_char, valid_video_id, Page, YtVideo, FAILED, INVALID};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::Read;
use std::path::Path;
use std::sync::Mutex;

/// The eight moods, as the chips spell them (matched case-insensitively).
const MOODS: [&str; 8] = ["focus", "energize", "relax", "sleep", "chill", "workout", "party", "romance"];
/// Searches allowed in any rolling window.
pub const MAX_SPENDS: usize = 10;
/// The rolling window, and how long a mood's results are kept (7 days).
pub const WINDOW_S: u64 = 7 * 24 * 3600;
/// A file longer than this is not read at all (eight moods of 25 videos come to about 40 KB).
const FILE_MAX: u64 = 256 * 1024;
/// A time further ahead than this is a wrong clock or a forged entry, and is dropped.
const FUTURE_S: u64 = 3600;
const MAX_ITEMS: usize = 50;
const FILE_NAME: &str = "yt-mood.json";
const THUMB_PREFIX: &str = "https://i.ytimg.com/vi/";
const PLAYABLE: [&str; 5] = ["yes", "embed", "private", "removed", "region"];

/// One video as kept and as sent to the page: the same fields `YtVideo` has.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct MoodVideo { id: String, title: String, channel: String, seconds: u64, thumb: Option<String>, playable: String }

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
struct Kept { at: u64, items: Vec<MoodVideo> }

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
struct Store {
    /// The times (seconds since 1970) of the searches made in the window, oldest first.
    spends: Vec<u64>,
    /// The kept results by lower-case mood.
    moods: BTreeMap<String, Kept>,
}

/// What a mood click answers. `back_at` is set only when the budget is spent and nothing is kept: the time
/// the oldest search leaves the window, so the page can say a weekday.
#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MoodAnswer { items: Vec<MoodVideo>, cached: bool, searches_left: u32, back_at: Option<u64> }

/// The mood in its lower-case form, or `None` for a word that is not one of the eight.
fn mood_key(text: &str) -> Option<String> {
    let key = text.trim().to_lowercase();
    MOODS.contains(&key.as_str()).then_some(key)
}

/// The words searched for a mood.
pub fn query_for(key: &str) -> String { format!("{key} music playlist") }

fn clean_video(v: MoodVideo) -> Option<MoodVideo> {
    let text_ok = |s: &str, max: usize| !s.is_empty() && s.chars().count() <= max && !s.chars().any(unsafe_char);
    let thumb_ok = v.thumb.as_deref().is_none_or(|t| t.starts_with(THUMB_PREFIX) && t.len() <= 200 && !t.chars().any(|c| c.is_control() || c.is_whitespace()));
    (valid_video_id(&v.id) && text_ok(&v.title, 300) && v.channel.chars().count() <= 200 && !v.channel.chars().any(unsafe_char)
        && thumb_ok && PLAYABLE.contains(&v.playable.as_str())).then_some(v)
}

/// The store as it may be kept: spends inside the window, sorted (a spend in the future is kept, so a clock that
/// jumped back cannot reset the budget); only the eight
/// moods, each younger than the window, with valid videos, at most `MAX_ITEMS`.
fn clean(mut store: Store, now: u64) -> Store {
    store.spends.retain(|&t| now.saturating_sub(t) < WINDOW_S);
    store.spends.sort_unstable();
    store.moods.retain(|k, kept| MOODS.contains(&k.as_str()) && kept.at <= now.saturating_add(FUTURE_S) && now.saturating_sub(kept.at) < WINDOW_S);
    for kept in store.moods.values_mut() {
        let items = std::mem::take(&mut kept.items);
        kept.items = items.into_iter().filter_map(clean_video).take(MAX_ITEMS).collect();
    }
    store
}

fn read_store(path: &Path, now: u64) -> Store {
    let mut bytes = Vec::new();
    let Ok(file) = std::fs::File::open(path) else { return Store::default() };
    if file.take(FILE_MAX + 1).read_to_end(&mut bytes).is_err() || bytes.len() as u64 > FILE_MAX { return Store::default() }
    match serde_json::from_slice::<Store>(&bytes) { Ok(store) => clean(store, now), Err(_) => Store::default() }
}

/// Write beside the file, then rename over it, so a crash leaves the old file or the new one.
fn write_store(path: &Path, store: &Store) -> Result<(), &'static str> {
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string(store).map_err(|_| FAILED)?;
    std::fs::write(&tmp, text).map_err(|_| FAILED)?;
    std::fs::rename(&tmp, path).map_err(|_| { let _ = std::fs::remove_file(&tmp); FAILED })
}

fn left_of(store: &Store) -> u32 { MAX_SPENDS.saturating_sub(store.spends.len()) as u32 }

/// One read-change-write at a time, held across the search too, so two clicks never both spend the last one.
static LOCK: Mutex<()> = Mutex::new(());
fn locked() -> std::sync::MutexGuard<'static, ()> { LOCK.lock().unwrap_or_else(|e| e.into_inner()) }

/// The answer for `mood`: its kept results while younger than 7 days (no search, nothing spent); otherwise,
/// if fewer than `MAX_SPENDS` searches were made in the last 7 days, one search through `search`, counted
/// only when it succeeds, kept and answered; otherwise the time the budget frees up. A search that finds nothing valid is kept as an empty answer. A failed search spends
/// nothing and keeps nothing.
fn mood_in(dir: &Path, mood: &str, now: u64, search: impl FnOnce(&str) -> Result<Vec<MoodVideo>, &'static str>) -> Result<MoodAnswer, &'static str> {
    let key = mood_key(mood).ok_or(INVALID)?;
    let _g = locked();
    std::fs::create_dir_all(dir).map_err(|_| FAILED)?;
    let path = dir.join(FILE_NAME);
    let mut store = read_store(&path, now);
    if let Some(kept) = store.moods.get(&key) {
        // An empty kept answer (a search that found nothing valid) is kept too, so a click does not spend again.
        return Ok(MoodAnswer { items: kept.items.clone(), cached: true, searches_left: left_of(&store), back_at: None });
    }
    if store.spends.len() >= MAX_SPENDS {
        let back_at = store.spends.first().map(|t| t.saturating_add(WINDOW_S));
        return Ok(MoodAnswer { items: Vec::new(), cached: false, searches_left: 0, back_at });
    }
    let items: Vec<MoodVideo> = search(&query_for(&key))?.into_iter().filter_map(clean_video).take(MAX_ITEMS).collect();
    store.spends.push(now);
    store.moods.insert(key, Kept { at: now, items: items.clone() });
    write_store(&path, &store)?;
    Ok(MoodAnswer { items, cached: false, searches_left: left_of(&store), back_at: None })
}

/// `mood_in` with a clock that may have failed: no time, no read and no write.
fn mood_clocked(dir: &Path, mood: &str, now: Option<u64>, search: impl FnOnce(&str) -> Result<Vec<MoodVideo>, &'static str>) -> Result<MoodAnswer, &'static str> {
    // 0 is what `unix_now` gives when the clock cannot be read: unknown, the same as no time.
    mood_in(dir, mood, now.filter(|&n| n != 0).ok_or(FAILED)?, search)
}

fn video_of(v: &YtVideo) -> MoodVideo {
    MoodVideo { id: v.id.clone(), title: v.title.clone(), channel: v.channel.clone(), seconds: v.seconds, thumb: v.thumb.clone(), playable: v.playable.to_string() }
}

/// The search, through the parent's own music search (same quota, same error words, same token handling).
fn search_videos(ctx: &super::Ctx, words: &str) -> Result<Vec<MoodVideo>, &'static str> {
    let page: Page<YtVideo> = super::search_with(ctx, words)?;
    Ok(page.items.iter().map(video_of).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    const T0: u64 = 1_800_000_000;
    const DAY: u64 = 24 * 3600;

    fn temp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("wall-mood-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }
    fn video(n: u32) -> MoodVideo {
        MoodVideo { id: format!("vid{n:08}"), title: format!("Song {n}"), channel: "Chan".into(), seconds: 200, thumb: Some(format!("{THUMB_PREFIX}vid{n:08}/mqdefault.jpg")), playable: "yes".into() }
    }
    fn found(n: u32) -> Result<Vec<MoodVideo>, &'static str> { Ok((0..n).map(video).collect()) }

    #[test]
    fn only_the_eight_moods_are_accepted_and_the_words_are_built_here() {
        for m in ["Focus", " ENERGIZE ", "relax", "Sleep", "chill", "Workout", "party", "Romance"] { assert!(mood_key(m).is_some(), "{m}"); }
        for bad in ["", "jazz", "focus music", "focus\nx"] { assert_eq!(mood_key(bad), None, "{bad}"); }
        assert_eq!(query_for("focus"), "focus music playlist");
        let dir = temp("bad");
        assert_eq!(mood_in(&dir, "jazz", T0, |_| found(1)).err(), Some(INVALID));
        assert!(!dir.join(FILE_NAME).exists());
    }

    #[test]
    fn a_first_click_searches_once_spends_one_and_keeps_the_answer() {
        let dir = temp("first");
        let asked = Cell::new(0);
        let a = mood_in(&dir, "Focus", T0, |q| { asked.set(asked.get() + 1); assert_eq!(q, "focus music playlist"); found(5) }).unwrap();
        assert_eq!((asked.get(), a.items.len(), a.cached, a.searches_left, a.back_at), (1, 5, false, 9, None));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_cached_mood_spends_nothing() {
        let dir = temp("cache");
        mood_in(&dir, "relax", T0, |_| found(3)).unwrap();
        let asked = Cell::new(0);
        let a = mood_in(&dir, "Relax", T0 + 6 * DAY, |_| { asked.set(1); found(9) }).unwrap();
        assert_eq!((asked.get(), a.items.len(), a.cached, a.searches_left), (0, 3, true, 9));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_mood_older_than_seven_days_searches_again() {
        let dir = temp("old");
        mood_in(&dir, "relax", T0, |_| found(3)).unwrap();
        let a = mood_in(&dir, "relax", T0 + 7 * DAY, |_| found(4)).unwrap();
        assert_eq!((a.items.len(), a.cached, a.searches_left), (4, false, 9));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_budget_is_ten_in_a_rolling_week_and_the_window_slides() {
        let dir = temp("budget");
        // Ten searches an hour apart, written straight into the file.
        let spends: Vec<u64> = (0..10).map(|i| T0 + i * 3600).collect();
        std::fs::create_dir_all(&dir).unwrap();
        write_store(&dir.join(FILE_NAME), &Store { spends: spends.clone(), moods: BTreeMap::new() }).unwrap();
        let asked = Cell::new(0);
        let a = mood_in(&dir, "party", T0 + 3 * DAY, |_| { asked.set(1); found(2) }).unwrap();
        assert_eq!((asked.get(), a.items.len(), a.searches_left, a.back_at), (0, 0, 0, Some(T0 + WINDOW_S)));
        // The oldest search leaves the window at T0 + 7 days: one is free again, the next click spends it.
        let b = mood_in(&dir, "party", T0 + WINDOW_S, |_| found(2)).unwrap();
        assert_eq!((b.items.len(), b.searches_left, b.back_at), (2, 0, None));
        let c = mood_in(&dir, "sleep", T0 + WINDOW_S + 1, |_| { asked.set(2); found(2) }).unwrap();
        assert_eq!((asked.get(), c.items.len(), c.back_at), (0, 0, Some(T0 + 3600 + WINDOW_S)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_cached_mood_still_answers_when_the_budget_is_spent() {
        let dir = temp("spent-cached");
        mood_in(&dir, "chill", T0, |_| found(3)).unwrap();
        let mut store = read_store(&dir.join(FILE_NAME), T0);
        store.spends = vec![T0; 10];
        write_store(&dir.join(FILE_NAME), &store).unwrap();
        let a = mood_in(&dir, "chill", T0 + DAY, |_| found(1)).unwrap();
        assert_eq!((a.items.len(), a.cached, a.searches_left), (3, true, 0));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_failed_search_spends_and_keeps_nothing() {
        let dir = temp("fail");
        assert_eq!(mood_in(&dir, "workout", T0, |_| Err("down")).err(), Some("down"));
        let store = read_store(&dir.join(FILE_NAME), T0);
        assert!(store.spends.is_empty() && store.moods.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_count_survives_a_restart_and_a_bad_file_reads_as_empty() {
        let dir = temp("restart");
        mood_in(&dir, "focus", T0, |_| found(2)).unwrap();
        mood_in(&dir, "sleep", T0 + 10, |_| found(2)).unwrap();
        let again = read_store(&dir.join(FILE_NAME), T0 + 20);
        assert_eq!(again.spends.len(), 2);
        std::fs::write(dir.join(FILE_NAME), "{not json").unwrap();
        assert_eq!(read_store(&dir.join(FILE_NAME), T0), Store::default());
        std::fs::write(dir.join(FILE_NAME), vec![b' '; (FILE_MAX + 1) as usize]).unwrap();
        assert_eq!(read_store(&dir.join(FILE_NAME), T0), Store::default());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn forged_entries_are_dropped_on_read() {
        let mut bad = video(1);
        bad.thumb = Some("https://example.com/x.jpg".into());
        let mut odd = video(2);
        odd.playable = "maybe".into();
        let mut moods = BTreeMap::new();
        moods.insert("focus".to_string(), Kept { at: T0, items: vec![video(0), bad, odd, MoodVideo { id: "short".into(), ..video(3) }] });
        moods.insert("jazz".to_string(), Kept { at: T0, items: vec![video(0)] });
        moods.insert("sleep".to_string(), Kept { at: T0 + 2 * FUTURE_S, items: vec![video(0)] });
        let cleaned = clean(Store { spends: vec![T0, T0 + 2 * FUTURE_S, T0 - WINDOW_S - 1], moods }, T0);
        assert_eq!(cleaned.spends, vec![T0, T0 + 2 * FUTURE_S]);
        assert_eq!(cleaned.moods.keys().cloned().collect::<Vec<_>>(), vec!["focus".to_string()]);
        assert_eq!(cleaned.moods["focus"].items, vec![video(0)]);
    }

    #[test]
    fn an_empty_result_is_kept_and_answered_as_cached_without_spending_again() {
        let dir = temp("empty");
        let mut bad = video(1);
        bad.playable = "maybe".into();
        let a = mood_in(&dir, "focus", T0, |_| Ok(vec![bad])).unwrap();
        assert_eq!((a.items.len(), a.cached, a.searches_left), (0, false, 9));
        let asked = Cell::new(0);
        let b = mood_in(&dir, "focus", T0 + DAY, |_| { asked.set(1); found(3) }).unwrap();
        assert_eq!((asked.get(), b.items.len(), b.cached, b.searches_left, b.back_at), (0, 0, true, 9, None));
        // After 7 days it searches again.
        let c = mood_in(&dir, "focus", T0 + 7 * DAY, |_| found(2)).unwrap();
        assert_eq!((c.items.len(), c.cached), (2, false));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_clock_jump_back_keeps_the_spends_and_a_zero_clock_is_unknown() {
        let dir = temp("jump");
        std::fs::create_dir_all(&dir).unwrap();
        let spends: Vec<u64> = vec![T0 + 5 * DAY; 10];
        write_store(&dir.join(FILE_NAME), &Store { spends: spends.clone(), moods: BTreeMap::new() }).unwrap();
        // The clock reads 5 days behind every spend: they stay, so the budget is still spent.
        let asked = Cell::new(0);
        let a = mood_in(&dir, "relax", T0, |_| { asked.set(1); found(1) }).unwrap();
        assert_eq!((asked.get(), a.searches_left), (0, 0));
        assert_eq!(read_store(&dir.join(FILE_NAME), T0).spends, spends);
        // A clock that reads 0 is unknown: no search, and the file is left alone.
        assert_eq!(mood_clocked(&dir, "relax", Some(0), |_| found(1)).err(), Some(FAILED));
        assert_eq!(read_store(&dir.join(FILE_NAME), T0).spends, spends);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn no_clock_means_no_read_and_no_write() {
        let dir = temp("clock");
        assert_eq!(mood_clocked(&dir, "focus", None, |_| found(1)).err(), Some(FAILED));
        assert!(!dir.exists());
    }

    #[test]
    fn the_one_command_checks_the_window_label() {
        let whole = include_str!("mood.rs").replace("\r\n", "\n");
        let marker = ["// ---- ", "commands ----"].concat();
        let source = whole.rsplit_once(marker.as_str()).unwrap().1;
        let attribute = ["#[tauri", "::command]"].concat();
        let parts = source.split(attribute.as_str()).skip(1).collect::<Vec<_>>();
        assert_eq!(parts.len(), 1);
        let body: String = parts[0].lines().skip(1).take(3).collect::<Vec<_>>().join("\n");
        assert!(body.contains("super::require(&window)?"), "{body}");
    }
}

// ---- commands -------------------------------------------------------------------------------

use tauri::Manager;
use tauri::WebviewWindow;

/// A clock read that gave 0 failed: no time.
fn clock(t: u64) -> Option<u64> { (t != 0).then_some(t) }

/// A mood's results: kept ones for free, otherwise one search from the week's ten.
#[tauri::command]
pub async fn wall2_youtube_mood(window: WebviewWindow, mood: String) -> Result<MoodAnswer, String> {
    super::require(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let dir = app.path().app_config_dir().map_err(|_| FAILED.to_string())?;
        // A kept mood answers without the sign-in or the network: only a search needs the client.
        match mood_clocked(&dir, &mood, clock(super::unix_now()), |_| Err("search")) {
            Err("search") => {}
            other => return other.map_err(str::to_string),
        }
        super::read_with_app(&app, |ctx| mood_clocked(&dir, &mood, clock((ctx.now)()), |words| search_videos(ctx, words)))
    }).await.map_err(|_| FAILED.to_string())?
}
