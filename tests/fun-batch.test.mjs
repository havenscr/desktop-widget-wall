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

// ---------- Next event pick (declined filter) ----------
const pick = loadBlock('calendar.js', 'next-event-pick');
const at = (h, m = 0) => `2026-10-23T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
const ev = (id, h, extra = {}) => ({ id, start: { dateTime: at(h) }, end: { dateTime: at(h + 1) }, ...extra });
const nine = new Date(at(9));

test('pick: declined meetings are skipped for current and next', () => {
  const events = [
    ev('now-declined', 9, { responseStatus: { response: 'declined' } }),
    ev('later-declined', 10, { responseStatus: { response: 'declined' } }),
    ev('later', 11),
  ];
  const { currentEvent, nextEvent } = pick.pickCardEvents(events, nine);
  assert.equal(currentEvent, undefined);
  assert.equal(nextEvent.id, 'later');
});

test('pick: tentative, organizer, none and missing responses all count', () => {
  for (const responseStatus of [{ response: 'tentativelyAccepted' }, { response: 'organizer' }, { response: 'none' }, undefined]) {
    const { nextEvent } = pick.pickCardEvents([ev('x', 10, { responseStatus })], nine);
    assert.equal(nextEvent?.id, 'x');
  }
});

test('pick: a declined event alone today leaves no card event', () => {
  const { currentEvent, nextEvent } = pick.pickCardEvents([ev('only', 10, { responseStatus: { response: 'declined' } })], nine);
  assert.equal(currentEvent, undefined);
  assert.equal(nextEvent, undefined);
  // Nothing for the ring either, since the ring follows the card's next event.
  assert.equal(ring.isRingEligible(nextEvent), false);
});

test('pick: all-day events and an empty or signed-out cache give nothing', () => {
  assert.equal(pick.pickCardEvents([ev('bday', 10, { isAllDay: true })], nine).nextEvent, undefined);
  assert.equal(pick.pickCardEvents([], nine).nextEvent, undefined);
  assert.equal(pick.pickCardEvents(null, nine).nextEvent, undefined);
});

// ---------- Focus Do Not Disturb flag ----------
function dndEnv({ tauri = true, failing = false, state } = {}) {
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
    core: {
      invoke: async (cmd) => {
        calls.push(cmd);
        if (cmd === 'get_do_not_disturb') {
          if (state instanceof Error) throw state;
          return state;
        }
        if (failing) throw new Error('boom');
      },
    },
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
  assert.deepEqual(calls, ['get_do_not_disturb', 'enable_do_not_disturb', 'disable_do_not_disturb']);
});

test('dnd: Do Not Disturb already on is left alone through start and pause', async () => {
  const { ctx, saved, calls } = dndEnv({ state: true });
  await ctx.focusDndEnable();
  assert.equal(saved.has('focus-dnd-active'), false);
  await ctx.focusDndRelease();
  assert.deepEqual(calls, ['get_do_not_disturb']);
});

test('dnd: Do Not Disturb off at start is enabled and owned', async () => {
  const { ctx, saved, calls } = dndEnv({ state: false });
  await ctx.focusDndEnable();
  assert.equal(saved.get('focus-dnd-active'), '1');
  assert.deepEqual(calls, ['get_do_not_disturb', 'enable_do_not_disturb']);
});

test('dnd: unreadable state (null or a failed read) keeps the old enable path', async () => {
  for (const state of [null, new Error('no wnf')]) {
    const { ctx, saved, calls } = dndEnv({ state });
    await ctx.focusDndEnable();
    assert.equal(saved.get('focus-dnd-active'), '1');
    assert.deepEqual(calls, ['get_do_not_disturb', 'enable_do_not_disturb']);
  }
});

test('dnd: pause while the state read is pending never enables', async () => {
  const { ctx, saved, calls } = dndEnv({ state: false });
  const starting = ctx.focusDndEnable();
  await ctx.focusDndRelease();
  await starting;
  assert.equal(saved.has('focus-dnd-active'), false);
  assert.deepEqual(calls, ['get_do_not_disturb']);
});

test('dnd: pause during the enable runs the disable after it', async () => {
  const { ctx, saved, calls } = dndEnv({ state: false });
  const starting = ctx.focusDndEnable();
  await new Promise((r) => setImmediate(r));
  await ctx.focusDndRelease();
  await starting;
  assert.equal(saved.has('focus-dnd-active'), false);
  assert.deepEqual(calls, ['get_do_not_disturb', 'enable_do_not_disturb', 'disable_do_not_disturb']);
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
