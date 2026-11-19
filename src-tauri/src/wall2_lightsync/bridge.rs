//! The Hue bridge over HTTPS from the wall: a pinned TLS config, pairing, the app id, the area
//! start and stop calls, and the facts read from the home app.
//!
//! Pinning matches the home app's `lib/hue-tls.js`: the chain must verify against the two Hue
//! root CAs (nothing else is trusted) and the certificate subject CN must equal the bridge id the
//! home app gave. Every error that leaves this module is one fixed word; no key, client key or
//! address is ever put in an error, a log or an answer.

use serde_json::{json, Value};
use std::net::IpAddr;
use std::sync::Arc;

pub(crate) const LINK_NOT_PRESSED: &str = "link-not-pressed";
pub(crate) const UNREACHABLE: &str = "bridge-unreachable";
pub(crate) const CERT: &str = "cert";
pub(crate) const BUSY: &str = "busy";
pub(crate) const FAILED: &str = "failed";

/// How long pairing waits for the link button: one try every 2 s, 16 tries (0 to 30 s).
pub(crate) const POLL_TRIES: u32 = 16;
pub(crate) const POLL_EVERY: std::time::Duration = std::time::Duration::from_secs(2);
const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);
const MAX_BODY: u64 = 256 * 1024;

/// The two Hue roots, copied from `home-orchestrator/lib/hue-tls.js` (root-bridge, Hue Root CA 01).
pub(crate) const HUE_ROOT_CAS: [&str; 2] = [
    "-----BEGIN CERTIFICATE-----\nMIICMjCCAdigAwIBAgIUO7FSLbaxikuXAljzVaurLXWmFw4wCgYIKoZIzj0EAwIw\nOTELMAkGA1UEBhMCTkwxFDASBgNVBAoMC1BoaWxpcHMgSHVlMRQwEgYDVQQDDAty\nb290LWJyaWRnZTAiGA8yMDE3MDEwMTAwMDAwMFoYDzIwMzgwMTE5MDMxNDA3WjA5\nMQswCQYDVQQGEwJOTDEUMBIGA1UECgwLUGhpbGlwcyBIdWUxFDASBgNVBAMMC3Jv\nb3QtYnJpZGdlMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEjNw2tx2AplOf9x86\naTdvEcL1FU65QDxziKvBpW9XXSIcibAeQiKxegpq8Exbr9v6LBnYbna2VcaK0G22\njOKkTqOBuTCBtjAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBhjAdBgNV\nHQ4EFgQUZ2ONTFrDT6o8ItRnKfqWKnHFGmQwdAYDVR0jBG0wa4AUZ2ONTFrDT6o8\nItRnKfqWKnHFGmShPaQ7MDkxCzAJBgNVBAYTAk5MMRQwEgYDVQQKDAtQaGlsaXBz\nIEh1ZTEUMBIGA1UEAwwLcm9vdC1icmlkZ2WCFDuxUi22sYpLlwJY81Wrqy11phcO\nMAoGCCqGSM49BAMCA0gAMEUCIEBYYEOsa07TH7E5MJnGw557lVkORgit2Rm1h3B2\nsFgDAiEA1Fj/C3AN5psFMjo0//mrQebo0eKd3aWRx+pQY08mk48=\n-----END CERTIFICATE-----\n",
    "-----BEGIN CERTIFICATE-----\nMIIBzDCCAXOgAwIBAgICEAAwCgYIKoZIzj0EAwIwPDELMAkGA1UEBhMCTkwxFDAS\nBgNVBAoMC1NpZ25pZnkgSHVlMRcwFQYDVQQDDA5IdWUgUm9vdCBDQSAwMTAgFw0y\nNTAyMjUwMDAwMDBaGA8yMDUwMTIzMTIzNTk1OVowPDELMAkGA1UEBhMCTkwxFDAS\nBgNVBAoMC1NpZ25pZnkgSHVlMRcwFQYDVQQDDA5IdWUgUm9vdCBDQSAwMTBZMBMG\nByqGSM49AgEGCCqGSM49AwEHA0IABFfOO0jfSAUXGQ9kjEDzyBrcMQ3ItyA5krE+\ncyvb1Y3xFti7KlAad8UOnAx0FBLn7HZrlmIwm1QnX0fK3LPM13mjYzBhMB0GA1Ud\nDgQWBBTF1pSpsCASX/z0VHLigxU2CAaqoTAfBgNVHSMEGDAWgBTF1pSpsCASX/z0\nVHLigxU2CAaqoTAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjAKBggq\nhkjOPQQDAgNHADBEAiAk7duT+IHbOGO4UUuGLAEpyYejGZK9Z7V9oSfnvuQ5BQIg\nIYSgwwxHXm73/JgcU9lAM6c8Bmu3UE3kBIUwBs1qXFw=\n-----END CERTIFICATE-----\n",
];

