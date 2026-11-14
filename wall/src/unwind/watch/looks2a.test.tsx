import { act, within, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { resetNowPlaying } from '../../music/store';
import { Unwind } from '../../screens/Unwind';
import { useSignalStore } from '../../signals/store';
import { usePlaceStore } from '../../state/places';
import { resetLastPlayed } from '../lastPlayed';
import { DEFAULT_LOOKS, LOOKS, LOOKS_KEY, isLook, parseLooks, type LookId } from './looks';
import { SAVED_KEY } from './saved';
import { resetWatch, useWatchStore } from './store';

// Part 2a: the whole sky and the sun join the feathered look and the drive-in.
const V = 'Ab3dEfGh1jK';
const THREE = [
  { kind: 'video', id: V, label: 'Night drive mix' },
  { kind: 'live', id: 'Lofi_Live01', label: 'Lofi radio' },
  { kind: 'twitch', id: 'pixel_harbor', label: 'pixel_harbor' },
];
const IDS: LookId[] = ['feather', 'sky', 'sun', 'drivein'];

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

function setup(look: LookId) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(THREE));
  localStorage.setItem(LOOKS_KEY, JSON.stringify({ mode: 'one', all: look }));
  resetWatch();
  useWatchStore.getState().setTab('watch');
  useWatchStore.getState().play({ kind: 'video', id: V });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetWatch();
  usePlaceStore.setState({ active: 'unwind', from: 'work' });
  useSignalStore.setState({ call: null });
  mocks.set('get_now_playing', () => ({ playback_status: 'stopped' }));
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  resetNowPlaying();
  resetLastPlayed();
  localStorage.clear();
});

describe('the look list', () => {
  it('has the four looks of the approved page, in its order, each with a name and a one-line hint', () => {
    expect(LOOKS.map((l) => l.id)).toEqual(IDS);
    expect(LOOKS.map((l) => l.name)).toEqual(['Feathered', 'Whole sky', 'The sun', 'Drive-in']);
    for (const l of LOOKS) expect(l.hint).toMatch(/^[A-Z].+\.$/);
    for (const id of IDS) expect(isLook(id)).toBe(true);
    for (const bad of ['whole', 'Sky', 'SUN', '', null, 3]) expect(isLook(bad)).toBe(false);
  });

  it('reads the new looks from storage and keeps what part 1 stored', () => {
    expect(parseLooks(JSON.stringify({ mode: 'kind', all: 'sky', video: 'sun', live: 'sky', twitch: 'sun' }))).toEqual({
      mode: 'kind',
      all: 'sky',
      video: 'sun',
      live: 'sky',
      twitch: 'sun',
    });
    // Part 1 stored only its two looks; those values read the same as before.
    expect(parseLooks(JSON.stringify({ mode: 'kind', all: 'feather', video: 'drivein', live: 'feather', twitch: 'drivein' }))).toEqual({
      mode: 'kind',
      all: 'feather',
      video: 'drivein',
      live: 'feather',
      twitch: 'drivein',
    });
    // A part 1 value that left a field out takes today's default for it.
    expect(parseLooks(JSON.stringify({ mode: 'one', all: 'feather' }))).toEqual({ ...DEFAULT_LOOKS, all: 'feather' });
    expect(parseLooks(JSON.stringify({ all: 'moon', live: 'sunset' }))).toEqual(DEFAULT_LOOKS);
    expect(DEFAULT_LOOKS.live).toBe('sky');
  });

});

