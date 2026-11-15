import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import type { SpotifyCanSave, SpotifyTrack } from '../../music/spotify';
import { resetNowPlaying } from '../../music/store';
import { resetTools, useToolsStore } from '../../tools/store';
import { hideTip, HoverTipLayer, resetTip } from '../../ui/HoverTip';
import { resetListenSource, useSpotifyNow } from './model';
import { NEEDS_PERMISSION_LINE, PLAYBACK_POLL_MS, REFUSED_NOTE_MS, REMOVE_FAILED_LINE, SAVE_FAILED_LINE } from './PlayerRow';
import { SpotifyCard } from './SpotifyCard';
import { resetSpotifyStatus, useSpotifyStatus } from './status';

vi.setConfig({ testTimeout: 20_000 });

const id = (n: number) => String(n).padStart(22, '0');
const track = (n: number, withId = true): SpotifyTrack => ({ id: withId ? id(500 + n) : null, name: `Song ${n}`, artists: 'Some Artist', album: 'Some Album', durationMs: 200_000, imageUrl: null, thumbUrl: null, playable: true });

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
type Capability = SpotifyCanSave | undefined;
const statusOf = (canSave: Capability) => ({ setup: true, signedIn: true, reason: null, canSave });

/** A promise held open from the test: `resolve` and `reject` answer it when the test says so. */
function hold<T>() {
  let resolve: (v: T) => void = () => undefined;
  let reject: (e: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let sent: [string, unknown][] = [];
let playing: SpotifyTrack | null = track(1);
let capability: Capability = 'yes';
let savedAnswer: () => boolean | Promise<boolean> = () => false;
let saveAnswer: (a: { id: string; on: boolean }) => void | Promise<void> = () => undefined;
let statusAnswer: () => unknown = () => statusOf('yes');

async function setup(over: { canSave?: Capability; saved?: boolean; track?: SpotifyTrack | null } = {}) {
  capability = 'canSave' in over ? over.canSave : 'yes';
  playing = 'track' in over ? over.track ?? null : track(1);
  savedAnswer = () => over.saved ?? false;
  saveAnswer = () => undefined;
  statusAnswer = () => statusOf(capability);
  sent = [];
  useSpotifyStatus.setState({ status: statusOf(capability), failed: false });
  mocks.set('wall2_spotify_status', () => {
    sent.push(['status', null]);
    return statusAnswer();
  });
  mocks.set('wall2_spotify_playlists', () => []);
  mocks.set('wall2_spotify_albums', () => []);
  mocks.set('wall2_spotify_liked', () => []);
  mocks.set('wall2_spotify_recent', () => []);
  mocks.set('wall2_spotify_queue', () => ({ current: playing, next: [] }));
  mocks.set('wall2_spotify_devices', () => []);
  mocks.set('wall2_spotify_playback', () => (playing ? { playing: true, device: { name: 'Desk speakers', kind: 'Computer' }, track: playing, progressMs: 65_000, shuffle: false } : null));
  mocks.set('wall2_spotify_saved', (a) => {
    sent.push(['saved', a]);
    return savedAnswer();
  });
  mocks.set('wall2_spotify_save', (a) => {
    sent.push(['save', a]);
    return saveAnswer(a as { id: string; on: boolean });
  });
  mocks.set('get_now_playing', () => ({ title: 'Song 1', artist: 'Some Artist', playback_status: 'playing', source_app: 'Spotify', source_app_id: 'Spotify.exe' }));
  const view = render(
    <>
      <SpotifyCard />
      <HoverTipLayer />
    </>,
  );
  await flush();
  const card = document.querySelector('.sp-card') as HTMLElement;
  fireEvent.pointerEnter(card);
  await act(async () => (screen.getByRole('button', { name: /the tall music view/ }) as HTMLElement).click());
  await flush();
  return view;
}
const heart = () => document.querySelector('[data-control="heart"]') as HTMLButtonElement | null;
const calls = (name: string) => sent.filter((s) => s[0] === name);
const click = async () => {
  await act(async () => heart()!.click());
  await flush();
};
const next = async (n: number) => {
  playing = track(n);
  await flush(PLAYBACK_POLL_MS);
};
const isSaved = () => heart()?.getAttribute('data-saved');
const titleLine = () => document.querySelector('.sp-pl-title')?.textContent ?? '';

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetListenSource();
  resetSpotifyStatus();
  resetTools();
  useSpotifyNow.setState({ id: null });
});
afterEach(() => {
  hideTip(true);
  resetTip();
  vi.useRealTimers();
  mocks.clear();
  resetNowPlaying();
});

