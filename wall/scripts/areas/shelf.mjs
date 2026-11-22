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
      // Chips past the row's box are scrolled out of sight (the row scrolls); the row itself and the sideways check below hold them.
      if (e.closest('.shelf-lists') && !e.classList.contains('shelf-lists')) continue;
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
  const small = [];
  for (const el of root.querySelectorAll('.shelf-centre *, .right-wing .tasks *, .rf-card *')) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (own && parseFloat(getComputedStyle(el).fontSize) < 16 - 0.01) small.push(el.className || el.tagName);
  }
  if (small.length) fails.push('shelf: ' + small.length + ' texts under 16 px (' + small.slice(0, 3).join(', ') + ')');
  const keys = [...root.querySelectorAll('.shelf-key')];
  if (keys.length !== 6) fails.push('shelf: ' + keys.length + ' ShareX keys, expected 6');
  for (const k of keys) {
    const b = k.getBoundingClientRect();
    if (b.height < 39.5 || b.width < 39.5) fails.push('shelf: key "' + k.getAttribute('aria-label') + '" is ' + Math.round(b.width) + ' x ' + Math.round(b.height) + ' px (at least 40 by 40)');
  }
  const lists = root.querySelector('.shelf-lists');
  if (lists && lists.scrollWidth > lists.clientWidth + 1) fails.push('shelf: the list chips run sideways out of their row');
  const side = root.querySelector('.shelf-side');
  if (side) for (const c of side.querySelectorAll('.shelf-list')) {
    const b = c.getBoundingClientRect(), sb = side.getBoundingClientRect();
    if (b.right > sb.right + 0.5 || b.left < sb.left - 0.5) { fails.push('shelf: list chip "' + c.textContent.slice(0, 20) + '" is outside the side card'); break; }
  }
  return fails;
}

export default {
  name: 'shelf',
  gallery: { states: [
    state('shelf: three lists, first picked', LISTS, ['Captures', 'Region', 'Screen', 'GIF', 'Record', 'Text (OCR)', 'History', 'Tasks (To-Do)', 'Tax / Business', 'House, garden', 'Always here', 'Recent files', 'Quarterly review.pptx', 'Budget 2027.xlsx', 'Meeting notes.docx', 'Yesterday']),
    state('shelf: recent files with icons', LISTS, ['Recent files', 'newest first', 'Launch teaser.mp4', 'Podcast intro.mp3'], ['.rf-card']),
    state('shelf: recent files: hover preview', LISTS, ['Recent files', 'Budget 2027.xlsx'], ['hover:.rf-row:nth-child(2) .rf-open >> wait:700 >> is:.rf-preview']),
    state('shelf: lists from the task app', 'x=1', ['Tasks (To-Do)', 'Tax / Business', 'House, garden', 'Region']),
    state('shelf: recent files empty', LISTS + '&recent=empty', ['Recent files', 'No recent files']),
    state('shelf: recent files unavailable', LISTS + '&recent=down', ['Recent files', 'Recent files unavailable']),
    state('shelf: second list picked', LISTS, ['Tax / Business', 'File the quarterly return'], ['.shelf-list:nth-child(2)']),
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
        if (variantEntry.name.startsWith('Shelf,')) emit('  ok   shelf: cards inside the band, text 16 px or larger, six keys at least 40 px');
        return false;
      },
    },
    breaks: {
      'shelf-keys': { css: '.shelf-place .shelf-key { height: 20px !important; }', expect: /^ *FAIL shelf: key ".*" is \d+ x \d+ px/m, appliesTo: (v) => v.name === 'Shelf, three lists' },
    },
  },
};
