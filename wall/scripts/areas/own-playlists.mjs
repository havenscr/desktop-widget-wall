// Playlists the owner makes on the wall (Part 12: 1D, 2B, 3A, 4C): gallery states for the list, the name row, the play row's
// add menu, the editor, the playing view, the skip note and the end block; fit variants with one in-page measurement and its
// rules; and a deliberate break for each rule. The mock frame never loads a real player (`watch=mock`) and the pictures are
// drawn `data:` motifs through the `ownThumb` seam, so no state reaches YouTube. The knob `wown=` is in `devMocks/watch.ts`.
// Everything this area needs lives here.

const BASE = 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&watch=mock&wlook=sky&wmeta=title';
const PLAY3 = 'wplay=3';
const state = (name, extra, expect, actions) => ({
  screen: 'unwind',
  name: `own playlists: ${name}`,
  query: `${BASE}&${extra}`,
  custom: true,
  ...(typeof expect === 'string' && expect.startsWith('note:') ? { expectNote: expect.slice(5) } : { expect }),
  ...(actions ? { actions } : {}),
});

const states = [
  state('the list, a playlist with its count and the YouTube word', `wown=lists&${PLAY3}`, ['Friday wind down', '12 videos', '5 videos', 'Weekend cooking', 'YouTube', 'New playlist', '6 saved']),
  state('the name row of a new playlist', `wown=draft&${PLAY3}`, 'note:the name field holds its text as a value, not as text; the rest of the list is as in the list state'),
  state('the add menu in the play row', `wown=menu&${PLAY3}`, ['Add this video to', 'Friday wind down', 'Slow mornings', 'New playlist']),
  state('the add menu, a row hovered', `wown=menu&${PLAY3}`, ['Add this video to', 'Add this video to Friday wind down'], 'hover:.w-pop-row'),
  state('the add menu on the lowest saved video opens upward', `wown=rowmenu&${PLAY3}`, ['Add this video to', 'Friday wind down', 'Slow mornings', 'New playlist']),
  state('the add button, hovered', `wown=lists&${PLAY3}`, 'Add to a playlist', 'hover:.w-addpl'),
  state('the editor, twelve videos', `wown=edit&${PLAY3}`, ['Friday wind down', '12 videos · 10 h 13 min', 'named once it has played', 'Plays only on YouTube', 'What is playing', 'From the Watch list', 'Done']),
  state('the editor, a row held by its grip', `wown=drag&${PLAY3}`, ['Friday wind down', 'What is playing']),
  state('the editor, a row dragged to the third place', `wown=edit&${PLAY3}`, ['Friday wind down', 'What is playing'], 'drag:.own-v:nth-child(6) .own-grip@2050,245'),
  state('the editor, a grip hovered', `wown=edit&${PLAY3}`, 'Drag to put it in order', 'hover:.own-grip'),
  state('the editor, From the Watch list', `wown=edit&${PLAY3}`, ['Night drive mix', 'Done'], '.own-chip:nth-child(2)'),
  state('playing, the card follows', 'wown=playing', ['Your playlist · 3 of 12', 'Playing Friday wind down', 'Next', 'Late train through the valley', 'Stops after the last video', '3 of 12']),
  state('playing with repeat on', 'wown=repeat', ['Repeat is on: it starts again after the last video', 'Your playlist · 3 of 12']),
  state('playing, a switch hovered', 'wown=repeat', 'Repeat is on', 'hover:.w-own-switch:nth-child(2)'),
  state('playing, back to the list shows the pill', 'wown=playing', ['3 of 12', 'Friday wind down', '!Stops after the last video'], '.own-back'),
  state('a video skipped, with its note', 'wown=skip', ['Skipped one: it plays only on YouTube', 'Your playlist · 6 of 12']),
  state('the end, the playlist ran out', 'wown=end', ['Your playlist · ended', 'All 12 videos played', 'Stopped after the last video', 'Play again', 'Edit the playlist']),
  state('the end, nothing could play', 'wown=none', ['Your playlist · ended', 'None of these can play here', 'Open in YouTube', 'Edit the playlist']),
  state('the delete question on a row', `wown=lists&${PLAY3}`, ['Delete Friday wind down and its 12 videos?', 'Keep'], '.own-row .w-mini:last-child'),
];

