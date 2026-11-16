// Hide screen on every place (vote Part 19, 1A): ONE control, 36 px at stage x 2504, y 664, the same box on all eight
// screens (Work, Home, Meet, On Air, Unwind Listen and Watch, Zen, Dream). One area file: gallery states, fit variants, the
// in-page measurement, its rule and the deliberate breaks. Nothing here clicks a real command: the mocks answer.
//
// The measurement runs in the page with `?hidecheck=<mode>`: `rest` (the box, the one button in the tab order, the
// control winning the pointer inside its own box, the declared rest colour and Hiding opacity (the declared tokens, not a
// rendered contrast: the contrast over each place's real background is measured from stills, see wall/README.md),
// reduced motion, nothing under it),
// `grown` (pointer on it: it grows to the left only, inside the stage, the icon and the 36 px box stay put, and it covers
// no control and no words outside the day strip), `failed` (the same, with the failure words inside the pill) and
// `drawer` (a drawer is open: the control takes no pointer and no focus, also at the drawer's rounded corner).
// `&hidebreak=` is read by the measurement only, for the self-test breaks that CSS cannot make.

const AT = encodeURIComponent('2026-11-11T10:24:00-08:00');
const LATE = encodeURIComponent('2026-11-11T23:40:00-08:00');
const base = (hz, at = AT) => `?hz=${hz}&at=${at}&clock=review&weather=ok&long=1`;
const PLACES = {
  work: { gallery: 'work', fit: `${base('work', LATE)}&agents=12ask&meet=overlap` },
  home: { gallery: 'home', fit: `${base('home')}&agents=3&moods=five&sonos=heavy` },
  meet: { gallery: 'meet', fit: `${base('work')}&agents=3&go=meet&meet=heavy` },
  onair: { gallery: 'onair', fit: `${base('onair')}&screen=onair&show=typical&marks=2&oatimer=run` },
  listen: { gallery: 'unwind', fit: `${base('unwind')}&agents=3&audio=demo&watch=mock&wtab=listen&wpins=three` },
  watch: { gallery: 'unwind', fit: `${base('unwind')}&agents=3&watch=mock&wlist=many&wlook=sky&wplay=3` },
  zen: { gallery: 'zen', fit: `${base('work')}&agents=3&go=zen` },
  dream: { gallery: 'zen', fit: `${base('work', encodeURIComponent('2026-11-11T23:48:00-08:00'))}&agents=3&go=dream` },
};
const LABEL = { work: 'Work', home: 'Home', meet: 'Meet', onair: 'On Air', listen: 'Unwind, Listen', watch: 'Unwind, Watch', zen: 'Zen', dream: 'Dream' };
const name = (what, place) => `Hide screen, ${what}: ${LABEL[place]}`;
const checks = ['.so-layer', '.screens-off'];

// Unwind's Office moods row at its widest (twelve long names and the Off chip): its right edge is wall x 2364, 140 px short of this control, so the grown 154 px pill is clear of every chip.
const MOODS12 = '&desktoken=set&office=twelve&officeoff=offered&officemood=brightDesk';
const OFFICE = [
  ['at rest', '', null, 'rest'],
  ['pointer on it', '', 'hover:.screens-off', 'grown'],
  ['Cancel hide', '&hide=on', '.screens-off >> hover:.screens-off', 'grown'],
  ['failure words', '&hide=fail', '.screens-off', 'failed'],
];
const variants = [
  ...Object.entries(PLACES).map(([id, p]) => ({ name: name('at rest', id), q: `${p.fit}&hidecheck=rest`, checks, viewportOnly: true })),
  ...Object.entries(PLACES).map(([id, p]) => ({ name: name('pointer on it', id), q: `${p.fit}&hidecheck=grown`, click: 'hover:.screens-off', checks, viewportOnly: true })),
  ...['work', 'zen', 'dream', 'listen'].map((id) => ({ name: name('failure words', id), q: `${PLACES[id].fit}&hide=fail&hidecheck=failed`, click: '.screens-off', checks, viewportOnly: true })),
  { name: 'Hide screen, pointer on it: Unwind, Listen with the tall card', q: `${PLACES.listen.fit}&hidecheck=grown`, click: '.sp-grow >> hover:.screens-off', checks, viewportOnly: true },
  ...OFFICE.map(([what, extra, click, mode]) => ({ name: `Hide screen, ${what}: Unwind with twelve Office moods and Off`, q: `${PLACES.listen.fit}${MOODS12}${extra}&hidecheck=${mode}`, ...(click ? { click } : {}), checks, viewportOnly: true })),
  { name: name('Tools open', 'work'), q: `${PLACES.work.fit}&tools=1&hidecheck=drawer`, checks: [...checks, '.tools-drawer'], viewportOnly: true },
  { name: name('Tools open', 'listen'), q: `${PLACES.listen.fit}&tools=1&hidecheck=drawer`, checks: [...checks, '.tools-drawer'], viewportOnly: true },
  { name: name('Day drawer open', 'work'), q: `${PLACES.work.fit}&hidecheck=drawer`, click: '.rib-handle:not(.in-drawer)', checks: [...checks, '.day-drawer'], viewportOnly: true },
];

