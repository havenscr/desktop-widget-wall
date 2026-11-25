import { LIGHT_MARKS, MAX_LIGHT_STEPS } from './modes';

/** What the stepper needs from the home app. Kept apart so the rules can be tested without it. */
export interface LightDeps {
  /** True only while the last moods read shows an Office mood on and fresh. */
  officeMoodOn: () => boolean;
  /** One nudge. Resolves true when the lights moved, false when it was refused or ignored. Never rejects. */
  nudge: (dir: 'up' | 'down') => Promise<boolean>;
}

export interface LightStepper {
  /** Called with the session's progress (0 to 1) as it runs; steps down at 25, 50 and 75 percent. */
  tick: (progress: number) => void;
  /** The session was left early: steps back up by the steps taken. */
  leaveEarly: () => Promise<void>;
  /** The session ran to the end: the lights stay down. */
  finish: () => void;
  /** Steps taken so far. */
  readonly taken: number;
}

/**
 * The Office lights stepping for Sundown. Safe by construction:
 * it acts only when an Office mood is on, takes at most three steps, a refusal is silent and ends the stepping,
 * and leaving early steps back up by the steps taken. Failures never throw and nothing is shown.
 */
export function createLightStepper(deps: LightDeps): LightStepper {
  let taken = 0;
  let marks = 0;
  let ended = false;
  let chain: Promise<void> = Promise.resolve();

  const step = async (): Promise<void> => {
    if (ended || taken >= MAX_LIGHT_STEPS) return;
    if (!deps.officeMoodOn()) return;
    let moved = false;
    try {
      moved = await deps.nudge('down');
    } catch {
      moved = false;
    }
    if (moved) taken += 1;
    else ended = true;
  };

  return {
    tick(progress) {
      while (marks < MAX_LIGHT_STEPS && progress >= LIGHT_MARKS[marks]) {
        marks += 1;
        if (ended) continue;
        chain = chain.then(step);
      }
    },
    async leaveEarly() {
      await chain;
      const back = taken;
      taken = 0;
      ended = true;
      for (let i = 0; i < back; i++) {
        if (!deps.officeMoodOn()) break;
        let moved = false;
        try {
          moved = await deps.nudge('up');
        } catch {
          moved = false;
        }
        if (!moved) break;
      }
    },
    finish() {
      ended = true;
    },
    get taken() {
      return taken;
    },
  };
}
