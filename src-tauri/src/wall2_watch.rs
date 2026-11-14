//! Wall 2's Watch tab: open a saved item on its own site in the default browser.
//!
//! The page sends only a kind and an id, never an address. Both are checked again here with
//! the same rules the page uses (a YouTube video or live stream id is exactly 11 of
//! `[A-Za-z0-9_-]`, a playlist id 13 to 64 of the same, a Twitch login 3 to 25 of
//! `[a-z0-9_]`), and the address is built here on one of three fixed prefixes. Only the
//! `wall2` window may call it. Errors are short and never echo what was sent.

use tauri_plugin_opener::OpenerExt;

const UNKNOWN: &str = "Unknown item";

fn id_chars(id: &str, upper_ok: bool) -> bool {
    id.bytes().all(|b| b.is_ascii_digit() || b == b'_' || b.is_ascii_lowercase() || (upper_ok && (b.is_ascii_uppercase() || b == b'-')))
}

fn valid_video_id(id: &str) -> bool {
    id.len() == 11 && id_chars(id, true)
}

fn valid_playlist_id(id: &str) -> bool {
    (13..=64).contains(&id.len()) && id_chars(id, true)
}

fn valid_login(id: &str) -> bool {
    (3..=25).contains(&id.len()) && id_chars(id, false)
}

/// The address for a kind and an id, or `Unknown item` when either does not pass.
pub(crate) fn watch_link(kind: &str, id: &str) -> Result<String, String> {
    match kind {
        "video" | "live" if valid_video_id(id) => Ok(format!("https://www.youtube.com/watch?v={id}")),
        "playlist" if valid_playlist_id(id) => Ok(format!("https://www.youtube.com/playlist?list={id}")),
        "twitch" if valid_login(id) => Ok(format!("https://www.twitch.tv/{id}")),
        _ => Err(UNKNOWN.to_string()),
    }
}

/// The latest start time passed on (a week of seconds); anything past it is left off.
const MAX_AT: u32 = 7 * 24 * 3600;

/// `watch_link`, starting a video (not a live stream, a playlist or Twitch) at `at` whole
/// seconds when given, more than zero and at most `MAX_AT`. The number is formatted here.
pub(crate) fn watch_link_at(kind: &str, id: &str, at: Option<u32>) -> Result<String, String> {
    let url = watch_link(kind, id)?;
    match at {
        Some(t) if kind == "video" && t > 0 && t <= MAX_AT => Ok(format!("{url}&t={t}s")),
        _ => Ok(url),
    }
}

/// The checks before anything opens: the calling window, then the kind and id.
fn check_open(label: &str, kind: &str, id: &str, at: Option<u32>) -> Result<String, String> {
    crate::wall2_omni::require_wall2(label)?;
    watch_link_at(kind, id, at)
}

