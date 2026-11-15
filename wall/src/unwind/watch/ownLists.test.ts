import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultLabel, parseLink, validId } from './links';
import { MAX_OWN_RECORDS, MAX_OWN_STORED, MAX_OWN_VIDEOS, newOwnId, OWN_ERRORS, OWN_KEY, parseOwn, resetOwnLists, useOwnLists } from './ownLists';
import { ADD_ERRORS, MAX_SAVED, SAVED_KEY } from './saved';
import { resetWatch, useWatchStore } from './store';
import { embedUrl, playerOrigin } from './urls';

vi.setConfig({ testTimeout: 20_000 });

const vid = (n: number) => `Vid${String(n).padStart(8, '0')}`;
const own = (n: number) => `list${String(n).padStart(8, '0')}`;
const raw = (lists: unknown, v: unknown = 1) => JSON.stringify({ v, lists });
const w = () => useOwnLists.getState();

beforeEach(() => {
  localStorage.clear();
  resetWatch();
  resetOwnLists();
});

describe('the own kind', () => {
  it('validId takes exactly 12 of a-z0-9', () => {
    expect(validId('own', 'abc123def456')).toBe(true);
    expect(validId('own', 'abc123def45')).toBe(false);
    expect(validId('own', 'abc123def4567')).toBe(false);
    expect(validId('own', 'ABC123DEF456')).toBe(false);
    expect(validId('own', 'Ab3dEfGh1jK')).toBe(false);
    expect(validId('own', 'abc123def45_')).toBe(false);
  });
  it('a pasted link never reads as own, and the offer rules stay', () => {
    for (const t of ['https://youtu.be/Ab3dEfGh1jK', 'https://www.youtube.com/playlist?list=PLmockPlaylist0001', 'twitch.tv/pixel_harbor', 'abc123def456']) {
      const r = parseLink(t);
      if (r.ok) expect(r.ref.kind).not.toBe('own');
    }
    const mix = parseLink('https://www.youtube.com/watch?v=Ab3dEfGh1jK&list=RDAb3dEfGh1jK');
    expect(mix.ok && mix.alsoList).toBeUndefined();
  });
  it('never reaches a frame address or a player origin', () => {
    const where = { origin: 'https://wall.test', hostname: 'wall.test' };
    expect(embedUrl({ kind: 'own', id: 'abc123def456' }, where)).toBeNull();
    expect(playerOrigin({ kind: 'own', id: 'abc123def456' })).toBeNull();
    expect(embedUrl({ kind: 'video', id: 'Ab3dEfGh1jK' }, where)).toContain('youtube-nocookie.com/embed/Ab3dEfGh1jK');
  });
  it('has a name and a default label', () => {
    expect(defaultLabel({ kind: 'own', id: 'abc123def456' })).toBe('My playlist');
  });
  it('makes ids that pass the shape', () => {
    for (let i = 0; i < 50; i++) expect(validId('own', newOwnId())).toBe(true);
  });
});

