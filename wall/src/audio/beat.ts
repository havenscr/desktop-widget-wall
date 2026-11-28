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
 * Beats the onset bar misses (a soft kick over a loud sustained bass bed) come from the tempo lock below, and a
 * kick that sits on the lock's beat grid confirms after one hold frame, not `CONFIRM_FRAMES`, because a short
 * kick (drum and bass) clears the bar but its second hold frame often drops under `HOLD_DB`.
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
/** How far above the median an onset frame must be (7 dB: measured on the lightsim songs, 9 dB missed most kicks under a loud bed; pure pink noise gives about 0.65 stray beats a minute, one every 90 s or so (3 in the 4.5 minutes the beat test pins), and the hold rule below stops lone noisy frames). */
export const ONSET_DB = 7;
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

/** A beat this many dB over the onset bar counts as full strength. */
export const BEAT_FULL_DB = 12;

/*
 * Tempo lock. Kicks under a loud sustained bass bed (synthwave) rise only 3 to 6 dB over the median,
 * as much as the bed's own wobble between kicks, so no fixed bar separates them. What does separate
 * them is timing: kicks repeat at a steady period, the wobble does not. Every rising frame
 * `TEMPO_CAND_DB` over the median is kept as a candidate (time, dB over the median) for
 * `TEMPO_HORIZON_MS`. The period comes from the weighted histogram of the intervals between
 * candidates (`TEMPO_MIN_PERIOD_MS` to `TEMPO_MAX_PERIOD_MS`), refined to a millisecond by the period
 * that lines the candidates up best on the phase circle. The lock is confident when that alignment
 * passes a Rayleigh test (`TEMPO_MIN_Z`) and a minimum resultant length (`TEMPO_MIN_R`). A candidate
 * under the onset bar then becomes a beat only when it sits on the learned pattern: its slot holds
 * `TEMPO_PEAK_FLAT` times a flat pattern's share, within `TEMPO_TOL_MS` of the predicted beat time, and
 * an earlier candidate sits one or two periods back. A lock that has seen no beat for two periods
 * restarts only on a candidate with `TEMPO_RESTART_ECHOES` echoes among one, two and three periods back
 * (all three left synthwave at 9 % of its kicks, two give 25 %, and the edm breakdown stays clean).
 * Beats the strong path finds are never touched.
 */
export const TEMPO_CAND_DB = 3;
export const TEMPO_HORIZON_MS = 8000;
export const TEMPO_MIN_PERIOD_MS = 300;
export const TEMPO_MAX_PERIOD_MS = 2000;
export const TEMPO_TOL_MS = 60;
/** Candidates closer than this merge into one (the first time, the strongest level). */
export const TEMPO_MERGE_MS = 100;
/** Fine period search span, as a share of the period. */
export const TEMPO_FINE_SPAN = 0.03;
/** A new period replaces the held one only when its alignment beats the held one's times this. */
export const TEMPO_HOLD_BIAS = 1;
/** The held period is re-fitted only this far (share of the period) either side, so it cannot wander. */
export const TEMPO_HOLD_SPAN = 0.01;
/** Minimum Rayleigh statistic and resultant length of the phase lock. */
export const TEMPO_MIN_Z = 6;
/** Echoes (of the three at one, two and three periods back) a candidate needs to restart a lapsed lock. */
export const TEMPO_RESTART_ECHOES = 2;
/** A strong onset on the grid of a lock this confident confirms after one hold frame, not `CONFIRM_FRAMES`. */
export const TEMPO_FAST_Z = 3;
export const TEMPO_MIN_R = 0.35;
/** The best slot must hold this many times the weight a flat pattern would give it. */
export const TEMPO_PEAK_FLAT = 2.5;
/** The slot at the candidate's own phase must hold this share of the best slot. */
export const TEMPO_SLOT_SHARE = 0.6;
/** Frames after a weak onset that must hold `TEMPO_HOLD_DB` over the median. */
export const TEMPO_CONFIRM_FRAMES = 1;
export const TEMPO_HOLD_DB = 1;
const TEMPO_SLOTS = 48;
const TEMPO_BIN_MS = 10;
const TEMPO_BINS = Math.floor(TEMPO_MAX_PERIOD_MS / TEMPO_BIN_MS) + 1;
const PHASE_BINS = 100;
/** The predicted beat time is the heaviest stretch of the best slot that is 1 / this wide (a late bump in the slot does not drag it). */
const TEMPO_CORE_DIV = 5;
/** Histogram bins either side of the peak that count as the peak. */
const TEMPO_PEAK_REACH = 6;

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
  /** How hard the newest beat hit, 0 (just over the onset bar) to 1 (about `BEAT_FULL_DB` over it). */
  readonly strength: number;
  /** Mean of the lowest bands (0 to 5) in the newest frame, 0 to 1. */
  readonly bass: number;
  /** The newest beat onset times in ms, oldest first (copied; for tests and diagnostics). */
  beats(): number[];
  /** The tempo lock's state, for tests and the sandbox. */
  tempo(): TempoState;
}

