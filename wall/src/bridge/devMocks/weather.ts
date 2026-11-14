import { reviewNow } from '../../ui/reviewClock';
import { mocks } from '../tauri';

const now = () => (reviewNow ? reviewNow() : Date.now());
const pad = (n: number) => String(n).padStart(2, '0');
const local = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
};
const localSeconds = (ms: number) => {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  return `${local(ms)}:00:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
};

/** An invented Open-Meteo style reply: 30 hourly points around now. */
export function openMeteoBody(cold = false): string {
  const t = now();
  const hours = Array.from({ length: 30 }, (_, i) => t + (i - 3) * 3_600_000);
  const temp = cold ? 24 : 58;
  return JSON.stringify({
    current: { time: local(t), temperature_2m: temp, weather_code: cold ? 73 : 2, is_day: 1 },
    hourly: {
      time: hours.map(local),
      temperature_2m: hours.map((_, i) => temp + Math.round(6 * Math.sin(i / 4))),
      weather_code: hours.map((_, i) => (i % 5 === 0 ? 61 : 2)),
      is_day: hours.map((ms) => (new Date(ms).getHours() >= 7 && new Date(ms).getHours() < 18 ? 1 : 0)),
    },
    daily: { temperature_2m_max: [temp + 6, temp + 4], temperature_2m_min: [temp - 8, temp - 6] },
  });
}

/** An invented Weather Service style reply: the hourly forecast from the current hour and the 12 hour forecast. */
export function nwsBody(): string {
  const t = Math.floor(now() / 3_600_000) * 3_600_000;
  const words = ['Mostly Cloudy', 'Chance Rain Showers', 'Partly Cloudy', 'Sunny', 'Light Rain', 'Clear'];
  const hourly = {
    properties: {
      periods: Array.from({ length: 24 }, (_, i) => {
        const ms = t + i * 3_600_000;
        const h = new Date(ms).getHours();
        return {
          startTime: localSeconds(ms),
          isDaytime: h >= 7 && h < 18,
          temperature: 52 + Math.round(5 * Math.sin(i / 3)),
          temperatureUnit: 'F',
          shortForecast: words[i % words.length],
        };
      }),
    },
  };
  const day = new Date(t);
  day.setHours(6, 0, 0, 0);
  const night = new Date(t);
  night.setHours(18, 0, 0, 0);
  const forecast = {
    properties: {
      periods: [
        { startTime: localSeconds(day.getTime()), isDaytime: true, temperature: 57, temperatureUnit: 'F', shortForecast: 'Partly Cloudy' },
        { startTime: localSeconds(night.getTime()), isDaytime: false, temperature: 44, temperatureUnit: 'F', shortForecast: 'Mostly Clear' },
      ],
    },
  };
  return JSON.stringify({ hourly, forecast });
}

/** The native weather read, as a plain browser sees it: Open-Meteo answers with a reading. */
export function registerWeatherMocks(): void {
  mocks.set('wall2_weather', (args) => {
    if (args?.source === 'nws') return nwsBody();
    return openMeteoBody();
  });
}
