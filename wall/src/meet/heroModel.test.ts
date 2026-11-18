import { expect, it } from 'vitest';
import {
  BACK_TO_BACK_MS,
  BEFORE_LATER,
  BROWSER_KEYS,
  MAX_CIRCLES,
  MUTE_TIP,
  calledByLine,
  callLater,
  callKeys,
  drawnPeople,
  initials,
  invitedCount,
  leaveIsFor,
  matchDayEvent,
  leaveWords,
  nextHeading,
  peopleBlock,
  relationLine,
  replyMark,
  replyWord,
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
  // A call joined before the start is violet, like any call.
  expect(ringOf(meeting(20, 80), NOW, true).tone).toBe('violet');
  expect(ringOf(meeting(20, 80), NOW, false).under).toMatch(/^\d+(:\d\d)? [AP]M to \d+(:\d\d)? [AP]M$/);
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
  // Past the end (a call that runs over): minutes over in amber, a full ring, "ended" under it; never "1 min left".
  const over = ringOf(meeting(-72, -12), NOW, true);
  expect(over).toMatchObject({ value: 12, unit: 'min over', tone: 'amber', frac: 1 });
  expect(over.under).toMatch(/^ended /);
  expect(ringOf(meeting(-72, 0), NOW, true)).toMatchObject({ value: 0, unit: 'min over', tone: 'amber' });
  expect(ringOf(meeting(-72, -12), NOW, false).unit).toBe('min over');
  // A zero-length meeting that has begun is over at once.
  expect(ringOf(meeting(-5, -5), NOW, true)).toMatchObject({ value: 5, unit: 'min over' });
  expect(ringOf(meeting(0, 0), NOW, true)).toMatchObject({ value: 0, unit: 'min over' });
  expect(ringOf(meeting(-300, -100), NOW, true)).toMatchObject({ value: 1, unit: 'h over' });
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

it('Open invite matches account, start, end and title, and only when exactly one day event matches and Outlook can open it', () => {
  const base = { accountId: 'work', title: 'Review', start: at(10), end: at(40) };
  const ev = (key: string, over: Record<string, unknown> = {}) => ({ key, ...base, canOpen: true, ...over });
  const hero = base;
  expect(matchDayEvent(hero, [ev('d1')])?.key).toBe('d1');
  expect(matchDayEvent(hero, [ev('d1', { canOpen: false })])).toBeUndefined();
  expect(matchDayEvent(hero, [ev('d1', { accountId: 'second' })])).toBeUndefined();
  expect(matchDayEvent(hero, [ev('d1', { end: at(41) })])).toBeUndefined();
  expect(matchDayEvent(hero, [ev('d1', { start: at(11) })])).toBeUndefined();
  expect(matchDayEvent(hero, [ev('d1', { title: 'Other' })])).toBeUndefined();
  // Two look-alikes could open the wrong one: no key.
  expect(matchDayEvent(hero, [ev('d1'), ev('d2')])).toBeUndefined();
  expect(matchDayEvent(hero, [ev('d1'), ev('d2', { canOpen: false })])).toBeUndefined();
  expect(matchDayEvent(hero, [ev('d1'), ev('d2', { title: 'Other' })])?.key).toBe('d1');
  expect(matchDayEvent(hero, [])).toBeUndefined();
});

it('the Next card heading: Next in a call, After this before, back to back within 2 minutes either side of the end, overlaps before that', () => {
  const hero = meeting(-20, 40);
  const after = (mins: number) => ({ start: at(mins) });
  expect(nextHeading(hero, after(90), true)).toEqual({ text: 'Next', amber: false, relation: 'apart' });
  expect(nextHeading(hero, after(90), false)).toEqual({ text: 'After this', amber: false, relation: 'apart' });
  expect(nextHeading(hero, after(40), true)).toEqual({ text: 'Next, back to back', amber: true, relation: 'back' });
  expect(nextHeading(hero, after(42), false).relation).toBe('back');
  expect(nextHeading(hero, after(38), false).relation).toBe('back');
  expect(nextHeading(hero, after(43), false).relation).toBe('apart');
  expect(nextHeading(hero, after(43), false).amber).toBe(false);
  expect(nextHeading(hero, undefined, false).text).toBe('After this');
  expect(nextHeading(undefined, after(10), true)).toEqual({ text: 'Next', amber: false, relation: 'apart' });
  expect(BACK_TO_BACK_MS).toBe(120_000);
  // A larger overlap is its own thing, not back to back (the old test blessed ten minutes).
  expect(nextHeading(hero, after(30), false)).toEqual({ text: 'Next, overlaps', amber: true, relation: 'overlap' });
  expect(nextHeading(hero, after(37), false).relation).toBe('overlap');
  expect(relationLine('back')).toBe('Starts as this one ends');
  expect(relationLine('overlap')).toBe('Starts before this one ends');
  expect(relationLine('apart')).toBeNull();
});

it('the leave line: minutes after the hero ends in a call, amber when the leave time is before it ends', () => {
  const hero = meeting(-20, 40);
  const leaveAt = (mins: number) => NOW + mins * 60_000;
  expect(leaveWords(leaveAt(50), hero, true)).toEqual({ text: expect.stringMatching(/^Leave by .*, 10 min after this$/), amber: false });
  expect(leaveWords(leaveAt(40), hero, true).text).toMatch(/, 0 min after this$/);
  expect(leaveWords(leaveAt(35), hero, true)).toEqual({ text: expect.stringMatching(/^Leave by .*, before this ends$/), amber: true });
  // Before the meeting, or with no hero, only the time.
  expect(leaveWords(leaveAt(50), hero, false).text).toMatch(/^Leave by \d+(:\d\d)? [AP]M$/);
  expect(leaveWords(leaveAt(50), undefined, true).text).toMatch(/^Leave by \d+(:\d\d)? [AP]M$/);
});

it('the leave signal belongs to the meeting whose start it names', () => {
  const leave = { key: 'k', leaveAt: NOW + 30 * 60_000, startsAt: NOW + 60 * 60_000 };
  expect(leaveIsFor(leave, { start: at(60) })).toBe(true);
  expect(leaveIsFor(leave, { start: at(61) })).toBe(true);
  expect(leaveIsFor(leave, { start: at(90) })).toBe(false);
  expect(leaveIsFor(null, { start: at(60) })).toBe(false);
});

it('reply words and marks: accepted and organizer tick, maybe asks, none and declined dash', () => {
  expect(replyWord('yes')).toBe('Accepted');
  expect(replyWord('organizer')).toBe('Organizer');
  expect(replyWord('maybe')).toBe('Maybe');
  expect(replyWord('none')).toBe('No reply');
  expect(replyMark('yes').tone).toBe('yes');
  expect(replyMark('organizer').tone).toBe('yes');
  expect(replyMark('maybe')).toEqual({ text: '?', tone: 'maybe' });
  expect(replyMark('none').tone).toBe('none');
});

it('the later keys: six after Join and Open invite, four after the call keys, the last named for the call', () => {
  expect(BEFORE_LATER.map((k) => k.label)).toEqual(['Copy join info', 'Open chat', 'Running late', 'Do Not Disturb', 'Lights', 'Open in Teams']);
  expect(callLater('teams').map((k) => k.label)).toEqual(['Raise hand', 'Reactions', 'Chat panel', 'Open in Teams']);
  expect(callLater('zoom').at(-1)?.label).toBe('Open in Zoom');
});
