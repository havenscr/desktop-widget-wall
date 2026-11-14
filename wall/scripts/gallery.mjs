// The state gallery: renders every screen of Wall 2 in many data states at 2560 by 720 and
// writes PNG stills plus one `index.html` (grouped by screen, with each state's name and URL)
// and `manifest.json` into `wall/.gallery/`. For design review: judge the product from the
// pictures. States come from URL knobs read by the development mocks
// (`src/bridge/devMocks/`, `gallery.ts` for the newer ones); a production build has none.
//
//   WALL_CHROME=/path/to/chrome npm --prefix wall run gallery
//   npm --prefix wall run gallery -- --only=work        (screens or state names containing this text)
//   npm --prefix wall run gallery -- --list             (print the states, render nothing)
//
// Builds a development bundle, inlines it into one HTML file, drives headless Chromium over
// the DevTools protocol in real time (animated parts need real frames) and waits for each
// screen to settle. Prints one line per state; exits non-zero if any state fails to render
// or throws a page error. Needs no dependency beyond Node 22+ (built-in WebSocket and fetch).

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.gallery');
const W = 2560;
const H = 720;
const SETTLE_MS = 2500;
const STATE_TIMEOUT_MS = 30_000;
const PARALLEL = 3;
const TZ = 'America/Los_Angeles';

/** Times of day (Pacific, November): the sky changes behind the text. */
const TIMES = {
  morning: '2026-11-11T07:30:00-08:00',
  noon: '2026-11-11T12:30:00-08:00',
  dusk: '2026-11-11T16:55:00-08:00',
  night: '2026-11-11T22:30:00-08:00',
};
const TYPICAL_AT = '2026-11-11T10:24:00-08:00';

/** Every knob at its emptiest: nothing to show anywhere. */
const SPARSE = 'agents=0&tasks=none&meet=none&home=quiet&moods=none&media=none&usage=none&box=none';
/** Every knob at the most the screen can be asked to hold. */
const HEAVY = 'long=1&agents=ask&tasks=heavy&meet=heavy&home=many&moods=six&media=long&usage=high&box=max&focus=long';

/**
 * [screen, state name, query]. `screen` is the group in the index. `hz` and `at` freeze the
 * clock and pick the camera; `screen=` opens Meet, Zen or Dream after that.
 */
const STATES = [];
const add = (screen, name, query, custom, click) => STATES.push({ screen, name, query, custom, click });
const PLACES = {
  work: { hz: 'work' },
  home: { hz: 'home' },
  unwind: { hz: 'unwind' },
  meet: { hz: 'work', screen: 'meet' },
  zen: { hz: 'work', screen: 'zen' },
  dimmed: { hz: 'work', screen: 'dream' },
};
const url = (place, at, extra = '') => {
  const p = PLACES[place];
  // Every state uses mocked weather (no network); a state that names its own weather keeps it.
  const wx = extra.includes('weather=') ? '' : '&weather=ok';
  return `hz=${p.hz}&at=${encodeURIComponent(at)}&clock=review${wx}${p.screen ? `&screen=${p.screen}` : ''}${extra ? `&${extra}` : ''}`;
};
// `custom`: the state sets a knob beyond the base address (the time of day alone is not one).
// `dimmed` is Zen after it has dimmed (the old Dream screen): listed under Zen as "dimmed" and "dimmed: ...".
const state = (place, name, extra, at = TYPICAL_AT) => {
  const dimmed = place === 'dimmed';
  add(dimmed ? 'zen' : place, dimmed ? (name === 'typical' && extra === '' && at === TYPICAL_AT ? 'dimmed' : `dimmed: ${name}`) : name, url(place, at, extra), extra !== '');
};

for (const place of Object.keys(PLACES)) {
  state(place, 'sparse', SPARSE);
  state(place, 'typical', '');
  state(place, 'heavy', HEAVY);
  for (const [t, at] of Object.entries(TIMES)) state(place, `typical, ${t}`, '', at);
}

// Work: layout rules that change, and each data source down on its own.
for (const n of ['2', '1']) state('work', `${n} agent lane${n === '1' ? '' : 's'}`, `agents=${n}`);
state('work', 'one agent waiting', 'agents=ask');
state('work', 'long strings (fit check set)', 'long=1');
state('work', 'focus running, long title', 'focus=long');
state('work', 'music paused', 'media=paused');
// left wing: PC temperature, previous and next, the round focus ring, keyboard focus
state('work', 'left wing: playing with temps', '');
state('work', 'left wing: no pc temp', 'pctemp=none&box=stale');
state('work', 'left wing: long title', 'media=long');
state('work', 'left wing: focus running', 'focus=run');
state('work', 'left wing: focus done', 'focus=done');
add('work', 'left wing: keyboard focus on the ring', url('work', TYPICAL_AT, 'focus=done'), true, 'kbd:.focus-mini-ring');
add('work', 'left wing: keyboard focus on a button', url('work', TYPICAL_AT, 'focus=done'), true, 'kbd:.music-mini-btns .rd:nth-child(3)');
state('work', 'left wing: LLM no reading', 'box=none');
// The ridgelines rest in every other still (a review frame shows them at rest); these two have music driving them.
state('work', 'audio demo (lines follow the music)', 'audio=demo');
state('home', 'audio demo (lines follow the music)', 'audio=demo');
state('unwind', 'nine moods, long labels', HEAVY.replace('moods=six', 'moods=nine'));
state('work', 'tasks few', 'tasks=few');
state('work', 'tasks heavy (115 more)', 'tasks=heavy');
state('work', 'usage meters near full', 'usage=high');
state('work', 'machine numbers at the limit', 'box=max');
state('work', 'box numbers stale', 'box=stale');
state('work', 'box offline', 'box=none');
for (const [name, extra] of [
  ['broken: helper not set up', 'agents=off'],
  ['broken: helper not answering', 'agents=down'],
  ['broken: helper numbers stale', 'agents=stale'],
  ['broken: task app not set up', 'tasks=off'],
  ['broken: task app down', 'tasks=down'],
  ['broken: calendar not set up', 'meet=off'],
  ['broken: calendar read fails', 'meet=failing'],
  ['broken: calendar signed out', 'meet=signedout'],
  ['broken: calendar partly stale', 'meet=partial'],
  ['broken: media unavailable', 'media=off'],
  ['broken: weather down', 'weather=down&agents=0'],
  ['broken: weather stale', 'weather=stale&agents=0'],
]) {
  // Work shows the weather card (and its status) in the centre only when no agent lane is using it.
  state('work', name, extra);
}

// Home: the network card's numbers, moods, chores.
// The numbers row needs three numbers; with one or two they go on the status line instead.
for (const n of ['1', '2', '3']) state('home', `network card, ${n} number${n === '1' ? '' : 's'}`, `net=${n}`);
state('home', 'network card, 4 numbers', 'net=4');
state('home', 'network card, quiet', 'home=quiet');
state('home', 'moods six', 'moods=six');
state('home', 'moods none', 'moods=none');
state('home', 'tasks heavy (115 more)', 'tasks=heavy');
state('home', 'tasks few', 'tasks=few');
// Sound: the five quick plays and three places in each data state; Sonos silent shows the
// fallback after its 2.5 second wait.
state('home', 'sound heavy: long names, many speakers', 'sonos=heavy&moods=many');
state('home', 'sound sparse: one routine, one speaker', 'sonos=sparse');
state('home', 'sound few: one matching routine plus More', 'sonos=few');
state('home', 'sound quiet: nothing playing', 'sonos=quiet');
state('home', 'sound down', 'sonos=down');
state('home', 'sound not set up', 'sonos=off');
state('home', 'sound silent (fallback after 2.5 seconds)', 'sonos=slow');
for (const [name, extra] of [
  ['broken: home app not set up', 'home=off'],
  ['broken: home app down', 'home=down'],
  ['broken: moods failing', 'moods=down'],
  ['broken: task app not set up', 'tasks=off'],
  ['broken: task app down', 'tasks=down'],
  ['broken: weather down', 'weather=down'],
  ['broken: weather stale', 'weather=stale'],
]) {
  state('home', name, extra);
}
state('home', 'morning camera', '', TIMES.morning);
state('home', 'morning camera, sparse', SPARSE, TIMES.morning);

