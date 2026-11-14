import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { lane, summary } from '../agents/fixtures';
import { CentreSlot } from '../agents/CentreSlot';
import { resetAgents, useAgentsStore } from '../agents/useAgents';
import { mocks } from '../bridge/tauri';
import { useFocusStore } from '../focus/store';
import { HoverTipLayer, resetTip, TIP_DELAY_MS } from '../ui/HoverTip';
import type { WeatherState } from '../weather/useWeather';
import { busyToday } from './AgentRow';
import { busyTime } from './busy';
import { dayStart, isoDay, resetDays, todayRows, type DayRecord } from './days';
import { Ribbon } from './Ribbon';
import { useFixedClock, usePacificTime } from './testZone';
import { clearWorkSeen, resetWorkSeenMemory } from './workSeen';

usePacificTime();

// Fix round 2: past work never vanishes when a card goes idle. An open run of a session whose
// card is not working is kept and ended at the last moment the wall can name; it never counts as
// working now. Every view (the strip's cells, the Busy at once line, the header's Today line,
// the panel's row, the drawer's row) reads the same ended span. A 20 second limit: these step timers.
const D = '2026-11-11';
const at = (hm: string) => Date.parse(`${D}T${hm}:00-08:00`);
const iso = (hm: string) => new Date(at(hm)).toISOString();
useFixedClock(at('11:00'));
const weather: WeatherState = { reading: null, failed: false, now: 0 };

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const A = 'a1b2c3d4-0001';
let answer: () => unknown;
let record: DayRecord | null = null;
beforeEach(() => {
  resetAgents();
  resetDays();
  clearWorkSeen();
  record = null;
  mocks.set('wall2_meet_day', () => ({ accounts: [], events: [] }));
  mocks.set('wall2_omni_summary', () => answer());
  mocks.set('wall2_omni_days', () => [{ date: D, sessions: 1 }]);
  mocks.set('wall2_omni_day', (a) => (a?.date === D ? record : null));
  mocks.set('get_do_not_disturb', () => false);
});
afterEach(() => {
  resetTip();
  resetAgents();
  resetDays();
  clearWorkSeen();
  mocks.clear();
  useFocusStore.setState({ sessions: [] });
});

const openRun = (start = '09:00') => ({ lane: A, start: iso(start), end: null, kind: 'run' as const });
const working = () =>
  summary({
    slots: { used: 1, limit: 1, sessions: 1, working: 1 },
    sessionsList: [lane({ id: A, title: 'Long build' })],
    lanes: [],
    day: [openRun()],
  });
const after = (over: Parameters<typeof lane>[0], slots: { working: number } = { working: 0 }) => () =>
  summary({
    slots: { used: 1, limit: 1, sessions: 1, ...slots },
    sessionsList: [lane({ id: A, title: 'Long build', ...over })],
    lanes: [],
    day: [openRun()],
  });

interface Views {
  cells: string[];
  busy: string[];
  today: string;
  count: string;
  panelRow: string;
  drawerRow: string;
}

/** What every view says right now: the strip, the panel's line and row, the header, the drawer. */
async function readViews(r: ReturnType<typeof render>): Promise<Views> {
  const cells = [...r.container.querySelectorAll('.agent-row .ac i')].map((i) => i.className);
  const meter = r.container.querySelector('.slot-meter') as HTMLElement;
  const count = meter.querySelector('.xs')!.textContent!;
  fireEvent.mouseEnter(meter);
  await flush(TIP_DELAY_MS + 10);
  const today = /Today: [^.]*\./.exec(document.querySelector('.hover-tip')!.textContent!)![0];
  fireEvent.mouseLeave(meter);
  await flush(10);
  fireEvent.click(r.container.querySelector('.ag-line') as HTMLElement);
  await flush();
  const busy = [...r.container.querySelectorAll('.at-busy-s b')].map((b) => b.textContent!);
  const row = r.container.querySelector('.at-row') as HTMLElement;
  fireEvent.mouseEnter(row);
  await flush(TIP_DELAY_MS + 10);
  const panelRow = /worked (?:\d+ h \d+ m|\d+ m)/.exec(document.querySelector('.hover-tip')!.textContent!)![0];
  fireEvent.mouseLeave(row);
  await flush(10);
  fireEvent.keyDown(window, { key: 'Escape' });
  await flush(400);
  fireEvent.click(r.container.querySelector('.rib-handle') as HTMLElement);
  await flush(400);
  const drawerRow = (r.container.querySelector('.day-drawer .dd-row .dd-time') as HTMLElement).textContent!;
  return { cells, busy, today, count, panelRow, drawerRow };
}

