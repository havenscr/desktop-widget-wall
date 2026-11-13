import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePlaceStore } from '../state/places';
import { resetTip } from '../ui/HoverTip';
import { useChipLayout } from './layout';
import { CHIP_TIP, elapsedText, FloatingRecordingChip, HeaderRecordingChip } from './RecordingChip';
import { isQuietForRecording, useSignalStore } from './store';

// Fake timers step through up to a minute here; the stepped span stays short, and the limit is generous for a slow runner.
vi.setConfig({ testTimeout: 20_000 });

const step = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const set = (over: Partial<ReturnType<typeof useSignalStore.getState>>) => act(() => useSignalStore.setState(over));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 12, 10, 0));
  usePlaceStore.setState({ active: 'work', from: 'work', zenDream: false });
  useSignalStore.setState({ known: true, call: null, recording: false, leave: null });
  useChipLayout.setState({ banner: false, header: false });
});
afterEach(() => {
  resetTip();
  vi.useRealTimers();
  useSignalStore.setState({ known: false, call: null, recording: false, leave: null });
  useChipLayout.setState({ banner: false, header: false });
});

it('writes the time as mm:ss, and h:mm:ss from the first hour', () => {
  expect(elapsedText(0)).toBe('00:00');
  expect(elapsedText(4 * 60_000 + 12_000)).toBe('04:12');
  expect(elapsedText(59 * 60_000 + 59_999)).toBe('59:59');
  expect(elapsedText(3_600_000 + 4 * 60_000 + 12_000)).toBe('1:04:12');
  expect(elapsedText(-5)).toBe('00:00');
});

it('counts from when the recording became true and starts again for the next one', async () => {
  render(<FloatingRecordingChip />);
  expect(document.querySelector('.rec-chip')).toBeNull();
  set({ recording: true });
  await step(0);
  expect(screen.getByText('00:00')).toBeTruthy();
  await step(65_000);
  expect(screen.getByText('01:05')).toBeTruthy();
  set({ recording: false });
  await step(1_000);
  expect(document.querySelector('.rec-chip')).toBeNull();
  set({ recording: true });
  await step(2_000);
  expect(screen.getByText('00:02')).toBeTruthy();
});

it('says what the chip means, honestly', async () => {
  render(<FloatingRecordingChip />);
  set({ recording: true });
  await step(0);
  const chip = document.querySelector('.rec-chip')!;
  expect(chip.getAttribute('aria-label')).toBe('Recording 00:00');
  expect(CHIP_TIP).toContain('microphone or camera');
  expect(CHIP_TIP).toContain('wall noticed');
});

it('floats at the banner position on Home, Unwind and Meet, never on Zen', async () => {
  render(<FloatingRecordingChip />);
  set({ recording: true });
  for (const place of ['home', 'unwind', 'meet'] as const) {
    act(() => usePlaceStore.getState().setActive(place));
    await step(0);
    expect(document.querySelector('.rec-float')?.getAttribute('data-at'), place).toBe('start');
  }
  act(() => usePlaceStore.getState().setActive('zen'));
  await step(0);
  expect(document.querySelector('.rec-chip')).toBeNull();
});

it('on Work sits in the Agents header and does not float while the header is there', async () => {
  render(
    <>
      <FloatingRecordingChip />
      <div className="lanes-hd-l">
        <HeaderRecordingChip compact={false} />
      </div>
    </>,
  );
  set({ recording: true });
  await step(0);
  expect(document.querySelector('.lanes-hd-l .rec-chip')).not.toBeNull();
  expect(document.querySelector('.rec-float')).toBeNull();
  expect(useChipLayout.getState().header).toBe(true);
});

it('the floating chip covers the header case: with no header on Work it floats at the end', async () => {
  render(<FloatingRecordingChip />);
  set({ recording: true });
  await step(0);
  expect(document.querySelector('.rec-float')?.getAttribute('data-at')).toBe('end');
});

it('the header chip gives way to the banner, which carries it', async () => {
  render(<HeaderRecordingChip compact={false} />);
  set({ recording: true });
  await step(0);
  expect(document.querySelector('.rec-chip')).not.toBeNull();
  act(() => useChipLayout.setState({ banner: true }));
  await step(0);
  expect(document.querySelector('.rec-chip')).toBeNull();
});

it('the compact chip drops the word and keeps the time', async () => {
  render(<HeaderRecordingChip compact />);
  set({ recording: true });
  await step(3_000);
  expect(screen.queryByText('Recording')).toBeNull();
  expect(screen.getByText('00:03')).toBeTruthy();
});

it('Watt is asked to be quiet only while a recording is known', () => {
  expect(isQuietForRecording()).toBe(false);
  useSignalStore.setState({ known: true, recording: true });
  expect(isQuietForRecording()).toBe(true);
  expect(isQuietForRecording({ known: false, recording: true })).toBe(false);
  expect(isQuietForRecording({ known: true, recording: false })).toBe(false);
});
