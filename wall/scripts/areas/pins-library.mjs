// Library pins on Unwind: covers and service badges on the three pins, the right-click menu on the library panels, the place
// chooser, and the Pin button in an opened playlist or album. One area file: gallery states, fit variants, the in-page measurement,
// its rule and the deliberate breaks. All names, ids and covers are invented (see `devMocks/watch.ts`: `wpins`).

const BASE = 'hz=unwind&at=2026-11-11T21%3A24%3A00-08%3A00&watch=mock&wlist=three&wtab=listen&wrows=shown&media=none&spotify=picture&youtube=in&ytlib=full';
const FIT = '?hz=unwind&at=2026-11-11T21:24:00-08:00&long=1&agents=3&watch=mock&wlist=three&wtab=listen&wrows=shown&media=none&spotify=picture&youtube=in&ytlib=full';
const SWITCH = '.sp-switch button:nth-child(2)';
const TALL = '.sp-grow';
const TILE = '.yt-tile';
const PIN_ROW = '.u-lib-pinrow';
const steps = (...s) => s.join(' >> ');

const state = (name, pins, expect, actions, extra = '') => ({
  screen: 'unwind',
  name: `library pins: ${name}`,
  query: `${extra.includes('spotify=') ? BASE.replace('&spotify=picture', '') : BASE}${pins ? `&wpins=${pins}` : ''}${extra}`,
  custom: true,
  expect,
  ...(actions ? { actions } : {}),
});

const states = [
  state('old storage, three Watch keys, thumbnails and badges', 'three', ['Night drive mix', 'Lofi beats radio, live', 'pixel_harbor']),
  state('mixed: Spotify cover, live thumbnail, Twitch glyph', 'mixed', ['Harbor lights', 'Rain radio, live', 'pixel_harbor']),
  state('a cover that fails to load', 'mixedbroken', ['Harbor lights', 'Rain radio, live']),
  state('one library pin, two empty places', 'lib1', ['Harbor lights', 'Add a pin']),
  state('a 60 character library name', 'liblong', ['Harbor lights for the long walk home']),
  state('a YouTube live pin clicked, Watch shows it', 'mixed', ['Rain radio, live'], '.u-pinslot:nth-child(2) .u-pin'),
  state('a Spotify pin clicked, signed out', 'mixed', ['Sign in'], '.u-pinslot:nth-child(1) .u-pin', '&spotify=signedout'),
  state('a Spotify pin clicked, no player', 'mixed', ['Spotify opened but did not show up as a player'], '.u-pinslot:nth-child(1) .u-pin', '&spotify=nodevice&spotifyplay=none'),
  state('right-click menu on a Spotify tile', 'none', ['Play', 'Shuffle', 'Songs', 'Pin to the left'], 'ctx:.sp-tile'),
  state('right-click menu, tall view, right-most tile', 'none', ['Pin to the left'], steps(TALL, 'ctx:.sp-tilebox:nth-child(5) .sp-tile')),
  state('right-click menu, tall view, a bottom-row tile', 'none', ['Pin to the left'], steps(TALL, 'ctx:.sp-tilebox:nth-child(8) .sp-tile')),
  state('right-click menu on a YouTube tile', 'none', ['Play', 'Shuffle', 'Videos', 'Pin to the left'], steps(SWITCH, `ctx:${TILE}`)),
  state('right-click menu on a YouTube row', 'none', ['Play', 'Add to a playlist', 'Open in YouTube', 'Pin to the left'], steps(SWITCH, TILE, 'ctx:.yt-row .yt-play')),
  state('the Pin row off: already pinned', 'mixedfull', ['Pinned in Pin 1'], 'ctx:.sp-tilebox:nth-child(1) .sp-tile'),
  state('the chooser, all three places used', 'mixedfull', ['Pin 1', 'Pin 2', 'Pin 3', '!Empty'], steps('ctx:.sp-tilebox:nth-child(4) .sp-tile', PIN_ROW)),
  state('the chooser with an empty place', 'lib1', ['Pin 1', 'Pin 2', 'Empty'], steps('ctx:.sp-tilebox:nth-child(4) .sp-tile', PIN_ROW)),
  state('an opened Spotify playlist at rest, Pin enabled', 'none', ['Shuffle', 'Pin'], '.sp-tile'),
  state('an opened Spotify playlist, tall, Pin enabled', 'none', ['Shuffle', 'Pin'], steps(TALL, '.sp-tile')),
  state('an opened YouTube playlist at rest', 'none', ['Playlist', 'Shuffle', 'Pin'], steps(SWITCH, TILE)),
  state('an opened YouTube playlist, tall', 'none', ['Playlist', 'Shuffle'], steps(SWITCH, TALL, TILE)),
];

