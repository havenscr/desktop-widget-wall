import { beforeEach, describe, expect, it } from 'vitest';
import { BAND_COUNT, CALM_HOLD_MS, HISTORY_HZ, HISTORY_ROWS, bandHistory, ingestLevels, pauseBandHistory, resetAudio, tickAudio, type BandHistory } from './store';
import { BAND_FLOOR, SPECTRUM_SCALE, sampleBands } from './spectrum';

/** A history with one row per entry of `rows` (newest last), each a full set of bands. */
function historyOf(rows: number[][]): BandHistory {
  const data = new Float32Array(HISTORY_ROWS * BAND_COUNT);
  rows.forEach((r, i) => data.set(r, i * BAND_COUNT));
  return { data, head: rows.length - 1, rows: rows.length };
}
const flat = (v: number) => new Array(BAND_COUNT).fill(v);
const impulse = (band: number, v = 1) => flat(0).map((_, i) => (i === band ? v : 0));

/** Feed `payload` as Rust would, 30 times a second, from `from` to `to` ms. */
function feed(bytes: number[], from: number, to: number) {
  for (let t = from; t < to; t += 33) {
    ingestLevels({ bands: bytes, waveform: [0.1], bass: 0.5, mid: 0.3, high: 0.1 }, t);
    tickAudio(t);
  }
}

describe('sampleBands', () => {
  it('a single-band impulse peaks at u = band / 31, and falls off within one band either side', () => {
    for (const band of [0, 7, 16, 31]) {
      const h = historyOf([impulse(band)]);
      const at = band / 31;
      expect(sampleBands(at, 0, h)).toBeCloseTo(SPECTRUM_SCALE, 6);
      let peakU = 0;
      let peak = -1;
      for (let k = 0; k <= 310; k++) {
        const v = sampleBands(k / 310, 0, h);
        if (v > peak) [peak, peakU] = [v, k / 310];
      }
      expect(peakU).toBeCloseTo(at, 2);
      if (band > 0) expect(sampleBands((band - 1) / 31, 0, h)).toBe(0);
      if (band < 31) expect(sampleBands((band + 1) / 31, 0, h)).toBe(0);
    }
  });

  it('a tone at band 0 lifts only the centre', () => {
    const h = historyOf([impulse(0)]);
    expect(sampleBands(0, 0, h)).toBeGreaterThan(1);
    for (let k = 1; k <= 100; k++) {
      const u = k / 100;
      if (u >= 1 / 31) expect(sampleBands(u, 0, h)).toBe(0);
    }
  });

  it('interpolates between bands and between rows', () => {
    const h = historyOf([flat(1), impulse(4)]); // older row all loud, newest only band 4
    // Half way between band 4 (1) and band 5 (0) on the newest row: a level of 0.5.
    expect(sampleBands(4.5 / 31, 0, h)).toBeCloseTo(((0.5 - BAND_FLOOR) / (1 - BAND_FLOOR)) * SPECTRUM_SCALE, 5);
    // Half a row back: half way between the impulse and the flat row.
    const half = sampleBands(10 / 31, 0.5 / HISTORY_HZ, h);
    expect(half).toBeCloseTo(((0.5 - BAND_FLOOR) / (1 - BAND_FLOOR)) * SPECTRUM_SCALE, 5);
    // Past the oldest row it reads the oldest.
    expect(sampleBands(10 / 31, 5, h)).toBeCloseTo(SPECTRUM_SCALE, 5);
  });

  it('gives nothing below the floor, the full scale at the top, and 0 for an empty history', () => {
    expect(sampleBands(0.5, 0, historyOf([flat(BAND_FLOOR - 0.01)]))).toBe(0);
    expect(sampleBands(0.5, 0, historyOf([flat(1)]))).toBeCloseTo(SPECTRUM_SCALE, 6);
    expect(sampleBands(0.5, 0, { data: new Float32Array(HISTORY_ROWS * BAND_COUNT), head: -1, rows: 0 })).toBe(0);
    // Out of range inputs clamp.
    expect(sampleBands(-1, -1, historyOf([impulse(0)]))).toBeCloseTo(SPECTRUM_SCALE, 6);
    expect(sampleBands(2, 0, historyOf([impulse(31)]))).toBeCloseTo(SPECTRUM_SCALE, 6);
  });
});

