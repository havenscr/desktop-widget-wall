import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { lane, summary } from '../agents/fixtures';
import { resetAgents } from '../agents/useAgents';
import { mocks } from '../bridge/tauri';
import { useFocusStore } from '../focus/store';
import { DrawerScrim, resetScrim } from '../ribbon/DrawerScrim';
import { resetDays } from '../ribbon/days';
import { Ribbon } from '../ribbon/Ribbon';
import { useFixedClock, usePacificTime } from '../ribbon/testZone';
import { usePlaceStore } from '../state/places';
import { ScreensOffLayer } from './ScreensOffLayer';

// The real Day drawer (Ribbon), beside the real corner layer in the stage's own shape: the shell holds the
// place, the layer is its sibling, and the scrim sits after both.
usePacificTime();
const t = (hm: string) => Date.parse(`2026-11-11T${hm}:00-08:00`);
useFixedClock(t('10:24'));

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  usePlaceStore.setState({ active: 'work' });
  mocks.set('wall2_meet_day', () => ({ accounts: [{ id: 'work', label: 'Work', state: 'ok' }], events: [] }));
  mocks.set('wall2_omni_summary', () => summary({ sessionsList: [lane()], day: [] }));
  mocks.set('wall2_omni_days', () => []);
  mocks.set('wall2_omni_day', () => null);
});
afterEach(() => {
  resetScrim();
  resetAgents();
  resetDays();
  mocks.clear();
  useFocusStore.setState({ sessions: [] });
});

it('the corner control is inert while the real Day drawer is open, and usable again once it closes', async () => {
  const r = render(
    <div className="stage">
      <div className="shell">
        <Ribbon kind="work" />
      </div>
      <ScreensOffLayer />
      <DrawerScrim />
    </div>,
  );
  await flush();
  const layer = () => r.container.querySelector('.so-layer') as HTMLElement;
  const button = () => r.container.querySelector('.screens-off') as HTMLButtonElement;
  expect(layer().closest('[inert]')).toBeNull();
  fireEvent.click(r.container.querySelector('.rib-handle') as HTMLElement);
  expect(r.container.querySelector('.day-drawer')).not.toBeNull();
  // Inert: no pointer, no keyboard focus (the page holds everything but the drawer inert; jsdom does not
  // enforce the attribute itself, so the attribute is what is asserted, and the fit check hit-tests it).
  expect(layer().closest('[inert]')).not.toBeNull();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(r.container.querySelector('.day-drawer')).toBeNull();
  expect(layer().closest('[inert]')).toBeNull();
  button().focus();
  expect(document.activeElement).toBe(button());
});
