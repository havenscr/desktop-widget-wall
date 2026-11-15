import { expect, it } from 'vitest';
import { pickCallMeeting, refreshCallMeeting } from './callMeeting';
import type { Meeting } from './model';

const SINCE = Date.parse('2026-11-12T17:00:00Z');
const at = (mins: number) => new Date(SINCE + mins * 60_000).toISOString().replace('.000Z', 'Z');
const m = (key: string, from: number, to: number, title = key): Meeting => ({ key, accountId: 'work', title, start: at(from), end: at(to), canJoin: true });

it('picks the meeting that was current when the call started, over an earlier or later one', () => {
  expect(pickCallMeeting([m('a', -30, 30)], SINCE)?.key).toBe('a');
  // Two running: the one that began last.
  expect(pickCallMeeting([m('a', -60, 30), m('b', -10, 40)], SINCE)?.key).toBe('b');
  // A meeting that already ended is not the call's.
  expect(pickCallMeeting([m('a', -60, -1)], SINCE)).toBeUndefined();
});

it('a meeting that starts within 10 minutes after the call is the call\'s; one later than that never is', () => {
  expect(pickCallMeeting([m('a', 5, 35)], SINCE)?.key).toBe('a');
  expect(pickCallMeeting([m('a', 10, 35)], SINCE)?.key).toBe('a');
  expect(pickCallMeeting([m('a', 11, 35)], SINCE)).toBeUndefined();
  // Current wins over one about to start.
  expect(pickCallMeeting([m('soon', 5, 35), m('now', -20, 20)], SINCE)?.key).toBe('now');
  // Of two about to start, the earlier.
  expect(pickCallMeeting([m('late', 8, 35), m('soon', 3, 35)], SINCE)?.key).toBe('soon');
  expect(pickCallMeeting([], SINCE)).toBeUndefined();
});

it('the kept meeting is found again by occurrence in a newer list (a new action key), or the kept copy stays when the list lost it', () => {
  const kept = m('1-0', -30, 30, 'Review');
  const next = [{ ...kept, key: '2-0', details: { calledBy: 'X', people: [], peopleMore: 0, invite: 'Words.' } }, m('2-1', 60, 90)];
  expect(refreshCallMeeting(kept, next).key).toBe('2-0');
  expect(refreshCallMeeting(kept, next).details?.invite).toBe('Words.');
  expect(refreshCallMeeting(kept, [m('2-1', 60, 90)])).toBe(kept);
  // A different title at the same time is a different meeting.
  expect(refreshCallMeeting(kept, [{ ...kept, key: '3-0', title: 'Other' }])).toBe(kept);
});
