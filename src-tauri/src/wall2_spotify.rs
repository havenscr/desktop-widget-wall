//! Spotify Web API for Wall 2. Secrets stay in Credential Manager and upstream text is bounded.

use crate::wall2_meet::store::{BlobStore, CredBlobs, Fetch, CHUNK, MAX_CHUNKS};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

const NOT_SETUP: &str = "not set up";
const SIGN_AGAIN: &str = "sign in again";
const BUSY: &str = "busy";
const NO_DEVICE: &str = "no device";
const CALLBACK: &str = "/callback";
const SCOPE: &str = "user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative user-library-read user-read-recently-played";
const MAX_BODY: u64 = 1_000_000;
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
    fn api(&self, method: &str, path: &str, bearer: &str, payload: Option<&Value>) -> Result<HttpReply, ()>;
}

struct RealHttp;
impl Http for RealHttp {
    fn token(&self, form: &[(&str, &str)]) -> Result<HttpReply, ()> {
        http_reply(agent().post("https://accounts.spotify.com/api/token").send_form(form))
    }
    fn api(&self, method: &str, path: &str, bearer: &str, payload: Option<&Value>) -> Result<HttpReply, ()> {
        let url = format!("https://api.spotify.com/v1{path}");
        let request = match method { "GET" => agent().get(&url), "PUT" => agent().put(&url), _ => return Err(()) }.set("Authorization", &format!("Bearer {bearer}"));
        let result = match payload { Some(value) => request.set("Content-Type", "application/json").send_string(&value.to_string()), None => request.call() };
        http_reply(result)
    }
}

fn http_reply(result: Result<ureq::Response, ureq::Error>) -> Result<HttpReply, ()> {
    let response = match result { Ok(r) | Err(ureq::Error::Status(_, r)) => r, Err(_) => return Err(()) };
    let status = response.status();
    let retry_after = response.header("Retry-After").and_then(|v| v.parse::<u64>().ok());
    let bytes = body(response).map_err(|_| ())?;
    Ok(HttpReply { status, retry_after, body: bytes })
}

struct Token { access: String, expires: Instant }
static TOKEN: OnceLock<Mutex<Option<Token>>> = OnceLock::new();
fn token() -> &'static Mutex<Option<Token>> { TOKEN.get_or_init(|| Mutex::new(None)) }
static REFRESH: OnceLock<Mutex<()>> = OnceLock::new();
fn refresh_lock() -> &'static Mutex<()> { REFRESH.get_or_init(|| Mutex::new(())) }
static NOT_BEFORE: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();
fn not_before() -> &'static Mutex<Option<Instant>> { NOT_BEFORE.get_or_init(|| Mutex::new(None)) }

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

fn body(resp: ureq::Response) -> Result<Vec<u8>, &'static str> {
    let mut out = Vec::new();
    resp.into_reader().take(MAX_BODY + 1).read_to_end(&mut out).map_err(|_| "down")?;
    if out.len() as u64 > MAX_BODY { Err("down") } else { Ok(out) }
}

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
    tauri::Url::parse(s).ok().is_some_and(|u| u.scheme() == "https" && u.port().is_none() && u.username().is_empty() && u.password().is_none() && matches!(u.host_str(), Some("i.scdn.co" | "mosaic.scdn.co" | "image-cdn-ak.spotifycdn.com")))
}
fn image(v: &Value) -> Option<String> { v.as_array()?.iter().find_map(|x| x.get("url").and_then(Value::as_str).filter(|u| valid_image(u)).map(str::to_string)) }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item { pub id: String, pub name: String, pub kind: String, pub image_url: Option<String> }

fn shape_item(v: &Value, kind: &str) -> Option<Item> {
    let id = v.get("id")?.as_str()?;
    if !valid_id(id) { return None }
    let images = if kind == "track" { v.get("album").and_then(|a| a.get("images")).unwrap_or(&Value::Null) } else { v.get("images").unwrap_or(&Value::Null) };
    Some(Item { id: id.into(), name: clean(v.get("name"), 160)?, kind: kind.into(), image_url: image(images) })
}

fn shape_list(v: &Value, kind: &str) -> Vec<Item> {
    v.get("items").and_then(Value::as_array).into_iter().flatten().take(PAGE_SIZE).filter_map(|x| {
        let candidate = if kind == "album" { x.get("album").unwrap_or(x) } else if kind == "track" { x.get("track").unwrap_or(x) } else { x };
        shape_item(candidate, kind)
    }).collect()
}

