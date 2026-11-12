import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { lane, summary } from '../agents/fixtures';
import { resetAgents } from '../agents/useAgents';
import { mocks } from '../bridge/tauri';
import { useFocusStore } from '../focus/store';
import { RX } from './model';
import { Ribbon } from './Ribbon';
import { useFixedClock, usePacificTime } from './testZone';

usePacificTime();

const t = (hm: string) => Date.parse(`2026-11-11T${hm}:00-08:00`);
useFixedClock(t('10:24'));
const iso = (hm: string) => new Date(t(hm)).toISOString();

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

let answer: () => unknown;
beforeEach(() => {
  resetAgents();
  mocks.set('wall2_meet_day', () => ({ accounts: [], events: [] }));
  mocks.set('wall2_omni_summary', () => answer());
});
afterEach(() => {
  resetAgents();
  mocks.clear();
  useFocusStore.setState({ sessions: [] });
});

it('draws the agent lanes\' day on row 2 of the Work ribbon: run cyan, wait amber, done with a mint cap', async () => {
  answer = () =>
    summary({
      lanes: [lane({ id: 'a1b2c3d4-0001' }), lane({ id: 'a1b2c3d4-0002' })],
      day: [
        { lane: 'a1b2c3d4-0001', start: iso('06:00'), end: iso('07:10'), kind: 'done' },
        { lane: 'a1b2c3d4-0001', start: iso('09:42'), end: null, kind: 'run' },
        { lane: 'a1b2c3d4-0002', start: iso('10:00'), end: null, kind: 'wait' },
      ],
    });
  const r = render(<Ribbon kind="work" />);
  await flush();
  const segs = [...r.container.querySelectorAll('.agent-row .sg')] as HTMLElement[];
  expect(segs.map((s) => s.className)).toEqual(['sg done', 'sg run', 'sg wait']);
  expect(segs.map((s) => s.style.top)).toEqual(['71px', '71px', '79px']);
  expect(parseFloat(segs[1].style.left)).toBeCloseTo(RX(9.7), 3);
  expect(parseFloat(segs[1].style.width)).toBeCloseTo(RX(10.4) - RX(9.7), 3);
  const cap = r.container.querySelector('.agent-row .cap2') as HTMLElement;
  expect(parseFloat(cap.style.left)).toBeCloseTo(RX(7 + 10 / 60), 3);
});

it('draws nothing when the helper is not set up, and nothing on Home', async () => {
  answer = () => {
    throw new Error('not-configured');
  };
  const r = render(<Ribbon kind="work" />);
  await flush();
  expect(r.container.querySelector('.agent-row')).toBeNull();
  r.unmount();
  answer = () => summary({ day: [{ lane: 'a1b2c3d4-0001', start: iso('09:42'), end: null, kind: 'run' }] });
  resetAgents();
  const home = render(<Ribbon kind="home" />);
  await flush();
  expect(home.container.querySelector('.agent-row')).toBeNull();
});
