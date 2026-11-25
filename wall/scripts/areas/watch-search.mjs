// Search from the Watch card (approved mockup A): a words search in the paste box grows the card tall and shows the
// results as a two column grid or a list of rows, with a sort button and its menu. Gallery states for the grid, the list
// and the sort menu open (each ends with an is: check), and fit variants with one browser measurement, its rule and a
// deliberate break for each rule. Everything this area needs lives here.

const BASE = 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&watch=mock&youtube=in&wlist=three&wlook=sky';
const WORDS = 'type:.w-paste=synthwave night drive >> .w-add';
const GRID = '.ws-seg button:nth-child(1)';
const LIST = '.ws-seg button:nth-child(2)';
const SORT = '.mu-sort';
const MOST = '.mu-sortmenu button:nth-child(2)';
const steps = (...s) => s.join(' >> ');
const state = (name, expect, actions) => ({ screen: 'unwind', name: `watch search: ${name}`, query: BASE, custom: true, expect, actions });

/**
 * Runs in the page (it references nothing outside its own body). The Watch card while a search shows: the tall card
 * (630 px), the header line (count, sort, grid or list switch, back button), the results, and the foot line. Grid: two
 * columns with 100 px pictures; list: 56 px rows with an 80 by 45 picture and the views and lengths right aligned.
 * Text 16 px or more; buttons 32 px each way; the label of every button at least 10 px inside its edge; the sort menu
 * and everything else inside the card.
 */
