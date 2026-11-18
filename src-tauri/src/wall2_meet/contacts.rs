//! The saved-contact lookup behind "Open contact card".
//!
//! For one person key, Rust asks Graph whether the address is saved in the owner's contacts
//! (`GET /me/contacts` filtered on the address) and, for exactly one saved contact, keeps that
//! contact's classic Outlook EntryID (`Binary 0x0FFF`) as uppercase hex beside the person key
//! (`service::Links::contact_map`). The page only ever learns `available: true or false`.
//!
//! Scopes. The calendar refresh keeps asking for `auth::SCOPE` (Calendars.Read), so a sign-in
//! that never consented to Contacts.Read keeps its calendar. This lookup asks the token endpoint
//! for its own access token with `auth::CONTACTS_SCOPE`, from the same refresh token, cached in
//! memory per account. Any refusal is "not available": the account's state, stored token and
//! calendar are left alone, and the refusal is remembered for a while so a card open does not
//! hit the token endpoint again. If the token endpoint rotates the refresh token, it is stored
//! exactly as the calendar refresh stores one (see `service::obtain`).
//!
//! Locks. The contact lookup has its own per-account turn (`Core::contact_flights`). The
//! calendar turn (`Core::flights`) is borrowed only across the refresh-token request, and only
//! for at most `TURN_WAIT`, because two requests must never spend one rotating refresh token at
//! the same time; the Graph call itself runs without it, so a calendar read waits at most for
//! one short token request, never for the whole lookup.
//!
//! Nothing here logs. The address and the entry id never reach a log, an error or Debug output.

use super::auth::{TokenClient, TokenReply, CONTACTS_SCOPE};
use super::graph::{entry_hex, is_entry_property_id, Ctx, Kind, ENTRY_EXPAND_ENCODED};
use super::people::valid_address;
use super::service::{clock_of, generation_of, lock, Cached, ContactAnswer, Core, Slot, SKEW_SECS};
use super::store::{Fetch, SecretStore};
use super::Account;
use serde_json::Value;
use std::sync::Mutex;
use std::time::Duration;

const CONTACTS_PATH: &str = "https://graph.microsoft.com/v1.0/me/contacts";
/// The whole lookup: token request and Graph call together.
const TOTAL: Duration = Duration::from_secs(6);
const CONNECT: Duration = Duration::from_secs(2);
/// How long the lookup waits for the calendar turn before it gives up (not available).
const TURN_WAIT: Duration = Duration::from_secs(3);
/// The refresh-token request alone.
const TOKEN_LIMIT: Duration = Duration::from_secs(4);
/// After a refused contact token request, ask again no sooner than this.
const DENIED_SECS: u64 = 30 * 60;
const UNAVAILABLE: &str = "unavailable";

/// The Graph request for the contacts saved with this address. UNVERIFIED against live Graph:
/// the `emailAddresses/any(...)` filter on `/me/contacts`, and whether the `$expand` of
/// `Binary 0x0FFF` is returned for a contact. The address is checked strictly first (so it holds
/// no quote, `?`, `&`, `%` or space) and single quotes are doubled anyway. Whole filter value
/// encoded the way `graph.rs` encodes its `$expand`.
pub(crate) fn contacts_url(address: &str) -> Option<String> {
    if !valid_address(address) {
        return None;
    }
    let filter = format!("emailAddresses/any(a:a/address eq '{}')", address.replace('\'', "''"));
    Some(format!("{CONTACTS_PATH}?$filter={}&$select=id&$top=2&$expand={ENTRY_EXPAND_ENCODED}", urlencoding::encode(&filter)))
}

/// The entry hex when the answer holds exactly one contact and its `Binary 0x0FFF` property
/// decodes (standard base64, 20 to 512 bytes). Zero or two or more contacts, a missing or bad
/// property: None.
pub(crate) fn single_entry(body: &Value) -> Option<String> {
    let rows = body.get("value")?.as_array()?;
    let [row] = rows.as_slice() else { return None };
    row.get("singleValueExtendedProperties")?
        .as_array()?
        .iter()
        .find(|p| p.get("id").and_then(Value::as_str).is_some_and(is_entry_property_id))?
        .get("value")?
        .as_str()
        .and_then(entry_hex)
}

