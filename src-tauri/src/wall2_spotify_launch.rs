//! Starts Spotify when no Spotify player is open. The Start menu entry named Spotify is found by
//! name and launched (this covers the web app in Edge, the Store app and the classic app alike);
//! the `spotify:` link is used only when Windows has a handler for it. The script is fixed text:
//! nothing from the page or the network is ever put into it. The new window is then minimised.

use crate::wall2_lightsync::huesync::Shell;

pub(crate) const OPENED_APP: &str = "opened-app";
pub(crate) const OPENED_URI: &str = "opened-uri";
pub(crate) const NOT_INSTALLED: &str = "not-installed";
const FAILED: &str = "failed";

/// First Start menu entry named Spotify, else the first named like Spotify*, else the `spotify:`
/// link when it has a handler, else nothing is started.
pub(crate) const SCRIPT: &str = "$a = Get-StartApps | Where-Object { $_.Name -eq 'Spotify' } | Select-Object -First 1; \
if (-not $a) { $a = Get-StartApps | Where-Object { $_.Name -like 'Spotify*' } | Select-Object -First 1 }; \
if ($a) { Start-Process ('shell:AppsFolder\\' + $a.AppID) -WindowStyle Minimized; 'opened-app'; exit 0 }; \
if (Test-Path 'Registry::HKEY_CLASSES_ROOT\\spotify') { Start-Process 'spotify:' -WindowStyle Minimized; 'opened-uri'; exit 0 }; \
'not-installed'";

/// The last non-empty line of the script's output decides.
pub(crate) fn answer(stdout: &str) -> Result<&'static str, &'static str> {
    match stdout.lines().map(str::trim).rfind(|l| !l.is_empty()) {
        Some(OPENED_APP) => Ok(OPENED_APP),
        Some(OPENED_URI) => Ok(OPENED_URI),
        Some(NOT_INSTALLED) => Ok(NOT_INSTALLED),
        _ => Err(FAILED),
    }
}

pub(crate) fn launch_with(sh: &dyn Shell) -> Result<&'static str, &'static str> {
    answer(&sh.run(SCRIPT).ok_or(FAILED)?)
}

/// One top-level window as the minimiser sees it.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Seen {
    pub id: isize,
    pub image: String,
    pub title: String,
    pub visible: bool,
}

/// The windows to minimise: visible, not there before the launch, not the wall's own, an Edge or
/// Spotify process image, and a title with Spotify in it.
pub(crate) fn pick_new_player_windows(before: &[isize], after: &[Seen], own: &[isize]) -> Vec<isize> {
    after
        .iter()
        .filter(|w| w.visible && !before.contains(&w.id) && !own.contains(&w.id))
        .filter(|w| {
            let file = crate::wall2_winutil::exe_file_part(&w.image);
            file == "msedge.exe" || file == "spotify.exe"
        })
        .filter(|w| w.title.to_lowercase().contains("spotify"))
        .map(|w| w.id)
        .collect()
}

#[cfg(windows)]
pub(crate) struct Minimiser {
    before: Vec<isize>,
    done: Vec<isize>,
}

#[cfg(windows)]
impl Minimiser {
    /// Takes the snapshot of windows that exist now. Call before the launch.
    pub(crate) fn new() -> Self {
        Self { before: crate::wall2_winutil::sys::top_level_windows(), done: Vec::new() }
    }