const twoHours = (v: Views) => {
  // 9:00 to 11:00 stays in every view; nothing counts as working now.
  expect(v.cells).toHaveLength(10);
  expect(new Set(v.cells)).toEqual(new Set(['b4']));
  expect(v.busy).toEqual(['2 h 00 m', '0 m']);
  expect(v.today).toBe('Today: at 1 for 2 h 00 m.');
  expect(v.count).toBe('0 of 1 working');
  expect(v.panelRow).toBe('worked 2 h 00 m');
  expect(v.drawerRow).toBe('2 h 00 m');
};

async function goesQuiet(next: () => unknown) {
  vi.setSystemTime(at('11:00'));
  answer = working;
  const r = render(
    <>
      <CentreSlot weather={weather} />
      <Ribbon kind="work" />
      <HoverTipLayer />
    </>,
  );
  await flush();
  answer = next;
  await flush(30 * 60_000);
  return r;
}

it('9 to 11, the card then reads idle with the run still open: at 11:30 every view keeps the 9 to 11 and the count is 0', async () => {
  const r = await goesQuiet(after({ live: 'idle' }));
  twoHours(await readViews(r));
  r.unmount();
}, 20_000);

it('9 to 11, the card then reads failed: the same two hours stay, and nothing counts as working now', async () => {
  const r = await goesQuiet(after({ failed: true }));
  twoHours(await readViews(r));
  r.unmount();
}, 20_000);

it('9 to 11, the session then waits on the owner: the same two hours stay', async () => {
  const r = await goesQuiet(after({ waiting: true, state: 'blocked' }));
  const v = await readViews(r);
  expect(v.busy).toEqual(['2 h 00 m', '0 m']);
  expect(v.panelRow).toBe('worked 2 h 00 m');
  expect(v.drawerRow).toBe('2 h 00 m');
  r.unmount();
}, 20_000);

it('a parent that just closed (no card, today\'s record names it) keeps its 9 to 11 in the cells, the sums and the panel row', async () => {
  vi.setSystemTime(at('11:00'));
  answer = working;
  const r = render(<Ribbon kind="work" />);
  await flush();
  record = { date: D, tz: 'America/Los_Angeles', sessions: [{ id: A, title: 'Long build', spans: [{ stage: 'build', start: iso('09:00'), end: iso('11:00') }], pr: null }] };
  answer = () => summary({ slots: { used: 0, limit: 1, sessions: 0, working: 0 }, sessionsList: [], lanes: [], day: [openRun()] });
  await flush(30 * 60_000);
  const st = useAgentsStore.getState();
  const read = (await import('./days')).useDaysStore.getState().records[D];
  const b = busyToday(st, at('11:30'), read?.record ?? null)!;
  expect(busyTime(b.spans) / 60_000).toBe(120);
  expect(b.spans).toEqual([{ id: A, start: at('09:00'), end: at('11:00') }]);
  const cells = [...r.container.querySelectorAll('.agent-row .ac i')].map((i) => i.className);
  expect(cells).toHaveLength(10);
  const rows = todayRows(b.summary, read?.record ?? null, at('11:30'), at('11:30'), st.skewMs, b.ends);
  expect(rows[0].workMs / 60_000).toBe(120);
  r.unmount();
}, 20_000);

it('a reload at 11:30 keeps the 9 to 11: the last time it was seen working comes back from storage', async () => {
  vi.setSystemTime(at('11:00'));
  answer = working;
  const first = render(<Ribbon kind="work" />);
  await flush();
  first.unmount();
  // The page reloads: nothing in memory, the stores start again, storage stays.
  resetAgents();
  resetDays();
  resetWorkSeenMemory();
  vi.setSystemTime(at('11:30'));
  answer = after({ live: 'idle' });
  const r = render(
    <>
      <CentreSlot weather={weather} />
      <Ribbon kind="work" />
      <HoverTipLayer />
    </>,
  );
  await flush();
  twoHours(await readViews(r));
  r.unmount();
}, 20_000);

