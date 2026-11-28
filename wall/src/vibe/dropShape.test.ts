import { describe, expect, it } from 'vitest';
import { DEFAULT_VIBE, GLITCH_LENGTH_S, type VibeSettings } from '../horizon/vibeSettings';
import { createBeatDetector } from '../audio/beat';
import {
  createVibeFrame,
  createVibeState,
  envOf,
  flushBeatHit,
  noteBeatHit,
  noteDrop,
  noteTry,
  settleVibe,
  stepVibe,
} from './mix';

const on = (o: Partial<VibeSettings>): VibeSettings => ({ ...DEFAULT_VIBE, ...o });

describe('Length', () => {
  it('Normal is the envelope the wall always had', () => {
    const expected: [number, number][] = [[0, 0], [0.01, 0.10182204986149582], [0.05, 0.8975069252077561], [0.3, 0.46814404432132967], [0.7, 0.06925207756232689], [0.94, 0.00011080332409972368], [0.95, 0], [2, 0]];
    for (const [t, v] of expected) {
      expect(envOf(t, 0.95)).toBeCloseTo(v, 9);
      expect(envOf(t)).toBeCloseTo(v, 9);
    }
    expect(GLITCH_LENGTH_S.normal).toBe(0.95);
  });
  it('Short and Long last 0.5 s and 2 s and fade in and out', () => {
    expect(GLITCH_LENGTH_S.short).toBe(0.5);
    expect(GLITCH_LENGTH_S.long).toBe(2);
    expect(envOf(0, 0.5)).toBe(0);
    expect(envOf(0.5, 0.5)).toBe(0);
    expect(envOf(0.05, 0.5)).toBeCloseTo(0.81, 9);
    expect(envOf(0.49, 0.5)).toBeCloseTo(0.0004, 9);
    expect(envOf(0, 2)).toBe(0);
    expect(envOf(2, 2)).toBe(0);
    expect(envOf(0.05, 2)).toBeCloseTo(0.950625, 9);
    expect(envOf(1.99, 2)).toBeCloseTo(0.000025, 9);
  });
  it('a drop keeps the length it was stamped with', () => {
    const s = createVibeState();
    noteDrop(s, 10, 1, on({ glitchLength: 'long' }));
    noteDrop(s, 20, 1, on({ glitchLength: 'short' }));
    expect([...s.dur.slice(0, 2)]).toEqual([2, 0.5]);
  });
});

describe('Strength', () => {
  it('Normal is today: the drop\'s own power, clamped to 1', () => {
    const s = createVibeState();
    noteDrop(s, 1, 0.8);
    noteDrop(s, 2, 5);
    noteDrop(s, 3, 0.8, DEFAULT_VIBE);
    expect([...s.power.slice(0, 3)]).toEqual([0.8, 1, 0.8]);
  });
  it('Soft is 0.6 times and Hard is 1.4 times, never past the cap', () => {
    const s = createVibeState();
    noteDrop(s, 1, 0.5, on({ glitchStrength: 'soft' }));
    noteDrop(s, 2, 0.5, on({ glitchStrength: 'hard' }));
    noteDrop(s, 3, 1, on({ glitchStrength: 'hard' }));
    expect(s.power[0]).toBeCloseTo(0.3);
    expect(s.power[1]).toBeCloseTo(0.7);
    expect(s.power[2]).toBe(1.15);
  });
});

