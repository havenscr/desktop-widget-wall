// The Shelf's Captures card (shelf/CapturesCard.tsx): the picked capture large on the left (the picture grows to fill the card, its
// name and line under it, Copy, Open and Folder pinned to the bottom left at the card's own padding), every capture as a row on the
// right (the list scrolls, never reorders on a click, and the next row peeks out cut at the card bottom). In every state the card is
// 738 by 485 at design scale, everything in it stays inside the card, every text is 16 px or larger, Copy, Open and Folder are 40 to
// 48 px tall, rows are at least 40 px tall, and the top of the large picture lines up with the top of the first row. The states: the
// list, a row picked, the filter menu, the right-click menu, oldest first, a recording newest, a very long title, a missing file (a
// dimmed row), the newest file missing (no buttons), no history file and an empty history.
const at = encodeURIComponent('2026-11-11T10:24:00-08:00');
const galleryQuery = (knob) => `hz=work&at=${at}&clock=review&weather=ok&screen=shelf&captures=${knob}`;
const fitQuery = (knob) => `?hz=work&at=${at}&clock=review&weather=ok&screen=shelf&captures=${knob}`;
const state = (name, knob, expect, actions) => ({ screen: 'shelf', name: `captures: ${name}`, query: galleryQuery(knob), custom: true, expect, ...(actions ? { actions } : {}) });
const variant = (name, knob, extra = {}) => ({ name, q: fitQuery(knob), checks: ['.shelf-place .shelf-captures'], ...extra });

// What each variant must show: [big title or note, buttons, rows].
const WANT = {
  'Captures, list': { buttons: 3, rows: 8, scrolls: true },
  'Captures, a row picked': { buttons: 3, rows: 8, scrolls: true },
  'Captures, filter menu': { buttons: 3, rows: 8, scrolls: true, menu: 4 },
  'Captures, video newest': { buttons: 3, rows: 8, scrolls: true },
  'Captures, long title and app': { buttons: 3, rows: 8, scrolls: true },
  'Captures, a file gone': { buttons: 3, rows: 8, scrolls: true, dimmed: 1 },
  'Captures, newest file gone': { buttons: 0, rows: 8, scrolls: true, dimmed: 1 },
  'Captures, no history file': { buttons: 0, rows: 0 },
  'Captures, empty history': { buttons: 0, rows: 0 },
};

