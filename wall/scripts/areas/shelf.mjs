// The Shelf place (screens/ShelfPlace.tsx): captures, the ShareX keys and the task lists, with the picked list in the task
// column. It must keep the captures card, the keys and lists card and the task column inside the top band (above the strip),
// each part inside its own card, the three cards on one bottom edge, every text at 16 px or larger, and every key at least 40 by 40 px.
const at = encodeURIComponent('2026-11-11T10:24:00-08:00');
const LISTS = 'shelflists=' + encodeURIComponent('Tasks (To-Do);Tax / Business;House, garden');
const MANY = 'shelflists=' + encodeURIComponent(['Tasks (To-Do)', 'Tax / Business', 'House, garden', 'Errands', 'Reading list', 'Someday maybe', 'Waiting on others', 'W'.repeat(60)].join(';'));
// Every state starts on Recent files unless it asks for Dictations, whatever an earlier state left in the browser.
const mode = (knobs) => (knobs.includes('shelfmode=') ? knobs : `${knobs}&shelfmode=files`);
const galleryQuery = (knobs) => `hz=work&at=${at}&clock=review&weather=ok&screen=shelf&${mode(knobs)}`;
const fitQuery = (knobs) => `?hz=work&at=${at}&clock=review&weather=ok&screen=shelf&${mode(knobs)}`;
const DICT = 'shelfmode=dictations';
const checks = ['.shelf-place .rf-card', '.shelf-place .shelf-captures', '.shelf-place .shelf-side', '.shelf-place .right-wing'];
const state = (name, knobs, expect, actions) => ({ screen: 'shelf', name, query: galleryQuery(knobs), custom: true, expect, actions });
const variant = (name, knobs, extra = {}) => ({ name, q: fitQuery(knobs), checks, ...extra });

