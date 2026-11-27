import { describe, expect, it } from 'vitest';
import { DEFAULT_VIBE, GLITCH_LENGTH_S, GLITCH_STRENGTH_GAIN, type VibeSettings } from '../horizon/vibeSettings';
import { createBeatDetector } from '../audio/beat';
import {
  BEAT_HIT_AFTER_DROP_S,
  BEAT_HIT_GAP_S,
  BEAT_HIT_POWER,
  DROP_S,
  POWER_CAP,
  createVibeFrame,
  createVibeState,
  envOf,
  noteBeatHit,
  noteDrop,
  noteTry,
  settleVibe,
  stepVibe,
} from './mix';

const on = (o: Partial<VibeSettings>): VibeSettings => ({ ...DEFAULT_VIBE, ...o });

describe('Length', () => {
  it('Normal is the envelope the wall always had', () => {
    for (const s of [0, 0.01, 0.05, 0.3, 0.7, 0.94, 0.95, 2])
      expect(envOf(s, GLITCH_LENGTH_S.normal)).toBe(s >= 0 && s < DROP_S ? Math.min(1, s / 0.05) ** 2 * (3 - 2 * Math.min(1, s / 0.05)) * (1 - s / DROP_S) ** 2 : 0);
    expect(GLITCH_LENGTH_S.normal).toBe(DROP_S);
    expect(envOf(0.4)).toBe(envOf(0.4, DROP_S));
  });
  it('Short and Long last 0.5 s and 2 s and fade in and out', () => {
    for (const [len, dur] of [['short', 0.5], ['long', 2]] as const) {
      expect(GLITCH_LENGTH_S[len]).toBe(dur);
      expect(envOf(0, dur)).toBe(0);
      expect(envOf(dur, dur)).toBe(0);
      expect(envOf(dur - 0.01, dur)).toBeLessThan(0.001);
      expect(envOf(0.05, dur)).toBeGreaterThan(0.8);
    }
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
    expect(s.power[0]).toBeCloseTo(0.5 * GLITCH_STRENGTH_GAIN.soft);
    expect(s.power[1]).toBeCloseTo(0.7);
    expect(s.power[2]).toBe(POWER_CAP);
    expect(POWER_CAP).toBeLessThanOrEqual(1.2);
  });
});

describe('Beat hits', () => {
  const light = on({ beatHits: 'light' });
  it('Off never fires', () => {
    const s = createVibeState();
    expect(noteBeatHit(s, 10, 1, on({ beatHits: 'off' }))).toBe(false);
    expect(s.drops.every((d) => d === -Infinity)).toBe(true);
  });
  it('fires on a hard beat only, a quarter strength, with no glow swell', () => {
    const s = createVibeState();
    expect(noteBeatHit(s, 10, 0.3, light)).toBe(false);
    expect(noteBeatHit(s, 10, 0.9, light)).toBe(true);
    expect(s.power[0]).toBe(BEAT_HIT_POWER);
    expect(s.swellW[0]).toBe(0);
  });
  it('at most once every 4 s', () => {
    const s = createVibeState();
    expect(noteBeatHit(s, 10, 1, light)).toBe(true);
    expect(noteBeatHit(s, 10 + BEAT_HIT_GAP_S - 0.1, 1, light)).toBe(false);
    expect(noteBeatHit(s, 10 + BEAT_HIT_GAP_S, 1, light)).toBe(true);
  });
  it('never within 2 s after a drop', () => {
    const s = createVibeState();
    noteDrop(s, 10, 1, light);
    expect(noteBeatHit(s, 10 + BEAT_HIT_AFTER_DROP_S - 0.1, 1, light)).toBe(false);
    expect(noteBeatHit(s, 10 + BEAT_HIT_AFTER_DROP_S, 1, light)).toBe(true);
  });
  it('takes the Length and Strength settings, a quarter of the Hard strength under Hard', () => {
    const s = createVibeState();
    noteBeatHit(s, 10, 1, on({ beatHits: 'light', glitchLength: 'short', glitchStrength: 'hard' }));
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