it('a fresh start with an idle card, an open run and no memory counts no time, not invented time, in every view', async () => {
  vi.setSystemTime(at('11:30'));
  answer = after({ live: 'idle' });
  const r = render(
    <>
      <CentreSlot weather={weather} />
      <Ribbon kind="work" />
      <HoverTipLayer />
    </>,
  );
  await flush();
  const st = useAgentsStore.getState();
  const b = busyToday(st, at('11:30'))!;
  expect(b.spans.every((s) => s.end <= s.start)).toBe(true);
  expect(busyTime(b.spans)).toBe(0);
  expect(r.container.querySelectorAll('.agent-row .ac i')).toHaveLength(0);
  const rows = todayRows(b.summary, null, at('11:30'), at('11:30'), st.skewMs, b.ends);
  expect(rows[0].workMs).toBe(0);
  expect(dayStart(isoDay(at('11:30')))).toBeLessThan(at('09:00'));
  r.unmount();
}, 20_000);

it('with no memory, the latest stamp the day log gives for the run ends it (a wait that began at 9:20)', async () => {
  vi.setSystemTime(at('11:30'));
  answer = () =>
    summary({
      slots: { used: 1, limit: 1, sessions: 1, working: 0 },
      sessionsList: [lane({ id: A, title: 'Long build', live: 'idle' })],
      lanes: [],
      day: [openRun(), { lane: A, start: iso('09:20'), end: iso('09:30'), kind: 'wait' }],
    });
  const r = render(<Ribbon kind="work" />);
  await flush();
  const st = useAgentsStore.getState();
  const b = busyToday(st, at('11:30'))!;
  expect(b.spans).toEqual([{ id: A, start: at('09:00'), end: at('09:30') }]);
  r.unmount();
}, 20_000);

it('the helper\'s own idle time ends the run first: idle for 30 minutes at 11:30 means it stopped at 11:00, with no memory', async () => {
  vi.setSystemTime(at('11:30'));
  answer = after({ live: 'idle', idleS: 1800 });
  const r = render(<Ribbon kind="work" />);
  await flush();
  const b = busyToday(useAgentsStore.getState(), at('11:30'))!;
  expect(b.spans).toEqual([{ id: A, start: at('09:00'), end: at('11:00') }]);
  r.unmount();
}, 20_000);

it('a past day\'s band never shows the over-limit look: plain steps, no red, no hatch, no limit line', async () => {
  const P = '2026-11-10';
  mocks.set('wall2_omni_days', () => [{ date: D, sessions: 1 }, { date: P, sessions: 6 }]);
  const spans = (h: number) => [{ stage: 'build', start: `${P}T${String(h + 8).padStart(2, '0')}:00:00Z`, end: `${P}T${String(h + 9).padStart(2, '0')}:00:00Z` }];
  mocks.set('wall2_omni_day', (a) =>
    a?.date === P
      ? { date: P, tz: 'America/Los_Angeles', sessions: Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, title: `Past ${i}`, spans: spans(1), pr: null })) }
      : null,
  );
  answer = working;
  const r = render(<Ribbon kind="work" />);
  await flush();
  fireEvent.click(r.container.querySelector('.ag-line') as HTMLElement);
  await flush();
  fireEvent.click(r.container.querySelector('.at-seg button:nth-child(2)') as HTMLElement);
  await flush();
  const panel = r.container.querySelector('.agents-today') as HTMLElement;
  expect(panel.className).toContain('past');
  // Six open at once against a limit of 1: counts as bars, but never the red hatched step.
  const bars = [...panel.querySelectorAll('.at-band .at-track i')];
  expect(bars.length).toBeGreaterThan(0);
  for (const b of bars) expect(b.className).not.toMatch(/\bb[45]\b/);
  expect(panel.querySelector('.at-limit')).toBeNull();
  expect(panel.querySelector('.at-busy .sw.b5')).toBeNull();
  r.unmount();
}, 20_000);
