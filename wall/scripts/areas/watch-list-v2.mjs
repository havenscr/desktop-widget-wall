// The Watch list card at rest, version 2 (approved mockups A-rest and A-typed): a chip row under the head (filter chips
// that scroll sideways and fade at the right edge, then the 108 px sort chip), the count line ("62 saved", "7 of 62"
// while narrowed) and four whole 40 px rows. Gallery states for the rest, words typed, a tag chip chosen and the sort
// menu open; fit variants with one browser measurement, its rule and a deliberate break for each rule. Later pieces of
// the Watch list v2 work append their states and rules to this file.

const BASE = 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&watch=mock&wlist=many&wlook=sky';
const steps = (...s) => s.join(' >> ');
const state = (name, expect, actions) => ({ screen: 'unwind', name: `watch list v2: ${name}`, query: BASE, custom: true, expect, actions });
const TAG_CHIP = '.w-chips .w-chip:nth-child(6)';
const VIDEOS = '.w-chips .w-chip:nth-child(3)';
const SORT = '.w-sortchip';

/**
 * Runs in the page (it references nothing outside its own body). The card at rest: the chip row 47 px under the top of
 * the card and 32 px tall, the sort chip 108 px wide, the list from 87 with whole 40 px rows that end above the field,
 * everything inside the card's 22 px side padding, every control at least 32 px tall, text 16 px or more, the labels at
 * least 10 px inside their buttons, the sort menu inside the card with six choices and one marked.
 */
