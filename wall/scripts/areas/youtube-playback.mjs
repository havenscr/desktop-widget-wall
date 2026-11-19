// YouTube picks that play on the wall (vote L2, option A): gallery states for the rows that play, Play and Shuffle, the foot
// player, the quiet note line, the top player, Up next, Watch and Home with the wall's music; fit variants with one browser
// measurement and its rule, and a deliberate break for each rule. The mock frame never loads a real player (`watch=mock`),
// and `ytplay=` starts a pick the way a click does (see `devMocks/youtube.ts`). Everything this area needs lives here.

const night = encodeURIComponent('2026-11-11T22:30:00-08:00');
const day = '2026-11-11T10:24:00-08:00';
const SWITCH = '.sp-switch button:nth-child(2)';
const TALL = '.sp-grow';
const TILE = '.yt-tile';
const LIKED = '.sp-tabs button:nth-child(3)';
// The pointer goes to the right end of what it is sent to: on the title, so it is on the play part and not on the add control.
const ROW4 = 'hover:.yt-row:nth-child(4) .yt-title';
const steps = (...s) => s.join(' >> ');
// Windows offers no playing session (`media=none`), so the top player draws the wall's own music; the mock frame stays on Listen.
const play = (mode, extra = '') => `youtube=in&ytlib=full&media=none&watch=mock&wtab=listen${mode ? `&ytplay=${mode}` : ''}${extra}`;
const base = (q) => `hz=unwind&at=${night}&clock=review&weather=ok&audio=demo&${q}`;
const state = (name, query, expect, actions) => ({ screen: 'unwind', name: `youtube playback: ${name}`, query, custom: true, expect, ...(actions ? { actions } : {}) });

const AUTOPLAY = 'YouTube did not start the sound.';
const SKIPPED = 'Skipped Glass Harbor: it plays only on YouTube.';
const FIVE = 'Stopped after five videos in a row would not play.';

/**
 * Runs in the page (it references nothing outside its own body). What the wall's music adds to the YouTube side of the
 * music card and to Listen. Measured in wall pixels: the foot player 791 by 61 at 1728, 572 with the list above it; at
 * rest Play, Shuffle and Refresh on one row with the header, the name keeping room; playable rows hold a button with a
 * pointer cursor and greyed rows hold none; the row playing has cyan words (exactly one row); the player's layer is out
 * of sight on Listen (transparent, parked, nothing under its centre); no text under 16 px in the foot, rows and note,
 * every button 32 px or more and the foot's 36, 44 and 36; the note line inside the card and clear of the foot; Up next
 * above the left wing's foot.
 */
