// Sunrise and sunset markers stand on their own row above the ribbon (y -26 to -4 against the strip's
// top edge), a sun icon plus the time at 16 px or more, a hairline tick at the exact minute. The row
// never touches an hour label or the needle's pill, and nothing else on the horizon band sits under it.
// Dates cover the year's worst cases at this place: sunset 4:28 PM (2 Jan), the earliest sunset 4:16 PM
// (9 Dec; 4:05 PM never happens here, the unit test covers it with a made-up sun), sunset 9:10 PM
// (1 Jul), sunrise 7:55 AM (10 Jan). The needle is set on the sun's own minute in each.
const VARIANTS = [
  ['Sun row, sunset 4:28 PM, needle on it', '2026-01-02T16:28:00-08:00', 'work'],
  ['Sun row, sunset 4:16 PM, needle on it', '2026-12-09T16:16:00-08:00', 'work'],
  ['Sun row, sunset 9:10 PM, needle on it', '2026-07-01T21:10:00-07:00', 'work'],
  ['Sun row, sunrise 7:55 AM, needle on it', '2026-01-10T07:55:00-08:00', 'work'],
  ['Sun row, Home, sunset 4:28 PM', '2026-01-02T16:28:00-08:00', 'home'],
];
const NAMES = VARIANTS.map((v) => v[0]);

function measureSunRow() {
  const rects = (els) => [...els].map((e) => ({ t: (e.textContent || e.className).trim().slice(0, 20), r: e.getBoundingClientRect() }));
  const pills = [...document.querySelectorAll('.rib .sunm-pill')];
  const rib = document.querySelector('.rib');
  const labels = rects(document.querySelectorAll('.rib .hl, .rib .ndl b'));
  const out = { pills: [], labels: labels.length, ribTop: rib ? rib.getBoundingClientRect().top : 0, band: [] };
  const others = rects(document.querySelectorAll('.watt-sheep, .watt-hit, .leave, .banner, [class*="leave"], .meet .panel'));
  for (const p of pills) {
    const r = p.getBoundingClientRect();
    const cs = getComputedStyle(p);
    const tick = p.parentElement.querySelector('.sunm-tick')?.getBoundingClientRect();
    const touch = labels.filter((l) => r.left <= l.r.right && l.r.left <= r.right && r.top <= l.r.bottom && l.r.top <= r.bottom).map((l) => l.t);
    const gap = labels.length ? Math.min(...labels.map((l) => Math.max(l.r.top - r.bottom, r.top - l.r.bottom))) : 99;
    out.pills.push({ text: p.textContent.trim(), font: parseFloat(cs.fontSize), touch, gap, top: r.top - out.ribTop, bottom: r.bottom - out.ribTop, tickOk: !!tick && Math.abs(tick.left - (r.left + r.width / 2)) < 1.5 && tick.bottom >= out.ribTop - 0.5 });
    for (const o of others) if (o.r.width > 0 && r.left <= o.r.right && o.r.left <= r.right && r.top <= o.r.bottom && o.r.top <= r.bottom) out.band.push(o.t);
  }
  return out;
}

export default {
  name: 'sun-row',
  fit: {
    variants: VARIANTS.map(([name, at, hz]) => ({
      name,
      q: `?hz=${hz}&at=${encodeURIComponent(at)}&clock=review&weather=ok`,
      checks: ['.rib .sunm-pill'],
      viewportOnly: true,
    })),
    measurements: { sunRow: measureSunRow },
    rules: {
      sunRow: (variant, results, emit) => {
        if (!NAMES.includes(variant.name)) return false;
        const r = results.sunRow;
        const bad = [];
        if (r.pills.length === 0) bad.push('no sun marker drawn');
        for (const p of r.pills) {
          if (p.font < 16) bad.push(`"${p.text}" is ${p.font} px type`);
          if (p.touch.length) bad.push(`"${p.text}" touches ${p.touch.join(', ')}`);
          if (p.gap < 8) bad.push(`"${p.text}" is ${Math.round(p.gap)} px from the nearest label (needs 8)`);
          if (!p.tickOk) bad.push(`"${p.text}" tick is off its minute or short of the strip`);
        }
        if (r.band.length) bad.push('covers ' + r.band.join(', '));
        if (bad.length === 0) {
          emit(`  ok   sun row: ${r.pills.map((p) => `${p.text} (${p.font} px, ${Math.round(p.gap)} px clear)`).join(', ')}, never on a label`);
          return false;
        }
        emit(`  FAIL sun row: ${bad.join('; ')}`);
        return true;
      },
    },
    breaks: {
      'sun-row-down': {
        css: '.rib .sunm { top: 4px !important; }',
        expect: /^ *FAIL sun row:/m,
        appliesTo: (variant) => variant.name === NAMES[0],
      },
    },
  },
};
