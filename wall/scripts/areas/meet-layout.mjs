// The Meet tab as layout A: the hero at the left, the island in the centre, the Next card at the upper right and
// Capture under it. Gallery states for every state the layout has, and the fit rules with a deliberate break each.
const at = encodeURIComponent('2026-11-11T10:24:00-08:00');
const atLate = encodeURIComponent('2026-11-11T10:52:00-08:00');
const base = (when, knobs) => `hz=work&at=${when}&clock=review&weather=ok&screen=meet&${knobs}`;
const fitBase = (when, knobs) => `?${base(when, knobs)}`;
const state = (name, knobs, expect, actions, when = at) => ({ screen: 'meet', name: `meet layout: ${name}`, query: base(when, knobs), custom: true, expect, actions });

// Each fit variant: its name, knobs and the time. `?leave=` puts "Leave by" on the meeting after the hero.
const VARIANTS = [
  ['Meet layout, next meeting in 20 minutes', at, 'meet=before&leave=100&checklist=four'],
  ['Meet layout, in a Teams call, known client', at, 'meet=known&call=teams&camera=1&rec=1&leave=60&checklist=four'],
  ['Meet layout, in a call, new client', at, 'meet=new&call=teams&checklist=four'],
  ['Meet layout, heavy day: long title, 14 people, back to back', atLate, 'meet=heavy&call=teams&long=1&checklist=long'],
  ['Meet layout, bare meeting: the island shows how the list works', at, 'meet=bare&call=teams&checklist=none'],
  ['Meet layout, nothing scheduled', at, 'meet=none'],
  ['Meet layout, a very long title ends in an ellipsis', at, 'meet=known&call=teams&mtitle=long&checklist=four'],
];
const BOXES = {
  hero: [124, 24, 944, 510],
  island: [984, 24, 1914, 510],
  next: [1944, 24, 2540, 380],
  capture: [1944, 384, 2540, 510],
};
const SELS = { hero: '.meet .meet-hero', island: '.meet .meet-island', next: '.meet .meet-later', capture: '.meet .meet-capture' };
const heroNames = ['Meet layout, next meeting in 20 minutes', 'Meet layout, in a Teams call, known client', 'Meet layout, in a call, new client', 'Meet layout, heavy day: long title, 14 people, back to back', 'Meet layout, bare meeting: the island shows how the list works'];

/** Runs in the page: every measurement of the Meet layout, as plain data. */
function measureMeet() {
  const r1 = (n) => Math.round(n * 10) / 10;
  const box = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { l: r1(b.left), t: r1(b.top), r: r1(b.right), b: r1(b.bottom) };
  };
  const meet = document.querySelector('.meet');
  if (!meet) return { present: false };
  const boxes = {
    hero: box('.meet .meet-hero'),
    island: box('.meet .meet-island'),
    next: box('.meet .meet-later'),
    capture: box('.meet .meet-capture'),
  };
  // Text under 16 px anywhere in the tab.
  const small = [];
  const walk = document.createTreeWalker(meet, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!(n.textContent || '').trim()) continue;
    const el = n.parentElement;
    if (!el || getComputedStyle(el).display === 'none') continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 15.95) small.push(`${size}px "${(n.textContent || '').trim().slice(0, 24)}" in ${el.className || el.tagName}`);
  }
  // Controls: 40 to 48 px tall (the hero keys 100), as far as the control is drawn.
  const controls = [];
  for (const [sel, lo, hi] of [['.meet .meet-key', 100, 100], ['.meet .meet-cap-open', 40, 48], ['.meet .meet-arrow', 40, 48], ['.meet .meet-dot', 40, 48], ['.meet .meet-next-act .meet-btn', 40, 48], ['.meet .meet-isl-howrow .meet-btn', 40, 48], ['.meet .meet-isl-item', 40, 48]]) {
    for (const e of document.querySelectorAll(sel)) {
      const b = e.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) continue;
      if (b.height < lo - 0.5 || b.height > hi + 0.5) controls.push(`${sel} is ${r1(b.height)} px tall (${lo === hi ? lo : lo + ' to ' + hi})`);
    }
  }
  // The title stays inside the hero's title area and ends on its own lines.
  const title = document.querySelector('.meet .meet-hero-title');
  let titleInfo = null;
  if (title) {
    const tb = title.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(title).lineHeight) || 1;
    titleInfo = { lines: Math.round(tb.height / lh), long: title.dataset.long === 'true', chars: (title.textContent || '').length, bottom: r1(tb.bottom), width: r1(tb.width), by: box('.meet .meet-hero-below')?.t ?? null };
  }
  const clock = document.querySelector('.main[data-place="meet"] > .top > div:has(> .clk)');
  const clockShown = !!clock && getComputedStyle(clock).display !== 'none';
  const body = document.querySelector('.meet .meet-isl-body, .meet .meet-isl-howto');
  const bodyBox = body ? body.getBoundingClientRect() : null;
  const island = document.querySelector('.meet .meet-island');
  const islandText = island ? (island.innerText || '').trim().length : 0;
  const overlaps = [];
  const names = Object.keys(boxes).filter((k) => boxes[k]);
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = boxes[names[i]], b = boxes[names[j]];
    if (a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5) overlaps.push(`${names[i]} (x ${a.l} to ${a.r}, y ${a.t} to ${a.b}) overlaps ${names[j]} (x ${b.l} to ${b.r}, y ${b.t} to ${b.b})`);
  }
  // Everything the hero draws stays inside its own box.
  const hero = document.querySelector('.meet .meet-hero');
  const out = [];
  if (hero) {
    const hb = hero.getBoundingClientRect();
    for (const e of hero.querySelectorAll('.meet-hero-title, .meet-hero-below, .meet-ring, .meet-keys, .meet-ppl, .meet-hero-last')) {
      const b = e.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) continue;
      if (b.right > hb.right + 0.5 || b.bottom > hb.bottom + 0.5) out.push(`${e.className} reaches x ${r1(b.right)}, y ${r1(b.bottom)} past the hero (x ${r1(hb.right)}, y ${r1(hb.bottom)})`);
    }
    // The block under the title stays above the keys, and the title above that block.
    const below = hero.querySelector('.meet-hero-below')?.getBoundingClientRect();
    const keys = hero.querySelector('.meet-keys')?.getBoundingClientRect();
    if (below && keys && below.bottom > keys.top + 0.5) out.push(`the lines under the title end at y ${r1(below.bottom)}, past the keys at y ${r1(keys.top)}`);
  }
  return { present: true, boxes, small, controls, titleInfo, clockShown, bodyBox: bodyBox && { t: r1(bodyBox.top), b: r1(bodyBox.bottom), h: r1(bodyBox.height) }, islandText, overlaps, out };
}

