// The Work focus row's controls sheet (running and paused), the length sheet, and the undo row after Stop.
// Each must sit fully on the 2560 x 720 wall, set every text at 16 px or more, wrap or cut nothing, and keep the words
// in a button at least 10 px from its sides.
const at = '2026-11-11T10:24:00-08:00';
const Q = `?hz=work&at=${encodeURIComponent(at)}&clock=review&weather=ok&agents=3&focus=run&focuscheck=1`;
const Q_IDLE = `?hz=work&at=${encodeURIComponent(at)}&clock=review&weather=ok&agents=3&focuscheck=1`;
const RING = '.focus-mini-ring';
const NAMES = ['Focus, controls sheet, running', 'Focus, controls sheet, paused', 'Focus, undo row after Stop', 'Focus, length sheet'];

// Runs in the page (it references nothing outside its own body). Wall pixels: the stage is scaled to the window.
function measureFocusControls() {
  if (!new URLSearchParams(location.search).get('focuscheck')) return null;
  const stage = document.querySelector('.stage');
  const sr = stage ? stage.getBoundingClientRect() : { left: 0, top: 0, width: 2560 };
  const k = sr.width / 2560;
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { x: (r.left - sr.left) / k, y: (r.top - sr.top) / k, r: (r.right - sr.left) / k, b: (r.bottom - sr.top) / k };
  };
  const row = document.querySelector('.focus-mini');
  if (!row) return { found: false };
  const sheet = row.querySelector('.focus-sheet');
  const root = sheet || row;
  const small = [];
  const wrapped = [];
  const tight = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    const px = parseFloat(getComputedStyle(el).fontSize) * 1;
    if (px < 16) small.push(`${n.textContent.trim()} (${px}px)`);
    range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter((q) => q.width > 0);
    const tops = new Set(rects.map((q) => Math.round(q.top / 4)));
    if (tops.size > 1) wrapped.push(n.textContent.trim());
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') wrapped.push(`${n.textContent.trim()} (cut)`);
  }
  for (const b of root.querySelectorAll('button.btn')) {
    const bb = b.getBoundingClientRect();
    const kids = [...b.children, ...[...b.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim())];
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of kids) {
      let q;
      if (c.nodeType === 3) { range.selectNodeContents(c); q = range.getBoundingClientRect(); } else q = c.getBoundingClientRect();
      lo = Math.min(lo, q.left);
      hi = Math.max(hi, q.right);
    }
    if (kids.length && (lo - bb.left < 9.5 * k || bb.right - hi < 9.5 * k)) tight.push(`${b.textContent.trim()} (${Math.round((lo - bb.left) / k)} / ${Math.round((bb.right - hi) / k)})`);
  }
  return { found: true, sheet: sheet ? box(sheet) : null, row: box(row), small, wrapped, tight, undo: !!row.querySelector('.focus-undo'), dialog: !!sheet && sheet.getAttribute('role') === 'dialog', vw: innerWidth, vh: innerHeight };
}

export default {
  name: 'focus-controls',
  gallery: {
    states: [
      { screen: 'work', name: 'focus controls: row running', query: 'hz=work&at=2026-11-11T10%3A24%3A00-08%3A00&clock=review&weather=ok&agents=3&focus=run', custom: true, expect: 'Review the draft' },
      { screen: 'work', name: 'focus controls: sheet open running', query: 'hz=work&at=2026-11-11T10%3A24%3A00-08%3A00&clock=review&weather=ok&agents=3&focus=run', custom: true, expect: 'Restart 25 min', actions: RING },
      { screen: 'work', name: 'focus controls: sheet open paused', query: 'hz=work&at=2026-11-11T10%3A24%3A00-08%3A00&clock=review&weather=ok&agents=3&focus=run', custom: true, expect: 'Focus, paused', actions: `.focus-mini .rd >> ${RING}` },
      { screen: 'work', name: 'focus controls: undo row after Stop', query: 'hz=work&at=2026-11-11T10%3A24%3A00-08%3A00&clock=review&weather=ok&agents=3&focus=run', custom: true, expect: 'Focus stopped', actions: `${RING} >> .focus-acts .btn.stop` },
    ],
  },
  fit: {
    variants: [
      { name: NAMES[0], q: Q, click: RING, checks: ['.focus-mini-text'] },
      { name: NAMES[1], q: Q, click: `.focus-mini .rd >> ${RING}`, checks: ['.focus-mini-text'] },
      { name: NAMES[2], q: Q, click: `${RING} >> .focus-acts .btn.stop`, checks: ['.focus-mini-text'] },
      { name: NAMES[3], q: Q_IDLE, click: RING, checks: ['.focus-mini-text'] },
    ],
    measurements: { focusControls: measureFocusControls },
    rules: {
      focusControls: (variant, results, emit) => {
        if (!NAMES.includes(variant.name)) return false;
        const m = results.focusControls;
        let bad = false;
        const fail = (t) => { emit('  FAIL focus controls: ' + t); bad = true; };
        if (!m || !m.found) { fail('the focus row is not on the page'); return true; }
        const needSheet = variant.name !== NAMES[2];
        if (needSheet && !m.sheet) fail('the sheet is not open');
        if (!needSheet && !m.undo) fail('the undo row is not showing');
        if (needSheet && m.sheet && !m.dialog) fail('the open sheet is not a dialog');
        const b = m.sheet || m.row;
        if (b.x < 0 || b.y < 0 || b.r > 2560 || b.b > 720) fail(`the box runs off the wall (x ${Math.round(b.x)} to ${Math.round(b.r)}, y ${Math.round(b.y)} to ${Math.round(b.b)})`);
        if (m.vw !== 2560 || m.vh !== 720) fail(`the viewport reads ${m.vw} x ${m.vh}, not 2560 x 720`);
        if (m.small.length) fail('text under 16 px: ' + m.small.join(', '));
        if (m.wrapped.length) fail('text wrapped or cut: ' + m.wrapped.join(', '));
        if (m.tight.length) fail('words closer than 10 px to a button side: ' + m.tight.join(', '));
        if (!bad) emit(`  ok   focus controls: ${variant.name} on screen (x ${Math.round(b.x)} to ${Math.round(b.r)}, y ${Math.round(b.y)} to ${Math.round(b.b)}), text 16 px or more, nothing wrapped, 10 px inside every button`);
        return bad;
      },
    },
    breaks: {
      'focus-sheet-wide': { css: '.focus-sheet.live { width: 3000px !important; }', expect: /^ *FAIL focus controls: the box runs off the wall/m, appliesTo: (v) => v.name === NAMES[0] },
    },
  },
};
