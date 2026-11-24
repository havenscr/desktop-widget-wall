import { afterEach, beforeEach, expect, it } from 'vitest';
import { mocks } from './tauri';
import { readSonosFavorites, playSonosFavorite } from './sonosFavorites';
import { registerSonosMocks } from './devMocks/sonos';

let calls: Array<[string, unknown]> = [];
beforeEach(() => {
  calls = [];
});
afterEach(() => {
  mocks.clear();
  window.history.replaceState({}, '', '/');
});

it('reads the list with the one command and no arguments', async () => {
  const list = [{ id: '0a1b2c3d4e5f6071', name: 'Quiet Radio', kind: 'radio' }];
  mocks.set('wall2_sonos_favorites', (args) => {
    calls.push(['wall2_sonos_favorites', args]);
    return list;
  });
  await expect(readSonosFavorites()).resolves.toEqual(list);
  expect(calls).toEqual([['wall2_sonos_favorites', undefined]]);
});

it('plays by id only, adding confirm only when asked', async () => {
  mocks.set('wall2_sonos_favorite_play', (args) => {
    calls.push(['wall2_sonos_favorite_play', args]);
  });
  await playSonosFavorite('0a1b2c3d4e5f6071');
  await playSonosFavorite('0a1b2c3d4e5f6071', true);
  expect(calls).toEqual([
    ['wall2_sonos_favorite_play', { favoriteId: '0a1b2c3d4e5f6071' }],
    ['wall2_sonos_favorite_play', { favoriteId: '0a1b2c3d4e5f6071', confirm: true }],
  ]);
});

it('passes a fixed error word through unchanged', async () => {
  mocks.set('wall2_sonos_favorites', () => Promise.reject(new Error('timed-out')));
  await expect(readSonosFavorites()).rejects.toThrow('timed-out');
});

it('the dev mocks give eight favorites, two of them long, and play one by id', async () => {
  registerSonosMocks();
  const list = await readSonosFavorites();
  expect(list).toHaveLength(8);
  expect(list.filter((f) => f.name.length > 80)).toHaveLength(2);
  expect(list.every((f) => /^[0-9a-f]{16}$/.test(f.id))).toBe(true);
  await expect(playSonosFavorite(list[0].id)).resolves.toBeUndefined();
  await expect(playSonosFavorite('nope')).rejects.toThrow('Unknown favorite');
});

it('each mock knob answers its fixed word', async () => {
  registerSonosMocks();
  const id = '0a1b2c3d4e5f6071';
  const knobs: Array<[string, 'list' | 'play', string]> = [
    ['timeout', 'list', 'timed-out'],
    ['dropped', 'list', 'no-answer'],
    ['garbled', 'list', 'bad-answer'],
    ['stale', 'play', 'Sonos status is out of date'],
    ['noroom', 'play', 'No room to play on'],
    ['refused', 'play', 'Sonos could not do that'],
    ['unreachable', 'play', 'Could not reach Sonos'],
    ['confirm', 'play', 'needs-confirm'],
  ];
  for (const [k, what, word] of knobs) {
    window.history.replaceState({}, '', `/?favs=${k}`);
    await expect(what === 'list' ? readSonosFavorites() : playSonosFavorite(id)).rejects.toThrow(word);
  }
  window.history.replaceState({}, '', '/?favs=confirm');
  await expect(playSonosFavorite(id, true)).resolves.toBeUndefined();
  window.history.replaceState({}, '', '/?favs=empty');
  await expect(readSonosFavorites()).resolves.toEqual([]);
});
