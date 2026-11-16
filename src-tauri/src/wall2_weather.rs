//! Wall 2 weather: the native read of the forecast, with a log and a second source.
//!
//! The web view used to fetch the forecast itself, so a refusal could only be guessed at.
//! This reads it natively and says why it failed: `dns`, `connect`, `tls`, `timeout`,
//! `http <status>`, `read`, or `input` for coordinates that are not valid. Open-Meteo is the
//! first source. The United States National Weather Service (no key) is the second one, asked
//! when the first refuses (429) or cannot be reached; outside the United States it answers 404.
//! The page parses both replies. Nothing here logs or returns the coordinates: a log line holds
//! a time, a source word, a failure kind, a status and a short scrubbed reason only.

use std::sync::mpsc::SyncSender;
use std::sync::{Mutex, OnceLock};

const NAME: &str = "wall2-weather.log";
const OLDER: &str = "wall2-weather.log.1";
static TX: OnceLock<SyncSender<String>> = OnceLock::new();

const WALL2_LABEL: &str = "wall2";
const USER_AGENT: &str = "Ridgeline/0.1 (https://github.com/havenscr/desktop-widget-wall)";
const OPEN_METEO: &str = "open-meteo";
const NWS: &str = "nws";
const NWS_HOST_PREFIX: &str = "https://api.weather.gov/";
/// How much of a failed reply is read to find its reason.
const REASON_READ_BYTES: u64 = 4096;
/// How much of the reason the log keeps.
const REASON_CHARS: usize = 120;

/// Why a read failed. `code()` is the text the page receives as the error.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Failure {
    Dns,
    Connect,
    Tls,
    Timeout,
    Http(u16),
    Read,
    Input,
}

impl Failure {
    pub fn code(self) -> String {
        match self {
            Self::Dns => "dns".to_string(),
            Self::Connect => "connect".to_string(),
            Self::Tls => "tls".to_string(),
            Self::Timeout => "timeout".to_string(),
            Self::Http(s) => format!("http {s}"),
            Self::Read => "read".to_string(),
            Self::Input => "input".to_string(),
        }
    }
    fn kind_word(self) -> &'static str {
        match self {
            Self::Dns => "dns",
            Self::Connect => "connect",
            Self::Tls => "tls",
            Self::Timeout => "timeout",
            Self::Http(_) => "http",
            Self::Read => "read",
            Self::Input => "input",
        }
    }
    fn status(self) -> u16 {
        if let Self::Http(s) = self { s } else { 0 }
    }
}

/// The transport errors that matter here, copied from the HTTP client's own kinds so the mapping
/// below is plain and tested without the client.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Transport {
    Dns,
    ConnectionFailed,
    Io,
    BadStatus,
    Other,
}

/// What a transport error means for the page. `message` is the client's own short text (it says
/// "tls ..." for a failed handshake), `timed_out` is true when the cause was an I/O timeout.
pub fn map_transport(kind: Transport, message: Option<&str>, timed_out: bool) -> Failure {
    if timed_out {
        return Failure::Timeout;
    }
    if message.map_or(false, |m| m.to_ascii_lowercase().contains("tls")) {
        return Failure::Tls;
    }
    match kind {
        Transport::Dns => Failure::Dns,
        Transport::ConnectionFailed => Failure::Connect,
        Transport::Io | Transport::BadStatus | Transport::Other => Failure::Read,
    }
}

/// Latitude and longitude: finite and in range. Anything else never reaches the network.
pub fn validate(latitude: f64, longitude: f64) -> Result<(), Failure> {
    if latitude.is_finite() && longitude.is_finite() && (-90.0..=90.0).contains(&latitude) && (-180.0..=180.0).contains(&longitude) {
        Ok(())
    } else {
        Err(Failure::Input)
    }
}

/// The Open-Meteo forecast address. The reply goes to the web view as text and is read by
/// `parseWeather` in `wall/src/weather/model.ts`.
pub fn open_meteo_url(latitude: f64, longitude: f64) -> String {
    format!(
        "https://api.open-meteo.com/v1/forecast?latitude={latitude}&longitude={longitude}\
&current=temperature_2m,weather_code,is_day,wind_speed_10m,wind_gusts_10m\
&hourly=temperature_2m,weather_code,is_day\
&daily=temperature_2m_max,temperature_2m_min\
&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=2"
    )
}

