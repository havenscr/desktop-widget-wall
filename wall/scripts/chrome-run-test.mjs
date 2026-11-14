// Proves the browser time limit of the review scripts (scripts/lib/chrome-run.mjs).
//
//   WALL_CHROME=/path/to/chrome npm --prefix wall run chrome-run-test
//
// Case 1: the first two tries hang (WALL_CHROME_HANG=2); the hang must be noticed at the limit,
// the third try must succeed, the exit code must be 0 and no process may be left behind.
// Case 2: three hangs; the run must fail with a non-zero exit. Each case runs in its own node
// process and the process list is printed before and after. Not for Windows (uses ps).
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runChrome } from './lib/chrome-run.mjs';

const chrome = process.env.WALL_CHROME;
if (!chrome) {
  console.error('chrome-run-test: set WALL_CHROME to a Chromium or chrome-headless-shell binary.');
  process.exit(2);
}
const MARK = 'setInterval(()=>{},1e3)';
const here = fileURLToPath(import.meta.url);

if (process.argv.includes('--child')) {
  const out = await runChrome(chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--dump-dom', 'data:text/html,<p id=x>fine</p>'], { label: 'test state', exitOnFail: true });
  console.log(out.includes('id="x"') ? 'child: the page was dumped' : 'child: wrong output');
  process.exit(out.includes('id="x"') ? 0 : 1);
}

const procs = () => (spawnSync('ps', ['-eo', 'pid,ppid,pgid,etimes,args'], { encoding: 'utf8' }).stdout ?? '').split('\n').filter((l) => /^\s*\d+\s+\d+\s+\d+\s+\d+\s+\S*node\S* -e /.test(l) ? l.includes(MARK) : l.includes('--dump-dom data:text/html,<p id=x>fine'));
const show = (title, list) => console.log(`  ${title}: ${list.length ? `\n    ${list.join('\n    ')}` : 'none'}`);
let failed = false;
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed = true;
};

for (const hangs of [2, 3]) {
  console.log(`${hangs} hang(s) in a row, limit 4 s:`);
  const before = procs();
  show('processes before', before);
  const t0 = Date.now();
  const child = spawn(process.execPath, [here, '--child'], { env: { ...process.env, WALL_CHROME_HANG: String(hangs), WALL_CHROME_LIMIT_MS: '4000' } });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => (stdout += d));
  child.stderr.on('data', (d) => (stderr += d));
  await new Promise((r) => setTimeout(r, 2000));
  show('processes while the first try hangs (a sleeper and its own child)', procs());
  const status = await new Promise((r) => child.once('close', r));
  const secs = (Date.now() - t0) / 1000;
  const r = { status, stdout, stderr };
  for (const l of `${stdout}${stderr}`.trimEnd().split('\n')) console.log(`    | ${l}`);
  const retries = (r.stdout.match(/^ {2}retry \d: the browser did not answer in 4 s \(test state\)$/gm) ?? []).length;
  const after = procs();
  show('processes after', after);
  if (hangs === 2) {
    check(r.status === 0, `exit code 0 (got ${r.status})`);
    check(retries === 2, `two retry lines (got ${retries})`);
    check(secs >= 8 && secs < 8 + 12, `hangs noticed at the limit: ${secs.toFixed(1)} s for two 4 s waits plus one real run`);
  } else {
    check(r.status === 1, `exit code 1 (got ${r.status})`);
    check(/FAIL the browser did not answer in 4 s after 3 tries \(test state\)/.test(r.stderr), 'the failure line names the state');
  }
  check(after.length === before.length, 'no process left behind');
}
process.exit(failed ? 1 : 0);
