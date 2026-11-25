import { describe, expect, it } from 'vitest';
import { DEFAULT_VIBE, type VibeSettings } from '../horizon/vibeSettings';
import {
  DROP_S,
  EASE_TAU_S,
  LIVE_TAU_S,
  MAX_DT_S,
  createVibeFrame,
  createVibeState,
  envOf,
  noteDrop,
  settleVibe,
  stepVibe,
  swellOf,
  type VibeFrame,
} from './mix';

const FRAME = 1 / 30;
const FIELDS: (keyof VibeFrame)[] = [
  'aurora', 'rich', 'halo', 'haloSwell', 'tape', 'grain', 'glitch', 'env', 'swell',
  'palette', 'titleCover', 'kickGain', 'bassGain', 'live',
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
    expect(swellOf(5)).toBeLessThan(0.0001);
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
    expect(quiet.grain).toBeCloseTo(1, 5);
    expect(loud.grain).toBeCloseTo(0.38, 5);
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
    expect(out.swell).toBeLessThan(0.005);
    expect(out.env).toBe(0);
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
