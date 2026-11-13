import { useRef } from 'react';
import { agentLayout, cards, dayTotals, laneWaits, type AgentSegment, type Lane, type OmniSummary } from '../agents/model';
import { agentsStale, agentsUntil, useAgents, type AgentsState } from '../agents/useAgents';
import { tip } from '../ui/HoverTip';
import { activityCells, agentsLineParts, agentsLineWidth, agentsLineX, cellOpacity, END_HOUR, needle, RX, shortTime, START_HOUR, wallHour, type AgentCounts } from './model';

/** x on the ribbon for a time today, clamped to 6 AM to 12 AM; null for another day. */
export function ribbonX(ms: number, now: number): number | null {
  const h = wallHour(ms, now);
  if (h < 0 || h > 24) return null;
  return RX(Math.min(END_HOUR, Math.max(START_HOUR, h)));
}

/** Words for a session's state, as the Day drawer's pills and the panel use them. */
export const STATE_WORDS: Record<string, string> = { working: 'working', blocked: 'waiting on you', review: 'in review', idle: 'idle' };

/** A card's state word: waiting on the owner first, then idle (helper 1.1.0 on), then its state. */
export function laneStateWord(l: Lane): string {
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

/** "10:00 to 10:12: 3 sessions busy, one waiting on you". */
function cellWords(c: { start: number; end: number; busy: number; waits: boolean }): string {
  return `${shortTime(c.start)} to ${shortTime(c.end)}: ${c.busy} session${c.busy === 1 ? '' : 's'} busy${c.waits ? ', one waiting on you' : ''}`;
}

/**
 * The calm strip's agent row (Work and Meet, row 2): a thin activity bar from 6 AM to now in
 * 12 minute cells, brighter the more sessions were busy, amber where one waited on the owner;
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
  const cells = activityCells(segs, now, Math.min(now, until));
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
              <span className="tip-t">{cellWords(c)}</span>
              {stale && <span className="tip-s">May be out of date</span>}
              {onOpenPanel && <span className="tip-k">Click to open Agents today</span>}
            </>
          ))}
        >
          <i className={c.waits ? 'wait' : ''} style={{ opacity: cellOpacity(c.busy) }} />
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
