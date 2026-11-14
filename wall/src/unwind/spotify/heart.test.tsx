import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import type { SpotifyTrack } from '../../music/spotify';
import { resetNowPlaying } from '../../music/store';
import { resetTools, useToolsStore } from '../../tools/store';
import { hideTip, HoverTipLayer, resetTip } from '../../ui/HoverTip';
import { resetListenSource, useSpotifyNow } from './model';
import { NEEDS_PERMISSION_LINE, PLAYBACK_POLL_MS, REMOVE_FAILED_LINE, SAVE_FAILED_LINE } from './PlayerRow';
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
const statusOf = (canSave: boolean | undefined) => ({ setup: true, signedIn: true, reason: null, canSave });

let sent: [string, unknown][] = [];
let playing: SpotifyTrack | null = track(1);
let canSave: boolean | undefined = true;
let savedAnswer: () => boolean = () => false;
let saveAnswer: (a: { id: string; on: boolean }) => void = () => undefined;
let readAnswer: () => boolean = () => false;

async function setup(over: { canSave?: boolean | undefined; saved?: boolean; track?: SpotifyTrack | null } = {}) {
  canSave = 'canSave' in over ? over.canSave : true;
  playing = 'track' in over ? over.track ?? null : track(1);
  savedAnswer = () => over.saved ?? false;
  readAnswer = () => true;
  saveAnswer = () => undefined;
  sent = [];
  useSpotifyStatus.setState({ status: statusOf(canSave), failed: false });
  mocks.set('wall2_spotify_status', () => statusOf(canSave));
  mocks.set('wall2_spotify_playlists', () => []);
  mocks.set('wall2_spotify_albums', () => []);
  mocks.set('wall2_spotify_liked', () => []);
  mocks.set('wall2_spotify_recent', () => []);
  mocks.set('wall2_spotify_queue', () => ({ current: playing, next: [] }));
  mocks.set('wall2_spotify_devices', () => []);
  mocks.set('wall2_spotify_playback', () => (playing ? { playing: true, device: { name: 'Desk speakers', kind: 'Computer' }, track: playing, progressMs: 65_000, shuffle: false } : null));
  mocks.set('wall2_spotify_saved', (a) => {
    sent.push(['saved', a]);
    if (!readAnswer()) throw new Error('down');
    return savedAnswer();
  });
  mocks.set('wall2_spotify_save', (a) => {
    sent.push(['save', a]);
    saveAnswer(a as { id: string; on: boolean });
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
    expect(heart()?.getAttribute('data-saved')).toBe('false');
    expect(heart()?.getAttribute('aria-pressed')).toBe('false');
    expect(heart()?.querySelector('.tabler-icon-heart')).toBeTruthy();
    expect(calls('saved')).toEqual([['saved', { id: id(501) }]]);
  });
  it('shows a saved song filled, and says what a click would do', async () => {
    await setup({ saved: true });
    expect(heart()?.getAttribute('data-saved')).toBe('true');
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
  it('a click saves at once, and a second click removes it', async () => {
    await setup({ saved: false });
    await act(async () => heart()!.click());
    // Before the call has answered the heart is already filled.
    expect(heart()?.getAttribute('data-saved')).toBe('true');
    await flush();
    expect(calls('save')).toEqual([['save', { id: id(501), on: true }]]);
    await click();
    expect(heart()?.getAttribute('data-saved')).toBe('false');
    expect(calls('save')[1]).toEqual(['save', { id: id(501), on: false }]);
  });
  it('puts the heart back and says so in one line when Spotify refuses', async () => {
    await setup({ saved: false });
    saveAnswer = () => {
      throw new Error('server-503');
    };
    await click();
    expect(heart()?.getAttribute('data-saved')).toBe('false');
    expect(screen.getByRole('status').textContent).toBe(SAVE_FAILED_LINE);
    await flush(7000);
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('a refused removal goes back to filled with its own line', async () => {
    await setup({ saved: true });
    saveAnswer = () => {
      throw new Error('no connection');
    };
    await click();
    expect(heart()?.getAttribute('data-saved')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe(REMOVE_FAILED_LINE);
  });
  it('reads again for each new song, once, and never on a timer', async () => {
    await setup({ saved: false });
    expect(calls('saved')).toHaveLength(1);
    await flush(PLAYBACK_POLL_MS * 3);
    expect(calls('saved')).toHaveLength(1);
    playing = track(2);
    await flush(PLAYBACK_POLL_MS);
    expect(calls('saved')).toEqual([['saved', { id: id(501) }], ['saved', { id: id(502) }]]);
    await flush(PLAYBACK_POLL_MS * 3);
    expect(calls('saved')).toHaveLength(2);
  });
  it('never shows one song\'s answer on the next song', async () => {
    await setup({ saved: true });
    expect(heart()?.getAttribute('data-saved')).toBe('true');
    savedAnswer = () => false;
    playing = track(2);
    await flush(PLAYBACK_POLL_MS);
    expect(heart()?.getAttribute('data-saved')).toBe('false');
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
    readAnswer = () => false;
    playing = track(2);
    await flush(PLAYBACK_POLL_MS);
    expect(heart()?.getAttribute('data-saved')).toBe('false');
    fireEvent.mouseEnter(heart()!);
    await flush(800);
    expect(document.body.textContent).toContain('Could not check if it is saved.');
    await click();
    expect(calls('save').at(-1)).toEqual(['save', { id: id(502), on: true }]);
    expect(heart()?.getAttribute('data-saved')).toBe('true');
  });
  it('Space and Enter work on the focused heart', async () => {
    await setup();
    await act(async () => heart()!.focus());
    expect(document.activeElement).toBe(heart());
    // A button turns Enter and Space into a click.
    await click();
    expect(calls('save')).toHaveLength(1);
  });
  it('ignores a second click while a save is out', async () => {
    await setup();
    let release: () => void = () => undefined;
    mocks.set('wall2_spotify_save', (a) => {
      sent.push(['save', a]);
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await act(async () => heart()!.click());
    await act(async () => heart()!.click());
    expect(calls('save')).toHaveLength(1);
    release();
    await flush();
    await click();
    expect(calls('save')).toHaveLength(2);
  });
});

describe('the heart without the permission to save', () => {
  it('shows dim, and does not call save', async () => {
    await setup({ canSave: false });
    expect(heart()?.classList.contains('off')).toBe(true);
    expect(heart()?.getAttribute('aria-label')).toMatch(/needs a new sign-in/);
    expect(heart()?.hasAttribute('aria-pressed')).toBe(false);
    await click();
    expect(calls('save')).toHaveLength(0);
  });
  it('a click opens the note with the button, never a silent nothing', async () => {
    await setup({ canSave: false });
    expect(screen.queryByText(NEEDS_PERMISSION_LINE)).toBeNull();
    await click();
    expect(screen.getByText(NEEDS_PERMISSION_LINE)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Tools' })).toBeTruthy();
    expect(NEEDS_PERMISSION_LINE).toBe('Saving songs needs one more permission. Sign in to Spotify again in Tools.');
  });
  it('Open Tools opens the drawer on Accounts and closes the note', async () => {
    await setup({ canSave: false });
    await click();
    await act(async () => screen.getByRole('button', { name: 'Open Tools' }).click());
    expect(useToolsStore.getState().open).toBe(true);
    expect(useToolsStore.getState().focus).toBe('accounts');
    expect(screen.queryByText(NEEDS_PERMISSION_LINE)).toBeNull();
  });
  it('Escape and a press outside close the note', async () => {
    await setup({ canSave: false });
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
  it('after a new sign-in the next click saves, with no restart', async () => {
    await setup({ canSave: false });
    canSave = true;
    await click();
    expect(calls('save')).toEqual([['save', { id: id(501), on: true }]]);
    expect(screen.queryByText(NEEDS_PERMISSION_LINE)).toBeNull();
  });
  it('a refused save for the missing permission turns the heart dim and opens the note, with no other line', async () => {
    await setup({ canSave: true });
    saveAnswer = () => {
      throw new Error('needs sign in');
    };
    canSave = false;
    await click();
    expect(heart()?.classList.contains('off')).toBe(true);
    expect(heart()?.getAttribute('data-saved')).toBe('false');
    expect(screen.getByText(NEEDS_PERMISSION_LINE)).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('learns the permission from the first read: the status is asked again after it', async () => {
    let asked = 0;
    await setup({ canSave: false });
    mocks.set('wall2_spotify_status', () => {
      asked += 1;
      return statusOf(true);
    });
    playing = track(2);
    await flush(PLAYBACK_POLL_MS);
    expect(asked).toBeGreaterThan(0);
    expect(useSpotifyStatus.getState().status?.canSave).toBe(true);
    expect(heart()?.classList.contains('off')).toBe(false);
  });
  it('treats a status without the field as no permission', async () => {
    await setup({ canSave: undefined });
    expect(heart()?.classList.contains('off')).toBe(true);
  });
});
