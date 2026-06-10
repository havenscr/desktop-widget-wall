# Widget Wall Desktop

![Tauri](https://img.shields.io/badge/Tauri-1.5-24C8D8?style=flat-square&logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-stable-000000?style=flat-square&logo=rust&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5.0-646CFF?style=flat-square&logo=vite&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?style=flat-square&logo=windows&logoColor=white)
![License](https://img.shields.io/badge/License-Proprietary-red?style=flat-square)

A personal dashboard application built with Tauri for ultra-wide monitors (32:9 aspect ratio). Displays multiple widgets including clock, weather, media playback, calendar, email, system stats, and more.

<!-- Add your own screenshot: save as docs/preview.png -->
<!-- ![Widget Wall Preview](docs/preview.png) -->

## Features

- **Always-on-top dashboard** - Stays visible above other windows
- **6 color themes** - Pink, Teal, Sunset, Midnight, Emerald, Rose
- **Performance mode** - Glass Blur Full/Lite/Off in Settings to cut standing GPU usage
- **System tray integration** - Minimizes to tray, hides from taskbar in fullscreen
- **Native Windows integration**:
  - Now Playing (media session)
  - Audio mixer control
  - System stats (CPU, RAM, GPU, disk)
  - Recent files access
- **Widget collection**:
  - Clock with date
  - Weather (Open-Meteo)
  - Now Playing (Windows media session)
  - Twitch stream embed with IRC chat
  - Countdown timer
  - Reminders/Task list
  - Calendar (Microsoft Graph)
  - Email inbox (Microsoft Graph)
  - Claude usage stats
  - Calculator
  - Audio visualizer (multiple modes)

## Requirements

### For Users (Running the App)
- Windows 10/11 (64-bit)
- WebView2 Runtime (bundled with installer)

### For Developers (Building from Source)
- [Node.js](https://nodejs.org/) v18 or higher
- [Rust](https://rustup.rs/) (latest stable)
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with C++ workload

## Installation

### Option 1: Download Installer (Recommended)
Download the latest `.msi` installer from the [Releases](https://github.com/reidhavens/widget-wall-desktop/releases) page.

### Option 2: Build from Source
```bash
# Clone the repository
git clone https://github.com/reidhavens/widget-wall-desktop.git
cd widget-wall-desktop

# Install dependencies
npm install

# Build the application
npm run tauri build
```

The installer will be at: `src-tauri/target/release/bundle/msi/Widget Wall_1.0.0_x64_en-US.msi`

## Development

```bash
# Install dependencies
npm install

# Run in development mode (browser preview only)
npm run dev

# Run with Tauri (full app with native features)
npm run tauri dev
```

**Note:** Native features (audio mixer, system stats, recent files) only work when running with Tauri, not in browser preview.

## Configuration

On first launch, configure the following in the Settings panel (gear icon):

### Required API Keys
| Widget | Service | How to Get |
|--------|---------|------------|
| Weather | OpenWeatherMap | [Get free API key](https://openweathermap.org/api) |
| Calendar/Email | Microsoft Azure | [Register an app](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) |
| Twitch | Twitch Developer | [Create an app](https://dev.twitch.tv/console/apps) |
| Spotify | Spotify Developer | [Create an app](https://developer.spotify.com/dashboard) |

### API Key Setup Guide

#### OpenWeatherMap (Weather Widget)
1. Go to [openweathermap.org](https://openweathermap.org/api)
2. Sign up for a free account
3. Navigate to "API Keys" in your profile
4. Copy your API key
5. Enter in Widget Wall Settings > Weather

#### Microsoft Graph (Calendar & Email)
1. Go to [Azure Portal](https://portal.azure.com/)
2. Navigate to Azure Active Directory > App registrations
3. Click "New registration"
4. Name: "Widget Wall Desktop"
5. Supported account types: "Personal Microsoft accounts only" (or include org accounts)
6. Redirect URI: `https://localhost:1420/auth-callback.html` (Web)
7. Copy the Application (client) ID
8. Enter in Widget Wall Settings > Microsoft

#### Twitch (Stream Widget)
1. Go to [Twitch Developer Console](https://dev.twitch.tv/console/apps)
2. Click "Register Your Application"
3. Name: "Widget Wall"
4. OAuth Redirect URLs: `https://localhost:1420/auth-callback.html`
5. Category: "Application Integration"
6. Copy the Client ID
7. Enter in Widget Wall Settings > Twitch

#### Spotify (Now Playing Widget)
1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create an app
3. Add Redirect URI: `https://localhost:1420/auth-callback.html`
4. Copy Client ID and Client Secret
5. Enter in Widget Wall Settings > Spotify

## Usage

### Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| `F11` | Toggle fullscreen |
| `Escape` | Exit fullscreen |

### System Tray
- **Left-click**: Show/restore window
- **Right-click menu**:
  - Show Window
  - Toggle Fullscreen
  - Quit

### Themes
Click the theme toggle button to cycle through available themes:
- Pink (default)
- Teal
- Sunset
- Midnight
- Emerald
- Rose

## Project Structure

```
widget-wall-desktop/
├── src/
│   ├── index.html            # Main entry point
│   ├── auth-callback.html    # OAuth callback
│   └── public/               # Static assets (copied to dist/)
│       ├── scripts/          # JavaScript modules
│       │   ├── main.js       # Component loader
│       │   ├── lib/          # Third-party libs
│       │   └── widgets/      # Widget JS modules
│       ├── widgets/          # HTML widget partials
│       ├── styles/           # CSS files
│       └── assets/           # Images, sounds, textures
├── src-tauri/
│   ├── src/main.rs           # Rust backend
│   ├── tauri.conf.json       # Tauri config
│   └── icons/                # App icons
├── scripts/                  # Build scripts
├── package.json
└── vite.config.ts
```

## Security Notes

- **No secrets in code**: All API keys are entered by users and stored in browser localStorage
- **Local storage only**: Credentials never leave your machine
- **HTTPS only**: All API calls use HTTPS
- **OAuth flows**: Microsoft and Spotify use proper OAuth 2.0 with PKCE where supported

## Troubleshooting

### Port 1420 already in use
```bash
# Windows
netstat -ano | findstr :1420
taskkill /PID <PID> /F
```

### WebView2 not found
The MSI installer bundles WebView2. If running from source and WebView2 is missing:
- Download from [Microsoft WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

### Native features not working
Native features (audio mixer, system stats) only work in the Tauri app, not browser preview:
```bash
npm run tauri dev  # Use this instead of npm run dev
```

## License

Proprietary - Havens Consulting Inc.

## Credits

- Built with [Tauri](https://tauri.app/) (Rust + WebView2)
- Weather data from [OpenWeatherMap](https://openweathermap.org/)
- Microsoft integration via [Microsoft Graph](https://developer.microsoft.com/en-us/graph)
- Twitch emotes via [FFZ](https://frankerfacez.com/), [BTTV](https://betterttv.com/), [7TV](https://7tv.app/)
- Icons and design by [Havens Consulting Inc.](https://havens-consulting.com/)
