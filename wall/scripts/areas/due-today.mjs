// Work's "Due today" list and the tags on task rows (Work and Home's Around the house): gallery
// states for each list state, fit rules for the block's geometry and the tag sizes, and a
// deliberate break for each rule. Everything this area needs lives here.

const at = encodeURIComponent('2026-11-11T10:24:00-08:00');
const galleryWork = (knobs) => `hz=work&at=${at}&clock=review&weather=ok&${knobs}`;
const galleryHome = (knobs) => `hz=home&at=${at}&clock=review&weather=ok&${knobs}`;
const fitWork = (knobs, rows) => `?hz=work&at=${at}&clock=review&weather=ok&taskcheck=work&taskrows=${rows}&${knobs}`;
const fitHome = (knobs, rows) => `?hz=home&at=${at}&clock=review&weather=ok&taskcheck=home&taskrows=${rows}&${knobs}`;
const workState = (name, knobs, expect, actions) => ({ screen: 'work', name, query: galleryWork(knobs), custom: true, expect, actions });
const homeState = (name, knobs, expect) => ({ screen: 'home', name, query: galleryHome(knobs), custom: true, expect });

const TYPICAL = 'Work, Due today: typical (six due, one overdue)';
const NONE = 'Work, Next up: nothing due today';
const ONE = 'Work, Due today: one due';
const THREE = 'Work, Due today: three due';
const TWELVE = 'Work, Due today: twelve due, two overdue';
const LONG = 'Work, Due today: twelve due with the longest titles';
const HOME_QUIET = 'Home, Around the house: tags, five rows in view';
const HOME_ALERTS = 'Home, Around the house: tags, three rows in view';

/**
 * Runs in the page (self-contained). `taskcheck=work` measures Work's block: the rows in view, its
 * box against main's (the block is 596 wide at 1944, 24, and 243.7 high with three rows and a
 * heading that has its right-hand text; Always here starts at 267.7), nothing over Always here,
 * the 6 px bar and the fades inside the block, no title under 180 px and no title clipped without
 * an ellipsis, and every tag. `taskcheck=home` measures the chore rows: the 62 px pill column and
 * the tags clear of it. Both end with the tag rules, which are the same on both screens.
 */
