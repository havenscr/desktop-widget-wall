// The Shelf's Captures card (shelf/CapturesCard.tsx, look B): the picked capture large on the left (a 392 by 220 picture, its title,
// its "app, time, size" line, Copy, Open and Folder), the other captures as rows on the right. In every state the card is 738 by 485
// at design scale, everything in it stays inside the card, every text is 16 px or larger, and Copy, Open and Folder are 40 to 48 px
// tall. Rows are at least 40 px tall and at most five show. The states: the list, a recording newest, a very long title, a missing
// file (a dimmed row), the newest file missing (no buttons), no history file and an empty history.
const at = encodeURIComponent('2026-11-11T10:24:00-08:00');
const galleryQuery = (knob) => `hz=work&at=${at}&clock=review&weather=ok&screen=shelf&captures=${knob}`;
const fitQuery = (knob) => `?hz=work&at=${at}&clock=review&weather=ok&screen=shelf&captures=${knob}`;
const state = (name, knob, expect, actions) => ({ screen: 'shelf', name: `captures: ${name}`, query: galleryQuery(knob), custom: true, expect, ...(actions ? { actions } : {}) });
const variant = (name, knob, extra = {}) => ({ name, q: fitQuery(knob), checks: ['.shelf-place .shelf-captures'], ...extra });

// What each variant must show: [big title or note, buttons, rows].
const WANT = {
  'Captures, list': { buttons: 3, rows: 5 },
  'Captures, a row picked': { buttons: 3, rows: 5 },
  'Captures, video newest': { buttons: 3, rows: 5 },
  'Captures, long title and app': { buttons: 3, rows: 5 },
  'Captures, a file gone': { buttons: 3, rows: 5, dimmed: 1 },
  'Captures, newest file gone': { buttons: 0, rows: 5 },
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
  return {
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
      state('a row picked', 'list', ['Inbox, flagged for today'], 'hover:.cap-pic >> hover:.cap-row >> .cap-row:nth-child(2)'),
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
      variant('Captures, a row picked', 'list', { click: '.cap-row:nth-child(2)' }),
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
        if (want.rows > 0 && (!m.pic || Math.abs(m.pic.w - 392) > 1 || Math.abs(m.pic.h - 220) > 1)) fails.push('captures: large picture is ' + (m.pic ? m.pic.w + ' by ' + m.pic.h : 'missing') + ', expected 392 by 220');
        if ((want.rows === 0) !== m.note) fails.push('captures: the note line is ' + (m.note ? 'shown' : 'missing') + ' in the wrong state');
        for (const f of fails) emit('  FAIL ' + f);
        if (!fails.length) emit('  ok   captures: card within 738 by 485, ' + m.buttons + ' buttons 40 to 48 px, ' + m.rows + ' rows, text 16 px or larger, all inside the card');
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
