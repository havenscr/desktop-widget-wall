import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { tip } from '../ui/HoverTip';
import type { Side } from './keyLights';
import { useKeyLights } from './store';

/**
 * A slider for a pointer: a 6 px track in a 26 px high hit area, a 20 px thumb.
 *
 * The number beside it and its ARIA value are always what the light last reported. The thumb is a
 * promise of that, and says where it was asked to go: it follows the pointer only while the button is
 * down or a key is held, and stays at the requested place only while a write is out. On letting go
 * with nothing in flight it goes to the reported value at once; otherwise when the write settles.
 * `down` is a light that does not answer: dim, grey thumb, no value, nothing to drag.
 */
export function Slider({
  label,
  icon,
  value,
  min,
  max,
  step,
  format,
  onInput,
  warm = false,
  down = false,
  sides,
  tipText,
  floor,
  busyCount,
  throttleMs,
}: {
  label: string;
  icon: ReactNode;
  /** What the light reported last. */
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onInput: (v: number) => void;
  warm?: boolean;
  down?: boolean;
  /** The lights this slider sets. It waits only on writes to these; without it, on every write. */
  sides?: readonly Side[];
  tipText: string;
  /** A comfort floor (same unit as the value): the part under it is hatched, marked, and the slider stops at it. */
  floor?: number;
  /** Writes in flight for this slider when it is not a key light slider (a room light). */
  busyCount?: number;
  /**
   * Sends at most one `onInput` per this many ms while the pointer or a key moves it (the first at once, then the
   * newest value each period), and on release sends the exact final value if it has not gone yet.
   */
  throttleMs?: number;
}) {
  const keyBusy = useKeyLights((s) => (sides ? sides.reduce((n, side) => n + s.busySides[side], 0) : s.busy));
  const busy = busyCount ?? keyBusy;
  // Where the thumb was asked to go, and whether the pointer or a key is working it now.
  const [asked, setAsked] = useState<number | null>(null);
  const [active, setActive] = useState(false);
  const track = useRef<HTMLSpanElement>(null);

  const pending = busy > 0;
  const following = asked !== null && (active || pending);
  const lowest = Math.max(min, floor ?? min);
  const thumb = Math.min(max, Math.max(lowest, following ? (asked as number) : value));
  const frac = (thumb - min) / (max - min);
  const floorFrac = floor !== undefined && floor > min ? (floor - min) / (max - min) : 0;
  const reported = Math.min(max, Math.max(min, value));

  // The throttle: when the last value went, the newest value waiting, and its timer.
  const sentAt = useRef(0);
  const waiting = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const out = useRef(onInput);
  out.current = onInput;
  const emit = (v: number) => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    waiting.current = null;
    sentAt.current = Date.now();
    out.current(v);
  };
  const send = (v: number) => {
    if (!throttleMs) return out.current(v);
    const wait = sentAt.current + throttleMs - Date.now();
    if (wait <= 0) return emit(v);
    waiting.current = v;
    if (timer.current === null) {
      timer.current = setTimeout(() => {
        timer.current = null;
        if (waiting.current !== null) emit(waiting.current);
      }, wait);
    }
  };
  // Letting go (pointer up, key up, focus leaving): the exact value goes now if it is still waiting.
  const release = () => {
    setActive(false);
    if (waiting.current !== null) emit(waiting.current);
  };
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const request = (v: number) => {
    const next = Math.min(max, Math.max(floor ?? min, min, Math.round(v / step) * step));
    if (next === asked && following) return;
    setAsked(next);
    send(next);
  };
  const at = (e: PointerEvent) => {
    const r = track.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    request(min + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (max - min));
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setActive(true);
      request(e.key === 'Home' ? min : max);
      return;
    }
    const big = e.key === 'PageUp' || e.key === 'PageDown';
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'PageUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'PageDown' ? -1 : 0;
    if (delta === 0) return;
    e.preventDefault();
    setActive(true);
    request(thumb + delta * step * (big ? 10 : 1));
  };
  // A new answer for a thumb nobody is moving and no write waits on: nothing to hold.
  useEffect(() => {
    if (!active && !pending) setAsked(null);
  }, [active, pending]);

  const hoverTip = tip(down ? `${label}: this light is not answering` : tipText);
  const text = down ? 'not answering' : following && thumb !== reported ? `setting to ${format(thumb)}, the light reports ${format(reported)}` : format(reported);
  return (
    <div className={`st-srow${down ? ' down' : ''}`}>
      <span className="st-srow-ico" aria-hidden="true">
        {icon}
      </span>
      <span
        ref={track}
        className={`st-sl${warm ? ' warm' : ''}${down ? ' down' : ''}`}
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={down ? undefined : reported}
        aria-valuetext={text}
        aria-disabled={down || undefined}
        tabIndex={down ? -1 : 0}
        onPointerDown={(e) => {
          if (down || e.button !== 0) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          setActive(true);
          at(e);
        }}
        onPointerMove={(e) => active && at(e)}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onKeyDown={down ? undefined : key}
        // A key held down repeats: the thumb follows until it comes up, or focus leaves.
        onKeyUp={release}
        {...hoverTip}
        onBlur={() => {
          release();
          hoverTip.onBlur();
        }}
      >
        <i className="st-tr" />
        {floor !== undefined && floor > min && (
          <>
            <i className="st-hatch" style={{ width: `${((floor - min) / (max - min)) * 100}%` }} />
            <i className="st-floor" style={{ left: `${((floor - min) / (max - min)) * 100}%` }} />
          </>
        )}
        {/* The fill starts at the floor when there is one: the part under it stays hatched. */}
        {!warm && !down && <i className="st-fi" style={{ left: `${floorFrac * 100}%`, width: `${Math.max(0, frac - floorFrac) * 100}%` }} />}
        <i className="st-th" style={{ left: `${frac * 100}%` }} />
      </span>
      <span className="st-val">{down ? '' : format(reported)}</span>
    </div>
  );
}