// Section: the pinned verifier

fn pem_to_der(pem: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    let body: String = pem.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with("-----")).collect();
    base64::engine::general_purpose::STANDARD.decode(body).ok()
}

pub(crate) fn roots_from(pems: &[&str]) -> Option<rustls::RootCertStore> {
    let mut store = rustls::RootCertStore::empty();
    for pem in pems {
        let der = pem_to_der(pem)?;
        store.add(rustls::pki_types::CertificateDer::from(der)).ok()?;
    }
    Some(store)
}

/// One DER element: tag, content, what follows.
fn tlv(b: &[u8]) -> Option<(u8, &[u8], &[u8])> {
    let tag = *b.first()?;
    let l0 = *b.get(1)? as usize;
    let (len, off) = if l0 < 0x80 {
        (l0, 2)
    } else {
        let n = l0 & 0x7f;
        if n == 0 || n > 4 {
            return None;
        }
        let mut l = 0usize;
        for i in 0..n {
            l = (l << 8) | *b.get(2 + i)? as usize;
        }
        (l, 2 + n)
    };
    let end = off.checked_add(len)?;
    Some((tag, b.get(off..end)?, b.get(end..)?))
}

/// The subject common name of a DER certificate (the first one, when there are several).
pub(crate) fn subject_cn(der: &[u8]) -> Option<String> {
    let (_, cert, _) = tlv(der)?;
    let (_, tbs, _) = tlv(cert)?;
    let mut rest = tbs;
    let (tag, _, after) = tlv(rest)?;
    if tag == 0xA0 {
        rest = after; // explicit version
    }
    let (_, _, r) = tlv(rest)?; // serial
    let (_, _, r) = tlv(r)?; // signature algorithm
    let (_, _, r) = tlv(r)?; // issuer
    let (_, _, r) = tlv(r)?; // validity
    let (_, subject, _) = tlv(r)?;
    let mut rdns = subject;
    while !rdns.is_empty() {
        let (_, set, next) = tlv(rdns)?;
        rdns = next;
        let mut atvs = set;
        while !atvs.is_empty() {
            let (_, atv, more) = tlv(atvs)?;
            atvs = more;
            let (tag, oid, value) = tlv(atv)?;
            if tag == 0x06 && oid == [0x55, 0x04, 0x03] {
                let (_, text, _) = tlv(value)?;
                return String::from_utf8(text.to_vec()).ok();
            }
        }
    }
    None
}

/// Whether the certificate's CN is the bridge id (case does not matter).
pub(crate) fn cn_matches(der: &[u8], bridge_id: &str) -> bool {
    subject_cn(der).is_some_and(|cn| cn.eq_ignore_ascii_case(bridge_id))
}

/// A Hue bridge id: 16 hex digits.
pub(crate) fn valid_bridge_id(id: &str) -> bool {
    id.len() == 16 && id.chars().all(|c| c.is_ascii_hexdigit())
}

/// Chain checked by the web PKI verifier against the given roots; the host name check (the
/// bridge is reached by IP, and its certificate names the bridge id in the CN only) is replaced
/// by the CN pin. Only the name error is tolerated: every other chain error is an error.
#[derive(Debug)]
pub(crate) struct HuePin {
    inner: Arc<rustls::client::WebPkiServerVerifier>,
    want: String,
}

impl HuePin {
    pub(crate) fn new(roots: rustls::RootCertStore, bridge_id: &str) -> Option<HuePin> {
        if !valid_bridge_id(bridge_id) {
            return None;
        }
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let inner = rustls::client::WebPkiServerVerifier::builder_with_provider(Arc::new(roots), provider).build().ok()?;
        Some(HuePin { inner, want: bridge_id.to_ascii_uppercase() })
    }
}

