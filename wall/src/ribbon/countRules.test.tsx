import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { lane, summary } from '../agents/fixtures';
import { CentreSlot } from '../agents/CentreSlot';
import { resetAgents } from '../agents/useAgents';
import { mocks } from '../bridge/tauri';
import { useFocusStore } from '../focus/store';
import { HoverTipLayer, resetTip, TIP_DELAY_MS } from '../ui/HoverTip';
import type { WeatherState } from '../weather/useWeather';
import { busyToday, colourKey } from './AgentRow';
import { knownLimit, logSegments } from './busy';
import { resetDays } from './days';
import { Ribbon } from './Ribbon';
import { useFixedClock, usePacificTime } from './testZone';
import { useAgentsStore } from '../agents/useAgents';

usePacificTime();

// Fix round 1 for the busy views: the day edge, no limit, idle cards with open runs, a session
// that closes, past days, and the strip's colour key. A 20 second limit: these step timers.
const at = (day: string, hm: string) => Date.parse(`${day}T${hm}:00-08:00`);
const iso = (day: string, hm: string) => new Date(at(day, hm)).toISOString();
const D = '2026-11-11';
const Y = '2026-11-10';
useFixedClock(at(D, '10:24'));
const weather: WeatherState = { reading: null, failed: false, now: 0 };

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const ids = ['a1b2c3d4-0001', 'a1b2c3d4-0002', 'a1b2c3d4-0003'];
let answer: () => unknown;
let dayReads = 0;
let record: unknown = null;
beforeEach(() => {
  resetAgents();
  resetDays();
  dayReads = 0;
  record = null;
  mocks.set('wall2_meet_day', () => ({ accounts: [], events: [] }));
  mocks.set('wall2_omni_summary', () => answer());
  mocks.set('wall2_omni_days', () => [{ date: D, sessions: 3 }, { date: Y, sessions: 1 }]);
  mocks.set('wall2_omni_day', (a) => {
    if (a?.date === D) dayReads++;
    return a?.date === D ? record : null;
  });
  mocks.set('get_do_not_disturb', () => false);
});
afterEach(() => {
  resetTip();
  resetAgents();
  resetDays();
  mocks.clear();
  useFocusStore.setState({ sessions: [] });
});

const withRun = (id: string, start: string, end: string | null, day = D) => ({ lane: id, start: iso(day, start), end: end === null ? null : iso(day, end), kind: 'run' as const });

it('the limit is known only when it is a positive number', () => {
  for (const bad of [0, -1, Number.NaN, null, undefined]) expect(knownLimit(bad as number)).toBeNull();
  expect(knownLimit(4)).toBe(4);
});

it('a span that began before midnight counts from midnight: the log builds it, not the strip layout', () => {
  const day = [{ lane: ids[0], start: iso(Y, '23:50'), end: null, kind: 'run' as const }];
  const midnight = at(D, '00:00');
  const segs = logSegments(day, midnight, at(D, '00:15'));
  expect(segs).toEqual([{ lane: ids[0], kind: 'run', start: midnight, end: at(D, '00:15'), open: true }]);
  // A finished span that ended before the day began adds nothing.
  expect(logSegments([{ lane: ids[0], start: iso(Y, '22:00'), end: iso(Y, '23:00'), kind: 'run' }], midnight, at(D, '08:00'))).toEqual([]);
});

it('day edge: a session working since 11:50 PM counts at 12:15 AM in the header and the Busy at once line', async () => {
  vi.setSystemTime(at(D, '00:15'));
  // An older helper (no working count), so the header counts from the day log itself.
  answer = () =>
    summary({
      slots: { used: 1, limit: 4 },
      sessionsList: [lane({ id: ids[0], title: 'Overnight build' })],
      lanes: [],
      day: [{ lane: ids[0], start: iso(Y, '23:50'), end: null, kind: 'run' }],
    });
  const r = render(
    <>
      <CentreSlot weather={weather} />
      <Ribbon kind="work" />
    </>,
  );
  await flush();
  expect(r.container.querySelector('.slot-meter .xs')!.textContent).toBe('1 of 4 working');
  const b = busyToday(useAgentsStore.getState(), at(D, '00:15'));
  expect(b!.spans).toEqual([{ id: ids[0], start: at(D, '00:00'), end: at(D, '00:15') }]);
  fireEvent.click(r.container.querySelector('.ag-line') as HTMLElement);
  await flush();
  const steps = [...r.container.querySelectorAll('.at-busy-s')].map((x) => x.textContent);
  expect(steps[0]).toBe('at 115 m');
  r.unmount();
});