/**
 * In the page (self-contained: it is serialised into the page). With `pinscheck=pins` every service badge lies inside its pin slot
 * (the overhang stays inside the pin's left padding and gap) and every pin name keeps the width it has without a badge (about 91 px: 151 wide
 * less 6 padding, 36 art, 8 gap, 8 padding and the border). With `pinscheck=menu` the open library menu or chooser lies fully inside 0 to 2560 by
 * 0 to 720 with no text under 16 px. With `pinscheck=spotify` the Pin button sits on the header row beside Play and Shuffle, nothing in
 * `.sp-shead` is cut or wraps. With `pinscheck=yt` the playlist name keeps at least 120 px at rest and, tall, nothing in the header
 * passes the 248 px column.
 */
const measurePins = () => {
  const mode = new URLSearchParams(location.search).get('pinscheck');
  if (!mode) return null;
  try {
    return check(mode);
  } catch (e) {
    return { fails: ['library pins: the check broke: ' + e.message], mode };
  }
  function check(mode) {
    const fails = [];
    const infos = [];
    const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const px = (e, prop) => parseFloat(getComputedStyle(e)[prop]);
    const where = (r) => [r.l, r.t, r.r, r.b].map(Math.round).join(',');
    if (mode === 'pins') {
      const badges = [...document.querySelectorAll('.u-pin-badge')];
      if (!badges.length) return { fails: ['library pins: no service badge is shown'], mode };
      for (const b of badges) {
        const slot = R(b.closest('.u-pinslot'));
        const r = R(b);
        const art = R(b.closest('.u-pin-art'));
        // The overhang past the art square is 5 px (the pin has 6 px of padding and an 8 px gap there): never more.
        if (r.r > art.r + 5.5 || r.b > art.b + 5.5) fails.push('a badge at ' + where(r) + ' is outside its pin slot: it hangs ' + Math.round(Math.max(r.r - art.r, r.b - art.b)) + ' px past the art (5 at most)');
        if (r.l < slot.l - 0.5 || r.r > slot.r + 0.5 || r.t < slot.t - 0.5 || r.b > slot.b + 0.5) fails.push('a badge at ' + where(r) + ' is outside its pin slot ' + where(slot));
      }
      for (const n of document.querySelectorAll('.u-pin .u-pin-name')) {
        const w = R(n).w;
        if (w < 90) fails.push('a pin name is ' + Math.round(w) + ' px wide (90 or more, as without a badge)');
      }
      return { fails, mode };
    }
    if (mode === 'menu') {
      const menu = document.querySelector('.u-lib-menu');
      if (!menu) return { fails: ['library pins: no menu is open'], mode };
      const m = R(menu);
      if (m.l < 0 || m.t < 0 || m.r > 2560.5 || m.b > 720.5) fails.push('the open menu is at ' + where(m) + ', outside the strip (0 to 2560 by 0 to 720)');
      if (menu.scrollHeight > menu.clientHeight + 1) fails.push('the menu content is ' + menu.scrollHeight + ' px tall in a ' + menu.clientHeight + ' px box (cut)');
      const small = [...menu.querySelectorAll('.u-pin-menu-title, button span, button')].filter((e) => e.textContent.trim() && px(e, 'fontSize') < 15.99);
      if (small.length) fails.push('text under 16 px in the menu (' + Math.round(px(small[0], 'fontSize')) + ' px in "' + small[0].textContent.trim().slice(0, 20) + '")');
      return { fails, mode };
    }
    if (mode === 'spotify') {
      const songs = document.querySelector('.sp-songs');
      const head = document.querySelector('.sp-shead');
      const pin = document.querySelector('.sp-songs .sp-pin');
      if (!songs || !head || !pin) return { fails: ['library pins: no opened Spotify view with a Pin button'], mode };
      const tall = songs.classList.contains('tall');
      const h = R(head);
      const p = R(pin);
      const uncut = (e, what) => { if (e.scrollWidth > e.clientWidth + 0.5) fails.push(what + ' is cut ("' + e.textContent.trim() + '" holds ' + e.scrollWidth + ' px in ' + e.clientWidth + ')'); };
      if (tall) {
        // Tall: Pin is a 40 px round icon at the end of the back row (Back, the tab name, Pin); Play and Shuffle keep their words.
        const back = document.querySelector('.sp-backrow');
        const label = document.querySelector('.sp-backlabel');
        const bb = R(back);
        if (!pin.closest('.sp-backrow')) fails.push('Pin is not in the back row');
        if (Math.abs(p.w - 40) > 0.6 || Math.abs(p.h - 40) > 0.6) fails.push('Pin is ' + Math.round(p.w) + ' by ' + Math.round(p.h) + ' (40 by 40)');
        if (p.r > bb.r + 0.5 || p.l < bb.l - 0.5) fails.push('Pin at ' + where(p) + ' passes the back row ' + where(bb));
        for (const e of back.children) if (R(e).r > bb.r + 0.5) fails.push('a back row item passes the row end');
        if (label) { uncut(label, 'the tab name'); if (R(label).r > p.l + 0.5) fails.push('the tab name runs under Pin'); }
        const row = document.querySelector('.sp-shbtns');
        const rr = R(row);
        const btns = [...row.querySelectorAll('.sp-btn')];
        if (btns.length !== 2) fails.push('the Play and Shuffle row holds ' + btns.length + ' buttons (2)');
        for (const e of btns) { uncut(e, 'a Play or Shuffle button'); if (R(e).r > rr.r + 0.5 || R(e).r > h.r + 0.5) fails.push('a Play or Shuffle button passes its column'); }
        if (row.scrollWidth > row.clientWidth + 0.5) fails.push('the Play and Shuffle row is cut');
        return { fails, mode };
      }
      const shuffle = [...document.querySelectorAll('.sp-songs .sp-btn')].find((e) => /Shuffle/.test(e.textContent));
      if (shuffle && Math.abs(R(shuffle).t - p.t) > 2) fails.push('Pin is at y ' + Math.round(p.t) + ', Shuffle at y ' + Math.round(R(shuffle).t) + ' (one row)');
      for (const e of head.querySelectorAll('.sp-btn')) {
        const r = R(e);
        uncut(e, 'a header button');
        if (r.h > 50) fails.push('a header button wraps (' + Math.round(r.h) + ' px tall)');
        if (r.r > h.r + 0.5) fails.push('a header button at ' + where(r) + ' passes the header ' + where(h));
      }
      return { fails, mode };
    }
    const songs = document.querySelector('.yt-songs');
    const pin = document.querySelector('.yt-songs .yt-pin');
    if (!songs || !pin) return { fails: ['library pins: no opened YouTube playlist with a Pin button'], mode };
    const tall = songs.classList.contains('tall');
    const name = document.querySelector('.yt-songs .sp-name');
    const acts = R(document.querySelector('.yt-shactions'));
    if (!tall && name && R(name).w < 120) fails.push('the playlist name is ' + Math.round(R(name).w) + ' px wide (120 or more at rest)');
    if (tall) {
      if (acts.w > 248.5) fails.push('the header actions are ' + Math.round(acts.w) + ' px wide (the column is 248)');
      for (const e of document.querySelectorAll('.yt-shactions button')) {
        const r = R(e);
        if (r.r > acts.r + 0.5 || r.l < acts.l - 0.5) fails.push('a header button at ' + where(r) + ' passes the 248 px column ' + where(acts));
      }
    }
    const row = R(pin.closest('.yt-playbtns') ?? pin);
    const p = R(pin);
    if (p.t < row.t - 0.5 || p.b > row.b + 0.5) fails.push('Pin at ' + where(p) + ' is off its header row ' + where(row));
    if (pin.closest('.yt-playbtns') && pin.closest('.yt-playbtns').scrollWidth > pin.closest('.yt-playbtns').clientWidth + 0.5) fails.push('the Play, Shuffle and Pin row is cut');
    infos.push('name ' + (name ? Math.round(R(name).w) : '?') + ' px, Pin ' + Math.round(p.w) + ' px wide');
    return { fails, mode, infos };
  }
};

