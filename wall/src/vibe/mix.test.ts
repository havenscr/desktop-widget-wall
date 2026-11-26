import { describe, expect, it } from 'vitest';
import { DEFAULT_VIBE, type VibeSettings } from '../horizon/vibeSettings';
import {
  counterAdvanced,
  DROP_S,
  EASE_TAU_S,
  LIVE_TAU_S,
  MAX_DROPS,
  MAX_DT_S,
  createVibeFrame,
  createVibeState,
  envOf,
  KICK_GRAIN,
  kickPulse,
  noteDrop,
  noteKick,
  settleVibe,
  stepVibe,
  swellOf,
  type VibeFrame,
} from './mix';

const FRAME = 1 / 30;
const FIELDS: (keyof VibeFrame)[] = [
  'aurora', 'rich', 'halo', 'haloSwell', 'tape', 'grain', 'glitch', 'env', 'swell',
  'grainKick', 'palette', 'titleCover', 'kickGain', 'bassGain', 'live',
];

/** Run from rest at `from` for `seconds` at 30 fps with `to`; returns the largest one frame change of any field. */
function run(from: VibeSettings, to: VibeSettings, opts: { playing?: boolean; playingTo?: boolean; energy?: number; seconds?: number } = {}) {
  const { playing = true, playingTo = playing, energy = 0.5, seconds = 12 } = opts;
  const s = createVibeState();
  settleVibe(s, from, playing, energy);
  const out = createVibeFrame();
  stepVibe(s, out, FRAME, 0, { settings: from, playing, energy });
  let prev = FIELDS.map((k) => out[k] as number);
  let max = 0;
  let maxField = '';
  for (let f = 1; f <= seconds * 30; f++) {
    stepVibe(s, out, FRAME, f * FRAME, { settings: to, playing: playingTo, energy });
    FIELDS.forEach((k, i) => {
      const v = out[k] as number;
      const d = Math.abs(v - prev[i]);
      if (d > max) {
        max = d;
        maxField = k;
      }
      prev[i] = v;
    });
  }
  return { out, s, max, maxField };
}

const flip = (patch: Partial<VibeSettings>): [VibeSettings, VibeSettings] => [DEFAULT_VIBE, { ...DEFAULT_VIBE, ...patch }];

describe('envelopes', () => {
  it('start and end at 0, never above 1, and reach 0 for good', () => {
    expect(envOf(-1)).toBe(0);
    expect(envOf(0)).toBe(0);
    expect(envOf(DROP_S)).toBe(0);
    expect(envOf(DROP_S + 5)).toBe(0);
    expect(swellOf(-1)).toBe(0);
    expect(swellOf(0)).toBe(0);
    let top = 0;
    for (let s = 0; s <= 2; s += 0.005) top = Math.max(top, envOf(s), swellOf(s));
    expect(top).toBeLessThanOrEqual(1);
    expect(top).toBeGreaterThan(0.6);
    expect(swellOf(5)).toBe(0);
    expect(swellOf(2.5)).toBeGreaterThan(0);
    expect(swellOf(2.8)).toBe(0);
  });

  it('rise in about 50 and 70 ms and fall smoothly (no frame jumps more than a rise step)', () => {
    expect(envOf(0.05)).toBeGreaterThan(0.85);
    expect(swellOf(0.07)).toBeGreaterThan(0.8);
    for (let s = 0.05; s < DROP_S; s += 1 / 120) expect(Math.abs(envOf(s + 1 / 120) - envOf(s))).toBeLessThan(0.06);
  });
});

