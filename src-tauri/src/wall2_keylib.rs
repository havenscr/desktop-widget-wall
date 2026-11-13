//! Wall 2 key library: the fixed catalogue of keys the wall can pin, and the fixed list of
//! wall actions a key may run instead of a chord.
//!
//! Nothing here is read from a file. Each library key has a stable id, a label, an icon from
//! the fixed icon set, a group and one action: a chord in the vocabulary of `wall2_keys`, or
//! a wall action named below. The page sees ids, labels, icons, groups and the action name,
//! never a chord, and sends back only an id (or a set id and an index). A wall action is
//! always something a visible control on the wall already does, started by a click; the two
//! that Rust runs itself (locking the PC and putting the monitors to sleep) are in
//! `wall2_keys.rs` behind the same one-at-a-time guard as a chord.
#![cfg_attr(not(windows), allow(dead_code))]

use crate::wall2_keys::{parse_chord, valid_id, Matcher, Step};
use serde::Serialize;

// Section: wall actions

/// What a key can do besides pressing a chord. A fixed list; `parse_action` is the only way
/// in, and a name outside it is refused wherever it comes from (a file or the page).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum WallAction {
    LayoutThirds,
    LayoutFocus,
    LayoutRecord,
    LayoutZones,
    LayoutUndo,
    ScreensOff,
    FocusStart,
    Focus25,
    Focus50,
    FocusStop,
    /// Locks the PC (Rust, system call).
    Lock,
    /// Puts every monitor to sleep until input (Rust, system call).
    DisplaysOff,
    Mixer,
    SonosPauseAll,
    SonosPlaySuggested,
    /// A mood of the home app, by its id.
    Mood(String),
    TasksOpen,
    TaskFirst,
    OmnigentFront,
    AgentsOpenWaiting,
    MeetJoinNext,
    EventOpenNext,
    Zen,
    Dream,
}

/// The longest mood id a key may name.
const MAX_MOOD_ID: usize = 24;

/// A wall action from its name, or None. Names are exact (lower case, no spaces).
pub(crate) fn parse_action(name: &str) -> Option<WallAction> {
    if let Some(id) = name.strip_prefix("mood:") {
        return valid_id(id, MAX_MOOD_ID).then(|| WallAction::Mood(id.to_string()));
    }
    Some(match name {
        "layout:thirds" => WallAction::LayoutThirds,
        "layout:focus" => WallAction::LayoutFocus,
        "layout:record169" => WallAction::LayoutRecord,
        "layout:zones" => WallAction::LayoutZones,
        "layout:undo" => WallAction::LayoutUndo,
        "screens-off" => WallAction::ScreensOff,
        "focus:start" => WallAction::FocusStart,
        "focus:25" => WallAction::Focus25,
        "focus:50" => WallAction::Focus50,
        "focus:stop" => WallAction::FocusStop,
        "lock" => WallAction::Lock,
        "displays:off" => WallAction::DisplaysOff,
        "mixer" => WallAction::Mixer,
        "sonos:pause-all" => WallAction::SonosPauseAll,
        "sonos:play-suggested" => WallAction::SonosPlaySuggested,
        "tasks:open" => WallAction::TasksOpen,
        "task:first" => WallAction::TaskFirst,
        "omnigent:front" => WallAction::OmnigentFront,
        "agents:open-waiting" => WallAction::AgentsOpenWaiting,
        "meet:join-next" => WallAction::MeetJoinNext,
        "event:open-next" => WallAction::EventOpenNext,
        "zen" => WallAction::Zen,
        "dream" => WallAction::Dream,
        _ => return None,
    })
}

impl WallAction {
    /// The fixed name, the inverse of `parse_action`.
    pub(crate) fn name(&self) -> String {
        match self {
            WallAction::LayoutThirds => "layout:thirds".into(),
            WallAction::LayoutFocus => "layout:focus".into(),
            WallAction::LayoutRecord => "layout:record169".into(),
            WallAction::LayoutZones => "layout:zones".into(),
            WallAction::LayoutUndo => "layout:undo".into(),
            WallAction::ScreensOff => "screens-off".into(),
            WallAction::FocusStart => "focus:start".into(),
            WallAction::Focus25 => "focus:25".into(),
            WallAction::Focus50 => "focus:50".into(),
            WallAction::FocusStop => "focus:stop".into(),
            WallAction::Lock => "lock".into(),
            WallAction::DisplaysOff => "displays:off".into(),
            WallAction::Mixer => "mixer".into(),
            WallAction::SonosPauseAll => "sonos:pause-all".into(),
            WallAction::SonosPlaySuggested => "sonos:play-suggested".into(),
            WallAction::Mood(id) => format!("mood:{id}"),
            WallAction::TasksOpen => "tasks:open".into(),
            WallAction::TaskFirst => "task:first".into(),
            WallAction::OmnigentFront => "omnigent:front".into(),
            WallAction::AgentsOpenWaiting => "agents:open-waiting".into(),
            WallAction::MeetJoinNext => "meet:join-next".into(),
            WallAction::EventOpenNext => "event:open-next".into(),
            WallAction::Zen => "zen".into(),
            WallAction::Dream => "dream".into(),
        }
    }

    /// Whether Rust carries the action out itself. Every other action is a fixed name the
    /// page runs through the command or control that already exists for it.
    pub(crate) fn runs_in_rust(&self) -> bool {
        matches!(self, WallAction::Lock | WallAction::DisplaysOff)
    }
}