function measureShelf() {
  const fails = [];
  const want = new URLSearchParams(location.search).get('screen') === 'shelf';
  const root = document.querySelector('.shelf-place');
  if (!root) return want ? ['shelf: the place did not open'] : [];
  const rib = document.querySelector('.rib');
  const floor = Math.min(510, rib ? rib.getBoundingClientRect().top : 720);
  const r1 = (n) => Math.round(n * 10) / 10;
  for (const sel of ['.rf-card', '.shelf-captures', '.shelf-side', '.right-wing']) {
    const col = root.querySelector(sel);
    if (!col) { fails.push('shelf: ' + sel + ' is missing'); continue; }
    const cb = col.getBoundingClientRect();
    if (cb.left < 124 - 0.5 || cb.right > 2540 + 0.5 || cb.top < 19.5 || cb.bottom > floor + 0.5) fails.push('shelf: ' + sel + ' at x ' + r1(cb.left) + ' to ' + r1(cb.right) + ', y ' + r1(cb.top) + ' to ' + r1(cb.bottom) + ' is outside the band (y 20 to ' + r1(floor) + ')');
    if (sel === '.right-wing') continue;
    for (const e of col.querySelectorAll('*')) {
      const b = e.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) continue;
      // A row a scroll away sits past its list's clip on purpose; the list itself is still checked.
      if (e !== col && e.parentElement && e.closest('.rf-rows, .cap-rows, .dc-rows') && e.closest('.rf-rows, .cap-rows, .dc-rows') !== e) { const sc = e.closest('.rf-rows, .cap-rows, .dc-rows'); const sb = sc.getBoundingClientRect(); if (b.bottom > sb.bottom + 0.5 || b.top < sb.top - 0.5) continue; }
      if (b.left < cb.left - 0.5 || b.right > cb.right + 0.5 || b.bottom > cb.bottom + 0.5) { fails.push('shelf: ' + sel + ' ' + (e.className || e.tagName) + ' sticks out of its card'); break; }
    }
  }
  // The Recent files card sits under the clock and date line, shows five rows in view and scrolls for the rest.
  const rf = root.querySelector('.rf-card');
  const clk = document.querySelector('.clk-date');
  if (rf && clk) {
    const cr = clk.getBoundingClientRect();
    if (rf.getBoundingClientRect().top < cr.bottom - 0.5) fails.push('shelf: the Recent files card at y ' + r1(rf.getBoundingClientRect().top) + ' overlaps the date line under the clock (ends y ' + r1(cr.bottom) + ')');
  }
  const rfList = root.querySelector('.rf-card .rf-rows');
  if (rf && rfList) {
    const lb = rfList.getBoundingClientRect();
    const rows = [...rfList.querySelectorAll('.rf-row')];
    const inView = rows.filter((r) => { const b = r.getBoundingClientRect(); return b.top >= lb.top - 0.5 && b.bottom <= lb.bottom + 0.5; }).length;
    if (inView < Math.min(5, rows.length)) fails.push('shelf: ' + inView + ' recent file rows in view, expected at least ' + Math.min(5, rows.length));
    const cb = rf.getBoundingClientRect();
    if (cb.bottom > floor + 0.5) fails.push('shelf: the Recent files card ends at y ' + r1(cb.bottom) + ', below the band (y ' + r1(floor) + ')');
    // The shared scrollbar: 6 px of bar behind a 14 px gap, so a row (and its Folder button) ends 14 px before the bar when the list scrolls.
    if (rfList.scrollHeight > rfList.clientHeight + 1) {
      const barWide = rfList.offsetWidth - rfList.clientWidth - 2 * (parseFloat(getComputedStyle(rfList).borderLeftWidth) || 0);
      if (barWide < 20 - 0.5) fails.push('shelf: the Recent files scrollbar takes ' + r1(barWide) + ' px, expected 14 px of gap and 6 px of bar');
      const edge = lb.left + rfList.clientWidth;
      for (const r of rows) { const b = r.getBoundingClientRect(); if (b.right > edge + 0.5) { fails.push('shelf: a recent file row ends at x ' + r1(b.right) + ', less than 14 px clear of the scrollbar (x ' + r1(edge + 14) + ')'); break; } }
    }
  }
  // Dictations: rows clear of the bar, Copy and Raw labels 10 px from their button edges, the hover card inside the band.
  const dcList = root.querySelector('.rf-card .dc-rows');
  if (dcList) {
    const lb = dcList.getBoundingClientRect();
    const rows = [...dcList.querySelectorAll('.dc-row')];
    const inView = rows.filter((r) => { const b = r.getBoundingClientRect(); return b.top >= lb.top - 0.5 && b.bottom <= lb.bottom + 0.5; }).length;
    if (inView < Math.min(3, rows.length)) fails.push('shelf: ' + inView + ' dictation rows in view, expected at least ' + Math.min(3, rows.length));
    const edge = lb.left + dcList.clientWidth;
    for (const r of rows) { const b = r.getBoundingClientRect(); if (b.right > edge + 0.5) { fails.push('shelf: a dictation row ends at x ' + r1(b.right) + ', past the list edge (x ' + r1(edge) + ')'); break; } }
    if (dcList.scrollHeight > dcList.clientHeight + 1) {
      const barWide = dcList.offsetWidth - dcList.clientWidth - 2 * (parseFloat(getComputedStyle(dcList).borderLeftWidth) || 0);
      if (barWide < 20 - 0.5) fails.push('shelf: the dictations scrollbar takes ' + r1(barWide) + ' px, expected 14 px of gap and 6 px of bar');
    }
    const textBox = rows[0] && rows[0].querySelector('.dc-text');
    const btns = rows[0] ? [...rows[0].querySelectorAll('.dc-btn')] : [];
    if (textBox && btns.length) {
      const tb = textBox.getBoundingClientRect();
      for (const k of btns) if (k.getBoundingClientRect().left < tb.right - 0.5) { fails.push('shelf: a dictation button overlaps the text'); break; }
      if (tb.width < 120) fails.push('shelf: the dictation text is only ' + r1(tb.width) + ' px wide');
    }
  }
  for (const k of root.querySelectorAll('.dc-btn, .rf-opt, .cap-step-btns button')) {
    const b = k.getBoundingClientRect();
    if (b.width === 0) continue;
    if (b.height < 39.5) fails.push('shelf: the button "' + k.textContent.trim() + '" is ' + r1(b.height) + ' px tall (at least 40)');
    // The label never touches its button's edge: at least 10 px of room on each side of its text.
    const range = document.createRange();
    const walker = document.createTreeWalker(k, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      range.selectNodeContents(n);
      const t = range.getBoundingClientRect();
      const room = Math.min(t.left - b.left, b.right - t.right);
      if (room < 10 - 0.01) fails.push('shelf: the label "' + n.textContent.trim() + '" is ' + r1(room) + ' px from its button edge (at least 10)');
    }
  }
  const qs = new URLSearchParams(location.search);
  if (qs.get('shelfmode') === 'dictations' && !qs.get('dict') && !root.querySelector('.dc-row')) fails.push('shelf: Dictations is on but no dictation row is drawn');
  const dcard = document.querySelector('.dc-card');
  if ((qs.get('click') || '').startsWith('rest:') && !dcard) fails.push('shelf: the dictation hover card did not open');
  if (dcard) {
    const cb = dcard.getBoundingClientRect();
    if (cb.left < 124 - 0.5 || cb.right > 2540 + 0.5 || cb.top < 19.5 || cb.bottom > floor + 0.5) fails.push('shelf: the dictation hover card at x ' + r1(cb.left) + ' to ' + r1(cb.right) + ', y ' + r1(cb.top) + ' to ' + r1(cb.bottom) + ' is outside the band (y 20 to ' + r1(floor) + ')');
    if (rf && cb.left < rf.getBoundingClientRect().right - 0.5) fails.push('shelf: the dictation hover card covers the Recent files card');
    for (const e of dcard.querySelectorAll('*')) {
      if (e.closest('.dc-card-text') && e.closest('.dc-card-text') !== e) continue;
      const b = e.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) continue;
      if (b.left < cb.left - 0.5 || b.right > cb.right + 0.5 || b.bottom > cb.bottom + 0.5) { fails.push('shelf: the dictation hover card ' + (e.className || e.tagName) + ' sticks out of the card'); break; }
    }
  }
  // The three Shelf cards share one bottom edge.
  const bottoms = ['.rf-card', '.shelf-captures', '.shelf-side'].map((sel) => { const el = root.querySelector(sel); return el ? el.getBoundingClientRect().bottom : null; });
  if (bottoms.every((b) => b !== null) && Math.max(...bottoms) - Math.min(...bottoms) > 2) fails.push('shelf: the Recent files, Captures and Capture keys cards end at y ' + bottoms.map(r1).join(', ') + ', not one shared bottom edge (within 2 px)');
  // The Capture keys card fills to its bottom: no large empty area under the last key row.
  const side = root.querySelector('.shelf-side');
  const lastMore = [...root.querySelectorAll('.shelf-more .shelf-key')].pop();
  if (side && lastMore) { const gap = side.getBoundingClientRect().bottom - lastMore.getBoundingClientRect().bottom; if (gap > 60) fails.push('shelf: ' + r1(gap) + ' px of empty card under the last ShareX key row'); }
  // The picked list uses Home's 40 px rows and carries the shared Later today switch in its heading.
  const taskRows = [...root.querySelectorAll('.right-wing .tasks .tk3')];
  if (taskRows.length) {
    if (taskRows.some((li) => Math.abs(li.getBoundingClientRect().height - 40) > 0.6)) fails.push('shelf: the task rows are not 40 px tall');
    if (!root.querySelector('.right-wing .tasks .od-sw')) fails.push('shelf: the Later today switch is missing from the picked list');
  }
  // A long list name stays on one line beside the switch: the heading is one line tall and the name does not push the switch out.
  const hd = root.querySelector('.right-wing .tasks-hd');
  const hdName = hd && hd.querySelector('.k');
  if (hd && hdName) {
    if (hdName.getBoundingClientRect().height > 36) fails.push('shelf: the list name in the task heading wraps onto more than one line');
    if (hd.getBoundingClientRect().height > 36) fails.push('shelf: the task heading is ' + Math.round(hd.getBoundingClientRect().height) + ' px tall (one line)');
    const swEl = hd.querySelector('.od-sw');
    if (swEl && swEl.getBoundingClientRect().right > hd.getBoundingClientRect().right + 0.5) fails.push('shelf: the Later today switch is pushed out of the heading by the list name');
  }
  const small = [];
  for (const el of root.querySelectorAll('.shelf-centre *, .right-wing .tasks *, .rf-card *')) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (own && parseFloat(getComputedStyle(el).fontSize) < 16 - 0.01) small.push(el.className || el.tagName);
  }
  if (small.length) fails.push('shelf: ' + small.length + ' texts under 16 px (' + small.slice(0, 3).join(', ') + ')');
  const keys = [...root.querySelectorAll('.shelf-key')];
  if (keys.length !== 14) fails.push('shelf: ' + keys.length + ' ShareX keys, expected 14 (six and eight more)');
  const more = [...root.querySelectorAll('.shelf-more .shelf-key')];
  if (more.length !== 8) fails.push('shelf: ' + more.length + ' more ShareX keys, expected 8');
  else {
    const tops = new Set(more.map((k) => Math.round(k.getBoundingClientRect().top)));
    if (tops.size !== 2) fails.push('shelf: the eight more keys are not in two rows of four');
  }
  if (root.querySelector('.shelf-lists, .shelf-list')) fails.push('shelf: the list chips are still under the keys');
  const pickBtn = root.querySelector('.right-wing .tasks-hd .lp-btn');
  if (hd && !pickBtn) fails.push('shelf: the list name in the heading is not a button');
  if (pickBtn && (pickBtn.getAttribute('aria-haspopup') !== 'listbox' || pickBtn.getBoundingClientRect().height < 20)) fails.push('shelf: the list button has no listbox popup or is too small');
  const menu = root.querySelector('.lp-menu');
  if (menu) {
    const mb = menu.getBoundingClientRect();
    if (mb.top < 19.5 || mb.bottom > 720 + 0.5 || mb.right > 2540 + 0.5) fails.push('shelf: the list menu at y ' + r1(mb.top) + ' to ' + r1(mb.bottom) + ' is outside the strip');
    const hb = hd.getBoundingClientRect();
    if (mb.top < hb.bottom - 0.5) fails.push('shelf: the list menu overlaps the heading');
    for (const o of menu.querySelectorAll('[role=option]')) {
      if (Math.abs(o.getBoundingClientRect().height - 44) > 0.6) { fails.push('shelf: a list menu row is not 44 px tall'); break; }
    }
    if (hd.getBoundingClientRect().height > 36) fails.push('shelf: the heading grew while the menu is open');
  }
  for (const k of keys) {
    const b = k.getBoundingClientRect();
    if (b.height < 39.5 || b.width < 39.5) fails.push('shelf: key "' + k.getAttribute('aria-label') + '" is ' + Math.round(b.width) + ' x ' + Math.round(b.height) + ' px (at least 40 by 40)');
    // The label never touches the key's edge: at least 10 px of room on each side of its text.
    const range = document.createRange();
    for (const n of k.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      range.selectNodeContents(n);
      const t = range.getBoundingClientRect();
      const room = Math.min(t.left - b.left, b.right - t.right);
      if (room < 10 - 0.01) fails.push('shelf: the label "' + n.textContent.trim() + '" is ' + r1(room) + ' px from its key edge (at least 10)');
    }
  }
  return fails;
}

