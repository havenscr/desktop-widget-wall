//! Spotify Web API for Wall 2. Secrets stay in Credential Manager and upstream text is bounded.

use crate::wall2_meet::store::{BlobStore, CredBlobs, Fetch, CHUNK, MAX_CHUNKS};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::Read;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

const NOT_SETUP: &str = "not set up";
const SIGN_AGAIN: &str = "sign in again";
const BUSY: &str = "busy";
const NO_DEVICE: &str = "no device";
const NO_CONNECTION: &str = "no connection";
const NOT_YOURS: &str = "not yours";
const GONE: &str = "no longer offered";
const CALLBACK: &str = "/callback";
const SCOPE: &str = "user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative user-library-read user-read-recently-played";
const MAX_BODY: u64 = 1_000_000;
const ANSWER_BODY: u64 = 64 * 1024;
const TRACK_BODY: u64 = 512 * 1024;
const PAGE_SIZE: usize = 50;

#[derive(Clone, Debug, PartialEq)]
struct Config { client_id: String, redirect_port: u16 }

fn parse_config(text: Option<&str>) -> Result<Config, &'static str> {
    let text = text.ok_or(NOT_SETUP)?;
    if text.len() > 4096 { return Err(NOT_SETUP) }
    let value: Value = serde_json::from_str(text).map_err(|_| NOT_SETUP)?;
    let client_id = value.get("clientId").and_then(Value::as_str).ok_or(NOT_SETUP)?;
    if client_id.len() != 32 || !client_id.bytes().all(|b| b.is_ascii_hexdigit()) { return Err(NOT_SETUP) }
    let port = match value.get("redirectPort") { None => 8898, Some(v) => v.as_u64().ok_or(NOT_SETUP)? };
    if !(1024..=65535).contains(&port) { return Err(NOT_SETUP) }
    Ok(Config { client_id: client_id.to_string(), redirect_port: port as u16 })
}

fn config(app: &tauri::AppHandle) -> Result<Config, String> {
    let dir = app.path().app_config_dir().map_err(|_| NOT_SETUP.to_string())?;
    read_config_file(&dir.join("spotify.json"))
}

fn read_config_file(path: &std::path::Path) -> Result<Config, String> {
    let mut bytes = Vec::new();
    let mut file = std::fs::File::open(path).map_err(|_| NOT_SETUP.to_string())?;
    file.take(4097).read_to_end(&mut bytes).map_err(|_| NOT_SETUP.to_string())?;
    if bytes.len() > 4096 { return Err(NOT_SETUP.to_string()) }
    let text = String::from_utf8(bytes).map_err(|_| NOT_SETUP.to_string())?;
    parse_config(Some(&text)).map_err(str::to_string)
}

fn require(window: &WebviewWindow) -> Result<(), String> { crate::wall2_meet::require_wall2(window.label()) }

fn authorize_url(cfg: &Config, challenge: &str, state: &str) -> String {
    use urlencoding::encode;
    let redirect = format!("http://127.0.0.1:{}{CALLBACK}", cfg.redirect_port);
    format!("https://accounts.spotify.com/authorize?client_id={}&response_type=code&redirect_uri={}&scope={}&code_challenge_method=S256&code_challenge={}&state={}",
        encode(&cfg.client_id), encode(&redirect), encode(SCOPE), encode(challenge), encode(state))
}

fn secret_target(n: usize) -> String { crate::wall2_oauth::credential_target("spotify", "refresh", n) }

fn load_refresh() -> Result<Option<String>, &'static str> {
    let mut bytes = Vec::new();
    for n in 0..MAX_CHUNKS {
        match CredBlobs.read(&secret_target(n)) {
            Fetch::Found(v) => bytes.extend(v),
            Fetch::Missing if n == 0 => return Ok(None),
            Fetch::Missing => break,
            Fetch::Failed => return Err("failed"),
        }
    }
    String::from_utf8(bytes).map(Some).map_err(|_| "failed")
}

fn save_refresh(value: &str) -> bool {
    if value.len() > CHUNK * MAX_CHUNKS { return false }
    for (n, part) in value.as_bytes().chunks(CHUNK).enumerate() {
        if !CredBlobs.write(&secret_target(n), part) { return false }
    }
    let used = value.as_bytes().chunks(CHUNK).count();
    for n in used..MAX_CHUNKS { CredBlobs.remove(&secret_target(n)) }
    true
}

fn delete_refresh() { for n in 0..MAX_CHUNKS { CredBlobs.remove(&secret_target(n)) } }

trait Creds: Send + Sync {
    fn load(&self) -> Result<Option<String>, &'static str>;
    fn save(&self, value: &str) -> bool;
    fn delete(&self);
    fn delete_if_equal(&self, expected: &str) { if self.load().ok().flatten().as_deref() == Some(expected) { self.delete(); } }
}

struct RealCreds;
impl Creds for RealCreds {
    fn load(&self) -> Result<Option<String>, &'static str> { load_refresh() }
    fn save(&self, value: &str) -> bool { save_refresh(value) }
    fn delete(&self) { delete_refresh() }
}

#[derive(Clone, Debug)]
struct HttpReply { status: u16, retry_after: Option<u64>, body: Vec<u8> }
trait Http: Send + Sync {
    fn token(&self, form: &[(&str, &str)]) -> Result<HttpReply, ()>;
    fn api(&self, method: &str, path: &str, bearer: &str, payload: Option<&Value>, limit: u64) -> Result<HttpReply, ()>;
}

struct RealHttp;
impl Http for RealHttp {
    fn token(&self, form: &[(&str, &str)]) -> Result<HttpReply, ()> {
        http_reply(agent().post("https://accounts.spotify.com/api/token").send_form(form))
    }
    fn api(&self, method: &str, path: &str, bearer: &str, payload: Option<&Value>, limit: u64) -> Result<HttpReply, ()> {
        let url = format!("https://api.spotify.com/v1{path}");
        let request = match method { "GET" => agent().get(&url), "PUT" => agent().put(&url), _ => return Err(()) }.set("Authorization", &format!("Bearer {bearer}"));
        let result = match payload { Some(value) => request.set("Content-Type", "application/json").send_string(&value.to_string()), None => request.call() };
        http_reply_with_limit(result, limit)
    }
}

fn http_reply(result: Result<ureq::Response, ureq::Error>) -> Result<HttpReply, ()> {
    http_reply_with_limit(result, MAX_BODY)
}
fn http_reply_with_limit(result: Result<ureq::Response, ureq::Error>, limit: u64) -> Result<HttpReply, ()> {
    let response = match result { Ok(r) | Err(ureq::Error::Status(_, r)) => r, Err(_) => return Err(()) };
    let status = response.status();
    let retry_after = response.header("Retry-After").and_then(|v| v.parse::<u64>().ok());
    let bytes = if (200..300).contains(&status) || status == 400 { body(response, limit).map_err(|_| ())? } else { Vec::new() };
    Ok(HttpReply { status, retry_after, body: bytes })
}

struct Token { access: String, expires: Instant }
static TOKEN: OnceLock<Mutex<Option<Token>>> = OnceLock::new();
fn token() -> &'static Mutex<Option<Token>> { TOKEN.get_or_init(|| Mutex::new(None)) }
static REFRESH: OnceLock<Mutex<()>> = OnceLock::new();
fn refresh_lock() -> &'static Mutex<()> { REFRESH.get_or_init(|| Mutex::new(())) }
static NOT_BEFORE: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();
fn not_before() -> &'static Mutex<Option<Instant>> { NOT_BEFORE.get_or_init(|| Mutex::new(None)) }
#[derive(Clone, Debug, PartialEq)] struct Profile { id: String, display_name: Option<String> }
static PROFILE: OnceLock<Mutex<Option<Profile>>> = OnceLock::new();
fn profile_cache() -> &'static Mutex<Option<Profile>> { PROFILE.get_or_init(|| Mutex::new(None)) }
static PROFILE_FETCH: OnceLock<Mutex<()>> = OnceLock::new();
fn profile_fetch_lock() -> &'static Mutex<()> { PROFILE_FETCH.get_or_init(|| Mutex::new(())) }
static PROFILE_GEN: AtomicU64 = AtomicU64::new(0);

fn retry_after(seconds: Option<u64>) -> Duration {
    Duration::from_secs(seconds.unwrap_or(5).min(60))
}
fn back_off_for(wait: Duration) { *not_before().lock().unwrap() = Some(Instant::now() + wait); }
fn check_backoff() -> Result<(), String> {
    if not_before().lock().unwrap().is_some_and(|at| at > Instant::now()) { Err(BUSY.into()) } else { Ok(()) }
}

fn agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| ureq::AgentBuilder::new().timeout(Duration::from_secs(6)).redirects(0).build())
}

fn read_limited(reader: &mut dyn Read, limit: u64) -> Result<Vec<u8>, &'static str> {
    let mut out = Vec::new();
    reader.take(limit + 1).read_to_end(&mut out).map_err(|_| "down")?;
    if out.len() as u64 > limit { Err("down") } else { Ok(out) }
}
fn body(resp: ureq::Response, limit: u64) -> Result<Vec<u8>, &'static str> { read_limited(&mut resp.into_reader(), limit) }

#[derive(Debug, PartialEq)]
enum TokenReply { Ok(String, u64, Option<String>), Refused, Busy(Duration), Down }

