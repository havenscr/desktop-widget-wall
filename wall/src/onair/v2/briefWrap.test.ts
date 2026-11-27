import { expect, it } from 'vitest';
import css0 from '../../styles/onair2.css?raw';
import tiles0 from './Tiles.tsx?raw';

const read = (p: string) => (p.endsWith('.css') ? css0 : tiles0).replace(/\r\n/g, '\n');
const rule = (css: string, sel: string) => {
  const i = css.indexOf(`\n${sel} {`);
  expect(i).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf('}', i));
};

it('the result line and the reason wrap in full: no ellipsis class, no nowrap, rows grow with the text', () => {
  const tiles = read('./Tiles.tsx');
  expect(tiles).toMatch(/className="oa2-brief"/);
  const css = read('../../styles/onair2.css');
  const brief = rule(css, '.oa2-brief');
  expect(brief).toContain('white-space: normal');
  expect(brief).not.toMatch(/nowrap|ellipsis|overflow: hidden/);
  expect(brief).toMatch(/font: 500 16px\//);
  expect(rule(css, '.oa2-hd')).toMatch(/min-height: 26px/);
  expect(rule(css, '.oa2-hd')).not.toMatch(/\n  height:/);
  expect(rule(css, '.oa2-modes')).toMatch(/min-height: 40px/);
  expect(rule(css, '.oa2-modes')).not.toMatch(/\n  height:/);
  expect(rule(css, '.oa2-why')).toContain('white-space: normal');
});
