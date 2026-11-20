// Custom colours, opened from "Your own" in the palette strip: the card stays on the wall above the moods row, its
// text is 16 px or more, nothing is cut, and the 24 swatches, the five slots and the cover button keep a usable size.
const at = '2026-11-11T10:24:00-08:00';
const Q = (extra = '') => `?hz=unwind&at=${encodeURIComponent(at)}&long=1&agents=3&audio=demo&desktoken=set&office=six&officeoff=offered&officemood=relax${extra}`;
const OPEN = '[data-part="sync-dots"] >> [data-palette="custom"]';

// Runs in the page.
function measureCustom() {
  const card = document.querySelector('[data-part="custom-picker"]');
  if (!card) return { found: false };
  const r = card.getBoundingClientRect();
  const row = document.querySelector('[data-slot="office-lights"]')?.getBoundingClientRect();
  const parts = [...card.querySelectorAll('.u-k, .uc-label, .uc-note, .uc-keep')];
  const small = parts.filter((e) => parseFloat(getComputedStyle(e).fontSize) < 15.99).map((e) => e.textContent.trim().slice(0, 30));
  const cut = parts.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim().slice(0, 30));
  const outside = [...card.querySelectorAll('*')].filter((e) => { const q = e.getBoundingClientRect(); return q.width > 0 && (q.left < r.left - 0.5 || q.right > r.right + 0.5 || q.bottom > r.bottom + 0.5); }).length;
  const sw = [...card.querySelectorAll('.uc-dot.sw')].map((e) => e.getBoundingClientRect());
  const swatchRows = new Set(sw.map((q) => Math.round(q.top))).size;
  const small2 = [...card.querySelectorAll('.uc-dot')].filter((e) => e.getBoundingClientRect().width < 28).length;
  const swOverlap = sw.some((q, i) => i > 0 && Math.abs(q.top - sw[i - 1].top) < 1 && q.left < sw[i - 1].right - 0.5);
  return { found: true, top: r.top, bottom: r.bottom, left: r.left, right: r.right, vw: window.innerWidth, rowTop: row ? row.top : null, small, cut, outside, swatches: sw.length, swatchRows, small2, swOverlap, slots: card.querySelectorAll('.uc-mine > *').length, keep: !!card.querySelector('.uc-keep') };
}

export default {
  name: 'custom-colours',
  gallery: {
    states: [
      { screen: 'unwind', name: 'custom colours: the picker open', query: `hz=unwind&at=${encodeURIComponent(at)}&clock=review&weather=ok&audio=demo&desktoken=set&office=six&officeoff=offered&officemood=relax`, custom: true, expect: ['Custom colours', 'Your colours', "Keep this cover's colours"], actions: '[data-part="sync-dots"] >> [data-palette="custom"]' },
    ],
  },
  fit: {
    variants: [
      { name: 'Custom colours, picker open', q: Q(), click: OPEN, checks: ['[data-part="custom-picker"]'] },
      { name: 'Custom colours, picker open while sync runs', q: Q('&lsync=on'), click: OPEN, checks: ['[data-part="custom-picker"]'] },
    ],
    measurements: { customColours: measureCustom },
    rules: {
      customColours: (variant, results, emit) => {
        if (!variant.name.startsWith('Custom colours')) return false;
        const m = results.customColours;
        let bad = false;
        const fail = (t) => { emit('  FAIL custom colours: ' + t); bad = true; };
        if (!m || !m.found) { fail('the picker is not open'); return true; }
        if (m.top < -0.5 || m.right > m.vw + 0.5) fail(`the card runs off the wall (top ${Math.round(m.top)}, right ${Math.round(m.right)})`);
        if (m.rowTop !== null && m.bottom > m.rowTop + 0.5) fail('the card overlaps the moods row');
        if (m.small.length) fail('text under 16 px: ' + m.small.join(' | '));
        if (m.cut.length) fail('cut text: ' + m.cut.join(' | '));
        if (m.outside) fail(m.outside + ' parts outside the card');
        if (m.swatches !== 24) fail(m.swatches + ' swatches (24)');
        if (m.small2) fail(m.small2 + ' dots under 28 px');
        if (m.swOverlap) fail('swatches overlap');
        if (m.slots !== 5 || !m.keep) fail('slots or the cover button missing');
        if (!bad) emit(`  ok   custom colours: card above the row, ${m.swatches} swatches in ${m.swatchRows} rows, five slots, text 16 px or more`);
        return bad;
      },
    },
    breaks: {
      'custom-small': { css: '.uc-note { font-size: 12px !important; }', expect: /^ *FAIL custom colours: text under 16 px/m, appliesTo: (v) => v.name === 'Custom colours, picker open' },
    },
  },
};
