# Wall 2

Wall 2 is the next front end for Widget Wall. It lives beside the existing app
(`src/`, untouched) and is built with Vite, React and TypeScript (strict). It
runs in a plain browser for development and inside Tauri as a second app,
"Widget Wall 2". So far: a scaled stage, the live horizon, a left rail with
three places, a clock, the Work tab basics (weather, music, focus timer), a task
card, a network tile and mood buttons on Home, the Unwind tab with Watt the sheep, a sound ripple
on the horizon, the Zen place with Dream, a small Tauri bridge and tests. Home has its moods and a network tile; the rest of it is still to come.

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

## Home moods

The Home tab shows one big button per mood the home app already defines
(Day, Evening, Late Night and so on, in the home app's order, at most 12). Tapping
one sets the lights through the home app. Nothing is ever applied by itself: the
list loads when the tab opens and every 10 minutes while visible, and only a tap
changes the lights. A tapped button shows a spinner, then a check for 2 seconds; a
failure shows a short message under the row for 5 seconds. The last mood tapped is
marked quietly (`wall2-last-mood` in local storage, per device).

The commands are `wall2_moods` and `wall2_apply_mood` in
`src-tauri/src/wall2_home.rs`. They read `homeBaseUrl` from `feeds.json` like the
network tile and call two home app routes: `GET /api/moods` (the keys of `moods`
are the ids) and `POST /api/moods/<id>/apply` with no body. Ids must match
`^[A-Za-z][A-Za-z0-9]{0,31}$` and are checked before any request. Errors are
short and never hold the address: 409 reads "Moods are not set up in the home app
yet", 404 "Unknown mood", anything else "Could not set the mood". The requests
use the same 8 second timeout, 1 MB cap and no redirects as the other feeds. With
no `homeBaseUrl` the row says "Not set up"; with no moods it is hidden.

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
present. If none is, it stays where it is, and the stored target is cleared so
a DPI change cannot push the window back to coordinates that are now off
screen; it re-places itself when the strip returns.

**Placement and its log.** `src-tauri/src/wall2_window.rs` lists monitors with
Win32 and places the window with `SetWindowPos` on its handle: move onto the
monitor, set the full rectangle, read it back, retry up to 3 times. A window
subclass (Wall 2 only) re-applies the target after every `WM_DPICHANGED`, since
a display scale change while crossing monitors can otherwise undo the move. At
startup it places hidden, shows, places again, then re-checks at about 250 ms,
1 s and 3 s. Every step is written to `wall2-placement.log` (truncated at each
launch, about 256 KB at most): Windows build, DPI awareness, each monitor
(name, position, size, work area, DPI, scale, primary), the chosen target and
why, the window rectangle, client size, DPI, scale and visibility after each
step, DPI changes, and Moved, Resized and ScaleFactorChanged events for the
first 30 seconds. It holds no user, host or token data. To find it, paste this
into the Explorer address bar:

```
%LOCALAPPDATA%\com.havens-consulting.widget-wall2\logs
```

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
- **Morning view.** On Home, from 5:00 AM up to 11:30 AM local time, the camera turns
  south to Mount Rainier (`HOME_MORNING` in `cameras.ts`: `ter: 'south'`, azimuth 132 at
  the left edge, 42 px per degree, terrain exaggerated 1.9, horizon at y 582 like
  Home's west view). The rest of the day Home keeps the west view. `homeCameraFor(date)`
  holds the rule and `cameraFor(place, ms)` applies it to Home only; Work and Unwind never
  change. `HorizonCanvas` looks again once a minute, so 5:00 AM and 11:30 AM take effect
  while Home is open.
- **Cross-fade.** `blendCamera` cannot blend two terrains, so when the new camera has a
  different `ter` (entering Home in the morning, or 11:30 AM passing) the old view stays
  on a second canvas underneath while the main canvas fades in over it for 2 seconds
  (`crossfade.ts`), then the second canvas is hidden again. Moves within one terrain keep
  the 1.6 second glide. Reduced motion and the review still switch instantly.
- **Real time.** The sun, sky and city lights come from `Date.now()`, passed in
  as the `now` prop of `HorizonCanvas` (inject one in tests). The hour is never
  taken from the place. The music ripple (`echo`) and the moon are
  passed in as options; see "Audio, ripple and moon" below.
- **Frame loop.** About 30 frames a second on `requestAnimationFrame`, none while
  `document.hidden` (`pacing.ts`). The backing store is stage scale times
  `devicePixelRatio`.
- **Reduced motion.** With `prefers-reduced-motion: reduce` the horizon is drawn
  once a minute and cameras switch without the glide or the cross-fade.
- **Review hook (dev server only).** Open
  `http://localhost:1421/?hz=<place>&at=<ISO time>`. The clock freezes at that
  time, the camera jumps to the place and one still frame is drawn with
  animation time 0. `hz` is `work`, `home` or `unwind`. Give the time an offset,
  since a time without one is read in local time:
  - `?hz=home&at=2026-11-11T16:30:00Z` (UTC)
  - `?hz=home&at=2026-11-11T16:30:00%2B01:00` (a positive offset needs `%2B`; a
    bare `+` is also accepted, but `%2B` is the safe spelling. A negative offset
    such as `-08:00` needs nothing.)
  - `?hz=home` follows the morning rule for that time, read in the browser's local
    time zone (not the offset in the URL): `at=2026-11-11T07:12:00-08:00` shows
    Rainier on a Pacific-time machine and the west view on a UTC one. No fade.

  To match the original demo pixel for pixel, run the demo at the same hour and
  camera with its echo ripple off (the moon is on for `unwind`, which the review
  frame draws) and the same animation time, 0.

## The frame and the day ribbon

Every place sits on the concept's one grid (`wall/src/styles/frame.css`,
`wall/src/screens/Frame.tsx`). `Screens.tsx` only picks the place; each place has
its own component and stylesheet (`Work.tsx`, `Home.tsx` with `home.css`, and so on),
so a layout change touches only that place's files.

- **Shell**: inset 20, columns `88px 1fr`, gap 16 (rail, then main).
- **Main**: rows `490px 54px 104px`, gap 16. The top band (`.top`, stage y 20 to
  510) holds the clock and the place's panels, placed inside it. The empty band (y 526
  to 580) shows the horizon and Watt. The ribbon sits at y 596 to 700, over the lake.
  Unwind and Zen use `.main.tall` (one row, no ribbon); Unwind keeps its Tomorrow block
  instead. The clock and ribbon are one tree for every place, so they stay mounted when
  the place changes.
