import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { resetWeatherStore, useWeather } from './useWeather';

const body = {
  current: { time: '2026-11-11T10:15', temperature_2m: 57.6, weather_code: 3, is_day: 1 },
  hourly: { time: ['2026-11-11T10:00'], temperature_2m: [50], weather_code: [0] },
  daily: { temperature_2m_max: [61], temperature_2m_min: [44] },
};

afterEach(() => {
  resetWeatherStore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Temp({ id }: { id: string }) {
  const { reading } = useWeather();
  return <span data-testid={id}>{reading ? Math.round(reading.temp) : '-'}</span>;
}

function hide(h: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  act(() => void document.dispatchEvent(new Event('visibilitychange')));
}

it('two users share one request per interval, and both see the reading', async () => {
  vi.useFakeTimers();
  const f = vi.fn(async () => ({ ok: true, json: async () => body }) as unknown as Response);
  vi.stubGlobal('fetch', f);
  const { getByTestId } = render(
    <>
      <Temp id="a" />
      <Temp id="b" />
    </>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(f).toHaveBeenCalledTimes(1);
  expect(getByTestId('a').textContent).toBe('58');
  expect(getByTestId('b').textContent).toBe('58');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15 * 60_000);
  });
  expect(f).toHaveBeenCalledTimes(2);
});

it('hiding the page then showing it keeps the reading and makes no extra request inside the interval', async () => {
  vi.useFakeTimers();
  const f = vi.fn(async () => ({ ok: true, json: async () => body }) as unknown as Response);
  vi.stubGlobal('fetch', f);
  const { getByTestId } = render(<Temp id="a" />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(getByTestId('a').textContent).toBe('58');
  hide(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  f.mockImplementation(async () => {
    throw new Error('offline');
  });
  hide(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(getByTestId('a').textContent).toBe('58');
  expect(f).toHaveBeenCalledTimes(1);
});
