import { describe, expect, it } from 'vitest';
import { recordingContext } from './canvasStub';
import { RING_COLOR, SPECK_PX, WALL_W, drift, gusts, inBoxes, mist, rings, rnd, streaks, type DriftSet, type FxBoxes, type GustSet, type MistSet, type RingSet, type StreakSet } from './weatherFx';

const NO_BOXES = (): FxBoxes => ({ v: [], n: 0 });
const VIEW = { x: 0, w: WALL_W };

const streakSet = (over: Partial<StreakSet> = {}): StreakSet => ({
  n: 80, seed: 400, lenA: 36, lenB: 64, speedA: 420, speedB: 520, deg: 12, top: -70, bottom: 511, color: 'rgba(175,215,250,0.170)', lw: 1, fade: 1, view: VIEW, boxes: NO_BOXES(), ...over,
});
const ringSet = (over: Partial<RingSet> = {}): RingSet => ({ n: 50, hy: 505, alpha: 0.56, lifeA: 1.5, lifeB: 2.3, fade: 1, view: VIEW, boxes: NO_BOXES(), ...over });
const driftSet = (over: Partial<DriftSet> = {}): DriftSet => ({ n: 7, yA: 456, yB: 492, fade: 1, view: VIEW, boxes: NO_BOXES(), ...over });

/** The streak segments of a recorded draw: head (moveTo) and tail (lineTo). */
function segments(log: string[]): { hx: number; hy: number; tx: number; ty: number }[] {
  const out: { hx: number; hy: number; tx: number; ty: number }[] = [];
  const num = (s: string) => s.slice(s.indexOf('(') + 1, -1).split(',').map(Number);
  for (let i = 0; i < log.length; i++) {
    if (log[i].startsWith('moveTo(') && log[i + 1]?.startsWith('lineTo(')) {
      const [hx, hy] = num(log[i]);
      const [tx, ty] = num(log[i + 1]);
      out.push({ hx, hy, tx, ty });
    }
  }
  return out;
}

