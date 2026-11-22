// The music card's tall view (the pointer resting on the card opens it into the right third of the wall) and "Play on": its gallery
// states, fit variants, one browser measurement with its rule, and the deliberate breaks. Moved here from the two big
// review scripts; nothing is registered there for it.

/**
 * Runs in the page (it references nothing outside its own body). The tall view: 833 by 624 at wall 1707, 24, above the bottom
 * row, no text under 16 px, every control 32 px or more, nothing cut or out of the card, Play and Shuffle inside their column.
 * At rest (on a Listen state that asks for it): 800 by 462, the Play on chip at the right end of the top row, the chooser
 * inside the wall and the card. Transitions are switched off first, so the box measured is the one the card settles on.
 */
function measureTallMusic() {
  const fails = [];
  const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  const st = document.createElement('style');
  st.textContent = '.sp-card { transition: none !important; }';
  document.head.appendChild(st);

  const cardEl = document.querySelector('.sp-card');
  const card = cardEl?.getBoundingClientRect();
  const tall = cardEl?.getAttribute('data-tall') === 'true';
  if (!card) return { card: false, tall: false, fails };
  if (tall) {
    // The tall view: the right third, 833 by 624 at wall 1707, 24, ending above the bottom row (the Hide screen control and the office lights slot).
    const near = (a, b) => Math.abs(a - b) <= 1.5;
    if (!near(card.left, 1707) || !near(card.top, 24) || !near(card.width, 833) || !near(card.height, 624)) fails.push('listen tall: the card is at x ' + Math.round(card.left) + ' to ' + Math.round(card.right) + ', y ' + Math.round(card.top) + ' to ' + Math.round(card.bottom) + ' (833 by 624 at 1707, 24)');
    if (card.bottom > 648.5) fails.push('listen tall: the card ends at y ' + Math.round(card.bottom) + ', into the bottom row (648 at most)');
    if (card.left < 0 || card.right > 2540.5 || card.top < 0 || card.bottom > 720) fails.push('listen tall: the card leaves the wall: x ' + Math.round(card.left) + ' to ' + Math.round(card.right) + ', y ' + Math.round(card.top) + ' to ' + Math.round(card.bottom));
    for (const [name, el] of [['Hide screen', document.querySelector('.so-layer')], ['the office lights slot', document.querySelector('[data-slot="office-lights"]')]]) {
      const r = el?.getBoundingClientRect();
      if (r && r.width > 0 && hit(card, r)) fails.push('listen tall: the card covers ' + name);
    }
    const name = (e) => (e.className?.baseVal ?? e.className ?? e.tagName) || e.tagName;
    // No text under 16 px (the small "not set up" tag of today's switch aside).
    const small = [...cardEl.querySelectorAll('*')].filter((e) => !e.closest('.sp-off') && [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 15.99);
    for (const e of small.slice(0, 3)) fails.push('listen tall: text under 16 px in ' + name(e) + ' "' + (e.textContent || '').trim().slice(0, 24) + '" (' + getComputedStyle(e).fontSize + ')');
    // Controls at least 32 px each way (the time bar's track is thin: its grab area, the ::before, is what counts). The 30 by 30 add
    // control of a library row is held to its own size by the library-add area.
    for (const e of cardEl.querySelectorAll('button:not(.yt-add), input, [role="slider"]')) {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (e.getAttribute('role') === 'slider') {
        const pb = getComputedStyle(e, '::before');
        const grab = r.height - parseFloat(pb.top) - parseFloat(pb.bottom);
        if (!(grab >= 31.5)) fails.push('listen tall: the time bar grab area is ' + Math.round(grab) + ' px tall (32 at least)');
        continue;
      }
      if (r.width < 31.5 || r.height < 31.5) fails.push('listen tall: control ' + name(e) + ' "' + (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 20) + '" is ' + Math.round(r.width) + ' by ' + Math.round(r.height) + ' (32 at least)');
    }
    // Play and Shuffle of an opened list stay inside their 200 px column.
    const sh = cardEl.querySelector('.sp-shead');
    const shb = cardEl.querySelector('.sp-shbtns');
    if (sh && shb) {
      const colBox = sh.getBoundingClientRect();
      for (const b of shb.children) if (b.getBoundingClientRect().right > colBox.right + 0.5) fails.push('listen tall: ' + (b.textContent || '').trim() + ' runs past its column by ' + Math.round(b.getBoundingClientRect().right - colBox.right) + ' px');
    }
    // Nothing cut or sticking out in the header, the tab row, the player row, the opened list's head (the chooser hangs in the top row) and the lines under them.
    for (const root of cardEl.querySelectorAll('.sp-top, .sp-bar, .sp-player, .sp-shead, .sp-qhead, .sp-note')) {
      for (const e of [root, ...root.querySelectorAll('*')]) {
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || e.closest('svg') || e.tagName === 'svg') continue;
        if (r.left < card.left - 0.5 || r.right > card.right + 0.5 || r.top < card.top - 0.5 || r.bottom > card.bottom + 0.5) fails.push('listen tall: ' + name(e) + ' sticks out of the card');
        const cs = getComputedStyle(e);
        if ((cs.overflowX !== 'visible') && e.scrollWidth > e.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) fails.push('listen tall: text clipped in ' + name(e) + ' "' + (e.textContent || '').trim().slice(0, 24) + '" with no ellipsis');
      }
    }
  }
  // No scroll area of the card scrolls sideways: only a vertical bar may show (a grid pushed past its scroller is the usual cause).
  for (const e of cardEl.querySelectorAll('*')) {
    const cs = getComputedStyle(e);
    if (cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') continue;
    if (e.scrollWidth > e.clientWidth + 1) fails.push('listen: ' + ((e.className?.baseVal ?? e.className) || e.tagName) + ' scrolls sideways (content ' + e.scrollWidth + ' px in ' + e.clientWidth + ' px)');
  }
  // The hover and focus ring of a tile (2 px outline, 3 px offset: 5 px past its cover) of the first and the last column lies inside its scroll area, sideways.
  for (const grid of cardEl.querySelectorAll('.sp-scroll .sp-grid')) {
    const sc = grid.closest('.sp-scroll');
    const sr = sc.getBoundingClientRect();
    const lo = sr.left + sc.clientLeft, hi = lo + sc.clientWidth;
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    const covers = [...grid.querySelectorAll('.sp-tilecover')];
    for (const [i, c] of covers.entries()) {
      if (i % cols !== 0 && i % cols !== cols - 1) continue;
      const r = c.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.left - 5 < lo - 0.5 || r.right + 5 > hi + 0.5) fails.push('listen: the hover ring of tile ' + (i + 1) + ' is cut by its scroll area (ring ' + Math.round(r.left - 5) + ' to ' + Math.round(r.right + 5) + ', area ' + Math.round(lo) + ' to ' + Math.round(hi) + ')');
    }
  }
  // The Library row fits the card (its tabs do not scroll), and the focus ring (3 px outline, 2 px offset: 5 px) of the first chip and the Library button lies inside .sp-body.
  const places = cardEl.querySelector('.mu-places');
  if (places && places.scrollWidth > places.clientWidth + 1) fails.push('listen: the Library row does not fit the card (tabs ' + places.scrollWidth + ' px in ' + places.clientWidth + ' px)');
  const body = cardEl.querySelector('.sp-body')?.getBoundingClientRect();
  const first = cardEl.querySelector('.mu-chiplist button')?.getBoundingClientRect();
  const leave = cardEl.querySelector('.mu-leave')?.getBoundingClientRect();
  if (body && first && first.left - 5 < body.left - 0.5) fails.push('listen: the focus ring of the first chip is cut at the left by ' + Math.round(body.left - (first.left - 5)) + ' px');
  if (body && leave && leave.right + 5 > body.right + 0.5) fails.push('listen: the focus ring of the Library button is cut at the right by ' + Math.round(leave.right + 5 - body.right) + ' px');
  // YouTube Music search shows its results region (the search ran on Enter).
  // At rest the card is today's 800 by 462 (YouTube Music's own height aside), with the Play on chip at the right end of the top row.
  if (card && !tall && !cardEl.classList.contains('yt') && (Math.abs(card.width - 800) > 1.5 || Math.abs(card.height - 462) > 1.5)) fails.push('listen: the resting card is ' + Math.round(card.width) + ' by ' + Math.round(card.height) + ' (800 by 462)');
  const chipEl = cardEl?.querySelector('.sp-dev');
  if (cardEl && cardEl.querySelector('.sp-grow')) fails.push('listen: the round button that opened the tall view is still there');
  const pop = cardEl?.querySelector('.sp-devices')?.getBoundingClientRect();
  if (pop && card && (pop.left < 0 || pop.top < 0 || pop.right > 2560 || pop.bottom > 720 || pop.left < card.left - 0.5 || pop.right > card.right + 0.5 || pop.bottom > card.bottom + 0.5 || pop.top < card.top - 0.5)) fails.push('listen: the Play on list is at x ' + Math.round(pop.left) + ' to ' + Math.round(pop.right) + ', y ' + Math.round(pop.top) + ' to ' + Math.round(pop.bottom) + ', outside the wall or the card');
  return { card: true, tall, fails, ytRegion: (cardEl.querySelector('[aria-label="Search results"]')?.getBoundingClientRect().width ?? 0) > 0 };
}

