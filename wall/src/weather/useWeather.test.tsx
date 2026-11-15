import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { BACKOFF_MS } from './model';
import { WeatherCard } from './WeatherCard';
import { FETCH_TIMEOUT_MS, refreshWeather, resetWeatherStore, useWeather, useWeatherStore, type WeatherReader } from './useWeather';

const body = {
  current: { time: '2026-11-11T10:15', temperature_2m: 57.6, weather_code: 3, is_day: 1 },
  hourly: {
    time: Array.from({ length: 24 }, (_, i) => `2026-11-11T${String(i).padStart(2, '0')}:00`),
    temperature_2m: Array.from({ length: 24 }, () => 50),
    weather_code: Array.from({ length: 24 }, () => 0),
  },
  daily: { temperature_2m_max: [61], temperature_2m_min: [44] },
};
const nwsHourly = {
  properties: {
    periods: Array.from({ length: 10 }, (_, i) => ({
      startTime: `2026-11-11T${String(10 + i).padStart(2, '0')}:00:00-08:00`,
      isDaytime: true,
      temperature: 40 + i,
      temperatureUnit: 'F',
      shortForecast: 'Sunny',
    })),
  },
};
const ok = async () => JSON.stringify(body);

afterEach(() => {
  resetWeatherStore();
  mocks.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('shows the reading inside StrictMode (effect remount)', async () => {
  mocks.set('wall2_weather', ok);
  render(
    <StrictMode>
      <WeatherCard />
    </StrictMode>,
  );
  await waitFor(() => expect(screen.getByText('58°')).toBeTruthy());
});

it('never calls the network from the page: the read is the native command', async () => {
  const f = vi.fn();
  vi.stubGlobal('fetch', f);
  const seen: unknown[] = [];
  mocks.set('wall2_weather', (args) => {
    seen.push(args?.source);
    return ok();
  });
  render(<WeatherCard />);
  await waitFor(() => expect(screen.getByText('58°')).toBeTruthy());
  expect(f).not.toHaveBeenCalled();
  expect(seen).toEqual(['open-meteo']);
});

it('says unavailable after a failed first read, then recovers on the one minute retry', async () => {
  vi.useFakeTimers();
  let fail = true;
  const f = vi.fn(async () => {
    if (fail) throw 'connect';
    return ok();
  });
  mocks.set('wall2_weather', f);
  render(<WeatherCard />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(screen.getByText('Weather unavailable')).toBeTruthy();
  // A connect failure asks the second source too, so the first source is called once and the second once.
  const callsAfterFirstTry = f.mock.calls.length;
  expect(callsAfterFirstTry).toBe(2);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(59_980);
  });
  expect(f).toHaveBeenCalledTimes(callsAfterFirstTry);
  fail = false;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20);
  });
  expect(f).toHaveBeenCalledTimes(callsAfterFirstTry + 1);
  expect(screen.getByText('58°')).toBeTruthy();
});

it('gives up on a hung read after 15 seconds and reads again later', async () => {
  vi.useFakeTimers();
  let hang = true;
  // While it hangs both sources hang: the first gives up at 15 s, then the second is asked.
  const read: WeatherReader = vi.fn(() => (hang ? new Promise<string>(() => undefined) : ok()));
  const { result } = renderHook(() => useWeather(read));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(result.current.failed).toBe(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS * 2);
  });
  expect(result.current.failed).toBe(true);
  expect(result.current.failure).toBe('timeout');
  hang = false;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(result.current.reading?.temp).toBe(58);
});

it('keeps HTTP and unreadable reply failures distinct with the last try time', async () => {
  let reply: 'http' | 'json' = 'http';
  const read: WeatherReader = vi.fn(async () => {
    if (reply === 'http') throw 'http 403';
    return 'not json at all';
  });
  renderHook(() => useWeather(read));
  await waitFor(() => expect(useWeatherStore.getState().failure).toBe('http 403'));
  expect(useWeatherStore.getState().attemptedAt).toEqual(expect.any(Number));
  // A 403 is not a refusal to wait out and not an unreachable service: the second source is not asked.
  expect(read).toHaveBeenCalledTimes(1);
  reply = 'json';
  await act(async () => refreshWeather());
  expect(useWeatherStore.getState().failure).toBe('parse');
});

it('keeps every native failure kind distinct and names an unknown error as a network failure', async () => {
  for (const kind of ['dns', 'connect', 'tls', 'timeout', 'read', 'input', 'http 500']) {
    resetWeatherStore();
    const read: WeatherReader = async () => {
      throw kind;
    };
    const { unmount } = renderHook(() => useWeather(read));
    await waitFor(() => expect(useWeatherStore.getState().failure).toBe(kind));
    unmount();
  }
  resetWeatherStore();
  const odd: WeatherReader = async () => {
    throw new Error('something else');
  };
  renderHook(() => useWeather(odd));
  await waitFor(() => expect(useWeatherStore.getState().failure).toBe('network'));
});

