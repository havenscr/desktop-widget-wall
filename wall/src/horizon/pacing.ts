/** Smallest gap between drawn frames in milliseconds: about 30 frames a second (31, not 33, so 60 Hz timestamps never skip a pair). */
export const MIN_FRAME_MS = 31;

/** Longest step in seconds a single frame may advance the animation (a stalled tab must not jump). */
export const MAX_STEP_S = 0.1;

/** True when a frame at `now` (ms) should be drawn: the page is visible and enough time has passed since `last`. */
export function shouldDraw(now: number, last: number, hidden: boolean, minMs = MIN_FRAME_MS): boolean {
  return !hidden && now - last >= minMs;
}

/** Seconds since the last drawn frame, capped at `MAX_STEP_S`. */
export function frameDelta(now: number, last: number): number {
  return Math.min(MAX_STEP_S, Math.max(0, (now - last) / 1000));
}
