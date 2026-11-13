// Calm check for the Unwind echo, in a real browser (jsdom cannot rasterise, so vitest cannot
// measure brightness). Builds `scripts/echo-calm/` (the real renderer, echo and audio store) as a
// development bundle inlined into one HTML file, and opens it in headless Chromium twice: with the
// `?audio=demo` levels, and with every band pumping fully on and off 6 times a second (harsher than
// any real track). Each run draws 600 frames (20 s) of the Unwind camera with the echo and without
// it, and takes what the echo adds to the picture's mean relative luminance, frame by frame.
// A swing is a move of that added brightness of at least 1 percent of the picture's mean, from a
// low to a high or back. The owner's calm rule: at most three swings in any one second. Exits
// non-zero when either input breaks it. CI does not run this; run it by hand after any change to
// the echo, the band history or the renderer's echo drawing.
//
//   WALL_CHROME=/path/to/chrome npm --prefix wall run echo-calm
//   ECHO_CALM_INPUTS=mode=steady,mode=stress&hz=3 ...   (other inputs; `steady` never changes)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const chrome = process.argv.slice(2).find((a) => !a.startsWith('--')) || process.env.WALL_CHROME;
if (!chrome) {
  console.error('echo-calm: set WALL_CHROME (or pass the path) to a Chromium or chrome-headless-shell binary.');
  process.exit(2);
}
process.env.NODE_ENV = 'development';
const { build } = await import('vite');
const here = join(dirname(fileURLToPath(import.meta.url)), 'echo-calm');
/** Swing size, as a share of the picture's mean brightness, and the most allowed in any second. */
const SWING = 0.01;
const MOST = 3;

function swings(series, th) {
  const at = [];
  let dir = 0;
  let ext = series[0];
  for (let i = 1; i < series.length; i++) {
    const v = series[i];
    if (dir >= 0) {
      if (v > ext) ext = v;
      else if (ext - v >= th) {
        at.push(i);
        dir = -1;
        ext = v;
      }
    }
    if (dir < 0) {
      if (v < ext) ext = v;
      else if (v - ext >= th) {
        at.push(i);
        dir = 1;
        ext = v;
      }
    }
  }
  let most = 0;
  for (const i of at) most = Math.max(most, at.filter((j) => j >= i && j < i + 30).length);
  return { count: at.length, most };
}

const out = mkdtempSync(join(tmpdir(), 'wall-echo-calm-'));
let failed = false;
try {
  await build({
    root: here,
    configFile: false,
    mode: 'development',
    base: './',
    logLevel: 'warn',
    build: { outDir: join(out, 'dist'), emptyOutDir: true, modulePreload: false, rolldownOptions: { output: { codeSplitting: false } } },
  });
  let html = readFileSync(join(out, 'dist', 'index.html'), 'utf8');
  html = html.replace(/<script type="module" crossorigin src="\.\/([^"]+)"><\/script>/g, (_, src) =>
    `<script type="module">${readFileSync(join(out, 'dist', src), 'utf8').replaceAll('</script', '<\\/script')}</script>`,
  );
  const page = join(out, 'calm.html');
  writeFileSync(page, html);
  const inputs = process.env.ECHO_CALM_INPUTS ? process.env.ECHO_CALM_INPUTS.split(',') : ['mode=demo', 'mode=stress&hz=6'];
  for (const input of inputs) {
    const dom = execFileSync(chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--window-size=2560,807', '--dump-dom', `${pathToFileURL(page).href}?${input}`], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const m = /<pre id="echo-calm">([^<]*)<\/pre>/.exec(dom);
    if (!m) {
      console.error(`echo-calm: the page did not report for ${input}`);
      process.exit(1);
    }
    const { withEcho, without } = JSON.parse(m[1].replaceAll('&quot;', '"'));
    if (process.env.ECHO_CALM_DUMP) writeFileSync(`${process.env.ECHO_CALM_DUMP}-${input.replace(/[^a-z0-9]+/gi, '_')}.json`, JSON.stringify({ withEcho, without }));
    const mean = withEcho.reduce((s, v) => s + v, 0) / withEcho.length;
    const added = withEcho.map((v, i) => v - without[i]);
    const s = swings(added, SWING * mean);
    const step = Math.max(...added.slice(1).map((v, i) => Math.abs(v - added[i]))) / mean;
    const ok = s.most <= MOST;
    if (!ok) failed = true;
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${input}: ${s.count} swings of ${SWING * 100}% or more in 20 s, at most ${s.most} in any second (limit ${MOST}); largest one-frame change ${(step * 100).toFixed(2)}% of the picture`,
    );
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