function measureYoutubePlayback() {
  const fails = [];
  const cardEl = document.querySelector('.sp-card');
  const st = document.createElement('style');
  st.textContent = '.sp-card { transition: none !important; } .sp-songs { animation: none !important; }';
  document.head.appendChild(st);
  const r0 = (n) => Math.round(n * 10) / 10;
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const box = (e) => (e ? e.getBoundingClientRect() : null);
  const name = (e) => String((e.className && e.className.baseVal) || e.className || e.tagName);
  const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  const out = { yp: false, fails, hasFoot: false, hasNote: false, hasRows: false, hasPlaying: false, hasUpNext: false, hasLayer: false, rest: false };
  const card = box(cardEl);
  const tall = !!cardEl && cardEl.getAttribute('data-tall') === 'true';
  const foot = cardEl ? cardEl.querySelector('.yt-foot') : null;
  const note = cardEl ? cardEl.querySelector('.yt-note') : null;
  const libEl = cardEl ? cardEl.querySelector('.yt-lib') : null;
  out.hasFoot = !!foot;
  out.hasNote = !!note;
  out.tall = tall;
  if (foot) {
    out.yp = true;
    const f = box(foot);
    if (!near(f.left, 1728, 2) || !near(f.top, 572, 2) || !near(f.width, 791, 2) || !near(f.height, 61, 2)) fails.push('the foot is ' + r0(f.width) + ' by ' + r0(f.height) + ' at x ' + r0(f.left) + ', y ' + r0(f.top) + ' (791 by 61 at 1728, 572)');
    const list = libEl ? libEl.querySelector('.yt-rowscroll, .yt-scroll') : null;
    const l = box(list);
    if (l && l.height > 0 && l.bottom > f.top + 0.5) fails.push('the list ends at y ' + r0(l.bottom) + ', into the foot (its top is y ' + r0(f.top) + ')');
    const pieces = [['previous', '.yt-fprevious', 36], ['play', '.yt-fplay', 44], ['next', '.yt-fnext', 36]];
    for (const [label, sel, size] of pieces) {
      const b = box(foot.querySelector(sel));
      if (!b || b.width === 0) fails.push('the foot has no ' + label + ' button');
      else if (!near(b.width, size, 1.5) || !near(b.height, size, 1.5)) fails.push('the foot\'s ' + label + ' button is ' + r0(b.width) + ' by ' + r0(b.height) + ' (' + size + ')');
    }
    for (const e of foot.querySelectorAll('*')) {
      if (e.closest('svg') || e.tagName === 'svg') continue;
      if ([...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 15.99) { fails.push('text under 16 px in the foot (' + name(e) + ' "' + (e.textContent || '').trim().slice(0, 24) + '", ' + getComputedStyle(e).fontSize + ')'); break; }
    }
    // The foot's pieces sit in one row without overlapping.
    const kids = [...foot.children].map((e) => [name(e), box(e)]).filter(([, b]) => b && b.width > 0);
    for (let i = 0; i < kids.length - 1; i += 1) if (hit(kids[i][1], kids[i + 1][1])) { fails.push('the foot\'s ' + kids[i][0] + ' and ' + kids[i + 1][0] + ' overlap'); break; }
  }
  if (cardEl && cardEl.classList.contains('yt') && libEl) {
    out.yp = true;
    out.rest = !tall;
    const opened = cardEl.querySelector('.yt-songs');
    // At rest: Play, Shuffle and Refresh share the header's row, and the name keeps room.
    if (opened && !tall) {
      const head = box(opened.querySelector('.sp-shead'));
      const parts = ['.yt-playall', '.yt-shuffle', '.yt-refresh'].map((s) => [s, box(opened.querySelector(s))]);
      for (const [s, b] of parts) {
        if (!b || b.width === 0) { fails.push('at rest the header has no ' + s.slice(4) + ' button'); continue; }
        if (b.top < head.top - 0.5 || b.bottom > head.bottom + 0.5) fails.push('at rest ' + s.slice(4) + ' is not on the header\'s row');
      }
      const centres = parts.map(([, b]) => (b ? (b.top + b.bottom) / 2 : null)).filter((n) => n !== null);
      if (centres.length && Math.max(...centres) - Math.min(...centres) > 4) fails.push('at rest Play, Shuffle and Refresh are not on one row');
      const text = opened.querySelector('.sp-shead .sp-text');
      const t = box(text);
      const nameEl = opened.querySelector('.sp-shead .sp-name');
      if (t && t.width < 120) fails.push('at rest the playlist\'s name has only ' + r0(t.width) + ' px (Play, Shuffle and Refresh must leave it 120)');
      if (nameEl && nameEl.scrollWidth > nameEl.clientWidth + 1 && getComputedStyle(nameEl).textOverflow !== 'ellipsis') fails.push('at rest the playlist\'s name is cut with no ellipsis');
      const heads = [['the back button', '.sp-back'], ['the picture', '.yt-songthumb'], ['the name', '.sp-text'], ['Play', '.yt-playall'], ['Shuffle', '.yt-shuffle'], ['Refresh', '.yt-refresh']].map(([label, s]) => [label, box(opened.querySelector(s))]).filter(([, b]) => b && b.width > 0);
      for (let i = 0; i < heads.length; i += 1) for (let j = i + 1; j < heads.length; j += 1) if (hit(heads[i][1], heads[j][1])) fails.push('at rest ' + heads[i][0] + ' and ' + heads[j][0] + ' overlap');
    }
    // Playable rows hold a button with a pointer cursor; greyed rows hold none and show no pointer.
    const rows = [...libEl.querySelectorAll('.yt-row')];
    out.hasRows = rows.length > 0;
    for (const row of rows.slice(0, 60)) {
      const grey = row.classList.contains('off');
      const b = row.querySelector('button');
      if (!grey && !b) { fails.push('a playable row holds no button'); break; }
      if (grey && (b || row.querySelector('[role="button"], a, input'))) { fails.push('a greyed row holds a button'); break; }
      if (!grey && getComputedStyle(b).cursor !== 'pointer') { fails.push('a playable row\'s cursor is ' + getComputedStyle(b).cursor + ' (pointer)'); break; }
      if (grey && [row, ...row.querySelectorAll('*')].some((e) => getComputedStyle(e).cursor === 'pointer')) { fails.push('a greyed row shows a pointer cursor'); break; }
    }
    // The playing row: exactly one, with cyan words.
    const on = [...libEl.querySelectorAll('.yt-row.on')];
    out.hasPlaying = on.length > 0;
    if (on.length > 1) fails.push(on.length + ' rows are marked as playing (one)');
    for (const row of on) {
      const c = getComputedStyle(row.querySelector('.yt-title')).color;
      if (c !== 'rgb(53, 230, 234)') fails.push('the playing row\'s title is ' + c + ' (cyan, rgb(53, 230, 234))');
    }
    // No text under 16 px in the rows.
    for (const e of libEl.querySelectorAll('.yt-row *')) {
      if (e.closest('svg') || e.tagName === 'svg') continue;
      if ([...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 15.99) { fails.push('text under 16 px in a row (' + name(e) + ' "' + (e.textContent || '').trim().slice(0, 24) + '", ' + getComputedStyle(e).fontSize + ')'); break; }
    }
  }
  if (cardEl) {
    // Every button and field in the card 32 px or more each way (a library row's 30 by 30 add control is held to its size by the library-add area).
    for (const e of cardEl.querySelectorAll('button:not(.yt-add), input')) {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const b = e.tagName === 'INPUT' ? (e.closest('.sp-search') ? e.closest('.sp-search').getBoundingClientRect() : r) : r;
      if (b.width < 31.5 || b.height < 31.5) { fails.push('control ' + name(e) + ' "' + (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 20) + '" is ' + r0(b.width) + ' by ' + r0(b.height) + ' (32 at least)'); break; }
    }
  }
  if (note) {
    out.yp = true;
    const n = box(note);
    if (n.left < card.left - 0.5 || n.right > card.right + 0.5 || n.top < card.top - 0.5 || n.bottom > card.bottom + 0.5) fails.push('the note line is outside the card (y ' + r0(n.top) + ' to ' + r0(n.bottom) + ', the card ends at ' + r0(card.bottom) + ')');
    const f = box(foot);
    if (f && f.width > 0 && hit(n, f)) fails.push('the note line covers the foot player');
    if (f && f.width > 0 && n.bottom > f.top + 0.5) fails.push('the note line is not above the foot player');
    const bar = box(cardEl.querySelector('.yt-bar'));
    if (bar && bar.width > 0 && hit(n, bar)) fails.push('the note line covers the library bar');
    for (const e of note.querySelectorAll('*')) {
      if (e.closest('svg')) continue;
      if ([...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 15.99) { fails.push('text under 16 px in the note line (' + getComputedStyle(e).fontSize + ')'); break; }
    }
    if (parseFloat(getComputedStyle(note).fontSize) < 15.99) fails.push('text under 16 px in the note line (' + getComputedStyle(note).fontSize + ')');
  }
  // The player is out of sight on Listen: its layer transparent, its stage parked, and nothing of it under the parked box's centre.
  const layer = document.querySelector('.w-layer');
  const stage = layer ? layer.querySelector('.w-stage') : null;
  if (layer && stage && layer.getAttribute('data-shown') === 'false') {
    out.hasLayer = true;
    out.yp = true;
    const opacity = getComputedStyle(layer).opacity;
    if (opacity !== '0') fails.push('the player\'s layer is in sight on Listen (opacity ' + opacity + ')');
    const parked = layer.querySelector('.w-parked');
    if (!parked && !(stage && stage.classList.contains('w-parked'))) fails.push('the player\'s stage is not parked on Listen');
    const p = box(parked || stage);
    if (p && p.width > 0) {
      const top = document.elementFromPoint(p.left + p.width / 2, p.top + p.height / 2);
      if (top && top.closest('.w-layer')) fails.push('something of the player is under the pointer at its parked box\'s centre (' + name(top) + ')');
    }
  }
  // Up next with the wall's music ends above the left wing's foot.
  const upNext = document.querySelector('.u-wing .u-next');
  const wingFoot = document.querySelector('.u-wing .u-foot');
  if (upNext && wingFoot) {
    out.hasUpNext = true;
    out.yp = true;
    const u = box(upNext);
    const w = box(wingFoot);
    if (u.bottom > w.top + 0.5) fails.push('Up next ends at y ' + r0(u.bottom) + ', over the wing\'s foot (its top is y ' + r0(w.top) + ')');
  }
  return out;
}

const fitQuery = (q, when = day) => `?hz=unwind&at=${when}&long=1&agents=3&${q}`;
const variant = (name, q, click, more = {}) => ({ name: `YouTube playback, ${name}`, q: fitQuery(q), checks: ['.sp-card', '.yt-lib'], click, ...more });
const TALL_PLAY = 'YouTube playback, tall, a playlist playing';
const REST_PLAY = 'YouTube playback, at rest, a playlist playing';
const TALL_NONE = 'YouTube playback, tall, nothing on';
const TALL_REFUSED = 'YouTube playback, tall, autoplay refused';
const REST_REFUSED = 'YouTube playback, at rest, autoplay refused';
const TALL_SKIPPED = 'YouTube playback, tall, a video skipped';
const REST_SKIPPED = 'YouTube playback, at rest, a video skipped';
const UPNEXT = 'YouTube playback, Up next with the wall\'s music';
const OUTOFSIGHT = 'YouTube playback, the player out of sight on Listen';
const PLAYING_NAMES = [TALL_PLAY, REST_PLAY];

export default {
  name: 'youtube-playback',
  gallery: {
    states: [
      state('tall, a playlist playing (the picture, the pointer on row 4)', base(play('on')), ['YouTube, on the wall', 'Night Drive', 'Play', 'Shuffle', 'Glass Harbor', 'Mira Vale', '1:06', '3:34', 'Click to play it on the wall'], steps(SWITCH, TALL, TILE, ROW4)),
      state('at rest, a playlist playing', base(play('on')), ['YouTube, on the wall', 'Night Drive', 'Play', 'Shuffle', 'Glass Harbor', '!Read at', '!Nothing playing on the wall'], steps(SWITCH, TILE)),
      state('tall, paused', base(play('paused')), ['YouTube, on the wall', 'Night Drive', 'Glass Harbor', '1:06'], steps(SWITCH, TALL, TILE)),
      state('at rest, paused', base(play('paused')), ['YouTube, on the wall', 'Night Drive', 'Glass Harbor'], steps(SWITCH, TILE)),
      state('at rest, autoplay refused', base(play('refused')), [AUTOPLAY, 'Start it on Watch', 'Night Drive'], steps(SWITCH, TILE)),
      state('tall, autoplay refused', base(play('refused')), [AUTOPLAY, 'Start it on Watch', 'Night Drive'], steps(SWITCH, TALL, TILE)),
      state('at rest, a video skipped', base(play('skipped')), [SKIPPED, 'Only on YouTube', 'Night Drive'], steps(SWITCH, TILE)),
      state('tall, a video skipped', base(play('skipped')), [SKIPPED, 'Only on YouTube', 'Night Drive'], steps(SWITCH, TALL, TILE)),
      state('at rest, stopped after five', base(play('five')), [FIVE, 'Night Drive', '!YouTube, on the wall'], steps(SWITCH, TILE)),
      state('tall, stopped after five', base(play('five')), [FIVE, 'Nothing playing on the wall', 'Night Drive'], steps(SWITCH, TALL, TILE)),
      state('the last entry ended', base(play('ended')), ['Last played on the wall', 'Play again', 'Night Drive'], steps(SWITCH, TALL, TILE)),
      state('Liked, a row playing', base(play('liked')), ['YouTube, on the wall', 'Northbound Lights', 'Cassette Rain'], steps(SWITCH, LIKED)),
      state('search results, a row playing', base(play('search', '&ytsearch=night')), ['Results for', 'YouTube, on the wall', 'Low Tide Motel', 'Mira Vale'], SWITCH),
      state('the foot with a Watch video', base(play('watch')), ['Night drive mix', 'Night Garden Radio', 'Night Drive'], steps(SWITCH, TALL, TILE)),
      state('the foot with nothing on', base(play('')), ['Nothing playing on the wall', 'Pick a video to play it here', 'Night Drive'], steps(SWITCH, TALL, TILE)),
      state('Listen, the top player with the wall\'s music', base(play('on')), ['YouTube, on the wall', 'Glass Harbor', 'Mira Vale', '1:06', '3:34', 'Up next']),
      state('Listen, Up next with the wall\'s music', base(play('on')), ['Up next', 'Low Tide Motel', 'Aurora Set'], SWITCH),
      state('the Watch tab with a music pick', base(`youtube=in&ytlib=full&media=none&watch=mock&ytplay=on`), ['Glass Harbor', 'Mira Vale', 'Playing on the wall']),
      state('Home, Now Playing with a music pick', `hz=home&at=${night}&clock=review&weather=ok&audio=demo&${play('on')}`, ['Glass Harbor', 'YouTube Music']),
      state('a row\'s hover card', base(play('on')), ['Glass Harbor', 'Mira Vale', 'Click to play it on the wall'], steps(SWITCH, TILE, ROW4)),
      state('Play\'s hover card', base(play('on')), ['Play this playlist on the wall, sound only'], steps(SWITCH, TILE, 'hover:.yt-playall')),
      state('Shuffle\'s hover card', base(play('on')), ['Play it in a random order'], steps(SWITCH, TILE, 'hover:.yt-shuffle')),
      state('the seek\'s hover card', base(play('on')), ['Drag to move in the video'], steps(SWITCH, TALL, TILE, 'hover:.yt-fseek')),
    ],
  },
  fit: {
    variants: [
      variant('tall, a playlist playing', play('on'), steps(SWITCH, TALL, TILE), { checks: ['.sp-card', '.yt-lib', '.yt-foot'] }),
      variant('at rest, a playlist playing', play('on'), steps(SWITCH, TILE), { listen: true }),
      variant('tall, nothing on', play(''), steps(SWITCH, TALL, TILE), { checks: ['.sp-card', '.yt-lib', '.yt-foot'] }),
      variant('tall, autoplay refused', play('refused'), steps(SWITCH, TALL, TILE), { checks: ['.sp-card', '.yt-lib', '.yt-foot'] }),
      variant('at rest, autoplay refused', play('refused'), steps(SWITCH, TILE), { listen: true, checks: ['.sp-card', '.yt-lib', '.yt-note'] }),
      variant('tall, a video skipped', play('skipped'), steps(SWITCH, TALL, TILE), { checks: ['.sp-card', '.yt-lib', '.yt-foot', '.yt-note'] }),
      variant('at rest, a video skipped', play('skipped'), steps(SWITCH, TILE), { listen: true, checks: ['.sp-card', '.yt-lib', '.yt-note'] }),
      variant('tall, stopped after five', play('five'), steps(SWITCH, TALL, TILE), { checks: ['.sp-card', '.yt-lib', '.yt-foot', '.yt-note'] }),
      variant('tall, a Watch video', play('watch'), steps(SWITCH, TALL, TILE), { checks: ['.sp-card', '.yt-lib', '.yt-foot'] }),
      variant('tall, Liked playing', play('liked'), steps(SWITCH, TALL, LIKED), { checks: ['.sp-card', '.yt-lib', '.yt-foot'] }),
      variant('at rest, search playing', play('search', '&ytsearch=night'), SWITCH, { listen: true }),
      variant('Up next with the wall\'s music', play('on'), SWITCH, { listen: true, checks: ['.u-listen', '.sp-card', '.u-next', '.u-next-row'] }),
      variant('the player out of sight on Listen', play('on'), SWITCH, { listen: true, checks: ['.sp-card', '.w-layer'] }),
    ],
    measurements: { youtubePlayback: measureYoutubePlayback },
    rules: {
      youtubePlayback: (variant, results, emit) => {
        const m = results.youtubePlayback;
        if (!variant.name.startsWith('YouTube playback, ') || !m) return false;
        const fails = m.fails.slice();
        // The states that say something is on must show it.
        if (PLAYING_NAMES.includes(variant.name) && !m.hasPlaying) fails.push('no row is marked as playing');
        if (PLAYING_NAMES.includes(variant.name) && !m.hasRows) fails.push('no row was drawn (the read never finished)');
        if ([TALL_PLAY, TALL_NONE, TALL_REFUSED, TALL_SKIPPED].includes(variant.name) && !m.hasFoot) fails.push('the foot player is not there');
        if ([REST_REFUSED, REST_SKIPPED, TALL_SKIPPED].includes(variant.name) && !m.hasNote) fails.push('the note line is not there');
        if (variant.name === UPNEXT && !m.hasUpNext) fails.push('Up next is not shown');
        if (variant.name === OUTOFSIGHT && !m.hasLayer) fails.push('the player\'s layer is not there');
        for (const failure of fails) emit(`  FAIL youtube playback: ${failure}`);
        if (fails.length) return true;
        emit('  ok   youtube playback: the foot is 791 by 61 at 1728, 572 above nothing of the list, its buttons 36, 44 and 36; Play, Shuffle and Refresh share the header\'s row at rest; playable rows hold a pointer button and greyed rows none; the playing row is cyan; the player is out of sight on Listen; no text under 16 px, every button 32 px or more; the note line is inside the card; Up next ends above the wing\'s foot');
        return false;
      },
    },
    breaks: {
      'ytplay-foot-height': { css: '.yt-foot { height: 90px !important; }', expect: /^ *FAIL youtube playback: the foot is /m, appliesTo: (v) => v.name === TALL_PLAY },
      'ytplay-rest-actions': { css: '.yt-songs:not(.tall) .yt-shactions { min-width: 560px !important; }', expect: /^ *FAIL youtube playback: at rest /m, appliesTo: (v) => v.name === REST_PLAY },
      'ytplay-row-cursor': { css: '.yt-row .yt-play { cursor: default !important; }', expect: /^ *FAIL youtube playback: a playable row's cursor is /m, appliesTo: (v) => v.name === TALL_PLAY },
      'ytplay-row-colour': { css: '.yt-row.on .yt-title { color: rgb(255, 255, 255) !important; }', expect: /^ *FAIL youtube playback: the playing row's title is /m, appliesTo: (v) => v.name === TALL_PLAY },
      'ytplay-visible': { css: ".w-layer[data-shown='false'] { opacity: 1 !important; }", expect: /^ *FAIL youtube playback: the player's layer is in sight on Listen/m, appliesTo: (v) => v.name === OUTOFSIGHT },
      'ytplay-small': { css: '.yt-foot .yt-ftime { font-size: 13px !important; }', expect: /^ *FAIL youtube playback: text under 16 px in the foot/m, appliesTo: (v) => v.name === TALL_PLAY },
      'ytplay-button': { css: '.yt-foot .yt-fplay { width: 28px !important; height: 28px !important; }', expect: /^ *FAIL youtube playback: the foot's play button is /m, appliesTo: (v) => v.name === TALL_PLAY },
      'ytplay-note': { css: '.yt-note { bottom: -40px !important; }', expect: /^ *FAIL youtube playback: the note line is outside the card/m, appliesTo: (v) => v.name === REST_SKIPPED },
      'ytplay-upnext': { css: '.u-next { height: 600px !important; }', expect: /^ *FAIL youtube playback: Up next ends at y /m, appliesTo: (v) => v.name === UPNEXT },
    },
  },
};
