import { expect, it } from 'vitest';
import {
  BACK_TO_BACK_MS,
  BROWSER_KEYS,
  MAX_CIRCLES,
  MUTE_TIP,
  calledByLine,
  callKeys,
  drawnPeople,
  initials,
  invitedCount,
  leaveIsFor,
  matchDayEvent,
  nextHeading,
  peopleBlock,
  ringOf,
  statusLine,
} from './heroModel';
import type { MeetingDetails, Person, Reply } from './model';

const NOW = Date.parse('2026-11-12T17:00:00Z');
const at = (mins: number) => new Date(NOW + mins * 60_000).toISOString().replace('.000Z', 'Z');
const meeting = (from: number, to: number) => ({ start: at(from), end: at(to) });
const call = { kind: 'teams' as const, since: NOW, camera: false };

it('status words: in a call, now, next in minutes, in hours, and at a clock time', () => {
  expect(statusLine(meeting(-10, 20), NOW, call)).toEqual({ text: 'In call, Teams', tone: 'call' });
  expect(statusLine(meeting(-10, 20), NOW, { ...call, kind: 'zoom' }).text).toBe('In call, Zoom');
  expect(statusLine(meeting(-10, 20), NOW, { ...call, kind: 'browser' }).text).toBe('In call, browser');
  expect(statusLine(meeting(-10, 20), NOW, null)).toEqual({ text: 'Now', tone: 'now' });
  expect(statusLine(meeting(0, 30), NOW, null).text).toBe('Now');
  expect(statusLine(meeting(20, 50), NOW, null)).toEqual({ text: 'Next, in 20 min', tone: 'next' });
  expect(statusLine(meeting(1, 50), NOW, null).text).toBe('Next, in 1 min');
  expect(statusLine(meeting(60, 90), NOW, null).text).toBe('Next, in 1 h 00 min');
  expect(statusLine(meeting(65, 90), NOW, null).text).toBe('Next, in 1 h 05 min');
  expect(statusLine(meeting(181, 220), NOW, null).text).toMatch(/^Next, at \d+(:\d\d)? [AP]M$/);
  // A call wins over everything: the words are about what he is doing.
  expect(statusLine(meeting(60, 90), NOW, call).tone).toBe('call');
});

it('the ring: fraction and colour for a table of times', () => {
  // Before the start: minutes to go, filling for the last 30 minutes, always cyan.
  expect(ringOf(meeting(20, 80), NOW, false)).toMatchObject({ value: 20, unit: 'min to go', tone: 'cyan' });
  expect(ringOf(meeting(20, 80), NOW, false).frac).toBeCloseTo(20 / 30, 5);
  expect(ringOf(meeting(30, 80), NOW, false).frac).toBe(1);
  expect(ringOf(meeting(90, 120), NOW, false).frac).toBe(1);
  expect(ringOf(meeting(3, 80), NOW, false).frac).toBeCloseTo(0.1, 5);
  expect(ringOf(meeting(20, 80), NOW, true).tone).toBe('cyan');
  expect(ringOf(meeting(20, 80), NOW, false).under).toMatch(/^starts /);
  // Hours when a meeting is more than 99 minutes away.
  expect(ringOf(meeting(100, 160), NOW, false)).toMatchObject({ value: 1, unit: 'h to go' });
  expect(ringOf(meeting(200, 260), NOW, false)).toMatchObject({ value: 3, unit: 'h to go' });
  // After the start: minutes left; the fraction is the time left of the meeting's length.
  const live = ringOf(meeting(-20, 40), NOW, true);
  expect(live).toMatchObject({ value: 40, unit: 'min left', tone: 'violet' });
  expect(live.frac).toBeCloseTo(40 / 60, 5);
  expect(live.under).toMatch(/^ends /);
  expect(ringOf(meeting(-20, 40), NOW, false).tone).toBe('cyan');
  // Amber with 10 minutes or less left, in a call or not.
  expect(ringOf(meeting(-50, 11), NOW, true).tone).toBe('violet');
  expect(ringOf(meeting(-50, 10), NOW, true).tone).toBe('amber');
  expect(ringOf(meeting(-50, 10), NOW, false).tone).toBe('amber');
  expect(ringOf(meeting(-50, 0.4), NOW, true)).toMatchObject({ value: 1, tone: 'amber' });
  expect(ringOf(meeting(-50, 0.4), NOW, true).frac).toBeGreaterThan(0);
  // A long meeting counts in hours past 99 minutes.
  expect(ringOf(meeting(-10, 190), NOW, true)).toMatchObject({ value: 3, unit: 'h left' });
});

const d = (people: [string, Reply][], more = 0): MeetingDetails => ({ calledBy: null, people: people.map(([name, reply]): Person => ({ name, reply })), peopleMore: more, invite: null });

it('initials are the first letters of the first and last word', () => {
  expect(initials('Casey Rowe')).toBe('CR');
  expect(initials('casey')).toBe('C');
  expect(initials('Mira de la Cruz')).toBe('MC');
  expect(initials('  ')).toBe('');
  expect(initials('Zoë Ångström')).toBe('ZÅ');
});

