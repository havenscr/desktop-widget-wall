import { IconCalendar } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { agentsStale, useAgents } from '../agents/useAgents';
import { needsYouCount } from '../agents/model';
import { SheepSvg } from '../buddy/Watt';
import { SPRITES, SPRITE_PX } from '../buddy/sprites';
import { formatClock } from '../clock/format';
import { MOODS_CACHE_KEY, moodLabel } from '../home/Moods';
import { tomorrowTime } from '../unwind/model';
import { readMark } from '../unwind/RoomCard';
import { clockTime, useTomorrow } from '../unwind/Tomorrow';
import { dreamStatusText } from './model';

/** Where Watt sleeps, in stage pixels (left edge and ground line). */
export const DREAM_SHEEP = { x: 1226, base: 688 } as const;

/** The mouse must travel this far (px) after Dream appears before it counts as waking it. */
export const WAKE_MOVE_PX = 40;
/** Mouse movement in this long after Dream appears is ignored (the click that opened it, a settling hand). */
export const WAKE_GRACE_MS = 1500;

const systemNow = () => new Date();

/** The label of the mood that is on now, only when this wall applied one in the last three hours (the Room card's source). */
function onMoodLabel(nowMs: number): string | null {
  const mark = readMark(nowMs);
  if (!mark) return null;
  let label: string | null = null;
  try {
    const list = JSON.parse(localStorage.getItem(MOODS_CACHE_KEY) ?? '[]') as { id?: unknown; label?: unknown }[];
    const hit = Array.isArray(list) ? list.find((m) => m && m.id === mark.id && typeof m.label === 'string') : undefined;
    label = hit ? String(hit.label) : null;
  } catch {
    label = null;
  }
  return label || moodLabel({ id: mark.id, label: '' });
}

/** Tomorrow's first meeting, at right centre; says so in one line when the calendar cannot be read, and nothing when tomorrow is clear. */
function DreamTomorrow({ now }: { now: () => Date }) {
  const t = useTomorrow(() => now().getTime());
  if (!t) return null;
  return (
    <div className="dream-card" aria-label="Tomorrow">
      <div className="dream-k">Tomorrow</div>
      {t.kind === 'unavailable' ? (
        <div className="dream-row">Calendar not available</div>
      ) : (
        <div className="dream-row">
          <IconCalendar size={22} stroke={1.6} aria-hidden="true" />
          <span className="dream-ell">
            {tomorrowTime(Date.parse(t.first.start))}, {t.first.title}
          </span>
          {t.asOf !== null && <span className="dream-asof">as of {clockTime(t.asOf)}</span>}
        </div>
      )}
    </div>
  );
}

/** Bottom left: agents still working and whether one needs the owner (only from a fresh helper answer), and the lights mood that is on. */
function DreamStatus({ now }: { now: () => Date }) {
  const st = useAgents();
  const fresh = st.status === 'ready' && st.summary !== null && !agentsStale(st);
  const working = fresh ? st.summary!.lanes.filter((l) => l.state === 'working').length : null;
  const needs = fresh ? needsYouCount(st.summary!) : null;
  const text = dreamStatusText(working, needs, onMoodLabel(now().getTime()));
  if (!text) return null;
  return <div className="dream-status">{text}</div>;
}

/**
 * Dream: the breathing guide is gone, flames are dimmed (by `Flames`), a large thin clock at left centre
 * with the date under it, tomorrow's first meeting at right centre, a quiet status line along the bottom
 * left, and Watt asleep in the corner with z's drifting up. A click, or moving the mouse a little, wakes
 * back to Zen. Everything is dim and still: no element is bright (burn-in).
 */
export function Dream({ onWake, now = systemNow }: { onWake: () => void; now?: () => Date }) {
  const [parts, setParts] = useState(() => formatClock(now()));
  useEffect(() => {
    const id = window.setInterval(() => setParts(formatClock(now())), 15_000);
    return () => window.clearInterval(id);
  }, [now]);
  // Moving the mouse wakes it, but only a real move: after the grace time, and by more than a few pixels.
  const born = useRef(Date.now());
  const from = useRef<{ x: number; y: number } | null>(null);
  const h = SPRITES.sleep.length * SPRITE_PX;
  return (
    <div
      className="dream"
      role="button"
      tabIndex={0}
      aria-label="Wake"
      onClick={onWake}
      onMouseMove={(e) => {
        if (Date.now() - born.current < WAKE_GRACE_MS) return;
        const p = { x: e.clientX, y: e.clientY };
        if (!from.current) {
          from.current = p;
          return;
        }
        if (Math.hypot(p.x - from.current.x, p.y - from.current.y) >= WAKE_MOVE_PX) onWake();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onWake();
        }
      }}
    >
      <div className="dream-clock">
        {parts.time}
        <small>{parts.meridiem}</small>
      </div>
      <div className="dream-date">{parts.date}</div>
      <DreamTomorrow now={now} />
      <DreamStatus now={now} />
      <div className="dream-hint">Move the mouse or click to wake</div>
      <div className="dream-watt" aria-hidden="true" style={{ left: DREAM_SHEEP.x, top: DREAM_SHEEP.base - h }}>
        <div className="dream-bob">
          <SheepSvg pose="sleep" />
        </div>
        <span className="dream-z">z</span>
        <span className="dream-z sm">z</span>
      </div>
    </div>
  );
}
