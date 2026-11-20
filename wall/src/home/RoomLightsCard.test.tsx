import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { HoverTipLayer, resetTip, TIP_DELAY_MS } from '../ui/HoverTip';
import { LeftWing } from './LeftWing';
import { roomCardView } from './RoomLightsCard';
import { HOUSE_REFRESH_MS, type Room } from './useDesk';

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
  resetTip();
  vi.useRealTimers();
  mocks.clear();
});

const light = (name: string, brightness: number | null, over: Record<string, unknown> = {}) => ({ id: name.replace(/\W/g, ''), name, on: true, brightness, reachable: true, ...over });
const house = { observedAt: '2026-11-11T18:23:30Z', insideF: 68, litRooms: 1, rooms: 2, stale: false };
const room = (over: Partial<Room> = {}): Room => ({ id: '1', name: 'Office', on: true, ...over });

it('lists the lit, reachable lights by name with a percent, plugs say on, and counts them in the title', () => {
  const v = roomCardView(room({ lights: [light('Desk lamp', 80), light('Bookshelf strip', 45), light('Ceiling', 100), light('Plug', null), light('Ghost', 50, { reachable: false }), light('Dark', null, { on: false })] }));
  expect(v?.count).toBe('4 on');
  expect(v?.rows.map((r) => `${r.name}:${r.value}`)).toEqual(['Bookshelf strip:45%', 'Ceiling:100%', 'Desk lamp:80%', 'Plug:on']);
  expect(v?.more).toBe(0);
});

it('caps at six rows and counts the rest', () => {
  const lights = Array.from({ length: 8 }, (_, i) => light(`Lamp ${i + 1}`, 50));
  const v = roomCardView(room({ lights }));
  expect(v?.rows).toHaveLength(6);
  expect(v?.more).toBe(2);
  expect(v?.count).toBe('8 on');
});

it('an off room says lights off, a lit room with nothing listed says so, and no list gives no card', () => {
  expect(roomCardView(room({ on: false, lights: [light('Desk lamp', 80)] }))).toMatchObject({ count: 'Lights off', rows: [] });
  expect(roomCardView(room({ lights: [light('Ghost', 50, { reachable: false })] }))).toMatchObject({ count: 'Lights on, none listed', rows: [] });
  expect(roomCardView(room({ lights: [] }))).toMatchObject({ count: 'Lights on, none listed' });
  expect(roomCardView(room())).toBeNull();
  expect(roomCardView(room({ lights: null }))).toBeNull();
});

const dot = (c: HTMLElement, name: string) => [...c.querySelectorAll<HTMLElement>('.house-room')].find((e) => e.textContent === name)!;

it('hovering a dot shows the list card; an older home app keeps the one-line card', async () => {
  mocks.set('wall2_desk_house', () => house);
  mocks.set('wall2_desk_rooms', () => ({
    rooms: [{ ...room(), lights: [light('Desk lamp', 80), light('Ceiling', 100)] }, { id: '2', name: 'Den', on: true }],
    stale: false,
  }));
  const { container } = render(<><LeftWing now={() => NOW} /><HoverTipLayer /></>);
  await flush();
  fireEvent.mouseEnter(dot(container, 'Office'));
  await flush(TIP_DELAY_MS);
  const card = container.querySelector('.hover-tip .rl-card');
  expect(card?.querySelector('.rl-title')?.textContent).toBe('Office');
  expect(card?.querySelector('.rl-count')?.textContent).toBe('2 on');
  expect([...card!.querySelectorAll('.rl-row')].map((r) => r.textContent)).toEqual(['Ceiling100%', 'Desk lamp80%']);
  fireEvent.mouseLeave(dot(container, 'Office'));
  fireEvent.mouseEnter(dot(container, 'Den'));
  await flush(TIP_DELAY_MS);
  expect(container.querySelector('.hover-tip .rl-card')).toBeNull();
  expect(container.querySelector('.hover-tip')?.textContent).toBe('Den: lights on');
});

it('an open card changes when a poll lands and the room has gone off', async () => {
  let on = true;
  mocks.set('wall2_desk_house', () => house);
  mocks.set('wall2_desk_rooms', () => ({ rooms: [{ ...room({ on }), lights: [light('Desk lamp', 80)] }], stale: false }));
  const { container } = render(<><LeftWing now={() => NOW} /><HoverTipLayer /></>);
  await flush();
  fireEvent.mouseEnter(dot(container, 'Office'));
  await flush(TIP_DELAY_MS);
  expect(container.querySelector('.hover-tip .rl-count')?.textContent).toBe('1 on');
  on = false;
  await flush(HOUSE_REFRESH_MS);
  expect(container.querySelector('.hover-tip .rl-count')?.textContent).toBe('Lights off');
  expect(container.querySelector('.hover-tip .rl-row')).toBeNull();
});

it('a stale read ends the card with the as-of line', async () => {
  mocks.set('wall2_desk_house', () => ({ ...house, stale: true }));
  mocks.set('wall2_desk_rooms', () => ({ rooms: [{ ...room(), lights: [light('Desk lamp', 80)] }], stale: true }));
  const { container } = render(<><LeftWing now={() => NOW} /><HoverTipLayer /></>);
  await flush();
  fireEvent.mouseEnter(dot(container, 'Office'));
  await flush(TIP_DELAY_MS);
  expect(container.querySelector('.hover-tip .rl-asof')?.textContent).toMatch(/^as of \d/);
});
