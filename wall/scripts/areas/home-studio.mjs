// The Home tab's studio lights: the short Now playing line, the block under it (Key lights and Panels switches, Fine tune,
// three panel looks, Gaming, Office Recording and As before) and the Condo / Office pick in the Moods heading. Every state
// comes from the `?studio=`, `?office=`, `?officemood=`, `?desktoken=` and `?keys2=` knobs of the development mocks.

const at = '2026-11-11T10:24:00-08:00';
const galleryQuery = (knobs) => `hz=home&at=${encodeURIComponent(at)}&clock=review&weather=ok&${knobs}`;
const fitQuery = (knobs) => `?hz=home&at=${at}&long=1&${knobs}`;

const READY = 'keys2=both&studio=threelooks&desktoken=set&office=desk&officeoff=none';
const ABSENT = 'keys2=both&office=absent';
const CHECKS = ['.home .home-centre', '.home .moods', '.home .mood-row', '.home .sound', '.home .sound-panel', '.home .np-col', '.home .hs-block'];

/** Runs in the page: the Sound card's left column, the block's rows and chips, the Moods heading and its cards. */
function measureHomeStudio() {
  const q = (s) => document.querySelector(s);
  const box = (e) => {
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height };
  };
  const col = q('.home .np-col');
  const block = q('.home .hs-block');
  const panel = q('.home .sound-panel');
  const small = [];
  const cut = [];
  const scan = (root, label) => {
    if (!root) return;
    for (const e of [root, ...root.querySelectorAll('*')]) {
      if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const px = parseFloat(cs.fontSize);
      if (px < 15.99) small.push(label + ': "' + e.textContent.trim().slice(0, 24) + '" is ' + px + ' px');
      if (e.scrollWidth > e.clientWidth + 1 && cs.overflow !== 'visible' && cs.textOverflow !== 'ellipsis') cut.push(label + ': "' + e.textContent.trim().slice(0, 24) + '"');
    }
  };
  scan(col, 'left column');
  scan(q('.home .moods-head'), 'Moods heading');
  const rowOf = (name) => box(q('.home .hs-block [data-row="' + name + '"]'));
  const seen = (e) => e.getBoundingClientRect().width > 0;
  const chips = (sel) => [...document.querySelectorAll(sel)].filter(seen).map((e) => ({ name: e.textContent.trim() || e.getAttribute('aria-label') || e.dataset.group || '', ...box(e), disabled: e.getAttribute('aria-disabled') === 'true' || e.classList.contains('dis') }));
  const heading = q('.home .moods-head');
  const cardsRow = q('.home .mood-row');
  return {
    col: box(col),
    panel: box(panel),
    block: box(block),
    line: box(q('.home .sound-np')),
    cover: box(q('.home .sound-np .np-cover, .home .sound-np .np-slot, .home .sound-np .np-tile')),
    transport: [...document.querySelectorAll('.home .sound-np .np-rd')].map(box),
    switches: rowOf('switches'),
    looks: rowOf('looks'),
    moodsRow: rowOf('moods'),
    switchTiles: chips('.home .hs-block [data-row="switches"] .st-tg, .home .hs-block [data-row="switches"] [data-st-opener]'),
    lookChips: chips('.home .hs-block [data-row="looks"] .st-preset'),
    moodChips: chips('.home .hs-block [data-row="moods"] .u-mood'),
    pick: [...document.querySelectorAll('.home .moods-pick')].map((e) => ({ name: e.textContent.trim(), on: e.getAttribute('aria-pressed') === 'true', ...box(e) })),
    heading: box(heading),
    cardNames: [...document.querySelectorAll('.home .mood-row .mood-name')].filter(seen).map((e) => e.textContent.trim()),
    cards: box(cardsRow),
    small,
    cut,
  };
}

const r1 = (n) => Math.round(n * 10) / 10;
const V_READY = 'Home studio, ready';
const V_ABSENT = 'Home studio, home app not answering';
const V_ONE = 'Home studio, on one mood';
const V_CONDO = 'Home studio, Moods heading on Condo';
const V_OFFICE = 'Home studio, Moods heading on Office';
const variant = (name, knobs, extra = {}) => ({ name, q: fitQuery(knobs), checks: CHECKS, ...extra });
const state = (name, knobs, expect, actions) => ({ screen: 'home', name, query: galleryQuery(knobs), custom: true, expect, actions });

