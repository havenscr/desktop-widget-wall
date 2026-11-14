import { useEffect, useRef } from 'react';
import { agentLayout, cards, dayTotals, laneWaits, type AgentSegment, type Lane, type OmniSummary } from '../agents/model';
import { agentsStale, agentsUntil, useAgents, useAgentsStore, type AgentsState } from '../agents/useAgents';
import { tip } from '../ui/HoverTip';
import { busyAt, busyStep, countedSegments, knownLimit, logSegments, parentIds, settleOpenRuns, workingIds, workingSpans, type BusySpan, type LogSeg } from './busy';
import { dayStart, isoDay, reloadDay, useDaysStore, type DayRecord } from './days';
import { noteWorking, seenWorking } from './workSeen';
import { activityCells, agentsLineParts, agentsLineWidth, agentsLineX, END_HOUR, needle, RX, shortTime, START_HOUR, wallHour, type AgentCounts } from './model';

/** x on the ribbon for a time today, clamped to 6 AM to 12 AM; null for another day. */
export function ribbonX(ms: number, now: number): number | null {
  const h = wallHour(ms, now);
  if (h < 0 || h > 24) return null;
  return RX(Math.min(END_HOUR, Math.max(START_HOUR, h)));
}

/** Words for a session's state, as the Day drawer's pills and the panel use them. */
export const STATE_WORDS: Record<string, string> = { working: 'working', blocked: 'waiting on you', review: 'in review', idle: 'idle' };

/**
 * A card's state word: failed first (a failed session is never read as working or waiting; the
 * quiet line still says how long it has waited), then waiting on the owner, then idle (helper
 * 1.1.0 on), then its state.
 */
