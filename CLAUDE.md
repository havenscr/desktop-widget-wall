# Widget Wall Desktop - Project Instructions

## Overview
**Widget Wall Desktop** is a Tauri-based desktop application that displays a personal dashboard with multiple widgets. It's designed for ultra-wide monitors (32:9 aspect ratio) and stays always-on-top when fullscreen.

**Owner:** Havens Consulting Inc.
**Origin:** Migrated from monolithic `unified-dashboard.html` (~6000+ lines) into modular Tauri app.

---

## Architecture

### Tech Stack
- **Tauri 1.5** - Rust backend with WebView2 (Windows)
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
│       │   ├── main.js         # Component loader (THE ONLY main.js!)
│       │   ├── lib/            # Third-party libraries (MSAL, PowerAudio)
│       │   └── widgets/        # Widget JavaScript modules
│       │       ├── theme.js        # Theme switching (6 color schemes)
│       │       ├── clock.js        # Clock widget logic
│       │       ├── weather.js      # Weather API integration
│       │       ├── twitch.js       # Twitch embed
│       │       ├── countdown.js    # Countdown timer
│       │       ├── claude-stats.js # Claude usage stats
│       │       └── ...             # Other widget modules
│       ├── widgets/            # HTML partials (loaded by main.js)
│       │   ├── clock.html
│       │   ├── weather.html
│       │   ├── twitch.html
│       │   ├── countdown.html
│       │   ├── recent-files.html
│       │   ├── calendar.html
│       │   ├── inbox.html
│       │   ├── system-stats.html
│       │   ├── calculator.html
│       │   ├── audio-mixer.html
│       │   ├── visualizer.html
│       │   ├── claude-stats.html
│       │   └── settings-panel.html
│       ├── styles/             # CSS stylesheets
│       │   ├── themes.css      # Theme variables (colors, filters)
│       │   ├── base.css        # Reset, grid layout, widget base styles
│       │   └── widgets.css     # Individual widget styles
│       └── assets/             # Static assets
│           ├── backgrounds/    # SVG backgrounds (mountains.svg)
│           ├── textures/       # 3D textures (earth, galaxy)
│           └── Sounds/         # Audio files (alarm, etc.)
├── src-tauri/
│   ├── Cargo.toml              # Rust dependencies
│   ├── tauri.conf.json         # Tauri config (window settings, etc.)
│   └── src/
│       └── main.rs             # Rust backend (system access)
├── package.json
├── vite.config.ts
└── CLAUDE.md                   # This file
```

**CRITICAL:** ALL CSS, JS, and assets MUST be in `src/public/`. Do NOT create `src/styles/`, `src/assets/`, or `src/scripts/` - these will NOT be included in builds!

### CRITICAL: Vite Public Folder

**All widget JS and HTML files MUST be in `src/public/`!**

Vite copies `public/` contents directly to `dist/` without processing. Since widgets are loaded dynamically at runtime via `loadScript()` and `fetch()`, they must be in the public folder.

- **DO edit:** `src/public/scripts/widgets/*.js` and `src/public/widgets/*.html`
- **DO NOT create:** `src/scripts/widgets/` or `src/widgets/` - these won't be included in builds!

---

## Grid Layout (5 columns x 3 rows)

```
┌─────────────┬─────────────┬─────────────┬─────────────┬─────────────┐
│ Clock       │ Countdown   │             │             │ Calendar    │
│─────────────│─────────────│   Spotify   │   Twitch    │─────────────│
│             │ Reminders   │             │             │ Email       │
│  Weather    │─────────────│             │─────────────│─────────────│
│             │ Recent Files│ Visualizer  │Stats│Calc   │Claude Stats │
└─────────────┴─────────────┴─────────────┴─────────────┴─────────────┘
```

Grid areas defined in `base.css`:
- `clockweather` - Flex column: clock (32%), weather (68%)
- `cardstack` - Flex column: countdown, reminders, recent-files (equal thirds)
- `spotify` - Full height
- `twitchstats` - Flex column: twitch (50%), stats+calc (50%)
- `calendarinbox` - 2x2 grid: calendar, email, claude-stats spanning bottom

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

### Background
SVG background (`mountains.svg`) uses CSS filters for theme reactivity:
```css
body::before {
  background-image: url('../assets/backgrounds/mountains.svg');
  filter: hue-rotate(var(--bg-hue-rotate)) saturate(...) brightness(...);
}
```

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
- **System stats** - CPU/RAM/disk monitoring

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
- `src-tauri/target/release/bundle/msi/Widget Wall_1.0.0_x64_en-US.msi`

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

6. Register in `src/public/scripts/main.js` (THE ONLY main.js):
```javascript
// In widgetConfig array:
{ container: 'new-widget-container', path: 'widgets/new-widget.html' },

// In widgetScripts array (if JS needed):
'scripts/widgets/new-widget.js',
```

---

## Settings Panel

The settings panel (`settings-panel.html`) provides configuration for:
- Desktop Bridge port (for native features)
- Twitch channel
- Countdown date/title
- Claude Stats Gist URL
- Visualizer mode

Settings are persisted to `localStorage`.

---

## Fingerprinting

All HTML files should include Analytic Endeavors fingerprinting per parent project CLAUDE.md. Use code `WWD` (Widget Wall Desktop) for fingerprints.

---

## Important Reminders

1. **No frameworks** - Keep it plain HTML/CSS/JS for easy maintenance
2. **EVERYTHING in src/public/** - All CSS, JS, assets, and widgets MUST be in `src/public/`. Do NOT create `src/styles/`, `src/assets/`, or `src/scripts/` folders.
3. **display: contents** - Always add to new container IDs
4. **Theme compatibility** - Test all 6 themes when making visual changes
5. **Mobile not supported** - This is a desktop-only 32:9 dashboard
6. **Browser vs Tauri** - Native features only work in Tauri app
7. **ONLY ONE main.js** - Edit `src/public/scripts/main.js`
8. **Update documentation** - When adding or changing features, update relevant documentation files (README.md, CLAUDE.md, inline code comments) to reflect the changes