- **Zones**: `.zones` holds the concept's top band columns (`470px 1290px 596px`, the
  in-call `620px 1140px 596px` as `.zones.call`, Unwind's `470px 1fr 540px` as
  `.zones.wide`). Places move into them in their own parity pull requests.
- **Veil**: one element over the horizon (`App.tsx`), dark behind the panels and 0.3
  of that from the band down. Work and Meet 0.52, Home 0.36, Unwind 0.1. It eases
  between places (no ease when motion is reduced).

The day ribbon (`wall/src/ribbon/`, `styles/ribbon.css`) is on Work, Home and Meet:

- **Hours**: 6 AM to 12 AM, `RX(h) = 72 + (h - 6) * 128` in a ribbon 2416 px wide, a
  tick every hour and a label every two hours. A label within 70 px of the needle hides.
- **Sun**: sunrise and sunset in amber, rounded to the minute, hidden within 90 px of the
  needle. `sun.ts` bisects the horizon renderer's `sun()` for an altitude of -0.833
  degrees (cached per day). For 2026-11-11 that is 7:09 AM and 4:37 PM; the concept's
  "4:40" was an illustration. The sky gradient behind the hours puts the concept's
  colour stops on the real sunrise and sunset.
- **Row 1**: today's calendar from `wall2_meet_day`, read when the ribbon shows and
  every 5 minutes while visible, clipped to 6 AM to 12 AM. A chip is `past` once it
  has ended, `now` while the needle is inside it, and pink when the event is a
  livestream (`isLive`). Meet "Not set up" leaves the row empty with no text; any other
  failed read keeps the last good list.
- **Focus bar** (Work and Meet): today's focus sessions up to now, from the focus store.
  Each start, pause, reset and finish updates `localStorage` key `wall2-focus-day`
  (`{ sessions: [{ start, end }] }`, epoch ms). A running session is saved with its
  planned end, so one that ends while the app is closed is still right; pausing or
  resetting moves the end back. Each write keeps only today's sessions, and the ribbon
  only draws today's, so the bar clears at midnight.
