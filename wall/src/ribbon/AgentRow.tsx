import { agentSegments } from '../agents/model';
import { agentsStale, agentsUntil, useAgents } from '../agents/useAgents';
import { END_HOUR, RX, START_HOUR, wallHour } from './model';

/** x on the ribbon for a time today, clamped to 6 AM to 12 AM; null for another day. */
function ribbonX(ms: number, now: number): number | null {
  const h = wallHour(ms, now);
  if (h < 0 || h > 24) return null;
  return RX(Math.min(END_HOUR, Math.max(START_HOUR, h)));
}

/**
 * The ribbon's agent row on Work (row 2, concept `.sg`): one thin segment per span in the
 * helper's day log, up to now, on three rows by lane. Running is cyan, waiting amber, a
 * finished run grey, and a span the helper marks done is grey with a mint cap. When the
 * helper answered (fresh) with no span today and the row has no task due (`dueCount` 0
 * after a good task read), it says "No agent activity yet" beside the row's icon; not set
 * up, not answered, stale or tasks unknown says nothing. A stale answer is dimmed and its open
 * runs end at the last good answer's time, so they never keep growing as if live.
 */
export function AgentRow({ now, dueCount = null }: { now: number; dueCount?: number | null }) {
  const st = useAgents();
  const stale = agentsStale(st);
  const segs = st.summary ? agentSegments(st.summary, now, (ms) => ribbonX(ms, now), agentsUntil(st), st.skewMs) : [];
  if (segs.length === 0) {
    // Say the row is empty only when it is known: a fresh helper answer with no span today,
    // and a good task read with nothing due (`dueCount` 0; null while the tasks are unknown).
    const known = st.status === 'ready' && st.summary !== null && !stale && dueCount === 0;
    return known ? (
      <span className="li-empty" style={{ top: 70 }}>
        No agent activity yet
      </span>
    ) : null;
  }
  return (
    <div className={`agent-row${stale ? ' stale' : ''}`} aria-hidden="true">
      {segs.map((s) => (
        <span key={s.key}>
          <i className={`sg ${s.kind}`} style={{ top: 71 + s.row * 8, left: s.x, width: s.width }} />
          {s.kind === 'done' && <i className="cap2" style={{ top: 71 + s.row * 8, left: s.x + s.width }} />}
        </span>
      ))}
    </div>
  );
}