fn token_reply(result: Result<HttpReply, ()>) -> TokenReply {
    match result {
        Ok(resp) if (200..300).contains(&resp.status) => {
            let Ok(v) = serde_json::from_slice::<Value>(&resp.body) else { return TokenReply::Down };
            let Some(access) = v.get("access_token").and_then(Value::as_str) else { return TokenReply::Down };
            let expiry = v.get("expires_in").and_then(Value::as_u64).unwrap_or(3600).min(86400);
            let refresh = v.get("refresh_token").and_then(Value::as_str).map(str::to_string);
            TokenReply::Ok(access.to_string(), expiry, refresh)
        }
        Ok(resp) if resp.status == 429 => TokenReply::Busy(retry_after(resp.retry_after)),
        Ok(resp) if resp.status == 401 => TokenReply::Refused,
        Ok(resp) if resp.status == 400 && serde_json::from_slice::<Value>(&resp.body).ok().and_then(|v| v.get("error")?.as_str().map(str::to_string)).as_deref() == Some("invalid_grant") => TokenReply::Refused,
        _ => TokenReply::Down,
    }
}

fn exchange(http: &dyn Http, cfg: &Config, code: &str, verifier: &str) -> TokenReply {
    let redirect = format!("http://127.0.0.1:{}{CALLBACK}", cfg.redirect_port);
    token_reply(http.token(&[
        ("client_id", cfg.client_id.as_str()), ("grant_type", "authorization_code"), ("code", code),
        ("redirect_uri", redirect.as_str()), ("code_verifier", verifier),
    ]))
}

fn refresh(http: &dyn Http, cfg: &Config, value: &str) -> TokenReply {
    token_reply(http.token(&[
        ("client_id", cfg.client_id.as_str()), ("grant_type", "refresh_token"), ("refresh_token", value),
    ]))
}

fn access_with(cfg: &Config, force: bool, http: &dyn Http, creds: &dyn Creds) -> Result<String, String> {
    check_backoff()?;
    if !force {
        if let Some(t) = token().lock().unwrap().as_ref() {
            if t.expires > Instant::now() + Duration::from_secs(60) { return Ok(t.access.clone()) }
        }
    }
    let _refresh_guard = refresh_lock().lock().unwrap();
    if !force {
        if let Some(t) = token().lock().unwrap().as_ref() {
            if t.expires > Instant::now() + Duration::from_secs(60) { return Ok(t.access.clone()) }
        }
    }
    let refresh_value = creds.load().map_err(|_| SIGN_AGAIN.to_string())?.ok_or_else(|| SIGN_AGAIN.to_string())?;
    let started = Instant::now();
    match refresh(http, cfg, &refresh_value) {
        TokenReply::Ok(access, seconds, replacement) => {
            if let Some(v) = replacement { if !creds.save(&v) { return Err("failed".into()) } }
            *token().lock().unwrap() = Some(Token { access: access.clone(), expires: Instant::now() + Duration::from_secs(seconds) });
            crate::wall2_spotify_log::write(crate::wall2_spotify_log::Event::RefreshOk, crate::wall2_spotify_log::Reason::None, 200, started.elapsed().as_millis());
            Ok(access)
        }
        TokenReply::Refused => {
            creds.delete_if_equal(&refresh_value);
            *token().lock().unwrap() = None;
            crate::wall2_spotify_log::write(crate::wall2_spotify_log::Event::RefreshRefused, crate::wall2_spotify_log::Reason::SignInAgain, 400, started.elapsed().as_millis());
            Err(SIGN_AGAIN.into())
        }
        TokenReply::Busy(wait) => { back_off_for(wait); Err(BUSY.into()) }
        TokenReply::Down => { crate::wall2_spotify_log::write(crate::wall2_spotify_log::Event::ApiFailed, crate::wall2_spotify_log::Reason::Down, 0, started.elapsed().as_millis()); Err("down".into()) },
    }
}

fn access(cfg: &Config, force: bool) -> Result<String, String> { access_with(cfg, force, &RealHttp, &RealCreds) }

fn clean(value: Option<&Value>, max: usize) -> Option<String> {
    let s: String = value?.as_str()?.chars().filter(|c| !c.is_control() && !matches!(*c, '\u{200b}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2060}'..='\u{206f}')).collect();
    let s: String = s.trim().chars().take(max).collect();
    (!s.is_empty()).then_some(s)
}

