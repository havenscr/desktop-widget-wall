import { useEffect, useState } from 'react';
import { CAMERAS } from '../horizon/cameras';
import { SUMMIT_PEAK, climbPoint, peakX, skylineY, summitLabel } from './modes';

/** The lantern is moved this often. A CSS transition of the same length makes the walk smooth: there is no frame loop. */
export const LANTERN_TICK_MS = 1000;
/** The peak's name fades in once the climb is this far along. */
export const NAME_AT = 0.85;
/** Gap between two lights on the summit, in stage pixels. */
const LIGHT_GAP_PX = 24;

const CAM = CAMERAS.unwind;
/** Sub pixel steps, so one second of a long climb still moves the lantern. */
const r2 = (n: number): number => Math.round(n * 100) / 100;

export interface SummitSceneProps {
  /** Focus session in progress: when it ends and how long it is (ms). Null on the start screen. */
  session: { endAt: number; minutes: number } | null;
  /** Lights for today's finished sessions (0 to 8). */
  lights: number;
  now?: () => number;
}

/** How far through the session it is (0 to 1) at `at`. */
export function climbProgress(endAt: number, minutes: number, at: number): number {
  const total = minutes * 60_000;
  return total <= 0 ? 1 : Math.min(1, Math.max(0, 1 - (endAt - at) / total));
}

/**
 * Summit's picture on the Unwind camera: a lantern on the skyline walking up to The Brothers, the peak's name near the top, and one
 * small light on the summit for each focus session finished today. The lantern is one element moved once a second.
 */
export function SummitScene({ session, lights, now = Date.now }: SummitSceneProps) {
  const [progress, setProgress] = useState(() => (session ? climbProgress(session.endAt, session.minutes, now()) : 0));
  useEffect(() => {
    if (!session) return;
    const tick = () => setProgress(climbProgress(session.endAt, session.minutes, now()));
    tick();
    const id = window.setInterval(tick, LANTERN_TICK_MS);
    return () => window.clearInterval(id);
  }, [session, now]);

  const px = peakX(CAM);
  const top = skylineY(CAM, px);
  const spot = climbPoint(progress, CAM);
  const dots: number[] = [];
  for (let i = 0; i < lights; i++) dots.push(px + (i - (lights - 1) / 2) * LIGHT_GAP_PX);
  return (
    <div className="summit" aria-hidden="true">
      {dots.map((x, i) => (
        <i key={i} className="summit-light" style={{ transform: `translate(${Math.round(x)}px, ${Math.round(top - 6)}px)` }} />
      ))}
      <div className={`summit-name${session && progress >= NAME_AT ? ' on' : ''}`} style={{ transform: `translate(${Math.round(px)}px, ${Math.round(top - 54)}px)` }}>
        <span>{SUMMIT_PEAK}</span>
      </div>
      {session && <i className="summit-lantern" style={{ transform: `translate(${r2(spot.x)}px, ${r2(spot.y)}px)` }} />}
    </div>
  );
}

export interface SummitCaptionProps {
  minutes: number;
  /** "12:34." */
  left: string;
  /** Lights shown for today's finished sessions. */
  lights: number;
}

/** The words under the climb: the session's length, the time left, and today's count. */
export function SummitCaption({ minutes, left, lights }: SummitCaptionProps) {
  return (
    <>
      <div className="zen-cap">{summitLabel(minutes)}</div>
      <div className="zen-left">{left}</div>
      {lights > 0 && <div className="zen-count">{lights === 1 ? '1 climb finished today.' : `${lights} climbs finished today.`}</div>}
    </>
  );
}