// The network alarm outside Home: the rail dot and one chip on Work and Unwind, never from a down source.
state('work', 'network alarm: rail dot and chip', 'net=4');
state('unwind', 'network alarm: chip in the status line', 'net=4');
state('work', 'network alarm: home app down, nothing shown', 'home=down');
// A task tick waits five seconds with Undo (the still is taken just after the click).
add('work', 'task ticked: Done with Undo', url('work', TYPICAL_AT, 'tasks=few'), true, '.tasks .task-check');
add('home', 'chore ticked: Done with Undo', url('home', TYPICAL_AT, 'tasks=few'), true, '.chores .ck');
// Focus shown once: the centre's Focus card, and no small Focus row in the left wing.
state('work', 'focus shown once (no agents)', 'agents=0&focus=long');
// The key deck: the built-in sets, twelve pages, labels without their group name, a set not in front.
state('work', 'deck: library sets, VS Code held', 'keys=library&hold=lib-vscode');
state('work', 'deck: library set whose app is not in front', 'keys=library&hold=lib-excel');
state('work', 'deck: longest labels pinned', 'keys=library&pins=long');
// The key picker open with the whole library: down to just above the timeline, over the mountains.
add('work', 'deck: key picker open, whole library', url('work', TYPICAL_AT, 'keys=library'), true, 'ctx:.pin-tile');
// Watt: his menu (a right-click on him) on each place, at night (tricks wait while he sleeps), and set
// down far from his old walk (`wattspot`, his stored spot), Unwind on both stretches and on Watch.
add('work', 'Watt: menu open', url('work', TYPICAL_AT, 'meet=none'), true, 'ctx:.watt-hit');
add('home', 'Watt: menu open', url('home', TYPICAL_AT, 'moods=five'), true, 'ctx:.watt-hit');
add('unwind', 'Watt: menu open', url('unwind', TYPICAL_AT, ''), true, 'ctx:.watt-hit');
add('unwind', 'Watt: menu at night, tricks wait', url('unwind', TIMES.night, ''), true, 'ctx:.watt-hit');
add('work', 'Watt: menu open, agent waiting (mark beside him)', url('work', TYPICAL_AT, 'agents=ask&meet=none'), true, 'ctx:.watt-hit');
state('work', 'Watt: set down far right', 'wattspot=2300');
state('work', 'Watt: set down far left', 'wattspot=200');
state('home', 'Watt: set down left of the moods', 'wattspot=400');
state('meet', 'Watt: set down under Accounts', 'wattspot=2200');
state('unwind', 'Watt: set down past the transport row', 'wattspot=1700');
state('unwind', 'Watt: set down left by the clock', 'wattspot=180');
// The leave banner in Home's band above the ribbon: he steps aside to the free ground.
add('home', 'Watt: leave banner, he steps aside', url('home', TYPICAL_AT, 'leave=12'), true);
// While the wall records he sits quietly where he is (the recording chip says why).
add('work', 'Watt: recording, he sits quietly', url('work', TYPICAL_AT, 'rec=1&meet=none'), true);
state('unwind', 'Watt: on Watch, kept off the video', 'wattspot=1700&watch=mock&wlist=three&wlook=feather&wplay=0', TIMES.night);
// The agents header with twelve sessions, two waiting and an alarm: one line.
state('work', 'agents header: twelve sessions, two waiting, an alarm', 'agents=12ask');
// The calm strip (Work): overlapping meetings folded into one chip, one agents line, the Day
// drawer from the handle, and the Agents today panel with its day picker.
state('work', 'bottom: overlaps and twelve', 'meet=overlap&agents=12ask');
state('work', 'bottom: normal', '');
add('work', 'bottom: overlap hover', url('work', TYPICAL_AT, 'meet=overlap&agents=3'), true, 'hover:.rib .ev.fold');
add('work', 'bottom: day drawer', url('work', TYPICAL_AT, 'meet=overlap&agents=12ask'), true, '.rib .rib-handle');
add('work', 'agents today: today', url('work', TYPICAL_AT, 'agents=7ask&days=typical'), true, '.rib .ag-line');
add('work', 'agents today: yesterday', url('work', TYPICAL_AT, 'agents=7ask&days=typical'), true, '.rib .ag-line >> .at-seg button:nth-child(2)');
add('work', 'agents today: heavy day', url('work', TYPICAL_AT, 'agents=12&days=heavy&long=1'), true, '.rib .ag-line >> .at-seg button:nth-child(2)');
add('work', 'agents today: empty day', url('work', TYPICAL_AT, 'agents=3&days=empty'), true, '.rib .ag-line >> .at-seg button:nth-child(2)');
add('work', 'agents today: record absent', url('work', TYPICAL_AT, 'agents=3&days=absent'), true, '.rib .ag-line');
add('work', 'agents today: helper down', url('work', TYPICAL_AT, 'agents=12staleask&days=down'), true, '.rib .ag-line');

// Timeline rows that say they are empty (only when that is known).
state('work', 'timeline: no meetings today', 'meet=none');
state('dimmed', 'one agent waiting', 'agents=ask', TIMES.night);
state('dimmed', 'broken: calendar not available', 'meet=down', TIMES.night);
state('work', 'timeline: calendar not available', 'meet=signedout');
state('work', 'timeline: both accounts failing', 'meet=down');
state('work', 'timeline: one account failing', 'meet=mixed');
state('work', 'timeline: no agent activity yet', 'agents=0&tasks=none&meet=none&day=empty');
state('home', 'timeline: nothing scheduled at home', 'tasks=none');

// Unwind: the status chips, now playing, calendar tomorrow, the room card.
state('unwind', 'status chips, nothing waiting', 'agents=3');
state('unwind', 'status chips, sessions waiting', 'agents=ask');
state('unwind', 'status chips, none running', 'agents=0');
state('unwind', 'status chips, helper not set up', 'agents=off');
state('unwind', 'status chips, focus on', 'focus=long');
state('unwind', 'music paused', 'media=paused');
state('unwind', 'long track and artist', 'media=long');
state('unwind', 'audio demo (levels moving)', 'audio=demo');
for (const [name, extra] of [
  ['broken: media unavailable', 'media=off'],
  ['broken: calendar not set up', 'meet=off'],
  ['broken: calendar read fails', 'meet=failing'],
  ['broken: task app down', 'tasks=down'],
  ['broken: weather down', 'weather=down'],
]) {
  state('unwind', name, extra);
}

