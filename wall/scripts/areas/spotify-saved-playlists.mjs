// Playlists the owner saved but did not make: the source tag over the songs read from Spotify's public page, the "while it
// plays" view (section headings and rows), and the buttons that turn the public page off and on. Gallery states, fit variants, one browser
// measurement with its rules, and the deliberate breaks live here; the two big review scripts are not edited for it.
// Every state comes from the `spotify=notyours` and `spotifypage=`, `spotifyctx=`, `spotifypageoff=1` knobs of the development mocks.

/**
 * Runs in the page (it references nothing outside its own body). Boxes and font sizes of the saved playlist page's new parts
 * and of the Tools block, as plain numbers, so the rules (which run in the script) do the arithmetic.
 */
function measureSaved() {
  // Transitions off first, so the boxes measured (here and by the shared checks after) are the ones the card settles on.
  const st = document.createElement('style');
  st.textContent = '.sp-card { transition: none !important; }';
  document.head.appendChild(st);
  const q = (s) => document.querySelector(s);
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
  };
  const fonts = (root, label, out) => {
    if (!root) return;
    for (const e of [root, ...root.querySelectorAll('*')]) {
      if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const px = parseFloat(cs.fontSize);
      if (px < 15.99) out.push(label + ': "' + e.textContent.trim().slice(0, 28) + '" is ' + px + ' px');
    }
  };
  const small = [];
  const songs = q('.sp-songs');
  const tag = q('.sp-source');
  const secs = [...document.querySelectorAll('.sp-sec')];
  fonts(tag, 'tag', small);
  fonts(q('.sp-songs .sp-empty .sp-hintline'), 'line', small);
  for (const s of secs) fonts(s, 'heading', small);
    return {
    songs: !!songs,
    head: box(q('.sp-songs .sp-shead')),
    tracks: box(q('.sp-songs .sp-tracks')),
    tag: box(tag),
    tagCut: !!tag && tag.scrollWidth > tag.clientWidth + 1,
    secs: secs.map(box),
    rows: [...document.querySelectorAll('.sp-songs .sp-track')].map(box),
    turnOff: box(q('.sp-songs .sp-linkbtn')),
    turnOn: box(q('.sp-songs .sp-empty .sp-btn')),
    // The off line's sentence about the terms, and whether it is cut.
    terms: (() => {
      const e = [...document.querySelectorAll('.sp-songs .sp-hintline')].find((x) => x.textContent.includes('developer terms'));
      return e ? { ...box(e), cut: e.scrollWidth > e.clientWidth + 1, font: parseFloat(getComputedStyle(e).fontSize) } : null;
    })(),
    // Rows between the Up next heading and the Heard heading, and the line for the rest of the queue.
    nextRows: secs.length === 3 ? [...document.querySelectorAll('.sp-songs .sp-track')].filter((r) => r.getBoundingClientRect().top > secs[1].getBoundingClientRect().top && r.getBoundingClientRect().top < secs[2].getBoundingClientRect().top).length : -1,
    moreLine: [...document.querySelectorAll('.sp-songs .sp-source')].some((x) => /more in Up next/.test(x.textContent) && x.getBoundingClientRect().height > 0),
    small,
  };
}

const at = '2026-11-11T10:24:00-08:00';
const night = '2026-11-11T22%3A30%3A00-08%3A00';
const base = `hz=unwind&at=${night}&clock=review&weather=ok&audio=demo&spotify=notyours`;
// Small card: `listen=1` makes the page stop the songs view's slide-in, so the boxes measured are the ones it settles on (as the shared
// Listen variants do). Tall card: that switch also turns on the Listen rules, which hold the resting card, so a pointer on the card is
// stood in for first instead (it turns the card's transitions off), then the card is opened.
const fitQuery = (extra, tall) => `?hz=unwind&at=${at}&long=1&agents=3&audio=demo${tall ? '' : '&listen=1'}&spotify=notyours${extra}`;
const SMALL_CLICK = '.sp-tile';
const TALL_CLICK = '.sp-grow >> .sp-tile';

const state = (name, extra, expect, actions) => ({ screen: 'unwind', name: `saved playlists: ${name}`, query: `${base}${extra}`, custom: true, expect, actions });

const PRIVATE = "Spotify's public page does not list this playlist. It may be private.";
const WHILE_PLAYS = 'Press Play or Shuffle: while it plays, this page shows the song playing, what comes next and what you have heard.';

