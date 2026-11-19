// Sunrise and sunset markers stand on their own row above the ribbon (y -26 to -4 against the strip's
// top edge), a sun icon plus the time at 16 px or more, a hairline tick at the exact minute. The row
// never touches an hour label or the needle's pill, and nothing else on the horizon band sits under it.
// Dates cover the year's worst cases at this place: sunset 4:28 PM (2 Jan), the earliest sunset 4:16 PM
// (9 Dec; 4:05 PM never happens here, the unit test covers it with a made-up sun), sunset 9:10 PM
// (1 Jul), sunrise 7:55 AM (10 Jan). The needle is set on the sun's own minute in each.
const VARIANTS = [
  ['Sun row, sunset 4:28 PM, needle on it', '2026-01-02T16:28:00-08:00', 'work', ''],
  ['Sun row, sunset 4:16 PM, needle on it', '2026-12-09T16:16:00-08:00', 'work', ''],
  ['Sun row, sunset 9:10 PM, needle on it', '2026-07-01T21:10:00-07:00', 'work', ''],
  ['Sun row, sunrise 7:55 AM, needle on it', '2026-01-10T07:55:00-08:00', 'work', ''],
  ['Sun row, Home, sunset 4:28 PM', '2026-01-02T16:28:00-08:00', 'home', ''],
  // Watt's Home walk runs stage x 1506 to 1726, which is sunset 4:13 PM to 5:54 PM: four dates across it.
  ['Sun row, Home, sunset 4:16 PM under Watt\'s walk (left end)', '2026-12-09T16:16:00-08:00', 'home', ''],
  ['Sun row, Home, sunset about 4:55 PM under Watt\'s walk', '2026-01-20T16:55:00-08:00', 'home', ''],
  ['Sun row, Home, sunset about 5:05 PM under Watt\'s walk (middle)', '2026-02-01T17:05:00-08:00', 'home', ''],
  ['Sun row, Home, sunset about 5:50 PM under Watt\'s walk (right end)', '2026-03-01T17:50:00-08:00', 'home', ''],
  // The leave banner in the band above the ribbon (Home and Meet): the markers are hidden while it shows.
  ['Sun row, Home with the leave banner, sunset 5:05 PM', '2026-02-01T17:05:00-08:00', 'home', '&leave=30'],
  ['Sun row, Home with the amber leave banner, sunset 4:28 PM', '2026-01-02T16:28:00-08:00', 'home', '&leave=3'],
];
const NAMES = VARIANTS.map((v) => v[0]);
const BANNER = new Set(NAMES.filter((n, i) => VARIANTS[i][3] !== ''));
const WITH_MARKER = NAMES.filter((n) => !BANNER.has(n));

function measureSunRow() {
  const rects = (els) => [...els].map((e) => ({ t: (e.textContent || e.className).trim().slice(0, 20), r: e.getBoundingClientRect() }));
  const pills = [...document.querySelectorAll('.sun-layer .sunm-pill')];
  const rib = document.querySelector('.rib');
  const labels = rects(document.querySelectorAll('.rib .hl, .rib .ndl b'));
  const ribRect = rib ? rib.getBoundingClientRect() : { top: 0 };
  const layer = document.querySelector('.sun-layer');
  const watt = document.querySelector('.watt');
  const out = {
    pills: [],
    labels: labels.length,
    ribTop: ribRect.top,
    band: [],
    banner: !!document.querySelector('.leave-banner'),
    // The ribbon clips its own content, and no marker is inside it.
    ribClips: !!rib && getComputedStyle(rib).overflow === 'hidden',
    markerInRib: document.querySelectorAll('.rib .sunm, .rib .sunm-pill').length,
    // Watt is in front of the sun row: the row's layer comes first in the stage and takes no stacking order of its own.
    layerBehindWatt: !!layer && !!watt && !!(layer.compareDocumentPosition(watt) & Node.DOCUMENT_POSITION_FOLLOWING) && getComputedStyle(layer).zIndex === 'auto',
    wattOverPill: false,
  };
  const others = rects(document.querySelectorAll('.leave-banner, .meet .panel'));
  const sheep = document.querySelector('.watt-sheep > svg');
  const sr = sheep ? sheep.getBoundingClientRect() : null;
  for (const p of pills) {
    const r = p.getBoundingClientRect();
    const cs = getComputedStyle(p);
    const tick = p.parentElement.querySelector('.sunm-tick')?.getBoundingClientRect();
    const touch = labels.filter((l) => r.left <= l.r.right && l.r.left <= r.right && r.top <= l.r.bottom && l.r.top <= r.bottom).map((l) => l.t);
    const gap = labels.length ? Math.min(...labels.map((l) => Math.max(l.r.top - r.bottom, r.top - l.r.bottom))) : 99;
    out.pills.push({ text: p.textContent.trim(), font: parseFloat(cs.fontSize), touch, gap, top: r.top - out.ribTop, bottom: r.bottom - out.ribTop, tickOk: !!tick && Math.abs(tick.left - (r.left + r.width / 2)) < 1.5 && tick.bottom >= out.ribTop - 0.5 });
    for (const o of others) if (o.r.width > 0 && r.left <= o.r.right && o.r.left <= r.right && r.top <= o.r.bottom && o.r.top <= r.bottom) out.band.push(o.t);
    if (sr && r.left <= sr.right && sr.left <= r.right && r.top <= sr.bottom && sr.top <= r.bottom) out.wattOverPill = true;
  }
  return out;
}