describe('mix table', () => {
  const at = (settings: VibeSettings, energy: number): VibeFrame => {
    const s = createVibeState();
    settleVibe(s, settings, true, energy);
    return stepVibe(s, createVibeFrame(), FRAME, 0, { settings, playing: true, energy });
  };

  it('Auto vibe: quiet music is aurora and rich, loud music is glow and a lighter grain', () => {
    const quiet = at({ ...DEFAULT_VIBE, tapeGrain: true }, 0);
    const loud = at({ ...DEFAULT_VIBE, tapeGrain: true }, 1);
    expect(quiet.aurora).toBeCloseTo(1, 5);
    expect(loud.aurora).toBeCloseTo(0.24, 5);
    expect(quiet.rich).toBeCloseTo(1, 5);
    expect(loud.rich).toBe(0);
    expect(quiet.halo).toBeCloseTo(0.32, 5);
    expect(loud.halo).toBeCloseTo(1, 5);
    expect(quiet.tape).toBeCloseTo(0.5, 5);
    expect(loud.tape).toBeCloseTo(0.8, 5);
    // Specks no longer fade as the music gets louder.
    expect(quiet.grain).toBeCloseTo(0.7, 5);
    expect(loud.grain).toBeCloseTo(0.7, 5);
  });

  it('Auto vibe off: every effect sits at a fixed level whatever the energy', () => {
    const a = at({ ...DEFAULT_VIBE, auto: false, tapeGrain: true }, 0);
    const b = at({ ...DEFAULT_VIBE, auto: false, tapeGrain: true }, 1);
    expect(a.aurora).toBeCloseTo(0.7, 5);
    expect(b.aurora).toBeCloseTo(0.7, 5);
    expect(a.rich).toBeCloseTo(0.45, 5);
    expect(a.halo).toBeCloseTo(0.7, 5);
    expect(a.tape).toBeCloseTo(0.7, 5);
    expect(a.grain).toBeCloseTo(0.7, 5);
  });

  it('Tape Grain gates the tape; the glitch follows its own switch or Auto vibe', () => {
    expect(at(DEFAULT_VIBE, 0.5).tape).toBe(0);
    expect(at({ ...DEFAULT_VIBE, tapeGrain: true }, 0.5).tape).toBeGreaterThan(0);
    expect(at(DEFAULT_VIBE, 0.5).glitch).toBe(1);
    expect(at({ ...DEFAULT_VIBE, auto: false }, 0.5).glitch).toBe(0);
    expect(at({ ...DEFAULT_VIBE, auto: false, dropGlitch: true }, 0.5).glitch).toBe(1);
  });

  it('Calm cap halves the effects, removes the glitch and softens kick and bass', () => {
    const base = at({ ...DEFAULT_VIBE, tapeGrain: true }, 0.5);
    const calm = at({ ...DEFAULT_VIBE, tapeGrain: true, calmCap: true }, 0.5);
    expect(calm.aurora).toBeCloseTo(base.aurora / 2, 5);
    expect(calm.halo).toBeCloseTo(base.halo / 2, 5);
    expect(calm.tape).toBeCloseTo(base.tape / 2, 5);
    expect(calm.glitch).toBe(0);
    expect(calm.kickGain).toBe(0.5);
    expect(calm.bassGain).toBe(0.75);
    expect(base.glitch).toBe(1);
  });

  it('a drop shows the swell in the glow even under Calm cap, and the glitch envelope only without it', () => {
    const settings = { ...DEFAULT_VIBE, calmCap: true };
    const s = createVibeState();
    settleVibe(s, settings, true, 0.5);
    noteDrop(s, 10);
    const out = stepVibe(s, createVibeFrame(), FRAME, 10.1, { settings, playing: true, energy: 0.5 });
    expect(out.haloSwell).toBeGreaterThan(0.1);
    expect(out.glitch).toBe(0);
    expect(out.env).toBeGreaterThan(0);
  });

  it('two drops overlap their tails: the older one keeps fading, nothing cuts', () => {
    const s = createVibeState();
    settleVibe(s, DEFAULT_VIBE, true, 0.5);
    noteDrop(s, 1);
    noteDrop(s, 1.3);
    const out = createVibeFrame();
    let prev = 0;
    for (let t = 1; t < 4; t += FRAME) {
      stepVibe(s, out, FRAME, t, { settings: DEFAULT_VIBE, playing: true, energy: 0.5 });
      if (t > 1.5) expect(Math.abs(out.swell - prev)).toBeLessThan(0.1);
      prev = out.swell;
    }
    expect(out.swell).toBe(0);
    expect(out.haloSwell).toBe(0);
    expect(out.env).toBe(0);
  });

  /** Largest one frame fall of one drop's own envelope, the bound a crowd of drops must also keep. */
  const singleFall = (() => {
    let worst = 0;
    for (let t = 0; t < 4; t += 1 / 1200) {
      worst = Math.max(worst, envOf(t) - envOf(t + FRAME), swellOf(t) - swellOf(t + FRAME));
    }
    return worst;
  })();

  it('rapid drops never cut the envelope: it falls no faster than a single drop does at any phase', () => {
    for (const times of [[1, 1.01, 1.02], [1, 1.01, 1.02, 1.03, 1.04, 1.05, 1.06, 1.07, 1.08, 1.09, 1.1, 1.11], [1, 1.2, 1.4, 1.6, 1.8, 2]]) {
      const s = createVibeState();
      settleVibe(s, DEFAULT_VIBE, true, 0.5);
      const out = createVibeFrame();
      let prevEnv = 0;
      let prevSwell = 0;
      let next = 0;
      for (let t = 0.5; t < 8; t += FRAME) {
        while (next < times.length && times[next] <= t) noteDrop(s, times[next++]);
        stepVibe(s, out, FRAME, t, { settings: DEFAULT_VIBE, playing: true, energy: 0.5 });
        expect(prevEnv - out.env).toBeLessThanOrEqual(singleFall + 1e-9);
        expect(prevSwell - out.swell).toBeLessThanOrEqual(singleFall + 1e-9);
        prevEnv = out.env;
        prevSwell = out.swell;
      }
      expect(out.env).toBe(0);
      expect(out.swell).toBe(0);
    }
  });

  it('a full set of stamps replaces the one contributing least, never the strongest', () => {
    const s = createVibeState();
    settleVibe(s, DEFAULT_VIBE, true, 0.5);
    for (let i = 0; i < MAX_DROPS; i++) noteDrop(s, 1 + i * 0.01);
    expect(s.drops.length).toBe(MAX_DROPS);
    noteDrop(s, 1.2);
    expect(Array.from(s.drops)).toContain(1.2);
    expect(s.drops.filter((v) => v !== 1.2).length).toBe(MAX_DROPS - 1);
  });

  it('never reports inactive while a drop tail is still above 0', () => {
    const s = createVibeState();
    settleVibe(s, DEFAULT_VIBE, false, 0);
    noteDrop(s, 0);
    const out = createVibeFrame();
    for (let t = 0; t < 10; t += FRAME) {
      stepVibe(s, out, FRAME, t, { settings: DEFAULT_VIBE, playing: false, energy: 0 });
      if (!out.active) {
        expect(out.swell).toBe(0);
        expect(out.haloSwell).toBe(0);
        expect(out.env).toBe(0);
      }
    }
    expect(out.active).toBe(false);
  });

  it('keeps the frame finite for a NaN, infinite or out of range energy and a NaN step', () => {
    const clamped = (e: number) => {
      const s = createVibeState();
      settleVibe(s, DEFAULT_VIBE, true, 0.5);
      return { ...stepVibe(s, createVibeFrame(), FRAME, 0, { settings: DEFAULT_VIBE, playing: true, energy: e }) };
    };
    for (const e of [Number.NaN, Infinity, -Infinity, -3, 7]) {
      const f = clamped(e);
      for (const k of FIELDS) expect(Number.isFinite(f[k] as number), `${String(k)} at ${e}`).toBe(true);
    }
    expect(clamped(7)).toEqual(clamped(1));
    expect(clamped(-3)).toEqual(clamped(0));
    expect(clamped(Number.NaN)).toEqual(clamped(0));
    const s = createVibeState();
    settleVibe(s, DEFAULT_VIBE, true, 0.5);
    const out = stepVibe(s, createVibeFrame(), Number.NaN, 0, { settings: DEFAULT_VIBE, playing: true, energy: 0.5 });
    for (const k of FIELDS) expect(Number.isFinite(out[k] as number), String(k)).toBe(true);
  });

  it('the palette follows energy slowly, cool to warm', () => {
    const s = createVibeState();
    settleVibe(s, DEFAULT_VIBE, true, 0);
    const out = createVibeFrame();
    stepVibe(s, out, FRAME, 0, { settings: DEFAULT_VIBE, playing: true, energy: 1 });
    expect(out.palette).toBeLessThan(0.1);
    for (let i = 0; i < 300; i++) stepVibe(s, out, FRAME, i * FRAME, { settings: DEFAULT_VIBE, playing: true, energy: 1 });
    expect(out.palette).toBe(1);
  });
});

