import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { lane, summary } from '../agents/fixtures';
import { resetAgents } from '../agents/useAgents';
import { mocks } from '../bridge/tauri';
import { useFocusStore } from '../focus/store';
import { HoverTipLayer, resetTip, TIP_DELAY_MS } from '../ui/HoverTip';
import { agendaLanes, agendaRange, quietLine } from './DayDrawer';
import { laneStateWord } from './AgentRow';
import { DrawerScrim } from './DrawerScrim';
import { chips, RX } from './model';
import { Ribbon } from './Ribbon';
import { resetDays } from './days';
import { useFixedClock, usePacificTime } from './testZone';

usePacificTime();

const t = (hm: string) => Date.parse(`2026-11-11T${hm}:00-08:00`);
useFixedClock(t('10:24'));
const iso = (hm: string) => new Date(t(hm)).toISOString().replace('.000Z', 'Z');

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const ev = (key: string, title: string, a: string, b: string, more = {}) => ({ key, accountId: 'work', title, start: iso(a), end: iso(b), canJoin: true, canOpen: true, isLive: false, ...more });
const overlapDay = {
  accounts: [{ id: 'work', label: 'Work', state: 'ok' }],
  events: [
    ev('s', 'Standup', '09:00', '09:15'),
    ev('b', 'Budget sync', '12:45', '13:45'),
    ev('c', 'Design critique', '13:00', '14:00'),
    ev('v', 'Vendor demo', '13:30', '15:30', { canJoin: false }),
    ev('w', 'Weekly planning', '17:00', '17:30'),
    { key: 'all', accountId: 'work', title: 'Team offsite week', start: '2026-11-11T08:00:00Z', end: '2026-11-12T08:00:00Z', canOpen: true },
  ],
};

let opened: unknown[] = [];
beforeEach(() => {
  opened = [];
  mocks.set('wall2_meet_day', () => overlapDay);
  mocks.set('wall2_omni_summary', () =>
    summary({
      sessionsList: [lane(), lane({ id: 'a1b2c3d4-0002', title: 'Usage meter rework', waiting: true, state: 'blocked', line: 'Waiting on a choice' }), lane({ id: 'a1b2c3d4-0003', title: 'Docs tidy pass', live: 'idle' })],
      day: [
        { lane: 'a1b2c3d4-0001', start: iso('08:00'), end: null, kind: 'run' },
        { lane: 'a1b2c3d4-0002', start: iso('09:00'), end: iso('10:00'), kind: 'run' },
        { lane: 'a1b2c3d4-0002', start: iso('10:00'), end: null, kind: 'wait' },
      ],
    }),
  );
  mocks.set('wall2_open_event', (a) => void opened.push(['event', a]));
  mocks.set('wall2_meet_join', (a) => void opened.push(['join', a]));
  mocks.set('wall2_focus_omnigent', (a) => void opened.push(['session', a]));
  mocks.set('wall2_omni_days', () => []);
  mocks.set('wall2_omni_day', () => null);
});
afterEach(() => {
  resetTip();
  resetAgents();
  resetDays();
  mocks.clear();
  useFocusStore.setState({ sessions: [] });
});

it('folds three overlapping meetings into one "3 at 1:30" chip whose hover lists each with its times', async () => {
  const r = render(
    <>
      <Ribbon kind="work" />
      <HoverTipLayer />
    </>,
  );
  await flush();
  const fold = r.container.querySelector('.ev.fold') as HTMLElement;
  expect(fold.querySelector('.fold-n')!.textContent).toBe('3 at 1:30');
  expect(fold.querySelector('.fold-t')!.textContent).toBe('Budget sync, Design critique, Vendor demo');
  expect(parseFloat(fold.style.left)).toBeCloseTo(RX(12.75), 3);
  // Singles stay chips; nothing is stacked in lanes.
  expect([...r.container.querySelectorAll('.ev:not(.fold)')].map((e) => e.getAttribute('aria-label')?.split(',')[0])).toEqual(['Standup', 'Weekly planning']);
  expect(r.container.querySelector('.ev.s2, .ev.s3, .ev.more')).toBeNull();
  // The all-day event is a thin bar over the row.
  expect(r.container.querySelector('.adbar')!.textContent).toBe('All day · Team offsite week');
  expect(r.container.querySelector('.rib')!.className).toContain('has-allday');
  fireEvent.mouseEnter(fold);
  await flush(TIP_DELAY_MS + 10);
  const tipText = r.container.querySelector('.hover-tip')!.textContent;
  expect(tipText).toContain('3 meetings overlap');
  expect(tipText).toContain('Vendor demo1:30 to 3:30 PM');
});