// Unwind, Watch tab (`?watch=mock` draws a poster where the player frame goes): the list
// empty, three and 24 saved; each look playing; the settings sheet both ways; Listen's Video corner.
const WM = 'watch=mock';
state('unwind', 'watch: nothing saved', `${WM}&wlist=none`, TIMES.night);
state('unwind', 'watch: three saved, nothing on', `${WM}&wlist=three`, TIMES.night);
state('unwind', 'watch: feathered, video playing', `${WM}&wlist=three&wlook=feather&wplay=0`, TIMES.night);
state('unwind', 'watch: drive-in, Twitch playing', `${WM}&wlist=three&wlook=drivein&wplay=2`, TIMES.night);
state('unwind', 'watch: 24 saved, drive-in, long label', `${WM}&wlist=many&wlook=drivein&wplay=3`, TIMES.night);
state('unwind', 'watch: feathered at noon', `${WM}&wlist=three&wlook=feather&wplay=1`, TIMES.noon);
state('unwind', 'watch: settings, one look', `${WM}&wlist=three&wlook=drivein&wplay=0&wsheet=one`, TIMES.night);
state('unwind', 'watch: settings, a look per kind', `${WM}&wlist=many&wplay=2&wsheet=kind`, TIMES.night);
state('unwind', 'watch: listen with the Video corner', `${WM}&wlist=three&wtab=listen`, TIMES.night);
state('unwind', 'watch: sparse data, three saved', `${SPARSE}&${WM}&wlist=three&wlook=feather&wplay=0`, TIMES.night);
// Part 2a: the whole sky and the sun, at night and at noon, with 24 saved, and in the sheet.
state('unwind', 'watch: whole sky, video playing', `${WM}&wlist=three&wlook=sky&wplay=0`, TIMES.night);
state('unwind', 'watch: whole sky, bright test picture at noon', `${WM}&wlist=three&wlook=sky&wplay=0&wposter=bright`, TIMES.noon);
state('unwind', 'watch: whole sky at noon', `${WM}&wlist=three&wlook=sky&wplay=1`, TIMES.noon);
state('unwind', 'watch: whole sky, 24 saved, long label', `${WM}&wlist=many&wlook=sky&wplay=3`, TIMES.night);
state('unwind', 'watch: sun, video playing', `${WM}&wlist=three&wlook=sun&wplay=0`, TIMES.night);
state('unwind', 'watch: sun at noon', `${WM}&wlist=three&wlook=sun&wplay=1`, TIMES.noon);
state('unwind', 'watch: sun at dusk', `${WM}&wlist=three&wlook=sun&wplay=0`, TIMES.dusk);
state('unwind', 'watch: whole sky at dusk', `${WM}&wlist=three&wlook=sky&wplay=0`, TIMES.dusk);
state('unwind', 'watch: sun, 24 saved, Twitch', `${WM}&wlist=many&wlook=sun&wplay=2`, TIMES.night);
state('unwind', 'watch: settings, four looks, whole sky chosen', `${WM}&wlist=three&wlook=sky&wplay=0&wsheet=one`, TIMES.night);
state('unwind', 'watch: settings, four looks per kind', `${WM}&wlist=many&wlook=sun&wplay=0&wsheet=kind`, TIMES.night);
// watch polish: the wall's own control row and the fixed Look switch in every look, with a mock
// player (`wstate`): a single video, a playlist, paused, autoplay refused, Twitch, nothing reported.
state('unwind', 'watch polish: drive-in, single video', `${WM}&wlist=three&wlook=drivein&wplay=0`, TIMES.night);
state('unwind', 'watch polish: drive-in at noon', `${WM}&wlist=three&wlook=drivein&wplay=0`, TIMES.noon);
state('unwind', 'watch polish: drive-in, paused', `${WM}&wlist=three&wlook=drivein&wplay=0&wstate=paused`, TIMES.night);
state('unwind', 'watch polish: feathered, playlist', `${WM}&wlist=many&wlook=feather&wplay=3`, TIMES.night);
state('unwind', 'watch polish: feathered, autoplay refused', `${WM}&wlist=three&wlook=feather&wplay=0&wstate=refused`, TIMES.night);
state('unwind', 'watch polish: whole sky, playlist', `${WM}&wlist=many&wlook=sky&wplay=3`, TIMES.night);
state('unwind', 'watch polish: whole sky, Twitch', `${WM}&wlist=three&wlook=sky&wplay=2`, TIMES.night);
state('unwind', 'watch polish: sun, playlist', `${WM}&wlist=many&wlook=sun&wplay=3`, TIMES.night);
state('unwind', 'watch polish: sun, nothing reported yet', `${WM}&wlist=three&wlook=sun&wplay=0&wstate=silent`, TIMES.night);
state('unwind', 'watch polish: whole sky, autoplay refused', `${WM}&wlist=three&wlook=sky&wplay=0&wstate=refused`, TIMES.night);
state('unwind', 'watch polish: Twitch not started hint, drive-in', `${WM}&wlist=three&wlook=drivein&wplay=2&wstate=refused`, TIMES.night);
state('unwind', 'watch polish: leave banner over the drive-in', `${WM}&wlist=three&wlook=drivein&wplay=0&leave=12`, TIMES.night);
state('unwind', 'watch polish: nothing on, whole sky chosen', `${WM}&wlist=three&wlook=sky`, TIMES.night);
// sky layers: the video behind the land (the horizon's front canvas) in the whole sky and the sun at
// night and at noon, the drive-in and feathered looks at night with no moon behind them, and the
// moon in its open-sky place on Listen and on Watch with nothing on.
state('unwind', 'sky layers: whole sky at night', `${WM}&wlist=three&wlook=sky&wplay=0`, TIMES.night);
state('unwind', 'sky layers: whole sky at noon', `${WM}&wlist=three&wlook=sky&wplay=1`, TIMES.noon);
state('unwind', 'sky layers: the sun at night', `${WM}&wlist=three&wlook=sun&wplay=0`, TIMES.night);
state('unwind', 'sky layers: the sun at noon', `${WM}&wlist=three&wlook=sun&wplay=1`, TIMES.noon);
state('unwind', 'sky layers: drive-in at night, no moon', `${WM}&wlist=three&wlook=drivein&wplay=2`, TIMES.night);
state('unwind', 'sky layers: feathered at night, no moon', `${WM}&wlist=three&wlook=feather&wplay=0`, TIMES.night);
state('unwind', 'sky layers: Listen at night, the moon in open sky', 'weather=ok', TIMES.night);
state('unwind', 'sky layers: Watch, nothing on, at night, the moon in open sky', `${WM}&wlist=three&wlook=feather`, TIMES.night);

// The Tools drawer: opened on load (`tools=1`), over each place and in its hard states.
state('work', 'tools: open', 'tools=1');
state('work', 'tools: account signed out', 'meet=signedout&tools=1');
state('work', 'tools: sources failing', 'agents=down&weather=stale&tools=1');
state('work', 'tools: keys refused', 'keys=refused&tools=1');
state('work', 'tools: no keys file', 'source=default&tools=1');
state('work', 'tools: Spotify not set up', 'spotify=off&tools=1');
state('home', 'tools: open', 'tools=1');
state('unwind', 'tools: open', 'tools=1');
state('meet', 'tools: open', 'tools=1');

// Meet: the day's meetings.
state('meet', 'both accounts ok', 'meet=bothok');
state('meet', 'one meeting', 'meet=one');
state('meet', 'broken: one account stale', 'meet=partial');
for (const [name, extra] of [
  ['broken: both accounts failing', 'meet=down'],
  ['broken: one account failing', 'meet=mixed'],
  ['broken: calendar not set up', 'meet=off'],
  ['broken: calendar read fails', 'meet=failing'],
  ['broken: calendar signed out', 'meet=signedout'],
]) {
  state('meet', name, extra);
}

// Zen: the focus ring, and the dimmed view it falls into.
state('zen', 'focus running, long title', 'focus=long');
// Zen in the evening with the dim hint, and late at night but not yet quiet (so still bright).
state('zen', 'evening hint', '', '2026-11-11T20:15:00-08:00');
state('zen', 'late, not yet quiet', '', '2026-11-11T23:40:00-08:00');
state('dimmed', 'night with audio demo', 'audio=demo', TIMES.night);

