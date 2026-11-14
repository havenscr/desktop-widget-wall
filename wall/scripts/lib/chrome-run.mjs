// Runs one-shot headless Chromium commands for the review scripts with a time limit.
//
// Now and then the browser loses its page process and then waits for ever (a headless browser
// in dump mode does not exit by itself after that). Each run therefore has a time limit; on a
// timeout the WHOLE browser (its own child processes too) is killed and the run is tried again,
// up to three tries in all. Only processes this module started are ever killed: each browser
// runs in its own process group (on Windows the tree is stopped with taskkill) and the group is
// killed by its id, never by program name, and only while the browser is still running (an id
// of a process that has gone may belong to someone else by now).
//
// Temporary files: every try gets its own temporary folder, made here and handed to the browser
// as its temporary location (TMPDIR, TEMP and TMP). Chromium keeps its own `org.chromium.*`
// scratch folder there, so a killed browser leaves nothing in the system temporary folder, and
// the folder is removed after the browser has stopped. This was chosen over `--user-data-dir`
// because this Chromium build never exits in dump mode when that flag is given, so the page's
// behaviour and output would change.
//
// WALL_CHROME_LIMIT_MS=<ms> replaces the time limit per try of EVERY caller (the default is 45 s;
// echo-calm asks for 240 s and fit:home for 90 s, and the variable replaces those too).
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_LIMIT_MS = 45_000;
const TRIES = 3;
const live = new Set();
const cleanups = new Set();
let hooked = false;

/** Thrown after the last try failed (or the browser could not run at all). The caller prints and sets its exit code. */
export class ChromeRunError extends Error {
  constructor(message, { crashed = false } = {}) {
    super(message);
    this.name = 'ChromeRunError';
    this.crashed = crashed; // the browser itself died (a signal or a non-zero exit): worth another try
  }
}

/** True only for a child that is still running and has a real process id (a positive whole number). */
export function canKill(child) {
  return !!child && Number.isInteger(child.pid) && child.pid > 0 && child.exitCode === null && child.signalCode === null;
}

function defaultKill(pid) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else process.kill(-pid, 'SIGKILL');
}

/** Kill a running child and everything it started. Does nothing for a child that has exited. `kill` is for tests. */
export function killTree(child, kill = defaultKill) {
  if (!canKill(child)) return false;
  try {
    kill(child.pid);
  } catch {
    /* already gone */
  }
  return true;
}

/** Register work to do when the script exits or is interrupted (for example removing its temporary folder). Must be quick and safe to run twice. */
export function onCleanup(fn) {
  hook();
  cleanups.add(fn);
}

function cleanupAll() {
  for (const rec of live) {
    killTree(rec.child);
    rmSync(rec.dir, { recursive: true, force: true });
  }
  live.clear();
  for (const fn of cleanups) {
    try {
      fn();
    } catch {
      /* best effort */
    }
  }
}

function hook() {
  if (hooked) return;
  hooked = true;
  process.on('exit', cleanupAll);
  for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
    process.on(sig, () => {
      cleanupAll();
      process.exit(code);
    });
  }
}

function stopped(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once('exit', resolve);
  });
}

async function once(chrome, args, limitMs, maxBuffer, hang) {
  const dir = mkdtempSync(join(tmpdir(), 'wall-chrome-'));
  const cmd = hang ? process.execPath : chrome;
  const argv = hang
    ? ['-e', "require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1e3)'],{stdio:'ignore'});setInterval(()=>{},1e3)"]
    : args;
  const child = spawn(cmd, argv, {
    stdio: ['ignore', 'pipe', 'ignore'],
    detached: process.platform !== 'win32',
    env: { ...process.env, TMPDIR: dir, TEMP: dir, TMP: dir },
  });
  const rec = { child, dir };
  live.add(rec);
  try {
    return await new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      let over = false;
      const timer = setTimeout(() => resolve({ timedOut: true, child }), limitMs);
      child.stdout.on('data', (d) => {
        size += d.length;
        if (size > maxBuffer) over = true;
        else chunks.push(d);
      });
      child.once('error', (e) => {
        clearTimeout(timer);
        reject(new ChromeRunError(`the browser could not start: ${e.message}`));
      });
      child.once('close', (code, sig) => {
        clearTimeout(timer);
        if (over) reject(new ChromeRunError('the browser printed more than the allowed output'));
        else if (code !== 0) reject(new ChromeRunError(`the browser exited with ${sig ?? `code ${code}`}`, { crashed: true }));
        else resolve({ out: Buffer.concat(chunks).toString('utf8') });
      });
    });
  } finally {
    killTree(child); // a no-op when it has already exited
    live.delete(rec); // forget the handle: no later hook can reach it
    await Promise.race([stopped(child), new Promise((r) => setTimeout(r, 5000))]);
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

/**
 * Run `chrome args` and return its standard output. `label` names the state in messages.
 * `limitMs` is the time limit per try (default 45 s). After the last try a ChromeRunError is thrown.
 * `hang` is for the proof script only: the first `hang` tries are replaced by a process that sleeps for ever.
 */
export async function runChrome(chrome, args, { label = '', maxBuffer = 64 * 1024 * 1024, limitMs: limit = DEFAULT_LIMIT_MS, hang = 0 } = {}) {
  hook();
  const limitMs = Number(process.env.WALL_CHROME_LIMIT_MS || limit);
  const secs = Math.round(limitMs / 1000);
  const name = label ? ` (${label})` : '';
  for (let n = 1; n <= TRIES; n++) {
    let r;
    try {
      r = await once(chrome, args, limitMs, maxBuffer, n <= hang);
    } catch (e) {
      // A browser that crashed (for example with SIGTRAP on a busy machine) is tried again like one that hung.
      if (!(e instanceof ChromeRunError) || !e.crashed) throw e;
      if (n < TRIES) {
        console.log(`  retry ${n}: ${e.message}${name}`);
        continue;
      }
      throw new ChromeRunError(`${e.message} on all ${TRIES} tries${name}`);
    }
    if (!r.timedOut) return r.out;
    if (n < TRIES) console.log(`  retry ${n}: the browser did not answer in ${secs} s${name}`);
  }
  throw new ChromeRunError(`the browser did not answer in ${secs} s after ${TRIES} tries${name}`);
}