describe('each look', () => {
  it.each(IDS)('%s plays in the same single frame with the same attributes, and Open in browser shows', async (look) => {
    setup(look);
    render(<Unwind />);
    await flush();
    expect(document.querySelector('.w-stage')?.getAttribute('data-look')).toBe(look);
    const frames = document.querySelectorAll('iframe');
    expect(frames.length).toBe(1);
    const f = frames[0];
    expect(f.getAttribute('src')).toBe(`https://www.youtube-nocookie.com/embed/${V}?autoplay=1&controls=0&disablekb=1&fs=0&iv_load_policy=3&playsinline=1&rel=0&enablejsapi=1&origin=http%3A%2F%2Flocalhost%3A3000`);
    expect(f.getAttribute('allow')).toBe('autoplay; encrypted-media; picture-in-picture');
    expect(f.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
    expect(f.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(screen.getByRole('button', { name: /^Open in YouTube$/ })).toBeTruthy();
    // The Look switch shows this look checked, and nothing of the wall's is inside the stage.
    const sw = screen.getByRole('radiogroup', { name: 'Look' });
    expect(sw.querySelector('[aria-checked=true]')?.textContent).toBe(LOOKS.find((l) => l.id === look)!.name);
    expect(document.querySelector('.w-stage')!.querySelector('button')).toBeNull();
  });

  it('draws the whole sky with its wash, its buttons apart from the picture, and a still floor wash outside the frame', async () => {
    setup('sky');
    render(<Unwind />);
    await flush();
    // The floor wash is a still element beside the sky, not a second frame.
    const spill = document.querySelector('.w-skyspill')!;
    expect(spill).not.toBeNull();
    expect(spill.getAttribute('aria-hidden')).toBe('true');
    expect(spill.closest('.w-sky')).toBeNull();
    expect(spill.querySelector('iframe')).toBeNull();
    expect(document.querySelectorAll('iframe').length).toBe(1);
    const sky = document.querySelector('.w-sky')!;
    expect(sky.querySelector('iframe')).not.toBeNull();
    // Nothing of the wall's lies on the picture: the stage holds the picture only.
    expect([...sky.children].map((c) => c.className)).toEqual(['w-screen']);
    // The Look switch and Open in YouTube are outside the layer that takes no pointer.
    expect(sky.querySelector('button')).toBeNull();
    expect(document.querySelector('.w-now .w-open')).not.toBeNull();
    expect(document.querySelector('.w-lookbar')!.closest('.w-sky')).toBeNull();
  });

  it('draws no floor wash in the other looks', async () => {
    for (const look of ['feather', 'sun', 'drivein'] as LookId[]) {
      setup(look);
      const { unmount } = render(<Unwind />);
      await flush();
      expect(document.querySelector('.w-skyspill')).toBeNull();
      unmount();
    }
  });

  it('with the moon up, veils it for the feathered look only: the whole sky and the sun hide it themselves', async () => {
    // 10:30 PM Pacific in November: the sun is far below the horizon, so the horizon draws its moon.
    vi.setSystemTime(new Date('2026-11-11T22:30:00-08:00'));
    const veil: Record<string, boolean> = {};
    for (const look of IDS) {
      setup(look);
      const { unmount } = render(<Unwind />);
      await flush();
      veil[look] = document.querySelector('.w-moonveil') !== null;
      unmount();
    }
    expect(veil).toEqual({ feather: true, sky: false, sun: false, drivein: false });
    // At noon the moon is down and even the feathered look has no veil.
    vi.setSystemTime(new Date('2026-11-11T12:30:00-08:00'));
    setup('feather');
    render(<Unwind />);
    await flush();
    expect(document.querySelector('.w-moonveil')).toBeNull();
  });

  it('draws the sun with its halo and floor streak, and no moon veil (the disc covers the moon)', async () => {
    setup('sun');
    render(<Unwind />);
    await flush();
    const sun = document.querySelector('.w-sun')!;
    expect(sun.querySelector('.w-halo')).not.toBeNull();
    expect(sun.querySelector('.w-streak')).not.toBeNull();
    expect(sun.querySelector('.w-screen iframe')).not.toBeNull();
  });

  it.each(IDS)('%s: the frame goes when a call starts, the page hides or Unwind is left, and does not come back', async (look) => {
    setup(look);
    const { unmount } = render(<Unwind />);
    await flush();
    expect(document.querySelector('iframe')).not.toBeNull();
    act(() => useSignalStore.setState({ call: { kind: 'teams', since: 0, camera: false } as never }));
    expect(document.querySelector('iframe')).toBeNull();
    act(() => useSignalStore.setState({ call: null }));
    await flush(1000);
    expect(document.querySelector('iframe')).toBeNull();

    act(() => useWatchStore.getState().play({ kind: 'video', id: V }));
    expect(document.querySelector('iframe')).not.toBeNull();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(document.querySelector('iframe')).toBeNull();
    hidden.mockRestore();
    act(() => document.dispatchEvent(new Event('visibilitychange')));

    act(() => useWatchStore.getState().play({ kind: 'video', id: V }));
    expect(document.querySelector('iframe')).not.toBeNull();
    act(() => usePlaceStore.getState().setActive('work'));
    expect(useWatchStore.getState().playing).toBeNull();
    unmount();
  });

  it('switches through all four looks from the Look switch without restarting the video (the same frame, the same address)', async () => {
    setup('feather');
    render(<Unwind />);
    await flush();
    const frame = document.querySelector('iframe')!;
    const src = frame.getAttribute('src');
    expect(src).toContain(V);
    const seen: string[] = [];
    for (const name of ['Whole sky', 'The sun', 'Drive-in', 'Feathered']) {
      await act(async () => within(screen.getByRole('radiogroup', { name: 'Look' })).getByRole('radio', { name }).click());
      seen.push(document.querySelector('.w-stage')!.getAttribute('data-look')!);
      expect(document.querySelectorAll('iframe').length).toBe(1);
      // A new frame would reload the player and start the video again: it must be the same node.
      expect(document.querySelector('iframe')).toBe(frame);
      expect(frame.isConnected).toBe(true);
      expect(frame.getAttribute('src')).toBe(src);
    }
    expect(seen).toEqual(['sky', 'sun', 'drivein', 'feather']);
    expect(parseLooks(localStorage.getItem(LOOKS_KEY)).all).toBe('feather');
  });
});

describe('the settings sheet with four looks', () => {
  it('offers four tiles in one-look mode and four choices on each row per kind', async () => {
    setup('drivein');
    render(<Unwind />);
    await flush();
    await act(async () => screen.getByRole('button', { name: 'How video is shown' }).click());
    const all = screen.getByRole('radiogroup', { name: 'Look for everything' });
    const tiles = all.querySelectorAll('[role=radio]');
    expect([...tiles].map((t) => t.textContent)).toEqual(['Feathered', 'Whole sky', 'The sun', 'Drive-in']);
    await act(async () => within(all).getByRole('radio', { name: /The sun/ }).click());
    expect(parseLooks(localStorage.getItem(LOOKS_KEY))).toMatchObject({ mode: 'one', all: 'sun' });
    expect(document.querySelector('.w-stage')?.getAttribute('data-look')).toBe('sun');
    expect(screen.getByText(/only its middle shows/)).toBeTruthy();

    await act(async () => screen.getByRole('radio', { name: 'A look for each kind' }).click());
    for (const name of ['Look for videos and playlists', 'Look for live streams', 'Look for twitch']) {
      const row = screen.getByRole('radiogroup', { name });
      expect([...row.querySelectorAll('[role=radio]')].map((b) => b.textContent)).toEqual(['Feathered', 'Whole sky', 'The sun', 'Drive-in']);
    }
    const videos = screen.getByRole('radiogroup', { name: 'Look for videos and playlists' });
    await act(async () => ([...videos.querySelectorAll('[role=radio]')].find((b) => b.textContent === 'Whole sky') as HTMLElement).click());
    const twitch = screen.getByRole('radiogroup', { name: 'Look for twitch' });
    await act(async () => ([...twitch.querySelectorAll('[role=radio]')].find((b) => b.textContent === 'The sun') as HTMLElement).click());
    expect(parseLooks(localStorage.getItem(LOOKS_KEY))).toMatchObject({ mode: 'kind', video: 'sky', twitch: 'sun' });
    expect(document.querySelector('.w-stage')?.getAttribute('data-look')).toBe('sky');
  });
});