// Runs in the page.
function measureCaptures() {
  const card = document.querySelector('.shelf-place .shelf-captures');
  if (!card) return { found: false };
  const r1 = (n) => Math.round(n * 10) / 10;
  const cb = card.getBoundingClientRect();
  const fails = [];
  for (const e of card.querySelectorAll('*')) {
    const b = e.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) continue;
    if (e.closest('.cap-rows') && e !== card.querySelector('.cap-rows')) continue; // clipped by the scrolling list
    if (b.left < cb.left - 0.5 || b.right > cb.right + 0.5 || b.top < cb.top - 0.5 || b.bottom > cb.bottom + 0.5) {
      fails.push('captures: ' + (e.className || e.tagName) + ' sticks out of the card (' + r1(b.left - cb.left) + ', ' + r1(b.top - cb.top) + ' to ' + r1(b.right - cb.left) + ', ' + r1(b.bottom - cb.top) + ')');
      break;
    }
  }
  const small = [];
  for (const el of card.querySelectorAll('*')) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (own && parseFloat(getComputedStyle(el).fontSize) < 16 - 0.01) small.push(el.className || el.tagName);
  }
  if (small.length) fails.push('captures: ' + small.length + ' texts under 16 px (' + small.slice(0, 3).join(', ') + ')');
  const buttons = [...card.querySelectorAll('.cap-act')];
  for (const b of buttons) {
    const h = b.getBoundingClientRect().height;
    if (h < 39.5 || h > 48.5) fails.push('captures: button "' + b.textContent.trim() + '" is ' + r1(h) + ' px tall (40 to 48)');
  }
  const rows = [...card.querySelectorAll('.cap-row')];
  for (const r of rows) {
    const b = r.getBoundingClientRect();
    if (b.height < 39.5) fails.push('captures: a row is ' + r1(b.height) + ' px tall (at least 40)');
    const rt = r.querySelector('.cap-rt');
    const th = r.querySelector('.cap-img, .cap-tile');
    if (rt && th && rt.getBoundingClientRect().left < th.getBoundingClientRect().right - 0.5) fails.push('captures: a row title runs under its picture');
  }
  const pic = card.querySelector('.cap-pic');
  const pb = pic ? pic.getBoundingClientRect() : null;
  const list = card.querySelector('.cap-rows');
  const lb = list ? list.getBoundingClientRect() : null;
  const first = rows[0] ? rows[0].getBoundingClientRect() : null;
  // A row cut by the bottom edge of the list: the scroll hint.
  const peek = lb ? rows.some((r) => { const b = r.getBoundingClientRect(); return b.top < lb.bottom - 4 && b.bottom > lb.bottom + 4; }) : false;
  const acts = card.querySelector('.cap-acts');
  const ab = acts ? acts.getBoundingClientRect() : null;
  const sel = rows.filter((r) => r.classList.contains('sel')).length;
  return {
    topGap: pb && first ? r1(Math.abs(pb.top - first.top)) : null,
    bottomGap: ab ? r1(cb.bottom - ab.bottom) : null,
    leftGap: ab ? r1(ab.left - cb.left) : null,
    cardPad: r1(parseFloat(getComputedStyle(card).paddingBottom)) + 1,
    listBottomGap: lb ? r1(cb.bottom - lb.bottom) : null,
    peek,
    scrolls: list ? list.scrollHeight > list.clientHeight + 2 : false,
    sel,
    menuRows: card.querySelectorAll('.cap-menu [role="menuitem"]').length,
    found: true,
    fails,
    width: r1(cb.width),
    height: r1(cb.height),
    buttons: buttons.length,
    rows: rows.length,
    dimmed: rows.filter((r) => r.classList.contains('gone')).length,
    pic: pb ? { w: r1(pb.width), h: r1(pb.height) } : null,
    note: !!card.querySelector('.shelf-note'),
  };
}

