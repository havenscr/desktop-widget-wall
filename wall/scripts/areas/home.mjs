// The Home tab's Sound card after the redesign: the play row under the song (equal buttons filling the row), the cover with
// its source badge, Key lights and Panels as equal switch pills with a square Fine tune button, the Panels effects pop-up, and
// More with its three mood tiles and the favorites dropdown. States come from the development mocks' knobs.

const at = '2026-11-11T10:24:00-08:00';
const galleryQuery = (knobs) => `hz=home&at=${encodeURIComponent(at)}&clock=review&weather=ok&${knobs}`;
const fitQuery = (knobs) => `?hz=home&at=${at}&long=1&${knobs}`;

const READY = 'keys2=both&studio=threelooks&desktoken=set&office=desk&officeoff=none&np=skip';
const CHECKS = ['.home .home-centre', '.home .sound', '.home .sound-panel', '.home .np-col', '.home .hs-block', '.home .np-ctl'];

/** Runs in the page: the card's left column, the play row, the cover and badge, the switch row, and whichever pop-up is open. */
function measureHome() {
  const kind = new URLSearchParams(location.search).get('homecheck') ?? 'card';
  const q = (s) => document.querySelector(s);
  const box = (e) => {
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height };
  };
  const inset = (el) => {
    const rg = document.createRange();
    rg.selectNodeContents(el);
    const c = rg.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    return { left: c.left - b.left, right: b.right - c.right };
  };
  const small = [];
  const scan = (root, label) => {
    if (!root) return;
    for (const e of [root, ...root.querySelectorAll('*')]) {
      if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const px = parseFloat(cs.fontSize);
      if (px < 15.99) small.push(label + ': "' + e.textContent.trim().slice(0, 24) + '" is ' + px + ' px');
    }
  };
  const col = q('.home .np-col');
  scan(col, 'left column');
  const out = { kind, small, ctl: box(q('.home .np-ctl')), ctlBtns: [...document.querySelectorAll('.home .np-ctl > *')].map(box), line: box(q('.home .sound-np')), title: box(q('.home .hs-title')), looksRow: !!q('.home .hs-block [data-row="looks"]') };
  const cover = q('.home .sound-np .np-tile-b');
  out.coverImg = !!q('.home .sound-np .np-tile-b img');
  const np = q('.home .sound-np');
  out.lineScroll = np ? np.scrollHeight : 0;
  out.metaKids = [...document.querySelectorAll('.home .sound-np .np-meta > *')].map((e) => e.className + ':' + Math.round(e.getBoundingClientRect().height));
  out.tile = box(cover);
  out.badge = box(q('.home .sound-np .np-badge'));
  out.fallback = box(q('.home .sound-np .np-cover.blank, .home .sound-np .np-slot'));
  const pills = [...document.querySelectorAll('.home .hs-block [data-row="switches"] .st-tg')];
  out.pills = pills.map((p) => ({ ...box(p), group: p.dataset.group }));
  out.pillText = pills.map((p) => {
    const n = p.querySelector('.st-name');
    return n ? { name: n.textContent.trim(), ...inset(n), cut: n.scrollWidth > n.clientWidth + 1 } : null;
  });
  out.icon = box(q('.home .hs-block [data-row="switches"] .st-icon'));
  out.stage = { w: 2560, h: 720 };
  if (kind === 'panels') {
    const pop = q('.home .hs-pop');
    scan(pop, 'effects list');
    out.pop = box(pop);
    out.popRows = pop ? [...pop.querySelectorAll('.hs-pop-row')].map((r) => ({ name: r.textContent.trim(), ...box(r), ...inset(r.querySelector('span')) , pad: (() => { const s = r.querySelector('span').getBoundingClientRect(); const b = r.getBoundingClientRect(); return { l: s.left - b.left, r: b.right - s.right }; })() })) : [];
    out.panelsPill = box(q('.home .hs-panels .st-tg'));
  }
  if (kind === 'more') {
    const pop = q('.home .sound-pop.more-pop');
    scan(pop, 'More');
    out.pop = box(pop);
    out.moods = pop ? [...pop.querySelectorAll('.sound-mood')].map((m) => {
      const b = m.getBoundingClientRect();
      const art = m.querySelector('.sound-art').getBoundingClientRect();
      const nm = m.querySelector('b');
      const nb = nm.getBoundingClientRect();
      return { name: nm.textContent.trim(), w: b.width, h: b.height, left: art.left - b.left, right: b.right - nb.right, cut: nm.scrollWidth > nm.clientWidth + 1 };
    }) : [];
    const dd = q('.home .sound-pop.more-pop .sound-fav-btn');
    out.fav = box(dd);
    out.favText = dd ? (() => { const b = dd.getBoundingClientRect(); return { left: dd.querySelector('span').getBoundingClientRect().left - b.left, right: b.right - dd.querySelector('svg').getBoundingClientRect().right }; })() : null;
    out.favRow = (() => { const r = dd && dd.getBoundingClientRect(); return r ? { l: r.left, r: r.right } : null; })();
  }
  return out;
}

