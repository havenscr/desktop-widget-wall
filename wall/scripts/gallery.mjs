// The state gallery: renders every screen of Wall 2 in many data states at 2560 by 720 and
// writes PNG stills plus one `index.html` (grouped by screen, with each state's name and URL)
// and `manifest.json` into `wall/.gallery/`. For design review: judge the product from the
// pictures. States come from URL knobs read by the development mocks
// (`src/bridge/devMocks/`, `gallery.ts` for the newer ones); a production build has none.
//
//   WALL_CHROME=/path/to/chrome npm --prefix wall run gallery
//   npm --prefix wall run gallery -- --only=work        (screens or state names containing this text)
//   npm --prefix wall run gallery -- --list             (print the states, render nothing)
//
// Builds a development bundle, inlines it into one HTML file, drives headless Chromium over
// the DevTools protocol in real time (animated parts need real frames) and waits for each
// screen to settle. Prints one line per state; exits non-zero if any state fails to render
// or throws a page error. Needs no dependency beyond Node 22+ (built-in WebSocket and fetch).

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.gallery');
const W = 2560;
const H = 720;
const SETTLE_MS = 2500;
const STATE_TIMEOUT_MS = 30_000;
const PARALLEL = 3;
const TZ = 'America/Los_Angeles';

/** Times of day (Pacific, November): the sky changes behind the text. */
const TIMES = {
  morning: '2026-11-11T07:30:00-08:00',
  noon: '2026-11-11T12:30:00-08:00',
  dusk: '2026-11-11T16:55:00-08:00',
  night: '2026-11-11T22:30:00-08:00',
};
const TYPICAL_AT = '2026-11-11T10:24:00-08:00';

/** Every knob at its emptiest: nothing to show anywhere. */
const SPARSE = 'agents=0&tasks=none&meet=none&home=quiet&moods=none&media=none&usage=none&box=none';
/** Every knob at the most the screen can be asked to hold. */
const HEAVY = 'long=1&agents=ask&tasks=heavy&meet=heavy&home=many&moods=six&media=long&usage=high&box=max&focus=long';

/**
 * [screen, state name, query]. `screen` is the group in the index. `hz` and `at` freeze the
 * clock and pick the camera; `screen=` opens Meet, Zen or Dream after that.
 */
const STATES = [];
const add = (screen, name, query) => STATES.push({ screen, name, query });
const PLACES = {
  work: { hz: 'work' },
  home: { hz: 'home' },
  unwind: { hz: 'unwind' },
  meet: { hz: 'work', screen: 'meet' },
  zen: { hz: 'work', screen: 'zen' },
  dream: { hz: 'work', screen: 'dream' },
};
const url = (place, at, extra = '') => {
  const p = PLACES[place];
  return `hz=${p.hz}&at=${encodeURIComponent(at)}&clock=review${p.screen ? `&screen=${p.screen}` : ''}${extra ? `&${extra}` : ''}`;
};
const state = (place, name, extra, at = TYPICAL_AT) => add(place, name, url(place, at, extra));

for (const place of Object.keys(PLACES)) {
  state(place, 'sparse', SPARSE);
  state(place, 'typical', '');
  state(place, 'heavy', HEAVY);
  for (const [t, at] of Object.entries(TIMES)) state(place, `typical, ${t}`, '', at);
}

// Work: layout rules that change, and each data source down on its own.
for (const n of ['2', '1']) state('work', `${n} agent lane${n === '1' ? '' : 's'}`, `agents=${n}`);
state('work', 'one agent waiting', 'agents=ask');
state('work', 'long strings (fit check set)', 'long=1');
state('work', 'focus running, long title', 'focus=long');
state('work', 'music paused', 'media=paused');
state('work', 'tasks few', 'tasks=few');
state('work', 'tasks heavy (115 more)', 'tasks=heavy');
state('work', 'usage meters near full', 'usage=high');
state('work', 'machine numbers at the limit', 'box=max');
state('work', 'box numbers stale', 'box=stale');
state('work', 'box offline', 'box=none');
for (const [name, extra] of [
  ['broken: helper not set up', 'agents=off'],
  ['broken: helper not answering', 'agents=down'],
  ['broken: helper numbers stale', 'agents=stale'],
  ['broken: task app not set up', 'tasks=off'],
  ['broken: task app down', 'tasks=down'],
  ['broken: calendar not set up', 'meet=off'],
  ['broken: calendar failing', 'meet=down'],
  ['broken: calendar signed out', 'meet=signedout'],
  ['broken: calendar partly stale', 'meet=partial'],
  ['broken: media unavailable', 'media=off'],
  ['broken: weather down', 'weather=down'],
  ['broken: weather stale', 'weather=stale'],
]) {
  state('work', name, extra);
}

