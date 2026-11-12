//! The silent refresh and the calendar read, behind traits so tests can fake the network.

use super::auth::{TokenClient, TokenReply, SCOPE};
use super::graph::{merge, merge_capped, shape_events, MAX_DAY_EVENTS, utc_iso, Candidate, GraphClient, GraphReply};
use super::meetlog::format_line;
use super::reason::{is_valid_reason, STORE_READ, STORE_WRITE};
use super::store::{Fetch, SecretStore};
use super::Account;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;

/// Refresh an access token that has less than this left.
const SKEW_SECS: u64 = 120;
const WINDOW_SECS: u64 = 24 * 3600;

pub struct Cached {
    pub access: String,
    pub expires_at: u64,
}

/// Everything held in memory: access tokens, and the join links behind opaque keys.
#[derive(Default)]
pub struct Core {
    pub cache: HashMap<String, Cached>,
    /// Each account's last successful meetings, reused while that account is unavailable.
    pub last: HashMap<String, Vec<Candidate>>,
    /// A rotated refresh token that could not be written to the store yet. It is the one to
    /// use (and retry storing) while it is here; the stored one may already be spent.
    pub pending: HashMap<String, String>,
    /// The last state and reason logged for each account; a line is queued only on a change.
    pub states: HashMap<String, (String, Option<String>)>,
    /// Log lines waiting for the caller to hand them to the log writer.
    pub log_lines: Vec<String>,
}

/// Queue one log line when the account's state or reason differs from the last one logged.
pub fn record(core: &mut Core, id: &str, state: &str, reason: Option<&str>, now: u64) {
    let reason = reason.filter(|r| is_valid_reason(r)).map(str::to_string);
    let new = (state.to_string(), reason);
    let old = core.states.get(id).map(|(s, _)| s.as_str()).unwrap_or("start").to_string();
    if core.states.get(id) == Some(&new) {
        return;
    }
    // The queue is drained after every read; the cap only guards a caller that never drains.
    if core.log_lines.len() < 64 {
        core.log_lines.push(format_line(&utc_iso(now), id, &old, state, new.1.as_deref()));
    }
    core.states.insert(id.to_string(), new);
}

/// Join links behind opaque keys. Its own lock, never held across network I/O, so Join
/// answers at once even while a read is waiting on Graph.
#[derive(Default)]
pub struct Links {
    pub generation: u64,
    pub map: HashMap<String, String>,
    /// The day view's keys (they start with `d`), swapped separately so a day read never
    /// breaks a Join key from the next-meetings read, and the other way round.
    pub day_map: HashMap<String, String>,
}

pub fn lookup_link(links: &Mutex<Links>, key: &str) -> Option<String> {
    let guard = links.lock().unwrap_or_else(|e| e.into_inner());
    guard.map.get(key).or_else(|| guard.day_map.get(key)).cloned()
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AccountState {
    Ok,
    SignedOut,
    NeedsSignIn,
    Unavailable,
}

impl AccountState {
    fn as_str(self) -> &'static str {
        match self {
            AccountState::Ok => "ok",
            AccountState::SignedOut => "signed-out",
            AccountState::NeedsSignIn => "needs-sign-in",
            AccountState::Unavailable => "unavailable",
        }
    }
}

#[derive(Debug, Serialize)]
pub struct AccountOut {
    pub id: String,
    pub label: String,
    pub state: &'static str,
    /// Why the account is not connected: a fixed-shape code, never free text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingOut {
    pub key: String,
    pub account_id: String,
    pub title: String,
    pub start: String,
    pub end: String,
    pub can_join: bool,
}

#[derive(Debug, Serialize)]
pub struct MeetPayload {
    pub accounts: Vec<AccountOut>,
    pub meetings: Vec<MeetingOut>,
    /// True when some meetings come from an earlier read because an account was unavailable.
    pub stale: bool,
}

/// Why a state is not `Ok`: the state and a reason code when there is one.
type Fail = (AccountState, Option<String>);

/// What one account's read came to.
struct Read {
    state: AccountState,
    meetings: Option<Vec<Candidate>>,
    reason: Option<String>,
}

