//! The silent refresh and the calendar read, behind traits so tests can fake the network.

use super::auth::{TokenClient, TokenReply, SCOPE};
use super::graph::{merge, shape_events, utc_iso, Candidate, GraphClient, GraphReply};
use super::store::SecretStore;
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
}

/// Join links behind opaque keys. Its own lock, never held across network I/O, so Join
/// answers at once even while a read is waiting on Graph.
#[derive(Default)]
pub struct Links {
    pub generation: u64,
    pub map: HashMap<String, String>,
}

pub fn lookup_link(links: &Mutex<Links>, key: &str) -> Option<String> {
    links.lock().unwrap_or_else(|e| e.into_inner()).map.get(key).cloned()
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

/// A fresh access token for the account, from the cache or a refresh.
fn obtain(
    acct: &Account,
    store: &dyn SecretStore,
    tokens: &dyn TokenClient,
    core: &mut Core,
    now: u64,
    force: bool,
) -> Result<String, AccountState> {
    if let Some(p) = core.pending.get(&acct.id).cloned() {
        // An earlier rotated token never reached the store: try again before anything else.
        if !store.set(&acct.id, &p) {
            return Err(AccountState::Unavailable);
        }
        core.pending.remove(&acct.id);
    }
    let Some(refresh) = store.get(&acct.id) else {
        core.cache.remove(&acct.id);
        return Err(AccountState::SignedOut);
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
                    return Err(AccountState::Unavailable);
                }
            }
            Ok(access)
        }
        TokenReply::Rejected => {
            store.delete(&acct.id);
            core.pending.remove(&acct.id);
            Err(AccountState::NeedsSignIn)
        }
        // Not a dead grant but nothing a retry fixes: offer Sign in, keep the stored token.
        TokenReply::Refused => Err(AccountState::NeedsSignIn),
        TokenReply::Transient | TokenReply::Failed => Err(AccountState::Unavailable),
    }
}

fn read_account(
    acct: &Account,
    store: &dyn SecretStore,
    tokens: &dyn TokenClient,
    graph: &dyn GraphClient,
    core: &mut Core,
    now: u64,
) -> (AccountState, Option<Vec<Candidate>>) {
    let (start, end) = (utc_iso(now), utc_iso(now + WINDOW_SECS));
    let access = match obtain(acct, store, tokens, core, now, false) {
        Ok(a) => a,
        Err(state) => return (state, None),
    };
    let mut reply = graph.calendar_view(&access, &start, &end);
    if matches!(reply, GraphReply::Unauthorized) {
        // The cached token was refused: drop it, refresh once, ask once more.
        let access = match obtain(acct, store, tokens, core, now, true) {
            Ok(a) => a,
            Err(state) => return (state, None),
        };
        reply = graph.calendar_view(&access, &start, &end);
    }
    match reply {
        GraphReply::Ok(body) => (AccountState::Ok, Some(shape_events(&body, &acct.id))),
        GraphReply::Unauthorized | GraphReply::Transient | GraphReply::Failed => (AccountState::Unavailable, None),
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
        let (state, fresh) = read_account(acct, store, tokens, graph, core, now);
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
        statuses.push(AccountOut { id: acct.id.clone(), label: acct.label.clone(), state: state.as_str() });
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

/// After a sign-in: keep the refresh token, cache the access token.
pub fn complete_sign_in(
    acct: &Account,
    granted: &super::auth::Granted,
    store: &dyn SecretStore,
    tokens: &dyn TokenClient,
    core: &Mutex<Core>,
    now: u64,
) -> Result<(), &'static str> {
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
                return Err("failed");
            }
            let mut core = core.lock().unwrap_or_else(|e| e.into_inner());
            core.pending.remove(&acct.id);
            core.cache.insert(acct.id.clone(), Cached { access, expires_at: now + expires_in });
            Ok(())
        }
        _ => Err("failed"),
    }
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
                TokenReply::Transient
            } else {
                r.remove(0)
            }
        }
    }

    struct FakeGraph {
        replies: RefCell<Vec<GraphReply>>,
        calls: Cell<usize>,
        seen_access: RefCell<Vec<String>>,
    }
    impl FakeGraph {
        fn new(replies: Vec<GraphReply>) -> Self {
            FakeGraph { replies: RefCell::new(replies), calls: Cell::new(0), seen_access: RefCell::new(vec![]) }
        }
    }
    impl GraphClient for FakeGraph {
        fn calendar_view(&self, access: &str, _s: &str, _e: &str) -> GraphReply {
            self.calls.set(self.calls.get() + 1);
            self.seen_access.borrow_mut().push(access.to_string());
            let mut r = self.replies.borrow_mut();
            if r.is_empty() {
                GraphReply::Transient
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
        let t = FakeTokens::new(vec![TokenReply::Rejected]);
        let g = FakeGraph::new(vec![]);
        let p = read_next(&[acct("work")], &store, &t, &g, &mut core, &links, NOW);
        assert_eq!(p.accounts[0].state, "needs-sign-in");
        assert_eq!(store.get("work"), None);
    }

    #[test]
    fn a_refused_token_request_offers_sign_in_and_keeps_the_token() {
        let (store, mut core) = setup();
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![TokenReply::Refused]);
        let g = FakeGraph::new(vec![]);
        let p = read_next(&[acct("work")], &store, &t, &g, &mut core, &links, NOW);
        assert_eq!(p.accounts[0].state, "needs-sign-in");
        assert_eq!(store.get("work").as_deref(), Some("refresh-1"));
    }

    #[test]
    fn transient_failure_keeps_the_token() {
        let (store, mut core) = setup();
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![TokenReply::Transient]);
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
        let g = FakeGraph::new(vec![GraphReply::Ok(body("Work one", "w1")), GraphReply::Transient]);
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
    }
    impl SecretStore for FlakySecrets {
        fn get(&self, id: &str) -> Option<String> {
            self.inner.get(id)
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
        let store = FlakySecrets { inner: Chunked(MemoryBlobs::default()), fail_set: Cell::new(false) };
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
        assert_eq!(complete_sign_in(&acct("work"), &granted, &store, &t, &core, NOW), Err("failed"));
        sign_out("work", &store, &mut core.lock().unwrap());
        assert_eq!(store.get("work"), None);
        assert!(core.lock().unwrap().cache.is_empty());
    }
}
