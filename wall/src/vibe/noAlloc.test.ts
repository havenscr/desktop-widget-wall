import { describe, expect, it } from 'vitest';
import auroraSrc from './aurora.ts?raw';
import glowSrc from './glow.ts?raw';
import mixSrc from './mix.ts?raw';
import colourSrc from './colours.ts?raw';
import layerSrc from './VibeLayer.tsx?raw';
import tapeSrc from './tape.ts?raw';
import glitchSrc from './glitch.ts?raw';

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

/** The braces of an arrow function held in a const, or passed on after `marker`, up to its closing brace. */
function arrowBody(src: string, marker: string): string {
  const text = src.replace(/\r\n/g, '\n');
  const at = text.indexOf(marker);
  if (at < 0) throw new Error(`no ${marker}`);
  const open = text.indexOf('{', at + marker.length);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  throw new Error(`unclosed ${marker}`);
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

  const strip = (code: string): string => code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const scan = (code: string): string[] => RULES.filter(([, re]) => re.test(code)).map(([n]) => n);

  it('Tape Grain draw', () => {
    expect(scan(strip(arrowBody(tapeSrc, 'draw(ctx, w, h, nowS, amount, grain, still)')))).toEqual([]);
  });

  it('Drop Glitch draw, slice, set and the random numbers', () => {
    expect(scan(strip(arrowBody(glitchSrc, 'draw(ctx, w, h, nowS, drops, amount, src)')))).toEqual([]);
    for (const fn of ['slice', 'set', 'rnd']) expect(scan(strip(bodyOf(glitchSrc, fn))), fn).toEqual([]);
  });

  it('the layer loop callback (each frame)', () => {
    expect(scan(strip(arrowBody(layerSrc, '(ts, dt) =>')))).toEqual([]);
  });

  it('the layer draw (each frame), apart from the sky feather gradient it makes once per size', () => {
    const code = strip(arrowBody(layerSrc, 'const draw = (ts: number): void =>'));
    // The gradient is created once after a resize and kept (`if (!skyFade)`); every other line must allocate nothing.
    const once = code.indexOf('if (!skyFade) {');
    expect(once).toBeGreaterThan(0);
    const end = code.indexOf('}', code.indexOf('addColorStop', once));
    expect(scan(code.slice(0, once) + code.slice(end + 1))).toEqual([]);
  });

  it('the ribbon colour helper is only used when baking', () => {
    expect(colourSrc).toContain('export function ribbonColour');
    const paint = bodyOf(auroraSrc, 'paint');
    expect(paint.includes('ribbonColour')).toBe(false);
  });
});
