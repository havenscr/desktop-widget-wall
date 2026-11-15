// Under the clock on Unwind (vote W3, D): three pins, then the volume and "Stop in 30 min", on both tabs, and Up next
// keeping one song on Listen. One area file: gallery states, fit variants, the in-page measurement, its rule and the
// deliberate breaks. The mock list, pins, level and timer are invented (see `devMocks/watch.ts`: wpins, wvol, wsleep, wrows).

const BASE = 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&watch=mock&wlook=sky';
const LISTEN = 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo&watch=mock&wtab=listen&wpins=three';
const CHIP_TIP = "Stops the wall's video and pauses the player shown on Listen";

const state = (name, extra, expect, actions) => ({
  screen: 'unwind',
  name: `under the clock: ${name}`,
  query: `${extra.startsWith('hz=') ? extra : `${BASE}&${extra}`}`,
  custom: true,
  ...(Array.isArray(expect) || typeof expect === 'string' ? { expect } : expect),
  ...(actions ? { actions } : {}),
});

const states = [
  state('Watch at rest, three pins', 'wlist=three&wpins=three', ['Night drive mix', 'Lofi beats radio, live', 'pixel_harbor', 'Stop in 30 min']),
  state('Watch shown, the first pin playing and lit', 'wlist=three&wpins=three&wplay=0&wrows=shown', ['Night drive mix', 'Stop in 30 min']),
  state('nothing pinned, three dashed places', 'wlist=three&wpins=none', ['Add a pin', 'Stop in 30 min']),
  state('one pin', 'wlist=three&wpins=one&wrows=shown', ['Night drive mix', 'Add a pin']),
  state('long labels on two lines', 'wlist=three&wpins=long&wrows=shown', ['Night drive mix for the long way home']),
  state('a pin whose item left the Watch list', 'wlist=three&wpins=gone&wrows=shown', ['Add a pin']),
  state('the add menu open', 'wlist=three&wpins=one&wrows=shown', ['Pin from the Watch list', 'pixel_harbor', '!Night drive mix, '], '.u-pinslot:nth-child(2) .u-pin'),
  state('the add menu with an empty Watch list', 'wlist=none&wpins=none', ['Add a video to the Watch list first.', 'Open Watch'], '.u-pinslot:nth-child(1) .u-pin'),
  state("a pin's right-click menu", 'wlist=three&wpins=three&wrows=shown', ['Replace', 'Remove'], 'ctx:.u-pinslot:nth-child(1) .u-pin'),
  state('the sleep timer running', 'wlist=three&wpins=three&wplay=0&wsleep=24&wrows=shown', ['Stops in 24 min']),
  state('after the timer ended', 'wlist=three&wpins=three&wplay=0&wsleep=end', ['Stopped by the sleep timer.']),
  state('Twitch playing, the volume disabled', 'wlist=three&wpins=three&wplay=2&wrows=shown', ['Live on the wall', 'Twitch keeps its own volume. Use the sound control on the video.'], 'hover:.u-snd'),
  state('muted', 'wlist=three&wpins=three&wplay=0&wrows=shown&wvol=40', { expectNote: 'the sound button shows the muted glyph and the slider is dimmed after the click' }, '.u-snd'),
  state('Listen, Spotify playing, Up next keeps one song', LISTEN, ['Up next', '!Lantern Song 4']),
  state('Listen, nothing playing, the volume disabled', `${LISTEN}&spotifyplay=none&media=none`, ['Nothing playing'], 'hover:.u-snd'),
  state('autoplay refused and waiting for a click, the rows still work', 'wlist=three&wpins=three&wplay=0&wstate=refused&wrows=shown', ['Lofi beats radio, live'], '.u-pinslot:nth-child(2) .u-pin'),
  state('the tip on the sleep chip', 'wlist=three&wpins=three&wrows=shown', [CHIP_TIP], 'hover:.u-sleep'),
];

/**
 * In the page (self-contained: it is serialised into the page). With `uccheck=rows` the two rows (row one at wall y 272,
 * 48 tall; row two at 330, 40 tall; both from x 124 to 594), the three pins (151 wide, inside the wing, clear of the tabs and
 * each other), every control 40 to 48 px tall, text 16 px or more, a long label on two lines inside its pill, the rows
 * present and readable at rest, and the office slot empty and taking no pointer. With `uccheck=next` Up next starts at y
 * 382, shows one row and ends above y 457. With `uccheck=menu` the open pin menu lies inside the wall, right of the rail.
 */
