import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { tip } from '../ui/HoverTip';
import { useKeyLights } from './store';

/**
 * A slider for a pointer: a 6 px track in a 26 px high hit area, a 20 px thumb. It shows the value
 * dragged to while the pointer works it, then keeps showing it until the write's answer is in, and
 * from then on only what the light reported. `down` is a light that does not answer: dim, grey thumb,
 * no value, nothing to drag.
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
  tipText,
}: {
  label: string;
  icon: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onInput: (v: number) => void;
  warm?: boolean;
  down?: boolean;
  tipText: string;
}) {
  const settled = useKeyLights((s) => s.settled);
  const [held, setHeld] = useState<number | null>(null);
  const dragging = useRef(false);
  const track = useRef<HTMLSpanElement>(null);
  // A finished write lets go of the dragged value: from here the slider shows what the light reports.
  useEffect(() => {
    if (!dragging.current) setHeld(null);
  }, [settled]);

  const shown = Math.min(max, Math.max(min, held ?? value));
  const frac = (shown - min) / (max - min);
  const move = (v: number) => {
    const next = Math.min(max, Math.max(min, Math.round(v / step) * step));
    if (next === shown && held === null) return;
    setHeld(next);
    if (next !== held) onInput(next);
  };
  const at = (e: PointerEvent) => {
    const r = track.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    move(min + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (max - min));
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      move(e.key === 'Home' ? min : max);
      return;
    }
    const big = e.key === 'PageUp' || e.key === 'PageDown';
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'PageUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'PageDown' ? -1 : 0;
    if (delta === 0) return;
    e.preventDefault();
    move(shown + delta * step * (big ? 10 : 1));
  };

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
        aria-valuenow={down ? undefined : shown}
        aria-valuetext={down ? 'not answering' : format(shown)}
        aria-disabled={down || undefined}
        tabIndex={down ? -1 : 0}
        onPointerDown={(e) => {
          if (down || e.button !== 0) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          dragging.current = true;
          at(e);
        }}
        onPointerMove={(e) => dragging.current && at(e)}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        onKeyDown={down ? undefined : key}
        {...tip(down ? `${label}: this light is not answering` : tipText)}
      >
        <i className="st-tr" />
        {!warm && !down && <i className="st-fi" style={{ width: `${frac * 100}%` }} />}
        <i className="st-th" style={{ left: `${frac * 100}%` }} />
      </span>
      <span className="st-val">{down ? '' : format(shown)}</span>
    </div>
  );
}
