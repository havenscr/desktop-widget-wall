// The left rail in the Tauri build: the Full button is drawn there (`?tauri=1` gives the page a Tauri shim, see fit-check.mjs), so the
// rail holds every place, Shelf, Zen, Full and Tools. It must fit the shell slot (y 20 to 700) with no scroll, Tools' bottom at or
// above y 700, and every label whole and no smaller than its designed 12.5 px (the rail labels were never 16 px), on each place.
const at = encodeURIComponent('2026-11-11T10:24:00-08:00');
const Q = (knobs = '') => `?hz=work&at=${at}&clock=review&weather=ok&agents=3&tauri=1${knobs ? '&' + knobs : ''}`;
const PLACES = [['Work', 'Work'], ['Home', 'Home'], ['Unwind', 'Unwind'], ['Meet', 'Meet'], ['On Air', 'On air'], ['Shelf', 'Shelf'], ['Zen', 'Zen']];
const SLOT_TOP = 20;
const SLOT_BOTTOM = 700;

// Runs in the page.
function measureRail() {
  const fails = [];
  const r1 = (n) => Math.round(n * 10) / 10;
  const rail = document.querySelector('.rail');
  if (!rail) return ['rail: the left rail is missing'];
  const rb = [...rail.querySelectorAll('.rb')];
  if (!rail.querySelector('.rb-fs')) fails.push('rail: the Full button is not drawn (the Tauri shim did not take)');
  const rr = rail.getBoundingClientRect();
  if (rail.scrollHeight > rail.clientHeight + 0.5) fails.push('rail: it scrolls (' + rail.scrollHeight + ' px of content in ' + rail.clientHeight + ')');
  if (rr.top < 19.5 || rr.bottom > 700.5) fails.push('rail: it is at y ' + r1(rr.top) + ' to ' + r1(rr.bottom) + ', outside the shell slot (y 20 to 700)');
  const tools = rail.querySelector('.rb-tools');
  if (!tools) fails.push('rail: the Tools button is missing');
  else if (tools.getBoundingClientRect().bottom > 700.5) fails.push('rail: Tools ends at y ' + r1(tools.getBoundingClientRect().bottom) + ', below y 700');
  for (const b of rb) {
    const br = b.getBoundingClientRect();
    if (br.bottom > rr.bottom + 0.5 || br.top < rr.top - 0.5) fails.push('rail: "' + (b.getAttribute('aria-label') || '') + '" sticks out of the rail');
    // The label is the button's own text node (or the text after the icon).
    for (const n of b.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      const px = parseFloat(getComputedStyle(b).fontSize);
      if (px < 12.49) fails.push('rail: label "' + n.textContent.trim() + '" is ' + px + ' px, under the rail label size 12.5');
      const range = document.createRange();
      range.selectNodeContents(n);
      const t = range.getBoundingClientRect();
      if (t.left < br.left - 0.5 || t.right > br.right + 0.5 || t.top < br.top - 0.5 || t.bottom > br.bottom + 0.5) fails.push('rail: label "' + n.textContent.trim() + '" is cut off by its button');
    }
  }
  return fails;
}

const variants = PLACES.map(([name, label]) => ({
  name: 'Rail, ' + name,
  q: Q(),
  checks: ['.rail', '.rail .rb-tools'],
  viewportOnly: true,
  ...(name === 'Work' ? {} : { click: `.rail .rb[aria-label="${label}"]` }),
}));

export default {
  name: 'rail',
  fit: {
    variants,
    measurements: { rail: measureRail },
    rules: {
      rail: (variant, results, emit) => {
        if (!variant.name.startsWith('Rail, ')) return false;
        for (const f of results.rail) emit('  FAIL ' + f);
        if (!results.rail.length) emit('  ok   rail: inside the shell slot (y 20 to 700), no scroll, Tools ends at or above y 700, every label whole and at least its 12.5 px size');
        return results.rail.length > 0;
      },
    },
    breaks: {
      'rail-tall': {
        css: '.rb { height: 80px !important; }',
        expect: /^ *FAIL rail: /m,
        appliesTo: (variant) => variant.name === 'Rail, Home',
      },
    },
  },
};
