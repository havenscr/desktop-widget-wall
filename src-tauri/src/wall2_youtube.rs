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
/// A client is stored but cannot be read back: only a new setup helps.
const UNREADABLE: &str = "setup unreadable";
/// A refresh token is stored but no client can be found (the file was moved or deleted).
const SETUP_MISSING: &str = "setup missing";
/// A sign-in is waiting for the browser (the page may have been reloaded in the middle of it).
const SIGNING: &str = "signing in";
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
    /// One GET to a fixed address with a bearer token. A 2xx body may be up to `limit` bytes, any
    /// other body up to `ERROR_BODY`; a longer one comes back as status 598 with no body.
    fn get(&self, url: &str, bearer: &str, limit: u64, timeout: Duration) -> Result<HttpReply, ()>;
}

fn read_limited(reader: &mut dyn Read, limit: u64) -> Result<Vec<u8>, &'static str> {
    let mut out = Vec::new();
    reader.take(limit + 1).read_to_end(&mut out).map_err(|_| DOWN)?;
    if out.len() as u64 > limit { Err(DOWN) } else { Ok(out) }
}

/// A status and a body cut to its limit: an oversized body is never parsed in part.
fn bounded_reply(status: u16, reader: &mut dyn Read, ok_limit: u64) -> HttpReply {
    let limit = if (200..300).contains(&status) { ok_limit } else { ERROR_BODY };
    match read_limited(reader, limit) {
        Ok(body) => HttpReply { status, body },
        Err(_) => HttpReply { status: 598, body: Vec::new() },
    }
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
/// Forget the access token, the note, every cache and the search count: sign-out, a client
/// change and a forgotten client all come through here.
fn reset_session() { *lock(&TOKEN) = None; set_note(None); clear_library(false); }

#[derive(PartialEq)]
enum TokenReply {
    Ok { access: String, seconds: u64, refresh: Option<String>, scope: Option<String> },
    /// 400 `invalid_grant`: the grant is dead.
    InvalidGrant,
    /// 400 or 401 `invalid_client` or `unauthorized_client`: only a new setup can fix it.
    SetupBroken(u16),
    Busy,
    Down,
}
impl fmt::Debug for TokenReply {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self { Self::Ok { .. } => "Ok(<hidden>)", Self::InvalidGrant => "InvalidGrant", Self::SetupBroken(_) => "SetupBroken", Self::Busy => "Busy", Self::Down => "Down" })
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
            Some("invalid_client" | "unauthorized_client") => TokenReply::SetupBroken(reply.status),
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

/// A fresh access token for the reads: the one in memory while over 60 s
/// remain, otherwise one refresh under the lock. Only `invalid_grant` deletes the stored token,
/// and only if it is still the one that was tried; a refused client deletes nothing.
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
            // Whatever the library holds was read under this grant: a later sign-in (maybe another account)
            // must not be served it. The day's search count stays (see `clear_library`).
            clear_library(true);
            set_note(Some(SIGN_AGAIN));
            write(Event::RefreshRefused, Reason::SignInAgain, 400, started.elapsed().as_millis());
            Err(SIGN_AGAIN)
        }
        TokenReply::SetupBroken(status) => {
            set_note(Some(SETUP_BROKEN));
            write(Event::RefreshRefused, Reason::SetupBroken, status, started.elapsed().as_millis());
            Err(SETUP_BROKEN)
        }
        TokenReply::Busy => { write(Event::RefreshFailed, Reason::Busy, 429, started.elapsed().as_millis()); Err(BUSY) }
        TokenReply::Down => { write(Event::RefreshFailed, Reason::Down, 0, started.elapsed().as_millis()); Err(DOWN) }
    }
}

// ---- which client is in use -----------------------------------------------------------------

/// A client stored through the form wins; `youtube.json` is read only when none is stored. A
/// stored entry that cannot be parsed is a broken setup: the file is not consulted then.
fn resolve_client(creds: &dyn Creds, file: impl FnOnce() -> Option<Client>) -> Result<Client, &'static str> {
    match creds.load_client() {
        Fetch::Found(blob) => return parse_client_blob(&blob).ok_or(UNREADABLE),
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
/// fixed word. `searchesLeft` is the search budget of the day, only while signed in.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status { setup: bool, signed_in: bool, reason: Option<String>, searches_left: Option<u32> }

fn status_with(creds: &dyn Creds, file: impl FnOnce() -> Option<Client>) -> Status {
    let status = |setup: bool, signed_in: bool, reason: Option<&str>| Status { setup, signed_in, reason: reason.map(str::to_string), searches_left: searches_left(signed_in, unix_now()) };
    // Signed in comes from the stored token alone, so Sign out stays reachable whatever happened to the client.
    let token = creds.load();
    let signed_in = matches!(token, Ok(Some(_)));
    match resolve_client(creds, file) {
        Ok(_) => {
            let reason = if token.is_err() { Some(FAILED) } else if SIGNING_IN.load(Ordering::SeqCst) { Some(SIGNING) } else { *lock(&NOTE) };
            status(true, signed_in, reason)
        }
        Err(NOT_SETUP) => status(false, signed_in, Some(if signed_in { SETUP_MISSING } else { NOT_SETUP })),
        Err(UNREADABLE) => status(true, signed_in, Some(UNREADABLE)),
        Err(word) => status(false, signed_in, Some(word)),
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
    // A new sign-in starts with an empty library, whoever signed in before (the search count stays).
    clear_library(true);
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
        TokenReply::SetupBroken(_) => { set_note(Some(SETUP_BROKEN)); Err(SETUP_BROKEN) }
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
    // A stale page must not overwrite a stored token and leave the old grant unrevoked.
    match creds.load() { Ok(None) => {} Ok(Some(_)) => return Err(SIGN_OUT_FIRST), Err(_) => return Err(FAILED) }
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

// ---- reads: the library ---------------------------------------------------------------------

const API: &str = "https://www.googleapis.com/youtube/v3/";
const EP_PLAYLISTS: &str = "playlists";
const EP_ITEMS: &str = "playlistItems";
const EP_VIDEOS: &str = "videos";
const EP_SEARCH: &str = "search";
const EP_CATEGORIES: &str = "videoCategories";
const READ_BODY: u64 = 512 * 1024;
const READ_TIMEOUT: Duration = Duration::from_secs(6);
const PAGE_SIZE: &str = "50";
const SEARCH_SIZE: &str = "25";
/// The wall's region for the "blocked here" check.
const REGION: &str = "US";
const MAX_SECONDS: u64 = 7 * 24 * 3600;
/// `search.list` calls allowed a day (Google's own bucket), counted from midnight Pacific.
const SEARCH_DAILY: u32 = 100;
/// Hourly `videos.list` calls for own playlists, mirroring the search daily budget.
const DETAILS_HOURLY: u32 = 60;
const LISTS_TTL: u64 = 3600;
const LIKED_TTL: u64 = 600;
const DETAIL_TTL: u64 = 24 * 3600;
const SEARCH_TTL: u64 = 24 * 3600;
const MAX_LISTS: usize = 200;
const MAX_DETAILS: usize = 5000;
const MAX_SEARCHES: usize = 100;
/// At most this many pages of one list are served (50 each: the first 2000).
const MAX_PAGES: usize = 40;
/// How long a search answer waits for the details read that failed after it.
const FOUND_TTL: u64 = 600;
const QUOTA: &str = "quota";
const QUOTA_ALL: &str = "quota-all";
const NOT_FOUND: &str = "not found";

/// The fields mask of every `videos.list` call: titles, the channel's name, the length, the
/// embed and privacy flags and any region rule. Never the description or the tags.
const VIDEO_FIELDS: &str = "items(id,snippet(title,channelTitle),contentDetails(duration,regionRestriction),status(embeddable,privacyStatus))";

/// One of the owner's playlists, as the page sees it.
#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct YtPlaylist { id: String, title: String, count: u64, thumb: Option<String> }

/// One video, as the page sees it. `playable` is one of `yes`, `embed`, `private`, `removed`, `region`.
#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct YtVideo { id: String, title: String, channel: String, seconds: u64, thumb: Option<String>, playable: &'static str }

/// What `videos.list` told us about one video an own playlist holds. Each field is absent when Google gave none.
#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct YtDetail { id: String, title: Option<String>, channel: Option<String>, seconds: Option<u64> }

/// A page of answers and the token of the next page, if any.
#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct Page<T> { items: Vec<T>, next: Option<String> }

fn id_chars(s: &str, lengths: std::ops::RangeInclusive<usize>) -> bool {
    lengths.contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
}
fn valid_video_id(s: &str) -> bool { id_chars(s, 11..=11) }
fn valid_playlist_id(s: &str) -> bool { id_chars(s, 2..=64) }
fn valid_page_token(s: &str) -> bool { id_chars(s, 1..=128) }

fn unsafe_char(c: char) -> bool { c.is_control() || matches!(c, '\u{200b}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2060}'..='\u{206f}') }

/// A Google string with control and bidirectional characters out, trimmed and capped.
fn clean_text(value: Option<&Value>, max: usize) -> Option<String> {
    let s: String = value?.as_str()?.chars().filter(|c| !unsafe_char(*c)).collect();
    let s: String = s.trim().chars().take(max).collect();
    (!s.is_empty()).then_some(s)
}

/// Search words: trimmed, 1 to 100 characters, no control or bidirectional character.
fn check_query(text: &str) -> Option<String> {
    let q = text.trim();
    ((1..=100).contains(&q.chars().count()) && !q.chars().any(unsafe_char)).then(|| q.to_string())
}

/// `PT#H#M#S` only (each part optional, in that order), clamped to seven days. Anything else is `None`.
fn parse_duration(text: &str) -> Option<u64> {
    let mut rest = text.strip_prefix("PT")?;
    let mut total: u64 = 0;
    let mut last = 0;
    while !rest.is_empty() {
        let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 || digits > 9 { return None }
        let unit = rest.as_bytes().get(digits).copied()?;
        let rank = match unit { b'H' => 1, b'M' => 2, b'S' => 3, _ => return None };
        if rank <= last { return None }
        last = rank;
        let n: u64 = rest[..digits].parse().ok()?;
        total = total.saturating_add(n.saturating_mul(match rank { 1 => 3600, 2 => 60, _ => 1 }));
        rest = &rest[digits + 1..];
    }
    Some(total.min(MAX_SECONDS))
}

/// A video's picture, built from its checked id: no Google address crosses to the page.
fn video_thumb(id: &str) -> String { format!("https://i.ytimg.com/vi/{id}/mqdefault.jpg") }

/// A playlist's picture is taken from its snippet only when it is `https://i.ytimg.com/vi/<id>/...`
/// exactly (so no port, no user and no other host), then rebuilt from that id.
fn playlist_thumb(url: &str) -> Option<String> {
    if url.len() > 2048 { return None }
    let rest = url.strip_prefix("https://i.ytimg.com/vi/")?;
    let id = rest.get(..11)?;
    (valid_video_id(id) && rest[11..].starts_with('/')).then(|| video_thumb(id))
}

/// Can this video play outside YouTube? One of the fixed words.
fn playable_of(video: &Value) -> &'static str {
    if video.pointer("/status/privacyStatus").and_then(Value::as_str) == Some("private") { return "private" }
    if video.pointer("/status/embeddable").and_then(Value::as_bool) == Some(false) { return "embed" }
    if let Some(rule) = video.pointer("/contentDetails/regionRestriction") {
        let has = |key: &str| rule.get(key).and_then(Value::as_array).map(|list| list.iter().any(|c| c.as_str() == Some(REGION)));
        if has("blocked") == Some(true) || has("allowed") == Some(false) { return "region" }
    }
    "yes"
}

// ---- the Pacific day (the search budget resets at midnight Pacific) --------------------------

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn year_of_days(days: i64) -> i64 {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    yoe + era * 400 + if m <= 2 { 1 } else { 0 }
}

/// The first Sunday on or after a day (day 0 was a Thursday).
fn sunday_on_or_after(days: i64) -> i64 { days + (7 - (days + 4).rem_euclid(7)) % 7 }

/// The US rule: daylight time from 2:00 on the second Sunday of March (10:00 UTC) to 2:00 on
/// the first Sunday of November (09:00 UTC).
fn pacific_offset_hours(unix: i64) -> i64 {
    let year = year_of_days((unix - 8 * 3600).div_euclid(86_400));
    let start = (sunday_on_or_after(days_from_civil(year, 3, 1)) + 7) * 86_400 + 10 * 3600;
    let end = sunday_on_or_after(days_from_civil(year, 11, 1)) * 86_400 + 9 * 3600;
    if unix >= start && unix < end { -7 } else { -8 }
}

/// The day number (days since 1970-01-01) of a Unix time on a Pacific clock.
fn pacific_day(unix: u64) -> i64 {
    let t = i64::try_from(unix).unwrap_or(i64::MAX / 4);
    (t + pacific_offset_hours(t) * 3600).div_euclid(86_400)
}

fn unix_now() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) }

// ---- the cache (memory only, bounded, cleared with the session) -----------------------------

struct Cache<V> { map: std::collections::HashMap<String, (u64, u64, V)>, seq: u64, cap: usize }
impl<V: Clone> Cache<V> {
    fn new(cap: usize) -> Self { Self { map: std::collections::HashMap::new(), seq: 0, cap } }
    fn get(&self, key: &str, now: u64, ttl: u64) -> Option<V> {
        let (at, _, value) = self.map.get(key)?;
        (now.saturating_sub(*at) < ttl && now >= *at).then(|| value.clone())
    }
    fn put(&mut self, key: String, now: u64, value: V) {
        self.seq += 1;
        self.map.insert(key, (now, self.seq, value));
        while self.map.len() > self.cap {
            let Some(oldest) = self.map.iter().min_by_key(|(_, (_, seq, _))| *seq).map(|(k, _)| k.clone()) else { break };
            self.map.remove(&oldest);
        }
    }
    #[cfg(test)]
    fn len(&self) -> usize { self.map.len() }
}

