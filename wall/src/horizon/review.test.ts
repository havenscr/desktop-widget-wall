import { expect, it } from 'vitest';
import { parseReview } from './review';

it('reads a place and a time', () => {
  expect(parseReview('?hz=home&at=2026-11-11T16:00:00-08:00')).toEqual({
    place: 'home',
    ms: Date.UTC(2026, 10, 12, 0, 0, 0),
  });
});

it('returns null when either part is missing or invalid', () => {
  expect(parseReview('')).toBeNull();
  expect(parseReview('?hz=home')).toBeNull();
  expect(parseReview('?at=2026-11-11T16:00:00Z')).toBeNull();
  expect(parseReview('?hz=attic&at=2026-11-11T16:00:00Z')).toBeNull();
  expect(parseReview('?hz=work&at=not-a-time')).toBeNull();
});
