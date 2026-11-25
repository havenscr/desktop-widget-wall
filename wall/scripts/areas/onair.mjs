// On Air's old meanings, kept in the one frame: no run-of-show file, a refused file, forty parts, long notes, marks.txt full and Watt
// standing under the page. They are drawn on the Live page and measured by the `onairLive` and `onair2` measurements (onair-live.mjs, onair-modes.mjs).

const at = encodeURIComponent('2026-11-11T10:24:00-08:00');
const HEAD = 'hz=onair&at=' + at + '&clock=review&weather=ok&screen=onair&oamode=live&yt=live';
const full = (knobs) => `${HEAD}${/(^|&)show=/.test(knobs) ? '' : '&show=typical'}${/(^|&)marks=/.test(knobs) ? '' : '&marks=2'}${knobs ? '&' + knobs : ''}`;
const state = (name, knobs, expect, actions) => ({ screen: 'onair', name: 'on air: ' + name, query: full(knobs), custom: true, expect, actions });
const variant = (name, knobs, extra = {}) => ({ name: 'On Air, ' + name, q: '?' + full(knobs), checks: ['.oa2 .oa2-modes', '.oa2 .oa2-comments'], ...extra });

// Runs in the page: nothing here may refer to anything outside this function.
function measureOnAir() {
  const fails = [];
  const want = new URLSearchParams(location.search).get('screen') === 'onair';
  const root = document.querySelector('.oa2');
  if (!root) return want ? ['on air: the place did not open'] : [];
  if (document.querySelector('.onair, .oa-right')) fails.push('on air: the old page is still there');
  const r1 = (n) => Math.round(n * 10) / 10;
  const visible = (e) => {
    const b = e.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) return false;
    const cs = getComputedStyle(e);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  };
  for (const c of root.querySelectorAll(':scope > *')) {
    if (!visible(c)) continue;
    const b = c.getBoundingClientRect();
    if (b.bottom > 510.5 || b.top < 19.5) fails.push('on air: ' + (String(c.className).split(' ')[1] || c.className) + ' is at y ' + r1(b.top) + ' and ends at y ' + r1(b.bottom) + ', outside y 20 to 510');
  }
  for (const [label, sel] of [['Watt', '.watt-sheep'], ['Watt click box', '.watt-hit']]) {
    const w = document.querySelector(sel);
    if (!w) continue;
    const wb = w.getBoundingClientRect();
    if (wb.width === 0 && wb.height === 0) continue;
    for (const c of root.querySelectorAll(':scope > *')) {
      if (!visible(c)) continue;
      const cb = c.getBoundingClientRect();
      if (wb.left < cb.right && cb.left < wb.right && wb.top < cb.bottom && cb.top < wb.bottom) fails.push('on air: ' + label + ' at x ' + r1(wb.left) + ' to ' + r1(wb.right) + ', y ' + r1(wb.top) + ' to ' + r1(wb.bottom) + ' overlaps ' + (String(c.className).split(' ')[1] || c.className));
    }
  }
  for (const e of root.querySelectorAll('*')) {
    if (!visible(e)) continue;
    if (![...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent || '').trim())) continue;
    const px = parseFloat(getComputedStyle(e).fontSize);
    if (px < 15.99) {
      fails.push('on air: "' + (e.textContent || '').trim().slice(0, 28) + '" is ' + px + ' px');
      break;
    }
  }
  return fails;
}

export default {
  name: 'onair',
  gallery: { states: [
    state('typical (running at 42:13)', 'oatimer=run', ['42:1', 'Show timer', 'Notes', 'Mark a moment']),
    state('no file', 'show=missing&marks=0&oatimer=idle', ['- A note', 'one per line']),
    state('refused file', 'show=refused&marks=0&oatimer=idle', ['Open file']),
    state('forty parts', 'show=forty&oatimer=run', ['Notes']),
    state('long notes', 'show=long&oatimer=run', ['Notes', 'Mark a moment']),
    state('marks full', 'marks=full&oatimer=run', ['Mark a moment'], '.oa2-skgrid .key-tile[aria-label="Mark a moment"]'),
    state('Watt standing', 'oatimer=run&wattspot=1000', ['Show timer']),
    state('timer stopped at 24 hours', 'oatimer=limit', ['24:00:00', 'Stopped at 24 hours']),
  ] },
  fit: {
    variants: [
      variant('typical, running at 42:13', 'oatimer=run'),
      variant('no run-of-show.txt yet', 'show=missing&marks=0&oatimer=idle'),
      variant('a refused file', 'show=refused&marks=0&oatimer=idle'),
      variant('forty parts', 'show=forty&oatimer=run'),
      variant('long names and long notes', 'show=long&oatimer=run'),
      variant('Watt standing under the notes card', 'oatimer=run&wattspot=1000'),
      variant('Watt set down at the far left', 'oatimer=run&wattspot=200'),
      variant('Watt set down at the far right', 'oatimer=run&wattspot=2300'),
      variant('timer stopped itself at 24 hours', 'oatimer=limit'),
      variant('marks.txt full after a click', 'marks=full&oatimer=run', { click: '.oa2-skgrid .key-tile[aria-label="Mark a moment"]' }),
    ],
    measurements: { onair: measureOnAir },
    rules: {
      onair: (variantEntry, results, emit) => {
        for (const failure of results.onair) emit(`  FAIL ${failure}`);
        if (results.onair.length) return true;
        if (variantEntry.name.startsWith('On Air,')) emit('  ok   on air: one frame, every block ends at or above y 510, Watt overlaps no block, no text under 16 px');
        return false;
      },
    },
    breaks: {
      'onair-floor': { css: '.oa2-runline { display: flex !important; top: 600px !important; }', expect: /^ *FAIL on air: .* ends at y/m, appliesTo: (v) => v.name === 'On Air, typical, running at 42:13' },
      'onair-watt': { css: '.watt-sheep, .watt-hit { margin-top: -300px !important; }', expect: /^ *FAIL on air: Watt .* overlaps /m, appliesTo: (v) => v.name === 'On Air, Watt standing under the notes card' },
    },
  },
};
