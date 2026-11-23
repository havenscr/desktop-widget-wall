// Listen: the time bar takes the pointer (a click or a drag seeks), and while the settings sheet is open the music card
// behind it takes none, so no tile left of the sheet can raise a hover card over it.
const at = '2026-11-11T10:24:00-08:00';
const Q = (extra) => `?hz=unwind&at=${encodeURIComponent(at)}&long=1&agents=3&audio=demo&desktoken=set${extra}`;

// Runs in the page. seekcheck=bar: the bar is a slider 32 px tall, nothing sits over its middle, and its marker is inside it.
// seekcheck=sheet: the sheet is open and no button of the music card is reached by the pointer where the sheet does not cover it.
function measureListenSeek() {
  const mode = new URLSearchParams(location.search).get('seekcheck');
  if (!mode) return null;
  const fails = [];
  if (mode === 'bar') {
    const bar = document.querySelector('.u-listen .u-seek');
    if (!bar) return { mode, fails: ['listen seek: the time bar is not on the page'] };
    const r = bar.getBoundingClientRect();
    if (bar.getAttribute('role') !== 'slider') fails.push('listen seek: the time bar is not a slider (role ' + bar.getAttribute('role') + ')');
    if (r.height < 31.5) fails.push('listen seek: the time bar hit area is ' + Math.round(r.height) + ' px tall (32)');
    for (const f of [0.1, 0.5, 0.9]) {
      const h = document.elementFromPoint(r.left + r.width * f, r.top + r.height / 2);
      if (!h || !bar.contains(h)) fails.push('listen seek: at ' + Math.round(f * 100) + ' percent along the bar the pointer reaches ' + (h ? String(h.className || h.tagName).slice(0, 30) : 'nothing'));
    }
    return { mode, fails, width: Math.round(r.width) };
  }
  const sheet = document.querySelector('.w-sheet');
  if (!sheet) return { mode, fails: ['listen seek: the settings sheet is not open'] };
  const s = sheet.getBoundingClientRect();
  let tried = 0;
  for (const b of document.querySelectorAll('.sp-card button, .sp-card [role="button"]')) {
    const r = b.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x >= s.left && x <= s.right && y >= s.top && y <= s.bottom) continue;
    tried++;
    const h = document.elementFromPoint(x, y);
    if (h && h.closest('.sp-card')) fails.push('listen seek: the pointer at ' + Math.round(x) + ',' + Math.round(y) + ' reaches the music card while the sheet is open');
  }
  return { mode, fails, tried };
}

export default {
  name: 'listen-seek',
  gallery: {
    states: [
      { screen: 'unwind', name: 'listen seek: the time bar on Listen', query: `hz=unwind&at=${encodeURIComponent(at)}&clock=review&weather=ok&audio=demo&desktoken=set`, custom: true, expect: ['Tokyo Burnout'] },
    ],
  },
  fit: {
    variants: [
      { name: 'Listen seek, the time bar takes the pointer', q: Q('&seekcheck=bar'), checks: ['.u-listen', '.u-seek'], hits: ['.u-seek'] },
      { name: 'Listen seek, the sheet open, the music card behind takes no pointer', q: Q('&seekcheck=sheet'), click: '.w-gear', checks: ['.w-sheet', '.sp-card'] },
    ],
    measurements: { listenSeek: measureListenSeek },
    rules: {
      listenSeek: (variant, results, emit) => {
        if (!variant.name.startsWith('Listen seek')) return false;
        const m = results.listenSeek;
        if (!m) { emit('  FAIL listen seek: the check did not run'); return true; }
        if (m.fails.length) { for (const f of m.fails) emit('  FAIL ' + f); return true; }
        emit(m.mode === 'bar' ? `  ok   listen seek: the time bar is a ${m.width} px wide slider with a 32 px hit area, nothing over it` : `  ok   listen seek: ${m.tried} music card buttons beside the sheet take no pointer while it is open`);
        return false;
      },
    },
    breaks: {
      'seek-covered': { css: '.u-listen .u-seek { pointer-events: none !important; }', expect: /^ *FAIL pointer at \.u-seek/m, appliesTo: (v) => v.name === 'Listen seek, the time bar takes the pointer' },
      'seek-card-live': { css: '.unwind .sp-card, .unwind .sp-card * { pointer-events: auto !important; }', expect: /^ *FAIL listen seek: the pointer at \d+,\d+ reaches the music card/m, appliesTo: (v) => v.name.includes('the sheet open') },
    },
  },
};
