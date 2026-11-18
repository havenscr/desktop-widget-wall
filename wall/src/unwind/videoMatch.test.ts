import { expect, it } from 'vitest';
import { savedVideoMatch } from './videoMatch';

const SAVED = [
  { kind: 'video' as const, id: 'Ab3dEfGh1jK', label: 'Night drive mix' },
  { kind: 'live' as const, id: 'Lofi_Live01', label: 'Lofi radio' },
  { kind: 'twitch' as const, id: 'pixel_harbor', label: 'Pixel harbor' },
];

it('matches a saved video or live stream by its exact title in a YouTube player', () => {
  expect(savedVideoMatch('Night drive mix - YouTube', 'Edge', SAVED)).toBe(true);
  expect(savedVideoMatch('Night drive mix - YouTube', 'Chrome', SAVED)).toBe(true);
  expect(savedVideoMatch('Lofi radio', 'YouTube Music', SAVED)).toBe(true);
});

it('is no match for another title, a near title, a Twitch item or no list', () => {
  expect(savedVideoMatch('Tokyo Burnout', 'Edge', SAVED)).toBe(false);
  expect(savedVideoMatch('Night drive', 'Edge', SAVED)).toBe(false);
  expect(savedVideoMatch('Pixel harbor', 'Edge', SAVED)).toBe(false);
  expect(savedVideoMatch('Night drive mix', 'Edge', [])).toBe(false);
  expect(savedVideoMatch('', 'Edge', SAVED)).toBe(false);
  expect(savedVideoMatch(undefined, 'Edge', SAVED)).toBe(false);
});

it('is never a match in an audio app or an unknown source, even with the same title', () => {
  expect(savedVideoMatch('Night drive mix', 'Spotify', SAVED)).toBe(false);
  expect(savedVideoMatch('Night drive mix', '', SAVED)).toBe(false);
  expect(savedVideoMatch('Night drive mix', null, SAVED)).toBe(false);
});

it('ignores an item still carrying its default label', () => {
  expect(savedVideoMatch('YouTube video', 'Edge', [{ kind: 'video', id: 'Ab3dEfGh1jK', label: 'YouTube video' }])).toBe(false);
});

it('matches a browser only when the tab is YouTube, but the YouTube Music app by title alone', () => {
  expect(savedVideoMatch('Night drive mix', 'Edge', SAVED)).toBe(false);
  expect(savedVideoMatch('Night drive mix - Some Site', 'Chrome', SAVED)).toBe(false);
  expect(savedVideoMatch('Night drive mix - YouTube', 'Firefox', SAVED)).toBe(true);
  expect(savedVideoMatch('Night drive mix', 'YouTube Music', SAVED)).toBe(true);
});