function measureWatchSearch() {
  const fails = [];
  const card = document.querySelector('.w-card');
  const ws = card && card.querySelector('.ws');
  if (!card || !ws) return { ws: false, fails };
  const r0 = (n) => Math.round(n * 10) / 10;
  const name = (e) => String((e.className && e.className.baseVal) || e.className || e.tagName);
  const c = card.getBoundingClientRect();
  if (Math.abs(c.height - 630) > 1.5) fails.push('the card is ' + r0(c.height) + ' px tall (630)');
  const content = (e) => { const r = document.createRange(); r.selectNodeContents(e); return r.getBoundingClientRect(); };
  const items = [...ws.querySelectorAll('.ws-item')];
  const grid = !!ws.querySelector('.ws-grid');
  const list = !!ws.querySelector('.ws-list');
  const spread = (a) => (a.length ? Math.max(...a) - Math.min(...a) : 0);
  if (grid) {
    const lefts = new Set(items.map((e) => Math.round(e.getBoundingClientRect().left)));
    if (lefts.size !== 2) fails.push('the grid has ' + lefts.size + ' columns (2)');
    for (const t of ws.querySelectorAll('.ws-grid .ws-thumb')) { const b = t.getBoundingClientRect(); if (b.height < 99 || b.height > 101) { fails.push('a grid picture is ' + r0(b.height) + ' px tall (100)'); break; } }
    for (const t of ws.querySelectorAll('.ws-title')) { const b = t.getBoundingClientRect(); if (b.height > 21) { fails.push('a grid title is more than one line'); break; } }
    if (!ws.querySelector('.ws-dur')) fails.push('no duration badge on the pictures');
  }
  if (list) {
    for (const e of items) { const b = e.getBoundingClientRect(); if (Math.abs(b.height - 56) > 1.5) { fails.push('a list row is ' + r0(b.height) + ' px tall (56)'); break; } }
    for (const t of ws.querySelectorAll('.ws-list .ws-thumb')) { const b = t.getBoundingClientRect(); if (Math.abs(b.width - 80) > 1 || Math.abs(b.height - 45) > 1) { fails.push('a list picture is ' + r0(b.width) + ' by ' + r0(b.height) + ' (80 by 45)'); break; } }
    const rights = (sel) => items.map((e) => e.querySelector(sel)).filter((e) => e && e.textContent).map((e) => content(e).right);
    if (spread(rights('.ws-views')) > 1) fails.push('the views are not right aligned');
    if (spread(rights('.ws-len')) > 1) fails.push('the lengths are not right aligned');
    if (getComputedStyle(ws.querySelector('.ws-len')).fontVariantNumeric.indexOf('tabular-nums') < 0) fails.push('the lengths do not use tabular numbers');
    for (const e of items) { const v = e.querySelector('.ws-views'); const l = e.querySelector('.ws-len'); if (v && l && v.textContent && content(v).right > content(l).left - 1) { fails.push('the views run into the length'); break; } }
  }
  for (const sel of ['.ws-n', '.mu-sort', '.ws-seg', '.ws-back', '.ws-scroll', '.ws-foot']) if (!ws.querySelector(sel)) fails.push('the results hold no ' + sel);
  const bar = ws.querySelector('.ws-bar');
  if (bar) {
    const a = ['.ws-n', '.mu-sort', '.ws-seg', '.ws-back'].map((s) => ws.querySelector(s)?.getBoundingClientRect()).filter(Boolean);
    for (let i = 1; i < a.length; i += 1) if (a[i].left < a[i - 1].right - 0.5) { fails.push('the header line overlaps itself'); break; }
    if (a.length && a[a.length - 1].right > c.right - 10) fails.push('the header line reaches within 10 px of the card edge');
  }
  const sortText = ws.querySelector('.mu-sort')?.textContent || '';
  if (!/^Sort: /.test(sortText)) fails.push('the sort button reads "' + sortText + '" (Sort: <name>)');
  const foot = ws.querySelector('.ws-foot');
  if (foot && !/searches? left today/.test(foot.textContent || '')) fails.push('the foot has no searches-left line');
  for (const e of card.querySelectorAll('button, input')) {
    const b = e.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) continue;
    if (e.classList.contains('ws-add')) continue;
    if (b.width < 31.5 || b.height < 31.5) fails.push('control ' + name(e) + ' is ' + r0(b.width) + ' by ' + r0(b.height) + ' (32 at least)');
  }
  // The text of a result sits at least 10 px inside its clickable button.
  for (const btn of ws.querySelectorAll('button.ws-play')) {
    const b = btn.getBoundingClientRect();
    let worst = 999;
    for (const t of btn.querySelectorAll('.ws-title, .ws-meta, .ws-views, .ws-len')) {
      if (!t.textContent) continue;
      // A long text is cut by its box (an ellipsis), so what shows ends at the box's edge.
      const r = content(t); const box = t.getBoundingClientRect(); const cs = getComputedStyle(t);
      worst = Math.min(worst, Math.max(r.left, box.left + parseFloat(cs.paddingLeft)) - b.left, b.right - Math.min(r.right, box.right - parseFloat(cs.paddingRight)));
    }
    if (worst < 9.5) { fails.push('the text of a result is ' + r0(worst) + ' px from its button edge (10 at least)'); break; }
  }
  for (const e of card.querySelectorAll('.mu-sort, .mu-sortmenu button, .ws-back, .w-add')) {
    const b = e.getBoundingClientRect(); const t = content(e);
    if (b.width === 0 || t.width === 0) continue;
    if (t.left - b.left < 9.5 || b.right - t.right < 9.5) { fails.push('the label of ' + name(e) + ' "' + (e.textContent || '').trim().slice(0, 16) + '" is ' + r0(Math.min(t.left - b.left, b.right - t.right)) + ' px from the button edge (10 at least)'); break; }
  }
  for (const e of card.querySelectorAll('*')) {
    if ([...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 15.99) { fails.push('text under 16 px in ' + name(e)); break; }
  }
  const menu = ws.querySelector('.mu-sortmenu');
  if (menu) {
    const b = menu.getBoundingClientRect();
    if (b.left < c.left - 0.5 || b.right > c.right + 0.5 || b.top < c.top - 0.5 || b.bottom > c.bottom + 0.5) fails.push('the sort menu leaves the card');
    const opts = [...menu.querySelectorAll('[role="option"]')];
    if (opts.length !== 6) fails.push('the sort menu has ' + opts.length + ' choices (6)');
    if (opts.filter((o) => o.getAttribute('aria-selected') === 'true').length !== 1) fails.push('the sort menu does not mark the current order');
  }
  const sc = ws.querySelector('.ws-scroll')?.getBoundingClientRect();
  for (const e of ws.querySelectorAll('.ws-bar *, .ws-foot *')) { const b = e.getBoundingClientRect(); if (b.width && (b.left < c.left - 0.5 || b.right > c.right + 0.5)) { fails.push(name(e) + ' sticks out of the card'); break; } }
  const field = card.querySelector('.w-field')?.getBoundingClientRect();
  if (sc && field && sc.bottom > field.top + 0.5) fails.push('the results run into the search box');
  return { ws: true, grid, list, menu: !!menu, items: items.length, fails };
}

