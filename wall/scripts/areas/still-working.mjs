// Home's Still Working mood card, the leftmost of the moods row: saved (bright and focused) and not saved yet (dashed, quiet,
// "Not set up yet"). Gallery states, fit variants, one browser measurement, its rule and a deliberate break, all in this file.
// The `?moods=` knob of the development mocks sends Still Working first; `moods=unsaved` sends it with saved: false.

const homeQuery = (knobs) => `?hz=home&at=2026-11-12T16:36:00-08:00&long=1&${knobs}`;
const galleryQuery = (knobs) => `hz=home&at=${encodeURIComponent('2026-11-11T10:24:00-08:00')}&clock=review&weather=ok&${knobs}`;
const state = (name, knobs, expect) => ({ screen: 'home', name, query: galleryQuery(knobs), custom: true, expect });
const variant = (name, knobs, kind) => ({
  name,
  q: `${homeQuery(knobs)}&stillcheck=${kind}`,
  checks: ['.home .home-centre', '.home .moods', '.home .mood-row', '.home .mood-btn[data-mood="stillWorking"]'],
});

// Page side: the first card is Still Working, the four cards share the row evenly, its name and line are not cut, and the quiet
// state shows its dashed border, its words and no "On now" or "In N min" tag; the saved one has none of that.
function measureStill() {
  const out = [];
  const row = document.querySelector('.home .mood-row');
  const cards = [...document.querySelectorAll('.home .mood-row .mood-btn')];
  const first = cards[0];
  if (!row || !first) return ['still working: no mood row or no cards'];
  const want = /[?&]stillcheck=(saved|unsaved)\b/.exec(location.search)?.[1];
  if (first.getAttribute('data-mood') !== 'stillWorking') out.push('still working: the first card is "' + first.getAttribute('data-mood') + '", not Still Working');
  if (cards.length !== 4) out.push('still working: ' + cards.length + ' cards, expected 4');
  const widths = cards.map((c) => c.getBoundingClientRect().width);
  if (Math.max(...widths) - Math.min(...widths) > 1) out.push('still working: the cards are not equal (' + widths.map((w) => w.toFixed(1)).join(', ') + ')');
  if (row.scrollWidth > row.clientWidth + 1) out.push('still working: the row overflows');
  const name = first.querySelector('.mood-name');
  const sub = first.querySelector('.mood-sub');
  for (const e of [name, sub]) {
    if (!e) out.push('still working: the card has no name or no line');
    else if (e.scrollWidth > e.clientWidth + 1) out.push('still working: "' + e.textContent + '" is cut off');
  }
  const unsaved = first.classList.contains('unsaved');
  if (want === 'unsaved') {
    if (!unsaved) out.push('still working: the card is not drawn quiet');
    if (sub?.textContent !== 'Not set up yet') out.push('still working: the quiet card says "' + sub?.textContent + '"');
    if (getComputedStyle(first).borderTopStyle !== 'dashed') out.push('still working: the quiet card is not dashed (' + getComputedStyle(first).borderTopStyle + ')');
    if (first.querySelector('.mood-tag')) out.push('still working: the quiet card carries a tag');
  } else if (want === 'saved') {
    if (unsaved) out.push('still working: the saved card is drawn quiet');
    if (sub?.textContent !== 'bright and focused') out.push('still working: the card says "' + sub?.textContent + '", not "bright and focused"');
    if (getComputedStyle(first).borderTopStyle === 'dashed') out.push('still working: the saved card is dashed');
  }
  // The "On now" and "In N min" tags are 16 px or more and never sit under the Back arrow.
  const back = document.querySelector('.home .mood-row .mood-back');
  for (const t of document.querySelectorAll('.home .mood-row .mood-tag')) {
    const px = parseFloat(getComputedStyle(t).fontSize);
    if (px < 16 - 0.01) out.push('still working: the tag "' + t.textContent + '" is ' + px + ' px (16 or more)');
    if (back) {
      const a = t.getBoundingClientRect();
      const b = back.getBoundingClientRect();
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0) out.push('still working: the tag "' + t.textContent + '" sits under the Back arrow');
    }
  }
  return out;
}

export default {
  name: 'still-working',
  gallery: { states: [
    state('still working: saved, first of four', 'moods=five', ['Still Working', 'bright and focused']),
    state('still working: not set up yet', 'moods=unsaved', ['Still Working', 'Not set up yet']),
  ] },
  fit: {
    variants: [
      variant('Home, Still Working: saved, first of four', 'moods=five', 'saved'),
      variant('Home, Still Working: not set up yet', 'moods=unsaved', 'unsaved'),
    ],
    measurements: { still: measureStill },
    rules: {
      still: (variantEntry, results, emit) => {
        if (!/[?&]stillcheck=(saved|unsaved)\b/.test(variantEntry.q)) return false;
        for (const failure of results.still) emit(`  FAIL ${failure}`);
        if (results.still.length) return true;
        emit('  ok   still working: first card, four even cards, words not cut, state as asked');
        return false;
      },
    },
    breaks: {
      'still-quiet': {
        css: '.mood-btn.unsaved { border-style: solid !important; }',
        expect: /^ *FAIL still working: the quiet card is not dashed/m,
        appliesTo: (variantEntry) => variantEntry.name === 'Home, Still Working: not set up yet',
      },
      'still-tag': {
        css: '.mood-tag { font-size: 14px !important; }',
        expect: /^ *FAIL still working: the tag ".*" is 14 px/m,
        appliesTo: (variantEntry) => variantEntry.name === 'Home, Still Working: saved, first of four',
      },
    },
  },
};
