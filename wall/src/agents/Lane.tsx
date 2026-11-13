import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { LaneRing } from './LaneRing';
import { tip } from '../ui/HoverTip';
import { cardLine, cardMeta, clockText, elapsedLabel, elapsedText, HOLD_HINT_MS, HOLD_MOVE_PX, HOLD_MS, laneTone, laneWaits, mergeReady, ringFraction, STAGE_NAMES, type Lane as LaneData } from './model';
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
function CardTip({ lane, line, meta, canOpen, asOf }: { lane: LaneData; line: string; meta: string[]; canOpen: boolean; asOf: string | null }) {
  return (
    <>
      <span className="tip-t">{lane.title}</span>
      <span className="tip-s">{line}</span>
      {lane.line && !line.includes(lane.line) && !['running', 'idle', 'working', 'blocked'].includes(lane.line.toLowerCase()) && <span className="tip-s">{lane.line}</span>}
      {lane.next && !line.startsWith('Next:') && <span className="tip-s">Next: {lane.next}</span>}
      {meta.length > 0 && <span className="tip-s">{meta.join(', ')}</span>}
      <span className="tip-k">
        {STAGE_NAMES[lane.stage]} stage, open {elapsedText(lane.elapsedS)}
        {canOpen ? '. Click to open it in OmniGent.' : ''}
      </span>
      {asOf && <span className="tip-k">All of this is {asOf}; it may have changed. The session still opens.</span>}
    </>
  );
}

/** Gaps on the second line, from agents.css: before the first extra, and the dot between two. */
const EXTRA_GAP = 18;
const EXTRA_SEP = 8;

/**
 * How many extras fit after the status on a line `avail` px wide: whole items only, dropped
 * from the end, never cut inside a word. 0 when even the status does not fit (the status
 * then ends with an ellipsis).
 */
export function fitExtras(avail: number, statusW: number, itemWs: readonly number[]): number {
  let used = statusW;
  let k = 0;
  for (const w of itemWs) {
    const add = EXTRA_GAP + w + (k > 0 ? EXTRA_SEP : 0);
    if (used + add > avail) break;
    used += add;
    k += 1;
  }
  return k;
}

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** The natural width of `text` in `el`'s font, or null when it cannot be measured. */
function textWidth(text: string, el: Element): number | null {
  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return null;
  measureCtx.font = getComputedStyle(el).font;
  return measureCtx.measureText(text).width;
}

/**
 * One agent card (concept `.lane`): ring in the stage's colour with the card's number,
 * title, and a second line that says the most useful thing first (waiting on you, failed,
 * what it is doing or its next step, then working or idle time) with the quiet facts after
 * it (helpers, assistant, PR and checks): as many whole facts as fit beside the status,
 * the rest in the hover. Then the stage track and the elapsed time or "Hold to merge"
 * (only the card with the button takes the extra width, from the end of its track, so the
 * tracks start in line). Amber when it waits for you. The open action is a real button
 * stretched under the card's content (Tab reaches it, then "Hold to merge"); a click
 * anywhere on the card but the merge button opens the session and brings OmniGent forward,
 * when the helper says links are available. The title takes all the free width; hover
 * shows the whole of it. `asOf` ("as of 4 min ago") says the answer is stale.
 */
