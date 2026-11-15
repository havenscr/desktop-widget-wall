// The Agents today rows in the Day drawer use the room they have: each row is the list's free height
// divided by the row count, never under 32 px and never over 56 px; more rows than fit scroll inside the
// list while the header line stays put; the last column keeps 20 px from the right edge.
const TYPICAL = encodeURIComponent('2026-11-11T10:24:00-08:00');
const query = (agents) => `hz=work&at=${TYPICAL}&clock=review&weather=ok&meet=overlap&agents=${agents}`;
const NAMES = { 12: 'Day drawer rows, 12 agents', 2: 'Day drawer rows, 2 agents', 6: 'Day drawer rows, 6 agents', 30: 'Day drawer rows, 30 agents' };

// Runs in the page.
function measureRows() {
  const list = document.querySelector('.day-drawer .dd-rows');
  const head = document.querySelector('.day-drawer .dd-ag-head');
  if (!list || !head) return null;
  const rows = [...list.querySelectorAll('.dd-row')];
  const lr = list.getBoundingClientRect();
  const last = rows[0]?.querySelector('.dd-time')?.getBoundingClientRect();
  const first = rows[0]?.getBoundingClientRect();
  return {
    n: rows.length,
    h: first ? first.height : 0,
    free: list.clientHeight,
    scrolls: list.scrollHeight > list.clientHeight + 1,
    headInList: list.contains(head),
    scrollbar: getComputedStyle(list).scrollbarWidth,
    gap: last && first ? Math.round(lr.right - last.right) : -1,
  };
}

export default {
  name: 'day-drawer-rows',
  gallery: {
    states: [6, 30].map((n) => ({
      screen: 'work',
      name: `Day drawer: ${n} agent rows`,
      query: query(n),
      custom: true,
      actions: '.rib-handle',
      expect: 'Agents today',
    })),
  },
  fit: {
    variants: [2, 6, 12, 30].map((n) => ({
      name: NAMES[n],
      q: '?' + query(n) + '&long=1',
      click: '.rib-handle',
      // The 30 row list scrolls on purpose; the rule below holds it.
      checks: n === 30 ? ['.day-drawer'] : ['.day-drawer', '.day-drawer .dd-rows'],
      strip: true,
      viewportOnly: true,
    })),
    measurements: { drawerRows: measureRows },
    rules: {
      drawerRows: (variant, results, emit) => {
        if (!Object.values(NAMES).includes(variant.name)) return false;
        const m = results.drawerRows;
        if (!m) { emit('  FAIL day drawer rows: the list or its header is missing'); return true; }
        const want = Math.min(56, Math.max(32, m.free / m.n));
        let bad = false;
        if (Math.abs(m.h - want) > 1) { emit(`  FAIL day drawer rows: a row is ${m.h.toFixed(1)} px, wanted ${want.toFixed(1)} (list ${m.free} px, ${m.n} rows)`); bad = true; }
        if (m.headInList) { emit('  FAIL day drawer rows: the header line is inside the scrolling list'); bad = true; }
        if (m.n * 32 > m.free && !m.scrolls) { emit('  FAIL day drawer rows: the rows do not fit and the list does not scroll'); bad = true; }
        if (m.gap < 20) { emit(`  FAIL day drawer rows: the last column is ${m.gap} px from the right edge of the list (at least 20)`); bad = true; }
        if (!bad) emit(`  ok   day drawer rows: ${m.n} rows at ${m.h.toFixed(1)} px in ${m.free} px, ${m.scrolls ? 'scrolling' : 'fitting'}`);
        return bad;
      },
    },
    breaks: {
      'drawer-rows-fixed': {
        css: '.day-drawer .dd-row { height: 32px !important; }',
        expect: /^ *FAIL day drawer rows: a row is 32\.0 px, wanted/m,
        appliesTo: (v) => v.name === NAMES[2],
      },
      'drawer-rows-no-gap': {
        css: '.day-drawer .dd-rows { padding-right: 0 !important; }',
        expect: /^ *FAIL day drawer rows: the last column is \d+ px from the right edge/m,
        appliesTo: (v) => v.name === NAMES[6],
      },
    },
  },
};
