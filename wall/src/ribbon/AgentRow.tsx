import { useRef } from 'react';
import { AGENT_BAND, AGENT_BAR, AGENT_PITCH, agentLayout, cards, dayTotals, sessionSpans, STAGE_NAMES, type AgentLayout, type AgentSegment, type OmniSummary, type Stage } from '../agents/model';
import { scrollToCard } from '../agents/cardScroll';
import { focusSession } from '../agents/open';
import { agentsStale, agentsUntil, useAgents, type AgentsState } from '../agents/useAgents';
import { tip } from '../ui/HoverTip';
import { END_HOUR, RX, START_HOUR, wallHour } from './model';

/** x on the ribbon for a time today, clamped to 6 AM to 12 AM; null for another day. */
function ribbonX(ms: number, now: number): number | null {
  const h = wallHour(ms, now);
  if (h < 0 || h > 24) return null;
  return RX(Math.min(END_HOUR, Math.max(START_HOUR, h)));
}

/**
 * The x spans the agent row takes on the ribbon right now (bars and the "+N more" label), so
 * the task marks can keep their labels clear of them. Empty when nothing is drawn.
 */
export function agentBoxes(st: AgentsState, now: number): { x: number; width: number }[] {
  if (!st.summary) return [];
  const l = agentLayout(st.summary, now, (ms) => ribbonX(ms, now), agentsUntil(st), st.skewMs);
  const out = [...l.segs, ...l.foldedSegs].map((g) => ({ x: g.x - 16, width: g.width + 22 }));
  if (l.moreRow !== null) out.push({ x: 78, width: 70 });
  return out;
}

/** Where the "+N more" label sits, at the row's left end. */
const MORE_LABEL_X = 78;
const MORE_LABEL_W = 74;

/**
 * The shared hit box of the "+N more" row (the label and every folded span), and how its thin
 * lines stack: 2 px each up to four sessions, 1 px each beyond (eight lines, then they share).
 */
