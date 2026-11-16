import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { youtube } from '../../music/youtube';
import { resetOwnDetails } from './ownDetails';
import { OWN_KEY, resetOwnLists, useOwnLists } from './ownLists';
import { SAVED_KEY } from './saved';
import { resetWatch } from './store';

const vid = (n: number) => `Vid${String(n).padStart(8, '0')}`;
const listId = 'list00000001';
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

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

function signedIn(): void {
  mocks.set('wall2_youtube_status', () => ({ setup: true, signedIn: true, reason: null, searchesLeft: 100 }));
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
    await flush();
    if (!made.ok) return;
    expect(calls).toEqual([[vid(1)]]);
    expect(useOwnLists.getState().lists[made.id].items[0]).toEqual({ id: vid(1), title: 'Owner title', channel: 'Invented Channel', seconds: 240 });
  });

  it('does not ask for a complete report', async () => {
    signedIn();
    let calls = 0;
    mocks.set('wall2_youtube_videos', () => { calls += 1; return []; });
    useOwnLists.getState().create('List', { id: vid(2), title: 'Complete', channel: 'Invented Channel', seconds: 180 });
    await flush();
    expect(calls).toBe(0);
  });

  it('does not call videos while signed out and can try on a later open', async () => {
    let signed = false;
    let calls = 0;
    mocks.set('wall2_youtube_status', () => ({ setup: true, signedIn: signed, reason: signed ? null : 'sign in again', searchesLeft: signed ? 100 : null }));
    mocks.set('wall2_youtube_videos', () => { calls += 1; return [{ id: vid(3), title: 'Later', channel: null, seconds: null }]; });
    const made = useOwnLists.getState().create('List', { id: vid(3) });
    await flush();
    expect(calls).toBe(0);
    if (!made.ok) return;
    signed = true;
    useOwnLists.getState().setOpen(made.id);
    await flush();
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
    await flush();
    if (!made.ok) return;
    expect(useOwnLists.getState().lists[made.id].items[0].title).toBeUndefined();
    useOwnLists.getState().setOpen(made.id);
    await flush();
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
    await flush();
    useOwnLists.getState().setOpen(null);
    useOwnLists.getState().setOpen(listId);
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(items.map((item) => item.id));
  });

  it('ignores unasked and malformed ids and stores bounded text through learn', async () => {
    signedIn();
    mocks.set('wall2_youtube_videos', () => [
      { id: vid(99), title: 'Wrong', channel: null, seconds: null },
      { id: 5, title: 'Wrong type', channel: null, seconds: null },
      { id: vid(5), title: 'x'.repeat(500), channel: null, seconds: null },
    ]);
    const made = useOwnLists.getState().create('List', { id: vid(5) });
    await flush();
    if (!made.ok) return;
    expect(useOwnLists.getState().lists[made.id].items[0].title).toHaveLength(200);
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