function measureTasks() {
  const params = new URLSearchParams(location.search);
  const mode = params.get('taskcheck');
  const fails = [];
  if (mode !== 'work' && mode !== 'home') return fails;
  const r1 = (n) => Math.round(n * 10) / 10;
  const box = (e) => e.getBoundingClientRect();
  const inside = (b, o, slack) => b.left >= o.left - slack && b.right <= o.right + slack && b.top >= o.top - slack && b.bottom <= o.bottom + slack;
  const rows = [...document.querySelectorAll(mode === 'work' ? '.work .tasks-list > .tk3' : '.home .chore-rows > .tk3')];
  const want = Number(params.get('taskrows'));
  if (!rows.length) return [mode + ': no task rows were drawn'];
  if (want && rows.length !== want) fails.push(mode + ': ' + rows.length + ' rows drawn, expected ' + want);
  const titleSel = mode === 'work' ? '.task-title' : '.chore-open';
  const where = mode === 'work' ? 'tasks' : 'home';

  if (mode === 'work') {
    const list = document.querySelector('.work .tasks-list');
    const blockEl = document.querySelector('.work .tasks');
    const hd = document.querySelector('.work .tasks-hd');
    const deck = document.querySelector('.work .deck');
    if (!list || !blockEl || !hd || !deck) return ['tasks: the block, its heading or Always here is missing'];
    const lb = box(list);
    const bb = box(blockEl);
    const db = box(deck);
    const hb = box(hd);
    const seen = rows.filter((li) => { const b = box(li); return b.top >= lb.top - 1 && b.bottom <= lb.bottom + 1; }).length;
    const expectSeen = Math.min(rows.length, 3);
    if (seen !== expectSeen) fails.push('tasks: ' + seen + ' rows visible, expected ' + expectSeen);
    const expectH = hb.height + 6 + 71 * expectSeen;
    if (Math.abs(bb.height - expectH) > 0.6 || Math.abs(bb.width - 596) > 0.6 || Math.abs(bb.left - 1944) > 0.6 || Math.abs(bb.top - 24) > 0.6) {
      fails.push('tasks: the block is x ' + r1(bb.left) + ', y ' + r1(bb.top) + ', ' + r1(bb.width) + ' by ' + r1(bb.height) + ' (main: 1944, 24, 596 by ' + r1(expectH) + ')');
    }
    if (rows.length >= 3 && hb.height > 24 && Math.abs(db.top - 267.7) > 0.6) fails.push('tasks: Always here starts at y ' + r1(db.top) + ' (main: 267.7)');
    if (bb.bottom > db.top + 0.5 || lb.bottom > db.top + 0.5) fails.push('tasks: the block ends at y ' + r1(Math.max(bb.bottom, lb.bottom)) + ', over Always here which starts at y ' + r1(db.top));
    if (!inside(lb, bb, 0.5)) fails.push('tasks: the list (x ' + r1(lb.left) + ' to ' + r1(lb.right) + ', y ' + r1(lb.top) + ' to ' + r1(lb.bottom) + ') sticks out of its block');
    const bar = list.offsetWidth - list.clientWidth;
    const wantBar = rows.length > 3 ? 6 : 0;
    if (bar !== wantBar) fails.push('tasks: the scroll bar is ' + bar + ' px wide, expected ' + wantBar + ' with ' + rows.length + ' rows');
    const mask = getComputedStyle(list).maskImage || getComputedStyle(list).webkitMaskImage;
    if (rows.length > 3) {
      if (!list.classList.contains('fade-bottom') || mask === 'none') fails.push('tasks: no fade at the foot while more rows wait below');
      if (list.classList.contains('fade-top')) fails.push('tasks: a fade at the head before any scrolling');
    } else if (list.classList.contains('fade-bottom') || list.classList.contains('fade-top') || mask !== 'none') {
      fails.push('tasks: a fade with no more rows to scroll to');
    }
    const cols = rows.map((li) => li.querySelector('.chip-col')).filter(Boolean);
    if (cols.length !== rows.length) fails.push('tasks: ' + (rows.length - cols.length) + ' rows have no time column');
    const colLeft = cols.map((c) => box(c).left);
    if (cols.some((c) => Math.abs(box(c).width - 78) > 0.6) || Math.max(...colLeft) - Math.min(...colLeft) > 0.6) fails.push('tasks: the time column is not a fixed 78 px column in line down the list');
  } else {
    const rights = [];
    const lefts = [];
    for (const li of rows) {
      const last = li.lastElementChild;
      const rb = box(li);
      if (!last || !(last.classList.contains('est') || last.classList.contains('pill-ph'))) {
        if (!li.querySelector('.tick-wait')) fails.push('home: a row does not end in its pill column');
        continue;
      }
      const lb = box(last);
      lefts.push(lb.left);
      if (Math.abs(lb.width - 62) > 0.6) fails.push('home: the pill column is ' + r1(lb.width) + ' px wide (62)');
      if (lb.right > rb.right + 0.5) fails.push('home: the pill column sticks out of its row');
      const tags = li.querySelector('.t-tags');
      if (tags) {
        const tb = box(tags);
        rights.push(tb.right);
        if (lb.left - tb.right < 6 - 0.5) fails.push('home: tags touch the pill (' + r1(lb.left - tb.right) + ' px apart, at least 6)');
      }
    }
    if (lefts.length && Math.max(...lefts) - Math.min(...lefts) > 0.6) fails.push('home: the pill column does not line up down the list');
    if (rights.length > 1 && Math.max(...rights) - Math.min(...rights) > 0.6) fails.push('home: the tags do not line up down the list');
  }

  let tagged = 0;
  for (const li of rows) {
    const rb = box(li);
    const title = li.querySelector(titleSel);
    const tb = title ? box(title) : null;
    const name = (title?.textContent || '').trim().slice(0, 40);
    if (title && tb) {
      if (tb.width < 180 - 0.5) fails.push(where + ': the title "' + name + '" is ' + r1(tb.width) + ' px wide (at least 180)');
      if (title.scrollWidth > title.clientWidth + 0.5) {
        const cs = getComputedStyle(title);
        if (cs.textOverflow !== 'ellipsis' || cs.overflowX !== 'hidden') fails.push(where + ': the title "' + name + '" is clipped without an ellipsis');
      }
    }
    for (const tag of li.querySelectorAll('.t-tag')) {
      tagged++;
      const b = box(tag);
      const label = tag.querySelector('.t-label')?.textContent || tag.getAttribute('aria-label') || '?';
      const chip = tag.classList.contains('t-chip');
      if (Math.abs(b.height - 28) > 0.6 || (!chip && Math.abs(b.width - 28) > 0.6)) fails.push(where + ': tag "' + label + '" is ' + r1(b.width) + ' by ' + r1(b.height) + ' px (' + (chip ? 'a chip is 28 high' : 'a dot is 28 by 28') + ')');
      if (!inside(b, rb, 0.5) || (tb && b.left < tb.right - 0.5)) fails.push(where + ': tag "' + label + '" sticks out of its row or lies over the title');
      const text = chip ? tag.querySelector('.t-label') : null;
      const size = text ? parseFloat(getComputedStyle(text).fontSize) : 16;
      const glyph = tag.querySelector('svg');
      if (size < 16 - 0.01 || (glyph && Math.abs(box(glyph).width - 16) > 0.6)) fails.push(where + ': tag "' + label + '" text is ' + r1(size) + ' px with a ' + (glyph ? r1(box(glyph).width) : 0) + ' px glyph (16 or more)');
    }
  }
  if (mode === 'work') {
    const tagRights = rows.map((li) => li.querySelector('.t-tags')).filter(Boolean).map((t) => box(t).right);
    if (tagRights.length > 1 && Math.max(...tagRights) - Math.min(...tagRights) > 0.6) fails.push('tasks: the tags do not line up down the list');
  }
  if (!tagged) fails.push(where + ': no tags were drawn');
  return fails;
}