/// The open-card rule: the lookup found exactly one saved contact, the config allows classic
/// Outlook, classic Outlook is installed and usable, and the new Outlook is not selected.
pub(crate) fn contact_available(found: bool, desktop_enabled: bool, classic_found: bool, new_outlook_selected: bool) -> bool {
    found && desktop_enabled && classic_found && !new_outlook_selected
}

/// The `/select` argument for the `contact` action, from the held answer only. No answer, or an
/// answer that says not available, or an entry that fails the shared check: `unavailable`.
pub(crate) fn launch_arg(answer: Option<&ContactAnswer>) -> Result<String, &'static str> {
    let answer = answer.filter(|a| a.available).ok_or(UNAVAILABLE)?;
    answer.entry.as_deref().and_then(super::desktop::select_arg).ok_or(UNAVAILABLE)
}

pub(crate) enum ContactReply {
    Ok(Value),
    Unauthorized,
    Failed,
}

pub(crate) trait ContactGraph {
    fn get(&self, access: &str, url: &str, ctx: &Ctx) -> ContactReply;
}

pub(crate) struct HttpContacts;

impl ContactGraph for HttpContacts {
    fn get(&self, access: &str, url: &str, ctx: &Ctx) -> ContactReply {
        static AGENT: std::sync::OnceLock<ureq::Agent> = std::sync::OnceLock::new();
        let agent = AGENT.get_or_init(|| ureq::AgentBuilder::new().timeout_connect(CONNECT).timeout(TOTAL).redirects(0).build());
        let left = ctx.remaining();
        if left.is_zero() {
            return ContactReply::Failed;
        }
        let result = agent.get(url).timeout(left).set("Authorization", &format!("Bearer {access}")).set("Accept", "application/json").call();
        match result {
            Ok(resp) if (200..300).contains(&resp.status()) => match super::read_body(resp).and_then(|b| serde_json::from_slice(&b).ok()) {
                Some(v) => ContactReply::Ok(v),
                None => ContactReply::Failed,
            },
            Ok(_) => ContactReply::Failed,
            Err(ureq::Error::Status(401, _)) => ContactReply::Unauthorized,
            Err(_) => ContactReply::Failed,
        }
    }
}

/// An access token for the contact lookup: the cached one, or a refresh with `CONTACTS_SCOPE`.
/// None for any trouble, and in no case a change to the account's calendar state.
fn contact_access(acct: &Account, store: &dyn SecretStore, tokens: &dyn TokenClient, core: &Mutex<Core>, now: u64, ctx: &Ctx, generation: u64) -> Option<String> {
    {
        let mut c = lock(core);
        if generation_of(&c, &acct.id) != generation {
            return None;
        }
        if let Some(cached) = c.contact_cache.get(&acct.id) {
            if cached.expires_at > now + SKEW_SECS {
                return Some(cached.access.clone());
            }
        }
        c.contact_cache.remove(&acct.id);
    }
    // The calendar turn, for the token request only: nobody else spends the refresh token meanwhile.
    let wait = Ctx::new(Kind::Next, clock_of(core), TURN_WAIT);
    let calendar_slot = lock(core).flights.entry(acct.id.clone()).or_default().clone();
    let _turn = Slot::acquire(calendar_slot, &wait)?;
    let refresh = {
        let mut c = lock(core);
        if generation_of(&c, &acct.id) != generation {
            return None;
        }
        if let Some(pending) = c.pending.get(&acct.id).cloned() {
            // A rotated token that never reached the store: try again first, as the calendar read does.
            if !store.set(&acct.id, &pending) {
                return None;
            }
            c.pending.remove(&acct.id);
        }
        match store.fetch(&acct.id) {
            Fetch::Found(v) => v,
            _ => return None,
        }
    };
    let limit = ctx.remaining().min(TOKEN_LIMIT);
    if limit.is_zero() {
        return None;
    }
    let form = [
        ("client_id", acct.client_id.as_str()),
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh.as_str()),
        ("scope", CONTACTS_SCOPE),
    ];
    let reply = tokens.post_within(&acct.tenant, &form, limit);
    let now = now + ctx.elapsed_ms() / 1000;
    let mut c = lock(core);
    if generation_of(&c, &acct.id) != generation {
        return None;
    }
    match reply {
        TokenReply::Ok { access, expires_in, refresh: rotated } => {
            c.contact_cache.insert(acct.id.clone(), Cached { access: access.clone(), expires_at: now + expires_in });
            if let Some(new) = rotated {
                if new != refresh && !store.set(&acct.id, &new) {
                    // The store kept the old value: hold the new token in memory, as the calendar read does.
                    c.pending.insert(acct.id.clone(), new);
                    return None;
                }
            }
            Some(access)
        }
        // invalid_grant, consent_required, 400 and the like: not available. The stored token is
        // kept and the account's state is not touched; only the next ask is put off.
        TokenReply::Rejected(_) | TokenReply::Refused(_) => {
            c.contact_denied.insert(acct.id.clone(), now + DENIED_SECS);
            None
        }
        TokenReply::Transient(_) | TokenReply::Failed(_) => None,
    }
}

