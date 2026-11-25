import { describe, expect, it } from 'vitest';
import auroraSrc from './aurora.ts?raw';
import glowSrc from './glow.ts?raw';
import mixSrc from './mix.ts?raw';
import colourSrc from './colours.ts?raw';

function bodyOf(src: string, name: string): string {
  const text = src.replace(/\r\n/g, '\n');
  const at = text.search(new RegExp(`function ${name}\\(`));
  if (at < 0) throw new Error(`no function ${name}`);
  const open = text.indexOf('{', text.indexOf('): ', at));
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  throw new Error(`unclosed ${name}`);
}

const RULES: [string, RegExp][] = [
  ['new', /\bnew\s+\w/],
  ['arrow function', /=>/],
  ['function expression', /\bfunction\b/],
  ['array literal', /(^|[=(,:?&|]|return|\bof|\bin)\s*\[/m],
  ['object literal', /(^|[=(,:?&|]|return)\s*\{/m],
  ['spread', /\.\.\./],
  ['array method', /\.(map|filter|slice|concat|from|subarray)\(/],
  ['string template', /`/],
  ['gradient', /create(Linear|Radial)Gradient/],
  ['filter', /\.filter\s*=/],
];

describe('the vibe frame path allocates nothing and uses no filter', () => {
  const paths: [string, string, string][] = [
    ['paint (the aurora frame)', auroraSrc, 'paint'],
    ['drawGlow', glowSrc, 'drawGlow'],
    ['put', glowSrc, 'put'],
    ['stepVibe', mixSrc, 'stepVibe'],
    ['targets', mixSrc, 'targets'],
    ['ease2', mixSrc, 'ease2'],
  ];
  for (const [label, src, fn] of paths) {
    it(label, () => {
      const code = bodyOf(src, fn).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const bad = RULES.filter(([, re]) => re.test(code)).map(([n]) => n);
      expect(bad, `${fn} has: ${bad.join(', ')}`).toEqual([]);
    });
  }

  it('the ribbon colour helper is only used when baking', () => {
    expect(colourSrc).toContain('export function ribbonColour');
    const paint = bodyOf(auroraSrc, 'paint');
    expect(paint.includes('ribbonColour')).toBe(false);
  });
});