impl rustls::client::danger::ServerCertVerifier for HuePin {
    fn verify_server_cert(
        &self,
        end_entity: &rustls::pki_types::CertificateDer<'_>,
        intermediates: &[rustls::pki_types::CertificateDer<'_>],
        server_name: &rustls::pki_types::ServerName<'_>,
        ocsp_response: &[u8],
        now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        use rustls::{CertificateError, Error};
        match self.inner.verify_server_cert(end_entity, intermediates, server_name, ocsp_response, now) {
            Ok(_) => {}
            Err(Error::InvalidCertificate(CertificateError::NotValidForName | CertificateError::NotValidForNameContext { .. })) => {}
            Err(e) => return Err(e),
        }
        if cn_matches(end_entity.as_ref(), &self.want) {
            Ok(rustls::client::danger::ServerCertVerified::assertion())
        } else {
            Err(Error::InvalidCertificate(CertificateError::NotValidForName))
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        self.inner.verify_tls12_signature(message, cert, dss)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        self.inner.verify_tls13_signature(message, cert, dss)
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.inner.supported_verify_schemes()
    }
}

/// The TLS config for one bridge: the Hue roots and the CN pin.
pub(crate) fn pinned_config(bridge_id: &str) -> Option<Arc<rustls::ClientConfig>> {
    let pin = HuePin::new(roots_from(&HUE_ROOT_CAS)?, bridge_id)?;
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .ok()?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(pin))
        .with_no_client_auth();
    Some(Arc::new(config))
}

// Section: the network seam

pub(crate) struct Reply {
    pub code: u16,
    pub body: Vec<u8>,
    /// The `hue-application-id` header, when the answer carried one.
    pub app_id: Option<String>,
}

#[derive(Debug, PartialEq)]
pub(crate) enum NetFail {
    Down,
    Cert,
    TooBig,
}

pub(crate) trait BridgeNet {
    fn send(&self, method: &str, path: &str, key: Option<&str>, body: Option<&str>) -> Result<Reply, NetFail>;
}

pub(crate) struct PinnedNet {
    agent: ureq::Agent,
    host: String,
}

/// Whether a bridge address from the home app may be used: a LAN or loopback address, never a public one.
pub(crate) fn lan_address(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(a) => a.is_private() || a.is_loopback() || a.is_link_local(),
        IpAddr::V6(a) => a.is_loopback(),
    }
}

impl PinnedNet {
    pub(crate) fn new(ip: IpAddr, bridge_id: &str) -> Option<PinnedNet> {
        if !lan_address(&ip) {
            return None;
        }
        let agent = ureq::AgentBuilder::new().tls_config(pinned_config(bridge_id)?).timeout(TIMEOUT).redirects(0).build();
        let host = match ip {
            IpAddr::V4(a) => a.to_string(),
            IpAddr::V6(a) => format!("[{a}]"),
        };
        Some(PinnedNet { agent, host })
    }
}

