// Real-browser fit check for the Home tab. Not run by CI (it needs a Chromium binary).
//
//   node scripts/home-fit-check.mjs /path/to/chrome [out.png]
//   CHROME=/path/to/chrome npm --prefix wall run fit:home
//
// Builds a development bundle (mocks on), inlines it into one HTML file (file:// cannot load
// module scripts from disk), opens Home at 16:36 with the last mood set, gives every chore a
// long title, then checks in the browser that the right wing stays inside the 490 px top
// band, that chore titles stay on one line, that three alert rows show, and that no two
// tick hit areas overlap. Prints what it measured and exits 1 on any failure. With an output
// path it also saves a screenshot of the same frame.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const chrome = process.argv[2] || process.env.CHROME;
const shot = process.argv[3];
if (!chrome) {
  console.error('usage: node scripts/home-fit-check.mjs <chrome binary> [screenshot.png]');
  process.exit(2);
}
const wall = resolve(fileURLToPath(new URL('..', import.meta.url)));
const work = mkdtempSync(join(tmpdir(), 'wall2-fit-'));
const out = join(work, 'dist');

try {
  execFileSync('npx', ['vite', 'build', '--mode', 'development', '--outDir', out, '--emptyOutDir', '--minify', 'false', '--base', './'], {
    cwd: wall,
    env: { ...process.env, NODE_ENV: 'development' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const assets = join(out, 'assets');
  const files = readdirSync(assets);
  const js = readFileSync(join(assets, files.find((f) => /^index-.*\.js$/.test(f))), 'utf8').replace(/<\/script/g, '<\\/script');
  let css = readFileSync(join(assets, files.find((f) => /^index-.*\.css$/.test(f))), 'utf8');
  css = css.replace(/url\('\.\/([^']+\.woff2)'\)/g, (_, f) => `url(data:font/woff2;base64,${readFileSync(join(assets, f)).toString('base64')})`);

  const longTitles = [
    'Take the bins and the recycling out to the curb before the truck comes tonight',
    'Order the furnace filter, the 20 by 25 one, and the spare for the garage unit too',
    'Call the chimney sweep about the spring visit and ask about the cap on the flue',
  ];
  const probe = `
<script>try{localStorage.setItem('wall2-last-mood','day')}catch(e){}</script>
<script>
setTimeout(() => {
  const titles = ${JSON.stringify(longTitles)};
  document.querySelectorAll('.home .tk3 .n').forEach((n, i) => { n.textContent = titles[i % titles.length]; });
  setTimeout(() => {
    const stage = document.querySelector('.stage').getBoundingClientRect();
    const k = stage.width / 2560;
    const box = (el) => { const b = el.getBoundingClientRect(); return { x: (b.left - stage.left) / k, y: (b.top - stage.top) / k, w: b.width / k, h: b.height / k }; };
    const fail = [];
    const top = box(document.querySelector('.top'));
    const wing = document.querySelector('.home-right');
    const w = box(wing);
    const bottom = Math.max(...[...wing.children].map((c) => { const b = box(c); return b.y + b.h; }));
    if (bottom > top.y + top.h + 0.5) fail.push('right wing content ends at y ' + bottom.toFixed(1) + ', below the band at ' + (top.y + top.h));
    if (w.x + w.w > 2540.5) fail.push('right wing runs past the stage edge');
    // The wing pins the network card to the bottom, so its bottom always meets the band:
    // the real test is that the chores end above the card (the slack between them).
    const parts = [...wing.children].map(box);
    const slack = parts.length === 2 ? parts[1].y - (parts[0].y + parts[0].h) : 0;
    if (slack < 15.5) fail.push('only ' + slack.toFixed(1) + ' px between the chores and the network card (the wing gap is 16)');
    if (wing.scrollHeight > wing.clientHeight + 1) fail.push('right wing overflows its 490 px cell');
    const names = [...document.querySelectorAll('.home .tk3 .n')];
    if (names.length !== 3) fail.push('expected 3 chore rows, saw ' + names.length);
    names.forEach((n, i) => {
      const lh = parseFloat(getComputedStyle(n).lineHeight) || 30;
      if (box(n).h > lh * 1.5) fail.push('chore ' + (i + 1) + ' title wraps');
      if (n.scrollWidth <= n.clientWidth) fail.push('chore ' + (i + 1) + ' long title is not cut with an ellipsis');
    });
    const alerts = document.querySelectorAll('.net-alert').length;
    if (alerts !== 3) fail.push('expected 3 alert rows, saw ' + alerts);
    const ticks = [...document.querySelectorAll('.home .tk3 .ck')].map(box);
    ticks.forEach((t, i) => {
      if (t.w < 51.5 || t.h < 43.5) fail.push('tick ' + (i + 1) + ' hit area is ' + t.w.toFixed(1) + ' by ' + t.h.toFixed(1));
      ticks.slice(i + 1).forEach((u, j) => {
        const overlap = t.x < u.x + u.w && u.x < t.x + t.w && t.y < u.y + u.h && u.y < t.y + t.h;
        if (overlap) fail.push('tick ' + (i + 1) + ' and tick ' + (i + j + 2) + ' hit areas overlap');
      });
    });
    const pre = document.createElement('pre');
    pre.id = 'fit';
    pre.textContent = JSON.stringify({ band: top, wing: w, bottom, slack, ticks, alerts, fail });
    document.body.appendChild(pre);
  }, 200);
}, 2500);
</script>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Wall 2 fit check</title><style>${css}</style></head><body><div id="root"></div>${probe}<script type="module">${js}</script></body></html>`;
  const page = join(work, 'fit.html');
  writeFileSync(page, html);
  const url = `file://${page}?hz=home&at=2026-11-11T16:36:00-08:00`;
  const flags = ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--window-size=2560,720', '--virtual-time-budget=6000'];
  const dom = execFileSync(chrome, [...flags, '--dump-dom', url], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 90_000, maxBuffer: 64 * 1024 * 1024 });
  const m = /<pre id="fit">([^<]*)<\/pre>/.exec(dom);
  if (!m) {
    console.error('fit check: the probe did not report (the page did not render Home)');
    process.exit(1);
  }
  const r = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  if (shot) execFileSync(chrome, [...flags, `--screenshot=${resolve(shot)}`, url], { stdio: 'ignore', timeout: 90_000 });
  const ticks = r.ticks.map((t) => `${t.w.toFixed(0)}x${t.h.toFixed(0)}@${t.y.toFixed(0)}`).join(', ');
  console.log(`band bottom y ${(r.band.y + r.band.h).toFixed(1)}, right wing content bottom y ${r.bottom.toFixed(1)}, slack between chores and network card ${r.slack.toFixed(1)} px, alert rows ${r.alerts}, ticks ${ticks}`);
  if (r.fail.length) {
    for (const f of r.fail) console.error(`FAIL ${f}`);
    process.exit(1);
  }
  console.log('fit check passed');
} finally {
  rmSync(work, { recursive: true, force: true });
}
