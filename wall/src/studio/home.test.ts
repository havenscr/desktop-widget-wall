import { afterEach, expect, it } from 'vitest';
import { mocks } from '../bridge/tauri';
import { applyMood, applyOff, nudgeMood, applyPreset, forgetToken, goNormal, HOME_WORDS, homeWordOf, moodsOf, readMoods, readTokenStatus, saveToken, setGroup, setHomeKeys, studioOf } from './home';
import { studioAnswer } from './homeKit';

afterEach(() => mocks.clear());

it('the words: every fixed word passes, anything else is failed, an Error is read by its message', () => {
  for (const w of HOME_WORDS) expect(homeWordOf(w)).toBe(w);
  expect(homeWordOf('Invalid desk token abc')).toBe('failed');
  expect(homeWordOf(new Error('busy'))).toBe('busy');
  expect(homeWordOf(new Error('No mock registered'))).toBe('failed');
  expect(homeWordOf(undefined)).toBe('failed');
  expect(homeWordOf({ message: 'busy' })).toBe('failed');
});

it('a studio answer is checked: lists, types and ranges', () => {
  expect(studioOf(null)).toBeNull();
  expect(studioOf({ presets: [] })).toBeNull();
  expect(studioOf({ presets: {}, groups: [] })).toBeNull();
  const s = studioOf(
    studioAnswer({
      presets: [{ id: 'a', label: 'A', line: '', active: 'yes', setsKeyLights: 1 }, { id: '', label: 'B' }, { label: 'C' }, 7, null],
      keys: { canSet: true, left: { on: true, brightness: 'x', kelvin: 4000 }, right: 'other-model' },
      looks: [{ id: 'g', label: 'G', active: true }, { id: 'h' }],
      writeBlock: 'nope',
    }),
  )!;
  expect(s.presets).toEqual([{ id: 'a', label: 'A', line: null, active: false, setsKeyLights: false }]);
  expect(s.keys).toEqual({ canSet: true, left: null, right: 'other-model' });
  expect(s.looks).toEqual([{ id: 'g', label: 'G', active: true }]);
  expect(s.writeBlock).toBeNull();
  // A missing stale flag counts as stale.
  const raw = studioAnswer();
  delete raw.stale;
  expect(studioOf(raw)!.stale).toBe(true);
  // Missing booleans count as false.
  expect(studioOf({ presets: [], groups: [] })!.canWrite).toBe(false);
});

it('groups: only the three known ids, colours as six hex digits, levels as whole numbers 0 to 100', () => {
  const s = studioOf({
    presets: [],
    groups: [
      { id: 'panels', label: 'P', colour: '#A1b2C3', level: 100, floor: 0 },
      { id: 'constructor', label: 'X' },
      { id: '__proto__', label: 'X' },
      { id: 'overhead', label: 'O', colour: '#12345', level: 45.5, floor: -1 },
    ],
  })!;
  expect(s.groups.map((g) => g.id)).toEqual(['panels', 'overhead']);
  expect(s.groups[0]).toMatchObject({ colour: '#A1b2C3', level: 100, floor: 0 });
  expect(s.groups[1]).toMatchObject({ colour: null, level: null, floor: null });
});

it('moods are checked the same way', () => {
  expect(moodsOf({})).toBeNull();
  const m = moodsOf({ stale: false, moods: [{ id: 'a', label: 'A', line: 'x', active: true }, { id: 'b' }], canWrite: true, writeBlock: 'not-set-up' })!;
  expect(m.moods).toEqual([{ id: 'a', label: 'A', line: 'x', active: true }]);
  expect(m.canWrite).toBe(true);
  expect(m.writeBlock).toBe('not-set-up');
});

it('each call sends the command and arguments it should, and a shape that is not a studio is failed', async () => {
  const seen: [string, unknown][] = [];
  for (const c of ['wall2_studio_preset', 'wall2_studio_normal', 'wall2_studio_group', 'wall2_studio_keys']) {
    mocks.set(c, (args) => {
      seen.push([c, args]);
      return studioAnswer();
    });
  }
  await applyPreset('onAir');
  await goNormal();
  await setGroup('panels', true);
  await setGroup('overhead', true, 61.6);
  await setHomeKeys('both', { on: true });
  expect(seen).toEqual([
    ['wall2_studio_preset', { id: 'onAir' }],
    ['wall2_studio_normal', undefined],
    ['wall2_studio_group', { id: 'panels', on: true }],
    ['wall2_studio_group', { id: 'overhead', on: true, level: 62 }],
    ['wall2_studio_keys', { which: 'both', on: true }],
  ]);
  mocks.set('wall2_studio_normal', () => ({ nothing: 1 }));
  await expect(goNormal()).rejects.toBe('failed');
  mocks.set('wall2_office_moods', () => ({ nothing: 1 }));
  await expect(readMoods()).rejects.toBe('failed');
  mocks.set('wall2_office_mood', (a) => ({ moods: [{ id: String(a?.id), label: 'M', active: true }] }));
  expect((await applyMood('brightDesk')).moods[0].id).toBe('brightDesk');
});

