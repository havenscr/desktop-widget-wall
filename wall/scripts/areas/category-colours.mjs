// Calendar events take their Outlook category colour on the ribbon and in the Day drawer.
// Gallery: a day with five invented categories and one uncategorised event (ribbon and drawer), an account
// without the colour permission (Tools row), and all 25 presets on one sheet in each state (next, under the needle
// with the rest past, and every chip past).
// Fit: every text on a chip or tile, coloured or plain, past or not (the title, the time line, the Join button),
// keeps at least 4.5 to 1 against its own fill, on the darkest and the lightest ground the strip can sit on, and
// again at the hover lift. A coloured chip has its 6 px bar, a livestream with a category its dot, Day drawer tiles
// never overlap and carry text of 16 px or more with nothing cut, the now line never crosses a tile's text, and the
// Tools line of an account without the permission is never cut.
const q = (at, meet, extra = '') => `hz=work&at=${encodeURIComponent(at)}&clock=review&weather=ok&meet=${meet}${extra}`;
const MORNING = '2026-11-11T06:05:00-08:00';
const TYPICAL = '2026-11-11T10:24:00-08:00';
const NIGHT = '2026-11-11T23:30:00-08:00';

// Runs in the page. Each chip or tile (coloured, plain, livestream, folded), with its own text colour and fill, and the text inside it.
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
  for (const el of document.querySelectorAll('.rib .ev:not(.more):not(.allday), .rib .ev-side, .dd-ev')) {
    const where = el.classList.contains('dd-ev') ? 'drawer' : 'ribbon';
    const cs = getComputedStyle(el);
    const fill = parse(cs.backgroundColor);
    const texts = [{ part: 'title', color: parse(cs.color), own: opacity(el) }];
    for (const [part, sel] of [['time', '.dd-t'], ['join', '.dd-join'], ['count', '.fold-n'], ['fold', '.fold-t']]) {
      const child = el.querySelector(sel);
      if (!child) continue;
      const ccs = getComputedStyle(child);
      const wash = part === 'join' ? parse(ccs.backgroundColor) : null;
      texts.push({ part, color: parse(ccs.color), own: opacity(child), wash });
    }
    const kind = el.classList.contains('ev-side') ? 'side' : el.hasAttribute('data-tone') ? 'coloured' : el.classList.contains('live') ? 'live' : el.classList.contains('fold') ? 'fold' : 'plain';
    out.push({
      where, kind, tone: el.getAttribute('data-tone') ?? '', open: el.classList.contains('open'),
      state: [...el.classList].find((c) => ['past', 'now', 'next'].includes(c)) ?? '', fill, texts,
    });
  }
  return out;
}

// Runs in the page. The look of the votes: each coloured chip or tile's bar, each livestream's dot, and the plain past chips' opacity.
function measureLook() {
  const out = { noBar: [], noDot: [], faded: [] };
  for (const el of document.querySelectorAll('.rib .ev[data-tone], .dd-ev[data-tone]')) {
    const sh = getComputedStyle(el).boxShadow;
    if (!/inset/.test(sh) || !/\b6px\b/.test(sh) || /, 0\)/.test(sh)) out.noBar.push(el.getAttribute('data-tone') + ' ' + sh.slice(0, 60));
  }
  for (const el of document.querySelectorAll('.rib .ev.live[data-dot], .dd-ev.live[data-dot]')) {
    const host = el.classList.contains('dd-ev') ? el.querySelector('b') : el;
    const cs = getComputedStyle(host, '::before');
    if (cs.display === 'none' || cs.content === 'none' || parseFloat(cs.width) !== 10 || parseFloat(cs.height) !== 10 || /rgba\([^)]*,\s*0\)|transparent/.test(cs.backgroundColor)) out.noDot.push((el.textContent || '').trim().slice(0, 30));
  }
  for (const el of document.querySelectorAll('.rib .ev.past:not([data-tone]), .dd-ev.past:not([data-tone])')) {
    if (parseFloat(getComputedStyle(el).opacity) < 1) out.faded.push((el.textContent || '').trim().slice(0, 30));
  }
  return out;
}

