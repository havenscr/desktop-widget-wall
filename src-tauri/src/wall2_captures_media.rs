//! The `wallcap` scheme: plays a ShareX recording in the Captures large preview.
//!
//! The page sets a `<video>` source to `https://wallcap.localhost/<id>` (the handler sees it as
//! `wallcap://localhost/<id>`), where `<id>` is the 16-hex id of a listed capture. The page never
//! gets a path. `serve` is a pure function so every refusal is unit tested; `handle` is the thin glue to
//! Tauri.
//!
//! What is refused (every refusal is an empty 404, with no path or error text in any body, except an
//! unsatisfiable range on an otherwise valid request, which is 416):
//! - any webview but `wall2`;
//! - any method but GET and HEAD;
//! - an authority other than `localhost`, a query, or a path that is not `/` plus 16 lowercase hex;
//! - a request whose Referer origin is not the app page (a missing Referer too), or whose
//!   `Sec-Fetch-Dest`, when present, is not `video` or `audio`;
//! - an id that is not held, is not a video, does not resolve, was swapped since it was listed, or
//!   whose first bytes are not the container the extension claims;
//! - a Range that is not one `bytes=` range (416 with `Content-Range: bytes */len`).
//!
//! A request with a Range gets a 206 with `Content-Range`, at most 1 MiB (wry on Windows buffers a whole
//! body in memory). A request with no Range (Chromium media always sends one) gets a plain 200 with
//! `Content-Length`, the whole file for GET and no body for HEAD.
//!
//! The page's own webview (`wall2`) also hosts the YouTube and Twitch frames, so the label cannot tell
//! them apart. What keeps those frames out is the Referer origin check plus the unguessable per-run id
//! (an HMAC under a key made fresh each run; with no key every request is a 404). The Referer check
//! must never be made optional. The file is opened, read and closed per request, so Trash still works.
//! Nothing is logged. No CORS header is sent. No `Cross-Origin-Resource-Policy` is sent either: the
//! two hosts (`tauri.localhost`, `wallcap.localhost`) may count as different sites, which would
//! block the page's own video; the Referer check is what keeps other frames out.
#![cfg_attr(not(windows), allow(dead_code))]

use std::io::{Read, Seek, SeekFrom};

/// The most one reply carries.
pub(crate) const CAP: u64 = 1024 * 1024;
/// Largest file sent whole to a request without a Range (media requests always carry one).
pub(crate) const WHOLE_MAX: u64 = 64 * 1024 * 1024;

pub(crate) trait Source: Read + Seek {}
impl<T: Read + Seek> Source for T {}

/// A video opened once by the lookup.
pub(crate) struct Opened {
    /// A path or name; only its extension is used.
    pub name: String,
    pub len: u64,
    /// Whether the id still matches the file as the open handle sees it.
    pub id_ok: bool,
    pub file: Box<dyn Source>,
}

/// What `serve` needs from a request.
pub(crate) struct Req<'a> {
    pub label: &'a str,
    pub method: &'a str,
    pub authority: Option<&'a str>,
    pub path: &'a str,
    pub has_query: bool,
    pub referer: Option<&'a str>,
    pub fetch_dest: Option<&'a str>,
    pub range: Option<&'a str>,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Reply {
    pub status: u16,
    pub headers: Vec<(&'static str, String)>,
    pub body: Vec<u8>,
}

fn empty(status: u16) -> Reply {
    Reply { status, headers: Vec::new(), body: Vec::new() }
}

fn not_found() -> Reply {
    empty(404)
}

/// The page origins allowed to ask: the app page, and the dev server in debug builds.
pub(crate) fn page_origins() -> &'static [&'static str] {
    if cfg!(debug_assertions) {
        &["https://tauri.localhost", "http://localhost:1421"]
    } else {
        &["https://tauri.localhost"]
    }
}