export default {
  name: 'sun-row',
  fit: {
    variants: VARIANTS.map(([name, at, hz, extra]) => ({
      name,
      q: `?hz=${hz}&at=${encodeURIComponent(at)}&clock=review&weather=ok${extra}`,
      checks: extra ? ['.leave-banner'] : ['.sun-layer .sunm-pill'],
      viewportOnly: true,
    })),
    measurements: { sunRow: measureSunRow },
    rules: {
      sunRow: (variant, results, emit) => {
        if (!NAMES.includes(variant.name)) return false;
        const r = results.sunRow;
        const bad = [];
        if (BANNER.has(variant.name)) {
          if (!r.banner) bad.push('the leave banner is not showing');
          if (r.pills.length) bad.push('a sun marker is drawn under the leave banner');
          if (bad.length === 0) {
            emit('  ok   sun row: the leave banner shows and the sun markers are hidden');
            return false;
          }
          emit(`  FAIL sun row: ${bad.join('; ')}`);
          return true;
        }
        if (r.pills.length === 0) bad.push('no sun marker drawn');
        if (!r.ribClips) bad.push('the ribbon does not clip its content');
        if (r.markerInRib) bad.push('a sun marker is inside the ribbon');
        if (!r.layerBehindWatt) bad.push('the sun row is not under Watt');
        if (r.banner) bad.push('the leave banner shows but the markers are drawn');
        for (const p of r.pills) {
          if (p.font < 16) bad.push(`"${p.text}" is ${p.font} px type`);
          if (p.touch.length) bad.push(`"${p.text}" touches ${p.touch.join(', ')}`);
          if (p.gap < 8) bad.push(`"${p.text}" is ${Math.round(p.gap)} px from the nearest label (needs 8)`);
          if (!p.tickOk) bad.push(`"${p.text}" tick is off its minute or short of the strip`);
        }
        if (r.band.length) bad.push('covers ' + r.band.join(', '));
        if (bad.length === 0) {
          emit(`  ok   sun row: ${r.pills.map((p) => `${p.text} (${p.font} px, ${Math.round(p.gap)} px clear)`).join(', ')}, never on a label${r.wattOverPill ? ', Watt stands in front of it' : ''}`);
          return false;
        }
        emit(`  FAIL sun row: ${bad.join('; ')}`);
        return true;
      },
    },
    breaks: {
      'sun-row-down': {
        css: '.sun-layer .sunm { top: 600px !important; }',
        expect: /^ *FAIL sun row:/m,
        appliesTo: (variant) => variant.name === NAMES[0],
      },
      'sun-row-over-watt': {
        css: '.sun-layer { z-index: 5 !important; }',
        expect: /^ *FAIL sun row: .*not under Watt/m,
        appliesTo: (variant) => variant.name === WITH_MARKER[0],
      },
      'sun-row-unclipped': {
        css: '.rib { overflow: visible !important; }',
        expect: /^ *FAIL sun row: .*does not clip/m,
        appliesTo: (variant) => variant.name === WITH_MARKER[0],
      },
    },
  },
};
