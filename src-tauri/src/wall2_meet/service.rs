//! The silent refresh and the calendar read, behind traits so tests can fake the network.

use super::auth::{TokenClient, TokenReply, SCOPE};
use super::graph::{merge, shape_events, utc_iso, Candidate, GraphClient, GraphReply};
use super::store::SecretStore;
use super::Account;
use serde::Serialize;
use std::collections::HashMap;

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
    pub generation: u64,
    pub links: HashMap<String, String>,
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
}

/// A fresh access token for the account, from the cache or a refresh.
fn obtain(
    acct: &Account,
    store: &dyn SecretStore,
    tokens: &dyn TokenClient,
    cache: &mut HashMap<String, Cached>,
    now: u64,
    force: bool,
) -> Result<String, AccountState> {
    let Some(refresh) = store.get(&acct.id) else {
        cache.remove(&acct.id);
        return Err(AccountState::SignedOut);
    };
    if !force {
        if let Some(c) = cache.get(&acct.id) {
            if c.expires_at > now + SKEW_SECS {
                return Ok(c.access.clone());
            }
        }
    }
    cache.remove(&acct.id);
    let form = [
        ("client_id", acct.client_id.as_str()),
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh.as_str()),
        ("scope", SCOPE),
    ];
    match tokens.post(&acct.tenant, &form) {
        TokenReply::Ok { access, expires_in, refresh: rotated } => {
            if let Some(new) = rotated {
                if new != refresh {
                    store.set(&acct.id, &new);
                }
            }
            cache.insert(acct.id.clone(), Cached { access: access.clone(), expires_at: now + expires_in });
            Ok(access)
        }
        TokenReply::Rejected => {
            store.delete(&acct.id);
            Err(AccountState::NeedsSignIn)
        }
        TokenReply::Transient | TokenReply::Failed => Err(AccountState::Unavailable),
    }
}

fn read_account(
    acct: &Account,
    store: &dyn SecretStore,
    tokens: &dyn TokenClient,
    graph: &dyn GraphClient,
    cache: &mut HashMap<String, Cached>,
    now: u64,
) -> (AccountState, Vec<Candidate>) {
    let (start, end) = (utc_iso(now), utc_iso(now + WINDOW_SECS));
    let access = match obtain(acct, store, tokens, cache, now, false) {
        Ok(a) => a,
        Err(state) => return (state, Vec::new()),
    };
    let mut reply = graph.calendar_view(&access, &start, &end);
    if matches!(reply, GraphReply::Unauthorized) {
        // The cached token was refused: drop it, refresh once, ask once more.
        let access = match obtain(acct, store, tokens, cache, now, true) {
            Ok(a) => a,
            Err(state) => return (state, Vec::new()),
        };
        reply = graph.calendar_view(&access, &start, &end);
    }
    match reply {
        GraphReply::Ok(body) => (AccountState::Ok, shape_events(&body, &acct.id)),
        GraphReply::Unauthorized | GraphReply::Transient | GraphReply::Failed => (AccountState::Unavailable, Vec::new()),
    }
}

/// Read every account, merge, and replace the link map. The payload carries no URL.
pub fn read_next(
    accounts: &[Account],
    store: &dyn SecretStore,
    tokens: &dyn TokenClient,
    graph: &dyn GraphClient,
    core: &mut Core,
    now: u64,
) -> MeetPayload {
    let mut statuses = Vec::new();
    let mut lists = Vec::new();
    for acct in accounts {
        let (state, list) = read_account(acct, store, tokens, graph, &mut core.cache, now);
        statuses.push(AccountOut { id: acct.id.clone(), label: acct.label.clone(), state: state.as_str() });
        lists.push(list);
    }
    let merged = merge(lists);
    core.generation += 1;
    core.links.clear();
    let meetings = merged
        .into_iter()
        .enumerate()
        .map(|(n, c)| {
            let key = format!("{}-{n}", core.generation);
            let can_join = c.join.is_some();
            if let Some(url) = c.join {
                core.links.insert(key.clone(), url);
            }
            MeetingOut { key, account_id: c.account_id, title: c.title, start: c.start, end: c.end, can_join }
        })
        .collect();
    MeetPayload { accounts: statuses, meetings }
}

/// After a sign-in: keep the refresh token, cache the access token.
pub fn complete_sign_in(
    acct: &Account,
    granted: &super::auth::Granted,
    store: &dyn SecretStore,
    tokens: &dyn TokenClient,
    core: &mut Core,
    now: u64,
) -> Result<(), &'static str> {
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
            core.cache.insert(acct.id.clone(), Cached { access, expires_at: now + expires_in });
            Ok(())
        }
        _ => Err("failed"),
    }
}