/// `scheme://host[:port]` of a URL as text, or None.
fn origin_of(url: &str) -> Option<&str> {
    let after = url.find("://")? + 3;
    let end = url[after..].find(['/', '?', '#']).map_or(url.len(), |i| after + i);
    Some(&url[..end])
}

/// The id of a path that is exactly `/` and 16 lowercase hex characters.
pub(crate) fn id_of_path(path: &str) -> Option<&str> {
    let id = path.strip_prefix('/')?;
    (id.len() == 16 && id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))).then_some(id)
}

/// The mime type by extension (without case), for the three kinds served.
pub(crate) fn mime_of(name: &str) -> Option<&'static str> {
    match name.rsplit_once('.')?.1.to_ascii_lowercase().as_str() {
        "mp4" => Some("video/mp4"),
        "webm" => Some("video/webm"),
        "mov" => Some("video/quicktime"),
        _ => None,
    }
}

/// Whether the first bytes are the container the mime type claims: `ftyp` at offset 4 for mp4
/// and mov, the EBML header for webm.
pub(crate) fn video_magic_ok(mime: &str, head: &[u8]) -> bool {
    match mime {
        "video/mp4" | "video/quicktime" => head.len() >= 8 && &head[4..8] == b"ftyp",
        "video/webm" => head.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]),
        _ => false,
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Span {
    /// First and last byte, inclusive, already clamped to the file and to `CAP`.
    Bytes(u64, u64),
    /// Answer 416.
    Unsatisfiable,
}

fn digits(s: &str) -> Option<u64> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

/// The one range asked for, against a file of `len` bytes (more than zero). Only `bytes=a-b`, `bytes=a-` and `bytes=-n` pass; anything else is unsatisfiable.
pub(crate) fn parse_range(header: &str, len: u64) -> Span {
    let last = len.saturating_sub(1);
    let Some(spec) = header.strip_prefix("bytes=") else { return Span::Unsatisfiable };
    let Some((a, b)) = spec.split_once('-') else { return Span::Unsatisfiable };
    let (start, end) = match (a.is_empty(), b.is_empty()) {
        (true, true) => return Span::Unsatisfiable,
        (true, false) => {
            let Some(n) = digits(b) else { return Span::Unsatisfiable };
            if n == 0 {
                return Span::Unsatisfiable;
            }
            (len.saturating_sub(n), last)
        }
        (false, true) => {
            let Some(a) = digits(a) else { return Span::Unsatisfiable };
            (a, last)
        }
        (false, false) => {
            let (Some(a), Some(b)) = (digits(a), digits(b)) else { return Span::Unsatisfiable };
            if b < a {
                return Span::Unsatisfiable;
            }
            (a, b.min(last))
        }
    };
    if start >= len {
        return Span::Unsatisfiable;
    }
    let end = end.min(start.saturating_add(CAP - 1)).min(last);
    Span::Bytes(start, end)
}

fn shared_headers(mime: &str) -> Vec<(&'static str, String)> {
    vec![
        ("Content-Type", mime.to_string()),
        ("Accept-Ranges", "bytes".to_string()),
        ("X-Content-Type-Options", "nosniff".to_string()),
        ("Cache-Control", "no-store".to_string()),
    ]
}

