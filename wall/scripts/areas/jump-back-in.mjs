// "Jump back in" on Work: the For you page offers the last playlist the wall's own player played, with one Play, only
// while nothing plays. Gallery states and fit variants for the card shown, hidden by a video, hidden when nothing is
// known and hidden while something plays; one in-page measurement, its rules and a deliberate break. The knob `wjump=`
// is in `devMocks/watch.ts`; the mock frame never loads a real player (`watch=mock`).

const AT = encodeURIComponent('2026-11-11T16:10:00-08:00');
const BASE = `hz=work&at=${AT}&long=1&agents=3&keys=typical&hold=foryou&meet=none&net=calm&media=none&watch=mock&wlist=three`;
const q = (extra) => `${BASE}&${extra}`;
const WALL = ['.work .right-wing', '.work .right-wing .fy-list', '.work .right-wing .fy-li'];

const states = [
  ['the last playlist with one Play', 'wjump=playlist', ['Night Drive', 'jump back in', 'Play']],
  ['the last thing was a video, no card', 'wjump=video', ['!Night Drive', '!jump back in']],
  ['nothing known, no card', 'wjump=none', ['!jump back in']],
  ['something plays, no card', 'wjump=playlist&wplay=0', ['!jump back in']],
];

// Runs in the page: the "Jump back in" plates, whether each holds its title, reason and Play inside its box, and the list's box.
function measureJump() {
  const plates = [...document.querySelectorAll('.work .right-wing .fy-li')].filter((p) => /jump back in/i.test(p.textContent || ''));
  const inside = (a, b) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
  return {
    plates: plates.length,
    parts: plates.map((p) => {
      const box = p.getBoundingClientRect();
      const btn = p.querySelector('button');
      const b = p.querySelector('.fy-tx b');
      return {
        play: !!btn && /^Play$/.test((btn.textContent || '').trim()) && inside(btn.getBoundingClientRect(), box),
        title: !!b && (b.textContent || '').trim() === 'Night Drive' && b.getBoundingClientRect().width > 20,
        reason: !!p.querySelector('.fy-tx em') && inside(p.querySelector('.fy-tx em').getBoundingClientRect(), box),
      };
    }),
  };
}

const shown = (v) => /wjump=playlist/.test(v.q) && !/wplay=/.test(v.q);

export default {
  name: 'jump-back-in',
  gallery: { states: states.map(([n, k, expect]) => ({ screen: 'work', name: `jump back in: ${n}`, query: q(k), custom: true, expect })) },
  fit: {
    variants: states.map(([n, k]) => ({
      name: `Jump back in, ${n}`,
      q: `?${q(k)}`,
      checks: /wjump=playlist/.test(k) && !/wplay=/.test(k) ? [...WALL] : ['.work .right-wing'],
    })),
    measurements: { jumpBack: measureJump },
    rules: {
      jumpBack: (variant, results, emit) => {
        if (!variant.name.startsWith('Jump back in')) return false;
        const r = results.jumpBack;
        if (shown(variant)) {
          const bad = r.plates !== 1 || r.parts.some((p) => !p.play || !p.title || !p.reason);
          if (!bad) { emit('  ok   jump back in: one plate, its title, reason and Play inside it'); return false; }
          emit(`  FAIL jump back in: the offer is wrong (${r.plates} plates, ${JSON.stringify(r.parts)})`);
          return true;
        }
        if (r.plates === 0) { emit('  ok   jump back in: no plate when nothing is known, a video was last, or something plays'); return false; }
        emit(`  FAIL jump back in: a plate shows when it must not (${r.plates})`);
        return true;
      },
    },
    breaks: {
      'jump-back-play': {
        css: `.work .right-wing .fy-li .deck-mini { display: none !important; }`,
        expect: /^ *FAIL jump back in: the offer is wrong/m,
        appliesTo: (variant) => variant.name === 'Jump back in, the last playlist with one Play',
      },
    },
  },
};
