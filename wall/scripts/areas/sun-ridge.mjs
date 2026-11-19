// The sun behind the ridge (also while a refused autoplay waits for a click), and the "How video is
// shown" sheet's heading row. One area file: gallery states, fit variants, the in-page measurement,
// its rule and the deliberate breaks.
const Q = 'hz=unwind&at=2026-11-11T17%3A00%3A00-08%3A00&clock=review&weather=ok&watch=mock&wlist=three&wplay=0';
const FQ = '?hz=unwind&at=2026-11-11T17:00:00-08:00&long=1&agents=3&watch=mock&wlist=three&wplay=0';
const NOTE = 'the ridge in front of the sun is a drawing; fit-check reads the front canvas over the disc';

/**
 * In the page (self-contained: it is serialised into the page). With `sunridge=cover` the sun is
 * behind the land: its stage is layered, the front canvas is in the stage after the picture and
 * nothing lifts the picture above it; the front canvas is opaque over part of the disc's lower half
 * (at the disc's foot when the sun is at or under its usual height) and clear over its top; and
 * while a click is awaited the pointer reaches the player at points of the disc's visible part.
 * With `sunridge=sheet`: the "Looks | Lines" switch, the close cross and the "Same for all | Each
 * source its own" choice do not overlap, the switch and the cross keep their places.
 */