/// The Weather Service point lookup. It wants at most four decimals in the path.
pub fn nws_points_url(latitude: f64, longitude: f64) -> String {
    format!("{NWS_HOST_PREFIX}points/{latitude:.4},{longitude:.4}")
}

fn nws_address_ok(url: &str) -> bool {
    url.starts_with(NWS_HOST_PREFIX) && url.len() <= 300 && url.chars().all(|c| c.is_ascii_graphic())
}

/// The hourly and the 12 hour forecast addresses from a point lookup's reply. Each is used only when
/// it is on the Weather Service's own host over https (the reply is outside text and is never
/// followed elsewhere). The hourly one is required; a missing or foreign 12 hour address is None.
pub fn nws_urls_from_points(body: &str) -> Option<(String, Option<String>)> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    let props = v.get("properties")?;
    let hourly = props.get("forecastHourly")?.as_str().filter(|u| nws_address_ok(u))?.to_string();
    let forecast = props.get("forecast").and_then(|u| u.as_str()).filter(|u| nws_address_ok(u)).map(str::to_string);
    Some((hourly, forecast))
}

/// What the page receives for the second source: `{"hourly": ..., "forecast": ...}` with the 12 hour
/// forecast null when it could not be read. None when the hourly reply is not JSON.
pub fn combine_nws(hourly: &str, forecast: Option<&str>) -> Option<String> {
    let hourly: serde_json::Value = serde_json::from_str(hourly).ok()?;
    let forecast = forecast.and_then(|f| serde_json::from_str::<serde_json::Value>(f).ok()).unwrap_or(serde_json::Value::Null);
    serde_json::to_string(&serde_json::json!({ "hourly": hourly, "forecast": forecast })).ok()
}

/// True when this window may use the weather command.
pub fn wall2_only(label: &str) -> Result<(), String> {
    if label == WALL2_LABEL { Ok(()) } else { Err("forbidden".to_string()) }
}

/// The `reason` text of a failed reply, made safe for the log. It is kept only to learn which limit
/// was hit (minute, hour or day), so only ASCII letters and single spaces survive: every digit, sign
/// and punctuation mark is dropped (a place can never get through as numbers, with or without a
/// decimal point). Cut to 120 characters. Empty when the reply has no `reason`.
pub fn scrub_reason(body: &str) -> String {
    let Some(reason) = serde_json::from_str::<serde_json::Value>(body).ok().and_then(|v| v.get("reason").and_then(|r| r.as_str().map(str::to_string))) else {
        return String::new();
    };
    let letters: String = reason.chars().map(|c| if c.is_ascii_alphabetic() { c } else { ' ' }).collect();
    letters.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(REASON_CHARS).collect::<String>().trim_end().to_string()
}

/// A failed try: `<time> <source> failed <kind> <status> [<reason>]`.
pub fn failure_line(stamp: &str, source: &str, failure: Failure, reason: &str) -> String {
    if reason.is_empty() {
        format!("{stamp} {source} failed {} {}\n", failure.kind_word(), failure.status())
    } else {
        format!("{stamp} {source} failed {} {} {reason}\n", failure.kind_word(), failure.status())
    }
}

/// A success after a failed try: `<time> <source> recovered`.
pub fn recovery_line(stamp: &str, source: &str) -> String {
    format!("{stamp} {source} recovered\n")
}

/// What to write after a try: `Some(false)` for every failure, `Some(true)` for a success that
/// follows a failure, nothing for any other success.
pub fn log_event(was_failing: &mut bool, ok: bool) -> Option<bool> {
    if ok {
        let recovered = *was_failing;
        *was_failing = false;
        recovered.then_some(true)
    } else {
        *was_failing = true;
        Some(false)
    }
}

static FAILING: Mutex<[bool; 2]> = Mutex::new([false, false]);

