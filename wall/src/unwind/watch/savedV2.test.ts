import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addSaved, BACKUP_KEY, oldShape, OLD_BUILD_MAX, RAW_SLOTS, cleanTags, LEGACY_MAX, loadSaved, MAX_PLAYS, MAX_SAVED, MAX_SECONDS, MAX_VIEWS, noteMeta, notePlay, parseSaved, RAW_BACKUP_KEY, saveSaved, SAVED_KEY, tagSaved, type SavedItem } from './saved';
import { resetWatch, useWatchStore } from './store';
import { playOwn } from './ownPlay';
import { useOwnLists } from './ownLists';

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
      addedAt: ['x', -1, 1.5, Date.UTC(2019, 11, 31), null, NaN],
      lastPlayedAt: ['x', 0, 2.5, Date.UTC(2019, 0, 1)],
      plays: ['3', -1, 1.5, null, Infinity, MAX_PLAYS + 1],
      seconds: ['9', -5, 0.5, null, MAX_SECONDS + 1],
      views: ['9', -5, 0.5, null, MAX_VIEWS + 1],
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

  it('keeps a v1 shaped copy of a long list, refreshed on every save', () => {
    saveSaved(many(LEGACY_MAX));
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull();
    saveSaved(many(LEGACY_MAX + 5));
    expect(JSON.parse(localStorage.getItem(BACKUP_KEY)!)).toHaveLength(LEGACY_MAX + 5);
    const more = [...many(LEGACY_MAX + 9)].map((i, n) => (n === 0 ? { ...i, plays: 4, addedAt: T0 } : i));
    saveSaved(more);
    const copy = JSON.parse(localStorage.getItem(BACKUP_KEY)!);
    expect(copy).toHaveLength(LEGACY_MAX + 9);
    expect(copy[0]).toEqual({ kind: 'twitch', id: 'chan_0', label: 'c0' });
  });

  it('keeps the old shape copy within what an old build reads, first entries in order', () => {
    const fat = Array.from({ length: 200 }, (_, i) => ({ kind: 'twitch' as const, id: `chan_${i}`, label: '"'.repeat(60), named: true as const }));
    expect(JSON.stringify(fat.map(({ kind, id, label, named }) => ({ kind, id, label, named }))).length).toBeGreaterThan(OLD_BUILD_MAX);
    const text = oldShape(fat);
    expect(text.length).toBeLessThanOrEqual(OLD_BUILD_MAX);
    const kept = JSON.parse(text);
    expect(kept.length).toBeGreaterThan(24);
    expect(kept.length).toBeLessThan(200);
    expect(kept.map((i: { id: string }) => i.id)).toEqual(fat.slice(0, kept.length).map((i) => i.id));
    saveSaved(fat);
    expect(localStorage.getItem(BACKUP_KEY)).toBe(text);
    expect(parseSaved(text)).toHaveLength(kept.length);
  });

  it('never removes the old shape copy: a shorter list leaves it as it is', () => {
    saveSaved(many(LEGACY_MAX + 5));
    const long = localStorage.getItem(BACKUP_KEY);
    expect(long).not.toBeNull();
    saveSaved(many(LEGACY_MAX));
    saveSaved(many(1));
    expect(localStorage.getItem(BACKUP_KEY)).toBe(long);
  });

  it('keeps the long copy when the main key was corrupt or empty and one item is added', () => {
    saveSaved(many(40));
    const long = localStorage.getItem(BACKUP_KEY);
    for (const bad of ['{broken', '']) {
      localStorage.setItem(SAVED_KEY, bad);
      resetWatch();
      expect(useWatchStore.getState().saved).toEqual([]);
      expect(useWatchStore.getState().addRef({ kind: 'video', id: V }, false)).toBeNull();
      expect(localStorage.getItem(BACKUP_KEY)).toBe(long);
    }
  });

  it('keeps the long copy after an old build cut the list to 24 and this build saves', () => {
    saveSaved(many(40));
    const long = localStorage.getItem(BACKUP_KEY);
    localStorage.setItem(SAVED_KEY, JSON.stringify(many(LEGACY_MAX).map(({ kind, id, label }) => ({ kind, id, label }))));
    resetWatch();
    expect(useWatchStore.getState().saved).toHaveLength(LEGACY_MAX);
    useWatchStore.getState().rename('twitch:chan_0', 'Renamed');
    expect(localStorage.getItem(BACKUP_KEY)).toBe(long);
  });

  it('does not refresh the copy from a save whose stored text did not read back whole', () => {
    saveSaved(many(40));
    const long = localStorage.getItem(BACKUP_KEY);
    localStorage.setItem(SAVED_KEY, 'broken');
    saveSaved(many(60));
    expect(localStorage.getItem(BACKUP_KEY)).toBe(long);
    saveSaved(many(61));
    expect(JSON.parse(localStorage.getItem(BACKUP_KEY)!)).toHaveLength(61);
  });

  it('writes the list even when the copy cannot be written', () => {
    const real = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === BACKUP_KEY) throw new Error('quota');
      real.call(this, k, v);
    });
    saveSaved(many(LEGACY_MAX + 5));
    spy.mockRestore();
    expect(JSON.parse(localStorage.getItem(SAVED_KEY)!)).toHaveLength(LEGACY_MAX + 5);
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull();
  });
});