/// Whether the failure behind a transport error is a certificate the pin refused.
fn is_cert_failure(err: &(dyn std::error::Error + 'static)) -> bool {
    let mut cur: Option<&(dyn std::error::Error + 'static)> = Some(err);
    while let Some(e) = cur {
        if let Some(r) = e.downcast_ref::<rustls::Error>() {
            return matches!(r, rustls::Error::InvalidCertificate(_));
        }
        if let Some(io) = e.downcast_ref::<std::io::Error>() {
            if let Some(inner) = io.get_ref() {
                if let Some(r) = inner.downcast_ref::<rustls::Error>() {
                    return matches!(r, rustls::Error::InvalidCertificate(_));
                }
            }
        }
        cur = e.source();
    }
    false
}

impl BridgeNet for PinnedNet {
    fn send(&self, method: &str, path: &str, key: Option<&str>, body: Option<&str>) -> Result<Reply, NetFail> {
        use std::io::Read;
        let mut req = self.agent.request(method, &format!("https://{}{}", self.host, path)).set("Accept", "application/json");
        if let Some(k) = key {
            req = req.set("hue-application-key", k);
        }
        let result = match body {
            Some(b) => req.set("Content-Type", "application/json").send_string(b),
            None => req.call(),
        };
        let resp = match result {
            Ok(r) => r,
            Err(ureq::Error::Status(_, r)) => r,
            Err(ureq::Error::Transport(t)) => return Err(if is_cert_failure(&t) { NetFail::Cert } else { NetFail::Down }),
        };
        let code = resp.status();
        let app_id = resp.header("hue-application-id").map(str::to_string);
        let mut buf = Vec::new();
        resp.into_reader().take(MAX_BODY + 1).read_to_end(&mut buf).map_err(|_| NetFail::Down)?;
        if buf.len() as u64 > MAX_BODY {
            return Err(NetFail::TooBig);
        }
        Ok(Reply { code, body: buf, app_id })
    }
}

fn word_for(f: NetFail) -> &'static str {
    match f {
        NetFail::Cert => CERT,
        NetFail::Down | NetFail::TooBig => UNREACHABLE,
    }
}

// Section: pairing

#[derive(Debug, PartialEq)]
pub(crate) enum Register {
    Paired { username: String, clientkey: String },
    LinkNotPressed,
}

/// The body of the registration call.
pub(crate) const REGISTER_BODY: &str = r#"{"devicetype":"widget_wall#desk","generateclientkey":true}"#;

/// One registration try: `POST /api`. Error 101 is the link button not pressed yet.
pub(crate) fn register_once(net: &dyn BridgeNet) -> Result<Register, &'static str> {
    let reply = net.send("POST", "/api", None, Some(REGISTER_BODY)).map_err(word_for)?;
    let body: Value = serde_json::from_slice(&reply.body).map_err(|_| UNREACHABLE)?;
    let first = body.as_array().and_then(|a| a.first()).ok_or(UNREACHABLE)?;
    if let Some(s) = first.get("success") {
        let text = |k: &str| s.get(k).and_then(Value::as_str).map(str::to_string);
        return match (text("username"), text("clientkey")) {
            (Some(username), Some(clientkey)) => Ok(Register::Paired { username, clientkey }),
            _ => Err(UNREACHABLE),
        };
    }
    if first.pointer("/error/type").and_then(Value::as_i64) == Some(101) {
        return Ok(Register::LinkNotPressed);
    }
    Err(UNREACHABLE)
}

/// Tries until the link button is pressed or the tries run out; `wait` sits between tries and answers false
/// once the pairing deadline has passed, which ends the poll even when slow replies ate the tries' time.
pub(crate) fn pair_poll(net: &dyn BridgeNet, tries: u32, wait: &mut dyn FnMut() -> bool) -> Result<(String, String), &'static str> {
    for i in 0..tries {
        match register_once(net)? {
            Register::Paired { username, clientkey } => return Ok((username, clientkey)),
            Register::LinkNotPressed => {
                if i + 1 < tries && !wait() {
                    break;
                }
            }
        }
    }
    Err(LINK_NOT_PRESSED)
}

/// The whole pairing poll ends 30 s after it starts.
pub(crate) const POLL_DEADLINE: std::time::Duration = std::time::Duration::from_secs(30);

/// The application id (the DTLS PSK identity): `GET /auth/v1` answers it in a header.
pub(crate) fn read_app_id(net: &dyn BridgeNet, username: &str) -> Result<String, &'static str> {
    let reply = net.send("GET", "/auth/v1", Some(username), None).map_err(word_for)?;
    match reply.app_id {
        Some(id) if (200..300).contains(&reply.code) && !id.is_empty() && id.len() <= 128 && id.chars().all(|c| c.is_ascii_graphic()) => Ok(id),
        _ => Err(UNREACHABLE),
    }
}

// Section: area start and stop (used by the stream, 41-4)

/// The body of an area action: `start` or `stop`.
pub(crate) fn action_body(action: &str) -> Option<String> {
    matches!(action, "start" | "stop").then(|| json!({ "action": action }).to_string())
}

pub(crate) fn valid_area_id(id: &str) -> bool {
    id.len() == 36 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

pub(crate) fn area_action(net: &dyn BridgeNet, key: &str, area_id: &str, action: &str) -> Result<(), &'static str> {
    let body = action_body(action).ok_or(FAILED)?;
    if !valid_area_id(area_id) {
        return Err(FAILED);
    }
    let path = format!("/clip/v2/resource/entertainment_configuration/{area_id}");
    let reply = net.send("PUT", &path, Some(key), Some(&body)).map_err(word_for)?;
    if (200..300).contains(&reply.code) {
        Ok(())
    } else {
        Err(FAILED)
    }
}

