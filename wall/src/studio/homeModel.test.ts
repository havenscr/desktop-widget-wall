import { expect, it } from 'vitest';
import { studioAnswer, studioWith } from './homeKit';
import { chipPresetWord, homeLine, normalState, presetChipLabel, summaryParts, tileState, wouldBeDark, ZONE_TIP } from './homeModel';
import { studioOf, type Group } from './home';
import { TEXT } from './homeStore';

const studio = (over: Record<string, unknown> = {}) => studioOf(studioAnswer(over))!;
const g = (s: ReturnType<typeof studio>, id: string): Group => s.groups.find((x) => x.id === id)!;

it('the summary: label and line when a preset is on, the key light words when none is, only "changed" when it changed', () => {
  expect(summaryParts(studio(), 'Key lights 60%, 4400 K')).toEqual({ lead: 'Normal:', rest: ' regular routines. Key lights 60%, 4400 K', full: 'Normal: regular routines. Key lights 60%, 4400 K' });
  expect(summaryParts(studio(), '').rest).toBe(' regular routines.');
  const on = studioOf(studioWith('onAir'))!;
  expect(summaryParts(on, 'ignored')).toEqual({ lead: 'On air:', rest: ' Key lights on, panels glow', full: 'On air: Key lights on, panels glow' });
  const changed = studioOf(studioWith('onAir', { changed: true }))!;
  expect(summaryParts(changed, '')).toEqual({ lead: 'On air, changed', rest: ' since it was set', full: 'On air, changed since it was set' });
});

it('the summary with a switch preset held names it, or says a preset is on, never "regular routines"', () => {
  expect(summaryParts(studio({ canNormal: true, normalLine: 'Room back to how it was before Gaming, key lights off' }), 'Key lights 60%')).toEqual({ lead: 'Gaming.', rest: ' Key lights 60%', full: 'Gaming. Key lights 60%' });
  expect(summaryParts(studio({ canNormal: true }), '').lead).toBe('A preset is on.');
});

it('the Normal chip is lit exactly when the home app has nothing to end, and a failed read lights nothing', () => {
  expect(normalState(studio(), true, null)).toEqual({ lit: true, tip: 'Normal: the room is on its regular routines.' });
  expect(normalState(studioOf(studioWith('onAir'))!, true, 'On air')).toEqual({ lit: false, tip: 'Normal: ends On air, and the room goes back to its regular routines.' });
  expect(normalState(studio({ canNormal: true }), true, 'Gaming').lit).toBe(false);
  expect(normalState(studio(), false, null).lit).toBe(false);
});

it('chip words: the preset, with ", changed" only on the one that is on', () => {
  const changed = studioOf(studioWith('onAir', { changed: true }))!;
  expect(presetChipLabel(changed.presets[0], true)).toBe('On air, changed');
  expect(presetChipLabel(changed.presets[1], true)).toBe('Recording');
  expect(chipPresetWord(changed.presets[0], true)).toBe('Lights: On air, changed');
  expect(chipPresetWord(null, false)).toBeNull();
});

it('the dark-room guard: a room light that is the only one on cannot be turned off; panels never count', () => {
  const s = studio();
  expect(wouldBeDark(s, g(s, 'overhead'))).toBe(false);
  const one = studioOf(studioAnswer({ groups: [{ ...g(s, 'behindMonitor'), on: false }, g(s, 'overhead'), g(s, 'panels')] }))!;
  expect(wouldBeDark(one, g(one, 'overhead'))).toBe(true);
  expect(wouldBeDark(one, g(one, 'behindMonitor'))).toBe(false);
  expect(wouldBeDark(one, g(one, 'panels'))).toBe(false);
  // The other room group missing: the home app could not say, so the wall does not send an off.
  const alone = studioOf(studioAnswer({ groups: [g(s, 'overhead')] }))!;
  expect(wouldBeDark(alone, g(alone, 'overhead'))).toBe(true);
});

it('a tile: needs a zone, not answering, no token, dark room, or ready, each with its words', () => {
  const s = studio();
  expect(tileState(s, g(s, 'overhead'), true)).toMatchObject({ disabled: false, dim: false });
  expect(tileState(s, g(s, 'overhead'), true).tip).toContain('Click to turn it off');
  expect(tileState(s, g(s, 'overhead'), false)).toMatchObject({ disabled: true });
  expect(tileState(s, g(s, 'overhead'), false).tip).toContain('desk token');
  // The tip agrees with the line: the token is added in Tools, no longer "typed".
  expect(tileState(s, g(s, 'overhead'), false).tip).toContain('add the home app\'s desk token in Tools');
  expect(tileState(s, g(s, 'overhead'), false).tip).not.toContain('typed');
  const zone = { ...g(s, 'overhead'), canSwitch: false, setTo: 'Needs a Hue zone' };
  expect(tileState(s, zone, true)).toEqual({ disabled: true, dim: true, tip: ZONE_TIP });
  const named = { ...g(s, 'overhead'), setTo: 'Needs a Hue zone' };
  expect(tileState(s, named, true).disabled).toBe(true);
  const silent = { ...g(s, 'overhead'), reachable: false };
  expect(tileState(s, silent, true)).toMatchObject({ disabled: false, dim: true });
  expect(tileState(s, silent, true).tip).toContain('Not answering');
});

it('the line that outranks the summary: a note, then a kept amber line with its action', () => {
  const base = { studio: null, readWord: null, readDone: true, sticky: null, note: null } as const;
  expect(homeLine(base)).toBeNull();
  expect(homeLine({ ...base, note: TEXT.busy })).toMatchObject({ text: TEXT.busy, tone: 'amber', action: null });
  expect(homeLine({ ...base, sticky: 'home-not-set-up' })).toMatchObject({ text: TEXT.homeNotSetUp, action: 'tryAgain' });
  expect(homeLine({ ...base, sticky: 'forbidden' })).toMatchObject({ text: TEXT.forbidden, action: 'openTools' });
  expect(homeLine({ ...base, sticky: 'forbidden', note: TEXT.busy })?.text).toBe(TEXT.busy);
});
