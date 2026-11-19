//! Nanoleaf panels over UDP, extControl v2, and the home app's lease route that puts them in
//! that mode. The stream itself carries no token; the one write that needs the desk token goes
//! to the home app (`POST /api/desk/office/panels/stream`), only where the token may go.

use serde_json::{json, Value};
use std::net::{IpAddr, SocketAddr, UdpSocket};

pub(crate) const UNAVAILABLE: &str = "panels-unavailable";
/// extControl packets carry at most this many panels.
const MAX_PANELS: usize = 100;

/// One panel: its id and where it sits.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Panel {
    pub id: u16,
    pub x: f64,
    pub y: f64,
}

/// One panel colour, 8 bits per component plus white, and the transition in 100 ms units.
pub(crate) type PanelColour = (u16, [u8; 4], u16);

/// extControl v2 packet: the panel count (u16), then per panel the id (u16), R, G, B, W and the
/// transition time (u16), all big endian.
pub(crate) fn encode_packet(panels: &[PanelColour]) -> Option<Vec<u8>> {
    if panels.is_empty() || panels.len() > MAX_PANELS {
        return None;
    }
    let mut out = Vec::with_capacity(2 + panels.len() * 8);
    out.extend_from_slice(&(panels.len() as u16).to_be_bytes());
    for (id, rgbw, transition) in panels {
        out.extend_from_slice(&id.to_be_bytes());
        out.extend_from_slice(rgbw);
        out.extend_from_slice(&transition.to_be_bytes());
    }
    Some(out)
}

pub(crate) struct PanelLink {
    sock: UdpSocket,
}

impl PanelLink {
    pub(crate) fn open(ip: IpAddr, port: u16) -> Result<PanelLink, &'static str> {
        if !super::bridge::lan_address(&ip) || port == 0 {
            return Err(UNAVAILABLE);
        }
        let bind = if ip.is_ipv4() { "0.0.0.0:0" } else { "[::]:0" };
        let sock = UdpSocket::bind(bind).map_err(|_| UNAVAILABLE)?;
        sock.connect(SocketAddr::new(ip, port)).map_err(|_| UNAVAILABLE)?;
        Ok(PanelLink { sock })
    }
}

impl super::stream::Frames for PanelLink {
    fn send(&mut self, bytes: &[u8]) -> bool {
        self.sock.send(bytes).is_ok()
    }
}

/// The body of the home app's lease route.
pub(crate) fn stream_body(on: bool, renew: bool, restore: bool) -> String {
    let mut v = json!({ "on": on });
    if on && renew {
        v["renew"] = json!(true);
    } else if !on {
        v["restore"] = json!(restore);
    }
    v.to_string()
}

/// The address and port from the route's answer: `{ ok: true, ip, port }`.
pub(crate) fn shape_stream_answer(v: &Value) -> Option<(IpAddr, u16)> {
    if v.get("ok").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    let ip: IpAddr = v.get("ip")?.as_str()?.trim().parse().ok()?;
    let port = u16::try_from(v.get("port")?.as_u64()?).ok()?;
    (super::bridge::lan_address(&ip) && port != 0).then_some((ip, port))
}

/// Panels in order of their `x` then `y` (left to right).
pub(crate) fn shape_layout(v: &Value) -> Option<Vec<Panel>> {
    let list = v.as_array()?;
    let mut out = Vec::new();
    for p in list.iter().take(MAX_PANELS) {
        let id = u16::try_from(p.get("id")?.as_u64()?).ok()?;
        let x = p.get("x")?.as_f64()?;
        let y = p.get("y")?.as_f64()?;
        if x.is_finite() && y.is_finite() {
            out.push(Panel { id, x, y });
        }
    }
    (!out.is_empty()).then_some(out)
}