export default {
  name: 'shelf',
  gallery: { states: [
    state('shelf: three lists, first picked', LISTS, ['Captures', 'Region', 'Screen', 'GIF', 'Record', 'Text (OCR)', 'History', 'Tasks (To-Do)', 'Tax / Business', 'House, garden', 'Later today', 'Always here', 'Recent files', 'Quarterly review.pptx', 'Budget 2027.xlsx', 'Meeting notes.docx', 'Yesterday'], ['.lp-btn']),
    state('shelf: recent files with icons', LISTS, ['Recent files', 'newest first', 'Launch teaser.mp4', 'Podcast intro.mp3'], ['.rf-card']),
    state('shelf: recent files: hover preview', LISTS, ['Recent files', 'Budget 2027.xlsx'], ['hover:.rf-row:nth-child(2) .rf-open >> wait:700 >> is:.rf-preview']),
    state('shelf: dictations showing', LISTS + '&' + DICT, ['Dictations', 'Recent files', 'newest first', 'Thanks for the notes', 'Copy', 'Raw', 'Outlook'], ['.rf-card']),
    state('shelf: dictations: hover card open', LISTS + '&' + DICT, ['Dictations', 'Cleaned', 'What you said', 'Copy cleaned', 'Copy raw'], ['hover:.dc-row:nth-child(1) .dc-text >> wait:900 >> is:.dc-card']),
    state('shelf: dictations: hover card on a long text', LISTS + '&' + DICT, ['Cleaned', 'What you said', 'Copy cleaned'], ['hover:.dc-row:nth-child(4) .dc-text >> wait:900 >> is:.dc-card']),
    state('shelf: dictations: Wispr Flow changed its format', LISTS + '&' + DICT + '&dict=changed', ['Dictations', 'Wispr Flow changed its history format. The wall cannot read it yet.']),
    state('shelf: dictations: the read is busy', LISTS + '&' + DICT + '&dict=busy', ['Could not read the Wispr Flow history.', 'Try again']),
    state('shelf: share link, second step in the capture menu', LISTS, ['Anyone with the link can see this.', 'Uploads to go-ae.org and copies the link.', 'Share link', 'Back'], ['ctx:.cap-row:nth-child(2)', '.cap-menu [data-item=share]']),
    state('shelf: share link, link copied', LISTS, ['Link copied'], ['ctx:.cap-row:nth-child(2)', '.cap-menu [data-item=share]', '.cap-step-go', 'wait:300']),
    state('shelf: share link, no key saved', LISTS + '&share=nokey', ['Add the share key in Tools first.'], ['ctx:.cap-row:nth-child(2)', '.cap-menu [data-item=share]', '.cap-step-go', 'wait:300']),
    state('shelf: share link, key refused', LISTS + '&share=badkey', ['go-ae.org refused the share key. Check it in Tools.'], ['ctx:.cap-row:nth-child(2)', '.cap-menu [data-item=share]', '.cap-step-go', 'wait:300']),
    state('shelf: lists from the task app', 'x=1', ['Tasks (To-Do)', 'Tax / Business', 'House, garden', 'Region'], ['.lp-btn']),
    state('shelf: recent files empty', LISTS + '&recent=empty', ['Recent files', 'No recent files']),
    state('shelf: recent files unavailable', LISTS + '&recent=down', ['Recent files', 'Recent files unavailable']),
    state('shelf: second list picked', LISTS, ['Tax / Business', 'File the quarterly return'], ['.lp-btn', '.lp-menu [role=option]:nth-child(2)']),
    state('shelf: a 60 character list name stays on one line beside the switch', MANY, ['Later today', 'Always here'], ['.lp-btn', '.lp-menu [role=option]:nth-child(8)']),
    state('shelf: the list menu open', LISTS, ['Tasks (To-Do)', 'Tax / Business', 'House, garden', 'Later today'], ['.lp-btn']),
    state('shelf: the list menu open with eight lists', MANY, ['Errands', 'Reading list', 'Later today'], ['.lp-btn']),
    state('shelf: more ShareX keys', LISTS, ['More ShareX', 'Scroll', 'Color', 'Last', 'Ruler', 'Pin', 'Highlight', 'Folder', 'Stop rec'], ['.shelf-more']),
    state('shelf: at rest, scrollbars hidden', LISTS, ['Recent files', 'Captures', 'Stop rec']),
    state('shelf: pointer over Recent files, scrollbar shown', LISTS, ['Recent files', 'Quarterly review.pptx'], ['hover:.rf-rows >> wait:800']),
    state('shelf: pointer over Captures, scrollbar shown and not faded', LISTS, ['Captures', 'Copy'], ['hover:.cap-rows >> wait:800']),
  ] },
  fit: {
    variants: [
      variant('Shelf, three lists', LISTS),
      variant('Shelf, eight lists with a 60 character name', MANY),
      variant('Shelf, lists from the task app', 'x=1'),
      variant('Shelf, a very long recent file name', LISTS + '&recent=long'),
      variant('Shelf, Dictations', LISTS + '&' + DICT),
      variant('Shelf, Dictations with the details card open', LISTS + '&' + DICT, { click: 'rest:.dc-row:nth-child(4)' }),
      variant('Shelf, Dictations, Wispr Flow not installed', LISTS + '&' + DICT + '&dict=not-installed'),
      variant('Shelf, Watt set down at the far right', LISTS + '&wattspot=2300'),
      variant('Shelf, Share link second step', LISTS, { click: 'ctx:.cap-row:nth-child(2) >> .cap-menu [data-item=share]' }),
    ],
    measurements: { shelf: measureShelf },
    rules: {
      shelf: (variantEntry, results, emit) => {
        for (const failure of results.shelf) emit(`  FAIL ${failure}`);
        if (results.shelf.length) return true;
        if (variantEntry.name.startsWith('Shelf,')) emit('  ok   shelf: cards inside the band, text 16 px or larger, ten keys at least 40 px');
        return false;
      },
    },
    breaks: {
      'shelf-edge': { css: '.shelf-place .rf-card { flex: 0 0 auto !important; max-height: 200px !important; }', expect: /^ *FAIL shelf: the Recent files, Captures and Capture keys cards end at/m, appliesTo: (v) => v.name === 'Shelf, three lists' },
      'shelf-label-pad': { css: '.shelf-place .shelf-key { padding: 0 !important; width: 100% !important; min-width: 0 !important; } .shelf-place .shelf-more { grid-template-columns: repeat(8, minmax(0, 1fr)) !important; }', expect: /^ *FAIL shelf: the label ".*" is [\d.-]+ px from its key edge/m, appliesTo: (v) => v.name === 'Shelf, three lists' },
      'shelf-dict-pad': { css: '.shelf-place .dc-btn { padding: 0 !important; } .shelf-place .dc-btn-text { min-width: 0 !important; }', expect: /^ *FAIL shelf: the label "(Copy|Raw)" is [\d.-]+ px from its button edge/m, appliesTo: (v) => v.name === 'Shelf, Dictations' },
      'shelf-step-pad': { css: '.shelf-place .cap-step-btns button { padding: 0 !important; min-width: 0 !important; }', expect: /^ *FAIL shelf: the label "(Share link|Back)" is [\d.-]+ px from its button edge/m, appliesTo: (v) => v.name === 'Shelf, Share link second step' },
      'shelf-keys': { css: '.shelf-place .shelf-key { height: 20px !important; }', expect: /^ *FAIL shelf: key ".*" is \d+ x \d+ px/m, appliesTo: (v) => v.name === 'Shelf, three lists' },
    },
  },
};