/// The entry hex of the one saved contact with this address, or None (no match, several
/// matches, a refusal, a timeout, an address that fails the check, a signed-out account).
pub(crate) fn lookup_entry(
    acct: &Account,
    address: &str,
    store: &dyn SecretStore,
    tokens: &dyn TokenClient,
    graph: &dyn ContactGraph,
    core: &Mutex<Core>,
    now: u64,
) -> Option<String> {
    let url = contacts_url(address)?;
    let ctx = Ctx::new(Kind::Next, clock_of(core), TOTAL);
    let generation = {
        let c = lock(core);
        if c.contact_denied.get(&acct.id).is_some_and(|until| now < *until) {
            return None;
        }
        generation_of(&c, &acct.id)
    };
    let slot = lock(core).contact_flights.entry(acct.id.clone()).or_default().clone();
    let _turn = Slot::acquire(slot, &ctx)?;
    let access = contact_access(acct, store, tokens, core, now, &ctx, generation)?;
    let reply = graph.get(&access, &url, &ctx);
    let mut c = lock(core);
    if generation_of(&c, &acct.id) != generation {
        return None;
    }
    match reply {
        ContactReply::Ok(body) => single_entry(&body),
        ContactReply::Unauthorized => {
            if c.contact_cache.get(&acct.id).is_some_and(|cached| cached.access == access) {
                c.contact_cache.remove(&acct.id);
            }
            None
        }
        ContactReply::Failed => None,
    }
}

#[cfg(test)]
mod tests {
    use super::super::store::{Chunked, MemoryBlobs};
    use super::*;
    use serde_json::json;
    use std::cell::{Cell, RefCell};

    const NOW: u64 = 1_794_459_600;
    /// 20 bytes of 0xAB.
    const PROP: &str = "q6urq6urq6urq6urq6urq6urq6s=";
    fn hex() -> String {
        "AB".repeat(20)
    }

    fn acct() -> Account {
        Account { id: "work".into(), label: "Work".into(), client_id: "00000000-0000-0000-0000-000000000000".into(), tenant: "common".into(), position: 1 }
    }

    fn one_contact() -> Value {
        json!({ "value": [{ "id": "c1", "singleValueExtendedProperties": [{ "id": "Binary 0x0FFF", "value": PROP }] }] })
    }

    struct FakeTokens {
        replies: RefCell<Vec<TokenReply>>,
        forms: RefCell<Vec<Vec<(String, String)>>>,
    }
    impl FakeTokens {
        fn new(replies: Vec<TokenReply>) -> Self {
            FakeTokens { replies: RefCell::new(replies), forms: RefCell::new(vec![]) }
        }
        fn calls(&self) -> usize {
            self.forms.borrow().len()
        }
    }
    impl TokenClient for FakeTokens {
        fn post(&self, _tenant: &str, form: &[(&str, &str)]) -> TokenReply {
            self.forms.borrow_mut().push(form.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect());
            let mut r = self.replies.borrow_mut();
            if r.is_empty() { TokenReply::Transient("token-503".into()) } else { r.remove(0) }
        }
    }

