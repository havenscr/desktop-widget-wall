//! The silent refresh and the calendar read, behind traits so tests can fake the network.

use super::auth::{TokenClient, TokenReply, SCOPE};
use super::graph::{merge, merge_capped, shape_events, Ctx, Diag, Kind, BUDGET, MAX_DAY_EVENTS, utc_iso, Candidate, GraphClient, GraphReply};
use super::meetlog::{format_line, format_line_detail};
use super::reason::{is_valid_reason, STORE_READ, STORE_WRITE};
use super::store::{Fetch, SecretStore};
use super::Account;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Instant;

/// Refresh an access token that has less than this left.
const SKEW_SECS: u64 = 120;
const WINDOW_SECS: u64 = 24 * 3600;

/// Numbers every payload in the order its state was settled, so the web view can drop an
/// answer that arrives after a newer one.
static SEQ: AtomicU64 = AtomicU64::new(0);

/// Which accounts a read goes to the network for. The others are answered from what is held.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Only<'a> {
    All,
    One(&'a str),
    Nobody,
}

impl Only<'_> {
    fn wants(self, id: &str) -> bool {
        match self {
            Only::All => true,
            Only::One(one) => one == id,
            Only::Nobody => false,
        }
    }
}

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
    /// The same for the day read, used only for accounts a read did not ask.
    pub last_day: HashMap<String, Vec<Candidate>>,
    /// A rotated refresh token that could not be written to the store yet. It is the one to
    /// use (and retry storing) while it is here; the stored one may already be spent.
    pub pending: HashMap<String, String>,
    /// The last state and reason logged for each account; a line is queued only on a change.
    pub states: HashMap<String, (String, Option<String>)>,
    /// Log lines waiting for the caller to hand them to the log writer.
    pub log_lines: Vec<String>,
    /// Bumped by sign-out and by a new sign-in. A read that started under an older number
    /// writes nothing back.
    pub generations: HashMap<String, u64>,
    /// One turn-taker per account, held across the token request only (never the core lock),
    /// so two reads never both spend the same rotating refresh token.
    pub flights: HashMap<String, Arc<Mutex<()>>>,
}

/// Queue one log line when the account's state or reason differs from the last one logged.
pub fn record(core: &mut Core, id: &str, state: &str, reason: Option<&str>, now: u64) {
    record_detail(core, id, state, reason, now, None);
}

/// `record`, plus the Graph failure details when there are some. A line with details is
/// written for every failure, changed state or not, so each failed call can be traced.
pub fn record_detail(core: &mut Core, id: &str, state: &str, reason: Option<&str>, now: u64, detail: Option<&Diag>) {
    let reason = reason.filter(|r| is_valid_reason(r)).map(str::to_string);
    let new = (state.to_string(), reason);
    let old = core.states.get(id).map(|(s, _)| s.as_str()).unwrap_or("start").to_string();
    if core.states.get(id) == Some(&new) && detail.is_none() {
        return;
    }
    // The queue is drained after every read; the cap only guards a caller that never drains.
    if core.log_lines.len() < 64 {
        let line = match detail {
            Some(d) => format_line_detail(&utc_iso(now), id, &old, state, new.1.as_deref(), &d.log_fields()),
            None => format_line(&utc_iso(now), id, &old, state, new.1.as_deref()),
        };
        core.log_lines.push(line);
    }
    core.states.insert(id.to_string(), new);
}

/// Join links behind opaque keys. Its own lock, never held across network I/O, so Join
/// answers at once even while a read is waiting on Graph. Lock order, where both are needed:
/// the core lock first, then this one. Nothing takes this one and then the core lock.
#[derive(Default)]
pub struct Links {
    pub generation: u64,
    /// Key to (account id, join URL). The account id lets sign-out drop that account's links.
    pub map: HashMap<String, (String, String)>,
    /// The day view's keys (they start with `d`), swapped separately so a day read never
    /// breaks a Join key from the next-meetings read, and the other way round.
    pub day_map: HashMap<String, (String, String)>,
}

pub fn lookup_link(links: &Mutex<Links>, key: &str) -> Option<String> {
    let guard = links.lock().unwrap_or_else(|e| e.into_inner());
    guard.map.get(key).or_else(|| guard.day_map.get(key)).map(|(_, url)| url.clone())
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AccountState {
    Ok,
    SignedOut,
    NeedsSignIn,
    Unavailable,
    /// Not asked yet in this run.
    Checking,
}

impl AccountState {
    fn as_str(self) -> &'static str {
        match self {
            AccountState::Ok => "ok",
            AccountState::SignedOut => "signed-out",
            AccountState::NeedsSignIn => "needs-sign-in",
            AccountState::Unavailable => "unavailable",
            AccountState::Checking => "checking",
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
    /// Settle order: a payload with a higher number is newer.
    pub seq: u64,
}

/// Why a state is not `Ok`: the state and a reason code when there is one.
type Fail = (AccountState, Option<String>);

/// Why `obtain` gave no token: a real failure, or the account changed under the read.
enum Stop {
    Fail(Fail),
    /// Sign-out or a new sign-in happened since the read started: change nothing.
    Stale,
}

/// What one account's read came to.
struct Read {
    state: AccountState,
    meetings: Option<Vec<Candidate>>,
    reason: Option<String>,
    /// The account's generation when the read started. The result is applied only if it is
    /// still the current one.
    generation: u64,
    /// The account changed under the read; nothing from it may be written back.
    discarded: bool,
    /// Why Graph failed, for the log.
    diag: Option<Diag>,
    /// The read was not asked to go to the network for this account.
    skipped: bool,
}

fn lock(core: &Mutex<Core>) -> MutexGuard<'_, Core> {
    core.lock().unwrap_or_else(|e| e.into_inner())
}

fn generation_of(core: &Core, id: &str) -> u64 {
    core.generations.get(id).copied().unwrap_or(0)
}

/// What one short look at the account's state decided.
enum Step {
    Have(String),
    Refresh(String),
}

/// One short critical section: retry a pending rotated token, read the stored token, and use
/// the cache when it is good. `rejected` is an access token Graph just refused; a cached one
/// that differs from it (another read already refreshed) is fine to use. The local credential
/// store is touched here on purpose: its writes and sign-out's delete must be ordered with the
/// generation check. Nothing here waits on the network.
fn check(
    acct: &Account,
    store: &dyn SecretStore,
    core: &mut Core,
    now: u64,
    generation: u64,
    rejected: Option<&str>,
) -> Result<Step, Stop> {
    if generation_of(core, &acct.id) != generation {
        return Err(Stop::Stale);
    }
    if let Some(p) = core.pending.get(&acct.id).cloned() {
        // An earlier rotated token never reached the store: try again before anything else.
        if !store.set(&acct.id, &p) {
            return Err(Stop::Fail((AccountState::Unavailable, Some(STORE_WRITE.to_string()))));
        }
        core.pending.remove(&acct.id);
    }
    let refresh = match store.fetch(&acct.id) {
        Fetch::Found(v) => v,
        Fetch::Missing => {
            core.cache.remove(&acct.id);
            return Err(Stop::Fail((AccountState::SignedOut, None)));
        }
        // The store could not be read: not signed out. Nothing is deleted or overwritten.
        Fetch::Failed => return Err(Stop::Fail((AccountState::Unavailable, Some(STORE_READ.to_string())))),
    };
    if let Some(c) = core.cache.get(&acct.id) {
        if c.expires_at > now + SKEW_SECS && rejected != Some(c.access.as_str()) {
            return Ok(Step::Have(c.access.clone()));
        }
    }
    core.cache.remove(&acct.id);
    Ok(Step::Refresh(refresh))
}

/// A fresh access token for the account, from the cache or a refresh. The core lock is held
/// only in short steps; the token request runs with it released, and one refresh per account
/// runs at a time so two reads never both spend the same rotating refresh token.
fn obtain(
    acct: &Account,
    store: &dyn SecretStore,
    tokens: &dyn TokenClient,
    core: &Mutex<Core>,
    now: u64,
    began: Instant,
    generation: u64,
    rejected: Option<&str>,
) -> Result<String, Stop> {
    match check(acct, store, &mut lock(core), now, generation, rejected)? {
        Step::Have(a) => return Ok(a),
        Step::Refresh(_) => {}
    }
    let flight = lock(core).flights.entry(acct.id.clone()).or_default().clone();
    let _turn = flight.lock().unwrap_or_else(|e| e.into_inner());
    // Look again: a read ahead of this one may have refreshed while this one waited its turn.
    // The wait may have been long, so the clock is read again.
    let now = now + began.elapsed().as_secs();
    let refresh = match check(acct, store, &mut lock(core), now, generation, rejected)? {
        Step::Have(a) => return Ok(a),
        Step::Refresh(r) => r,
    };
    let form = [
        ("client_id", acct.client_id.as_str()),
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh.as_str()),
        ("scope", SCOPE),
    ];
    let reply = tokens.post(&acct.tenant, &form);
    // Apply the reply in one short step, and only if the account is unchanged. The credential
    // store calls below run under the core lock on purpose: they are local and brief, and
    // doing them here keeps them ordered with sign-out's delete and generation bump.
    let now = now + began.elapsed().as_secs();
    let mut core = lock(core);
    if generation_of(&core, &acct.id) != generation {
        return Err(Stop::Stale);
    }
    match reply {
        TokenReply::Ok { access, expires_in, refresh: rotated } => {
            core.cache.insert(acct.id.clone(), Cached { access: access.clone(), expires_at: now + expires_in });
            if let Some(new) = rotated {
                if new != refresh && !store.set(&acct.id, &new) {
                    // The store kept the old value. Hold the new token in memory, retry next
                    // time, and report unavailable instead of connected-then-signed-out.
                    core.pending.insert(acct.id.clone(), new);
                    return Err(Stop::Fail((AccountState::Unavailable, Some(STORE_WRITE.to_string()))));
                }
            }
            Ok(access)
        }
        TokenReply::Rejected(why) => {
            store.delete(&acct.id);
            core.pending.remove(&acct.id);
            Err(Stop::Fail((AccountState::NeedsSignIn, Some(why))))
        }
        // Not a dead grant but nothing a retry fixes: offer Sign in, keep the stored token.
        TokenReply::Refused(why) => Err(Stop::Fail((AccountState::NeedsSignIn, Some(why)))),
        TokenReply::Transient(why) | TokenReply::Failed(why) => Err(Stop::Fail((AccountState::Unavailable, Some(why)))),
    }
}

