// The Meet tab as layout A: the hero at the left (the call key deck: a left column, a 2 by 4 grid of keys, the people and
// the chips), the island in the centre, the Next card at the right. Gallery states for every state the layout has, and the fit rules with a deliberate break each.
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
  ['Meet layout, nothing scheduled and no brief key: Connect under the headline', at, 'meet=none&token=off'],
  ['Meet layout, nothing scheduled, the brief key field open', at, 'meet=none&token=off', '.meet-brief-setup .meet-retry'],
  ['Meet layout, a very long title ends in an ellipsis', at, 'meet=known&call=teams&mtitle=long&checklist=four'],
  ['Meet layout, eight checklist items', at, 'meet=bare&call=teams&checklist=long'],
  ['Meet layout, a plain call with no meeting', at, 'meet=none&call=teams&rec=1'],
  ['Meet layout, the call is 12 minutes past its meeting', at, 'meet=over&call=teams&callsince=-70&rec=1'],
  ['Meet layout, the next meeting overlaps this one', at, 'meet=clash&call=teams'],
  ['Meet layout, a signed out account: the amber line pushes the ring down', at, 'meet=signin-fault&call=teams'],
  ['Meet layout, brief feed (3 items)', at, 'meet=known&call=teams&checklist=four&brief=ready'],
  ['Meet layout, brief feed (10 items: 7 rows and a count)', at, 'meet=known&call=teams&checklist=four&brief=many'],
  ['Meet layout, brief empty (no history yet)', at, 'meet=known&call=teams&checklist=four&brief=empty'],
  ['Meet layout, brief building', at, 'meet=known&call=teams&checklist=four&brief=building'],
];
const BRIEF_MANY_VARIANT = 'Meet layout, brief feed (10 items: 7 rows and a count)';

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
  // Controls: 40 to 48 px tall (the hero keys 112), as far as the control is drawn.
  const controls = [];
  for (const [sel, lo, hi] of [['.meet .meet-key', 112, 112], ['.meet .meet-arrow', 40, 48], ['.meet .meet-dot', 40, 48], ['.meet .meet-next-act .meet-btn', 40, 48], ['.meet .meet-isl-howrow .meet-btn', 40, 48], ['.meet .meet-isl-item', 40, 48], ['.meet .meet-retry', 40, 48], ['.meet .meet-trouble-link', 40, 48], ['.meet .meet-isl-row', 48, 70], ['.meet .meet-brief-row', 40, 48]]) {
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
  // The key deck: keys at least 96 px wide, the ring 120 px, the grid inside the hero and clear of the left column.
  const narrow = [];
  for (const e of document.querySelectorAll('.meet .meet-key')) {
    const b = e.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) continue;
    if (b.width < 95.5) narrow.push(`${e.getAttribute('aria-label') || e.textContent} is ${r1(b.width)} px wide (96 or more)`);
  }
  const dial = document.querySelector('.meet .meet-hero .meet-ring-dial');
  const dialInfo = dial ? { w: r1(dial.getBoundingClientRect().width), h: r1(dial.getBoundingClientRect().height) } : null;
  const keysGrid = document.querySelector('.meet .meet-hero .meet-keys');
  const grid = keysGrid ? { display: getComputedStyle(keysGrid).display, cells: keysGrid.children.length, box: box('.meet .meet-hero .meet-keys') } : null;
  const clock = document.querySelector('.main[data-place="meet"] > .top > div:has(> .clk)');
  const clockShown = !!clock && getComputedStyle(clock).display !== 'none';
  const body = document.querySelector('.meet .meet-isl-body, .meet .meet-isl-howto');
  const bodyBox = body ? body.getBoundingClientRect() : null;
  const bodyShown = !!body && getComputedStyle(body).display !== 'none';
  const bodyText = body && bodyShown ? (body.innerText || '').trim().length : 0;
  // The checklist pane: every row inside the pane's box.
  const pane = document.querySelector('.meet .meet-isl-main');
  const rows = [...document.querySelectorAll('.meet .meet-isl-item')].map((e) => { const b = e.getBoundingClientRect(); return { t: r1(b.top), b: r1(b.bottom) }; });
  const paneBox = pane ? pane.getBoundingClientRect() : null;
  const rowsCut = paneBox ? rows.map((r, i) => ({ i, r })).filter(({ r }) => r.t < paneBox.top - 0.5 || r.b > paneBox.bottom + 0.5).map(({ i, r }) => `row ${i + 1} at y ${r.t} to ${r.b} is outside the pane (y ${r1(paneBox.top)} to ${r1(paneBox.bottom)})`) : [];
  // The brief feed: at most 7 rows, every row inside the body, a title that never wraps, a sub line of 16 px or more.
  const briefBody = document.querySelector('.meet .meet-brief-body')?.getBoundingClientRect() ?? null;
  const briefRows = [...document.querySelectorAll('.meet .meet-brief-row')];
  const briefCut = briefBody ? briefRows.map((e, i) => ({ i, b: e.getBoundingClientRect() })).filter(({ b }) => b.top < briefBody.top - 0.5 || b.bottom > briefBody.bottom + 0.5).map(({ i, b }) => `brief row ${i + 1} at y ${r1(b.top)} to ${r1(b.bottom)} is outside the feed (y ${r1(briefBody.top)} to ${r1(briefBody.bottom)})`) : [];
  const briefWrap = briefRows.map((e, i) => ({ i, t: e.querySelector('.meet-brief-title') })).filter(({ t }) => t && t.getBoundingClientRect().height > parseFloat(getComputedStyle(t).lineHeight) * 1.5).map(({ i }) => `brief row ${i + 1} title wraps to a second line`);
  const briefSub = briefRows.map((e) => e.querySelector('.meet-brief-sub')).filter((t) => t && parseFloat(getComputedStyle(t).fontSize) < 15.95).length;
  const briefMore = document.querySelector('.meet .meet-brief-more');
  const brief = { rows: briefRows.length, cut: briefCut, wrap: briefWrap, subSmall: briefSub, more: briefMore ? (briefMore.textContent || '').trim() : null, ask: !!document.querySelector('.meet .meet-brief-ask'), bodyBottom: briefBody ? r1(briefBody.bottom) : null };
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
  const heroParts = [];
  if (hero) {
    const hb = hero.getBoundingClientRect();
    for (const e of hero.querySelectorAll('.meet-hero-title, .meet-hero-left, .meet-hero-below, .meet-ring, .meet-keys, .meet-ppl, .meet-lights, .meet-hero-line')) {
      const b = e.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) continue;
      if (b.right > hb.right + 0.5 || b.bottom > hb.bottom + 0.5) out.push(`${e.className} reaches x ${r1(b.right)}, y ${r1(b.bottom)} past the hero (x ${r1(hb.right)}, y ${r1(hb.bottom)})`);
    }
    // The left column (title, called by, ring) stays left of the key grid, and the title above the lines under it.
    const left = hero.querySelector('.meet-hero-left')?.getBoundingClientRect();
    const keys = hero.querySelector('.meet-keys')?.getBoundingClientRect();
    if (left && keys && left.right > keys.left + 0.5) out.push(`the left column reaches x ${r1(left.right)}, into the keys at x ${r1(keys.left)}`);
    // Nothing the hero draws in its own parts overlaps another (the person card is a popover and is left out).
    const parts = ['.meet-hero-st', '.meet-hero-title', '.meet-hero-left', '.meet-keys', '.meet-ppl', '.meet-lights', '.meet-hero-line'].map((sel) => [sel, hero.querySelector(sel)?.getBoundingClientRect()]).filter(([, b]) => b && (b.width > 0 || b.height > 0));
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i][1], b = parts[j][1];
      if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) heroParts.push(`${parts[i][0]} overlaps ${parts[j][0]}`);
    }
  }
  return { present: true, boxes, small, controls, narrow, dialInfo, grid, heroParts, titleInfo, clockShown, bodyBox: bodyShown && bodyBox ? { t: r1(bodyBox.top), b: r1(bodyBox.bottom), h: r1(bodyBox.height) } : null, bodyText, islandText, overlaps, out, rowCount: rows.length, rowsCut, brief };
}