/// One frame of a ring that grows from the middle of the layout outward at `t` (0..1), magenta.
pub(crate) fn ring_frame(panels: &[Panel], t: f64) -> Vec<PanelColour> {
    if panels.is_empty() {
        return Vec::new();
    }
    let n = panels.len() as f64;
    let (cx, cy) = (panels.iter().map(|p| p.x).sum::<f64>() / n, panels.iter().map(|p| p.y).sum::<f64>() / n);
    let dist: Vec<f64> = panels.iter().map(|p| ((p.x - cx).powi(2) + (p.y - cy).powi(2)).sqrt()).collect();
    let far = dist.iter().cloned().fold(0.0_f64, f64::max).max(1.0);
    let radius = t.clamp(0.0, 1.0) * far;
    let width = (far / 3.0).max(1.0);
    panels
        .iter()
        .zip(dist)
        .map(|(p, d)| {
            let level = (1.0 - (d - radius).abs() / width).max(0.0) * 0.9 + 0.05;
            let v = (level * 255.0).round() as u8;
            (p.id, [v, 0, v, 0], 1)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packet_layout() {
        let p = encode_packet(&[(0x0102, [1, 2, 3, 4], 0x0005), (9, [255, 0, 255, 0], 1)]).unwrap();
        assert_eq!(p, vec![0, 2, 1, 2, 1, 2, 3, 4, 0, 5, 0, 9, 255, 0, 255, 0, 0, 1]);
    }

    #[test]
    fn packet_refuses_none_or_too_many() {
        assert!(encode_packet(&[]).is_none());
        let many: Vec<PanelColour> = (0..101).map(|i| (i, [0; 4], 1)).collect();
        assert!(encode_packet(&many).is_none());
        assert!(encode_packet(&many[..100]).is_some());
    }

    #[test]
    fn stream_bodies() {
        let v = |s: String| serde_json::from_str::<Value>(&s).unwrap();
        assert_eq!(v(stream_body(true, false, false)), json!({ "on": true }));
        assert_eq!(v(stream_body(true, true, false)), json!({ "on": true, "renew": true }));
        assert_eq!(v(stream_body(false, false, true)), json!({ "on": false, "restore": true }));
        assert_eq!(v(stream_body(false, false, false)), json!({ "on": false, "restore": false }));
    }

    #[test]
    fn stream_answer_needs_a_lan_address_and_port() {
        let ok = json!({ "ok": true, "ip": "192.168.1.30", "port": 60222 });
        assert_eq!(shape_stream_answer(&ok), Some(("192.168.1.30".parse().unwrap(), 60222)));
        assert!(shape_stream_answer(&json!({ "ok": false, "ip": "192.168.1.30", "port": 60222 })).is_none());
        assert!(shape_stream_answer(&json!({ "ok": true, "ip": "8.8.8.8", "port": 60222 })).is_none());
        assert!(shape_stream_answer(&json!({ "ok": true, "ip": "192.168.1.30", "port": 0 })).is_none());
        assert!(shape_stream_answer(&json!({ "ok": true, "ip": "192.168.1.30", "port": 70000 })).is_none());
    }

    #[test]
    fn layout_shape() {
        let v = json!([{ "id": 12, "x": 100.0, "y": 0 }, { "id": 7, "x": 0, "y": 50.5 }]);
        let p = shape_layout(&v).unwrap();
        assert_eq!((p[0].id, p[1].id, p[1].y), (12, 7, 50.5));
        assert!(shape_layout(&json!([])).is_none());
        assert!(shape_layout(&json!([{ "id": 70000, "x": 0, "y": 0 }])).is_none());
        assert!(shape_layout(&json!("x")).is_none());
    }

    #[test]
    fn ring_grows_outward_and_is_never_black() {
        let panels: Vec<Panel> = [(1u16, 0.0), (2, 10.0), (3, 20.0), (4, -20.0)].iter().map(|(id, x)| Panel { id: *id, x: *x, y: 0.0 }).collect();
        let at = |t: f64| ring_frame(&panels, t);
        let level = |f: &[PanelColour], id: u16| f.iter().find(|c| c.0 == id).unwrap().1[0];
        let start = at(0.0);
        let end = at(1.0);
        assert!(level(&start, 1) > level(&start, 3), "middle lit first");
        assert!(level(&end, 3) > level(&end, 1), "edge lit last");
        for c in start.iter().chain(end.iter()) {
            assert!(c.1[0] > 0 && c.1[1] == 0 && c.1[0] == c.1[2]);
        }
        assert!(ring_frame(&[], 0.5).is_empty());
    }
}
