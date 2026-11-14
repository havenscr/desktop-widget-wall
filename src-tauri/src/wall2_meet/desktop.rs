use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum OpenDecision {
    DesktopItem,
    DesktopCalendar,
    Web,
}

pub fn open_decision(classic_usable: bool, has_entry: bool, desktop_enabled: bool) -> OpenDecision {
    match (classic_usable, has_entry, desktop_enabled) {
        (true, true, true) => OpenDecision::DesktopItem,
        (true, false, true) => OpenDecision::DesktopCalendar,
        _ => OpenDecision::Web,
    }
}

pub fn select_arg(hex: &str) -> Option<String> {
    if !(40..=1024).contains(&hex.len()) || hex.len() % 2 != 0 || !hex.bytes().all(|byte| byte.is_ascii_digit() || (b'A'..=b'F').contains(&byte)) {
        return None;
    }
    Some(format!("outlook:{hex}"))
}

pub fn valid_outlook_path(path: &Path, exists_as_file: bool) -> bool {
    let text = path.as_os_str().to_string_lossy();
    valid_outlook_path_parts(&text, path.is_absolute(), exists_as_file)
        && path.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.eq_ignore_ascii_case("OUTLOOK.EXE"))
}

pub fn valid_outlook_path_parts(text: &str, absolute: bool, exists_as_file: bool) -> bool {
    absolute
        && text.len() <= 260
        && !text.contains('"')
        && !text.chars().any(char::is_control)
        && text.rsplit(['\\', '/']).next().is_some_and(|name| name.eq_ignore_ascii_case("OUTLOOK.EXE"))
        && exists_as_file
}

#[cfg(windows)]
mod windows_impl {
    use super::{valid_outlook_path, PathBuf};
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{
        RegGetValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD, RRF_RT_REG_SZ,
    };

    fn registry_string(root: HKEY) -> Option<String> {
        let mut buf = vec![0u16; 262];
        let mut bytes = (buf.len() * 2) as u32;
        let status = unsafe {
            RegGetValueW(
                root,
                w!("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\OUTLOOK.EXE"),
                PCWSTR::null(),
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

    pub fn classic_outlook_exe() -> Option<PathBuf> {
        if use_new_outlook() {
            return None;
        }
        [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER].into_iter().find_map(|root| {
            let path = PathBuf::from(registry_string(root)?);
            valid_outlook_path(&path, path.is_file()).then_some(path)
        })
    }
}

#[cfg(windows)]
pub use windows_impl::classic_outlook_exe;
#[cfg(windows)]
pub use windows_impl::use_new_outlook;

#[cfg(not(windows))]
pub fn classic_outlook_exe() -> Option<PathBuf> {
    None
}

#[cfg(not(windows))]
pub fn use_new_outlook() -> bool {
    false
}

pub fn new_outlook_present() -> bool {
    std::env::var_os("LOCALAPPDATA").is_some_and(|base| PathBuf::from(base).join("Microsoft").join("Olk").is_dir())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn select_argument_accepts_only_bounded_uppercase_hex() {
        assert_eq!(select_arg(&"AB".repeat(20)), Some(format!("outlook:{}", "AB".repeat(20))));
        for bad in ["ab".repeat(20), "A".repeat(41), "A ".repeat(20), "A\"".repeat(20), "A/".repeat(20), "-A".repeat(20), "calendar".to_string(), "AA".repeat(513)] {
            assert!(select_arg(&bad).is_none(), "accepted {bad:?}");
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

    #[cfg(windows)]
    #[test]
    fn outlook_path_validation_is_exact() {
        assert!(valid_outlook_path(Path::new(r"C:\Program Files\Microsoft Office\root\Office16\OUTLOOK.EXE"), true));
        for bad in [
            r"Office16\OUTLOOK.EXE".to_string(),
            r#"C:\Office16\"OUTLOOK.EXE""#.to_string(),
            r"C:\Office16\olk.exe".to_string(),
            r"C:\Office16\OUTLOOK.EXE.bak".to_string(),
            format!(r"C:\{}\OUTLOOK.EXE", "a".repeat(260)),
            "C:\\Office16\\OUTLOOK.EXE\n".to_string(),
        ] {
            assert!(!valid_outlook_path(Path::new(&bad), true), "accepted {bad:?}");
        }
        assert!(!valid_outlook_path(Path::new(r"C:\Office16\OUTLOOK.EXE"), false));
    }
}