/**
 * In the page (self-contained: it is serialised into the page). With `owncheck=list|row|pill|play|menu|edit|follow|next` the
 * piece of the owner's own playlists that mode names, in wall pixels (the page is the 2560 by 720 wall). Always: no new text
 * under 16 px (the app's own "On" pill at 13 px is not new) and every new button 32 px or more each way.
 *   list    five whole rows at (2015, 68) 510 by 200 and the head button 142 by 32 at (2375, 31)
 *   row     the count and the word "YouTube" inside the row, clear of the pencil
 *   pill    the playing row's "3 of 12" pill inside the row, clear of the pencil
 *   play    the play row 460 wide with the add button, nothing wrapped or cut
 *   menu    the add menu inside 784 to 1084, 300 wide, under the row and above the strip's foot
 *   edit    the card 540 by 630 at (2000, 20), seven whole rows, the chips and the field inside, 12 px over the office slot
 *   rowmenu the add menu opened from a saved video's row: inside the 2560 by 720 stage and not hanging below the card
 *   drag    the whole landing line shows while a row is held (nothing, such as the ghost of the row, covers it)
 *   follow  the two switches 32 by 32 at (2447, 35) and (2485, 35)
 *   next    the Next line ends at or before x 1004
 */
const measureOwn = () => {
  const mode = new URLSearchParams(location.search).get('owncheck');
  if (!mode) return null;
  try {
    return check(mode);
  } catch (e) {
    return { fails: ['the check broke: ' + e.message], mode };
  }
  function check(mode) {
    const fails = [];
    const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const near = (a, b, tol) => Math.abs(a - b) <= tol;
    const num = (n) => Math.round(n * 10) / 10;
    const at = (r) => num(r.l) + ', ' + num(r.t) + ' ' + num(r.w) + ' by ' + num(r.h);
    const q = (sel) => document.querySelector(sel);
    const need = (sel, what) => { const e = q(sel); if (!e) fails.push('no ' + what + ' (' + sel + ')'); return e; };
    // Every new text is 16 px or more, every new button 32 px or more each way (the play row's own buttons are 40).
    const roots = ['.w-card', '.w-pop', '.w-next', '.own-skip', '.own-ended'].flatMap((s) => [...document.querySelectorAll(s)]);
    const small = new Set();
    for (const root of roots) {
      const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let t;
      while ((t = walk.nextNode())) {
        const el = t.parentElement;
        if (!el || !t.textContent.trim() || el.closest('.w-on, .w-vh, .w-explain, .w-forms')) continue;
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size < 15.99) small.add(num(size) + ' px in ' + (el.className || el.tagName));
      }
    }
    if (small.size) fails.push('text under 16 px: ' + [...small].join('; '));
    const tiny = [];
    for (const b of document.querySelectorAll('.w-new, .own-btn, .own-back, .w-own-switch, .own-chip, button.own-grip, .w-pop-row, .own-v .w-mini, .own-row .w-mini, .own-pillbtn, .w-addpl')) {
      const r = R(b);
      if (r.w === 0 || r.h === 0) continue;
      if (r.w < 31.5 || r.h < 31.5) tiny.push((b.className || b.tagName) + ' ' + num(r.w) + ' by ' + num(r.h));
    }
    if (tiny.length) fails.push('a button under 32 px: ' + tiny.join('; '));
    if (mode === 'list') {
      const list = need('.w-list', 'list');
      const btn = need('.w-new', 'New playlist button');
      if (list) {
        const l = R(list);
        if (!near(l.l, 2015, 2) || !near(l.t, 68, 2) || !near(l.w, 510, 3) || !near(l.h, 200, 2)) fails.push('the list is at ' + at(l) + ' (2015, 68 510 by 200)');
        const rows = [...list.querySelectorAll(':scope > li')].filter((li) => R(li).b <= l.b + 0.5 && R(li).t >= l.t - 0.5);
        if (rows.length !== 5) fails.push(rows.length + ' whole rows show (five)');
      }
      if (btn) {
        const b = R(btn);
        if (!near(b.l, 2375, 3) || !near(b.t, 31, 2) || !near(b.w, 142, 3) || !near(b.h, 32, 1)) fails.push('the New playlist button is at ' + at(b) + ' (2375, 31 142 by 32)');
      }
    } else if (mode === 'row' || mode === 'pill') {
      const rows = [...document.querySelectorAll('.own-row')];
      if (rows.length < 2) fails.push('fewer than two playlist rows');
      for (const row of rows) {
        const r = R(row);
        const label = row.querySelector('.w-label');
        const count = row.querySelector('.own-pill, .w-count');
        const minis = [...row.querySelectorAll('.w-mini')].filter((m) => R(m).w > 0);
        if (!label || !count || minis.length < 2) { fails.push('a playlist row lacks its label, count or buttons'); continue; }
        const c = R(count), lb = R(label), pencil = R(minis[0]);
        if (c.l < r.l || c.r > r.r + 0.5 || c.t < r.t - 0.5 || c.b > r.b + 0.5) fails.push('the count is at ' + at(c) + ', outside its row ' + at(r));
        if (c.r > pencil.l + 0.5) fails.push('the count ends at x ' + num(c.r) + ', over the pencil that starts at x ' + num(pencil.l));
        if (lb.r > c.l + 0.5 && lb.w > 0) fails.push('the name overlaps its count');
        if (lb.w < 80) fails.push('the name is only ' + num(lb.w) + ' px wide');
        if (mode === 'pill' && count.classList.contains('own-pill')) {
          if (!near(c.w, 74, 3) || !near(c.h, 26, 1)) fails.push('the pill is ' + num(c.w) + ' by ' + num(c.h) + ' (74 by 26)');
        }
      }
      if (mode === 'pill' && !document.querySelector('.own-pill')) fails.push('no pill on the playing playlist');
    } else if (mode === 'play') {
      const ctl = need('.w-now .w-ctl', 'play row');
      const open = need('.w-open', 'open button');
      const add = need('.w-addpl', 'add button');
      const gear = need('.w-gear', 'gear');
      if (ctl && open && add && gear) {
        const c = R(ctl), o = R(open), a = R(add), g = R(gear);
        if (!near(c.w, 460, 2)) fails.push('the play row is ' + num(c.w) + ' px wide (460)');
        if (ctl.scrollWidth > ctl.clientWidth + 1) fails.push('the play row is cut: ' + ctl.scrollWidth + ' px of content in ' + ctl.clientWidth);
        for (const [n, r] of [['open', o], ['add', a], ['gear', g]]) if (r.r > c.r + 0.5 || r.l < c.l - 0.5) fails.push('the ' + n + ' button is outside the row (' + at(r) + ')');
        if (!near(o.l, 858, 3) || !near(o.w, 114, 3)) fails.push('the open button is at ' + at(o) + ' (858, 267 114 by 40)');
        if (!near(a.l, 978, 3) || !near(a.w, 40, 1) || !near(a.h, 40, 1)) fails.push('the add button is at ' + at(a) + ' (978, 267 40 by 40)');
        if (a.r > g.l + 0.5) fails.push('the add button overlaps the gear');
        if (Math.abs(o.t - a.t) > 1 || Math.abs(o.t - g.t) > 1) fails.push('the buttons are not on one line');
        const text = open.querySelector('.w-open-t');
        if (text && text.scrollWidth > text.clientWidth + 1) fails.push('the open label is cut');
        if (open.getAttribute('aria-label') !== 'Open in YouTube') fails.push('the open button lost its name "Open in YouTube"');
      }
    } else if (mode === 'menu') {
      const menu = need('.w-pop[role="menu"]', 'add menu');
      if (menu) {
        const m = R(menu);
        if (m.l < 783 || m.r > 1085) fails.push('the menu spans x ' + num(m.l) + ' to ' + num(m.r) + ' (784 to 1084)');
        if (!near(m.w, 300, 2)) fails.push('the menu is ' + num(m.w) + ' px wide (300)');
        if (!near(m.t, 313, 3)) fails.push('the menu starts at y ' + num(m.t) + ' (313, 6 px under the row)');
        if (m.b > 660) fails.push('the menu ends at y ' + num(m.b) + ", into the strip's foot");
        const items = [...menu.querySelectorAll('[role="menuitem"]')];
        if (items.length < 3) fails.push('the menu has ' + items.length + ' rows');
        for (const it of items) { const r = R(it); if (r.l < m.l || r.r > m.r + 0.5) fails.push('a menu row is outside the menu'); }
      }
    } else if (mode === 'edit') {
      const card = need('.w-card.own-tall', 'tall card');
      const list = need('.own-vlist', 'video list');
      if (card && list) {
        const c = R(card), l = R(list);
        if (!near(c.l, 2000, 1.5) || !near(c.t, 20, 1.5) || !near(c.w, 540, 1.5) || !near(c.h, 630, 1.5)) fails.push('the card is at ' + at(c) + ' (2000, 20 540 by 630)');
        const slot = q('.u-office-slot');
        if (slot) { const s = R(slot); if (s.t - c.b < 11.5) fails.push('the card ends at y ' + num(c.b) + ', ' + num(s.t - c.b) + ' px over the office slot (12)'); }
        else if (c.b > 650.5) fails.push('the card ends at y ' + num(c.b) + ' (650)');
        const rows = [...list.querySelectorAll('.own-v.two')].filter((r) => R(r).b <= l.b + 0.5 && R(r).t >= l.t - 0.5);
        if (rows.length !== 7) fails.push(rows.length + ' whole rows show (seven)');
        for (const r of rows.slice(0, 1)) { const b = R(r); if (!near(b.w, 506, 2) || !near(b.h, 56, 1)) fails.push('a row is ' + num(b.w) + ' by ' + num(b.h) + ' (506 by 56)'); }
        for (const sel of ['.own-chip', '.own-field']) for (const e of document.querySelectorAll(sel)) { const b = R(e); if (b.b > c.b + 0.5 || b.r > c.r + 0.5 || b.l < c.l - 0.5) fails.push('the ' + sel.slice(1) + ' is outside the card (' + at(b) + ')'); }
        const chip = q('.own-chip');
        if (chip) { const b = R(chip); if (!near(b.t, 547, 2) || !near(b.h, 36, 1)) fails.push('the chips are at y ' + num(b.t) + ', ' + num(b.h) + ' high (547, 36)'); }
        const field = q('.own-field');
        if (field) { const b = R(field); if (!near(b.t, 591, 2) || !near(b.h, 44, 1)) fails.push('the field is at y ' + num(b.t) + ', ' + num(b.h) + ' high (591, 44)'); }
      }
    } else if (mode === 'rowmenu') {
      const menu = need('.w-pop[role="menu"]', 'add menu');
      const card = need('.w-card', 'card');
      if (menu && card) {
        const m = R(menu), c = R(card);
        if (m.l < -0.5 || m.t < -0.5 || m.r > 2560.5 || m.b > 720.5) fails.push('the menu leaves the stage (' + at(m) + ')');
        if (m.b > c.b + 8.5) fails.push('the menu hangs below the card: it ends at y ' + num(m.b) + ', the card at ' + num(c.b) + ' (8 px at most)');
        if (m.l < c.l - 0.5 || m.r > c.r + 0.5) fails.push('the menu is outside the card sideways (' + at(m) + ')');
      }
    } else if (mode === 'drag') {
      const line = need('.own-line-drop', 'landing line');
      if (line) {
        const l = R(line);
        if (!near(l.w, 498, 3)) fails.push('the landing line is ' + num(l.w) + ' px wide (498)');
        const y = l.t + l.h / 2;
        // The whole line shows: the top thing at its left end, its middle and its right end is the line itself.
        // Neither the line nor the ghost takes the pointer, so both are let take it for this read of what is on top.
        const parts = [line, ...document.querySelectorAll('.own-ghost')];
        for (const e of parts) e.style.pointerEvents = 'auto';
        const hidden = [l.l + 3, l.l + l.w / 2, l.r - 3].filter((x) => { const top = document.elementFromPoint(x, y); return !(top && (top === line || line.contains(top))); });
        const over = document.elementFromPoint(l.l + l.w / 2, y);
        for (const e of parts) e.style.pointerEvents = '';
        if (hidden.length) fails.push('the landing line is covered at ' + hidden.length + ' of 3 places by ' + ((over && String(over.className)) || 'something'));
      }
    } else if (mode === 'follow') {
      const sw = [...document.querySelectorAll('.w-own-switch')];
      if (sw.length !== 2) fails.push(sw.length + ' switches in the follow view (two)');
      else {
        for (const [i, x] of [[0, 2447], [1, 2485]]) {
          const b = R(sw[i]);
          if (!near(b.l, x, 2) || !near(b.t, 35, 2) || !near(b.w, 32, 1) || !near(b.h, 32, 1)) fails.push('switch ' + (i + 1) + ' is at ' + at(b) + ' (' + x + ', 35 32 by 32)');
        }
        if (sw.some((s) => s.getAttribute('aria-pressed') === null)) fails.push('a switch has no pressed state');
      }
    } else if (mode === 'next') {
      const next = need('.w-next', 'Next line');
      if (next) {
        const n = R(next);
        if (n.r > 1004.5) fails.push('the Next line ends at x ' + num(n.r) + ' (1004 at most)');
        if (n.h > 29) fails.push('the Next line is ' + num(n.h) + ' px tall (28)');
      }
    }
    return { fails, mode };
  }
};

