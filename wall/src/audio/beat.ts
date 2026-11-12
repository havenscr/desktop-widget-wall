/**
 * Beat (kick) detection from the low spectrum bands of the `audio-levels` event.
 *
 * Each event carries 32 log-spaced bands from 20 Hz to 16 kHz, normalised here to 0 to 1
 * over -70 to -10 dB. The detector sums the power of the low bands (`BEAT_BANDS`, 20 to
 * about 245 Hz) into one level in dB and looks for a sudden rise: an onset is a frame that
 * rises above the previous one and clears an adaptive threshold, the median low level of the
 * last second plus `ONSET_DB` (9 dB). A kick then holds up while it decays, so the onset only counts
 * once the next `CONFIRM_FRAMES` frames all stay `HOLD_DB` above that median; a lone noisy
 * frame drops straight back and is ignored. Beats are about `MIN_BEAT_GAP_MS` (340 ms) apart,
 * with two frames of slack (`BEAT_GAP_TOLERANCE_MS`, so 274 ms), and never more than three inside
 * any second (`CALM_WINDOW_MS`): a beat is refused when it would be the fourth in a second. Both
 * rules hold on both clocks a frame carries: onsets in source time (`now`, see `sourceTime.ts`),
 * and the frame that confirms a beat on the arrival clock. Source time can run up to 200 ms ahead
 * of arrival after a stall, so rules kept in source time alone let four beats land inside one
 * real second; and the slack keeps a steady 170 BPM kick (353 ms, on a 33 ms frame grid and
 * with 15 ms of arrival jitter) from losing beats.
 * Everything is time based (milliseconds on any steady clock), never counted in events, and
 * nothing is allocated per event.
 *
 * Why 12 bands and not 6: at 48 kHz the analyser's 1024 point FFT has 47 Hz bins, so bands 0
 * to 5 (20 to 70 Hz) all read the same bin. One bin of a noisy signal swings by 10 dB or more
 * from frame to frame, which made pink noise fire beats. Bands 0 to 11 cover five bins and
 * keep a kick's whole body (50 to 120 Hz).
 */

/** Low bands summed for the beat level: 0 to 11, about 20 to 245 Hz. */
export const BEAT_BANDS = 12;
/** Bands averaged for `bass`, the plain low level (0 to 5, 20 to 70 Hz). */
export const BASS_BANDS = 6;
/** Nominal shortest time between two beats: under three a second, the calm limit. */
export const MIN_BEAT_GAP_MS = 340;
/**
 * Slack on that gap, on both clocks: one frame because onsets sit on the 33 ms frame grid (a steady
 * 170 BPM kick, 353 ms, lands 330 or 363 ms apart), and one more because arrival times, and the
 * source times stamped from them, jitter by up to about 15 ms at each end. So the floor is 274 ms.
 * The calm limit does not rest on this gap: the three-in-a-second window below does.
 */
export const BEAT_GAP_TOLERANCE_MS = 66;
/** The calm limit itself: never more than `CALM_MAX_BEATS` beats inside any `CALM_WINDOW_MS`. */
export const CALM_WINDOW_MS = 1000;
export const CALM_MAX_BEATS = 3;
/** Window of the running median the threshold sits on. */
export const MEDIAN_WINDOW_MS = 1000;
/** How far above the median an onset frame must be (9 dB: about two stray beats an hour on pure pink noise in simulation, against about eight at 8 dB). */
export const ONSET_DB = 9;
/** How far above the median the frames after an onset must stay. */
export const HOLD_DB = 4;
/** Frames after the onset that must hold for it to count. */
export const CONFIRM_FRAMES = 2;
/** Frames of history needed before any beat (about a third of a second). */
export const WARMUP_FRAMES = 10;
/** A gap this long between events (silence, a hidden page) starts the history afresh. */
export const GAP_RESET_MS = 500;
/** Beat timestamps kept in `beats`, newest last. */
export const BEAT_HISTORY = 8;

const BAND_DB_FLOOR = -70;
const BAND_DB_RANGE = 60;
/** History slots: enough for one median window at well over the 30 Hz event rate. */
const SLOTS = 96;

export interface BeatDetector {
  /**
   * Feed one frame of normalised bands (0 to 1) at source time `now` ms, which arrived at
   * `arrival` ms on the real clock (default `now`). True when a beat was confirmed by this frame.
   */
  push(bands: ArrayLike<number>, now: number, arrival?: number): boolean;
  /** Forget the history (silence, a new device). The beat count and timestamps stay. */
  clear(): void;
  /** Forget everything, the count included (tests, a capture restart). */
  reset(): void;
  /** Beats confirmed so far. Only ever goes up between resets. */
  readonly count: number;
  /** Onset time (ms, the push clock) of the newest beat, or -Infinity. */
  readonly lastBeatAt: number;
  /** Milliseconds between the newest beat's onset and the frame that confirmed it. */
  readonly lag: number;
  /** Mean of the lowest bands (0 to 5) in the newest frame, 0 to 1. */
  readonly bass: number;
  /** The newest beat onset times in ms, oldest first (copied; for tests and diagnostics). */
  beats(): number[];
}

/** Median of the first `n` entries of `src`, sorted in `scratch` (no allocation). */
function median(src: Float64Array, n: number, scratch: Float64Array): number {
  for (let i = 0; i < n; i++) {
    // Insertion sort: n is at most a few dozen.
    const v = src[i];
    let j = i - 1;
    while (j >= 0 && scratch[j] > v) {
      scratch[j + 1] = scratch[j];
      j--;
    }
    scratch[j + 1] = v;
  }
  return n % 2 ? scratch[(n - 1) >> 1] : (scratch[n / 2 - 1] + scratch[n / 2]) / 2;
}

