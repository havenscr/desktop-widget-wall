// Runs one-shot headless Chromium commands for the review scripts with a time limit.
//
// Now and then the browser loses its page process and then waits for ever (a headless browser
// in dump mode does not exit by itself after that). Each run therefore has a time limit; on a
// timeout the WHOLE browser (its own child processes too) is killed and the run is tried again,
// up to three tries in all. Only processes this module started are ever killed: each browser
// runs in its own process group (on Windows the tree is stopped with taskkill) and the group is
// killed by its id, never by program name. No --user-data-dir is passed: this Chromium build
// never exits in dump mode when one is given, so the browser keeps its own temporary profile.
//
// Test knobs (not used in a normal run):
//   WALL_CHROME_LIMIT_MS=<ms>  time limit per try (default 45000)
//   WALL_CHROME_HANG=<n>       the first n tries of the first run are replaced by a process
//                              (with a child of its own) that sleeps for ever
import { spawn, spawnSync } from 'node:child_process';

const DEFAULT_LIMIT_MS = 45_000;
const TRIES = 3;
const live = new Set();
let hooked = false;
let hangLeft = Number(process.env.WALL_CHROME_HANG || 0);

/** Kill a child and everything it started. Safe to call twice. */
export function killTree(child) {
  if (!child || child.pid === undefined) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

function killAll() {
  for (const c of live) killTree(c.child);
}

function hook() {
  if (hooked) return;
  hooked = true;
  process.on('exit', killAll);
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      killAll();
      process.exit(sig === 'SIGINT' ? 130 : 143);
    });
  }
}

function once(chrome, args, limitMs, maxBuffer, hang) {
  return new Promise((resolve, reject) => {
    const cmd = hang ? process.execPath : chrome;
    const argv = hang
      ? ['-e', "require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1e3)'],{stdio:'ignore'});setInterval(()=>{},1e3)"]
      : args;
    const child = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'ignore'], detached: process.platform !== 'win32' });
    const rec = { child };
    live.add(rec);
    const chunks = [];
    let size = 0;
    let over = false;
    let settled = false;
    const done = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killTree(child);
      live.delete(rec);
      fn(val);
    };
    const timer = setTimeout(() => done(resolve, { timedOut: true }), limitMs);
    child.stdout.on('data', (d) => {
      size += d.length;
      if (size > maxBuffer) over = true;
      else chunks.push(d);
    });
    child.once('error', (e) => done(reject, e));
    child.once('close', (code, sig) => {
      if (over) done(reject, new Error('the browser printed more than the allowed output'));
      else if (code !== 0) done(reject, new Error(`the browser exited with ${sig ?? `code ${code}`}`));
      else done(resolve, { out: Buffer.concat(chunks).toString('utf8') });
    });
  });
}

/**
 * Run `chrome args` and return its standard output. `label` names the state in messages.
 * `limitMs` is the time limit per try (default 45 s). With `exitOnFail` a failure prints one line
 * and exits 1; otherwise it throws.
 */
export async function runChrome(chrome, args, { label = '', maxBuffer = 64 * 1024 * 1024, exitOnFail = false, limitMs: limit = DEFAULT_LIMIT_MS } = {}) {
  hook();
  const limitMs = Number(process.env.WALL_CHROME_LIMIT_MS || limit);
  const secs = Math.round(limitMs / 1000);
  const name = label ? ` (${label})` : '';
  let error = null;
  for (let n = 1; n <= TRIES; n++) {
    const hang = hangLeft > 0;
    if (hang) hangLeft -= 1;
    let r;
    try {
      r = await once(chrome, args, limitMs, maxBuffer, hang);
    } catch (e) {
      error = e;
      break;
    }
    if (!r.timedOut) return r.out;
    if (n < TRIES) console.log(`  retry ${n}: the browser did not answer in ${secs} s${name}`);
    else error = new Error(`the browser did not answer in ${secs} s after ${TRIES} tries${name}`);
  }
  if (exitOnFail) {
    console.error(`  FAIL ${error.message}`);
    process.exit(1);
  }
  throw error;
}
