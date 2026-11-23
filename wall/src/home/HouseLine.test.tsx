import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { HoverTipLayer, resetTip, TIP_DELAY_MS } from '../ui/HoverTip';
import { houseText, nextView } from './HouseLine';
import type { NextChange } from './useDesk';
import { LeftWing } from './LeftWing';

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const NOW = Date.parse('2026-11-11T10:24:00-08:00');
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
});

const house = (over: Record<string, unknown> = {}) => ({ observedAt: '2026-11-11T18:23:30Z', insideF: 68, litRooms: 2, rooms: 4, stale: false, ...over });
const rooms = { rooms: [{ id: '1', name: 'Office', on: true }, { id: '2', name: 'Den', on: true }, { id: '3', name: 'Kitchen', on: false }], stale: false };

it('words the line, leaving out what has no reading', () => {
  expect(houseText(68, 2)).toBe('68° inside. Lights on in two rooms.');
  expect(houseText(null, 2)).toBe('Lights on in two rooms.');
  expect(houseText(68, 1)).toBe('68° inside. Lights on in one room.');
  expect(houseText(71, 0)).toBe('71° inside. All lights off.');
  expect(houseText(68, null)).toBe('68° inside.');
  expect(houseText(null, 14)).toBe('Lights on in 14 rooms.');
  expect(houseText(null, null)).toBeNull();
});

it('hides entirely while the desk routes are absent; the headline, curve and outside row stay', async () => {
  mocks.set('wall2_desk_house', () => Promise.reject(new Error('absent')));
  mocks.set('wall2_desk_rooms', () => Promise.reject(new Error('absent')));
  const { container } = render(<LeftWing now={() => NOW} />);
  await flush();
  expect(container.querySelector('.house')).toBeNull();
  expect(container.querySelector('.home-wing.with-house')).toBeNull();
  expect(container.querySelector('.home-wing')).toBeTruthy();
});

it('shows the line and a dot per room, lit when on', async () => {
  mocks.set('wall2_desk_house', () => house());
  mocks.set('wall2_desk_rooms', () => rooms);
  const { container } = render(<LeftWing now={() => NOW} />);
  await flush();
  expect(container.querySelector('.house-line')?.textContent).toBe('68° inside. Lights on in two rooms.');
  expect(container.querySelector('.house-line b')?.textContent).toBe('68° inside.');
  expect(container.querySelector('.home-wing.with-house')).toBeTruthy();
  expect([...container.querySelectorAll('.house-room')].map((r) => `${r.textContent}:${r.classList.contains('on')}`)).toEqual(['Office:true', 'Den:true', 'Kitchen:false']);
  expect(container.querySelector('.house.stale')).toBeNull();
});

it('without a temperature says the lights alone; stale data dims and says as of', async () => {
  mocks.set('wall2_desk_house', () => house({ insideF: null, stale: true }));
  mocks.set('wall2_desk_rooms', () => Promise.reject(new Error('failed')));
  const { container } = render(<LeftWing now={() => NOW} />);
  await flush();
  expect(screen.getByText('Lights on in two rooms.')).toBeTruthy();
  expect(container.querySelector('.house.stale')).toBeTruthy();
  expect(container.querySelector('.house-asof')?.textContent).toMatch(/^as of /);
  // No room list read: no dots, the line still stands.
  expect(container.querySelectorAll('.house-room')).toHaveLength(0);
});

// The measured trim: jsdom has no layout, so the row's sizes are faked from how many room dots it holds.
const holds = { max: 99, wide: false };
const fontsFake = new EventTarget() as EventTarget & { ready: Promise<unknown> };
let roCallbacks: ResizeObserverCallback[] = [];
const sized = (name: 'scrollHeight' | 'scrollWidth' | 'clientHeight' | 'clientWidth', f: (el: HTMLElement) => number) =>
  vi.spyOn(HTMLElement.prototype, name, 'get').mockImplementation(function (this: HTMLElement) {
    return f(this);
  });