    struct FakeContacts {
        replies: RefCell<Vec<ContactReply>>,
        seen: RefCell<Vec<(String, String)>>,
        calls: Cell<usize>,
    }
    impl FakeContacts {
        fn new(replies: Vec<ContactReply>) -> Self {
            FakeContacts { replies: RefCell::new(replies), seen: RefCell::new(vec![]), calls: Cell::new(0) }
        }
    }
    impl ContactGraph for FakeContacts {
        fn get(&self, access: &str, url: &str, _ctx: &Ctx) -> ContactReply {
            self.calls.set(self.calls.get() + 1);
            self.seen.borrow_mut().push((access.to_string(), url.to_string()));
            let mut r = self.replies.borrow_mut();
            if r.is_empty() { ContactReply::Failed } else { r.remove(0) }
        }
    }

    fn ok_token(access: &str, refresh: Option<&str>) -> TokenReply {
        TokenReply::Ok { access: access.into(), expires_in: 3600, refresh: refresh.map(str::to_string) }
    }

    fn setup() -> (Chunked<MemoryBlobs>, Mutex<Core>) {
        let store = Chunked(MemoryBlobs::default());
        store.set("work", "refresh-1");
        (store, Mutex::new(Core::default()))
    }

    #[test]
    fn the_request_has_the_exact_path_and_query() {
        assert_eq!(
            contacts_url("priya@contoso.example").as_deref(),
            Some("https://graph.microsoft.com/v1.0/me/contacts?$filter=emailAddresses%2Fany%28a%3Aa%2Faddress%20eq%20%27priya%40contoso.example%27%29&$select=id&$top=2&$expand=singleValueExtendedProperties%28%24filter%3Did%20eq%20%27Binary%200x0FFF%27%29")
        );
        // An address that fails the check never reaches a URL.
        for bad in ["", "priya", "a'b@contoso.example", "a@b.example?x=1", "a b@contoso.example", "a@b.example&c=d", "a@b.example%27"] {
            assert_eq!(contacts_url(bad), None, "{bad:?}");
        }
        // Whatever passes, the filter value holds no raw quote, space or parenthesis.
        let url = contacts_url("o_brien+x@sub.contoso.example").unwrap();
        let filter = url.split("$filter=").nth(1).unwrap().split('&').next().unwrap();
        assert!(!filter.contains(['\'', ' ', '(', ')']), "{filter}");
    }

    #[test]
    fn results_parse_only_for_exactly_one_contact_with_a_good_property() {
        assert_eq!(single_entry(&one_contact()), Some(hex()));
        assert_eq!(single_entry(&json!({ "value": [] })), None);
        let two = json!({ "value": [one_contact()["value"][0].clone(), one_contact()["value"][0].clone()] });
        assert_eq!(single_entry(&two), None);
        for bad in [
            json!({}),
            json!({ "value": "x" }),
            json!({ "value": [{ "id": "c1" }] }),
            json!({ "value": [{ "id": "c1", "singleValueExtendedProperties": [] }] }),
            json!({ "value": [{ "id": "c1", "singleValueExtendedProperties": [{ "id": "Binary 0x0FFF" }] }] }),
            json!({ "value": [{ "id": "c1", "singleValueExtendedProperties": [{ "id": "Binary 0x0FFF", "value": 5 }] }] }),
            json!({ "value": [{ "id": "c1", "singleValueExtendedProperties": [{ "id": "Binary 0x0FFF", "value": "not base64!" }] }] }),
            // Under 20 bytes.
            json!({ "value": [{ "id": "c1", "singleValueExtendedProperties": [{ "id": "Binary 0x0FFF", "value": "q6ur" }] }] }),
            // Another property id.
            json!({ "value": [{ "id": "c1", "singleValueExtendedProperties": [{ "id": "Binary 0x3001", "value": PROP }] }] }),
        ] {
            assert_eq!(single_entry(&bad), None, "{bad}");
        }
    }

    #[test]
    fn availability_needs_a_match_and_a_usable_selected_classic_outlook() {
        for found in [false, true] {
            for desktop in [false, true] {
                for classic in [false, true] {
                    for new_selected in [false, true] {
                        let expected = found && desktop && classic && !new_selected;
                        assert_eq!(contact_available(found, desktop, classic, new_selected), expected, "{found} {desktop} {classic} {new_selected}");
                    }
                }
            }
        }
        assert!(contact_available(true, true, true, false));
        assert!(!contact_available(true, true, false, false), "no classic install");
        assert!(!contact_available(true, true, true, true), "new Outlook selected");
    }

