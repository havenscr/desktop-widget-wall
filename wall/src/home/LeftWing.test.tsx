import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { usePacificTime } from '../ribbon/testZone';
import { resetWeatherStore } from '../weather/useWeather';
import { fitRooms } from './HouseLine';
import { LeftWing } from './LeftWing';
import { outsideState } from './OutsideRow';

usePacificTime();

// Sun times are switchable per test, to reach a date with no sunset.
const override = vi.hoisted(() => ({ on: false }));
vi.mock('../ribbon/sun', async (orig) => {
  const actual = await orig<typeof import('../ribbon/sun')>();
  return { ...actual, sunTimes: (ms: number) => (override.on ? { rise: actual.sunTimes(ms).rise, set: null } : actual.sunTimes(ms)) };
});

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const at = (t: string) => Date.parse(`2026-11-11T${t}-08:00`);

const owm = (temp = 50, code = 2) => ({
  current: { time: '2026-11-11T10:15', temperature_2m: temp, weather_code: code, is_day: 1 },
  hourly: {
    time: Array.from({ length: 24 }, (_, i) => `2026-11-11T${String(i).padStart(2, '0')}:00`),
    temperature_2m: Array.from({ length: 24 }, () => 50),
    weather_code: Array.from({ length: 24 }, () => 2),
  },
  daily: { temperature_2m_max: [56], temperature_2m_min: [44] },
});
const house = { observedAt: '2026-11-11T18:23:30Z', insideF: 68, litRooms: 2, rooms: 4, stale: false };
const rooms = { rooms: [{ id: '1', name: 'Office', on: true }, { id: '2', name: 'Den', on: true }, { id: '3', name: 'Kitchen', on: false }], stale: false };

function setup(now: string, opts: { weather?: 'ok' | 'down'; desk?: boolean } = {}) {
  vi.useFakeTimers();
  vi.setSystemTime(at(now));
  const { weather = 'ok', desk = false } = opts;
  mocks.set('wall2_weather', () => (weather === 'ok' ? JSON.stringify(owm()) : Promise.reject('network')));
  mocks.set('wall2_desk_house', () => (desk ? house : Promise.reject(new Error('absent'))));
  mocks.set('wall2_desk_rooms', () => (desk ? rooms : Promise.reject(new Error('absent'))));
  return render(<LeftWing now={() => at(now)} />);
}

beforeEach(() => {
  override.on = false;
  resetWeatherStore();
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  resetWeatherStore();
});

it('morning: headline, curve with the sun disc, outside row with its hover card, no house row while the routes are absent', async () => {
  const { container } = setup('10:28:00');
  await flush(50);
  expect(container.querySelector('.lw-head')?.textContent).toMatch(/^6 h \d+ min of daylight left$/);
  expect(container.querySelector('.lw-head.soon')).toBeNull();
  expect(container.querySelector('.lw-curve')?.getAttribute('aria-label')).toMatch(/^Sunrise 7:\d\d AM, sunset 4:\d\d PM, the sun is before its highest point$/);
  expect(container.querySelector('.lw-sun')).toBeTruthy();
  expect(container.querySelector('.lw-moon')).toBeNull();
  expect(container.querySelector('.outside .lw-text')?.textContent).toBe('50° outside, partly cloudy');
  expect(container.querySelector('.outside .lw-side')?.textContent).toBe('56° / 44°');
  expect(container.querySelector('.house')).toBeNull();
  expect(container.querySelector('.home-wing.with-house')).toBeNull();
});

it('late afternoon: Sunset in N min, in amber', async () => {
  const { container } = setup('15:40:00');
  await flush(50);
  const head = container.querySelector('.lw-head.soon');
  expect(head?.textContent).toMatch(/^Sunset in \d+ min$/);
});

it('night: tomorrow sunrise, and a ring on the dip instead of the disc', async () => {
  const { container } = setup('21:10:00');
  await flush(50);
  expect(container.querySelector('.lw-head')?.textContent).toMatch(/^Sunrise at 7:\d\d AM tomorrow$/);
  expect(container.querySelector('.lw-moon')).toBeTruthy();
  expect(container.querySelector('.lw-sun')).toBeNull();
  expect(container.querySelector('.lw-curve')?.getAttribute('aria-label')).toMatch(/the sun has set$/);
});

it('a date with no sunset: the headline alone, no curve', async () => {
  override.on = true;
  const { container } = setup('10:28:00');
  await flush(50);
  expect(container.querySelector('.lw-head')?.textContent).toMatch(/^Sunrise at 7:\d\d AM$/);
  expect(container.querySelector('.lw-curve')).toBeNull();
});

it('with no weather reading the row says weather unavailable, dim, and nothing else changes', async () => {
  const { container } = setup('10:28:00', { weather: 'down' });
  await flush(50);
  expect(container.querySelector('.outside.missing .lw-dim')?.textContent).toBe('weather unavailable');
  expect(container.querySelector('.outside .lw-text')).toBeNull();
  expect(container.querySelector('.lw-head')).toBeTruthy();
  expect(container.querySelector('.lw-curve')).toBeTruthy();
});

