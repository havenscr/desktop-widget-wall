const at = encodeURIComponent('2026-11-11T10:24:00-08:00');
const galleryQuery = (knobs) => `hz=onair&at=${at}&clock=review&weather=ok&screen=onair&${knobs}`;
const fitQuery = (knobs) => `?hz=onair&at=${at}&clock=review&weather=ok&screen=onair&${knobs}`;
const checks = ['.onair .oa-left', '.onair .oa-card', '.onair .oa-right', '.onair .oa-card-foot', '.onair .oa-mark'];
const state = (name, knobs, expect, actions) => ({ screen: 'onair', name, query: galleryQuery(knobs), custom: true, expect, actions });
const variant = (name, knobs, extra = {}) => ({ name, q: fitQuery(knobs), checks, ...extra });

function measureOnAir() {
  // The new frame (`?onair=v2`) is measured by the onair-modes area, never by these checks.
  if (new URLSearchParams(location.search).get('onair') === 'v2') return [];
  const fails = [];
  const want = new URLSearchParams(location.search).get('screen') === 'onair';
  if (!document.querySelector('.onair')) return want ? ['on air: the place did not open'] : [];
  const rib = document.querySelector('.rib');
  const floor = Math.min(510, rib ? rib.getBoundingClientRect().top : 720);
  const r1 = (n) => Math.round(n * 10) / 10;
  for (const [sel, l, r, parts] of [['.oa-left', 124, 764, '.oa-timer, .oa-runbox, .oa-run, .oa-file, .oa-empty'], ['.oa-card', 800, 1880, '.oa-k, .oa-notes, .oa-help, .oa-nonotes, .oa-card-foot, .oa-card-foot > *'], ['.oa-right', 1920, 2540, '.oa-mark, .oa-keys, .oa-keys > *, .oa-foot, .oa-k, .oa-k-brief']]) {
    const col = document.querySelector('.onair ' + sel);
    if (!col) { fails.push('on air: ' + sel + ' is missing'); continue; }
    for (const e of [col, ...col.querySelectorAll(parts)]) {
      const b = e.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) continue;
      if (b.left < l - 0.5 || b.right > r + 0.5 || b.top < 19.5 || b.bottom > floor + 0.5) {
        fails.push('on air: ' + sel + (e === col ? '' : ' ' + (e.className || e.tagName)) + ' at x ' + r1(b.left) + ' to ' + r1(b.right) + ', y ' + r1(b.top) + ' to ' + r1(b.bottom) + ' is outside its planned box (x ' + l + ' to ' + r + ', y 20 to ' + r1(floor) + ')');
        break;
      }
    }
  }
  const list = document.querySelector('.onair .oa-notes');
  if (list) {
    const lb = list.getBoundingClientRect();
    const notes = [...list.querySelectorAll(':scope > .oa-note')];
    const hidden = notes.filter((n) => getComputedStyle(n).display === 'none').length;
    const cutNote = notes.findIndex((n) => getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().bottom > lb.bottom + 0.5);
    const more = list.querySelector(':scope > .oa-more');
    const moreShown = more && getComputedStyle(more).display !== 'none' ? (more.textContent || '').trim() : '';
    if (list.scrollHeight > list.clientHeight + 0.5 || cutNote >= 0) fails.push('on air: the notes are cut (' + (cutNote >= 0 ? 'note ' + (cutNote + 1) + ' of ' + notes.length + ' ends below the card' : 'the list is ' + list.scrollHeight + ' px for ' + list.clientHeight) + ', ' + hidden + ' behind "+N more")');
    else if (hidden > 0 && moreShown !== '+' + hidden + ' more') fails.push('on air: the notes are cut: ' + hidden + ' hidden but the more line reads "' + moreShown + '"');
    else if (hidden === 0 && moreShown !== '') fails.push('on air: the more line reads "' + moreShown + '" with no note hidden');
  }
  for (const [label, sel] of [['Watt', '.watt-sheep'], ['Watt click box', '.watt-hit']]) {
    const w = document.querySelector(sel);
    if (!w) { if (sel === '.watt-hit' && want) fails.push('on air: Watt is not on the page'); continue; }
    const wb = w.getBoundingClientRect();
    if (wb.width === 0 && wb.height === 0) continue;
    for (const csel of ['.oa-left', '.oa-card', '.oa-right']) {
      const cb = document.querySelector('.onair ' + csel)?.getBoundingClientRect();
      if (cb && wb.left < cb.right && cb.left < wb.right && wb.top < cb.bottom && cb.top < wb.bottom) fails.push('on air: ' + label + ' at x ' + r1(wb.left) + ' to ' + r1(wb.right) + ', y ' + r1(wb.top) + ' to ' + r1(wb.bottom) + ' overlaps ' + csel + ' (y ' + r1(cb.top) + ' to ' + r1(cb.bottom) + ')');
    }
  }
  const tiles = [...document.querySelectorAll('.onair .oa-keys .key-tile')];
  if (tiles.length !== 4) fails.push('on air: ' + tiles.length + ' recording keys, expected 4');
  for (const tile of tiles) {
    const b = tile.getBoundingClientRect();
    if (b.height < 39.5 || b.width < 39.5) fails.push('on air: key tile "' + tile.getAttribute('aria-label') + '" is ' + Math.round(b.width) + ' x ' + Math.round(b.height) + ' px (at least 40 by 40)');
  }
  return fails;
}

