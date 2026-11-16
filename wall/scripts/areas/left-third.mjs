// Home's left third under the clock and the date: the headline, the day as a low curve, the weather row and the house row.
// Gallery states (morning, late afternoon and night, each with the house line live, absent and not live; no weather reading),
// fit variants, one browser measurement with its rules, and the deliberate breaks. Nothing is registered in the two big
// review scripts for it.

const day = (iso) => encodeURIComponent(iso);
const MORNING = '2026-11-14T10:28:00-08:00';
const LATE = '2026-11-14T15:40:00-08:00';
const NIGHT = '2026-11-14T21:10:00-08:00';
const WINTER = '2026-12-21T12:00:00-08:00';
const SUMMER = '2026-06-21T12:00:00-07:00';

const galleryQuery = (when, knobs) => `hz=home&at=${day(when)}&clock=review&weather=ok&net=calm${knobs ? `&${knobs}` : ''}`;
const fitQuery = (when, knobs) => `?hz=home&at=${when}&clock=review&weather=ok&net=calm&leftcheck=1${knobs ? `&${knobs}` : ''}`;
const state = (name, when, knobs, expect) => ({ screen: 'home', name: `left third: ${name}`, query: galleryQuery(when, knobs), custom: true, expect });

/**
 * Runs in the page (it references nothing outside its own body). Boxes are in wall pixels (the stage is scaled to the window).
 * Reports only when the URL asks (`leftcheck`): the wing's children, the curve and its labels, the clock, the date, the
 * centre column, and the smallest text in the wing.
 */
function measureLeftThird() {
  if (!new URLSearchParams(location.search).get('leftcheck')) return null;
  const stage = document.querySelector('.stage');
  const sr = stage ? stage.getBoundingClientRect() : { left: 0, top: 0, width: 2560 };
  const k = sr.width / 2560;
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: (r.left - sr.left) / k, y: (r.top - sr.top) / k, r: (r.right - sr.left) / k, b: (r.bottom - sr.top) / k };
  };
  const wing = document.querySelector('.home .home-wing');
  const parts = wing ? [...wing.querySelectorAll(':scope > *')].map((el) => ({ name: el.className.split(' ')[0], ...box(el) })) : [];
  const text = [];
  if (wing) {
    for (const e of wing.querySelectorAll('*')) {
      if ([...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
        text.push({ name: (e.className && e.className.baseVal === undefined ? e.className : e.tagName).toString().split(' ')[0], px: parseFloat(getComputedStyle(e).fontSize) });
      }
    }
  }
  const curve = document.querySelector('.home .lw-curve');
  const rise = document.querySelector('.home .lw-label.rise');
  const set = document.querySelector('.home .lw-label.set');
  // The two soft dots where the line crosses the horizon (a dot's box is its crossing).
  const ticks = curve ? [...curve.querySelectorAll('svg > circle.lw-cross')].map((l) => box(l)) : [];
  const rects = (sel) => [...document.querySelectorAll(sel)].map((e) => box(e));
  return {
    wing: box(wing),
    parts,
    text,
    curve: box(curve),
    rise: box(rise),
    set: box(set),
    ticks,
    clock: box(document.querySelector('.clk')),
    date: box(document.querySelector('.clk-date')),
    centre: box(document.querySelector('.home .home-centre')),
    right: box(document.querySelector('.home .home-right')),
    cards: rects('.home .home-centre > *'),
    dots: rects('.home .house-room'),
    roomsBox: box(document.querySelector('.home .house-rooms')),
    house: box(document.querySelector('.home .house')),
    outside: box(document.querySelector('.home .outside')),
    weatherText: document.querySelector('.home .outside')?.textContent ?? null,
    // The outside glyph: its tone class and the icon's own name (warm for sun, night for moon).
    glyphTone: (document.querySelector('.home .outside .lw-glyph')?.className ?? '').replace('lw-glyph', '').trim(),
    glyphIcon: (document.querySelector('.home .outside .lw-glyph svg')?.getAttribute('class') ?? '').replace('tabler-icon ', ''),
    more: !!document.querySelector('.home .house-room.more'),
    dotCount: [...document.querySelectorAll('.home .house-room:not(.more)')].filter((e) => getComputedStyle(e).display !== 'none').length,
    asOfShown: (() => { const a = document.querySelector('.home .house-asof'); return !!a && getComputedStyle(a).visibility !== 'hidden'; })(),
    // Inside each row (and the dots row) the children, left to right: none may overlap the next.
    lines: [...document.querySelectorAll('.home .home-wing .lw-row, .home .home-wing .house-rooms')].map((row) => ({ row: box(row), kids: [...row.children].filter((c) => getComputedStyle(c).visibility !== 'hidden').map((c) => ({ name: (c.className || c.tagName).toString().split(' ')[0], ...box(c) })).filter((c) => c.r - c.x > 0) })),
  };
}

