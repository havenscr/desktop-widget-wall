//! The sound service's summary reads, classified. A failed read is one of three kinds
//! (see `wall2_sonos_log::Kind`): `timed-out` (the agent's time limit passed), `no-answer`
//! (no connection, or it was reset), `bad-answer` (a status other than success, an
//! unreadable, oversize or non-JSON body). Only the kind and an HTTP status number leave
//! this module; the body and the address never do. Each read is timed so a failed or slow
//! one can be written to `wall2-sonos.log`.

use crate::wall2_sonos_log::{self as log, Event, Kind, Read};
use base64::Engine as _;
use serde::Serialize;
use serde_json::Value;
use std::io::Read as _;
use std::net::Ipv4Addr;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// The largest body one read accepts (the same limit the other feeds use).
const MAX_BODY: u64 = 1_000_000;
/// A successful read slower than this is written to the log as `slow`.
const SLOW_MS: u128 = 2_000;

/// The eight reads, in the order of their answers. The first three are required.
const READS: [(Read, &str); 8] = [
    (Read::Status, "/api/status"),
    (Read::Speakers, "/api/speakers"),
    (Read::Routines, "/api/routines"),
    (Read::Groups, "/api/groups"),
    (Read::Presets, "/api/group-presets"),
    (Read::Scenes, "/api/scenes"),
    (Read::Timers, "/api/sleep-timers"),
    (Read::Capabilities, "/api/capabilities"),
];
const REQUIRED: usize = 3;

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Failure {
    pub kind: Kind,
    /// The HTTP status when the service answered, else 0.
    pub status: u16,
}

pub(crate) struct Timed {
    pub result: Result<Value, Failure>,
    pub ms: u128,
}

fn is_timeout(e: &std::io::Error) -> bool {
    matches!(e.kind(), std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock)
}

