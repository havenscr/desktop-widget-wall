// @ts-ignore node's own file call; the stylesheet rules are read as text.
import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { resetNowPlaying } from '../../music/store';
import { useSignalStore } from '../../signals/store';
import { usePlaceStore } from '../../state/places';
import { resetHome, useHome } from '../../studio/homeStore';
import { resetLastPlayed } from '../lastPlayed';
import { LOOKS_KEY } from './looks';
import { framePoster } from './PlayerFrame';
import { useWatchRest } from './rest';
import { SAVED_KEY, type SavedItem } from './saved';
import { resetWatch, useWatchStore } from './store';
import { UnwindView } from './testView';
import { CTL_REST_MS } from './Watch';

// The Watch list card and the Office moods line rest with the controls (the controls' own rules are in behaviour.test.tsx).
vi.setConfig({ testTimeout: 20_000 });

const V = 'Ab3dEfGh1jK';
const ITEMS: SavedItem[] = [
  { kind: 'video', id: V, label: 'Night drive mix' },
  { kind: 'twitch', id: 'pixel_harbor', label: 'pixel_harbor' },
];
const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const ctl = () => document.querySelector('.w-now')?.getAttribute('data-ctl') ?? null;
const card = () => document.querySelector<HTMLElement>('.w-card')!;
const line = () => document.querySelector<HTMLElement>('.u-office-line')!;
const cardRest = () => card().getAttribute('data-rest');
const lineRest = () => line().getAttribute('data-rest');

async function playing(items: SavedItem[] = ITEMS) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(items));
  localStorage.setItem(LOOKS_KEY, JSON.stringify({ mode: 'one', all: 'drivein' }));
  resetWatch();
  useWatchStore.getState().setTab('watch');
  useWatchStore.getState().play(ITEMS[0]);
  useWatchStore.getState().setReport({ started: true });
  render(<UnwindView />);
  await flush();
  await flush(); // the moods read lands
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetWatch();
  resetHome();
  usePlaceStore.setState({ active: 'unwind', from: 'work' });
  useSignalStore.setState({ call: null });
  mocks.set('get_now_playing', () => null);
  mocks.set('wall2_office_moods', () => ({
    stale: false,
    moods: [{ id: 'brightDesk', label: 'Bright desk', line: 'Room 70%', active: false }],
    off: null,
    canWrite: false,
    writeBlock: 'not-set-up',
  }));
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  resetNowPlaying();
  resetLastPlayed();
  resetHome();
  localStorage.clear();
  framePoster.render = null;
});