    #[test]
    fn the_contact_action_is_refused_unless_the_answer_says_available() {
        assert_eq!(launch_arg(None), Err("unavailable"));
        assert_eq!(launch_arg(Some(&ContactAnswer { available: false, entry: Some(hex()) })), Err("unavailable"));
        assert_eq!(launch_arg(Some(&ContactAnswer { available: true, entry: None })), Err("unavailable"));
        assert_eq!(launch_arg(Some(&ContactAnswer { available: true, entry: Some("zz".into()) })), Err("unavailable"));
        assert_eq!(launch_arg(Some(&ContactAnswer { available: true, entry: Some(hex()) })), Ok(format!("outlook:{}", hex())));
    }

    #[test]
    fn one_match_gives_the_entry_and_the_token_asks_for_the_contacts_scope_only() {
        let (store, core) = setup();
        let t = FakeTokens::new(vec![ok_token("contacts-access", None)]);
        let g = FakeContacts::new(vec![ContactReply::Ok(one_contact()), ContactReply::Ok(one_contact())]);
        assert_eq!(lookup_entry(&acct(), "priya@contoso.example", &store, &t, &g, &core, NOW), Some(hex()));
        let form = t.forms.borrow()[0].clone();
        assert!(form.contains(&("scope".to_string(), "offline_access https://graph.microsoft.com/Contacts.Read".to_string())));
        assert!(form.contains(&("grant_type".to_string(), "refresh_token".to_string())));
        assert!(form.contains(&("refresh_token".to_string(), "refresh-1".to_string())));
        assert_eq!(g.seen.borrow()[0].0, "contacts-access");
        assert!(g.seen.borrow()[0].1.starts_with("https://graph.microsoft.com/v1.0/me/contacts?$filter="));
        // The cached token serves the next lookup; the calendar token cache is untouched.
        assert_eq!(lookup_entry(&acct(), "priya@contoso.example", &store, &t, &g, &core, NOW + 5), Some(hex()));
        assert_eq!(t.calls(), 1);
        assert!(core.lock().unwrap().cache.is_empty());
    }

    #[test]
    fn two_matches_or_none_or_a_failure_are_not_available() {
        let two = json!({ "value": [one_contact()["value"][0].clone(), one_contact()["value"][0].clone()] });
        for reply in [ContactReply::Ok(two), ContactReply::Ok(json!({ "value": [] })), ContactReply::Failed, ContactReply::Unauthorized] {
            let (store, core) = setup();
            let t = FakeTokens::new(vec![ok_token("a", None)]);
            let g = FakeContacts::new(vec![reply]);
            assert_eq!(lookup_entry(&acct(), "priya@contoso.example", &store, &t, &g, &core, NOW), None);
        }
        // A 401 drops the cached contact token so the next lookup refreshes.
        let (store, core) = setup();
        let t = FakeTokens::new(vec![ok_token("a", None)]);
        let g = FakeContacts::new(vec![ContactReply::Unauthorized]);
        lookup_entry(&acct(), "priya@contoso.example", &store, &t, &g, &core, NOW);
        assert!(core.lock().unwrap().contact_cache.is_empty());
    }

    #[test]
    fn a_bad_address_asks_nobody() {
        let (store, core) = setup();
        let t = FakeTokens::new(vec![]);
        let g = FakeContacts::new(vec![]);
        assert_eq!(lookup_entry(&acct(), "a@b.example?x=1", &store, &t, &g, &core, NOW), None);
        assert_eq!((t.calls(), g.calls.get()), (0, 0));
    }

    #[test]
    fn a_refusal_leaves_the_calendar_state_and_the_stored_token_alone_and_is_not_asked_again() {
        for refusal in [TokenReply::Rejected("token-400".into()), TokenReply::Refused("token-400".into())] {
            let (store, core) = setup();
            core.lock().unwrap().cache.insert("work".into(), Cached { access: "cal".into(), expires_at: NOW + 3000 });
            let t = FakeTokens::new(vec![refusal]);
            let g = FakeContacts::new(vec![]);
            assert_eq!(lookup_entry(&acct(), "priya@contoso.example", &store, &t, &g, &core, NOW), None);
            assert_eq!(store.get("work").as_deref(), Some("refresh-1"), "the stored token must stay");
            {
                let c = core.lock().unwrap();
                assert_eq!(c.cache.get("work").map(|x| x.access.as_str()), Some("cal"));
                assert!(c.states.is_empty() && c.log_lines.is_empty() && c.pending.is_empty() && c.generations.is_empty());
            }
            assert_eq!(g.calls.get(), 0);
            // Put off for a while: no second token request, then asked again after the wait.
            assert_eq!(lookup_entry(&acct(), "priya@contoso.example", &store, &t, &g, &core, NOW + 60), None);
            assert_eq!(t.calls(), 1);
            let t2 = FakeTokens::new(vec![ok_token("later", None)]);
            let g2 = FakeContacts::new(vec![ContactReply::Ok(one_contact())]);
            assert_eq!(lookup_entry(&acct(), "priya@contoso.example", &store, &t2, &g2, &core, NOW + DENIED_SECS + 1), Some(hex()));
        }
    }

