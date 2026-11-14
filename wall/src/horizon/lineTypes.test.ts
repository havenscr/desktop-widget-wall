import { afterEach, describe, expect, it } from 'vitest';
import { BAND_COUNT, HISTORY_ROWS, clearDanceHistory, danceHistory } from '../audio/store';
import { DANCE_LIMIT } from '../audio/dance';
import { pathContext, recordingContext } from './canvasStub';
import { PLAY_TINT } from './echo';
import {
  FALL_GRAVITY,
  LINE_PALETTES,
  NEW_GAIN,
  SKYLINE_FLOOR,
  TYPE_COLUMNS,
  ampScale,
  colX,
  createLineFrame,
  createLineTypes,
  createMountainCap,
  danceLimit,
  drawLineType,
  fallGravity,
  lineStops,
  setMountainCap,
  stepLineTypes,
  typeLiveShare,
  typePx,
  type LineTypeFrame,
} from './lineTypes';
import type { LineType } from './linesSettings';

const NEW_TYPES: LineType[] = ['bars', 'ribbon', 'sparks', 'skyline'];
const HY = 505;
/** Unwind's line amplitude: 34 * (1 + 0.7). */
const AMP = 57.8;

function frame(type: LineType, bands: (u: number, age: number) => number, more: Partial<LineTypeFrame> = {}): LineTypeFrame {
  return Object.assign(createLineFrame(), { type, amp: AMP, cx: 1330, hs: 900, hy: HY, scale: 1, live: 1, kick: 0.6, bands }, more);
}

/** A whole ring of history: `newest` in the newest row, `oldest` in the oldest row, 0 between. */
function fillHistory(newest: number, oldest: number): void {
  const h = danceHistory() as { data: Float32Array; head: number; rows: number };
  h.data.fill(0);
  h.rows = HISTORY_ROWS;
  h.head = 17;
  const oldestRow = (h.head + 1) % HISTORY_ROWS;
  for (let b = 0; b < BAND_COUNT; b++) {
    h.data[h.head * BAND_COUNT + b] = newest;
    h.data[oldestRow * BAND_COUNT + b] = oldest;
  }
}

/** Each fillRect's [x, y, w, h], from a recorded log. */
const rects = (log: string[]) => log.filter((l) => l.startsWith('fillRect(')).map((l) => l.slice(9, -1).split(',').map(Number));

afterEach(() => clearDanceHistory());

describe('the new types read the newest moment (age 0 is now)', () => {
  it('a hit in the newest history row lifts them; the same level only in old rows does not', () => {
    fillHistory(1, 0);
    const now = frame('bars', createLineFrame().bands);
    expect(typePx(now, 0, 0)).toBeGreaterThan(70);
    fillHistory(0, 1);
    expect(typePx(now, 0, 0)).toBeLessThan(1);
  });

  it('bars drawn from the app history at a hit reach about 100 px, as the reference pictures do', () => {
    fillHistory(1.2, 0);
    const { ctx, log } = recordingContext();
    const f = frame('bars', createLineFrame().bands);
    const s = createLineTypes();
    stepLineTypes(s, f);
    drawLineType(ctx, s, f);
    const tallest = Math.max(...rects(log).map((r) => HY - r[1]));
    expect(tallest).toBeGreaterThan(80);
    expect(tallest).toBeLessThanOrEqual(104 + 3 + 0.01);
  });
});

describe('the height cap', () => {
  const huge = () => 50;
  it('new types always go through H tanh(v / H): never above Height, at 104 and at 60', () => {
    expect(typePx(frame('bars', huge), 0, 0)).toBeCloseTo(104, 3);
    expect(typePx(frame('bars', huge, { height: 60 }), 0, 0)).toBeCloseTo(60, 3);
    const v = 0.5 * AMP * NEW_GAIN;
    expect(typePx(frame('bars', () => 0.5), 0, 0)).toBeCloseTo(104 * Math.tanh(v / 104), 6);
  });

  it('the short hold takes the largest of now, 0.8 x 0.1 s ago and 0.6 x 0.2 s ago', () => {
    const read = (_u: number, age: number) => (age < 0.05 ? 0.1 : age < 0.15 ? 0.5 : 1);
    const v = Math.max(0.1, 0.8 * 0.5, 0.6 * 1) * AMP * NEW_GAIN;
    expect(typePx(frame('bars', read), 0, 0)).toBeCloseTo(104 * Math.tanh(v / 104), 6);
  });

  it('Mountains: off at the usual setting (bands read unchanged), on at a livelier one or a lower Height', () => {
    const cap = createMountainCap(() => 1.5);
    setMountainCap(cap, 104, AMP, DANCE_LIMIT);
    expect(cap.on).toBe(false);
    expect(cap.bands(0, 0)).toBe(1.5);
    setMountainCap(cap, 104, AMP * ampScale(88), danceLimit(88));
    expect(cap.on).toBe(true);
    setMountainCap(cap, 60, AMP, DANCE_LIMIT);
    expect(cap.on).toBe(true);
    const L = 60 / AMP;
    expect(cap.bands(0, 0)).toBeCloseTo(L * Math.tanh(1.5 / L), 9);
  });
});

