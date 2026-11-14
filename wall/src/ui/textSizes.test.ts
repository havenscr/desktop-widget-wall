// @ts-ignore node's own file calls; this test reads the stylesheets as text.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Every font size (shorthand or `font-size`) in the rules whose selector matches `sel`, px. */
function sizes(css: string, sel: RegExp): { rule: string; px: number }[] {
  const out: { rule: string; px: number }[] = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selector = m[1].trim();
    if (!sel.test(selector)) continue;
    for (const d of m[2].matchAll(/font(?:-size)?\s*:\s*([^;]+);/g)) {
      const px = /(\d+(?:\.\d+)?)px/.exec(d[1]);
      if (px) out.push({ rule: selector, px: Number(px[1]) });
    }
  }
  return out;
}

describe('text on the strip is large enough to read at 100 percent', () => {
  it('nothing in his menu or in a tooltip is smaller than 16 px', () => {
    const menu = sizes(readFileSync('src/buddy/watt.css', 'utf8'), /\.watt-menu|\.wm-/);
    const tips = sizes(readFileSync('src/styles/app.css', 'utf8'), /\.hover-tip/);
    expect(menu.length).toBeGreaterThan(5);
    expect(tips.length).toBeGreaterThan(3);
    for (const s of [...menu, ...tips]) expect(s.px, s.rule).toBeGreaterThanOrEqual(16);
  });
});