function rule(v, results, emit) {
  if (!v.name.startsWith('Home studio')) return false;
  const m = results.homestudio;
  const fails = [];
  if (!m.col || !m.block) fails.push('home studio: the left column or the block is not on the page');
  else {
    if (m.block.b > m.col.b + 0.5 || m.block.r > m.col.r + 0.5) fails.push('home studio: the block (to y ' + r1(m.block.b) + ', x ' + r1(m.block.r) + ') leaves the left column (to y ' + r1(m.col.b) + ', x ' + r1(m.col.r) + ')');
    if (m.panel && m.block.b > m.panel.b - 8) fails.push('home studio: the block ends at y ' + r1(m.block.b) + ', under the Sound card edge at y ' + r1(m.panel.b) + ' (8 px of padding)');
    if (!m.line || Math.abs(m.line.h - 64) > 1) fails.push('home studio: the Now playing line is ' + (m.line ? r1(m.line.h) : 'missing') + ' px tall (64)');
    if (!m.cover || Math.abs(m.cover.w - 64) > 1 || Math.abs(m.cover.h - 64) > 1) fails.push('home studio: the cover is ' + (m.cover ? r1(m.cover.w) + ' x ' + r1(m.cover.h) : 'missing') + ' (64 x 64)');
    for (const t of m.transport) if (Math.abs(t.w - 38) > 1 || Math.abs(t.h - 38) > 1) fails.push('home studio: a transport button is ' + r1(t.w) + ' x ' + r1(t.h) + ' px (38 x 38)');
    for (const [name, row] of [['switches', m.switches], ['looks', m.looks], ['moods', m.moodsRow]]) {
      if (!row) continue;
      if (row.l < m.block.l - 0.5 || row.r > m.block.r + 0.5) fails.push('home studio: the ' + name + ' row leaves the block');
    }
    const order = m.moodChips.map((c) => c.name);
    if (order.join('|') !== 'Gaming|Office Recording|As before') fails.push('home studio: the three buttons read "' + order.join('", "') + '" (Gaming, Office Recording, As before)');
    for (const c of m.moodChips) {
      if (Math.abs(c.h - 34) > 1) fails.push('home studio: button "' + c.name + '" is ' + r1(c.h) + ' px tall (34, as on the Office moods row)');
      if (c.r > m.block.r + 0.5) fails.push('home studio: button "' + c.name + '" ends at x ' + r1(c.r) + ', past the block (' + r1(m.block.r) + ')');
    }
    for (let i = 1; i < m.moodChips.length; i++) if (m.moodChips[i].l < m.moodChips[i - 1].r - 0.5) fails.push('home studio: buttons "' + m.moodChips[i - 1].name + '" and "' + m.moodChips[i].name + '" overlap');
    for (const c of [...m.switchTiles, ...m.lookChips]) if (c.r > m.block.r + 0.5) fails.push('home studio: "' + c.name + '" ends at x ' + r1(c.r) + ', past the block (' + r1(m.block.r) + ')');
    if (v.name === V_READY || v.name === V_ONE) {
      if (m.switchTiles.length < 3) fails.push('home studio: Key lights, Panels and Fine tune are not all there (' + m.switchTiles.length + ')');
      if (m.lookChips.length !== 3) fails.push('home studio: ' + m.lookChips.length + ' panel looks on the page (3)');
      if (m.moodChips.some((c) => c.disabled && c.name !== 'As before')) fails.push('home studio: a mood button is dashed while the home app lists it');
    }
    if (v.name === V_ABSENT) {
      if (!m.moodChips.every((c) => c.disabled)) fails.push('home studio: with no home app answer the three buttons must all be dashed, not live');
      if (m.lookChips.some((c) => !c.disabled)) fails.push('home studio: with no home app answer a panel look is live');
    }
  }
  if (v.name === V_CONDO || v.name === V_OFFICE) {
    if (m.pick.map((p) => p.name).join('|') !== 'Condo|Office') fails.push('home studio: the Moods heading holds "' + m.pick.map((p) => p.name).join('", "') + '" (Condo, Office)');
    const lit = m.pick.find((p) => p.on);
    if (!lit || lit.name !== (v.name === V_CONDO ? 'Condo' : 'Office')) fails.push('home studio: the lit word is ' + (lit ? lit.name : 'none') + ', wanted ' + (v.name === V_CONDO ? 'Condo' : 'Office'));
    for (const p of m.pick) if (p.h < 23 || (m.heading && (p.t < m.heading.t - 3 || p.b > m.heading.b + 3))) fails.push('home studio: the "' + p.name + '" pick is ' + r1(p.h) + ' px tall or sits outside the Moods heading');
    const want = v.name === V_CONDO ? ['Day', 'Evening', 'Late Night'] : ['Relax', 'Gaming', 'Recording'];
    if (want.some((w) => !m.cardNames.includes(w))) fails.push('home studio: the ' + (v.name === V_CONDO ? 'condo' : 'office') + ' cards are "' + m.cardNames.join('", "') + '" (wanted ' + want.join(', ') + ')');
    if (v.name === V_OFFICE && m.cardNames.includes('Day')) fails.push('home studio: the condo cards still show with Office picked');
    if (m.cards && m.cards.h > 150.5) fails.push('home studio: the mood cards are ' + r1(m.cards.h) + ' px tall (150)');
  }
  for (const x of m.small) fails.push('home studio: text under 16 px: ' + x);
  for (const x of m.cut) fails.push('home studio: cut text ' + x);
  for (const f of fails) emit('  FAIL ' + f);
  if (fails.length) return true;
  emit('  ok   home studio: the block inside the Sound card, the 64 px line, 34 px buttons in order, Condo and Office states, text 16 px or more, nothing cut');
  return false;
}

