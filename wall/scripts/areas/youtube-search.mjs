// The YouTube Music search results (vote: Sort A, Thumbnails A, Detail A): rows with a picture and a views column, the sort
// button and its menu, a sorted answer, and the details card. Everything this area needs lives here.

const night = encodeURIComponent('2026-11-11T22:30:00-08:00');
const day = '2026-11-11T10:24:00-08:00';
const SWITCH = '.sp-switch button:nth-child(2)';
const TALL = 'grow';
const SORT = '.mu-sort';
const LONGEST = '.mu-sortmenu button:nth-child(3)';
const base = (extra) => `hz=unwind&at=${night}&clock=review&weather=ok&audio=demo&${extra}`;
const found = (extra = '') => base(`youtube=in&ytlib=full&ytsearch=night${extra}`);
const state = (name, query, expect, actions) => ({ screen: 'unwind', name: `youtube search: ${name}`, query, custom: true, expect, actions });
const steps = (...s) => s.join(' >> ');

/**
 * Runs in the page (it references nothing outside its own body). The search results of the YouTube side of the music card.
 * Rows are 50 px with a 64 by 36 picture, columns aligned (pictures, titles, channels, views and lengths line up row to row, views
 * end before the length begins); the label of the sort button and of every sort choice and chip sits at least 10 px inside its
 * edges; the sort menu and the details card stay inside the music card; no text under 16 px in what this area adds.
 */
