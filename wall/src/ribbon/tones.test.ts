import { describe, expect, it } from 'vitest';
import { composite, FLOOR, GROUNDS, isToneToken, ratio, readCategory, TONE_NAMES, TONE_TOKENS, toneStyle, type Rgb, type ToneState } from './tones';

/** The numbers inside a `rgba(r, g, b, a)` string, as the browser will read them. */
const parse = (c: string): { rgb: Rgb; a: number } => {
  const m = /^rgba\((\d+), (\d+), (\d+), ([0-9.]+)\)$/.exec(c);
  if (!m) throw new Error(c);
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a: Number(m[4]) };
};

const STATES: ToneState[] = ['next', 'now', 'past'];
const WHERE = ['ribbon', 'drawer'] as const;

describe('tone tokens', () => {
  it('are exactly preset0 to preset24', () => {
    expect(TONE_TOKENS).toHaveLength(25);
    expect(TONE_NAMES).toHaveLength(25);
    for (const t of TONE_TOKENS) expect(isToneToken(t)).toBe(true);
    for (const bad of ['preset25', 'preset-1', 'preset01', 'none', '', 'red', '#ff0000', 'rgb(1,2,3)', 'preset7 ', 7, null, undefined]) expect(isToneToken(bad)).toBe(false);
  });

  it('read a category from the native answer and nothing else', () => {
    expect(readCategory({ name: 'Blue team', tone: 'preset7' })).toEqual({ name: 'Blue team', tone: 'preset7' });
    expect(readCategory({ name: 'x', tone: '#ff0000' })).toBeNull();
    expect(readCategory({ name: 5, tone: 'preset1' })).toBeNull();
    expect(readCategory({ name: '  ', tone: 'preset1' })).toBeNull();
    expect(readCategory(null)).toBeNull();
    expect(readCategory('preset1')).toBeNull();
    expect(readCategory({ name: 'a‮b\u0007c', tone: 'preset2' })?.name).toBe('abc');
    expect(readCategory({ name: 'n'.repeat(200), tone: 'preset2' })?.name).toHaveLength(64);
  });
});

describe('every text on a coloured chip keeps its contrast floor', () => {
  for (const where of WHERE) {
    for (const state of STATES) {
      it(`${where}, ${state}: all 25 presets clear ${FLOOR} to 1 on every ground`, () => {
        for (const token of TONE_TOKENS) {
          const s = toneStyle(token, state, where);
          const fill = parse(s.fill);
          const text = parse(s.text).rgb;
          for (const ground of GROUNDS[where]) {
            const under = composite(fill.rgb, fill.a, ground);
            expect(ratio(text, under), `${token} ${state} ${where} on ${ground.join(',')}`).toBeGreaterThanOrEqual(FLOOR);
          }
        }
      });
    }
  }

  it('the Join button on a tile (cyan on a dark wash over the tile, as ribbon.css sets) keeps it too', () => {
    const cyan: Rgb = [53, 230, 234];
    for (const state of STATES) {
      for (const token of TONE_TOKENS) {
        const fill = parse(toneStyle(token, state, 'drawer').fill);
        const under = composite(fill.rgb, fill.a, GROUNDS.drawer[0]);
        const button = composite([8, 6, 24], 0.7, under);
        expect(ratio(cyan, button), `${token} ${state}`).toBeGreaterThanOrEqual(FLOOR);
      }
    }
  });

  it('past reads quieter than next, and the 25 tones give 25 different fills', () => {
    const fills = new Set<string>();
    for (const token of TONE_TOKENS) {
      fills.add(toneStyle(token, 'next', 'ribbon').fill);
      const next = toneStyle(token, 'next', 'ribbon').rgb;
      const past = toneStyle(token, 'past', 'ribbon').rgb;
      expect(past.fillAlpha).toBeLessThan(next.fillAlpha);
      const l = (c: Rgb) => c[0] + c[1] + c[2];
      expect(l(past.text)).toBeLessThan(l(next.text));
    }
    expect(fills.size).toBe(25);
  });
});
