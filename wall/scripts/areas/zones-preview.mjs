// The My zones hover card (work/ZonesPreview.tsx): a map of the big screen in the shared hover card. It opens from the
// My zones key (keyboard focus shows it at once), reads `wall2_arrange_preview` (mocked by `?zpreview=`), and must:
// - sit inside the 2560 by 720 stage on all four sides;
// - hold its map inside its own box, each zone inside the map, and no two zones sharing pixels;
// - keep every program name and reason inside its own zone (a name too long for a narrow zone ends in an ellipsis,
//   it never runs out of the zone);
// - draw all of its text at 16 px or larger;
// - draw one zone per zone sent, each numbered 1 to n, and the footer on its own line under the map.
// Nothing here clicks a real command: the mocks answer, and nothing is moved.

const AT = encodeURIComponent('2026-11-11T10:24:00-08:00');
const base = (preview) => `?hz=work&at=${AT}&clock=review&weather=ok&agents=3&keys=zones&hold=zk&zpreview=${preview}&zpcheck=1`;
const OPEN = 'tip:.keys .key-tile-wrap:first-child .key-tile';
const OK = 'My zones preview, four zones with a rule';
const LONG = 'My zones preview, longest program names, twelve windows staying';
const NONE = 'My zones preview, no windows to move';
// Not `.hover-tip` itself: its pixel tail is drawn 8 px outside its box by design, which the generic box check reads as overflow.
const checks = ['.zp', '.zp-map'];

/** In the page (self-contained: it is serialised into the page). */
function measureZones() {
  if (new URLSearchParams(location.search).get('zpcheck') !== '1') return null;
  const card = document.querySelector('.hover-tip');
  if (!card) return { missing: 'card' };
  const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const inside = (a, b, slack = 0.5) => a.l >= b.l - slack && a.r <= b.r + slack && a.t >= b.t - slack && a.b <= b.b + slack;
  const hit = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
  const fails = [];
  const cb = R(card);
  const stage = { l: 0, t: 0, r: 2560, b: 720 };
  if (!inside(cb, stage)) fails.push(`the card (x ${Math.round(cb.l)} to ${Math.round(cb.r)}, y ${Math.round(cb.t)} to ${Math.round(cb.b)}) is not inside the stage`);
  const small = [];
  for (const el of card.querySelectorAll('.zp, .zp *')) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (own && parseFloat(getComputedStyle(el).fontSize) < 16 - 0.01) small.push(el.className || el.tagName);
  }
  if (small.length) fails.push(`${small.length} texts under 16 px (${small.slice(0, 3).join(', ')})`);
  const mapEl = card.querySelector('.zp-map');
  const zones = [...card.querySelectorAll('.zp-zone')];
  if (!mapEl) return { fails, zones: 0, text: card.textContent.length, box: cb };
  const mb = R(mapEl);
  const padBox = { l: cb.l, t: cb.t, r: cb.r, b: cb.b };
  if (!inside(mb, padBox)) fails.push(`the map (x ${Math.round(mb.l)} to ${Math.round(mb.r)}) is not inside the card (x ${Math.round(cb.l)} to ${Math.round(cb.r)})`);
  const boxes = zones.map((z) => R(z));
  zones.forEach((z, i) => {
    if (!inside(boxes[i], mb, 1.5)) fails.push(`zone ${z.dataset.zone} is not inside the map`);
    for (let j = i + 1; j < zones.length; j++) if (hit(boxes[i], boxes[j])) fails.push(`zones ${z.dataset.zone} and ${zones[j].dataset.zone} share pixels`);
    const n = z.querySelector('.zp-n');
    if (n && n.textContent !== z.dataset.zone) fails.push(`zone ${z.dataset.zone} is numbered ${n.textContent}`);
    for (const part of z.querySelectorAll('.zp-app, .zp-why')) {
      const pb = R(part);
      if (!inside(pb, boxes[i], 0.5)) fails.push(`zone ${z.dataset.zone}: "${part.textContent}" sticks out of its zone`);
      if (part.scrollWidth > part.clientWidth + 1 && getComputedStyle(part).textOverflow !== 'ellipsis') fails.push(`zone ${z.dataset.zone}: "${part.textContent}" is cut with no ellipsis`);
    }
    const label = z.querySelector('.zp-c');
    if (n && label) {
      for (const part of label.querySelectorAll('.zp-app, .zp-why')) if (hit(R(n), R(part))) fails.push(`zone ${z.dataset.zone}: the number covers "${part.textContent}"`);
    }
  });
  const foot = card.querySelector('.zp-f');
  if (!foot) fails.push('no footer');
  else if (R(foot).t < mb.b - 0.5) fails.push('the footer is not under the map');
  return { fails, zones: zones.length, text: card.textContent.length, box: cb, map: mb, ellipsed: [...card.querySelectorAll('.zp-app')].filter((e) => e.scrollWidth > e.clientWidth + 1).length };
}

