import { describe, expect, it } from 'vitest';
import { BEAT_BANDS, MIN_BEAT_GAP_MS, createBeatDetector } from './beat';
import { createSourceClock } from './sourceTime';

/*
 * A port of the Rust analyser's band maths (`src-tauri/src/audio_analysis.rs`) for the low
 * bands only: 48 kHz mono, 1024 point Hann window, 32 log bands from 20 Hz to 16 kHz with the
 * narrow-band rule (a band narrower than one 47 Hz bin borrows the bin its centre falls in,
 * scaled by the fraction it covers), dB mapped to 0..255 over -70..-10 and normalised to 0..1
 * as the store does. Events every 33 ms, each analysing the newest 1024 samples.
 */
const N = 1024;
const HOP_S = 0.033;
const WIN = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
const NORM = 2 / (N * WIN.reduce((s, w) => s + w * w, 0));

interface Frame {
  t: number; // ms
  bands: number[]; // normalised 0..1, 32 entries (the high ones zero)
}

/** The low-band analyser at one sample rate: the narrow-band rule maps bands to bins differently at 44.1 and 48 kHz. */
function analyser(rate: number) {
  const binHz = rate / N;
  const ranges: { start: number; end: number; scale: number }[] = [];
  const ratio = Math.pow(16000 / 20, 1 / 32);
  let lo = 20;
  for (let b = 0; b < BEAT_BANDS; b++) {
    const hi = lo * ratio;
    const start = Math.max(1, Math.ceil(lo / binHz));
    const end = Math.max(1, Math.ceil(hi / binHz));
    if (end > start) ranges.push({ start, end, scale: 1 });
    else {
      const bin = Math.max(1, Math.round(Math.sqrt(lo * hi) / binHz));
      ranges.push({ start: bin, end: bin + 1, scale: Math.min(1, (hi - lo) / binHz) });
    }
    lo = hi;
  }
  const maxBin = Math.max(...ranges.map((r) => r.end));
  const cos = Array.from({ length: maxBin }, (_, k) => Float64Array.from({ length: N }, (_, i) => Math.cos((2 * Math.PI * k * i) / N)));
  const sin = Array.from({ length: maxBin }, (_, k) => Float64Array.from({ length: N }, (_, i) => Math.sin((2 * Math.PI * k * i) / N)));
  return (signal: Float64Array): Frame[] => {
    const frames: Frame[] = [];
    const hop = Math.round(rate * HOP_S);
    const power = new Float64Array(maxBin);
    for (let end = N; end <= signal.length; end += hop) {
      for (let k = 1; k < maxBin; k++) {
        let re = 0;
        let im = 0;
        for (let i = 0; i < N; i++) {
          const v = signal[end - N + i] * WIN[i];
          re += v * cos[k][i];
          im -= v * sin[k][i];
        }
        power[k] = re * re + im * im;
      }
      const bands = new Array<number>(32).fill(0);
      ranges.forEach((r, b) => {
        let p = 0;
        for (let k = r.start; k < r.end; k++) p += power[k];
        const db = 20 * Math.log10(Math.max(Math.sqrt(p * NORM * r.scale), 1e-9));
        bands[b] = Math.round(Math.min(1, Math.max(0, (db + 70) / 60)) * 255) / 255;
      });
      frames.push({ t: (end / rate) * 1000, bands });
    }
    return frames;
  };
}

const RATES = [44_100, 48_000] as const;
/** Beats are stamped on 33 ms frames, so spacing is checked to 35 ms. */
const SPACING_MS = 35;

/** Seeded random numbers, so every run sees the same noise. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Pink noise (Paul Kellet's filter over seeded white noise), `seconds` long, scaled by `amp`. */
function pink(rate: number, seconds: number, amp: number, seed = 7): Float64Array {
  const r = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  const out = new Float64Array(Math.round(seconds * rate));
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < out.length; i++) {
    const w = gauss();
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * amp * 0.11;
    b6 = w * 0.115926;
  }
  return out;
}

/** A synthetic kick drum at `bpm`: a sine sweeping 120 Hz down to 50 Hz, decaying over about 0.2 s. */
function kicks(rate: number, seconds: number, bpm: number, amp: number, offset = 0): Float64Array {
  const out = new Float64Array(Math.round(seconds * rate));
  const period = 60 / bpm;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate - offset;
    if (t < 0) continue;
    const tk = t % period;
    const phase = 2 * Math.PI * (50 * tk + 70 * 0.03 * (1 - Math.exp(-tk / 0.03)));
    out[i] = amp * Math.exp(-tk / 0.18) * Math.sin(phase) * Math.min(1, tk / 0.002);
  }
  return out;
}