/// What `videos.list` told us about one video.
#[derive(Clone)]
struct Detail { title: Option<String>, channel: Option<String>, seconds: u64, playable: &'static str }

struct Library {
    playlists: Cache<Page<YtPlaylist>>,
    /// A playlist's pages and the liked pages, by key.
    videos: Cache<Page<YtVideo>>,
    details: Cache<Detail>,
    searches: Cache<Page<YtVideo>>,
    /// The video ids a successful `search.list` answered, by words, until the details read has used them.
    found: Cache<Vec<String>>,
    /// Per list: pages served since its first page was last read, and the token that comes next.
    paging: Cache<(u32, Option<String>)>,
    category: Option<String>,
    search_day: i64,
    search_count: u32,
    details_hour: u64,
    details_count: u32,
    details_spent_day: i64,
}
impl Library {
    fn new() -> Self {
        Self { playlists: Cache::new(MAX_LISTS), videos: Cache::new(MAX_LISTS), details: Cache::new(MAX_DETAILS), searches: Cache::new(MAX_SEARCHES), found: Cache::new(MAX_SEARCHES), paging: Cache::new(MAX_LISTS), category: None, search_day: i64::MIN, search_count: 0, details_hour: u64::MAX, details_count: 0, details_spent_day: i64::MIN }
    }
    /// Searches made on this Pacific day so far.
    fn used(&mut self, now: u64) -> u32 {
        let day = pacific_day(now);
        if day != self.search_day { self.search_day = day; self.search_count = 0; }
        self.search_count
    }
}

static LIB: Mutex<Option<Library>> = Mutex::new(None);
/// Bumped by every clear. A read remembers the generation it started in and writes only while it is still
/// the current one, so a read in flight during a sign-out or a new sign-in never puts its page back.
static GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
fn lib_gen() -> u64 { GEN.load(Ordering::SeqCst) }
fn with_lib<R>(f: impl FnOnce(&mut Library) -> R) -> R { f(lock(&LIB).get_or_insert_with(Library::new)) }
/// Write to the library only if no clear happened since `gen`; `None` when the write was dropped.
fn put_lib<R>(gen: u64, f: impl FnOnce(&mut Library) -> R) -> Option<R> {
    let mut guard = lock(&LIB);
    if GEN.load(Ordering::SeqCst) != gen { return None }
    Some(f(guard.get_or_insert_with(Library::new)))
}
/// Empty every cache and start a new generation. With `keep_count` the day's search count stays: it belongs to
/// the Google client (its quota), not to the account that is signed in, so a new account does not get it back.
fn clear_library(keep_count: bool) {
    let mut guard = lock(&LIB);
    GEN.fetch_add(1, Ordering::SeqCst);
    let kept = if keep_count { guard.as_ref().map(|l| (l.search_day, l.search_count, l.details_hour, l.details_count, l.details_spent_day)) } else { None };
    *guard = kept.map(|(day, count, hour, details, spent_day)| {
        let mut l = Library::new();
        l.search_day = day;
        l.search_count = count;
        l.details_hour = hour;
        l.details_count = details;
        l.details_spent_day = spent_day;
        l
    });
}

/// Searches left today for the status: `Some` only while signed in.
fn searches_left(signed_in: bool, now: u64) -> Option<u32> {
    signed_in.then(|| SEARCH_DAILY.saturating_sub(with_lib(|l| l.used(now))))
}

// ---- one read -------------------------------------------------------------------------------

/// Everything a read needs, so each one runs with fakes.
struct Ctx<'a> { http: &'a dyn Http, creds: &'a dyn Creds, client: &'a Client, now: &'a dyn Fn() -> u64 }

fn api_url(endpoint: &str, params: &[(&str, &str)]) -> String {
    let query: Vec<String> = params.iter().map(|(k, v)| format!("{}={}", urlencoding::encode(k), urlencoding::encode(v))).collect();
    format!("{API}{endpoint}?{}", query.join("&"))
}

/// Only `error.errors[0].reason`, matched against a fixed list, and `error.status`, become a word.
fn read_error(reply: &HttpReply, search: bool) -> &'static str {
    let body: Value = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
    let reason = body.pointer("/error/errors/0/reason").and_then(Value::as_str).unwrap_or("");
    let status = body.pointer("/error/status").and_then(Value::as_str).unwrap_or("");
    match reply.status {
        400 => INVALID,
        401 => SIGN_AGAIN,
        403 => match reason {
            "quotaExceeded" | "dailyLimitExceeded" => if search { QUOTA } else { QUOTA_ALL },
            "rateLimitExceeded" | "userRateLimitExceeded" => BUSY,
            "accessNotConfigured" | "insufficientPermissions" => SETUP_BROKEN,
            "playlistNotFound" => NOT_FOUND,
            _ => if status == "RESOURCE_EXHAUSTED" { BUSY } else { DOWN },
        },
        404 => NOT_FOUND,
        429 => BUSY,
        _ => DOWN,
    }
}

fn reason_of(word: &str) -> crate::wall2_youtube_log::Reason {
    use crate::wall2_youtube_log::Reason;
    match word { QUOTA => Reason::Quota, QUOTA_ALL => Reason::QuotaAll, NOT_FOUND => Reason::NotFound, INVALID => Reason::Invalid, other => reason_for(other) }
}

/// One GET to a fixed endpoint with the bearer token. A 401 forces one refresh and one retry.
fn api_get(ctx: &Ctx, endpoint: &str, params: &[(&str, &str)], search: bool) -> Result<Value, &'static str> {
    api_get_sent(ctx, endpoint, params, search, &std::cell::Cell::new(false))
}

/// `api_get`, telling the caller whether a request left the machine (`sent` is set just before it does).
fn api_get_sent(ctx: &Ctx, endpoint: &str, params: &[(&str, &str)], search: bool, sent: &std::cell::Cell<bool>) -> Result<Value, &'static str> {
    use crate::wall2_youtube_log::{write, Event, Reason};
    let (ok, failed) = if search { (Event::SearchOk, Event::SearchFailed) } else { (Event::ReadOk, Event::ReadFailed) };
    let url = api_url(endpoint, params);
    let started = Instant::now();
    let mut forced = false;
    loop {
        let token = access_with(ctx.client, forced, ctx.http, ctx.creds)?;
        sent.set(true);
        let reply = match ctx.http.get(&url, &token, READ_BODY, READ_TIMEOUT) {
            Ok(r) => r,
            Err(()) => { write(failed, Reason::Down, 0, started.elapsed().as_millis()); return Err(DOWN) }
        };
        if reply.status == 401 && !forced { forced = true; continue }
        let outcome = if (200..300).contains(&reply.status) { serde_json::from_slice::<Value>(&reply.body).map_err(|_| DOWN) } else { Err(read_error(&reply, search)) };
        match &outcome {
            Ok(_) => write(ok, Reason::None, reply.status, started.elapsed().as_millis()),
            Err(word) => write(failed, reason_of(word), reply.status, started.elapsed().as_millis()),
        }
        return outcome;
    }
}

fn next_token(answer: &Value) -> Option<String> {
    answer.get("nextPageToken").and_then(Value::as_str).filter(|t| valid_page_token(t)).map(str::to_string)
}

fn check_token(token: Option<&str>) -> Result<Option<&str>, &'static str> {
    match token { Some(t) if !valid_page_token(t) => Err(INVALID), other => Ok(other) }
}

fn detail_of(video: &Value) -> Option<(String, Detail)> {
    let id = video.get("id")?.as_str().filter(|id| valid_video_id(id))?.to_string();
    let snippet = video.get("snippet");
    let seconds = video.pointer("/contentDetails/duration").and_then(Value::as_str).and_then(parse_duration).unwrap_or(0);
    Some((id, Detail {
        title: clean_text(snippet.and_then(|s| s.get("title")), 200),
        channel: clean_text(snippet.and_then(|s| s.get("channelTitle")), 100),
        seconds,
        playable: playable_of(video),
    }))
}

fn video_row(id: &str, detail: Option<&Detail>, title: Option<String>, channel: Option<String>, item_private: bool) -> YtVideo {
    let playable = if item_private { "private" } else { detail.map_or("removed", |d| d.playable) };
    YtVideo {
        id: id.to_string(),
        title: detail.and_then(|d| d.title.clone()).or(title).unwrap_or_else(|| "Untitled".to_string()),
        channel: detail.and_then(|d| d.channel.clone()).or(channel).unwrap_or_default(),
        seconds: detail.map_or(0, |d| d.seconds),
        thumb: Some(video_thumb(id)),
        playable,
    }
}

/// Details for these ids: from the cache while fresh (unless `fresh`), the rest from one
/// `videos.list` call per 50. Ids Google does not answer for are simply absent. `gen` is the library
/// generation the read started in: a write after a clear is dropped.
fn details_for(ctx: &Ctx, gen: u64, ids: &[String], fresh: bool) -> Result<std::collections::HashMap<String, Detail>, &'static str> {
    let now = (ctx.now)();
    let mut found = std::collections::HashMap::new();
    let mut missing: Vec<&str> = Vec::new();
    with_lib(|l| for id in ids {
        match (!fresh).then(|| l.details.get(id, now, DETAIL_TTL)).flatten() {
            Some(d) => { found.insert(id.clone(), d); }
            None if !missing.contains(&id.as_str()) => missing.push(id.as_str()),
            None => {}
        }
    });
    for chunk in missing.chunks(50) {
        let joined = chunk.join(",");
        let answer = api_get(ctx, EP_VIDEOS, &[("part", "snippet,contentDetails,status"), ("id", &joined), ("fields", VIDEO_FIELDS)], false)?;
        let got: Vec<(String, Detail)> = answer.get("items").and_then(Value::as_array).map(|a| a.iter().filter_map(detail_of).collect()).unwrap_or_default();
        put_lib(gen, |l| for (id, d) in &got { l.details.put(id.clone(), now, d.clone()); });
        for (id, d) in got { if chunk.contains(&id.as_str()) { found.insert(id, d); } }
    }
    Ok(found)
}

fn video_details_with(ctx: &Ctx, ids: &[String]) -> Result<Vec<YtDetail>, &'static str> {
    if ids.is_empty() || ids.len() > 50 || ids.iter().any(|id| !valid_video_id(id)) { return Err(INVALID) }
    let mut ordered = Vec::new();
    for id in ids { if !ordered.contains(id) { ordered.push(id.clone()); } }
    let now = (ctx.now)();
    let gen = lib_gen();
    let mut found = std::collections::HashMap::new();
    let mut missing = Vec::new();
    with_lib(|l| for id in &ordered {
        match l.details.get(id, now, DETAIL_TTL) {
            Some(detail) => { found.insert(id.clone(), detail); }
            None => missing.push(id.clone()),
        }
    });
    if !missing.is_empty() {
        let day = pacific_day(now);
        let hour = now / 3600;
        match put_lib(gen, |l| {
            if l.details_spent_day == day { return Err(QUOTA_ALL) }
            if l.details_hour != hour { l.details_hour = hour; l.details_count = 0; }
            if l.details_count >= DETAILS_HOURLY { return Err(BUSY) }
            l.details_count += 1;
            Ok(())
        }) {
            Some(Ok(())) => {}
            Some(Err(word)) => return Err(word),
            None => return Err(DOWN),
        }
        let joined = missing.join(",");
        let sent = std::cell::Cell::new(false);
        let answer = match api_get_sent(ctx, EP_VIDEOS, &[("part", "snippet,contentDetails,status"), ("id", &joined), ("fields", VIDEO_FIELDS)], false, &sent) {
            Ok(answer) => answer,
            Err(word) => {
                put_lib(gen, |l| {
                    if word == QUOTA_ALL { l.details_spent_day = day; }
                    else if !sent.get() { l.details_count = l.details_count.saturating_sub(1); }
                });
                return Err(word)
            }
        };
        let got: Vec<(String, Detail)> = answer.get("items").and_then(Value::as_array).map(|items| items.iter().filter_map(detail_of).collect()).unwrap_or_default();
        put_lib(gen, |l| for (id, detail) in &got { l.details.put(id.clone(), now, detail.clone()); });
        for (id, detail) in got { if missing.contains(&id) { found.insert(id, detail); } }
    }
    Ok(ordered.into_iter().filter_map(|id| {
        let detail = found.remove(&id)?;
        if detail.playable == "private" { return None }
        let seconds = (detail.seconds != 0).then_some(detail.seconds);
        if detail.title.is_none() && detail.channel.is_none() && seconds.is_none() { return None }
        Some(YtDetail { id, title: detail.title, channel: detail.channel, seconds })
    }).collect())
}

/// The paging rule of the three lists (the playlists, one playlist's videos, the liked videos): a first page
/// (no token) is always allowed; a later page only with the token the previous page handed out, and at most
/// `MAX_PAGES` pages of one list in all. Anything else is `invalid`, so no native command takes a made-up token.
fn page_check(list: &str, token: Option<&str>, now: u64) -> Result<(), &'static str> {
    let Some(token) = token else { return Ok(()) };
    let allowed = with_lib(|l| matches!(l.paging.get(list, now, u64::MAX), Some((n, Some(next))) if next == token && (n as usize) < MAX_PAGES));
    if allowed { Ok(()) } else { Err(INVALID) }
}

/// Remember that a page of `list` was served and which token comes next. A first page starts the count again.
fn page_served(gen: u64, list: &str, token: Option<&str>, next: &Option<String>, now: u64) {
    put_lib(gen, |l| {
        let n = if token.is_none() { 1 } else { l.paging.get(list, now, u64::MAX).map_or(1, |(n, _)| n + 1) };
        l.paging.put(list.to_string(), now, (n, next.clone()));
    });
}

/// The owner's playlists, a page at a time.
fn playlists_with(ctx: &Ctx, page_token: Option<&str>, fresh: bool) -> Result<Page<YtPlaylist>, &'static str> {
    let token = check_token(page_token)?;
    let key = format!("p:{}", token.unwrap_or(""));
    let now = (ctx.now)();
    let gen = lib_gen();
    page_check("p", token, now)?;
    if !fresh { if let Some(page) = with_lib(|l| l.playlists.get(&key, now, LISTS_TTL)) { page_served(gen, "p", token, &page.next, now); return Ok(page) } }
    let mut params = vec![("part", "snippet,contentDetails"), ("mine", "true"), ("maxResults", PAGE_SIZE),
        ("fields", "nextPageToken,items(id,snippet(title,thumbnails(default/url,medium/url,high/url)),contentDetails/itemCount)")];
    if let Some(t) = token { params.push(("pageToken", t)); }
    let answer = api_get(ctx, EP_PLAYLISTS, &params, false)?;
    let items = answer.get("items").and_then(Value::as_array).map(|list| list.iter().filter_map(|p| {
        let id = p.get("id")?.as_str().filter(|id| valid_playlist_id(id))?.to_string();
        let thumb = ["medium", "high", "default"].iter().find_map(|size| p.pointer(&format!("/snippet/thumbnails/{size}/url")).and_then(Value::as_str).and_then(playlist_thumb));
        Some(YtPlaylist { id, title: clean_text(p.pointer("/snippet/title"), 200).unwrap_or_else(|| "Untitled".to_string()), count: p.pointer("/contentDetails/itemCount").and_then(Value::as_u64).unwrap_or(0), thumb })
    }).collect()).unwrap_or_default();
    let page = Page { items, next: next_token(&answer) };
    put_lib(gen, |l| l.playlists.put(key, now, page.clone()));
    page_served(gen, "p", token, &page.next, now);
    Ok(page)
}