const PAGE_SMALL = 'Saved playlist, the public page list, small card';
const PAGE_TALL = 'Saved playlist, the public page list, tall card';
const WHILE_SMALL = 'Saved playlist, while it plays, small card';
const WHILE_TALL = 'Saved playlist, while it plays, tall card';
const OFF_SMALL = 'Saved playlist, the page turned off, small card';
const OFF_TALL = 'Saved playlist, the page turned off, tall card';
const FAIL_SMALL = 'Saved playlist, the page not public, small card';
const HEAVY = 'Saved playlist, while it plays, 20 queued and 50 heard';
const HEAVY_LONG = 'Saved playlist, while it plays, 20 queued and 50 heard, long titles';
// The tall "while it plays" and "turned off" pages are measured by the rule below and held to the card box only: its rows arrive after the card opens, and the
// shared box checks read the card mid-growth there (a box that settles in the gallery still).
const pageVariant = (name, extra, click, tall = false, whole = true) => ({ name, q: fitQuery(extra, tall), checks: whole ? ['.sp-card', '.sp-songs', '.sp-shead'] : ['.sp-card'], click: tall ? `hover:.sp-card then ${click}` : click });

export default {
  name: 'spotify-saved-playlists',
  gallery: {
    states: [
      state('the public page list, small card', '&spotifypage=ok', ["From Spotify's public page", 'Lantern Song 1', 'Lantern Song 8'], SMALL_CLICK),
      state('the public page list, tall card', '&spotifypage=ok', ["From Spotify's public page", 'Lantern Song 1', 'Lantern Song 8'], TALL_CLICK),
      state('a long playlist, small card', '&spotifypage=first', ["From Spotify's public page, first 100 of 520", 'Lantern Song 1'], SMALL_CLICK),
      state('a long playlist, tall card', '&spotifypage=first', ["From Spotify's public page, first 100 of 520", 'Lantern Song 1'], TALL_CLICK),
      state('rows that cannot play, hover a dim row', '&spotifypage=odd', ['This song cannot be played here: it is a local file, or not available in this country.'], `${SMALL_CLICK} >> hover:.sp-track.off`),
      state('hover on the source tag', '&spotifypage=ok', ["The wall read this list from the playlist's public web page", 'Turn it off with the button beside this line.'], `${SMALL_CLICK} >> hover:.sp-source`),
      state('still reading the page', '&spotifypage=slow', ["Reading Spotify's public page."], SMALL_CLICK),
      state('not public, nothing playing, small card', '&spotifypage=private&spotifyplay=none&media=none', [PRIVATE, WHILE_PLAYS], SMALL_CLICK),
      state('not public, nothing playing, tall card', '&spotifypage=private&spotifyplay=none&media=none', [PRIVATE, WHILE_PLAYS], TALL_CLICK),
      state('the page has changed', '&spotifypage=changed&spotifyplay=none&media=none', ["Spotify's public page has changed, so the wall cannot read it.", WHILE_PLAYS], SMALL_CLICK),
      state('the hourly limit', '&spotifypage=busy&spotifyplay=none&media=none', ["The wall reads Spotify's public page at most 20 times an hour. Try again later.", WHILE_PLAYS], SMALL_CLICK),
      state('the page did not answer', '&spotifypage=down&spotifyplay=none&media=none', ["Spotify's public page did not answer.", 'Try again in a minute.', WHILE_PLAYS], SMALL_CLICK),
      state('the public page is turned off', '&spotifypageoff=1&spotifyplay=none&media=none', ['Spotify lists the songs only for playlists you made.', WHILE_PLAYS], SMALL_CLICK),
      state('while it plays, this playlist, small card', '&spotifypage=private&spotifyctx=this', ['Playing now', 'Up next in Spotify', 'Heard from this playlist', 'Heard Song 1'], SMALL_CLICK),
      state('while it plays, this playlist, tall card', '&spotifypage=private&spotifyctx=this', ['Playing now', 'Up next in Spotify', 'Heard from this playlist', 'Heard Song 1'], TALL_CLICK),
      state('while it plays, another playlist is playing', '&spotifypage=private&spotifyctx=other', [PRIVATE, WHILE_PLAYS, '!Heard from this playlist'], SMALL_CLICK),
      state('the page is turned off, small card', '&spotifypageoff=1&spotifyplay=none&media=none', ['Read public page', "Reading the page is against Spotify's developer terms and may stop working."], SMALL_CLICK),
      state('the page is turned off, tall card', '&spotifypageoff=1&spotifyplay=none&media=none', ['Read public page', "Reading the page is against Spotify's developer terms and may stop working."], TALL_CLICK),
      state('not public, with its Turn off, small card', '&spotifypage=private&spotifyplay=none&media=none', [PRIVATE, 'Turn off'], SMALL_CLICK),
      state('did not answer, try again in a minute', '&spotifypage=down&spotifyplay=none&media=none', ['Try again in a minute.', 'Turn off', '!Retry'], SMALL_CLICK),
      state('a page of 200 rows from 500, small card', '&spotifypage=big', ["From Spotify's public page, first 200 of 500"], SMALL_CLICK),
      state('while it plays, 20 queued and 50 heard, small card', '&spotifypage=private&spotifyctx=this&spotifyload=heavy', ['Up next in Spotify', '12 more in Up next', 'Heard from this playlist'], SMALL_CLICK),
      state('while it plays, 20 queued and 50 heard, tall card', '&spotifypage=private&spotifyctx=this&spotifyload=heavy', ['12 more in Up next'], TALL_CLICK),
      state('while it plays, 20 queued and 50 heard, long titles', '&spotifypage=private&spotifyctx=this&spotifyload=heavy&spotify=long&media=long', ['12 more in Up next'], SMALL_CLICK),
      state('hover on Turn off', '&spotifypage=ok', ['Turn off', "Stop reading Spotify's public page. Saved playlists then show their songs only while they play."], `${SMALL_CLICK} >> hover:.sp-source .sp-linkbtn`),
      state('Turn off pressed', '&spotifypage=ok&spotifyplay=none&media=none', ['Spotify lists the songs only for playlists you made.', 'Read public page', WHILE_PLAYS, "developer terms"], `${SMALL_CLICK} >> .sp-source .sp-linkbtn`),
      state('the switch is off, hover Read public page', '&spotifypageoff=1&spotifyplay=none&media=none', ['This is against Spotify\'s developer terms and may stop working.'], `${SMALL_CLICK} >> hover:.sp-songs .sp-empty .sp-btn`),
    ],
  },
  fit: {
    variants: [
      pageVariant(PAGE_SMALL, '&spotifypage=first', SMALL_CLICK),
      pageVariant(PAGE_TALL, '&spotifypage=first', TALL_CLICK, true),
      pageVariant(WHILE_SMALL, '&spotifypage=private&spotifyctx=this', SMALL_CLICK),
      pageVariant(WHILE_TALL, '&spotifypage=private&spotifyctx=this', TALL_CLICK, true, false),
      pageVariant(OFF_SMALL, '&spotifypageoff=1&spotifyplay=none&media=none', SMALL_CLICK),
      pageVariant(OFF_TALL, '&spotifypageoff=1&spotifyplay=none&media=none', TALL_CLICK, true, false),
      pageVariant(FAIL_SMALL, '&spotifypage=private&spotifyplay=none&media=none', SMALL_CLICK),
      pageVariant(HEAVY, '&spotifypage=private&spotifyctx=this&spotifyload=heavy', SMALL_CLICK),
      pageVariant(HEAVY_LONG, '&spotifypage=private&spotifyctx=this&spotifyload=heavy&spotify=long&media=long', SMALL_CLICK),
    ],
    measurements: { savedPlaylists: measureSaved },
    rules: {
      savedPlaylists: (variant, results, emit) => {
        if (!variant.name.startsWith('Saved playlist, ')) return false;
        const m = results.savedPlaylists;
        const fails = [];
        const isPage = variant.name === PAGE_SMALL || variant.name === PAGE_TALL;
        const isWhile = variant.name === WHILE_SMALL || variant.name === WHILE_TALL || variant.name === HEAVY || variant.name === HEAVY_LONG;
        const isOff = variant.name === OFF_SMALL || variant.name === OFF_TALL;
        const isHeavy = variant.name === HEAVY || variant.name === HEAVY_LONG;
        if (!m) {
          emit('  FAIL saved: nothing measured');
          return true;
        }
        if (!m.songs || !m.tracks || !m.head) {
          fails.push('saved: the playlist page is not open');
        } else if (isPage) {
          if (!m.tag) fails.push('saved: the source tag is not above the rows');
          else {
            if (m.tag.r > m.tracks.r + 1 || m.tag.l < m.tracks.l - 1) fails.push(`saved: the source tag leaves the list (its right edge is ${Math.round(m.tag.r - m.tracks.r)} px past the list's)`);
            if (m.tag.h > 44) fails.push(`saved: the source tag takes ${Math.round(m.tag.h)} px, more than one line`);
            if (m.tagCut) fails.push('saved: the source tag is cut off');
            if (m.tag.t < m.tracks.t - 1) fails.push('saved: the source tag is above the list');
            if (!m.turnOff) fails.push('saved: the Turn off button is not on the source tag');
            else if (m.turnOff.h < 31.5 || m.turnOff.r > m.tracks.r + 1) fails.push('saved: the Turn off button is under 32 px tall or leaves the list');
          }
          if (m.rows.length < 3) fails.push('saved: the page rows are not shown');
        } else if (isOff) {
          if (!m.terms) fails.push('saved: the terms sentence is not on the off line');
          else {
            if (m.terms.r > m.tracks.r + 1 || m.terms.l < m.tracks.l - 1) fails.push('saved: the terms sentence leaves the list');
            if (m.terms.cut) fails.push('saved: the terms sentence is cut off');
            if (m.terms.font < 15.99) fails.push('saved: the terms sentence is under 16 px');
          }
          if (!m.turnOn || m.turnOn.h < 31.5 || m.turnOn.r > m.tracks.r + 1) fails.push('saved: the Read public page button is missing, under 32 px or outside the list');
        } else if (variant.name === FAIL_SMALL) {
          if (!m.turnOff || m.turnOff.h < 31.5 || m.turnOff.r > m.tracks.r + 1) fails.push('saved: the Turn off button is missing, under 32 px or outside the list on a failed read');
        } else if (isWhile) {
          if (isHeavy) {
            if (m.nextRows > 8) fails.push(`saved: ${m.nextRows} Up next rows (8 at most)`);
            if (!m.moreLine) fails.push('saved: no line for the rest of the queue');
          }
          if (m.secs.length !== 3) fails.push(`saved: ${m.secs.length} section headings (3)`);
          else {
            const first = m.secs[0];
            // The header is a band over the list in the small card and a column beside it in the tall one: it is overlapped only where both ranges meet.
            if (first.t < m.head.b - 0.5 && first.l < m.head.r && first.r > m.head.l) fails.push('saved: a section heading overlaps the header');
            if (first.t < m.tracks.t - 0.5) fails.push('saved: a section heading sits above the list box');
            for (const s of m.secs) if (s.t < m.tracks.b && s.b > m.tracks.t && (s.l < m.tracks.l - 1 || s.r > m.tracks.r + 1)) fails.push('saved: a section heading leaves the list box');
            for (const r of m.rows) if (r.t < m.tracks.b && r.b > m.tracks.t && (r.l < m.tracks.l - 1 || r.r > m.tracks.r + 1)) fails.push('saved: a song row leaves the list box');
          }
        }
        if (m.small.length) fails.push(`saved: text under 16 px: ${m.small.slice(0, 3).join('; ')}`);
        for (const f of [...new Set(fails)]) emit(`  FAIL ${f}`);
        if (fails.length) return true;
        emit(isOff
          ? '  ok   saved: the terms sentence and Read public page are inside the list, 16 px or more'
          : variant.name === FAIL_SMALL
            ? '  ok   saved: Turn off is inside the list on a failed read'
            : isPage
              ? '  ok   saved: the source tag and its Turn off button are one line inside the list, no text under 16 px'
              : '  ok   saved: three section headings and the rows inside the list box, clear of the header, no text under 16 px');
        return false;
      },
    },
    breaks: {
      'saved-tag-wide': { css: '.sp-source { white-space: nowrap; min-width: 900px !important; }', expect: /^ *FAIL saved: the source tag leaves the list/m, appliesTo: (v) => v.name === PAGE_SMALL },
      'saved-heading-up': { css: '.sp-sec { margin-top: -60px !important; }', expect: /^ *FAIL saved: a section heading (overlaps the header|sits above the list box)/m, appliesTo: (v) => v.name === WHILE_SMALL || v.name === WHILE_TALL },
      'saved-terms-wide': { css: '.sp-songs .sp-empty .sp-hintline { white-space: nowrap !important; min-width: 1200px !important; }', expect: /^ *FAIL saved: the terms sentence leaves the list/m, appliesTo: (v) => v.name === OFF_SMALL },
      'saved-more-gone': { css: '.sp-source { display: none !important; }', expect: /^ *FAIL saved: no line for the rest of the queue/m, appliesTo: (v) => v.name === HEAVY },
      'saved-text-small': { css: '.sp-sec { font-size: 13px !important; }', expect: /^ *FAIL saved: text under 16 px/m, appliesTo: (v) => v.name === WHILE_SMALL || v.name === WHILE_TALL },
    },
  },
};
