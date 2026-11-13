import { IconCalendar } from '@tabler/icons-react';
import { useEffect, useState, type ReactNode } from 'react';
import { agentsStale, useAgents } from '../agents/useAgents';
import { laneWaits, needsYouCount } from '../agents/model';
import { SheepSvg } from '../buddy/Watt';
import { SPRITES, SPRITE_PX } from '../buddy/sprites';
import { formatClock } from '../clock/format';
import { MOODS_CACHE_KEY, moodLabel } from '../home/Moods';
import { tomorrowTime } from '../unwind/model';
import { readMark } from '../unwind/RoomCard';
import { clockTime, useTomorrow } from '../unwind/Tomorrow';
import { dreamStatusText, driftOffset, DRIFT_TICK_MS } from './model';

/** Where Watt sleeps, in stage pixels (left edge and ground line). */
export const DREAM_SHEEP = { x: 1226, base: 688 } as const;

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
  // The same rule as Work: a lane that waits on the owner is not working.
  const working = fresh ? st.summary!.lanes.filter((l) => !laneWaits(l) && l.state === 'working').length : null;
  const needs = fresh ? needsYouCount(st.summary!) : null;
  const text = dreamStatusText(working, needs, onMoodLabel(now().getTime()));
  if (!text) return null;
  return <div className="dream-status">{text}</div>;
}

/** True when the system asks for reduced motion. */
function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * One layer holding all of Dream's text. It moves by `transform` alone along a slow closed path
 * (see `driftOffset`), so no pixel of text stays lit for hours on an OLED panel and nothing
 * else moves. Under reduced motion it moves in a few small discrete steps many minutes apart.
 */
export function DreamDrift({ now, children }: { now: () => Date; children: ReactNode }) {
  const [at, setAt] = useState(() => now().getTime());
  useEffect(() => {
    const id = window.setInterval(() => setAt(now().getTime()), DRIFT_TICK_MS);
    return () => window.clearInterval(id);
  }, [now]);
  const reduced = reducedMotion();
  const o = driftOffset(at, reduced);
  return (
    <div className={`dream-drift${reduced ? ' stepped' : ''}`} style={{ transform: `translate(${o.x}px, ${o.y}px)` }}>
      {children}
    </div>
  );
}

/**
 * Dream: the breathing guide is gone, flames are dimmed (by `Flames`), a large thin clock at left centre
 * with the date under it, tomorrow's first meeting at right centre, a quiet status line along the bottom
 * left, and Watt asleep in the corner with z's drifting up. A click wakes back to Zen.
 * Everything is dim, and all the text drifts slowly (burn-in).
 */
export function Dream({ onWake, now = systemNow }: { onWake: () => void; now?: () => Date }) {
  const [parts, setParts] = useState(() => formatClock(now()));
  useEffect(() => {
    const id = window.setInterval(() => setParts(formatClock(now())), 15_000);
    return () => window.clearInterval(id);
  }, [now]);
  const h = SPRITES.sleep.length * SPRITE_PX;
  return (
    <div
      className="dream"
      role="button"
      tabIndex={0}
      aria-label="Wake"
      onClick={onWake}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onWake();
        }
      }}
    >
      <DreamDrift now={now}>
        <div className="dream-clock">
          {parts.time}
          <small>{parts.meridiem}</small>
        </div>
        <div className="dream-date">{parts.date}</div>
        <DreamTomorrow now={now} />
        <DreamStatus now={now} />
        <div className="dream-hint">Click anywhere to wake</div>
      </DreamDrift>
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