describe('parseOwn', () => {
  it('gives an empty store for bad input', () => {
    expect(Object.keys(parseOwn(null).lists)).toEqual([]);
    expect(Object.keys(parseOwn('{nope').lists)).toEqual([]);
    expect(Object.keys(parseOwn(raw({ [own(1)]: { items: [] } }, 2)).lists)).toEqual([]);
    expect(Object.keys(parseOwn('[]').lists)).toEqual([]);
    expect(Object.keys(parseOwn(raw([])).lists)).toEqual([]);
    expect(Object.keys(parseOwn('x'.repeat(MAX_OWN_STORED + 1)).lists)).toEqual([]);
  });
  it('keeps good lists when one list is bad', () => {
    const lists = parseOwn(raw({ [own(1)]: { items: [{ id: vid(1) }] }, [own(2)]: 'junk', [own(3)]: { items: 'no' }, bad: { items: [] }, [own(4)]: { items: [] } })).lists;
    expect(Object.keys(lists).sort()).toEqual([own(1), own(4)]);
  });
  it('drops bad items and duplicates and cuts at 50', () => {
    const items = [{ id: vid(1) }, { id: 'short' }, { id: vid(1), title: 'dup' }, null, 5, { id: 'bad id here' }, ...Array.from({ length: 60 }, (_, i) => ({ id: vid(10 + i) }))];
    const list = parseOwn(raw({ [own(1)]: { items } })).lists[own(1)];
    expect(list.items[0]).toEqual({ id: vid(1) });
    expect(list.items).toHaveLength(MAX_OWN_VIDEOS);
    expect(new Set(list.items.map((i) => i.id)).size).toBe(MAX_OWN_VIDEOS);
  });
  it('bounds seconds, cleans and cuts text, drops unknown fields', () => {
    const items = [
      { id: vid(1), seconds: 0 },
      { id: vid(2), seconds: 86_401 },
      { id: vid(3), seconds: 1.5 },
      { id: vid(4), seconds: '12' },
      { id: vid(5), seconds: 86_400 },
      { id: vid(6), seconds: 1 },
      { id: vid(7), title: `  a‮b\n${'x'.repeat(300)}`, channel: 'c'.repeat(150), extra: 'gone' },
      { id: vid(8), title: '   ', channel: 5 },
    ];
    const got = parseOwn(raw({ [own(1)]: { items, shuffle: 'true', repeat: true, other: 1 } })).lists[own(1)];
    expect(got.items.map((i) => i.seconds)).toEqual([undefined, undefined, undefined, undefined, 86_400, 1, undefined, undefined]);
    expect(got.items[6].title!.length).toBe(200);
    expect(got.items[6].title!.startsWith('ab x')).toBe(true);
    expect(got.items[6].channel!.length).toBe(100);
    expect(Object.keys(got.items[6]).sort()).toEqual(['channel', 'id', 'title']);
    expect(got.items[7]).toEqual({ id: vid(8) });
    expect(got.shuffle).toBe(false);
    expect(got.repeat).toBe(true);
    expect(Object.keys(got).sort()).toEqual(['items', 'repeat', 'shuffle']);
  });
  it('treats a prototype key as only a key', () => {
    const lists = parseOwn('{"v":1,"lists":{"__proto__":{"items":[]},"constructor":{"items":[]}}}').lists;
    expect(Object.keys(lists)).toEqual([]);
    expect(({} as Record<string, unknown>).items).toBeUndefined();
  });
});