/// Walks the error's sources for an I/O timeout.
fn io_timed_out(e: &(dyn std::error::Error + 'static)) -> bool {
    let mut cur: Option<&(dyn std::error::Error + 'static)> = Some(e);
    while let Some(err) = cur {
        if err.downcast_ref::<std::io::Error>().is_some_and(is_timeout) {
            return true;
        }
        cur = err.source();
    }
    false
}

pub(crate) fn classify(e: &ureq::Error) -> Failure {
    match e {
        ureq::Error::Status(code, _) => Failure { kind: Kind::BadAnswer, status: *code },
        ureq::Error::Transport(_) => Failure { kind: if io_timed_out(e) { Kind::TimedOut } else { Kind::NoAnswer }, status: 0 },
    }
}

/// A bounded read of a body. A timeout while reading is `timed-out`, any other read error
/// is `no-answer` (the connection went away), more than `max` bytes is `bad-answer`.
fn read_limited(reader: impl std::io::Read, max: u64) -> Result<Vec<u8>, Kind> {
    let mut buf = Vec::new();
    match reader.take(max + 1).read_to_end(&mut buf) {
        Ok(_) if buf.len() as u64 > max => Err(Kind::BadAnswer),
        Ok(_) => Ok(buf),
        Err(e) if is_timeout(&e) => Err(Kind::TimedOut),
        Err(_) => Err(Kind::NoAnswer),
    }
}

pub(crate) fn get_json(agent: &ureq::Agent, base: &str, path: &str) -> Result<Value, Failure> {
    let resp = agent.get(&format!("{base}{path}")).set("Accept", "application/json").call().map_err(|e| classify(&e))?;
    let status = resp.status();
    if !(200..300).contains(&status) {
        return Err(Failure { kind: Kind::BadAnswer, status });
    }
    let body = read_limited(resp.into_reader(), MAX_BODY).map_err(|kind| Failure { kind, status })?;
    serde_json::from_slice(&body).map_err(|_| Failure { kind: Kind::BadAnswer, status })
}

fn get_timed(agent: &ureq::Agent, base: &str, path: &str) -> Timed {
    let start = Instant::now();
    let result = get_json(agent, base, path);
    Timed { result, ms: start.elapsed().as_millis() }
}

/// Which lines the reads earn: one for every failed read, and one for every successful read slower
/// than two seconds. (Whether everything failed at once or only the required reads did is what the
/// log has to show; its rotation bounds the volume.)
fn log_lines(timed: &[Timed]) -> Vec<String> {
    let mut lines = Vec::new();
    for (i, t) in timed.iter().enumerate() {
        let read = READS[i].0;
        match &t.result {
            Err(f) => lines.push(log::line(Event::Failed, read, f.kind, f.status, t.ms)),
            Ok(_) if t.ms > SLOW_MS => lines.push(log::line(Event::Slow, read, Kind::None, 200, t.ms)),
            Ok(_) => {}
        }
    }
    lines
}

/// The answers of the eight reads in order, run side by side, so a slow service costs one
/// time limit, not eight. The three required reads failing fails the whole read with the
/// first failed one's kind; a failed optional read (the capabilities too) answers null.
pub(crate) fn read_all_eight(agent: &ureq::Agent, base: &str) -> Result<Vec<Value>, Kind> {
    let timed: Vec<Timed> = std::thread::scope(|sc| {
        let handles: Vec<_> = READS.iter().map(|(_, path)| sc.spawn(move || get_timed(agent, base, path))).collect();
        handles
            .into_iter()
            .map(|h| h.join().unwrap_or(Timed { result: Err(Failure { kind: Kind::BadAnswer, status: 0 }), ms: 0 }))
            .collect()
    });
    for line in log_lines(&timed) {
        log::write_line(line);
    }
    if let Some(f) = timed.iter().take(REQUIRED).find_map(|t| t.result.as_ref().err()) {
        return Err(f.kind);
    }
    Ok(timed.into_iter().map(|t| t.result.unwrap_or(Value::Null)).collect())
}

// Section: cover art
//
// The page never loads a cover itself (its content policy stays as it is). `wall2_sonos_art` fetches
// the one address the last good summary read held for the playing speaker, here, under bounds a
// security read can check line by line: the address must be a speaker's own cover address (plain
// `http`, a literal private IPv4 address, port 1400) or an `https` address at a short fixed list of
// cover hosts; the request never follows a redirect, has one 3 second limit for everything, and
// accepts at most 400 KB; the bytes must begin as a JPEG, PNG or WebP picture whatever the answer
// declared; every failure is a fixed word in the Sonos log (never the address) and answers nothing.

/// The most a cover picture may weigh.
pub(crate) const ART_MAX: u64 = 400 * 1024;
/// One fetch's whole time limit: connecting, answering and reading the body.
pub(crate) const ART_LIMIT: Duration = Duration::from_secs(3);
/// The only `https` hosts a cover may come from: the host itself or any name under it.
pub(crate) const COVER_HOSTS: [&str; 2] = ["i.scdn.co", "mzstatic.com"];
/// The only port a speaker serves its covers on.
const SPEAKER_PORT: &str = "1400";
/// The longest address looked at.
const ART_ADDRESS_MAX: usize = 1024;

/// The address rebuilt from checked parts, or None when it is not one a cover may be fetched from.
/// Strict by construction: only printable ASCII, no `#`, no backslash, no user info, no brackets, an
/// authority of letters, digits, dots, hyphens and one colon, so no other reader of the same text can
/// see a different host than this one did.
pub(crate) fn art_url(raw: &str) -> Option<String> {
    if raw.is_empty() || raw.len() > ART_ADDRESS_MAX || !raw.bytes().all(|b| (0x21..=0x7e).contains(&b)) || raw.contains(['#', '\\']) {
        return None;
    }
    let head = |n: usize| raw.get(..n).map(str::to_ascii_lowercase);
    let (secure, rest) = if head(8).as_deref() == Some("https://") {
        (true, &raw[8..])
    } else if head(7).as_deref() == Some("http://") {
        (false, &raw[7..])
    } else {
        return None;
    };
    let end = rest.find(['/', '?']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(end);
    if authority.is_empty() || !authority.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b':' || b == b'-') {
        return None;
    }
    let tail = if tail.is_empty() { "/".to_string() } else if tail.starts_with('?') { format!("/{tail}") } else { tail.to_string() };
    if secure {
        let host = match authority.split_once(':') {
            Some((h, "443")) => h,
            Some(_) => return None,
            None => authority,
        };
        let host = host.to_ascii_lowercase();
        let labels_ok = host.len() <= 253
            && host.split('.').all(|l| !l.is_empty() && l.len() <= 63 && !l.starts_with('-') && !l.ends_with('-') && l.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'));
        let listed = COVER_HOSTS.iter().any(|h| host == *h || host.ends_with(&format!(".{h}")));
        return (labels_ok && listed).then(|| format!("https://{host}{tail}"));
    }
    let (host, port) = authority.split_once(':')?;
    let ip: Ipv4Addr = host.parse().ok()?;
    (port == SPEAKER_PORT && ip.to_string() == host && ip.is_private()).then(|| format!("http://{ip}:{SPEAKER_PORT}{tail}"))
}

/// The picture type the body's own first bytes say (JPEG, PNG or WebP), whatever was declared.
pub(crate) fn sniff_image(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if b.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("image/png")
    } else if b.len() >= 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

/// The agent for covers: one limit for everything, and a redirect is never followed.
pub(crate) fn art_agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| ureq::AgentBuilder::new().timeout(ART_LIMIT).redirects(0).build())
}

/// One checked fetch (the caller has passed the address through `art_url`): status 200 only, at most
/// `ART_MAX` bytes (a larger declared length is refused before reading), and a body that begins as
/// a picture.
pub(crate) fn fetch_art(agent: &ureq::Agent, url: &str) -> Result<(&'static str, Vec<u8>), Failure> {
    let resp = agent.get(url).set("Accept", "image/jpeg, image/png, image/webp").call().map_err(|e| classify(&e))?;
    let status = resp.status();
    if status != 200 {
        return Err(Failure { kind: Kind::BadAnswer, status });
    }
    if resp.header("Content-Length").and_then(|v| v.trim().parse::<u64>().ok()).is_some_and(|n| n > ART_MAX) {
        return Err(Failure { kind: Kind::TooBig, status });
    }
    let mut buf = Vec::new();
    match resp.into_reader().take(ART_MAX + 1).read_to_end(&mut buf) {
        Ok(_) if buf.len() as u64 > ART_MAX => return Err(Failure { kind: Kind::TooBig, status }),
        Ok(_) => {}
        Err(e) if is_timeout(&e) => return Err(Failure { kind: Kind::TimedOut, status }),
        Err(_) => return Err(Failure { kind: Kind::NoAnswer, status }),
    }
    let mime = sniff_image(&buf).ok_or(Failure { kind: Kind::NotImage, status })?;
    Ok((mime, buf))
}

/// A fetched cover as the page uses it: a type and the bytes, base 64.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ArtImage {
    pub mime: String,
    pub base64: String,
}

