//! Reason codes: short fixed-shape strings that say why an account is unavailable.
//!
//! A code is built only from numbers and from a server's `error.code` after it passes a strict
//! character check. It never holds a token, a code, an address, a name, a subject, a URL or
//! any other free text from a server.

use serde_json::Value;

/// Error bodies are read up to this many bytes; anything past it is ignored.
pub const MAX_ERROR_BODY: u64 = 16 * 1024;

pub const GRAPH_NETWORK: &str = "graph-network";
pub const GRAPH_BODY: &str = "graph-body";
pub const GRAPH_TIMEOUT: &str = "graph-timeout";
pub const TOKEN_NETWORK: &str = "token-network";
pub const STORE_WRITE: &str = "store-write";
pub const STORE_READ: &str = "store-read";

/// `^[A-Za-z][A-Za-z0-9_]{0,39}$`
pub(crate) fn clean_code(s: &str) -> Option<&str> {
    let mut chars = s.chars();
    let first = chars.next()?;
    if !first.is_ascii_alphabetic() || s.len() > 40 {
        return None;
    }
    if chars.all(|c| c.is_ascii_alphanumeric() || c == '_') {
        Some(s)
    } else {
        None
    }
}

/// The reason for a Graph error reply. `body` is what was read, at most the limit plus one
/// byte: a body over the limit, or one that is not complete JSON, gives `graph-body`.
/// Valid JSON gives `graph-<status>-<code>` when `error.code` passes the check, and
/// `graph-<status>` when it does not.
pub fn graph_reason(status: u16, body: &[u8]) -> String {
    if body.len() as u64 > MAX_ERROR_BODY {
        return GRAPH_BODY.to_string();
    }
    let Ok(json) = serde_json::from_slice::<Value>(body) else {
        return GRAPH_BODY.to_string();
    };
    let code = json.get("error").and_then(|e| e.get("code")).and_then(Value::as_str);
    match code.and_then(clean_code) {
        Some(c) => format!("graph-{status}-{c}"),
        None => format!("graph-{status}"),
    }
}

/// `token-<status>` or `token-<status>-<n>`, where n is the first entry of `error_codes`
/// when it is a whole number of at most seven digits.
pub fn token_reason(status: u16, body: &[u8]) -> String {
    let body = &body[..body.len().min(MAX_ERROR_BODY as usize)];
    let n = serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|j| j.get("error_codes")?.as_array()?.first()?.as_u64())
        .map(|n| n.to_string())
        .filter(|s| s.len() <= 7);
    match n {
        Some(n) => format!("token-{status}-{n}"),
        None => format!("token-{status}"),
    }
}

