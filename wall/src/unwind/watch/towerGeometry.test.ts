import { describe, expect, it } from 'vitest';
import { DRIVE_IN_GROUND, DRIVE_IN_SCREEN } from './looks';
import { FOOTINGS, FRAME_CX, GROUND_Y, MARQUEE, MEMBERS, SURROUND, type Member } from './towerFrame';

// The Screen tower is one structure: every bar's end must sit on another bar, on the surround,
// on a footing or on the ground line, so nothing hangs loose. Left and right are mirror images
// about the picture's centre line, and no bar comes near the picture's box.

const TOL = 0.75;
const V = DRIVE_IN_SCREEN;
type P = readonly [number, number];

/** Distance from point p to the segment a-b. */
function distToSegment(p: P, a: P, b: P): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
const distToBox = (p: P, x0: number, y0: number, x1: number, y1: number) => Math.hypot(Math.max(x0 - p[0], 0, p[0] - x1), Math.max(y0 - p[1], 0, p[1] - y1));

/** What a bar's end rests on: the name of the first thing within tolerance, or null when it hangs. */
function support(m: Member, p: P): string | null {
  if (Math.abs(p[1] - GROUND_Y) <= TOL) return 'ground';
  if (distToBox(p, SURROUND.x0, SURROUND.y0, SURROUND.x1, SURROUND.y1) <= TOL) return 'surround';
  for (const f of FOOTINGS) if (distToBox(p, f.x0, f.y0, f.x1, f.y1) <= TOL) return f.name;
  for (const o of MEMBERS) if (o.group !== m.group && distToSegment(p, o.a, o.b) <= TOL) return o.name;
  return null;
}

describe('tower frame geometry', () => {
  it('has bars to check', () => {
    expect(MEMBERS).toHaveLength(60);
    expect(new Set(MEMBERS.map((m) => m.name)).size).toBe(MEMBERS.length);
    expect(FOOTINGS).toHaveLength(4);
  });

  it('every bar end rests on another bar, the surround, a footing or the ground', () => {
    const loose: string[] = [];
    for (const m of MEMBERS) {
      for (const [end, p] of [['start', m.a], ['end', m.b]] as const) {
        if (!support(m, p)) loose.push(`${m.name} ${end} (${p[0].toFixed(2)}, ${p[1].toFixed(2)})`);
      }
    }
    expect(loose).toEqual([]);
  });

  it('the bars that reach the ground end on a footing', () => {
    const grounded = MEMBERS.filter((m) => Math.abs(m.a[1] - GROUND_Y) <= TOL || Math.abs(m.b[1] - GROUND_Y) <= TOL);
    expect(grounded.length).toBeGreaterThanOrEqual(6);
    for (const m of grounded) {
      const p = Math.abs(m.b[1] - GROUND_Y) <= TOL ? m.b : m.a;
      const f = FOOTINGS.find((q) => p[0] >= q.x0 - TOL && p[0] <= q.x1 + TOL && Math.abs(p[1] - q.y1) <= TOL);
      expect(f, `${m.name} reaches the ground off its footing`).toBeTruthy();
    }
  });

  it('both chords run from stay to stay and the web starts and ends on a stay', () => {
    const named = (name: string) => MEMBERS.find((m) => m.name === name)!;
    const onStay = (p: P, k: 'L' | 'R') => distToSegment(p, named(`stay-${k}`).a, named(`stay-${k}`).b);
    for (const name of ['chord-upper', 'chord-lower']) {
      expect(onStay(named(name).a, 'L'), `${name} left end`).toBeLessThanOrEqual(TOL);
      expect(onStay(named(name).b, 'R'), `${name} right end`).toBeLessThanOrEqual(TOL);
    }
    expect(onStay(named('web-1').a, 'L')).toBeLessThanOrEqual(TOL);
    expect(onStay(named('web-28').b, 'R')).toBeLessThanOrEqual(TOL);
  });

  it('left and right are mirror images about the picture centre', () => {
    expect(FRAME_CX).toBe(V.x + V.w / 2);
    const key = (a: P, b: P) => {
      const pts = [a, b].map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).sort();
      return pts.join('|');
    };
    const mirror = (p: P): P => [2 * FRAME_CX - p[0], p[1]];
    const all = new Map<string, number>();
    for (const m of MEMBERS) all.set(key(m.a, m.b), (all.get(key(m.a, m.b)) ?? 0) + 1);
    const unmatched = MEMBERS.filter((m) => !all.has(key(mirror(m.a), mirror(m.b)))).map((m) => m.name);
    expect(unmatched).toEqual([]);
    for (const f of FOOTINGS) {
      const twin = FOOTINGS.find((q) => Math.abs(q.x0 - (2 * FRAME_CX - f.x1)) < 0.01 && Math.abs(q.x1 - (2 * FRAME_CX - f.x0)) < 0.01);
      expect(twin, `${f.name} has no mirror`).toBeTruthy();
    }
  });

  it('no bar, with its stroke, comes into the picture box', () => {
    const inside: string[] = [];
    for (const m of MEMBERS) {
      const h = m.w / 2;
      const x0 = Math.min(m.a[0], m.b[0]) - h;
      const x1 = Math.max(m.a[0], m.b[0]) + h;
      const y0 = Math.min(m.a[1], m.b[1]) - h;
      const y1 = Math.max(m.a[1], m.b[1]) + h;
      if (x0 < V.x + V.w && V.x < x1 && y0 < V.y + V.h && V.y < y1) inside.push(m.name);
    }
    expect(inside).toEqual([]);
  });

  it('keeps main members heavier than lacing, and the stays on the ground the screen sits above', () => {
    const w = (kind: Member['kind']) => MEMBERS.filter((m) => m.kind === kind).map((m) => m.w);
    expect(Math.min(...w('main'))).toBeGreaterThan(Math.max(...w('lace')));
    expect(DRIVE_IN_GROUND).toBe(GROUND_Y);
  });

  it('hangs the marquee on the truss: its top tucks under the surround and it crosses the lower chord', () => {
    const lower = MEMBERS.find((m) => m.name === 'chord-lower')!;
    expect(MARQUEE.y).toBeLessThanOrEqual(SURROUND.y1);
    expect(MARQUEE.y).toBeLessThan(lower.a[1]);
    expect(MARQUEE.y + MARQUEE.h).toBeGreaterThan(lower.a[1]);
    expect(MARQUEE.x).toBeGreaterThan(lower.a[0]);
    expect(MARQUEE.x + MARQUEE.w).toBeLessThan(lower.b[0]);
  });
});
