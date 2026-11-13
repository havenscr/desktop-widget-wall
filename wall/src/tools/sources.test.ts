import { act } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { ALARM_MAX_AGE_MS } from '../home/useSecurity';
import { REFRESH_MS as WEATHER_REFRESH_MS } from '../weather/model';
import { registerRetry, reportRead, resetReports, useReportStore } from './reports';
import { buildSources, readText, readUnmountedSources, retrySource, type SourceSnapshot } from './sources';
import type { AgentsState } from '../agents/useAgents';

const NOW = Date.parse('2026-11-12T17:00:00Z');
const min = (n: number) => n * 60_000;

const agents = (over: Partial<AgentsState> = {}): AgentsState => ({
  status: 'ready',
  summary: { stale: false } as AgentsState['summary'],
  readFailed: false,
  freshAt: NOW - min(1),
  okAt: NOW - min(1),
  checkedAt: NOW,
  awaiting: false,
  helperNow: NOW,
  helperMovedAt: NOW,
  skewMs: 0,
  ...over,
});

const base = (over: Partial<SourceSnapshot> = {}): SourceSnapshot => ({
  now: NOW,
  calendar: { asOf: NOW - min(2), failed: false, feedStale: false, noCalendar: false, reads: 3 },
  agents: agents(),
  security: { status: 'ready', summary: { reachable: true, stale: false } as never, readAt: NOW - min(2) },
  weather: { reading: { fetchedAt: NOW - min(5) } as never, failed: false },
  music: { at: NOW - 1000 },
  reports: {
    tasks: { okAt: NOW - min(1), last: 'ok' },
    sound: { okAt: NOW - min(1), last: 'ok' },
    box: { okAt: NOW - 1000, last: 'ok' },
  },
  ...over,
});

const row = (s: SourceSnapshot, id: string) => buildSources(s).find((r) => r.id === id)!;

beforeEach(() => resetReports());
afterEach(() => {
  mocks.clear();
  vi.restoreAllMocks();
});

it('lists the eight sources in order, every one fresh when every store is', () => {
  const rows = buildSources(base());
  expect(rows.map((r) => r.name)).toEqual(['Calendar', 'Tasks', 'Agents', 'Home', 'Sound', 'Music', 'Weather', 'Box']);
  expect(rows.every((r) => r.tone === 'ok')).toBe(true);
});

it('calendar: no account readable is down, a failed read with an earlier list is stale, never read is grey', () => {
  const cal = (c: Partial<SourceSnapshot['calendar']>) => ({ asOf: NOW - min(2), failed: false, feedStale: false, noCalendar: false, reads: 1, ...c });
  expect(row(base({ calendar: cal({ noCalendar: true }) }), 'calendar').tone).toBe('down');
  expect(row(base({ calendar: cal({ failed: true, asOf: null }) }), 'calendar').tone).toBe('down');
  expect(row(base({ calendar: cal({ failed: true }) }), 'calendar').tone).toBe('warn');
  expect(row(base({ calendar: cal({ feedStale: true }) }), 'calendar').tone).toBe('warn');
  const none = row(base({ calendar: cal({ asOf: null, reads: 0 }) }), 'calendar');
  expect(none.tone).toBe('none');
  expect(readText(none.at)).toBe('never');
});

it('agents follow their own stale rule: a stale answer, a failed read or a coming-back page is amber, an unreachable helper red', () => {
  expect(row(base({ agents: agents({ summary: { stale: true } as never }) }), 'agents').tone).toBe('warn');
  expect(row(base({ agents: agents({ readFailed: true }) }), 'agents').tone).toBe('warn');
  expect(row(base({ agents: agents({ awaiting: true }) }), 'agents').tone).toBe('warn');
  expect(row(base({ agents: agents({ status: 'unreachable', summary: null }) }), 'agents').tone).toBe('down');
  const off = row(base({ agents: agents({ status: 'unconfigured', summary: null }) }), 'agents');
  expect(off.tone).toBe('down');
  expect(off.reason).toContain('not set up');
  // A stale answer's last good read is the last one the helper did not mark stale.
  expect(row(base({ agents: agents({ summary: { stale: true } as never, freshAt: NOW - min(9) }) }), 'agents').at).toBe(NOW - min(9));
});

