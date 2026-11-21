//! Wall 2 Home tab moods: lists the home app's moods (plus three scene cards from its routines)
//! and applies one on request.
//!
//! The address comes from `feeds.json` (`homeBaseUrl`) through the helpers in
//! `wall2_feeds.rs` and is never put in an error message. Nothing here runs unless the
//! front end calls it, and the front end calls `wall2_apply_mood` only on a tap.

use crate::wall2_feeds::{agent, describe, get_json, get_json_with_timeout, read_base, read_body, require_ok};
use serde::Serialize;
use serde_json::Value;

const MAX_MOODS: usize = 12;
/// The scenes are optional, so their read gets a short wait: a hanging routines route must not hold the moods back.
const ROUTINES_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);
/// Applying a mood can wait inside the home app (Still Working pauses before its Lutron
/// levels, about 6 to 7 seconds in all), so it gets longer than the shared agent's timeout.
const APPLY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Mood {
    pub id: String,
    pub label: String,
    /// False only when the home app says the mood was never saved (`saved: false`); a card
    /// for it is drawn quiet and applying it sends nothing. Anything else counts as saved.
    pub saved: bool,
    /// "mood" for the home app's moods, "scene" for the three routine cards added after them.
    pub kind: &'static str,
    /// The routine's description for a scene card; none for a mood and none when the home app has no text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<String>,
}

/// The scene cards, in this order, as (routine id, label when the home app sends no name). Only these
/// routine ids can be started from the wall: `wall2_apply_mood` checks an id against this list before
/// it picks the start route, so the page cannot start any other routine.
const SCENES: [(&str, &str); 3] = [("romantic_mode", "Romantic Mode"), ("movie_mode", "Movie Mode"), ("fireplace_cozy", "Fireplace Cozy")];
const MAX_SCENE_TEXT: usize = 60;

/// `^[A-Za-z][A-Za-z0-9]{0,31}$`
fn valid_mood_id(id: &str) -> bool {
    let mut chars = id.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() => {}
        _ => return false,
    }
    id.len() <= 32 && chars.all(|c| c.is_ascii_alphanumeric())
}

/// "lateNight" becomes "Late Night": a space before each capital that follows a lower case
/// letter or digit, and a capital first letter.
fn mood_label(id: &str) -> String {
    let mut out = String::new();
    let mut prev: Option<char> = None;
    for c in id.chars() {
        if c.is_ascii_uppercase() && prev.is_some_and(|p| p.is_ascii_lowercase() || p.is_ascii_digit()) {
            out.push(' ');
        }
        if prev.is_none() {
            out.push(c.to_ascii_uppercase());
        } else {
            out.push(c);
        }
        prev = Some(c);
    }
    out
}

/// The keys of `moods`, in server order, valid ids only, at most 12.
fn pick_moods(body: &Value) -> Vec<Mood> {
    let Some(map) = body.get("moods").and_then(Value::as_object) else {
        return Vec::new();
    };
    map.keys()
        .filter(|k| valid_mood_id(k))
        .take(MAX_MOODS)
        .map(|k| Mood { id: k.clone(), label: mood_label(k), saved: map.get(k).and_then(|m| m.get("saved")) != Some(&Value::Bool(false)), kind: "mood", line: None })
        .collect()
}

fn is_scene(id: &str) -> bool {
    SCENES.iter().any(|(s, _)| *s == id)
}

fn scene_text(r: &Value, key: &str) -> Option<String> {
    let t = r.get(key).and_then(Value::as_str)?.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.chars().take(MAX_SCENE_TEXT).collect())
    }
}

/// The scene cards from `GET /api/routines`, which answers a list or `{routines: [...]}`: only the
/// ids in `SCENES`, in that fixed order, each labelled with the routine's name; a missing one is skipped.
fn pick_scenes(body: &Value) -> Vec<Mood> {
    let Some(list) = body.as_array().or_else(|| body.get("routines").and_then(Value::as_array)) else {
        return Vec::new();
    };
    SCENES
        .iter()
        .filter_map(|(id, fallback)| {
            let r = list.iter().find(|r| r.get("id").and_then(Value::as_str) == Some(*id))?;
            let label = scene_text(r, "name").unwrap_or_else(|| (*fallback).to_string());
            Some(Mood { id: (*id).to_string(), label, saved: true, kind: "scene", line: scene_text(r, "description") })
        })
        .collect()
}

/// The moods, then the scenes. A routines read that failed (`None`) leaves the moods alone.
fn merge_moods(mut moods: Vec<Mood>, routines: Option<&Value>) -> Vec<Mood> {
    if let Some(body) = routines {
        moods.extend(pick_scenes(body));
    }
    moods
}

/// The route a tap calls: a scene id starts its routine, any other valid id applies a mood, and
/// everything else gets no route at all.
fn apply_url(base: &str, id: &str) -> Option<String> {
    if is_scene(id) {
        Some(format!("{base}/api/routines/{id}/start"))
    } else if valid_mood_id(id) {
        Some(format!("{base}/api/moods/{id}/apply"))
    } else {
        None
    }
}

