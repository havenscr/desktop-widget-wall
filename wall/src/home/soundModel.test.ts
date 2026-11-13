import { expect, it } from 'vitest';
import {
  chipLabel,
  groupLabel,
  groupVolume,
  groupTargets,
  loudText,
  markAfterRead,
  needsConfirm,
  nowLine,
  soonestTimer,
  orderPresets,
  routineSlot,
  sleepLeft,
  slotsFor,
  splitRoutines,
  startedText,
  suggestedKey,
  type MusicRoutine,
  type PlayMark,
  type SonosSpeaker,
  type SonosSummary,
} from './soundModel';

const sp = (name: string, over: Partial<SonosSpeaker> = {}): SonosSpeaker => ({
  name,
  state: 'playing',
  volume: 10,
  input: null,
  group: 'G2',
  online: true,
  ...over,
});
const r = (key: string, name: string): MusicRoutine => ({ key, name, favorite: null, volume: 10 });

const SUMMARY: SonosSummary = {
  speakers: [sp('Studio', { input: 'lineIn', volume: 100, group: 'G1' }), sp('Den', { volume: 14 }), sp('Porch', { volume: 10 }), sp('Shed', { online: false, state: 'offline', volume: null })],
  groups: [
    { id: 'G1', coordinator: 'Studio', members: ['Studio'] },
    { id: 'G2', coordinator: 'Den', members: ['Den', 'Porch', 'Shed'] },
  ],
  presets: [],
  music: [],
  controls: [],
  scenes: [],
  sleepTimers: [],
  nowPlaying: null,
  currentGroup: 'G2',
  readAtMs: 0,
};

it('shortens a routine name for its button', () => {
  expect(chipLabel('Night Owl Music')).toBe('Night Owl');
  expect(chipLabel('Music for Rain')).toBe('for Rain');
  expect(chipLabel('Music')).toBe('Music');
  expect(chipLabel('Bright Pop')).toBe('Bright Pop');
});

it('puts six routines on the face and the rest under More, in the service order', () => {
  const list = Array.from({ length: 9 }, (_, i) => r(`k${i}`, `Mix ${i}`));
  const { face, more } = splitRoutines(list);
  expect(face.map((x) => x.key)).toEqual(['k0', 'k1', 'k2', 'k3', 'k4', 'k5']);
  expect(more.map((x) => x.key)).toEqual(['k6', 'k7', 'k8']);
  expect(splitRoutines([]).face).toEqual([]);
});

it('reads the part of the day from a routine name', () => {
  expect(routineSlot('Dawn Music')).toBe('morning');
  expect(routineSlot('Noon Music')).toBe('day');
  expect(routineSlot('Day Mix')).toBe('day');
  expect(routineSlot('Dusk Music')).toBe('evening');
  expect(routineSlot('Night Owl Music')).toBe('night');
  expect(routineSlot('Late Night Mix')).toBe('night');
  expect(routineSlot('Desk Focus Music')).toBe('workday');
  expect(routineSlot('Workday Beats')).toBe('workday');
  expect(routineSlot('Bright Pop')).toBeNull();
  // "Someday" and "Daydream" are not "day".
  expect(routineSlot('Someday Songs')).toBeNull();
});

it('suggests the routine that fits the hour', () => {
  const list = [r('a', 'Dawn Music'), r('b', 'Noon Music'), r('c', 'Dusk Music'), r('d', 'Night Owl Music'), r('e', 'Desk Focus Music'), r('f', 'Bright Pop')];
  // Thursday 12 November 2026, local time.
  const at = (h: number, m = 0, day = 12) => new Date(2026, 10, day, h, m);
  expect(suggestedKey(list, at(7))).toBe('a');
  expect(suggestedKey(list, at(10))).toBe('e');
  expect(suggestedKey(list, at(10, 0, 14))).toBe('b'); // Saturday: the day mix, not work
  expect(suggestedKey(list, at(18))).toBe('c');
  expect(suggestedKey(list, at(23))).toBe('d');
  expect(suggestedKey(list, at(2))).toBe('d');
  expect(suggestedKey([r('f', 'Bright Pop')], at(18))).toBeNull();
  // On a weekday with no work routine, the day one stands in.
  expect(suggestedKey([r('b', 'Noon Music')], at(11))).toBe('b');
  expect(slotsFor(at(16, 59))).toEqual(['workday', 'day']);
  expect(slotsFor(at(17))).toEqual(['evening']);
});

it('puts the preset whose name starts with Office first', () => {
  const p = (id: string, name: string) => ({ id, name, active: false, loud: [] });
  expect(orderPresets([p('a', 'Whole House'), p('b', 'Living'), p('c', 'Office Desk')]).map((x) => x.id)).toEqual(['c', 'a', 'b']);
  expect(orderPresets([p('a', 'Whole House'), p('b', 'Living')]).map((x) => x.id)).toEqual(['a', 'b']);
  expect(orderPresets([p('c', 'office'), p('a', 'Whole')]).map((x) => x.id)).toEqual(['c', 'a']);
});

