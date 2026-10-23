# Widget Wall Desktop - Project Instructions

## Overview
**Widget Wall Desktop** is a Tauri-based desktop application that displays a personal dashboard with multiple widgets. It's designed for ultra-wide monitors (32:9 aspect ratio) and stays always-on-top when fullscreen.

**Owner:** Havens Consulting Inc.
**Origin:** Migrated from monolithic `unified-dashboard.html` (~6000+ lines) into modular Tauri app.

---

## Architecture

### Tech Stack
- **Tauri 2** - Rust backend with WebView2 (Windows)
- **Vite** - Dev server and build tool
- **Plain HTML/CSS/JS** - No frontend framework (intentional for simplicity)
- **Runtime component loading** - JavaScript fetch() loads widget HTML partials

### Why No Framework?
The original dashboard was pure HTML/CSS/JS. To minimize migration effort and maintain easy lift/shift capability, we kept it framework-free. Components are loaded via fetch() at runtime.

---

## Directory Structure

```
widget-wall-desktop/
├── src/
│   ├── index.html              # Vite entry point (loads from public/)
│   ├── auth-callback.html      # OAuth callback page
│   └── public/                 # ALL runtime assets (copied to dist/)
│       ├── scripts/
│       │   ├── main.js         # Component loader
│       │   │                   #   also defines window.dlog + ASSET_VERSION
│       │   │                   #   (= window.WW_BUILD, stamped per build by vite.config.ts)
│       │   ├── lib/            # Vendored libraries: msal-browser.min.js,
│       │   │                   #   three.min.js, pixi.min.js, poweraudio.js
│       │   │                   #   (visualizer libs lazy-loaded per mode)
│       │   └── widgets/        # Widget JavaScript modules
│       │       ├── visibility-manager.js  # isVisible (page + lock/display) + managedInterval()
│       │       ├── theme.js        # Theme switching (6 color schemes)
│       │       ├── clock.js        # Flip clock (minute-aligned updates)
│       │       ├── weather.js      # Open-Meteo API + skyline
│       │       ├── now-playing.js  # Windows media session display
│       │       ├── visualizer.js   # PowerAudio/MilkDrop/Circular modes
│       │       ├── twitch.js       # Twitch embed (smart widget pages)
│       │       ├── twitch-chat.js  # IRC chat client
│       │       ├── smart-widget.js # Twitch/YouTube page switcher
│       │       ├── countdown.js    # Countdown + focus timer
│       │       ├── calendar.js     # Microsoft Graph calendar + drive time
│       │       ├── inbox.js        # Microsoft Graph email
│       │       ├── microsoft-auth.js # MSAL token handling (HC + AE)
│       │       ├── system-stats.js # CPU/GPU/RAM/HD arcs
│       │       ├── claude-stats.js # Claude usage stats (widget hidden)
│       │       └── ...             # radio, skylines, recent-files, etc.
│       ├── widgets/            # HTML partials (loaded by main.js)
│       │   ├── clock.html
│       │   ├── weather.html
│       │   ├── countdown.html
│       │   ├── recent-files.html
│       │   ├── now-playing.html
│       │   ├── visualizer.html
│       │   ├── twitch.html
│       │   ├── system-stats.html
│       │   ├── calculator.html
│       │   ├── audio-mixer.html
│       │   ├── calendar.html
│       │   ├── inbox.html
│       │   ├── claude-stats.html
│       │   ├── reminders.html
│       │   ├── modals.html
│       │   └── settings-panel.html
│       ├── styles/             # CSS stylesheets
│       │   ├── themes.css      # Theme variables + body[data-perf] modes
│       │   ├── base.css        # Reset, grid layout, widget base styles
│       │   └── widgets.css     # Individual widget styles
│       └── assets/             # Static assets
│           ├── backgrounds/    # SVG backgrounds (mountains.svg)
│           ├── fonts/          # Vendored ATC clock fonts (woff2)
│           └── Sounds/         # Audio files (alarm, etc.)
├── src-tauri/
│   ├── Cargo.toml              # Rust dependencies (Tauri 2)
│   ├── tauri.conf.json         # Tauri v2 config (window settings, etc.)
│   ├── capabilities/
│   │   └── default.json        # Tauri v2 permissions for the main window
│   └── src/
│       ├── lib.rs              # Rust backend (commands, tray, run())
│       └── main.rs             # Thin binary entry calling the lib's run()
├── package.json
├── vite.config.ts
└── CLAUDE.md                   # This file
```

