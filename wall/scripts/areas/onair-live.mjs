// The Live page of the new On Air frame: the show timer, the YouTube chips, the run of show line,
// the comments card with the channel field in it, the notes, the studio keys and the lights. Gallery states, fit variants, the
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
  // A comment row scrolled wholly out of the comments list is not on screen.
  const scrolledOut = (e) => {
    const l = e.closest && e.closest('.oa2-cms[role="log"]');
    if (!l || l === e) return false;
    const b = e.getBoundingClientRect();
    const lb = l.getBoundingClientRect();
    return b.bottom <= lb.top + 0.5 || b.top >= lb.bottom - 0.5;
  };
  // A box as drawn: inside the comments list it is clipped to the list (the list scrolls).
  const drawn = (e) => {
    const b = e.getBoundingClientRect();
    const l = e.closest && e.closest('.oa2-cms[role="log"]');
    if (!l || l === e) return b;
    const lb = l.getBoundingClientRect();
    return { left: b.left, right: b.right, top: Math.max(b.top, lb.top), bottom: Math.min(b.bottom, lb.bottom) };
  };
  const visible = (e) => {
    const b = e.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) return false;
    if (scrolledOut(e)) return false;
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
      const cb = drawn(c);
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
  // Studio keys: eight equal keys, two rows of four, under the heading. Every label is one line high and centred
  // (left and right gaps within 1 px), 16 px, and no key is dim.
  const sk = root.querySelector('.oa2-studiokeys');
  if (sk) {
    const top = sk.getBoundingClientRect().top;
    const tiles = [...sk.querySelectorAll('.oa2-skgrid .key-tile')];
    if (tiles.length !== 8) fails.push('on air live: the studio keys have ' + tiles.length + ' keys (they have 8)');
    const head = sk.querySelector('.oa2-hd');
    const ws = new Set(tiles.map((t) => Math.round(t.getBoundingClientRect().width)));
    const hs = new Set(tiles.map((t) => Math.round(t.getBoundingClientRect().height)));
    if (ws.size > 1 || hs.size > 1) fails.push('on air live: the studio keys are not equal (widths ' + [...ws].join('/') + ', heights ' + [...hs].join('/') + ')');
    const tops = [...new Set(tiles.map((t) => Math.round(t.getBoundingClientRect().top)))];
    if (tiles.length === 8 && tops.length !== 2) fails.push('on air live: the studio keys sit in ' + tops.length + ' rows (they sit in 2)');
    for (const t of tiles) {
      const name = t.getAttribute('data-key');
      const b = t.getBoundingClientRect();
      if (head && b.top < head.getBoundingClientRect().bottom - 0.5) fails.push('on air live: studio key "' + name + '" overlaps the heading');
      if (b.bottom > top + 192 - 0.5) fails.push('on air live: studio key "' + name + '" reaches below the box');
      if (t.hasAttribute('data-kind')) fails.push('on air live: studio key "' + name + '" carries a kind colour');
      if (t.classList.contains('off')) fails.push('on air live: studio key "' + name + '" is dim (none should be)');
      const lbl = t.querySelector('.deck-lbl');
      const ic = t.querySelector('svg');
      if (!lbl) continue;
      const range = document.createRange();
      range.selectNodeContents(lbl);
      const rects = [...range.getClientRects()];
      const lines = new Set(rects.map((r) => Math.round(r.top)));
      if (lines.size > 1) fails.push('on air live: studio key "' + name + '" label is on ' + lines.size + ' lines');
      const lb = rects[0] ? { left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)) } : lbl.getBoundingClientRect();
      const gl = lb.left - b.left;
      const gr = b.right - lb.right;
      if (Math.abs(gl - gr) > 1.01) fails.push('on air live: studio key "' + name + '" label is not centred (gaps ' + r1(gl) + ' and ' + r1(gr) + ')');
      if (lbl.scrollWidth > lbl.clientWidth + 0.5) fails.push('on air live: studio key "' + name + '" label is cut');
      if (lbl.getBoundingClientRect().height > 20.5) fails.push('on air live: studio key "' + name + '" label is ' + r1(lbl.getBoundingClientRect().height) + ' px tall (one line is 20)');
      if (ic && ic.getBoundingClientRect().bottom > lbl.getBoundingClientRect().top + 0.5) fails.push('on air live: studio key "' + name + '" icon is not above its label');
      if (ic) {
        const ib = ic.getBoundingClientRect();
        if (Math.abs(ib.left - b.left - (b.right - ib.right)) > 1.01) fails.push('on air live: studio key "' + name + '" icon is not centred');
      }
    }
  }
  // Comments: handles and text show in full, rows hidden above the list fade (never a hard cut), the newest row is reachable
  // (visible, or by scroll when it is taller than the list), and eight short rows fit.
  const list = root.querySelector('.oa2-cms[role="log"]');
  if (list) {
    const lt = list.getBoundingClientRect().top;
    const rows = [...list.querySelectorAll(':scope > .oa2-cm')];
    for (const row of rows) {
      const rb = row.getBoundingClientRect();
      for (const part of row.querySelectorAll('.oa2-cm-n, .oa2-cm-t')) {
        const pb = part.getBoundingClientRect();
        if (part.scrollWidth > part.clientWidth + 0.5 || getComputedStyle(part).textOverflow === 'ellipsis' || getComputedStyle(part).overflow !== 'visible') {
          fails.push('on air live: a comment row ' + (part.className.includes('-n') ? 'handle' : 'text') + ' is cut');
          break;
        }
        if (pb.left < rb.left - 0.5 || pb.right > rb.right + 0.5) {
          fails.push('on air live: a comment row ' + (part.className.includes('-n') ? 'handle' : 'text') + ' runs outside the row width');
          break;
        }
      }
    }
    const cs = getComputedStyle(list);
    const faded = (cs.maskImage && cs.maskImage !== 'none') || (cs.webkitMaskImage && cs.webkitMaskImage !== 'none');
    const above = rows.some((row) => row.getBoundingClientRect().top < lt - 0.5);
    if (above && (!list.hasAttribute('data-above') || !faded)) fails.push('on air live: a comment row is cut at the top of the list without a fade');
    if (!above && faded) fails.push('on air live: the comments list fades at the top with nothing hidden above');
    const last = rows[rows.length - 1];
    if (last) {
      const lb = last.getBoundingClientRect();
      if (lb.bottom > list.getBoundingClientRect().bottom + 0.5) fails.push('on air live: the newest comment is not at the bottom of the list (' + r1(lb.bottom) + ' vs ' + r1(list.getBoundingClientRect().bottom) + ', scrollTop ' + r1(list.scrollTop) + ', scrollHeight ' + list.scrollHeight + ', client ' + list.clientHeight + ')');
      const handle = last.querySelector('.oa2-cm-n');
      if (handle) {
        const reach = () => {
          const hb = handle.getBoundingClientRect();
          const l = list.getBoundingClientRect();
          return hb.top >= l.top - 0.5 && hb.bottom <= l.bottom + 0.5;
        };
        if (!reach()) {
          const keep = list.scrollTop;
          list.scrollTop = 0;
          const byScroll = reach();
          list.scrollTop = keep;
          if (!byScroll) fails.push('on air live: the newest comment handle cannot be reached by scrolling the list');
        }
      }
    }
    const fullRows = rows.filter((row) => row.getBoundingClientRect().top >= lt - 0.5);
    const longRows = rows.some((row) => (row.querySelector('.oa2-cm-t')?.textContent || '').length > 100);
    // Each row carries a 40 px picture, so in the narrowest card (the list under 400 px) some short rows wrap to two lines: seven must fit there.
    const want = list.getBoundingClientRect().width < 400 ? 7 : 8;
    if (!longRows && rows.length >= want && fullRows.length < want) fails.push('on air live: only ' + fullRows.length + ' of ' + rows.length + ' single-line comment rows fit (' + (want === 8 ? 'eight' : 'seven') + ' should)');
    const foot = root.querySelector('.oa2-cfoot');
    if (foot && list.getBoundingClientRect().bottom > foot.getBoundingClientRect().top + 0.5) fails.push('on air live: the comments list reaches into its foot');
  }
  // Notes: 27 px, in a card 436 wide.
  const note = root.querySelector('.oa2-livenotes .oa-note');
  if (note && Math.abs(parseFloat(getComputedStyle(note).fontSize) - 27) > 0.6) fails.push('on air live: the notes are ' + getComputedStyle(note).fontSize + ' (27 px)');
  // Every key tile at least 74 high and 76 wide, no text under 16 px.
  for (const tile of root.querySelectorAll('.key-tile')) {
    const b = tile.getBoundingClientRect();
    if (b.height < 73.5 || b.width < 75.5) fails.push('on air live: key tile "' + tile.getAttribute('aria-label') + '" is ' + Math.round(b.width) + ' x ' + Math.round(b.height) + ' px (at least 74 high and 76 wide)');
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
    const b = drawn(c);
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
      state('live with comments', 'yt=live', ['Live, 37 watching, since 10:02 AM', 'Comments', 'YouTube · read 4 s ago', 'Could you zoom in a little?', 'YouTube only, read every 10 seconds.', 'Show timer', 'Started 10:02 AM, when the broadcast went live.', 'Studio keys', 'Speaker', 'Presenter', '2 Person', 'Screenshare', 'Mute mic', 'Camera off', 'Go live', 'No key sent yet', 'StreamYard studio', 'Studio window in use: StreamYard in Firefox', 'The wall cannot see which layout is live. It shows what it sent.', 'Mark a moment', 'Say hello and the one piece of news', '!Name channel']),
      state('studio keys, no window picked', 'yt=none&swin=none', ['Speaker', 'Presenter', 'Find window', 'Studio window: no StreamYard window found', '!Go live?']),
      state('studio keys, window picked', 'yt=none', ['Studio window in use: StreamYard in Firefox', 'Find window']),
      state('studio keys, Go live armed', 'yt=none', ['Click again', 'Go live? Click again'], '[data-key="golive"]'),
      state('studio keys, a scene key waits for the add-on', 'yt=live', ['Speaker: Waiting on StreamYard setup', 'End show'], '[data-key="scene1"]'),
      state('studio window minimized', 'yt=none&swin=minimized', ['Studio window: minimized (StreamYard in Firefox)']),
      state('studio keys, several StreamYard windows', 'yt=none&swin=several', ['Find window', 'Studio window: more than one StreamYard window found']),
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
      variant('long handle and long link', 'yt=longlink'),
      variant('newest comment taller than the list', 'yt=tall'),
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
      variant('studio keys, several windows', 'yt=none&swin=several'),
      variant('studio window minimized', 'yt=none&swin=minimized'),
      variant('channel field open', 'yt=notsetup', { click: OPEN }),
    ],
    measurements: { onairLive: measureOnAirLive },
    rules: {
      onairLive: (variantEntry, results, emit) => {
        for (const failure of results.onairLive) emit(`  FAIL ${failure}`);
        if (results.onairLive.length) return true;
        if (variantEntry.name.startsWith('On Air live,')) emit('  ok   on air live: every block in its planned box (the split at 620 / 436 or the dragged and folded states, the handle in the gap) inside y 20 to 510, eight equal studio keys in two rows with one-line centred labels, comment rows shown in full, the top faded when rows are hidden and the newest row reachable, notes 27 px, key tiles at least 76 px, text at least 16 px');
        return false;
      },
    },
    breaks: {
      'onair-cm-cut': { css: '.oa2-cm-t { overflow: hidden !important; height: 20px !important; }', expect: /^ *FAIL on air live: a comment row text is cut/m, appliesTo: isNamed('busy chat') },
      'onair-cm-nofade': { css: ".oa2-cms[data-above] { mask-image: none !important; -webkit-mask-image: none !important; }", expect: /^ *FAIL on air live: a comment row is cut at the top of the list without a fade/m, appliesTo: isNamed('newest comment taller than the list') },
      'onair-cm-noscroll': { css: '.oa2-cms { overflow-y: clip !important; }', expect: /^ *FAIL on air live: the newest comment is not at the bottom of the list/m, appliesTo: isNamed('newest comment taller than the list') },
      'onair-notes-wide': { css: '.oa2 .oa-card.oa2-livenotes { width: 620px !important; }', expect: /^ *FAIL on air live: \.oa2-livenotes is at/m, appliesTo: isNamed('live with comments') },
      'onair-run-file': { css: '.oa2-runline[hidden] { display: flex !important; min-height: 20px; }', expect: /^ *FAIL on air live: the run line is shown with no parts/m, appliesTo: isNamed('live, no run of show file') },
      'onair-split-min': { css: '.oa2 .oa-card.oa2-livenotes { width: 200px !important; }', expect: /^ *FAIL on air live: the notes are [\d.]+ px wide, under their minimum/m, appliesTo: isNamed('live with comments') },
      'onair-keys-rows': { css: '.oa2-skgrid { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }', expect: /^ *FAIL on air live: the studio keys sit in 3 rows/m, appliesTo: isNamed('live with comments') },
    },
  },
};
