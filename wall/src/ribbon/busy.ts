import { cards, type OmniSummary } from '../agents/model';
import type { DayRecord } from './days';

/**
 * How many sessions work at once, one rule for the Agents header's meter, the strip's activity
 * cells and the "Busy at once" line in the Agents panel:
 *
 * A session counts while it is WORKING: a run span in the helper's live day log (open or
 * finished; waits and review spans do not count), and only when it is a parent or standalone
 * session the wall knows today (a card, or a session in today's saved record). A child or a
 * side chat is never counted on its own, so a family counts once, as the meter always did.
 * Two spans of the same session never count it twice.
 *
 * A saved past day holds stage spans only, with no runs and no waits, so there a session
 * counts while it has a recorded stage span (the record's "agent work"); the panel says so.
 */
export interface BusySpan {
  id: string;
  start: number;
  end: number;
}

/** Parent and standalone sessions the wall knows today: the cards, and today's saved record when held. */
export function parentIds(s: Pick<OmniSummary, 'lanes' | 'sessionsList'>, record: DayRecord | null = null): Set<string> {
  const out = new Set(cards(s).map((l) => l.id));
  for (const x of record?.sessions ?? []) out.add(x.id);
  return out;
}

/** The working spans of the known parents, from the drawn day log (`run` open, `past` finished). */
export function workingSpans(segs: readonly { lane: string; kind: string; start: number; end: number }[], parents: ReadonlySet<string>): BusySpan[] {
  return segs.filter((g) => (g.kind === 'run' || g.kind === 'past') && parents.has(g.lane) && g.end > g.start).map((g) => ({ id: g.lane, start: g.start, end: g.end }));
}

/** One stretch of time with the same number of sessions working. */
export interface BusyLevel {
  start: number;
  end: number;
  count: number;
}

/** The day as stretches of equal count (only where at least one works), between `from` and `to`. */
export function busyLevels(spans: readonly BusySpan[], from = -Infinity, to = Infinity): BusyLevel[] {
  const pts = new Set<number>();
  for (const s of spans) {
    const a = Math.max(from, s.start);
    const b = Math.min(to, s.end);
    if (b > a) {
      pts.add(a);
      pts.add(b);
    }
  }
  const sorted = [...pts].sort((x, y) => x - y);
  const out: BusyLevel[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const count = new Set(spans.filter((s) => s.start <= a && s.end >= b).map((s) => s.id)).size;
    if (count === 0) continue;
    const last = out[out.length - 1];
    if (last && last.end === a && last.count === count) last.end = b;
    else out.push({ start: a, end: b, count });
  }
  return out;
}

/** Sessions working at the moment `t` (a span counts from its start, up to but not at its end). */
export function busyAt(spans: readonly BusySpan[], t: number): number {
  return new Set(spans.filter((s) => s.start <= t && t < s.end).map((s) => s.id)).size;
}

/** The most sessions working at once between `a` and `b`. */
export function busyPeak(spans: readonly BusySpan[], a: number, b: number): number {
  return busyLevels(spans, a, b).reduce((m, l) => Math.max(m, l.count), 0);
}

/**
 * The colour step for a count against the limit: 0 none, 1 one, 2 two, 3 three (or any count
 * between three and the limit), 4 at the limit, 5 over it. With the limit of 4: mint, cyan,
 * violet, amber, red.
 */
export type BusyStep = 0 | 1 | 2 | 3 | 4 | 5;
export function busyStep(count: number, limit: number): BusyStep {
  if (count <= 0) return 0;
  if (count > limit) return 5;
  if (count === limit) return 4;
  return Math.min(3, count) as BusyStep;
}

/** The steps a limit can reach, in order (the limit of 4: one, two, three, at four, over four). */
export function stepsFor(limit: number): BusyStep[] {
  const out: BusyStep[] = [];
  for (const s of [1, 2, 3] as BusyStep[]) if (s < limit) out.push(s);
  out.push(4, 5);
  return out;
}

/** A step in words: "at 1", "at 3 to 5" (a limit of 6), "at 4", "over 4". */
export function stepWords(step: BusyStep, limit: number): string {
  if (step === 5) return `over ${limit}`;
  if (step === 4) return `at ${limit}`;
  if (step === 3 && limit - 1 > 3) return `at 3 to ${limit - 1}`;
  return `at ${step}`;
}

/** Time spent at each step between `from` and `to` (index 0 unused). Adds up to the time anyone worked. */
export function timeBySteps(spans: readonly BusySpan[], limit: number, from = -Infinity, to = Infinity): number[] {
  const out = [0, 0, 0, 0, 0, 0];
  for (const l of busyLevels(spans, from, to)) out[busyStep(l.count, limit)] += l.end - l.start;
  return out;
}

/** The time anyone worked between `from` and `to` (overlaps counted once). */
export function busyTime(spans: readonly BusySpan[], from = -Infinity, to = Infinity): number {
  return busyLevels(spans, from, to).reduce((t, l) => t + l.end - l.start, 0);
}

/** "1 h 48 m", "12 m", "0 m". */
export function shortSpan(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m < 60 ? `${m} m` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m`;
}

/** The meter's second tip line: "Today: over 4 for 1 h 48 m, at 4 for 12 m." (only the parts that happened). */
export function todayLimitText(byStep: readonly number[], limit: number): string {
  const parts: string[] = [];
  if (byStep[5] >= 60_000) parts.push(`over ${limit} for ${shortSpan(byStep[5])}`);
  if (byStep[4] >= 60_000) parts.push(`at ${limit} for ${shortSpan(byStep[4])}`);
  return parts.length > 0 ? `Today: ${parts.join(', ')}.` : `Today: never at your limit of ${limit}.`;
}
