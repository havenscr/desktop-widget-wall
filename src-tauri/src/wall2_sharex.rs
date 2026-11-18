//! ShareX keys: a fixed list of 16 ShareX tasks the wall can start with `ShareX.exe -<Task>`.
//!
//! This is the one place the wall starts a program, and it is narrow on purpose:
//! - The task comes from the fixed table below. Nothing from the page, `keys.json` or a file
//!   ever supplies an argument; the page names a task by its spec and Rust looks the argument up.
//! - The argument list is always exactly `-silent` and the table's `-<Task>`. No file path, no
//!   free text, no other ShareX switch.
//! - The program is started directly (`Command::new(path)`), never through a shell.
//! - The path of `ShareX.exe` must be an absolute local path ending in `ShareX.exe`, a real
//!   file, not a network path (see `plain_local_path` and `checked_exe`).
//! - When ShareX.exe cannot be found nothing runs and the key answers `not installed`.
//!
//! ShareX keeps one running copy: a second `ShareX.exe -<Task>` hands the task to it and exits.
#![cfg_attr(not(windows), allow(dead_code))]

use std::time::{Duration, Instant};

/// One allowed task: the spec the wall names it by (`sharex:<spec>`) and the exact argument.
pub(crate) struct Row {
    pub spec: &'static str,
    pub arg: &'static str,
}

/// The only ShareX tasks the wall can start. Uploads, the active-window and active-monitor
/// captures and every other task are not here. Order is the order of the picker.
pub(crate) const TASKS: [Row; 16] = [
    Row { spec: "region", arg: "-RectangleRegion" },
    Row { spec: "screen", arg: "-PrintScreen" },
    Row { spec: "last-region", arg: "-LastRegion" },
    Row { spec: "scrolling", arg: "-ScrollingCapture" },
    Row { spec: "record", arg: "-ScreenRecorder" },
    Row { spec: "record-gif", arg: "-ScreenRecorderGIF" },
    Row { spec: "pause-record", arg: "-PauseScreenRecording" },
    Row { spec: "stop-record", arg: "-StopScreenRecording" },
    Row { spec: "cancel-record", arg: "-AbortScreenRecording" },
    Row { spec: "ocr", arg: "-OCR" },
    Row { spec: "color", arg: "-ScreenColorPicker" },
    Row { spec: "ruler", arg: "-Ruler" },
    Row { spec: "pin", arg: "-PinToScreen" },
    Row { spec: "highlighter", arg: "-MouseHighlighter" },
    Row { spec: "history", arg: "-OpenImageHistory" },
    Row { spec: "folder", arg: "-OpenScreenshotsFolder" },
];

/// A task of the table, held as its row number so it can only ever be one of the 16.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ShareXTask(usize);

impl ShareXTask {
    /// The task for a spec such as `region`, or None for anything not in the table.
    pub(crate) fn from_spec(spec: &str) -> Option<ShareXTask> {
        TASKS.iter().position(|r| r.spec == spec).map(ShareXTask)
    }

    pub(crate) fn spec(self) -> &'static str {
        TASKS[self.0].spec
    }

    /// The ShareX argument, from the table.
    pub(crate) fn arg(self) -> &'static str {
        TASKS[self.0].arg
    }

    /// The whole argument list a launch passes: always these two and nothing else.
    pub(crate) fn args(self) -> [&'static str; 2] {
        ["-silent", self.arg()]
    }
}

/// The file name the program must have.
const EXE_NAME: &str = "ShareX.exe";

/// The least time between two launches of the same task, so a double fire cannot start and
/// then stop a recording that toggles.
const MIN_GAP: Duration = Duration::from_millis(700);

/// True when a launch of a task last made at `last` may be repeated at `now`.
pub(crate) fn gap_ok(last: Option<Instant>, now: Instant) -> bool {
    match last {
        None => true,
        Some(t) => now.checked_duration_since(t).map_or(false, |d| d >= MIN_GAP),
    }
}

/// An absolute local path (`C:\...`) to a file named `ShareX.exe`, as text. Refuses a network
/// path (`\\server\...`), a device or verbatim prefix (`\\?\`, `\\.\`), forward slashes, any
/// `..` part, a colon after the drive (alternate streams), control characters, and any other
/// file name. Pure text; the real file is checked by `checked_exe`.
pub(crate) fn plain_local_path(p: &str) -> bool {
    let b = p.as_bytes();
    if b.len() < 4 || !b[0].is_ascii_alphabetic() || b[1] != b':' || b[2] != b'\\' {
        return false;
    }
    if p.chars().any(|c| c.is_control() || c == '/' || c == '*' || c == '?' || c == '"' || c == '<' || c == '>' || c == '|') {
        return false;
    }
    if p[2..].contains(':') {
        return false;
    }
    let mut parts = p[3..].split('\\');
    let name = parts.next_back().unwrap_or("");
    if !name.eq_ignore_ascii_case(EXE_NAME) {
        return false;
    }
    p[3..].split('\\').all(|part| !part.is_empty() && part != ".." && part != ".")
}