describe('nothing ends abruptly', () => {
  const cases: [string, Partial<VibeSettings>][] = [
    ['Auto vibe off', { auto: false }],
    ['Tape Grain on', { tapeGrain: true }],
    ['Drop Glitch on (Auto off)', { dropGlitch: true, auto: false }],
    ['Calm cap on', { calmCap: true }],
    ['Cover Scene only', { cover: 'scene' }],
  ];

  for (const [name, patch] of cases) {
    it(`${name}: per frame change under 0.05 at 30 fps, and it lands exactly`, () => {
      const [from, to] = flip(patch);
      const fwd = run(from, to, { energy: 0.6 });
      expect(fwd.max, fwd.maxField).toBeLessThan(0.05);
      // Back again: same bound, and it ends exactly where it started.
      const back = run(to, from, { energy: 0.6 });
      expect(back.max, back.maxField).toBeLessThan(0.05);
      const rest = run(from, from, { energy: 0.6 });
      for (const k of FIELDS) expect(back.out[k], k).toBeCloseTo(rest.out[k] as number, 9);
    });
  }

  it('Cover lands exactly on 0 and 1', () => {
    expect(run(...flip({ cover: 'scene' })).out.titleCover).toBe(1);
    expect(run({ ...DEFAULT_VIBE, cover: 'scene' }, DEFAULT_VIBE).out.titleCover).toBe(0);
  });

  it('the music stopping eases everything to exactly 0 within about 3 s, in small steps', () => {
    const r = run(DEFAULT_VIBE, DEFAULT_VIBE, { playing: true, playingTo: false, seconds: 5 });
    expect(r.max, r.maxField).toBeLessThan(0.05);
    for (const k of ['aurora', 'rich', 'halo', 'tape', 'glitch', 'live'] as const) expect(r.out[k], k).toBe(0);
    const early = run(DEFAULT_VIBE, DEFAULT_VIBE, { playing: true, playingTo: false, seconds: 1 });
    expect(early.out.live).toBeGreaterThan(0.05);
    expect(early.out.live).toBeLessThan(0.5);
    expect(early.out.active).toBe(true);
    expect(r.out.active).toBe(false);
  });

  it('music starting eases up in small steps too', () => {
    const r = run(DEFAULT_VIBE, DEFAULT_VIBE, { playing: false, playingTo: true, seconds: 6 });
    expect(r.max, r.maxField).toBeLessThan(0.05);
    expect(r.out.live).toBe(1);
  });

  it('is idle (inactive) at rest in silence, and a long frame is capped', () => {
    const s = createVibeState();
    const out = stepVibe(s, createVibeFrame(), FRAME, 0, { settings: DEFAULT_VIBE, playing: false, energy: 0 });
    expect(out.active).toBe(true); // auto and glitch have not reached their rest yet
    for (let i = 0; i < 400; i++) stepVibe(s, out, FRAME, i * FRAME, { settings: DEFAULT_VIBE, playing: false, energy: 0 });
    expect(out.active).toBe(false);
    const a = createVibeState();
    const b = createVibeState();
    const oa = stepVibe(a, createVibeFrame(), 10, 0, { settings: DEFAULT_VIBE, playing: true, energy: 0.5 });
    const ob = stepVibe(b, createVibeFrame(), MAX_DT_S, 0, { settings: DEFAULT_VIBE, playing: true, energy: 0.5 });
    expect(oa.live).toBe(ob.live);
  });

  it('the time constants keep the bound with margin', () => {
    // Peak per frame change of a two stage ease is 1 / (tau e) per second.
    for (const tau of [EASE_TAU_S, LIVE_TAU_S]) expect(1 / (tau * Math.E) / 30).toBeLessThan(0.05);
  });
});

