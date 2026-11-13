fn main() {
    // Which build is running: the first 7 characters of the commit (`dev` outside CI) and the
    // UTC build time to the minute, read at run time by `wall2_build_info`.
    let commit = std::env::var("GITHUB_SHA")
        .ok()
        .map(|s| s.chars().take(7).collect::<String>())
        .filter(|s| s.len() == 7 && s.chars().all(|c| c.is_ascii_hexdigit()))
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_else(|| "dev".to_string());
    println!("cargo:rustc-env=WALL2_BUILD_COMMIT={commit}");
    println!("cargo:rustc-env=WALL2_BUILD_TIME={}", utc_minute(std::time::SystemTime::now()));
    println!("cargo:rerun-if-env-changed=GITHUB_SHA");
    tauri_build::build()
}

/// `2026-11-13T09:05Z` for a point in time (civil date from days since 1970, no dependency).
fn utc_minute(t: std::time::SystemTime) -> String {
    let secs = t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}Z", rem / 3600, rem % 3600 / 60)
}
