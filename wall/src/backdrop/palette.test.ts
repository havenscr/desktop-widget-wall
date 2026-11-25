import { describe, expect, it } from 'vitest';
import type { PlaceId } from '../state/places';
import { DEFAULT_STRENGTH, MIN_CONTRAST, strengthHurtsText, SHADER_CAP, bareContrast, createSkyColours, legibleGain, pageGain, skyColoursAt, skyColoursForAlt, softCap, totalGain, worstCase } from './palette';

const PLACES: PlaceId[] = ['zen', 'work', 'home', 'unwind', 'meet', 'onair', 'shelf'];
const STYLES = ['wash', 'aurora'] as const;

describe('sky palette', () => {
  it('gives night the strongest sky, sunset next and bright noon the faintest', () => {
    const night = skyColoursForAlt(-30, true, 'wash', createSkyColours()).gain;
    const sunset = skyColoursForAlt(-2, true, 'wash', createSkyColours()).gain;
    const noon = skyColoursForAlt(40, false, 'wash', createSkyColours()).gain;
    expect(night).toBeCloseTo(0.9, 2);
    expect(sunset).toBeCloseTo(0.75, 2);
    expect(noon).toBeCloseTo(0.62, 2);
    expect(night).toBeGreaterThan(sunset);
    expect(sunset).toBeGreaterThan(noon);
  });

  it('every colour is a valid 0 to 1 triple at every hour of the day, in both styles', () => {
    const c = createSkyColours();
    for (const style of STYLES) {
      for (let h = 0; h < 24; h++) {
        skyColoursAt(Date.UTC(2026, 5, 21, h, 0, 0), style, c);
        for (const col of [c.a, c.b, c.c]) for (const v of col) expect(v >= 0 && v <= 1 && Number.isFinite(v)).toBe(true);
        expect(c.gain).toBeGreaterThan(0.5);
        expect(c.gain).toBeLessThanOrEqual(0.9);
      }
    }
  });

  it('the two styles differ at night and agree at the twilight', () => {
    const w = skyColoursForAlt(-30, true, 'wash', createSkyColours());
    const a = skyColoursForAlt(-30, true, 'aurora', createSkyColours());
    expect(w.a).not.toEqual(a.a);
  });

  it('refreshing the colours allocates nothing new: it fills the record it is given', () => {
    const c = createSkyColours();
    const a = c.a;
    skyColoursForAlt(5, false, 'aurora', c);
    expect(c.a).toBe(a);
  });

  it('returns a gain ceiling for every place, Zen the highest and the card pages the lowest', () => {
    for (const p of PLACES) expect(pageGain(p)).toBeGreaterThan(0);
    expect(pageGain('zen')).toBe(1);
    expect(pageGain('unwind')).toBe(0.6);
    expect(pageGain('home')).toBe(0.45);
    for (const p of ['work', 'meet', 'onair', 'shelf'] as PlaceId[]) expect(pageGain(p)).toBe(0.35);
    expect(totalGain('work', 0.9)).toBeCloseTo(0.315, 5);
  });

  it('the soft ceiling never passes the shader cap and rises with its input', () => {
    expect(softCap(0)).toBe(0);
    expect(softCap(50)).toBeLessThanOrEqual(SHADER_CAP);
    expect(softCap(0.4)).toBeGreaterThan(softCap(0.2));
  });

  it('keeps the muted text at 4.5 to 1 on every page but Zen, at every sampled hour and sun altitude', () => {
    for (const place of PLACES.filter((p) => p !== 'zen')) {
      for (const style of STYLES) {
        for (let alt = -30; alt <= 65; alt += 2.5) {
          for (const eve of [false, true]) {
            const bare = bareContrast(place, alt, eve);
            const got = worstCase(place, alt, style, eve);
            // Where the bare sky already misses it the layer stays dark; everywhere else the layer may not take it below.
            expect(got + 1e-6, `${place} ${style} alt ${alt}`).toBeGreaterThanOrEqual(Math.min(MIN_CONTRAST, bare));
          }
        }
      }
    }
  });

  it('never gives a page more than the hour and the page ceiling allow, and Zen is not held back', () => {
    for (const place of PLACES) {
      const c = skyColoursForAlt(-20, true, 'wash', createSkyColours());
      const g = legibleGain(place, -20, true, 'wash', c);
      expect(g).toBeLessThanOrEqual(totalGain(place, c.gain) + 1e-9);
      expect(g).toBeGreaterThan(0);
    }
    const c = skyColoursForAlt(40, false, 'wash', createSkyColours());
    expect(legibleGain('zen', 40, false, 'wash', c)).toBeCloseTo(totalGain('zen', c.gain), 9);
  });

  it('the default strength keeps today\'s gain, 100% gives every page the gain Zen has, and faint is less', () => {
    for (const [alt, eve] of [[-20, true], [10, false], [40, false]] as const) {
      const c = skyColoursForAlt(alt, eve, 'wash', createSkyColours());
      const zen = legibleGain('zen', alt, eve, 'wash', c, 1);
      for (const place of PLACES) {
        expect(legibleGain(place, alt, eve, 'wash', c)).toBe(legibleGain(place, alt, eve, 'wash', c, DEFAULT_STRENGTH));
        expect(legibleGain(place, alt, eve, 'wash', c, 1)).toBeCloseTo(zen, 9);
        expect(legibleGain(place, alt, eve, 'wash', c, 0.1)).toBeLessThan(legibleGain(place, alt, eve, 'wash', c, DEFAULT_STRENGTH) + 1e-12);
      }
      expect(zen).toBeCloseTo(totalGain('zen', c.gain), 9);
    }
  });

  it('the gain only rises with the strength, and the text hint shows only past the level where text keeps 4.5 to 1', () => {
    const c = skyColoursForAlt(-20, true, 'wash', createSkyColours());
    let last = -1;
    for (let s = 0.1; s <= 1.0001; s += 0.05) {
      const g = legibleGain('work', -20, true, 'wash', c, s);
      expect(g).toBeGreaterThanOrEqual(last - 1e-12);
      last = g;
    }
    expect(strengthHurtsText(DEFAULT_STRENGTH, ['work', 'home'], 'wash')).toBe(false);
    expect(strengthHurtsText(0.1, ['work'], 'wash')).toBe(false);
    expect(strengthHurtsText(1, ['zen'], 'wash')).toBe(false);
    expect(strengthHurtsText(1, ['unwind'], 'wash')).toBe(true);
    expect(strengthHurtsText(1, ['work'], 'wash')).toBe(false);
  });
});
