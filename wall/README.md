# Wall 2

Wall 2 is the next front end for Widget Wall. It lives beside the existing app
(`src/`, untouched) and is built with Vite, React and TypeScript (strict). It
runs in a plain browser for development and inside Tauri as a second app,
"Widget Wall 2". So far: a scaled stage, the live horizon, a left rail with
three places, a clock, the Work tab basics (weather, music, focus timer), a
small Tauri bridge and tests. Home and Unwind are still placeholders.

## Requirements

Node 22 or newer and npm. Nothing else is needed for the web side. The Tauri
build also needs Rust and the Windows toolchain; CI does that on a Windows
runner, so you rarely need it locally.

## Run, test, build (web)

All commands run from the repository root (or `cd wall` and drop `--prefix wall`).

```bash
npm --prefix wall ci            # install exact dependencies
npm --prefix wall run dev       # dev server at http://localhost:1421
npm --prefix wall run typecheck # tsc --noEmit, strict
npm --prefix wall test          # vitest run (jsdom)
npm --prefix wall run build     # type check, then vite build into wall/dist
npm --prefix wall run preview   # serve wall/dist
```

In a browser there is no Tauri. `src/bridge/tauri.ts` then answers `invoke`
from a mock table (`mocks`); fill it from tests or dev code. An unknown command
rejects with a clear error. Inside Tauri, `invoke` calls the real command.

## Run and build inside Tauri

`src-tauri/tauri.wall2.conf.json` is a second Tauri config. It overrides only
the product name ("Widget Wall 2"), identifier, version, the `build` block
(dev URL `http://localhost:1421`, build commands, `frontendDist` at
`wall/dist`) and one window (label `wall2`). Everything else comes from
`src-tauri/tauri.conf.json`.

**Window.** The window is labelled `wall2` and gets its own narrow capability,
`src-tauri/capabilities/wall2.json` (`core:default` only; the old `default`
capability is not loaded). This limits core and plugin permissions only; the
app's own commands stay callable from Wall 2 until a later change adds a command
list in `build.rs`. It is borderless, not resizable, not always on top
and not in the taskbar; the tray icon shows it ("Show Window" or a left click)
and quits it, and its tray menu has no "Toggle Fullscreen". At startup Rust
sizes it to the monitor that is exactly 2560 by 720 physical pixels, else the
monitor with the smallest height, else the primary monitor. When a monitor is
added or removed it moves back onto an exact 2560 by 720 monitor if one is
present, and does nothing if none is.

```bash
npm ci                  # root install, provides the Tauri CLI
npm --prefix wall ci    # dev:wall2 starts Vite from wall/, so install it first
npm run dev:wall2       # tauri dev with the second config
npm run build:wall2     # tauri build with the second config (installers)
```

`build:wall2` runs `npm --prefix wall ci && npm --prefix wall run build` first.
The old app is unchanged: `npm run tauri build` still builds "Widget Wall".

## Where things are

- Design surface: `wall/src/stage/fitScale.ts` holds `STAGE_WIDTH` (2560),
  `STAGE_HEIGHT` (720) and the pure `fitScale(windowWidth, windowHeight)`. The
  scale is `min(width / 2560, height / 720)`, exactly 1 at 2560 by 720.
  `wall/src/stage/Stage.tsx` applies it with a CSS transform and recomputes on
  resize. Lay out everything in design pixels inside the stage.
- Horizon: `wall/src/horizon/`. See "The horizon" below.
- Tokens and fonts: `wall/src/styles/tokens.css`, fonts and their licences in
  `wall/src/assets/fonts/`.
- Rail and places: `wall/src/rail/Rail.tsx`, store in `wall/src/state/places.ts`.
- Clock: `wall/src/clock/` (takes an injectable `now`).
- Tests sit next to the code as `*.test.ts(x)`.

## The horizon

A painted west view from across a lake: Olympic mountains, a small Seattle
skyline, the lake in front. It is drawn on one canvas by `HorizonCanvas.tsx`.

- **Renderer.** `renderer.ts` is the original hand-tuned drawing code ported to
  TypeScript. The maths and every constant are unchanged, so treat it as art, not
  as code to tidy. `draw(ctx, HorizonDrawOptions)` documents every option.
  The terrain (public elevation profiles) is in `terrain/west.json` and
  `terrain/south.json`.
- **Public API.** `index.ts` exports `drawHorizon(ctx, options)`, `HorizonOptions`,
  `sun`, `when`, `CAMERAS` and `blendCamera`.
- **Cameras.** `cameras.ts` holds one framing per place (`work`, `home`,
  `unwind`). Changing place glides the camera there over 1.6 seconds with a cubic
  ease (`blendCamera(from, to, t)`); the glide starts from wherever the camera is,
  so interrupting it is smooth.
- **Real time.** The sun, sky and city lights come from `Date.now()`, passed in
  as the `now` prop of `HorizonCanvas` (inject one in tests). The hour is never
  taken from the place. The music ripple (`echo`) and the moon exist in the
  renderer but are off until later pull requests.
