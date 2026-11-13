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

Home follows the concept's `f_home` on the frame's zones (`screens/Home.tsx`,
`styles/home.css`): the sun block under the clock in the left wing, the mood cards
across the centre, and Around the house with the network card in the right wing. The
Rooms row and the House line stay hidden until the home app reads them (PRs 24 and 25),
so the mood cards take the centre's full height.

- **Sun block** (`home/LeftWing.tsx`, `home/sunLine.ts`): from the horizon's own sun
  (`ribbon/sun.ts`), to the nearest minute. "Sunset in N min" in amber within 90
  minutes before sunset; earlier, the sunset time and the daylight left; before
  sunrise, the sunrise time; after sunset, tomorrow's sunrise.
- **Columns** are fixed (`.home-wing` 1, `.moods` 2, `.home-right` 3), so a zone that
  renders nothing never shifts the others.
- **Mood cards** (`home/Moods.tsx`, `home/MoodArt.tsx`): one card per mood the home
  app defines, in its order (today Day, Evening and Late Night). Each card has painted
  art drawn as one SVG (Day a sun, Evening a striped sunset, Late Night a moon and
  stars; Movie and Goodnight are drawn too for when they exist, and any other mood gets
  a lamp glow) and the concept's line under the name where it has one. Nothing fakes a
  mood the home app lacks. The last mood tapped carries an "On now" tag and a cyan ring.

The Home tab shows one card per mood the home app already defines
(at most 12). Tapping
one sets the lights through the home app. Nothing is ever applied by itself: the
list loads when the tab opens and every 10 minutes while visible, and only a tap
changes the lights. A tapped card shows a spinner, then a check for 2 seconds; a
failure shows a short amber message on the Moods line for 5 seconds. The last mood
tapped is kept per device (`wall2-last-mood` in local storage). The last good list is
kept too (`wall2-moods-cache`), so the cards stay, with a quiet amber "Home app not
reachable" on the Moods line, when the home app is briefly away; with no list ever
read, that line is all the row shows. When the home app answers with no moods, one
compact card says "No moods set up in the home app yet". "On now" marks the last mood
tapped on this wall; a mood set from a phone or a routine shows only once the home feed
carries the active mood.

The commands are `wall2_moods` and `wall2_apply_mood` in
`src-tauri/src/wall2_home.rs`. They read `homeBaseUrl` from `feeds.json` like the
network tile and call two home app routes: `GET /api/moods` (the keys of `moods`
are the ids) and `POST /api/moods/<id>/apply` with no body. Ids must match
`^[A-Za-z][A-Za-z0-9]{0,31}$` and are checked before any request. Errors are
short and never hold the address: 409 reads "Moods are not set up in the home app
yet", 404 "Unknown mood", anything else "Could not set the mood". The requests
use the same 8 second timeout, 1 MB cap and no redirects as the other feeds. With
no `homeBaseUrl` the row says "Not set up"; with no moods it shows the one compact card.

### Around the house (Home, right wing)

`home/Chores.tsx` and `home/useChores.ts`: the next three open tasks tagged `home` (a
tag, not a list) from `wall2_tasks_summary({ tag: "home" })`, with "N more can wait"
for the rest. The pill shows the time for a task due later today at a set time, else
its estimate. Ticking the circle strikes the row at once, saves it with
`wall2_task_done`, hides it after 2 seconds and reads the list again; a failed save
brings the row back marked "not saved". Read on show and every 2 minutes while visible.
Each read takes a generation number (as in `tasks/useTasks.ts`), and only a read that
started after a tick's save settled may bring that row back, so an older read landing
late cannot restore a finished chore. A failed read after a good one keeps the rows,
dimmed with the count, and puts a quiet amber "Task app not reachable" by the heading.
With every shown chore ticked it says "Loading the next ones" until the refresh lands
("Could not load the next ones" if it fails). "Not set up", "Task app not reachable"
and "Nothing waiting around the house" are one line each. The tick's tap area is the
button itself, 52 by 44, inside its own row; titles stay on one line with an ellipsis.
Clicking a chore's title (not its tick) opens it in the task app with
`wall2_open_task` (see "Task card").

**Fit check** (not run by CI, it needs a Chromium binary):
`node scripts/home-fit-check.mjs /path/to/chrome [shot.png]` (or `CHROME=... npm run
fit:home`) builds a development bundle, opens Home at 16:36 in headless Chromium, gives
every chore a long title and checks that the right wing stays inside the 490 px band,
that titles stay on one line, that three alert rows show and that no two tick hit areas
overlap. It prints what it measured and exits 1 on any failure.

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
  The terrain (public elevation profiles) is one panorama, `terrain/pano.json`, from
  azimuth 128 (Rainier, to the south) round to 300 (the Olympics, to the west). The
  older single views `terrain/west.json` and `terrain/south.json` are imported only by
  `pano.parity.test.ts` (through `registerTerrain`), so they are not bundled; that test
  checks the panorama draws within 0.5 percent of the stage height of them for 99
  percent of the skyline (the worst sample is 4.1 px, on a cliff on Unwind).
- **Public API.** `index.ts` exports `drawHorizon(ctx, options)`, `HorizonOptions`,
  `sun`, `when`, `CAMERAS` and `blendCamera`.
- **Cameras.** `cameras.ts` holds one framing per place (`work`, `home`,
  `unwind`). Changing place glides the camera there over 1.6 seconds with a cubic
  ease (`blendCamera(from, to, t)`); the glide starts from wherever the camera is,
  so interrupting it is smooth.
- **Morning view.** On Home, from 5:00 AM up to 11:30 AM local time, the camera swings
  south to Mount Rainier (`HOME_MORNING` in `cameras.ts`: azimuth 132 at the left edge,
  42 px per degree, terrain exaggerated 1.9, horizon at y 582 like Home's west view,
  snow line 0.86 against 0.84 on the west presets, and no ripple). Every camera looks at
  the same panorama, so the turn is a camera move, never a fade. The first turn from a
  west camera to Rainier each local day (used up once it passes half-way, so tapping away
  sooner keeps it; kept in memory, so a restart may play it again)
  is the cinematic move (`cinematicCamera`): 4.6 s, every number on a sine ease
  `0.5 - 0.5 cos(pi k)`, plus a pull-back (`ppd - 10 sin(pi k)`) and a lower horizon
  (`hy + 14 sin(pi k)`), so it widens mid-turn and then pushes in on the mountain. It is
  clamped to the panorama (`az0` at least 128.3, right edge at most 299.8). Later turns
  that morning and the 11:30 AM turn back use the plain glide: any move of more than
  40 degrees (`SWING_DEGREES`) takes `SWING_SECONDS` (3.2 s, cubic ease) instead of 1.6.
  The length comes from the move's logical ends (the camera it was heading to and the new
  one), so a turn back that interrupts another move part-way still takes the full 3.2 s.
  Seattle slides out to the right on the way round and back in on the way back. The clouds
  turn too: `HorizonCanvas` passes the renderer `cloudShift = (221.5 - az0) * ppd * 0.35`
  (`cloudShiftFor`), so they slide the same way as the land at about a third of its speed
  and wrap round the stage; on the Work camera the shift is 0 and the clouds sit as before. The rest
  of the day Home keeps the west view. `homeCameraFor(date)`
  holds the rule and `cameraFor(place, ms)` applies it to Home only; Work and Unwind never
  change. `HorizonCanvas` looks again once a minute, so 5:00 AM and 11:30 AM take effect
  while Home is open.
