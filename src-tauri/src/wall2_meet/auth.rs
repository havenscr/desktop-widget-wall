//! Sign-in (PKCE in the system browser, redirect caught on a loopback listener) and the
//! token endpoint client. Nothing here logs; every failure maps to a fixed string.

use super::reason::{token_reason, MAX_ERROR_BODY, TOKEN_NETWORK};
use super::{agent, read_body, read_capped, Account};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri_plugin_opener::OpenerExt;

pub const SCOPE: &str = "offline_access https://graph.microsoft.com/Calendars.Read";
const CALLBACK_PATH: &str = "/auth-callback.html";
const WAIT: Duration = Duration::from_secs(300);

static SIGNING_IN: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);

pub fn cancel_sign_in() {
    CANCEL.store(true, Ordering::SeqCst);
}

// Section: pure helpers

/// S256 code challenge for a verifier.
pub fn challenge_for(verifier: &str) -> Option<String> {
    crate::wall2_oauth::challenge_for(verifier)
}

pub fn authorize_url(tenant: &str, client_id: &str, redirect_uri: &str, challenge: &str, state: &str) -> String {
    use urlencoding::encode;
    format!(
        "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize?client_id={}&response_type=code&redirect_uri={}&response_mode=query&scope={}&code_challenge={}&code_challenge_method=S256&state={}&prompt=select_account",
        encode(client_id),
        encode(redirect_uri),
        encode(SCOPE),
        encode(challenge),
        encode(state),
    )
}

#[derive(Debug, PartialEq)]
pub enum Callback {
    /// Not the callback path: answer 404 and keep waiting.
    Other,
    Code(String),
    Denied,
    Failed,
    /// A wrong, missing or repeated `state`: not from our sign-in. Answer 400 and keep waiting.
    BadState,
}

/// Read the request target the browser was sent back to.
pub fn parse_callback(request_target: &str, expected_state: &str) -> Callback {
    match crate::wall2_oauth::parse_callback(request_target, CALLBACK_PATH, expected_state) {
        crate::wall2_oauth::Callback::Other => Callback::Other,
        crate::wall2_oauth::Callback::Code(v) => Callback::Code(v),
        crate::wall2_oauth::Callback::Denied => Callback::Denied,
        crate::wall2_oauth::Callback::Failed => Callback::Failed,
        crate::wall2_oauth::Callback::BadState => Callback::BadState,
    }
}

// Section: sign-in flow

struct Busy;
impl Drop for Busy {
    fn drop(&mut self) {
        SIGNING_IN.store(false, Ordering::SeqCst);
    }
}

/// What the browser round trip produced; redeemed by the caller.
pub struct Granted {
    pub code: String,
    pub verifier: String,
    pub redirect_uri: String,
}

/// Open the system browser and wait for the one callback. Blocks up to five minutes.
pub fn authorize(app: &tauri::AppHandle, account: &Account) -> Result<Granted, &'static str> {
    if SIGNING_IN.swap(true, Ordering::SeqCst) {
        return Err("busy");
    }
    let _busy = Busy;
    CANCEL.store(false, Ordering::SeqCst);

    let verifier = crate::wall2_oauth::random_b64(32).ok_or("failed")?;
    let state = crate::wall2_oauth::random_b64(16).ok_or("failed")?;
    let challenge = challenge_for(&verifier).ok_or("failed")?;

    let server = tiny_http::Server::http("127.0.0.1:0").map_err(|_| "failed")?;
    let port = server.server_addr().to_ip().ok_or("failed")?.port();
    let redirect_uri = format!("http://localhost:{port}{CALLBACK_PATH}");
    let url = authorize_url(&account.tenant, &account.client_id, &redirect_uri, &challenge, &state);
    app.opener().open_url(url, None::<&str>).map_err(|_| "failed")?;

    let code = wait_for_callback(&server, &state, WAIT)?;
    Ok(Granted { code, verifier, redirect_uri })
}

/// Serve the listener until the one valid callback arrives. Other paths get 404 and a callback
/// with a wrong or missing `state` gets 400; both keep waiting. Ends on the first valid
/// callback, an error answer, cancel, or the time limit.
fn wait_for_callback(server: &tiny_http::Server, state: &str, wait: Duration) -> Result<String, &'static str> {
    let started = Instant::now();
    loop {
        if CANCEL.load(Ordering::SeqCst) {
            return Err("cancelled");
        }
        if started.elapsed() >= wait {
            return Err("timed-out");
        }
        let request = match server.recv_timeout(Duration::from_millis(400)) {
            Ok(Some(r)) => r,
            Ok(None) => continue,
            Err(_) => return Err("failed"),
        };
        if request.method() != &tiny_http::Method::Get {
            crate::wall2_oauth::respond(request, 404, "Not found".to_string());
            continue;
        }
        let target = request.url().to_string();
        match parse_callback(&target, state) {
            Callback::Other => crate::wall2_oauth::respond(request, 404, "Not found".to_string()),
            Callback::BadState => crate::wall2_oauth::respond(request, 400, "Bad request".to_string()),
            Callback::Code(code) => {
                crate::wall2_oauth::respond(request, 200, crate::wall2_oauth::page("Signed in. You can close this tab."));
                return Ok(code);
            }
            Callback::Denied => {
                crate::wall2_oauth::respond(request, 200, crate::wall2_oauth::page("Sign-in did not finish. You can close this tab."));
                return Err("denied");
            }
            Callback::Failed => {
                crate::wall2_oauth::respond(request, 200, crate::wall2_oauth::page("Sign-in did not finish. You can close this tab."));
                return Err("failed");
            }
        }
    }
}