- **Row 2**: only its icon for now (bolt on Work and Meet, house on Home). Agent
  segments come with the lanes, the house schedule with the rooms.
- **Needle**: a white pill with the time, moved on each whole minute while visible.
  Before 6 AM it stays at the left end and still shows the real time.
- **Dev**: the calendar comes from `src/bridge/devMocks/meet.ts`. A review still
  (`?hz=<place>&at=<ISO time>`, dev builds only) opens on that place, freezes the clock
  and ribbon at that time, puts the meet and task mocks' days on the review's date, and
  `src/ribbon/devMock.ts` adds the concept's two focus sessions if none are saved for
  that day.

## The Work tab

`wall/src/screens/Work.tsx` lays out three panels over the horizon (design
pixels, glass style from the concept; the clock is top left in the frame, `Frame.tsx`).

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
- **Music bar** (`wall/src/music/`). One app-wide poll (`store.ts`) shared by this bar and
  the Unwind view: it polls `get_now_playing` every 2 seconds
  while visible (never while hidden); each call gives up after 5 seconds so a hung
  call cannot stall the loop, and a late answer is dropped. Art only from `album_art_base64` with an
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

## Audio, ripple and moon

- **Audio** (`wall/src/audio/`). At app start inside Tauri, `capture.ts` asks Rust for the
  default loopback device, starts capture and listens to the `audio-levels` event (never
  `window.__TAURI__`). `store.ts` keeps smoothed `bass`, `mid`, `high` (0 to 1) and
  `playing`, which is true while sound arrived in the last 0.35 seconds; levels fall away
  once it is not. Silence is decided by the clock, never by counting events. The push is
  turned off with `set_audio_push(false)` while the page is hidden and on again when it
  shows. If the first start fails it stays silent and retries once after 30 seconds; if no
  event arrives for 5 seconds while visible it restarts capture once (once per app run, by design).
- **Browser dev.** Silent by default. Add `?audio=demo` to the URL for gentle fake levels.
- **Ripple.** While `playing`, `HorizonCanvas` passes `echo` to the renderer: `n`, `amp`, `cx`
  from the camera preset (`en`, `eamp`, `ecx`), opacity `ea` scaled by a smoothed
  loudness (bass weighted), `hs` 900. It fades in and out over about a second. Nothing is
  passed when silent, so pixels are unchanged. No ripple under reduced motion or in the
  review still.
- **Moon.** The Unwind camera draws the moon at (1730, 112) radius 44, once the glide to
  Unwind has finished (it goes as soon as a glide away starts); no other place does. The
  review still `?hz=unwind` draws it, since that camera jumps straight there.

## Unwind and Watt

`wall/src/screens/Unwind.tsx`: large album art, title, artist, a thin progress bar with
position and duration (advanced locally twice a second between polls while playing and
visible, never past the duration) and previous, play or pause, next buttons (96 by 96).
"Nothing playing" when stopped. The clock is top left as everywhere.

Watt (`wall/src/buddy/`) is the electric sheep, shown on Unwind only, drawn as SVG pixels
above the horizon canvas. It walks slowly between x 960 and 1220 on the Unwind horizon
line, sleeps with drifting z's between 9:30 PM and 6:30 AM local time, and shows little
notes while music plays (awake only). It pauses while hidden. Under reduced motion it is a
still pose with nothing drifting. The pixel maps in `sprites.ts` are the concept's own.

## Home feeds (task card and network tile)

Two cards read your home services. The web view cannot call them (the task
app refuses a request from another origin and the home app sends no CORS
headers), so Rust makes the calls: `src-tauri/src/wall2_feeds.rs`, three async
commands, one shared `ureq` agent with an 8 second timeout, answers capped at
1 MB. No secret is stored anywhere and the two addresses are not in the repository.

### Setting it up: `feeds.json`

Create `feeds.json` in Wall 2's app config directory, the folder Tauri calls
`app_config_dir` for the identifier `com.havens-consulting.widget-wall2`. On
Windows that is `%APPDATA%\com.havens-consulting.widget-wall2\feeds.json`. The
file is read on every call, so a change applies on the next refresh.

