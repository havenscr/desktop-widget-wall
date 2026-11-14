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

/// Outcome of one raw TCP connect, rendered as `none`, `skip`, `ok<ms>` or `fail<ms>`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Probe {
    None,
    Ok(u32),
    Fail(u32),
    /// A probe already ran for this host and nothing has reached it since.
    Skip,
}

impl Probe {
    pub fn word(&self) -> String {
        match self {
            Probe::None => "none".to_string(),
            Probe::Ok(ms) => format!("ok{ms}"),
            Probe::Fail(ms) => format!("fail{ms}"),
            Probe::Skip => "skip".to_string(),
        }
    }
}

/// The fixed fields a failed call adds to its log line.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NetProbe {
    /// `dns`, `connect`, `tls`, `post-connect` (the client cannot separate the TLS handshake,
    /// the request send and the wait for headers), `headers`, `body`, `body-size` (a reply over
    /// the size cap, not a network fault) or `other`.
    pub phase: &'static str,
    /// The families the lookup returned: `v4`, `v6`, `both` or `unknown` (no lookup was seen).
    pub af: &'static str,
    /// How many addresses the lookup returned (not how many were tried).
    pub resolved: u8,
    /// Milliseconds the lookup took, when it ran.
    pub dns_ms: Option<u32>,
    pub v4: Probe,
    pub v6: Probe,
    /// Milliseconds the probes took. Never logged; the call's `ms=` is taken without it.
    pub probe_ms: u32,
}

impl NetProbe {
    pub fn fields(&self) -> String {
        let dns = self.dns_ms.map(|m| m.to_string()).unwrap_or_else(|| "none".to_string());
        format!("phase={} resolved={} dns-ms={} v4={} v6={}", self.phase, self.resolved, dns, self.v4.word(), self.v6.word())
    }
}

/// The fields for a call with no probe (a reply arrived, or a test double).
pub const NO_PROBE_FIELDS: &str = "phase=none resolved=0 dns-ms=none v4=none v6=none";

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

/// How long a host stays un-probed after a probe, unless a call to it succeeds first.
pub const REPROBE_AFTER: Duration = Duration::from_secs(600);

#[derive(Clone, Default)]
struct Seen {
    dns_ms: Option<u32>,
    addrs: Vec<SocketAddr>,
}

fn seen() -> &'static Mutex<HashMap<String, Seen>> {
    static SEEN: std::sync::OnceLock<Mutex<HashMap<String, Seen>>> = std::sync::OnceLock::new();
    SEEN.get_or_init(|| Mutex::new(HashMap::new()))
}

/// When each host was last probed. Cleared for a host when a call to it gets any reply.
fn probed() -> &'static Mutex<HashMap<String, Instant>> {
    static PROBED: std::sync::OnceLock<Mutex<HashMap<String, Instant>>> = std::sync::OnceLock::new();
    PROBED.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The host part of `host:port`, lower case. Entries are matched on this, exactly.
fn host_key(netloc: &str) -> String {
    netloc.rsplit_once(':').map(|(h, _)| h).unwrap_or(netloc).to_ascii_lowercase()
}

fn record(netloc: &str, dns_ms: u32, addrs: Vec<SocketAddr>) {
    // A global map, not a thread local: the client may resolve on a helper thread.
    let key = host_key(netloc);
    let mut map = seen().lock().unwrap_or_else(|e| e.into_inner());
    if map.len() < 8 || map.contains_key(&key) {
        map.insert(key, Seen { dns_ms: Some(dns_ms), addrs });
    }
}

/// A call to `host` is starting: forget the last lookup, so a failure never reports an old one.
pub fn begin(host: &str) {
    seen().lock().unwrap_or_else(|e| e.into_inner()).remove(&host_key(host));
}

/// A call to `host` got a reply: the next failure may be probed again.
pub fn reached(host: &str) {
    probed().lock().unwrap_or_else(|e| e.into_inner()).remove(&host_key(host));
}

/// The standard lookup, timed; the result is remembered for the next failure report.
#[derive(Debug)]
pub struct TimedResolver;

pub fn ipv4_first(addrs: Vec<SocketAddr>) -> Vec<SocketAddr> {
    let mut v4 = addrs.iter().copied().filter(SocketAddr::is_ipv4);
    let mut v6 = addrs.iter().copied().filter(SocketAddr::is_ipv6);
    let mut ordered = Vec::with_capacity(4);
    while ordered.len() < 4 {
        let before = ordered.len();
        if let Some(addr) = v4.next() { ordered.push(addr); }
        if ordered.len() < 4 { if let Some(addr) = v6.next() { ordered.push(addr); } }
        if ordered.len() == before { break }
    }
    ordered
}