it('the handle opens the Day drawer; a folded chip opens it too; Escape and a click outside (on the scrim) close it', async () => {
  const r = render(
    <>
      <Ribbon kind="work" />
      <DrawerScrim />
    </>,
  );
  await flush();
  expect(r.container.querySelector('.day-drawer')).toBeNull();
  fireEvent.click(r.container.querySelector('.rib-handle') as HTMLElement);
  expect(r.container.querySelector('.day-drawer')).not.toBeNull();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(r.container.querySelector('.day-drawer')).toBeNull();
  fireEvent.click(r.container.querySelector('.ev.fold') as HTMLElement);
  expect(r.container.querySelector('.day-drawer')).not.toBeNull();
  fireEvent.click(r.container.querySelector('.drawer-scrim') as HTMLElement);
  expect(r.container.querySelector('.day-drawer')).toBeNull();
  // A press that is not on the scrim (a stray mouse down on the page) closes nothing.
  fireEvent.click(r.container.querySelector('.ev.fold') as HTMLElement);
  fireEvent.mouseDown(document.body);
  expect(r.container.querySelector('.day-drawer')).not.toBeNull();
});

it('focus goes back to the Day handle when the drawer closes, also when a folded chip opened it', async () => {
  const r = render(
    <>
      <Ribbon kind="work" />
      <DrawerScrim />
    </>,
  );
  await flush();
  const fold = r.container.querySelector('.ev.fold') as HTMLElement;
  fold.focus();
  expect(document.activeElement).toBe(fold);
  fireEvent.click(fold);
  expect(document.activeElement).toBe(r.container.querySelector('.day-drawer'));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(document.activeElement).toBe(r.container.querySelector('.rib-handle:not(.in-drawer)'));
  await flush(600);
});

it('the drawer lists the agenda with overlaps side by side and Join, and one row per session, waiting first', async () => {
  const r = render(<Ribbon kind="work" />);
  await flush();
  fireEvent.click(r.container.querySelector('.rib-handle') as HTMLElement);
  const d = r.container.querySelector('.day-drawer') as HTMLElement;
  const evs = [...d.querySelectorAll('.dd-ev')] as HTMLElement[];
  expect(evs.map((e) => e.querySelector('b')!.textContent)).toEqual(['Standup', 'Budget sync', 'Design critique', 'Vendor demo', 'Weekly planning']);
  expect(evs[1].style.width).toBe('calc(33.3333% - 6px)');
  // Join where the calendar has a link and the meeting has not ended.
  expect(evs[0].querySelector('.dd-join')).toBeNull();
  expect(evs[3].querySelector('.dd-join')).toBeNull();
  fireEvent.click(evs[1].querySelector('.dd-join') as HTMLElement);
  fireEvent.click(evs[2]);
  // Enter on a meeting does what a click does.
  fireEvent.keyDown(evs[4], { key: 'Enter' });
  await flush();
  expect(opened).toEqual([
    ['join', { key: 'b' }],
    ['event', { key: 'c' }],
    ['event', { key: 'w' }],
  ]);
  opened.splice(2, 1);
  const rows = [...d.querySelectorAll('.dd-row')] as HTMLElement[];
  expect(rows.map((x) => x.querySelector('.dd-name')!.textContent)).toEqual(['Usage meter rework', 'Voice: iPhone mic fix', 'Docs tidy pass']);
  expect(rows.map((x) => x.querySelector('.dd-pill')!.textContent)).toEqual(['waiting on you', 'working', 'idle']);
  expect(rows[1].querySelector('.dd-time')!.textContent).toBe('2 h 24 m');
  fireEvent.click(rows[0]);
  await flush();
  expect(opened[2]).toEqual(['session', { id: 'a1b2c3d4-0002' }]);
  // The header link opens the panel in its place.
  fireEvent.click(d.querySelector('.dd-k.link') as HTMLElement);
  await flush();
  expect(r.container.querySelector('.day-drawer')).toBeNull();
  expect(r.container.querySelector('.agents-today')).not.toBeNull();
});

