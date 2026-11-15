// The YouTube library in the music card (vote L2, option A): gallery states for every state the card
// shows, fit variants with one browser measurement and its rule, and a deliberate break for each rule.
// Everything this area needs lives here; nothing is registered in the two big review scripts.

const night = encodeURIComponent('2026-11-11T22:30:00-08:00');
const day = '2026-11-11T10:24:00-08:00';
const SWITCH = '.sp-switch button:nth-child(2)';
const TALL = '.sp-grow';
const TILE = '.yt-tile';
const LIKED = '.sp-tabs button:nth-child(2)';
const base = (extra) => `hz=unwind&at=${night}&clock=review&weather=ok&audio=demo&${extra}`;
const lib = (knob, extra = '') => base(`youtube=in&ytlib=${knob}${extra}`);
const state = (name, query, expect, actions) => ({ screen: 'unwind', name: `youtube library: ${name}`, query, custom: true, expect, actions });
const steps = (...s) => s.join(' >> ');

const NAMES = ['Night Drive', 'Rainy Window', '41 videos', 'Liked'];

/**
 * Runs in the page (it references nothing outside its own body). The YouTube side of the music card.
 * At rest the library is 800 by 462 at wall 1740, 24; tall it is 833 by 624 at 1707, 24 above y 648. Playlists
 * are 16:9 tiles, four columns at rest (176 by 99) and five tall; no text under 16 px; every button and the
 * field at least 32 px each way; nothing outside the card, no two of tabs, field, grid, left column and rows
 * overlapping, and a long title ending in an ellipsis inside its box; rows are not play targets (no button, no
 * pointer cursor). Where the library cannot show, the remote and the line under it end above wall y 486.
 */
