import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { LaneRing } from './LaneRing';
import { elapsedText, HOLD_HINT_MS, HOLD_MOVE_PX, HOLD_MS, laneLine, laneTone, laneWaits, mergeReady, prText, ringFraction, type Lane as LaneData } from './model';
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

/**
 * One agent lane (concept `.lane`): ring, title and live line, the stage track, and the
 * elapsed time or "Hold to merge". Amber when it waits for you. A tap anywhere but the
 * merge button opens the chat, when the helper says links are available.
 */
export function Lane({ lane, canOpen, open, roomy }: { lane: LaneData; canOpen: boolean; open: (id: string) => void; roomy: boolean }) {
  const tone = laneTone(lane);
  const waits = laneWaits(lane);
  const ready = mergeReady(lane);
  const glyph = waits ? 'ask' : tone === 'mint' ? 'check' : 'bolt';
  const meta = roomy ? prText(lane) : '';
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
      className={`lane g${waits ? ' wait' : ''}${ready ? ' ready' : ''}`}
      role={canOpen ? 'button' : undefined}
      tabIndex={canOpen ? 0 : undefined}
      aria-label={`${lane.title}: ${laneLine(lane)}${canOpen ? '. Opens the chat' : ''}`}
      onClick={tap}
      onKeyDown={key}
    >
      <LaneRing size={roomy ? 84 : 68} fraction={ringFraction(lane)} tone={tone} glyph={glyph} />
      <div className="lt">
        <div className="t2 ellipsis">{lane.title}</div>
        <div className="s ellipsis">{laneLine(lane)}</div>
        {meta && <div className="xs ellipsis">{meta}</div>}
      </div>
      <StageTrack stage={lane.stage} mark={waits ? 'wait' : ready || lane.stage === 'live' ? 'ready' : ''} />
      <div className="lm">{ready && canOpen ? <HoldToMerge onHold={() => open(lane.id)} /> : <span className="s">{elapsedText(lane.elapsedS)}</span>}</div>
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