    #[test]
    fn a_transient_failure_is_not_remembered() {
        let (store, core) = setup();
        let t = FakeTokens::new(vec![TokenReply::Transient("token-503".into()), ok_token("a", None)]);
        let g = FakeContacts::new(vec![ContactReply::Ok(one_contact())]);
        assert_eq!(lookup_entry(&acct(), "priya@contoso.example", &store, &t, &g, &core, NOW), None);
        assert_eq!(lookup_entry(&acct(), "priya@contoso.example", &store, &t, &g, &core, NOW + 1), Some(hex()));
    }

    #[test]
    fn a_rotated_refresh_token_is_stored_like_the_calendar_refresh_does() {
        let (store, core) = setup();
        let t = FakeTokens::new(vec![ok_token("a", Some("refresh-2"))]);
        let g = FakeContacts::new(vec![ContactReply::Ok(one_contact())]);
        assert_eq!(lookup_entry(&acct(), "priya@contoso.example", &store, &t, &g, &core, NOW), Some(hex()));
        assert_eq!(store.get("work").as_deref(), Some("refresh-2"));
        assert!(core.lock().unwrap().pending.is_empty());
    }

    #[test]
    fn a_rotated_token_that_cannot_be_stored_is_held_for_the_calendar_read_to_retry() {
        struct Flaky(std::sync::atomic::AtomicBool);
        impl SecretStore for Flaky {
            fn fetch(&self, _id: &str) -> Fetch<String> {
                Fetch::Found("refresh-1".into())
            }
            fn set(&self, _id: &str, _value: &str) -> bool {
                self.0.load(std::sync::atomic::Ordering::SeqCst)
            }
            fn delete(&self, _id: &str) {}
        }
        let store = Flaky(std::sync::atomic::AtomicBool::new(false));
        let core = Mutex::new(Core::default());
        let t = FakeTokens::new(vec![ok_token("a", Some("refresh-2"))]);
        let g = FakeContacts::new(vec![]);
        assert_eq!(lookup_entry(&acct(), "priya@contoso.example", &store, &t, &g, &core, NOW), None);
        assert_eq!(core.lock().unwrap().pending.get("work").map(String::as_str), Some("refresh-2"));
        // No account state change from this path.
        assert!(core.lock().unwrap().states.is_empty());
    }

    #[test]
    fn a_signed_out_account_asks_nobody() {
        let store = Chunked(MemoryBlobs::default());
        let core = Mutex::new(Core::default());
        let t = FakeTokens::new(vec![]);
        let g = FakeContacts::new(vec![]);
        assert_eq!(lookup_entry(&acct(), "priya@contoso.example", &store, &t, &g, &core, NOW), None);
        assert_eq!((t.calls(), g.calls.get()), (0, 0));
    }

    #[test]
    fn a_sign_out_during_the_lookup_discards_the_answer() {
        struct SignOutDuring<'a>(&'a Mutex<Core>);
        impl ContactGraph for SignOutDuring<'_> {
            fn get(&self, _access: &str, _url: &str, _ctx: &Ctx) -> ContactReply {
                *self.0.lock().unwrap().generations.entry("work".into()).or_insert(0) += 1;
                ContactReply::Ok(one_contact())
            }
        }
        let (store, core) = setup();
        let t = FakeTokens::new(vec![ok_token("a", None)]);
        assert_eq!(lookup_entry(&acct(), "priya@contoso.example", &store, &t, &SignOutDuring(&core), &core, NOW), None);
    }
}
