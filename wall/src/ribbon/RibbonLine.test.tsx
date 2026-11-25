import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { RibbonLine } from './RibbonLine';
import { useFixedClock, usePacificTime } from './testZone';

usePacificTime();
const t = (hm: string) => Date.parse(`2026-11-11T${hm}:00-08:00`);
useFixedClock(t('10:24'));
const iso = (hm: string) => new Date(t(hm)).toISOString().replace('.000Z', 'Z');

afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
});

it('draws a bar for each meeting and a dot at the time', async () => {
  mocks.set('wall2_meet_day', () => ({
    accounts: [{ id: 'w', label: 'Work', state: 'ok' }],
    events: [{ key: 'a', accountId: 'w', title: 'Sync', start: iso('09:00'), end: iso('09:45'), canJoin: false, isLive: false }],
  }));
  const r = render(<RibbonLine />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(r.container.querySelectorAll('.rl-ev')).toHaveLength(1);
  expect(r.container.querySelector('.rl-now')).not.toBeNull();
  expect(r.container.querySelector('[aria-hidden="true"]')).not.toBeNull();
});
