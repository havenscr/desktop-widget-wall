// The Vibe controls, in their two homes: the Unwind sheet's Vibe page and the Tools drawer's Vibe group (one component,
// one store). On both: no scroll bar anywhere in the box that holds them, no label or hint cut or wrapped, every text at
// least 16 px, every chip at least 10 px from its text, nothing past the box's right edge. The sheet is checked at the
// 720 px wall height (the viewport reads 2560 by 720).
const at = encodeURIComponent('2026-11-11T22:30:00-08:00');
const UNWIND = `?hz=unwind&at=${at}&long=1&agents=3&watch=mock&wlist=none&wtab=listen&wsheet=vibe&audio=demo&clock=review&weather=ok`;
const TOOLS_Q = `?hz=work&at=${at}&clock=review&weather=ok&agents=3&tools=vibe`;
// The sheet's body scrolls by design now (a tall Drop Glitch card), so the controls themselves are not held inside the box.
const SHEET = ['.w-sheet'];
const DRAWER = ['.tools-drawer', '.tools-drawer .tools-rail', '.tools-drawer .tools-panel:not([hidden])', '.tools-drawer .ln-vibe'];
const NAMES = ['Vibe, the Unwind page', 'Vibe, the Tools group', 'Vibe, the Unwind page, Drop Glitch Off', 'Vibe, the Tools group, Drop Glitch Off', 'Vibe, the Tools group, Tune when it fires open'];