/// What a successful apply tells the page. `superseded` is true when the home app answered
/// `{"ok":true,"superseded":true}`: a newer press took over, so this one did not run and the
/// page must not mark its mood as set.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ApplyOutcome {
    pub superseded: bool,
}

/// Only the exact boolean true counts; anything else (missing, a string, a number) is a normal apply.
fn apply_outcome(body: &Value) -> ApplyOutcome {
    ApplyOutcome { superseded: body.get("superseded") == Some(&Value::Bool(true)) }
}

fn apply_error(code: u16) -> &'static str {
    apply_error_for(false, code)
}

/// The words for a failed start. A scene card gets scene wording for the two statuses that mean
/// "not there"; everything else keeps the mood words.
fn apply_error_for(scene: bool, code: u16) -> &'static str {
    match code {
        404 | 409 if scene => "That scene is not available in the home app",
        409 => "Moods are not set up in the home app yet",
        404 => "Unknown mood",
        _ => "Could not set the mood",
    }
}

#[tauri::command]
pub async fn wall2_moods(app: tauri::AppHandle) -> Result<Vec<Mood>, String> {
    let base = read_base(&app, "homeBaseUrl", false)?;
    tauri::async_runtime::spawn_blocking(move || {
        let body = get_json(&format!("{base}/api/moods"))?;
        // The scenes are extra: when the routines cannot be read the moods still come back.
        let routines = get_json_with_timeout(&format!("{base}/api/routines"), ROUTINES_TIMEOUT).ok();
        Ok(merge_moods(pick_moods(&body), routines.as_ref()))
    })
    .await
    .map_err(|_| "The request did not finish".to_string())?
}

