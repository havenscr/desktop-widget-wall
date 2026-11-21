// Work's "Due today" list and the tags on task rows (Work and Home's Around the house): gallery
// states for each list state, fit rules for the block's geometry and the tag sizes, and a
// deliberate break for each rule. Everything this area needs lives here.

const at = encodeURIComponent('2026-11-11T10:24:00-08:00');
const galleryWork = (knobs) => `hz=work&at=${at}&clock=review&weather=ok&${knobs}`;
const galleryHome = (knobs) => `hz=home&at=${at}&clock=review&weather=ok&${knobs}`;
const fitWork = (knobs, rows, late = 0) => `?hz=work&at=${at}&clock=review&weather=ok&taskcheck=work&taskrows=${rows}&taskoverdue=${late}&${knobs}`;
const fitHome = (knobs, rows) => `?hz=home&at=${at}&clock=review&weather=ok&taskcheck=home&taskrows=${rows}&${knobs}`;
const workState = (name, knobs, expect, actions) => ({ screen: 'work', name, query: galleryWork(knobs), custom: true, expect, actions });
const homeState = (name, knobs, expect) => ({ screen: 'home', name, query: galleryHome(knobs), custom: true, expect });

const TYPICAL = 'Work, Due today: typical (six due, one overdue)';
const NONE = 'Work, Next up: nothing due today';
const ONE = 'Work, Due today: one due';
const TWO = 'Work, Due today: two due, one overdue';
const THREE = 'Work, Due today: three due';
const TWELVE = 'Work, Due today: twelve due, two overdue';
const LONG = 'Work, Due today: twelve due with the longest titles';
const HOME_QUIET = 'Home, Around the house: tags, five rows in view';
const HOME_TODAY = 'Home, Around the house: Today only on';
const HOME_ALERTS = 'Home, Around the house: tags, three rows in view';
const HOME_TIMED = 'Home, Around the house: a timed chore beside estimate pills';
const EMPTY = 'Work, no task at all';
const OFF = 'Work, task app not set up';
const DOWN = 'Work, task app not answering';