const VARIANT_HOUSE = 'Home, left third: morning, house live';
const VARIANT_LATE = 'Home, left third: late afternoon, house live';
const VARIANT_NIGHT = 'Home, left third: night, house live';
const VARIANT_ABSENT = 'Home, left third: morning, house line absent';
const VARIANT_STALE = 'Home, left third: morning, house not live';
const VARIANT_STALE2 = 'Home, left third: morning, house not live, two rooms';
const VARIANT_NOWX = 'Home, left third: morning, no weather reading';
const VARIANT_ROOMS = 'Home, left third: morning, eight rooms';
const VARIANT_ONE = 'Home, left third: morning, one room';
const VARIANT_SEVEN = 'Home, left third: morning, seven lit rooms';
const VARIANT_TWELVE = 'Home, left third: morning, twelve rooms';
const VARIANT_NONE = 'Home, left third: morning, no rooms';
const VARIANT_WINTER = 'Home, left third: short winter day, house live';
const VARIANT_SUMMER = 'Home, left third: long summer day, house live';
const CHECKS = ['.home .home-wing', '.home .lw-head', '.home .lw-curve', '.home .outside', '.home .house'];
const NO_HOUSE = CHECKS.filter((c) => c !== '.home .house');
const variant = (name, when, knobs) => ({ name, q: fitQuery(when, knobs), checks: knobs.includes('desk=') ? CHECKS : NO_HOUSE });
const NAMES = new Set([VARIANT_HOUSE, VARIANT_LATE, VARIANT_NIGHT, VARIANT_ABSENT, VARIANT_STALE, VARIANT_STALE2, VARIANT_NOWX, VARIANT_ROOMS, VARIANT_ONE, VARIANT_SEVEN, VARIANT_TWELVE, VARIANT_NONE, VARIANT_WINTER, VARIANT_SUMMER]);
const WITH_HOUSE = new Set([VARIANT_HOUSE, VARIANT_LATE, VARIANT_NIGHT, VARIANT_STALE, VARIANT_STALE2, VARIANT_ROOMS, VARIANT_ONE, VARIANT_SEVEN, VARIANT_TWELVE, VARIANT_NONE, VARIANT_WINTER, VARIANT_SUMMER]);
const START_Y = 200;
const END_Y = 470;

