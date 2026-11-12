//! Graph calendar read: UTC time helpers, response shaping, the join-link allowlist.

use super::MAX_TITLE_CHARS;
use serde_json::Value;

pub const MAX_MEETINGS: usize = 8;

/// One meeting as read from one account. `join` stays in Rust.
#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    pub ical: Option<String>,
    pub title: String,
    pub start: String,
    pub end: String,
    pub account_id: String,
    pub join: Option<String>,
}

pub enum GraphReply {
    Ok(Value),
    Unauthorized,
    Transient,
    Failed,
}

pub trait GraphClient {
    fn calendar_view(&self, access: &str, start: &str, end: &str) -> GraphReply;
}

// Section: time

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Seconds since the Unix epoch as `2026-11-12T17:00:00Z`.
pub fn utc_iso(secs: u64) -> String {
    let secs = secs as i64;
    let (y, m, d) = civil_from_days(secs.div_euclid(86_400));
    let rem = secs.rem_euclid(86_400);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, (rem % 3600) / 60, rem % 60)
}

/// Graph sends `2026-11-12T17:00:00.0000000` (UTC when asked with the Prefer header).
/// Returns `2026-11-12T17:00:00Z`, or None when the text is not that shape.
pub fn normalize_graph_time(raw: &str) -> Option<String> {
    let head = raw.get(..19)?;
    let ok = head.char_indices().all(|(i, c)| match i {
        4 | 7 => c == '-',
        10 => c == 'T',
        13 | 16 => c == ':',
        _ => c.is_ascii_digit(),
    });
    if !ok {
        return None;
    }
    let tail = &raw[19..];
    let tail_ok = match tail.strip_suffix('Z').unwrap_or(tail) {
        "" => true,
        frac => frac.strip_prefix('.').map(|f| !f.is_empty() && f.chars().all(|c| c.is_ascii_digit())).unwrap_or(false),
    };
    if !tail_ok {
        return None;
    }
    Some(format!("{head}Z"))
}

// Section: join allowlist

/// Only a Teams meeting link on a fixed host and path shape may get a Join button.
pub fn join_allowed(raw: &str) -> bool {
    if raw.len() > 2048 || raw.chars().any(|c| c == '\\' || c.is_whitespace() || c.is_control()) {
        return false;
    }
    let Ok(url) = tauri::Url::parse(raw) else {
        return false;
    };
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    if !matches!(url.port(), None | Some(443)) {
        return false;
    }
    let host_ok = matches!(url.host_str().map(str::to_ascii_lowercase).as_deref(), Some("teams.microsoft.com") | Some("teams.live.com"));
    host_ok && (url.path().starts_with("/l/meetup-join/") || url.path().starts_with("/meet/"))
}

// Section: shaping

fn cap_title(raw: &str) -> String {
    let t: String = raw.trim().chars().take(MAX_TITLE_CHARS).collect();
    let t = t.trim().to_string();
    if t.is_empty() {
        "Untitled".to_string()
    } else {
        t
    }
}

fn str_at<'a>(v: &'a Value, path: &[&str]) -> Option<&'a str> {
    let mut cur = v;
    for key in path {
        cur = cur.get(*key)?;
    }
    cur.as_str()
}

/// Events of one account: not cancelled, not declined, not all-day, with a valid start and end.
pub fn shape_events(body: &Value, account_id: &str) -> Vec<Candidate> {
    let Some(rows) = body.get("value").and_then(Value::as_array) else {
        return Vec::new();
    };
    rows.iter()
        .filter(|e| e.get("isCancelled").and_then(Value::as_bool) != Some(true))
        .filter(|e| e.get("isAllDay").and_then(Value::as_bool) != Some(true))
        .filter(|e| str_at(e, &["responseStatus", "response"]) != Some("declined"))
        .filter_map(|e| {
            let start = normalize_graph_time(str_at(e, &["start", "dateTime"])?)?;
            let end = normalize_graph_time(str_at(e, &["end", "dateTime"])?)?;
            let join = [str_at(e, &["onlineMeeting", "joinUrl"]), str_at(e, &["onlineMeetingUrl"])]
                .into_iter()
                .flatten()
                .find(|u| join_allowed(u))
                .map(str::to_string);
            Some(Candidate {
                ical: e.get("iCalUId").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string),
                title: cap_title(e.get("subject").and_then(Value::as_str).unwrap_or("")),
                start,
                end,
                account_id: account_id.to_string(),
                join,
            })
        })
        .collect()
}