impl ureq::Resolver for TimedResolver {
    fn resolve(&self, netloc: &str) -> std::io::Result<Vec<SocketAddr>> {
        let began = Instant::now();
        let result = netloc.to_socket_addrs().map(|i| ipv4_first(i.collect::<Vec<_>>()));
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

/// True when `host` was probed less than `REPROBE_AFTER` ago and nothing has reached it since.
fn recently_probed(host: &str, now: Instant) -> bool {
    let map = probed().lock().unwrap_or_else(|e| e.into_inner());
    map.get(&host_key(host)).is_some_and(|at| now.duration_since(*at) < REPROBE_AFTER)
}

/// Build the failure fields for a call to `host` (such as `graph.microsoft.com`).
/// Runs the two TCP probes in parallel (at most one second) when the lookup was seen and
/// the host has not been probed in this outage.
pub fn describe(host: &str, stage: Stage, io: Option<std::io::ErrorKind>) -> NetProbe {
    let phase = phase_for(stage, io);
    let seen_for = seen().lock().unwrap_or_else(|e| e.into_inner()).get(&host_key(host)).cloned();
    let Some(s) = seen_for else {
        return NetProbe { phase, af: "unknown", resolved: 0, dns_ms: None, v4: Probe::None, v6: Probe::None, probe_ms: 0 };
    };
    let first4 = s.addrs.iter().copied().find(|a| a.is_ipv4());
    let first6 = s.addrs.iter().copied().find(|a| a.is_ipv6());
    let began = Instant::now();
    // A name that did not resolve has nothing to probe.
    let (v4, v6) = if stage == Stage::Dns {
        (Probe::None, Probe::None)
    } else if recently_probed(host, began) {
        (Probe::Skip, Probe::Skip)
    } else {
        probed().lock().unwrap_or_else(|e| e.into_inner()).insert(host_key(host), began);
        let h6 = std::thread::spawn(move || connect_probe(first6));
        let v4 = connect_probe(first4);
        (v4, h6.join().unwrap_or(Probe::None))
    };
    let probe_ms = began.elapsed().as_millis().min(u32::MAX as u128) as u32;
    NetProbe { phase, af: family_of(&s.addrs), resolved: s.addrs.len().min(99) as u8, dns_ms: s.dns_ms, v4, v6, probe_ms }
}

/// The words and digit patterns the new log fields may hold. Anything else is a bug.
#[cfg(test)]
pub fn fields_are_well_formed(fields: &str) -> bool {
    let digits = |v: &str, max: usize| !v.is_empty() && v.len() <= max && v.chars().all(|c| c.is_ascii_digit());
    let parts: Vec<&str> = fields.split(' ').collect();
    let keys = ["phase", "resolved", "dns-ms", "v4", "v6"];
    if parts.len() != 5 {
        return false;
    }
    let mut vals = Vec::new();
    for (p, k) in parts.iter().zip(keys) {
        match p.strip_prefix(k).and_then(|r| r.strip_prefix('=')) {
            Some(v) => vals.push(v),
            None => return false,
        }
    }
    let probe_ok = |v: &str| v == "none" || v == "skip" || v.strip_prefix("ok").is_some_and(|d| digits(d, 10)) || v.strip_prefix("fail").is_some_and(|d| digits(d, 10));
    ["dns", "connect", "tls", "post-connect", "headers", "body", "body-size", "other", "none"].contains(&vals[0])
        && digits(vals[1], 2)
        && (vals[2] == "none" || digits(vals[2], 10))
        && probe_ok(vals[3])
        && probe_ok(vals[4])
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::ErrorKind as K;

    fn a(s: &str) -> SocketAddr {
        s.parse().unwrap()
    }

    #[test]
    fn resolver_order_gives_ipv4_the_first_bounded_connect_attempt() {
        let ordered = ipv4_first(vec![a("[2001:db8::1]:443"), a("192.0.2.1:443"), a("[2001:db8::2]:443"), a("192.0.2.2:443"), a("192.0.2.3:443")]);
        assert!(ordered[0].is_ipv4());
        assert_eq!(ordered.len(), 4);
        assert!(ordered.windows(2).all(|pair| pair[0].is_ipv4() != pair[1].is_ipv4()));
        // ureq 2.12.1 stream.rs halves the remaining 5 second connect deadline when
        // several addresses exist, so the first IPv4 address receives 2.5 seconds.
        assert!(crate::wall2_meet::graph::CONNECT_TIMEOUT / 2 >= Duration::from_secs(2));
    }

    fn np(phase: &'static str, af: &'static str, resolved: u8, dns_ms: Option<u32>, v4: Probe, v6: Probe) -> NetProbe {
        NetProbe { phase, af, resolved, dns_ms, v4, v6, probe_ms: 0 }
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
        let p = np("post-connect", "both", 4, Some(12), Probe::Ok(30), Probe::Fail(1000));
        assert_eq!(p.fields(), "phase=post-connect resolved=4 dns-ms=12 v4=ok30 v6=fail1000");
        let none = np("dns", "unknown", 0, None, Probe::None, Probe::None);
        assert_eq!(none.fields(), "phase=dns resolved=0 dns-ms=none v4=none v6=none");
        assert_eq!(np("body-size", "unknown", 0, None, Probe::Skip, Probe::Skip).fields(), "phase=body-size resolved=0 dns-ms=none v4=skip v6=skip");
        assert_eq!(NO_PROBE_FIELDS, "phase=none resolved=0 dns-ms=none v4=none v6=none");
    }

    #[test]
    fn every_field_value_is_a_listed_word_or_a_digit_pattern() {
        for phase in ["dns", "connect", "tls", "post-connect", "headers", "body", "body-size", "other"] {
            for p in [Probe::None, Probe::Skip, Probe::Ok(0), Probe::Ok(1000), Probe::Fail(4294967295)] {
                let f = np(phase, "both", 99, Some(u32::MAX), p, p).fields();
                assert!(fields_are_well_formed(&f), "{f}");
            }
        }
        assert!(fields_are_well_formed(NO_PROBE_FIELDS));
        // Free text cannot be placed in any field: these are all refused.
        for bad in [
            "phase=evil.example resolved=1 dns-ms=1 v4=none v6=none",
            "phase=dns resolved=1.2.3.4 dns-ms=1 v4=none v6=none",
            "phase=dns resolved=1 dns-ms=a@b v4=none v6=none",
            "phase=dns resolved=1 dns-ms=1 v4=ok1.2 v6=none",
            "phase=dns resolved=1 dns-ms=1 v4=none v6=fail",
            "phase=dns resolved=123 dns-ms=1 v4=none v6=none",
            "phase=dns resolved=1 dns-ms=1 v4=none",
        ] {
            assert!(!fields_are_well_formed(bad), "{bad}");
        }
    }

    #[test]
    fn an_unseen_host_reports_unknown_and_probes_nothing() {
        let p = describe("never-resolved.invalid", Stage::Io, Some(K::TimedOut));
        assert_eq!((p.af, p.resolved, p.dns_ms), ("unknown", 0, None));
        assert_eq!((p.v4, p.v6), (Probe::None, Probe::None));
    }

    #[test]
    fn a_loopback_lookup_is_remembered_and_probed_once_per_outage() {
        // Nothing listens on port 1 of the loopback address, so the probe fails fast.
        record("probe-test.invalid:443", 7, vec![a("127.0.0.1:1")]);
        let p = describe("probe-test.invalid", Stage::Connect, None);
        assert_eq!((p.af, p.resolved, p.dns_ms, p.phase), ("v4", 1, Some(7), "connect"));
        assert!(matches!(p.v4, Probe::Fail(_)));
        assert_eq!(p.v6, Probe::None);
        // A second failure in the same outage is not probed again.
        let again = describe("probe-test.invalid", Stage::Connect, None);
        assert_eq!((again.v4, again.v6), (Probe::Skip, Probe::Skip));
        assert!(fields_are_well_formed(&again.fields()));
        // A call that got a reply ends the outage: the next failure is probed.
        reached("probe-test.invalid:443");
        let third = describe("probe-test.invalid", Stage::Connect, None);
        assert!(matches!(third.v4, Probe::Fail(_)));
    }

    #[test]
    fn begin_forgets_the_last_lookup_and_the_host_match_is_exact() {
        record("exact-test.invalid:443", 3, vec![a("127.0.0.1:1")]);
        // A different host that merely starts the same does not see this entry.
        assert_eq!(describe("exact-test.invalid.evil", Stage::Io, None).af, "unknown");
        assert_eq!(describe("exact", Stage::Io, None).af, "unknown");
        begin("exact-test.invalid:443");
        assert_eq!(describe("exact-test.invalid", Stage::Io, None).af, "unknown");
    }

    #[test]
    fn the_host_key_drops_the_port_and_the_case() {
        assert_eq!(host_key("Graph.Microsoft.com:443"), "graph.microsoft.com");
        assert_eq!(host_key("graph.microsoft.com"), "graph.microsoft.com");
    }
}
