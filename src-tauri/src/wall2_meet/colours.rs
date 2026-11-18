//! Outlook category colours: which permission an account has, the master category list, and
//! the colour an event takes. Pure functions only (no network, no store), so they can be
//! tested on their own. Everything from Graph here is untrusted input: names are cleaned and
//! capped, colours are only ever one of 25 fixed tokens, and a name is never logged.

use super::auth::SCOPE;
use super::graph::normalize_title;
use serde_json::Value;

/// Refresh scope for an account whose sign-in granted `MailboxSettings.Read`, the least privileged permission for listing the
/// master categories (Graph v1.0 "List masterCategories", Permissions table). Both scopes
/// belong to the Graph resource, so one access token serves both reads.
pub const SCOPE_COLOURS: &str = "offline_access https://graph.microsoft.com/Calendars.Read https://graph.microsoft.com/MailboxSettings.Read";

/// The most categories kept from one reply. Outlook maps at most 25 colours; names can repeat
/// a colour, so this leaves room without letting a reply grow the cache.
pub const MAX_CATEGORIES: usize = 100;
/// Longest name kept, in characters, for matching and for the hover card.
pub const MAX_NAME_CHARS: usize = 64;
/// Most category names read from one event.
pub const MAX_EVENT_CATEGORIES: usize = 10;
/// A good list is read again after this long (and after every sign-in).
pub const REFRESH_SECS: u64 = 30 * 60;
/// After a failed read the next try waits this long; the last good list is kept meanwhile.
pub const RETRY_SECS: u64 = 5 * 60;

// Section: the permission

/// True when a granted-scope string names `MailboxSettings.Read`. Names come bare
/// (`MailboxSettings.Read`) or as the full resource URL, in any case, sometimes percent
/// encoded, so each word is compared by its last path segment.
pub fn grants_colours(scope: &str) -> bool {
    scope.split_whitespace().any(|word| {
        let lower = word.to_ascii_lowercase().replace("%2f", "/");
        lower.rsplit('/').next() == Some("mailboxsettings.read")
    })
}

/// The scope a refresh asks for, from the scope recorded at the account's last sign-in.
///
/// Rule: a refresh must ask for no more than was granted at sign-in. The identity platform
/// documents that the `scope` of a refresh request "must be equivalent to or a subset of the
/// scopes requested in the original authorization_code request leg" and answers a scope the
/// client was never consented to with `consent_required` or `invalid_grant`
/// (learn.microsoft.com, "Microsoft identity platform and OAuth 2.0 authorization code flow",
/// Refresh the access token and Error codes for token endpoint errors). An account signed in
/// before this change, or with no record, therefore keeps refreshing with the calendar scope.
pub fn refresh_scope(record: Option<&str>) -> &'static str {
    if record.is_some_and(grants_colours) {
        SCOPE_COLOURS
    } else {
        SCOPE
    }
}

/// What to record after a sign-in: the colours scope only when it was asked for and the token
/// reply did not say otherwise. A reply without a `scope` field is for the scopes requested
/// (token endpoint reference, "scope ... if omitted, the token is for the scopes requested on
/// the initial leg").
pub fn recorded_scope(requested: &str, reply: Option<&str>) -> &'static str {
    let granted = match reply {
        Some(r) => grants_colours(r),
        None => grants_colours(requested),
    };
    if granted && grants_colours(requested) {
        SCOPE_COLOURS
    } else {
        SCOPE
    }
}

/// True when a refresh that asked for `asked` and was answered with a dead or refused grant
/// should be tried once more with the calendar scope alone: only a colours-scope refresh has a
/// narrower scope to fall back to, so a calendar-only refresh is never repeated.
pub fn retry_calendar_only(asked: &str) -> bool {
    grants_colours(asked)
}

/// True when the master category read says the permission is gone (an admin withdrew it after
/// sign-in): a 401 (`unauthorized`) or a 403 status. The account then drops to calendar-only
/// and the reads stop until the next sign-in.
pub fn read_says_withdrawn(unauthorized: bool, status: Option<u16>) -> bool {
    unauthorized || matches!(status, Some(401 | 403))
}