fn unix_now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn record(source: &'static str, result: &Result<(), (Failure, String)>) {
    let slot = usize::from(source == NWS);
    let mut failing = FAILING.lock().unwrap_or_else(|e| e.into_inner());
    let Some(recovered) = log_event(&mut failing[slot], result.is_ok()) else { return };
    let stamp = crate::wall2_sonos_log::stamp(unix_now());
    let line = match result {
        Err((failure, reason)) if !recovered => failure_line(&stamp, source, *failure, reason),
        _ => recovery_line(&stamp, source),
    };
    if let Some(tx) = TX.get() {
        let _ = tx.try_send(line);
    }
}

/// Starts the log next to the other wall logs. Without a folder nothing is logged.
pub fn start_log(dir: Option<std::path::PathBuf>) {
    let Some(dir) = dir else { return };
    if let Some(tx) = crate::wall2_sonos_log::start_named(&dir, NAME, OLDER, "wall2-weather-log") {
        let _ = TX.set(tx);
    }
}

fn transport_of(t: &ureq::Transport) -> Failure {
    use std::error::Error;
    let kind = match t.kind() {
        ureq::ErrorKind::Dns => Transport::Dns,
        ureq::ErrorKind::ConnectionFailed => Transport::ConnectionFailed,
        ureq::ErrorKind::Io => Transport::Io,
        ureq::ErrorKind::BadStatus => Transport::BadStatus,
        _ => Transport::Other,
    };
    let timed_out = t
        .source()
        .and_then(|s| s.downcast_ref::<std::io::Error>())
        .map_or(false, |e| matches!(e.kind(), std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock));
    map_transport(kind, t.message(), timed_out)
}

/// One GET. Any answer outside 2xx is `Http(status)` with the start of its body as the reason.
fn get(url: &str, accept: &str) -> Result<String, (Failure, String)> {
    use std::io::Read;
    let result = crate::wall2_feeds::agent().get(url).set("User-Agent", USER_AGENT).set("Accept", accept).call();
    let resp = match result {
        Ok(resp) if (200..300).contains(&resp.status()) => resp,
        Ok(resp) => return Err((Failure::Http(resp.status()), String::new())),
        Err(ureq::Error::Status(code, resp)) => {
            let mut buf = Vec::new();
            let _ = resp.into_reader().take(REASON_READ_BYTES).read_to_end(&mut buf);
            return Err((Failure::Http(code), scrub_reason(&String::from_utf8_lossy(&buf))));
        }
        Err(ureq::Error::Transport(t)) => return Err((transport_of(&t), String::new())),
    };
    let bytes = crate::wall2_feeds::read_body(resp).map_err(|_| (Failure::Read, String::new()))?;
    String::from_utf8(bytes).map_err(|_| (Failure::Read, String::new()))
}

/// The point lookup's two addresses, remembered for the last place asked (kept in memory only).
static POINT: Mutex<Option<(String, String, Option<String>)>> = Mutex::new(None);

fn point_is_gone(result: &Result<String, (Failure, String)>) -> bool {
    matches!(result, Err((Failure::Http(404 | 410), _)))
}

fn forget_gone_point(result: &Result<String, (Failure, String)>) {
    if point_is_gone(result) {
        *POINT.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }
}

fn read_nws(latitude: f64, longitude: f64) -> Result<String, (Failure, String)> {
    let key = format!("{latitude:.4},{longitude:.4}");
    let cached = POINT.lock().unwrap_or_else(|e| e.into_inner()).as_ref().filter(|(k, _, _)| *k == key).map(|(_, h, f)| (h.clone(), f.clone()));
    let (hourly_url, forecast_url) = match cached {
        Some(u) => u,
        None => {
            let points = get(&nws_points_url(latitude, longitude), "application/geo+json")?;
            let u = nws_urls_from_points(&points).ok_or((Failure::Read, String::new()))?;
            *POINT.lock().unwrap_or_else(|e| e.into_inner()) = Some((key, u.0.clone(), u.1.clone()));
            u
        }
    };
    let hourly = get(&hourly_url, "application/geo+json");
    // Either remembered address being gone requires a fresh point next time.
    forget_gone_point(&hourly);
    let hourly = hourly?;
    // The 12 hour forecast gives the day's high and low; without it the page falls back to the hours still ahead.
    let forecast = forecast_url.and_then(|u| {
        let result = get(&u, "application/geo+json");
        forget_gone_point(&result);
        result.ok()
    });
    combine_nws(&hourly, forecast.as_deref()).ok_or((Failure::Read, String::new()))
}

