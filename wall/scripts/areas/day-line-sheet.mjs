// The day line clear of the bottom row, and the Lines and Lights sheet pages that scroll inside the wall.
// Day line: every box in the status line (.u-foot) and the Office moods slot ends 4 px or more above the day line's top.
// Sheet: the Lines and Lights pages end at wall y 650 or less (clear of Office moods), the heading row and page switch
// stay fixed, and the last row can be scrolled into view inside the one scroll body.
const at = '2026-11-11T10:24:00-08:00';
const Q = `?hz=unwind&at=${encodeURIComponent(at)}&long=1&agents=3&audio=demo&desktoken=set&office=six&officeoff=offered&officemood=relax`;
const OPEN_LIGHTS = '.w-gear >> .ln-pages button:nth-child(3)';

// Runs in the page.
function measureDayLine() {
  const line = document.querySelector('.rib-line');
  if (!line) return { found: false };
  const lt = line.getBoundingClientRect().top;
  const boxes = [];
  const foot = document.querySelector('.u-foot');
  const slot = document.querySelector('[data-slot="office-lights"]');
  for (const root of [foot, slot]) {
    if (!root) continue;
    for (const e of [root, ...root.querySelectorAll('*')]) {
      const r = e.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) boxes.push({ cls: String(e.className || e.tagName).slice(0, 30), b: r.bottom });
    }
  }
  const worst = boxes.reduce((w, x) => (x.b > w.b ? x : w), { cls: '', b: -1 });
  const tom = document.querySelector('.u-tomorrow');
  return { found: true, lineTop: lt, worst, count: boxes.length, hasFoot: !!foot, tomorrowB: tom ? tom.getBoundingClientRect().bottom : null, footTop: (document.querySelector('.u-line, .u-cap') || foot || document.body).getBoundingClientRect().top };
}

// Runs in the page.
function measureSheetScroll() {
  const sheet = document.querySelector('.w-sheet.ln-sheet');
  if (!sheet) return { found: false };
  const body = sheet.querySelector(':scope > .ln-body');
  if (!body) return { found: true, body: false };
  const sb = sheet.getBoundingClientRect();
  const head = sheet.querySelector(':scope > .w-head');
  const hb = head ? head.getBoundingClientRect() : null;
  const before = hb ? hb.top : 0;
  const over = body.scrollHeight - body.clientHeight > 1;
  body.scrollTop = body.scrollHeight;
  const rows = [...body.querySelectorAll('.ln-row, .ls-row, .ls-who, .ln-foot, .ln-hint')];
  const last = rows[rows.length - 1];
  const bb = body.getBoundingClientRect();
  const lr = last ? last.getBoundingClientRect() : null;
  const reach = !lr || (lr.bottom <= bb.bottom + 0.5 && lr.top >= bb.top - 0.5);
  const headMoved = hb ? Math.abs(head.getBoundingClientRect().top - before) > 0.5 : false;
  const cs = getComputedStyle(body);
  body.scrollTop = 0;
  return { found: true, body: true, bottom: sb.bottom, top: sb.top, over, reach, headMoved, ovY: cs.overflowY, fade: body.classList.contains('sb-fade-bottom'), lights: sheet.classList.contains('ls-sheet') };
}

export default {
  name: 'day-line-sheet',
  fit: {
    variants: [
      { name: 'Day line, bottom row at rest', q: Q, checks: ['.u-foot'] },
      { name: 'Sheet scroll, Lines page', q: Q, click: '.w-gear', checks: ['.w-sheet.ln-sheet'] },
      { name: 'Sheet scroll, Lights page', q: Q, click: OPEN_LIGHTS, checks: ['.w-sheet.ls-sheet'] },
    ],
    measurements: { dayLine: measureDayLine, sheetScroll: measureSheetScroll },
    rules: {
      dayLine: (variant, results, emit) => {
        if (!variant.name.startsWith('Day line')) return false;
        const m = results.dayLine;
        let bad = false;
        const fail = (t) => { emit('  FAIL day line: ' + t); bad = true; };
        if (!m || !m.found) { fail('the day line is not on the page'); return true; }
        if (!m.hasFoot) fail('the bottom row is not on the page');
        else if (m.lineTop - m.worst.b < 3.95) fail(`a box (${m.worst.cls}) ends at y ${Math.round(m.worst.b * 10) / 10}, ${Math.round((m.lineTop - m.worst.b) * 10) / 10} px above the day line at ${Math.round(m.lineTop * 10) / 10} (4 at least)`);
        if (m.tomorrowB != null && m.footTop != null && m.tomorrowB > m.footTop - 0.5) fail(`Tomorrow ends at y ${Math.round(m.tomorrowB)}, into the bottom row at ${Math.round(m.footTop)}`);
        if (!bad) emit(`  ok   day line: ${m.count} boxes of the bottom row end at y ${Math.round(m.worst.b * 10) / 10}, ${Math.round((m.lineTop - m.worst.b) * 10) / 10} px above the day line (4 at least), Tomorrow clear`);
        return bad;
      },
      sheetScroll: (variant, results, emit) => {
        if (!variant.name.startsWith('Sheet scroll')) return false;
        const m = results.sheetScroll;
        let bad = false;
        const fail = (t) => { emit('  FAIL sheet scroll: ' + t); bad = true; };
        if (!m || !m.found) { fail('the sheet is not open'); return true; }
        if (!m.body) { fail('the page has no scroll body'); return true; }
        if (m.bottom > 650.5) fail(`the sheet ends at y ${Math.round(m.bottom)} (650 at most, clear of Office moods)`);
        if (m.ovY !== 'auto') fail('the body does not scroll (overflow-y ' + m.ovY + ')');
        if (!m.fade) fail('the body has no fade hook');
        if (!m.reach) fail('the last row cannot be scrolled into view');
        if (m.headMoved) fail('the heading row moved while the body scrolled');
        if (!bad) emit(`  ok   sheet scroll: the ${m.lights ? 'Lights' : 'Lines'} sheet ends at y ${Math.round(m.bottom)} (650 at most), the body ${m.over ? 'scrolls' : 'fits'} with the heading fixed, the last row reachable`);
        return bad;
      },
    },
    breaks: {
      'day-line-up': { css: '.rib-line { bottom: 0 !important; }', expect: /^ *FAIL day line: a box .* px above the day line/m, appliesTo: (v) => v.name === 'Day line, bottom row at rest' },
      'sheet-tall': { css: '.w-sheet.ln-sheet { max-height: none !important; height: 900px !important; }', expect: /^ *FAIL sheet scroll: the sheet ends at y/m, appliesTo: (v) => v.name === 'Sheet scroll, Lines page' },
    },
  },
};
