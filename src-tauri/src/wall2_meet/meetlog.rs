//! `wall2-meet.log`: one line per account state change, in the app log directory.
//!
//! Same rules as `wall2-placement.log`: cleared at launch, size capped, write failures
//! ignored, and a writer thread so no caller ever waits on the disk. A line holds the time,
//! the account id from `meet.json`, the old state, the new state and a reason code. Nothing
//! else is ever written.

use std::sync::OnceLock;
use std::sync::mpsc::SyncSender;

const LOG_CAP: usize = 64 * 1024;

static TX: OnceLock<SyncSender<String>> = OnceLock::new();

/// One clean line: `2026-11-12T17:00:00Z hc ok unavailable graph-403`. A missing reason is
/// written as `none`. Control characters and spaces inside a field become `_`.
pub fn format_line(time: &str, id: &str, old: &str, new: &str, reason: Option<&str>) -> String {
    let clean = |s: &str| -> String { s.chars().map(|c| if c.is_control() || c == ' ' { '_' } else { c }).collect() };
    format!("{} {} {} {} {}\n", clean(time), clean(id), clean(old), clean(new), clean(reason.unwrap_or("none")))
}

/// Longest line the log will hold; a longer one is cut.
const MAX_LINE: usize = 400;

/// `format_line` plus the Graph failure details (`graph::Diag::log_fields`), capped at
/// 400 characters and still one line.
pub fn format_line_detail(time: &str, id: &str, old: &str, new: &str, reason: Option<&str>, detail: &str) -> String {
    let base = format_line(time, id, old, new, reason);
    let detail: String = detail.chars().map(|c| if c.is_control() { '_' } else { c }).collect();
    let mut line: String = format!("{} {}", base.trim_end(), detail).chars().take(MAX_LINE - 1).collect();
    line.push('\n');
    line
}

/// Create (truncate) the log in `dir` and start the writer thread. Any failure leaves it off.
pub fn start(dir: Option<std::path::PathBuf>) {
    use std::io::Write;
    let Some(dir) = dir else { return };
    let _ = std::fs::create_dir_all(&dir);
    let Ok(mut file) = std::fs::File::create(dir.join("wall2-meet.log")) else {
        return;
    };
    let (tx, rx) = std::sync::mpsc::sync_channel::<String>(64);
    let spawned = std::thread::Builder::new().name("wall2-meet-log".into()).spawn(move || {
        let mut bytes = 0usize;
        while let Ok(line) = rx.recv() {
            if bytes + line.len() > LOG_CAP {
                continue;
            }
            if file.write_all(line.as_bytes()).is_ok() {
                bytes += line.len();
            }
        }
    });
    if spawned.is_ok() {
        let _ = TX.set(tx);
    }
}

/// Queue lines. Never blocks, never panics, never reports errors.
pub fn write_all(lines: Vec<String>) {
    let Some(tx) = TX.get() else { return };
    for l in lines {
        let _ = tx.try_send(l);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_shape() {
        let l = format_line("2026-11-12T17:00:00Z", "hc", "ok", "unavailable", Some("graph-403-ErrorAccessDenied"));
        assert_eq!(l, "2026-11-12T17:00:00Z hc ok unavailable graph-403-ErrorAccessDenied\n");
        let none = format_line("2026-11-12T17:00:00Z", "hc", "start", "signed-out", None);
        assert_eq!(none, "2026-11-12T17:00:00Z hc start signed-out none\n");
    }

    #[test]
    fn a_detail_line_is_one_capped_line() {
        let l = format_line_detail("t", "ae", "start", "unavailable", Some("graph-503"), "req=next status=503");
        assert_eq!(l, "t ae start unavailable graph-503 req=next status=503\n");
        let long = format_line_detail("t", "ae", "a", "b", None, &"x".repeat(1000));
        assert!(long.len() <= 400);
        assert_eq!(long.matches('\n').count(), 1);
    }

    #[test]
    fn a_line_is_always_one_line_of_five_fields() {
        let l = format_line("t", "a\nb", "o k", "n\tw", Some("r\r\ns"));
        assert_eq!(l.matches('\n').count(), 1);
        assert_eq!(l.trim_end().split(' ').count(), 5);
    }
}