describe('Beat hits', () => {
  const light = on({ beatHits: 'light' });
  /** Queue a hit at `t`, then let its hold pass. */
  const hit = (s: ReturnType<typeof createVibeState>, t: number, strength: number, settings = light): boolean => {
    const queued = noteBeatHit(s, t, strength, settings);
    flushBeatHit(s, t + 0.3, settings);
    return queued;
  };
  it('Off never fires', () => {
    const s = createVibeState();
    expect(hit(s, 10, 1, on({ beatHits: 'off' }))).toBe(false);
    expect(s.drops.every((d) => d === -Infinity)).toBe(true);
  });
  it('fires on a hard beat only, a quarter strength, with no glow swell', () => {
    const s = createVibeState();
    expect(hit(s, 10, 0.3)).toBe(false);
    expect(hit(s, 10, 0.9)).toBe(true);
    expect(s.power[0]).toBe(0.25);
    expect(s.swellW[0]).toBe(0);
  });
  it('shows 0.3 s after its beat, not before', () => {
    const s = createVibeState();
    noteBeatHit(s, 10, 1, light);
    expect(flushBeatHit(s, 10.29, light)).toBe(false);
    expect(s.drops[0]).toBe(-Infinity);
    expect(flushBeatHit(s, 10.3, light)).toBe(true);
    expect(s.drops[0]).toBeCloseTo(10.3);
  });
  it('at most once every 4 s', () => {
    const s = createVibeState();
    expect(hit(s, 10, 1)).toBe(true);
    expect(hit(s, 10.3 + 3.6, 1)).toBe(false);
    expect(hit(s, 10.3 + 4, 1)).toBe(true);
  });
  it('never within 2 s after a drop', () => {
    const s = createVibeState();
    noteDrop(s, 10, 1, light);
    expect(hit(s, 11.9, 1)).toBe(false);
    expect(hit(s, 12, 1)).toBe(true);
  });
  it('a drop within the next 0.3 s cancels the hit that was waiting', () => {
    const s = createVibeState();
    expect(noteBeatHit(s, 10, 1, light)).toBe(true);
    noteDrop(s, 10.2, 1, light);
    expect(flushBeatHit(s, 10.6, light)).toBe(false);
    expect([...s.drops].filter((d) => d > -Infinity)).toEqual([10.2]);
    expect(s.lastBeatHitAt).toBe(-Infinity);
  });
  it('takes the Length and Strength settings, a quarter of the Hard strength under Hard', () => {
    const s = createVibeState();
    hit(s, 10, 1, on({ beatHits: 'light', glitchLength: 'short', glitchStrength: 'hard' }));
    expect(s.dur[0]).toBe(0.5);
    expect(s.power[0]).toBeCloseTo(0.35);
  });
  it('the beat detector reports how hard a beat was, 0 to 1', () => {
    const d = createBeatDetector();
    const quiet = new Float32Array(32).fill(0.2);
    const loud = (v: number) => new Float32Array(32).fill(v);
    let t = 0;
    for (let i = 0; i < 20; i++) d.push(quiet, (t += 33));
    for (let i = 0; i < 4; i++) d.push(loud(0.9), (t += 33));
    expect(d.count).toBe(1);
    expect(d.strength).toBeGreaterThan(0.9);
    const e = createBeatDetector();
    for (let i = 0; i < 20; i++) e.push(quiet, (t += 33));
    for (let i = 0; i < 4; i++) e.push(loud(0.45), (t += 33));
    expect(e.count).toBe(1);
    expect(e.strength).toBeLessThan(d.strength);
  });
});

describe('Try it', () => {
  it('shows a hit with no music, fades in and out, and halves under Calm cap', () => {
    const frame = createVibeFrame();
    const run = (calm: boolean) => {
      const s = createVibeState();
      const settings = on({ calmCap: calm });
      settleVibe(s, settings, false, 0);
      noteTry(s, 5, settings);
      let peak = 0;
      let prev = 0;
      let biggestStep = 0;
      for (let t = 5; t < 7; t += 1 / 30) {
        stepVibe(s, frame, 1 / 30, t, { settings, playing: false, energy: 0 });
        const v = frame.glitch * frame.env;
        peak = Math.max(peak, v);
        biggestStep = Math.max(biggestStep, Math.abs(v - prev));
        prev = v;
      }
      stepVibe(s, frame, 1 / 30, 8, { settings, playing: false, energy: 0 });
      expect(frame.env).toBe(0);
      expect(frame.glitch * frame.env).toBe(0);
      return { peak, biggestStep };
    };
    const a = run(false);
    const b = run(true);
    expect(a.peak).toBeGreaterThan(0.8);
    expect(b.peak).toBeCloseTo(a.peak / 2, 1);
    // One frame never jumps by more than the envelope's own rise (50 ms).
    expect(a.biggestStep).toBeLessThan(0.7);
  });
  it('is silent with no hit', () => {
    const frame = createVibeFrame();
    const s = createVibeState();
    settleVibe(s, DEFAULT_VIBE, false, 0);
    stepVibe(s, frame, 1 / 30, 5, { settings: DEFAULT_VIBE, playing: false, energy: 0 });
    expect(frame.glitch).toBe(0);
  });
});