/// Whether an error redirect from the authorization endpoint identifies a refusal of the
/// permission (as opposed to a cancel or an unrelated failure). Source: Microsoft identity
/// platform authorization code flow, "Error codes for authorization endpoint errors":
/// `access_denied` means "Resource owner denied consent", but the same code with the
/// description "the user canceled the authentication" is what a cancel sends, so
/// `access_denied` counts only when its description names consent (AADSTS65004 "user declined
/// to consent", AADSTS65001 consent missing, AADSTS90094 admin consent required) and not a
/// cancel. `consent_required` and `invalid_scope` identify the permission themselves.
pub fn consent_refused(error: &str, description: &str) -> bool {
    let error = error.to_ascii_lowercase();
    let desc = description.to_ascii_lowercase();
    match error.as_str() {
        "consent_required" | "invalid_scope" => true,
        "access_denied" => {
            !desc.contains("cancel")
                && (desc.contains("consent") || desc.contains("declined") || desc.contains("aadsts65004") || desc.contains("aadsts65001") || desc.contains("aadsts90094"))
        }
        _ => false,
    }
}

/// What a sign-in does after its first attempt ended in `outcome` (the error word `authorize`
/// returns). The calendar-only sign-in is offered once, only when the first attempt asked for
/// colours and ended in a consent refusal; a cancel, a time-out or any other failure opens
/// nothing, and the second attempt never leads to a third.
pub fn offer_calendar_only(asked: &str, outcome: &str) -> bool {
    grants_colours(asked) && outcome == "consent"
}

// Section: colours

/// Outlook's 25 preset constants, sent to the web view as these fixed tokens only.
/// Source for the preset to colour names: Microsoft Graph v1.0 "outlookCategory resource type",
/// table "Pre-set constant / Color mapped to in Outlook" (Preset0 Red, Preset1 Orange,
/// Preset2 Brown, Preset3 Yellow, Preset4 Green, Preset5 Teal, Preset6 Olive, Preset7 Blue,
/// Preset8 Purple, Preset9 Cranberry, Preset10 Steel, Preset11 DarkSteel, Preset12 Gray,
/// Preset13 DarkGray, Preset14 Black, Preset15 DarkRed, Preset16 DarkOrange,
/// Preset17 DarkBrown, Preset18 DarkYellow, Preset19 DarkGreen, Preset20 DarkTeal,
/// Preset21 DarkOlive, Preset22 DarkBlue, Preset23 DarkPurple, Preset24 DarkCranberry).
/// The wall holds the shade for each token.
pub const TOKENS: [&str; 25] = [
    "preset0", "preset1", "preset2", "preset3", "preset4", "preset5", "preset6", "preset7", "preset8", "preset9", "preset10", "preset11", "preset12",
    "preset13", "preset14", "preset15", "preset16", "preset17", "preset18", "preset19", "preset20", "preset21", "preset22", "preset23", "preset24",
];

/// The token for a Graph `color` value; `none`, an unknown value or a wrong type give nothing.
pub fn token_for(color: &str) -> Option<&'static str> {
    let lower = color.to_ascii_lowercase();
    TOKENS.iter().copied().find(|t| *t == lower)
}

/// A name as kept for matching and display: invisible and direction characters removed,
/// whitespace collapsed, capped in length.
pub fn clean_name(raw: &str) -> String {
    let t: String = normalize_title(raw).chars().take(MAX_NAME_CHARS).collect();
    t.trim().to_string()
}

fn match_key(name: &str) -> String {
    name.to_lowercase()
}

/// One account's colours: the match key of a category name with its token, first win on repeats.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Palette {
    pub entries: Vec<(String, &'static str)>,
    /// Epoch seconds before which no new read is made.
    pub next_try: u64,
}

impl Palette {
    pub fn token_of(&self, name: &str) -> Option<&'static str> {
        let key = match_key(&clean_name(name));
        self.entries.iter().find(|(k, _)| *k == key).map(|(_, t)| *t)
    }
}

