import { useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { tip } from '../ui/HoverTip';
import { formatTime } from '../music/model';

const STEP_S = 5;

interface Props {
  /** Where the track is, in seconds. */
  position: number;
  /** The track's length in seconds (more than zero). */
  duration: number;
  /** Names the track on the bar now; a press is dropped when it has changed by the time it lands. */
  guard: string;
  /** Called with the chosen second. Absent or `enabled` false: the bar only shows progress. */
  onSeek?: (seconds: number, guard: string) => void;
  enabled: boolean;
}

/**
 * The Listen time bar: the Watch bar's look (a 32 px tall hit area around the visible line, a marker on hover) with
 * a click or a drag to jump, the arrow keys (5 s), Home and End. Without `enabled` it is a plain progress bar: no
 * handlers, `aria-disabled`.
 */
export function SeekBar({ position, duration, guard, onSeek, enabled }: Props) {
  const [drag, setDrag] = useState<number | null>(null);
  const pressed = useRef<string | null>(null);
  const moved = useRef(false);
  const shown = drag ?? position;
  const frac = Math.min(1, Math.max(0, shown / duration));
  const fill = { ['--f' as string]: frac.toFixed(4) };
  const text = `${formatTime(shown)} of ${formatTime(duration)}`;

  if (!enabled || !onSeek) {
    return (
      <div
        className="w-bar u-seek off"
        role="progressbar"
        aria-label="Track position"
        aria-disabled="true"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(position)}
        aria-valuetext={text}
        style={fill}
        {...tip('This app does not let the wall jump to a point.')}
      >
        <b style={{ width: `${(frac * 100).toFixed(2)}%` }} />
      </div>
    );
  }

  const at = (e: { clientX: number; currentTarget: HTMLElement }) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (!box.width) return null;
    return Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) * duration;
  };
  const commit = (seconds: number) => {
    const g = pressed.current ?? guard;
    pressed.current = null;
    onSeek(Math.floor(seconds), g);
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    pressed.current = guard;
    moved.current = false;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // A pointer that is already gone cannot be captured; the click still works.
    }
    setDrag(null);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (pressed.current === null || !(e.buttons & 1)) return;
    const s = at(e);
    if (s === null) return;
    moved.current = true;
    setDrag(s);
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (pressed.current === null) return;
    if (!moved.current) return; // a plain press: the click that follows seeks
    const s = at(e);
    setDrag(null);
    if (s === null) pressed.current = null;
    else commit(s);
  };
  const click = (e: MouseEvent<HTMLDivElement>) => {
    if (moved.current) {
      moved.current = false; // the drag already landed
      return;
    }
    const s = at(e);
    if (s !== null) commit(s);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    let to: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') to = position + STEP_S;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') to = position - STEP_S;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = duration;
    if (to === null) return;
    e.preventDefault();
    onSeek(Math.floor(Math.min(duration, Math.max(0, to))), guard);
  };

  return (
    <div
      className="w-bar u-seek"
      role="slider"
      tabIndex={0}
      aria-label="Track position"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={text}
      style={fill}
      {...tip('Click or drag to jump to a point. Arrow keys move 5 seconds.')}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => {
        pressed.current = null;
        moved.current = false;
        setDrag(null);
      }}
      onClick={click}
      onKeyDown={key}
    >
      <b style={{ width: `${(frac * 100).toFixed(2)}%` }} />
      <i className="w-mark" aria-hidden="true" />
    </div>
  );
}
