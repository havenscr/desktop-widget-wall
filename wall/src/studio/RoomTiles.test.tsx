import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { RoomTile } from './RoomTiles';
import type { Group, Studio } from './home';

const group = (over: Partial<Group>): Group => ({ id: 'overhead', label: 'Overhead', on: true, setTo: null, colour: null, canSwitch: true, canDim: true, level: 60, floor: null, reachable: true, ...over });
const studio = { groups: [group({ id: 'behindMonitor' })] } as unknown as Studio;

test('a room tile that can be used and is on draws its track and bar', () => {
  const { container } = render(<RoomTile studio={studio} g={group({})} canWrite />);
  expect(container.querySelector('.st-track')).toBeTruthy();
  expect(container.querySelector('.st-bar')).toBeTruthy();
});

test('a disabled (view only) room tile draws no track and no bar', () => {
  const { container } = render(<RoomTile studio={studio} g={group({})} canWrite={false} />);
  expect(container.querySelector('.st-track')).toBeNull();
  expect(container.querySelector('.st-bar')).toBeNull();
});

test('a dim (not answering) room tile draws no track and no bar', () => {
  const { container } = render(<RoomTile studio={studio} g={group({ reachable: false })} canWrite />);
  expect(container.querySelector('.st-track')).toBeNull();
  expect(container.querySelector('.st-bar')).toBeNull();
});
