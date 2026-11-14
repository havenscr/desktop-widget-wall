//! YouTube sign-in for Wall 2 (the read-only scope). Google's client id and secret and the
//! refresh token live in Windows Credential Manager, the access token in memory only, and
//! nothing but a fixed status word ever reaches the web view. The library and playback arrive
//! in later changes; this module only signs in, signs out and keeps the setup.
//!
//! Everything before the `commands` marker is plain Rust over the `Http` and `Creds` traits,
//! so every path runs with fakes. The marker splits off the thin Tauri layer.

use crate::wall2_meet::store::{BlobStore, CredBlobs, Fetch, CHUNK, MAX_CHUNKS};
use serde::Serialize;
use serde_json::{json, Value};
use std::fmt;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

const NOT_SETUP: &str = "not set up";
const SIGN_AGAIN: &str = "sign in again";
const SIGN_OUT_FIRST: &str = "sign out first";
const SETUP_BROKEN: &str = "setup broken";
const INVALID: &str = "invalid";
const FAILED: &str = "failed";
const BUSY: &str = "busy";
const DOWN: &str = "down";
const DENIED: &str = "denied";
const CANCELLED: &str = "cancelled";
const TIMED_OUT: &str = "timed-out";

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
const SCOPE: &str = "https://www.googleapis.com/auth/youtube.readonly";
const CALLBACK: &str = "/callback";
const SIGN_IN_WAIT: Duration = Duration::from_secs(300);
const TOKEN_TIMEOUT: Duration = Duration::from_secs(6);
const REVOKE_TIMEOUT: Duration = Duration::from_secs(5);
const TOKEN_BODY: u64 = 64 * 1024;
const ERROR_BODY: u64 = 16 * 1024;
const FILE_MAX: usize = 4096;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> { m.lock().unwrap_or_else(|e| e.into_inner()) }

// ---- the client (id and secret) -------------------------------------------------------------

/// Google's OAuth client id and secret. No `Debug` output, no `Serialize`: never inside an
/// error string, a log line or an event.
#[derive(Clone, PartialEq)]
struct Client { id: String, secret: String }
impl fmt::Debug for Client { fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { f.write_str("Client(<hidden>)") } }

/// `^[0-9]{6,20}-[a-z0-9]{20,64}\.apps\.googleusercontent\.com$`, at most 120 bytes.
fn valid_client_id(id: &str) -> bool {
    if id.len() > 120 { return false }
    let Some(rest) = id.strip_suffix(".apps.googleusercontent.com") else { return false };
    let Some((digits, name)) = rest.split_once('-') else { return false };
    (6..=20).contains(&digits.len()) && digits.bytes().all(|b| b.is_ascii_digit())
        && (20..=64).contains(&name.len()) && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

/// `^[A-Za-z0-9_-]{20,64}$`.
fn valid_secret(secret: &str) -> bool {
    (20..=64).contains(&secret.len()) && secret.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
}

/// Trim, check the lengths, then the patterns.
fn check_client(id: &str, secret: &str) -> Option<Client> {
    let (id, secret) = (id.trim(), secret.trim());
    if id.len() > 120 || secret.len() > 64 { return None }
    (valid_client_id(id) && valid_secret(secret)).then(|| Client { id: id.to_string(), secret: secret.to_string() })
}

/// Google's downloaded file (`installed`) or the wall's own shape, reading only the two named
/// fields. A `web` client is refused. Every other field, endpoints included, is ignored.
fn parse_client_file(bytes: &[u8]) -> Option<Client> {
    if bytes.len() > FILE_MAX { return None }
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    let value: Value = serde_json::from_str(std::str::from_utf8(bytes).ok()?).ok()?;
    let top = value.as_object()?;
    if top.contains_key("web") { return None }
    let source = match top.get("installed") { Some(inner) => inner.as_object()?, None => top };
    let pick = |a: &str, b: &str| source.get(a).or_else(|| source.get(b)).and_then(Value::as_str);
    check_client(pick("client_id", "clientId")?, pick("client_secret", "clientSecret")?)
}

fn read_client_file(path: &std::path::Path) -> Option<Client> {
    let mut bytes = Vec::new();
    std::fs::File::open(path).ok()?.take(FILE_MAX as u64 + 1).read_to_end(&mut bytes).ok()?;
    parse_client_file(&bytes)
}

/// The blob kept in Credential Manager, built by `serde_json`, never by string formatting.
fn client_blob(client: &Client) -> String { json!({ "clientId": client.id, "clientSecret": client.secret }).to_string() }

fn parse_client_blob(text: &str) -> Option<Client> {
    let value: Value = serde_json::from_str(text).ok()?;
    check_client(value.get("clientId")?.as_str()?, value.get("clientSecret")?.as_str()?)
}

// ---- credentials and HTTP seams -------------------------------------------------------------

trait Creds: Send + Sync {
    fn load(&self) -> Result<Option<String>, &'static str>;
    fn save(&self, value: &str) -> bool;
    fn delete(&self);
    fn delete_if_equal(&self, expected: &str) { if self.load().ok().flatten().as_deref() == Some(expected) { self.delete(); } }
    fn load_client(&self) -> Fetch<String>;
    fn save_client(&self, blob: &str) -> bool;
    fn delete_client(&self);
}

fn refresh_target(n: usize) -> String { crate::wall2_oauth::credential_target("youtube", "refresh", n) }
fn client_target() -> String { crate::wall2_oauth::credential_target("youtube", "client", 0) }

struct RealCreds;
impl Creds for RealCreds {
    fn load(&self) -> Result<Option<String>, &'static str> {
        let mut bytes = Vec::new();
        for n in 0..MAX_CHUNKS {
            match CredBlobs.read(&refresh_target(n)) {
                Fetch::Found(v) => bytes.extend(v),
                Fetch::Missing if n == 0 => return Ok(None),
                Fetch::Missing => break,
                Fetch::Failed => return Err(FAILED),
            }
        }
        String::from_utf8(bytes).map(Some).map_err(|_| FAILED)
    }
    fn save(&self, value: &str) -> bool {
        if value.len() > CHUNK * MAX_CHUNKS { return false }
        for (n, part) in value.as_bytes().chunks(CHUNK).enumerate() {
            if !CredBlobs.write(&refresh_target(n), part) { return false }
        }
        let used = value.as_bytes().chunks(CHUNK).count();
        for n in used..MAX_CHUNKS { CredBlobs.remove(&refresh_target(n)) }
        true
    }
    fn delete(&self) { for n in 0..MAX_CHUNKS { CredBlobs.remove(&refresh_target(n)) } }
    fn load_client(&self) -> Fetch<String> {
        match CredBlobs.read(&client_target()) {
            Fetch::Found(v) => String::from_utf8(v).map_or(Fetch::Failed, Fetch::Found),
            Fetch::Missing => Fetch::Missing,
            Fetch::Failed => Fetch::Failed,
        }
    }
    fn save_client(&self, blob: &str) -> bool { CredBlobs.write(&client_target(), blob.as_bytes()) }
    fn delete_client(&self) { CredBlobs.remove(&client_target()) }
}

/// What came back, with the body (which may carry tokens) never printed.
struct HttpReply { status: u16, body: Vec<u8> }
impl fmt::Debug for HttpReply {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { write!(f, "HttpReply({}, {} bytes)", self.status, self.body.len()) }
}

trait Http: Send + Sync {
    /// One form POST to a fixed address, with a time limit. `Err` is a network failure.
    fn post_form(&self, url: &str, form: &[(&str, &str)], timeout: Duration) -> Result<HttpReply, ()>;
}

fn read_limited(reader: &mut dyn Read, limit: u64) -> Result<Vec<u8>, &'static str> {
    let mut out = Vec::new();
    reader.take(limit + 1).read_to_end(&mut out).map_err(|_| DOWN)?;
    if out.len() as u64 > limit { Err(DOWN) } else { Ok(out) }
}