function measureWatchListV2() {
  const fails = [];
  const card = document.querySelector('.w-card');
  const row = card && card.querySelector('.w-chiprow');
  if (!card || !row) return { row: false, fails };
  const r0 = (n) => Math.round(n * 10) / 10;
  const name = (e) => String((e.className && e.className.baseVal) || e.className || e.tagName);
  const c = card.getBoundingClientRect();
  const rr = row.getBoundingClientRect();
  const content = (e) => { const r = document.createRange(); r.selectNodeContents(e); return r.getBoundingClientRect(); };
  if (Math.abs(rr.top - c.top - 47) > 1.5) fails.push('the chip row is ' + r0(rr.top - c.top) + ' px under the card top (47)');
  if (Math.abs(rr.height - 32) > 1) fails.push('the chip row is ' + r0(rr.height) + ' px tall (32)');
  const sort = row.querySelector('.w-sortchip');
  const chips = [...row.querySelectorAll('.w-chip')];
  if (!sort) fails.push('no sort chip');
  if (chips.length < 4) fails.push('only ' + chips.length + ' chips (All, Live, Videos, Playlists at least)');
  if (sort) {
    const s = sort.getBoundingClientRect();
    if (Math.abs(s.width - 108) > 1) fails.push('the sort chip is ' + r0(s.width) + ' px wide (108)');
    if (s.right > c.right - 22 + 1) fails.push('the sort chip reaches past the card padding');
    const scroller = row.querySelector('.w-chips').getBoundingClientRect();
    if (scroller.right > s.left - 0.5) fails.push('the chips run into the sort chip');
    if (scroller.left < c.left + 22 - 1) fails.push('the chips start left of the card padding');
  }
  const list = card.querySelector('.w-list');
  const field = card.querySelector('.w-field');
  if (list) {
    const l = list.getBoundingClientRect();
    if (Math.abs(l.top - c.top - 87) > 2) fails.push('the list starts ' + r0(l.top - c.top) + ' px under the card top (87)');
    if (field && l.bottom > field.getBoundingClientRect().top + 0.5) fails.push('the list runs into the search box');
    const rows = [...list.querySelectorAll(':scope > li')].filter((li) => li.querySelector('.w-row'));
    for (const li of rows) { const b = li.getBoundingClientRect(); if (Math.abs(b.height - 40) > 1.5) { fails.push('a row is ' + r0(b.height) + ' px tall (40)'); break; } }
    if (list.clientHeight < 159) fails.push('the list shows less than four whole rows (' + r0(list.clientHeight) + ' px)');
  } else fails.push('no list');
  const n = card.querySelector('.u-card-head .u-xs');
  if (!n || !/^(\d+ saved|\d+ of \d+)$/.test(n.textContent || '')) fails.push('the count line reads "' + (n ? n.textContent : '') + '" (62 saved, or 7 of 62)');
  for (const e of row.querySelectorAll('button')) {
    const b = e.getBoundingClientRect();
    if (b.width === 0) continue;
    if (b.height < 31.5) fails.push('control ' + name(e) + ' is ' + r0(b.height) + ' px tall (32 at least)');
  }
  for (const e of row.querySelectorAll('.w-chip, .w-sortchip')) {
    const b = e.getBoundingClientRect(); const t = content(e);
    if (b.width === 0 || t.width === 0) continue;
    const scroll = row.querySelector('.w-chips').getBoundingClientRect();
    if (b.right > scroll.right + 0.5 && e.classList.contains('w-chip')) continue;
    if (t.left - b.left < 9.5 || b.right - t.right < 9.5) { fails.push('the label of ' + name(e) + ' is ' + r0(Math.min(t.left - b.left, b.right - t.right)) + ' px from the button edge (10 at least)'); break; }
  }
  for (const e of card.querySelectorAll('*')) {
    if ([...e.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 15.99) { fails.push('text under 16 px in ' + name(e)); break; }
  }
  const mask = getComputedStyle(row.querySelector('.w-chips')).maskImage || getComputedStyle(row.querySelector('.w-chips')).webkitMaskImage || '';
  if (mask.indexOf('gradient') < 0) fails.push('the chips do not fade at the right edge');
  const menu = card.querySelector('.w-sortmenu');
  if (menu) {
    const b = menu.getBoundingClientRect();
    if (b.left < c.left - 0.5 || b.right > c.right + 0.5 || b.top < c.top - 0.5 || b.bottom > c.bottom + 0.5) fails.push('the sort menu leaves the card');
    const opts = [...menu.querySelectorAll('[role="option"]')];
    if (opts.length !== 6) fails.push('the sort menu has ' + opts.length + ' choices (6)');
    if (opts.filter((o) => o.getAttribute('aria-selected') === 'true').length !== 1) fails.push('the sort menu does not mark the current order');
    for (const o of opts) { const ob = o.getBoundingClientRect(); if (ob.height < 31.5) { fails.push('a sort choice is ' + r0(ob.height) + ' px tall (32 at least)'); break; } }
  }
  return { row: true, menu: !!menu, narrowed: /^\d+ of \d+$/.test((n && n.textContent) || ''), fails };
}

const REST = 'Watch list v2, rest';
const CHIP = 'Watch list v2, a chip chosen';
const TYPED = 'Watch list v2, words typed';
const MENU = 'Watch list v2, sort menu open';
const variant = (name, click) => ({ name, q: `?${BASE}`, checks: ['.w-card'], click });

export default {
  name: 'watch-list-v2',
  gallery: {
    states: [
      state('rest', ['62 saved', 'All', 'Videos', 'Playlists', 'Recent'], 'is:.w-chiprow'),
      state('typed lo', ['of 62'], steps('type:.w-paste=lo', 'is:.w-chiprow')),
      state('chip #tag', ['of 62'], steps(TAG_CHIP, 'is:.w-chip.on')),
      state('sort menu open', ['Recent', 'Last played', 'Most played', 'Name, A to Z', 'Longest first', 'Most viewed'], steps(SORT, 'is:.w-sortmenu')),
    ],
  },
  fit: {
    variants: [variant(REST), variant(CHIP, VIDEOS), variant(TYPED, 'type:.w-paste=lo'), variant(MENU, SORT)],
    measurements: { watchListV2: measureWatchListV2 },
    rules: {
      watchListV2: (variant, results, emit) => {
        const m = results.watchListV2;
        if (!variant.name.startsWith('Watch list v2, ') || !m) return false;
        const fails = m.fails.slice();
        if (!m.row) fails.push('no chip row was drawn');
        else {
          if (variant.name === MENU && !m.menu) fails.push('the sort menu did not open');
          if ((variant.name === CHIP || variant.name === TYPED) && !m.narrowed) fails.push('the count line does not say "n of total" while narrowed');
        }
        for (const f of fails) emit(`  FAIL watch list v2: ${f}`);
        if (fails.length) return true;
        emit('  ok   watch list v2: chip row 47 px under the card top and 32 px tall, 108 px sort chip, chips fading at the right edge, list from 87 with whole 40 px rows above the field, controls 32 px or more, labels 10 px inside their buttons, text 16 px or more, the sort menu inside the card');
        return false;
      },
    },
    breaks: {
      'watchlistv2-row-height': { css: '.w-chiprow { height: 20px !important; }', expect: /^ *FAIL watch list v2: the chip row is [\d.]+ px tall/m, appliesTo: (v) => v.name === REST },
      'watchlistv2-list-top': { css: '.w-chiprow { margin-top: 30px !important; }', expect: /^ *FAIL watch list v2: the chip row is [\d.]+ px under the card top/m, appliesTo: (v) => v.name === REST },
      'watchlistv2-sort-width': { css: '.w-sortwrap { width: 80px !important; }', expect: /^ *FAIL watch list v2: the sort chip is [\d.]+ px wide/m, appliesTo: (v) => v.name === REST },
      'watchlistv2-chip-height': { css: '.w-chip { height: 24px !important; }', expect: /^ *FAIL watch list v2: control .* is [\d.]+ px tall/m, appliesTo: (v) => v.name === REST },
      'watchlistv2-small-text': { css: '.w-chip-n { font-size: 13px !important; }', expect: /^ *FAIL watch list v2: text under 16 px/m, appliesTo: (v) => v.name === REST },
      'watchlistv2-tight-label': { css: '.w-chip { padding: 0 3px !important; }', expect: /^ *FAIL watch list v2: the label of .* px from the button edge/m, appliesTo: (v) => v.name === REST },
      'watchlistv2-no-fade': { css: '.w-chips { -webkit-mask-image: none !important; mask-image: none !important; }', expect: /^ *FAIL watch list v2: the chips do not fade/m, appliesTo: (v) => v.name === REST },
      'watchlistv2-menu-out': { css: '.w-sortmenu { right: -300px !important; }', expect: /^ *FAIL watch list v2: the sort menu leaves the card/m, appliesTo: (v) => v.name === MENU },
      'watchlistv2-row-tall': { css: '.w-card .w-row { height: 52px !important; }', expect: /^ *FAIL watch list v2: a row is [\d.]+ px tall/m, appliesTo: (v) => v.name === CHIP },
    },
  },
};
