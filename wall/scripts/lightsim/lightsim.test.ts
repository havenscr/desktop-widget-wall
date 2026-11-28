import { describe, expect, it } from 'vitest';
import { Engine, levelsFromBands, tuningFor } from './engine';
import { newPreview, stepPreview } from '../../src/studio/lightsync/preview';
import { INTENSITY_IDS, SYNTHWAVE } from '../../src/studio/lightsync/model';
import { SONG_MAKERS } from './songs';
import { capture } from './sim';
import { createBeatDetector } from '../../src/audio/beat';

describe('light sync sandbox', () => {
  it('the engine port gives the page preview frames on a row of five panels', () => {
    const row = [0, 1, 2, 3, 4].map((x) => [x, 0] as const);
    for (const id of INTENSITY_IDS) {
      const t = tuningFor(id, SYNTHWAVE);
      const eng = new Engine(t.s.floor);
      const pre = newPreview(t.s.floor);
      let seed = 3;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      let count = 0;
      for (let i = 0; i < 900; i++) {
        const beat = rnd() < 0.08;
        if (beat) count++;
        const input = { bass: rnd(), high: rnd(), dtMs: 15 + rnd() * 10 };
        const a = eng.step(t, { ...input, beat }, 4, row);
        const b = stepPreview(pre, t.s, t.ui, SYNTHWAVE, { ...input, beatCount: count });
        a.plays.forEach((c, k) => c.forEach((v, j) => expect(v).toBeCloseTo(b.plays[k][j], 9)));
        a.panels.forEach((c, k) => c.forEach((v, j) => expect(v).toBeCloseTo(b.panels[k][j], 9)));
      }
    }
  });

  it('levels come from bytes 0 to 5 and 20 to 31, as the native side reads them', () => {
    const b = Array.from({ length: 32 }, (_, i) => (i < 6 ? 255 : i >= 20 ? 51 : 0));
    const [lo, hi] = levelsFromBands(b);
    expect(lo).toBe(1);
    expect(hi).toBeCloseTo(0.2, 12);
    expect(levelsFromBands([])).toEqual([0, 0]);
  });

  it('the synthetic house track puts its kicks in the low bands, one frame after each kick', () => {
    const song = SONG_MAKERS.house120();
    const cap = capture(song);
    const k = song.kicks[20] * 1000;
    const i = cap.at.findIndex((a) => a > k + 20);
    const low = (j: number) => cap.frames[j].bands.slice(0, 6).reduce((s, v) => s + v, 0) / 6;
    expect(low(i)).toBeGreaterThan(low(i - 1) + 40);
  });

  /** The beat detector alone, fed as the native loop feeds it (50 Hz ticks, newest frame): hits on true kicks and false beats. */
  function detect(id: keyof typeof SONG_MAKERS) {
    const song = SONG_MAKERS[id]();
    const cap = capture(song);
    const det = createBeatDetector();
    const hit = new Set<number>();
    let falses = 0;
    let next = 0;
    for (let t = 0; t <= song.seconds * 1000; t += 20) {
      let fresh = -1;
      while (next < cap.at.length && cap.at[next] <= t) fresh = next++;
      if (fresh < 0) continue;
      const b = cap.frames[fresh].bands;
      if (!det.push(Array.from({ length: 12 }, (_, i) => (i < b.length ? b[i] / 255 : 0)), t, t)) continue;
      const k = song.kicks.findIndex((kt, i) => det.lastBeatAt - kt * 1000 >= -60 && det.lastBeatAt - kt * 1000 <= 150 && !hit.has(i));
      if (k < 0) falses++;
      else hit.add(k);
    }
    return { hits: hit.size / song.kicks.length, falsesPerMin: (falses * 60) / song.seconds };
  }

  it('the tempo lock finds synthwave kicks the onset bar misses, without false beats on the other songs', () => {
    expect(detect('synthwave').hits).toBeGreaterThanOrEqual(0.25);
    expect(detect('house120').hits).toBeGreaterThanOrEqual(0.97);
    expect(detect('ballad70').falsesPerMin).toBe(0);
    expect(detect('edm-drop').falsesPerMin).toBeLessThanOrEqual(1.4);
  });
});