describe('the heart on the player row', () => {
  it('is outline when the song is not saved and filled when it is, read once for the song', async () => {
    await setup({ saved: false });
    expect(isSaved()).toBe('false');
    expect(heart()?.getAttribute('aria-pressed')).toBe('false');
    expect(heart()?.querySelector('.tabler-icon-heart')).toBeTruthy();
    expect(calls('saved')).toEqual([['saved', { id: id(501) }]]);
  });
  it('shows a saved song filled, and says what a click would do', async () => {
    await setup({ saved: true });
    expect(isSaved()).toBe('true');
    expect(heart()?.getAttribute('aria-pressed')).toBe('true');
    expect(heart()?.getAttribute('aria-label')).toBe('Remove from Liked Songs');
    expect(heart()?.querySelector('.tabler-icon-heart-filled')).toBeTruthy();
    expect(heart()?.classList.contains('on')).toBe(true);
  });
  it('has the hover tip for each state', async () => {
    await setup({ saved: false });
    fireEvent.mouseEnter(heart()!);
    await flush(800);
    expect(document.body.textContent).toContain('Save to Liked Songs');
    fireEvent.mouseLeave(heart()!);
    await click();
    fireEvent.mouseEnter(heart()!);
    await flush(800);
    expect(document.body.textContent).toContain('Remove from Liked Songs');
  });
  it('is the last thing in the row, after the time bar, in the Tab order', async () => {
    await setup();
    const row = document.querySelector('.sp-player') as HTMLElement;
    const order = [...row.querySelectorAll('button, [role="slider"]')];
    expect(order[order.length - 1]).toBe(heart());
    expect(order.indexOf(row.querySelector('[role="slider"]')!)).toBe(order.length - 2);
  });
  it('a click fills the heart at once, while the save is still out, and a second click removes it', async () => {
    await setup({ saved: false });
    const write = hold<void>();
    saveAnswer = () => write.promise;
    await act(async () => heart()!.click());
    // The save has not answered yet and the heart is already filled.
    expect(calls('save')).toEqual([['save', { id: id(501), on: true }]]);
    expect(isSaved()).toBe('true');
    write.resolve();
    await flush();
    expect(isSaved()).toBe('true');
    saveAnswer = () => undefined;
    await click();
    expect(isSaved()).toBe('false');
    expect(calls('save')[1]).toEqual(['save', { id: id(501), on: false }]);
  });
  it('a refused save puts the heart back and says so in a note that closes by itself', async () => {
    await setup({ saved: false });
    saveAnswer = () => {
      throw new Error('server-503');
    };
    await click();
    expect(isSaved()).toBe('false');
    expect(screen.getByRole('status').textContent).toBe(SAVE_FAILED_LINE);
    // The whole sentence is in a note beside the heart, not in the title's line.
    expect(screen.getByRole('status').closest('.sp-heart-wrap')).toBeTruthy();
    expect(titleLine()).not.toContain(SAVE_FAILED_LINE);
    await flush(REFUSED_NOTE_MS - 100);
    expect(screen.queryByRole('status')).not.toBeNull();
    await flush(200);
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('a refused removal goes back to filled with its own line', async () => {
    await setup({ saved: true });
    saveAnswer = () => {
      throw new Error('no connection');
    };
    await click();
    expect(isSaved()).toBe('true');
    expect(screen.getByRole('status').textContent).toBe(REMOVE_FAILED_LINE);
  });
  it('a refusal that is not a missing permission never shows the permission note or dims the heart', async () => {
    await setup({ saved: false });
    saveAnswer = () => {
      throw new Error('refused');
    };
    await click();
    expect(screen.queryByText(NEEDS_PERMISSION_LINE)).toBeNull();
    expect(heart()?.classList.contains('off')).toBe(false);
    expect(useSpotifyStatus.getState().status?.canSave).toBe('yes');
  });
  it('reads again for each new song, once, and never on a timer', async () => {
    await setup({ saved: false });
    expect(calls('saved')).toHaveLength(1);
    await flush(PLAYBACK_POLL_MS * 3);
    expect(calls('saved')).toHaveLength(1);
    await next(2);
    expect(calls('saved')).toEqual([['saved', { id: id(501) }], ['saved', { id: id(502) }]]);
    await flush(PLAYBACK_POLL_MS * 3);
    expect(calls('saved')).toHaveLength(2);
  });
  it('never shows one song\'s answer on the next song', async () => {
    await setup({ saved: true });
    expect(isSaved()).toBe('true');
    savedAnswer = () => false;
    await next(2);
    expect(isSaved()).toBe('false');
  });
  it('is hidden for an item without a track id, and when nothing plays', async () => {
    await setup({ track: track(1, false) });
    expect(heart()).toBeNull();
    expect(calls('saved')).toHaveLength(0);
  });
  it('is hidden while nothing plays', async () => {
    await setup({ track: null });
    expect(heart()).toBeNull();
  });
  it('when the read fails the heart stays usable, says it could not check, and a click saves', async () => {
    await setup();
    savedAnswer = () => {
      throw new Error('down');
    };
    await next(2);
    expect(isSaved()).toBe('false');
    fireEvent.mouseEnter(heart()!);
    await flush(800);
    expect(document.body.textContent).toContain('Could not check if it is saved.');
    await click();
    expect(calls('save').at(-1)).toEqual(['save', { id: id(502), on: true }]);
    expect(isSaved()).toBe('true');
  });
  it('Enter and Space on the focused heart each activate it once, and a held key does not repeat', async () => {
    await setup();
    await act(async () => heart()!.focus());
    expect(document.activeElement).toBe(heart());
    // Enter acts on the key down; the browser's own click for it is cancelled.
    expect(fireEvent.keyDown(heart()!, { key: 'Enter' })).toBe(false);
    await flush();
    fireEvent.keyUp(heart()!, { key: 'Enter' });
    await flush();
    expect(calls('save')).toEqual([['save', { id: id(501), on: true }]]);
    expect(isSaved()).toBe('true');
    // A held Enter repeats the key down: nothing more is sent.
    expect(fireEvent.keyDown(heart()!, { key: 'Enter', repeat: true })).toBe(false);
    await flush();
    expect(calls('save')).toHaveLength(1);
    // Space acts on the key up, not on the key down.
    expect(fireEvent.keyDown(heart()!, { key: ' ' })).toBe(false);
    await flush();
    expect(calls('save')).toHaveLength(1);
    expect(fireEvent.keyUp(heart()!, { key: ' ' })).toBe(false);
    await flush();
    expect(calls('save')).toEqual([['save', { id: id(501), on: true }], ['save', { id: id(501), on: false }]]);
    expect(isSaved()).toBe('false');
    // Any other key does nothing and is left alone.
    expect(fireEvent.keyDown(heart()!, { key: 'a' })).toBe(true);
    await flush();
    expect(calls('save')).toHaveLength(2);
  });
  it('ignores a second click while a save is out', async () => {
    await setup();
    const write = hold<void>();
    saveAnswer = () => write.promise;
    await act(async () => heart()!.click());
    await act(async () => heart()!.click());
    expect(calls('save')).toHaveLength(1);
    write.resolve();
    await flush();
    saveAnswer = () => undefined;
    await click();
    expect(calls('save')).toHaveLength(2);
  });
});

describe('a click before the saved read answers', () => {
  // The song is already saved; its read is held; the owner clicks (the heart fills); then the save and the read answer in either order.
  const setupHeld = async (readValue: boolean) => {
    const read = hold<boolean>();
    const write = hold<void>();
    await setup();
    savedAnswer = () => read.promise;
    saveAnswer = () => write.promise;
    await next(2);
    expect(calls('saved')).toHaveLength(2);
    await act(async () => heart()!.click());
    expect(isSaved()).toBe('true');
    expect(calls('save')).toEqual([['save', { id: id(502), on: true }]]);
    return { read, write, readValue };
  };
  it('a saved song, the read answers true, then the save is refused: the heart stays filled', async () => {
    const { read, write } = await setupHeld(true);
    read.resolve(true);
    await flush();
    expect(isSaved()).toBe('true');
    write.reject(new Error('server-503'));
    await flush();
    expect(isSaved()).toBe('true');
    expect(screen.getByRole('status').textContent).toBe(SAVE_FAILED_LINE);
  });
  it('a saved song, the save is refused first, then the read answers true: the heart ends filled', async () => {
    const { read, write } = await setupHeld(true);
    write.reject(new Error('server-503'));
    await flush();
    read.resolve(true);
    await flush();
    expect(isSaved()).toBe('true');
  });
  it('an unsaved song, the save is refused in either order: the heart ends as an outline', async () => {
    const first = await setupHeld(false);
    first.read.resolve(false);
    await flush();
    first.write.reject(new Error('server-503'));
    await flush();
    expect(isSaved()).toBe('false');
    // And the other order, on the next song.
    const read = hold<boolean>();
    const write = hold<void>();
    savedAnswer = () => read.promise;
    saveAnswer = () => write.promise;
    await next(3);
    await act(async () => heart()!.click());
    expect(isSaved()).toBe('true');
    write.reject(new Error('server-503'));
    await flush();
    read.resolve(false);
    await flush();
    expect(isSaved()).toBe('false');
  });
  it('a save that worked is not undone by a read that answers late with the old value', async () => {
    const { read, write } = await setupHeld(false);
    write.resolve();
    await flush();
    read.resolve(false);
    await flush();
    expect(isSaved()).toBe('true');
  });
  it('still one read for the song', async () => {
    const { read, write } = await setupHeld(true);
    read.resolve(true);
    write.reject(new Error('server-503'));
    await flush();
    expect(calls('saved')).toHaveLength(2);
  });
});

describe('the guards on the whole click', () => {
  it('a status answer that arrives after the song changed does not touch the new song\'s heart', async () => {
    await setup({ canSave: 'no', saved: false });
    const status = hold<unknown>();
    statusAnswer = () => status.promise;
    const base = calls('status').length;
    await act(async () => heart()!.click());
    expect(calls('status')).toHaveLength(base + 1);
    savedAnswer = () => true;
    await next(2);
    expect(isSaved()).toBe('true');
    // The late answer says the permission is there; the old song's save must not run, nor change the new heart.
    status.resolve(statusOf('yes'));
    await flush();
    expect(calls('save')).toHaveLength(0);
    expect(isSaved()).toBe('true');
    expect(screen.queryByText(NEEDS_PERMISSION_LINE)).toBeNull();
    // The capability itself did update.
    expect(useSpotifyStatus.getState().status?.canSave).toBe('yes');
    // The new song's heart is not stuck: a click saves nothing new but removes (it is saved).
    await click();
    expect(calls('save')).toEqual([['save', { id: id(502), on: false }]]);
  });
  it('a late status answer for an old song that says "no" opens no note on the new song', async () => {
    await setup({ canSave: 'no' });
    const status = hold<unknown>();
    statusAnswer = () => status.promise;
    await act(async () => heart()!.click());
    await next(2);
    status.resolve(statusOf('no'));
    await flush();
    expect(screen.queryByText(NEEDS_PERMISSION_LINE)).toBeNull();
  });
  it('two quick clicks start one status read and one write', async () => {
    await setup({ canSave: 'no' });
    const first = hold<unknown>();
    statusAnswer = () => first.promise;
    const base = calls('status').length;
    await act(async () => heart()!.click());
    await act(async () => heart()!.click());
    expect(calls('status')).toHaveLength(base + 1);
    const write = hold<void>();
    saveAnswer = () => write.promise;
    first.resolve(statusOf('yes'));
    await flush();
    expect(calls('save')).toEqual([['save', { id: id(501), on: true }]]);
    // A click while that write is out is ignored too.
    await act(async () => heart()!.click());
    expect(calls('status')).toHaveLength(base + 1);
    expect(calls('save')).toHaveLength(1);
    write.resolve();
    await flush();
  });
  it('two held status answers (a failing one and a good one) still make one operation', async () => {
    await setup({ canSave: 'no' });
    const first = hold<unknown>();
    statusAnswer = () => first.promise;
    const base = calls('status').length;
    await act(async () => heart()!.click());
    statusAnswer = () => statusOf('yes');
    await act(async () => heart()!.click());
    expect(calls('status')).toHaveLength(base + 1);
    first.reject(new Error('down'));
    await flush();
    // The failed read explains; the click after it starts a new operation.
    expect(screen.getByText(NEEDS_PERMISSION_LINE)).toBeTruthy();
    await click();
    expect(calls('status')).toHaveLength(base + 2);
    expect(calls('save')).toHaveLength(1);
  });
  it('a write refused after the song changed leaves no line or note under the new song', async () => {
    await setup({ saved: false });
    const write = hold<void>();
    saveAnswer = () => write.promise;
    await act(async () => heart()!.click());
    savedAnswer = () => true;
    await next(2);
    expect(isSaved()).toBe('true');
    write.reject(new Error('server-503'));
    await flush();
    expect(screen.queryByRole('status')).toBeNull();
    expect(titleLine()).not.toContain('Could not');
    expect(isSaved()).toBe('true');
    // The same for a refusal that is a missing permission: the capability turns to no, the new song shows no note.
    const write2 = hold<void>();
    saveAnswer = () => write2.promise;
    await next(3);
    await act(async () => heart()!.click());
    await next(4);
    write2.reject(new Error('needs sign in'));
    await flush();
    expect(screen.queryByText(NEEDS_PERMISSION_LINE)).toBeNull();
    expect(useSpotifyStatus.getState().status?.canSave).toBe('no');
  });
  it('a click on the new song is not swallowed by the old song\'s save still out', async () => {
    await setup({ saved: false });
    const write = hold<void>();
    saveAnswer = () => write.promise;
    await act(async () => heart()!.click());
    await next(2);
    saveAnswer = () => undefined;
    await click();
    expect(calls('save')).toEqual([['save', { id: id(501), on: true }], ['save', { id: id(502), on: true }]]);
    expect(isSaved()).toBe('true');
    // The old song's late answer changes nothing.
    write.reject(new Error('server-503'));
    await flush();
    expect(isSaved()).toBe('true');
    expect(screen.queryByRole('status')).toBeNull();
    // And it did not clear the new song's operation: the new song's heart works again.
    await click();
    expect(calls('save')).toHaveLength(3);
  });
});

describe('the heart without the permission to save', () => {
  it('shows dim, and does not call save', async () => {
    await setup({ canSave: 'no' });
    expect(heart()?.classList.contains('off')).toBe(true);
    expect(heart()?.getAttribute('aria-label')).toMatch(/needs a new sign-in/);
    expect(heart()?.hasAttribute('aria-pressed')).toBe(false);
    await click();
    expect(calls('save')).toHaveLength(0);
  });
  it('a click opens the note with the button, never a silent nothing', async () => {
    await setup({ canSave: 'no' });
    expect(screen.queryByText(NEEDS_PERMISSION_LINE)).toBeNull();
    await click();
    expect(screen.getByText(NEEDS_PERMISSION_LINE)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Tools' })).toBeTruthy();
    expect(NEEDS_PERMISSION_LINE).toBe('Saving songs needs one more permission. Sign in to Spotify again in Tools.');
  });
  it('Open Tools opens the drawer on Accounts and closes the note', async () => {
    await setup({ canSave: 'no' });
    await click();
    await act(async () => screen.getByRole('button', { name: 'Open Tools' }).click());
    expect(useToolsStore.getState().open).toBe(true);
    expect(useToolsStore.getState().focus).toBe('accounts');
    expect(screen.queryByText(NEEDS_PERMISSION_LINE)).toBeNull();
  });
  it('Escape and a press outside close the note', async () => {
    await setup({ canSave: 'no' });
    await click();
    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
    expect(screen.queryByText(NEEDS_PERMISSION_LINE)).toBeNull();
    expect(document.activeElement).toBe(heart());
    // The tall view stays open: Escape closed only the note.
    expect(document.querySelector('.sp-card')?.getAttribute('data-tall')).toBe('true');
    await click();
    expect(screen.getByText(NEEDS_PERMISSION_LINE)).toBeTruthy();
    await act(async () => {
      fireEvent.pointerDown(document.body);
    });
    expect(screen.queryByText(NEEDS_PERMISSION_LINE)).toBeNull();
  });
  it('closing the tall view with the note open removes the note and leaves no Escape listener behind', async () => {
    await setup({ canSave: 'no' });
    await click();
    expect(screen.getByText(NEEDS_PERMISSION_LINE)).toBeTruthy();
    // The round button closes the tall view; the player row and its note are gone.
    await act(async () => (document.querySelector('.sp-grow') as HTMLElement).click());
    await flush(500);
    expect(document.querySelector('.sp-card')?.getAttribute('data-tall')).not.toBe('true');
    expect(screen.queryByText(NEEDS_PERMISSION_LINE)).toBeNull();
    expect(heart()).toBeNull();
    // Opening it again shows no stale note, and Escape with it open closes the view as usual.
    fireEvent.pointerEnter(document.querySelector('.sp-card') as HTMLElement);
    await act(async () => (screen.getByRole('button', { name: /the tall music view/ }) as HTMLElement).click());
    await flush();
    expect(screen.queryByText(NEEDS_PERMISSION_LINE)).toBeNull();
    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
    await flush(500);
    expect(document.querySelector('.sp-card')?.getAttribute('data-tall')).not.toBe('true');
  });
  it('after a new sign-in the next click saves, with no restart', async () => {
    await setup({ canSave: 'no' });
    capability = 'yes';
    await click();
    expect(calls('save')).toEqual([['save', { id: id(501), on: true }]]);
    expect(screen.queryByText(NEEDS_PERMISSION_LINE)).toBeNull();
    expect(heart()?.classList.contains('off')).toBe(false);
  });
  it('a refused save for the missing permission turns the heart dim and opens the note, with no other line', async () => {
    await setup({ canSave: 'yes' });
    saveAnswer = () => {
      throw new Error('needs sign in');
    };
    await click();
    expect(heart()?.classList.contains('off')).toBe(true);
    expect(isSaved()).toBe('false');
    expect(screen.getByText(NEEDS_PERMISSION_LINE)).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    expect(useSpotifyStatus.getState().status?.canSave).toBe('no');
  });
  it('learns the permission from the first read: the status is asked again after it', async () => {
    await setup({ canSave: 'no' });
    statusAnswer = () => statusOf('yes');
    await next(2);
    expect(calls('status').length).toBeGreaterThan(0);
    expect(useSpotifyStatus.getState().status?.canSave).toBe('yes');
    expect(heart()?.classList.contains('off')).toBe(false);
  });
  it('treats a status without the field as unknown, not as no permission', async () => {
    await setup({ canSave: undefined });
    expect(heart()?.classList.contains('off')).toBe(false);
  });
});

describe('the status is yes, no or unknown', () => {
  it('yes: the heart works and is not dim', async () => {
    await setup({ canSave: 'yes' });
    expect(heart()?.classList.contains('off')).toBe(false);
    await click();
    expect(calls('save')).toHaveLength(1);
    expect(screen.queryByText(NEEDS_PERMISSION_LINE)).toBeNull();
  });
  it('no: the heart is dim, and a click explains without sending anything', async () => {
    await setup({ canSave: 'no' });
    expect(heart()?.classList.contains('off')).toBe(true);
    await click();
    expect(calls('save')).toHaveLength(0);
    expect(screen.getByText(NEEDS_PERMISSION_LINE)).toBeTruthy();
  });
  it('unknown: the heart looks and works as usual, and a click tries the save', async () => {
    await setup({ canSave: 'unknown' });
    expect(heart()?.classList.contains('off')).toBe(false);
    expect(heart()?.getAttribute('aria-label')).toBe('Save to Liked Songs');
    expect(heart()?.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByText(NEEDS_PERMISSION_LINE)).toBeNull();
    await click();
    expect(calls('save')).toEqual([['save', { id: id(501), on: true }]]);
    // No status read was needed to try the save.
    expect(isSaved()).toBe('true');
    expect(screen.queryByText(NEEDS_PERMISSION_LINE)).toBeNull();
  });
  it('unknown: only a real missing-permission answer turns it to no and opens the note', async () => {
    await setup({ canSave: 'unknown' });
    saveAnswer = () => {
      throw new Error('refused');
    };
    await click();
    expect(screen.queryByText(NEEDS_PERMISSION_LINE)).toBeNull();
    expect(useSpotifyStatus.getState().status?.canSave).toBe('unknown');
    expect(heart()?.classList.contains('off')).toBe(false);
    saveAnswer = () => {
      throw new Error('server-503');
    };
    await flush(REFUSED_NOTE_MS + 100);
    await click();
    expect(screen.queryByText(NEEDS_PERMISSION_LINE)).toBeNull();
    saveAnswer = () => {
      throw new Error('needs sign in');
    };
    await flush(REFUSED_NOTE_MS + 100);
    await click();
    expect(screen.getByText(NEEDS_PERMISSION_LINE)).toBeTruthy();
    expect(useSpotifyStatus.getState().status?.canSave).toBe('no');
    expect(heart()?.classList.contains('off')).toBe(true);
  });
  it('unknown at the start never opens the note by itself, on the first read or on a song change', async () => {
    await setup({ canSave: 'unknown' });
    await next(2);
    await next(3);
    expect(screen.queryByText(NEEDS_PERMISSION_LINE)).toBeNull();
    expect(heart()?.classList.contains('off')).toBe(false);
  });
  it('unknown turns to yes by itself once the first read has made Spotify name the permissions', async () => {
    await setup({ canSave: 'unknown' });
    capability = 'yes';
    await next(2);
    expect(useSpotifyStatus.getState().status?.canSave).toBe('yes');
  });
});
