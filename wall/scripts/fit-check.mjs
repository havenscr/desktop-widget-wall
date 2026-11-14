// Fit check for the Work wings, in a real browser (jsdom has no layout, so vitest cannot
// measure this). Builds a development bundle with the dev mocks, inlines it into one HTML
// file, opens Work at a review moment with the longest mock strings (`?long=1`) in headless
// Chromium at 2560 by 720, and checks that the left and right wings and the centre fit:
// - no scroll overflow inside a checked box (scrollWidth <= clientWidth, scrollHeight <=
//   clientHeight);
// - each checked box stays inside its container (the centre for its lanes, shelf, panels
//   and note; the top band for the wings and the centre) on all four sides;
// - each checked box stays inside the viewport on all four sides;
// - the document itself has no scroll overflow.
// The centre is checked in each of its states (`?agents=`): three lanes with long titles,
// twelve sessions (the three in view) with five meetings at once, two waiting, one failed,
// an older helper's answer, one lane, no lane, and the fill when the helper is not set up.
// In every Work state it also fails on agent hit boxes of two sessions that share pixels, on
// calendar chips (or a title beside one) that share pixels, and on a card line that cuts its words
// while more than 60 px of it is unused, and on stage labels closer than 8 px. Home is checked
// with its Sound block at its fullest, typical, sparse, not reachable and not set up. Exits
// non-zero on a failure. Unwind's Watch tab is checked empty, with three and with 24 saved,
// playing in each look, and with its settings sheet open both ways. Keys style: every key edge at
// least 3 to 1 against the sky (read from a screenshot) by day and night, the Now row one height on
// a key page and on For you, and the grown Hide screen pill inside the corner under the Room card,
// clear of the failure note. Leave and recording: the leave banner inside x 600 to 1940 and its band (y 0 to 70 on
// Work, y 510 to 600 off Work) covering no text or control, the recording chip one 32 px line at most 200 px wide in the
// Agents header (and inside the banner, or in the band off Work), and the Recording page the same height as a key page.
// CI does not run this; run it by hand before a layout change is handed over.
//
//   WALL_CHROME=/path/to/chrome-or-headless-shell npm --prefix wall run fit-check
//   npm --prefix wall run fit-check -- --overflow=right    (left, right, top, bottom, page, agents, labels, header, deck, tiles, picker, chips, heading, zenhint, strip, fold, drawer, rows, handle, sky, floor, sun, tools, toolsnames, meetfill, meetempty, fy-height, key-edge, hide-pill, hide-note, leave-band, rec-chip, rec-height, tile-height, tile-icon, tile-iconbox, drawer-scrim, lwbuttons, lwoverlap, lwsquare, lwring, lwtemp, lwround, listen-player, listen-card, listen-slot, listen-next)
//   npm --prefix wall run fit-check -- --self-test
//
// WALL_CHROME (or the first argument that is not a flag) is a Chromium or
// chrome-headless-shell binary. `--overflow=<side>` adds a stylesheet that pushes a checked
// box past that side (or widens the page) and must fail. `--self-test` runs every
// `--overflow` case and exits 0 only if each one failed with the FAIL line for its side.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { inflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeRunError, onCleanup, runChrome } from './lib/chrome-run.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const chrome = args.find((a) => !a.startsWith('--')) || process.env.WALL_CHROME;
if (!chrome) {
  console.error('fit-check: set WALL_CHROME (or pass the path) to a Chromium or chrome-headless-shell binary.');
  process.exit(2);
}

/**
 * Stylesheets that break the layout on purpose, one per side, for `--overflow`, and the
 * FAIL line the self-test must find for each (the side that was broken, nothing else).
 */
const EXPECT = {
  left: /^ *FAIL \.work \.left-wing:.*viewport [^,]*\bleft \d+/m,
  right: /^ *FAIL \.work \.centre \.lane \[\d\]:.*container right \d+/m,
  top: /^ *FAIL \.work \.right-wing:.*viewport top \d+/m,
  bottom: /^ *FAIL \.work \.centre \.shelf:.*container bottom \d+/m,
  page: /^ *FAIL page:.*scroll (?!2560 )\d+ x \d+ <= 2560 x/m,
  agents: /^ *FAIL overlap: agent /m,
  labels: /^ *FAIL stage labels on card /m,
  header: /^ *FAIL header part wraps: /m,
  deck: /^ *FAIL deck: .* below the floor/m,
  tiles: /^ *FAIL deck: label .* outside its tile/m,
  picker: /^ *FAIL deck: the key picker reaches y \d+, over the timeline/m,
  zenhint: /^ *FAIL \.zen-bl \.zen-dimhint:.*container right \d+/m,
  chips: /^ *FAIL overlap: chip /m,
  heading: /^ *FAIL deck: the Now heading /m,
  menu: /^ *FAIL Watt menu: .*Watt himself/m,
  strip: /^ *FAIL strip: the Work strip is \d+ px tall/m,
  fold: /^ *FAIL strip: the folded chip's count is cut/m,
  drawer: /^ *FAIL strip: \.day-drawer (reaches above the clock|sticks out of the stage)/m,
  rows: /^ *FAIL strip: an Agents today row is \d+ px tall/m,
  handle: /^ *FAIL strip: the drawer handle covers /m,
  sky: /^ *FAIL no point of the sky or the floor lands on \.w-sky/m,
  floor: /^ *FAIL pointer at \.u-tomorrow .*reaches w-skyspill/m,
  sun: /^ *FAIL pointer at .*reaches w-stage w-sun/m,
  tools: /^ *FAIL tools drawer: .*outside x 1700 to 2560/m,
  toolsnames: /^ *FAIL tools: .* is cut with no tooltip/m,
  meetfill: /^ *FAIL meet: nothing fills the upper right/m,
  meetempty: /^ *FAIL meet: nothing fills the upper right/m,
  // keys style
  'fy-height': /^ *FAIL deck: the Now row is \d+ px tall on/m,
  'key-edge': /^ *FAIL deck: key ".*" edge against the sky /m,
  'hide-pill': /^ *FAIL hide screen: /m,
  'hide-note': /^ *FAIL hide screen note: /m,
  // leave and recording
  'leave-band': /^ *FAIL leave banner: /m,
  'rec-chip': /^ *FAIL recording chip: /m,
  'rec-height': /^ *FAIL deck: the Now row is \d+ px tall on Recording/m,
  // deck and drawer fixes
  'tile-height': /^ *FAIL deck: key tile ".*" is [\d.]+ px tall/m,
  'tile-icon': /^ *FAIL deck: the icon of key tile ".*" sits /m,
  'tile-iconbox': /^ *FAIL deck: the icon of key tile ".*" is not inside its icon box/m,
  'drawer-scrim': /^ *FAIL strip: with the drawer open, /m,
  // left wing
  lwbuttons: /^ *FAIL left wing: music buttons leave the wing/m,
  lwoverlap: /^ *FAIL left wing: music buttons overlap the title/m,
  lwsquare: /^ *FAIL left wing: focus outline on Choose a focus length is square/m,
  lwring: /^ *FAIL left wing: focus outline on Choose a focus length/m,
  lwtemp: /^ *FAIL left wing: TEMP header /m,
  lwround: /^ *FAIL left wing: round control /m,
  // unwind listen
  'listen-player': /^ *FAIL listen: the player ends at y \d+/m,
  'listen-card': /^ *FAIL listen: the Spotify card /m,
  'listen-slot': /^ *FAIL listen: .* enters the office lights slot/m,
  'listen-next': /^ *FAIL listen: Up next /m,
  // watch polish
  'watch-switch': /^ *FAIL watch polish: the Look switch is at /m,
  'watch-row': /^ *FAIL \.w-ctl: width \d+ <= \d+/m,
  'watch-over': /^ *FAIL watch polish: .*w-lookbar.* is drawn over the video's box/m,
  'watch-take': /^ *FAIL pointer at \.w-sky \.w-frame /m,
};
const OVERFLOWS = {
  left: '.work .left-wing { transform: translateX(-200px); }',
  right: '.work .centre .lane { margin-right: -160px; }',
  top: '.work .right-wing { transform: translateY(-60px); }',
  bottom: '.work .centre .shelf { transform: translateY(120px); }',
  page: 'body::after { content: ""; position: absolute; left: 3000px; top: 0; width: 10px; height: 10px; }',
  agents: '.rib .agent-row .sg-hit { width: 60px !important; }',
  labels: '.work .centre .lane .jn em { padding: 0 14px !important; }',
  header: '.work .centre .lanes-hd .slot-meter .xs { display: inline-block; width: 60px; white-space: normal !important; }',
  deck: '.work .right-wing section.pinned { margin-top: 80px; }',
  tiles: '.work .right-wing .key-tile .deck-lbl { flex: none; width: 160px; max-width: none !important; }',
  picker: '.work .right-wing .pk { height: 400px !important; }',
  zenhint: '.zen-dimhint { width: 2000px; }',
  chips: '.rib .ev { width: 400px !important; }',
  heading: '.work .right-wing .keys .deck-name { max-width: 40px; overflow: hidden; }',
  menu: '.watt-menu-at { transform: translateY(300px); }',
  strip: '.rib[data-kind="work"] { box-sizing: content-box; height: 104px; padding-bottom: 20px; }',
  fold: '.rib .ev.fold { width: 30px !important; }',
  drawer: '.day-drawer { translate: 0 -300px; }',
  rows: '.agents-today .at-row { height: 20px !important; min-height: 0 !important; }',
  handle: '.rib .rib-handle { top: 20px !important; }',
  // The whole-sky video layer catching the pointer and drawn over the controls.
  sky: '.w-sky, .w-sky * { pointer-events: auto !important; } .w-sky { z-index: 30 !important; }',
  // The floor wash catching the pointer and drawn over the Tomorrow card and the status line.
  floor: '.w-skyspill { pointer-events: auto !important; z-index: 30 !important; left: -130px !important; width: 2440px !important; }',
  // The sun's box spread over the whole band, over the controls.
  sun: '.w-sun { left: -100px !important; width: 2500px !important; z-index: 30 !important; }',
  // The Tools drawer 1400 px wide runs past the right edge of the stage.
  tools: '.tools-drawer { width: 1400px !important; }',
  // A 20 px name column cuts the account and source names (they carry no tooltip of their own).
  toolsnames: '.tools-name, .tools-srcname { width: 20px !important; max-width: 20px !important; flex: none !important; overflow: hidden; }',
  // Meet's Later list hidden leaves the upper right empty.
  meetfill: '.meet .meet-later { display: none !important; }',
  // The same on a state with no meeting: the upper right is empty there too.
  meetempty: '.meet .meet-later { display: none !important; }',
  // keys style
  'fy-height': '.work .right-wing .fy-plate { height: 80px; }',
  'key-edge': '.work .right-wing .deck-tile.key-tile { border-color: transparent !important; }',
  'hide-pill': '.screens-off:is(:hover, :focus-visible) { min-width: 900px; }',
  'hide-note': '.screens-off-note { bottom: 0 !important; }',
  // leave and recording
  'leave-band': '.leave-banner { top: 200px !important; }',
  'rec-chip': '.rec-chip { min-width: 400px !important; }',
  'rec-height': '.rec-keys .key-tile { height: 92px !important; }',
  // deck and drawer fixes: one tile 20 px taller; one icon 8 px lower; a 40 px icon; a scrim that takes no clicks.
  'tile-height': '.work .right-wing .keys .deck-tiles > .key-tile-wrap:nth-child(2) > .deck-tile.key-tile { height: 90px !important; }',
  'tile-icon': '.work .right-wing .pinned .key-tile-wrap:nth-child(2) > .deck-tile.key-tile svg { margin-top: 8px !important; }',
  'tile-iconbox': '.work .right-wing .keys .deck-tile.key-tile:first-child svg { width: 40px !important; height: 40px !important; }',
  'drawer-scrim': '.drawer-scrim { pointer-events: none !important; }',
  // left wing
  lwbuttons: '.work .left-wing .music-mini-text { flex: none !important; width: 900px !important; }',
  lwoverlap: '.work .left-wing .music-mini-btns { transform: translateX(-200px); }',
  lwsquare: '.work .left-wing .focus-mini-ring:focus-visible { border-radius: 0 !important; }',
  lwring: '.work .left-wing .focus-mini-ring:focus-visible { outline: none !important; }',
  lwtemp: '.work .left-wing .mc-hd span:last-child { transform: translateX(14px); }',
  lwround: '.work .wl .rd, .work .wl .focus-mini-ring, .work .wl .ring { border-radius: 0 !important; }',
  // unwind listen: the player pushed down into the lines, the card grown past the foot, the status
  // line run into the office lights slot, Up next rows grown past the horizon.
  'listen-player': '.u-listen { margin-top: 200px; }',
  'listen-card': '.sp-card { height: 900px !important; }',
  'listen-slot': '.u-line { margin-left: 1960px; width: 600px; }',
  'listen-next': '.u-next-row { height: 80px !important; }',
  // watch polish: the Look switch moved 40 px in one look; a 600 px control in the row; the switch back on the video.
  'watch-switch': '.w-panel:has(.w-sun) .w-lookbar { left: 540px !important; }',
  'watch-row': '.w-ctl .w-open { min-width: 600px !important; }',
  'watch-over': '.w-lookbar { left: 1200px !important; top: 200px !important; }',
  // A refused autoplay that never lets the pointer reach the whole-sky picture.
  'watch-take': '.w-frame.w-take { pointer-events: none !important; }',
};
if (flag('self-test')) {
  const script = fileURLToPath(import.meta.url);
  let missed = 0;
  for (const side of Object.keys(OVERFLOWS)) {
    const r = spawnSync(process.execPath, [script, chrome, `--overflow=${side}`], { encoding: 'utf8' });
    // Caught only when the run failed and reported the side that was broken; a non-zero exit
    // for any other reason (a crash, a page that did not render) does not count.
    const line = EXPECT[side].exec(r.stdout ?? '');
    const caught = r.status === 1 && line !== null;
    if (!caught) missed += 1;
    const full = line ? r.stdout.slice(line.index).split('\n')[0].trim() : 'no FAIL line for this side';
    console.log(`${caught ? 'ok  ' : 'MISS'} --overflow=${side}: exit ${r.status}; ${full}`);
  }
  console.log(missed === 0 ? 'self-test: every deliberate overflow failed the check' : `self-test: ${missed} overflow(s) not caught`);
  process.exit(missed === 0 ? 0 : 1);
}