export default {
  name: 'meet-layout',
  gallery: {
    states: [
      state('next meeting in 20 minutes', 'meet=before&leave=100&checklist=four', ['Next, in 20 min', 'Design review with the platform team', 'Join', 'Open invite', 'After this', 'Lunch with Sam', 'Leave by', 'The wall switches to the call by itself when it starts.', 'The invite', 'Also on file']),
      state('in a Teams call, known client', 'meet=known&call=teams&camera=1&rec=1&leave=60&checklist=four', ['In call, Teams', 'Mute', 'Camera on', 'Share', 'Leave', 'Casey Rowe', '6 invited', '4 said yes, 1 maybe', 'Recording', 'Next', 'Lunch with Sam', 'min left']),
      state('in a call, new client', 'meet=new&call=teams&checklist=four', ['In call, Teams', 'Intro call with a new client', 'Called by Jordan Vale', '3 invited', 'Thanks for making time', 'Who is coming', 'First-meeting list']),
      state('heavy day: long title, 14 people, back to back', 'meet=heavy&call=teams&long=1&checklist=long', ['In call, Teams', 'Customer escalation review', '14 invited', 'Next, back to back', 'Starts as this one ends', 'more today, the last ends'], undefined, atLate),
      state('bare meeting: the island explains the list', 'meet=bare&call=teams&checklist=none', ['In call, Teams', 'Catch-up call', 'Your first-meeting list', 'meet-checklist.txt', 'Open file', 'one item a line', '!Who is coming', '!Also on file']),
      state('the call key deck before a call: Join and Open invite, six later keys', 'meet=before&leave=100&checklist=four', ['Join', 'Open invite', 'Copy join info', 'Open chat', 'Running late', 'Do Not Disturb', 'Camera check', 'Open in Teams', 'Office', 'Key lights', 'Panels', '!Lights: later', 'min to go']),
      state('the call key deck in a call: four live keys, four later keys', 'meet=known&call=teams&camera=1&rec=1&checklist=four', ['Mute', 'Camera on', 'Share', 'Leave', 'Raise hand', 'Reactions', 'Chat panel', 'Open in Teams', 'Recording']),
      state('the person card (P1) open at the initials', 'meet=known&call=teams&checklist=four', ['Dana Whitfield', 'Accepted', 'Copy email', 'Message on Teams', '!Contact card'], '.meet-ini[aria-label^="Dana Whitfield"]'),
      state('the person card for a person with no address: no actions', 'meet=known&call=teams&checklist=four', ['Robin Okafor', 'Accepted', 'No address on the invite', '!Copy email'], '.meet-ini[aria-label^="Robin Okafor"]'),
      state('the amber signed-out line under the title, the ring below it', 'meet=signin-fault&call=teams', ['Second calendar signed out.', 'Open Tools', 'Mute', 'min left']),
      state('Zoom call', 'meet=known&call=zoom&checklist=four', ['In call, Zoom', 'Mute', 'Share', 'Leave']),
      state('browser call: the keys are disabled', 'meet=known&call=browser', ['In call, browser', 'Mute', 'Camera', 'Share', 'Leave', 'Open in browser'], 'hover:.meet-key'),
      state('camera off', 'meet=known&call=teams&checklist=four', ['Camera off', '!Camera on']),
      state('recording', 'meet=known&call=teams&camera=1&rec=1&checklist=four', ['Recording00:']),
      state('nothing scheduled', 'meet=none', ['Nothing scheduled in the next 24 hours', 'Nothing else today', 'Your first-meeting list', 'Open file', 'Connected', 'Forget']),
      state('nothing scheduled, no brief key: Connect under the headline', 'meet=none&token=off', ['Nothing scheduled in the next 24 hours', 'Meeting brief not connected', 'Connect']),
      state('nothing scheduled, Connect opens the key field', 'meet=none&token=off', ['Nothing scheduled in the next 24 hours', 'Save', 'Cancel', '!Meeting brief not connected'], '.meet-brief-setup .meet-retry'),
      state('calendar not set up', 'meet=off', ['Calendar is not connected yet.', 'No calendar can be read.', 'Open file']),
      state('no account readable', 'meet=down', ['Calendar not available', 'No good read yet', 'No calendar can be read.']),
      state('no account readable, the last meeting kept (dimmed, as of)', 'meet=stale', ['Last known meeting', 'Design review with the platform team', 'as of', 'Calendar not read', '!Join', '!min left']),
      state('eight checklist items fit the pane', 'meet=bare&call=teams&checklist=long', ['8. Ask what happens', '1. Ask what happens', 'Your first-meeting list']),
      state('a plain call with no meeting', 'meet=none&call=teams&rec=1', ['In call, Teams', 'Call in progress', 'Mute', 'Recording', 'This call', '!Nothing scheduled']),
      state('the call is 12 minutes past its meeting', 'meet=over&call=teams&callsince=-70&rec=1', ['In call, Teams', 'Design review with the platform team', 'min over', 'ended', 'Recording', 'Lunch with Sam']),
      state('the next meeting overlaps this one', 'meet=clash&call=teams', ['Next, overlaps', 'Starts before this one ends', 'Lunch with Sam']),
      state('the hover tip on Mute', 'meet=known&call=teams&checklist=four', ['Sends Ctrl+Shift+M to Teams. The wall cannot see whether you are muted.'], 'hover:.meet-key[data-role="mute"]'),
      state('brief feed: strip, rows, dimmed ask box', 'meet=known&call=teams&checklist=four&brief=ready', ['Priya Calder', 'Northwind Outfitters', 'Annual renewal', 'Re: renewal terms for next year', 'Quarterly check-in', 'Ask about this meeting (coming later)', '!Also on file']),
      state('brief feed: a row opened', 'meet=known&call=teams&checklist=four&brief=ready', ['Back', 'Happy to go ahead if the support hours stay the same', 'Send the revised quote', 'Open'], '.meet-brief-row'),
      state('brief feed: ten items, seven rows and a count', 'meet=known&call=teams&checklist=four&brief=many', ['+ 3 more items', 'Item 1: notes from the renewal talks', '!Item 8']),
      state('brief empty: no history yet, the island keeps its pages', 'meet=known&call=teams&checklist=four&brief=empty', ['No history yet with Northwind Outfitters', 'Teams is not signed in yet', 'The invite', 'Also on file']),
      state('brief building', 'meet=known&call=teams&checklist=four&brief=building', ['Getting the brief ready', 'The invite']),
      state('brief not connected: one faint line', 'meet=known&call=teams&checklist=four', ['Meeting brief not connected', 'The invite']),
      state('brief failed: a Retry key', 'meet=known&call=teams&checklist=four&brief=failed', ['Meeting brief could not be read', 'Retry']),
      state('brief refused by the box', 'meet=known&call=teams&checklist=four&brief=forbidden', ['The box refused the brief key']),
      state('the island moved to its second kind (arrow click)', 'meet=known&call=teams&checklist=four', ['Who is coming', 'Said yes', 'Also on file', 'Casey Rowe'], '.meet-arrow[aria-label="Next"]'),
    ],
  },
  fit: {
    variants: VARIANTS.map(([name, when, knobs, click]) => ({ name, q: fitBase(when, knobs), checks: ['.meet .meet-hero', '.meet .meet-island', '.meet .meet-later', ...(click ? ['.meet .meet-brief-setup', '.meet .meet-keyfield'] : [])], ...(click ? { click } : {}) })),
    measurements: { meetLayout: measureMeet },
    rules: {
      meetLayout: (variant, results, emit) => {
        const m = results.meetLayout;
        if (!variant.name.startsWith('Meet layout')) return false;
        let bad = false;
        const fail = (text) => { emit(`  FAIL meet layout: ${text}`); bad = true; };
        if (!m || !m.present) { fail('the Meet tab did not open'); return true; }
        // The three boxes at their planned places (plus or minus 2).
        const want = { hero: [124, 24, 944, 510], island: [984, 24, 1914, 510], next: [1944, 24, 2540, 510] };
        for (const [name, [l, t, r, b]] of Object.entries(want)) {
          const got = m.boxes[name];
          if (!got) { fail(`${name} is missing`); continue; }
          const off = [['left', got.l, l], ['top', got.t, t], ['right', got.r, r], ['bottom', got.b, b]].filter(([, g, w]) => w !== null && Math.abs(g - w) > 2);
          if (name === 'hero' && off.length) { fail(`${name} is at x ${got.l} to ${got.r}, y ${got.t} to ${got.b}, planned x ${l} to ${r}, y ${t} to ${b}`); continue; }
          if (off.length) fail(`${name} is at x ${got.l} to ${got.r}, y ${got.t} to ${got.b}, planned x ${l} to ${r}, y ${t} to ${b}`);
        }
        for (const o of m.overlaps) fail(`overlap: ${o}`);
        for (const s of m.small.slice(0, 4)) fail(`text under 16 px: ${s}`);
        for (const c of m.controls.slice(0, 4)) fail(`control size: ${c}`);
        if (m.clockShown) fail('the frame clock is drawn on Meet (the hero draws the time)');
        // The island's active body must be drawn, with words in it: hiding the body alone leaves a header and a footer.
        if (m.islandText === 0 || !m.bodyBox || m.bodyBox.h < 60 || m.bodyText === 0) fail('the island is empty (its body is ' + (m.bodyBox ? m.bodyBox.h + ' px tall with ' + m.bodyText + ' characters' : 'not drawn') + ')');
        for (const c of m.rowsCut.slice(0, 3)) fail('checklist ' + c);
        if (variant.name.endsWith('eight checklist items') && m.rowCount !== 8) fail('the checklist pane shows ' + m.rowCount + ' rows, not 8');
        for (const c of m.brief.cut.slice(0, 3)) fail(c);
        for (const w of m.brief.wrap.slice(0, 3)) fail(w);
        if (m.brief.subSmall > 0) fail(`brief sub line is under 16 px on ${m.brief.subSmall} rows`);
        if (m.brief.rows > 7) fail(`the brief feed draws ${m.brief.rows} rows (7 at most)`);
        if (variant.name === BRIEF_MANY_VARIANT && (m.brief.rows !== 7 || m.brief.more !== '+ 3 more items')) fail(`the ten item feed shows ${m.brief.rows} rows and "${m.brief.more}" (7 rows and "+ 3 more items")`);
        if (m.brief.rows > 0 && !m.brief.ask) fail('the feed has no ask box');
        for (const o of m.out) fail(o);
        for (const o of m.heroParts.slice(0, 3)) fail(`hero overlap: ${o}`);
        for (const n of m.narrow.slice(0, 3)) fail(`key size: ${n}`);
        if (m.dialInfo && (Math.abs(m.dialInfo.w - 120) > 0.5 || Math.abs(m.dialInfo.h - 120) > 0.5)) fail(`the ring is ${m.dialInfo.w} by ${m.dialInfo.h} px (120)`);
        if (m.grid && (m.grid.display !== 'grid' || m.grid.cells > 8)) fail(`the keys are a ${m.grid.display} of ${m.grid.cells} cells (a grid of eight at most)`);
        if (m.titleInfo) {
          const t = m.titleInfo;
          if (t.long && t.lines > 4) fail(`the long title takes ${t.lines} lines (four at most)`);
          if (!t.long && t.lines > 3) fail(`the title takes ${t.lines} lines (three at most)`);
          if (t.by !== null && t.bottom > t.by + 0.5) fail(`the title ends at y ${t.bottom}, below where the lines under it begin (y ${t.by})`);
        }
        if (!bad) emit('  ok   meet layout: hero, island and Next card at their places, no overlap, text 16 px or more, controls 40 to 48 px (keys 112 tall, 96 wide or more), the 120 px ring, the key grid inside the hero and clear of everything else, title inside the hero, no frame clock, island never empty');
        return bad;
      },
    },
    breaks: {
      'meet-key-narrow': { css: '.meet .meet-hero .meet-key { width: 80px !important; }', expect: /^ *FAIL meet layout: key size: /m, appliesTo: (v) => v.name === VARIANTS[1][0] },
      'meet-ring-size': { css: '.meet .meet-hero .meet-ring-dial { width: 164px !important; height: 164px !important; }', expect: /^ *FAIL meet layout: the ring is /m, appliesTo: (v) => v.name === VARIANTS[1][0] },
      'meet-hero-overlap': { css: '.meet .meet-hero .meet-ppl { top: 200px !important; }', expect: /^ *FAIL meet layout: hero overlap: /m, appliesTo: (v) => v.name === VARIANTS[1][0] },
      'meet-island-box': { css: '.meet .meet-island { left: 600px !important; }', expect: /^ *FAIL meet layout: island is at /m, appliesTo: (v) => v.name === VARIANTS[0][0] },
      'meet-overlap': { css: '.meet .meet-later { left: 1600px !important; }', expect: /^ *FAIL meet layout: overlap: /m, appliesTo: (v) => v.name === VARIANTS[1][0] },
      'meet-text-size': { css: '.meet .meet-ppl-n { font-size: 13px !important; }', expect: /^ *FAIL meet layout: text under 16 px: /m, appliesTo: (v) => v.name === VARIANTS[1][0] },
      'meet-control-size': { css: '.meet .meet-arrow { height: 24px !important; }', expect: /^ *FAIL meet layout: control size: /m, appliesTo: (v) => v.name === VARIANTS[1][0] },
      'meet-long-title': { css: '.meet .meet-hero-title { -webkit-line-clamp: unset !important; display: block !important; }', expect: /^ *FAIL meet layout: (the long title takes|the title takes|the title ends)/m, appliesTo: (v) => v.name === VARIANTS[6][0] },
      'meet-clock': { css: ".main[data-place='meet'] > .top > div:has(> .clk) { display: block !important; }", expect: /^ *FAIL meet layout: the frame clock is drawn/m, appliesTo: (v) => v.name === VARIANTS[1][0] },
      'meet-checklist-clipped': { css: '.meet .meet-isl-check { gap: 12px !important; }', expect: /^ *FAIL meet layout: checklist row \d+ at y /m, appliesTo: (v) => v.name.endsWith('eight checklist items') },
      'brief-wrap': { css: '.meet .meet-brief-title { white-space: normal !important; overflow: visible !important; text-overflow: clip !important; }', expect: /^ *FAIL meet layout: brief row \d+ title wraps/m, appliesTo: (v) => v.name === BRIEF_MANY_VARIANT },
      'brief-small': { css: '.meet .meet-brief-sub { font-size: 13px !important; }', expect: /^ *FAIL meet layout: (brief sub line is under 16 px|text under 16 px)/m, appliesTo: (v) => v.name === BRIEF_MANY_VARIANT },
      'brief-tall': { css: '.meet .meet-brief-row { height: 72px !important; }', expect: /^ *FAIL meet layout: brief row \d+ at y /m, appliesTo: (v) => v.name === BRIEF_MANY_VARIANT },
      'meet-island-empty': { css: '.meet .meet-isl-body, .meet .meet-isl-howto { display: none !important; }', expect: /^ *FAIL meet layout: the island is empty/m, appliesTo: (v) => v.name === VARIANTS[4][0] },
    },
  },
};
