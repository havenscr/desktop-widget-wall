// "Jump back in" on Work: the For you page offers the last playlist the wall's own player played, with one Play, only
// while nothing plays. It is not a thing waiting: it never counts, never makes the chip, never takes the row. Gallery states and fit variants for the card shown, hidden by a video, hidden when nothing is
// known and hidden while something plays; one in-page measurement, its rules and a deliberate break. The knob `wjump=`
// is in `devMocks/watch.ts`; the mock frame never loads a real player (`watch=mock`).

const AT = encodeURIComponent('2026-11-11T16:10:00-08:00');
const BASE = `hz=work&at=${AT}&long=1&keys=typical&meet=none&net=calm&media=none&watch=mock&wlist=three`;
const q = (extra) => `${BASE}&hold=foryou&${extra}`;
const WALL = ['.work .right-wing', '.work .right-wing .fy-list', '.work .right-wing .fy-li'];

// [name, knobs, gallery expect, plates wanted, chip label wanted (null: no chip), the page is For you]
// `agents=3` leaves one thing waiting (a pull request), `agents=ask` two. Nothing waiting (no page, no plate, no chip) is a unit test: the mock always leaves one thing.
const states = [
  ['beside one waiting item', 'agents=3&wjump=playlist', ['Night Drive', 'jump back in', 'Play', 'Now · For you'], 1, null],
  ['with two waiting items, a narrow third plate', 'agents=ask&wjump=playlist', ['Play', 'Now · For you', '!jump back in'], 1, null],
  ['the last thing was a video, no plate', 'agents=3&wjump=video', ['!Night Drive', '!jump back in'], 0, null],
  ['nothing known, no plate', 'agents=3&wjump=none', ['!jump back in'], 0, null],
  ['something plays, no plate', 'agents=3&wjump=playlist&wplay=0', ['!jump back in'], 0, null],
  ['Recording page, the chip counts the waiting item only', 'agents=3&wjump=playlist&rec=1', ['Recording', 'For you 1', '!jump back in'], 0, 'For you 1'],
];

// Runs in the page: the "Jump back in" plates, whether each holds its parts inside its box, the list's box, and the chip labels.
function measureJump() {
  const plates = [...document.querySelectorAll('.work .right-wing .fy-li')].filter((p) => p.getAttribute('data-fy') === 'resume');
  const list = document.querySelector('.work .right-wing .fy-list');
  const inside = (a, b) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
  return {
    plates: plates.length,
    parts: plates.map((p) => {
      const box = p.getBoundingClientRect();
      const btn = p.querySelector('button');
      const b = p.querySelector('.fy-tx b');
      return {
        play: !!btn && /^Play$/.test((btn.textContent || '').trim()) && inside(btn.getBoundingClientRect(), box),
        // The narrow plate keeps only its icon and Play; the wide one its title and reason too.
        words: p.classList.contains('fy-compact') || (!!b && (b.textContent || '').trim() === 'Night Drive' && !!p.querySelector('.fy-tx em') && inside(b.getBoundingClientRect(), box)),
        inList: !!list && inside(box, list.getBoundingClientRect()),
      };
    }),
    chips: [...document.querySelectorAll('.work .right-wing .deck-chip')].map((c) => c.getAttribute('aria-label') || ''),
  };
}

const V = (n) => `Jump back in, ${n}`;
const find = (variant) => states.find((st) => V(st[0]) === variant.name);

export default {
  name: 'jump-back-in',
  gallery: { states: states.map(([n, k, expect]) => ({ screen: 'work', name: `jump back in: ${n}`, query: q(k), custom: true, expect })) },
  fit: {
    variants: states.map(([n, k, , want]) => ({
      name: V(n),
      q: `?${q(k)}`,
      checks: want > 0 ? [...WALL] : ['.work .right-wing .keys'],
    })),
    measurements: { jumpBack: measureJump },
    rules: {
      jumpBack: (variant, results, emit) => {
        const st = find(variant);
        if (!st) return false;
        const [, , , want, chip] = st;
        const r = results.jumpBack;
        const parts = r.parts.every((p) => p.play && p.words && p.inList);
        const chipOk = chip === null ? r.chips.length === 0 : r.chips.length === 1 && r.chips[0] === chip;
        if (r.plates === want && parts && chipOk) {
          emit(`  ok   jump back in: ${want ? 'one plate with its parts inside it' : 'no plate'}, ${chip === null ? 'no chip' : `the chip says "${chip}"`}`);
          return false;
        }
        emit(`  FAIL jump back in: the offer is wrong (${r.plates} plates, wanted ${want}; ${JSON.stringify(r.parts)}; chips ${JSON.stringify(r.chips)}, wanted ${JSON.stringify(chip)})`);
        return true;
      },
    },
    breaks: {
      'jump-back-play': {
        css: '.work .right-wing .fy-li .deck-mini { display: none !important; }',
        expect: /^ *FAIL jump back in: the offer is wrong/m,
        appliesTo: (variant) => variant.name === V('beside one waiting item'),
      },
    },
  },
};