// Section: the library

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LibKind {
    /// A key press the owner knows works.
    Key,
    /// Something the wall already does.
    Wall,
    /// A shortcut the owner must confirm on the PC: shown marked "check" and never in a set
    /// Auto shows. The page offers it only once he pins it; Rust itself accepts any runnable
    /// library id (still held to its group's programs), so the page is where "only when
    /// pinned" is kept.
    Check,
    /// Listed so it can be found, but not available yet.
    Soon,
}

impl LibKind {
    fn word(self) -> &'static str {
        match self {
            LibKind::Key => "key",
            LibKind::Wall => "wall",
            LibKind::Check => "check",
            LibKind::Soon => "soon",
        }
    }
}

pub(crate) struct LibEntry {
    pub id: &'static str,
    pub label: &'static str,
    pub icon: &'static str,
    pub group: &'static str,
    pub kind: LibKind,
    /// What the picker says it does or sends.
    pub how: &'static str,
    /// A chord, a wall action name, `soon`, or empty for a shortcut still to be worked out.
    pub spec: &'static str,
}

pub(crate) struct LibGroup {
    pub id: &'static str,
    pub title: &'static str,
    /// The executable names the group's keys go to (lower case, file part). Empty: any program.
    pub exes: &'static [&'static str],
}

pub(crate) const GROUPS: &[LibGroup] = &[
    LibGroup { id: "anywhere", title: "Anywhere on the PC", exes: &[] },
    LibGroup { id: "sound", title: "Sound and music", exes: &[] },
    LibGroup { id: "windows", title: "Windows and layouts", exes: &[] },
    LibGroup { id: "teams", title: "Calls: Teams", exes: &["ms-teams.exe", "teams.exe"] },
    LibGroup { id: "zoom", title: "Calls: Zoom", exes: &["zoom.exe"] },
    LibGroup { id: "agents", title: "Agents", exes: &["omnigent.exe"] },
    LibGroup { id: "vscode", title: "VS Code", exes: &["code.exe"] },
    LibGroup { id: "tasks", title: "Tasks and focus", exes: &[] },
    LibGroup { id: "browser", title: "Browser", exes: &["chrome.exe", "msedge.exe", "brave.exe"] },
    LibGroup { id: "firefox", title: "Firefox", exes: &["firefox.exe"] },
    LibGroup { id: "mail", title: "Mail and calendar", exes: &["outlook.exe", "olk.exe"] },
    LibGroup { id: "recording", title: "Recording", exes: &["obs64.exe", "camtasiastudio.exe", "camtasia.exe"] },
    LibGroup { id: "powerbi", title: "Power BI", exes: &["pbidesktop.exe"] },
    LibGroup { id: "excel", title: "Excel", exes: &["excel.exe"] },
    LibGroup { id: "house", title: "House", exes: &[] },
    LibGroup { id: "powertoys", title: "PowerToys, if you have it", exes: &[] },
];

