import { useEffect, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { agentsStale, retryAgents, useAgentsStore, type AgentsState } from '../agents/useAgents';
import { ALARM_MAX_AGE_MS, refreshSecurity, useSecurityFeed, type SecurityState } from '../home/useSecurity';
import { clockText } from '../meet/model';
import { POLL_MS as MUSIC_POLL_MS, refreshNowPlaying, useNowPlayingStore } from '../music/store';
import { REFRESH_MS as TASKS_REFRESH_MS } from '../tasks/model';
import { STALE_MS as SOUND_STALE_MS } from '../home/soundModel';
import { REFRESH_MS as WEATHER_REFRESH_MS, staleText } from '../weather/model';
import { refreshWeather, useWeatherStore, type WeatherState } from '../weather/useWeather';
import { refreshMeetingFeed, useMeetingFeed } from '../work/useNextMeeting';
import { reviewNow } from '../ui/reviewClock';
import { reportRead, retryFor, useReportStore, type ReportId, type Report } from './reports';

export type SourceId = 'calendar' | 'tasks' | 'agents' | 'home' | 'sound' | 'music' | 'weather' | 'box';
/** mint fresh, amber stale or failing, red down or not set up, grey nothing read yet. */
export type Tone = 'ok' | 'warn' | 'down' | 'none';

export interface SourceRow {
  id: SourceId;
  name: string;
  tone: Tone;
  /** Time of the last good read, or null (shown as "never"). */
  at: number | null;
  /** The store's own words, for the hover. */
  reason: string;
}

export const SOURCE_NAMES: readonly { id: SourceId; name: string }[] = [
  { id: 'calendar', name: 'Calendar' },
  { id: 'tasks', name: 'Tasks' },
  { id: 'agents', name: 'Agents' },
  { id: 'home', name: 'Home' },
  { id: 'sound', name: 'Sound' },
  { id: 'music', name: 'Music' },
  { id: 'weather', name: 'Weather' },
  { id: 'box', name: 'Box' },
];

/** Everything the registry reads, as plain values. */
export interface SourceSnapshot {
  now: number;
  calendar: { asOf: number | null; failed: boolean; feedStale: boolean; noCalendar: boolean; reads: number };
  agents: AgentsState;
  security: Pick<SecurityState, 'status' | 'summary' | 'readAt'>;
  weather: Pick<WeatherState, 'reading' | 'failed'>;
  music: { at: number };
  reports: Partial<Record<ReportId, Report>>;
}

const ago = (at: number, now: number): string => {
  const mins = Math.max(0, Math.round((now - at) / 60_000));
  if (mins < 1) return 'less than a minute ago';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return h === 1 ? '1 hour ago' : `${h} hours ago`;
};

/** A source read through `reportRead`: tasks, sound, box. `staleMs` is the age past which its last good read is old. */
function fromReport(id: ReportId, name: string, r: Report | undefined, now: number, staleMs: number, label: string): SourceRow {
  const base = { id, name } as { id: SourceId; name: string };
  if (!r) return { ...base, tone: 'none', at: null, reason: `${label} has not been read yet.` };
  if (r.last === 'unconfigured') return { ...base, tone: 'down', at: r.okAt, reason: r.reason ?? 'Not set up' };
  if (r.last === 'failed') {
    return r.okAt === null
      ? { ...base, tone: 'down', at: null, reason: r.reason ?? `${label} did not answer.` }
      : { ...base, tone: 'warn', at: r.okAt, reason: `${r.reason ?? `${label} did not answer.`} Showing the read from ${ago(r.okAt, now)}.` };
  }
  if (r.last === 'stale') return { ...base, tone: 'warn', at: r.okAt, reason: r.reason ?? `${label} may be out of date.` };
  if (r.okAt !== null && now - r.okAt > staleMs) return { ...base, tone: 'warn', at: r.okAt, reason: `Not read for ${ago(r.okAt, now).replace(' ago', '')}. It reads while its screen is open.` };
  return { ...base, tone: 'ok', at: r.okAt, reason: 'Reading normally.' };
}

/** One row per source from the stores' own state, using each store's own stale rule. Never calls a stale source fresh. */
export function buildSources(s: SourceSnapshot): SourceRow[] {
  const { now } = s;
  const rows: SourceRow[] = [];

  // Calendar: the shared meeting feed.
  {
    const c = s.calendar;
    const id = 'calendar' as const;
    const name = 'Calendar';
    if (c.noCalendar) rows.push({ id, name, tone: 'down', at: c.asOf, reason: 'No calendar account can be read. Sign in under Accounts.' });
    else if (c.failed && c.asOf === null) rows.push({ id, name, tone: 'down', at: null, reason: 'The calendar read failed and there is no earlier read.' });
    else if (c.failed) rows.push({ id, name, tone: 'warn', at: c.asOf, reason: 'The last calendar read failed. Showing the earlier list.' });
    else if (c.feedStale) rows.push({ id, name, tone: 'warn', at: c.asOf, reason: 'An account did not answer. Some meetings are from an earlier read.' });
    else if (c.asOf === null) rows.push({ id, name, tone: 'none', at: null, reason: 'Not read yet, or the calendar is not set up.' });
    else rows.push({ id, name, tone: 'ok', at: c.asOf, reason: 'Reading normally.' });
  }

  rows.push(fromReport('tasks', 'Tasks', s.reports.tasks, now, 3 * TASKS_REFRESH_MS, 'The task app'));

  // Agents: the shared helper summary and its own stale rule.
  {
    const a = s.agents;
    const id = 'agents' as const;
    const name = 'Agents';
    if (a.status === 'unconfigured') rows.push({ id, name, tone: 'down', at: null, reason: 'The agents helper is not set up in feeds.json.' });
    else if (a.status === 'unreachable') rows.push({ id, name, tone: 'down', at: a.freshAt ?? a.okAt, reason: 'The agents helper is not answering.' });
    else if (a.status === 'loading') rows.push({ id, name, tone: 'none', at: null, reason: 'Not read yet.' });
    else if (agentsStale(a)) rows.push({ id, name, tone: 'warn', at: a.freshAt ?? a.okAt, reason: a.readFailed ? 'The last read failed. Showing the earlier answer.' : 'The helper says its numbers may be out of date.' });
    else rows.push({ id, name, tone: 'ok', at: a.okAt, reason: 'Reading normally.' });
  }

  // Home: the shared security read (the home app).
  {
    const h = s.security;
    const id = 'home' as const;
    const name = 'Home';
    const sum = h.summary;
    if (h.status === 'unconfigured') rows.push({ id, name, tone: 'down', at: null, reason: 'The home app is not set up in feeds.json.' });
    else if (h.status === 'loading') rows.push({ id, name, tone: 'none', at: null, reason: 'Not read yet.' });
    else if (h.status === 'error') rows.push(h.readAt === null ? { id, name, tone: 'down', at: null, reason: 'The home app did not answer.' } : { id, name, tone: 'warn', at: h.readAt, reason: 'The last read failed. Showing the earlier answer.' });
    else if (sum && !sum.reachable) rows.push({ id, name, tone: 'warn', at: h.readAt, reason: 'The home app cannot reach the firewall data.' });
    else if (sum?.stale) rows.push({ id, name, tone: 'warn', at: h.readAt, reason: 'The home app says its scan is out of date.' });
    else if (h.readAt !== null && now - h.readAt > ALARM_MAX_AGE_MS) rows.push({ id, name, tone: 'warn', at: h.readAt, reason: `Not read for ${ago(h.readAt, now).replace(' ago', '')}.` });
    else rows.push({ id, name, tone: 'ok', at: h.readAt, reason: 'Reading normally.' });
  }

  rows.push(fromReport('sound', 'Sound', s.reports.sound, now, SOUND_STALE_MS, 'The sound service'));

  // Music: the shared now-playing poll. It answers every 2 seconds, so a quiet gap is a fault.
  {
    const id = 'music' as const;
    const name = 'Music';
    const at = s.music.at;
    if (at === 0) rows.push({ id, name, tone: 'none', at: null, reason: 'The music player has not answered yet.' });
    else if (now - at > 5 * MUSIC_POLL_MS) rows.push({ id, name, tone: 'warn', at, reason: `The music player has not answered for ${ago(at, now).replace(' ago', '')}.` });
    else rows.push({ id, name, tone: 'ok', at, reason: 'Reading normally.' });
  }

  // Weather: the shared reading; stale after one refresh interval and a minute, as the card says.
  {
    const id = 'weather' as const;
    const name = 'Weather';
    const w = s.weather.reading;
    if (!w) rows.push(s.weather.failed ? { id, name, tone: 'down', at: null, reason: 'The weather service did not answer.' } : { id, name, tone: 'none', at: null, reason: 'Not read yet.' });
    else {
      const old = staleText(w.fetchedAt, now);
      if (old) rows.push({ id, name, tone: 'warn', at: w.fetchedAt, reason: `The reading is old (${old}). It refreshes every ${WEATHER_REFRESH_MS / 60_000} min.` });
      else rows.push({ id, name, tone: 'ok', at: w.fetchedAt, reason: 'Reading normally.' });
    }
  }

  rows.push(fromReport('box', 'Box', s.reports.box, now, 60_000, 'The machine numbers'));
  return rows;
}

/** The wall clock, or the frozen review time in a dev review still, as Home's reads use. */
const clock = reviewNow ?? (() => Date.now());

/** The sources, live, with a clock that moves each 20 seconds. */
export function useSources(): SourceRow[] {
  const feed = useMeetingFeed();
  const agents = useAgentsStore();
  const security = useSecurityFeed();
  const weather = useWeatherStore();
  const music = useNowPlayingStore((m) => m.at);
  const reports = useReportStore();
  const [now, setNow] = useState(clock);
  useEffect(() => {
    const id = setInterval(() => setNow(clock()), 20_000);
    return () => clearInterval(id);
  }, []);
  // A new read lands: the clock moves on with it.
  useEffect(() => setNow(clock()), [feed.reads, agents.checkedAt, security.attempts, weather.reading, music, reports]);
  return buildSources({
    now,
    calendar: { asOf: feed.asOf, failed: feed.failed, feedStale: feed.feedStale, noCalendar: feed.noCalendar, reads: feed.reads },
    agents,
    security,
    weather,
    music: { at: music },
    reports,
  });
}

/** Where a hook-held source is read from when no screen has its hook mounted: the same command, read once. */
const PROBES: Record<ReportId, { command: string; check: (a: unknown) => 'ok' | 'stale' | 'bad' }> = {
  tasks: { command: 'wall2_tasks_next', check: (a) => (Array.isArray(a) ? 'ok' : 'bad') },
  sound: { command: 'wall2_sonos_summary', check: (a) => (a ? 'ok' : 'bad') },
  box: {
    command: 'wall2_machines',
    check: (a) => {
      const m = a as { pc?: unknown; box?: unknown; boxStale?: boolean } | null;
      if (!m || !m.pc) return 'bad';
      return m.boxStale || !m.box ? 'stale' : 'ok';
    },
  },
};

async function probe(id: ReportId): Promise<void> {
  const p = PROBES[id];
  try {
    const answer = await invoke<unknown>(p.command);
    const r = p.check(answer);
    if (r === 'ok') reportRead(id, 'ok');
    else if (r === 'stale') reportRead(id, 'stale', id === 'box' ? 'The box reading is out of date' : undefined);
    else reportRead(id, 'failed');
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    reportRead(id, text === 'not-configured' ? 'unconfigured' : 'failed', text === 'not-configured' ? 'Not set up' : undefined);
  }
}

/** Most a Retry waits for its read before it gives up waiting (the read itself is not cancelled). */
export const RETRY_CEILING_MS = 15_000;

export interface RetryResult {
  /** Plain words when the read did not happen or did not finish. */
  note?: string;
}

const run = async (id: SourceId): Promise<RetryResult> => {
  switch (id) {
    case 'calendar':
      await refreshMeetingFeed();
      return {};
    case 'agents':
      await retryAgents();
      return {};
    case 'home':
      await refreshSecurity();
      return {};
    case 'music':
      return (await refreshNowPlaying()) ? {} : { note: 'Nothing is playing to read' };
    case 'weather':
      await refreshWeather();
      return {};
    case 'tasks':
    case 'sound':
    case 'box': {
      const mounted = retryFor(id);
      if (mounted) await mounted();
      else await probe(id);
      return {};
    }
  }
};

const inflight = new Map<SourceId, Promise<RetryResult>>();

/**
 * Retry one source: that store's own refresh. A hook-held source uses its mounted hooks' refresh, else
 * one read of the same command. One Retry per source at a time: a second call while one runs gets the
 * same promise and starts no read. The promise settles when the read does, or after the ceiling.
 */
export function retrySource(id: SourceId): Promise<RetryResult> {
  const running = inflight.get(id);
  if (running) return running;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ceiling = new Promise<RetryResult>((resolve) => {
    timer = setTimeout(() => resolve({ note: 'The read did not finish' }), RETRY_CEILING_MS);
  });
  const p = Promise.race([run(id).catch((): RetryResult => ({ note: 'The read failed' })), ceiling]).finally(() => {
    clearTimeout(timer);
    inflight.delete(id);
  });
  inflight.set(id, p);
  return p;
}

/** Tests only: forget a Retry in progress. */
export function resetRetries(): void {
  inflight.clear();
}

/** Read the hook-held sources whose screen is not open (nothing else reads them then), once each. */
export function readUnmountedSources(): void {
  for (const id of ['tasks', 'sound', 'box'] as const) if (!retryFor(id)) void retrySource(id);
}

/** "10:22 AM", or "never". */
export const readText = (at: number | null): string => (at === null ? 'never' : clockText(at));
