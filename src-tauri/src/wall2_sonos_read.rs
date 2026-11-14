//! The sound service's summary reads, classified. A failed read is one of three kinds
//! (see `wall2_sonos_log::Kind`): `timed-out` (the agent's time limit passed), `no-answer`
//! (no connection, or it was reset), `bad-answer` (a status other than success, an
//! unreadable, oversize or non-JSON body). Only the kind and an HTTP status number leave
//! this module; the body and the address never do. Each read is timed so a failed or slow
//! one can be written to `wall2-sonos.log`.

use crate::wall2_sonos_log::{self as log, Event, Kind, Read};
use serde_json::Value;
use std::io::Read as _;
use std::time::Instant;

/// The largest body one read accepts (the same limit the other feeds use).
const MAX_BODY: u64 = 1_000_000;
/// A successful read slower than this is written to the log as `slow`.
const SLOW_MS: u128 = 2_000;

/// The seven reads, in the order of their answers. The first three are required.
const READS: [(Read, &str); 7] = [
    (Read::Status, "/api/status"),
    (Read::Speakers, "/api/speakers"),
    (Read::Routines, "/api/routines"),
    (Read::Groups, "/api/groups"),
    (Read::Presets, "/api/group-presets"),
    (Read::Scenes, "/api/scenes"),
    (Read::Timers, "/api/sleep-timers"),
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

/// The answers of the seven reads in order, run side by side, so a slow service costs one
/// time limit, not seven. The three required reads failing fails the whole read with the
/// first failed one's kind; a failed optional read answers null.
pub(crate) fn read_seven(agent: &ureq::Agent, base: &str) -> Result<Vec<Value>, Kind> {
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

    fn seven(mut first: Vec<Timed>) -> Vec<Timed> {
        while first.len() < 7 { first.push(ok(5)); }
        first
    }

    #[test]
    fn each_failure_and_a_slow_success_earn_their_line() {
        assert_eq!(log_lines(&seven(vec![bad(Kind::TimedOut, 0, 4003)])), ["failed status timed-out 0 4003\n"]);
        assert_eq!(log_lines(&seven(vec![ok(5), bad(Kind::NoAnswer, 0, 9)])), ["failed speakers no-answer 0 9\n"]);
        assert_eq!(log_lines(&seven(vec![ok(5), ok(5), bad(Kind::BadAnswer, 503, 70)])), ["failed routines bad-answer 503 70\n"]);
        assert_eq!(log_lines(&seven(vec![ok(2310)])), ["slow status none 200 2310\n"]);
        assert!(log_lines(&seven(vec![ok(2000)])).is_empty());
        assert!(log_lines(&seven(vec![])).is_empty());
    }

    #[test]
    fn every_failed_read_is_logged_whether_all_failed_or_only_some() {
        let outage: Vec<Timed> = (0..7).map(|_| bad(Kind::NoAnswer, 0, 3)).collect();
        let lines = log_lines(&outage);
        assert_eq!(lines.len(), 7);
        assert_eq!(lines[3], "failed groups no-answer 0 3\n");
        assert_eq!(lines[6], "failed timers no-answer 0 3\n");
        // Only the required three failed: three lines, none for the four that worked.
        let mut required: Vec<Timed> = (0..3).map(|_| bad(Kind::TimedOut, 0, 4000)).collect();
        required.extend((0..4).map(|_| ok(5)));
        assert_eq!(log_lines(&required).len(), 3);
        let mut degraded = seven(vec![]);
        degraded[5] = bad(Kind::TimedOut, 0, 4001);
        assert_eq!(log_lines(&degraded), ["failed scenes timed-out 0 4001\n"]);
    }

    #[test]
    fn the_seven_reads_answer_or_fail_with_the_first_required_kind() {
        let got = read_seven(&agent(PROMPT_MS), &serve(Serve::Json)).unwrap();
        assert_eq!(got.len(), 7);
        assert_eq!(read_seven(&agent(PROMPT_MS), &serve(Serve::Status(500))).unwrap_err(), Kind::BadAnswer);
        assert_eq!(read_seven(&agent(SHORT_MS), &serve(Serve::Silent)).unwrap_err(), Kind::TimedOut);
        assert_eq!(read_seven(&agent(PROMPT_MS), &serve(Serve::Close)).unwrap_err(), Kind::NoAnswer);
    }
}
