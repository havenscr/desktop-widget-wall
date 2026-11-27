// The status marks at the bottom left of Unwind (and Dream's sentence): the capsule (the "work is put away" mark, one soft
// dot per running agent, the network alerts as a shield and a count), the separate amber pill, the grey ring when the
// helper has no fresh answer, the focus mark, "+N" past six dots, on Listen and on the Watch tab with the drive-in.
// One area file: gallery states, fit variants, the in-page measurement, its rule and the deliberate breaks. The
// agents, alerts and focus come from the dev knobs `?agents=runN[askM]`, `?alarmcount=N`, `?focus=run`, `?net=calm`.

const NIGHT = '2026-11-11T22%3A30%3A00-08%3A00';
const BASE = `hz=unwind&at=${NIGHT}&clock=review&weather=ok`;
const DRIVE_IN = 'watch=mock&wlist=three&wlook=drivein&wplay=0';
const CALM = `${BASE}&agents=run1&net=calm`;
const NEED = `${BASE}&agents=ask&net=calm`;
const BUSY = `${BASE}&agents=run2ask2`;
const STALE = `${BASE}&agents=stale&net=calm`;
const FOCUS = `${BASE}&agents=run1&net=calm&focus=run`;
const SEVEN = `${BASE}&agents=run7&net=calm`;
const WATCH = `${BASE}&agents=run2ask2&${DRIVE_IN}`;
const WORST = `${BASE}&agents=run12ask12&alarmcount=88&focus=run&long=1`;
const WATCH_WORST = `${BASE}&agents=run12ask12&alarmcount=88&${DRIVE_IN}`;
const DREAM = (agents) => `hz=zen&screen=dream&at=${NIGHT}&clock=review&weather=ok&agents=${agents}&net=calm`;

const gallery = (name, query, expect, actions) => ({
  screen: 'unwind',
  name: `status marks: ${name}`,
  query,
  custom: true,
  ...(typeof expect === 'string' || Array.isArray(expect) ? { expect } : expect),
  ...(actions ? { actions } : {}),
});
const dream = (name, query, expect) => ({ screen: 'zen', name: `status marks: ${name}`, query, custom: true, expect });

const states = [
  gallery('calm, one agent running', CALM, { expectNote: 'the capsule: the work-put-away mark and one cyan dot, no words' }),
  gallery('calm, the capsule card on hover', CALM, ['Work is put away', '1 agent still running. No agent needs you.', 'Click to see the agents on Work'], 'hover:.u-cap-work'),
  gallery('one thing needs you', NEED, ['One thing needs you']),
  gallery('one thing needs you, the pill card on hover', NEED, ['One chat is waiting for you', 'Click to open it'], 'hover:.u-need'),
  gallery('the pill takes the keyboard focus (ring and card)', NEED, ['One chat is waiting for you'], 'kbd:.u-need'),
  gallery('a busy night: two running, two waiting, four alerts', BUSY, ['2 things need you']),
  gallery('the alerts button card on hover', BUSY, ['4 network alerts. 4 alerts are open on the home network. Click to see them on Home.'], 'hover:.u-cap-net'),
  gallery('the helper has no fresh answer: one grey ring', STALE, ['Agents: no fresh answer', '!No agent needs you'], 'hover:.u-cap-work'),
  gallery('a focus session is on', FOCUS, ['Focus is still on', '1 agent still running.'], 'hover:.u-cap-work'),
  gallery('seven running: six dots and +1', SEVEN, ['+1']),
  gallery('twelve running: six dots and +6', `${BASE}&agents=run12&net=calm`, ['+6']),
  gallery('worst case: +6, two-digit alerts, two-digit waiting, focus', WORST, ['12 things need you', '+6']),
  gallery('Watch with the drive-in, a busy night', WATCH, ['2 things need you']),
  gallery('Watch with the drive-in, the worst case', WATCH_WORST, ['12 things need you']),
  gallery('Listen at noon', `hz=unwind&at=2026-11-11T12%3A30%3A00-08%3A00&clock=review&weather=ok&agents=run2ask1&net=calm`, ['One thing needs you']),
  gallery('Listen at dusk', `hz=unwind&at=2026-11-11T16%3A55%3A00-08%3A00&clock=review&weather=ok&agents=run2ask1&net=calm`, ['One thing needs you']),
  gallery('Listen in rain', `${BASE.replace('weather=ok', 'weather=rain')}&agents=run2ask1&net=calm`, ['One thing needs you']),
  gallery('Listen in snow', `${BASE.replace('weather=ok', 'weather=cold')}&agents=run2ask1&net=calm`, ['One thing needs you']),
  dream('Dream, calm: the sentence at 16 px', DREAM('run1'), ['1 agent still working', 'No agent needs you']),
  dream('Dream, an agent needs you: amber with a dot', DREAM('ask'), ['An agent needs you']),
];

