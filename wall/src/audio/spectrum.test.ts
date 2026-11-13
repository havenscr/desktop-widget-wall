import { beforeEach, describe, expect, it } from 'vitest';
import { BAND_COUNT, HISTORY_HZ, HISTORY_ROWS, danceHistory, danceKick, ingestLevels, pauseDanceHistory, resetAudio, tickAudio, type BandHistory } from './store';
import { sampleDance } from './spectrum';
import { DANCE_LIMIT } from './dance';

/** A history with one row per entry of `rows` (newest last), each a full set of bands. */
function historyOf(rows: number[][]): BandHistory {
  const data = new Float32Array(HISTORY_ROWS * BAND_COUNT);
  rows.forEach((r, i) => data.set(r, i * BAND_COUNT));
  return { data, head: rows.length - 1, rows: rows.length };
}
const flat = (v: number) => new Array(BAND_COUNT).fill(v);
const impulse = (band: number, v = 1) => flat(0).map((_, i) => (i === band ? v : 0));

describe('sampleDance', () => {
  it('reads heights as they are (no floor), with a smoothstep between neighbouring bands', () => {
    const h = historyOf([impulse(4, 1.5)]);
    expect(sampleDance(4 / 31, 0, h)).toBeCloseTo(1.5, 6);
    // A quarter of the way from band 4 to 5: smoothstep(0.25) = 0.15625 of the way down.
    expect(sampleDance(4.25 / 31, 0, h)).toBeCloseTo(1.5 * (1 - 0.15625), 6);
    // Half way is half.
    expect(sampleDance(4.5 / 31, 0, h)).toBeCloseTo(0.75, 6);
    expect(sampleDance(5 / 31, 0, h)).toBeCloseTo(0, 6);
  });

  it('interpolates between rows linearly, reads the oldest past the end, and gives 0 for an empty history or u outside 0 to 1', () => {
    const h = historyOf([flat(1), impulse(4, 1)]);
    expect(sampleDance(10 / 31, 0.5 / HISTORY_HZ, h)).toBeCloseTo(0.5, 6);
    expect(sampleDance(10 / 31, 9, h)).toBeCloseTo(1, 6);
    expect(sampleDance(0.3, 0, historyOf([]))).toBe(0);
    expect(sampleDance(-3, 0, historyOf([flat(0.7)]))).toBeCloseTo(0.7, 6);
    expect(sampleDance(9, -2, historyOf([flat(0.7)]))).toBeCloseTo(0.7, 6);
  });
});

describe('the dance history in the store', () => {
  beforeEach(() => resetAudio());
  const kick = new Array(32).fill(100).map((v, i) => (i < 6 ? 240 : v));
  const quiet = new Array(32).fill(100);
  const feedRows = (bytes: number[], from: number, to: number) => {
    for (let t = from; t < to; t += 33) {
      ingestLevels({ bands: bytes, waveform: [0.1], bass: 0.5, mid: 0.3, high: 0.1 }, t);
      tickAudio(t);
    }
  };

  it('writes shaped rows at 30 a second, all within the soft limit', () => {
    feedRows(quiet, 0, 3000);
    const d = danceHistory();
    expect(d.rows).toBeGreaterThan(80);
    for (const v of d.data) expect(v).toBeLessThanOrEqual(DANCE_LIMIT);
  });

  it('a bass hit lifts the bass lines and the kick, which then falls back', () => {
    feedRows(quiet, 0, 6000);
    const before = sampleDance(0, 0);
    expect(danceKick()).toBeLessThan(0.01);
    feedRows(kick, 6000, 6130);
    expect(sampleDance(0, 0)).toBeGreaterThan(before + 0.5);
    expect(danceKick()).toBeGreaterThan(0.5);
    feedRows(quiet, 6130, 9000);
    expect(danceKick()).toBeLessThan(0.05);
    expect(sampleDance(0, 0)).toBeLessThan(before + 0.2);
  });

  it('pausing the history, or a whole ring of silence, leaves the shaped history and its followers clean', () => {
    feedRows(kick, 0, 3000);
    expect(danceKick()).toBeGreaterThan(0);
    pauseDanceHistory(true);
    pauseDanceHistory(false);
    expect(danceHistory().rows).toBe(0);
    expect(danceKick()).toBe(0);
    expect(sampleDance(0, 0)).toBe(0);
    // Silence: after the 7 s ring is all quiet the kick and heights are zero.
    feedRows(kick, 4000, 6000);
    for (let t = 6000; t < 16000; t += 33) tickAudio(t);
    expect(danceKick()).toBe(0);
    expect(sampleDance(0, 0)).toBeLessThan(0.002);
  });

  it('the first hit after a pause is as big as the first hit after a fresh start', () => {
    const run = () => {
      feedRows(quiet, 0, 3000);
      let top = 0;
      for (let t = 3000; t < 3400; t += 33) {
        ingestLevels({ bands: kick, waveform: [0.1], bass: 0.5, mid: 0.3, high: 0.1 }, t);
        tickAudio(t);
        top = Math.max(top, sampleDance(0, 0));
      }
      return top;
    };
    resetAudio();
    const fresh = run();
    resetAudio();
    feedRows(kick, 0, 5000); // a loud stretch builds a peak
    pauseDanceHistory(true);
    pauseDanceHistory(false);
    const afterPause = run();
    expect(afterPause).toBeCloseTo(fresh, 6);
  });
});

describe('the history objects are fixed', () => {
  it('danceHistory() is the same object every call, written in place', () => {
    resetAudio();
    const d = danceHistory();
    const data = d.data;
    for (let t = 0; t < 2000; t += 33) {
      ingestLevels({ bands: new Array(32).fill(150), waveform: [0.1], bass: 0.5, mid: 0.3, high: 0.1 }, t);
      tickAudio(t);
    }
    expect(danceHistory()).toBe(d);
    expect(danceHistory().data).toBe(data);
  });
});