it('home: unreachable firewall data or an old scan is amber, an error with no earlier read is red, a read past the alarm age is amber', () => {
  const sec = (over: object) => ({ status: 'ready' as const, summary: { reachable: true, stale: false } as never, readAt: NOW - min(2), ...over });
  expect(row(base({ security: sec({ summary: { reachable: false, stale: false } }) }), 'home').tone).toBe('warn');
  expect(row(base({ security: sec({ summary: { reachable: true, stale: true } }) }), 'home').tone).toBe('warn');
  expect(row(base({ security: sec({ status: 'error', readAt: null }) }), 'home').tone).toBe('down');
  expect(row(base({ security: sec({ status: 'error' }) }), 'home').tone).toBe('warn');
  expect(row(base({ security: sec({ readAt: NOW - ALARM_MAX_AGE_MS - 1 }) }), 'home').tone).toBe('warn');
  expect(row(base({ security: sec({ status: 'unconfigured', summary: null, readAt: null }) }), 'home').tone).toBe('down');
});

it('weather is amber exactly when the card would say it is old', () => {
  const w = (age: number) => base({ weather: { reading: { fetchedAt: NOW - age } as never, failed: false } });
  expect(row(w(WEATHER_REFRESH_MS), 'weather').tone).toBe('ok');
  expect(row(w(WEATHER_REFRESH_MS + min(2)), 'weather').tone).toBe('warn');
  expect(row(base({ weather: { reading: null, failed: true } }), 'weather').tone).toBe('down');
  expect(row(base({ weather: { reading: null, failed: false } }), 'weather').tone).toBe('none');
});

it('music is amber when the 2 second poll has gone quiet, grey before the first answer', () => {
  expect(row(base({ music: { at: 0 } }), 'music').tone).toBe('none');
  expect(row(base({ music: { at: NOW - 60_000 } }), 'music').tone).toBe('warn');
});

it('tasks, sound and box: a failed read keeps the last good time, never a stale read called fresh', () => {
  const t = (last: 'ok' | 'stale' | 'failed' | 'unconfigured', okAt: number | null, reason?: string) => base({ reports: { tasks: { okAt, last, reason } } });
  expect(row(t('failed', NOW - min(4)), 'tasks')).toMatchObject({ tone: 'warn', at: NOW - min(4) });
  expect(row(t('failed', null), 'tasks')).toMatchObject({ tone: 'down', at: null });
  expect(row(t('unconfigured', null, 'Not set up'), 'tasks').tone).toBe('down');
  expect(row(t('stale', NOW - min(1), 'The box reading is out of date'), 'tasks').tone).toBe('warn');
  // Old by the source's own limit: an ok read over three poll intervals ago is amber.
  expect(row(t('ok', NOW - min(7)), 'tasks').tone).toBe('warn');
  expect(row(base({ reports: {} }), 'sound').tone).toBe('none');
  // Sound goes stale after the sound model's two minutes.
  expect(row(base({ reports: { sound: { okAt: NOW - min(3), last: 'ok' } } }), 'sound').tone).toBe('warn');
});

it('reportRead keeps the last good time through a failed read', () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  reportRead('tasks', 'ok');
  vi.setSystemTime(NOW + min(5));
  reportRead('tasks', 'failed', 'The task app did not answer');
  expect(useReportStore.getState().tasks).toEqual({ okAt: NOW, last: 'failed', reason: 'The task app did not answer' });
  vi.useRealTimers();
});

it('Retry uses a mounted hook\'s own refresh, else reads the same command once', async () => {
  const mounted = vi.fn();
  const off = registerRetry('tasks', mounted);
  await retrySource('tasks');
  expect(mounted).toHaveBeenCalledTimes(1);
  off();
  const command = vi.fn(() => []);
  mocks.set('wall2_tasks_next', command);
  await act(async () => {
    await retrySource('tasks');
  });
  expect(command).toHaveBeenCalledTimes(1);
  expect(useReportStore.getState().tasks?.last).toBe('ok');
});

it('a probe that fails says so, and not set up is its own outcome', async () => {
  mocks.set('wall2_sonos_summary', () => Promise.reject(new Error('failed')));
  mocks.set('wall2_machines', () => Promise.reject(new Error('not-configured')));
  await act(async () => {
    await retrySource('sound');
    await retrySource('box');
  });
  expect(useReportStore.getState().sound?.last).toBe('failed');
  expect(useReportStore.getState().box?.last).toBe('unconfigured');
});

it('opening the drawer reads only the hook-held sources nobody has mounted', async () => {
  const tasks = vi.fn(() => []);
  const sonos = vi.fn(() => ({}));
  const machines = vi.fn(() => ({ pc: {}, box: {}, boxStale: false }));
  mocks.set('wall2_tasks_next', tasks);
  mocks.set('wall2_sonos_summary', sonos);
  mocks.set('wall2_machines', machines);
  const off = registerRetry('sound', () => undefined);
  await act(async () => {
    readUnmountedSources();
    await Promise.resolve();
  });
  expect(tasks).toHaveBeenCalledTimes(1);
  expect(machines).toHaveBeenCalledTimes(1);
  expect(sonos).not.toHaveBeenCalled();
  off();
});
