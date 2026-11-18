// @ts-ignore node's own file calls; one test reads the style sheet as text.
import { readFileSync } from 'node:fs';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { lane, summary } from '../agents/fixtures';
import { resetAgents, useAgents } from '../agents/useAgents';
import { mocks } from '../bridge/tauri';
import { resetTip } from '../ui/HoverTip';
import { AgentsToday } from './AgentsToday';
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
function Panel() {
  useAgents();
  return <AgentsToday now={NOW} onClose={() => undefined} />;
}

/** A recorded day with `n` sessions. */
const record = (date: string, n: number) => ({
  date,
  tz: 'America/Los_Angeles',
  sessions: Array.from({ length: n }, (_, i) => ({ id: `a1b2c3d4-${date}-${i}`, title: `Session ${i + 1}`, spans: [{ stage: 'build', start: iso(date, '08:00'), end: iso(date, '09:00') }], pr: null })),
});

beforeEach(() => {
  mocks.set('wall2_omni_summary', () => summary({ sessionsList: [lane()], day: [{ lane: 'a1b2c3d4-0001', start: iso('2026-11-13', '08:00'), end: null, kind: 'run' }] }));
  mocks.set('wall2_omni_days', () => [
    { date: '2026-11-13', sessions: 1 },
    { date: '2026-11-12', sessions: 16 },
    { date: '2026-11-11', sessions: 4 },
  ]);
  mocks.set('wall2_omni_day', (a) => (a?.date === '2026-11-12' ? record('2026-11-12', 16) : a?.date === '2026-11-11' ? record('2026-11-11', 4) : null));
});
afterEach(() => {
  resetTip();
  resetAgents();
  resetDays();
  mocks.clear();
});

const css: string = readFileSync('src/styles/ribbon.css', 'utf8');
/** The declarations of the first rule whose selector is exactly `sel`. */
const rule = (sel: string): string => {
  const m = css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`));
  return m ? m[1] : '';
};

/** The header's controls as a layout-free signature: tag, class and label, in order. */
const header = (c: HTMLElement) => [...c.querySelectorAll('.at-head > *, .at-pick > *, .at-seg > *')].map((e) => `${e.tagName}.${e.className.replace(/^on$| on$/, "")}|${e.getAttribute('aria-label') ?? ''}|${e.tagName === 'BUTTON' ? e.textContent : ''}`);

it('the header controls are the same elements on a 16 row day, a 4 row day and today (only the date text changes)', async () => {
  const r = render(<Panel />);
  await flush();
  const todaySig = header(r.container);
  fireEvent.click([...r.container.querySelectorAll('.at-seg button')][1] as HTMLElement);
  await flush();
  expect(r.container.querySelectorAll('.at-row')).toHaveLength(16);
  const sixteen = header(r.container);
  fireEvent.click([...r.container.querySelectorAll('.at-arrow')][0] as HTMLElement);
  await flush();
  expect(r.container.querySelectorAll('.at-row')).toHaveLength(4);
  expect(header(r.container)).toEqual(sixteen);
  fireEvent.click([...r.container.querySelectorAll('.at-arrow')][1] as HTMLElement);
  fireEvent.click([...r.container.querySelectorAll('.at-seg button')][0] as HTMLElement);
  await flush();
  expect(header(r.container)).toEqual(todaySig);
});

it('the header controls have fixed widths in the style sheet, so no day moves them', () => {
  expect(rule('.at-seg button')).toMatch(/flex: none;/);
  expect(rule('.at-seg button')).toMatch(/width: 104px;/);
  expect(rule('.at-date')).toMatch(/width: 200px;/);
  expect(rule('.at-date')).toMatch(/flex: none;/);
  expect(rule('.at-pick')).toMatch(/flex: none;/);
  expect(rule('.at-k')).toMatch(/flex: none;/);
});

it('the popover has one fixed height, not a content height, so a 4 row day does not move its top', () => {
  const box = rule('.agents-today');
  expect(box).toMatch(/\n  height: 420px;/);
  expect(box).not.toMatch(/max-height/);
  expect(rule('.at-rows')).toMatch(/overflow-y: auto;/);
});

it('the rows reserve the scrollbar gutter and use the wall thin scrollbar', () => {
  const rows = rule('.at-rows');
  expect(rows).toMatch(/scrollbar-gutter: stable;/);
  expect(rows).toMatch(/scrollbar-width: thin;/);
  expect(rows).toContain('scrollbar-color: rgba(154, 123, 255, 0.75) rgba(255, 255, 255, 0.05);');
});
