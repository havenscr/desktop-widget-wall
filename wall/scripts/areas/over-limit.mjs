// The agents line on the calm strip and the session limit: the line takes the pointer (it used to
// inherit a click-through row, so the sky behind it got every click), a red "N of M open" marker
// and a thin red line along the strip while more sessions are open than the limit, and the hover
// card that names the idle sessions. (The fit variants use `agents=7`: `7idle` sends long idle times that the
// cards' own right-end rule, outside this area, already measures tighter than 12 px.) Gallery states, one fit measurement with its rule, and the
// deliberate breaks. Everything this area needs lives here.

const at = encodeURIComponent('2026-11-11T16:30:00-08:00');
const base = `hz=work&at=${at}&clock=review&weather=ok&meet=none`;
const fit = (knobs, mode) => `?${base}&${knobs}&ovcheck=${mode}`;

const BY_ONE = 'Strip: over the session limit by one';
const BY_THREE = 'Strip: over the session limit by three';
const BACK = 'Strip: back under the limit after being over';
const AT_LIMIT = 'Strip: at the session limit';
const LONG = 'Strip: over the limit with the longest titles';

/**
 * Runs in the page (self-contained). `ovcheck=over` expects the red marker and the red line,
 * `ovcheck=under` neither, `ovcheck=back` the red line without the marker. In every mode the agents
 * line itself takes the pointer at its middle, while the agent row around it does not catch the
 * pointer over the empty sky beside the line.
 */
function measureOver() {
  const mode = new URLSearchParams(location.search).get('ovcheck');
  if (!mode) return null;
  const fails = [];
  const r1 = (n) => Math.round(n * 10) / 10;
  const line = document.querySelector('.rib .ag-line');
  if (!line) return { fails: ['agents line: not drawn'], over: mode };
  const lb = line.getBoundingClientRect();
  const label = (e) => (e ? (e.className && typeof e.className === 'string' ? e.tagName.toLowerCase() + '.' + e.className.split(' ')[0] : e.tagName.toLowerCase()) : 'nothing');
  const mid = document.elementFromPoint(lb.left + lb.width / 2, lb.top + lb.height / 2);
  if (!mid || !mid.closest('.ag-line')) fails.push('agents line: the pointer at its middle reaches ' + label(mid) + ', not the line');
  const beside = lb.right + 24 < 2540 ? document.elementFromPoint(lb.right + 24, lb.top + lb.height / 2) : null;
  if (beside && beside.closest('.agent-row')) fails.push('agents line: the agent row covers the sky beside the line (' + label(beside) + ')');
  const marker = line.querySelector('.x-over');
  const rails = [...document.querySelectorAll('.rib .agent-row .x-rail')];
  if (mode === 'over') {
    if (!marker) fails.push('agents line: no red marker while over the limit');
    if (rails.length === 0) fails.push('agents line: no red line along the strip while over the limit');
  } else if (mode === 'back') {
    if (marker) fails.push('agents line: a red marker while under the limit');
    if (rails.length === 0) fails.push('agents line: no red line for the stretch that was over the limit');
  } else {
    if (marker) fails.push('agents line: a red marker at or under the limit');
    if (rails.length > 0) fails.push('agents line: a red line at or under the limit');
  }
  if (marker) {
    const mb = marker.getBoundingClientRect();
    if (Math.abs(mb.height - 22) > 0.6) fails.push('agents line: the red marker is ' + r1(mb.height) + ' px tall (22)');
    if (mb.left < lb.left - 0.5 || mb.right > lb.right + 0.5) fails.push('agents line: the red marker sticks out of the line (marker ' + r1(mb.left) + ' to ' + r1(mb.right) + ', line ' + r1(lb.left) + ' to ' + r1(lb.right) + ')');
    if (marker.scrollWidth > marker.clientWidth + 0.5) fails.push('agents line: the red marker cuts its words');
    if (parseFloat(getComputedStyle(marker).fontSize) < 16 - 0.01) fails.push('agents line: the red marker text is under 16 px');
  }
  if (line.scrollWidth > line.clientWidth + 1) fails.push('agents line: the line cuts its words (' + line.scrollWidth + ' in ' + line.clientWidth + ')');
  if (lb.right > 2560 - 12) fails.push('agents line: the line reaches x ' + r1(lb.right) + ', past the strip');
  const needle = document.querySelector('.rib .ndl');
  for (const rail of rails) {
    const rb = rail.getBoundingClientRect();
    if (Math.abs(rb.height - 3) > 0.6) fails.push('agents line: the red line is ' + r1(rb.height) + ' px tall (3)');
    if (rb.width < 3 - 0.5) fails.push('agents line: the red line is ' + r1(rb.width) + ' px wide');
    if (needle && rb.right > needle.getBoundingClientRect().right + 2) fails.push('agents line: the red line runs past the needle');
    if (getComputedStyle(rail).pointerEvents !== 'none') fails.push('agents line: the red line takes the pointer');
  }
  return { fails, over: mode };
}

