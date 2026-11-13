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

const retries = new Map<ReportId, () => void>();

/** The mounted hook's own refresh for `id`; the returned function removes it (if still the same). */
export function registerRetry(id: ReportId, fn: () => void): () => void {
  retries.set(id, fn);
  return () => {
    if (retries.get(id) === fn) retries.delete(id);
  };
}

/** The refresh a mounted hook registered for `id`, or undefined. */
export function retryFor(id: ReportId): (() => void) | undefined {
  return retries.get(id);
}

/** Tests only. */
export function resetReports(): void {
  retries.clear();
  useReportStore.setState({}, true);
}