/// The ordinary form of what `canonicalize` returns: `\\?\C:\x` gives `C:\x`; `\\?\UNC\...`
/// and any other `\\` start give None (a network path).
pub(crate) fn strip_verbatim(p: &str) -> Option<String> {
    if let Some(rest) = p.strip_prefix(r"\\?\") {
        let b = rest.as_bytes();
        return (b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && b[2] == b'\\').then(|| rest.to_string());
    }
    if p.starts_with(r"\\") {
        return None;
    }
    Some(p.to_string())
}

/// `ShareX.exe` inside a folder text taken from the registry: quotes and a trailing `\` are
/// dropped. None for an empty folder.
pub(crate) fn exe_in_dir(dir: &str) -> Option<String> {
    let d = dir.trim().trim_matches('"').trim_end_matches('\\');
    (!d.is_empty()).then(|| format!(r"{d}\{EXE_NAME}"))
}

/// A path text from the registry's App Paths value: surrounding quotes dropped.
pub(crate) fn unquote(p: &str) -> String {
    p.trim().trim_matches('"').to_string()
}

#[cfg(windows)]
pub(crate) use win::launch;

#[cfg(windows)]
mod win {
    use super::*;
    use crate::wall2_keys::Refusal;
    use crate::wall2_winutil::{exe_matches, sys};
    use std::path::PathBuf;
    use std::process::{Command, Stdio};
    use std::sync::Mutex;
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{ERROR_SUCCESS, HANDLE};
    use windows::Win32::Storage::FileSystem::GetDriveTypeW;
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
    use windows::Win32::UI::Shell::{FOLDERID_ProgramFiles, SHGetKnownFolderPath, KF_FLAG_DEFAULT};

    /// The path found last time, checked again before every use.
    static FOUND: Mutex<Option<PathBuf>> = Mutex::new(None);
    /// When each task was last started, by table row.
    static LAST: Mutex<[Option<Instant>; 16]> = Mutex::new([None; 16]);

    /// `DRIVE_REMOTE` from `GetDriveTypeW`.
    const DRIVE_REMOTE: u32 = 4;

    /// Start one allowed task. Err is a fixed word: `busy` (the same task a moment ago), `not
    /// installed` (no valid ShareX.exe) or `failed` (the program would not start).
    pub(crate) fn launch(task: ShareXTask) -> Result<(), Refusal> {
        {
            let mut last = LAST.lock().map_err(|_| Refusal::Failed)?;
            let now = Instant::now();
            if !gap_ok(last[task.0], now) {
                return Err(Refusal::Busy);
            }
            last[task.0] = Some(now);
        }
        let exe = find_exe().ok_or(Refusal::NotInstalled)?;
        let mut cmd = Command::new(&exe);
        cmd.args(task.args()).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        if let Some(dir) = exe.parent() {
            cmd.current_dir(dir);
        }
        match cmd.spawn() {
            Ok(_) => Ok(()),
            Err(_) => {
                if let Ok(mut f) = FOUND.lock() {
                    *f = None;
                }
                Err(Refusal::Failed)
            }
        }
    }

    /// The path of ShareX.exe: the one found before when it still passes, else the first
    /// source that gives a path that passes.
    fn find_exe() -> Option<PathBuf> {
        let cached = FOUND.lock().ok().and_then(|f| f.clone());
        if let Some(p) = cached.and_then(|p| p.to_str().and_then(checked_exe)) {
            return Some(p);
        }
        // The plan's order: the running copy, the installer's uninstall key (this user, then
        // the machine), App Paths (the same), then the usual folder.
        let sources: [fn() -> Option<String>; 6] = [running, uninstall_user, uninstall_machine, app_paths_user, app_paths_machine, program_files];
        let found = sources.iter().find_map(|s| s().and_then(|p| checked_exe(&p)))?;
        if let Ok(mut f) = FOUND.lock() {
            *f = Some(found.clone());
        }
        Some(found)
    }

