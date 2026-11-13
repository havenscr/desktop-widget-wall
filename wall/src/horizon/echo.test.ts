import { describe, expect, it } from 'vitest';
import { CAMERAS, HOME_MORNING, settled, startGlide, stepGlide } from './cameras';
import {
  ECHO_FADE_S,
  ECHO_GATE_S,
  PLAY_TINT,
  REST_LOOK,
  REST_OPACITY,
  REST_PHASE,
  REST_DWELL_S,
  REST_QUIET_S,
  REST_RESUME,
  REST_RESUME_S,
  createEchoMotion,
  createEchoSampler,
  echoStrength,
  musicDriving,
  restEchoMotion,
  scaleEcho,
  stepEchoMotion,
  stepLineCount,
  LINE_COUNT_RATE,
  echoOptions,
  initialEchoGate,
  stepEchoFade,
  stepEchoGate,
  visualizerWeight,
} from './echo';
import { blendCamera } from './cameras';
import { BAND_FLOOR } from '../audio/spectrum';

it('takes ea, en, eamp and ecx from the camera preset, with hs 900 and the animation time', () => {
  for (const place of ['work', 'home', 'unwind'] as const) {
    const cam = CAMERAS[place];
    const e = echoOptions(cam, 1, 2.5)!;
    expect(e).toMatchObject({ n: cam.en, amp: cam.eamp, cx: cam.ecx, hs: 900, t: 2.5 });
    // Unwind's playing look is raised to full opacity; Work and Home stay at ea.
    expect(e.a).toBeCloseTo(place === 'unwind' ? 1 : cam.ea, 9);
  }
});

it('has the values from the concept demo', () => {
  expect(CAMERAS.unwind).toMatchObject({ ea: 0.9, en: 11, eamp: 34, ecx: 1330 });
  expect(CAMERAS.work).toMatchObject({ ea: 0.3, en: 3, eamp: 8, ecx: 1900 });
  expect(CAMERAS.home).toMatchObject({ ea: 0.22, en: 3, eamp: 6, ecx: 2300 });
});

it('draws no live lines on Work and Home at zero loudness (and nothing at all unless resting)', () => {
  expect(echoOptions(CAMERAS.work, 0, 0)).toBeNull();
  expect(echoOptions(CAMERAS.home, 0, 0)).toBeNull();
});

it('opacity scales with loudness and with the gate on Work and Home', () => {
  for (const cam of [CAMERAS.work, CAMERAS.home]) {
    const quiet = echoOptions(cam, 0.1, 0)!.a;
    const loud = echoOptions(cam, 0.9, 0)!.a;
    const half = echoOptions(cam, 0.9, 0, 0.5)!.a;
    expect(loud).toBeGreaterThan(quiet);
    expect(half).toBeCloseTo(loud / 2, 9);
    expect(loud).toBeLessThanOrEqual(cam.ea);
  }
});

describe('the Unwind visualizer', () => {
  it('Unwind is the visualizer, Work and Home are not', () => {
    expect(visualizerWeight(CAMERAS.unwind)).toBe(1);
    expect(visualizerWeight(CAMERAS.work)).toBe(0);
    expect(visualizerWeight(CAMERAS.home)).toBe(0);
    expect(visualizerWeight(HOME_MORNING)).toBe(0);
  });

  it('while playing the lines are at full opacity (ea 0.9 raised by PLAY_BOOST), with no loudness scaling, at full height, tinted', () => {
    for (const loud of [0, 0.2, 1]) {
      const e = echoOptions(CAMERAS.unwind, loud, 3)!;
      expect(e.a).toBeCloseTo(1, 9);
      expect(e.tint).toMatchObject({ centre: PLAY_TINT.centre, right: PLAY_TINT.right, k: 1, width: 1.5 });
      expect(e.amp).toBe(34);
      expect(e.n).toBe(11);
    }
  });

  it('the tint is on Unwind only, never on Work and Home', () => {
    expect(echoOptions(CAMERAS.unwind, 0, 0)!.tint!.k).toBe(1);
    expect(echoOptions(CAMERAS.work, 1, 0)!.tint).toBeUndefined();
    expect(echoOptions(CAMERAS.home, 1, 0)!.tint).toBeUndefined();
  });

  it('a glide from Work to Unwind eases the live opacity and the tint in rather than switching them', () => {
    const out: number[] = [];
    const tint: number[] = [];
    for (let k = 0; k <= 100; k++) {
      const e = echoOptions(blendCamera(CAMERAS.work, CAMERAS.unwind, k / 100), 0.3, 0);
      out.push(e?.a ?? 0);
      tint.push(e?.tint?.k ?? 0);
    }
    expect(out[100]).toBeCloseTo(1, 9);
    for (let i = 1; i < out.length; i++) {
      expect(Math.abs(out[i] - out[i - 1])).toBeLessThan(0.06);
      expect(Math.abs(tint[i] - tint[i - 1])).toBeLessThan(0.06);
    }
  });

  it('the gate takes everything away, the resting lines included', () => {
    expect(echoOptions(CAMERAS.unwind, 1, 0, 0)).toBeNull();
    expect(echoOptions(CAMERAS.unwind, 1, 0, 0, 1)).toBeNull();
    expect(echoOptions(CAMERAS.unwind, 0, 0, 0.5)!.a).toBeCloseTo(0.5, 9);
  });

  it('the sampler reads the band history at the line\'s age', () => {
    const ages: number[] = [];
    const s = createEchoSampler((u, age) => {
      ages.push(age);
      return u * 10;
    });
    s.t = 20;
    expect(s.sample(0.5, 17)).toBe(5);
    expect(ages).toEqual([3]);
  });
});