it('the agenda covers 8 AM to 6 PM, wider for a meeting outside it', () => {
  const now = t('10:24');
  const c = chips(overlapDay.events, now);
  expect(agendaRange(c, now)).toEqual({ lo: 8, hi: 18 });
  const late = chips([...overlapDay.events, ev('x', 'Late call', '19:00', '20:15'), ev('y', 'Early', '07:10', '07:40')], now);
  expect(agendaRange(late, now)).toEqual({ lo: 7, hi: 21 });
  const lanes = agendaLanes(c);
  expect(lanes.map((l) => [l.c.title, l.lane, l.lanes])).toEqual([
    ['Standup', 0, 1],
    ['Budget sync', 0, 3],
    ['Design critique', 1, 3],
    ['Vendor demo', 2, 3],
    ['Weekly planning', 0, 1],
  ]);
});

it('the handle is one button on the strip\'s top edge: click, Enter and Space open and close, and its name says which', async () => {
  const r = render(<Ribbon kind="work" />);
  await flush();
  const lip = () => [...r.container.querySelectorAll('.rib-handle')] as HTMLButtonElement[];
  // Outside the strip's clipped box (it reaches above the edge), one button at a time.
  expect(lip()).toHaveLength(1);
  expect(r.container.querySelector('.rib .rib-handle')).toBeNull();
  expect(lip()[0].getAttribute('aria-label')).toBe('Open the day');
  expect(lip()[0].getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(lip()[0]);
  expect(r.container.querySelector('.day-drawer')).not.toBeNull();
  // Open: the same handle sits on the drawer's top edge.
  expect(lip()).toHaveLength(1);
  expect(lip()[0].closest('.day-drawer')).not.toBeNull();
  expect(lip()[0].getAttribute('aria-label')).toBe('Close the day');
  expect(lip()[0].textContent).toBe('Close the day');
  fireEvent.click(lip()[0]);
  expect(r.container.querySelector('.day-drawer')).toBeNull();
  // Enter opens; the open drawer takes keyboard focus (the modal rule).
  lip()[0].focus();
  fireEvent.keyDown(lip()[0], { key: 'Enter' });
  expect(r.container.querySelector('.day-drawer')).not.toBeNull();
  expect(document.activeElement).toBe(r.container.querySelector('.day-drawer'));
  expect(lip()[0].getAttribute('aria-label')).toBe('Close the day');
  // Space closes, and focus returns to the strip's handle.
  fireEvent.keyDown(lip()[0], { key: ' ' });
  expect(r.container.querySelector('.day-drawer')).toBeNull();
  expect(lip()[0].getAttribute('aria-label')).toBe('Open the day');
  expect(document.activeElement).toBe(lip()[0]);
  fireEvent.keyDown(lip()[0], { key: ' ' });
  expect(r.container.querySelector('.day-drawer')).not.toBeNull();
  // Escape still closes.
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(r.container.querySelector('.day-drawer')).toBeNull();
});

it('a row\'s quiet line: the line, else the next step; then the wait, the helpers, the pull request; blank when nothing is known', () => {
  const base = lane({ line: '', next: null, pr: null });
  expect(quietLine(base)).toBe('');
  // A bare state word is not news: the pill already says it.
  for (const w of ['running', 'idle', 'failed', 'working']) expect(quietLine(lane({ line: w, pr: null }))).toBe('');
  expect(quietLine(lane({ line: 'Running web tests, 56 of 89', next: 'merge it', pr: null }))).toBe('Running web tests, 56 of 89');
  expect(quietLine(lane({ line: 'idle', next: 'merge after the review', pr: null }))).toBe('Next: merge after the review');
  expect(quietLine(lane({ line: 'Waiting on a thumbnail choice', waiting: true, state: 'blocked', waitingSinceS: 720, pr: null }))).toBe('Waiting on a thumbnail choice \u00b7 12 min');
  expect(quietLine(lane({ line: 'blocked', waiting: true, state: 'blocked', waitingSinceS: 720, pr: null }))).toBe('Waiting 12 min');
  // The wait only on a row that waits on the owner.
  expect(quietLine(lane({ line: 'running', waitingSinceS: 720, pr: null }))).toBe('');
  expect(quietLine(lane({ line: 'running', kids: { total: 3, working: 2 }, pr: null }))).toBe('3 helpers, 2 working');
  expect(quietLine(lane({ line: 'running', kids: { total: 1, working: 0 }, pr: null }))).toBe('1 helper, none working');
  expect(quietLine(lane({ line: 'failed', failed: true, pr: { number: 571, ci: 'failing', ready: true } }))).toBe('PR 571, checks failing');
  expect(quietLine(lane({ line: 'Drawing options', next: 'x', waiting: true, waitingSinceS: 60, kids: { total: 2, working: 1 }, pr: { number: 5, ci: 'passing', ready: true } }))).toBe(
    'Drawing options \u00b7 1 min \u00b7 2 helpers, 1 working \u00b7 PR 5, checks passing',
  );
});

it('the drawer rows show the state once as the pill, a failed session in rose, and the quiet line; the header counts the failed one', async () => {
  mocks.set('wall2_omni_summary', () =>
    summary({
      sessionsList: [
        lane({ line: 'running', kids: { total: 3, working: 2 } }),
        lane({ id: 'a1b2c3d4-0002', title: 'Review 4 items: docs repo', line: 'failed', failed: true, pr: { number: 571, ci: 'failing', ready: false } }),
        lane({ id: 'a1b2c3d4-0003', title: 'Theme contrast audit', line: 'idle', live: 'idle' }),
      ],
      day: [],
    }),
  );
  const r = render(<Ribbon kind="work" />);
  await flush();
  fireEvent.click(r.container.querySelector('.rib-handle') as HTMLElement);
  const d = r.container.querySelector('.day-drawer') as HTMLElement;
  const rows = [...d.querySelectorAll('.dd-row')] as HTMLElement[];
  expect(rows.map((x) => x.querySelector('.dd-pill')!.textContent)).toEqual(['working', 'failed', 'idle']);
  expect(rows[1].querySelector('.dd-pill')!.className).toBe('dd-pill failed');
  expect(rows.map((x) => x.querySelector('.dd-line')!.textContent)).toEqual(['3 helpers, 2 working', 'PR 571, checks failing, draft', '']);
  // The state never shows twice: the bare "running", "failed" and "idle" lines are not repeated.
  for (const x of rows) expect(x.querySelector('.dd-line')!.textContent).not.toBe(x.querySelector('.dd-pill')!.textContent!);
  expect(d.querySelector('.dd-counts')!.textContent).toBe('3 sessions, 1 working, 1 failed, 1 idle');
  expect(laneStateWord(lane({ failed: true }))).toBe('failed');
  // Failed beats waiting: the pill never reads "waiting on you" for a failed session (the quiet line keeps the wait).
  expect(laneStateWord(lane({ failed: true, waiting: true }))).toBe('failed');
  expect(laneStateWord(lane({ waiting: true }))).toBe('waiting on you');
  expect(quietLine(lane({ failed: true, waiting: true, state: 'blocked', line: 'failed', waitingSinceS: 600, pr: null }))).toBe('Waiting 10 min');
});