export default {
  name: 'due-today',
  gallery: { states: [
    workState('due today: typical, six due with one overdue', 'due=typical', ['Due today', '6, 1 overdue', 'Send the signed engagement letter', 'Finance', '!more can wait', '!Next up']),
    workState('due today: nothing due, Next up', 'due=none', ['Next up', 'Nothing due today', 'Review the dashboard draft', '!Due today']),
    workState('due today: one due', 'due=one', ['Due today1', 'Send the project proposal', '!overdue', '!more can wait']),
    workState('due today: three due', 'due=three', ['Due today3', 'Send the project proposal', 'Confirm the venue for the spring workshop']),
    workState('due today: twelve due, two overdue', 'due=twelve', ['Due today12, 2 overdue', 'Send the signed engagement letter', '!more can wait']),
    workState('due today: twelve due with the longest titles', 'due=twelve&long=1', ['Due today12, 2 overdue', 'Send the project proposal with the revised budget and the new timeline']),
    workState('due today: row ticked, Done with Undo', 'due=three', ['Done.', 'Undo'], '.tasks .task-check'),
    homeState('home tags: five rows, first tag named, the rest as dots', 'desk=typical&alerts=0&chores=many', ['Order printer paper', 'Errands', 'Repairs', 'Garden']),
    homeState('home tags: three rows while alerts are open', 'desk=typical&alerts=6&chores=many', ['Order printer paper', 'Errands']),
  ] },
  fit: {
    variants: [
      { name: TYPICAL, q: fitWork('due=typical', 6), checks: ['.work .tasks'] },
      { name: NONE, q: fitWork('due=none', 3), checks: ['.work .tasks'] },
      { name: ONE, q: fitWork('due=one', 1), checks: ['.work .tasks'] },
      { name: THREE, q: fitWork('due=three', 3), checks: ['.work .tasks'] },
      { name: TWELVE, q: fitWork('due=twelve', 12), checks: ['.work .tasks'] },
      { name: LONG, q: fitWork('due=twelve&long=1', 12), checks: ['.work .tasks'] },
      { name: HOME_QUIET, q: fitHome('desk=typical&alerts=0&chores=many', 13), checks: ['.home .chores'] },
      { name: HOME_ALERTS, q: fitHome('desk=typical&alerts=6&chores=many', 13), checks: ['.home .chores'] },
    ],
    measurements: { tasks: measureTasks },
    rules: {
      tasks: (variant, results, emit) => {
        const mode = /[?&]taskcheck=(work|home)\b/.exec(variant.q)?.[1];
        if (!mode) return false;
        for (const failure of results.tasks) emit(`  FAIL ${failure}`);
        if (results.tasks.length) return true;
        emit(mode === 'work'
          ? '  ok   tasks: three rows in view and the block as tall as on main, clear of Always here, the 6 px bar and fades inside it, no title under 180 px or clipped without an ellipsis, tags 28 px and 16 px text inside their rows and in line'
          : '  ok   home tasks: the pill column 62 px and in line, tags clear of it, tags 28 px and 16 px text inside their rows, no title under 180 px or clipped without an ellipsis');
        return false;
      },
    },
    breaks: {
      // Two rows in view; the heading pushed down; the block pulled over Always here; the wrong bar; no foot fade; the list wider than its block.
      'tasks-rows': { css: '.work .tasks-list { max-height: 142px !important; }', expect: /^ *FAIL tasks: \d+ rows visible, expected 3/m, appliesTo: (v) => v.name === TWELVE },
      'tasks-box': { css: '.work .tasks-hd { margin-bottom: 30px !important; }', expect: /^ *FAIL tasks: the block is x [\d.]+, y [\d.]+, [\d.]+ by [\d.]+ \(main: 1944, 24, 596 by [\d.]+\)/m, appliesTo: (v) => v.name === TYPICAL },
      'tasks-overlap': { css: '.work .tasks { margin-bottom: -60px !important; }', expect: /^ *FAIL tasks: the block ends at y [\d.]+, over Always here which starts at y [\d.]+/m, appliesTo: (v) => v.name === THREE },
      'tasks-bar': { css: '.work .tasks-list::-webkit-scrollbar { width: 14px !important; }', expect: /^ *FAIL tasks: the scroll bar is 14 px wide, expected 6 with 12 rows/m, appliesTo: (v) => v.name === TWELVE },
      'tasks-fade': { css: '.work .tasks-list.fade-bottom { mask-image: none !important; }', expect: /^ *FAIL tasks: no fade at the foot while more rows wait below/m, appliesTo: (v) => v.name === TWELVE },
      'tasks-inside': { css: '.work .tasks-list { margin-right: -12px !important; }', expect: /^ *FAIL tasks: the list \(x [\d.]+ to [\d.]+, y [\d.]+ to [\d.]+\) sticks out of its block/m, appliesTo: (v) => v.name === TYPICAL },
      // A title squeezed under 180 px; a title cut with no ellipsis.
      'tasks-title': { css: '.work .tk3 .n { flex: 0 0 120px !important; }', expect: /^ *FAIL tasks: the title ".*" is [\d.]+ px wide \(at least 180\)/m, appliesTo: (v) => v.name === TYPICAL },
      'tasks-ellipsis': { css: '.work .tk3 .n { text-overflow: clip !important; }', expect: /^ *FAIL tasks: the title ".*" is clipped without an ellipsis/m, appliesTo: (v) => v.name === LONG },
      // Dots too small; a tag pushed out of its row; a chip with small text; one row's tags out of line; the time column not fixed.
      'tag-size': { css: '.work .t-dot { width: 20px !important; height: 20px !important; }', expect: /^ *FAIL tasks: tag ".*" is [\d.]+ by [\d.]+ px \(a dot is 28 by 28\)/m, appliesTo: (v) => v.name === TYPICAL },
      'tag-out': { css: '.work .t-tags { position: relative !important; left: 900px !important; }', expect: /^ *FAIL tasks: tag ".*" sticks out of its row or lies over the title/m, appliesTo: (v) => v.name === TYPICAL },
      'tag-font': { css: '.work .t-chip { font-size: 12px !important; }', expect: /^ *FAIL tasks: tag ".*" text is [\d.]+ px with a [\d.]+ px glyph \(16 or more\)/m, appliesTo: (v) => v.name === TYPICAL },
      'tag-line': { css: '.work .tk3:nth-child(2) .t-tags { margin-right: 25px !important; }', expect: /^ *FAIL tasks: the tags do not line up down the list/m, appliesTo: (v) => v.name === TYPICAL },
      'tag-column': { css: '.work .chip-col { width: 60px !important; }', expect: /^ *FAIL tasks: the time column is not a fixed 78 px column/m, appliesTo: (v) => v.name === TYPICAL },
      // Home: the pill column narrowed; tags pressed against the pill.
      'home-pill': { css: '.home .chore-rows .est { width: 40px !important; }', expect: /^ *FAIL home: the pill column is [\d.]+ px wide \(62\)/m, appliesTo: (v) => v.name === HOME_QUIET },
      'home-touch': { css: '.home .chore-rows .t-tags { margin-right: -14px !important; }', expect: /^ *FAIL home: tags touch the pill/m, appliesTo: (v) => v.name === HOME_QUIET },
    },
  },
};