// ---- tokens ---------------------------------------------------------------------------------

struct Token { access: String, expires: Instant }
static TOKEN: Mutex<Option<Token>> = Mutex::new(None);
static REFRESH: Mutex<()> = Mutex::new(());
static CLIENT: Mutex<()> = Mutex::new(());
/// Why the last sign-in or refresh went wrong, as a fixed word, until the next success or sign-out.
static NOTE: Mutex<Option<&'static str>> = Mutex::new(None);
static SIGNING_IN: AtomicBool = AtomicBool::new(false);
static CANCEL_SIGN_IN: AtomicBool = AtomicBool::new(false);

fn set_note(word: Option<&'static str>) { *lock(&NOTE) = word; }
/// Forget the access token and the note (the caches of the later reads are cleared here too).
fn reset_session() { *lock(&TOKEN) = None; set_note(None); }

#[derive(PartialEq)]
enum TokenReply {
    Ok { access: String, seconds: u64, refresh: Option<String>, scope: Option<String> },
    /// 400 `invalid_grant`: the grant is dead.
    InvalidGrant,
    /// 400 or 401 `invalid_client` or `unauthorized_client`: only a new setup can fix it.
    SetupBroken,
    Busy,
    Down,
}
impl fmt::Debug for TokenReply {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self { Self::Ok { .. } => "Ok(<hidden>)", Self::InvalidGrant => "InvalidGrant", Self::SetupBroken => "SetupBroken", Self::Busy => "Busy", Self::Down => "Down" })
    }
}

fn oauth_error(body: &[u8]) -> Option<String> {
    serde_json::from_slice::<Value>(body).ok()?.get("error")?.as_str().map(str::to_string)
}

fn token_reply(result: Result<HttpReply, ()>) -> TokenReply {
    let Ok(reply) = result else { return TokenReply::Down };
    match reply.status {
        200..=299 => {
            let Ok(v) = serde_json::from_slice::<Value>(&reply.body) else { return TokenReply::Down };
            let Some(access) = v.get("access_token").and_then(Value::as_str).filter(|s| !s.is_empty()) else { return TokenReply::Down };
            TokenReply::Ok {
                access: access.to_string(),
                seconds: v.get("expires_in").and_then(Value::as_u64).unwrap_or(3600).clamp(1, 86_400),
                refresh: v.get("refresh_token").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string),
                scope: v.get("scope").and_then(Value::as_str).map(str::to_string),
            }
        }
        400 | 401 => match oauth_error(&reply.body).as_deref() {
            Some("invalid_grant") if reply.status == 400 => TokenReply::InvalidGrant,
            Some("invalid_client" | "unauthorized_client") => TokenReply::SetupBroken,
            _ => TokenReply::Down,
        },
        429 => TokenReply::Busy,
        _ => TokenReply::Down,
    }
}

fn exchange(http: &dyn Http, client: &Client, redirect: &str, code: &str, verifier: &str) -> TokenReply {
    token_reply(http.post_form(TOKEN_URL, &[
        ("client_id", client.id.as_str()), ("client_secret", client.secret.as_str()), ("code", code),
        ("code_verifier", verifier), ("grant_type", "authorization_code"), ("redirect_uri", redirect),
    ], TOKEN_TIMEOUT))
}

fn refresh(http: &dyn Http, client: &Client, refresh_value: &str) -> TokenReply {
    token_reply(http.post_form(TOKEN_URL, &[
        ("client_id", client.id.as_str()), ("client_secret", client.secret.as_str()),
        ("grant_type", "refresh_token"), ("refresh_token", refresh_value),
    ], TOKEN_TIMEOUT))
}

/// Ask Google to forget a grant. True only when it answered 2xx; the caller clears locally either way.
fn revoke(http: &dyn Http, token: &str) -> bool {
    let done = matches!(http.post_form(REVOKE_URL, &[("token", token)], REVOKE_TIMEOUT), Ok(r) if (200..300).contains(&r.status));
    if !done { crate::wall2_youtube_log::write(crate::wall2_youtube_log::Event::RevokeFailed, crate::wall2_youtube_log::Reason::Failed, 0, 0); }
    done
}

/// A fresh access token for the reads of a later change: the one in memory while over 60 s
/// remain, otherwise one refresh under the lock. Only `invalid_grant` deletes the stored token,
/// and only if it is still the one that was tried; a refused client deletes nothing.
#[allow(dead_code)]
fn access_with(client: &Client, force: bool, http: &dyn Http, creds: &dyn Creds) -> Result<String, &'static str> {
    let fresh = |t: &Option<Token>| t.as_ref().filter(|t| t.expires > Instant::now() + Duration::from_secs(60)).map(|t| t.access.clone());
    if !force { if let Some(a) = fresh(&lock(&TOKEN)) { return Ok(a) } }
    let _guard = lock(&REFRESH);
    if !force { if let Some(a) = fresh(&lock(&TOKEN)) { return Ok(a) } }
    let stored = creds.load().map_err(|_| SIGN_AGAIN)?.ok_or(SIGN_AGAIN)?;
    let started = Instant::now();
    use crate::wall2_youtube_log::{write, Event, Reason};
    match refresh(http, client, &stored) {
        TokenReply::Ok { access, seconds, refresh: replacement, .. } => {
            if let Some(v) = replacement { if !creds.save(&v) { return Err(FAILED) } }
            *lock(&TOKEN) = Some(Token { access: access.clone(), expires: Instant::now() + Duration::from_secs(seconds) });
            set_note(None);
            write(Event::RefreshOk, Reason::None, 200, started.elapsed().as_millis());
            Ok(access)
        }
        TokenReply::InvalidGrant => {
            creds.delete_if_equal(&stored);
            *lock(&TOKEN) = None;
            set_note(Some(SIGN_AGAIN));
            write(Event::RefreshRefused, Reason::SignInAgain, 400, started.elapsed().as_millis());
            Err(SIGN_AGAIN)
        }
        TokenReply::SetupBroken => {
            set_note(Some(SETUP_BROKEN));
            write(Event::RefreshRefused, Reason::SetupBroken, 400, started.elapsed().as_millis());
            Err(SETUP_BROKEN)
        }
        TokenReply::Busy => { write(Event::RefreshFailed, Reason::Busy, 429, started.elapsed().as_millis()); Err(BUSY) }
        TokenReply::Down => { write(Event::RefreshFailed, Reason::Down, 0, started.elapsed().as_millis()); Err(DOWN) }
    }
}

// ---- which client is in use -----------------------------------------------------------------

/// A client stored through the form wins; `youtube.json` is read only when none is stored.
fn resolve_client(creds: &dyn Creds, file: impl FnOnce() -> Option<Client>) -> Result<Client, &'static str> {
    match creds.load_client() {
        Fetch::Found(blob) => { if let Some(client) = parse_client_blob(&blob) { return Ok(client) } }
        Fetch::Missing => {}
        Fetch::Failed => return Err(FAILED),
    }
    file().ok_or(NOT_SETUP)
}

/// The client may change only while signed out and no sign-in runs (the rule lives here, not on the page).
fn changeable(creds: &dyn Creds) -> Result<(), &'static str> {
    if SIGNING_IN.load(Ordering::SeqCst) { return Err(SIGN_OUT_FIRST) }
    match creds.load() { Ok(None) => Ok(()), Ok(Some(_)) => Err(SIGN_OUT_FIRST), Err(_) => Err(FAILED) }
}

fn set_client_with(creds: &dyn Creds, id: &str, secret: &str) -> Result<(), &'static str> {
    let client = check_client(id, secret).ok_or(INVALID)?;
    let _guard = lock(&CLIENT);
    changeable(creds)?;
    if !creds.save_client(&client_blob(&client)) { return Err(FAILED) }
    reset_session();
    crate::wall2_youtube_log::write(crate::wall2_youtube_log::Event::ClientSaved, crate::wall2_youtube_log::Reason::None, 0, 0);
    Ok(())
}

