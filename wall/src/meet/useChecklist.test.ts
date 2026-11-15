import { expect, it } from 'vitest';
import { asChecklist } from './useChecklist';

it('accepts only the shape the native side sends', () => {
  expect(asChecklist({ state: 'ok', items: ['One', 'Two'], reason: null })).toEqual({ state: 'ok', items: ['One', 'Two'], reason: null });
  expect(asChecklist({ state: 'missing', items: [], reason: null })?.state).toBe('missing');
  expect(asChecklist({ state: 'refused', items: [], reason: 'meet-checklist.txt is over 4 KB' })?.reason).toBe('meet-checklist.txt is over 4 KB');
  expect(asChecklist(null)).toBeNull();
  expect(asChecklist('ok')).toBeNull();
  expect(asChecklist({ state: 'weird', items: [] })).toBeNull();
  // Odd items are dropped and the list is held to eight.
  expect(asChecklist({ state: 'ok', items: ['a', 3, null, 'b'], reason: 5 })).toEqual({ state: 'ok', items: ['a', 'b'], reason: null });
  expect(asChecklist({ state: 'ok', items: Array.from({ length: 12 }, (_, i) => `i${i}`) })?.items).toHaveLength(8);
});