const at = '2026-11-11T10:24:00-08:00';
const night = '2026-11-11T22:30:00-08:00';
const fitQuery = (extra, when = at) => `?hz=unwind&at=${when}&long=1&agents=3${extra}`;
const tallVariant = (name, extra, click) => ({ name: `Listen, the tall view, ${name}`, q: fitQuery(extra), checks: ['.sp-card'], click });
const YT_SEARCH = 'Listen, the tall view, YouTube Music, search in groups';
const TALL_OPEN = 'Listen, the tall view open on Playlists';
const REST = 'Listen, the resting card with Play on';
const state = (name, query, expect, actions) => ({ screen: 'unwind', name, query, custom: true, expect, actions });
export default {
  name: 'music-card',
  gallery: {
    states: [
    state('tall music: opens after the pointer rests 1.5 s', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo', ['!Which player the wall follows', 'Road Trip 1', 'Up next'], 'hover:.sp-card >> wait:1000 >> is:.sp-card.tall'),
    state('tall music: open on Playlists', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo', ['!Which player the wall follows', 'Up next', 'Road Trip 8'], 'grow'),
    state('tall music: a playlist opened', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo', ['Lantern Song 9', 'Shuffle', '58 songs', 'Playlists'], 'grow >> .sp-tile'),
    state('tall music: search in groups', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo', ['Songs', 'Albums', 'Playlists', 'Track 1', 'Album 1', 'Playlist 1'], 'grow >> type:.sp-search input=road'),
    state('tall music: Up next', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo', ['Playing now', 'Spotify sets the order. A click skips ahead to that song.', 'Lantern Song 2'], 'grow >> .mu-places button:nth-child(5)'),
    state('tall music: time bar dragged', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo', ['Lantern Song 1', '3:01', '!1:05'], 'grow >> drag:.sp-seek@2250,606'),
    state('tall music: Play on open', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo', ['Kitchen speaker', 'Phone', 'Computer, playing now', 'A phone or speaker shows here only while its Spotify is awake.'], 'grow >> .sp-dev'),
    state('tall music: Play on, music on a speaker', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&spotifyplay=speaker', ['Speaker, playing now', 'Play on'], 'grow >> .sp-dev'),
    state('tall music: Play on, nothing awake', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&spotify=nodevices&spotifyplay=none&media=none', ['Spotify is closed. The wall starts it.', 'This PC'], 'grow >> .sp-dev'),
    state('tall music: starting Spotify', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&spotify=starting', ['Starting Spotify on this PC', 'plays as soon as it is ready'], 'grow >> .sp-tile >> .sp-shbtns .sp-btn.fill'),
    state('tall music: YouTube Music', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo', ['Open YouTube Music', '!Search Spotify'], '.sp-switch button:nth-child(2) >> grow'),
    state('tall music: long names', 'hz=unwind&at=2026-11-11T10%3A24%3A00-08%3A00&clock=review&weather=ok&long=1&media=long&spotify=long', ['Road Trip 1, an extremely long name', 'Up next'], 'grow'),
    state('tall music: long names, a playlist opened', 'hz=unwind&at=2026-11-11T10%3A24%3A00-08%3A00&clock=review&weather=ok&long=1&media=long&spotify=long', ['240 songs', 'Lantern Song 9, an extremely long name'], 'grow >> .sp-tile'),
    state('tall music pictures: open on Playlists', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo&spotify=picture', ['Road Trip 10', '!Which player the wall follows'], 'grow'),
    state('tall music pictures: a playlist opened', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo&spotify=picture', ['Lantern Song 9', 'Shuffle', 'Playlists'], 'grow >> .sp-tile'),
    state('tall music pictures: search, chips and the All view', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo&spotify=picture', ['Track 6', 'Album 3', 'Playlist 3', '3:00'], 'grow >> type:.sp-search input=night'),
    state('music pictures: search at rest, the All view', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo&spotify=picture', ['Playlist 3', 'See all'], 'type:.sp-search input=night'),
    state('tall music pictures: Up next', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo&spotify=picture', ['Playing now', 'Lantern Song 2'], 'grow >> .mu-places button:nth-child(5)'),
    state('tall music pictures: Play on open', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo&spotify=picture', ['Kitchen speaker', 'Phone'], 'grow >> .sp-dev'),
    state('tall music: Spotify not answering', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&spotify=down', 'Spotify is not answering right now.', 'grow'),
    state('tall music: nothing playing', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&media=none&spotifyplay=none', ['Nothing playing', 'Road Trip 1'], 'grow'),
    state('tall music: a playlist that is not his, tall', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo&spotify=notyours', ["Spotify's public page does not list this playlist. It may be private.", 'Press Play or Shuffle', 'Shuffle', '!Retry'], 'grow >> .sp-tile'),
    state('tall music: a playlist that is not his, at rest', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo&spotify=notyours', ["Spotify's public page does not list this playlist. It may be private.", 'Shuffle', '!Retry', '!While it plays'], '.sp-tile'),
    ],
  },
  fit: {
    variants: [
    { name: TALL_OPEN, q: fitQuery('&audio=demo'), checks: ['.sp-card'], click: 'grow' },
    tallVariant('heavy library', '&spotify=heavy', 'grow'),
    tallVariant('a playlist opened', '&audio=demo', 'grow >> .sp-tile'),
    tallVariant('the songs of a 2000 song playlist', '&spotify=heavy', 'grow >> .sp-tile'),
    tallVariant('search in groups', '&audio=demo', 'grow >> type:.sp-search input=road'),
    tallVariant('YouTube Music, search in groups', '&audio=demo&youtube=in', '.sp-switch button:nth-child(2) >> grow >> type:.sp-search input=road >> key:.yt-search input=Enter'),
    tallVariant('YouTube Music, search, the Playlists chip', '&audio=demo&youtube=in', '.sp-switch button:nth-child(2) >> grow >> type:.sp-search input=road >> key:.yt-search input=Enter >> .mu-chip:nth-child(2)'),
    { name: 'Listen, the resting card, YouTube Music', q: fitQuery('&audio=demo&youtube=in'), checks: ['.sp-card'], click: '.sp-switch button:nth-child(2)', listen: true },
    { name: 'Listen, the resting card, YouTube Music, search', q: fitQuery('&audio=demo&youtube=in'), checks: ['.sp-card'], click: '.sp-switch button:nth-child(2) >> type:.sp-search input=road >> key:.yt-search input=Enter', listen: true },
    { name: 'Listen, the resting card, YouTube Music, search, the Playlists chip', q: fitQuery('&audio=demo&youtube=in'), checks: ['.sp-card'], click: '.sp-switch button:nth-child(2) >> type:.sp-search input=road >> key:.yt-search input=Enter >> .mu-chip:nth-child(2)', listen: true },
    tallVariant('Up next', '&audio=demo', 'grow >> .mu-places button:nth-child(5)'),
    tallVariant('Play on open', '&audio=demo', 'grow >> .sp-dev'),
    tallVariant('Play on, nothing awake', '&spotify=nodevices&spotifyplay=none&media=none', 'grow >> .sp-dev'),
    tallVariant('starting Spotify', '&spotify=starting', 'grow >> .sp-tile >> .sp-shbtns .sp-btn.fill'),
    tallVariant('YouTube Music chosen', '', '.sp-switch button:nth-child(2) >> grow'),
    tallVariant('long names', '&spotify=long&media=long', 'grow'),
    tallVariant('long names, a playlist opened', '&spotify=long&media=long', 'grow >> .sp-tile'),
    tallVariant('nothing playing', '&media=none&spotifyplay=none', 'grow'),
    tallVariant('Spotify not answering', '&spotify=down', 'grow'),
    tallVariant('signed out', '&spotify=signedout', 'grow'),
    { name: REST, q: fitQuery('&audio=demo'), checks: ['.sp-card'], listen: true },
    { name: 'Listen, the resting card, a search: chip row and the All view', q: fitQuery('&audio=demo&spotify=picture'), checks: ['.sp-card'], click: 'type:.sp-search input=night', listen: true },
    { name: 'Listen, the resting card, a search: the Albums chip', q: fitQuery('&audio=demo&spotify=picture'), checks: ['.sp-card'], click: 'type:.sp-search input=night >> .mu-chip:nth-child(3)', listen: true },
    tallVariant('a search: chip row and the All view', '&audio=demo&spotify=picture', 'grow >> type:.sp-search input=night'),
    tallVariant('a search: the Songs chip', '&audio=demo&spotify=picture', 'grow >> type:.sp-search input=night >> .mu-chip:nth-child(4)'),
    { name: 'Listen, the tall view, a playlist that is not his', q: fitQuery('&audio=demo&spotify=notyours'), checks: ['.sp-card'], click: 'grow >> .sp-tile' },
    { name: 'Listen, the resting card, a playlist that is not his', q: fitQuery('&audio=demo&spotify=notyours'), checks: ['.sp-card'], click: '.sp-tile', listen: true },
    { name: 'Sky layers, Listen at night, the tall view open, the moon in open sky', q: fitQuery('&audio=demo', night), checks: ['.sp-card'], click: 'grow', sky: 'moon', moonAt: '760,352,44' },
    ],
    measurements: { tallMusic: measureTallMusic },
    rules: {
      tallMusic: (variant, results, emit) => {
        const m = results.tallMusic;
        if (!m || !m.card || !(m.tall || variant.listen === true)) return false;
        if (variant.name === YT_SEARCH && !m.ytRegion) m.fails.push('listen: YouTube Music search shows no results region');
        for (const failure of m.fails) emit(`  FAIL ${failure}`);
        if (m.fails.length) return true;
        emit(m.tall
          ? '  ok   listen tall: the card is 833 by 624 at 1707, 24 above the bottom row, no text under 16 px, every control 32 px or more, nothing cut or out of the card, the Play on list inside the card'
          : '  ok   listen: the resting card is 800 by 462 with the Play on chip at the right end of the top row, the Play on list inside the card');
        return false;
      },
    },
    breaks: {
      'tall-box': { css: '.sp-card.tall { left: 1523px !important; }', expect: /^ *FAIL listen tall: the card is at x /m, appliesTo: (v) => v.name === TALL_OPEN },
      'tall-foot': { css: '.sp-card.tall { height: 700px !important; }', expect: /^ *FAIL listen tall: the card ends at y \d+, into the bottom row/m, appliesTo: (v) => v.name === TALL_OPEN },
      'tall-small': { css: '.sp-card.tall .sp-tline { font-size: 14px !important; }', expect: /^ *FAIL listen tall: text under 16 px in /m, appliesTo: (v) => v.name === TALL_OPEN },
      'tall-ctl': { css: '.sp-card.tall .sp-pl-btn { width: 24px !important; height: 24px !important; }', expect: /^ *FAIL listen tall: control .* is \d+ by \d+ \(32 at least\)/m, appliesTo: (v) => v.name === TALL_OPEN },
      'tall-clip': { css: '.sp-card.tall .sp-pl-title { flex: 0 0 60px !important; } .sp-card.tall .sp-pl-title b { text-overflow: clip !important; }', expect: /^ *FAIL listen tall: text clipped in /m, appliesTo: (v) => v.name === TALL_OPEN },
      'tall-out': { css: '.sp-card.tall .sp-hx { margin-right: -60px !important; }', expect: /^ *FAIL listen tall: .* sticks out of the card/m, appliesTo: (v) => v.name === TALL_OPEN },
      'tall-rest': { css: '.sp-card { width: 760px !important; }', expect: /^ *FAIL listen: the resting card is \d+ by \d+ \(800 by 462\)/m, appliesTo: (v) => v.name === REST },
      'listen-chip-wide': { css: '.sp-dev { width: 120px !important; }', expect: /^ *FAIL listen: the Play on button is \d+ by \d+, not the size/m, appliesTo: (v) => v.name === REST },
      'tall-pop': { css: '.sp-devices { right: -700px !important; }', expect: /^ *FAIL listen: the Play on list is at /m, appliesTo: (v) => v.name === 'Listen, the tall view, Play on open' },
      'tall-btns': { css: '.sp-shbtns .sp-btn { flex: none !important; padding: 0 34px !important; }', expect: /^ *FAIL listen tall: .* runs past its column by \d+ px/m, appliesTo: (v) => v.name === 'Listen, the tall view, a playlist opened' },
      // A moon forced into the open view is not drawn at all (the card claims its box), so the night check finds none.
      'tall-hscroll': { css: '.sp-scroll .mu-row { margin-right: -12px !important; }', expect: /^ *FAIL listen: sp-scroll scrolls sideways/m, appliesTo: (v) => v.name === 'Listen, the tall view, search in groups' },
      'tall-ring': { css: '.sp-card.tall .sp-scroll { padding-right: 0 !important; margin-right: 0 !important; }', expect: /^ *FAIL listen: the hover ring of tile \d+ is cut/m, appliesTo: (v) => v.name === 'Listen, the tall view, search in groups' },
      'chip-ring': { css: '.mu-chips { padding: 0 !important; }', expect: /^ *FAIL listen: the focus ring of the first chip is cut/m, appliesTo: (v) => v.name === 'Listen, the resting card, a search: chip row and the All view' },
      'lib-row': { css: '.mu-places button { padding: 0 40px !important; }', expect: /^ *FAIL listen: the Library row does not fit the card/m, appliesTo: (v) => v.name === REST },
      'yt-search-enter': { css: '[aria-label="Search results"] { display: none !important; }', expect: /^ *FAIL listen: YouTube Music search shows no results region/m, appliesTo: (v) => v.name === YT_SEARCH },
      'tall-moon': { query: '&skymoon=2200,300,44', expect: /^ *FAIL sky layers: no moon drawn at night/m, appliesTo: (v) => v.name === 'Sky layers, Listen at night, the tall view open, the moon in open sky' },
    },
  },
};