const r1 = (n) => Math.round(n * 10) / 10;
const V_CARD = 'Home sound card, play row and lights';
const V_ART = 'Home sound card, no cover';
const V_LONG = 'Home sound card, long names';
const V_PANELS = 'Home sound card, Panels effects open';
const V_MORE = 'Home sound card, More open';
const variant = (name, knobs, kind, extra = {}) => ({ name, q: `${fitQuery(knobs)}&homecheck=${kind}`, checks: CHECKS, ...extra });
const state = (name, knobs, expect, actions) => ({ screen: 'home', name, query: galleryQuery(knobs), custom: true, expect, actions });
const on = (...names) => (v) => names.includes(v.name);

function rule(v, results, emit) {
  if (!v.name.startsWith('Home sound card')) return false;
  const m = results.home;
  const fails = [];
  const widths = m.ctlBtns.map((b) => r1(b.w));
  if (m.ctlBtns.length === 0 || !m.ctl) fails.push('home sound card: the play row is not on the page');
  else {
    if (Math.max(...widths) - Math.min(...widths) > 1) fails.push('home sound card: the play buttons are ' + widths.join(', ') + ' px wide (equal within 1 px)');
    const lastRight = m.ctlBtns[m.ctlBtns.length - 1].r;
    if (m.ctl.r - 22 - lastRight > 1.5) fails.push('home sound card: the play buttons stop ' + r1(m.ctl.r - 22 - lastRight) + " px short of the row's end");
    for (const b of m.ctlBtns) if (Math.abs(b.h - 40) > 1) fails.push('home sound card: a play button is ' + r1(b.h) + ' px tall (40)');
    if (m.line && m.ctl.t < m.line.b - 0.5) fails.push('home sound card: the play row (y ' + r1(m.ctl.t) + ') sits over the song line (ends y ' + r1(m.line.b) + ')');
    if (m.title && m.title.t < m.ctl.b + 2) fails.push('home sound card: the play row is not above Studio lights');
  }
  if (m.line && (Math.abs(m.line.h - 64) > 1 || m.lineScroll > 65)) fails.push('home sound card: the song line is ' + r1(m.line.h) + ' px tall and ' + m.lineScroll + ' px of content (64): ' + m.metaKids.join(' '));
  if (m.looksRow) fails.push('home sound card: the panel effects row is still on the card');
  if (v.name === V_CARD || v.name === V_LONG) {
    if (!m.coverImg || !m.tile || Math.abs(m.tile.w - 64) > 1 || Math.abs(m.tile.h - 64) > 1) fails.push('home sound card: the cover is not a 64 px tile');
    else if (!m.badge || m.badge.w < 20 || m.badge.r > m.tile.r + 0.5 || m.badge.b > m.tile.b + 0.5 || m.badge.l < m.tile.l) fails.push('home sound card: the source badge is missing or outside the cover corner');
  }
  if (v.name === V_ART) {
    if (m.coverImg) fails.push('home sound card: a cover shows although none exists');
    if (!m.fallback) fails.push('home sound card: with no cover there is no source icon tile');
  }
  const [key, panels] = m.pills;
  if (!key || !panels) fails.push('home sound card: Key lights and Panels are not both there');
  else {
    if (Math.abs(key.w - panels.w) > 1) fails.push('home sound card: Key lights is ' + r1(key.w) + ' px wide and Panels ' + r1(panels.w) + ' (equal within 1 px)');
    if (!m.icon || Math.abs(m.icon.w - m.icon.h) > 1 || Math.abs(m.icon.h - 40) > 1) fails.push('home sound card: the sliders button is ' + (m.icon ? r1(m.icon.w) + ' x ' + r1(m.icon.h) : 'missing') + ' (a 40 px square)');
    for (const t of m.pillText) if (t && (t.cut || t.right < 10)) fails.push('home sound card: the word "' + t.name + '" is cut or ' + r1(t.right) + ' px from its pill side (10 needed)');
  }
  if (v.name === V_PANELS) {
    if (!m.pop || m.popRows.length < 2) fails.push('home sound card: the Panels pop-up lists ' + m.popRows.length + ' effects');
    else {
      if (m.pop.t < m.panelsPill.b) fails.push('home sound card: the pop-up (y ' + r1(m.pop.t) + ') is not under the Panels pill (ends y ' + r1(m.panelsPill.b) + ')');
      if (m.pop.l < 0 || m.pop.r > m.stage.w || m.pop.b > m.stage.h) fails.push('home sound card: the pop-up leaves the screen');
      for (const r of m.popRows) if (r.pad.l < 10 || r.pad.r < 10) fails.push('home sound card: "' + r.name + '" is ' + r1(Math.min(r.pad.l, r.pad.r)) + ' px from its button side (10 needed)');
    }
  }
  if (v.name === V_MORE) {
    const names = m.moods.map((x) => x.name).join('|');
    if (names !== 'Upbeat|Romantic|Reading') fails.push('home sound card: More holds "' + m.moods.map((x) => x.name).join('", "') + '" (Upbeat, Romantic, Reading)');
    const mw = m.moods.map((x) => x.w);
    if (mw.length && Math.max(...mw) - Math.min(...mw) > 1) fails.push('home sound card: the mood tiles are ' + mw.map(r1).join(', ') + ' px wide (equal)');
    for (const x of m.moods) if (x.left < 10 || x.right < 10 || x.cut) fails.push('home sound card: tile "' + x.name + '" has text ' + r1(Math.min(x.left, x.right)) + ' px from its side or cut (10 needed)');
    if (!m.fav) fails.push('home sound card: the favorites dropdown is not in More');
    else if (m.favText.left < 10 || m.favText.right < 10) fails.push('home sound card: the favorites dropdown text is too close to its sides');
    if (m.pop && (m.pop.r > m.stage.w || m.pop.b > m.stage.h)) fails.push('home sound card: More leaves the screen');
  }
  for (const x of m.small) fails.push('home sound card: text under 16 px: ' + x);
  for (const f of fails) emit('  FAIL ' + f);
  if (fails.length) return true;
  emit('  ok   home sound card: equal play row filling its width, no effects row, equal Key lights and Panels, square sliders button, 10 px clear text, 16 px or more');
  return false;
}