### Vite public folder

All CSS, JS, widget partials, and assets live under `src/public/`. Vite copies `public/` to `dist/` without processing, and widgets are loaded at runtime via `loadScript()` and `fetch()`, so anything placed in `src/styles/`, `src/scripts/`, `src/assets/`, or `src/widgets/` is silently left out of the build. Edit `src/public/scripts/widgets/*.js` and `src/public/widgets/*.html`.

---

## Grid Layout (5 columns x 3 rows)

```
┌─────────────┬──────────────┬─────────────┬───────────────┬──────────────┐
│ Clock       │ Countdown /  │ Now Playing │    Twitch     │ Inbox / Chat │
│─────────────│ Focus Timer  │             │ (smart pages) │              │
│             │──────────────│─────────────│───────────────│──────────────│
│  Weather    │              │             │ Audio │ Stats │              │
│             │ Recent Files │ Visualizer  │ Mixer │───────│   Calendar   │
│             │              │             │       │ Calc  │              │
└─────────────┴──────────────┴─────────────┴───────────────┴──────────────┘
```

Grid areas defined in `base.css` (grid-template-areas v9):
- `clockweather` - Flex column: clock (32%), weather (68%)
- `cardstack` - Flex column: countdown/focus timer (32%), recent-files (rest)
- `nowplaying-visualizer` - Flex column: now-playing (50%), visualizer (50%)
- `twitchstats` - Flex column: twitch smart widget (50%), stats/calc row (50%)
  with audio-mixer on the left and system-stats + calculator stacked right
- `calendarinbox` - Grid: inbox (top), calendar (bottom). Nav dots switch the
  column between Inbox / full Twitch chat / half chat views. The claude-stats
  widget lives here too but is `display: none` ("hidden for now")

---

## Component Loading Pattern

The `src/public/scripts/main.js` loader:
1. Fetches all widget HTML partials in parallel
2. Injects them into container divs (e.g., `#clock-container`)
3. Container divs use `display: contents` to be transparent to flex layout
4. After HTML loads, JS modules are loaded sequentially
5. Dispatches `dashboard-ready` event when complete

```javascript
// Example widget loading
await loadWidget('clock-container', 'widgets/clock.html');
```

---

## Key CSS Patterns

### Container Transparency
Container divs must use `display: contents` so they don't break flex layout:
```css
#clock-container,
#weather-container,
/* ... all containers ... */
{
  display: contents;
}
```

### Theme System
6 themes controlled via `data-theme` attribute on `<body>`:
- `pink` (default), `teal`, `sunset`, `midnight`, `emerald`, `rose`

Theme variables in `src/public/styles/themes.css`, toggle logic in `src/public/scripts/widgets/theme.js`.

Each theme sets `--accent-text`, a lighter step of its accent for text and
small glyphs (emerald, midnight and rose accents measure under 3:1 on the
glass). Fills, borders and rings keep `--accent-primary`. `--text-muted` (0.68)
and `--text-secondary` (0.8) are sized to clear WCAG AA 4.5:1 on the top row.

### Background
SVG background (`mountains.svg`) uses CSS filters for theme reactivity:
```css
body::before {
  background-image: url('../assets/backgrounds/mountains.svg');
  filter: hue-rotate(var(--bg-hue-rotate)) saturate(...) brightness(...);
}
```

The sky in the top half of `mountains.svg` is near-white, which `hue-rotate`
cannot tint, so `body::after` carries the theme color there: an
`--accent-primary-rgb` gradient over a top-weighted dark gradient. Without it
every theme sampled the same grey behind the top row. `body.custom-bg::after`
keeps a much lighter version for custom images.

---

## Tauri Integration

### Window Config (`tauri.conf.json`)
- `alwaysOnTop: true` - Stays above other windows
- `transparent: false` - Solid background
- `fullscreen: false` - Can be toggled
- `decorations: true` - Has title bar

