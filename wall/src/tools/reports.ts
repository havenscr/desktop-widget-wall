import { create } from 'zustand';
import { reviewNow } from '../ui/reviewClock';

/**
 * What the Tools drawer knows about the sources whose store keeps its state inside a hook
 * (tasks, sound, the box). Each of those hooks reports every read here, in one line. Nothing
 * here reads or changes what a screen shows. The sources with a shared store (calendar,
 * agents, home, music, weather) are read from their own store, not through here.
 */
export type ReportId = 'tasks' | 'sound' | 'box';
export type Outcome = 'ok' | 'stale' | 'failed' | 'unconfigured';

export interface Report {
  /** Time of the last read that was fully good, or null. */
  okAt: number | null;
  /** What the latest read said. */
  last: Outcome;
  /** Plain words for a read that was not fully good. */
  reason?: string;
}

/** The wall clock, or the frozen review time in a dev review still (`?hz=&at=`), as Home's reads use. */
const clock = reviewNow ?? (() => Date.now());

export const useReportStore = create<Partial<Record<ReportId, Report>>>(() => ({}));

/** A read of `id` finished. A read that is not `ok` keeps the time of the last good one. */
export function reportRead(id: ReportId, last: Outcome, reason?: string): void {
  useReportStore.setState((s) => ({ [id]: { okAt: last === 'ok' ? clock() : (s[id]?.okAt ?? null), last, ...(reason ? { reason } : {}) } }));
}

export type Refresh = () => void | Promise<void>;

const retries = new Map<ReportId, Set<Refresh>>();

/** A mounted hook's own refresh for `id` (several lists may be mounted); the returned function removes only this one. */
export function registerRetry(id: ReportId, fn: Refresh): () => void {
  const set = retries.get(id) ?? new Set<Refresh>();
  set.add(fn);
  retries.set(id, set);
  return () => {
    set.delete(fn);
    if (set.size === 0 && retries.get(id) === set) retries.delete(id);
  };
}

/** One refresh that reads every mounted hook for `id` once and settles when all have, or undefined when none is mounted. */
export function retryFor(id: ReportId): (() => Promise<void>) | undefined {
  const set = retries.get(id);
  if (!set || set.size === 0) return undefined;
  return async () => {
    await Promise.all([...set].map((f) => f()));
  };
}

/** Tests only. */
export function resetReports(): void {
  retries.clear();
  useReportStore.setState({}, true);
}