export default {
  name: 'home',
  gallery: {
    states: [
      state('home sound card: play row and studio lights', READY, ['Studio lights', 'Key lights', 'Panels', 'Gaming']),
      state('home sound card: cover with source badge, long names', `${READY},long`, ['Studio lights', 'Key lights']),
      state('home sound card: no cover, the source icon', `${READY.replace('np=skip', 'np=skip,noart')}`, ['Studio lights', 'Key lights']),
      state('home sound card: Panels effects pop-up', READY, ['Panel effects', 'Key lights'], '.hs-panels .st-name'),
      state('home sound card: More open', READY, ['Upbeat', 'Romantic', 'Reading', 'Sonos favorites', 'Choose a favorite'], '.sound-chip.more'),
      state('home sound card: More with the favorites list open', READY, ['Upbeat', 'Quiet Radio', 'Sunny Beats'], '.sound-chip.more >> .sound-fav-btn'),
      state('home sound card: a mood tile hover text', READY, ['Play Upbeat Music (Fiji Villa) at Vol. 10'], '.sound-chip.more >> hover:.sound-mood'),
    ],
  },
  fit: {
    variants: [
      variant(V_CARD, READY, 'card'),
      variant(V_ART, READY.replace('np=skip', 'np=skip,noart'), 'card'),
      variant(V_LONG, `${READY},long`, 'card'),
      variant(V_PANELS, READY, 'panels', { click: '.hs-panels .st-name', checks: ['.home .np-ctl'] }),
      variant(V_MORE, READY, 'more', { click: '.sound-chip.more', checks: ['.home .np-ctl'] }),
    ],
    measurements: { home: measureHome },
    rules: { home: rule },
    breaks: {
      'home-ctl-equal': { css: '.np-ctl > :first-child { flex: 0 0 60px !important; }', expect: /^ *FAIL home sound card: the play buttons are/m, appliesTo: on(V_CARD) },
      'home-ctl-fill': { css: '.np-ctl { padding-right: 140px !important; }', expect: /^ *FAIL home sound card: the play buttons stop/m, appliesTo: on(V_CARD) },
      'home-badge': { css: '.np-badge { display: none !important; }', expect: /^ *FAIL home sound card: the source badge/m, appliesTo: on(V_CARD) },
      'home-pills': { css: '.hs-row.st-switches { grid-template-columns: minmax(0, 1fr) 90px 40px !important; }', expect: /^ *FAIL home sound card: Key lights is/m, appliesTo: on(V_CARD) },
      'home-icon': { css: '.hs-row .st-chip.st-icon { width: 64px !important; }', expect: /^ *FAIL home sound card: the sliders button is/m, appliesTo: on(V_CARD) },
      'home-pop-pad': { css: '.hs-pop-row { padding: 0 !important; }', expect: /^ *FAIL home sound card: ".*" is [\d.]+ px from its button side/m, appliesTo: on(V_PANELS) },
      'home-mood-pad': { css: '.sound-mood { padding: 0 !important; }', expect: /^ *FAIL home sound card: tile ".*" has text/m, appliesTo: on(V_MORE) },
      'home-text': { css: '.np-line .np-where, .hs-title { font-size: 13px !important; }', expect: /^ *FAIL home sound card: text under 16 px/m, appliesTo: on(V_CARD) },
    },
  },
};
