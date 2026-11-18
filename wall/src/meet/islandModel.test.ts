import { expect, it } from 'vitest';
import { HOW_TO, indexName, inviteSize, islandKinds, marksLine, namesPreview, stepKind, type CallMark } from './islandModel';
import type { MeetingDetails } from './model';

const details = (over: Partial<MeetingDetails> = {}): MeetingDetails => ({
  calledBy: 'Casey Rowe',
  people: [
    { name: 'Casey Rowe', reply: 'organizer' },
    { name: 'Dana Whitfield', reply: 'yes' },
    { name: 'Eli Navarro', reply: 'maybe' },
  ],
  peopleMore: 0,
  invite: 'Walk through the sizing options.',
  ...over,
});
const mark = (s: number): CallMark => ({ at: 1_000 + s, showMs: s * 1000 });

it('shows only the kinds that have something, in the island order', () => {
  const all = islandKinds({ details: details(), checklist: ['One', 'Two'], marks: [mark(5)] });
  expect(all.map((k) => k.id)).toEqual(['invite', 'people', 'checklist', 'notes']);
  expect(all.map((k) => k.title)).toEqual(['The invite', 'Who is coming', 'Your first-meeting list', 'Live notes']);
  expect(all.map((k) => k.source)).toEqual(['From the calendar invite', 'From the invite', 'From meet-checklist.txt', 'From Capture']);
  expect(islandKinds({ details: details({ invite: null }), checklist: [], marks: [] }).map((k) => k.id)).toEqual(['people']);
  expect(islandKinds({ details: details({ people: [], peopleMore: 0 }), checklist: [], marks: [] }).map((k) => k.id)).toEqual(['invite']);
  expect(islandKinds({ details: null, checklist: ['One'], marks: [] }).map((k) => k.id)).toEqual(['checklist']);
  expect(islandKinds({ details: undefined, checklist: [], marks: [mark(1)] }).map((k) => k.id)).toEqual(['notes']);
  // People who are only counted (no name) still make the kind.
  expect(islandKinds({ details: details({ people: [], peopleMore: 4, invite: null }), checklist: [], marks: [] }).map((k) => k.id)).toEqual(['people']);
});

it('with no kind at all the list is empty, so the island shows how the checklist file works', () => {
  expect(islandKinds({ details: null, checklist: [], marks: [] })).toEqual([]);
  expect(islandKinds({ details: details({ invite: null, people: [], peopleMore: 0, calledBy: null }), checklist: [], marks: [] })).toEqual([]);
  expect(HOW_TO).toHaveLength(3);
  expect(HOW_TO[0]).toContain('meet-checklist.txt');
});

it('counts and previews, one line a kind', () => {
  const k = Object.fromEntries(islandKinds({ details: details(), checklist: ['Who decides', 'Next step'], marks: [mark(192), mark(580)] }).map((x) => [x.id, x]));
  expect(k.people.count).toBe(3);
  expect(k.people.preview).toBe('Casey, Dana and Eli');
  expect(k.checklist.count).toBe(2);
  expect(k.checklist.preview).toBe('Who decides');
  expect(k.notes.preview).toBe('2 marked: 03:12, 09:40');
  expect(k.invite.count).toBeUndefined();
  expect(k.invite.preview).toBe('Walk through the sizing options.');
  expect(indexName(k.checklist)).toBe('First-meeting list');
  expect(indexName(k.people)).toBe('Who is coming');
});

it('names preview: three first names and the rest counted', () => {
  expect(namesPreview(details({ people: [{ name: 'Casey Rowe', reply: 'yes' }], peopleMore: 0 }))).toBe('Casey');
  expect(namesPreview(details({ peopleMore: 5 }))).toBe('Casey, Dana, Eli and 5 more');
  expect(namesPreview(details({ people: [{ name: 'A B', reply: 'no' }], peopleMore: 0 }))).toBe('1 invited');
  const many = details({ people: Array.from({ length: 8 }, (_, i) => ({ name: `P${i} X`, reply: 'yes' as const })) });
  expect(namesPreview(many)).toBe('P0, P1, P2 and 5 more');
});

it('marks line: the count and the last three times', () => {
  expect(marksLine([])).toBe('None yet');
  expect(marksLine([mark(192)])).toBe('1 marked: 03:12');
  expect(marksLine([mark(1), mark(2), mark(3), mark(4)])).toBe('4 marked: 00:02, 00:03, 00:04');
  expect(marksLine([{ at: 1, showMs: 3_725_000 }])).toBe('1 marked: 1:02:05');
});

it('stepping wraps, and one kind has nowhere to go', () => {
  expect(stepKind(0, 4, 1)).toBe(1);
  expect(stepKind(3, 4, 1)).toBe(0);
  expect(stepKind(0, 4, -1)).toBe(3);
  expect(stepKind(0, 1, 1)).toBe(0);
  expect(stepKind(0, 0, -1)).toBe(0);
});

it('a short invite is set larger', () => {
  expect(inviteSize('x'.repeat(150))).toBe('l');
  expect(inviteSize('x'.repeat(151))).toBe('m');
  expect(inviteSize('x'.repeat(300))).toBe('m');
  expect(inviteSize('x'.repeat(301))).toBe('s');
});