/// The whole decision for one request. `lookup` opens the held video for an id.
pub(crate) fn serve(req: &Req, origins: &[&str], lookup: &dyn Fn(&str) -> Option<Opened>) -> Reply {
    if req.label != crate::WALL2_LABEL {
        return not_found();
    }
    let head_only = match req.method {
        "GET" => false,
        "HEAD" => true,
        _ => return not_found(),
    };
    if req.authority != Some("localhost") || req.has_query {
        return not_found();
    }
    let Some(id) = id_of_path(req.path) else { return not_found() };
    match req.referer.and_then(origin_of) {
        Some(o) if origins.contains(&o) => {}
        _ => return not_found(),
    }
    if let Some(dest) = req.fetch_dest {
        if dest != "video" && dest != "audio" {
            return not_found();
        }
    }
    let Some(mut opened) = lookup(id) else { return not_found() };
    if !opened.id_ok || opened.len == 0 {
        return not_found();
    }
    let Some(mime) = mime_of(&opened.name) else { return not_found() };
    let mut head = Vec::with_capacity(16);
    if opened.file.seek(SeekFrom::Start(0)).is_err() || opened.file.by_ref().take(16).read_to_end(&mut head).is_err() {
        return not_found();
    }
    if !video_magic_ok(mime, &head) {
        return not_found();
    }
    let len = opened.len;
    let Some(range) = req.range else {
        // No Range: the whole file as a plain 200.
        let mut headers = shared_headers(mime);
        if head_only {
            headers.push(("Content-Length", len.to_string()));
            return Reply { status: 200, headers, body: Vec::new() };
        }
        // A whole-file reply is held in memory, so a very large file gets no unranged body.
        if len > WHOLE_MAX {
            return not_found();
        }
        let mut body = Vec::new();
        if opened.file.seek(SeekFrom::Start(0)).is_err() || opened.file.by_ref().take(len).read_to_end(&mut body).is_err() || body.is_empty() {
            return not_found();
        }
        headers.push(("Content-Length", body.len().to_string()));
        return Reply { status: 200, headers, body };
    };
    let (start, end) = match parse_range(range, len) {
        Span::Bytes(a, b) => (a, b),
        Span::Unsatisfiable => {
            return Reply { status: 416, headers: vec![("Content-Range", format!("bytes */{len}"))], body: Vec::new() };
        }
    };
    let want = end - start + 1;
    let mut headers = shared_headers(mime);
    if head_only {
        headers.push(("Content-Range", format!("bytes {start}-{end}/{len}")));
        headers.push(("Content-Length", want.to_string()));
        return Reply { status: 206, headers, body: Vec::new() };
    }
    let mut body = Vec::with_capacity(want as usize);
    if opened.file.seek(SeekFrom::Start(start)).is_err() || opened.file.by_ref().take(want).read_to_end(&mut body).is_err() {
        return not_found();
    }
    if body.is_empty() {
        return not_found();
    }
    // Length and range come from the bytes actually read, in case the file shrank.
    let end = start + body.len() as u64 - 1;
    headers.push(("Content-Range", format!("bytes {start}-{end}/{len}")));
    headers.push(("Content-Length", body.len().to_string()));
    Reply { status: 206, headers, body }
}

// Section: glue to Tauri

fn to_response(r: Reply) -> tauri::http::Response<Vec<u8>> {
    let mut b = tauri::http::Response::builder().status(r.status);
    for (k, v) in r.headers {
        b = b.header(k, v);
    }
    b.body(r.body).unwrap_or_else(|_| {
        let mut fallback = tauri::http::Response::new(Vec::new());
        *fallback.status_mut() = tauri::http::StatusCode::NOT_FOUND;
        fallback
    })
}

