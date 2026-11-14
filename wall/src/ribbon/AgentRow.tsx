import { useEffect, useRef } from 'react';
import { agentLayout, cards, dayTotals, laneWaits, type AgentSegment, type Lane, type OmniSummary } from '../agents/model';
import { agentsStale, agentsUntil, useAgents, useAgentsStore, type AgentsState } from '../agents/useAgents';
import { tip } from '../ui/HoverTip';
import { busyAt, busyStep, parentIds, workingSpans, type BusySpan } from './busy';
import { isoDay, loadDay, useDaysStore, type DayRecord } from './days';
import { activityCells, agentsLineParts, agentsLineWidth, agentsLineX, END_HOUR, needle, RX, shortTime, START_HOUR, wallHour, type AgentCounts } from './model';

/** x on the ribbon for a time today, clamped to 6 AM to 12 AM; null for another day. */
export function ribbonX(ms: number, now: number): number | null {
  const h = wallHour(ms, now);
  if (h < 0 || h > 24) return null;
  return RX(Math.min(END_HOUR, Math.max(START_HOUR, h)));
}

/** Words for a session's state, as the Day drawer's pills and the panel use them. */
export const STATE_WORDS: Record<string, string> = { working: 'working', blocked: 'waiting on you', review: 'in review', idle: 'idle' };

/** A card's state word: waiting on the owner first, then failed, then idle (helper 1.1.0 on), then its state. */
export function laneStateWord(l: Lane): string {
  if (laneWaits(l)) return STATE_WORDS.blocked;
  if (l.failed) return 'failed';
  if (l.live === 'idle' && l.state === 'working') return STATE_WORDS.idle;
  return STATE_WORDS[l.state] ?? l.state;
}

/** Open sessions by where they stand: need the owner, work, or sit idle (review counts as idle). */
export function agentCounts(s: OmniSummary): AgentCounts {
  const list = cards(s);
  const need = list.filter(laneWaits).length;
  const working = list.filter((l) => !laneWaits(l) && l.state === 'working' && l.live !== 'idle').length;
  return { total: list.length, need, working, idle: list.length - need - working };
}

/** Every drawn span today (all sessions, none folded), with stale data cut at the last good answer. */
export function daySegments(st: AgentsState, now: number): AgentSegment[] {
  if (!st.summary) return [];
  return agentLayout(st.summary, now, (ms) => ribbonX(ms, now), agentsUntil(st), st.skewMs, Number.POSITIVE_INFINITY).segs;
}

/** Where the agents line sits and how wide it is, or null when it is not drawn. */
function lineBox(st: AgentsState, now: number): { x: number; width: number; text: string } | null {
  if (!st.summary || cards(st.summary).length === 0) return null;
  const p = agentsLineParts(agentCounts(st.summary));
  const text = `${p.head}${p.need ?? ''}${p.tail}`;
  const width = agentsLineWidth(text);
  return { x: agentsLineX(needle(now).x, width), width, text };
}

/**
 * The x spans the agent row takes on the ribbon right now (the activity bar and the agents
 * line), so the task marks can keep their labels clear of them. Empty when nothing is drawn.
 */
export function agentBoxes(st: AgentsState, now: number): { x: number; width: number }[] {
  const out: { x: number; width: number }[] = [];
  const segs = daySegments(st, now);
  if (segs.length > 0) {
    const x = Math.min(...segs.map((g) => g.x));
    out.push({ x, width: Math.max(...segs.map((g) => g.x + g.width)) - x });
  }
  const line = lineBox(st, now);
  if (line) out.push({ x: line.x, width: line.width });
  return out;
}

/**
 * Today's working spans, as the header's meter, the strip's cells and the panel's "Busy at once"
 * line all count them (`busy.ts`): run spans of parent and standalone sessions only. `until` is
 * now, or the last good answer for a stale one; `fromLog` is false when the helper sent no day
 * log at all (then the meter falls back to the server's own count).
 */
export interface BusyToday {
  spans: BusySpan[];
  limit: number;
  until: number;
  fromLog: boolean;
}

export function busyToday(st: AgentsState, now: number, record: DayRecord | null = null): BusyToday | null {
  if (!st.summary) return null;
  return {
    spans: workingSpans(daySegments(st, now), parentIds(st.summary, record)),
    limit: st.summary.slots.limit,
    until: Math.min(now, agentsUntil(st) ?? now),
    fromLog: st.summary.day.length > 0,
  };
}

/** Today's working spans from the shared stores (today's saved record names the sessions that closed). */
export function useBusyToday(now: number): BusyToday | null {
  const st = useAgentsStore();
  const read = useDaysStore((d) => d.records[isoDay(now)]);
  return busyToday(st, now, read?.record ?? null);
}

/** How many work right now: the day log's open runs, or the server's count when there is no log. */
export function busyNow(b: BusyToday, s: OmniSummary): number {
  return b.fromLog ? busyAt(b.spans, b.until - 1) : (s.slots.working ?? s.slots.used);
}

