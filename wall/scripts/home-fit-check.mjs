// Real-browser fit check for the Home tab. Not run by CI (it needs a Chromium binary).
//
//   node scripts/home-fit-check.mjs /path/to/chrome [--shots=dir]
//   CHROME=/path/to/chrome npm --prefix wall run fit:home
//   npm --prefix wall run fit:home -- /path/to/chrome --self-test
//
// Builds one development bundle (mocks on, no code splitting), inlines it into one HTML
// file (file:// cannot load module scripts from disk) and opens Home in each state below.
// In the browser it checks the rules that state names:
//   right column: the wing stays inside the 490 px top band with 16 px between the chores
//     and the network card, chore titles stay on one line, tick hit areas are at least
//     52 by 40 and never overlap, and the chores show five rows in view when the network is
//     quiet and three while alerts are open;
//   drawer: the alert drawer stays inside the stage and below the top of the band (under
//     the clock line);
//   house: the house line fits the 458 by 215 area under the date and cuts no room name;
//   moods: with a More card, each of the three large mood cards is at least 340 px wide.
// Prints what it measured and exits 1 on any failure. `--break=<name>` adds a stylesheet
// that breaks one rule on purpose; `--self-test` runs every break and exits 0 only if each
// one failed with its own FAIL line. `--shots=dir` saves a screenshot of each state.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onCleanup, runChrome } from './lib/chrome-run.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const chrome = args.find((a) => !a.startsWith('--')) || process.env.CHROME || process.env.WALL_CHROME;
if (!chrome) {
  console.error('usage: node scripts/home-fit-check.mjs <chrome binary> [--self-test] [--break=name] [--shots=dir]');
  process.exit(2);
}

/** Deliberate breaks: the stylesheet, the state it runs on, and the FAIL line it must cause. */
const BREAKS = {
  rows: { css: '.home .chore-rows.fit3 { max-height: 200px !important; }', state: 'alerts', expect: /^FAIL chores: \d+ rows in view/m },
  drawer: { css: '.shield-drawer { top: -400px !important; bottom: auto !important; }', state: 'drawer', expect: /^FAIL drawer: /m },
  house: { css: '.home .house .house-line, .home .house .house-room { font-size: 30px !important; }', state: 'house', expect: /^FAIL house: /m },
  moods: { css: '.mood-row.paged { grid-template-columns: repeat(4, minmax(0, 1fr)) 124px !important; }', state: 'moods', expect: /^FAIL moods: /m },
};

if (flag('self-test')) {
  const script = fileURLToPath(import.meta.url);
  let missed = 0;
  for (const [name, b] of Object.entries(BREAKS)) {
    const r = spawnSync(process.execPath, [script, chrome, `--break=${name}`], { encoding: 'utf8' });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const line = b.expect.exec(out);
    const caught = r.status === 1 && line !== null;
    if (!caught) missed += 1;
    console.log(`${caught ? 'ok  ' : 'MISS'} --break=${name}: exit ${r.status}; ${line ? out.slice(line.index).split('\n')[0] : 'no FAIL line for this break'}`);
  }
  console.log(missed === 0 ? 'self-test: every deliberate break failed the check' : `self-test: ${missed} break(s) not caught`);
  process.exit(missed === 0 ? 0 : 1);
}

const brk = flag('break')?.split('=')[1];
if (brk !== undefined && !(brk in BREAKS)) {
  console.error(`home-fit-check: --break takes one of ${Object.keys(BREAKS).join(', ')}`);
  process.exit(2);
}
const shots = flag('shots')?.split('=')[1];

/** [name, query, rules, click]. */
const STATES = [
  { name: 'quiet', q: 'desk=typical&alerts=0&chores=many', rules: ['column'], rows: 5 },
  { name: 'alerts', q: 'desk=typical&alerts=6&chores=many', rules: ['column'], rows: 3 },
  { name: 'legacy', q: 'desk=absent&chores=many', rules: ['column'], rows: 3 },
  { name: 'drawer', q: 'desk=typical&alerts=20&chores=many', rules: ['drawer', 'column'], rows: 3, click: '.panel.network.shield' },
  { name: 'house', q: 'desk=typical&rooms=8', rules: ['house'] },
  { name: 'moods', q: 'moods=12', rules: ['moods'] },
];

const wall = resolve(fileURLToPath(new URL('..', import.meta.url)));
const work = mkdtempSync(join(tmpdir(), 'wall2-fit-'));
onCleanup(() => rmSync(work, { recursive: true, force: true }));
const out = join(work, 'dist');
process.env.NODE_ENV = 'development';