fn get_json_with(cfg: &Config, path: &str, http: &dyn Http, creds: &dyn Creds) -> Result<Value, String> {
    check_backoff()?;
    let started = Instant::now();
    for attempt in 0..2 {
        let bearer = access_with(cfg, attempt == 1, http, creds)?;
        match http.api("GET", path, &bearer, None) {
            Ok(resp) if (200..300).contains(&resp.status) => return serde_json::from_slice(&resp.body).map_err(|_| "down".into()),
            Ok(resp) if resp.status == 401 && attempt == 0 => { crate::wall2_spotify_log::write(crate::wall2_spotify_log::Event::ApiFailed, crate::wall2_spotify_log::Reason::SignInAgain, 401, started.elapsed().as_millis()); continue },
            Ok(resp) if resp.status == 401 => return Err(SIGN_AGAIN.into()),
            Ok(resp) if resp.status == 429 => { back_off_for(retry_after(resp.retry_after)); crate::wall2_spotify_log::write(crate::wall2_spotify_log::Event::ApiFailed, crate::wall2_spotify_log::Reason::Busy, 429, started.elapsed().as_millis()); return Err(BUSY.into()) }
            Ok(resp) => { crate::wall2_spotify_log::write(crate::wall2_spotify_log::Event::ApiFailed, crate::wall2_spotify_log::Reason::Down, resp.status, started.elapsed().as_millis()); return Err("down".into()) }
            Err(_) => { crate::wall2_spotify_log::write(crate::wall2_spotify_log::Event::ApiFailed, crate::wall2_spotify_log::Reason::Down, 0, started.elapsed().as_millis()); return Err("down".into()) },
        }
    }
    Err(SIGN_AGAIN.into())
}