    /// Minimises each new player window once, without taking focus. Returns how many were done now.
    pub(crate) fn tick(&mut self) -> usize {
        use crate::wall2_winutil::sys;
        use windows::Win32::UI::WindowsAndMessaging::{InternalGetWindowText, IsWindowVisible, ShowWindowAsync, SW_SHOWMINNOACTIVE};
        let me = std::process::id();
        let mut seen = Vec::new();
        let mut own = Vec::new();
        for id in sys::top_level_windows() {
            if self.before.contains(&id) || self.done.contains(&id) { continue }
            let pid = sys::pid_of(id);
            if pid == me { own.push(id); continue }
            let mut buf = [0u16; 256];
            let n = unsafe { InternalGetWindowText(sys::hwnd(id), &mut buf) }.max(0) as usize;
            seen.push(Seen {
                id,
                image: sys::image_path(pid).unwrap_or_default(),
                title: String::from_utf16_lossy(&buf[..n.min(buf.len())]),
                visible: unsafe { IsWindowVisible(sys::hwnd(id)) }.as_bool(),
            });
        }
        let picked = pick_new_player_windows(&self.before, &seen, &own);
        for id in &picked {
            let _ = unsafe { ShowWindowAsync(sys::hwnd(*id), SW_SHOWMINNOACTIVE) };
            self.done.push(*id);
        }
        picked.len()
    }

    pub(crate) fn count(&self) -> usize { self.done.len() }
}

/// Elsewhere there is nothing to minimise.
#[cfg(not(windows))]
pub(crate) struct Minimiser;

#[cfg(not(windows))]
impl Minimiser {
    pub(crate) fn new() -> Self { Self }
    pub(crate) fn tick(&mut self) -> usize { 0 }
    pub(crate) fn count(&self) -> usize { 0 }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fake(Option<&'static str>, std::cell::RefCell<Vec<String>>);

    impl Shell for Fake {
        fn run(&self, script: &str) -> Option<String> {
            self.1.borrow_mut().push(script.to_string());
            self.0.map(str::to_string)
        }
    }

    #[test]
    fn the_three_answers_pass_through() {
        assert_eq!(launch_with(&Fake(Some("opened-app\r\n"), Default::default())), Ok(OPENED_APP));
        assert_eq!(launch_with(&Fake(Some("noise\nopened-uri\n"), Default::default())), Ok(OPENED_URI));
        assert_eq!(launch_with(&Fake(Some("\nnot-installed\n\n"), Default::default())), Ok(NOT_INSTALLED));
    }

    #[test]
    fn anything_else_is_a_failure_word() {
        for text in [Some("boom"), Some(""), Some("opened"), Some("opened-app\nboom"), None] {
            assert_eq!(launch_with(&Fake(text, Default::default())), Err("failed"), "{text:?}");
        }
    }

    #[test]
    fn the_script_is_the_fixed_text() {
        let f = Fake(Some("opened-app"), Default::default());
        let _ = launch_with(&f);
        assert_eq!(f.1.borrow().as_slice(), [SCRIPT.to_string()]);
        for part in ["Get-StartApps", "shell:AppsFolder", "HKEY_CLASSES_ROOT\\spotify", "Start-Process", "-WindowStyle Minimized"] {
            assert!(SCRIPT.contains(part), "{part}");
        }
        assert!(!SCRIPT.contains('"'));
    }

    fn w(id: isize, image: &str, title: &str, visible: bool) -> Seen {
        Seen { id, image: image.into(), title: title.into(), visible }
    }

    #[test]
    fn the_picker_takes_only_new_player_windows() {
        let after = [
            w(1, r"C:\Edge\msedge.exe", "Spotify - Web Player", true),
            w(2, r"C:\Edge\msedge.exe", "Spotify - Web Player", true),
            w(3, r"C:\Edge\MSEDGE.EXE", "SPOTIFY", true),
            w(4, r"C:\Apps\Spotify.exe", "Spotify Free", true),
            w(5, r"C:\Edge\msedge.exe", "News", true),
            w(6, r"C:\Apps\notes.exe", "Spotify", true),
            w(7, r"C:\Edge\msedge.exe", "Spotify", false),
            w(8, r"C:\Wall\wall.exe", "Spotify", true),
        ];
        assert_eq!(pick_new_player_windows(&[1], &after, &[8]), [2, 3, 4]);
        assert!(pick_new_player_windows(&[1, 2, 3, 4], &after, &[8]).is_empty());
        assert!(pick_new_player_windows(&[], &[], &[]).is_empty());
    }
}
