// Calendar events take their Outlook category colour on the ribbon and in the Day drawer.
// Gallery: a day with five invented categories and one uncategorised event (ribbon and drawer), an account
// without the colour permission (Tools row), and all 25 presets on one sheet in each state (next, under the needle
// with the rest past, and every chip past).
// Fit: every text on a coloured chip or tile (the title, the time line, the Join button) keeps at least 4.5 to 1
// against its own fill, on the darkest and the lightest ground the strip can sit on.
const q = (at, meet, extra = '') => `hz=work&at=${encodeURIComponent(at)}&clock=review&weather=ok&meet=${meet}${extra}`;
const MORNING = '2026-11-11T06:05:00-08:00';
const TYPICAL = '2026-11-11T10:24:00-08:00';
const NIGHT = '2026-11-11T23:30:00-08:00';

// Runs in the page. Each coloured chip or tile, with its own text colour and fill, and the text inside it.
function measureTones() {
  const parse = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return null;
    const p = m[1].split(',').map((v) => parseFloat(v));
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  // The opacity an element is drawn at: its own times every ancestor's.
  const opacity = (el) => {
    let o = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity);
    return o;
  };
  const out = [];
  for (const el of document.querySelectorAll('.rib .ev[data-tone], .dd-ev[data-tone]')) {
    const where = el.classList.contains('dd-ev') ? 'drawer' : 'ribbon';
    const cs = getComputedStyle(el);
    const fill = parse(cs.backgroundColor);
    const texts = [{ part: 'title', color: parse(cs.color), own: opacity(el) }];
    for (const [part, sel] of [['time', '.dd-t'], ['join', '.dd-join']]) {
      const child = el.querySelector(sel);
      if (!child) continue;
      const ccs = getComputedStyle(child);
      const wash = part === 'join' ? parse(ccs.backgroundColor) : null;
      texts.push({ part, color: parse(ccs.color), own: opacity(child), wash });
    }
    out.push({ where, tone: el.getAttribute('data-tone'), state: [...el.classList].find((c) => ['past', 'now', 'next'].includes(c)) ?? '', fill, texts });
  }
  return out;
}

// The ground under a chip: the ribbon's night sky under its dark wash (darkest stop, and the sunrise glow at the chip row), and the drawer's panel.
const GROUNDS = { ribbon: [[9, 7, 30], [84, 52, 48]], drawer: [[14, 11, 34]] };
const FLOOR = 4.5;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const lum = (c) => {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const ratio = (a, b) => {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

export default {
  name: 'category-colours',
  gallery: {
    states: [
      { screen: 'work', name: 'Category colours: the ribbon, five categories and an uncategorised event', query: q(TYPICAL, 'cats'), custom: true, expect: 'Inbox time' },
      { screen: 'work', name: 'Category colours: the Day drawer', query: q(TYPICAL, 'cats'), custom: true, actions: '.rib-handle', expect: 'Customer call' },
      { screen: 'work', name: 'Category colours: a category on hover', query: q(TYPICAL, 'cats'), custom: true, actions: 'hover:.rib .ev[data-tone="preset0"]', expect: 'Category: Sample projects' },
      { screen: 'work', name: 'Category colours: an account without the permission', query: q(TYPICAL, 'nocolours', '&tools=1'), custom: true, expect: 'Outlook colours off' },
      { screen: 'work', name: 'Category colours: all 25 presets, upcoming', query: q(MORNING, 'tones'), custom: true, expect: '24 DarkCranberry' },
      { screen: 'work', name: 'Category colours: all 25 presets, one under the needle', query: q(TYPICAL, 'tones'), custom: true, expect: '24 DarkCranberry' },
      { screen: 'work', name: 'Category colours: all 25 presets, all past', query: q(NIGHT, 'tones'), custom: true, expect: '24 DarkCranberry' },
      { screen: 'work', name: 'Category colours: all 25 presets in the Day drawer', query: q(TYPICAL, 'tones'), custom: true, actions: '.rib-handle', expect: '0 Red' },
    ],
  },
  fit: {
    variants: [
      { name: 'Category colours, ribbon and drawer', q: '?' + q(TYPICAL, 'tones'), click: '.rib-handle', checks: ['.day-drawer'], strip: true, viewportOnly: true },
      { name: 'Category colours, five categories', q: '?' + q(TYPICAL, 'cats'), click: '.rib-handle', checks: ['.day-drawer'], strip: true, viewportOnly: true },
    ],
    measurements: { categoryTones: measureTones },
    rules: {
      categoryTones: (variant, results, emit) => {
        if (!variant.name.startsWith('Category colours')) return false;
        const tiles = results.categoryTones;
        if (!Array.isArray(tiles) || tiles.length === 0) {
          emit('  FAIL category colours: no coloured chip or tile on the strip');
          return true;
        }
        let low = Infinity;
        let worst = '';
        let bad = 0;
        let texts = 0;
        for (const t of tiles) {
          for (const x of t.texts) {
            texts += 1;
            for (const ground of GROUNDS[t.where]) {
              // The fill over the ground, a button's own wash over that, the text over that; the tile's opacity then fades the whole group into the ground.
              const tileOpacity = t.texts[0].own;
              const ownOpacity = tileOpacity > 0 ? x.own / tileOpacity : 0;
              const fillComp = mix(ground, t.fill.slice(0, 3), t.fill[3]);
              const under = x.wash ? mix(fillComp, x.wash.slice(0, 3), x.wash[3]) : fillComp;
              const bg = mix(ground, under, tileOpacity);
              const fg = mix(ground, mix(under, x.color.slice(0, 3), x.color[3] * ownOpacity), tileOpacity);
              const r = ratio(fg, bg);
              if (r < low) {
                low = r;
                worst = `${t.where} ${t.tone} ${t.state} ${x.part}`;
              }
              if (r < FLOOR) bad += 1;
            }
          }
        }
        if (bad === 0) {
          emit(`  ok   category colours: ${tiles.length} coloured chips and tiles, ${texts} texts, lowest contrast ${low.toFixed(2)} to 1 (floor ${FLOOR})`);
          return false;
        }
        emit(`  FAIL category colours: ${bad} text(s) under ${FLOOR} to 1 against their fill, lowest ${low.toFixed(2)} to 1 (${worst})`);
        return true;
      },
    },
    breaks: {
      'tone-contrast': {
        css: '.rib .ev[data-tone], .dd-ev[data-tone] { color: #6d6890 !important; }',
        expect: /^ *FAIL category colours: \d+ text\(s\) under 4\.5 to 1 against their fill/m,
        appliesTo: (variant) => variant.name === 'Category colours, ribbon and drawer',
      },
      'tone-fade': {
        css: '.rib .ev.past[data-tone], .dd-ev.past[data-tone] { opacity: 0.45 !important; }',
        expect: /^ *FAIL category colours: \d+ text\(s\) under 4\.5 to 1 against their fill/m,
        appliesTo: (variant) => variant.name === 'Category colours, five categories' || variant.name === 'Category colours, ribbon and drawer',
      },
    },
  },
};