/// Whether the area is streaming right now (`status` is `active`), from `GET .../entertainment_configuration/{id}`.
pub(crate) fn area_active(net: &dyn BridgeNet, key: &str, area_id: &str) -> Result<bool, &'static str> {
    if !valid_area_id(area_id) {
        return Err(FAILED);
    }
    let path = format!("/clip/v2/resource/entertainment_configuration/{area_id}");
    let reply = net.send("GET", &path, Some(key), None).map_err(word_for)?;
    if !(200..300).contains(&reply.code) {
        return Err(FAILED);
    }
    let v: Value = serde_json::from_slice(&reply.body).map_err(|_| FAILED)?;
    let status = v.pointer("/data/0/status").and_then(Value::as_str).ok_or(FAILED)?;
    Ok(status == "active")
}

// Section: facts from the home app

/// What the home app says about the bridge: the address and the id (for the pin).
#[derive(Debug, PartialEq)]
pub(crate) struct Facts {
    pub ip: IpAddr,
    pub bridge_id: String,
}

pub(crate) trait FactsHttp {
    /// A GET; the optional token goes only as the `X-Desk-Token` header.
    fn get(&self, url: &str, token: Option<&str>) -> Result<(u16, Vec<u8>), ()>;
}

pub(crate) struct RealFacts;

impl FactsHttp for RealFacts {
    fn get(&self, url: &str, token: Option<&str>) -> Result<(u16, Vec<u8>), ()> {
        use std::io::Read;
        let mut req = crate::wall2_feeds::agent().get(url).set("Accept", "application/json");
        if let Some(t) = token {
            req = req.set("X-Desk-Token", t);
        }
        let resp = match req.call() {
            Ok(r) => r,
            Err(ureq::Error::Status(_, r)) => r,
            Err(ureq::Error::Transport(_)) => return Err(()),
        };
        let code = resp.status();
        let mut buf = Vec::new();
        resp.into_reader().take(MAX_BODY + 1).read_to_end(&mut buf).map_err(|_| ())?;
        if buf.len() as u64 > MAX_BODY {
            return Err(());
        }
        Ok((code, buf))
    }
}

/// `GET {base}/api/desk/office/lightsync`. The token goes along only to a base it may go to.
pub(crate) fn read_facts(http: &dyn FactsHttp, base: &str, token: Option<&str>) -> Result<Facts, &'static str> {
    let token = token.filter(|_| crate::wall2_desk::token_may_go_to(base));
    let (code, body) = http.get(&format!("{base}/api/desk/office/lightsync"), token).map_err(|_| UNREACHABLE)?;
    if !(200..300).contains(&code) {
        return Err(UNREACHABLE);
    }
    shape_facts(&serde_json::from_slice::<Value>(&body).map_err(|_| UNREACHABLE)?).ok_or(UNREACHABLE)
}