### Native Features (Rust backend)
Features requiring system access are implemented in Rust:
- **Recent files** - File system access
- **Audio mixer** - System audio control
- **System stats** - CPU/GPU/RAM/disk. All user-mode, no kernel driver and no
  second process: `sysinfo` for CPU/RAM/disk, NVML (NVIDIA's user-mode library,
  ships with the driver) for GPU with the PDH `\GPU Engine(*engtype_3D)` counter
  as the vendor-agnostic fallback. This replaced a LibreHardwareMonitor HTTP
  poll on `localhost:8085`; LHM's ring-0 driver polls SMBus/EC sensors the
  widget never read, and that is a known cause of system-wide DPC latency
  spikes. Do not reintroduce it.
- **Focus Do Not Disturb** - `countdown.js` calls `enable_do_not_disturb` when
  the focus timer starts and `disable_do_not_disturb` on pause, reset, alarm and
  startup cleanup. At start it first calls `get_do_not_disturb` (reads the same
  WNF state; `null` when unreadable): if Do Not Disturb is already on, focus
  leaves it alone. A `focus-dnd-active` localStorage flag marks a Do Not Disturb
  that focus turned on, so a Do Not Disturb the user set is never undone. The
  commands run in order through one queue, and enable and disable return an
  error when the WNF write fails. The backend uses an undocumented WNF state
  that may do nothing on Windows 11 24H2.
- **Audio capture** - WASAPI loopback via `cpal`. Samples go into a lock-free
  SPSC ring (`AudioRing`), never a `Mutex`: the capture callback runs on the
  audio engine's MMCSS real-time thread, so it must not block or memmove.
  Levels are **pushed** to the frontend on the `audio-levels` event at 30Hz from
  the capture thread. Do not add a polling command back. All audio commands are
  `async` so Tauri keeps them off the main thread.
  `audio_analysis.rs` mixes to mono, applies a Hann window and runs a 1024-point
  real FFT (`realfft`, plan built once) to produce `bass` / `mid` / `high`
  (20-250 Hz, 250-4000 Hz, 4-16 kHz), `bands` (32 log-spaced, 0..255) and a
  128-point mono `waveform`. The push is skipped (ring still drained) while the
  WebView is hidden or the visualizer calls `set_audio_push(false)` (hidden or
  InfiniDream mode). During silence Rust sends one empty event, then a 1Hz
  heartbeat; the visualizer zeroes its levels after ~1/3 s of silence and drops
  to 8fps after 5 s, so its timers are time-based, never event-counted.
- **Sleep on lock / display off** - `display_watch.rs` subclasses the main
  window for `WM_WTSSESSION_CHANGE` and `GUID_CONSOLE_DISPLAY_STATE` (dimmed
  counts as on). Lock, display off, or the console no longer showing this
  session (`WTS_CONSOLE_DISCONNECT` for a fast user switch, `WTS_REMOTE_CONNECT`
  for remote desktop) hides the WebView and emits `display-state`
  `{ visible: false, reason: "lock" | "disconnected" | "display-off" }`;
  `WTS_CONSOLE_CONNECT` and `WTS_REMOTE_DISCONNECT` clear the disconnect. Unlock or display on
  emits `{ visible: true }` and shows it again only if the user has not hidden
  the window to the tray or minimized it (`USER_HIDDEN`).
  `visibility-manager.js` folds `display-state` into `isVisible()` and notifies
  only on a real change.

These won't work in browser preview - only in Tauri app.

---

## Development Commands

```bash
# Dev mode (browser preview only - no native features)
npm run dev

# Dev mode with Tauri (full app with native features)
npm run tauri dev

# Build production .exe
npm run tauri build
```

Build outputs:
- `src-tauri/target/release/Widget Wall.exe`
- `src-tauri/target/release/bundle/msi/Widget Wall_<version>_x64_en-US.msi`
- `src-tauri/target/release/bundle/nsis/Widget Wall_<version>_x64-setup.exe`

CI: `.github/workflows/build-windows.yml` builds all of the above on a Windows
runner for every push and uploads them as the `widget-wall-windows` artifact
on the Actions run page - no local toolchain needed.

---

## Common Issues & Fixes

### Port 1420 already in use
Kill the process:
```bash
netstat -ano | findstr :1420
taskkill //PID <PID> //F
```

### Widgets not sized correctly
Check that container divs have `display: contents` in CSS.

### Background not showing
Verify path: `url('../assets/backgrounds/mountains.svg')` (not `../assets/mountains.svg`).