/// Reads the forecast from `source` (`open-meteo` or `nws`) and returns the reply text for the
/// page to parse. The error is the failure text: `dns`, `connect`, `tls`, `timeout`,
/// `http <status>`, `read` or `input`. Wall 2 only.
#[tauri::command]
pub async fn wall2_weather(window: tauri::WebviewWindow, latitude: f64, longitude: f64, source: String) -> Result<String, String> {
    wall2_only(window.label())?;
    let which: &'static str = match source.as_str() {
        OPEN_METEO => OPEN_METEO,
        NWS => NWS,
        _ => return Err(Failure::Input.code()),
    };
    validate(latitude, longitude).map_err(Failure::code)?;
    tauri::async_runtime::spawn_blocking(move || {
        let result = if which == NWS { read_nws(latitude, longitude) } else { get(&open_meteo_url(latitude, longitude), "application/json") };
        record(which, &result.as_ref().map(|_| ()).map_err(|e| e.clone()));
        result.map_err(|(failure, _)| failure.code())
    })
    .await
    .map_err(|_| Failure::Read.code())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_missing_point_addresses_invalidate_the_cache() {
        for (failure, gone) in [
            (Failure::Http(404), true), (Failure::Http(410), true),
            (Failure::Http(403), false), (Failure::Http(500), false),
            (Failure::Connect, false), (Failure::Timeout, false),
        ] {
            assert_eq!(point_is_gone(&Err((failure, String::new()))), gone);
        }
        assert!(!point_is_gone(&Ok(String::new())));
    }

    #[test]
    fn coordinates_must_be_finite_and_in_range() {
        assert_eq!(validate(0.0, 0.0), Ok(()));
        assert_eq!(validate(90.0, 180.0), Ok(()));
        assert_eq!(validate(-90.0, -180.0), Ok(()));
        assert_eq!(validate(90.1, 0.0), Err(Failure::Input));
        assert_eq!(validate(0.0, 180.1), Err(Failure::Input));
        assert_eq!(validate(-91.0, 0.0), Err(Failure::Input));
        assert_eq!(validate(f64::NAN, 0.0), Err(Failure::Input));
        assert_eq!(validate(0.0, f64::INFINITY), Err(Failure::Input));
        assert_eq!(validate(f64::NEG_INFINITY, 0.0), Err(Failure::Input));
    }

    #[test]
    fn the_failure_texts_are_the_words_the_page_knows() {
        assert_eq!(Failure::Dns.code(), "dns");
        assert_eq!(Failure::Connect.code(), "connect");
        assert_eq!(Failure::Tls.code(), "tls");
        assert_eq!(Failure::Timeout.code(), "timeout");
        assert_eq!(Failure::Http(429).code(), "http 429");
        assert_eq!(Failure::Read.code(), "read");
        assert_eq!(Failure::Input.code(), "input");
    }

    #[test]
    fn transport_errors_map_to_their_kind() {
        assert_eq!(map_transport(Transport::Dns, Some("Dns Failed"), false), Failure::Dns);
        assert_eq!(map_transport(Transport::ConnectionFailed, Some("Connect error"), false), Failure::Connect);
        assert_eq!(map_transport(Transport::ConnectionFailed, Some("tls connection init failed"), false), Failure::Tls);
        assert_eq!(map_transport(Transport::Io, Some("tls connection creation failed"), false), Failure::Tls);
        assert_eq!(map_transport(Transport::Io, None, true), Failure::Timeout);
        assert_eq!(map_transport(Transport::ConnectionFailed, Some("Connect error"), true), Failure::Timeout);
        assert_eq!(map_transport(Transport::Io, None, false), Failure::Read);
        assert_eq!(map_transport(Transport::BadStatus, None, false), Failure::Read);
        assert_eq!(map_transport(Transport::Other, None, false), Failure::Read);
    }

    #[test]
    fn the_open_meteo_address_matches_the_page() {
        assert_eq!(
            open_meteo_url(12.5, -45.25),
            "https://api.open-meteo.com/v1/forecast?latitude=12.5&longitude=-45.25&current=temperature_2m,weather_code,is_day,wind_speed_10m,wind_gusts_10m&hourly=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=2"
        );
    }

    #[test]
    fn the_open_meteo_address_asks_for_wind_in_mph() {
        let address = open_meteo_url(12.5, -45.25);
        let current = address.split('&').find(|item| item.starts_with("current=")).unwrap();
        let hourly = address.split('&').find(|item| item.starts_with("hourly=")).unwrap();

        assert!(current.contains("wind_speed_10m,wind_gusts_10m"));
        assert!(address.contains("wind_speed_unit=mph"));
        assert!(!hourly.contains("wind"));
    }

    #[test]
    fn the_weather_service_point_address_has_four_decimals() {
        assert_eq!(nws_points_url(12.5, -45.123456), "https://api.weather.gov/points/12.5000,-45.1235");
    }

    #[test]
    fn only_the_weather_services_own_addresses_are_followed() {
        let good = r#"{"properties":{"forecastHourly":"https://api.weather.gov/gridpoints/AAA/1,2/forecast/hourly","forecast":"https://api.weather.gov/gridpoints/AAA/1,2/forecast"}}"#;
        assert_eq!(
            nws_urls_from_points(good),
            Some(("https://api.weather.gov/gridpoints/AAA/1,2/forecast/hourly".to_string(), Some("https://api.weather.gov/gridpoints/AAA/1,2/forecast".to_string())))
        );
        // A foreign 12 hour address is dropped, the hourly one stays; a foreign hourly one drops both.
        let foreign_forecast = r#"{"properties":{"forecastHourly":"https://api.weather.gov/g/h","forecast":"https://example.org/f"}}"#;
        assert_eq!(nws_urls_from_points(foreign_forecast), Some(("https://api.weather.gov/g/h".to_string(), None)));
        let no_forecast = r#"{"properties":{"forecastHourly":"https://api.weather.gov/g/h"}}"#;
        assert_eq!(nws_urls_from_points(no_forecast), Some(("https://api.weather.gov/g/h".to_string(), None)));
        for bad in [
            r#"{"properties":{"forecastHourly":"https://example.org/x","forecast":"https://api.weather.gov/f"}}"#,
            r#"{"properties":{"forecastHourly":"http://api.weather.gov/x"}}"#,
            r#"{"properties":{"forecastHourly":"https://api.weather.gov.example.org/x"}}"#,
            r#"{"properties":{"forecastHourly":"https://api.weather.gov/x y"}}"#,
            r#"{"properties":{"forecast":"https://api.weather.gov/f"}}"#,
            r#"{"properties":{}}"#,
            r#"{"properties":{"forecastHourly":5}}"#,
            "not json",
        ] {
            assert_eq!(nws_urls_from_points(bad), None, "{bad}");
        }
    }

    #[test]
    fn the_second_source_reply_holds_both_forecasts_or_a_null_forecast() {
        let both = combine_nws(r#"{"properties":{"periods":[]}}"#, Some(r#"{"properties":{"periods":[1]}}"#)).unwrap();
        let v: serde_json::Value = serde_json::from_str(&both).unwrap();
        assert_eq!(v["hourly"]["properties"]["periods"], serde_json::json!([]));
        assert_eq!(v["forecast"]["properties"]["periods"], serde_json::json!([1]));
        let only_hourly = combine_nws(r#"{"a":1}"#, None).unwrap();
        let v: serde_json::Value = serde_json::from_str(&only_hourly).unwrap();
        assert_eq!(v["hourly"]["a"], 1);
        assert!(v["forecast"].is_null());
        // A 12 hour reply that is not JSON is the same as none; an hourly reply that is not JSON is a failure.
        assert!(combine_nws(r#"{"a":1}"#, Some("oops")).unwrap().contains(r#""forecast":null"#));
        assert_eq!(combine_nws("oops", Some("{}")), None);
    }

    #[test]
    fn only_the_second_window_may_read() {
        assert_eq!(wall2_only("wall2"), Ok(()));
        assert_eq!(wall2_only("main"), Err("forbidden".to_string()));
        assert_eq!(wall2_only(""), Err("forbidden".to_string()));
    }

    #[test]
    fn the_reason_keeps_letters_only_so_no_coordinate_can_pass() {
        // The three limit words survive.
        for (body, kept) in [
            (r#"{"error":true,"reason":"Minutely API request limit exceeded. Please try again in a minute."}"#, "Minutely API request limit exceeded Please try again in a minute"),
            (r#"{"error":true,"reason":"Hourly API request limit exceeded. Please try again in the next hour."}"#, "Hourly API request limit exceeded Please try again in the next hour"),
            (r#"{"error":true,"reason":"Daily API request limit exceeded. Please try again tomorrow."}"#, "Daily API request limit exceeded Please try again tomorrow"),
        ] {
            assert_eq!(scrub_reason(body), kept);
        }
        // Whole numbers with and without a space, mixed with decimals, signs, brackets and key=value forms.
        let cases = [
            (r#"{"reason":"No data for 47, -122 today"}"#, "No data for today"),
            (r#"{"reason":"No data for 47,-122 today"}"#, "No data for today"),
            (r#"{"reason":"No data for 47.6, -122 today"}"#, "No data for today"),
            (r#"{"reason":"No data for 47 -122.33 today"}"#, "No data for today"),
            (r#"{"reason":"Bad point (47,-122) or +47 or -122"}"#, "Bad point or or"),
            (r#"{"reason":"Out of range lat=47 lon=-122"}"#, "Out of range lat lon"),
            (r#"{"reason":"latitude=47.5&longitude=-122.5 rejected"}"#, "latitude longitude rejected"),
            (r#"{"reason":"Limit 10000 per day"}"#, "Limit per day"),
        ];
        for (body, kept) in cases {
            let got = scrub_reason(body);
            assert_eq!(got, kept);
            assert!(!got.chars().any(|c| c.is_ascii_digit() || matches!(c, '-' | '+' | '.' | ',' | '(' | ')' | '=')));
        }
    }

    #[test]
    fn the_reason_is_cut_to_120_characters_and_plain_ascii() {
        let long = format!(r#"{{"reason":"{}"}}"#, "word ".repeat(60));
        let got = scrub_reason(&long);
        // 24 words of five characters fill 120 characters; the trailing space is dropped.
        assert_eq!(got.chars().count(), 119);
        assert!(!got.ends_with(' '));
        let odd = r#"{"reason":"café \u0007 limit"}"#;
        assert_eq!(scrub_reason(odd), "caf limit");
        assert_eq!(scrub_reason(r#"{"reason":"12 34"}"#), "");
        assert_eq!(scrub_reason("not json"), "");
        assert_eq!(scrub_reason(r#"{"error":true}"#), "");
        assert_eq!(scrub_reason(r#"{"reason":5}"#), "");
    }

    #[test]
    fn log_lines_hold_a_time_a_source_a_kind_and_a_status() {
        assert_eq!(failure_line("T", "open-meteo", Failure::Http(429), "Hourly limit"), "T open-meteo failed http 429 Hourly limit\n");
        assert_eq!(failure_line("T", "open-meteo", Failure::Http(429), ""), "T open-meteo failed http 429\n");
        assert_eq!(failure_line("T", "nws", Failure::Dns, ""), "T nws failed dns 0\n");
        assert_eq!(recovery_line("T", "nws"), "T nws recovered\n");
    }

    #[test]
    fn every_failure_is_logged_and_a_success_only_after_a_failure() {
        let mut failing = false;
        assert_eq!(log_event(&mut failing, true), None);
        assert_eq!(log_event(&mut failing, false), Some(false));
        assert_eq!(log_event(&mut failing, false), Some(false));
        assert_eq!(log_event(&mut failing, true), Some(true));
        assert_eq!(log_event(&mut failing, true), None);
    }
}
