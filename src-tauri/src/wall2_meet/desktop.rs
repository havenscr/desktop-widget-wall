use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum OpenDecision {
    DesktopItem,
    DesktopCalendar,
    Web,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum OpenError {
    Gone,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RegistryRoot {
    Machine,
    User,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RegistryView {
    Default,
    Wow32,
}

pub const fn registry_lookup_order() -> [(RegistryRoot, RegistryView); 4] {
    [
        (RegistryRoot::Machine, RegistryView::Default),
        (RegistryRoot::Machine, RegistryView::Wow32),
        (RegistryRoot::User, RegistryView::Default),
        (RegistryRoot::User, RegistryView::Wow32),
    ]
}

pub fn open_decision(classic_usable: bool, has_entry: bool, desktop_enabled: bool) -> OpenDecision {
    match (classic_usable, has_entry, desktop_enabled) {
        (true, true, true) => OpenDecision::DesktopItem,
        (true, false, true) => OpenDecision::DesktopCalendar,
        _ => OpenDecision::Web,
    }
}

/// Fixed target for the new Outlook app: its Calendar. New Outlook has no documented way to
/// open one event, so a meeting click lands here. Nothing from the page is ever added to it.
pub const NEW_OUTLOOK_CALENDAR: &str = "outlookcal:";

/// The documented mailto ProgId of the new Outlook (exact match, any letter case).
pub const NEW_OUTLOOK_PROGID: &str = "AppXbx2ce4vcxjdhff3d1ms66qqzk12zn827";

pub fn is_new_outlook_progid(progid: &str) -> bool {
    progid.eq_ignore_ascii_case(NEW_OUTLOOK_PROGID)
}

/// New Outlook counts as in use when any one signal says so, checked cheapest first and
/// stopping at the first yes: the mailto default app is the new Outlook, the classic Outlook
/// toggle is set to new, or olk.exe is running (the last one scans process names).
pub fn new_outlook_decision(mailto_is_new: impl FnOnce() -> bool, toggle_is_new: impl FnOnce() -> bool, olk_running: impl FnOnce() -> bool) -> bool {
    mailto_is_new() || toggle_is_new() || olk_running()
}

pub fn select_arg(hex: &str) -> Option<String> {
    if !(40..=1024).contains(&hex.len()) || hex.len() % 2 != 0 || !hex.bytes().all(|byte| byte.is_ascii_digit() || (b'A'..=b'F').contains(&byte)) {
        return None;
    }
    Some(format!("outlook:{hex}"))
}

pub fn valid_outlook_path(path: &Path, exists_as_file: impl FnOnce(&Path) -> bool) -> bool {
    let text = path.as_os_str().to_string_lossy();
    // Every pure check runs before the disk closure can be reached.
    path.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.eq_ignore_ascii_case("OUTLOOK.EXE"))
        && valid_outlook_path_parts(&text, path.is_absolute(), || exists_as_file(path))
}

pub fn valid_outlook_path_parts(text: &str, absolute: bool, exists_as_file: impl FnOnce() -> bool) -> bool {
    absolute
        && text.len() <= 260
        && starts_with_drive(text)
        && !text.starts_with("\\\\")
        && !text.starts_with("//")
        && !text.contains('"')
        && !text.chars().any(char::is_control)
        && text.rsplit(['\\', '/']).next().is_some_and(|name| name.eq_ignore_ascii_case("OUTLOOK.EXE"))
        && exists_as_file()
}

/// A drive letter, a colon and a separator. A path that starts with a separator, in any mix, is
/// refused: Windows reads `\/server/share` and `/\server\share` as network paths.
fn starts_with_drive(text: &str) -> bool {
    matches!(text.as_bytes(), [letter, b':', b'\\' | b'/', ..] if letter.is_ascii_alphabetic())
}

#[allow(clippy::too_many_arguments)]
pub fn open_with<Find, Launch, LaunchNew, Open>(
    desktop_enabled: bool,
    new_outlook: bool,
    entry: Option<&str>,
    web: Option<&str>,
    mut find: Find,
    mut launch: Launch,
    mut launch_new: LaunchNew,
    mut open: Open,
) -> Result<(), OpenError>
where
    Find: FnMut() -> Option<PathBuf>,
    Launch: FnMut(&Path, &str) -> bool,
    LaunchNew: FnMut(&str) -> bool,
    Open: FnMut(&str) -> bool,
{
    if desktop_enabled {
        if new_outlook && launch_new(NEW_OUTLOOK_CALENDAR) {
            return Ok(());
        }
        if let Some(exe) = find() {
            let arg = entry.and_then(select_arg).unwrap_or_else(|| "outlook:calendar".to_string());
            if launch(&exe, &arg) {
                return Ok(());
            }
        }
    }
    match web {
        Some(url) if open(url) => Ok(()),
        Some(_) => Err(OpenError::Failed),
        None => Err(OpenError::Gone),
    }
}

#[cfg(windows)]
mod windows_impl {
    use super::{is_new_outlook_progid, new_outlook_decision, registry_lookup_order, valid_outlook_path, PathBuf, RegistryRoot, RegistryView};
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{
        RegGetValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD, RRF_RT_REG_SZ, RRF_SUBKEY_WOW6432KEY,
    };

    fn registry_string(root: HKEY, view: RegistryView) -> Option<String> {
        let mut buf = vec![0u16; 262];
        let mut bytes = (buf.len() * 2) as u32;
        let status = unsafe {
            RegGetValueW(
                root,
                w!("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\OUTLOOK.EXE"),
                PCWSTR::null(),
                if view == RegistryView::Wow32 { RRF_RT_REG_SZ | RRF_SUBKEY_WOW6432KEY } else { RRF_RT_REG_SZ },
                None,
                Some(buf.as_mut_ptr().cast()),
                Some(&mut bytes),
            )
        };
        if status != ERROR_SUCCESS {
            return None;
        }
        let len = ((bytes as usize) / 2).min(buf.len());
        let end = buf[..len].iter().position(|&unit| unit == 0).unwrap_or(len);
        Some(String::from_utf16_lossy(&buf[..end]))
    }

    pub fn use_new_outlook() -> bool {
        let mut value = 0u32;
        let mut bytes = std::mem::size_of::<u32>() as u32;
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                w!("Software\\Microsoft\\Office\\16.0\\Outlook\\Preferences"),
                w!("UseNewOutlook"),
                RRF_RT_REG_DWORD,
                None,
                Some((&mut value as *mut u32).cast()),
                Some(&mut bytes),
            )
        };
        status == ERROR_SUCCESS && value == 1
    }

    fn mailto_progid() -> Option<String> {
        let mut buf = vec![0u16; 130];
        let mut bytes = (buf.len() * 2) as u32;
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                w!("Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\mailto\\UserChoice"),
                w!("ProgId"),
                RRF_RT_REG_SZ,
                None,
                Some(buf.as_mut_ptr().cast()),
                Some(&mut bytes),
            )
        };
        if status != ERROR_SUCCESS {
            return None;
        }
        let len = ((bytes as usize) / 2).min(buf.len());
        let end = buf[..len].iter().position(|&unit| unit == 0).unwrap_or(len);
        Some(String::from_utf16_lossy(&buf[..end]))
    }

    fn olk_running() -> bool {
        let mut system = sysinfo::System::new();
        system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        system.processes().values().any(|p| p.name().to_string_lossy().eq_ignore_ascii_case("olk.exe"))
    }

    /// Cached for 60 seconds so a burst of clicks scans at most once.
    pub fn new_outlook_in_use() -> bool {
        static CACHE: std::sync::Mutex<Option<(std::time::Instant, bool)>> = std::sync::Mutex::new(None);
        let mut cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((at, value)) = *cache {
            if at.elapsed() < std::time::Duration::from_secs(60) {
                return value;
            }
        }
        let value = new_outlook_decision(|| mailto_progid().is_some_and(|id| is_new_outlook_progid(&id)), use_new_outlook, olk_running);
        *cache = Some((std::time::Instant::now(), value));
        value
    }

    pub fn classic_outlook_exe() -> Option<PathBuf> {
        if use_new_outlook() {
            return None;
        }
        registry_lookup_order().into_iter().find_map(|(root, view)| {
            let root = match root { RegistryRoot::Machine => HKEY_LOCAL_MACHINE, RegistryRoot::User => HKEY_CURRENT_USER };
            let path = PathBuf::from(registry_string(root, view)?);
            valid_outlook_path(&path, |candidate| candidate.is_file()).then_some(path)
        })
    }
}

