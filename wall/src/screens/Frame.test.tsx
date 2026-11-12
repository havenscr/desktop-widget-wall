import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { usePlaceStore, type PlaceId } from '../state/places';
import { ribbonKind } from './Frame';
import { Screens } from './Screens';

beforeEach(() => {
  vi.useFakeTimers();
  mocks.set('wall2_meet_day', () => ({ accounts: [], events: [] }));
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  usePlaceStore.setState({ active: 'work' });
});

async function show(place: PlaceId) {
  usePlaceStore.setState({ active: place });
  const r = render(<Screens />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return r;
}

it('puts the ribbon on Work, Home and Meet in the three-row frame', async () => {
  for (const place of ['work', 'home', 'meet'] as const) {
    const r = await show(place);
    const main = r.container.querySelector('.main')!;
    expect(main.className).toBe('main');
    expect(main.querySelector(':scope > .top .clk')).not.toBeNull();
    expect(main.querySelector(':scope > .band')).not.toBeNull();
    expect(main.querySelector(':scope > .rib')).not.toBeNull();
    r.unmount();
  }
});

it('renders no ribbon on Zen or Unwind', async () => {
  for (const place of ['zen', 'unwind'] as const) {
    const r = await show(place);
    expect(r.container.querySelector('.main')!.className).toBe('main tall');
    expect(r.container.querySelector('.rib')).toBeNull();
    r.unmount();
  }
  expect(ribbonKind('zen')).toBeNull();
  expect(ribbonKind('unwind')).toBeNull();
});

it('Home hosts the moods and the network tile, with no placeholder heading', async () => {
  const r = await show('home');
  expect(r.container.querySelector('h1')).toBeNull();
  expect(r.container.querySelector('.home .moods, .home [aria-label="Moods"]')).not.toBeNull();
  expect(r.container.querySelector('.home .network')).not.toBeNull();
  expect(ribbonKind('home')).toBe('home');
});

it('keeps the same clock element when the place changes', async () => {
  const r = await show('work');
  const clk = r.container.querySelector('.clk');
  act(() => usePlaceStore.setState({ active: 'home' }));
  expect(r.container.querySelector('.clk')).toBe(clk);
});