it('the token calls pass the value only to the set command and read back only two flags', async () => {
  let got: unknown;
  mocks.set('wall2_desk_token_set', (a) => {
    got = a;
  });
  await saveToken('abc');
  expect(got).toEqual({ token: 'abc' });
  mocks.set('wall2_desk_token_status', () => ({ set: true, unreadable: false, token: 'leak', length: 3 }));
  expect(await readTokenStatus()).toEqual({ set: true, unreadable: false });
  mocks.set('wall2_desk_token_forget', () => undefined);
  await forgetToken();
});

it('the moods answer carries off only as an object; applyOff calls its one command with no arguments', async () => {
  const mood = { id: 'brightDesk', label: 'Bright desk', active: false };
  expect(moodsOf({ moods: [mood] })!.off).toBeNull();
  expect(moodsOf({ moods: [mood], off: null })!.off).toBeNull();
  expect(moodsOf({ moods: [mood], off: true })!.off).toBeNull();
  expect(moodsOf({ moods: [mood], off: [1] })!.off).toBeNull();
  expect(moodsOf({ moods: [mood], off: 'yes' })!.off).toBeNull();
  expect(moodsOf({ moods: [mood], off: { active: false } })!.off).toEqual({ active: false });
  expect(moodsOf({ moods: [mood], off: { active: true } })!.off).toEqual({ active: true });
  expect(moodsOf({ moods: [mood], off: { active: 'true' } })!.off).toEqual({ active: false });
  let seen: unknown[] | null = null;
  mocks.set('wall2_office_off', (args) => {
    seen = [args];
    return { stale: false, moods: [mood], off: { active: true }, canWrite: true, writeBlock: null };
  });
  expect((await applyOff()).off).toEqual({ active: true });
  expect(seen).toEqual([undefined]);
  mocks.set('wall2_office_off', () => ({ nothing: 1 }));
  await expect(applyOff()).rejects.toBe('failed');
  mocks.set('wall2_office_off', () => {
    throw 'on-air';
  });
  await expect(applyOff()).rejects.toBe('on-air');
});

it('the moods answer carries a nudge only for the active listed mood with percent numbers', () => {
  const moods = [
    { id: 'focus', label: 'Focus', active: true },
    { id: 'gaming', label: 'Gaming', active: false },
  ];
  const n = (nudge: unknown) => moodsOf({ moods, nudge })!.nudge;
  expect(n({ mood: 'focus', level: 62, floor: 45, step: 10 })).toEqual({ mood: 'focus', level: 62, floor: 45, step: 10 });
  expect(moodsOf({ moods })!.nudge).toBeNull();
  expect(n(null)).toBeNull();
  expect(n([1])).toBeNull();
  expect(n({ mood: 'gaming', level: 62, floor: 45, step: 10 })).toBeNull();
  expect(n({ mood: 'missing', level: 62, floor: 45, step: 10 })).toBeNull();
  expect(n({ mood: 'focus', level: 101, floor: 45, step: 10 })).toBeNull();
  expect(n({ mood: 'focus', level: 61.5, floor: 45, step: 10 })).toBeNull();
  expect(n({ mood: 'focus', level: '62', floor: 45, step: 10 })).toBeNull();
  expect(n({ mood: 'focus', level: 62, floor: -1, step: 10 })).toBeNull();
  expect(n({ mood: 'focus', level: 62, floor: 45 })).toBeNull();
});

it('nudgeMood calls its one command with only the direction and keeps the new words', async () => {
  const mood = { id: 'focus', label: 'Focus', active: true };
  let seen: unknown;
  mocks.set('wall2_office_mood_nudge', (args) => {
    seen = args;
    return { stale: false, moods: [mood], nudge: { mood: 'focus', level: 72, floor: 45, step: 10 }, canWrite: true, writeBlock: null };
  });
  expect((await nudgeMood('up')).nudge?.level).toBe(72);
  expect(seen).toEqual({ dir: 'up' });
  mocks.set('wall2_office_mood_nudge', () => ({ nothing: 1 }));
  await expect(nudgeMood('down')).rejects.toBe('failed');
  for (const word of ['no-mood', 'at-floor', 'at-max']) {
    mocks.set('wall2_office_mood_nudge', () => {
      throw word;
    });
    await expect(nudgeMood('down')).rejects.toBe(word);
    expect(homeWordOf(word)).toBe(word);
  }
});