### Theme toggle not working
Ensure only ONE element has `id="theme-toggle"` (not duplicated in settings-panel.html).

---

## Widget Development

### Adding a New Widget

1. Create `src/public/widgets/new-widget.html` with structure:
```html
<div class="widget widget-newwidget">
  <div class="widget-header">WIDGET NAME</div>
  <div class="widget-content">
    <!-- content -->
  </div>
</div>
```

2. Add container to `index.html` in appropriate grid area:
```html
<div id="new-widget-container"></div>
```

3. Add container to `display: contents` list in `base.css`

4. Add styles to `widgets.css`

5. Create `src/public/scripts/widgets/new-widget.js` if JS logic needed

6. Register in `src/public/scripts/main.js`:
```javascript
// In widgetConfig array:
{ container: 'new-widget-container', path: 'widgets/new-widget.html' },

// In widgetScripts array (if JS needed):
'scripts/widgets/new-widget.js',
```

---

## Settings Panel

The settings panel (`settings-panel.html`) provides configuration for:
- HC account: Azure client ID, sign-in, connection status
- AE account: Azure client ID, sign-in, connection status (AE inbox)
- Twitch: default channel, show widget, video mode, HLS worker URL, chat mode, emote channels
- Media sources: additional YouTube videos
- Countdown: event title, target date
- Claude Stats: data source, show widget
- Visualizer: default mode
- Startup window: target monitor, width, height
- Background: image source, custom SVG upload
- Theme cycling: auto cycle, transition mode, interval
- Visualizer colors: `now-playing.js` publishes the album-art palette
  (`window.nowPlayingPalette` plus a `nowplaying-colors` event, null when there is
  no art, grey art or radio) and `visualizer.js` `getThemeColors` prefers it over
  the theme colors. No setting; it is always on.
- Meeting ring: `calendar.js` `scheduleMeetingRing` pulses the next-meeting card
  5 minutes before start and goes urgent (one sound) at 1 minute, using one-shot
  timeouts recomputed on every `updateCalendarInfo`. The card, ring and
  leave-by alerts skip declined meetings (`pickCardEvents`; the Graph `$select`
  includes `responseStatus`), while the month grid and day list still show
  them. Sign-out (`showPlaceholder`) resets the card and clears the ring timers. Styles sit after the
  `.leave-alert-*` rules in `widgets.css` and honor reduced motion and
  `body[data-perf="off"]`.
- Performance mode (Glass Blur: Full/Lite/Off) - sets `body[data-perf]`, which
  `themes.css` uses to scale back the always-on widget backdrop blur (the
  dashboard's biggest standing GPU cost). Full is 6px, Lite 3px, Off 0px.
  Defaults to Off: on the built-in background Full and Off differ by under 1
  level on average. `migratePerfModeDefault` in `main.js` moves a saved 'full'
  (or missing) value to 'off' once when the built-in background is in use
  (marker `wwd-perf-off-migrated`), so a later explicit Full sticks.
  "Off" also disables the infinite weather/indicator animations, the
  `filter: blur()` layers, and the hardcoded-radius backdrop filters, since
  `--glass-blur` alone never reached those. JS that sets `backdrop-filter`
  inline must clamp to the current mode (see `applyIrcBackground` in
  `inbox.js`); an inline `!important` otherwise outranks every stylesheet rule
  and silently opts that element out of the setting.
- Debug Logging (default off) - gates `window.dlog()`, which the per-poll
  widget status logs route through; errors/warnings always print
- Location services: Google Maps API key, home address, leave notifications

Settings are persisted to `localStorage`.

---

## Fingerprinting

All HTML files should include Analytic Endeavors fingerprinting per parent project CLAUDE.md. Use code `WWD` (Widget Wall Desktop) for fingerprints.

---

## Important Reminders

1. **No frameworks** - Keep it plain HTML/CSS/JS for easy maintenance
2. **display: contents** - Always add to new container IDs
3. **Theme compatibility** - Test all 6 themes when making visual changes
4. **Mobile not supported** - This is a desktop-only 32:9 dashboard
5. **Browser vs Tauri** - Native features only work in Tauri app
6. **Update documentation** - When adding or changing features, update relevant documentation files (README.md, CLAUDE.md, inline code comments) to reflect the changes