#[cfg(windows)]
pub use windows_impl::classic_outlook_exe;
#[cfg(windows)]
pub use windows_impl::use_new_outlook;
#[cfg(windows)]
pub use windows_impl::new_outlook_in_use;

#[cfg(not(windows))]
pub fn classic_outlook_exe() -> Option<PathBuf> {
    None
}

#[cfg(not(windows))]
pub fn use_new_outlook() -> bool {
    false
}

#[cfg(not(windows))]
pub fn new_outlook_in_use() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn select_argument_accepts_only_bounded_uppercase_hex() {
        assert!(select_arg(&"A".repeat(38)).is_none());
        assert_eq!(select_arg(&"AB".repeat(20)), Some(format!("outlook:{}", "AB".repeat(20))));
        assert!(select_arg(&"A".repeat(1024)).is_some());
        assert!(select_arg(&"A".repeat(1026)).is_none());
        for bad in ["ab".repeat(20), "A".repeat(41), "A ".repeat(20), "A\"".repeat(20), "A/".repeat(20), "-A".repeat(20), "calendar".to_string()] {
            assert!(select_arg(&bad).is_none(), "accepted {bad:?}");
        }
    }

    #[test]
    fn registry_views_are_tried_machine_then_user() {
        assert_eq!(registry_lookup_order(), [
            (RegistryRoot::Machine, RegistryView::Default),
            (RegistryRoot::Machine, RegistryView::Wow32),
            (RegistryRoot::User, RegistryView::Default),
            (RegistryRoot::User, RegistryView::Wow32),
        ]);
    }

    #[test]
    fn path_core_refuses_network_device_and_other_bad_paths() {
        assert!(valid_outlook_path_parts(r"C:\Office\OUTLOOK.EXE", true, || true));
        for bad in [r"\\server\share\OUTLOOK.EXE", r"\\?\C:\Office\OUTLOOK.EXE", r"\\.\C:\Office\OUTLOOK.EXE", "//server/share/OUTLOOK.EXE"] {
            assert!(!valid_outlook_path_parts(bad, true, || panic!("checked disk for {bad}")), "accepted {bad}");
        }
    }

    #[test]
    fn path_core_requires_a_drive_letter_and_separator() {
        assert!(valid_outlook_path_parts(r"C:\Office\OUTLOOK.EXE", true, || true));
        assert!(valid_outlook_path_parts("d:/Office/OUTLOOK.EXE", true, || true));
        for bad in [
            r"\/server/share/OUTLOOK.EXE",
            r"/\server\share\OUTLOOK.EXE",
            "//server/share/OUTLOOK.EXE",
            r"\\server\share\OUTLOOK.EXE",
            r"\Office\OUTLOOK.EXE",
            "/Office/OUTLOOK.EXE",
            r"C:OUTLOOK.EXE",
            r"1:\Office\OUTLOOK.EXE",
        ] {
            assert!(!valid_outlook_path_parts(bad, true, || panic!("checked disk for {bad}")), "accepted {bad}");
        }
    }

    #[test]
    fn wrapper_never_reaches_the_disk_for_a_bad_path() {
        for bad in [
            r"C:\Office\NOTEPAD.EXE",
            r"\/server/share/OUTLOOK.EXE",
            r"/\server\share\OUTLOOK.EXE",
            "//server/share/OUTLOOK.EXE",
            r"\\server\share\OUTLOOK.EXE",
            "OUTLOOK.EXE",
        ] {
            assert!(!valid_outlook_path(Path::new(bad), |_| panic!("checked disk for {bad}")), "accepted {bad}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn wrapper_checks_the_disk_once_for_a_good_path() {
        let mut calls = 0;
        assert!(valid_outlook_path(Path::new(r"C:\Office\OUTLOOK.EXE"), |_| { calls += 1; true }));
        assert_eq!(calls, 1);
        assert!(!valid_outlook_path(Path::new(r"C:\Office\OUTLOOK.EXE"), |_| false));
    }

    #[test]
    fn path_core_checks_shape_before_the_disk() {
        let bad = [
            (r"C:\Office\NOTEPAD.EXE".to_string(), true),
            (format!(r"C:\{}\OUTLOOK.EXE", "a".repeat(260)), true),
            (r#"C:\Office\"OUTLOOK.EXE""#.to_string(), true),
            ("C:\\Office\\OUTLOOK.EXE\n".to_string(), true),
            (r"C:\Office\OUTLOOK.EXE".to_string(), false),
        ];
        for (path, absolute) in bad {
            assert!(!valid_outlook_path_parts(&path, absolute, || panic!("checked disk for {path:?}")));
        }
        let mut calls = 0;
        assert!(valid_outlook_path_parts(r"C:\Office\OUTLOOK.EXE", true, || { calls += 1; true }));
        assert_eq!(calls, 1);
        assert!(!valid_outlook_path_parts(r"C:\Office\OUTLOOK.EXE", true, || false));
    }

    #[test]
    fn click_sequence_has_exact_side_effects() {
        for enabled in [false, true] {
            for new_outlook in [false, true] {
                for classic in [false, true] {
                    for entry in [false, true] {
                        for web in [false, true] {
                            for launch_ok in [false, true] {
                                for new_ok in [false, true] {
                                    let entry_value = "AB".repeat(20);
                                    let mut finds = 0;
                                    let mut launches = 0;
                                    let mut new_launches = 0;
                                    let mut opens = 0;
                                    let result = open_with(
                                        enabled,
                                        new_outlook,
                                        entry.then_some(entry_value.as_str()),
                                        web.then_some("https://outlook.office.com/item"),
                                        || { finds += 1; classic.then(|| PathBuf::from(r"C:\Office\OUTLOOK.EXE")) },
                                        |_, _| { launches += 1; launch_ok },
                                        |target| { assert_eq!(target, "outlookcal:"); new_launches += 1; new_ok },
                                        |_| { opens += 1; true },
                                    );
                                    let tried_new = enabled && new_outlook;
                                    let new_done = tried_new && new_ok;
                                    let tried_classic = enabled && !new_done && classic;
                                    let classic_done = tried_classic && launch_ok;
                                    assert_eq!(new_launches, usize::from(tried_new));
                                    assert_eq!(finds, usize::from(enabled && !new_done));
                                    assert_eq!(launches, usize::from(tried_classic));
                                    assert_eq!(opens, usize::from(web && !new_done && !classic_done));
                                    assert_eq!(result.is_ok(), new_done || classic_done || web);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn new_outlook_target_is_the_fixed_calendar_scheme() {
        assert_eq!(NEW_OUTLOOK_CALENDAR, "outlookcal:");
    }

    #[test]
    fn new_outlook_progid_is_an_exact_match() {
        assert!(is_new_outlook_progid("AppXbx2ce4vcxjdhff3d1ms66qqzk12zn827"));
        assert!(is_new_outlook_progid("appxbx2ce4vcxjdhff3d1ms66qqzk12zn827"));
        for bad in [
            "",
            "AppXbx2ce4vcxjdhff3d1ms66qqzk12zn82",
            "AppXbx2ce4vcxjdhff3d1ms66qqzk12zn8277",
            "xAppXbx2ce4vcxjdhff3d1ms66qqzk12zn827",
            " AppXbx2ce4vcxjdhff3d1ms66qqzk12zn827",
            "Outlook.URL.mailto.15",
            "ChromeHTML",
        ] {
            assert!(!is_new_outlook_progid(bad), "accepted {bad:?}");
        }
    }

    #[test]
    fn new_outlook_decision_is_true_when_any_signal_is_true_and_stops_at_the_first() {
        for a in [false, true] {
            for b in [false, true] {
                for c in [false, true] {
                    let calls = [std::cell::Cell::new(0usize), std::cell::Cell::new(0usize), std::cell::Cell::new(0usize)];
                    let got = new_outlook_decision(|| { calls[0].set(calls[0].get() + 1); a }, || { calls[1].set(calls[1].get() + 1); b }, || { calls[2].set(calls[2].get() + 1); c });
                    assert_eq!(got, a || b || c);
                    assert_eq!(calls[0].get(), 1);
                    assert_eq!(calls[1].get(), usize::from(!a));
                    assert_eq!(calls[2].get(), usize::from(!a && !b));
                }
            }
        }
    }

    #[test]
    fn opening_order_covers_every_combination() {
        for classic in [false, true] {
            for entry in [false, true] {
                for enabled in [false, true] {
                    let expected = if classic && enabled {
                        if entry { OpenDecision::DesktopItem } else { OpenDecision::DesktopCalendar }
                    } else {
                        OpenDecision::Web
                    };
                    assert_eq!(open_decision(classic, entry, enabled), expected);
                }
            }
        }
    }

    #[test]
    fn outlook_path_validation_core_is_exact() {
        assert!(valid_outlook_path_parts(r"C:\Program Files\Microsoft Office\root\Office16\OUTLOOK.EXE", true, || true));
        for bad in [
            r"Office16\OUTLOOK.EXE".to_string(),
            r#"C:\Office16\"OUTLOOK.EXE""#.to_string(),
            r"C:\Office16\olk.exe".to_string(),
            r"C:\Office16\OUTLOOK.EXE.bak".to_string(),
            format!(r"C:\{}\OUTLOOK.EXE", "a".repeat(260)),
            "C:\\Office16\\OUTLOOK.EXE\n".to_string(),
        ] {
            assert!(!valid_outlook_path_parts(&bad, !bad.starts_with("Office16"), || true), "accepted {bad:?}");
        }
        assert!(!valid_outlook_path_parts(r"C:\Office16\OUTLOOK.EXE", true, || false));
    }
}