const measureSunRidge = () => {
  const mode = new URLSearchParams(location.search).get('sunridge');
  if (!mode) return null;
  try {
    return run(mode);
  } catch (e) {
    return { mode, fails: ['sun ridge: the check broke: ' + e.message] };
  }
  function run(mode) {
    const fails = [];
    const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const meet = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    if (mode === 'sheet') {
      const sheet = document.querySelector('.w-sheet.w-tune');
      const pages = sheet && sheet.querySelector('.ln-pages');
      const x = sheet && sheet.querySelector('.w-x');
      const pick = sheet && sheet.querySelector('.w-mode');
      const title = sheet && sheet.querySelector(':scope > .u-k');
      if (!sheet || !pages || !x || !pick || !title) return { mode, fails: ['sun ridge: the Looks sheet has no switch, cross, title or Same for all choice'] };
      const s = R(sheet), p = R(pages), c = R(x), m = R(pick);
      const tr = document.createRange(); tr.selectNodeContents(title); const tb = tr.getBoundingClientRect();
      const t = { l: tb.left, t: tb.top, r: tb.right, b: tb.bottom };
      if (meet(p, m) || m.t - p.b < 5.5) fails.push('sun ridge: the Same for all choice starts ' + Math.round((m.t - p.b) * 10) / 10 + ' px under the Looks | Lines switch (6 at least, no overlap)');
      if (meet(c, m)) fails.push('sun ridge: the close cross overlaps the Same for all choice');
      if (meet(p, c)) fails.push('sun ridge: the Looks | Lines switch overlaps the close cross');
      if (meet(p, t)) fails.push('sun ridge: the Looks | Lines switch overlaps the title');
      const pt = p.t - s.t, pr = s.r - p.r, ct = c.t - s.t, cr = s.r - c.r;
      if (Math.abs(pt - 14) > 1.5 || Math.abs(pr - 70) > 1.5) fails.push('sun ridge: the Looks | Lines switch moved to ' + Math.round(pt) + ' px down, ' + Math.round(pr) + ' px in (14 and 70)');
      if (Math.abs(ct - 14) > 1.5 || Math.abs(cr - 18) > 1.5) fails.push('sun ridge: the close cross moved to ' + Math.round(ct) + ' px down, ' + Math.round(cr) + ' px in (14 and 18)');
      const words = [...pick.querySelectorAll('button')].map((b) => b.textContent.trim()).join(' | ');
      if (words !== 'Same for all | Each source its own') fails.push('sun ridge: the choice reads "' + words + '"');
      for (const b of pick.querySelectorAll('button')) if (b.scrollWidth > b.clientWidth + 0.5) fails.push('sun ridge: "' + b.textContent.trim() + '" is cut');
      return { mode, fails };
    }
    const stage = document.querySelector('.w-stage.w-sun');
    const scr = stage && stage.querySelector('.w-screen');
    if (!stage || !scr) return { mode, fails: ['sun ridge: no sun stage'] };
    if (!stage.classList.contains('w-layered')) fails.push('sun ridge: the sun is not behind the land (no w-layered on its stage)');
    const f = stage.querySelector('.w-front canvas.horizon-front');
    if (!f) return { mode, fails: fails.concat(['sun ridge: no front canvas in the sun stage']) };
    if (!(scr.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING)) fails.push('sun ridge: the front canvas is not after the picture');
    // Nothing lifts the picture above the front canvas in the stage's layer order.
    for (const el of [scr, ...scr.querySelectorAll('*')]) {
      const z = getComputedStyle(el).zIndex;
      if (z !== 'auto' && Number(z) > 0) { fails.push('sun ridge: the picture is lifted above the front canvas (z-index ' + z + ' on ' + (el.className || el.tagName) + ')'); break; }
    }
    const fz = getComputedStyle(stage.querySelector('.w-front')).zIndex;
    if (fz !== 'auto' && Number(fz) < 0) fails.push('sun ridge: the front layer is put under the picture (z-index ' + fz + ')');
    if (getComputedStyle(stage.querySelector('.w-front')).display === 'none' || getComputedStyle(f).display === 'none') fails.push('sun ridge: the front canvas is hidden');
    const d = R(scr);
    const cx = d.l + d.w / 2, cy = d.t + d.h / 2, r = d.w / 2;
    const ctx = f.getContext('2d');
    const k = f.width / 2560;
    const alpha = (x, y) => ctx.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data[3];
    // The disc's lower half on a grid: how much of it the land covers.
    let n = 0, cover = 0;
    for (let y = cy; y < d.b - 1; y += 6) for (let x = d.l; x < d.r; x += 6) {
      if (Math.hypot(x - cx, y - cy) > r - 2) continue;
      n++;
      if (alpha(x, y) >= 250) cover++;
    }
    const share = n ? cover / n : 0;
    const up = Number(stage.getAttribute('data-up') || 'NaN');
    const foot = alpha(cx, d.b - 3);
    const topA = alpha(cx, d.t + 3);
    if (topA > 12) fails.push('sun ridge: the front canvas paints over the top of the disc (alpha ' + topA + ')');
    if (share < 0.02) fails.push('sun ridge: the land covers ' + Math.round(share * 100) + ' percent of the disc\'s lower half (2 at least)');
    const low = new URLSearchParams(location.search).get('sunfoot') === '1';
    if (low && foot < 250) fails.push('sun ridge: the disc\'s foot is not covered by the land (alpha ' + foot + ')');
    // Waiting for a click: the pointer reaches the player where the disc shows.
    const take = scr.querySelector('.w-frame.w-take');
    let hits = 0, tries = 0;
    if (take) {
      for (const [dx, dy] of [[0, -0.6], [-0.4, -0.3], [0.4, -0.3], [0, 0]]) {
        const x = cx + dx * r, y = cy + dy * r;
        if (alpha(x, y) >= 250) continue;
        tries++;
        const at = document.elementFromPoint(x, y);
        if (at && (at === take || take.contains(at))) hits++;
        else {
          const named = at && at.closest('[class]');
          const chain = [];
          for (let e = named; e && chain.length < 4; e = e.parentElement) if (typeof e.className === 'string' && e.className) chain.push(e.className.split(' ')[0]);
          fails.push('sun ridge: a click at ' + Math.round(x) + ',' + Math.round(y) + ' on the waiting sun reaches ' + (at ? at.tagName.toLowerCase() + ' in ' + chain.join(' in ') : 'nothing') + ', not the player');
        }
      }
    }
    return { mode, fails, share: Math.round(share * 100), foot, waiting: !!take, hits, tries, up };
  }
};

const rule = (variant, results, emit) => {
  const m = results.sunRidge;
  if (!m) return false;
  for (const f of m.fails) emit(`  FAIL ${f}`);
  if (m.fails.length) return true;
  if (m.mode === 'sheet') emit('  ok   sun ridge: the Looks | Lines switch and the cross keep their places, the Same for all | Each source its own choice starts under them');
  else emit(`  ok   sun ridge: the land covers ${m.share} percent of the disc's lower half, the top is clear${m.waiting ? `, and ${m.hits} of ${m.tries} clicks on the waiting sun reach the player` : ''}`);
  return false;
};