- **One canvas, no cross-fade.** Every camera is on the one panorama, so every change of
  view, entering Home in the morning and 11:30 AM passing included, is a camera move on a
  single canvas. The ripple has a camera gate (`stepEchoGate` in `echo.ts`): a move to a
  camera with `ea` 0 (Rainier) ramps it out over its first 0.6 s, it stays off while Rainier is
  the view and while the turn away runs, and it ramps back in over 0.6 s once that turn
  settles. So the filled echo never crosses Rainier and never pops. Reduced motion and the review still
  switch instantly.
- **Real time.** The sun, sky and city lights come from `Date.now()`, passed in
  as the `now` prop of `HorizonCanvas` (inject one in tests). The hour is never
  taken from the place. The music ripple (`echo`) and the moon are
  passed in as options; see "Audio, ripple and moon" below.
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
  - `?hz=home` follows the morning rule for that time, read in the browser's local
    time zone (not the offset in the URL): `at=2026-11-11T07:12:00-08:00` shows
    Rainier on a Pacific-time machine and the west view on a UTC one. No fade.

  To match the original demo pixel for pixel, run the demo at the same hour and
  camera with its echo ripple off (the moon is on for `unwind`, which the review
  frame draws) and the same animation time, 0.

## The frame and the day ribbon

Every place sits on the concept's one grid (`wall/src/styles/frame.css`,
`wall/src/screens/Frame.tsx`). `Screens.tsx` only picks the place; each place has
its own component and stylesheet (`Work.tsx` with `work.css`, `Home.tsx` with
`home.css`, `Meet.tsx` with `meet.css`, `Unwind.tsx` with `unwind.css`), so a layout
change touches only that place's files. The shared glass panel, type and button classes
(`.panel`, `.k`, `.btn` and so on) still sit at the top of `work.css`.

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
- **Shared numbers**: `screens/frameLayout.ts` holds the shell, row and zone values;
  `frameLayout.test.ts` reads `frame.css` as text and checks it uses the same ones. The
  top band has no padding, so the clock sits at the main area's corner (stage x 124,
  y 20) and the zones end exactly at its right edge (2416).
- **Veil**: one element over the horizon (`App.tsx`), dark behind the panels and 0.3
  of that from the band down. Work and Meet 0.52, Home 0.36, Unwind 0.1. It eases
  between places (no ease when motion is reduced).

The day ribbon (`wall/src/ribbon/`, `styles/ribbon.css`) is on Work, Home and Meet:

- **Hours**: 6 AM to 12 AM, `RX(h) = 72 + (h - 6) * 128` in a ribbon 2416 px wide, a
  tick every hour and a label every two hours. A label within 70 px of the needle hides.