function measureYoutubeSearch() {
  const fails = [];
  const cardEl = document.querySelector('.sp-card.yt');
  if (!cardEl || !cardEl.querySelector('.yt-list.rich')) return { ys: false, fails };
  const card = cardEl.getBoundingClientRect();
  const r0 = (n) => Math.round(n * 10) / 10;
  const name = (e) => String((e.className && e.className.baseVal) || e.className || e.tagName);
  const inside = (b) => b.left >= card.left - 0.5 && b.right <= card.right + 0.5 && b.top >= card.top - 0.5 && b.bottom <= card.bottom + 0.5;
  /** The box of what a button holds (its text and icons), without its padding. */
  const content = (e) => { const r = document.createRange(); r.selectNodeContents(e); return r.getBoundingClientRect(); };
  const rows = [...cardEl.querySelectorAll('.yt-list.rich .yt-row')];
  // Row height and the picture.
  for (const row of rows) {
    const b = row.getBoundingClientRect();
    if (Math.abs(b.height - 50) > 1) { fails.push('a result row is ' + r0(b.height) + ' px tall (50)'); break; }
  }
  for (const th of cardEl.querySelectorAll('.yt-list.rich .yt-rowthumb')) {
    const b = th.getBoundingClientRect();
    if (Math.abs(b.width - 64) > 1 || Math.abs(b.height - 36) > 1) { fails.push('a row picture is ' + r0(b.width) + ' by ' + r0(b.height) + ' (64 by 36)'); break; }
  }
  if (cardEl.querySelector('.yt-list.rich .yt-num')) fails.push('a row number is still drawn beside the picture');
  // Columns line up: the same left edge for pictures, titles and channels; the same right edge of the text for views and lengths; views end before the length begins.
  const col = (sel, edge) => rows.map((row) => row.querySelector(sel)).filter(Boolean).map((e) => (edge === 'left' ? e.getBoundingClientRect().left : content(e).right));
  const spread = (list) => (list.length ? Math.max(...list) - Math.min(...list) : 0);
  for (const [label, sel, edge] of [['pictures', '.yt-rowthumb', 'left'], ['titles', '.yt-title', 'left'], ['channels', '.yt-chan', 'left']]) {
    if (spread(col(sel, edge)) > 1) { fails.push('the ' + label + ' do not line up (' + r0(spread(col(sel, edge))) + ' px apart)'); }
  }
  const viewsRight = rows.filter((r) => r.querySelector('.yt-views')?.textContent).map((r) => content(r.querySelector('.yt-views')).right);
  if (spread(viewsRight) > 1) fails.push('the views are not right aligned (' + r0(spread(viewsRight)) + ' px apart)');
  const lenRight = rows.map((r) => r.querySelector('.yt-len')).filter((e) => e && !e.closest('.yt-row').classList.contains('off') && e.textContent).map((e) => content(e).right);
  if (spread(lenRight) > 1) fails.push('the lengths are not right aligned (' + r0(spread(lenRight)) + ' px apart)');
  for (const row of rows) {
    const v = row.querySelector('.yt-views'); const l = row.querySelector('.yt-len');
    if (v && l && v.textContent && l.textContent && content(v).right > content(l).left - 1) { fails.push('the views run into the length of a row'); break; }
  }
  // Labels sit at least 10 px inside their button's edges.
  for (const e of cardEl.querySelectorAll('.mu-sort, .mu-sortmenu button, .mu-chip, .mu-leave')) {
    const b = e.getBoundingClientRect(); const c = content(e);
    if (b.width === 0 || c.width === 0) continue;
    const left = c.left - b.left; const right = b.right - c.right;
    if (left < 9.5 || right < 9.5) { fails.push('the label of ' + name(e) + ' "' + (e.textContent || '').trim().slice(0, 16) + '" is ' + r0(Math.min(left, right)) + ' px from the button edge (10 at least)'); break; }
  }
  // The sort button and its menu: 32 px each way, the menu inside the card, no text under 16 px in what is added.
  const sort = cardEl.querySelector('.mu-sort');
  if (!sort) fails.push('the sort button is not on the chip row');
  else {
    const b = sort.getBoundingClientRect(); const lib = cardEl.querySelector('.mu-leave')?.getBoundingClientRect();
    if (b.width < 31.5 || b.height < 31.5) fails.push('the sort button is ' + r0(b.width) + ' by ' + r0(b.height) + ' (32 at least)');
    if (lib && b.right > lib.left) fails.push('the sort button is not left of Library');
  }
  const menu = cardEl.querySelector('.mu-sortmenu');
  if (menu) {
    if (!inside(menu.getBoundingClientRect())) fails.push('the sort menu leaves the music card');
    const opts = [...menu.querySelectorAll('[role="option"]')];
    if (opts.length !== 6) fails.push('the sort menu has ' + opts.length + ' choices (6)');
    for (const o of opts) if (o.getBoundingClientRect().height < 31.5) { fails.push('a sort choice is under 32 px tall'); break; }
  }
  const dcard = cardEl.querySelector('[data-detail-card]');
  if (dcard) {
    if (!inside(dcard.getBoundingClientRect())) fails.push('the details card leaves the music card');
    const desc = dcard.querySelector('.yt-dcard-desc');
    if (desc && desc.getBoundingClientRect().height > 3 * 22 + 1) fails.push('the description is ' + r0(desc.getBoundingClientRect().height) + ' px tall (3 lines, 66)');
  }
  for (const e of cardEl.querySelectorAll('.mu-sort *, .mu-sortmenu *, .yt-dcard *, .yt-views')) {
    if ([...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 15.99) { fails.push('text under 16 px in ' + name(e)); break; }
  }
  // After Longest first: the lengths never rise down the list (a row with no length is last).
  const seconds = (t) => (t.includes(':') ? t.split(':').reduce((n, p) => n * 60 + Number(p), 0) : null);
  const lens = rows.map((r) => seconds(r.querySelector('.yt-len')?.textContent ?? ''));
  const longest = sort?.classList.contains('on') && /Longest/.test(sort.textContent || '');
  if (longest) {
    for (let i = 1; i < lens.length; i += 1) if (lens[i] !== null && lens[i - 1] !== null && lens[i] > lens[i - 1]) { fails.push('the rows are not longest first'); break; }
  }
  return { ys: true, tall: cardEl.getAttribute('data-tall') === 'true', rows: rows.length, menu: !!menu, dcard: !!dcard, longest: !!longest, fails };
}

const fitQuery = (extra, when = day) => `?hz=unwind&at=${when}&long=1&agents=3&youtube=in&ytlib=full&ytsearch=night${extra}`;
const variant = (name, extra, click, more = {}) => ({ name: `YouTube search, ${name}`, q: fitQuery(extra), checks: ['.sp-card', '.yt-lib'], click, listen: true, ...more });
const RESULTS = 'YouTube search, results';
const MENU = 'YouTube search, sort menu open';
const SORTED = 'YouTube search, sorted by Longest first';
const CARD = 'YouTube search, details card';

export default {
  name: 'youtube-search',
  gallery: {
    states: [
      state('results with thumbnails and views', found(), ['Glass Harbor', 'Mira Vale', 'Library', '15K'], SWITCH),
      state('sort menu open', found(), ['Best match', 'Most viewed', 'Longest first', 'Shortest first', 'Channel, A to Z', 'Title, A to Z'], steps(SWITCH, SORT)),
      state('sorted by Longest first', found(), ['Longest', 'Glass Harbor'], steps(SWITCH, SORT, LONGEST)),
      state('details card open', found(), ['views', 'Aug 2024', 'Two hours of slow synth'], steps(SWITCH, 'hover:.yt-row:nth-child(4)')),
      state('tall, results', found(), ['Glass Harbor', 'Library'], steps(SWITCH, TALL)),
    ],
  },
  fit: {
    variants: [
      variant('results', '', SWITCH),
      variant('sort menu open', '&layer=up', steps(SWITCH, SORT), { listen: false }),
      variant('sorted by Longest first', '&layer=up', steps(SWITCH, SORT, LONGEST), { listen: false }),
      variant('details card', '&ytcard=3', SWITCH),
      variant('tall, results', '', steps(SWITCH, TALL), { listen: false }),
      variant('tall, details card', '&ytcard=4', steps(SWITCH, TALL), { listen: false }),
    ],
    measurements: { youtubeSearch: measureYoutubeSearch },
    rules: {
      youtubeSearch: (variant, results, emit) => {
        const m = results.youtubeSearch;
        if (!variant.name.startsWith('YouTube search, ') || !m) return false;
        const fails = m.fails.slice();
        if (!m.ys) fails.push('no search result rows were drawn (the read never finished)');
        else {
          if (variant.name === MENU && !m.menu) fails.push('the sort menu did not open');
          if (variant.name === SORTED && !m.longest) fails.push('the sort button does not show Longest in cyan');
          if (/details card/.test(variant.name) && !m.dcard) fails.push('the details card did not open');
        }
        for (const failure of fails) emit(`  FAIL youtube search: ${failure}`);
        if (fails.length) return true;
        emit('  ok   youtube search: rows 50 px with a 64 by 36 picture, columns aligned and views right aligned before the length, labels at least 10 px inside their buttons, the sort menu and the details card inside the card, no text under 16 px');
        return false;
      },
    },
    breaks: {
      'ytsearch-tight-label': { css: '.mu-sort { padding: 0 3px !important; }', expect: /^ *FAIL youtube search: the label of .* is \d+(\.\d)? px from the button edge/m, appliesTo: (v) => v.name === SORTED },
      'ytsearch-thumb': { css: '.yt-rowthumb { width: 48px !important; }', expect: /^ *FAIL youtube search: a row picture is /m, appliesTo: (v) => v.name === RESULTS },
      'ytsearch-views-left': { css: '.yt-views { text-align: left !important; }', expect: /^ *FAIL youtube search: the views are not right aligned/m, appliesTo: (v) => v.name === RESULTS },
      'ytsearch-row-height': { css: '.yt-list.rich .yt-row, .yt-list.rich .yt-cells { height: 42px !important; }', expect: /^ *FAIL youtube search: a result row is /m, appliesTo: (v) => v.name === RESULTS },
      'ytsearch-card-out': { css: '.yt-dcard { left: 650px !important; }', expect: /^ *FAIL youtube search: the details card leaves the music card/m, appliesTo: (v) => v.name === CARD },
      'ytsearch-menu-out': { css: '.mu-sortmenu { left: 600px !important; }', expect: /^ *FAIL youtube search: the sort menu leaves the music card/m, appliesTo: (v) => v.name === MENU },
    },
  },
};