export default {
  name: 'onair',
  gallery: { states: [
    state('on air: typical (running at 42:13)', 'show=typical&marks=2&oatimer=run', ['42:1', 'Product demo', '7 min left', 'Point it at the real model first', 'Next: Audience questions, 15 min', '2 marked: 03:12, 09:40. Saved to marks.txt', 'Record 16:9', 'Hide screen', '!+1 more']),
    state('on air: stopped', 'show=typical&marks=2&oatimer=stopped', ['42:13', 'stopped at', 'Start', 'Reset']),
    state('on air: no file', 'show=missing&marks=0&oatimer=idle', ['No run-of-show.txt yet', 'Open file', '## Part name | 10', 'None yet today']),
    state('on air: refused file', 'show=refused&marks=0&oatimer=idle', ['run-of-show.txt is over 32 KB', 'Fix the file']),
    state('on air: forty parts', 'show=forty&marks=2&oatimer=run', ['Segment 40: Questions', 'Marathon stream', '4 lines skipped']),
    state('on air: long notes', 'show=long&marks=2&oatimer=run', ['An extremely long part name', 'Note 12: walk through', ' more']),
    state('on air: marks full', 'show=typical&marks=full&oatimer=run', 'marks.txt is full; move it aside', '.oa-mark-btn'),
    state('on air: one part', 'show=one&marks=0&oatimer=run', ['This is the last part', 'Product demo']),
    state('on air: read fails', 'show=down&marks=0&oatimer=idle', 'Could not read run-of-show.txt'),
    state('on air: recording, Stop lit', 'show=typical&marks=2&oatimer=run&rec=1', ['Recording00:', 'Mark a moment']),
    state('on air: Watt standing', 'show=typical&marks=2&oatimer=run&wattspot=1000', ['Product demo', '42:1']),
    state('on air: timer stopped at 24 hours', 'show=typical&marks=2&oatimer=limit', ['24:00:00', 'Stopped at 24 hours', 'Start']),
    state('on air: Open file failed, marks line unchanged', 'show=missing&marks=2&oatimer=idle&openfail=show', ['Could not open run-of-show.txt', '2 marked: 03:12, 09:40. Saved to marks.txt'], '.oa-empty-btn'),
    state('on air: reset asks again', 'show=typical&marks=2&oatimer=stopped', 'Reset? Click again', '.oa-reset'),
  ] },
  fit: {
    variants: [
      variant('On Air, typical: running at 42:13', 'show=typical&marks=2&oatimer=run'),
      variant('On Air, long names and twelve long notes', 'show=long&marks=2&oatimer=run'),
      variant('On Air, forty parts', 'show=forty&marks=2&oatimer=run'),
      variant('On Air, no run-of-show.txt yet', 'show=missing&marks=0&oatimer=idle'),
      variant('On Air, a refused file', 'show=refused&marks=0&oatimer=idle'),
      variant('On Air, Watt standing under the notes card', 'show=typical&marks=2&oatimer=run&wattspot=1000'),
      variant('On Air, Watt set down at the far left', 'show=typical&marks=2&oatimer=run&wattspot=200'),
      variant('On Air, Watt set down at the far right', 'show=typical&marks=2&oatimer=run&wattspot=2300'),
      variant('On Air, the timer stopped itself at 24 hours', 'show=typical&marks=2&oatimer=limit'),
      variant('On Air, marks.txt full after a click, recording', 'show=typical&marks=full&oatimer=run&rec=1', { click: '.oa-mark-btn' }),
    ],
    measurements: { onair: measureOnAir },
    rules: {
      onair: (variantEntry, results, emit) => {
        for (const failure of results.onair) emit(`  FAIL ${failure}`);
        if (results.onair.length) return true;
        if (variantEntry.name.startsWith('On Air,')) emit('  ok   on air: three columns inside their planned boxes above the strip, no note cut without "+N more", key tiles at least 40 px');
        return false;
      },
    },
    breaks: {
      'onair-box': { css: '.onair .oa-card { width: 1400px !important; }', expect: /^ *FAIL on air: \.oa-card .*outside its planned box/m, appliesTo: (v) => v.name === 'On Air, typical: running at 42:13' },
      'onair-notes': { css: '.onair .oa-note { font-size: 40px !important; } .onair .oa-note[hidden] { display: flex !important; }', expect: /^ *FAIL on air: the notes are cut /m, appliesTo: (v) => v.name === 'On Air, long names and twelve long notes' },
      'onair-keys': { css: '.onair .oa-keys .deck-tile.key-tile { height: 20px !important; min-height: 0 !important; padding: 0 !important; }', expect: /^ *FAIL on air: key tile ".*" is \d+ x \d+ px/m, appliesTo: (v) => v.name === 'On Air, typical: running at 42:13' },
      'onair-watt': { css: '.watt-sheep, .watt-hit { margin-top: -300px !important; }', expect: /^ *FAIL on air: Watt .* overlaps /m, appliesTo: (v) => v.name === 'On Air, Watt standing under the notes card' },
    },
  },
};
