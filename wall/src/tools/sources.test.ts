import { act } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { ALARM_MAX_AGE_MS } from '../home/useSecurity';
import { REFRESH_MS as WEATHER_REFRESH_MS } from '../weather/model';
import { registerRetry, reportRead, resetReports, useReportStore } from './reports';
import { RETRY_CEILING_MS, buildSources, readText, readUnmountedSources, resetRetries, retrySource, type SourceSnapshot } from './sources';
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

beforeEach(() => {
  resetReports();
  resetRetries();
});
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

it('calendar hover lists each account and its diagnosed reason', () => {
  const calendar = { asOf: NOW - min(2), failed: false, feedStale: true, noCalendar: false, reads: 2, accounts: [
    { id: 'work', label: 'Work', state: 'ok' as const },
    { id: 'hc', label: 'Second', state: 'unavailable' as const, reason: 'token-network-dns' },
  ] };
  expect(row(base({ calendar }), 'calendar').reason).toBe("Work: Reading normally. Second: Could not reach Microsoft's sign-in server: name lookup failed");
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

it('weather keeps all four failed tries visible beside the older reading', () => {
  for (const [failure, words] of [['network','could not reach'],['timeout','did not answer'],['parse','could not be read'],['http 503','answered 503']] as const) {
    const weather = { reading: { fetchedAt: NOW - min(5) } as never, failed: true, failure, attemptedAt: NOW - min(2) };
    const got=row(base({weather}),'weather');
    expect(got.tone).toBe('warn'); expect(got.reason.toLowerCase()).toContain(words); expect(got.reason).toContain('Showing the reading from');
  }
});

it('a failed try an hour or more old says "h ago", the same word as Home', () => {
  const at = (age: number) => row(base({ weather: { reading: { fetchedAt: NOW - min(5) } as never, failed: true, failure: 'network', attemptedAt: NOW - age } }), 'weather').reason;
  expect(at(min(60))).toContain('Last try failed 1 h ago');
  expect(at(min(190))).toContain('Last try failed 3 h ago');
});

it('weather names the second source while Open-Meteo is refusing, and the planned next try with no reading', () => {
  const retry = new Date(2026, 10, 14, 15, 15).getTime();
  const nws = { reading: { fetchedAt: NOW - min(5), source: 'nws' } as never, failed: false, nextTryAt: retry };
  const got = row(base({ weather: nws }), 'weather');
  expect(got.tone).toBe('ok');
  expect(got.reason).toContain('National Weather Service');
  expect(got.reason).toContain('3:15 PM');
  const refused = row(base({ weather: { reading: null, failed: true, failure: 'http 429', nextTryAt: retry, attemptedAt: NOW } }), 'weather');
  expect(refused.tone).toBe('down');
  expect(refused.reason).toBe('Open-Meteo is refusing this address for now (too many requests). Next try at 3:15 PM.');
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
  mocks.set('wall2_tasks_next', () => Promise.reject(new Error('not-configured')));
  await act(async () => {
    await retrySource('sound');
    await retrySource('tasks');
  });
  expect(useReportStore.getState().sound?.last).toBe('failed');
  expect(useReportStore.getState().tasks?.last).toBe('unconfigured');
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
  expect(machines).not.toHaveBeenCalled();
  expect(sonos).not.toHaveBeenCalled();
  off();
});

it('one Retry at a time per source: calls while one runs share it and make one native read', async () => {
  vi.useFakeTimers();
  let release: (v: unknown) => void = () => undefined;
  const command = vi.fn(() => new Promise((r) => (release = r)));
  mocks.set('wall2_sonos_summary', command);
  const first = retrySource('sound');
  vi.advanceTimersByTime(500);
  const second = retrySource('sound');
  vi.advanceTimersByTime(1000);
  const third = retrySource('sound');
  expect(second).toBe(first);
  expect(third).toBe(first);
  expect(command).toHaveBeenCalledTimes(1);
  release({});
  await act(async () => {
    await first;
  });
  expect(useReportStore.getState().sound?.last).toBe('ok');
  // Settled: the next Retry reads again.
  retrySource('sound');
  expect(command).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});

it('a read that never finishes releases the Retry after the ceiling, with a note', async () => {
  vi.useFakeTimers();
  mocks.set('wall2_tasks_next', () => new Promise(() => undefined));
  const p = retrySource('tasks');
  await vi.advanceTimersByTimeAsync(RETRY_CEILING_MS + 10);
  await expect(p).resolves.toEqual({ note: 'The read did not finish' });
  vi.useRealTimers();
});

it('every mounted list of a hook-held source is read once by one Retry', async () => {
  const a = vi.fn();
  const b = vi.fn();
  const offA = registerRetry('tasks', a);
  const offB = registerRetry('tasks', b);
  await retrySource('tasks');
  expect(a).toHaveBeenCalledTimes(1);
  expect(b).toHaveBeenCalledTimes(1);
  offA();
  resetRetries();
  await retrySource('tasks');
  expect(a).toHaveBeenCalledTimes(1);
  expect(b).toHaveBeenCalledTimes(2);
  offB();
});

it('box: a fresh helper summary with the box numbers is a fresh read, though the machine readout is not open', () => {
  const summary = { stale: false, system: { cpuPct: 1, ramPct: 1, gpuPct: null, tempC: 50 } } as unknown as AgentsState['summary'];
  const r = row(base({ agents: agents({ summary, okAt: NOW, freshAt: NOW }), reports: { box: { okAt: NOW - min(36), last: 'ok' } } }), 'box');
  expect(r).toMatchObject({ tone: 'ok', at: NOW });
  // Without the numbers in the summary, the old read is the old read.
  const old = row(base({ agents: agents({ status: 'loading', summary: null, okAt: null, freshAt: null }), reports: { box: { okAt: NOW - min(36), last: 'ok' } } }), 'box');
  expect(old).toMatchObject({ tone: 'warn', at: NOW - min(36) });
});

it('box: agents not set up shows Box not set up, the same tone and words as the Agents row', () => {
  const s = base({ agents: agents({ status: 'unconfigured', summary: null, okAt: null, freshAt: null }) });
  expect(row(s, 'box')).toMatchObject({ tone: 'down', at: null, reason: row(s, 'agents').reason });
});

it('box: a ready helper with no machine numbers is a warn row with a plain reason', () => {
  const r = row(base({ reports: { box: { okAt: NOW - min(36), last: 'ok' } } }), 'box');
  expect(r).toMatchObject({ tone: 'warn', reason: 'The box sent no machine numbers.' });
});

it('box: a good summary gone stale or awaiting shows warn with the last good time, not not-read-yet', () => {
  const summary = { stale: false, system: { cpuPct: 1, ramPct: 1, gpuPct: null, tempC: 50 } } as unknown as AgentsState['summary'];
  for (const over of [{ awaiting: true }, { readFailed: true }]) {
    const r = row(base({ agents: agents({ summary, okAt: NOW - min(5), freshAt: NOW - min(5), ...over }), reports: { box: undefined } }), 'box');
    expect(r).toMatchObject({ tone: 'warn', at: NOW - min(5) });
    expect(r.reason).not.toMatch(/not been read yet/);
  }
  // A newer report wins.
  const newer = row(base({ agents: agents({ summary, okAt: NOW - min(5), awaiting: true }), reports: { box: { okAt: NOW - min(1), last: 'ok' } } }), 'box');
  expect(newer).toMatchObject({ tone: 'ok', at: NOW - min(1) });
});

it('agents: after the helper stops answering, the row shows the time of the last good read, not never', () => {
  const r = row(base({ agents: agents({ status: 'unreachable', summary: null, readFailed: true, freshAt: null, okAt: NOW - min(31) }) }), 'agents');
  expect(r).toMatchObject({ tone: 'down', at: NOW - min(31) });
});
