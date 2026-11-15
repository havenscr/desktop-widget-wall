import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { mocks } from '../bridge/tauri';
import { WeatherCard } from './WeatherCard';
import { resetWeatherStore } from './useWeather';

afterEach(() => {
  resetWeatherStore();
  mocks.clear();
});

it('shows a loading line before data, never an error banner', () => {
  mocks.set('wall2_weather', () => Promise.reject('network'));
  render(<WeatherCard />);
  expect(screen.getByText('Loading weather')).toBeTruthy();
});

it('renders a reading from the native read', async () => {
  const body = {
    current: { time: '2026-11-11T10:15', temperature_2m: 57.6, weather_code: 3, is_day: 1 },
    hourly: {
      time: Array.from({ length: 24 }, (_, i) => `2026-11-11T${String(i).padStart(2, '0')}:00`),
      temperature_2m: Array.from({ length: 24 }, () => 50),
      weather_code: Array.from({ length: 24 }, () => 0),
    },
    daily: { temperature_2m_max: [61], temperature_2m_min: [44] },
  };
  mocks.set('wall2_weather', async () => JSON.stringify(body));
  render(<WeatherCard />);
  await waitFor(() => expect(screen.getByText('58°')).toBeTruthy());
  expect(screen.getByText('High 61°')).toBeTruthy();
  expect(screen.getByText('Overcast')).toBeTruthy();
});

it('prints the reason under Weather unavailable for every failure kind, without a hover', async () => {
  const cases: [string, string][] = [
    ['dns', "This PC could not look up Open-Meteo's address."],
    ['connect', 'Open-Meteo refused the connection.'],
    ['tls', 'The secure connection to Open-Meteo failed.'],
    ['timeout', 'Open-Meteo did not answer in time.'],
    ['read', 'The reply from Open-Meteo broke off before the end.'],
    ['http 500', 'Open-Meteo answered 500.'],
  ];
  for (const [kind, words] of cases) {
    resetWeatherStore();
    mocks.set('wall2_weather', () => Promise.reject(kind));
    const { unmount } = render(<WeatherCard />);
    await waitFor(() => expect(screen.getByText('Weather unavailable')).toBeTruthy());
    expect(screen.getByText(words)).toBeTruthy();
    unmount();
  }
});

it('says when the next try is after a 429', async () => {
  mocks.set('wall2_weather', (args) => Promise.reject(args?.source === 'nws' ? 'http 404' : 'http 429'));
  render(<WeatherCard />);
  await waitFor(() => expect(screen.getByText(/Open-Meteo is refusing this address for now \(too many requests\)\. Next try at \d{1,2}(:\d\d)? [AP]M\./)).toBeTruthy());
});
