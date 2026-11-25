// The Live page of the new On Air frame: the show timer, the YouTube chips, the run of show line,
// the comments card with the channel field in it, the notes, the studio keys (row 2) and the lights. Gallery states, fit variants, the
// `onairLive` measurement and its deliberate breaks live here. Every name and comment in the mocks is invented.

const at = encodeURIComponent('2026-11-11T10:24:00-08:00');
const HEAD = 'hz=onair&at=' + at + '&clock=review&weather=ok&screen=onair&oamode=live';
const full = (knobs) => `${HEAD}${/(^|&)show=/.test(knobs) ? '' : '&show=typical'}${/(^|&)marks=/.test(knobs) ? '' : '&marks=2'}${knobs ? '&' + knobs : ''}`;
const state = (name, knobs, expect, actions) => ({ screen: 'onair', name: 'on air live: ' + name, query: full(knobs), custom: true, expect, actions });
const checks = ['.oa2 .oa2-modes', '.oa2 .oa2-comments'];
const variant = (name, knobs, extra = {}) => ({ name: 'On Air live, ' + name, q: '?' + full(knobs), checks: /split=notes/.test(knobs) ? ['.oa2 .oa2-modes', '.oa2 .oa2-rail-comments'] : checks, ...extra });
const isNamed = (n) => (v) => v.name === 'On Air live, ' + n;

const OPEN = '.oa2-cq .oa-btn';
const SAVE = '.oa2-chf-row .oa-btn.cy';
const FIELD = '.oa2-chf-in';