const dots = (el: HTMLElement) => el.querySelectorAll('.house-room:not(.more)').length;
function fakeLayout() {
  holds.max = 99;
  holds.wide = false;
  fontsFake.ready = Promise.resolve();
  Object.defineProperty(document, 'fonts', { value: fontsFake, configurable: true });
  roCallbacks = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: ResizeObserverCallback) {
        roCallbacks.push(cb);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  const row = (el: HTMLElement) => el.classList.contains('house-rooms');
  // Too many dots: a third line (height) or, when `wide`, something wider than the row.
  sized('clientHeight', () => 56);
  sized('clientWidth', () => 424);
  sized('scrollHeight', (el) => (row(el) && !holds.wide && dots(el) > holds.max ? 90 : 56));
  sized('scrollWidth', (el) => (row(el) && holds.wide && dots(el) > holds.max ? 600 : 424));
}
const twelve = {
  rooms: Array.from({ length: 12 }, (_, i) => ({ id: String(i), name: `Room ${i}`, on: i % 2 === 0 })),
  stale: false,
};
const state = (c: HTMLElement) => {
  const shown = c.querySelectorAll('.house-room:not(.more)').length;
  const more = c.querySelector('.house-room.more')?.textContent ?? '';
  return { shown, more };
};
const mountTwelve = async () => {
  mocks.set('wall2_desk_house', () => house({ litRooms: 6, rooms: 12 }));
  mocks.set('wall2_desk_rooms', () => twelve);
  const r = render(<LeftWing now={() => NOW} />);
  await flush(50);
  return r;
};
const afterMeasure = () => vi.restoreAllMocks();

it('lit rooms: trims to what the real lines hold, and "+N more" is the true remainder', async () => {
  fakeLayout();
  holds.max = 7;
  const { container } = await mountTwelve();
  expect(state(container)).toEqual({ shown: 7, more: '+5 more' });
  afterMeasure();
});

it('lit rooms: a measure made under a wrong font is dropped when the fonts finish loading', async () => {
  fakeLayout();
  holds.max = 2; // fallback font: wide, few fit
  const { container } = await mountTwelve();
  expect(state(container)).toEqual({ shown: 2, more: '+10 more' });
  holds.max = 5; // the display font arrives: narrower
  await act(async () => {
    fontsFake.dispatchEvent(new Event('loadingdone'));
  });
  await flush(10);
  expect(state(container)).toEqual({ shown: 5, more: '+7 more' });
  afterMeasure();
});

it('lit rooms: a change of the row width measures again from zero', async () => {
  fakeLayout();
  holds.max = 3;
  const { container } = await mountTwelve();
  expect(state(container).shown).toBe(3);
  holds.max = 6;
  await act(async () => {
    roCallbacks.forEach((cb) => cb([{ contentRect: { width: 500 } }] as unknown as ResizeObserverEntry[], {} as ResizeObserver));
  });
  await flush(10);
  expect(state(container)).toEqual({ shown: 6, more: '+6 more' });
  afterMeasure();
});

it('lit rooms: something wider than the row (no third line) is also "does not fit"', async () => {
  fakeLayout();
  holds.wide = true;
  holds.max = 6;
  const { container } = await mountTwelve();
  expect(state(container)).toEqual({ shown: 6, more: '+6 more' });
  afterMeasure();
});

it('lit rooms: the trim ends, bounded by the number of rooms, when nothing ever fits', async () => {
  fakeLayout();
  holds.max = -1;
  const { container } = await mountTwelve();
  expect(state(container)).toEqual({ shown: 0, more: '+12 more' });
  afterMeasure();
});

it('lit rooms: an over-long name stays in its own dot item, whole in the name and in its card', async () => {
  fakeLayout();
  const long = 'A very long room name that goes on and on and on past the end of the row for sure';
  mocks.set('wall2_desk_house', () => house({ litRooms: 1, rooms: 1 }));
  mocks.set('wall2_desk_rooms', () => ({ rooms: [{ id: '1', name: long, on: true }], stale: false }));
  const { container } = render(<LeftWing now={() => NOW} />);
  await flush(50);
  const item = container.querySelector('.house-room');
  expect(item?.querySelector('.house-room-name')?.textContent).toBe(long);
  expect(container.querySelector('.house-room.more')).toBeNull();
  afterMeasure();
});

// The Next line: the routine the home app expects, under the room dots.
const clockOf = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const change = (slot: NextChange['slot'], ms: number): NextChange => ({
  slot,
  label: slot === 'day' ? 'Day' : slot === 'evening' ? 'Evening' : 'Late night',
  at: new Date(NOW + ms).toISOString(),
  basis: 'clock',
});
const MIN = 60_000;
const HOUR = 60 * MIN;

it('next: counts down within the hour, gives the clock time beyond, amber in the last 15 minutes', () => {
  expect(nextView(change('evening', 42 * MIN), NOW)).toMatchObject({ label: 'Evening', when: 'in 42 min', soon: false });
  expect(nextView(change('evening', 9 * MIN), NOW)).toMatchObject({ when: 'in 9 min', soon: true });
  expect(nextView(change('evening', 15 * MIN), NOW)).toMatchObject({ when: 'in 15 min', soon: true });
  expect(nextView(change('evening', 16 * MIN), NOW)?.soon).toBe(false);
  // Whole minutes round up: never "in 0 min" for a change not yet made.
  expect(nextView(change('evening', 10_000), NOW)?.when).toBe('in 1 min');
  expect(nextView(change('evening', 60 * MIN), NOW)?.when).toBe('in 60 min');
  const far = nextView(change('late-night', 5 * HOUR), NOW);
  expect(far).toMatchObject({ label: 'Late night', when: `at ${clockOf(NOW + 5 * HOUR)}`, soon: false });
  expect(far?.tip).toBe(`Late night runs at ${clockOf(NOW + 5 * HOUR)} (Apple Home). Hidden while a mood is held, On Air is on, or nobody is home.`);
});