// Home: the network card's numbers, moods, chores.
for (const n of ['1', '2', '3']) state('home', `network card, ${n} number${n === '1' ? '' : 's'}`, `net=${n}`);
state('home', 'network card, quiet', 'home=quiet');
state('home', 'moods six', 'moods=six');
state('home', 'moods none', 'moods=none');
state('home', 'tasks heavy (115 more)', 'tasks=heavy');
state('home', 'tasks few', 'tasks=few');
for (const [name, extra] of [
  ['broken: home app not set up', 'home=off'],
  ['broken: home app down', 'home=down'],
  ['broken: moods failing', 'moods=down'],
  ['broken: task app not set up', 'tasks=off'],
  ['broken: task app down', 'tasks=down'],
  ['broken: weather down', 'weather=down'],
  ['broken: weather stale', 'weather=stale'],
]) {
  state('home', name, extra);
}
state('home', 'morning camera', '', TIMES.morning);
state('home', 'morning camera, sparse', SPARSE, TIMES.morning);

// Unwind: now playing, calendar tomorrow, the room card.
state('unwind', 'music paused', 'media=paused');
state('unwind', 'long track and artist', 'media=long');
state('unwind', 'audio demo (levels moving)', 'audio=demo');
for (const [name, extra] of [
  ['broken: media unavailable', 'media=off'],
  ['broken: calendar not set up', 'meet=off'],
  ['broken: calendar failing', 'meet=down'],
  ['broken: task app down', 'tasks=down'],
  ['broken: weather down', 'weather=down'],
]) {
  state('unwind', name, extra);
}

// Meet: the day's meetings.
state('meet', 'one meeting', 'meet=partial');
for (const [name, extra] of [
  ['broken: calendar not set up', 'meet=off'],
  ['broken: calendar failing', 'meet=down'],
  ['broken: calendar signed out', 'meet=signedout'],
]) {
  state('meet', name, extra);
}

// Zen and Dream: the focus ring and the sleep view.
state('zen', 'focus running, long title', 'focus=long');
state('dream', 'night with audio demo', 'audio=demo', TIMES.night);

const only = flag('only')?.split('=')[1]?.toLowerCase();
const selected = only ? STATES.filter((s) => `${s.screen} ${s.name}`.toLowerCase().includes(only)) : STATES;

if (flag('list')) {
  for (const s of selected) console.log(`${s.screen.padEnd(7)} ${s.name.padEnd(36)} ?${s.query}`);
  console.log(`${selected.length} states`);
  process.exit(0);
}

const chrome = process.env.WALL_CHROME || args.find((a) => !a.startsWith('--'));
if (!chrome || !existsSync(chrome)) {
  console.error('gallery: set WALL_CHROME to a Chromium or chrome-headless-shell binary.');
  process.exit(2);
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const work = mkdtempSync(join(tmpdir(), 'wall-gallery-'));
let chromeProc = null;

async function buildBundle() {
  process.env.NODE_ENV = 'development';
  const { build } = await import('vite');
  await build({
    root,
    configFile: join(root, 'vite.config.ts'),
    mode: 'development',
    base: './',
    logLevel: 'warn',
    build: {
      outDir: join(work, 'dist'),
      emptyOutDir: true,
      assetsInlineLimit: 100_000_000,
      cssCodeSplit: false,
      modulePreload: false,
      chunkSizeWarningLimit: 100_000,
      rolldownOptions: { output: { codeSplitting: false } },
    },
  });
  // One file: module scripts and stylesheets cannot load from file:// as separate files.
  const dist = join(work, 'dist');
  let html = readFileSync(join(dist, 'index.html'), 'utf8');
  html = html.replace(/<script type="module" crossorigin src="\.\/([^"]+)"><\/script>/g, (_, src) =>
    `<script type="module">${readFileSync(join(dist, src), 'utf8').replaceAll('</script', '<\\/script')}</script>`,
  );
  html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/([^"]+)">/g, (_, href) => `<style>${readFileSync(join(dist, href), 'utf8')}</style>`);
  const page = join(work, 'wall.html');
  writeFileSync(page, html);
  return pathToFileURL(page).href;
}

async function launch() {
  const profile = join(work, 'profile');
  mkdirSync(profile);
  chromeProc = spawn(
    chrome,
    ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--mute-audio', `--user-data-dir=${profile}`, '--remote-debugging-port=0', `--window-size=${W},${H + 87}`, 'about:blank'],
    { stdio: 'ignore' },
  );
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await new Promise((r) => setTimeout(r, 100));
  if (!existsSync(portFile)) throw new Error('Chromium did not start');
  const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n');
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('could not connect to the DevTools socket'));
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (p) (msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result));
    } else for (const l of listeners) l(msg);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params, sessionId }));
    });
  return { send, listeners, close: () => ws.close() };
}