try {
  const { build } = await import('vite');
  await build({
    root: wall,
    configFile: join(wall, 'vite.config.ts'),
    mode: 'development',
    base: './',
    logLevel: 'warn',
    build: {
      outDir: out,
      emptyOutDir: true,
      assetsInlineLimit: 100_000_000,
      cssCodeSplit: false,
      modulePreload: false,
      chunkSizeWarningLimit: 100_000,
      rolldownOptions: { output: { codeSplitting: false } },
    },
  });
  let html = readFileSync(join(out, 'index.html'), 'utf8');
  html = html.replace(/<script type="module" crossorigin src="\.\/([^"]+)"><\/script>/g, (_, src) =>
    `<script type="module">${readFileSync(join(out, src), 'utf8').replaceAll('</script', '<\\/script')}</script>`,
  );
  html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/([^"]+)">/g, (_, href) => `<style>${readFileSync(join(out, href), 'utf8')}</style>`);

  const longTitles = [
    'Take the bins and the recycling out to the curb before the truck comes tonight',
    'Order the furnace filter, the 20 by 25 one, and the spare for the garage unit too',
    'Call the chimney sweep about the spring visit and ask about the cap on the flue',
  ];
  const probe = `
<style>/* Measured at rest: virtual time runs no frames for the slide-in animations to finish. */ .shield-drawer, .mood-row .mood-btn { animation: none !important; }</style>
<script>try{localStorage.setItem('wall2-last-mood','day')}catch(e){}</script>
<script>
setTimeout(() => {
  const q = new URLSearchParams(location.search);
  const click = q.get('click');
  if (click) document.querySelector(click)?.click();
  const titles = ${JSON.stringify(longTitles)};
  document.querySelectorAll('.home .tk3 .n').forEach((n, i) => { n.textContent = titles[i % titles.length]; });
  setTimeout(() => {
    const rules = (q.get('rules') || '').split(',');
    const stage = document.querySelector('.stage').getBoundingClientRect();
    const k = stage.width / 2560;
    const box = (el) => { const b = el.getBoundingClientRect(); return { x: (b.left - stage.left) / k, y: (b.top - stage.top) / k, w: b.width / k, h: b.height / k }; };
    const fail = [];
    const m = {};
    const top = box(document.querySelector('.top'));
    if (rules.includes('column')) {
      const wing = document.querySelector('.home-right');
      const w = box(wing);
      const bottom = Math.max(...[...wing.children].map((c) => { const b = box(c); return b.y + b.h; }));
      if (bottom > top.y + top.h + 0.5) fail.push('column: right wing content ends at y ' + bottom.toFixed(1) + ', below the band at ' + (top.y + top.h));
      if (w.x + w.w > 2540.5) fail.push('column: right wing runs past the stage edge');
      const parts = [...wing.children].map(box);
      const slack = parts.length === 2 ? parts[1].y - (parts[0].y + parts[0].h) : 0;
      if (slack < 15.5) fail.push('column: only ' + slack.toFixed(1) + ' px between the chores and the network card (the wing gap is 16)');
      if (wing.scrollHeight > wing.clientHeight + 1) fail.push('column: right wing overflows its 490 px cell');
      const list = document.querySelector('.home .chore-rows');
      const rowsIn = list ? [...list.querySelectorAll('.tk3')].filter((r) => { const a = r.getBoundingClientRect(); const b = list.getBoundingClientRect(); return a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5; }).length : 0;
      const want = Number(q.get('rows'));
      if (rowsIn !== want) fail.push('chores: ' + rowsIn + ' rows in view, expected ' + want);
      const names = [...document.querySelectorAll('.home .tk3 .n')];
      names.slice(0, rowsIn).forEach((n, i) => {
        const lh = parseFloat(getComputedStyle(n).lineHeight) || 30;
        if (box(n).h > lh * 1.5) fail.push('chores: chore ' + (i + 1) + ' title wraps');
        if (n.scrollWidth <= n.clientWidth) fail.push('chores: chore ' + (i + 1) + ' long title is not cut with an ellipsis');
      });
      const ticks = [...document.querySelectorAll('.home .tk3 .ck')].slice(0, rowsIn).map(box);
      ticks.forEach((t, i) => {
        if (t.w < 51.5 || t.h < 39.5) fail.push('chores: tick ' + (i + 1) + ' hit area is ' + t.w.toFixed(1) + ' by ' + t.h.toFixed(1));
        ticks.slice(i + 1).forEach((u, j) => {
          const overlap = t.x < u.x + u.w && u.x < t.x + t.w && t.y < u.y + u.h - 0.5 && u.y < t.y + t.h - 0.5;
          if (overlap) fail.push('chores: tick ' + (i + 1) + ' and tick ' + (i + j + 2) + ' hit areas overlap');
        });
      });
      Object.assign(m, { bottom: +bottom.toFixed(1), slack: +slack.toFixed(1), rowsIn, card: +box(document.querySelector('.panel.network')).h.toFixed(1) });
    }
    if (rules.includes('drawer')) {
      const d = document.querySelector('.shield-drawer');
      if (!d) fail.push('drawer: did not open');
      else {
        const b = box(d);
        if (b.x < -0.5 || b.y < -0.5 || b.x + b.w > 2560.5 || b.y + b.h > 720.5) fail.push('drawer: outside the stage at ' + b.x.toFixed(0) + ',' + b.y.toFixed(0) + ' ' + b.w.toFixed(0) + 'x' + b.h.toFixed(0));
        if (b.y < top.y - 0.5) fail.push('drawer: top at y ' + b.y.toFixed(1) + ', above the band top ' + top.y.toFixed(1) + ' (over the clock line)');
        if (b.y + b.h > top.y + top.h + 0.5) fail.push('drawer: bottom at y ' + (b.y + b.h).toFixed(1) + ', below the band');
        const list = d.querySelector('.sd-list');
        if (list && list.scrollWidth > list.clientWidth + 1) fail.push('drawer: rows wider than the drawer');
        Object.assign(m, { drawer: b });
      }
    }
    if (rules.includes('house')) {
      const h = document.querySelector('.home .house');
      const wing = document.querySelector('.home-wing');
      if (!h || !wing) fail.push('house: the house line is not showing');
      else {
        const b = box(h);
        const wb = box(wing);
        const date = box(document.querySelector('.home .home-blk'));
        // The area under the date: 458 wide from the wing's left, ending 215 px below the sun block.
        const floor = date.y + date.h + 215;
        if (b.x + b.w > wb.x + 458 + 0.5 + 12) fail.push('house: ' + (b.x + b.w - wb.x).toFixed(1) + ' px wide, past the 458 px area');
        if (b.y + b.h > floor + 0.5) fail.push('house: ends at y ' + (b.y + b.h).toFixed(1) + ', past the area floor at ' + floor.toFixed(1));
        const rooms = h.querySelector('.house-rooms');
        if (rooms && rooms.scrollHeight > rooms.clientHeight + 1) fail.push('house: room names are cut (' + rooms.scrollHeight + ' > ' + rooms.clientHeight + ')');
        const line = h.querySelector('.house-line');
        const lh = parseFloat(getComputedStyle(line).lineHeight) || 30;
        if (box(line).h > lh * 1.5) fail.push('house: the line wraps');
        Object.assign(m, { house: b, floor });
      }
    }
    if (rules.includes('moods')) {
      const cards = [...document.querySelectorAll('.home .mood-row .mood-btn')].map(box);
      const more = document.querySelector('.home .mood-more');
      if (!more) fail.push('moods: no More card');
      if (cards.length !== 3) fail.push('moods: ' + cards.length + ' large cards, expected 3');
      cards.forEach((c, i) => { if (c.w < 339.5) fail.push('moods: card ' + (i + 1) + ' is ' + c.w.toFixed(1) + ' px wide, under 340'); });
      const row = document.querySelector('.home .mood-row');
      if (row && row.scrollWidth > row.clientWidth + 1) fail.push('moods: the row overflows');
      Object.assign(m, { cards: cards.map((c) => +c.w.toFixed(1)), more: more ? +box(more).w.toFixed(1) : null });
    }
    const pre = document.createElement('pre');
    pre.id = 'fit';
    pre.textContent = JSON.stringify({ m, fail });
    document.body.appendChild(pre);
  }, 900);
}, 3000);
</script>`;
  const broken = brk ? `<style>${BREAKS[brk].css}</style>` : '';
  const page = join(work, 'fit.html');
  writeFileSync(page, html.replace('</body>', `${broken}${probe}</body>`));
  const flags = ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--window-size=2560,807', '--virtual-time-budget=8000'];
  let failed = false;
  for (const s of brk ? STATES.filter((x) => x.name === BREAKS[brk].state) : STATES) {
    const url = `file://${page}?hz=home&at=2026-11-11T16:36:00-08:00&clock=review&weather=ok&${s.q}&rules=${s.rules.join(',')}${s.rows ? `&rows=${s.rows}` : ''}${s.click ? `&click=${encodeURIComponent(s.click)}` : ''}`;
    const dom = await runChrome(chrome, [...flags, '--dump-dom', url], { label: s.name, limitMs: 120_000 });
    const hit = /<pre id="fit">([^<]*)<\/pre>/.exec(dom);
    if (!hit) {
      console.log(`FAIL ${s.name}: the page did not report (did Home render?)`);
      failed = true;
      continue;
    }
    const r = JSON.parse(hit[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    if (shots) await runChrome(chrome, [...flags, `--screenshot=${resolve(shots, `home-${s.name}.png`)}`, url], { label: `${s.name}, screenshot`, limitMs: 120_000 });
    console.log(`${s.name} (${s.q}): ${JSON.stringify(r.m)}`);
    for (const f of r.fail) console.log(`FAIL ${f}`);
    if (r.fail.length) failed = true;
    else console.log(`ok   ${s.name}: ${s.rules.join(', ')}`);
  }
  console.log(failed ? 'home fit check failed' : 'home fit check passed');
  process.exitCode = failed ? 1 : 0;
} catch (e) {
  console.error(`home fit check: ${e.message}`);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
