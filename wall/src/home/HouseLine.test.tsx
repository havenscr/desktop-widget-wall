import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { houseText } from './HouseLine';
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

it('hides entirely while the desk routes are absent, and the sun block stays where it was', async () => {
  mocks.set('wall2_desk_house', () => Promise.reject(new Error('absent')));
  mocks.set('wall2_desk_rooms', () => Promise.reject(new Error('absent')));
  const { container } = render(<LeftWing now={() => NOW} />);
  await flush();
  expect(container.querySelector('.house')).toBeNull();
  expect(container.querySelector('.home-wing.with-house')).toBeNull();
  expect(container.querySelector('.home-wing')).toBeTruthy();
});

it('shows the line and a dot per room, lit when on, with the sun block moved up', async () => {
  mocks.set('wall2_desk_house', () => house());
  mocks.set('wall2_desk_rooms', () => rooms);
  const { container } = render(<LeftWing now={() => NOW} />);
  await flush();
  expect(screen.getByText('68° inside. Lights on in two rooms.')).toBeTruthy();
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
