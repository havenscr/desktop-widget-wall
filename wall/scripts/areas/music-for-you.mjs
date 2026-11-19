// The For you tab of the YouTube side (vote 1A): the mood chip row and the Back to shelf of four tiles with
// See all. Gallery states, fit variants with one browser measurement and its rule, and a deliberate break
// for each rule. Everything this area needs lives here; nothing is registered in the two big review scripts.

const night = encodeURIComponent('2026-11-11T22:30:00-08:00');
const day = '2026-11-11T10:24:00-08:00';
const SWITCH = '.sp-switch button:nth-child(2)';
const TALL = '.sp-grow';
const FORYOU = '.sp-tabs button:nth-child(1)';
const SEEALL = '.yt-seeall';
const steps = (...s) => s.join(' >> ');
const base = (extra) => `hz=unwind&at=${night}&clock=review&weather=ok&audio=demo&youtube=in&ytlib=full&${extra}`;
const state = (name, query, expect, actions) => ({ screen: 'unwind', name: `for you: ${name}`, query, custom: true, expect, actions });
const fitQuery = (extra) => `?hz=unwind&at=${day}&long=1&agents=3&youtube=in&ytlib=full&${extra}`;
const variant = (name, extra, click, more = {}) => ({ name: `For you, ${name}`, q: fitQuery(extra), checks: ['.sp-card', '.yt-lib'], click, ...more });

const REST = 'For you, at rest, six played';
const FEW = 'For you, at rest, two played';
const NONE = 'For you, at rest, nothing played';
const ALL = 'For you, at rest, See all';
const TALLV = 'For you, tall, six played';

/**
 * Runs in the page (it references nothing outside its own body). At rest the card is 800 by 462 at wall
 * 1740, 24 (tall 833 by 624 at 1707, 24). Eight chips sit in one row, each at least 32 px high with text of
 * 16 px or more, and none leaves the library's box or overlaps another. The shelf has at most four tiles in a
 * row, each picture 16:9 (176 by 99 at rest), See all at the shelf's right edge and at least 32 px high; the
 * search field keeps at least 300 px beside the three tabs; no text under 16 px; nothing outside the card; the
 * first row of tiles with its captions is whole inside the scroller before any scrolling.
 */