describe('the mappings at both ends', () => {
  it('How lively: amplitude 2^(0.8x), dance limit 1.8 x 2^(0.75x)', () => {
    expect(ampScale(50)).toBe(1);
    expect(AMP * ampScale(0)).toBeCloseTo(33.2, 1);
    expect(AMP * ampScale(100)).toBeCloseTo(100.6, 1);
    expect(danceLimit(50)).toBe(DANCE_LIMIT);
    expect(danceLimit(0)).toBeCloseTo(1.07, 2);
    expect(danceLimit(100)).toBeCloseTo(3.03, 2);
  });

  it('Smoothness: gravity 520 / (2^y)^2, quicker when snappy', () => {
    expect(fallGravity(50)).toBe(FALL_GRAVITY);
    expect(fallGravity(0)).toBeCloseTo(2080, 6);
    expect(fallGravity(100)).toBeCloseTo(130, 6);
  });

  it('Colours: the look is the live tint, every other choice its fixed stops', () => {
    expect(lineStops('look')).toBe(PLAY_TINT);
    const live = { left: [1, 2, 3], centre: [4, 5, 6], right: [7, 8, 9] };
    expect(lineStops('look', live)).toBe(live);
    expect(lineStops('sunset', live)).toEqual({ left: [255, 196, 96], centre: [255, 132, 96], right: [255, 72, 150] });
    expect(lineStops('mint')).toBe(LINE_PALETTES.mint);
  });

  it('at rest the drawing lies down; Sparks stay as a dotted row', () => {
    expect(typeLiveShare('bars', 0, false)).toBe(1);
    expect(typeLiveShare('bars', 1, false)).toBeCloseTo(0.08, 6);
    expect(typeLiveShare('bars', 1, true)).toBe(0);
    expect(typeLiveShare('sparks', 1, false)).toBe(0.5);
    expect(typeLiveShare('sparks', 1, true)).toBe(0.85);
  });
});