const measureUnderClock = () => {
  const mode = new URLSearchParams(location.search).get('uccheck');
  if (!mode) return null;
  try {
    return check(mode);
  } catch (e) {
    return { fails: ['under the clock: the check broke: ' + e.message], mode };
  }
  function check(mode) {
    const fails = [];
    const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const near = (a, b, d) => Math.abs(a - b) <= d;
    const px = (e, prop) => parseFloat(getComputedStyle(e)[prop]);
    const meet = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
    const where = (r) => [r.l, r.t, r.r, r.b].map(Math.round).join(',');
    const effective = (e) => { let o = 1; for (let n = e; n && n.nodeType === 1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };
    const quick = document.querySelector('.u-quick');
    if (mode === 'next') {
      const next = document.querySelector('.u-next');
      if (!next) return { fails: ['under the clock: no Up next on Listen'], mode };
      const n = R(next);
      const rows = [...next.querySelectorAll('.u-next-row')];
      if (!near(n.t, 382, 2)) fails.push('Up next starts at y ' + Math.round(n.t) + ' (382 plus or minus 2)');
      if (rows.length !== 1) fails.push('Up next shows ' + rows.length + ' rows (one)');
      const end = Math.max(n.b, ...rows.map((r) => R(r).b));
      if (end > 457) fails.push('Up next ends at y ' + Math.round(end) + ' (above 457, Watt\'s head)');
      return { fails, mode };
    }
    if (mode === 'menu') {
      const menu = document.querySelector('.u-pin-menu');
      if (!menu) return { fails: ['under the clock: no pin menu is open'], mode };
      const m = R(menu);
      if (m.l < 123.5 || m.r > 2560.5 || m.t < 0 || m.b > 720.5) fails.push('the open menu is at ' + where(m) + ', outside the wall or under the rail (x 124 and right, inside 2560 by 720)');
      const small = [...menu.querySelectorAll('.u-pin-menu-title, button span, .u-pin-menu-note')].filter((e) => px(e, 'fontSize') < 15.99);
      if (small.length) fails.push('text under 16 px in the menu (' + Math.round(px(small[0], 'fontSize')) + ' px)');
      return { fails, mode };
    }
    if (!quick) return { fails: ['under the clock: no rows under the tabs'], mode };
    const row1 = R(document.querySelector('.u-pins'));
    const row2 = R(document.querySelector('.u-qsound'));
    if (!near(row1.t, 272, 1) || !near(row1.h, 48, 0.6)) fails.push('row one is at y ' + Math.round(row1.t) + ', ' + Math.round(row1.h) + ' tall (272, 48)');
    if (!near(row2.t, 330, 1) || !near(row2.h, 40, 0.6)) fails.push('row two is at y ' + Math.round(row2.t) + ', ' + Math.round(row2.h) + ' tall (330, 40)');
    for (const [name, r] of [['one', row1], ['two', row2]]) if (!near(r.l, 124, 1) || !near(r.r, 594, 1.5)) fails.push('row ' + name + ' runs from x ' + Math.round(r.l) + ' to ' + Math.round(r.r) + ' (124 to 594)');
    const tabs = R(document.querySelector('.u-tabs'));
    const pins = [...document.querySelectorAll('.u-pin')].map((e) => ({ e, r: R(e) }));
    if (pins.length !== 3) fails.push('there are ' + pins.length + ' pins (three places)');
    pins.forEach(({ r }, i) => {
      if (!near(r.w, 151, 1)) fails.push('a pin is ' + Math.round(r.w * 10) / 10 + ' px wide (151)');
      if (r.l < row1.l - 0.5 || r.r > row1.r + 0.5) fails.push('a pin at ' + where(r) + ' is outside the wing');
      if (r.t < tabs.b - 0.5) fails.push('a pin at ' + where(r) + ' is over the tabs (they end at y ' + Math.round(tabs.b) + ')');
      if (i > 0 && meet(r, pins[i - 1].r)) fails.push('two pins overlap');
    });
    const controls = [...pins.map((p) => p.e), document.querySelector('.u-snd'), document.querySelector('.u-sleep')].filter(Boolean);
    for (const e of controls) {
      const h = R(e).h;
      if (h < 39.5 || h > 48.5) fails.push('a control is ' + Math.round(h * 10) / 10 + ' px tall (40 to 48)');
    }
    const texts = [...document.querySelectorAll('.u-pin-name, .u-pin-add, .u-sleep span, .u-qval')].filter((e) => e.textContent.trim());
    const small = texts.filter((e) => px(e, 'fontSize') < 15.99);
    if (small.length) fails.push('text under 16 px in the rows (' + Math.round(px(small[0], 'fontSize')) + ' px in "' + small[0].textContent.trim().slice(0, 20) + '")');
    for (const e of document.querySelectorAll('.u-pin-name')) {
      const pill = R(e.closest('.u-pin'));
      const n = R(e);
      const line = px(e, 'lineHeight');
      if (n.h > line * 2 + 1) fails.push('a label is ' + Math.round(n.h / line) + ' lines tall (two at most, then an ellipsis)');
      if (n.l < pill.l - 0.5 || n.r > pill.r + 0.5 || n.t < pill.t - 0.5 || n.b > pill.b + 0.5) fails.push('a label at ' + where(n) + ' is outside its pill ' + where(pill));
    }
    if (quick.hasAttribute('data-rest')) {
      const dim = [quick, ...controls].map((e) => [e, effective(e)]).filter(([, o]) => o < 0.6);
      if (dim.length) fails.push('at rest the rows are at opacity ' + Math.round(dim[0][1] * 100) / 100 + ' (0.6 or more: quiet, never gone)');
    }
    const slot = document.querySelector('[data-slot="office-lights"]');
    if (slot && (slot.children.length > 0 || slot.textContent.trim() || getComputedStyle(slot).pointerEvents !== 'none')) fails.push('the office slot is not empty or takes the pointer');
    return { fails, mode };
  }
};

const rule = (variant, results, emit) => {
  const r = results.underclock;
  if (!r) return false;
  for (const f of r.fails) emit(`  FAIL under the clock: ${f}`);
  if (r.fails.length) return true;
  if (r.mode === 'next') emit('  ok   under the clock: Up next starts at y 382, shows one row and ends above y 457');
  else if (r.mode === 'menu') emit('  ok   under the clock: the open menu is inside the wall, right of the rail, text 16 px or more');
  else emit('  ok   under the clock: rows at y 272 and 330, pins 151 wide inside the wing, controls 40 to 48 px, text 16 px or more, labels inside their pills, present at rest, the office slot empty');
  return false;
};

const Q = '?hz=unwind&at=2026-11-11T10:24:00-08:00&long=1&agents=3&watch=mock&wlook=sky';
const V = {
  rest: 'Under the clock, Watch at rest, three pins',
  long: 'Under the clock, Watch, long labels',
  none: 'Under the clock, Watch, nothing pinned',
  shown: 'Under the clock, Watch shown, the first pin playing',
  listen: 'Under the clock, Listen, Spotify playing',
  menuLeft: 'Under the clock, the add menu from the second place',
  menuRight: 'Under the clock, the add menu from the third place',
};
const variants = [
  { name: V.rest, q: `${Q}&wlist=three&wpins=three&uccheck=rows`, checks: ['.u-quick', '.u-pins'] },
  { name: V.long, q: `${Q}&wlist=three&wpins=long&wrows=shown&uccheck=rows`, checks: ['.u-quick', '.u-pins'] },
  { name: V.none, q: `${Q}&wlist=three&wpins=none&uccheck=rows`, checks: ['.u-quick', '.u-pins'] },
  { name: V.shown, q: `${Q}&wlist=three&wpins=three&wplay=0&wrows=shown&uccheck=rows`, checks: ['.u-quick', '.u-pins'] },
  { name: V.listen, q: '?hz=unwind&at=2026-11-11T10:24:00-08:00&long=1&agents=3&audio=demo&watch=mock&wtab=listen&wpins=three&uccheck=next', checks: ['.u-quick', '.u-next'] },
  { name: V.menuLeft, q: `${Q}&wlist=three&wpins=one&wrows=shown&uccheck=menu`, click: '.u-pinslot:nth-child(2) .u-pin', checks: ['.u-pin-menu'] },
  { name: V.menuRight, q: `${Q}&wlist=three&wpins=one&wrows=shown&uccheck=menu`, click: '.u-pinslot:nth-child(3) .u-pin', checks: ['.u-pin-menu'] },
];

const on = (...names) => (v) => names.includes(v.name);

export default {
  name: 'under-clock',
  gallery: { states },
  fit: {
    variants,
    measurements: { underclock: measureUnderClock },
    rules: { underclock: rule },
    breaks: {
      'underclock-rows': { css: '.u-quick { top: 300px !important; }', expect: /^ *FAIL under the clock: row one is at y \d+/m, appliesTo: on(V.rest) },
      'underclock-pin-width': { css: '.u-pin { width: 200px !important; }', expect: /^ *FAIL under the clock: a pin is [\d.]+ px wide/m, appliesTo: on(V.rest) },
      'underclock-control-height': { css: '.u-sleep { height: 30px !important; }', expect: /^ *FAIL under the clock: a control is [\d.]+ px tall/m, appliesTo: on(V.rest) },
      'underclock-text': { css: '.u-pin-name { font-size: 13px !important; }', expect: /^ *FAIL under the clock: text under 16 px in the rows/m, appliesTo: on(V.rest) },
      'underclock-two-lines': { css: '.u-pin-name { -webkit-line-clamp: unset !important; display: block !important; }', expect: /^ *FAIL under the clock: a label is \d+ lines tall/m, appliesTo: on(V.long) },
      'underclock-rest': { css: '.u-quick[data-rest] { opacity: 0 !important; }', expect: /^ *FAIL under the clock: at rest the rows are at opacity/m, appliesTo: on(V.rest) },
      'underclock-next': { css: '.u-wing .u-next { top: 300px !important; }', expect: /^ *FAIL under the clock: Up next starts at y \d+/m, appliesTo: on(V.listen) },
      'underclock-slot': { css: '[data-slot="office-lights"] { pointer-events: auto !important; }', expect: /^ *FAIL under the clock: the office slot is not empty/m, appliesTo: on(V.rest) },
      'underclock-menu': { css: '.u-pin-menu { left: -200px !important; }', expect: /^ *FAIL under the clock: the open menu is at/m, appliesTo: on(V.menuLeft) },
    },
  },
};