it('after a 429 leaves the first source alone for 15, then 30, then 60 minutes, and asks the Weather Service', async () => {
  vi.useFakeTimers();
  const calls: string[] = [];
  const read: WeatherReader = async (source) => {
    calls.push(source);
    if (source === 'open-meteo') throw 'http 429';
    return JSON.stringify({ hourly: nwsHourly, forecast: null });
  };
  const { result } = renderHook(() => useWeather(read));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  // First try: Open-Meteo refuses, the Weather Service answers; the reading says where it came from.
  expect(calls).toEqual(['open-meteo', 'nws']);
  expect(result.current.reading?.source).toBe('nws');
  expect(result.current.failed).toBe(false);
  expect(result.current.nextTryAt).toEqual(expect.any(Number));
  // The next refresh (15 minutes) asks Open-Meteo again, it refuses again (30 minute wait).
  await act(async () => {
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0] + 60_000);
  });
  expect(calls).toEqual(['open-meteo', 'nws', 'open-meteo', 'nws']);
  // Inside the 30 minute wait the refresh goes straight to the Weather Service.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0] + 60_000);
  });
  expect(calls.slice(4)).toEqual(['nws']);
  // Past it Open-Meteo is tried again (60 minute wait next, and never more than 60).
  await act(async () => {
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0]);
  });
  expect(calls.slice(5)).toEqual(['open-meteo', 'nws']);
});

it('with no reading after a 429 waits for the planned time; Retry tries at once but never lengthens the wait', async () => {
  vi.useFakeTimers();
  const calls: string[] = [];
  const read: WeatherReader = async (source) => {
    calls.push(source);
    throw source === 'nws' ? 'http 404' : 'http 429';
  };
  const { result } = renderHook(() => useWeather(read));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(result.current.failed).toBe(true);
  expect(result.current.failure).toBe('http 429');
  const retryAt = result.current.nextTryAt!;
  expect(retryAt - result.current.attemptedAt!).toBe(BACKOFF_MS[0]);
  expect(calls).toEqual(['open-meteo', 'nws']);
  // Nothing for 14 minutes even though a reading-less wall normally retries every minute.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(14 * 60_000);
  });
  expect(calls).toHaveLength(2);
  // Pressing Retry tries Open-Meteo at once each time and leaves the planned time where it was.
  for (let i = 1; i <= 3; i++) {
    await act(async () => refreshWeather());
    expect(calls).toHaveLength(2 + 2 * i);
    expect(calls.slice(-2)).toEqual(['open-meteo', 'nws']);
    expect(useWeatherStore.getState().nextTryAt).toBe(retryAt);
  }
  // A scheduled try that meets a 429 advances the wait: 30 minutes, then 60, then 60 again.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2 * 60_000);
  });
  expect(useWeatherStore.getState().nextTryAt! - useWeatherStore.getState().attemptedAt!).toBe(BACKOFF_MS[1]);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[1] + 60_000);
  });
  expect(useWeatherStore.getState().nextTryAt! - useWeatherStore.getState().attemptedAt!).toBe(BACKOFF_MS[2]);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[2] + 60_000);
  });
  expect(useWeatherStore.getState().nextTryAt! - useWeatherStore.getState().attemptedAt!).toBe(BACKOFF_MS[2]);
});

it('a pressed Retry that starts a wait while none is running does not advance it, and a success resets the steps', async () => {
  vi.useFakeTimers();
  let refuse = true;
  const read: WeatherReader = async (source) => {
    if (source === 'nws') throw 'http 404';
    if (refuse) throw 'http 429';
    return ok();
  };
  const { result } = renderHook(() => useWeather(read));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  // Past the first wait a scheduled try meets another 429: 30 minutes.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0] + 60_000);
  });
  expect(result.current.nextTryAt! - result.current.attemptedAt!).toBe(BACKOFF_MS[1]);
  refuse = false;
  await act(async () => refreshWeather());
  expect(result.current.reading?.source).toBe('open-meteo');
  expect(result.current.nextTryAt).toBeNull();
  // After the success the next refusal starts again at 15 minutes.
  refuse = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15 * 60_000 + 60_000);
  });
  expect(result.current.nextTryAt! - result.current.attemptedAt!).toBe(BACKOFF_MS[0]);
});

it('asks the Weather Service when Open-Meteo cannot be reached, and keeps the first failure when both fail', async () => {
  const calls: string[] = [];
  const read: WeatherReader = async (source) => {
    calls.push(source);
    throw source === 'nws' ? 'http 404' : 'dns';
  };
  renderHook(() => useWeather(read));
  await waitFor(() => expect(useWeatherStore.getState().failed).toBe(true));
  expect(calls).toEqual(['open-meteo', 'nws']);
  expect(useWeatherStore.getState().failure).toBe('dns');
  expect(useWeatherStore.getState().nextTryAt).toBeNull();
});