// keys style: keys tinted by kind by day and night, keys that cannot be sent, For you as two
// key-height plates, long labels, a key under the pointer and one held down, and the Hide
// screen button grown under the pointer. `hover:` moves the pointer onto an element, `press:`
// also holds the button down there, `focus:` gives it keyboard focus; a list of steps runs in order.
const KS_DAY = '2026-11-11T12:10:00-08:00';
add('work', 'keys style: day', url('work', KS_DAY, 'keys=library&hold=lib-vscode'), true);
add('work', 'keys style: general set', url('work', KS_DAY, 'keys=general&hold=general'), true);
add('work', 'keys style: night', url('work', TIMES.night, 'keys=library&hold=lib-vscode'), true);
add('work', 'keys style: unavailable', url('work', KS_DAY, 'keys=library&hold=lib-excel'), true);
add('work', 'keys style: unavailable at night', url('work', TIMES.night, 'keys=library&hold=lib-excel'), true);
add('work', 'keys style: for you two', url('work', KS_DAY, 'agents=ask&keys=typical&hold=foryou&meet=none&net=calm'), true);
add('work', 'keys style: for you one', url('work', KS_DAY, 'agents=3&keys=typical&hold=foryou&meet=none'), true);
add('work', 'keys style: for you three, long titles', url('work', KS_DAY, 'long=1&agents=ask&keys=typical&hold=foryou'), true);
add('work', 'keys style: long labels', url('work', KS_DAY, 'keys=library&hold=lib-vscode&pins=long'), true);
add('work', 'keys style: hover and pressed', url('work', KS_DAY, 'keys=library&hold=lib-vscode'), true, ['.pin-tile[aria-label="Thirds"]', 'hover:.pin-tile[aria-label="Snip"]']);
add('work', 'keys style: pressed', url('work', KS_DAY, 'keys=library&hold=lib-vscode'), true, ['.pin-tile[aria-label="Thirds"]', 'press:.keys .key-tile[aria-label="VS Code: terminal"]']);
// leave and recording: the leave-soon banner over every place (cyan at rest, amber at 5 minutes, "Leave now"),
// and recording mode (the chip in the Agents header or the top band, the Recording keys in the Now row).
add('work', 'leave: 12 min', url('work', TYPICAL_AT, 'leave=12'), true);
add('work', 'leave: amber', url('work', TYPICAL_AT, 'leave=4'), true);
add('work', 'leave: now', url('work', TYPICAL_AT, 'leave=0'), true);
add('work', 'leave: long title', url('work', TYPICAL_AT, 'leave=12&long=1'), true);
add('work', 'leave: heavy data', url('work', TYPICAL_AT, `${HEAVY}&leave=4`), true);
add('work', 'leave: Day drawer open', url('work', TYPICAL_AT, 'meet=overlap&agents=12ask&leave=12&rec=1'), true, '.rib .rib-handle');
add('work', 'leave: feed stale, nothing shown', url('work', TYPICAL_AT, 'leave=4&meet=partial'), true);
add('home', 'leave: on home', url('home', TYPICAL_AT, 'leave=12'), true);
add('unwind', 'leave: on unwind', url('unwind', TYPICAL_AT, 'leave=4'), true);
add('meet', 'leave: on meet', url('meet', TYPICAL_AT, 'leave=12'), true);
add('zen', 'leave: none on zen', url('zen', TYPICAL_AT, 'leave=4'), true);
add('work', 'recording: work', url('work', TYPICAL_AT, 'rec=1'), true);
add('work', 'recording: with leave', url('work', TYPICAL_AT, 'rec=1&leave=4'), true);
add('work', 'recording: agents header, heavy data', url('work', TYPICAL_AT, `${HEAVY}&rec=1`), true);
add('work', 'recording: helper down', url('work', TYPICAL_AT, 'rec=1&agents=down'), true);
add('work', 'recording: Hold on another set', url('work', TYPICAL_AT, 'rec=1&keys=library&hold=lib-vscode'), true);
add('home', 'recording: home', url('home', TYPICAL_AT, 'rec=1'), true);
add('unwind', 'recording: unwind', url('unwind', TYPICAL_AT, 'rec=1'), true);
add('meet', 'recording: meet', url('meet', TYPICAL_AT, 'rec=1'), true);
add('zen', 'recording: none on zen', url('zen', TYPICAL_AT, 'rec=1'), true);
add('unwind', 'unwind: hide screen at rest', url('unwind', TYPICAL_AT), true);
add('unwind', 'unwind: hide screen hover', url('unwind', TYPICAL_AT), true, 'hover:.screens-off');
// The failure note ("Could not watch input", `hide=fail`) after a click, with the pointer still on the pill, and with keyboard focus.
add('unwind', 'unwind: hide screen note while hovered', url('unwind', TYPICAL_AT, 'hide=fail'), true, ['.screens-off', 'hover:.screens-off']);
add('unwind', 'unwind: hide screen note while focused', url('unwind', TYPICAL_AT, 'hide=fail'), true, ['.screens-off', 'focus:.screens-off']);

/**
 * What each state must show, so a knob that silently stops working fails the run:
 * [screen, state name (prefix; exact when the 4th item is true), what to find]. "What to find" is
 * a string or a list of strings; each must be in the page text, and one starting with "!" must
 * not be. First match wins. Page text is `textContent`, so words keep their written case and
 * adjacent elements run together ("412blocked").
 */
