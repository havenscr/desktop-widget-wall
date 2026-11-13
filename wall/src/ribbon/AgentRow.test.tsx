import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { lane, summary } from '../agents/fixtures';
import { resetAgents } from '../agents/useAgents';
import { mocks } from '../bridge/tauri';
import { useFocusStore } from '../focus/store';
import { HoverTipLayer, TIP_DELAY_MS } from '../ui/HoverTip';
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


const cells = (r: ReturnType<typeof render>) => [...r.container.querySelectorAll('.agent-row .ac')] as HTMLElement[];

it('draws the thin activity bar from 6 AM to now in 12 minute cells, amber where one waited', async () => {
  answer = () =>
    summary({
      lanes: [lane({ id: 'a1b2c3d4-0001' }), lane({ id: 'a1b2c3d4-0002' })],
      day: [
        { lane: 'a1b2c3d4-0001', start: iso('06:00'), end: iso('07:00'), kind: 'done' },
        { lane: 'a1b2c3d4-0001', start: iso('09:36'), end: null, kind: 'run' },
        { lane: 'a1b2c3d4-0002', start: iso('10:00'), end: null, kind: 'wait' },
      ],
    });
  const r = render(<Ribbon kind="work" />);
  await flush();
  const c = cells(r);
  // 6:00 to 7:00 is five cells; 9:36 to 10:24 is four cells.
  expect(c).toHaveLength(9);
  expect(parseFloat(c[0].style.left)).toBeCloseTo(RX(6), 3);
  expect(parseFloat(c[5].style.left)).toBeCloseTo(RX(9.6), 3);
  // Two sessions busy in the 10:00 cell, one of them waiting: amber and brighter.
  const tenOClock = c[7].querySelector('i') as HTMLElement;
  expect(tenOClock.className).toBe('wait');
  expect(Number(tenOClock.style.opacity)).toBeCloseTo(0.49, 2);
  expect((c[5].querySelector('i') as HTMLElement).className).toBe('');
  expect(c[7].getAttribute('aria-label')).toBe('10:00 to 10:12: 2 sessions busy, one waiting on you');
});

it('the agents line counts the open sessions, amber for the ones that need the owner', async () => {
  answer = () =>
    summary({
      sessionsList: [
        lane({ id: 'a1b2c3d4-0001' }),
        lane({ id: 'a1b2c3d4-0002', waiting: true, state: 'blocked' }),
        lane({ id: 'a1b2c3d4-0003', state: 'review' }),
        lane({ id: 'a1b2c3d4-0004', live: 'idle' }),
      ],
      day: [{ lane: 'a1b2c3d4-0001', start: iso('09:42'), end: null, kind: 'run' }],
    });
  const r = render(<Ribbon kind="work" />);
  await flush();
  const line = r.container.querySelector('.ag-line') as HTMLElement;
  expect(line.textContent).toBe('4 sessions: 1 needs you, 1 working');
  expect(line.querySelector('.need')!.textContent).toBe('1 needs you');
  // Just after the needle.
  expect(parseFloat(line.style.left)).toBeCloseTo(RX(10.4) + 14, 3);
});

it('with nobody waiting the line says how many work and how many sit idle', async () => {
  answer = () => summary({ day: [{ lane: 'a1b2c3d4-0001', start: iso('09:42'), end: null, kind: 'run' }], lanes: [lane(), lane({ id: 'a1b2c3d4-0002', live: 'idle' }), lane({ id: 'a1b2c3d4-0003', state: 'review' })] });
  const r = render(<Ribbon kind="work" />);
  await flush();
  expect(r.container.querySelector('.ag-line')!.textContent).toBe('3 sessions: 1 working, 2 idle');
  expect(r.container.querySelector('.ag-line .need')).toBeNull();
});

