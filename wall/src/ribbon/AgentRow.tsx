import { agentOrder, agentRowSize, agentSegments, AGENT_BAND, cards, sessionSpans, STAGE_NAMES, type AgentSegment, type OmniSummary, type Stage } from '../agents/model';
import { focusSession } from '../agents/open';
import { agentsStale, agentsUntil, useAgents } from '../agents/useAgents';
import { tip } from '../ui/HoverTip';
import { END_HOUR, RX, START_HOUR, wallHour } from './model';

/** x on the ribbon for a time today, clamped to 6 AM to 12 AM; null for another day. */
function ribbonX(ms: number, now: number): number | null {
  const h = wallHour(ms, now);
  if (h < 0 || h > 24) return null;
  return RX(Math.min(END_HOUR, Math.max(START_HOUR, h)));
}

/** What the ribbon knows about one session: its card number (or none), title and stage. */
function who(s: OmniSummary, lane: string): { num: number | null; title: string; stage: Stage | null } {
  const list = cards(s);
  const i = list.findIndex((l) => l.id === lane);
  if (i >= 0) return { num: i + 1, title: list[i].title, stage: list[i].stage };
  const n = s.sessions?.[lane];
  return { num: null, title: n?.title ?? 'An earlier session', stage: n?.stage ?? null };
}

/** The hover card of a bar: the session's name, stage and its spans today in plain words. */
function BarTip({ s, segs, lane, canOpen }: { s: OmniSummary; segs: AgentSegment[]; lane: string; canOpen: boolean }) {
  const w = who(s, lane);
  return (
    <>
      <span className="tip-t">
        {w.num !== null && <span className="bar-num">{w.num}</span>}
        {w.title}
      </span>
      {w.stage && (
        <span className="tip-s">
          <i className="bar-stage" style={{ background: `var(--st-${w.stage})` }} aria-hidden="true" />
          {STAGE_NAMES[w.stage]} stage{w.num === null ? ', no longer open' : ''}
        </span>
      )}
      <span className="tip-s">{sessionSpans(segs, lane)}</span>
      {canOpen && <span className="tip-k">Click to open it in OmniGent</span>}
    </>
  );
}

/**
 * The ribbon's agent row on Work (row 2): one thin sub-row per session, in the cards'
 * order, so a bar matches its card (the card's number sits at the left end of its first
 * bar, and its stage colour is the bar's left notch). Running is cyan, waiting on you
 * amber, a finished run grey, and a span the helper marks done grey with a mint cap; thin
 * bars, unlike the rounded calendar chips with words above. Hover shows the session's
 * name, stage and spans in plain words ("working 2:10 to 3:40, waiting on you since
 * 3:40"); a session with no card is named from the helper's day names, or "An earlier
 * session". A click opens the session in OmniGent. When the helper answered (fresh) with
 * no span today and the row has no task due (`dueCount` 0 after a good task read), it says
 * "No agent activity yet" beside the row's icon; not set up, not answered, stale or tasks
 * unknown says nothing. A stale answer is dimmed and its open runs end at the last good
 * answer's time, so they never keep growing as if live.
 */
export function AgentRow({ now, dueCount = null }: { now: number; dueCount?: number | null }) {
  const st = useAgents();
  const stale = agentsStale(st);
  const s = st.summary;
  const segs = s ? agentSegments(s, now, (ms) => ribbonX(ms, now), agentsUntil(st), st.skewMs) : [];
  if (!s || segs.length === 0) {
    // Say the row is empty only when it is known: a fresh helper answer with no span today,
    // and a good task read with nothing due (`dueCount` 0; null while the tasks are unknown).
    const known = st.status === 'ready' && s !== null && !stale && dueCount === 0;
    return known ? (
      <span className="li-empty" style={{ top: 70 }}>
        No agent activity yet
      </span>
    ) : null;
  }
  const rows = Math.max(...segs.map((g) => g.row)) + 1;
  const { pitch, bar } = agentRowSize(rows);
  const cap = Math.min(9, bar + 4);
  const canOpen = s.linksAvailable;
  const order = agentOrder(s);
  // The number goes on the first bar of each carded session, when the rows are tall enough to read it.
  const firstOf = new Set<string>();
  const numbered = new Set<string>();
  for (const g of [...segs].sort((a, b) => a.start - b.start)) {
    if (!firstOf.has(g.lane)) {
      firstOf.add(g.lane);
      numbered.add(g.key);
    }
  }
  return (
    <div className={`agent-row${stale ? ' stale' : ''}`} data-rows={rows} data-sessions={order.length}>
      {segs.map((g) => {
        const w = who(s, g.lane);
        const label = `${w.title}: ${sessionSpans(segs, g.lane)}`;
        return (
          <span
            key={g.key}
            className={`sg-hit${canOpen ? ' open' : ''}`}
            style={{ top: AGENT_BAND.top + g.row * pitch, left: g.x, width: g.width, height: pitch }}
            role={canOpen ? 'button' : 'img'}
            aria-label={label}
            onClick={canOpen ? () => focusSession(g.lane) : undefined}
            {...tip(() => <BarTip s={s} segs={segs} lane={g.lane} canOpen={canOpen} />)}
          >
            <i
              className={`sg ${g.kind}`}
              style={{ top: (pitch - bar) / 2, height: bar, ['--sc' as string]: w.stage ? `var(--st-${w.stage})` : 'transparent' }}
            />
            {g.kind === 'done' && <i className="cap2" style={{ top: (pitch - cap) / 2, ['--cap' as string]: `${cap}px` }} />}
            {w.num !== null && numbered.has(g.key) && pitch >= 6 && <b className="sg-num">{w.num}</b>}
          </span>
        );
      })}
    </div>
  );
}