/** In the page (self-contained: it is serialised into the page). */
const measureHide = () => {
  const mode = new URLSearchParams(location.search).get('hidecheck');
  if (!mode) return null;
  try {
    return check(mode);
  } catch (e) {
    return { mode, broke: e.message };
  }
  function check(mode) {
    const brk = new URLSearchParams(location.search).get('hidebreak');
    const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const layer = document.querySelector('.so-layer');
    const buttons = [...document.querySelectorAll('.screens-off')];
    const btn = buttons[0];
    const out = { mode, count: buttons.length, layers: document.querySelectorAll('.so-layer').length };
    if (!btn || !layer) return out;
    if (brk === 'uninert') layer.removeAttribute('inert');
    if (brk === 'notab') btn.tabIndex = -1;
    const wrap = btn.parentElement;
    const css = document.createElement('style');
    // Dream fades in over 2.5 s and drifts up to 15 px each way (it starts at +15 px); measure it shown, at that worst drift.
    css.textContent = '.screens-off, .screens-off-lbl { transition: none !important; } .dream, .dream * { animation: none !important; } .dream-drift { transition: none !important; transform: translate(15px, 0) !important; }';
    document.head.appendChild(css);
    const vis = (e) => {
      let o = 1;
      for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        o *= Number(cs.opacity);
      }
      return o > 0.05;
    };
    const hit = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
    const cls = (e) => (e.getAttribute('aria-label') || (e.textContent || '').trim().slice(0, 24) || e.className?.baseVal || e.className || e.tagName).toString().slice(0, 40);
    out.btn = R(btn);
    out.wrap = R(wrap);
    out.icon = R(btn.querySelector('svg'));
    out.tag = btn.tagName;
    out.tabIndex = btn.tabIndex;
    out.inert = !!btn.closest('[inert]');
    out.place = layer.getAttribute('data-place');
    out.z = Number(getComputedStyle(layer).zIndex);
    out.label = btn.querySelector('.screens-off-lbl')?.textContent ?? '';
    out.hasRib = !!document.querySelector('.rib');
    const cx = out.btn.l + out.btn.w / 2, cy = out.btn.t + out.btn.h / 2;
    const at = (x, y) => document.elementFromPoint(x, y);
    const mine = (e) => !!e && layer.contains(e);
    out.hitCentre = mine(at(cx, cy));
    out.hitSliver = mine(at(2535, 693));
    out.hitCorner = mine(at(out.btn.l + 20, cy));
    // Brightness at rest and pending, then the colour against --dim.
    const probe = document.createElement('span');
    probe.style.color = 'var(--dim)';
    document.body.appendChild(probe);
    out.dim = getComputedStyle(probe).color;
    probe.remove();
    out.color = getComputedStyle(btn).color;
    out.opacity = Number(getComputedStyle(btn).opacity);
    if (mode === 'rest') {
      btn.setAttribute('data-pending', 'true');
      out.pendingOpacity = Number(getComputedStyle(btn).opacity);
      btn.removeAttribute('data-pending');
      // Reduced motion: a media rule that takes the transitions off both parts.
      let calm = 0;
      for (const sheet of document.styleSheets) for (const rule of sheet.cssRules) {
        if (rule.media && /prefers-reduced-motion:\s*reduce/.test(rule.conditionText ?? rule.media.mediaText)) {
          for (const r of rule.cssRules) if (r.selectorText && r.selectorText.includes('.screens-off') && /none/.test(r.style.transitionProperty || r.style.transition || '')) calm += 1;
        }
      }
      out.calmRules = calm;
      btn.focus();
      out.focused = document.activeElement === btn;
      out.focusVisible = btn.matches(':focus-visible');
      out.focusWidth = R(btn).w;
      out.outline = getComputedStyle(btn).outlineWidth;
      btn.blur();
    }
    if (mode === 'drawer') {
      btn.focus();
      out.focused = document.activeElement === btn;
      btn.blur();
      out.drawers = [...document.querySelectorAll('.tools-drawer, .day-drawer')].filter((d) => d.getBoundingClientRect().width > 0).length;
    }
    // What the control covers: controls and words under its own box (as it stands in this state).
    const pill = out.btn;
    const contains = (r) => r.l <= pill.l + 0.5 && r.r >= pill.r - 0.5 && r.t <= pill.t + 0.5 && r.b >= pill.b - 0.5;
    // A part clipped by a scrolling or clipping ancestor only counts where it is still seen.
    const seen = (e, r, self = false) => {
      let l = r.l, t = r.t, rr = r.r, b = r.b;
      for (let a = self ? e : e.parentElement; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const c = a.getBoundingClientRect();
        l = Math.max(l, c.left); t = Math.max(t, c.top); rr = Math.min(rr, c.right); b = Math.min(b, c.bottom);
      }
      return { l, t, r: rr, b, w: rr - l, h: b - t };
    };
    const covers = [];
    const sel = 'button, a[href], input, select, textarea, [role="button"], [role="slider"], [role="radio"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';
    for (const e of document.querySelectorAll('.stage ' + sel.split(', ').join(', .stage '))) {
      if (layer.contains(e) || !vis(e) || getComputedStyle(e).pointerEvents === 'none') continue;
      const r = seen(e, R(e));
      if (r.w <= 0 || r.h <= 0 || contains(r) || !hit(r, pill)) continue;
      covers.push({ kind: 'control', what: cls(e), rib: !!e.closest('.rib'), mood: !!e.closest('.u-office-slot') });
    }
    const walk = document.createTreeWalker(document.querySelector('.stage'), NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const p = n.parentElement;
      if (!p || !n.textContent.trim() || layer.contains(p) || !vis(p) || p.closest('canvas, script, style')) continue;
      const g = document.createRange();
      g.selectNodeContents(n);
      for (const q of g.getClientRects()) {
        if (q.width === 0 || q.height === 0) continue;
        const vr = seen(p, { l: q.left, t: q.top, r: q.right, b: q.bottom }, true);
        if (vr.w > 0 && vr.h > 0 && hit(vr, pill)) { covers.push({ kind: 'words', what: n.textContent.trim().slice(0, 28), rib: !!p.closest('.rib'), hint: !!p.closest('.dream-hint'), mood: !!p.closest('.u-office-slot') }); break; }
      }
    }
    out.covers = covers;
    // The Office moods row (Unwind): the row's last chip and its Off chip against this control's box in this state.
    const slot = document.querySelector('.u-office-slot[data-moods="shown"]');
    if (slot) {
      const chips = [...slot.querySelectorAll('.u-mood')].map((e) => ({ what: (e.textContent || '').trim().slice(0, 18), off: e.classList.contains('off'), r: R(e) }));
      const last = chips.reduce((a, c) => (c.r.r > a.r.r ? c : a), chips[0]);
      const ov = (c) => { const w = Math.min(c.r.r, pill.r) - Math.max(c.r.l, pill.l); const h = Math.min(c.r.b, pill.b) - Math.max(c.r.t, pill.t); return w > 0.5 && h > 0.5 ? { what: c.what, off: c.off, w: Math.round(w), h: Math.round(h) } : null; };
      out.moods = { chips: chips.length, lastRight: Math.round(last.r.r), overlaps: chips.map(ov).filter(Boolean), offChip: !!chips.find((c) => c.off), row: R(slot) };
      out.moods.restGap = Math.round(out.wrap.l - last.r.r);
    }
    out.stage = { w: innerWidth, h: innerHeight };
    return out;
  }
};