const rule = (variant, results, emit) => {
  const r = results.pinslibrary;
  if (!r) return false;
  for (const f of r.fails) emit(`  FAIL library pins: ${f}`);
  if (r.fails.length) return true;
  const line = {
    pins: 'every badge lies inside its pin slot and no pin name is narrower than without a badge',
    menu: 'the open menu is inside the strip, text 16 px or more',
    spotify: 'Pin sits beside Shuffle at rest and in the back row when tall, the back row and the Play and Shuffle row are uncut',
    yt: `Pin sits on its header row, the name keeps 120 px at rest and the tall header fits its 248 px column (${(r.infos ?? []).join('; ')})`,
  }[r.mode];
  emit(`  ok   library pins: ${line}`);
  return false;
};

const v = (name, extra, click, mode, checks) => ({ name: `Library pins, ${name}`, q: `${FIT}${extra}&pinscheck=${mode}`, checks, ...(click ? { click } : {}) });
const PINS = ['.u-quick', '.u-pins'];
const names = {
  three: 'Library pins, old storage, three pins',
  mixed: 'Library pins, mixed pins',
  long: 'Library pins, a 60 character name',
  spMenu: 'Library pins, menu on a Spotify tile',
  spTall: 'Library pins, menu in the tall view',
  ytTile: 'Library pins, menu on a YouTube tile',
  ytRow: 'Library pins, menu on a YouTube row',
  chooser: 'Library pins, chooser, all places used',
  chooserEmpty: 'Library pins, chooser with an empty place',
  spOpen: 'Library pins, opened Spotify playlist at rest',
  spOpenTall: 'Library pins, opened Spotify playlist, tall',
  ytOpen: 'Library pins, opened YouTube playlist at rest',
  ytOpenTall: 'Library pins, opened YouTube playlist, tall',
};
const variants = [
  { ...v('old storage, three pins', '&wpins=three&wplay=0', null, 'pins', PINS), name: names.three },
  { ...v('mixed pins', '&wpins=mixed', null, 'pins', PINS), name: names.mixed },
  { ...v('a 60 character name', '&wpins=liblong', null, 'pins', PINS), name: names.long },
  { ...v('x', '&wpins=none', 'ctx:.sp-tile', 'menu', ['.sp-card']), name: names.spMenu },
  { ...v('x', '&wpins=none', `${TALL} >> ctx:.sp-tilebox:nth-child(5) .sp-tile`, 'menu', ['.sp-card']), name: names.spTall },
  { ...v('x', '&wpins=none', `${SWITCH} >> ctx:${TILE}`, 'menu', ['.sp-card']), name: names.ytTile },
  { ...v('x', '&wpins=none', `${SWITCH} >> ${TILE} >> ctx:.yt-row .yt-play`, 'menu', ['.sp-card']), name: names.ytRow },
  { ...v('x', '&wpins=mixedfull', `ctx:.sp-tilebox:nth-child(4) .sp-tile >> ${PIN_ROW}`, 'menu', ['.sp-card']), name: names.chooser },
  { ...v('x', '&wpins=lib1', `ctx:.sp-tilebox:nth-child(4) .sp-tile >> ${PIN_ROW}`, 'menu', ['.sp-card']), name: names.chooserEmpty },
  { ...v('x', '&wpins=none', '.sp-tile', 'spotify', ['.sp-card']), name: names.spOpen, listen: true },
  { ...v('x', '&wpins=none', `${TALL} >> .sp-tile`, 'spotify', ['.sp-card']), name: names.spOpenTall },
  { ...v('x', '&wpins=none', `${SWITCH} >> ${TILE}`, 'yt', ['.sp-card', '.yt-songs']), name: names.ytOpen },
  { ...v('x', '&wpins=none', `${SWITCH} >> ${TALL} >> ${TILE}`, 'yt', ['.sp-card', '.yt-songs']), name: names.ytOpenTall },
];