/**
 * Runs in the page (self-contained). `taskcheck=work` measures Work's block: in EVERY state its box is
 * main's (596 wide at 1944, 24, 243.7 high: the height of three rows) and Always here starts at 267.7;
 * the rows in view with the first at the top, nothing over Always here, the 6 px bar and fades inside
 * the block, no title under 180 px and no title clipped without an ellipsis, the overdue marks, and
 * every tag. `taskcheck=home` measures the chore rows: one pill column as wide as the widest pill (at
 * least 62 px), the pill text inside its pill, and the tags clear of it. Both end with the tag rules,
 * which are the same on both screens.
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
  if (!rows.length && want) return [mode + ': no task rows were drawn'];
  if (rows.length !== want) fails.push(mode + ': ' + rows.length + ' rows drawn, expected ' + want);
  if (mode === 'home') {
    // The Today only chip sits in the heading row, inside the card, on the right of the heading, text 16 px or more.
    const chip = document.querySelector('.home .chores .chores-today');
    const card = document.querySelector('.home .chores');
    const head = document.querySelector('.home .chores .k');
    if (!chip || !card || !head) fails.push('home: the Today only chip or the heading is missing');
    else {
      const cb = box(chip);
      const kb = box(head);
      if (cb.left < kb.right + 8 || cb.right > box(card).right + 0.5 || cb.top < box(card).top - 8) fails.push('home: the Today only chip is not beside the heading inside the card');
      if (parseFloat(getComputedStyle(chip).fontSize) < 16) fails.push('home: the Today only chip text is under 16 px');
    }
  }
  const titleSel = mode === 'work' ? '.task-title' : '.chore-open';
  const where = mode === 'work' ? 'tasks' : 'home';

  if (mode === 'work') {
    // Every state, whatever it holds: the block is main's box (three rows tall: 596 by 243.7 at 1944, 24) and Always here starts
    // at 267.7, because the block keeps the height of three rows with one row, none, loading, not set up or unavailable.
    const blockEl = document.querySelector('.work .tasks');
    const deck = document.querySelector('.work .deck');
    if (!blockEl || !deck) return ['tasks: the block or Always here is missing'];
    const bb = box(blockEl);
    const db = box(deck);
    if (Math.abs(bb.height - 243.7) > 0.6 || Math.abs(bb.width - 596) > 0.6 || Math.abs(bb.left - 1944) > 0.6 || Math.abs(bb.top - 24) > 0.6) {
      fails.push('tasks: the block is x ' + r1(bb.left) + ', y ' + r1(bb.top) + ', ' + r1(bb.width) + ' by ' + r1(bb.height) + ' with ' + rows.length + ' rows (main: 1944, 24, 596 by 243.7)');
    }
    if (Math.abs(db.top - 267.7) > 0.6) fails.push('tasks: Always here starts at y ' + r1(db.top) + ' with ' + rows.length + ' rows (main: 267.7)');
    if (bb.bottom > db.top + 0.5) fails.push('tasks: the block ends at y ' + r1(bb.bottom) + ', over Always here which starts at y ' + r1(db.top));
    const list = document.querySelector('.work .tasks-list');
    if (!list) return fails;
    const lb = box(list);
    if (lb.bottom > db.top + 0.5) fails.push('tasks: the list ends at y ' + r1(lb.bottom) + ', over Always here which starts at y ' + r1(db.top));
    const seen = rows.filter((li) => { const b = box(li); return b.top >= lb.top - 1 && b.bottom <= lb.bottom + 1; }).length;
    const expectSeen = Math.min(rows.length, 3);
    if (seen !== expectSeen) fails.push('tasks: ' + seen + ' rows visible, expected ' + expectSeen);
    if (rows.length && Math.abs(box(rows[0]).top - lb.top) > 0.6) fails.push('tasks: the first row is not at the top of the list');
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
    if (cols.some((c) => Math.abs(box(c).width - 78) > 0.6) || (colLeft.length && Math.max(...colLeft) - Math.min(...colLeft) > 0.6)) fails.push('tasks: the time column is not a fixed 78 px column in line down the list');
    // The overdue mark: one in the slot of each overdue row, nothing in any other slot; inside its row, clear of the tags and the
    // time column, 18 px, in the wall's amber; the slot is in line down the list.
    const wantLate = Number(params.get('taskoverdue') || 0);
    const slots = rows.map((li) => li.querySelector('.od-slot'));
    if (slots.some((e) => !e)) fails.push('tasks: ' + slots.filter((e) => !e).length + ' rows have no overdue slot');
    // A mark that is not drawn (no box) is not a mark.
    const marks = rows.flatMap((li) => [...li.querySelectorAll('.od-mark')]).filter((m) => box(m).width > 0);
    if (marks.length !== wantLate) fails.push('tasks: ' + marks.length + ' overdue marks, expected ' + wantLate);
    if (slots.some((e) => e && e.children.length > 1)) fails.push('tasks: more than one thing in an overdue slot');
    const slotLeft = slots.filter(Boolean).map((e) => box(e).left);
    if (slotLeft.length && Math.max(...slotLeft) - Math.min(...slotLeft) > 0.6) fails.push('tasks: the overdue slot is not in line down the list');
    for (const mark of marks) {
      const li = mark.closest('.tk3');
      const mb = box(mark);
      const glyph = mark.querySelector('svg');
      const tags = li.querySelector('.t-tags');
      const col = li.querySelector('.chip-col');
      const title = (li.querySelector('.task-title')?.textContent || '').trim().slice(0, 40);
      if (!inside(mb, box(li), 0.5) || (tags && mb.left < box(tags).right - 0.5) || (col && mb.right > box(col).left + 0.5)) fails.push('tasks: the overdue mark of "' + title + '" is not inside its row, clear of the tags and the time column');
      if (!glyph || Math.abs(box(glyph).width - 18) > 0.6) fails.push('tasks: the overdue mark of "' + title + '" is ' + (glyph ? r1(box(glyph).width) : 0) + ' px (18)');
      if (getComputedStyle(mark).color !== 'rgb(255, 194, 77)') fails.push('tasks: the overdue mark of "' + title + '" is ' + getComputedStyle(mark).color + ', not the wall\'s amber');
    }
  } else {
    const rights = [];
    const lefts = [];
    const widths = [];
    for (const li of rows) {
      const last = li.lastElementChild;
      const rb = box(li);
      if (!last || !(last.classList.contains('est') || last.classList.contains('pill-ph'))) {
        if (!li.querySelector('.tick-wait')) fails.push('home: a row does not end in its pill column');
        continue;
      }
      const lb = box(last);
      lefts.push(lb.left);
      widths.push(lb.width);
      if (lb.width < 62 - 0.6) fails.push('home: the pill column is ' + r1(lb.width) + ' px wide (at least 62)');
      if (lb.right > rb.right + 0.5) fails.push('home: the pill column sticks out of its row');
      if (last.classList.contains('est')) {
        // The pill's text stays inside the pill: not wider than the box, and the text's own box inside it.
        const rg = document.createRange();
        rg.selectNodeContents(last);
        const tb = rg.getBoundingClientRect();
        if (last.scrollWidth > last.clientWidth + 0.5 || tb.left < lb.left - 0.5 || tb.right > lb.right + 0.5) fails.push('home: the pill text "' + (last.textContent || '') + '" is ' + r1(tb.width) + ' px in a pill ' + r1(lb.width) + ' px wide');
      }
      const tags = li.querySelector('.t-tags');
      if (tags) {
        const tb = box(tags);
        rights.push(tb.right);
        if (lb.left - tb.right < 6 - 0.5) fails.push('home: tags touch the pill (' + r1(lb.left - tb.right) + ' px apart, at least 6)');
      }
    }
    if (widths.length && Math.max(...widths) - Math.min(...widths) > 0.6) fails.push('home: the pill column is not the same width on every row (' + r1(Math.min(...widths)) + ' to ' + r1(Math.max(...widths)) + ' px)');
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
      const label = tag.getAttribute('aria-label') || '?';
      if (Math.abs(b.height - 26) > 0.6 || Math.abs(b.width - 26) > 0.6) fails.push(where + ': tag "' + label + '" is ' + r1(b.width) + ' by ' + r1(b.height) + ' px (a pill is 26 by 26)');
      if (!inside(b, rb, 0.5) || (tb && b.left < tb.right - 0.5)) fails.push(where + ': tag "' + label + '" sticks out of its row or lies over the title');
      if (tag.textContent.trim() !== '') fails.push(where + ': tag "' + label + '" carries words (a pill is its icon alone)');
      const glyph = tag.querySelector('svg');
      if (!glyph || Math.abs(box(glyph).width - 16) > 0.6) fails.push(where + ': tag "' + label + '" glyph is ' + (glyph ? r1(box(glyph).width) : 0) + ' px wide (16 px)');
    }
    const pills = [...li.querySelectorAll('.t-tag')].map(box);
    for (let i = 1; i < pills.length; i++) if (pills[i].left - pills[i - 1].right < 4 - 0.5) fails.push(where + ': two tags of "' + name + '" overlap or touch (' + r1(pills[i].left - pills[i - 1].right) + ' px apart, at least 4)');
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
    workState('due today: typical, six due with one overdue', 'due=typical', ['Due today', '4, 1 overdue · 2 later', 'Send the signed engagement letter', '!more can wait', '!Next up']),
    workState('due today: nothing due, Next up', 'due=none', ['Next up', 'Nothing due today', 'Review the dashboard draft', '!Due today']),
    workState('due today: one due', 'due=one', ['Due today1', 'Send the project proposal', '!overdue', '!more can wait']),
    workState('due today: two due, one overdue', 'due=two', ['Due today1, 1 overdue · 1 later', 'Send the signed engagement letter', '!more can wait']),
    workState('due today: the overdue mark says how late', 'due=typical', ['Due Monday, 2 days ago', 'Send the signed engagement letter'], 'hover:.tasks .od-mark'),
    workState('due today: no task at all', 'tasks=none', ['Due today', 'Nothing due today', '!Next up']),
    workState('due today: three due', 'due=three&later=1', ['Due today3', 'Send the project proposal', 'Confirm the venue for the spring workshop']),
    workState('due today: twelve due, two overdue', 'due=twelve&later=1', ['Due today12, 2 overdue', 'Send the signed engagement letter', '!more can wait']),
    workState('due today: twelve due with the longest titles', 'due=twelve&long=1&later=1', ['Due today12, 2 overdue', 'Send the project proposal with the revised budget and the new timeline']),
    workState('due today: row ticked, Done with Undo', 'due=three', ['Done.', 'Undo'], '.tasks .task-check'),
    homeState('home tags: five rows, round tag pills, icon only', 'desk=typical&alerts=0&chores=many', ['Order printer paper', 'Sort the recycling']),
    homeState('home chores: a timed chore beside estimate pills', 'desk=typical&alerts=0&chores=timed', ['Pick up the dry cleaning', '4:30 PM', '15 m']),
    homeState('home chores: Today only on, one chore due this afternoon', 'desk=typical&alerts=0&chores=timed&todayonly=on', ['Today only', 'Pick up the dry cleaning', '4:30 PM', '!Change the furnace filter']),
    homeState('home tags: three rows while alerts are open', 'desk=typical&alerts=6&chores=many', ['Order printer paper']),
  ] },
  fit: {
    variants: [
      { name: TYPICAL, q: fitWork('due=typical', 6, 1), checks: ['.work .tasks'] },
      { name: NONE, q: fitWork('due=none', 3), checks: ['.work .tasks'] },
      { name: ONE, q: fitWork('due=one', 1), checks: ['.work .tasks'] },
      { name: TWO, q: fitWork('due=two', 2, 1), checks: ['.work .tasks'] },
      { name: THREE, q: fitWork('due=three', 3), checks: ['.work .tasks'] },
      { name: EMPTY, q: fitWork('tasks=none', 0), checks: ['.work .tasks'] },
      { name: OFF, q: fitWork('tasks=off', 0), checks: ['.work .tasks'] },
      { name: DOWN, q: fitWork('tasks=down', 0), checks: ['.work .tasks'] },
      { name: TWELVE, q: fitWork('due=twelve', 12, 2), checks: ['.work .tasks'] },
      { name: LONG, q: fitWork('due=twelve&long=1', 12, 2), checks: ['.work .tasks'] },
      { name: HOME_QUIET, q: fitHome('desk=typical&alerts=0&chores=many', 13), checks: ['.home .chores'] },
      { name: HOME_TIMED, q: fitHome('desk=typical&alerts=0&chores=timed', 14), checks: ['.home .chores'] },
      { name: HOME_TODAY, q: fitHome('desk=typical&alerts=0&chores=timed&todayonly=on', 1), checks: ['.home .chores'] },
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
          ? '  ok   tasks: the block is main\'s box and Always here has not moved, three rows in view from the top, the 6 px bar and fades inside it, no title under 180 px or clipped without an ellipsis, overdue marks 18 px amber in their slot, tags 26 px round with a 16 px icon inside their rows and in line'
          : '  ok   home tasks: one pill column as wide as the widest pill and in line, the pill text inside it, tags clear of it, tags 26 px round with a 16 px icon inside their rows, no title under 180 px or clipped without an ellipsis');
        return false;
      },
    },
    breaks: {
      // Two rows in view; the heading pushed down; the block pulled over Always here; the wrong bar; no foot fade; the list wider than its block.
      // The overdue mark: missing; over the time column; in the wrong colour.
      'mark-missing': { css: '.work .od-mark { display: none !important; }', expect: /^ *FAIL tasks: 0 overdue marks, expected 1/m, appliesTo: (v) => v.name === TWO },
      'mark-over': { css: '.work .od-mark { position: relative !important; left: 60px !important; }', expect: /^ *FAIL tasks: the overdue mark of ".*" is not inside its row, clear of the tags and the time column/m, appliesTo: (v) => v.name === TYPICAL },
      'mark-colour': { css: '.work .od-mark { color: #ffffff !important; }', expect: /^ *FAIL tasks: the overdue mark of ".*" is rgb\(255, 255, 255\), not the wall's amber/m, appliesTo: (v) => v.name === TYPICAL },
      'tasks-rows': { css: '.work .tasks-list { max-height: 142px !important; }', expect: /^ *FAIL tasks: \d+ rows visible, expected 3/m, appliesTo: (v) => v.name === TWELVE },
      'tasks-collapse': { css: '.work .tasks-body { height: auto !important; }', expect: /^ *FAIL tasks: the block is x [\d.]+, y [\d.]+, [\d.]+ by [\d.]+ with 1 rows \(main: 1944, 24, 596 by 243.7\)/m, appliesTo: (v) => v.name === ONE },
      'tasks-deck-moved': { css: '.work .tasks-body { height: auto !important; }', expect: /^ *FAIL tasks: Always here starts at y [\d.]+ with 2 rows \(main: 267.7\)/m, appliesTo: (v) => v.name === TWO },
      'tasks-empty-collapse': { css: '.work .tasks-body { height: auto !important; }', expect: /^ *FAIL tasks: Always here starts at y [\d.]+ with 0 rows \(main: 267.7\)/m, appliesTo: (v) => v.name === EMPTY },
      'tasks-box': { css: '.work .tasks-hd { margin-bottom: 30px !important; }', expect: /^ *FAIL tasks: the block is x [\d.]+, y [\d.]+, [\d.]+ by [\d.]+ with \d+ rows \(main: 1944, 24, 596 by 243.7\)/m, appliesTo: (v) => v.name === TYPICAL },
      'tasks-overlap': { css: '.work .tasks { margin-bottom: -60px !important; }', expect: /^ *FAIL tasks: the block ends at y [\d.]+, over Always here which starts at y [\d.]+/m, appliesTo: (v) => v.name === THREE },
      'tasks-bar': { css: '.work .tasks-list::-webkit-scrollbar { width: 14px !important; }', expect: /^ *FAIL tasks: the scroll bar is 14 px wide, expected 6 with 12 rows/m, appliesTo: (v) => v.name === TWELVE },
      'tasks-fade': { css: '.work .tasks-list.fade-bottom { mask-image: none !important; }', expect: /^ *FAIL tasks: no fade at the foot while more rows wait below/m, appliesTo: (v) => v.name === TWELVE },
      'tasks-inside': { css: '.work .tasks-list { margin-right: -12px !important; }', expect: /^ *FAIL tasks: the list \(x [\d.]+ to [\d.]+, y [\d.]+ to [\d.]+\) sticks out of its block/m, appliesTo: (v) => v.name === TYPICAL },
      // A title squeezed under 180 px; a title cut with no ellipsis.
      'tasks-title': { css: '.work .tk3 .n { flex: 0 0 120px !important; }', expect: /^ *FAIL tasks: the title ".*" is [\d.]+ px wide \(at least 180\)/m, appliesTo: (v) => v.name === TYPICAL },
      'tasks-ellipsis': { css: '.work .tk3 .n { text-overflow: clip !important; }', expect: /^ *FAIL tasks: the title ".*" is clipped without an ellipsis/m, appliesTo: (v) => v.name === LONG },
      // Dots too small; a tag pushed out of its row; a chip with small text; one row's tags out of line; the time column not fixed.
      'tag-size': { css: '.work .t-dot { width: 20px !important; height: 20px !important; }', expect: /^ *FAIL tasks: tag ".*" is [\d.]+ by [\d.]+ px \(a pill is 26 by 26\)/m, appliesTo: (v) => v.name === TYPICAL },
      'tag-out': { css: '.work .t-tags { position: relative !important; left: 900px !important; }', expect: /^ *FAIL tasks: tag ".*" sticks out of its row or lies over the title/m, appliesTo: (v) => v.name === TYPICAL },
      'tag-font': { css: '.work .t-tag svg { width: 12px !important; height: 12px !important; }', expect: /^ *FAIL tasks: tag ".*" glyph is [\d.]+ px wide \(16 px\)/m, appliesTo: (v) => v.name === TYPICAL },
      'tag-overlap': { css: '.work .t-tag + .t-tag { margin-left: -10px !important; }', expect: /^ *FAIL tasks: two tags of ".*" overlap or touch/m, appliesTo: (v) => v.name === TYPICAL },
      'tag-line': { css: '.work .tk3:nth-child(2) .t-tags { margin-right: 25px !important; }', expect: /^ *FAIL tasks: the tags do not line up down the list/m, appliesTo: (v) => v.name === TYPICAL },
      'tag-column': { css: '.work .chip-col { width: 60px !important; }', expect: /^ *FAIL tasks: the time column is not a fixed 78 px column/m, appliesTo: (v) => v.name === TYPICAL },
      // Home: the pill column narrowed; tags pressed against the pill.
      'home-pill-text': { css: '.home .chore-rows .est { min-width: 0 !important; width: 40px !important; }', expect: /^ *FAIL home: the pill text ".*" is [\d.]+ px in a pill [\d.]+ px wide/m, appliesTo: (v) => v.name === HOME_TIMED },
      'home-pill-equal': { css: '.home .chore-rows .est { min-width: 0 !important; }', expect: /^ *FAIL home: the pill column is not the same width on every row \([\d.]+ to [\d.]+ px\)/m, appliesTo: (v) => v.name === HOME_TIMED },
      'home-pill-min': { css: '.home .chore-rows .est, .home .chore-rows .pill-ph { min-width: 0 !important; width: 50px !important; }', expect: /^ *FAIL home: the pill column is [\d.]+ px wide \(at least 62\)/m, appliesTo: (v) => v.name === HOME_QUIET },
      'home-chip-away': { css: '.home .chores-today { position: relative !important; left: -400px !important; }', expect: /^ *FAIL home: the Today only chip is not beside the heading inside the card/m, appliesTo: (v) => v.name === HOME_QUIET },
      'home-touch': { css: '.home .chore-rows .t-tags { margin-right: -14px !important; }', expect: /^ *FAIL home: tags touch the pill/m, appliesTo: (v) => v.name === HOME_QUIET },
    },
  },
};
