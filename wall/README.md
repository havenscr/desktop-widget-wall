# Wall 2

Wall 2 is the next front end for Widget Wall. It lives beside the existing app
(`src/`, untouched) and is built with Vite, React and TypeScript (strict). It
runs in a plain browser for development and inside Tauri as a second app,
"Widget Wall 2". So far: a scaled stage, the live horizon, a left rail with
three places, a clock, the Work tab basics (weather, music, focus timer), a task
card, a network tile and mood buttons on Home, the Unwind tab with Watt the sheep, a sound ripple
on the horizon, the Zen place with Dream, a small Tauri bridge and tests. Home has its moods, Sonos controls and a network tile; the Rooms row is still to come.

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
`styles/home.css`): the sun block under the clock in the left wing; in the centre the
concept's smaller mood cards in one row, the Rooms row's place and the Sound block (see
"Sound on Home"); Around the house with the network card in the right wing. The Rooms
row (`home/Rooms.tsx`) and the House line render nothing until the home app reads them
(PRs 24 and 25): no placeholder card.

- **Sun block** (`home/LeftWing.tsx`, `home/sunLine.ts`): from the horizon's own sun
  (`ribbon/sun.ts`), to the nearest minute. "Sunset in N min" in amber within 90
  minutes before sunset; earlier, the sunset time and the daylight left; before
  sunrise, the sunrise time; after sunset, tomorrow's sunrise.
- **Columns** are fixed (`.home-wing` 1, `.home-centre` 2, `.home-right` 3), so a zone
  that renders nothing never shifts the others.
- **Mood cards** (`home/Moods.tsx`, `home/MoodArt.tsx`): one card per mood the home
  app defines, in its order (today Day, Evening and Late Night). Each card has painted
  art drawn as one SVG (Day a sun, Evening a striped sunset, Late Night a moon and
  stars; Movie and Goodnight are drawn too for when they exist, and any other mood gets
  a lamp glow) and the concept's line under the name where it has one. Nothing fakes a
  mood the home app lacks. The last mood tapped carries an "On now" tag and a cyan ring.
  The cards are 150 px tall in one row; up to six share its width, and with more than
  six each keeps a sixth and the row scrolls sideways (the mouse wheel scrolls it), so
  the Sound block keeps its room. When the home app sends a schedule (`nextAtMs` on a
  mood; it does not yet), a mood due within the hour says "In N min". With Sonos not
  set up, not reachable or loading the cards grow to 300 px into the room it leaves.

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

### Sound on Home

`home/Sound.tsx`, `home/useSonos.ts`, `home/soundModel.ts`, `src-tauri/src/wall2_sonos.rs`.
The owner's Sonos service on the home box, read every 30 seconds while the wall is
visible. Nothing on the wall plays or changes volume without a click, and one deliberate
click is one write: the second click of a double click and the repeats of a held key are
ignored, and each control stays latched for 800 ms after its write settles.

- **Quick play**: one button per music routine the service lists, the first six in the
  service's order on the face, five when the names are long (a trailing "Music" is
  dropped from the label; names take up to two lines; the favourite it plays is the line
  under a one-line name; the tooltip has the full name, favourite and volume). The rest,
  and the group all / ungroup all controls, sit under **More**. The service has no way to
  play a favourite directly, so More lists routines only. The routine that fits the hour
  is tagged "Suggested" (from words in its name: morning 5 to 9 AM, a work routine on
  weekdays to 5 PM, a day one, evening to 9 PM, night after).
- **Unforced plays**: a click triggers the routine without `force`, so its own skip
  conditions apply. Only a JSON `skipped: true` answer is a skip (a list of left-alone
  speakers means the routine ran); the service gives no reason, so a skip says "Skipped:
  this routine's own conditions say not now" beside the heading with a **Play anyway** button (tooltip "ignores this routine's own
  conditions") that sends the forced call; it stays on offer for a minute.
- **Started**: the service does not say which routine is playing, so "On now" is never
  claimed. The routine last started from this wall says "started N min ago" only while
  what plays is evidently what it started: the first read with music records its group;
  nothing playing, "Sonos off", another group, or no group to tell by clears it for
  good; it never lasts past an hour (`wall2-sonos-last-play` in local storage).
- **Where**: the service's group presets as a switch, the one whose name starts with
  "Office" first; the one in use shows its full name and the others shrink. The preset
  whose grouping matches the speakers' groups now is marked (Rust compares them).