export function Lane({
  lane,
  num,
  canOpen,
  open,
  roomy,
  asOf = null,
  question = null,
  snoozedUntil = null,
  later,
}: {
  lane: LaneData;
  num: number;
  canOpen: boolean;
  open: (id: string) => void;
  roomy: boolean;
  asOf?: string | null;
  /** The helper's question for this session, when it waits on the owner. */
  question?: string | null;
  /** When "Later" quietened this waiting session on this display, the time it comes back. */
  snoozedUntil?: number | null;
  /** "Later": quieten this waiting session for 15 minutes. */
  later?: (id: string) => void;
}) {
  const tone = laneTone(lane);
  const snoozed = laneWaits(lane) && snoozedUntil !== null;
  const waits = laneWaits(lane) && !snoozed;
  const ready = mergeReady(lane);
  const failed = !waits && lane.failed === true;
  const glyph = waits ? 'ask' : failed ? 'failed' : tone === 'mint' ? 'check' : 'bolt';
  const asked = cardLine(lane, question);
  const line = snoozed ? { text: `Waiting on you, snoozed until ${clockText(snoozedUntil as number)}`, tone: '' as const } : asked;
  const elapsed = elapsedLabel(lane, Date.now());
  const meta = cardMeta(lane);
  const withButton = ready && canOpen;
  const lineRef = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(meta.length);
  const metaKey = meta.join('|');
  useLayoutEffect(() => {
    const el = lineRef.current;
    if (!el || roomy) return;
    const fit = () => {
      const avail = el.clientWidth;
      const status = el.querySelector('.s');
      const probe = el.querySelector('.lane-meta') ?? status;
      // No layout (tests) or no font to measure with: show every fact.
      if (avail === 0 || !status || !probe) return setFits(meta.length);
      const sw = textWidth(line.text, status);
      const ws = meta.map((m) => textWidth(m, probe));
      if (sw === null || ws.some((w) => w === null)) return setFits(meta.length);
      setFits(fitExtras(avail, sw, ws as number[]));
    };
    fit();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    ro?.observe(el);
    return () => ro?.disconnect();
    // `meta` is read through its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.text, metaKey, roomy]);
  const tap = canOpen ? () => open(lane.id) : undefined;
  return (
    <div
      className={`lane g${waits ? ' wait' : ''}${snoozed ? ' snoozed' : ''}${ready ? ' ready' : ''}${failed ? ' failed' : ''}${withButton && !waits ? ' has-btn' : ''}${waits ? ' has-ask' : ''}`}
      style={{ ['--c' as string]: `var(--st-${lane.stage})` }}
      data-id={lane.id}
      onClick={tap}
    >
      {canOpen && (
        <button
          type="button"
          className="lane-open"
          aria-label={`${num}. ${lane.title}: ${line.text}. Opens the session in OmniGent`}
          onClick={(e) => {
            e.stopPropagation();
            open(lane.id);
          }}
        />
      )}
      <LaneRing size={roomy ? 84 : 68} fraction={ringFraction(lane)} tone={waits ? 'amber' : failed ? 'red' : 'stage'} glyph={snoozed ? 'ask' : glyph} num={num} />
      <div className="lt">
        <div className="t2 ellipsis" {...tip(() => <CardTip lane={lane} line={snoozed ? `${line.text}. ${asked.text}` : line.text} meta={meta} canOpen={canOpen} asOf={asOf} />)}>
          {lane.title}
        </div>
        <div className="lt2" ref={lineRef}>
          {snoozed && <i className="snooze-dot" aria-hidden="true" />}
          <span className={`s ellipsis${line.tone ? ` t-${line.tone}` : ''}`}>{line.text}</span>
          {!roomy &&
            meta.map((m, i) => (
              <span key={m} className="xs lane-meta" hidden={i >= fits}>
                {m}
              </span>
            ))}
        </div>
        {roomy && meta.length > 0 && <div className="xs ellipsis lane-meta">{meta.join('  \u00b7  ')}</div>}
      </div>
      <StageTrack stage={lane.stage} mark={waits ? 'wait' : ''} />
      <div className="lm">
        {waits && canOpen ? (
          <div className="ask-acts">
            <button
              type="button"
              className="btn act amber"
              onClick={(e) => {
                e.stopPropagation();
                open(lane.id);
              }}
              {...tip('Open this chat in OmniGent')}
            >
              Open chat
            </button>
            {later && (
              <button
                type="button"
                className="btn act"
                onClick={(e) => {
                  e.stopPropagation();
                  later(lane.id);
                }}
                {...tip('Quiet this for 15 minutes on this display; it comes back by itself')}
              >
                Later
              </button>
            )}
          </div>
        ) : withButton ? (
          <HoldToMerge onHold={() => open(lane.id)} />
        ) : (
          <span className="s" {...tip(elapsed.tip)}>
            {elapsed.text}
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