/** "10:00 to 10:12: up to 3 working at once, over your limit of 2, one waited on you". */
export function cellWords(c: { start: number; end: number; busy: number; waits: boolean }, limit: number): string {
  const n = c.busy === 0 ? 'none working' : c.busy === 1 ? '1 working' : `up to ${c.busy} working at once`;
  return `${shortTime(c.start)} to ${shortTime(c.end)}: ${n}${c.busy > limit ? `, over your limit of ${limit}` : ''}${c.waits ? ', one waited on you' : ''}`;
}

/** Ten minutes: a session that closed earlier today is named by today's saved record, read at most this often. */
const RECORD_EVERY_MS = 10 * 60_000;

/**
 * The calm strip's agent row (Work and Meet, row 2): a thin activity bar from 6 AM to now in
 * 12 minute cells, each coloured by the most sessions working at once in it against the limit
 * (`busy.ts`: mint 1, cyan 2, violet 3, amber at the limit, red, taller and hatched over it),
 * with an amber underline where one waited on the owner;
 * and one line after the now needle, "12 sessions: 2 need you, 5 working" (with none waiting,
 * "3 sessions: 2 working, 1 idle"), which opens the "Agents today" panel. Late in the day,
 * with under 360 px right of the needle, the line sits right-aligned before it. Each cell's
 * hover says how many sessions were busy then. When the helper answered (fresh) with no span
 * today, no open session and the row has no task due, it says "No agent activity yet"; not
 * set up or not answered says nothing. A stale answer is dimmed, its line says "as of" the
 * last good answer, and its cells end there, so it is never drawn as live.
 */
export function AgentRow({ now, dueCount = null, onOpenPanel }: { now: number; dueCount?: number | null; onOpenPanel?: () => void }) {
  const st = useAgents();
  const stale = agentsStale(st);
  const s = st.summary;
  const segs = daySegments(st, now);
  const until = agentsUntil(st) ?? now;
  const today = isoDay(now);
  const read = useDaysStore((d) => d.records[today]);
  const parents = s ? parentIds(s, read?.record ?? null) : new Set<string>();
  // Only parent and standalone sessions draw and count (a child or a side chat never does).
  const cells = activityCells(segs.filter((g) => parents.has(g.lane)), now, Math.min(now, until));
  const limit = s?.slots.limit ?? 0;
  // A run in the day log of a session that is not on a card may be a parent that closed earlier
  // today: today's saved record (parents only) says, so it is read when such a run is there.
  const unknownRun = s !== null && segs.some((g) => (g.kind === 'run' || g.kind === 'past') && !parents.has(g.lane));
  const readAt = read?.at ?? 0;
  const tick = Math.floor(now / RECORD_EVERY_MS);
  useEffect(() => {
    if (unknownRun && st.status === 'ready' && Date.now() - readAt >= RECORD_EVERY_MS) void loadDay(today);
  }, [unknownRun, st.status, today, tick]);
  const live = useRef(segs);
  live.current = segs;
  const line = lineBox(st, now);
  if (!s || (cells.length === 0 && !line)) {
    const known = st.status === 'ready' && s !== null && !stale && dueCount === 0;
    return known ? (
      <span className="li-empty" style={{ top: 70 }}>
        No agent activity yet
      </span>
    ) : null;
  }
  const counts = agentCounts(s);
  const parts = agentsLineParts(counts);
  const asOf = stale && (st.freshAt ?? st.okAt) !== null ? `, as of ${shortTime((st.freshAt ?? st.okAt) as number)}` : '';
  return (
    <div className={`agent-row${stale ? ' stale' : ''}`}>
      <span
        className="li-hit"
        style={{ top: 70 }}
        aria-label={dayTotals(segs)}
        {...tip(() => (
          <>
            <span className="tip-t">Agent activity and tasks due today</span>
            <span className="tip-s">{dayTotals(live.current)}{stale ? ' (may be out of date)' : ''}</span>
          </>
        ))}
      />
      {cells.map((c) => (
        <span
          key={c.start}
          className={`sg-hit ac${onOpenPanel ? ' open' : ''}`}
          data-lane={`c${c.start}`}
          style={{ left: c.x, width: c.width }}
          aria-hidden="true"
          onClick={onOpenPanel}
          {...tip(() => (
            <>
              <span className="tip-t">{cellWords(c, limit)}</span>
              <span className="tip-s">Counts sessions working at once (a family counts once); your limit is {limit}</span>
              {stale && <span className="tip-s">May be out of date</span>}
              {onOpenPanel && <span className="tip-k">Click to open Agents today</span>}
            </>
          ))}
        >
          <i className={`b${busyStep(c.busy, limit)}${c.waits ? ' wait' : ''}`} />
        </span>
      ))}
      {line && (
        <button
          type="button"
          className={`ag-line${line.x < needle(now).x ? ' before' : ''}`}
          style={{ left: line.x }}
          disabled={!onOpenPanel}
          aria-label={`${line.text}${asOf}. Opens Agents today`}
          onClick={onOpenPanel}
          {...tip(() => (
            <>
              <span className="tip-t">{line.text}</span>
              {stale && <span className="tip-s">May be out of date{asOf}</span>}
              <span className="tip-k">Click to open Agents today</span>
            </>
          ))}
        >
          {parts.head}
          {parts.need && <span className="need">{parts.need}</span>}
          {parts.tail}
          {asOf && <span className="asof">{asOf}</span>}
        </button>
      )}
    </div>
  );
}
