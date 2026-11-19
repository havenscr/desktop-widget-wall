import { expect, it } from 'vitest';
import { clampComments, DEFAULT_COMMENTS, DEFAULT_NOTES, dragTo, parseSplit, serializeSplit, splitOverride, stepBy, widths } from './splitModel';

it('the default is 620 and 436 with a 24 px gap, 1080 in all', () => {
  expect(widths(DEFAULT_COMMENTS)).toEqual({ comments: 620, notes: 436 });
  expect(DEFAULT_NOTES).toBe(436);
  expect(620 + 24 + 436).toBe(1080);
});

it('a drag keeps the total and stops at the minimums (comments 360, notes 300)', () => {
  expect(dragTo(620, -100)).toBe(520);
  expect(widths(520).notes).toBe(536);
  expect(dragTo(620, -900)).toBe(360);
  expect(dragTo(620, 900)).toBe(756);
  expect(widths(756)).toEqual({ comments: 756, notes: 300 });
  expect(clampComments(Number.NaN)).toBe(620);
});

it('arrow keys move 20 px', () => {
  expect(stepBy(620, -1)).toBe(600);
  expect(stepBy(620, 1)).toBe(640);
  expect(stepBy(360, -1)).toBe(360);
  expect(stepBy(756, 1)).toBe(756);
});

it('folded panels are 72 px rails and the other fills the rest', () => {
  expect(widths('full')).toEqual({ comments: 984, notes: 72 });
  expect(widths('rail')).toEqual({ comments: 72, notes: 984 });
});

it('reads what was kept only for the same show, and never throws on rubbish', () => {
  expect(parseSplit(serializeSplit('a', 500), 'a')).toBe(500);
  expect(parseSplit(serializeSplit('a', 'full'), 'a')).toBe('full');
  expect(parseSplit(serializeSplit('a', 'rail'), 'a')).toBe('rail');
  expect(parseSplit(serializeSplit('a', 500), 'b')).toBeNull();
  expect(parseSplit(serializeSplit('a', 500), null)).toBe(500);
  expect(parseSplit(serializeSplit('a', 9999), 'a')).toBe(756);
  for (const bad of ['', '{', 'null', '[]', '{"show":"a"}', '{"show":"a","comments":"x"}', null]) expect(parseSplit(bad, 'a')).toBeNull();
});

it('the development override names the four fit states', () => {
  expect(splitOverride('?split=left')).toBe(400);
  expect(splitOverride('?split=right')).toBe(740);
  expect(splitOverride('?split=comments')).toBe('full');
  expect(splitOverride('?split=notes')).toBe('rail');
  expect(splitOverride('?x=1')).toBeNull();
});
