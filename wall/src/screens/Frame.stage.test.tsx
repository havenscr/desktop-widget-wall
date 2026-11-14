import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { usePlaceStore, type PlaceId } from '../state/places';
import { resetWatch, useWatchStore } from '../unwind/watch/store';
import { Screens } from './Screens';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 11, 10, 24));
  mocks.set('wall2_meet_day', () => ({ accounts: [], events: [] }));
  resetWatch();
  useWatchStore.getState().setTab('watch');
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  usePlaceStore.setState({ active: 'work' });
});

// The real frame must mount the video's layer on every place, inside the top band, or a video
// would stop when the owner leaves Unwind (the test view mounts its own layer, so it cannot tell).
it('the screens frame mounts the video layer inside the top band, on Work and on Unwind', async () => {
  for (const place of ['work', 'unwind', 'home'] as PlaceId[]) {
    usePlaceStore.setState({ active: place });
    const r = render(<Screens />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const layers = r.container.querySelectorAll('.main > .top > .w-layer');
    expect(layers.length, place).toBe(1);
    expect(layers[0].getAttribute('data-shown'), place).toBe(place === 'unwind' ? 'true' : 'false');
    r.unmount();
  }
});
