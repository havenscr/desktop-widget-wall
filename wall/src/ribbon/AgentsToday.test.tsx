import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { lane, summary } from '../agents/fixtures';
import { resetAgents } from '../agents/useAgents';
import { mocks } from '../bridge/tauri';
import { resetTip } from '../ui/HoverTip';
import { AgentsToday } from './AgentsToday';
import { useAgents } from '../agents/useAgents';
import { resetDays } from './days';
import { useFixedClock, usePacificTime } from './testZone';

usePacificTime();

const t = (d: string, hm: string) => Date.parse(`${d}T${hm}:00-08:00`);
const NOW = t('2026-11-13', '10:24');
useFixedClock(NOW);
const iso = (d: string, hm: string) => new Date(t(d, hm)).toISOString();

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

/** The panel with the agent poll running, as on Work. */
function Panel({ onClose = () => undefined }: { onClose?: () => void }) {
  useAgents();
  return <AgentsToday now={NOW} onClose={onClose} />;
}

const yesterday = {
  date: '2026-11-12',
  tz: 'America/Los_Angeles',
  sessions: [
    { id: 'a1b2c3d4-0e01', title: 'Spend card refresh', spans: [{ stage: 'build', start: iso('2026-11-12', '08:00'), end: iso('2026-11-12', '10:00') }, { stage: 'pr', start: iso('2026-11-12', '10:00'), end: iso('2026-11-12', '10:30') }], pr: { number: 552, state: 'merged' } },
    { id: 'a1b2c3d4-0e02', title: 'Usage meter rework', spans: [{ stage: 'build', start: iso('2026-11-12', '19:00'), end: null }], pr: null },
  ],
};

let opened: unknown[] = [];
let daysAnswer: () => unknown;
beforeEach(() => {
  opened = [];
  daysAnswer = () => [
    { date: '2026-11-13', sessions: 2 },
    { date: '2026-11-12', sessions: 2 },
    { date: '2026-11-10', sessions: 1 },
  ];
  mocks.set('wall2_omni_summary', () =>
    summary({
      lanes: [lane(), lane({ id: 'a1b2c3d4-0002', title: 'Docs tidy pass', waiting: true, state: 'blocked' })],
      day: [
        { lane: 'a1b2c3d4-0001', start: iso('2026-11-13', '08:00'), end: null, kind: 'run' },
        { lane: 'a1b2c3d4-0002', start: iso('2026-11-13', '09:00'), end: iso('2026-11-13', '09:30'), kind: 'run' },
        { lane: 'a1b2c3d4-0002', start: iso('2026-11-13', '09:30'), end: null, kind: 'wait' },
      ],
    }),
  );
  mocks.set('wall2_omni_days', () => daysAnswer());
  mocks.set('wall2_omni_day', (a) => (a?.date === '2026-11-12' ? yesterday : null));
  mocks.set('wall2_focus_omnigent', (a) => void opened.push(a));
});
afterEach(() => {
  resetTip();
  resetAgents();
  resetDays();
  mocks.clear();
});

it('Today: one row per session from the live day, with the wait total', async () => {
  const r = render(<Panel />);
  await flush();
  const rows = [...r.container.querySelectorAll('.at-row')] as HTMLElement[];
  expect(rows.map((x) => x.querySelector('.at-name')!.textContent)).toEqual(['Voice: iPhone mic fix', 'Docs tidy pass']);
  expect(rows.map((x) => x.querySelector('.at-end')!.textContent)).toEqual(['working', 'waiting on you']);
  expect(r.container.querySelector('.at-foot')!.textContent).toContain('2 h 54 m of agent work across 2 sessions, 0 h 54 m waiting on you');
  expect(r.container.querySelector('.at-seg .on')!.textContent).toBe('Today');
  fireEvent.click(rows[1]);
  await flush();
  expect(opened).toEqual([{ id: 'a1b2c3d4-0002' }]);
});

it('Yesterday reads the saved record: merged, carried over, no wait, and the arrows name their dates', async () => {
  const r = render(<Panel />);
  await flush();
  fireEvent.click([...r.container.querySelectorAll('.at-seg button')][1] as HTMLElement);
  await flush();
  expect(r.container.querySelector('.at-date')!.textContent).toBe('Thursday, November 12');
  const rows = [...r.container.querySelectorAll('.at-row')] as HTMLElement[];
  expect(rows.map((x) => x.querySelector('.at-end')!.textContent)).toEqual(['merged', 'carried over']);
  expect(rows[0].querySelector('.at-pr')!.textContent).toBe('PR 552');
  expect(r.container.querySelectorAll('.at-sg.wait')).toHaveLength(0);
  const foot = r.container.querySelector('.at-foot')!.textContent!;
  expect(foot).toContain('of agent work across 2 sessions');
  expect(foot).not.toContain('waiting on you');
  expect(foot).toContain('From the saved record of the day');
  const [prev, next] = [...r.container.querySelectorAll('.at-arrow')] as HTMLButtonElement[];
  expect(prev.disabled).toBe(false);
  fireEvent.click(prev);
  await flush();
  expect(r.container.querySelector('.at-date')!.textContent).toBe('Tuesday, November 10');
  expect(r.container.textContent).toContain('No sessions recorded on this day');
  expect(([...r.container.querySelectorAll('.at-arrow')][0] as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(next);
  await flush();
  expect(r.container.querySelector('.at-date')!.textContent).toBe('Thursday, November 12');
});

it('an older helper with no record routes: the day picker hides and Today still works', async () => {
  daysAnswer = () => {
    throw new Error('failed');
  };
  const r = render(<Panel />);
  await flush();
  expect(r.container.querySelector('.at-pick')).toBeNull();
  expect(r.container.querySelector('.at-k')!.textContent).toBe('Agents today');
  expect(r.container.querySelectorAll('.at-row')).toHaveLength(2);
});

it('Escape and the close button close it', async () => {
  const onClose = vi.fn();
  const r = render(<Panel onClose={onClose} />);
  await flush();
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.click(r.container.querySelector('.at-close') as HTMLElement);
  expect(onClose).toHaveBeenCalledTimes(2);
});

it('the helper down with no earlier answer: no rows, says so, never zero', async () => {
  mocks.set('wall2_omni_summary', () => {
    throw new Error('failed');
  });
  const r = render(<Panel />);
  await flush(15_000);
  expect(r.container.querySelectorAll('.at-row:not(.skel)')).toHaveLength(0);
  expect(r.container.textContent).toContain('not answering');
  expect(r.container.textContent).not.toContain('0 h 00 m');
});