it('passes a blended line count through unrounded (the renderer crossfades the whole counts)', () => {
  expect(echoOptions({ ...CAMERAS.unwind, en: 6.6 }, 1, 0)!.n).toBe(6.6);
  expect(echoOptions({ ...CAMERAS.unwind, en: 0.4 }, 1, 0)!.n).toBe(1);
});

it('fades in and out over about a second', () => {
  let f = 0;
  for (let i = 0; i < 5; i++) f = stepEchoFade(f, true, ECHO_FADE_S / 10);
  expect(f).toBeCloseTo(0.5, 9);
  expect(stepEchoFade(0, true, 5)).toBe(1);
  expect(stepEchoFade(1, false, ECHO_FADE_S / 4)).toBeCloseTo(0.75, 9);
  expect(stepEchoFade(0.1, false, 5)).toBe(0);
});

it('strength on Work and Home is exactly ea * gate * level, and zero loudness gives no live ripple', () => {
  expect(echoOptions(CAMERAS.work, 0.4, 0, 0.5)!.a).toBeCloseTo(CAMERAS.work.ea * 0.5 * 0.4, 9);
  expect(echoOptions(CAMERAS.work, 0, 0)).toBeNull();
});

describe('the camera gate', () => {
  const open = () => ({ value: 1, shut: false });

  it('ramps out from the first frame of a move to Rainier, is exactly 0 by 0.6 s, and stays shut there', () => {
    let g = startGlide(settled(CAMERAS.work), HOME_MORNING, false, true);
    const gate = initialEchoGate(settled(CAMERAS.work));
    expect(gate).toEqual({ value: 1, shut: false });
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      g = stepGlide(g, 0.1);
      seen.push(stepEchoGate(gate, g, 0.1));
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeLessThan(seen[i - 1]);
    expect(seen[0]).toBeCloseTo(1 - 0.1 / ECHO_GATE_S, 9);
    expect(seen[4]).toBeGreaterThan(0); // still ramping at 0.5 s
    expect(seen[5]).toBe(0); // exactly 0 at 0.6 s
    expect(gate.shut).toBe(true);
    // Uneven frames: still exactly 0 within 0.6 s of the start.
    let g2 = startGlide(settled(CAMERAS.unwind), HOME_MORNING, false, true);
    const gate2 = open();
    let t = 0;
    for (const dt of [0.033, 0.05, 0.017, 0.1, 0.1, 0.1, 0.1, 0.1]) {
      g2 = stepGlide(g2, dt);
      t += dt;
      stepEchoGate(gate2, g2, dt);
      if (t >= ECHO_GATE_S - 1e-9) expect(gate2.value).toBe(0);
    }
    g = stepGlide(g, 10);
    expect(stepEchoGate(open(), g, 0.1)).toBe(0); // the Rainier camera is the view: never drawn
    expect(initialEchoGate(settled(HOME_MORNING))).toEqual({ value: 0, shut: true });
  });

  it('stays shut while the turn away runs, then ramps in over 0.6 s once it settles', () => {
    let g = startGlide(settled(HOME_MORNING), CAMERAS.home, false);
    const gate = initialEchoGate(settled(HOME_MORNING));
    for (let i = 0; i < 31; i++) {
      g = stepGlide(g, 0.1);
      expect(stepEchoGate(gate, g, 0.1)).toBe(0);
    }
    const ramp: number[] = [];
    for (let i = 0; i < 7; i++) {
      g = stepGlide(g, 0.1);
      ramp.push(stepEchoGate(gate, g, 0.1));
    }
    expect(g.progress).toBe(1);
    expect(ramp[0]).toBeCloseTo(0.1 / ECHO_GATE_S, 9); // the arrival frame
    for (let i = 1; i < 6; i++) expect(ramp[i]).toBeGreaterThan(ramp[i - 1]);
    expect(ramp[5]).toBeCloseTo(1, 9);
    expect(ramp[6]).toBe(1);
  });

  it('once shut, a turn reversed half way back toward a camera with a ripple stays shut until it settles', () => {
    let g = startGlide(settled(CAMERAS.unwind), HOME_MORNING, false, true);
    const gate = open();
    for (let i = 0; i < 10; i++) {
      g = stepGlide(g, 0.1);
      stepEchoGate(gate, g, 0.1);
    }
    expect(gate.value).toBe(0);
    expect(g.progress).toBeLessThan(1);
    // Back to Unwind from half way: the glide starts from a blended camera whose ea is not 0.
    g = startGlide(g, CAMERAS.unwind, false);
    expect(g.from.ea).toBeGreaterThan(0);
    while (g.progress < 1) {
      g = stepGlide(g, 0.1);
      const v = stepEchoGate(gate, g, 0.1);
      if (g.progress < 1) expect(v).toBe(0);
    }
    expect(gate.shut).toBe(false);
    expect(gate.value).toBeCloseTo(0.1 / ECHO_GATE_S, 9);
  });

  it('stays open on moves between cameras that both have a ripple', () => {
    let g = startGlide(settled(CAMERAS.work), CAMERAS.unwind, false);
    const gate = open();
    for (let i = 0; i < 20; i++) {
      g = stepGlide(g, 0.1);
      expect(stepEchoGate(gate, g, 0.1)).toBe(1);
    }
  });

  it('the gate scales the ripple', () => {
    expect(echoOptions(CAMERAS.home, 1, 0, 0.5)!.a).toBeCloseTo(CAMERAS.home.ea * 0.5, 9);
    expect(echoOptions(CAMERAS.home, 1, 0, 0)).toBeNull();
  });
});

