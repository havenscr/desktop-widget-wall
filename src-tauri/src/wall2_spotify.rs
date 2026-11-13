//! Spotify Web API for Wall 2. Secrets stay in Credential Manager and upstream text is bounded.

use crate::wall2_meet::store::{BlobStore, CredBlobs, Fetch, CHUNK, MAX_CHUNKS};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::Read;
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
    let text = std::fs::read_to_string(dir.join("spotify.json")).ok();
    parse_config(text.as_deref()).map_err(str::to_string)
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

struct Token { access: String, expires: Instant }
static TOKEN: OnceLock<Mutex<Option<Token>>> = OnceLock::new();
fn token() -> &'static Mutex<Option<Token>> { TOKEN.get_or_init(|| Mutex::new(None)) }

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
enum TokenReply { Ok(String, u64, Option<String>), Refused, Busy, Down }

fn token_reply(result: Result<ureq::Response, ureq::Error>) -> TokenReply {
    match result {
        Ok(resp) if (200..300).contains(&resp.status()) => {
            let Ok(raw) = body(resp) else { return TokenReply::Down };
            let Ok(v) = serde_json::from_slice::<Value>(&raw) else { return TokenReply::Down };
            let Some(access) = v.get("access_token").and_then(Value::as_str) else { return TokenReply::Down };
            let expiry = v.get("expires_in").and_then(Value::as_u64).unwrap_or(3600).min(86400);
            let refresh = v.get("refresh_token").and_then(Value::as_str).map(str::to_string);
            TokenReply::Ok(access.to_string(), expiry, refresh)
        }
        Err(ureq::Error::Status(429, _)) => TokenReply::Busy,
        Err(ureq::Error::Status(code, _)) if (400..500).contains(&code) => TokenReply::Refused,
        _ => TokenReply::Down,
    }
}

fn exchange(cfg: &Config, code: &str, verifier: &str) -> TokenReply {
    let redirect = format!("http://127.0.0.1:{}{CALLBACK}", cfg.redirect_port);
    token_reply(agent().post("https://accounts.spotify.com/api/token").send_form(&[
        ("client_id", cfg.client_id.as_str()), ("grant_type", "authorization_code"), ("code", code),
        ("redirect_uri", redirect.as_str()), ("code_verifier", verifier),
    ]))
}

fn refresh(cfg: &Config, value: &str) -> TokenReply {
    token_reply(agent().post("https://accounts.spotify.com/api/token").send_form(&[
        ("client_id", cfg.client_id.as_str()), ("grant_type", "refresh_token"), ("refresh_token", value),
    ]))
}

fn access(cfg: &Config, force: bool) -> Result<String, String> {
    if !force {
        if let Some(t) = token().lock().unwrap().as_ref() {
            if t.expires > Instant::now() + Duration::from_secs(60) { return Ok(t.access.clone()) }
        }
    }
    let refresh_value = load_refresh().map_err(|_| SIGN_AGAIN.to_string())?.ok_or_else(|| SIGN_AGAIN.to_string())?;
    match refresh(cfg, &refresh_value) {
        TokenReply::Ok(access, seconds, replacement) => {
            if let Some(v) = replacement { if !save_refresh(&v) { return Err("failed".into()) } }
            *token().lock().unwrap() = Some(Token { access: access.clone(), expires: Instant::now() + Duration::from_secs(seconds) });
            Ok(access)
        }
        TokenReply::Refused => { delete_refresh(); *token().lock().unwrap() = None; Err(SIGN_AGAIN.into()) }
        TokenReply::Busy => Err(BUSY.into()),
        TokenReply::Down => Err("down".into()),
    }
}

fn clean(value: Option<&Value>, max: usize) -> Option<String> {
    let s: String = value?.as_str()?.chars().filter(|c| !c.is_control() && !matches!(*c, '\u{200b}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2060}'..='\u{206f}')).collect();
    let s: String = s.trim().chars().take(max).collect();
    (!s.is_empty()).then_some(s)
}

fn valid_id(s: &str) -> bool { s.len() == 22 && s.bytes().all(|b| b.is_ascii_alphanumeric()) }
fn valid_image(s: &str) -> bool {
    tauri::Url::parse(s).ok().is_some_and(|u| u.scheme() == "https" && matches!(u.host_str(), Some("i.scdn.co" | "mosaic.scdn.co" | "image-cdn-ak.spotifycdn.com")))
}
fn image(v: &Value) -> Option<String> { v.as_array()?.iter().find_map(|x| x.get("url").and_then(Value::as_str).filter(|u| valid_image(u)).map(str::to_string)) }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item { pub id: String, pub name: String, pub kind: String, pub image_url: Option<String> }