pub(crate) const LIBRARY: &[LibEntry] = &[
    LibEntry { id: "snip", label: "Snip", icon: "screenshot", group: "anywhere", kind: LibKind::Key, how: "Win+Shift+S", spec: "Win+Shift+S" },
    LibEntry { id: "clipboard-history", label: "Clipboard history", icon: "clipboard", group: "anywhere", kind: LibKind::Key, how: "Win+V", spec: "Win+V" },
    LibEntry { id: "voice-typing", label: "Voice typing", icon: "mic", group: "anywhere", kind: LibKind::Key, how: "Win+H", spec: "Win+H" },
    LibEntry { id: "emoji", label: "Emoji and symbols", icon: "keyboard", group: "anywhere", kind: LibKind::Key, how: "Win+.", spec: "Win+." },
    LibEntry { id: "screen-recording", label: "Screen recording", icon: "camera", group: "anywhere", kind: LibKind::Key, how: "Win+Shift+R", spec: "Win+Shift+R" },
    LibEntry { id: "show-desktop", label: "Show desktop", icon: "desktop", group: "anywhere", kind: LibKind::Key, how: "Win+D", spec: "Win+D" },
    LibEntry { id: "task-manager", label: "Task Manager", icon: "gauge", group: "anywhere", kind: LibKind::Key, how: "Ctrl+Shift+Esc", spec: "Ctrl+Shift+Esc" },
    LibEntry { id: "file-explorer", label: "File Explorer", icon: "folder", group: "anywhere", kind: LibKind::Key, how: "Win+E", spec: "Win+E" },
    LibEntry { id: "settings", label: "Settings", icon: "settings", group: "anywhere", kind: LibKind::Key, how: "Win+I", spec: "Win+I" },
    LibEntry { id: "quick-settings", label: "Quick settings", icon: "sliders", group: "anywhere", kind: LibKind::Key, how: "Win+A", spec: "Win+A" },
    LibEntry { id: "notifications", label: "Notifications", icon: "bell", group: "anywhere", kind: LibKind::Key, how: "Win+N", spec: "Win+N" },
    LibEntry { id: "search", label: "Search", icon: "search", group: "anywhere", kind: LibKind::Key, how: "Win+S", spec: "Win+S" },
    LibEntry { id: "run", label: "Run", icon: "play", group: "anywhere", kind: LibKind::Key, how: "Win+R", spec: "Win+R" },
    LibEntry { id: "lock", label: "Lock the PC", icon: "lock", group: "anywhere", kind: LibKind::Wall, how: "locks at once", spec: "lock" },
    LibEntry { id: "displays-off", label: "All monitors off", icon: "monitor-off", group: "anywhere", kind: LibKind::Wall, how: "sleeps every screen until you move the mouse", spec: "displays:off" },
    LibEntry { id: "strip-dark", label: "Screens off", icon: "monitor-off", group: "anywhere", kind: LibKind::Wall, how: "the wall's own Screens off", spec: "screens-off" },
    LibEntry { id: "volume-up", label: "Volume up", icon: "volume", group: "sound", kind: LibKind::Key, how: "volume key", spec: "VolumeUp" },
    LibEntry { id: "volume-down", label: "Volume down", icon: "volume-low", group: "sound", kind: LibKind::Key, how: "volume key", spec: "VolumeDown" },
    LibEntry { id: "mute", label: "Mute sound", icon: "volume-off", group: "sound", kind: LibKind::Key, how: "mute key", spec: "VolumeMute" },
    LibEntry { id: "play-pause", label: "Play or pause", icon: "play", group: "sound", kind: LibKind::Key, how: "media key", spec: "PlayPause" },
    LibEntry { id: "next-track", label: "Next track", icon: "next", group: "sound", kind: LibKind::Key, how: "media key", spec: "NextTrack" },
    LibEntry { id: "previous-track", label: "Previous track", icon: "previous", group: "sound", kind: LibKind::Key, how: "media key", spec: "PrevTrack" },
    LibEntry { id: "mute-mic", label: "Mute microphone", icon: "mic", group: "sound", kind: LibKind::Check, how: "Win+Alt+K (Windows 11, apps that support it)", spec: "Win+Alt+K" },
    LibEntry { id: "mixer", label: "Volume mixer", icon: "sliders", group: "sound", kind: LibKind::Wall, how: "opens the Windows mixer", spec: "mixer" },
    LibEntry { id: "sonos-pause", label: "Sonos: pause everything", icon: "speaker", group: "sound", kind: LibKind::Wall, how: "the wall's Sonos off", spec: "sonos:pause-all" },
    LibEntry { id: "sonos-play", label: "Sonos: play what suits the hour", icon: "speaker", group: "sound", kind: LibKind::Wall, how: "asks first if loud", spec: "sonos:play-suggested" },
    LibEntry { id: "thirds", label: "Thirds", icon: "window", group: "windows", kind: LibKind::Wall, how: "last three windows side by side. The windows you used last move; the rest stay where they are", spec: "layout:thirds" },
    LibEntry { id: "focus", label: "Focus", icon: "window", group: "windows", kind: LibKind::Wall, how: "front window takes the middle. The windows you used last move; the rest stay where they are", spec: "layout:focus" },
    LibEntry { id: "record-169", label: "Record 16:9", icon: "camera", group: "windows", kind: LibKind::Wall, how: "front window becomes a 16:9 box. The windows you used last move; the rest stay where they are", spec: "layout:record169" },
    LibEntry { id: "my-zones", label: "My zones", icon: "window", group: "windows", kind: LibKind::Wall, how: "rules first, then recent windows into the largest free zones. The windows you used last move; the rest stay where they are", spec: "layout:zones" },
    LibEntry { id: "undo-layout", label: "Undo layout", icon: "undo", group: "windows", kind: LibKind::Wall, how: "puts windows back", spec: "layout:undo" },
    LibEntry { id: "snap-left", label: "Snap left", icon: "arrow-left", group: "windows", kind: LibKind::Key, how: "Win+Left", spec: "Win+Left" },
    LibEntry { id: "snap-right", label: "Snap right", icon: "arrow-right", group: "windows", kind: LibKind::Key, how: "Win+Right", spec: "Win+Right" },
    LibEntry { id: "maximise", label: "Maximise", icon: "arrow-up", group: "windows", kind: LibKind::Key, how: "Win+Up", spec: "Win+Up" },
    LibEntry { id: "move-monitor", label: "Move to other monitor", icon: "desktop", group: "windows", kind: LibKind::Key, how: "Win+Shift+Right", spec: "Win+Shift+Right" },
    LibEntry { id: "snap-layouts", label: "Snap layouts", icon: "window", group: "windows", kind: LibKind::Key, how: "Win+Z", spec: "Win+Z" },
    LibEntry { id: "minimise-others", label: "Minimise the others", icon: "window", group: "windows", kind: LibKind::Key, how: "Win+Home", spec: "Win+Home" },
    LibEntry { id: "task-view", label: "Task view", icon: "window", group: "windows", kind: LibKind::Key, how: "Win+Tab", spec: "Win+Tab" },
    LibEntry { id: "new-desktop", label: "New desktop", icon: "desktop", group: "windows", kind: LibKind::Key, how: "Win+Ctrl+D", spec: "Win+Ctrl+D" },
    LibEntry { id: "desktop-left", label: "Desktop left", icon: "arrow-left", group: "windows", kind: LibKind::Key, how: "Win+Ctrl+Left", spec: "Win+Ctrl+Left" },
    LibEntry { id: "desktop-right", label: "Desktop right", icon: "arrow-right", group: "windows", kind: LibKind::Key, how: "Win+Ctrl+Right", spec: "Win+Ctrl+Right" },
    LibEntry { id: "join-next", label: "Join next meeting", icon: "video", group: "teams", kind: LibKind::Wall, how: "the wall's Join", spec: "meet:join-next" },
    LibEntry { id: "teams-mute", label: "Mute", icon: "mic", group: "teams", kind: LibKind::Key, how: "Ctrl+Shift+M", spec: "Ctrl+Shift+M" },
    LibEntry { id: "teams-camera", label: "Camera", icon: "video", group: "teams", kind: LibKind::Key, how: "Ctrl+Shift+O", spec: "Ctrl+Shift+O" },
    LibEntry { id: "teams-share", label: "Share screen", icon: "screen-share", group: "teams", kind: LibKind::Key, how: "Ctrl+Shift+E", spec: "Ctrl+Shift+E" },
    LibEntry { id: "teams-hand", label: "Raise hand", icon: "hand", group: "teams", kind: LibKind::Key, how: "Ctrl+Shift+K", spec: "Ctrl+Shift+K" },
    LibEntry { id: "teams-leave", label: "Leave", icon: "phone-off", group: "teams", kind: LibKind::Key, how: "Ctrl+Shift+H", spec: "Ctrl+Shift+H" },
    LibEntry { id: "zoom-mute", label: "Mute", icon: "mic", group: "zoom", kind: LibKind::Key, how: "Alt+A", spec: "Alt+A" },
    LibEntry { id: "zoom-camera", label: "Camera", icon: "video", group: "zoom", kind: LibKind::Key, how: "Alt+V", spec: "Alt+V" },
    LibEntry { id: "zoom-share", label: "Share screen", icon: "screen-share", group: "zoom", kind: LibKind::Key, how: "Alt+S", spec: "Alt+S" },
    LibEntry { id: "zoom-hand", label: "Raise hand", icon: "hand", group: "zoom", kind: LibKind::Key, how: "Alt+Y", spec: "Alt+Y" },
    LibEntry { id: "zoom-leave", label: "Leave", icon: "phone-off", group: "zoom", kind: LibKind::Key, how: "Alt+Q", spec: "Alt+Q" },
    LibEntry { id: "open-waiting", label: "Open what waits on me", icon: "chat", group: "agents", kind: LibKind::Wall, how: "opens the waiting session", spec: "agents:open-waiting" },
    LibEntry { id: "omnigent-front", label: "OmniGent to the front", icon: "chat", group: "agents", kind: LibKind::Wall, how: "brings the app forward", spec: "omnigent:front" },
    LibEntry { id: "new-chat", label: "New chat", icon: "chat", group: "agents", kind: LibKind::Soon, how: "opens a new chat", spec: "soon" },
    LibEntry { id: "vscode-palette", label: "VS Code: command palette", icon: "code", group: "vscode", kind: LibKind::Key, how: "Ctrl+Shift+P", spec: "Ctrl+Shift+P" },
    LibEntry { id: "vscode-terminal", label: "VS Code: terminal", icon: "terminal", group: "vscode", kind: LibKind::Key, how: "Ctrl+`", spec: "Ctrl+`" },
    LibEntry { id: "vscode-open", label: "VS Code: quick open", icon: "search", group: "vscode", kind: LibKind::Key, how: "Ctrl+P", spec: "Ctrl+P" },
    LibEntry { id: "vscode-search", label: "VS Code: search all files", icon: "search", group: "vscode", kind: LibKind::Key, how: "Ctrl+Shift+F", spec: "Ctrl+Shift+F" },
    LibEntry { id: "vscode-sidebar", label: "VS Code: side bar", icon: "window", group: "vscode", kind: LibKind::Key, how: "Ctrl+B", spec: "Ctrl+B" },
    LibEntry { id: "tasks-open", label: "Open the task app", icon: "checklist", group: "tasks", kind: LibKind::Wall, how: "opens it where the wall opens tasks today", spec: "tasks:open" },
    LibEntry { id: "task-add", label: "Add a task", icon: "plus", group: "tasks", kind: LibKind::Soon, how: "a small box on the wall, sends it to your inbox", spec: "soon" },
    LibEntry { id: "task-first", label: "Open today's first task", icon: "checklist", group: "tasks", kind: LibKind::Wall, how: "the top of Next three", spec: "task:first" },
    LibEntry { id: "focus-25", label: "Focus 25", icon: "timer", group: "tasks", kind: LibKind::Wall, how: "starts the focus timer", spec: "focus:25" },
    LibEntry { id: "focus-50", label: "Focus 50", icon: "timer", group: "tasks", kind: LibKind::Wall, how: "starts the focus timer", spec: "focus:50" },
    LibEntry { id: "focus-stop", label: "Stop focus", icon: "timer-off", group: "tasks", kind: LibKind::Wall, how: "ends the session", spec: "focus:stop" },
    LibEntry { id: "zen", label: "Zen", icon: "leaf", group: "tasks", kind: LibKind::Wall, how: "opens Zen", spec: "zen" },
    LibEntry { id: "tab-new", label: "New tab", icon: "plus", group: "browser", kind: LibKind::Key, how: "Ctrl+T", spec: "Ctrl+T" },
    LibEntry { id: "tab-reopen", label: "Reopen closed tab", icon: "undo", group: "browser", kind: LibKind::Key, how: "Ctrl+Shift+T", spec: "Ctrl+Shift+T" },
    LibEntry { id: "address-bar", label: "Address bar", icon: "link", group: "browser", kind: LibKind::Key, how: "Ctrl+L", spec: "Ctrl+L" },
    LibEntry { id: "private-window", label: "Private window", icon: "lock", group: "browser", kind: LibKind::Key, how: "Ctrl+Shift+N (Chrome, Edge, Brave)", spec: "Ctrl+Shift+N" },
    LibEntry { id: "dev-tools", label: "Dev tools", icon: "code", group: "browser", kind: LibKind::Key, how: "F12", spec: "F12" },
    LibEntry { id: "hard-refresh", label: "Hard refresh", icon: "refresh", group: "browser", kind: LibKind::Key, how: "Ctrl+F5", spec: "Ctrl+F5" },
    LibEntry { id: "find", label: "Find on page", icon: "search", group: "browser", kind: LibKind::Key, how: "Ctrl+F", spec: "Ctrl+F" },
    LibEntry { id: "ff-private", label: "Firefox: private window", icon: "lock", group: "firefox", kind: LibKind::Check, how: "Ctrl+Shift+P, to check in Firefox", spec: "Ctrl+Shift+P" },
    LibEntry { id: "mail-new", label: "New mail", icon: "mail", group: "mail", kind: LibKind::Check, how: "Ctrl+Shift+M (classic Outlook)", spec: "Ctrl+Shift+M" },
    LibEntry { id: "mail-reply", label: "Reply", icon: "mail", group: "mail", kind: LibKind::Check, how: "Ctrl+R", spec: "Ctrl+R" },
    LibEntry { id: "mail-view", label: "Mail view", icon: "mail", group: "mail", kind: LibKind::Check, how: "Ctrl+1", spec: "Ctrl+1" },
    LibEntry { id: "calendar-view", label: "Calendar view", icon: "calendar", group: "mail", kind: LibKind::Check, how: "Ctrl+2", spec: "Ctrl+2" },
    LibEntry { id: "mail-search", label: "Search mail", icon: "search", group: "mail", kind: LibKind::Check, how: "Ctrl+E", spec: "Ctrl+E" },
    LibEntry { id: "event-open", label: "Open next event", icon: "calendar", group: "mail", kind: LibKind::Wall, how: "opens it in Outlook", spec: "event:open-next" },
    LibEntry { id: "rec-toggle", label: "Record or pause", icon: "record", group: "recording", kind: LibKind::Check, how: "F9", spec: "F9" },
    LibEntry { id: "rec-stop", label: "Stop", icon: "record", group: "recording", kind: LibKind::Check, how: "F10", spec: "F10" },
    LibEntry { id: "rec-marker", label: "Add marker", icon: "flag", group: "recording", kind: LibKind::Check, how: "Ctrl+M", spec: "Ctrl+M" },
    LibEntry { id: "rec-layout", label: "Record 16:9 layout", icon: "camera", group: "recording", kind: LibKind::Wall, how: "front window becomes a 16:9 box", spec: "layout:record169" },
    LibEntry { id: "rec-windows", label: "Windows screen recording", icon: "camera", group: "recording", kind: LibKind::Key, how: "Win+Shift+R", spec: "Win+Shift+R" },
    LibEntry { id: "pbi-save", label: "Power BI: save", icon: "save", group: "powerbi", kind: LibKind::Key, how: "Ctrl+S", spec: "Ctrl+S" },
    LibEntry { id: "pbi-refresh", label: "Power BI: refresh", icon: "refresh", group: "powerbi", kind: LibKind::Check, how: "ribbon keys, to work out on your PC", spec: "" },
    LibEntry { id: "pbi-perf", label: "Power BI: performance analyzer", icon: "gauge", group: "powerbi", kind: LibKind::Check, how: "ribbon keys, to work out", spec: "" },
    LibEntry { id: "pbi-tmdl", label: "Power BI: TMDL view", icon: "code", group: "powerbi", kind: LibKind::Check, how: "to work out", spec: "" },
    LibEntry { id: "xl-filter", label: "Excel: filter", icon: "filter", group: "excel", kind: LibKind::Key, how: "Ctrl+Shift+L", spec: "Ctrl+Shift+L" },
    LibEntry { id: "xl-table", label: "Excel: make a table", icon: "table", group: "excel", kind: LibKind::Key, how: "Ctrl+T", spec: "Ctrl+T" },
    LibEntry { id: "xl-sum", label: "Excel: sum", icon: "sum", group: "excel", kind: LibKind::Key, how: "Alt+=", spec: "Alt+=" },
    LibEntry { id: "xl-repeat", label: "Excel: repeat last action", icon: "undo", group: "excel", kind: LibKind::Key, how: "F4", spec: "F4" },
    LibEntry { id: "mood-evening", label: "Evening lights", icon: "bulb", group: "house", kind: LibKind::Wall, how: "the Evening mood", spec: "mood:evening" },
    LibEntry { id: "mood-late", label: "Late night lights", icon: "moon", group: "house", kind: LibKind::Wall, how: "the Late Night mood", spec: "mood:late-night" },
    LibEntry { id: "tv-off", label: "TV off", icon: "tv", group: "house", kind: LibKind::Soon, how: "needs the home app draft merged", spec: "soon" },
    LibEntry { id: "alarms-seen", label: "Mark network alarms seen", icon: "shield", group: "house", kind: LibKind::Soon, how: "needs the home app draft merged", spec: "soon" },
    LibEntry { id: "dream", label: "Dream", icon: "moon", group: "house", kind: LibKind::Wall, how: "dark, slow screen", spec: "dream" },
    LibEntry { id: "pt-run", label: "PowerToys Run", icon: "search", group: "powertoys", kind: LibKind::Check, how: "Alt+Space", spec: "Alt+Space" },
    LibEntry { id: "pt-color", label: "Color picker", icon: "brush", group: "powertoys", kind: LibKind::Check, how: "Win+Shift+C", spec: "Win+Shift+C" },
    LibEntry { id: "pt-ocr", label: "Copy text from the screen", icon: "copy", group: "powertoys", kind: LibKind::Check, how: "Win+Shift+T", spec: "Win+Shift+T" },
    LibEntry { id: "pt-top", label: "Keep window on top", icon: "window", group: "powertoys", kind: LibKind::Check, how: "Win+Ctrl+T", spec: "Win+Ctrl+T" },
    LibEntry { id: "pt-plain", label: "Paste as plain text", icon: "clipboard", group: "powertoys", kind: LibKind::Check, how: "Win+Ctrl+Alt+V", spec: "Win+Ctrl+Alt+V" },
];

