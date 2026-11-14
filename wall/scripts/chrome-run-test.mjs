// Proves the browser time limit of the review scripts (scripts/lib/chrome-run.mjs).
//
//   npm --prefix wall run chrome-run-test                      (a stand-in browser: a small node program)
//   WALL_CHROME=/path/to/chrome npm --prefix wall run chrome-run-test   (also runs a real page)
//
// Part 1, pure parts: only a running child with a positive whole-number pid is ever passed to a kill.
// Part 2, hangs: the first two tries hang; the hang is noticed at the limit, the third try succeeds,
// the exit code is 0. With three hangs the run fails with a non-zero exit and one clear line. In both
// cases the test records the process ids and process group ids of the sleeper and its own child, asserts
// the parent and child relationship and one owned group, and asserts afterwards that every recorded
// process id is gone. Every case runs in its own node process with its own temporary folder
// (TMPDIR), which must be empty afterwards.
// Part 3, only with WALL_CHROME: a real page killed by a very short limit leaves no process and no
// temporary folder behind.
// Not for Windows (uses ps).
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canKill, killTree, runChrome, ChromeRunError } from './lib/chrome-run.mjs';

const here = fileURLToPath(import.meta.url);
const real = process.env.WALL_CHROME;
const PAGE = 'data:text/html,<p id=x>fine</p>';
const standIn = [process.execPath, ['-e', "console.log('<html><body><p id=\"x\">fine</p></body></html>')"]];

if (process.argv.includes('--child')) {
  const mode = process.argv[process.argv.indexOf('--child') + 1];
  const [cmd, args] = real ? [real, ['--headless', '--no-sandbox', '--disable-gpu', '--dump-dom', PAGE]] : standIn;
  const opts = { label: 'test state', limitMs: 4000, hang: mode === 'hang2' ? 2 : mode === 'hang3' ? 3 : 0 };
  if (mode === 'realkill') opts.limitMs = 150;
  if (mode === 'ok') opts.limitMs = 30000;
  try {
    const out = await runChrome(cmd, args, opts);
    console.log(out.includes('id="x"') ? 'child: the page was dumped' : 'child: wrong output');
    process.exitCode = out.includes('id="x"') ? 0 : 1;
  } catch (e) {
    if (!(e instanceof ChromeRunError)) throw e;
    console.error(`  FAIL ${e.message}`);
    process.exitCode = 1;
  }
  process.exit(process.exitCode);
}

let failed = false;
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed = true;
};

// ---- part 1: the pure parts
console.log('which processes may be killed:');
const running = { pid: 4242, exitCode: null, signalCode: null };
const calls = [];
const rec = (pid) => calls.push(pid);
const never = [
  ['an exited child', { pid: 4242, exitCode: 0, signalCode: null }],
  ['a child killed by a signal', { pid: 4242, exitCode: null, signalCode: 'SIGKILL' }],
  ['pid 0', { pid: 0, exitCode: null, signalCode: null }],
  ['a negative pid', { pid: -4242, exitCode: null, signalCode: null }],
  ['a non-integer pid', { pid: 42.5, exitCode: null, signalCode: null }],
  ['a text pid', { pid: '4242', exitCode: null, signalCode: null }],
  ['an undefined pid', { pid: undefined, exitCode: null, signalCode: null }],
  ['no child', null],
];
for (const [what, child] of never) {
  killTree(child, rec);
  check(!canKill(child), `${what} is never killed`);
}
check(calls.length === 0, 'no kill was issued for any of them');
check(killTree(running, rec) === true && calls.length === 1 && calls[0] === 4242, 'a running child with a positive whole pid is killed, by that pid');
const done = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' });
await new Promise((r) => done.once('exit', r));
const before = calls.length;
killTree(done, rec);
check(calls.length === before, 'a real child that has exited is never killed');