```json
{ "tasksBaseUrl": "https://example.invalid:8443", "homeBaseUrl": "http://192.0.2.10:8080" }
```

- `tasksBaseUrl` must be `https`. `homeBaseUrl` may be `http` or `https`.
- Each is a scheme, host and optional port only. A path (a trailing `/` too), a
  query, a fragment or a user name is refused.
- Prefer a `homeBaseUrl` that is encrypted: the home box's tailnet address (encrypted
  even over `http`) or an `https` front. Plain `http` on the LAN can be spoofed by
  another device on the same network, which could fake a green tile.
- A missing file or key shows "Not set up" on that card, quietly. A malformed
  address shows the card as unavailable.
- `homeSecurityUrl` is optional: the full address of the home app's Security page,
  for example `"homeSecurityUrl": "https://example.invalid/app/#/security"`. It must
  be `https`, may have any path, query or fragment, and may not carry a user name.
  Missing or invalid means the Security button stays hidden.

### Task card (Work tab, top right)

It sits flush right above the music bar (596 by 366 design pixels, same right edge as
the music bar, a 20 pixel gap after the weather card).

`wall/src/tasks/`. Shows the next three open tasks (`GET /api/tasks?status=open`,
already sorted by due date; only rows with kind `task` and status `open`). Each row:
a large check button, the title, a small due line ("today 3 PM", "tomorrow",
"Fri", "Nov 20", "overdue", or nothing) and a "Focus" button. Refreshes every 2
minutes while visible and after each completion.

- **Check**: the row is struck through at once and fades out after 2 seconds;
  `wall2_task_done` sends `PATCH /api/tasks/{id}` with `{"status":"done"}`. If that
  fails the row comes back with a small "Could not save".
- **Focus**: starts the focus timer with the length chosen on the focus card (25
  minutes unless changed) and shows the task title under "Focusing". Disabled
  while a session is running or paused. The label is saved with the session and
  cleared on reset and when the session finishes.
- **States**: "Not set up" (no address), "Nothing due" (empty list), "Tasks
  unavailable" (first read failed), and after a failed refresh the last good list
  with a small "updated N min ago".
- **Estimate and summary (feeds for later screens, no card change yet)**: each task
  carries `est` (`"15"`, `"30"`, `"45"`, `"60plus"` or null), read from the row's
  `estimate` field. `wall2_tasks_summary({ tag?, notTag?, list? })` returns
  `{ next, remaining, dueTomorrow }`: the first three open tasks, how many more are
  open, and the count and summed minutes (`60plus` counts as 60, no estimate counts
  as 0) of tasks due on the next local day. The three filters are all optional and
  combine:
  - `tag` keeps tasks whose `tags` contains it; `notTag` drops tasks whose `tags`
    contains it. Both ignore case. Each is trimmed, then must match
    `^[A-Za-z0-9][A-Za-z0-9 &/_-]{0,39}$`.
  - `list` is a list name, 1 to 60 characters after trimming, no control
    characters. Rust reads `GET /api/buckets` once for the call, finds the bucket
    whose `name` equals it (case and outer spaces ignored) and keeps tasks with that
    `bucket_id`. An unknown name gives an empty summary, not an error.
  - A bad value is refused before any request. None of the three ever goes into a URL.
  - "Around the house" is `tag: "home"`. Work is `notTag: "home"`.

  The existing `wall2_tasks_next` is unchanged.

### Network tile (Home tab, right)

`wall/src/home/`. Reads `GET /api/security?lite=1` and shows a status dot and
line, the open-alert count and "last scan N min ago". Refreshes every 5 minutes
while visible. The open count follows the home app's own page: an alert whose
reviewed request is waiting is hidden; a done request hides it until a newer
summary arrives; a failed request hides nothing.

- **Green**: "Up, box online".
- **Amber**: the scan is stale, the firewall API state is unknown, or the home app
  cannot be reached.
- **Red**: only when the firewall API is down or the box is offline.
- "Not set up" when there is no address.