const on = (...n) => (variant) => n.includes(variant.name);

export default {
  name: 'pins-library',
  gallery: { states },
  fit: {
    variants,
    measurements: { pinslibrary: measurePins },
    rules: { pinslibrary: rule },
    breaks: {
      'pins-badge-out': { css: '.u-pin-badge { right: -40px !important; }', expect: /^ *FAIL library pins: a badge at [\d,]+ is outside its pin slot/m, appliesTo: on(names.mixed) },
      'pins-menu-offstrip': { css: '.u-lib-menu { left: 2450px !important; }', expect: /^ *FAIL library pins: the open menu is at [\d,]+, outside the strip/m, appliesTo: on(names.spMenu) },
      'pins-yt-name-squeeze': { css: '.yt-pin { min-width: 400px !important; }', expect: /^ *FAIL library pins: the playlist name is \d+ px wide/m, appliesTo: on(names.ytOpen) },
      'pins-sp-tall-cut': { css: '.sp-songs.tall .sp-backrow .sp-tallpin { flex-basis: 90px !important; width: 90px !important; }', expect: /^ *FAIL library pins: (Pin is \d+ by \d+|the tab name is cut|Pin at [\d,]+ passes the back row)/m, appliesTo: on(names.spOpenTall) },
    },
  },
};