const OK_LINES = {
  list: 'the list is five whole rows at (2015, 68) 510 by 200 and the New playlist button is 142 by 32 at (2375, 31)',
  row: 'each count and the word YouTube sit inside their row, clear of the pencil',
  pill: "the playing playlist's pill is 74 by 26, inside its row and clear of the pencil",
  play: 'the play row is 460 wide with the add button, nothing wrapped or cut',
  menu: "the add menu is 300 wide inside 784 to 1084, 6 px under the row and above the strip's foot",
  edit: 'the editor card is 540 by 630 at (2000, 20), seven whole rows, the chips and the field inside, 12 px over the office slot',
  rowmenu: "the list row's add menu stays inside the stage and does not hang below the card",
  drag: 'the whole landing line shows above the held row',
  follow: 'the two switches are 32 by 32 at (2447, 35) and (2485, 35)',
  next: 'the Next line ends at or before x 1004',
};

const rule = (variant, results, emit) => {
  const r = results.own;
  if (!r) return false;
  for (const f of r.fails) emit('  FAIL own playlists: ' + f);
  if (r.fails.length) return true;
  emit('  ok   own playlists: ' + OK_LINES[r.mode] + '; every new text 16 px or more, every new button 32 px or more');
  return false;
};

const Q = '?hz=unwind&at=2026-11-11T10:24:00-08:00&long=1&agents=3&watch=mock&wlook=sky&wmeta=title';
const variants = [
  { name: 'Own playlists, the list', q: `${Q}&wown=lists&wplay=3&owncheck=list`, checks: ['.w-new'] },
  { name: 'Own playlists, rows with counts', q: `${Q}&wown=lists&wplay=3&owncheck=row`, checks: ['.own-row'] },
  { name: 'Own playlists, the pill on the playing row', q: `${Q}&wown=pill&owncheck=pill`, checks: ['.own-row .own-pill'] },
  { name: 'Own playlists, the play row', q: `${Q}&wown=lists&wplay=3&owncheck=play`, checks: ['.w-now .w-ctl', '.w-addpl'] },
  { name: 'Own playlists, the add menu', q: `${Q}&wown=menu&wplay=3&owncheck=menu`, checks: ['.w-pop'] },
  { name: 'Own playlists, the editor', q: `${Q}&wown=edit&wplay=3&owncheck=edit`, checks: ['.w-card.own-tall'] },
  { name: "Own playlists, the list row's add menu", q: `${Q}&wown=rowmenu&wplay=3&owncheck=rowmenu`, checks: ['.w-pop'] },
  { name: 'Own playlists, a row held in the editor', q: `${Q}&wown=drag&wplay=3&owncheck=drag`, checks: ['.own-line-drop'] },
  { name: 'Own playlists, the follow view', q: `${Q}&wown=repeat&owncheck=follow`, checks: ['.w-own-switch'] },
  { name: 'Own playlists, the Next line', q: `${Q}&wown=playing&owncheck=next`, checks: ['.w-next'] },
];