it('day edge: the strip draws a run from 11:50 PM to 7 AM in its 6 to 7 AM cells', async () => {
  vi.setSystemTime(at(D, '08:00'));
  answer = () =>
    summary({
      slots: { used: 1, limit: 4, working: 0 },
      sessionsList: [lane({ id: ids[0], title: 'Overnight build', state: 'review', live: 'idle' })],
      lanes: [],
      day: [{ lane: ids[0], start: iso(Y, '23:50'), end: iso(D, '07:00'), kind: 'run' }],
    });
  const r = render(<Ribbon kind="work" />);
  await flush();
  const cells = [...r.container.querySelectorAll('.agent-row .ac i')].map((i) => i.className);
  expect(cells).toEqual(['b1', 'b1', 'b1', 'b1', 'b1']);
  r.unmount();
});

it('an idle card with a run still open does not count: the header equals the server and the pills, the strip and the line agree', async () => {
  answer = () =>
    summary({
      slots: { used: 2, limit: 4, sessions: 2, working: 1 },
      sessionsList: [lane({ id: ids[0], title: 'Working one' }), lane({ id: ids[1], title: 'Idle one', live: 'idle' })],
      lanes: [],
      day: [withRun(ids[0], '09:00', null), withRun(ids[1], '09:00', null)],
    });
  const r = render(
    <>
      <CentreSlot weather={weather} />
      <Ribbon kind="work" />
    </>,
  );
  await flush();
  const b = busyToday(useAgentsStore.getState(), at(D, '10:24'));
  // The count from the log (open runs of working cards) is the server's own count by construction.
  expect(b!.spans.map((s) => s.id)).toEqual([ids[0]]);
  expect(r.container.querySelector('.slot-meter .xs')!.textContent).toBe('1 of 4 working');
  // The strip: one session counted in every cell, never two.
  const cells = [...r.container.querySelectorAll('.agent-row .ac i')].map((i) => i.className);
  expect(cells.length).toBeGreaterThan(0);
  expect(new Set(cells)).toEqual(new Set(['b1']));
  fireEvent.click(r.container.querySelector('.ag-line') as HTMLElement);
  await flush();
  expect([...r.container.querySelectorAll('.at-busy-s')].map((x) => x.textContent)[0]).toBe('at 11 h 24 m');
  expect([...r.container.querySelectorAll('.at-busy-s')].map((x) => x.textContent)[1]).toBe('at 20 m');
  r.unmount();
});

it('when the helper sends its own working count and the log differs, the header shows the server number', async () => {
  answer = () =>
    summary({
      slots: { used: 3, limit: 4, sessions: 3, working: 3 },
      sessionsList: ids.map((id, i) => lane({ id, title: `Session ${i}` })),
      lanes: [],
      day: [withRun(ids[0], '09:00', null)],
    });
  const r = render(<CentreSlot weather={weather} />);
  await flush();
  expect(r.container.querySelector('.slot-meter .xs')!.textContent).toBe('3 of 4 working');
  r.unmount();
});

