// "Jump back in" on Work: while nothing plays, the Now heading carries a mint Play button with the last playlist the wall's own player
// played, on every page. It is not a thing waiting: never a plate, never counted, never the For you chip or page, never a take-over.
// It shrinks to a 40 by 32 Play icon when the heading is tight. Gallery states and fit variants for the voted frames and the cases
// where no button shows; one in-page measurement, its rules and a deliberate break. The knob `wjump=` is in `devMocks/watch.ts`;
// the mock frame never loads a real player (`watch=mock`).

const AT = encodeURIComponent('2026-11-11T16:10:00-08:00');
const BASE = `hz=work&at=${AT}&keys=typical&net=calm&media=none&watch=mock&wlist=three`;
const HEAD = '.work .right-wing .keys .deck-hd';
const WALL = ['.work .right-wing', HEAD];

// [name, knobs, gallery expect, button wanted ('full' | 'icon' | null), chip label wanted (null: no chip), plates wanted]
// `agents=0` with `meet=none` leaves nothing waiting; `agents=3` leaves one thing (a pull request), `ask` two, `ask2` three.
const states = [
  ['nothing waits, the full button', 'meet=none&agents=0&wjump=playlist', ['Night Drive', 'Now · '], 'full', null, 0],
  ['one waits, the chip counts it only, the icon', 'meet=none&agents=3&hold=sales&wjump=playlist', ['For you 1'], 'icon', 'For you 1', 0],
  ['two wait, full-width plates and the full button', 'meet=none&agents=ask&hold=foryou&wjump=playlist', ['Night Drive', 'Now · For you'], 'full', null, 2],
  ['three wait, +1 more and the icon', 'meet=none&agents=ask2&hold=foryou&wjump=playlist', ['Now · For you · +1 more'], 'icon', null, 2],
  ['the last thing was a video, no button', 'meet=none&agents=0&wjump=video', ['!Night Drive'], null, null, 0],
  ['nothing known, no button', 'meet=none&agents=0&wjump=none', ['!Night Drive'], null, null, 0],
  ['something plays, no button', 'meet=none&agents=0&wjump=playlist&wplay=0', ['!Night Drive'], null, null, 0],
];

// Runs in the page: the heading's offer button (its kind and size), whether the heading holds everything inside the wing, the plates and the chip labels.
function measureJump() {
  const btns = [...document.querySelectorAll('.work .right-wing .deck-resume')];
  const wing = document.querySelector('.work .right-wing').getBoundingClientRect();
  const row = [...document.querySelectorAll('.work .right-wing .keys.deck-row')].pop();
  const hd = row?.querySelector('.deck-hd');
  const name = hd?.querySelector('.deck-name');
  const ctrl = hd?.querySelector('.deck-hd-r');
  // Every state runs this measurement; a state with no heading row or no controls on it (the keys.json problem page) has nothing to measure here, and the rule only reads this for the states it owns.
  if (!hd || !ctrl) return { missingHeading: true, buttons: btns.length };
  const hr = hd.getBoundingClientRect();
  const cr = ctrl.getBoundingClientRect();
  const plates = [...document.querySelectorAll('.work .right-wing .fy-li')];
  const list = document.querySelector('.work .right-wing .fy-list');
  const half = list ? (list.getBoundingClientRect().width - 8) / 2 : 0;
  const b = btns[0] ? btns[0].getBoundingClientRect() : null;
  return {
    buttons: btns.length,
    kind: !b ? null : btns[0].classList.contains('ico') ? 'icon' : 'full',
    size: b ? [Math.round(b.width), Math.round(b.height)] : null,
    inWing: cr.right <= wing.right + 0.5 && hr.right <= wing.right + 0.5,
    nameWhole: !!name && name.scrollWidth <= name.clientWidth + 1,
    plates: plates.length,
    fullWidth: plates.every((p) => Math.abs(p.getBoundingClientRect().width - half) <= 1),
    resumePlates: plates.filter((p) => p.getAttribute('data-fy') === 'resume').length,
    chips: [...document.querySelectorAll('.work .right-wing .deck-chip')].map((c) => c.getAttribute('aria-label') || ''),
  };
}

const V = (n) => `Jump back in, ${n}`;
const find = (variant) => states.find((st) => V(st[0]) === variant.name);

export default {
  name: 'jump-back-in',
  gallery: { states: states.map(([n, k, expect]) => ({ screen: 'work', name: `jump back in: ${n}`, query: `${BASE}&${k}`, custom: true, expect })) },
  fit: {
    variants: states.map(([n, k]) => ({ name: V(n), q: `?${BASE}&${k}`, checks: [...WALL] })),
    measurements: { jumpBack: measureJump },
    rules: {
      jumpBack: (variant, results, emit) => {
        const st = find(variant);
        if (!st) return false;
        const [, , , want, chip, plates] = st;
        const r = results.jumpBack;
        const kindOk = want === null ? r.buttons === 0 : r.buttons === 1 && r.kind === want && r.size[1] === 32 && r.size[0] === (want === 'icon' ? 40 : r.size[0]);
        const chipOk = chip === null ? r.chips.length === 0 : r.chips.length === 1 && r.chips[0] === chip;
        if (kindOk && chipOk && r.inWing && r.nameWhole && r.plates === plates && r.fullWidth && r.resumePlates === 0) {
          emit(`  ok   jump back in: ${want ? `the ${want} button` : 'no button'}, ${chip === null ? 'no chip' : `the chip says "${chip}"`}, ${plates} full-width plates, the heading inside the wing`);
          return false;
        }
        emit(`  FAIL jump back in: the offer is wrong (${JSON.stringify(r)}; wanted ${want ?? 'no'} button, chip ${JSON.stringify(chip)}, ${plates} plates)`);
        return true;
      },
    },
    breaks: {
      'jump-back-button': {
        css: '.work .right-wing .deck-resume { display: none !important; }',
        expect: /^ *FAIL jump back in: the offer is wrong/m,
        appliesTo: (variant) => variant.name === V('nothing waits, the full button'),
      },
    },
  },
};
