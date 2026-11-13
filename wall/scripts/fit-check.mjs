// Fit check for the Work wings, in a real browser (jsdom has no layout, so vitest cannot
// measure this). Builds a development bundle with the dev mocks, inlines it into one HTML
// file, opens Work at a review moment with the longest mock strings (`?long=1`) in headless
// Chromium at 2560 by 720, and checks that the left and right wings and the centre fit:
// - no scroll overflow inside a checked box (scrollWidth <= clientWidth, scrollHeight <=
//   clientHeight);
// - each checked box stays inside its container (the centre for its lanes, shelf, panels
//   and note; the top band for the wings and the centre) on all four sides;
// - each checked box stays inside the viewport on all four sides;
// - the document itself has no scroll overflow.
// The centre is checked in each of its states (`?agents=`): three lanes with long titles,
// one lane, no lane, and the fill when the helper is not set up. Exits non-zero on a
// failure. CI does not run this; run it by hand before a layout change is handed over.
//
//   WALL_CHROME=/path/to/chrome-or-headless-shell npm --prefix wall run fit-check
//   npm --prefix wall run fit-check -- --overflow=right    (left, right, top, bottom, page)
//   npm --prefix wall run fit-check -- --self-test
//
// WALL_CHROME (or the first argument that is not a flag) is a Chromium or
// chrome-headless-shell binary. `--overflow=<side>` adds a stylesheet that pushes a checked
// box past that side (or widens the page) and must fail. `--self-test` runs every
// `--overflow` case and exits 0 only if each one failed with the FAIL line for its side.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const chrome = args.find((a) => !a.startsWith('--')) || process.env.WALL_CHROME;
if (!chrome) {
  console.error('fit-check: set WALL_CHROME (or pass the path) to a Chromium or chrome-headless-shell binary.');
  process.exit(2);
}

/**
 * Stylesheets that break the layout on purpose, one per side, for `--overflow`, and the
 * FAIL line the self-test must find for each (the side that was broken, nothing else).
 */
const EXPECT = {
  left: /^ *FAIL \.work \.left-wing:.*viewport [^,]*\bleft \d+/m,
  right: /^ *FAIL \.work \.centre \.lane \[\d\]:.*container right \d+/m,
  top: /^ *FAIL \.work \.right-wing:.*viewport top \d+/m,
  bottom: /^ *FAIL \.work \.centre \.shelf:.*container bottom \d+/m,
  page: /^ *FAIL page:.*scroll (?!2560 )\d+ x \d+ <= 2560 x/m,
};
const OVERFLOWS = {
  left: '.work .left-wing { transform: translateX(-200px); }',
  right: '.work .centre .lane { margin-right: -160px; }',
  top: '.work .right-wing { transform: translateY(-60px); }',
  bottom: '.work .centre .shelf { transform: translateY(120px); }',
  page: 'body::after { content: ""; position: absolute; left: 3000px; top: 0; width: 10px; height: 10px; }',
};

if (flag('self-test')) {
  const script = fileURLToPath(import.meta.url);
  let missed = 0;
  for (const side of Object.keys(OVERFLOWS)) {
    const r = spawnSync(process.execPath, [script, chrome, `--overflow=${side}`], { encoding: 'utf8' });
    // Caught only when the run failed and reported the side that was broken; a non-zero exit
    // for any other reason (a crash, a page that did not render) does not count.
    const line = EXPECT[side].exec(r.stdout ?? '');
    const caught = r.status === 1 && line !== null;
    if (!caught) missed += 1;
    const full = line ? r.stdout.slice(line.index).split('\n')[0].trim() : 'no FAIL line for this side';
    console.log(`${caught ? 'ok  ' : 'MISS'} --overflow=${side}: exit ${r.status}; ${full}`);
  }
  console.log(missed === 0 ? 'self-test: every deliberate overflow failed the check' : `self-test: ${missed} overflow(s) not caught`);
  process.exit(missed === 0 ? 0 : 1);
}

const overflow = flag('overflow')?.split('=')[1];
if (overflow !== undefined && !(overflow in OVERFLOWS)) {
  console.error(`fit-check: --overflow takes one of ${Object.keys(OVERFLOWS).join(', ')}`);
  process.exit(2);
}

