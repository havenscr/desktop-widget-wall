//! The Hue Entertainment stream: DTLS 1.2 with a pre-shared key to UDP port 2100 on the bridge,
//! and the HueStream v2 frame the bridge reads. The PSK identity is the application id from
//! `GET /auth/v1`; the PSK is the 16 bytes behind the hex `clientkey` the bridge gave at pairing.
//! Exactly one cipher suite is offered, the one the bridge requires. The client key, the PSK and
//! the identity are never put in an error, a log or an answer: every failure here is the fixed
//! word `dtls`.

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;
use webrtc_dtls::cipher_suite::CipherSuiteId;
use webrtc_dtls::config::Config;
use webrtc_dtls::conn::DTLSConn;

pub(crate) const DTLS: &str = "dtls";
pub(crate) const PORT: u16 = 2100;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(6);
const WRITE_TIMEOUT: Duration = Duration::from_millis(500);

/// The one cipher suite offered: TLS_PSK_WITH_AES_128_GCM_SHA256.
pub(crate) const SUITE: CipherSuiteId = CipherSuiteId::Tls_Psk_With_Aes_128_Gcm_Sha256;

/// The 16 PSK bytes from the 32 hex digits of the client key.
pub(crate) fn psk_bytes(clientkey: &str) -> Option<Vec<u8>> {
    let b = clientkey.trim().as_bytes();
    if b.len() != 32 {
        return None;
    }
    let nib = |c: u8| (c as char).to_digit(16).map(|d| d as u8);
    b.chunks(2).map(|p| Some(nib(p[0])? << 4 | nib(p[1])?)).collect()
}

/// The DTLS settings: identity, key and a single suite. Nothing else is negotiable.
pub(crate) fn psk_config(app_id: &str, key: Vec<u8>) -> Config {
    Config {
        psk: Some(Arc::new(move |_hint: &[u8]| -> Result<Vec<u8>, webrtc_dtls::Error> { Ok(key.clone()) })),
        psk_identity_hint: Some(app_id.as_bytes().to_vec()),
        cipher_suites: vec![SUITE],
        ..Default::default()
    }
}

// Section: the HueStream v2 frame

/// One channel's colour, 16 bits per component.
pub(crate) type Channel = (u8, [u16; 3]);

/// Length of the header before the channel entries: the tag, version, sequence, two reserved
/// bytes, colour space, one reserved byte, and the 36-character area id.
pub(crate) const HEADER_LEN: usize = 16 + 36;

/// `HueStream`, version 2.0, the sequence, RGB, the area id, then 7 bytes per channel: the
/// channel id and three 16-bit big endian components. At most 20 channels (the bridge's limit).
pub(crate) fn encode_frame(sequence: u8, area_id: &str, channels: &[Channel]) -> Option<Vec<u8>> {
    if !super::bridge::valid_area_id(area_id) || channels.len() > 20 {
        return None;
    }
    let mut out = Vec::with_capacity(HEADER_LEN + channels.len() * 7);
    out.extend_from_slice(b"HueStream");
    out.extend_from_slice(&[2, 0, sequence, 0, 0, 0, 0]);
    out.extend_from_slice(area_id.as_bytes());
    for (id, rgb) in channels {
        out.push(*id);
        for c in rgb {
            out.extend_from_slice(&c.to_be_bytes());
        }
    }
    Some(out)
}

/// A 0..1 colour to 16 bits.
pub(crate) fn to16(v: f64) -> u16 {
    (v.clamp(0.0, 1.0) * 65535.0).round() as u16
}

// Section: the live link

/// Where frames go. The real one is a DTLS link; tests use a recorder.
pub(crate) trait Frames {
    fn send(&mut self, bytes: &[u8]) -> bool;
}

/// A connected DTLS session with its own small runtime, driven from a blocking thread.
pub(crate) struct HueLink {
    rt: tokio::runtime::Runtime,
    conn: DTLSConn,
}