// Runs in the page. References nothing outside its body.
function measureVibe() {
  const root = [...document.querySelectorAll('.ln-vibe')].find((r) => r.getClientRects().length > 0);
  if (!root) return { found: false, fails: [] };
  const fails = [];
  const tuneOpen = !!root.querySelector('.dg-tune:not([hidden])');
  const r1 = (n) => Math.round(n * 10) / 10;
  const box = root.closest('.w-sheet') || root.closest('.tools-drawer');
  const inSheet = !!root.closest('.w-sheet');
  // No scroll bar: every ancestor up to the box, and the box itself, fits its content.
  for (let el = root; el && el !== box.parentElement; el = el.parentElement) {
    // The Tools drawer's body may scroll once Tune is open (it fades at the bottom); the drawer itself still ends by y 697.
    if (!(inSheet && el.classList.contains('ln-body')) && !(!inSheet && tuneOpen && el.classList.contains('tools-body')) && el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY !== 'visible') fails.push('vibe: a scroll bar would show on ' + (el.className || el.tagName) + ' (' + el.scrollHeight + ' px of content in ' + el.clientHeight + ' px)');
  }
  // The sheet's body scrolls by design (the Drop Glitch card is tall, with a fade at the bottom); the Tools drawer never does.
  const body = root.closest('.ln-body');
  if (!inSheet && body && body.scrollHeight > body.clientHeight + 1) fails.push('vibe: the page body scrolls (' + body.scrollHeight + ' of ' + body.clientHeight + ' px)');
  const br = box.getBoundingClientRect();
  if (br.bottom > (inSheet ? 650 : 697) + 0.5) fails.push('vibe: the box ends at y ' + r1(br.bottom) + ', past y ' + (inSheet ? 650 : 697));
  const rr = root.getBoundingClientRect();
  if (root.scrollWidth > root.clientWidth + 1) fails.push('vibe: the controls are ' + root.scrollWidth + ' px wide in a ' + root.clientWidth + ' px box (' + [...root.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > rr.right + 1).map((e) => (e.className || e.tagName) + ':' + (e.textContent || '').slice(0, 12) + ':' + Math.round(e.getBoundingClientRect().right - rr.right)).slice(0, 6).join(' | ') + ')');
  // Text: at least 16 px, never cut, never wrapped.
  for (const el of [root, ...root.querySelectorAll('*')]) {
    if (el.getClientRects().length === 0) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '');
    if (!own) continue;
    const cs = getComputedStyle(el);
    const px = parseFloat(cs.fontSize);
    const name = (el.textContent || '').trim().slice(0, 30);
    if (px < 15.99) fails.push('vibe: "' + name + '" is ' + px + ' px, under 16');
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) fails.push('vibe: "' + name + '" is cut (' + el.scrollWidth + ' px of text in ' + el.clientWidth + ' px)');
    const line = parseFloat(cs.lineHeight) || px * 1.3;
    if (el.closest('button')) continue;
    if (el.getBoundingClientRect().height > line * 1.6 + 1) fails.push('vibe: "' + name + '" wraps to a second line');
    const r = el.getBoundingClientRect();
    if (r.right > rr.right + 0.5 || r.left < rr.left - 0.5) fails.push('vibe: "' + name + '" leaves the box sideways');
  }
  // Chips: at least 10 px from their text, and 8 px apart.
  const chips = [...root.querySelectorAll('.ln-chips button, .ln-reset, .ln-try')];
  for (const c of chips) {
    const cs = getComputedStyle(c);
    if (parseFloat(cs.paddingLeft) < 9.99 || parseFloat(cs.paddingRight) < 9.99) fails.push('vibe: "' + (c.textContent || '').trim() + '" has under 10 px between its text and its side');
    const h = c.getBoundingClientRect().height;
    if (h < 32) fails.push('vibe: "' + (c.textContent || '').trim() + '" is ' + r1(h) + ' px tall, under 32');
  }
  for (const g of root.querySelectorAll('.ln-chips, .dg-tiles')) {
    const k = [...g.children].map((c) => c.getBoundingClientRect());
    for (let i = 1; i < k.length; i++) if (k[i].left - k[i - 1].right < 7.5) fails.push('vibe: two chips are ' + r1(k[i].left - k[i - 1].right) + ' px apart');
  }
  for (const row of root.querySelectorAll('.ln-row, .ln-hint')) if (row.scrollWidth > row.clientWidth + 1) fails.push('vibe: the row "' + (row.textContent || '').trim().slice(0, 24) + '" needs ' + row.scrollWidth + ' px of ' + row.clientWidth);
  const rows = [...root.querySelectorAll('.ln-row')].map((r) => r.getBoundingClientRect());
  for (let i = 1; i < rows.length; i++) if (rows[i].top < rows[i - 1].bottom - 0.5) fails.push('vibe: two rows overlap');
  const sec = [...root.querySelectorAll('.ln-gh')].map((e) => e.textContent.trim());
  const shown = (sel) => [...root.querySelectorAll(sel)].filter((e) => e.getClientRects().length > 0).length;
  const groups = shown('[role="radiogroup"]');
  const switches = shown('[role="switch"]');
  const sliders = shown('input[type="range"]');
  const tuneShown = tuneOpen;
  // Every control and text keeps at least a 16 px gutter from the box's edges on both sides.
  const edge = root.closest('.w-sheet') || box;
  const er = edge.getBoundingClientRect();
  for (const el of root.querySelectorAll('button, input, .dg-row > *, .dg-head > *, .ln-row > *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.left - er.left < 15.5 || er.right - r.right < 15.5) fails.push('vibe: "' + ((el.textContent || el.className || '').trim().slice(0, 20)) + '" is ' + r1(Math.min(r.left - er.left, er.right - r.right)) + ' px from the box edge, under 16');
  }
  const labelLefts = [...root.querySelectorAll('.ln-row > .ln-label:not(.ln-wide)')].map((e) => r1(e.getBoundingClientRect().left));
  const chipHeights = chips.map((c) => r1(c.getBoundingClientRect().height));
  return { found: true, fails, sliders, labelLefts, chipHeights, height: r1(br.height), bottom: r1(br.bottom), rootHeight: r1(rr.height), groups, switches, sec, inSheet, tuneShown };
}