function measureYoutubeLibrary() {
  const fails = [];
  const cardEl = document.querySelector('.sp-card');
  if (!cardEl || !cardEl.classList.contains('yt')) return { yt: false, fails };
  const st = document.createElement('style');
  st.textContent = '.sp-card { transition: none !important; } .sp-songs { animation: none !important; }';
  document.head.appendChild(st);
  const card = cardEl.getBoundingClientRect();
  const tall = cardEl.getAttribute('data-tall') === 'true';
  const libEl = cardEl.querySelector('.yt-lib');
  const hintEl = cardEl.querySelector('.yt-hint');
  const r0 = (n) => Math.round(n * 10) / 10;
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const name = (e) => String((e.className && e.className.baseVal) || e.className || e.tagName);
  const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  if (libEl) {
    if (tall) {
      if (!near(card.left, 1707, 1.5) || !near(card.top, 24, 1.5) || !near(card.width, 833, 1.5) || !near(card.height, 624, 1.5)) fails.push('the tall card is at x ' + r0(card.left) + ', y ' + r0(card.top) + ', ' + r0(card.width) + ' by ' + r0(card.height) + ' (833 by 624 at 1707, 24)');
      if (card.bottom > 648.5) fails.push('the tall card ends at y ' + r0(card.bottom) + ', into the bottom row (648 at most)');
    } else if (!near(card.left, 1740, 1.5) || !near(card.top, 24, 1.5) || !near(card.width, 800, 1.5) || !near(card.height, 462, 1.5)) {
      fails.push('the resting card is at x ' + r0(card.left) + ', y ' + r0(card.top) + ', ' + r0(card.width) + ' by ' + r0(card.height) + ' (800 by 462 at 1740, 24)');
    }
    // Tiles: four columns of 176 by 99 at rest, five tall, always 16:9.
    const covers = [...libEl.querySelectorAll('.yt-tile .yt-cover')].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0);
    if (covers.length) {
      const lefts = new Set(covers.map((b) => Math.round(b.left)));
      const cols = lefts.size;
      if (cols !== (tall ? 5 : 4) && covers.length >= (tall ? 5 : 4)) fails.push('the grid has ' + cols + ' columns (' + (tall ? 5 : 4) + ' ' + (tall ? 'tall' : 'at rest') + ')');
      for (const b of covers.slice(0, 12)) {
        if (!tall && (!near(b.width, 176, 2) || !near(b.height, 99, 2))) { fails.push('a tile picture is ' + r0(b.width) + ' by ' + r0(b.height) + ' (176 by 99 at rest)'); break; }
        if (Math.abs(b.width / b.height - 16 / 9) > 0.04) { fails.push('a tile picture is ' + r0(b.width) + ' by ' + r0(b.height) + ', not 16:9'); break; }
      }
    }
  }
  // No text under 16 px anywhere in the card (the small "not set up" tag of today's switch aside).
  const small = [...cardEl.querySelectorAll('*')].filter((e) => !e.closest('.sp-off') && [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 15.99);
  for (const e of small.slice(0, 3)) fails.push('text under 16 px in ' + name(e) + ' "' + (e.textContent || '').trim().slice(0, 24) + '" (' + getComputedStyle(e).fontSize + ')');
  // Every button and the search field 32 px or more each way.
  for (const e of cardEl.querySelectorAll('button, input')) {
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const box = e.tagName === 'INPUT' ? e.closest('.sp-search')?.getBoundingClientRect() ?? r : r;
    if (box.width < 31.5 || box.height < 31.5) fails.push('control ' + name(e) + ' "' + (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 20) + '" is ' + r0(box.width) + ' by ' + r0(box.height) + ' (32 at least)');
  }
  if (libEl) {
    // Nothing outside the card.
    for (const e of libEl.querySelectorAll('*')) {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || e.closest('svg') || e.tagName === 'svg' || e.closest('.yt-scroll') && !e.closest('.yt-grid, .yt-list, .yt-state, .yt-cap, .yt-rows-skel')) continue;
      if (e.closest('.yt-scroll')) {
        const sc = e.closest('.yt-scroll').getBoundingClientRect();
        const cut = { left: Math.max(r.left, sc.left), right: Math.min(r.right, sc.right), top: Math.max(r.top, sc.top), bottom: Math.min(r.bottom, sc.bottom) };
        if (cut.right <= cut.left || cut.bottom <= cut.top) continue;
        if (cut.left < card.left - 0.5 || cut.right > card.right + 0.5 || cut.top < card.top - 0.5 || cut.bottom > card.bottom + 0.5) fails.push(name(e) + ' sticks out of the card');
        continue;
      }
      if (r.left < card.left - 0.5 || r.right > card.right + 0.5 || r.top < card.top - 0.5 || r.bottom > card.bottom + 0.5) fails.push(name(e) + ' sticks out of the card');
    }
    // No two of tabs, field, grid, left column and rows overlap.
    const parts = [['the tabs', '.yt-bar .sp-tabs'], ['the field', '.yt-bar .sp-search'], ['the grid', '.yt-grid'], ['the left column', '.yt-songs .sp-shead'], ['the rows', '.yt-rowscroll']];
    const boxes = parts.map(([label, sel]) => [label, libEl.querySelector(sel)?.getBoundingClientRect()]).filter(([, b]) => b && b.width > 0);
    for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i][1], b = boxes[j][1];
      // The scroller reaches 5 px past its content (room for a focus ring): compare what it holds.
      const inner = (x, label) => (label === 'the rows' ? { left: x.left + 5, right: x.right - 5, top: x.top + 5, bottom: x.bottom } : x);
      if (hit(inner(a, boxes[i][0]), inner(b, boxes[j][0]))) fails.push(boxes[i][0] + ' and ' + boxes[j][0] + ' overlap');
    }
    // A long title, channel or name ends in an ellipsis inside its box.
    for (const e of libEl.querySelectorAll('.yt-title, .yt-chan, .sp-tname2, .sp-name, .yt-count, .yt-resultsfor, .sp-backlabel')) {
      const cs = getComputedStyle(e);
      if (e.scrollWidth > e.clientWidth + 1 && (cs.textOverflow !== 'ellipsis' || cs.overflowX === 'visible')) { fails.push('text clipped in ' + name(e) + ' "' + (e.textContent || '').trim().slice(0, 24) + '" with no ellipsis'); break; }
    }
    // Rows are not play targets: no button inside, and no pointer cursor on a row or anything in it.
    for (const row of libEl.querySelectorAll('.yt-row')) {
      if (row.querySelector('button, [role="button"], a, input')) { fails.push('a row holds a button, a link or a field'); break; }
      if ([row, ...row.querySelectorAll('*')].some((e) => getComputedStyle(e).cursor === 'pointer')) { fails.push('a row shows a pointer cursor'); break; }
    }
  }
  // Where the library cannot show: the remote and the line under it end above wall y 486.
  const hint = hintEl?.getBoundingClientRect();
  return { yt: true, tall, lib: !!libEl, hint: hint ? { bottom: r0(hint.bottom), top: r0(hint.top) } : null, cardBottom: r0(card.bottom), fails };
}

const fitQuery = (extra, when = day) => `?hz=unwind&at=${when}&long=1&agents=3&${extra}`;
const variant = (name, extra, click, more = {}) => ({ name: `YouTube library, ${name}`, q: fitQuery(extra), checks: ['.sp-card', '.yt-lib'], click, ...more });
const REST = 'YouTube library, at rest, Playlists';
const TALL_OPEN = 'YouTube library, tall, a playlist opened';
const TALL_PL = 'YouTube library, tall, Playlists';
const LONG = 'YouTube library, tall, long names, a playlist opened';
const NOTSET = 'YouTube library, not set up: the remote and its line';
const OUT = 'YouTube library, signed out: the remote and its line';