fn valid_id(s: &str) -> bool { s.len() == 22 && s.bytes().all(|b| b.is_ascii_alphanumeric()) }
fn valid_device_id(s: &str) -> bool { (1..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-')) }
fn valid_image(s: &str) -> bool {
    s.len() <= 2048 && tauri::Url::parse(s).ok().is_some_and(|u| u.scheme() == "https" && u.port().is_none() && u.username().is_empty() && u.password().is_none() && matches!(u.host_str(), Some("i.scdn.co" | "mosaic.scdn.co" | "image-cdn-ak.spotifycdn.com")))
}
fn image_near(v: &Value, target: u64) -> Option<String> {
    let images = v.as_array()?;
    images.iter().filter_map(|x| {
        let url = x.get("url")?.as_str()?;
        Some((x.get("width")?.as_u64()?, url)).filter(|(_, url)| valid_image(url))
    }).min_by_key(|(width, _)| width.abs_diff(target)).map(|(_, url)| url.to_string()).or_else(|| images.iter().find_map(|x| x.get("url").and_then(Value::as_str).filter(|url| valid_image(url)).map(str::to_string)))
}

fn artists(v: &Value) -> Option<String> {
    let joined = v.as_array()?.iter().filter_map(|a| clean(a.get("name"), 80)).collect::<Vec<_>>().join(", ");
    clean(Some(&Value::String(joined)), 80)
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item { pub id: String, pub name: String, pub kind: String, pub image_url: Option<String>, pub thumb_url: Option<String>, pub subtitle: Option<String>, pub count: Option<u32> }

fn shape_item(v: &Value, kind: &str, current_user: Option<&Profile>) -> Option<Item> {
    let id = v.get("id")?.as_str()?;
    if !valid_id(id) { return None }
    let images = if kind == "track" { v.get("album").and_then(|a| a.get("images")).unwrap_or(&Value::Null) } else { v.get("images").unwrap_or(&Value::Null) };
    let subtitle = match kind {
        "playlist" => {
            let own = current_user.is_some_and(|me| v.pointer("/owner/id").and_then(Value::as_str) == Some(&me.id));
            let owner = own.then(|| clean(v.pointer("/owner/display_name"), 71).or_else(|| current_user.and_then(|me| me.display_name.as_ref().and_then(|name| clean(Some(&Value::String(name.clone())), 71))))).flatten();
            Some(owner.map_or_else(|| "Playlist".to_string(), |name| format!("Playlist, {name}")))
        }
        "album" => artists(v.get("artists").unwrap_or(&Value::Null)),
        "track" => artists(v.get("artists").unwrap_or(&Value::Null)),
        _ => None,
    }.and_then(|s| clean(Some(&Value::String(s)), 80));
    let count = match kind { "playlist" => v.pointer("/items/total").or_else(|| v.pointer("/tracks/total")), "album" => v.get("total_tracks"), _ => None }.and_then(Value::as_u64).and_then(|n| u32::try_from(n).ok());
    Some(Item { id: id.into(), name: clean(v.get("name"), 160)?, kind: kind.into(), image_url: image_near(images, 300), thumb_url: image_near(images, 64), subtitle, count })
}

fn shape_list(v: &Value, kind: &str, current_user: Option<&Profile>) -> Vec<Item> {
    v.get("items").and_then(Value::as_array).into_iter().flatten().take(PAGE_SIZE).filter_map(|x| {
        let candidate = if kind == "album" { x.get("album").unwrap_or(x) } else if kind == "track" { x.get("track").unwrap_or(x) } else { x };
        shape_item(candidate, kind, current_user)
    }).collect()
}

#[derive(Debug, PartialEq)] enum ReadAnswer { Empty, Json(Value) }
fn read_with(cfg: &Config, path: &str, limit: u64, http: &dyn Http, creds: &dyn Creds) -> Result<ReadAnswer, String> {
    check_backoff()?;
    let started = Instant::now();
    for attempt in 0..2 {
        let bearer = access_with(cfg, attempt == 1, http, creds)?;
        match http.api("GET", path, &bearer, None, limit) {
            Ok(resp) if resp.status == 204 => return Ok(ReadAnswer::Empty),
            Ok(resp) if (200..300).contains(&resp.status) => return serde_json::from_slice(&resp.body).map(ReadAnswer::Json).map_err(|_| "down".into()),
            Ok(resp) if resp.status == 401 && attempt == 0 => { crate::wall2_spotify_log::write(crate::wall2_spotify_log::Event::ApiFailed, crate::wall2_spotify_log::Reason::SignInAgain, 401, started.elapsed().as_millis()); continue },
            Ok(resp) if resp.status == 401 => return Err(SIGN_AGAIN.into()),
            Ok(resp) if resp.status == 429 => { back_off_for(retry_after(resp.retry_after)); crate::wall2_spotify_log::write(crate::wall2_spotify_log::Event::ApiFailed, crate::wall2_spotify_log::Reason::Busy, 429, started.elapsed().as_millis()); return Err(BUSY.into()) }
            Ok(resp) if resp.status == 403 && path.contains("/items?") => { crate::wall2_spotify_log::write(crate::wall2_spotify_log::Event::ApiFailed, crate::wall2_spotify_log::Reason::Down, 403, started.elapsed().as_millis()); return Err(NOT_YOURS.into()) }
            Ok(resp) if matches!(resp.status, 404 | 410) => { crate::wall2_spotify_log::write(crate::wall2_spotify_log::Event::ApiFailed, crate::wall2_spotify_log::Reason::Down, resp.status, started.elapsed().as_millis()); return Err(GONE.into()) }
            Ok(resp) => { crate::wall2_spotify_log::write(crate::wall2_spotify_log::Event::ApiFailed, crate::wall2_spotify_log::Reason::Down, resp.status, started.elapsed().as_millis()); return Err("refused".into()) }
            Err(_) => { crate::wall2_spotify_log::write(crate::wall2_spotify_log::Event::ApiFailed, crate::wall2_spotify_log::Reason::Down, 0, started.elapsed().as_millis()); return Err(NO_CONNECTION.into()) },
        }
    }
    Err(SIGN_AGAIN.into())
}
fn get_json_with_limit(cfg: &Config, path: &str, limit: u64, http: &dyn Http, creds: &dyn Creds) -> Result<Value, String> { match read_with(cfg, path, limit, http, creds)? { ReadAnswer::Json(value) => Ok(value), ReadAnswer::Empty => Err("down".into()) } }
fn get_json_with(cfg: &Config, path: &str, http: &dyn Http, creds: &dyn Creds) -> Result<Value, String> { get_json_with_limit(cfg, path, ANSWER_BODY, http, creds) }

fn get_json(cfg: &Config, path: &str) -> Result<Value, String> { get_json_with(cfg, path, &RealHttp, &RealCreds) }
fn get_track_json(cfg: &Config, path: &str) -> Result<Value, String> { get_json_with_limit(cfg, path, TRACK_BODY, &RealHttp, &RealCreds) }

fn page_path(page: Option<u32>) -> usize { (page.unwrap_or(0).min(100) as usize) * PAGE_SIZE }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status { setup: bool, signed_in: bool, reason: Option<String> }

#[tauri::command]
pub async fn wall2_spotify_status(window: WebviewWindow) -> Result<Status, String> {
    require(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if config(&app).is_err() { return Ok(Status { setup: false, signed_in: false, reason: Some(NOT_SETUP.into()) }) }
        match load_refresh() { Ok(Some(_)) => Ok(Status { setup: true, signed_in: true, reason: None }), Ok(None) => Ok(Status { setup: true, signed_in: false, reason: None }), Err(_) => Ok(Status { setup: true, signed_in: false, reason: Some("failed".into()) }) }
    }).await.map_err(|_| "failed".to_string())?
}

static SIGNING_IN: AtomicBool = AtomicBool::new(false);
static CANCEL_SIGN_IN: AtomicBool = AtomicBool::new(false);
fn begin_sign_in() -> Result<(), String> { if SIGNING_IN.swap(true, Ordering::SeqCst) { Err(BUSY.into()) } else { CANCEL_SIGN_IN.store(false, Ordering::SeqCst); Ok(()) } }
fn save_sign_in(creds: &dyn Creds, refresh_value: &str, access_value: String, seconds: u64) -> Result<(), String> {
    let _refresh_guard = refresh_lock().lock().unwrap();
    if CANCEL_SIGN_IN.load(Ordering::SeqCst) || !creds.save(refresh_value) { return Err("cancelled".into()) }
    *token().lock().unwrap() = Some(Token { access: access_value, expires: Instant::now() + Duration::from_secs(seconds) });
    PROFILE_GEN.fetch_add(1, Ordering::SeqCst); *profile_cache().lock().unwrap() = None;
    Ok(())
}
fn sign_out_with(creds: &dyn Creds) {
    CANCEL_SIGN_IN.store(true, Ordering::SeqCst);
    let _refresh_guard = refresh_lock().lock().unwrap();
    creds.delete();
    *token().lock().unwrap() = None;
    PROFILE_GEN.fetch_add(1, Ordering::SeqCst); *profile_cache().lock().unwrap() = None;
}
struct SignInGuard { started: Instant, success: bool }
impl Drop for SignInGuard {
    fn drop(&mut self) {
        SIGNING_IN.store(false, Ordering::SeqCst);
        let event = if self.success { crate::wall2_spotify_log::Event::SignInOk } else { crate::wall2_spotify_log::Event::SignInFailed };
        let reason = if self.success { crate::wall2_spotify_log::Reason::None } else { crate::wall2_spotify_log::Reason::Failed };
        crate::wall2_spotify_log::write(event, reason, if self.success { 200 } else { 0 }, self.started.elapsed().as_millis());
    }
}

#[tauri::command]
pub async fn wall2_spotify_sign_in(window: WebviewWindow) -> Result<(), String> {
    require(&window)?;
    let cfg = config(window.app_handle())?;
    begin_sign_in()?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = SignInGuard { started: Instant::now(), success: false };
        crate::wall2_spotify_log::write(crate::wall2_spotify_log::Event::SignInStart, crate::wall2_spotify_log::Reason::None, 0, 0);
        let verifier = crate::wall2_oauth::random_b64(32).ok_or_else(|| "failed".to_string())?;
        let state = crate::wall2_oauth::random_b64(16).ok_or_else(|| "failed".to_string())?;
        let challenge = crate::wall2_oauth::challenge_for(&verifier).ok_or_else(|| "failed".to_string())?;
        let server = tiny_http::Server::http(format!("127.0.0.1:{}", cfg.redirect_port)).map_err(|_| "port busy".to_string())?;
        app.opener().open_url(authorize_url(&cfg, &challenge, &state), None::<&str>).map_err(|_| "failed".to_string())?;
        let code = crate::wall2_oauth::wait_for_callback_cancelled(&server, CALLBACK, &state, Duration::from_secs(180), || CANCEL_SIGN_IN.load(Ordering::SeqCst)).map_err(str::to_string)?;
        if CANCEL_SIGN_IN.load(Ordering::SeqCst) { return Err("cancelled".into()) }
        let result = match exchange(&RealHttp, &cfg, &code, &verifier) {
            TokenReply::Ok(access_value, seconds, Some(refresh_value)) => {
                save_sign_in(&RealCreds, &refresh_value, access_value, seconds)?; guard.success = true; Ok(())
            }
            TokenReply::Busy(wait) => { back_off_for(wait); Err(BUSY.into()) },
            _ => Err("failed".into()),
        };
        result
    }).await.map_err(|_| "failed".to_string())?
}

#[tauri::command]
pub async fn wall2_spotify_cancel_sign_in(window: WebviewWindow) -> Result<(), String> { require(&window)?; CANCEL_SIGN_IN.store(true, Ordering::SeqCst); Ok(()) }

#[tauri::command]
pub async fn wall2_spotify_sign_out(window: WebviewWindow) -> Result<(), String> {
    require(&window)?; CANCEL_SIGN_IN.store(true, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || { sign_out_with(&RealCreds); crate::wall2_spotify_log::write(crate::wall2_spotify_log::Event::SignOut, crate::wall2_spotify_log::Reason::None, 0, 0); Ok(()) }).await.map_err(|_| "failed".to_string())?
}

fn profile_with(cfg: &Config, http: &dyn Http, creds: &dyn Creds) -> Result<Profile, String> {
    if let Some(profile) = profile_cache().lock().unwrap().clone() { return Ok(profile) }
    let _fetch = profile_fetch_lock().lock().unwrap();
    if let Some(profile) = profile_cache().lock().unwrap().clone() { return Ok(profile) }
    let generation = PROFILE_GEN.load(Ordering::SeqCst);
    let value = get_json_with(cfg, "/me", http, creds)?;
    let id = clean(value.get("id"), 80).ok_or_else(|| "down".to_string())?;
    let profile = Profile { id, display_name: clean(value.get("display_name"), 80) };
    if PROFILE_GEN.load(Ordering::SeqCst) == generation { *profile_cache().lock().unwrap() = Some(profile.clone()); }
    Ok(profile)
}
fn profile(cfg: &Config) -> Result<Profile, String> { profile_with(cfg, &RealHttp, &RealCreds) }
fn list(window: &WebviewWindow, endpoint: &str, kind: &str) -> Result<Vec<Item>, String> { let cfg = config(window.app_handle())?; let current_user = if kind == "playlist" { Some(profile(&cfg)?) } else { None }; Ok(shape_list(&get_track_json(&cfg, endpoint)?, kind, current_user.as_ref())) }

#[tauri::command] pub async fn wall2_spotify_playlists(window: WebviewWindow, page: Option<u32>) -> Result<Vec<Item>, String> { require(&window)?; tauri::async_runtime::spawn_blocking(move || list(&window, &format!("/me/playlists?limit=50&offset={}", page_path(page)), "playlist")).await.map_err(|_| "failed".to_string())? }
#[tauri::command] pub async fn wall2_spotify_albums(window: WebviewWindow, page: Option<u32>) -> Result<Vec<Item>, String> { require(&window)?; tauri::async_runtime::spawn_blocking(move || list(&window, &format!("/me/albums?limit=50&offset={}", page_path(page)), "album")).await.map_err(|_| "failed".to_string())? }
#[tauri::command] pub async fn wall2_spotify_liked(window: WebviewWindow, page: Option<u32>) -> Result<Vec<Item>, String> { require(&window)?; tauri::async_runtime::spawn_blocking(move || list(&window, &format!("/me/tracks?market=from_token&limit=50&offset={}", page_path(page)), "track")).await.map_err(|_| "failed".to_string())? }
#[tauri::command] pub async fn wall2_spotify_recent(window: WebviewWindow) -> Result<Vec<Item>, String> { require(&window)?; tauri::async_runtime::spawn_blocking(move || list(&window, "/me/player/recently-played?market=from_token&limit=50", "track")).await.map_err(|_| "failed".to_string())? }