/// A failed fetch of one address is tried once more after this, then never again for that address.
pub(crate) const ART_RETRY_AFTER: Duration = Duration::from_secs(30);

/// The last address asked for, and what came of it (None when it failed).
pub(crate) struct ArtSlot {
    address: String,
    image: Option<ArtImage>,
    /// When it failed, and whether the one more try is still to come (never for an address that is not allowed).
    failed: Option<(Instant, bool)>,
}

/// The one remembered result, in memory only: one fetch per distinct address, the failures too.
pub(crate) type ArtCache = Mutex<Option<ArtSlot>>;

/// The cover for `raw`, the address the last good read held. The same address as last time answers from memory; a new
/// one is checked (`art_url`), fetched with `fetch`, sniffed and remembered. A fetch that failed is remembered too, and
/// is tried once more when asked for 30 seconds or more after the failure (an address that is not allowed never is).
/// The lock is held across the fetch, so two calls for one address never fetch twice. Every failure is one fixed-word
/// line in the Sonos log and answers None.
pub(crate) fn art_cached(
    cache: &ArtCache,
    raw: Option<&str>,
    fetch: impl FnOnce(&str) -> Result<(&'static str, Vec<u8>), Failure>,
) -> Option<ArtImage> {
    art_cached_at(cache, raw, Instant::now(), fetch)
}

/// `art_cached` with the time of the call given (for the retry window).
pub(crate) fn art_cached_at(
    cache: &ArtCache,
    raw: Option<&str>,
    now: Instant,
    fetch: impl FnOnce(&str) -> Result<(&'static str, Vec<u8>), Failure>,
) -> Option<ArtImage> {
    let raw = raw?;
    let mut slot = cache.lock().ok()?;
    let mut retrying = false;
    if let Some(s) = slot.as_ref().filter(|s| s.address == raw) {
        if s.image.is_some() {
            return s.image.clone();
        }
        match s.failed {
            Some((at, true)) if now.saturating_duration_since(at) >= ART_RETRY_AFTER => retrying = true,
            _ => return None,
        }
    }
    let start = Instant::now();
    let got = match art_url(raw) {
        Some(url) => fetch(&url),
        None => Err(Failure { kind: Kind::Refused, status: 0 }),
    };
    let (image, failed) = match got {
        Ok((mime, bytes)) => (Some(ArtImage { mime: mime.to_string(), base64: base64::engine::general_purpose::STANDARD.encode(bytes) }), None),
        Err(f) => {
            log::write_line(log::line(Event::Failed, Read::Art, f.kind, f.status, start.elapsed().as_millis()));
            (None, Some((now, !retrying && f.kind != Kind::Refused)))
        }
    };
    *slot = Some(ArtSlot { address: raw.to_string(), image: image.clone(), failed });
    image
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;
    use std::net::TcpListener;
    use std::time::Duration;

    /// What a throwaway local listener does with a connection.
    #[derive(Clone, Copy)]
    enum Serve {
        Json,
        Status(u16),
        Text,
        Huge,
        Close,
        Silent,
        StallBody,
        /// 200 with exactly these bytes and a matching length.
        Picture(&'static [u8]),
        /// 200, a PNG start, and a declared length over the cover limit.
        DeclaredHuge,
        /// 200, a PNG start, no declared length, and more than the cover limit.
        StreamHuge,
        /// 302 to somewhere else.
        Redirect,
    }

    /// A loopback-only listener for one test (never a real device or service). It answers
    /// every connection the same way, whatever the path.
    fn serve(how: Serve) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut s) = stream else { break };
                std::thread::spawn(move || {
                    let mut seen = [0u8; 2048];
                    let _ = s.read(&mut seen);
                    let head = |code: u16, len: usize| format!("HTTP/1.1 {code} X\r\nContent-Type: application/json\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n");
                    match how {
                        Serve::Json => { let _ = s.write_all((head(200, 2) + "{}").as_bytes()); }
                        Serve::Status(code) => { let _ = s.write_all((head(code, 2) + "{}").as_bytes()); }
                        Serve::Text => { let _ = s.write_all((head(200, 4) + "nope").as_bytes()); }
                        Serve::Huge => {
                            let _ = s.write_all(head(200, 1_000_100).as_bytes());
                            let chunk = vec![b' '; 10_000];
                            for _ in 0..101 { if s.write_all(&chunk).is_err() { break; } }
                        }
                        Serve::Picture(bytes) => {
                            let _ = s.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", bytes.len()).as_bytes());
                            let _ = s.write_all(bytes);
                        }
                        Serve::DeclaredHuge => {
                            let _ = s.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 500000\r\nConnection: close\r\n\r\n");
                            let _ = s.write_all(&PNG);
                        }
                        Serve::StreamHuge => {
                            let _ = s.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nConnection: close\r\n\r\n");
                            let _ = s.write_all(&PNG);
                            let chunk = vec![0u8; 10_000];
                            for _ in 0..45 { if s.write_all(&chunk).is_err() { break; } }
                        }
                        Serve::Redirect => {
                            let _ = s.write_all(b"HTTP/1.1 302 Found\r\nLocation: http://10.0.0.9:1400/other.png\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                        }
                        Serve::Close => {}
                        Serve::Silent => std::thread::sleep(Duration::from_secs(3)),
                        Serve::StallBody => {
                            let _ = s.write_all(head(200, 100).as_bytes());
                            let _ = s.write_all(b"{");
                            std::thread::sleep(Duration::from_secs(3));
                        }
                    }
                });
            }
        });
        base
    }

    fn agent(ms: u64) -> ureq::Agent {
        ureq::AgentBuilder::new().timeout(Duration::from_millis(ms)).redirects(0).build()
    }

    /// A generous limit for every case that should answer at once (a loaded runner must not turn
    /// them into timeouts), a short one only for the two that are meant to cross it.
    const PROMPT_MS: u64 = 5000;
    const SHORT_MS: u64 = 600;
    /// A stalled body must get its head in before the limit runs out, so it has more room than silence.
    const STALL_MS: u64 = 1500;

    fn fail_of(how: Serve) -> Failure {
        let ms = match how {
            Serve::Silent => SHORT_MS,
            Serve::StallBody => STALL_MS,
            _ => PROMPT_MS,
        };
        get_json(&agent(ms), &serve(how), "/api/status").unwrap_err()
    }

    #[test]
    fn a_good_answer_reads() {
        assert!(get_json(&agent(PROMPT_MS), &serve(Serve::Json), "/api/status").is_ok());
    }

    #[test]
    fn a_status_other_than_success_is_bad_answer_with_its_number() {
        assert_eq!(fail_of(Serve::Status(503)), Failure { kind: Kind::BadAnswer, status: 503 });
        assert_eq!(fail_of(Serve::Status(404)), Failure { kind: Kind::BadAnswer, status: 404 });
        assert_eq!(fail_of(Serve::Status(302)), Failure { kind: Kind::BadAnswer, status: 302 });
    }

    #[test]
    fn an_unreadable_or_oversize_body_is_bad_answer() {
        assert_eq!(fail_of(Serve::Text), Failure { kind: Kind::BadAnswer, status: 200 });
        assert_eq!(fail_of(Serve::Huge), Failure { kind: Kind::BadAnswer, status: 200 });
    }

    #[test]
    fn no_connection_or_a_dropped_one_is_no_answer() {
        let gone = {
            let l = TcpListener::bind("127.0.0.1:0").unwrap();
            format!("http://{}", l.local_addr().unwrap())
        };
        assert_eq!(get_json(&agent(PROMPT_MS), &gone, "/api/status").unwrap_err(), Failure { kind: Kind::NoAnswer, status: 0 });
        assert_eq!(fail_of(Serve::Close), Failure { kind: Kind::NoAnswer, status: 0 });
    }

    #[test]
    fn the_time_limit_passing_is_timed_out_before_and_during_the_body() {
        assert_eq!(fail_of(Serve::Silent), Failure { kind: Kind::TimedOut, status: 0 });
        assert_eq!(fail_of(Serve::StallBody), Failure { kind: Kind::TimedOut, status: 200 });
    }

    #[test]
    fn body_reads_classify_their_errors() {
        struct Bad(std::io::ErrorKind);
        impl std::io::Read for Bad {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> { Err(std::io::Error::from(self.0)) }
        }
        assert_eq!(read_limited(Bad(std::io::ErrorKind::TimedOut), 10), Err(Kind::TimedOut));
        assert_eq!(read_limited(Bad(std::io::ErrorKind::WouldBlock), 10), Err(Kind::TimedOut));
        assert_eq!(read_limited(Bad(std::io::ErrorKind::ConnectionReset), 10), Err(Kind::NoAnswer));
        assert_eq!(read_limited(&[b'a'; 10][..], 10).map(|v| v.len()), Ok(10));
        assert_eq!(read_limited(&[b'a'; 11][..], 10), Err(Kind::BadAnswer));
    }

    fn ok(ms: u128) -> Timed { Timed { result: Ok(Value::Null), ms } }
    fn bad(kind: Kind, status: u16, ms: u128) -> Timed { Timed { result: Err(Failure { kind, status }), ms } }

    fn eight(mut first: Vec<Timed>) -> Vec<Timed> {
        while first.len() < 8 { first.push(ok(5)); }
        first
    }

    #[test]
    fn each_failure_and_a_slow_success_earn_their_line() {
        assert_eq!(log_lines(&eight(vec![bad(Kind::TimedOut, 0, 4003)])), ["failed status timed-out 0 4003\n"]);
        assert_eq!(log_lines(&eight(vec![ok(5), bad(Kind::NoAnswer, 0, 9)])), ["failed speakers no-answer 0 9\n"]);
        assert_eq!(log_lines(&eight(vec![ok(5), ok(5), bad(Kind::BadAnswer, 503, 70)])), ["failed routines bad-answer 503 70\n"]);
        assert_eq!(log_lines(&eight(vec![ok(2310)])), ["slow status none 200 2310\n"]);
        assert!(log_lines(&eight(vec![ok(2000)])).is_empty());
        assert!(log_lines(&eight(vec![])).is_empty());
    }

    #[test]
    fn every_failed_read_is_logged_whether_all_failed_or_only_some() {
        let outage: Vec<Timed> = (0..8).map(|_| bad(Kind::NoAnswer, 0, 3)).collect();
        let lines = log_lines(&outage);
        assert_eq!(lines.len(), 8);
        assert_eq!(lines[3], "failed groups no-answer 0 3\n");
        assert_eq!(lines[6], "failed timers no-answer 0 3\n");
        assert_eq!(lines[7], "failed capabilities no-answer 0 3\n");
        // Only the required three failed: three lines, none for the four that worked.
        let mut required: Vec<Timed> = (0..3).map(|_| bad(Kind::TimedOut, 0, 4000)).collect();
        required.extend((0..5).map(|_| ok(5)));
        assert_eq!(log_lines(&required).len(), 3);
        let mut degraded = eight(vec![]);
        degraded[5] = bad(Kind::TimedOut, 0, 4001);
        assert_eq!(log_lines(&degraded), ["failed scenes timed-out 0 4001\n"]);
        // A service without the capabilities route (a 404) is one logged optional failure, never a failed read.
        let mut no_route = eight(vec![]);
        no_route[7] = bad(Kind::BadAnswer, 404, 8);
        assert_eq!(log_lines(&no_route), ["failed capabilities bad-answer 404 8\n"]);
    }

    #[test]
    fn the_eight_reads_answer_or_fail_with_the_first_required_kind() {
        let got = read_all_eight(&agent(PROMPT_MS), &serve(Serve::Json)).unwrap();
        assert_eq!(got.len(), 8);
        assert_eq!(read_all_eight(&agent(PROMPT_MS), &serve(Serve::Status(500))).unwrap_err(), Kind::BadAnswer);
        assert_eq!(read_all_eight(&agent(SHORT_MS), &serve(Serve::Silent)).unwrap_err(), Kind::TimedOut);
        assert_eq!(read_all_eight(&agent(PROMPT_MS), &serve(Serve::Close)).unwrap_err(), Kind::NoAnswer);
    }

    const PNG: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    const JPEG: &[u8] = &[0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, b'J', b'F'];
    const PNG_PIC: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3];
    const WEBP_PIC: &[u8] = b"RIFF\x04\x00\x00\x00WEBPVP8 ";

    #[test]
    fn a_speaker_address_is_a_private_ipv4_on_port_1400_over_plain_http() {
        let ok = |raw: &str| art_url(raw);
        assert_eq!(ok("http://192.168.4.20:1400/getaa?s=1&u=x-sonos-spotify%3atrack"), Some("http://192.168.4.20:1400/getaa?s=1&u=x-sonos-spotify%3atrack".to_string()));
        assert_eq!(ok("HTTP://10.1.2.3:1400/a.jpg"), Some("http://10.1.2.3:1400/a.jpg".to_string()));
        assert_eq!(ok("http://172.16.0.5:1400"), Some("http://172.16.0.5:1400/".to_string()));
        assert_eq!(ok("http://172.31.255.254:1400?x=1"), Some("http://172.31.255.254:1400/?x=1".to_string()));
        for bad in [
            "http://192.168.4.20/getaa",             // no port
            "http://192.168.4.20:80/getaa",          // wrong port
            "http://192.168.4.20:14000/getaa",       // wrong port, longer
            "http://192.168.4.20:01400/getaa",       // not exactly 1400
            "https://192.168.4.20:1400/getaa",       // a private address only over plain http
            "http://127.0.0.1:1400/a",               // loopback
            "http://169.254.1.1:1400/a",             // link local
            "http://172.32.0.1:1400/a",              // just outside 172.16/12
            "http://172.15.0.1:1400/a",              // just outside 172.16/12
            "http://11.0.0.1:1400/a",                // public
            "http://8.8.8.8:1400/a",                 // public
            "http://0.0.0.0:1400/a",                 // unspecified
            "http://192.168.004.20:1400/a",          // leading zeros
            "http://192.168.4:1400/a",               // short form
            "http://3232235796:1400/a",              // a number, not a dotted address
            "http://0xc0.168.4.20:1400/a",           // hex octet
            "http://localhost:1400/a",               // a name
            "http://speaker.local:1400/a",           // a name
            "http://[::1]:1400/a",                   // IPv6
            "http://192.168.4.20:1400@evil.example/a", // user info trick
            "http://user@192.168.4.20:1400/a",       // user info
            "http://192.168.4.20:1400\\@evil.example/a", // backslash
            "http://192.168.4.20:1400#@evil.example/a", // fragment
            "http://192.168.4.20:1400/a b",          // space
            "http://192.168.4.20:1400/a\nb",         // control character
            "http://192.168.4.20:1400/\u{e9}",       // not ASCII
            "ftp://192.168.4.20:1400/a",             // other scheme
            "file:///etc/passwd",
            "//192.168.4.20:1400/a",                 // no scheme
            "/getaa?s=1",                            // a path only
            "",
        ] {
            assert_eq!(art_url(bad), None, "{bad}");
        }
        assert_eq!(art_url(&format!("http://192.168.4.20:1400/{}", "a".repeat(2000))), None);
    }

    #[test]
    fn a_cover_host_is_listed_and_https_only() {
        assert_eq!(art_url("https://i.scdn.co/image/ab67616d0000b273"), Some("https://i.scdn.co/image/ab67616d0000b273".to_string()));
        assert_eq!(art_url("HTTPS://I.SCDN.CO:443/image/x"), Some("https://i.scdn.co/image/x".to_string()));
        assert_eq!(art_url("https://is1-ssl.mzstatic.com/image/thumb/Music/x.jpg"), Some("https://is1-ssl.mzstatic.com/image/thumb/Music/x.jpg".to_string()));
        assert_eq!(art_url("https://mzstatic.com"), Some("https://mzstatic.com/".to_string()));
        for bad in [
            "http://i.scdn.co/image/x",                // plain http to a cover host
            "https://i.scdn.co.evil.example/x",        // listed name as a prefix
            "https://evil-i.scdn.co/x",                // listed name glued to a longer label
            "https://eviliscdn.co/x",
            "https://scdn.co/x",                       // the parent is not listed
            "https://co/x",
            "https://i.scdn.co./x",                    // trailing dot
            "https://.i.scdn.co/x",                    // empty label
            "https://i.scdn.co:8443/x",                // other port
            "https://i.scdn.co@evil.example/x",        // user info
            "https://evil.example\\@i.scdn.co/x",      // backslash
            "https://evil.example#@i.scdn.co/x",       // fragment
            "https://i.scdn.co%2eevil.example/x",      // escaped dot
            "https://exampl\u{e9}.mzstatic.com/x",     // not ASCII
            "https://example.com/i.scdn.co",           // listed name only in the path
            "https://127.0.0.1/x",
            "https://[::1]/x",
        ] {
            assert_eq!(art_url(bad), None, "{bad}");
        }
    }

    #[test]
    fn the_bytes_decide_the_type_not_the_declared_one() {
        assert_eq!(sniff_image(JPEG), Some("image/jpeg"));
        assert_eq!(sniff_image(PNG_PIC), Some("image/png"));
        assert_eq!(sniff_image(WEBP_PIC), Some("image/webp"));
        assert_eq!(sniff_image(b"<html>not a picture</html>"), None);
        assert_eq!(sniff_image(b"GIF89a"), None);
        assert_eq!(sniff_image(b"RIFF\x04\x00\x00\x00WAVEfmt "), None);
        assert_eq!(sniff_image(&PNG[..4]), None);
        assert_eq!(sniff_image(&[0xFF, 0xD8]), None);
        assert_eq!(sniff_image(b""), None);
    }

    fn art_of(how: Serve) -> Result<(&'static str, Vec<u8>), Failure> {
        let ms = match how {
            Serve::Silent => SHORT_MS,
            Serve::StallBody => STALL_MS,
            _ => PROMPT_MS,
        };
        fetch_art(&agent(ms), &format!("{}/getaa?s=1", serve(how)))
    }

    #[test]
    fn a_picture_that_begins_as_one_is_read_whatever_type_it_declared() {
        assert_eq!(art_of(Serve::Picture(PNG_PIC)), Ok(("image/png", PNG_PIC.to_vec())));
        assert_eq!(art_of(Serve::Picture(JPEG)), Ok(("image/jpeg", JPEG.to_vec())));
        assert_eq!(art_of(Serve::Picture(WEBP_PIC)), Ok(("image/webp", WEBP_PIC.to_vec())));
    }

    #[test]
    fn every_bound_on_a_cover_fetch_answers_a_failure() {
        assert_eq!(art_of(Serve::Picture(b"<html>no</html>")), Err(Failure { kind: Kind::NotImage, status: 200 }));
        assert_eq!(art_of(Serve::DeclaredHuge), Err(Failure { kind: Kind::TooBig, status: 200 }));
        assert_eq!(art_of(Serve::StreamHuge), Err(Failure { kind: Kind::TooBig, status: 200 }));
        // A redirect is never followed: the 302 itself is the answer.
        assert_eq!(art_of(Serve::Redirect), Err(Failure { kind: Kind::BadAnswer, status: 302 }));
        assert_eq!(art_of(Serve::Status(404)), Err(Failure { kind: Kind::BadAnswer, status: 404 }));
        assert_eq!(art_of(Serve::Close), Err(Failure { kind: Kind::NoAnswer, status: 0 }));
        assert_eq!(art_of(Serve::Silent), Err(Failure { kind: Kind::TimedOut, status: 0 }));
        assert_eq!(art_of(Serve::StallBody), Err(Failure { kind: Kind::TimedOut, status: 200 }));
    }

    #[test]
    fn the_limits_are_the_ones_the_brief_names() {
        assert_eq!(ART_MAX, 409_600);
        assert_eq!(ART_LIMIT, Duration::from_secs(3));
        assert_eq!(COVER_HOSTS, ["i.scdn.co", "mzstatic.com"]);
    }

    fn cache() -> ArtCache { Mutex::new(None) }

    #[test]
    fn one_fetch_per_distinct_address_and_a_failure_is_remembered_too() {
        let c = cache();
        let calls = std::cell::Cell::new(0);
        let good = |_: &str| { calls.set(calls.get() + 1); Ok(("image/png", PNG_PIC.to_vec())) };
        let a = "http://192.168.4.20:1400/getaa?s=1&u=a";
        let first = art_cached(&c, Some(a), good).unwrap();
        assert_eq!(first.mime, "image/png");
        assert_eq!(first.base64, base64::engine::general_purpose::STANDARD.encode(PNG_PIC));
        assert_eq!(art_cached(&c, Some(a), |_| panic!("fetched twice")), Some(first));
        assert_eq!(calls.get(), 1);
        // A different address fetches again; its failure answers None and is not fetched again.
        let b = "http://192.168.4.20:1400/getaa?s=1&u=b";
        assert_eq!(art_cached(&c, Some(b), |_| Err(Failure { kind: Kind::TimedOut, status: 0 })), None);
        assert_eq!(art_cached(&c, Some(b), |_| panic!("failed address fetched twice")), None);
        // No address answers None and leaves the memory alone.
        assert_eq!(art_cached(&c, None, |_| panic!("no address")), None);
        assert_eq!(art_cached(&c, Some(b), |_| panic!("still remembered")), None);
    }

    #[test]
    fn a_failed_cover_is_tried_once_more_after_30_seconds_then_never() {
        let c = cache();
        let t0 = Instant::now();
        let a = "http://192.168.4.20:1400/getaa?s=1&u=a";
        let calls = std::cell::Cell::new(0);
        let fail = |_: &str| { calls.set(calls.get() + 1); Err(Failure { kind: Kind::TimedOut, status: 0 }) };
        assert_eq!(art_cached_at(&c, Some(a), t0, fail), None);
        assert_eq!(calls.get(), 1);
        // Inside the 30 seconds nothing is fetched, at any call.
        for secs in [0, 1, 10, 29] {
            assert_eq!(art_cached_at(&c, Some(a), t0 + Duration::from_secs(secs), |_| panic!("tried too soon ({secs} s)")), None);
        }
        // From 30 seconds on, one more try; its failure ends it for this address.
        assert_eq!(art_cached_at(&c, Some(a), t0 + Duration::from_secs(30), fail), None);
        assert_eq!(calls.get(), 2);
        for secs in [31, 60, 3600] {
            assert_eq!(art_cached_at(&c, Some(a), t0 + Duration::from_secs(secs), |_| panic!("tried a third time ({secs} s)")), None);
        }
        // A new address starts again from the beginning.
        let b = "http://192.168.4.20:1400/getaa?s=1&u=b";
        assert_eq!(art_cached_at(&c, Some(b), t0 + Duration::from_secs(100), fail), None);
        assert_eq!(calls.get(), 3);
    }

    #[test]
    fn the_one_more_try_can_succeed_and_is_then_remembered() {
        let c = cache();
        let t0 = Instant::now();
        let a = "http://192.168.4.20:1400/getaa?s=1&u=a";
        assert_eq!(art_cached_at(&c, Some(a), t0, |_| Err(Failure { kind: Kind::NoAnswer, status: 0 })), None);
        let got = art_cached_at(&c, Some(a), t0 + Duration::from_secs(31), |_| Ok(("image/png", PNG_PIC.to_vec()))).unwrap();
        assert_eq!(got.mime, "image/png");
        assert_eq!(art_cached_at(&c, Some(a), t0 + Duration::from_secs(90), |_| panic!("fetched a cover already held")), Some(got));
    }

    #[test]
    fn an_address_that_is_not_allowed_is_never_tried_again() {
        let c = cache();
        let t0 = Instant::now();
        for secs in [0, 31, 62, 1000] {
            assert_eq!(art_cached_at(&c, Some("http://8.8.8.8:1400/a"), t0 + Duration::from_secs(secs), |_| panic!("fetched a refused address")), None);
        }
    }

    #[test]
    fn an_address_off_the_allow_list_is_never_fetched() {
        for raw in ["http://127.0.0.1:1400/a", "http://localhost:1400/a", "http://8.8.8.8:1400/a", "https://evil.example/a", "https://i.scdn.co.evil.example/a", "/getaa?s=1", "ftp://10.0.0.1:1400/a"] {
            let c = cache();
            assert_eq!(art_cached(&c, Some(raw), |_| panic!("fetched {raw}")), None, "{raw}");
        }
    }

    #[test]
    fn the_fetch_is_handed_the_rebuilt_address_not_the_raw_text() {
        let c = cache();
        let seen = std::cell::RefCell::new(String::new());
        let _ = art_cached(&c, Some("HTTP://192.168.4.20:1400?s=1"), |u| { *seen.borrow_mut() = u.to_string(); Err(Failure { kind: Kind::NoAnswer, status: 0 }) });
        assert_eq!(*seen.borrow(), "http://192.168.4.20:1400/?s=1");
    }
}