pub(crate) fn shape_facts(v: &Value) -> Option<Facts> {
    if v.get("ok").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    let ip: IpAddr = v.pointer("/bridge/ip")?.as_str()?.trim().parse().ok()?;
    let id = v.pointer("/bridge/id")?.as_str()?.trim();
    if !lan_address(&ip) || !valid_bridge_id(id) {
        return None;
    }
    Some(Facts { ip, bridge_id: id.to_ascii_uppercase() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::VecDeque;

    type Sent = (String, String, Option<String>, Option<String>);

    #[derive(Default)]
    struct FakeNet {
        replies: RefCell<VecDeque<Result<Reply, NetFail>>>,
        sent: RefCell<Vec<Sent>>,
    }

    impl FakeNet {
        fn with(replies: Vec<Result<Reply, NetFail>>) -> FakeNet {
            FakeNet { replies: RefCell::new(replies.into()), sent: RefCell::default() }
        }
    }

    impl BridgeNet for FakeNet {
        fn send(&self, method: &str, path: &str, key: Option<&str>, body: Option<&str>) -> Result<Reply, NetFail> {
            self.sent.borrow_mut().push((method.into(), path.into(), key.map(Into::into), body.map(Into::into)));
            self.replies.borrow_mut().pop_front().unwrap_or(Err(NetFail::Down))
        }
    }

    fn json_reply(code: u16, body: &str) -> Result<Reply, NetFail> {
        Ok(Reply { code, body: body.as_bytes().to_vec(), app_id: None })
    }

    const NOT_PRESSED: &str = r#"[{"error":{"type":101,"address":"","description":"link button not pressed"}}]"#;
    const SUCCESS: &str = r#"[{"success":{"username":"user-secret-1","clientkey":"CLIENTKEY-SECRET-1"}}]"#;

    #[test]
    fn register_answers() {
        assert_eq!(register_once(&FakeNet::with(vec![json_reply(200, NOT_PRESSED)])), Ok(Register::LinkNotPressed));
        assert_eq!(
            register_once(&FakeNet::with(vec![json_reply(200, SUCCESS)])),
            Ok(Register::Paired { username: "user-secret-1".into(), clientkey: "CLIENTKEY-SECRET-1".into() })
        );
        assert_eq!(register_once(&FakeNet::with(vec![json_reply(200, "{}")])), Err(UNREACHABLE));
        assert_eq!(register_once(&FakeNet::with(vec![json_reply(200, r#"[{"success":{"username":"u"}}]"#)])), Err(UNREACHABLE));
        assert_eq!(register_once(&FakeNet::with(vec![Err(NetFail::Cert)])), Err(CERT));
        assert_eq!(register_once(&FakeNet::with(vec![Err(NetFail::Down)])), Err(UNREACHABLE));
    }

    #[test]
    fn register_sends_the_pinned_body_and_no_key() {
        let net = FakeNet::with(vec![json_reply(200, SUCCESS)]);
        register_once(&net).unwrap();
        let sent = net.sent.borrow();
        assert_eq!(sent[0].0, "POST");
        assert_eq!(sent[0].1, "/api");
        assert_eq!(sent[0].2, None);
        let body: Value = serde_json::from_str(sent[0].3.as_deref().unwrap()).unwrap();
        assert_eq!(body, json!({ "devicetype": "widget_wall#desk", "generateclientkey": true }));
    }

    #[test]
    fn poll_waits_then_pairs() {
        let net = FakeNet::with(vec![json_reply(200, NOT_PRESSED), json_reply(200, NOT_PRESSED), json_reply(200, SUCCESS)]);
        let mut waits = 0;
        let got = pair_poll(&net, POLL_TRIES, &mut || { waits += 1; true });
        assert_eq!(got, Ok(("user-secret-1".to_string(), "CLIENTKEY-SECRET-1".to_string())));
        assert_eq!(waits, 2);
    }

    #[test]
    fn poll_times_out_with_link_not_pressed() {
        let replies = (0..POLL_TRIES).map(|_| json_reply(200, NOT_PRESSED)).collect();
        let net = FakeNet::with(replies);
        let mut waits = 0;
        assert_eq!(pair_poll(&net, POLL_TRIES, &mut || { waits += 1; true }), Err(LINK_NOT_PRESSED));
        assert_eq!(net.sent.borrow().len() as u32, POLL_TRIES);
        assert_eq!(waits, POLL_TRIES - 1, "no wait after the last try");
    }

    #[test]
    fn poll_stops_on_a_cert_refusal() {
        let net = FakeNet::with(vec![Err(NetFail::Cert), json_reply(200, SUCCESS)]);
        assert_eq!(pair_poll(&net, POLL_TRIES, &mut || true), Err(CERT));
        assert_eq!(net.sent.borrow().len(), 1);
    }

    #[test]
    fn the_poll_stops_when_the_deadline_passes() {
        let replies = (0..POLL_TRIES).map(|_| json_reply(200, NOT_PRESSED)).collect();
        let net = FakeNet::with(replies);
        let mut waits = 0;
        assert_eq!(pair_poll(&net, POLL_TRIES, &mut || { waits += 1; waits < 3 }), Err(LINK_NOT_PRESSED));
        assert_eq!(net.sent.borrow().len(), 3, "no try after the deadline");
    }

    #[test]
    fn app_id_comes_from_the_header() {
        let ok = Reply { code: 200, body: vec![], app_id: Some("app-id-1".into()) };
        let net = FakeNet::with(vec![Ok(ok)]);
        assert_eq!(read_app_id(&net, "user-secret-1"), Ok("app-id-1".to_string()));
        let sent = net.sent.borrow();
        assert_eq!((sent[0].0.as_str(), sent[0].1.as_str(), sent[0].2.as_deref()), ("GET", "/auth/v1", Some("user-secret-1")));
        let none = Reply { code: 200, body: vec![], app_id: None };
        assert_eq!(read_app_id(&FakeNet::with(vec![Ok(none)]), "u"), Err(UNREACHABLE));
        let denied = Reply { code: 403, body: vec![], app_id: Some("x".into()) };
        assert_eq!(read_app_id(&FakeNet::with(vec![Ok(denied)]), "u"), Err(UNREACHABLE));
    }

    #[test]
    fn start_and_stop_request_bodies() {
        let area = "11111111-2222-3333-4444-555555555555";
        let net = FakeNet::with(vec![json_reply(200, "{}"), json_reply(200, "{}")]);
        area_action(&net, "k", area, "start").unwrap();
        area_action(&net, "k", area, "stop").unwrap();
        let sent = net.sent.borrow();
        assert_eq!(sent[0].0, "PUT");
        assert_eq!(sent[0].1, format!("/clip/v2/resource/entertainment_configuration/{area}"));
        assert_eq!(sent[0].2.as_deref(), Some("k"));
        assert_eq!(serde_json::from_str::<Value>(sent[0].3.as_deref().unwrap()).unwrap(), json!({ "action": "start" }));
        assert_eq!(serde_json::from_str::<Value>(sent[1].3.as_deref().unwrap()).unwrap(), json!({ "action": "stop" }));
        assert_eq!(area_action(&FakeNet::default(), "k", area, "explode"), Err(FAILED));
        assert_eq!(area_action(&FakeNet::default(), "k", "../x", "stop"), Err(FAILED));
        assert_eq!(area_action(&FakeNet::with(vec![json_reply(404, "{}")]), "k", area, "stop"), Err(FAILED));
    }

    #[test]
    fn area_status_reads_active_and_inactive() {
        let area = "11111111-2222-3333-4444-555555555555";
        let net = FakeNet::with(vec![
            json_reply(200, r#"{"data":[{"status":"active"}]}"#),
            json_reply(200, r#"{"data":[{"status":"inactive"}]}"#),
            json_reply(200, r#"{"data":[]}"#),
            json_reply(500, "{}"),
            json_reply(200, "not json"),
        ]);
        assert_eq!(area_active(&net, "k", area), Ok(true));
        assert_eq!(area_active(&net, "k", area), Ok(false));
        assert_eq!(area_active(&net, "k", area), Err(FAILED));
        assert_eq!(area_active(&net, "k", area), Err(FAILED));
        assert_eq!(area_active(&net, "k", area), Err(FAILED));
        assert_eq!(area_active(&net, "k", "../x"), Err(FAILED));
        let sent = net.sent.borrow();
        assert_eq!((sent[0].0.as_str(), sent[0].1.as_str(), sent[0].3.as_deref()), ("GET", "/clip/v2/resource/entertainment_configuration/11111111-2222-3333-4444-555555555555", None));
        assert_eq!(area_active(&FakeNet::default(), "k", area), Err(UNREACHABLE));
    }

    #[test]
    fn no_key_or_address_in_any_error() {
        let words = [LINK_NOT_PRESSED, UNREACHABLE, CERT, BUSY, FAILED];
        for w in words {
            assert!(!w.chars().any(|c| c.is_ascii_digit()), "{w}");
            assert!(!w.contains("secret") && !w.contains("SECRET"));
        }
        let net = FakeNet::with(vec![json_reply(200, r#"[{"error":{"type":7,"description":"user-secret-1 at 192.168.1.5"}}]"#)]);
        let err = register_once(&net).unwrap_err();
        assert!(!err.contains("secret") && !err.contains("192"));
    }

    // Section: facts

    struct FakeFacts {
        reply: Result<(u16, Vec<u8>), ()>,
        seen: RefCell<Vec<(String, Option<String>)>>,
    }

    impl FactsHttp for FakeFacts {
        fn get(&self, url: &str, token: Option<&str>) -> Result<(u16, Vec<u8>), ()> {
            self.seen.borrow_mut().push((url.to_string(), token.map(Into::into)));
            self.reply.clone()
        }
    }

    fn facts_http(code: u16, body: &str) -> FakeFacts {
        FakeFacts { reply: Ok((code, body.as_bytes().to_vec())), seen: RefCell::default() }
    }

    const GOOD: &str = r#"{"ok":true,"bridge":{"ip":"192.168.1.20","id":"001788fffe123456"},"area":null,"panels":null}"#;

    #[test]
    fn facts_read_and_shape() {
        let http = facts_http(200, GOOD);
        let f = read_facts(&http, "http://100.64.0.5:5006", Some("tok")).unwrap();
        assert_eq!(f.ip.to_string(), "192.168.1.20");
        assert_eq!(f.bridge_id, "001788FFFE123456");
        let seen = http.seen.borrow();
        assert_eq!(seen[0].0, "http://100.64.0.5:5006/api/desk/office/lightsync");
        assert_eq!(seen[0].1.as_deref(), Some("tok"));
    }

    #[test]
    fn facts_token_stays_home_for_a_public_base() {
        let http = facts_http(200, GOOD);
        read_facts(&http, "https://example.com", Some("tok")).unwrap();
        assert_eq!(http.seen.borrow()[0].1, None);
    }

    #[test]
    fn facts_refuse_bad_answers() {
        for body in [
            r#"{"ok":false}"#,
            r#"{"ok":true,"bridge":{"ip":"8.8.8.8","id":"001788FFFE123456"}}"#,
            r#"{"ok":true,"bridge":{"ip":"192.168.1.20","id":"short"}}"#,
            r#"{"ok":true,"bridge":{"ip":"not an ip","id":"001788FFFE123456"}}"#,
            r#"{"ok":true}"#,
        ] {
            assert_eq!(read_facts(&facts_http(200, body), "http://localhost:1", None), Err(UNREACHABLE), "{body}");
        }
        assert_eq!(read_facts(&facts_http(500, GOOD), "http://localhost:1", None), Err(UNREACHABLE));
        let down = FakeFacts { reply: Err(()), seen: RefCell::default() };
        assert_eq!(read_facts(&down, "http://localhost:1", None), Err(UNREACHABLE));
    }

    // Section: the pin

    fn root_der(i: usize) -> Vec<u8> {
        pem_to_der(HUE_ROOT_CAS[i]).unwrap()
    }

    #[test]
    fn roots_parse_and_carry_the_expected_names() {
        assert_eq!(subject_cn(&root_der(0)).as_deref(), Some("root-bridge"));
        assert_eq!(subject_cn(&root_der(1)).as_deref(), Some("Hue Root CA 01"));
        assert_eq!(roots_from(&HUE_ROOT_CAS).map(|s| s.roots.len()), Some(2));
    }

    #[test]
    fn cn_pin_refuses_the_wrong_name() {
        let der = root_der(0);
        assert!(cn_matches(&der, "ROOT-BRIDGE"), "case does not matter");
        assert!(!cn_matches(&der, "001788FFFE123456"));
        assert!(!cn_matches(&[1, 2, 3], "001788FFFE123456"));
    }

    #[test]
    fn verifier_refuses_an_unknown_root() {
        use rustls::client::danger::ServerCertVerifier;
        // Only Hue Root CA 01 is trusted here; a certificate from the other root is not accepted.
        let roots = roots_from(&HUE_ROOT_CAS[1..]).unwrap();
        let pin = HuePin::new(roots, "001788FFFE123456").unwrap();
        let cert = rustls::pki_types::CertificateDer::from(root_der(0));
        let name = rustls::pki_types::ServerName::try_from("192.168.1.20").unwrap();
        let got = pin.verify_server_cert(&cert, &[], &name, &[], rustls::pki_types::UnixTime::now());
        assert!(got.is_err());
    }

    #[test]
    fn the_pin_needs_a_real_bridge_id() {
        assert!(pinned_config("001788FFFE123456").is_some());
        assert!(pinned_config("").is_none());
        assert!(pinned_config("not-an-id").is_none());
    }

    #[test]
    fn only_lan_addresses_are_used() {
        for ok in ["192.168.1.2", "10.0.0.1", "172.16.5.5", "169.254.1.1", "127.0.0.1"] {
            assert!(lan_address(&ok.parse().unwrap()), "{ok}");
        }
        for bad in ["8.8.8.8", "100.64.0.1", "2001:db8::1"] {
            assert!(!lan_address(&bad.parse().unwrap()), "{bad}");
        }
    }
}
