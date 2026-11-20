// The Home tab's Office mood cards: the brightness level bar on the active card (dimmer, a track with the floor drawn as a
// hatched zone, the live level, brighter). Every state comes from the `?office=`, `?officemood=`, `?officelevel=`,
// `?officenudge=`, `?desktoken=` and `?sonos=` knobs of the development mocks. The Condo cards never carry a bar.

const at = '2026-11-11T10:24:00-08:00';
const galleryQuery = (knobs) => `hz=home&at=${encodeURIComponent(at)}&clock=review&weather=ok&${knobs}`;
const fitQuery = (knobs) => `?hz=home&at=${at}&long=1&${knobs}`;

const BASE = 'keys2=both&studio=threelooks&desktoken=set&officeoff=none';
const lvl = (office, level, extra = '') => `${BASE}&office=${office}&officemood=relax&officelevel=${level}${extra}`;
const FOUR = lvl('desk', 62);
const PAGED = lvl('six', 62);
const TALL = lvl('desk', 62, '&sonos=off');
const FLOOR = lvl('six', 45);
const FULL = lvl('desk', 100);
const NOTOKEN = `${BASE.replace('desktoken=set', 'desktoken=unset')}&office=desk&officemood=relax&officelevel=62`;
const NOMOOD = `${BASE}&office=desk&officemood=none`;
const PICK = '[data-moods-which="office"]';
const CHECKS = ['.home .home-centre', '.home .moods', '.home .mood-row'];

/** Runs in the page (it references nothing outside its own body): the carded bar, its parts, and every card's size. */
function measureNudge() {
  const box = (e) => {
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
  };
  const bars = [...document.querySelectorAll('.home [data-nudge="bar"]')];
  const bar = bars[0] ?? null;
  const cell = bar ? bar.closest('.mood-cell') : null;
  const card = cell ? cell.querySelector('.mood-btn') : null;
  const small = [];
  if (bar) {
    for (const e of [bar, ...bar.querySelectorAll('*')]) {
      if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const px = parseFloat(getComputedStyle(e).fontSize);
      if (px < 15.99) small.push('"' + e.textContent.trim().slice(0, 12) + '" is ' + px + ' px');
    }
  }
  const lv = bar ? bar.querySelector('.nudge-lv') : null;
  const track = bar ? bar.querySelector('.nudge-track') : null;
  const tick = bar ? bar.querySelector('.nudge-tick') : null;
  const fz = bar ? bar.querySelector('.nudge-fz') : null;
  const name = card ? card.querySelector('.mood-name') : null;
  const tag = card ? card.querySelector('.mood-tag') : null;
  return {
    bars: bars.length,
    cells: document.querySelectorAll('.home .mood-cell').length,
    inCard: !!bar && !!card && !!cell && cell.contains(bar) && !card.contains(bar),
    card: box(card),
    bar: box(bar),
    down: box(bar?.querySelector('[data-nudge-dir="down"]')),
    up: box(bar?.querySelector('[data-nudge-dir="up"]')),
    track: box(track),
    tick: box(tick),
    fz: box(fz),
    lv: box(lv),
    lvText: lv ? lv.textContent.trim() : null,
    lvCut: !!lv && lv.scrollWidth > lv.clientWidth + 1,
    name: box(name),
    tag: box(tag),
    sub: card ? !!card.querySelector('.mood-sub') : false,
    downDisabled: bar?.querySelector('[data-nudge-dir="down"]')?.getAttribute('aria-disabled') === 'true',
    upDisabled: bar?.querySelector('[data-nudge-dir="up"]')?.getAttribute('aria-disabled') === 'true',
    dashed: !!bar && [...bar.querySelectorAll('.nudge-btn')].every((b) => getComputedStyle(b).borderStyle === 'dashed'),
    row: box(document.querySelector('.home .mood-row')),
    small,
  };
}