const mix = (a: Float64Array, b: Float64Array) => a.map((v, i) => v + b[i]);

function run(frames: Frame[]): number[] {
  const d = createBeatDetector();
  for (const f of frames) d.push(f.bands, f.t);
  const out: number[] = [];
  // `beats()` keeps the newest eight; replay to collect all of them.
  const d2 = createBeatDetector();
  for (const f of frames) if (d2.push(f.bands, f.t)) out.push(d2.lastBeatAt);
  expect(out.length).toBe(d.count);
  return out;
}

describe('beat detector', () => {
  for (const rate of RATES) {
    const analyse = analyser(rate);

    it(`finds a 120 BPM kick over a quiet pink noise bed at ${rate} Hz: a beat per kick (one miss allowed), 0.5 s apart within 35 ms`, () => {
      const offset = 0.37; // the first kick lands after the warm-up
      const beats = run(analyse(mix(kicks(rate, 12, 120, 0.6, offset), pink(rate, 12, 0.15))));
      const expected = Math.floor((12 - offset) / 0.5);
      expect(beats.length).toBeGreaterThanOrEqual(expected - 1);
      expect(beats.length).toBeLessThanOrEqual(expected + 1);
      // Every gap is one kick period, or (at most once: the 9 dB margin can miss a kick under the bed) two.
      const gaps = beats.slice(1).map((b, i) => b - beats[i]);
      for (const g of gaps) expect(Math.min(Math.abs(g - 500), Math.abs(g - 1000))).toBeLessThanOrEqual(SPACING_MS);
      expect(gaps.filter((g) => g > 750).length).toBeLessThanOrEqual(1);
      // Each beat sits just after a kick onset (one event period plus the window, at most).
      for (const b of beats) expect(((b / 1000 - offset) % 0.5) * 1000).toBeLessThanOrEqual(33 + 25);
    });

    it(`finds a clean 120 BPM kick with no bed at ${rate} Hz`, () => {
      const beats = run(analyse(kicks(rate, 8, 120, 0.6, 0.37)));
      expect(beats.length).toBeGreaterThanOrEqual(14);
      for (let i = 1; i < beats.length; i++) expect(Math.abs(beats[i] - beats[i - 1] - 500)).toBeLessThanOrEqual(SPACING_MS);
    });

    it(`yields no beats from pink noise at ${rate} Hz, quiet to loud, two seeds each`, () => {
      // Fixed seeds. Not a guarantee: over 54 minutes of other seeds per rate the detector gave
      // 0 stray beats at 44.1 kHz and 3 at 48 kHz (see the pull request).
      for (const amp of [0.05, 0.2, 1]) {
        for (const seed of [24, 73]) expect(run(analyse(pink(rate, 45, amp, seed)))).toEqual([]);
      }
    });
  }

  it('yields no beats from silence or a steady tone', () => {
    const d = createBeatDetector();
    const steady = new Array(32).fill(0.6);
    let beats = 0;
    for (let t = 0; t < 5000; t += 33) if (d.push(steady, t)) beats++;
    const silent = new Array(32).fill(0);
    for (let t = 5000; t < 8000; t += 33) if (d.push(silent, t)) beats++;
    expect(beats).toBe(0);
    expect(d.count).toBe(0);
  });

  it('keeps beats at least 340 ms apart and backdates each to its onset frame', () => {
    const d = createBeatDetector();
    const quiet = new Array(32).fill(0.3);
    const loud = new Array(32).fill(0.6); // +18 dB in every band
    const seen: number[] = [];
    let t = 0;
    for (; t < 600; t += 33) d.push(quiet, t);
    // Two hits 132 ms apart: the second is inside the gap.
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i < 3; i++, t += 33) if (d.push(loud, t)) seen.push(d.lastBeatAt);
      t += 33;
      d.push(quiet, t);
    }
    expect(seen).toHaveLength(1);
    expect(d.lag).toBe(66); // confirmed two frames after the onset
  });

  it('starts afresh after a gap in events, so the first frame back is never a beat', () => {
    const d = createBeatDetector();
    const quiet = new Array(32).fill(0.2);
    const loud = new Array(32).fill(0.7);
    for (let t = 0; t < 1000; t += 33) d.push(quiet, t);
    let beats = 0;
    for (let t = 3000; t < 3100; t += 33) if (d.push(loud, t)) beats++;
    expect(beats).toBe(0);
  });

  it('never gives more than three beats in any one second, whatever the cadence (the calm limit)', () => {
    const quiet = new Array(32).fill(0.3);
    const loud = new Array(32).fill(0.65);
    let fastest = Infinity;
    for (let hits = 1; hits <= 4; hits++) {
      for (let rest = 1; rest <= 14; rest++) {
        const d = createBeatDetector();
        const beats: number[] = [];
        let t = 0;
        for (let i = 0; i < 20; i++, t += 33) d.push(quiet, t); // warm up
        for (let cycle = 0; cycle < 40; cycle++) {
          for (let i = 0; i < hits; i++, t += 33) if (d.push(loud, t)) beats.push(d.lastBeatAt);
          for (let i = 0; i < rest; i++, t += 33) if (d.push(quiet, t)) beats.push(d.lastBeatAt);
        }
        for (let i = 0; i < beats.length; i++) {
          const inWindow = beats.filter((b) => b >= beats[i] && b < beats[i] + 1000).length;
          expect(inWindow).toBeLessThanOrEqual(3);
          if (i > 0) fastest = Math.min(fastest, beats[i] - beats[i - 1]);
        }
      }
    }
    expect(fastest).toBeGreaterThanOrEqual(MIN_BEAT_GAP_MS);
    expect(fastest).toBeLessThan(MIN_BEAT_GAP_MS + 66); // the fastest pattern really does reach the gap
  });

  it('keeps beats 340 ms apart on the arrival clock too: repeated stalls near that cadence never give four in a real second', () => {
    const quiet = new Array(32).fill(0.3);
    const loud = new Array(32).fill(0.65);
    // A hit every 10 frames (330 ms of capture). Every 7 frames the web view stalls for three
    // frames, which then arrive in one burst, and the frames after it come 50 ms apart. The source
    // clock spreads each burst ahead of the arrival clock, so source time leads by a changing amount.
    const n = 600;
    const arrivals: number[] = [];
    let a = 0;
    for (let i = 0; i < n; i++) {
      const ph = i % 7;
      a += ph === 0 ? 3 * 33 : ph <= 3 ? 0 : 50;
      arrivals.push(a);
    }
    const replay = (withArrival: boolean) => {
      const d = createBeatDetector();
      const clock = createSourceClock();
      const confirmed: number[] = [];
      for (let i = 0; i < n; i++) {
        const t = clock.stamp(arrivals[i]);
        if (t === null) continue;
        const bands = i > 20 && i % 10 < 3 ? loud : quiet;
        if (withArrival ? d.push(bands, t, arrivals[i]) : d.push(bands, t)) confirmed.push(arrivals[i]);
      }
      return confirmed;
    };
    const mostInASecond = (beats: number[]) => Math.max(...beats.map((b) => beats.filter((x) => x >= b && x < b + 1000).length));
    // Spaced in source time only (the old rule), the pattern lands four beats inside one real second.
    expect(mostInASecond(replay(false))).toBe(4);
    const beats = replay(true);
    expect(beats.length).toBeGreaterThan(20);
    expect(mostInASecond(beats)).toBeLessThanOrEqual(3);
    for (let i = 1; i < beats.length; i++) expect(beats[i] - beats[i - 1]).toBeGreaterThanOrEqual(MIN_BEAT_GAP_MS);
  });

  it('reports the plain low level as bass, and reset clears the count', () => {
    const d = createBeatDetector();
    d.push([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1, 1, 1, 1, 1, 1], 0);
    expect(d.bass).toBeCloseTo(0.5, 9);
    d.reset();
    expect(d.count).toBe(0);
    expect(d.bass).toBe(0);
    expect(d.lastBeatAt).toBe(-Infinity);
    expect(d.beats()).toEqual([]);
  });
});

describe('the ?audio=demo levels', () => {
  it('carry 32 band bytes with a kick the detector finds at the demo rate', async () => {
    const { DEMO_KICK_HZ, demoPayload } = await import('./capture');
    const d = createBeatDetector();
    const beats: number[] = [];
    for (let ms = 0; ms < 10_000; ms += 33) {
      const p = demoPayload(ms);
      expect(p.bands).toHaveLength(32);
      for (const b of p.bands!) expect(Number.isInteger(b) && b >= 0 && b <= 255).toBe(true);
      if (d.push(p.bands!.map((b) => b / 255), ms)) beats.push(d.lastBeatAt);
    }
    const period = 1000 / DEMO_KICK_HZ;
    expect(beats.length).toBeGreaterThanOrEqual(Math.floor(10 * DEMO_KICK_HZ) - 2);
    for (let i = 1; i < beats.length; i++) expect(Math.abs(beats[i] - beats[i - 1] - period)).toBeLessThanOrEqual(SPACING_MS);
  });
});