it('next: hidden when absent, null, past, now, unreadable, over 26 hours, or an unknown slot', () => {
  expect(nextView(undefined, NOW)).toBeNull();
  expect(nextView(null, NOW)).toBeNull();
  expect(nextView(change('day', -MIN), NOW)).toBeNull();
  expect(nextView(change('day', 0), NOW)).toBeNull();
  expect(nextView({ ...change('day', HOUR), at: 'soon' }, NOW)).toBeNull();
  expect(nextView(change('day', 26 * HOUR), NOW)?.when).toBe(`at ${clockOf(NOW + 26 * HOUR)}`);
  expect(nextView(change('day', 26 * HOUR + MIN), NOW)).toBeNull();
  expect(nextView({ ...change('day', HOUR), slot: 'noon' as NextChange['slot'] }, NOW)).toBeNull();
});

it('next: a third line with the slot icon, bold label and time; amber when close; hover says when', async () => {
  resetTip();
  mocks.set('wall2_desk_house', () => house({ next: change('evening', 42 * MIN) }));
  mocks.set('wall2_desk_rooms', () => rooms);
  const { container } = render(<><LeftWing now={() => NOW} /><HoverTipLayer /></>);
  await flush();
  const line = container.querySelector('.house-next');
  expect(line?.textContent).toBe('Evening in 42 min');
  expect(line?.querySelector('b')?.textContent).toBe('Evening');
  expect(line?.classList.contains('soon')).toBe(false);
  expect(line?.querySelector('svg')).toBeTruthy();
  fireEvent.mouseEnter(line as Element);
  await flush(TIP_DELAY_MS);
  expect(document.body.textContent).toContain(`Evening runs at ${clockOf(NOW + 42 * MIN)} (Apple Home). Hidden while a mood is held, On Air is on, or nobody is home.`);
  resetTip();
});

it('next: amber inside 15 minutes, and a different icon per slot', async () => {
  const icon = async (slot: NextChange['slot'], ms: number) => {
    mocks.set('wall2_desk_house', () => house({ next: change(slot, ms) }));
    mocks.set('wall2_desk_rooms', () => rooms);
    const { container, unmount } = render(<LeftWing now={() => NOW} />);
    await flush();
    const line = container.querySelector('.house-next');
    const out = { soon: line?.classList.contains('soon'), svg: line?.querySelector('svg')?.getAttribute('class') ?? '' };
    unmount();
    return out;
  };
  const day = await icon('day', 30 * MIN);
  const evening = await icon('evening', 9 * MIN);
  const night = await icon('late-night', 3 * HOUR);
  expect(evening.soon).toBe(true);
  expect(day.soon).toBe(false);
  expect(day.svg).toMatch(/tabler-icon-sun$/);
  expect(evening.svg).toMatch(/sunset-2/);
  expect(night.svg).toMatch(/moon/);
});

it('next: no line when the field is absent or null, or the read is not live', async () => {
  for (const over of [{}, { next: null }, { next: change('evening', -MIN) }, { next: change('evening', 40 * HOUR) }, { next: change('evening', 9 * MIN), stale: true }]) {
    mocks.set('wall2_desk_house', () => house(over));
    mocks.set('wall2_desk_rooms', () => rooms);
    const { container, unmount } = render(<LeftWing now={() => NOW} />);
    await flush();
    expect(container.querySelector('.house')).toBeTruthy();
    expect(container.querySelector('.house-next')).toBeNull();
    unmount();
  }
});

it('next: moves on with the clock, and goes when the time passes', async () => {
  mocks.set('wall2_desk_house', () => house({ next: change('evening', 5 * MIN + 1000) }));
  mocks.set('wall2_desk_rooms', () => rooms);
  const { container } = render(<LeftWing now={() => NOW} />);
  await flush();
  expect(container.querySelector('.house-next')?.textContent).toBe('Evening in 6 min');
  await flush(60_000);
  expect(container.querySelector('.house-next')?.textContent).toBe('Evening in 5 min');
  await flush(5 * MIN);
  expect(container.querySelector('.house-next')).toBeNull();
});