function measureForYou() {
  const fails = [];
  const cardEl = document.querySelector('.sp-card');
  const foryou = cardEl?.querySelector('.yt-foryou');
  if (!cardEl || !cardEl.classList.contains('yt') || !foryou) return { fy: false, fails };
  const st = document.createElement('style');
  st.textContent = '.sp-card { transition: none !important; }';
  document.head.appendChild(st);
  const card = cardEl.getBoundingClientRect();
  const tall = cardEl.getAttribute('data-tall') === 'true';
  const r0 = (n) => Math.round(n * 10) / 10;
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const name = (e) => String((e.className && e.className.baseVal) || e.className || e.tagName);
  const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  if (tall) {
    if (!near(card.left, 1707, 1.5) || !near(card.top, 24, 1.5) || !near(card.width, 833, 1.5) || !near(card.height, 624, 1.5)) fails.push('the tall card is at x ' + r0(card.left) + ', y ' + r0(card.top) + ', ' + r0(card.width) + ' by ' + r0(card.height) + ' (833 by 624 at 1707, 24)');
  } else if (!near(card.left, 1740, 1.5) || !near(card.top, 24, 1.5) || !near(card.width, 800, 1.5) || !near(card.height, 462, 1.5)) {
    fails.push('the resting card is at x ' + r0(card.left) + ', y ' + r0(card.top) + ', ' + r0(card.width) + ' by ' + r0(card.height) + ' (800 by 462 at 1740, 24)');
  }
  const libEl = cardEl.querySelector('.yt-lib');
  const lib = libEl.getBoundingClientRect();
  // The chips: eight, one row, whole, apart.
  const chips = [...foryou.querySelectorAll('.yt-chip')];
  if (chips.length !== 8) fails.push('there are ' + chips.length + ' mood chips (8)');
  const boxes = chips.map((c) => c.getBoundingClientRect());
  if (new Set(boxes.map((b) => Math.round(b.top))).size > 1) fails.push('the mood chips are on more than one row');
  boxes.forEach((b, i) => {
    if (b.right > lib.right - 5 + 0.5 || b.left < lib.left - 0.5) fails.push('the chip "' + chips[i].textContent + '" leaves the library box (right edge ' + r0(b.right) + ', box ends ' + r0(lib.right - 5) + ')');
    for (let j = i + 1; j < boxes.length; j += 1) if (hit(b, boxes[j])) fails.push('two mood chips overlap');
  });
  // The shelf: tiles, columns, pictures, See all.
  const tiles = [...foryou.querySelectorAll('.yt-tile')];
  const covers = tiles.map((t) => t.querySelector('.yt-cover')?.getBoundingClientRect()).filter((b) => b && b.width > 0);
  const first = covers.slice(0, 4);
  const lefts = new Set(first.map((b) => Math.round(b.left)));
  if (first.length && lefts.size !== Math.min(first.length, 4)) fails.push('the first row has ' + lefts.size + ' columns (' + Math.min(first.length, 4) + ')');
  for (const b of first) {
    if (Math.abs(b.width / b.height - 16 / 9) > 0.04) { fails.push('a tile picture is ' + r0(b.width) + ' by ' + r0(b.height) + ', not 16:9'); break; }
    if (!tall && (!near(b.width, 176, 2) || !near(b.height, 99, 2))) { fails.push('a tile picture is ' + r0(b.width) + ' by ' + r0(b.height) + ' (176 by 99 at rest)'); break; }
  }
  const see = foryou.querySelector('.yt-seeall')?.getBoundingClientRect();
  const grid = foryou.querySelector('.yt-grid')?.getBoundingClientRect();
  if (see && grid && Math.abs(see.right - grid.right) > 12) fails.push('See all is at x ' + r0(see.right) + ' but the shelf ends at ' + r0(grid.right) + ' (the right edge)');
  // The first row with its captions is whole inside the scroller.
  const scroller = foryou.querySelector('.yt-scroll')?.getBoundingClientRect();
  const firstTile = tiles[0]?.getBoundingClientRect();
  if (scroller && firstTile && !tall && firstTile.bottom > scroller.bottom + 0.5) fails.push('the first row of tiles ends at y ' + r0(firstTile.bottom) + ', below the scroller (' + r0(scroller.bottom) + ')');
  // The search field keeps its room beside the three tabs.
  const field = cardEl.querySelector('.yt-bar .sp-search')?.getBoundingClientRect();
  const tabs = cardEl.querySelector('.yt-bar .sp-tabs')?.getBoundingClientRect();
  if (field && field.width < 299.5) fails.push('the search field is ' + r0(field.width) + ' px wide (300 at least)');
  if (field && tabs && hit(field, tabs)) fails.push('the tabs and the field overlap');
  // No text under 16 px, every button 32 px or more.
  const small = [...cardEl.querySelectorAll('*')].filter((e) => [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 15.99);
  for (const e of small.slice(0, 3)) fails.push('text under 16 px in ' + name(e) + ' "' + (e.textContent || '').trim().slice(0, 24) + '" (' + getComputedStyle(e).fontSize + ')');
  for (const e of foryou.querySelectorAll('button')) {
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.width < 31.5 || r.height < 31.5) fails.push('control ' + name(e) + ' "' + (e.textContent || '').trim().slice(0, 20) + '" is ' + r0(r.width) + ' by ' + r0(r.height) + ' (32 at least)');
  }
  // Nothing outside the card (what the scroller hides is cut to its box first).
  for (const e of foryou.querySelectorAll('*')) {
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || e.closest('svg') || e.tagName === 'svg') continue;
    let box = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    const sc = e.closest('.yt-scroll');
    if (sc) {
      const s = sc.getBoundingClientRect();
      box = { left: Math.max(r.left, s.left), right: Math.min(r.right, s.right), top: Math.max(r.top, s.top), bottom: Math.min(r.bottom, s.bottom) };
      if (box.right <= box.left || box.bottom <= box.top) continue;
    }
    if (box.left < card.left - 0.5 || box.right > card.right + 0.5 || box.top < card.top - 0.5 || box.bottom > card.bottom + 0.5) { fails.push(name(e) + ' sticks out of the card'); break; }
  }
  // A long title ends in an ellipsis inside its box.
  for (const e of foryou.querySelectorAll('.sp-tname2, .yt-count, .yt-shelfsub')) {
    const cs = getComputedStyle(e);
    if (e.scrollWidth > e.clientWidth + 1 && (cs.textOverflow !== 'ellipsis' || cs.overflowX === 'visible')) { fails.push('text clipped in ' + name(e) + ' "' + (e.textContent || '').trim().slice(0, 24) + '" with no ellipsis'); break; }
  }
  return { fy: true, tall, tiles: tiles.length, see: !!see, empty: !!foryou.querySelector('.yt-state'), fails };
}