let rests = [];
const BOX = { l: 2504, t: 664, w: 36, h: 36 };
const near = (a, b, d = 0.6) => Math.abs(a - b) <= d;
const place = (v) => v.name.replace(/^Hide screen, [^:]+: /, '');

function rule(v, results, emit) {
  if (!v.name.startsWith('Hide screen, ')) return false;
  const m = results.hideScreen;
  if (!m) { emit('  FAIL hide screen: the measurement did not run'); return true; }
  if (m.broke) { emit(`  FAIL hide screen: the check broke: ${m.broke}`); return true; }
  const fails = [];
  const where = place(v);
  const r = m.btn;
  if (m.count !== 1) fails.push(`${m.count} Hide screen buttons on the page (one, mounted once, is wanted)`);
  if (m.layers !== 1) fails.push(`${m.layers} corner layers (one is wanted)`);
  if (!r) { emit(`  FAIL hide screen: ${fails.join('; ')}`); return true; }
  // The box does not move or resize in any state.
  const wrap = m.wrap;
  if (!(near(wrap.l, BOX.l) && near(wrap.t, BOX.t) && near(wrap.w, BOX.w) && near(wrap.h, BOX.h))) fails.push(`box ${wrap.w}x${wrap.h} at ${Math.round(wrap.l)}, ${Math.round(wrap.t)} (36 by 36 at ${BOX.l}, ${BOX.t} on every place)`);
  if (m.mode !== 'drawer') {
    // The icon stays where the resting pill has it, and the pill grows to the left only.
    if (!(near(m.icon.l, 2510) && near(m.icon.t, 671) && near(m.icon.w, 22))) fails.push(`icon at ${Math.round(m.icon.l)}, ${Math.round(m.icon.t)} (${m.icon.w} wide; 22 wide at 2510, 671)`);
    if (!(near(r.r, 2540) && near(r.t, BOX.t) && near(r.h, BOX.h))) fails.push(`pill ends at x ${Math.round(r.r)}, y ${Math.round(r.t)}, ${Math.round(r.h)} tall (right edge 2540, top 664, 36 tall)`);
    if (r.l < 0) fails.push(`pill leaves the stage at x ${Math.round(r.l)}`);
    if (!m.hitCorner) fails.push('the control does not win the pointer inside its own box (something is above it)');
  }
  if (m.mode === 'rest') {
    if (!near(r.w, 36)) fails.push(`at rest the control is ${Math.round(r.w)} px wide (36)`);
    if (m.tag !== 'BUTTON' || m.tabIndex !== 0 || m.inert) fails.push(`not a button in the tab order (${m.tag}, tabindex ${m.tabIndex}${m.inert ? ', inert' : ''})`);
    if (!m.focused) fails.push('it cannot take keyboard focus');
    else if (m.focusVisible && !(m.focusWidth > 60 && m.outline === '3px')) fails.push(`with focus it is ${Math.round(m.focusWidth)} px wide with a ${m.outline} ring (its name shows and the 3 px ring)`);
    else if (!m.focusVisible) fails.push('keyboard focus did not match focus-visible (the check cannot see its ring)');
    if (m.opacity < 0.79 || m.color !== m.dim) fails.push(`the declared rest colour is ${m.color} at ${m.opacity} (the dim colour at 0.8 or more; the declared token, not rendered contrast)`);
    if (m.pendingOpacity < 0.59) fails.push(`the declared Hiding opacity is ${m.pendingOpacity} (0.6 or more)`);
    if (m.calmRules < 1) fails.push('no reduced motion rule takes the control\'s transitions off');
    // At rest nothing at all sits under it, a strip's last hour included.
    for (const c of m.covers) fails.push(`at rest it sits over ${c.kind} "${c.what}"`);
    if (m.place && !['work', 'home', 'meet', 'onair', 'unwind', 'zen'].includes(m.place)) fails.push(`unknown place ${m.place}`);
    if (!m.hitCentre) fails.push('the pointer at its centre does not reach it (something is above it)');
    if (m.mode === 'rest' && m.place === 'zen' && !(m.z > 50)) fails.push(`on Zen it is at z ${m.z}, under Zen's own layer (50)`);
    if (!m.moods) rests.push({ where, box: [wrap.l, wrap.t, wrap.w, wrap.h].map((n) => Math.round(n * 10) / 10).join(',') });
  }
  if (m.mode === 'grown' || m.mode === 'failed') {
    const want = m.mode === 'failed' ? 'Could not watch input' : null;
    const widest = m.mode === 'failed' ? 240 : 160;
    if (r.w <= 60) fails.push(`it did not grow (${Math.round(r.w)} px)`);
    if (r.w > widest) fails.push(`the pill is ${Math.round(r.w)} px wide (${widest} at most)`);
    if (want && m.label !== want) fails.push(`the pill reads "${m.label}" (the failure words go inside it)`);
    const name = /hide=on/.test(v.q) ? 'Cancel hide' : 'Hide screen';
    if (!want && m.label !== name) fails.push(`the pill reads "${m.label}" (${name} wanted)`);
    // It covers no control and no words, except what sits in the day strip's last hour while it is pointed at.
    for (const c of m.covers) {
      if (c.rib && m.hasRib) continue;
      // The Office moods row ends before the control: the grown pill covering any chip is a failure. Only the five second failure words may reach the Off chip (accepted by the vote).
      if (c.mood && m.moods && m.mode === 'failed') continue;
      // The failure words (five seconds, rare) are wider than the name and may sit over Dream's hint, which is not a control.
      if (m.mode === 'failed' && c.hint) continue;
      fails.push(`the grown pill covers ${c.kind} "${c.what}"`);
    }
  }
  if (m.mode === 'drawer') {
    if (!m.drawers) fails.push('no drawer is open');
    if (!m.inert) fails.push('the control is not inert while a drawer is open');
    if (m.hitCentre || m.hitSliver || m.hitCorner) fails.push('the control still takes the pointer while a drawer is open' + (m.hitSliver ? ' (at the drawer\'s rounded corner)' : ''));
    if (m.focused) fails.push('the control still takes keyboard focus while a drawer is open');
  }
  if (m.moods) {
    const mo = m.moods;
    if (m.mode === 'rest' && !(mo.restGap >= 8)) fails.push(`the control's box starts ${mo.restGap} px from the row's last chip (8 at least; ${mo.chips} chips)`);
    if (m.mode === 'rest' && mo.overlaps.length) fails.push('at rest the row overlaps the control: ' + mo.overlaps.map((o) => `${o.what} ${o.w}x${o.h}`).join(', '));
    if (m.mode === 'grown' && mo.overlaps.length) fails.push('the grown pill covers the Office moods row: ' + mo.overlaps.map((o) => `${o.off ? 'the Off chip' : 'chip "' + o.what + '"'} ${o.w}x${o.h}`).join(', '));
    if (m.mode === 'failed') emit(`  note hide screen: with ${mo.chips} Office moods${mo.offChip ? ' and Off' : ''} the grown ${Math.round(r.w)} px pill covers ${mo.overlaps.length ? mo.overlaps.map((o) => `${o.off ? 'the Off chip' : 'chip "' + o.what + '"'} by ${o.w} x ${o.h} px`).join(', ') : 'no chip'} (the row's last chip ends at x ${mo.lastRight}; the failure words may reach the Off chip for five seconds, reported, not a failure)`);
  }
  if (fails.length) {
    for (const f of fails) emit(`  FAIL hide screen: ${f}`);
    return true;
  }
  const what = { rest: `36 by 36 at ${BOX.l}, ${BOX.t}, one button in the tab order, wins its own box, declared rest colour at ${m.opacity}, nothing under it`, grown: `grows to the left to ${Math.round(r.w)} px, icon and box stay, covers nothing outside the day strip`, failed: `the failure words in a ${Math.round(r.w)} px pill, covering nothing outside the day strip`, drawer: 'inert and out of the tab order with a drawer open, also at its corner' }[m.mode];
  emit(`  ok   hide screen: ${what}`);
  if (m.mode === 'rest' && rests.length === 8) {
    const same = new Set(rests.map((x) => x.box)).size === 1;
    emit(`  ${same ? 'ok  ' : 'FAIL'} hide screen: the rest box is the same on all ${rests.length} screens (${[...new Set(rests.map((x) => x.box))].join(' and ')})`);
    rests = [];
    return !same;
  }
  return false;
}