/// The keys "Always here" shows when `keys.json` names none, by library id.
pub(crate) const DEFAULT_PINS: [&str; 5] = ["thirds", "focus", "record-169", "snip", "strip-dark"];
/// How many pins the row holds.
pub(crate) const MAX_PINS: usize = 5;

/// The keys of the built-in General set, by library id.
const GENERAL_SET: [&str; 8] = ["snip", "clipboard-history", "task-manager", "lock", "displays-off", "mute", "play-pause", "show-desktop"];
/// Library groups that become a built-in set Auto shows for their programs: group id, the
/// set's id and its display name.
const APP_SETS: [(&str, &str, &str); 9] = [
    ("teams", "lib-teams", "Teams"),
    ("zoom", "lib-zoom", "Zoom"),
    ("agents", "lib-agents", "OmniGent"),
    ("vscode", "lib-vscode", "VS Code"),
    ("browser", "lib-browser", "Browser"),
    ("mail", "lib-mail", "Mail"),
    ("recording", "lib-recording", "Recording"),
    ("powerbi", "lib-powerbi", "Power BI"),
    ("excel", "lib-excel", "Excel"),
];

pub(crate) fn find(id: &str) -> Option<&'static LibEntry> {
    LIBRARY.iter().find(|e| e.id == id)
}

