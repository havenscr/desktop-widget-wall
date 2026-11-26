// The bottom row of Unwind while the work timeline is open: Tomorrow, the status marks and the Office moods slide up 116 px
// (a transform, unwind-work.css) to sit just above the timeline. The measurement puts the page in that state itself (it sets the
// frame's `data-work-shown` mark and switches the transitions off, the layer's own open state needs a pointer), then checks that
// every lifted box ends 8 px or more above the timeline's top and overlaps none of the Unwind elements above the row.
// The resting tops stay pinned by the status-marks, office-moods and day-line-sheet areas.

const at = '2026-11-11T10:24:00-08:00';
const night = '2026-11-11T22:30:00-08:00';
const DRIVE_IN = 'watch=mock&wlist=three&wlook=drivein&wplay=0';
const OFFICE = '&desktoken=set&office=twelve&officeoff=offered&officemood=brightDesk';
const q = (extra, when = at) => `?hz=unwind&at=${encodeURIComponent(when)}&clock=review&weather=ok&long=1&audio=demo${extra}`;

const V = {
  listen: 'Lifted row, Listen with the Office moods',
  watch: 'Lifted row, Watch with the drive-in and the keys row',
  worst: 'Lifted row, Watch, twelve moods and the worst status line',
};
const GAP = 8;

/** Runs in the page (it references nothing outside its own body). */
function measureLifted() {
  const st = document.createElement('style');
  st.textContent = '.u-foot, .u-office-slot { transition: none !important; } .sp-card { transition: none !important; } .rib-line { transition: none !important; }';
  document.head.appendChild(st);
  const main = document.querySelector('.main');
  const work = document.querySelector('.u-work');
  const foot = document.querySelector('.u-foot');
  const slot = document.querySelector('.u-office-slot');
  if (!main || !work || !foot) return { missing: true };
  const restFoot = foot.getBoundingClientRect().top;
  main.setAttribute('data-work-shown', '');
  void main.offsetHeight;
  const top = work.getBoundingClientRect().top;
  const boxes = [];
  for (const [name, root] of [['the status row', foot], ['the Office moods', slot]]) {
    if (!root) continue;
    for (const e of [root, ...root.querySelectorAll('*')]) {
      const r = e.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) boxes.push({ name, cls: String(e.className || e.tagName).slice(0, 24), l: r.left, t: r.top, r: r.right, b: r.bottom });
    }
  }
  const obstacles = [];
  for (const [name, sel] of [['the under-clock controls', '.u-quick'], ['the Listen player', '.u-listen'], ['the lines gear', '.u-listen-gear'], ['the Watch list card', '.w-card'], ['the keys row', '.u-keys'], ['the drive-in screen', '.w-screen'], ['Watt', '.watt-hit-part'], ['the Next up band', '.u-nu'], ['the Spotify card', '.sp-card'], ['the date line', '.u-date'], ['the Listen and Watch toggles', '.u-tabrow']]) {
    // On Watch he sits at his drive-in seat; on Listen he wanders the horizon and may pass behind the row for a moment, so only the seated Watt is held.
    if (name === 'Watt' && !document.querySelector('.unwind[data-tab="watch"]')) continue;
    for (const e of document.querySelectorAll(sel)) {
      const r = e.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden') obstacles.push({ name, l: r.left, t: r.top, r: r.right, b: r.bottom });
    }
  }
  const shift = restFoot - foot.getBoundingClientRect().top;
  const hits = [];
  for (const b of boxes) {
    for (const o of obstacles) {
      if (b.r > o.l + 0.5 && b.l < o.r - 0.5 && b.b > o.t + 0.5 && b.t < o.b - 0.5) hits.push(`${b.name} (${b.cls}) overlaps ${o.name}`);
    }
  }
  const worst = boxes.reduce((w, x) => (x.b > w.b ? x : w), { b: -1, cls: '', name: '' });
  return { missing: false, top, worst, count: boxes.length, obstacles: obstacles.length, hits: [...new Set(hits)], shift, hasSlot: !!slot };
}

function ruleLifted(variant, results, emit) {
  if (!variant.name.startsWith('Lifted row')) return false;
  const m = results.lifted;
  let bad = false;
  const fail = (t) => { emit('  FAIL lifted row: ' + t); bad = true; };
  if (!m || m.missing) { fail('the timeline layer or the bottom row is not on the page'); return true; }
  const room = m.top - m.worst.b;
  if (room < 7.95) fail(`${m.worst.name} (${m.worst.cls}) ends at y ${Math.round(m.worst.b * 10) / 10}, ${Math.round(room * 10) / 10} px above the timeline at ${Math.round(m.top * 10) / 10} (8 at least)`);
  if (Math.abs(m.shift - 116) > 0.5) fail(`the row moved ${Math.round(m.shift * 10) / 10} px, not 116`);
  for (const h of m.hits) fail(h);
  if (!bad) emit(`  ok   lifted row: ${m.count} boxes end at y ${Math.round(m.worst.b * 10) / 10}, ${Math.round(room * 10) / 10} px above the timeline (8 at least), moved 116 px, clear of ${m.obstacles} Unwind boxes above`);
  return bad;
}

const NIGHT = encodeURIComponent(night);
const WATCHQ = `hz=unwind&at=${NIGHT}&clock=review&weather=ok&watch=mock&wlist=three&wlook=drivein&wplay=0&meet=heavy&keys=three&hold=three&pins=three&agents=run2ask2&desktoken=set&office=six&officeoff=offered&officemood=relax`;
const UP = 'hover:.u-foot >> wait:900';
const gs = (name, query, actions, extra) => ({ screen: 'unwind', name: `lifted row: ${name}`, query, custom: true, actions, ...extra });

const on = (...names) => (v) => names.includes(v.name);

export default {
  name: 'lifted-row',
  gallery: {
    states: [
      gs('timeline open, the row lifted', WATCHQ, UP, { expectNote: 'the bottom row sits 116 px up, above the open timeline, no line through its corners' }),
      gs('the Agents today panel open from a click', WATCHQ, `${UP} >> .u-work .ag-line`, { expect: 'Click a row to open its session' }),
      gs('the Day drawer open from a click', `${WATCHQ.replace('&meet=heavy', '')}&meet=overlap`, `${UP} >> .u-work .ev.fold`, { expectNote: 'the Day drawer over the lower part of the frame, opened from the timeline' }),
    ],
  },
  fit: {
    variants: [
      { name: V.listen, q: q(`&ltab=listen&lctl=shown&agents=run2ask2${OFFICE}&officemood=relax`), checks: ['.u-office-slot'] },
      { name: V.watch, q: q(`&agents=run2ask2&${DRIVE_IN}&office=six&officeoff=offered&officemood=relax&desktoken=set`, night), checks: ['.u-office-slot'] },
      { name: V.worst, q: q(`&agents=run12ask12&alarmcount=88&${DRIVE_IN}${OFFICE}`, night), checks: ['.u-office-slot'] },
    ],
    measurements: { lifted: measureLifted },
    rules: { lifted: ruleLifted },
    breaks: {
      'lift-short': { css: `.main[data-work-shown] .u-foot, .main[data-work-shown] .u-office-slot { transform: translateY(-${116 - GAP - 12}px) !important; }`, expect: /^ *FAIL lifted row: .* px above the timeline/m, appliesTo: on(V.listen) },
      'lift-over': { css: '.main[data-work-shown] .u-foot { transform: translateY(-420px) !important; }', expect: /^ *FAIL lifted row: .* overlaps /m, appliesTo: on(V.listen) },
    },
  },
};