impl HueLink {
    /// Handshake with the bridge. Any failure, whatever its text, is the word `dtls`.
    pub(crate) fn connect(ip: IpAddr, app_id: &str, clientkey: &str) -> Result<HueLink, &'static str> {
        let key = psk_bytes(clientkey).ok_or(DTLS)?;
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().map_err(|_| DTLS)?;
        let config = psk_config(app_id, key);
        let conn = rt
            .block_on(async move {
                let bind = if ip.is_ipv4() { "0.0.0.0:0" } else { "[::]:0" };
                let sock = tokio::net::UdpSocket::bind(bind).await.ok()?;
                sock.connect(SocketAddr::new(ip, PORT)).await.ok()?;
                let sock: Arc<dyn webrtc_util::Conn + Send + Sync> = Arc::new(sock);
                tokio::time::timeout(CONNECT_TIMEOUT, DTLSConn::new(sock, config, true, None)).await.ok()?.ok()
            })
            .ok_or(DTLS)?;
        Ok(HueLink { rt, conn })
    }

}

impl Drop for HueLink {
    fn drop(&mut self) {
        let _ = self.rt.block_on(async { tokio::time::timeout(Duration::from_secs(1), self.conn.close()).await });
    }
}

impl Frames for HueLink {
    fn send(&mut self, bytes: &[u8]) -> bool {
        self.rt.block_on(self.conn.write(bytes, Some(WRITE_TIMEOUT))).is_ok()
    }
}

// Section: the test sweep

/// Magenta, the colour of the test flash.
const MAGENTA: [f64; 3] = [1.0, 0.0, 1.0];