it('the group slider leaves out line-in and offline speakers', () => {
  expect(groupVolume(SUMMARY)).toBe(12);
  expect(groupLabel(SUMMARY)).toBe('Den and 1 more');
  expect(groupVolume({ ...SUMMARY, currentGroup: 'G1' })).toBeNull();
  expect(groupLabel({ ...SUMMARY, currentGroup: null })).toBeNull();
});

it('asks first for any target above 40, whatever the read says', () => {
  expect(needsConfirm([41])).toBe(true);
  expect(needsConfirm([40])).toBe(false);
  expect(needsConfirm([10, 60])).toBe(true);
  expect(needsConfirm([])).toBe(false);
});

it('a group step moves each music speaker from its own level, clamped', () => {
  expect(groupTargets(SUMMARY, 5)).toEqual([
    { name: 'Den', level: 19 },
    { name: 'Porch', level: 15 },
  ]);
  expect(groupTargets(SUMMARY, -50)).toEqual([
    { name: 'Den', level: 0 },
    { name: 'Porch', level: 0 },
  ]);
});

it('names the speakers that make an action ask first', () => {
  expect(loudText([{ name: 'Studio', level: 100, sets: false }], 'Group')).toBe('Studio is at 100. Group anyway?');
  expect(loudText([{ name: 'Den', level: null, sets: false }, { name: 'Loft', level: 70, sets: true }], 'Apply')).toBe(
    "Den's level is not known; it sets Loft to 70. Apply anyway?",
  );
});

it('keeps "started" only while what plays is what the wall started', () => {
  const t = 1_000_000;
  const start: PlayMark = { key: 'k', at: t, group: null, seen: false };
  const quiet = { ...SUMMARY, speakers: SUMMARY.speakers.map((s) => (s.input ? s : { ...s, state: 'stopped' as const })) };
  // A first read before the music shows keeps it; a later quiet read clears it.
  expect(markAfterRead(start, quiet, t + 5_000)).toBe(start);
  expect(markAfterRead(start, quiet, t + 30_000)).toBeNull();
  // The first read with music records the group.
  const seen = markAfterRead(start, SUMMARY, t + 5_000)!;
  expect(seen).toEqual({ key: 'k', at: t, group: 'G2', seen: true });
  expect(markAfterRead(seen, SUMMARY, t + 10 * 60_000)).toBe(seen);
  // Nothing playing, another group, no group to tell by, or past an hour: cleared.
  expect(markAfterRead(seen, quiet, t + 10 * 60_000)).toBeNull();
  expect(markAfterRead(seen, { ...SUMMARY, currentGroup: 'G1' }, t + 60_000)).toBeNull();
  expect(markAfterRead(seen, { ...SUMMARY, currentGroup: null }, t + 60_000)).toBeNull();
  expect(markAfterRead(seen, SUMMARY, t + 61 * 60_000)).toBeNull();
  expect(markAfterRead(null, SUMMARY, t)).toBeNull();
});

it('shows the soonest running sleep timer, never one that ended', () => {
  const now = 10 * 60_000;
  expect(
    soonestTimer(
      [
        { id: 'late', endsAtMs: now + 50 * 60_000, fadeMinutes: 5 },
        { id: 'soon', endsAtMs: now + 5 * 60_000, fadeMinutes: 5 },
        { id: 'gone', endsAtMs: now - 2 * 60_000, fadeMinutes: 5 },
      ],
      now,
    )?.id,
  ).toBe('soon');
  expect(soonestTimer([{ id: 'gone', endsAtMs: now - 2 * 60_000, fadeMinutes: 5 }], now)).toBeNull();
});

it('says what plays and where, never claiming a track it does not know', () => {
  expect(nowLine(SUMMARY)).toBe('Playing on 2 speakers');
  expect(nowLine({ ...SUMMARY, nowPlaying: { speaker: 'Den', track: 'Song A', artist: 'Band B' } })).toBe('Song A, Band B, on 2 speakers');
  const quiet = { ...SUMMARY, speakers: SUMMARY.speakers.map((s) => ({ ...s, state: s.input ? s.state : ('stopped' as const) })) };
  expect(nowLine(quiet)).toBe('Nothing playing');
});

it('counts sleep minutes and start ages', () => {
  expect(sleepLeft({ id: 't', endsAtMs: 10 * 60_000, fadeMinutes: 5 }, 0)).toBe(10);
  expect(sleepLeft({ id: 't', endsAtMs: 0, fadeMinutes: 5 }, 60_000)).toBe(0);
  expect(sleepLeft({ id: 't', endsAtMs: null, fadeMinutes: null }, 0)).toBeNull();
  expect(startedText(0, 30_000)).toBe('started just now');
  expect(startedText(0, 5 * 60_000)).toBe('started 5 min ago');
  expect(startedText(0, 125 * 60_000)).toBe('started 2 h ago');
});
