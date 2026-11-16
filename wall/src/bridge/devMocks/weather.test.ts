import { describe, expect, it } from 'vitest';
import { isWindy, parseNws, parseWeather, rainLevel } from '../../weather/model';
import { WX_KINDS, nwsBody, openMeteoBody } from './weather';

describe('the weather review knobs', () => {
  it('give the weather code and the wind in both sources', () => {
    const rows: [string, number, number | null, number | null, number][] = [
      ['rain', 61, null, null, 0],
      ['heavy', 65, null, null, 1],
      ['rainwind', 63, 22, 34, 0.5],
      ['wind', 2, 24, 35, -1],
      ['heavywind', 65, 24, 38, 1],
    ];
    for (const [name, code, speed, gust, level] of rows) {
      const wx = WX_KINDS[name];
      const a = parseWeather(JSON.parse(openMeteoBody(false, wx)), 0);
      const b = parseNws(JSON.parse(nwsBody(wx)), 0);
      for (const r of [a, b]) {
        expect(r.code, `${name} ${r.source}`).toBe(code);
        expect(rainLevel(r.code), name).toBe(level);
        if (speed === null) expect(r.wind).toBeUndefined();
        else {
          expect(r.wind?.speed).toBe(speed);
          expect(isWindy(false, r.wind)).toBe(true);
        }
      }
      expect(a.wind?.gust).toBe(gust ?? undefined);
      expect(b.wind?.gust).toBe(gust ?? undefined);
    }
  });

  it('without a knob the reply is the usual dry one with no wind', () => {
    const a = parseWeather(JSON.parse(openMeteoBody()), 0);
    expect(a.code).toBe(2);
    expect(a.wind).toBeUndefined();
    expect(parseNws(JSON.parse(nwsBody()), 0).wind).toBeUndefined();
  });
});
