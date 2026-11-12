import { expect, it } from 'vitest';
import { dueLine, updatedText } from './model';

// Wed 11 Nov 2026, 10:00 local.
const NOW = new Date(2026, 10, 11, 10, 0, 0);
const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString();

it('says nothing for no due date or an unreadable one', () => {
  expect(dueLine({ due_at: null, due_is_all_day: false }, NOW)).toBeNull();
  expect(dueLine({ due_at: 'soon', due_is_all_day: false }, NOW)).toBeNull();
  expect(dueLine({ due_at: 'soon', due_is_all_day: true }, NOW)).toBeNull();
});

it('today with a time, tomorrow, and a weekday this week', () => {
  expect(dueLine({ due_at: local(2026, 11, 11, 15), due_is_all_day: false }, NOW)).toBe('today 3 PM');
  expect(dueLine({ due_at: local(2026, 11, 11, 9, 30), due_is_all_day: false }, NOW)).toBe('today 9:30 AM');
  expect(dueLine({ due_at: local(2026, 11, 11, 0, 0), due_is_all_day: false }, NOW)).toBe('today 12 AM');
  expect(dueLine({ due_at: local(2026, 11, 12, 15), due_is_all_day: false }, NOW)).toBe('tomorrow');
  expect(dueLine({ due_at: local(2026, 11, 13, 8), due_is_all_day: false }, NOW)).toBe('Fri');
  expect(dueLine({ due_at: local(2026, 11, 17, 8), due_is_all_day: false }, NOW)).toBe('Tue');
});

it('a date further out shows month and day', () => {
  expect(dueLine({ due_at: local(2026, 11, 18, 8), due_is_all_day: false }, NOW)).toBe('Nov 18');
  expect(dueLine({ due_at: local(2027, 1, 5, 8), due_is_all_day: false }, NOW)).toBe('Jan 5');
});

it('all day tasks read the calendar date and never show a time', () => {
  expect(dueLine({ due_at: '2026-11-11', due_is_all_day: true }, NOW)).toBe('today');
  expect(dueLine({ due_at: '2026-11-11T00:00:00Z', due_is_all_day: true }, NOW)).toBe('today');
  expect(dueLine({ due_at: '2026-11-12', due_is_all_day: true }, NOW)).toBe('tomorrow');
  expect(dueLine({ due_at: '2026-11-14', due_is_all_day: true }, NOW)).toBe('Sat');
  expect(dueLine({ due_at: '2026-12-01', due_is_all_day: true }, NOW)).toBe('Dec 1');
});

it('a bare date on a timed task is a local calendar date', () => {
  // West of UTC a UTC reading would give the previous day.
  expect(dueLine({ due_at: '2026-11-11', due_is_all_day: false }, NOW)).toBe('today');
  expect(dueLine({ due_at: '2026-11-12', due_is_all_day: false }, NOW)).toBe('tomorrow');
  expect(dueLine({ due_at: '2026-11-10', due_is_all_day: false }, NOW)).toBe('overdue');
});

it('a past date is overdue', () => {
  expect(dueLine({ due_at: local(2026, 11, 9, 8), due_is_all_day: false }, NOW)).toBe('overdue');
  expect(dueLine({ due_at: '2026-11-10', due_is_all_day: true }, NOW)).toBe('overdue');
});

it('updated text counts minutes then hours', () => {
  expect(updatedText(null, 1)).toBeNull();
  expect(updatedText(0, 5 * 60_000)).toBe('updated 5 min ago');
  expect(updatedText(0, 60 * 60_000)).toBe('updated 1 hour ago');
  expect(updatedText(0, 3 * 3_600_000)).toBe('updated 3 hours ago');
});