describe('the geometry, as the playground draws it', () => {
  const hit = (u: number) => Math.max(0, 1.2 - u);

  it('bars: 64 columns 18.1 px wide, pitch 28.1 px, bass in the middle', () => {
    const f = frame('bars', hit);
    const { ctx, log } = recordingContext();
    drawLineType(ctx, createLineTypes(), f);
    const caps = rects(log).filter((r) => r[3] === 3);
    expect(caps).toHaveLength(TYPE_COLUMNS);
    expect(caps[0][2]).toBeCloseTo(900 / 32 - 10, 3);
    expect(colX(f, 33) - colX(f, 32)).toBeCloseTo(28.125, 3);
    const mid = caps[31][1], edge = caps[0][1];
    expect(mid).toBeLessThan(edge);
  });

  it('skyline: 32 blocks of 12 px floors, the top floor bright', () => {
    const { ctx, log } = recordingContext();
    drawLineType(ctx, createLineTypes(), frame('skyline', hit));
    const r = rects(log);
    const ground = r.filter((x) => x[3] === SKYLINE_FLOOR - 2);
    expect(ground).toHaveLength(32);
    for (const g of ground) expect(g[1]).toBe(HY - SKYLINE_FLOOR + 2);
    const upper = r.filter((x) => x[3] === SKYLINE_FLOOR - 3);
    expect(upper.length).toBeGreaterThan(32);
    for (const u of upper) expect((HY + 2 - u[1]) % SKYLINE_FLOOR).toBe(0);
  });

  it('ribbon: two trails, a faint fill under the line, a glow wider on the kick, then the line', () => {
    const { ctx, strokes, fills } = pathContext();
    drawLineType(ctx, createLineTypes(), frame('ribbon', hit, { kick: 1 }));
    expect(strokes.map((s) => [s.alpha, s.width])).toEqual([
      [0.16, 1.5],
      [0.3, 2],
      [0.22, 14],
      [1, 4],
    ]);
    expect(fills).toHaveLength(1);
    expect(Math.min(...strokes[3].y)).toBeLessThan(HY - 80);
  });

  it('sparks: thrown up, falling under gravity, two trail dots along the throw', () => {
    const f = frame('sparks', hit, { dt: 1 / 30 });
    const s = createLineTypes();
    for (let i = 0; i < 6; i++) stepLineTypes(s, f);
    const thrown = s.dotY[31];
    expect(thrown).toBeGreaterThan(60);
    const { ctx, log } = recordingContext();
    drawLineType(ctx, s, f);
    const arcs = log.filter((l) => l.startsWith('arc(')).map((l) => l.slice(4, -1).split(',').map(Number));
    expect(arcs).toHaveLength(TYPE_COLUMNS * 4);
    const [t1, t2, halo, core] = arcs.slice(31 * 4, 32 * 4);
    const y = HY - 3 - s.dotY[31];
    expect(core[1]).toBeCloseTo(y, 2);
    expect(halo[1]).toBeCloseTo(y, 2);
    expect(t1[1]).toBeCloseTo(HY - 3 - s.dotY[31] * 0.38, 2);
    expect(t2[1]).toBeCloseTo(HY - 3 - s.dotY[31] * 0.68, 2);
    expect(halo[2]).toBeCloseTo(core[2] * 2.8, 3);
    // Silence: they fall back to the horizon, faster when Smoothness is low.
    const quiet = () => 0;
    const snappy = createLineTypes(), smooth = createLineTypes();
    for (let i = 0; i < 6; i++) {
      stepLineTypes(snappy, f);
      stepLineTypes(smooth, f);
    }
    for (let i = 0; i < 5; i++) {
      stepLineTypes(snappy, frame('sparks', quiet, { smooth: 0 }));
      stepLineTypes(smooth, frame('sparks', quiet, { smooth: 100 }));
    }
    expect(snappy.dotY[31]).toBeLessThan(smooth.dotY[31]);
  });

  it('Flat: one calm line on the horizon at 0.6, with its soft glow', () => {
    const { ctx, strokes } = pathContext();
    drawLineType(ctx, createLineTypes(), frame('bars', () => 0, { live: 0, restLine: 1 }));
    expect(strokes.map((s) => [s.alpha, s.width, s.y.join()])).toEqual([
      [0.16, 7, `${HY - 2},${HY - 2}`],
      [0.6, 1.6, `${HY - 2},${HY - 2}`],
    ]);
  });
});

describe('where they are drawn', () => {
  for (const type of NEW_TYPES) {
    it(`${type}: above the horizon only, with the picture box cut out`, () => {
      const { ctx, log } = recordingContext();
      const s = createLineTypes();
      const f = frame(type, (u) => Math.max(0, 1.2 - u), { boxes: [[1244, 110, 672, 378]] });
      for (let i = 0; i < 4; i++) stepLineTypes(s, f);
      drawLineType(ctx, s, f);
      expect(log).toContain(`rect(0,0,2560,${HY + 1})`);
      expect(log).toContain('rect(1242,108,676,382)');
      expect(log).toContain('clip(evenodd)');
      expect(log.indexOf('clip(evenodd)')).toBeLessThan(log.findIndex((l) => l.startsWith('fill') || l.startsWith('stroke(')));
      for (const r of rects(log)) expect(r[1]).toBeLessThanOrEqual(HY);
    });
  }

  it('nothing for Mountains or with nothing visible', () => {
    const a = recordingContext();
    drawLineType(a.ctx, createLineTypes(), frame('mountains', () => 1));
    expect(a.log).toEqual([]);
    const b = recordingContext();
    drawLineType(b.ctx, createLineTypes(), frame('bars', () => 1, { live: 0, restLine: 0 }));
    expect(b.log).toEqual([]);
  });

  it('the colour gradient is made once and kept while nothing changes', () => {
    const { ctx, log } = recordingContext();
    const s = createLineTypes();
    const f = frame('bars', () => 1);
    for (let i = 0; i < 3; i++) drawLineType(ctx, s, f);
    expect(log.filter((l) => l.startsWith('linear('))).toHaveLength(1);
    f.stops = LINE_PALETTES.ice;
    drawLineType(ctx, s, f);
    expect(log.filter((l) => l.startsWith('linear('))).toHaveLength(2);
  });
});