fn shape_item(v: &Value, kind: &str) -> Option<Item> {
    let id = v.get("id")?.as_str()?;
    if !valid_id(id) { return None }
    Some(Item { id: id.into(), name: clean(v.get("name"), 160)?, kind: kind.into(), image_url: image(v.get("images").unwrap_or(&Value::Null)) })
}

fn shape_list(v: &Value, kind: &str) -> Vec<Item> {
    v.get("items").and_then(Value::as_array).into_iter().flatten().take(PAGE_SIZE).filter_map(|x| {
        let candidate = if kind == "album" { x.get("album").unwrap_or(x) } else if kind == "track" { x.get("track").unwrap_or(x) } else { x };
        shape_item(candidate, kind)
    }).collect()
}

fn get_json(cfg: &Config, path: &str) -> Result<Value, String> {
    for attempt in 0..2 {
        let bearer = access(cfg, attempt == 1)?;
        match agent().get(&format!("https://api.spotify.com/v1{path}")).set("Authorization", &format!("Bearer {bearer}")).call() {
            Ok(resp) if (200..300).contains(&resp.status()) => return serde_json::from_slice(&body(resp).map_err(str::to_string)?).map_err(|_| "down".into()),
            Err(ureq::Error::Status(401, _)) if attempt == 0 => continue,
            Err(ureq::Error::Status(429, resp)) => { honor_retry(&resp); return Err(BUSY.into()) }
            _ => return Err("down".into()),
        }
    }
    Err(SIGN_AGAIN.into())
}

fn honor_retry(resp: &ureq::Response) {
    let seconds = resp.header("Retry-After").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0).min(60);
    if seconds > 0 { std::thread::sleep(Duration::from_secs(seconds)) }
}

fn page_path(page: Option<u32>) -> usize { (page.unwrap_or(0).min(100) as usize) * PAGE_SIZE }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status { setup: bool, signed_in: bool, reason: Option<String> }

#[tauri::command]
pub fn wall2_spotify_status(window: WebviewWindow) -> Result<Status, String> {
    require(&window)?;
    if config(window.app_handle()).is_err() { return Ok(Status { setup: false, signed_in: false, reason: Some(NOT_SETUP.into()) }) }
    match load_refresh() { Ok(Some(_)) => Ok(Status { setup: true, signed_in: true, reason: None }), Ok(None) => Ok(Status { setup: true, signed_in: false, reason: None }), Err(_) => Ok(Status { setup: true, signed_in: false, reason: Some("failed".into()) }) }
}

#[tauri::command]
pub async fn wall2_spotify_sign_in(window: WebviewWindow) -> Result<(), String> {
    require(&window)?;
    let cfg = config(window.app_handle())?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let verifier = crate::wall2_oauth::random_b64(32).ok_or_else(|| "failed".to_string())?;
        let state = crate::wall2_oauth::random_b64(16).ok_or_else(|| "failed".to_string())?;
        let challenge = crate::wall2_oauth::challenge_for(&verifier).ok_or_else(|| "failed".to_string())?;
        let server = tiny_http::Server::http(format!("127.0.0.1:{}", cfg.redirect_port)).map_err(|_| "port busy".to_string())?;
        app.opener().open_url(authorize_url(&cfg, &challenge, &state), None::<&str>).map_err(|_| "failed".to_string())?;
        let code = crate::wall2_oauth::wait_for_callback(&server, CALLBACK, &state, Duration::from_secs(180)).map_err(str::to_string)?;
        match exchange(&cfg, &code, &verifier) {
            TokenReply::Ok(access_value, seconds, Some(refresh_value)) if save_refresh(&refresh_value) => {
                *token().lock().unwrap() = Some(Token { access: access_value, expires: Instant::now() + Duration::from_secs(seconds) }); Ok(())
            }
            TokenReply::Busy => Err(BUSY.into()),
            _ => Err("failed".into()),
        }
    }).await.map_err(|_| "failed".to_string())?
}

#[tauri::command]
pub fn wall2_spotify_sign_out(window: WebviewWindow) -> Result<(), String> { require(&window)?; delete_refresh(); *token().lock().unwrap() = None; Ok(()) }

