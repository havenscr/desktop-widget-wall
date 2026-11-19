// The Agents today popover keeps its box and its header controls where they are whatever day is
// shown: yesterday has 16 sessions, the day before has 4 (`days=pair`). The popover is the same box
// on both days, the back arrow, Today, Yesterday, forward arrow and date text sit at the same x and y,
// and no right-column text (end word, duration) sits under the rows' scrollbar.
const query = '?hz=work&at=' + encodeURIComponent('2026-11-11T10:24:00-08:00') + '&clock=review&weather=ok&agents=12&days=pair&long=1';
const FULL = 'Agents today popover, 16 sessions';
const QUIET = 'Agents today popover, 4 sessions';
const TODAY = 'Agents today popover, today';
const CAL = 'Agents today popover, calendar open';
const LONGDATE = 'Agents today popover, long date';
const longQuery = query.replace(encodeURIComponent('2026-11-11T10:24:00-08:00'), encodeURIComponent('2026-09-30T10:24:00-07:00'));
const OPEN = '.rib .ag-line >> .at-seg button:nth-child(2)';

// Runs in the page.
function measurePopover() {
  const box = document.querySelector('.agents-today');
  const rows = box?.querySelector('.at-rows');
  if (!box || !rows) return null;
  const r = (el) => {
    const b = el?.getBoundingClientRect();
    return b ? { x: Math.round(b.left * 10) / 10, y: Math.round(b.top * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 } : null;
  };
  const arrows = [...box.querySelectorAll('.at-arrow')];
  const rr = rows.getBoundingClientRect();
  const sbw = rows.offsetWidth - rows.clientWidth;
  const limit = rr.left + rows.clientWidth;
  let under = 0;
  for (const el of rows.querySelectorAll('.at-row:not(.skel) :is(.at-end, .at-time)')) {
    if (el.getBoundingClientRect().right > limit + 0.5) under++;
  }
  const lab = [...box.querySelectorAll('.at-axis span')].map((el) => ({ text: el.textContent, ...r(el) }));
  let touch = 0;
  for (let i = 1; i < lab.length; i++) if (lab[i].x - (lab[i - 1].x + lab[i - 1].w) < 4) touch++;
  const axis = r(box.querySelector('.at-axis'));
  const band = r(box.querySelector('.at-band'));
  const lg = box.querySelector('.at-legend');
  const legendCut = lg ? lg.scrollWidth > lg.clientWidth + 0.5 || [...lg.children].some((c) => c.getBoundingClientRect().right > lg.getBoundingClientRect().right + 0.5) : false;
  const cal = box.querySelector('.at-cal');
  const calBox = r(cal);
  // Every PR number sits inside its column and clear of the bar track.
  let prBad = 0;
  for (const row of rows.querySelectorAll('.at-row:not(.skel)')) {
    const p = row.querySelector('.at-prn');
    const t = row.querySelector('.at-track');
    if (!p || !t) { prBad++; continue; }
    const pb = p.getBoundingClientRect();
    const tb = t.getBoundingClientRect();
    if (p.scrollWidth > p.clientWidth + 0.5 || pb.right > tb.left + 0.5) prBad++;
  }
  const calCells = cal ? [...cal.querySelectorAll('.at-cal-day')].map((c) => ({ off: c.disabled, has: c.classList.contains('has'), bar: !!c.querySelector('i') })) : [];
  const dateEl = box.querySelector('.at-date span');
  const dateCut = dateEl ? dateEl.scrollWidth > dateEl.clientWidth + 0.5 : false;
  const dateNeed = dateEl ? dateEl.scrollWidth : 0;
  const rowsR = r(rows);
  return {
    dateCut,
    dateNeed,
    dateText: dateEl?.textContent ?? '',
    labels: lab.map((l) => l.text),
    labelTouch: touch,
    legendCut,
    axis,
    band,
    calBox,
    calCells,
    prBad,
    rowsRect: rowsR,
    bandAlign: axis && band ? axis.x === band.x && axis.w === band.w : null,
    n: rows.querySelectorAll('.at-row:not(.skel)').length,
    box: r(box),
    rows: r(rows),
    scrolls: rows.scrollHeight > rows.clientHeight + 1,
    sbw,
    under,
    gutter: getComputedStyle(rows).scrollbarGutter,
    head: { back: r(arrows[0]), today: r(box.querySelector('.at-seg button:nth-child(1)')), yesterday: r(box.querySelector('.at-seg button:nth-child(2)')), next: r(arrows[1]), date: r(box.querySelector('.at-date')) },
  };
}

let full = null;
const same = (a, b) => a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

export default {
  name: 'agents-today-popover',
  fit: {
    variants: [
      { name: FULL, q: query, click: '.rib .ag-line >> .at-seg button:nth-child(2)', checks: ['.agents-today', '.agents-today .at-head'], strip: true, viewportOnly: true },
      { name: QUIET, q: query, click: '.rib .ag-line >> .at-seg button:nth-child(2) >> .at-pick .at-arrow:first-child', checks: ['.agents-today', '.agents-today .at-head'], strip: true, viewportOnly: true },
      { name: CAL, q: query, click: '.rib .ag-line >> .at-seg button:nth-child(2) >> .at-date', checks: ['.agents-today', '.agents-today .at-cal'], strip: true, viewportOnly: true },
      { name: LONGDATE, q: longQuery, click: '.rib .ag-line', checks: ['.agents-today', '.agents-today .at-head'], strip: true, viewportOnly: true },
      { name: TODAY, q: query, click: '.rib .ag-line', checks: ['.agents-today', '.agents-today .at-head'], strip: true, viewportOnly: true },
    ],
    measurements: { popover: measurePopover },
    rules: {
      popover: (variant, results, emit) => {
        if (variant.name !== FULL && variant.name !== QUIET && variant.name !== TODAY && variant.name !== CAL && variant.name !== LONGDATE) return false;
        const m = results.popover;
        if (!m) { emit('  FAIL agents popover: the popover or its rows are missing'); return true; }
        let bad = false;
        if (m.dateCut) { emit(`  FAIL agents popover: the date text is cut ("${m.dateText}" needs ${m.dateNeed} px of text room, button ${m.head.date?.w} px)`); bad = true; }
        if (variant.name === LONGDATE) {
          if (m.head.date?.w !== 248) { emit(`  FAIL agents popover: the date button is ${m.head.date?.w} px wide, wanted 248`); bad = true; }
          if (!bad) emit(`  ok   agents popover: "${m.dateText}" fits in its button`);
          return bad;
        }
        if (variant.name === FULL) {
          full = m;
          if (m.n < 16) { emit(`  FAIL agents popover: the full day shows ${m.n} rows, wanted 16`); bad = true; }
          if (!m.scrolls) { emit('  FAIL agents popover: the 16 row day does not scroll inside the rows'); bad = true; }
        } else if (variant.name === CAL) {
          if (!m.calBox) { emit('  FAIL agents popover: the calendar did not open'); bad = true; }
          else {
            const b = m.box;
            if (m.calBox.x < b.x || m.calBox.y < b.y || m.calBox.x + m.calBox.w > b.x + b.w || m.calBox.y + m.calBox.h > b.y + b.h) { emit(`  FAIL agents popover: the calendar sits outside the strip (${JSON.stringify(m.calBox)} in ${JSON.stringify(b)})`); bad = true; }
            const bright = m.calCells.filter((c) => c.has);
            if (bright.length < 2 || bright.some((c) => c.off)) { emit(`  FAIL agents popover: the calendar has ${bright.length} bright days`); bad = true; }
            if (m.calCells.some((c) => !c.has && !c.off)) { emit('  FAIL agents popover: a dim day is clickable'); bad = true; }
          }
          if (full && !same(full.box, m.box)) { emit('  FAIL agents popover: the popover box moved or changed size with the calendar open'); bad = true; }
          for (const k of Object.keys(m.head)) {
            if (full && !same(full.head[k], m.head[k])) { emit(`  FAIL agents popover: header control "${k}" moved between days (${JSON.stringify(full.head[k])} then ${JSON.stringify(m.head[k])})`); bad = true; }
          }
        } else if (variant.name === TODAY) {
          if (full && !same(full.box, m.box)) { emit(`  FAIL agents popover: the popover box moved or changed size between days (${JSON.stringify(full.box)} then ${JSON.stringify(m.box)})`); bad = true; }
          for (const k of Object.keys(m.head)) {
            if (full && !same(full.head[k], m.head[k])) { emit(`  FAIL agents popover: header control "${k}" moved between days (${JSON.stringify(full.head[k])} then ${JSON.stringify(m.head[k])})`); bad = true; }
          }
        } else {
          if (m.n !== 4) { emit(`  FAIL agents popover: the quiet day shows ${m.n} rows, wanted 4`); bad = true; }
          if (full && !same(full.box, m.box)) { emit(`  FAIL agents popover: the popover box moved or changed size between days (${JSON.stringify(full.box)} then ${JSON.stringify(m.box)})`); bad = true; }
          for (const k of Object.keys(m.head)) {
            if (full && !same(full.head[k], m.head[k])) { emit(`  FAIL agents popover: header control "${k}" moved between days (${JSON.stringify(full.head[k])} then ${JSON.stringify(m.head[k])})`); bad = true; }
          }
        }
        // Absolute: the box is the full day's 420 px whatever the day, and the header controls keep their widths.
        if (m.box.h !== 420) { emit(`  FAIL agents popover: the popover box moved or changed size: ${m.box.h} px tall, wanted 420`); bad = true; }
        for (const [k, w] of [['today', 104], ['yesterday', 104], ['date', 248]]) {
          if (m.head[k]?.w !== w) { emit(`  FAIL agents popover: header control "${k}" moved: ${m.head[k]?.w} px wide, wanted ${w}`); bad = true; }
        }
        if (m.labelTouch > 0) { emit(`  FAIL agents popover: ${m.labelTouch} hour labels touch (${m.labels.join(', ')})`); bad = true; }
        if (m.legendCut) { emit('  FAIL agents popover: the header legend is cut'); bad = true; }
        if (m.prBad > 0) { emit(`  FAIL agents popover: ${m.prBad} PR numbers sit outside their column`); bad = true; }
        if (m.bandAlign === false) { emit('  FAIL agents popover: the open at once strip is not under the hour axis'); bad = true; }
        if (variant.name === QUIET && m.labels.length > 8) { emit(`  FAIL agents popover: the quiet day's axis is not fitted to its hours (${m.labels.join(', ')})`); bad = true; }
        if (m.under > 0) { emit(`  FAIL agents popover: ${m.under} right column texts sit under the scrollbar`); bad = true; }
        if (m.gutter !== 'stable' && m.gutter !== 'stable both-edges') { emit(`  FAIL agents popover: the rows reserve no scrollbar gutter (${m.gutter})`); bad = true; }
        if (!bad) emit(`  ok   agents popover: ${m.n} rows, box ${m.box.w} x ${m.box.h} at ${m.box.x},${m.box.y}, header fixed, scrollbar ${m.sbw} px clear, hours ${m.labels.join(' ')}`);
        return bad;
      },
    },
    breaks: {
      'popover-height': {
        css: '.agents-today { height: auto !important; max-height: 420px !important; }',
        expect: /^ *FAIL agents popover: the popover box moved or changed size/m,
        appliesTo: (v) => v.name === QUIET,
      },
      'popover-header': {
        css: '.at-seg button { width: auto !important; padding: 0 16px !important; } .at-seg button:first-child { padding: 0 6px !important; }',
        expect: /^ *FAIL agents popover: header control "(today|yesterday|next|date)"/m,
        appliesTo: (v) => v.name === TODAY,
      },
      'popover-labels': {
        css: '.at-axis span { letter-spacing: 0 !important; font-size: 40px !important; }',
        expect: /^ *FAIL agents popover: \d+ hour labels touch/m,
        appliesTo: (v) => v.name === FULL,
      },
      'popover-pr-column': {
        css: '.at-prn { width: 20px !important; overflow: visible !important; } .at-track { margin-left: -20px !important; }',
        expect: /^ *FAIL agents popover: \d+ PR numbers sit outside their column/m,
        appliesTo: (v) => v.name === FULL,
      },
      'popover-date-width': {
        css: '.at-date { width: 150px !important; }',
        expect: /^ *FAIL agents popover: the date (text is cut|button is)/m,
        appliesTo: (v) => v.name === LONGDATE,
      },
      'popover-calendar': {
        css: '.at-cal { left: 900px !important; }',
        expect: /^ *FAIL agents popover: the calendar sits outside the strip/m,
        appliesTo: (v) => v.name === CAL,
      },
      'popover-strip': {
        css: '.at-band { margin-left: 100px !important; }',
        expect: /^ *FAIL agents popover: the open at once strip is not under the hour axis/m,
        appliesTo: (v) => v.name === FULL,
      },
      'popover-gutter': {
        css: '.at-rows { scrollbar-gutter: auto !important; } .at-row { width: calc(100% + 17px) !important; }',
        expect: /^ *FAIL agents popover: (\d+ right column texts sit under the scrollbar|the rows reserve no scrollbar gutter)/m,
        appliesTo: (v) => v.name === FULL,
      },
    },
  },
};
