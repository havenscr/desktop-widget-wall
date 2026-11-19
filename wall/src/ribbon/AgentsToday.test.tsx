// @ts-ignore node's own file calls; one test reads the style sheet as text.
import { readFileSync } from 'node:fs';
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
      sessionsList: [lane(), lane({ id: 'a1b2c3d4-0002', title: 'Docs tidy pass', waiting: true, state: 'blocked' })],
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
  mocks.set('wall2_focus_day_session', (a) => void opened.push(a));
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
  expect(rows[0].querySelector('.at-prn')!.textContent).toBe('PR 552');
  expect(rows[0].querySelector('.at-prtick')).not.toBeNull();
  expect(rows[1].querySelector('.at-prn')!.textContent).toBe('');
  expect(rows[1].querySelector('.at-prtick')).toBeNull();
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

it('an older helper with no record routes (404): the day picker hides and Today still works', async () => {
  daysAnswer = () => {
    throw new Error('absent');
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

it('a past row opens through its record\'s date; a refused open says so', async () => {
  const r = render(<Panel />);
  await flush();
  fireEvent.click([...r.container.querySelectorAll('.at-seg button')][1] as HTMLElement);
  await flush();
  fireEvent.click(r.container.querySelector('.at-row') as HTMLElement);
  await flush();
  expect(opened).toEqual([{ id: 'a1b2c3d4-0e01', date: '2026-11-12' }]);
  mocks.set('wall2_focus_day_session', () => {
    throw new Error('Unknown session');
  });
  fireEvent.click(r.container.querySelector('.at-row') as HTMLElement);
  await flush();
  expect(r.container.querySelector('.at-note')!.textContent).toBe('Could not open that session');
});

it('a passing failure of the day list keeps the last good list and says as of when; no flicker on a reopen', async () => {
  const r = render(<Panel />);
  await flush();
  expect(r.container.querySelector('.at-pick')).not.toBeNull();
  r.unmount();
  daysAnswer = () => {
    throw new Error('failed');
  };
  const again = render(<Panel />);
  // Opened again with a good list held: the picker shows at once, before the read returns.
  expect(again.container.querySelector('.at-pick')).not.toBeNull();
  await flush();
  expect(again.container.querySelector('.at-pick')).not.toBeNull();
  expect(again.container.querySelector('.at-note')!.textContent).toContain('saved days as of 10:24');
});

it("a failed reread of today's record keeps its stage colours, stamped, with the live data live", async () => {
  const todayRec = { date: '2026-11-13', tz: 'America/Los_Angeles', sessions: [{ id: 'a1b2c3d4-0001', title: 'Voice: iPhone mic fix', spans: [{ stage: 'build', start: iso('2026-11-13', '08:00'), end: null }], pr: null }] };
  mocks.set('wall2_omni_day', (a) => (a?.date === '2026-11-13' ? todayRec : null));
  const r = render(<Panel />);
  await flush();
  expect(r.container.querySelector('.at-row .at-sg')!.className).toBe('at-sg build');
  r.unmount();
  mocks.set('wall2_omni_day', () => {
    throw new Error('failed');
  });
  const again = render(<Panel />);
  await flush();
  expect(again.container.querySelector('.at-row .at-sg')!.className).toBe('at-sg build');
  expect(again.container.querySelector('.at-note')!.textContent).toContain('stage colours as of 10:24');
  expect(again.container.querySelector('.at-foot')!.textContent).toContain('waiting on you');
});

it('a child id only in the live day log, or only in the names map, makes no row; a record-only id is a row that opens', async () => {
  mocks.set('wall2_omni_summary', () =>
    summary({
      sessionsList: [lane()],
      sessions: { 'a1b2c3d4-0c02': { title: 'Name map only', stage: 'build', state: 'working' } },
      day: [
        { lane: 'a1b2c3d4-0001', start: iso('2026-11-13', '08:00'), end: null, kind: 'run' },
        { lane: 'a1b2c3d4-0c01', start: iso('2026-11-13', '09:00'), end: null, kind: 'run' },
        { lane: 'a1b2c3d4-0c02', start: iso('2026-11-13', '09:10'), end: null, kind: 'run' },
      ],
    }),
  );
  const todayRec = { date: '2026-11-13', tz: 'America/Los_Angeles', sessions: [{ id: 'a1b2c3d4-0e09', title: 'Ended this morning', spans: [{ stage: 'plan', start: iso('2026-11-13', '07:00'), end: iso('2026-11-13', '07:30') }], pr: null }] };
  mocks.set('wall2_omni_day', (a) => (a?.date === '2026-11-13' ? todayRec : null));
  const r = render(<Panel />);
  await flush();
  const rows = [...r.container.querySelectorAll('.at-row')] as HTMLElement[];
  expect(rows.map((x) => x.querySelector('.at-name')!.textContent)).toEqual(['Voice: iPhone mic fix', 'Ended this morning']);
  fireEvent.click(rows[1]);
  await flush();
  expect(opened).toEqual([{ id: 'a1b2c3d4-0e09', date: '2026-11-13' }]);
});

const labels = (c: HTMLElement) => [...c.querySelectorAll('.at-axis span')].map((x) => x.textContent);

it('the hour labels run every 3 hours on a full day, and a faint line joins a session\'s spans', async () => {
  const r = render(<Panel />);
  await flush();
  fireEvent.click([...r.container.querySelectorAll('.at-seg button')][1] as HTMLElement);
  await flush();
  expect(labels(r.container)).toEqual(['9 AM', '12 PM', '3 PM', '6 PM', '9 PM', '12 AM']);
  const rows = [...r.container.querySelectorAll('.at-row')] as HTMLElement[];
  expect(rows[0].querySelector('.at-join')).not.toBeNull();
  expect(rows[1].querySelector('.at-join')).toBeNull();
  expect(rows[0].querySelector('.at-pr')).toBeNull();
});

it('the busy figures sit in the footer, and the open at once strip sits between the hours and the rows', async () => {
  const r = render(<Panel />);
  await flush();
  fireEvent.click([...r.container.querySelectorAll('.at-seg button')][1] as HTMLElement);
  await flush();
  expect(r.container.querySelector('.at-foot .at-busy')).not.toBeNull();
  const kids = [...r.container.querySelector('.agents-today')!.children].map((c) => c.className.split(' ')[0]);
  expect(kids.indexOf('at-axis') + 1).toBe(kids.indexOf('at-band'));
  expect(kids.indexOf('at-band') + 1).toBe(kids.indexOf('at-rows'));
});

const openCalendar = async (r: ReturnType<typeof render>) => {
  fireEvent.click(r.container.querySelector('.at-date') as HTMLElement);
  await flush();
};

it('the date is a button that opens a month calendar: recorded days bright with a count bar, the rest dim and not clickable', async () => {
  const r = render(<Panel />);
  await flush();
  expect(r.container.querySelector('.at-cal')).toBeNull();
  await openCalendar(r);
  expect(r.container.querySelector('.at-cal-title')!.textContent).toBe('November 2026');
  const day = (n: number) => [...r.container.querySelectorAll('.at-cal-day')][n - 1] as HTMLButtonElement;
  expect(day(12).disabled).toBe(false);
  expect(day(12).classList.contains('has')).toBe(true);
  expect(day(12).querySelector('i')).not.toBeNull();
  expect(day(12).getAttribute('aria-label')).toBe('Thursday, November 12, 2 sessions');
  expect(day(11).disabled).toBe(true);
  expect(day(11).querySelector('i')).toBeNull();
  expect(day(14).disabled).toBe(true);
  fireEvent.click(day(11));
  expect(r.container.querySelector('.at-date')!.textContent).toBe('Friday, November 13');
  fireEvent.click(day(10));
  await flush();
  expect(r.container.querySelector('.at-cal')).toBeNull();
  expect(r.container.querySelector('.at-date')!.textContent).toBe('Tuesday, November 10');
});

it('Escape closes the calendar only; a second Escape closes the popover', async () => {
  const onClose = vi.fn();
  const r = render(<Panel onClose={onClose} />);
  await flush();
  await openCalendar(r);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(r.container.querySelector('.at-cal')).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('a click outside the calendar closes it without closing the popover', async () => {
  const onClose = vi.fn();
  const r = render(<Panel onClose={onClose} />);
  await flush();
  await openCalendar(r);
  fireEvent.mouseDown(r.container.querySelector('.at-foot') as HTMLElement);
  expect(r.container.querySelector('.at-cal')).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
  await openCalendar(r);
  fireEvent.mouseDown(r.container.querySelector('.at-cal-title') as HTMLElement);
  expect(r.container.querySelector('.at-cal')).not.toBeNull();
});

it('the month arrows stop at the earliest saved month and this month', async () => {
  const r = render(<Panel />);
  await flush();
  await openCalendar(r);
  const [earlier, later] = [...r.container.querySelectorAll('.at-cal-head .at-arrow')] as HTMLButtonElement[];
  expect(earlier.disabled).toBe(true);
  expect(later.disabled).toBe(true);
});

it('a quiet past day fits its hours on the axis; a busy one keeps the usual axis', async () => {
  const r = render(<Panel />);
  await flush();
  fireEvent.click([...r.container.querySelectorAll('.at-seg button')][1] as HTMLElement);
  await flush();
  // Yesterday has 2 sessions (08:00 to 10:30, and 19:00 to the end of the day): fitted 7 AM to midnight (labels on the multiples of 3).
  expect(labels(r.container)[0]).toBe('9 AM');
  expect(r.container.querySelector('.at-grid i')).not.toBeNull();
});

const dayBtn = (r: ReturnType<typeof render>, n: number) => [...r.container.querySelectorAll('.at-cal-day')][n - 1] as HTMLButtonElement;

it('opening the calendar focuses the shown day, or the first pickable day; closing returns focus to the date button', async () => {
  const r = render(<Panel />);
  await flush();
  // Shown day is today (13th), which has a record in this mock: it takes focus.
  await openCalendar(r);
  expect(document.activeElement).toBe(dayBtn(r, 13));
  // Escape returns focus to the date button.
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(document.activeElement).toBe(r.container.querySelector('.at-date'));
  // Pick with Enter (the browser turns Enter on a focused button into this click).
  await openCalendar(r);
  const day = dayBtn(r, 10);
  day.focus();
  expect(document.activeElement).toBe(day);
  fireEvent.click(day);
  await flush();
  expect(r.container.querySelector('.at-date')!.textContent).toBe('Tuesday, November 10');
  expect(document.activeElement).toBe(r.container.querySelector('.at-date'));
  // Shown day is the 10th now: focus goes there on the next open. An outside click returns focus too.
  await openCalendar(r);
  expect(document.activeElement).toBe(dayBtn(r, 10));
  fireEvent.mouseDown(r.container.querySelector('.at-foot') as HTMLElement);
  expect(document.activeElement).toBe(r.container.querySelector('.at-date'));
});

it('Escape from a focused calendar control closes only the calendar, even with another window Escape listener', async () => {
  const onClose = vi.fn();
  const other = vi.fn();
  window.addEventListener('keydown', other);
  const r = render(<Panel onClose={onClose} />);
  await flush();
  await openCalendar(r);
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
  expect(r.container.querySelector('.at-cal')).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
  expect(other).not.toHaveBeenCalled();
  window.removeEventListener('keydown', other);
});

it('today without a saved record is dim and not pickable, keeps its ring, and the shown day is cyan independently', async () => {
  mocks.set('wall2_omni_days', () => [
    { date: '2026-11-12', sessions: 16 },
    { date: '2026-11-11', sessions: 4 },
    { date: '2026-11-20', sessions: 2 },
  ]);
  const r = render(<Panel />);
  await flush();
  await openCalendar(r);
  const today = dayBtn(r, 13);
  expect(today.classList.contains('has')).toBe(false);
  expect(today.disabled).toBe(true);
  expect(today.classList.contains('today')).toBe(true);
  expect(today.classList.contains('shown')).toBe(true);
  // Focus falls to the first pickable day, since the shown one cannot take it.
  expect(document.activeElement).toBe(dayBtn(r, 11));
  // A day after today is never bright, and does not add a month to walk to.
  expect(dayBtn(r, 20).disabled).toBe(true);
  expect(r.container.querySelectorAll('.at-cal-head .at-arrow:not(:disabled)').length).toBe(0);
  // Pick another day: the ring stays on today, cyan moves.
  fireEvent.click(dayBtn(r, 12));
  await flush();
  await openCalendar(r);
  expect(dayBtn(r, 12).classList.contains('shown')).toBe(true);
  expect(dayBtn(r, 12).classList.contains('today')).toBe(false);
  expect(dayBtn(r, 13).classList.contains('shown')).toBe(false);
  expect(dayBtn(r, 13).classList.contains('today')).toBe(true);
});

it('count bars centre with a transform, not a negative margin', () => {
  const css: string = readFileSync('src/styles/ribbon.css', 'utf8');
  const m = css.match(/\n\.at-cal-day i \{([^}]*)\}/);
  expect(m![1]).toMatch(/transform: translateX\(-50%\);/);
  expect(m![1]).not.toMatch(/margin-left/);
});
