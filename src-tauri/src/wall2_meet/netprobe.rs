//! What the Meet HTTP client can say about a network failure, in fixed words and numbers.
//!
//! `ureq` does not report per-phase timings, so this module adds the parts it can: a
//! resolver wrapper that times the name lookup and remembers which address families came
//! back, and, after a failure only, a one second raw TCP connect to the first IPv4 and the
//! first IPv6 address. Together they separate "the name did not resolve", "no address
//! answered", and "TCP is fine but TLS or the reply stalled". Nothing here ever holds or
//! logs an address, a host name or error text: the log gets the words below and numbers.

use std::collections::HashMap;
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// How long the after-failure TCP probe waits for one address.
pub const PROBE_TIMEOUT: Duration = Duration::from_millis(1000);

/// Outcome of one raw TCP connect, rendered as `none`, `ok<ms>` or `fail<ms>`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Probe {
    None,
    Ok(u32),
    Fail(u32),
}

impl Probe {
    pub fn word(&self) -> String {
        match self {
            Probe::None => "none".to_string(),
            Probe::Ok(ms) => format!("ok{ms}"),
            Probe::Fail(ms) => format!("fail{ms}"),
        }
    }
}

/// The fixed fields a failed call adds to its log line.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NetProbe {
    /// `dns`, `connect`, `tls`, `post-connect` (the client cannot separate the TLS handshake,
    /// the request send and the wait for headers), `headers`, `body` or `other`.
    pub phase: &'static str,
    /// `v4`, `v6`, `both` or `unknown` (no lookup was seen).
    pub af: &'static str,
    /// How many addresses the lookup returned (the client tries them in order).
    pub addrs: u8,
    /// Milliseconds the lookup took, when it ran.
    pub dns_ms: Option<u32>,
    pub v4: Probe,
    pub v6: Probe,
}

impl NetProbe {
    pub fn fields(&self) -> String {
        let dns = self.dns_ms.map(|m| m.to_string()).unwrap_or_else(|| "none".to_string());
        format!("phase={} addrs={} dns-ms={} v4={} v6={}", self.phase, self.addrs, dns, self.v4.word(), self.v6.word())
    }
}

/// The fields for a call with no probe (a reply arrived, or a test double).
pub const NO_PROBE_FIELDS: &str = "phase=none addrs=0 dns-ms=none v4=none v6=none";

/// What the client reported, narrowed to what the phase needs.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Stage {
    Dns,
    Connect,
    Io,
    Reply,
    Other,
}

/// Which phase failed. `io` is the kind of the I/O error under the client error.
pub fn phase_for(stage: Stage, io: Option<std::io::ErrorKind>) -> &'static str {
    use std::io::ErrorKind as K;
    match (stage, io) {
        (Stage::Dns, _) => "dns",
        (Stage::Connect, _) => "connect",
        (Stage::Reply, _) => "headers",
        (Stage::Io, Some(K::InvalidData)) => "tls",
        (Stage::Io, _) => "post-connect",
        (Stage::Other, _) => "other",
    }
}

/// `v4`, `v6`, `both` or `unknown`, from the addresses a lookup returned.
pub fn family_of(addrs: &[SocketAddr]) -> &'static str {
    let v4 = addrs.iter().any(|a| a.is_ipv4());
    let v6 = addrs.iter().any(|a| a.is_ipv6());
    match (v4, v6) {
        (true, true) => "both",
        (true, false) => "v4",
        (false, true) => "v6",
        _ => "unknown",
    }
}

#[derive(Clone, Default)]
struct Seen {
    dns_ms: Option<u32>,
    addrs: Vec<SocketAddr>,
}

fn seen() -> &'static Mutex<HashMap<String, Seen>> {
    static SEEN: std::sync::OnceLock<Mutex<HashMap<String, Seen>>> = std::sync::OnceLock::new();
    SEEN.get_or_init(|| Mutex::new(HashMap::new()))
}

fn record(netloc: &str, dns_ms: u32, addrs: Vec<SocketAddr>) {
    // A global map, not a thread local: the client may resolve on a helper thread.
    let mut map = seen().lock().unwrap_or_else(|e| e.into_inner());
    if map.len() < 8 || map.contains_key(netloc) {
        map.insert(netloc.to_string(), Seen { dns_ms: Some(dns_ms), addrs });
    }
}

/// The standard lookup, timed; the result is remembered for the next failure report.
#[derive(Debug)]
pub struct TimedResolver;

impl ureq::Resolver for TimedResolver {
    fn resolve(&self, netloc: &str) -> std::io::Result<Vec<SocketAddr>> {
        let began = Instant::now();
        let result = netloc.to_socket_addrs().map(|i| i.collect::<Vec<_>>());
        let ms = began.elapsed().as_millis().min(u32::MAX as u128) as u32;
        record(netloc, ms, result.as_ref().map(|v| v.clone()).unwrap_or_default());
        result
    }
}

