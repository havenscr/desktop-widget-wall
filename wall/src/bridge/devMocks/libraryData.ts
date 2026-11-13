import type { LibGroup } from '../../work/libraryModel';

/** The built-in key library as the Rust side lists it (no chords). Dev mocks and tests only; a test holds it equal, field by field, to `wall2_keylib.rs`. */
export const LIBRARY_DATA: LibGroup[] = [
 {
  "id": "anywhere",
  "title": "Anywhere on the PC",
  "exes": [],
  "keys": [
   {
    "id": "snip",
    "label": "Snip",
    "icon": "screenshot",
    "kind": "key",
    "how": "Win+Shift+S",
    "action": null,
    "runnable": true
   },
   {
    "id": "clipboard-history",
    "label": "Clipboard history",
    "icon": "clipboard",
    "kind": "key",
    "how": "Win+V",
    "action": null,
    "runnable": true
   },
   {
    "id": "voice-typing",
    "label": "Voice typing",
    "icon": "mic",
    "kind": "key",
    "how": "Win+H",
    "action": null,
    "runnable": true
   },
   {
    "id": "emoji",
    "label": "Emoji and symbols",
    "icon": "keyboard",
    "kind": "key",
    "how": "Win+.",
    "action": null,
    "runnable": true
   },
   {
    "id": "screen-recording",
    "label": "Screen recording",
    "icon": "camera",
    "kind": "key",
    "how": "Win+Shift+R",
    "action": null,
    "runnable": true
   },
   {
    "id": "show-desktop",
    "label": "Show desktop",
    "icon": "desktop",
    "kind": "key",
    "how": "Win+D",
    "action": null,
    "runnable": true
   },
   {
    "id": "task-manager",
    "label": "Task Manager",
    "icon": "gauge",
    "kind": "key",
    "how": "Ctrl+Shift+Esc",
    "action": null,
    "runnable": true
   },
   {
    "id": "file-explorer",
    "label": "File Explorer",
    "icon": "folder",
    "kind": "key",
    "how": "Win+E",
    "action": null,
    "runnable": true
   },
   {
    "id": "settings",
    "label": "Settings",
    "icon": "settings",
    "kind": "key",
    "how": "Win+I",
    "action": null,
    "runnable": true
   },
   {
    "id": "quick-settings",
    "label": "Quick settings",
    "icon": "sliders",
    "kind": "key",
    "how": "Win+A",
    "action": null,
    "runnable": true
   },
   {
    "id": "notifications",
    "label": "Notifications",
    "icon": "bell",
    "kind": "key",
    "how": "Win+N",
    "action": null,
    "runnable": true
   },
   {
    "id": "search",
    "label": "Search",
    "icon": "search",
    "kind": "key",
    "how": "Win+S",
    "action": null,
    "runnable": true
   },
   {
    "id": "run",
    "label": "Run",
    "icon": "play",
    "kind": "key",
    "how": "Win+R",
    "action": null,
    "runnable": true
   },
   {
    "id": "lock",
    "label": "Lock the PC",
    "icon": "lock",
    "kind": "wall",
    "how": "locks at once",
    "action": "lock",
    "runnable": true
   },
   {
    "id": "displays-off",
    "label": "All monitors off",
    "icon": "monitor-off",
    "kind": "wall",
    "how": "sleeps every screen until you move the mouse",
    "action": "displays:off",
    "runnable": true
   },
   {
    "id": "strip-dark",
    "label": "Hide screen",
    "icon": "monitor-off",
    "kind": "wall",
    "how": "the wall's own Hide screen",
    "action": "screens-off",
    "runnable": true
   }
  ]
 },
 {
  "id": "sound",
  "title": "Sound and music",
  "exes": [],
  "keys": [
   {
    "id": "volume-up",
    "label": "Volume up",
    "icon": "volume",
    "kind": "key",
    "how": "volume key",
    "action": null,
    "runnable": true
   },
   {
    "id": "volume-down",
    "label": "Volume down",
    "icon": "volume-low",
    "kind": "key",
    "how": "volume key",
    "action": null,
    "runnable": true
   },
   {
    "id": "mute",
    "label": "Mute sound",
    "icon": "volume-off",
    "kind": "key",
    "how": "mute key",
    "action": null,
    "runnable": true
   },
   {
    "id": "play-pause",
    "label": "Play or pause",
    "icon": "play",
    "kind": "key",
    "how": "media key",
    "action": null,
    "runnable": true
   },
   {
    "id": "next-track",
    "label": "Next track",
    "icon": "next",
    "kind": "key",
    "how": "media key",
    "action": null,
    "runnable": true
   },
   {
    "id": "previous-track",
    "label": "Previous track",
    "icon": "previous",
    "kind": "key",
    "how": "media key",
    "action": null,
    "runnable": true
   },
   {
    "id": "mute-mic",
    "label": "Mute microphone",
    "icon": "mic",
    "kind": "check",
    "how": "Win+Alt+K (Windows 11, apps that support it)",
    "action": null,
    "runnable": true
   },
   {
    "id": "mixer",
    "label": "Volume mixer",
    "icon": "sliders",
    "kind": "wall",
    "how": "opens the Windows mixer",
    "action": "mixer",
    "runnable": true
   },
   {
    "id": "sonos-pause",
    "label": "Sonos: pause everything",
    "icon": "speaker",
    "kind": "wall",
    "how": "the wall's Sonos off",
    "action": "sonos:pause-all",
    "runnable": true
   },
   {
    "id": "sonos-play",
    "label": "Sonos: play what suits the hour",
    "icon": "speaker",
    "kind": "wall",
    "how": "asks first if loud",
    "action": "sonos:play-suggested",
    "runnable": true
   }
  ]
 },
 {
  "id": "windows",
  "title": "Windows and layouts",
  "exes": [],
  "keys": [
   {
    "id": "thirds",
    "label": "Thirds",
    "icon": "window",
    "kind": "wall",
    "how": "last three windows side by side. The windows you used last move; the rest stay where they are",
    "action": "layout:thirds",
    "runnable": true
   },
   {
    "id": "focus",
    "label": "Focus",
    "icon": "window",
    "kind": "wall",
    "how": "front window takes the middle. The windows you used last move; the rest stay where they are",
    "action": "layout:focus",
    "runnable": true
   },
   {
    "id": "record-169",
    "label": "Record 16:9",
    "icon": "camera",
    "kind": "wall",
    "how": "front window becomes a 16:9 box. The windows you used last move; the rest stay where they are",
    "action": "layout:record169",
    "runnable": true
   },
   {
    "id": "my-zones",
    "label": "My zones",
    "icon": "window",
    "kind": "wall",
    "how": "rules first, then recent windows into the largest free zones. The windows you used last move; the rest stay where they are",
    "action": "layout:zones",
    "runnable": true
   },
   {
    "id": "undo-layout",
    "label": "Undo layout",
    "icon": "undo",
    "kind": "wall",
    "how": "puts windows back",
    "action": "layout:undo",
    "runnable": true
   },
   {
    "id": "snap-left",
    "label": "Snap left",
    "icon": "arrow-left",
    "kind": "key",
    "how": "Win+Left",
    "action": null,
    "runnable": true
   },
   {
    "id": "snap-right",
    "label": "Snap right",
    "icon": "arrow-right",
    "kind": "key",
    "how": "Win+Right",
    "action": null,
    "runnable": true
   },
   {
    "id": "maximise",
    "label": "Maximise",
    "icon": "arrow-up",
    "kind": "key",
    "how": "Win+Up",
    "action": null,
    "runnable": true
   },
   {
    "id": "move-monitor",
    "label": "Move to other monitor",
    "icon": "desktop",
    "kind": "key",
    "how": "Win+Shift+Right",
    "action": null,
    "runnable": true
   },
   {
    "id": "snap-layouts",
    "label": "Snap layouts",
    "icon": "window",
    "kind": "key",
    "how": "Win+Z",
    "action": null,
    "runnable": true
   },
   {
    "id": "minimise-others",
    "label": "Minimise the others",
    "icon": "window",
    "kind": "key",
    "how": "Win+Home",
    "action": null,
    "runnable": true
   },
   {
    "id": "task-view",
    "label": "Task view",
    "icon": "window",
    "kind": "key",
    "how": "Win+Tab",
    "action": null,
    "runnable": true
   },
   {
    "id": "new-desktop",
    "label": "New desktop",
    "icon": "desktop",
    "kind": "key",
    "how": "Win+Ctrl+D",
    "action": null,
    "runnable": true
   },
   {
    "id": "desktop-left",
    "label": "Desktop left",
    "icon": "arrow-left",
    "kind": "key",
    "how": "Win+Ctrl+Left",
    "action": null,
    "runnable": true
   },
   {
    "id": "desktop-right",
    "label": "Desktop right",
    "icon": "arrow-right",
    "kind": "key",
    "how": "Win+Ctrl+Right",
    "action": null,
    "runnable": true
   }
  ]
 },
 {
  "id": "teams",
  "title": "Calls: Teams",
  "exes": [
   "ms-teams.exe",
   "teams.exe"
  ],
  "keys": [
   {
    "id": "join-next",
    "label": "Join next meeting",
    "icon": "video",
    "kind": "wall",
    "how": "the wall's Join",
    "action": "meet:join-next",
    "runnable": true
   },
   {
    "id": "teams-mute",
    "label": "Mute",
    "icon": "mic",
    "kind": "key",
    "how": "Ctrl+Shift+M",
    "action": null,
    "runnable": true
   },
   {
    "id": "teams-camera",
    "label": "Camera",
    "icon": "video",
    "kind": "key",
    "how": "Ctrl+Shift+O",
    "action": null,
    "runnable": true
   },
   {
    "id": "teams-share",
    "label": "Share screen",
    "icon": "screen-share",
    "kind": "key",
    "how": "Ctrl+Shift+E",
    "action": null,
    "runnable": true
   },
   {
    "id": "teams-hand",
    "label": "Raise hand",
    "icon": "hand",
    "kind": "key",
    "how": "Ctrl+Shift+K",
    "action": null,
    "runnable": true
   },
   {
    "id": "teams-leave",
    "label": "Leave",
    "icon": "phone-off",
    "kind": "key",
    "how": "Ctrl+Shift+H",
    "action": null,
    "runnable": true
   }
  ]
 },
 {
  "id": "zoom",
  "title": "Calls: Zoom",
  "exes": [
   "zoom.exe"
  ],
  "keys": [
   {
    "id": "zoom-mute",
    "label": "Mute",
    "icon": "mic",
    "kind": "key",
    "how": "Alt+A",
    "action": null,
    "runnable": true
   },
   {
    "id": "zoom-camera",
    "label": "Camera",
    "icon": "video",
    "kind": "key",
    "how": "Alt+V",
    "action": null,
    "runnable": true
   },
   {
    "id": "zoom-share",
    "label": "Share screen",
    "icon": "screen-share",
    "kind": "key",
    "how": "Alt+S",
    "action": null,
    "runnable": true
   },
   {
    "id": "zoom-hand",
    "label": "Raise hand",
    "icon": "hand",
    "kind": "key",
    "how": "Alt+Y",
    "action": null,
    "runnable": true
   },
   {
    "id": "zoom-leave",
    "label": "Leave",
    "icon": "phone-off",
    "kind": "key",
    "how": "Alt+Q",
    "action": null,
    "runnable": true
   }
  ]
 },
 {
  "id": "agents",
  "title": "Agents",
  "exes": [
   "omnigent.exe"
  ],
  "keys": [
   {
    "id": "open-waiting",
    "label": "Open what waits on me",
    "icon": "chat",
    "kind": "wall",
    "how": "opens the waiting session",
    "action": "agents:open-waiting",
    "runnable": true
   },
   {
    "id": "omnigent-front",
    "label": "OmniGent to the front",
    "icon": "chat",
    "kind": "wall",
    "how": "brings the app forward",
    "action": "omnigent:front",
    "runnable": true
   },
   {
    "id": "new-chat",
    "label": "New chat",
    "icon": "chat",
    "kind": "soon",
    "how": "opens a new chat",
    "action": null,
    "runnable": false
   }
  ]
 },
 {
  "id": "vscode",
  "title": "VS Code",
  "exes": [
   "code.exe"
  ],
  "keys": [
   {
    "id": "vscode-palette",
    "label": "VS Code: command palette",
    "icon": "code",
    "kind": "key",
    "how": "Ctrl+Shift+P",
    "action": null,
    "runnable": true
   },
   {
    "id": "vscode-terminal",
    "label": "VS Code: terminal",
    "icon": "terminal",
    "kind": "key",
    "how": "Ctrl+`",
    "action": null,
    "runnable": true
   },
   {
    "id": "vscode-open",
    "label": "VS Code: quick open",
    "icon": "search",
    "kind": "key",
    "how": "Ctrl+P",
    "action": null,
    "runnable": true
   },
   {
    "id": "vscode-search",
    "label": "VS Code: search all files",
    "icon": "search",
    "kind": "key",
    "how": "Ctrl+Shift+F",
    "action": null,
    "runnable": true
   },
   {
    "id": "vscode-sidebar",
    "label": "VS Code: side bar",
    "icon": "window",
    "kind": "key",
    "how": "Ctrl+B",
    "action": null,
    "runnable": true
   }
  ]
 },
 {
  "id": "tasks",
  "title": "Tasks and focus",
  "exes": [],
  "keys": [
   {
    "id": "tasks-open",
    "label": "Open the task app",
    "icon": "checklist",
    "kind": "wall",
    "how": "opens it where the wall opens tasks today",
    "action": "tasks:open",
    "runnable": true
   },
   {
    "id": "task-add",
    "label": "Add a task",
    "icon": "plus",
    "kind": "soon",
    "how": "a small box on the wall, sends it to your inbox",
    "action": null,
    "runnable": false
   },
   {
    "id": "task-first",
    "label": "Open today's first task",
    "icon": "checklist",
    "kind": "wall",
    "how": "the top of Next three",
    "action": "task:first",
    "runnable": true
   },
   {
    "id": "focus-25",
    "label": "Focus 25",
    "icon": "timer",
    "kind": "wall",
    "how": "starts the focus timer",
    "action": "focus:25",
    "runnable": true
   },
   {
    "id": "focus-50",
    "label": "Focus 50",
    "icon": "timer",
    "kind": "wall",
    "how": "starts the focus timer",
    "action": "focus:50",
    "runnable": true
   },
   {
    "id": "focus-stop",
    "label": "Stop focus",
    "icon": "timer-off",
    "kind": "wall",
    "how": "ends the session",
    "action": "focus:stop",
    "runnable": true
   },
   {
    "id": "zen",
    "label": "Zen",
    "icon": "leaf",
    "kind": "wall",
    "how": "opens Zen",
    "action": "zen",
    "runnable": true
   }
  ]
 },
 {
  "id": "browser",
  "title": "Browser",
  "exes": [
   "chrome.exe",
   "msedge.exe",
   "brave.exe"
  ],
  "keys": [
   {
    "id": "tab-new",
    "label": "New tab",
    "icon": "plus",
    "kind": "key",
    "how": "Ctrl+T",
    "action": null,
    "runnable": true
   },
   {
    "id": "tab-reopen",
    "label": "Reopen closed tab",
    "icon": "undo",
    "kind": "key",
    "how": "Ctrl+Shift+T",
    "action": null,
    "runnable": true
   },
   {
    "id": "address-bar",
    "label": "Address bar",
    "icon": "link",
    "kind": "key",
    "how": "Ctrl+L",
    "action": null,
    "runnable": true
   },
   {
    "id": "private-window",
    "label": "Private window",
    "icon": "lock",
    "kind": "key",
    "how": "Ctrl+Shift+N (Chrome, Edge, Brave)",
    "action": null,
    "runnable": true
   },
   {
    "id": "dev-tools",
    "label": "Dev tools",
    "icon": "code",
    "kind": "key",
    "how": "F12",
    "action": null,
    "runnable": true
   },
   {
    "id": "hard-refresh",
    "label": "Hard refresh",
    "icon": "refresh",
    "kind": "key",
    "how": "Ctrl+F5",
    "action": null,
    "runnable": true
   },
   {
    "id": "find",
    "label": "Find on page",
    "icon": "search",
    "kind": "key",
    "how": "Ctrl+F",
    "action": null,
    "runnable": true
   }
  ]
 },
 {
  "id": "firefox",
  "title": "Firefox",
  "exes": [
   "firefox.exe"
  ],
  "keys": [
   {
    "id": "ff-private",
    "label": "Firefox: private window",
    "icon": "lock",
    "kind": "check",
    "how": "Ctrl+Shift+P, to check in Firefox",
    "action": null,
    "runnable": true
   }
  ]
 },
 {
  "id": "mail",
  "title": "Mail and calendar",
  "exes": [
   "outlook.exe",
   "olk.exe"
  ],
  "keys": [
   {
    "id": "mail-new",
    "label": "New mail",
    "icon": "mail",
    "kind": "check",
    "how": "Ctrl+Shift+M (classic Outlook)",
    "action": null,
    "runnable": true
   },
   {
    "id": "mail-reply",
    "label": "Reply",
    "icon": "mail",
    "kind": "check",
    "how": "Ctrl+R",
    "action": null,
    "runnable": true
   },
   {
    "id": "mail-view",
    "label": "Mail view",
    "icon": "mail",
    "kind": "check",
    "how": "Ctrl+1",
    "action": null,
    "runnable": true
   },
   {
    "id": "calendar-view",
    "label": "Calendar view",
    "icon": "calendar",
    "kind": "check",
    "how": "Ctrl+2",
    "action": null,
    "runnable": true
   },
   {
    "id": "mail-search",
    "label": "Search mail",
    "icon": "search",
    "kind": "check",
    "how": "Ctrl+E",
    "action": null,
    "runnable": true
   },
   {
    "id": "event-open",
    "label": "Open next event",
    "icon": "calendar",
    "kind": "wall",
    "how": "opens it in Outlook",
    "action": "event:open-next",
    "runnable": true
   }
  ]
 },
 {
  "id": "recording",
  "title": "Recording",
  "exes": [
   "obs64.exe",
   "camtasiastudio.exe",
   "camtasia.exe"
  ],
  "keys": [
   {
    "id": "rec-toggle",
    "label": "Record or pause",
    "icon": "record",
    "kind": "check",
    "how": "F9",
    "action": null,
    "runnable": true
   },
   {
    "id": "rec-stop",
    "label": "Stop",
    "icon": "record",
    "kind": "check",
    "how": "F10",
    "action": null,
    "runnable": true
   },
   {
    "id": "rec-marker",
    "label": "Add marker",
    "icon": "flag",
    "kind": "check",
    "how": "Ctrl+M",
    "action": null,
    "runnable": true
   },
   {
    "id": "rec-layout",
    "label": "Record 16:9 layout",
    "icon": "camera",
    "kind": "wall",
    "how": "front window becomes a 16:9 box",
    "action": "layout:record169",
    "runnable": true
   },
   {
    "id": "rec-windows",
    "label": "Windows screen recording",
    "icon": "camera",
    "kind": "key",
    "how": "Win+Shift+R",
    "action": null,
    "runnable": true
   }
  ]
 },
 {
  "id": "powerbi",
  "title": "Power BI",
  "exes": [
   "pbidesktop.exe"
  ],
  "keys": [
   {
    "id": "pbi-save",
    "label": "Power BI: save",
    "icon": "save",
    "kind": "key",
    "how": "Ctrl+S",
    "action": null,
    "runnable": true
   },
   {
    "id": "pbi-refresh",
    "label": "Power BI: refresh",
    "icon": "refresh",
    "kind": "check",
    "how": "ribbon keys, to work out on your PC",
    "action": null,
    "runnable": false
   },
   {
    "id": "pbi-perf",
    "label": "Power BI: performance analyzer",
    "icon": "gauge",
    "kind": "check",
    "how": "ribbon keys, to work out",
    "action": null,
    "runnable": false
   },
   {
    "id": "pbi-tmdl",
    "label": "Power BI: TMDL view",
    "icon": "code",
    "kind": "check",
    "how": "to work out",
    "action": null,
    "runnable": false
   }
  ]
 },
 {
  "id": "excel",
  "title": "Excel",
  "exes": [
   "excel.exe"
  ],
  "keys": [
   {
    "id": "xl-filter",
    "label": "Excel: filter",
    "icon": "filter",
    "kind": "key",
    "how": "Ctrl+Shift+L",
    "action": null,
    "runnable": true
   },
   {
    "id": "xl-table",
    "label": "Excel: make a table",
    "icon": "table",
    "kind": "key",
    "how": "Ctrl+T",
    "action": null,
    "runnable": true
   },
   {
    "id": "xl-sum",
    "label": "Excel: sum",
    "icon": "sum",
    "kind": "key",
    "how": "Alt+=",
    "action": null,
    "runnable": true
   },
   {
    "id": "xl-repeat",
    "label": "Excel: repeat last action",
    "icon": "undo",
    "kind": "key",
    "how": "F4",
    "action": null,
    "runnable": true
   }
  ]
 },
 {
  "id": "house",
  "title": "House",
  "exes": [],
  "keys": [
   {
    "id": "mood-evening",
    "label": "Evening lights",
    "icon": "bulb",
    "kind": "wall",
    "how": "the Evening mood",
    "action": "mood:evening",
    "runnable": true
   },
   {
    "id": "mood-late",
    "label": "Late night lights",
    "icon": "moon",
    "kind": "wall",
    "how": "the Late Night mood",
    "action": "mood:late-night",
    "runnable": true
   },
   {
    "id": "tv-off",
    "label": "TV off",
    "icon": "tv",
    "kind": "soon",
    "how": "needs the home app draft merged",
    "action": null,
    "runnable": false
   },
   {
    "id": "alarms-seen",
    "label": "Mark network alarms seen",
    "icon": "shield",
    "kind": "soon",
    "how": "needs the home app draft merged",
    "action": null,
    "runnable": false
   },
   {
    "id": "dream",
    "label": "Dream",
    "icon": "moon",
    "kind": "wall",
    "how": "dark, slow screen",
    "action": "dream",
    "runnable": true
   }
  ]
 },
 {
  "id": "powertoys",
  "title": "PowerToys, if you have it",
  "exes": [],
  "keys": [
   {
    "id": "pt-run",
    "label": "PowerToys Run",
    "icon": "search",
    "kind": "check",
    "how": "Alt+Space",
    "action": null,
    "runnable": true
   },
   {
    "id": "pt-color",
    "label": "Color picker",
    "icon": "brush",
    "kind": "check",
    "how": "Win+Shift+C",
    "action": null,
    "runnable": true
   },
   {
    "id": "pt-ocr",
    "label": "Copy text from the screen",
    "icon": "copy",
    "kind": "check",
    "how": "Win+Shift+T",
    "action": null,
    "runnable": true
   },
   {
    "id": "pt-top",
    "label": "Keep window on top",
    "icon": "window",
    "kind": "check",
    "how": "Win+Ctrl+T",
    "action": null,
    "runnable": true
   },
   {
    "id": "pt-plain",
    "label": "Paste as plain text",
    "icon": "clipboard",
    "kind": "check",
    "how": "Win+Ctrl+Alt+V",
    "action": null,
    "runnable": true
   }
  ]
 }
];
