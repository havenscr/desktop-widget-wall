import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, SETTINGS_KEY } from './settings';

const store = (value: string | null) => ({ getItem: (k: string) => (k === SETTINGS_KEY ? value : null) });

it('defaults when nothing is saved', () => {
  expect(loadSettings(store(null))).toEqual({ latitude: 47.68, longitude: -122.21, zenDimHour: 22, zenDimWaitMin: 10, shelfLists: [] });
  expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
});

it('overrides field by field and ignores bad values', () => {
  expect(loadSettings(store('{"latitude":40.7}'))).toEqual({ ...DEFAULT_SETTINGS, latitude: 40.7 });
  expect(loadSettings(store('{"latitude":"x","longitude":999}'))).toEqual(DEFAULT_SETTINGS);
  expect(loadSettings(store('not json'))).toEqual(DEFAULT_SETTINGS);
});

it('Zen dim hour takes 18 to 23 and wait takes 1 to 60, whole numbers only', () => {
  expect(loadSettings(store('{"zenDimHour":18,"zenDimWaitMin":1}'))).toMatchObject({ zenDimHour: 18, zenDimWaitMin: 1 });
  expect(loadSettings(store('{"zenDimHour":23,"zenDimWaitMin":60}'))).toMatchObject({ zenDimHour: 23, zenDimWaitMin: 60 });
  for (const bad of ['{"zenDimHour":17}', '{"zenDimHour":24}', '{"zenDimHour":21.5}', '{"zenDimHour":"22"}', '{"zenDimWaitMin":0}', '{"zenDimWaitMin":61}', '{"zenDimWaitMin":2.5}']) {
    expect(loadSettings(store(bad))).toEqual(DEFAULT_SETTINGS);
  }
});

it('keeps the Shelf list names that are text, trimmed, at most eight', () => {
  const names = ['A', ' B ', 3, '', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
  expect(loadSettings(store(JSON.stringify({ shelfLists: names }))).shelfLists).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  expect(loadSettings(store('{"shelfLists":"x"}')).shelfLists).toEqual([]);
});

it('Shelf list names match the native rules: no control characters, 60 characters at most, no duplicates after trimming', () => {
  const long60 = 'x'.repeat(60);
  const names = ['A', ' A ', 'bad\nname', 'tab\tname', 'nul\u0000', 'x'.repeat(61), ' ' + long60 + ' ', 'B', 'A'];
  expect(loadSettings(store(JSON.stringify({ shelfLists: names }))).shelfLists).toEqual(['A', long60, 'B']);
  const nine = ['1', '2', '3', '4', '5', '6', '7', '8', '8', '9'];
  expect(loadSettings(store(JSON.stringify({ shelfLists: nine }))).shelfLists).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
});