const EXPECT = [
  // Watt's menu: its groups and items (at night the tricks wait and the menu says why).
  ['work', 'Watt: menu open', ['Tricks', 'Come here', 'Read with me, 25 min']],
  ['home', 'Watt: menu open', ['Tricks', 'Stay here', 'Talks']],
  ['unwind', 'Watt: menu open', ['Tricks', 'Together', 'Wears']],
  ['unwind', 'Watt: menu at night', ['Watt is asleep', 'Tricks']],
  ['home', 'Watt: leave banner, he steps aside', ['Leave in 12 min.']],
  ['work', 'Watt: recording, he sits quietly', ['Now \u00b7 Recording', 'Recording00:']],
  // Work
  ['work', 'sparse', ['Nothing due', 'All slots free']],
  ['work', 'heavy', ['115 more can wait', 'Architecture working', 'Draft the workshop outline']],
  ['work', '2 agent lanes', ['Friday social card', '!Admin pill polish']],
  ['work', '1 agent lane', ['Admin pill polish', 'Free slot']],
  ['work', 'one agent waiting', 'Which of the four thumbnails goes on the Friday post?'],
  ['work', 'long strings', 'Voice mode: iPhone microphone permission fix'],
  ['work', 'focus running, long title', 'Draft the workshop outline'],
  ['work', 'tasks few', ['Review the dashboard draft', '!Order printer paper']],
  ['work', 'tasks heavy', '115 more can wait'],
  ['work', 'usage meters near full', ['Claude 5 h 97%', '94%']],
  ['work', 'left wing: playing with temps', ['TEMP', '61°', '52°']],
  ['work', 'left wing: no pc temp', ['TEMP', '\u2013']],
  ['work', 'left wing: long title', 'An Extremely Long Song Title'],
  ['work', 'left wing: focus running', 'Review the draft'],
  ['work', 'left wing: focus done', 'Focus done'],
  ['work', 'left wing: keyboard focus', 'Focus done'],
  ['work', 'left wing: LLM no reading', ['LLM', 'no reading']],
  ['work', 'machine numbers at the limit', '104'],
  ['work', 'box offline', 'no reading'],
  ['work', 'broken: helper not set up', 'not set up'],
  ['work', 'broken: helper not answering', ['not reachable', 'Try again']],
  ['work', 'broken: helper numbers stale', 'may be out of date'],
  ['work', 'broken: task app not set up', 'Next threeNot set up'],
  ['work', 'broken: task app down', 'Tasks unavailable'],
  ['work', 'broken: calendar not set up', '!Design review with the platform team'],
  ['work', 'broken: calendar read fails', 'Calendar not available'],
  ['work', 'broken: calendar signed out', 'Calendar not available'],
  ['work', 'broken: calendar partly stale', 'may be out of date'],
  ['work', 'broken: media unavailable', 'Nothing playing'],
  ['work', 'broken: weather down', 'Weather unavailable'],
  ['work', 'broken: weather stale', ['updated 45 min ago', '!Weather unavailable']],
  ['work', 'timeline: no meetings today', 'No meetings today'],
  ['work', 'timeline: calendar not available', 'Calendar not available'],
  ['work', 'timeline: both accounts failing', 'Calendar not available'],
  ['work', 'timeline: one account failing', ['Design review with the platform team', '!Calendar not available']],
  ['work', 'timeline: no agent activity yet', 'No agent activity yet'],
  ['work', 'typical', 'Voice: iPhone mic fix'],
  ['work', 'network alarm: rail dot and chip', '4 network alerts'],
  ['work', 'network alarm: home app down', '!network alert'],
  ['work', 'task ticked', ['Done.', 'Undo']],
  ['work', 'focus shown once', ['Draft the workshop outline', '!Focus, paused']],
  ['work', 'deck: library sets, VS Code held', ['Command palette', '!VS Code: command palette']],
  ['work', 'deck: library set whose app is not in front', ['Repeat last action', '!Excel: repeat']],
  ['work', 'deck: longest labels pinned', 'Sonos: play what suits the hour'],
  ['work', 'deck: key picker open', ['Reset to defaults', 'Anywhere on the PC']],
  ['work', 'agents header: twelve sessions', 'One thing for you'],
  // Home
  ['home', 'sparse', ['No moods set up', 'No meetings today']],
  ['home', 'heavy', ['Away For The Weekend', '115 more can wait']],
  ['home', 'network card, 1 number', ['3 alarms in 24 h', '!31 devices']],
  ['home', 'network card, 2 numbers', '31 devices, 3 alarms in 24 h'],
  ['home', 'network card, 3 numbers', ['412blocked', '!61°box']],
  ['home', 'network card, 4 numbers', '61°box'],
  ['home', 'network card, quiet', ['All quiet', '0alarms, 24h']],
  ['home', 'moods six', ['Deep Focus', 'Movie Night']],
  ['home', 'moods none', 'No moods set up'],
  ['home', 'tasks heavy', '115 more can wait'],
  ['home', 'tasks few', ['Review the dashboard draft', '!Order printer paper']],
  ['home', 'sound heavy: long names, many speakers', ['Late night', 'Workday']],
  ['home', 'sound sparse: one routine, one speaker', 'Sound'],
  ['home', 'sound few: one matching routine plus More', 'More'],
  ['home', 'sound quiet: nothing playing', 'Nothing playing'],
  ['home', 'sound down', 'The Sonos service did not answer'],
  ['home', 'sound not set up', 'Add sonosBaseUrl to feeds.json'],
  ['home', 'sound silent (fallback after 2.5 seconds)', 'Sound'],
  ['home', 'broken: home app not set up', 'Network and securityNot set up'],
  ['home', 'broken: home app down', 'Home app not reachable'],
  ['home', 'broken: moods failing', 'MoodsHome app not reachable'],
  ['home', 'broken: task app not set up', 'Around the houseNot set up'],
  ['home', 'broken: task app down', 'Task app not reachable'],
  ['home', 'timeline: nothing scheduled at home', 'Nothing scheduled at home'],
  ['home', 'morning camera, sparse', ['No moods set up', 'No meetings today']],
  ['home', 'typical', ['Evening', 'Alarms', 'Open Firewalla']],
  ['home', 'chore ticked', ['Done.', 'Undo']],
  // Unwind
  ['unwind', 'sparse', ['Nothing playing', 'Quiet']],
  ['unwind', 'heavy', ['An Extremely Long Song Title', 'Away For The Weekend']],
  ['unwind', 'status chips, nothing waiting', ['2 agents still running', 'No agent needs you']],
  ['unwind', 'status chips, sessions waiting', 'One thing needs you.'],
  ['unwind', 'status chips, none running', ['No agent needs you', '!still running']],
  ['unwind', 'status chips, helper not set up', ['Work is put away', '!No agent needs you', '!still running']],
  ['unwind', 'status chips, focus on', 'Focus is still on'],
  ['unwind', 'music paused', '1:03'],
  ['unwind', 'long track', 'An Extremely Long Song Title'],
  ['unwind', 'broken: media unavailable', 'Nothing playing'],
  ['unwind', 'nine moods, long labels', ['More', '!Away For The Weekend']],
  ['unwind', 'broken: calendar not set up', '!First thing'],
  ['unwind', 'broken: calendar read fails', '!First thing'],
  ['unwind', 'broken: task app down', 'First thing: Planning check-in at 9:30'],
  ['unwind', 'broken: weather down', ['Wednesday morning', '!58°']],
  ['unwind', 'typical', ['Tokyo Burnout', 'Lights']],
  ['unwind', 'network alarm', '4 network alerts.'],
  ['unwind', 'watch: nothing saved', ['Nothing on', 'Paste a YouTube or Twitch link', '!saved']],
  ['unwind', 'watch: three saved, nothing on', ['Nothing on', 'Play Night drive mix', '3 saved']],
  ['unwind', 'watch: feathered', ['Feathered', 'Open in YouTube', 'Lofi beats radio']],
  ['unwind', 'watch: drive-in, Twitch', ['Drive-in', 'Open on Twitch', 'Twitch channel', 'Live on the wall']],
  ['unwind', 'watch: 24 saved', ['24 saved', 'Saved for the weekend, a very long playlist name', 'YouTube playlist']],
  ['unwind', 'watch: settings, one look', ['How video is shown', 'One look for everything', 'Feathered']],
  ['unwind', 'watch: settings, a look per kind', ['Videos and playlists', 'Live streams', 'Saved here: 19 YouTube, 5 Twitch']],
  ['unwind', 'watch: listen with the Video corner', ['Video', 'Tokyo Burnout', '!Nothing on']],
  ['unwind', 'watch: sparse data', ['Night drive mix', 'Open in YouTube']],
  ['unwind', 'watch: whole sky, 24', ['Whole sky', '24 saved', 'Saved for the weekend', '12:34']],
  ['unwind', 'watch: whole sky', ['Whole sky', 'Open in YouTube']],
  ['unwind', 'watch: sun, 24 saved, Twitch', ['The sun', '24 saved', 'Live on the wall', 'Open on Twitch']],
  ['unwind', 'watch: sun', ['The sun', 'Open in YouTube']],
  ['unwind', 'watch: settings, four looks, whole sky', ['How video is shown', 'Whole sky', 'The sun', 'Drive-in']],
  ['unwind', 'watch: settings, four looks per kind', ['Videos and playlists', 'Live streams', 'The sun']],
  // watch polish
  ['unwind', 'watch polish: drive-in, paused', ['Paused', '12:34', '45:10', 'Open in YouTube']],
  ['unwind', 'watch polish: drive-in', ['Playing on the wall', '12:34', '45:10', 'Open in YouTube', '!Not playing? Open in browser']],
  ['unwind', 'watch polish: feathered, playlist', ['YouTube playlist', '12:34', 'Open in YouTube']],
  ['unwind', 'watch polish: feathered, autoplay refused', ['Click the video to start', '!12:34']],
  ['unwind', 'watch polish: whole sky, playlist', ['12:34', 'Whole sky']],
  ['unwind', 'watch polish: whole sky, Twitch', ['Open on Twitch', '!12:34']],
  ['unwind', 'watch polish: sun, playlist', ['12:34', 'The sun']],
  ['unwind', 'watch polish: sun, nothing reported yet', ['Playing on the wall', '!12:34', 'Open in YouTube']],
  ['unwind', 'watch polish: leave banner', ['Open in YouTube', 'Drive-in']],
  ['unwind', 'watch polish: nothing on', ['Nothing on', 'Whole sky', 'Drive-in']],
  ['unwind', 'watch polish: whole sky, autoplay refused', ['Click the video to start', 'Waiting for a click on the video']],
  ['unwind', 'watch polish: Twitch not started hint, drive-in', ['Not started? Click the video', 'Live on the wall', 'Open on Twitch']],
  // sky layers
  ['unwind', 'sky layers: whole sky', ['Whole sky', 'Playing on the wall']],
  ['unwind', 'sky layers: the sun', ['The sun', 'Playing on the wall']],
  ['unwind', 'sky layers: drive-in', ['Drive-in', 'Open on Twitch']],
  ['unwind', 'sky layers: feathered', ['Feathered', 'Playing on the wall']],
  ['unwind', 'sky layers: Listen', ['Tokyo Burnout', '!Nothing on']],
  ['unwind', 'sky layers: Watch, nothing on', ['Nothing on', 'Feathered']],
  // Meet
  ['meet', 'sparse', 'Nothing scheduled in the next 24 hours'],
  ['meet', 'heavy', 'Architecture working session'],
  ['meet', 'both accounts ok', ['Design review', '!Open Tools', '!Sign in']],
  ['meet', 'one meeting', 'Design review with the platform team'],
  ['meet', 'broken: one account stale', ['Design review with the platform team', 'Second calendar not answering.']],
  ['meet', 'broken: both accounts failing', ['Calendar not available', '2 calendars need attention.', 'Open Tools']],
  ['meet', 'broken: one account failing', ['Second calendar not answering.', 'Open Tools']],
  ['meet', 'broken: calendar signed out', ['Calendar not available', '2 calendars need attention.', 'Open Tools']],
  ['meet', 'broken: calendar not set up', 'Calendar is not connected yet'],
  ['meet', 'broken: calendar read fails', 'Calendar unavailable'],
  ['meet', 'typical', ['Design review with the platform team', 'Second calendar signed out.', 'Open Tools', 'Weekly planning']],
  ['meet', 'tools: open', ['Open Tools', 'Keys file', 'Second calendar']],
  // The Tools drawer, over each place and in each hard state
  ['work', 'tools: open', ['Accounts', 'Sources', 'Video look', 'Keys file', 'Build 7c9f442']],
  ['work', 'tools: account signed out', ['Work calendar', 'Second calendar', 'Signed out', 'Sign in']],
  ['work', 'tools: sources failing', ['Sources', 'never']],
  ['work', 'tools: keys refused', 'keys.json refused: app 3, key 7'],
  ['work', 'tools: no keys file', 'No keys.json. Defaults in use'],
  ['work', 'tools: Spotify not set up', ['Spotify', 'Not set up']],
  ['home', 'tools: open', ['Accounts', 'Keys file']],
  ['unwind', 'tools: open', ['Accounts', 'Keys file']],
  // Zen and Dream
  ['zen', 'sparse', ['Breathe in', '!things are waiting']],
  ['zen', 'heavy', 'After this: 3 or more things are waiting'],
  ['zen', 'typical', 'Start', true],
  ['zen', 'evening hint', ['Breathe in', 'Dims by itself after 10 PM and 10 quiet minutes']],
  ['zen', 'late, not yet quiet', ['Breathe in', 'Dims by itself after 10 PM and 10 quiet minutes']],
  ['zen', 'dimmed: sparse', '!Breathe in'],
  ['zen', 'dimmed: heavy', '!Breathe in'],
  ['zen', 'dimmed: night with audio demo', '!Breathe in'],
  ['zen', 'dimmed: one agent waiting', 'Click anywhere to wake'],
  ['zen', 'dimmed: broken: calendar not available', 'Calendar not available'],
  // keys style
  ['work', 'keys style: day', ['Command palette', 'Always here']],
  ['work', 'keys style: general set', 'Now · General'],
  ['work', 'keys style: night', 'Command palette'],
  ['work', 'keys style: unavailable', 'Repeat last action'],
  ['work', 'keys style: for you', 'Now · For you'],
  ['work', 'keys style: long labels', 'Sonos: play what suits the hour'],
  ['work', 'keys style: hover and pressed', 'windows arranged'],
  ['work', 'keys style: pressed', 'windows arranged'],
  // leave and recording
  ['work', 'leave: 12 min', ['Leave in 12 min.', "Doctor's appointment starts", 'turns amber at 5 minutes', '!Dismiss']],
  ['work', 'leave: amber', ['Leave in 4 min.', 'Dismiss', '!turns amber']],
  ['work', 'leave: now', ['Leave now.', 'Dismiss']],
  ['work', 'leave: long title', ['Leave in 12 min.', 'Long appointment with a very long name']],
  ['work', 'leave: heavy data', ['Leave in 4 min.', 'Dismiss', 'Architecture working']],
  ['work', 'leave: Day drawer open', ['Leave in 12 min.', 'Agents today', 'Recording00:']],
  ['work', 'leave: feed stale', ['may be out of date', '!Leave in']],
  ['home', 'leave: on home', ['Leave in 12 min.', 'Moods']],
  ['unwind', 'leave: on unwind', ['Leave in 4 min.', 'Dismiss', 'Hide screen']],
  ['meet', 'leave: on meet', ['Leave in 12 min.', 'Design review with the platform team']],
  ['zen', 'leave: none on zen', ['Breathe in', '!Leave in']],
  ['work', 'recording: work', ['Now \u00b7 Recording', 'Stop recording', 'Mark moment', 'Recording00:']],
  ['work', 'recording: with leave', ['Leave in 4 min.', 'Now \u00b7 Recording', 'Recording00:']],
  ['work', 'recording: agents header', ['Now \u00b7 Recording', '00:0', '!Recording00:', 'Architecture working']],
  ['work', 'recording: helper down', ['not reachable', 'Recording00:', 'Now \u00b7 Recording']],
  ['work', 'recording: Hold', ['Recording00:', 'Command palette', '!Now \u00b7 Recording']],
  ['home', 'recording: home', ['Recording00:', 'Moods']],
  ['unwind', 'recording: unwind', ['Recording00:', 'Hide screen']],
  ['meet', 'recording: meet', ['Recording00:', 'Design review with the platform team']],
  ['zen', 'recording: none on zen', ['Breathe in', '!Recording00']],
  ['unwind', 'unwind: hide screen note', ['Could not watch input', 'Hide screen']],
  ['unwind', 'unwind: hide screen', 'Hide screen'],
];
// The calm strip, the Day drawer and the Agents today panel.
EXPECT.push(
  ['work', 'bottom: overlaps and twelve', ['3 at 1:30', '12 sessions: 2 need you']],
  ['work', 'bottom: overlap hover', ['3 meetings overlap', 'Vendor demo1:30 to 3:30 PM']],
  ['work', 'bottom: day drawer', ['Agents today', 'Vendor demo1:30 to 3:30', 'waiting on you']],
  ['work', 'agents today: today', ['Click a row to open its session', 'waiting on you']],
  ['work', 'agents today: yesterday', ['From the saved record of the day', '!m waiting on you']],
  ['work', 'agents today: heavy day', ['From the saved record of the day', 'across 40 sessions']],
  ['work', 'agents today: empty day', 'No sessions recorded on this day'],
  ['work', 'agents today: record absent', ['Agents today', '!Yesterday']],
  ['work', 'agents today: helper down', 'may be out of date'],
);

