import { expect, it, vi } from 'vitest';
import { createLightStepper } from './lights';

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function deps(over: { on?: () => boolean; nudge?: (d: 'up' | 'down') => Promise<boolean> } = {}) {
  const sent: string[] = [];
  return {
    sent,
    d: {
      officeMoodOn: over.on ?? (() => true),
      nudge:
        over.nudge ??
        (async (dir: 'up' | 'down') => {
          sent.push(dir);
          return true;
        }),
    },
  };
}

it('acts only when an Office mood is on', async () => {
  const { sent, d } = deps({ on: () => false });
  const s = createLightStepper(d);
  for (const p of [0.1, 0.3, 0.6, 0.9, 1]) s.tick(p);
  await flush();
  expect(sent).toEqual([]);
  expect(s.taken).toBe(0);
});

it('steps down at 25, 50 and 75 percent, never before', async () => {
  const { sent, d } = deps();
  const s = createLightStepper(d);
  s.tick(0.2);
  await flush();
  expect(sent).toEqual([]);
  s.tick(0.26);
  await flush();
  expect(sent).toEqual(['down']);
  s.tick(0.5);
  await flush();
  expect(sent).toEqual(['down', 'down']);
});

it('takes at most three steps, however often it is ticked', async () => {
  const { sent, d } = deps();
  const s = createLightStepper(d);
  for (let i = 0; i <= 200; i++) s.tick(i / 100);
  await flush();
  expect(sent).toEqual(['down', 'down', 'down']);
  expect(s.taken).toBe(3);
});

it('a refusal is silent and ends the stepping for good', async () => {
  let n = 0;
  const calls: string[] = [];
  const { d } = deps({
    nudge: async (dir) => {
      calls.push(dir);
      n += 1;
      return n < 2;
    },
  });
  const s = createLightStepper(d);
  s.tick(0.3);
  await flush();
  expect(() => s.tick(0.55)).not.toThrow();
  await flush();
  s.tick(0.8);
  s.tick(1);
  await flush();
  expect(calls).toEqual(['down', 'down']);
  expect(s.taken).toBe(1);
});

it('a nudge that throws counts as a refusal and is not shown', async () => {
  const nudge = vi.fn(async () => {
    throw new Error('no');
  });
  const s = createLightStepper({ officeMoodOn: () => true, nudge });
  s.tick(1);
  await flush();
  expect(nudge).toHaveBeenCalledTimes(1);
});

it('leaving early steps back up by the steps taken', async () => {
  const { sent, d } = deps();
  const s = createLightStepper(d);
  s.tick(0.6);
  await flush();
  expect(s.taken).toBe(2);
  await s.leaveEarly();
  expect(sent).toEqual(['down', 'down', 'up', 'up']);
  expect(s.taken).toBe(0);
});

it('leaving early with no step taken sends nothing, and a refusal on the way up stops it', async () => {
  const a = deps();
  const none = createLightStepper(a.d);
  await none.leaveEarly();
  expect(a.sent).toEqual([]);

  const sent: string[] = [];
  const s = createLightStepper({
    officeMoodOn: () => true,
    nudge: async (dir) => {
      sent.push(dir);
      return dir === 'down';
    },
  });
  s.tick(1);
  await flush();
  await s.leaveEarly();
  expect(sent.filter((x) => x === 'up')).toHaveLength(1);
});

it('after a full session the lights stay down', async () => {
  const { sent, d } = deps();
  const s = createLightStepper(d);
  s.tick(1);
  await flush();
  s.finish();
  await flush();
  expect(sent).toEqual(['down', 'down', 'down']);
});