const on = (...names) => (v) => names.includes(v.name);

export default {
  name: 'own-playlists',
  gallery: { states },
  fit: {
    variants,
    measurements: { own: measureOwn },
    rules: { own: rule },
    breaks: {
      'own-list-head': { css: '.w-card .u-card-head { margin: 0 !important; }', expect: /^ *FAIL own playlists: the list is at/m, appliesTo: on('Own playlists, the list') },
      'own-row-count': { css: '.w-count { min-width: 300px !important; }', expect: /^ *FAIL own playlists: the (count (ends at x|is at)|name (is only|overlaps))/m, appliesTo: on('Own playlists, rows with counts') },
      'own-pill': { css: '.own-pill { min-width: 300px !important; }', expect: /^ *FAIL own playlists: the (count (ends at x|is at)|name (is only|overlaps))/m, appliesTo: on('Own playlists, the pill on the playing row') },
      'own-play-row': { css: '.w-open-t { min-width: 200px !important; }', expect: /^ *FAIL own playlists: the (play row|open|add|gear)/m, appliesTo: on('Own playlists, the play row') },
      'own-menu-place': { css: '.w-pop { left: -200px !important; }', expect: /^ *FAIL own playlists: the menu spans x/m, appliesTo: on('Own playlists, the add menu') },
      'own-row-menu': { css: '.w-pop { top: 600px !important; }', expect: /^ *FAIL own playlists: the menu (leaves the stage|hangs below the card)/m, appliesTo: on("Own playlists, the list row's add menu") },
      'own-drag-line': { css: '.own-line-drop { z-index: 1 !important; }', expect: /^ *FAIL own playlists: the landing line is covered/m, appliesTo: on('Own playlists, a row held in the editor') },
      'own-editor-height': { css: '.w-card.own-tall { height: 700px !important; }', expect: /^ *FAIL own playlists: the card is at/m, appliesTo: on('Own playlists, the editor') },
      'own-switch-size': { css: '.w-own-switch { width: 24px !important; }', expect: /^ *FAIL own playlists: (switch \d is at|a button under 32 px)/m, appliesTo: on('Own playlists, the follow view') },
      'own-next-width': { css: '.w-next { width: 600px !important; }', expect: /^ *FAIL own playlists: the Next line ends at x/m, appliesTo: on('Own playlists, the Next line') },
      'own-small-text': { css: '.w-own-row .w-sub2 { font-size: 13px !important; }', expect: /^ *FAIL own playlists: text under 16 px/m, appliesTo: on('Own playlists, the editor') },
    },
  },
};