describe('the Watch list card and the Office moods line rest with the controls', () => {
  it('both are shown at first, fade with the controls after 3 seconds, and the moods chips stay', async () => {
    await playing();
    expect(line().textContent).toContain('Office moods are view only here');
    expect([cardRest(), lineRest(), ctl()]).toEqual(['false', 'false', 'shown']);
    await flush(CTL_REST_MS - 100);
    expect([cardRest(), lineRest()]).toEqual(['false', 'false']);
    await flush(100);
    expect([cardRest(), lineRest(), ctl()]).toEqual(['true', 'true', 'rest']);
    expect(document.querySelector('.u-mood')!.closest('[data-rest]')).toBeNull();
  });

  it('come back when the pointer enters the card, and rest again 3 seconds after it leaves', async () => {
    await playing();
    await flush(CTL_REST_MS);
    fireEvent.pointerEnter(card());
    expect([cardRest(), lineRest(), ctl()]).toEqual(['false', 'false', 'shown']);
    await flush(CTL_REST_MS * 3);
    expect([cardRest(), lineRest(), ctl()]).toEqual(['false', 'false', 'shown']);
    fireEvent.pointerLeave(card());
    await flush(CTL_REST_MS);
    expect([cardRest(), lineRest(), ctl()]).toEqual(['true', 'true', 'rest']);
  });

  it('come back when the pointer enters the moods row or the line box', async () => {
    await playing();
    await flush(CTL_REST_MS);
    fireEvent.pointerEnter(document.querySelector('[data-slot="office-lights"]')!);
    expect([cardRest(), lineRest()]).toEqual(['false', 'false']);
    fireEvent.pointerLeave(document.querySelector('[data-slot="office-lights"]')!);
    await flush(CTL_REST_MS);
    expect(lineRest()).toBe('true');
    fireEvent.pointerEnter(line());
    expect([cardRest(), lineRest()]).toEqual(['false', 'false']);
  });

  it('come back on the same triggers as the controls: a Tab press, keyboard focus, the left block and the band', async () => {
    await playing();
    await flush(CTL_REST_MS);
    fireEvent.keyDown(document.body, { key: 'Tab' });
    expect([cardRest(), lineRest()]).toEqual(['false', 'false']);
    await flush(CTL_REST_MS);
    expect(cardRest()).toBe('true');
    fireEvent.pointerEnter(document.querySelector('.w-now')!);
    expect([cardRest(), lineRest()]).toEqual(['false', 'false']);
    fireEvent.pointerLeave(document.querySelector('.w-now')!);
    await flush(CTL_REST_MS);
    expect(cardRest()).toBe('true');
    const band = document.querySelector('.w-edge')!;
    fireEvent.pointerEnter(band);
    expect(cardRest()).toBe('false');
    fireEvent.pointerLeave(band);
    await flush(CTL_REST_MS);
    const field = card().querySelector<HTMLInputElement>('.w-paste')!;
    act(() => field.focus());
    expect(cardRest()).toBe('false');
    await flush(CTL_REST_MS * 3);
    expect(cardRest()).toBe('false');
    act(() => field.blur());
    await flush(CTL_REST_MS);
    expect(cardRest()).toBe('true');
  });

  it('the card never rests while its field has text, while a rename is open, or while the new playlist form is open', async () => {
    await playing();
    const field = card().querySelector<HTMLInputElement>('.w-paste')!;
    fireEvent.change(field, { target: { value: 'twitch.tv/some_channel' } });
    await flush(CTL_REST_MS * 2);
    expect(ctl()).toBe('rest');
    expect(cardRest()).toBe('false');
    expect(lineRest()).toBe('true');
    fireEvent.change(field, { target: { value: '' } });
    await flush();
    expect(cardRest()).toBe('true');
    fireEvent.pointerEnter(card());
    act(() => useWatchStore.getState().setEditing(`video:${V}`));
    fireEvent.pointerLeave(card());
    await flush(CTL_REST_MS * 2);
    expect(cardRest()).toBe('false');
    act(() => useWatchStore.getState().setEditing(null));
    await flush(CTL_REST_MS);
    expect(cardRest()).toBe('true');
    fireEvent.pointerEnter(card());
    await act(async () => screen.getByRole('button', { name: /New playlist/ }).click());
    fireEvent.pointerLeave(card());
    await flush(CTL_REST_MS * 2);
    expect(cardRest()).toBe('false');
  });

  it('the card never rests while its add-to-playlist menu is open', async () => {
    await playing();
    await flush(CTL_REST_MS);
    expect(cardRest()).toBe('true');
    fireEvent.pointerEnter(card());
    await act(async () => screen.getByRole('button', { name: `Add Night drive mix to a playlist` }).click());
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.pointerLeave(card());
    await flush(CTL_REST_MS * 2);
    expect(useWatchRest.getState().cardHeld).toBe(true);
    expect(cardRest()).toBe('false');
  });

  it('the card never rests while a delete question is open', async () => {
    await playing([...ITEMS, { kind: 'own', id: 'ownlist00001', label: 'Mine' }]);
    await flush(CTL_REST_MS);
    expect(cardRest()).toBe('true');
    fireEvent.pointerEnter(card());
    await act(async () => screen.getByRole('button', { name: 'Delete Mine' }).click());
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.pointerLeave(card());
    await flush(CTL_REST_MS * 2);
    // Only the card's own question holds it: the controls have gone to rest.
    expect(ctl()).toBe('rest');
    expect(useWatchRest.getState().cardHeld).toBe(true);
    expect(cardRest()).toBe('false');
  });

  it('leaving Watch clears the shared rest state and leaves no timer alive', async () => {
    await playing();
    await flush(CTL_REST_MS);
    expect(useWatchRest.getState().rest).toBe(true);
    act(() => useWatchStore.getState().setTab('listen'));
    await flush();
    expect(useWatchRest.getState()).toEqual({ rest: false, cardHeld: false, wall: false });
    // Back with a countdown pending, then away again before it ends: nothing fires later.
    act(() => useWatchStore.getState().setTab('watch'));
    await flush();
    act(() => useWatchStore.getState().setTab('listen'));
    await flush();
    const timers = vi.getTimerCount();
    await flush(CTL_REST_MS * 3);
    expect(useWatchRest.getState().rest).toBe(false);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(timers);
  });

  it('nothing rests while nothing plays, while the video is paused, or while the player waits for a click', async () => {
    await playing();
    await flush(CTL_REST_MS);
    expect(cardRest()).toBe('true');
    act(() => useWatchStore.getState().setPaused(true));
    await flush();
    expect([cardRest(), lineRest()]).toEqual(['false', 'false']);
    act(() => useWatchStore.getState().setPaused(false));
    await flush(CTL_REST_MS);
    expect(cardRest()).toBe('true');
    act(() => useWatchStore.getState().setNeedsClick(true));
    await flush(CTL_REST_MS);
    expect([cardRest(), lineRest()]).toEqual(['false', 'false']);
    act(() => useWatchStore.getState().setNeedsClick(false));
    await flush(CTL_REST_MS);
    expect(cardRest()).toBe('true');
    await act(async () => useWatchStore.getState().stop());
    await flush(CTL_REST_MS);
    expect([cardRest(), lineRest()]).toEqual(['false', 'false']);
  });

  it('a failure message on the moods line holds the line in view until it ends', async () => {
    await playing();
    await flush(CTL_REST_MS);
    expect(lineRest()).toBe('true');
    act(() => useHome.setState({ moodFail: { id: 'brightDesk', word: 'refused' } }));
    expect(lineRest()).toBe('false');
    expect(cardRest()).toBe('true');
    // Each part rests unless IT is held: the failure keeps neither the controls nor the card awake.
    expect(ctl()).toBe('rest');
    act(() => useHome.setState({ moodFail: null }));
    expect(lineRest()).toBe('true');
  });

  it('at rest the card takes no pointer for its contents, and both fade with the same ease; reduced motion changes at once', () => {
    const css = readFileSync('src/styles/unwind.css', 'utf8') as string;
    expect(css).toMatch(/\.w-card,\s*\.u-office-line \{\s*transition: opacity 250ms ease;/);
    expect(css).toMatch(/\.w-card\[data-rest='true'\] > \* \{\s*pointer-events: none;/);
    expect(css).toMatch(/\.u-office-line\[data-rest='true'\] \{\s*pointer-events: auto;/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{[^}]*\.w-card,\s*\.u-office-line \{\s*transition: none;/);
  });
});