it('the people block: up to five circles, then +N, the head and the replies; nobody who declined is drawn', () => {
  expect(peopleBlock(null)).toBeNull();
  expect(peopleBlock(d([]))).toBeNull();
  const six = peopleBlock(d([['A One', 'organizer'], ['B Two', 'yes'], ['C Three', 'yes'], ['D Four', 'yes'], ['E Five', 'maybe'], ['F Six', 'none']]))!;
  expect(six.head).toBe('6 invited');
  expect(six.replies).toBe('4 said yes, 1 maybe');
  // Six people do not fit five circles: four circles and "+2".
  expect(six.circles).toHaveLength(MAX_CIRCLES - 1);
  expect(six.more).toBe(2);
  const five = peopleBlock(d([['A One', 'yes'], ['B Two', 'yes'], ['C Three', 'yes'], ['D Four', 'yes'], ['E Five', 'yes']]))!;
  expect(five.circles).toHaveLength(5);
  expect(five.more).toBe(0);
  const declined = peopleBlock(d([['A One', 'yes'], ['B Two', 'no'], ['C Three', 'no']]))!;
  expect(declined.circles.map((p) => p.name)).toEqual(['A One']);
  expect(declined.head).toBe('3 invited');
  expect(declined.replies).toBe('1 said yes');
  // People with no name still count in the head and the "+N".
  const more = peopleBlock(d([['A One', 'yes'], ['B Two', 'none']], 9))!;
  expect(more.head).toBe('11 invited');
  expect(more.circles).toHaveLength(2);
  expect(more.more).toBe(9);
  expect(peopleBlock(d([['A One', 'none']]))!.replies).toBe('No replies yet');
  // Five named and one more: four circles and a "+2" (the fifth name and the one more).
  const edge = peopleBlock(d([['A One', 'yes'], ['B Two', 'yes'], ['C Three', 'yes'], ['D Four', 'yes'], ['E Five', 'yes']], 1))!;
  expect(edge.circles).toHaveLength(4);
  expect(edge.more).toBe(2);
  expect(invitedCount(d([['A One', 'yes']], 3))).toBe(4);
  expect(drawnPeople(d([['A One', 'no']]))).toEqual([]);
});

it('Called by: the person and the account label, never a company', () => {
  expect(calledByLine({ ...d([]), calledBy: 'Casey Rowe' }, 'Work')).toBe('Called by Casey Rowe · Work');
  expect(calledByLine(null, 'Work')).toBe('Work');
  expect(calledByLine({ ...d([]), calledBy: 'Casey Rowe' }, '')).toBe('Called by Casey Rowe');
  expect(calledByLine(null, '')).toBeNull();
});

it('the call keys by kind: Teams and Zoom from the library, none for the browser, Camera follows the signal', () => {
  const teams = callKeys('teams', true)!;
  expect(teams.map((k) => [k.id, k.label])).toEqual([['teams-mute', 'Mute'], ['teams-camera', 'Camera on'], ['teams-share', 'Share'], ['teams-leave', 'Leave']]);
  expect(callKeys('teams', false)![1].label).toBe('Camera off');
  expect(callKeys('zoom', false)!.map((k) => k.id)).toEqual(['zoom-mute', 'zoom-camera', 'zoom-share', 'zoom-leave']);
  // The Mute key never claims a state.
  for (const k of [...teams, ...callKeys('zoom', true)!]) expect(k.role === 'mute' ? k.label : 'Mute').toBe('Mute');
  expect(callKeys('browser', true)).toBeNull();
  expect(BROWSER_KEYS.map((k) => k.label)).toEqual(['Mute', 'Camera', 'Share', 'Leave']);
  expect(MUTE_TIP('teams')).toBe('Sends Ctrl+Shift+M to Teams. The wall cannot see whether you are muted.');
  expect(MUTE_TIP('zoom')).toContain('Alt+A');
});

it('Open invite matches a day event by start and title, and only one Outlook can open', () => {
  const ev = [
    { key: 'd1', title: 'Review', start: at(10), canOpen: false },
    { key: 'd2', title: 'Review', start: at(10), canOpen: true },
    { key: 'd3', title: 'Review', start: at(20), canOpen: true },
    { key: 'd4', title: 'Other', start: at(10), canOpen: true },
  ];
  expect(matchDayEvent({ title: 'Review', start: at(10) }, ev)?.key).toBe('d2');
  expect(matchDayEvent({ title: 'Review', start: at(30) }, ev)).toBeUndefined();
  expect(matchDayEvent({ title: 'Review', start: at(10) }, [])).toBeUndefined();
});

it('the Next card heading: Next in a call, After this before, and back to back (amber) within 2 minutes of the end', () => {
  const hero = meeting(-20, 40);
  const after = (mins: number) => ({ start: at(mins) });
  expect(nextHeading(hero, after(90), true)).toEqual({ text: 'Next', amber: false });
  expect(nextHeading(hero, after(90), false)).toEqual({ text: 'After this', amber: false });
  expect(nextHeading(hero, after(40), true)).toEqual({ text: 'Next, back to back', amber: true });
  expect(nextHeading(hero, after(42), false)).toEqual({ text: 'Next, back to back', amber: true });
  expect(nextHeading(hero, after(43), false).amber).toBe(false);
  expect(nextHeading(hero, undefined, false).text).toBe('After this');
  expect(BACK_TO_BACK_MS).toBe(120_000);
  // A meeting that starts before the hero ends (an overlap) is back to back too.
  expect(nextHeading(hero, after(30), false).amber).toBe(true);
});

it('the leave signal belongs to the meeting whose start it names', () => {
  const leave = { key: 'k', leaveAt: NOW + 30 * 60_000, startsAt: NOW + 60 * 60_000 };
  expect(leaveIsFor(leave, { start: at(60) })).toBe(true);
  expect(leaveIsFor(leave, { start: at(61) })).toBe(true);
  expect(leaveIsFor(leave, { start: at(90) })).toBe(false);
  expect(leaveIsFor(null, { start: at(60) })).toBe(false);
});
