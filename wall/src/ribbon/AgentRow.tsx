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
 * finished run grey, and a span the helper marks done is grey with a mint cap. With no
 * span to draw (the helper not set up, not answered, or idle all day) and no task due on
 * the row (`dueCount`), it says "No agent activity yet" beside the row's icon. A stale answer is dimmed and its open
 * runs end at the last good answer's time, so they never keep growing as if live.
 */
export function AgentRow({ now, dueCount = 0 }: { now: number; dueCount?: number }) {
  const st = useAgents();
  const segs = st.summary ? agentSegments(st.summary, now, (ms) => ribbonX(ms, now), agentsUntil(st), st.skewMs) : [];
  // Nothing on the row at all (no agent span today and no task due at a time): say so.
  if (segs.length === 0)
    return dueCount === 0 ? (
      <span className="li-empty" style={{ top: 70 }}>
        No agent activity yet
      </span>
    ) : null;
  const stale = agentsStale(st);
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