/// One page of a playlist's videos, with lengths and what will play outside YouTube.
fn items_with(ctx: &Ctx, playlist_id: &str, page_token: Option<&str>, fresh: bool) -> Result<Page<YtVideo>, &'static str> {
    if !valid_playlist_id(playlist_id) { return Err(INVALID) }
    let token = check_token(page_token)?;
    let key = format!("i:{playlist_id}:{}", token.unwrap_or(""));
    let list = format!("i:{playlist_id}");
    let now = (ctx.now)();
    let gen = lib_gen();
    page_check(&list, token, now)?;
    if !fresh { if let Some(page) = with_lib(|l| l.videos.get(&key, now, LISTS_TTL)) { page_served(gen, &list, token, &page.next, now); return Ok(page) } }
    let mut params = vec![("part", "snippet,status"), ("playlistId", playlist_id), ("maxResults", PAGE_SIZE),
        ("fields", "nextPageToken,items(snippet(title,videoOwnerChannelTitle,resourceId(kind,videoId)),status/privacyStatus)")];
    if let Some(t) = token { params.push(("pageToken", t)); }
    let answer = api_get(ctx, EP_ITEMS, &params, false)?;
    // (id, title, channel, private) of each real video item, in order.
    let entries: Vec<(String, Option<String>, Option<String>, bool)> = answer.get("items").and_then(Value::as_array).map(|list| list.iter().filter_map(|item| {
        if item.pointer("/snippet/resourceId/kind").and_then(Value::as_str) != Some("youtube#video") { return None }
        let id = item.pointer("/snippet/resourceId/videoId")?.as_str().filter(|id| valid_video_id(id))?.to_string();
        let private = item.pointer("/status/privacyStatus").and_then(Value::as_str) == Some("private");
        Some((id, clean_text(item.pointer("/snippet/title"), 200), clean_text(item.pointer("/snippet/videoOwnerChannelTitle"), 100), private))
    }).collect()).unwrap_or_default();
    let ids: Vec<String> = entries.iter().map(|e| e.0.clone()).collect();
    let details = if ids.is_empty() { Default::default() } else { details_for(ctx, gen, &ids, fresh)? };
    let items = entries.into_iter().map(|(id, title, channel, private)| video_row(&id, details.get(&id), title, channel, private)).collect();
    let page = Page { items, next: next_token(&answer) };
    put_lib(gen, |l| l.videos.put(key, now, page.clone()));
    page_served(gen, &list, token, &page.next, now);
    Ok(page)
}

/// One page of the owner's liked videos (`videos.list` with `myRating=like`).
fn liked_with(ctx: &Ctx, page_token: Option<&str>, fresh: bool) -> Result<Page<YtVideo>, &'static str> {
    let token = check_token(page_token)?;
    let key = format!("l:{}", token.unwrap_or(""));
    let now = (ctx.now)();
    let gen = lib_gen();
    page_check("l", token, now)?;
    if !fresh { if let Some(page) = with_lib(|l| l.videos.get(&key, now, LIKED_TTL)) { page_served(gen, "l", token, &page.next, now); return Ok(page) } }
    let fields = format!("nextPageToken,{VIDEO_FIELDS}");
    let mut params = vec![("part", "snippet,contentDetails,status"), ("myRating", "like"), ("maxResults", PAGE_SIZE), ("fields", fields.as_str())];
    if let Some(t) = token { params.push(("pageToken", t)); }
    let answer = api_get(ctx, EP_VIDEOS, &params, false)?;
    let got: Vec<(String, Detail)> = answer.get("items").and_then(Value::as_array).map(|a| a.iter().filter_map(detail_of).collect()).unwrap_or_default();
    put_lib(gen, |l| for (id, d) in &got { l.details.put(id.clone(), now, d.clone()); });
    let items = got.iter().map(|(id, d)| video_row(id, Some(d), None, None, false)).collect();
    let page = Page { items, next: next_token(&answer) };
    put_lib(gen, |l| l.videos.put(key, now, page.clone()));
    page_served(gen, "l", token, &page.next, now);
    Ok(page)
}

/// The id of the Music category: one `videoCategories.list` per run, `10` when it cannot be read.
fn music_category(ctx: &Ctx, gen: u64) -> String {
    if let Some(c) = with_lib(|l| l.category.clone()) { return c }
    let params = [("part", "snippet"), ("regionCode", REGION), ("fields", "items(id,snippet(title,assignable))")];
    let found = api_get(ctx, EP_CATEGORIES, &params, false).ok().and_then(|answer| {
        answer.get("items").and_then(Value::as_array)?.iter().find_map(|c| {
            let id = c.get("id")?.as_str().filter(|id| (1..=3).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_digit()))?;
            let music = c.pointer("/snippet/title").and_then(Value::as_str) == Some("Music") && c.pointer("/snippet/assignable").and_then(Value::as_bool) != Some(false);
            music.then(|| id.to_string())
        })
    });
    match found {
        Some(id) => { put_lib(gen, |l| l.category = Some(id.clone())); id }
        None => "10".to_string(),
    }
}

/// One search in flight: the first caller with these words runs it, the others with the same words wait for its answer.
struct Flight { done: Mutex<Option<Result<Page<YtVideo>, &'static str>>>, ready: std::sync::Condvar }
static FLIGHTS: Mutex<Vec<(String, std::sync::Arc<Flight>)>> = Mutex::new(Vec::new());
/// Held by the caller that runs a search; ends the flight (with `down` if it never finished) when dropped.
struct Lead { key: String, flight: std::sync::Arc<Flight> }
impl Lead {
    fn finish(&self, result: Result<Page<YtVideo>, &'static str>) { *lock(&self.flight.done) = Some(result); }
}
impl Drop for Lead {
    fn drop(&mut self) {
        let mut done = lock(&self.flight.done);
        if done.is_none() { *done = Some(Err(DOWN)); }
        drop(done);
        lock(&FLIGHTS).retain(|(k, f)| !(k == &self.key && std::sync::Arc::ptr_eq(f, &self.flight)));
        self.flight.ready.notify_all();
    }
}
enum Joined { Lead(Lead), Follow(std::sync::Arc<Flight>) }
fn join_flight(key: &str) -> Joined {
    let mut flights = lock(&FLIGHTS);
    if let Some((_, f)) = flights.iter().find(|(k, _)| k == key) { return Joined::Follow(f.clone()) }
    let flight = std::sync::Arc::new(Flight { done: Mutex::new(None), ready: std::sync::Condvar::new() });
    flights.push((key.to_string(), flight.clone()));
    Joined::Lead(Lead { key: key.to_string(), flight })
}
/// How long a follower waits for the search it shares (three reads of 6 s each, and a little more).
const FLIGHT_WAIT: Duration = Duration::from_secs(25);
fn wait_for(flight: &Flight) -> Result<Page<YtVideo>, &'static str> {
    let mut done = lock(&flight.done);
    let until = Instant::now() + FLIGHT_WAIT;
    while done.is_none() {
        let left = until.saturating_duration_since(Instant::now());
        if left.is_zero() { return Err(DOWN) }
        done = flight.ready.wait_timeout(done, left).map(|(g, _)| g).unwrap_or_else(|e| e.into_inner().0);
    }
    done.clone().unwrap_or(Err(DOWN))
}

/// A music search: the same words again are answered from memory and cost nothing, the same words already
/// in flight share one call, and the day's budget is reserved before the call (so two calls starting at 99 do
/// not both go out) and given back only when no request left the machine.
fn search_with(ctx: &Ctx, text: &str) -> Result<Page<YtVideo>, &'static str> {
    let query = check_query(text).ok_or(INVALID)?;
    let key = query.to_lowercase();
    let now = (ctx.now)();
    let gen = lib_gen();
    if let Some(page) = with_lib(|l| l.searches.get(&key, now, SEARCH_TTL)) { return Ok(page) }
    let lead = match join_flight(&key) { Joined::Follow(flight) => return wait_for(&flight), Joined::Lead(lead) => lead };
    // The same words may have been answered while this call waited to start.
    let result = match with_lib(|l| l.searches.get(&key, now, SEARCH_TTL)) { Some(page) => Ok(page), None => search_run(ctx, gen, &query, &key, now) };
    lead.finish(result.clone());
    result
}