it('after a failed read, dims the row, ends the bar at the last good answer and says as of when', async () => {
  let fail = false;
  answer = () => {
    if (fail) throw new Error('failed');
    return summary({ lanes: [lane({ id: 'a1b2c3d4-0001' })], day: [{ lane: 'a1b2c3d4-0001', start: iso('09:36'), end: null, kind: 'run' }] });
  };
  const r = render(<Ribbon kind="work" />);
  await flush();
  expect(r.container.querySelector('.agent-row')!.className).toBe('agent-row');
  fail = true;
  await flush(20 * 60_000 + 100);
  expect(r.container.querySelector('.ndl')!.textContent).toBe('10:44');
  expect(r.container.querySelector('.agent-row')!.className).toBe('agent-row stale');
  // The cells stop at 10:24, the last good answer: 9:36 to 10:24 is four cells.
  expect(cells(r)).toHaveLength(4);
  expect(r.container.querySelector('.ag-line .asof')!.textContent).toBe(', as of 10:24');
});

it('a helper clock 2 hours off this PC draws the bar where it would with no skew', async () => {
  answer = () => summary({ now: new Date(t('12:24')).toISOString(), lanes: [lane()], day: [{ lane: 'a1b2c3d4-0001', start: new Date(t('11:36')).toISOString(), end: null, kind: 'run' }] });
  const r = render(<Ribbon kind="work" />);
  await flush();
  const c = cells(r);
  expect(c).toHaveLength(4);
  expect(parseFloat(c[0].style.left)).toBeCloseTo(RX(9.6), 3);
});

it('a click on the agents line opens Agents today; a cell hover says how many were busy', async () => {
  mocks.set('wall2_omni_days', () => [{ date: '2026-11-11', sessions: 1 }, { date: '2026-11-10', sessions: 2 }]);
  mocks.set('wall2_omni_day', () => null);
  answer = () => summary({ lanes: [lane()], day: [{ lane: 'a1b2c3d4-0001', start: iso('09:36'), end: null, kind: 'run' }] });
  const r = render(
    <>
      <Ribbon kind="work" />
      <HoverTipLayer />
    </>,
  );
  await flush();
  fireEvent.mouseEnter(cells(r)[0]);
  await flush(TIP_DELAY_MS + 10);
  expect(r.container.querySelector('.hover-tip')!.textContent).toContain('9:36 to 9:48: 1 session busy');
  fireEvent.click(r.container.querySelector('.ag-line') as HTMLElement);
  await flush();
  expect(r.container.querySelector('.agents-today')).not.toBeNull();
  expect(r.container.querySelector('.agents-today .at-row .at-name')!.textContent).toBe('Voice: iPhone mic fix');
});

it('a fresh empty day with no open session and nothing due says so, with no agents line', async () => {
  answer = () => summary({ lanes: [], day: [] });
  mocks.set('wall2_tasks_summary', () => ({ next: [], remaining: 0, dueTomorrow: { count: 0, estMinutes: 0 } }));
  const r = render(<Ribbon kind="work" />);
  await flush();
  expect(r.container.querySelector('.ag-line')).toBeNull();
  expect(r.container.textContent).toContain('No agent activity yet');
});

it('a due label that would sit on the agent bars shows only its diamond, with the label in the hover', async () => {
  const task = (id: string, title: string, due: string) => ({ id, title, due_at: due, due_is_all_day: false, quadrant: null, est: null });
  mocks.set('wall2_tasks_summary', () => ({ next: [task('t1', 'Send the proposal', iso('09:50')), task('t2', 'Late one', iso('20:00'))], remaining: 0, dueTomorrow: { count: 0, estMinutes: 0 } }));
  answer = () => summary({ lanes: [lane({ id: 'a1b2c3d4-0001' })], day: [{ lane: 'a1b2c3d4-0001', start: iso('09:00'), end: null, kind: 'run' }] });
  const r = render(<Ribbon kind="work" />);
  await flush();
  const marks = [...r.container.querySelectorAll('.due')] as HTMLElement[];
  expect(marks.map((m) => m.className)).toEqual(['due bare', 'due']);
  expect(marks[0].textContent).toBe('');
  expect(marks[0].getAttribute('aria-label')).toBe('Due 9:50: Send the proposal. Opens the task');
  expect(marks[1].textContent).toBe('Late one, 8:00');
});