const on = (...names) => (v) => names.includes(v.name);
const FAIL = (text) => new RegExp(`^ *FAIL hide screen: [^\\n]*${text}`, 'm');

const gState = (place, nm, query, expect, actions) => ({ screen: PLACES[place].gallery, name: `hide screen: ${nm}`, query: `${query.slice(1)}`, custom: true, expect, ...(actions ? { actions } : {}) });
// The gallery opens Meet, Zen and Dream with `screen=`; the fit pages with `go=`.
const GQ = (place, extra = '') => `${PLACES[place].fit.replace('&go=', '&screen=')}${extra}`;
const states = [
  gState('work', 'Work, hidden and watching', GQ('work', '&hide=on'), ['Hide screen'], ['.screens-off', 'hover:.rail']),
  gState('work', 'Work, Tools open over the corner', GQ('work', '&tools=1'), ['Hide screen']),
  gState('work', 'Work, Day drawer open over the corner', GQ('work'), ['Hide screen'], '.rib-handle:not(.in-drawer)'),
  gState('listen', 'Unwind, Listen with the tall card, pointer on it', GQ('listen'), ['Hide screen'], ['.sp-grow', 'hover:.screens-off']),
  gState('work', 'Work at 11:40 PM at rest', GQ('work'), ['Hide screen']),
  gState('listen', 'Unwind, Listen at rest', GQ('listen'), ['Hide screen']),
  gState('watch', 'Unwind, Watch at rest', GQ('watch'), ['Hide screen']),
  gState('work', 'Work at 11:40 PM, pointer on it', GQ('work'), ['Hide screen'], 'hover:.screens-off'),
  gState('work', 'Work, Hiding after a click', GQ('work'), ['Hiding'], ['hover:.screens-off', '.screens-off']),
  gState('work', 'Work, Cancel hide', GQ('work', '&hide=on'), ['Cancel hide'], ['.screens-off', 'hover:.screens-off']),
  gState('work', 'Work, failure words in the pill', GQ('work', '&hide=fail'), ['Could not watch input'], ['.screens-off', 'hover:.screens-off']),
  gState('home', 'Home at rest', GQ('home'), ['Hide screen']),
  gState('meet', 'Meet at rest', GQ('meet'), ['Hide screen']),
  gState('onair', 'On Air at rest', GQ('onair'), ['Hide screen']),
  gState('onair', 'On Air, pointer on it', GQ('onair'), ['Hide screen'], 'hover:.screens-off'),
  gState('zen', 'Zen at rest', GQ('zen'), ['Hide screen']),
  gState('zen', 'Zen, pointer on it', GQ('zen'), ['Hide screen'], 'hover:.screens-off'),
  gState('zen', 'Zen, failure words in the pill', GQ('zen', '&hide=fail'), ['Could not watch input'], ['.screens-off', 'hover:.screens-off']),
  gState('dream', 'Dream at rest', GQ('dream'), ['Hide screen', 'Click anywhere to wake']),
  gState('dream', 'Dream, pointer on it', GQ('dream'), ['Hide screen', 'Click anywhere to wake'], 'hover:.screens-off'),
  gState('dream', 'Dream, Cancel hide', GQ('dream', '&hide=on'), ['Cancel hide'], ['.screens-off', 'hover:.screens-off']),
  gState('dream', 'Dream, failure words in the pill', GQ('dream', '&hide=fail'), ['Could not watch input'], ['.screens-off', 'hover:.screens-off']),
];

