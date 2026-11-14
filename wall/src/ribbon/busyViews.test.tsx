import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { lane, summary } from '../agents/fixtures';
import { CentreSlot } from '../agents/CentreSlot';
import { resetAgents } from '../agents/useAgents';
import { mocks } from '../bridge/tauri';
import { useFocusStore } from '../focus/store';
import { HoverTipLayer, resetTip, TIP_DELAY_MS } from '../ui/HoverTip';
import type { WeatherState } from '../weather/useWeather';
import { resetDays } from './days';
import { Ribbon } from './Ribbon';
import { useFixedClock, usePacificTime } from './testZone';

usePacificTime();

// One count everywhere: the header's meter, the strip's cells and the panel's "Busy at once"
// line and band agree for the same moment. A 20 second limit: these step timers.
const t = (hm: string) => Date.parse(`2026-11-11T${hm}:00-08:00`);
useFixedClock(t('10:24'));
const iso = (hm: string) => new Date(t(hm)).toISOString();
const weather: WeatherState = { reading: null, failed: false, now: 0 };

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const ids = ['a1b2c3d4-0001', 'a1b2c3d4-0002', 'a1b2c3d4-0003', 'a1b2c3d4-0004', 'a1b2c3d4-0005', 'a1b2c3d4-0006'];
let answer: () => unknown;
beforeEach(() => {
  resetAgents();
  resetDays();
  mocks.set('wall2_meet_day', () => ({ accounts: [], events: [] }));
  mocks.set('wall2_omni_summary', () => answer());
  mocks.set('wall2_omni_days', () => [{ date: '2026-11-11', sessions: 6 }, { date: '2026-11-10', sessions: 2 }]);
  mocks.set('wall2_omni_day', (a) =>
    a?.date === '2026-11-10'
      ? {
          date: '2026-11-10',
          tz: 'America/Los_Angeles',
          sessions: [
            { id: 'p1', title: 'Release notes draft', spans: [{ stage: 'build', start: '2026-11-10T17:00:00Z', end: '2026-11-10T19:00:00Z' }], pr: null },
            { id: 'p2', title: 'Docs tidy pass', spans: [{ stage: 'review', start: '2026-11-10T18:00:00Z', end: '2026-11-10T18:30:00Z' }], pr: null },
          ],
        }
      : null,
  );
  mocks.set('get_do_not_disturb', () => false);
});
afterEach(() => {
  resetTip();
  resetAgents();
  resetDays();
  mocks.clear();
  useFocusStore.setState({ sessions: [] });
});

/** Six parents and one helper: from 9:36 three work, from 10:00 five do (one more waits), a helper always. */
function busyDay() {
  return summary({
    slots: { used: 9, limit: 4, sessions: 6, working: 5, helpers: 2 },
    sessionsList: ids.map((id, i) => lane({ id, title: `Session ${i + 1}`, ...(i === 5 ? { waiting: true, state: 'blocked' as const } : {}) })),
    lanes: [],
    day: [
      ...ids.slice(0, 3).map((lane) => ({ lane, start: iso('09:36'), end: null, kind: 'run' as const })),
      ...ids.slice(3, 5).map((lane) => ({ lane, start: iso('10:00'), end: null, kind: 'run' as const })),
      { lane: ids[5], start: iso('09:36'), end: null, kind: 'wait' as const },
      // A child of the first session: never an extra session.
      { lane: 'c0ffee00-0001', start: iso('09:36'), end: null, kind: 'run' as const },
    ],
  });
}