Two quiet text buttons sit under the status, each at least 72 design pixels tall and
shown only when available. **Security** opens `homeSecurityUrl` from `feeds.json`.
**Firewalla** opens the `portalUrl` from the most recent good security read, and
only when it is `https` on `firewalla.net` or a subdomain. Both open in the default
browser, and Rust does the opening (`wall2_open_link`, kinds `security` and
`portal`); the web view only names the kind and never supplies a URL, and
`capabilities/wall2.json` grants no opener permission. `wall2_links` tells the tile
which buttons to show. A failed open shows "Could not open" for 3 seconds.

Browser dev (`npm run dev`) shows both cards from mocks in `devMocks.ts`.

## Meet

The Meet tab shows the next meetings from up to two Microsoft 365 calendars for the next 24 hours, a calm countdown to the next one ("In 42 min", "Now, 12 min left", "At 3:30 PM"), and a Join button for Teams links. It makes no sound, flashes nothing and uses no red; the countdown turns the accent colour only in the last five minutes. Cancelled, declined and all-day events are left out, and the same invite on both accounts shows once.

All token and Graph work happens in Rust (`src-tauri/src/wall2_meet/`). The web view sees account states, titles, times and opaque keys. It never sees a token, an authorization code, an email address or a join link, and the content security policy does not change (Graph and login hosts are not allowed in `connect-src`). Every Meet command refuses any window but `wall2`.

### Setting it up: `meet.json`

Create `meet.json` next to `feeds.json` in Wall 2's app config directory (`%APPDATA%\com.havens-consulting.widget-wall2\`). It holds no secrets:

```json
{
  "accounts": [
    { "id": "work", "label": "Work", "clientId": "00000000-0000-0000-0000-000000000000" },
    { "id": "second", "label": "Second", "clientId": "00000000-0000-0000-0000-000000000000", "tenant": "common" }
  ]
}
```

- At most two accounts. `id` is 1 to 16 characters of `a-z` and `0-9`, unique. `label` is 1 to 16 printable characters. `clientId` is the application (client) ID of an app registration. `tenant` is optional: `common` (default), `organizations`, `consumers` or a tenant GUID.
- A missing file shows "Not set up". A file that fails these rules also shows "Not set up" with a note; the native side reports `invalid-config` and never echoes the file.

### Sign in and sign out

Tap Meet, then "Sign in" on an account. Wall 2 opens the system browser at the Microsoft sign-in page and waits up to 5 minutes on a loopback listener (`127.0.0.1`, a random port). The sign-in uses PKCE (S256) and a random `state`; the listener answers 404 to any other path and 400 to a callback whose `state` is wrong or missing (and keeps waiting), and it closes after the first valid callback, a failed or denied answer, a cancel, or the 5 minute limit. The redirect is `http://localhost:<port>/auth-callback.html`; Microsoft ignores the port for `localhost` redirects, so the registrations the old app already uses accept it. If the browser shows AADSTS50011 (reply URL mismatch), add `http://localhost/auth-callback.html` under "Mobile and desktop applications" in that app registration.

The only scopes asked for are `offline_access` and `Calendars.Read`. After the first sign-in Wall 2 refreshes silently. "Sign out" deletes the stored token and the cached access token on this machine; it does not call Microsoft. "Cancel" ends a waiting sign-in. A sign-in that Microsoft rejects later (`invalid_grant`, or another refusal such as `consent_required`) shows "Sign in needed". Leaving Meet during a sign-in cancels it. If one account is unavailable, its last meetings and Join buttons stay (with "updated N min ago") until it answers again.

### Where the token lives

The refresh token is kept in Windows Credential Manager (Windows Credentials, Generic), target `WidgetWall2/meet/<id>/<n>`, user name `wall2`. A generic credential holds at most 2560 bytes, so a long token is split over up to four entries (`/0`, `/1`, and so on). Credential Manager protects them per Windows user. Access tokens are kept in memory only and are never written anywhere.

### Day feed

`wall2_meet_day` returns today's events for the day ribbon and Home: from local
midnight to 36 hours after it, past events included, up to 40 merged across both
accounts. Each event has `key`, `accountId`, `title`, `start`, `end`, `canJoin` and
`isLive`, with the same rules as the next-meetings read (no body, attendees or
organizer; cancelled, declined and all-day events left out; the same invite on both
accounts once; join links behind keys). `isLive` is true when the subject starts with
"Livestream". Day keys start with `d` and live in their own map, so a day read never
invalidates a Join key from the next-meetings read. An unavailable account adds no
events to the day view (there is no "updated N min ago" copy here).