export function laneStateWord(l: Lane): string {
  if (l.failed) return 'failed';
  if (laneWaits(l)) return STATE_WORDS.blocked;
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

/**
 * The last moment each session was seen working is kept for the day (`workSeen.ts`): every
 * answer the helper gives is noted as it arrives, before any view reads it.
 */
let watching = false;
function watchWorking(): void {
  if (watching) return;
  watching = true;
  useAgentsStore.subscribe((st) => {
    const s = st.summary;
    if (!s || agentsStale(st)) return;
    const at = Date.parse(s.now) - st.skewMs;
    if (Number.isFinite(at)) noteWorking(workingIds(s), at);
  });
}
watchWorking();

/**
 * Today's summary with every open run of a parent whose card is not working ended where the
 * session stopped (`settleOpenRuns`), so each view reads the same span. `ends` names those ends.
 */
export function settledToday(st: AgentsState, now: number, record: DayRecord | null = null): { summary: OmniSummary; ends: Map<string, number>; parents: Set<string>; until: number } | null {
  const s = st.summary;
  if (!s) return null;
  const until = Math.min(now, agentsUntil(st) ?? now);
  const parents = parentIds(s, record);
  const answered = Date.parse(s.now) - st.skewMs;
  const ref = Number.isFinite(answered) ? Math.min(answered, until) : until;
  const settled = settleOpenRuns(s, parents, workingIds(s), seenWorking(now), ref, until, st.skewMs);
  return { summary: { ...s, day: settled.day }, ends: settled.ends, parents, until };
}

/** Every drawn span today (all sessions, none folded), with stale data cut at the last good answer. */
export function daySegments(st: AgentsState, now: number, record: DayRecord | null = null): AgentSegment[] {
  const t = settledToday(st, now, record);
  if (!t) return [];
  return agentLayout(t.summary, now, (ms) => ribbonX(ms, now), agentsUntil(st), st.skewMs, Number.POSITIVE_INFINITY).segs;
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
 * Today's counted spans, as the header's meter, the strip's cells and the panel's "Busy at once"
 * line all count them (`busy.ts`): the day log's spans of parent and standalone sessions only,
 * clipped to today (a span from before midnight counts from midnight), where an open run of a
 * session whose card does not say working is ended where the session stopped (`settleOpenRuns`).
 * `summary` is the summary with those ends applied and `ends` says where each stopped, for the
 * panel's rows. `until` is now, or the last good answer for a stale
 * one; `fromLog` is false when the helper sent no day log at all. `limit` is null when the
 * helper sent none (or a zero): nothing is then measured against a limit.
 */
export interface BusyToday {
  segs: LogSeg[];
  spans: BusySpan[];
  limit: number | null;
  until: number;
  fromLog: boolean;
  summary: OmniSummary;
  ends: Map<string, number>;
}

export function busyToday(st: AgentsState, now: number, record: DayRecord | null = null): BusyToday | null {
  const t = settledToday(st, now, record);
  if (!t) return null;
  const s = t.summary;
  const segs = countedSegments(logSegments(s.day, dayStart(isoDay(now)), t.until, st.skewMs), t.parents);
  return { segs, spans: workingSpans(segs, t.parents), limit: knownLimit(s.slots.limit), until: t.until, fromLog: s.day.length > 0, summary: s, ends: t.ends };
}

/** Today's counted spans from the shared stores (today's saved record names the sessions that closed). */
export function useBusyToday(now: number): BusyToday | null {
  const st = useAgentsStore();
  const read = useDaysStore((d) => d.records[isoDay(now)]);
  return busyToday(st, now, read?.record ?? null);
}

/**
 * How many work right now. The server's own working count when the helper sends one (it is the
 * number the cards' pills add up to); else the day log's open runs of working cards; else the
 * slots in use (an older helper).
 */
export function busyNow(b: BusyToday, s: OmniSummary): number {
  if (typeof s.slots.working === 'number') return s.slots.working;
  return b.fromLog ? busyAt(b.spans, b.until - 1) : s.slots.used;
}

/** "10:00 to 10:12: up to 3 working at once, over your limit of 2, one waited on you" (no limit words without a limit). */
export function cellWords(c: { start: number; end: number; busy: number; waits: boolean }, limit: number | null): string {
  const n = c.busy === 0 ? 'none working' : c.busy === 1 ? '1 working' : `up to ${c.busy} working at once`;
  return `${shortTime(c.start)} to ${shortTime(c.end)}: ${n}${limit !== null && c.busy > limit ? `, over your limit of ${limit}` : ''}${c.waits ? ', one waited on you' : ''}`;
}

/** What the strip's colours mean, in one line (the activity row's own tip carries it). */
export function colourKey(limit: number | null): string {
  if (limit === null) return 'Each cell is 12 minutes of agent work; an amber underline means a session waited on you.';
  return `Cell colour is how many sessions worked at once: 1 mint, 2 cyan, 3 violet, ${limit} amber, over ${limit} red, hatched and taller. An amber underline means a session waited on you.`;
}

/**
 * The calm strip's agent row (Work and Meet, row 2): a thin activity bar from 6 AM to now in
 * 12 minute cells, each coloured by the most sessions working at once in it against the limit
 * (`busy.ts`: mint 1, cyan 2, violet 3, amber at the limit, red, taller and hatched over it;
 * with no known limit the plain look), with an amber underline where one waited on the owner;
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
  const until = agentsUntil(st) ?? now;
  const today = isoDay(now);
  const read = useDaysStore((d) => d.records[today]);
  const segs = daySegments(st, now, read?.record ?? null);
  const busy = busyToday(st, now, read?.record ?? null);
  // Only parent and standalone sessions draw and count (a child or a side chat never does).
  const cells = busy ? activityCells(busy.segs, now, Math.min(now, until)) : [];
  const limit = busy?.limit ?? null;
  // A run in the day log of a session that is not on a card may be a parent that closed a moment
  // ago: today's saved record (parents only) says. It is read at once when such an id first
  // shows, and once per id after that (a helper's id stays unknown: never on a timer).
  const asked = useRef(new Set<string>());
  const parents = s ? parentIds(s, read?.record ?? null) : new Set<string>();
  const unknown = s ? [...new Set(logSegments(s.day, dayStart(today), Math.min(now, until), st.skewMs).filter((g) => (g.kind === 'run' || g.kind === 'past') && !parents.has(g.lane)).map((g) => g.lane))] : [];
  const fresh = unknown.filter((id) => !asked.current.has(`${today}|${id}`)).sort().join('|');
  useEffect(() => {
    if (!fresh || st.status !== 'ready') return;
    for (const id of fresh.split('|')) asked.current.add(`${today}|${id}`);
    void reloadDay(today);
  }, [fresh, st.status, today]);
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
            <span className="tip-s">{colourKey(limit)}</span>
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
              <span className="tip-s">Counts sessions working at once (a family counts once){limit !== null ? `; your limit is ${limit}` : ''}</span>
              {stale && <span className="tip-s">May be out of date</span>}
              {onOpenPanel && <span className="tip-k">Click to open Agents today</span>}
            </>
          ))}
        >
          <i className={`${limit === null ? 'bn' : `b${busyStep(c.busy, limit)}`}${c.waits ? ' wait' : ''}`} />
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