// Runs in the page. The Day drawer's tiles: their boxes, their text sizes, anything cut, the now line's pieces and the text it could cross.
function measureTiles() {
  const tiles = [...document.querySelectorAll('.dd-ev')];
  const label = (e) => (e.querySelector('b')?.textContent || '').trim();
  const rects = tiles.map((e) => ({ name: label(e), r: e.getBoundingClientRect() }));
  const overlaps = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i].r;
      const b = rects[j].r;
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5) overlaps.push(rects[i].name + ' / ' + rects[j].name);
    }
  }
  const small = [];
  const cut = [];
  const texts = [];
  for (const e of tiles) {
    for (const [part, sel] of [['title', 'b'], ['time', '.dd-t'], ['join', '.dd-join']]) {
      const n = e.querySelector(sel);
      if (!n) continue;
      const px = parseFloat(getComputedStyle(n).fontSize);
      if (px < 16 - 0.01) small.push(label(e) + ' ' + part + ' ' + px + ' px');
      if (n.scrollWidth > n.clientWidth + 1) cut.push(label(e) + ' ' + part + ' is cut sideways');
      const range = document.createRange();
      range.selectNodeContents(n);
      const rr = range.getBoundingClientRect();
      texts.push({ name: label(e), part, r: part === 'join' ? n.getBoundingClientRect() : rr });
      const tr = e.getBoundingClientRect();
      if (rr.bottom > tr.bottom + 0.5 || rr.top < tr.top - 0.5) cut.push(label(e) + ' ' + part + ' is cut at the tile edge');
    }
  }
  const crossed = [];
  const lines = [...document.querySelectorAll('.dd-now')].map((n) => n.getBoundingClientRect());
  for (const l of lines) {
    for (const t of texts) {
      if (Math.min(l.right, t.r.right) - Math.max(l.left, t.r.left) > 0.5 && Math.min(l.bottom, t.r.bottom) - Math.max(l.top, t.r.top) > 0.5) crossed.push(t.name + ' ' + t.part);
    }
  }
  return { count: tiles.length, overlaps, small, cut, crossed, pieces: lines.length };
}

// Runs in the page. Every Tools line, and whether its text fits whole (a row's hover card does not excuse a cut line).
function measureToolsLines() {
  return [...document.querySelectorAll('.tools-line')].map((e) => ({ text: (e.textContent || '').trim(), cut: e.scrollWidth > e.clientWidth + 1, room: Math.round(e.clientWidth) }));
}

