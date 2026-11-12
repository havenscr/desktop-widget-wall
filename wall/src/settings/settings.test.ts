import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, SETTINGS_KEY } from './settings';

const store = (value: string | null) => ({ getItem: (k: string) => (k === SETTINGS_KEY ? value : null) });

it('defaults when nothing is saved', () => {
  expect(loadSettings(store(null))).toEqual({ latitude: 47.68, longitude: -122.21 });
  expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
});

it('overrides field by field and ignores bad values', () => {
  expect(loadSettings(store('{"latitude":40.7}'))).toEqual({ latitude: 40.7, longitude: -122.21 });
  expect(loadSettings(store('{"latitude":"x","longitude":999}'))).toEqual(DEFAULT_SETTINGS);
  expect(loadSettings(store('not json'))).toEqual(DEFAULT_SETTINGS);
});