describe('aurora level', () => {
  const run = (aurora: VibeSettings['aurora'], calmCap = false, seconds = 4) => {
    const s = createVibeState();
    settleVibe(s, { ...DEFAULT_VIBE, aurora: 'full', calmCap }, true, 0);
    const f = createVibeFrame();
    const settings = { ...DEFAULT_VIBE, aurora, calmCap };
    for (let i = 0; i < seconds * 30; i++) stepVibe(s, f, FRAME, i * FRAME, { settings, playing: true, energy: 0 });
    return f;
  };

  it('Full is today, Soft is half, Off is exactly 0', () => {
    const full = run('full').aurora;
    expect(full).toBeCloseTo(1, 5);
    expect(run('soft').aurora).toBeCloseTo(full * 0.5, 4);
    expect(run('off').aurora).toBe(0);
  });

  it('Calm cap still halves it, on every level', () => {
    expect(run('full', true).aurora).toBeCloseTo(0.5, 4);
    expect(run('soft', true).aurora).toBeCloseTo(0.25, 4);
  });

  it('Off fades out smoothly, never in one frame, and is exactly 0 by 0.5 s', () => {
    const s = createVibeState();
    settleVibe(s, DEFAULT_VIBE, true, 0);
    const f = createVibeFrame();
    const settings = { ...DEFAULT_VIBE, aurora: 'off' as const };
    let prev = 1;
    let maxStep = 0;
    let at03 = 1;
    for (let i = 1; i <= 15; i++) {
      stepVibe(s, f, FRAME, i * FRAME, { settings, playing: true, energy: 0 });
      maxStep = Math.max(maxStep, prev - f.aurora);
      prev = f.aurora;
      if (i === 9) at03 = f.aurora;
    }
    expect(at03).toBeGreaterThan(0.001);
    expect(maxStep).toBeLessThan(0.25);
    expect(f.aurora).toBe(0);
  });

  it('Bass Glow is not touched by the aurora level', () => {
    expect(run('off').halo).toBeCloseTo(run('full').halo, 6);
  });
});

