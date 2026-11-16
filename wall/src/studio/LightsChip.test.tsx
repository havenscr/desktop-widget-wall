import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { useSignalStore } from '../signals/store';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import { LightsChip } from './LightsChip';
import { resetHome } from './homeStore';
import { resetKeyLights, useKeyLights } from './store';

vi.setConfig({ testTimeout: 20_000 });

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
type Cell = { set: boolean; light: { on: boolean; brightness: number; kelvin: number } | null; word: string | null };
const good = (on = true, b = 60, k = 4400): Cell => ({ set: true, light: { on, brightness: b, kelvin: k }, word: null });
const reading = (c: Cell) => (!c.set ? 'not-set-up' : (c.word ?? c.light));
let left: Cell;
let right: Cell;

beforeEach(() => {
  vi.useFakeTimers();
  resetKeyLights();
  resetHome();
  mocks.set('wall2_studio', () => {
    throw 'absent';
  });
  resetTip();
  useSignalStore.setState({ recording: true });
  left = good();
  right = good();
  mocks.set('wall2_keylights_status', () => ({ left: { set: left.set }, right: { set: right.set } }));
  mocks.set('wall2_keylights_read', () => ({ left: reading(left), right: reading(right) }));
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  useSignalStore.setState({ recording: false });
});

const show = async () => {
  const view = render(
    <>
      <LightsChip />
      <HoverTipLayer />
    </>,
  );
  await flush();
  return view;
};

it('says the key lights percent while a recording runs and both are on and matched', async () => {
  await show();
  expect(screen.getByText('Lights: key lights 60%')).toBeTruthy();
});

it('says on when they differ, off when both are off', async () => {
  right = good(true, 45, 4700);
  const { unmount } = await show();
  expect(screen.getByText('Lights: key lights on')).toBeTruthy();
  unmount();
  resetKeyLights();
  left = good(false);
  right = good(false);
  await show();
  expect(screen.getByText('Lights: key lights off')).toBeTruthy();
});

it('is hidden when no recording runs', async () => {
  useSignalStore.setState({ recording: false });
  await show();
  expect(screen.queryByText(/Lights:/)).toBeNull();
});

it('is hidden when the key lights are not set up, and reads nothing it has no address for', async () => {
  left = { set: false, light: null, word: null };
  right = { set: false, light: null, word: null };
  const read = vi.fn(() => ({ left: 'not-set-up', right: 'not-set-up' }));
  mocks.set('wall2_keylights_read', read);
  await show();
  expect(screen.queryByText(/Lights:/)).toBeNull();
  expect(read).not.toHaveBeenCalled();
});

it('a click opens the drawer over Work, and closing it leaves the chip', async () => {
  await show();
  fireEvent.click(screen.getByText('Lights: key lights 60%'));
  expect(useKeyLights.getState().drawer).toBe(true);
  expect(document.querySelector('.st-drawer')).toBeTruthy();
  useKeyLights.getState().setDrawer(false);
  await flush();
  expect(document.querySelector('.st-drawer')).toBeNull();
  expect(screen.getByText('Lights: key lights 60%')).toBeTruthy();
});

it('has a tip that says what it shows and what a click does', async () => {
  await show();
  const chip = screen.getByText('Lights: key lights 60%').closest('button')!;
  fireEvent.mouseEnter(chip);
  await flush(300);
  expect(document.querySelector('.hover-tip')?.textContent).toContain('Click to open the sliders');
});

it('stops reading when the recording ends and nothing else shows it', async () => {
  const read = vi.fn(() => ({ left: reading(left), right: reading(right) }));
  mocks.set('wall2_keylights_read', read);
  await show();
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => useSignalStore.setState({ recording: false }));
  const n = read.mock.calls.length;
  await flush(120_000);
  expect(read.mock.calls.length).toBe(n);
});

it('is compact on request: Lights 60%', async () => {
  const view = render(<LightsChip compact />);
  await flush();
  expect(view.getByText('Lights 60%')).toBeTruthy();
});

it('a header that remounts while the drawer is open keeps it open', async () => {
  useKeyLights.getState().setDrawer(true);
  const first = await show();
  first.unmount();
  expect(useKeyLights.getState().drawer).toBe(true);
  await show();
  expect(document.querySelector('.st-drawer')).toBeTruthy();
});