/** Tuning, for tests; the defaults are the constants above. */
export interface BeatTuning {
  onsetDb: number;
  holdDb: number;
  confirmFrames: number;
}

export function createBeatDetector(tuning: Partial<BeatTuning> = {}): BeatDetector {
  const onsetDb = tuning.onsetDb ?? ONSET_DB;
  const holdDb = tuning.holdDb ?? HOLD_DB;
  const confirmFrames = tuning.confirmFrames ?? CONFIRM_FRAMES;
  // Ring of (time, level) for the median window, oldest at `head`.
  const times = new Float64Array(SLOTS);
  const levels = new Float64Array(SLOTS);
  const window = new Float64Array(SLOTS);
  const scratch = new Float64Array(SLOTS);
  let head = 0;
  let size = 0;
  let prevLevel = NaN;
  let prevAt = -Infinity;
  // An onset waiting for its confirming frames.
  let pendingAt = NaN;
  let pendingHeld = 0;
  // Arrival times of the frames that confirmed the newest beats, newest last.
  const arrivals = new Float64Array(CALM_MAX_BEATS).fill(-Infinity);
  const stamps = new Float64Array(BEAT_HISTORY);

  const state = {
    count: 0,
    lastBeatAt: -Infinity,
    lag: 0,
    bass: 0,
  };

  const clear = () => {
    head = 0;
    size = 0;
    prevLevel = NaN;
    prevAt = -Infinity;
    pendingAt = NaN;
    pendingHeld = 0;
    state.bass = 0;
  };

  const detector: BeatDetector = {
    push(bands, now, arrival = now) {
      if (now - prevAt > GAP_RESET_MS) clear();
      prevAt = now;

      let power = 0;
      let bass = 0;
      const nb = Math.min(BEAT_BANDS, bands.length);
      for (let i = 0; i < nb; i++) {
        const v = Number.isFinite(bands[i]) ? Math.min(1, Math.max(0, bands[i])) : 0;
        power += Math.pow(10, (BAND_DB_FLOOR + v * BAND_DB_RANGE) / 10);
        if (i < BASS_BANDS) bass += v;
      }
      state.bass = nb > 0 ? bass / Math.min(BASS_BANDS, nb) : 0;
      const level = 10 * Math.log10(Math.max(power, 1e-12));

      // Drop history older than the median window, then take the median of what is left.
      while (size > 0 && times[head] < now - MEDIAN_WINDOW_MS) {
        head = (head + 1) % SLOTS;
        size--;
      }
      for (let i = 0; i < size; i++) window[i] = levels[(head + i) % SLOTS];
      const base = size > 0 ? median(window, size, scratch) : level;
      const above = level - base;

      let beat = false;
      if (!Number.isNaN(pendingAt)) {
        if (above >= holdDb) {
          pendingHeld++;
          if (
            pendingHeld >= confirmFrames &&
            (arrival - arrivals[CALM_MAX_BEATS - 1] < MIN_BEAT_GAP_MS - BEAT_GAP_TOLERANCE_MS ||
              arrival - arrivals[0] < CALM_WINDOW_MS)
          ) {
            // Too soon after the last beat on the real clock (frames that queued behind a stall): refused.
            pendingAt = NaN;
          } else if (pendingHeld >= confirmFrames) {
            state.count++;
            state.lastBeatAt = pendingAt;
            state.lag = now - pendingAt;
            for (let i = 1; i < CALM_MAX_BEATS; i++) arrivals[i - 1] = arrivals[i];
            arrivals[CALM_MAX_BEATS - 1] = arrival;
            for (let i = 1; i < BEAT_HISTORY; i++) stamps[i - 1] = stamps[i];
            stamps[BEAT_HISTORY - 1] = pendingAt;
            pendingAt = NaN;
            beat = true;
          }
        } else {
          pendingAt = NaN;
        }
      } else if (
        size >= WARMUP_FRAMES &&
        above >= onsetDb &&
        level > prevLevel &&
        now - state.lastBeatAt >= MIN_BEAT_GAP_MS - BEAT_GAP_TOLERANCE_MS &&
        (state.count < CALM_MAX_BEATS || now - stamps[BEAT_HISTORY - CALM_MAX_BEATS] >= CALM_WINDOW_MS)
      ) {
        pendingAt = now;
        pendingHeld = 0;
      }

      prevLevel = level;
      // Append; when the ring is full the oldest entry goes.
      if (size === SLOTS) {
        head = (head + 1) % SLOTS;
        size--;
      }
      const tail = (head + size) % SLOTS;
      times[tail] = now;
      levels[tail] = level;
      size++;
      return beat;
    },
    clear,
    reset() {
      clear();
      state.count = 0;
      state.lastBeatAt = -Infinity;
      state.lag = 0;
      arrivals.fill(-Infinity);
      stamps.fill(0);
    },
    get count() {
      return state.count;
    },
    get lastBeatAt() {
      return state.lastBeatAt;
    },
    get lag() {
      return state.lag;
    },
    get bass() {
      return state.bass;
    },
    beats() {
      const n = Math.min(state.count, BEAT_HISTORY);
      return Array.from(stamps.subarray(BEAT_HISTORY - n));
    },
  };
  return detector;
}
