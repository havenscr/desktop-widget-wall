import { expect, it } from 'vitest';
import { shortLabel, shortLabels } from './shortLabel';

it('uses a known short form, else the first word', () => {
  expect(shortLabel('Record 16:9')).toBe('Record');
  expect(shortLabel('Hide screen')).toBe('Hide');
  expect(shortLabel('Thirds')).toBe('Thirds');
  expect(shortLabel('Copy path')).toBe('Copy');
});
it('keeps the full label where two keys would read the same', () => {
  expect(shortLabels(['Copy path', 'Copy link', 'Snip'])).toEqual(['Copy path', 'Copy link', 'Snip']);
  expect(shortLabels(['Record 16:9', 'Snip'])).toEqual(['Record', 'Snip']);
});