fn get_json(cfg: &Config, path: &str) -> Result<Value, String> { get_json_with(cfg, path, &RealHttp, &RealCreds) }

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
    Ok(())
}
fn sign_out_with(creds: &dyn Creds) {
    CANCEL_SIGN_IN.store(true, Ordering::SeqCst);
    let _refresh_guard = refresh_lock().lock().unwrap();
    creds.delete();
    *token().lock().unwrap() = None;
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

fn list(window: &WebviewWindow, endpoint: &str, kind: &str) -> Result<Vec<Item>, String> { let cfg = config(window.app_handle())?; Ok(shape_list(&get_json(&cfg, endpoint)?, kind)) }

#[tauri::command] pub async fn wall2_spotify_playlists(window: WebviewWindow, page: Option<u32>) -> Result<Vec<Item>, String> { require(&window)?; tauri::async_runtime::spawn_blocking(move || list(&window, &format!("/me/playlists?limit=50&offset={}", page_path(page)), "playlist")).await.map_err(|_| "failed".to_string())? }
#[tauri::command] pub async fn wall2_spotify_albums(window: WebviewWindow, page: Option<u32>) -> Result<Vec<Item>, String> { require(&window)?; tauri::async_runtime::spawn_blocking(move || list(&window, &format!("/me/albums?limit=50&offset={}", page_path(page)), "album")).await.map_err(|_| "failed".to_string())? }
#[tauri::command] pub async fn wall2_spotify_liked(window: WebviewWindow, page: Option<u32>) -> Result<Vec<Item>, String> { require(&window)?; tauri::async_runtime::spawn_blocking(move || list(&window, &format!("/me/tracks?limit=50&offset={}", page_path(page)), "track")).await.map_err(|_| "failed".to_string())? }
#[tauri::command] pub async fn wall2_spotify_recent(window: WebviewWindow) -> Result<Vec<Item>, String> { require(&window)?; tauri::async_runtime::spawn_blocking(move || list(&window, "/me/player/recently-played?limit=50", "track")).await.map_err(|_| "failed".to_string())? }

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
    tauri::async_runtime::spawn_blocking(move || { let cfg = config(window.app_handle())?; let v = get_json(&cfg, &format!("/search?type=track,album,playlist&limit=20&q={}", urlencoding::encode(&query)))?; Ok(Search { tracks: shape_list(v.get("tracks").unwrap_or(&Value::Null), "track"), albums: shape_list(v.get("albums").unwrap_or(&Value::Null), "album"), playlists: shape_list(v.get("playlists").unwrap_or(&Value::Null), "playlist") }) }).await.map_err(|_| "failed".to_string())?
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Device { id: String, name: String, kind: String, active: bool, volume: Option<u8> }
fn shape_devices(v: &Value) -> Vec<Device> {
    v.get("devices").and_then(Value::as_array).into_iter().flatten().take(50).filter_map(|d| {
        let id = d.get("id")?.as_str()?; if !valid_device_id(id) { return None }
        Some(Device { id: id.into(), name: clean(d.get("name"), 100)?, kind: clean(d.get("type"), 40).unwrap_or_else(|| "unknown".into()), active: d.get("is_active").and_then(Value::as_bool).unwrap_or(false), volume: d.get("volume_percent").and_then(Value::as_u64).filter(|n| *n <= 100).map(|n| n as u8) })
    }).collect()
}
#[tauri::command] pub async fn wall2_spotify_devices(window: WebviewWindow) -> Result<Vec<Device>, String> { require(&window)?; tauri::async_runtime::spawn_blocking(move || { let cfg = config(window.app_handle())?; Ok(shape_devices(&get_json(&cfg, "/me/player/devices")?)) }).await.map_err(|_| "failed".to_string())? }

fn choose_device(devices: &[Device], requested: Option<&str>, computer: Option<&str>) -> Option<String> {
    if let Some(id) = requested { return devices.iter().find(|d| d.id == id).map(|d| d.id.clone()) }
    devices.iter().find(|d| d.active).or_else(|| computer.and_then(|n| devices.iter().find(|d| d.name.eq_ignore_ascii_case(n)))).map(|d| d.id.clone())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayRequest { kind: String, id: String, device_id: Option<String> }
static WRITE: OnceLock<Mutex<()>> = OnceLock::new();
fn write_lock() -> &'static Mutex<()> { WRITE.get_or_init(|| Mutex::new(())) }
fn begin_write() -> Result<std::sync::MutexGuard<'static, ()>, String> { write_lock().try_lock().map_err(|_| BUSY.to_string()) }

fn put_with(cfg: &Config, path: &str, payload: Option<Value>, http: &dyn Http, creds: &dyn Creds) -> Result<(), String> {
    let _guard = begin_write()?;
    check_backoff()?;
    let bearer = access_with(cfg, false, http, creds)?;
    let started = Instant::now();
    match http.api("PUT", path, &bearer, payload.as_ref()) {
        Ok(resp) if (200..300).contains(&resp.status) => Ok(()),
        Ok(resp) if resp.status == 404 => { crate::wall2_spotify_log::write(crate::wall2_spotify_log::Event::ApiFailed, crate::wall2_spotify_log::Reason::NoDevice, 404, started.elapsed().as_millis()); Err(NO_DEVICE.into()) },
        Ok(resp) if resp.status == 429 => { back_off_for(retry_after(resp.retry_after)); crate::wall2_spotify_log::write(crate::wall2_spotify_log::Event::ApiFailed, crate::wall2_spotify_log::Reason::Busy, 429, started.elapsed().as_millis()); Err(BUSY.into()) }
        Ok(resp) if resp.status == 401 => { access_with(cfg, true, http, creds).map(|_| ())?; Err(BUSY.into()) }
        Ok(resp) => { crate::wall2_spotify_log::write(crate::wall2_spotify_log::Event::ApiFailed, crate::wall2_spotify_log::Reason::Down, resp.status, started.elapsed().as_millis()); Err("down".into()) }
        Err(_) => { crate::wall2_spotify_log::write(crate::wall2_spotify_log::Event::ApiFailed, crate::wall2_spotify_log::Reason::Down, 0, started.elapsed().as_millis()); Err("down".into()) },
    }
}
fn put(cfg: &Config, path: &str, payload: Option<Value>) -> Result<(), String> { put_with(cfg, path, payload, &RealHttp, &RealCreds) }

#[tauri::command]
pub async fn wall2_spotify_play(window: WebviewWindow, request: PlayRequest) -> Result<(), String> {
    require(&window)?; if !valid_id(&request.id) || !matches!(request.kind.as_str(), "track" | "album" | "playlist") { return Err("invalid id".into()) } if request.device_id.as_deref().is_some_and(|id| !valid_device_id(id)) { return Err("invalid id".into()) }
    tauri::async_runtime::spawn_blocking(move || { let cfg = config(window.app_handle())?; let devices = shape_devices(&get_json(&cfg, "/me/player/devices")?); let computer = std::env::var("COMPUTERNAME").ok(); let device = choose_device(&devices, request.device_id.as_deref(), computer.as_deref()).ok_or_else(|| NO_DEVICE.to_string())?; let uri = format!("spotify:{}:{}", request.kind, request.id); let payload = if request.kind == "track" { json!({"uris":[uri]}) } else { json!({"context_uri":uri}) }; put(&cfg, &format!("/me/player/play?device_id={device}"), Some(payload)) }).await.map_err(|_| "failed".to_string())?
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
        for root in [json!({"items":[track.clone()]}), json!({"items":[{"track":track.clone()}]})] { let got = shape_list(&root, "track"); assert_eq!(got[0].image_url.as_deref(), Some(COVER)); assert_eq!(got[0].name, "helloworld"); }
        let huge = json!({"items":(0..1000).map(|_| json!({"id":ID,"name":"ok","images":null})).collect::<Vec<_>>()});
        assert_eq!(shape_list(&huge, "album").len(), 50);
        for hostile in [Value::Null, json!({"items":null}), json!({"items":[null, 3, {"id":ID,"name":"\n"}]})] { assert!(shape_list(&hostile, "playlist").is_empty()); }
    }

    #[test]
    fn device_shaper_and_choice_cover_every_branch() {
        let shaped = shape_devices(&json!({"devices":[{"id":DEVICE,"name":"Desk","type":"Computer","is_active":false,"volume_percent":44}, null, {"id":"bad id","name":"Bad"}]}));
        assert_eq!(shaped.len(), 1); assert_eq!(shaped[0].volume, Some(44));
        let other = "abcdef0123456789abcdef0123456789abcdef01";
        let d = |id:&str,name:&str,active| Device{id:id.into(),name:name.into(),kind:"computer".into(),active,volume:None};
        let active = vec![d(DEVICE,"Desk",false),d(other,"Other",true)];
        assert_eq!(choose_device(&active,None,Some("Desk")).as_deref(),Some(other));
        assert_eq!(choose_device(&active,Some(DEVICE),None).as_deref(),Some(DEVICE));
        let named = vec![d(DEVICE,"Desk",false)]; assert_eq!(choose_device(&named,None,Some("desk")).as_deref(),Some(DEVICE));
        assert_eq!(choose_device(&named,None,Some("Missing")),None); assert_eq!(choose_device(&[],None,None),None);
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
    struct FakeHttp { tokens: Mutex<VecDeque<Result<HttpReply, ()>>>, apis: Mutex<VecDeque<Result<HttpReply, ()>>>, token_calls: std::sync::atomic::AtomicUsize, api_calls: std::sync::atomic::AtomicUsize }
    impl FakeHttp {
        fn new(tokens: Vec<Result<HttpReply,()>>, apis: Vec<Result<HttpReply,()>>) -> Self { Self { tokens: Mutex::new(tokens.into()), apis: Mutex::new(apis.into()), token_calls: 0.into(), api_calls: 0.into() } }
        fn counts(&self) -> (usize,usize) { (self.token_calls.load(Ordering::SeqCst), self.api_calls.load(Ordering::SeqCst)) }
    }
    impl Http for FakeHttp {
        fn token(&self, _form: &[(&str,&str)]) -> Result<HttpReply,()> { self.token_calls.fetch_add(1,Ordering::SeqCst); self.tokens.lock().unwrap().pop_front().unwrap_or(Err(())) }
        fn api(&self, _method:&str, _path:&str, _bearer:&str, _payload:Option<&Value>) -> Result<HttpReply,()> { self.api_calls.fetch_add(1,Ordering::SeqCst); self.apis.lock().unwrap().pop_front().unwrap_or(Err(())) }
    }
    fn hr(status:u16, body:&str) -> Result<HttpReply,()> { Ok(HttpReply{status,retry_after:None,body:body.as_bytes().to_vec()}) }
    fn token_ok(refresh: Option<&str>) -> Result<HttpReply,()> { hr(200, &format!(r#"{{"access_token":"access","expires_in":3600{}}}"#, refresh.map(|r| format!(r#", "refresh_token":"{r}""#)).unwrap_or_default())) }
    fn reset_state() { *token().lock().unwrap()=None; *not_before().lock().unwrap()=None; CANCEL_SIGN_IN.store(false,Ordering::SeqCst); SIGNING_IN.store(false,Ordering::SeqCst); }
    fn cfg() -> Config { Config { client_id:"a".repeat(32),redirect_port:8898 } }

    #[test]
    fn seam_pins_refresh_throttle_retry_write_and_cancel_behaviour() {
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

        reset_state(); let creds=FakeCreds::new(Some("old")); *token().lock().unwrap()=Some(Token{access:"stale".into(),expires:Instant::now()+Duration::from_secs(3600)}); let write=FakeHttp::new(vec![token_ok(None)],vec![hr(401,"")]);
        assert_eq!(put_with(&cfg(),"/x",None,&write,&creds),Err(BUSY.into())); assert_eq!(write.counts(),(1,1));
        for status in [404u16] { reset_state(); let creds=FakeCreds::new(Some("old")); *token().lock().unwrap()=Some(Token{access:"ok".into(),expires:Instant::now()+Duration::from_secs(3600)}); let http=FakeHttp::new(vec![],vec![hr(status,"")]); assert_eq!(put_with(&cfg(),"/x",None,&http,&creds),Err(NO_DEVICE.into())); }

        reset_state(); assert!(begin_sign_in().is_ok()); assert_eq!(begin_sign_in(),Err(BUSY.into())); CANCEL_SIGN_IN.store(true,Ordering::SeqCst); let creds=FakeCreds::new(None); assert_eq!(save_sign_in(&creds,"new","access".into(),3600),Err("cancelled".into())); assert_eq!(creds.value(),None); SIGNING_IN.store(false,Ordering::SeqCst);

        let creds=FakeCreds::new(Some("newer")); creds.delete_if_equal("old"); assert_eq!(creds.value().as_deref(),Some("newer"));

        reset_state(); let creds=FakeCreds::new(Some("old")); *token().lock().unwrap()=Some(Token{access:"ok".into(),expires:Instant::now()+Duration::from_secs(3600)}); let no_devices=FakeHttp::new(vec![],vec![hr(200,r#"{"devices":[]}"#)]); assert_eq!(shuffle_with(&cfg(),true,&no_devices,&creds,None),Err(NO_DEVICE.into())); assert_eq!(no_devices.counts().1,1);
        reset_state(); let creds=FakeCreds::new(Some("old")); let other4xx=FakeHttp::new(vec![hr(403,r#"{"error":"forbidden"}"#)],vec![]); assert_eq!(access_with(&cfg(),true,&other4xx,&creds),Err("down".into())); assert_eq!(creds.value().as_deref(),Some("old"));
    }

    struct BlockingHttp { entered: (Mutex<bool>,Condvar), released: (Mutex<bool>,Condvar), calls: std::sync::atomic::AtomicUsize }
    impl BlockingHttp { fn new()->Self{Self{entered:(Mutex::new(false),Condvar::new()),released:(Mutex::new(false),Condvar::new()),calls:0.into()}} fn wait_entered(&self){let(v,cv)=(&self.entered.0,&self.entered.1);let mut g=v.lock().unwrap();while !*g{g=cv.wait(g).unwrap();}} fn release(&self){*self.released.0.lock().unwrap()=true;self.released.1.notify_all();} }
    impl Http for BlockingHttp { fn token(&self,_:&[(&str,&str)])->Result<HttpReply,()>{Err(())} fn api(&self,_:&str,_:&str,_:&str,_:Option<&Value>)->Result<HttpReply,()>{self.calls.fetch_add(1,Ordering::SeqCst);*self.entered.0.lock().unwrap()=true;self.entered.1.notify_all();let mut g=self.released.0.lock().unwrap();while !*g{g=self.released.1.wait(g).unwrap();}hr(204,"")} }

    #[test]
    fn concurrent_play_and_transfer_writes_send_once() {
        for path in ["/me/player/play?device_id=x","/me/player"] {
            reset_state(); *token().lock().unwrap()=Some(Token{access:"ok".into(),expires:Instant::now()+Duration::from_secs(3600)}); let http=Arc::new(BlockingHttp::new()); let creds=Arc::new(FakeCreds::new(Some("old")));
            std::thread::scope(|scope| { let h=http.clone(); let c=creds.clone(); let first=scope.spawn(move||put_with(&cfg(),path,None,&*h,&*c)); http.wait_entered(); assert_eq!(put_with(&cfg(),path,None,&*http,&*creds),Err(BUSY.into())); assert_eq!(http.calls.load(Ordering::SeqCst),1); http.release(); assert_eq!(first.join().unwrap(),Ok(())); });
        }
    }
}
