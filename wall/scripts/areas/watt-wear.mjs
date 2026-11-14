// What Watt wears: his headphones (one big cup on the ear) and the star patch on his side, and the bow with
// the headphones. The unit tests hold every pose; these states and rules hold the drawn wall: the star is drawn
// whatever he is doing (standing, his menu open and he looks up, asleep, lying down, seated at the drive-in,
// with the headphones, with a scarf), inside his sprite's box, and a cup that is drawn sits on his head.
// The cape, the star and the bow are cosmetics he wears one at a time, so there is no star-and-cape state.
const TYPICAL = encodeURIComponent('2026-11-11T10:24:00-08:00');
const NIGHT = encodeURIComponent('2026-11-11T22:30:00-08:00');
const DRIVE_IN = 'watch=mock&wlist=three&wlook=drivein&wplay=0';
const gallery = (knobs, at = TYPICAL) => `hz=unwind&at=${at}&clock=review&weather=ok&${knobs}`;
const galleryCold = (knobs) => `hz=unwind&at=${TYPICAL}&clock=review&${knobs}`;
const NO_TEXT = 'what he wears is drawn pixels, not text; the unit tests (every pose) and fit-check (the star inside his box) hold it';
const state = (name, query, extra = {}) => ({ screen: 'unwind', name, query, custom: true, expectNote: NO_TEXT, ...extra });

const fit = (knobs, at = '2026-11-11T10:24:00-08:00') => `?hz=unwind&at=${at}&long=1&agents=3${knobs}`;
const SHEEP = ['.watt-sheep > svg'];

// Runs in the page: with the star chosen (?wattwear=star) it is drawn whatever he is doing (his menu open
// included), and every pixel of it lies inside his sprite's box; a headphone cup that is drawn sits on his
// head (inside his sprite's box but for the two sprite rows the band may rise above it); a bow worn with the
// headphones shows whole (its box is inside his sprite's box, clear of the cup).
function measureWear() {
  const wantStar = new URLSearchParams(location.search).get('wattwear') === 'star';
  const sheep = document.querySelector('.watt-sheep > svg');
  const cup = document.querySelector('.watt-prop-headphones > svg');
  if (!wantStar && !cup) return null;
  const fails = [];
  if (!sheep) return { fails: ['watt wear: Watt is not on the page'] };
  const me = sheep.getBoundingClientRect();
  const inside = (r, up) => r.left >= me.left - 0.5 && r.right <= me.right + 0.5 && r.top >= me.top - up - 0.5 && r.bottom <= me.bottom + 0.5;
  const menu = !!document.querySelector('.watt-menu');
  const at = (r) => Math.round(r.left) + ',' + Math.round(r.top) + ' to ' + Math.round(r.right) + ',' + Math.round(r.bottom);
  let star = null;
  if (wantStar) {
    const el = document.querySelector('.watt-prop-star > svg');
    const r = el && el.getBoundingClientRect();
    if (!r || r.width < 1) fails.push('watt wear: the star is not drawn' + (menu ? ' while his menu is open' : ''));
    else {
      star = at(r);
      if (!inside(r, 0)) fails.push('watt wear: the star at ' + at(r) + ' is not inside his sprite at ' + at(me));
    }
  }
  let bow = null;
  if (cup) {
    const r = cup.getBoundingClientRect();
    if (!inside(r, 2 * (r.width / 5))) fails.push('watt wear: the headphones at ' + at(r) + ' are not on his head at ' + at(me));
    const b = document.querySelector('.watt-prop-bow > svg');
    if (b) {
      const q = b.getBoundingClientRect();
      bow = at(q);
      // The bow is drawn before the cup, so the cup is over it: none of the bow may lie under the cup or the band. The
      // cup's box has empty corners, so the two boxes may share at most one sprite pixel's width.
      const u = r.width / 5;
      const wide = Math.min(q.right, r.right) - Math.max(q.left, r.left);
      const under = wide > u + 0.5 && q.top < r.bottom - 0.5 && r.top < q.bottom - 0.5;
      if (!inside(q, 0) || under) fails.push('watt wear: the bow at ' + at(q) + ' is hidden by or off his head, with the headphones at ' + at(r));
    }
  }
  return { fails, star, cup: !!cup, bow, menu };
}