describe('the band history', () => {
  beforeEach(() => resetAudio());

  it('fills at 30 rows a second up to 7 seconds, smoothing each band with the levels attack and release', () => {
    feed(flat(255), 0, 3000);
    const h = bandHistory();
    expect(h.rows).toBeGreaterThanOrEqual(88);
    expect(h.rows).toBeLessThanOrEqual(92);
    // Rises quickly (attack 60 ms): the newest row is at full, the very first ones were part way.
    expect(h.data[h.head * BAND_COUNT]).toBeCloseTo(1, 2);
    expect(h.data[0]).toBeLessThan(0.9);
    feed(flat(255), 3000, 12000);
    expect(bandHistory().rows).toBe(HISTORY_ROWS);
  });

  it('a band falls slowly (release 350 ms) when it drops, never in one frame', () => {
    feed(flat(255), 0, 2000);
    feed(flat(0), 2000, 2033);
    const h = bandHistory();
    const v = h.data[h.head * BAND_COUNT];
    expect(v).toBeGreaterThan(0.8);
    expect(v).toBeLessThan(1);
  });

  it('after the music stops the rows release to zero, then writing stops', () => {
    feed(flat(255), 0, 2000);
    for (let t = 2000; t < 5000; t += 33) tickAudio(t);
    const h = bandHistory();
    expect(h.data[h.head * BAND_COUNT]).toBe(0);
    for (let t = 5000; t < 12000; t += 33) tickAudio(t);
    const head = bandHistory().head;
    for (let t = 12000; t < 13000; t += 33) tickAudio(t);
    expect(bandHistory().head).toBe(head); // a whole ring of silence is in: nothing written
    feed(flat(255), 13000, 13500);
    expect(bandHistory().head).not.toBe(head);
  });

  it('calming: with every band pumping on and off 6 times a second, a band turns at most once per hold, and the swing is small', () => {
    const rows: number[] = [];
    const h = bandHistory();
    let head = -1;
    for (let t = 0; t < 10_000; t += 33) {
      const on = Math.floor((t / 1000) * 12) % 2 === 0;
      ingestLevels({ bands: flat(on ? 230 : 110), waveform: [0.1], bass: 0.5, mid: 0.3, high: 0.1 }, t);
      tickAudio(t);
      if (h.head !== head) {
        head = h.head;
        rows.push(h.data[head * BAND_COUNT + 5]);
      }
    }
    const late = rows.slice(90); // after the first three seconds
    const turns: number[] = [];
    let dir = 0;
    late.forEach((v, i) => {
      if (i === 0 || v === late[i - 1]) return;
      const d = v > late[i - 1] ? 1 : -1;
      if (dir !== 0 && d !== dir) turns.push(i);
      dir = d;
    });
    for (let i = 1; i < turns.length; i++) expect(((turns[i] - turns[i - 1]) * 1000) / HISTORY_HZ).toBeGreaterThanOrEqual(CALM_HOLD_MS - 1000 / HISTORY_HZ);
    // The raw input swings by 0.47 (110 to 230 of 255); calmed, a band moves by a small part of that.
    expect(Math.max(...late) - Math.min(...late)).toBeLessThan(0.2);
  });

  it('calming keeps the demo lively: the kick still moves the bass bands well up and down every beat', async () => {
    const { demoPayload } = await import('./capture');
    const h = bandHistory();
    const rows: number[] = [];
    let head = -1;
    for (let t = 0; t < 6000; t += 33) {
      ingestLevels(demoPayload(t), t);
      tickAudio(t);
      if (h.head !== head) {
        head = h.head;
        rows.push(h.data[head * BAND_COUNT + 2]);
      }
    }
    const late = rows.slice(60);
    expect(Math.max(...late) - Math.min(...late)).toBeGreaterThan(0.12);
  });

  it('pausing stops every write, and resuming starts from an empty history', () => {
    feed(flat(255), 0, 2000);
    pauseBandHistory(true);
    const head = bandHistory().head;
    feed(flat(200), 2000, 4000);
    expect(bandHistory().head).toBe(head);
    pauseBandHistory(false);
    expect(bandHistory().rows).toBe(0);
    expect(sampleBands(0, 0)).toBe(0);
    feed(flat(255), 4000, 4500);
    expect(bandHistory().rows).toBeGreaterThan(10);
  });
});