it('the header, a cell and the Busy at once line agree: five working at once, one over the limit of 4', async () => {
  answer = busyDay;
  const r = render(
    <>
      <CentreSlot weather={weather} />
      <Ribbon kind="work" />
      <HoverTipLayer />
    </>,
  );
  await flush();
  const meter = r.container.querySelector('.slot-meter') as HTMLElement;
  expect(meter.querySelector('.xs')!.textContent).toBe('5 of 4 working');
  // Over the limit is never colour alone: the red step, all pips lit, and a tag.
  expect(meter.className).toBe('slot-meter s5');
  expect(meter.querySelectorAll('.pips i.on')).toHaveLength(4);
  expect(meter.querySelector('.over-tag')!.textContent).toBe('1 over');
  expect(meter.getAttribute('aria-label')).toBe(
    '5 working, 6 open, limit 4. Today: over 4 for 24 m. Sessions working at once; helpers count with their session. Click to bring OmniGent forward.',
  );
  // The strip: 9:36 to 10:00 three at once (violet), 10:00 on five (red, hatched, taller); waits underlined.
  const cells = [...r.container.querySelectorAll('.agent-row .ac i')].map((i) => i.className);
  expect(cells).toEqual(['b3 wait', 'b3 wait', 'b5 wait', 'b5 wait']);
  // The panel: the same steps, adding up to the time anyone worked (48 minutes).
  fireEvent.click(r.container.querySelector('.ag-line') as HTMLElement);
  await flush();
  const line = r.container.querySelector('.at-busy') as HTMLElement;
  const steps = [...line.querySelectorAll('.at-busy-s')].map((x) => x.textContent);
  expect(steps).toEqual(['at 10 m', 'at 20 m', 'at 324 m', 'at 40 m', 'over 424 m']);
  expect(line.querySelector('.at-busy-sum')!.textContent).toBe('Over your limit of 4 for 24 m today');
  const band = [...r.container.querySelectorAll('.at-band .at-track i:not(.at-limit)')].map((i) => [i.className, (i as HTMLElement).style.height]);
  expect(band).toEqual([
    ['b3', '16px'],
    ['b5', '28px'],
  ]);
  // The meter's hover says the same and the rule.
  fireEvent.mouseEnter(meter);
  await flush(TIP_DELAY_MS + 10);
  const tipText = document.querySelector('.hover-tip')!.textContent;
  expect(tipText).toContain('5 working, 6 open, limit 4');
  expect(tipText).toContain('Today: over 4 for 24 m.');
  expect(tipText).toContain('helpers count with their session');
}, 20_000);

it('at the limit the meter says so in amber; a past day counts its recorded spans and has no quiet line', async () => {
  answer = () => {
    const s = busyDay();
    return { ...s, day: s.day.filter((d) => d.lane !== ids[4] && d.lane !== ids[3]).concat([{ lane: ids[3], start: iso('10:00'), end: null, kind: 'run' }]) };
  };
  const r = render(
    <>
      <CentreSlot weather={weather} />
      <Ribbon kind="work" />
    </>,
  );
  await flush();
  const meter = r.container.querySelector('.slot-meter') as HTMLElement;
  expect(meter.className).toBe('slot-meter s4');
  expect(meter.textContent).toBe('4 of 4 workingat the limit');
  expect(meter.querySelector('.over-tag')).toBeNull();
  expect([...r.container.querySelectorAll('.agent-row .ac i')].map((i) => i.className)).toEqual(['b3 wait', 'b3 wait', 'b4 wait', 'b4 wait']);
  fireEvent.click(r.container.querySelector('.ag-line') as HTMLElement);
  await flush();
  fireEvent.click(r.container.querySelector('.at-seg button:nth-child(2)') as HTMLElement);
  await flush();
  const panel = r.container.querySelector('.agents-today') as HTMLElement;
  expect(panel.className).toContain('past');
  // 9:00 to 10:00 and 10:30 to 11:00 one, 10:00 to 10:30 two: from the record's stage spans, labelled.
  expect([...panel.querySelectorAll('.at-busy-s')].map((x) => x.textContent)).toEqual(['at 11 h 30 m', 'at 230 m', 'at 30 m', 'at 40 m', 'over 40 m']);
  expect(panel.querySelector('.at-busy-sum')!.textContent).toBe('Never over your limit of 4 that day (recorded spans)');
  expect(panel.querySelector('.dd-line, .at-line')).toBeNull();
  expect([...panel.querySelectorAll('.at-row .at-name')].map((x) => x.textContent)).toEqual(['Release notes draft', 'Docs tidy pass']);
}, 20_000);

it('a helper or side chat gets no row, no count and no click target: the drawer lists the six parents only', async () => {
  answer = busyDay;
  const r = render(<Ribbon kind="work" />);
  await flush();
  fireEvent.click(r.container.querySelector('.rib-handle') as HTMLElement);
  await flush();
  const rows = [...r.container.querySelectorAll('.day-drawer .dd-row')];
  expect(rows).toHaveLength(6);
  expect(rows.map((x) => x.querySelector('.dd-name')!.textContent).sort()).toEqual(ids.map((_, i) => `Session ${i + 1}`));
  // No control anywhere in the drawer or the strip names the helper's id.
  expect(r.container.innerHTML).not.toContain('c0ffee00-0001');
}, 20_000);