// The ground under a chip: the ribbon's night sky under its dark wash (darkest stop, and the sunrise glow at the chip row), and the drawer's panel.
const GROUNDS = { ribbon: [[9, 7, 30], [84, 52, 48]], drawer: [[14, 11, 34]] };
const FLOOR = 4.5;
const HOVER = 1.15;
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
      { screen: 'work', name: 'Category colours: an account without the permission', query: q(TYPICAL, 'nocolours', '&tools=1'), custom: true, expect: 'No colours yet' },
      { screen: 'work', name: 'Category colours: plain and coloured side by side, past, Join and a livestream (Day drawer)', query: q(TYPICAL, 'catsplain'), custom: true, actions: '.rib-handle', expect: 'Vendor call' },
      { screen: 'work', name: 'Category colours: plain and coloured side by side (ribbon)', query: q(TYPICAL, 'catsplain'), custom: true, expect: 'Vendor call' },
      { screen: 'work', name: 'Category colours: the Tools row hovered', query: q(TYPICAL, 'nocolours', '&tools=1'), custom: true, actions: 'hover:.tools-acct', expect: 'Sign in again to show Outlook colours' },
      { screen: 'work', name: 'Category colours: short events, a short livestream with a category and the now line (Day drawer)', query: q(TYPICAL, 'catsshort'), custom: true, actions: '.rib-handle', expect: 'Quick check' },
      { screen: 'work', name: 'Category colours: short events and a livestream with a category (ribbon)', query: q(TYPICAL, 'catsshort'), custom: true, expect: 'Quick check' },
      { screen: 'work', name: 'Category colours: all 25 presets, upcoming', query: q(MORNING, 'tones'), custom: true, expect: '24 DarkCranberry' },
      { screen: 'work', name: 'Category colours: all 25 presets, one under the needle', query: q(TYPICAL, 'tones'), custom: true, expect: '24 DarkCranberry' },
      { screen: 'work', name: 'Category colours: all 25 presets, all past', query: q(NIGHT, 'tones'), custom: true, expect: '24 DarkCranberry' },
      { screen: 'work', name: 'Category colours: all 25 presets in the Day drawer', query: q(TYPICAL, 'tones'), custom: true, actions: '.rib-handle', expect: '0 Red' },
    ],
  },
  fit: {
    variants: [
      { name: 'Category colours, ribbon and drawer', q: '?' + q(TYPICAL, 'tones'), click: '.rib-handle', checks: ['.day-drawer'], strip: true, viewportOnly: true },
      { name: 'Category colours, plain beside coloured', q: '?' + q(TYPICAL, 'catsplain'), click: '.rib-handle', checks: ['.day-drawer'], strip: true, viewportOnly: true },
      { name: 'Category colours, five categories', q: '?' + q(TYPICAL, 'cats'), click: '.rib-handle', checks: ['.day-drawer'], strip: true, viewportOnly: true },
      { name: 'Category colours, short events and the now line', q: '?' + q(TYPICAL, 'catsshort'), click: '.rib-handle', checks: ['.day-drawer'], strip: true, viewportOnly: true },
      { name: 'Category colours, short events, time under way at the start', q: '?' + q('2026-11-11T10:00:30-08:00', 'catsshort'), click: '.rib-handle', checks: ['.day-drawer'], strip: true, viewportOnly: true },
      { name: 'Category colours, Tools row without the permission', q: '?' + q(TYPICAL, 'nocolours', '&tools=1'), checks: ['.tools-drawer'], viewportOnly: true },
    ],
    measurements: { categoryTones: measureTones, categoryLook: measureLook, categoryTiles: measureTiles, categoryToolsLines: measureToolsLines },
    rules: {
      categoryTones: (variant, results, emit) => {
        if (!variant.name.startsWith('Category colours') || variant.name.includes('Tools row')) return false;
        const tiles = results.categoryTones;
        if (!Array.isArray(tiles) || tiles.length === 0) {
          emit('  FAIL category colours: no chip or tile on the strip');
          return true;
        }
        let low = Infinity;
        let worst = '';
        let bad = 0;
        let texts = 0;
        for (const t of tiles) {
          // A chip that opens its event is also read lifted by the hover brightness (fill and text scaled, then over the ground).
          for (const lift of t.open ? [1, HOVER] : [1]) {
            const scale = (c) => [Math.min(255, c[0] * lift), Math.min(255, c[1] * lift), Math.min(255, c[2] * lift), c[3]];
            for (const x of t.texts) {
              texts += 1;
              for (const ground of GROUNDS[t.where]) {
                // The fill over the ground, a button's own wash over that, the text over that; the tile's opacity then fades the whole group into the ground.
                const tileOpacity = t.texts[0].own;
                const ownOpacity = tileOpacity > 0 ? x.own / tileOpacity : 0;
                const fillComp = mix(ground, scale(t.fill).slice(0, 3), t.fill[3]);
                const under = x.wash ? mix(fillComp, x.wash.slice(0, 3), x.wash[3]) : fillComp;
                const color = scale(x.color);
                const bg = mix(ground, under, tileOpacity);
                const fg = mix(ground, mix(under, color.slice(0, 3), color[3] * ownOpacity), tileOpacity);
                const r = ratio(fg, bg);
                if (r < low) {
                  low = r;
                  worst = `${t.where} ${t.kind} ${t.tone} ${t.state} ${x.part}${lift > 1 ? ' hovered' : ''}`;
                }
                if (r < FLOOR) bad += 1;
              }
            }
          }
        }
        if (bad === 0) {
          emit(`  ok   category colours: ${tiles.length} chips and tiles (coloured, plain, livestream), ${texts} texts, lowest contrast ${low.toFixed(2)} to 1 (floor ${FLOOR})`);
          return false;
        }
        emit(`  FAIL category colours: ${bad} text(s) under ${FLOOR} to 1 against their fill, lowest ${low.toFixed(2)} to 1 (${worst})`);
        return true;
      },
      categoryLook: (variant, results, emit) => {
        if (!variant.name.startsWith('Category colours') || variant.name.includes('Tools row')) return false;
        const m = results.categoryLook;
        let bad = false;
        if (m.noBar.length > 0) {
          emit(`  FAIL category colours: ${m.noBar.length} coloured chip(s) or tile(s) without the 6 px bar (${m.noBar[0]})`);
          bad = true;
        }
        if (m.noDot.length > 0) {
          emit(`  FAIL category colours: a livestream with a category has no 10 px dot (${m.noDot.join(', ')})`);
          bad = true;
        }
        if (m.faded.length > 0) {
          emit(`  FAIL category colours: a plain past chip is faded as a whole, not grey (${m.faded.join(', ')})`);
          bad = true;
        }
        if (!bad) emit('  ok   category colours: every coloured chip has its bar, every livestream with a category its dot, no past chip is faded');
        return bad;
      },
      categoryTiles: (variant, results, emit) => {
        if (!variant.name.startsWith('Category colours') || variant.name.includes('Tools row')) return false;
        const m = results.categoryTiles;
        if (!m || m.count === 0) return false;
        let bad = false;
        if (m.overlaps.length > 0) {
          emit(`  FAIL category colours: Day drawer tiles overlap: ${m.overlaps.join('; ')}`);
          bad = true;
        }
        if (m.small.length > 0) {
          emit(`  FAIL category colours: Day drawer text under 16 px: ${m.small.join('; ')}`);
          bad = true;
        }
        if (m.cut.length > 0) {
          emit(`  FAIL category colours: Day drawer text cut: ${m.cut.join('; ')}`);
          bad = true;
        }
        if (m.crossed.length > 0) {
          emit(`  FAIL category colours: the now line crosses the text of ${m.crossed.join('; ')}`);
          bad = true;
        }
        if (!bad) emit(`  ok   category colours: ${m.count} Day drawer tiles, none overlapping, text 16 px or more and whole, the now line in ${m.pieces} piece(s) clear of every text`);
        return bad;
      },
      categoryToolsLine: (variant, results, emit) => {
        if (!variant.name.includes('Tools row')) return false;
        const lines = results.categoryToolsLines ?? [];
        const mine = lines.filter((l) => l.text === 'No colours yet');
        if (mine.length === 0) {
          emit('  FAIL category colours: no Tools row says "No colours yet"');
          return true;
        }
        const cut = lines.filter((l) => l.cut);
        if (cut.length > 0) {
          emit(`  FAIL category colours: a Tools line is cut, even with its hover card: ${cut.map((l) => `"${l.text}" in ${l.room} px`).join('; ')}`);
          return true;
        }
        emit(`  ok   category colours: "No colours yet" fits its Tools row whole (${mine[0].room} px), no Tools line cut`);
        return false;
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
      'tone-plain-past': {
        css: '.rib .ev.past:not([data-tone]), .dd-ev.past:not([data-tone]) { opacity: 0.45 !important; }',
        expect: /^ *FAIL category colours: \d+ text\(s\) under 4\.5 to 1 against their fill/m,
        appliesTo: (variant) => variant.name === 'Category colours, plain beside coloured',
      },
      'tone-nobar': {
        css: '.rib .ev[data-tone], .dd-ev[data-tone] { box-shadow: none !important; }',
        expect: /^ *FAIL category colours: \d+ coloured chip\(s\) or tile\(s\) without the 6 px bar/m,
        appliesTo: (variant) => variant.name === 'Category colours, five categories',
      },
      'tone-nodot': {
        css: '.rib .ev.live[data-dot]::before, .dd-ev.live[data-dot] b::before { display: none !important; }',
        expect: /^ *FAIL category colours: a livestream with a category has no 10 px dot/m,
        appliesTo: (variant) => variant.name === 'Category colours, short events and the now line',
      },
      'tone-overlap': {
        css: '.dd-ev { left: 2px !important; width: calc(100% - 6px) !important; }',
        expect: /^ *FAIL category colours: Day drawer tiles overlap/m,
        appliesTo: (variant) => variant.name === 'Category colours, short events and the now line',
      },
      'tone-small': {
        css: '.dd-ev .dd-t { font-size: 13px !important; }',
        expect: /^ *FAIL category colours: Day drawer text under 16 px/m,
        appliesTo: (variant) => variant.name === 'Category colours, five categories',
      },
      'tone-nowline': {
        css: '.dd-now { left: -8px !important; right: 0 !important; }',
        expect: /^ *FAIL category colours: the now line crosses the text of/m,
        appliesTo: (variant) => variant.name === 'Category colours, five categories',
      },
      'tone-toolsline': {
        css: '.tools-line { max-width: 60px !important; }',
        expect: /^ *FAIL category colours: a Tools line is cut, even with its hover card/m,
        appliesTo: (variant) => variant.name.includes('Tools row'),
      },
    },
  },
};