// ---- processes
const snapshot = () =>
  (spawnSync('ps', ['-eo', 'pid=,ppid=,pgid=,args='], { encoding: 'utf8' }).stdout ?? '')
    .split('\n')
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => ({ pid: +m[1], ppid: +m[2], pgid: +m[3], args: m[4] }));
const descendants = (all, root) => {
  const found = [];
  const seen = new Set([root]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of all) if (seen.has(p.ppid) && !seen.has(p.pid)) (seen.add(p.pid), found.push(p), (grew = true));
  }
  return found;
};
const gone = async (pid) => {
  for (let i = 0; i < 20; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};

async function runCase(mode) {
  const tmp = mkdtempSync(join(tmpdir(), 'wall-chrome-test-'));
  const child = spawn(process.execPath, [here, '--child', mode], { env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp } });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => (stdout += d));
  child.stderr.on('data', (d) => (stderr += d));
  const seen = new Map();
  let firstPair = null;
  const t0 = Date.now();
  const poll = setInterval(() => {
    const all = snapshot();
    const d = descendants(all, child.pid);
    for (const p of d) seen.set(p.pid, p);
    const sleeper = d.find((p) => p.ppid === child.pid);
    const kid = sleeper && d.find((p) => p.ppid === sleeper.pid);
    if (!firstPair && sleeper && kid && mode !== 'realkill') firstPair = { sleeper, kid, ownerGroup: all.find((p) => p.pid === child.pid)?.pgid };
  }, 200);
  const status = await new Promise((r) => child.once('close', r));
  clearInterval(poll);
  const secs = (Date.now() - t0) / 1000;
  for (const l of `${stdout}${stderr}`.trimEnd().split('\n')) console.log(`    | ${l}`);
  const pids = [...seen.keys()];
  console.log(`  recorded ${pids.length} process(es) of this run: ${pids.join(', ') || 'none'}`);
  const left = [];
  for (const pid of pids) if (!(await gone(pid))) left.push(pid);
  const leftovers = readdirSync(tmp);
  rmSync(tmp, { recursive: true, force: true });
  return { status, stdout, stderr, secs, seen, firstPair, left, leftovers };
}

for (const mode of ['hang2', 'hang3']) {
  console.log(`${mode === 'hang2' ? 'two hangs then a good run' : 'three hangs'}, limit 4 s:`);
  const r = await runCase(mode);
  const { sleeper, kid, ownerGroup } = r.firstPair ?? {};
  check(!!r.firstPair, 'the sleeper and its own child were seen while the first try hung');
  if (r.firstPair) {
    check(kid.ppid === sleeper.pid, `the child (${kid.pid}) belongs to the sleeper (${sleeper.pid})`);
    check(sleeper.pgid === sleeper.pid && kid.pgid === sleeper.pid, `one owned group: both are in group ${sleeper.pid}, which the sleeper leads`);
    check(sleeper.pgid !== ownerGroup, 'the group is not the starting script\'s own group');
  }
  if (mode === 'hang2') {
    const retries = (r.stdout.match(/^ {2}retry \d: the browser did not answer in 4 s \(test state\)$/gm) ?? []).length;
    check(r.status === 0, `exit code 0 (got ${r.status})`);
    check(retries === 2, `two retry lines (got ${retries})`);
    check(r.secs >= 8 && r.secs < 8 + 12, `hangs noticed at the limit: ${r.secs.toFixed(1)} s for two 4 s waits plus one run`);
    check(r.seen.size >= 4, `both hung tries had a sleeper and a child (${r.seen.size} recorded)`);
  } else {
    check(r.status === 1, `exit code 1 (got ${r.status})`);
    check(/FAIL the browser did not answer in 4 s after 3 tries \(test state\)/.test(r.stderr), 'the failure line names the state');
  }
  check(r.left.length === 0, `every recorded process id is gone${r.left.length ? ` (still there: ${r.left.join(', ')})` : ''}`);
  check(r.leftovers.length === 0, `its temporary folder is empty${r.leftovers.length ? ` (left: ${r.leftovers.join(', ')})` : ''}`);
}

// ---- part 3: the real browser
if (real) {
  console.log('a real page killed by a 150 ms limit:');
  const r = await runCase('realkill');
  check(r.status === 1, `exit code 1 (got ${r.status}); the limit was far too short for a real page`);
  check(r.left.length === 0, `every recorded process id is gone${r.left.length ? ` (still there: ${r.left.join(', ')})` : ''}`);
  check(r.leftovers.length === 0, `no temporary folder of its own is left behind${r.leftovers.length ? ` (left: ${r.leftovers.join(', ')})` : ''}`);
  const ok = await runCase('ok');
  check(ok.status === 0 && ok.stdout.includes('the page was dumped'), 'the same page with the normal limit is dumped');
  check(ok.leftovers.length === 0, 'and leaves no temporary folder either');
} else {
  console.log('real browser case skipped: WALL_CHROME is not set');
}
process.exit(failed ? 1 : 0);