describe('rnd', () => {
  it('is fixed for a number and a channel and stays in [0, 1)', () => {
    expect(rnd(3, 9)).toBe(rnd(3, 9));
    expect(rnd(3, 9)).not.toBe(rnd(3, 10));
    for (let i = 0; i < 500; i++) {
      const v = rnd(i, 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('streaks', () => {
  it('makes one stroke for the whole set, with round caps and the cached colour', () => {
    const { ctx, log } = recordingContext();
    streaks(ctx, 3, streakSet());
    expect(log.filter((l) => l === 'stroke()')).toHaveLength(1);
    expect(log).toContain('strokeStyle=rgba(175,215,250,0.170)');
    expect(log).toContain('lineCap=round');
  });

  it('draws about as many streaks as asked: more at a higher level, fewer at half strength', () => {
    const count = (n: number) => {
      const { ctx, log } = recordingContext();
      streaks(ctx, 3, streakSet({ n }));
      return segments(log).length;
    };
    const light = count(80);
    const heavy = count(220);
    const night = count(40);
    expect(light).toBeLessThanOrEqual(80);
    expect(light).toBeGreaterThan(60);
    expect(heavy).toBeGreaterThan(light * 2);
    expect(night).toBeLessThan(light);
  });

  it('is a pure function of time: the same t gives the same calls, another t gives others', () => {
    const run = (t: number) => {
      const { ctx, log } = recordingContext();
      streaks(ctx, t, streakSet());
      return log.join('\n');
    };
    expect(run(4.7)).toBe(run(4.7));
    expect(run(4.7)).not.toBe(run(5.3));
  });

  it('leans 12 degrees from vertical, and 34 with wind', () => {
    for (const deg of [12, 34]) {
      const { ctx, log } = recordingContext();
      streaks(ctx, 2, streakSet({ deg }));
      const s = segments(log);
      expect(s.length).toBeGreaterThan(10);
      for (const g of s) {
        // The tail is up and to the left of the head: it leans right as it falls.
        expect(g.ty).toBeLessThan(g.hy);
        expect((g.hx - g.tx) / (g.hy - g.ty)).toBeCloseTo(Math.tan((deg * Math.PI) / 180), 2);
      }
    }
  });

  it('skips streaks outside the view and inside a box', () => {
    const narrow = recordingContext();
    streaks(narrow.ctx, 3, streakSet({ n: 220, view: { x: 1000, w: 100 } }));
    for (const g of segments(narrow.log)) {
      expect(g.hx).toBeGreaterThanOrEqual(960);
      expect(g.tx).toBeLessThanOrEqual(1140);
    }
    const all = recordingContext();
    streaks(all.ctx, 3, streakSet({ n: 220 }));
    expect(segments(narrow.log).length).toBeLessThan(segments(all.log).length / 5);
    // A box that covers the whole wall empties it; a box grown around one end drops the streaks whose ends lie in it.
    const boxed = recordingContext();
    streaks(boxed.ctx, 3, streakSet({ n: 220, boxes: { v: [-100, -200, 2700, 800], n: 4 } }));
    expect(segments(boxed.log)).toHaveLength(0);
    const part = recordingContext();
    streaks(part.ctx, 3, streakSet({ n: 220, boxes: { v: [800, -200, 1600, 800], n: 4 } }));
    for (const g of segments(part.log)) {
      expect(g.hx < 800 || g.hx > 1600).toBe(true);
      expect(g.tx < 800 || g.tx > 1600).toBe(true);
    }
    expect(segments(part.log).length).toBeLessThan(segments(all.log).length);
  });

  it('multiplies the idle and ramp fade into the opacity', () => {
    const { ctx, log } = recordingContext();
    streaks(ctx, 1, streakSet({ fade: 0.25 }));
    expect(log).toContain('globalAlpha=0.25');
  });
});

describe('rings', () => {
  it('uses one fixed stroke colour and sets each ring\'s opacity through globalAlpha', () => {
    const { ctx, log } = recordingContext();
    rings(ctx, 3, ringSet());
    expect(log.filter((l) => l.startsWith('strokeStyle='))).toEqual([`strokeStyle=${RING_COLOR}`]);
    const ellipses = log.filter((l) => l.startsWith('ellipse('));
    expect(ellipses.length).toBeGreaterThan(30);
    expect(log.filter((l) => l.startsWith('globalAlpha=')).length).toBe(ellipses.length);
    expect(log.filter((l) => l === 'stroke()').length).toBe(ellipses.length);
  });

  it('keeps every ring on the lake and its opacity at or under the peak', () => {
    const { ctx, log } = recordingContext();
    rings(ctx, 7.3, ringSet({ n: 130, alpha: 0.64 }));
    for (const l of log.filter((x) => x.startsWith('ellipse('))) {
      const y = Number(l.slice(8, -1).split(',')[1]);
      expect(y).toBeGreaterThanOrEqual(505 + 9);
      expect(y).toBeLessThanOrEqual(720);
    }
    for (const l of log.filter((x) => x.startsWith('globalAlpha='))) expect(Number(l.slice(12))).toBeLessThanOrEqual(0.64);
  });

  it('draws fewer at half strength, skips rings outside the view and inside a box, and is pure', () => {
    const n = (o: Partial<RingSet>, t = 3) => {
      const { ctx, log } = recordingContext();
      rings(ctx, t, ringSet(o));
      return log.filter((l) => l.startsWith('ellipse(')).length;
    };
    expect(n({ n: 25 })).toBeLessThan(n({ n: 50 }));
    expect(n({ n: 130, view: { x: 0, w: 200 } })).toBeLessThan(n({ n: 130 }) / 4);
    expect(n({ n: 130, boxes: { v: [-100, 0, 2700, 800], n: 4 } })).toBe(0);
    const a = recordingContext();
    const b = recordingContext();
    rings(a.ctx, 4.1, ringSet());
    rings(b.ctx, 4.1, ringSet());
    expect(a.log).toEqual(b.log);
  });
});

describe('gusts', () => {
  const set = (over: Partial<GustSet> = {}): GustSet => ({ n: 5, top: 245, bottom: 435, alpha: 0.24, fade: 1, view: VIEW, ...over });
  it('draws at most one line per lane, with one gradient each and the opacity through globalAlpha', () => {
    let most = 0;
    for (let t = 0; t < 60; t += 1.7) {
      const { ctx, log } = recordingContext();
      gusts(ctx, t, set());
      const lines = log.filter((l) => l === 'stroke()').length;
      expect(log.filter((l) => l.startsWith('linear(')).length).toBe(lines);
      for (const l of log.filter((x) => x.startsWith('globalAlpha='))) expect(Number(l.slice(12))).toBeLessThanOrEqual(0.24 + 1e-9);
      most = Math.max(most, lines);
    }
    expect(most).toBeGreaterThan(0);
    expect(most).toBeLessThanOrEqual(5);
  });
  it('keeps every line inside the sky band (with its small wave and rise)', () => {
    for (let t = 0; t < 40; t += 2.3) {
      const { ctx, log } = recordingContext();
      gusts(ctx, t, set());
      for (const l of log.filter((x) => x.startsWith('moveTo(') || x.startsWith('lineTo('))) {
        const y = Number(l.slice(l.indexOf(',') + 1, -1));
        expect(y).toBeGreaterThan(245 - 40);
        expect(y).toBeLessThan(435 + 40);
      }
    }
  });
});

describe('mist', () => {
  const set = (over: Partial<MistSet> = {}): MistSet => ({ n: 10, seed: 300, yA: 335, yB: 445, wA: 700, wB: 1300, alpha: 0.2, speed: 9, fade: 1, view: VIEW, shift: 0, margin: 0, ...over });
  const sprite = {} as CanvasImageSource;
  it('draws nothing without a sprite and one image per visible bank with one', () => {
    const none = recordingContext();
    mist(none.ctx, 3, set(), null);
    expect(none.log).toEqual([]);
    const some = recordingContext();
    mist(some.ctx, 3, set(), sprite);
    const images = some.log.filter((l) => l.startsWith('drawImage('));
    expect(images.length).toBeGreaterThan(3);
    expect(images.length).toBeLessThanOrEqual(10);
  });
  it('drifts right with time and breathes by at most 30 percent', () => {
    const at = (t: number) => {
      const { ctx, log } = recordingContext();
      mist(ctx, t, set({ n: 1 }), sprite);
      return log;
    };
    const x = (log: string[]) => Number(log.find((l) => l.startsWith('drawImage('))!.split(',')[1]);
    const a = at(2);
    const b = at(3);
    // one bank moves between 0.6 and 1.4 times 9 px a second
    const dx = x(b) - x(a);
    expect(dx).toBeGreaterThan(9 * 0.6 * 0.99);
    expect(dx).toBeLessThan(9 * 1.4 * 1.01);
    for (let t = 0; t < 120; t += 7) {
      const al = Number(at(t).find((l) => l.startsWith('globalAlpha='))!.slice(12));
      expect(al).toBeLessThanOrEqual(0.2 + 1e-9);
      expect(al).toBeGreaterThanOrEqual(0.2 * 0.4 - 1e-9);
    }
  });
});

describe('drift', () => {
  it('draws small specks on the 3 px grid: tufts in wool, every third one a clover leaf', () => {
    const { ctx, log } = recordingContext();
    drift(ctx, 5, driftSet());
    const fills = log.filter((l) => l.startsWith('fillRect('));
    expect(fills.length).toBeGreaterThan(5);
    for (const f of fills) {
      const [x, y, w, h] = f.slice(9, -1).split(',').map(Number);
      expect(Math.abs(x % SPECK_PX)).toBe(0);
      expect(Math.abs(y % SPECK_PX)).toBe(0);
      expect([w, h]).toEqual([SPECK_PX, SPECK_PX]);
    }
    const colors = new Set(log.filter((l) => l.startsWith('fillStyle=')));
    expect(colors.has('fillStyle=#dcd3fb')).toBe(true);
    expect(log).toContain('globalAlpha=0.85');
  });
  it('keeps to the band along the shore and skips boxes', () => {
    for (let t = 0; t < 30; t += 3.1) {
      const { ctx, log } = recordingContext();
      drift(ctx, t, driftSet());
      for (const f of log.filter((l) => l.startsWith('fillRect('))) {
        const y = Number(f.slice(9, -1).split(',')[1]);
        expect(y).toBeGreaterThanOrEqual(456 - 7 - 3);
        expect(y).toBeLessThanOrEqual(492 + 7 + 6);
      }
    }
    const boxed = recordingContext();
    drift(boxed.ctx, 5, driftSet({ boxes: { v: [-100, 0, 2700, 800], n: 4 } }));
    expect(boxed.log.filter((l) => l.startsWith('fillRect('))).toHaveLength(0);
  });
});

describe('inBoxes', () => {
  it('finds a point inside any box and none in an empty list', () => {
    const b: FxBoxes = { v: [0, 0, 10, 10, 100, 100, 200, 200], n: 8 };
    expect(inBoxes(b, 5, 5)).toBe(true);
    expect(inBoxes(b, 150, 150)).toBe(true);
    expect(inBoxes(b, 50, 50)).toBe(false);
    expect(inBoxes({ v: [], n: 0 }, 5, 5)).toBe(false);
  });
});
