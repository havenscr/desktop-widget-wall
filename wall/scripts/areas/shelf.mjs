// The Shelf place (screens/ShelfPlace.tsx): captures, the ShareX keys and the task lists, with the picked list in the task
// column. It must keep the captures card, the keys and lists card and the task column inside the top band (above the strip),
// each part inside its own card, every text at 16 px or larger, and every key at least 40 by 40 px.
const at = encodeURIComponent('2026-11-11T10:24:00-08:00');
const LISTS = 'shelflists=' + encodeURIComponent('Tasks (To-Do);Tax / Business;House, garden');
const MANY = 'shelflists=' + encodeURIComponent(['Tasks (To-Do)', 'Tax / Business', 'House, garden', 'Errands', 'Reading list', 'Someday maybe', 'Waiting on others', 'W'.repeat(60)].join(';'));
const galleryQuery = (knobs) => `hz=work&at=${at}&clock=review&weather=ok&screen=shelf&${knobs}`;
const fitQuery = (knobs) => `?hz=work&at=${at}&clock=review&weather=ok&screen=shelf&${knobs}`;
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
    const inView = [...rfList.querySelectorAll('.rf-row')].filter((r) => { const b = r.getBoundingClientRect(); return b.top >= lb.top - 0.5 && b.bottom <= lb.bottom + 0.5; }).length;
    const total = rfList.querySelectorAll('.rf-row').length;
    if (inView !== Math.min(5, total)) fails.push('shelf: ' + inView + ' recent file rows in view, expected ' + Math.min(5, total));
    const cb = rf.getBoundingClientRect();
    if (cb.bottom > floor + 0.5) fails.push('shelf: the Recent files card ends at y ' + r1(cb.bottom) + ', below the band (y ' + r1(floor) + ')');
  }
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
  if (keys.length !== 10) fails.push('shelf: ' + keys.length + ' ShareX keys, expected 10 (six and four more)');
  const more = [...root.querySelectorAll('.shelf-more .shelf-key')];
  if (more.length !== 4) fails.push('shelf: ' + more.length + ' more ShareX keys, expected 4');
  else {
    const tops = new Set(more.map((k) => Math.round(k.getBoundingClientRect().top)));
    if (tops.size !== 1) fails.push('shelf: the four more keys are not in one row');
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
  }
  return fails;
}

export default {
  name: 'shelf',
  gallery: { states: [
    state('shelf: three lists, first picked', LISTS, ['Captures', 'Region', 'Screen', 'GIF', 'Record', 'Text (OCR)', 'History', 'Tasks (To-Do)', 'Tax / Business', 'House, garden', 'Later today', 'Always here', 'Recent files', 'Quarterly review.pptx', 'Budget 2027.xlsx', 'Meeting notes.docx', 'Yesterday'], ['.lp-btn']),
    state('shelf: recent files with icons', LISTS, ['Recent files', 'newest first', 'Launch teaser.mp4', 'Podcast intro.mp3'], ['.rf-card']),
    state('shelf: lists from the task app', 'x=1', ['Tasks (To-Do)', 'Tax / Business', 'House, garden', 'Region'], ['.lp-btn']),
    state('shelf: recent files empty', LISTS + '&recent=empty', ['Recent files', 'No recent files']),
    state('shelf: recent files unavailable', LISTS + '&recent=down', ['Recent files', 'Recent files unavailable']),
    state('shelf: second list picked', LISTS, ['Tax / Business', 'File the quarterly return'], ['.lp-btn', '.lp-menu [role=option]:nth-child(2)']),
    state('shelf: a 60 character list name stays on one line beside the switch', MANY, ['Later today', 'Always here'], ['.lp-btn', '.lp-menu [role=option]:nth-child(8)']),
    state('shelf: the list menu open', LISTS, ['Tasks (To-Do)', 'Tax / Business', 'House, garden', 'Later today'], ['.lp-btn']),
    state('shelf: the list menu open with eight lists', MANY, ['Errands', 'Reading list', 'Later today'], ['.lp-btn']),
    state('shelf: more ShareX keys', LISTS, ['More ShareX', 'Scroll', 'Color', 'Last', 'Ruler'], ['.shelf-more']),
  ] },
  fit: {
    variants: [
      variant('Shelf, three lists', LISTS),
      variant('Shelf, eight lists with a 60 character name', MANY),
      variant('Shelf, lists from the task app', 'x=1'),
      variant('Shelf, a very long recent file name', LISTS + '&recent=long'),
      variant('Shelf, Watt set down at the far right', LISTS + '&wattspot=2300'),
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
      'shelf-keys': { css: '.shelf-place .shelf-key { height: 20px !important; }', expect: /^ *FAIL shelf: key ".*" is \d+ x \d+ px/m, appliesTo: (v) => v.name === 'Shelf, three lists' },
    },
  },
};
