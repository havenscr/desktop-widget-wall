import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { Rail } from '../rail/Rail';
import { usePlaceStore } from '../state/places';
import { AlarmChip } from './AlarmChip';
import { NetworkTile } from './NetworkTile';
import { ALARM_MAX_AGE_MS, alarmChipText, openAlarms } from './useSecurity';

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-11T12:00:00Z'));
  usePlaceStore.setState({ active: 'work' });
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
});

const sec = (over: Record<string, unknown> = {}) => ({
  reachable: true,
  stale: false,
  lastScan: '2026-11-11T11:56:00Z',
  alerts: 1,
  firewalla: { api: 'up', boxOnline: true, checkedAt: null, alarms24h: 1 },
  portalUrl: null,
  ...over,
});

const dot = (c: HTMLElement) => c.querySelector('.rb-alarm');

it('words the chip for one and for many', () => {
  expect(alarmChipText(1)).toBe('1 network alert');
  expect(alarmChipText(4)).toBe('4 network alerts');
});

it('counts only a current good read', () => {
  const good = sec({ alerts: 3 }) as never;
  expect(openAlarms({ status: 'ready', summary: good })).toBe(3);
  expect(openAlarms({ status: 'error', summary: good })).toBe(0);
  expect(openAlarms({ status: 'loading', summary: null })).toBe(0);
  expect(openAlarms({ status: 'unconfigured', summary: null })).toBe(0);
  expect(openAlarms({ status: 'ready', summary: sec({ stale: true, alerts: 3 }) as never })).toBe(0);
  expect(openAlarms({ status: 'ready', summary: sec({ reachable: false, alerts: 3 }) as never })).toBe(0);
  expect(openAlarms({ status: 'ready', summary: sec({ alerts: 0 }) as never })).toBe(0);
});

it('puts a dot on Home in the rail and a chip that goes to Home', async () => {
  mocks.set('wall2_home_security', () => sec());
  const { container } = render(
    <>
      <Rail />
      <AlarmChip className="xs lanes-alarm" />
    </>,
  );
  await flush();
  expect(dot(container)).toBeTruthy();
  const chip = screen.getByRole('button', { name: '1 network alert. Show them on Home' });
  expect(chip.textContent).toBe('1 network alert');
  fireEvent.click(chip);
  expect(usePlaceStore.getState().active).toBe('home');
});

it('shows nothing when the source is not set up or down', async () => {
  mocks.set('wall2_home_security', () => Promise.reject(new Error('not-configured')));
  const a = render(<Rail />);
  await flush();
  expect(dot(a.container)).toBeNull();
  a.unmount();
  mocks.set('wall2_home_security', () => Promise.reject(new Error('Could not reach the service')));
  const b = render(<Rail />);
  await flush();
  expect(dot(b.container)).toBeNull();
});

it('shows nothing from a stale scan', async () => {
  mocks.set('wall2_home_security', () => sec({ stale: true, alerts: 2 }));
  const { container } = render(
    <>
      <Rail />
      <AlarmChip className="u-act" period />
    </>,
  );
  await flush();
  expect(dot(container)).toBeNull();
  expect(screen.queryByText(/network alert/)).toBeNull();
});

it('takes the dot away when a later read fails (never from old data)', async () => {
  let fail = false;
  mocks.set('wall2_home_security', () => (fail ? Promise.reject(new Error('Could not reach the service')) : sec({ alerts: 2 })));
  const { container } = render(<Rail />);
  await flush();
  expect(dot(container)).toBeTruthy();
  fail = true;
  await flush(300_000);
  expect(dot(container)).toBeNull();
});

it('shares one poll between the rail and Home network card', async () => {
  let calls = 0;
  mocks.set('wall2_home_security', () => {
    calls += 1;
    return sec();
  });
  render(
    <>
      <Rail />
      <NetworkTile />
      <AlarmChip className="u-act" period />
    </>,
  );
  await flush();
  expect(calls).toBe(1);
  await flush(300_000);
  expect(calls).toBe(2);
});

it('the compact chip is a dot and a count, with the words in its name and hover', async () => {
  mocks.set('wall2_home_security', () => sec({ alerts: 4 }));
  render(<AlarmChip className="xs lanes-alarm" compact />);
  await flush();
  const chip = screen.getByRole('button', { name: '4 network alerts. Show them on Home' });
  expect(chip.textContent).toBe('4');
  expect(chip.querySelector('.alarm-dot')).not.toBeNull();
});

const hide = (hidden: boolean) => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
  document.dispatchEvent(new Event('visibilitychange'));
};

it('after a long hidden spell the dot waits for a new read, never showing the old one', async () => {
  let release: (() => void) | null = null;
  let hold = false;
  mocks.set('wall2_home_security', () => (hold ? new Promise((r) => (release = () => r(sec({ alerts: 2 })))) : sec({ alerts: 2 })));
  const { container } = render(<Rail />);
  await flush();
  expect(dot(container)).toBeTruthy();
  try {
    await act(async () => hide(true));
    await act(async () => {
      vi.setSystemTime(Date.now() + ALARM_MAX_AGE_MS + 60_000);
    });
    hold = true;
    await act(async () => hide(false));
    await flush();
    // The kept read is too old: nothing shows while the new one is on its way.
    expect(dot(container)).toBeNull();
    await act(async () => release?.());
    await flush();
    expect(dot(container)).toBeTruthy();
  } finally {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  }
});

it('the shared poll reads nothing while the page is hidden, and stops and restarts with its readers', async () => {
  let calls = 0;
  mocks.set('wall2_home_security', () => {
    calls += 1;
    return sec();
  });
  const first = render(<Rail />);
  await flush();
  expect(calls).toBe(1);
  try {
    await act(async () => hide(true));
    await flush(300_000 * 3);
    expect(calls).toBe(1);
    await act(async () => hide(false));
    await flush();
    expect(calls).toBe(2);
  } finally {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  }
  first.unmount();
  await flush(300_000 * 3);
  expect(calls).toBe(2);
  const again = render(<Rail />);
  await flush();
  expect(calls).toBe(3);
  expect(dot(again.container)).toBeTruthy();
  await flush(300_000);
  expect(calls).toBe(4);
});