const r1 = (n) => Math.round(n * 10) / 10;
const V_FOUR = 'Home nudge, four cards';
const V_PAGED = 'Home nudge, a More card';
const V_TALL = 'Home nudge, tall layout';
const V_FLOOR = 'Home nudge, at the floor';
const V_FULL = 'Home nudge, at full';
const V_NOTOKEN = 'Home nudge, no desk token';
const V_NOMOOD = 'Home nudge, no mood on';
const variant = (name, knobs) => ({ name, q: fitQuery(knobs), checks: CHECKS, click: PICK });
const state = (name, knobs, expect, actions) => ({ screen: 'home', name, query: galleryQuery(knobs), custom: true, expect, actions: actions ? `${PICK} >> ${actions}` : PICK });

function rule(v, results, emit) {
  if (!v.name.startsWith('Home nudge')) return false;
  const m = results.nudge;
  const fails = [];
  if (v.name === V_NOMOOD) {
    if (m.bars !== 0) fails.push('home nudge: a bar is drawn with no mood on');
  } else if (m.bars !== 1) fails.push('home nudge: ' + m.bars + ' bars on the page (exactly 1, on the active card)');
  else {
    const c = m.card;
    const b = m.bar;
    if (!m.inCard) fails.push('home nudge: the bar is not a sibling of its card button in the same cell');
    if (b.l < c.l + 7.5 || b.r > c.r - 7.5 || b.b > c.b - 5.5 || b.t < c.t) fails.push('home nudge: the bar (x ' + r1(b.l) + ' to ' + r1(b.r) + ', y ' + r1(b.t) + ' to ' + r1(b.b) + ') is not inside its card with 8 px beside and 6 below');
    for (const [name, k] of [['dimmer', m.down], ['brighter', m.up]]) {
      if (k.w < 39.5 || k.h < 39.5) fails.push('home nudge: the ' + name + ' button is ' + r1(k.w) + ' x ' + r1(k.h) + ' px (40 x 40 at least)');
    }
    if (m.track.w < 60) fails.push('home nudge: the track is ' + r1(m.track.w) + ' px wide (60 at least)');
    if (m.down.r > m.track.l + 0.5 || m.track.r > m.lv.l + 0.5 || m.lv.r > m.up.l + 0.5) fails.push('home nudge: the dimmer, track, level and brighter overlap or are out of order');
    if (m.lvCut) fails.push('home nudge: the level "' + m.lvText + '" is cut');
    if (m.name && m.name.b > b.t + 0.5) fails.push('home nudge: the card name (to y ' + r1(m.name.b) + ') overlaps the bar (from y ' + r1(b.t) + ')');
    if (m.tag && m.name && m.tag.b > m.name.t + 0.5) fails.push('home nudge: the On now tag overlaps the card name');
    if (m.sub) fails.push('home nudge: the preset line still shows on the card with the level bar');
    const floorAt = m.track.l + m.track.w * 0.45;
    if (Math.abs(m.tick.l + m.tick.w / 2 - floorAt) > 3) fails.push('home nudge: the floor mark is at x ' + r1(m.tick.l + m.tick.w / 2) + ', the 45% point of the track is x ' + r1(floorAt));
    if (Math.abs(m.fz.w - m.track.w * 0.45) > 2) fails.push('home nudge: the hatched floor zone is ' + r1(m.fz.w) + ' px wide, 45% of the track is ' + r1(m.track.w * 0.45));
    if (v.name === V_FOUR || v.name === V_TALL) {
      if (Math.abs(c.w - 312) > 1.5) fails.push('home nudge: the card is ' + r1(c.w) + ' px wide (312)');
    }
    if (v.name === V_PAGED && Math.abs(c.w - 278) > 2) fails.push('home nudge: the paged card is ' + r1(c.w) + ' px wide (about 278)');
    const wantH = v.name === V_TALL ? 300 : 150;
    if (Math.abs(c.h - wantH) > 1.5) fails.push('home nudge: the card is ' + r1(c.h) + ' px tall (' + wantH + ')');
    if (v.name === V_FLOOR && (m.lvText !== 'Floor' || !m.downDisabled || m.upDisabled)) fails.push('home nudge: at the floor the word is "' + m.lvText + '" and dimmer disabled is ' + m.downDisabled + ' (Floor, disabled; brighter live)');
    if (v.name === V_FULL && (m.lvText !== 'Max' || !m.upDisabled || m.downDisabled)) fails.push('home nudge: at full the word is "' + m.lvText + '" and brighter disabled is ' + m.upDisabled + ' (Max, disabled; dimmer live)');
    if (v.name === V_FOUR && (m.lvText !== '62%' || m.downDisabled || m.upDisabled)) fails.push('home nudge: the normal state reads "' + m.lvText + '" with a disabled button (62%, both live)');
    if (v.name === V_NOTOKEN && (!m.dashed || !m.downDisabled || !m.upDisabled)) fails.push('home nudge: with no desk token both buttons must be dashed and disabled');
  }
  if (m.small) for (const x of m.small) fails.push('home nudge: text under 16 px: ' + x);
  for (const f of fails) emit('  FAIL ' + f);
  if (fails.length) return true;
  emit('  ok   home nudge: one bar inside the active card, buttons 40 px, track 60 px or more, floor zone at 45%, name clear of the bar, card sizes held, text 16 px or more');
  return false;
}