export default {
  name: 'music-for-you',
  gallery: {
    states: [
      state('rest, six played', base('ytplayed=6'), ['For you', 'Playlists', 'Liked', 'Focus', 'Romance', 'Back to', 'what the wall played', 'Yesterday', 'See all'], steps(SWITCH, FORYOU)),
      state('rest, two played', base('ytplayed=2'), ['Back to', 'Today', 'Yesterday', '!See all'], steps(SWITCH, FORYOU)),
      state('rest, nothing played', base('ytplayed=none'), ['Nothing played here yet', 'Focus', '!See all'], steps(SWITCH, FORYOU)),
      state('rest, See all', base('ytplayed=12'), ['Back to the shelf', 'Last month', '2 weeks ago'], steps(SWITCH, FORYOU, SEEALL)),
      state('rest, not answering', base('ytplayed=6&ytfy=down'), ['YouTube is not answering.', 'Retry', 'Focus'], steps(SWITCH, FORYOU)),
      state('tall, six played', base('ytplayed=6'), ['Back to', 'Focus', 'Yesterday'], steps(SWITCH, TALL, FORYOU)),
    ],
  },
  fit: {
    variants: [
      variant('at rest, six played', 'ytplayed=6', steps(SWITCH, FORYOU), { listen: true }),
      variant('at rest, two played', 'ytplayed=2', steps(SWITCH, FORYOU), { listen: true }),
      variant('at rest, nothing played', 'ytplayed=none', steps(SWITCH, FORYOU), { listen: true }),
      variant('at rest, See all', 'ytplayed=12', steps(SWITCH, FORYOU, SEEALL), { listen: true }),
      variant('at rest, not answering', 'ytplayed=6&ytfy=down', steps(SWITCH, FORYOU), { listen: true }),
      variant('tall, six played', 'ytplayed=6', steps(SWITCH, TALL, FORYOU)),
    ],
    measurements: { musicForYou: measureForYou },
    rules: {
      musicForYou: (v, results, emit) => {
        const m = results.musicForYou;
        if (!v.name.startsWith('For you, ') || !m || !m.fy) return false;
        const fails = m.fails.slice();
        if (v.name === REST && m.tiles !== 4) fails.push('the shelf has ' + m.tiles + ' tiles (4, the first read never finished or the shelf is not four)');
        if (v.name === REST && !m.see) fails.push('See all is not there with six played');
        if (v.name === FEW && m.see) fails.push('See all shows with two played');
        if (v.name === NONE && !m.empty) fails.push('the empty line is not there');
        for (const failure of fails) emit(`  FAIL for you: ${failure}`);
        if (fails.length) return true;
        emit(`  ok   for you: the ${m.tall ? 'tall card is 833 by 624 at 1707, 24' : 'resting card is 800 by 462 at 1740, 24'}, eight mood chips in one row, tiles 16:9 in a row of four${m.tall ? '' : ' (176 by 99)'}, See all at the right edge, the search field 300 px or more, no text under 16 px, every button 32 px or more, nothing outside the card`);
        return false;
      },
    },
    breaks: {
      'foryou-rest-height': { css: '.sp-card.yt:has(.yt-lib) { height: 500px !important; }', expect: /^ *FAIL for you: the resting card is at /m, appliesTo: (v) => v.name === REST },
      'foryou-chip-small': { css: '.yt-chip { font-size: 14px !important; }', expect: /^ *FAIL for you: text under 16 px in /m, appliesTo: (v) => v.name === REST },
      'foryou-chip-height': { css: '.yt-chip { height: 24px !important; }', expect: /^ *FAIL for you: control .* is \d+(\.\d)? by \d+(\.\d)? \(32 at least\)/m, appliesTo: (v) => v.name === REST },
      'foryou-chip-wrap': { css: '.yt-chips { flex-wrap: wrap !important; } .yt-chip { padding: 0 40px !important; }', expect: /^ *FAIL for you: (the mood chips are on more than one row|the chip )/m, appliesTo: (v) => v.name === REST },
      'foryou-columns': { css: '.yt-foryou .yt-grid { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }', expect: /^ *FAIL for you: (the first row has \d+ columns|a tile picture is )/m, appliesTo: (v) => v.name === REST },
      'foryou-seeall-left': { css: '.yt-seeall { position: relative !important; left: -300px !important; }', expect: /^ *FAIL for you: See all is at x /m, appliesTo: (v) => v.name === REST },
      'foryou-search': { css: '.yt-bar .sp-search { flex: none !important; width: 120px !important; }', expect: /^ *FAIL for you: the search field is \d+(\.\d)? px wide/m, appliesTo: (v) => v.name === REST },
      'foryou-first-row': { css: '.yt-foryou .yt-grid { row-gap: 14px; } .yt-foryou .yt-tile .yt-cover { margin-top: 80px !important; }', expect: /^ *FAIL for you: the first row of tiles ends at y /m, appliesTo: (v) => v.name === REST },
      'foryou-clip': { css: '.yt-foryou .sp-tname2::after { content: " and an ending that cannot fit the tile at all"; } .yt-foryou .sp-tname2 { white-space: nowrap !important; overflow: visible !important; text-overflow: clip !important; }', expect: /^ *FAIL for you: (text clipped in|.* sticks out of the card)/m, appliesTo: (v) => v.name === REST },
    },
  },
};