/** Render one state in its own browser context (fresh storage). Returns { errors }. */
async function render(cdp, base, s, file) {
  const { browserContextId } = await cdp.send('Target.createBrowserContext');
  const errors = [];
  let sessionId;
  let targetId;
  try {
    ({ targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId }));
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
    const on = (msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        errors.push(d.exception?.description?.split('\n')[0] ?? d.text);
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        errors.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)}`);
      }
    };
    cdp.listeners.add(on);
    const to = (method, params) => cdp.send(method, params, sessionId);
    await to('Page.enable');
    await to('Runtime.enable');
    await to('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await to('Emulation.setTimezoneOverride', { timezoneId: TZ });
    await to('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await to('Page.navigate', { url: `${base}?${s.query}` });
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const check = await to('Runtime.evaluate', {
      expression: `JSON.stringify({ root: !!document.querySelector('.shell'), w: innerWidth, h: innerHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight })`,
      returnByValue: true,
    });
    const info = JSON.parse(check.result.value);
    if (!info.root) errors.push('the app did not render (no .shell)');
    if (info.w !== W || info.h !== H) errors.push(`viewport ${info.w} x ${info.h}`);
    const shot = await to('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    cdp.listeners.delete(on);
  } finally {
    try {
      if (targetId) await cdp.send('Target.closeTarget', { targetId });
      await cdp.send('Target.disposeBrowserContext', { browserContextId });
    } catch {
      /* the page is gone already */
    }
  }
  return { errors };
}

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function writeIndex(manifest) {
  const screens = [...new Set(manifest.map((m) => m.screen))];
  const sections = screens
    .map((sc) => {
      const items = manifest.filter((m) => m.screen === sc);
      const cards = items
        .map(
          (m) => `<figure id="${esc(m.file.replace('.png', ''))}"><a href="${esc(m.file)}"><img loading="lazy" src="${esc(m.file)}" width="${m.width}" height="${m.height}" alt="${esc(sc)}: ${esc(m.state)}"></a><figcaption><b>${esc(m.state)}</b>${m.error ? ` <em>FAILED: ${esc(m.error)}</em>` : ''}<code>?${esc(m.url)}</code></figcaption></figure>`,
        )
        .join('\n');
      return `<section id="${esc(sc)}"><h2>${esc(sc)} <small>${items.length}</small></h2>\n${cards}</section>`;
    })
    .join('\n');
  const nav = screens.map((sc) => `<a href="#${esc(sc)}">${esc(sc)}</a>`).join(' ');
  writeFileSync(
    join(outDir, 'index.html'),
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wall 2 state gallery</title>
<style>
body{margin:0;background:#14161b;color:#d8dce4;font:15px/1.4 system-ui,sans-serif}
header{position:sticky;top:0;background:#14161bee;padding:10px 20px;border-bottom:1px solid #2a2f3a;z-index:1}
header a{color:#8fb4ff;margin-right:14px;text-decoration:none}
h1{font-size:16px;margin:0 0 6px}
section{padding:10px 20px}
h2{text-transform:capitalize;margin:24px 0 8px}h2 small{color:#7b8394;font-weight:400}
figure{margin:0 0 22px}
img{width:100%;max-width:1280px;height:auto;display:block;border:1px solid #2a2f3a;background:#000}
figcaption{padding-top:6px;max-width:1280px}
code{display:block;color:#7b8394;font-size:12px;word-break:break-all}
em{color:#ff8a8a}
</style></head><body>
<header><h1>Wall 2 state gallery: ${manifest.length} stills at ${W} x ${H}</h1>${nav}</header>
${sections}
</body></html>
`,
  );
}

try {
  console.log('gallery: building the development bundle');
  const base = await buildBundle();
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const cdp = await launch();
  const manifest = new Array(selected.length);
  let failures = 0;
  let next = 0;
  const used = new Set();
  const names = selected.map((s) => {
    let f = `${slug(s.screen)}--${slug(s.name)}`;
    while (used.has(f)) f += '-2';
    used.add(f);
    return `${f}.png`;
  });
  async function worker() {
    while (next < selected.length) {
      const i = next++;
      const s = selected[i];
      const file = names[i];
      let error = null;
      try {
        const r = await Promise.race([
          render(cdp, base, s, join(outDir, file)),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), STATE_TIMEOUT_MS)),
        ]);
        if (r.errors.length) error = [...new Set(r.errors)].slice(0, 3).join(' | ');
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      if (error) failures++;
      manifest[i] = { screen: s.screen, state: s.name, url: s.query, file, width: W, height: H, ...(error ? { error } : {}) };
      console.log(`${error ? 'FAIL' : 'ok  '} ${s.screen.padEnd(7)} ${s.name.padEnd(36)} ${file}${error ? `  ${error}` : ''}`);
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  cdp.close();
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeIndex(manifest);
  const stills = readdirSync(outDir).filter((f) => f.endsWith('.png')).length;
  console.log(`gallery: ${stills} stills, ${failures} failed. ${join(outDir, 'index.html')}`);
  process.exitCode = failures ? 1 : 0;
} finally {
  chromeProc?.kill();
  rmSync(work, { recursive: true, force: true });
}