### Join links

Join opens only a Teams meeting link: `https` with no user name, password or port other than 443, host exactly `teams.microsoft.com` or `teams.live.com`, a path starting `/l/meetup-join/` or `/meet/`, and at most 2048 characters. Anything else (Zoom, Google Meet, a Safe Links wrapper, an unknown Teams format) shows no Join button. The link stays in Rust behind a key like `3-1`; the web view passes only the key, and Rust checks the rules again before opening it in the system browser. The Wall 2 capability has no opener permission.

### Refresh

The list is read when Meet opens and every 5 minutes while Meet is the active place and the window is visible. The countdown ticks every 30 seconds from the last list. A failed read keeps the last list and shows "updated N min ago". When a read leaves an account unavailable, Meet reads again after 30 seconds, then after 60 seconds, then goes back to the 5 minute cadence; the fast retries stop when Meet is hidden, and Try again does not use them up. The calendar read asks for at most 50 events in the next 24 hours and ignores paging (50 is plenty for a day). It selects only the subject, times, response, join link and invite id, never the body, attendees or organizer.

### Why an account is unavailable

An unavailable account (and a "Sign in needed" account whose sign-in was refused) shows a quiet second line with a plain reading and a short code in brackets, for example "Calendar refused the request (graph-403-ErrorAccessDenied)". An unavailable row has three buttons: Try again (reads at once), Sign in and Sign out. A code has one of these fixed shapes and nothing else:

| Code | Meaning | Shown as |
| --- | --- | --- |
| `graph-<status>` | Graph answered with that HTTP status and a JSON body with no usable error code | 403 "Calendar refused the request", 400 "Calendar did not understand the request", 429 and 5xx "Calendar is busy, trying again", 401 "Calendar did not accept the sign-in", other "Calendar could not be read" |
| `graph-<status>-<code>` | The same, plus Graph's `error.code` when it matches `^[A-Za-z][A-Za-z0-9_]{0,39}$` | the same words as its status |
| `graph-network` | Transport error or timeout | "No connection to Microsoft" |
| `graph-body` | A reply that could not be read: a 2xx body too large or not JSON, or an error body over 16 KB, not JSON or cut short | "Calendar sent a reply that could not be read" |
| `token-<status>` | HTTP status of the token endpoint, on a refresh or on the first redemption after the browser callback | "Sign-in was not accepted" |
| `token-<status>-<n>` | The same, plus the first number of `error_codes` (digits only, at most seven), for example `token-400-9002327` | "Sign-in was not accepted" |
| `token-network` | The token endpoint could not be reached | "No connection to Microsoft" |
| `store-write` | Credential Manager refused to save the sign-in | "Could not save the sign-in on this PC" |
| `store-read` | Credential Manager could not be read (anything but "not found"); nothing is deleted or overwritten | "Could not save the sign-in on this PC" |

An error body is read up to 16 KB (one more byte is read to tell that it was too big), and only to find `error.code` or `error_codes`. A code that fails the check is dropped and only the status stays. A failed first redemption (the browser said "Signed in" but the token step failed) shows the same kind of code in the notice under Accounts.

### The Meet log: `wall2-meet.log`

Wall 2 writes `wall2-meet.log` in the app log directory (the same folder as `wall2-placement.log`). It is cleared at every launch, capped at 64 KB, and a write failure is ignored. It gets one line each time an account's state or reason changes, never one per poll:

```
2026-11-12T17:00:00Z hc start ok none
2026-11-12T17:05:00Z hc ok unavailable graph-403-ErrorAccessDenied
```

The fields are the UTC time, the account `id` from `meet.json`, the old state, the new state and the reason code (`none` when there is none). The states are `start`, `ok`, `signed-out`, `needs-sign-in`, `unavailable`, `signed-in` and `sign-in-failed`.

### What is never logged

