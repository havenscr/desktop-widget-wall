import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetAgents } from '../agents/useAgents';
import { mocks } from '../bridge/tauri';
import { useFocusStore } from '../focus/store';
import { resetNowPlaying } from '../music/store';
import { usePlaceStore } from '../state/places';
import { resetWeatherStore } from '../weather/useWeather';
import { resetMeetingFeed } from '../work/useNextMeeting';
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
  mocks.set('wall2_omni_summary', () => {
    throw new Error('not-configured');
  });
  resetAgents();
  usePlaceStore.setState({ active: 'work' });
});
afterEach(() => {
  resetWeatherStore();
  resetMeetingFeed();
  useFocusStore.getState().dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetAgents();
  mocks.clear();
  resetNowPlaying();
});

it('lays Work out on the three zones: left wing, the centre fill, the next three', async () => {
  const r = render(<Screens />);
  await flush();
  const work = r.container.querySelector('.work.zones')!;
  const zones = [...work.children].map((c) => c.className);
  expect(zones).toEqual(['wing wl left-wing', 'centre centre-fill noted', 'wing wr right-wing']);
  // Helper not set up: never an empty "Agents" card. The full focus timer and weather fill
  // the centre, under one quiet header row.
  const centre = work.querySelector('.centre')!;
  expect(centre.querySelector('[aria-label="Focus timer"]')).not.toBeNull();
  expect(centre.querySelector('[aria-label="Weather"]')!.textContent).toContain('High 61°');
  expect(centre.querySelector('.centre-note')!.textContent).toBe('Agentsnot set up');
  expect(centre.querySelector('.lane')).toBeNull();
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
  resetMeetingFeed();
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

it('dims Next with "as of" when the feed marks the list stale', async () => {
  const good = meet;
  let n = 0;
  meet = () => (n++ === 0 ? good() : { ...(good() as object), stale: true });
  const r = render(<Screens />);
  await flush();
  expect(r.container.querySelector('.next')!.className).toBe('blk next');
  await flush(5 * 60_000);
  const next = r.container.querySelector('.next')!;
  expect(next.className).toBe('blk next stale');
  expect(next.querySelector('.next-asof')!.textContent).toBe('as of 10:24');
  // A stale list may be wrong, so no countdown: only the time and the title.
  expect(next.querySelector('.s')!.textContent).toBe('12:00');
  expect(next.textContent).not.toMatch(/in \d/);
});

it('says "may be out of date" for a stale first reply, with no good read to date it', async () => {
  const good = meet;
  meet = () => ({ ...(good() as object), stale: true });
  const r = render(<Screens />);
  await flush();
  expect(r.container.querySelector('.next-asof')!.textContent).toBe('may be out of date');
});

it('keeps the last meeting dimmed with "as of" after a failed refresh, and clears it on the next good read', async () => {
  const good = meet;
  let fail = false;
  meet = () => {
    if (fail) throw new Error('failed');
    return good();
  };
  const r = render(<Screens />);
  await flush();
  fail = true;
  await flush(5 * 60_000);
  const next = r.container.querySelector('.next')!;
  expect(screen.getByText('Call with Dana')).toBeTruthy();
  expect(next.className).toBe('blk next stale');
  expect(next.querySelector('.next-asof')!.textContent).toBe('as of 10:24');
  fail = false;
  await flush(5 * 60_000);
  expect(r.container.querySelector('.next')!.className).toBe('blk next');
  expect(r.container.querySelector('.next-asof')).toBeNull();
});

it('hides the weather after the date once the reading is stale', async () => {
  const r = render(<Screens />);
  await flush();
  expect(r.container.querySelector('.clk-date .wx-line')).not.toBeNull();
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  await flush(20 * 60_000);
  expect(r.container.querySelector('.clk-date .wx-line')).toBeNull();
});

it('gives the focus card the whole centre with a weather line while weather loads', async () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
  const r = render(<Screens />);
  await flush();
  const centre = r.container.querySelector('.centre')!;
  expect(centre.className).toBe('centre centre-fill solo noted');
  expect(centre.querySelectorAll('.panel')).toHaveLength(1);
  expect(centre.querySelector('.focus-note')!.textContent).toBe('Loading weather');
});

it('gives the focus card the whole centre when the first weather fetch fails, and splits again once a reading arrives', async () => {
  let fail = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (fail) throw new Error('offline');
      return { ok: true, json: async () => weather };
    }),
  );
  const r = render(<Screens />);
  await flush();
  expect(r.container.querySelector('.centre')!.className).toBe('centre centre-fill solo noted');
  expect(r.container.querySelector('.focus-note')!.textContent).toBe('Weather unavailable');
  fail = false;
  await flush(60_000);
  const centre = r.container.querySelector('.centre')!;
  expect(centre.className).toBe('centre centre-fill noted');
  expect(centre.querySelectorAll('.panel')).toHaveLength(2);
});

it('says Calendar not available in the Next block when no account can be read', async () => {
  meet = () => ({
    accounts: [{ id: 'work', label: 'Work', state: 'unavailable', reason: 'graph-503-UnknownError' }],
    meetings: [],
  });
  const r = render(<Screens />);
  await flush();
  expect(r.container.querySelector('[aria-label="Next meeting"]')!.textContent).toContain('Calendar not available');
});

it('hides the Next block when Meet has no meeting but its accounts are fine', async () => {
  meet = () => ({ accounts: [{ id: 'work', label: 'Work', state: 'ok' }], meetings: [] });
  const r = render(<Screens />);
  await flush();
  expect(r.container.querySelector('[aria-label="Next meeting"]')).toBeNull();
});