// Runs in the page: nothing here may refer to anything outside this function.
function measureOnAirLive() {
  const fails = [];
  const root = document.querySelector('.oa2');
  const q = new URLSearchParams(location.search);
  const want = q.get('screen') === 'onair' && q.get('oamode') === 'live';
  if (!root || root.getAttribute('data-mode') !== 'live') return want ? ['on air live: the Live page did not open'] : [];
  const r1 = (n) => Math.round(n * 10) / 10;
  const visible = (e) => {
    const b = e.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) return false;
    const cs = getComputedStyle(e);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  };
  const run = root.querySelector('.oa2-runline');
  const runShown = run && visible(run);
  const hasParts = !!run && !run.hasAttribute('hidden');
  // The split: comments + 24 + notes = 1080 from x 800; a folded panel is a 72 px rail. `?split=` picks a fit state in development.
  const SPLITS = { left: [400, 656], right: [740, 316], comments: [984, 72], notes: [72, 984] };
  const [cw, nw] = SPLITS[q.get('split')] || [620, 436];
  const cRail = cw === 72;
  const nRail = nw === 72;
  const nEl = root.querySelector('.oa2-livenotes');
  if (nEl && nEl.getBoundingClientRect().width < 299.5) fails.push('on air live: the notes are ' + r1(nEl.getBoundingClientRect().width) + ' px wide, under their minimum of 300');
  const cEl = root.querySelector('.oa2-comments');
  if (cEl && cEl.getBoundingClientRect().width < 359.5) fails.push('on air live: the comments are ' + r1(cEl.getBoundingClientRect().width) + ' px wide, under their minimum of 360');
  const boxes = {
    '.oa2-showtimer': [124, 76, 640, 166],
    '.oa2-livechips': [124, 250, 640, 36],
    '.oa2-studiostatus': [124, 298, 640, 152],
    ...(cRail ? { '.oa2-rail-comments': [800, 24, 72, 486] } : { '.oa2-comments': [800, 24, cw, 486] }),
    ...(nRail ? { '.oa2-rail-notes': [1808, 24, 72, 486] } : { '.oa2-livenotes': [800 + cw + 24, 24, nw, 486] }),
    '.oa2-studiokeys': [1920, 24, 620, 192],
    '.oa2-stagepop': [1920, 230, 620, 104],
    '.oa2-lights-live': [1920, 348, 620, 154],
    ...(hasParts ? { '.oa2-runline': [124, 458, 640, 46] } : {}),
  };
  for (const [sel, [x, y, w, h]] of Object.entries(boxes)) {
    const el = root.querySelector(sel);
    if (!el) {
      fails.push('on air live: ' + sel + ' is missing');
      continue;
    }
    const b = el.getBoundingClientRect();
    if (Math.abs(b.left - x) > 1 || Math.abs(b.top - y) > 1 || Math.abs(b.width - w) > 1 || Math.abs(b.height - h) > 1) {
      fails.push('on air live: ' + sel + ' is at x ' + r1(b.left) + ', y ' + r1(b.top) + ', ' + r1(b.width) + ' by ' + r1(b.height) + ' and should be at x ' + x + ', y ' + y + ', ' + w + ' by ' + h);
      continue;
    }
    for (const c of el.querySelectorAll('*')) {
      if (!visible(c)) continue;
      const cb = c.getBoundingClientRect();
      if (cb.left < x - 1 || cb.right > x + w + 1 || cb.top < y - 1 || cb.bottom > y + h + 1) {
        fails.push('on air live: ' + sel + ' holds ' + (String(c.className).split(' ')[0] || c.tagName) + ' outside its box (x ' + r1(cb.left) + ' to ' + r1(cb.right) + ', y ' + r1(cb.top) + ' to ' + r1(cb.bottom) + ')');
        break;
      }
    }
  }
  // The run line is not drawn without parts.
  if (run && !hasParts && runShown) fails.push('on air live: the run line is shown with no parts');
  // The handle sits in the gap between the two panels, and only when both show.
  const hd = root.querySelector('.oa2-split-h');
  if (cRail || nRail) {
    if (hd) fails.push('on air live: the split handle is drawn with a panel folded');
  } else if (!hd) fails.push('on air live: the split handle is missing');
  else {
    const b = hd.getBoundingClientRect();
    if (Math.abs(b.left - (800 + cw)) > 1 || Math.abs(b.width - 24) > 1) fails.push('on air live: the split handle is at x ' + r1(b.left) + ', ' + r1(b.width) + ' wide and should be in the 24 px gap at x ' + (800 + cw));
  }
  // Studio keys: row 1 (four StreamYard keys) between the heading and row 2, row 2 (three tiles) at its final y (box top + 98).
  const sk = root.querySelector('.oa2-studiokeys');
  if (sk) {
    const top = sk.getBoundingClientRect().top;
    const r1t = [...sk.querySelectorAll('.oa2-skrow1 .key-tile')];
    const r2t = [...sk.querySelectorAll('.oa2-skrow2 .key-tile')];
    if (r1t.length !== 4) fails.push('on air live: row 1 of the studio keys has ' + r1t.length + ' tiles (it has 4)');
    if (r2t.length > 0 && r2t.length !== 3) fails.push('on air live: row 2 of the studio keys has ' + r2t.length + ' tiles (it has 3)');
    for (const t of r2t) {
      const y = t.getBoundingClientRect().top - top;
      if (Math.abs(y - 98) > 1.5) fails.push('on air live: row 2 tile "' + t.getAttribute('aria-label') + '" is ' + r1(y) + ' px under the box top (its final y is 98)');
    }
    const head = sk.querySelector('.oa2-hd');
    for (const t of r1t) {
      const b = t.getBoundingClientRect();
      if (head && b.top < head.getBoundingClientRect().bottom - 0.5) fails.push('on air live: row 1 tile "' + t.getAttribute('aria-label') + '" overlaps the heading');
      if (b.bottom > top + 98 - 0.5) fails.push('on air live: row 1 tile "' + t.getAttribute('aria-label') + '" reaches into row 2');
    }
    const dim = r1t.filter((t) => t.classList.contains('off')).length;
    if (dim > 0) fails.push('on air live: ' + dim + ' studio keys are dim (none should be)');
  }
  // Comments: a row is at most two lines, no visible row is cut at the top, and eight short rows fit.
  const list = root.querySelector('.oa2-cms[role="log"]');
  if (list) {
    const lt = list.getBoundingClientRect().top;
    const rows = [...list.querySelectorAll(':scope > .oa2-cm')];
    const shown = rows.filter(visible);
    for (const row of rows) {
      const t = row.querySelector('.oa2-cm-t');
      if (t && t.getBoundingClientRect().height > 52.5) {
        fails.push('on air live: a comment row is ' + r1(t.getBoundingClientRect().height) + ' px tall (two lines are 52)');
        break;
      }
    }
    const cut = shown.find((row) => row.getBoundingClientRect().top < lt - 0.5);
    if (cut) fails.push('on air live: a comment row is cut at the top of the list');
    const longRows = rows.some((row) => (row.querySelector('.oa2-cm-t')?.textContent || '').length > 100);
    if (!longRows && rows.length >= 8 && shown.length < 8) fails.push('on air live: only ' + shown.length + ' of ' + rows.length + ' single-line comment rows fit (eight should)');
    const foot = root.querySelector('.oa2-cfoot');
    if (foot && list.getBoundingClientRect().bottom > foot.getBoundingClientRect().top + 0.5) fails.push('on air live: the comments list reaches into its foot');
  }
  // Notes: 27 px, in a card 436 wide.
  const note = root.querySelector('.oa2-livenotes .oa-note');
  if (note && Math.abs(parseFloat(getComputedStyle(note).fontSize) - 27) > 0.6) fails.push('on air live: the notes are ' + getComputedStyle(note).fontSize + ' (27 px)');
  // Every key tile at least 76 by 76 (row 1 of the studio keys is 58 tall: it sits between the heading and row 2), no text under 16 px.
  for (const tile of root.querySelectorAll('.key-tile')) {
    const b = tile.getBoundingClientRect();
    const low = tile.closest('.oa2-skrow1') ? 57.5 : 75.5;
    if (b.height < low || b.width < 75.5) fails.push('on air live: key tile "' + tile.getAttribute('aria-label') + '" is ' + Math.round(b.width) + ' x ' + Math.round(b.height) + ' px (at least ' + Math.round(low + 0.5) + ' high and 76 wide)');
  }
  for (const e of root.querySelectorAll('*')) {
    if (!visible(e)) continue;
    if (![...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent || '').trim())) continue;
    const px = parseFloat(getComputedStyle(e).fontSize);
    if (px < 15.99) {
      fails.push('on air live: "' + (e.textContent || '').trim().slice(0, 28) + '" is ' + px + ' px');
      break;
    }
  }
  // Nothing above wall y 20 or below y 510.
  for (const c of root.querySelectorAll('*')) {
    if (!visible(c)) continue;
    const b = c.getBoundingClientRect();
    if (b.top < 19.5 || b.bottom > 510.5) {
      fails.push('on air live: ' + (String(c.className).split(' ')[0] || c.tagName) + ' is at y ' + r1(b.top) + ' to ' + r1(b.bottom) + ', outside the band y 20 to 510');
      break;
    }
  }
  return fails;
}