/// Frame at `t` (0..1) of a left-to-right sweep: channels are given in order of their `x`, a
/// soft bump of magenta travels across them.
pub(crate) fn sweep_frame(ids_left_to_right: &[u8], t: f64) -> Vec<Channel> {
    let n = ids_left_to_right.len();
    let span = if n > 1 { (n - 1) as f64 } else { 1.0 };
    let at = t.clamp(0.0, 1.0) * span;
    ids_left_to_right
        .iter()
        .enumerate()
        .map(|(i, id)| {
            let level = (1.0 - (at - i as f64).abs()).max(0.0) * 0.9 + 0.05;
            (*id, [to16(MAGENTA[0] * level), to16(MAGENTA[1] * level), to16(MAGENTA[2] * level)])
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const AREA: &str = "0a1b2c3d-0000-4000-8000-123456789abc";
    const KEY_HEX: &str = "00112233445566778899aabbccddeeff";

    #[test]
    fn frame_header_layout() {
        let f = encode_frame(7, AREA, &[]).unwrap();
        assert_eq!(f.len(), HEADER_LEN);
        assert_eq!(&f[..9], b"HueStream");
        assert_eq!(&f[9..11], &[2, 0], "version 2.0");
        assert_eq!(f[11], 7, "sequence");
        assert_eq!(&f[12..14], &[0, 0], "reserved");
        assert_eq!(f[14], 0, "RGB colour space");
        assert_eq!(f[15], 0, "reserved");
        assert_eq!(&f[16..52], AREA.as_bytes());
    }

    #[test]
    fn frame_channels_are_big_endian_in_given_order() {
        let f = encode_frame(0, AREA, &[(3, [0x0102, 0x0304, 0x0506]), (1, [0xffff, 0, 0x00ff])]).unwrap();
        assert_eq!(f.len(), HEADER_LEN + 14);
        assert_eq!(&f[HEADER_LEN..HEADER_LEN + 7], &[3, 1, 2, 3, 4, 5, 6]);
        assert_eq!(&f[HEADER_LEN + 7..], &[1, 255, 255, 0, 0, 0, 255]);
    }

    #[test]
    fn frame_refuses_a_bad_area_id_and_too_many_channels() {
        assert!(encode_frame(0, "short", &[]).is_none());
        assert!(encode_frame(0, &"z".repeat(36), &[]).is_none());
        let many: Vec<Channel> = (0..21).map(|i| (i, [0, 0, 0])).collect();
        assert!(encode_frame(0, AREA, &many).is_none());
        assert!(encode_frame(0, AREA, &many[..20]).is_some());
    }

    #[test]
    fn sequence_wraps_at_256() {
        let seq = |n: u32| encode_frame((n % 256) as u8, AREA, &[]).unwrap()[11];
        assert_eq!((seq(255), seq(256), seq(257)), (255, 0, 1));
    }

    #[test]
    fn colours_scale_to_sixteen_bits() {
        assert_eq!((to16(0.0), to16(1.0), to16(2.0), to16(-1.0)), (0, 65535, 65535, 0));
    }

    #[test]
    fn psk_bytes_decode_the_client_key() {
        let k = psk_bytes(KEY_HEX).unwrap();
        assert_eq!(k.len(), 16);
        assert_eq!((k[0], k[1], k[15]), (0x00, 0x11, 0xff));
        assert_eq!(psk_bytes(&KEY_HEX.to_uppercase()), Some(k));
        assert!(psk_bytes("abcd").is_none());
        assert!(psk_bytes(&"g".repeat(32)).is_none());
    }

    #[test]
    fn psk_config_has_identity_key_and_one_suite() {
        let key = psk_bytes(KEY_HEX).unwrap();
        let cfg = psk_config("app-id-1", key.clone());
        assert_eq!(cfg.psk_identity_hint, Some(b"app-id-1".to_vec()));
        assert_eq!(cfg.cipher_suites, vec![CipherSuiteId::Tls_Psk_With_Aes_128_Gcm_Sha256]);
        assert_eq!(SUITE as u16, 0x00a8);
        let psk = cfg.psk.expect("psk set");
        assert_eq!(psk(b"any hint").unwrap(), key);
    }

    #[test]
    fn a_bad_client_key_fails_with_the_word_only() {
        let secret = "not-a-hex-client-key-SECRET";
        let err = HueLink::connect("192.168.1.2".parse().unwrap(), "app-id-secret", secret).err().unwrap();
        assert_eq!(err, DTLS);
        assert!(!err.contains("SECRET") && !err.contains("secret"));
    }

    #[test]
    fn sweep_moves_left_to_right_in_magenta() {
        let ids = [4u8, 2, 9, 1];
        let first = sweep_frame(&ids, 0.0);
        let last = sweep_frame(&ids, 1.0);
        assert_eq!(first.iter().map(|c| c.0).collect::<Vec<_>>(), ids);
        let bright = |f: &[Channel]| f.iter().enumerate().max_by_key(|(_, c)| c.1[0]).unwrap().0;
        assert_eq!((bright(&first), bright(&last)), (0, 3));
        for (_, rgb) in first.iter().chain(last.iter()) {
            assert_eq!(rgb[1], 0, "no green");
            assert_eq!(rgb[0], rgb[2], "magenta: red equals blue");
            assert!(rgb[0] > 0, "never black");
        }
    }

    #[test]
    fn sweep_with_one_channel_does_not_divide_by_zero() {
        assert_eq!(sweep_frame(&[5], 0.5).len(), 1);
        assert!(sweep_frame(&[], 0.5).is_empty());
    }

    /// The key, the identity and the PSK never meet a log or format macro in this file or the other two.
    #[test]
    fn no_logging_in_the_stream_files() {
        let files = [include_str!("stream.rs"), include_str!("nanoleaf.rs"), include_str!("mod.rs")];
        let needles = [concat!("print", "ln!"), concat!("e", "print", "ln!"), concat!("de", "bug!"), concat!("log::", "info!"), concat!("log::", "warn!"), concat!("log::", "error!"), concat!("d", "bg!")];
        for src in files {
            let src = src.replace("\r\n", "\n");
            let code = src.split("#[cfg(test)]").next().unwrap();
            for n in needles {
                assert!(!code.contains(n), "{n}");
            }
        }
    }
}
