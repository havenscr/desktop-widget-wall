import { describe, expect, it } from 'vitest';
import { DEGRADE_MS, PROBE_WINDOW_MS, createLoop, createProbe, type LoopHost } from './loop';

function fakeHost() {
  let cb: ((ts: number) => void) | null = null;
  let hidden = false;
  const host: LoopHost = {
    raf: (f) => ((cb = f), 1),
    caf: () => {
      cb = null;
    },
    hidden: () => hidden,
  };
  return {
    host,
    pending: () => cb !== null,
    fire(ts: number) {
      const f = cb;
      cb = null;
      f?.(ts);
    },
    hide(v: boolean) {
      hidden = v;
    },
  };
}

describe('the vibe loop', () => {
  it('paces frames to about 30 a second and passes a capped step', () => {
    const h = fakeHost();
    const seen: number[] = [];
    const loop = createLoop(h.host, (_ts, dt) => (seen.push(dt), true));
    loop.kick();
    h.fire(1000);
    h.fire(1010);
    h.fire(1020);
    h.fire(1040);
    expect(seen.length).toBe(2);
    h.fire(5000);
    expect(Math.max(...seen)).toBeLessThanOrEqual(0.1);
  });

  it('stops by itself when the frame has nothing left, and runs again on a kick', () => {
    const h = fakeHost();
    let go = true;
    const loop = createLoop(h.host, () => go);
    loop.kick();
    h.fire(100);
    expect(loop.running).toBe(true);
    go = false;
    h.fire(200);
    expect(loop.running).toBe(false);
    expect(h.pending()).toBe(false);
    go = true;
    loop.kick();
    expect(loop.running).toBe(true);
    expect(h.pending()).toBe(true);
  });

  it('does not run on a hidden page, stops if the page hides, and a kick while hidden does nothing', () => {
    const h = fakeHost();
    const loop = createLoop(h.host, () => true);
    h.hide(true);
    loop.kick();
    expect(loop.running).toBe(false);
    h.hide(false);
    loop.kick();
    h.fire(100);
    h.hide(true);
    h.fire(200);
    expect(loop.running).toBe(false);
  });

  it('stop cancels the pending frame', () => {
    const h = fakeHost();
    const loop = createLoop(h.host, () => true);
    loop.kick();
    loop.stop();
    expect(h.pending()).toBe(false);
    expect(loop.running).toBe(false);
  });

  it('a slower minimum gap (degraded) draws fewer frames', () => {
    const h = fakeHost();
    let n = 0;
    const loop = createLoop(h.host, () => (n++, true), () => 50);
    loop.kick();
    for (let t = 1000; t < 1200; t += 16) h.fire(t);
    expect(n).toBeLessThanOrEqual(4);
  });
});

describe('the frame cost probe', () => {
  it('degrades once when the mean passes the budget over its window', () => {
    let calls = 0;
    const p = createProbe(() => calls++);
    for (let t = 0; t <= PROBE_WINDOW_MS * 3; t += 33) p.add(DEGRADE_MS + 2, t);
    expect(p.degraded).toBe(true);
    expect(calls).toBe(1);
  });

  it('stays quiet while frames are cheap', () => {
    let calls = 0;
    const p = createProbe(() => calls++);
    for (let t = 0; t <= PROBE_WINDOW_MS * 2; t += 33) p.add(0.8, t);
    expect(p.degraded).toBe(false);
    expect(p.meanMs).toBeCloseTo(0.8, 5);
    expect(calls).toBe(0);
  });
});