/// A fresh access token for the account, from the cache or a refresh.
fn obtain(
    acct: &Account,
    store: &dyn SecretStore,
    tokens: &dyn TokenClient,
    core: &mut Core,
    now: u64,
    force: bool,
) -> Result<String, Fail> {
    if let Some(p) = core.pending.get(&acct.id).cloned() {
        // An earlier rotated token never reached the store: try again before anything else.
        if !store.set(&acct.id, &p) {
            return Err((AccountState::Unavailable, Some(STORE_WRITE.to_string())));
        }
        core.pending.remove(&acct.id);
    }
    let refresh = match store.fetch(&acct.id) {
        Fetch::Found(v) => v,
        Fetch::Missing => {
            core.cache.remove(&acct.id);
            return Err((AccountState::SignedOut, None));
        }
        // The store could not be read: not signed out. Nothing is deleted or overwritten.
        Fetch::Failed => return Err((AccountState::Unavailable, Some(STORE_READ.to_string()))),
    };
    if !force {
        if let Some(c) = core.cache.get(&acct.id) {
            if c.expires_at > now + SKEW_SECS {
                return Ok(c.access.clone());
            }
        }
    }
    core.cache.remove(&acct.id);
    let form = [
        ("client_id", acct.client_id.as_str()),
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh.as_str()),
        ("scope", SCOPE),
    ];
    match tokens.post(&acct.tenant, &form) {
        TokenReply::Ok { access, expires_in, refresh: rotated } => {
            core.cache.insert(acct.id.clone(), Cached { access: access.clone(), expires_at: now + expires_in });
            if let Some(new) = rotated {
                if new != refresh && !store.set(&acct.id, &new) {
                    // The store kept the old value. Hold the new token in memory, retry next
                    // time, and report unavailable instead of connected-then-signed-out.
                    core.pending.insert(acct.id.clone(), new);
                    return Err((AccountState::Unavailable, Some(STORE_WRITE.to_string())));
                }
            }
            Ok(access)
        }
        TokenReply::Rejected(why) => {
            store.delete(&acct.id);
            core.pending.remove(&acct.id);
            Err((AccountState::NeedsSignIn, Some(why)))
        }
        // Not a dead grant but nothing a retry fixes: offer Sign in, keep the stored token.
        TokenReply::Refused(why) => Err((AccountState::NeedsSignIn, Some(why))),
        TokenReply::Transient(why) | TokenReply::Failed(why) => Err((AccountState::Unavailable, Some(why))),
    }
}

fn read_account(
    acct: &Account,
    store: &dyn SecretStore,
    tokens: &dyn TokenClient,
    graph: &dyn GraphClient,
    core: &mut Core,
    now: u64,
) -> Read {
    read_window(acct, store, tokens, graph, core, now, now, now + WINDOW_SECS)
}

/// One account's events between two instants (epoch seconds).
#[allow(clippy::too_many_arguments)]
fn read_window(
    acct: &Account,
    store: &dyn SecretStore,
    tokens: &dyn TokenClient,
    graph: &dyn GraphClient,
    core: &mut Core,
    now: u64,
    from: u64,
    to: u64,
) -> Read {
    let (start, end) = (utc_iso(from), utc_iso(to));
    let access = match obtain(acct, store, tokens, core, now, false) {
        Ok(a) => a,
        Err((state, reason)) => return Read { state, meetings: None, reason },
    };
    let mut reply = graph.calendar_view(&access, &start, &end);
    if matches!(reply, GraphReply::Unauthorized) {
        // The cached token was refused: drop it, refresh once, ask once more.
        let access = match obtain(acct, store, tokens, core, now, true) {
            Ok(a) => a,
            Err((state, reason)) => return Read { state, meetings: None, reason },
        };
        reply = graph.calendar_view(&access, &start, &end);
    }
    match reply {
        GraphReply::Ok(body) => Read { state: AccountState::Ok, meetings: Some(shape_events(&body, &acct.id)), reason: None },
        GraphReply::Unauthorized => Read { state: AccountState::Unavailable, meetings: None, reason: Some("graph-401".to_string()) },
        GraphReply::Transient(why) | GraphReply::Failed(why) => Read { state: AccountState::Unavailable, meetings: None, reason: Some(why) },
    }
}

