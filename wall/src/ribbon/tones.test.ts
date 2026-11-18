import { describe, expect, it } from 'vitest';
import ribbonCss from '../styles/ribbon.css?raw';
import { composite, FLOOR, PAST, toneVars, HOVER_BRIGHTNESS, GROUNDS, isToneToken, ratio, readCategory, TONE_NAMES, TONE_TOKENS, toneStyle, type Rgb, type ToneState } from './tones';

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

/** What `filter: brightness(k)` does to a colour: each channel scaled, clamped at white. */
const lift = (c: Rgb, k: number): Rgb => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];

describe('hover keeps the contrast floor', () => {
  it('ribbon.css lifts a hovered event by the same factor the test uses', () => {
    const lifts = ribbonCss.match(/\.(?:rib \.ev|dd-ev)\.open:hover \{[^}]*\}/g) ?? [];
    expect(lifts).toHaveLength(2);
    for (const rule of lifts) expect(rule).toContain(`brightness(${HOVER_BRIGHTNESS})`);
  });

  for (const where of WHERE) {
    for (const state of STATES) {
      it(`${where}, ${state}: all 25 presets clear ${FLOOR} to 1 on every ground while hovered`, () => {
        for (const token of TONE_TOKENS) {
          const s = toneStyle(token, state, where);
          const fill = parse(s.fill);
          // The filter scales the element's own colours (fill and text) before they meet the ground.
          const hoverFill = lift(fill.rgb, HOVER_BRIGHTNESS);
          const hoverText = lift(parse(s.text).rgb, HOVER_BRIGHTNESS);
          for (const ground of GROUNDS[where]) {
            const under = composite(hoverFill, fill.a, ground);
            expect(ratio(hoverText, under), `${token} ${state} ${where} hover on ${ground.join(',')}`).toBeGreaterThanOrEqual(FLOOR);
          }
        }
      });
    }
  }
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

/** The declarations of the first rule in `css` whose selector is exactly `selector`. */
const rule = (selector: string): string => {
  const at = ribbonCss.indexOf(`\n${selector} {`);
  if (at < 0) throw new Error(`no rule ${selector}`);
  return ribbonCss.slice(at, ribbonCss.indexOf('}', at));
};

describe('the 6 px bar, the grey past wash and plain chips', () => {
  it('each tone draws its bar at full strength, a little less once past', () => {
    for (const token of TONE_TOKENS) {
      expect(parse(toneVars(token, 'next', 'ribbon')['--tone-bar']).a).toBe(1);
      expect(parse(toneVars(token, 'now', 'drawer')['--tone-bar']).a).toBe(1);
      expect(parse(toneVars(token, 'past', 'ribbon')['--tone-bar']).a).toBe(0.8);
      expect(parse(toneVars(token, 'next', 'ribbon')['--tone-bar']).rgb).toEqual(toneStyle(token, 'next', 'ribbon').rgb.base);
    }
    expect(rule('.rib .ev[data-tone]')).toContain('inset 6px 0 0 var(--tone-bar)');
    expect(rule('.dd-ev[data-tone]')).toContain('inset 6px 0 0 var(--tone-bar)');
  });

  it('a past tile is the same grey wash whatever the tone, with only the bar in colour', () => {
    for (const token of TONE_TOKENS) {
      for (const where of WHERE) {
        const s = toneStyle(token, 'past', where);
        expect([s.fill, s.edge, s.text]).toEqual([PAST.fill, PAST.edge, PAST.text]);
      }
    }
  });

  it('the grey wash clears the floor on every ground, hovered too', () => {
    const fill = parse(PAST.fill);
    for (const ground of [...GROUNDS.ribbon, ...GROUNDS.drawer]) {
      expect(ratio(parse(PAST.text).rgb, composite(fill.rgb, fill.a, ground))).toBeGreaterThanOrEqual(FLOOR);
      const under = composite(lift(fill.rgb, HOVER_BRIGHTNESS), fill.a, ground);
      expect(ratio(lift(parse(PAST.text).rgb, HOVER_BRIGHTNESS), under)).toBeGreaterThanOrEqual(FLOOR);
    }
  });

  it('a plain past chip and tile in ribbon.css use that wash, and nothing fades them', () => {
    for (const sel of ['.rib .ev.past', '.dd-ev.past', '.rib .ev.fold.past']) {
      const r = rule(sel);
      expect(r, sel).toContain(`background: ${PAST.fill}`);
      expect(r, sel).toContain(`border-color: ${PAST.edge}`);
      expect(r, sel).toContain(`color: ${PAST.text}`);
      expect(r, sel).not.toContain('opacity');
    }
    expect(rule('.rib .ev-side.past')).toContain(`color: ${PAST.text}`);
    expect(rule('.rib .ev-side.past')).not.toContain('opacity');
    expect(rule('.dd-ev.past .dd-t')).toContain('opacity: 1');
  });

  it('a livestream with a category keeps its pink and takes a dot in the category colour', () => {
    expect(rule('.rib .ev.live[data-dot]::before')).toContain('var(--tone-dot)');
    expect(rule('.dd-ev.live[data-dot] b::before')).toContain('var(--tone-dot)');
    expect(rule('.rib .ev.live')).toContain('rgba(255, 61, 154');
  });

  it('Day drawer tile text is 16 px or more', () => {
    expect(rule('.dd-ev')).toContain('font: 600 16px');
    expect(rule('.dd-ev .dd-t')).toContain('font: 400 16px');
    expect(rule('.dd-join')).toContain('font: 600 16px');
  });
});
