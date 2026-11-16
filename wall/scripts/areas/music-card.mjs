// The music card's tall view (the round button opens it into the right third of the wall) and "Play on": its gallery
// states, fit variants, one browser measurement with its rule, and the deliberate breaks. Moved here from the two big
// review scripts; nothing is registered there for it.

/**
 * Runs in the page (it references nothing outside its own body). The tall view: 833 by 624 at wall 1707, 24, above the bottom
 * row, no text under 16 px, every control 32 px or more, nothing cut or out of the card, Play and Shuffle inside their column.
 * At rest (on a Listen state that asks for it): 800 by 462, the Play on chip and the round button on one line, the chooser
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
    // The tall view: the right third, 833 by 624 at wall 1707, 24, ending above the bottom row (Screens off and the office lights slot).
    const near = (a, b) => Math.abs(a - b) <= 1.5;
    if (!near(card.left, 1707) || !near(card.top, 24) || !near(card.width, 833) || !near(card.height, 624)) fails.push('listen tall: the card is at x ' + Math.round(card.left) + ' to ' + Math.round(card.right) + ', y ' + Math.round(card.top) + ' to ' + Math.round(card.bottom) + ' (833 by 624 at 1707, 24)');
    if (card.bottom > 648.5) fails.push('listen tall: the card ends at y ' + Math.round(card.bottom) + ', into the bottom row (648 at most)');
    if (card.left < 0 || card.right > 2540.5 || card.top < 0 || card.bottom > 720) fails.push('listen tall: the card leaves the wall: x ' + Math.round(card.left) + ' to ' + Math.round(card.right) + ', y ' + Math.round(card.top) + ' to ' + Math.round(card.bottom));
    for (const [name, el] of [['Screens off', document.querySelector('.u-corner')], ['the office lights slot', document.querySelector('[data-slot="office-lights"]')]]) {
      const r = el?.getBoundingClientRect();
      if (r && r.width > 0 && hit(card, r)) fails.push('listen tall: the card covers ' + name);
    }
    const name = (e) => (e.className?.baseVal ?? e.className ?? e.tagName) || e.tagName;
    // No text under 16 px (the small "not set up" tag of today's switch aside).
    const small = [...cardEl.querySelectorAll('*')].filter((e) => !e.closest('.sp-off') && [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 15.99);
    for (const e of small.slice(0, 3)) fails.push('listen tall: text under 16 px in ' + name(e) + ' "' + (e.textContent || '').trim().slice(0, 24) + '" (' + getComputedStyle(e).fontSize + ')');
    // Controls at least 32 px each way (the time bar's track is thin: its grab area, the ::before, is what counts).
    for (const e of cardEl.querySelectorAll('button, input, [role="slider"]')) {
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
  // At rest the card is today's 800 by 462 (YouTube Music's own height aside), with the Play on chip and the round button on one line.
  if (card && !tall && !cardEl.classList.contains('yt') && (Math.abs(card.width - 800) > 1.5 || Math.abs(card.height - 462) > 1.5)) fails.push('listen: the resting card is ' + Math.round(card.width) + ' by ' + Math.round(card.height) + ' (800 by 462)');
  const chipEl = cardEl?.querySelector('.sp-dev');
  const growEl = cardEl?.querySelector('.sp-grow');
  if (cardEl && !growEl) fails.push('listen: the round button that opens the tall view is not there');
  if (chipEl && growEl) {
    const a = chipEl.getBoundingClientRect(), b = growEl.getBoundingClientRect();
    if (Math.abs(a.top + a.height / 2 - (b.top + b.height / 2)) > 2 || a.right > b.left - 4) fails.push('listen: the Play on chip and the round button are not on one line, apart');
  }
  if (chipEl && growEl) {
    const a = chipEl.getBoundingClientRect(), b = growEl.getBoundingClientRect();
    if (Math.abs(a.width - b.width) > 1 || Math.abs(a.height - b.height) > 1) fails.push('listen: the Play on button is ' + Math.round(a.width) + ' by ' + Math.round(a.height) + ', not the size of the round expand button (' + Math.round(b.width) + ' by ' + Math.round(b.height) + ')');
    if (b.left - a.right > 12) fails.push('listen: the Play on button is ' + Math.round(b.left - a.right) + ' px from the round expand button (12 or less)');
  }
  const pop = cardEl?.querySelector('.sp-devices')?.getBoundingClientRect();
  if (pop && card && (pop.left < 0 || pop.top < 0 || pop.right > 2560 || pop.bottom > 720 || pop.left < card.left - 0.5 || pop.right > card.right + 0.5 || pop.bottom > card.bottom + 0.5 || pop.top < card.top - 0.5)) fails.push('listen: the Play on list is at x ' + Math.round(pop.left) + ' to ' + Math.round(pop.right) + ', y ' + Math.round(pop.top) + ' to ' + Math.round(pop.bottom) + ', outside the wall or the card');
  return { card: true, tall, fails };
}

const at = '2026-11-11T10:24:00-08:00';
const night = '2026-11-11T22:30:00-08:00';
const fitQuery = (extra, when = at) => `?hz=unwind&at=${when}&long=1&agents=3${extra}`;
const tallVariant = (name, extra, click) => ({ name: `Listen, the tall view, ${name}`, q: fitQuery(extra), checks: ['.sp-card'], click });
const TALL_OPEN = 'Listen, the tall view open on Playlists';
const REST = 'Listen, the resting card with Play on';
const state = (name, query, expect, actions) => ({ screen: 'unwind', name, query, custom: true, expect, actions });
export default {
  name: 'music-card',
  gallery: {
    states: [
    state('tall music: button under the pointer', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo', ['!Which player the wall follows', 'Road Trip 1'], 'hover:.sp-grow'),
    state('tall music: open on Playlists', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo', ['!Which player the wall follows', 'Up next', 'Road Trip 8'], '.sp-grow'),
    state('tall music: a playlist opened', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo', ['Lantern Song 9', 'Shuffle', '58 songs', 'Playlists'], '.sp-grow >> .sp-tile'),
    state('tall music: search in groups', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo', ['Songs', 'Albums', 'Playlists', 'Track 1', 'Album 1', 'Playlist 1'], '.sp-grow >> type:.sp-search input=road'),
    state('tall music: Up next', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo', ['Playing now', 'Spotify sets the order. A click skips ahead to that song.', 'Lantern Song 2'], '.sp-grow >> .sp-tabs button:nth-child(5)'),
    state('tall music: time bar dragged', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo', ['Lantern Song 1', '3:01', '!1:05'], '.sp-grow >> drag:.sp-seek@2250,606'),
    state('tall music: Play on open', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo', ['Kitchen speaker', 'Phone', 'Computer, playing now', 'A phone or speaker shows here only while its Spotify is awake.'], '.sp-grow >> .sp-dev'),
    state('tall music: Play on, music on a speaker', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&spotifyplay=speaker', ['Speaker, playing now', 'Play on'], '.sp-grow >> .sp-dev'),
    state('tall music: Play on, nothing awake', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&spotify=nodevices&spotifyplay=none&media=none', ['Spotify is closed. The wall starts it.', 'This PC'], '.sp-grow >> .sp-dev'),
    state('tall music: starting Spotify', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&spotify=starting', ['Starting Spotify on this PC', 'plays as soon as it is ready'], '.sp-grow >> .sp-tile >> .sp-shbtns .sp-btn.fill'),
    state('tall music: YouTube Music', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo', ['Open YouTube Music', '!Search Spotify'], '.sp-switch button:nth-child(2) >> .sp-grow'),
    state('tall music: long names', 'hz=unwind&at=2026-11-11T10%3A24%3A00-08%3A00&clock=review&weather=ok&long=1&media=long&spotify=long', ['Road Trip 1, an extremely long name', 'Up next'], '.sp-grow'),
    state('tall music: long names, a playlist opened', 'hz=unwind&at=2026-11-11T10%3A24%3A00-08%3A00&clock=review&weather=ok&long=1&media=long&spotify=long', ['240 songs', 'Lantern Song 9, an extremely long name'], '.sp-grow >> .sp-tile'),
    state('tall music pictures: open on Playlists', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo&spotify=picture', ['Road Trip 10', '!Which player the wall follows'], '.sp-grow'),
    state('tall music pictures: a playlist opened', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo&spotify=picture', ['Lantern Song 9', 'Shuffle', 'Playlists'], '.sp-grow >> .sp-tile'),
    state('tall music pictures: search in groups', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo&spotify=picture', ['Track 6', 'Album 3', 'Playlist 3', '3:00'], '.sp-grow >> type:.sp-search input=night'),
    state('tall music pictures: Up next', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo&spotify=picture', ['Playing now', 'Lantern Song 2'], '.sp-grow >> .sp-tabs button:nth-child(5)'),
    state('tall music pictures: Play on open', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo&spotify=picture', ['Kitchen speaker', 'Phone'], '.sp-grow >> .sp-dev'),
    state('tall music: Spotify not answering', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&spotify=down', 'Spotify is not answering right now.', '.sp-grow'),
    state('tall music: nothing playing', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&media=none&spotifyplay=none', ['Nothing playing', 'Road Trip 1'], '.sp-grow'),
    state('tall music: a playlist that is not his, tall', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo&spotify=notyours', ["Spotify's public page does not list this playlist. It may be private.", 'Press Play or Shuffle', 'Shuffle', '!Retry'], '.sp-grow >> .sp-tile'),
    state('tall music: a playlist that is not his, at rest', 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&audio=demo&spotify=notyours', ["Spotify's public page does not list this playlist. It may be private.", 'Shuffle', '!Retry', '!Heard from this playlist'], '.sp-tile'),
    ],
  },
  fit: {
    variants: [
    { name: TALL_OPEN, q: fitQuery('&audio=demo'), checks: ['.sp-card'], click: '.sp-grow' },
    tallVariant('heavy library', '&spotify=heavy', '.sp-grow'),
    tallVariant('a playlist opened', '&audio=demo', '.sp-grow >> .sp-tile'),
    tallVariant('the songs of a 2000 song playlist', '&spotify=heavy', '.sp-grow >> .sp-tile'),
    tallVariant('search in groups', '&audio=demo', '.sp-grow >> type:.sp-search input=road'),
    tallVariant('Up next', '&audio=demo', '.sp-grow >> .sp-tabs button:nth-child(5)'),
    tallVariant('Play on open', '&audio=demo', '.sp-grow >> .sp-dev'),
    tallVariant('Play on, nothing awake', '&spotify=nodevices&spotifyplay=none&media=none', '.sp-grow >> .sp-dev'),
    tallVariant('starting Spotify', '&spotify=starting', '.sp-grow >> .sp-tile >> .sp-shbtns .sp-btn.fill'),
    tallVariant('YouTube Music chosen', '', '.sp-switch button:nth-child(2) >> .sp-grow'),
    tallVariant('long names', '&spotify=long&media=long', '.sp-grow'),
    tallVariant('long names, a playlist opened', '&spotify=long&media=long', '.sp-grow >> .sp-tile'),
    tallVariant('nothing playing', '&media=none&spotifyplay=none', '.sp-grow'),
    tallVariant('Spotify not answering', '&spotify=down', '.sp-grow'),
    tallVariant('signed out', '&spotify=signedout', '.sp-grow'),
    { name: REST, q: fitQuery('&audio=demo'), checks: ['.sp-card'], listen: true },
    { name: 'Listen, the tall view, a playlist that is not his', q: fitQuery('&audio=demo&spotify=notyours'), checks: ['.sp-card'], click: '.sp-grow >> .sp-tile' },
    { name: 'Listen, the resting card, a playlist that is not his', q: fitQuery('&audio=demo&spotify=notyours'), checks: ['.sp-card'], click: '.sp-tile', listen: true },
    { name: 'Sky layers, Listen at night, the tall view open, the moon in open sky', q: fitQuery('&audio=demo', night), checks: ['.sp-card'], click: '.sp-grow', sky: 'moon', moonAt: '760,352,44' },
    ],
    measurements: { tallMusic: measureTallMusic },
    rules: {
      tallMusic: (variant, results, emit) => {
        const m = results.tallMusic;
        if (!m || !m.card || !(m.tall || variant.listen === true)) return false;
        for (const failure of m.fails) emit(`  FAIL ${failure}`);
        if (m.fails.length) return true;
        emit(m.tall
          ? '  ok   listen tall: the card is 833 by 624 at 1707, 24 above the bottom row, no text under 16 px, every control 32 px or more, nothing cut or out of the card, the Play on list inside the card'
          : '  ok   listen: the resting card is 800 by 462 with the Play on chip and the round button on one line, the Play on list inside the card');
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
      'tall-moon': { query: '&skymoon=2200,300,44', expect: /^ *FAIL sky layers: no moon drawn at night/m, appliesTo: (v) => v.name === 'Sky layers, Listen at night, the tall view open, the moon in open sky' },
    },
  },
};