    /// The path as a path that is safe to start, or None: it must pass `plain_local_path`, be a
    /// regular file after links are followed, still pass that check as resolved, and not sit on
    /// a network drive.
    pub(crate) fn checked_exe(raw: &str) -> Option<PathBuf> {
        if !plain_local_path(raw) {
            return None;
        }
        let resolved = std::fs::canonicalize(raw).ok()?;
        let text = strip_verbatim(resolved.to_str()?)?;
        if !plain_local_path(&text) || !std::fs::metadata(&text).ok()?.is_file() || on_network_drive(&text) {
            return None;
        }
        Some(PathBuf::from(text))
    }

    /// Whether the drive of a `X:\...` path is a network drive.
    fn on_network_drive(path: &str) -> bool {
        let root: Vec<u16> = path[..3].encode_utf16().chain(std::iter::once(0)).collect();
        unsafe { GetDriveTypeW(PCWSTR(root.as_ptr())) == DRIVE_REMOTE }
    }

    /// The image path of a process named ShareX.exe, from the top-level windows (the hidden
    /// main window of a tray program counts).
    fn running() -> Option<String> {
        sys::top_level_windows().into_iter().find_map(|h| {
            let image = sys::image_path(sys::pid_of(h))?;
            exe_matches(&image, EXE_NAME).then_some(image)
        })
    }

