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
  const bars = [...r.container.querySelectorAll('.agent-row .sg')] as HTMLElement[];
  expect(bars.map((s) => s.className)).toEqual(['sg done', 'sg run', 'sg wait']);
  // One sub-row per session, in the cards' order: two sessions, 8 px apart.
  const segs = [...r.container.querySelectorAll('.agent-row .sg-hit')] as HTMLElement[];
  expect(segs.map((s) => s.style.top)).toEqual(['68px', '68px', '76px']);
  expect(parseFloat(segs[1].style.left)).toBeCloseTo(RX(9.7), 3);
  expect(parseFloat(segs[1].style.width)).toBeCloseTo(RX(10.4) - RX(9.7), 3);
  // The mint cap sits at the end of the done span.
  expect(segs[0].querySelector('.cap2')).not.toBeNull();
  expect(parseFloat(segs[0].style.left) + parseFloat(segs[0].style.width)).toBeCloseTo(RX(7 + 10 / 60), 3);
  // The card's number at the left of each session's first bar, and the stage colour as its notch.
  expect(segs[0].querySelector('.sg-num')!.textContent).toBe('1');
  expect(segs[1].querySelector('.sg-num')).toBeNull();
  expect(segs[2].querySelector('.sg-num')!.textContent).toBe('2');
  expect(bars[0].style.getPropertyValue('--sc')).toBe('var(--st-build)');
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

it('after a failed read, dims the row and ends open runs at the last good answer instead of growing to now', async () => {
  let fail = false;
  answer = () => {
    if (fail) throw new Error('failed');
    return summary({ lanes: [lane({ id: 'a1b2c3d4-0001' })], day: [{ lane: 'a1b2c3d4-0001', start: iso('09:42'), end: null, kind: 'run' }] });
  };
  const r = render(<Ribbon kind="work" />);
  await flush();
  expect(r.container.querySelector('.agent-row')!.className).toBe('agent-row');
  fail = true;
  // Twenty minutes on: the needle is at 10:44, but the run ends at 10:24, the last good answer.
  await flush(20 * 60_000 + 100);
  expect(r.container.querySelector('.ndl')!.textContent).toBe('10:44');
  expect(r.container.querySelector('.agent-row')!.className).toBe('agent-row stale');
  expect(r.container.querySelector('.agent-row .sg')!.className).toBe('sg run');
  const seg = r.container.querySelector('.agent-row .sg-hit') as HTMLElement;
  expect(parseFloat(seg.style.width)).toBeCloseTo(RX(10.4) - RX(9.7), 3);
});

it('a helper-stale answer is dimmed and its open runs stop at the last fresh answer', async () => {
  let stale = false;
  answer = () => summary({ stale, lanes: [lane({ id: 'a1b2c3d4-0001' })], day: [{ lane: 'a1b2c3d4-0001', start: iso('09:42'), end: null, kind: 'run' }] });
  const r = render(<Ribbon kind="work" />);
  await flush();
  stale = true;
  await flush(10 * 60_000);
  expect(r.container.querySelector('.agent-row')!.className).toBe('agent-row stale');
  const seg = r.container.querySelector('.agent-row .sg-hit') as HTMLElement;
  expect(parseFloat(seg.style.width)).toBeCloseTo(RX(10.4) - RX(9.7), 3);
});

it('a helper clock 2 hours off this PC draws the agent row where it would with no skew', async () => {
  const day = (shift: number) => [
    { lane: 'a1b2c3d4-0001', start: new Date(t('06:00') + shift).toISOString(), end: new Date(t('07:10') + shift).toISOString(), kind: 'done' as const },
    { lane: 'a1b2c3d4-0001', start: new Date(t('09:42') + shift).toISOString(), end: null, kind: 'run' as const },
  ];
  const draw = async (shift: number) => {
    resetAgents();
    answer = () => summary({ now: new Date(Date.now() + shift).toISOString(), lanes: [lane({ id: 'a1b2c3d4-0001' })], day: day(shift) });
    const r = render(<Ribbon kind="work" />);
    await flush();
    const out = [...r.container.querySelectorAll('.agent-row .sg-hit')].map((e) => [e.firstElementChild!.className, (e as HTMLElement).style.left, (e as HTMLElement).style.width]);
    r.unmount();
    return out;
  };
  const straight = await draw(0);
  expect(straight).toHaveLength(2);
  expect(await draw(2 * 3_600_000)).toEqual(straight);
  expect(await draw(-2 * 3_600_000)).toEqual(straight);
});

it('hover names the session with its stage and spans, an ended one from the names map, and a click opens it', async () => {
  const opened: (string | null)[] = [];
  mocks.set('wall2_focus_omnigent', (args) => {
    opened.push((args?.id as string | null) ?? null);
  });
  answer = () =>
    summary({
      lanes: [lane({ id: 'a1b2c3d4-0001', title: 'Voice fix', stage: 'review' })],
      sessions: { 'a1b2c3d4-00e1': { title: 'Morning triage', stage: 'live', state: 'review' } },
      day: [
        { lane: 'a1b2c3d4-00e1', start: iso('06:30'), end: iso('07:00'), kind: 'done' },
        { lane: 'a1b2c3d4-0002', start: iso('07:10'), end: iso('07:40'), kind: 'run' },
        { lane: 'a1b2c3d4-0001', start: iso('08:10'), end: iso('09:40'), kind: 'run' },
        { lane: 'a1b2c3d4-0001', start: iso('09:40'), end: null, kind: 'wait' },
      ],
    });
  const r = render(
    <>
      <Ribbon kind="work" />
      <HoverTipLayer />
    </>,
  );
  await flush();
  const hits = [...r.container.querySelectorAll('.agent-row .sg-hit')] as HTMLElement[];
  const mine = hits.find((h) => h.getAttribute('aria-label')!.startsWith('Voice fix'))!;
  expect(mine.getAttribute('aria-label')).toBe('Voice fix: working 8:10 to 9:40, waiting on you since 9:40');
  fireEvent.mouseEnter(mine);
  await flush(TIP_DELAY_MS);
  const card = document.querySelector('.hover-tip')!;
  expect(card.textContent).toContain('Voice fix');
  expect(card.textContent).toContain('Review stage');
  expect(card.textContent).toContain('waiting on you since 9:40');
  fireEvent.mouseLeave(mine);
  expect(document.querySelector('.hover-tip')).toBeNull();
  expect(hits.find((h) => h.getAttribute('aria-label')!.startsWith('Morning triage'))).toBeTruthy();
  expect(hits.find((h) => h.getAttribute('aria-label')!.startsWith('An earlier session'))).toBeTruthy();
  fireEvent.click(mine);
  await flush();
  expect(opened).toEqual(['a1b2c3d4-0001']);
});