- **Sun**: sunrise and sunset in amber, rounded to the minute, hidden within 90 px of the
  needle. `sun.ts` bisects the horizon renderer's `sun()` for an altitude of -0.833
  degrees (cached per day). For 2026-11-11 that is 7:09 AM and 4:37 PM, matching the
  almanac (the concept's "4:40" was a rounded label). The sky gradient behind the hours
  puts the concept's colour stops on the real sunrise and sunset.
- **Row icons**: the calendar icon and the row 2 icon carry a tooltip naming their row
  ("Today's calendar"; "Agent activity and tasks due today" on Work and Meet, "Home
  tasks due today" on Home). A row says it is empty, in quiet text beside its icon, only
  when that is known: "No meetings today" after a good calendar read with nothing today
  ("Calendar not available" when the read lists accounts and none could be read),
  "Nothing scheduled at home" after a good task read with nothing due, and "No agent
  activity yet" when the helper answered (fresh) with no span today and the task read was
  good with nothing due. Before a read, after a failed read, or when Meet, the task app or
  the helper is not set up, the row shows nothing.
- **Row 1**: today's calendar from `wall2_meet_day`, read when the ribbon shows and
  every 5 minutes while visible, clipped to 6 AM to 12 AM. A chip is `past` once it
  has ended, `now` while the needle is inside it, and pink when the event is a
  livestream (`isLive`). An event that overlaps an earlier one goes in a second lane, 4 px
  lower and a little shorter. A chip narrower than 44 px shows no title (it keeps a
  tooltip and an accessible name). Meet "Not set up" leaves the row empty with no text;
  any other failed read keeps the last good list.
- **Focus bar** (Work and Meet): today's focus sessions up to now, from the focus store.
  Each start, pause, reset and finish updates `localStorage` key `wall2-focus-day`
  (`{ sessions: [{ start, end }] }`, epoch ms). A running session is saved with its
  planned end, so one that ends while the app is closed is still right; pausing or
  resetting moves the end back. Each write keeps only today's sessions, and the ribbon
  only draws today's, so the bar clears at midnight.
- **Row 2**: its icon (bolt on Work and Meet, house on Home) and a cyan diamond with a
  short title and the time ("Send the proposal, 3:00") for each of the next three tasks
  due at a time today, at that hour. The tasks come from `wall2_tasks_summary`: Work and
  Meet pass `notTag: "home"`, Home passes `tag: "home"`. They are read when the ribbon
  shows and every 2 minutes while visible. All-day and undated tasks get no mark. Not set
  up or a failed read shows no marks. Agent segments come with the lanes, the house
  schedule with the rooms.
- **Needle**: a white pill with the time, moved on each whole minute while visible.
  Before 6 AM it stays at the left end and still shows the real time.
- **Dev**: the calendar comes from `src/bridge/devMocks/meet.ts`. A review still
  (`?hz=<place>&at=<ISO time>`, dev builds only) opens on that place, freezes the clock
  and ribbon at that time, puts the meet and task mocks' days on the review's date, and
  `src/ribbon/devMock.ts` adds the concept's two focus sessions if none are saved for
  that day.

## The Work tab

`wall/src/screens/Work.tsx` lays Work out on the concept's zones (`f_work`): left
wing 470, centre 1290, right wing 596 design pixels, 30 apart, over the whole top
band. The clock and date stay the frame's (`Frame.tsx`); the left wing starts under
the date line. One weather read (`useWeather`) feeds both the line after the date and
the centre card; the date line takes it through the frame's `ClockSlot` portal.

- **Left wing** (`wall/src/work/LeftWing.tsx`), top to bottom:
  - the weather after the date: icon, temperature and a short condition ("58°,
    clearing"), `WeatherLine` in `weather/WeatherCard.tsx`, empty until a reading and
    hidden while the reading is stale (the line has no room for its age);
  - **Next**: the first meeting that has not ended, from `wall2_meet_next`
    (`work/useNextMeeting.ts`: read on mount and every 5 minutes while visible, the
    time ticks every 30 seconds), written as "12:00, in 1 h 36 m", "now, 12 m
    left", "tomorrow 9:30" or "Friday 9:30" (`work/next.ts`; whole hours read "1 h"). Hidden
    when Meet is not set up, when the first read fails, and when there is no meeting.
    When the feed marks the list `stale` or a refresh fails, the last list stays,
    dimmed, with no countdown (only the time: "12:00", or "10:00 to 10:36" once it has
    started) and a quiet "as of H:MM" (the last complete read; "may be out of date" if
    there has been none);
  - **Focus** (`FocusMini` in `focus/FocusTimer.tsx`): a 60 pixel ring with the
    minutes left, the task label (or "Ready to focus"), and one round button: start,
    pause or resume. Tapping the ring while no session runs opens a sheet with 25, 50,
    Custom and "Start N min"; a session started elsewhere closes the sheet;
  - **Now playing** (`MusicMini` in `music/MusicBar.tsx`): art, title, artist and one
    play or pause button, from the same app-wide poll as the music bar;
  - **Machines** (`wall/src/machines/`, owner vote A, "whisper bars"): a header row
    (CPU, GPU, RAM) and two thin rows, PC and BOX with the box temperature, from
    `wall2_machines` every 2 seconds while visible (one read at a time, nothing while
    hidden; a read that takes over 5 seconds counts as failed, only the read holding the
    busy flag clears it, and the answer of a superseded read is dropped). Grey by
    default. A number turns amber only after it stays over its limit
    for 30 seconds (RAM over 90, CPU or GPU over 95, box temperature over 90 degrees);
    a dip back under starts the 30 seconds again, and a gap of more than 6 seconds
    between reads (hidden, slow) does too. Stale box numbers never count toward the
    hold. With no box numbers (null) the BOX row stays, dimmed, and says "no reading", so
    it is clear the row exists; it fills in when the helper answers. It is dimmed when
    `boxStale`. A column with no reading (often the box's GPU) shows a faint empty track
    and no number. Nothing shows when the command fails.
  - Round buttons in the wing draw at 52 pixels.
  - Next, Focus and Now playing stack from the top with even air (12 px, 22 px without
    Next); the machines sit on the band's foot. With no meeting to show the rows close up
    under the date and the machines grow (larger numbers and taller rows) into the room
    that leaves.
- **Centre** (`wall/src/agents/CentreSlot.tsx`, the one place that decides what it
  shows): the agent lanes while the helper answers (see "Agent lanes" under "Agents").
  Otherwise the full focus timer (640 px) and the weather card (now, today's range, the
  next six hours) fill it, so it is never an empty card. Each card starts right under its
  heading and fills its box: the focus ring takes the height between the heading and one
  row of 40 px controls at the foot (Start, Pause or Resume, Reset, and the 25, 50,
  Custom picker), the task's name wraps to two lines before an ellipsis, and the hour
  tiles stretch to the card's foot. When the helper cannot show, a quiet header row sits
  above the cards where the lanes' header goes: "Agents  not set up" when `feeds.json`
  has no helper address, or "Agents  not reachable" (amber) with a "Try again" link that
  reads once at once, when it has one but no answer has come yet. The zero-lane state
  shows the same cards, tighter. Before the first weather reading, or when the first
  fetch fails, the focus card takes the whole width with the weather status as one line
  inside it.
- **Fit check** (`wall/scripts/fit-check.mjs`, `npm --prefix wall run fit-check` with
  `WALL_CHROME` set to a Chromium or chrome-headless-shell binary): builds a development
  bundle, opens Work with the longest mock strings (`?long=1`) in a 2560 by 720 viewport
  and fails if a wing, the centre or anything checked inside it scrolls, sticks out of its
  container or the viewport on any side, or if the page itself scrolls. The centre is
  checked with three lanes with long titles, one lane, no lane, and the fill
  (`?agents=3`, `1`, `0`, `off`). `-- --overflow=left|right|top|bottom|page` breaks the
  layout on purpose and must fail; `-- --self-test` runs every such case and passes only
  if each one failed with the FAIL line for the side it broke. jsdom has no layout, so the unit tests cannot check this; CI does
  not run it either.
- **Right wing**: the next three tasks (see "Task card" below). The Big screen and Keys
  rows of the concept come with their own pull requests.

- **Focus timer** (`wall/src/focus/`). A ring with the minutes left in the
  middle (the full card in the centre, the small row in the left wing). Choose 25, 50 or custom (5 to 120 minutes, steps of 5). Start, pause,
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
- **Music** (`wall/src/music/`). One app-wide poll (`store.ts`) shared by Work's now
  playing row, the full music bar and the Unwind view: it polls `get_now_playing` every 2 seconds
  while visible (never while hidden); each call gives up after 5 seconds so a hung
  call cannot stall the loop, and a late answer is dropped. Art only from `album_art_base64` with an
  allowed mime (png, jpeg, webp, gif); `art_unchanged` keeps the current art. Each poll
  sends `artFor`, the `art_key` of the art it holds (empty when it holds none), and Rust
  skips the art only while that key matches the track, so a cover is never lost to a
  reload or a dropped answer; a track that came without art is asked again every 10
  seconds (players often add the cover late). A cover that arrived but was refused (a
  type outside the list, bad base64, or an image that fails to decode) is remembered by
  its `art_key` and never asked for again. Without `artFor` (the first wall) Rust
  keeps its shared last-sent key as before.
  Previous, play or pause, next call `media_previous`, `media_play_pause`,
  `media_next`; failures are swallowed. Stopped or unknown shows a quiet
  "Nothing playing".
- **Settings** (`wall/src/settings/`). `localStorage` key `wall2-settings`, JSON
  with optional `latitude` and `longitude` (defaults 47.68, -122.21). No settings
  screen yet.
- **Browser dev.** `npm run dev` registers mocks for the commands Work calls
  (`src/bridge/devMocks/`, dev server only); in a review still (`?hz=&at=`) the
  meeting and task mocks follow the review's time. Review knobs: `?meet=none` (no
  meetings), `?box=none` (no box numbers), `?net=alarms` (the network feed with only
  its alarm count). Weather needs network access to
  Open-Meteo.

## Audio, ripple and moon

- **Audio** (`wall/src/audio/`). At app start inside Tauri, `capture.ts` asks Rust for the
  default loopback device, starts capture and listens to the `audio-levels` event (never
  `window.__TAURI__`). `store.ts` keeps smoothed `bass`, `mid`, `high` (0 to 1) and
  `playing`, which is true while sound arrived in the last 0.35 seconds; levels fall away
  once it is not. Silence is decided by the clock, never by counting events. The push is
  turned off with `set_audio_push(false)` while the page is hidden and on again when it
  shows. If the first start fails it stays silent and retries once after 30 seconds; if no
  event arrives for 5 seconds while visible it restarts capture once (once per app run, by design).
  It also keeps the newest 32 `bands`, normalised 0 to 1 from the event's 0 to 255 bytes
  (`audioBands()`, a fixed array written in place), and feeds them to the beat detector on
  each frame's source time (`sourceTime.ts`). The event carries no capture time, and frames
  that queue behind a stalled web view arrive in a burst: a frame less than 16 ms after the
  previous one is stamped 33 ms after it; otherwise it takes its arrival time (or, while still
  ahead after a burst, the previous stamp plus the real interval, capped at 33 ms, so time never
  runs backwards); a frame more than 200 ms ahead of the clock is dropped. Silence is still
  judged on arrival times.
- **Band history** (`store.ts`, `bandHistory()`). The last 7 seconds of the spectrum at 30 rows
  a second (210 rows of 32 bands, one fixed ring written in place), each band smoothed with the
  levels' attack and release (0.06 s up, 0.35 s down), then calmed (for the history only; the
  levels and the beat detector never see it): a second, slower smoothing (0.12 s) and a direction
  hold, so once a band turns from rising to falling or back it may not turn again for 170 ms. That
  keeps the echo from changing the picture's brightness more than three times a second however
  fast the music pumps (`npm run echo-calm`, below). When the music stops the rows release to
  zero and writing stops once a whole ring of silence is in. `pauseBandHistory(true)` stops it
  (the horizon does this while the display is idle or off); resuming starts from an empty ring.
  A hidden page empties it too (`clearBandHistory`), so old spectrum never replays on return.
  `spectrum.ts` reads it: `sampleBands(u, age)` maps `u` (0 at the echo's centre, 1 at its
  edge) to band `u * 31`, bass in the centre, interpolating between bands and between rows
  `age` seconds back; a band adds height above 0.3 (about -52 dB, `BAND_FLOOR`) and the top is
  scaled to 1.3, the range of the renderer's made-up `spec()`.
- **Beats** (`beat.ts`, read with `audioBeats()`). The detector sums the power of bands 0 to 11
  (about 20 to 245 Hz) into one level in dB. An onset is a rising frame at least 9 dB above the
  median level of the last second; it counts as a beat only if the next two frames stay 4 dB
  above that median (a kick holds up while it decays, a noisy frame drops straight back). Beats
  are about 340 ms apart, with two frames of slack (274 ms: onsets sit on the 33 ms frame grid,
  and arrival times jitter, so a steady 170 BPM kick keeps every beat), and never more than three
  in any second (the calm limit): a beat that would be the fourth in a second is refused. Both
  rules hold on both clocks: onsets in source time, and the frame that confirms a beat on the
  arrival clock (source time can run up to 200 ms ahead after a stall, so rules kept in source
  time alone once gave four beats in a real second). Beats are timestamped at the onset, and the history starts afresh after a
  0.5 s gap in events. It exposes `count`, `lastBeatAt`, `lag` (onset to confirmation, about
  66 ms), `beats()` and `bass` (the mean of bands 0 to 5). Bands 0 to 5 alone are not enough: at
  48 kHz they all read the same 47 Hz FFT bin, which swings by 10 dB from frame to frame on
  noise. Tested on a port of the Rust band maths at 44.1 and 48 kHz: a 120 BPM synthetic kick gives a
  beat per kick 0.5 s apart (within 35 ms; the 9 dB margin may miss one kick under a noise
  bed); two fixed pink noise seeds per level give none. In longer simulated runs of pure pink
  noise (54 minutes per rate) it fired 0 times at 44.1 kHz and 3 times at 48 kHz, so expect a
  rare stray glow on noise-like audio.
- **Browser dev.** Silent by default. In a development build (`npm run dev`) add `?audio=demo`
  to the URL for gentle fake levels: 32 bands shaped like the concept demo's spectrum (a kick
  at 105 BPM in bands 0 to 11, three slow melody bumps in the middle bands, a hat on the
  off-beat), so the grid pulse and the Unwind echo show in a browser. With a review URL
  (`?hz=unwind&at=...&audio=demo`) the camera and sky stay frozen but the frame loop runs, so
  the echo and the pulse can be captured. A production bundle ignores the query.
- **Ripple** (`echo.ts`). The echo lines of the range, drawn by the renderer's `echo` option.
  - Work and Home (3 lines): only while `playing`, opacity `ea` times a smoothed loudness (bass
    weighted) and a fade of about a second, `n`, `amp`, `cx` from the camera (`en`, `eamp`,
    `ecx`), `hs` 900. Nothing is passed when silent, so pixels are unchanged.
  - Unwind (11 lines, the visualizer): while playing, opacity `ea` (0.9) raised to full, times the
    fade, with no loudness scaling, and the lines follow the real bands (`sample`, below). The
    playing look matches the concept: the lines are tinted bright teal through the centre shifting
    to pink at the far right (the renderer's `tint` option, blended over the palette's rim colour
    by the fade), 1.5 px wide instead of 1.4, and the newest line fades in at the front instead of
    popping in. Work, Home and the idle lines keep the palette's colour. While silent the
    idle lines: opacity `ea * 0.45`, height `eamp * 0.35`, drifting at 0.12 (0.4 of the playing
    speed) to the renderer's made-up `spec()` on the same slowed clock, so they breathe gently.
    The echo runs on its own clock (`echoRate`), so slowing it never makes the lines jump. Every
    number is blended between idle and playing by the fade, and by the camera's `en` during a
    glide (`visualizerWeight`: 0 at 3 lines, 1 from 8), so nothing pops.
  - `sample`: while the fade is above 0 (on any camera), `HorizonCanvas` hands the renderer a
    sampler (`createEchoSampler`): each line reads the band history at its own age (the 7
    seconds spread across the lines), mixed with `spec()` by `1 - fade` while starting or
    stopping. Without `sample` the renderer draws exactly as before (golden call log test).
  - Never on the morning Rainier camera. On a turn toward it the echo fades out within about half
    a second of the turn starting (the camera gate: its opacity only falls from the first frame of
    the turn and is exactly 0 by 0.6 s), and it stays off, through any turn back, until the camera
    has settled on a place whose echo is on; then it fades in over 0.6 s. Under reduced motion and in the review still, Unwind shows the idle
    lines frozen at `t` 0; other places none.
  - When the display is idle or off (`useIdle`: no input for 4 minutes, screens off, locked)
    the echo fades out over a second and is then not drawn, and the band history stops; both
    start afresh on return.
- **Echo calm check** (`npm run echo-calm`, by hand; CI does not run it). Builds
  `scripts/echo-calm/` (the real renderer, echo and audio store) into one HTML file and draws 600
  frames of the Unwind camera in headless Chromium with the echo and without it, for the
  `?audio=demo` levels and for every band pumping fully on and off 6 times a second. It takes what
  the echo adds to the picture's mean relative luminance over every pixel and fails if that moves
  by 1 percent of the picture's mean, up or down, more than three times in any second. Set
  `WALL_CHROME` to a Chromium binary.
- **Grid pulse** (`pulse.ts`). While `playing`, `HorizonCanvas` passes `grid` to the renderer.
  Each beat starts a soft glow band at the horizon that rolls across the lake grid to the bottom
  edge in 1.2 s (depth `p` 0 to 1 on the grid's own `pow(p, 2.1)` spacing, eased out over its
  life so it leaves the horizon briskly; drawn additively after the lake's fog, growing with
  depth), fading in over its first 12 percent and out over its last 30; it starts already as
  old as the detector's lag, so it lines up with the kick. Peak opacity 0.42 at full strength. The grid lines
  brighten from 0.3 up to 0.55 opacity with `0.65 * kick + 0.35 * bass`, where the kick part
  eases up to 1 over 80 ms on a beat (never a jump) and falls away over about 0.3 s, and the
  bass part is smoothed over about 0.6 s so frame-to-frame jitter never flickers the lines.
  With never more than three beats in a second the lines rise at most three times a second. Both scale by the camera's `gp`: 0.5 on Work, Home and the
  morning Rainier view (subtle, and seen through the ribbon's glass), 1 on Unwind. Four fixed
  band slots, reused every frame. No grid when silent, under reduced motion or in the review
  still; without `grid` the renderer makes exactly the canvas calls it made before (a golden
  call log test).
- **Moon.** The Unwind camera draws the moon at (1730, 112) radius 44, once the glide to
  Unwind has finished (it goes as soon as a glide away starts); no other place does. The
  review still `?hz=unwind` draws it, since that camera jumps straight there.

## Unwind and Watt

`wall/src/screens/Unwind.tsx` lays the place out as the concept's `f_unwind`: the tall
frame (no ribbon) in the wide zones `470px 1fr 540px`. The parts are in `wall/src/unwind/`.

- **Left wing.** The frame's clock, then "Wednesday night, 49° and clear" (`DateLine.tsx`:
  the day part, morning, afternoon, evening or night, with the reading from the weather
  hook; before 5 AM the night still belongs to the day before; without a reading under an
  hour old the weather part is left out). At the bottom, Tomorrow (`Tomorrow.tsx`): "First
  thing: AE sync at 9:00", the first event on the calendar day feed (`wall2_meet_day`)
  tomorrow by local calendar date (between midnight and 5 AM, the day that has just
  begun, from now), or nothing when there is none or Meet is not set up. After a failed
  refresh it adds "as of 9:40 PM" (the last good read) and hides once that read is more
  than 30 minutes old. Under it the status line (`StatusLine.tsx`, "Work is put away. 2
  agents still running. Nothing needs you.", from the focus timer once it has loaded and
  the helper summary `wall2_omni_summary` every minute while visible; the agent and
  needs-you sentences are left out without the helper or when it reports stale data).
  The parts that carry an action are chips with a tooltip: "N agents still running" is a
  quiet chip that switches to Work, and "N things need you" (or "One thing needs you") an
  amber chip that opens the first waiting chat with `wall2_open_session` (the summary's
  first your-move session, else the first lane that waits; plain text when links are not
  available). "Work is put away.", "Focus is still on." and "Nothing needs you." stay
  plain text. Screens off is an icon alone (36 px, quiet until hovered) in the lower right
  corner of Unwind, its words as the tooltip and accessible name ("Screens off", "Turning
  off", "Cancel screens off"); "Could not watch input" shows beside it for five seconds.
  The wind down ring (PR 10) goes between the date line and Tomorrow.
- **Centre.** The tabs (`Tabs.tsx`): Listen is this view (its tab controls the player
  panel); Watch is disabled (not focusable) with "Coming" and opens nothing; Dream opens Zen straight into Dream (`openDream` in the place store;
  Zen reads the flag once). Below them the player (`Player.tsx`): 224 px art, the source
  app in pink capitals (the player's name, see below), a 64 px title, the artist, a 520 px progress bar with times
  (advanced locally twice a second between polls while playing and visible, never past
  the duration), then previous, play or pause and next with the playing app's volume
  (`Volume.tsx`). `get_now_playing` sends the media session's own app id as
  `source_app_id` (a Windows AppUserModelId such as
  `SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify`, or a process name such as
  `Spotify.exe`). `music/players.ts` maps known players from that id to a display name
  ("Spotify", "Edge", "Chrome", "Firefox", "Apple Music", "Media Player" and others) and
  to the process names of their audio sessions. A packaged id is a known player only when
  its package family name is one of that player's exact family names (the store Spotify
  is `SpotifyAB.SpotifyMusic`); a process id only when its file name, lower-cased with
  `.exe` dropped and nothing else stripped, is one of its process names. An unknown player
  shows its own cleaned app name (the package name when the id ends in the bare word
  `App`; never "App", and never a name that reads as a known player's, so
  `Evil.Spotify_x!App` shows "Evil.Spotify") and never gets a known player's process: a
  process id gets only the session with exactly its own file name, a packaged one none.
  The slider shows only when `get_audio_sessions` has such a session; otherwise the row
  closes up. `Music.UI.exe` is Groove Music's own executable, so that process id names
  Groove; the ZuneMusic package names Media Player. A remembered cover on the idle view
  that fails to decode falls back to the placeholder tile. The session
  is tied to the source it was found for, so after a source change the slider hides until
  the new app's session is read and a move never reaches the previous app. Moves are
  clamped to 0 to 1 and sent with `set_audio_session_volume` at most every 100 ms, always
  ending on the last value (also on unmount); a move pending when the session goes away is
  dropped. The player sits in a `.u-listen` row so a music browser can join it
  later.
- **Nothing playing.** The player keeps its footprint: the last track this wall saw
  playing (`lastPlayed.ts` follows the shared now playing store; title, artist and source
  are kept in `wall2-last-played`, the art in memory only) with "Play again" when a media
  session exists, or "Open Spotify to play again" as plain text when none does, or before
  anything has played, "Nothing playing" with a calm line over the transport. Never a
  large empty tile.
- **Right wing.** The Room card (`RoomCard.tsx`), at the concept's size and place: 120 px
  tall, its foot 38 px above the end of the other places' 490 px band, so its top is 332
  px down and its foot sits level with the transport (`UNWIND_ROOM_*` in
  `screens/frameLayout.ts`, passed to the stylesheet as `--room-top`), "Room"
  over a row of 40 px mood chips. The home moods come from `wall2_moods`; a click applies
  one with `wall2_apply_mood`, and the last mood applied (here or on Home's mood cards) is
  marked for three hours (the id is `wall2-last-mood`, shared with Home in its plain
  format; the time is beside it in `wall2-last-mood-at` as `{"id","at"}`, written by
  both). While loading or not reachable it reads the moods again every 30 seconds. "TV
  off" waits for the home app reads (PR 24). Not set up or not reachable says so in one
  line at the same size. The Live now card (PR 27) will stack above it, in the space above
  it now.

Watt (`wall/src/buddy/`) is the electric sheep on the horizon band of every place that has
one: Work, Home, Meet (hidden during a call, once the in-call pull request detects one) and
Unwind. Not on Zen (Dream draws its own sleeping Watt). `App.tsx` mounts it once, over the
horizon canvas and the veil and under the panels; its styles are `buddy/watt.css`.

- Walk table (`WALKS` in `buddy/model.ts`, left edge range and sprite pixel size): Work and
  Meet 880 to 1090 at 4 px, Home 1506 to 1726 at 5 px, Unwind 430 to 470 at 6 px (the body
  between about x 430 and 580, the concept's spot in `f_unwind`, below the wind down block and
  left of the transport row). The feet stand on the camera's `hy` (582 on Work, Home and Meet,
  505 on Unwind). `model.test.ts` builds the rail, zone and ribbon rectangles from
  `screens/frameLayout.ts` (plus Unwind's transport row, `UNWIND_ROW`) and checks that no range
  (every pose, notes and z's included) reaches one at 2560 by 720.
- Pace: it stands 20 to 40 seconds at each stop, then walks slowly (14 px a second) to the
  next; it starts standing in the middle of the range.
- It is up only while the horizon's camera is settled on its place. `horizon/signal.ts` is a
  small read-only signal the horizon publishes (the camera it is on or heading to, and whether
  it is moving); Watt hides whenever the camera moves or points somewhere other than the camera
  Watt expects for its place and hour. So a place change, a quick reversal, the 5:00 AM
  cinematic turn to Rainier and the 11:30 AM swing back all fade it out where it stands, and it
  fades in at the new spot once the camera has settled. It never walks across the screen.
- It sleeps in the middle of its range with drifting z's between 9:30 PM and 6:30 AM local
  time (fading out and back in at both changes), and shows little notes beside its head while
  music plays (awake only). Night and Home's camera are worked out once a minute. The frame
  loop reuses its records, pauses while hidden, and does not run on Zen or in a call. Under
  reduced motion (and in a dev review still) it is a still pose in the middle of the range
  with nothing drifting, and it jumps on a place change. The pixel maps in `sprites.ts` are
  the concept's own.

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
- `omniHelperUrl` is optional and `https` only; see "Agents".
- A missing file or key shows "Not set up" on that card, quietly. A malformed
  address shows the card as unavailable.
- `homeSecurityUrl` is optional: the full address of the home app's Security page,
  for example `"homeSecurityUrl": "https://example.invalid/app/#/security"`. It must
  be `https`, may have any path, query or fragment, and may not carry a user name.
  Missing or invalid means the Security button stays hidden.

### Task card (Work tab, top right)

The right wing of Work, as the concept's rows (`.tk3`), 72 pixels tall.

`wall/src/tasks/`. Work reads `wall2_tasks_summary({ notTag: "home" })`: the next three
open tasks without the home tag, and how many more are open. Each row: a check circle,
the title, and the estimate chip ("15 m", "45 m", "60+ m", none without an estimate).
The header says "N more can wait" when there are more. Refreshes every 2 minutes while
visible and after each completion. (`useTasks()` with no filter still reads
`wall2_tasks_next`; Zen uses that.)

- **Check**: the row is struck through at once and fades out after 2 seconds;
  `wall2_task_done` sends `PATCH /api/tasks/{id}` with `{"status":"done"}`. If that
  fails the row comes back with a small "Could not save".
- **Open**: a click on a task's title opens it in the task app. `wall2_open_task(id)`
  accepts only an id that one of the last good task reads showed (Work's list, Home's
  chores and the plain next three are kept apart, so one never replaces another), builds
  the address from `tasksBaseUrl`, and opens it with the system's default handler as
  `wall2_open_link` does. The task app has no page for a single task (only the JSON
  `/api/tasks/{id}`), so the address is the app's own page, `tasksBaseUrl` with a
  trailing slash; `task_link` in `wall2_feeds.rs` is the one place to change when it
  gets one. Any other id is refused and nothing happens on the wall.
- **Focus**: hold a row for half a second to start the focus timer with the length
  chosen on the focus card (25 minutes unless changed), named after the task; that
  press opens nothing. A cancelled press or a finger that moves more than 12 pixels
  does neither; with a keyboard, Enter starts focus. Ignored while a session is running
  or paused (a click still opens the task).
- A summary answer without a `next` list counts as a failed read. The label is saved with the session and
  cleared on reset and when the session finishes.
- **States**: "Not set up" (no address), "Nothing due" (empty list), "Tasks
  unavailable" (first read failed), and after a failed refresh the last good list
  with a small "updated N min ago".
- **Estimate and summary**: each task
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

`wall/src/home/`. Reads `GET /api/security?lite=1` and shows, as the concept draws it:
the heading "Network and security" above the card (like "Around the house"), then a
shield and status line ("All quiet" when nothing is open) with the scan age on its right,
the numbers the feed has spread evenly (devices, alarms in 24 hours, blocked, box
temperature; today the home app sends only the alarms, and PR 24 adds the rest), up to
three open alerts as one-line rows (severity dot, text, age) with "N more open" beside
the heading, and the two links as full-width buttons along the bottom. The numbers row
shows only when at least three numbers exist; one or two go on the status line's right
instead ("Up, box online" and "7 alarms in 24 h"), and the scan age then moves beside
the heading when "N more open" is not there. The card is as
tall as what it holds, so it is never half empty. Refreshes every 5 minutes while
visible. The open count follows the home app's own page: an alert whose
reviewed request is waiting is hidden; a done request hides it until a newer
summary arrives; a failed request hides nothing.

The alert rows come from Rust (`top_alerts` in `wall2_feeds.rs`): the visible alerts,
newest first, reading the text from `title`, `message`, `text`, `summary`, `reason` or
`type` (a type slug is turned into words: `abnormal_upload` reads "Abnormal upload"),
the severity from `severity`, `level` or `priority` (mapped to high, medium or
low; amber dot only for high), and the time from an ISO string or epoch seconds or
milliseconds in `ts`, `at`, `time`, `createdAt`, `detectedAt`, `firstSeen` or
`lastSeen`. Text is cleaned of control characters and capped at 120 characters. When
the alerts carry no readable text, the card shows "N open alerts" instead.

- **Green**: "All quiet", or "Up, box online" while alerts are open.
- **Amber**: the scan is stale, the firewall API state is unknown, or the home app
  cannot be reached (a quiet amber line inside the card, never a screen-wide message;
  after a good read the last numbers and rows stay, dimmed).
- **Red**: only when the firewall API is down or the box is offline.
- "Not set up" when there is no address.

Two buttons share the bottom of the card, each half its width and 52 design pixels
tall (see "Pointer and touch" below), shown only when available. **Security** opens `homeSecurityUrl` from `feeds.json`.
**Firewalla** opens the `portalUrl` from the most recent good security read, and
only when it is `https` on `firewalla.net` or a subdomain. Both open in the default
browser, and Rust does the opening (`wall2_open_link`, kinds `security` and
`portal`); the web view only names the kind and never supplies a URL, and
`capabilities/wall2.json` grants no opener permission. `wall2_links` tells the tile
which buttons to show. A failed open shows "Could not open" for 3 seconds.

Browser dev (`npm run dev`) shows both cards from mocks in `bridge/devMocks/`; the Home
mock also carries the numbers PR 24 will add, so the dev view shows the full card.

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

`wall2_meet_day` returns today's and tomorrow's events for the day ribbon and Unwind's
Tomorrow: from local midnight to the local midnight that ends tomorrow (found by local
date, so a 23 or 25 hour day on a clock change is right), past events included, up to 40
merged across both accounts, earliest first. The ribbon draws only today's. Each event has `key`, `accountId`, `title`, `start`, `end`, `canJoin` and
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

An unavailable account (and a "Sign in needed" account whose sign-in was refused) shows a quiet second line with a plain reading and a short code in brackets, for example "Calendar refused the request (graph-403-ErrorAccessDenied)". An unavailable row says what is wrong in plain words ("Network problem" or "Microsoft is not answering"), is one plain sentence (with "trying again at 3:42 PM" only while a retry is really scheduled), has one button, Try again (reads at once), and shows the time of the last try with the code underneath. When no account can be read, Meet shows no separate empty card: the Accounts card carries "Calendar not available" and the time of the last good read. A code has one of these fixed shapes and nothing else:

| Code | Meaning | Shown as |
| --- | --- | --- |
| `graph-<status>` | Graph answered with that HTTP status and a JSON body with no usable error code | 403 "Calendar refused the request", 400 "Calendar did not understand the request", 429 and 5xx "Microsoft is busy", 401 "Calendar did not accept the sign-in", other "Calendar could not be read" |
| `graph-<status>-<code>` | The same, plus Graph's `error.code` when it matches `^[A-Za-z][A-Za-z0-9_]{0,39}$` | the same words as its status |
| `graph-network` | Transport error (no connection, refused, a read that timed out) | "No connection to Microsoft" |
| `graph-timeout` | The read's 12 second budget ran out before Graph could be asked or asked again | "Microsoft did not answer in time" |
| `graph-body` | A reply that could not be read: a 2xx body too large or not JSON, or an error body over 16 KB, not JSON or cut short | "Calendar sent a reply that could not be read" |
| `token-<status>` | HTTP status of the token endpoint, on a refresh or on the first redemption after the browser callback | "Sign-in was not accepted" |
| `token-<status>-<n>` | The same, plus the first number of `error_codes` (digits only, at most seven), for example `token-400-9002327` | "Sign-in was not accepted" |
| `token-network` | The token endpoint could not be reached (the log line says `host=login` and the class) | "No connection to Microsoft" |
| `store-write` | Credential Manager refused to save the sign-in | "Could not save the sign-in on this PC" |
| `store-read` | Credential Manager could not be read (anything but "not found"); nothing is deleted or overwritten | "Could not save the sign-in on this PC" |

An error body is read up to 16 KB (one more byte is read to tell that it was too big), and only to find `error.code` or `error_codes`. A code that fails the check is dropped and only the status stays. A failed first redemption (the browser said "Signed in" but the token step failed) shows the same kind of code in the notice under Accounts.

### Reading Meet: limits, retries, parallel accounts

- **Timeouts.** Every token and Graph request connects within 2 seconds per address (the client tries a host's addresses one after another, each with the whole connect timeout, so a dead IPv6 route used to eat 5 seconds before IPv4 was tried), waits at most 10 seconds for a read and stops at 12 seconds in all. One read has one absolute 12 second deadline that covers everything in it: the wait for the account's turn, the token request (its timeout is what remains), each Graph attempt, the retry waits and the refresh after a 401. A read that reaches the deadline while waiting for its turn answers `graph-timeout` and starts no token request. Only one read per account runs at a time; a second one for the same account waits for the first or gives up at its own deadline.
- **Retries.** A Graph 429, 503 or 504 is tried again, up to twice more (three attempts), after 0.5 s then 1 s, or after the `Retry-After` header (whole seconds or an HTTP date, never negative, at most 5 seconds), and only when the wait still fits in the budget. Nothing else is retried: not a 500, 502, 4xx, a network failure or a reply that cannot be read. A 401 refreshes the token once and asks once more, as before.
- **Accounts do not wait for each other.** The accounts are read at the same time. The Meet screen asks `wall2_meet_next` three ways: `{ peek: true }` (no network: the accounts and their last known state, "checking" before the first read), then `{ only: "<id>" }` once per account, in parallel; each answer is shown the moment it arrives, and an answer with a lower `seq` than one already shown is dropped. With no arguments (the Work Next block) every account is read in parallel and the newest answer is returned. `wall2_meet_day` reads its accounts in parallel the same way.
- **The screen's limit.** Meet leaves "Loading meetings" as soon as the peek answers, and an account that has not answered within 12 seconds shows "Microsoft is not answering" with Try again and the time of the try.
- **Quiet lines.** When no account can be read (all signed out, needing sign in or not answering) the Work Next block and the day ribbon's calendar row say "Calendar not available" instead of showing nothing, and Meet says it in its main card.

### The calendarView request

One request per account per read, `GET https://graph.microsoft.com/v1.0/me/calendarView` with these query options and no others:

| Option | Value |
| --- | --- |
| `startDateTime` | UTC with a `Z`, for example `2026-11-12T17:00:00Z` (URL encoded) |
| `endDateTime` | UTC with a `Z`: 24 hours later for the next-meetings read; the end of tomorrow for the day read (at most 49 hours) |
| `$select` | `subject,start,end,isAllDay,isCancelled,responseStatus,onlineMeeting,onlineMeetingUrl,iCalUId` |
| `$orderby` | `start/dateTime` |
| `$top` | `50` |

Headers: `Authorization: Bearer <token>`, `Prefer: outlook.timezone="UTC"`, `Accept: application/json`, `client-request-id: <a fresh GUID per attempt>` and `return-client-request-id: true`. There is no `$filter`, no `$skip`, no `$expand`, and cancelled, declined and all-day events are dropped in Rust. A unit test pins the exact URL and the option names.

### The Meet log: `wall2-meet.log`

Wall 2 writes `wall2-meet.log` in the app log directory (Tauri's `app_log_dir`, `%LOCALAPPDATA%\com.havens-consulting.widget-wall2\logs\`, the same folder as `wall2-placement.log`). It is cleared at every launch and capped at 64 KB, and a write failure is ignored. A line is written each time an account's state or reason changes, and also for every failed Graph call (so a repeat failure can be traced):

```
2026-11-12T17:00:00Z hc start ok none
2026-11-12T17:05:00Z hc ok unavailable graph-403-ErrorAccessDenied req=next host=graph status=403 net=none af=unknown code=ErrorAccessDenied inner=none request-id=<guid> client-request-id=<guid> attempt=1 ms=412
```

The first five fields are the UTC time, the account `id` from `meet.json`, the old state, the new state and the reason code (`none` when there is none). A Graph failure adds, in this order: `req` (`next` or `day`), `host` (`graph`, or `login` for the token request), `status` (the HTTP status, or `network` when no reply came), `net` (for a network failure its class: `dns`, `connect`, `timeout`, `reset` or `other`, taken from the error kinds and never from error text; `none` otherwise), `af` (the address family tried; always `unknown` today, the client does not say), `code` and `inner` (Graph's error code and inner error code, `none` when absent or not a plain name), `request-id` and `client-request-id` (Graph's response headers, `none` when absent or not a plain id), `attempt` (which try, 1 to 3) and `ms` (milliseconds since the read began). A line is cut at 400 characters. The states are `start`, `ok`, `signed-out`, `needs-sign-in`, `unavailable`, `signed-in` and `sign-in-failed`.

### What is never logged

The Meet module has no `println!`, `eprintln!` or `dbg!`, and the only file it writes is `wall2-meet.log` above. Tokens, codes, `state`, the verifier, query strings, URLs, email addresses, names, meeting subjects and HTTP bodies never reach a log (a failed Graph call adds only the status, Graph's error code names, the two request ids, the attempt number and the elapsed time, each checked against a plain character set), a reason code or an error text. Every failure maps to a fixed string (`not-configured`, `invalid-config`, `busy`, `cancelled`, `timed-out`, `denied`, `failed`, `gone`, `forbidden`) or to one of the reason codes above, which are built only from numbers and a checked `error.code`.

## Agents

Wall 2 reads a small helper service on the home box (the agent lanes helper) through Rust, like the other feeds: `src-tauri/src/wall2_omni.rs`. The web view never sees the helper's address and never supplies a URL.

### Setting it up

Add one optional key to `feeds.json` (see "Setting it up: `feeds.json`"):

```json
{ "omniHelperUrl": "https://example.invalid:8790", "omniLinkHost": "example.invalid" }
```

- `omniHelperUrl` must be `https`, a scheme, host and optional port only. A path, query, fragment or user name is refused, as for `tasksBaseUrl`.
- A missing key means "not set up", not an error: the commands answer `not-configured` and `wall2_machines` returns no box numbers.
- A bad address answers `invalid-config`.
- `omniLinkHost` is optional: the bare hostname the session deep links use (1 to 253 characters, dot separated labels of letters, digits and hyphens; no scheme, port, path or user name). Missing means session links are unavailable: `wall2_open_session` answers `not-configured` and the summary carries `linksAvailable: false` so the UI can hide the tap. An invalid value answers `invalid-config`.

### Commands

- `wall2_omni_summary` reads `GET /wall/v1/summary` and returns the typed summary: slots, up to three lanes, parked count, your move, Claude usage, the day's spans and the box `system` block. Titles and lines are capped at 80 characters, ids must match `^[a-f0-9-]{8,64}$` (a lane with any other id is dropped), the answer is read through a 64 KB cap and fails as soon as it is over, whole-number counts only (slot numbers kept as sent, so "5 of 4 slots" shows as it is, up to 99; elapsed time capped at 7 days, PR numbers positive), `usage.claude5hPct` may be null (the weekly figure still shows); every timestamp must be RFC 3339 with `Z` or an offset and at most 40 characters: a bad `now` fails the answer, a bad `since` or `weekResetsAt` becomes null, and a day span with a bad start or end, or an end before its start, is dropped, bidirectional and zero-width characters are dropped from text, and picture `options` are never passed on. A malformed or oversized answer, or any network failure, answers `failed`.
- `wall2_open_session(id)` accepts only an id that matches the same pattern and appeared in the most recent successful summary, builds `omnigent://<omniLinkHost>/c/<id>` in Rust and opens it. Any other id is refused.
- `wall2_machines` returns `{ pc: { cpuPct, gpuPct, ramPct }, box: { cpuPct, gpuPct, ramPct, tempC } | null, boxStale }`. The PC numbers come from the same function as the old `get_system_stats` (which is unchanged). The PC numbers are returned at once on every call. The box numbers come from the helper summary's `system` block, refreshed in the background (one read at a time, at most one every 15 seconds, 3 second timeout), so a slow helper never delays the PC numbers and the first call after start shows `box: null`. After a failed read the last good box numbers stay with `boxStale: true` for up to 10 minutes, then `box` is `null`. `box` is also `null` when the helper is not set up. The numbers are kept per `omniHelperUrl`, so a changed address never shows the old host's numbers.
- All three refuse any window but `wall2` (`forbidden`).

Nothing here logs, and nothing here takes a wake lock or sets an execution state. Browser dev (`npm run dev`) shows mock answers from `devMocks/omni.ts`; `?agents=3` (default), `2`, `1`, `0`, `ask`, `stale`, `off` (not set up) or `down` (not answering) picks the helper's state.

### Agent lanes (Work centre)

`wall/src/agents/`, as in the concept's `f_work`:

- **Data** (`useAgents.ts`): one poll of `wall2_omni_summary` shared by everything that reads it, on mount and every 15 seconds while the page is visible and at least one reader is mounted. Nothing while hidden. One read at a time; a read over 10 seconds counts as failed, and a lane or day span with a missing or wrongly typed field is dropped. `not-configured` or `invalid-config` is "not set up". A failed read keeps the last answer, marked stale, for up to 30 minutes; with no earlier answer, or when the helper's own `now` has not moved for 30 minutes of this PC's time (a frozen helper), it is "not reachable". The two machines' clocks are never compared: the first answer is always accepted, and the skew (the helper's `now` minus this PC's time when the answer arrived) is taken off every helper time before the ribbon draws it. When the page comes back after more than 15 seconds away, the kept answer is stale until the first new read returns.
- **Stale is never live**: while the answer is stale the lanes dim with "updated N min ago", the ribbon's agent row dims and its open runs end at the last good answer's time, `useAgentStatusLine()` returns null and `useAgentsWaiting()` returns false.
- **Header**: "Agents", the real slot numbers ("3 of 3 slots", "5 of 4 slots"), and on the right "Nothing needs you" with a cyan dot, or "One thing for you" with an amber dot and "then N more" when more wait. The count is the larger of the helper's your-move total and the lanes that are blocked or waiting. A stale answer adds "updated N min ago" (from the last fresh answer; "may be out of date" if there was none) and dims the lanes.
- **Lanes** (`Lane.tsx`, `StageTrack.tsx`, `LaneRing.tsx`): up to three. Ring by stage (bolt while moving, "?" in amber while it waits, a mint check when ready or live), title and line on one line each with an ellipsis, plain text only, then Plan, Build, Review, PR, Live with the current stage glowing (amber while waiting, mint when ready), and the elapsed time. A lane waiting for an answer has an amber edge. With fewer than three lanes the lanes grow (to 150 px) and add a third line with the PR ("PR 553, checks running, draft").
- **Tap**: a tap anywhere on a lane calls `wall2_open_session(id)` (Rust checks the id). When the summary says `linksAvailable: false` the lanes are not buttons.
- **Hold to merge**: drawn on a lane whose PR is ready with checks passing (or none). Until the merge path lands (PR 30), a hold of 600 ms opens the chat; a short tap does nothing but show "Hold" for a moment. A move of more than 12 px, leaving the button or a pointer cancel ends the hold with no hint. Enter or Space on the button opens the chat. The button's events never reach the lane.
- **Free slots**: with fewer than three lanes, slim quiet "Free slot" rows (58 px). With no lane at all, one slim "All three slots free" row and the focus timer with the weather, a little smaller.
- **Shelf** (`Shelf.tsx`): "N parked, resting" (or "Nothing parked"), the Claude five hour figure when the helper has one, and "Claude this week" with a bar. The mail count waits for the mail scope (D7).
- **Ribbon** (`ribbon/AgentRow.tsx`, Work only): the helper's day log on three thin rows under the calendar chips: running cyan, waiting amber, a finished run grey, done grey with a mint cap, up to now.
- **Hooks for other places**: `useAgentStatusLine()` gives one line ("Two agents still working, nothing needs you") or null when not set up, for Unwind and Dream; `useAgentsWaiting()` is true while something waits, for the amber dot over Watt. Both share the same poll.

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

## Pointer and touch

The owner drives the strip with a mouse. The app root still sets `touch-action:
manipulation`, controls do not select text or flash a tap highlight, and rail buttons
show a pressed state on `:active`. Hover is a nicety (a cyan title on a task row, a
tooltip on the ribbon's row icons); nothing depends on it. The rail buttons stay 72 by
72. Inside cards the older touch sizes (72 px, and 52 by 44) no longer apply: controls
are sized for a mouse, about 32 to 40 px tall (Meet's buttons are 40 and its Join rows 36; the centre fill's buttons, chips and
stepper are 40, the Room card's mood chips 40, "Try again" 36). The Home chore ticks keep
their 52 by 44 rows with no shared hit area between rows.

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