fn list(window: &WebviewWindow, endpoint: &str, kind: &str) -> Result<Vec<Item>, String> { let cfg = config(window.app_handle())?; Ok(shape_list(&get_json(&cfg, endpoint)?, kind)) }

#[tauri::command] pub fn wall2_spotify_playlists(window: WebviewWindow, page: Option<u32>) -> Result<Vec<Item>, String> { require(&window)?; list(&window, &format!("/me/playlists?limit=50&offset={}", page_path(page)), "playlist") }
#[tauri::command] pub fn wall2_spotify_albums(window: WebviewWindow, page: Option<u32>) -> Result<Vec<Item>, String> { require(&window)?; list(&window, &format!("/me/albums?limit=50&offset={}", page_path(page)), "album") }
#[tauri::command] pub fn wall2_spotify_liked(window: WebviewWindow, page: Option<u32>) -> Result<Vec<Item>, String> { require(&window)?; list(&window, &format!("/me/tracks?limit=50&offset={}", page_path(page)), "track") }
#[tauri::command] pub fn wall2_spotify_recent(window: WebviewWindow) -> Result<Vec<Item>, String> { require(&window)?; list(&window, "/me/player/recently-played?limit=50", "track") }

#[derive(Debug, Serialize)] pub struct Search { tracks: Vec<Item>, albums: Vec<Item>, playlists: Vec<Item> }
#[tauri::command]
pub fn wall2_spotify_search(window: WebviewWindow, query: String) -> Result<Search, String> {
    require(&window)?;
    let query: String = query.trim().chars().take(81).collect();
    if query.is_empty() || query.chars().count() > 80 || query.chars().any(char::is_control) { return Err("invalid query".into()) }
    let cfg = config(window.app_handle())?;
    let v = get_json(&cfg, &format!("/search?type=track,album,playlist&limit=20&q={}", urlencoding::encode(&query)))?;
    Ok(Search { tracks: shape_list(v.get("tracks").unwrap_or(&Value::Null), "track"), albums: shape_list(v.get("albums").unwrap_or(&Value::Null), "album"), playlists: shape_list(v.get("playlists").unwrap_or(&Value::Null), "playlist") })
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Device { id: String, name: String, kind: String, active: bool, volume: Option<u8> }
fn shape_devices(v: &Value) -> Vec<Device> {
    v.get("devices").and_then(Value::as_array).into_iter().flatten().take(50).filter_map(|d| {
        let id = d.get("id")?.as_str()?; if !valid_id(id) { return None }
        Some(Device { id: id.into(), name: clean(d.get("name"), 100)?, kind: clean(d.get("type"), 40).unwrap_or_else(|| "unknown".into()), active: d.get("is_active").and_then(Value::as_bool).unwrap_or(false), volume: d.get("volume_percent").and_then(Value::as_u64).filter(|n| *n <= 100).map(|n| n as u8) })
    }).collect()
}
#[tauri::command] pub fn wall2_spotify_devices(window: WebviewWindow) -> Result<Vec<Device>, String> { require(&window)?; let cfg = config(window.app_handle())?; Ok(shape_devices(&get_json(&cfg, "/me/player/devices")?)) }

fn choose_device(devices: &[Device], requested: Option<&str>, computer: Option<&str>) -> Option<String> {
    if let Some(id) = requested { return devices.iter().find(|d| d.id == id).map(|d| d.id.clone()) }
    devices.iter().find(|d| d.active).or_else(|| computer.and_then(|n| devices.iter().find(|d| d.name.eq_ignore_ascii_case(n)))).map(|d| d.id.clone())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayRequest { kind: String, id: String, device_id: Option<String> }
static WRITE: OnceLock<Mutex<()>> = OnceLock::new();
fn write_lock() -> &'static Mutex<()> { WRITE.get_or_init(|| Mutex::new(())) }

fn put(cfg: &Config, path: &str, payload: Value) -> Result<(), String> {
    let _guard = write_lock().lock().unwrap();
    let bearer = access(cfg, false)?;
    match agent().put(&format!("https://api.spotify.com/v1{path}")).set("Authorization", &format!("Bearer {bearer}")).set("Content-Type", "application/json").send_string(&payload.to_string()) {
        Ok(resp) if (200..300).contains(&resp.status()) => Ok(()),
        Err(ureq::Error::Status(429, resp)) => { honor_retry(&resp); Err(BUSY.into()) }
        Err(ureq::Error::Status(401, _)) => { let _ = access(cfg, true)?; Err(SIGN_AGAIN.into()) }
        _ => Err("down".into()),
    }
}

#[tauri::command]
pub fn wall2_spotify_play(window: WebviewWindow, request: PlayRequest) -> Result<(), String> {
    require(&window)?; if !valid_id(&request.id) || !matches!(request.kind.as_str(), "track" | "album" | "playlist") { return Err("invalid id".into()) }
    if request.device_id.as_deref().is_some_and(|id| !valid_id(id)) { return Err("invalid id".into()) }
    let cfg = config(window.app_handle())?;
    let devices = shape_devices(&get_json(&cfg, "/me/player/devices")?);
    let computer = std::env::var("COMPUTERNAME").ok();
    let device = choose_device(&devices, request.device_id.as_deref(), computer.as_deref()).ok_or_else(|| NO_DEVICE.to_string())?;
    let uri = format!("spotify:{}:{}", request.kind, request.id);
    let payload = if request.kind == "track" { json!({"uris":[uri]}) } else { json!({"context_uri":uri}) };
    put(&cfg, &format!("/me/player/play?device_id={device}"), payload)
}

#[tauri::command] pub fn wall2_spotify_transfer(window: WebviewWindow, device_id: String) -> Result<(), String> { require(&window)?; if !valid_id(&device_id) { return Err("invalid id".into()) } let cfg = config(window.app_handle())?; put(&cfg, "/me/player", json!({"device_ids":[device_id],"play":false})) }
#[tauri::command] pub fn wall2_spotify_shuffle(window: WebviewWindow, on: bool) -> Result<(), String> { require(&window)?; let cfg = config(window.app_handle())?; put(&cfg, &format!("/me/player/shuffle?state={on}"), Value::Null) }

pub fn start_log(dir: Option<std::path::PathBuf>) {
    let Some(dir) = dir else { return }; let _ = std::fs::create_dir_all(&dir); let _ = std::fs::File::create(dir.join("wall2-spotify.log"));
}

#[cfg(test)]
mod tests {
    use super::*;
    const ID: &str = "0123456789ABCDEFGHIJKL";
    #[test] fn config_rules() { assert_eq!(parse_config(Some(r#"{"clientId":"0123456789abcdef0123456789abcdef"}"#)).unwrap().redirect_port, 8898); assert!(parse_config(None).is_err()); assert!(parse_config(Some(r#"{"clientId":"bad"}"#)).is_err()); }
    #[test] fn url_and_redirect_are_exact() { let c = Config { client_id: "a".repeat(32), redirect_port: 8898 }; let u = authorize_url(&c, "challenge", "state"); assert!(u.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A8898%2Fcallback")); assert_eq!(crate::wall2_oauth::parse_callback("/callback?code=x&state=s", CALLBACK, "s"), crate::wall2_oauth::Callback::Code("x".into())); }
    #[test] fn ids_queries_and_images_are_strict() { assert!(valid_id(ID)); assert!(!valid_id("short")); assert!(valid_image("https://i.scdn.co/image/a")); assert!(!valid_image("https://example.com/a")); }
    #[test] fn hostile_items_are_bounded_and_cleaned() { let v = json!({"items":[{"id":ID,"name":"hello\nworld","images":[{"url":"https://bad.test/x"}]}, {"id":"bad","name":"x"}]}); let got = shape_list(&v, "playlist"); assert_eq!(got.len(), 1); assert_eq!(got[0].name, "helloworld"); assert_eq!(got[0].image_url, None); }
    #[test] fn device_choice_rule() { let d = |id:&str,name:&str,active| Device{id:id.into(),name:name.into(),kind:"computer".into(),active,volume:None}; let list=vec![d(ID,"Desk",false),d("ABCDEFGHIJKL0123456789","Other",true)]; assert_eq!(choose_device(&list,None,Some("Desk")).unwrap(),"ABCDEFGHIJKL0123456789"); assert_eq!(choose_device(&list,Some(ID),None).unwrap(),ID); }
    #[test] fn token_state_machine_shapes() { assert_eq!(token_reply(Err(ureq::Error::Status(429, ureq::Response::new(429,"busy","").unwrap()))), TokenReply::Busy); assert_eq!(token_reply(Err(ureq::Error::Status(400, ureq::Response::new(400,"bad","").unwrap()))), TokenReply::Refused); }
}