const Q = (extra = '') => `?${BASE}&wpaste=${encodeURIComponent('synthwave night drive')}${extra}`;
const variant = (name, click) => ({ name: `Watch search, ${name}`, q: Q(), checks: ['.w-card'], click });
const GRIDV = 'Watch search, grid';
const LISTV = 'Watch search, list';
const MENUV = 'Watch search, sort menu open';

export default {
  name: 'watch-search',
  gallery: {
    states: [
      state('grid', ['videos', 'Sort: Best match', 'searches left today', 'Glass Harbor'], steps(WORDS, GRID, 'is:.ws-grid')),
      state('list', ['videos', 'Sort: Best match', 'Glass Harbor', 'Mira Vale'], steps(WORDS, LIST, 'is:.ws-list')),
      state('sort menu open', ['Best match', 'Most viewed', 'Longest first', 'Shortest first', 'Channel, A to Z', 'Title, A to Z'], steps(WORDS, LIST, SORT, 'is:.mu-sortmenu')),
      state('sorted by most viewed, list', ['Sort: Views'], steps(WORDS, LIST, SORT, MOST, 'is:.ws-list')),
    ],
  },
  fit: {
    variants: [variant('grid', GRID), variant('list', LIST), variant('sort menu open', steps(LIST, SORT))],
    measurements: { watchSearch: measureWatchSearch },
    rules: {
      watchSearch: (variant, results, emit) => {
        const m = results.watchSearch;
        if (!variant.name.startsWith('Watch search, ') || !m) return false;
        const fails = m.fails.slice();
        if (!m.ws) fails.push('no search results were drawn (the read never finished)');
        else {
          if (variant.name === GRIDV && !m.grid) fails.push('the grid view did not open');
          if (variant.name !== GRIDV && !m.list) fails.push('the list view did not open');
          if (variant.name === MENUV && !m.menu) fails.push('the sort menu did not open');
        }
        for (const f of fails) emit(`  FAIL watch search: ${f}`);
        if (fails.length) return true;
        emit('  ok   watch search: the card is 630 px tall; two grid columns with 100 px pictures or 56 px list rows with 80 by 45 pictures and aligned views and lengths; the header line, labels at least 10 px inside their buttons, the sort menu inside the card, text 16 px or more');
        return false;
      },
    },
    breaks: {
      'watchsearch-card-height': { css: '.w-card.own-tall { height: 480px !important; }', expect: /^ *FAIL watch search: the card is [\d.]+ px tall/m, appliesTo: (v) => v.name === GRIDV },
      'watchsearch-one-column': { css: '.ws-grid { grid-template-columns: 1fr !important; }', expect: /^ *FAIL watch search: the grid has 1 columns/m, appliesTo: (v) => v.name === GRIDV },
      'watchsearch-row-height': { css: '.ws-list .ws-item { height: 44px !important; }', expect: /^ *FAIL watch search: a list row is /m, appliesTo: (v) => v.name === LISTV },
      'watchsearch-views-left': { css: '.ws-views { text-align: left !important; }', expect: /^ *FAIL watch search: the views are not right aligned/m, appliesTo: (v) => v.name === LISTV },
      'watchsearch-tight-label': { css: '.ws-back { padding: 0 3px !important; }', expect: /^ *FAIL watch search: the label of .* is [\d.]+ px from the button edge/m, appliesTo: (v) => v.name === GRIDV },
      'watchsearch-text-edge': { css: '.ws-grid .ws-title, .ws-grid .ws-meta { padding: 0 !important; }', expect: /^ *FAIL watch search: the text of a result is [\d.-]+ px from its button edge/m, appliesTo: (v) => v.name === GRIDV },
      'watchsearch-menu-out': { css: '.ws-menu { right: -300px !important; }', expect: /^ *FAIL watch search: the sort menu leaves the card/m, appliesTo: (v) => v.name === MENUV },
    },
  },
};