The Meet module has no `println!`, `eprintln!` or `dbg!`, and the only file it writes is `wall2-meet.log` above. Tokens, codes, `state`, the verifier, query strings, URLs, email addresses, names, meeting subjects and HTTP bodies never reach a log, a reason code or an error text. Every failure maps to a fixed string (`not-configured`, `invalid-config`, `busy`, `cancelled`, `timed-out`, `denied`, `failed`, `gone`, `forbidden`) or to one of the reason codes above, which are built only from numbers and a checked `error.code`.

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

## Fullscreen keys

F11 and Ctrl+F11 toggle true fullscreen; Esc leaves it (only while fullscreen; an Esc pressed during a toggle is queued and applied when it finishes).
A rail button just above Tools does the same (icons `maximize` and `minimize`,
label "Enter fullscreen" or "Exit fullscreen", follows the real state, hidden
outside Tauri). Key repeats are ignored and nothing happens in a plain browser. The handler is
`wall/src/ui/fullscreen.ts`, installed from `main.tsx`. Leaving fullscreen
restores the outer position and size saved just before entering fullscreen.
One change runs at a time (a second request while one is in flight is ignored).
`src-tauri/capabilities/wall2.json` adds `core:window:allow-set-fullscreen`,
`allow-set-position` and `allow-set-size` (Wall 2 only). Reading the state
(`isFullscreen`, `outerPosition`, `outerSize`) is already in `core:default`.

## Touch

The strip is touch only. The app root sets `touch-action: manipulation`, controls
do not select text or flash a tap highlight, rail buttons show a pressed state on
`:active` and stay at least 72 by 72, and nothing depends on hover.

## CI

`.github/workflows/build-windows.yml` has a `wall-web` job (Ubuntu: install,
type check, test, build) and, in the Windows job, a second build uploaded as
the `widget-wall-2-windows` artifact.

## Zen and Dream

`wall/src/zen/`. The Zen button in the rail opens a calm full-stage view over everything
else (the rail and clock are hidden under it). It is front end only: it does not change
the system volume, Do Not Disturb or the focus timer.

- **Flames** (`Flames.tsx`). Two stacked full-stage layers of slowly drifting fractal
  flames: the lower layer plain, the upper one screen-blended, drifting the other way
  and fading in and out. Every 4 minutes the pair moves to the next flames with a 30
  second cross-fade. Under reduced motion the layers are still and the pair changes
  without a fade. The three images are in `wall/src/assets/flames/`; they were rendered
  for this project with a fractal flame renderer (see the README there).
- **Breathing guide** (`Breath.tsx`, maths in `model.ts`). A 12 second cycle: 4 s in,
  2 s hold, 6 s out. A thin cyan to pink ring scales from 0.8 to 1.06 of 370 px with a
  cubic ease, inside a faint fixed ring at the full inhale size, with a glow (a sibling of the masked ring) that
  brightens on the inhale. The phase word and the seconds left sit in the centre at a
  fixed size; `minRingDiameter` checks that the longest word clears the smallest ring by
  40 px. Starting restarts the cycle at "Breathe in".
- **Zen layout** (`Zen.tsx`). Flames sit behind a veil that leaves about 45 percent of their
  light. Top left: the clock. Bottom left: the length picker and Start, or while a session
  runs "FIVE MINUTES OF ZEN" with "N:NN left.". Bottom centre while running: "Touch anywhere
  to end early" (a tap outside Leave ends the session). Bottom right: Leave, and "After this:
  N things are waiting." from the same task feed as the Work card (hidden when it is not set
  up or empty; the "Neither is urgent." line shows only when every task has a quadrant and
  none is urgent). The feed returns at most 3 tasks, so a full list reads "3 or more things are waiting." with no urgency line; under reduced motion the ring holds still and only the word and seconds change.
- **Dream** (`Dream.tsx`). Flames dim to 35 percent, the guide is hidden, a small clock
  shows, and Watt sleeps in the corner (the `SheepSvg` sleep pose from `buddy/Watt.tsx`,
  at x 1226, ground line 688). Dream starts when a session ends (the guide fades out
  first), or when Zen opens between 9:30 PM and 6:30 AM local time (the same window as
  Watt's sleep). A tap anywhere wakes back to Zen; after a wake at night it stays awake
  until Zen is left and opened again. Leave returns to Work.
- **Horizon.** While Zen is active the horizon canvas is hidden and not drawn (no frame
  loop, no timer redraw). Leaving resumes it, gliding from the last camera.