export default {
  name: 'over-limit',
  gallery: {
    states: [
      { screen: 'work', name: 'agents line: over the limit by one (5 of 4)', query: `${base}&agents=5`, custom: true, expect: ['5 of 4 open', '3 working, 2 idle'] },
      { screen: 'work', name: 'agents line: over the limit by three (7 of 4)', query: `${base}&agents=7idle`, custom: true, expect: ['7 of 4 open', '3 working, 4 idle'] },
      { screen: 'work', name: 'agents line: back under the limit after being over', query: `${base}&agents=3&over=back&days=typical`, custom: true, expect: ['3 sessions:', '!of 4 open'] },
      { screen: 'work', name: 'agents line: at the limit, no marker', query: `${base}&agents=4`, custom: true, expect: ['4 sessions:', '!of 4 open'] },
      {
        screen: 'work',
        name: 'agents line: hover card with four idle sessions, over by three',
        query: `${base}&agents=7idle`,
        custom: true,
        expect: ['7 sessions open, 3 over your limit of 4', 'IDLE (4)', 'WORKING (3)', 'Over the limit since 3:48 PM', 'Click to open Agents today'],
        actions: 'hover:.rib .ag-line',
      },
      {
        screen: 'work',
        name: 'agents line: hover card at the limit names the idle ones',
        query: `${base}&agents=4`,
        custom: true,
        expect: ['4 sessions open', 'IDLE (1)', '!over your limit'],
        actions: 'hover:.rib .ag-line',
      },
      {
        screen: 'work',
        name: 'agents line: hover card with the longest titles',
        query: `${base}&agents=7idle&long=1`,
        custom: true,
        expect: ['7 sessions open, 3 over your limit of 4', 'IDLE (4)'],
        actions: 'hover:.rib .ag-line',
      },
      { screen: 'work', name: 'agents line: over the limit with the longest titles', query: `${base}&agents=7idle&long=1`, custom: true, expect: ['7 of 4 open'] },
    ],
  },
  fit: {
    variants: [
      { name: BY_ONE, q: fit('agents=5', 'over'), checks: ['.rib'], viewportOnly: true },
      { name: BY_THREE, q: fit('agents=7', 'over'), checks: ['.rib'], viewportOnly: true },
      { name: BACK, q: fit('agents=3&over=back&days=typical', 'back'), checks: ['.rib'], viewportOnly: true },
      { name: AT_LIMIT, q: fit('agents=4', 'under'), checks: ['.rib'], viewportOnly: true },
      { name: LONG, q: fit('agents=7&long=1', 'over'), checks: ['.rib'], viewportOnly: true },
    ],
    measurements: { over: measureOver },
    rules: {
      over: (variant, results, emit) => {
        const r = results.over;
        if (!r) return false;
        for (const failure of r.fails) emit(`  FAIL ${failure}`);
        if (r.fails.length) return true;
        emit(
          r.over === 'over'
            ? '  ok   agents line: it takes the pointer, the row beside it does not, a 22 px red marker inside it, a 3 px red line ending at the needle'
            : r.over === 'back'
              ? '  ok   agents line: it takes the pointer, no marker, a red line for the stretch that was over'
              : '  ok   agents line: it takes the pointer, the row beside it does not, no marker and no red line',
        );
        return false;
      },
    },
    breaks: {
      // The row's click-through comes back on the line: the pointer at the line's middle reaches the sky.
      'agents-line-pointer': { css: '.rib .ag-line { pointer-events: none !important; }', expect: /^ *FAIL agents line: the pointer at its middle reaches /m, appliesTo: (v) => v.name === BY_THREE },
      // The whole row takes the pointer: the sky beside the line is covered.
      'agents-row-covers': { css: '.rib .agent-row { pointer-events: auto !important; }', expect: /^ *FAIL agents line: the agent row covers the sky beside the line/m, appliesTo: (v) => v.name === AT_LIMIT },
      'over-marker-height': { css: '.rib .ag-line .x-over { height: 14px !important; }', expect: /^ *FAIL agents line: the red marker is [\d.]+ px tall \(22\)/m, appliesTo: (v) => v.name === BY_ONE },
      'over-marker-out': { css: '.rib .ag-line .x-over { position: relative !important; left: 400px !important; }', expect: /^ *FAIL agents line: the red marker sticks out of the line/m, appliesTo: (v) => v.name === BY_THREE },
      'over-rail-height': { css: '.rib .agent-row .x-rail { height: 10px !important; }', expect: /^ *FAIL agents line: the red line is [\d.]+ px tall \(3\)/m, appliesTo: (v) => v.name === BY_THREE },
      'over-rail-hidden': { css: '.rib .agent-row .x-rail { display: none !important; }', expect: /^ *FAIL agents line: the red line is [\d.]+ px (tall|wide)|^ *FAIL agents line: no red line/m, appliesTo: (v) => v.name === BACK },
    },
  },
};
