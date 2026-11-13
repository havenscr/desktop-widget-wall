import { describe, expect, it } from 'vitest';
import { parseRealStart } from './leave';

const zone = 'America/Los_Angeles';
const block = (title: string, start = '2026-11-12T18:00:00Z', end = '2026-11-12T19:45:00Z', allDay = false) =>
  parseRealStart(title, start, end, zone, allDay);

describe('parseRealStart', () => {
  it.each([
    ["Doctor (10:45 start)", '2026-11-12T18:45:00Z'],
    ['Doctor (1045 start)', '2026-11-12T18:45:00Z'],
    ['Doctor (10:45am start)', '2026-11-12T18:45:00Z'],
    ['Doctor (starts 10:45)', '2026-11-12T18:45:00Z'],
    ['Doctor (start 10:45 AM)', '2026-11-12T18:45:00Z'],
  ])('reads %s', (title, expected) => expect(block(title)).toBe(Date.parse(expected)));

  it.each(['Doctor (2 pm start)', 'Doctor (14:00 start)'])('reads %s', (title) => {
    expect(block(title, '2026-11-12T21:00:00Z', '2026-11-12T23:00:00Z')).toBe(Date.parse('2026-11-12T22:00:00Z'));
  });

  it('chooses the no-meridiem reading inside the block', () => {
    expect(block('Dinner (6:30 start)', '2026-11-13T01:00:00Z', '2026-11-13T03:00:00Z')).toBe(Date.parse('2026-11-13T02:30:00Z'));
  });
  it('rejects outside, all-day and unlabelled times', () => {
    expect(block('Doctor (9:30 start)')).toBeNull();
    expect(block('Doctor (10:45)')).toBeNull();
    expect(block('Doctor (10:45 start)', undefined, undefined, true)).toBeNull();
  });
  it('finds the labelled time among two parenthetical groups', () => {
    expect(block('Doctor (office) (10:45 start)')).toBe(Date.parse('2026-11-12T18:45:00Z'));
  });
  it('uses the block local day across daylight saving change', () => {
    expect(parseRealStart('Flight (1:30 am start)', '2026-11-01T07:00:00Z', '2026-11-01T10:00:00Z', zone)).toBe(Date.parse('2026-11-01T08:30:00Z'));
  });
  it('reads a labelled clock in a non-Pacific zone', () => {
    expect(parseRealStart('Train (15:30 start)', '2026-11-12T14:00:00Z', '2026-11-12T16:00:00Z', 'Europe/London')).toBe(Date.parse('2026-11-12T15:30:00Z'));
  });
  it('refuses a far-future attacker-controlled block without scanning it', () => {
    expect(parseRealStart('Invitation (09:59 start)', '2026-11-12T18:00:00Z', '2036-11-12T18:00:00Z', zone)).toBeNull();
  });
  it('does no free-text guessing', () => expect(block('Doctor starts at 10:45')).toBeNull());
  it('rejects extra text inside the parentheses', () => expect(block('Doctor (room 2, 10:45 start)')).toBeNull());
});
