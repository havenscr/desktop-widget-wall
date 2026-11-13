import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { WeatherCard } from './WeatherCard';
import { FETCH_TIMEOUT_MS, resetWeatherStore, useWeather } from './useWeather';

const body = {
  current: { time: '2026-11-11T10:15', temperature_2m: 57.6, weather_code: 3, is_day: 1 },
  hourly: {
    time: Array.from({ length: 24 }, (_, i) => `2026-11-11T${String(i).padStart(2, '0')}:00`),
    temperature_2m: Array.from({ length: 24 }, () => 50),
    weather_code: Array.from({ length: 24 }, () => 0),
  },
  daily: { temperature_2m_max: [61], temperature_2m_min: [44] },
};
const ok = async () => ({ ok: true, json: async () => body }) as unknown as Response;

afterEach(() => {
  resetWeatherStore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('shows the reading inside StrictMode (effect remount)', async () => {
  vi.stubGlobal('fetch', vi.fn(ok));
  render(
    <StrictMode>
      <WeatherCard />
    </StrictMode>,
  );
  await waitFor(() => expect(screen.getByText('58°')).toBeTruthy());
});

it('says unavailable after a failed first fetch, then recovers on the one minute retry', async () => {
  vi.useFakeTimers();
  let fail = true;
  const f = vi.fn(async () => {
    if (fail) throw new Error('offline');
    return ok();
  });
  vi.stubGlobal('fetch', f);
  render(<WeatherCard />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(screen.getByText('Weather unavailable')).toBeTruthy();
  fail = false;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(f).toHaveBeenCalledTimes(2);
  expect(screen.getByText('58°')).toBeTruthy();
});

it('aborts a hung request after 15 seconds and fetches again later', async () => {
  vi.useFakeTimers();
  let signalSeen: AbortSignal | undefined;
  let hang = true;
  const f = vi.fn((_url: unknown, init?: RequestInit) => {
    if (!hang) return ok();
    signalSeen = init?.signal ?? undefined;
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
  }) as unknown as typeof fetch;
  const { result } = renderHook(() => useWeather(f));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(signalSeen?.aborted).toBe(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);
  });
  expect(signalSeen?.aborted).toBe(true);
  expect(result.current.failed).toBe(true);
  hang = false;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(result.current.reading?.temp).toBe(58);
});