describe('the lists store', () => {
  it('create adds the entry and the record', () => {
    const r = w().create('Wind down', { id: vid(1), title: 'One' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const entry = useWatchStore.getState().saved.find((i) => i.kind === 'own' && i.id === r.id);
    expect(entry?.label).toBe('Wind down');
    expect(w().lists[r.id].items).toEqual([{ id: vid(1), title: 'One' }]);
    expect(JSON.parse(localStorage.getItem(OWN_KEY)!).lists[r.id].items).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(SAVED_KEY)!)[0]).toEqual({ kind: 'own', id: r.id, label: 'Wind down' });
  });
  it('create refuses at 24 entries', () => {
    const items = Array.from({ length: MAX_SAVED }, (_, i) => ({ kind: 'video', id: vid(i), label: `v${i}` }));
    localStorage.setItem(SAVED_KEY, JSON.stringify(items));
    resetWatch();
    const r = w().create('x');
    expect(r).toEqual({ ok: false, error: ADD_ERRORS.full });
    expect(useWatchStore.getState().saved).toHaveLength(MAX_SAVED);
  });
  it('an empty name falls back to the default label', () => {
    const r = w().create('   ');
    expect(r.ok && useWatchStore.getState().saved[0].label).toBe('My playlist');
  });
  it('addVideo refuses a duplicate and a full list', () => {
    const r = w().create('L');
    if (!r.ok) throw new Error('create');
    expect(w().addVideo(r.id, { id: vid(1) })).toBeNull();
    expect(w().addVideo(r.id, { id: vid(1) })).toBe(OWN_ERRORS.dup);
    for (let i = 2; i <= MAX_OWN_VIDEOS; i++) expect(w().addVideo(r.id, { id: vid(i) })).toBeNull();
    expect(w().addVideo(r.id, { id: vid(99) })).toBe(OWN_ERRORS.full);
    expect(w().lists[r.id].items).toHaveLength(MAX_OWN_VIDEOS);
    expect(w().addVideo(r.id, { id: 'not a video' })).not.toBeNull();
  });
  it('removeVideo and move', () => {
    const r = w().create('L');
    if (!r.ok) throw new Error('create');
    for (let i = 1; i <= 5; i++) w().addVideo(r.id, { id: vid(i) });
    w().move(r.id, 3, 1);
    expect(w().lists[r.id].items.map((i) => i.id)).toEqual([vid(1), vid(4), vid(2), vid(3), vid(5)]);
    w().move(r.id, 0, 9);
    w().move(r.id, 2, 2);
    expect(w().lists[r.id].items.map((i) => i.id)).toEqual([vid(1), vid(4), vid(2), vid(3), vid(5)]);
    w().removeVideo(r.id, vid(4));
    expect(w().lists[r.id].items.map((i) => i.id)).toEqual([vid(1), vid(2), vid(3), vid(5)]);
  });
  it('shuffle and repeat are stored at once', () => {
    const r = w().create('L');
    if (!r.ok) throw new Error('create');
    w().setShuffle(r.id, true);
    w().setRepeat(r.id, true);
    const stored = JSON.parse(localStorage.getItem(OWN_KEY)!).lists[r.id];
    expect(stored.shuffle).toBe(true);
    expect(stored.repeat).toBe(true);
  });
  it('deleteList removes the entry and the record together', () => {
    const r = w().create('L', { id: vid(1) });
    if (!r.ok) throw new Error('create');
    w().deleteList(r.id);
    expect(w().lists[r.id]).toBeUndefined();
    expect(useWatchStore.getState().saved).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(OWN_KEY)!).lists[r.id]).toBeUndefined();
  });
  it('ignores an orphan record and keeps it', () => {
    localStorage.setItem(OWN_KEY, raw({ [own(1)]: { items: [{ id: vid(1) }] } }));
    resetOwnLists();
    const r = w().create('L');
    if (!r.ok) throw new Error('create');
    expect(useWatchStore.getState().saved.some((i) => i.id === own(1))).toBe(false);
    expect(JSON.parse(localStorage.getItem(OWN_KEY)!).lists[own(1)].items).toHaveLength(1);
  });
  it('writes at most 48 records, those with an entry first', () => {
    const lists: Record<string, unknown> = {};
    for (let i = 0; i < 60; i++) lists[own(i)] = { items: [] };
    localStorage.setItem(OWN_KEY, raw(lists));
    resetOwnLists();
    const r = w().create('Mine');
    if (!r.ok) throw new Error('create');
    const stored = JSON.parse(localStorage.getItem(OWN_KEY)!).lists;
    expect(Object.keys(stored)).toHaveLength(MAX_OWN_RECORDS);
    expect(stored[r.id]).toBeDefined();
  });
  it('learn fills absent fields only and writes once', () => {
    const r = w().create('L', { id: vid(1), title: 'Mine' });
    const r2 = w().create('M', { id: vid(1) });
    if (!r.ok || !r2.ok) throw new Error('create');
    const set = vi.spyOn(Storage.prototype, 'setItem');
    w().learn(vid(1), { title: 'Reported', channel: 'Chan', seconds: 120 });
    expect(set).toHaveBeenCalledTimes(1);
    expect(w().lists[r.id].items[0]).toEqual({ id: vid(1), title: 'Mine', channel: 'Chan', seconds: 120 });
    expect(w().lists[r2.id].items[0]).toEqual({ id: vid(1), title: 'Reported', channel: 'Chan', seconds: 120 });
    w().learn(vid(1), { title: 'Again', channel: 'Other', seconds: 5 });
    w().learn(vid(2), { title: 'Elsewhere' });
    w().learn(vid(1), {});
    expect(set).toHaveBeenCalledTimes(1);
    set.mockRestore();
  });
});