/** The tempo lock's state. */
export interface TempoState {
  /** Period in ms (NaN while unlocked). */
  period: number;
  /** Rayleigh statistic of the phase lock. */
  z: number;
  /** Mean resultant length of the phase lock, 0 to 1. */
  r: number;
  /** Beats the tempo lock confirmed (also counted in `count`). */
  weakBeats: number;
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
  /** Tempo lock on (default true). */
  tempo: boolean;
}

export function createBeatDetector(tuning: Partial<BeatTuning> = {}): BeatDetector {
  const onsetDb = tuning.onsetDb ?? ONSET_DB;
  const holdDb = tuning.holdDb ?? HOLD_DB;
  const confirmFrames = tuning.confirmFrames ?? CONFIRM_FRAMES;
  const tempoOn = tuning.tempo ?? true;
  // Candidate ring, oldest at `cHead`.
  const cTimes = new Float64Array(TEMPO_SLOTS);
  const cAbove = new Float64Array(TEMPO_SLOTS);
  let cHead = 0;
  let cSize = 0;
  const hist = new Float64Array(TEMPO_BINS + TEMPO_PEAK_REACH + 1);
  const phase = new Float64Array(PHASE_BINS);
  let period = NaN;
  let lockZ = 0;
  let lockR = 0;
  let weakBeats = 0;
  let pendingWeak = false;
  let pendingFast = false;
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
  let pendingAbove = 0;
  // Arrival times of the frames that confirmed the newest beats, newest last.
  const arrivals = new Float64Array(CALM_MAX_BEATS).fill(-Infinity);
  const stamps = new Float64Array(BEAT_HISTORY);

  const state = {
    count: 0,
    lastBeatAt: -Infinity,
    lag: 0,
    bass: 0,
    strength: 0,
  };

  const clear = () => {
    head = 0;
    size = 0;
    prevLevel = NaN;
    prevAt = -Infinity;
    pendingAt = NaN;
    pendingHeld = 0;
    pendingWeak = false;
    pendingFast = false;
    state.bass = 0;
    cHead = 0;
    cSize = 0;
    period = NaN;
    lockZ = 0;
    lockR = 0;
  };

  const cAt = (i: number) => cTimes[(cHead + i) % TEMPO_SLOTS];
  const cW = (i: number) => cAbove[(cHead + i) % TEMPO_SLOTS] - TEMPO_CAND_DB + 1;

  /** Resultant length of the candidates' phases at period `P`, weighted. */
  const resultant = (P: number): number => {
    let re = 0;
    let im = 0;
    for (let i = 0; i < cSize; i++) {
      const ang = (2 * Math.PI * cAt(i)) / P;
      const w = cW(i);
      re += w * Math.cos(ang);
      im += w * Math.sin(ang);
    }
    return Math.sqrt(re * re + im * im);
  };

  /** Best integer period within `span` of `around`: [period, resultant]. */
  const fine = (around: number, span: number): [number, number] => {
    let bestRes = -1;
    let bestP = around;
    const lo = Math.max(TEMPO_MIN_PERIOD_MS, Math.floor(around * (1 - span)));
    const hi = Math.min(TEMPO_MAX_PERIOD_MS, Math.ceil(around * (1 + span)));
    for (let P = lo; P <= hi; P++) {
      const res = resultant(P);
      if (res > bestRes) {
        bestRes = res;
        bestP = P;
      }
    }
    return [bestP, bestRes];
  };

  /** Add a candidate (or merge it into the newest) and re-estimate the period. */
  const addCandidate = (now: number, above: number) => {
    while (cSize > 0 && cTimes[cHead] < now - TEMPO_HORIZON_MS) {
      cHead = (cHead + 1) % TEMPO_SLOTS;
      cSize -= 1;
    }
    if (cSize > 0 && now - cAt(cSize - 1) < TEMPO_MERGE_MS) {
      const last = (cHead + cSize - 1) % TEMPO_SLOTS;
      if (above > cAbove[last]) cAbove[last] = above;
      return;
    }
    if (cSize === TEMPO_SLOTS) {
      cHead = (cHead + 1) % TEMPO_SLOTS;
      cSize -= 1;
    }
    const tail = (cHead + cSize) % TEMPO_SLOTS;
    cTimes[tail] = now;
    cAbove[tail] = above;
    cSize++;
    // Weighted histogram of every pair's interval.
    hist.fill(0);
    for (let i = 0; i < cSize; i++) {
      const ti = cAt(i);
      const wi = cW(i);
      for (let j = i + 1; j < cSize; j++) {
        const d = cAt(j) - ti;
        if (d < TEMPO_MIN_PERIOD_MS) continue;
        if (d > TEMPO_MAX_PERIOD_MS) break;
        hist[Math.round(d / TEMPO_BIN_MS)] += wi * cW(j);
      }
    }
    let best = 0;
    let bestBin = -1;
    for (let b = TEMPO_MIN_PERIOD_MS / TEMPO_BIN_MS; b <= TEMPO_BINS - 1; b++) {
      let sum = 0;
      for (let k = -TEMPO_PEAK_REACH; k <= TEMPO_PEAK_REACH; k++) if (b + k >= 0) sum += hist[b + k];
      if (sum > best) {
        best = sum;
        bestBin = b;
      }
    }
    if (bestBin < 0) {
      period = NaN;
      lockZ = 0;
      lockR = 0;
      return;
    }
    // Centre on the weighted mean of the bins under the peak (the windowed sum is flat across it).
    let cn = 0;
    let cd = 0;
    for (let k = -TEMPO_PEAK_REACH; k <= TEMPO_PEAK_REACH; k++) {
      const b = bestBin + k;
      if (b < 0) continue;
      cn += hist[b] * b * TEMPO_BIN_MS;
      cd += hist[b];
    }
    const p0 = cd > 0 ? cn / cd : bestBin * TEMPO_BIN_MS;
    let [np, nres] = fine(p0, TEMPO_FINE_SPAN);
    if (Number.isFinite(period)) {
      const [hp, hres] = fine(period, TEMPO_HOLD_SPAN);
      if (hres * TEMPO_HOLD_BIAS >= nres) [np, nres] = [hp, hres];
    }
    period = np;
    let wsum = 0;
    let w2 = 0;
    for (let i = 0; i < cSize; i++) {
      const w = cW(i);
      wsum += w;
      w2 += w * w;
    }
    lockR = wsum > 0 ? nres / wsum : 0;
    // Rayleigh statistic: effective candidate count times R squared (about 1 for random times).
    lockZ = w2 > 0 ? ((wsum * wsum) / w2) * lockR * lockR : 0;
  };

  /** Whether `now` sits on a strong slot of the one-period pattern of the earlier candidates, on the predicted beat time. */
  const onPattern = (now: number): boolean => {
    phase.fill(0);
    const bw = period / PHASE_BINS;
    let total = 0;
    for (let i = 0; i < cSize; i++) {
      const c = cAt(i);
      if (c >= now - 1) continue;
      const w = cW(i);
      phase[Math.min(PHASE_BINS - 1, Math.floor(((now - c) % period) / bw))] += w;
      total += w;
    }
    if (total <= 0) return false;
    const reach = Math.max(1, Math.round(TEMPO_TOL_MS / bw));
    let best = 0;
    let bestBin = 0;
    let here = 0;
    for (let b = 0; b < PHASE_BINS; b++) {
      let sum = 0;
      for (let k = -reach; k <= reach; k++) sum += phase[(b + k + PHASE_BINS) % PHASE_BINS];
      if (sum > best) {
        best = sum;
        bestBin = b;
      }
      if (b === 0) here = sum;
    }
    const flat = (total * (2 * reach + 1)) / PHASE_BINS;
    if (best < TEMPO_PEAK_FLAT * flat || here < TEMPO_SLOT_SHARE * best) return false;
    // The predicted beat time is the heaviest narrow stretch of the best slot; now must be within the tolerance of it.
    const nr = Math.max(1, Math.round(reach / TEMPO_CORE_DIV));
    let nbest = -1;
    let nbin = bestBin;
    for (let c = -reach; c <= reach; c++) {
      let sum = 0;
      for (let k = -nr; k <= nr; k++) sum += phase[(bestBin + c + k + PHASE_BINS * 2) % PHASE_BINS];
      if (sum > nbest) {
        nbest = sum;
        nbin = bestBin + c;
      }
    }
    let mean = 0;
    let weight = 0;
    for (let k = -nr; k <= nr; k++) {
      const w = phase[(nbin + k + PHASE_BINS * 2) % PHASE_BINS];
      mean += w * k;
      weight += w;
    }
    let off = ((nbin + 0.5 + (weight > 0 ? mean / weight : 0)) % PHASE_BINS) * bw;
    if (off > period / 2) off -= period;
    return Math.abs(off) <= TEMPO_TOL_MS;
  };

  /** Whether an earlier candidate sits `k` periods before `now`, within the tolerance. */
  const echoAt = (now: number, k: number): boolean => {
    const want = now - k * period;
    for (let i = cSize - 1; i >= 0; i -= 1) {
      const c = cAt(i);
      if (c >= now - 1) continue;
      if (Math.abs(c - want) <= TEMPO_TOL_MS) return true;
      if (c < want - TEMPO_TOL_MS) break;
    }
    return false;
  };

  /** Whether the lock is confident enough to place beats: at least `minZ` and `TEMPO_MIN_R`. */
  const locked = (minZ: number): boolean => lockZ >= minZ && lockR >= TEMPO_MIN_R && Number.isFinite(period);

  /** Whether a weak onset at `now` is a beat of the lock. */
  const tempoBeat = (now: number): boolean => {
    if (!locked(TEMPO_MIN_Z) || !onPattern(now)) return false;
    const e1 = echoAt(now, 1);
    const e2 = echoAt(now, 2);
    if (!(e1 || e2)) return false;
    // A lock with no beat in the last two periods restarts only on a candidate with at least two echoes of three.
    if (now - state.lastBeatAt > 2 * period + TEMPO_TOL_MS) {
      return (e1 ? 1 : 0) + (e2 ? 1 : 0) + (echoAt(now, 3) ? 1 : 0) >= TEMPO_RESTART_ECHOES;
    }
    return true;
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
      const needHeld = pendingWeak ? TEMPO_CONFIRM_FRAMES : pendingFast ? 1 : confirmFrames;
      if (!Number.isNaN(pendingAt)) {
        if (above >= (pendingWeak ? TEMPO_HOLD_DB : holdDb)) {
          pendingHeld++;
          if (above > pendingAbove) pendingAbove = above;
          if (
            pendingHeld >= needHeld &&
            (arrival - arrivals[CALM_MAX_BEATS - 1] < MIN_BEAT_GAP_MS - BEAT_GAP_TOLERANCE_MS ||
              arrival - arrivals[0] < CALM_WINDOW_MS)
          ) {
            // Too soon after the last beat on the real clock (frames that queued behind a stall): refused.
            pendingAt = NaN;
          } else if (pendingHeld >= needHeld) {
            if (pendingWeak) weakBeats++;
            state.count++;
            state.lastBeatAt = pendingAt;
            state.lag = now - pendingAt;
            state.strength = Math.min(1, Math.max(0, (pendingAbove - (pendingWeak ? TEMPO_CAND_DB : onsetDb)) / BEAT_FULL_DB));
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
        pendingAbove = above;
        pendingWeak = false;
        pendingFast = tempoOn && locked(TEMPO_FAST_Z) && onPattern(now);
      } else if (
        tempoOn &&
        size >= WARMUP_FRAMES &&
        above >= TEMPO_CAND_DB &&
        level > prevLevel &&
        now - state.lastBeatAt >= MIN_BEAT_GAP_MS - BEAT_GAP_TOLERANCE_MS &&
        (state.count < CALM_MAX_BEATS || now - stamps[BEAT_HISTORY - CALM_MAX_BEATS] >= CALM_WINDOW_MS) &&
        tempoBeat(now)
      ) {
        pendingAt = now;
        pendingHeld = 0;
        pendingAbove = above;
        pendingWeak = true;
        pendingFast = false;
      }
      if (tempoOn && size >= WARMUP_FRAMES && above >= TEMPO_CAND_DB && level > prevLevel) addCandidate(now, above);

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
      state.strength = 0;
      weakBeats = 0;
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
    get strength() {
      return state.strength;
    },
    get bass() {
      return state.bass;
    },
    beats() {
      const n = Math.min(state.count, BEAT_HISTORY);
      return Array.from(stamps.subarray(BEAT_HISTORY - n));
    },
    tempo() {
      return { period, z: lockZ, r: lockR, weakBeats };
    },
  };
  return detector;
}
