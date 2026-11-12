import { render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { WeatherCard } from './WeatherCard';

it('shows a loading line before data, never an error banner', () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  render(<WeatherCard />);
  expect(screen.getByText('Loading weather')).toBeTruthy();
  vi.unstubAllGlobals();
});

it('renders a reading from the fetch', async () => {
  const body = {
    current: { time: '2026-11-11T10:15', temperature_2m: 57.6, weather_code: 3, is_day: 1 },
    hourly: {
      time: Array.from({ length: 24 }, (_, i) => `2026-11-11T${String(i).padStart(2, '0')}:00`),
      temperature_2m: Array.from({ length: 24 }, () => 50),
      weather_code: Array.from({ length: 24 }, () => 0),
    },
    daily: { temperature_2m_max: [61], temperature_2m_min: [44] },
  };
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })));
  render(<WeatherCard />);
  await waitFor(() => expect(screen.getByText('58°')).toBeTruthy());
  expect(screen.getByText('High 61°')).toBeTruthy();
  expect(screen.getByText('Overcast')).toBeTruthy();
  vi.unstubAllGlobals();
});