describe('grain on the kick', () => {
  it('adds 30 percent at the kick and is back to nothing within 0.25 s', () => {
    expect(kickPulse(0)).toBe(1);
    expect(KICK_GRAIN).toBe(0.3);
    const s = createVibeState();
    const f = createVibeFrame();
    const inp = { settings: DEFAULT_VIBE, playing: true, energy: 0.5 };
    stepVibe(s, f, FRAME, 10, inp);
    expect(f.grainKick).toBe(0);
    noteKick(s, 10);
    stepVibe(s, f, FRAME, 10, inp);
    expect(f.grainKick).toBeCloseTo(0.3, 6);
    let prev = f.grainKick;
    for (let t = 10 + 1 / 60; t < 10.25; t += 1 / 60) {
      stepVibe(s, f, FRAME, t, inp);
      expect(f.grainKick).toBeLessThanOrEqual(prev);
      prev = f.grainKick;
    }
    stepVibe(s, f, FRAME, 10.25, inp);
    expect(f.grainKick).toBe(0);
  });

  it('Calm cap halves the pulse; resting grain is the same at any loudness', () => {
    const s = createVibeState();
    const f = createVibeFrame();
    settleVibe(s, { ...DEFAULT_VIBE, calmCap: true }, true, 0.2);
    noteKick(s, 1);
    stepVibe(s, f, FRAME, 1, { settings: { ...DEFAULT_VIBE, calmCap: true }, playing: true, energy: 0.2 });
    expect(f.grainKick).toBeCloseTo(0.15, 3);
    const a = stepVibe(createVibeState(), createVibeFrame(), FRAME, 0, { settings: DEFAULT_VIBE, playing: true, energy: 0.1 }).grain;
    const b = stepVibe(createVibeState(), createVibeFrame(), FRAME, 0, { settings: DEFAULT_VIBE, playing: true, energy: 0.9 }).grain;
    expect(a).toBe(b);
  });
});

describe('kick pulse, reduced motion and counters', () => {
  it('reduced motion zeroes the pulse and does not keep the loop awake', () => {
    const settings = { ...DEFAULT_VIBE, aurora: 'full' as const };
    const s = createVibeState();
    settleVibe(s, settings, false, 0);
    const f = createVibeFrame();
    noteKick(s, 5);
    stepVibe(s, f, FRAME, 5.01, { settings, playing: false, energy: 0 });
    expect(f.grainKick).toBeGreaterThan(0);
    expect(f.active).toBe(true);
    stepVibe(s, f, FRAME, 5.02, { settings, playing: false, energy: 0, reduced: true });
    expect(f.grainKick).toBe(0);
    expect(f.active).toBe(false);
  });

  it('a counter that was reset and then counted again still advances', () => {
    expect(counterAdvanced(6, 5)).toBe(true);
    expect(counterAdvanced(5, 5)).toBe(false);
    expect(counterAdvanced(0, 5)).toBe(false);
    expect(counterAdvanced(1, 5)).toBe(true);
    const s = createVibeState();
    const f = createVibeFrame();
    let last = 5;
    const count = 1;
    if (counterAdvanced(count, last)) noteKick(s, 3);
    last = count;
    stepVibe(s, f, FRAME, 3, { settings: DEFAULT_VIBE, playing: true, energy: 0.5 });
    expect(f.grainKick).toBeGreaterThan(0.29);
    expect(last).toBe(1);
  });
});