export default {
  name: 'watt-wear',
  gallery: { states: [
    state('Watt wears: headphones while music plays', gallery('audio=demo')),
    state('Watt wears: the star, standing', gallery('wattwear=star')),
    { screen: 'unwind', name: 'Watt wears: the star, menu open and he looks up', query: gallery('wattwear=star'), custom: true, actions: 'ctx:.watt-hit', expect: ['Tricks', 'Wears', '!Star in'] },
    state('Watt wears: the star, asleep at night', gallery('wattwear=star', NIGHT)),
    // The tricks wait during a meeting, so the Nap state has none on the calendar.
    state('Watt wears: the star, lying down (the Nap trick)', gallery('wattwear=star&meet=none'), { actions: 'ctx:.watt-hit >> .watt-menu .wm-it:nth-child(3) >> .nothing >> .nothing' }),
    state('Watt wears: the star, sitting at the drive-in', gallery(`${DRIVE_IN}&wattwear=star`, NIGHT)),
    state('Watt wears: the star and the headphones', gallery('wattwear=star&audio=demo')),
    state('Watt wears: the star and a scarf', galleryCold('wattwear=star&weather=cold')),
    state('Watt wears: the cape instead of the star', gallery('wattwear=cape')),
    state('Watt wears: the bow and the headphones', gallery('wattwear=bow&audio=demo')),
    state('Watt wears: the bow alone', gallery('wattwear=bow')),
  ] },
  fit: {
    variants: [
      { name: 'Watt wears the star, standing', q: fit('&wattwear=star'), checks: SHEEP, viewportOnly: true },
      { name: 'Watt wears the star, menu open', q: fit('&wattwear=star'), checks: ['.watt-menu'], viewportOnly: true, card: true },
      { name: 'Watt wears the star, asleep at night', q: fit('&wattwear=star', '2026-11-11T22:30:00-08:00'), checks: SHEEP, viewportOnly: true },
      { name: 'Watt wears the star, lying down for a nap', q: fit('&wattwear=star&meet=none'), click: 'ctx:.watt-hit >> .watt-menu .wm-it:nth-child(3)', checks: SHEEP, viewportOnly: true },
      { name: 'Watt wears the star, seated at the drive-in', q: fit(`&${DRIVE_IN}&wattwear=star`, '2026-11-11T22:30:00-08:00'), checks: SHEEP, viewportOnly: true },
      { name: 'Watt wears the star and the headphones', q: fit('&wattwear=star&audio=demo'), checks: SHEEP, viewportOnly: true },
      { name: 'Watt wears the star and a scarf', q: fit('&wattwear=star&weather=cold'), checks: SHEEP, viewportOnly: true },
      { name: 'Watt wears the bow and the headphones', q: fit('&wattwear=bow&audio=demo'), checks: SHEEP, viewportOnly: true },
    ],
    measurements: { wattWear: measureWear },
    rules: {
      wattWear: (variantEntry, results, emit) => {
        const wear = results.wattWear;
        if (!wear) return false;
        for (const failure of wear.fails) emit(`  FAIL ${failure}`);
        if (wear.fails.length) return true;
        emit(`  ok   watt wear:${wear.star ? ` the star at ${wear.star} inside his sprite${wear.menu ? ', with his menu open' : ''}` : ''}${wear.cup ? ' the headphones on his head' : ''}${wear.bow ? ` the bow at ${wear.bow} clear of the cup` : ''}`);
        return false;
      },
    },
    breaks: {
      // The star moved 300 px off him; the star hidden while his menu is open; the cup lifted 200 px off his head; the bow
      // drawn over the cup's place (moved back onto it).
      'watt-star': { css: '.watt-prop-star { translate: 300px 0 !important; }', expect: /^ *FAIL watt wear: the star at .* is not inside his sprite/m, appliesTo: (v) => v.name === 'Watt wears the star, standing' },
      'watt-star-menu': { css: '.watt-prop-star { display: none !important; }', expect: /^ *FAIL watt wear: the star is not drawn while his menu is open/m, appliesTo: (v) => v.name === 'Watt wears the star, menu open' },
      'watt-cup': { css: '.watt-prop-headphones { translate: 0 -200px !important; }', expect: /^ *FAIL watt wear: the headphones at .* are not on his head/m, appliesTo: (v) => v.name === 'Watt wears the star and the headphones' },
      'watt-bow': { css: '.watt-prop-bow { translate: 24px 0 !important; }', expect: /^ *FAIL watt wear: the bow at .* is hidden by or off his head/m, appliesTo: (v) => v.name === 'Watt wears the bow and the headphones' },
    },
  },
};