/**
 * States that set a knob but change nothing in the page text, so no text can prove them: the
 * reason is recorded in the manifest. Everything else that sets a knob needs an EXPECT.
 */
const NO_TEXT = [
  ['work', 'music paused', 'only the play and pause icon changes'],
  ['work', 'box numbers stale', 'the numbers keep their text and are only dimmed'],
  ['home', 'broken: weather down', 'Home shows no weather text'],
  ['home', 'broken: weather stale', 'Home shows no weather text'],
  ['work', 'audio demo', 'only the drawn levels move'],
  ['home', 'audio demo', 'only the drawn levels move'],
  ['unwind', 'audio demo', 'only the drawn levels move'],
  ['zen', 'focus running, long title', 'Zen shows no session title'],
  // Watt set down elsewhere: only where he stands changes (his stored spot), no text.
  ['work', 'Watt: set down', 'only where Watt stands changes'],
  ['home', 'Watt: set down', 'only where Watt stands changes'],
  ['meet', 'Watt: set down', 'only where Watt stands changes'],
  ['unwind', 'Watt: set down', 'only where Watt stands changes'],
  ['unwind', 'Watt: on Watch', 'only where Watt stands changes'],
];

const matches = (st, [sc, prefix, , exact]) => sc === st.screen && (exact === true ? st.name === prefix : st.name.startsWith(prefix));
const missing = [];
for (const st of STATES) {
  const hit = EXPECT.find((e) => matches(st, e));
  if (hit) st.expect = hit[2];
  else {
    const note = NO_TEXT.find(([sc, prefix]) => sc === st.screen && st.name.startsWith(prefix));
    if (note) st.expectNote = note[2];
    else if (st.custom) missing.push(`${st.screen}: ${st.name}`);
  }
}
if (missing.length) {
  console.error(`gallery: ${missing.length} state(s) set a knob but have no expected text (add one to EXPECT, or a reason to NO_TEXT):\n  ${missing.join('\n  ')}`);
  process.exit(2);
}