export default {
  name: 'captures',
  gallery: {
    states: [
      state('list', 'list', ['Captures', 'Sales overview, region slicer', 'Copy', 'Open', 'Folder', 'Microsoft Edge', 'Outlook']),
      state('a row picked, the list stays put', 'list', ['Inbox, flagged for today', 'Power BI Desktop'], '.cap-row:nth-child(3) >> is:.cap-row:nth-child(1):not(.sel) >> is:.cap-row.sel:nth-child(3)'),
      state('click the picture, Copied', 'list', ['Copied'], '.cap-pic'),
      state('sort and filter buttons shown', 'list', ['Captures'], 'hover:.cap-tools >> is:.cap-tool'),
      state('filter menu open', 'list', ['Images', 'Video', 'GIF', 'All'], 'hover:.cap-tools >> .cap-tool:nth-child(2) >> is:.cap-menu'),
      state('filter: video only', 'list', ['Agent review walkthrough'], 'hover:.cap-tools >> .cap-tool:nth-child(2) >> .cap-menu .cap-menu-item:nth-child(3) button >> is:.cap-row'),
      state('right-click menu open', 'list', ['Copy image', 'Copy as file', 'Copy path', 'Open', 'Edit in ShareX', 'Pin to screen', 'Copy text (OCR)', 'Show in folder', 'Move to Recycle Bin'], 'ctx:.cap-row:nth-child(3) >> is:.cap-menu'),
      state('right-click menu, recycle bin armed', 'list', ['Click again to move to Recycle Bin'], 'ctx:.cap-row:nth-child(3) >> .cap-menu .cap-menu-item:nth-child(9) button'),
      state('sorted oldest first', 'list', ['ShareX, oldest first', 'Settings, display'], 'hover:.cap-tools >> .cap-tool:nth-child(1)'),
      state('video newest', 'video', ['Sales overview, region slicer', 'Video']),
      state('long title and app', 'long', ['Quarterly sales overview']),
      state('a file gone', 'gone', ['File moved or deleted']),
      state('newest file gone', 'gonebig', ['File moved or deleted']),
      state('no history file', 'nohistory', ['ShareX history not found on this PC']),
      state('empty history', 'empty', ['No captures yet. Use the keys beside this card.']),
    ],
  },
  fit: {
    variants: [
      variant('Captures, list', 'list'),
      variant('Captures, a row picked', 'list', { click: '.cap-row:nth-child(3)' }),
      variant('Captures, filter menu', 'list', { click: '.cap-tools .cap-tool:nth-child(2)' }),
      variant('Captures, video newest', 'video'),
      variant('Captures, long title and app', 'long'),
      variant('Captures, a file gone', 'gone'),
      variant('Captures, newest file gone', 'gonebig'),
      variant('Captures, no history file', 'nohistory'),
      variant('Captures, empty history', 'empty'),
    ],
    measurements: { captures: measureCaptures },
    rules: {
      captures: (variantEntry, results, emit) => {
        const want = WANT[variantEntry.name];
        if (!want) return false;
        const m = results.captures;
        if (!m || !m.found) { emit('  FAIL captures: the card is not shown'); return true; }
        const fails = [...m.fails];
        if (m.width > 741 || m.height > 487) fails.push('captures: card is ' + m.width + ' by ' + m.height + ' px, over the 738 by 485 design size (a 2 px border is allowed)');
        if (m.buttons !== want.buttons) fails.push('captures: ' + m.buttons + ' action buttons, expected ' + want.buttons);
        if (m.rows !== want.rows) fails.push('captures: ' + m.rows + ' rows, expected ' + want.rows);
        if ((want.dimmed || 0) !== m.dimmed) fails.push('captures: ' + m.dimmed + ' dimmed rows, expected ' + (want.dimmed || 0));
        if (want.rows > 0 && (!m.pic || m.pic.w < 330 || m.pic.h < 200)) fails.push('captures: large picture is ' + (m.pic ? m.pic.w + ' by ' + m.pic.h : 'missing') + ', expected at least 330 by 200 (it grows to fill the card)');
        if (want.rows > 0 && m.topGap !== null && m.topGap > 1) fails.push('captures: the top of the large picture and the top of the first row are ' + m.topGap + ' px apart (they line up)');
        if (want.buttons > 0 && (Math.abs(m.bottomGap - m.cardPad) > 2.5 || Math.abs(m.leftGap - (m.cardPad + 26 - 20)) > 2.5)) fails.push('captures: the buttons sit ' + m.leftGap + ' px from the left and ' + m.bottomGap + ' px from the bottom of the card (the card padding is ' + m.cardPad + ')');
        if (want.scrolls && !m.scrolls) fails.push('captures: the list does not scroll');
        if (want.scrolls && !m.peek) fails.push('captures: no row peeks out cut at the bottom of the list');
        if (want.scrolls && m.listBottomGap > m.cardPad + 2.5) fails.push('captures: the list stops ' + m.listBottomGap + ' px above the card bottom (it runs to the bottom)');
        if (want.rows > 0 && m.sel !== 1) fails.push('captures: ' + m.sel + ' rows are marked selected, expected 1');
        if ((want.menu || 0) !== m.menuRows) fails.push('captures: ' + m.menuRows + ' menu rows, expected ' + (want.menu || 0));
        if ((want.rows === 0) !== m.note) fails.push('captures: the note line is ' + (m.note ? 'shown' : 'missing') + ' in the wrong state');
        for (const f of fails) emit('  FAIL ' + f);
        if (!fails.length) emit('  ok   captures: card within 738 by 485, ' + m.buttons + ' buttons 40 to 48 px, ' + m.rows + ' rows, the tops line up, text 16 px or larger, all inside the card');
        return fails.length > 0;
      },
    },
    breaks: {
      'captures-button-small': {
        css: '.cap-act { height: 24px !important; }',
        expect: /^ *FAIL captures: button ".*" is [\d.]+ px tall/m,
        appliesTo: (v) => v.name === 'Captures, list',
      },
      'captures-text-small': {
        css: '.cap-rt span { font-size: 12px !important; }',
        expect: /^ *FAIL captures: \d+ texts under 16 px/m,
        appliesTo: (v) => v.name === 'Captures, list',
      },
    },
  },
};
