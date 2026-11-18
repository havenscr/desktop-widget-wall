import { cards, helpersWork, laneWaits, laneWorks, type Lane, type OmniSummary } from '../agents/model';
import { hm } from './model';
import type { DayRecord } from './days';

/**
 * Open sessions against the limit. Only parent and standalone sessions are ever read here
 * (`cards`: the helper's own list, never a child or a side chat). The wall receives no series
 * of the open count, so it is rebuilt from what it does receive: a card's `elapsedS` says when
 * it opened, and today's saved record names sessions that closed earlier (its first and last
 * stage span). Rebuilt history is an estimate; the count right now is exact. Every time here is
 * on this PC's clock, and `now` is the moment the summary was answered (the helper's own time
 * less its skew), never the render clock, so a start does not move between polls.
 */
export interface OpenSpan {
  start: number;
  end: number | null;
}

/** A stretch of time with more sessions open than the limit. */
export interface OverStretch {
  from: number;
  to: number;
}

/** A stretch shorter than this is not drawn (a session that opened a minute before another closed). */
export const MIN_OVER_MS = 2 * 60_000;

/** Open sessions in the summary and the limit, when one is known and passed. */
export function overNow(s: OmniSummary, limit: number | null): number {
  if (limit === null) return 0;
  const open = cards(s).length;
  return open > limit ? open - limit : 0;
}

/** When each open card opened (this PC's clock), and when each earlier session of the record was open. */
export function openSpans(s: OmniSummary, record: DayRecord | null, now: number): OpenSpan[] {
  const list = cards(s);
  const ids = new Set(list.map((l) => l.id));
  const out: OpenSpan[] = [];
  for (const l of list) if (Number.isFinite(l.elapsedS)) out.push({ start: now - l.elapsedS * 1000, end: null });
  for (const x of record?.sessions ?? []) {
    if (ids.has(x.id) || x.spans.length === 0) continue;
    const starts = x.spans.map((p) => Date.parse(p.start)).filter(Number.isFinite);
    // A closed session's last span end is when it closed; an open last span says nothing, so
    // the session counts only to the start of that span (never more open than known).
    const ends = x.spans.map((p) => (p.end === null ? Date.parse(p.start) : Date.parse(p.end))).filter(Number.isFinite);
    if (starts.length === 0 || ends.length === 0) continue;
    out.push({ start: Math.min(...starts), end: Math.max(...ends) });
  }
  return out;
}

/** Every stretch (to `until` at most) in which more than `limit` sessions were open. */
export function overStretches(spans: readonly OpenSpan[], limit: number, until: number): OverStretch[] {
  const ev: [number, number][] = [];
  for (const sp of spans) {
    ev.push([sp.start, 1]);
    ev.push([sp.end ?? until, -1]);
  }
  // At the same moment a close comes before an open.
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: OverStretch[] = [];
  let n = 0;
  let from: number | null = null;
  for (const [t, d] of ev) {
    n += d;
    if (n > limit && from === null) from = t;
    else if (n <= limit && from !== null) {
      if (t - from >= MIN_OVER_MS) out.push({ from, to: t });
      from = null;
    }
  }
  if (from !== null && until - from >= MIN_OVER_MS) out.push({ from, to: until });
  return out;
}

/**
 * The moment the open count passed the limit for the stretch that is still on: the open
 * sessions in the order they opened, the one after the limit. Exact for the cards the helper sent.
 */
export function overSince(s: OmniSummary, limit: number | null, now: number): number | null {
  if (limit === null || overNow(s, limit) === 0) return null;
  const starts = cards(s)
    .map((l) => now - l.elapsedS * 1000)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return starts.length > limit ? starts[limit] : null;
}

/**
 * The red line on the strip: past stretches (rebuilt from the record) that ended, and, while
 * over the limit, the current one from `overSince` to `until`. Nothing without a known limit.
 */
export function overLine(s: OmniSummary, record: DayRecord | null, limit: number | null, now: number, until: number): OverStretch[] {
  if (limit === null) return [];
  const all = overStretches(openSpans(s, record, now), limit, until);
  const since = overStart(s, record, limit, now, until);
  const kept = all.filter((x) => x.to < until - 1000 && (since === null || x.to <= since));
  if (since !== null && until - since >= 1000) kept.push({ from: since, to: until });
  return kept;
}

/**
 * When the stretch that is still on began. Churn while the count stays over the limit does not
 * start a new stretch: when the history rebuilt from the record runs unbroken to `until`, its
 * start stands; otherwise the open sessions alone say it (`overSince`).
 */
export function overStart(s: OmniSummary, record: DayRecord | null, limit: number | null, now: number, until: number): number | null {
  if (limit === null || overNow(s, limit) === 0) return null;
  const run = overStretches(openSpans(s, record, now), limit, until).find((x) => x.to >= until - 1000);
  return run ? run.from : overSince(s, limit, now);
}

/** "42 m" under an hour, else "2 h 05 m". */
export function durText(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m < 60 ? `${m} m` : hm(m * 60_000);
}

export interface SessionRow {
  id: string;
  title: string;
  /** "idle 6 h 50 m", "42 m" or "through helpers"; empty when nothing is known. */
  when: string;
  /** Sort key, longest first. */
  secs: number;
}

export interface OpenList {
  total: number;
  limit: number | null;
  over: number;
  since: number | null;
  idle: SessionRow[];
  working: SessionRow[];
  needs: SessionRow[];
}

/**
 * The open sessions named by where they stand, as the agents line counts them (waiting on the
 * you, working, else idle). `idleSince` gives a moment a session was last seen working when the
 * helper sent no idle time.
 */
export function openList(
  s: OmniSummary,
  limit: number | null,
  now: number,
  idleSince: ReadonlyMap<string, number> = new Map(),
  record: DayRecord | null = null,
  until: number = now,
): OpenList {
  const idle: SessionRow[] = [];
  const working: SessionRow[] = [];
  const needs: SessionRow[] = [];
  const row = (l: Lane, when: string, secs: number): SessionRow => ({ id: l.id, title: l.title, when, secs });
  for (const l of cards(s)) {
    if (laneWaits(l)) needs.push(row(l, l.waitingSinceS != null ? durText(l.waitingSinceS * 1000) : '', l.waitingSinceS ?? 0));
    else if (laneWorks(l)) working.push(row(l, helpersWork(l) ? 'through helpers' : durText(l.elapsedS * 1000), l.elapsedS));
    else {
      const seen = idleSince.get(l.id);
      const secs = l.idleS ?? (seen !== undefined && seen < now ? (now - seen) / 1000 : null);
      idle.push(row(l, secs !== null ? `idle ${durText(secs * 1000)}` : 'idle', secs ?? -1));
    }
  }
  const longest = (a: SessionRow, b: SessionRow) => b.secs - a.secs;
  idle.sort(longest);
  working.sort(longest);
  needs.sort(longest);
  return { total: cards(s).length, limit, over: overNow(s, limit), since: overStart(s, record, limit, now, until), idle, working, needs };
}