/**
 * In the page (self-contained: it is serialised into the page). With `smcheck=<mode>` it reports the boxes of the row
 * and the facts the rule judges. Boxes are in wall pixels (the stage is scaled to the window).
 */
const measureMarks = () => {
  const mode = new URLSearchParams(location.search).get('smcheck');
  if (!mode) return null;
  try {
    return check(mode);
  } catch (e) {
    return { fails: ['status marks: the check broke: ' + e.message], mode };
  }
  function check(mode) {
    const fails = [];
    const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const near = (a, b, d) => Math.abs(a - b) <= d;
    const meet = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
    const where = (r) => [r.l, r.t, r.r, r.b].map(Math.round).join(',');
    const px = (e, prop) => parseFloat(getComputedStyle(e)[prop]);
    const effective = (e) => { let o = 1; for (let n = e; n && n.nodeType === 1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };
    const visible = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
    const words = (e) => [...e.querySelectorAll('*')].concat([e]).filter((x) => [...x.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()));
    if (mode.startsWith('card')) {
      // The hover card opened (by focus) on a control at the wall's left edge starts at that control's left edge and never reaches the rail.
      const [sel, name] = { cardwork: ['.u-cap-work', 'the capsule'], cardnet: ['.u-cap-net', 'the alerts button'], cardneed: ['.u-need', 'the amber pill'] }[mode];
      const anchor = document.querySelector(sel);
      const card = document.querySelector('.hover-tip');
      if (!anchor) return { fails: ['status marks: no ' + name + ' to open a card on'], mode };
      if (!card) return { fails: ['status marks: no card is open on ' + name], mode };
      const c = R(card);
      const a = R(anchor);
      if (!near(c.l, a.l, 1)) fails.push('status marks: the card on ' + name + ' starts at x ' + Math.round(c.l) + ' but the control starts at x ' + Math.round(a.l) + ' (the same, within 1 px)');
      const rail = document.querySelector('.rail');
      if (rail && meet(c, R(rail))) fails.push('status marks: the card on ' + name + ' at ' + where(c) + ' overlaps the rail at ' + where(R(rail)));
      if (c.l < 11.5 || c.r > 2548.5) fails.push('status marks: the card on ' + name + ' at ' + where(c) + ' is closer than 12 px to the wall edge');
      return { fails, mode, name, left: Math.round(c.l), width: Math.round(c.w) };
    }
    if (mode === 'dream') {
      const d = document.querySelector('.dream-status');
      if (!d) return { fails: ['status marks: Dream draws no status line'], mode };
      const small = words(d).filter((e) => px(e, 'fontSize') < 15.99);
      if (small.length) fails.push('status marks: Dream text is ' + Math.round(px(small[0], 'fontSize')) + ' px (16 or more)');
      const colour = getComputedStyle(d).color;
      if (!/rgba\(241, 236, 255, 0\.54\)/.test(colour)) fails.push('status marks: Dream words are ' + colour + ' (rgba(241, 236, 255, 0.54))');
      const needs = d.querySelector('.dream-needs');
      const asks = /An agent needs you|agents need you/.test(d.textContent);
      if (asks && !needs) fails.push('status marks: Dream says an agent needs you, but the part is not marked');
      if (!asks && needs) fails.push('status marks: Dream marks a needs part that says nobody needs you');
      if (needs) {
        const dot = needs.querySelector('i');
        const dr = dot ? R(dot) : null;
        if (!dr || !near(dr.w, 8, 0.6) || !near(dr.h, 8, 0.6)) fails.push('status marks: the Dream needs dot is ' + (dr ? Math.round(dr.w) + ' by ' + Math.round(dr.h) : 'missing') + ' px (8 by 8)');
        if (!/rgba\(255, 194, 77, 0\.8\)/.test(getComputedStyle(needs).color)) fails.push('status marks: the Dream needs part is ' + getComputedStyle(needs).color + ' (amber at .8)');
      }
      const dr = R(d);
      if (dr.l < 0 || dr.r > 2560 || dr.b > 720) fails.push('status marks: the Dream line at ' + where(dr) + ' is outside the screen');
      return { fails, mode, width: Math.round(dr.w) };
    }
    const line = document.querySelector('.u-line');
    if (!line) return { fails: ['status marks: the line draws nothing'], mode };
    const cap = line.querySelector('.u-cap');
    const work = line.querySelector('.u-cap-work');
    const net = line.querySelector('.u-cap-net');
    const need = line.querySelector('.u-need');
    const dots = [...line.querySelectorAll('.u-cap .u-dot')];
    const ring = line.querySelector('.u-ring');
    const more = line.querySelector('.u-more');
    const mark = line.querySelector('.u-mark');
    const c = R(cap);
    const L = R(line);
    const want = { calm: 1, need: 1, busy: 2, stale: 0, focus: 1, seven: 6, worst: 6, watch: 2, watchworst: 6 }[mode];
    if (!mark) fails.push('status marks: no work-put-away mark in the capsule');
    // The boxes: 36 high at y 658 from x 124, each button the capsule's full height.
    if (!near(c.t, 658, 1) || !near(c.h, 36, 0.6) || !near(c.l, 124, 1)) fails.push('status marks: the capsule is at x ' + Math.round(c.l) + ', y ' + Math.round(c.t) + ', ' + Math.round(c.h) + ' tall (x 124, y 658, 36 tall)');
    if (need) {
      const n = R(need);
      if (!near(n.t, 658, 1) || !near(n.h, 36, 0.6)) fails.push('status marks: the amber pill is at y ' + Math.round(n.t) + ', ' + Math.round(n.h) + ' tall (y 658, 36 tall)');
      if (!near(n.l - c.r, 10, 0.6)) fails.push('status marks: the amber pill sits ' + Math.round((n.l - c.r) * 10) / 10 + ' px right of the capsule (10)');
    }
    for (const b of line.querySelectorAll('button')) {
      const r = R(b);
      if (r.h < 31.5) fails.push('status marks: a button is ' + Math.round(r.h) + ' px tall (32 or more for the pointer)');
      const top = document.elementFromPoint(r.l + r.w / 2, r.t + r.h / 2);
      if (!top || !b.contains(top)) fails.push('status marks: a button does not get the pointer at its centre (' + (top ? top.className || top.tagName : 'nothing') + ')');
    }
    // The dots: one per running agent, six at most, "+N" after; the capsule grows by 18 px per dot.
    if (want !== undefined && dots.length !== want) fails.push('status marks: ' + dots.length + ' dots drawn (' + want + ' wanted in this state)');
    for (const d of dots) if (!near(R(d).w, 10, 0.6) || !near(R(d).h, 10, 0.6)) fails.push('status marks: a dot is ' + Math.round(R(d).w) + ' by ' + Math.round(R(d).h) + ' px (10 by 10)');
    if ((mode === 'seven' || mode === 'worst' || mode === 'watchworst') && !(more && /^\+\d+$/.test(more.textContent))) fails.push('status marks: no "+N" after six dots');
    if (!(mode === 'seven' || mode === 'worst' || mode === 'watchworst') && more) fails.push('status marks: a "+N" is drawn with six dots or fewer');
    if (dots.length > 6) fails.push('status marks: more than six dots');
    if (mode === 'calm' && !near(c.w, 71, 1.5)) fails.push('status marks: the calm capsule is ' + Math.round(c.w) + ' px wide (71 with one dot)');
    if (mode === 'stale') {
      if (!ring || !visible(ring)) fails.push('status marks: the helper has no fresh answer but no grey ring is drawn');
      else if (!near(R(ring).w, 10, 0.6) || !near(c.w, 71, 1.5)) fails.push('status marks: the grey ring is ' + Math.round(R(ring).w) + ' px and the capsule ' + Math.round(c.w) + ' wide (10 and 71)');
      if (dots.length) fails.push('status marks: dots are drawn beside the grey ring');
    } else if (ring) fails.push('status marks: a grey ring is drawn while the helper answers');
    if (mode === 'focus' && !(mark && mark.classList.contains('tabler-icon-focus-2'))) fails.push('status marks: a focus session is on but the mark is not focus-2');
    if (mode !== 'focus' && mode !== 'worst' && mark && mark.classList.contains('tabler-icon-focus-2')) fails.push('status marks: the focus mark is drawn with no focus session');
    // The alerts button: a shield and the count in amber, 17 px, a divider before it.
    if (net) {
      const ns = getComputedStyle(net);
      if (ns.color !== 'rgb(255, 194, 77)') fails.push('status marks: the alerts count is ' + ns.color + ' (amber, rgb(255, 194, 77))');
      if (!near(px(net, 'fontSize'), 17, 0.2)) fails.push('status marks: the alerts count is ' + Math.round(px(net, 'fontSize')) + ' px (17)');
      if (!net.querySelector('svg')) fails.push('status marks: the alerts button has no shield');
      if (!near(R(net).l - R(work).r, 0, 0.6)) fails.push('status marks: the alerts button is not flush with the capsule button');
    }
    // The dots and the pill fade in once over 400 ms (opacity only) and hold; nothing loops.
    for (const e of [dots[0], ring, need].filter(Boolean)) {
      const s = getComputedStyle(e);
      const names = s.animationName.split(',').map((t) => t.trim());
      const secs = s.animationDuration.split(',').map((t) => parseFloat(t));
      const iter = s.animationIterationCount.split(',').map((t) => t.trim());
      if (names.length !== 1 || names[0] !== 'u-mark-in' || Math.abs(secs[0] - 0.4) > 0.01) fails.push('status marks: the ' + e.className + ' does not fade in over 400 ms (' + s.animationName + ' ' + s.animationDuration + ')');
      if (iter.some((t) => t === 'infinite' || t !== '1')) fails.push('status marks: the ' + e.className + ' animation repeats (' + s.animationIterationCount + ')');
    }
    for (const e of [dots[0], ring, need].filter(Boolean)) {
      const o = effective(e);
      if (o < 0.5) fails.push('status marks: the ' + e.className + ' is at opacity ' + Math.round(o * 100) / 100 + ' after the fade (it must hold)');
    }
    // Text is 16 px or more and none is cut.
    const small = words(line).filter((e) => px(e, 'fontSize') < 15.99);
    if (small.length) fails.push('status marks: text under 16 px (' + Math.round(px(small[0], 'fontSize')) + ' px in "' + small[0].textContent.trim().slice(0, 20) + '")');
    for (const e of words(line)) if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline') fails.push('status marks: the text "' + e.textContent.trim().slice(0, 24) + '" is cut');
    // Nothing else moves: Tomorrow keeps its box; the row stays clear of Tomorrow, the under-clock controls, the rail,
    // the centre column and Watt, and ends before the centre column (x 624).
    const tom = document.querySelector('.u-tomorrow');
    if (tom) {
      const t = R(tom);
      // One line is 53.6 px tall from y 582.4; with the work layer down the line may take a second row, so the box may only
      // grow upward (its bottom stays at 636) by one row of 28.6 px, and the element above it stays clear of it.
      const grown = t.t < 582.4 - 1.5;
      if (!near(t.l, 124, 1) || !near(t.w, 470, 1) || !near(t.t + t.h, 636, 1.5) || t.t > 582.4 + 1.5 || t.t < 582.4 - 29.5) fails.push('status marks: Tomorrow is at ' + where(t) + ' (124, 582 or one row higher, 594, bottom 636)');
      const above = tom.previousElementSibling;
      if (above) {
        const a = R(above);
        if (a.w > 0 && a.h > 0 && a.t + a.h > t.t + 0.5 && !(a.l >= t.l + t.w || a.l + a.w <= t.l)) fails.push('status marks: Tomorrow' + (grown ? ' (two lines)' : '') + ' at ' + where(t) + ' overlaps the element above it at ' + where(a));
      }
      if (meet(L, t)) fails.push('status marks: the row at ' + where(L) + ' overlaps Tomorrow at ' + where(t));
    }
    const centre = document.querySelector('.u-centre');
    const centreLeft = centre ? R(centre).l : 624;
    const others = [['the under-clock controls', document.querySelector('.u-quick')], ['the rail', document.querySelector('.rail')], ['the centre column', centre], ['Watt', document.querySelector('.watt-hit-part')], ['the drive-in screen', document.querySelector('.w-screen')], ['the drive-in card', document.querySelector('.w-card')], ['the office slot', document.querySelector('[data-slot="office-lights"]')]];
    for (const [name, e] of others) {
      if (!e) continue;
      const r = R(e);
      if (r.w > 0 && r.h > 0 && meet(L, r)) fails.push('status marks: the row at ' + where(L) + ' overlaps ' + name + ' at ' + where(r));
    }
    if (L.r > centreLeft - 10 + 0.5) fails.push('status marks: the row ends at x ' + Math.round(L.r) + ', within 10 px of the centre column at ' + Math.round(centreLeft) + ' (x ' + Math.round(centreLeft - 10) + ' at most)');
    const wing = document.querySelector('.u-wing');
    return { fails, mode, width: Math.round(L.w * 10) / 10, right: Math.round(L.r * 10) / 10, centre: Math.round(centreLeft), wing: wing ? Math.round(R(wing).r) : null, pill: need ? Math.round(R(need).w * 10) / 10 : null, cap: Math.round(c.w * 10) / 10 };
  }
};

const rule = (variant, results, emit) => {
  const r = results.statusmarks;
  if (!r) return false;
  for (const f of r.fails) emit(`  FAIL ${f}`);
  if (r.fails.length) return true;
  if (r.mode.startsWith('card')) emit(`  ok   status marks: the card on ${r.name} starts at x ${r.left} (the control's left edge), ${r.width} px wide, clear of the rail and 12 px from the wall edge`);
  else if (r.mode === 'dream') emit(`  ok   status marks: Dream's sentence is 16 px, rgba(241, 236, 255, .54), the needs part amber with an 8 px dot (${r.width} px wide)`);
  else emit(`  ok   status marks: capsule ${r.cap} wide and pill at 36 high from x 124, y 658, the row ${r.width} px wide (right edge ${r.right}, the wing ends at ${r.wing}, the centre column starts at ${r.centre}), no text cut, 16 px or more, nothing overlaps Tomorrow, the controls, Watt or the drive-in`);
  return false;
};

const V = {
  calm: 'Status marks, calm, one running',
  need: 'Status marks, one thing needs you',
  busy: 'Status marks, a busy night',
  stale: 'Status marks, no fresh answer, the grey ring',
  focus: 'Status marks, a focus session on',
  seven: 'Status marks, seven running, +1',
  worst: 'Status marks, the worst case on Listen',
  watch: 'Status marks, Watch with the drive-in, a busy night',
  watchworst: 'Status marks, Watch with the drive-in, the worst case',
  dream: 'Status marks, Dream, calm',
  dreamNeed: 'Status marks, Dream, an agent needs you',
  cardWork: 'Status marks, the capsule card open',
  cardNet: 'Status marks, the alerts button card open',
  cardNeed: 'Status marks, the amber pill card open',
};
const variant = (name, query, mode, checks = ['.u-line', '.u-cap', '.u-tomorrow']) => ({ name, q: `?${query}&smcheck=${mode}`, checks });
const variants = [
  variant(V.calm, CALM, 'calm'),
  variant(V.need, NEED, 'need'),
  variant(V.busy, BUSY, 'busy'),
  variant(V.stale, STALE, 'stale'),
  variant(V.focus, FOCUS, 'focus'),
  variant(V.seven, SEVEN, 'seven'),
  variant(V.worst, WORST, 'worst'),
  variant(V.watch, WATCH, 'watch'),
  variant(V.watchworst, WATCH_WORST, 'watchworst'),
  { ...variant(V.cardWork, CALM, 'cardwork'), click: 'tip:.u-cap-work' },
  { ...variant(V.cardNet, BUSY, 'cardnet'), click: 'tip:.u-cap-net' },
  { ...variant(V.cardNeed, NEED, 'cardneed'), click: 'tip:.u-need' },
  variant(V.dream, DREAM('run1'), 'dream', ['.dream-status']),
  variant(V.dreamNeed, DREAM('ask'), 'dream', ['.dream-status']),
];

const on = (...names) => (v) => names.includes(v.name);

export default {
  name: 'status-marks',
  gallery: { states },
  fit: {
    variants,
    measurements: { statusmarks: measureMarks },
    rules: { statusmarks: rule },
    breaks: {
      'marks-pill-gap': { css: '.u-line { gap: 30px !important; }', expect: /^ *FAIL status marks: the amber pill sits [\d.]+ px right of the capsule/m, appliesTo: on(V.need) },
      'marks-dot-width': { css: '.u-dot { width: 14px !important; }', expect: /^ *FAIL status marks: a dot is \d+ by \d+ px/m, appliesTo: on(V.calm) },
      'marks-capsule': { css: '.u-cap, .u-cap button { height: 28px !important; }', expect: /^ *FAIL status marks: the capsule is at x \d+, y \d+, \d+ tall/m, appliesTo: on(V.calm) },
      'marks-button': { css: '.u-need { height: 24px !important; }', expect: /^ *FAIL status marks: (a button is \d+ px tall|the amber pill is at y)/m, appliesTo: on(V.need) },
      'marks-text': { css: '.u-need { font-size: 13px !important; }', expect: /^ *FAIL status marks: text under 16 px/m, appliesTo: on(V.need) },
      'marks-cut': { css: '.u-need { width: 70px !important; overflow: hidden !important; }', expect: /^ *FAIL status marks: the text "[^"]*" is cut/m, appliesTo: on(V.need) },
      'marks-over-tomorrow': { css: '.u-line { margin-top: -60px !important; }', expect: /^ *FAIL status marks: the row at [\d,]+ overlaps Tomorrow/m, appliesTo: on(V.calm) },
      'marks-wide': { css: '.u-more { margin-left: 160px !important; }', expect: /^ *FAIL status marks: the row ends at x \d+, within 10 px of the centre column/m, appliesTo: on(V.worst) },
      'marks-net-color': { css: '.u-cap .u-cap-net { color: #a39bc6 !important; }', expect: /^ *FAIL status marks: the alerts count is rgb\(163, 155, 198\)/m, appliesTo: on(V.busy) },
      'marks-ring': { css: '.u-ring { display: none !important; }', expect: /^ *FAIL status marks: the helper has no fresh answer but no grey ring is drawn/m, appliesTo: on(V.stale) },
      'marks-fade': { css: '.u-dot, .u-need { animation: none !important; }', expect: /^ *FAIL status marks: the u-dot does not fade in over 400 ms/m, appliesTo: on(V.calm) },
      'marks-loop': { css: '.u-need { animation-iteration-count: infinite !important; }', expect: /^ *FAIL status marks: the u-need animation repeats/m, appliesTo: on(V.need) },
      'marks-watch': { css: '.u-line { margin-left: 520px !important; }', expect: /^ *FAIL status marks: the row at [\d,]+ overlaps (the centre column|the drive-in)/m, appliesTo: on(V.watch) },
      'marks-card-work': { css: '.hover-tip { transform: translateX(-90px) !important; }', expect: /^ *FAIL status marks: the card on the capsule starts at x \d+ but the control starts at x \d+/m, appliesTo: on(V.cardWork) },
      'marks-card-net': { css: '.hover-tip { transform: translateX(-90px) !important; }', expect: /^ *FAIL status marks: the card on the alerts button starts at x \d+ but the control starts/m, appliesTo: on(V.cardNet) },
      'marks-card-need': { css: '.hover-tip { transform: translateX(90px) !important; }', expect: /^ *FAIL status marks: the card on the amber pill starts at x \d+ but the control starts/m, appliesTo: on(V.cardNeed) },
      'marks-card-rail': { css: '.rail { width: 300px !important; }', expect: /^ *FAIL status marks: the card on the capsule at [\d,]+ overlaps the rail/m, appliesTo: on(V.cardWork) },
      'marks-dream-size': { css: '.dream-status { font-size: 13px !important; }', expect: /^ *FAIL status marks: Dream text is \d+ px/m, appliesTo: on(V.dream) },
      'marks-dream-needs': { css: '.dream-needs i { width: 14px !important; }', expect: /^ *FAIL status marks: the Dream needs dot is \d+ by \d+ px/m, appliesTo: on(V.dreamNeed) },
    },
  },
};
