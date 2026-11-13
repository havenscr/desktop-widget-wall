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
// calendar chips that cover each other in one lane, and on a card line that cuts its words
// while more than 60 px of it is unused, and on stage labels closer than 8 px. Home is checked
// with its Sound block at its fullest, typical, sparse, not reachable and not set up. Exits
// non-zero on a failure. CI does not run this; run it by hand before a layout change is handed over.
//
//   WALL_CHROME=/path/to/chrome-or-headless-shell npm --prefix wall run fit-check
//   npm --prefix wall run fit-check -- --overflow=right    (left, right, top, bottom, page, agents, labels)
//   npm --prefix wall run fit-check -- --self-test
//
// WALL_CHROME (or the first argument that is not a flag) is a Chromium or
// chrome-headless-shell binary. `--overflow=<side>` adds a stylesheet that pushes a checked
// box past that side (or widens the page) and must fail. `--self-test` runs every
// `--overflow` case and exits 0 only if each one failed with the FAIL line for its side.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
};
const OVERFLOWS = {
  left: '.work .left-wing { transform: translateX(-200px); }',
  right: '.work .centre .lane { margin-right: -160px; }',
  top: '.work .right-wing { transform: translateY(-60px); }',
  bottom: '.work .centre .shelf { transform: translateY(120px); }',
  page: 'body::after { content: ""; position: absolute; left: 3000px; top: 0; width: 10px; height: 10px; }',
  agents: '.rib .agent-row .sg-hit { height: 20px !important; }',
  labels: '.work .centre .lane .jn em { padding: 0 14px !important; }',
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
const PICKER = [...DECK_ROWS, '.work .right-wing .pk', '.work .right-wing .pk-top', '.work .right-wing .pk-reset'];
const deck = (name, knobs, extra = {}) => ({ name: `Deck, ${name}`, q: work('3', `&${knobs}`), checks: DECK, ...extra });
// Meet reads the real clock, so its variants run unfrozen (the mock meetings are relative to now).
const query = (v) => `?${v.live ? '' : `hz=${v.hz ?? 'work'}&at=${v.at ?? '2026-11-11T10:24:00-08:00'}&`}long=1&agents=${v.agents}${v.go ? `&go=${v.go}` : ''}${v.moods ? `&moods=${v.moods}` : ''}${v.extra ?? ''}`;
// Meet, Unwind and Dream states: built with `query`, then given the same `q` shape as the rest.
const QUIET = [
  // Meet: both accounts read; one account failing; no account readable; long titles throughout.
  { name: 'Meet, both accounts read', agents: '3', go: 'meet', live: true, extra: '', checks: MEET },
  { name: 'Meet, one account failing', agents: '3', go: 'meet', live: true, extra: '&meet=mixed', checks: MEET },
  { name: 'Meet, no account readable', agents: '3', go: 'meet', live: true, extra: '&meet=down', checks: MEET },
  // Unwind with nine moods of long names: the Room list stays within two rows.
  { name: 'Unwind, nine long moods', agents: '3', hz: 'unwind', moods: 'nine', maxRows: 2, extra: '', checks: UNWIND },
  // Dream at night: helper answering, helper off; calendar read, unreadable, nothing tomorrow.
  { name: 'Dream, agents and calendar', agents: '3', go: 'dream', at: '2026-11-11T23:48:00-08:00', extra: '', checks: DREAM },
  { name: 'Dream, agents waiting', agents: 'ask', go: 'dream', at: '2026-11-11T23:48:00-08:00', extra: '', checks: DREAM },
  { name: 'Dream, helper off, calendar unreadable', agents: 'off', go: 'dream', at: '2026-11-11T23:48:00-08:00', extra: '&meet=down', checks: ['.dream-clock', '.dream-date', '.dream-card', '.dream-hint'] },
  { name: 'Dream, nothing tomorrow', agents: 'off', go: 'dream', at: '2026-11-11T23:48:00-08:00', extra: '&meet=none', checks: ['.dream-clock', '.dream-date', '.dream-hint'] },
].map((v) => ({ ...v, q: query(v) }));
const VARIANTS = [
  { name: 'three lanes, long titles', q: work('3'), checks: [...WINGS, ...LANES] },
  { name: 'twelve sessions, long titles, five meetings at once', q: work('12', '&meet=busy'), checks: SCROLLED },
  { name: 'seven sessions, the fifth waiting', q: work('7ask'), checks: SCROLLED },
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
  deck('one key only', 'keys=one'),
  deck('a held set refused after a click (the app in front is not its app)', 'keys=wrong', { click: '.keys .key-tile' }),
  deck('Power BI cannot be brought forward, after a click', 'keys=refuse', { click: '.keys .key-tile' }),
  deck('heavy: three things wait (a meeting, an agent asks, an alarm), For you held', 'keys=typical&hold=foryou', { checks: FOR_YOU, q: work('ask', '&keys=typical&hold=foryou') }),
  { name: 'Deck, For you with one line', q: work('ask', '&keys=typical&hold=foryou&meet=none&net=calm'), checks: FOR_YOU },
  { name: 'Deck, sparse For you: only the alarm', q: work('3', '&keys=typical&hold=foryou&meet=none'), checks: FOR_YOU },
  { name: 'Deck, nothing waits: no chip, no For you page', q: work('3', '&keys=typical&meet=none&net=calm'), checks: DECK },
  { name: 'Deck, the agents helper is off: For you says nothing about agents', q: work('off', '&keys=typical&hold=foryou'), checks: FOR_YOU },
  { name: 'Deck, no keys for this app and no general set', q: work('0', '&keys=nogeneral&meet=none&net=calm'), checks: [...DECK_ROWS, '.work .right-wing .deck-quiet'] },
  { name: 'Deck, sparse: no big screen, nothing in front yet', q: work('0', '&keys=idle&arrange=none&meet=none&net=calm'), checks: [...DECK_ROWS, '.work .right-wing .deck-quiet'] },
  { name: 'Deck, keys.json has a problem, no windows for a layout', q: work('3', '&keys=problem&arrange=nowin'), checks: [...DECK_ROWS, '.work .right-wing .deck-quiet'], click: '.pin-tile' },
  { name: 'Deck, the key picker open over both rows', q: work('3', '&keys=typical'), checks: PICKER, click: 'ctx:.pin-tile' },
  { name: 'Home, Sound at its fullest: many moods, many speakers, long names, sleep timer', q: home('sonos=heavy&moods=many'), checks: [...HOME_CENTRE.filter((c) => !c.endsWith('mood-row')), ...SOUND_FULL] },
  { name: 'Home, typical: five moods, Sound playing', q: home('moods=five'), checks: [...HOME_CENTRE, ...SOUND_FULL] },
  { name: 'Home, sparse: no moods, one routine, one speaker', q: home('sonos=sparse&moods=none'), checks: ['.home .home-centre', '.home .moods', ...SOUND_FULL.slice(0, 4)] },
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
];
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
    const click = new URLSearchParams(location.search).get('click');
    if (click && click.startsWith('ctx:')) document.querySelector(click.slice(4))?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    else if (click) document.querySelector(click)?.click();
  }, 2000);
  setTimeout(() => {
    const sels = new URLSearchParams(location.search).get('checks').split('|');
    const band = document.querySelector('.top');
    const out = (r, c) => ({ l: c.left - r.left, r: r.right - c.right, t: c.top - r.top, b: r.bottom - c.bottom });
    const view = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const res = sels.map((sel) => ({ sel, items: [...document.querySelectorAll(sel)].map((e) => {
      const box = e.getBoundingClientRect();
      // Dream covers the whole stage (its text also drifts up to 15 px each way), so it is held by itself, not the band.
      const holder = e.closest('.dream') || e.parentElement.closest('.centre') || band || document.documentElement;
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
    const chipBoxes = [...document.querySelectorAll('.rib .ev')].map((e) => ({ lane: e.classList.contains('l2') ? 1 : 0, r: e.getBoundingClientRect(), t: e.textContent }));
    const overlaps = [];
    agentBoxes.forEach((a, i) => agentBoxes.slice(i + 1).forEach((b) => { if (a.id !== b.id && hit(a.r, b.r)) overlaps.push('agent ' + a.id + ' / ' + b.id); }));
    chipBoxes.forEach((a, i) => chipBoxes.slice(i + 1).forEach((b) => { if (a.lane === b.lane && hit(a.r, b.r)) overlaps.push('chip ' + a.t + ' / ' + b.t); }));
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
    const pre = document.createElement('pre'); pre.id = 'fit-check'; pre.textContent = JSON.stringify({ res, page, overlaps, cut, gaps });
    document.body.appendChild(pre);
  }, 3000);</script>`;
  const broken = overflow ? `<style>${OVERFLOWS[overflow]}</style>` : '';
  const page = join(out, 'work.html');
  writeFileSync(page, html.replace('</body>', `${broken}${measure}</body>`));

  let failed = false;
  if (overflow) console.log(`deliberate overflow: ${overflow} (${OVERFLOWS[overflow]})`);
  for (const v of overflow ? VARIANTS.slice(0, 1) : VARIANTS) {
    console.log(`${v.name} (${v.q}):`);
    const url = `${pathToFileURL(page).href}${v.q}&checks=${encodeURIComponent(v.checks.join('|'))}${v.click ? `&click=${encodeURIComponent(v.click)}` : ''}`;
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
    const { res, page: doc, overlaps, cut, gaps } = JSON.parse(text);
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
  process.exit(failed ? 1 : 0);
} finally {
  rmSync(out, { recursive: true, force: true });
}