export default {
  name: 'zones-preview',
  fit: {
    variants: [
      { name: OK, q: base('ok'), click: OPEN, checks, viewportOnly: true },
      { name: LONG, q: base('long'), click: OPEN, checks, viewportOnly: true },
      { name: NONE, q: base('nowin'), click: OPEN, checks: ['.zp'], viewportOnly: true },
    ],
    measurements: { zonesPreview: measureZones },
    rules: {
      zonesPreview: (variant, results, emit) => {
        if (variant.name !== OK && variant.name !== LONG && variant.name !== NONE) return false;
        const m = results.zonesPreview;
        if (!m || m.missing) { emit('  FAIL zones preview: the hover card did not open'); return true; }
        let bad = false;
        for (const f of m.fails) { emit(`  FAIL zones preview: ${f}`); bad = true; }
        const want = variant.name === NONE ? 0 : 4;
        if (m.zones !== want) { emit(`  FAIL zones preview: ${m.zones} zones drawn, wanted ${want}`); bad = true; }
        if (variant.name === LONG && !(m.ellipsed > 0)) { emit('  FAIL zones preview: the longest names are not cut in the narrow zones (nothing tested)'); bad = true; }
        if (!bad) emit(`  ok   zones preview: ${m.zones} zones inside the map, the map inside the card inside the stage, names inside their zones${m.ellipsed ? ` (${m.ellipsed} shortened with an ellipsis)` : ''}, all text 16 px or more`);
        return bad;
      },
    },
    breaks: {
      'zones-card-edge': {
        css: '.hover-tip { left: 2300px !important; }',
        expect: /^ *FAIL zones preview: the card \(x \d+ to \d+, y \d+ to \d+\) is not inside the stage/m,
        appliesTo: (v) => v.name === OK,
      },
      'zones-map-wide': {
        css: '.hover-tip:has(.zp) { max-width: 560px !important; } .zp-map { width: 900px !important; }',
        expect: /^ *FAIL zones preview: the map \(x \d+ to \d+\) is not inside the card/m,
        appliesTo: (v) => v.name === OK,
      },
      'zones-label-out': {
        css: '.zp-c { inset: auto !important; left: -60px !important; top: 0 !important; width: 260px !important; align-items: flex-start !important; }',
        expect: /^ *FAIL zones preview: zone \d: "[^"]*" sticks out of its zone/m,
        appliesTo: (v) => v.name === OK,
      },
      'zones-small-text': {
        css: '.zp-why { font-size: 12px !important; }',
        expect: /^ *FAIL zones preview: \d+ texts under 16 px/m,
        appliesTo: (v) => v.name === OK,
      },
      'zones-overlap': {
        css: '.zp-zone[data-zone="2"] { left: 100px !important; }',
        expect: /^ *FAIL zones preview: zones \d and \d share pixels/m,
        appliesTo: (v) => v.name === OK,
      },
    },
  },
};