describe('saved data v2: a list that did not read back whole is kept', () => {
  const good = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: 'twitch', id: `chan_${i}`, label: `c${i}` }));

  it('keeps the good entries of a list with bad ones mixed in', () => {
    const raw = JSON.stringify([good(1)[0], null, 'x', { kind: 'video', id: 'bad' }, entry({ plays: 'x', views: 7 }), { kind: 'nope', id: V }]);
    expect(parseSaved(raw)).toEqual([good(1)[0], entry({ views: 7 })]);
  });

  it('copies broken JSON to the raw key before the next save, once, and never overwrites that copy', () => {
    localStorage.setItem(SAVED_KEY, '[{"kind":"video","id":"' + V + '","label":"Night"');
    const broken = localStorage.getItem(SAVED_KEY);
    saveSaved(many(1));
    expect(localStorage.getItem(RAW_BACKUP_KEY)).toBe(broken);
    localStorage.setItem(SAVED_KEY, 'also broken');
    saveSaved(many(2));
    expect(localStorage.getItem(RAW_BACKUP_KEY)).toBe(broken);
    expect(localStorage.getItem(`${RAW_BACKUP_KEY}-2`)).toBe('also broken');
  });

  it('keeps every distinct lossy original, one slot each, and none twice', () => {
    for (let n = 1; n <= RAW_SLOTS; n++) {
      localStorage.setItem(SAVED_KEY, `broken ${n}`);
      saveSaved(many(1));
    }
    const held = Array.from({ length: RAW_SLOTS }, (_, n) => localStorage.getItem(n === 0 ? RAW_BACKUP_KEY : `${RAW_BACKUP_KEY}-${n + 1}`));
    expect(held).toEqual(['broken 1', 'broken 2', 'broken 3', 'broken 4']);
    localStorage.setItem(SAVED_KEY, 'broken 2');
    saveSaved(many(1));
    expect(JSON.parse(localStorage.getItem(SAVED_KEY)!)).toHaveLength(1);
    expect(localStorage.getItem(`${RAW_BACKUP_KEY}-${RAW_SLOTS + 1}`)).toBeNull();
  });

  it('leaves storage alone when every slot holds other text', () => {
    for (let n = 1; n <= RAW_SLOTS; n++) {
      localStorage.setItem(SAVED_KEY, `broken ${n}`);
      saveSaved(many(1));
    }
    localStorage.setItem(SAVED_KEY, 'broken new');
    saveSaved(many(1));
    expect(localStorage.getItem(SAVED_KEY)).toBe('broken new');
  });

  it('treats an empty stored value as nothing to copy', () => {
    localStorage.setItem(SAVED_KEY, '');
    saveSaved(many(1));
    expect(localStorage.getItem(RAW_BACKUP_KEY)).toBeNull();
  });

  it('copies oversized text, a non-list, and a list with dropped entries', () => {
    for (const raw of ['x'.repeat(300_000), '{"a":1}', JSON.stringify([...good(3), { kind: 'video', id: 'bad', label: 'lost' }])]) {
      localStorage.clear();
      localStorage.setItem(SAVED_KEY, raw);
      saveSaved(many(1));
      expect(localStorage.getItem(RAW_BACKUP_KEY), raw.slice(0, 20)).toBe(raw);
    }
  });

  it('keeps entries 201 to 210 of over-cap storage in the raw copy', () => {
    const raw = JSON.stringify(good(210));
    localStorage.setItem(SAVED_KEY, raw);
    const items = loadSaved();
    expect(items).toHaveLength(200);
    saveSaved(items);
    expect(localStorage.getItem(RAW_BACKUP_KEY)).toBe(raw);
    expect(JSON.parse(localStorage.getItem(SAVED_KEY)!)).toHaveLength(200);
  });

  it('makes no raw copy for text that read back whole, nor for nothing stored', () => {
    saveSaved(many(2));
    saveSaved(many(3));
    expect(localStorage.getItem(RAW_BACKUP_KEY)).toBeNull();
  });

  it('leaves storage alone when the raw copy cannot be written', () => {
    const raw = 'not json';
    localStorage.setItem(SAVED_KEY, raw);
    const real = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === RAW_BACKUP_KEY) throw new Error('quota');
      real.call(this, k, v);
    });
    saveSaved(many(1));
    spy.mockRestore();
    expect(localStorage.getItem(SAVED_KEY)).toBe(raw);
  });

  it('keeps a time stamp in the future on read, and drops it on write', () => {
    const future = Date.now() + 5 * 86_400_000;
    expect(one({ addedAt: future })).toMatchObject({ addedAt: future });
    saveSaved([{ ...entry(), addedAt: future }] as SavedItem[]);
    expect(JSON.parse(localStorage.getItem(SAVED_KEY)!)[0]).toEqual(entry());
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
  it('records a play of an own playlist and keeps playing the recorded item', () => {
    localStorage.setItem(SAVED_KEY, JSON.stringify([{ kind: 'own', id: 'abcdefghijkl', label: 'Mine', named: true }, entry()]));
    resetWatch();
    useOwnLists.setState({ lists: { abcdefghijkl: { items: [{ id: V, title: 'One' }], shuffle: false, repeat: false } } });
    expect(playOwn('abcdefghijkl')).toBe(true);
    const item = useWatchStore.getState().saved.find((i) => i.kind === 'own')!;
    expect(item.plays).toBe(1);
    expect(item.lastPlayedAt).toBeGreaterThan(Date.UTC(2020, 0, 1));
    expect(parseSaved(localStorage.getItem(SAVED_KEY)).find((i) => i.kind === 'own')).toEqual(item);
  });

  it('play leaves the playing item with its recorded plays', () => {
    localStorage.setItem(SAVED_KEY, JSON.stringify([entry()]));
    resetWatch();
    useWatchStore.getState().play({ kind: 'video', id: V });
    expect(useWatchStore.getState().playing).toEqual(useWatchStore.getState().saved[0]);
    expect(useWatchStore.getState().playing?.plays).toBe(1);
  });

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