    fn reg_string(root: HKEY, subkey: PCWSTR, value: PCWSTR) -> Option<String> {
        let mut buf = vec![0u16; 1024];
        let mut bytes = (buf.len() * 2) as u32;
        let status = unsafe { RegGetValueW(root, subkey, value, RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr().cast()), Some(&mut bytes)) };
        if status != ERROR_SUCCESS {
            return None;
        }
        let len = ((bytes as usize) / 2).min(buf.len());
        let end = buf[..len].iter().position(|&u| u == 0).unwrap_or(len);
        Some(String::from_utf16_lossy(&buf[..end]))
    }

    fn uninstall(root: HKEY) -> Option<String> {
        let dir = reg_string(
            root,
            w!("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\82E6AC09-0FEF-4390-AD9F-0DD3F5561EFC_is1"),
            w!("InstallLocation"),
        )?;
        exe_in_dir(&dir)
    }

    fn uninstall_user() -> Option<String> {
        uninstall(HKEY_CURRENT_USER)
    }

    fn uninstall_machine() -> Option<String> {
        uninstall(HKEY_LOCAL_MACHINE)
    }

    fn app_paths(root: HKEY) -> Option<String> {
        reg_string(root, w!("Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\ShareX.exe"), PCWSTR::null()).map(|p| unquote(&p))
    }

    fn app_paths_user() -> Option<String> {
        app_paths(HKEY_CURRENT_USER)
    }

    fn app_paths_machine() -> Option<String> {
        app_paths(HKEY_LOCAL_MACHINE)
    }

    /// `ShareX.exe` in the Program Files folder, from the known-folder call (never an
    /// environment variable, which a parent process could set).
    fn program_files() -> Option<String> {
        unsafe {
            let p = SHGetKnownFolderPath(&FOLDERID_ProgramFiles, KF_FLAG_DEFAULT, HANDLE::default()).ok()?;
            let dir = p.to_string().ok();
            CoTaskMemFree(Some(p.0 as *const std::ffi::c_void));
            exe_in_dir(&dir?)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_table_has_exactly_16_tasks_with_unique_specs_and_plain_args() {
        assert_eq!(TASKS.len(), 16);
        let mut specs: Vec<&str> = TASKS.iter().map(|r| r.spec).collect();
        specs.sort();
        specs.dedup();
        assert_eq!(specs.len(), 16);
        for r in &TASKS {
            assert!(r.spec.chars().all(|c| c.is_ascii_lowercase() || c == '-'), "{}", r.spec);
            assert!(r.arg.starts_with('-') && r.arg.len() > 1, "{}", r.arg);
            assert!(r.arg[1..].chars().all(|c| c.is_ascii_alphabetic()), "{}", r.arg);
        }
    }

    #[test]
    fn only_the_listed_tasks_are_allowed() {
        let allowed = [
            "-RectangleRegion", "-PrintScreen", "-LastRegion", "-ScrollingCapture", "-ScreenRecorder", "-ScreenRecorderGIF", "-PauseScreenRecording",
            "-StopScreenRecording", "-AbortScreenRecording", "-OCR", "-ScreenColorPicker", "-Ruler", "-PinToScreen", "-MouseHighlighter",
            "-OpenImageHistory", "-OpenScreenshotsFolder",
        ];
        let args: Vec<&str> = TASKS.iter().map(|r| r.arg).collect();
        assert_eq!(args, allowed);
        for bad in [
            "-ClipboardUpload", "-FileUpload", "-ActiveWindow", "-ActiveMonitor", "-workflow", "-task", "-multi", "-portable", "-sandbox", "-autoclose",
            "-customuploader", "-imageeffect", "-NativeMessagingInput", "-silent",
        ] {
            assert!(!args.contains(&bad), "{bad}");
        }
    }

    #[test]
    fn a_launch_passes_silent_and_the_table_argument_only() {
        let t = ShareXTask::from_spec("region").unwrap();
        assert_eq!(t.args(), ["-silent", "-RectangleRegion"]);
        let o = ShareXTask::from_spec("folder").unwrap();
        assert_eq!(o.args(), ["-silent", "-OpenScreenshotsFolder"]);
    }

    #[test]
    fn an_unknown_spec_is_refused() {
        for bad in ["", "Region", "region ", "-RectangleRegion", "RectangleRegion", "upload", "clipboard-upload", "active-window", "region -workflow x", "../x"] {
            assert!(ShareXTask::from_spec(bad).is_none(), "{bad:?}");
        }
        for r in &TASKS {
            assert_eq!(ShareXTask::from_spec(r.spec).unwrap().spec(), r.spec);
        }
    }

    #[test]
    fn the_exe_path_must_be_a_plain_local_sharex_exe() {
        for ok in [r"C:\Program Files\ShareX\ShareX.exe", r"D:\Tools\ShareX\sharex.exe", r"c:\ShareX.exe"] {
            assert!(plain_local_path(ok), "{ok}");
        }
        for bad in [
            "",
            "ShareX.exe",
            r"\ShareX.exe",
            r"C:ShareX.exe",
            r"C:\Program Files\ShareX\ShareX.dll",
            r"C:\Program Files\ShareX\ShareX.exe.bat",
            r"C:\Program Files\ShareX\notShareX.exe",
            r"C:\Program Files\ShareX",
            r"C:\Program Files\ShareX\",
            r"\\server\share\ShareX.exe",
            r"\\?\C:\ShareX\ShareX.exe",
            r"\\.\C:\ShareX.exe",
            r"C:\a\..\ShareX.exe",
            r"C:\a\..\..\b\ShareX.exe",
            "C:/Program Files/ShareX/ShareX.exe",
            r"C:\a\ShareX.exe:stream",
            "C:\\a\\Share\0X.exe",
            r"C:\a\\ShareX.exe",
        ] {
            assert!(!plain_local_path(bad), "{bad:?}");
        }
    }

    #[test]
    fn a_resolved_path_loses_the_verbatim_prefix_and_a_network_path_is_refused() {
        assert_eq!(strip_verbatim(r"\\?\C:\ShareX\ShareX.exe").as_deref(), Some(r"C:\ShareX\ShareX.exe"));
        assert_eq!(strip_verbatim(r"C:\ShareX\ShareX.exe").as_deref(), Some(r"C:\ShareX\ShareX.exe"));
        assert_eq!(strip_verbatim(r"\\?\UNC\server\share\ShareX.exe"), None);
        assert_eq!(strip_verbatim(r"\\server\share\ShareX.exe"), None);
        assert_eq!(strip_verbatim(r"\\?\Volume{1}\ShareX.exe"), None);
    }

    #[test]
    fn registry_text_becomes_a_candidate_path() {
        assert_eq!(exe_in_dir(r"C:\Program Files\ShareX\").as_deref(), Some(r"C:\Program Files\ShareX\ShareX.exe"));
        assert_eq!(exe_in_dir("\"C:\\Tools\\ShareX\"").as_deref(), Some(r"C:\Tools\ShareX\ShareX.exe"));
        assert_eq!(exe_in_dir(""), None);
        assert_eq!(exe_in_dir("  "), None);
        assert_eq!(unquote("\"C:\\a\\ShareX.exe\""), r"C:\a\ShareX.exe");
        assert_eq!(unquote(r"C:\a\ShareX.exe"), r"C:\a\ShareX.exe");
    }

    #[test]
    fn the_same_task_cannot_start_twice_inside_the_gap() {
        let t0 = Instant::now();
        assert!(gap_ok(None, t0));
        assert!(!gap_ok(Some(t0), t0));
        assert!(!gap_ok(Some(t0), t0 + Duration::from_millis(699)));
        assert!(gap_ok(Some(t0), t0 + Duration::from_millis(700)));
        assert!(gap_ok(Some(t0), t0 + Duration::from_secs(5)));
    }
}