function ruleVibe(variant, results, emit) {
  if (!NAMES.includes(variant.name)) return false;
  const m = results.vibe;
  if (!m || !m.found) { emit('  FAIL vibe: the controls are not shown'); return true; }
  const fails = [...m.fails];
  if (m.sec.join('|') !== 'Music reacts|Screen look') fails.push('vibe: the headings read "' + m.sec.join('", "') + '"');
  if (m.groups !== (m.tuneShown ? 6 : 4) || m.switches !== (m.tuneShown ? 4 : 3) || m.sliders !== (m.tuneShown ? 1 : 0)) fails.push('vibe: ' + m.groups + ' choice groups, ' + m.switches + ' switches and ' + m.sliders + ' sliders, expected ' + (m.tuneShown ? '6, 4 and 1' : '4, 3 and 0'));
  if (m.labelLefts.some((x) => Math.abs(x - m.labelLefts[0]) > 0.5)) fails.push('vibe: the row labels do not share one left edge (' + m.labelLefts.join(', ') + ')');
  if (m.chipHeights.some((x) => Math.abs(x - m.chipHeights[0]) > 0.5)) fails.push('vibe: the chips are not one height (' + [...new Set(m.chipHeights)].join(', ') + ')');
  for (const f of fails) emit('  FAIL ' + f);
  if (!fails.length) emit('  ok   vibe: no scroll bar, no cut or wrapped text, 16 px or more, chips 10 px clear, the box ends at y ' + m.bottom + ' (' + m.height + ' px tall, controls ' + m.rootHeight + ' px)');
  return fails.length > 0;
}

const state = (name, query, expect, screen = 'unwind') => ({ screen, name: `vibe: ${name}`, query, custom: true, expect });

export default {
  name: 'vibe-tools',
  gallery: {
    states: [
      state('Unwind Vibe page', UNWIND.slice(1), ['Music reacts', 'Screen look', 'Mountain dance', 'Reset vibe']),
      state('Tools, Vibe group', TOOLS_Q.slice(1), ['Music reacts', 'Screen look', 'Dance Medium', 'Mountain dance'], 'work'),
      // A drop is fired in the page just before the still (dev only), so each look shows near its peak.
      ...['tear', 'split', 'roll', 'flash'].flatMap((look) => [1900, 2100].map((ms) => ({
        screen: 'unwind',
        name: `vibe: Drop Glitch ${look} just after a drop (${ms})`,
        query: `hz=unwind&at=${at}&clock=review&weather=ok&watch=mock&wlist=none&wtab=listen&audio=demo&vglitch=${look}&vdrop=${ms}`,
        custom: true,
        expectNote: 'the look is canvas pixels; read the still',
      }))),
    ],
  },
  fit: {
    variants: [
      { name: NAMES[0], q: UNWIND, checks: SHEET, viewportOnly: true },
      { name: NAMES[1], q: TOOLS_Q, checks: DRAWER, viewportOnly: true },
      { name: NAMES[2], q: UNWIND + '&vglitch=off', checks: SHEET, viewportOnly: true },
      { name: NAMES[3], q: TOOLS_Q + '&audio=demo&vglitch=off', checks: DRAWER, viewportOnly: true },
      { name: NAMES[4], q: TOOLS_Q, checks: ['.tools-drawer'], click: '.tools-drawer .dg-fold', viewportOnly: true },
    ],
    measurements: { vibe: measureVibe },
    rules: { vibe: ruleVibe },
    breaks: {
      // Rows pushed taller: the page would need a scroll bar or run past the box.
      'vibe-tall': {
        css: '.ln-vibe .ln-row { min-height: 90px !important; }',
        expect: /^ *FAIL vibe: (a scroll bar would show|the page body scrolls|the box ends)/m,
        appliesTo: (variant) => variant.name === NAMES[0],
      },
      // A hint set small.
      'vibe-small-text': {
        css: '.ln-short, .ln-vhint { font-size: 12px !important; }',
        expect: /^ *FAIL vibe: ".*" is 12 px, under 16/m,
        appliesTo: (variant) => variant.name === NAMES[1],
      },
      // Chips with no room at their sides.
      'vibe-tight-chips': {
        css: '.ln-vibe .ln-chips button { padding: 0 4px !important; }',
        expect: /^ *FAIL vibe: ".*" has under 10 px between its text and its side/m,
        appliesTo: (variant) => variant.name === NAMES[1],
      },
    },
  },
};
