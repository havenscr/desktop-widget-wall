// The Office moods row at the foot of Unwind: gallery states, fit variants, one browser measurement with its rule, and the deliberate
// breaks. The two big review scripts are only edited for the slot's three rules (its width up to 1124, its content allowed while
// the row is shown, and the row and its line left out of the "nothing else enters the slot" scan). Every state comes from the
// `?office=`, `?officeoff=`, `?officemood=`, `?officestale=`, `?officeslow=`, `?studiowrite=` and `?desktoken=` knobs of the
// development mocks. Mock moods are invented.

/**
 * Runs in the page (it references nothing outside its own body). With the row shown: the slot's box, the label, every chip
 * with its text size, the line, and whatever else draws inside the row's box or the line's box. With the row hidden: the
 * slot's box and whether anything is in it. Transitions are switched off first so the Spotify card is measured settled.
 */
function measureMoods() {
  const st = document.createElement('style');
  st.textContent = '.sp-card { transition: none !important; } .sp-songs { animation: none !important; }';
  document.head.appendChild(st);
  const params = new URLSearchParams(location.search);
  const box = (e) => {
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
  };
  const slot = document.querySelector('[data-slot="office-lights"]');
  if (!slot) return { missing: true };
  if (params.get('omfocus')) document.querySelector(params.get('omfocus'))?.focus();
  const line = document.querySelector('.u-office-line');
  const shownRow = slot.dataset.moods === 'shown';
  const small = [];
  const texts = (root, label) => {
    if (!root) return;
    for (const e of [root, ...root.querySelectorAll('*')]) {
      if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const px = parseFloat(cs.fontSize);
      if (px < 15.99) small.push(label + ': "' + e.textContent.trim().slice(0, 24) + '" is ' + px + ' px');
    }
  };
  texts(slot, 'row');
  texts(line, 'line');
  const out = { shownRow, slot: box(slot), empty: slot.childNodes.length === 0, ariaHidden: slot.getAttribute('aria-hidden'), pointer: getComputedStyle(slot).pointerEvents, line: box(line), small };
  if (!shownRow) return out;
  out.label = box(slot.querySelector('.u-mood-label'));
  out.chips = [...slot.querySelectorAll('.u-mood')].map((c) => {
    const name = c.querySelector('.u-mood-name');
    return { text: (name?.textContent ?? '').trim().slice(0, 24), ...box(c), cut: !!name && name.scrollWidth > name.clientWidth + 1, pointer: getComputedStyle(c).pointerEvents, icon: c.classList.contains('icon-only'), label: c.getAttribute('aria-label') ?? '' };
  });
  const strip = slot.querySelector('[data-part="palette-strip"]');
  out.sync = box(slot.querySelector('.u-sync'));
  out.syncState = slot.querySelector('.u-sync')?.getAttribute('data-state') ?? null;
  out.syncFirst = slot.querySelector('.u-mood') === slot.querySelector('.u-sync');
  {
    const nm = slot.querySelector('.u-sync .u-mood-name');
    const rg = document.createRange();
    if (nm) rg.selectNodeContents(nm);
    out.syncLabel = nm ? box(rg) : null;
    out.syncIcon = box(slot.querySelector('.u-sync-main svg'));
    out.syncSwitch = box(slot.querySelector('.u-sync-switch'));
    out.syncKnob = box(slot.querySelector('.u-sync-knob'));
  }
  out.strip = box(strip);
  out.pals = strip ? [...strip.querySelectorAll('.u-pal')].map((c) => { const n = c.querySelector('.u-mood-name'); const rg = document.createRange(); rg.selectNodeContents(n); const tr = box(rg); return { text: n.textContent.trim(), ...box(c), cut: n.scrollWidth > n.clientWidth + 1, pad: Math.min(tr.l - c.getBoundingClientRect().left, c.getBoundingClientRect().right - tr.r) }; }) : [];
  out.lineCut = !!line && line.scrollWidth > line.clientWidth + 1;
  out.lineCs = line ? { ws: getComputedStyle(line).whiteSpace, ov: getComputedStyle(line).textOverflow } : null;
  // What else draws inside either box: images, svgs, buttons, inputs, canvases, or own text, cut by every ancestor that clips.
  const draws = (e) => ['IMG', 'svg', 'BUTTON', 'INPUT', 'CANVAS'].includes(e.tagName) || [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
  const shown = (e) => {
    const q = e.getBoundingClientRect();
    let l = q.left, t = q.top, r = q.right, b = q.bottom;
    for (let a = e.parentElement; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const c = a.getBoundingClientRect();
      l = Math.max(l, c.left); t = Math.max(t, c.top); r = Math.min(r, c.right); b = Math.min(b, c.bottom);
    }
    return { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t };
  };
  const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  const rowBox = slot.getBoundingClientRect();
  const lineBox = line ? line.getBoundingClientRect() : null;
  out.enters = [];
  for (const e of document.querySelectorAll('.stage *')) {
    if (e === slot || slot.contains(e) || e === line || line?.contains(e) || e.closest('.screens-off-wrap') || e.closest('.horizon-canvas') || e.tagName === 'CANVAS' || e.closest('.hover-tip') || !draws(e)) continue;
    const q = shown(e);
    // A drawing laid over the whole wall (the drive-in tower's svg) is a layer, not a thing at the row: what it paints is judged by its own checks.
    if (q.width <= 0 || q.height <= 0 || q.width > 2000) continue;
    if (hit(q, rowBox)) out.enters.push('row <- ' + String(e.className?.baseVal ?? e.className ?? e.tagName) + ' "' + (e.textContent || '').trim().slice(0, 24) + '"');
    else if (lineBox && hit(q, lineBox)) out.enters.push('line <- ' + String(e.className?.baseVal ?? e.className ?? e.tagName) + ' "' + (e.textContent || '').trim().slice(0, 24) + '"');
  }
  return out;
}

const r1 = (n) => Math.round(n * 10) / 10;
const HIDDEN_V = 'Office moods, the home app absent';
// Twelve long names may be cut by the fit rule (the full name is in each chip's tip).
const CUTS_OK = ['Office moods, twelve long names, Off', 'Office moods, twelve moods, the tall Spotify panel on Up next'];

const rule = (variant, results, emit) => {
  const m = results.moods;
  if (!variant.name.startsWith('Office moods')) return false;
  const fails = [];
  if (!m || m.missing) fails.push('officemoods: the office lights slot is not on the page');
  else if (variant.name === HIDDEN_V) {
    if (m.shownRow || !m.empty || m.ariaHidden !== 'true' || m.line) fails.push('officemoods: the slot is not the empty aria-hidden box with no line');
    if (!m.slot || Math.abs(m.slot.w - 420) > 0.5 || Math.abs(m.slot.h - 34) > 1 || Math.abs(m.slot.r - 2364) > 1) fails.push('officemoods: the empty slot is ' + r1(m.slot.w) + ' by ' + r1(m.slot.h) + ' (420 by 34 at right edge 2364)');
  } else if (!m.shownRow) fails.push('officemoods: the row is not shown in a state that must show it');
  else {
    const s = m.slot;
    if (Math.abs(s.r - 2364) > 1 || Math.abs(s.t - 656) > 1 || Math.abs(s.h - 34) > 1) fails.push('officemoods: the row is at right edge ' + r1(s.r) + ', top ' + r1(s.t) + ', ' + r1(s.h) + ' tall (2364, 656, 34)');
    if (s.l < 1239.5) fails.push('officemoods: the row starts at x ' + r1(s.l) + ' (1240 at most to the left)');
    if (m.pointer !== 'none') fails.push('officemoods: the row box takes the pointer');
    for (const c of m.chips) {
      if (c.h < 33 || c.h > 35) fails.push('officemoods: chip "' + c.text + '" is ' + r1(c.h) + ' px tall (34)');
      // As before and Off drop to a 40 px icon with a name only when twelve moods need the room.
      if (c.icon) { if (c.w < 39.5 || !c.label) fails.push('officemoods: icon chip "' + c.label + '" is ' + r1(c.w) + ' px wide or has no name (40 and a name)'); }
      else if (c.w < 75.5 && c.text !== 'Off') fails.push('officemoods: chip "' + c.text + '" is ' + r1(c.w) + ' px wide (76 at least)');
      if (c.text === 'Music sync' && (c.l < s.l - 0.5 || c.r > s.r + 0.5)) fails.push('officemoods: the Music sync chip is clipped or outside the row');
      if (c.pointer !== 'auto') fails.push('officemoods: chip "' + c.text + '" does not take the pointer');
      if ((c.l < s.l - 0.5 || c.r > s.r + 0.5) && !(CUTS_OK.includes(variant.name) && c.text !== 'Music sync')) fails.push('officemoods: chip "' + c.text + '" leaves the row box');
    }
    for (let i = 1; i < m.chips.length; i++) if (m.chips[i].l < m.chips[i - 1].r - 0.5 && !CUTS_OK.includes(variant.name)) fails.push('officemoods: chips "' + m.chips[i - 1].text + '" and "' + m.chips[i].text + '" overlap');
    if (!m.sync || Math.abs(m.sync.w - 203) > 0.5) fails.push('officemoods: the Music sync chip is ' + (m.sync ? r1(m.sync.w) : 'missing') + ' px wide (203, fixed)');
    else if (!m.syncFirst) fails.push('officemoods: the Music sync chip is not the first chip');
    if (m.sync && m.syncLabel && m.syncSwitch && m.syncIcon) {
      if (Math.abs((m.syncIcon.l - m.sync.l) - (m.sync.r - m.syncSwitch.r)) > 0.5) fails.push('officemoods: the Music sync icon is ' + r1(m.syncIcon.l - m.sync.l) + ' px from the left edge but the switch is ' + r1(m.sync.r - m.syncSwitch.r) + ' px from the right (equal)');
      if (Math.abs((m.syncLabel.l - m.syncIcon.r) - 8) > 0.5) fails.push('officemoods: the Music sync icon is ' + r1(m.syncLabel.l - m.syncIcon.r) + ' px from the name (8)');
      if (m.syncIcon.l - m.sync.l < 10) fails.push('officemoods: the Music sync icon is ' + r1(m.syncIcon.l - m.sync.l) + ' px from the chip edge (10 at least)');
      if (m.sync.r - m.syncSwitch.r < 10) fails.push('officemoods: the Music sync switch is ' + r1(m.sync.r - m.syncSwitch.r) + ' px from the chip edge (10 at least)');
      if (m.syncSwitch.l - m.syncLabel.r < 10) fails.push('officemoods: the Music sync label is ' + r1(m.syncSwitch.l - m.syncLabel.r) + ' px from the switch (10 at least)');
      if (Math.abs(m.syncSwitch.w - 40) > 0.5 || Math.abs(m.syncSwitch.h - 22) > 0.5) fails.push('officemoods: the Music sync switch is ' + r1(m.syncSwitch.w) + ' by ' + r1(m.syncSwitch.h) + ' (40 by 22)');
      if (m.syncKnob && (m.syncKnob.l < m.syncSwitch.l || m.syncKnob.r > m.syncSwitch.r)) fails.push('officemoods: the Music sync knob leaves its track');
    }
    const STRIP_V = variant.name.includes(NAMES.strip);
    if (STRIP_V && !m.strip) fails.push('officemoods: the palette strip is not open');
    if (!STRIP_V && m.strip) fails.push('officemoods: the palette strip is open in a state that should not show it');
    if (m.strip) {
      if (m.pals.length !== 8) fails.push('officemoods: the strip has ' + m.pals.length + ' palettes (8)');
      if (m.strip.r > s.r + 1) fails.push('officemoods: the strip ends at x ' + r1(m.strip.r) + ', past the row edge ' + r1(s.r));
      if (m.strip.l < 1239.5) fails.push('officemoods: the strip starts at x ' + r1(m.strip.l) + ' (1240 at most to the left)');
      if (m.strip.b > s.t + 0.5) fails.push('officemoods: the strip overlaps the row (ends y ' + r1(m.strip.b) + ', the row starts ' + r1(s.t) + ')');
      for (const p of m.pals) {
        if (p.cut) fails.push('officemoods: palette name "' + p.text + '" is cut');
        if (p.h < 33 || p.h > 35) fails.push('officemoods: palette "' + p.text + '" is ' + r1(p.h) + ' px tall (34)');
        if (p.pad < 9.5) fails.push('officemoods: palette "' + p.text + '" text is ' + r1(p.pad) + ' px from its button edge (10 at least)');
      }
    }
    if (m.label && m.chips.length && m.label.r > m.chips[0].l + 0.5) fails.push('officemoods: the label overlaps the first chip');
    const ln = m.line;
    const WARN_V = [`Office moods, ${NAMES.token}`, `Office moods, ${NAMES.tokenOn}`];
    if (!ln && WARN_V.includes(variant.name)) fails.push('officemoods: the amber line above the row is missing');
    else if (ln && !WARN_V.includes(variant.name) && !variant.name.endsWith(NAMES.refused)) fails.push('officemoods: a plain status line is drawn above the row (the status is a hidden live region)');
    else if (ln) {
      if (ln.r > 1695.5) fails.push('officemoods: the line ends at x ' + r1(ln.r) + ' (1695 at most, 12 px left of the tall Spotify panel)');
      if (Math.abs(ln.t - 624) > 1 || ln.b > 650.5) fails.push('officemoods: the line is at y ' + r1(ln.t) + ' to ' + r1(ln.b) + ' (624 to 650)');
      if (ln.l < 934.5) fails.push('officemoods: the line starts at x ' + r1(ln.l) + ' (935 at least, clear of the status line)');
      if (ln.b > s.t - 3) fails.push('officemoods: the line is not clear of the row (ends y ' + r1(ln.b) + ', the row starts ' + r1(s.t) + ')');
      if (m.lineCs && (m.lineCs.ws !== 'nowrap' || m.lineCs.ov !== 'ellipsis')) fails.push('officemoods: the line is not one line with an ellipsis');
    }
    for (const e of m.enters.slice(0, 3)) fails.push('officemoods: something else draws inside the ' + e);
    if (m.chips.some((c) => c.cut) && !CUTS_OK.includes(variant.name)) fails.push('officemoods: a chip name is cut in a state that must show every name whole (' + m.chips.filter((c) => c.cut).map((c) => c.text).join(', ') + ')');
  }
  if (m && m.small) for (const x of m.small) fails.push('officemoods: text under 16 px: ' + x);
  for (const f of fails) emit('  FAIL ' + f);
  if (fails.length) return true;
  emit(variant.name === HIDDEN_V
    ? '  ok   officemoods: the slot is the empty 420 by 34 aria-hidden box with no line'
    : '  ok   officemoods: the row is at right edge 2364, top 656, 34 tall, from x 1240 or more; chips 34 tall and 76 or wider; an amber line (refusals and failures only) inside x 935 to 1695, y 624 to 650; nothing else draws inside either; text 16 px or more');
  return false;
};

const at = '2026-11-11T10:24:00-08:00';
const night = '2026-11-11T22:30:00-08:00';
const TOKEN = '&desktoken=set';
const q = (extra, when = at) => `?hz=unwind&at=${when}&long=1&agents=3&audio=demo${extra}`;
const V = (name, extra, more = {}) => ({ name: `Office moods, ${name}`, q: q(extra), checks: ['.u-office-slot'], ...more });

const SIX = `${TOKEN}&office=six&officeoff=offered&officemood=relax`;
const TWELVE = `${TOKEN}&office=twelve&officeoff=offered&officemood=brightDesk`;
const NAMES = {
  six: 'six moods and Off, one on',
  five: 'five moods, no Off',
  twelve: 'twelve long names, Off',
  hover: 'a hovered chip',
  focus: 'a focused chip',
  token: 'no desk token',
  tokenOn: 'no desk token, a mood on',
  stale: 'a stale read',
  flight: 'a write in flight',
  refused: 'a refused write',
  tall: 'twelve moods, the tall Spotify panel on Up next',
  saved: 'six moods, a tall saved playlist',
  leave: 'six moods, the leave banner',
  drivein: 'six moods, the Watch drive-in',
  own: 'six moods, a tall own playlist on Watch',
  night: 'six moods, Off lit, at night',
  absent: 'the home app absent',
  strip: 'the palette strip open',
  syncOn: 'music sync on',
  syncStart: 'music sync starting',
  syncFail: 'music sync failed',
  syncUnpaired: 'music sync not paired',
  syncHue: 'music sync stopped Hue Sync',
  review: 'six moods, the review clock and no long names',
};

const variants = [
  V(NAMES.six, SIX),
  V(NAMES.five, `${TOKEN}&office=five&officemood=meeting`),
  V(NAMES.twelve, TWELVE),
  V(NAMES.hover, SIX, { click: 'hover:[data-mood="gaming"]' }),
  { ...V(NAMES.focus, SIX), q: q(SIX) + '&omfocus=%5Bdata-mood%3D%22gaming%22%5D' },
  V(NAMES.token, '&office=six&officeoff=offered&officemood=relax&desktoken=unset'),
  V(NAMES.tokenOn, '&office=six&officeoff=offered&officemood=relax&desktoken=unset'),
  V(NAMES.stale, `${SIX}&officestale=1`),
  V(NAMES.flight, `${SIX}&officeslow=1`, { click: '[data-mood="gaming"]' }),
  V(NAMES.refused, `${SIX}&studiowrite=onair`, { click: '[data-mood="gaming"]' }),
  V(NAMES.tall, TWELVE, { click: 'grow >> .mu-places button:nth-child(5)' }),
  V(NAMES.saved, `${SIX}&spotify=notyours&spotifypage=first`, { click: 'grow >> .sp-tile' }),
  V(NAMES.leave, `${SIX}&leave=12`),
  V(NAMES.drivein, `${SIX}&watch=mock&wlist=three&wlook=drivein&wplay=0`),
  V(NAMES.own, `${SIX}&watch=mock&wlook=sky&wmeta=title&wown=edit&wplay=3`),
  { ...V(NAMES.night, `${TOKEN}&office=six&officeoff=on`), q: q(`${TOKEN}&office=six&officeoff=on`, night) },
  V(NAMES.absent, ''),
  V(NAMES.syncOn, `${SIX}&lsync=on`),
  V(NAMES.syncStart, `${SIX}&lsync=slow`, { click: '[data-part="sync-switch"]' }),
  V(NAMES.syncFail, `${SIX}&lsync=fail`, { click: '[data-part="sync-switch"]' }),
  V(NAMES.syncUnpaired, `${SIX}&lsync=unpaired`, { click: '[data-part="sync-switch"]' }),
  V(NAMES.syncHue, `${SIX}&lsync=hue`, { click: '[data-part="sync-switch"] >> hover:[data-part="sync-switch"]' }),
  { ...V(NAMES.review, SIX), q: `?hz=unwind&at=${encodeURIComponent(night)}&clock=review&weather=ok&audio=demo${SIX}` },
  V(NAMES.strip, SIX, { click: '[data-part="sync-main"]' }),
  V(NAMES.strip + ', sync on', `${SIX}&lsync=on`, { click: '[data-part="sync-main"]' }),
];

const on = (...keys) => (v) => keys.some((k) => v.name === `Office moods, ${NAMES[k]}`);

const gq = (extra) => `hz=unwind&at=${encodeURIComponent(night)}&clock=review&weather=ok&audio=demo${extra.includes('desktoken=') ? '' : TOKEN}&${extra}`;
const gstate = (name, extra, expect, actions) => ({ screen: 'unwind', name: `office moods: ${name}`, query: gq(extra), custom: true, expect, ...(actions ? { actions } : {}) });
const LONG_NAME = 'Bright desk for the long afternoon sessions';

export default {
  name: 'office-moods',
  gallery: {
    states: [
      gstate('absent, the slot stays empty', 'office=absent', ['!Office moods', '!No mood on.']),
      gstate('the home app is down, the slot stays empty', 'office=down', ['!Office moods', '!No mood on.']),
      gstate('an empty list, the slot stays empty', 'office=empty', ['!Office moods', '!No mood on.']),
      gstate('six moods and Off, a mood on', 'office=six&officeoff=offered&officemood=relax', ['Office moods', 'Bright desk', 'Reading', 'Relax', 'Gaming', 'Meeting', 'Night', 'Off', 'Relax:', 'Room 35%, neon 30%']),
      gstate('six moods, no Off until the home app offers it', 'office=six&officemood=gaming', ['Office moods', 'Gaming:', 'Room 25%, panels 10%']),
      gstate('five moods, none on', 'office=five', ['Office moods', 'No mood on.']),
      gstate('Off is lit', 'office=six&officeoff=on', ['Office lights are off.', 'Off']),
      gstate('music sync chip first, idle', 'office=six&officeoff=offered&officemood=relax', ['Music sync', 'Relax:'], 'hover:[data-part="sync-main"]'),
      gstate('music sync on', 'office=six&officeoff=offered&officemood=relax&lsync=on', ['Music sync']),
      gstate('music sync starting', 'office=six&officeoff=offered&officemood=relax&lsync=slow', ['Starting music sync'], '[data-part="sync-switch"] >> hover:[data-part="sync-switch"]'),
      gstate('music sync not paired points at Tools', 'office=six&officeoff=offered&officemood=relax&lsync=unpaired', ['Pair it in Tools'], '[data-part="sync-switch"] >> hover:[data-part="sync-switch"]'),
      gstate('music sync failed', 'office=six&officeoff=offered&officemood=relax&lsync=fail', ['The Hue bridge did not answer.'], '[data-part="sync-switch"] >> hover:[data-part="sync-switch"]'),
      gstate('the palette strip open', 'office=six&officeoff=offered&officemood=relax', ['Synthwave', 'Album art', 'Wall sky', 'Office mood', 'Electric Sheep', 'Neon City', 'Zen Tide', 'Your own'], '[data-part="sync-main"]'),
      gstate('a click on Off', 'office=six&officeoff=offered&officemood=relax', ['Office lights are off.'], '[data-mood="off"]'),
      gstate('a click on a mood', 'office=six&officeoff=offered', ['Gaming:', 'Room 25%, panels 10%'], '[data-mood="gaming"]'),
      gstate('a stale read', 'office=six&officeoff=offered&officemood=relax&officestale=1', ['(not fresh)', 'Relax:']),
      gstate('no desk token', 'office=six&officeoff=offered&desktoken=unset', ["Office moods are view only here. To switch them, add the desk token in Tools."]),
      gstate('no desk token, a mood on keeps its ring', 'office=six&officeoff=offered&officemood=relax&desktoken=unset', ["Office moods are view only here. To switch them, add the desk token in Tools."]),
      gstate('a base the token may not go to', 'office=six&officeoff=offered&desktoken=insecure', ['The desk token goes only to this PC or a tailnet address.']),
      gstate('a write that never answers', 'office=six&officeoff=offered&officeslow=1', ['Gaming: asking the home app'], '[data-mood="gaming"]'),
      gstate('Off that never answers', 'office=six&officeoff=offered&officeslow=1', ['Off: asking the home app'], '[data-mood="off"]'),
      gstate('a refused write, the studio is on air', 'office=six&officeoff=offered&studiowrite=onair', ['The studio is on air. End it with As before on On Air first.'], '[data-mood="off"]'),
      gstate('a refused write, a light did not answer', 'office=six&officeoff=offered&studiowrite=lights', ['A light did not answer the home app. This shows what it reports now.'], '[data-mood="gaming"]'),
      gstate('the home app refused the token', 'office=six&officeoff=offered&studiowrite=forbidden', ['The home app refused the desk token. Type it again in Tools.'], '[data-mood="gaming"]'),
      gstate('the home app has no desk token yet', 'office=six&officeoff=offered&studiowrite=homeunset', ['The home app has no desk token yet. Set the same token there.'], '[data-mood="gaming"]'),
      gstate('a hovered chip', 'office=six&officeoff=offered&officemood=relax', ['Gaming: Room 25%, panels 10%'], 'hover:[data-mood="gaming"]'),
      gstate('a hovered Off chip', 'office=six&officeoff=offered&officemood=relax', ['Turns the office lights off. No other room changes.'], 'hover:[data-mood="off"]'),
      gstate('a focused chip', 'office=six&officeoff=offered&officemood=relax', ['Meeting: Room 80%, desk lamp on'], 'focus:[data-mood="meeting"]'),
      gstate('a hovered chip with no token', 'office=six&officeoff=offered&desktoken=unset', ["Office moods are view only here. To switch them, add the desk token in Tools.", 'Gaming: Room 25%, panels 10%'], 'hover:[data-mood="gaming"]'),
      gstate('twelve long names and lines', 'office=twelve&officeoff=offered&officemood=brightDesk', [LONG_NAME, 'Off']),
      gstate('twelve moods under the tall Spotify panel', 'office=twelve&officeoff=offered&officemood=brightDesk', [LONG_NAME, 'Off'], 'grow >> .mu-places button:nth-child(5)'),
      gstate('a hovered long name shows the whole name and line', 'office=twelve&officeoff=offered&officemood=brightDesk', [`${LONG_NAME}: Room 70%, neon 20%, desk lamp on, panels off`], `hover:[data-mood="brightDesk"]`),
      gstate('six moods with the leave banner', 'office=six&officeoff=offered&officemood=relax&leave=12', ['Office moods', 'Relax:']),
      gstate('six moods on Watch with the drive-in', 'office=six&officeoff=offered&officemood=relax&watch=mock&wlist=three&wlook=drivein&wplay=0', ['Office moods', 'Relax:']),
      gstate('six moods beside a tall own playlist', 'office=six&officeoff=offered&officemood=relax&watch=mock&wlook=sky&wmeta=title&wown=edit&wplay=3', ['Office moods', 'Friday wind down']),
    ],
  },
  fit: {
    variants,
    measurements: { moods: measureMoods },
    rules: { moods: rule },
    breaks: {
      'moods-left': { css: '.u-office-slot { max-width: none !important; } .u-mood-name { max-width: none !important; }', expect: /^ *FAIL officemoods: the row starts at x /m, appliesTo: on('twelve') },
      'moods-narrow': { css: '.u-mood { min-width: 40px !important; } .u-mood-name { max-width: 4px !important; }', expect: /^ *FAIL officemoods: chip ".*" is [\d.]+ px wide \(76 at least\)/m, appliesTo: on('six') },
      'moods-line': { css: '.u-office-line { right: 780px !important; }', expect: /^ *FAIL officemoods: the line ends at x /m, appliesTo: on('token') },
      'moods-small': { css: '.u-mood { height: 30px !important; }', expect: /^ *FAIL officemoods: chip ".*" is [\d.]+ px tall/m, appliesTo: on('six') },
      'moods-sync': { css: '.u-mood.u-sync { width: 180px !important; min-width: 180px !important; }', expect: /^ *FAIL officemoods: the Music sync chip is [\d.]+ px wide/m, appliesTo: on('six') },
      'moods-pal-pad': { css: '.u-pal { padding: 0 2px !important; }', expect: /^ *FAIL officemoods: palette ".*" text is [\d.]+ px from its button edge/m, appliesTo: on('strip') },
      'moods-text': { css: '.u-mood { font-size: 14px !important; }', expect: /^ *FAIL officemoods: text under 16 px/m, appliesTo: on('six') },
    },
  },
};