function ruleLeftThird(variantEntry, results, emit) {
  if (!NAMES.has(variantEntry.name)) return false;
  const m = results.leftThird;
  const fails = [];
  if (!m || !m.wing || m.parts.length === 0) {
    emit('  FAIL left third: the wing did not render');
    return true;
  }
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const hit = (a, b) => a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5;
  const kids = m.parts.filter((p) => p.r - p.x > 0 && p.b - p.y > 0);
  // The block starts 23 px under the date (y 200) and ends above y 470 (the room dots take up to two lines; the strip under them is kept for the Next line).
  const first = Math.min(...kids.map((p) => p.y));
  const last = Math.max(...kids.map((p) => p.b));
  if (!near(first, START_Y, 1.5)) fails.push(`left third: starts at y ${first.toFixed(1)}, not ${START_Y}`);
  if (last > END_Y + 0.5) fails.push(`left third: ends at y ${last.toFixed(1)}, below ${END_Y}`);
  if (m.date && first < m.date.b + 20) fails.push(`left third: starts ${(first - m.date.b).toFixed(1)} px under the date (20 or more)`);
  // The room dots stay in their box, in at most two lines, each dot clear of the next.
  const dotBoxes = m.dots.filter((d) => d.r - d.x > 0 && d.b - d.y > 0);
  if (m.roomsBox) {
    const out = dotBoxes.filter((d) => d.x < m.roomsBox.x - 0.5 || d.r > m.roomsBox.r + 0.5 || d.b > m.roomsBox.b + 0.5 || d.y < m.roomsBox.y - 0.5);
    if (out.length) fails.push(`left third: ${out.length} room dot(s) leave their box (the box is x ${m.roomsBox.x.toFixed(1)} to ${m.roomsBox.r.toFixed(1)}, y ${m.roomsBox.y.toFixed(1)} to ${m.roomsBox.b.toFixed(1)})`);
    const tops = [...new Set(dotBoxes.map((d) => Math.round(d.y)))];
    if (tops.length > 2) fails.push(`left third: the room dots take ${tops.length} lines (two at most)`);
    for (let i = 0; i < dotBoxes.length; i++) for (let j = i + 1; j < dotBoxes.length; j++) {
      const a = dotBoxes[i], b = dotBoxes[j];
      if (a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5) fails.push('left third: two room dots overlap');
    }
    // "+N more" only when both lines are full: another dot would not have fitted after the last one on the second line.
    if (m.more && tops.length < 2) fails.push('left third: "+N more" shows with the second line empty');
  }
  // Nothing overlaps the clock, the date, or the card to its right.
  const centre = m.centre;
  const inside = (b) => b.r - b.x > 0 && b.b - b.y > 0;
  const extents = [...kids, ...m.dots.filter(inside).map((d, i) => ({ name: `room dot ${i + 1}`, ...d }))];
  for (const p of extents) {
    if (m.clock && hit(p, m.clock)) fails.push(`left third: ${p.name} overlaps the clock`);
    if (m.date && hit(p, m.date)) fails.push(`left third: ${p.name} overlaps the date`);
    if (centre && p.r > centre.x - 8 + 0.5) fails.push(`left third: ${p.name} reaches x ${p.r.toFixed(1)}, within 8 px of the card to its right (starts at ${centre.x.toFixed(1)})`);
    for (const c of m.cards) if (inside(c) && hit(p, c)) fails.push(`left third: ${p.name} overlaps the card to its right`);
  }
  // Text 16 px or more.
  const small = m.text.filter((t) => t.px < 16 - 0.01);
  if (small.length) fails.push(`left third: text under 16 px in ${small.map((t) => `${t.name} (${t.px} px)`).join(', ')}`);
  // The labels never collide with each other, stay inside the curve's box, and sit on the right side of their crossing.
  if (m.curve) {
    const [tr, ts] = m.ticks;
    if (m.rise && m.set) {
      if (hit(m.rise, m.set)) fails.push('left third: the sunrise and sunset labels collide');
      if (m.rise.x < m.curve.x - 0.5 || m.set.r > m.curve.r + 0.5) fails.push(`left third: a label leaves the curve's box (sunrise starts at ${m.rise.x.toFixed(1)}, sunset ends at ${m.set.r.toFixed(1)}, box ${m.curve.x.toFixed(1)} to ${m.curve.r.toFixed(1)})`);
      if (tr && m.rise.r > tr.x + 0.5 && m.rise.x < tr.r) fails.push('left third: the sunrise label covers its own crossing');
      if (ts && m.set.x < ts.r - 0.5 && m.set.r > ts.x) fails.push('left third: the sunset label covers its own crossing');
    } else {
      fails.push('left third: the curve is missing a label');
    }
  } else {
    fails.push('left third: the curve is not drawn');
  }
  // Inside a row, one part never runs into the next (the line into "as of", the sentence into the high and low).
  for (const { row, kids: line } of m.lines ?? []) {
    for (let i = 1; i < line.length; i++) {
      if (Math.abs(line[i].y - line[i - 1].y) < 2 && line[i].x < line[i - 1].r - 0.5) fails.push(`left third: ${line[i - 1].name} runs into ${line[i].name} (ends at x ${line[i - 1].r.toFixed(1)}, the next starts at ${line[i].x.toFixed(1)})`);
    }
    for (const c of line) if (c.r > row.r + 0.5) fails.push(`left third: ${c.name} leaves its row (ends at x ${c.r.toFixed(1)}, the row at ${row.r.toFixed(1)})`);
  }
  // The rows after the curve keep their order and do not overlap each other.
  const rowsAfter = kids.filter((p) => p.name === 'lw-row' || p.name === 'lw-house');
  for (let i = 1; i < rowsAfter.length; i++) if (rowsAfter[i].y < rowsAfter[i - 1].b - 0.5) fails.push('left third: two rows overlap');
  if (WITH_HOUSE.has(variantEntry.name) && !m.house) fails.push('left third: the house row is not showing');
  // Not live: every dot that fits stays (four rooms are four dots, no "+N more"); "as of" shows only where there is room.
  if (variantEntry.name === VARIANT_STALE && (m.dotCount !== 4 || m.more)) fails.push(`left third: not live with four rooms shows ${m.dotCount} dots${m.more ? ' and a "+N more" chip' : ''} (all four expected)`);
  if (variantEntry.name === VARIANT_STALE2 && !m.asOfShown) fails.push('left third: not live with two rooms does not show "as of" at the right end of the dots row');
  // The weather glyph follows the hour: a sun-cloud by day, a moon-cloud at night.
  if ((variantEntry.name === VARIANT_HOUSE || variantEntry.name === VARIANT_LATE) && !(m.glyphTone === 'warm' && !/moon/.test(m.glyphIcon))) fails.push(`left third: by day the weather glyph is "${m.glyphIcon}" in tone "${m.glyphTone}" (a warm sun glyph expected)`);
  if (variantEntry.name === VARIANT_NIGHT && !(m.glyphTone === 'night' && /moon/.test(m.glyphIcon))) fails.push(`left third: at night the weather glyph is "${m.glyphIcon}" in tone "${m.glyphTone}" (a night moon glyph expected)`);
  if (variantEntry.name === VARIANT_ABSENT && m.house) fails.push('left third: the house row shows while the home app is absent');
  if (variantEntry.name === VARIANT_NOWX && !/weather unavailable/.test(m.weatherText ?? '')) fails.push('left third: with no weather reading the row does not say so');
  for (const f of fails) emit(`  FAIL ${f}`);
  if (fails.length) return true;
  emit(`  ok   left third: starts at y 200, ends at y ${last.toFixed(0)} (above 470), clear of the clock, the date and the card to its right, text 16 px or more, the labels apart and inside the curve`);
  return false;
}