fn read_account(
    acct: &Account,
    store: &dyn SecretStore,
    tokens: &dyn TokenClient,
    graph: &dyn GraphClient,
    core: &Mutex<Core>,
    now: u64,
) -> Read {
    read_window(acct, store, tokens, graph, core, now, now, now + WINDOW_SECS, Kind::Next)
}

/// One account's events between two instants (epoch seconds). The core lock is never held
/// while waiting on the token endpoint or Graph.
#[allow(clippy::too_many_arguments)]
fn read_window(
    acct: &Account,
    store: &dyn SecretStore,
    tokens: &dyn TokenClient,
    graph: &dyn GraphClient,
    core: &Mutex<Core>,
    now: u64,
    from: u64,
    to: u64,
    kind: Kind,
) -> Read {
    let (start, end) = (utc_iso(from), utc_iso(to));
    let began = Instant::now();
    let generation = generation_of(&lock(core), &acct.id);
    let done = |state, meetings, reason| Read { state, meetings, reason, generation, discarded: false, diag: None, skipped: false };
    let stopped = |stop: Stop| match stop {
        Stop::Fail((state, reason)) => done(state, None, reason),
        Stop::Stale => Read { state: AccountState::Unavailable, meetings: None, reason: None, generation, discarded: true, diag: None, skipped: false },
    };
    let access = match obtain(acct, store, tokens, core, now, began, generation, None) {
        Ok(a) => a,
        Err(stop) => return stopped(stop),
    };
    let ctx = Ctx { kind, began, budget: BUDGET };
    let (mut reply, mut diag) = graph.calendar_view_diag(&access, &start, &end, &ctx);
    if matches!(reply, GraphReply::Unauthorized) {
        // The cached token was refused: drop it, refresh once, ask once more.
        let access = match obtain(acct, store, tokens, core, now, began, generation, Some(access.as_str())) {
            Ok(a) => a,
            Err(stop) => return stopped(stop),
        };
        (reply, diag) = graph.calendar_view_diag(&access, &start, &end, &ctx);
    }
    let mut read = match reply {
        GraphReply::Ok(body) => done(AccountState::Ok, Some(shape_events(&body, &acct.id)), None),
        GraphReply::Unauthorized => done(AccountState::Unavailable, None, Some("graph-401".to_string())),
        GraphReply::Transient(why) | GraphReply::Failed(why) => done(AccountState::Unavailable, None, Some(why)),
    };
    read.diag = diag;
    read
}

/// A read that made no network call for the account.
fn skipped_read(core: &Mutex<Core>, id: &str) -> Read {
    let generation = generation_of(&lock(core), id);
    Read { state: AccountState::Checking, meetings: None, reason: None, generation, discarded: false, diag: None, skipped: true }
}

/// The final step of a read, with the core lock held by the caller: re-check every account's
/// generation, then apply or drop each result. An account that changed under the read
/// contributes nothing from the read; its state is re-read once from the store only (no
/// network): signed-out when no token is stored, otherwise ok with the last good list (if
/// any) and the stale flag. `keep_last` is true for the next read, which keeps a last-good
/// list per account; the day read does not.
fn settle(
    accounts: &[Account],
    reads: Vec<Read>,
    store: &dyn SecretStore,
    core: &mut Core,
    now: u64,
    keep_last: bool,
) -> (Vec<AccountOut>, Vec<Vec<Candidate>>, bool) {
    let mut statuses = Vec::new();
    let mut lists = Vec::new();
    let mut stale = false;
    for (acct, read) in accounts.iter().zip(reads) {
        if read.skipped {
            // Answered from what is held: the last state seen and the last good list.
            let (state, reason) = match core.states.get(&acct.id) {
                Some((s, r)) => (
                    match s.as_str() {
                        "ok" => AccountState::Ok,
                        "signed-out" => AccountState::SignedOut,
                        "needs-sign-in" => AccountState::NeedsSignIn,
                        "unavailable" => AccountState::Unavailable,
                        _ => AccountState::Checking,
                    },
                    r.clone(),
                ),
                None => (AccountState::Checking, None),
            };
            let held = if keep_last { core.last.get(&acct.id) } else { core.last_day.get(&acct.id) };
            let list = if state == AccountState::SignedOut { Vec::new() } else { held.cloned().unwrap_or_default() };
            stale |= keep_last && state == AccountState::Unavailable && !list.is_empty();
            statuses.push(AccountOut { id: acct.id.clone(), label: acct.label.clone(), state: state.as_str(), reason });
            lists.push(list);
            continue;
        }
        let out = |state: AccountState, reason| AccountOut { id: acct.id.clone(), label: acct.label.clone(), state: state.as_str(), reason };
        if read.discarded || generation_of(core, &acct.id) != read.generation {
            // The credential store read here is local and deliberate, like the other store
            // calls under this lock.
            match store.fetch(&acct.id) {
                Fetch::Missing => {
                    statuses.push(out(AccountState::SignedOut, None));
                    lists.push(Vec::new());
                }
                _ => {
                    let held = if keep_last { core.last.get(&acct.id).cloned() } else { None };
                    stale |= keep_last;
                    statuses.push(out(AccountState::Ok, None));
                    lists.push(held.unwrap_or_default());
                }
            }
            continue;
        }
        let Read { state, meetings: fresh, reason, diag, .. } = read;
        record_detail(core, &acct.id, state.as_str(), reason.as_deref(), now, diag.as_ref());
        let list = match fresh {
            Some(l) => {
                if keep_last {
                    core.last.insert(acct.id.clone(), l.clone());
                } else {
                    core.last_day.insert(acct.id.clone(), l.clone());
                }
                l
            }
            // Unavailable: keep showing what the last good read held, and say so.
            None if keep_last && state == AccountState::Unavailable => match core.last.get(&acct.id) {
                Some(l) => {
                    stale = true;
                    l.clone()
                }
                None => Vec::new(),
            },
            None => {
                if keep_last {
                    core.last.remove(&acct.id);
                } else {
                    core.last_day.remove(&acct.id);
                }
                Vec::new()
            }
        };
        statuses.push(out(state, reason.filter(|r| is_valid_reason(r))));
        lists.push(list);
    }
    (statuses, lists, stale)
}

/// Read every account, merge, and replace the link map. The payload carries no URL. All the
/// network work comes first, with no lock held. Then one critical section under the core
/// lock re-checks each account's generation and publishes the link map, so an account that
/// signed out meanwhile is neither listed nor joinable.
#[allow(dead_code)]
pub fn read_next(
    accounts: &[Account],
    store: &dyn SecretStore,
    tokens: &dyn TokenClient,
    graph: &dyn GraphClient,
    core: &Mutex<Core>,
    links: &Mutex<Links>,
    now: u64,
) -> MeetPayload {
    read_next_only(accounts, store, tokens, graph, core, links, now, Only::All)
}

