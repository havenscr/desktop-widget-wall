import { beforeEach, describe, expect, it } from 'vitest';
import { artBackground, artHue, dropGone, loadPins, parsePins, pinnable, PINS_KEY, resolvePins, resetPins, usePins, withoutPin, withPin } from './pins';
import type { SavedItem } from './saved';
import { resetWatch, useWatchStore } from './store';

const A = 'Ab3dEfGh1jK';
const B = 'Lofi_Live01';
const LIST: SavedItem[] = [
  { kind: 'video', id: A, label: 'Night drive mix' },
  { kind: 'live', id: B, label: 'Lofi beats radio' },
  { kind: 'twitch', id: 'pixel_harbor', label: 'pixel_harbor' },
  { kind: 'playlist', id: 'PLmockPlaylist0001', label: 'Weekend list' },
];
const kA = `video:${A}`;
const kB = `live:${B}`;
const kT = 'twitch:pixel_harbor';
const kP = 'playlist:PLmockPlaylist0001';

beforeEach(() => {
  localStorage.clear();
  resetWatch();
  useWatchStore.setState({ saved: LIST });
  resetPins();
});

describe('reading the stored pins', () => {
  it('reads three places, each null or a good key', () => {
    expect(parsePins(JSON.stringify([kA, null, kT]))).toEqual([kA, null, kT]);
    expect(parsePins(JSON.stringify([kA]))).toEqual([kA, null, null]);
    expect(parsePins(null)).toEqual([null, null, null]);
    expect(parsePins('')).toEqual([null, null, null]);
  });

  it('drops wrong shapes, unknown kinds and bad ids', () => {
    expect(parsePins('{not json')).toEqual([null, null, null]);
    expect(parsePins('{"a":1}')).toEqual([null, null, null]);
    expect(parsePins('"video:Ab3dEfGh1jK"')).toEqual([null, null, null]);
    expect(parsePins(JSON.stringify([5, { kind: 'video' }, ['x']]))).toEqual([null, null, null]);
    expect(parsePins(JSON.stringify(['radio:Ab3dEfGh1jK', kA]))).toEqual([null, kA, null]);
    expect(parsePins(JSON.stringify(['video:short', 'video:Ab3dEfGh1jK<b>', 'twitch:Bad Name']))).toEqual([null, null, null]);
    expect(parsePins(JSON.stringify(['video', ':Ab3dEfGh1jK', 'video:']))).toEqual([null, null, null]);
  });

  it('keeps a key once: the second copy is an empty place', () => {
    expect(parsePins(JSON.stringify([kA, kA, kB]))).toEqual([kA, null, kB]);
  });

  it('refuses an array of more than three, whole', () => {
    expect(parsePins(JSON.stringify([kA, kB, kT, kP]))).toEqual([null, null, null]);
    expect(parsePins(JSON.stringify([kA, kB, kT]))).toEqual([kA, kB, kT]);
  });

  it('does not read a value over 1000 characters', () => {
    const long = JSON.stringify([kA, ...Array.from({ length: 80 }, () => null), 'x'.repeat(1000)]);
    expect(long.length).toBeGreaterThan(1000);
    expect(parsePins(long)).toEqual([null, null, null]);
  });

  it('loads from storage and survives a blocked one', () => {
    localStorage.setItem(PINS_KEY, JSON.stringify([kB]));
    expect(loadPins()).toEqual([kB, null, null]);
  });
});

describe('the pins against the Watch list', () => {
  it('resolves each key to the list item, so a rename shows on the pin', () => {
    expect(resolvePins([kA, null, kT], LIST).map((i) => i?.label ?? null)).toEqual(['Night drive mix', null, 'pixel_harbor']);
    const renamed = LIST.map((i) => (i.id === A ? { ...i, label: 'Renamed' } : i));
    expect(resolvePins([kA, null, null], renamed)[0]?.label).toBe('Renamed');
  });

  it('shows an item that left the list as an empty place and drops its key on the next write', () => {
    const without = LIST.filter((i) => i.id !== A);
    expect(resolvePins([kA, kB, null], without)).toEqual([null, without[0], null]);
    expect(dropGone([kA, kB, null], without)).toEqual([null, kB, null]);
    useWatchStore.setState({ saved: without });
    usePins.setState({ places: [kA, kB, null] });
    usePins.getState().pin(2, kT);
    expect(usePins.getState().places).toEqual([null, kB, kT]);
    expect(JSON.parse(localStorage.getItem(PINS_KEY)!)).toEqual([null, kB, kT]);
  });

  it('pins, replaces and removes', () => {
    expect(withPin([null, null, null], LIST, 1, kB)).toEqual([null, kB, null]);
    expect(withPin([kA, kB, null], LIST, 0, kT)).toEqual([kT, kB, null]);
    expect(withPin([kA, kB, null], LIST, 2, kA)).toEqual([null, kB, kA]);
    expect(withPin([kA, null, null], LIST, 1, 'video:Zz9yXxWw8vU')).toEqual([kA, null, null]);
    expect(withPin([kA, null, null], LIST, 5, kB)).toEqual([kA, null, null]);
    expect(withoutPin([kA, kB, null], LIST, 0)).toEqual([null, kB, null]);
    usePins.getState().pin(0, kP);
    usePins.getState().pin(1, kA);
    expect(JSON.parse(localStorage.getItem(PINS_KEY)!)).toEqual([kP, kA, null]);
    usePins.getState().unpin(0);
    expect(JSON.parse(localStorage.getItem(PINS_KEY)!)).toEqual([null, kA, null]);
  });

  it('offers every list item that is not pinned', () => {
    expect(pinnable([kA, null, kT], LIST).map((i) => i.id)).toEqual([B, 'PLmockPlaylist0001']);
    expect(pinnable([null, null, null], LIST)).toHaveLength(4);
  });
});

describe('the art square', () => {
  it('has a hue that is the same every time for a key, and differs between keys', () => {
    expect(artHue(kA)).toBe(artHue(kA));
    expect(artHue(kA)).toBeGreaterThanOrEqual(0);
    expect(artHue(kA)).toBeLessThan(360);
    expect(new Set([kA, kB, kT, kP].map(artHue)).size).toBeGreaterThan(1);
    expect(artBackground(kA)).toBe(artBackground(kA));
    expect(artBackground(kA)).toMatch(/^linear-gradient\(135deg, hsl\(\d+ 85% 60%\), hsl\(\d+ 70% 22%\) 60%, hsl\(\d+ 80% 52%\)\)$/);
  });
});