/// Read every account, merge, and replace the link map. The payload carries no URL.
pub fn read_next(
    accounts: &[Account],
    store: &dyn SecretStore,
    tokens: &dyn TokenClient,
    graph: &dyn GraphClient,
    core: &mut Core,
    links: &Mutex<Links>,
    now: u64,
) -> MeetPayload {
    let mut statuses = Vec::new();
    let mut lists = Vec::new();
    let mut stale = false;
    for acct in accounts {
        let Read { state, meetings: fresh, reason } = read_account(acct, store, tokens, graph, core, now);
        record(core, &acct.id, state.as_str(), reason.as_deref(), now);
        let list = match fresh {
            Some(l) => {
                core.last.insert(acct.id.clone(), l.clone());
                l
            }
            // Unavailable: keep showing what the last good read held, and say so.
            None if state == AccountState::Unavailable => match core.last.get(&acct.id) {
                Some(l) => {
                    stale = true;
                    l.clone()
                }
                None => Vec::new(),
            },
            None => {
                core.last.remove(&acct.id);
                Vec::new()
            }
        };
        let reason = reason.filter(|r| is_valid_reason(r));
        statuses.push(AccountOut { id: acct.id.clone(), label: acct.label.clone(), state: state.as_str(), reason });
        lists.push(list);
    }
    let merged = merge(lists);
    // The link map is swapped in one short step at the end, after all network work is done.
    let mut guard = links.lock().unwrap_or_else(|e| e.into_inner());
    guard.generation += 1;
    guard.map.clear();
    let generation = guard.generation;
    let meetings = merged
        .into_iter()
        .enumerate()
        .map(|(n, c)| {
            let key = format!("{generation}-{n}");
            let can_join = c.join.is_some();
            if let Some(url) = c.join {
                guard.map.insert(key.clone(), url);
            }
            MeetingOut { key, account_id: c.account_id, title: c.title, start: c.start, end: c.end, can_join }
        })
        .collect();
    drop(guard);
    MeetPayload { accounts: statuses, meetings, stale }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayEventOut {
    pub key: String,
    pub account_id: String,
    pub title: String,
    pub start: String,
    pub end: String,
    pub can_join: bool,
    pub is_live: bool,
}

#[derive(Debug, Serialize)]
pub struct DayPayload {
    pub accounts: Vec<AccountOut>,
    pub events: Vec<DayEventOut>,
}

/// An event counts as a livestream when its subject starts with "Livestream".
pub fn is_live(title: &str) -> bool {
    title.trim_start().to_ascii_lowercase().starts_with("livestream")
}

/// Every account's events from `from` to `to`, past ones included, merged and sorted. Join
/// links stay behind keys, as in `read_next`. An unavailable account adds nothing.
#[allow(clippy::too_many_arguments)]
pub fn read_day(
    accounts: &[Account],
    store: &dyn SecretStore,
    tokens: &dyn TokenClient,
    graph: &dyn GraphClient,
    core: &mut Core,
    links: &Mutex<Links>,
    now: u64,
    from: u64,
    to: u64,
) -> DayPayload {
    let mut statuses = Vec::new();
    let mut lists = Vec::new();
    for acct in accounts {
        let Read { state, meetings: fresh, reason } = read_window(acct, store, tokens, graph, core, now, from, to);
        record(core, &acct.id, state.as_str(), reason.as_deref(), now);
        let reason = reason.filter(|r| is_valid_reason(r));
        statuses.push(AccountOut { id: acct.id.clone(), label: acct.label.clone(), state: state.as_str(), reason });
        lists.push(fresh.unwrap_or_default());
    }
    let merged = merge_capped(lists, MAX_DAY_EVENTS);
    let mut guard = links.lock().unwrap_or_else(|e| e.into_inner());
    guard.generation += 1;
    guard.day_map.clear();
    let generation = guard.generation;
    let events = merged
        .into_iter()
        .enumerate()
        .map(|(n, c)| {
            let key = format!("d{generation}-{n}");
            let can_join = c.join.is_some();
            if let Some(url) = c.join {
                guard.day_map.insert(key.clone(), url);
            }
            let is_live = is_live(&c.title);
            DayEventOut { key, account_id: c.account_id, title: c.title, start: c.start, end: c.end, can_join, is_live }
        })
        .collect();
    drop(guard);
    DayPayload { accounts: statuses, events }
}

/// After a sign-in: keep the refresh token, cache the access token.
pub fn complete_sign_in(
    acct: &Account,
    granted: &super::auth::Granted,
    store: &dyn SecretStore,
    tokens: &dyn TokenClient,
    core: &Mutex<Core>,
    now: u64,
) -> Result<(), String> {
    // The code is redeemed without holding the core lock; the lock is taken only to store.
    let form = [
        ("client_id", acct.client_id.as_str()),
        ("grant_type", "authorization_code"),
        ("code", granted.code.as_str()),
        ("redirect_uri", granted.redirect_uri.as_str()),
        ("code_verifier", granted.verifier.as_str()),
        ("scope", SCOPE),
    ];
    match tokens.post(&acct.tenant, &form) {
        TokenReply::Ok { access, expires_in, refresh: Some(refresh) } => {
            if !store.set(&acct.id, &refresh) {
                return Err(sign_in_failed(core, acct, STORE_WRITE, now));
            }
            let mut core = core.lock().unwrap_or_else(|e| e.into_inner());
            core.pending.remove(&acct.id);
            core.cache.insert(acct.id.clone(), Cached { access, expires_at: now + expires_in });
            record(&mut core, &acct.id, "signed-in", None, now);
            Ok(())
        }
        // A reply without a refresh token is a 2xx that cannot be used.
        TokenReply::Ok { refresh: None, .. } => Err(sign_in_failed(core, acct, "token-200", now)),
        TokenReply::Rejected(why) | TokenReply::Transient(why) | TokenReply::Refused(why) | TokenReply::Failed(why) => {
            Err(sign_in_failed(core, acct, &why, now))
        }
    }
}

/// Log a failed first redemption and return its reason code for the web view.
fn sign_in_failed(core: &Mutex<Core>, acct: &Account, reason: &str, now: u64) -> String {
    let reason = if is_valid_reason(reason) { reason.to_string() } else { "token-400".to_string() };
    let mut core = core.lock().unwrap_or_else(|e| e.into_inner());
    record(&mut core, &acct.id, "sign-in-failed", Some(&reason), now);
    reason
}

pub fn sign_out(id: &str, store: &dyn SecretStore, core: &mut Core) {
    store.delete(id);
    core.cache.remove(id);
    core.last.remove(id);
    core.pending.remove(id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wall2_meet::store::{Chunked, MemoryBlobs};
    use serde_json::{json, Value};
    use std::cell::{Cell, RefCell};

    struct FakeTokens {
        replies: RefCell<Vec<TokenReply>>,
        calls: Cell<usize>,
        forms: RefCell<Vec<Vec<(String, String)>>>,
    }
    impl FakeTokens {
        fn new(replies: Vec<TokenReply>) -> Self {
            FakeTokens { replies: RefCell::new(replies), calls: Cell::new(0), forms: RefCell::new(vec![]) }
        }
    }
    impl TokenClient for FakeTokens {
        fn post(&self, _tenant: &str, form: &[(&str, &str)]) -> TokenReply {
            self.calls.set(self.calls.get() + 1);
            self.forms.borrow_mut().push(form.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect());
            let mut r = self.replies.borrow_mut();
            if r.is_empty() {
                TokenReply::Transient("token-503".into())
            } else {
                r.remove(0)
            }
        }
    }

    struct FakeGraph {
        replies: RefCell<Vec<GraphReply>>,
        calls: Cell<usize>,
        seen_access: RefCell<Vec<String>>,
        /// The start and end of every calendar read, as asked for.
        seen_window: RefCell<Vec<(String, String)>>,
    }
    impl FakeGraph {
        fn new(replies: Vec<GraphReply>) -> Self {
            FakeGraph { replies: RefCell::new(replies), calls: Cell::new(0), seen_access: RefCell::new(vec![]), seen_window: RefCell::new(vec![]) }
        }
    }
    impl GraphClient for FakeGraph {
        fn calendar_view(&self, access: &str, start: &str, end: &str) -> GraphReply {
            self.calls.set(self.calls.get() + 1);
            self.seen_access.borrow_mut().push(access.to_string());
            self.seen_window.borrow_mut().push((start.to_string(), end.to_string()));
            let mut r = self.replies.borrow_mut();
            if r.is_empty() {
                GraphReply::Transient("graph-503".into())
            } else {
                r.remove(0)
            }
        }
    }

    fn acct(id: &str) -> Account {
        Account {
            id: id.into(),
            label: id.to_uppercase(),
            client_id: "00000000-0000-0000-0000-000000000000".into(),
            tenant: "common".into(),
        }
    }

    fn ok_token(access: &str, refresh: Option<&str>) -> TokenReply {
        TokenReply::Ok { access: access.into(), expires_in: 3600, refresh: refresh.map(str::to_string) }
    }

    fn body(subject: &str, ical: &str) -> Value {
        json!({ "value": [{
            "subject": subject,
            "start": { "dateTime": "2026-11-12T17:00:00.0000000" },
            "end": { "dateTime": "2026-11-12T18:00:00.0000000" },
            "isAllDay": false, "isCancelled": false,
            "responseStatus": { "response": "accepted" },
            "iCalUId": ical,
            "onlineMeeting": { "joinUrl": "https://teams.microsoft.com/l/meetup-join/secret-part" }
        }] })
    }

    const NOW: u64 = 1_794_459_600;

    fn setup() -> (Chunked<MemoryBlobs>, Core) {
        let store = Chunked(MemoryBlobs::default());
        store.set("work", "refresh-1");
        (store, Core::default())
    }

    #[test]
    fn signed_out_without_a_stored_token() {
        let store = Chunked(MemoryBlobs::default());
        let mut core = Core::default();
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![]);
        let g = FakeGraph::new(vec![]);
        let p = read_next(&[acct("work")], &store, &t, &g, &mut core, &links, NOW);
        assert_eq!(p.accounts[0].state, "signed-out");
        assert_eq!(t.calls.get() + g.calls.get(), 0);
    }

    #[test]
    fn expired_cache_refreshes_and_rotated_token_is_stored() {
        let (store, mut core) = setup();
        let links = Mutex::new(Links::default());
        core.cache.insert("work".into(), Cached { access: "old".into(), expires_at: NOW + 60 });
        let t = FakeTokens::new(vec![ok_token("new", Some("refresh-2"))]);
        let g = FakeGraph::new(vec![GraphReply::Ok(body("A", "1"))]);
        let p = read_next(&[acct("work")], &store, &t, &g, &mut core, &links, NOW);
        assert_eq!(t.calls.get(), 1);
        assert_eq!(g.seen_access.borrow()[0], "new");
        assert_eq!(store.get("work").as_deref(), Some("refresh-2"));
        assert_eq!(p.accounts[0].state, "ok");
        let form = &t.forms.borrow()[0];
        assert!(form.contains(&("grant_type".to_string(), "refresh_token".to_string())));
        assert!(form.contains(&("refresh_token".to_string(), "refresh-1".to_string())));
    }

    #[test]
    fn fresh_cache_is_used_without_a_refresh() {
        let (store, mut core) = setup();
        let links = Mutex::new(Links::default());
        core.cache.insert("work".into(), Cached { access: "cached".into(), expires_at: NOW + 600 });
        let t = FakeTokens::new(vec![]);
        let g = FakeGraph::new(vec![GraphReply::Ok(body("A", "1"))]);
        read_next(&[acct("work")], &store, &t, &g, &mut core, &links, NOW);
        assert_eq!(t.calls.get(), 0);
        assert_eq!(g.seen_access.borrow()[0], "cached");
    }

    #[test]
    fn invalid_grant_deletes_the_token() {
        let (store, mut core) = setup();
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![TokenReply::Rejected("token-400-70000".into())]);
        let g = FakeGraph::new(vec![]);
        let p = read_next(&[acct("work")], &store, &t, &g, &mut core, &links, NOW);
        assert_eq!(p.accounts[0].state, "needs-sign-in");
        assert_eq!(store.get("work"), None);
    }

    #[test]
    fn a_refused_token_request_offers_sign_in_and_keeps_the_token() {
        let (store, mut core) = setup();
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![TokenReply::Refused("token-400".into())]);
        let g = FakeGraph::new(vec![]);
        let p = read_next(&[acct("work")], &store, &t, &g, &mut core, &links, NOW);
        assert_eq!(p.accounts[0].state, "needs-sign-in");
        assert_eq!(store.get("work").as_deref(), Some("refresh-1"));
    }

    #[test]
    fn transient_failure_keeps_the_token() {
        let (store, mut core) = setup();
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![TokenReply::Transient("token-503".into())]);
        let g = FakeGraph::new(vec![]);
        let p = read_next(&[acct("work")], &store, &t, &g, &mut core, &links, NOW);
        assert_eq!(p.accounts[0].state, "unavailable");
        assert_eq!(store.get("work").as_deref(), Some("refresh-1"));
    }

    #[test]
    fn a_401_refreshes_once_and_retries_once() {
        let (store, mut core) = setup();
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![ok_token("a1", None), ok_token("a2", None)]);
        let g = FakeGraph::new(vec![GraphReply::Unauthorized, GraphReply::Ok(body("A", "1"))]);
        let p = read_next(&[acct("work")], &store, &t, &g, &mut core, &links, NOW);
        assert_eq!(t.calls.get(), 2);
        assert_eq!(g.calls.get(), 2);
        assert_eq!(p.accounts[0].state, "ok");
        assert_eq!(g.seen_access.borrow().as_slice(), ["a1", "a2"]);

        let (store, mut core) = setup();
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![ok_token("a1", None), ok_token("a2", None), ok_token("a3", None)]);
        let g = FakeGraph::new(vec![GraphReply::Unauthorized, GraphReply::Unauthorized, GraphReply::Ok(body("A", "1"))]);
        let p = read_next(&[acct("work")], &store, &t, &g, &mut core, &links, NOW);
        assert_eq!(g.calls.get(), 2);
        assert_eq!(t.calls.get(), 2);
        assert_eq!(p.accounts[0].state, "unavailable");
    }

    #[test]
    fn two_accounts_merge_dedupe_and_hide_links() {
        let store = Chunked(MemoryBlobs::default());
        store.set("work", "r1");
        store.set("second", "r2");
        let mut core = Core::default();
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![ok_token("a", None), ok_token("b", None)]);
        let g = FakeGraph::new(vec![GraphReply::Ok(body("Same invite", "dup")), GraphReply::Ok(body("Same invite", "dup"))]);
        let p = read_next(&[acct("work"), acct("second")], &store, &t, &g, &mut core, &links, NOW);
        assert_eq!(p.meetings.len(), 1);
        assert!(p.meetings[0].can_join);
        assert_eq!(p.meetings[0].key, "1-0");
        assert!(lookup_link(&links, "1-0").unwrap().starts_with("https://teams.microsoft.com/"));
        let text = serde_json::to_string(&p).unwrap();
        for bad in ["joinUrl", "@", "Bearer", "teams.microsoft.com", "secret-part", "refresh", "token"] {
            assert!(!text.contains(bad), "payload leaks {bad}: {text}");
        }
        // A second read replaces the link map under a new generation.
        let t = FakeTokens::new(vec![]);
        let g = FakeGraph::new(vec![GraphReply::Ok(body("X", "1")), GraphReply::Ok(body("Y", "2"))]);
        let p = read_next(&[acct("work"), acct("second")], &store, &t, &g, &mut core, &links, NOW + 10);
        assert_eq!(p.meetings[0].key, "2-0");
        assert!(lookup_link(&links, "1-0").is_none());
    }

    fn event_at(subject: &str, ical: &str, start: &str, end: &str) -> Value {
        json!({
            "subject": subject,
            "start": { "dateTime": start },
            "end": { "dateTime": end },
            "isAllDay": false, "isCancelled": false,
            "responseStatus": { "response": "accepted" },
            "iCalUId": ical,
            "onlineMeeting": { "joinUrl": "https://teams.microsoft.com/l/meetup-join/secret-part" }
        })
    }

    #[test]
    fn day_read_keeps_past_events_flags_livestreams_and_keeps_keys_apart() {
        let (store, mut core) = setup();
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![ok_token("a", None)]);
        // NOW is 2026-11-12 05:00 UTC. The first event ended at 02:00 UTC the same day, before NOW.
        let day_body = json!({ "value": [
            event_at("Livestream: Q and A", "l1", "2026-11-12T01:00:00.0000000", "2026-11-12T02:00:00.0000000"),
            event_at("Weekly planning", "p1", "2026-11-12T17:00:00.0000000", "2026-11-12T18:00:00.0000000"),
        ] });
        let g = FakeGraph::new(vec![GraphReply::Ok(day_body), GraphReply::Ok(body("Weekly planning", "p1"))]);
        let accounts = [acct("work")];
        // Local midnight (UTC here) to 36 elapsed hours later.
        let (from, to) = (1_794_441_600, 1_794_441_600 + 36 * 3600);
        let p = read_day(&accounts, &store, &t, &g, &mut core, &links, NOW, from, to);
        assert_eq!(g.seen_window.borrow().as_slice(), [("2026-11-12T00:00:00Z".to_string(), "2026-11-13T12:00:00Z".to_string())]);
        assert_eq!(p.accounts[0].state, "ok");
        assert_eq!(p.events.len(), 2);
        assert_eq!(p.events[0].title, "Livestream: Q and A");
        assert!(p.events[0].end.as_str() < utc_iso(NOW).as_str(), "the kept event is in the past");
        assert!(p.events[0].is_live);
        assert!(!p.events[1].is_live);
        assert!(p.events[0].can_join);
        assert!(p.events[0].key.starts_with('d'));
        let day_key = p.events[0].key.clone();
        assert!(lookup_link(&links, &day_key).unwrap().starts_with("https://teams.microsoft.com/"));
        let text = serde_json::to_string(&p).unwrap();
        for bad in ["joinUrl", "Bearer", "teams.microsoft.com", "secret-part", "refresh", "token", "attendees", "organizer", "body"] {
            assert!(!text.contains(bad), "payload leaks {bad}: {text}");
        }
        // A next-meetings read does not break the day key, and asks for the usual 24 hours from now.
        let n = read_next(&accounts, &store, &t, &g, &mut core, &links, NOW + 10);
        assert!(!is_live(&n.meetings[0].title));
        assert!(lookup_link(&links, &day_key).is_some());
        assert_eq!(g.seen_window.borrow()[1], (utc_iso(NOW + 10), utc_iso(NOW + 10 + WINDOW_SECS)));
    }

    #[test]
    fn livestream_subject_rule() {
        assert!(is_live("Livestream with guest"));
        assert!(is_live("  livestream"));
        assert!(!is_live("Weekly livestream prep"));
        assert!(!is_live(""));
    }

    #[test]
    fn a_transient_failure_keeps_that_accounts_meeting_and_join_working() {
        let store = Chunked(MemoryBlobs::default());
        store.set("work", "r1");
        store.set("second", "r2");
        let mut core = Core::default();
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![ok_token("a", None), ok_token("b", None)]);
        let g = FakeGraph::new(vec![GraphReply::Ok(body("Work one", "w1")), GraphReply::Ok(body("Second one", "s1"))]);
        let accounts = [acct("work"), acct("second")];
        let p = read_next(&accounts, &store, &t, &g, &mut core, &links, NOW);
        assert!(!p.stale);
        assert_eq!(p.meetings.len(), 2);
        // The second account now fails; the first still answers.
        let g = FakeGraph::new(vec![GraphReply::Ok(body("Work one", "w1")), GraphReply::Transient("graph-503".into())]);
        let p = read_next(&accounts, &store, &t, &g, &mut core, &links, NOW + 10);
        assert!(p.stale);
        assert_eq!(p.accounts[1].state, "unavailable");
        assert_eq!(p.meetings.len(), 2);
        let kept = p.meetings.iter().find(|m| m.account_id == "second").unwrap();
        assert_eq!(kept.title, "Second one");
        assert!(kept.can_join);
        assert!(lookup_link(&links, &kept.key).unwrap().starts_with("https://teams.microsoft.com/"));
        // Signing out drops what was kept.
        sign_out("second", &store, &mut core);
        let g = FakeGraph::new(vec![GraphReply::Ok(body("Work one", "w1"))]);
        let p = read_next(&accounts, &store, &t, &g, &mut core, &links, NOW + 20);
        assert_eq!(p.meetings.len(), 1);
        assert!(!p.stale);
    }

    /// A secret store whose writes can be switched off.
    struct FlakySecrets {
        inner: Chunked<MemoryBlobs>,
        fail_set: Cell<bool>,
        fail_get: Cell<bool>,
    }
    impl SecretStore for FlakySecrets {
        fn fetch(&self, id: &str) -> Fetch<String> {
            if self.fail_get.get() {
                return Fetch::Failed;
            }
            self.inner.fetch(id)
        }
        fn set(&self, id: &str, value: &str) -> bool {
            !self.fail_set.get() && self.inner.set(id, value)
        }
        fn delete(&self, id: &str) {
            self.inner.delete(id)
        }
    }

    #[test]
    fn a_rotated_token_that_cannot_be_stored_is_kept_in_memory_and_reported_unavailable() {
        let store = FlakySecrets { inner: Chunked(MemoryBlobs::default()), fail_set: Cell::new(false), fail_get: Cell::new(false) };
        store.set("work", "refresh-1");
        store.fail_set.set(true);
        let mut core = Core::default();
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![ok_token("new", Some("refresh-2"))]);
        let g = FakeGraph::new(vec![GraphReply::Ok(body("A", "1"))]);
        let p = read_next(&[acct("work")], &store, &t, &g, &mut core, &links, NOW);
        assert_eq!(p.accounts[0].state, "unavailable");
        assert_eq!(store.get("work").as_deref(), Some("refresh-1"));
        assert_eq!(core.pending.get("work").map(String::as_str), Some("refresh-2"));
        // Still failing: stays unavailable, token stays pending.
        let p = read_next(&[acct("work")], &store, &t, &g, &mut core, &links, NOW + 5);
        assert_eq!(p.accounts[0].state, "unavailable");
        // Store works again: the pending token is written and the account reads normally.
        store.fail_set.set(false);
        let p = read_next(&[acct("work")], &store, &t, &g, &mut core, &links, NOW + 10);
        assert_eq!(p.accounts[0].state, "ok");
        assert_eq!(store.get("work").as_deref(), Some("refresh-2"));
        assert!(core.pending.is_empty());
    }

    struct ProbeGraph<'a> {
        links: &'a Mutex<Links>,
        seen: RefCell<Option<Option<String>>>,
    }
    impl GraphClient for ProbeGraph<'_> {
        fn calendar_view(&self, _a: &str, _s: &str, _e: &str) -> GraphReply {
            // What Join does: look a key up. It must not wait for this read.
            *self.seen.borrow_mut() = Some(lookup_link(self.links, "1-0"));
            GraphReply::Ok(body("Next", "n"))
        }
    }

    #[test]
    fn join_resolves_while_a_read_is_in_progress() {
        let (store, mut core) = setup();
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![ok_token("a", None)]);
        let g = FakeGraph::new(vec![GraphReply::Ok(body("First", "f"))]);
        read_next(&[acct("work")], &store, &t, &g, &mut core, &links, NOW);
        let probe = ProbeGraph { links: &links, seen: RefCell::new(None) };
        read_next(&[acct("work")], &store, &t, &probe, &mut core, &links, NOW + 10);
        let seen = probe.seen.borrow().clone().expect("graph was called");
        assert!(seen.unwrap().starts_with("https://teams.microsoft.com/"));
    }

    #[test]
    fn sign_in_stores_the_refresh_token_and_caches_access() {
        let store = Chunked(MemoryBlobs::default());
        let core = Mutex::new(Core::default());
        let t = FakeTokens::new(vec![ok_token("acc", Some("ref"))]);
        let granted = super::super::auth::Granted { code: "c".into(), verifier: "v".into(), redirect_uri: "http://localhost:1/auth-callback.html".into() };
        assert!(complete_sign_in(&acct("work"), &granted, &store, &t, &core, NOW).is_ok());
        assert_eq!(store.get("work").as_deref(), Some("ref"));
        assert_eq!(core.lock().unwrap().cache.get("work").unwrap().access, "acc");
        let t = FakeTokens::new(vec![ok_token("acc", None)]);
        assert_eq!(complete_sign_in(&acct("work"), &granted, &store, &t, &core, NOW), Err("token-200".to_string()));
        sign_out("work", &store, &mut core.lock().unwrap());
        assert_eq!(store.get("work"), None);
        assert!(core.lock().unwrap().cache.is_empty());
    }

    fn reasons(p: &MeetPayload) -> Vec<Option<&str>> {
        p.accounts.iter().map(|a| a.reason.as_deref()).collect()
    }

    #[test]
    fn graph_failures_carry_their_reason_into_the_payload() {
        for (reply, want) in [
            (GraphReply::Failed("graph-403-ErrorAccessDenied".into()), "graph-403-ErrorAccessDenied"),
            (GraphReply::Transient("graph-429".into()), "graph-429"),
            (GraphReply::Transient("graph-network".into()), "graph-network"),
            (GraphReply::Failed("graph-body".into()), "graph-body"),
        ] {
            let (store, mut core) = setup();
            let links = Mutex::new(Links::default());
            core.cache.insert("work".into(), Cached { access: "c".into(), expires_at: NOW + 600 });
            let t = FakeTokens::new(vec![]);
            let g = FakeGraph::new(vec![reply]);
            let p = read_next(&[acct("work")], &store, &t, &g, &mut core, &links, NOW);
            assert_eq!(p.accounts[0].state, "unavailable");
            assert_eq!(reasons(&p), vec![Some(want)]);
            let text = serde_json::to_string(&p).unwrap();
            assert!(text.contains(&format!("\"reason\":\"{want}\"")), "{text}");
        }
    }

    #[test]
    fn a_second_401_reports_graph_401() {
        let (store, mut core) = setup();
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![ok_token("a1", None), ok_token("a2", None)]);
        let g = FakeGraph::new(vec![GraphReply::Unauthorized, GraphReply::Unauthorized]);
        let p = read_next(&[acct("work")], &store, &t, &g, &mut core, &links, NOW);
        assert_eq!(reasons(&p), vec![Some("graph-401")]);
    }

    #[test]
    fn token_failures_carry_their_reason() {
        let (store, mut core) = setup();
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![TokenReply::Transient("token-network".into())]);
        let g = FakeGraph::new(vec![]);
        let p = read_next(&[acct("work")], &store, &t, &g, &mut core, &links, NOW);
        assert_eq!(p.accounts[0].state, "unavailable");
        assert_eq!(reasons(&p), vec![Some("token-network")]);
    }

    #[test]
    fn a_healthy_account_has_no_reason_and_the_payload_has_no_reason_key() {
        let (store, mut core) = setup();
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![ok_token("a", None)]);
        let g = FakeGraph::new(vec![GraphReply::Ok(body("A", "1"))]);
        let p = read_next(&[acct("work")], &store, &t, &g, &mut core, &links, NOW);
        assert_eq!(reasons(&p), vec![None]);
        assert!(!serde_json::to_string(&p).unwrap().contains("reason"));
    }

    #[test]
    fn an_unwritable_store_reports_store_write() {
        let store = FlakySecrets { inner: Chunked(MemoryBlobs::default()), fail_set: Cell::new(false), fail_get: Cell::new(false) };
        store.set("work", "refresh-1");
        store.fail_set.set(true);
        let mut core = Core::default();
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![ok_token("new", Some("refresh-2"))]);
        let g = FakeGraph::new(vec![]);
        let p = read_next(&[acct("work")], &store, &t, &g, &mut core, &links, NOW);
        assert_eq!(reasons(&p), vec![Some("store-write")]);
    }

    #[test]
    fn a_failed_store_read_is_unavailable_with_store_read_and_keeps_the_token() {
        let store = FlakySecrets { inner: Chunked(MemoryBlobs::default()), fail_set: Cell::new(false), fail_get: Cell::new(false) };
        store.set("work", "refresh-1");
        store.fail_get.set(true);
        let mut core = Core::default();
        core.cache.insert("work".into(), Cached { access: "c".into(), expires_at: NOW + 6000 });
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![]);
        let g = FakeGraph::new(vec![]);
        let p = read_next(&[acct("work")], &store, &t, &g, &mut core, &links, NOW);
        assert_eq!(p.accounts[0].state, "unavailable");
        assert_eq!(reasons(&p), vec![Some("store-read")]);
        assert_eq!(t.calls.get() + g.calls.get(), 0);
        // Nothing was deleted: once reads work again the account reads normally.
        store.fail_get.set(false);
        assert_eq!(store.get("work").as_deref(), Some("refresh-1"));
        let g = FakeGraph::new(vec![GraphReply::Ok(body("A", "1"))]);
        let p = read_next(&[acct("work")], &store, &t, &g, &mut core, &links, NOW + 5);
        assert_eq!(p.accounts[0].state, "ok");
    }

    #[test]
    fn a_missing_store_entry_is_signed_out_with_no_reason() {
        let store = Chunked(MemoryBlobs::default());
        let mut core = Core::default();
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![]);
        let g = FakeGraph::new(vec![]);
        let p = read_next(&[acct("work")], &store, &t, &g, &mut core, &links, NOW);
        assert_eq!(p.accounts[0].state, "signed-out");
        assert_eq!(reasons(&p), vec![None]);
    }

    #[test]
    fn a_log_line_is_queued_only_on_a_change() {
        let (store, mut core) = setup();
        let links = Mutex::new(Links::default());
        core.cache.insert("work".into(), Cached { access: "c".into(), expires_at: NOW + 6000 });
        let t = FakeTokens::new(vec![]);
        let g = FakeGraph::new(vec![
            GraphReply::Ok(body("A", "1")),
            GraphReply::Ok(body("A", "1")),
            GraphReply::Failed("graph-403-ErrorAccessDenied".into()),
            GraphReply::Failed("graph-403-ErrorAccessDenied".into()),
            GraphReply::Ok(body("A", "1")),
        ]);
        for n in 0..5 {
            read_next(&[acct("work")], &store, &t, &g, &mut core, &links, NOW + n);
        }
        assert_eq!(
            core.log_lines,
            vec![
                "2026-11-12T05:00:00Z work start ok none\n".to_string(),
                "2026-11-12T05:00:02Z work ok unavailable graph-403-ErrorAccessDenied\n".to_string(),
                "2026-11-12T05:00:04Z work unavailable ok none\n".to_string(),
            ]
        );
    }

    #[test]
    fn a_failed_redemption_reports_and_logs_its_reason() {
        let store = Chunked(MemoryBlobs::default());
        let core = Mutex::new(Core::default());
        let granted = super::super::auth::Granted { code: "c".into(), verifier: "v".into(), redirect_uri: "http://localhost:1/auth-callback.html".into() };
        let t = FakeTokens::new(vec![TokenReply::Refused("token-400-65001".into())]);
        assert_eq!(complete_sign_in(&acct("work"), &granted, &store, &t, &core, NOW), Err("token-400-65001".to_string()));
        let t = FakeTokens::new(vec![TokenReply::Transient("token-network".into())]);
        assert_eq!(complete_sign_in(&acct("work"), &granted, &store, &t, &core, NOW), Err("token-network".to_string()));
        let flaky = FlakySecrets { inner: Chunked(MemoryBlobs::default()), fail_set: Cell::new(true), fail_get: Cell::new(false) };
        let t = FakeTokens::new(vec![ok_token("acc", Some("ref"))]);
        assert_eq!(complete_sign_in(&acct("work"), &granted, &flaky, &t, &core, NOW), Err("store-write".to_string()));
        let lines = core.lock().unwrap().log_lines.clone();
        assert_eq!(lines[0], "2026-11-12T05:00:00Z work start sign-in-failed token-400-65001\n");
        assert_eq!(lines[1], "2026-11-12T05:00:00Z work sign-in-failed sign-in-failed token-network\n");
        assert_eq!(lines[2], "2026-11-12T05:00:00Z work sign-in-failed sign-in-failed store-write\n");
    }

    #[test]
    fn a_hostile_reason_never_reaches_the_payload_or_the_log() {
        let (store, mut core) = setup();
        let links = Mutex::new(Links::default());
        core.cache.insert("work".into(), Cached { access: "c".into(), expires_at: NOW + 600 });
        let t = FakeTokens::new(vec![]);
        let g = FakeGraph::new(vec![GraphReply::Failed("graph-403-https://example.test/?a=b@c".into())]);
        let p = read_next(&[acct("work")], &store, &t, &g, &mut core, &links, NOW);
        assert_eq!(reasons(&p), vec![None]);
        assert!(core.log_lines[0].ends_with(" none\n"));
    }
}