#[derive(Debug, Serialize)] pub struct Search { tracks: Vec<Item>, albums: Vec<Item>, playlists: Vec<Item> }
fn valid_query(query: &str) -> Result<String, String> {
    let clean: String = query.chars().filter(|c| !c.is_control()).collect();
    let clean: String = clean.trim().chars().take(80).collect();
    if clean.is_empty() { Err("invalid query".into()) } else { Ok(clean) }
}

#[tauri::command]
pub async fn wall2_spotify_search(window: WebviewWindow, query: String) -> Result<Search, String> {
    require(&window)?;
    let query = valid_query(&query)?;
    tauri::async_runtime::spawn_blocking(move || { let cfg = config(window.app_handle())?; let current_user = profile(&cfg)?; let v = get_track_json(&cfg, &format!("/search?market=from_token&type=track,album,playlist&limit=10&q={}", urlencoding::encode(&query)))?; Ok(Search { tracks: shape_list(v.get("tracks").unwrap_or(&Value::Null), "track", None), albums: shape_list(v.get("albums").unwrap_or(&Value::Null), "album", None), playlists: shape_list(v.get("playlists").unwrap_or(&Value::Null), "playlist", Some(&current_user)) }) }).await.map_err(|_| "failed".to_string())?
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Track { id: Option<String>, name: String, artists: String, album: String, duration_ms: u32, image_url: Option<String>, thumb_url: Option<String>, playable: bool }
#[derive(Debug, Serialize, PartialEq)]
pub struct TrackPage { items: Vec<Track>, total: u32, more: bool }
fn shape_track(v: &Value) -> Option<Track> {
    let local = v.get("is_local").and_then(Value::as_bool).unwrap_or(false);
    let playable = !local && v.get("is_playable").and_then(Value::as_bool).unwrap_or(true) && v.get("restrictions").is_none_or(Value::is_null) && v.get("type").and_then(Value::as_str).unwrap_or("track") == "track";
    let id = v.get("id").and_then(Value::as_str).filter(|id| valid_id(id) && playable).map(str::to_string);
    let images = v.pointer("/album/images").unwrap_or(&Value::Null);
    let playable = playable && id.is_some();
    Some(Track { id, name: clean(v.get("name"), 80)?, artists: artists(v.get("artists").unwrap_or(&Value::Null)).unwrap_or_default(), album: clean(v.pointer("/album/name"), 80).unwrap_or_default(), duration_ms: v.get("duration_ms").and_then(Value::as_u64).and_then(|n| u32::try_from(n).ok()).unwrap_or(0), image_url: image_near(images, 300), thumb_url: image_near(images, 64), playable })
}
fn shape_track_page(v: &Value, kind: &str) -> TrackPage {
    let items = v.get("items").and_then(Value::as_array).into_iter().flatten().take(PAGE_SIZE).filter_map(|entry| {
        let item = if kind == "playlist" { entry.get("item").or_else(|| entry.get("track")).unwrap_or(entry) } else { entry };
        shape_track(item)
    }).collect::<Vec<_>>();
    let total = v.get("total").and_then(Value::as_u64).and_then(|n| u32::try_from(n).ok()).unwrap_or(items.len() as u32);
    TrackPage { more: v.get("next").is_some_and(|n| !n.is_null()), items, total }
}
fn add_album_to_tracks(page: &mut Value, album: &Value) {
    let summary = json!({"name":album.get("name").cloned().unwrap_or(Value::Null),"images":album.get("images").cloned().unwrap_or(Value::Array(Vec::new()))});
    if let Some(items) = page.get_mut("items").and_then(Value::as_array_mut) { for item in items { if let Some(object) = item.as_object_mut() { object.insert("album".into(), summary.clone()); } } }
}
fn validate_tracks(kind: &str, id: &str, page: Option<u32>) -> Result<u32, String> { let page = page.unwrap_or(0); if !matches!(kind, "playlist" | "album") || !valid_id(id) || page > 39 { Err("invalid id".into()) } else { Ok(page) } }
#[tauri::command]
pub async fn wall2_spotify_tracks(window: WebviewWindow, kind: String, id: String, page: Option<u32>) -> Result<TrackPage, String> { require(&window)?; let page = validate_tracks(&kind, &id, page)?; tauri::async_runtime::spawn_blocking(move || { let cfg = config(window.app_handle())?; let path = if kind == "playlist" { format!("/playlists/{id}/items?market=from_token&limit=50&offset={}&additional_types=track&fields=items(item(id,name,type,is_local,is_playable,restrictions,artists(name),album(name,images),duration_ms)),next,total", page as usize * PAGE_SIZE) } else { format!("/albums/{id}/tracks?market=from_token&limit=50&offset={}", page as usize * PAGE_SIZE) }; let mut value = get_track_json(&cfg, &path)?; if kind == "album" { let album = get_track_json(&cfg, &format!("/albums/{id}?market=from_token"))?; add_album_to_tracks(&mut value, &album); } Ok(shape_track_page(&value, &kind)) }).await.map_err(|_| "failed".to_string())? }

#[derive(Debug, Serialize, PartialEq)] pub struct Queue { current: Option<Track>, next: Vec<Track> }
fn shape_queue(v: &Value) -> Queue { Queue { current: v.get("currently_playing").and_then(shape_track), next: v.get("queue").and_then(Value::as_array).into_iter().flatten().filter_map(shape_track).take(10).collect() } }
fn get_queue_with(cfg: &Config, http: &dyn Http, creds: &dyn Creds) -> Result<Queue, String> { match read_with(cfg, "/me/player/queue?market=from_token", TRACK_BODY, http, creds)? { ReadAnswer::Empty => Ok(Queue { current: None, next: Vec::new() }), ReadAnswer::Json(value) => Ok(shape_queue(&value)) } }
#[tauri::command] pub async fn wall2_spotify_queue(window: WebviewWindow) -> Result<Queue, String> { require(&window)?; tauri::async_runtime::spawn_blocking(move || { let cfg = config(window.app_handle())?; get_queue_with(&cfg, &RealHttp, &RealCreds) }).await.map_err(|_| "failed".to_string())? }

#[derive(Debug, Serialize, PartialEq)] pub struct PlaybackDevice { name: String, kind: String }
#[derive(Debug, Serialize, PartialEq)] #[serde(rename_all = "camelCase")] pub struct Playback { playing: bool, device: Option<PlaybackDevice>, track: Option<Track>, progress_ms: u32, shuffle: bool }
fn shape_playback(v: &Value) -> Playback { Playback { playing: v.get("is_playing").and_then(Value::as_bool).unwrap_or(false), device: v.get("device").and_then(|d| Some(PlaybackDevice { name: clean(d.get("name"), 40)?, kind: clean(d.get("type"), 40).unwrap_or_else(|| "unknown".into()) })), track: v.get("item").and_then(shape_track), progress_ms: v.get("progress_ms").and_then(Value::as_u64).and_then(|n| u32::try_from(n).ok()).unwrap_or(0), shuffle: v.get("shuffle_state").and_then(Value::as_bool).unwrap_or(false) } }
fn get_playback_with(cfg: &Config, http: &dyn Http, creds: &dyn Creds) -> Result<Option<Playback>, String> {
    match read_with(cfg, "/me/player", ANSWER_BODY, http, creds)? { ReadAnswer::Empty => Ok(None), ReadAnswer::Json(value) => Ok(Some(shape_playback(&value))) }
}
#[tauri::command] pub async fn wall2_spotify_playback(window: WebviewWindow) -> Result<Option<Playback>, String> { require(&window)?; tauri::async_runtime::spawn_blocking(move || { let cfg = config(window.app_handle())?; get_playback_with(&cfg, &RealHttp, &RealCreds) }).await.map_err(|_| "failed".to_string())? }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Device { id: String, name: String, kind: String, active: bool, restricted: bool, volume: Option<u8> }
fn shape_devices(v: &Value) -> Vec<Device> {
    v.get("devices").and_then(Value::as_array).into_iter().flatten().take(50).filter_map(|d| {
        let id = d.get("id")?.as_str()?; if !valid_device_id(id) { return None }
        Some(Device { id: id.into(), name: clean(d.get("name"), 100)?, kind: clean(d.get("type"), 40).unwrap_or_else(|| "unknown".into()), active: d.get("is_active").and_then(Value::as_bool).unwrap_or(false), restricted: d.get("is_restricted").and_then(Value::as_bool).unwrap_or(false), volume: d.get("volume_percent").and_then(Value::as_u64).filter(|n| *n <= 100).map(|n| n as u8) })
    }).collect()
}
#[tauri::command] pub async fn wall2_spotify_devices(window: WebviewWindow) -> Result<Vec<Device>, String> { require(&window)?; tauri::async_runtime::spawn_blocking(move || { let cfg = config(window.app_handle())?; Ok(shape_devices(&get_json(&cfg, "/me/player/devices")?)) }).await.map_err(|_| "failed".to_string())? }

fn choose_device(devices: &[Device], requested: Option<&str>, computer: Option<&str>) -> Option<String> {
    if let Some(id) = requested { return devices.iter().find(|d| d.id == id).map(|d| d.id.clone()) }
    devices.iter().find(|d| d.active).or_else(|| computer.and_then(|n| devices.iter().find(|d| d.name.eq_ignore_ascii_case(n)))).or_else(|| {
        let mut computers = devices.iter().filter(|d| !d.restricted && d.kind.eq_ignore_ascii_case("computer"));
        let only = computers.next()?;
        computers.next().is_none().then_some(only)
    }).map(|d| d.id.clone())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayContext { kind: String, id: String }
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayRequest { kind: String, id: String, device_id: Option<String>, context: Option<PlayContext>, offset_id: Option<String> }
static WRITE: OnceLock<Mutex<()>> = OnceLock::new();
static STARTING_PLAYER: AtomicBool = AtomicBool::new(false);
fn write_lock() -> &'static Mutex<()> { WRITE.get_or_init(|| Mutex::new(())) }
fn begin_write() -> Result<std::sync::MutexGuard<'static, ()>, String> { write_lock().try_lock().map_err(|_| BUSY.to_string()) }

fn put_with(cfg: &Config, path: &str, payload: Option<Value>, http: &dyn Http, creds: &dyn Creds) -> Result<(), String> {
    let _guard = begin_write()?;
    check_backoff()?;
    let bearer = access_with(cfg, false, http, creds)?;
    let started = Instant::now();
    match http.api("PUT", path, &bearer, payload.as_ref(), ANSWER_BODY) {
        Ok(resp) if (200..300).contains(&resp.status) => Ok(()),
        Ok(resp) if resp.status == 404 => { crate::wall2_spotify_log::write(crate::wall2_spotify_log::Event::ApiFailed, crate::wall2_spotify_log::Reason::NoDevice, 404, started.elapsed().as_millis()); Err(NO_DEVICE.into()) },
        Ok(resp) if resp.status == 429 => { back_off_for(retry_after(resp.retry_after)); crate::wall2_spotify_log::write(crate::wall2_spotify_log::Event::ApiFailed, crate::wall2_spotify_log::Reason::Busy, 429, started.elapsed().as_millis()); Err(BUSY.into()) }
        Ok(resp) if resp.status == 401 => { access_with(cfg, true, http, creds).map(|_| ())?; Err(BUSY.into()) }
        Ok(resp) => { crate::wall2_spotify_log::write(crate::wall2_spotify_log::Event::ApiFailed, crate::wall2_spotify_log::Reason::Down, resp.status, started.elapsed().as_millis()); Err("down".into()) }
        Err(_) => { crate::wall2_spotify_log::write(crate::wall2_spotify_log::Event::ApiFailed, crate::wall2_spotify_log::Reason::Down, 0, started.elapsed().as_millis()); Err("down".into()) },
    }
}
fn put(cfg: &Config, path: &str, payload: Option<Value>) -> Result<(), String> { put_with(cfg, path, payload, &RealHttp, &RealCreds) }

fn validate_play(request: &PlayRequest) -> Result<(), String> {
    if !valid_id(&request.id) || !matches!(request.kind.as_str(), "track" | "album" | "playlist") || request.device_id.as_deref().is_some_and(|id| !valid_device_id(id)) || request.offset_id.as_deref().is_some_and(|id| !valid_id(id)) || request.offset_id.is_some() && request.context.is_none() || request.context.as_ref().is_some_and(|c| !matches!(c.kind.as_str(), "playlist" | "album") || !valid_id(&c.id)) { Err("invalid id".into()) } else { Ok(()) }
}
fn play_payload(request: &PlayRequest) -> Value {
    let uri = format!("spotify:{}:{}", request.kind, request.id);
    match (&request.context, &request.offset_id) { (Some(context), Some(offset)) => json!({"context_uri":format!("spotify:{}:{}", context.kind, context.id),"offset":{"uri":format!("spotify:track:{offset}")}}), (Some(context), None) => json!({"context_uri":format!("spotify:{}:{}", context.kind, context.id)}), _ if request.kind == "track" => json!({"uris":[uri]}), _ => json!({"context_uri":uri}) }
}

#[tauri::command]
pub async fn wall2_spotify_play(window: WebviewWindow, request: PlayRequest) -> Result<(), String> {
    require(&window)?; validate_play(&request)?;
    tauri::async_runtime::spawn_blocking(move || {
        let result = (|| {
            let cfg = config(window.app_handle())?;
            let computer = std::env::var("COMPUTERNAME").ok();
            let mut devices = shape_devices(&get_json(&cfg, "/me/player/devices")?);
            let mut device = choose_device(&devices, request.device_id.as_deref(), computer.as_deref());
            if device.is_none() {
                if STARTING_PLAYER.swap(true, Ordering::SeqCst) { return Err(BUSY.into()) }
                window.app_handle().opener().open_url("spotify:", None::<&str>).map_err(|_| "failed".to_string())?;
                for _ in 0..12 {
                    std::thread::sleep(Duration::from_secs(1));
                    devices = shape_devices(&get_json(&cfg, "/me/player/devices")?);
                    device = choose_device(&devices, request.device_id.as_deref(), computer.as_deref());
                    if device.is_some() { break }
                }
            }
            let device = device.ok_or_else(|| NO_DEVICE.to_string())?;
            put(&cfg, &format!("/me/player/play?device_id={device}"), Some(play_payload(&request)))
        })();
        STARTING_PLAYER.store(false, Ordering::SeqCst);
        result
    }).await.map_err(|_| "failed".to_string())?
}

#[tauri::command] pub async fn wall2_spotify_transfer(window: WebviewWindow, device_id: String) -> Result<(), String> { require(&window)?; if !valid_device_id(&device_id) { return Err("invalid id".into()) } tauri::async_runtime::spawn_blocking(move || { let cfg = config(window.app_handle())?; put(&cfg, "/me/player", Some(json!({"device_ids":[device_id],"play":false}))) }).await.map_err(|_| "failed".to_string())? }
fn shuffle_with(cfg: &Config, on: bool, http: &dyn Http, creds: &dyn Creds, computer: Option<&str>) -> Result<(), String> { let devices = shape_devices(&get_json_with(cfg, "/me/player/devices", http, creds)?); let device = choose_device(&devices, None, computer).ok_or_else(|| NO_DEVICE.to_string())?; put_with(cfg, &format!("/me/player/shuffle?state={on}&device_id={device}"), None, http, creds) }
#[tauri::command] pub async fn wall2_spotify_shuffle(window: WebviewWindow, on: bool) -> Result<(), String> { require(&window)?; tauri::async_runtime::spawn_blocking(move || { let cfg = config(window.app_handle())?; let computer = std::env::var("COMPUTERNAME").ok(); shuffle_with(&cfg, on, &RealHttp, &RealCreds, computer.as_deref()) }).await.map_err(|_| "failed".to_string())? }

pub fn start_log(dir: Option<std::path::PathBuf>) { crate::wall2_spotify_log::start(dir); }

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::{Arc, Condvar};
    static TEST_LOCK: Mutex<()> = Mutex::new(());
    const ID: &str = "0123456789ABCDEFGHIJKL";
    const DEVICE: &str = "0123456789abcdef0123456789abcdef01234567";
    const COVER: &str = "https://i.scdn.co/image/cover";

    #[test]
    fn config_rules_and_bounds() {
        let base = |extra: &str| format!(r#"{{"clientId":"0123456789abcdef0123456789abcdef"{extra}}}"#);
        assert_eq!(parse_config(Some(&base(""))).unwrap().redirect_port, 8898);
        assert_eq!(parse_config(Some(&base(r#", "redirectPort":65535"#))).unwrap().redirect_port, 65535);
        for bad in [base(r#", "redirectPort":1023"#), base(r#", "redirectPort":65536"#), r#"{"clientId":"xyz"}"#.into(), r#"{"clientId":12}"#.into(), r#"{"clientId":"0123456789abcdef0123456789abcdef","redirectPort":"8898"}"#.into()] { assert!(parse_config(Some(&bad)).is_err(), "{bad}"); }
        let path = std::env::temp_dir().join("wall2-spotify-oversize-test.json");
        let prefix = r#"{"clientId":"0123456789abcdef0123456789abcdef","pad":""#;
        let suffix = r#""}"#;
        let oversized = format!("{prefix}{}{suffix}", "x".repeat(4097 - prefix.len() - suffix.len()));
        assert_eq!(oversized.len(), 4097); assert!(serde_json::from_str::<Value>(&oversized).is_ok());
        std::fs::write(&path, oversized).unwrap();
        assert_eq!(read_config_file(&path), Err(NOT_SETUP.into()));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn url_and_callback_checks_are_exact() {
        let c = Config { client_id: "a".repeat(32), redirect_port: 8898 };
        assert!(authorize_url(&c, "challenge", "state").contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A8898%2Fcallback"));
        use crate::wall2_oauth::{parse_callback, Callback};
        assert_eq!(parse_callback("/callback?code=x&state=s", CALLBACK, "s"), Callback::Code("x".into()));
        for target in ["/wrong?code=x&state=s", "/callback?code=x&state=z", "/callback?code=x", "/callback?code=x&state=s&state=s"] { assert_ne!(parse_callback(target, CALLBACK, "s"), Callback::Code("x".into())); }
    }

    #[test]
    fn ids_queries_and_images_are_strict() {
        assert!(valid_id(ID)); assert!(!valid_id("short"));
        assert!(valid_device_id(DEVICE)); assert!(valid_device_id("a_B-9")); assert!(!valid_device_id("")); assert!(!valid_device_id(&"a".repeat(65))); assert!(!valid_device_id("bad id"));
        assert_eq!(valid_query(&format!("  a\n{}  ", "b".repeat(100))).unwrap().chars().count(), 80); assert!(valid_query("\n\t").is_err());
        assert!(valid_image(COVER)); assert!(!valid_image("https://example.com/a")); assert!(!valid_image("https://i.scdn.co:444/a")); assert!(!valid_image("https://user@i.scdn.co/a"));
    }

    #[test]
    fn every_item_shape_is_bounded_cleaned_and_gets_track_art() {
        let track = json!({"id":ID,"name":"hello\nworld","album":{"images":[{"url":COVER}]}});
        for root in [json!({"items":[track.clone()]}), json!({"items":[{"track":track.clone()}]})] { let got = shape_list(&root, "track", None); assert_eq!(got[0].image_url.as_deref(), Some(COVER)); assert_eq!(got[0].name, "helloworld"); }
        let huge = json!({"items":(0..1000).map(|_| json!({"id":ID,"name":"ok","images":null})).collect::<Vec<_>>()});
        assert_eq!(shape_list(&huge, "album", None).len(), 50);
        for hostile in [Value::Null, json!({"items":null}), json!({"items":[null, 3, {"id":ID,"name":"\n"}]})] { assert!(shape_list(&hostile, "playlist", None).is_empty()); }
    }

    #[test]
    fn item_metadata_selects_nearest_images_and_bounds_fields() {
        let item = json!({"id":ID,"name":"List","owner":{"id":"me","display_name":"x".repeat(100)},"tracks":{"total":42},"images":[
            {"url":"https://i.scdn.co/image/no-width"},{"url":"https://example.com/bad","width":300},{"url":"https://i.scdn.co/image/large","width":640},{"url":"https://i.scdn.co/image/main","width":320},{"url":"https://i.scdn.co/image/thumb","width":60}]});
        let me = Profile { id:"me".into(), display_name:Some("Cached owner".into()) }; let got = shape_item(&item, "playlist", Some(&me)).unwrap();
        assert_eq!(got.image_url.as_deref(), Some("https://i.scdn.co/image/main"));
        assert_eq!(got.thumb_url.as_deref(), Some("https://i.scdn.co/image/thumb"));
        assert_eq!(got.subtitle.as_ref().unwrap().chars().count(), 80); assert_eq!(got.count, Some(42));
        let other_profile = Profile { id:"other".into(), display_name:None }; let other = shape_item(&item, "playlist", Some(&other_profile)).unwrap(); assert_eq!(other.subtitle.as_deref(), Some("Playlist"));
        let none = shape_item(&json!({"id":ID,"name":"No art","images":null,"total_tracks":u64::MAX}), "album", None).unwrap(); assert_eq!((none.image_url, none.thumb_url, none.count), (None, None, None));
    }

    #[test]
    fn track_pages_refuse_bad_inputs_and_keep_unplayable_rows() {
        for (kind, id, page) in [("track", ID, Some(0)), ("playlist", "bad", Some(0)), ("album", ID, Some(40))] { assert_eq!(validate_tracks(kind, id, page), Err("invalid id".into())); }
        let page = shape_track_page(&json!({"total":4,"next":"next","items":[{"track":{"id":ID,"name":"Song","artists":[{"name":"Artist"}],"album":{"name":"Album","images":[]},"duration_ms":123}},{"track":{"id":ID,"name":"Unavailable","is_playable":false,"artists":[],"album":{"name":"Album","images":[]}}},{"track":{"id":ID,"name":"Restricted","restrictions":{"reason":"market"},"artists":[],"album":{"name":"Album","images":[]}}},{"track":{"id":null,"name":"Local","type":"track","is_local":true,"artists":[],"album":{"name":"","images":[]}}}]}), "playlist");
        assert_eq!((page.items.len(), page.total, page.more), (4, 4, true)); assert!(page.items[0].playable); for row in &page.items[1..] { assert!(!row.playable); assert_eq!(row.id, None); }
        let mut album_page = json!({"items":[{"id":ID,"name":"Song","artists":[]}],"total":1}); add_album_to_tracks(&mut album_page, &json!({"name":"Record","images":[{"url":COVER,"width":300}]})); let album = shape_track_page(&album_page,"album"); assert_eq!(album.items[0].album,"Record"); assert_eq!(album.items[0].image_url.as_deref(),Some(COVER));
    }

    #[test]
    fn playlist_pages_accept_current_and_legacy_entries_and_ignore_nulls() {
        let track = json!({"id":ID,"name":"Song","type":"track","artists":[],"album":{"name":"Album","images":[]}});
        let current = shape_track_page(&json!({"total":3,"items":[{"item":track.clone()},{"item":null},{"item":{"id":ID,"name":"Talk","type":"episode","artists":[],"album":{}}}]}), "playlist");
        assert_eq!(current.items.len(), 2);
        assert!(current.items[0].playable);
        assert!(!current.items[1].playable);
        let legacy = shape_track_page(&json!({"items":[{"track":track}]}), "playlist");
        assert_eq!(legacy.items.len(), 1);
        let me = Profile { id:"me".into(), display_name:None };
        let item = shape_item(&json!({"id":ID,"name":"List","items":{"total":7},"owner":{"id":"me"}}), "playlist", Some(&me)).unwrap();
        assert_eq!(item.count, Some(7));
    }

    #[test]
    fn contextual_play_validation_and_payload_are_exact() {
        let other = "ABCDEFGHIJKL0123456789";
        let request = PlayRequest { kind:"album".into(), id:other.into(), device_id:None, context:Some(PlayContext { kind:"playlist".into(), id:ID.into() }), offset_id:Some(ID.into()) };
        assert!(validate_play(&request).is_ok()); assert_eq!(play_payload(&request), json!({"context_uri":format!("spotify:playlist:{ID}"),"offset":{"uri":format!("spotify:track:{ID}")}}));
        let make = |context:Option<PlayContext>, offset:&str| PlayRequest { kind:"track".into(), id:ID.into(), device_id:None, context, offset_id:Some(offset.into()) };
        assert_eq!(validate_play(&make(None, ID)), Err("invalid id".into()));
        assert_eq!(validate_play(&make(Some(PlayContext { kind:"track".into(), id:ID.into() }), ID)), Err("invalid id".into()));
        assert_eq!(validate_play(&make(Some(PlayContext { kind:"playlist".into(), id:"bad".into() }), ID)), Err("invalid id".into()));
        assert_eq!(validate_play(&make(Some(PlayContext { kind:"playlist".into(), id:ID.into() }), "bad")), Err("invalid id".into()));
    }

    #[test]
    fn queue_caps_next_and_playback_maps_empty_response() {
        let song = json!({"id":ID,"name":"Song","artists":[],"album":{"name":"Album","images":[]}});
        let q = shape_queue(&json!({"currently_playing":song.clone(),"queue":vec![song; 15]})); assert!(q.current.is_some()); assert_eq!(q.next.len(), 10);
        let _test_guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner()); reset_state(); *token().lock().unwrap()=Some(Token{access:"ok".into(),expires:Instant::now()+Duration::from_secs(3600)}); let creds=FakeCreds::new(Some("old")); let http=FakeHttp::new(vec![],vec![hr(204,"")]); assert_eq!(get_playback_with(&cfg(),&http,&creds),Ok(None));
        let empty = FakeHttp::new(vec![],vec![hr(204,"")]); assert_eq!(get_queue_with(&cfg(),&empty,&creds),Ok(Queue { current:None, next:vec![] }));
    }

    #[test]
    fn response_limits_accept_exact_limit_and_refuse_one_more() {
        for limit in [ANSWER_BODY, TRACK_BODY] { let under = vec![b'x'; limit as usize - 1]; assert_eq!(read_limited(&mut std::io::Cursor::new(under),limit).unwrap().len(),limit as usize - 1); let over=vec![b'x'; limit as usize + 1]; assert_eq!(read_limited(&mut std::io::Cursor::new(over),limit),Err("down")); }
    }

    #[test]
    fn list_reads_accept_realistic_pages_and_small_reads_keep_the_small_limit() {
        let _test_guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner()); reset_state();
        *token().lock().unwrap()=Some(Token{access:"ok".into(),expires:Instant::now()+Duration::from_secs(3600)});
        let creds=FakeCreds::new(Some("old"));
        let tracks=(0..50).map(|_| json!({"id":ID,"name":"Song","artists":[{"name":"Artist"}],"album":{"name":"Album","images":[]},"padding":"x".repeat(3900)})).collect::<Vec<_>>();
        let body=serde_json::to_vec(&json!({"items":tracks})).unwrap(); assert!((190_000..220_000).contains(&body.len()));
        let list_http=FakeHttp::new(vec![],vec![Ok(HttpReply{status:200,retry_after:None,body})]);
        assert!(get_json_with_limit(&cfg(),"/list",TRACK_BODY,&list_http,&creds).is_ok()); assert_eq!(list_http.limits(),vec![TRACK_BODY]);
        let small_body=serde_json::to_vec(&json!({"padding":"x".repeat(ANSWER_BODY as usize)})).unwrap();
        let small_http=FakeHttp::new(vec![],vec![Ok(HttpReply{status:200,retry_after:None,body:small_body})]);
        assert_eq!(get_json_with(&cfg(),"/small",&small_http,&creds),Err("down".into())); assert_eq!(small_http.limits(),vec![ANSWER_BODY]);
    }

    #[test]
    fn device_shaper_and_choice_cover_every_branch() {
        let shaped = shape_devices(&json!({"devices":[{"id":DEVICE,"name":"Desk","type":"Computer","is_active":false,"volume_percent":44}, null, {"id":"bad id","name":"Bad"}]}));
        assert_eq!(shaped.len(), 1); assert_eq!(shaped[0].volume, Some(44));
        let other = "abcdef0123456789abcdef0123456789abcdef01";
        let d = |id:&str,name:&str,active| Device{id:id.into(),name:name.into(),kind:"computer".into(),active,restricted:false,volume:None};
        let active = vec![d(DEVICE,"Desk",false),d(other,"Other",true)];
        assert_eq!(choose_device(&active,None,Some("Desk")).as_deref(),Some(other));
        assert_eq!(choose_device(&active,Some(DEVICE),None).as_deref(),Some(DEVICE));
        let named = vec![d(DEVICE,"Desk",false)]; assert_eq!(choose_device(&named,None,Some("desk")).as_deref(),Some(DEVICE));
        assert_eq!(choose_device(&named,None,Some("Missing")).as_deref(),Some(DEVICE));
        let restricted = vec![Device { restricted:true, ..d(DEVICE,"Desk",false) }]; assert_eq!(choose_device(&restricted,None,None),None);
        let two = vec![d(DEVICE,"Desk",false),d(other,"Other",false)]; assert_eq!(choose_device(&two,None,None),None);
        assert_eq!(choose_device(&[],None,None),None);
    }

    #[test]
    fn token_replies_cover_success_refused_network_and_retry_after() {
        let reply = |status, body: &str| HttpReply { status, retry_after: None, body: body.as_bytes().to_vec() };
        assert_eq!(token_reply(Ok(reply(200,r#"{"access_token":"a","expires_in":90,"refresh_token":"r"}"#))), TokenReply::Ok("a".into(),90,Some("r".into())));
        assert_eq!(token_reply(Ok(HttpReply { status:429,retry_after:Some(90),body:vec![] })), TokenReply::Busy(Duration::from_secs(60)));
        assert_eq!(token_reply(Ok(reply(400,r#"{"error":"invalid_grant"}"#))), TokenReply::Refused);
        assert_eq!(token_reply(Ok(reply(403,r#"{"error":"forbidden"}"#))), TokenReply::Down);
        assert_eq!(token_reply(Err(())), TokenReply::Down);
    }

    struct FakeCreds(Mutex<Option<String>>);
    impl FakeCreds { fn new(value: Option<&str>) -> Self { Self(Mutex::new(value.map(str::to_string))) } fn value(&self) -> Option<String> { self.0.lock().unwrap().clone() } }
    impl Creds for FakeCreds {
        fn load(&self) -> Result<Option<String>, &'static str> { Ok(self.value()) }
        fn save(&self, value: &str) -> bool { *self.0.lock().unwrap() = Some(value.into()); true }
        fn delete(&self) { *self.0.lock().unwrap() = None; }
        fn delete_if_equal(&self, expected: &str) { let mut value = self.0.lock().unwrap(); if value.as_deref() == Some(expected) { *value = None; } }
    }
    struct FakeHttp { tokens: Mutex<VecDeque<Result<HttpReply, ()>>>, apis: Mutex<VecDeque<Result<HttpReply, ()>>>, limits: Mutex<Vec<u64>>, token_calls: std::sync::atomic::AtomicUsize, api_calls: std::sync::atomic::AtomicUsize }
    impl FakeHttp {
        fn new(tokens: Vec<Result<HttpReply,()>>, apis: Vec<Result<HttpReply,()>>) -> Self { Self { tokens: Mutex::new(tokens.into()), apis: Mutex::new(apis.into()), limits: Mutex::new(Vec::new()), token_calls: 0.into(), api_calls: 0.into() } }
        fn counts(&self) -> (usize,usize) { (self.token_calls.load(Ordering::SeqCst), self.api_calls.load(Ordering::SeqCst)) }
        fn limits(&self) -> Vec<u64> { self.limits.lock().unwrap().clone() }
    }
    impl Http for FakeHttp {
        fn token(&self, _form: &[(&str,&str)]) -> Result<HttpReply,()> { self.token_calls.fetch_add(1,Ordering::SeqCst); self.tokens.lock().unwrap().pop_front().unwrap_or(Err(())) }
        fn api(&self, _method:&str, _path:&str, _bearer:&str, _payload:Option<&Value>, limit:u64) -> Result<HttpReply,()> { self.api_calls.fetch_add(1,Ordering::SeqCst); self.limits.lock().unwrap().push(limit); match self.apis.lock().unwrap().pop_front().unwrap_or(Err(())) { Ok(reply) if reply.body.len() as u64 > limit => Err(()), answer => answer } }
    }
    fn hr(status:u16, body:&str) -> Result<HttpReply,()> { Ok(HttpReply{status,retry_after:None,body:body.as_bytes().to_vec()}) }
    fn token_ok(refresh: Option<&str>) -> Result<HttpReply,()> { hr(200, &format!(r#"{{"access_token":"access","expires_in":3600{}}}"#, refresh.map(|r| format!(r#", "refresh_token":"{r}""#)).unwrap_or_default())) }
    fn reset_state() { *token().lock().unwrap()=None; *not_before().lock().unwrap()=None; *profile_cache().lock().unwrap()=None; CANCEL_SIGN_IN.store(false,Ordering::SeqCst); SIGNING_IN.store(false,Ordering::SeqCst); }
    fn cfg() -> Config { Config { client_id:"a".repeat(32),redirect_port:8898 } }

    #[test]
    fn seam_pins_refresh_throttle_retry_write_and_cancel_behaviour() {
        let _test_guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset_state();
        let creds=FakeCreds::new(Some("old")); let refused=FakeHttp::new(vec![hr(400,r#"{"error":"invalid_grant"}"#)],vec![]);
        assert_eq!(access_with(&cfg(),true,&refused,&creds),Err(SIGN_AGAIN.into())); assert_eq!(creds.value(),None); assert!(token().lock().unwrap().is_none());

        reset_state(); let creds=FakeCreds::new(Some("old")); let down=FakeHttp::new(vec![Err(())],vec![]);
        assert_eq!(access_with(&cfg(),true,&down,&creds),Err("down".into())); assert_eq!(creds.value().as_deref(),Some("old"));

        reset_state(); let creds=FakeCreds::new(Some("old")); let rotate=FakeHttp::new(vec![token_ok(Some("new"))],vec![]);
        assert_eq!(access_with(&cfg(),true,&rotate,&creds).unwrap(),"access"); assert_eq!(creds.value().as_deref(),Some("new"));

        reset_state(); let creds=FakeCreds::new(Some("old")); let throttle=FakeHttp::new(vec![Ok(HttpReply{status:429,retry_after:Some(90),body:vec![]}),token_ok(None)],vec![]);
        assert_eq!(access_with(&cfg(),true,&throttle,&creds),Err(BUSY.into())); assert_eq!(throttle.counts().0,1); assert!(not_before().lock().unwrap().unwrap()>Instant::now());
        assert_eq!(access_with(&cfg(),true,&throttle,&creds),Err(BUSY.into())); assert_eq!(throttle.counts().0,1); *not_before().lock().unwrap()=Some(Instant::now()-Duration::from_secs(1)); assert!(access_with(&cfg(),true,&throttle,&creds).is_ok());

        reset_state(); let creds=FakeCreds::new(Some("old")); *token().lock().unwrap()=Some(Token{access:"ok".into(),expires:Instant::now()+Duration::from_secs(3600)}); let api_throttle=FakeHttp::new(vec![],vec![Ok(HttpReply{status:429,retry_after:Some(70),body:vec![]}),hr(200,"{}")]);
        assert_eq!(get_json_with(&cfg(),"/x",&api_throttle,&creds),Err(BUSY.into())); assert_eq!(api_throttle.counts().1,1); assert_eq!(get_json_with(&cfg(),"/x",&api_throttle,&creds),Err(BUSY.into())); assert_eq!(api_throttle.counts().1,1); *not_before().lock().unwrap()=Some(Instant::now()-Duration::from_secs(1)); assert!(get_json_with(&cfg(),"/x",&api_throttle,&creds).is_ok());

        reset_state(); let creds=FakeCreds::new(Some("old")); *token().lock().unwrap()=Some(Token{access:"stale".into(),expires:Instant::now()+Duration::from_secs(3600)}); let read=FakeHttp::new(vec![token_ok(None)],vec![hr(401,""),hr(200,"{}")]);
        assert!(get_json_with(&cfg(),"/x",&read,&creds).is_ok()); assert_eq!(read.counts(),(1,2));
        reset_state(); let creds=FakeCreds::new(Some("old")); *token().lock().unwrap()=Some(Token{access:"stale".into(),expires:Instant::now()+Duration::from_secs(3600)}); let twice=FakeHttp::new(vec![token_ok(None)],vec![hr(401,""),hr(401,"")]);
        assert_eq!(get_json_with(&cfg(),"/x",&twice,&creds),Err(SIGN_AGAIN.into())); assert_eq!(twice.counts(),(1,2));

        reset_state(); let creds=FakeCreds::new(Some("old")); *token().lock().unwrap()=Some(Token{access:"stale".into(),expires:Instant::now()+Duration::from_secs(3600)}); let playback=FakeHttp::new(vec![token_ok(None)],vec![hr(401,""),hr(200,"{}")]); assert!(get_playback_with(&cfg(),&playback,&creds).is_ok()); assert_eq!(playback.counts(),(1,2));
        reset_state(); let creds=FakeCreds::new(Some("old")); *token().lock().unwrap()=Some(Token{access:"stale".into(),expires:Instant::now()+Duration::from_secs(3600)}); let playback_twice=FakeHttp::new(vec![token_ok(None)],vec![hr(401,""),hr(401,"")]); assert_eq!(get_playback_with(&cfg(),&playback_twice,&creds),Err(SIGN_AGAIN.into())); assert_eq!(playback_twice.counts(),(1,2));
        reset_state(); let creds=FakeCreds::new(Some("old")); *token().lock().unwrap()=Some(Token{access:"ok".into(),expires:Instant::now()+Duration::from_secs(3600)}); let playback_busy=FakeHttp::new(vec![],vec![Ok(HttpReply{status:429,retry_after:Some(90),body:vec![]})]); assert_eq!(get_playback_with(&cfg(),&playback_busy,&creds),Err(BUSY.into())); assert_eq!(playback_busy.counts().1,1); assert!(not_before().lock().unwrap().unwrap()>Instant::now());

        reset_state(); let creds=FakeCreds::new(Some("old")); *token().lock().unwrap()=Some(Token{access:"stale".into(),expires:Instant::now()+Duration::from_secs(3600)}); let write=FakeHttp::new(vec![token_ok(None)],vec![hr(401,"")]);
        assert_eq!(put_with(&cfg(),"/x",None,&write,&creds),Err(BUSY.into())); assert_eq!(write.counts(),(1,1));
        for status in [404u16] { reset_state(); let creds=FakeCreds::new(Some("old")); *token().lock().unwrap()=Some(Token{access:"ok".into(),expires:Instant::now()+Duration::from_secs(3600)}); let http=FakeHttp::new(vec![],vec![hr(status,"")]); assert_eq!(put_with(&cfg(),"/x",None,&http,&creds),Err(NO_DEVICE.into())); }

        reset_state(); assert!(begin_sign_in().is_ok()); assert_eq!(begin_sign_in(),Err(BUSY.into())); CANCEL_SIGN_IN.store(true,Ordering::SeqCst); let creds=FakeCreds::new(None); assert_eq!(save_sign_in(&creds,"new","access".into(),3600),Err("cancelled".into())); assert_eq!(creds.value(),None); SIGNING_IN.store(false,Ordering::SeqCst);

        reset_state(); let creds=Arc::new(FakeCreds::new(Some("old"))); let replaced=ReplacingRefusedHttp(creds.clone());
        assert_eq!(access_with(&cfg(),true,&replaced,&*creds),Err(SIGN_AGAIN.into())); assert_eq!(creds.value().as_deref(),Some("newer"));

        reset_state(); let creds=FakeCreds::new(Some("old")); *token().lock().unwrap()=Some(Token{access:"ok".into(),expires:Instant::now()+Duration::from_secs(3600)}); let no_devices=FakeHttp::new(vec![],vec![hr(200,r#"{"devices":[]}"#)]); assert_eq!(shuffle_with(&cfg(),true,&no_devices,&creds,None),Err(NO_DEVICE.into())); assert_eq!(no_devices.counts().1,1);
        reset_state(); let creds=FakeCreds::new(Some("old")); let other4xx=FakeHttp::new(vec![hr(403,r#"{"error":"forbidden"}"#)],vec![]); assert_eq!(access_with(&cfg(),true,&other4xx,&creds),Err("down".into())); assert_eq!(creds.value().as_deref(),Some("old"));
        reset_state(); let creds=FakeCreds::new(Some("old")); let refused401=FakeHttp::new(vec![hr(401,"")],vec![]); assert_eq!(access_with(&cfg(),true,&refused401,&creds),Err(SIGN_AGAIN.into())); assert_eq!(creds.value(),None);
        reset_state(); let creds=FakeCreds::new(Some("old")); let other400=FakeHttp::new(vec![hr(400,r#"{"error":"invalid_client"}"#)],vec![]); assert_eq!(access_with(&cfg(),true,&other400,&creds),Err("down".into())); assert_eq!(creds.value().as_deref(),Some("old"));
    }

    #[test]
    fn profile_is_cached_until_account_changes() {
        let _test_guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner()); reset_state();
        *token().lock().unwrap()=Some(Token{access:"ok".into(),expires:Instant::now()+Duration::from_secs(3600)});
        let creds=FakeCreds::new(Some("old")); let http=FakeHttp::new(vec![],vec![hr(200,r#"{"id":"me","display_name":"Owner"}"#)]);
        let first=profile_with(&cfg(),&http,&creds).unwrap(); let second=profile_with(&cfg(),&http,&creds).unwrap();
        assert_eq!(first,second); assert_eq!(first.display_name.as_deref(),Some("Owner")); assert_eq!(http.counts().1,1);
        assert!(save_sign_in(&creds,"new","access".into(),3600).is_ok()); assert!(profile_cache().lock().unwrap().is_none());
        *profile_cache().lock().unwrap()=Some(first);
        sign_out_with(&creds); assert!(profile_cache().lock().unwrap().is_none());
    }

    struct ReplacingRefusedHttp(Arc<FakeCreds>);
    impl Http for ReplacingRefusedHttp {
        fn token(&self,_:&[(&str,&str)])->Result<HttpReply,()>{ assert!(self.0.save("newer")); hr(400,r#"{"error":"invalid_grant"}"#) }
        fn api(&self,_:&str,_:&str,_:&str,_:Option<&Value>,_:u64)->Result<HttpReply,()>{ Err(()) }
    }

    struct BlockingHttp { entered: (Mutex<bool>,Condvar), released: (Mutex<bool>,Condvar), calls: std::sync::atomic::AtomicUsize }
    impl BlockingHttp { fn new()->Self{Self{entered:(Mutex::new(false),Condvar::new()),released:(Mutex::new(false),Condvar::new()),calls:0.into()}} fn wait_entered(&self){let(v,cv)=(&self.entered.0,&self.entered.1);let mut g=v.lock().unwrap();while !*g{g=cv.wait(g).unwrap();}} fn release(&self){*self.released.0.lock().unwrap()=true;self.released.1.notify_all();} }
    impl Http for BlockingHttp { fn token(&self,_:&[(&str,&str)])->Result<HttpReply,()>{Err(())} fn api(&self,_:&str,_:&str,_:&str,_:Option<&Value>,_:u64)->Result<HttpReply,()>{self.calls.fetch_add(1,Ordering::SeqCst);*self.entered.0.lock().unwrap()=true;self.entered.1.notify_all();let mut g=self.released.0.lock().unwrap();while !*g{g=self.released.1.wait(g).unwrap();}hr(204,"")} }

    #[test]
    fn concurrent_play_and_transfer_writes_send_once() {
        let _test_guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        for path in ["/me/player/play?device_id=x","/me/player"] {
            reset_state(); *token().lock().unwrap()=Some(Token{access:"ok".into(),expires:Instant::now()+Duration::from_secs(3600)}); let http=Arc::new(BlockingHttp::new()); let creds=Arc::new(FakeCreds::new(Some("old")));
            std::thread::scope(|scope| { let h=http.clone(); let c=creds.clone(); let first=scope.spawn(move||put_with(&cfg(),path,None,&*h,&*c)); http.wait_entered(); assert_eq!(put_with(&cfg(),path,None,&*http,&*creds),Err(BUSY.into())); assert_eq!(http.calls.load(Ordering::SeqCst),1); http.release(); assert_eq!(first.join().unwrap(),Ok(())); });
        }
    }

    struct BlockingRefreshHttp { entered: (Mutex<bool>,Condvar), released: (Mutex<bool>,Condvar) }
    impl BlockingRefreshHttp { fn new()->Self{Self{entered:(Mutex::new(false),Condvar::new()),released:(Mutex::new(false),Condvar::new())}} fn wait_entered(&self){let(v,cv)=(&self.entered.0,&self.entered.1);let mut g=v.lock().unwrap();while !*g{g=cv.wait(g).unwrap();}} fn release(&self){*self.released.0.lock().unwrap()=true;self.released.1.notify_all();} }
    impl Http for BlockingRefreshHttp {
        fn token(&self,_:&[(&str,&str)])->Result<HttpReply,()>{*self.entered.0.lock().unwrap()=true;self.entered.1.notify_all();let mut g=self.released.0.lock().unwrap();while !*g{g=self.released.1.wait(g).unwrap();}token_ok(Some("rotated"))}
        fn api(&self,_:&str,_:&str,_:&str,_:Option<&Value>,_:u64)->Result<HttpReply,()>{Err(())}
    }

    #[test]
    fn sign_out_waits_for_refresh_then_clears_store_and_cache() {
        let _test_guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset_state();
        let http=Arc::new(BlockingRefreshHttp::new()); let creds=Arc::new(FakeCreds::new(Some("old")));
        std::thread::scope(|scope| {
            let h=http.clone(); let c=creds.clone(); let refreshing=scope.spawn(move||access_with(&cfg(),true,&*h,&*c));
            http.wait_entered();
            let (done_tx,done_rx)=std::sync::mpsc::channel(); let c=creds.clone(); let signing_out=scope.spawn(move||{sign_out_with(&*c);done_tx.send(()).unwrap();});
            assert_eq!(done_rx.recv_timeout(Duration::from_millis(50)),Err(std::sync::mpsc::RecvTimeoutError::Timeout)); http.release(); assert_eq!(refreshing.join().unwrap(),Ok("access".into())); signing_out.join().unwrap();
        });
        assert_eq!(creds.value(),None); assert!(token().lock().unwrap().is_none());
    }

    #[test]
    fn cancelling_sign_in_ends_callback_wait_promptly() {
        let _test_guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset_state();
        let server=tiny_http::Server::http("127.0.0.1:0").unwrap(); let started=Instant::now();
        std::thread::scope(|scope| {
            let waiting=scope.spawn(||crate::wall2_oauth::wait_for_callback_cancelled(&server,CALLBACK,"state",Duration::from_secs(5),||CANCEL_SIGN_IN.load(Ordering::SeqCst)));
            std::thread::sleep(Duration::from_millis(25)); CANCEL_SIGN_IN.store(true,Ordering::SeqCst);
            assert_eq!(waiting.join().unwrap(),Err("cancelled"));
        });
        assert!(started.elapsed()<Duration::from_secs(1));
    }
}
