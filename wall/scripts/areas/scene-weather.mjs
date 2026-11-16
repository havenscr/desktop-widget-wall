// Weather in the scene: rain and wind on the mountains and on Watt, and the Tools switch. The unit tests hold the
// drawing calls, the ramps and the caches; these states show the drawn wall, and the rules hold what only the real
// page can: nothing falls over the Watch film, and the Tools block fits its column. One area file, so the two big
// review scripts are not edited. Every state comes from the dev knobs `?weather=`, `?wxt=`, `?wattwx=` and `?reduced=`.

const at = (h, m = 0) => encodeURIComponent(`2026-11-11T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-08:00`);
const EVE = at(19, 30);
const DAY = at(13);
const DUSK = at(16, 25);
const NIGHT = at(22, 40);
const NOON = at(12);
const NOTE = 'the weather is drawn pixels, not text; the unit tests hold its calls and the rules below hold the film box and the Tools block';

const unwind = (when, knobs) => `hz=unwind&at=${when}&clock=review&meet=none&${knobs}`;
const state = (screen, name, query, extra = {}) => ({ screen, name, query, custom: true, expectNote: NOTE, ...extra });

const WATCH = 'watch=mock&wlist=three&wlook=sky&wplay=0';
const fit = (when, knobs) => `?hz=unwind&at=${when}&clock=review&meet=none&long=1&agents=3&${knobs}`;
const toolsFit = (knobs) => `?hz=work&at=${at(10, 24)}&clock=review&agents=3&tools=1&${knobs}`;

// Runs in the page. With a weather knob on Watch: the front canvas holds the layer's streaks (pale blue, 1 px, a
// few percent opaque on transparency); none of them may lie inside the film's box (shrunk by 12 px, since the
// layer keeps 8 px clear and a streak may pass a corner). In Tools: the Weather block sits in the drawer's top
// row between the title and the close button, overlaps neither, keeps the drawer inside the wall, and no text in it
// is under 16 px (the 15 px section heading is the drawer's own).
function measureWeather() {
  const out = { film: null, tools: null };
  const params = new URLSearchParams(location.search);
  const stage = document.querySelector('.w-stage[data-sky-box]');
  const front = document.querySelector('canvas.horizon-front');
  if (params.get('weather') && stage && front) {
    const [x, y, w, h] = stage.getAttribute('data-sky-box').split(',').map(Number);
    const sc = front.width / 2560;
    const m = 12;
    const inner = { x: Math.round((x + m) * sc), y: Math.round((y + m) * sc), w: Math.round((w - 2 * m) * sc), h: Math.round((h - 2 * m) * sc) };
    const d = front.getContext('2d').getImageData(inner.x, inner.y, inner.w, inner.h).data;
    let streak = 0;
    let drawn = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      drawn++;
      if (Math.abs(d[i] - 175) < 30 && Math.abs(d[i + 1] - 215) < 30 && Math.abs(d[i + 2] - 250) < 30 && d[i + 3] < 120 && d[i + 3] >= 24) streak++;
    }
    out.film = { box: [x, y, w, h].map(Math.round).join(','), streak, drawn };
  }
  const drawer = document.querySelector('.tools-drawer');
  const block = document.querySelector('.tools-weather');
  if (drawer && block) {
    const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    const top = block.parentElement;
    const kids = [...top.children].map((e) => ({ n: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 14), ...R(e) }));
    const small = [];
    for (const e of [block, ...block.querySelectorAll('*')]) {
      if (!e.matches || e.classList.contains('tools-k')) continue; // the section headings are the drawer's own 15 px caps
      if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const px = parseFloat(getComputedStyle(e).fontSize);
      if (px < 15.99) small.push('"' + e.textContent.trim().slice(0, 30) + '" is ' + px + ' px');
    }
    const cut = [...block.querySelectorAll('.tools-hint, .tools-chip')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim());
    out.tools = {
      kids,
      block: R(block),
      drawer: R(drawer),
      small,
      cut,
      inTop: !!top.classList.contains('tools-top'),
      chips: [...block.querySelectorAll('.tools-chip')].map((c) => c.getBoundingClientRect().height),
    };
  }
  return out;
}

