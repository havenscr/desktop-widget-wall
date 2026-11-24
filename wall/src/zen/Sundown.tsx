import { useEffect } from 'react';
import { moodsPollChange, useHome } from '../studio/homeStore';
import { createLightStepper, type LightDeps } from './lights';
import { sessionSecondsLeft } from './model';
import { sundownLabel } from './modes';

/** How often the session's progress is looked at for the next light step. */
export const LIGHT_TICK_MS = 1000;

/** The real home app behind the stepper: the last moods read says whether an Office mood is on, and a nudge counts only when the level moved. */
export function homeLightDeps(): LightDeps {
  return {
    officeMoodOn: () => {
      const m = useHome.getState().moods;
      return !!m && !m.stale && m.canWrite && m.nudge !== null;
    },
    nudge: async (dir) => {
      const before = useHome.getState().moods?.nudge?.level;
      if (before === undefined) return false;
      await useHome.getState().nudgeMood(dir);
      const s = useHome.getState();
      const after = s.moods?.nudge?.level;
      if (s.moodFail !== null || after === undefined) return false;
      return dir === 'down' ? after < before : after > before;
    },
  };
}

export interface SundownProps {
  startedAt: number;
  minutes: number;
  /** Seconds left, for the caption. */
  left: string;
  /** The "dim the office too" setting. Off: nothing here ever talks to the lights. */
  lights: boolean;
  now?: () => number;
  /** Test seam: the lights behind the stepper. */
  deps?: LightDeps;
}

/**
 * Sundown's caption, and (only with the lights setting on) the stepping of the Office lights down over the session.
 * It lives exactly as long as the session: unmounting early steps the lights back up by the steps taken, and
 * unmounting after the full length leaves them down.
 */
export function Sundown({ startedAt, minutes, left, lights, now = Date.now, deps }: SundownProps) {
  useEffect(() => {
    if (!lights) return;
    const stepper = createLightStepper(deps ?? homeLightDeps());
    if (!deps) moodsPollChange(1);
    const span = minutes * 60_000;
    const tick = () => stepper.tick(Math.min(1, Math.max(0, (now() - startedAt) / span)));
    tick();
    const id = window.setInterval(tick, LIGHT_TICK_MS);
    return () => {
      window.clearInterval(id);
      if (sessionSecondsLeft(startedAt, minutes, now()) <= 0) stepper.finish();
      else void stepper.leaveEarly();
      if (!deps) moodsPollChange(-1);
    };
  }, [lights, startedAt, minutes, now, deps]);

  return (
    <>
      <div className="zen-cap">{sundownLabel(minutes)}</div>
      <div className="zen-left">{left}</div>
    </>
  );
}