fn connect_probe(addr: Option<SocketAddr>) -> Probe {
    let Some(addr) = addr else { return Probe::None };
    let began = Instant::now();
    let ok = TcpStream::connect_timeout(&addr, PROBE_TIMEOUT).is_ok();
    let ms = began.elapsed().as_millis().min(u32::MAX as u128) as u32;
    if ok { Probe::Ok(ms) } else { Probe::Fail(ms) }
}

/// Build the failure fields for a call to `host_prefix` (such as `graph.microsoft.com`).
/// Runs the two TCP probes in parallel (at most one second) when the lookup was seen.
pub fn describe(host_prefix: &str, stage: Stage, io: Option<std::io::ErrorKind>) -> NetProbe {
    let phase = phase_for(stage, io);
    let seen_for = {
        let map = seen().lock().unwrap_or_else(|e| e.into_inner());
        map.iter().find(|(k, _)| k.starts_with(host_prefix)).map(|(_, v)| v.clone())
    };
    let Some(s) = seen_for else {
        return NetProbe { phase, af: "unknown", addrs: 0, dns_ms: None, v4: Probe::None, v6: Probe::None };
    };
    let first4 = s.addrs.iter().copied().find(|a| a.is_ipv4());
    let first6 = s.addrs.iter().copied().find(|a| a.is_ipv6());
    // A name that did not resolve has nothing to probe.
    let (v4, v6) = if stage == Stage::Dns {
        (Probe::None, Probe::None)
    } else {
        let h6 = std::thread::spawn(move || connect_probe(first6));
        let v4 = connect_probe(first4);
        (v4, h6.join().unwrap_or(Probe::None))
    };
    NetProbe { phase, af: family_of(&s.addrs), addrs: s.addrs.len().min(99) as u8, dns_ms: s.dns_ms, v4, v6 }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::ErrorKind as K;

    fn a(s: &str) -> SocketAddr {
        s.parse().unwrap()
    }

    #[test]
    fn phases_come_from_the_stage_and_the_io_kind() {
        assert_eq!(phase_for(Stage::Dns, None), "dns");
        assert_eq!(phase_for(Stage::Connect, Some(K::TimedOut)), "connect");
        assert_eq!(phase_for(Stage::Reply, None), "headers");
        assert_eq!(phase_for(Stage::Io, Some(K::InvalidData)), "tls");
        assert_eq!(phase_for(Stage::Io, Some(K::TimedOut)), "post-connect");
        assert_eq!(phase_for(Stage::Other, None), "other");
    }

    #[test]
    fn family_is_read_from_the_addresses() {
        assert_eq!(family_of(&[]), "unknown");
        assert_eq!(family_of(&[a("192.0.2.1:443")]), "v4");
        assert_eq!(family_of(&[a("[2001:db8::1]:443")]), "v6");
        assert_eq!(family_of(&[a("[2001:db8::1]:443"), a("192.0.2.1:443")]), "both");
    }

    #[test]
    fn fields_are_fixed_words_and_numbers() {
        let p = NetProbe { phase: "post-connect", af: "both", addrs: 4, dns_ms: Some(12), v4: Probe::Ok(30), v6: Probe::Fail(1000) };
        assert_eq!(p.fields(), "phase=post-connect addrs=4 dns-ms=12 v4=ok30 v6=fail1000");
        let none = NetProbe { phase: "dns", af: "unknown", addrs: 0, dns_ms: None, v4: Probe::None, v6: Probe::None };
        assert_eq!(none.fields(), "phase=dns addrs=0 dns-ms=none v4=none v6=none");
        assert_eq!(NO_PROBE_FIELDS, "phase=none addrs=0 dns-ms=none v4=none v6=none");
    }

    #[test]
    fn an_unseen_host_reports_unknown_and_probes_nothing() {
        let p = describe("never-resolved.invalid", Stage::Io, Some(K::TimedOut));
        assert_eq!((p.af, p.addrs, p.dns_ms), ("unknown", 0, None));
        assert_eq!((p.v4, p.v6), (Probe::None, Probe::None));
    }

    #[test]
    fn a_loopback_lookup_is_remembered_and_probed() {
        // Nothing listens on port 1 of the loopback address, so both probes fail fast.
        record("probe-test.invalid:1", 7, vec![a("127.0.0.1:1")]);
        let p = describe("probe-test.invalid", Stage::Connect, None);
        assert_eq!((p.af, p.addrs, p.dns_ms, p.phase), ("v4", 1, Some(7), "connect"));
        assert!(matches!(p.v4, Probe::Fail(_)));
        assert_eq!(p.v6, Probe::None);
    }
}