export default {
  name: 'youtube-library',
  gallery: {
    states: [
      state('rest, Playlists', lib('full'), NAMES.concat(['Playlists', 'Liked', '!Open YouTube Music']), SWITCH),
      state('rest, a few playlists', lib('few'), ['Night Drive', 'Rainy Window', '!Neon Coast'], SWITCH),
      state('rest, Liked', lib('full'), ['Cassette Rain', 'Only on YouTube', 'Aurora Set'], steps(SWITCH, LIKED)),
      state('rest, a playlist opened', lib('full'), ['Refresh', 'Read at', 'Glass Harbor', 'Only on YouTube', 'Private', 'Removed', 'Night Drive', '41 videos'], steps(SWITCH, TILE)),
      state('rest, search results', lib('full', '&ytsearch=night'), ['Results for', 'Back to Playlists', 'Glass Harbor', 'Mira Vale'], SWITCH),
      state('tall, Playlists', lib('full'), NAMES.concat(['Static Bloom Sessions']), steps(SWITCH, TALL)),
      state('tall, a playlist opened', lib('full'), ['Refresh', 'Read at', 'Playlist', 'Night Drive', '41 videos', 'Glass Harbor', 'Mira Vale', 'Liked'], steps(SWITCH, TALL, TILE)),
      state('tall, Liked', lib('full'), ['Cassette Rain', 'Only on YouTube', 'Liked'], steps(SWITCH, TALL, LIKED)),
      state('tall, search results', lib('full', '&ytsearch=night'), ['Results for', 'Back to Playlists', 'Glass Harbor'], steps(SWITCH, TALL)),
      state('12 searches left', lib('low'), ['12 searches left today', 'Night Drive'], SWITCH),
      state('no searches left', lib('spent'), ['Searches are used up until midnight Pacific', 'Night Drive', 'Playlists', 'Liked'], SWITCH),
      state('empty, Playlists', lib('empty'), ['No playlists yet'], SWITCH),
      state('empty, Liked', lib('empty'), ['No liked videos yet'], steps(SWITCH, LIKED)),
      state('empty, search', lib('full', '&ytsearch=nothing'), ['Nothing found. Try other words.', 'Back to Playlists'], SWITCH),
      state('loading', lib('slow'), ['Liked', '!Night Drive', '!No playlists yet'], SWITCH),
      state('not answering', lib('down'), ['YouTube is not answering.', 'Retry'], SWITCH),
      state('busy', lib('busy'), ['YouTube is busy. Try again in a minute.', 'Retry'], SWITCH),
      state('sign in again', lib('again'), ['YouTube needs a new sign-in.', 'Open Tools'], SWITCH),
      state('a playlist that is gone', lib('gone'), ['This playlist is gone.', 'Back'], steps(SWITCH, TILE)),
      state('long names, tall', lib('long'), ['2,000 videos', 'Liked'], steps(SWITCH, TALL)),
      state('long names, a playlist opened', lib('long'), ['2,000 videos', 'Refresh', 'Read at'], steps(SWITCH, TALL, TILE)),
      state('a row’s hover card', lib('full'), ['The owner of this video allows it to play only on YouTube.', 'Afterglow Avenue'], steps(SWITCH, TILE, 'hover:.yt-row:nth-child(5)')),
      state('not set up: the remote and its line', base('youtube=off'), ['Set up YouTube in Tools to see your playlists here. About ten minutes, once.', 'Open Tools', 'Open YouTube Music'], SWITCH),
      state('signed out: the remote and its line', base('youtube=out'), ['Sign in to YouTube in Tools to see your playlists here.', 'Open Tools', 'Open YouTube Music'], SWITCH),
    ],
  },
  fit: {
    variants: [
      variant('at rest, Playlists', 'youtube=in&ytlib=full', '.sp-switch button:nth-child(2)', { listen: true }),
      variant('at rest, a few playlists', 'youtube=in&ytlib=few', '.sp-switch button:nth-child(2)', { listen: true }),
      variant('at rest, Liked', 'youtube=in&ytlib=full', `${SWITCH} >> ${LIKED}`, { listen: true }),
      variant('at rest, a playlist opened', 'youtube=in&ytlib=full', `${SWITCH} >> ${TILE}`, { listen: true }),
      variant('at rest, search results', 'youtube=in&ytlib=full&ytsearch=night', SWITCH, { listen: true }),
      variant('at rest, 12 searches left', 'youtube=in&ytlib=low', SWITCH, { listen: true }),
      variant('at rest, no searches left', 'youtube=in&ytlib=spent', SWITCH, { listen: true }),
      variant('at rest, not answering', 'youtube=in&ytlib=down', SWITCH, { listen: true }),
      variant('at rest, a playlist that is gone', 'youtube=in&ytlib=gone', `${SWITCH} >> ${TILE}`, { listen: true }),
      variant('at rest, long names, a playlist opened', 'youtube=in&ytlib=long', `${SWITCH} >> ${TILE}`, { listen: true }),
      { name: TALL_PL, q: fitQuery('youtube=in&ytlib=full'), checks: ['.sp-card', '.yt-lib'], click: `${SWITCH} >> ${TALL}` },
      { name: TALL_OPEN, q: fitQuery('youtube=in&ytlib=full'), checks: ['.sp-card', '.yt-lib'], click: `${SWITCH} >> ${TALL} >> ${TILE}` },
      variant('tall, Liked', 'youtube=in&ytlib=full', `${SWITCH} >> ${TALL} >> ${LIKED}`),
      variant('tall, search results', 'youtube=in&ytlib=full&ytsearch=night', `${SWITCH} >> ${TALL}`),
      variant('tall, long names', 'youtube=in&ytlib=long', `${SWITCH} >> ${TALL}`),
      { name: LONG, q: fitQuery('youtube=in&ytlib=long'), checks: ['.sp-card', '.yt-lib'], click: `${SWITCH} >> ${TALL} >> ${TILE}` },
      variant('tall, empty', 'youtube=in&ytlib=empty', `${SWITCH} >> ${TALL}`),
      { name: NOTSET, q: fitQuery('youtube=off'), checks: ['.sp-card', '.yt-hint'], click: SWITCH, listen: true },
      { name: OUT, q: fitQuery('youtube=out'), checks: ['.sp-card', '.yt-hint'], click: SWITCH, listen: true },
    ],
    measurements: { youtubeLibrary: measureYoutubeLibrary },
    rules: {
      youtubeLibrary: (variant, results, emit) => {
        const m = results.youtubeLibrary;
        if (!variant.name.startsWith('YouTube library, ') || !m || !m.yt) return false;
        const fails = m.fails.slice();
        if (variant.name === NOTSET || variant.name === OUT) {
          if (!m.hint) fails.push('the line under the remote is not there');
          else if (m.hint.bottom > 486.5 || m.cardBottom > 486.5) fails.push('the remote and its line end at y ' + Math.max(m.hint.bottom, m.cardBottom) + ' (486 at most)');
        } else if (!m.lib) fails.push('the library is not shown');
        for (const failure of fails) emit(`  FAIL youtube library: ${failure}`);
        if (fails.length) return true;
        emit(m.lib
          ? `  ok   youtube library: the ${m.tall ? 'tall card is 833 by 624 at 1707, 24' : 'resting card is 800 by 462 at 1740, 24'}, tiles 16:9${m.tall ? '' : ' (176 by 99, four columns)'}, no text under 16 px, every button and the field 32 px or more, nothing outside the card or overlapping, long names end in an ellipsis, rows are not play targets`
          : '  ok   youtube library: the remote and the line under it end above wall y 486, no text under 16 px, every button 32 px or more');
        return false;
      },
    },
    breaks: {
      'yt-rest-height': { css: '.sp-card.yt:has(.yt-lib) { height: 500px !important; }', expect: /^ *FAIL youtube library: the resting card is at /m, appliesTo: (v) => v.name === REST },
      'yt-tall-width': { css: '.sp-card.tall { width: 900px !important; }', expect: /^ *FAIL youtube library: the tall card is at /m, appliesTo: (v) => v.name === TALL_PL },
      'yt-columns': { css: '.yt-grid { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }', expect: /^ *FAIL youtube library: (the grid has \d+ columns|a tile picture is )/m, appliesTo: (v) => v.name === REST },
      'yt-small': { css: '.yt-tile .yt-count { font-size: 14px !important; }', expect: /^ *FAIL youtube library: text under 16 px in /m, appliesTo: (v) => v.name === REST },
      'yt-button': { css: '.yt-refresh { height: 24px !important; }', expect: /^ *FAIL youtube library: control .* is \d+(\.\d)? by \d+(\.\d)? \(32 at least\)/m, appliesTo: (v) => v.name === TALL_OPEN },
      'yt-clip': { css: '.yt-row .yt-title { overflow: visible !important; text-overflow: clip !important; }', expect: /^ *FAIL youtube library: text clipped in /m, appliesTo: (v) => v.name === LONG },
      'yt-pointer': { css: '.yt-row { cursor: pointer !important; }', expect: /^ *FAIL youtube library: a row shows a pointer cursor/m, appliesTo: (v) => v.name === TALL_OPEN },
      'yt-overlap': { css: '.yt-songs.tall .yt-rowscroll { margin-left: -300px !important; }', expect: /^ *FAIL youtube library: the left column and the rows overlap/m, appliesTo: (v) => v.name === TALL_OPEN },
      'yt-hint-tall': { css: '.yt-hint { height: 240px !important; }', expect: /^ *FAIL youtube library: the remote and its line end at y /m, appliesTo: (v) => v.name === NOTSET },
    },
  },
};