/// True when `s` is one of the allowed shapes. Used by tests and as a last guard.
pub fn is_valid_reason(s: &str) -> bool {
    if matches!(s, "graph-network" | "graph-timeout" | "graph-body" | "token-network" | "store-write" | "store-read") {
        return true;
    }
    let (family, rest) = if let Some(r) = s.strip_prefix("graph-") {
        (0, r)
    } else if let Some(r) = s.strip_prefix("token-") {
        (1, r)
    } else {
        return false;
    };
    let mut parts = rest.splitn(2, '-');
    let status = parts.next().unwrap_or("");
    if status.is_empty() || status.len() > 3 || !status.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }
    match parts.next() {
        None => true,
        Some(tail) if family == 0 => clean_code(tail).is_some(),
        Some(tail) => !tail.is_empty() && tail.len() <= 7 && tail.chars().all(|c| c.is_ascii_digit()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn graph_status_and_code() {
        assert_eq!(graph_reason(403, br#"{"error":{"code":"ErrorAccessDenied","message":"x"}}"#), "graph-403-ErrorAccessDenied");
        assert_eq!(graph_reason(400, br#"{"error":{"code":"Bad_Request2"}}"#), "graph-400-Bad_Request2");
        assert_eq!(graph_reason(503, br#"{}"#), "graph-503");
        assert_eq!(graph_reason(404, br#"{"error":"flat"}"#), "graph-404");
    }

    #[test]
    fn hostile_graph_codes_are_dropped() {
        let url = br#"{"error":{"code":"https://example.test/x?code=abc"}}"#;
        assert_eq!(graph_reason(403, url), "graph-403");
        let email = br#"{"error":{"code":"someone@example.test"}}"#;
        assert_eq!(graph_reason(403, email), "graph-403");
        let long = format!(r#"{{"error":{{"code":"{}"}}}}"#, "A".repeat(41));
        assert_eq!(graph_reason(403, long.as_bytes()), "graph-403");
        let edge = format!(r#"{{"error":{{"code":"{}"}}}}"#, "A".repeat(40));
        assert_eq!(graph_reason(403, edge.as_bytes()), format!("graph-403-{}", "A".repeat(40)));
        let digit_first = br#"{"error":{"code":"1abc"}}"#;
        assert_eq!(graph_reason(403, digit_first), "graph-403");
        let spaced = br#"{"error":{"code":"Access Denied"}}"#;
        assert_eq!(graph_reason(403, spaced), "graph-403");
        let dash = br#"{"error":{"code":"a-b"}}"#;
        assert_eq!(graph_reason(403, dash), "graph-403");
        let nonstring = br#"{"error":{"code":123}}"#;
        assert_eq!(graph_reason(403, nonstring), "graph-403");
    }

    #[test]
    fn token_status_and_first_error_code() {
        assert_eq!(token_reason(400, br#"{"error":"invalid_grant","error_codes":[9002327,70000]}"#), "token-400-9002327");
        assert_eq!(token_reason(400, br#"{"error_codes":[]}"#), "token-400");
        assert_eq!(token_reason(503, b""), "token-503");
        assert_eq!(token_reason(400, br#"{"error_codes":["70000"]}"#), "token-400");
        assert_eq!(token_reason(400, br#"{"error_codes":[-5]}"#), "token-400");
        assert_eq!(token_reason(400, br#"{"error_codes":[1.5]}"#), "token-400");
    }

    #[test]
    fn token_error_codes_are_digits_only_and_at_most_seven() {
        assert_eq!(token_reason(400, br#"{"error_codes":[1234567]}"#), "token-400-1234567");
        assert_eq!(token_reason(400, br#"{"error_codes":[12345678]}"#), "token-400");
        assert_eq!(token_reason(400, br#"{"error_codes":["https://example.test"]}"#), "token-400");
    }

    #[test]
    fn an_unreadable_body_is_graph_body() {
        assert_eq!(graph_reason(500, b"<html><body>Bad gateway</body></html>"), "graph-body");
        assert_eq!(graph_reason(503, b""), "graph-body");
        assert_eq!(graph_reason(500, b"not json"), "graph-body");
        // Truncated JSON.
        assert_eq!(graph_reason(403, br#"{"error":{"code":"ErrorAccessDen"#), "graph-body");
    }

    #[test]
    fn a_body_over_the_limit_is_graph_body_even_when_it_is_valid_json() {
        let limit = MAX_ERROR_BODY as usize;
        let pad = |n: usize| "x".repeat(n);
        // 20 KB of valid JSON.
        let big = format!(r#"{{"error":{{"code":"Late"}},"pad":"{}"}}"#, pad(20_000));
        assert!(big.len() > limit + 1);
        assert_eq!(graph_reason(403, big.as_bytes()), "graph-body");
        // What the reader hands over for a big body: the limit plus one byte, never parseable.
        assert_eq!(graph_reason(403, &big.as_bytes()[..limit + 1]), "graph-body");
        // Exactly the limit, complete: parsed.
        let prefix = r#"{"error":{"code":"AtLimit"},"pad":""#;
        let suffix = r#""}"#;
        let exact = format!("{prefix}{}{suffix}", pad(limit - prefix.len() - suffix.len()));
        assert_eq!(exact.len(), limit);
        assert_eq!(graph_reason(403, exact.as_bytes()), "graph-403-AtLimit");
        // One byte over: graph-body.
        let over = format!("{prefix}{}{suffix}", pad(limit - prefix.len() - suffix.len() + 1));
        assert_eq!(graph_reason(403, over.as_bytes()), "graph-body");
    }

    #[test]
    fn every_shape_passes_the_shape_check() {
        for ok in [
            "graph-403",
            "graph-403-ErrorAccessDenied",
            "graph-network",
            "graph-body",
            "token-400",
            "token-400-9002327",
            "token-network",
            "store-write",
            "store-read",
        ] {
            assert!(is_valid_reason(ok), "{ok}");
        }
        for bad in ["", "graph-", "graph-4030", "graph-403-", "graph-403-a b", "token-400-12345678", "token-400-ab", "user@example.test", "https://example.test", "other"] {
            assert!(!is_valid_reason(bad), "{bad}");
        }
    }
}