fn forget_client_with(creds: &dyn Creds) -> Result<(), &'static str> {
    let _guard = lock(&CLIENT);
    changeable(creds)?;
    creds.delete_client();
    reset_session();
    crate::wall2_youtube_log::write(crate::wall2_youtube_log::Event::ClientForgotten, crate::wall2_youtube_log::Reason::None, 0, 0);
    Ok(())
}

// ---- status ---------------------------------------------------------------------------------

/// All the page ever learns: whether a client is set up, whether a sign-in is stored, and one
/// fixed word. `searchesLeft` is for the search of a later change and is always empty for now.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status { setup: bool, signed_in: bool, reason: Option<String>, searches_left: Option<u32> }

fn status_with(creds: &dyn Creds, file: impl FnOnce() -> Option<Client>) -> Status {
    let status = |setup: bool, signed_in: bool, reason: Option<&str>| Status { setup, signed_in, reason: reason.map(str::to_string), searches_left: None };
    match resolve_client(creds, file) {
        Err(word) => return status(false, false, Some(word)),
        Ok(_) => {}
    }
    let note = *lock(&NOTE);
    match creds.load() {
        Ok(Some(_)) => status(true, true, note),
        Ok(None) => status(true, false, note),
        Err(_) => status(true, false, Some(FAILED)),
    }
}

// ---- sign-in --------------------------------------------------------------------------------

/// The three one-time values of one sign-in. Never logged, never sent to the page.
struct Pkce { verifier: String, challenge: String, state: String }

fn authorize_url(client_id: &str, redirect: &str, challenge: &str, state: &str) -> String {
    use urlencoding::encode;
    format!(
        "{AUTH_URL}?client_id={}&redirect_uri={}&response_type=code&scope={}&code_challenge={}&code_challenge_method=S256&state={}&prompt={}&access_type=offline",
        encode(client_id), encode(redirect), encode(SCOPE), encode(challenge), encode(state), encode("select_account consent"),
    )
}

/// Wait for the one valid callback, then drop the listener at once: it is not open while the
/// code is exchanged.
fn listen_for_code(server: tiny_http::Server, state: &str, wait: Duration, cancelled: impl Fn() -> bool) -> Result<String, &'static str> {
    crate::wall2_oauth::wait_for_callback_cancelled(&server, CALLBACK, state, wait, cancelled)
}

fn save_sign_in(creds: &dyn Creds, refresh_value: &str, access_value: String, seconds: u64) -> Result<(), &'static str> {
    let _guard = lock(&REFRESH);
    if CANCEL_SIGN_IN.load(Ordering::SeqCst) { return Err(CANCELLED) }
    if !creds.save(refresh_value) { return Err(FAILED) }
    *lock(&TOKEN) = Some(Token { access: access_value, expires: Instant::now() + Duration::from_secs(seconds) });
    set_note(None);
    Ok(())
}

fn finish_sign_in(http: &dyn Http, creds: &dyn Creds, client: &Client, redirect: &str, code: &str, verifier: &str) -> Result<(), &'static str> {
    match exchange(http, client, redirect, code, verifier) {
        TokenReply::Ok { access, seconds, refresh: Some(refresh_value), scope: Some(scope) } if scope.split_whitespace().any(|s| s == SCOPE) => {
            match save_sign_in(creds, &refresh_value, access, seconds) {
                Ok(()) => Ok(()),
                Err(word) => { revoke(http, &refresh_value); Err(word) }
            }
        }
        // A grant without the one scope, or without a refresh token, is not kept: give it back.
        TokenReply::Ok { access, refresh: replacement, .. } => {
            revoke(http, replacement.as_deref().unwrap_or(&access));
            Err(DENIED)
        }
        TokenReply::InvalidGrant => Err(FAILED),
        TokenReply::SetupBroken => { set_note(Some(SETUP_BROKEN)); Err(SETUP_BROKEN) }
        TokenReply::Busy => Err(BUSY),
        TokenReply::Down => Err(DOWN),
    }
}

fn reason_for(word: &str) -> crate::wall2_youtube_log::Reason {
    use crate::wall2_youtube_log::Reason;
    match word { BUSY => Reason::Busy, DOWN => Reason::Down, SIGN_AGAIN => Reason::SignInAgain, SETUP_BROKEN => Reason::SetupBroken, DENIED => Reason::Denied, CANCELLED => Reason::Cancelled, TIMED_OUT => Reason::TimedOut, _ => Reason::Failed }
}

/// The whole browser sign-in: a listener on a random free loopback port, the browser opened
/// through `open`, one valid callback, the exchange and the save.
fn run_sign_in(client: &Client, http: &dyn Http, creds: &dyn Creds, pkce: &Pkce, wait: Duration, open: impl FnOnce(&str) -> bool) -> Result<(), &'static str> {
    use crate::wall2_youtube_log::{write, Event, Reason};
    let started = Instant::now();
    write(Event::SignInStart, Reason::None, 0, 0);
    let result: Result<(), &'static str> = (|| -> Result<(), &'static str> {
        let server = tiny_http::Server::http("127.0.0.1:0").map_err(|_| FAILED)?;
        let port = server.server_addr().to_ip().map(|a| a.port()).ok_or(FAILED)?;
        let redirect = format!("http://127.0.0.1:{port}{CALLBACK}");
        if !open(&authorize_url(&client.id, &redirect, &pkce.challenge, &pkce.state)) { return Err(FAILED) }
        let code = listen_for_code(server, &pkce.state, wait, || CANCEL_SIGN_IN.load(Ordering::SeqCst))?;
        if CANCEL_SIGN_IN.load(Ordering::SeqCst) { return Err(CANCELLED) }
        finish_sign_in(http, creds, client, &redirect, &code, &pkce.verifier)
    })();
    match result {
        Ok(()) => write(Event::SignInOk, Reason::None, 200, started.elapsed().as_millis()),
        Err(word) => write(Event::SignInFailed, reason_for(word), 0, started.elapsed().as_millis()),
    }
    result
}

/// Clears `SIGNING_IN` however the sign-in ends.
struct SignInGuard;
impl Drop for SignInGuard { fn drop(&mut self) { SIGNING_IN.store(false, Ordering::SeqCst); } }

/// Reads the client and marks a sign-in as running in one step, so the client cannot change in between.
fn begin_sign_in(creds: &dyn Creds, file: impl FnOnce() -> Option<Client>) -> Result<(Client, SignInGuard), &'static str> {
    let _guard = lock(&CLIENT);
    let client = resolve_client(creds, file)?;
    if SIGNING_IN.swap(true, Ordering::SeqCst) { return Err(BUSY) }
    CANCEL_SIGN_IN.store(false, Ordering::SeqCst);
    Ok((client, SignInGuard))
}

/// Revoke the grant, then always clear: the stored token, the one in memory, the note.
/// The client stays. A refused or failed revoke changes nothing about the clearing.
fn sign_out_with(http: &dyn Http, creds: &dyn Creds) {
    CANCEL_SIGN_IN.store(true, Ordering::SeqCst);
    let _guard = lock(&REFRESH);
    if let Ok(Some(stored)) = creds.load() { revoke(http, &stored); }
    creds.delete();
    reset_session();
    crate::wall2_youtube_log::write(crate::wall2_youtube_log::Event::SignOut, crate::wall2_youtube_log::Reason::None, 0, 0);
}

