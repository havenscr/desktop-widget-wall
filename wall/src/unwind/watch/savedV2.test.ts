import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addSaved, BACKUP_KEY, cleanTags, LEGACY_MAX, loadSaved, MAX_SAVED, noteMeta, notePlay, parseSaved, saveSaved, SAVED_KEY, tagSaved, type SavedItem } from './saved';
import { resetWatch, useWatchStore } from './store';

const V = 'Ab3dEfGh1jK';
const T0 = Date.UTC(2026, 5, 1);

const entry = (extra: Record<string, unknown> = {}) => ({ kind: 'video', id: V, label: 'Night drive', ...extra });
const one = (extra: Record<string, unknown>) => parseSaved(JSON.stringify([entry(extra)]))[0];
const many = (n: number): SavedItem[] => Array.from({ length: n }, (_, i) => ({ kind: 'twitch' as const, id: `chan_${i}`, label: `c${i}` }));

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe('saved data v2: reading', () => {
  it('reads an old record unchanged, with no new field', () => {
    const v1 = JSON.stringify([entry(), { kind: 'twitch', id: 'abc', label: 'abc', named: true }]);
    expect(parseSaved(v1)).toEqual([entry(), { kind: 'twitch', id: 'abc', label: 'abc', named: true }]);
  });

  it('keeps every good field', () => {
    const all = { addedAt: T0, lastPlayedAt: T0 + 5, plays: 3, seconds: 215, views: 1200, tags: ['lofi', 'focus'] };
    expect(one(all)).toEqual({ ...entry(), ...all });
  });

  it('drops a bad field alone and keeps the record and its other fields', () => {
    const good = { addedAt: T0, lastPlayedAt: T0, plays: 2, seconds: 60, views: 9, tags: ['a'] };
    const bad: Record<string, unknown[]> = {
      addedAt: ['x', -1, 1.5, Date.UTC(2019, 11, 31), Date.now() + 3 * 86_400_000, null, NaN],
      lastPlayedAt: ['x', 0, 2.5, Date.UTC(2019, 0, 1), Date.now() + 3 * 86_400_000],
      plays: ['3', -1, 1.5, null, Infinity],
      seconds: ['9', -5, 0.5, null],
      views: ['9', -5, 0.5, null],
      tags: ['lofi', 5, [], [''], [3, null]],
    };
    for (const [field, values] of Object.entries(bad))
      for (const value of values) {
        const got = one({ ...good, [field]: value });
        expect(got, `${field}=${String(value)}`).toBeDefined();
        const { [field as keyof typeof good]: _gone, ...rest } = good;
        expect(got).toEqual({ ...entry(), ...rest });
      }
  });

  it('cleans tags: leading #, one line, 24 characters, no repeats in any case, at most 8', () => {
    expect(cleanTags(['#Lofi', 'lofi', '  ##focus  ', '', '#', 'a\nb', 'x'.repeat(40)])).toEqual(['Lofi', 'focus', 'a b', 'x'.repeat(24)]);
    expect(cleanTags(Array.from({ length: 12 }, (_, i) => `t${i}`))).toHaveLength(8);
    expect(cleanTags('nope')).toBeUndefined();
    expect(cleanTags([])).toBeUndefined();
  });
});

describe('saved data v2: size', () => {
  it('holds 200, not more', () => {
    expect(MAX_SAVED).toBe(200);
    expect(parseSaved(JSON.stringify(many(260)))).toHaveLength(200);
    saveSaved(many(260));
    expect(JSON.parse(localStorage.getItem(SAVED_KEY)!)).toHaveLength(200);
  });

  it('reads 200 records of full size and refuses stored text past the limit', () => {
    const fat = Array.from({ length: 200 }, (_, i) => entry({ id: `Fat${String(i).padStart(8, '0')}`, label: 'L'.repeat(60), tags: ['aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbb'], addedAt: T0, lastPlayedAt: T0, plays: 99999, seconds: 99999, views: 999999999 }));
    const text = JSON.stringify(fat);
    expect(text.length).toBeGreaterThan(32_000);
    expect(parseSaved(text)).toHaveLength(200);
    expect(parseSaved('x'.repeat(256_001))).toEqual([]);
  });

  it('says the list is full at 200', () => {
    expect(addSaved(many(200), { kind: 'video', id: V }).ok).toBe(false);
    expect(addSaved(many(199), { kind: 'video', id: V }).ok).toBe(true);
  });
});