const overflow = flag('overflow')?.split('=')[1];
if (overflow !== undefined && !(overflow in OVERFLOWS)) {
  console.error(`fit-check: --overflow takes one of ${Object.keys(OVERFLOWS).join(', ')}`);
  process.exit(2);
}

process.env.NODE_ENV = 'development';
const { build } = await import('vite');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const WINGS = ['.work .left-wing', '.work .right-wing'];
const LANES = ['.work .centre', '.work .centre .lane', '.work .centre .shelf'];
const MEET = ['.meet .panel'];
const WATCH_IDLE = ['.w-card', '.w-card .u-card-head', '.w-field', '.w-now'];
const WATCH_PLAYING = [...WATCH_IDLE, '.w-ctl', '.w-screen', '.w-time', '.w-open', '.w-lookbar'];
// Named controls that must still take the pointer with video playing: the rail, the tabs and
// the gear, the transport, the list's first row and its field, a Room chip, the status chips,
// Screens off and Watt.
// Below the horizon, under the whole sky's floor wash: the Tomorrow card, the status line's
// chips and Screens off (Unwind has no timeline strip).
const FLOOR_HITS = ['.u-tomorrow', '.u-line .u-act', '.screens-off'];
const SKY_HITS = ['.rail .rb', '.u-tab', '.w-gear', '.w-ctl .rd:not(:disabled)', '.w-lookbar button', '.w-play', '.w-mini', '.w-paste', '.u-line .u-act', '.screens-off', '.w-open', '.watt-hit-part'];
// watch polish: the left block, its control row, the position line and the Look switch.
const WATCH_POLISH = ['.w-now', '.w-ctl', '.w-time', '.w-lookbar', '.w-card'];
const WATCH_POLISH_HITS = ['.w-lookbar button', '.w-ctl .rd:not(:disabled)', '.w-open'];
const DREAM = ['.dream-clock', '.dream-date', '.dream-card', '.dream-status', '.dream-hint'];
// With more than three sessions the card list scrolls inside the centre: the three cards in
// view, the header and the shelf must fit; the list itself is meant to scroll.
const SCROLLED = ['.work .centre', '.work .centre .lanes-hd', '.work .centre .lanes-list > .lane:nth-child(-n+3)', '.work .centre .shelf'];
const work = (agents, extra = '') => `?hz=work&at=2026-11-11T16:10:00-08:00&long=1&agents=${agents}${extra}`;
// Home with the Sound block: the centre column, its mood row and every part of the Sound
// card must stay inside the top band in each state (the dev mocks' `sonos` and `moods` knobs).
// With more than six moods the mood row scrolls sideways on purpose, so only its block is
// checked there.
const home = (knobs) => `?hz=home&at=2026-11-12T16:36:00-08:00&long=1&${knobs}`;
const HOME_CENTRE = ['.home .home-centre', '.home .moods', '.home .mood-row', '.home .home-right'];
const SOUND_FULL = ['.home .sound', '.home .sound-panel', '.home .sound-plays', '.home .sound-line', '.home .sound-where', '.home .sound-plays .sound-chip'];
// The Always here and Now rows under Next three (dev mocks `arrange`, `keys`, `agents`, `meet`,
// `net` and `hold`): the deck, both rows, their headers (result line, Undo, the pages, the chip
// and the Auto controls) and their tiles or For you lines stay inside the right wing, which stays
// inside the top band. Long task titles come from `long=1`. The key picker covers the deck only.
const DECK = ['.work .right-wing', '.work .right-wing .deck', '.work .right-wing section.pinned', '.work .right-wing .keys', '.work .right-wing .deck-hd', '.work .right-wing .deck-tiles'];
const DECK_ROWS = DECK.slice(0, 5);
const FOR_YOU = [...DECK_ROWS, '.work .right-wing .fy-list', '.work .right-wing .fy-li'];
// Open, the picker runs past the deck's box (over the mountains, to just above the timeline), so the wing
// and the deck box are not held to their own size here; the rows, the picker and its parts are.
const PICKER = ['.work .right-wing section.pinned', '.work .right-wing .keys', '.work .right-wing .deck-hd', '.work .right-wing .pk', '.work .right-wing .pk-top', '.work .right-wing .pk-reset'];
const deck = (name, knobs, extra = {}) => ({ name: `Deck, ${name}`, q: work('3', `&${knobs}`), checks: DECK, ...extra });
// Meet reads the real clock, so its variants run unfrozen (the mock meetings are relative to now).
const query = (v) => `?${v.live ? '' : `hz=${v.hz ?? 'work'}&at=${v.at ?? '2026-11-11T10:24:00-08:00'}&`}long=1&agents=${v.agents}${v.go ? `&go=${v.go}` : ''}${v.moods ? `&moods=${v.moods}` : ''}${v.extra ?? ''}`;
// Meet, Unwind and Dream states: built with `query`, then given the same `q` shape as the rest.
const QUIET = [
  // Meet: both accounts read; one account failing; no account readable; long titles throughout.
  { name: 'Meet, both accounts read', agents: '3', go: 'meet', live: true, extra: '', checks: MEET },
  { name: 'Meet, one account signed out: the one amber line, Later fills the upper right', agents: '3', go: 'meet', live: true, extra: '', checks: MEET },
  { name: 'Meet, heavy: Later in two columns', agents: '3', go: 'meet', live: true, extra: '&meet=heavy', checks: MEET },
  { name: 'Meet, one account failing', agents: '3', go: 'meet', live: true, extra: '&meet=mixed', checks: MEET },
  { name: 'Meet, no account readable', agents: '3', go: 'meet', live: true, extra: '&meet=down', checks: MEET },
  { name: 'Meet, nothing scheduled', agents: '3', go: 'meet', live: true, extra: '&meet=none', checks: MEET },
  { name: 'Meet, calendar not set up', agents: '3', go: 'meet', live: true, extra: '&meet=off', checks: MEET },
  { name: 'Meet, first read fails', agents: '3', go: 'meet', live: true, extra: '&meet=failing', checks: MEET },
  // unwind listen: the player clear of the lines, the Spotify card in the upper right, Up next in the
  // wing above the horizon, and nothing in the office lights slot, in each Listen state.
  { name: 'Listen, playing with the lines moving', agents: '3', hz: 'unwind', extra: '&audio=demo', checks: ['.u-listen', '.sp-card', '.u-next', '.u-line'], listen: true },
  { name: 'Listen, nothing playing', agents: '3', hz: 'unwind', extra: '&media=none', checks: ['.u-listen', '.sp-card', '.u-line'], listen: true },
  { name: 'Listen, heavy library and long names', agents: 'ask', hz: 'unwind', extra: '&spotify=heavy&media=long', checks: ['.u-listen', '.sp-card', '.u-next', '.u-line'], listen: true },
  { name: 'Listen, the songs of a 2000 song playlist', agents: '3', hz: 'unwind', extra: '&spotify=heavy', click: '.sp-tile', checks: ['.sp-card', '.sp-songs', '.sp-shead'], listen: true },
  { name: 'Listen, long names everywhere', agents: 'ask', hz: 'unwind', extra: '&spotify=long&media=long', checks: ['.u-listen', '.sp-card', '.u-next', '.u-next-row', '.u-line'], listen: true },
  { name: 'Listen, long names, the songs of a 240 song playlist', agents: '3', hz: 'unwind', extra: '&spotify=long&media=long', click: '.sp-tile', checks: ['.sp-card', '.sp-songs', '.sp-shead'], listen: true },
  // The leave-soon banner over Unwind: it must not cover the status line or reach the office slot.
  { name: 'Listen, with the leave banner', agents: '3', hz: 'unwind', extra: '&leave=12&long=1', checks: ['.u-listen', '.sp-card', '.u-line', '.leave-banner'], listen: true },
  { name: 'Listen, YouTube Music chosen', agents: '3', hz: 'unwind', extra: '', click: '.sp-switch button:nth-child(2)', checks: ['.u-listen', '.sp-card', '.sp-yt'], listen: true },
  { name: 'Listen, Spotify signed out', agents: '3', hz: 'unwind', extra: '&spotify=signedout', checks: ['.u-listen', '.sp-card', '.sp-state', '.u-next'], listen: true },
  // Zen in the evening: the dim hint stays inside the controls' column (the box the Start row sets).
  { name: 'Zen, evening hint under the controls', agents: '3', go: 'zen', at: '2026-11-11T20:15:00-08:00', extra: '', checks: ['.zen-bl', '.zen-bl .zen-dimhint'] },
  // Dream at night: helper answering, helper off; calendar read, unreadable, nothing tomorrow.
  { name: 'Dream, agents and calendar', agents: '3', go: 'dream', at: '2026-11-11T23:48:00-08:00', extra: '', checks: DREAM },
  { name: 'Dream, agents waiting', agents: 'ask', go: 'dream', at: '2026-11-11T23:48:00-08:00', extra: '', checks: DREAM },
  { name: 'Dream, helper off, calendar unreadable', agents: 'off', go: 'dream', at: '2026-11-11T23:48:00-08:00', extra: '&meet=down', checks: ['.dream-clock', '.dream-date', '.dream-card', '.dream-hint'] },
  { name: 'Dream, nothing tomorrow', agents: 'off', go: 'dream', at: '2026-11-11T23:48:00-08:00', extra: '&meet=none', checks: ['.dream-clock', '.dream-date', '.dream-hint'] },
  // Unwind's Watch tab (`?watch=mock` draws a poster for the frame): the list card, its field,
  // the left block, the video in each look with Open in browser under it, and the settings
  // sheet stay inside the band; the list itself scrolls on purpose past the rows that fit.
  { name: 'Watch, nothing saved', agents: '3', hz: 'unwind', extra: '&watch=mock&wlist=none', checks: WATCH_IDLE },
  { name: 'Watch, three saved, nothing on', agents: '3', hz: 'unwind', extra: '&watch=mock&wlist=three', checks: [...WATCH_IDLE, '.w-list', '.w-row'] },
  { name: 'Watch, three saved, feathered playing', agents: '3', hz: 'unwind', extra: '&watch=mock&wlist=three&wlook=feather&wplay=0', checks: [...WATCH_PLAYING, '.w-list'] },
  { name: 'Watch, 24 saved, drive-in, long label playing', agents: '3', hz: 'unwind', extra: '&watch=mock&wlist=many&wlook=drivein&wplay=3', checks: [...WATCH_PLAYING, '.w-post'] },
  { name: 'Watch, settings sheet, one look', agents: '3', hz: 'unwind', extra: '&watch=mock&wlist=three&wplay=0&wsheet=one', checks: ['.w-sheet', '.w-tiles', '.w-tile', '.w-sfoot'] },
  // Part 2a: the whole sky and the sun. The whole sky lies under every control: each named
  // control gets the pointer at its centre, and no point of the sky reaches the video layer.
  { name: 'Watch, whole sky playing, every control still takes the pointer', agents: 'ask', hz: 'unwind', extra: '&watch=mock&wlist=three&wlook=sky&wplay=0', checks: [...WATCH_IDLE, '.w-ctl', '.w-open', '.w-lookbar'], hits: [...SKY_HITS, ...FLOOR_HITS], noHit: '.w-sky, .w-skyspill' },
  { name: 'Watch, whole sky, 24 saved, long label', agents: '3', hz: 'unwind', extra: '&watch=mock&wlist=many&wlook=sky&wplay=3', checks: [...WATCH_IDLE, '.w-ctl', '.w-open', '.w-lookbar'], hits: [...SKY_HITS, ...FLOOR_HITS], noHit: '.w-sky, .w-skyspill' },
  { name: 'Watch, the sun playing', agents: '3', hz: 'unwind', extra: '&watch=mock&wlist=three&wlook=sun&wplay=0', checks: [...WATCH_IDLE, '.w-ctl', '.w-time', '.w-open', '.w-list'], hits: SKY_HITS },
  { name: 'Watch, the sun, 24 saved, Twitch', agents: '3', hz: 'unwind', extra: '&watch=mock&wlist=many&wlook=sun&wplay=2', checks: [...WATCH_IDLE, '.w-ctl', '.w-time', '.w-open'], hits: SKY_HITS },
  { name: 'Watch, settings sheet with four looks, one look', agents: '3', hz: 'unwind', extra: '&watch=mock&wlist=three&wlook=sky&wplay=0&wsheet=one', checks: ['.w-sheet', '.w-tiles', '.w-tile', '.w-hint', '.w-sfoot'] },
  { name: 'Watch, settings sheet, a look per kind', agents: '3', hz: 'unwind', extra: '&watch=mock&wlist=many&wplay=2&wsheet=kind', checks: ['.w-sheet', '.w-srow', '.w-srow .w-seg', '.w-sfoot'] },
  // watch polish: the control row and the Look switch in every look. The switch's box must be the
  // same in every state below (compared after the run), the row one line clear of the list, and
  // nothing of the wall's over the video's box; the drive-in's driveInAudience must be its screen.
  { name: 'Watch polish, feathered, single video', agents: '3', hz: 'unwind', extra: '&watch=mock&wlist=three&wlook=feather&wplay=0', checks: WATCH_POLISH, hits: WATCH_POLISH_HITS },
  { name: 'Watch polish, whole sky, playlist', agents: '3', hz: 'unwind', extra: '&watch=mock&wlist=many&wlook=sky&wplay=3', checks: WATCH_POLISH, hits: WATCH_POLISH_HITS },
  { name: 'Watch polish, the sun, Twitch', agents: '3', hz: 'unwind', extra: '&watch=mock&wlist=three&wlook=sun&wplay=2', checks: WATCH_POLISH, hits: WATCH_POLISH_HITS },
  { name: 'Watch polish, drive-in, playlist, long label', agents: '3', hz: 'unwind', extra: '&watch=mock&wlist=many&wlook=drivein&wplay=3', checks: WATCH_POLISH, hits: WATCH_POLISH_HITS },
  { name: 'Watch polish, drive-in, autoplay refused', agents: '3', hz: 'unwind', extra: '&watch=mock&wlist=three&wlook=drivein&wplay=0&wstate=refused', checks: WATCH_POLISH, hits: WATCH_POLISH_HITS },
  // A refused autoplay over the whole sky: the hint shows, and a click lands on the picture where the wall draws nothing.
  { name: 'Watch polish, whole sky, autoplay refused', agents: '3', hz: 'unwind', extra: '&watch=mock&wlist=three&wlook=sky&wplay=0&wstate=refused', checks: WATCH_POLISH, hits: [...WATCH_POLISH_HITS, '.w-clickline', '.w-sky .w-frame'] },
  { name: 'Watch polish, nothing on, drive-in', agents: '3', hz: 'unwind', extra: '&watch=mock&wlist=three&wlook=drivein', checks: ['.w-now', '.w-lookbar'], hits: ['.w-lookbar button'] },
].map((v) => ({ ...v, q: query(v) }));
// The Tools drawer over each place, and in each hard state: the drawer, its two columns and every
// section stay inside the stage, right of the rail and the clock, with no cut text that has no tooltip.
const TOOLS = ['.tools-drawer', '.tools-drawer .tools-col', '.tools-drawer .tools-block', '.tools-drawer .tools-list', '.tools-drawer .tools-foot'];
const tools = (name, q) => ({ name: `Tools, ${name}`, q, checks: TOOLS, viewportOnly: true });
const TOOLS_VARIANTS = [
  tools('over Work, typical', `${work('3')}&tools=1`),
  tools('over Work, accounts ringed', `${work('3')}&tools=accounts&meet=signedout`),
  tools('over Home', `${home('moods=five')}&tools=1`),
  tools('over Unwind', `${query({ hz: 'unwind', agents: '3', extra: '' })}&tools=1`),
  tools('over Meet', `${query({ live: true, agents: '3', go: 'meet', extra: '' })}&tools=1`),
  tools('every source failing or stale', `${work('down')}&weather=stale&tasks=down&home=down&box=none&sonos=down&tools=1`),
  tools('every source not set up', `${work('off')}&tasks=off&home=off&sonos=off&meet=off&tools=1`),
  tools('keys refused with a long reason', `${work('3')}&keys=refused&tools=1`),
  tools('no keys file', `${work('3')}&source=default&tools=1`),
  tools('Spotify not set up, a sign-in waiting', `${work('3')}&spotify=off&meet=signedout&tools=1`),
];
const VARIANTS = [
  { name: 'three lanes, long titles', q: work('3'), checks: [...WINGS, ...LANES] },
  { name: 'twelve sessions, long titles, five meetings at once', q: work('12', '&meet=busy'), checks: SCROLLED },
  { name: 'seven sessions, the fifth waiting', q: work('7ask'), checks: SCROLLED },
  // The agents header never wraps: twelve sessions, two waiting with a long title, a network alarm, fresh and stale.
  { name: 'header: twelve sessions, two waiting, an alarm', q: work('12ask'), checks: [...SCROLLED, '.work .centre .lanes-hd .alarm-chip'] },
  { name: 'header: twelve sessions, two waiting, an alarm, stale', q: work('12staleask'), checks: SCROLLED },
  { name: 'two waiting, one off the cards', q: work('ask2'), checks: [...LANES, '.work .centre .lanes-hd', '.work .centre .ask-btn'] },
  { name: 'one failed', q: work('failed'), checks: LANES },
  { name: 'older helper answer', q: work('old'), checks: [...LANES, '.work .centre .lanes-hd'] },
  { name: 'one lane', q: work('1'), checks: LANES },
  { name: 'no lane', q: work('0'), checks: [...LANES, '.work .centre .panel'] },
  { name: 'helper not set up', q: work('off'), checks: ['.work .centre', '.work .centre .panel', '.work .centre .centre-note'] },
  // Typical: a meeting and a network alarm wait, but the helper's three lanes ask nothing, so For you
  // shows its two lines only when held; the row itself shows the own set with the amber chip.
  deck('typical: both rows, own set in front, the For you chip', 'keys=typical'),
  deck('general set in front (another app), a layout just clicked: result and Undo showing', 'keys=general', { click: '.pin-tile' }),
  deck('eight keys with long labels', 'keys=many'),
  // The built-in sets as the app lists them: twelve pages, labels that carry their group's name, a For you count.
  deck('library sets: twelve pages, long labels, the For you chip', 'keys=library&hold=lib-vscode'),
  deck('library sets: a held set whose app is not in front', 'keys=library&hold=lib-excel'),
  deck('library sets, Auto, the longest labels pinned', 'keys=library&pins=long'),
  deck('one key only', 'keys=one'),
  // deck pins and stretch: Add counts as a tile and sparse rows fill their width.
  deck('one pin plus Add, one Now key', 'keys=one&hold=one&pins=one'),
  deck('three pins plus Add, two Now keys', 'keys=two&hold=two&pins=three'),
  deck('three pins plus Add, three Now keys', 'keys=three&hold=three&pins=three'),
  deck('a held set refused after a click (the app in front is not its app)', 'keys=wrong', { click: '.keys .key-tile' }),
  deck('Power BI cannot be brought forward, after a click', 'keys=refuse', { click: '.keys .key-tile' }),
  deck('heavy: three things wait (a meeting, an agent asks, an alarm), For you held', 'keys=typical&hold=foryou', { checks: FOR_YOU, q: work('ask', '&keys=typical&hold=foryou') }),
  { name: 'Deck, For you with two lines (no meeting, no alarm)', q: work('ask', '&keys=typical&hold=foryou&meet=none&net=calm'), checks: FOR_YOU },
  { name: 'Deck, sparse For you: only the alarm', q: work('3', '&keys=typical&hold=foryou&meet=none'), checks: FOR_YOU },
  { name: 'Deck, nothing waits: no chip, no For you page', q: work('3', '&keys=typical&meet=none&net=calm'), checks: DECK },
  { name: 'Deck, the agents helper is off: For you says nothing about agents', q: work('off', '&keys=typical&hold=foryou'), checks: FOR_YOU },
  { name: 'Deck, no keys for this app and no general set', q: work('0', '&keys=nogeneral&meet=none&net=calm'), checks: [...DECK_ROWS, '.work .right-wing .deck-quiet'] },
  { name: 'Deck, sparse: no big screen, nothing in front yet', q: work('0', '&keys=idle&arrange=none&meet=none&net=calm'), checks: [...DECK_ROWS, '.work .right-wing .deck-quiet'] },
  { name: 'Deck, keys.json has a problem, no windows for a layout', q: work('3', '&keys=problem&arrange=nowin'), checks: [...DECK_ROWS, '.work .right-wing .deck-quiet'], click: '.pin-tile' },
  // The picker runs over the mountains to just above the timeline, so it is held to the viewport and the timeline rule.
  { name: 'Deck, the key picker open over both rows', q: work('3', '&keys=typical&pins=three'), checks: PICKER, click: '.add-key', viewportOnly: true },
  { name: 'Deck, the key picker open with the library sets', q: work('3', '&keys=library&pins=three'), checks: PICKER, click: '.add-key', viewportOnly: true },
  // keys style: the key colours by day and by night (each key's edge against the sky behind it at
  // least 3 to 1), and the Now row one height on a key page and on the For you page (nowH).
  { name: 'Keys style, day: library sets held on VS Code', q: `?hz=work&at=${encodeURIComponent('2026-11-11T12:10:00-08:00')}&clock=review&weather=ok&keys=library&hold=lib-vscode`, checks: DECK, edges: true, nowH: 'keys' },
  { name: 'Keys style, night: library sets held on VS Code', q: `?hz=work&at=${encodeURIComponent('2026-11-11T22:30:00-08:00')}&clock=review&weather=ok&keys=library&hold=lib-vscode`, checks: DECK, edges: true, nowH: 'keys' },
  { name: 'Keys style, day: held on Excel with VS Code in front (keys that cannot be sent)', q: `?hz=work&at=${encodeURIComponent('2026-11-11T12:10:00-08:00')}&clock=review&weather=ok&keys=library&hold=lib-excel`, checks: DECK, edges: true, nowH: 'keys' },
  { name: 'Keys style, For you with two plates', q: work('ask', '&keys=typical&hold=foryou&meet=none&net=calm'), checks: FOR_YOU, nowH: 'foryou' },
  { name: 'Keys style, For you with one plate', q: work('3', '&keys=typical&hold=foryou&meet=none'), checks: FOR_YOU, nowH: 'foryou' },
  // leave and recording: the banner in its band covering no text or control (over the hidden Agents header on Work),
  // the chip one short line in the header (also with twelve sessions, two waiting, an alarm: its tightest), and the
  // Recording page one height with a key page and For you (nowH).
  { name: 'Leave banner on Work, 12 minutes, long title', q: work('3', '&leave=12'), checks: ['.leave-banner'], viewportOnly: true },
  { name: 'Leave banner on Work, amber, helper not set up', q: work('off', '&leave=4'), checks: ['.leave-banner'], viewportOnly: true },
  { name: 'Leave banner on Work with the Day drawer open', q: work('12ask', '&leave=12&rec=1&meet=overlap'), click: '.rib .rib-handle', checks: ['.leave-banner', '.day-drawer', '.day-drawer .dd-agenda'], strip: true, viewportOnly: true },
  { name: 'Leave banner on Work, leave now with the recording chip', q: work('12ask', '&leave=0&rec=1'), checks: ['.leave-banner', '.leave-banner .rec-chip'], viewportOnly: true },
  { name: 'Leave banner on Home', q: home('moods=five&leave=12'), checks: ['.leave-banner'], viewportOnly: true },
  { name: 'Leave banner on Unwind, amber', q: query({ hz: 'unwind', agents: '3', extra: '&leave=4' }), checks: ['.leave-banner'], viewportOnly: true },
  { name: 'Leave banner on Meet', q: query({ agents: '3', go: 'meet', live: true, extra: '&leave=12' }), checks: ['.leave-banner'], viewportOnly: true },
  { name: 'Recording chip in the Agents header, twelve sessions, two waiting, an alarm', q: work('12ask', '&rec=1'), checks: [...SCROLLED, '.work .centre .lanes-hd .rec-chip'] },
  { name: 'Recording chip in the Agents header, stale helper', q: work('12staleask', '&rec=1'), checks: [...SCROLLED, '.work .centre .lanes-hd .rec-chip'] },
  { name: 'Recording chip on Work with the helper down', q: work('down', '&rec=1'), checks: ['.rec-float'], viewportOnly: true },
  { name: 'Recording chip on Home', q: home('moods=five&rec=1'), checks: ['.rec-float'], viewportOnly: true },
  { name: 'Recording chip on Unwind', q: query({ hz: 'unwind', agents: '3', extra: '&rec=1' }), checks: ['.rec-float'], viewportOnly: true },
  { name: 'Recording page: the Now row, library sets', q: work('3', '&keys=library&rec=1'), checks: DECK, nowH: 'recording' },
  { name: 'Recording page with long titles waiting (For you chip)', q: work('ask', '&keys=typical&rec=1'), checks: DECK, nowH: 'recording' },
  // The Hide screen button grown under the pointer.
  { name: 'Unwind, Hide screen grown', q: query({ hz: 'unwind', agents: '3', extra: '' }), checks: ['.u-line', '.screens-off'], click: 'hover:.screens-off', hide: true, viewportOnly: true },
  // The failure note ("Could not watch input") showing while the pill is grown: the two never meet.
  { name: 'Unwind, Hide screen grown with the failure note', q: query({ hz: 'unwind', agents: '3', extra: '&hide=fail' }), checks: ['.u-line', '.screens-off', '.screens-off-note'], click: '.screens-off then hover:.screens-off', hide: true, note: true, viewportOnly: true },
  { name: 'Home, Sound at its fullest: many moods, many speakers, long names, sleep timer', q: home('sonos=heavy&moods=many'), checks: [...HOME_CENTRE.filter((c) => !c.endsWith('mood-row')), ...SOUND_FULL] },
  { name: 'Home, typical: five moods, Sound playing', q: home('moods=five'), checks: [...HOME_CENTRE, ...SOUND_FULL] },
  { name: 'Home, one matching routine plus More: no blank cell in the quick-play row', q: home('sonos=few&moods=five'), checks: [...HOME_CENTRE, ...SOUND_FULL] },
  { name: 'Home, sparse: no moods, one routine, one speaker', q: home('sonos=sparse&moods=none'), checks: ['.home .home-centre', '.home .moods', ...SOUND_FULL.slice(0, 4)] },
  // Sonos never answers: after the 2.5 second wait the centre settles on the tall-mood fallback.
  { name: 'Home, Sonos silent: the fallback after 2.5 seconds', q: home('sonos=slow&moods=five'), checks: ['.home .home-centre', '.home .mood-row', '.home .sound', '.home .sound-note'] },
  { name: 'Home, Sonos not reachable, moods present', q: home('sonos=down&moods=five'), checks: ['.home .home-centre', '.home .mood-row', '.home .sound', '.home .sound-note'] },
  { name: 'Home, Sonos not reachable and moods not set up: one status card', q: home('sonos=down&moods=off'), checks: ['.home .home-centre', '.home .centre-status'] },
  { name: 'Home, Sonos not set up: the mood cards take the room', q: home('sonos=off&moods=five'), checks: ['.home .home-centre', '.home .mood-row', '.home .sound', '.home .sound-note'] },
  { name: 'Home, both centre sources out: one status card', q: home('sonos=down&moods=down'), checks: ['.home .home-centre', '.home .centre-status'] },
  // The pop-outs float over the band (More opens down over the horizon), so they are held
  // to the viewport only.
  {
    name: 'Home, Speakers pop-out open with many speakers',
    q: home('sonos=heavy&moods=many'),
    click: '.home .sound-anchor > button[aria-expanded]:not(.sound-chip)',
    checks: ['.home .sound-pop', '.home .sound-spk'],
    viewportOnly: true,
  },
  // Its rows scroll inside it, so the pop-out itself is what must fit.
  { name: 'Home, More pop-out open with many routines', q: home('sonos=heavy&moods=many'), click: '.home .sound-chip.more', checks: ['.home .sound-pop'], viewportOnly: true },
  ...QUIET,
  // Watt's menu (a right-click on him), on Work, Home and Unwind (Meet's horizon glides in real time, which this
  // frozen check cannot wait for; the placement test in `buddy/model.test.ts` covers Meet): a pop-up of his own above
  // him, inside the screen, every item at least 34 px tall, every part of it inside the menu, never over him, with
  // its tail over him. It may sit over the cards above him while it is open, as a menu does.
  { name: 'Watt menu on Work', q: work('3', '&meet=none'), checks: ['.watt-menu'], viewportOnly: true, card: true },
  { name: 'Watt menu on Home', q: home('moods=five'), checks: ['.watt-menu'], viewportOnly: true, card: true },
  { name: 'Watt menu on Unwind', q: query({ hz: 'unwind', agents: '3', extra: '' }), checks: ['.watt-menu'], viewportOnly: true, card: true },
  // home round two: the shield card (quiet, open alerts, its drawer), the house line, mood
  // pages and Sound's now-playing strip stay inside the band. Its own rules (five chores and
  // three with alerts, the drawer, the house area, mood card widths) are in home-fit-check.mjs.
  { name: 'Home round two, quiet with the house line', q: home('desk=typical&alerts=0&chores=many&rooms=8'), checks: ['.home .home-right', '.home .network-block', '.home .chores', '.home .home-wing', '.home .house'] },
  { name: 'Home round two, twenty alerts, twelve moods, a track on a speaker', q: home('desk=typical&alerts=20&moods=12&spotifyplay=speaker&chores=many'), checks: ['.home .home-right', '.home .network-block', '.home .mood-row', '.home .sound-panel', '.home .sound-np', '.home .sound-plays'] },
  { name: 'Home round two, the alert drawer open', q: home('desk=typical&alerts=20'), click: '.panel.network.shield', checks: ['.home .shield-drawer'], viewportOnly: true },
  // end home round two
  ...TOOLS_VARIANTS,
];
// The calm strip on Work: 104 px with folded overlaps, the Day drawer and the Agents today panel
// inside the stage, below the clock and right of the rail, and the panel's rows at least 32 px.
VARIANTS.push(
  { name: 'Strip: overlaps, twelve sessions', q: work('12ask', '&meet=overlap'), checks: ['.rib'], strip: true, viewportOnly: true },
  { name: 'Strip: the needle at the centre, under the handle', q: query({ at: '2026-11-11T14:50:00-08:00', agents: '12ask', extra: '&meet=overlap' }), checks: ['.rib'], strip: true, viewportOnly: true },
  { name: 'Strip: late in the day', q: query({ at: '2026-11-11T22:50:00-08:00', agents: '12ask', extra: '&meet=overlap' }), checks: ['.rib'], strip: true, viewportOnly: true },
  { name: 'Strip: the Day drawer open', q: work('12ask', '&meet=overlap'), click: '.rib .rib-handle', checks: ['.day-drawer', '.day-drawer .dd-agenda', '.day-drawer .dd-rows'], strip: true, viewportOnly: true },
  { name: 'Strip: Agents today, twelve sessions', q: work('12ask', '&days=typical'), click: '.rib .ag-line', checks: ['.agents-today', '.agents-today .at-head'], strip: true, viewportOnly: true },
  { name: 'Strip: Agents today, a heavy past day', q: work('12', '&days=heavy'), click: '.rib .ag-line >> .at-seg button:nth-child(2)', checks: ['.agents-today', '.agents-today .at-head', '.agents-today .at-foot'], strip: true, viewportOnly: true },
);
// keys style: a small PNG reader (8-bit RGB or RGBA, not interlaced, as Chromium writes them) and contrast.
function readPng(file) {
  const buf = readFileSync(file);
  let at = 8;
  let w = 0;
  let h = 0;
  let ch = 4;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('ascii', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      ch = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(w * h * ch);
  const stride = w * ch;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const v = raw[y * (stride + 1) + 1 + i];
      const a = i >= ch ? px[y * stride + i - ch] : 0;
      const b = y > 0 ? px[(y - 1) * stride + i] : 0;
      const c = i >= ch && y > 0 ? px[(y - 1) * stride + i - ch] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      px[y * stride + i] = (v + pred) & 255;
    }
  }
  return { w, h, ch, px };
}
function pixels(img, x0, y0, x1, y1) {
  const out = [];
  for (let y = Math.max(0, y0); y < Math.min(img.h, y1); y++)
    for (let x = Math.max(0, x0); x < Math.min(img.w, x1); x++) {
      const i = (y * img.w + x) * img.ch;
      out.push([img.px[i], img.px[i + 1], img.px[i + 2]]);
    }
  return out;
}
const median = (list) => [0, 1, 2].map((k) => list.map((p) => p[k]).sort((a, b) => a - b)[list.length >> 1] ?? 0);
function contrast(a, b) {
  const lum = (c) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Rounding slack for fractional rectangles, in screen pixels. */
const SLACK = 0.5;

const out = mkdtempSync(join(tmpdir(), 'wall-fit-check-'));
onCleanup(() => rmSync(out, { recursive: true, force: true }));
try {
  await build({
    root,
    configFile: join(root, 'vite.config.ts'),
    mode: 'development',
    base: './',
    logLevel: 'warn',
    build: {
      outDir: join(out, 'dist'),
      emptyOutDir: true,
      assetsInlineLimit: 100_000_000,
      cssCodeSplit: false,
      modulePreload: false,
      chunkSizeWarningLimit: 100_000,
      rolldownOptions: { output: { codeSplitting: false } },
    },
  });

  // One file: module scripts and stylesheets cannot load from file:// as separate files.
  const dist = join(out, 'dist');
  let html = readFileSync(join(dist, 'index.html'), 'utf8');
  html = html.replace(/<script type="module" crossorigin src="\.\/([^"]+)"><\/script>/g, (_, src) =>
    `<script type="module">${readFileSync(join(dist, src), 'utf8').replaceAll('</script', '<\\/script')}</script>`,
  );
  html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/([^"]+)">/g, (_, href) => `<style>${readFileSync(join(dist, href), 'utf8')}</style>`);
  // For each checked box: its scroll sizes, and how far it sticks out of its container and
  // of the viewport on each side (screen pixels, 0 when inside). Plus the page's own scroll.
  const measure = `<script>setTimeout(() => {
    // unwind listen: measured at the end of the songs view's slide (virtual time draws no frames for it to run).
    if (new URLSearchParams(location.search).get('listen')) { const st = document.createElement('style'); st.textContent = '.sp-songs { animation: none !important; }'; document.head.appendChild(st); }
    // Steps separated by " >> " run 300 ms apart; within a step, " then " runs them at once.
    (new URLSearchParams(location.search).get('click') ?? '').split(' >> ').filter(Boolean).forEach((step, i) => setTimeout(() => {
    for (const click of step.split(' then ').filter(Boolean)) {
    if (click.startsWith('ctx:')) document.querySelector(click.slice(4))?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    else if (click.startsWith('hover:')) {
      // Headless --dump-dom has no pointer: every top-level :hover rule is copied for a class that stands in for it.
      const extra = [];
      for (const sheet of document.styleSheets) for (const r of sheet.cssRules) if (r.selectorText && r.selectorText.includes(':hover')) extra.push(r.cssText.replaceAll(':hover', '.fit-hover'));
      // Measured at the end of its transition (virtual time draws no frames for one to run).
      extra.push('.fit-hover, .fit-hover * { transition: none !important; }');
      const st = document.createElement('style'); st.textContent = extra.join(' '); document.head.appendChild(st);
      document.querySelector(click.slice(6))?.classList.add('fit-hover');
    }
    else document.querySelector(click)?.click();
    }
    }, i * 300));
    // Watt's card: asked for until it is open (Meet's horizon takes a few seconds to settle first).
    if (new URLSearchParams(location.search).get('card')) {
      const ask = () => { if (!document.querySelector('.watt-menu')) document.querySelector('.watt-hit')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); };
      ask();
      setInterval(ask, 300);
    }
  }, 2000);
  setTimeout(() => {
    const sels = new URLSearchParams(location.search).get('checks').split('|');
    const band = document.querySelector('.top');
    const out = (r, c) => ({ l: c.left - r.left, r: r.right - c.right, t: c.top - r.top, b: r.bottom - c.bottom });
    const view = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const res = sels.map((sel) => ({ sel, items: [...document.querySelectorAll(sel)].map((e) => {
      const box = e.getBoundingClientRect();
      // The Zen controls column holds its hint. Dream covers the whole stage (its text also drifts up to 15 px each way), so it is held by itself, not the band.
      const holder = e.closest('.dream') || e.closest('.zen-bl') || e.parentElement.closest('.centre') || band || document.documentElement;
      return { sw: e.scrollWidth, cw: e.clientWidth, sh: e.scrollHeight, ch: e.clientHeight,
        inHolder: out(box, holder.getBoundingClientRect()), inView: out(box, view) };
    }) }));
    const d = document.documentElement;
    const rows = new Set([...document.querySelectorAll('.u-chip')].map((e) => Math.round(e.getBoundingClientRect().top))).size;
    const page = { rows, sw: d.scrollWidth, cw: d.clientWidth, sh: d.scrollHeight, ch: d.clientHeight, vw: innerWidth, vh: innerHeight };
    // Pairs of boxes that must never share pixels: agent hit boxes of different sessions (the
    // "+N more" label counts as its own), and calendar chips in the same lane.
    const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    const agentBoxes = [...document.querySelectorAll('.rib .agent-row .sg-hit, .rib .agent-row .sg-more')].map((e) => ({ id: e.dataset.lane || 'more', r: e.getBoundingClientRect() }));
    // Calendar chips (stacked lanes included), the all-day chip, "+N" chips and the titles written beside short chips.
    const chipBoxes = [...document.querySelectorAll('.rib .ev, .rib .ev-side')].map((e) => ({ r: e.getBoundingClientRect(), t: e.textContent || e.getAttribute('aria-label') }));
    const overlaps = [];
    agentBoxes.forEach((a, i) => agentBoxes.slice(i + 1).forEach((b) => { if (a.id !== b.id && hit(a.r, b.r)) overlaps.push('agent ' + a.id + ' / ' + b.id); }));
    chipBoxes.forEach((a, i) => chipBoxes.slice(i + 1).forEach((b) => { if (hit(a.r, b.r)) overlaps.push('chip ' + a.t + ' / ' + b.t); }));
    // A card line that cuts its words while more than 60 px of it sits unused.
    const cut = [...document.querySelectorAll('.work .centre .lane .lt2')].flatMap((line, i) => {
      const kids = [...line.children].filter((k) => !k.hidden);
      const truncated = kids.some((k) => k.scrollWidth > k.clientWidth + 1);
      const right = Math.max(...kids.map((k) => k.getBoundingClientRect().right));
      const unused = line.getBoundingClientRect().right - right;
      return truncated && unused > 60 ? ['card ' + i + ' line cut with ' + Math.round(unused) + ' px unused'] : [];
    });
    // Stage labels on a card's track (the "Hold to merge" card has the narrowest): no two closer than 8 px.
    const gaps = [...document.querySelectorAll('.work .centre .lane .jr')].flatMap((jr, i) => {
      const ems = [...jr.querySelectorAll('.jn em')].map((e) => e.getBoundingClientRect()).sort((a, b) => a.left - b.left);
      return ems.slice(1).flatMap((r, k) => (r.left - ems[k].right < 8 ? ['stage labels on card ' + i + ': gap ' + Math.round((r.left - ems[k].right) * 10) / 10 + ' px between label ' + k + ' and ' + (k + 1)] : []));
    });
    // Watt's menu: item heights, parts outside the menu, whether it covers him, and where its tail points.
    let wattCard = null;
    const card = document.querySelector('.watt-menu');
    if (card) {
      const cr = card.getBoundingClientRect();
      const heights = [...card.querySelectorAll('button')].map((b) => b.getBoundingClientRect().height);
      const outside = [...card.querySelectorAll('button, .wm-name, .wm-mood, .wm-days, .wm-today, .wm-gp, .wm-fl')].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.left < cr.left - 0.5 || r.right > cr.right + 0.5 || r.top < cr.top - 0.5 || r.bottom > cr.bottom + 0.5;
      }).length;
      const me = document.querySelector('.watt-hit').getBoundingClientRect();
      const tail = cr.left + parseFloat(card.style.getPropertyValue('--tail')) + 7;
      const covered = [];
      if (hit(me, cr)) covered.push('Watt himself');
      if (tail < me.left - 1 || tail > me.right + 1) covered.push('tail not over him (tail ' + Math.round(tail) + ', him ' + Math.round(me.left) + ' to ' + Math.round(me.right) + ')');
      // The smallest text in the menu (16 px at least, to read on the strip at 100 percent).
      const minFont = Math.min(...[...card.querySelectorAll('*')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((e) => parseFloat(getComputedStyle(e).fontSize)));
      wattCard = { heights, outside, covered, buttons: heights.length, minFont };
    }
    // Work's agents header: every part one line tall (no text in it wraps, no part taller than the 36 px row).
    const header = [...document.querySelectorAll('.work .centre .lanes-hd *')].flatMap((e) => {
      const own = [...e.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
      const tops = new Set();
      for (const n of own) {
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const q of range.getClientRects()) if (q.width > 0) tops.add(Math.round(q.top));
      }
      const tall = e.matches('.lanes-hd-l > *, .lanes-hd > .row > *') && e.getBoundingClientRect().height > 36.5;
      return tops.size > 1 || tall ? ['header part wraps: ' + (e.textContent || '').trim().slice(0, 48) + ' (' + Math.round(e.getBoundingClientRect().height) + ' px tall)'] : [];
    });
    // The deck (Always here and Now): nothing below its floor (a clearance above the mountain
    // ridge, worked out from the Work camera; the Now row carries it as data-floor), every key
    // label inside its tile, no two tiles sharing pixels, and the Now heading never cut.
    const deck = [];
    // deck and drawer fixes: how far the lowest thing the deck draws sits above its floor (px).
    let deckRoom = null;
    const floorEl = document.querySelector('.work .right-wing .keys[data-floor]');
    const deckEl = document.querySelector('.work .right-wing .deck');
    if (deckEl) {
      const floor = floorEl ? Number(floorEl.dataset.floor) : Infinity;
      if (!floorEl && document.querySelector('.work .right-wing .keys')) deck.push('deck: the Now row carries no data-floor, so its floor cannot be checked');
      let low = null;
      let lowest = -Infinity;
      // What the deck draws: its rows and their parts (the box itself is empty room). The open key
      // picker may run past the floor over the mountains; it is held to the timeline below.
      for (const e of deckEl.querySelectorAll('*')) {
        if (e.closest('.pk')) continue;
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || getComputedStyle(e).visibility === 'hidden') continue;
        lowest = Math.max(lowest, r.bottom);
        if (r.bottom > floor + 0.5 && (low === null || r.bottom > low.b)) low = { b: r.bottom, t: (e.className && e.className.baseVal === undefined ? e.className : e.tagName) };
      }
      if (Number.isFinite(floor) && Number.isFinite(lowest)) deckRoom = Math.round((floor - lowest) * 10) / 10;
      // deck and drawer fixes: the 70 px tiles leave about 4 px above the floor in the right wing, so the message says so.
      if (low) deck.push('deck: ' + low.t + ' reaches y ' + Math.round(low.b) + ', below the floor at ' + floor + ' (the deck has only about 4 px of room above its floor with 70 px tiles; a change that needs more height has to take it from the wing, not from this margin)');
      const tiles = [...deckEl.querySelectorAll('.deck-tile')].map((t) => ({ t, r: t.getBoundingClientRect() }));
      for (const { t, r } of tiles) {
        const l = t.querySelector('.deck-lbl');
        if (!l) continue;
        const q = l.getBoundingClientRect();
        if (q.left < r.left - 0.5 || q.right > r.right + 0.5 || q.top < r.top - 0.5 || q.bottom > r.bottom + 0.5 || l.scrollWidth > l.clientWidth + 1) deck.push('deck: label "' + l.textContent + '" runs outside its tile');
      }
      tiles.forEach((a, i) => tiles.slice(i + 1).forEach((b) => { if (hit(a.r, b.r)) deck.push('deck: tiles "' + a.t.textContent + '" and "' + b.t.textContent + '" share pixels'); }));
      // deck and drawer fixes: every key tile is one height (70: 6 padding, a 20 icon box, a 4 gap, a 32 label
      // area of two lines, 6 padding, a 1 px edge each side), every icon sits at the same offset and inside its
      // icon box (never into the label area, never against the tile's edge).
      const keyTiles = [...deckEl.querySelectorAll('.deck-tile.key-tile')];
      const iconAt = (t) => { const i = t.querySelector('svg'); return i ? Math.round((i.getBoundingClientRect().top - t.getBoundingClientRect().top) * 10) / 10 : null; };
      for (const t of keyTiles) {
        const r = t.getBoundingClientRect();
        const name = t.getAttribute('aria-label') ?? t.textContent;
        if (Math.abs(r.height - 70) > 0.5) deck.push('deck: key tile "' + name + '" is ' + Math.round(r.height * 10) / 10 + ' px tall (every key tile is 70)');
        const ic = t.querySelector('svg');
        if (!ic) continue;
        const q = ic.getBoundingClientRect();
        const row = t.closest('.deck-tiles');
        const peer = row?.querySelector('.deck-tile.key-tile');
        if (peer && Math.abs(iconAt(t) - iconAt(peer)) > 0.5) deck.push('deck: the icon of key tile "' + name + '" sits ' + iconAt(t) + ' px below its tile top, its row first one sits ' + iconAt(peer) + ' px');
        const wide = row?.classList.contains('wide');
        const up1 = row?.classList.contains('up1');
        const minY = wide ? 20 : up1 ? 7 : 7;
        const maxY = wide ? 50 : up1 ? 32 : 27;
        if (q.top < r.top + minY - 0.5 || q.bottom > r.top + maxY + 0.5 || q.left < r.left + 1 - 0.5 || q.right > r.right - 1 + 0.5) deck.push('deck: the icon of key tile "' + name + '" is not inside its icon box');
      }
      // deck pins and stretch: each row has equal tiles and fills its available width exactly.
      for (const row of deckEl.querySelectorAll('.deck-tiles')) {
        const rr = row.getBoundingClientRect();
        const rowTiles = [...row.children].map((child) => child.matches('.key-tile-wrap') ? child.querySelector('.key-tile') : child).filter((child) => child?.matches?.('.key-tile')).map((child) => child.getBoundingClientRect());
        if (!rowTiles.length) continue;
        if (rowTiles.some((r) => Math.abs(r.width - rowTiles[0].width) > 0.5 || Math.abs(r.height - rowTiles[0].height) > 0.5)) deck.push('deck: tiles in one row do not share one width and height');
        if (Math.abs(rowTiles[0].left - rr.left) > 0.5 || Math.abs(rowTiles[rowTiles.length - 1].right - rr.right) > 0.5) deck.push('deck: a tile row does not fill its width');
      }
      const menu = deckEl.querySelector('.key-menu');
      if (menu) {
        const mr = menu.getBoundingClientRect();
        const sr = document.querySelector('.stage')?.getBoundingClientRect();
        const handle = document.querySelector('.rib-handle')?.getBoundingClientRect();
        if (sr && (mr.left < sr.left || mr.right > sr.right || mr.top < sr.top || mr.bottom > sr.bottom)) deck.push('deck: the key menu leaves the stage');
        if (handle && hit(mr, handle)) deck.push('deck: the key menu covers the bottom strip handle');
      }
      // The open key picker runs down to just above the timeline and never covers it: its
      // bottom at least 16 px (the gap between the main rows) above the ribbon's top.
      const pk = deckEl.querySelector('.pk');
      const rib = document.querySelector('.rib');
      if (pk && rib) {
        const pb = pk.getBoundingClientRect().bottom;
        const rt = rib.getBoundingClientRect().top;
        if (pb > rt - 16 + 0.5) deck.push('deck: the key picker reaches y ' + Math.round(pb) + ', over the timeline gap (the timeline starts at ' + Math.round(rt) + ')');
        else if (pb < rt - 16 - 2) deck.push('deck: the key picker stops at y ' + Math.round(pb) + ', short of the timeline gap at ' + Math.round(rt - 16));
        const list = pk.querySelector('.pk-list');
        if (list && getComputedStyle(list).scrollbarWidth !== 'thin') deck.push('deck: the key picker list has the native scrollbar');
      }
      const name = document.querySelector('.work .right-wing .keys .deck-hd .k');
      const ctl = document.querySelector('.work .right-wing .keys .deck-hd-r');
      if (name) {
        const nr = name.getBoundingClientRect();
        const cut = name.scrollWidth > name.clientWidth + 1 || (ctl && hit(nr, ctl.getBoundingClientRect())) || nr.right > deckEl.getBoundingClientRect().right + 0.5;
        if (cut) deck.push('deck: the Now heading "' + name.textContent + '" is cut');
      }
    }
    // The calm strip: its height, labels that share pixels, the folded chip's count, the
    // overlays inside the stage below the clock and right of the rail, the panel's row heights.
    const strip = [];
    const ribW = document.querySelector('.rib[data-kind="work"]');
    if (ribW) {
      const h = ribW.getBoundingClientRect().height;
      if (Math.abs(h - 104) > 0.5) strip.push('strip: the Work strip is ' + Math.round(h) + ' px tall (must be 104)');
      const labels = [...ribW.querySelectorAll('.ev, .ev-side, .ag-line, .due:not(.bare), .adbar')].map((e) => ({ r: e.getBoundingClientRect(), t: (e.textContent || e.getAttribute('aria-label') || '').slice(0, 30) }));
      labels.forEach((a, i) => labels.slice(i + 1).forEach((b) => { if (hit(a.r, b.r)) strip.push('strip: labels share pixels: ' + a.t + ' / ' + b.t); }));
      // The drawer handle covers no chip, bar or label.
      const handle = ribW.querySelector('.rib-handle');
      if (handle) {
        const hr = handle.getBoundingClientRect();
        for (const e of ribW.querySelectorAll('.ev, .ev-side, .adbar, .hl, .ndl b, .ag-line, .due, .agent-row .ac')) if (hit(hr, e.getBoundingClientRect())) strip.push('strip: the drawer handle covers ' + (e.textContent || e.className).trim().slice(0, 30));
      }
      for (const f of ribW.querySelectorAll('.ev.fold')) {
        const n = f.querySelector('.fold-n');
        const fr = f.getBoundingClientRect();
        if (n && (n.scrollWidth > n.clientWidth + 1 || n.getBoundingClientRect().right > fr.right - 4)) strip.push("strip: the folded chip's count is cut: " + n.textContent);
      }
    }
    const clk = document.querySelector('.clk');
    const rail = document.querySelector('.rail');
    for (const sel of ['.day-drawer', '.agents-today']) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clk && r.top < clk.getBoundingClientRect().bottom - 0.5) strip.push('strip: ' + sel + ' reaches above the clock (top ' + Math.round(r.top) + ')');
      if (r.left < 0 || r.top < 0 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) strip.push('strip: ' + sel + ' sticks out of the stage');
      if (rail && r.left < rail.getBoundingClientRect().right - 0.5) strip.push('strip: ' + sel + ' covers the rail');
    }
    // deck and drawer fixes: with the drawer open the page behind it is behind one scrim (the element at an
    // agent card's, a task's and a rail key's place is the scrim, so no click reaches them), the drawer is above
    // the scrim, and the leave banner and the recording chip are above it too (readable).
    const dd = document.querySelector('.day-drawer');
    if (dd) {
      const scrim = document.querySelector('.drawer-scrim');
      if (!scrim) strip.push('strip: with the drawer open, there is no scrim behind it');
      else {
        const dr = dd.getBoundingClientRect();
        for (const [what, sel, need] of [['an agent card', '.work .centre .lane', true], ['a task', '.work .right-wing .tk3', false], ['a rail key', '.rail .rb', false]]) {
          const e = document.querySelector(sel);
          if (!e) { if (need) strip.push('strip: with the drawer open, no agent card shows above it to test'); continue; }
          const r = e.getBoundingClientRect();
          const lo = r.top;
          const hi = Math.min(r.bottom, dr.top);
          if (hi - lo < 6) { if (need) strip.push('strip: with the drawer open, no agent card shows above it to test'); continue; }
          const x = Math.round((r.left + r.right) / 2);
          const y = Math.round((lo + hi) / 2);
          const at = document.elementFromPoint(x, y);
          if (!at || !at.closest('.drawer-scrim')) strip.push('strip: with the drawer open, a click at ' + what + ' (' + x + ', ' + y + ') lands on ' + (at ? at.tagName + '.' + String(at.className).slice(0, 30) : 'nothing') + ', not on the scrim');
        }
        const z = (e) => Number(getComputedStyle(e).zIndex);
        if (!(z(dd) > z(scrim))) strip.push('strip: with the drawer open, the drawer is not above the scrim');
        for (const keep of document.querySelectorAll('.leave-banner, .rec-float')) if (!(z(keep) > z(scrim))) strip.push('strip: with the drawer open, ' + keep.className + ' is not above the scrim, so its words would be dimmed');
      }
    }
    for (const row of document.querySelectorAll('.agents-today .at-row:not(.skel), .day-drawer .dd-row')) {
      const h = row.getBoundingClientRect().height;
      if (h < 32 - 0.5) strip.push('strip: an Agents today row is ' + Math.round(h) + ' px tall (at least 32)');
    }
    const opened = { drawer: !!document.querySelector('.day-drawer'), panel: !!document.querySelector('.agents-today'), rows: document.querySelectorAll('.agents-today .at-row:not(.skel)').length };
    // The Tools drawer: inside x 1700 to 2560 and y 0 to 720, clear of the rail, and no text cut unless a hover card carries it.
    const toolsOut = [];
    const drawer = document.querySelector('.tools-drawer');
    if (drawer) {
      const dr = drawer.getBoundingClientRect();
      const rail = document.querySelector('.rail');
      if (dr.left < 1700 - 0.5 || dr.right > 2560 + 0.5 || dr.top < -0.5 || dr.bottom > 720 + 0.5) toolsOut.push('tools drawer: x ' + Math.round(dr.left) + ' to ' + Math.round(dr.right) + ', y ' + Math.round(dr.top) + ' to ' + Math.round(dr.bottom) + ' is outside x 1700 to 2560, y 0 to 720');
      if (rail && hit(dr, rail.getBoundingClientRect())) toolsOut.push('tools drawer: covers the rail');
      for (const e of drawer.querySelectorAll('.tools-name, .tools-srcname, .tools-line, .tools-hint, .tools-note, .tools-chip, .tools-btn, .tools-faint')) {
        if (e.scrollWidth > e.clientWidth + 1 && !e.closest('[data-tip]')) toolsOut.push('tools: "' + (e.textContent || '').trim().slice(0, 40) + '" is cut with no tooltip');
        // The row's hover card does not excuse a cut name or a cut read time: those cells must show whole.
        else if (e.matches('.tools-name, .tools-srcname, [data-kind="time"]') && e.scrollWidth > e.clientWidth + 1) toolsOut.push('tools: "' + (e.textContent || '').trim().slice(0, 40) + '" is cut with no tooltip of its own');
      }
    }
    // Meet's upper right is never an empty gap: a card reaches the right edge of the stage.
    const meetOut = [];
    const meetBody = document.querySelector('.meet .meet-body');
    if (meetBody) {
      const rights = [...meetBody.querySelectorAll(':scope > .panel')].map((e) => e.getBoundingClientRect().right);
      const farthest = rights.length ? Math.max(...rights) : 0;
      // In every state (a meeting, nothing scheduled, not set up, a failed read, no calendar readable) the Later card takes the freed upper right.
      if (farthest < 2500) meetOut.push('meet: nothing fills the upper right (the last card ends at x ' + Math.round(farthest) + ', the stage is 2560 wide)');
    }
    // keys style: the Now row's height, each key's box, and the grown Hide screen pill.
    const nowEl = document.querySelector('.work .right-wing .keys');
    const nowH = nowEl ? Math.round(nowEl.getBoundingClientRect().height * 10) / 10 : null;
    // Each key's box, for the edge contrast read from a screenshot of the same state (below).
    const edges = [...document.querySelectorAll('.work .right-wing .deck-tile.key-tile')].map((t) => {
      const r = t.getBoundingClientRect();
      return { label: t.getAttribute('aria-label'), x: r.left, y: r.top, w: r.width, h: r.height };
    });
    let hide = null;
    const so = document.querySelector('.screens-off');
    if (so) {
      const pr = so.getBoundingClientRect();
      const box = so.parentElement.getBoundingClientRect();
      const foot = [...document.querySelectorAll('.u-foot, .u-foot *')].filter((e) => { const q = e.getBoundingClientRect(); return q.width > 0 && q.height > 0 && hit(q, pr); }).length;
      const room = [...document.querySelectorAll('.u-room')].filter((e) => hit(e.getBoundingClientRect(), pr)).length;
      const grown = so.matches(':focus-visible, :hover, .fit-hover');
      // Unwind's lower right corner: under the Room card, from the right column's left edge to the screen's edge.
      const ur = document.querySelector('.u-right')?.getBoundingClientRect();
      const rb = Math.max(0, ...[...document.querySelectorAll('.u-room')].map((e) => e.getBoundingClientRect().bottom));
      const inCorner = !!ur && pr.left >= ur.left - 0.5 && pr.top >= rb - 0.5 && pr.right <= innerWidth + 0.5 && pr.bottom <= innerHeight + 0.5;
      const ne = document.querySelector('.screens-off-note');
      const nr = ne ? ne.getBoundingClientRect() : null;
      const note = nr ? { overlap: hit(nr, pr), inCorner: !!ur && nr.left >= ur.left - 0.5 && nr.top >= rb - 0.5 && nr.right <= innerWidth + 0.5 && nr.bottom <= innerHeight + 0.5 } : null;
      hide = { note, inCorner, w: Math.round(pr.width), right: Math.round((box.right - pr.right) * 10) / 10, bottom: Math.round((box.bottom - pr.bottom) * 10) / 10, foot, room, grown, label: so.textContent };
    }
    // left wing: the three music buttons on one line, equal size, inside the wing and clear of the
    // title; the TEMP header centred over both temperature numbers (2 px); every round control, and the
    // focus ring, with a border-radius of at least half its size, so its outline and shadow are round.
    const lw = [];
    const wing = document.querySelector('.work .left-wing');
    const mini = wing && wing.querySelector('.music-mini');
    if (mini) {
      const bs = [...mini.querySelectorAll('.music-mini-btns .rd')].map((b) => b.getBoundingClientRect());
      const wr = wing.getBoundingClientRect();
      const tr = mini.querySelector('.music-mini-text').getBoundingClientRect();
      if (bs.length !== 3) lw.push('left wing: music buttons: ' + bs.length + ' found, 3 wanted');
      else {
        const sameLine = bs.every((r) => Math.abs(r.top - bs[0].top) <= 1);
        const equal = bs.every((r) => Math.abs(r.width - bs[0].width) <= 0.5 && Math.abs(r.height - bs[0].height) <= 0.5);
        const inside = bs.every((r) => r.left >= wr.left - 0.5 && r.right <= wr.right + 0.5);
        const clear = bs.every((r) => r.left >= tr.right - 0.5);
        if (!inside) lw.push('left wing: music buttons leave the wing');
        if (!clear) lw.push('left wing: music buttons overlap the title');
        if (!sameLine || !equal) lw.push('left wing: music buttons are not on one line and equal in size (line ' + sameLine + ', equal ' + equal + ')');
      }
    }
    const hd = wing && wing.querySelector('.mc-hd span:last-child');
    if (hd) {
      const mid = (e) => { const r = e.getBoundingClientRect(); const g = document.createRange(); g.selectNodeContents(e); const t = g.getBoundingClientRect(); return (t.left + t.right) / 2 || (r.left + r.right) / 2; };
      const hm = mid(hd);
      for (const n of wing.querySelectorAll('.mc-row .mc-temp')) {
        const d = Math.abs(mid(n) - hm);
        if (d > 2) lw.push('left wing: TEMP header is ' + d.toFixed(1) + ' px off the centre of "' + n.textContent + '" (2 px allowed)');
      }
    }
    for (const e of wing ? wing.querySelectorAll('.rd, .focus-mini-ring, .ring') : []) {
      const r = e.getBoundingClientRect();
      const rad = parseFloat(getComputedStyle(e).borderTopLeftRadius) || 0;
      if (rad < Math.min(r.width, r.height) / 2 - 0.5) lw.push('left wing: round control ' + (e.getAttribute('aria-label') || e.className) + ' has a corner radius of ' + rad + ' px, under half its ' + Math.round(r.width) + ' px size');
    }
    // Keyboard focus: each control focused in turn must show an outline that is visible (width,
    // style, a colour with some opacity that is not the control's own fill) and round.
    for (const e of wing ? wing.querySelectorAll('.rd, .focus-mini-ring') : []) {
      // deck and drawer fixes: behind the open Day drawer the wing is inert and takes no focus, on purpose.
      if (e.disabled || e.closest('[inert]')) continue;
      const name = e.getAttribute('aria-label') || e.className;
      e.focus();
      const cs = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      const rad = parseFloat(cs.borderTopLeftRadius) || 0;
      const alpha = (cs.outlineColor.match(/[0-9.]+/g) || []).slice(3)[0];
      const visible = document.activeElement === e && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && (alpha === undefined || parseFloat(alpha) > 0) && cs.outlineColor !== cs.backgroundColor;
      if (!visible) lw.push('left wing: focus outline on ' + name + ' is missing or invisible when focused (' + cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor + ', focused ' + (document.activeElement === e) + ')');
      else if (rad < Math.min(r.width, r.height) / 2 - 0.5) lw.push('left wing: focus outline on ' + name + ' is square (radius ' + rad + ' px)');
      e.blur();
    }
    // leave and recording: the banner inside x 600 to 1940 and its band (Work: the top band, y 0 to 70; elsewhere the
    // empty band above the ribbon, y 510 to 600), carrying its parts inside it and covering no text or control; the chip
    // one line (32 px) and at most 200 px wide, in the Agents header, in the banner, or in the band.
    const sig = [];
    for (const b of document.querySelectorAll('.leave-banner, .rec-float')) {
      const [bandTop, bandBottom] = b.dataset.band === 'top' ? [0, 70] : [510, 600];
      const name = b.matches('.leave-banner') ? 'leave banner' : 'recording chip';
      const r = b.getBoundingClientRect();
      if (r.left < 600 - 0.5 || r.right > 1940 + 0.5 || r.top < bandTop - 0.5 || r.bottom > bandBottom + 0.5) sig.push(name + ': at x ' + Math.round(r.left) + ' to ' + Math.round(r.right) + ', y ' + Math.round(r.top) + ' to ' + Math.round(r.bottom) + ' (must be inside x 600 to 1940 and y ' + bandTop + ' to ' + bandBottom + ')');
      for (const k of b.querySelectorAll('*')) {
        const q = k.getBoundingClientRect();
        if (q.width > 0 && (q.left < r.left - 0.5 || q.right > r.right + 0.5 || q.top < r.top - 0.5 || q.bottom > r.bottom + 0.5)) sig.push(name + ': ' + (k.textContent || k.className).toString().trim().slice(0, 30) + ' leaves the banner');
      }
      for (const e of document.querySelectorAll('.shell *')) {
        const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!own && !e.matches('button, a, input, select, textarea, [role=button], [tabindex]')) continue;
        const cs = getComputedStyle(e);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
        // A control by its box; plain text by the box of its words (a wide label box holds empty room).
        let q = e.getBoundingClientRect();
        if (!e.matches('button, a, input, select, textarea, [role=button], [tabindex]')) {
          const range = document.createRange();
          range.selectNodeContents(e);
          const words = [...e.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
          const rects = words.flatMap((n) => { const g = document.createRange(); g.selectNodeContents(n); return [...g.getClientRects()]; }).filter((x) => x.width > 0);
          q = rects.find((x) => hit(x, r)) || { width: 0, height: 0 };
        }
        // Only what shows counts: a box cut by every ancestor that clips (a scrolled list hides its far rows).
        if (q.width > 0) for (let a = e.parentElement; a; a = a.parentElement) {
          const ac = getComputedStyle(a);
          if (ac.overflowX === 'visible' && ac.overflowY === 'visible') continue;
          const c = a.getBoundingClientRect();
          const l = Math.max(q.left, c.left), t = Math.max(q.top, c.top), rr = Math.min(q.right, c.right), bb = Math.min(q.bottom, c.bottom);
          q = { left: l, top: t, right: rr, bottom: bb, width: Math.max(0, rr - l), height: Math.max(0, bb - t) };
        }
        if (q.width > 0 && q.height > 0 && hit(q, r)) sig.push(name + ': covers ' + (e.textContent || '').trim().slice(0, 30) + ' (' + e.tagName.toLowerCase() + '.' + (typeof e.className === 'string' ? e.className : '') + ')');
      }
    }
    for (const c of document.querySelectorAll('.rec-chip')) {
      const q = c.getBoundingClientRect();
      const hd = c.closest('.lanes-hd');
      const tops = new Set();
      const walk = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const g = document.createRange();
        g.selectNodeContents(n);
        for (const t of g.getClientRects()) if (t.width > 0) tops.add(Math.round(t.top / 4));
      }
      if (q.height > 32.5 || q.width > 200.5 || tops.size > 1 || (hd && (hd.scrollWidth > hd.clientWidth + 1 || q.right > hd.getBoundingClientRect().right + 0.5))) sig.push('recording chip: ' + Math.round(q.width) + ' x ' + Math.round(q.height) + ' px, ' + tops.size + ' lines' + (hd ? ', header scroll ' + hd.scrollWidth + ' of ' + hd.clientWidth : '') + ' (one 32 px line, at most 200 px wide, inside its header)');
    }
    // Hit tests: each named control must get the pointer at its own centre, and no point of the
    // sky (a grid over the top band) may land on a layer that only draws the video.
    const hits = (new URLSearchParams(location.search).get('hits') || '').split('|').filter(Boolean).map((sel) => {
      const e = [...document.querySelectorAll(sel)].find((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      if (!e) return { sel, found: false };
      const r = e.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const h = document.elementFromPoint(x, y);
      const owner = e.closest('.watt-hit') || e;
      const ok = !!h && (owner === h || owner.contains(h));
      return { sel, found: true, ok, x: Math.round(x), y: Math.round(y), got: h ? (h.className && h.className.baseVal === undefined ? h.className : h.tagName) : 'nothing' };
    });
    const noHit = new URLSearchParams(location.search).get('nohit');
    const grid = [];
    if (noHit) for (let y = 30; y < 720; y += 40) for (let x = 130; x < 2560; x += 80) { const h = document.elementFromPoint(x, y); if (h && h.closest(noHit)) grid.push(x + ',' + y); }
    // unwind listen: the player ends above y 300 and left of the card; the Spotify card stays in x 1740
    // to 2540 and above y 510; Up next stays in the wing and above the horizon (y 505); nothing that
    // draws (text, an image, a control) enters the office lights slot.
    const listen = [];
    if (new URLSearchParams(location.search).get('listen')) {
      const card = document.querySelector('.sp-card')?.getBoundingClientRect();
      const player = document.querySelector('.u-listen .u-player')?.getBoundingClientRect();
      if (player && player.bottom > 300.5) listen.push('listen: the player ends at y ' + Math.round(player.bottom) + ', over the lines (300 at most)');
      if (player && card && player.right > card.left - 0.5) listen.push('listen: the player reaches x ' + Math.round(player.right) + ', into the Spotify card at ' + Math.round(card.left));
      if (!card) listen.push('listen: the Spotify card is not there');
      else if (card.left < 1739.5 || card.right > 2540.5 || card.bottom > 510.5 || card.top < 0) listen.push('listen: the Spotify card is at x ' + Math.round(card.left) + ' to ' + Math.round(card.right) + ', y ' + Math.round(card.top) + ' to ' + Math.round(card.bottom) + ' (x 1740 to 2540, y 0 to 510)');
      const next = document.querySelector('.u-next')?.getBoundingClientRect();
      const wingBox = document.querySelector('.u-wing')?.getBoundingClientRect();
      const rows = [...document.querySelectorAll('.u-next-row')].map((e) => e.getBoundingClientRect());
      if (next && wingBox && (next.left < wingBox.left - 0.5 || next.right > wingBox.right + 0.5 || next.bottom > 505.5 || rows.some((r) => r.bottom > next.bottom + 0.5))) listen.push('listen: Up next runs from x ' + Math.round(next.left) + ' to ' + Math.round(next.right) + ', down to y ' + Math.round(Math.max(next.bottom, ...rows.map((r) => r.bottom))) + ' (inside the wing, above the horizon at 505)');
      const slot = document.querySelector('[data-slot="office-lights"]');
      if (!slot) listen.push('listen: the office lights slot is not there');
      else {
        const sr = slot.getBoundingClientRect();
        // Its stage box (7A's foot row): right edge 70 px from the stage's right edge, top 662, 34 tall.
        if (Math.abs(sr.right - 2490) > 1 || Math.abs(sr.top - 662) > 1 || Math.abs(sr.height - 34) > 1 || sr.width > 420.5) listen.push('listen: the office lights slot is at x ' + Math.round(sr.left) + ' to ' + Math.round(sr.right) + ', y ' + Math.round(sr.top) + ' to ' + Math.round(sr.bottom) + ' (right edge 2490, top 662, 34 tall, 420 wide at most)');
        const bn = document.querySelector('.leave-banner')?.getBoundingClientRect();
        const ln = document.querySelector('.u-line')?.getBoundingClientRect();
        if (bn && ln && hit(bn, ln)) listen.push('listen: the leave banner covers the status line');
        if (slot.childNodes.length || getComputedStyle(slot).pointerEvents !== 'none') listen.push('listen: the office lights slot is not empty or takes the pointer');
        const draws = (e) => ['IMG', 'svg', 'BUTTON', 'INPUT', 'CANVAS'].includes(e.tagName) || [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
        // What shows of an element: its box cut by every ancestor that clips (a scrolled list hides its far rows).
        const shown = (e) => {
          let q = e.getBoundingClientRect();
          let l = q.left, t = q.top, r = q.right, b = q.bottom;
          for (let a = e.parentElement; a; a = a.parentElement) {
            const cs = getComputedStyle(a);
            if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
            const c = a.getBoundingClientRect();
            l = Math.max(l, c.left); t = Math.max(t, c.top); r = Math.min(r, c.right); b = Math.min(b, c.bottom);
          }
          return { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t };
        };
        const inside = [...document.querySelectorAll('.stage *')].filter((e) => e !== slot && !e.closest('.u-corner') && !e.closest('.horizon-canvas') && e.tagName !== 'CANVAS' && draws(e)).filter((e) => { const q = shown(e); return q.width > 0 && q.height > 0 && hit(q, sr); });
        for (const e of inside.slice(0, 3)) listen.push('listen: ' + (e.className?.baseVal ?? e.className ?? e.tagName) + ' "' + (e.textContent || '').trim().slice(0, 30) + '" enters the office lights slot');
      }
    }
    // watch polish: the Look switch's box; the control row on one line and clear of the list; nothing
    // of the wall's over the video's box; and the drive-in's driveInAudience equal to its drawn
    // screen. The one exemption: the whole sky's picture lies under the whole band, so the left
    // block, the Look switch, the tabs and the cards sit above it by design; even there nothing
    // of the wall's may lie inside the picture's own layer (no wash, no button).
    const watchPolish = (() => {
      const sw = document.querySelector('.w-lookbar');
      if (!sw) return null;
      const box = (e) => { const r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
      const meet = (a, b) => a.l < b.l + b.w && b.l < a.l + a.w && a.t < b.t + b.h && b.t < a.t + a.h;
      const fails = [];
      const card = document.querySelector('.w-card');
      for (const sel of ['.w-ctl', '.w-time', '.w-lookbar']) { const e = document.querySelector(sel); if (e && card && meet(box(e), box(card))) fails.push('watch polish: ' + sel + ' overlaps the list'); }
      const ctl = document.querySelector('.w-ctl');
      if (ctl && ctl.children.length) { const kids = [...ctl.children].map(box); const mid = (k) => k.t + k.h / 2; if (kids.some((k) => Math.abs(mid(k) - mid(kids[0])) > 2)) fails.push('watch polish: the control row wraps'); }
      const skyStage = document.querySelector('.w-sky');
      if (skyStage) for (const c of skyStage.children) if (!c.classList.contains('w-screen')) fails.push('watch polish: ' + c.className + " is drawn over the video's box (whole sky)");
      const scr = document.querySelector('.w-stage:not(.w-sky):not(.w-empty) .w-screen');
      if (scr) {
        const v = box(scr);
        for (const e of document.querySelectorAll('.w-lookbar, .w-now, .w-ctl, .w-time, .w-open, .w-card')) if (meet(box(e), v)) fails.push('watch polish: ' + e.className + " is drawn over the video's box");
        const st = scr.closest('.w-stage');
        if (st.classList.contains('w-drivein')) {
          const aud = st.getAttribute('data-audience') || '';
          const [x, y, w, h] = aud.split(',').map(Number);
          if (!aud || Math.abs(x - v.l) > 1 || Math.abs(y - v.t) > 1 || Math.abs(w - v.w) > 1 || Math.abs(h - v.h) > 1) fails.push('watch polish: driveInAudience ' + aud + ' is not the drawn screen ' + [v.l, v.t, v.w, v.h].join(','));
        }
      }
      return { sw: box(sw), fails };
    })();
    const pre = document.createElement('pre'); pre.id = 'fit-check'; pre.textContent = JSON.stringify({ res, page, overlaps, cut, gaps, wattCard, header, deck, deckRoom, nowH, edges, hide, hits, grid, lw, sig, toolsOut, meetOut, strip, opened, watchPolish, listen });
    document.body.appendChild(pre);
  }, new URLSearchParams(location.search).get('card') ? 7000 : 3000);</script>`;
  const broken = overflow ? `<style>${OVERFLOWS[overflow]}</style>` : '';
  const page = join(out, 'work.html');
  writeFileSync(page, html.replace('</body>', `${broken}${measure}</body>`));

  let failed = false;
  if (overflow) console.log(`deliberate overflow: ${overflow} (${OVERFLOWS[overflow]})`);
  // A deliberate break runs on the first state, or for the picker on the state that opens it.
  const BREAK_ON = {
    zenhint: (v) => v.name.startsWith('Zen,'),
    picker: (v) => v.name.startsWith('Deck, the key picker open over'),
    tools: (v) => v.name === 'Tools, over Work, typical',
    toolsnames: (v) => v.name === 'Tools, over Work, typical',
    meetfill: (v) => v.name === 'Meet, both accounts read',
    meetempty: (v) => v.name === 'Meet, nothing scheduled',
    // keys style
    'fy-height': (v) => v.name === 'Keys style, day: library sets held on VS Code' || v.name === 'Keys style, For you with two plates',
    'key-edge': (v) => v.name === 'Keys style, day: library sets held on VS Code',
    // deck and drawer fixes
    'tile-height': (v) => v.name === 'Keys style, day: library sets held on VS Code',
    'tile-icon': (v) => v.name === 'Keys style, day: library sets held on VS Code',
    'tile-iconbox': (v) => v.name === 'Keys style, day: library sets held on VS Code',
    'drawer-scrim': (v) => v.name === 'Strip: the Day drawer open',
    'hide-pill': (v) => v.name === 'Unwind, Hide screen grown',
    // whole sky and sun
    sky: (v) => v.name.startsWith('Watch, whole sky playing'),
    floor: (v) => v.name.startsWith('Watch, whole sky playing'),
    sun: (v) => v.name === 'Watch, the sun playing',
    strip: (v) => v.name === 'Strip: overlaps, twelve sessions',
    fold: (v) => v.name === 'Strip: overlaps, twelve sessions',
    handle: (v) => v.name === 'Strip: overlaps, twelve sessions',
    drawer: (v) => v.name === 'Strip: the Day drawer open',
    rows: (v) => v.name === 'Strip: Agents today, a heavy past day',
    'hide-note': (v) => v.name === 'Unwind, Hide screen grown with the failure note',
    // Watt's menu pushed down onto him
    menu: (v) => v.name === 'Watt menu on Work',
    // leave and recording
    'leave-band': (v) => v.name === 'Leave banner on Work, 12 minutes, long title' || v.name === 'Leave banner on Home',
    'rec-chip': (v) => v.name === 'Recording chip in the Agents header, twelve sessions, two waiting, an alarm',
    'rec-height': (v) => v.name === 'Recording page: the Now row, library sets' || v.name === 'Keys style, day: library sets held on VS Code',
    // unwind listen
    'listen-player': (v) => v.name === 'Listen, playing with the lines moving',
    'listen-card': (v) => v.name === 'Listen, playing with the lines moving',
    'listen-slot': (v) => v.name === 'Listen, playing with the lines moving',
    'listen-next': (v) => v.name === 'Listen, playing with the lines moving',
    // watch polish
    'watch-switch': (v) => v.name.startsWith('Watch polish'),
    'watch-row': (v) => v.name === 'Watch polish, feathered, single video',
    'watch-over': (v) => v.name === 'Watch polish, drive-in, playlist, long label',
    'watch-take': (v) => v.name === 'Watch polish, whole sky, autoplay refused',
  };
  const breakOn = BREAK_ON[overflow] ? VARIANTS.filter(BREAK_ON[overflow]) : VARIANTS.slice(0, 1);
  /** keys style: the Now row's height on each page that has one, compared after every state ran. */
  const nowHeights = [];
  /** watch polish: the Look switch's box in each Watch polish state, compared after the run. */
  const switchBoxes = [];
  for (const v of overflow ? breakOn : VARIANTS) {
    console.log(`${v.name} (${v.q}):`);
    const url = `${pathToFileURL(page).href}${v.q}&checks=${encodeURIComponent(v.checks.join('|'))}${v.click ? `&click=${encodeURIComponent(v.click)}` : ''}${v.card ? '&card=1' : ''}${v.hits ? `&hits=${encodeURIComponent(v.hits.join('|'))}` : ''}${v.noHit ? `&nohit=${encodeURIComponent(v.noHit)}` : ''}${v.listen ? '&listen=1' : ''}`;
    const dom = await runChrome(
      chrome,
      // Headless Chromium keeps 87 px of the window for itself, so 807 gives a 2560 by 720 viewport.
      ['--headless', '--no-sandbox', '--disable-gpu', '--window-size=2560,807', '--virtual-time-budget=8000', '--dump-dom', url],
      { label: v.name },
    );
    const m = /<pre id="fit-check">([^<]*)<\/pre>/.exec(dom);
    if (!m) {
      console.error('fit-check: the page did not report (did it render?)');
      process.exit(1);
    }
    const text = m[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&');
    const { res, page: doc, overlaps, cut, gaps, wattCard, header, deck, deckRoom, nowH, edges, hide, hits, grid, lw, sig, toolsOut, meetOut, strip, opened, watchPolish, listen } = JSON.parse(text);
    // watch polish
    if (watchPolish) {
      for (const f of watchPolish.fails) console.log(`  FAIL ${f}`);
      if (watchPolish.fails.length) failed = true;
      else console.log('  ok   watch polish: the control row is one line clear of the list, nothing over the video\'s box');
      if (v.name.startsWith('Watch polish')) switchBoxes.push({ name: v.name, box: watchPolish.sw });
    }
    // unwind listen
    for (const l of listen) console.log(`  FAIL ${l}`);
    if (listen.length) failed = true;
    else if (v.listen) console.log('  ok   listen: the player ends above y 300 left of the card, the card in x 1740 to 2540 above y 510, Up next in the wing above the horizon, the office lights slot empty');
    for (const t of [...toolsOut, ...meetOut]) console.log(`  FAIL ${t}`);
    if (toolsOut.length || meetOut.length) failed = true;
    else if (v.q.includes('tools=')) console.log('  ok   the drawer stays inside x 1700 to 2560 and y 0 to 720, clear of the rail, no cut text without a tooltip');
    else if (v.q.includes('go=meet')) console.log('  ok   Meet: a card reaches the right edge, nothing empty in the upper right');
    // keys style
    if (v.nowH && nowH !== null) nowHeights.push({ page: v.nowH, h: nowH, name: v.name });
    if (v.edges) {
      // As measure.py read the vote pictures: the sky is the median pixel of the strip just above
      // the key, the edge the pixel of the key's top 2 px that stands out most from it.
      const shot = join(out, 'edges.png');
      // A screenshot run keeps no room of the window for itself, so its viewport is 2560 by 807 and
      // the 2560 by 720 stage sits centred in it (scale 1): every box moves down by half the difference.
      await runChrome(chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--window-size=2560,807', '--hide-scrollbars', '--virtual-time-budget=8000', `--screenshot=${shot}`, url], { label: `${v.name}, edges` });
      const img = readPng(shot);
      if (img.w !== 2560 || img.h < 720) {
        console.log(`  FAIL deck: the edge screenshot is ${img.w} x ${img.h}, smaller than the stage`);
        failed = true;
      }
      const dy = (img.h - 720) / 2;
      const low = [];
      let lowest = Infinity;
      for (const e of edges) {
        const x0 = Math.round(e.x + 20);
        const x1 = Math.round(e.x + e.w - 20);
        const top = Math.round(e.y + dy);
        const sky = median(pixels(img, x0, top - 4, x1, top - 2));
        let best = 0;
        for (const p of pixels(img, x0, top, x1, top + 2)) best = Math.max(best, contrast(p, sky));
        // And a side: the strip just right of the key (left of it at the screen's edge) against the key's own side edge.
        const left = Math.round(e.x);
        const right = Math.round(e.x + e.w);
        const gx = right + 8 < 2552 ? right + 3 : left - 5;
        const skySide = median(pixels(img, gx, top + 16, gx + 2, top + 44));
        const sx = gx > left ? right - 2 : left;
        let side = 0;
        for (const p of pixels(img, sx, top + 16, sx + 3, top + 44)) side = Math.max(side, contrast(p, skySide));
        const r = Math.round(Math.min(best, side) * 100) / 100;
        lowest = Math.min(lowest, r);
        const which = side < best ? `side edge, sky rgb(${skySide.join(', ')})` : `top edge, sky rgb(${sky.join(', ')})`;
        if (r < 3) low.push(`  FAIL deck: key "${e.label}" edge against the sky ${r} to 1 (at least 3 to 1; the lower is the ${which})`);
      }
      for (const l of low) console.log(l);
      if (low.length || edges.length === 0) failed = true;
      if (edges.length === 0) console.log('  FAIL deck: no key edge could be measured');
      else if (!low.length) console.log(`  ok   every key edge against the sky at least 3 to 1, top and side (lowest ${lowest}, ${edges.length} keys)`);
    }
    if (v.note) {
      const n = hide?.note ?? null;
      const okNote = n !== null && !n.overlap && n.inCorner;
      if (!okNote) failed = true;
      console.log(n === null ? '  FAIL hide screen note: the failure note is not showing' : `  ${okNote ? 'ok  ' : 'FAIL'} hide screen note: ${n.overlap ? 'overlaps' : 'clear of'} the grown pill, ${n.inCorner ? 'inside' : 'outside'} the corner under the Room card`);
    }
    if (v.hide) {
      const okHide = hide !== null && hide.grown && hide.inCorner && hide.label.includes('Hide screen') && Math.abs(hide.right) <= SLACK && Math.abs(hide.bottom) <= SLACK && hide.foot === 0 && hide.room === 0 && hide.w > 36;
      if (!okHide) failed = true;
      console.log(
        hide === null
          ? '  FAIL hide screen: the button is not there'
          : `  ${okHide ? 'ok  ' : 'FAIL'} hide screen: ${hide.grown ? 'grown' : 'not grown'} to ${hide.w} px, right edge ${hide.right} and bottom ${hide.bottom} from its corner box (0), ${hide.inCorner ? 'inside' : 'outside'} the corner under the Room card, overlaps ${hide.foot} parts of the status line and ${hide.room} Room cards`,
      );
    }
    for (const d of sig) console.log(`  FAIL ${d}`);
    if (sig.length) failed = true;
    else if (/[?&](leave|rec)=/.test(v.q)) console.log('  ok   leave banner and recording chip: inside their band, one line, covering no text or control');
    for (const d of lw) console.log(`  FAIL ${d}`);
    if (lw.length) failed = true;
    else if (v.q.includes('hz=work')) console.log('  ok   left wing: three music buttons on one line, TEMP header centred, round controls round');
    if (v.strip) {
      for (const f of strip) console.log(`  FAIL ${f}`);
      const wantOpen = v.click?.includes('rib-handle') ? opened.drawer : v.click?.includes('ag-line') ? opened.panel && opened.rows > 0 : true;
      if (!wantOpen) console.log(`  FAIL strip: the overlay did not open (${JSON.stringify(opened)})`);
      if (strip.length || !wantOpen) failed = true;
      else console.log('  ok   strip 104 px, no strip labels sharing pixels, folded counts whole, overlays inside the stage below the clock, rows at least 32 px');
    }
    for (const d of deck) console.log(`  FAIL ${d}`);
    if (deck.length) failed = true;
    else if (v.q.includes('hz=work')) console.log(`  ok   the deck stays above its floor${deckRoom === null ? '' : ` (${deckRoom} px of room)`}, every key label inside its tile, the Now heading whole`);
    for (const h of header) console.log(`  FAIL ${h}`);
    if (header.length) failed = true;
    else if (v.q.includes('hz=work')) console.log('  ok   the agents header is one line');
    for (const h of hits) {
      const ok = h.found && h.ok;
      if (!ok) failed = true;
      console.log(h.found ? `  ${ok ? 'ok  ' : 'FAIL'} pointer at ${h.sel} (${h.x}, ${h.y}) reaches ${ok ? 'it' : h.got}` : `  FAIL pointer at ${h.sel}: not found`);
    }
    if (v.noHit) {
      if (grid.length) failed = true;
      console.log(`  ${grid.length ? 'FAIL' : 'ok  '} no point of the sky or the floor lands on ${v.noHit}${grid.length ? `: ${grid.slice(0, 6).join(' ')}${grid.length > 6 ? ` and ${grid.length - 6} more` : ''}` : ''}`);
    }
    if (v.card) {
      const c = wattCard;
      const okCard = c !== null && c.buttons >= 11 && Math.min(...c.heights) >= 34 - SLACK && c.outside === 0 && c.covered.length === 0 && c.minFont >= 16;
      if (!okCard) failed = true;
      console.log(
        c === null
          ? '  FAIL Watt menu did not open'
          : `  ${okCard ? 'ok  ' : 'FAIL'} Watt menu: ${c.buttons} items, shortest ${Math.round(Math.min(...c.heights))} px (at least 34), smallest text ${c.minFont} px (at least 16), ${c.outside} parts outside the menu, ${c.covered.length ? c.covered.join('; ') : 'not over him, its tail over him'}`,
      );
    }
    for (const o of overlaps) console.log(`  FAIL overlap: ${o}`);
    for (const c of cut) console.log(`  FAIL ${c}`);
    for (const g of gaps) console.log(`  FAIL ${g}`);
    if (overlaps.length || cut.length || gaps.length) failed = true;
    else console.log('  ok   no overlapping agent hit boxes or chips, no cut card line beside unused room, stage labels at least 8 px apart');
    const pageOk = doc.vw === 2560 && doc.vh === 720 && doc.sw <= doc.cw && doc.sh <= doc.ch;
    if (!pageOk) failed = true;
    console.log(`  ${pageOk ? 'ok  ' : 'FAIL'} page: viewport ${doc.vw} x ${doc.vh} (must be 2560 x 720), scroll ${doc.sw} x ${doc.sh} <= ${doc.cw} x ${doc.ch}`);
    const sides = (o) => {
      const over = Object.entries(o).filter(([, px]) => px > SLACK);
      return over.length ? over.map(([k, px]) => `${{ l: 'left', r: 'right', t: 'top', b: 'bottom' }[k]} ${Math.round(px)}`).join(', ') : 'inside';
    };
    if (v.maxRows !== undefined) {
      const rowsOk = doc.rows >= 1 && doc.rows <= v.maxRows;
      if (!rowsOk) failed = true;
      console.log(`  ${rowsOk ? 'ok  ' : 'FAIL'} .u-chip rows: ${doc.rows} (1 to ${v.maxRows})`);
    }
    for (const { sel, items } of res) {
      if (items.length === 0) {
        console.log(`  FAIL ${sel}: not found`);
        failed = true;
        continue;
      }
      items.forEach((r, i) => {
        const inside = (o) => Object.values(o).every((px) => px <= SLACK);
        // A pop-out scrolls inside itself by design; its rows must not overflow.
        const scrollOk = v.viewportOnly && sel.endsWith('.sound-pop') ? r.sw <= r.cw : r.sw <= r.cw && r.sh <= r.ch;
        const ok = scrollOk && (v.viewportOnly || inside(r.inHolder)) && inside(r.inView);
        if (!ok) failed = true;
        console.log(
          `  ${ok ? 'ok  ' : 'FAIL'} ${sel}${items.length > 1 ? ` [${i}]` : ''}: width ${r.sw} <= ${r.cw}, height ${r.sh} <= ${r.ch}, container ${sides(r.inHolder)}, viewport ${sides(r.inView)}`,
        );
      });
    }
  }
  // keys style: the Now row is one height on every page (a key page and the For you page).
  if (nowHeights.some((n) => n.page === 'keys') && (nowHeights.some((n) => n.page === 'foryou') || nowHeights.some((n) => n.page === 'recording'))) {
    const hs = [...new Set(nowHeights.map((n) => n.h))];
    if (hs.length > 1) {
      failed = true;
      for (const n of nowHeights) console.log(`  FAIL deck: the Now row is ${Math.round(n.h)} px tall on ${n.page === 'recording' ? 'Recording' : n.name} (every page must match)`);
    } else if (Math.abs(hs[0] - 108) > 0.5) {
      // deck and drawer fixes: the row is its 32 px heading, 6 px, and one 70 px tile row (108; it was 98 with 60 px tiles).
      failed = true;
      console.log(`  FAIL deck: the Now row is ${hs[0]} px tall on every page, expected 108 (a 32 px heading, 6 px, a 70 px tile row)`);
    } else console.log(`keys style: the Now row is ${hs[0]} px tall on every key page, on For you and on Recording`);
  }
  // watch polish: the Look switch sits in one place, one size, in every look and with nothing on.
  if (switchBoxes.length > 1) {
    const key = (b) => `${b.l},${b.t} ${b.w}x${b.h}`;
    const first = key(switchBoxes[0].box);
    const off = switchBoxes.filter((s) => key(s.box) !== first);
    if (off.length) {
      failed = true;
      for (const s of off) console.log(`  FAIL watch polish: the Look switch is at ${key(s.box)} on ${s.name}, not ${first} as on ${switchBoxes[0].name}`);
    } else console.log(`watch polish: the Look switch is at ${first} in all ${switchBoxes.length} states`);
  }
  process.exit(failed ? 1 : 0);
} catch (e) {
  if (!(e instanceof ChromeRunError)) throw e;
  console.error(`  FAIL ${e.message}`);
  process.exitCode = 1;
} finally {
  rmSync(out, { recursive: true, force: true });
}
