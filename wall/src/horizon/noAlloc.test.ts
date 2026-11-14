import { describe, expect, it } from 'vitest';
import danceSrc from '../audio/dance.ts?raw';
import spectrumSrc from '../audio/spectrum.ts?raw';
import rendererSrc from './renderer.ts?raw';
import reflectionSrc from './reflection.ts?raw';
import lineTypesSrc from './lineTypes.ts?raw';

/**
 * A source guard for the per-frame paths this branch added: their bodies may not create arrays,
 * objects, closures or typed arrays (a gradient only inside the cache branch that remakes it).
 * It reads the source text, so an allocation put back in one of these functions fails here.
 */
function bodyOf(src: string, name: string): string {
  const at = src.search(new RegExp(`function ${name}\\(`));
  if (at < 0) throw new Error(`no function ${name}`);
  const open = src.indexOf('{', src.indexOf(')', src.indexOf('): ', at)));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error(`unclosed ${name}`);
}

/** What a body may not contain; `allowGradient` lets `createLinearGradient` stand when the line above is the cache test. */
export function allocations(body: string, allowGradient = false): string[] {
  const code = body.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const bad: string[] = [];
  const rules: [string, RegExp][] = [
    ['new', /\bnew\s+\w/],
    ['arrow function', /=>/],
    ['function expression', /\bfunction\b/],
    ['array literal', /(^|[=(,:?&|]|return)\s*\[/m],
    ['object literal', /(^|[=(,:?&|]|return)\s*\{/m],
    ['spread', /\.\.\./],
    // `ctx.fill()` paints a path and makes nothing.
    ['array method', /(?<!\bctx)\.(map|filter|slice|concat|from|fill|subarray)\(/],
    ['string template', /`/],
  ];
  for (const [label, re] of rules) if (re.test(code)) bad.push(label);
  const grads = (code.match(/create(Linear|Radial)Gradient/g) ?? []).length;
  if (grads > 0 && !(allowGradient && grads === 1 && /if \(!r\.fade \|\| r\.fadeH !== h\) \{\s*const g = x\.createLinearGradient/.test(code))) bad.push('gradient');
  return bad;
}

describe('the frame path allocates nothing', () => {
  const paths: [string, string, string, boolean][] = [
    ['stepDance', danceSrc, 'stepDance', false],
    ['sampleDance', spectrumSrc, 'sampleDance', false],
    ['echoEdge', rendererSrc, 'echoEdge', false],
    ['echoMask', rendererSrc, 'echoMask', false],
    ['drawReflection', reflectionSrc, 'drawReflection', true],
    ['typePx', lineTypesSrc, 'typePx', false],
    ['stepLineTypes', lineTypesSrc, 'stepLineTypes', false],
    ['drawLineType', lineTypesSrc, 'drawLineType', false],
    ['drawBars', lineTypesSrc, 'drawBars', false],
    ['drawRibbon', lineTypesSrc, 'drawRibbon', false],
    ['drawSparks', lineTypesSrc, 'drawSparks', false],
    ['drawSkyline', lineTypesSrc, 'drawSkyline', false],
    ['drawRestLine', lineTypesSrc, 'drawRestLine', false],
  ];
  for (const [label, src, name, grad] of paths) {
    it(`${label} has no array, object, closure or typed array in its body`, () => {
      expect(allocations(bodyOf(src, name), grad)).toEqual([]);
    });
  }

  it('the guard bites: an allocation put into a copy of each body is found', () => {
    for (const [, src, name, grad] of paths) {
      const body = bodyOf(src, name);
      for (const bad of ['const t = new Float32Array(4);', 'const t = [0, 1];', 'const t = { a: 1 };', 'const t = (x) => x;', 'const t = Array.from(a);']) {
        expect(allocations(`${bad}\n${body}`, grad), `${name} + ${bad}`).not.toEqual([]);
      }
    }
    const body = bodyOf(reflectionSrc, 'drawReflection');
    expect(allocations(`const g = x.createLinearGradient(0, 0, 0, h);\n${body}`, true)).toContain('gradient');
  });
});

describe('the sky part makes nothing the ground uses', () => {
  it('the rim gradient and the sun\'s glitter on the lake are made only when the ground is drawn', () => {
    const code = rendererSrc.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).toMatch(/let rim:Any=null;if\(GD\)\{rim=ctx\.createLinearGradient\(0,0,W,0\)/);
    expect(code.match(/\brim=ctx\.create/g)).toHaveLength(1);
    expect(code).toMatch(/if\(GD&&sp\.alt<8\)glit=/);
    expect(code.match(/glit=\{/g)).toHaveLength(1);
  });
});
