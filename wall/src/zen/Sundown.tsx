import { useEffect, type RefObject } from 'react';
import { moodsPollChange, useHome } from '../studio/homeStore';
import { createLightStepper, type LightDeps } from './lights';
import { sundownLabel } from './modes';

/** How often the session's progress is looked at for the next light step. */
export const LIGHT_TICK_MS = 1000;

/** How long a nudge waits for a mood write already in flight before it gives up (ms). */
export const WRITE_WAIT_MS = 20_000;

/** Resolves true when no home write is running (now or soon), false after `WRITE_WAIT_MS`. */
function homeIdle(): Promise<boolean> {
  if (useHome.getState().applying === null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      unsub();
      clearTimeout(timer);
      resolve(ok);
    };
    const unsub = useHome.subscribe((st) => {
      if (st.applying === null) done(true);
    });
    const timer = setTimeout(() => done(false), WRITE_WAIT_MS);
  });
}

/**
 * The real home app behind the stepper: the last moods read says whether an Office mood is on, and a nudge counts only when the level it
 * was sent for moved. Each nudge is judged by its own result: it waits for any write in flight (the store skips a nudge sent behind one),
 * tries once more if it was skipped anyway, and never reads a failure note left by an earlier write.
 */
export function homeLightDeps(): LightDeps {
  return {
    officeMoodOn: () => {
      const m = useHome.getState().moods;
      return !!m && !m.stale && m.canWrite && m.nudge !== null;
    },
    nudge: async (dir) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!(await homeIdle())) return false;
        const before = useHome.getState().moods?.nudge?.level;
        if (before === undefined) return false;
        await useHome.getState().nudgeMood(dir);
        const after = useHome.getState().moods?.nudge?.level;
        if (after !== undefined && (dir === 'down' ? after < before : after > before)) return true;
        // Not moved. Refused, or skipped behind a write that started in the gap: only the second case is tried again.
        if (useHome.getState().applying === null) return false;
      }
      return false;
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
  /** Set by Zen when the session ran to the end and Dream opened. Any other unmount (a tap, Leave) is leaving early, even in the closing moment. */
  doneRef?: RefObject<boolean>;
  /** Test seam: the lights behind the stepper. */
  deps?: LightDeps;
}

/**
 * Sundown's caption, and (only with the lights setting on) the stepping of the Office lights down over the session.
 * It lives exactly as long as the session: unmounting early steps the lights back up by the steps taken, and
 * unmounting after the full length leaves them down.
 */
export function Sundown({ startedAt, minutes, left, lights, now = Date.now, doneRef, deps }: SundownProps) {
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
      if (doneRef?.current) {
        stepper.finish();
        if (!deps) moodsPollChange(-1);
      } else void stepper.leaveEarly().finally(() => (deps ? undefined : moodsPollChange(-1)));
    };
  }, [lights, startedAt, minutes, now, deps, doneRef]);

  return (
    <>
      <div className="zen-cap">{sundownLabel(minutes)}</div>
      <div className="zen-left">{left}</div>
    </>
  );
}