/// The handler for the `wallcap` scheme: reads on a blocking thread, answers through `responder`.
pub(crate) fn handle(label: String, request: tauri::http::Request<Vec<u8>>, responder: tauri::UriSchemeResponder) {
    tauri::async_runtime::spawn_blocking(move || {
        let text = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_string);
        let (referer, dest, range) = (text("referer"), text("sec-fetch-dest"), text("range"));
        let uri = request.uri();
        let req = Req {
            label: &label,
            method: request.method().as_str(),
            authority: uri.authority().map(|a| a.as_str()),
            path: uri.path(),
            has_query: uri.query().is_some(),
            referer: referer.as_deref(),
            fetch_dest: dest.as_deref(),
            range: range.as_deref(),
        };
        let reply = serve(&req, page_origins(), &|id| {
            crate::wall2_captures::held_video(id).map(|(name, file, len, id_ok)| Opened { name, len, id_ok, file: Box::new(file) })
        });
        responder.respond(to_response(reply));
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    const ID: &str = "0123456789abcdef";
    const PAGE: &str = "https://tauri.localhost/";

    fn mp4(len: usize) -> Vec<u8> {
        let mut v = vec![0u8; len];
        v[4..8].copy_from_slice(b"ftyp");
        for (i, b) in v.iter_mut().enumerate().skip(8) {
            *b = (i % 251) as u8;
        }
        v
    }

    fn opened(name: &str, data: Vec<u8>, id_ok: bool) -> Opened {
        Opened { name: name.to_string(), len: data.len() as u64, id_ok, file: Box::new(Cursor::new(data)) }
    }

    fn req<'a>() -> Req<'a> {
        Req {
            label: "wall2",
            method: "GET",
            authority: Some("localhost"),
            path: "/0123456789abcdef",
            has_query: false,
            referer: Some(PAGE),
            fetch_dest: Some("video"),
            range: None,
        }
    }

    fn run(r: &Req, data: Vec<u8>) -> Reply {
        serve(r, &["https://tauri.localhost"], &|id| (id == ID).then(|| opened("a.mp4", data.clone(), true)))
    }

    fn header<'a>(r: &'a Reply, name: &str) -> Option<&'a str> {
        r.headers.iter().find(|(k, _)| *k == name).map(|(_, v)| v.as_str())
    }

    #[test]
    fn parse_range_forms() {
        assert_eq!(parse_range("bytes=0-", 100), Span::Bytes(0, 99));
        assert_eq!(parse_range("bytes=10-19", 100), Span::Bytes(10, 19));
        assert_eq!(parse_range("bytes=90-", 100), Span::Bytes(90, 99));
        assert_eq!(parse_range("bytes=-10", 100), Span::Bytes(90, 99));
        assert_eq!(parse_range("bytes=-500", 100), Span::Bytes(0, 99));
        assert_eq!(parse_range("bytes=5-5000", 100), Span::Bytes(5, 99));
    }

    #[test]
    fn parse_range_clamps_to_the_cap() {
        let len = 10 * CAP;
        assert_eq!(parse_range("bytes=0-", len), Span::Bytes(0, CAP - 1));
        assert_eq!(parse_range("bytes=5-", len), Span::Bytes(5, 5 + CAP - 1));
        assert_eq!(parse_range("bytes=0-18446744073709551615", len), Span::Bytes(0, CAP - 1));
        assert_eq!(parse_range("bytes=-18446744073709551615", len), Span::Bytes(0, CAP - 1));
        assert_eq!(parse_range("bytes=-10", len), Span::Bytes(len - 10, len - 1));
    }

    #[test]
    fn parse_range_refuses_the_rest() {
        for h in [
            "bytes=100-", "bytes=100-200", "bytes=50-10", "bytes=-0", "bytes=-", "bytes=", "bytes=0-1,5-6", "bytes=a-b", "bytes= 0-5",
            "bytes=+1-5", "bytes=0-5 ", "Bytes=0-5", "items=0-5", "0-5", "bytes=18446744073709551616-", "bytes=18446744073709551615-18446744073709551615",
        ] {
            assert_eq!(parse_range(h, 100), Span::Unsatisfiable, "{h}");
        }
        // A start near u64::MAX must not overflow.
        assert_eq!(parse_range("bytes=18446744073709551615-", u64::MAX), Span::Unsatisfiable);
    }

    #[test]
    fn a_request_without_a_range_gets_the_whole_file_as_a_200() {
        let data = mp4((CAP as usize) * 2 + 10);
        let r = run(&req(), data.clone());
        assert_eq!(r.status, 200);
        assert_eq!(r.body, data);
        assert_eq!(header(&r, "Content-Length"), Some(data.len().to_string().as_str()));
        assert_eq!(header(&r, "Content-Range"), None);
        assert_eq!(header(&r, "Accept-Ranges"), Some("bytes"));
    }

    #[test]
    fn a_good_ranged_request_gets_a_206_with_exact_lengths() {
        let mut q = req();
        q.range = Some("bytes=0-");
        let r = run(&q, mp4(3000));
        assert_eq!(r.status, 206);
        assert_eq!(r.body.len(), 3000);
        assert_eq!(header(&r, "Content-Length"), Some("3000"));
        assert_eq!(header(&r, "Content-Range"), Some("bytes 0-2999/3000"));
        assert_eq!(header(&r, "Content-Type"), Some("video/mp4"));
        assert_eq!(header(&r, "Accept-Ranges"), Some("bytes"));
        assert_eq!(header(&r, "X-Content-Type-Options"), Some("nosniff"));
        assert_eq!(header(&r, "Cache-Control"), Some("no-store"));
    }

    #[test]
    fn a_big_file_is_cut_at_the_cap_and_a_range_picks_the_bytes() {
        let data = mp4((CAP as usize) * 2 + 10);
        let mut q = req();
        q.range = Some("bytes=0-");
        let r = run(&q, data.clone());
        assert_eq!(r.status, 206);
        assert_eq!(r.body.len() as u64, CAP);
        assert_eq!(header(&r, "Content-Range"), Some(format!("bytes 0-{}/{}", CAP - 1, data.len()).as_str()));
        q.range = Some("bytes=100-199");
        let r = run(&q, data.clone());
        assert_eq!(r.body, data[100..200]);
        assert_eq!(header(&r, "Content-Length"), Some("100"));
        q.range = Some("bytes=-4");
        assert_eq!(run(&q, data.clone()).body, data[data.len() - 4..]);
    }

    #[test]
    fn a_start_past_the_end_is_416_with_the_length() {
        let mut q = req();
        q.range = Some("bytes=5000-");
        let r = run(&q, mp4(3000));
        assert_eq!(r.status, 416);
        assert_eq!(header(&r, "Content-Range"), Some("bytes */3000"));
        assert!(r.body.is_empty());
    }

    #[test]
    fn head_has_the_headers_and_no_body() {
        let mut q = req();
        q.method = "HEAD";
        let r = run(&q, mp4(3000));
        assert_eq!(r.status, 200);
        assert!(r.body.is_empty());
        assert_eq!(header(&r, "Content-Length"), Some("3000"));
        assert_eq!(header(&r, "Accept-Ranges"), Some("bytes"));
        q.range = Some("bytes=0-9");
        let r = run(&q, mp4(3000));
        assert_eq!((r.status, header(&r, "Content-Length")), (206, Some("10")));
        assert!(r.body.is_empty());
    }

    #[test]
    fn the_wrong_window_and_a_bad_method_are_404() {
        let mut q = req();
        q.label = "main";
        assert_eq!(run(&q, mp4(100)), empty(404));
        let mut q = req();
        q.method = "POST";
        assert_eq!(run(&q, mp4(100)), empty(404));
        q.method = "OPTIONS";
        assert_eq!(run(&q, mp4(100)), empty(404));
    }

    #[test]
    fn the_address_must_be_exactly_the_scheme_host_and_a_plain_id() {
        let cases: Vec<(&str, Option<&str>, bool)> = vec![
            ("/0123456789abcdef", Some("youtube-nocookie.com"), false),
            ("/0123456789abcdef", Some("localhost:80"), false),
            ("/0123456789abcdef", Some("user@localhost"), false),
            ("/0123456789abcdef", None, false),
            ("/0123456789abcdef", Some("localhost"), true),
            ("/0123456789ABCDEF", Some("localhost"), false),
            ("/0123456789abcdef0", Some("localhost"), false),
            ("/0123456789abcde", Some("localhost"), false),
            ("/../0123456789abcdef", Some("localhost"), false),
            ("/0123456789abcdef/", Some("localhost"), false),
            ("0123456789abcdef", Some("localhost"), false),
            ("/", Some("localhost"), false),
            ("", Some("localhost"), false),
        ];
        for (path, authority, has_query) in cases {
            let mut q = req();
            q.path = path;
            q.authority = authority;
            q.has_query = has_query;
            assert_eq!(run(&q, mp4(100)), empty(404), "{path} {authority:?} {has_query}");
        }
    }

    #[test]
    fn the_referer_must_be_the_app_page() {
        for r in [None, Some(""), Some("https://www.youtube-nocookie.com/embed/x"), Some("https://tauri.localhost.evil.test/"), Some("http://tauri.localhost/"), Some("https://user@tauri.localhost/"), Some("https://tauri.localhost:8443/"), Some("tauri.localhost")] {
            let mut q = req();
            q.referer = r;
            assert_eq!(run(&q, mp4(100)), empty(404), "{r:?}");
        }
        for r in ["https://tauri.localhost", "https://tauri.localhost/", "https://tauri.localhost/index.html?x=1"] {
            let mut q = req();
            q.referer = Some(r);
            assert_eq!(run(&q, mp4(100)).status, 200, "{r}");
        }
        // The dev server is allowed only when the caller says so.
        let mut q = req();
        q.referer = Some("http://localhost:1421/");
        assert_eq!(run(&q, mp4(100)).status, 404);
        let ok = serve(&q, &["http://localhost:1421"], &|_| Some(opened("a.mp4", mp4(100), true)));
        assert_eq!(ok.status, 200);
    }

    #[test]
    fn the_fetch_destination_must_be_media_when_sent() {
        for d in ["document", "iframe", "image", "script", "empty", ""] {
            let mut q = req();
            q.fetch_dest = Some(d);
            assert_eq!(run(&q, mp4(100)), empty(404), "{d}");
        }
        for d in [None, Some("video"), Some("audio")] {
            let mut q = req();
            q.fetch_dest = d;
            assert_eq!(run(&q, mp4(100)).status, 200);
        }
    }

    #[test]
    fn an_unknown_swapped_or_wrong_file_is_404() {
        // Not held.
        let lookup_none = |_: &str| -> Option<Opened> { None };
        assert_eq!(serve(&req(), &["https://tauri.localhost"], &lookup_none), empty(404));
        // Swapped since listing.
        let swapped = |_: &str| Some(opened("a.mp4", mp4(100), false));
        assert_eq!(serve(&req(), &["https://tauri.localhost"], &swapped), empty(404));
        // Extension not served.
        for name in ["a.mkv", "a.avi", "a.png", "a", "a.mp4.exe"] {
            let f = |_: &str| Some(opened(name, mp4(100), true));
            assert_eq!(serve(&req(), &["https://tauri.localhost"], &f), empty(404), "{name}");
        }
        // Bad magic, empty, and an mp4 name on webm bytes.
        for data in [vec![0u8; 100], Vec::new(), vec![1, 2, 3], vec![0x1A, 0x45, 0xDF, 0xA3, 0, 0, 0, 0]] {
            assert_eq!(run(&req(), data), empty(404));
        }
    }

    #[test]
    fn webm_and_mov_pass_their_own_magic() {
        let mut webm = vec![0x1A, 0x45, 0xDF, 0xA3];
        webm.extend_from_slice(&[7u8; 64]);
        let f = |_: &str| Some(opened("clip.WEBM", webm.clone(), true));
        let r = serve(&req(), &["https://tauri.localhost"], &f);
        assert_eq!((r.status, header(&r, "Content-Type")), (200, Some("video/webm")));
        let g = |_: &str| Some(opened("clip.mov", mp4(64), true));
        let r = serve(&req(), &["https://tauri.localhost"], &g);
        assert_eq!((r.status, header(&r, "Content-Type")), (200, Some("video/quicktime")));
    }

    #[test]
    fn no_reply_allows_another_origin_or_leaks_text() {
        let mut q = req();
        q.range = Some("bytes=0-9");
        for r in [run(&req(), mp4(100)), run(&q, mp4(100)), run(&req(), Vec::new())] {
            assert!(r.headers.iter().all(|(k, _)| !k.to_ascii_lowercase().starts_with("access-control")));
            assert!(r.status == 200 || r.status == 206 || r.body.is_empty());
        }
    }
}