/// The entries of a master category reply. None when the reply is not the expected shape.
/// Categories with no colour (`none`) or an unknown one are left out; there are at most
/// `MAX_CATEGORIES`, and a duplicate name keeps its first colour.
pub fn parse_master(body: &Value) -> Option<Vec<(String, &'static str)>> {
    let rows = body.get("value")?.as_array()?;
    let mut out: Vec<(String, &'static str)> = Vec::new();
    for row in rows.iter().take(MAX_CATEGORIES) {
        let Some(name) = row.get("displayName").and_then(Value::as_str) else { continue };
        let key = match_key(&clean_name(name));
        if key.is_empty() || out.iter().any(|(k, _)| *k == key) {
            continue;
        }
        let Some(token) = row.get("color").and_then(Value::as_str).and_then(token_for) else { continue };
        out.push((key, token));
    }
    Some(out)
}

/// The category names on one event, cleaned, empty ones dropped, at most `MAX_EVENT_CATEGORIES`.
pub fn event_categories(event: &Value) -> Vec<String> {
    event
        .get("categories")
        .and_then(Value::as_array)
        .map(|rows| rows.iter().filter_map(Value::as_str).map(clean_name).filter(|n| !n.is_empty()).take(MAX_EVENT_CATEGORIES).collect())
        .unwrap_or_default()
}

/// The colour an event takes and the category it came from.
#[derive(Debug, Clone, PartialEq)]
pub struct Pick {
    pub name: String,
    pub tone: &'static str,
}

/// The first category on the event that has a known colour.
pub fn pick(categories: &[String], palette: &Palette) -> Option<Pick> {
    categories.iter().find_map(|name| palette.token_of(name).map(|tone| Pick { name: name.clone(), tone }))
}

#[cfg(test)]
mod tests {
    use super::super::auth::{SIGN_IN_SCOPE, SIGN_IN_SCOPE_NO_COLOURS};
    use super::*;
    use serde_json::json;

    #[test]
    fn a_colours_refresh_that_is_refused_falls_back_once() {
        assert!(retry_calendar_only(SCOPE_COLOURS));
        assert!(!retry_calendar_only(SCOPE));
        assert!(!retry_calendar_only(""));
    }

    #[test]
    fn a_401_or_403_on_the_category_read_means_withdrawn() {
        assert!(read_says_withdrawn(true, None));
        assert!(read_says_withdrawn(false, Some(403)));
        assert!(read_says_withdrawn(false, Some(401)));
        assert!(!read_says_withdrawn(false, Some(500)));
        assert!(!read_says_withdrawn(false, Some(404)));
        assert!(!read_says_withdrawn(false, None));
    }

    #[test]
    fn the_calendar_only_sign_in_decision_table() {
        // (asked, outcome of the first attempt) -> offer
        for (asked, outcome, offer) in [
            (SCOPE_COLOURS, "consent", true),
            (SCOPE_COLOURS, "denied", false),
            (SCOPE_COLOURS, "failed", false),
            (SCOPE_COLOURS, "cancelled", false),
            (SCOPE_COLOURS, "timed-out", false),
            (SCOPE_COLOURS, "busy", false),
            (SCOPE, "consent", false),
            (SCOPE, "denied", false),
        ] {
            assert_eq!(offer_calendar_only(asked, outcome), offer, "{asked} {outcome}");
        }
    }

    #[test]
    fn only_a_consent_refusal_is_told_from_a_cancel() {
        assert!(consent_refused("access_denied", "AADSTS65004: The user declined to consent to access the app."));
        assert!(consent_refused("access_denied", "AADSTS90094: admin consent required"));
        assert!(consent_refused("consent_required", ""));
        assert!(consent_refused("invalid_scope", "x"));
        assert!(!consent_refused("access_denied", "the user canceled the authentication"));
        assert!(!consent_refused("access_denied", "AADSTS65004 user declined to consent, canceled"));
        assert!(!consent_refused("access_denied", ""));
        assert!(!consent_refused("server_error", "consent"));
    }

    #[test]
    fn the_permission_is_read_from_the_granted_scope() {
        assert!(grants_colours("Calendars.Read MailboxSettings.Read openid profile"));
        assert!(grants_colours("https://graph.microsoft.com/Calendars.Read https://graph.microsoft.com/MailboxSettings.Read"));
        assert!(grants_colours("https%3A%2F%2Fgraph.microsoft.com%2Fmailboxsettings.read"));
        assert!(!grants_colours("offline_access https://graph.microsoft.com/Calendars.Read"));
        assert!(!grants_colours("MailboxSettings.ReadWrite"));
        assert!(!grants_colours(""));
        assert!(!grants_colours("https://example.com/not-MailboxSettings.Read.Extra"));
    }

    #[test]
    fn an_account_with_no_record_refreshes_with_the_old_scope() {
        assert_eq!(refresh_scope(None), SCOPE);
        assert_eq!(refresh_scope(Some("")), SCOPE);
        assert_eq!(refresh_scope(Some(SCOPE)), SCOPE);
        assert_eq!(refresh_scope(Some(SCOPE_COLOURS)), SCOPE_COLOURS);
        assert!(!SCOPE.contains("MailboxSettings"));
        assert!(SCOPE_COLOURS.starts_with(SCOPE));
    }

    #[test]
    fn a_sign_in_records_only_what_was_granted() {
        assert_eq!(recorded_scope(SCOPE_COLOURS, None), SCOPE_COLOURS);
        assert_eq!(recorded_scope(SCOPE_COLOURS, Some("Calendars.Read MailboxSettings.Read")), SCOPE_COLOURS);
        assert_eq!(recorded_scope(SCOPE_COLOURS, Some("Calendars.Read")), SCOPE);
        assert_eq!(recorded_scope(SCOPE, None), SCOPE);
        // The combined sign-in records the colours refresh scope; its fallback records the calendar scope.
        assert_eq!(recorded_scope(SIGN_IN_SCOPE, None), SCOPE_COLOURS);
        assert_eq!(recorded_scope(SIGN_IN_SCOPE_NO_COLOURS, None), SCOPE);
        assert!(offer_calendar_only(SIGN_IN_SCOPE, "consent"));
        assert!(!offer_calendar_only(SIGN_IN_SCOPE_NO_COLOURS, "consent"));
        // A reply naming the permission does not widen a request that never asked for it.
        assert_eq!(recorded_scope(SCOPE, Some("Calendars.Read MailboxSettings.Read")), SCOPE);
    }

    #[test]
    fn every_preset_has_a_token_and_nothing_else_does() {
        for n in 0..25 {
            assert_eq!(token_for(&format!("preset{n}")), Some(TOKENS[n]));
            assert_eq!(token_for(&format!("Preset{n}")), Some(TOKENS[n]));
        }
        for bad in ["none", "None", "", "preset25", "preset-1", "preset01", "red", "#ff0000", "preset7 ", "rgb(1,2,3)"] {
            assert_eq!(token_for(bad), None, "{bad}");
        }
    }

    #[test]
    fn the_master_list_is_cleaned_capped_and_keeps_known_colours_only() {
        let body = json!({"value": [
            {"displayName": "Alpha", "color": "preset7"},
            {"displayName": "Beta\u{202E}x", "color": "preset0"},
            {"displayName": "Plain", "color": "none"},
            {"displayName": "Odd", "color": "chartreuse"},
            {"displayName": "alpha", "color": "preset1"},
            {"displayName": 7, "color": "preset2"},
            {"color": "preset3"},
            {"displayName": "   ", "color": "preset4"}
        ]});
        let list = parse_master(&body).unwrap();
        assert_eq!(list, vec![("alpha".to_string(), "preset7"), ("betax".to_string(), "preset0")]);
        assert_eq!(parse_master(&json!({"nope": 1})), None);
        assert_eq!(parse_master(&json!({"value": "x"})), None);
        let many: Vec<Value> = (0..300).map(|n| json!({"displayName": format!("c{n}"), "color": "preset5"})).collect();
        assert_eq!(parse_master(&json!({"value": many})).unwrap().len(), MAX_CATEGORIES);
        let long = "n".repeat(500);
        let name = clean_name(&long);
        assert_eq!(name.chars().count(), MAX_NAME_CHARS);
        let p = Palette { entries: parse_master(&json!({"value": [{"displayName": long, "color": "preset9"}]})).unwrap(), next_try: 0 };
        assert_eq!(p.token_of(&long), Some("preset9"));
    }

    #[test]
    fn an_event_takes_its_first_category_that_has_a_colour() {
        let palette = Palette { entries: parse_master(&json!({"value": [
            {"displayName": "Blue team", "color": "preset7"},
            {"displayName": "Reds", "color": "preset0"},
            {"displayName": "Blank", "color": "none"}
        ]})).unwrap(), next_try: 0 };
        let ev = json!({"categories": ["Blank", "unknown", "reds", "Blue team"]});
        let cats = event_categories(&ev);
        assert_eq!(cats, ["Blank", "unknown", "reds", "Blue team"]);
        assert_eq!(pick(&cats, &palette), Some(Pick { name: "reds".into(), tone: "preset0" }));
        assert_eq!(pick(&event_categories(&json!({"categories": ["Blank", "unknown"]})), &palette), None);
        assert_eq!(pick(&event_categories(&json!({})), &palette), None);
        assert_eq!(pick(&event_categories(&json!({"categories": "x"})), &palette), None);
        let long: Vec<Value> = (0..40).map(|n| json!(format!("c{n}"))).collect();
        assert_eq!(event_categories(&json!({"categories": long})).len(), MAX_EVENT_CATEGORIES);
        assert_eq!(event_categories(&json!({"categories": ["\u{200B}", 5, "  A\u{7} b "]})), ["A b"]);
    }
}
