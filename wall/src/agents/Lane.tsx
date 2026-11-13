import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { LaneRing } from './LaneRing';
import { tip } from '../ui/HoverTip';
import { cardLine, cardMeta, elapsedText, HOLD_HINT_MS, HOLD_MOVE_PX, HOLD_MS, laneTone, laneWaits, mergeReady, ringFraction, STAGE_NAMES, type Lane as LaneData } from './model';
import { StageTrack } from './StageTrack';

/**
 * "Hold to merge", drawn as in the concept. Until the merge path lands (PR 30) a hold of
 * 600 ms opens the chat; a short tap does nothing but say "Hold" for a moment. The hold is
 * cancelled, with no hint, when the finger moves more than 12 px, leaves the button or the
 * pointer is cancelled (a scroll or a second touch). Enter or Space opens the chat too, so
 * the button works from the keyboard. Its own events never reach the lane.
 */
function HoldToMerge({ onHold }: { onHold: () => void }) {
  const [holding, setHolding] = useState(false);
  const [hint, setHint] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The pointer holding the button and where it went down, or null. */
  const press = useRef<{ id: number; x: number; y: number } | null>(null);

  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      if (hintTimer.current) clearTimeout(hintTimer.current);
    },
    [],
  );

  /** Stop the hold. `hint` shows "Hold" when it was a short tap. */
  const stop = (hintNow: boolean) => {
    const early = holdTimer.current !== null;
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    press.current = null;
    setHolding(false);
    if (early && hintNow) {
      setHint(true);
      if (hintTimer.current) clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setHint(false), HOLD_HINT_MS);
    }
  };

  const down = (e: PointerEvent) => {
    e.stopPropagation();
    if (holdTimer.current) clearTimeout(holdTimer.current);
    press.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    setHolding(true);
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      press.current = null;
      setHolding(false);
      onHold();
    }, HOLD_MS);
  };
  const move = (e: PointerEvent) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > HOLD_MOVE_PX) stop(false);
  };
  const up = (e: PointerEvent) => {
    e.stopPropagation();
    const p = press.current;
    if (p && p.id !== e.pointerId) return;
    stop(true);
  };
  const cancel = (e: PointerEvent) => {
    e.stopPropagation();
    stop(false);
  };

  return (
    <button
      type="button"
      className={`btn mint hold${holding ? ' holding' : ''}`}
      style={{ ['--hold-ms' as string]: `${HOLD_MS}ms` }}
      aria-label="Hold to merge (opens the chat for now)"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      onPointerLeave={(e) => press.current && cancel(e)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!e.repeat) onHold();
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="hold-fill" aria-hidden="true" />
      <span className="hold-text">{hint ? 'Hold' : 'Hold to merge'}</span>
    </button>
  );
}

/** The card's full details, for the hover card on its title. */
function CardTip({ lane, line, meta, canOpen }: { lane: LaneData; line: string; meta: string[]; canOpen: boolean }) {
  return (
    <>
      <span className="tip-t">{lane.title}</span>
      <span className="tip-s">{line}</span>
      {lane.next && !line.startsWith('Next:') && <span className="tip-s">Next: {lane.next}</span>}
      {meta.length > 0 && <span className="tip-s">{meta.join(', ')}</span>}
      <span className="tip-k">
        {STAGE_NAMES[lane.stage]} stage, open {elapsedText(lane.elapsedS)}
        {canOpen ? '. Click to open it in OmniGent.' : ''}
      </span>
    </>
  );
}

/**
 * One agent card (concept `.lane`): ring in the stage's colour with the card's number,
 * title, and a second line that says the most useful thing first (waiting on you, failed,
 * what it is doing or its next step, then working or idle time) with the quiet facts after
 * it (helpers, assistant, PR and checks); then the stage track and the elapsed time or
 * "Hold to merge". Amber when it waits for you. A click anywhere but the merge button
 * opens the session and brings OmniGent forward, when the helper says links are available.
 * The title takes all the free width; hover shows the whole of it.
 */
export function Lane({ lane, num, canOpen, open, roomy }: { lane: LaneData; num: number; canOpen: boolean; open: (id: string) => void; roomy: boolean }) {
  const tone = laneTone(lane);
  const waits = laneWaits(lane);
  const ready = mergeReady(lane);
  const failed = !waits && lane.failed === true;
  const glyph = waits ? 'ask' : failed ? 'failed' : tone === 'mint' ? 'check' : 'bolt';
  const line = cardLine(lane);
  const meta = cardMeta(lane);
  const tap = canOpen ? () => open(lane.id) : undefined;
  const key = canOpen
    ? (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open(lane.id);
        }
      }
    : undefined;
  return (
    <div
      className={`lane g${waits ? ' wait' : ''}${ready ? ' ready' : ''}${failed ? ' failed' : ''}`}
      style={{ ['--c' as string]: `var(--st-${lane.stage})` }}
      data-id={lane.id}
      role={canOpen ? 'button' : undefined}
      tabIndex={canOpen ? 0 : undefined}
      aria-label={`${num}. ${lane.title}: ${line.text}${canOpen ? '. Opens the session' : ''}`}
      onClick={tap}
      onKeyDown={key}
    >
      <LaneRing size={roomy ? 84 : 68} fraction={ringFraction(lane)} tone={waits ? 'amber' : failed ? 'red' : 'stage'} glyph={glyph} num={num} />
      <div className="lt">
        <div className="t2 ellipsis" {...tip(() => <CardTip lane={lane} line={line.text} meta={meta} canOpen={canOpen} />)}>
          {lane.title}
        </div>
        <div className="lt2">
          <span className={`s ellipsis${line.tone ? ` t-${line.tone}` : ''}`}>{line.text}</span>
          {!roomy && meta.map((m) => <span key={m} className="xs lane-meta">{m}</span>)}
        </div>
        {roomy && meta.length > 0 && <div className="xs ellipsis lane-meta">{meta.join(', ')}</div>}
      </div>
      <StageTrack stage={lane.stage} mark={waits ? 'wait' : ''} />
      <div className="lm">
        {ready && canOpen ? (
          <HoldToMerge onHold={() => open(lane.id)} />
        ) : (
          <span className="s" {...tip(`Open for ${elapsedText(lane.elapsedS)}`)}>
            {elapsedText(lane.elapsedS)}
          </span>
        )}
      </div>
    </div>
  );
}

/** A quiet row for an empty slot (concept `.lane.slim`). */
export function FreeRow({ text }: { text: string }) {
  return (
    <div className="lane slim free">
      <i className="free-dot" aria-hidden="true" />
      <span className="s">{text}</span>
    </div>
  );
}
