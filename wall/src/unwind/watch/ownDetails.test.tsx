import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { youtube } from '../../music/youtube';
import { resetOwnDetails } from './ownDetails';
import { OWN_KEY, resetOwnLists, useOwnLists } from './ownLists';
import { SAVED_KEY } from './saved';
import { resetWatch } from './store';

const vid = (n: number) => `Vid${String(n).padStart(8, '0')}`;
const listId = 'list00000001';
beforeEach(() => {
  localStorage.clear();
  resetWatch();
  resetOwnLists();
  resetOwnDetails();
});

afterEach(() => {
  mocks.delete('wall2_youtube_status');
  mocks.delete('wall2_youtube_videos');
});

function signedIn() {
  const status = vi.fn(() => ({ setup: true, signedIn: true, reason: null, searchesLeft: 100 }));
  mocks.set('wall2_youtube_status', status);
  return status;
}

describe('own playlist details', () => {
  it('asks after an incomplete add and fills only absent fields', async () => {
    signedIn();
    const calls: unknown[] = [];
    mocks.set('wall2_youtube_videos', (args) => {
      calls.push(args?.ids);
      return [{ id: vid(1), title: 'Remote title', channel: 'Invented Channel', seconds: 240 }];
    });
    const made = useOwnLists.getState().create('List', { id: vid(1), title: 'Owner title' });
    expect(made.ok).toBe(true);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    if (!made.ok) return;
    expect(calls).toEqual([[vid(1)]]);
    expect(useOwnLists.getState().lists[made.id].items[0]).toEqual({ id: vid(1), title: 'Owner title', channel: 'Invented Channel', seconds: 240 });
  });

  it('does not ask for a complete report', async () => {
    signedIn();
    let calls = 0;
    mocks.set('wall2_youtube_videos', () => { calls += 1; return []; });
    useOwnLists.getState().create('List', { id: vid(2), title: 'Complete', channel: 'Invented Channel', seconds: 180 });
    expect(calls).toBe(0);
  });

  it('does not call videos while signed out and can try on a later open', async () => {
    let calls = 0;
    let resolveStatus!: (answer: { setup: boolean; signedIn: boolean; reason: string | null; searchesLeft: number | null }) => void;
    const firstStatus = new Promise<{ setup: boolean; signedIn: boolean; reason: string | null; searchesLeft: number | null }>((resolve) => { resolveStatus = resolve; });
    const status = vi.fn(() => status.mock.calls.length === 1 ? firstStatus : { setup: true, signedIn: true, reason: null, searchesLeft: 100 });
    mocks.set('wall2_youtube_status', status);
    mocks.set('wall2_youtube_videos', () => { calls += 1; return [{ id: vid(3), title: 'Later', channel: null, seconds: null }]; });
    const made = useOwnLists.getState().create('List', { id: vid(3) });
    await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(1));
    resolveStatus({ setup: true, signedIn: false, reason: 'sign in again', searchesLeft: null });
    await firstStatus;
    expect(calls).toBe(0);
    if (!made.ok) return;
    await vi.waitFor(() => {
      useOwnLists.getState().setOpen(made.id);
      expect(calls).toBe(1);
    });
    expect(calls).toBe(1);
    expect(useOwnLists.getState().lists[made.id].items[0].title).toBe('Later');
  });

  it('retries a failed read on a later open', async () => {
    signedIn();
    let calls = 0;
    mocks.set('wall2_youtube_videos', () => {
      calls += 1;
      if (calls === 1) throw new Error('down');
      return [{ id: vid(4), title: 'Recovered', channel: null, seconds: null }];
    });
    const made = useOwnLists.getState().create('List', { id: vid(4) });
    await vi.waitFor(() => expect(calls).toBe(1));
    if (!made.ok) return;
    expect(useOwnLists.getState().lists[made.id].items[0].title).toBeUndefined();
    useOwnLists.getState().setOpen(made.id);
    await vi.waitFor(() => expect(calls).toBe(2));
    expect(calls).toBe(2);
    expect(useOwnLists.getState().lists[made.id].items[0].title).toBe('Recovered');
  });

  it('opens fifty missing rows in one call and asks only once per session', async () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: vid(i) }));
    localStorage.setItem(SAVED_KEY, JSON.stringify([{ kind: 'own', id: listId, label: 'List' }]));
    localStorage.setItem(OWN_KEY, JSON.stringify({ v: 1, lists: { [listId]: { items, shuffle: false, repeat: false } } }));
    resetWatch();
    resetOwnLists();
    signedIn();
    const calls: unknown[] = [];
    mocks.set('wall2_youtube_videos', (args) => { calls.push(args?.ids); return []; });
    useOwnLists.getState().setOpen(listId);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    useOwnLists.getState().setOpen(null);
    useOwnLists.getState().setOpen(listId);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(items.map((item) => item.id));
  });

  it('ignores an answer for a stored id that was not asked, ignores malformed ids, and bounds text', async () => {
    const unasked = vid(6);
    localStorage.setItem(SAVED_KEY, JSON.stringify([{ kind: 'own', id: listId, label: 'List' }]));
    localStorage.setItem(OWN_KEY, JSON.stringify({ v: 1, lists: { [listId]: { items: [{ id: vid(5) }, { id: unasked, title: 'Stored', channel: 'Known', seconds: 200 }], shuffle: false, repeat: false } } }));
    resetWatch();
    resetOwnLists();
    signedIn();
    let resolveRead!: (answers: unknown[]) => void;
    const pending = new Promise<unknown[]>((resolve) => { resolveRead = resolve; });
    const read = vi.fn(() => pending);
    mocks.set('wall2_youtube_videos', read);
    useOwnLists.getState().setOpen(listId);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    const current = useOwnLists.getState().lists;
    useOwnLists.setState({ lists: { ...current, [listId]: { ...current[listId], items: [{ id: vid(5) }, { id: unasked }] } } });
    resolveRead([
      { id: vid(99), title: 'Wrong', channel: null, seconds: null },
      { id: 5, title: 'Wrong type', channel: null, seconds: null },
      { id: unasked, title: 'Should not replace', channel: null, seconds: null },
      { id: vid(5), title: 'x'.repeat(500), channel: null, seconds: null },
    ]);
    await vi.waitFor(() => expect(useOwnLists.getState().lists[listId].items[0].title).toHaveLength(200));
    expect(useOwnLists.getState().lists[listId].items[1].title).toBeUndefined();
  });

  it.each([
    ['not set up', { setup: false, signedIn: false, reason: 'not set up', searchesLeft: null }],
    ['signed out', { setup: true, signedIn: false, reason: null, searchesLeft: null }],
    ['setup broken', { setup: true, signedIn: true, reason: 'setup broken', searchesLeft: 100 }],
  ])('does not read details when status is %s', async (_name, answer) => {
    const status = vi.fn(() => answer);
    const read = vi.fn((_args?: { ids?: unknown }) => []);
    mocks.set('wall2_youtube_status', status);
    mocks.set('wall2_youtube_videos', read);
    const made = useOwnLists.getState().create('List', { id: vid(7) });
    await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(1));
    expect(read).not.toHaveBeenCalled();
    if (made.ok) expect(useOwnLists.getState().lists[made.id].items[0].title).toBeUndefined();
  });

  it('does not read details when status throws', async () => {
    const status = vi.fn(() => { throw new Error('down'); });
    const read = vi.fn(() => []);
    mocks.set('wall2_youtube_status', status);
    mocks.set('wall2_youtube_videos', read);
    const made = useOwnLists.getState().create('List', { id: vid(8) });
    await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(1));
    expect(read).not.toHaveBeenCalled();
    if (made.ok) expect(useOwnLists.getState().lists[made.id].items[0].title).toBeUndefined();
  });

  it('opens a mixed list and asks exactly for its three incomplete rows', async () => {
    const items = [
      { id: vid(10) },
      { id: vid(11), title: 'Known title' },
      { id: vid(12), title: 'Known', channel: 'Known', seconds: 120 },
      { id: vid(13), title: 'Known', channel: 'Known', seconds: 121 },
      { id: vid(14), title: 'Known', channel: 'Missing length' },
    ];
    localStorage.setItem(SAVED_KEY, JSON.stringify([{ kind: 'own', id: listId, label: 'List' }]));
    localStorage.setItem(OWN_KEY, JSON.stringify({ v: 1, lists: { [listId]: { items, shuffle: false, repeat: false } } }));
    resetWatch();
    resetOwnLists();
    signedIn();
    const read = vi.fn((_args?: { ids?: unknown }) => []);
    mocks.set('wall2_youtube_videos', read);
    useOwnLists.getState().setOpen(listId);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect(read.mock.calls[0]?.[0]?.ids).toEqual([vid(10), vid(11), vid(14)]);
  });

  it('refuses invalid bridge inputs before invoke', async () => {
    let calls = 0;
    mocks.set('wall2_youtube_videos', () => { calls += 1; return []; });
    await expect(youtube.videos([])).rejects.toThrow('invalid');
    await expect(youtube.videos(Array.from({ length: 51 }, (_, i) => vid(i)))).rejects.toThrow('invalid');
    await expect(youtube.videos(['bad id'])).rejects.toThrow('invalid');
    expect(calls).toBe(0);
  });
});