fn group(id: &str) -> Option<&'static LibGroup> {
    GROUPS.iter().find(|g| g.id == id)
}

/// The action a library entry carries: a wall action, or a chord.
pub(crate) enum LibAction {
    Wall(WallAction),
    Chord(Vec<Step>),
}

/// The action of an entry; None for `soon` and for a shortcut still to be worked out.
pub(crate) fn action_of(e: &LibEntry) -> Option<LibAction> {
    if e.kind == LibKind::Soon || e.spec.is_empty() {
        return None;
    }
    parse_action(e.spec).map(LibAction::Wall).or_else(|| parse_chord(e.spec).map(LibAction::Chord))
}

/// The programs a library entry's group goes to.
pub(crate) fn matcher_of(e: &LibEntry) -> Matcher {
    match group(e.group) {
        Some(g) if !g.exes.is_empty() => Matcher::Exe(g.exes.iter().map(|s| s.to_string()).collect()),
        _ => Matcher::Any,
    }
}

/// An entry that may sit in a built-in set: runnable and not a "check" one.
pub(crate) fn set_key(id: &str) -> Option<(&'static LibEntry, LibAction)> {
    let e = find(id)?;
    if !matches!(e.kind, LibKind::Key | LibKind::Wall) {
        return None;
    }
    Some((e, action_of(e)?))
}