// Section: token endpoint

#[derive(Debug, PartialEq)]
pub enum TokenReply {
    Ok { access: String, expires_in: u64, refresh: Option<String> },
    /// The grant is dead: the user has to sign in again.
    Rejected(String),
    /// Network trouble, throttling or a server error: try again later, keep the token.
    Transient(String),
    /// A 4xx the grant itself did not cause (`consent_required`, `invalid_client`, and so on):
    /// the stored token stays, but only a new sign-in can fix it.
    Refused(String),
    Failed(String),
}

pub trait TokenClient {
    fn post(&self, tenant: &str, form: &[(&str, &str)]) -> TokenReply;

    /// The same request with a time limit (what remains of the read's deadline). The default
    /// ignores it; the real client uses it.
    fn post_within(&self, tenant: &str, form: &[(&str, &str)], _limit: Duration) -> TokenReply {
        self.post(tenant, form)
    }

    /// `post_within`, plus the details of a network-level failure for the log. The default has none.
    fn post_diag(&self, tenant: &str, form: &[(&str, &str)], limit: Duration, _ctx: &super::graph::Ctx) -> (TokenReply, Option<super::graph::Diag>) {
        (self.post_within(tenant, form, limit), None)
    }
}

pub fn classify_token(status: u16, body: &[u8]) -> TokenReply {
    let json: Option<Value> = serde_json::from_slice(body).ok();
    if (200..300).contains(&status) {
        let Some(j) = json else { return TokenReply::Failed(format!("token-{status}")) };
        let Some(access) = j.get("access_token").and_then(Value::as_str).filter(|s| !s.is_empty()) else {
            return TokenReply::Failed(format!("token-{status}"));
        };
        return TokenReply::Ok {
            access: access.to_string(),
            expires_in: j.get("expires_in").and_then(Value::as_u64).unwrap_or(3600),
            refresh: j.get("refresh_token").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string),
        };
    }
    if status == 429 || status >= 500 {
        return TokenReply::Transient(token_reason(status, body));
    }
    match json.as_ref().and_then(|j| j.get("error")).and_then(Value::as_str) {
        Some("invalid_grant") | Some("interaction_required") => TokenReply::Rejected(token_reason(status, body)),
        _ => TokenReply::Refused(token_reason(status, body)),
    }
}

pub struct HttpTokens;

impl TokenClient for HttpTokens {
    fn post(&self, tenant: &str, form: &[(&str, &str)]) -> TokenReply {
        self.post_within(tenant, form, super::graph::BUDGET)
    }

    fn post_within(&self, tenant: &str, form: &[(&str, &str)], limit: Duration) -> TokenReply {
        self.send(tenant, form, limit).0
    }

    fn post_diag(&self, tenant: &str, form: &[(&str, &str)], limit: Duration, ctx: &super::graph::Ctx) -> (TokenReply, Option<super::graph::Diag>) {
        let (reply, net) = self.send(tenant, form, limit);
        let diag = net.map(|net| super::graph::Diag {
            kind: ctx.kind,
            host: "login",
            net: Some(net),
            status: 0,
            code: None,
            inner: None,
            request_id: None,
            client_request_id: None,
            attempt: 1,
            elapsed_ms: ctx.elapsed_ms(),
        });
        (reply, diag)
    }
}