export default {
  name: 'onair-live',
  gallery: {
    states: [
      state('live with comments', 'yt=live', ['Live, 37 watching, since 10:02 AM', 'Comments', 'YouTube · read 4 s ago', 'Could you zoom in a little?', 'YouTube only, read every 10 seconds.', 'Show timer', 'Started 10:02 AM, when the broadcast went live.', 'Studio keys', 'Solo', 'Two up', 'Share', 'Go live', 'No key sent yet', 'StreamYard studio', 'Studio window: open (Firefox)', 'The wall cannot see which layout is live. It shows what it sent.', 'Mark a moment', 'Snip', 'Say hello and the one piece of news', '!Name channel']),
      state('studio keys, no window picked', 'yt=none&swin=none', ['Solo', 'Two up', 'Pick window', 'Studio window: not picked', '!Go live?']),
      state('studio keys, window picked', 'yt=none', ['Studio window: open', '!Pick window']),
      state('studio keys, Go live armed', 'yt=none', ['Click again', 'Go live? Click again'], '[data-key="golive"]'),
      state('studio keys, a key sent', 'yt=live', ['Sent: Two up, just now', 'Last key sent: Two up, just now', 'End show'], '[data-key="two"]'),
      state('studio window minimized', 'yt=none&swin=minimized', ['Studio window: minimized']),
      state('busy chat, wrapped rows and a Super Chat', 'yt=busy', ['$5.00', 'Thanks', 'YouTube only, read every 10 seconds.']),
      state('live, no comments yet', 'yt=empty', ['No comments yet. They show here within about 10 seconds of being posted.']),
      state('scheduled', 'yt=scheduled', ['Scheduled, 11:00 AM, in 36 min', 'Chat opens with the broadcast. Scheduled for 11:00 AM on YouTube. Comments show here once it is live.', 'Channel: Sample Studio', 'Change', 'Forget']),
      state('stale', 'yt=stale', ['Live, as of 10:10 AM', 'YouTube · last read 10:10 AM', 'YouTube has not answered for 14 min. These are the last comments read.', 'Check again']),
      state('quota', 'yt=quota', ['YouTube · stopped 9:41 AM', "Today's YouTube reads are used up. Comments stopped here at 9:41 AM."]),
      state('no broadcast, channel named', 'yt=none', ['No YouTube broadcast found. Comments show here when one goes live.', 'Channel: Sample Studio', 'Change', 'Forget']),
      state('no channel', 'yt=notsetup', ['Name your YouTube channel to show its comments here.', 'Name channel', '!Channel:']),
      state('signed out', 'yt=signedout', ['Sign in to YouTube to show comments here.', 'Sign in']),
      state('refused', 'yt=refused', ['YouTube would not let the wall read this chat.', 'Check again']),
      state('channel field, empty', 'yt=notsetup', ['Save', 'Cancel', '!Name channel'], OPEN),
      state('channel field, checking', 'yt=notsetup&ytcheck=1', ['Checking the channel'], `${OPEN} >> type:${FIELD}=@sample-studio >> ${SAVE}`),
      state('channel field, unknown name', 'yt=notsetup', ['YouTube has no channel with that handle'], `${OPEN} >> type:${FIELD}=@nobody-here >> ${SAVE}`),
      state('channel field, not a handle', 'yt=notsetup', ['That is not a handle or a channel link'], `${OPEN} >> type:${FIELD}=hello >> ${SAVE}`),
      state('channel named', 'yt=notsetup', ['Channel: Sample Studio', 'Change', 'Forget', '!Save'], `${OPEN} >> type:${FIELD}=@sample-studio >> ${SAVE}`),
    ],
  },
  fit: {
    variants: [
      variant('live with comments', 'yt=live'),
      variant('busy chat', 'yt=busy'),
      variant('no comments yet', 'yt=empty'),
      variant('scheduled', 'yt=scheduled'),
      variant('stale', 'yt=stale'),
      variant('quota', 'yt=quota'),
      variant('no broadcast', 'yt=none'),
      variant('no channel', 'yt=notsetup'),
      variant('signed out', 'yt=signedout'),
      variant('refused', 'yt=refused'),
      variant('live, no run of show file', 'yt=live&show=missing'),
      variant('live, run of show refused', 'yt=live&show=refused'),
      variant('live, long notes', 'yt=live&show=long'),
      variant('comments dragged left', 'yt=live&split=left'),
      variant('comments dragged right', 'yt=live&split=right'),
      variant('comments full', 'yt=live&split=comments'),
      variant('notes full', 'yt=live&split=notes'),
      variant('busy chat, notes full', 'yt=busy&split=notes'),
      variant('studio keys, window picked', 'yt=live'),
      variant('studio keys, no window', 'yt=none&swin=none'),
      variant('studio window minimized', 'yt=none&swin=minimized'),
      variant('channel field open', 'yt=notsetup', { click: OPEN }),
    ],
    measurements: { onairLive: measureOnAirLive },
    rules: {
      onairLive: (variantEntry, results, emit) => {
        for (const failure of results.onairLive) emit(`  FAIL ${failure}`);
        if (results.onairLive.length) return true;
        if (variantEntry.name.startsWith('On Air live,')) emit('  ok   on air live: every block in its planned box (the split at 620 / 436 or the dragged and folded states, the handle in the gap) inside y 20 to 510, row 1 of the studio keys above row 2 and row 2 at its final y, comment rows at most two lines and none cut, notes 27 px, key tiles at least 76 px, text at least 16 px');
        return false;
      },
    },
    breaks: {
      'onair-cm-cut': { css: '.oa2-cm-t { display: block !important; -webkit-line-clamp: unset !important; overflow: visible !important; }', expect: /^ *FAIL on air live: a comment row is [\d.]+ px tall/m, appliesTo: isNamed('busy chat') },
      'onair-notes-wide': { css: '.oa2 .oa-card.oa2-livenotes { width: 620px !important; }', expect: /^ *FAIL on air live: \.oa2-livenotes is at/m, appliesTo: isNamed('live with comments') },
      'onair-run-file': { css: '.oa2-runline[hidden] { display: flex !important; min-height: 20px; }', expect: /^ *FAIL on air live: the run line is shown with no parts/m, appliesTo: isNamed('live, no run of show file') },
      'onair-split-min': { css: '.oa2 .oa-card.oa2-livenotes { width: 200px !important; }', expect: /^ *FAIL on air live: the notes are [\d.]+ px wide, under their minimum/m, appliesTo: isNamed('live with comments') },
      'onair-keys-move': { css: '.oa2-skrow2 { top: 40px !important; }', expect: /^ *FAIL on air live: row 2 tile ".*" is [\d.]+ px under the box top/m, appliesTo: isNamed('live with comments') },
    },
  },
};
