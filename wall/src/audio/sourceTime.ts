/**
 * Source times for `audio-levels` frames. The event carries no capture time or sequence
 * number, and frames that queue up behind a stalled web view arrive in a burst, all stamped
 * with the same callback time. Fed those stamps, the beat detector could confirm a beat with no
 * lag, start a band late, or swallow the next real beat. So each frame gets a source time:
 *
 * - a frame that arrives less than `BURST_MS` after the previous one belongs to a burst: its time
 *   is the previous source time plus `FRAME_MS` (Rust sends one frame every 33 ms);
 * - otherwise its arrival time, unless the clock is still ahead after a burst: then the previous
 *   source time plus the real arrival interval, capped at `FRAME_MS`. Time never runs backwards,
 *   spacing stays true, and the lead shrinks whenever frames come slower than 33 ms apart;
 * - a frame whose source time would run more than `MAX_AHEAD_MS` ahead of its arrival is
 *   dropped (null).
 */

/** Rust's push period. */
export const FRAME_MS = 33;
/** Frames closer together than this arrived in a burst. */
export const BURST_MS = 16;
/** Source time may run at most this far ahead of the arrival clock. */
export const MAX_AHEAD_MS = 200;

export interface SourceClock {
  /** The source time for a frame arriving at `arrival` (ms, steady clock), or null to drop it. */
  stamp(arrival: number): number | null;
  /** Forget the history (a capture restart). */
  reset(): void;
}

export function createSourceClock(): SourceClock {
  let prevArrival = -Infinity;
  let prevSource = -Infinity;
  return {
    stamp(arrival) {
      const gap = arrival - prevArrival;
      prevArrival = arrival;
      const t = gap < BURST_MS ? prevSource + FRAME_MS : Math.max(arrival, prevSource + Math.min(gap, FRAME_MS));
      if (t - arrival > MAX_AHEAD_MS) return null;
      prevSource = t;
      return t;
    },
    reset() {
      prevArrival = -Infinity;
      prevSource = -Infinity;
    },
  };
}