export default {
  name: 'sun-ridge',
  gallery: {
    states: [
      { screen: 'unwind', name: 'sun ridge: the sun waiting for a click', query: `${Q}&wlook=sun&wstate=refused`, custom: true, expectNote: NOTE },
      { screen: 'unwind', name: 'sun ridge: the sun playing', query: `${Q}&wlook=sun`, custom: true, expectNote: NOTE },
      { screen: 'unwind', name: 'sun ridge: the sun at its highest, waiting for a click', query: `${Q}&wlook=sun&wstate=refused&wtune=sun.up=60`, custom: true, expectNote: NOTE },
      { screen: 'unwind', name: 'sun ridge: the sun sunk, reduced motion, waiting for a click', query: `${Q}&wlook=sun&wstate=refused&wtune=sun.up=-100&reduced=1`, custom: true, expectNote: NOTE },
      { screen: 'unwind', name: 'sun ridge: sheet heading, one look', query: `${Q}&wlook=sun&wsheet=one`, custom: true, expect: ['Same for all', 'Each source its own', 'Looks', 'Lines'] },
      { screen: 'unwind', name: 'sun ridge: sheet heading, a look per kind', query: `${Q}&wsheet=kind`, custom: true, expect: ['Same for all', 'Each source its own', 'Looks', 'Lines'] },
    ],
  },
  fit: {
    variants: [
      { name: 'Sun ridge, the sun waiting for a click', q: `${FQ}&wlook=sun&wstate=refused&sunridge=cover&sunfoot=1`, checks: ['.w-now', '.w-gear'], sky: 'front', hits: ['.w-gear', '.w-ctl .rd:not(:disabled)', '.w-open', '.w-clickline'] },
      { name: 'Sun ridge, the sun playing', q: `${FQ}&wlook=sun&sunridge=cover&sunfoot=1`, checks: ['.w-now', '.w-gear'], sky: 'front' },
      { name: 'Sun ridge, the sun at its highest, waiting for a click', q: `${FQ}&wlook=sun&wstate=refused&wtune=sun.up=60&sunridge=cover`, checks: ['.w-now', '.w-gear'], sky: 'front' },
      { name: 'Sun ridge, the sun small and highest, waiting for a click', q: `${FQ}&wlook=sun&wstate=refused&wtune=sun.size=280,sun.up=60&sunridge=cover`, checks: ['.w-now', '.w-gear'], sky: 'front' },
      { name: 'Sun ridge, the sun sunk, reduced motion, waiting for a click', q: `${FQ}&wlook=sun&wstate=refused&wtune=sun.up=-100&reduced=1&sunridge=cover&sunfoot=1`, checks: ['.w-now', '.w-gear'], sky: 'front' },
      { name: 'Sun ridge, sheet heading, one look', q: `${FQ}&wlook=sun&wsheet=one&sunridge=sheet`, checks: ['.w-sheet', '.w-mode', '.ln-pages'] },
      { name: 'Sun ridge, sheet heading, a look per kind', q: `${FQ}&wsheet=kind&sunridge=sheet`, checks: ['.w-sheet', '.w-mode', '.ln-pages'] },
    ],
    measurements: { sunRidge: measureSunRidge },
    rules: { sunRidge: rule },
    breaks: {
      'sunridge-lifted': { css: '.w-sun .w-screen { z-index: 2 !important; }', expect: /^ *FAIL sun ridge: the picture is lifted above the front canvas/m, appliesTo: (v) => v.name === 'Sun ridge, the sun waiting for a click' },
      'sunridge-click': { css: '.top:has(.w-sun .w-take) .unwind .u-centre { pointer-events: auto !important; }', expect: /^ *FAIL sun ridge: a click at \d+,\d+ on the waiting sun reaches /m, appliesTo: (v) => v.name === 'Sun ridge, the sun waiting for a click' },
      'sunridge-sheet': { css: '.w-sheet.w-tune > .u-k { min-height: 0 !important; margin-top: 0 !important; }', expect: /^ *FAIL sun ridge: the Same for all choice starts -?[\d.]+ px under the Looks \| Lines switch/m, appliesTo: (v) => v.name === 'Sun ridge, sheet heading, one look' },
    },
  },
};