- **Frame loop.** About 30 frames a second on `requestAnimationFrame`, none while
  `document.hidden` (`pacing.ts`). The backing store is stage scale times
  `devicePixelRatio`.
- **Reduced motion.** With `prefers-reduced-motion: reduce` the horizon is drawn
  once a minute and cameras switch without the glide.
- **Review hook (dev server only).** Open
  `http://localhost:1421/?hz=<place>&at=<ISO time>`. The clock freezes at that
  time, the camera jumps to the place and one still frame is drawn with
  animation time 0. `hz` is `work`, `home` or `unwind`. Give the time an offset,
  since a time without one is read in local time:
  - `?hz=home&at=2026-11-11T16:30:00Z` (UTC)
  - `?hz=home&at=2026-11-11T16:30:00%2B01:00` (a positive offset needs `%2B`; a
    bare `+` is also accepted, but `%2B` is the safe spelling. A negative offset
    such as `-08:00` needs nothing.)

  To match the original demo pixel for pixel, run the demo at the same hour and
  camera with its echo ripple off (and its moon off for `unwind`, since the review
  frame never draws a moon) and the same animation time, 0.

## The Work tab

`wall/src/screens/Work.tsx` lays out three panels over the horizon (design
pixels, glass style from the concept; clock is top left in `App.tsx`).

- **Focus timer** (`wall/src/focus/`). A ring with the minutes left in the
  middle. Choose 25, 50 or custom (5 to 120 minutes, steps of 5). Start, pause,
  resume, reset. The state is stored in `localStorage` key `wall2-focus` as an
  end time, so a restart resumes and a timer that ended while the app was closed
  shows as finished. The state lives in an app-level store (`store.ts`) with its
  own end timer, so the timer finishes and releases Do Not Disturb on any screen
  and while hidden (a soft glow on the ring, no modal, no chime yet). Do Not
  Disturb follows the old app's rule (`dnd.ts`): read the state at start; if it
  is already on, leave it alone; otherwise turn it on and remember that focus did
  it (key `wall2-focus-dnd`); turn it off on pause, reset, finish and app start
  only if focus turned it on. Calls run one at a time through a queue.
- **Weather** (`wall/src/weather/`). Open-Meteo from the front end (same request
  as the old app: Fahrenheit, mph, `timezone=auto`). Current temperature,
  condition with an icon, today's high and low, next six hours. Refreshes every
  15 minutes while visible, and once when the page returns after 15 minutes or
  more. On failure the last reading stays and shows its age in small text. The
  code to label and icon map is one pure function, `describeWeather` in `codes.ts`.
- **Music bar** (`wall/src/music/`). Polls `get_now_playing` every 2 seconds
  while visible (never while hidden). Art only from `album_art_base64` with an
  allowed mime (png, jpeg, webp, gif); `art_unchanged` keeps the current art.
  Previous, play or pause, next call `media_previous`, `media_play_pause`,
  `media_next`; failures are swallowed. Stopped or unknown shows a quiet
  "Nothing playing".
- **Settings** (`wall/src/settings/`). `localStorage` key `wall2-settings`, JSON
  with optional `latitude` and `longitude` (defaults 47.68, -122.21). No settings
  screen yet.
- **Browser dev.** `npm run dev` registers mocks for the music and Do Not
  Disturb commands (`src/bridge/devMocks.ts`, dev server only). Weather needs
  network access to Open-Meteo.

## Content security policy

Set in `src-tauri/tauri.wall2.conf.json` under `app.security.csp` (Wall 2 only;
the old app's config is untouched). It allows own files (`'self'`), data: images,
own fonts, and connections to the Tauri IPC (`ipc:`, `http://ipc.localhost`,
`https://ipc.localhost`) and `https://api.open-meteo.com`. Everything else is
denied (`default-src 'none'`); no `unsafe-eval`, no `unsafe-inline`. React sets
inline styles through the CSSOM (`element.style`), which CSP allows. To reach a
new host, add it to `connect-src` (data from `fetch`), `img-src` (pictures) or
`font-src`, and rerun the schema check: validate the file against
`node_modules/@tauri-apps/cli/config.schema.json`. `devCsp` is the same policy for `tauri dev`, plus the Vite origin and websocket
(`http://localhost:1421`, `ws://localhost:1421`) and inline scripts and styles,
which Vite's hot reload injects. Keep the two in step when you add a host.

## Touch

The strip is touch only. The app root sets `touch-action: manipulation`, controls
do not select text or flash a tap highlight, rail buttons show a pressed state on
`:active` and stay at least 72 by 72, and nothing depends on hover.

## CI

`.github/workflows/build-windows.yml` has a `wall-web` job (Ubuntu: install,
type check, test, build) and, in the Windows job, a second build uploaded as
the `widget-wall-2-windows` artifact.
