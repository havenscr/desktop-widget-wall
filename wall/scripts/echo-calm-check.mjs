// Calm check for the Unwind echo, in a real browser (jsdom cannot rasterise, so vitest cannot
// measure brightness). Builds `scripts/echo-calm/` (the real renderer, echo and audio store) as a
// development bundle inlined into one HTML file, and opens it in headless Chromium twice: with the
// `?audio=demo` levels, and with every band pumping fully on and off 6 times a second (harsher than
// any real track). Each run draws 600 frames (20 s) of the Unwind camera with the echo and without
// it, and takes what the echo adds to the picture's mean relative luminance, frame by frame.
// A third input, `settle`, plays the demo levels for 10 s and then goes silent, stepping the lines
// as the canvas does, so they settle into their resting look and hold still.
// Each input also reports the largest move of any echo line between two drawn frames (design pixels).
// A swing is a move of that added brightness of at least 1 percent of the picture's mean, from a
// low to a high or back. The owner's calm rule was at most three swings in any one second; the dance (the lines follow each hit) moves the picture more by design, so the limits are now per input, a little over what the chosen look measures (`LIMITS`). For the
// settle input also: from the moment the music stops no frame may change the picture by more than
// `SETTLE_STEP` (a settle, never a step), and from 3.5 s after it the picture must hold still (no
// frame changing it by more than `STILL`). Exits non-zero when any input breaks a rule. CI does not run this; run it by hand after any change to
// the echo, the band history or the renderer's echo drawing.
//
//   WALL_CHROME=/path/to/chrome npm --prefix wall run echo-calm
//   ECHO_CALM_INPUTS=mode=steady,mode=stress&hz=3 ...   (other inputs; `steady` never changes)

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runChrome } from './lib/chrome-run.mjs';

const chrome = process.argv.slice(2).find((a) => !a.startsWith('--')) || process.env.WALL_CHROME;
if (!chrome) {
  console.error('echo-calm: set WALL_CHROME (or pass the path) to a Chromium or chrome-headless-shell binary.');
  process.exit(2);
}
process.env.NODE_ENV = 'development';
const { build } = await import('vite');
const here = join(dirname(fileURLToPath(import.meta.url)), 'echo-calm');
/** Swing size, as a share of the picture's mean brightness. */
const SWING = 0.01;
/**
 * Per input: the most swings allowed in any second and the largest move of any line between two
 * frames (design pixels). Before the dance these were 3 swings and no line limit; the dance moves
 * the lines on every hit, so each limit sits a little over what the chosen look measures.
 */
const LIMITS = {
  // Measured before the dance: demo 11 swings (1 a second) and 22.3 px, stress 12 (1) and 14.1 px, settle 7 (1) and 19.8 px.
  // Measured with the dance: demo 62 swings (6 a second) and 52.4 px, stress 194 (12) and 23.5 px, settle 33 (6) and 52.4 px.
  // The all-bands stress case moves the shape only. Opacity and colour do not change.
  'mode=demo': { most: 7, line: 60 },
  'mode=stress': { most: 13, line: 28 },
  'mode=settle': { most: 7, line: 60 },
};
/** The settle input: the frame the music stops (10 s at 30 fps), the largest one-frame change allowed from then on, and the stillness bound once settled. */
const SETTLE_AT = 300;
const SETTLE_STEP = 0.02;
const STILL = 0.0005;

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
  const inputs = process.env.ECHO_CALM_INPUTS ? process.env.ECHO_CALM_INPUTS.split(',') : ['mode=demo', 'mode=stress&hz=6', 'mode=settle'];
  for (const input of inputs) {
    const dom = await runChrome(chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--window-size=2560,807', '--dump-dom', `${pathToFileURL(page).href}?${input}`], {
      label: input,
      maxBuffer: 256 * 1024 * 1024,
      exitOnFail: true,
    });
    const m = /<pre id="echo-calm">([^<]*)<\/pre>/.exec(dom);
    if (!m) {
      console.error(`echo-calm: the page did not report for ${input}`);
      process.exit(1);
    }
    const { withEcho, without, steps } = JSON.parse(m[1].replaceAll('&quot;', '"'));
    if (process.env.ECHO_CALM_DUMP) writeFileSync(`${process.env.ECHO_CALM_DUMP}-${input.replace(/[^a-z0-9]+/gi, '_')}.json`, JSON.stringify({ withEcho, without }));
    const mean = withEcho.reduce((s, v) => s + v, 0) / withEcho.length;
    const added = withEcho.map((v, i) => v - without[i]);
    const s = swings(added, SWING * mean);
    const step = Math.max(...added.slice(1).map((v, i) => Math.abs(v - added[i]))) / mean;
    const limit = LIMITS[input.split('&')[0]] || LIMITS['mode=demo'];
    // The dance moves the lines on every hit by design, so the swing and line-step limits per input sit a little over what the chosen look measures (the pull request has the old numbers).
    const lineMove = Math.max(...steps);
    let ok = s.most <= limit.most && lineMove <= limit.line;
    let extra = `; largest move of any line between two frames ${lineMove.toFixed(2)} px (limit ${limit.line})`;
    if (input.includes('mode=settle')) {
      const stepFrom = (from) => Math.max(...added.slice(from).map((v, i) => Math.abs(v - added[from - 1 + i]))) / mean;
      const settle = stepFrom(SETTLE_AT);
      const still = stepFrom(SETTLE_AT + 105);
      ok = ok && settle <= SETTLE_STEP && still <= STILL;
      extra += `; after the music stops at most ${(settle * 100).toFixed(2)}% in one frame (limit ${SETTLE_STEP * 100}%), and once settled ${(still * 100).toFixed(3)}% (limit ${STILL * 100}%)`;
    }
    if (!ok) failed = true;
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${input}: ${s.count} swings of ${SWING * 100}% or more in 20 s, at most ${s.most} in any second (limit ${limit.most}); largest one-frame change ${(step * 100).toFixed(2)}% of the picture${extra}`,
    );
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