// ---- tests ----------------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::io::Write;
    use std::net::TcpStream;

    static TEST_LOCK: Mutex<()> = Mutex::new(());
    fn exclusive() -> MutexGuard<'static, ()> {
        let guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset_session();
        SIGNING_IN.store(false, Ordering::SeqCst);
        CANCEL_SIGN_IN.store(false, Ordering::SeqCst);
        guard
    }

    // Secret-shaped values are built at run time, never written as literals.
    fn good_id() -> String { format!("{}-{}.apps.googleusercontent.com", "1".repeat(12), "a".repeat(32)) }
    fn good_secret() -> String { format!("GOCSPX-{}", "x".repeat(28)) }
    fn client() -> Client { Client { id: good_id(), secret: good_secret() } }
    fn id_with(digits: usize, name: usize) -> String { format!("{}-{}.apps.googleusercontent.com", "7".repeat(digits), "b".repeat(name)) }

    struct FakeCreds { refresh: Mutex<Option<String>>, client: Mutex<Option<String>>, client_read_fails: AtomicBool, saves_fail: AtomicBool }
    impl FakeCreds {
        fn new(refresh: Option<&str>) -> Self { Self { refresh: Mutex::new(refresh.map(str::to_string)), client: Mutex::new(None), client_read_fails: AtomicBool::new(false), saves_fail: AtomicBool::new(false) } }
        fn refresh_value(&self) -> Option<String> { lock(&self.refresh).clone() }
        fn client_value(&self) -> Option<String> { lock(&self.client).clone() }
    }
    impl Creds for FakeCreds {
        fn load(&self) -> Result<Option<String>, &'static str> { Ok(self.refresh_value()) }
        fn save(&self, value: &str) -> bool { if self.saves_fail.load(Ordering::SeqCst) { return false } *lock(&self.refresh) = Some(value.into()); true }
        fn delete(&self) { *lock(&self.refresh) = None; }
        fn delete_if_equal(&self, expected: &str) { let mut v = lock(&self.refresh); if v.as_deref() == Some(expected) { *v = None; } }
        fn load_client(&self) -> Fetch<String> {
            if self.client_read_fails.load(Ordering::SeqCst) { return Fetch::Failed }
            match self.client_value() { Some(v) => Fetch::Found(v), None => Fetch::Missing }
        }
        fn save_client(&self, blob: &str) -> bool { if self.saves_fail.load(Ordering::SeqCst) { return false } *lock(&self.client) = Some(blob.into()); true }
        fn delete_client(&self) { *lock(&self.client) = None; }
    }

    type Call = (String, Vec<(String, String)>);
    struct FakeHttp { replies: Mutex<VecDeque<Result<HttpReply, ()>>>, calls: Mutex<Vec<Call>> }
    impl FakeHttp {
        fn new(replies: Vec<Result<HttpReply, ()>>) -> Self { Self { replies: Mutex::new(replies.into()), calls: Mutex::new(Vec::new()) } }
        fn calls(&self) -> Vec<Call> { lock(&self.calls).clone() }
        fn urls(&self) -> Vec<String> { self.calls().into_iter().map(|c| c.0).collect() }
    }
    impl Http for FakeHttp {
        fn post_form(&self, url: &str, form: &[(&str, &str)], _timeout: Duration) -> Result<HttpReply, ()> {
            lock(&self.calls).push((url.to_string(), form.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()));
            lock(&self.replies).pop_front().unwrap_or(Err(()))
        }
    }
    fn reply(status: u16, body: &str) -> Result<HttpReply, ()> { Ok(HttpReply { status, body: body.as_bytes().to_vec() }) }
    fn tokens(refresh: Option<&str>, scope: Option<&str>) -> Result<HttpReply, ()> {
        let mut v = json!({ "access_token": "access-one", "expires_in": 3599 });
        if let Some(r) = refresh { v["refresh_token"] = json!(r); }
        if let Some(s) = scope { v["scope"] = json!(s); }
        reply(200, &v.to_string())
    }
    fn pkce() -> Pkce { Pkce { verifier: "verifier-value".into(), challenge: "challenge-value".into(), state: "state-value".into() } }

    #[test]
    fn client_patterns_have_exact_edges() {
        let secret = good_secret();
        for (digits, name, ok) in [(5, 32, false), (6, 32, true), (20, 32, true), (21, 32, false), (12, 19, false), (12, 20, true), (12, 64, true), (12, 65, false)] {
            assert_eq!(check_client(&id_with(digits, name), &secret).is_some(), ok, "{digits} {name}");
        }
        for (len, ok) in [(19, false), (20, true), (64, true), (65, false)] { assert_eq!(check_client(&good_id(), &"S".repeat(len)).is_some(), ok, "secret {len}"); }
        let long_id = format!("{}{}", good_id(), "x".repeat(100));
        assert!(check_client(&long_id, &secret).is_none());
        for bad in ["has space ", "quo\"ted", "amp&ersand", "new\nline", "caf\u{e9}", "{\"clientId\":\"x\"}", "https://example.invalid/x"] {
            assert!(check_client(&good_id(), &format!("{}{bad}", "k".repeat(24))).is_none(), "{bad}");
            assert!(check_client(&format!("{bad}{}", good_id()), &secret).is_none(), "{bad}");
        }
        assert!(check_client(&good_id().replace("1111", "11a1"), &secret).is_none());
        assert!(check_client(&good_id().replace("aaaa", "AAAA"), &secret).is_none());
        let trimmed = check_client(&format!("  {}\n", good_id()), &format!("\t{secret} ")).unwrap();
        assert_eq!((trimmed.id, trimmed.secret), (good_id(), secret));
    }

    #[test]
    fn set_client_stores_one_json_blob_and_answers_nothing_else() {
        let _t = exclusive();
        let creds = FakeCreds::new(None);
        *lock(&TOKEN) = Some(Token { access: "old-access".into(), expires: Instant::now() + Duration::from_secs(3600) });
        set_note(Some(SIGN_AGAIN));
        assert_eq!(set_client_with(&creds, &format!(" {} ", good_id()), &good_secret()), Ok(()));
        let blob = creds.client_value().unwrap();
        assert_eq!(serde_json::from_str::<Value>(&blob).unwrap(), json!({ "clientId": good_id(), "clientSecret": good_secret() }));
        assert!(lock(&TOKEN).is_none());
        assert_eq!(*lock(&NOTE), None);
        assert_eq!(parse_client_blob(&blob), Some(client()));
        // Bad values change nothing and the word names neither value.
        for (id, secret) in [("not-an-id".to_string(), good_secret()), (good_id(), "short".to_string())] {
            let err = set_client_with(&creds, &id, &secret).unwrap_err();
            assert_eq!(err, INVALID);
            assert!(!err.contains(&id) && !err.contains(&secret));
        }
        assert_eq!(creds.client_value().as_deref(), Some(blob.as_str()));
        creds.saves_fail.store(true, Ordering::SeqCst);
        assert_eq!(set_client_with(&creds, &good_id(), &good_secret()), Err(FAILED));
    }

    #[test]
    fn the_client_cannot_change_while_signed_in_or_signing_in() {
        let _t = exclusive();
        let creds = FakeCreds::new(Some("stored-refresh"));
        assert_eq!(set_client_with(&creds, &good_id(), &good_secret()), Err(SIGN_OUT_FIRST));
        assert_eq!(forget_client_with(&creds), Err(SIGN_OUT_FIRST));
        assert_eq!(creds.client_value(), None);
        let creds = FakeCreds::new(None);
        SIGNING_IN.store(true, Ordering::SeqCst);
        assert_eq!(set_client_with(&creds, &good_id(), &good_secret()), Err(SIGN_OUT_FIRST));
        assert_eq!(forget_client_with(&creds), Err(SIGN_OUT_FIRST));
        SIGNING_IN.store(false, Ordering::SeqCst);
        assert_eq!(set_client_with(&creds, &good_id(), &good_secret()), Ok(()));
        assert!(creds.client_value().is_some());
        assert_eq!(forget_client_with(&creds), Ok(()));
        assert_eq!(creds.client_value(), None);
    }

    #[test]
    fn a_failed_sign_in_check_refuses_rather_than_guesses() {
        struct Unreadable;
        impl Creds for Unreadable {
            fn load(&self) -> Result<Option<String>, &'static str> { Err(FAILED) }
            fn save(&self, _: &str) -> bool { false }
            fn delete(&self) {}
            fn load_client(&self) -> Fetch<String> { Fetch::Missing }
            fn save_client(&self, _: &str) -> bool { true }
            fn delete_client(&self) {}
        }
        let _t = exclusive();
        assert_eq!(set_client_with(&Unreadable, &good_id(), &good_secret()), Err(FAILED));
    }

    fn file_text(extra: &str) -> String { format!(r#"{{"installed":{{"client_id":"{}","client_secret":"{}"{extra}}}}}"#, good_id(), good_secret()) }

    #[test]
    fn the_config_file_has_two_shapes_and_refuses_the_rest() {
        assert_eq!(parse_client_file(file_text("").as_bytes()), Some(client()));
        let own = format!(r#"{{"clientId":"{}","clientSecret":"{}"}}"#, good_id(), good_secret());
        assert_eq!(parse_client_file(own.as_bytes()), Some(client()));
        let nested_own = format!(r#"{{"installed":{{"clientId":"{}","clientSecret":"{}"}}}}"#, good_id(), good_secret());
        assert_eq!(parse_client_file(nested_own.as_bytes()), Some(client()));
        // Unknown fields, endpoints among them, are ignored.
        let hostile = file_text(r#","token_uri":"https://hostile.invalid/token","auth_uri":"https://hostile.invalid/auth","redirect_uris":["http://hostile.invalid"],"extra":[1,2]"#);
        assert_eq!(parse_client_file(hostile.as_bytes()), Some(client()));
        // A web client, a mixed file, wrong types, bad values and junk are refused.
        let web = format!(r#"{{"web":{{"client_id":"{}","client_secret":"{}"}}}}"#, good_id(), good_secret());
        assert_eq!(parse_client_file(web.as_bytes()), None);
        assert_eq!(parse_client_file(file_text("").replace("{\"installed\"", "{\"web\":{},\"installed\"").as_bytes()), None);
        for bad in [r#"{"installed":{"client_id":5,"client_secret":"x"}}"#.to_string(), r#"{"installed":3}"#.to_string(), "[]".to_string(), "null".to_string(), "not json".to_string(), String::new(), format!(r#"{{"clientId":"{}"}}"#, good_id())] {
            assert_eq!(parse_client_file(bad.as_bytes()), None, "{bad}");
        }
        assert_eq!(parse_client_file(&[0xFF, 0xFE, 0x00]), None);
    }

    #[test]
    fn the_config_file_size_limit_and_bom() {
        let base = file_text("");
        let pad = |total: usize| { let extra = total - base.len(); file_text(&format!(r#","pad":"{}""#, "p".repeat(extra - 9))) };
        let exact = pad(4096);
        assert_eq!(exact.len(), 4096);
        assert_eq!(parse_client_file(exact.as_bytes()), Some(client()));
        let over = pad(4097);
        assert_eq!(over.len(), 4097);
        assert!(serde_json::from_str::<Value>(&over).is_ok());
        assert_eq!(parse_client_file(over.as_bytes()), None);
        let mut with_bom = vec![0xEF, 0xBB, 0xBF];
        with_bom.extend(base.as_bytes());
        assert_eq!(parse_client_file(&with_bom), Some(client()));
        // Only one BOM is stripped.
        let mut twice = vec![0xEF, 0xBB, 0xBF, 0xEF, 0xBB, 0xBF];
        twice.extend(base.as_bytes());
        assert_eq!(parse_client_file(&twice), None);
    }

    #[test]
    fn reading_the_file_from_disk_caps_missing_and_oversized() {
        let dir = std::env::temp_dir().join(format!("wall2-youtube-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("youtube.json");
        assert_eq!(read_client_file(&path), None);
        std::fs::write(&path, file_text("")).unwrap();
        assert_eq!(read_client_file(&path), Some(client()));
        let base = file_text("");
        let padded = file_text(&format!(r#","pad":"{}""#, "p".repeat(4097 - base.len() - 9)));
        assert_eq!(padded.len(), 4097);
        std::fs::write(&path, padded).unwrap();
        assert_eq!(read_client_file(&path), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_stored_client_wins_over_the_file() {
        let creds = FakeCreds::new(None);
        let other = Client { id: id_with(9, 30), secret: format!("GOCSPX-{}", "y".repeat(28)) };
        assert_eq!(resolve_client(&creds, || Some(client())), Ok(client()));
        *lock(&creds.client) = Some(client_blob(&other));
        let mut read_file = false;
        assert_eq!(resolve_client(&creds, || { read_file = true; Some(client()) }), Ok(other.clone()));
        assert!(!read_file, "the file is read only when none is stored");
        *lock(&creds.client) = Some("{not valid".into());
        assert_eq!(resolve_client(&creds, || Some(client())), Ok(client()));
        assert_eq!(resolve_client(&creds, || None), Err(NOT_SETUP));
        creds.client_read_fails.store(true, Ordering::SeqCst);
        assert_eq!(resolve_client(&creds, || Some(client())), Err(FAILED));
    }

    #[test]
    fn a_hostile_file_still_sends_to_the_fixed_hosts() {
        let _t = exclusive();
        let hostile = file_text(r#","token_uri":"https://hostile.invalid/token","auth_uri":"https://hostile.invalid/auth""#);
        let c = parse_client_file(hostile.as_bytes()).unwrap();
        let http = FakeHttp::new(vec![tokens(Some("refresh-one"), Some(SCOPE)), reply(200, "")]);
        let creds = FakeCreds::new(None);
        assert_eq!(finish_sign_in(&http, &creds, &c, "http://127.0.0.1:1/callback", "code", "verifier"), Ok(()));
        sign_out_with(&http, &creds);
        assert_eq!(http.urls(), [TOKEN_URL, REVOKE_URL]);
        assert!(http.urls().iter().all(|u| !u.contains("hostile")));
    }

    #[test]
    fn the_authorize_url_has_exactly_the_planned_parameters() {
        let url = tauri::Url::parse(&authorize_url(&good_id(), "http://127.0.0.1:50123/callback", "chal", "stat")).unwrap();
        assert_eq!(format!("{}://{}{}", url.scheme(), url.host_str().unwrap(), url.path()), AUTH_URL);
        let pairs: Vec<(String, String)> = url.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
        let names: Vec<&str> = pairs.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(names, ["client_id", "redirect_uri", "response_type", "scope", "code_challenge", "code_challenge_method", "state", "prompt", "access_type"]);
        let get = |k: &str| pairs.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str()).unwrap();
        assert_eq!(get("client_id"), good_id());
        assert_eq!(get("redirect_uri"), "http://127.0.0.1:50123/callback");
        assert_eq!(get("response_type"), "code");
        assert_eq!(get("scope"), SCOPE);
        assert_eq!(get("code_challenge_method"), "S256");
        assert_eq!(get("prompt"), "select_account consent");
        assert_eq!(get("access_type"), "offline");
        let text = url.as_str();
        assert!(!text.contains("include_granted_scopes") && !text.contains("login_hint") && !text.contains("localhost"));
        assert!(!text.contains(&good_secret()));
    }

    fn raw_get(port: u16, target: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        write!(stream, "GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n").unwrap();
        let mut text = String::new();
        let _ = stream.read_to_string(&mut text);
        text.lines().next().unwrap_or("").to_string()
    }

    #[test]
    fn the_callback_listener_ignores_forgeries_and_closes_after_the_code() {
        let _t = exclusive();
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let waiting = std::thread::spawn(move || listen_for_code(server, "right", Duration::from_secs(20), || false));
        assert!(raw_get(port, "/callback?code=c1&state=wrong").contains(" 400 "));
        assert!(raw_get(port, "/callback?code=c1").contains(" 400 "));
        assert!(raw_get(port, "/callback?code=c1&state=right&state=right").contains(" 400 "));
        assert!(raw_get(port, "/callback?error=access_denied&state=wrong").contains(" 400 "));
        assert!(raw_get(port, "/elsewhere?code=c1&state=right").contains(" 404 "));
        assert!(!waiting.is_finished(), "forged requests must not end the wait");
        assert!(raw_get(port, "/callback?code=real-code&state=right").contains(" 200 "));
        assert_eq!(waiting.join().unwrap(), Ok("real-code".to_string()));
        let started = Instant::now();
        let mut closed = false;
        while started.elapsed() < Duration::from_secs(5) {
            if TcpStream::connect(("127.0.0.1", port)).is_err() { closed = true; break }
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(closed, "the listener must be closed once the code arrived");
    }

    #[test]
    fn the_listener_ends_on_cancel_and_on_the_time_limit() {
        let _t = exclusive();
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        assert_eq!(listen_for_code(server, "s", Duration::from_secs(5), || true), Err(CANCELLED));
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        assert_eq!(listen_for_code(server, "s", Duration::from_millis(50), || false), Err(TIMED_OUT));
    }

    #[test]
    fn token_answers_fall_into_the_planned_classes() {
        let ok = token_reply(tokens(Some("r"), Some(SCOPE)));
        assert_eq!(ok, TokenReply::Ok { access: "access-one".into(), seconds: 3599, refresh: Some("r".into()), scope: Some(SCOPE.into()) });
        assert_eq!(format!("{ok:?}"), "Ok(<hidden>)");
        let seconds = |body: &str| match token_reply(reply(200, body)) { TokenReply::Ok { seconds, .. } => seconds, other => panic!("{other:?}") };
        assert_eq!((seconds(r#"{"access_token":"a","expires_in":0}"#), seconds(r#"{"access_token":"a","expires_in":999999}"#), seconds(r#"{"access_token":"a"}"#)), (1, 86_400, 3600));
        assert_eq!(token_reply(reply(200, r#"{"expires_in":5}"#)), TokenReply::Down);
        assert_eq!(token_reply(reply(200, "nope")), TokenReply::Down);
        assert_eq!(token_reply(reply(400, r#"{"error":"invalid_grant"}"#)), TokenReply::InvalidGrant);
        assert_eq!(token_reply(reply(401, r#"{"error":"invalid_grant"}"#)), TokenReply::Down);
        for status in [400, 401] {
            assert_eq!(token_reply(reply(status, r#"{"error":"invalid_client"}"#)), TokenReply::SetupBroken);
            assert_eq!(token_reply(reply(status, r#"{"error":"unauthorized_client"}"#)), TokenReply::SetupBroken);
            assert_eq!(token_reply(reply(status, r#"{"error":"something_else"}"#)), TokenReply::Down);
            assert_eq!(token_reply(reply(status, "")), TokenReply::Down);
        }
        assert_eq!(token_reply(reply(429, "")), TokenReply::Busy);
        for status in [403, 500, 502, 503, 598] { assert_eq!(token_reply(reply(status, r#"{"error":"invalid_grant"}"#)), TokenReply::Down); }
        assert_eq!(token_reply(Err(())), TokenReply::Down);
    }

    struct ReplacingHttp<'a>(&'a FakeCreds);
    impl Http for ReplacingHttp<'_> {
        fn post_form(&self, _: &str, _: &[(&str, &str)], _: Duration) -> Result<HttpReply, ()> { self.0.save("newer-refresh"); reply(400, r#"{"error":"invalid_grant"}"#) }
    }

    #[test]
    fn a_refresh_deletes_the_token_only_for_invalid_grant_and_only_the_one_tried() {
        let _t = exclusive();
        let c = client();
        let creds = FakeCreds::new(Some("old-refresh"));
        let http = FakeHttp::new(vec![reply(400, r#"{"error":"invalid_grant"}"#)]);
        assert_eq!(access_with(&c, true, &http, &creds), Err(SIGN_AGAIN));
        assert_eq!(creds.refresh_value(), None);
        assert_eq!(*lock(&NOTE), Some(SIGN_AGAIN));
        // Another sign-in saved a newer token while the refresh was in flight: it stays.
        reset_session();
        let creds = FakeCreds::new(Some("old-refresh"));
        assert_eq!(access_with(&c, true, &ReplacingHttp(&creds), &creds), Err(SIGN_AGAIN));
        assert_eq!(creds.refresh_value().as_deref(), Some("newer-refresh"));
        // A refused client deletes nothing and says the setup is broken.
        for status in [400, 401] {
            reset_session();
            let creds = FakeCreds::new(Some("keep-refresh"));
            let http = FakeHttp::new(vec![reply(status, r#"{"error":"invalid_client"}"#)]);
            assert_eq!(access_with(&c, true, &http, &creds), Err(SETUP_BROKEN));
            assert_eq!(creds.refresh_value().as_deref(), Some("keep-refresh"));
            assert_eq!(*lock(&NOTE), Some(SETUP_BROKEN));
            *lock(&creds.client) = Some(client_blob(&c));
            assert_eq!(status_with(&creds, || None), Status { setup: true, signed_in: true, reason: Some(SETUP_BROKEN.into()), searches_left: None });
        }
        // Throttling and server errors keep everything.
        for (status, word) in [(429, BUSY), (500, DOWN), (503, DOWN)] {
            reset_session();
            let creds = FakeCreds::new(Some("keep-refresh"));
            let http = FakeHttp::new(vec![reply(status, "")]);
            assert_eq!(access_with(&c, true, &http, &creds), Err(word));
            assert_eq!(creds.refresh_value().as_deref(), Some("keep-refresh"));
        }
    }

    #[test]
    fn a_refresh_rotates_the_token_and_keeps_the_access_token_in_memory_only() {
        let _t = exclusive();
        let c = client();
        let creds = FakeCreds::new(Some("old-refresh"));
        let http = FakeHttp::new(vec![tokens(Some("new-refresh"), None)]);
        assert_eq!(access_with(&c, false, &http, &creds), Ok("access-one".to_string()));
        assert_eq!(creds.refresh_value().as_deref(), Some("new-refresh"));
        // A second call inside the lifetime asks nobody.
        assert_eq!(access_with(&c, false, &http, &creds), Ok("access-one".to_string()));
        assert_eq!(http.calls().len(), 1);
        let form = &http.calls()[0].1;
        assert!(form.contains(&("grant_type".to_string(), "refresh_token".to_string())));
        assert!(form.contains(&("client_secret".to_string(), good_secret())));
        // Nothing stored: sign in again, no request.
        let none = FakeCreds::new(None);
        *lock(&TOKEN) = None;
        assert_eq!(access_with(&c, false, &FakeHttp::new(vec![]), &none), Err(SIGN_AGAIN));
    }

    #[test]
    fn a_grant_without_the_scope_or_a_refresh_token_is_revoked_and_denied() {
        let _t = exclusive();
        let c = client();
        let cases = [
            (tokens(Some("refresh-one"), Some("https://www.googleapis.com/auth/youtube")), "refresh-one"),
            (tokens(Some("refresh-one"), Some("https://www.googleapis.com/auth/youtube.readonly.extra")), "refresh-one"),
            (tokens(Some("refresh-one"), None), "refresh-one"),
            (tokens(None, Some(SCOPE)), "access-one"),
        ];
        for (answer, revoked) in cases {
            let creds = FakeCreds::new(None);
            let http = FakeHttp::new(vec![answer, reply(200, "")]);
            assert_eq!(finish_sign_in(&http, &creds, &c, "http://127.0.0.1:1/callback", "code", "v"), Err(DENIED));
            assert_eq!(creds.refresh_value(), None);
            assert!(lock(&TOKEN).is_none());
            let calls = http.calls();
            assert_eq!(calls[1].0, REVOKE_URL);
            assert_eq!(calls[1].1, [("token".to_string(), revoked.to_string())]);
        }
    }

    #[test]
    fn a_good_grant_is_saved_and_other_exchange_answers_map_to_fixed_words() {
        let _t = exclusive();
        let c = client();
        let creds = FakeCreds::new(None);
        set_note(Some(SIGN_AGAIN));
        let http = FakeHttp::new(vec![tokens(Some("refresh-one"), Some(&format!("openid {SCOPE}")))]);
        assert_eq!(finish_sign_in(&http, &creds, &c, "http://127.0.0.1:9/callback", "the-code", "the-verifier"), Ok(()));
        assert_eq!(creds.refresh_value().as_deref(), Some("refresh-one"));
        assert!(lock(&TOKEN).is_some());
        assert_eq!(*lock(&NOTE), None);
        let form = http.calls()[0].1.clone();
        let id = good_id();
        for pair in [("grant_type", "authorization_code"), ("code", "the-code"), ("code_verifier", "the-verifier"), ("redirect_uri", "http://127.0.0.1:9/callback"), ("client_id", id.as_str())] {
            assert!(form.contains(&(pair.0.to_string(), pair.1.to_string())), "{}", pair.0);
        }
        for (answer, word) in [(reply(400, r#"{"error":"invalid_grant"}"#), FAILED), (reply(401, r#"{"error":"invalid_client"}"#), SETUP_BROKEN), (reply(429, ""), BUSY), (reply(503, ""), DOWN), (Err(()), DOWN)] {
            let creds = FakeCreds::new(None);
            assert_eq!(finish_sign_in(&FakeHttp::new(vec![answer]), &creds, &c, "http://127.0.0.1:9/callback", "c", "v"), Err(word));
            assert_eq!(creds.refresh_value(), None);
        }
        assert_eq!(*lock(&NOTE), Some(SETUP_BROKEN));
        // A cancel after the exchange gives the grant back instead of keeping it.
        reset_session();
        CANCEL_SIGN_IN.store(true, Ordering::SeqCst);
        let creds = FakeCreds::new(None);
        let http = FakeHttp::new(vec![tokens(Some("refresh-two"), Some(SCOPE)), reply(200, "")]);
        assert_eq!(finish_sign_in(&http, &creds, &c, "http://127.0.0.1:9/callback", "c", "v"), Err(CANCELLED));
        assert_eq!(creds.refresh_value(), None);
        assert_eq!(http.calls()[1].0, REVOKE_URL);
        // A store that refuses the write also gives it back.
        CANCEL_SIGN_IN.store(false, Ordering::SeqCst);
        let creds = FakeCreds::new(None);
        creds.saves_fail.store(true, Ordering::SeqCst);
        let http = FakeHttp::new(vec![tokens(Some("refresh-three"), Some(SCOPE)), reply(200, "")]);
        assert_eq!(finish_sign_in(&http, &creds, &c, "http://127.0.0.1:9/callback", "c", "v"), Err(FAILED));
        assert_eq!(http.calls()[1].1, [("token".to_string(), "refresh-three".to_string())]);
    }

    /// A browser that follows the authorize link back to the wall's own callback.
    fn fake_browser(code: &'static str, state_override: Option<&'static str>) -> impl FnOnce(&str) -> bool {
        move |url: &str| {
            let parsed = tauri::Url::parse(url).unwrap();
            let query: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();
            let redirect = tauri::Url::parse(&query["redirect_uri"]).unwrap();
            let state = state_override.map(str::to_string).unwrap_or_else(|| query["state"].clone());
            let port = redirect.port().unwrap();
            std::thread::spawn(move || { raw_get(port, &format!("{}?code={code}&state={state}", redirect.path())); });
            true
        }
    }

    #[test]
    fn the_whole_sign_in_runs_over_a_real_listener_with_a_fake_browser_and_fake_google() {
        let _t = exclusive();
        let c = client();
        let creds = FakeCreds::new(None);
        let http = FakeHttp::new(vec![tokens(Some("refresh-one"), Some(SCOPE))]);
        let result = run_sign_in(&c, &http, &creds, &pkce(), Duration::from_secs(20), fake_browser("good-code", None));
        assert_eq!(result, Ok(()));
        assert_eq!(creds.refresh_value().as_deref(), Some("refresh-one"));
        let call = &http.calls()[0];
        assert_eq!(call.0, TOKEN_URL);
        assert!(call.1.contains(&("code".to_string(), "good-code".to_string())));
        assert!(call.1.contains(&("code_verifier".to_string(), "verifier-value".to_string())));
        let redirect = &call.1.iter().find(|(k, _)| k == "redirect_uri").unwrap().1;
        assert!(redirect.starts_with("http://127.0.0.1:") && redirect.ends_with("/callback"));
        // A forged callback does not finish it; the time limit does.
        let creds = FakeCreds::new(None);
        let http = FakeHttp::new(vec![]);
        let result = run_sign_in(&c, &http, &creds, &pkce(), Duration::from_millis(1500), fake_browser("forged", Some("not-the-state")));
        assert_eq!(result, Err(TIMED_OUT));
        assert!(http.calls().is_empty());
        // A browser that cannot be opened ends it at once.
        assert_eq!(run_sign_in(&c, &http, &creds, &pkce(), Duration::from_secs(5), |_| false), Err(FAILED));
    }

    #[test]
    fn signing_out_revokes_then_always_clears() {
        let _t = exclusive();
        let creds = FakeCreds::new(Some("stored-refresh"));
        let c = client();
        *lock(&TOKEN) = Some(Token { access: "mem".into(), expires: Instant::now() + Duration::from_secs(3600) });
        set_note(Some(SETUP_BROKEN));
        *lock(&creds.client) = Some(client_blob(&c));
        for answer in [reply(200, ""), reply(400, r#"{"error":"invalid_token"}"#), Err(())] {
            *lock(&creds.refresh) = Some("stored-refresh".into());
            *lock(&TOKEN) = Some(Token { access: "mem".into(), expires: Instant::now() + Duration::from_secs(3600) });
            let http = FakeHttp::new(vec![answer]);
            sign_out_with(&http, &creds);
            assert_eq!(http.calls(), [(REVOKE_URL.to_string(), vec![("token".to_string(), "stored-refresh".to_string())])]);
            assert_eq!(creds.refresh_value(), None);
            assert!(lock(&TOKEN).is_none());
            assert_eq!(*lock(&NOTE), None);
            assert!(CANCEL_SIGN_IN.load(Ordering::SeqCst));
        }
        assert!(creds.client_value().is_some(), "the client stays");
        // With nothing stored nobody is asked.
        let http = FakeHttp::new(vec![]);
        sign_out_with(&http, &FakeCreds::new(None));
        assert!(http.calls().is_empty());
    }

    #[test]
    fn status_is_four_fixed_fields_and_never_a_value() {
        let _t = exclusive();
        let creds = FakeCreds::new(None);
        assert_eq!(status_with(&creds, || None), Status { setup: false, signed_in: false, reason: Some(NOT_SETUP.into()), searches_left: None });
        assert_eq!(status_with(&creds, || Some(client())), Status { setup: true, signed_in: false, reason: None, searches_left: None });
        *lock(&creds.refresh) = Some("stored-refresh".into());
        let signed = status_with(&creds, || Some(client()));
        assert_eq!(signed, Status { setup: true, signed_in: true, reason: None, searches_left: None });
        set_note(Some(SETUP_BROKEN));
        assert_eq!(status_with(&creds, || Some(client())).reason.as_deref(), Some(SETUP_BROKEN));
        set_note(Some(SIGN_AGAIN));
        *lock(&creds.refresh) = None;
        assert_eq!(status_with(&creds, || Some(client())), Status { setup: true, signed_in: false, reason: Some(SIGN_AGAIN.into()), searches_left: None });
        creds.client_read_fails.store(true, Ordering::SeqCst);
        assert_eq!(status_with(&creds, || Some(client())).reason.as_deref(), Some(FAILED));
        let text = serde_json::to_string(&signed).unwrap();
        assert_eq!(text, r#"{"setup":true,"signedIn":true,"reason":null,"searchesLeft":null}"#);
        for secret in [good_id(), good_secret(), "stored-refresh".to_string()] { assert!(!text.contains(&secret)); }
    }

    #[test]
    fn secret_holding_types_print_nothing() {
        let text = format!("{:?} {:?} {:?}", client(), HttpReply { status: 200, body: b"secret-body-text".to_vec() }, token_reply(tokens(Some("refresh-one"), Some(SCOPE))));
        for secret in [good_id(), good_secret(), "secret-body-text".to_string(), "refresh-one".to_string(), "access-one".to_string()] { assert!(!text.contains(&secret), "{secret}"); }
    }

    #[test]
    fn no_failing_path_writes_a_value_into_the_log() {
        let _t = exclusive();
        let c = client();
        let sentinel = format!("sentinel-{}", "z".repeat(12));
        let hostile = format!(r#"{{"error":"{sentinel}","error_description":"{sentinel}","access_token":"{sentinel}","refresh_token":"{sentinel}"}}"#);
        let creds = FakeCreds::new(Some(&sentinel));
        for status in [400, 401, 403, 429, 500] {
            let http = FakeHttp::new(vec![reply(status, &hostile), reply(status, &hostile)]);
            let _ = finish_sign_in(&http, &FakeCreds::new(None), &c, "http://127.0.0.1:1/callback", &sentinel, &sentinel);
            let _ = access_with(&c, true, &http, &creds);
            sign_out_with(&http, &FakeCreds::new(Some(&sentinel)));
        }
        let denied = FakeHttp::new(vec![tokens(Some(&sentinel), Some(&sentinel)), Err(())]);
        let _ = finish_sign_in(&denied, &FakeCreds::new(None), &c, "http://127.0.0.1:1/callback", &sentinel, &sentinel);
        let _ = set_client_with(&FakeCreds::new(None), &sentinel, &sentinel);
        let lines = crate::wall2_youtube_log::test_lines();
        assert!(!lines.is_empty());
        for text in &lines {
            assert!(!text.contains("sentinel") && !text.contains(&good_id()) && !text.contains(&good_secret()), "{text}");
            assert!(text.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'-' | b' ' | b'\n')), "{text}");
        }
    }

    #[test]
    fn the_credential_targets_are_the_planned_ones() {
        assert_eq!(client_target(), "WidgetWall2/youtube/client/0");
        assert_eq!(refresh_target(0), "WidgetWall2/youtube/refresh/0");
        assert_eq!(refresh_target(2), "WidgetWall2/youtube/refresh/2");
    }

    #[test]
    fn body_limits_accept_the_limit_and_refuse_one_more() {
        for limit in [TOKEN_BODY, ERROR_BODY] {
            assert_eq!(read_limited(&mut std::io::Cursor::new(vec![b'x'; limit as usize]), limit).unwrap().len(), limit as usize);
            assert_eq!(read_limited(&mut std::io::Cursor::new(vec![b'x'; limit as usize + 1]), limit), Err(DOWN));
        }
    }

    #[test]
    fn begin_sign_in_is_one_at_a_time_and_clears_the_flag_when_dropped() {
        let _t = exclusive();
        let creds = FakeCreds::new(None);
        assert_eq!(begin_sign_in(&creds, || None).err(), Some(NOT_SETUP));
        assert!(!SIGNING_IN.load(Ordering::SeqCst));
        let first = begin_sign_in(&creds, || Some(client())).unwrap();
        assert!(SIGNING_IN.load(Ordering::SeqCst));
        assert_eq!(begin_sign_in(&creds, || Some(client())).err(), Some(BUSY));
        assert!(SIGNING_IN.load(Ordering::SeqCst), "the refused second try must not clear the first");
        drop(first);
        assert!(!SIGNING_IN.load(Ordering::SeqCst));
    }

    #[test]
    fn every_command_checks_the_window_first() {
        // The needles are built at run time so this test's own text never matches them.
        let source = include_str!("wall2_youtube.rs");
        let function = ["pub async fn ", "wall2_youtube_"].concat();
        let attribute = ["#[tauri", "::command]"].concat();
        let commands = source.split(function.as_str()).skip(1).map(|rest| rest.split('(').next().unwrap_or("")).collect::<Vec<_>>();
        assert_eq!(commands, ["status", "set_client", "forget_client", "sign_in", "cancel_sign_in", "sign_out"]);
        for part in source.split(attribute.as_str()).skip(1) {
            let body: String = part.lines().skip(1).take(3).collect::<Vec<_>>().join("\n");
            assert!(body.contains("require(&window)?"), "{body}");
        }
    }
}

// ---- commands -------------------------------------------------------------------------------

use tauri::{Manager, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

fn require(window: &WebviewWindow) -> Result<(), String> { crate::wall2_meet::require_wall2(window.label()) }

fn file_client(app: &tauri::AppHandle) -> Option<Client> { read_client_file(&app.path().app_config_dir().ok()?.join("youtube.json")) }

struct RealHttp;
impl Http for RealHttp {
    fn post_form(&self, url: &str, form: &[(&str, &str)], timeout: Duration) -> Result<HttpReply, ()> {
        let agent = ureq::AgentBuilder::new().timeout(timeout.max(Duration::from_millis(1))).redirects(0).build();
        let response = match agent.post(url).send_form(form) { Ok(r) | Err(ureq::Error::Status(_, r)) => r, Err(_) => return Err(()) };
        let status = response.status();
        let limit = if (200..300).contains(&status) { TOKEN_BODY } else { ERROR_BODY };
        match read_limited(&mut response.into_reader(), limit) {
            Ok(body) => Ok(HttpReply { status, body }),
            Err(_) => Ok(HttpReply { status: 598, body: Vec::new() }),
        }
    }
}

#[tauri::command]
pub async fn wall2_youtube_status(window: WebviewWindow) -> Result<Status, String> {
    require(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || status_with(&RealCreds, || file_client(&app))).await.map_err(|_| FAILED.to_string())
}

#[tauri::command]
pub async fn wall2_youtube_set_client(window: WebviewWindow, client_id: String, client_secret: String) -> Result<(), String> {
    require(&window)?;
    tauri::async_runtime::spawn_blocking(move || set_client_with(&RealCreds, &client_id, &client_secret).map_err(str::to_string)).await.map_err(|_| FAILED.to_string())?
}

#[tauri::command]
pub async fn wall2_youtube_forget_client(window: WebviewWindow) -> Result<(), String> {
    require(&window)?;
    tauri::async_runtime::spawn_blocking(move || forget_client_with(&RealCreds).map_err(str::to_string)).await.map_err(|_| FAILED.to_string())?
}

#[tauri::command]
pub async fn wall2_youtube_sign_in(window: WebviewWindow) -> Result<(), String> {
    require(&window)?;
    let app = window.app_handle().clone();
    let (client, _running) = begin_sign_in(&RealCreds, || file_client(&app)).map_err(str::to_string)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _running = _running;
        let verifier = crate::wall2_oauth::random_b64(32).ok_or_else(|| FAILED.to_string())?;
        let state = crate::wall2_oauth::random_b64(16).ok_or_else(|| FAILED.to_string())?;
        let challenge = crate::wall2_oauth::challenge_for(&verifier).ok_or_else(|| FAILED.to_string())?;
        let pkce = Pkce { verifier, challenge, state };
        run_sign_in(&client, &RealHttp, &RealCreds, &pkce, SIGN_IN_WAIT, |url| app.opener().open_url(url, None::<&str>).is_ok()).map_err(str::to_string)
    }).await.map_err(|_| FAILED.to_string())?
}

#[tauri::command]
pub async fn wall2_youtube_cancel_sign_in(window: WebviewWindow) -> Result<(), String> {
    require(&window)?;
    CANCEL_SIGN_IN.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn wall2_youtube_sign_out(window: WebviewWindow) -> Result<(), String> {
    require(&window)?;
    tauri::async_runtime::spawn_blocking(move || sign_out_with(&RealHttp, &RealCreds)).await.map_err(|_| FAILED.to_string())
}

pub fn start_log(dir: Option<std::path::PathBuf>) { crate::wall2_youtube_log::start(dir); }
