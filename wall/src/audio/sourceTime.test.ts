import { describe, expect, it } from 'vitest';
import { FRAME_MS, MAX_AHEAD_MS, createSourceClock } from './sourceTime';
import { createBeatDetector } from './beat';

describe('source clock', () => {
  it('passes evenly spaced frames through on their arrival times', () => {
    const c = createSourceClock();
    expect([0, 33, 67, 100].map((t) => c.stamp(t))).toEqual([0, 33, 67, 100]);
  });

  it('spreads a burst 33 ms apart, keeps true spacing after it, and catches up when frames come slower', () => {
    const c = createSourceClock();
    c.stamp(0);
    // A 150 ms stall, then five frames in one callback burst.
    const burst = [150, 150, 151, 151, 152].map((t) => c.stamp(t)!);
    expect(burst).toEqual([150, 183, 216, 249, 282]);
    // Back to the normal cadence: spacing follows the real arrival intervals, still ahead.
    const after = [185, 218, 251].map((t) => c.stamp(t)!);
    expect(after).toEqual([315, 348, 381]);
    // Slower frames (a 120 ms gap) let the clock catch up.
    expect(c.stamp(371)).toBe(414);
    expect(c.stamp(600)).toBe(600);
  });

  it('drops frames that would run more than 200 ms ahead of the clock', () => {
    const c = createSourceClock();
    const out = Array.from({ length: 12 }, () => c.stamp(1000));
    const kept = out.filter((t): t is number => t !== null);
    expect(kept[kept.length - 1] - 1000).toBeLessThanOrEqual(MAX_AHEAD_MS);
    expect(kept.length).toBe(Math.floor(MAX_AHEAD_MS / FRAME_MS) + 1);
    expect(out.slice(kept.length).every((t) => t === null)).toBe(true);
  });

  it('frames delivered late and in one burst keep their beat count, a real lag and their spacing', () => {
    const quiet = new Array(32).fill(0.3);
    const loud = new Array(32).fill(0.65);
    // A kick every 462 ms (14 frames, so some onsets land inside a burst): three loud frames, then quiet.
    const frames = Array.from({ length: 360 }, (_, i) => ({ t: i * 33, bands: i % 14 < 3 ? loud : quiet }));
    // Every 40 frames the web view stalls for 4 frames (132 ms), then delivers them in one burst.
    const STALL = 4 * 33;
    const late = frames.map((f, i) => (i % 40 >= 36 ? (Math.floor(i / 40) * 40 + 39) * 33 : f.t));
    const run = (stamp: (arrival: number) => number | null) => {
      const d = createBeatDetector();
      const beats: { at: number; lag: number; frame: number }[] = [];
      frames.forEach((f, i) => {
        const t = stamp(late[i]);
        if (t !== null && d.push(f.bands, t)) beats.push({ at: d.lastBeatAt, lag: d.lag, frame: i });
      });
      return beats;
    };
    const clock = createSourceClock();
    const fixed = run((a) => clock.stamp(a));
    const truth = (() => {
      const d = createBeatDetector();
      const out: number[] = [];
      for (const f of frames) if (d.push(f.bands, f.t)) out.push(d.lastBeatAt);
      return out;
    })();
    expect(truth.length).toBeGreaterThan(20);
    expect(fixed.some((b) => b.frame % 40 >= 36)).toBe(true); // some beats really do confirm inside a burst
    expect(fixed).toHaveLength(truth.length); // no beat lost or added
    for (const b of fixed) expect(b.lag).toBeGreaterThanOrEqual(60); // confirmed over two real frame steps, never at once
    // Spacing: within 35 ms of the truth, except a gap that spans a stall, which can be off by up to the stall
    // (the first frame after a stall can only be stamped when it arrives; the event carries no capture time).
    for (let i = 1; i < fixed.length; i++) {
      const err = Math.abs(fixed[i].at - fixed[i - 1].at - (truth[i] - truth[i - 1]));
      const spansStall = Math.floor(fixed[i].frame / 40) !== Math.floor(fixed[i - 1].frame / 40) || fixed[i].frame % 40 >= 36;
      expect(err).toBeLessThanOrEqual(spansStall ? 35 + STALL : 35);
    }
    // Stamped on arrival instead, the burst frames share one time: beats confirm with no lag.
    const raw = run((a) => a);
    expect(raw.some((b) => b.lag === 0) || raw.length !== truth.length).toBe(true);
  });
});
