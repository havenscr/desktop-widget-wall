//! Wall 2 Home tab moods: lists the home app's moods and applies one on request.
//!
//! The address comes from `feeds.json` (`homeBaseUrl`) through the helpers in
//! `wall2_feeds.rs` and is never put in an error message. Nothing here runs unless the
//! front end calls it, and the front end calls `wall2_apply_mood` only on a tap.

use crate::wall2_feeds::{agent, describe, get_json, read_base, require_ok};
use serde::Serialize;
use serde_json::Value;

const MAX_MOODS: usize = 12;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Mood {
    pub id: String,
    pub label: String,
}

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
        .map(|k| Mood { id: k.clone(), label: mood_label(k) })
        .collect()
}

fn apply_error(code: u16) -> &'static str {
    match code {
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
        Ok(pick_moods(&body))
    })
    .await
    .map_err(|_| "The request did not finish".to_string())?
}

#[tauri::command]
pub async fn wall2_apply_mood(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if !valid_mood_id(&id) {
        return Err("Unknown mood".to_string());
    }
    let base = read_base(&app, "homeBaseUrl", false)?;
    tauri::async_runtime::spawn_blocking(move || {
        let result = agent()
            .post(&format!("{base}/api/moods/{id}/apply"))
            .set("Accept", "application/json")
            .call();
        match result {
            Ok(resp) => require_ok(resp).map(|_| ()).map_err(|_| apply_error(0).to_string()),
            Err(ureq::Error::Status(code, _)) => Err(apply_error(code).to_string()),
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
    fn caps_at_twelve_and_handles_missing_moods() {
        let mut map = serde_json::Map::new();
        for i in 0..20 {
            map.insert(format!("m{i}"), json!({}));
        }
        assert_eq!(pick_moods(&json!({ "moods": map })).len(), 12);
        assert!(pick_moods(&json!({"ok": true})).is_empty());
        assert!(pick_moods(&json!({"moods": []})).is_empty());
    }

    #[test]
    fn apply_errors_map_status_codes() {
        assert_eq!(apply_error(409), "Moods are not set up in the home app yet");
        assert_eq!(apply_error(404), "Unknown mood");
        assert_eq!(apply_error(500), "Could not set the mood");
        assert_eq!(apply_error(0), "Could not set the mood");
    }
}
