import { describe, expect, it } from 'vitest';
import { Engine, levelsFromBands, tuningFor } from './engine';
import { newPreview, stepPreview } from '../../src/studio/lightsync/preview';
import { INTENSITY_IDS, SYNTHWAVE } from '../../src/studio/lightsync/model';
import { SONG_MAKERS } from './songs';
import { capture } from './sim';

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
});