it('no limit (a zero from an older helper): the honest count alone, no pips, no steps, no limit line, no over tag, plain cells', async () => {
  answer = () =>
    summary({
      slots: { used: 3, limit: 0, sessions: 3, working: 3 },
      sessionsList: ids.map((id, i) => lane({ id, title: `Session ${i}` })),
      lanes: [],
      day: ids.map((id) => withRun(id, '09:00', null)),
    });
  const r = render(
    <>
      <CentreSlot weather={weather} />
      <Ribbon kind="work" />
      <HoverTipLayer />
    </>,
  );
  await flush();
  const meter = r.container.querySelector('.slot-meter') as HTMLElement;
  expect(meter.textContent).toBe('3 working');
  expect(meter.className).toBe('slot-meter nolimit');
  expect(meter.querySelector('.pips')).toBeNull();
  expect(meter.querySelector('.over-tag')).toBeNull();
  expect(meter.getAttribute('aria-label')).toContain('limit unknown');
  const cells = [...r.container.querySelectorAll('.agent-row .ac i')].map((i) => i.className);
  expect(cells.length).toBeGreaterThan(0);
  expect(new Set(cells)).toEqual(new Set(['bn']));
  fireEvent.click(r.container.querySelector('.ag-line') as HTMLElement);
  await flush();
  expect(r.container.querySelector('.at-busy')).toBeNull();
  expect(r.container.querySelector('.at-band')).toBeNull();
  expect(r.container.querySelector('.at-limit')).toBeNull();
  expect(colourKey(null)).not.toContain('over');
  r.unmount();
});

it('a parent that closes is read from the record at once, and a helper id is read once, never on a timer', async () => {
  const gone = 'a1b2c3d4-0099';
  const kid = 'c0ffee00-0001';
  record = { date: D, tz: 'America/Los_Angeles', sessions: [{ id: gone, title: 'Closed today', spans: [{ stage: 'build', start: iso(D, '09:00'), end: iso(D, '10:00') }], pr: null }] };
  answer = () =>
    summary({
      slots: { used: 1, limit: 4, sessions: 1, working: 1 },
      sessionsList: [lane({ id: ids[0], title: 'Open one' })],
      lanes: [],
      day: [withRun(ids[0], '09:00', null), withRun(gone, '09:00', '10:00'), withRun(kid, '09:00', null)],
    });
  const r = render(<Ribbon kind="work" />);
  await flush();
  // Read as soon as the ids first showed: once.
  expect(dayReads).toBe(1);
  // The closed parent now counts (9:00 to 10:00 two at once); the helper never does.
  const cells = [...r.container.querySelectorAll('.agent-row .ac i')].map((i) => i.className);
  expect(cells.slice(0, 5)).toEqual(['b2', 'b2', 'b2', 'b2', 'b2']);
  // Not on a timer for the same ids, all afternoon.
  await flush(3 * 60 * 60_000);
  expect(dayReads).toBe(1);
  // A newly unknown id reads again, once.
  const gone2 = 'a1b2c3d4-0098';
  answer = () =>
    summary({
      slots: { used: 1, limit: 4, sessions: 1, working: 1 },
      sessionsList: [lane({ id: ids[0], title: 'Open one' })],
      lanes: [],
      day: [withRun(ids[0], '09:00', null), withRun(gone, '09:00', '10:00'), withRun(gone2, '10:00', '10:10'), withRun(kid, '09:00', null)],
    });
  await flush(60_000);
  expect(dayReads).toBe(2);
  await flush(60 * 60_000);
  expect(dayReads).toBe(2);
  r.unmount();
});

it('the activity row says what its colours mean, with and without a limit', async () => {
  answer = () =>
    summary({
      slots: { used: 1, limit: 4, sessions: 1, working: 1 },
      sessionsList: [lane({ id: ids[0], title: 'Open one' })],
      lanes: [],
      day: [withRun(ids[0], '09:00', null)],
    });
  const r = render(
    <>
      <Ribbon kind="work" />
      <HoverTipLayer />
    </>,
  );
  await flush();
  fireEvent.mouseEnter(r.container.querySelector('.li-hit') as HTMLElement);
  await flush(TIP_DELAY_MS + 10);
  const text = document.querySelector('.hover-tip')!.textContent!;
  expect(text).toContain('1 mint, 2 cyan, 3 violet, 4 amber, over 4 red, hatched and taller');
  expect(text).toContain('An amber underline means a session waited on you');
  expect(colourKey(null)).toContain('amber underline');
  r.unmount();
});
