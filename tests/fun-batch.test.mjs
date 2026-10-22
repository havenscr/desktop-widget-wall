import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const widget = (name) => readFileSync(new URL(`../src/public/scripts/widgets/${name}`, import.meta.url), 'utf8');

// Pull a marked block out of a widget script and run it in a small sandbox.
function loadBlock(file, tag, sandbox = {}) {
  const src = widget(file);
  const start = src.indexOf(`// <${tag}>`);
  const end = src.indexOf(`// </${tag}>`);
  assert.ok(start >= 0 && end > start, `block ${tag} present`);
  const context = vm.createContext(sandbox);
  context.window = context;
  vm.runInContext(src.slice(start, end), context);
  return context;
}

// ---------- Meeting ring ----------
const MIN = 60 * 1000;
const ring = loadBlock('calendar.js', 'meeting-ring-plan');

test('ring: far meeting waits until 5 minutes before', () => {
  const plan = ring.computeMeetingRingPlan(60 * MIN, 0);
  assert.equal(plan.phase, 'none');
  assert.equal(plan.toSoon, 55 * MIN);
});

test('ring: within 5 minutes pulses, then goes urgent at 1 minute, ends at start', () => {
  const plan = ring.computeMeetingRingPlan(5 * MIN, 0);
  assert.equal(plan.phase, 'soon');
  assert.equal(plan.toUrgent, 4 * MIN);
  assert.equal(plan.toEnd, 5 * MIN);
});

test('ring: meeting under 1 minute away is urgent immediately', () => {
  const plan = ring.computeMeetingRingPlan(30 * 1000, 0);
  assert.equal(plan.phase, 'urgent');
  assert.equal(plan.toEnd, 30 * 1000);
});

test('ring: started or invalid meetings have no ring', () => {
  assert.equal(ring.computeMeetingRingPlan(0, 0).phase, 'none');
  assert.equal(ring.computeMeetingRingPlan(-MIN, 0).phase, 'none');
  assert.equal(ring.computeMeetingRingPlan(NaN, 0).phase, 'none');
  assert.equal(ring.computeMeetingRingPlan(-MIN, 0).toSoon, null);
});

test('ring: skips all-day, cancelled, declined and signed-out data', () => {
  const ok = { start: { dateTime: '2026-10-21T10:00:00' } };
  assert.equal(ring.isRingEligible(ok), true);
  assert.equal(ring.isRingEligible({ ...ok, isAllDay: true }), false);
  assert.equal(ring.isRingEligible({ ...ok, isCancelled: true }), false);
  assert.equal(ring.isRingEligible({ ...ok, responseStatus: { response: 'declined' } }), false);
  assert.equal(ring.isRingEligible(null), false);
  assert.equal(ring.isRingEligible({}), false);
});

// ---------- Focus Do Not Disturb flag ----------
function dndEnv({ tauri = true, failing = false } = {}) {
  const saved = new Map();
  const calls = [];
  const sandbox = {
    localStorage: {
      getItem: (k) => saved.get(k) ?? null,
      setItem: (k, v) => saved.set(k, String(v)),
      removeItem: (k) => saved.delete(k),
    },
    dlog: () => {},
  };
  const ctx = loadBlock('countdown.js', 'focus-dnd', sandbox);
  ctx.__TAURI__ = tauri ? {
    core: { invoke: async (cmd) => { calls.push(cmd); if (failing) throw new Error('boom'); } },
  } : undefined;
  return { ctx, saved, calls };
}

test('dnd: enable sets the flag, release clears it and disables once', async () => {
  const { ctx, saved, calls } = dndEnv();
  await ctx.focusDndEnable();
  assert.equal(saved.get('focus-dnd-active'), '1');
  await ctx.focusDndEnable(); // already held: no second call
  await ctx.focusDndRelease();
  assert.equal(saved.has('focus-dnd-active'), false);
  assert.deepEqual(calls, ['enable_do_not_disturb', 'disable_do_not_disturb']);
});

test('dnd: release without our flag never touches the user\'s own Do Not Disturb', async () => {
  const { ctx, calls } = dndEnv();
  await ctx.focusDndRelease();
  assert.deepEqual(calls, []);
});

test('dnd: failed enable leaves no flag', async () => {
  const { ctx, saved } = dndEnv({ failing: true });
  await ctx.focusDndEnable();
  assert.equal(saved.has('focus-dnd-active'), false);
});

test('dnd: failed disable still clears the flag', async () => {
  const { ctx, saved } = dndEnv({ failing: true });
  saved.set('focus-dnd-active', '1');
  await ctx.focusDndRelease();
  assert.equal(saved.has('focus-dnd-active'), false);
});

test('dnd: browser preview without Tauri is a no-op', async () => {
  const { ctx, saved } = dndEnv({ tauri: false });
  await ctx.focusDndEnable();
  assert.equal(saved.has('focus-dnd-active'), false);
  await ctx.focusDndRelease();
});

// ---------- Album palette ----------
const np = loadBlock('now-playing.js', 'np-palette');
const defaults = [{ r: 128, g: 64, b: 192 }];
const hexOk = (h) => /^#[0-9a-f]{6}$/.test(h);

test('palette: vivid cover gives three hex colors', () => {
  const p = np.buildAlbumPalette([{ r: 200, g: 30, b: 40 }, { r: 20, g: 90, b: 200 }, { r: 240, g: 200, b: 20 }], defaults);
  assert.ok(hexOk(p.primary) && hexOk(p.secondary) && hexOk(p.accent));
});

test('palette: grey, failed extraction and empty input fall back to the theme', () => {
  assert.equal(np.buildAlbumPalette([{ r: 120, g: 120, b: 120 }, { r: 30, g: 30, b: 31 }], defaults), null);
  assert.equal(np.buildAlbumPalette(defaults, defaults), null);
  assert.equal(np.buildAlbumPalette([], defaults), null);
  assert.equal(np.buildAlbumPalette(null, defaults), null);
});

test('palette: near-black colored cover is lifted to a lively lightness', () => {
  const p = np.buildAlbumPalette([{ r: 40, g: 5, b: 10 }, { r: 5, g: 10, b: 40 }, { r: 10, g: 40, b: 5 }], defaults);
  const lum = (h) => { const n = parseInt(h.slice(1), 16); return Math.max(n >> 16, (n >> 8) & 255, n & 255); };
  assert.ok(lum(p.primary) > 150, 'primary is bright enough');
});

test('ring: follows the card, no ring while an in-progress event is shown', () => {
  const a = { id: 'a' };
  const b = { id: 'b' };
  assert.equal(ring.pickRingEvent(b, b), b);
  assert.equal(ring.pickRingEvent(a, b), null);
  assert.equal(ring.pickRingEvent(null, null), null);
});

test('palette: a stale request is not current once a newer one begins', () => {
  const gate = np.createLatestGate();
  const first = gate.begin();
  const second = gate.begin();
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
});
