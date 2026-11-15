import { elapsedText } from '../signals/RecordingChip';
import { drawnPeople, invitedCount } from './heroModel';
import type { MeetingDetails } from './model';

export type KindId = 'invite' | 'people' | 'checklist' | 'notes';

/** A mark made in this call: when, and how far into the call. */
export interface CallMark {
  at: number;
  showMs: number;
}

export interface IslandKind {
  id: KindId;
  title: string;
  /** Tabler icon name drawn by the island. */
  icon: 'mail' | 'users' | 'checklist' | 'bookmark';
  count?: number;
  /** The source pill, naming where the words came from. */
  source: string;
  /** One line for the "Also on file" index. */
  preview: string;
}

export interface IslandInput {
  details: MeetingDetails | null | undefined;
  /** The checklist file's items; empty when it is missing, refused or has none. */
  checklist: readonly string[];
  /** The marks made in this call, oldest first. */
  marks: readonly CallMark[];
}

const FIRST_NAME = (name: string) => name.split(/\s+/)[0] ?? name;

/** "Riley, Jo and Sam", "Riley, Jo, Sam and 3 more". */
export function namesPreview(d: MeetingDetails): string {
  const drawn = drawnPeople(d);
  const names = drawn.slice(0, 3).map((p) => FIRST_NAME(p.name));
  const rest = invitedCount(d) - names.length;
  if (names.length === 0) return `${invitedCount(d)} invited`;
  if (rest > 0) return `${names.join(', ')} and ${rest} more`;
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "2 marked: 03:12, 09:40" (the last three), or "None yet". */
export function marksLine(marks: readonly CallMark[]): string {
  if (marks.length === 0) return 'None yet';
  return `${marks.length} marked: ${marks.slice(-3).map((m) => elapsedText(m.showMs)).join(', ')}`;
}

/**
 * The kinds that have something, in the island's order: the invite, who is coming, the first-meeting list,
 * live notes. A kind with nothing is absent; nothing turns by itself. An empty list means the how-to shows.
 */
export function islandKinds(i: IslandInput): IslandKind[] {
  const out: IslandKind[] = [];
  if (i.details?.invite) {
    out.push({ id: 'invite', title: 'The invite', icon: 'mail', source: 'From the calendar invite', preview: i.details.invite });
  }
  if (i.details && invitedCount(i.details) > 0) {
    out.push({ id: 'people', title: 'Who is coming', icon: 'users', count: invitedCount(i.details), source: 'From the invite', preview: namesPreview(i.details) });
  }
  if (i.checklist.length > 0) {
    out.push({ id: 'checklist', title: 'Your first-meeting list', icon: 'checklist', count: i.checklist.length, source: 'From meet-checklist.txt', preview: i.checklist[0] });
  }
  if (i.marks.length > 0) {
    out.push({ id: 'notes', title: 'Live notes', icon: 'bookmark', count: i.marks.length, source: 'From Capture', preview: marksLine(i.marks) });
  }
  return out;
}

/** The footer's order line, naming the kinds that exist now. */
export function orderLine(kinds: readonly IslandKind[]): string {
  return `Order: ${kinds.map((k) => k.title.toLowerCase()).join(', ')}`;
}

/** What the island says with no kind at all: how the checklist file works, in three lines. */
export const HOW_TO: readonly string[] = [
  'Write your own first-meeting list in meet-checklist.txt, one item a line.',
  'Lines starting # or // are skipped. Up to 8 items; click one to tick it for this meeting.',
  'The invite and who is coming show here too when the calendar sends them.',
];

/** The short "Also on file" name of a kind: its title without the possessive. */
export function indexName(k: IslandKind): string {
  return k.id === 'checklist' ? 'First-meeting list' : k.title;
}

/** Next kind index, wrapping; null when there is nothing to move to. */
export function stepKind(index: number, count: number, dir: 1 | -1): number {
  if (count <= 1) return 0;
  return (index + dir + count) % count;
}