function moreBox(l: AgentLayout): { left: number; width: number; lineH: number; slots: number; top: number } {
  const xs = l.foldedSegs.flatMap((g) => [g.x, g.x + g.width]);
  const left = Math.min(MORE_LABEL_X, ...xs);
  const right = Math.max(MORE_LABEL_X + MORE_LABEL_W, ...xs);
  const lineH = l.hidden.length <= 4 ? 2 : 1;
  const slots = Math.floor(AGENT_PITCH / lineH);
  const top = (AGENT_PITCH - Math.min(l.hidden.length, slots) * lineH) / 2;
  return { left, width: right - left, lineH, slots, top };
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

const STATE_WORDS: Record<string, string> = { working: 'working', blocked: 'waiting on you', review: 'in review' };

/** The "+N more" row's hover: each folded session with its stage and state. */
function MoreTip({ s, hidden, canScroll }: { s: OmniSummary; hidden: string[]; canScroll: boolean }) {
  return (
    <>
      <span className="tip-t">{hidden.length} more sessions today</span>
      {hidden.map((id) => {
        const w = who(s, id);
        const card = cards(s).find((l) => l.id === id);
        const state = card ? (card.waiting ? 'blocked' : card.state) : (s.sessions?.[id]?.state ?? null);
        return (
          <span key={id} className="tip-s">
            {w.stage && <i className="bar-stage" style={{ background: `var(--st-${w.stage})` }} aria-hidden="true" />}
            {w.num !== null ? `${w.num}. ` : ''}
            {w.title}
            {w.stage ? `, ${STAGE_NAMES[w.stage]}` : ''}
            {state ? `, ${STATE_WORDS[state]}` : w.num === null ? ', no longer open' : ''}
          </span>
        );
      })}
      {canScroll && <span className="tip-k">Click to show the first of them in the cards</span>}
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
 * session". A click opens the session in OmniGent. With more sessions than rows, the last
 * row says "+N more": its hover lists them and a click shows the first in the cards. When the helper answered (fresh) with
 * no span today and the row has no task due (`dueCount` 0 after a good task read), it says
 * "No agent activity yet" beside the row's icon; not set up, not answered, stale or tasks
 * unknown says nothing. A stale answer is dimmed and its open runs end at the last good
 * answer's time, so they never keep growing as if live.
 */
export function AgentRow({ now, dueCount = null }: { now: number; dueCount?: number | null }) {
  const st = useAgents();
  const stale = agentsStale(st);
  const s = st.summary;
  const all = s ? agentLayout(s, now, (ms) => ribbonX(ms, now), agentsUntil(st), st.skewMs, Number.POSITIVE_INFINITY).segs : [];
  const layout = s ? agentLayout(s, now, (ms) => ribbonX(ms, now), agentsUntil(st), st.skewMs) : null;
  const segs = layout?.segs ?? [];
  // A hover card is built once, when it shows, and redrawn from the same function, so it reads
  // the newest data through this ref instead of the data of the render that opened it.
  const live = useRef({ s, segs, hidden: layout?.hidden ?? [], canOpen: s?.linksAvailable ?? false, canScroll: false });
  live.current = { s, segs, hidden: layout?.hidden ?? [], canOpen: s?.linksAvailable ?? false, canScroll: s !== null && (layout?.hidden ?? []).some((id) => cards(s).some((l) => l.id === id)) };
  if (!s || !layout || all.length === 0) {
    // Say the row is empty only when it is known: a fresh helper answer with no span today,
    // and a good task read with nothing due (`dueCount` 0; null while the tasks are unknown).
    const known = st.status === 'ready' && s !== null && !stale && dueCount === 0;
    return known ? (
      <span className="li-empty" style={{ top: 70 }}>
        No agent activity yet
      </span>
    ) : null;
  }
  const pitch = AGENT_PITCH;
  const more = moreBox(layout);
  const bar = AGENT_BAR;
  const cap = Math.min(9, bar + 4);
  const canOpen = s.linksAvailable;
  const firstCard = layout.hidden.find((id) => cards(s).some((l) => l.id === id)) ?? null;
  // The number goes on the first bar of each carded session.
  const firstOf = new Set<string>();
  const numbered = new Set<string>();
  for (const g of [...segs].sort((a, b) => a.start - b.start)) {
    if (!firstOf.has(g.lane)) {
      firstOf.add(g.lane);
      numbered.add(g.key);
    }
  }
  return (
    <div className={`agent-row${stale ? ' stale' : ''}`} data-rows={layout.rows}>
      {/* The day in one line, on the row's icon. */}
      <span
        className="li-hit"
        style={{ top: 70 }}
        aria-label={dayTotals(all)}
        {...tip(() => (
          <>
            <span className="tip-t">Agent activity and tasks due today</span>
            <span className="tip-s">{dayTotals(all)}{stale ? ' (may be out of date)' : ''}</span>
          </>
        ))}
      />
      {segs.map((g) => {
        const w = who(s, g.lane);
        const label = `${w.title}: ${sessionSpans(segs, g.lane)}`;
        return (
          <span
            key={g.key}
            className={`sg-hit${canOpen ? ' open' : ''}`}
            data-lane={g.lane}
            style={{ top: AGENT_BAND.top + g.row * pitch, left: g.x, width: g.width, height: pitch }}
            role={canOpen ? 'button' : 'img'}
            aria-label={label}
            onClick={canOpen ? () => focusSession(g.lane) : undefined}
            {...tip(() => (live.current.s ? <BarTip s={live.current.s} segs={live.current.segs} lane={g.lane} canOpen={live.current.canOpen} /> : null))}
          >
            <i
              className={`sg ${g.kind}`}
              style={{ top: (pitch - bar) / 2, height: bar, ['--sc' as string]: w.stage ? `var(--st-${w.stage})` : 'transparent' }}
            />
            {g.kind === 'done' && <i className="cap2" style={{ top: (pitch - cap) / 2, ['--cap' as string]: `${cap}px` }} />}
            {w.num !== null && numbered.has(g.key) && <b className="sg-num">{w.num}</b>}
          </span>
        );
      })}
      {layout.moreRow !== null && (
        <span
          className={`sg-more${firstCard ? ' open' : ''}`}
          style={{ top: AGENT_BAND.top + layout.moreRow * pitch, height: pitch, left: more.left, width: more.width }}
          role={firstCard ? 'button' : 'img'}
          aria-label={`${layout.hidden.length} more sessions today`}
          onClick={firstCard ? () => scrollToCard(firstCard) : undefined}
          {...tip(() => (live.current.s ? <MoreTip s={live.current.s} hidden={live.current.hidden} canScroll={live.current.canScroll} /> : null))}
        >
          {layout.foldedSegs.map((g) => {
            const i = layout.hidden.indexOf(g.lane);
            const line = more.lineH;
            return (
              <i
                key={g.key}
                className={`sg-line ${g.kind}`}
                style={{ left: g.x - more.left, width: g.width, height: line, top: more.top + (i % more.slots) * line }}
              />
            );
          })}
          <em className="sg-more-t" style={{ left: MORE_LABEL_X - more.left }}>
            +{layout.hidden.length} more
          </em>
        </span>
      )}
    </div>
  );
}