const only = flag('only')?.split('=')[1]?.toLowerCase();
const selected = only ? STATES.filter((s) => `${s.screen} ${s.name}`.toLowerCase().includes(only)) : STATES;

if (selected.length === 0) {
  console.error(`gallery: --only=${only} matches no state (try --list)`);
  process.exit(2);
}

if (flag('list')) {
  for (const s of selected) console.log(`${s.screen.padEnd(7)} ${s.name.padEnd(36)} ?${s.query}`);
  console.log(`${selected.length} states`);
  process.exit(0);
}

const chrome = process.env.WALL_CHROME || args.find((a) => !a.startsWith('--'));
if (!chrome || !existsSync(chrome)) {
  console.error('gallery: set WALL_CHROME to a Chromium or chrome-headless-shell binary.');
  process.exit(2);
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const work = mkdtempSync(join(tmpdir(), 'wall-gallery-'));
let chromeProc = null;
let cdpConn = null;
let shuttingDown = false;

/** Close the connection, ask Chromium to exit, wait (forced kill after 5 s), then remove the temp folder. */
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    cdpConn?.close();
  } catch {
    /* already closed */
  }
  const proc = chromeProc;
  if (proc && proc.exitCode === null && proc.signalCode === null) {
    await new Promise((resolve) => {
      const force = setTimeout(() => proc.kill('SIGKILL'), 5000);
      proc.once('exit', () => {
        clearTimeout(force);
        resolve();
      });
      proc.kill('SIGTERM');
    });
  }
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    shutdown().finally(() => process.exit(sig === 'SIGINT' ? 130 : 143));
  });
}

async function buildBundle() {
  process.env.NODE_ENV = 'development';
  const { build } = await import('vite');
  await build({
    root,
    configFile: join(root, 'vite.config.ts'),
    mode: 'development',
    base: './',
    logLevel: 'warn',
    build: {
      outDir: join(work, 'dist'),
      emptyOutDir: true,
      assetsInlineLimit: 100_000_000,
      cssCodeSplit: false,
      modulePreload: false,
      chunkSizeWarningLimit: 100_000,
      rolldownOptions: { output: { codeSplitting: false } },
    },
  });
  // One file: module scripts and stylesheets cannot load from file:// as separate files.
  const dist = join(work, 'dist');
  let html = readFileSync(join(dist, 'index.html'), 'utf8');
  html = html.replace(/<script type="module" crossorigin src="\.\/([^"]+)"><\/script>/g, (_, src) =>
    `<script type="module">${readFileSync(join(dist, src), 'utf8').replaceAll('</script', '<\\/script')}</script>`,
  );
  html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/([^"]+)">/g, (_, href) => `<style>${readFileSync(join(dist, href), 'utf8')}</style>`);
  const page = join(work, 'wall.html');
  writeFileSync(page, html);
  return pathToFileURL(page).href;
}

async function launch() {
  const profile = join(work, 'profile');
  mkdirSync(profile);
  let stderr = '';
  chromeProc = spawn(
    chrome,
    ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--mute-audio', `--user-data-dir=${profile}`, '--remote-debugging-port=0', `--window-size=${W},${H + 87}`, 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  chromeProc.stderr.on('data', (d) => {
    stderr = (stderr + d).slice(-4000);
  });
  const portFile = join(profile, 'DevToolsActivePort');
  // Ready when the port file appears; failed if the process errors or exits first; 60 s at most.
  let stop = () => {};
  const failed = new Promise((_, reject) => {
    chromeProc.once('error', (e) => reject(new Error(`could not start Chromium: ${e.message}`)));
    chromeProc.once('exit', (code, sig) => reject(new Error(`Chromium exited before it was ready (${sig ?? `code ${code}`})`)));
    const t = setTimeout(() => reject(new Error('Chromium was not ready after 60 seconds')), 60_000);
    stop = () => clearTimeout(t);
  });
  const ready = (async () => {
    while (!existsSync(portFile)) await new Promise((r) => setTimeout(r, 100));
  })();
  try {
    await Promise.race([ready, failed]);
  } catch (e) {
    console.error(`gallery: ${e.message}`);
    if (stderr.trim()) console.error(`Chromium said:\n${stderr.trim()}`);
    throw e;
  } finally {
    stop();
    failed.catch(() => {});
  }
  const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n');
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('could not connect to the DevTools socket'));
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (p) (msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result));
    } else for (const l of listeners) l(msg);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params, sessionId }));
    });
  cdpConn = { close: () => ws.close() };
  return { send, listeners, close: () => ws.close() };
}