/// `read_next` that goes to the network only for the chosen accounts; the rest are
/// answered from the last state and list held (or "checking" when nothing is held yet).
#[allow(clippy::too_many_arguments)]
pub fn read_next_only(
    accounts: &[Account],
    store: &dyn SecretStore,
    tokens: &dyn TokenClient,
    graph: &dyn GraphClient,
    core: &Mutex<Core>,
    links: &Mutex<Links>,
    now: u64,
    only: Only,
) -> MeetPayload {
    let reads: Vec<Read> = accounts
        .iter()
        .map(|acct| if only.wants(&acct.id) { read_account(acct, store, tokens, graph, core, now) } else { skipped_read(core, &acct.id) })
        .collect();
    // Lock order: core, then links.
    let mut c = lock(core);
    let (statuses, lists, stale) = settle(accounts, reads, store, &mut c, now, true);
    let merged = merge(lists);
    let seq = SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    let mut guard = links.lock().unwrap_or_else(|e| e.into_inner());
    guard.generation += 1;
    guard.map.clear();
    let generation = guard.generation;
    let meetings = merged
        .into_iter()
        .enumerate()
        .map(|(n, cand)| {
            let key = format!("{generation}-{n}");
            let can_join = cand.join.is_some();
            if let Some(url) = cand.join {
                guard.map.insert(key.clone(), (cand.account_id.clone(), url));
            }
            MeetingOut { key, account_id: cand.account_id, title: cand.title, start: cand.start, end: cand.end, can_join }
        })
        .collect();
    drop(guard);
    drop(c);
    MeetPayload { accounts: statuses, meetings, stale, seq }
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
    pub seq: u64,
}

/// An event counts as a livestream when its subject starts with "Livestream".
pub fn is_live(title: &str) -> bool {
    title.trim_start().to_ascii_lowercase().starts_with("livestream")
}

/// Every account's events from `from` to `to`, past ones included, merged and sorted. Join
/// links stay behind keys, as in `read_next`. An unavailable account adds nothing.
#[allow(clippy::too_many_arguments, dead_code)]
pub fn read_day(
    accounts: &[Account],
    store: &dyn SecretStore,
    tokens: &dyn TokenClient,
    graph: &dyn GraphClient,
    core: &Mutex<Core>,
    links: &Mutex<Links>,
    now: u64,
    from: u64,
    to: u64,
) -> DayPayload {
    read_day_only(accounts, store, tokens, graph, core, links, now, from, to, Only::All)
}