export default {
  name: 'hide-screen',
  gallery: { states },
  fit: {
    variants,
    measurements: { hideScreen: measureHide },
    rules: { hideScreen: rule },
    breaks: {
      'hide-box': { css: ".so-layer { left: 2496px !important; }", expect: FAIL('box 36x36 at 2496'), appliesTo: on(name('at rest', 'home')) },
      'hide-size': { css: '.screens-off-wrap, .so-layer { width: 40px !important; height: 40px !important; }', expect: FAIL('box 40x40'), appliesTo: on(name('at rest', 'work')) },
      'hide-rest-colour': { css: '.screens-off { opacity: 0.7 !important; }', expect: FAIL('the declared rest colour is'), appliesTo: on(name('at rest', 'meet')) },
      'hide-zen-layer': { css: ".so-layer[data-place='zen'] { z-index: 44 !important; }", expect: FAIL('(does not win the pointer|on Zen it is at z)'), appliesTo: on(name('at rest', 'zen')) },
      'hide-dream-wins': { css: ".so-layer { z-index: 3 !important; }", expect: FAIL('does not win the pointer'), appliesTo: on(name('at rest', 'dream')) },
      'hide-under': { css: '.so-layer { left: 2400px !important; }', expect: FAIL('(at rest it sits over|box 36x36)'), appliesTo: on(name('at rest', 'onair')) },
      'hide-grow': { css: '.screens-off.fit-hover { min-width: 400px !important; }', expect: FAIL('the pill is \\d+ px wide'), appliesTo: on(name('pointer on it', 'home')) },
      'hide-icon': { css: '.screens-off.fit-hover { padding-right: 30px !important; }', expect: FAIL('icon at'), appliesTo: on(name('pointer on it', 'work')) },
      'hide-zen-leave': { css: '.zen-br { bottom: 44px !important; }', expect: FAIL('the grown pill covers words'), appliesTo: on(name('pointer on it', 'zen')) },
      'hide-dream-hint': { css: '.dream-hint { right: 124px !important; }', expect: FAIL('the grown pill covers words "Click anywhere to wake"'), appliesTo: on(name('pointer on it', 'dream')) },
      'hide-failure-width': { css: ".screens-off[data-failed='true'] { padding-left: 120px !important; }", expect: FAIL('the pill is \\d+ px wide'), appliesTo: on(name('failure words', 'work')) },
      'hide-failure-words': { css: ".screens-off[data-failed='true'] .screens-off-lbl { max-width: 0 !important; margin-right: 0 !important; }", expect: FAIL('it did not grow'), appliesTo: on(name('failure words', 'zen')) },
      'hide-moods-rest': { css: '.u-office-slot { right: 10px !important; }', expect: FAIL('(at rest the row overlaps the control|at rest it sits over|the control.s box starts)'), appliesTo: on('Hide screen, at rest: Unwind with twelve Office moods and Off') },
      'hide-moods-hover': { css: '.u-office-slot { right: 50px !important; max-width: 1250px !important; }', expect: FAIL('the grown pill covers the Office moods row'), appliesTo: on('Hide screen, pointer on it: Unwind with twelve Office moods and Off') },
      'hide-no-tab': { query: '&hidebreak=notab', expect: FAIL('not a button in the tab order'), appliesTo: on(name('at rest', 'listen')) },
      'hide-not-inert': { query: '&hidebreak=uninert', expect: FAIL('the control is not inert while a drawer is open'), appliesTo: on(name('Tools open', 'work')) },
      'hide-not-inert-day': { query: '&hidebreak=uninert', expect: FAIL('the control is not inert while a drawer is open'), appliesTo: on(name('Day drawer open', 'work')) },
      'hide-sliver': { query: '&hidebreak=uninert', expect: FAIL('the control still takes the pointer while a drawer is open \\(at the drawer'), appliesTo: on(name('Tools open', 'listen')) },
    },
  },
};