/// The ids of the keys a built-in set carries: the General set's fixed eight, or a group's
/// runnable `key` and `wall` entries in order.
pub(crate) fn builtin_set_ids(set: &str) -> Vec<&'static str> {
    if set == "lib-general" {
        return GENERAL_SET.to_vec();
    }
    let Some((g, _, _)) = APP_SETS.iter().find(|(_, id, _)| *id == set) else { return Vec::new() };
    LIBRARY.iter().filter(|e| e.group == *g && set_key(e.id).is_some()).map(|e| e.id).collect()
}

/// The built-in sets: (set id, display name, group id or None for General).
pub(crate) fn builtin_sets() -> Vec<(&'static str, &'static str, Option<&'static str>)> {
    let mut v = vec![("lib-general", "General", None)];
    v.extend(APP_SETS.iter().map(|(g, id, name)| (*id, *name, Some(*g))));
    v
}

/// The executable names of a group, for a built-in set's matcher.
pub(crate) fn group_exes(id: &str) -> Vec<String> {
    group(id).map(|g| g.exes.iter().map(|s| s.to_string()).collect()).unwrap_or_default()
}

// Section: what the page sees

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LibKeyInfo {
    pub id: String,
    pub label: String,
    pub icon: String,
    /// `key`, `wall`, `check` or `soon`.
    pub kind: &'static str,
    pub how: String,
    /// The wall action name, for the keys that carry one; never a chord.
    pub action: Option<String>,
    /// Whether a click can do anything: false for `soon` and for a shortcut not worked out.
    pub runnable: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LibGroupInfo {
    pub id: String,
    pub title: String,
    /// The programs the group's keys go to; empty means any program.
    pub exes: Vec<String>,
    pub keys: Vec<LibKeyInfo>,
}

/// The whole catalogue for the picker. Pure; no chord in it.
pub(crate) fn library_info() -> Vec<LibGroupInfo> {
    GROUPS
        .iter()
        .map(|g| LibGroupInfo {
            id: g.id.to_string(),
            title: g.title.to_string(),
            exes: g.exes.iter().map(|s| s.to_string()).collect(),
            keys: LIBRARY
                .iter()
                .filter(|e| e.group == g.id)
                .map(|e| {
                    let act = action_of(e);
                    LibKeyInfo {
                        id: e.id.to_string(),
                        label: e.label.to_string(),
                        icon: e.icon.to_string(),
                        kind: e.kind.word(),
                        how: e.how.to_string(),
                        action: match &act {
                            Some(LibAction::Wall(a)) => Some(a.name()),
                            _ => None,
                        },
                        runnable: act.is_some(),
                    }
                })
                .collect(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wall2_keys::ICON_NAMES;
    use std::collections::HashSet;

    const FIRST_ICONS: [&str; 17] =
        ["refresh", "screenshot", "camera", "clipboard", "desktop", "brush", "gauge", "code", "copy", "save", "undo", "search", "lock", "mic", "play", "window", "keyboard"];

    #[test]
    fn the_library_has_104_keys_in_16_groups_with_unique_stable_ids() {
        assert_eq!(LIBRARY.len(), 104);
        assert_eq!(GROUPS.len(), 16);
        let ids: HashSet<&str> = LIBRARY.iter().map(|e| e.id).collect();
        assert_eq!(ids.len(), LIBRARY.len(), "ids are unique");
        for e in LIBRARY {
            assert!(valid_id(e.id, 24), "{}", e.id);
            assert!(group(e.group).is_some(), "{} names a group", e.id);
            assert!(!e.label.is_empty() && e.label.is_ascii() && e.label.len() <= 40, "{}", e.id);
        }
        let titles: HashSet<&str> = GROUPS.iter().map(|g| g.title).collect();
        assert_eq!(titles.len(), GROUPS.len());
    }

    #[test]
    fn every_key_that_can_run_has_a_chord_that_parses_or_an_action_in_the_fixed_list() {
        for e in LIBRARY {
            match e.kind {
                LibKind::Soon => assert_eq!(e.spec, "soon", "{}", e.id),
                _ if e.spec.is_empty() => assert_eq!(e.kind, LibKind::Check, "{}: only a check shortcut may be unfinished", e.id),
                _ => {
                    let a = action_of(e);
                    assert!(a.is_some(), "{} ({:?}) is neither a chord in the vocabulary nor a listed action", e.id, e.spec);
                    match (e.kind, a) {
                        (LibKind::Key, Some(LibAction::Chord(_))) => {}
                        (LibKind::Wall, Some(LibAction::Wall(w))) => assert_eq!(parse_action(&w.name()), Some(w.clone()), "{}", e.id),
                        (LibKind::Check, Some(LibAction::Chord(_))) => {}
                        (k, _) => panic!("{}: kind {:?} does not match what its spec is", e.id, k),
                    }
                }
            }
        }
    }

    #[test]
    fn every_icon_is_in_the_fixed_icon_set_and_every_new_one_is_used() {
        for e in LIBRARY {
            assert!(ICON_NAMES.contains(&e.icon), "{}: {}", e.id, e.icon);
        }
        let used: HashSet<&str> = LIBRARY.iter().map(|e| e.icon).collect();
        for name in ICON_NAMES {
            if !FIRST_ICONS.contains(&name) {
                assert!(used.contains(name), "{name} is in the icon set but no library key uses it");
            }
        }
    }

    #[test]
    fn the_four_coming_keys_are_listed_but_cannot_run() {
        let soon: Vec<&str> = LIBRARY.iter().filter(|e| e.kind == LibKind::Soon).map(|e| e.id).collect();
        assert_eq!(soon, vec!["new-chat", "task-add", "tv-off", "alarms-seen"]);
        for id in soon {
            assert!(action_of(find(id).unwrap()).is_none());
            assert!(set_key(id).is_none());
        }
    }

    #[test]
    fn check_shortcuts_are_never_in_a_built_in_set() {
        for (id, _, _) in builtin_sets() {
            for k in builtin_set_ids(id) {
                let e = find(k).expect("exists");
                assert!(matches!(e.kind, LibKind::Key | LibKind::Wall), "{k} in {id}");
            }
        }
        assert!(LIBRARY.iter().filter(|e| e.kind == LibKind::Check).count() >= 10);
    }

    #[test]
    fn built_in_sets_are_small_and_every_key_in_them_exists() {
        for (id, name, g) in builtin_sets() {
            let ids = builtin_set_ids(id);
            assert!(!ids.is_empty() && ids.len() <= 8, "{id}: {}", ids.len());
            assert!(name.len() <= 16, "{name}");
            if let Some(g) = g {
                assert!(!group_exes(g).is_empty(), "{id} matches by executable name");
            }
        }
        assert_eq!(builtin_set_ids("lib-general").len(), 8);
        assert!(builtin_set_ids("nope").is_empty());
    }

    #[test]
    fn the_default_pins_exist_and_are_runnable() {
        assert_eq!(DEFAULT_PINS.len(), MAX_PINS);
        for id in DEFAULT_PINS {
            assert!(action_of(find(id).expect("exists")).is_some(), "{id}");
        }
        assert_eq!(find("thirds").unwrap().spec, "layout:thirds");
        assert_eq!(find("record-169").unwrap().spec, "layout:record169");
        assert_eq!(find("strip-dark").unwrap().spec, "screens-off");
    }

    #[test]
    fn action_names_are_a_fixed_list_and_round_trip() {
        let all = [
            "layout:thirds",
            "layout:focus",
            "layout:record169",
            "layout:zones",
            "layout:undo",
            "screens-off",
            "focus:start",
            "focus:25",
            "focus:50",
            "focus:stop",
            "lock",
            "displays:off",
            "mixer",
            "sonos:pause-all",
            "sonos:play-suggested",
            "mood:evening",
            "mood:a-1",
            "tasks:open",
            "task:first",
            "omnigent:front",
            "agents:open-waiting",
            "meet:join-next",
            "event:open-next",
            "zen",
            "dream",
        ];
        for n in all {
            let a = parse_action(n).unwrap_or_else(|| panic!("{n}"));
            assert_eq!(a.name(), n);
        }
        for bad in [
            "",
            "Lock",
            "lock ",
            "layout",
            "layout:",
            "layout:thirds2",
            "layout:record",
            "mood:",
            "mood:Evening",
            "mood:a b",
            "mood:a/b",
            "mood:../x",
            "mood:aaaaaaaaaaaaaaaaaaaaaaaaa",
            "task:add",
            "tv:off",
            "alarms:seen",
            "omnigent:new-chat",
            "run:calc",
            "open:https://x",
            "shell:cmd",
        ] {
            assert!(parse_action(bad).is_none(), "{bad:?}");
        }
    }

    #[test]
    fn only_lock_and_displays_off_run_in_rust() {
        for n in ["lock", "displays:off"] {
            assert!(parse_action(n).unwrap().runs_in_rust());
        }
        for n in ["layout:thirds", "screens-off", "focus:25", "mixer", "sonos:pause-all", "mood:x", "tasks:open", "zen"] {
            assert!(!parse_action(n).unwrap().runs_in_rust(), "{n}");
        }
    }

    #[test]
    fn the_windows_lock_chord_stays_refused_so_lock_is_only_the_action() {
        assert!(parse_chord("Win+L").is_none());
        assert!(LIBRARY.iter().all(|e| !e.spec.eq_ignore_ascii_case("win+l")));
        assert!(matches!(action_of(find("lock").unwrap()), Some(LibAction::Wall(WallAction::Lock))));
        assert!(matches!(action_of(find("displays-off").unwrap()), Some(LibAction::Wall(WallAction::DisplaysOff))));
    }

    #[test]
    fn the_page_catalogue_carries_no_chord() {
        let info = library_info();
        assert_eq!(info.iter().map(|g| g.keys.len()).sum::<usize>(), 104);
        let text = serde_json::to_string(&info).unwrap();
        assert!(!text.contains("\"spec\""));
        let thirds = info.iter().flat_map(|g| &g.keys).find(|k| k.id == "thirds").unwrap();
        assert_eq!(thirds.action.as_deref(), Some("layout:thirds"));
        assert!(thirds.runnable);
        let chordy = info.iter().flat_map(|g| &g.keys).find(|k| k.id == "snip").unwrap();
        assert_eq!(chordy.action, None, "a chord key carries no action name");
        let work_out = info.iter().flat_map(|g| &g.keys).find(|k| k.id == "pbi-refresh").unwrap();
        assert!(!work_out.runnable && work_out.kind == "check");
    }

    #[test]
    fn a_library_key_goes_only_to_its_groups_programs() {
        assert_eq!(matcher_of(find("snip").unwrap()), Matcher::Any);
        match matcher_of(find("teams-mute").unwrap()) {
            Matcher::Exe(v) => assert!(v.contains(&"ms-teams.exe".to_string())),
            other => panic!("{other:?}"),
        }
        match matcher_of(find("xl-sum").unwrap()) {
            Matcher::Exe(v) => assert_eq!(v, vec!["excel.exe".to_string()], "an Excel key never goes to Power BI Desktop"),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_key_is_offered_only_where_it_is_right() {
        let exes = |id: &str| match matcher_of(find(id).unwrap()) {
            Matcher::Exe(v) => v,
            Matcher::Any => vec![],
        };
        assert_eq!(exes("vscode-palette"), vec!["code.exe".to_string()], "VS Code keys never go to OmniGent");
        assert_eq!(exes("omnigent-front"), vec!["omnigent.exe".to_string()]);
        assert!(!exes("private-window").contains(&"firefox.exe".to_string()), "Ctrl+Shift+N is not Firefox's private window");
        assert_eq!(exes("ff-private"), vec!["firefox.exe".to_string()]);
        assert_eq!(find("ff-private").unwrap().kind, LibKind::Check, "unsure shortcuts are check keys");
        assert_eq!(exes("pbi-save"), vec!["pbidesktop.exe".to_string()]);
        assert!(builtin_set_ids("lib-powerbi").iter().all(|id| !id.starts_with("xl-")));
        assert!(builtin_set_ids("lib-excel").iter().all(|id| id.starts_with("xl-")));
        assert!(builtin_set_ids("lib-vscode").iter().all(|id| id.starts_with("vscode-")));
    }
}