export default {
  name: 'meet-layout',
  gallery: {
    states: [
      state('next meeting in 20 minutes', 'meet=before&leave=100&checklist=four', ['Next, in 20 min', 'Design review with the platform team', 'Join', 'Open invite', 'After this', 'Lunch with Sam', 'Leave by', 'The wall switches to the call by itself when it starts.', 'The invite', 'Also on file']),
      state('in a Teams call, known client', 'meet=known&call=teams&camera=1&rec=1&leave=60&checklist=four', ['In call, Teams', 'Mute', 'Camera on', 'Share', 'Leave', 'Casey Rowe', '6 invited', '4 said yes, 1 maybe', 'Recording', 'Next', 'Lunch with Sam', 'Mark a moment', 'min left', 'Open file']),
      state('in a call, new client', 'meet=new&call=teams&checklist=four', ['In call, Teams', 'Intro call with a new client', 'Called by Jordan Vale', '3 invited', 'Thanks for making time', 'Who is coming', 'First-meeting list']),
      state('heavy day: long title, 14 people, back to back', 'meet=heavy&call=teams&long=1&checklist=long', ['In call, Teams', 'Customer escalation review', '14 invited', 'Next, back to back', 'Starts as this one ends', 'more today, the last ends'], undefined, atLate),
      state('bare meeting: the island explains the list', 'meet=bare&call=teams&checklist=none', ['In call, Teams', 'Catch-up call', 'Your first-meeting list', 'meet-checklist.txt', 'Open file', 'one item a line', '!Who is coming', '!Also on file']),
      state('Zoom call', 'meet=known&call=zoom&checklist=four', ['In call, Zoom', 'Mute', 'Share', 'Leave']),
      state('browser call: the keys are disabled', 'meet=known&call=browser', ['In call, browser', 'Mute', 'Camera', 'Share', 'Leave'], 'hover:.meet-key'),
      state('camera off', 'meet=known&call=teams&checklist=four', ['Camera off', '!Camera on']),
      state('recording', 'meet=known&call=teams&camera=1&rec=1&checklist=four', ['Recording00:']),
      state('nothing scheduled', 'meet=none', ['Nothing scheduled in the next 24 hours', 'Nothing else today', 'Your first-meeting list', 'Open file']),
      state('calendar not set up', 'meet=off', ['Calendar is not connected yet.', 'No calendar can be read.', 'Open file']),
      state('no account readable', 'meet=down', ['Calendar not available', 'No good read yet', 'No calendar can be read.']),
      state('the hover tip on Mute', 'meet=known&call=teams&checklist=four', ['Sends Ctrl+Shift+M to Teams. The wall cannot see whether you are muted.'], 'hover:.meet-key[data-role="mute"]'),
      state('the island moved to its second kind (arrow click)', 'meet=known&call=teams&checklist=four', ['Who is coming', 'Said yes', 'Also on file', 'Casey Rowe'], '.meet-arrow[aria-label="Next"]'),
    ],
  },
  fit: {
    variants: VARIANTS.map(([name, when, knobs]) => ({ name, q: fitBase(when, knobs), checks: ['.meet .meet-hero', '.meet .meet-island', '.meet .meet-later', '.meet .meet-capture'] })),
    measurements: { meetLayout: measureMeet },
    rules: {
      meetLayout: (variant, results, emit) => {
        const m = results.meetLayout;
        if (!variant.name.startsWith('Meet layout')) return false;
        let bad = false;
        const fail = (text) => { emit(`  FAIL meet layout: ${text}`); bad = true; };
        if (!m || !m.present) { fail('the Meet tab did not open'); return true; }
        // The four boxes at their planned places (plus or minus 2).
        const want = { hero: [124, 24, 944, 510], island: [984, 24, 1914, 510], next: [1944, 24, 2540, null], capture: [1944, 384, 2540, 510] };
        for (const [name, [l, t, r, b]] of Object.entries(want)) {
          const got = m.boxes[name];
          if (!got) { fail(`${name} is missing`); continue; }
          const off = [['left', got.l, l], ['top', got.t, t], ['right', got.r, r], ['bottom', got.b, b]].filter(([, g, w]) => w !== null && Math.abs(g - w) > 2);
          // The hero's own box is its planned size; the Next card is as tall as its words, down to y 380 at most.
          if (name === 'hero' && off.length) { fail(`${name} is at x ${got.l} to ${got.r}, y ${got.t} to ${got.b}, planned x ${l} to ${r}, y ${t} to ${b}`); continue; }
          if (name === 'next') { if (got.b > 380.5) fail(`next card ends at y ${got.b}, past y 380 where Capture begins`); if (off.length) fail(`next card at x ${got.l} to ${got.r}, y from ${got.t}, planned x ${l} to ${r}, y from ${t}`); continue; }
          if (off.length) fail(`${name} is at x ${got.l} to ${got.r}, y ${got.t} to ${got.b}, planned x ${l} to ${r}, y ${t} to ${b}`);
        }
        for (const o of m.overlaps) fail(`overlap: ${o}`);
        for (const s of m.small.slice(0, 4)) fail(`text under 16 px: ${s}`);
        for (const c of m.controls.slice(0, 4)) fail(`control size: ${c}`);
        if (m.clockShown) fail('the frame clock is drawn on Meet (the hero draws the time)');
        if (m.islandText === 0) fail('the island is empty');
        for (const o of m.out) fail(o);
        if (m.titleInfo) {
          const t = m.titleInfo;
          if (t.long && t.lines > 3) fail(`the long title takes ${t.lines} lines (three at most)`);
          if (!t.long && t.lines > 2) fail(`the title takes ${t.lines} lines (two at most)`);
          if (t.by !== null && t.bottom > t.by + 0.5) fail(`the title ends at y ${t.bottom}, below where the lines under it begin (y ${t.by})`);
        }
        if (!bad) emit('  ok   meet layout: hero, island, Next card and Capture at their places, no overlap, text 16 px or more, controls 40 to 48 px (keys 100), title inside the hero, no frame clock, island never empty');
        return bad;
      },
    },
    breaks: {
      'meet-island-box': { css: '.meet .meet-island { left: 600px !important; }', expect: /^ *FAIL meet layout: island is at /m, appliesTo: (v) => v.name === VARIANTS[0][0] },
      'meet-overlap': { css: '.meet .meet-capture { top: 200px !important; }', expect: /^ *FAIL meet layout: overlap: /m, appliesTo: (v) => v.name === VARIANTS[1][0] },
      'meet-text-size': { css: '.meet .meet-ppl-n { font-size: 13px !important; }', expect: /^ *FAIL meet layout: text under 16 px: /m, appliesTo: (v) => v.name === VARIANTS[1][0] },
      'meet-control-size': { css: '.meet .meet-cap-open { height: 24px !important; }', expect: /^ *FAIL meet layout: control size: /m, appliesTo: (v) => v.name === VARIANTS[1][0] },
      'meet-long-title': { css: '.meet .meet-hero-title { -webkit-line-clamp: unset !important; display: block !important; }', expect: /^ *FAIL meet layout: (the long title takes|the title ends)/m, appliesTo: (v) => v.name === VARIANTS[6][0] },
      'meet-clock': { css: ".main[data-place='meet'] > .top > div:has(> .clk) { display: block !important; }", expect: /^ *FAIL meet layout: the frame clock is drawn/m, appliesTo: (v) => v.name === VARIANTS[1][0] },
      'meet-island-empty': { css: '.meet .meet-island-body, .meet .meet-isl-body, .meet .meet-isl-howto { display: none !important; } .meet .meet-isl-hd, .meet .meet-isl-foot { display: none !important; }', expect: /^ *FAIL meet layout: the island is empty/m, appliesTo: (v) => v.name === VARIANTS[4][0] },
    },
  },
};
