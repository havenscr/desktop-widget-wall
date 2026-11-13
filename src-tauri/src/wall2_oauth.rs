//! Shared OAuth pieces used by Wall 2 sign-in flows.

use std::time::{Duration, Instant};

pub fn b64url(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

pub fn random_b64(bytes: usize) -> Option<String> {
    use windows::Win32::Security::Cryptography::{BCryptGenRandom, BCRYPT_ALG_HANDLE, BCRYPT_USE_SYSTEM_PREFERRED_RNG};
    let mut buf = vec![0u8; bytes];
    if unsafe { BCryptGenRandom(BCRYPT_ALG_HANDLE::default(), &mut buf, BCRYPT_USE_SYSTEM_PREFERRED_RNG) }.is_ok() { Some(b64url(&buf)) } else { None }
}

pub fn challenge_for(verifier: &str) -> Option<String> {
    use windows::Win32::Security::Cryptography::{BCryptHash, BCRYPT_SHA256_ALG_HANDLE};
    let mut out = [0u8; 32];
    if unsafe { BCryptHash(BCRYPT_SHA256_ALG_HANDLE, None, verifier.as_bytes(), &mut out) }.is_ok() { Some(b64url(&out)) } else { None }
}

#[derive(Debug, PartialEq)]
pub enum Callback {
    Other,
    Code(String),
    Denied,
    Failed,
    BadState,
}

pub fn parse_callback(request_target: &str, callback_path: &str, expected_state: &str) -> Callback {
    let Ok(url) = tauri::Url::parse(&format!("http://127.0.0.1{request_target}")) else { return Callback::Other };
    if url.path() != callback_path { return Callback::Other }
    let pairs: Vec<_> = url.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
    let all = |name: &str| -> Vec<&str> { pairs.iter().filter(|(k, _)| k == name).map(|(_, v)| v.as_str()).collect() };
    let states = all("state");
    if states.len() != 1 || states[0] != expected_state { return Callback::BadState }
    let errors = all("error");
    if !errors.is_empty() { return if errors == ["access_denied"] { Callback::Denied } else { Callback::Failed } }
    let codes = all("code");
    if codes.len() != 1 || codes[0].is_empty() { Callback::Failed } else { Callback::Code(codes[0].to_string()) }
}

pub fn page(text: &str) -> String {
    format!("<!doctype html><meta charset=\"utf-8\"><title>Wall 2</title><body style=\"font-family:sans-serif;margin:3em\"><p>{text}</p></body>")
}

pub fn respond(request: tiny_http::Request, status: u16, body: String) {
    let mut response = tiny_http::Response::from_string(body).with_status_code(status);
    for (k, v) in [("Content-Type", "text/html; charset=utf-8"), ("Content-Security-Policy", "default-src 'none'"), ("Cache-Control", "no-store")] {
        if let Ok(h) = tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()) { response.add_header(h) }
    }
    let _ = request.respond(response);
}

pub fn wait_for_callback(server: &tiny_http::Server, path: &str, state: &str, wait: Duration) -> Result<String, &'static str> {
    let started = Instant::now();
    loop {
        if started.elapsed() >= wait { return Err("timed-out") }
        let request = match server.recv_timeout(Duration::from_millis(400)) {
            Ok(Some(r)) => r,
            Ok(None) => continue,
            Err(_) => return Err("failed"),
        };
        if request.method() != &tiny_http::Method::Get { respond(request, 404, "Not found".into()); continue }
        let target = request.url().to_string();
        match parse_callback(&target, path, state) {
            Callback::Other => respond(request, 404, "Not found".into()),
            Callback::BadState => respond(request, 400, "Bad request".into()),
            Callback::Code(code) => { respond(request, 200, page("Signed in. You can close this tab.")); return Ok(code) }
            Callback::Denied => { respond(request, 200, page("Sign-in did not finish. You can close this tab.")); return Err("denied") }
            Callback::Failed => { respond(request, 200, page("Sign-in did not finish. You can close this tab.")); return Err("failed") }
        }
    }
}

pub fn credential_target(service: &str, id: &str, n: usize) -> String {
    format!("WidgetWall2/{service}/{id}/{n}")
}