const on = (...names) => (v) => names.includes(v.name);

export default {
  name: 'home-moods-nudge',
  gallery: {
    states: [
      state('home nudge: normal', FOUR, ['Relax', '62%', 'On now']),
      state('home nudge: a More card', PAGED, ['Relax', '62%', 'On now']),
      state('home nudge: tall layout', TALL, ['Relax', '62%']),
      state('home nudge: at the floor', FLOOR, ['Floor', 'On now']),
      state('home nudge: a hovered floor dimmer', FLOOR, ['Floor 45%: dimmer stops here so the room stays bright enough to work'], 'hover:[data-nudge-dir="down"]'),
      state('home nudge: at full', FULL, ['Max', 'On now']),
      state('home nudge: no desk token', NOTOKEN, ['62%', 'Office moods are view only here. To switch them, add the desk token in Tools.']),
      state('home nudge: no mood on', NOMOOD, ['Relax', 'Gaming', '!62%']),
      state('home nudge: a press', FOUR, ['72%'], '[data-nudge-dir="up"]'),
    ],
  },
  fit: {
    variants: [
      variant(V_FOUR, FOUR),
      variant(V_PAGED, PAGED),
      variant(V_TALL, TALL),
      variant(V_FLOOR, FLOOR),
      variant(V_FULL, FULL),
      variant(V_NOTOKEN, NOTOKEN),
      variant(V_NOMOOD, NOMOOD),
    ],
    measurements: { nudge: measureNudge },
    rules: { nudge: rule },
    breaks: {
      'nudge-low': { css: '.mood-nudge { bottom: -24px !important; }', expect: /^ *FAIL home nudge: the bar .* is not inside its card/m, appliesTo: on(V_FOUR) },
      'nudge-small': { css: '.nudge-btn { width: 30px !important; height: 30px !important; }', expect: /^ *FAIL home nudge: the (dimmer|brighter) button is /m, appliesTo: on(V_FOUR) },
      'nudge-track': { css: '.nudge-track { flex: none !important; width: 20px !important; }', expect: /^ *FAIL home nudge: the track is /m, appliesTo: on(V_FOUR) },
      'nudge-text': { css: '.nudge-lv { font-size: 12px !important; }', expect: /^ *FAIL home nudge: text under 16 px/m, appliesTo: on(V_FOUR) },
      'nudge-name': { css: '.mood-btn.nudged .mood-lb { padding-bottom: 2px !important; }', expect: /^ *FAIL home nudge: the card name .* overlaps the bar/m, appliesTo: on(V_FOUR) },
      'nudge-tick': { css: '.nudge-tick { left: 10% !important; }', expect: /^ *FAIL home nudge: the floor mark is at x /m, appliesTo: on(V_FOUR) },
      'nudge-sub': { css: '.nudge-fz { width: 20% !important; }', expect: /^ *FAIL home nudge: the hatched floor zone is /m, appliesTo: on(V_FOUR) },
      'nudge-dash': { css: '.nudge-btn.off { border-style: solid !important; }', expect: /^ *FAIL home nudge: with no desk token both buttons must be dashed/m, appliesTo: on(V_NOTOKEN) },
    },
  },
};