- **Volume**: one slider for the current group (the group with the most speakers
  playing music; a speaker on line-in carries the PC's sound and is left out). It moves
  each speaker by the same step from its own level (clamped); a speaker with no level
  reading is left out, the label and tooltip count only the ones that move, and the
  result says "3 of 4 speakers changed". It sends one change when
  the pointer lets go or the arrow keys settle (400 ms). It holds the pointer while
  dragging, so a release outside the window still finishes it; a cancelled pointer, a
  window blur or the slider turning off mid-drag puts it back. **Speakers** opens every
  speaker with its state and its own slider; a speaker on line-in says "PC audio" and
  offers "PC volume" (the Windows volume control) instead of a Sonos slider.
- **Asks first** in a bar over the card, naming what it would do: any volume above 40
  (whatever the last read said the speaker was at); a routine above 40 or at a volume it
  does not name; a preset or group all that would leave a speaker above 40 or at an
  unknown level ("Studio is at 100. Group anyway?"), unless the preset itself sets that
  speaker to 40 or less (a line-in group, the PC's own sound, does not count).
- **Play and pause**: "Sonos off" pauses every speaker while music plays; with nothing
  playing the button names the suggestion ("Play Dusk") and is off when no routine fits
  the hour. The service has no next or resume command, so there is no Next button.
  **Sleep** offers 30, 60 or 90 minutes (5 minute fade); the soonest running timer shows
  its minutes left and cancels on a click.
- Every action shows a brief result beside the heading ("Playing Dusk", "Could not
  reach Sonos", "Some speakers did not change", which reads again at once). A read that
  failed, or one over two minutes old, dims the card, says "Sonos not reachable, showing
  3 min ago" and turns every control off. Never reached shows one compact card; no
  `sonosBaseUrl` shows one line saying what to add. With the moods out as well, the
  centre shows one status card instead (`home/CentreStatus.tsx`, `home/centreSources.ts`):
  each source and its state in plain words, the age of its last good read, the key to
  add when not set up, and **Check again** for both.

Rust (`wall2_sonos`, every command answers the `wall2` window only): reads `GET
/api/status`, `/api/speakers` and `/api/routines` (all needed), `/api/groups`,
`/api/group-presets`, `/api/scenes` and `/api/sleep-timers` (each may fail alone), side by
side, with a 4 second timeout, no redirects and a 1 MB cap per answer. An answer with
more than 500 entries in a map or list is refused as malformed, and collecting stops at
each cap. The summary is bounded (24 speakers, 24 groups, 12 presets, 48 routines, 12
scenes, 6 timers, the soonest first, one that ended over a minute ago gone; an end time
may be an ISO time, a number or a number in a string), names are cleaned to one line of
at most 60 characters, a speaker whose name would not survive the round trip is left
out, and only enabled music routines and the pause, group and ungroup controls are kept
(TV volume profiles set volumes of their own and are left out; a music routine carrying
any other volume key has no known volume). Writes, each built in Rust and checked
against the last good read (at most two minutes old; a key, preset, speaker, group or
timer id not in it is refused), go out on an agent that never reuses a pooled
connection, so the client never re-sends one: `POST /api/trigger/<routine key>`
(unforced; its answer becomes "started" or "skipped" with one of three fixed reasons,
never the service's text), `POST /api/trigger/<key>?force=true` only with `force: true`
for the key whose last unforced call was skipped within a minute, `POST
/api/group-presets/<id>/apply`, `POST /api/action/volume` `{room, volume}` per speaker
(a group's per-speaker writes in parallel, line-in, offline and unknown-level speakers
left out; 0 to 100, clamped), `POST /api/action/pause-all`, `POST /api/sleep-timer`
`{minutes, fadeMinutes: 5}` (30, 60 or 90 only) and `DELETE /api/sleep-timer/<id>`.
Each "asks first" case above answers `needs-confirm` without `confirm: true`. Errors are
fixed strings ("Could not reach Sonos", "Sonos could not do that", "Sonos status is out
of date", "Some speakers did not change") and nothing is logged. Dev mocks
(`bridge/devMocks/sonos.ts`) take `?sonos=off|down|sparse|heavy|quiet`;
`?moods=five|many|none|off|down` sets the mood cards.

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
overlap. It prints what it measured and exits 1 on any failure. `npm run fit-check`
checks the Home centre too: the mood row and every part of the Sound card inside the
band with Sound at its fullest (many moods, many speakers, long names, a sleep timer),
typical, sparse, not reachable and not set up, the one status card when both sources are
out, and the Speakers and More pop-outs open.

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
  lower and a little shorter; each event takes the first lane free at its start, and when
  more overlap than the two lanes hold the rest go into one "+N" chip in the second lane
  (hover lists them; a click opens a small list to pick one to open in Outlook; a
  second-lane chip under it joins the list, so no chip covers another in its lane). A chip
  narrower than 44 px shows no title (it keeps its
  hover card and an accessible name). Hover on a chip shows its title, time and account;
  a chip whose event Rust holds a web link for (`canOpen`) is a button that opens the
  event in Outlook (`wall2_open_event`, see "Opening an event in Outlook" under Meet).
  Calendar chips are rounded and carry words; the agent bars below are thin and wordless.
  Meet "Not set up" leaves the row empty with no text; any other failed read keeps the
  last good list.
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
  up or a failed read shows no marks. A mark is a button that opens its task in the task
  app (`wall2_open_task`); hover shows the title and due time. Agent bars come with the
  lanes (see Agents), the house schedule with the rooms.
- **Needle**: a white pill with the time, moved on each whole minute while visible.
  Before 6 AM it stays at the left end and still shows the real time. Hover on it counts
  down to the next meeting today ("Next meeting in 1 h 36 m: Weekly planning"), names the
  one in progress when none follows, or says "No more meetings today" after a good read.
- **Hover cards** (`ui/HoverTip.tsx`): one small card at a time, drawn inside the stage
  above what it explains (below when there is no room), after a 250 ms rest of the
  pointer, gone at once when it leaves; keyboard focus shows it too, but not the focus
  that follows a click. A shown card is redrawn every 15 seconds (the needle's countdown
  stays right) and closes when its anchor leaves the page. A pinned card (the "+N" chip's
  list) takes the pointer and closes on a click elsewhere or Escape.
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
- **State gallery** (`wall/scripts/gallery.mjs`, `npm --prefix wall run gallery` with
  `WALL_CHROME` set to a Chromium binary): renders every screen (Work, Home, Unwind, Meet,
  Zen, Dream and the morning Home camera) in sparse, typical, heavy and broken data states and
  at four times of day, at 2560 by 720, in real time. Writes PNG stills, `index.html` (grouped
  by screen, with each state's name and URL) and `manifest.json` into `wall/.gallery/`
  (ignored by git). Exits non-zero if a state fails to render or throws a page error.
  `-- --list` prints the states; `-- --only=<text>` renders the states whose screen or name
  contains the text. States come from URL knobs in the development mocks: the older `?hz=`,
  `?at=`, `?agents=`, `?long=1`, `?audio=demo`, and the newer ones in
  `src/bridge/devMocks/gallery.ts` (`screen`, `tasks`, `meet`, `home`, `net`, `moods`, `media`,
  `box`, `pc`, `usage`, `weather`, `focus`, `clock`). None of it is in a production build.
- **Right wing**: the next three tasks (see "Task card" below), then the key deck: Always
  here and Now (see "The key deck").

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
- **The dance** (`audio/dance.ts`, `danceHistory()`, `danceKick()`). The smoothed band level stays
  nearly flat on finished music, so the lines do not follow it alone. A second history in step
  with the first (one row per row) holds line heights shaped from the raw bands: per band a
  smoothed level (0.06 s up, 0.35 s down), a fast follower (0.025 s up, 0.2 s down) and a slow
  average (1.2 s); a transient is the fast follower over the slow one by more than 0.03; half the
  mean transient of all bands is taken off each (so a bar where everything rises adds little);
  that is divided by a running peak of the largest such transient (falls with a 4 s time constant,
  never under 0.07), so quiet music still reaches the top on its hits. Height is
  `soft(level * 0.32 + hit * 1.35, 1.8)` with `soft(x, L) = L * tanh(x / L)`, where `level` is the
  band lifted off `BAND_FLOOR` and scaled to 1.3 as above. The kick is the largest raw transient
  among the six lowest bands against its own running peak, raised to 1.5, zero under 0.04, then a
  follower (0.02 s up, 0.26 s down): one number, 0 to 1. The settle and lift rules
  (`musicDriving`, `BAND_FLOOR`, `REST_RESUME`) still read the raw bands. Silence, a pause
  (`pauseDanceHistory`), a hidden page and a whole ring of silence clear the shaped state, so no
  stale peak or follower is left for the first hit after. `sampleDance(u, age)` reads it with the
  same place and row mapping as `sampleBands` and a smoothstep between neighbouring bands. The
  echo's sampler reads it on every camera, so Work and Home's small ripple follows the hits too.
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
  - Work and Home (3 lines): while music drives them, opacity `ea` times a smoothed loudness (bass
    weighted), `n`, `amp`, `cx` from the camera (`en`, `eamp`, `ecx`), `hs` 900.
  - Unwind (11 lines, the visualizer): while music drives them, opacity `ea` (0.9) raised to full,
    with no loudness scaling, and the lines follow the real bands (`sample`, below). The playing
    look matches the concept: the lines are tinted bright teal through the centre shifting to pink
    at the far right (the renderer's `tint` option, blended over the palette's rim colour), 1.5 px
    wide instead of 1.4, and the newest line fades in at the front instead of popping in. Work and
    Home keep the palette's colour.
  - **Rest.** Whenever music is not driving the lines they settle into a still resting look
    instead of vanishing. `musicDriving` decides, with hysteresis so the lines never pump on a
    quiet intro, a gap between tracks or a single blip: a pause, stop or the volume off settles them
    at once; while driving, every band under the floor (`BAND_FLOOR`) for 1.5 s settles them, and
    that quiet settle then holds at least 4 s (`REST_DWELL_S`); from rest they lift only once the
    loudest band has stayed at or over `REST_RESUME` (the floor plus 0.05, 0.35: band levels are
    absolute, with no auto gain, so soft music or a low volume sits only a little over the floor)
    for a third of a second. This holds on
    every camera with a ripple. `stepEchoMotion` runs
    `rest` from 0 to 1 over 2.5 s (and back over 1.5 s when music returns) and eases the drift
    phase to a stop exactly on the resting phase (line j at `(j + 0.5) / n`), starting from the
    playing speed, so the lines slow down and land rather than freeze. The renderer eases each line
    from `rest` (ease out, the far lines a touch later), blending its shape, opacity and width;
    at rest the spectrum is not read at all and the lines hold perfectly still. The resting look is
    one setting, `REST_LOOK`, with the resting opacity (default `ridgelevels`, the owner's pick on
    the demo page, at 0.28 on Unwind, `REST_OPACITY_VISUALIZER`, and 0.22 on Work and Home,
    `REST_OPACITY`, blended by `visualizerWeight`): `ridgelevels` (the top line follows the ridge
    with the soft glow of the `ridge` look; every other line is a straight level cut off by the
    mountain at 0.9 of its peak times `(k + 1) / (n - 1)`; opacity shares 2.2 for the ridge line
    and 0.75 for the levels; fills kept; a line drifting between the top two blends its level,
    share and glow into the ridge's by its place, so it never jumps, and at rest the places are
    whole), `contours` (each line a smaller copy of the range's outline, evenly spaced
    from the foot to the ridge), `levels` (flat, slightly bowed level lines inside the mountain,
    the top one on the ridge), `haze` (softened outlines of farther ranges rising behind the main
    one, each fainter; no fills) and `ridge` (one glowing line on the ridge, two faint lines under
    it; no fills). Without `rest` (or at 0) and `drift` the renderer draws exactly as before
    (golden call log test); the rest frame has a golden log of its own.
  - **The dance on the camera** (`dance` and `swell` on the echo, `echoOptions`). `dance` is
    `visualizerWeight` (0 on Work and Home, 1 on Unwind), `swell` the kick. With both absent or 0
    the renderer draws exactly as before (golden call log test). With them: the line's base height
    is multiplied by `1 + 0.2 * swell * dance * (1 - 0.45 * a)` (`a` is the line's place from the
    front), and the displacement mask blends, by `dance`, from `min(1, cr / (cmax * 0.5))` to
    `min(1, 0.2 + cr / (cmax * 0.5)) * (0.25 + 0.75 * edge)`, where `edge` is 1 within 62 percent
    of the half span from the echo's centre and eases to 0 at the half span, so the ripple reaches
    the foot of the range and thins toward the echo's edges. The amplitude passed is
    `eamp * (1 + 0.7 * dance)` (`DANCE_AMP`). Opacity and colour are not touched: only the shape
    dances.
  - **Lake reflection** (`reflection.ts`, `REFLECT`, on). After the frame is drawn on a camera with
    `dance` above 0 and lines on screen, the band 190 design pixels above the horizon line is
    copied to one scratch canvas (made once, resized only when the canvas size changes), faded by a
    vertical gradient (clear at the top, solid at the horizon) and drawn flipped under the line at
    0.62 of its height, 3 design pixels below it, additively, at `0.8 * dance * gate` opacity, with
    an explicit transform (`setTransform`, restored after). Not drawn on Work and Home, with no
    lines (an idle display, Rainier in the morning) or while Zen is open.
  - `sample`: while any line still follows the music (`rest` under 1), `HorizonCanvas` hands the
    renderer a sampler (`createEchoSampler`): each line reads the shaped heights (`sampleDance`) at
    its own age (the 7 seconds spread across the lines). Without `sample` the renderer uses its made-up `spec()`.
  - **Glides.** A camera glide blends the line count (`en`, 11 on Unwind, 3 on Work and Home).
    `HorizonCanvas` keeps a drawn count that follows it at no more than 4 counts a second
    (`stepLineCount`; the glide's eased peak moves `en` at about 15) and lands on it exactly. The
    renderer draws a fractional count as the two whole sets either side, crossfaded by the
    fraction, each on its own levels, so no line appears, vanishes or jumps level during a glide,
    at rest, mid-settle or mid-lift, and each line fades over a quarter of a second or more. Under
    reduced motion the count switches with the place's cross-dissolve.
  - Never on the morning Rainier camera. On a turn toward it the echo fades out within about half
    a second of the turn starting (the camera gate: its opacity only falls from the first frame of
    the turn and is exactly 0 by 0.6 s), and it stays off, through any turn back, until the camera
    has settled on a place whose echo is on; then it fades in over 0.6 s. Under reduced motion and
    in the review still every place with a ripple shows its lines at rest.
  - When the display is idle or off (`useIdle`: no input for 4 minutes, screens off, locked)
    the echo fades out over a second and is then not drawn, and the band history stops; both
    start afresh on return. A hidden page returns with the lines at rest.
- **Echo calm check** (`npm run echo-calm`, by hand; CI does not run it). Builds
  `scripts/echo-calm/` (the real renderer, echo and audio store) into one HTML file and draws 600
  frames of the Unwind camera in headless Chromium with the echo and without it, for the
  `?audio=demo` levels, for every band pumping fully on and off 6 times a second, and for the
  settle (`mode=settle`: the demo levels for 10 s, then silence, stepped as the canvas steps
  them). It takes what the echo adds to the picture's mean relative luminance over every pixel
  and fails if that moves by 1 percent of the picture's mean, up or down, more than a limit's
  number of times in any second, or if any echo line moves more than a limit's number of design
  pixels between two frames; the limits are per input (`LIMITS` in the script). They were three
  swings a second before the dance; the lines now follow every hit, so each sits a little over
  what the chosen look measures (demo 62 swings, at most 6 in a second, 52.4 px; every band
  pumping 194, 12, 23.5 px; settle 33, 6, 52.4 px; before the dance 11, 1, 22.3 px; 12, 1, 14.1 px;
  7, 1, 19.8 px). For the settle also if any frame after the music stops changes it by more than
  2 percent, or any frame from 3.5 s after changes it by more than 0.05 percent (unchanged). Set
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
  agents still running. No agent needs you.", from the focus timer once it has loaded and
  the helper summary `wall2_omni_summary` every minute while visible; the agent and
  needs-you sentences are left out without the helper or when it reports stale data).
  The parts that carry an action are chips with a tooltip: "N agents still running" is a
  quiet chip that switches to Work, and "N things need you" (or "One thing needs you") an
  amber chip that opens the first waiting chat with `wall2_open_session` (the summary's
  first your-move session, else the first lane that waits; when links are not available it
  switches to Work instead). Each chip is 32 px tall. "Work is put away.", "Focus is still
  on." and "No agent needs you." (the line only knows about agents) stay plain text. When
  the calendar cannot be read (no account answers, or the cached read is over 30 minutes
  old) the Tomorrow spot says "Calendar not available"; when weather is missing the date
  line ends with "weather unavailable" in dim text. The Room chips mark the mood that is on
  now (the shared last mood, for three hours), give each a tooltip (with the home feed's
  description when it sends one), and sit in a fixed grid of three columns and two rows; past six moods the sixth cell is a "More" chip and the mood that is on takes the place of an ordinary one (never an extra chip). The volume
  slider shows its number on hover and while dragging. Screens off is an icon alone (36 px, quiet until hovered) in the lower right
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
  with nothing drifting, and it jumps on a place change. The idle and sleep pixel maps in
  `sprites.ts` are the concept's own; the other poses and the props are drawn to match.

Watt is also a small pet ("he"), calm and silent (no sound at all):

- **Speech bubbles** (`buddy/chatter.ts`, `buddy/lines.ts`): one short bundled line at a time,
  no model calls and no network. At most one every six minutes by default (three when set to
  Chatty, none when Off), never in a call or a meeting in progress, never in the first minute of
  a focus session, never while the display is idle, never asleep, never the same line twice in a
  row. A fresh event (focus done, an agent finished or waiting, a call soon or just ended, music
  stopping, a clover) wins; otherwise what is true now (agents, music, weather, time of day) wins
  over plain sheep thoughts. A showing bubble goes the moment any quiet time starts. His lines
  observe himself, the sky and the wall; none gives advice, nags or asks anything of the owner. The
  bubble is his own lavender with his dark face colour for the text; its box is sized from
  measured Oxanium widths (`petFrame.ts`), placed beside him within the band, and
  `model.test.ts` checks every line.
- **Reactions** (`buddy/petFrame.ts`): a small hop when a focus session completes or an agent
  finishes; he looks up toward the agent cards and shows an amber mark while something waits
  (click it: it opens the waiting session through `wall2_open_session` when the helper gives a
  link; elsewhere it goes to Work, and on Work with no link it only tells, as the agent cards
  above already show what waits); he looks at the clock five minutes before a meeting; he
  bobs (a soft squash) on the beat at most once every 1.2 seconds.
- **The pointer on him** (`Watt.tsx`, `buddy/carry.ts`). Hovering opens nothing: the cursor is a
  grab hand and the tooltip reads "Click to pet. Drag to carry. Right-click for his card."
  - **Click pets.** A press and release with under 6 px of movement and under half a second is a
    pet: hearts and a wiggle, and a spoken reply only outside every quiet time, at least 20
    seconds after any bubble and at most once a minute (a second click within three seconds adds
    nothing). It never opens the card. Keyboard: he is one tab stop; Enter or Space pets.
  - **Right-click opens his card** (`contextmenu` on him, and only on him; the browser's own menu
    is prevented by a listener on his element, which runs before the page's other handlers, and
    WebView2 shows no menu when the event is prevented). The ContextMenu key, Shift+F10 or the
    letter M opens it too and moves focus into it. The card shows his name, his mood in one word,
    two honest lines about today, days together, how chatty he is and what he wears. It is a strip
    in the band over the horizon beside him (on Unwind, under the transport row over the empty
    floor). It closes on Escape (focus returns to him), a click or right-click outside it, a
    right-click on him again, a place change, keyboard focus moving on past it and when he goes
    away; he stands still while it is open. His click area is his body and head, not the sprite's
    empty corners.
  - **Pick him up and set him down.** Press on him and move 6 px or more (mouse, pen or touch;
    pointer capture, so nothing under him sees the pointer) and he is lifted by the wool on his
    back, in a held pose with his legs swaying with the pointer's speed, drawn above the cards.
    He is kept on the screen. Letting go drops him gently (300 to 500 ms by height, one small
    squash) to the ground line of the band under the release point, at that x kept inside the
    span he walks on that place; under reduced motion he is simply there. He then sits and looks
    around for about 20 seconds before walking back to where his wander stands. A carry is never
    a pet. Pointer cancel, a lost capture, the window losing focus, the page hiding, a call
    starting or the display going idle put him down at once from where he is (no fall when the
    page is hidden); a place change just moves him. Letting go within 24 px of a clover feeds it
    to him. Shaking him (three fast direction changes inside a second) gives swirly eyes for
    three seconds after landing. While carried the amber mark and the clover are hidden. He says
    at most one "held" line, one "landed" line and a "dizzy" line at most once a minute, all
    obeying every quiet time and the chattiness setting, and carry lines come at most every 20
    seconds across carries.
  - **He notices the pointer.** Within about 260 px, and not busy (reading in focus, walking, a
    clover on the ground, asleep, a reaction running), he turns to face a pointer that moved in the
    last 6 seconds, with his ears up (the "alert" pose); after 6 still seconds he loses interest.
    Not under reduced motion.
  - **Happy hop and a milestone.** Three clicks within 4 seconds (the second and third add nothing
    to the pet count) give one happy hop, a jump with a turn of the wool, at most once every 20
    seconds. The tenth pet of a day gives a one-off sparkle and a "milestone" line.
- **Tricks and commands in his card** (a row of 32 px buttons, each with a tooltip). "Hop" and
  "Spin" are small reactions; "Nap" lies him down asleep for a minute or until he is petted;
  "Come here" trots him to the middle of the place, where the wander picks up from; "Stay" is a
  switch that keeps him sitting where he was last set down (or where he stands, if he never was)
  until it is switched off, the place changes or the day ends. Stay is kept in the stored record
  (`stay`: place, x, local date) and checked whole on read (a known place, an x on the stage,
  today's date; anything else is dropped). The tricks are refused quietly, not hidden: in a call
  or a meeting, in the first minute of focus, while he sleeps at night and while he is away, the
  buttons are off and their tooltip says why. "Read with me, 25 min" starts the existing focus
  timer through the focus store at its default length (no new timer logic) and is off, with a
  tooltip, while a session runs. Tricks add a line from the "tricks" or "stay" group, on the same
  quiet and chattiness rules, at most every 20 seconds.
- **A firefly at dusk.** Between sunset (`ribbon/sun.ts`) and his bedtime (9:30 PM) one small
  firefly drifts in a slow loop near him and blinks softly (never brighter than his wool); he
  turns to watch it. Not under reduced motion, never in a call.
- **A little life**: he reads a tiny book during focus, wears headphones on Unwind while music
  plays, sunglasses at a clear midday, an umbrella in rain, a scarf when it is cold, a nightcap
  asleep; he looks up at the moon in the evening, yawns and stretches when he wakes at 6:30,
  and naps where he stands while the display is idle. His mood (content, happy, sleepy,
  curious) only changes which lines and idle poses he picks; it never goes below content. Twice
  a day a clover grows on his walk; he eats it when he reaches it, or click it to give it to
  him. Cosmetics (bow, star, cape) unlock with days together.
- **Stored locally** (`localStorage` key `wall2.watt`, `buddy/pet.ts`): how chatty he is, the
  cosmetic, days together, today's counts and his Stay. His click area, mark and clover sit above the
  shell (`z-index: 1`) and take the pointer only while he is up; carried, he is at `z-index: 40`.
- What he knows comes from existing hooks (`useAgentStatusLine`, `useAgentsWaiting`, the
  agents store, `useWeather`, `useNextMeeting`, the focus store, the audio store and beat
  detector, now playing, `useIdle`); a missing or stale source means he does not mention it.
  `useWeather` and `useNextMeeting` are shared stores (as the agents poll is): one request per
  interval however many components use them.

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
- `sonosBaseUrl` is optional: the Sonos service on the home box, scheme, host and port
  only, `http` or `https` (plain `http` to a private address is allowed, as for
  `homeBaseUrl`, with the same spoofing caveat). See "Sound on Home".
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
merged across both accounts, earliest first. The ribbon draws only today's. Each event has `key`, `accountId`, `title`, `start`, `end`, `canJoin`, `canOpen` and
`isLive`, with the same rules as the next-meetings read (no body, attendees or
organizer; cancelled, declined and all-day events left out; the same invite on both
accounts once; join links behind keys). `isLive` is true when the subject starts with
"Livestream". Day keys start with `d` and live in their own map, so a day read never
invalidates a Join key from the next-meetings read. An unavailable account adds no
events to the day view (there is no "updated N min ago" copy here).

### Join links

Join opens only a Teams meeting link: `https` with no user name, password or port other than 443, host exactly `teams.microsoft.com` or `teams.live.com`, a path starting `/l/meetup-join/` or `/meet/`, and at most 2048 characters. Anything else (Zoom, Google Meet, a Safe Links wrapper, an unknown Teams format) shows no Join button. The link stays in Rust behind a key like `3-1`; the web view passes only the key, and Rust checks the rules again before opening it in the system browser. The Wall 2 capability has no opener permission.

### Opening an event in Outlook

The day read also selects Graph's `webLink` for each event. It stays in Rust behind the same day key (its own map, cleared with the day keys on every day read and dropped for an account at sign-out); the web view gets only `canOpen: true`. A ribbon chip with `canOpen` is a button: `wall2_open_event(key)` looks the link up, checks it again (`https`, no user name or password, no port other than 443, at most 4096 characters, host exactly `outlook.office.com`, `outlook.office365.com`, `outlook.live.com` or `outlook.cloud.microsoft`) and opens it with the default handler; a key that is not exactly the generated shape (`d`, the generation, `-`, the index; ASCII, at most 24 characters) is refused before any lookup, and an unknown key or a link that fails the check answers `gone`. Nothing about it is logged. Honest limit: the link opens Outlook on the web, or the new Outlook app when it takes such links; classic desktop Outlook cannot be opened at one event by a link.

### Refresh

The list is read when Meet opens and every 5 minutes while Meet is the active place and the window is visible. The countdown ticks every 30 seconds from the last list. A failed read keeps the last list and shows "updated N min ago". When a read leaves an account unavailable, Meet reads again after 30 seconds, then after 60 seconds, then goes back to the 5 minute cadence; the fast retries stop when Meet is hidden, and Try again does not use them up. The calendar read asks for at most 50 events in the next 24 hours and ignores paging (50 is plenty for a day). It selects only the subject, times, response, join link, invite id and web link, never the body, attendees or organizer.

### Why an account is unavailable

An account row shows one plain line ("Microsoft is not answering", "Network problem", "Signed out", "Sign-in expired") and, for a failing account, when it checks next as a relative time ("checking again in 2 min"). The code (one of the fixed shapes below, with a plain reading) and the exact time of the last try are in the row's tooltip, never on its face. A failing row keeps the filled Try again; a signed-out or expired account has a quiet outlined Sign in and the dim line "Meetings on this account will not show." When one account is read and another is not, LATER says "Nothing else on <account>" with a dim line for the other ("<account> not read since 9:40 AM", "is signed out", "is being checked" while it is still being read), and the NEXT card says "may be out of date" whenever any account is not read yet or not fresh. LATER says a bare "Nothing else" only when every account was read fresh. "checking again in N min" counts to the real next read: the earlier of the next fast retry and the next 5 minute poll. The last known meetings are kept per account and only for an account whose read failed; signing an account out (or its sign-in expiring) drops its meetings at once. When every account fails, the last known NEXT card stays, dimmed, with its clock time and "as of <time>" (no countdown) and no Join; the Accounts card carries "Calendar not available" only when there is no last known meeting. Join is filled only for a meeting that is live or starts within 15 minutes; every other Join is quiet and outlined. When Meet is not set up it says "Calendar is not connected yet." with "Setup steps are in the Wall 2 README, section Meet." under it. A code has one of these fixed shapes and nothing else:

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
| `$select` | `subject,start,end,isAllDay,isCancelled,responseStatus,onlineMeeting,onlineMeetingUrl,iCalUId,webLink` |
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
- From helper 1.1.0 the summary also carries, all optional so an older helper's answer reads as before: `sessionsList` (every open parent or standalone session, up to 12, deduplicated, or null), per session `live` (`working` or `idle`), `idleS`, `kids` (`{ total, working }`, working never above total), `waitingSinceS`, `next` (up to 60 characters), `harness` (`claude`, `codex` or `other`; any other text is `other`) and `failed` (true only for `true`); `sessions` (a map of up to 40 ids to `{ title, stage, state }` for naming bars of sessions with no card); `yourMove.ids` (up to 5 waiting ids); `usage.accounts` (up to 6 `{ provider, label, weekPct, fiveHourPct, weekResetsAt }`, labels up to 24 characters) with `usage.claudeWeekPct` now nullable; and `slots.sessions`, `slots.working`, `slots.helpers`. The same id, text, number and time rules apply to each.
- `wall2_open_session(id)` accepts only an id that matches the same pattern and appeared in the most recent successful summary (its lanes, session list, waiting ids, first waiting entry, names map or day log), builds `omnigent://<omniLinkHost>/c/<id>` in Rust and opens it. Any other id is refused.
- `wall2_focus_omnigent(id?)` opens the session as `wall2_open_session` does (when an id is given), then brings the OmniGent desktop window forward on the primary monitor. It trusts only the executable registered for `omnigent://` links (the default value of `Software\Classes\omnigent\shell\open\command` under HKCU, then HKLM; the quoted or unquoted path is parsed and compared in full, case-insensitively, after dropping a `\\?\` prefix), so a program with the same file name in another folder is refused; with no handler registered nothing is brought forward (the link still opens). It looks for a visible, unowned, titled top-level window of that executable every 100 ms for up to 2 seconds, skipping a hung window, restores it if minimised, moves it into the primary monitor's work area if it is elsewhere (keeping it maximised if it was), and sets it foreground, using only calls that cannot block on another program's message loop (`ShowWindowAsync`, `SetWindowPos` with `SWP_ASYNCWINDOWPOS`). One attempt runs at a time; a click while one runs starts none. If no window turns up, nothing more happens. Windows only; elsewhere the second step does nothing. When the wall itself sits on the primary monitor it stays above OmniGent (it is always on top).
- `wall2_machines` returns `{ pc: { cpuPct, gpuPct, ramPct }, box: { cpuPct, gpuPct, ramPct, tempC } | null, boxStale }`. The PC numbers come from the same function as the old `get_system_stats` (which is unchanged). The PC numbers are returned at once on every call. The box numbers come from the helper summary's `system` block, refreshed in the background (one read at a time, at most one every 15 seconds, 3 second timeout), so a slow helper never delays the PC numbers and the first call after start shows `box: null`. After a failed read the last good box numbers stay with `boxStale: true` for up to 10 minutes, then `box` is `null`. `box` is also `null` when the helper is not set up. The numbers are kept per `omniHelperUrl`, so a changed address never shows the old host's numbers.
- All of them refuse any window but `wall2` (`forbidden`).

Nothing here logs, and nothing here takes a wake lock or sets an execution state. Browser dev (`npm run dev`) shows mock answers from `devMocks/omni.ts`; `?agents=3` (default), `2`, `1`, `0`, `7`, `12` (sessions from a helper 1.1.0 answer, with three subscriptions, one near full), `ask` (one waiting), `ask2` (two waiting, one not on a card), `failed`, `old` (an older helper's answer), `stale`, `off` (not set up) or `down` (not answering) picks the helper's state.

### Agent lanes (Work centre)

`wall/src/agents/`, as in the concept's `f_work`:

- **Data** (`useAgents.ts`): one poll of `wall2_omni_summary` shared by everything that reads it, on mount and every 15 seconds while the page is visible and at least one reader is mounted. Nothing while hidden. One read at a time; a read over 10 seconds counts as failed, and a lane or day span with a missing or wrongly typed field is dropped. `not-configured` or `invalid-config` is "not set up". A failed read keeps the last answer, marked stale, for up to 30 minutes; with no earlier answer, or when the helper's own `now` has not moved for 30 minutes of this PC's time (a frozen helper), it is "not reachable". The two machines' clocks are never compared: the first answer is always accepted, and the skew (the helper's `now` minus this PC's time when the answer arrived) is taken off every helper time before the ribbon draws it. When the page comes back after more than 15 seconds away, the kept answer is stale until the first new read returns.
- **Stale is never live**: while the answer is stale the lanes dim with "updated N min ago", the ribbon's agent row dims and its open runs end at the last good answer's time, `useAgentStatusLine()` returns null and `useAgentsWaiting()` returns false.
- **Header**: "Agents", the slot meter (a pip per slot up to six, filled for each working session, "+N" past the last pip) with wording that cannot read as a bug ("4 working, 6 open, 4 slots" from a newer helper, "9 running, 4 slots" from an older one), a hover with the breakdown (working, open, helpers) and a click that brings OmniGent forward; "3 of 7" when more sessions are open than fit (a click shows the next three). On the right: the button "One thing for you: <title>" in amber, which opens that session and brings OmniGent forward; "then N more" (counting only the up to five ids it can step through, "and more" beyond) opens the next and the header names it ("Also for you: <title>"), wrapping back to the first; with something waiting but no id, "Something needs you", which brings OmniGent forward. With nothing waiting, "Ready to merge: <title>" in mint when a card is ready for Hold to merge (a click shows that card), else "No agent needs you" (it only knows about agents). The waiting list is the helper's `yourMove.ids` (or its first entry) plus any waiting card, less any snoozed here; a title comes from the cards, the first entry or the names map. **Stale**: the header, slot meter, count, parked line and usage meters dim with "updated N min ago"; the amber call to action goes grey and the One thing button and slot meter do nothing; with nothing waiting it reads "Last known: no agent needed you, as of 10:02 AM" with a grey dot, never an all-clear. Cards still open, and their hover says "All of this is as of N min ago".
- **Cards** (`Lane.tsx`, `StageTrack.tsx`, `LaneRing.tsx`): parents and standalone sessions only (`sessionsList`, or the three lanes from an older helper), numbered 1 to N on the ring. Three are in view; more scroll with the wheel a card at a time (scroll snap), with a thin scrollbar that shows on hover; the page never moves. The title takes every free pixel; hover shows the full title with the details. The second line says the most useful thing first: waiting on you (amber: the helper's question for it when there is one, else "Waiting on you for 12 min"), failed (red), what it is doing or its next step, then "Working now" or "Idle for 5 min"; after it, quietly, as many whole facts as fit (helpers, which assistant, the PR with checks), dropped from the end and never cut inside a word, all of them in the hover. A waiting card has an amber edge, an amber ring with "?" and two buttons in place of the time: "Open chat" (opens it and brings OmniGent forward) and "Later", which quietens it for 15 minutes on this display only (kept in this display's storage, nothing sent anywhere): the card keeps a small amber dot and "Snoozed until 10:41 AM", the header and the dot over Watt stop counting it, and it comes back by itself. A failed card has a red edge and a warning sign. The time at the right says what it measures in its hover ("Working, open for 42 min, started 9:42 AM") and reads "idle 12 min" when the helper says how long it has been idle. Only the card with "Hold to merge" takes the button's extra width, from the end of its own track, so every track starts in line. With fewer than three cards they grow (to 150 px) and the quiet facts move to a third line.
- **Stage colours**: Plan, Build, Review, PR and Live each have a colour (`--st-plan` to `--st-live` in `tokens.css`, cool to warm, Live a yellow-green kept apart from the failed red, from amber and from the pink PR colour; amber and mint are kept for "waits on you" and "done"), used on the track (done stages dimmed, the current one glowing), the card's ring and the ribbon bars' left notch. Hover on a track shows the legend. Each measures at least 4.7:1 on the lane glass and the ribbon on the morning, noon, sunset and night skies; the inactive stage labels (6:1) and the timeline row numbers are at least 11 px.
- **Click**: each card's open action is a real button stretched under its content (Tab reaches it, then the card's own buttons); a click anywhere on the card but those buttons calls `wall2_focus_omnigent(id)`: the session opens and OmniGent comes forward. When the summary says `linksAvailable: false` there is no open button.
- **Hold to merge**: drawn on a lane whose PR is ready with checks passing (or none). Until the merge path lands (PR 30), a hold of 600 ms opens the chat; a short tap does nothing but show "Hold" for a moment. A move of more than 12 px, leaving the button or a pointer cancel ends the hold with no hint. Enter or Space on the button opens the chat. The button's events never reach the lane.
- **Free slots**: with fewer than three cards, slim quiet "Free slot" rows (58 px). With no card at all, one slim "All three slots free" row and the focus timer with the weather, a little smaller.
- **Shelf** (`Shelf.tsx`): "N parked sessions" (or "Nothing parked"; hover: "put aside with a note; open OmniGent to resume one"; a click brings OmniGent forward) and usage: one small meter per subscription from a newer helper ("Claude 1", "Claude 2", "Codex"; "n/a" when the helper has no recent reading), with the five hour figure inline when there are two or fewer and the reset time on hover. Amber goes only to a figure the meter shows (the fullest, above 90 percent); a five hour figure above 90 that is not shown inline gets a small amber mark, its number in the hover. From an older helper, the Claude five hour figure and "Claude this week" with a bar, as before. The mail count waits for the mail scope (D7).
- **Ribbon** (`ribbon/AgentRow.tsx`, Work only): one sub-row per session with a span today, in the cards' order, then sessions that ended today. Every sub-row is 8 px tall so a mouse can hit it, and three fit; with more sessions the third row becomes "+N more", whose hover lists each folded session (name, stage, state) and whose click shows the first of them in the cards. No two sessions ever share pixels. The card's number sits at the left of each session's first bar and its stage colour is the bar's left notch. Running cyan, waiting on you amber, a finished run grey, done grey with a mint cap, up to now. Hover shows the session's name (from the names map for a session with no card, else "An earlier session"), stage and spans in plain words ("working 2:10 to 3:40, waiting on you since 3:40"); a click opens it in OmniGent. Hover on the row's icon gives the day in one line ("Today: 5 h 10 m of agent work across 4 sessions, 40 min waiting on you"). A task due label that would sit on the bars shows only its diamond, the label in its hover.
- **Clock carry-over**: any change of the helper's `now` counts as movement, so a helper clock that is corrected backwards never reads as frozen.
- **Hooks for other places**: `useAgentStatusLine()` gives one line ("Two agents still working, nothing needs you") or null when not set up, for Unwind and Dream; `useAgentsWaiting()` is true while something waits, for the amber dot over Watt. Both share the same poll.

## The key deck (Work, right wing)

Two rows under "Next three", in one box (`.deck`): **Always here** and **Now**. Both act on the owner's Windows PC outside the wall, only on a click on the wall, and fail closed. None of it has been run on a real Windows machine yet: CI compiles and unit-tests the decisions, the Win32 calls are unverified. The deck is not drawn on a build where the commands do not exist.

Files: `Keys.tsx` (Now), `PinnedRow.tsx` (Always here), `KeyPicker.tsx`, `forYou.ts`, `wallActions.ts`, `libraryModel.ts`, `keysModel.ts`, `keysFeed.ts`, `keyPress.ts`, `deckStore.ts`; Rust in `src-tauri/src/wall2_keys.rs` (config, chords, sending), `wall2_keylib.rs` (the library and the list of wall actions) and `wall2_arrange.rs` (window layouts).

### What a key can do

A key is either a **chord** (keys pressed in the program in front) or a **wall action**, one of a fixed list that Rust checks (`parse_action`). The page sends only a set id and a key index (or a library id). Rust answers one of three ways: the chord was sent, Rust ran the action itself (only `lock` and `displays:off`, which are system calls), or the fixed action name, which the page then runs through the control or command the wall already has for it. Each action is only what a visible control already does, and only on a click. Opening apps, files or links is not part of this.

| Action | What it does |
|---|---|
| `layout:thirds`, `layout:focus`, `layout:record169`, `layout:undo` | The window layouts below, and their Undo. Off, with the reason, when there is no big screen. |
| `screens-off` | The wall's own Screens off (same command as the Unwind button; says so if they are already off). |
| `focus:start`, `focus:25`, `focus:50`, `focus:stop` | The focus timer at its default length, 25 or 50 minutes, and its reset. Refuses a second start. |
| `lock` | Locks the PC with `LockWorkStation`. Win+L stays a refused chord. |
| `displays:off` | Asks Windows to put every monitor to sleep (a `SC_MONITORPOWER` broadcast, as the old app does; the one second limit is per window that does not answer, so it runs on its own thread and never holds the send guard); they wake on input. Different from Screens off. |
| `mixer` | The existing volume mixer command. |
| `sonos:pause-all`, `sonos:play-suggested` | The existing Sound commands. A key never bypasses a confirm: a loud routine opens Home and says so. Stale Sound data is refused. |
| `mood:<id>` | The existing mood command, for a mood id the home app lists. |
| `tasks:open`, `task:first` | Opens the first of "Next three" in the task app. |
| `omnigent:front`, `agents:open-waiting` | Brings OmniGent forward, or opens the first waiting session that is not snoozed. Refused when the helper is not answering. |
| `meet:join-next`, `event:open-next` | Joins, or opens in Outlook, the next meeting. Refused when the meeting list is old. |
| `zen`, `dream` | Opens Zen or Dream. |

Listed in the picker as "coming" and not runnable: `task:add` (needs a write to the task app), `tv:off` and `alarms:seen` (wait for the home app change), `omnigent:new-chat`.

### Always here

The pin icon beside the heading. Up to five keys that never change by themselves: the owner's pins on this display (local storage `wall2-keys-pins`, validated on read against the library and `keys.json`, anything odd means the defaults; a pin on a `keys.json` key is stored with that key's label and action and is dropped when the file no longer has the same key there), else the keys named in `pinned` in `keys.json`, else **Thirds, Focus, Record 16:9, Snip, Screens off**. After a layout key the heading says "3 windows arranged" (or "2 of 3") with an Undo button for 60 seconds, and the layout key keeps its outline. Right-click a key, or press the ContextMenu key or Shift+F10 on it, to open the picker.

**The picker** covers exactly the two rows' box and nothing else (never Next three; with little in the rows the box grows to 236 px while it is open): the whole library by group, a search box (label, group and what a key does), the current five marked ("pinned", "this slot"), a click swaps that key into the slot (a key already pinned trades places), "Reset to defaults" at the bottom. Escape (from anywhere while it is open) or a click outside closes it, and the click that closes it does nothing else; the arrow keys move through the rows; rows are 36 px tall, two to a line. Keys marked **check** are shortcuts the owner must confirm on his PC: they are never in a set Auto shows, and the page offers one only once it is pinned. Rust itself accepts any runnable library id (held to its group's programs), so the "only when pinned" rule lives in the page. "coming" rows and shortcuts still to be worked out (the three Power BI ribbon ones) are listed but cannot be pinned. `keys.json` is never written.

### Now

Heading "Now · <page name>", the pages as dots, previous and next arrows (the wheel over the row steps too) and the Auto switch. The pages, in stepping order: **For you** (only while something waits), the set for the app in front, the general set, then every other set.

**Auto** shows the set for the app in front, else the general set. When a NEW "For you" item arrives (never seen, or gone for 10 minutes or more; one that blinks out for a poll is the same item; items already waiting when the row mounts are not new; the swap waits for any press in flight) Auto shows that page for 45 seconds, then goes back to the keys by itself, even if the item still waits. While anything waits and the page is not showing, a small amber chip "For you 3" in the heading jumps to it. Stepping by hand (arrows, dots, wheel, the chip) turns on **Hold**: the row stays on that page until Auto is clicked, and Hold never times out. A held For you page ends when nothing waits any more. A key still goes only to an app its set allows; a held set in the wrong app is refused ("Wrong app in front for ...") and nothing is sent.

**For you** is at most two lines, each an icon, a title, a short reason and one button, with "+N more" in the heading. In this order, each from a store the wall already has, each left out when its source is stale, down or not set up:

1. a meeting that starts within 10 minutes or is live: **Join** (the Meet join command);
2. an agent waiting on the owner, not snoozed with "Later": the session title and "asks: <question>" when the helper sends one, else "waiting N min": **Open chat** (`wall2_focus_omnigent` with the id);
3. an agent whose pull request is ready to merge: **Show** (scrolls the agent cards to it and flashes its ring once; Hold to merge stays on the card only);
4. an open network alarm: its text and age: **Open** (what Home's own button opens).

With nothing waiting the page is skipped when stepping and Auto never shows it. When the agents helper is down the page shows what it still knows from other sources and says nothing about agents.

**Built-in sets.** Built from the library's groups and matched by executable name (the file part of the program's path, any case); a set in `keys.json` for any of the same programs wins and the built-in one is left out. They are only as right as these names, which the owner should check on his PC and can override with his own set:

| Set | Matches | Keys |
|---|---|---|
| General (the fallback) | any program | Snip, Clipboard history, Task Manager, Lock the PC, All monitors off, Mute sound, Play or pause, Show desktop |
| Teams | `ms-teams.exe`, `teams.exe` | Join next meeting, Mute, Camera, Share screen, Raise hand, Leave |
| Zoom | `zoom.exe` | Mute, Camera, Share screen, Raise hand, Leave |
| OmniGent | `omnigent.exe` | Open what waits on me, OmniGent to the front |
| VS Code | `code.exe` | Command palette, terminal, quick open, search all files, side bar |
| Browser | `chrome.exe`, `msedge.exe`, `brave.exe` | New tab, Reopen closed tab, Address bar, Private window, Dev tools, Hard refresh, Find on page |
| Mail | `outlook.exe`, `olk.exe` | Open next event |
| Recording | `obs64.exe`, `camtasiastudio.exe`, `camtasia.exe` | Record 16:9 layout, Windows screen recording |
| Power BI | `pbidesktop.exe` | Save |
| Excel | `excel.exe` | Filter, make a table, sum, repeat last action |

A key is offered only where it is right: Excel keys never go to Power BI Desktop, VS Code keys never go to OmniGent, and Firefox has no built-in set (its private-window shortcut, Ctrl+Shift+P, is a "check" key in the picker, held to `firefox.exe`).

The other groups (Sound and music, Windows and layouts, Tasks and focus, House, PowerToys, and the rest of Anywhere on the PC) are reached through the picker.

### The library

`wall2_keylib.rs` holds 103 keys in 16 groups, each with a stable id, a label, an icon from the fixed set, a group and one action. `wall2_keys_library` gives the page ids, labels, icons, groups, `how` text and the action name, never a chord. A pinned library key goes only to the programs of its group (anywhere for the general groups), so a Teams key never types into another app. `wall/src/bridge/devMocks/libraryData.ts` is the same catalogue for dev mocks and tests, and a test holds it equal, field by field (ids, labels, icons, kinds, `how`, action, runnable and each group's programs), to what the Rust table returns.

### Big screen layouts

`src-tauri/src/wall2_arrange.rs`. The big screen is the monitor that is not the wall's own and has the widest aspect ratio, taskbar excluded (its work area). With the wall as the only monitor the layout keys are off with a tooltip.

- **Thirds**: the three newest ordinary windows on that monitor in equal columns, left to right as they already stand. Two make halves; one goes to the centred third.
- **Focus**: the newest window in a centred column two thirds wide; the others stay.
- **Record 16:9**: the newest window at the largest 16:9 size that fits, centred.

Ordinary means visible, not minimised, not cloaked, with a title, top level, not owned, not a tool window, not the taskbar or desktop shell, not the wall's own, and not a fixed-size dialog or an elevated program the wall may not move (those are skipped silently). A maximised window is restored first and given up to 200 ms to leave the maximised state; the handle is looked at again after the wait (still the same process, not minimised) and one that is still maximised at the limit is skipped and asked to maximise again so it is left as it was found. Every window is looked at again immediately before it is saved or moved; one that closed, whose handle another program reused, or whose position cannot be saved is not moved. Nothing is closed, minimised or hidden. Each layout remembers the earlier position of what it moved; Undo shows for 60 seconds (restarting on each layout click) and looks at each saved window as strictly as a layout does (same process, visible, not minimised, not the wall's own): a window the owner has minimised since is left alone. The restore runs on a helper thread with a 400 ms bound so a window that hangs cannot hold the layout guard, which is released on every path. The move is posted without waiting; then, within 250 ms in all, each window's frame is checked once and the answer says "3 windows arranged" or "2 of 3 windows arranged". A double click, or a held key, never acts twice (clicks with `detail > 1` and key repeats are ignored, and a control stays quiet for 500 ms after its action). Commands: `wall2_arrange_status`, `wall2_arrange(layout)` and `wall2_arrange_undo()`, all gated to the `wall2` window. Answers are `{moved, asked}` or a fixed word: `no big screen`, `no windows`, `none moved`, `nothing to undo`, `busy`, `unknown layout`.

### keys.json

`keys.json` beside `feeds.json` (same folder; read, validated and bounded in Rust, never written by the app) supplies custom sets and the default pins. With no file there are no custom sets and the built-in sets and default pins apply (the Now heading's tooltip says where the file goes). Only a missing file falls back; a file that exists but cannot be read shows "keys file could not be read" and offers no keys; an invalid one is refused with a message naming the app and key number. Neither is ever silently replaced. A key has a `label`, an `icon` and either a `chord` or an `action` (never both). `pinned` is an optional list of at most five keys of the same shape. The ids `pinned`, `foryou` and anything starting `lib-` are reserved.

**Chords** come from a fixed vocabulary, never free text or key codes: modifiers `Ctrl`, `Alt`, `Shift`, `Win` and at most one key per step from letters `A` to `Z`, digits `0` to `9`, `F1` to `F24`, `Enter`, `Tab`, `Esc`, `Space`, `Backspace`, `Delete`, `Insert`, `Home`, `End`, `PageUp`, `PageDown`, `Up`, `Down`, `Left`, `Right`, `.`, `` ` ``, `=`, and the single keys `VolumeUp`, `VolumeDown`, `VolumeMute`, `PlayPause`, `NextTrack`, `PrevTrack`. Steps are separated by commas (`Alt+H, R`), at most six, with a fixed 150 ms gap. Win+L and Ctrl+Alt+Delete are refused when the file is read (Windows does not accept them from a program); Alt+F4 stays allowed. Limits: file 32 KB, 12 sets, 8 keys per set, labels and names 16 plain characters, one general set, executable names unique.

**Volume and media keys** (`VolumeUp`, `VolumeDown`, `VolumeMute`, `PlayPause`, `NextTrack`, `PrevTrack`, alone) are system-wide: they are sent with no program in front, nothing is raised, and an elevated program in front does not stop them. Any other chord still needs its target. **Lock and All monitors off are mouse keys**: Space and Enter never run them, and the tile is blurred afterwards so the key that wakes the screens cannot run them again.

**Sending**, failing closed at each step with a fixed word the row turns into one short line: the page sends only a set id and a key index, or a library id (`busy`, `no key`); the set must accept the remembered window's program (`no app`); the window must still exist, be visible, belong to the same process whose image file name still matches (`gone`); the program must not be elevated (`elevated`), whatever the wall's own level; **do not start the wall as administrator**; it is brought to the front and checked to be in front (`not forward`); the chord is sent with `SendInput`, one step at a time, re-checking the front window before each step and releasing every held key on failure (`failed`). One send at a time, shared with the two system calls. Nothing is logged and no window title leaves Rust. The only process name that does is the file name of a program with no set, so the owner can write one.

Example `keys.json`:

```json
{
  "apps": [
    {
      "id": "general",
      "name": "General",
      "match": "*",
      "keys": [
        { "label": "Snip", "icon": "screenshot", "chord": "Win+Shift+S" },
        { "label": "Clipboard", "icon": "clipboard", "chord": "Win+V" },
        { "label": "Thirds", "icon": "window", "action": "layout:thirds" }
      ]
    },
    {
      "id": "powerbi",
      "name": "Power BI",
      "exe": "PBIDesktop.exe",
      "keys": [
        { "label": "Format", "icon": "brush", "chord": "Alt+H, F, P" },
        { "label": "Refresh", "icon": "refresh", "chord": "Alt+H, R" }
      ]
    }
  ],
  "pinned": [
    { "label": "Thirds", "icon": "window", "action": "layout:thirds" },
    { "label": "Focus 25", "icon": "timer", "action": "focus:25" },
    { "label": "Snip", "icon": "screenshot", "chord": "Win+Shift+S" }
  ]
}
```

The Power BI chords above are placeholders, not checked against the program. Icons are checked against a fixed list in Rust (`ICON_NAMES`; an unknown name is an error naming the set and the key's position, and a test keeps the page's drawn icons equal to the Rust list).

Dev mocks for stills (`?keys=typical|general|nogeneral|idle|many|one|wrong|refuse|problem|off`, `?hold=<set id or foryou>`, `?source=default`, `?arrange=ok|none|nowin|off`; what waits for For you comes from `?agents=ask`, `?meet=none` and `?net=calm`) are in `wall/src/bridge/devMocks/deck.ts`. `npm --prefix wall run fit-check` checks the deck in sparse, typical and heavy states, For you held, and the picker open.

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

## Hidden call and leave signals

`wall/src/signals/` derives call, recording and leave state without rendering it. The
native side reads the current user's Windows microphone and camera consent records every
two seconds, emits only fixed program categories, and fails closed when the registry
cannot be read. It writes fixed words to `wall2-signals.log` in the app log directory.

Development query knobs are `?call=teams|zoom|browser|none`, `?camera=1`, `?rec=1` and
`?leave=<minutes until leaving>`. They fill the hidden store only, so every screen remains
unchanged.

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
  runs "FIVE MINUTES OF ZEN" with "N:NN left.". Bottom centre while a session runs and is not ending: "Click anywhere
  to end early" at 13 px (a click outside Leave ends the session). On entry, keyboard focus starts on the chosen length. The chosen length is the
  one filled chip; keyboard focus is a separate offset ring. Leave is at least 36 px tall. Bottom right: Leave, and "After this:
  N things are waiting." from the same task feed as the Work card (hidden when it is not set
  up or empty; the "Neither is urgent." line shows only when every task has a quadrant and
  none is urgent). The feed returns at most 3 tasks, so a full list reads "3 or more things are waiting." with no urgency line; under reduced motion the ring holds still and only the word and seconds change.
- **Dream** (`Dream.tsx`). Flames dim to 35 percent, the guide is hidden, and the screen
  follows the concept: a large thin clock at left centre (about half white) with the date
  under it, a Tomorrow card at right centre (tomorrow's first meeting from the same feed and
  rules as Unwind's Tomorrow: "as of" when cached, hidden when too old, one line when the
  calendar cannot be read, absent on a clear day), and a quiet 13 px status line at bottom
  left (agents still working and whether one needs the owner, only from a fresh helper
  answer; the lights mood that is on, only when this wall set one in the last three hours).
  The hint reads "Click anywhere to wake"; moving the mouse does not wake it (the strip sits right under the main monitor, so the pointer
  wanders onto it). Nothing is bright. All the text (clock, date, card, status, hint) sits in one layer that drifts by transform alone along a
  closed 30 by 20 px path, one lap in 20 minutes, so no pixel stays lit for hours; under reduced motion it holds one of four points for 7.5 minutes, then
  jumps to the next. The status line and hint are at 40 percent, the card has no frame. Nothing else moves except Watt. Watt sleeps in the corner (the `SheepSvg` sleep pose from `buddy/Watt.tsx`,
  at x 1226, ground line 688). Dream starts when a session ends (the guide fades out
  first), or when Zen opens between 9:30 PM and 6:30 AM local time (the same window as
  Watt's sleep). A click wakes back to Zen; after a wake at night it stays awake
  until Zen is left and opened again. Leave returns to Work.
- **Horizon.** While Zen is active the horizon canvas is hidden and not drawn (no frame
  loop, no timer redraw). Leaving resumes it, gliding from the last camera.
