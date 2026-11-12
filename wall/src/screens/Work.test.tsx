import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { useFocusStore } from '../focus/store';
import { resetNowPlaying } from '../music/store';
import { usePlaceStore } from '../state/places';
import { Screens } from './Screens';

const at = (h: number, m: number) => new Date(2026, 10, 11, h, m);
const weather = {
  current: { time: '2026-11-11T10:15', temperature_2m: 57.6, weather_code: 3, is_day: 1 },
  hourly: {
    time: Array.from({ length: 24 }, (_, i) => `2026-11-11T${String(i).padStart(2, '0')}:00`),
    temperature_2m: Array.from({ length: 24 }, () => 50),
    weather_code: Array.from({ length: 24 }, () => 0),
  },
  daily: { temperature_2m_max: [61], temperature_2m_min: [44] },
};

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

let meet: () => unknown;
beforeEach(() => {
  useFocusStore.getState().dispose();
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(at(10, 24));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => weather })));
  meet = () => ({
    accounts: [{ id: 'work', label: 'Work', state: 'ok' }],
    meetings: [{ key: 'k', accountId: 'work', title: 'Call with Dana', start: at(12, 0).toISOString(), end: at(12, 30).toISOString(), canJoin: true }],
  });
  mocks.set('wall2_meet_next', () => meet());
  mocks.set('wall2_meet_day', () => ({ accounts: [], events: [] }));
  mocks.set('wall2_tasks_summary', () => ({ next: [], remaining: 0, dueTomorrow: { count: 0, estMinutes: 0 } }));
  mocks.set('get_now_playing', () => ({ playback_status: 'stopped' }));
  mocks.set('wall2_machines', () => ({ pc: { cpuPct: 34, gpuPct: 71, ramPct: 58 }, box: null, boxStale: false }));
  mocks.set('get_do_not_disturb', () => false);
  usePlaceStore.setState({ active: 'work' });
});
afterEach(() => {
  useFocusStore.getState().dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  mocks.clear();
  resetNowPlaying();
});

it('lays Work out on the three zones: left wing, the centre fill, the next three', async () => {
  const r = render(<Screens />);
  await flush();
  const work = r.container.querySelector('.work.zones')!;
  const zones = [...work.children].map((c) => c.className);
  expect(zones).toEqual(['wing wl', 'centre centre-fill', 'wing wr']);
  // The centre is never an empty "Agents" card: the full focus timer and weather fill it.
  const centre = work.querySelector('.centre')!;
  expect(centre.querySelector('[aria-label="Focus timer"]')).not.toBeNull();
  expect(centre.querySelector('[aria-label="Weather"]')!.textContent).toContain('High 61°');
  expect(centre.textContent).not.toMatch(/Agents|Not set up/);
  expect(work.querySelector('.wr [aria-label="Tasks"]')).not.toBeNull();
});

it('puts the weather after the date and reads the weather once', async () => {
  const r = render(<Screens />);
  await flush();
  expect(r.container.querySelector('.clk-date')!.textContent).toBe('Wednesday, November 1158°, overcast');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('shows Next as "12:00, in 1 h 36 m", ticking, and hides it when Meet is not set up', async () => {
  const r = render(<Screens />);
  await flush();
  expect(screen.getByText('Call with Dana')).toBeTruthy();
  expect(screen.getByText('12:00, in 1 h 36 m')).toBeTruthy();
  await flush(60_000);
  expect(screen.getByText('12:00, in 1 h 35 m')).toBeTruthy();
  r.unmount();
  meet = () => {
    throw new Error('not-configured');
  };
  const again = render(<Screens />);
  await flush();
  expect(again.container.querySelector('.next')).toBeNull();
});

it('shows the machines at the bottom of the left wing', async () => {
  const r = render(<Screens />);
  await flush();
  const wing = r.container.querySelector('.wl')!;
  expect(wing.lastElementChild!.getAttribute('aria-label')).toBe('Machines');
});
