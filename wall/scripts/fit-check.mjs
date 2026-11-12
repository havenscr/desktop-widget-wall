// Fit check for the Work wings, in a real browser (jsdom has no layout, so vitest cannot
// measure this). Builds a development bundle with the dev mocks, inlines it into one HTML
// file, opens Work at a review moment with the longest mock strings (`?long=1`) in headless
// Chromium at 2560 by 720, and checks that the left and right wings and the centre fit:
// scrollWidth <= clientWidth, scrollHeight <= clientHeight, and no box reaches below the
// top band. The centre is checked in each of its states (`?agents=`): three lanes with long
// titles, one lane, no lane, and the fill when the helper is not set up. Exits non-zero on
// a failure. CI does not run this; run it by hand before a layout change is handed over.
//
//   WALL_CHROME=/path/to/chrome-or-headless-shell npm --prefix wall run fit-check
//
// WALL_CHROME (or the first argument) is a Chromium or chrome-headless-shell binary.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.NODE_ENV = 'development';
const { build } = await import('vite');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.argv[2] || process.env.WALL_CHROME;
if (!chrome) {
  console.error('fit-check: set WALL_CHROME (or pass the path) to a Chromium or chrome-headless-shell binary.');
  process.exit(2);
}

const WINGS = ['.work .left-wing', '.work .right-wing'];
const LANES = ['.work .centre', '.work .centre .lane', '.work .centre .shelf'];
const VARIANTS = [
  { name: 'three lanes, long titles', agents: '3', checks: [...WINGS, ...LANES] },
  { name: 'one lane', agents: '1', checks: LANES },
  { name: 'no lane', agents: '0', checks: [...LANES, '.work .centre .panel'] },
  { name: 'helper not set up', agents: 'off', checks: ['.work .centre', '.work .centre .panel', '.work .centre .centre-note'] },
];
const query = (agents) => `?hz=work&at=2026-11-11T10:24:00-08:00&long=1&agents=${agents}`;

const out = mkdtempSync(join(tmpdir(), 'wall-fit-check-'));
try {
  await build({
    root,
    configFile: join(root, 'vite.config.ts'),
    mode: 'development',
    base: './',
    logLevel: 'warn',
    build: {
      outDir: join(out, 'dist'),
      emptyOutDir: true,
      assetsInlineLimit: 100_000_000,
      cssCodeSplit: false,
      modulePreload: false,
      chunkSizeWarningLimit: 100_000,
      rolldownOptions: { output: { codeSplitting: false } },
    },
  });

  // One file: module scripts and stylesheets cannot load from file:// as separate files.
  const dist = join(out, 'dist');
  let html = readFileSync(join(dist, 'index.html'), 'utf8');
  html = html.replace(/<script type="module" crossorigin src="\.\/([^"]+)"><\/script>/g, (_, src) =>
    `<script type="module">${readFileSync(join(dist, src), 'utf8').replaceAll('</script', '<\\/script')}</script>`,
  );
  html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/([^"]+)">/g, (_, href) => `<style>${readFileSync(join(dist, href), 'utf8')}</style>`);
  // "below" is how far a box reaches past the bottom of the top band, in screen pixels.
  const measure = `<script>setTimeout(() => {
    const sels = new URLSearchParams(location.search).get('checks').split('|');
    const band = document.querySelector('.top').getBoundingClientRect().bottom;
    const res = sels.map((sel) => ({ sel, items: [...document.querySelectorAll(sel)].map((e) => ({
      sw: e.scrollWidth, cw: e.clientWidth, sh: e.scrollHeight, ch: e.clientHeight,
      below: Math.max(0, Math.round(e.getBoundingClientRect().bottom - band)) })) }));
    const pre = document.createElement('pre'); pre.id = 'fit-check'; pre.textContent = JSON.stringify(res);
    document.body.appendChild(pre);
  }, 3000);</script>`;
  const page = join(out, 'work.html');
  writeFileSync(page, html.replace('</body>', `${measure}</body>`));

  let failed = false;
  for (const v of VARIANTS) {
    console.log(`${v.name} (agents=${v.agents}):`);
    const url = `${pathToFileURL(page).href}${query(v.agents)}&checks=${encodeURIComponent(v.checks.join('|'))}`;
    const dom = execFileSync(
      chrome,
      ['--headless', '--no-sandbox', '--disable-gpu', '--window-size=2560,720', '--virtual-time-budget=8000', '--dump-dom', url],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const m = /<pre id="fit-check">([^<]*)<\/pre>/.exec(dom);
    if (!m) {
      console.error('fit-check: the page did not report (did it render?)');
      process.exit(1);
    }
    const text = m[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&');
    for (const { sel, items } of JSON.parse(text)) {
      if (items.length === 0) {
        console.log(`  FAIL ${sel}: not found`);
        failed = true;
        continue;
      }
      items.forEach((r, i) => {
        const ok = r.sw <= r.cw && r.sh <= r.ch && r.below === 0;
        if (!ok) failed = true;
        console.log(
          `  ${ok ? 'ok  ' : 'FAIL'} ${sel}${items.length > 1 ? ` [${i}]` : ''}: width ${r.sw} <= ${r.cw}, height ${r.sh} <= ${r.ch}, below the band ${r.below}`,
        );
      });
    }
  }
  process.exit(failed ? 1 : 0);
} finally {
  rmSync(out, { recursive: true, force: true });
}