/** Render one state in its own browser context (fresh storage). Returns { errors }. */
async function render(cdp, base, s, file, ctl) {
  const { browserContextId } = await cdp.send('Target.createBrowserContext');
  const errors = [];
  let sessionId;
  let targetId;
  let on = null;
  ctl.cleanup = async () => {
    if (on) cdp.listeners.delete(on);
    try {
      if (targetId) await cdp.send('Target.closeTarget', { targetId });
      await cdp.send('Target.disposeBrowserContext', { browserContextId });
    } catch {
      /* the page is gone already */
    }
  };
  try {
    ({ targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId }));
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
    on = (msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        errors.push(d.exception?.description?.split('\n')[0] ?? d.text);
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        errors.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)}`);
      }
    };
    cdp.listeners.add(on);
    const to = (method, params) => cdp.send(method, params, sessionId);
    await to('Page.enable');
    await to('Runtime.enable');
    await to('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await to('Emulation.setTimezoneOverride', { timezoneId: TZ });
    await to('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await to('Page.navigate', { url: `${base}?${s.query}` });
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    for (const step of [s.click ?? []].flat().flatMap((c) => c.split(' >> '))) {
      // A state shown just after a click (a task tick's Undo window). A string may chain steps with ` >> `.
      // `ctx:<selector>` right-clicks (opens the key picker), `hover:` moves the real pointer onto
      // the element, `press:` also holds the button down there, `focus:` focuses it, `kbd:` presses
      // Tab (so focus-visible applies) and then focuses it, anything else clicks.
      const pointer = /^(hover|press):/.exec(step);
      if (step.startsWith('kbd:')) {
        await to('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await to('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await to('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(step.slice(4))})?.focus()` });
      } else if (step.startsWith('focus:')) {
        await to('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(step.slice(6))})?.focus({ focusVisible: true })` });
      } else if (pointer) {
        const sel = JSON.stringify(step.slice(pointer[0].length));
        const at = await to('Runtime.evaluate', { expression: `(() => { const r = document.querySelector(${sel})?.getBoundingClientRect(); return r ? [r.left + r.width - 12, r.top + r.height / 2] : null; })()`, returnByValue: true });
        const [x, y] = at.result.value ?? [0, 0];
        await to('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        if (pointer[1] === 'press') await to('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      } else {
        const ctx = step.startsWith('ctx:');
        const sel = JSON.stringify(ctx ? step.slice(4) : step);
        await to('Runtime.evaluate', {
          expression: ctx ? `document.querySelector(${sel})?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))` : `document.querySelector(${sel})?.click()`,
        });
      }
      await new Promise((r) => setTimeout(r, 900));
    }
    const check = await to('Runtime.evaluate', {
      expression: `JSON.stringify({ root: !!document.querySelector('.shell'), emptyRoot: !document.getElementById('root')?.childElementCount, boundary: /something went wrong|error boundary/i.test(document.body.textContent || ''), text: document.body.textContent || '', w: innerWidth, h: innerHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight })`,
      returnByValue: true,
    });
    const info = JSON.parse(check.result.value);
    if (!info.root || info.emptyRoot) errors.push('the app did not render (no .shell; a render error unmounts the root)');
    if (process.env.WALL_GALLERY_TEXT_DIR) writeFileSync(join(process.env.WALL_GALLERY_TEXT_DIR, basename(file).replace('.png', '.txt')), info.text);
    if (info.boundary) errors.push('an error fallback is showing');
    for (const want of [s.expect ?? []].flat()) {
      const absent = want.startsWith('!');
      const needle = absent ? want.slice(1) : want;
      if (info.text.includes(needle) === absent) errors.push(`${absent ? 'unexpected' : 'expected'} text ${absent ? 'shown' : 'not shown'}: "${needle}"`);
    }
    if (info.w !== W || info.h !== H) errors.push(`viewport ${info.w} x ${info.h}`);
    if (ctl.cancelled) throw new Error('cancelled');
    const shot = await to('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
    if (ctl.cancelled) throw new Error('cancelled');
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
  } finally {
    await ctl.cleanup();
  }
  return { errors };
}

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function writeIndex(manifest) {
  const screens = [...new Set(manifest.map((m) => m.screen))];
  const sections = screens
    .map((sc) => {
      const items = manifest.filter((m) => m.screen === sc);
      const cards = items
        .map(
          (m) => `<figure id="${esc(m.file.replace('.png', ''))}"><a href="${esc(m.file)}"><img loading="lazy" src="${esc(m.file)}" width="${m.width}" height="${m.height}" alt="${esc(sc)}: ${esc(m.state)}"></a><figcaption><b>${esc(m.state)}</b>${m.error ? ` <em>FAILED: ${esc(m.error)}</em>` : ''}<code>?${esc(m.url)}</code></figcaption></figure>`,
        )
        .join('\n');
      return `<section id="${esc(sc)}"><h2>${esc(sc)} <small>${items.length}</small></h2>\n${cards}</section>`;
    })
    .join('\n');
  const nav = screens.map((sc) => `<a href="#${esc(sc)}">${esc(sc)}</a>`).join(' ');
  writeFileSync(
    join(outDir, 'index.html'),
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wall 2 state gallery</title>
<style>
body{margin:0;background:#14161b;color:#d8dce4;font:15px/1.4 system-ui,sans-serif}
header{position:sticky;top:0;background:#14161bee;padding:10px 20px;border-bottom:1px solid #2a2f3a;z-index:1}
header a{color:#8fb4ff;margin-right:14px;text-decoration:none}
h1{font-size:16px;margin:0 0 6px}
section{padding:10px 20px}
h2{text-transform:capitalize;margin:24px 0 8px}h2 small{color:#7b8394;font-weight:400}
figure{margin:0 0 22px}
img{width:100%;max-width:1280px;height:auto;display:block;border:1px solid #2a2f3a;background:#000}
figcaption{padding-top:6px;max-width:1280px}
code{display:block;color:#7b8394;font-size:12px;word-break:break-all}
em{color:#ff8a8a}
</style></head><body>
<header><h1>Wall 2 state gallery: ${manifest.length} stills at ${W} x ${H}</h1>${nav}</header>
${sections}
</body></html>
`,
  );
}

try {
  console.log('gallery: building the development bundle');
  const base = await buildBundle();
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const cdp = await launch();
  const manifest = new Array(selected.length);
  let failures = 0;
  let next = 0;
  const used = new Set();
  const names = selected.map((s) => {
    let f = `${slug(s.screen)}--${slug(s.name)}`;
    while (used.has(f)) f += '-2';
    used.add(f);
    return `${f}.png`;
  });
  async function worker() {
    while (next < selected.length) {
      const i = next++;
      const s = selected[i];
      const file = names[i];
      let error = null;
      const ctl = { cancelled: false, cleanup: async () => {} };
      let timer;
      try {
        const r = await Promise.race([
          render(cdp, base, s, join(outDir, file), ctl),
          new Promise((_, rej) => {
            timer = setTimeout(() => rej(new Error('timed out')), STATE_TIMEOUT_MS);
          }),
        ]);
        if (r.errors.length) error = [...new Set(r.errors)].slice(0, 3).join(' | ');
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        // Stop the late work: no screenshot write, target and listeners closed.
        ctl.cancelled = true;
        await ctl.cleanup();
      } finally {
        clearTimeout(timer);
      }
      if (error) failures++;
      manifest[i] = { screen: s.screen, state: s.name, url: s.query, ...(s.expect ? { expect: s.expect } : {}), ...(s.expectNote ? { expectNote: s.expectNote } : {}), file, width: W, height: H, ...(error ? { error } : {}) };
      console.log(`${error ? 'FAIL' : 'ok  '} ${s.screen.padEnd(7)} ${s.name.padEnd(36)} ${file}${error ? `  ${error}` : ''}`);
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  cdp.close();
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeIndex(manifest);
  const stills = readdirSync(outDir).filter((f) => f.endsWith('.png')).length;
  console.log(`gallery: ${stills} stills, ${failures} failed. ${join(outDir, 'index.html')}`);
  process.exitCode = failures ? 1 : 0;
} finally {
  await shutdown();
}