fn search_run(ctx: &Ctx, gen: u64, query: &str, key: &str, now: u64) -> Result<Page<YtVideo>, &'static str> {
    // A search that succeeded while its details read failed keeps its answer: a retry reads the details only.
    let kept = with_lib(|l| l.found.get(key, now, FOUND_TTL));
    let ids = match kept {
        Some(ids) => ids,
        None => {
            let day = pacific_day(now);
            match put_lib(gen, |l| if l.used(now) >= SEARCH_DAILY { false } else { l.search_count += 1; true }) {
                Some(true) => {}
                Some(false) => return Err(QUOTA),
                None => return Err(DOWN),
            }
            let category = music_category(ctx, gen);
            let params = [("part", "snippet"), ("type", "video"), ("videoCategoryId", category.as_str()), ("videoEmbeddable", "true"),
                ("maxResults", SEARCH_SIZE), ("q", query), ("fields", "items(id/videoId)")];
            let sent = std::cell::Cell::new(false);
            let answer = match api_get_sent(ctx, EP_SEARCH, &params, true, &sent) {
                Ok(a) => a,
                Err(word) => {
                    if word == QUOTA { put_lib(gen, |l| { l.used(now); l.search_count = SEARCH_DAILY; }); }
                    else if !sent.get() { put_lib(gen, |l| if l.search_day == day && l.search_count > 0 { l.search_count -= 1; }); }
                    return Err(word);
                }
            };
            let ids: Vec<String> = answer.get("items").and_then(Value::as_array).map(|list| list.iter().filter_map(|item| {
                item.pointer("/id/videoId")?.as_str().filter(|id| valid_video_id(id)).map(str::to_string)
            }).collect()).unwrap_or_default();
            put_lib(gen, |l| l.found.put(key.to_string(), now, ids.clone()));
            ids
        }
    };
    let details = if ids.is_empty() { Default::default() } else { details_for(ctx, gen, &ids, false)? };
    let items = ids.iter().filter_map(|id| details.get(id).map(|d| video_row(id, Some(d), None, None, false))).collect();
    let page = Page { items, next: None };
    put_lib(gen, |l| { l.searches.put(key.to_string(), now, page.clone()); });
    Ok(page)
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
    struct FakeHttp { replies: Mutex<VecDeque<Result<HttpReply, ()>>>, calls: Mutex<Vec<Call>>, gets: Mutex<VecDeque<Result<HttpReply, ()>>>, get_calls: Mutex<Vec<(String, String)>> }
    impl FakeHttp {
        fn new(replies: Vec<Result<HttpReply, ()>>) -> Self { Self { replies: Mutex::new(replies.into()), calls: Mutex::new(Vec::new()), gets: Mutex::new(VecDeque::new()), get_calls: Mutex::new(Vec::new()) } }
        /// Answers for the reads (GET); `posts` answer the token calls.
        fn reads(gets: Vec<Result<HttpReply, ()>>, posts: Vec<Result<HttpReply, ()>>) -> Self { let h = Self::new(posts); *lock(&h.gets) = gets.into(); h }
        fn get_urls(&self) -> Vec<String> { lock(&self.get_calls).iter().map(|c| c.0.clone()).collect() }
        fn calls(&self) -> Vec<Call> { lock(&self.calls).clone() }
        fn urls(&self) -> Vec<String> { self.calls().into_iter().map(|c| c.0).collect() }
    }
    impl Http for FakeHttp {
        fn post_form(&self, url: &str, form: &[(&str, &str)], _timeout: Duration) -> Result<HttpReply, ()> {
            lock(&self.calls).push((url.to_string(), form.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()));
            lock(&self.replies).pop_front().unwrap_or(Err(()))
        }
        fn get(&self, url: &str, bearer: &str, _limit: u64, _timeout: Duration) -> Result<HttpReply, ()> {
            lock(&self.get_calls).push((url.to_string(), bearer.to_string()));
            lock(&self.gets).pop_front().unwrap_or(Err(()))
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
        // A stored entry that cannot be read back is a broken setup, and the file is never consulted then.
        for damaged in ["{not valid", r#"{"clientId":"x","clientSecret":"y"}"#, "[]", ""] {
            *lock(&creds.client) = Some(damaged.into());
            let mut asked = false;
            assert_eq!(resolve_client(&creds, || { asked = true; Some(client()) }), Err(UNREADABLE), "{damaged}");
            assert!(!asked, "the file must not be consulted: {damaged}");
        }
        *lock(&creds.client) = None;
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
        while started.elapsed() < Duration::from_secs(10) {
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
            assert_eq!(token_reply(reply(status, r#"{"error":"invalid_client"}"#)), TokenReply::SetupBroken(status));
            assert_eq!(token_reply(reply(status, r#"{"error":"unauthorized_client"}"#)), TokenReply::SetupBroken(status));
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
        fn get(&self, _: &str, _: &str, _: u64, _: Duration) -> Result<HttpReply, ()> { Err(()) }
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
            assert_eq!(status_with(&creds, || None), Status { setup: true, signed_in: true, reason: Some(SETUP_BROKEN.into()), searches_left: Some(100) });
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
        assert_eq!(signed, Status { setup: true, signed_in: true, reason: None, searches_left: Some(100) });
        set_note(Some(SETUP_BROKEN));
        assert_eq!(status_with(&creds, || Some(client())).reason.as_deref(), Some(SETUP_BROKEN));
        set_note(Some(SIGN_AGAIN));
        *lock(&creds.refresh) = None;
        assert_eq!(status_with(&creds, || Some(client())), Status { setup: true, signed_in: false, reason: Some(SIGN_AGAIN.into()), searches_left: None });
        creds.client_read_fails.store(true, Ordering::SeqCst);
        assert_eq!(status_with(&creds, || Some(client())).reason.as_deref(), Some(FAILED));
        let text = serde_json::to_string(&signed).unwrap();
        assert_eq!(text, r#"{"setup":true,"signedIn":true,"reason":null,"searchesLeft":100}"#);
        for secret in [good_id(), good_secret(), "stored-refresh".to_string()] { assert!(!text.contains(&secret)); }
    }

    #[test]
    fn signed_in_always_comes_from_the_stored_token() {
        let _t = exclusive();
        // A token and no usable client (the file was renamed): signed in, and the word says the setup is missing.
        let creds = FakeCreds::new(Some("stored-refresh"));
        assert_eq!(status_with(&creds, || None), Status { setup: false, signed_in: true, reason: Some(SETUP_MISSING.into()), searches_left: Some(100) });
        // The same with the client's read failing: still signed in, so Sign out stays reachable.
        creds.client_read_fails.store(true, Ordering::SeqCst);
        assert_eq!(status_with(&creds, || None), Status { setup: false, signed_in: true, reason: Some(FAILED.into()), searches_left: Some(100) });
        creds.client_read_fails.store(false, Ordering::SeqCst);
        // A damaged stored client with a token: broken setup, signed in.
        *lock(&creds.client) = Some("{damaged".into());
        assert_eq!(status_with(&creds, || Some(client())), Status { setup: true, signed_in: true, reason: Some(UNREADABLE.into()), searches_left: Some(100) });
        // The same without a token: broken setup, signed out, so Set up is allowed.
        *lock(&creds.refresh) = None;
        assert_eq!(status_with(&creds, || Some(client())), Status { setup: true, signed_in: false, reason: Some(UNREADABLE.into()), searches_left: None });
        // Setting it up again repairs it.
        assert_eq!(set_client_with(&creds, &good_id(), &good_secret()), Ok(()));
        assert_eq!(status_with(&creds, || None), Status { setup: true, signed_in: false, reason: None, searches_left: None });
    }

    #[test]
    fn signing_out_needs_no_client() {
        let _t = exclusive();
        let creds = FakeCreds::new(Some("stored-refresh"));
        assert_eq!(resolve_client(&creds, || None), Err(NOT_SETUP));
        let http = FakeHttp::new(vec![reply(200, "")]);
        sign_out_with(&http, &creds);
        assert_eq!(http.calls(), [(REVOKE_URL.to_string(), vec![("token".to_string(), "stored-refresh".to_string())])]);
        assert_eq!(creds.refresh_value(), None);
        // And when the revoke cannot even be made, everything is still cleared.
        *lock(&creds.refresh) = Some("stored-refresh".into());
        sign_out_with(&FakeHttp::new(vec![Err(())]), &creds);
        assert_eq!(creds.refresh_value(), None);
        assert_eq!(status_with(&creds, || None).reason.as_deref(), Some(NOT_SETUP));
    }

    #[test]
    fn status_says_a_sign_in_is_waiting_and_cancel_ends_it() {
        let _t = exclusive();
        let creds = FakeCreds::new(None);
        let (_client, running) = begin_sign_in(&creds, || Some(client())).unwrap();
        // A page reloaded in the middle of the sign-in asks and is told.
        assert_eq!(status_with(&creds, || Some(client())), Status { setup: true, signed_in: false, reason: Some(SIGNING.into()), searches_left: None });
        // A second Sign in is refused as busy, not started over.
        assert_eq!(begin_sign_in(&creds, || Some(client())).err(), Some(BUSY));
        // Cancel ends the waiting listener, and once the guard is gone the status is plain again.
        CANCEL_SIGN_IN.store(true, Ordering::SeqCst);
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        assert_eq!(listen_for_code(server, "s", Duration::from_secs(5), || CANCEL_SIGN_IN.load(Ordering::SeqCst)), Err(CANCELLED));
        drop(running);
        assert_eq!(status_with(&creds, || Some(client())), Status { setup: true, signed_in: false, reason: None, searches_left: None });
    }

    #[test]
    fn a_refused_client_logs_the_real_status() {
        let _t = exclusive();
        let creds = FakeCreds::new(Some("keep-refresh"));
        let http = FakeHttp::new(vec![reply(401, r#"{"error":"invalid_client"}"#)]);
        assert_eq!(access_with(&client(), true, &http, &creds), Err(SETUP_BROKEN));
        assert!(crate::wall2_youtube_log::test_lines().iter().any(|l| l.starts_with("refresh-refused setup-broken 401 ")));
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
        // A stored token refuses a new sign-in, so a stale page cannot leave the old grant unrevoked.
        let signed = FakeCreds::new(Some("stored-refresh"));
        assert_eq!(begin_sign_in(&signed, || Some(client())).err(), Some(SIGN_OUT_FIRST));
        assert!(!SIGNING_IN.load(Ordering::SeqCst), "a refusal must leave the flag alone");
        assert_eq!(signed.refresh_value().as_deref(), Some("stored-refresh"));
    }

    // ---- the library reads ----------------------------------------------------------------

    const T0: u64 = 1_800_000_000;
    const VID_A: &str = "AAAAAAAAAAA";
    const VID_B: &str = "BBBBBBBBBBB";
    const VID_C: &str = "CCCCCCCCCCC";
    const VID_D: &str = "DDDDDDDDDDD";
    const VID_E: &str = "EEEEEEEEEEE";
    const VID_F: &str = "FFFFFFFFFFF";

    fn utc(y: i64, m: i64, d: i64, h: i64, mi: i64) -> u64 { (days_from_civil(y, m, d) * 86_400 + h * 3600 + mi * 60) as u64 }
    fn token_in_memory() { *lock(&TOKEN) = Some(Token { access: "access-one".into(), expires: Instant::now() + Duration::from_secs(3600) }); }
    fn ok(body: Value) -> Result<HttpReply, ()> { reply(200, &body.to_string()) }
    fn run<R>(http: &FakeHttp, creds: &FakeCreds, now: &std::sync::atomic::AtomicU64, f: impl FnOnce(&Ctx) -> R) -> R {
        let c = client();
        let clock = || now.load(Ordering::SeqCst);
        f(&Ctx { http, creds, client: &c, now: &clock })
    }
    fn clock(at: u64) -> std::sync::atomic::AtomicU64 { std::sync::atomic::AtomicU64::new(at) }
    fn video(id: &str, title: &str, duration: &str, extra: Value) -> Value {
        let mut v = json!({ "id": id, "snippet": { "title": title, "channelTitle": "Mira Vale" }, "contentDetails": { "duration": duration }, "status": { "embeddable": true, "privacyStatus": "public" } });
        for (k, val) in extra.as_object().cloned().unwrap_or_default() { v[k] = val; }
        v
    }
    fn item(kind: &str, id: &str, title: &str) -> Value { json!({ "snippet": { "title": title, "videoOwnerChannelTitle": "Aurora Set", "resourceId": { "kind": kind, "videoId": id } }, "status": { "privacyStatus": "public" } }) }
    fn playlist(id: &str, title: &str, count: u64, thumb: &str) -> Value { json!({ "id": id, "snippet": { "title": title, "thumbnails": { "medium": { "url": thumb } } }, "contentDetails": { "itemCount": count } }) }

    #[test]
    fn own_details_refuse_bad_input_without_a_request() {
        let _t = exclusive();
        clear_library(false);
        token_in_memory();
        let http = FakeHttp::reads(vec![], vec![]);
        let creds = FakeCreds::new(Some("stored-refresh"));
        let at = clock(T0);
        let mut cases = vec![vec![], vec!["A".repeat(10)], vec!["A".repeat(12)], vec!["AAAAA!AAAAA".into()], vec!["AAAAA AAAAA".into()], vec!["AAAAAéAAAA".into()]];
        cases.push((0..51).map(|i| format!("V{i:010}")).collect());
        for ids in cases { assert_eq!(run(&http, &creds, &at, |c| video_details_with(c, &ids)).err(), Some(INVALID)); }
        assert!(http.get_urls().is_empty());
    }

    #[test]
    fn own_details_make_one_checked_request_and_shape_the_answer() {
        let _t = exclusive();
        clear_library(false);
        token_in_memory();
        let long_title = format!("A\u{202e}\n{}", "x".repeat(5000));
        let mut private = video(VID_C, "Hidden", "PT4M", json!({}));
        private["status"]["privacyStatus"] = json!("private");
        let answer = json!({ "items": [
            video(VID_B, "Second", "PT1H2M40S", json!({})),
            video(VID_A, &long_title, "PT4M", json!({ "snippet": { "title": long_title, "channelTitle": "c".repeat(150) } })),
            { "id": VID_D, "snippet": { "title": "Calendar", "channelTitle": "Channel" }, "contentDetails": { "duration": "P0D" }, "status": { "privacyStatus": "public" } },
            { "id": VID_E, "snippet": { "title": "Live", "channelTitle": "Channel" }, "status": { "privacyStatus": "public" } },
            video(VID_F, "Malformed", "PT1M2H", json!({})),
            private,
            video("bad id here", "Bad", "PT1M", json!({}))
        ] });
        let http = FakeHttp::reads(vec![ok(answer)], vec![]);
        let ids = vec![VID_A.into(), VID_B.into(), VID_C.into(), VID_D.into(), VID_E.into(), VID_F.into(), VID_A.into()];
        let got = run(&http, &FakeCreds::new(Some("stored-refresh")), &clock(T0), |c| video_details_with(c, &ids)).unwrap();
        assert_eq!(got.iter().map(|d| d.id.as_str()).collect::<Vec<_>>(), [VID_A, VID_B, VID_D, VID_E, VID_F]);
        assert_eq!(got[0].title.as_ref().unwrap().chars().count(), 200);
        assert!(!got[0].title.as_ref().unwrap().contains('\u{202e}') && !got[0].title.as_ref().unwrap().contains('\n'));
        assert_eq!(got[0].channel.as_ref().unwrap().chars().count(), 100);
        assert_eq!(got[0].seconds, Some(240));
        assert_eq!(got[1].seconds, Some(3760));
        assert_eq!(got[2], YtDetail { id: VID_D.into(), title: Some("Calendar".into()), channel: Some("Channel".into()), seconds: None });
        assert_eq!(got[3].seconds, None);
        assert_eq!(got[4].seconds, None);
        let calls = lock(&http.get_calls).clone();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].1, "access-one");
        let expected = api_url(EP_VIDEOS, &[("part", "snippet,contentDetails,status"), ("id", &ids[..6].join(",")), ("fields", VIDEO_FIELDS)]);
        assert_eq!(calls[0].0, expected);
        let before = crate::wall2_youtube_log::test_lines().len();
        assert!(run(&http, &FakeCreds::new(Some("stored-refresh")), &clock(T0 + 1), |c| video_details_with(c, &[VID_A.into(), VID_B.into()])).is_ok());
        assert_eq!(http.get_urls().len(), 1, "the second read is entirely cached");
        let lines = crate::wall2_youtube_log::test_lines();
        assert!(lines[..before].iter().any(|line| line.starts_with("read-ok none 200 ")));
        assert!(!lines.iter().any(|line| line.contains(VID_A) || line.contains("Second") || line.contains("Channel")));
    }

    #[test]
    fn own_details_cache_only_requests_new_ids() {
        let _t = exclusive();
        clear_library(false);
        token_in_memory();
        let http = FakeHttp::reads(vec![ok(json!({ "items": [video(VID_A, "One", "PT1M", json!({}))] })), ok(json!({ "items": [video(VID_B, "Two", "PT2M", json!({}))] }))], vec![]);
        let creds = FakeCreds::new(Some("stored-refresh"));
        let at = clock(T0);
        assert!(run(&http, &creds, &at, |c| video_details_with(c, &[VID_A.into()])).is_ok());
        let got = run(&http, &creds, &at, |c| video_details_with(c, &[VID_A.into(), VID_B.into()])).unwrap();
        assert_eq!(got.len(), 2);
        assert!(http.get_urls()[1].contains(&format!("id={VID_B}")));
        assert!(!http.get_urls()[1].contains(VID_A));
    }

    #[test]
    fn own_details_hour_quota_and_clear_rules_hold() {
        let _t = exclusive();
        clear_library(false);
        token_in_memory();
        with_lib(|l| { l.details_hour = T0 / 3600; l.details_count = DETAILS_HOURLY; });
        let at = clock(T0);
        let creds = FakeCreds::new(Some("stored-refresh"));
        let blocked = FakeHttp::reads(vec![], vec![]);
        assert_eq!(run(&blocked, &creds, &at, |c| video_details_with(c, &[VID_A.into()])).err(), Some(BUSY));
        assert!(blocked.get_urls().is_empty());
        at.store(T0 + 3600, Ordering::SeqCst);
        let next = FakeHttp::reads(vec![ok(json!({ "items": [video(VID_A, "One", "PT1M", json!({}))] }))], vec![]);
        assert!(run(&next, &creds, &at, |c| video_details_with(c, &[VID_A.into()])).is_ok());

        clear_library(false);
        token_in_memory();
        at.store(T0, Ordering::SeqCst);
        let quota = FakeHttp::reads(vec![reply(403, r#"{"error":{"errors":[{"reason":"quotaExceeded"}]}}"#)], vec![]);
        assert_eq!(run(&quota, &creds, &at, |c| video_details_with(c, &[VID_B.into()])).err(), Some(QUOTA_ALL));
        assert_eq!(run(&quota, &creds, &at, |c| video_details_with(c, &[VID_C.into()])).err(), Some(QUOTA_ALL));
        assert_eq!(quota.get_urls().len(), 1);
        at.store(T0 + 86_400, Ordering::SeqCst);
        let tomorrow = FakeHttp::reads(vec![ok(json!({ "items": [video(VID_C, "Three", "PT3M", json!({}))] }))], vec![]);
        assert!(run(&tomorrow, &creds, &at, |c| video_details_with(c, &[VID_C.into()])).is_ok());

        with_lib(|l| { l.details_hour = 9; l.details_count = 7; l.details_spent_day = 11; });
        clear_library(true);
        assert_eq!(with_lib(|l| (l.details_hour, l.details_count, l.details_spent_day)), (9, 7, 11));
        clear_library(false);
        assert_eq!(with_lib(|l| (l.details_hour, l.details_count, l.details_spent_day)), (u64::MAX, 0, i64::MIN));
    }

    #[test]
    fn own_details_refund_only_when_no_request_left() {
        let _t = exclusive();
        clear_library(false);
        *lock(&TOKEN) = None;
        let creds = FakeCreds::new(Some("stored-refresh"));
        let before_send = FakeHttp::reads(vec![], vec![Err(())]);
        assert_eq!(run(&before_send, &creds, &clock(T0), |c| video_details_with(c, &[VID_A.into()])).err(), Some(DOWN));
        assert_eq!(with_lib(|l| l.details_count), 0);
        token_in_memory();
        let after_send = FakeHttp::reads(vec![Err(())], vec![]);
        assert_eq!(run(&after_send, &creds, &clock(T0), |c| video_details_with(c, &[VID_A.into()])).err(), Some(DOWN));
        assert_eq!(with_lib(|l| l.details_count), 1);
        clear_library(false);
        *lock(&TOKEN) = None;
        let signed_out = FakeHttp::reads(vec![], vec![]);
        assert_eq!(run(&signed_out, &FakeCreds::new(None), &clock(T0), |c| video_details_with(c, &[VID_A.into()])).err(), Some(SIGN_AGAIN));
        assert!(signed_out.get_urls().is_empty());
    }

    #[test]
    fn playlists_come_back_as_shaped_records_with_a_rebuilt_thumbnail() {
        let _t = exclusive(); token_in_memory();
        let thumb = format!("https://i.ytimg.com/vi/{VID_A}/hqdefault.jpg?sqp=secret&rs=x");
        let http = FakeHttp::reads(vec![ok(json!({ "nextPageToken": "NEXT_page-1", "items": [playlist("PLnight_drive", "Night Drive", 41, &thumb), playlist("PLbare", "Rainy Window", 28, "http://i.ytimg.com/vi/AAAAAAAAAAA/default.jpg"), playlist("x", "too short id", 1, ""), playlist("bad id!", "bad", 1, "")] }))], vec![]);
        let page = run(&http, &FakeCreds::new(Some("stored-refresh")), &clock(T0), |c| playlists_with(c, None, false)).unwrap();
        assert_eq!(page.next.as_deref(), Some("NEXT_page-1"));
        assert_eq!(page.items, vec![
            YtPlaylist { id: "PLnight_drive".into(), title: "Night Drive".into(), count: 41, thumb: Some(format!("https://i.ytimg.com/vi/{VID_A}/mqdefault.jpg")) },
            YtPlaylist { id: "PLbare".into(), title: "Rainy Window".into(), count: 28, thumb: None },
        ]);
        let calls = lock(&http.get_calls).clone();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].1, "access-one");
        for part in ["playlists?", "mine=true", "maxResults=50", "&fields="] { assert!(calls[0].0.contains(part), "{part}"); }
        assert!(!calls[0].0.contains("pageToken"));
        let serialized = serde_json::to_string(&page).unwrap();
        assert!(serialized.starts_with(r#"{"items":[{"id":"PLnight_drive","title":"Night Drive","count":41,"thumb":"#));
        assert!(!serialized.contains("secret") && !serialized.contains("sqp"));
    }

    #[test]
    fn a_playlist_marks_each_kind_of_row_and_drops_what_is_not_a_video() {
        let _t = exclusive(); token_in_memory();
        let mut private_item = item("youtube#video", VID_C, "Violet Hour");
        private_item["status"]["privacyStatus"] = json!("private");
        let items = json!({ "nextPageToken": "tok_2", "items": [
            item("youtube#video", VID_A, "Glass Harbor"),
            item("youtube#video", VID_B, "Low Tide Motel"),
            private_item,
            item("youtube#video", VID_D, "Static Bloom"),
            item("youtube#video", VID_E, "Deleted video"),
            item("youtube#video", VID_F, "Cassette Rain"),
            item("youtube#channel", "GGGGGGGGGGG", "A channel"),
            item("youtube#video", "HHHHHHHHHH", "ten characters"),
            item("youtube#video", "IIIIIIIIIIII", "twelve characters"),
            item("youtube#video", "JJJJJJJJJJ&", "an ampersand"),
        ] });
        let videos = json!({ "items": [
            video(VID_A, "Glass Harbor", "PT3M34S", json!({})),
            video(VID_B, "Low Tide Motel", "PT1H2M3S", json!({ "status": { "embeddable": false, "privacyStatus": "public" } })),
            video(VID_D, "Static Bloom", "PT5M21S", json!({ "contentDetails": { "duration": "PT5M21S", "regionRestriction": { "blocked": ["US", "CA"] } } })),
            video(VID_F, "Cassette Rain", "PT4M2S", json!({ "contentDetails": { "duration": "PT4M2S", "regionRestriction": { "allowed": ["DE"] } } })),
        ] });
        let http = FakeHttp::reads(vec![ok(items), ok(videos)], vec![]);
        let page = run(&http, &FakeCreds::new(Some("stored-refresh")), &clock(T0), |c| items_with(c, "PLnight_drive", None, false)).unwrap();
        let rows: Vec<(&str, &str, u64, &str)> = page.items.iter().map(|v| (v.id.as_str(), v.title.as_str(), v.seconds, v.playable)).collect();
        assert_eq!(rows, vec![
            (VID_A, "Glass Harbor", 214, "yes"),
            (VID_B, "Low Tide Motel", 3723, "embed"),
            (VID_C, "Violet Hour", 0, "private"),
            (VID_D, "Static Bloom", 321, "region"),
            (VID_E, "Deleted video", 0, "removed"),
            (VID_F, "Cassette Rain", 242, "region"),
        ]);
        assert_eq!(page.next.as_deref(), Some("tok_2"));
        assert_eq!(page.items[0].thumb.as_deref(), Some(format!("https://i.ytimg.com/vi/{VID_A}/mqdefault.jpg").as_str()));
        let urls = http.get_urls();
        assert!(urls[0].contains("playlistItems?") && urls[0].contains("playlistId=PLnight_drive") && urls[0].contains("&fields="));
        // Only the checked ids are joined into the videos call (the comma is encoded).
        let joined = ["AAAAAAAAAAA", "BBBBBBBBBBB", "CCCCCCCCCCC", "DDDDDDDDDDD", "EEEEEEEEEEE", "FFFFFFFFFFF"].join("%2C");
        assert!(urls[1].contains("videos?") && urls[1].contains(&format!("id={joined}&")) || urls[1].contains(&format!("id={joined}")), "{}", urls[1]);
        assert!(!urls[1].contains("GGGGGGGGGGG") && !urls[1].contains("HHHHHHHHHH") && !urls[1].contains("IIIIIIIIIIII"));
    }

    #[test]
    fn each_playable_word_comes_from_its_own_flag() {
        let v = |status: Value, details: Value| json!({ "id": VID_A, "status": status, "contentDetails": details });
        assert_eq!(playable_of(&v(json!({ "embeddable": true, "privacyStatus": "public" }), json!({}))), "yes");
        assert_eq!(playable_of(&v(json!({ "embeddable": false, "privacyStatus": "public" }), json!({}))), "embed");
        assert_eq!(playable_of(&v(json!({ "embeddable": true, "privacyStatus": "private" }), json!({}))), "private");
        assert_eq!(playable_of(&v(json!({ "embeddable": true, "privacyStatus": "unlisted" }), json!({ "regionRestriction": { "blocked": ["DE"] } }))), "yes");
        assert_eq!(playable_of(&v(json!({}), json!({ "regionRestriction": { "blocked": ["DE", "US"] } }))), "region");
        assert_eq!(playable_of(&v(json!({}), json!({ "regionRestriction": { "allowed": ["DE"] } }))), "region");
        assert_eq!(playable_of(&v(json!({}), json!({ "regionRestriction": { "allowed": ["DE", "US"] } }))), "yes");
        assert_eq!(playable_of(&v(json!({}), json!({}))), "yes");
        assert_eq!(playable_of(&json!({ "id": VID_A })), "yes");
    }

    #[test]
    fn liked_videos_are_rows_and_the_call_is_the_rating_filter() {
        let _t = exclusive(); token_in_memory();
        let http = FakeHttp::reads(vec![ok(json!({ "nextPageToken": "tok_L1", "items": [] })), ok(json!({ "nextPageToken": "tok_L2", "items": [video(VID_A, "Glass Harbor", "PT3M34S", json!({})), json!({ "id": "short", "snippet": { "title": "bad id" } }), video(VID_B, "Low Tide Motel", "PT0S", json!({}))] }))], vec![]);
        let creds = FakeCreds::new(Some("stored-refresh"));
        run(&http, &creds, &clock(T0), |c| liked_with(c, None, false)).unwrap();
        let page = run(&http, &creds, &clock(T0), |c| liked_with(c, Some("tok_L1"), false)).unwrap();
        assert_eq!(page.items.iter().map(|v| v.id.as_str()).collect::<Vec<_>>(), [VID_A, VID_B]);
        assert_eq!(page.items[0].channel, "Mira Vale");
        assert_eq!(page.next.as_deref(), Some("tok_L2"));
        let url = &http.get_urls()[1];
        for part in ["videos?", "myRating=like", "maxResults=50", "pageToken=tok_L1", "fields=nextPageToken%2Citems"] { assert!(url.contains(part), "{part} in {url}"); }
    }

    fn category_answer() -> Result<HttpReply, ()> { ok(json!({ "items": [{ "id": "1", "snippet": { "title": "Film", "assignable": true } }, { "id": "10", "snippet": { "title": "Music", "assignable": true } }] })) }

    #[test]
    fn a_search_reads_the_category_once_filters_music_and_costs_nothing_again() {
        let _t = exclusive(); token_in_memory();
        let creds = FakeCreds::new(Some("stored-refresh"));
        let now = clock(T0);
        let found = || ok(json!({ "items": [{ "id": { "videoId": VID_A } }, { "id": { "videoId": "short" } }, { "id": { "kind": "youtube#channel" } }, { "id": { "videoId": VID_B } }] }));
        let details = || ok(json!({ "items": [video(VID_A, "Glass Harbor", "PT3M34S", json!({})), video(VID_B, "Low Tide Motel", "PT4M12S", json!({}))] }));
        let http = FakeHttp::reads(vec![category_answer(), found(), details(), found(), details()], vec![]);
        let page = run(&http, &creds, &now, |c| search_with(c, "  Night Drive ")).unwrap();
        assert_eq!(page.items.iter().map(|v| v.title.as_str()).collect::<Vec<_>>(), ["Glass Harbor", "Low Tide Motel"]);
        assert_eq!(page.next, None);
        let urls = http.get_urls();
        assert!(urls[0].contains("videoCategories?") && urls[0].contains("regionCode=US"));
        for part in ["search?", "type=video", "videoCategoryId=10", "videoEmbeddable=true", "maxResults=25", "q=Night%20Drive&", "fields=items%28id%2FvideoId%29"] { assert!(urls[1].contains(part), "{part} in {}", urls[1]); }
        assert_eq!(with_lib(|l| l.used(T0)), 1);
        // The same words again, in another case and with other spaces, come from memory.
        let again = run(&http, &creds, &now, |c| search_with(c, "night drive")).unwrap();
        assert_eq!(again, page);
        assert_eq!(http.get_urls().len(), 3);
        assert_eq!(with_lib(|l| l.used(T0)), 1);
        // New words read no category again.
        let other = run(&http, &creds, &now, |c| search_with(c, "rain")).unwrap();
        assert_eq!(other.items.len(), 2);
        let urls = http.get_urls();
        assert_eq!(urls.len(), 4, "one more search call, and the two videos are already cached");
        assert_eq!(urls.iter().filter(|u| u.contains("videoCategories?")).count(), 1);
        assert_eq!(with_lib(|l| l.used(T0)), 2);
        assert_eq!(searches_left(true, T0), Some(98));
        assert_eq!(searches_left(false, T0), None);
    }

    #[test]
    fn the_music_category_falls_back_to_ten() {
        let _t = exclusive(); token_in_memory();
        let creds = FakeCreds::new(Some("stored-refresh"));
        let http = FakeHttp::reads(vec![reply(500, ""), ok(json!({ "items": [] })), ], vec![]);
        let page = run(&http, &creds, &clock(T0), |c| search_with(c, "anything")).unwrap();
        assert!(page.items.is_empty());
        assert!(http.get_urls()[1].contains("videoCategoryId=10"));
        let odd = FakeHttp::reads(vec![ok(json!({ "items": [{ "id": "12x", "snippet": { "title": "Music" } }, { "id": "22", "snippet": { "title": "Music", "assignable": false } }] })), ok(json!({ "items": [] }))], vec![]);
        with_lib(|l| l.category = None);
        let _ = run(&odd, &creds, &clock(T0), |c| search_with(c, "else"));
        assert!(odd.get_urls()[1].contains("videoCategoryId=10"));
    }

    #[test]
    fn a_401_forces_one_refresh_and_one_retry() {
        let _t = exclusive(); token_in_memory();
        let creds = FakeCreds::new(Some("stored-refresh"));
        let http = FakeHttp::reads(vec![reply(401, r#"{"error":{"code":401}}"#), ok(json!({ "items": [] }))], vec![tokens(None, None)]);
        assert!(run(&http, &creds, &clock(T0), |c| playlists_with(c, None, false)).is_ok());
        assert_eq!(http.get_urls().len(), 2);
        assert_eq!(http.urls(), [TOKEN_URL]);
        // Still 401 after the refresh: sign in again, with no third try.
        with_lib(|l| *l = Library::new());
        let again = FakeHttp::reads(vec![reply(401, ""), reply(401, ""), ok(json!({ "items": [] }))], vec![tokens(None, None), tokens(None, None)]);
        assert_eq!(run(&again, &creds, &clock(T0), |c| playlists_with(c, None, false)).err(), Some(SIGN_AGAIN));
        assert_eq!(again.get_urls().len(), 2);
        assert_eq!(again.urls().len(), 1);
    }

    #[test]
    fn answers_become_fixed_words() {
        let _t = exclusive(); token_in_memory();
        let body = |reason: &str| format!(r#"{{"error":{{"code":403,"message":"free text","errors":[{{"reason":"{reason}","message":"free text"}}],"status":"X"}}}}"#);
        let table: [(u16, String, bool, &str); 16] = [
            (403, body("quotaExceeded"), true, QUOTA),
            (403, body("quotaExceeded"), false, QUOTA_ALL),
            (403, body("rateLimitExceeded"), false, BUSY),
            (403, body("userRateLimitExceeded"), true, BUSY),
            (403, body("accessNotConfigured"), false, SETUP_BROKEN),
            (403, body("forbidden"), false, DOWN),
            (403, "not json".into(), false, DOWN),
            (403, r#"{"error":{"status":"RESOURCE_EXHAUSTED"}}"#.into(), false, BUSY),
            (403, body("playlistNotFound"), false, NOT_FOUND),
            (404, body("playlistNotFound"), false, NOT_FOUND),
            (404, String::new(), false, NOT_FOUND),
            (429, String::new(), false, BUSY),
            (400, body("invalidPageToken"), false, INVALID),
            (500, String::new(), false, DOWN),
            (503, body("backendError"), true, DOWN),
            (598, String::new(), false, DOWN),
        ];
        for (status, text, search, want) in table {
            let r = HttpReply { status, body: text.into_bytes() };
            assert_eq!(read_error(&r, search), want, "{status}");
        }
        // Through a real read: a plain 404 on a playlist.
        let http = FakeHttp::reads(vec![reply(404, &body("playlistNotFound"))], vec![]);
        assert_eq!(run(&http, &FakeCreds::new(Some("r")), &clock(T0), |c| items_with(c, "PLgone", None, false)).err(), Some(NOT_FOUND));
        // A network failure and an answer that is not JSON are both `down`.
        let broken = FakeHttp::reads(vec![Err(()), reply(200, "<html>"), reply(200, "")], vec![]);
        for _ in 0..3 { assert_eq!(run(&broken, &FakeCreds::new(Some("r")), &clock(T0), |c| liked_with(c, None, true)).err(), Some(DOWN)); }
    }

    #[test]
    fn an_oversized_body_is_down_never_a_partial_parse() {
        let _t = exclusive(); token_in_memory();
        let big = vec![b' '; READ_BODY as usize + 1];
        let r = bounded_reply(200, &mut std::io::Cursor::new(big), READ_BODY);
        assert_eq!((r.status, r.body.len()), (598, 0));
        let exact = bounded_reply(200, &mut std::io::Cursor::new(vec![b' '; READ_BODY as usize]), READ_BODY);
        assert_eq!((exact.status, exact.body.len()), (200, READ_BODY as usize));
        let big_error = bounded_reply(403, &mut std::io::Cursor::new(vec![b' '; ERROR_BODY as usize + 1]), READ_BODY);
        assert_eq!(big_error.status, 598);
        assert_eq!(bounded_reply(403, &mut std::io::Cursor::new(vec![b' '; ERROR_BODY as usize]), READ_BODY).status, 403);
        let http = FakeHttp::reads(vec![Ok(r)], vec![]);
        assert_eq!(run(&http, &FakeCreds::new(Some("r")), &clock(T0), |c| playlists_with(c, None, false)).err(), Some(DOWN));
    }

    #[test]
    fn page_input_is_checked_before_any_request() {
        let _t = exclusive(); token_in_memory();
        let http = FakeHttp::reads(vec![], vec![]);
        let creds = FakeCreds::new(Some("r"));
        let long_id = "p".repeat(65);
        let long_token = "t".repeat(129);
        for bad in ["", "a", "bad id", "x&y=1", "x/y", "x?y", "pl%41", long_id.as_str(), "\u{202e}abc"] {
            assert_eq!(run(&http, &creds, &clock(T0), |c| items_with(c, bad, None, false)).err(), Some(INVALID), "{bad:?}");
        }
        for bad in ["", "a&b", "a b", "a=b", "tok\n", long_token.as_str(), "tok.en"] {
            assert_eq!(run(&http, &creds, &clock(T0), |c| playlists_with(c, Some(bad), false)).err(), Some(INVALID), "{bad:?}");
            assert_eq!(run(&http, &creds, &clock(T0), |c| liked_with(c, Some(bad), false)).err(), Some(INVALID), "{bad:?}");
            assert_eq!(run(&http, &creds, &clock(T0), |c| items_with(c, "PLok", Some(bad), false)).err(), Some(INVALID), "{bad:?}");
        }
        assert!(http.get_urls().is_empty());
        let long_ok = "t".repeat(128);
        let good = FakeHttp::reads(vec![ok(json!({ "items": [], "nextPageToken": long_ok })), ok(json!({ "items": [] }))], vec![]);
        assert!(run(&good, &creds, &clock(T0), |c| playlists_with(c, None, false)).is_ok());
        assert!(run(&good, &creds, &clock(T0), |c| playlists_with(c, Some(&long_ok), false)).is_ok());
        assert!(good.get_urls()[1].contains("pageToken="));
    }

    #[test]
    fn thumbnails_are_rebuilt_from_a_checked_id_or_dropped() {
        let want = Some(format!("https://i.ytimg.com/vi/{VID_A}/mqdefault.jpg"));
        for good in [format!("https://i.ytimg.com/vi/{VID_A}/default.jpg"), format!("https://i.ytimg.com/vi/{VID_A}/hqdefault.jpg?x=1"), format!("https://i.ytimg.com/vi/{VID_A}/")] {
            assert_eq!(playlist_thumb(&good), want, "{good}");
        }
        for bad in [
            "javascript:alert(1)".to_string(), "http://i.ytimg.com/vi/AAAAAAAAAAA/default.jpg".to_string(),
            "https://i.ytimg.com:444/vi/AAAAAAAAAAA/default.jpg".to_string(), "https://user@i.ytimg.com/vi/AAAAAAAAAAA/default.jpg".to_string(),
            "https://i.ytimg.com@evil.example/vi/AAAAAAAAAAA/default.jpg".to_string(), "https://evil.example/vi/AAAAAAAAAAA/default.jpg".to_string(),
            "https://i.ytimg.com.evil.example/vi/AAAAAAAAAAA/default.jpg".to_string(), "https://i.ytimg.com/vi/AAAAAAAAAA/default.jpg".to_string(),
            "https://i.ytimg.com/vi/AAAAAAAAAAAA/default.jpg".to_string(), "https://i.ytimg.com/vi/AAAAAAAAAA&/default.jpg".to_string(),
            "https://i.ytimg.com/vi_webp/AAAAAAAAAAA/default.webp".to_string(), "https://i.ytimg.com/".to_string(), String::new(),
            format!("https://i.ytimg.com/vi/{VID_A}/{}", "x".repeat(2100)), "data:image/svg+xml,<svg/>".to_string(),
        ] { assert_eq!(playlist_thumb(&bad), None, "{bad}"); }
        assert_eq!(video_thumb(VID_B), format!("https://i.ytimg.com/vi/{VID_B}/mqdefault.jpg"));
    }

    #[test]
    fn titles_come_out_clean_and_capped() {
        let dirty = json!("Glass\u{0}\n Harbor\u{202e}\u{200b} \u{2066}live\u{7}");
        assert_eq!(clean_text(Some(&dirty), 200).as_deref(), Some("Glass Harbor live"));
        assert_eq!(clean_text(Some(&json!("x".repeat(300))), 200).map(|s| s.chars().count()), Some(200));
        assert_eq!(clean_text(Some(&json!("y".repeat(150))), 100).map(|s| s.chars().count()), Some(100));
        assert_eq!(clean_text(Some(&json!("  \u{202e} \n ")), 100), None);
        assert_eq!(clean_text(Some(&json!(5)), 100), None);
        assert_eq!(clean_text(None, 100), None);
        // Through a read: control and bidi characters never reach the row.
        let _t = exclusive(); token_in_memory();
        let http = FakeHttp::reads(vec![ok(json!({ "items": [video(VID_A, "Glass\u{202e}Harbor\n", "PT1S", json!({ "snippet": { "title": "Glass\u{202e}Harbor\n", "channelTitle": format!("{}\u{0}", "c".repeat(150)) } }))] }))], vec![]);
        let page = run(&http, &FakeCreds::new(Some("r")), &clock(T0), |c| liked_with(c, None, false)).unwrap();
        assert_eq!(page.items[0].title, "GlassHarbor");
        assert_eq!(page.items[0].channel.chars().count(), 100);
    }

    #[test]
    fn durations_parse_only_the_iso_shape_and_clamp_to_seven_days() {
        for (text, want) in [
            ("PT3M34S", Some(214)), ("PT1H", Some(3600)), ("PT1H2M3S", Some(3723)), ("PT45S", Some(45)), ("PT10M", Some(600)), ("PT0S", Some(0)), ("PT", Some(0)),
            ("PT100H", Some(360_000)), ("PT999999999H", Some(MAX_SECONDS)), 
            ("P1DT1H", None), ("P0D", None), ("PT1M1H", None), ("PT1S1S", None), ("PT1.5S", None), ("PT-1S", None), ("PTS", None), ("PT5", None), ("pt5s", None),
            ("PT1234567890S", None), ("", None), ("3:34", None), ("PT1M ", None),
        ] { assert_eq!(parse_duration(text), want, "{text}"); }
        assert_eq!(parse_duration("PT168H"), Some(MAX_SECONDS));
        assert_eq!(parse_duration("PT169H"), Some(MAX_SECONDS));
        assert_eq!(parse_duration("PT167H59M59S"), Some(MAX_SECONDS - 1));
    }

    #[test]
    fn search_text_is_checked() {
        assert_eq!(check_query("  night drive  ").as_deref(), Some("night drive"));
        assert_eq!(check_query(&"a".repeat(100)).map(|q| q.len()), Some(100));
        for bad in ["", "   ", "\t", "a\nb", "a\u{0}b", "a\u{202e}b", "a\u{200f}b", "a\u{7f}b"] { assert_eq!(check_query(bad), None, "{bad:?}"); }
        assert_eq!(check_query(&"a".repeat(101)), None);
        assert_eq!(check_query(&"é".repeat(100)).map(|q| q.chars().count()), Some(100));
        let _t = exclusive(); token_in_memory();
        let http = FakeHttp::reads(vec![], vec![]);
        let long = "q".repeat(101);
        for bad in ["", "a\nb", "a\u{202e}b", long.as_str()] { assert_eq!(run(&http, &FakeCreds::new(Some("r")), &clock(T0), |c| search_with(c, bad)).err(), Some(INVALID)); }
        assert!(http.get_urls().is_empty());
        assert_eq!(with_lib(|l| l.used(T0)), 0);
    }

    #[test]
    fn the_pacific_day_follows_the_us_daylight_rule() {
        let d = |y, m, day| days_from_civil(y, m, day);
        // Spring 2026: daylight time starts Sunday 8 March at 2:00 (10:00 UTC).
        assert_eq!(pacific_day(utc(2026, 3, 8, 9, 59)), d(2026, 3, 8));
        assert_eq!(pacific_day(utc(2026, 3, 8, 10, 0)), d(2026, 3, 8));
        assert_eq!(pacific_day(utc(2026, 3, 9, 7, 0)), d(2026, 3, 9));
        assert_eq!(pacific_day(utc(2026, 3, 9, 6, 59)), d(2026, 3, 8));
        // Before the change a day still ends at 08:00 UTC.
        assert_eq!(pacific_day(utc(2026, 3, 8, 7, 59)), d(2026, 3, 7));
        assert_eq!(pacific_day(utc(2026, 3, 8, 8, 0)), d(2026, 3, 8));
        // Autumn 2026: daylight time ends Sunday 1 November at 2:00 (09:00 UTC).
        assert_eq!(pacific_day(utc(2026, 11, 1, 6, 59)), d(2026, 10, 31));
        assert_eq!(pacific_day(utc(2026, 11, 1, 7, 0)), d(2026, 11, 1));
        assert_eq!(pacific_day(utc(2026, 11, 2, 7, 59)), d(2026, 11, 1));
        assert_eq!(pacific_day(utc(2026, 11, 2, 8, 0)), d(2026, 11, 2));
        // Other years: second Sunday of March 2027 is the 14th; first Sunday of November 2027 is the 7th.
        assert_eq!(pacific_offset_hours(utc(2027, 3, 14, 9, 59) as i64), -8);
        assert_eq!(pacific_offset_hours(utc(2027, 3, 14, 10, 0) as i64), -7);
        assert_eq!(pacific_offset_hours(utc(2027, 11, 7, 8, 59) as i64), -7);
        assert_eq!(pacific_offset_hours(utc(2027, 11, 7, 9, 0) as i64), -8);
        assert_eq!(pacific_offset_hours(utc(2024, 3, 10, 10, 0) as i64), -7);
        assert_eq!(pacific_offset_hours(utc(2024, 11, 3, 9, 0) as i64), -8);
        assert_eq!(pacific_offset_hours(utc(2025, 3, 9, 10, 0) as i64), -7);
        // New Year.
        assert_eq!(pacific_day(utc(2027, 1, 1, 7, 59)), d(2026, 12, 31));
        assert_eq!(pacific_day(utc(2027, 1, 1, 8, 0)), d(2027, 1, 1));
        assert_eq!(pacific_day(0), d(1969, 12, 31));
        assert_eq!(year_of_days(d(2024, 2, 29)), 2024);
        assert_eq!(year_of_days(d(2000, 1, 1)), 2000);
        assert_eq!(year_of_days(d(1999, 12, 31)), 1999);
        // The search weekday arithmetic: 1 March 2026 is a Sunday.
        assert_eq!(sunday_on_or_after(d(2026, 3, 1)), d(2026, 3, 1));
        assert_eq!(sunday_on_or_after(d(2026, 3, 2)), d(2026, 3, 8));
        assert_eq!(pacific_day(u64::MAX), pacific_day(u64::MAX));
    }

    #[test]
    fn the_search_count_resets_at_pacific_midnight_and_is_filled_by_quota_exceeded() {
        let _t = exclusive(); token_in_memory();
        let evening = utc(2027, 1, 10, 6, 0); // 22:00 Pacific on 9 January
        assert_eq!(with_lib(|l| l.used(evening)), 0);
        with_lib(|l| l.search_count = 60);
        assert_eq!(with_lib(|l| l.used(utc(2027, 1, 10, 7, 59))), 60);
        assert_eq!(searches_left(true, utc(2027, 1, 10, 7, 59)), Some(40));
        assert_eq!(with_lib(|l| l.used(utc(2027, 1, 10, 8, 0))), 0);
        assert_eq!(searches_left(true, utc(2027, 1, 10, 8, 0)), Some(100));
        // Spent: refused with no request, until the next Pacific midnight.
        let creds = FakeCreds::new(Some("r"));
        with_lib(|l| { l.used(evening); l.search_count = 100; });
        let http = FakeHttp::reads(vec![], vec![]);
        assert_eq!(run(&http, &creds, &clock(evening), |c| search_with(c, "new words")).err(), Some(QUOTA));
        assert!(http.get_urls().is_empty());
        assert_eq!(searches_left(true, evening), Some(0));
        let morning = clock(utc(2027, 1, 10, 8, 0));
        let next = FakeHttp::reads(vec![category_answer(), ok(json!({ "items": [] }))], vec![]);
        assert!(run(&next, &creds, &morning, |c| search_with(c, "new words")).is_ok());
        assert_eq!(with_lib(|l| l.used(utc(2027, 1, 10, 8, 0))), 1);
        // A 403 quotaExceeded on search fills the count; other reads stay open.
        let spent = FakeHttp::reads(vec![reply(403, r#"{"error":{"errors":[{"reason":"quotaExceeded"}]}}"#)], vec![]);
        assert_eq!(run(&spent, &creds, &morning, |c| search_with(c, "other words")).err(), Some(QUOTA));
        assert_eq!(searches_left(true, utc(2027, 1, 10, 8, 0)), Some(0));
        let open = FakeHttp::reads(vec![ok(json!({ "items": [] }))], vec![]);
        assert!(run(&open, &creds, &morning, |c| playlists_with(c, None, false)).is_ok());
        assert!(crate::wall2_youtube_log::test_lines().iter().any(|l| l.starts_with("search-failed quota 403 ")));
        // A search whose request went out and failed stays counted (Google may have counted it); one that never
        // left the machine (the token could not be refreshed) is given back.
        with_lib(|l| l.search_count = 5);
        let failed = FakeHttp::reads(vec![reply(500, "")], vec![]);
        assert_eq!(run(&failed, &creds, &morning, |c| search_with(c, "fails")).err(), Some(DOWN));
        assert_eq!(with_lib(|l| l.used(utc(2027, 1, 10, 8, 0))), 6);
        *lock(&TOKEN) = None;
        let no_token = FakeHttp::reads(vec![], vec![reply(500, "")]);
        assert_eq!(run(&no_token, &creds, &morning, |c| search_with(c, "never sent")).err(), Some(DOWN));
        assert_eq!(with_lib(|l| l.used(utc(2027, 1, 10, 8, 0))), 6, "the unit is given back");
    }

    #[test]
    fn cache_times_use_the_injected_clock_and_fresh_skips_the_cache() {
        let _t = exclusive(); token_in_memory();
        let creds = FakeCreds::new(Some("r"));
        let empty = || ok(json!({ "items": [] }));
        // Playlists: an hour.
        let http = FakeHttp::reads(vec![empty(), empty(), empty()], vec![]);
        let now = clock(T0);
        run(&http, &creds, &now, |c| playlists_with(c, None, false)).unwrap();
        now.store(T0 + LISTS_TTL - 1, Ordering::SeqCst);
        run(&http, &creds, &now, |c| playlists_with(c, None, false)).unwrap();
        assert_eq!(http.get_urls().len(), 1);
        run(&http, &creds, &now, |c| playlists_with(c, None, true)).unwrap();
        assert_eq!(http.get_urls().len(), 2, "fresh reads again");
        now.store(T0 + LISTS_TTL - 1 + LISTS_TTL, Ordering::SeqCst);
        run(&http, &creds, &now, |c| playlists_with(c, None, false)).unwrap();
        assert_eq!(http.get_urls().len(), 3, "an hour after the fresh read");
        // Another page token is another entry.
        let more = FakeHttp::reads(vec![ok(json!({ "items": [], "nextPageToken": "page_2" })), empty()], vec![]);
        run(&more, &creds, &now, |c| playlists_with(c, None, true)).unwrap();
        run(&more, &creds, &now, |c| playlists_with(c, Some("page_2"), false)).unwrap();
        assert_eq!(more.get_urls().len(), 2);
        // Liked: ten minutes.
        let liked = FakeHttp::reads(vec![empty(), empty()], vec![]);
        let now = clock(T0);
        run(&liked, &creds, &now, |c| liked_with(c, None, false)).unwrap();
        now.store(T0 + LIKED_TTL - 1, Ordering::SeqCst);
        run(&liked, &creds, &now, |c| liked_with(c, None, false)).unwrap();
        assert_eq!(liked.get_urls().len(), 1);
        now.store(T0 + LIKED_TTL, Ordering::SeqCst);
        run(&liked, &creds, &now, |c| liked_with(c, None, false)).unwrap();
        assert_eq!(liked.get_urls().len(), 2);
        // A playlist's pages: an hour; its video details: a day, shared by id; fresh reads details again.
        let page = || ok(json!({ "items": [item("youtube#video", VID_A, "Glass Harbor")] }));
        let details = || ok(json!({ "items": [video(VID_A, "Glass Harbor", "PT3M34S", json!({}))] }));
        let items = FakeHttp::reads(vec![page(), details(), page(), page(), details(), page(), details()], vec![]);
        let now = clock(T0);
        run(&items, &creds, &now, |c| items_with(c, "PLone", None, false)).unwrap();
        assert_eq!(items.get_urls().len(), 2);
        now.store(T0 + LISTS_TTL, Ordering::SeqCst);
        run(&items, &creds, &now, |c| items_with(c, "PLone", None, false)).unwrap();
        assert_eq!(items.get_urls().len(), 3, "the page is read again, its details are still cached");
        now.store(T0 + DETAIL_TTL + 5, Ordering::SeqCst);
        run(&items, &creds, &now, |c| items_with(c, "PLone", None, false)).unwrap();
        assert_eq!(items.get_urls().len(), 5, "a day later the details are read again");
        run(&items, &creds, &now, |c| items_with(c, "PLone", None, true)).unwrap();
        assert_eq!(items.get_urls().len(), 7, "fresh reads the page and its details again");
        // Searches: a day.
        let s = FakeHttp::reads(vec![category_answer(), ok(json!({ "items": [] })), ok(json!({ "items": [] }))], vec![]);
        let now = clock(T0);
        run(&s, &creds, &now, |c| search_with(c, "words")).unwrap();
        now.store(T0 + SEARCH_TTL - 1, Ordering::SeqCst);
        run(&s, &creds, &now, |c| search_with(c, "WORDS")).unwrap();
        assert_eq!(s.get_urls().len(), 2);
        now.store(T0 + SEARCH_TTL, Ordering::SeqCst);
        run(&s, &creds, &now, |c| search_with(c, "words")).unwrap();
        assert_eq!(s.get_urls().len(), 3);
    }

    #[test]
    fn the_caches_are_bounded_and_drop_the_oldest() {
        let mut cache: Cache<u32> = Cache::new(3);
        for n in 0..5u32 { cache.put(format!("k{n}"), 10, n); }
        assert_eq!(cache.len(), 3);
        assert_eq!(cache.get("k0", 10, 100), None);
        assert_eq!(cache.get("k1", 10, 100), None);
        assert_eq!(cache.get("k4", 10, 100), Some(4));
        cache.put("k2".into(), 11, 22);
        cache.put("k5".into(), 11, 5);
        assert_eq!(cache.get("k3", 11, 100), None, "the oldest goes first, a rewrite counts as new");
        assert_eq!(cache.get("k2", 11, 100), Some(22));
        assert_eq!(cache.get("k2", 5, 100), None, "a clock that went back never serves it");
        let l = Library::new();
        assert_eq!((l.playlists.cap, l.videos.cap, l.details.cap, l.searches.cap), (200, 200, 5000, 100));
        assert_eq!((LISTS_TTL, LIKED_TTL, DETAIL_TTL, SEARCH_TTL), (3600, 600, 86_400, 86_400));
    }

    fn fill_the_library(creds: &FakeCreds) {
        let http = FakeHttp::reads(vec![ok(json!({ "items": [playlist("PLone", "One", 1, "")] })), category_answer(), ok(json!({ "items": [{ "id": { "videoId": VID_A } }] })), ok(json!({ "items": [video(VID_A, "Glass Harbor", "PT1S", json!({}))] }))], vec![]);
        run(&http, creds, &clock(T0), |c| playlists_with(c, None, false)).unwrap();
        run(&http, creds, &clock(T0), |c| search_with(c, "glass")).unwrap();
        let (a, b, c) = with_lib(|l| (l.playlists.len(), l.details.len() + l.searches.len(), (l.search_count, l.category.clone())));
        assert_eq!((a, b, c), (1, 2, (1, Some("10".to_string()))));
    }
    fn library_is_empty() -> bool { with_lib(|l| l.playlists.len() + l.videos.len() + l.details.len() + l.searches.len() == 0 && l.search_count == 0 && l.category.is_none()) }

    #[test]
    fn sign_out_a_client_change_and_a_forgotten_client_clear_every_cache_and_the_count() {
        let _t = exclusive(); token_in_memory();
        let creds = FakeCreds::new(Some("stored-refresh"));
        fill_the_library(&creds);
        reset_session();
        assert!(library_is_empty());
        token_in_memory();
        fill_the_library(&creds);
        sign_out_with(&FakeHttp::new(vec![reply(200, "")]), &creds);
        assert!(library_is_empty());
        let signed_out = FakeCreds::new(None);
        token_in_memory();
        fill_the_library(&FakeCreds::new(Some("stored-refresh")));
        set_client_with(&signed_out, &good_id(), &good_secret()).unwrap();
        assert!(library_is_empty());
        token_in_memory();
        fill_the_library(&FakeCreds::new(Some("stored-refresh")));
        forget_client_with(&signed_out).unwrap();
        assert!(library_is_empty());
    }

    #[test]
    fn searches_left_is_none_signed_out_and_a_number_signed_in() {
        let _t = exclusive();
        let signed_out = FakeCreds::new(None);
        assert_eq!(status_with(&signed_out, || Some(client())).searches_left, None);
        assert_eq!(status_with(&signed_out, || None).searches_left, None);
        let signed_in = FakeCreds::new(Some("stored-refresh"));
        assert_eq!(status_with(&signed_in, || Some(client())).searches_left, Some(100));
        with_lib(|l| { l.used(unix_now()); l.search_count = 88; });
        assert_eq!(status_with(&signed_in, || Some(client())).searches_left, Some(12));
        assert_eq!(status_with(&signed_in, || None).searches_left, Some(12));
    }

    #[test]
    fn a_failed_read_leaves_the_session_and_the_other_caches_alone() {
        let _t = exclusive(); token_in_memory();
        let creds = FakeCreds::new(Some("stored-refresh"));
        fill_the_library(&creds);
        let http = FakeHttp::reads(vec![reply(500, "")], vec![]);
        assert_eq!(run(&http, &creds, &clock(T0), |c| liked_with(c, None, false)).err(), Some(DOWN));
        assert_eq!(with_lib(|l| l.playlists.len()), 1);
        assert_eq!(creds.refresh_value().as_deref(), Some("stored-refresh"));
    }

    #[test]
    fn reading_never_puts_a_title_a_query_or_a_token_in_the_log() {
        let _t = exclusive();
        let sentinel = "sentinel_qzx";
        let hostile = format!(r#"{{"error":{{"message":"{sentinel}","errors":[{{"reason":"{sentinel}"}}],"status":"{sentinel}"}},"items":[{{"id":"{sentinel}"}}]}}"#);
        let creds = FakeCreds::new(Some(sentinel));
        for status in [400, 401, 403, 404, 429, 500, 598] {
            token_in_memory();
            let http = FakeHttp::reads((0..8).map(|_| reply(status, &hostile)).collect(), vec![]);
            let now = clock(T0);
            let _ = run(&http, &creds, &now, |c| playlists_with(c, Some(sentinel), true));
            let _ = run(&http, &creds, &now, |c| playlists_with(c, None, true));
            let _ = run(&http, &creds, &now, |c| items_with(c, "PLsentinel_qzx", None, true));
            let _ = run(&http, &creds, &now, |c| liked_with(c, None, true));
            let _ = run(&http, &creds, &now, |c| items_with(c, sentinel, Some(sentinel), true));
            let _ = run(&http, &creds, &now, |c| liked_with(c, Some(sentinel), true));
            let _ = run(&http, &creds, &now, |c| search_with(c, &format!("{sentinel} {status}")));
            with_lib(|l| *l = Library::new());
        }
        // A good page that carries sentinel titles, then a failing detail call.
        token_in_memory();
        let titled = FakeHttp::reads(vec![ok(json!({ "items": [item("youtube#video", VID_A, sentinel)] })), reply(403, &hostile)], vec![]);
        let _ = run(&titled, &creds, &clock(T0), |c| items_with(c, "PLsentinel_qzx", None, true));
        let lines = crate::wall2_youtube_log::test_lines();
        assert!(lines.iter().any(|l| l.starts_with("read-failed ")) && lines.iter().any(|l| l.starts_with("search-failed ")));
        for text in &lines {
            assert!(!text.contains("sentinel") && !text.contains("qzx"), "{text}");
            assert!(text.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'-' | b' ' | b'\n')), "{text}");
        }
    }

    #[test]
    fn good_reads_log_an_event_a_status_and_a_time_only() {
        let _t = exclusive(); token_in_memory();
        let creds = FakeCreds::new(Some("r"));
        let http = FakeHttp::reads(vec![ok(json!({ "items": [] })), category_answer(), ok(json!({ "items": [] }))], vec![]);
        run(&http, &creds, &clock(T0), |c| playlists_with(c, None, true)).unwrap();
        run(&http, &creds, &clock(T0), |c| search_with(c, "glass harbor")).unwrap();
        let lines = crate::wall2_youtube_log::test_lines();
        assert!(lines.iter().any(|l| l.starts_with("read-ok none 200 ")));
        assert!(lines.iter().any(|l| l.starts_with("search-ok none 200 ")));
        assert!(lines.iter().all(|l| !l.contains("glass")));
    }

    #[test]
    fn the_content_security_policy_gains_only_the_thumbnail_host() {
        let conf: Value = serde_json::from_str(include_str!("../tauri.wall2.conf.json")).unwrap();
        let security = &conf["app"]["security"];
        let images = "'self' data: https://*.scdn.co https://*.spotifycdn.com https://i.ytimg.com";
        let rest = |script: &str, style: &str, connect: &str| json!({
            "default-src": "'none'", "script-src": script, "style-src": style, "img-src": images, "font-src": "'self'", "connect-src": connect,
            "frame-src": "https://www.youtube-nocookie.com https://player.twitch.tv", "frame-ancestors": "'none'", "base-uri": "'none'", "form-action": "'none'", "object-src": "'none'",
        });
        assert_eq!(security["csp"], rest("'self'", "'self'", "'self' ipc: http://ipc.localhost https://ipc.localhost"));
        assert_eq!(security["devCsp"], rest("'self' 'unsafe-inline'", "'self' 'unsafe-inline'", "'self' ipc: http://ipc.localhost https://ipc.localhost http://localhost:1421 ws://localhost:1421"));
        for key in ["csp", "devCsp"] { assert_eq!(security[key]["img-src"].as_str().unwrap().matches("https://i.ytimg.com").count(), 1); }
    }

    // ---- fix round: sign-in generations, paging, concurrent searches ---------------------------

    /// A fake whose reads wait at a gate (until `open`), so two calls can overlap deterministically.
    struct GateHttp { gets: Mutex<VecDeque<Result<HttpReply, ()>>>, started: std::sync::atomic::AtomicUsize, open: Mutex<bool>, ready: std::sync::Condvar, urls: Mutex<Vec<String>> }
    impl GateHttp {
        fn new(gets: Vec<Result<HttpReply, ()>>) -> Self { Self { gets: Mutex::new(gets.into()), started: std::sync::atomic::AtomicUsize::new(0), open: Mutex::new(false), ready: std::sync::Condvar::new(), urls: Mutex::new(Vec::new()) } }
        fn release(&self) { *lock(&self.open) = true; self.ready.notify_all(); }
        fn started(&self) -> usize { self.started.load(Ordering::SeqCst) }
        fn urls(&self) -> Vec<String> { lock(&self.urls).clone() }
    }
    impl Http for GateHttp {
        fn post_form(&self, _: &str, _: &[(&str, &str)], _: Duration) -> Result<HttpReply, ()> { Err(()) }
        fn get(&self, url: &str, _: &str, _: u64, _: Duration) -> Result<HttpReply, ()> {
            lock(&self.urls).push(url.to_string());
            self.started.fetch_add(1, Ordering::SeqCst);
            let mut open = lock(&self.open);
            while !*open { open = self.ready.wait(open).unwrap_or_else(|e| e.into_inner()); }
            drop(open);
            lock(&self.gets).pop_front().unwrap_or(Err(()))
        }
    }
    fn wait_until(what: &str, mut done: impl FnMut() -> bool) {
        let end = Instant::now() + Duration::from_secs(5);
        while !done() { assert!(Instant::now() < end, "timed out waiting for {what}"); std::thread::sleep(Duration::from_millis(5)); }
    }
    fn library_sizes() -> usize { with_lib(|l| l.playlists.len() + l.videos.len() + l.details.len() + l.searches.len() + l.found.len() + l.paging.len()) }

    #[test]
    fn a_new_sign_in_never_gets_the_first_accounts_library() {
        let _t = exclusive(); token_in_memory();
        let creds_a = FakeCreds::new(Some("refresh-of-a"));
        let a_list = || ok(json!({ "items": [playlist("PLaccounta", "Private mix of A", 3, "")] }));
        let http_a = FakeHttp::reads(vec![a_list(), ok(json!({ "items": [video(VID_A, "A liked", "PT1S", json!({}))] })), category_answer(), ok(json!({ "items": [{ "id": { "videoId": VID_B } }] })), ok(json!({ "items": [video(VID_B, "A search", "PT1S", json!({}))] }))], vec![]);
        run(&http_a, &creds_a, &clock(T0), |c| playlists_with(c, None, false)).unwrap();
        run(&http_a, &creds_a, &clock(T0), |c| liked_with(c, None, false)).unwrap();
        run(&http_a, &creds_a, &clock(T0), |c| search_with(c, "a words")).unwrap();
        assert!(library_sizes() > 0);
        assert_eq!(with_lib(|l| l.used(T0)), 1);
        // A's grant is refused: the library goes, the day's search count stays (it belongs to the client's quota).
        let refused = FakeHttp::new(vec![reply(400, r#"{"error":"invalid_grant"}"#)]);
        assert_eq!(access_with(&client(), true, &refused, &creds_a), Err(SIGN_AGAIN));
        assert_eq!(library_sizes(), 0);
        assert_eq!(with_lib(|l| l.used(T0)), 1);
        // B signs in: save_sign_in also clears, and the first read as B goes to Google and shows none of A's.
        let creds_b = FakeCreds::new(None);
        // (Something A's session left behind between the refusal and the new sign-in.)
        let http_stale = FakeHttp::reads(vec![a_list()], vec![]);
        token_in_memory();
        run(&http_stale, &FakeCreds::new(Some("refresh-of-a")), &clock(T0), |c| playlists_with(c, None, false)).unwrap();
        assert!(library_sizes() > 0);
        save_sign_in(&creds_b, "refresh-of-b", "access-of-b".into(), 3600).unwrap();
        assert_eq!(library_sizes(), 0);
        assert_eq!(with_lib(|l| l.used(T0)), 1);
        let http_b = FakeHttp::reads(vec![ok(json!({ "items": [playlist("PLaccountb", "Mix of B", 5, "")] }))], vec![]);
        let page = run(&http_b, &creds_b, &clock(T0 + 5), |c| playlists_with(c, None, false)).unwrap();
        assert_eq!(page.items.iter().map(|p| p.title.as_str()).collect::<Vec<_>>(), ["Mix of B"]);
        assert_eq!(http_b.get_urls().len(), 1, "the read went to Google");
        assert_eq!(lock(&http_b.get_calls)[0].1, "access-of-b");
    }

    #[test]
    fn a_read_held_across_a_clear_writes_nothing_back() {
        let _t = exclusive(); token_in_memory();
        let creds = FakeCreds::new(Some("stored-refresh"));
        let http = GateHttp::new(vec![ok(json!({ "items": [playlist("PLheld", "Held mix", 1, "")], "nextPageToken": "held_token" }))]);
        std::thread::scope(|s| {
            let reader = s.spawn(|| run_dyn(&http, &creds, &clock(T0), |c| playlists_with(c, None, false)));
            wait_until("the read to start", || http.started() == 1);
            clear_library(false);
            http.release();
            let page = reader.join().unwrap().unwrap();
            assert_eq!(page.items.len(), 1, "the reader still gets its answer");
        });
        assert_eq!(library_sizes(), 0, "but nothing of it was written after the clear");
        // A search held across a clear: no answer is cached and no unit stays reserved.
        let gate = GateHttp::new(vec![category_answer(), ok(json!({ "items": [{ "id": { "videoId": VID_A } }] })), ok(json!({ "items": [video(VID_A, "Held clip", "PT1S", json!({}))] }))]);
        std::thread::scope(|s| {
            let reader = s.spawn(|| run_dyn(&gate, &creds, &clock(T0), |c| search_with(c, "held words")));
            wait_until("the search to start", || gate.started() == 1);
            clear_library(false);
            gate.release();
            assert!(reader.join().unwrap().is_ok());
        });
        assert_eq!(library_sizes(), 0);
    }
    fn run_dyn<R>(http: &dyn Http, creds: &FakeCreds, now: &std::sync::atomic::AtomicU64, f: impl FnOnce(&Ctx) -> R) -> R {
        let c = client();
        let clock = || now.load(Ordering::SeqCst);
        f(&Ctx { http, creds, client: &c, now: &clock })
    }

    #[test]
    fn page_41_and_a_token_never_handed_out_are_invalid_natively() {
        let _t = exclusive(); token_in_memory();
        let creds = FakeCreds::new(Some("r"));
        let chain = |n: usize| (0..n).map(|i| ok(json!({ "items": [], "nextPageToken": format!("tok{}", i + 1) }))).collect::<Vec<_>>();
        let lists: [(&str, Box<dyn Fn(&Ctx, Option<&str>, bool) -> Result<usize, &'static str>>); 3] = [
            ("playlists", Box::new(|c, t, f| playlists_with(c, t, f).map(|p| p.items.len()))),
            ("items", Box::new(|c, t, f| items_with(c, "PLpaged", t, f).map(|p| p.items.len()))),
            ("liked", Box::new(|c, t, f| liked_with(c, t, f).map(|p| p.items.len()))),
        ];
        for (name, read) in &lists {
            with_lib(|l| *l = Library::new());
            let http = FakeHttp::reads(chain(41), vec![]);
            let at = clock(T0);
            // A token before any first page was served, and one made up: refused with no request.
            assert_eq!(run(&http, &creds, &at, |c| read(c, Some("tok1"), false)), Err(INVALID), "{name}: before page one");
            run(&http, &creds, &at, |c| read(c, None, false)).unwrap();
            assert_eq!(run(&http, &creds, &at, |c| read(c, Some("zzz"), false)), Err(INVALID), "{name}: never handed out");
            assert_eq!(run(&http, &creds, &at, |c| read(c, Some("tok2"), false)), Err(INVALID), "{name}: skipping a page");
            assert_eq!(http.get_urls().len(), 1);
            // Pages 2 to 40 follow the chain; page 41 is refused.
            for page in 2..=40 { assert!(run(&http, &creds, &at, |c| read(c, Some(&format!("tok{}", page - 1)), false)).is_ok(), "{name}: page {page}"); }
            assert_eq!(http.get_urls().len(), 40);
            assert_eq!(run(&http, &creds, &at, |c| read(c, Some("tok40"), false)), Err(INVALID), "{name}: page 41");
            assert_eq!(http.get_urls().len(), 40, "{name}: page 41 sent nothing");
            // Reading the first page again starts the count again.
            let again = FakeHttp::reads(chain(2), vec![]);
            run(&again, &creds, &at, |c| read(c, None, true)).unwrap();
            assert!(run(&again, &creds, &at, |c| read(c, Some("tok1"), false)).is_ok(), "{name}: after a new first page");
            assert_eq!(run(&again, &creds, &at, |c| read(c, Some("tok40"), false)), Err(INVALID));
        }
    }

    #[test]
    fn a_cached_page_follows_the_same_paging_rule() {
        let _t = exclusive(); token_in_memory();
        let creds = FakeCreds::new(Some("r"));
        let http = FakeHttp::reads(vec![ok(json!({ "items": [], "nextPageToken": "tok1" })), ok(json!({ "items": [] }))], vec![]);
        let at = clock(T0);
        run(&http, &creds, &at, |c| playlists_with(c, None, false)).unwrap();
        run(&http, &creds, &at, |c| playlists_with(c, Some("tok1"), false)).unwrap();
        // Served from memory the second time, still only in order.
        run(&http, &creds, &at, |c| playlists_with(c, None, false)).unwrap();
        assert_eq!(run(&http, &creds, &at, |c| playlists_with(c, Some("tok9"), false)).err(), Some(INVALID));
        run(&http, &creds, &at, |c| playlists_with(c, Some("tok1"), false)).unwrap();
        assert_eq!(http.get_urls().len(), 2);
    }

    #[test]
    fn the_same_words_in_flight_share_one_search() {
        let _t = exclusive(); token_in_memory();
        let creds = FakeCreds::new(Some("r"));
        let gate = GateHttp::new(vec![category_answer(), ok(json!({ "items": [{ "id": { "videoId": VID_A } }] })), ok(json!({ "items": [video(VID_A, "Glass Harbor", "PT3M34S", json!({}))] }))]);
        let (first, second) = std::thread::scope(|s| {
            let a = s.spawn(|| run_dyn(&gate, &creds, &clock(T0), |c| search_with(c, "Night Drive")));
            wait_until("the first search to start", || gate.started() == 1);
            let b = s.spawn(|| run_dyn(&gate, &creds, &clock(T0), |c| search_with(c, "  night DRIVE ")));
            std::thread::sleep(Duration::from_millis(80));
            gate.release();
            (a.join().unwrap(), b.join().unwrap())
        });
        assert_eq!(first.as_ref().unwrap().items.len(), 1);
        assert_eq!(first, second);
        assert_eq!(gate.urls().iter().filter(|u| u.contains("search?")).count(), 1, "one search.list call");
        assert_eq!(gate.urls().len(), 3);
        assert_eq!(with_lib(|l| l.used(T0)), 1, "one unit spent");
        assert!(lock(&FLIGHTS).is_empty(), "the flight is over");
    }

    #[test]
    fn two_searches_starting_at_99_spend_one_unit() {
        let _t = exclusive(); token_in_memory();
        let creds = FakeCreds::new(Some("r"));
        with_lib(|l| { l.used(T0); l.search_count = 99; });
        let gate = GateHttp::new(vec![category_answer(), ok(json!({ "items": [{ "id": { "videoId": VID_A } }] })), ok(json!({ "items": [video(VID_A, "Glass Harbor", "PT3M34S", json!({}))] }))]);
        let (one, two) = std::thread::scope(|s| {
            let a = s.spawn(|| run_dyn(&gate, &creds, &clock(T0), |c| search_with(c, "first words")));
            wait_until("the first search to start", || gate.started() == 1);
            // The unit is reserved before the call: the second search is refused without any request.
            let two = run_dyn(&gate, &creds, &clock(T0), |c| search_with(c, "second words"));
            assert_eq!(gate.started(), 1);
            gate.release();
            (a.join().unwrap(), two)
        });
        assert!(one.is_ok());
        assert_eq!(two.err(), Some(QUOTA));
        assert_eq!(gate.urls().iter().filter(|u| u.contains("search?")).count(), 1);
        assert_eq!(with_lib(|l| l.used(T0)), 100);
    }

    #[test]
    fn a_failed_details_read_keeps_the_search_answer_and_a_retry_spends_nothing() {
        let _t = exclusive(); token_in_memory();
        let creds = FakeCreds::new(Some("r"));
        let found = ok(json!({ "items": [{ "id": { "videoId": VID_A } }, { "id": { "videoId": VID_B } }] }));
        let http = FakeHttp::reads(vec![category_answer(), found, reply(500, "")], vec![]);
        let at = clock(T0);
        assert_eq!(run(&http, &creds, &at, |c| search_with(c, "keep me")).err(), Some(DOWN));
        assert_eq!(with_lib(|l| l.used(T0)), 1);
        let retry = FakeHttp::reads(vec![ok(json!({ "items": [video(VID_A, "Glass Harbor", "PT3M34S", json!({})), video(VID_B, "Low Tide Motel", "PT4M12S", json!({}))] }))], vec![]);
        let page = run(&retry, &creds, &at, |c| search_with(c, "keep me")).unwrap();
        assert_eq!(page.items.len(), 2);
        let urls = retry.get_urls();
        assert_eq!(urls.len(), 1, "only the details read repeated");
        assert!(urls[0].contains("videos?") && !urls[0].contains("search?"));
        assert_eq!(with_lib(|l| l.used(T0)), 1, "no second search was spent");
        // And it is a finished answer now: the same words again need nothing.
        assert!(run(&retry, &creds, &at, |c| search_with(c, "KEEP me")).is_ok());
        assert_eq!(retry.get_urls().len(), 1);
    }

    #[test]
    fn every_command_checks_the_window_first() {
        // The needles are built at run time so this test's own text never matches them.
        let source = include_str!("wall2_youtube.rs");
        let function = ["pub async fn ", "wall2_youtube_"].concat();
        let attribute = ["#[tauri", "::command]"].concat();
        let commands = source.split(function.as_str()).skip(1).map(|rest| rest.split('(').next().unwrap_or("")).collect::<Vec<_>>();
        assert_eq!(commands, ["status", "set_client", "forget_client", "sign_in", "cancel_sign_in", "sign_out", "playlists", "items", "liked", "search", "videos"]);
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
        Ok(bounded_reply(status, &mut response.into_reader(), TOKEN_BODY))
    }
    fn get(&self, url: &str, bearer: &str, limit: u64, timeout: Duration) -> Result<HttpReply, ()> {
        let agent = ureq::AgentBuilder::new().timeout(timeout.max(Duration::from_millis(1))).redirects(0).build();
        let response = match agent.get(url).set("Authorization", &format!("Bearer {bearer}")).call() { Ok(r) | Err(ureq::Error::Status(_, r)) => r, Err(_) => return Err(()) };
        let status = response.status();
        Ok(bounded_reply(status, &mut response.into_reader(), limit))
    }
}

/// Finds the client, then runs one read on this thread. Every read command comes through here.
fn read_with_app<R>(app: &tauri::AppHandle, read: impl FnOnce(&Ctx) -> Result<R, &'static str>) -> Result<R, String> {
    let client = resolve_client(&RealCreds, || file_client(app)).map_err(str::to_string)?;
    let now = unix_now;
    read(&Ctx { http: &RealHttp, creds: &RealCreds, client: &client, now: &now }).map_err(str::to_string)
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
    tauri::async_runtime::spawn_blocking(move || {
        // The client lookup (Credential Manager, a file) and the guard both happen here, off the async thread.
        let (client, _running) = begin_sign_in(&RealCreds, || file_client(&app)).map_err(str::to_string)?;
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

#[tauri::command]
pub async fn wall2_youtube_playlists(window: WebviewWindow, page_token: Option<String>, fresh: Option<bool>) -> Result<Page<YtPlaylist>, String> {
    require(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || read_with_app(&app, |ctx| playlists_with(ctx, page_token.as_deref(), fresh.unwrap_or(false)))).await.map_err(|_| FAILED.to_string())?
}

#[tauri::command]
pub async fn wall2_youtube_items(window: WebviewWindow, playlist_id: String, page_token: Option<String>, fresh: Option<bool>) -> Result<Page<YtVideo>, String> {
    require(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || read_with_app(&app, |ctx| items_with(ctx, &playlist_id, page_token.as_deref(), fresh.unwrap_or(false)))).await.map_err(|_| FAILED.to_string())?
}

#[tauri::command]
pub async fn wall2_youtube_liked(window: WebviewWindow, page_token: Option<String>, fresh: Option<bool>) -> Result<Page<YtVideo>, String> {
    require(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || read_with_app(&app, |ctx| liked_with(ctx, page_token.as_deref(), fresh.unwrap_or(false)))).await.map_err(|_| FAILED.to_string())?
}

#[tauri::command]
pub async fn wall2_youtube_search(window: WebviewWindow, query: String) -> Result<Page<YtVideo>, String> {
    require(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || read_with_app(&app, |ctx| search_with(ctx, &query))).await.map_err(|_| FAILED.to_string())?
}

#[tauri::command]
pub async fn wall2_youtube_videos(window: WebviewWindow, ids: Vec<String>) -> Result<Vec<YtDetail>, String> {
    require(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || read_with_app(&app, |ctx| video_details_with(ctx, &ids))).await.map_err(|_| FAILED.to_string())?
}

pub fn start_log(dir: Option<std::path::PathBuf>) { crate::wall2_youtube_log::start(dir); }