/// Open a saved Watch item in the browser ("Open in YouTube" or "Open on Twitch"), a video at
/// the time the player last reported when the page passes one.
#[tauri::command]
pub fn wall2_watch_open(window: tauri::WebviewWindow, app: tauri::AppHandle, kind: String, id: String, at: Option<u32>) -> Result<(), String> {
    let url = check_open(window.label(), &kind, &id, at)?;
    app.opener().open_url(url, None::<&str>).map_err(|_| "Could not open the link".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_the_three_addresses() {
        assert_eq!(watch_link("video", "Ab3dEfGh1jK").unwrap(), "https://www.youtube.com/watch?v=Ab3dEfGh1jK");
        assert_eq!(watch_link("live", "Lofi_Live-1").unwrap(), "https://www.youtube.com/watch?v=Lofi_Live-1");
        assert_eq!(watch_link("playlist", "PLmockPlaylist0001").unwrap(), "https://www.youtube.com/playlist?list=PLmockPlaylist0001");
        assert_eq!(watch_link("twitch", "pixel_harbor").unwrap(), "https://www.twitch.tv/pixel_harbor");
    }

    #[test]
    fn refuses_bad_ids() {
        let long_playlist = "P".repeat(65);
        let long_login = "a".repeat(26);
        let cases: [(&str, &str); 17] = [
            ("video", "short"),
            ("video", "Ab3dEfGh1jKx"),
            ("video", "Ab3dEfGh1j/"),
            ("video", "Ab3dEfGh1j?"),
            ("video", "Ab3dEf h1jK"),
            ("video", "Ab3dEfGh1j\u{e9}"),
            ("live", ""),
            ("playlist", "PL12345678"),
            ("playlist", long_playlist.as_str()),
            ("playlist", "PLmock/../../x1"),
            ("twitch", "ab"),
            ("twitch", "Pixel_Harbor"),
            ("twitch", "pixel-harbor"),
            ("twitch", long_login.as_str()),
            ("twitch", "evil.example"),
            ("other", "Ab3dEfGh1jK"),
            ("", ""),
        ];
        for (kind, id) in cases {
            assert_eq!(watch_link(kind, id), Err(UNKNOWN.to_string()), "{kind} {id}");
        }
    }

    #[test]
    fn only_the_wall2_window_may_open() {
        assert_eq!(check_open("main", "video", "Ab3dEfGh1jK", None), Err("forbidden".to_string()));
        assert_eq!(check_open("wall2", "video", "Ab3dEfGh1jK", None).unwrap(), "https://www.youtube.com/watch?v=Ab3dEfGh1jK");
        assert_eq!(check_open("wall2", "video", "javascript:x", Some(5)), Err(UNKNOWN.to_string()));
    }

    #[test]
    fn a_video_opens_at_the_time_given_and_nothing_else_does() {
        assert_eq!(watch_link_at("video", "Ab3dEfGh1jK", Some(754)).unwrap(), "https://www.youtube.com/watch?v=Ab3dEfGh1jK&t=754s");
        assert_eq!(watch_link_at("video", "Ab3dEfGh1jK", Some(0)).unwrap(), "https://www.youtube.com/watch?v=Ab3dEfGh1jK");
        assert_eq!(watch_link_at("video", "Ab3dEfGh1jK", Some(MAX_AT + 1)).unwrap(), "https://www.youtube.com/watch?v=Ab3dEfGh1jK");
        assert_eq!(watch_link_at("live", "Lofi_Live-1", Some(60)).unwrap(), "https://www.youtube.com/watch?v=Lofi_Live-1");
        assert_eq!(watch_link_at("playlist", "PLmockPlaylist0001", Some(60)).unwrap(), "https://www.youtube.com/playlist?list=PLmockPlaylist0001");
        assert_eq!(watch_link_at("twitch", "pixel_harbor", Some(60)).unwrap(), "https://www.twitch.tv/pixel_harbor");
        assert_eq!(watch_link_at("video", "bad", Some(60)), Err(UNKNOWN.to_string()));
    }

    #[test]
    fn playlist_and_video_lengths_at_the_edges() {
        assert!(watch_link("playlist", &"a".repeat(13)).is_ok());
        assert!(watch_link("playlist", &"a".repeat(64)).is_ok());
        assert!(watch_link("playlist", &"a".repeat(12)).is_err());
        assert!(watch_link("twitch", "abc").is_ok());
        assert!(watch_link("twitch", &"a".repeat(25)).is_ok());
    }

    /// Both Wall 2 policies refuse to be framed and allow frames from the two players only.
    #[test]
    fn wall2_policies_refuse_framing() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.wall2.conf.json")).unwrap();
        for key in ["csp", "devCsp"] {
            let csp = &conf["app"]["security"][key];
            assert_eq!(csp["frame-ancestors"], "'none'", "{key}");
            assert_eq!(csp["default-src"], "'none'", "{key}");
            let mut hosts: Vec<&str> = csp["frame-src"].as_str().unwrap().split_whitespace().collect();
            hosts.sort_unstable();
            assert_eq!(hosts, ["https://player.twitch.tv", "https://www.youtube-nocookie.com"], "{key}");
        }
    }
}