impl HttpTokens {
    /// The request, and the class of the network failure when there was one.
    fn send(&self, tenant: &str, form: &[(&str, &str)], limit: Duration) -> (TokenReply, Option<&'static str>) {
        let url = format!("https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token");
        match agent().post(&url).timeout(limit).send_form(form) {
            Ok(resp) => {
                let status = resp.status();
                let reply = match read_body(resp) {
                    Some(body) => classify_token(status, &body),
                    None => TokenReply::Failed(format!("token-{status}")),
                };
                (reply, None)
            }
            Err(ureq::Error::Status(code, resp)) => (classify_token(code, &read_capped(resp, MAX_ERROR_BODY)), None),
            Err(ureq::Error::Transport(t)) => (TokenReply::Transient(TOKEN_NETWORK.to_string()), Some(super::net_of(&t))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc7636_appendix_b_vector() {
        assert_eq!(
            challenge_for("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk").as_deref(),
            Some("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        );
    }

    #[test]
    fn random_bytes_differ() {
        let a = random_bytes(32).unwrap();
        let b = random_bytes(32).unwrap();
        assert_eq!(a.len(), 32);
        assert_ne!(a, b);
    }

    #[test]
    fn authorize_url_has_every_parameter() {
        let id = "00000000-0000-0000-0000-000000000000";
        let redirect = "http://localhost:50123/auth-callback.html";
        let raw = authorize_url("common", id, redirect, "chal", "st");
        assert!(raw.starts_with("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?"));
        let url = tauri::Url::parse(&raw).unwrap();
        let get = |k: &str| url.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.into_owned());
        assert_eq!(get("client_id").as_deref(), Some(id));
        assert_eq!(get("response_type").as_deref(), Some("code"));
        assert_eq!(get("redirect_uri").as_deref(), Some(redirect));
        assert_eq!(get("response_mode").as_deref(), Some("query"));
        assert_eq!(get("scope").as_deref(), Some("offline_access https://graph.microsoft.com/Calendars.Read"));
        assert_eq!(get("code_challenge").as_deref(), Some("chal"));
        assert_eq!(get("code_challenge_method").as_deref(), Some("S256"));
        assert_eq!(get("state").as_deref(), Some("st"));
        assert_eq!(get("prompt").as_deref(), Some("select_account"));
        assert_eq!(url.query_pairs().count(), 9);
        assert!(get("redirect_uri").unwrap().contains("localhost:50123"));
    }

    #[test]
    fn callback_accepts_only_the_right_path_and_state() {
        assert_eq!(parse_callback("/auth-callback.html?code=abc&state=st", "st"), Callback::Code("abc".into()));
        assert_eq!(parse_callback("/auth-callback.html?state=st&code=a%20b", "st"), Callback::Code("a b".into()));
        assert_eq!(parse_callback("/other?code=abc&state=st", "st"), Callback::Other);
        assert_eq!(parse_callback("/favicon.ico", "st"), Callback::Other);
        assert_eq!(parse_callback("/auth-callback.html?code=abc&state=nope", "st"), Callback::BadState);
        assert_eq!(parse_callback("/auth-callback.html?code=abc", "st"), Callback::BadState);
        assert_eq!(parse_callback("/auth-callback.html?code=abc&state=st&state=st", "st"), Callback::BadState);
        assert_eq!(parse_callback("/auth-callback.html?code=a&code=b&state=st", "st"), Callback::Failed);
        assert_eq!(parse_callback("/auth-callback.html?state=st", "st"), Callback::Failed);
        assert_eq!(parse_callback("/auth-callback.html?state=st&code=", "st"), Callback::Failed);
        assert_eq!(parse_callback("/auth-callback.html?error=access_denied&state=st", "st"), Callback::Denied);
        assert_eq!(parse_callback("/auth-callback.html?error=server_error&state=st", "st"), Callback::Failed);
        assert_eq!(parse_callback("/auth-callback.html?error=access_denied&state=bad", "st"), Callback::BadState);
    }

    fn get_status(port: u16, target: &str) -> u16 {
        match ureq::get(&format!("http://127.0.0.1:{port}{target}")).call() {
            Ok(r) => r.status(),
            Err(ureq::Error::Status(c, _)) => c,
            Err(_) => 0,
        }
    }

    #[test]
    fn a_wrong_state_callback_gets_400_and_the_wait_continues() {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let client = std::thread::spawn(move || {
            let bad = get_status(port, "/auth-callback.html?code=stolen&state=wrong");
            let missing = get_status(port, "/auth-callback.html?code=stolen");
            let other = get_status(port, "/favicon.ico");
            let good = get_status(port, "/auth-callback.html?code=real&state=st");
            (bad, missing, other, good)
        });
        let result = wait_for_callback(&server, "st", Duration::from_secs(20));
        assert_eq!(result, Ok("real".to_string()));
        assert_eq!(client.join().unwrap(), (400, 400, 404, 200));
    }

    #[test]
    fn token_replies_are_classified() {
        let ok = br#"{"access_token":"a","expires_in":3599,"refresh_token":"r"}"#;
        assert_eq!(
            classify_token(200, ok),
            TokenReply::Ok { access: "a".into(), expires_in: 3599, refresh: Some("r".into()) }
        );
        assert_eq!(classify_token(200, b"{}"), TokenReply::Failed("token-200".into()));
        assert_eq!(classify_token(400, br#"{"error":"invalid_grant"}"#), TokenReply::Rejected("token-400".into()));
        assert_eq!(classify_token(400, br#"{"error":"interaction_required"}"#), TokenReply::Rejected("token-400".into()));
        assert_eq!(classify_token(400, br#"{"error":"consent_required"}"#), TokenReply::Refused("token-400".into()));
        assert_eq!(classify_token(401, br#"{"error":"invalid_client"}"#), TokenReply::Refused("token-401".into()));
        assert_eq!(classify_token(400, b"not json"), TokenReply::Refused("token-400".into()));
        assert_eq!(classify_token(429, b""), TokenReply::Transient("token-429".into()));
        assert_eq!(classify_token(503, b""), TokenReply::Transient("token-503".into()));
        assert_eq!(
            classify_token(400, br#"{"error":"invalid_grant","error_codes":[9002327]}"#),
            TokenReply::Rejected("token-400-9002327".into())
        );
    }
}
