import { agentSegments } from '../agents/model';
import { useAgents } from '../agents/useAgents';
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
 * finished run grey, and a span the helper marks done is grey with a mint cap. Nothing
 * when the helper is not set up or has not answered.
 */
export function AgentRow({ now }: { now: number }) {
  const { summary } = useAgents();
  if (!summary) return null;
  const segs = agentSegments(summary, now, (ms) => ribbonX(ms, now));
  return (
    <div className="agent-row" aria-hidden="true">
      {segs.map((s) => (
        <span key={s.key}>
          <i className={`sg ${s.kind}`} style={{ top: 71 + s.row * 8, left: s.x, width: s.width }} />
          {s.kind === 'done' && <i className="cap2" style={{ top: 71 + s.row * 8, left: s.x + s.width }} />}
        </span>
      ))}
    </div>
  );
}