process.env.NODE_ENV = 'development';
const { build } = await import('vite');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const WINGS = ['.work .left-wing', '.work .right-wing'];
const LANES = ['.work .centre', '.work .centre .lane', '.work .centre .shelf'];
const MEET = ['.meet .panel'];
const DREAM = ['.dream-clock', '.dream-date', '.dream-card', '.dream-status', '.dream-hint'];
const VARIANTS = [
  { name: 'three lanes, long titles', agents: '3', checks: [...WINGS, ...LANES] },
  { name: 'one lane', agents: '1', checks: LANES },
  { name: 'no lane', agents: '0', checks: [...LANES, '.work .centre .panel'] },
  { name: 'helper not set up', agents: 'off', checks: ['.work .centre', '.work .centre .panel', '.work .centre .centre-note'] },
  // Meet: both accounts read; one account failing; no account readable; long titles throughout.
  { name: 'Meet, both accounts read', agents: '3', go: 'meet', live: true, extra: '', checks: MEET },
  { name: 'Meet, one account failing', agents: '3', go: 'meet', live: true, extra: '&meet=mixed', checks: MEET },
  { name: 'Meet, no account readable', agents: '3', go: 'meet', live: true, extra: '&meet=down', checks: MEET },
  // Dream at night: helper answering, helper off; calendar read, unreadable, nothing tomorrow.
  { name: 'Dream, agents and calendar', agents: '3', go: 'dream', at: '2026-11-11T23:48:00-08:00', extra: '', checks: DREAM },
  { name: 'Dream, agents waiting', agents: 'ask', go: 'dream', at: '2026-11-11T23:48:00-08:00', extra: '', checks: DREAM },
  { name: 'Dream, helper off, calendar unreadable', agents: 'off', go: 'dream', at: '2026-11-11T23:48:00-08:00', extra: '&meet=down', checks: ['.dream-clock', '.dream-date', '.dream-card', '.dream-hint'] },
  { name: 'Dream, nothing tomorrow', agents: 'off', go: 'dream', at: '2026-11-11T23:48:00-08:00', extra: '&meet=none', checks: ['.dream-clock', '.dream-date', '.dream-hint'] },
];
// Meet reads the real clock, so its variants run unfrozen (the mock meetings are relative to now).
const query = (v) => `?${v.live ? '' : `hz=work&at=${v.at ?? '2026-11-11T10:24:00-08:00'}&`}long=1&agents=${v.agents}${v.go ? `&go=${v.go}` : ''}${v.extra ?? ''}`;
/** Rounding slack for fractional rectangles, in screen pixels. */
const SLACK = 0.5;

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
  // For each checked box: its scroll sizes, and how far it sticks out of its container and
  // of the viewport on each side (screen pixels, 0 when inside). Plus the page's own scroll.
  const measure = `<script>setTimeout(() => {
    const sels = new URLSearchParams(location.search).get('checks').split('|');
    const band = document.querySelector('.top');
    const out = (r, c) => ({ l: c.left - r.left, r: r.right - c.right, t: c.top - r.top, b: r.bottom - c.bottom });
    const view = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const res = sels.map((sel) => ({ sel, items: [...document.querySelectorAll(sel)].map((e) => {
      const box = e.getBoundingClientRect();
      const holder = e.parentElement.closest('.centre') || band || document.documentElement;
      return { sw: e.scrollWidth, cw: e.clientWidth, sh: e.scrollHeight, ch: e.clientHeight,
        inHolder: out(box, holder.getBoundingClientRect()), inView: out(box, view) };
    }) }));
    const d = document.documentElement;
    const page = { sw: d.scrollWidth, cw: d.clientWidth, sh: d.scrollHeight, ch: d.clientHeight, vw: innerWidth, vh: innerHeight };
    const pre = document.createElement('pre'); pre.id = 'fit-check'; pre.textContent = JSON.stringify({ res, page });
    document.body.appendChild(pre);
  }, 3000);</script>`;
  const broken = overflow ? `<style>${OVERFLOWS[overflow]}</style>` : '';
  const page = join(out, 'work.html');
  writeFileSync(page, html.replace('</body>', `${broken}${measure}</body>`));

  let failed = false;
  if (overflow) console.log(`deliberate overflow: ${overflow} (${OVERFLOWS[overflow]})`);
  for (const v of overflow ? VARIANTS.slice(0, 1) : VARIANTS) {
    console.log(`${v.name} (agents=${v.agents}):`);
    const url = `${pathToFileURL(page).href}${query(v)}&checks=${encodeURIComponent(v.checks.join('|'))}`;
    const dom = execFileSync(
      chrome,
      // Headless Chromium keeps 87 px of the window for itself, so 807 gives a 2560 by 720 viewport.
      ['--headless', '--no-sandbox', '--disable-gpu', '--window-size=2560,807', '--virtual-time-budget=8000', '--dump-dom', url],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const m = /<pre id="fit-check">([^<]*)<\/pre>/.exec(dom);
    if (!m) {
      console.error('fit-check: the page did not report (did it render?)');
      process.exit(1);
    }
    const text = m[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&');
    const { res, page: doc } = JSON.parse(text);
    const pageOk = doc.vw === 2560 && doc.vh === 720 && doc.sw <= doc.cw && doc.sh <= doc.ch;
    if (!pageOk) failed = true;
    console.log(`  ${pageOk ? 'ok  ' : 'FAIL'} page: viewport ${doc.vw} x ${doc.vh} (must be 2560 x 720), scroll ${doc.sw} x ${doc.sh} <= ${doc.cw} x ${doc.ch}`);
    const sides = (o) => {
      const over = Object.entries(o).filter(([, px]) => px > SLACK);
      return over.length ? over.map(([k, px]) => `${{ l: 'left', r: 'right', t: 'top', b: 'bottom' }[k]} ${Math.round(px)}`).join(', ') : 'inside';
    };
    for (const { sel, items } of res) {
      if (items.length === 0) {
        console.log(`  FAIL ${sel}: not found`);
        failed = true;
        continue;
      }
      items.forEach((r, i) => {
        const inside = (o) => Object.values(o).every((px) => px <= SLACK);
        const ok = r.sw <= r.cw && r.sh <= r.ch && inside(r.inHolder) && inside(r.inView);
        if (!ok) failed = true;
        console.log(
          `  ${ok ? 'ok  ' : 'FAIL'} ${sel}${items.length > 1 ? ` [${i}]` : ''}: width ${r.sw} <= ${r.cw}, height ${r.sh} <= ${r.ch}, container ${sides(r.inHolder)}, viewport ${sides(r.inView)}`,
        );
      });
    }
  }
  process.exit(failed ? 1 : 0);
} finally {
  rmSync(out, { recursive: true, force: true });
}