describe('the rest state options', () => {
  it('rest 0 adds nothing (the playing options are unchanged); rest above 0 carries the resting opacity and look', () => {
    expect(echoOptions(CAMERAS.unwind, 0.5, 3, 1, 0)).toEqual(echoOptions(CAMERAS.unwind, 0.5, 3));
    const e = echoOptions(CAMERAS.unwind, 0.5, 3, 1, 0.4)!;
    expect(e).toMatchObject({ rest: 0.4, restA: REST_OPACITY, look: REST_LOOK, a: 1 });
    expect(echoOptions(CAMERAS.unwind, 0.5, 3, 0.5, 1, 'ridge', 0.15)).toMatchObject({ rest: 1, restA: 0.075, look: 'ridge' });
  });

  it('Work and Home at rest draw their lines even with no loudness; the morning camera never does', () => {
    for (const cam of [CAMERAS.work, CAMERAS.home]) {
      expect(echoOptions(cam, 0, 0)).toBeNull();
      expect(echoOptions(cam, 0, 0, 1, 1)).toMatchObject({ n: 3, a: 0, rest: 1, restA: REST_OPACITY });
    }
    expect(echoOptions(HOME_MORNING, 1, 0, 1, 1)).toBeNull();
    expect(echoOptions(CAMERAS.work, 0, 0, 0, 1)).toBeNull(); // the gate still takes it all away
  });

  it('strength eases from the live opacity to the resting one; scaling scales both', () => {
    const e = echoOptions(CAMERAS.unwind, 0, 0, 1, 0.5)!;
    expect(echoStrength(e)).toBeCloseTo(1 + (REST_OPACITY - 1) * 0.5, 9);
    scaleEcho(e, 0.5);
    expect(e.a).toBeCloseTo(0.5, 9);
    expect(e.restA).toBeCloseTo(REST_OPACITY / 2, 9);
    expect(echoStrength(echoOptions(CAMERAS.unwind, 0, 0)!)).toBe(1);
  });

  /** Step a motion as the canvas does for `seconds` at 30 fps with every band at `level` (playing unless `level` is null); returns driving per frame. */
  function feed(m: ReturnType<typeof createEchoMotion>, level: number | null, seconds: number): boolean[] {
    const bands = new Float32Array(32).fill(level ?? 0);
    const out: boolean[] = [];
    for (let f = 0; f < Math.round(seconds * 30); f++) {
      const d = musicDriving(m, level !== null, bands, 1 / 30);
      stepEchoMotion(m, d, 1 / 30);
      out.push(d);
    }
    return out;
  }
  const LOUD = 0.8;
  const QUIET = BAND_FLOOR - 0.01;
  const lifts = (seq: boolean[]) => seq.filter((d, i) => d && !(i > 0 && seq[i - 1])).length;

  it('driving stays on until every band has been under the floor for 1.5 s', () => {
    const m = createEchoMotion(false);
    expect(feed(m, LOUD, 1).every(Boolean)).toBe(true);
    const quiet = feed(m, QUIET, 3);
    expect(quiet.indexOf(false)).toBe(Math.ceil(REST_QUIET_S * 30) - 1);
    expect(quiet.slice(quiet.indexOf(false)).every((d) => !d)).toBe(true);
  });

  it('a pause settles at once, and a start with sound lifts promptly (after a third of a second over the resume level)', () => {
    const m = createEchoMotion(false);
    feed(m, LOUD, 1);
    expect(feed(m, null, 0.1)[0]).toBe(false);
    feed(m, null, 4);
    expect(m.rest).toBe(1);
    const back = feed(m, LOUD, 2);
    expect(back.indexOf(true)).toBe(Math.round(REST_RESUME_S * 30) - 1);
    expect(m.rest).toBe(0); // fully lifted within 2 s
  });

  it('a silent start stays at rest; so does sound under the resume level', () => {
    const m = createEchoMotion();
    expect(feed(m, QUIET, 5).some(Boolean)).toBe(false);
    expect(feed(m, (BAND_FLOOR + REST_RESUME) / 2, 5).some(Boolean)).toBe(false);
    expect(m.rest).toBe(1);
  });

  it('one blip does not lift the lines', () => {
    const m = createEchoMotion();
    feed(m, QUIET, 1);
    expect(feed(m, LOUD, 1 / 30)).toEqual([false]);
    expect(feed(m, QUIET, 2).some(Boolean)).toBe(false);
    expect(m.rest).toBe(1);
  });

  it('two seconds quiet and two seconds loud, alternating, never pumps faster than the dwell allows', () => {
    const m = createEchoMotion(false);
    const seq: boolean[] = [];
    for (let k = 0; k < 6; k++) seq.push(...feed(m, QUIET, 2), ...feed(m, LOUD, 2));
    // 24 s: a quiet settle holds 4 s, so at most one lift in every 4 s of quiet plus a loud spell.
    expect(lifts(seq)).toBeLessThanOrEqual(Math.ceil(24 / (REST_QUIET_S + REST_DWELL_S)));
    // And never a lift within the dwell of a quiet settle.
    for (let i = 1; i < seq.length; i++) {
      if (seq[i - 1] && !seq[i]) {
        const next = seq.indexOf(true, i);
        if (next > 0) expect(next - i).toBeGreaterThanOrEqual(Math.round(REST_DWELL_S * 30) - 1);
      }
    }
  });

  it('the resume level sits just over the floor: steady 0.36 for a second lifts, steady 0.34 does not', () => {
    expect(REST_RESUME).toBeCloseTo(BAND_FLOOR + 0.05, 12);
    const lifts36 = feed(createEchoMotion(), 0.36, 1);
    expect(lifts36.indexOf(true)).toBe(Math.round(REST_RESUME_S * 30) - 1);
    expect(feed(createEchoMotion(), 0.34, 1).some(Boolean)).toBe(false);
  });

  it('after a quiet settle, steady music lifts once the dwell has passed; a pause and play lifts promptly', () => {
    const m = createEchoMotion(false);
    feed(m, QUIET, REST_QUIET_S + 0.1); // settles on quiet
    const after = feed(m, LOUD, 6);
    const first = after.indexOf(true);
    expect(first).toBeGreaterThanOrEqual(Math.round((REST_DWELL_S - 0.1) * 30) - 1);
    expect(first).toBeLessThanOrEqual(Math.round((REST_DWELL_S + REST_RESUME_S) * 30));
    feed(m, QUIET, REST_QUIET_S + 0.1);
    feed(m, null, 0.5); // a real pause clears the dwell
    expect(feed(m, LOUD, 1).indexOf(true)).toBe(Math.round(REST_RESUME_S * 30) - 1);
  });

  it('a hidden page puts the motion straight at rest', () => {
    const m = createEchoMotion(false);
    stepEchoMotion(m, true, 0.3);
    restEchoMotion(m);
    expect(m).toMatchObject({ rest: 1, drift: REST_PHASE, v: 0, driving: false });
  });
});

describe('the drawn line count', () => {
  it('follows the camera\'s count at LINE_COUNT_RATE and lands on it exactly', () => {
    expect(LINE_COUNT_RATE).toBe(4);
    let c = 3;
    const seen: number[] = [];
    for (let f = 0; f < 80; f++) {
      c = stepLineCount(c, 11, 1 / 30);
      seen.push(c);
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i] - seen[i - 1]).toBeLessThanOrEqual(4 / 30 + 1e-12);
    expect(c).toBe(11);
    expect(seen.indexOf(11)).toBe(59); // 8 counts at 4 a second: 2 s
    expect(stepLineCount(11, 3, 0.5)).toBe(9);
    expect(stepLineCount(3.05, 3, 1 / 30)).toBe(3);
  });
});

