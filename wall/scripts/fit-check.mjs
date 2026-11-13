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
// clear of the failure note.
// CI does not run this; run it by hand before a layout change is handed over.
//
//   WALL_CHROME=/path/to/chrome-or-headless-shell npm --prefix wall run fit-check
//   npm --prefix wall run fit-check -- --overflow=right    (left, right, top, bottom, page, agents, labels, header, deck, tiles, picker, chips, heading, zenhint, sky, floor, sun, tools, toolsnames, meetfill, meetempty, fy-height, key-edge, hide-pill, hide-note)
//   npm --prefix wall run fit-check -- --self-test
//
// WALL_CHROME (or the first argument that is not a flag) is a Chromium or
// chrome-headless-shell binary. `--overflow=<side>` adds a stylesheet that pushes a checked
// box past that side (or widens the page) and must fail. `--self-test` runs every
// `--overflow` case and exits 0 only if each one failed with the FAIL line for its side.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { inflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  sky: /^ *FAIL pointer at .*reaches w-scrim/m,
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
  // left wing
  lwbuttons: /^ *FAIL left wing: music buttons leave the wing/m,
  lwoverlap: /^ *FAIL left wing: music buttons overlap the title/m,
  lwsquare: /^ *FAIL left wing: focus outline on Choose a focus length is square/m,
  lwring: /^ *FAIL left wing: focus outline on Choose a focus length/m,
  lwtemp: /^ *FAIL left wing: TEMP header /m,
  lwround: /^ *FAIL left wing: round control /m,
};
const OVERFLOWS = {
  left: '.work .left-wing { transform: translateX(-200px); }',
  right: '.work .centre .lane { margin-right: -160px; }',
  top: '.work .right-wing { transform: translateY(-60px); }',
  bottom: '.work .centre .shelf { transform: translateY(120px); }',
  page: 'body::after { content: ""; position: absolute; left: 3000px; top: 0; width: 10px; height: 10px; }',
  agents: '.rib .agent-row .sg-hit { height: 20px !important; }',
  labels: '.work .centre .lane .jn em { padding: 0 14px !important; }',
  header: '.work .centre .lanes-hd .slot-meter .xs { display: inline-block; width: 60px; white-space: normal !important; }',
  deck: '.work .right-wing section.pinned { margin-top: 80px; }',
  tiles: '.work .right-wing .key-tile .deck-lbl { flex: none; width: 160px; max-width: none !important; }',
  picker: '.work .right-wing .pk { height: 400px !important; }',
  zenhint: '.zen-dimhint { width: 2000px; }',
  chips: '.rib .ev { width: 400px !important; }',
  heading: '.work .right-wing .keys .deck-name { max-width: 40px; overflow: hidden; }',
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
  // left wing
  lwbuttons: '.work .left-wing .music-mini-text { flex: none !important; width: 900px !important; }',
  lwoverlap: '.work .left-wing .music-mini-btns { transform: translateX(-200px); }',
  lwsquare: '.work .left-wing .focus-mini-ring:focus-visible { border-radius: 0 !important; }',
  lwring: '.work .left-wing .focus-mini-ring:focus-visible { outline: none !important; }',
  lwtemp: '.work .left-wing .mc-hd span:last-child { transform: translateX(14px); }',
  lwround: '.work .wl .rd, .work .wl .focus-mini-ring, .work .wl .ring { border-radius: 0 !important; }',
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
const UNWIND = ['.u-room', '.u-chips', '.u-line'];
const WATCH_IDLE = ['.u-room', '.w-card', '.w-card .u-card-head', '.w-field', '.w-now'];
const WATCH_PLAYING = [...WATCH_IDLE, '.w-ctl', '.w-screen', '.w-under', '.w-open'];
// Named controls that must still take the pointer with video playing: the rail, the tabs and
// the gear, the transport, the list's first row and its field, a Room chip, the status chips,
// Screens off and Watt.
// Below the horizon, under the whole sky's floor wash: the Tomorrow card, the status line's
// chips and Screens off (Unwind has no timeline strip).
const FLOOR_HITS = ['.u-tomorrow', '.u-line .u-act', '.screens-off'];
const SKY_HITS = ['.rail .rb', '.u-tab', '.w-gear', '.w-ctl .u-rd', '.w-play', '.w-mini', '.w-paste', '.u-chip', '.u-line .u-act', '.screens-off', '.w-open', '.watt-hit-part'];
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
  // Unwind with nine moods of long names: the Room list stays within two rows.
  { name: 'Unwind, nine long moods', agents: '3', hz: 'unwind', moods: 'nine', maxRows: 2, extra: '', checks: UNWIND },
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
  { name: 'Watch, whole sky playing, every control still takes the pointer', agents: 'ask', hz: 'unwind', extra: '&watch=mock&wlist=three&wlook=sky&wplay=0', checks: [...WATCH_IDLE, '.w-ctl', '.w-open', '.w-look'], hits: [...SKY_HITS, ...FLOOR_HITS], noHit: '.w-sky, .w-skyspill' },
  { name: 'Watch, whole sky, 24 saved, long label', agents: '3', hz: 'unwind', extra: '&watch=mock&wlist=many&wlook=sky&wplay=3', checks: [...WATCH_IDLE, '.w-ctl', '.w-open', '.w-look'], hits: [...SKY_HITS, ...FLOOR_HITS], noHit: '.w-sky, .w-skyspill' },
  { name: 'Watch, the sun playing', agents: '3', hz: 'unwind', extra: '&watch=mock&wlist=three&wlook=sun&wplay=0', checks: [...WATCH_IDLE, '.w-ctl', '.w-under', '.w-open', '.w-list'], hits: SKY_HITS },
  { name: 'Watch, the sun, 24 saved, Twitch', agents: '3', hz: 'unwind', extra: '&watch=mock&wlist=many&wlook=sun&wplay=2', checks: [...WATCH_IDLE, '.w-ctl', '.w-under', '.w-open'], hits: SKY_HITS },
  { name: 'Watch, settings sheet with four looks, one look', agents: '3', hz: 'unwind', extra: '&watch=mock&wlist=three&wlook=sky&wplay=0&wsheet=one', checks: ['.w-sheet', '.w-tiles', '.w-tile', '.w-hint', '.w-sfoot'] },
  { name: 'Watch, settings sheet, a look per kind', agents: '3', hz: 'unwind', extra: '&watch=mock&wlist=many&wplay=2&wsheet=kind', checks: ['.w-sheet', '.w-srow', '.w-srow .w-seg', '.w-sfoot'] },
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
  { name: 'Deck, the key picker open over both rows', q: work('3', '&keys=typical'), checks: PICKER, click: 'ctx:.pin-tile', viewportOnly: true },
  { name: 'Deck, the key picker open with the library sets', q: work('3', '&keys=library'), checks: PICKER, click: 'ctx:.pin-tile', viewportOnly: true },
  // keys style: the key colours by day and by night (each key's edge against the sky behind it at
  // least 3 to 1), and the Now row one height on a key page and on the For you page (nowH).
  { name: 'Keys style, day: library sets held on VS Code', q: `?hz=work&at=${encodeURIComponent('2026-11-11T12:10:00-08:00')}&clock=review&weather=ok&keys=library&hold=lib-vscode`, checks: DECK, edges: true, nowH: 'keys' },
  { name: 'Keys style, night: library sets held on VS Code', q: `?hz=work&at=${encodeURIComponent('2026-11-11T22:30:00-08:00')}&clock=review&weather=ok&keys=library&hold=lib-vscode`, checks: DECK, edges: true, nowH: 'keys' },
  { name: 'Keys style, day: held on Excel with VS Code in front (keys that cannot be sent)', q: `?hz=work&at=${encodeURIComponent('2026-11-11T12:10:00-08:00')}&clock=review&weather=ok&keys=library&hold=lib-excel`, checks: DECK, edges: true, nowH: 'keys' },
  { name: 'Keys style, For you with two plates', q: work('ask', '&keys=typical&hold=foryou&meet=none&net=calm'), checks: FOR_YOU, nowH: 'foryou' },
  { name: 'Keys style, For you with one plate', q: work('3', '&keys=typical&hold=foryou&meet=none'), checks: FOR_YOU, nowH: 'foryou' },
  // The Hide screen button grown under the pointer.
  { name: 'Unwind, Hide screen grown', q: query({ hz: 'unwind', agents: '3', extra: '' }), checks: ['.u-room', '.screens-off'], click: 'hover:.screens-off', hide: true, viewportOnly: true },
  // The failure note ("Could not watch input") showing while the pill is grown: the two never meet.
  { name: 'Unwind, Hide screen grown with the failure note', q: query({ hz: 'unwind', agents: '3', extra: '&hide=fail' }), checks: ['.u-room', '.screens-off', '.screens-off-note'], click: '.screens-off then hover:.screens-off', hide: true, note: true, viewportOnly: true },
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
  // Watt's card (a right-click on him), on Work, Home and Unwind (Meet's horizon glides in real time, which this
  // frozen check cannot wait for; the overlap test in `buddy/model.test.ts` covers Meet): inside the screen, every button
  // 32 px tall, every part of it inside the card, and covering no text or control of the place.
  { name: 'Watt card on Work', q: work('3', '&meet=none'), checks: ['.watt-card'], viewportOnly: true, card: true },
  { name: 'Watt card on Home', q: home('moods=five'), checks: ['.watt-card'], viewportOnly: true, card: true },
  { name: 'Watt card on Unwind', q: query({ hz: 'unwind', agents: '3', extra: '' }), checks: ['.watt-card'], viewportOnly: true, card: true },
  ...TOOLS_VARIANTS,
];
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
    for (const click of (new URLSearchParams(location.search).get('click') || '').split(' then ').filter(Boolean)) {
    if (click && click.startsWith('ctx:')) document.querySelector(click.slice(4))?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    else if (click && click.startsWith('hover:')) {
      // Headless --dump-dom has no pointer: every top-level :hover rule is copied for a class that stands in for it.
      const extra = [];
      for (const sheet of document.styleSheets) for (const r of sheet.cssRules) if (r.selectorText && r.selectorText.includes(':hover')) extra.push(r.cssText.replaceAll(':hover', '.fit-hover'));
      // Measured at the end of its transition (virtual time draws no frames for one to run).
      extra.push('.fit-hover, .fit-hover * { transition: none !important; }');
      const st = document.createElement('style'); st.textContent = extra.join(' '); document.head.appendChild(st);
      document.querySelector(click.slice(6))?.classList.add('fit-hover');
    }
    else if (click) document.querySelector(click)?.click();
    }
    // Watt's card: asked for until it is open (Meet's horizon takes a few seconds to settle first).
    if (new URLSearchParams(location.search).get('card')) {
      const ask = () => { if (!document.querySelector('.watt-card')) document.querySelector('.watt-hit')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); };
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
    // Watt's card: button heights, parts outside the card, and text or controls of the place it covers.
    let wattCard = null;
    const card = document.querySelector('.watt-card');
    if (card) {
      const cr = card.getBoundingClientRect();
      const heights = [...card.querySelectorAll('button')].map((b) => b.getBoundingClientRect().height);
      const outside = [...card.querySelectorAll('button, .wc-name, .wc-mood, .wc-today li, .wc-days')].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.left < cr.left - 0.5 || r.right > cr.right + 0.5 || r.top < cr.top - 0.5 || r.bottom > cr.bottom + 0.5;
      }).length;
      const covered = [];
      for (const e of document.querySelectorAll('.shell *')) {
        const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!own && !e.matches('button, a, input, select, textarea, [role=button], [tabindex]')) continue;
        const cs = getComputedStyle(e);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
        const r = e.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && hit(r, cr)) covered.push((e.className && e.className.baseVal === undefined ? e.className : e.tagName) + ': ' + (e.textContent || '').trim().slice(0, 24));
      }
      wattCard = { heights, outside, covered, buttons: heights.length };
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
    const floorEl = document.querySelector('.work .right-wing .keys[data-floor]');
    const deckEl = document.querySelector('.work .right-wing .deck');
    if (deckEl) {
      const floor = floorEl ? Number(floorEl.dataset.floor) : Infinity;
      if (!floorEl && document.querySelector('.work .right-wing .keys')) deck.push('deck: the Now row carries no data-floor, so its floor cannot be checked');
      let low = null;
      // What the deck draws: its rows and their parts (the box itself is empty room). The open key
      // picker may run past the floor over the mountains; it is held to the timeline below.
      for (const e of deckEl.querySelectorAll('*')) {
        if (e.closest('.pk')) continue;
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || getComputedStyle(e).visibility === 'hidden') continue;
        if (r.bottom > floor + 0.5 && (low === null || r.bottom > low.b)) low = { b: r.bottom, t: (e.className && e.className.baseVal === undefined ? e.className : e.tagName) };
      }
      if (low) deck.push('deck: ' + low.t + ' reaches y ' + Math.round(low.b) + ', below the floor at ' + floor);
      const tiles = [...deckEl.querySelectorAll('.deck-tile')].map((t) => ({ t, r: t.getBoundingClientRect() }));
      for (const { t, r } of tiles) {
        const l = t.querySelector('.deck-lbl');
        if (!l) continue;
        const q = l.getBoundingClientRect();
        if (q.left < r.left - 0.5 || q.right > r.right + 0.5 || q.top < r.top - 0.5 || q.bottom > r.bottom + 0.5 || l.scrollWidth > l.clientWidth + 1) deck.push('deck: label "' + l.textContent + '" runs outside its tile');
      }
      tiles.forEach((a, i) => tiles.slice(i + 1).forEach((b) => { if (hit(a.r, b.r)) deck.push('deck: tiles "' + a.t.textContent + '" and "' + b.t.textContent + '" share pixels'); }));
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
      if (e.disabled) continue;
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
    const pre = document.createElement('pre'); pre.id = 'fit-check'; pre.textContent = JSON.stringify({ res, page, overlaps, cut, gaps, wattCard, header, deck, nowH, edges, hide, hits, grid, lw, toolsOut, meetOut });
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
    'hide-pill': (v) => v.name === 'Unwind, Hide screen grown',
    // whole sky and sun
    sky: (v) => v.name.startsWith('Watch, whole sky playing'),
    floor: (v) => v.name.startsWith('Watch, whole sky playing'),
    sun: (v) => v.name === 'Watch, the sun playing',
    'hide-note': (v) => v.name === 'Unwind, Hide screen grown with the failure note',
  };
  const breakOn = BREAK_ON[overflow] ? VARIANTS.filter(BREAK_ON[overflow]) : VARIANTS.slice(0, 1);
  /** keys style: the Now row's height on each page that has one, compared after every state ran. */
  const nowHeights = [];
  for (const v of overflow ? breakOn : VARIANTS) {
    console.log(`${v.name} (${v.q}):`);
    const url = `${pathToFileURL(page).href}${v.q}&checks=${encodeURIComponent(v.checks.join('|'))}${v.click ? `&click=${encodeURIComponent(v.click)}` : ''}${v.card ? '&card=1' : ''}${v.hits ? `&hits=${encodeURIComponent(v.hits.join('|'))}` : ''}${v.noHit ? `&nohit=${encodeURIComponent(v.noHit)}` : ''}`;
    const dom = execFileSync(
      chrome,
      // Headless Chromium keeps 87 px of the window for itself, so 807 gives a 2560 by 720 viewport.
      ['--headless', '--no-sandbox', '--disable-gpu', '--window-size=2560,807', '--virtual-time-budget=8000', '--dump-dom', url],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const m = /<pre id="fit-check">([^<]*)<\/pre>/.exec(dom);
    if (!m) {
      console.error('fit-check: the page did not report (did it render?)');
      process.exit(1);
    }
    const text = m[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&');
    const { res, page: doc, overlaps, cut, gaps, wattCard, header, deck, nowH, edges, hide, hits, grid, lw, toolsOut, meetOut } = JSON.parse(text);
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
      execFileSync(chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--window-size=2560,807', '--hide-scrollbars', '--virtual-time-budget=8000', `--screenshot=${shot}`, url], { stdio: 'ignore' });
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
    for (const d of lw) console.log(`  FAIL ${d}`);
    if (lw.length) failed = true;
    else if (v.q.includes('hz=work')) console.log('  ok   left wing: three music buttons on one line, TEMP header centred, round controls round');
    for (const d of deck) console.log(`  FAIL ${d}`);
    if (deck.length) failed = true;
    else if (v.q.includes('hz=work')) console.log('  ok   the deck stays above its floor, every key label inside its tile, the Now heading whole');
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
      const okCard = c !== null && c.buttons >= 13 && Math.min(...c.heights) >= 32 - SLACK && c.outside === 0 && c.covered.length === 0;
      if (!okCard) failed = true;
      console.log(
        c === null
          ? '  FAIL Watt card did not open'
          : `  ${okCard ? 'ok  ' : 'FAIL'} Watt card: ${c.buttons} buttons, shortest ${Math.round(Math.min(...c.heights))} px (at least 32), ${c.outside} parts outside the card, covers ${c.covered.length ? c.covered.join('; ') : 'no text or control'}`,
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
  if (nowHeights.some((n) => n.page === 'keys') && nowHeights.some((n) => n.page === 'foryou')) {
    const hs = [...new Set(nowHeights.map((n) => n.h))];
    if (hs.length > 1) {
      failed = true;
      for (const n of nowHeights) console.log(`  FAIL deck: the Now row is ${Math.round(n.h)} px tall on ${n.name} (every page must match)`);
    } else console.log(`keys style: the Now row is ${hs[0]} px tall on every key page and on For you`);
  }
  process.exit(failed ? 1 : 0);
} finally {
  rmSync(out, { recursive: true, force: true });
}