const only = (...names) => (v) => names.includes(v.name);

export default {
  name: 'left-third',
  gallery: {
    states: [
      state('morning, house live', MORNING, 'desk=typical', ['of daylight left', 'outside', '68° inside.']),
      state('morning, house line absent', MORNING, '', ['of daylight left', 'outside', '!inside.']),
      state('morning, house not live', MORNING, 'desk=stale', ['of daylight left', '68° inside.', 'Office', 'Bedroom']),
      state('morning, house not live, two rooms', MORNING, 'desk=stale&rooms=2', ['of daylight left', '68° inside.', 'as of']),
      state('late afternoon, house live', LATE, 'desk=typical', ['Sunset in', 'outside', '68° inside.']),
      state('late afternoon, house line absent', LATE, '', ['Sunset in', 'outside', '!inside.']),
      state('late afternoon, house not live', LATE, 'desk=stale', ['Sunset in', '68° inside.', 'Bedroom']),
      state('night, house live', NIGHT, 'desk=typical', ['tomorrow', 'outside', '68° inside.']),
      state('night, house line absent', NIGHT, '', ['tomorrow', 'outside', '!inside.']),
      state('night, house not live', NIGHT, 'desk=stale', ['tomorrow', '68° inside.', 'Bedroom']),
      state('morning, no weather reading', MORNING, 'desk=typical&weather=down', ['of daylight left', 'weather unavailable', '68° inside.']),
      state('morning, eight rooms', MORNING, 'desk=typical&rooms=8', ['68° inside.', 'Office']),
      state('morning, one room', MORNING, 'desk=typical&rooms=1', ['68° inside.', 'Office', '!Living room']),
      state('morning, seven lit rooms, two lines', MORNING, 'desk=typical&rooms=7', ['68° inside.', 'Office', 'Den']),
      state('morning, twelve rooms, two lines and a count', MORNING, 'desk=typical&rooms=12', ['68° inside.', 'Office', 'more']),
      state('morning, no rooms', MORNING, 'desk=typical&rooms=0', ['68° inside.', '!Guest room']),
    ].map((s) => (s.query.includes('weather=down') ? { ...s, query: s.query.replace('weather=ok&', '') } : s)),
  },
  fit: {
    variants: [
      variant(VARIANT_HOUSE, MORNING, 'desk=typical'),
      variant(VARIANT_LATE, LATE, 'desk=typical'),
      variant(VARIANT_NIGHT, NIGHT, 'desk=typical'),
      variant(VARIANT_ABSENT, MORNING, ''),
      variant(VARIANT_STALE, MORNING, 'desk=stale'),
      variant(VARIANT_STALE2, MORNING, 'desk=stale&rooms=2'),
      { ...variant(VARIANT_NOWX, MORNING, 'desk=typical&weather=down'), q: fitQuery(MORNING, 'desk=typical').replace('weather=ok&', '') + '&weather=down' },
      variant(VARIANT_ROOMS, MORNING, 'desk=typical&rooms=8'),
      variant(VARIANT_ONE, MORNING, 'desk=typical&rooms=1'),
      variant(VARIANT_SEVEN, MORNING, 'desk=typical&rooms=7'),
      variant(VARIANT_TWELVE, MORNING, 'desk=typical&rooms=12'),
      variant(VARIANT_NONE, MORNING, 'desk=typical&rooms=0'),
      variant(VARIANT_WINTER, WINTER, 'desk=typical'),
      variant(VARIANT_SUMMER, SUMMER, 'desk=typical'),
    ],
    measurements: { leftThird: measureLeftThird },
    rules: { leftThird: ruleLeftThird },
    breaks: {
      // The block pushed down: starts below y 200, and with the house row ends below y 470.
      'left-start': { css: '.home-wing { padding-top: 240px !important; }', expect: /^ *FAIL left third: starts at y [\d.]+, not 200/m, appliesTo: only(VARIANT_HOUSE) },
      'left-end': { css: '.lw-row { margin-bottom: 40px !important; }', expect: /^ *FAIL left third: ends at y [\d.]+, below 470/m, appliesTo: only(VARIANT_HOUSE) },
      // The headline lifted into the date.
      'left-date': { css: '.home-wing .lw-head { position: relative !important; top: -60px !important; }', expect: /^ *FAIL left third: .* overlaps the date/m, appliesTo: only(VARIANT_HOUSE) },
      // A row stretched across the gap into the card to its right.
      'left-card': { css: '.lw-row.outside { width: 700px !important; }', expect: /^ *FAIL left third: lw-row reaches x [\d.]+, within 8 px of the card to its right/m, appliesTo: only(VARIANT_HOUSE) },
      // The weather sentence set too large: it pushes the high and low out of the row.
      'left-run': { css: '.lw-text { font-size: 34px !important; }', expect: /^ *FAIL left third: lw-side leaves its row/m, appliesTo: only(VARIANT_HOUSE) },
      // Dots lost to make room for "as of": two of the four rooms vanish.
      'left-dots': { css: '.house-rooms .house-room:nth-child(n+3):not(.more) { display: none !important; }', expect: /^ *FAIL left third: not live with four rooms shows/m, appliesTo: only(VARIANT_STALE) },
      // A room dot pushed out of its box: the row narrowed so twelve rooms need a third line, with the box no longer clipping it.
      'left-room-box': { css: '.house-rooms { width: 200px !important; max-height: none !important; overflow: visible !important; }', expect: /^ *FAIL left third: the room dots take \d+ lines|^ *FAIL left third: \d+ room dot\(s\) leave their box/m, appliesTo: only(VARIANT_TWELVE) },
      'left-text': { css: '.lw-label, .lw-side { font-size: 12px !important; }', expect: /^ *FAIL left third: text under 16 px in /m, appliesTo: only(VARIANT_HOUSE) },
      // Both labels dragged to the middle of a long day, then the sunset label to the box's left edge.
      'left-labels': { css: '.lw-label.set { right: auto !important; left: 0 !important; }', expect: /^ *FAIL left third: the sunrise and sunset labels collide|^ *FAIL left third: the sunset label covers its own crossing/m, appliesTo: only(VARIANT_SUMMER) },
      // "as of" hidden although the two rooms leave it room; the wrong glyph for the hour (`wday` is a dev knob that forces the current reading's day or night).
      'left-asof': { css: '.house-asof { visibility: hidden !important; }', expect: /^ *FAIL left third: not live with two rooms does not show "as of"/m, appliesTo: only(VARIANT_STALE2) },
      'left-glyph-day': { query: '&wday=0', expect: /^ *FAIL left third: by day the weather glyph is /m, appliesTo: only(VARIANT_HOUSE) },
      'left-glyph-night': { query: '&wday=1', expect: /^ *FAIL left third: at night the weather glyph is /m, appliesTo: only(VARIANT_NIGHT) },
      'left-crossing': { css: '.lw-label.rise { right: auto !important; left: 100px !important; }', expect: /^ *FAIL left third: the sunrise label covers its own crossing/m, appliesTo: only(VARIANT_HOUSE) },
    },
  },
};