describe('saved data v2: writing', () => {
  it('round-trips a v1 list byte for byte', () => {
    const v1 = JSON.stringify([entry(), { kind: 'twitch', id: 'abc', label: 'abc', named: true }]);
    localStorage.setItem(SAVED_KEY, v1);
    saveSaved(loadSaved());
    expect(localStorage.getItem(SAVED_KEY)).toBe(v1);
  });

  it('round-trips the new fields', () => {
    const items = [{ ...entry(), addedAt: T0, plays: 2, seconds: 30, views: 5, tags: ['a'] }] as SavedItem[];
    saveSaved(items);
    expect(loadSaved()).toEqual(items);
  });

  it('writes the backup once, the first time a list is longer than the old limit', () => {
    saveSaved(many(LEGACY_MAX));
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull();
    const full = many(LEGACY_MAX + 5);
    saveSaved(full);
    const backup = localStorage.getItem(BACKUP_KEY);
    expect(backup).toBe(localStorage.getItem(SAVED_KEY));
    expect(JSON.parse(backup!)).toHaveLength(LEGACY_MAX + 5);
    saveSaved(many(LEGACY_MAX + 9));
    expect(localStorage.getItem(BACKUP_KEY)).toBe(backup);
  });
});

describe('saved data v2: stats', () => {
  it('adds with the time, length and views when given, and without them otherwise', () => {
    const r = addSaved([], { kind: 'video', id: V }, { seconds: 215, views: 1200 }, T0);
    expect(r.ok && r.added).toEqual({ kind: 'video', id: V, label: 'YouTube video', addedAt: T0, seconds: 215, views: 1200 });
    const bare = addSaved([], { kind: 'video', id: V });
    expect(bare.ok && bare.added).toEqual({ kind: 'video', id: V, label: 'YouTube video' });
  });

  it('counts a play and keeps the others as they were', () => {
    const items = [{ ...entry() }, ...many(1)] as SavedItem[];
    const next = notePlay(items, `video:${V}`, T0);
    expect(next[0]).toMatchObject({ plays: 1, lastPlayedAt: T0 });
    expect(next[1]).toBe(items[1]);
    expect(notePlay(next, `video:${V}`, T0 + 1)[0]).toMatchObject({ plays: 2, lastPlayedAt: T0 + 1 });
  });

  it('fills a missing length and view count and never overwrites one', () => {
    const items = [{ ...entry(), seconds: 10 }] as SavedItem[];
    expect(noteMeta(items, `video:${V}`, { seconds: 99, views: 7 })[0]).toMatchObject({ seconds: 10, views: 7 });
    expect(noteMeta(items, `video:${V}`, { seconds: 99 })).toBe(items);
  });

  it('sets tags cleaned, and none removes the field', () => {
    const items = [entry()] as SavedItem[];
    const t = tagSaved(items, `video:${V}`, ['#Lofi', 'lofi']);
    expect(t[0].tags).toEqual(['Lofi']);
    expect('tags' in tagSaved(t, `video:${V}`, [])[0]).toBe(false);
  });
});

describe('saved data v2: the store', () => {
  beforeEach(() => {
    localStorage.setItem(SAVED_KEY, JSON.stringify([entry(), { kind: 'twitch', id: 'abc', label: 'abc' }]));
    resetWatch();
  });

  it('stamps addedAt on a new item and keeps the length and views a save carries', () => {
    expect(useWatchStore.getState().addRef({ kind: 'video', id: 'Zz9yXxWw8vU' }, false, { seconds: 90, views: 4 })).toBeNull();
    const added = useWatchStore.getState().saved[0];
    expect(added).toMatchObject({ id: 'Zz9yXxWw8vU', seconds: 90, views: 4 });
    expect(added.addedAt).toBeGreaterThan(Date.UTC(2020, 0, 1));
    expect(parseSaved(localStorage.getItem(SAVED_KEY))[0]).toEqual(added);
  });

  it('records a play from a saved row, in state and in storage', () => {
    useWatchStore.getState().play({ kind: 'video', id: V });
    const item = useWatchStore.getState().saved.find((i) => i.id === V)!;
    expect(item.plays).toBe(1);
    expect(item.lastPlayedAt).toBeGreaterThan(Date.UTC(2020, 0, 1));
    expect(parseSaved(localStorage.getItem(SAVED_KEY)).find((i) => i.id === V)).toEqual(item);
    useWatchStore.getState().stop();
    useWatchStore.getState().play({ kind: 'video', id: V });
    expect(useWatchStore.getState().saved.find((i) => i.id === V)!.plays).toBe(2);
  });

  it('records a play from a pin that is a saved item, and none for one that is not', () => {
    expect(useWatchStore.getState().playPinned({ kind: 'video', id: V }, 'Night drive')).toBe(true);
    expect(useWatchStore.getState().saved.find((i) => i.id === V)!.plays).toBe(1);
    const before = useWatchStore.getState().saved;
    expect(useWatchStore.getState().playPinned({ kind: 'video', id: 'Zz9yXxWw8vU' }, 'Other')).toBe(true);
    expect(useWatchStore.getState().saved).toBe(before);
  });

  it('fills the length and views of a saved video from details', () => {
    useWatchStore.getState().noteMeta(`video:${V}`, { seconds: 300, views: 12 });
    expect(useWatchStore.getState().saved.find((i) => i.id === V)).toMatchObject({ seconds: 300, views: 12 });
    expect(parseSaved(localStorage.getItem(SAVED_KEY)).find((i) => i.id === V)).toMatchObject({ seconds: 300, views: 12 });
  });
});