/// Both accounts together, sorted by start, first eight. The same invite seen on two
/// accounts shows once, but only when `iCalUId`, start, end and join link all match: a copied
/// UID alone must not hide a different meeting or take its Join button.
pub fn merge(per_account: Vec<Vec<Candidate>>) -> Vec<Candidate> {
    let mut all: Vec<Candidate> = Vec::new();
    for list in per_account {
        let earlier = all.len();
        for c in list {
            let same_invite_elsewhere = c.ical.is_some()
                && all[..earlier].iter().any(|e| {
                    e.account_id != c.account_id && e.ical == c.ical && e.start == c.start && e.end == c.end && e.join == c.join
                });
            if !same_invite_elsewhere {
                all.push(c);
            }
        }
    }
    all.sort_by(|a, b| a.start.cmp(&b.start));
    all.truncate(MAX_MEETINGS);
    all
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn utc_formatter_known_dates() {
        assert_eq!(utc_iso(0), "1970-01-01T00:00:00Z");
        assert_eq!(utc_iso(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(utc_iso(1_709_164_800 + 86_399), "2024-02-29T23:59:59Z");
        assert_eq!(utc_iso(1_798_761_599), "2026-12-31T23:59:59Z");
        assert_eq!(utc_iso(1_798_761_600), "2027-01-01T00:00:00Z");
        assert_eq!(utc_iso(1_794_459_600), "2026-11-12T05:00:00Z");
    }

    #[test]
    fn graph_time_is_normalized() {
        assert_eq!(normalize_graph_time("2026-11-12T17:00:00.0000000").as_deref(), Some("2026-11-12T17:00:00Z"));
        assert_eq!(normalize_graph_time("2026-11-12T17:00:00").as_deref(), Some("2026-11-12T17:00:00Z"));
        assert_eq!(normalize_graph_time("2026-11-12T17:00:00Z").as_deref(), Some("2026-11-12T17:00:00Z"));
        assert!(normalize_graph_time("2026-11-12").is_none());
        assert!(normalize_graph_time("2026-11-12T17:00:00+02:00").is_none());
        assert!(normalize_graph_time("nonsense text here!!").is_none());
    }

    fn event(subject: &str, start: &str, ical: &str) -> Value {
        json!({
            "subject": subject,
            "start": { "dateTime": start, "timeZone": "UTC" },
            "end": { "dateTime": "2026-11-12T23:00:00.0000000", "timeZone": "UTC" },
            "isAllDay": false,
            "isCancelled": false,
            "responseStatus": { "response": "accepted" },
            "iCalUId": ical,
        })
    }

    #[test]
    fn shaping_drops_cancelled_declined_and_all_day() {
        let mut cancelled = event("c", "2026-11-12T17:00:00.0000000", "1");
        cancelled["isCancelled"] = json!(true);
        let mut declined = event("d", "2026-11-12T17:00:00.0000000", "2");
        declined["responseStatus"] = json!({ "response": "declined" });
        let mut all_day = event("a", "2026-11-12T00:00:00.0000000", "3");
        all_day["isAllDay"] = json!(true);
        let keep = event("k", "2026-11-12T18:00:00.0000000", "4");
        let out = shape_events(&json!({ "value": [cancelled, declined, all_day, keep] }), "work");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].title, "k");
        assert_eq!(out[0].start, "2026-11-12T18:00:00Z");
        assert_eq!(out[0].account_id, "work");
    }

    #[test]
    fn titles_are_trimmed_capped_and_defaulted() {
        let long = "x".repeat(300);
        let out = shape_events(
            &json!({ "value": [
                event(&long, "2026-11-12T17:00:00.0000000", "1"),
                event("   ", "2026-11-12T17:00:00.0000000", "2"),
                event("  Standup  ", "2026-11-12T17:00:00.0000000", "3"),
            ] }),
            "work",
        );
        assert_eq!(out[0].title.chars().count(), 200);
        assert_eq!(out[1].title, "Untitled");
        assert_eq!(out[2].title, "Standup");
    }

    fn cand(ical: Option<&str>, start: &str, account: &str) -> Candidate {
        Candidate {
            ical: ical.map(str::to_string),
            title: "t".into(),
            start: start.into(),
            end: "2026-11-12T23:00:00Z".into(),
            account_id: account.into(),
            join: None,
        }
    }

    #[test]
    fn merge_dedupes_sorts_and_caps() {
        let a = vec![cand(Some("same"), "2026-11-12T18:00:00Z", "work"), cand(None, "2026-11-12T20:00:00Z", "work")];
        let b = vec![cand(Some("same"), "2026-11-12T18:00:00Z", "second"), cand(None, "2026-11-12T17:00:00Z", "second")];
        let out = merge(vec![a, b]);
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].start, "2026-11-12T17:00:00Z");
        assert_eq!(out[1].account_id, "work");
        let many: Vec<Candidate> = (0..12).map(|i| cand(None, &format!("2026-11-12T{:02}:00:00Z", i), "work")).collect();
        let capped = merge(vec![many]);
        assert_eq!(capped.len(), MAX_MEETINGS);
        assert_eq!(capped[0].start, "2026-11-12T00:00:00Z");
    }

    #[test]
    fn same_uid_with_different_join_links_both_survive() {
        let mut a = cand(Some("uid"), "2026-11-12T18:00:00Z", "work");
        a.join = Some("https://teams.microsoft.com/l/meetup-join/real".into());
        let mut b = cand(Some("uid"), "2026-11-12T18:00:00Z", "second");
        b.join = Some("https://teams.microsoft.com/l/meetup-join/other".into());
        assert_eq!(merge(vec![vec![a], vec![b]]).len(), 2);
    }

    #[test]
    fn same_everything_across_two_accounts_shows_once() {
        let mut a = cand(Some("uid"), "2026-11-12T18:00:00Z", "work");
        a.join = Some("https://teams.microsoft.com/l/meetup-join/same".into());
        let mut b = a.clone();
        b.account_id = "second".into();
        let out = merge(vec![vec![a], vec![b]]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].account_id, "work");
    }

    #[test]
    fn recurring_occurrences_with_one_uid_both_survive() {
        let one = cand(Some("series"), "2026-11-12T18:00:00Z", "work");
        let two = cand(Some("series"), "2026-11-13T18:00:00Z", "work");
        let other = cand(Some("series"), "2026-11-12T18:00:00Z", "second");
        let out = merge(vec![vec![one, two], vec![other]]);
        // Same account, different starts: both stay. The second account's copy of the first
        // occurrence matches it exactly and collapses.
        assert_eq!(out.len(), 2);
        let both_second = merge(vec![vec![cand(Some("series"), "2026-11-12T18:00:00Z", "work")], vec![cand(Some("series"), "2026-11-13T18:00:00Z", "second")]]);
        assert_eq!(both_second.len(), 2);
    }

    #[test]
    fn join_link_is_kept_only_when_allowed() {
        let mut e = event("m", "2026-11-12T17:00:00.0000000", "1");
        e["onlineMeeting"] = json!({ "joinUrl": "https://teams.microsoft.com/l/meetup-join/abc" });
        let mut z = event("z", "2026-11-12T17:00:00.0000000", "2");
        z["onlineMeetingUrl"] = json!("https://zoom.example/j/1");
        let out = shape_events(&json!({ "value": [e, z] }), "work");
        assert_eq!(out[0].join.as_deref(), Some("https://teams.microsoft.com/l/meetup-join/abc"));
        assert!(out[1].join.is_none());
    }

    #[test]
    fn allowlist_accepts_teams_links() {
        assert!(join_allowed("https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0?context=%7b%7d"));
        assert!(join_allowed("https://teams.live.com/meet/9876543210?p=abc"));
        assert!(join_allowed("https://Teams.Microsoft.com/l/meetup-join/x"));
        assert!(join_allowed("https://teams.microsoft.com:443/l/meetup-join/x"));
    }

    #[test]
    fn allowlist_rejects_everything_else() {
        let long = format!("https://teams.microsoft.com/l/meetup-join/{}", "a".repeat(2049));
        let bad = [
            "http://teams.microsoft.com/l/meetup-join/x",
            "https://teams.microsoft.com.evil.example/l/meetup-join/x",
            "https://evil.example/teams.microsoft.com/l/meetup-join/x",
            "https://teams.microsoft.com@evil.example/",
            "https://teams.microsoft.com@evil.example/l/meetup-join/x",
            "https://user:pw@teams.microsoft.com/l/meetup-join/x",
            "https://teams.microsoft.com:8443/l/meetup-join/x",
            "https://nam06.safelinks.protection.outlook.com/?url=https%3A%2F%2Fteams.microsoft.com%2Fl%2Fmeetup-join%2Fx",
            "javascript:alert(1)",
            "https://teams.microsoft.com/l/meetup-join/x\\y",
            "https://teams.microsoft.com/l/meetup-join/x y",
            "https://teams.microsoft.com/other/path",
            "https://sub.teams.microsoft.com/l/meetup-join/x",
            "",
            long.as_str(),
        ];
        for url in bad {
            assert!(!join_allowed(url), "should reject {url}");
        }
    }
}