const on = (name) => (v) => v.name === name;

export default {
  name: 'home-studio',
  gallery: {
    states: [
      state('home studio: ready', READY, ['Studio lights', 'Key lights', 'Panels', 'Gaming', 'Office Recording', 'As before']),
      state('home studio: a hovered As before', `${READY}&officemood=gaming`, ['Puts the office back the way it was before the mood'], 'hover:[data-mood="back"]'),
      state('home studio: Gaming on', `${READY}&officemood=gaming`, ['Gaming', 'As before']),
      state('home studio: the home app not answering', ABSENT, ['Studio lights', 'Panel looks', 'Gaming', 'Office Recording', 'As before']),
      state('home studio: Moods on Condo', READY, ['Condo', 'Office', 'Day', 'Evening']),
      state('home studio: Moods on Office', READY, ['Condo', 'Office', 'Relax', 'Gaming', 'Recording'], '[data-moods-which="office"]'),
    ],
  },
  fit: {
    variants: [
      variant(V_READY, READY),
      variant(V_ONE, `${READY}&officemood=gaming`),
      variant(V_ABSENT, ABSENT),
      variant(V_CONDO, READY),
      variant(V_OFFICE, READY, { click: '[data-moods-which="office"]' }),
    ],
    measurements: { homestudio: measureHomeStudio },
    rules: { homestudio: rule },
    breaks: {
      'homestudio-tall': { css: '.hs-block { gap: 30px !important; }', expect: /^ *FAIL home studio: the block .* leaves the left column|^ *FAIL home studio: the block ends at y /m, appliesTo: on(V_READY) },
      'homestudio-line': { css: '.np-col > .sound-np, .np-line { height: 90px !important; }', expect: /^ *FAIL home studio: the Now playing line is \d+(\.\d)? px tall/m, appliesTo: on(V_READY) },
      'homestudio-cover': { css: '.sound-np.compact .np-cover, .sound-np.compact .np-slot { width: 100px !important; height: 100px !important; }', expect: /^ *FAIL home studio: the cover is /m, appliesTo: on(V_READY) },
      'homestudio-buttons': { css: '.hs-moods .u-mood { height: 28px !important; }', expect: /^ *FAIL home studio: button ".*" is [\d.]+ px tall/m, appliesTo: on(V_READY) },
      'homestudio-wide': { css: '.hs-moods .u-mood-name { padding: 0 60px !important; }', expect: /^ *FAIL home studio: (button ".*" ends at x|buttons ".*" and ".*" overlap|the moods row leaves the block)/m, appliesTo: on(V_READY) },
      'homestudio-text': { css: '.hs-title, .hs-row .st-preset, .hs-moods .u-mood { font-size: 13px !important; }', expect: /^ *FAIL home studio: text under 16 px/m, appliesTo: on(V_READY) },
      'homestudio-pick': { css: '.moods-pick { display: none !important; }', expect: /^ *FAIL home studio: the "(Condo|Office)" pick is 0 px tall/m, appliesTo: on(V_CONDO) },
      'homestudio-office': { css: '.mood-btn { display: none !important; }', expect: /^ *FAIL home studio: the office cards are/m, appliesTo: on(V_OFFICE) },
      'homestudio-dead': { css: '.hs-moods .u-mood { pointer-events: auto !important; } .hs-moods .u-mood.blocked { display: none !important; }', expect: /^ *FAIL home studio: the three buttons read/m, appliesTo: on(V_ABSENT) },
    },
  },
};