/// `read_day` that goes to the network only for the chosen accounts.
#[allow(clippy::too_many_arguments)]
pub fn read_day_only(
    accounts: &[Account],
    store: &dyn SecretStore,
    tokens: &dyn TokenClient,
    graph: &dyn GraphClient,
    core: &Mutex<Core>,
    links: &Mutex<Links>,
    now: u64,
    from: u64,
    to: u64,
    only: Only,
) -> DayPayload {
    let reads: Vec<Read> = accounts
        .iter()
        .map(|acct| if only.wants(&acct.id) { read_window(acct, store, tokens, graph, core, now, from, to, Kind::Day) } else { skipped_read(core, &acct.id) })
        .collect();
    // Lock order: core, then links.
    let mut c = lock(core);
    let (statuses, lists, _) = settle(accounts, reads, store, &mut c, now, false);
    let merged = merge_capped(lists, MAX_DAY_EVENTS);
    let seq = SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    let mut guard = links.lock().unwrap_or_else(|e| e.into_inner());
    guard.generation += 1;
    guard.day_map.clear();
    let generation = guard.generation;
    let events = merged
        .into_iter()
        .enumerate()
        .map(|(n, cand)| {
            let key = format!("d{generation}-{n}");
            let can_join = cand.join.is_some();
            if let Some(url) = cand.join {
                guard.day_map.insert(key.clone(), (cand.account_id.clone(), url));
            }
            let is_live = is_live(&cand.title);
            DayEventOut { key, account_id: cand.account_id, title: cand.title, start: cand.start, end: cand.end, can_join, is_live }
        })
        .collect();
    drop(guard);
    drop(c);
    DayPayload { accounts: statuses, events, seq }
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
            // Store and bump the generation in one step, so a read that began earlier cannot
            // slip its own tokens in between. The store write under the lock is deliberate
            // (local, brief, keeps this ordered with sign-out).
            let mut guard = lock(core);
            if !store.set(&acct.id, &refresh) {
                drop(guard);
                return Err(sign_in_failed(core, acct, STORE_WRITE, now));
            }
            let core = &mut *guard;
            *core.generations.entry(acct.id.clone()).or_insert(0) += 1;
            core.pending.remove(&acct.id);
            core.cache.insert(acct.id.clone(), Cached { access, expires_at: now + expires_in });
            record(core, &acct.id, "signed-in", None, now);
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

/// Delete the stored token and forget everything held for the account, then bump its
/// generation so a read already waiting on the network cannot put any of it back, and drop
/// the account's published join links so they stop working at once. The core lock is held
/// only for these local steps, never across a network call. The credential store delete runs
/// under it on purpose (local, brief, and it keeps sign-out atomic with the generation bump).
/// Lock order: core, then links.
pub fn sign_out(id: &str, store: &dyn SecretStore, core: &Mutex<Core>, links: &Mutex<Links>) {
    let mut core = lock(core);
    store.delete(id);
    *core.generations.entry(id.to_string()).or_insert(0) += 1;
    core.cache.remove(id);
    core.last.remove(id);
    core.last_day.remove(id);
    core.pending.remove(id);
    let mut l = links.lock().unwrap_or_else(|e| e.into_inner());
    l.map.retain(|_, (account, _)| account != id);
    l.day_map.retain(|_, (account, _)| account != id);
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

    fn setup() -> (Chunked<MemoryBlobs>, Mutex<Core>) {
        let store = Chunked(MemoryBlobs::default());
        store.set("work", "refresh-1");
        (store, Mutex::new(Core::default()))
    }

    #[test]
    fn signed_out_without_a_stored_token() {
        let store = Chunked(MemoryBlobs::default());
        let core = Mutex::new(Core::default());
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![]);
        let g = FakeGraph::new(vec![]);
        let p = read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW);
        assert_eq!(p.accounts[0].state, "signed-out");
        assert_eq!(t.calls.get() + g.calls.get(), 0);
    }

    #[test]
    fn expired_cache_refreshes_and_rotated_token_is_stored() {
        let (store, core) = setup();
        let links = Mutex::new(Links::default());
        core.lock().unwrap().cache.insert("work".into(), Cached { access: "old".into(), expires_at: NOW + 60 });
        let t = FakeTokens::new(vec![ok_token("new", Some("refresh-2"))]);
        let g = FakeGraph::new(vec![GraphReply::Ok(body("A", "1"))]);
        let p = read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW);
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
        let (store, core) = setup();
        let links = Mutex::new(Links::default());
        core.lock().unwrap().cache.insert("work".into(), Cached { access: "cached".into(), expires_at: NOW + 600 });
        let t = FakeTokens::new(vec![]);
        let g = FakeGraph::new(vec![GraphReply::Ok(body("A", "1"))]);
        read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW);
        assert_eq!(t.calls.get(), 0);
        assert_eq!(g.seen_access.borrow()[0], "cached");
    }

    #[test]
    fn invalid_grant_deletes_the_token() {
        let (store, core) = setup();
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![TokenReply::Rejected("token-400-70000".into())]);
        let g = FakeGraph::new(vec![]);
        let p = read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW);
        assert_eq!(p.accounts[0].state, "needs-sign-in");
        assert_eq!(store.get("work"), None);
    }

    #[test]
    fn a_refused_token_request_offers_sign_in_and_keeps_the_token() {
        let (store, core) = setup();
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![TokenReply::Refused("token-400".into())]);
        let g = FakeGraph::new(vec![]);
        let p = read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW);
        assert_eq!(p.accounts[0].state, "needs-sign-in");
        assert_eq!(store.get("work").as_deref(), Some("refresh-1"));
    }

    #[test]
    fn transient_failure_keeps_the_token() {
        let (store, core) = setup();
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![TokenReply::Transient("token-503".into())]);
        let g = FakeGraph::new(vec![]);
        let p = read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW);
        assert_eq!(p.accounts[0].state, "unavailable");
        assert_eq!(store.get("work").as_deref(), Some("refresh-1"));
    }

    #[test]
    fn a_401_refreshes_once_and_retries_once() {
        let (store, core) = setup();
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![ok_token("a1", None), ok_token("a2", None)]);
        let g = FakeGraph::new(vec![GraphReply::Unauthorized, GraphReply::Ok(body("A", "1"))]);
        let p = read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW);
        assert_eq!(t.calls.get(), 2);
        assert_eq!(g.calls.get(), 2);
        assert_eq!(p.accounts[0].state, "ok");
        assert_eq!(g.seen_access.borrow().as_slice(), ["a1", "a2"]);

        let (store, core) = setup();
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![ok_token("a1", None), ok_token("a2", None), ok_token("a3", None)]);
        let g = FakeGraph::new(vec![GraphReply::Unauthorized, GraphReply::Unauthorized, GraphReply::Ok(body("A", "1"))]);
        let p = read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW);
        assert_eq!(g.calls.get(), 2);
        assert_eq!(t.calls.get(), 2);
        assert_eq!(p.accounts[0].state, "unavailable");
    }

    #[test]
    fn two_accounts_merge_dedupe_and_hide_links() {
        let store = Chunked(MemoryBlobs::default());
        store.set("work", "r1");
        store.set("second", "r2");
        let core = Mutex::new(Core::default());
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![ok_token("a", None), ok_token("b", None)]);
        let g = FakeGraph::new(vec![GraphReply::Ok(body("Same invite", "dup")), GraphReply::Ok(body("Same invite", "dup"))]);
        let p = read_next(&[acct("work"), acct("second")], &store, &t, &g, &core, &links, NOW);
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
        let p = read_next(&[acct("work"), acct("second")], &store, &t, &g, &core, &links, NOW + 10);
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
        let (store, core) = setup();
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
        let p = read_day(&accounts, &store, &t, &g, &core, &links, NOW, from, to);
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
        let n = read_next(&accounts, &store, &t, &g, &core, &links, NOW + 10);
        assert!(!is_live(&n.meetings[0].title));
        assert!(lookup_link(&links, &day_key).is_some());
        assert_eq!(g.seen_window.borrow()[1], (utc_iso(NOW + 10), utc_iso(NOW + 10 + WINDOW_SECS)));
    }

    #[test]
    fn an_unavailable_account_in_the_day_read_carries_its_reason_and_is_logged() {
        let (store, core) = setup();
        let links = Mutex::new(Links::default());
        core.lock().unwrap().cache.insert("work".into(), Cached { access: "c".into(), expires_at: NOW + 6000 });
        let t = FakeTokens::new(vec![]);
        let g = FakeGraph::new(vec![GraphReply::Failed("graph-403-ErrorAccessDenied".into())]);
        let (from, to) = (1_794_441_600, 1_794_441_600 + 36 * 3600);
        let p = read_day(&[acct("work")], &store, &t, &g, &core, &links, NOW, from, to);
        assert_eq!(p.accounts[0].state, "unavailable");
        assert_eq!(p.accounts[0].reason.as_deref(), Some("graph-403-ErrorAccessDenied"));
        assert!(p.events.is_empty());
        assert_eq!(core.lock().unwrap().log_lines, vec!["2026-11-12T05:00:00Z work start unavailable graph-403-ErrorAccessDenied\n".to_string()]);
        assert_eq!(store.get("work").as_deref(), Some("refresh-1"));
    }

    #[test]
    fn a_failed_store_read_in_the_day_read_is_store_read_and_deletes_nothing() {
        let store = FlakySecrets { inner: Chunked(MemoryBlobs::default()), fail_set: Cell::new(false), fail_get: Cell::new(false) };
        store.set("work", "refresh-1");
        store.fail_get.set(true);
        let core = Mutex::new(Core::default());
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![]);
        let g = FakeGraph::new(vec![]);
        let (from, to) = (1_794_441_600, 1_794_441_600 + 36 * 3600);
        let p = read_day(&[acct("work")], &store, &t, &g, &core, &links, NOW, from, to);
        assert_eq!(p.accounts[0].state, "unavailable");
        assert_eq!(p.accounts[0].reason.as_deref(), Some("store-read"));
        assert_eq!(t.calls.get() + g.calls.get(), 0);
        store.fail_get.set(false);
        assert_eq!(store.get("work").as_deref(), Some("refresh-1"));
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
        let core = Mutex::new(Core::default());
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![ok_token("a", None), ok_token("b", None)]);
        let g = FakeGraph::new(vec![GraphReply::Ok(body("Work one", "w1")), GraphReply::Ok(body("Second one", "s1"))]);
        let accounts = [acct("work"), acct("second")];
        let p = read_next(&accounts, &store, &t, &g, &core, &links, NOW);
        assert!(!p.stale);
        assert_eq!(p.meetings.len(), 2);
        // The second account now fails; the first still answers.
        let g = FakeGraph::new(vec![GraphReply::Ok(body("Work one", "w1")), GraphReply::Transient("graph-503".into())]);
        let p = read_next(&accounts, &store, &t, &g, &core, &links, NOW + 10);
        assert!(p.stale);
        assert_eq!(p.accounts[1].state, "unavailable");
        assert_eq!(p.meetings.len(), 2);
        let kept = p.meetings.iter().find(|m| m.account_id == "second").unwrap();
        assert_eq!(kept.title, "Second one");
        assert!(kept.can_join);
        assert!(lookup_link(&links, &kept.key).unwrap().starts_with("https://teams.microsoft.com/"));
        // Signing out drops what was kept.
        sign_out("second", &store, &core, &links);
        let g = FakeGraph::new(vec![GraphReply::Ok(body("Work one", "w1"))]);
        let p = read_next(&accounts, &store, &t, &g, &core, &links, NOW + 20);
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
        let core = Mutex::new(Core::default());
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![ok_token("new", Some("refresh-2"))]);
        let g = FakeGraph::new(vec![GraphReply::Ok(body("A", "1"))]);
        let p = read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW);
        assert_eq!(p.accounts[0].state, "unavailable");
        assert_eq!(store.get("work").as_deref(), Some("refresh-1"));
        assert_eq!(core.lock().unwrap().pending.get("work").map(String::as_str), Some("refresh-2"));
        // Still failing: stays unavailable, token stays pending.
        let p = read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW + 5);
        assert_eq!(p.accounts[0].state, "unavailable");
        // Store works again: the pending token is written and the account reads normally.
        store.fail_set.set(false);
        let p = read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW + 10);
        assert_eq!(p.accounts[0].state, "ok");
        assert_eq!(store.get("work").as_deref(), Some("refresh-2"));
        assert!(core.lock().unwrap().pending.is_empty());
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
        let (store, core) = setup();
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![ok_token("a", None)]);
        let g = FakeGraph::new(vec![GraphReply::Ok(body("First", "f"))]);
        read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW);
        let probe = ProbeGraph { links: &links, seen: RefCell::new(None) };
        read_next(&[acct("work")], &store, &t, &probe, &core, &links, NOW + 10);
        let seen = probe.seen.borrow().clone().expect("graph was called");
        assert!(seen.unwrap().starts_with("https://teams.microsoft.com/"));
    }

    #[test]
    fn sign_in_stores_the_refresh_token_and_caches_access() {
        let store = Chunked(MemoryBlobs::default());
        let core = Mutex::new(Core::default());
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![ok_token("acc", Some("ref"))]);
        let granted = super::super::auth::Granted { code: "c".into(), verifier: "v".into(), redirect_uri: "http://localhost:1/auth-callback.html".into() };
        assert!(complete_sign_in(&acct("work"), &granted, &store, &t, &core, NOW).is_ok());
        assert_eq!(store.get("work").as_deref(), Some("ref"));
        assert_eq!(core.lock().unwrap().cache.get("work").unwrap().access, "acc");
        let t = FakeTokens::new(vec![ok_token("acc", None)]);
        assert_eq!(complete_sign_in(&acct("work"), &granted, &store, &t, &core, NOW), Err("token-200".to_string()));
        sign_out("work", &store, &core, &links);
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
            let (store, core) = setup();
            let links = Mutex::new(Links::default());
            core.lock().unwrap().cache.insert("work".into(), Cached { access: "c".into(), expires_at: NOW + 600 });
            let t = FakeTokens::new(vec![]);
            let g = FakeGraph::new(vec![reply]);
            let p = read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW);
            assert_eq!(p.accounts[0].state, "unavailable");
            assert_eq!(reasons(&p), vec![Some(want)]);
            let text = serde_json::to_string(&p).unwrap();
            assert!(text.contains(&format!("\"reason\":\"{want}\"")), "{text}");
        }
    }

    #[test]
    fn a_second_401_reports_graph_401() {
        let (store, core) = setup();
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![ok_token("a1", None), ok_token("a2", None)]);
        let g = FakeGraph::new(vec![GraphReply::Unauthorized, GraphReply::Unauthorized]);
        let p = read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW);
        assert_eq!(reasons(&p), vec![Some("graph-401")]);
    }

    #[test]
    fn token_failures_carry_their_reason() {
        let (store, core) = setup();
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![TokenReply::Transient("token-network".into())]);
        let g = FakeGraph::new(vec![]);
        let p = read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW);
        assert_eq!(p.accounts[0].state, "unavailable");
        assert_eq!(reasons(&p), vec![Some("token-network")]);
    }

    #[test]
    fn a_healthy_account_has_no_reason_and_the_payload_has_no_reason_key() {
        let (store, core) = setup();
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![ok_token("a", None)]);
        let g = FakeGraph::new(vec![GraphReply::Ok(body("A", "1"))]);
        let p = read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW);
        assert_eq!(reasons(&p), vec![None]);
        assert!(!serde_json::to_string(&p).unwrap().contains("reason"));
    }

    #[test]
    fn an_unwritable_store_reports_store_write() {
        let store = FlakySecrets { inner: Chunked(MemoryBlobs::default()), fail_set: Cell::new(false), fail_get: Cell::new(false) };
        store.set("work", "refresh-1");
        store.fail_set.set(true);
        let core = Mutex::new(Core::default());
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![ok_token("new", Some("refresh-2"))]);
        let g = FakeGraph::new(vec![]);
        let p = read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW);
        assert_eq!(reasons(&p), vec![Some("store-write")]);
    }

    #[test]
    fn a_failed_store_read_is_unavailable_with_store_read_and_keeps_the_token() {
        let store = FlakySecrets { inner: Chunked(MemoryBlobs::default()), fail_set: Cell::new(false), fail_get: Cell::new(false) };
        store.set("work", "refresh-1");
        store.fail_get.set(true);
        let core = Mutex::new(Core::default());
        core.lock().unwrap().cache.insert("work".into(), Cached { access: "c".into(), expires_at: NOW + 6000 });
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![]);
        let g = FakeGraph::new(vec![]);
        let p = read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW);
        assert_eq!(p.accounts[0].state, "unavailable");
        assert_eq!(reasons(&p), vec![Some("store-read")]);
        assert_eq!(t.calls.get() + g.calls.get(), 0);
        // Nothing was deleted: once reads work again the account reads normally.
        store.fail_get.set(false);
        assert_eq!(store.get("work").as_deref(), Some("refresh-1"));
        let g = FakeGraph::new(vec![GraphReply::Ok(body("A", "1"))]);
        let p = read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW + 5);
        assert_eq!(p.accounts[0].state, "ok");
    }

    #[test]
    fn a_missing_store_entry_is_signed_out_with_no_reason() {
        let store = Chunked(MemoryBlobs::default());
        let core = Mutex::new(Core::default());
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![]);
        let g = FakeGraph::new(vec![]);
        let p = read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW);
        assert_eq!(p.accounts[0].state, "signed-out");
        assert_eq!(reasons(&p), vec![None]);
    }

    #[test]
    fn a_log_line_is_queued_only_on_a_change() {
        let (store, core) = setup();
        let links = Mutex::new(Links::default());
        core.lock().unwrap().cache.insert("work".into(), Cached { access: "c".into(), expires_at: NOW + 6000 });
        let t = FakeTokens::new(vec![]);
        let g = FakeGraph::new(vec![
            GraphReply::Ok(body("A", "1")),
            GraphReply::Ok(body("A", "1")),
            GraphReply::Failed("graph-403-ErrorAccessDenied".into()),
            GraphReply::Failed("graph-403-ErrorAccessDenied".into()),
            GraphReply::Ok(body("A", "1")),
        ]);
        for n in 0..5 {
            read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW + n);
        }
        assert_eq!(
            core.lock().unwrap().log_lines,
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
        let (store, core) = setup();
        let links = Mutex::new(Links::default());
        core.lock().unwrap().cache.insert("work".into(), Cached { access: "c".into(), expires_at: NOW + 600 });
        let t = FakeTokens::new(vec![]);
        let g = FakeGraph::new(vec![GraphReply::Failed("graph-403-https://example.test/?a=b@c".into())]);
        let p = read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW);
        assert_eq!(reasons(&p), vec![None]);
        assert!(core.lock().unwrap().log_lines[0].ends_with(" none\n"));
    }

    // Section: blocking fakes. Each lets a test hold a read inside the network call.

    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Condvar, Mutex as StdMutex};
    use std::time::Duration;

    /// A door a fake network call waits at until the test opens it.
    #[derive(Default)]
    struct Gate {
        state: StdMutex<(bool, bool)>,
        cv: Condvar,
    }
    impl Gate {
        /// Called by the fake: say a call arrived, then wait for the door to open.
        fn pass(&self) {
            let mut st = self.state.lock().unwrap();
            st.0 = true;
            self.cv.notify_all();
            let (st, timeout) = self.cv.wait_timeout_while(st, Duration::from_secs(20), |s| !s.1).unwrap();
            drop(st);
            assert!(!timeout.timed_out(), "gate never opened");
        }
        /// Called by the test: wait until a call is inside the fake.
        fn wait_entered(&self) {
            let st = self.state.lock().unwrap();
            let (st, timeout) = self.cv.wait_timeout_while(st, Duration::from_secs(20), |s| !s.0).unwrap();
            drop(st);
            assert!(!timeout.timed_out(), "no call arrived");
        }
        fn open(&self) {
            self.state.lock().unwrap().1 = true;
            self.cv.notify_all();
        }
    }

    struct SyncTokens<'a> {
        replies: StdMutex<Vec<TokenReply>>,
        calls: AtomicUsize,
        gate: Option<&'a Gate>,
    }
    impl TokenClient for SyncTokens<'_> {
        fn post(&self, _tenant: &str, _form: &[(&str, &str)]) -> TokenReply {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if let Some(g) = self.gate {
                g.pass();
            }
            let mut r = self.replies.lock().unwrap();
            if r.is_empty() {
                TokenReply::Transient("token-503".into())
            } else {
                r.remove(0)
            }
        }
    }

    struct SyncGraph<'a> {
        replies: StdMutex<Vec<GraphReply>>,
        calls: AtomicUsize,
        seen_access: StdMutex<Vec<String>>,
        gate: Option<&'a Gate>,
    }
    impl<'a> SyncGraph<'a> {
        fn new(replies: Vec<GraphReply>, gate: Option<&'a Gate>) -> Self {
            SyncGraph { replies: StdMutex::new(replies), calls: AtomicUsize::new(0), seen_access: StdMutex::new(vec![]), gate }
        }
    }
    impl GraphClient for SyncGraph<'_> {
        fn calendar_view(&self, access: &str, _start: &str, _end: &str) -> GraphReply {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.seen_access.lock().unwrap().push(access.to_string());
            if let Some(g) = self.gate {
                g.pass();
            }
            let mut r = self.replies.lock().unwrap();
            if r.is_empty() {
                GraphReply::Transient("graph-503".into())
            } else {
                r.remove(0)
            }
        }
    }

    fn no_tokens() -> SyncTokens<'static> {
        SyncTokens { replies: StdMutex::new(vec![]), calls: AtomicUsize::new(0), gate: None }
    }

    #[test]
    fn sign_out_and_join_complete_while_a_read_is_blocked_in_graph() {
        let (store, core) = setup();
        let links = Mutex::new(Links::default());
        core.lock().unwrap().cache.insert("work".into(), Cached { access: "c".into(), expires_at: NOW + 6000 });
        // A first read puts a join key in the map and a last-good list in the core.
        let first = SyncGraph::new(vec![GraphReply::Ok(body("First", "f"))], None);
        read_next(&[acct("work")], &store, &no_tokens(), &first, &core, &links, NOW);
        let gate = Gate::default();
        let blocked = SyncGraph::new(vec![GraphReply::Ok(body("Second", "s"))], Some(&gate));
        let payload = std::thread::scope(|sc| {
            let h = sc.spawn(|| read_next(&[acct("work")], &store, &no_tokens(), &blocked, &core, &links, NOW + 10));
            gate.wait_entered();
            // The read is inside Graph. Both of these must finish with the gate still shut.
            assert!(lookup_link(&links, "1-0").unwrap().starts_with("https://teams.microsoft.com/"));
            sign_out("work", &store, &core, &links);
            gate.open();
            h.join().unwrap()
        });
        assert_eq!(store.get("work"), None);
        assert_eq!(payload.accounts[0].state, "signed-out");
        assert!(payload.meetings.is_empty());
        let c = core.lock().unwrap();
        assert!(c.cache.is_empty(), "a late read restored the access token");
        assert!(c.last.is_empty(), "a late read restored the last-good list");
        assert!(c.pending.is_empty());
        // Only the first read logged; the discarded one logged nothing.
        assert_eq!(c.log_lines.len(), 1);
    }

    #[test]
    fn sign_in_completes_while_a_read_is_blocked_and_the_late_read_changes_nothing() {
        let (store, core) = setup();
        let links = Mutex::new(Links::default());
        core.lock().unwrap().cache.insert("work".into(), Cached { access: "old".into(), expires_at: NOW + 6000 });
        let gate = Gate::default();
        let blocked = SyncGraph::new(vec![GraphReply::Ok(body("Stale", "s"))], Some(&gate));
        let granted = super::super::auth::Granted { code: "c".into(), verifier: "v".into(), redirect_uri: "http://localhost:1/auth-callback.html".into() };
        let payload = std::thread::scope(|sc| {
            let h = sc.spawn(|| read_next(&[acct("work")], &store, &no_tokens(), &blocked, &core, &links, NOW));
            gate.wait_entered();
            sign_out("work", &store, &core, &links);
            let t = FakeTokens::new(vec![ok_token("acc-new", Some("ref-new"))]);
            assert!(complete_sign_in(&acct("work"), &granted, &store, &t, &core, NOW + 1).is_ok());
            gate.open();
            h.join().unwrap()
        });
        assert!(payload.meetings.is_empty());
        assert_eq!(store.get("work").as_deref(), Some("ref-new"));
        let c = core.lock().unwrap();
        assert_eq!(c.cache.get("work").unwrap().access, "acc-new");
        assert!(c.last.is_empty(), "the read that began before the sign-in wrote its list");
        // The only line is the sign-in's own; the stale read recorded no state.
        assert_eq!(c.log_lines.len(), 1);
        assert!(c.log_lines[0].contains(" signed-in "));
    }

    #[test]
    fn sign_out_completes_while_a_read_is_blocked_in_the_token_request() {
        let (store, core) = setup();
        let links = Mutex::new(Links::default());
        let gate = Gate::default();
        let t = SyncTokens { replies: StdMutex::new(vec![ok_token("new", Some("refresh-2"))]), calls: AtomicUsize::new(0), gate: Some(&gate) };
        let g = SyncGraph::new(vec![GraphReply::Ok(body("A", "1"))], None);
        std::thread::scope(|sc| {
            let h = sc.spawn(|| read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW));
            gate.wait_entered();
            sign_out("work", &store, &core, &links);
            gate.open();
            h.join().unwrap();
        });
        // The rotated token and the access token of a signed-out account are not kept.
        assert_eq!(store.get("work"), None);
        let c = core.lock().unwrap();
        assert!(c.cache.is_empty() && c.pending.is_empty() && c.last.is_empty());
        assert_eq!(g.calls.load(Ordering::SeqCst), 0);
    }

    /// Wait until `n` holders have a handle on the account's turn lock (the core's own, the
    /// read inside the token request, and a read queued behind it).
    fn wait_for_turn_holders(core: &Mutex<Core>, id: &str, n: usize) {
        let until = std::time::Instant::now() + Duration::from_secs(20);
        loop {
            let held = core.lock().unwrap().flights.get(id).map(Arc::strong_count).unwrap_or(0);
            if held >= n {
                return;
            }
            assert!(std::time::Instant::now() < until, "second read never reached the turn lock");
            std::thread::sleep(Duration::from_millis(2));
        }
    }

    #[test]
    fn two_concurrent_reads_cause_one_refresh() {
        let (store, core) = setup();
        let links = Mutex::new(Links::default());
        let gate = Gate::default();
        let t = SyncTokens { replies: StdMutex::new(vec![ok_token("new", Some("refresh-2"))]), calls: AtomicUsize::new(0), gate: Some(&gate) };
        let g = SyncGraph::new(vec![GraphReply::Ok(body("A", "1")), GraphReply::Ok(body("A", "1"))], None);
        let (p1, p2) = std::thread::scope(|sc| {
            let h1 = sc.spawn(|| read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW));
            gate.wait_entered();
            let h2 = sc.spawn(|| read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW));
            // Rendezvous: the second read has passed its own look (no cache) and holds the
            // turn lock handle, queued behind the first, which is inside the token request.
            wait_for_turn_holders(&core, "work", 3);
            gate.open();
            (h1.join().unwrap(), h2.join().unwrap())
        });
        assert_eq!(t.calls.load(Ordering::SeqCst), 1, "the rotating refresh token was spent twice");
        assert_eq!(p1.accounts[0].state, "ok");
        assert_eq!(p2.accounts[0].state, "ok");
        assert_eq!(g.calls.load(Ordering::SeqCst), 2);
        assert_eq!(*g.seen_access.lock().unwrap(), vec!["new".to_string(), "new".to_string()]);
        assert_eq!(store.get("work").as_deref(), Some("refresh-2"));
    }

    /// Answers 401 to every call with the stale token, but only once two such calls are in
    /// flight at the same time; any other token gets a calendar.
    struct StaleThenFresh {
        both_stale: std::sync::Barrier,
        stale_calls: AtomicUsize,
        fresh_calls: AtomicUsize,
    }
    impl GraphClient for StaleThenFresh {
        fn calendar_view(&self, access: &str, _s: &str, _e: &str) -> GraphReply {
            if access == "stale" {
                self.stale_calls.fetch_add(1, Ordering::SeqCst);
                self.both_stale.wait();
                GraphReply::Unauthorized
            } else {
                self.fresh_calls.fetch_add(1, Ordering::SeqCst);
                GraphReply::Ok(body("A", "1"))
            }
        }
    }

    #[test]
    fn two_concurrent_401s_cause_one_forced_refresh() {
        let (store, core) = setup();
        let links = Mutex::new(Links::default());
        core.lock().unwrap().cache.insert("work".into(), Cached { access: "stale".into(), expires_at: NOW + 6000 });
        let t = SyncTokens { replies: StdMutex::new(vec![ok_token("fresh", None)]), calls: AtomicUsize::new(0), gate: None };
        let g = StaleThenFresh { both_stale: std::sync::Barrier::new(2), stale_calls: AtomicUsize::new(0), fresh_calls: AtomicUsize::new(0) };
        let (p1, p2) = std::thread::scope(|sc| {
            let h1 = sc.spawn(|| read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW));
            let h2 = sc.spawn(|| read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW));
            (h1.join().unwrap(), h2.join().unwrap())
        });
        assert_eq!(p1.accounts[0].state, "ok");
        assert_eq!(p2.accounts[0].state, "ok");
        assert_eq!(g.stale_calls.load(Ordering::SeqCst), 2);
        assert_eq!(t.calls.load(Ordering::SeqCst), 1, "the forced refresh ran twice");
        assert_eq!(g.fresh_calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn a_day_read_that_finishes_after_sign_out_changes_nothing() {
        let (store, core) = setup();
        let links = Mutex::new(Links::default());
        core.lock().unwrap().cache.insert("work".into(), Cached { access: "c".into(), expires_at: NOW + 6000 });
        let gate = Gate::default();
        let g = SyncGraph::new(vec![GraphReply::Ok(body("Late", "l"))], Some(&gate));
        let (from, to) = (NOW - 3600, NOW + 3600);
        let payload = std::thread::scope(|sc| {
            let h = sc.spawn(|| read_day(&[acct("work")], &store, &no_tokens(), &g, &core, &links, NOW, from, to));
            gate.wait_entered();
            sign_out("work", &store, &core, &links);
            gate.open();
            h.join().unwrap()
        });
        assert_eq!(payload.accounts[0].state, "signed-out");
        assert!(payload.events.is_empty());
        assert!(lookup_link(&links, "d1-0").is_none());
        let c = core.lock().unwrap();
        assert!(c.cache.is_empty() && c.log_lines.is_empty());
    }

    /// A secret store that can be shared across threads, with writes that can be switched off.
    struct SyncFlaky {
        inner: Chunked<MemoryBlobs>,
        fail_set: std::sync::atomic::AtomicBool,
    }
    impl SecretStore for SyncFlaky {
        fn fetch(&self, id: &str) -> Fetch<String> {
            self.inner.fetch(id)
        }
        fn set(&self, id: &str, value: &str) -> bool {
            !self.fail_set.load(Ordering::SeqCst) && self.inner.set(id, value)
        }
        fn delete(&self, id: &str) {
            self.inner.delete(id)
        }
    }

    fn sync_flaky(fail_set: bool) -> SyncFlaky {
        let s = SyncFlaky { inner: Chunked(MemoryBlobs::default()), fail_set: std::sync::atomic::AtomicBool::new(false) };
        s.set("work", "refresh-1");
        s.fail_set.store(fail_set, Ordering::SeqCst);
        s
    }

    /// Both accounts have a valid cached token and a first read has published their links.
    fn two_accounts_with_links() -> (Chunked<MemoryBlobs>, Mutex<Core>, Mutex<Links>, MeetPayload) {
        let store = Chunked(MemoryBlobs::default());
        store.set("work", "r1");
        store.set("second", "r2");
        let core = Mutex::new(Core::default());
        {
            let mut c = core.lock().unwrap();
            c.cache.insert("work".into(), Cached { access: "ca".into(), expires_at: NOW + 6000 });
            c.cache.insert("second".into(), Cached { access: "cb".into(), expires_at: NOW + 6000 });
        }
        let links = Mutex::new(Links::default());
        let g = ByAccess { gate: None, bodies: vec![("ca".into(), body("Work one", "w1")), ("cb".into(), body("Second one", "s1"))] };
        let p = read_next(&[acct("work"), acct("second")], &store, &no_tokens(), &g, &core, &links, NOW);
        assert_eq!(p.meetings.len(), 2);
        (store, core, links, p)
    }

    /// Calendar by access token; the call for one token can be held at a gate.
    struct ByAccess<'a> {
        gate: Option<(&'a str, &'a Gate)>,
        bodies: Vec<(String, Value)>,
    }
    impl GraphClient for ByAccess<'_> {
        fn calendar_view(&self, access: &str, _s: &str, _e: &str) -> GraphReply {
            if let Some((who, gate)) = self.gate {
                if who == access {
                    gate.pass();
                }
            }
            match self.bodies.iter().find(|(a, _)| a == access) {
                Some((_, b)) => GraphReply::Ok(b.clone()),
                None => GraphReply::Failed("graph-400".into()),
            }
        }
    }

    #[test]
    fn a_read_blocked_on_a_second_account_cannot_publish_a_signed_out_accounts_meetings() {
        let (store, core, links, first) = two_accounts_with_links();
        let old_work = first.meetings.iter().find(|m| m.account_id == "work").unwrap().key.clone();
        let old_second = first.meetings.iter().find(|m| m.account_id == "second").unwrap().key.clone();
        let gate = Gate::default();
        // The work account's read finishes at once; the second account's is held in Graph.
        let g = ByAccess { gate: Some(("cb", &gate)), bodies: vec![("ca".into(), body("Work one", "w1")), ("cb".into(), body("Second one", "s1"))] };
        let payload = std::thread::scope(|sc| {
            let h = sc.spawn(|| read_next(&[acct("work"), acct("second")], &store, &no_tokens(), &g, &core, &links, NOW + 10));
            gate.wait_entered();
            sign_out("work", &store, &core, &links);
            // Links already published stop working at once, before the held read returns.
            assert!(lookup_link(&links, &old_work).is_none());
            gate.open();
            h.join().unwrap()
        });
        assert!(payload.meetings.iter().all(|m| m.account_id != "work"), "a signed-out account was listed");
        assert_eq!(payload.meetings.len(), 1);
        assert_eq!(payload.accounts[0].state, "signed-out");
        assert_eq!(payload.accounts[1].state, "ok");
        // Neither the old key nor any key of the new map reaches the signed-out account.
        assert!(lookup_link(&links, &old_work).is_none());
        let guard = links.lock().unwrap();
        assert!(guard.map.values().all(|(account, _)| account != "work"));
        assert_eq!(guard.map.len(), 1);
        drop(guard);
        assert!(lookup_link(&links, &payload.meetings[0].key).is_some());
        assert!(lookup_link(&links, &old_second).is_none(), "the old map is replaced by the new read");
    }

    #[test]
    fn a_day_read_blocked_on_a_second_account_cannot_publish_a_signed_out_accounts_events() {
        let (store, core, links, _) = two_accounts_with_links();
        let (from, to) = (NOW - 3600, NOW + 7200);
        let bodies = vec![("ca".to_string(), body("Work one", "w1")), ("cb".to_string(), body("Second one", "s1"))];
        let first = read_day(&[acct("work"), acct("second")], &store, &no_tokens(), &ByAccess { gate: None, bodies: bodies.clone() }, &core, &links, NOW, from, to);
        let old_work = first.events.iter().find(|e| e.account_id == "work").unwrap().key.clone();
        assert!(lookup_link(&links, &old_work).is_some());
        let gate = Gate::default();
        let g = ByAccess { gate: Some(("cb", &gate)), bodies };
        let payload = std::thread::scope(|sc| {
            let h = sc.spawn(|| read_day(&[acct("work"), acct("second")], &store, &no_tokens(), &g, &core, &links, NOW + 10, from, to));
            gate.wait_entered();
            sign_out("work", &store, &core, &links);
            assert!(lookup_link(&links, &old_work).is_none());
            gate.open();
            h.join().unwrap()
        });
        assert!(payload.events.iter().all(|e| e.account_id != "work"));
        assert_eq!(payload.events.len(), 1);
        assert_eq!(payload.accounts[0].state, "signed-out");
        let guard = links.lock().unwrap();
        assert!(guard.day_map.values().all(|(account, _)| account != "work"));
        drop(guard);
        assert!(lookup_link(&links, &old_work).is_none());
        assert!(lookup_link(&links, &payload.events[0].key).is_some());
    }

    #[test]
    fn a_discarded_read_after_a_new_sign_in_reports_ok_stale_with_the_last_good_list() {
        let (store, core) = setup();
        let links = Mutex::new(Links::default());
        core.lock().unwrap().cache.insert("work".into(), Cached { access: "c".into(), expires_at: NOW + 6000 });
        // A good read leaves a last-good list.
        let first = SyncGraph::new(vec![GraphReply::Ok(body("Kept", "k"))], None);
        read_next(&[acct("work")], &store, &no_tokens(), &first, &core, &links, NOW);
        let gate = Gate::default();
        let blocked = SyncGraph::new(vec![GraphReply::Ok(body("Late", "l"))], Some(&gate));
        let granted = super::super::auth::Granted { code: "c".into(), verifier: "v".into(), redirect_uri: "http://localhost:1/auth-callback.html".into() };
        let payload = std::thread::scope(|sc| {
            let h = sc.spawn(|| read_next(&[acct("work")], &store, &no_tokens(), &blocked, &core, &links, NOW + 10));
            gate.wait_entered();
            // A new sign-in (no sign-out) changes the generation but leaves the last list.
            let t = FakeTokens::new(vec![ok_token("acc-new", Some("ref-new"))]);
            assert!(complete_sign_in(&acct("work"), &granted, &store, &t, &core, NOW + 11).is_ok());
            gate.open();
            h.join().unwrap()
        });
        assert_eq!(payload.accounts[0].state, "ok", "a discarded read must not flash unavailable");
        assert!(payload.stale);
        assert_eq!(payload.meetings.len(), 1);
        assert_eq!(payload.meetings[0].title, "Kept");
    }

    #[test]
    fn a_stale_read_never_rewrites_the_store_with_a_rotated_token() {
        let (store, core) = setup();
        let links = Mutex::new(Links::default());
        let gate = Gate::default();
        let t = SyncTokens { replies: StdMutex::new(vec![ok_token("new", Some("refresh-2"))]), calls: AtomicUsize::new(0), gate: Some(&gate) };
        let g = SyncGraph::new(vec![], None);
        std::thread::scope(|sc| {
            let h = sc.spawn(|| read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW));
            gate.wait_entered();
            sign_out("work", &store, &core, &links);
            gate.open();
            h.join().unwrap();
        });
        // The signed-out account's token stays deleted; the reply's rotated token is dropped.
        assert_eq!(store.get("work"), None);
        let c = core.lock().unwrap();
        assert!(c.pending.is_empty() && c.cache.is_empty());
    }

    #[test]
    fn a_failed_store_write_racing_sign_out_leaves_no_pending_token() {
        let store = sync_flaky(false);
        let core = Mutex::new(Core::default());
        let links = Mutex::new(Links::default());
        let gate = Gate::default();
        let t = SyncTokens { replies: StdMutex::new(vec![ok_token("new", Some("refresh-2"))]), calls: AtomicUsize::new(0), gate: Some(&gate) };
        let g = SyncGraph::new(vec![], None);
        std::thread::scope(|sc| {
            let h = sc.spawn(|| read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW));
            gate.wait_entered();
            // Writes start failing, and the account signs out, while the request is out.
            store.fail_set.store(true, Ordering::SeqCst);
            sign_out("work", &store, &core, &links);
            gate.open();
            h.join().unwrap();
        });
        assert_eq!(store.inner.get("work"), None);
        let c = core.lock().unwrap();
        assert!(c.pending.is_empty(), "a stale read parked a rotated token");
        assert!(c.cache.is_empty());
    }

    #[test]
    fn a_reader_queued_on_the_turn_lock_when_sign_out_happens_neither_refreshes_nor_writes() {
        let (store, core) = setup();
        let links = Mutex::new(Links::default());
        let gate = Gate::default();
        let t = SyncTokens { replies: StdMutex::new(vec![ok_token("new", Some("refresh-2")), ok_token("newer", Some("refresh-3"))]), calls: AtomicUsize::new(0), gate: Some(&gate) };
        let g = SyncGraph::new(vec![], None);
        let (p1, p2) = std::thread::scope(|sc| {
            let h1 = sc.spawn(|| read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW));
            gate.wait_entered();
            let h2 = sc.spawn(|| read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW));
            wait_for_turn_holders(&core, "work", 3);
            sign_out("work", &store, &core, &links);
            gate.open();
            (h1.join().unwrap(), h2.join().unwrap())
        });
        assert_eq!(t.calls.load(Ordering::SeqCst), 1, "the queued reader spent a refresh token after sign-out");
        assert_eq!(store.get("work"), None);
        assert_eq!(g.calls.load(Ordering::SeqCst), 0);
        assert_eq!(p1.accounts[0].state, "signed-out");
        assert_eq!(p2.accounts[0].state, "signed-out");
        let c = core.lock().unwrap();
        assert!(c.cache.is_empty() && c.pending.is_empty() && c.last.is_empty());
    }

    // Section: bounded reads, one account at a time, and the log details

    struct PerAccessGraph<'a> {
        gate: &'a Gate,
        slow_access: &'a str,
    }
    impl GraphClient for PerAccessGraph<'_> {
        fn calendar_view(&self, access: &str, _s: &str, _e: &str) -> GraphReply {
            if access == self.slow_access {
                self.gate.pass();
            }
            GraphReply::Ok(body("Fast meeting", access))
        }
    }

    #[test]
    fn a_blocked_account_does_not_hold_up_the_other_ones_meetings() {
        let store = Chunked(MemoryBlobs::default());
        store.set("slow", "r1");
        store.set("fast", "r2");
        let core = Mutex::new(Core::default());
        let links = Mutex::new(Links::default());
        core.lock().unwrap().cache.insert("slow".into(), Cached { access: "s".into(), expires_at: NOW + 6000 });
        core.lock().unwrap().cache.insert("fast".into(), Cached { access: "f".into(), expires_at: NOW + 6000 });
        let accounts = [acct("slow"), acct("fast")];
        let gate = Gate::default();
        let graph = PerAccessGraph { gate: &gate, slow_access: "s" };
        std::thread::scope(|sc| {
            let slow = sc.spawn(|| read_next_only(&accounts, &store, &no_tokens(), &graph, &core, &links, NOW, Only::One("slow")));
            gate.wait_entered();
            // The slow account is stuck in Graph. The fast one answers anyway.
            let p = read_next_only(&accounts, &store, &no_tokens(), &graph, &core, &links, NOW, Only::One("fast"));
            assert_eq!(p.meetings.len(), 1);
            assert_eq!(p.meetings[0].account_id, "fast");
            assert_eq!(p.accounts[0].state, "checking");
            assert_eq!(p.accounts[1].state, "ok");
            gate.open();
            let late = slow.join().unwrap();
            assert!(late.seq > p.seq);
            assert_eq!(late.accounts[0].state, "ok");
            // The later answer still carries the fast account's meeting.
            assert_eq!(late.meetings.len(), 2);
        });
    }

    #[test]
    fn peek_goes_nowhere_and_reports_checking_then_the_held_state() {
        let (store, core) = setup();
        let links = Mutex::new(Links::default());
        let g = FakeGraph::new(vec![]);
        let t = FakeTokens::new(vec![]);
        let first = read_next_only(&[acct("work")], &store, &t, &g, &core, &links, NOW, Only::Nobody);
        assert_eq!(first.accounts[0].state, "checking");
        assert_eq!(g.calls.get(), 0);
        assert_eq!(t.calls.get(), 0);
        core.lock().unwrap().cache.insert("work".into(), Cached { access: "c".into(), expires_at: NOW + 6000 });
        let g = FakeGraph::new(vec![GraphReply::Ok(body("Kept", "k"))]);
        read_next(&[acct("work")], &store, &t, &g, &core, &links, NOW);
        let peek = read_next_only(&[acct("work")], &store, &t, &g, &core, &links, NOW + 5, Only::Nobody);
        assert_eq!(peek.accounts[0].state, "ok");
        assert_eq!(peek.meetings.len(), 1);
        assert_eq!(g.calls.get(), 1);
    }

    struct DiagGraph;
    impl GraphClient for DiagGraph {
        fn calendar_view(&self, _a: &str, _s: &str, _e: &str) -> GraphReply {
            GraphReply::Transient("graph-503-UnknownError".into())
        }
        fn calendar_view_diag(&self, a: &str, s: &str, e: &str, ctx: &Ctx) -> (GraphReply, Option<Diag>) {
            let diag = Diag {
                kind: ctx.kind,
                status: 503,
                code: Some("UnknownError".into()),
                inner: None,
                request_id: Some("11111111-2222-3333-4444-555555555555".into()),
                client_request_id: Some("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee".into()),
                attempt: 3,
                elapsed_ms: 4210,
            };
            (self.calendar_view(a, s, e), Some(diag))
        }
    }

    #[test]
    fn a_graph_failure_logs_the_details_on_every_failure_and_only_the_listed_fields() {
        let (store, core) = setup();
        let links = Mutex::new(Links::default());
        core.lock().unwrap().cache.insert("work".into(), Cached { access: "c".into(), expires_at: NOW + 6000 });
        let t = FakeTokens::new(vec![]);
        read_next(&[acct("work")], &store, &t, &DiagGraph, &core, &links, NOW);
        read_day(&[acct("work")], &store, &t, &DiagGraph, &core, &links, NOW + 1, NOW, NOW + 3600);
        let lines = std::mem::take(&mut core.lock().unwrap().log_lines);
        assert_eq!(lines.len(), 2, "{lines:?}");
        let first = lines[0].trim_end();
        assert!(first.starts_with("2026-11-12T"));
        let fields: Vec<&str> = first.split(' ').collect();
        let keys: Vec<&str> = fields[5..].iter().map(|f| f.split('=').next().unwrap()).collect();
        assert_eq!(keys, ["req", "status", "code", "inner", "request-id", "client-request-id", "attempt", "ms"]);
        assert_eq!(&fields[1..5], ["work", "start", "unavailable", "graph-503-UnknownError"]);
        assert!(first.contains("req=next status=503 code=UnknownError inner=none"));
        assert!(first.contains("attempt=3 ms=4210"));
        assert!(lines[1].contains("req=day"));
        assert!(lines.iter().all(|l| l.len() <= 400 && l.matches('\n').count() == 1));
    }

    #[test]
    fn a_day_read_for_one_account_answers_the_other_from_its_held_events() {
        let store = Chunked(MemoryBlobs::default());
        store.set("work", "r1");
        store.set("second", "r2");
        let core = Mutex::new(Core::default());
        let links = Mutex::new(Links::default());
        let t = FakeTokens::new(vec![ok_token("a", None), ok_token("b", None)]);
        let g = FakeGraph::new(vec![GraphReply::Ok(body("One", "1")), GraphReply::Ok(body("Two", "2"))]);
        let both = [acct("work"), acct("second")];
        read_day(&both, &store, &t, &g, &core, &links, NOW, NOW, NOW + 3600);
        let g = FakeGraph::new(vec![GraphReply::Ok(body("One again", "1"))]);
        let p = read_day_only(&both, &store, &t, &g, &core, &links, NOW + 5, NOW, NOW + 3600, Only::One("work"));
        assert_eq!(g.calls.get(), 1);
        assert_eq!(p.events.len(), 2);
    }
}
