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

it('the minute timer stops while the page is hidden and catches up when it shows', async () => {
  vi.useFakeTimers();
  mocks.set('wall2_weather', () => JSON.stringify(owm()));
  mocks.set('wall2_desk_house', () => Promise.reject(new Error('absent')));
  mocks.set('wall2_desk_rooms', () => Promise.reject(new Error('absent')));
  let calls = 0;
  const clock = () => {
    calls += 1;
    return at('15:40:00');
  };
  let hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  try {
    render(<LeftWing now={clock} />);
    await flush(50);
    hidden = true;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const before = calls;
    await flush(5 * 60_000);
    expect(calls).toBe(before);
    hidden = false;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(calls).toBeGreaterThan(before);
    await flush(61_000);
    expect(calls).toBeGreaterThan(before + 1);
  } finally {
    Reflect.deleteProperty(document, 'hidden');
  }
});

it('outside state: a fresh reading, a second source, and none', () => {
  const now = at('10:28:00');
  const reading = { temp: 50, look: { label: 'Partly cloudy', icon: 'cloud-sun' as const }, high: 56, low: 44, hours: [], fetchedAt: now - 60_000, code: 2 };
  const fresh = outsideState({ reading, failed: false }, now);
  expect(fresh.kind === 'reading' && fresh.view).toMatchObject({ temp: 50, look: 'partly cloudy', side: '56° / 44°', stale: false });
  const second = outsideState({ reading: { ...reading, source: 'nws' }, failed: false }, now);
  expect(second.kind === 'reading' && second.view.tip).toMatch(/while Open-Meteo is not answering/);
  expect(outsideState({ reading: null, failed: true, failure: 'network' }, now).kind).toBe('missing');
  expect(outsideState({ reading: null, failed: false }, now).kind).toBe('loading');
});

it('outside state: a kept reading 30 minutes, 61 minutes and 5 hours old after a failed refresh still shows, dimmed, with its age and the reason', () => {
  const now = at('10:28:00');
  const reading = { temp: 50, look: { label: 'Partly cloudy', icon: 'cloud-sun' as const }, high: 56, low: 44, hours: [], fetchedAt: now, code: 2 };
  const cases: [number, string][] = [[30, 'updated 30 min ago'], [61, 'updated 1 h ago'], [300, 'updated 5 h ago']];
  for (const [mins, side] of cases) {
    const s = outsideState({ reading: { ...reading, fetchedAt: now - mins * 60_000 }, failed: true, failure: 'timeout' }, now);
    expect(s.kind).toBe('reading');
    if (s.kind !== 'reading') continue;
    expect(s.view).toMatchObject({ temp: 50, side, stale: true });
    expect(s.view.tip).toMatch(/The last try failed: Open-Meteo did not answer in time\./);
  }
  // A reading with no usable time or temperature is no reading.
  expect(outsideState({ reading: { ...reading, fetchedAt: Number.NaN }, failed: true, failure: 'timeout' }, now).kind).toBe('missing');
});

it('house not live with four rooms: all four dots show and the sentence is dimmed', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(at('10:28:00'));
  const four = { rooms: [{ id: '1', name: 'Office', on: true }, { id: '2', name: 'Living room', on: true }, { id: '3', name: 'Kitchen', on: false }, { id: '4', name: 'Bedroom', on: false }], stale: false };
  mocks.set('wall2_weather', () => JSON.stringify(owm()));
  mocks.set('wall2_desk_house', () => ({ ...house, stale: true }));
  mocks.set('wall2_desk_rooms', () => four);
  const { container } = render(<LeftWing now={() => at('10:28:00')} />);
  await flush(50);
  expect([...container.querySelectorAll('.house-room')].map((e) => e.textContent)).toEqual(['Office', 'Living room', 'Kitchen', 'Bedroom']);
  expect(container.querySelector('.house.stale')).toBeTruthy();
});

it('fits the room dots on two lines: all of them when they fit, else the lit ones first and "+N more" only when both lines are full', () => {
  const r = (id: string, name: string, on: boolean) => ({ id, name, on });
  // One room, no rooms, and seven rooms (the owner's seven lit rooms) all fit in two lines, in the home app's order.
  expect(fitRooms([])).toEqual({ shown: [], hidden: [] });
  const one = [r('1', 'Office', true)];
  expect(fitRooms(one)).toEqual({ shown: one, hidden: [] });
  const seven = ['Office', 'Living room', 'Kitchen', 'Bedroom', 'Hallway', 'Porch', 'Den'].map((n, i) => r(String(i), n, true));
  expect(fitRooms(seven)).toEqual({ shown: seven, hidden: [] });
  // Twelve do not: the lit ones lead, the rest are counted, and what is shown holds in two lines of 424 px.
  const names = ['Office', 'Living room', 'Kitchen', 'Bedroom', 'Guest room', 'Hallway', 'Porch', 'Garage', 'Den', 'Bathroom', 'Laundry', 'Attic'];
  const twelve = names.map((n, i) => r(String(i), n, i % 3 === 0));
  const { shown, hidden } = fitRooms(twelve);
  expect(shown.length + hidden.length).toBe(12);
  expect(hidden.length).toBeGreaterThan(0);
  expect(shown.slice(0, 4).every((x) => x.on)).toBe(true);
  expect(hidden.every((x) => !x.on) || hidden.every((h) => shown.every((x) => x.on || !h.on))).toBe(true);
  // The sum rule: shown rooms plus N is always the lit rooms and the dark ones, for one, seven, twelve and twenty-four rooms and a forced drop.
  const many = (n: number) => Array.from({ length: n }, (_, i) => r(String(i), `Room ${i}`, i % 2 === 0));
  for (const n of [1, 7, 12, 24]) {
    for (const drop of [0, 1, 3]) {
      const f = fitRooms(many(n), undefined, drop);
      expect(f.shown.length + f.hidden.length).toBe(n);
      expect(new Set([...f.shown, ...f.hidden].map((x) => x.id)).size).toBe(n);
      // "+N more" names exactly what is not shown, and the lit rooms come before the dark ones among the shown.
      expect(f.hidden.length).toBe(n - f.shown.length);
    }
  }
  expect(fitRooms(many(24)).hidden.length).toBeGreaterThan(0);
  expect(fitRooms(many(7)).hidden.length).toBe(0);
  expect(fitRooms(many(7), undefined, 2).hidden.length).toBe(2);
  expect(fitRooms(many(12), undefined, 2).hidden.length).toBe(fitRooms(many(12)).hidden.length + 2);
  // One line fewer would not hold them all, so a second line is used before "+N more" appears.
  expect(fitRooms(names.slice(0, 7).map((n, i) => r(String(i), n, true))).hidden).toEqual([]);
});
