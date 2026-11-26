import { MIN_FRAME_MS, frameDelta, shouldDraw } from '../horizon/pacing';

/** The browser pieces the loop uses, so tests can drive it by hand. */
export interface LoopHost {
  raf(cb: (ts: number) => void): number;
  caf(id: number): void;
  hidden(): boolean;
}

export const browserHost: LoopHost = {
  raf: (cb) => requestAnimationFrame(cb),
  caf: (id) => cancelAnimationFrame(id),
  hidden: () => document.hidden,
};

/** Frame gap when the loop has fallen behind its budget: 20 frames a second. */
export const DEGRADED_FRAME_MS = 50;
/** The frame's mean cost over `PROBE_WINDOW_MS` above this drops the loop to 20 fps and turns the grain off. */
export const DEGRADE_MS = 4;
export const PROBE_WINDOW_MS = 5000;

/** Mean frame cost over a window, and the one time it passes the budget. */
export interface Probe {
  meanMs: number;
  degraded: boolean;
  add(ms: number, nowMs: number): void;
}

export function createProbe(onDegrade?: () => void): Probe {
  let sum = 0;
  let n = 0;
  let since = -1;
  const p: Probe = {
    meanMs: 0,
    degraded: false,
    add(ms, nowMs) {
      if (since < 0) since = nowMs;
      sum += ms;
      n++;
      if (nowMs - since < PROBE_WINDOW_MS) return;
      p.meanMs = sum / n;
      if (p.meanMs > DEGRADE_MS && !p.degraded) {
        p.degraded = true;
        onDegrade?.();
      }
      sum = 0;
      n = 0;
      since = nowMs;
    },
  };
  return p;
}

export interface Loop {
  /** Start running if stopped (sound arrived, a setting changed, the page came back). */
  kick(): void;
  stop(): void;
  readonly running: boolean;
}

/**
 * One rAF loop for the vibe layer. It calls `frame(ts, dt)` at most about 30 times a second
 * (`pacing.ts`) and stops by itself when `frame` returns false (nothing left to draw), when the page
 * is hidden, or on `stop()`. `kick()` starts it again. Nothing is allocated per frame.
 */
export function createLoop(host: LoopHost, frame: (ts: number, dt: number) => boolean, minMs: () => number = () => MIN_FRAME_MS): Loop {
  let id = 0;
  let running = false;
  let last = -Infinity;
  const tick = (ts: number): void => {
    id = 0;
    if (!running) return;
    if (host.hidden()) {
      running = false;
      return;
    }
    if (shouldDraw(ts, last, false, minMs())) {
      const dt = frameDelta(ts, last === -Infinity ? ts - MIN_FRAME_MS : last);
      last = ts;
      if (!frame(ts, dt)) {
        running = false;
        return;
      }
    }
    id = host.raf(tick);
  };
  return {
    kick() {
      if (running || host.hidden()) return;
      running = true;
      last = -Infinity;
      id = host.raf(tick);
    },
    stop() {
      running = false;
      if (id) host.caf(id);
      id = 0;
    },
    get running() {
      return running;
    },
  };
}
