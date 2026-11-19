//! Open the Hue Sync app, or bring it forward when it already runs. Hue Sync has no API; the Start
//! menu entry is found by name and launched, which activates the running window of a single-instance
//! app. The script is fixed text: nothing from the page or the network is ever put into it.

use std::io::Read;
use std::time::{Duration, Instant};

pub(crate) const OPENED: &str = "opened";
pub(crate) const NOT_INSTALLED: &str = "not-installed";
const FAILED: &str = "failed";
const LIMIT: Duration = Duration::from_secs(15);

/// Finds the Start menu entry whose name has "Hue Sync" in it and launches it.
pub(crate) const SCRIPT: &str = "$a = Get-StartApps | Where-Object { $_.Name -like '*Hue Sync*' } | Select-Object -First 1; \
if (-not $a) { 'not-installed'; exit 0 }; \
Start-Process ('shell:AppsFolder\\' + $a.AppID); \
'opened'";

/// Runs the script and answers what it printed. Production is PowerShell; tests use a fake.
pub(crate) trait Shell {
    fn run(&self, script: &str) -> Option<String>;
}

/// The last non-empty line of the script's output decides.
pub(crate) fn answer(stdout: &str) -> Result<&'static str, &'static str> {
    match stdout.lines().map(str::trim).rfind(|l| !l.is_empty()) {
        Some(OPENED) => Ok(OPENED),
        Some(NOT_INSTALLED) => Ok(NOT_INSTALLED),
        _ => Err(FAILED),
    }
}

pub(crate) fn open_with(sh: &dyn Shell) -> Result<&'static str, &'static str> {
    answer(&sh.run(SCRIPT).ok_or(FAILED)?)
}

pub(crate) struct PowerShell;

impl Shell for PowerShell {
    fn run(&self, script: &str) -> Option<String> {
        let mut cmd = std::process::Command::new("powershell");
        cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]);
        cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = cmd.spawn().ok()?;
        let started = Instant::now();
        loop {
            match child.try_wait().ok()? {
                Some(status) if status.success() => break,
                Some(_) => return None,
                None if started.elapsed() > LIMIT => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                None => std::thread::sleep(Duration::from_millis(100)),
            }
        }
        let mut out = String::new();
        child.stdout.take()?.take(4096).read_to_string(&mut out).ok()?;
        Some(out)
    }
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
    fn opened_and_not_installed_pass_through() {
        assert_eq!(open_with(&Fake(Some("opened\r\n"), Default::default())), Ok(OPENED));
        assert_eq!(open_with(&Fake(Some("\nnot-installed\n"), Default::default())), Ok(NOT_INSTALLED));
    }

    #[test]
    fn anything_else_is_a_failure_word() {
        assert_eq!(open_with(&Fake(Some("boom"), Default::default())), Err("failed"));
        assert_eq!(open_with(&Fake(Some(""), Default::default())), Err("failed"));
        assert_eq!(open_with(&Fake(None, Default::default())), Err("failed"));
    }

    #[test]
    fn the_script_is_the_fixed_text() {
        let f = Fake(Some("opened"), Default::default());
        let _ = open_with(&f);
        assert_eq!(f.1.borrow().as_slice(), [SCRIPT.to_string()]);
        assert!(SCRIPT.contains("Hue Sync") && SCRIPT.contains("Start-Process"));
    }
}