#[tauri::command]
pub async fn wall2_apply_mood(app: tauri::AppHandle, id: String) -> Result<ApplyOutcome, String> {
    // A scene id starts its routine; the same no-auth route the home app's Scenes tab uses.
    if apply_url("", &id).is_none() {
        return Err("Unknown mood".to_string());
    }
    let base = read_base(&app, "homeBaseUrl", false)?;
    let Some(url) = apply_url(&base, &id) else {
        return Err("Unknown mood".to_string());
    };
    let scene = is_scene(&id);
    tauri::async_runtime::spawn_blocking(move || {
        let result = agent()
            .post(&url)
            .set("Accept", "application/json")
            .timeout(APPLY_TIMEOUT)
            .call();
        match result {
            Ok(resp) => {
                let resp = require_ok(resp).map_err(|_| apply_error(0).to_string())?;
                // A body that cannot be read or parsed still means the mood ran.
                let body = read_body(resp).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).unwrap_or(Value::Null);
                Ok(apply_outcome(&body))
            }
            Err(ureq::Error::Status(code, _)) => Err(apply_error_for(scene, code).to_string()),
            Err(e) => {
                let _ = describe(e);
                Err(apply_error(0).to_string())
            }
        }
    })
    .await
    .map_err(|_| "The request did not finish".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn id_check() {
        assert!(valid_mood_id("day"));
        assert!(valid_mood_id("lateNight"));
        assert!(valid_mood_id("a1"));
        assert!(valid_mood_id(&format!("a{}", "b".repeat(31))));
        assert!(!valid_mood_id(""));
        assert!(!valid_mood_id("1day"));
        assert!(!valid_mood_id(&format!("a{}", "b".repeat(32))));
        assert!(!valid_mood_id("late-night"));
        assert!(!valid_mood_id("a/b"));
        assert!(!valid_mood_id("../x"));
        assert!(!valid_mood_id("a b"));
        assert!(!valid_mood_id("caf\u{e9}"));
    }

    #[test]
    fn labels() {
        assert_eq!(mood_label("day"), "Day");
        assert_eq!(mood_label("evening"), "Evening");
        assert_eq!(mood_label("lateNight"), "Late Night");
        assert_eq!(mood_label("movieTimeTwo"), "Movie Time Two");
    }

    #[test]
    fn parses_in_server_order_and_skips_bad_ids() {
        let body = json!({"ok": true, "seeded": false, "moods": {"day": {}, "evening": {}, "bad-id": {}, "lateNight": {}}});
        let ids: Vec<String> = pick_moods(&body).into_iter().map(|m| m.id).collect();
        assert_eq!(ids, vec!["day", "evening", "lateNight"]);
        assert_eq!(pick_moods(&body)[2].label, "Late Night");
        // Server order, not alphabetical: "lateNight" before "day" stays that way.
        let body = json!({"moods": {"lateNight": {}, "day": {}, "evening": {}}});
        let ids: Vec<String> = pick_moods(&body).into_iter().map(|m| m.id).collect();
        assert_eq!(ids, vec!["lateNight", "day", "evening"]);
    }

    #[test]
    fn reads_the_saved_flag() {
        let body = json!({"moods": {"stillWorking": {"saved": false}, "day": {"saved": true}, "evening": {}, "lateNight": {"saved": "no"}}});
        let saved: Vec<bool> = pick_moods(&body).into_iter().map(|m| m.saved).collect();
        assert_eq!(saved, vec![false, true, true, true]);
    }

    #[test]
    fn reads_superseded_from_the_apply_answer() {
        assert!(apply_outcome(&json!({"ok": true, "superseded": true})).superseded);
        assert!(!apply_outcome(&json!({"ok": true})).superseded);
        assert!(!apply_outcome(&json!({"ok": true, "superseded": false})).superseded);
        assert!(!apply_outcome(&json!({"ok": true, "superseded": "true"})).superseded);
        assert!(!apply_outcome(&Value::Null).superseded);
    }

    #[test]
    fn caps_at_twelve_and_handles_missing_moods() {
        let mut map = serde_json::Map::new();
        for i in 0..20 {
            map.insert(format!("m{i}"), json!({}));
        }
        assert_eq!(pick_moods(&json!({ "moods": map })).len(), 12);
        assert!(pick_moods(&json!({"ok": true})).is_empty());
        assert!(pick_moods(&json!({"moods": []})).is_empty());
    }

    fn routines() -> Value {
        json!([
            {"id": "fireplace_cozy", "name": "Fireplace Cozy", "active": false, "description": "Warm amber and jazz"},
            {"id": "other", "name": "Other"},
            {"id": "romantic_mode", "name": "Romantic Mode", "active": true},
            {"id": "movie_mode", "name": "Movie Night"}
        ])
    }

    #[test]
    fn scenes_follow_the_moods_in_a_fixed_order() {
        let moods = pick_moods(&json!({"moods": {"day": {}, "evening": {}}}));
        let all = merge_moods(moods, Some(&routines()));
        let ids: Vec<&str> = all.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, vec!["day", "evening", "romantic_mode", "movie_mode", "fireplace_cozy"]);
        let kinds: Vec<&str> = all.iter().map(|m| m.kind).collect();
        assert_eq!(kinds, vec!["mood", "mood", "scene", "scene", "scene"]);
        assert_eq!(all[3].label, "Movie Night");
        assert_eq!(all[4].line.as_deref(), Some("Warm amber and jazz"));
        assert_eq!(all[2].line, None);
        // The wrapped shape reads the same.
        let wrapped = json!({"routines": routines()});
        assert_eq!(pick_scenes(&wrapped), pick_scenes(&routines()));
    }

    #[test]
    fn a_missing_routine_is_skipped() {
        let body = json!([{"id": "movie_mode", "name": "Movie Mode"}, {"id": "nope"}]);
        let ids: Vec<String> = pick_scenes(&body).into_iter().map(|m| m.id).collect();
        assert_eq!(ids, vec!["movie_mode"]);
        assert!(pick_scenes(&json!({"ok": true})).is_empty());
        assert!(pick_scenes(&json!([])).is_empty());
    }

    #[test]
    fn a_failed_routines_read_keeps_the_moods() {
        let moods = pick_moods(&json!({"moods": {"day": {}, "evening": {}}}));
        let all = merge_moods(moods.clone(), None);
        assert_eq!(all, moods);
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn only_listed_scenes_can_be_started() {
        assert_eq!(apply_url("http://h", "movie_mode").as_deref(), Some("http://h/api/routines/movie_mode/start"));
        assert_eq!(apply_url("http://h", "day").as_deref(), Some("http://h/api/moods/day/apply"));
        assert_eq!(apply_url("http://h", "other_routine"), None);
        assert_eq!(apply_url("http://h", "movie_mode/../x"), None);
        assert_eq!(apply_url("http://h", ""), None);
    }

    #[test]
    fn apply_errors_map_status_codes() {
        assert_eq!(apply_error(409), "Moods are not set up in the home app yet");
        assert_eq!(apply_error(404), "Unknown mood");
        assert_eq!(apply_error(500), "Could not set the mood");
        assert_eq!(apply_error(0), "Could not set the mood");
    }

    #[test]
    fn scene_cards_get_scene_wording() {
        assert_eq!(apply_error_for(true, 404), "That scene is not available in the home app");
        assert_eq!(apply_error_for(true, 409), "That scene is not available in the home app");
        assert_eq!(apply_error_for(true, 500), "Could not set the mood");
        assert_eq!(apply_error_for(false, 404), "Unknown mood");
        assert_eq!(apply_error_for(false, 409), "Moods are not set up in the home app yet");
    }

    #[test]
    fn scene_text_trims_truncates_and_skips_blank() {
        let long = "x".repeat(80);
        let r = json!({"name": long, "description": "   "});
        assert_eq!(scene_text(&r, "name").map(|t| t.chars().count()), Some(MAX_SCENE_TEXT));
        assert_eq!(scene_text(&r, "description"), None);
        let body = json!([{"id": "movie_mode", "name": "   "}]);
        assert_eq!(pick_scenes(&body)[0].label, "Movie Mode");
        assert!(pick_scenes(&json!({"routines": "x"})).is_empty());
    }
}
