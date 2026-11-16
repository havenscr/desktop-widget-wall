import { afterEach, expect, it } from 'vitest';
import { mocks } from '../bridge/tauri';
import { applyMood, applyPreset, forgetToken, goNormal, HOME_WORDS, homeWordOf, moodsOf, readMoods, readTokenStatus, saveToken, setGroup, setHomeKeys, studioOf } from './home';
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
  expect((await applyMood('focus')).moods[0].id).toBe('focus');
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