const r1 = (n) => Math.round(n * 10) / 10;
const FILM_V = 'Scene weather, Watch with heavy rain';
const TOOLS_V = 'Scene weather, Tools with the switch';

export default {
  name: 'scene-weather',
  gallery: {
    states: [
      state('unwind', 'scene weather: Unwind light rain', unwind(EVE, 'weather=rain')),
      state('unwind', 'scene weather: Unwind heavy rain', unwind(EVE, 'weather=heavy')),
      state('unwind', 'scene weather: rain while the lines dance', unwind(EVE, 'weather=rain&audio=demo')),
      state('unwind', 'scene weather: daytime rain', unwind(DAY, 'weather=rain')),
      state('unwind', 'scene weather: dusk rain', unwind(DUSK, 'weather=rain')),
      state('unwind', 'scene weather: night rain at half strength, Watt asleep and damp', unwind(NIGHT, 'weather=rain')),
      state('work', 'scene weather: Work with rain', `hz=work&at=${NOON}&clock=review&meet=none&weather=rain`),
      state('home', 'scene weather: Home with rain', `hz=home&at=${EVE}&clock=review&meet=none&weather=rain`),
      { screen: 'unwind', name: 'scene weather: Watch with rain, nothing over the film', query: unwind(EVE, `weather=heavy&${WATCH}`), custom: true, expect: ['Night drive mix'] },
      state('unwind', 'scene weather: dry wind', unwind(DAY, 'weather=wind')),
      state('unwind', 'scene weather: rain with wind', unwind(EVE, 'weather=rainwind')),
      state('unwind', 'scene weather: Watt damp, a drip', unwind(EVE, 'weather=rain&wattwx=drip')),
      state('unwind', 'scene weather: Watt shake, first frame', unwind(EVE, 'weather=rain&wattwx=shake1')),
      state('unwind', 'scene weather: Watt shake, second frame with droplets', unwind(EVE, 'weather=rain&wattwx=shake2')),
      state('unwind', 'scene weather: Watt shake, third frame', unwind(EVE, 'weather=rain&wattwx=shake3')),
      state('unwind', 'scene weather: Watt shake, fourth frame', unwind(EVE, 'weather=rain&wattwx=shake4')),
      state('unwind', 'scene weather: Watt fluffy after the shake', unwind(EVE, 'weather=rain&wattwx=fluffy')),
      state('unwind', 'scene weather: Watt leaning in the wind, facing left, with the loose strand', unwind(DAY, 'weather=wind&wattwx=lean')),
      state('unwind', 'scene weather: reduced motion with rain, no layer and Watt damp', unwind(EVE, 'weather=rain&reduced=1')),
      { screen: 'work', name: 'scene weather: Tools, the switch on', query: `hz=work&at=${at(10, 24)}&clock=review&agents=3&weather=rain&tools=1`, custom: true, expect: ['Weather in the scene', 'On', 'Off', 'Rain and wind from your forecast.'] },
      { screen: 'work', name: 'scene weather: Tools, the switch off', query: `hz=work&at=${at(10, 24)}&clock=review&agents=3&weather=rain&tools=1`, custom: true, actions: '.tools-weather .tools-chip:nth-child(2)', expect: ['Weather in the scene', 'Off'] },
      { screen: 'work', name: 'scene weather: Tools, the Off tip', query: `hz=work&at=${at(10, 24)}&clock=review&agents=3&weather=rain&tools=1`, custom: true, actions: 'hover:.tools-weather .tools-chip:nth-child(2)', expect: ['Keep the scene and Watt as on a dry day'] },
      { screen: 'work', name: 'scene weather: Tools, the On tip', query: `hz=work&at=${at(10, 24)}&clock=review&agents=3&weather=rain&tools=1`, custom: true, actions: 'hover:.tools-weather .tools-chip:nth-child(1)', expect: ['Show rain and wind from the forecast on the mountains and on Watt'] },
      { screen: 'unwind', name: 'scene weather: the switch off, Unwind has no rain and a dry Watt', query: unwind(EVE, 'weather=rain&tools=1'), custom: true, actions: '.tools-weather .tools-chip:nth-child(2)', expect: ['Weather in the scene', 'Off'] },
    ],
  },
  fit: {
    variants: [
      { name: FILM_V, q: fit(EVE, `weather=heavy&${WATCH}&wxt=6.5`), checks: ['.w-stage'], viewportOnly: true },
      { name: TOOLS_V, q: toolsFit('weather=rain'), checks: ['.tools-drawer', '.tools-drawer .tools-col', '.tools-drawer .tools-foot', '.tools-weather'], viewportOnly: true },
    ],
    measurements: { sceneWeather: measureWeather },
    rules: {
      sceneWeather: (variant, results, emit) => {
        const m = results.sceneWeather;
        if (!m) return false;
        const fails = [];
        let said = null;
        if (variant.name === FILM_V) {
          if (!m.film) fails.push('scene weather: no film box or front canvas to look at');
          else if (m.film.streak > 0) fails.push('scene weather: ' + m.film.streak + ' streak pixels lie inside the film box (' + m.film.box + ')');
          else said = 'the film box (' + m.film.box + ') holds no streak';
        }
        if (variant.name === TOOLS_V) {
          const t = m.tools;
          if (!t) fails.push('scene weather: the Tools block is not on the page');
          else {
            if (!t.inTop) fails.push('scene weather: the block is not in the drawer\'s top row');
            const ks = t.kids;
            for (let i = 0; i < ks.length; i++) {
              if (ks[i].b > t.drawer.b + 0.5 || ks[i].r > t.drawer.r + 0.5) fails.push('scene weather: "' + ks[i].n + '" is outside the Tools drawer');
              for (let j = i + 1; j < ks.length; j++) {
                const a = ks[i];
                const b = ks[j];
                if (a.l < b.r && b.l < a.r && a.t < b.b - 0.5 && b.t < a.b - 0.5) fails.push('scene weather: "' + a.n + '" overlaps "' + b.n + '"');
              }
            }
            if (t.drawer.b > 720.5) fails.push('scene weather: the drawer ends at y ' + r1(t.drawer.b) + ', past the wall (720)');
            if (t.block.b - t.block.t > 40) fails.push('scene weather: the block is ' + r1(t.block.b - t.block.t) + ' px high (the 36 px top row, 40 at most)');
            for (const x of t.small) fails.push('scene weather: text under 16 px: ' + x);
            for (const x of t.cut) fails.push('scene weather: "' + x + '" is cut');
            for (const h of t.chips) if (h < 31.5) fails.push('scene weather: a chip is ' + r1(h) + ' px high (32 at least, for a mouse)');
            if (!fails.length) said = 'the block sits in the top row between the title and the close button, ' + r1(t.block.b - t.block.t) + ' px high, chips 32 px, text 16 px or more';
          }
        }
        for (const f of fails) emit('  FAIL ' + f);
        if (fails.length) return true;
        if (said) emit('  ok   scene weather: ' + said);
        return false;
      },
    },
    breaks: {
      // The layer's skip boxes emptied (the dev knob): streaks fall over the film.
      'scene-film': { query: '&wxnoskip=1', expect: /^ *FAIL scene weather: \d+ streak pixels lie inside the film box/m, appliesTo: (v) => v.name === FILM_V },
      // The block grown to 400 px: it pushes the drawer past the wall.
      'scene-tools': { css: '.tools-weather { min-height: 400px !important; }', expect: /^ *FAIL scene weather: .*(past the wall|px high|overlaps|outside the Tools drawer)/m, appliesTo: (v) => v.name === TOOLS_V },
      // The hint under 16 px.
      'scene-text': { css: '.tools-weather .tools-hint { font-size: 13px !important; }', expect: /^ *FAIL scene weather: text under 16 px/m, appliesTo: (v) => v.name === TOOLS_V },
    },
  },
};