pub fn sign_out(id: &str, store: &dyn SecretStore, core: &mut Core) {
    store.delete(id);
    core.cache.remove(id);
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
        let t = FakeTokens::new(vec![]);
        let g = FakeGraph::new(vec![]);
        let p = read_next(&[acct("work")], &store, &t, &g, &mut core, NOW);
        assert_eq!(p.accounts[0].state, "signed-out");
        assert_eq!(t.calls.get() + g.calls.get(), 0);
    }

    #[test]
    fn expired_cache_refreshes_and_rotated_token_is_stored() {
        let (store, mut core) = setup();
        core.cache.insert("work".into(), Cached { access: "old".into(), expires_at: NOW + 60 });
        let t = FakeTokens::new(vec![ok_token("new", Some("refresh-2"))]);
        let g = FakeGraph::new(vec![GraphReply::Ok(body("A", "1"))]);
        let p = read_next(&[acct("work")], &store, &t, &g, &mut core, NOW);
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
        core.cache.insert("work".into(), Cached { access: "cached".into(), expires_at: NOW + 600 });
        let t = FakeTokens::new(vec![]);
        let g = FakeGraph::new(vec![GraphReply::Ok(body("A", "1"))]);
        read_next(&[acct("work")], &store, &t, &g, &mut core, NOW);
        assert_eq!(t.calls.get(), 0);
        assert_eq!(g.seen_access.borrow()[0], "cached");
    }

    #[test]
    fn invalid_grant_deletes_the_token() {
        let (store, mut core) = setup();
        let t = FakeTokens::new(vec![TokenReply::Rejected]);
        let g = FakeGraph::new(vec![]);
        let p = read_next(&[acct("work")], &store, &t, &g, &mut core, NOW);
        assert_eq!(p.accounts[0].state, "needs-sign-in");
        assert_eq!(store.get("work"), None);
    }

    #[test]
    fn transient_failure_keeps_the_token() {
        let (store, mut core) = setup();
        let t = FakeTokens::new(vec![TokenReply::Transient]);
        let g = FakeGraph::new(vec![]);
        let p = read_next(&[acct("work")], &store, &t, &g, &mut core, NOW);
        assert_eq!(p.accounts[0].state, "unavailable");
        assert_eq!(store.get("work").as_deref(), Some("refresh-1"));
    }

    #[test]
    fn a_401_refreshes_once_and_retries_once() {
        let (store, mut core) = setup();
        let t = FakeTokens::new(vec![ok_token("a1", None), ok_token("a2", None)]);
        let g = FakeGraph::new(vec![GraphReply::Unauthorized, GraphReply::Ok(body("A", "1"))]);
        let p = read_next(&[acct("work")], &store, &t, &g, &mut core, NOW);
        assert_eq!(t.calls.get(), 2);
        assert_eq!(g.calls.get(), 2);
        assert_eq!(p.accounts[0].state, "ok");
        assert_eq!(g.seen_access.borrow().as_slice(), ["a1", "a2"]);

        let (store, mut core) = setup();
        let t = FakeTokens::new(vec![ok_token("a1", None), ok_token("a2", None), ok_token("a3", None)]);
        let g = FakeGraph::new(vec![GraphReply::Unauthorized, GraphReply::Unauthorized, GraphReply::Ok(body("A", "1"))]);
        let p = read_next(&[acct("work")], &store, &t, &g, &mut core, NOW);
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
        let t = FakeTokens::new(vec![ok_token("a", None), ok_token("b", None)]);
        let g = FakeGraph::new(vec![GraphReply::Ok(body("Same invite", "dup")), GraphReply::Ok(body("Same invite", "dup"))]);
        let p = read_next(&[acct("work"), acct("second")], &store, &t, &g, &mut core, NOW);
        assert_eq!(p.meetings.len(), 1);
        assert!(p.meetings[0].can_join);
        assert_eq!(p.meetings[0].key, "1-0");
        assert!(core.links.get("1-0").unwrap().starts_with("https://teams.microsoft.com/"));
        let text = serde_json::to_string(&p).unwrap();
        for bad in ["joinUrl", "@", "Bearer", "teams.microsoft.com", "secret-part", "refresh", "token"] {
            assert!(!text.contains(bad), "payload leaks {bad}: {text}");
        }
        // A second read replaces the link map under a new generation.
        let t = FakeTokens::new(vec![]);
        let g = FakeGraph::new(vec![GraphReply::Ok(body("X", "1")), GraphReply::Ok(body("Y", "2"))]);
        let p = read_next(&[acct("work"), acct("second")], &store, &t, &g, &mut core, NOW + 10);
        assert_eq!(p.meetings[0].key, "2-0");
        assert!(core.links.get("1-0").is_none());
    }

    #[test]
    fn sign_in_stores_the_refresh_token_and_caches_access() {
        let store = Chunked(MemoryBlobs::default());
        let mut core = Core::default();
        let t = FakeTokens::new(vec![ok_token("acc", Some("ref"))]);
        let granted = super::super::auth::Granted { code: "c".into(), verifier: "v".into(), redirect_uri: "http://localhost:1/auth-callback.html".into() };
        assert!(complete_sign_in(&acct("work"), &granted, &store, &t, &mut core, NOW).is_ok());
        assert_eq!(store.get("work").as_deref(), Some("ref"));
        assert_eq!(core.cache.get("work").unwrap().access, "acc");
        let t = FakeTokens::new(vec![ok_token("acc", None)]);
        assert_eq!(complete_sign_in(&acct("work"), &granted, &store, &t, &mut core, NOW), Err("failed"));
        sign_out("work", &store, &mut core);
        assert_eq!(store.get("work"), None);
        assert!(core.cache.is_empty());
    }
}