it('says nothing about the weather while the first read is still out', async () => {
  vi.useFakeTimers();
  mocks.set('wall2_weather', () => new Promise(() => undefined));
  mocks.set('wall2_desk_house', () => Promise.reject(new Error('absent')));
  mocks.set('wall2_desk_rooms', () => Promise.reject(new Error('absent')));
  const { container } = render(<LeftWing now={() => at('10:28:00')} />);
  await flush(50);
  expect(container.querySelector('.outside')).toBeNull();
});

it('house live: the row, with a dot per room and the rows in order under the outside row', async () => {
  const { container } = setup('10:28:00', { desk: true });
  await flush(50);
  const order = [...container.querySelectorAll('.lw-head, .lw-curve, .outside, .house')].map((e) => e.className.split(' ')[0]);
  expect(order).toEqual(['t2', 'lw-curve', 'lw-row', 'lw-house']);
  expect(container.querySelector('.house-line')?.textContent).toBe('68° inside. Lights on in two rooms.');
  expect(container.querySelector('.house.stale')).toBeNull();
  expect(container.querySelectorAll('.house-room')).toHaveLength(3);
});

it('house not live: dimmed and says as of', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(at('10:28:00'));
  mocks.set('wall2_weather', () => JSON.stringify(owm()));
  mocks.set('wall2_desk_house', () => ({ ...house, stale: true }));
  mocks.set('wall2_desk_rooms', () => rooms);
  const { container } = render(<LeftWing now={() => at('10:28:00')} />);
  await flush(50);
  expect(container.querySelector('.house.stale')).toBeTruthy();
  expect(container.querySelector('.house-asof')?.textContent).toMatch(/^as of /);
});

it('redraws once a minute: the headline follows the clock tick', async () => {
  vi.useFakeTimers();
  let t = at('15:40:00');
  mocks.set('wall2_weather', () => JSON.stringify(owm()));
  mocks.set('wall2_desk_house', () => Promise.reject(new Error('absent')));
  mocks.set('wall2_desk_rooms', () => Promise.reject(new Error('absent')));
  const { container } = render(<LeftWing now={() => t} />);
  await flush(50);
  const before = container.querySelector('.lw-head')?.textContent;
  t += 5 * 60_000;
  await flush(59_000);
  expect(container.querySelector('.lw-head')?.textContent).toBe(before);
  await flush(2_000);
  expect(container.querySelector('.lw-head')?.textContent).not.toBe(before);
});

it('outside state: a fresh reading, an old one with its age, a second source, a failure that kept a reading, and none', () => {
  const now = at('10:28:00');
  const reading = { temp: 50, look: { label: 'Partly cloudy', icon: 'cloud-sun' as const }, high: 56, low: 44, hours: [], fetchedAt: now - 60_000 };
  const fresh = outsideState({ reading, failed: false }, now);
  expect(fresh.kind === 'reading' && fresh.view).toMatchObject({ temp: 50, look: 'partly cloudy', side: '56° / 44°', stale: false });
  const old = outsideState({ reading: { ...reading, fetchedAt: now - 40 * 60_000 }, failed: true, failure: 'network' }, now);
  expect(old.kind === 'reading' && old.view).toMatchObject({ side: 'updated 40 min ago', stale: true });
  expect(old.kind === 'reading' && old.view.tip).toMatch(/The last try failed/);
  const second = outsideState({ reading: { ...reading, source: 'nws' }, failed: false }, now);
  expect(second.kind === 'reading' && second.view.tip).toMatch(/while Open-Meteo is not answering/);
  expect(outsideState({ reading: { ...reading, fetchedAt: now - 2 * 3_600_000 }, failed: true, failure: 'timeout' }, now).kind).toBe('missing');
  expect(outsideState({ reading: null, failed: true, failure: 'network' }, now).kind).toBe('missing');
  expect(outsideState({ reading: null, failed: false }, now).kind).toBe('loading');
});

it('fits the room dots on one line: all of them when they fit, else the lit ones first and a count', () => {
  const r = (id: string, name: string, on: boolean) => ({ id, name, on });
  const few = [r('1', 'Office', true), r('2', 'Kitchen', false)];
  expect(fitRooms(few)).toEqual({ shown: few, hidden: [] });
  const many = [r('1', 'Office', false), r('2', 'Living room', false), r('3', 'Kitchen', false), r('4', 'Bedroom', true), r('5', 'Guest room', true), r('6', 'Hall', false), r('7', 'Porch', false), r('8', 'Den', true)];
  const { shown, hidden } = fitRooms(many);
  expect(shown.length + hidden.length).toBe(8);
  expect(hidden.length).toBeGreaterThan(0);
  expect(shown.slice(0, 3).every((x) => x.on)).toBe(true);
});
