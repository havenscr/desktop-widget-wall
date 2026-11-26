import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { resetNowPlaying } from '../music/store';
import { resetHome } from '../studio/homeStore';
import { resetLastPlayed } from '../unwind/lastPlayed';
import { CTL_REST_MS, useWatchRest } from '../unwind/watch/rest';
import { resetWatch, useWatchStore } from '../unwind/watch/store';
import { useWorkLayerStore } from '../unwind/work/layerStore';
import { LAYER_CLOSE_MS } from '../unwind/work/useWorkLayer';
import { Frame } from './Frame';
import { Unwind } from './Unwind';

const PLAYING = { title: 'Tokyo Burnout', artist: 'Tokyo Rose', playback_status: 'playing', position_seconds: 5, duration_seconds: 250 };
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetWatch();
  resetHome();
  useWatchRest.setState({ rest: false, cardHeld: false, wall: false });
  useWorkLayerStore.setState({ shown: false, held: false, panel: false });
  useWatchStore.getState().setTab('listen');
  mocks.set('get_now_playing', () => PLAYING);
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  resetNowPlaying();
  resetLastPlayed();
  localStorage.clear();
});
const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const main = () => document.querySelector<HTMLElement>('.main')!;
const resting = () => document.querySelector('.unwind')!.getAttribute('data-listen-rest') === 'true';

it('the controls and the work layer show together on one hover and hide together after the hold', async () => {
  render(
    <Frame place="unwind">
      <Unwind />
    </Frame>,
  );
  await flush(CTL_REST_MS + 300);
  expect(resting()).toBe(true);
  expect(main().hasAttribute('data-work-shown')).toBe(false);
  fireEvent.pointerEnter(main());
  await flush(50);
  expect(resting()).toBe(false);
  expect(main().hasAttribute('data-work-shown')).toBe(true);
  fireEvent.pointerMove(main(), { clientX: 900, clientY: 300 });
  await flush(CTL_REST_MS * 2);
  expect(resting()).toBe(false);
  expect(main().hasAttribute('data-work-shown')).toBe(true);
  fireEvent.pointerLeave(main());
  await flush(LAYER_CLOSE_MS - 100);
  expect(resting()).toBe(false);
  expect(main().hasAttribute('data-work-shown')).toBe(true);
  await flush(200);
  expect(resting()).toBe(true);
  expect(main().hasAttribute('data-work-shown')).toBe(false);
});

it('a held panel keeps the layer and the controls up together after the pointer leaves', async () => {
  render(
    <Frame place="unwind">
      <Unwind />
    </Frame>,
  );
  await flush(CTL_REST_MS + 300);
  expect(resting()).toBe(true);
  fireEvent.pointerEnter(main());
  await flush(50);
  act(() => useWorkLayerStore.setState({ panel: true }));
  fireEvent.pointerLeave(main());
  await flush(LAYER_CLOSE_MS + CTL_REST_MS + 500);
  expect(main().hasAttribute('data-work-shown')).toBe(true);
  expect(resting()).toBe(false);
  act(() => useWorkLayerStore.setState({ panel: false }));
  await flush(LAYER_CLOSE_MS + 200);
  expect(main().hasAttribute('data-work-shown')).toBe(false);
  expect(resting()).toBe(true);
});
