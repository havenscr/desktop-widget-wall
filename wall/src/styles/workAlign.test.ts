// @ts-ignore node's own file call; the stylesheet is read as text.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// The Work left wing and the Due today chips line up by rule: the music row repeats the focus row's
// 60 px ring width and 18 px gap, and every time chip sets its text to the right with tabular numbers.
// This only pins the CSS. The real layout check is the browser fit check (scripts/fit-check.mjs),
// which measures title x, cover centre and size, and chip text edges on the rendered page.
const css = (readFileSync('src/styles/work.css', 'utf8') as string).replace(/\r\n/g, '\n');
const rule = (sel: string): string => {
  const at = css.indexOf(`\n${sel} {`);
  expect(at).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
};

it('the music row starts its text where the focus row does', () => {
  const gap = (sel: string) => /gap: (\d+)px/.exec(rule(sel))![1];
  expect(gap('.music-mini')).toBe(gap('.focus-mini'));
  expect(rule('.music-mini .art')).toContain('width: 60px');
});

it('every time chip ends its text at one x', () => {
  const r = rule(".work[data-place='work'] .chip-col .est");
  expect(r).toContain('text-align: right');
  expect(r).toContain('tabular-nums');
  expect(r).toContain('width: 100%');
});
